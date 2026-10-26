// S20-DASH-QUICKACTION-1 — API GIẢ LẬP cho lượt đo trình duyệt thật. Nghe 127.0.0.1:59999 (đúng VITE_API_URL của dev server).
// Lý do không dùng page.route: trên máy đo mọi route.fulfill trong browser_run_code làm rơi kết nối Playwright MCP.
// Không bao giờ chuyển tiếp: đường chưa giả lập ⇒ 404 + ghi vào `unmocked` (không chạm API thật).
// Điều khiển: POST /__smoke/state {phase, qa:"new"|"legacy", overview:"three"|"zero", att:"reject"|"ok",
//   attDelayMs, reset, resetLog} · GET /__smoke/log.
// Check-in: body parse bằng `checkInSchema` của contracts; phản hồi trễ `attDelayMs` (mặc định 1500) để đo
// trạng thái widget TRƯỚC khi server trả. `att:"reject"` ⇒ 409 đúng envelope của AllExceptionsFilter cho
// ConflictException của attendance.service (assertPeriodOpen): code RESOURCE-ERR-CONFLICT + lý do ATT.
// Chạy: node mock-api.cjs fixtures.json   (fixtures sinh bởi gen-fixtures.cjs)
const http = require("node:http");
const fs = require("node:fs");
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const C = require(ROOT + "/packages/contracts/dist/cjs/index.js");

const F = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const PORT = 59999;
const ATT_LOCKED_MSG = "Kỳ công 2026-10 đã khoá — không thể ghi/sửa công";
const initial = () => ({ checkedIn: false });
const state = {
  phase: "boot",
  qa: "new",
  overview: "three",
  att: "reject",
  attDelayMs: 1500,
  attState: initial(),
  log: [],
  unmocked: [],
};
const env = (data) => JSON.stringify({ success: true, data, error: null });
// Envelope lỗi đúng AllExceptionsFilter (apps/api/src/common/filters/all-exceptions.filter.ts).
const errEnv = (code, message, type = "HttpException") =>
  JSON.stringify({
    success: false,
    message,
    data: null,
    error: { code, message, type, details: null },
    meta: { request_id: "smoke", timestamp: new Date().toISOString() },
  });
const SLUG_TO_CODE = Object.fromEntries(Object.entries(F.slug).map(([k, v]) => [v, k]));

function widget(slug) {
  const code = SLUG_TO_CODE[slug];
  if (!code) return [404, errEnv("RESOURCE-ERR-NOT-FOUND", "widget không có")];
  // ATTENDANCE_TODAY đúng handler BE (fetchAttendanceToday): chưa có bản ghi hôm nay ⇒ status Empty, items [],
  // empty_state «Chưa có chấm công hôm nay»; đã check-in ⇒ Active với một bản ghi.
  const att = code === "ATTENDANCE_TODAY";
  const attEmpty = att && !state.attState.checkedIn;
  const data = att
    ? {
        date: F.today,
        items: attEmpty
          ? []
          : [
              {
                ...F.attWidget.pending,
                checkInAt: F.attCheckedInAt,
                status: "CheckedIn",
                attendanceStatus: "Present",
              },
            ],
        summary: { total: attEmpty ? 0 : 1 },
      }
    : F.widgetData[code];
  const qa = (state.qa === "legacy" ? F.qaLegacy : F.qaNew)[code] ?? [];
  const body = C.dashboardWidgetDataSchema.parse({
    widget_code: code,
    widget_type: "List",
    status: attEmpty ? "Empty" : "Active",
    data,
    empty_state: attEmpty ? { message: "Chưa có chấm công hôm nay" } : null,
    error_state: null,
    last_updated_at: new Date().toISOString(),
    cache: null,
    quick_actions: qa,
  });
  return [200, env(body)];
}

function checkIn(body) {
  const parsed = C.checkInSchema.safeParse(body);
  if (!parsed.success) {
    state.log[state.log.length - 1].invalid = parsed.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    return [400, errEnv("VALIDATION-ERR", "body sai shape")];
  }
  if (state.att === "reject")
    return [409, errEnv("RESOURCE-ERR-CONFLICT", ATT_LOCKED_MSG, "ConflictException")];
  state.attState.checkedIn = true;
  return [201, env(F.attRecord)];
}

const stripSource = ({ source: _s, ...t }) => t;

function route(method, path, q, body) {
  if (method === "POST" && path === "/auth/refresh") return [200, env(F.refresh)];
  if (method === "GET" && path === "/auth/me") return [200, env(F.me)];
  if (method === "GET" && path === "/me/preferences") return [200, env(F.prefs)];
  if (method === "GET" && path === "/notifications/dropdown") return [200, env(F.dropdown)];
  if (method === "GET" && path === "/notifications/unread-count") return [200, env(F.notiUnread)];
  if (method === "GET" && path === "/org/units/tree") return [200, env([])];
  if (method === "GET" && path === "/dashboard/me") return [200, env(F.view)];
  const w = path.match(/^\/dashboard\/widgets\/([a-z-]+)$/);
  if (method === "GET" && w) return widget(w[1]);
  if (method === "GET" && path === "/attendance/today")
    return [200, env(state.attState.checkedIn ? F.attTodayAfter : F.attToday.before)];
  if (method === "POST" && path === "/attendance/check-in") return checkIn(body);
  if (method === "GET" && path === "/me/overview")
    return [200, env(state.overview === "zero" ? F.overviewZero : F.overviewThree)];
  if (method === "GET" && path === "/tasks/my") return [200, env(F.tasks)];
  if (method === "GET" && path === "/tasks") {
    const overdueOnly = [...q.keys()].some((k) => /overdue/i.test(k));
    const rows = F.tasks.filter((t) => !overdueOnly || t.isOverdue).map(stripSource);
    return [200, env(rows)];
  }
  if (method === "GET" && path === "/projects") return [200, env(F.projects)];
  if (method === "GET" && path === "/hr/employees") return [200, env(F.employees)];
  // Màn đích của «Xem tất cả thông báo» · «Duyệt đơn»: danh sách rỗng là hợp lệ (z.array · leaveManagementListResponseSchema).
  if (method === "GET" && path === "/notifications") return [200, env([])];
  if (method === "GET" && path === "/leave/types") return [200, env([])];
  if (method === "GET" && path === "/leave/requests")
    return [200, env(C.leaveManagementListResponseSchema.parse(F.leaveEmpty))];
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
        if (p.reset) state.attState = initial();
        if (p.resetLog) {
          state.log = [];
          state.unmocked = [];
        }
        for (const k of ["phase", "qa", "overview", "att", "attDelayMs"])
          if (k in p) state[k] = p[k];
        return reply(200, JSON.stringify({ ok: true, phase: state.phase, qa: state.qa }));
      }
      if (url.pathname === "/__smoke/log")
        return reply(
          200,
          JSON.stringify({ log: state.log, unmocked: [...new Set(state.unmocked)] }),
        );
      const path = url.pathname.replace(/^\/api\/v1/, "");
      const entry = {
        phase: state.phase,
        method: req.method,
        path,
        query: url.search,
        body: req.method === "GET" ? undefined : body,
        at: Date.now(),
      };
      state.log.push(entry);
      const [status, payload] = route(req.method, path, url.searchParams, body || {});
      entry.status = status;
      const delay = path.startsWith("/attendance/check-") ? state.attDelayMs : 0;
      setTimeout(() => {
        entry.repliedAt = Date.now();
        reply(status, payload);
      }, delay);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock api on 127.0.0.1:${PORT}`));
