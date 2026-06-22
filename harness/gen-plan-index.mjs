#!/usr/bin/env node
// harness/gen-plan-index.mjs — SINH docs/plans/INDEX.md: bảng TỔNG QUAN Work Order đang hành.
//
// Vì sao: backlog.mjs là nguồn máy-đọc nhưng KHÓ nhìn tổng quan; micro-plan rải ở docs/plans/<id>.md.
// Script này gom: mỗi WO → sprint · zone · trạng thái (overlay ledger) · ĐÃ có micro-plan file chưa.
// → 1 trang để mắt người nắm "đang ở đâu, WO nào đã có plan tái dùng, WO nào còn trống".
//
// KHÔNG nhân bản 112 story (IMPLEMENTATION-02 §7 đã giữ roadmap đầy đủ) — chỉ phản ánh WO SPRINT HÀNH
// trong backlog.mjs (đúng pull-sprint, chống bloat). Roadmap đầy đủ: trỏ về IMPLEMENTATION-02.
//
// Chạy: node harness/gen-plan-index.mjs   (tự ghi docs/plans/INDEX.md, idempotent)

import { existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backlog } from './backlog.mjs';
import { applyStatus, statusOverlay } from './lib/wo-state.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Đường dẫn micro-plan của 1 WO: con trỏ `plan` tường minh > mặc định docs/plans/<id>.md.
export const planPathOf = (wo) => wo.plan || `docs/plans/${wo.id}.md`;

// Sprint suy từ tiền tố id (S0-* → Sprint 0…) — quy ước ISSUE-BOARD §8. Không khớp → 'Khác'.
const sprintOf = (id) => {
  const m = /^S(\d+)-/.exec(id);
  return m ? `Sprint ${m[1]}` : 'Khác';
};

const ZONE_ICON = { green: '🟢', yellow: '🟡', red: '🔴' };
const STATUS_ICON = { todo: '⬜ chờ', in_progress: '🔵 đang làm', done: '✅ xong', blocked: '🔴 chặn' };

function render() {
  const ov = statusOverlay();
  const bl = applyStatus(backlog, ov);
  const byId = Object.fromEntries(bl.map((b) => [b.id, b]));
  const isDone = (id) => !byId[id] || byId[id].status === 'done';

  // Gom theo sprint, giữ thứ tự xuất hiện trong backlog.
  const groups = new Map();
  for (const b of bl) {
    const s = sprintOf(b.id);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(b);
  }

  const lines = [];
  lines.push('# INDEX — Tổng quan Work Order đang hành');
  lines.push('');
  lines.push('> **TỰ SINH** bởi `harness/gen-plan-index.mjs` — KHÔNG sửa tay (chạy lại sau khi đổi backlog/ledger/plan).');
  lines.push('> Nguồn: `harness/backlog.mjs` (WO) + `activity.jsonl` (trạng thái) + `docs/plans/<id>.md` (micro-plan).');
  lines.push('> Roadmap đầy đủ 112 story / 7 sprint: **IMPLEMENTATION-02 §7** (KHÔNG nhân bản ở đây — pull-sprint).');
  lines.push('');

  // Tổng kết
  const total = bl.length;
  const withPlan = bl.filter((b) => existsSync(resolve(REPO, planPathOf(b)))).length;
  const cnt = (st) => bl.filter((b) => b.status === st).length;
  lines.push(
    `**${total} WO** · có micro-plan: **${withPlan}/${total}** · ` +
      `⬜ ${cnt('todo')} chờ · 🔵 ${cnt('in_progress')} đang làm · ✅ ${cnt('done')} xong · 🔴 ${cnt('blocked')} chặn`,
  );
  lines.push('');

  for (const [sprint, items] of groups) {
    lines.push(`## ${sprint}`);
    lines.push('');
    lines.push('| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const b of items) {
      const rel = planPathOf(b);
      const hasPlan = existsSync(resolve(REPO, rel)) ? `[📄](${rel.replace(/^docs\/plans\//, '')})` : '— *(chưa)*';
      const ready = (b.depends_on || []).length === 0 ? '—' : (b.depends_on || []).map((d) => `${isDone(d) ? '✅' : '⏳'}${d}`).join(' ');
      const title = (b.title || '').replace(/\|/g, '\\|').slice(0, 70);
      lines.push(`| \`${b.id}\` | ${ZONE_ICON[b.zone] || b.zone} | ${STATUS_ICON[b.status] || b.status} | ${hasPlan} | ${ready} | ${title} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('**Quy ước micro-plan** (tái dùng qua auto-loop): mỗi WO có file `docs/plans/<id>.md` với frontmatter máy-đọc');
  lines.push('(`lanes/acceptanceChecks/testTasks/steps`) + phần prose reconcile. Auto-loop đọc plan nếu có (reconcile-refresh),');
  lines.push('chưa có thì tạo + lưu. Xem file mẫu: `docs/plans/S0-FND-DB-1-reconcile.md`.');
  lines.push('');
  return lines.join('\n');
}

const out = resolve(REPO, 'docs/plans/INDEX.md');
writeFileSync(out, render(), 'utf8');
console.log(`✅ docs/plans/INDEX.md sinh xong (${backlog.length} WO).`);
