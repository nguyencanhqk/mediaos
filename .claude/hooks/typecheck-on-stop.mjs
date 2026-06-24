#!/usr/bin/env node
// typecheck-on-stop — chạy typecheck cho các workspace BỊ ĐỔI, MỘT LẦN khi Claude dừng phiên (Stop hook).
// Thay cho typecheck-changed (PostToolUse) vốn chạy sau MỖI edit và chặn giữa chừng khi
// sửa nhiều file phụ thuộc nhau (trạng thái dở dang luôn đỏ → exit 2 → kẹt).
//
// Suy ra workspace bị đổi từ git (tracked + untracked), chỉ typecheck đúng các workspace đó.
// Lỗi kiểu → exit 2 (stderr phản hồi về cho Claude để sửa). Sạch / không đổi gì TS → exit 0.

import process from "node:process";
import { spawnSync } from "node:child_process";

const WORKSPACE = [
  { seg: /^apps\/api\//i, name: "@mediaos/api" },
  { seg: /^apps\/web\//i, name: "@mediaos/web" },
  { seg: /^packages\/contracts\//i, name: "@mediaos/contracts" },
];
const TS_EXT = /\.(ts|tsx)$/i;

function changedFiles() {
  const res = spawnSync("git", ["status", "--porcelain", "-z"], {
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  if (res.status !== 0 || !res.stdout) return [];
  // -z: mỗi entry "XY <path>\0"; rename có 2 path nhưng đủ dùng cho mục đích phát hiện workspace.
  return res.stdout
    .split("\0")
    .filter(Boolean)
    .map((e) => e.slice(3).trim())
    .filter((p) => TS_EXT.test(p));
}

try {
  // Stop hook fail-open: nuốt stdin nếu có.
  try {
    process.stdin.resume();
    process.stdin.on("data", () => {});
  } catch {}

  const files = changedFiles();
  const targets = WORKSPACE.filter((w) => files.some((f) => w.seg.test(f)));
  if (targets.length === 0) process.exit(0);

  const failures = [];
  for (const ws of targets) {
    const res = spawnSync("pnpm", ["--filter", ws.name, "typecheck"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      encoding: "utf8",
    });
    if (res.status !== 0) {
      failures.push(`${ws.name}:\n${`${res.stdout ?? ""}${res.stderr ?? ""}`.trim()}`);
    }
  }

  if (failures.length > 0) {
    process.stderr.write(
      `\n⛔ typecheck-on-stop: lỗi kiểu ở workspace bị đổi.\n\n` +
        failures.join("\n\n") +
        `\n\nSửa lỗi kiểu trước khi kết thúc — đừng @ts-ignore.\n`,
    );
    process.exit(2);
  }
  process.exit(0);
} catch {
  process.exit(0); // fail-open
}
