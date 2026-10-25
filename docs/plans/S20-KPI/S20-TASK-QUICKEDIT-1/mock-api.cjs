// S20-TASK-QUICKEDIT-1 — API GIẢ LẬP cho lượt đo trình duyệt thật. Nghe 127.0.0.1:59999 (đúng VITE_API_URL của dev server).
// Lý do không dùng page.route: trên máy đo mọi route.fulfill trong browser_run_code làm rơi kết nối Playwright MCP.
// Không bao giờ chuyển tiếp: đường chưa giả lập ⇒ 404 + ghi vào `unmocked` (không chạm API thật).
// Điều khiển: POST /__smoke/state {me, phase, resetTasks, resetLog, actionDelayMs} · GET /__smoke/log.
// Chạy: node mock-api.cjs fixtures.json   (fixtures sinh bởi gen-fixtures.cjs)
const http = require("node:http");
const fs = require("node:fs");

const F = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const PORT = 59999;
const nowIso = "2026-10-22T03:00:00.000Z";
const fresh = () => F.tasks.map((t) => ({ ...t }));
const state = {
  me: "meFull",
  phase: "boot",
  tasks: fresh(),
  actionDelayMs: 0,
  log: [],
  unmocked: [],
};
const env = (data) => JSON.stringify({ success: true, data, error: null });
const errEnv = (code, message) =>
  JSON.stringify({ success: false, data: null, error: { code, message } });
const ACTION = /^\/tasks\/([0-9a-f-]{36})\/(change-status|change-deadline)$/;

function applyAction(id, kind, body) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return [404, errEnv("TASK-ERR-NOT-FOUND", "not found")];
  if (kind === "change-status") {
    t.status = body.status;
    t.completedAt = body.status === "Done" ? nowIso : null;
    if (body.status === "Done" || body.status === "Cancelled") t.isOverdue = false;
  } else {
    t.dueAt = body.dueAt ?? null;
    t.isOverdue = false;
  }
  t.updatedAt = nowIso;
  return [200, env({ task: { ...t }, warnings: [] })];
}

function route(method, path, q, body) {
  if (method === "POST" && path === "/auth/refresh") return [200, env(F.refresh)];
  if (method === "GET" && path === "/auth/me") return [200, env(F[state.me])];
  if (method === "GET" && path === "/me/preferences") return [200, env(F.prefs)];
  if (method === "GET" && path === "/notifications/dropdown") return [200, env(F.dropdown)];
  if (method === "GET" && path === "/notifications/unread-count") return [200, env(F.notiUnread)];
  if (method === "GET" && path === "/tasks/my") return [200, env(state.tasks)];
  if (method === "GET" && path === "/tasks") return [200, env(state.tasks)];
  const m = ACTION.exec(path);
  if (method === "POST" && m) return applyAction(m[1], m[2], body);
  state.unmocked.push(`${state.phase} ${method} ${path}${q.toString() ? `?${q}` : ""}`);
  return [404, errEnv("SMOKE-404", "not mocked")];
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const cors = {
      "Access-Control-Allow-Origin": req.headers.origin || "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] || "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const reply = (status, payload) => {
        res.writeHead(status, { ...cors, "Content-Type": "application/json" });
        res.end(payload);
      };
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      if (url.pathname === "/__smoke/state") {
        const p = body || {};
        if (p.resetTasks) state.tasks = fresh();
        if (p.resetLog) {
          state.log = [];
          state.unmocked = [];
        }
        for (const k of ["me", "phase", "actionDelayMs"]) if (k in p) state[k] = p[k];
        return reply(200, JSON.stringify({ ok: true, me: state.me, phase: state.phase }));
      }
      if (url.pathname === "/__smoke/log")
        return reply(
          200,
          JSON.stringify({
            log: state.log,
            unmocked: [...new Set(state.unmocked)],
            tasks: state.tasks,
          }),
        );
      const path = url.pathname.replace(/^\/api\/v1/, "");
      state.log.push({
        phase: state.phase,
        method: req.method,
        path,
        query: url.search,
        body: req.method === "GET" ? undefined : body,
      });
      const [status, payload] = route(req.method, path, url.searchParams, body || {});
      const delay = ACTION.test(path) ? state.actionDelayMs : 0;
      setTimeout(() => reply(status, payload), delay);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock api on 127.0.0.1:${PORT}`));
