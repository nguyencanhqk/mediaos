// S20-GOAL-QUICKSTART-1 — API GIẢ LẬP cho lượt đo trình duyệt thật. Nghe 127.0.0.1:59999 (đúng VITE_API_URL của dev server).
// Lý do không dùng page.route: trên máy đo mọi route.fulfill trong browser_run_code làm rơi kết nối Playwright MCP.
// Không bao giờ chuyển tiếp: đường chưa giả lập ⇒ 404 + ghi vào `unmocked` (không chạm API thật).
// Điều khiển: POST /__smoke/state {me, phase, resetGoals, resetLog, listEmpty, meGoalsEmpty, denyPatch, patchDelayMs}
//             GET  /__smoke/log
// Chạy: node mock-api.cjs fixtures.json   (fixtures sinh bởi gen-fixtures.cjs)
const http = require("node:http");
const fs = require("node:fs");

const F = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const { ids } = F;
const PORT = 59999;
const nowIso = "2026-10-25T03:00:00.000Z";
const seedGoals = () => [{ ...F.activeGoal }, { ...F.draftGoal }];
const state = {
  me: "meOwn",
  phase: "boot",
  goals: seedGoals(),
  created: 0,
  listEmpty: false,
  meGoalsEmpty: false,
  denyPatch: false,
  patchDelayMs: 0,
  log: [],
  unmocked: [],
};
const env = (data) => JSON.stringify({ success: true, data, error: null });
const errEnv = (code, message) =>
  JSON.stringify({ success: false, data: null, error: { code, message } });
const createdId = (n) => `99999999-0000-4000-8000-${String(n).padStart(12, "0")}`;
const findGoal = (id) => state.goals.find((g) => g.id === id);

function buildGoal(b) {
  state.created += 1;
  return {
    ...F.activeGoal,
    id: createdId(state.created),
    goalCode: `G-${String(100 + state.created).padStart(4, "0")}`,
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

const GOAL_ID = /^\/goals\/([0-9a-f-]{36})$/;

function route(method, path, q, body) {
  if (method === "POST" && path === "/auth/refresh") return [200, env(F.refresh)];
  if (method === "GET" && path === "/auth/me") return [200, env(F[state.me])];
  if (method === "GET" && path === "/hr/employees") return [200, env(F.employees)];
  if (method === "GET" && path === "/hr/lookups/departments") return [200, env(F.departments)];
  if (method === "GET" && path === "/projects") return [200, env([])];
  if (method === "GET" && path === "/goals/tree")
    return [200, env(state.listEmpty ? [] : state.goals.map((g) => ({ ...g, children: [] })))];
  if (method === "GET" && path === "/goals") return [200, env(state.listEmpty ? [] : state.goals)];
  if (method === "GET" && path === "/me/goals")
    return [
      200,
      env(state.meGoalsEmpty ? [] : state.goals.filter((g) => g.employeeId === ids.ME_EMP)),
    ];
  if (method === "GET" && /^\/goals\/[^/]+\/(tasks|updates)$/.test(path)) return [200, env([])];
  const m = GOAL_ID.exec(path);
  if (method === "GET" && m) {
    const g = findGoal(m[1]);
    return g
      ? [200, env({ ...g, parent: null, childCount: 0 })]
      : [404, errEnv("GOAL-ERR-404", "Not found")];
  }
  if (method === "POST" && path === "/goals") {
    const g = buildGoal(body);
    state.goals.push(g);
    return [201, env(g)];
  }
  if (method === "PATCH" && m) {
    const g = findGoal(m[1]);
    if (!g) return [404, errEnv("GOAL-ERR-404", "Not found")];
    if (state.denyPatch) return [403, errEnv("AUTH-ERR-403", "Forbidden")];
    Object.assign(g, body, { updatedAt: nowIso });
    return [200, env(g)];
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
        if (p.resetGoals) {
          state.goals = seedGoals();
          state.created = 0;
        }
        if (p.resetLog) {
          state.log = [];
          state.unmocked = [];
        }
        for (const k of ["me", "phase", "listEmpty", "meGoalsEmpty", "denyPatch", "patchDelayMs"])
          if (k in p) state[k] = p[k];
        return reply(200, JSON.stringify({ ok: true, me: state.me, phase: state.phase }));
      }
      if (url.pathname === "/__smoke/log")
        return reply(
          200,
          JSON.stringify({
            log: state.log,
            unmocked: [...new Set(state.unmocked)],
            goals: state.goals.map((g) => ({ id: g.id, name: g.name, status: g.status })),
          }),
        );
      const path = url.pathname.replace(/^\/api\/v1/, "");
      state.log.push({
        phase: state.phase,
        method: req.method,
        path,
        query: url.search,
        body: req.method === "POST" || req.method === "PATCH" ? body : undefined,
      });
      const [status, payload] = route(req.method, path, url.searchParams, body || {});
      const delay = req.method === "PATCH" ? state.patchDelayMs : 0;
      setTimeout(() => reply(status, payload), delay);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock api on 127.0.0.1:${PORT}`));
