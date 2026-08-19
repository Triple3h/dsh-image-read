# dsh-image-read

DeepSeek Harness 原生插件：用多模态模型识图，返回结构化 JSON 证据。

**与 modlens 对比**：不依赖 `(modlens vision)` 模型变体，直接通过工具调用传图片路径，任何模型都能用。

## 功能

- `general` 通用识图 / `ocr` 专注文字提取 / 多图对比
- **结构化输出**：summary + ocr (full_text + lines) + layout (regions with type/reading_order) + uncertainty
- **Provider 故障转移**：配多个 provider，一个失败自动切下一个
- **结果缓存**：本地文件缓存 1 小时，失败冷却 60 秒
- **SSRF 防护**：拦截私有 IP、保留主机名、DNS 重绑定检测
- **大图自动压缩**（`sips`，默认 `>1024px` 缩放）
- **全透明 PNG 本地预检**（IDAT alpha 扫描）
- **API Key 脱敏**：报错中自动替换 key 和 URL 为 `***`
- **指数退避重试**：429 / 5xx / 超时 / 网络错误，1s/2s/4s

## 工具名

`read_image_mimo`

## 安装（web profile）

1. `~/.dsh/profiles/web/package.json` 增加依赖和 bundle 条目
2. `pnpm install`
3. 重启 web 宿主

## 配置

在 `cordis.patch.yml` 的 `config` 下配置 provider 链：

```yaml
config:
  providers:
    - name: mimo
      baseUrl: 'https://api.xiaomimimo.com/v1'
      apiKey: 'sk-...'
      model: 'mimo-v2.5'
    # 可选 fallback
    - name: dashscope
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
      apiKey: 'sk-...'
      model: 'qwen3-vl-plus'
  timeoutMs: 120000
  maxImageDimension: 1024
```

兼容旧版单 provider 配置（`baseUrl` / `apiKey` / `model` 放在顶层）。

## 输出格式

```json
{
  "summary": "图片核心内容描述",
  "ocr": {
    "full_text": "图中所有文字...",
    "lines": [{"text": "第一行", "language": "zh"}]
  },
  "layout": {
    "regions": [
      {"type": "title", "reading_order": 1, "text": "标题文字"},
      {"type": "paragraph", "reading_order": 2, "text": "正文..."}
    ]
  },
  "uncertainness": ["模糊处说明"]
}
```

## 本地冒烟

```bash
MIMO_API_KEY=sk-xxx node --input-type=module -e "
import('./lib/index.js').then(async (m) => {
  const r = await m.readImage(
    { image_path: '/tmp/test.png', mode: 'general' },
    undefined,
    { providers: [{ name: 'test', baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: process.env.MIMO_API_KEY, model: 'mimo-v2.5' }], timeoutMs: 120000, maxImageDimension: 1024 }
  );
  console.log(JSON.stringify(r, null, 2));
});
"
```
