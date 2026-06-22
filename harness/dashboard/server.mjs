#!/usr/bin/env node
// harness/dashboard/server.mjs — máy chủ báo cáo dự án (zero-dep, node:http).
//
// Đọc CÙNG nguồn sự thật như gen-status: harness/backlog.mjs + git + _journal.json.
// Phục vụ:
//   GET /              → index.html (React app live, poll /api/status)
//   GET /api/status    → JSON trạng thái (tính lại mỗi request — LIVE khi backlog.mjs đổi)
//   GET /api/health    → { ok:true }
//
// Chạy: node harness/dashboard/server.mjs   (hoặc: pnpm dashboard)  → mở http://localhost:5180
// Cổng: PORT=xxxx node harness/dashboard/server.mjs
//
// KHÔNG đụng file nguồn, KHÔNG ghi gì — chỉ đọc + phục vụ. Cô lập ngoài workspace (apps/* · packages/*).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

import { byWorkOrder } from '../ledger.mjs'; // sổ hoạt động có timestamp (start/finish/milestone)
import { applyStatus } from '../lib/wo-state.mjs'; // status hiệu dụng = overlay ledger đè literal backlog

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.env.PORT) || 5180;

// ── helpers ───────────────────────────────────────────────────────────────────
function git(cmd, fallback = '') {
  try {
    return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

function migrationHead() {
  for (const rel of ['apps/api/migrations/meta/_journal.json', 'apps/api/drizzle/meta/_journal.json']) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      const e = j.entries || [];
      const last = e[e.length - 1];
      if (last) return { idx: last.idx, tag: last.tag, count: e.length };
    } catch {
      /* thử nguồn kế */
    }
  }
  return null;
}

// Map từ khoá → spec MVP (để "kiểm tra ở đâu" trỏ đúng tài liệu nghiệm thu).
const MODULE_SPEC = [
  { re: /(\bauth\b|login|token|2fa|đăng nhập|phân quyền|permission|acct)/i, spec: 'docs/SPEC/SPEC-02 AUTH.md' },
  { re: /(\bhr\b|nhân sự|employee|org|position|phòng ban)/i, spec: 'docs/SPEC/SPEC-03 HR.md' },
  { re: /(\batt\b|chấm công|attendance|điều chỉnh công|ca làm)/i, spec: 'docs/SPEC/SPEC-04 ATT.md' },
  { re: /(leave|nghỉ phép)/i, spec: 'docs/SPEC/SPEC-05 LEAVE.md' },
  { re: /(\btask\b|công việc|dự án|project)/i, spec: 'docs/SPEC/SPEC-06 TASK.md' },
  { re: /(dash|dashboard|báo cáo|biểu đồ)/i, spec: 'docs/SPEC/SPEC-07 DASH.md' },
  { re: /(noti|thông báo|notification)/i, spec: 'docs/SPEC/SPEC-08 NOTI.md' },
];
const specFor = (b) => {
  const hay = `${b.id} ${b.title} ${(b.paths || []).join(' ')}`;
  return (MODULE_SPEC.find((m) => m.re.test(hay)) || {}).spec || 'docs/SPEC/SPEC-01 Tổng quan.md';
};

// "Kiểm tra ở đâu / thế nào" — suy từ paths + zone của Work Order.
function verifyGuide(b) {
  const paths = b.paths || [];
  const touchesApi = paths.some((p) => p.startsWith('apps/api'));
  const feApps = [...new Set(paths.map((p) => (p.match(/^apps\/(auth|console|app|web)\b/) || [])[1]).filter(Boolean))];
  const commands = [];
  // Tầng kiểm chứng theo zone: đỏ → --all (gồm build) trước khi mở PR.
  commands.push(b.zone === 'red' ? 'bash harness/check.sh --all' : 'bash harness/check.sh');
  if (touchesApi) {
    commands.push(`bash scripts/lane-db-setup.sh ${b.id.toLowerCase()}  # DB cô lập (chống shared-DB drift)`);
    commands.push(`export LANE_DB=mediaos_${b.id.toLowerCase()} && pnpm --filter @mediaos/api test`);
  }
  feApps.forEach((a) => commands.push(`pnpm --filter @mediaos/${a} test && pnpm --filter @mediaos/${a} typecheck`));
  const testGlobs = paths
    .map((p) => p.replace(/\*+.*$/, '').replace(/\/$/, ''))
    .filter(Boolean)
    .map((p) => `${p}/**/*.spec.ts*`);
  return {
    spec: specFor(b),
    commands,
    testGlobs: [...new Set(testGlobs)].slice(0, 8),
    note:
      b.zone === 'red'
        ? 'Vùng ĐỎ: deny-path test RED trước · FULL gate · NGƯỜI chốt trước merge (không auto-commit).'
        : 'Xanh khi check XANH + done_when đủ → có thể auto-commit / mở PR auto-merge (cần 1 review người).',
  };
}

