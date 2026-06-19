#!/usr/bin/env node
// harness/gen-status.mjs — STATE pillar: sinh docs/STATUS.md ("đang ở đâu, làm gì kế").
//
// Nguồn (đều là sự thật, không nhập tay):
//   - harness/backlog.mjs                       → Work Order (status/zone/done_when)
//   - git (branch · dirty · log)                → tiến độ thật
//   - apps/api/migrations/meta/_journal.json    → migration head
//
// Dùng:
//   node harness/gen-status.mjs            → ghi docs/STATUS.md
//   node harness/gen-status.mjs --focus    → in CHỈ Work Order in_progress ra stdout (init.sh gọi)
//
// Fail-soft: git/journal lỗi → vẫn ghi được STATUS với phần còn lại.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

import { backlog, meta } from './backlog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FOCUS_ONLY = process.argv.includes('--focus');

function git(cmd, fallback = '') {
  try {
    return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

function migrationHead() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/api/migrations/meta/_journal.json'), 'utf8'));
    const e = j.entries || [];
    const last = e[e.length - 1];
    return last ? { idx: last.idx, tag: last.tag, count: e.length } : null;
  } catch {
    return null;
  }
}

// readiness: 1 item 'todo' là READY nếu mọi depends_on đã 'done' (hoặc không tồn tại trong backlog).
const byId = Object.fromEntries(backlog.map((b) => [b.id, b]));
const isDone = (id) => !byId[id] || byId[id].status === 'done';
const isReady = (b) => b.status === 'todo' && (b.depends_on || []).every(isDone);

const inProgress = backlog.filter((b) => b.status === 'in_progress');
const blocked = backlog.filter((b) => b.status === 'blocked');
const ready = backlog.filter(isReady);
const waiting = backlog.filter((b) => b.status === 'todo' && !isReady(b));
const done = backlog.filter((b) => b.status === 'done');

const ZONE = { green: '🟢', yellow: '🟡', red: '🔴' };

function workOrderBlock(b) {
  const L = [];
  L.push(`### ${ZONE[b.zone] || ''} ${b.id} — ${b.title}`);
  L.push(`- **zone**: ${b.zone}${b.skills?.length ? ` · **skills**: ${b.skills.join(', ')}` : ''}`);
  if (b.paths?.length) L.push(`- **sửa ở đâu (paths)**: \`${b.paths.join('`, `')}\``);
  if (b.depends_on?.length) L.push(`- **phụ thuộc**: ${b.depends_on.map((d) => `${d}${isDone(d) ? '✓' : '⏳'}`).join(', ')}`);
  if (b.done_when?.length) {
    L.push(`- **done_when (đích hội tụ)**:`);
    b.done_when.forEach((d) => L.push(`  - [ ] ${d}`));
  }
  return L.join('\n');
}

// --focus: chỉ in Work Order đang làm (cho init.sh) rồi thoát.
if (FOCUS_ONLY) {
  if (!inProgress.length) {
    process.stdout.write('Không có Work Order nào in_progress. Item READY tiếp theo:\n');
    (ready.slice(0, 3)).forEach((b) => process.stdout.write(`  • ${b.id} — ${b.title}\n`));
  } else {
    inProgress.forEach((b) => process.stdout.write(workOrderBlock(b) + '\n\n'));
  }
  process.exit(0);
}

// ── render STATUS.md ──────────────────────────────────────────────────────────
const branch = git('rev-parse --abbrev-ref HEAD', '(unknown)');
const dirty = git('status --porcelain').split('\n').filter(Boolean);
const recent = git("log --pretty=format:'%h|%ad|%s' --date=short -12")
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    const [h, d, ...s] = l.replace(/^'|'$/g, '').split('|');
    return `| \`${h}\` | ${d} | ${s.join('|')} |`;
  });
const mig = migrationHead();
const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

const md = [];
md.push('# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)');
md.push('');
md.push(`> Sinh bởi \`harness/gen-status.mjs\` lúc **${now}Z**. Sửa tiến độ ở \`harness/backlog.mjs\`, rồi chạy lại.`);
md.push('');
md.push('## Tiêu điểm phiên (đang làm)');
md.push('');
if (inProgress.length) {
  inProgress.forEach((b) => md.push(workOrderBlock(b), ''));
} else {
  md.push('_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.');
  md.push('');
}
md.push('## Hàng đợi');
md.push('');
md.push('**READY (phụ thuộc đã xong — làm được ngay):**');
ready.length ? ready.forEach((b) => md.push(`- ${ZONE[b.zone] || ''} \`${b.id}\` ${b.title}`)) : md.push('- _(trống)_');
md.push('');
md.push('**CHỜ (kẹt phụ thuộc):**');
waiting.length
  ? waiting.forEach((b) => md.push(`- \`${b.id}\` ${b.title} ⏳ cần: ${(b.depends_on || []).filter((d) => !isDone(d)).join(', ')}`))
  : md.push('- _(trống)_');
md.push('');
if (blocked.length) {
  md.push('**🛑 BLOCKED:**');
  blocked.forEach((b) => md.push(`- \`${b.id}\` ${b.title}`));
  md.push('');
}
md.push(`**Đã xong (v2):** ${done.length ? done.map((b) => `\`${b.id}\``).join(', ') : '—'}`);
md.push('');
md.push('## Trạng thái repo');
md.push('');
md.push(`- **branch**: \`${branch}\` · **file đang đổi (dirty)**: ${dirty.length}`);
if (mig) md.push(`- **migration head**: idx ${mig.idx} — \`${mig.tag}\` (${mig.count} migration)`);
md.push(`- **nền**: ${meta.foundation}`);
md.push(`- **hướng v2**: ${meta.direction}`);
md.push('');
md.push('## Commit gần đây');
md.push('');
md.push('| sha | ngày | mô tả |');
md.push('| --- | --- | --- |');
recent.length ? md.push(...recent) : md.push('| — | — | (không đọc được git log) |');
md.push('');
md.push('---');
md.push('_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._');
md.push('');

const out = path.join(ROOT, 'docs/STATUS.md');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, md.join('\n'), 'utf8');
process.stdout.write(`✅ docs/STATUS.md đã cập nhật (${branch}, ${inProgress.length} đang làm, ${ready.length} ready).\n`);
