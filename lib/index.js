/**
 * dsh-image-read — DeepSeek Harness plugin (v0.5.0).
 *
 * Single capability: structured image analysis (read_image_mimo tool) —
 * multi-provider failover, schema-validated output, result caching, SSRF
 * protection, key redaction, Web UI config card.
 *
 * Attachment input has moved to dsh-input-enhancement.
 */

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import z from '@deepseek-ai/schemastery';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';

const execFileAsync = promisify(execFile);

// ============================================================================
//  Cordis plugin metadata (vision tool)
// ============================================================================

export const name = 'image-read';
export const inject = ['tools', 'settings', 'loader', 'sessions'];

/** Settings namespace — kebab-case, matches the cordis.patch.yml row id. */
export const IMAGE_READ_NS = settingsNamespace('image-read');

export const Config = z.object({
  providers: z.array(z.object({
    name: z.string(),
    baseUrl: z.string(),
    model: z.string(),
  })),
  // Web UI overrides for the primary provider; blank keeps the provider chain.
  baseUrl: z.string().default(''),
  model: z.string().default(''),
  timeoutMs: z.number().step(1).min(1000),
  maxImageDimension: z.number().step(1).min(256),
  apiKey: z.string().role('secret'),
});

/** Default credential ref — derived from the first provider's name. */
export function credentialRefFor(config) {
  const name = config?.providers?.[0]?.name;
  if (name) return `IMAGE_READ_${name.toUpperCase()}_API_KEY`;
  return 'MIMO_API_KEY';
}

// ============================================================================
//  Defaults
// ============================================================================

const DEFAULT_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const DEFAULT_MODEL = 'mimo-v2.5';
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_IMAGE_DIMENSION = 1024;

const MIME_BY_SUFFIX = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function normalizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

// ============================================================================
//  Structured output schema
// ============================================================================

const VISION_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    ocr: {
      type: 'object',
      properties: {
        full_text: { type: 'string' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text: { type: 'string' }, language: { type: 'string' } },
            required: ['text'],
          },
        },
      },
      required: ['full_text', 'lines'],
    },
    layout: {
      type: 'object',
      properties: {
        regions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              reading_order: { type: 'number' },
              text: { type: 'string' },
            },
            required: ['type', 'reading_order', 'text'],
          },
        },
      },
      required: ['regions'],
    },
    uncertainty: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'ocr', 'layout', 'uncertainty'],
};

// ============================================================================
//  Prompt helpers
// ============================================================================

function buildVisionPrompt(focus, mode = 'general', imageCount = 1, detailLevel = 'detailed') {
  const baseRules = (
    '识别前先判断图片本身的状态：是否正常加载、是否为纯色/全透明/空白图、' +
    '是否损坏或内容缺失。若图片是透明背景或全透明，请明确说出「透明」，' +
    '不要把透明误报为黑色或白色；若图片为空白、纯色或无法辨认内容，' +
    '请直接如实说明，不要编造不存在的细节。'
  );

  let prompt;
  if (mode === 'ocr') {
    prompt = (
      `${baseRules}\n\n` +
      '请提取图片中的所有文字内容，严格保留原始布局格式' +
      '（标题层级、列表缩进、表格结构、代码块等）。\n' +
      '只输出文字内容，不要添加分析或描述。'
    );
  } else if (imageCount > 1) {
    prompt = (
      `${baseRules}\n\n` +
      `你面前有 ${imageCount} 张图片，请逐一对比分析：\n` +
      '1. 各图片的内容摘要（每张一句话）\n' +
      '2. 关键差异点（布局、颜色、文字、元素位置等）\n' +
      '3. 总体结论（差异原因推测，若有设计稿请指出实现偏差）'
    );
  } else {
    const levelDesc = {
      brief: `${baseRules}\n\n简要描述图片核心内容`,
      normal: `${baseRules}\n\n描述图片主要内容，包括可见的标注和重点区域`,
      detailed: (
        `${baseRules}\n\n` +
        '请非常详尽地描述这张图片，包括：\n' +
        '1. 整体内容和场景\n' +
        '2. 所有文字内容（保留原始格式）\n' +
        '3. 框选、标注、箭头指示的位置和含义\n' +
        '4. 高亮区域和颜色标记的含义\n' +
        '5. 各元素的相对位置和布局关系\n' +
        '6. 图表数据（如有）\n' +
        '7. 若图片为透明、空白或纯色，请直接指出，无需展开其余条目\n' +
        '请用结构化方式输出，方便后续处理。'
      ),
    };
    prompt = levelDesc[detailLevel] || levelDesc.detailed;
  }

  if (focus) {
    prompt += `\n\n特别关注: ${focus}`;
  }
  return prompt;
}