async function computeStatus() {
  // Import lại có cache-bust để LIVE khi backlog.mjs vừa đổi (ESM cache theo URL).
  const mod = await import(`../backlog.mjs?u=${Date.now()}`);
  const { meta } = mod;
  // status hiệu dụng: đè overlay từ ledger (đọc activity.jsonl MỚI mỗi request ⇒ board tự nhảy khi có start/finish).
  const backlog = applyStatus(mod.backlog);

  const byId = Object.fromEntries(backlog.map((b) => [b.id, b]));
  const isDone = (id) => !byId[id] || byId[id].status === 'done';
  const isReady = (b) => b.status === 'todo' && (b.depends_on || []).every(isDone);

  const workOrders = backlog.map((b) => ({
    id: b.id,
    title: b.title,
    zone: b.zone,
    status: b.status,
    module: b.module || null,
    layer: b.layer || null,
    ready: isReady(b),
    dependsOn: (b.depends_on || []).map((d) => ({ id: d, done: isDone(d) })),
    doneWhen: b.done_when || [],
    paths: b.paths || [],
    skills: b.skills || [],
    verify: verifyGuide(b),
  }));

  const total = backlog.length;
  const done = backlog.filter((b) => b.status === 'done').length;
  const inProgress = backlog.filter((b) => b.status === 'in_progress');
  const ready = backlog.filter(isReady);
  const waiting = backlog.filter((b) => b.status === 'todo' && !isReady(b));
  const blocked = backlog.filter((b) => b.status === 'blocked');

  const dirty = git('status --porcelain').split('\n').filter(Boolean);
  const commits = git("log --pretty=format:'%h|%ad|%s' --date=short -10")
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, date, ...s] = l.replace(/^'|'$/g, '').split('|');
      return { sha, date, subject: s.join('|') };
    });

  // ── Sổ rủi ro cơ bản (server) — agent project-analyst làm bản sâu ──────────────
  const risks = [];
  if (!inProgress.length && ready.length) {
    risks.push({ level: 'info', message: `Không có việc đang làm nhưng ${ready.length} việc READY — chọn 1 để mở.` });
  }
  if (inProgress.length > 1) {
    risks.push({ level: 'warn', message: `${inProgress.length} việc in_progress cùng lúc — mô hình v2 khuyến nghị tuần tự 1/phiên.` });
  }
  inProgress.forEach((b) => {
    if (b.zone === 'red') risks.push({ level: 'warn', message: `Việc ĐỎ đang mở (${b.id}) — cần người chốt, KHÔNG auto-commit.` });
  });
  ready.forEach((b) => {
    if (b.zone === 'red') risks.push({ level: 'info', message: `Việc ĐỎ chờ làm (${b.id}) — chuẩn bị FULL gate + người duyệt.` });
  });
  // phụ thuộc trỏ tới id không tồn tại
  backlog.forEach((b) =>
    (b.depends_on || []).forEach((d) => {
      if (!byId[d]) risks.push({ level: 'warn', message: `${b.id} phụ thuộc \`${d}\` KHÔNG tồn tại trong backlog — kẹt vĩnh viễn.` });
    }),
  );
  if (dirty.length > 60) {
    risks.push({ level: 'warn', message: `${dirty.length} file dirty — diff lớn, khó review/red-zone dễ lẫn. Cân nhắc chia nhỏ.` });
  }
  if (dirty.some((l) => /drizzle|_journal|migration/i.test(l))) {
    risks.push({ level: 'warn', message: 'Có thay đổi migration trong dirty — vùng ĐỎ, RLS+FORCE phải trước backfill.' });
  }
  blocked.forEach((b) => risks.push({ level: 'warn', message: `BLOCKED: ${b.id} — ${b.title}` }));

  return {
    generatedAt: new Date().toISOString(),
    project: meta.project,
    direction: meta.direction,
    progress: {
      total,
      done,
      pct: total ? Math.round((done / total) * 100) : 0,
      inProgress: inProgress.length,
      ready: ready.length,
      waiting: waiting.length,
      blocked: blocked.length,
    },
    repo: { branch: git('rev-parse --abbrev-ref HEAD', '(unknown)'), dirty: dirty.length, migration: migrationHead(), commits },
    workOrders,
    risks,
    activity: byWorkOrder(), // dòng thời gian từng WO: startedAt/finishedAt/durationMs/status/events
  };
}

