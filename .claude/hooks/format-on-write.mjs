#!/usr/bin/env node
// format-on-write — tự chạy Prettier sau khi Write/Edit/MultiEdit (PostToolUse).
// Chỉ format file mã nguồn/cấu hình; bỏ qua .claude/, node_modules/, dist/.
// Fail-open: lỗi prettier không chặn luồng (exit 0), chỉ ghi cảnh báo.

import process from "node:process";
import { spawnSync } from "node:child_process";

const FMT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|md|yml|yaml|html)$/i;
const SKIP_PATH = /([\\/]\.claude[\\/]|[\\/]node_modules[\\/]|[\\/]dist[\\/])/i;

async function readStdin() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

try {
  const input = JSON.parse((await readStdin()) || "{}");
  const file = input?.tool_input?.file_path ?? "";
  if (!file || !FMT_EXT.test(file) || SKIP_PATH.test(file)) process.exit(0);

  const res = spawnSync("npx", ["prettier", "--write", file], {
    stdio: ["ignore", "ignore", "pipe"],
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  if (res.status !== 0 && res.stderr) {
    process.stderr.write(`⚠️  format-on-write: prettier bỏ qua ${file}\n`);
  }
  process.exit(0);
} catch {
  process.exit(0); // fail-open
}
