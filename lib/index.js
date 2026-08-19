/**
 * dsh-image-read — DeepSeek Harness plugin (v0.4.0).
 *
 * Two capabilities in one plugin:
 *   A. Structured image analysis (read_image_mimo tool) — multi-provider
 *      failover, schema-validated output, result caching, SSRF protection,
 *      key redaction, Web UI config card.
 *   B. Attachment input server — batches, staging, ownership markers, cleanup;
 *      powers the paste / drag-drop / select-file client UI.
 */

// ── A. Vision imports ───────────────────────────────────────────────────────
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

// ── B. Attachment imports ──────────────────────────────────────────────────
import {
  access, mkdir, open, readdir, readFile, rename, rm, writeFile,
} from 'node:fs/promises';
import {
  basename, dirname, extname, isAbsolute, join, relative, resolve, sep,
} from 'node:path';

const execFileAsync = promisify(execFile);

// ============================================================================
//  A. Cordis plugin metadata (vision tool)
// ============================================================================

export const name = 'image-read';
export const inject = ['tools', 'settings', 'webServer', 'loader', 'sessions'];

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
  attachments: z.object({
    maxFileBytes: z.number().step(1).min(1),
    maxBatchBytes: z.number().step(1).min(1),
    maxFiles: z.number().step(1).min(1),
    maxDepth: z.number().step(1).min(1),
    maxConcurrentUploads: z.number().step(1).min(1),
  }),
});

/** Default credential ref — derived from the first provider's name. */
export function credentialRefFor(config) {
  const name = config?.providers?.[0]?.name;
  if (name) return `IMAGE_READ_${name.toUpperCase()}_API_KEY`;
  return 'MIMO_API_KEY';
}

// ============================================================================
//  A. Defaults
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

/**
 * callVisionApi POSTs straight at the provider baseUrl, but configs conventionally
 * spell the API root (…/v1). Append the completions path when it is missing so
 * both spellings work.
 */
function normalizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

// ============================================================================
//  A. Structured output schema
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
//  A. Prompt helpers
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
//  A. Schema validation
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
  // Fill defaults for missing optional fields instead of throwing
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
//  A. Cache
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
//  A. SSRF protection
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
//  A. Image helpers
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
//  A. Secret redaction
// ============================================================================

function redactSecrets(text, secrets = []) {
  let result = text;
  for (const secret of secrets) { if (secret) result = result.replaceAll(secret, '***'); }
  return result;
}

// ============================================================================
//  A. Provider execution
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
//  A. Image isolation
// ============================================================================

async function isolateImage(source) {
  const workdir = path.join(tmpdir(), `dsh-image-read-iso-${randomUUID()}`);
  mkdirSync(workdir, { recursive: true });
  try {
    const imageSource = path.join(workdir, path.basename(source));
    copyFileSync(source, imageSource);
    return { imageSource, cleanup: () => rmSync(workdir, { recursive: true, force: true }) };
  } catch (err) { rmSync(workdir, { recursive: true, force: true }); throw err; }
}

// ============================================================================
//  A. Core: read image with failover chain + caching
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
            // MiMo sometimes returns plain prose instead of JSON — wrap it
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
//  A. Config normalization
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
//  A. Tool definition
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
//  B. Attachment server — batches, staging, ownership, cleanup
// ============================================================================

const ATT_API_ROOT = '/dsh-image-read/attachments/v1';
const ATT_OWNER_FILE = '.dsh-image-read-attachment.json';
const ATT_SOURCE = 'dsh-image-read';
const DEFAULT_ATT_LIMITS = Object.freeze({
  maxFileBytes: 1024 ** 3, maxBatchBytes: 2 * 1024 ** 3, maxFiles: 10_000, maxDepth: 64, maxConcurrentUploads: 4,
});

