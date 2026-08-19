/**
 * dsh-image-read 链接安装脚本：把本插件接进 web profile。
 *
 * 等价于手工步骤：
 *   1. ~/.dsh/profiles/web/package.json 的 dependencies 增加
 *      "dsh-image-read": "link:<本目录绝对路径>"
 *   2. 同文件 dsh.profile.bundles 追加 "dsh-image-read"
 *   3. 在 profile 目录执行 pnpm install
 *
 * 用法：npm run link-profile
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_NAME = "dsh-image-read";
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));

const HOME = os.homedir();
const PROFILE_DIR = path.join(HOME, ".dsh", "profiles", "web");
const PROFILE_PKG = path.join(PROFILE_DIR, "package.json");

if (!existsSync(PROFILE_PKG)) {
  console.error(`[${PLUGIN_NAME}] 未找到 profile: ${PROFILE_PKG}`);
  process.exit(1);
}

const pkg = JSON.parse(await readFile(PROFILE_PKG, "utf8"));

// ① dependencies：link 到本目录。
pkg.dependencies ??= {};
pkg.dependencies[PLUGIN_NAME] = `link:${PLUGIN_DIR}`;

// ② bundles：追加（幂等）。
pkg.dsh ??= {};
pkg.dsh.profile ??= {};
pkg.dsh.profile.bundles ??= [];
if (!pkg.dsh.profile.bundles.includes(PLUGIN_NAME)) {
  pkg.dsh.profile.bundles.push(PLUGIN_NAME);
}

await writeFile(PROFILE_PKG, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
console.log(`[${PLUGIN_NAME}] ${PROFILE_PKG} 已更新`);

// ③ pnpm install。
const result = spawnSync("pnpm", ["install"], {
  cwd: PROFILE_DIR,
  stdio: "inherit",
  shell: false,
});
if (result.error) {
  console.error(`[${PLUGIN_NAME}] pnpm 执行失败: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`[${PLUGIN_NAME}] pnpm install 退出码 ${result.status}`);
  process.exit(result.status ?? 1);
}

console.log(`[${PLUGIN_NAME}] 链接安装完成。请手动重启 \`dsh web\` 使插件生效。`);
