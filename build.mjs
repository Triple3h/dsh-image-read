/**
 * dsh-image-read 构建脚本：esbuild 打包 src/client.js → lib/client.js。
 *
 * 客户端代码是手写的 ModuleLoader 格式（无裸 import），esbuild 在此主要
 * 承担语法校验与确定性产出；不做压缩，保持可读、可排查。
 *
 * 用法：npm install && npm run build
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

let esbuild;
try {
  esbuild = await import("esbuild");
} catch (error) {
  console.error("[dsh-image-read] esbuild 未安装，执行 `npm install` 后再构建。");
  process.exit(1);
}

const entry = path.join(root, "src", "client.js");
const outfile = path.join(root, "lib", "client.js");

const result = await esbuild.build({
  entryPoints: [entry],
  write: false,
  bundle: false,
  format: "iife",
  platform: "browser",
  target: "es2020",
  legalComments: "inline",
  logLevel: "silent",
});

const code = result.outputFiles?.[0]?.text;
if (typeof code !== "string") {
  console.error("[dsh-image-read] esbuild 无输出，构建中止。");
  process.exit(1);
}
await mkdir(path.dirname(outfile), { recursive: true });
await writeFile(outfile, code);
const { size } = await stat(outfile);
console.log(`[dsh-image-read] built lib/client.js (${size} bytes)`);
