// S20-TASK-QUICKADD-1 — API GIẢ LẬP cho lượt đo trình duyệt thật. Nghe 127.0.0.1:59999 (đúng VITE_API_URL của dev server).
// Lý do không dùng page.route: trên máy đo mọi route.fulfill trong browser_run_code làm rơi kết nối Playwright MCP.
// Không bao giờ chuyển tiếp: đường chưa giả lập ⇒ 404 + ghi vào `unmocked` (không chạm API thật).
// POST /tasks: thân parse bằng `createTaskCoreSchema` (.strict) của contracts trong cây đang đo — sai shape ⇒ 400
// và ghi `invalid` vào log. Người phụ trách = ids.EMP.X (ngoài phạm vi) ⇒ 403 TASK-ERR-TASK-ASSIGNEE-OUT-OF-SCOPE.
// Điều khiển: POST /__smoke/state {me, phase, reset, resetLog} · GET /__smoke/log.
// Chạy: node mock-api.cjs fixtures.json   (fixtures sinh bởi gen-fixtures.cjs)
const http = require("node:http");
const fs = require("node:fs");
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const C = require(ROOT + "/packages/contracts/dist/cjs/index.js");

const F = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const { ids } = F;
const PORT = 59999;
const nowIso = "2026-10-22T03:00:00.000Z";
const clone = (v) => JSON.parse(JSON.stringify(v));
const state = {
  me: "meNv",
  phase: "boot",
  tasks: clone(F.tasks),
  board: clone(F.board),
  seq: 0,
  log: [],
  unmocked: [],
};
const env = (data) => JSON.stringify({ success: true, data, error: null });
const errEnv = (code, message) =>
  JSON.stringify({ success: false, data: null, error: { code, message } });
const employeeName = (id) => {
  const e = F.employees.items.find((x) => x.id === id);
  return e ? e.fullName : null;
};

function createTask(body) {
  const parsed = C.createTaskCoreSchema.safeParse(body);
  if (!parsed.success) {
    state.log[state.log.length - 1].invalid = parsed.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    return [400, errEnv("TASK-ERR-VALIDATION", "TASK-ERR-VALIDATION: body sai shape")];
  }
  const b = parsed.data;
  if (b.assigneeEmployeeId === ids.EMP.X.id) {
    const code = "TASK-ERR-TASK-ASSIGNEE-OUT-OF-SCOPE";
    return [403, errEnv(code, `${code}: người phụ trách ngoài phạm vi`)];
  }
  state.seq += 1;
  const id = `cccccccc-0000-4000-8000-${String(state.seq).padStart(12, "0")}`;
  const col = b.stateId ? state.board.columns.find((c) => c.stateId === b.stateId) : null;
  const assignee = b.assigneeEmployeeId ?? null;
  const task = C.taskCoreResponseSchema.parse({
    id,
    companyId: ids.CO,
    title: b.title,
    description: b.description ?? null,
    taskType: "task",
    status: col && col.stateGroup === "started" ? "In Progress" : "Todo",
    priority: b.priority ?? "Medium",
    projectId: b.projectId ?? null,
    projectName: b.projectId ? F.project.name : null,
    mainAssigneeEmployeeId: assignee,
    assigneeName: assignee ? employeeName(assignee) : null,
    assigneeAvatarUrl: null,
    coverUrl: null,
    creatorUserId: ids.ME,
    creatorName: "Trần Tôi",
    reporterEmployeeId: ids.ME_EMP,
    reporterName: "Trần Tôi",
    departmentId: ids.DEPT,
    dueAt: b.dueAt ?? null,
    startAt: null,
    completedAt: null,
    isOverdue: false,
    createdBy: ids.ME,
    createdAt: nowIso,
    updatedAt: nowIso,
    stateId: col ? col.stateId : null,
    stateName: col ? col.name : null,
    stateColor: col ? col.color : null,
    stateGroup: col ? col.stateGroup : null,
  });
  if (assignee === ids.ME_EMP) state.tasks.push({ ...task, source: "assigned" });
  if (col) {
    col.tasks.push({ ...task });
    col.taskCount = col.tasks.length;
  }
  return [201, env(task)];
}

function route(method, path, q, body) {
  if (method === "POST" && path === "/auth/refresh") return [200, env(F.refresh)];
  if (method === "GET" && path === "/auth/me") return [200, env(F[state.me])];
  if (method === "GET" && path === "/me/preferences") return [200, env(F.prefs)];
  if (method === "GET" && path === "/notifications/dropdown") return [200, env(F.dropdown)];
  if (method === "GET" && path === "/notifications/unread-count") return [200, env(F.notiUnread)];
  if (method === "GET" && path === "/tasks/my") return [200, env(state.tasks)];
  if (method === "GET" && path === "/tasks") return [200, env(state.tasks)];
  if (method === "POST" && path === "/tasks") return createTask(body);
  const P = `/projects/${ids.PROJ}`;
  if (method === "GET" && path === P) return [200, env(F.project)];
  if (method === "GET" && path === `${P}/kanban`) return [200, env(state.board)];
  if (method === "GET" && path === `${P}/members`) return [200, env(F.members)];
  if (method === "GET" && path === "/hr/employees") return [200, env(F.employees)];
  // Thanh bên «Dự án» đọc cây phòng ban; cây rỗng là hợp lệ (`orgTreeResponseSchema` = mảng).
  if (method === "GET" && path === "/org/units/tree") return [200, env([])];
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
        if (p.reset) {
          state.tasks = clone(F.tasks);
          state.board = clone(F.board);
        }
        if (p.resetLog) {
          state.log = [];
          state.unmocked = [];
        }
        for (const k of ["me", "phase"]) if (k in p) state[k] = p[k];
        return reply(200, JSON.stringify({ ok: true, me: state.me, phase: state.phase }));
      }
      if (url.pathname === "/__smoke/log")
        return reply(
          200,
          JSON.stringify({ log: state.log, unmocked: [...new Set(state.unmocked)] }),
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
      state.log[state.log.length - 1].status = status;
      reply(status, payload);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock api on 127.0.0.1:${PORT}`));
