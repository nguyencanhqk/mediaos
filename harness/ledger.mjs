#!/usr/bin/env node
// harness/ledger.mjs — SỔ HOẠT ĐỘNG (activity ledger) append-only, có dấu thời gian.
//
// Ghi mốc vòng đời từng Work Order để THEO DÕI: giờ bắt đầu · mốc quan trọng · giờ hoàn thành · thời lượng.
// Append-only (KHÔNG sửa/xoá dòng cũ — đúng tinh thần bảng audit). Một dòng = một sự kiện JSON.
//
// Nguồn ghi: agent `progress-tracker` (và auto-loop qua agent đó). Người/agent đều gọi được.
//
// CLI:
//   node harness/ledger.mjs start  <WO> [chi tiết...]      # mốc bắt đầu
//   node harness/ledger.mjs done   <WO> [outcome...]       # mốc hoàn thành/dừng
//   node harness/ledger.mjs event  <WO> <type> [chi tiết]  # mốc bất kỳ (milestone/blocked/verified...)
//   node harness/ledger.mjs timeline [WO]                  # render dòng thời gian (người đọc)
//   node harness/ledger.mjs json [WO]                      # JSON gộp theo WO (dashboard đọc)
//   node harness/ledger.mjs tail [n]                        # n sự kiện gần nhất
//
// Lib: import { appendEvent, readEvents, byWorkOrder } from './ledger.mjs'

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LEDGER_PATH = path.join(__dirname, 'activity.jsonl');

const TERMINAL = new Set(['finished', 'pr_opened', 'committed', 'needs_human', 'stopped_red', 'evaluate_block', 'stopped', 'done', 'skipped']);

// ── Lib ─────────────────────────────────────────────────────────────────────
export function appendEvent(ev) {
  const row = { ts: new Date().toISOString(), ...ev };
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(row) + '\n', 'utf8');
  return row;
}

export function readEvents() {
  try {
    return fs
      .readFileSync(LEDGER_PATH, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Gộp sự kiện theo Work Order → { wo, startedAt, finishedAt, durationMs, status, events[] }
export function byWorkOrder(filterWo) {
  const evs = readEvents().filter((e) => !filterWo || e.wo === filterWo);
  const map = new Map();
  for (const e of evs) {
    if (!map.has(e.wo)) map.set(e.wo, { wo: e.wo, startedAt: null, finishedAt: null, status: 'unknown', events: [] });
    const g = map.get(e.wo);
    g.events.push(e);
    if (e.type === 'started' && !g.startedAt) g.startedAt = e.ts;
    if (TERMINAL.has(e.type)) {
      g.finishedAt = e.ts;
      g.status = e.type === 'finished' ? e.detail || 'finished' : e.type;
    } else if (e.type !== 'started') {
      g.status = `đang ${e.type}`;
    } else {
      g.status = 'đang chạy';
    }
  }
  for (const g of map.values()) {
    if (g.startedAt && g.finishedAt) g.durationMs = new Date(g.finishedAt) - new Date(g.startedAt);
  }
  return [...map.values()];
}

// ── Render ────────────────────────────────────────────────────────────────────
const hhmm = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { hour12: false }) : '—');
const dur = (ms) => {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m${s % 60}s` : `${Math.floor(m / 60)}h${m % 60}m`;
};

function renderTimeline(wo) {
  const groups = byWorkOrder(wo).sort((a, b) => (a.startedAt || a.events[0].ts).localeCompare(b.startedAt || b.events[0].ts));
  if (!groups.length) return '(sổ hoạt động trống — chưa có mốc nào ghi)';
  const out = [];
  for (const g of groups) {
    out.push(`\n● ${g.wo}  [${g.status}]${g.durationMs != null ? `  ⏱ ${dur(g.durationMs)}` : ''}`);
    out.push(`  bắt đầu : ${hhmm(g.startedAt)}`);
    for (const e of g.events.filter((e) => !['started'].includes(e.type))) {
      out.push(`   · ${hhmm(e.ts)}  ${e.type}${e.detail ? ' — ' + e.detail : ''}${e.by ? `  (${e.by})` : ''}`);
    }
    if (g.finishedAt) out.push(`  hoàn thành: ${hhmm(g.finishedAt)}`);
  }
  return out.join('\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const wo = rest[0];
  switch (cmd) {
    case 'start':
      console.log(JSON.stringify(appendEvent({ wo, type: 'started', detail: rest.slice(1).join(' ') || undefined, by: process.env.LEDGER_BY })));
      break;
    case 'done':
      console.log(JSON.stringify(appendEvent({ wo, type: 'finished', detail: rest.slice(1).join(' ') || undefined, by: process.env.LEDGER_BY })));
      break;
    case 'event':
      console.log(JSON.stringify(appendEvent({ wo, type: rest[1], detail: rest.slice(2).join(' ') || undefined, by: process.env.LEDGER_BY })));
      break;
    case 'json':
      process.stdout.write(JSON.stringify(byWorkOrder(wo), null, 2) + '\n');
      break;
    case 'tail': {
      const n = Number(wo) || 20;
      readEvents()
        .slice(-n)
        .forEach((e) => console.log(`${hhmm(e.ts)}  ${e.wo}  ${e.type}${e.detail ? ' — ' + e.detail : ''}`));
      break;
    }
    case 'timeline':
    default:
      console.log(renderTimeline(wo));
  }
}
