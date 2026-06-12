#!/usr/bin/env node
// guard-migration-band — ép band migration riêng theo lane (TASKS.md §5.2).
// PreToolUse hook cho Write/Edit/MultiEdit.
// BLOCK (exit 2): tạo file migration .sql có số NGOÀI band của branch hiện tại (tránh collision song song).
// WARN  (exit 0): sửa meta/_journal.json — nhắc idx/when phải đơn điệu tăng + reconcile khi merge.
// Fail-open: không xác định được lane (master/branch lạ) hoặc không phải file migration → exit 0.

import process from "node:process";
import { execSync } from "node:child_process";

// Lane → [min,max] số migration (TASKS.md §5.2). Master kết thúc ở 0037.
const BANDS = {
  g8: [80, 89],
  g9: [40, 49],
  g10: [50, 59],
  g11: [60, 69],
  g12: [90, 99],
  g13: [70, 79],
  g14: [100, 109],
  g15: [110, 119],
  g16: [120, 129],
};

const MIGRATION_SQL = /[\\/]migrations[\\/](\d{4})_[^\\/]*\.sql$/i;
const JOURNAL = /[\\/]migrations[\\/]meta[\\/]_journal\.json$/i;

async function readStdin() {
  let d = "";
  process.stdin.setEncoding("utf8");
  for await (const c of process.stdin) d += c;
  return d;
}

function laneFromBranch() {
  try {
    const b = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = b.match(/g(\d+)/i);
    return m ? "g" + m[1] : null;
  } catch {
    return null;
  }
}

function pad4(n) {
  return String(n).padStart(4, "0");
}

try {
  const input = JSON.parse((await readStdin()) || "{}");
  const file = input?.tool_input?.file_path ?? "";

  if (JOURNAL.test(file)) {
    process.stderr.write(
      `\n⚠️  guard-migration-band WARN: đang sửa meta/_journal.json.\n` +
        `   TASKS.md §5.2: idx/when phải ĐƠN ĐIỆU TĂNG trong band; khi merge nhiều lane reconcile theo thứ tự merge.\n`,
    );
    process.exit(0);
  }

  const mm = file.match(MIGRATION_SQL);
  if (!mm) process.exit(0);

  const lane = laneFromBranch();
  if (!lane || !BANDS[lane]) process.exit(0); // master / branch lạ → fail-open

  const num = parseInt(mm[1], 10);
  const [lo, hi] = BANDS[lane];
  if (num < lo || num > hi) {
    process.stderr.write(
      `\n⛔ guard-migration-band BLOCK trong ${file}\n` +
        `   Lane ${lane.toUpperCase()} chỉ được đánh số migration trong band ${pad4(lo)}–${pad4(hi)}.\n` +
        `   Số ${mm[1]} NGOÀI band → nguy cơ collision với lane khác (TASKS.md §5.2).\n` +
        `   → Đổi tên file về band của lane này (vd: ${pad4(lo)}_...).\n`,
    );
    process.exit(2);
  }
  process.exit(0);
} catch {
  process.exit(0); // fail-open: hook không bao giờ làm hỏng phiên
}
