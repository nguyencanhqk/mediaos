#!/usr/bin/env node
// harness/claim.mjs — xem/dọn sổ claim Work Order (ai-giữ-WO-nào, chung mọi worktree).
//
//   node harness/claim.mjs list            # liệt kê claim hiện có (sống/quá hạn)
//   node harness/claim.mjs prune           # xoá các claim đã quá hạn (phiên chết/bỏ)
//   node harness/claim.mjs release <WO-id> # nhả tay một claim (khi chắc phiên kia đã dừng)
//
// Cảnh báo trùng-phiên là TỰ ĐỘNG qua .claude/hooks/guard-claim.mjs; CLI này chỉ để quan sát/dọn tay.

import process from 'node:process';
import { listClaims, removeClaim, isStale, CLAIM_TTL_MS } from './lib/claims.mjs';

const [cmd, arg] = process.argv.slice(2);
const now = Date.now();
const mins = (ts) => Math.max(0, Math.round((now - ts) / 60000));

function printList() {
  const items = listClaims();
  if (!items.length) {
    console.log('(không có claim nào — không phiên nào đang giữ Work Order)');
    return items;
  }
  console.log('Work Order đang được giữ:\n');
  for (const { id, claim } of items) {
    const stale = isStale(claim, now);
    console.log(
      `  ${stale ? '🕯️ ' : '🟢'} ${id}\n` +
        `      session ${String(claim.session_id || '?').slice(0, 8)}…  branch ${claim.branch || '?'}\n` +
        `      ${claim.cwd || '?'}\n` +
        `      hoạt động ${mins(claim.ts)} phút trước${stale ? '  ← QUÁ HẠN (có thể phiên đã chết)' : ''}\n`,
    );
  }
  console.log(`(claim quá hạn sau ${CLAIM_TTL_MS / 3600000}h không hoạt động → \`prune\` để dọn)`);
  return items;
}

switch (cmd) {
  case 'list':
  case undefined:
    printList();
    break;

  case 'prune': {
    let n = 0;
    for (const { id, claim } of listClaims()) {
      if (isStale(claim, now)) {
        removeClaim(id);
        n++;
        console.log(`  ✗ xoá claim quá hạn: ${id}`);
      }
    }
    console.log(n ? `Đã dọn ${n} claim quá hạn.` : 'Không có claim quá hạn để dọn.');
    break;
  }

  case 'release': {
    if (!arg) {
      console.error('Thiếu <WO-id>. Dùng: node harness/claim.mjs release <WO-id>');
      process.exit(1);
    }
    removeClaim(arg);
    console.log(`Đã nhả claim: ${arg}`);
    break;
  }

  default:
    console.error(`Lệnh không rõ: ${cmd}\nDùng: list | prune | release <WO-id>`);
    process.exit(1);
}
