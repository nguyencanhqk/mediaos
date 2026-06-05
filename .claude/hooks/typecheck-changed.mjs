#!/usr/bin/env node
// typecheck-changed — chạy typecheck cho workspace vừa bị sửa (PostToolUse Write/Edit/MultiEdit).
// Chỉ kích hoạt với file .ts/.tsx trong apps/api · apps/web · packages/contracts.
// Giới hạn cost: chỉ typecheck đúng 1 workspace (qua pnpm --filter), không quét cả repo.
// Lỗi kiểu → exit 2 (stderr phản hồi về cho Claude để sửa ngay, không vá triệu chứng).
// Không thuộc workspace TS / không có lỗi → exit 0.

import process from "node:process";
import { spawnSync } from "node:child_process";

const TS_EXT = /\.(ts|tsx)$/i;
const SKIP_PATH = /([\\/]\.claude[\\/]|[\\/]node_modules[\\/]|[\\/]dist[\\/])/i;

// Map đoạn đường dẫn → tên workspace (pnpm filter).
const WORKSPACE = [
  { seg: /[\\/]apps[\\/]api[\\/]/i, name: "@mediaos/api" },
  { seg: /[\\/]apps[\\/]web[\\/]/i, name: "@mediaos/web" },
  { seg: /[\\/]packages[\\/]contracts[\\/]/i, name: "@mediaos/contracts" },
];

async function readStdin() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

try {
  const input = JSON.parse((await readStdin()) || "{}");
  const file = input?.tool_input?.file_path ?? "";
  if (!file || !TS_EXT.test(file) || SKIP_PATH.test(file)) process.exit(0);

  const ws = WORKSPACE.find((w) => w.seg.test(file));
  if (!ws) process.exit(0); // file TS ngoài 3 workspace → bỏ qua

  const res = spawnSync("pnpm", ["--filter", ws.name, "typecheck"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  if (res.status !== 0) {
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
    process.stderr.write(
      `\n⛔ typecheck-changed: lỗi kiểu ở ${ws.name} (sau khi sửa ${file}).\n` +
        `${out}\n\nSửa lỗi kiểu trước khi đi tiếp — đừng @ts-ignore.\n`,
    );
    process.exit(2);
  }
  process.exit(0);
} catch {
  process.exit(0); // fail-open
}