function attJson(res, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  res.writeHead(status, { 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body), 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function attError(res, status, code, message) { attJson(res, status, { ok: false, error: { code, message } }); }

function attHeader(headers, name) { const v = headers[name]; return typeof v === 'string' ? v : undefined; }

function attAuthority(value) { try { return new URL(`http://${value}`); } catch { return undefined; } }

function attCanonicalAuthority(raw, parsed) {
  const port = parsed.port !== '' ? parsed.port : new URL(`https://${raw}`).port;
  return port === '' ? parsed.hostname : `${parsed.hostname}:${port}`;
}

function attIsLoopback(hostname) {
  const h = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  return h === 'localhost' || h === '::1' || h === '127.0.0.1' || h.startsWith('127.');
}

function attTrustedRequest(req, trustedHosts) {
  const host = attHeader(req.headers, 'host');
  if (host === undefined) return false;
  const parsedHost = attAuthority(host);
  if (parsedHost === undefined) return false;
  const listed = trustedHosts.some((entry) => {
    const p = attAuthority(entry);
    if (p === undefined) return false;
    return attCanonicalAuthority(entry, p) === p.hostname ? p.hostname === parsedHost.hostname : p.host === parsedHost.host;
  });
  if (!attIsLoopback(parsedHost.hostname) && !listed) return false;
  if (attHeader(req.headers, 'sec-fetch-site') === 'cross-site') return false;
  const origin = attHeader(req.headers, 'origin');
  if (origin === undefined) return true;
  try { return new URL(origin).host === parsedHost.host; } catch { return false; }
}

async function attReadJson(req, maxBytes = 1024 * 1024) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw new Error(`JSON body exceeds ${maxBytes} bytes`); parts.push(chunk); }
  return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
}

function attSourceTrustedHosts(ctx) {
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name !== '@deepseek-ai/dsh-client-connection') continue;
    const value = entry.fiber?.config?.trustedHosts;
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value;
  }
  return [];
}

function attSessionDirectoryName(sessionId) {
  const slug = sessionId.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 48) || 'session';
  return `${slug}-${createHash('sha256').update(sessionId).digest('hex').slice(0, 12)}`;
}

function attRawSegments(p) {
  if (typeof p !== 'string' || p === '' || p.includes('\0')) throw new Error('attachment path must be a non-empty string');
  const n = p.replaceAll('\\', '/');
  if (n.startsWith('/') || /^[A-Za-z]:\//.test(n)) throw new Error(`attachment path must be relative: ${JSON.stringify(p)}`);
  const parts = n.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) throw new Error(`attachment path contains an unsafe segment: ${JSON.stringify(p)}`);
  return parts;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function attSafeSegment(segment) {
  let next = segment.normalize('NFC').replace(/[<>:"|?*\u0000-\u001f\\]/g, '_');
  if (process.platform === 'win32') {
    next = next.replace(/[. ]+$/g, (m) => '_'.repeat(m.length));
    if (WINDOWS_RESERVED.test(next)) next = `_${next}`;
  }
  if (next === '' || next === '.' || next === '..') next = '_';
  return next;
}

function attAppendCollisionSuffix(p, index) {
  const ext = extname(p);
  return join(dirname(p), `${basename(p, ext)}~${index}${ext}`);
}

function attMapFiles(files, limits) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('at least one file is required');
  if (files.length > limits.maxFiles) throw new Error(`file count exceeds ${limits.maxFiles}`);
  const rawPaths = new Set();
  const allocatedFiles = new Set([process.platform === 'win32' ? ATT_OWNER_FILE.toLowerCase() : ATT_OWNER_FILE]);
  const allocatedDirectories = new Set();
  const rows = [];
  let totalBytes = 0;
  for (const [index, input] of files.entries()) {
    if (typeof input !== 'object' || input === null) throw new Error(`file ${index} is not an object`);
    const parts = attRawSegments(input.path);
    if (parts.length > limits.maxDepth) throw new Error(`file ${index} exceeds depth ${limits.maxDepth}`);
    const rawPath = parts.join('/');
    if (rawPaths.has(rawPath)) throw new Error(`duplicate attachment path: ${rawPath}`);
    for (const existing of rawPaths) {
      if (existing.startsWith(`${rawPath}/`) || rawPath.startsWith(`${existing}/`)) throw new Error(`file/directory attachment path conflict: ${existing} and ${rawPath}`);
    }
    rawPaths.add(rawPath);
    if (!Number.isSafeInteger(input.size) || input.size < 0 || input.size > limits.maxFileBytes) throw new Error(`file ${rawPath} has invalid or excessive size`);
    totalBytes += input.size;
    if (totalBytes > limits.maxBatchBytes) throw new Error(`batch exceeds ${limits.maxBatchBytes} bytes`);
    let actualPath = parts.map(attSafeSegment).join('/');
    let collision = 1;
    const collisionKey = (v) => process.platform === 'win32' ? v.toLowerCase() : v;
    const parentKeys = (v) => v.split('/').slice(0, -1).map((_, i) => collisionKey(v.split('/').slice(0, i + 1).join('/')));
    while (allocatedFiles.has(collisionKey(actualPath)) || allocatedDirectories.has(collisionKey(actualPath))) {
      actualPath = attAppendCollisionSuffix(actualPath, collision++).split(sep).join('/');
    }
    const parents = parentKeys(actualPath);
    if (parents.some((parent) => allocatedFiles.has(parent))) throw new Error(`cross-platform filename mapping creates a file/directory conflict: ${rawPath}`);
    allocatedFiles.add(collisionKey(actualPath));
    for (const parent of parents) allocatedDirectories.add(collisionKey(parent));
    rows.push({ index, originalPath: rawPath, actualPath, size: input.size, type: typeof input.type === 'string' ? input.type.slice(0, 256) : '', lastModified: Number.isFinite(input.lastModified) ? Number(input.lastModified) : undefined });
  }
  return { rows, totalBytes };
}

function attEnsureInside(root, target) {
  const rel = relative(root, target);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return;
  throw new Error(`resolved attachment path escapes its root: ${target}`);
}

function attCurrentSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') throw new Error('sessionId is required');
  const session = ctx.sessions.get(sessionId);
  if (session === undefined) throw new Error(`live session not found: ${sessionId}`);
  const cwd = session.header.cwd;
  if (typeof cwd !== 'string' || cwd === '') throw new Error(`session has no workspace cwd: ${sessionId}`);
  return { session, cwd: resolve(cwd) };
}

async function attWriteRequest(req, target, expectedBytes) {
  await mkdir(dirname(target), { recursive: true });
  const handle = await open(target, 'wx');
  let received = 0;
  try {
    for await (const chunk of req) {
      received += chunk.length;
      if (received > expectedBytes) throw new Error('upload body exceeds declared file size');
      await handle.write(chunk);
    }
    if (received !== expectedBytes) throw new Error(`upload body size mismatch: expected ${expectedBytes}, received ${received}`);
    await handle.sync();
  } catch (cause) {
    await handle.close().catch(() => {});
    await rm(target, { force: true }).catch(() => {});
    throw cause;
  }
  await handle.close();
}

async function attOwnedSends(sessionRoot, expectedSessionId) {
  let entries;
  try { entries = await readdir(sessionRoot, { withFileTypes: true }); }
  catch (cause) { if (cause?.code === 'ENOENT') return []; throw cause; }
  const owned = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.staging') continue;
    const directory = join(sessionRoot, entry.name);
    try {
      const marker = JSON.parse(await readFile(join(directory, ATT_OWNER_FILE), 'utf8'));
      if (marker?.owner === ATT_SOURCE && marker?.version === 1 && (expectedSessionId === undefined || marker.sessionId === expectedSessionId)) {
        owned.push({ directory, bytes: Number.isSafeInteger(marker.totalBytes) && marker.totalBytes >= 0 ? marker.totalBytes : 0, files: Array.isArray(marker.files) ? marker.files.length : 0 });
      }
    } catch { /* not ours */ }
  }
  return owned;
}

