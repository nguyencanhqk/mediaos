// S20-CHAT-UNREADNAV-1 — API GIẢ LẬP cho lượt đo trình duyệt thật. Nghe 127.0.0.1:59999 (= VITE_API_URL của dev server).
// Không dùng page.route: trên máy đo route.fulfill trong browser_run_code làm rơi kết nối Playwright MCP.
// Không bao giờ chuyển tiếp: đường chưa giả lập ⇒ 404 + ghi `unmocked` (không chạm API PROD).
// POST …/read { seq }: con trỏ đọc chỉ tiến, `unreadCount` = lastMessageSeq − lastReadSeq. Trả lời TRỄ `readDelayMs`
// (mặc định 400) để lời gọi chồng nhau thật, và đếm số lời gọi đang bay cao nhất (`maxInFlight`).
// `failRooms`: phòng nào nằm trong danh sách ⇒ POST read trả 500 (deny-path), con trỏ không tiến.
// Điều khiển: POST /__smoke/state {phase, resetLog, resetData, scenario, failRooms, readDelayMs} · GET /__smoke/log.
// Chạy (cùng thư mục): node mock-api.cjs fixtures.json
const http = require("node:http");
const fs = require("node:fs");

const F = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const PORT = 59999;
const PAGE = 50;
const fresh = (scenario) => {
  const rooms = JSON.parse(JSON.stringify(F.scenarios[scenario].rooms));
  return {
    rooms,
    readSeq: Object.fromEntries(
      Object.values(rooms).map((r) => [r.id, r.lastMessageSeq - r.unreadCount]),
    ),
  };
};
const state = {
  phase: "boot",
  scenario: "six",
  failRooms: [],
  readDelayMs: 400,
  data: fresh("six"),
  log: [],
  unmocked: [],
  inFlight: 0,
  maxInFlight: 0,
};
const env = (data) => JSON.stringify({ success: true, data, error: null });
const errEnv = (code, message) =>
  JSON.stringify({ success: false, data: null, error: { code, message } });
const roomList = () => Object.values(state.data.rooms);

function pageOf(id, q) {
  const all = F.messages[id] || [];
  const limit = Math.max(1, Math.min(100, Number(q.get("limit")) || PAGE));
  if (q.has("beforeSeq")) {
    const before = Number(q.get("beforeSeq"));
    return all.filter((m) => m.roomSeq < before).slice(-limit);
  }
  if (q.has("afterSeq")) {
    const after = Number(q.get("afterSeq"));
    return all.filter((m) => m.roomSeq > after).slice(0, limit);
  }
  return all.slice(-limit);
}

function markRead(id, body) {
  const listed = state.data.rooms[id];
  if (state.failRooms.includes(id)) return [500, errEnv("SMOKE-500", "lỗi giả lập")];
  const asked = Number(body.seq); // chatMarkReadSchema: { seq }
  const next = Math.min(
    listed.lastMessageSeq,
    Math.max(state.data.readSeq[id], Number.isFinite(asked) ? asked : 0),
  );
  state.data.readSeq[id] = next;
  state.data.rooms[id] = {
    ...listed,
    unreadCount: listed.lastMessageSeq - next,
    markedUnreadAt: null,
  };
  return [200, env({ roomId: id, lastReadSeq: next, unreadCount: listed.lastMessageSeq - next })];
}

function route(method, path, q, body) {
  if (method === "POST" && path === "/auth/refresh") return [200, env(F.refresh)];
  if (method === "GET" && path === "/auth/me") return [200, env(F.meFull)];
  if (method === "GET" && path === "/me/preferences") return [200, env(F.prefs)];
  if (method === "GET" && path === "/notifications/dropdown") return [200, env(F.dropdown)];
  if (method === "GET" && path === "/notifications/unread-count") return [200, env(F.notiUnread)];
  if (method === "GET" && path === "/notifications") return [200, env([])];
  if (method === "GET" && path === "/chat/unread-count") {
    const rs = roomList();
    return [
      200,
      env({
        total: rs.reduce((s, r) => s + r.unreadCount, 0),
        rooms: rs.filter((r) => r.unreadCount > 0).length,
      }),
    ];
  }
  if (method === "GET" && path === "/chat/rooms")
    return [200, env(q.get("archived") === "true" ? [] : roomList())];
  const m = /^\/chat\/rooms\/([^/]+)(\/[a-z-]+)?$/.exec(path);
  if (m) {
    const [, id, sub] = m;
    const listed = state.data.rooms[id];
    if (!listed) return [404, errEnv("CHAT-ERR-001", "Không tìm thấy phòng")];
    const d = F.scenarios[state.scenario].details[id];
    if (method === "GET" && !sub)
      return [200, env({ ...d, ...listed, members: d.members, myRole: d.myRole })];
    if (method === "GET" && sub === "/messages") return [200, env(pageOf(id, q))];
    if (method === "GET" && sub === "/pinned") return [200, env([])];
    if (method === "GET" && sub === "/members") return [200, env(d.members)];
    if (method === "POST" && sub === "/read") return markRead(id, body);
    if (method === "POST" && sub === "/typing") return [204, ""];
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
        if ("scenario" in p) state.scenario = p.scenario;
        if (p.resetData) state.data = fresh(state.scenario);
        if (p.resetLog) {
          state.log = [];
          state.unmocked = [];
          state.maxInFlight = 0;
        }
        for (const k of ["phase", "failRooms", "readDelayMs"]) if (k in p) state[k] = p[k];
        return reply(
          200,
          JSON.stringify({ ok: true, phase: state.phase, scenario: state.scenario }),
        );
      }
      if (url.pathname === "/__smoke/log")
        return reply(
          200,
          JSON.stringify({
            log: state.log,
            unmocked: [...new Set(state.unmocked)],
            maxInFlight: state.maxInFlight,
            inFlight: state.inFlight,
            rooms: roomList().map((r) => ({ id: r.id, unreadCount: r.unreadCount })),
          }),
        );
      const path = url.pathname.replace(/^\/api\/v1/, "");
      const entry = {
        phase: state.phase,
        method: req.method,
        path,
        query: url.search,
        body: req.method === "POST" ? body : undefined,
        at: Date.now(),
      };
      state.log.push(entry);
      const [status, payload] = route(req.method, path, url.searchParams, body || {});
      entry.status = status;
      if (req.method === "POST" && /^\/chat\/rooms\/[^/]+\/read$/.test(path)) {
        state.inFlight += 1;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
        setTimeout(() => {
          state.inFlight -= 1;
          entry.doneAt = Date.now();
          reply(status, payload);
        }, state.readDelayMs);
        return undefined;
      }
      return reply(status, payload);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock api on 127.0.0.1:${PORT}`));
