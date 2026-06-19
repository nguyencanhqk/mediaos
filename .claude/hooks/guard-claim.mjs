#!/usr/bin/env node
// guard-claim — phát hiện HAI PHIÊN cùng làm một Work Order (chống làm trùng/đè nhau).
//
// PreToolUse (Write/Edit/MultiEdit): "claim-on-touch" — phiên nào Edit khi có Work Order in_progress thì
//   nhận quyền giữ WO đó (key = WO id, sổ chung mọi worktree ở .git/mediaos-claims/). Nếu WO đã được
//   PHIÊN KHÁC còn sống giữ ⇒ CẢNH BÁO (có thể đang làm trùng). CHỈ CẢNH BÁO — luôn exit 0.
// Stop: phiên kết thúc ⇒ nhả mọi claim của chính mình (dọn sạch để phiên sau không bị cảnh báo nhầm).
//
// Phân biệt phiên = session_id (Claude Code truyền qua stdin) ⇒ bắt cả khác-worktree lẫn cùng-worktree
// khác-terminal. Fail-open tuyệt đối: thiếu git/backlog/lỗi gì → exit 0 im lặng (harness lỗi không bẫy người).

import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readClaim,
  writeClaim,
  removeClaim,
  listClaims,
  isStale,
  currentBranch,
  CLAIM_TTL_MS,
} from '../../harness/lib/claims.mjs';

async function readStdin() {
  let d = '';
  process.stdin.setEncoding('utf8');
  for await (const c of process.stdin) d += c;
  return d;
}

function minsAgo(ts) {
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
}

async function inProgressWO(cwd) {
  try {
    const { backlog } = await import(pathToFileURL(path.join(cwd, 'harness/backlog.mjs')).href);
    return backlog.find((b) => b.status === 'in_progress') ?? null;
  } catch {
    return null;
  }
}

try {
  const input = JSON.parse((await readStdin()) || '{}');
  const sid = input?.session_id || '';
  const cwd = input?.cwd || process.cwd();
  const event = input?.hook_event_name || '';

  // ── Stop: nhả claim của phiên này ──
  if (event === 'Stop' || event === 'SubagentStop') {
    if (sid) {
      for (const { id, claim } of listClaims(cwd)) {
        if (claim?.session_id === sid) removeClaim(id, cwd);
      }
    }
    process.exit(0);
  }

  // ── PreToolUse Write/Edit/MultiEdit: claim-on-touch ──
  if (!sid) process.exit(0); // không có định danh phiên → không thể phân biệt → bỏ qua
  const wo = await inProgressWO(cwd);
  if (!wo) process.exit(0); // không có WO in_progress → không có gì để claim

  const now = Date.now();
  const existing = readClaim(wo.id, cwd);
  const heldByOther = existing && existing.session_id !== sid && !isStale(existing, now);

  if (heldByOther) {
    process.stderr.write(
      `\n⚠️  guard-claim: Work Order \`${wo.id}\` (${wo.title}) ĐANG được PHIÊN KHÁC giữ:\n` +
        `   • session ${String(existing.session_id).slice(0, 8)}…  • branch ${existing.branch}  • ${existing.cwd}\n` +
        `   • hoạt động gần nhất ${minsAgo(existing.ts)} phút trước (claim hết hạn sau ${CLAIM_TTL_MS / 3600000}h không hoạt động).\n` +
        `   → Hai phiên có thể đang làm TRÙNG \`${wo.id}\`. Phối hợp/đổi Work Order trước khi tiếp tục.\n` +
        `   (Xem: \`node harness/claim.mjs list\` · nhả tay: \`node harness/claim.mjs release ${wo.id}\`)\n`,
    );
    process.exit(0); // CẢNH BÁO — không chặn
  }

  // Chưa ai giữ / claim quá hạn / chính mình giữ → ghi/refresh quyền giữ của phiên này.
  writeClaim(
    wo.id,
    { wo: wo.id, session_id: sid, branch: currentBranch(cwd), cwd, ts: now, at: new Date(now).toISOString() },
    cwd,
  );
  process.exit(0);
} catch {
  process.exit(0); // fail-open
}