// ============================================================================
//  Schema validation
// ============================================================================

function schemaViolations(schema, value, path = '') {
  const label = path || '(root)';
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [label];
    const violations = [];
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      const childPath = path ? `${path}.${key}` : key;
      const isRequired = schema.required?.includes(key) ?? false;
      if (!(key in value) || value[key] === undefined) {
        if (isRequired) violations.push(childPath);
        continue;
      }
      violations.push(...schemaViolations(child, value[key], childPath));
    }
    return violations;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [label];
    if (!schema.items) return [];
    return value.flatMap((item, i) => schemaViolations(schema.items, item, `${path}[${i}]`));
  }
  if (schema.type === 'string') return typeof value === 'string' ? [] : [label];
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) ? [] : [label];
  return [];
}

function stripNullOptionals(value, schema) {
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    const cleaned = {};
    for (const [key, entry] of Object.entries(value)) {
      const child = schema.properties?.[key];
      const isRequired = schema.required?.includes(key) ?? false;
      if (entry === null && !isRequired) continue;
      cleaned[key] = child ? stripNullOptionals(entry, child) : entry;
    }
    return cleaned;
  }
  if (schema.type === 'array' && schema.items && Array.isArray(value)) {
    return value.map((item) => stripNullOptionals(item, schema.items));
  }
  return value;
}

function validateAndNormalize(result) {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error('Vision result is not an object');
  }
  const normalized = stripNullOptionals(result, VISION_RESULT_SCHEMA);
  if (typeof normalized.summary !== 'string') normalized.summary = '';
  if (!normalized.ocr || typeof normalized.ocr !== 'object') normalized.ocr = { full_text: '', lines: [] };
  if (typeof normalized.ocr.full_text !== 'string') normalized.ocr.full_text = '';
  if (!Array.isArray(normalized.ocr.lines)) normalized.ocr.lines = [];
  if (!normalized.layout || typeof normalized.layout !== 'object') normalized.layout = { regions: [] };
  if (!Array.isArray(normalized.layout.regions)) normalized.layout.regions = [];
  if (!Array.isArray(normalized.uncertainty)) normalized.uncertainty = [];
  return normalized;
}

// ============================================================================
//  Cache
// ============================================================================

const FAILURE_COOLDOWN_MS = 60_000;
const CACHE_TTL_MS = 3_600_000;
const CACHE_DIR = path.join(tmpdir(), 'dsh-image-read-cache');

function cacheKey(imagePath, mode, focus) {
  const buf = readFileSync(imagePath);
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  const paramHash = createHash('md5').update(JSON.stringify({ mode, focus: focus || '' })).digest('hex').slice(0, 8);
  return `${hash}-${paramHash}.json`;
}

function getCached(key) {
  const p = path.join(CACHE_DIR, key);
  if (!existsSync(p)) return null;
  try {
    const entry = JSON.parse(readFileSync(p, 'utf8'));
    const ttl = entry.ok ? CACHE_TTL_MS : FAILURE_COOLDOWN_MS;
    if (Date.now() - entry.cachedAt > ttl) { rmSync(p, { force: true }); return null; }
    return entry;
  } catch { return null; }
}

function setCached(key, entry) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(path.join(CACHE_DIR, key), JSON.stringify(entry), 'utf-8');
  } catch { /* non-fatal */ }
}

// ============================================================================
//  SSRF protection
// ============================================================================

const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain',
  'metadata.google.internal', 'metadata.amazonaws.com', 'metadata.azure.internal',
]);

function isPrivateIPv4(ip) {
  const octets = ip.split('.').map((s) => parseInt(s, 10));
  if (octets.length !== 4 || octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 || a === 10 || a === 127 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 ||
    a === 100 && b >= 64 && b <= 127 || a >= 224
  );
}

