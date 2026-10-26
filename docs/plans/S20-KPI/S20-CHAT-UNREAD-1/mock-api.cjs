// S20-CHAT-UNREAD-1 — API GIẢ LẬP cho lượt đo trình duyệt thật. Nghe 127.0.0.1:59999 (= VITE_API_URL của dev server).
// Không dùng page.route: trên máy đo route.fulfill trong browser_run_code làm rơi kết nối Playwright MCP.
// Không bao giờ chuyển tiếp: đường chưa giả lập ⇒ 404 + ghi `unmocked` (không chạm API PROD).
// GET /chat/rooms/:id/messages theo đúng trang của server: `limit` (mặc định 50) · `beforeSeq` · `afterSeq`, tăng dần.
// POST …/read { seq }: con trỏ đọc chỉ tiến, `unreadCount` = lastMessageSeq − lastReadSeq.
// Điều khiển: POST /__smoke/state {phase, resetLog, resetData, live: {roomId, seq}} · GET /__smoke/log.
// Chạy (cùng thư mục): node mock-api.cjs fixtures.json
const http = require("node:http");
const fs = require("node:fs");

const F = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const PORT = 59999;
const PAGE = 50;
const BASE_MESSAGES = JSON.stringify(F.messages);
const fresh = () => ({
  messages: JSON.parse(BASE_MESSAGES),
  rooms: JSON.parse(JSON.stringify(F.rooms)),
  readSeq: Object.fromEntries(
    Object.values(F.rooms).map((r) => [r.id, r.lastMessageSeq - r.unreadCount]),
  ),
});
const state = { phase: "boot", data: fresh(), log: [], unmocked: [] };
const env = (data) => JSON.stringify({ success: true, data, error: null });
const errEnv = (code, message) =>
  JSON.stringify({ success: false, data: null, error: { code, message } });
const roomList = () => Object.values(state.data.rooms);

function pageOf(id, q) {
  const all = state.data.messages[id] || [];
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
  if (method === "GET" && path === "/chat/rooms") return [200, env(roomList())];
  const m = /^\/chat\/rooms\/([^/]+)(\/[a-z-]+)?$/.exec(path);
  if (m) {
    const [, id, sub] = m;
    const listed = state.data.rooms[id];
    if (!listed) return [404, errEnv("CHAT-ERR-001", "Không tìm thấy phòng")];
    const d = F.details[id];
    if (method === "GET" && !sub)
      return [200, env({ ...d, ...listed, members: d.members, myRole: d.myRole })];
    if (method === "GET" && sub === "/messages") return [200, env(pageOf(id, q))];
    if (method === "GET" && sub === "/pinned") return [200, env([])];
    if (method === "GET" && sub === "/members") return [200, env(d.members)];
    if (method === "POST" && sub === "/read") {
      const asked = Number(body.seq); // chatMarkReadSchema: { seq }
      const next = Math.min(
        listed.lastMessageSeq,
        Math.max(state.data.readSeq[id], Number.isFinite(asked) ? asked : 0),
      );
      state.data.readSeq[id] = next;
      state.data.rooms[id] = { ...listed, unreadCount: listed.lastMessageSeq - next };
      return [
        200,
        env({ roomId: id, lastReadSeq: next, unreadCount: listed.lastMessageSeq - next }),
      ];
    }
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
        if (p.resetData) state.data = fresh();
        if (p.resetLog) {
          state.log = [];
          state.unmocked = [];
        }
        if ("phase" in p) state.phase = p.phase;
        // Tin «realtime»: server cũng phải có nó (trang `afterSeq`, con trỏ đọc tới seq mới) trước khi
        // trình duyệt bơm cùng tin vào store như handler `chat:message`.
        if (p.live) {
          const { roomId, seq } = p.live;
          const m = (F.live[roomId] || []).find((x) => x.roomSeq === seq);
          const r = state.data.rooms[roomId];
          const list = state.data.messages[roomId];
          if (m && r && list && !list.some((x) => x.roomSeq === seq)) {
            list.push(m);
            state.data.rooms[roomId] = {
              ...r,
              lastMessageSeq: seq,
              lastMessageAt: m.createdAt,
              unreadCount: seq - state.data.readSeq[roomId],
            };
          }
        }
        return reply(200, JSON.stringify({ ok: true, phase: state.phase }));
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
        body: req.method === "POST" ? body : undefined,
        at: Date.now(),
      });
      const [status, payload] = route(req.method, path, url.searchParams, body || {});
      return reply(status, payload);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock api on 127.0.0.1:${PORT}`));