function attSessionAttachmentsRoot(cwd, sessionId) {
  return join(cwd, '.dsh', 'tmp', 'attachments', attSessionDirectoryName(sessionId));
}

function attWorkspaceAttachmentsRoot(cwd) { return join(cwd, '.dsh', 'tmp', 'attachments'); }

async function attWorkspaceOwnedSends(root) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (cause) { if (cause?.code === 'ENOENT') return { sessionDirectories: 0, sends: [] }; throw cause; }
  const sends = [];
  let sessionDirectories = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.staging') continue;
    const sessionRoot = join(root, entry.name);
    attEnsureInside(root, sessionRoot);
    const owned = await attOwnedSends(sessionRoot);
    if (owned.length === 0) continue;
    sessionDirectories += 1;
    sends.push(...owned);
  }
  return { sessionDirectories, sends };
}

function attUsageOf(owned) {
  return { sends: owned.length, files: owned.reduce((s, r) => s + r.files, 0), bytes: owned.reduce((s, r) => s + r.bytes, 0) };
}

/**
 * Register the attachment upload server on the DSH webServer.
 * Called from the main apply() — keeps paste-input's protocol self-contained.
 */
export function applyAttachments(ctx, config = {}) {
  const limits = { ...DEFAULT_ATT_LIMITS, ...(config.attachments ?? {}) };
  const batches = new Map();

  const abortBatch = async (batch) => {
    batches.delete(batch.id);
    await rm(batch.stagingRoot, { force: true, recursive: true });
  };

  const route = async (req, res) => {
    const trustedHosts = attSourceTrustedHosts(ctx);
    if (!attTrustedRequest(req, trustedHosts)) { attError(res, 403, 'forbidden', 'request failed the DSH Host/Origin trust fence'); return; }
    const url = new URL(req.url ?? '/', 'http://dsh.internal');
    const suffix = url.pathname.slice(ATT_API_ROOT.length);
    try {
      if (req.method === 'GET' && suffix === '/health') { attJson(res, 200, { ok: true, plugin: ATT_SOURCE, protocol: 1 }); return; }

      if (req.method === 'POST' && suffix === '/batches') {
        const input = await attReadJson(req);
        const { cwd } = attCurrentSession(ctx, input.sessionId);
        await access(cwd);
        const mapped = attMapFiles(input.files, limits);
        const id = randomUUID();
        const sessionKey = attSessionDirectoryName(input.sessionId);
        const attachmentsRoot = join(cwd, '.dsh', 'tmp', 'attachments');
        const stagingRoot = join(attachmentsRoot, '.staging', id);
        attEnsureInside(attachmentsRoot, stagingRoot);
        await mkdir(stagingRoot, { recursive: true });
        const batch = { id, sessionId: input.sessionId, sessionKey, cwd, attachmentsRoot, stagingRoot, files: mapped.rows, totalBytes: mapped.totalBytes, uploaded: new Set(), activeUploads: 0, createdAt: new Date().toISOString() };
        batches.set(id, batch);
        attJson(res, 201, { ok: true, batchId: id, files: batch.files.map((f) => ({ index: f.index, actualPath: f.actualPath })) });
        return;
      }

      const fileMatch = /^\/batches\/([^/]+)\/files\/(\d+)$/.exec(suffix);
      if (req.method === 'PUT' && fileMatch !== null) {
        const batch = batches.get(fileMatch[1]);
        if (batch === undefined) throw new Error('unknown or expired upload batch');
        attCurrentSession(ctx, batch.sessionId);
        const index = Number(fileMatch[2]);
        const file = batch.files[index];
        if (file === undefined) throw new Error(`unknown file index ${index}`);
        if (batch.uploaded.has(index)) throw new Error(`file index ${index} was already uploaded`);
        if (batch.activeUploads >= limits.maxConcurrentUploads) { attError(res, 429, 'too-many-uploads', 'too many concurrent attachment uploads'); return; }
        const declared = Number(attHeader(req.headers, 'content-length'));
        if (!Number.isSafeInteger(declared) || declared !== file.size) throw new Error(`Content-Length must equal declared file size ${file.size}`);
        const target = resolve(batch.stagingRoot, file.actualPath);
        attEnsureInside(batch.stagingRoot, target);
        batch.activeUploads += 1;
        try { await attWriteRequest(req, target, file.size); batch.uploaded.add(index); }
        finally { batch.activeUploads -= 1; }
        attJson(res, 200, { ok: true, index });
        return;
      }

      const commitMatch = /^\/batches\/([^/]+)\/commit$/.exec(suffix);
      if (req.method === 'POST' && commitMatch !== null) {
        const batch = batches.get(commitMatch[1]);
        if (batch === undefined) throw new Error('unknown or expired upload batch');
        attCurrentSession(ctx, batch.sessionId);
        if (batch.activeUploads !== 0) throw new Error('uploads are still in progress');
        if (batch.uploaded.size !== batch.files.length) throw new Error(`batch is incomplete: ${batch.uploaded.size}/${batch.files.length} files uploaded`);
        const sendId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
        const sessionRoot = join(batch.attachmentsRoot, batch.sessionKey);
        const finalRoot = join(sessionRoot, sendId);
        attEnsureInside(batch.attachmentsRoot, finalRoot);
        const marker = { owner: ATT_SOURCE, version: 1, sessionId: batch.sessionId, createdAt: batch.createdAt, committedAt: new Date().toISOString(), totalBytes: batch.totalBytes, files: batch.files.map(({ index, originalPath, actualPath, size, type, lastModified }) => ({ index, originalPath, actualPath, size, type, lastModified })) };
        await writeFile(join(batch.stagingRoot, ATT_OWNER_FILE), `${JSON.stringify(marker, null, 2)}\n`, { flag: 'wx' });
        await mkdir(sessionRoot, { recursive: true });
        await rename(batch.stagingRoot, finalRoot);
        batches.delete(batch.id);
        attJson(res, 200, { ok: true, root: finalRoot, manifest: join(finalRoot, ATT_OWNER_FILE), files: batch.files.map((f) => ({ originalPath: f.originalPath, actualPath: f.actualPath, absolutePath: join(finalRoot, ...f.actualPath.split('/')), size: f.size })) });
        return;
      }

      const abortMatch = /^\/batches\/([^/]+)$/.exec(suffix);
      if (req.method === 'DELETE' && abortMatch !== null) {
        const batch = batches.get(abortMatch[1]);
        if (batch !== undefined) await abortBatch(batch);
        attJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && suffix === '/usage/session') {
        const input = await attReadJson(req);
        const { cwd } = attCurrentSession(ctx, input.sessionId);
        const owned = await attOwnedSends(attSessionAttachmentsRoot(cwd, input.sessionId), input.sessionId);
        attJson(res, 200, { ok: true, ...attUsageOf(owned) });
        return;
      }

      if (req.method === 'POST' && suffix === '/usage/workspace') {
        const input = await attReadJson(req);
        const { cwd } = attCurrentSession(ctx, input.sessionId);
        const owned = await attWorkspaceOwnedSends(attWorkspaceAttachmentsRoot(cwd));
        attJson(res, 200, { ok: true, sessionDirectories: owned.sessionDirectories, ...attUsageOf(owned.sends) });
        return;
      }

      if (req.method === 'POST' && suffix === '/cleanup/session') {
        const input = await attReadJson(req);
        const { cwd } = attCurrentSession(ctx, input.sessionId);
        const root = attSessionAttachmentsRoot(cwd, input.sessionId);
        const owned = await attOwnedSends(root, input.sessionId);
        for (const row of owned) { attEnsureInside(root, row.directory); await rm(row.directory, { force: true, recursive: true }); }
        attJson(res, 200, { ok: true, deletedSends: owned.length, deletedFiles: owned.reduce((s, r) => s + r.files, 0), deletedBytes: owned.reduce((s, r) => s + r.bytes, 0) });
        return;
      }

      if (req.method === 'POST' && suffix === '/cleanup/workspace') {
        const input = await attReadJson(req);
        const { cwd } = attCurrentSession(ctx, input.sessionId);
        const root = attWorkspaceAttachmentsRoot(cwd);
        const owned = await attWorkspaceOwnedSends(root);
        for (const row of owned.sends) { attEnsureInside(root, row.directory); await rm(row.directory, { force: true, recursive: true }); }
        attJson(res, 200, { ok: true, deletedSessionDirectories: owned.sessionDirectories, deletedSends: owned.sends.length, deletedFiles: owned.sends.reduce((s, r) => s + r.files, 0), deletedBytes: owned.sends.reduce((s, r) => s + r.bytes, 0) });
        return;
      }

      attError(res, 404, 'not-found', 'unknown attachment endpoint');
    } catch (cause) {
      attError(res, 400, 'attachment-request-failed', cause instanceof Error ? cause.message : String(cause));
    }
  };

  // Register all effects
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ATT_API_ROOT, handler: route }),
    'dsh-image-read: attachment upload route',
  );
  ctx.effect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 60 * 60 * 1000;
      for (const batch of batches.values()) {
        if (batch.activeUploads !== 0 || Date.parse(batch.createdAt) >= cutoff) continue;
        void abortBatch(batch).catch((c) => ctx.logger?.warn?.(c));
      }
    }, 10 * 60 * 1000);
    interval.unref?.();
    return () => clearInterval(interval);
  }, 'dsh-image-read: abandoned batch TTL');
  ctx.effect(() => async () => {
    const active = [...batches.values()];
    batches.clear();
    await Promise.all(active.map((b) => rm(b.stagingRoot, { force: true, recursive: true })));
  }, 'dsh-image-read: staging cleanup');
}

// ============================================================================
//  Main plugin entry — applies vision tool + attachment server
// ============================================================================

export function apply(ctx, config = {}) {
  // --- B. Attachment server (register first; independent of vision) -----
  applyAttachments(ctx, config);

  // --- A. Vision tool (settings + tool registration) ----------------------
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
    // The tool resolves its config per call via buildToolConfig(), so settings
    // changes need no re-registration — ctx.tools.register() throws on
    // duplicate tool names, which would kill this fiber and roll the settings
    // namespace back (the dsh-skill-hub pattern: register once, read live).
    onChange: () => {},
  });

  void buildToolConfig().then((cfg) => {
    if (cfg.providers.some((p) => !p.apiKey) && typeof ctx.logger?.warn === 'function') {
      ctx.logger.warn('[image-read] No API key configured (set it in Settings → Plugins → Image Read, IMAGE_READ_*_API_KEY env var, or MIMO_API_KEY env var). read_image_mimo will fail on use.');
    }
  });
  ctx.tools.register(makeTool(() => buildToolConfig()));
}
