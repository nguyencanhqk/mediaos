// S20-GOAL-LISTURL-1 — API GIẢ LẬP cho lượt đo trình duyệt thật. Nghe 127.0.0.1:59999 (đúng VITE_API_URL của dev server).
// Lý do không dùng page.route: trên máy này mọi route.fulfill trong browser_run_code làm rơi kết nối Playwright MCP
// (đo 24/10/2026: 4/4 lượt «Connection closed»; route.abort / goto không route thì chạy).
// Không bao giờ chuyển tiếp: đường chưa giả lập ⇒ 404 + ghi vào `unmocked` (không chạm API PROD 3100).
// Điều khiển: POST /__smoke/state {me, phase, resetChildren, denyCreate, meGoalsEmpty, resetLog} · GET /__smoke/log.
// Chạy: node S20-GOAL-LISTURL-1.mock-api.cjs <fixtures.json>   (fixtures sinh bởi S20-GOAL-LISTURL-1.gen-fixtures.cjs)
const http = require("node:http");
const fs = require("node:fs");

const F = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const { ids } = F;
const PORT = 59999;
const nowIso = "2026-10-24T03:00:00.000Z";
const state = {
  me: "meManager",
  phase: "boot",
  children: [],
  denyCreate: false,
  meGoalsEmpty: false,
  log: [],
  unmocked: [],
};
const env = (data) => JSON.stringify({ success: true, data, error: null });
const errEnv = (code, message) =>
  JSON.stringify({ success: false, data: null, error: { code, message } });
const childId = (n) => `77777777-0000-4000-8000-${String(n).padStart(12, "0")}`;

function buildChild(b) {
  const n = state.children.length + 1;
  return {
    ...F.parentCore,
    id: childId(n),
    goalCode: `G-${String(n + 1).padStart(4, "0")}`,
    name: b.name,
    description: b.description ?? null,
    level: b.level,
    departmentId: b.departmentId ?? null,
    projectId: b.projectId ?? null,
    employeeId: b.employeeId ?? null,
    parentGoalId: b.parentGoalId ?? null,
    ownerEmployeeId: b.ownerEmployeeId ?? b.employeeId ?? ids.ME_EMP,
    periodType: b.periodType,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    measureType: b.measureType,
    targetValue: b.targetValue ?? null,
    currentValue: null,
    unit: b.unit ?? null,
    progressMode: b.progressMode,
    progressPercent: 0,
    weight: b.weight ?? 1,
    status: b.status ?? "Draft",
    finalizedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function route(method, path, q, body) {
  if (method === "POST" && path === "/auth/refresh") return [200, env(F.refresh)];
  if (method === "GET" && path === "/auth/me") return [200, env(F[state.me])];
  if (method === "GET" && path === "/hr/employees") return [200, env(F.employees)];
  if (method === "GET" && path === "/hr/lookups/departments") return [200, env(F.departments)];
  if (method === "GET" && path === "/projects") return [200, env([])];
  if (method === "GET" && path === `/goals/${ids.PARENT}`)
    return [200, env({ ...F.parentDetail, childCount: state.children.length })];
  if (method === "GET" && path === "/goals/tree")
    return [
      200,
      env([{ ...F.parentCore, children: state.children.map((c) => ({ ...c, children: [] })) }]),
    ];
  if (method === "GET" && path === "/goals")
    return [
      200,
      env(
        q.get("parentGoalId") === ids.PARENT ? state.children : [F.parentCore, ...state.children],
      ),
    ];
  if (method === "GET" && path === "/me/goals")
    return [200, env(state.meGoalsEmpty ? [] : [F.parentCore])];
  if (method === "GET" && /^\/goals\/[^/]+\/(tasks|updates)$/.test(path)) return [200, env([])];
  if (method === "POST" && path === "/goals") {
    if (state.denyCreate) return [403, errEnv("AUTH-ERR-403", "Forbidden")];
    const child = buildChild(body);
    state.children.push(child);
    return [201, env(child)];
  }
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
        if (p.resetChildren) state.children = [];
        if (p.resetLog) {
          state.log = [];
          state.unmocked = [];
        }
        for (const k of ["me", "phase", "denyCreate", "meGoalsEmpty"]) if (k in p) state[k] = p[k];
        return reply(200, JSON.stringify({ ok: true, me: state.me, phase: state.phase }));
      }
      if (url.pathname === "/__smoke/log")
        return reply(
          200,
          JSON.stringify({
            log: state.log,
            unmocked: [...new Set(state.unmocked)],
            children: state.children.length,
          }),
        );
      const path = url.pathname.replace(/^\/api\/v1/, "");
      state.log.push({
        phase: state.phase,
        method: req.method,
        path,
        query: url.search,
        body: req.method === "POST" ? body : undefined,
      });
      const [status, payload] = route(req.method, path, url.searchParams, body || {});
      return reply(status, payload);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock api on 127.0.0.1:${PORT}`));
