#!/usr/bin/env node
// harness/claim.mjs — xem/dọn sổ claim Work Order (ai-giữ-WO-nào, chung mọi worktree).
//
//   node harness/claim.mjs list            # liệt kê claim hiện có (sống/quá hạn)
//   node harness/claim.mjs branch          # nhóm theo branch — cảnh báo branch có >1 phiên (giẫm chân)
//   node harness/claim.mjs prune           # xoá các claim đã quá hạn (phiên chết/bỏ)
//   node harness/claim.mjs release <WO-id> # nhả tay một claim (khi chắc phiên kia đã dừng)
//
// Cảnh báo trùng-phiên là TỰ ĐỘNG qua .claude/hooks/guard-claim.mjs; CLI này chỉ để quan sát/dọn tay.

import process from "node:process";
import { listClaims, removeClaim, isStale, CLAIM_TTL_MS } from "./lib/claims.mjs";

const [cmd, arg] = process.argv.slice(2);
const now = Date.now();
const mins = (ts) => Math.max(0, Math.round((now - ts) / 60000));

function printList() {
  const items = listClaims();
  if (!items.length) {
    console.log("(không có claim nào — không phiên nào đang giữ Work Order)");
    return items;
  }
  console.log("Work Order đang được giữ:\n");
  for (const { id, claim } of items) {
    const stale = isStale(claim, now);
    console.log(
      `  ${stale ? "🕯️ " : "🟢"} ${id}\n` +
        `      session ${String(claim.session_id || "?").slice(0, 8)}…  branch ${claim.branch || "?"}\n` +
        `      ${claim.cwd || "?"}\n` +
        `      hoạt động ${mins(claim.ts)} phút trước${stale ? "  ← QUÁ HẠN (có thể phiên đã chết)" : ""}\n`,
    );
  }
  console.log(`(claim quá hạn sau ${CLAIM_TTL_MS / 3600000}h không hoạt động → \`prune\` để dọn)`);
  return items;
}

switch (cmd) {
  case "list":
  case undefined:
    printList();
    break;

  case "prune": {
    let n = 0;
    for (const { id, claim } of listClaims()) {
      if (isStale(claim, now)) {
        removeClaim(id);
        n++;
        console.log(`  ✗ xoá claim quá hạn: ${id}`);
      }
    }
    console.log(n ? `Đã dọn ${n} claim quá hạn.` : "Không có claim quá hạn để dọn.");
    break;
  }

  case "release": {
    if (!arg) {
      console.error("Thiếu <WO-id>. Dùng: node harness/claim.mjs release <WO-id>");
      process.exit(1);
    }
    removeClaim(arg);
    console.log(`Đã nhả claim: ${arg}`);
    break;
  }

  case "branch": {
    // Nhóm claim SỐNG theo branch → phát hiện branch có >1 phiên (nguy cơ giẫm chân).
    const byBranch = new Map();
    for (const { id, claim } of listClaims()) {
      if (!claim || isStale(claim, now)) continue;
      const b = claim.branch || "?";
      if (!byBranch.has(b)) byBranch.set(b, new Map());
      const sess = byBranch.get(b);
      const e = sess.get(claim.session_id) || { cwd: claim.cwd, ts: claim.ts, wos: [] };
      e.wos.push(id);
      if (claim.ts > e.ts) e.ts = claim.ts;
      sess.set(claim.session_id, e);
    }
    if (!byBranch.size) {
      console.log("(không có claim sống nào — không phiên nào đang giữ Work Order)");
      break;
    }
    for (const [b, sess] of byBranch) {
      const multi = sess.size > 1;
      console.log(
        `${multi ? "⚠️ " : "🟢"} branch ${b} — ${sess.size} phiên${multi ? "  ← GIẪM CHÂN: thống nhất AI CẦM!" : ""}`,
      );
      for (const [sid, e] of sess) {
        console.log(
          `     session ${String(sid).slice(0, 8)}…  giữ ${e.wos.join(", ")}  • ${e.cwd}  • ${mins(e.ts)}' trước`,
        );
      }
    }
    break;
  }

  default:
    console.error(`Lệnh không rõ: ${cmd}\nDùng: list | branch | prune | release <WO-id>`);
    process.exit(1);
}
