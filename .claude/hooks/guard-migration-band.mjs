#!/usr/bin/env node
// guard-migration-band — ép band migration riêng theo lane (TASKS.md §5.2).
// PreToolUse hook cho Write/Edit/MultiEdit.
// BLOCK (exit 2): tạo file migration .sql có số NGOÀI band của branch hiện tại (tránh collision song song).
// WARN  (exit 0): sửa meta/_journal.json — nhắc idx/when phải đơn điệu tăng + reconcile khi merge.
// Fail-open: không xác định được lane (master/branch lạ) hoặc không phải file migration → exit 0.

import process from "node:process";
import { execSync } from "node:child_process";

// Lane → danh sách band [min,max] số migration (TASKS.md §5.2). Master kết thúc ở 0037.
// Mỗi lane có thể có NHIỀU band rời nhau khi band gốc đầy (G12: 0090–0099 đầy → tràn 0130–0139).
const BANDS = {
  // G2 RLS hardening (g2rls — GX-4 PgBouncer × RLS, force-before-backfill fix). Nền tảng G2 có trước hệ
  // thống band (master kết thúc 0037) nên không có band gốc; lane bổ sung này cấp band riêng 0160–0169
  // (sau G3 mutation 0140–0149 — KHÔNG đụng band lane khác). TASKS.md §5.2.
  g2: [[160, 169]],
  // G3 mutation-path (runtime permission mgmt — grant/revoke role + object-permission). Nền tảng G3
  // có trước hệ thống band (master kết thúc 0037) nên không có band gốc; lane bổ sung này cấp band
  // riêng 0140–0149 (sau G12 tràn 0130–0139 — KHÔNG đụng band lane khác). TASKS.md §5.2.
  g3: [[140, 149]],
  g8: [[80, 89]],
  g9: [[40, 49]],
  g10: [[50, 59]],
  g11: [[60, 69]],
  // G12 band gốc 0090–0099 ĐẦY (G12-1..G12-3). G12-4 Duyệt bảng lương tràn sang band riêng
  // 0130–0139 (sau G16 0120s — KHÔNG đụng band lane khác). TASKS.md §5.2.
  g12: [
    [90, 99],
    [130, 139],
  ],
  g13: [[70, 79]],
  g14: [[100, 109]],
  g15: [[110, 119]],
  // G16 band gốc 0120–0129 (G16-1 hardening / G16-2 perf). G16-3 SaaS prep tràn sang band riêng
  // 0230–0239 (sau B4 0190s + C2 0220s — KHÔNG đụng band lane khác). TASKS.md §5.2.
  g16: [
    [120, 129],
    [230, 239],
  ],
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
  const ranges = BANDS[lane];
  const inBand = ranges.some(([lo, hi]) => num >= lo && num <= hi);
  if (!inBand) {
    const bandList = ranges.map(([lo, hi]) => `${pad4(lo)}–${pad4(hi)}`).join(", ");
    const firstLo = ranges[ranges.length - 1][0]; // band mới nhất (gợi ý đánh số tiếp)
    process.stderr.write(
      `\n⛔ guard-migration-band BLOCK trong ${file}\n` +
        `   Lane ${lane.toUpperCase()} chỉ được đánh số migration trong band ${bandList}.\n` +
        `   Số ${mm[1]} NGOÀI band → nguy cơ collision với lane khác (TASKS.md §5.2).\n` +
        `   → Đổi tên file về band của lane này (vd: ${pad4(firstLo)}_...).\n`,
    );
    process.exit(2);
  }
  process.exit(0);
} catch {
  process.exit(0); // fail-open: hook không bao giờ làm hỏng phiên
}