// ── basic auth ────────────────────────────────────────────────────────────────
// Bật khi đặt DASH_PASS (qua env của service). KHÔNG đặt → mở (tiện chạy local).
// Secret KHÔNG nằm trong code/repo — service NSSM cấp qua env.
const AUTH_USER = process.env.DASH_USER || 'admin';
const AUTH_PASS = process.env.DASH_PASS || '';

function safeEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false; // độ dài khác → khỏi so timing-safe
  return crypto.timingSafeEqual(ab, bb);
}

function authzOk(req) {
  if (!AUTH_PASS) return true; // chưa cấu hình → không gate
  const m = /^Basic\s+(.+)$/i.exec(req.headers['authorization'] || '');
  if (!m) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return false;
  }
  const i = decoded.indexOf(':');
  const u = i >= 0 ? decoded.slice(0, i) : '';
  const p = i >= 0 ? decoded.slice(i + 1) : '';
  return safeEqual(u, AUTH_USER) && safeEqual(p, AUTH_PASS);
}

function sendUnauthorized(res) {
  res.writeHead(401, {
    'www-authenticate': 'Basic realm="MediaOS dashboard", charset="UTF-8"',
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify({ error: 'unauthorized' }));
}

// ── docs (tra cứu tài liệu) ────────────────────────────────────────────────────
// Liệt kê + phục vụ file trong docs/ — chỉ-đọc, chống path-traversal, whitelist đuôi.
const DOCS_DIR = path.join(ROOT, 'docs');
const DOC_EXT = new Set(['.md', '.mdx', '.txt', '.yaml', '.yml', '.json', '.mmd', '.mermaid', '.csv']);
const DOC_MAX_BYTES = 4 * 1024 * 1024; // trần 4MB — chống đọc file khổng lồ

function listDocs() {
  const out = [];
  const walk = (dir) => {
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && DOC_EXT.has(path.extname(e.name).toLowerCase())) {
        let size = 0;
        try {
          size = fs.statSync(abs).size;
        } catch {
          /* bỏ qua file không stat được */
        }
        out.push({ path: path.relative(DOCS_DIR, abs).split(path.sep).join('/'), size });
      }
    }
  };
  walk(DOCS_DIR);
  out.sort((a, b) => a.path.localeCompare(b.path, 'vi'));
  return { files: out, count: out.length };
}

function serveDocRaw(req, res) {
  let rel = '';
  try {
    rel = new URL(req.url, 'http://localhost').searchParams.get('path') || '';
  } catch {
    return send(res, 400, JSON.stringify({ error: 'bad url' }));
  }
  if (!rel || rel.includes('\0')) return send(res, 400, JSON.stringify({ error: 'bad path' }));
  const abs = path.resolve(DOCS_DIR, rel);
  // BẮT BUỘC nằm trong docs/ — chống traversal (../, đường dẫn tuyệt đối, symlink-escape).
  if (abs !== DOCS_DIR && !abs.startsWith(DOCS_DIR + path.sep)) return send(res, 403, JSON.stringify({ error: 'forbidden' }));
  if (!DOC_EXT.has(path.extname(abs).toLowerCase())) return send(res, 415, JSON.stringify({ error: 'unsupported type' }));
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return send(res, 404, JSON.stringify({ error: 'not found' }));
  }
  if (!st.isFile()) return send(res, 404, JSON.stringify({ error: 'not a file' }));
  if (st.size > DOC_MAX_BYTES) return send(res, 413, JSON.stringify({ error: 'file too large' }));
  let body = '';
  try {
    body = fs.readFileSync(abs, 'utf8');
  } catch {
    return send(res, 500, JSON.stringify({ error: 'read fail' }));
  }
  return send(res, 200, body, 'text/plain; charset=utf-8');
}

// ── server ──────────────────────────────────────────────────────────────────
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  try {
    const url = (req.url || '/').split('?')[0];
    if (url === '/api/health') return send(res, 200, JSON.stringify({ ok: true }));
    if (!authzOk(req)) return sendUnauthorized(res);
    if (url === '/api/status') return send(res, 200, JSON.stringify(await computeStatus()));
    if (url === '/api/docs') return send(res, 200, JSON.stringify(listDocs()));
    if (url === '/api/docs/raw') return serveDocRaw(req, res);
    if (url === '/' || url === '/index.html') {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    return send(res, 404, JSON.stringify({ error: 'not found' }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ error: String(e && e.message ? e.message : e) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`\n  📊 MediaOS dashboard → http://localhost:${PORT}\n  (Ctrl+C để dừng · LIVE: tự đọc lại backlog.mjs mỗi lần poll)\n\n`);
});