async function assertSafeRemoteTarget(input) {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Image URL is required.');
  let url;
  try { url = new URL(trimmed); } catch { throw new Error(`Invalid URL: ${trimmed}`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http/https image URLs are supported.');
  if (url.username || url.password) throw new Error('URL with embedded credentials is not allowed.');
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) throw new Error(`Blocked reserved host: ${hostname}`);
  if (isIP(hostname)) {
    if (isPrivateIPv4(hostname)) throw new Error(`Blocked private IP: ${hostname}`);
    return;
  }
  let records;
  try { records = await dns.lookup(hostname, { all: true }); } catch (err) { throw new Error(`DNS lookup failed for ${hostname}: ${err.message}`); }
  if (records.length === 0) throw new Error(`Host ${hostname} did not resolve.`);
  if (records.find((r) => isPrivateIPv4(r.address))) throw new Error(`Blocked: ${hostname} resolves to a private IP`);
}

// ============================================================================
//  Image helpers
// ============================================================================

function isRemote(source) { return /^https?:\/\//i.test(source); }

function detectMime(source, contentType) {
  if (typeof contentType === 'string' && contentType.length > 0) {
    const mime = contentType.split(';')[0].trim().toLowerCase();
    if (mime.startsWith('image/')) return mime;
  }
  return MIME_BY_SUFFIX[path.extname(source).toLowerCase()] ?? 'image/jpeg';
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function withTimeout(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function compressIfNeeded(filePath, maxDim) {
  const fallback = { path: filePath, tmp: null };
  try {
    const { stdout } = await execFileAsync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], { timeout: 10_000 });
    let width = 0, height = 0;
    for (const line of stdout.split('\n')) {
      if (line.includes('pixelWidth')) width = parseInt(line.split(':').pop()?.trim() ?? '', 10) || 0;
      else if (line.includes('pixelHeight')) height = parseInt(line.split(':').pop()?.trim() ?? '', 10) || 0;
    }
    if (width <= 0 || height <= 0) return fallback;
    if (width <= maxDim && height <= maxDim) return fallback;
    const suffix = path.extname(filePath).toLowerCase() || '.png';
    const tmp = path.join(tmpdir(), `dsh-image-read-${randomUUID()}${suffix}`);
    try {
      await execFileAsync('sips', ['-Z', String(maxDim), filePath, '--out', tmp], { timeout: 30_000 });
      return { path: tmp, tmp };
    } catch { return fallback; }
  } catch { return fallback; }
}

async function readLocalImage(filePath) {
  const resolved = path.resolve(filePath);
  const mime = detectMime(resolved);
  if (!Object.values(MIME_BY_SUFFIX).includes(mime)) throw new Error(`Unsupported image format: ${path.extname(resolved)}. Supported: ${Object.keys(MIME_BY_SUFFIX).sort().join(', ')}`);
  let buf;
  try { buf = readFileSync(resolved); } catch (err) {
    if (err?.code === 'ENOENT') throw new Error(`Image not found: ${resolved}`);
    throw err;
  }
  return { b64: buf.toString('base64'), mime };
}

async function downloadImage(url, signal) {
  await assertSafeRemoteTarget(url);
  const res = await fetch(url, { signal: withTimeout(signal, 60_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to download image (HTTP ${res.status}): ${url}`);
  const mime = detectMime(url, res.headers.get('content-type'));
  return { b64: Buffer.from(await res.arrayBuffer()).toString('base64'), mime };
}

export function checkFullyTransparentPng(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];
  if (interlace !== 0 || ![4, 6].includes(colorType) || ![8, 16].includes(bitDepth)) return false;
  const idat = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + length));
    else if (type === 'IEND') break;
    pos += 12 + length;
  }
  let decompressed;
  try { decompressed = zlib.inflateSync(Buffer.concat(idat)); } catch { return false; }
  const chCount = colorType === 6 ? 4 : 2;
  const bytesPerCh = bitDepth / 8;
  const bpp = chCount * bytesPerCh;
  const stride = width * bpp;
  if (decompressed.length < height * (stride + 1)) return false;
  const alphaOffset = (chCount - 1) * bytesPerCh;
  for (let rowIdx = 0; rowIdx < height; rowIdx++) {
    const rowStart = rowIdx * (stride + 1) + 1;
    const row = decompressed.subarray(rowStart, rowStart + stride);
    if (bytesPerCh === 1) {
      for (let i = alphaOffset; i < stride; i += bpp) if (row[i] !== 0) return false;
    } else {
      for (let off = alphaOffset; off < stride; off += bpp) if (row[off] !== 0 || row[off + 1] !== 0) return false;
    }
  }
  return true;
}

// ============================================================================
//  Secret redaction
// ============================================================================

function redactSecrets(text, secrets = []) {
  let result = text;
  for (const secret of secrets) { if (secret) result = result.replaceAll(secret, '***'); }
  return result;
}

// ============================================================================
//  Provider execution
// ============================================================================

async function callVisionApi(payload, apiKey, baseUrl, signal, timeoutMs) {
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: withTimeout(signal, timeoutMs),
      });
      if (res.status === 200) return await res.json();
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS_MS[attempt]); continue;
      }
      const body = await res.text();
      throw new Error(`API error (HTTP ${res.status}): ${body.slice(0, 300)}`);
    } catch (err) {
      if (signal?.aborted) throw err;
      const retryable = err && (err.name === 'TimeoutError' || err.name === 'AbortError' || err instanceof TypeError);
      if (retryable && attempt < MAX_RETRIES) { lastError = err; await sleep(RETRY_DELAYS_MS[attempt]); continue; }
      throw err;
    }
  }
  throw lastError ?? new Error('Retries exhausted');
}

// ============================================================================
//  Core: read image with failover chain + caching
// ============================================================================

export async function readImage(input, signal, cfg) {
  const { image_path, compare_with, focus = '', mode = 'general', detail_level = 'detailed' } = input;
  const tmpFiles = [];
  const cleanTmp = () => { for (const f of tmpFiles) { try { rmSync(f, { force: true }); } catch { /* ignore */ } } };

  try {
    let mainPath = image_path;
    if (isRemote(mainPath)) { await assertSafeRemoteTarget(mainPath); }
    else {
      mainPath = path.resolve(mainPath);
      if (!existsSync(mainPath)) throw new Error(`Image not found: ${mainPath}`);
      if (!statSync(mainPath).isFile()) throw new Error(`Not a file: ${mainPath}`);
    }

    if (!isRemote(mainPath)) {
      const compressed = await compressIfNeeded(mainPath, cfg.maxImageDimension);
      mainPath = compressed.path;
      if (compressed.tmp) tmpFiles.push(compressed.tmp);
    }

    if (!isRemote(mainPath)) {
      const key = cacheKey(mainPath, mode, focus);
      const cached = getCached(key);
      if (cached?.ok) return { ...cached.result, _cached: true };
    }

    const main = isRemote(mainPath) ? await downloadImage(mainPath, signal) : await readLocalImage(mainPath);

    if (main.mime === 'image/png') {
      try {
        if (checkFullyTransparentPng(Buffer.from(main.b64, 'base64'))) {
          return {
            summary: 'Fully transparent image — no visible content.',
            ocr: { full_text: '', lines: [] },
            layout: { regions: [] },
            uncertainty: ['Image is entirely transparent (alpha = 0). Possible causes: screenshot failure, save failure, or blank asset.'],
          };
        }
      } catch { /* non-fatal */ }
    }

    const content = [{ type: 'image_url', image_url: { url: `data:${main.mime};base64,${main.b64}` } }];
    let imageCount = 1;

    if (Array.isArray(compare_with)) {
      for (const raw of compare_with) {
        const extra = String(raw ?? '').trim();
        if (!extra) continue;
        try {
          let extraPath = extra;
          if (!isRemote(extraPath)) {
            const compressed = await compressIfNeeded(extraPath, cfg.maxImageDimension);
            extraPath = compressed.path;
            if (compressed.tmp) tmpFiles.push(compressed.tmp);
          } else { await assertSafeRemoteTarget(extraPath); }
          const extraImg = isRemote(extraPath) ? await downloadImage(extraPath, signal) : await readLocalImage(extraPath);
          content.push({ type: 'image_url', image_url: { url: `data:${extraImg.mime};base64,${extraImg.b64}` } });
          imageCount += 1;
        } catch (err) { throw new Error(`Compare image failed (${extra}): ${err instanceof Error ? err.message : String(err)}`); }
      }
    }

    const prompt = buildVisionPrompt(focus, mode, imageCount, detail_level);
    content.push({ type: 'text', text: prompt });

    const providers = cfg.providers;
    const attempts = [];
    let lastError = null;

    for (const provider of providers) {
      const startedAt = Date.now();
      try {
        const payload = { model: provider.model, messages: [{ role: 'user', content }], max_tokens: 2000 };
        const raw = await callVisionApi(payload, provider.apiKey, provider.baseUrl, signal, cfg.timeoutMs);
        const text = raw?.choices?.[0]?.message?.content;
        if (!text) throw new Error('API returned no message content');
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
          if (fenced) {
            parsed = JSON.parse(fenced[1].trim());
          } else {
            parsed = {
              summary: text.trim(),
              ocr: { full_text: text.trim(), lines: [] },
              layout: { regions: [] },
              uncertainty: ['Model returned non-JSON text; wrapped as raw summary'],
            };
          }
        }
        const result = validateAndNormalize(parsed);
        if (!isRemote(mainPath)) { setCached(cacheKey(mainPath, mode, focus), { ok: true, cachedAt: Date.now(), result }); }
        return result;
      } catch (err) {
        lastError = err;
        attempts.push({ provider: provider.name, ok: false, durationMs: Date.now() - startedAt, error: redactSecrets(err instanceof Error ? err.message : String(err), [provider.apiKey, provider.baseUrl]).slice(0, 300) });
      }
    }

    if (!isRemote(mainPath)) { setCached(cacheKey(mainPath, mode, focus), { ok: false, cachedAt: Date.now(), attempts }); }
    const summary = attempts.map((a) => `${a.provider}: ${a.error}`).join(' | ');
    throw new Error(`All vision providers failed. ${summary}`);
  } finally { cleanTmp(); }
}

// ============================================================================
//  Config normalization
// ============================================================================

function normalizeConfig(raw = {}) {
  let providers = [];
  if (Array.isArray(raw.providers) && raw.providers.length > 0) {
    for (const p of raw.providers) {
      if (!p.baseUrl || !p.apiKey || !p.model) continue;
      providers.push({ name: p.name || 'unnamed', baseUrl: normalizeBaseUrl(p.baseUrl), apiKey: p.apiKey, model: p.model });
    }
  }
  if (providers.length === 0 && raw.baseUrl && raw.apiKey) {
    providers.push({ name: 'primary', baseUrl: normalizeBaseUrl(raw.baseUrl), apiKey: raw.apiKey, model: raw.model || DEFAULT_MODEL });
  }
  if (providers.length === 0) {
    providers.push({ name: 'default', baseUrl: normalizeBaseUrl(DEFAULT_API_URL), apiKey: process.env.MIMO_API_KEY || '', model: DEFAULT_MODEL });
  }
  return {
    providers,
    timeoutMs: Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0 ? raw.timeoutMs : DEFAULT_TIMEOUT_MS,
    maxImageDimension: Number.isInteger(raw.maxImageDimension) && raw.maxImageDimension > 0 ? raw.maxImageDimension : DEFAULT_MAX_IMAGE_DIMENSION,
  };
}

// ============================================================================
//  Tool definition
// ============================================================================

function makeTool(getCfg) {
  return {
    name: 'read_image_mimo',
    description: 'Read a local image or image URL and return structured JSON evidence (summary, OCR text, layout regions, uncertainty). Supports general vision, OCR mode, and multi-image comparison. Large images are automatically compressed. Results are cached.',
    parameters: {
      type: 'object',
      properties: {
        image_path: { type: 'string', description: 'Primary image path (local file or http(s) URL).' },
        compare_with: { type: 'array', items: { type: 'string' }, description: 'Optional: additional image paths for comparison.' },
        focus: { type: 'string', description: "Optional: specific area to focus on, e.g. 'the error message in red'." },
        detail_level: { type: 'string', enum: ['brief', 'normal', 'detailed'], description: 'Detail level (general mode only).' },
        mode: { type: 'string', enum: ['general', 'ocr'], description: 'Recognition mode: general (default) = full analysis, OCR = text extraction.' },
      },
      required: ['image_path'],
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          summary: { type: 'string' },
          ocr: { type: 'object', properties: { full_text: { type: 'string' }, lines: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, language: { type: 'string' } }, required: ['text'] } } }, required: ['full_text', 'lines'] },
          layout: { type: 'object', properties: { regions: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, reading_order: { type: 'number' }, text: { type: 'string' } }, required: ['type', 'reading_order', 'text'] } } }, required: ['regions'] },
          uncertainty: { type: 'array', items: { type: 'string' } },
        },
        required: ['summary', 'ocr', 'layout', 'uncertainty'],
      },
      render: (_args, value) => {
        const lines = [
          value.summary || '(no summary)', '', '**OCR:**', (value.ocr?.full_text || '').slice(0, 500) || '(none)',
          '', `**Layout regions:** ${value.layout?.regions?.length ?? 0}`,
          ...(value.uncertainty?.length ? ['', '**Uncertainty:**', ...value.uncertainty.map((u) => `- ${u}`)] : []),
        ];
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const imagePath = typeof args?.image_path === 'string' ? args.image_path.trim() : '';
      if (!imagePath) throw new Error('image_path is required');
      return await readImage({ image_path: imagePath, compare_with: args.compare_with, focus: args.focus, detail_level: args.detail_level, mode: args.mode }, exec.signal, await getCfg());
    },
    presentCall: (args) => ({ card: 'generic', title: args.image_path, kind: 'image-read', rawInput: args.image_path }),
  };
}

// ============================================================================
//  Main plugin entry — vision tool only
// ============================================================================

export function apply(ctx, config = {}) {
  // credentials.resolve() is async — a sync read would silently miss the
  // stored key and send an empty Bearer token (401 Invalid API Key).
  const resolveApiKey = async () => {
    try {
      const credentials = ctx.get?.('credentials');
      if (credentials?.resolve) {
        const ref = credentialRefFor(currentConfig());
        const resolved = await credentials.resolve(ref);
        if (resolved && typeof resolved === 'object' && 'value' in resolved && resolved.value) return resolved.value;
      }
    } catch { /* fall through */ }
    const ref = credentialRefFor(currentConfig());
    const envKey = process.env[ref] || process.env.MIMO_API_KEY || '';
    if (envKey) return envKey;
    return currentConfig()?.providers?.[0]?.apiKey || '';
  };

  const buildToolConfig = async () => {
    const merged = currentConfig();
    const settings = { ...merged };
    const uiBaseUrl = typeof settings.baseUrl === 'string' ? settings.baseUrl.trim() : '';
    const uiModel = typeof settings.model === 'string' ? settings.model.trim() : '';
    const primaryKey = await resolveApiKey();
    if (Array.isArray(settings.providers) && settings.providers.length > 0) {
      settings.providers = settings.providers.map((p, i) => ({
        ...p,
        apiKey: i === 0 ? primaryKey : p.apiKey,
        ...(i === 0 && uiBaseUrl !== '' ? { baseUrl: uiBaseUrl } : {}),
        ...(i === 0 && uiModel !== '' ? { model: uiModel } : {}),
      }));
    } else if (uiBaseUrl !== '') {
      settings.providers = [{ name: 'primary', baseUrl: uiBaseUrl, model: uiModel || DEFAULT_MODEL, apiKey: primaryKey }];
    }
    return normalizeConfig(settings);
  };

  let currentConfig = () => config;
  installSettingsSection(ctx, IMAGE_READ_NS, Config, config, {
    setSource: (source) => { currentConfig = source; },
    onChange: () => {},
  });

  void buildToolConfig().then((cfg) => {
    if (cfg.providers.some((p) => !p.apiKey) && typeof ctx.logger?.warn === 'function') {
      ctx.logger.warn('[image-read] No API key configured (set it in Settings → Plugins → Image Read, IMAGE_READ_*_API_KEY env var, or MIMO_API_KEY env var). read_image_mimo will fail on use.');
    }
  });
  ctx.tools.register(makeTool(() => buildToolConfig()));
}
