// S20-CHAT-DEEPLINK-1 — API GIẢ LẬP cho lượt đo trình duyệt thật. Nghe 127.0.0.1:59999 (= VITE_API_URL của dev server).
// Không dùng page.route: trên máy này route.fulfill trong browser_run_code làm rơi kết nối Playwright MCP (đo 24/10).
// Không bao giờ chuyển tiếp: đường chưa giả lập ⇒ 404 + ghi `unmocked` (không chạm API PROD 3100).
// Điều khiển: POST /__smoke/state {me, phase, resetLog, resetData} · GET /__smoke/log.
// Chạy: node S20-CHAT-DEEPLINK-1.mock-api.cjs S20-CHAT-DEEPLINK-1.fixtures.json
const http = require("node:http");
const fs = require("node:fs");

const F = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const { ids } = F;
const PORT = 59999;
const fresh = () => ({
  rooms: { ...F.rooms },
  messages: JSON.parse(JSON.stringify(F.messages)),
  seq: 100,
});
const state = { me: "meFull", phase: "boot", data: fresh(), log: [], unmocked: [] };
const env = (data) => JSON.stringify({ success: true, data, error: null });
const errEnv = (code, message) =>
  JSON.stringify({ success: false, data: null, error: { code, message } });
const roomList = () => Object.values(state.data.rooms);

function route(method, path, q, body) {
  if (method === "POST" && path === "/auth/refresh") return [200, env(F.refresh)];
  if (method === "GET" && path === "/auth/me") return [200, env(F[state.me])];
  if (method === "GET" && path === "/me/preferences") return [200, env(F.prefs)];
  if (method === "GET" && path === "/notifications/dropdown") return [200, env(F.dropdown)];
  if (method === "GET" && path === "/notifications/unread-count") return [200, env(F.notiUnread)];
  if (method === "GET" && path === "/notifications") return [200, env(F.notiList)];
  if (method === "POST" && /^\/notifications\/[^/]+\/mark-read$/.test(path))
    return [200, env(F.markRead)];
  if (method === "GET" && (path === "/tasks" || path === "/tasks/my" || path === "/projects"))
    return [200, env([])];
  if (method === "GET" && path === "/chat/unread-count") return [200, env({ total: 1, rooms: 1 })];
  if (method === "GET" && path === "/chat/rooms") return [200, env(roomList())];
  if (method === "POST" && path === "/chat/rooms/direct") {
    const existing = roomList().find(
      (r) => r.roomType === "direct" && r.peer && r.peer.userId === body.peerUserId,
    );
    if (existing) return [200, env({ ...existing, peer: null })];
    state.data.rooms[ids.D] = F.dRoomListed; // lần GET /chat/rooms kế tiếp có D (kèm peer)
    return [201, env(F.dRoomCreated)]; // server thật trả peer: null
  }
  let m = /^\/chat\/rooms\/([^/]+)(\/[a-z-]+)?$/.exec(path);
  if (m) {
    const [, id, sub] = m;
    const listed = state.data.rooms[id];
    if (!listed) return [404, errEnv("CHAT-ERR-001", "Không tìm thấy phòng")];
    if (method === "GET" && !sub)
      return [
        200,
        env({
          ...F.details[id],
          ...listed,
          members: F.details[id].members,
          myRole: F.details[id].myRole,
        }),
      ];
    if (method === "GET" && sub === "/messages") return [200, env(state.data.messages[id] || [])];
    if (method === "GET" && sub === "/pinned") return [200, env([])];
    if (method === "GET" && sub === "/members") return [200, env(F.details[id].members)];
    if (method === "POST" && sub === "/read")
      return [200, env({ roomId: id, lastReadSeq: listed.lastMessageSeq || 0, unreadCount: 0 })];
    if (method === "POST" && sub === "/typing") return [204, ""];
    if (method === "POST" && sub === "/messages") {
      state.data.seq += 1;
      const n = state.data.seq;
      const created = {
        id: `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`,
        companyId: ids.CO,
        roomId: id,
        senderId: ids.ME,
        senderName: F.names[ids.ME],
        body: body.body ?? null,
        messageType: "text",
        mentions: body.mentions || [],
        pinnedAt: null,
        pinnedBy: null,
        replyToMessageId: body.replyToMessageId ?? null,
        recalledAt: null,
        attachmentCount: 0,
        attachments: [],
        reactions: [],
        roomSeq: (listed.lastMessageSeq || 0) + 1,
        createdAt: new Date().toISOString(),
      };
      (state.data.messages[id] ||= []).push(created);
      state.data.rooms[id] = {
        ...listed,
        lastMessageSeq: created.roomSeq,
        lastMessageAt: created.createdAt,
      };
      return [201, env(created)];
    }
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
        body: req.method === "POST" ? body : undefined,
      });
      const [status, payload] = route(req.method, path, url.searchParams, body || {});
      return reply(status, payload);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock api on 127.0.0.1:${PORT}`));
