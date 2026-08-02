# Micro-plan — `S7-CHAT-RT-1` (🔴 red · crown · FULL gate)

> **WO:** Realtime CHAT — join phòng SERVER-SIDE lúc handshake · emit SAU commit · đồng bộ join/leave khi membership đổi · giữ WS một chiều (CHAT-DEC-005).
> **Nguồn sự thật:** [SPEC-15 §3.5 · §13.8](<../SPEC/SPEC-15 CHAT.md>) · [API-13 §7](<../API Design/API-13_CHAT_API_Design.md>) · `apps/api/src/realtime/**` (hạ tầng đã ship) · `apps/api/src/chat/**` (BE-1, **chưa commit, chưa qua FULL gate**)
> **Nhánh:** commit lên `wave/s7-chat` (WAVE §4) · **Lập ngày:** 02/08/2026
> **Phụ thuộc khai báo (backlog):** `depends_on: ["S7-CHAT-BE-2"]` — nhưng **BE-2 (tin nhắn) CHƯA TỒN TẠI** tại thời điểm lập plan này. Xem §1.9 — plan viết phần nhắn tin như MỘT HỢP ĐỒNG TÍCH HỢP (giả định), không phải code đã kiểm chứng.

---

## 0. Đo thật trước khi thiết kế

| # | Thứ | Đo được 02/08/2026 | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Gateway hiện có | `RealtimeGateway` namespace `/ws`; auth ở **handshake middleware** trong `afterInit` (chạy TRƯỚC khi Socket.IO gửi sự kiện `connect`) — verify JWT qua `TokenService.verifyAccessToken`, gắn `{id, companyId}` vào `socket.data.user`. Fail-closed: thiếu/sai token → `next(new Error(...))`, `REALTIME_ENABLED=false` → middleware từ chối MỌI connection | `realtime.gateway.ts:39-82` |
| 2 | `handleConnection` hiện tại | CHỈ join `userRoomName(companyId, userId)` (đích `notification:new`). **0 query DB, 0 room chat nào được join.** Đây là toàn bộ việc cần thêm | `realtime.gateway.ts:84-94` |
| 3 | `RealtimeEmitterService` hiện có | CHỈ `emitNotification` + `emitNotificationRead`. **0 method nào cho chat.** Nhưng khuôn "emit SAU commit, NGOÀI `withTenant`" đã có **2 tiền lệ thật** cần mirror y hệt | `realtime-emitter.service.ts:22-63` · `notifications.service.ts:197-199` · `notification-engine.service.ts:157-160` |
| 4 | `rooms.ts` hiện có | CHỈ `userRoomName()`. **Chưa có `chatRoomName()`** — done_when của backlog đòi hàm này | `rooms.ts:1-11` |
| 5 | **`packages/contracts/src/realtime.ts` đang khai WS CHAT SONG HƯỚNG — bản CŨ, trước `CLEAN-DECOUPLE-1`** | `WS_EVENTS.CHAT_JOIN/CHAT_LEAVE/CHAT_SEND/CHAT_TYPING/CHAT_PRESENCE_LIST` (client→server) + `wsChatSendAckSchema`/`wsPresenceListAckSchema`/`wsAckSchema` — mâu thuẫn TRỰC TIẾP với CHAT-DEC-005 (WS một chiều, 0 `@SubscribeMessage`). Grep TOÀN REPO các symbol này: **đúng 1 file khớp — chính `realtime.ts` khai chúng, KHÔNG ai import** (0 FE, 0 BE khác). Đây là code CHẾT còn sót lại từ thiết kế G10 tiền-de-media-fy | grep repo-wide `CHAT_JOIN\|CHAT_SEND\|wsChatSendSchema\|wsChatSendAckSchema\|wsPresenceListAckSchema` = 1 file (`realtime.ts` chính nó) |
| 6 | 4 sự kiện THẬT theo spec | `chat:message` **đã đúng** (`WS_EVENTS.CHAT_MESSAGE`). **`chat:message-recalled` · `chat:read` · `chat:room` CHƯA khai** ở đâu cả | `realtime.ts:24` · SPEC-15 §13.8 · API-13 §7 |
| 7 | **`@socket.io/redis-adapter@8.3.0` (bản THẬT đã cài) hỗ trợ remote room-ops xuyên instance** | `addSockets`/`delSockets`/`disconnectSockets` được implement (không phải no-op) → `server.in(room).socketsJoin()/.socketsLeave()/.disconnectSockets()` hoạt động ĐÚNG dù các socket nằm ở instance Node khác, miễn Valkey adapter đã gắn. KHÔNG cần code gì thêm cho phần cross-instance, chỉ cần gọi đúng API Socket.IO chuẩn | `node_modules/.pnpm/@socket.io+redis-adapter@8.3.0.../dist/index.js:583,599,615` |
| 8 | **`RealtimeEmitterModule` là leaf module TỪNG được tách RIÊNG để phá cycle `Realtime→Chat→Realtime`** | Comment gốc: "trước đây leaf này còn để phá cycle Realtime→Chat→Realtime; nay chỉ NotificationsModule dùng". Đây CHÍNH XÁC là kiến trúc RT-1 cần dựng lại: `ChatModule` import `RealtimeEmitterModule` (leaf), `RealtimeModule` import `ChatModule` — KHÔNG đảo chiều | `realtime-emitter.module.ts:7-9` |
| 9 | BE-1 (working tree, CHƯA commit) đã export sẵn gì | `ChatModule.exports = [ChatAccessService, ChatRoomsRepository]` — RT-1 dùng LẠI ĐÚNG `ChatRoomsRepository.listRoomsForUser(tx, companyId, userId, {archived:false})` để lấy danh sách phòng lúc connect, **không cần thêm method repo mới** | `chat.module.ts:30-41` · `chat-rooms.repository.ts:107-150` |
| 10 | **`toChatRoomDto` LUÔN gán `unreadCount` một SỐ CỤ THỂ, không bao giờ để trống** | `unreadCount: unreadCount ?? row.unreadCount ?? 0` — tái dùng thẳng hàm này cho payload broadcast `chat:room` sẽ phát **"0 chưa đọc" SAI** cho mọi người nhận (trường này per-member, không có giá trị đúng để broadcast chung một lần) | `chat.mapper.ts:39-61`, cụ thể dòng 59 |
| 11 | Wiring module cấp app đã xong (BE-1) | `app.module.ts` đã import cả `RealtimeModule` (dòng 64) và `ChatModule` (dòng 98); `openapi-modules.ts` đã có mục `CHAT` (dòng 98-104). RT-1 **không** đụng 2 file này, **không** thêm route HTTP nào ⇒ route-census/openapi không bị ảnh hưởng | `app.module.ts:20,35,64,98` · `openapi-modules.ts:98-104` |
| 12 | Mint JWT thật trong test KHÔNG cần login | `TokenService.signAccessToken(claims)` ký token hợp lệ trực tiếp — dùng cho `auth.token` của `socket.io-client` trong int-spec, khỏi phải chạy full flow `/auth/login` (+2FA) | `token.service.ts:79-85` |
| 13 | `REALTIME_ENABLED` đọc **1 LẦN LÚC KHỞI TẠO gateway**, KHÔNG memoized ở `loadEnv()` | `loadEnv()` parse `process.env` tươi mỗi lần gọi (không cache module-level) — NHƯNG `RealtimeGateway.enabled` là field `readonly` gán trong constructor. Test 2 chế độ true/false phải dùng **2 `TestingModule`/app riêng biệt**, set env TRƯỚC mỗi lần `compile()`; KHÔNG cần `vi.resetModules()` (khác bẫy `vitest-loadfresh-per-scenario-flake` — ở đây field chỉ đọc 1 lần per-instance, không phải module-level cache) | `realtime.gateway.ts:44` · `env.schema.ts:315-324` |
| 14 | **0 cơ chế nào ngắt một socket ĐANG SỐNG khi tài khoản bị khoá/vô hiệu hoá giữa phiên** | Grep `disconnect` trong toàn `apps/api/src` chỉ khớp nhánh handshake-fail-closed (`realtime.gateway.ts:90`) — không có "kick-on-lock" ở đâu. Khớp với gap đã biết ở AUTH: khoá user KHÔNG revoke access token đang sống (≤15 phút TTL) — memory `auth-account-audit-2026-07`. `auth/**` NGOÀI `paths` của WO này | grep `disconnect\|forceLogout\|kick` toàn `apps/api/src` = chỉ khớp gateway hiện có · `env.schema.ts:64` (`ACCESS_TOKEN_TTL_SEC` default 900s) |
| 15 | Chưa có khuôn test nào ghép ĐỦ 2 thứ RT-1 cần | `realtime.gateway.io.spec.ts` có server+client Socket.IO THẬT (`fetchSockets()`, `waitFor` polling) nhưng **không có DB/AppModule**. `chat-be1-*.int-spec.ts` có `AppModule` + `supertest` + `LANE_DB` THẬT nhưng **không có WS**. RT-1 là WO ĐẦU TIÊN cần cả hai cùng lúc | `realtime.gateway.io.spec.ts:39-69` · `chat-be1-access.int-spec.ts:23-44` |
| 16 | Comment đầu 3 file realtime sẽ SAI sau khi RT-1 ship | `realtime.gateway.ts:29-31`, `realtime.module.ts:13`, `realtime-emitter.service.ts:20` đều viết "cụm chat = out-of-scope đã gỡ" (đúng lúc viết, trước RT-1) — phải cập nhật cùng lúc, nếu không plan/agent SAU sẽ đọc comment cũ và tưởng chat vẫn ngoài phạm vi (bài học `wo-plans-built-on-code-comments`) | `realtime.gateway.ts:29-31` · `realtime.module.ts:13` · `realtime-emitter.service.ts:20` |

---

## 1. Quyết định thiết kế — chốt ở đây, không để người thi công tự quyết

### 1.1 Kiến trúc module — mirror ĐÚNG cấu trúc đã từng tồn tại (đo thật #8)

```text
RealtimeModule  ──imports──▶  ChatModule  ──imports──▶  RealtimeEmitterModule (leaf)
      │                                                        ▲
      └──────────────────────imports──────────────────────────┘
```

- **`RealtimeModule` thêm `ChatModule` vào `imports`** — để `RealtimeGateway` inject `ChatRoomsRepository` (đọc danh sách phòng lúc connect) + `DatabaseService` (đã `@Global()`, không cần import tường minh).
- **`ChatModule` thêm `RealtimeEmitterModule` vào `imports`** — để `ChatRoomsService`/`ChatMembersService` inject `RealtimeEmitterService` (emit sau commit).
- **KHÔNG** để `ChatModule` import `RealtimeModule` (chỉ import `RealtimeEmitterModule`, leaf) — đây chính xác là lý do `RealtimeEmitterModule` được tách riêng từ đầu (đo thật #8). Đảo hướng là dựng lại cycle `Realtime→Chat→Realtime` mà comment cũ đã cảnh báo.
- Đồ thị trên là **ACYCLIC** (không có cạnh nào của `ChatModule`/`RealtimeEmitterModule` trỏ ngược về `RealtimeModule`) — verify bằng `pnpm --filter @mediaos/api build` (Nest DI báo lỗi ngay nếu có cycle).

### 1.2 Join phòng lúc connect — server tự tra, KHÔNG nhận từ client

`RealtimeGateway.handleConnection` đổi từ `void` (sync) sang **async**:

```text
handleConnection(client):
  user = getUser(client)                                    // KHÔNG ĐỔI — auth đã xong ở middleware
  if !user → disconnect(true); return
  client.join(userRoomName(user.companyId, user.id))         // KHÔNG ĐỔI
  try:
    rooms = withTenant(user.companyId, tx =>
              chatRoomsRepo.listRoomsForUser(tx, user.companyId, user.id, {archived: false}))
    for r of rooms: client.join(chatRoomName(user.companyId, r.id))
  catch (err):
    logger.warn("join chat rooms lúc connect thất bại", {userId, error})
    // KHÔNG disconnect — fail-SOFT: socket vẫn nhận notification bình thường, FE có afterSeq bù
```

- **CẤM tuyệt đối đọc `roomId` từ `client.handshake` (payload/query/auth) để join** — toàn bộ danh sách đến từ `ChatRoomsRepository.listRoomsForUser`, tự-bound theo `user.id` lấy từ `socket.data.user` (đã verify ở middleware). Đây là điều kiện SỐNG CÒN của WO (backlog done_when dòng 2).
- **Chỉ join phòng `archived: false`.** Lý do: phòng đã lưu trữ CHỈ ĐỌC (SPEC-15 §3.4/§13.6 chặn mọi ghi mới), không phát sinh sự kiện `chat:message` mới nữa — join thêm không có giá trị, chỉ tốn room. Sự kiện `chat:room action:"archived"` (đúng lúc lưu trữ) vẫn tới được vì socket còn đang join TẠI THỜI ĐIỂM archive xảy ra (broadcast trước khi bất kỳ ai unjoin).
- **Fail-SOFT khi query lỗi** (DB tạm gián đoạn…): không disconnect socket — mất realtime chat tạm thời không phải lỗ bảo mật (REST + phân trang `afterSeq` vẫn đúng), disconnect ở đây chỉ làm hỏng luôn cả đường NOTI đang chạy tốt. Khác hẳn nhánh auth (fail-CLOSED) vì đây không phải biên bảo mật.
- **`getUser`, middleware auth, `userRoomName` giữ NGUYÊN — không đổi.**

### 1.3 `RealtimeEmitterService` — 5 method mới, cùng khuôn `.parse()` + try/catch no-throw đã có

| Method | Đích Socket.IO | Payload `.parse()` qua |
| --- | --- | --- |
| `emitChatMessage(companyId, roomId, message)` | `chatRoomName(companyId, roomId)` | `wsChatMessageEventSchema` (= `chatMessageSchema`, đã có) |
| `emitChatMessageRecalled(companyId, roomId, payload)` | như trên | `wsChatMessageRecalledEventSchema` (mới) |
| `emitChatRead(companyId, roomId, payload)` | như trên | `wsChatReadEventSchema` (mới) |
| `emitChatRoom(companyId, roomId, payload, affectedUserId?)` | `chatRoomName(...)` **+** `userRoomName(companyId, affectedUserId)` nếu có (Socket.IO `.to(a).to(b)` gộp UNION, KHÔNG double-deliver cho socket nằm ở cả hai — không cần tự khử trùng) | `wsChatRoomEventSchema` (mới) |
| `syncRoomMembership(companyId, roomId, userId, action: "join"\|"leave")` | không emit — gọi `server.in(userRoomName(companyId,userId)).socketsJoin(chatRoomName(...))` hoặc `.socketsLeave(...)` | — (không phải payload) |

- Mọi method **giữ nguyên khuôn hiện có**: `if (!this.server) return;` đầu hàm (no-op khi `REALTIME_ENABLED=false`/gateway chưa init) + `try/catch` quanh phần còn lại, `logger.warn` khi lỗi, **KHÔNG BAO GIỜ throw lên caller** (`realtime-emitter.service.ts:16-18` đã ghi rõ nguyên tắc — "lỗi emit không được làm hỏng giao dịch nghiệp vụ đã commit").
- `syncRoomMembership` KHÔNG cần `.parse()` (không phát payload) — nhưng vẫn bọc try/catch cùng lý do.

### 1.4 `chat:room` — `room` field KHÔNG mang `unreadCount` (vá lỗ ở đo thật #10)

```ts
// packages/contracts/src/realtime.ts
export const wsChatRoomActionSchema = z.enum([
  "created", "updated", "archived",
  "member_added", "member_removed", "member_role_changed", "left",
]);
export type WsChatRoomAction = z.infer<typeof wsChatRoomActionSchema>;

export const wsChatRoomEventSchema = z.object({
  roomId: z.string().uuid(),
  action: wsChatRoomActionSchema,
  // ⚠️ omit unreadCount: field này PER-MEMBER, không có giá trị đúng để broadcast chung — xem chat.mapper.ts:59.
  // FE nhận `chat:room` KHÔNG được đọc room.unreadCount, giữ nguyên giá trị cục bộ của mình.
  room: chatRoomSchema.omit({ unreadCount: true }).optional(),
});
```

- `room` field CHỈ điền cho action `created`/`updated`/`archived` (metadata phòng thật sự đổi, FE cần khỏi phải gọi lại `GET /chat/rooms/:id`). Với `member_added`/`member_removed`/`member_role_changed`/`left` thì `room` để trống — các action này không đổi metadata phòng, FE tự biết cách cập nhật danh sách thành viên/badge.
- Bất kỳ code nào build payload `chat:room` mà set `room.unreadCount` bằng tay là VI PHẠM — ca test 9 ở §4 pin điều này bằng runtime assertion, không chỉ type-check (Zod `.omit()` strip field thừa ngay cả khi ai đó lỡ set).

### 1.5 Dọn code chết trong `packages/contracts/src/realtime.ts` (đo thật #5)

**Xoá** (0 usage repo-wide, mâu thuẫn CHAT-DEC-005 — SPEC-15 dòng 167 xác nhận typing/presence "đo nhu cầu thật SAU v1", không phải v1):
`WS_EVENTS.CHAT_JOIN` · `CHAT_LEAVE` · `CHAT_SEND` · `CHAT_TYPING` · `CHAT_PRESENCE_LIST` · `CHAT_TYPING_EVENT` · `CHAT_PRESENCE`, cùng `wsChatJoinSchema` · `wsChatLeaveSchema` · `wsChatSendSchema` · `wsChatTypingSchema` · `wsChatPresenceListSchema` · `wsChatTypingEventSchema` · `wsChatPresenceEventSchema` · `wsChatSendAckSchema` · `wsPresenceListAckSchema` · `wsAckSchema` (generic ack — chỉ 2 schema trên dùng, cả hai đều bị xoá).

**Thêm:** `WS_EVENTS.CHAT_MESSAGE_RECALLED = "chat:message-recalled"` · `CHAT_READ = "chat:read"` · `CHAT_ROOM = "chat:room"`, cùng 3 schema `wsChatMessageRecalledEventSchema` / `wsChatReadEventSchema` / `wsChatRoomEventSchema` + `wsChatRoomActionSchema` (giữ nguyên `WS_EVENTS.CHAT_MESSAGE` và `wsChatMessageEventSchema` đã đúng).

Lý do xoá thay vì giữ-cho-chắc: giữ lại là để một chỗ trong contracts nói "WS chat có ghi 2 chiều với ack" trong khi TOÀN BỘ phần còn lại của hệ thống (gateway, spec, mọi WO khác) khẳng định ngược lại — đúng bẫy khiến người đọc sau (kể cả BE-2/FE-1) tin nhầm và tính xây `@SubscribeMessage`.

### 1.6 Bảng ánh xạ hành động → sự kiện `chat:room` — chốt CỨNG, viết vào `chat-rooms.service.ts` / `chat-members.service.ts`

| Service · method | `action` | `affectedUserId` | `syncRoomMembership` kèm theo |
| --- | --- | --- | --- |
| `ChatRoomsService.createGroup` | `"created"` | — | `join` cho actor + MỌI invitee |
| `ChatRoomsService.openDirect` — **CHỈ nhánh THẬT SỰ TẠO MỚI** (không phải trả về phòng cũ hay hồi sinh do race) | `"created"` | — | `join` cho actor + peer |
| `ChatRoomsService.openDirect` → `resurrectDirect` (hồi sinh phòng đã tombstone) | `"created"` | — | `join` cho MỖI người được `reactivateMember`/`insertMember` lại (kể cả actor) |
| `ChatRoomsService.updateRoom` | `"updated"` | — | không |
| `ChatRoomsService.archiveRoom` | `"archived"` | — | không |
| `ChatRoomsService.leaveRoom` | `"left"` | `actor.id` | `leave` cho actor |
| `ChatMembersService.addMember` | `"member_added"` | `dto.userId` | `join` cho `dto.userId` |
| `ChatMembersService.updateMemberRole` | `"member_role_changed"` | `targetUserId` | **không** (đổi vai trò không đổi tư cách thành viên phòng) |
| `ChatMembersService.removeMember` | `"member_removed"` | `targetUserId` | `leave` cho `targetUserId` |

⚠️ **`openDirect` cần thread một cờ `created: boolean`** qua kết quả của nhánh tx-tạo-mới để phân biệt với nhánh `existing && !existing.deletedAt` (early return, KHÔNG emit) và nhánh đua-thắng-bởi-request-khác (`raced.id`, KHÔNG emit — request kia đã emit rồi). Thiếu cờ này ⇒ gọi `openDirect` lần 2 (idempotent, HTTP 200 y hệt) vẫn bắn `chat:room "created"` lần nữa — sai ngữ nghĩa "created" và làm FE tưởng có phòng mới liên tục. Xem `chat-rooms.service.ts:159-225`.

### 1.7 Vị trí gọi — mirror CHÍNH XÁC khuôn `notifications.service.ts:197-199`

```text
async someMethod(actor, ...) {
  const result = await this.db.withTenant(actor.companyId, async (tx) => {
    ... ghi DB + audit trong CÙNG tx ...
    return { dto, membershipChanges: [...] };   // KHÔNG emit ở đây
  });
  // ↓ TỚI ĐÂY tx đã COMMIT — không bao giờ emit cho giao dịch bị rollback
  this.realtime.emitChatRoom(actor.companyId, roomId, { roomId, action, room }, affectedUserId);
  for (const c of result.membershipChanges) {
    this.realtime.syncRoomMembership(actor.companyId, roomId, c.userId, c.action);
  }
  return result.dto;
}
```

Thứ tự **emit trước, sync sau**: `emitChatRoom` dùng multi-target (`.to().to()`) nên không phụ thuộc việc socket đã join/leave phòng hay chưa (đích `co:{companyId}:user:{userId}` của người bị ảnh hưởng LUÔN nhận được, bất kể họ vừa được thêm hay vừa bị bớt khỏi phòng). Đặt sync sau chỉ để code đọc theo trình tự nghiệp vụ tự nhiên ("báo tin xong mới xếp lại kết nối") — không phải yêu cầu đúng-sai.

### 1.8 `chatRoomName` — thêm vào `rooms.ts`, giữ nguyên tiền tố

```ts
export function chatRoomName(companyId: string, roomId: string): string {
  return `co:${companyId}:chatroom:${roomId}`;
}
```

Giữ đúng tiền tố `co:{companyId}:` như `userRoomName` — ép cô lập tenant ở TẦNG ROOM (comment gốc `rooms.ts:1-5`), không phụ thuộc `roomId` (UUID) không đụng độ giữa các company.

### 1.9 Hợp đồng tích hợp cho `S7-CHAT-BE-2` (tin nhắn) — GIẢ ĐỊNH, CHƯA XÁC NHẬN

BE-2 (gửi/thu hồi/đánh dấu đã đọc) **chưa tồn tại**. RT-1 chỉ dựng ống dẫn (`emitChatMessage`/`emitChatMessageRecalled`/`emitChatRead` + schema); BE-2 khi thi công PHẢI:

1. Gọi 3 method trên **SAU KHI** `withTenant` của chính nó resolve (mirror §1.7 — cấm gọi trong tx).
2. `emitChatMessage`: payload = **đúng `ChatMessageDto`** đã `.parse()` qua `chatMessageSchema` cho response REST (KHÔNG build object riêng cho WS) — giữ đúng nguyên tắc "REST và WS cùng DTO" (API-13 §7 dòng 1). ⚠️ `chatMessageSchema.seq` hiện còn field `seq` toàn cục (nợ đã ghi ở BE-1 §3.1 — "BE-2 KHÔNG được dùng field này") — người thi công BE-2 phải tự đối chiếu nợ đó, RT-1 không lặp lại chi tiết.
3. Gửi tin **KHÔNG** kèm `syncRoomMembership` nào — gửi tin không đổi membership.
4. Thu hồi tin (`emitChatMessageRecalled`) chỉ mang `{ messageId, roomId, recalledAt }` — **không** kèm `body` (kể cả `null`) vì payload REST đã tự có field đó qua GET lại, và giữ payload sự kiện tối giản đúng API-13 §7 bảng dòng 2.
5. `emitChatRead`: `{ roomId, userId, lastReadSeq }` — `lastReadSeq` là **`room_seq`** (per-room, mig `0539`), KHÔNG phải `chat_messages.seq` toàn cục (SPEC-15 §13.1 ĐÍNH CHÍNH).

**Assumption cần xác nhận lại lúc BE-2 thực sự lập plan:** các method/schema trên đủ hình dạng cho nhu cầu BE-2, KHÔNG thiếu field nào BE-2 mới phát hiện cần. Nếu BE-2 cần đổi shape, đó là việc của `S7-CHAT-BE-2`'s micro-plan, không phải RT-1 tự đoán thêm.

### 1.10 "user bị khoá/vô hiệu hoá → cắt phiên WS" — diễn giải HẸP, KHÔNG tự chế cơ chế ngoài phạm vi

Backlog done_when gộp chung ý này với "membership đổi → join/leave ngay" trong cùng một câu. Đo thật #14 xác nhận: **không có nguồn sự kiện nào trong phạm vi `paths` của RT-1** (`realtime/**`, `chat/**`, `contracts/realtime.ts`) có thể kích hoạt việc "khoá tài khoản" — hành động đó sống ở `apps/api/src/auth/**`, NGOÀI paths, và bản thân AUTH hiện **chưa** revoke access token đang sống khi khoá (gap đã biết, memory `auth-account-audit-2026-07`, không phải lỗ RT-1 sinh ra).

**Chốt:** RT-1 diễn giải bullet này = hệ quả TỰ NHIÊN của "rời mọi phòng dẫn xuất" (SPEC-15 §13.3, dòng "nghỉ việc/vô hiệu hoá → rời mọi phòng dẫn xuất") — đã phủ đủ bởi `syncRoomMembership` generic ở §1.3 (bất kỳ code nào set `left_at`, dù BE-1 thủ công hay BE-5 đồng bộ sau này, đều gọi được cùng một primitive). RT-1 **KHÔNG** dựng cơ chế "ngắt toàn bộ socket khi tài khoản bị khoá" — đó là gap AUTH cấp hệ thống, ảnh hưởng MỌI kênh WS (kể cả NOTI), không riêng CHAT, và nên được vá ở đúng tầng AUTH khi có WO riêng. Ghi rủi ro ở §5.

> ⚠️ Nếu owner không đồng ý cách diễn giải này (muốn RT-1 đóng luôn gap kill-switch), cần mở rộng `paths` sang `apps/api/src/auth/**` và xác nhận lại TRƯỚC khi code — đây là quyết định phạm vi, không phải chi tiết kỹ thuật.

---

## 2. Phạm vi thi công

| File | Việc |
| --- | --- |
| `packages/contracts/src/realtime.ts` | Xoá 7 event key + 10 schema chết (§1.5); thêm 3 event key + 4 schema mới (§1.4, §1.5); import thêm `chatRoomSchema` từ `./chat` |
| `apps/api/src/realtime/rooms.ts` | Thêm `chatRoomName(companyId, roomId)` (§1.8) |
| `apps/api/src/realtime/realtime-emitter.service.ts` | Thêm 5 method (§1.3); sửa comment dòng 20 (không còn "chỉ còn đường NOTI") |
| `apps/api/src/realtime/realtime.gateway.ts` | `handleConnection` → async, join chat rooms (§1.2); sửa comment dòng 29-31 (đo thật #16) |
| `apps/api/src/realtime/realtime.module.ts` | `imports` thêm `ChatModule` (§1.1); sửa comment dòng 13 |
| `apps/api/src/chat/chat.module.ts` | `imports` thêm `RealtimeEmitterModule` (§1.1) |
| `apps/api/src/chat/chat-rooms.service.ts` | Wiring emit/sync cho `createGroup`/`openDirect`/`resurrectDirect`/`updateRoom`/`archiveRoom`/`leaveRoom` (§1.6, §1.7); constructor inject `RealtimeEmitterService` |
| `apps/api/src/chat/chat-members.service.ts` | Wiring emit/sync cho `addMember`/`updateMemberRole`/`removeMember` (§1.6, §1.7); constructor inject `RealtimeEmitterService` |
| `apps/api/test/integration/**` | Test mới — xem §4 |

---

## 3. KHÔNG làm trong WO này

- ❌ Bất kỳ endpoint/service nào của `S7-CHAT-BE-2` (gửi/thu hồi/đọc tin) — chỉ dựng ống dẫn + hợp đồng tích hợp (§1.9).
- ❌ `S7-CHAT-BE-5` (đồng bộ thành viên dẫn xuất phòng ban/dự án) — `syncRoomMembership` là primitive TỔNG QUÁT sẵn sàng cho BE-5 gọi khi nó tồn tại, RT-1 không tự dựng job đối soát.
- ❌ `S7-CHAT-BE-7` (đọc-vượt Super Admin, `/chat/oversight/*`) — SPEC-15 §3.3 dòng 6 chốt SA **không** join room chat, **không** nhận `chat:message` realtime. Điều này ĐÚNG TỰ NHIÊN với thiết kế §1.2 (danh sách join đến từ `chat_room_members` thật — SA không có hàng ở đó cho phòng mình không thuộc), **không cần code loại trừ riêng**.
- ❌ Cơ chế "cắt phiên WS khi khoá/vô hiệu hoá tài khoản" chủ động — xem §1.10.
- ❌ Bất kỳ `@SubscribeMessage` nào — giữ nguyên CHAT-DEC-005.
- ❌ Đổi FE (`apps/app`, `packages/web-core`) — RT-1 chỉ là mặt BE; FE tiêu thụ ở `S7-CHAT-FE-1..3`.
- ❌ Đụng `app.module.ts`/`config/openapi-modules.ts` — đã wire xong ở BE-1 (đo thật #11), 0 route HTTP mới nên không cần regen route-census.
- ❌ Permission pair mới / migration mới — RT-1 không có bề mặt HTTP mới, không cần cặp quyền.
- ❌ Typing indicator / presence online-offline — SPEC-15 dòng 167 chốt "đo nhu cầu thật sau v1".

---

## 4. Test RED-trước

⚠️ Chủ thể test **KHÔNG được là Super Admin** (cùng lý do BE-1 — SA giữ toàn bộ catalog, không đại diện được actor thường).

| # | Ca | Kỳ vọng | Lớp test |
| --- | --- | --- | --- |
| 1 | User có N phòng active (không lưu trữ) kết nối WS | Socket join ĐỦ N room `chatRoomName` + 1 `userRoomName`, xác nhận bằng `fetchSockets()` phía server | int (Nest `app.listen(0)` + `LANE_DB` + socket.io-client thật) |
| 2 | User có phòng ĐÃ lưu trữ | Socket **không** join room của phòng đó | int, cùng bộ với #1 |
| 3 | Client gửi frame `chat:join` giả mạo với `roomId` bất kỳ (không có `@SubscribeMessage` xử lý) | Không có hiệu ứng gì — grep `apps/api/src/realtime/**` xác nhận 0 `@SubscribeMessage`, không route nào bắt frame này | grep (structural) + 1 test kết nối thật gửi thử, xác nhận server không đổi trạng thái join |
| 4 | Admin thêm user A vào phòng qua `POST /chat/rooms/:id/members`, user A ĐANG kết nối WS từ trước | Socket của A join room mới **NGAY**, không cần reconnect (verify bằng nhận thật 1 `chat:room` kế tiếp phát tới room đó) | int (REST + WS cùng test) |
| 5 | Admin bớt user B khỏi phòng qua `DELETE .../members/:userId`, B đang kết nối | Socket của B **rời** room ngay; broadcast tiếp theo tới room đó **không** tới B; nhưng B **có** nhận đúng 1 `chat:room{action:"member_removed"}` (qua đích user-room riêng) | int |
| 6 | Người ngoài phòng (không phải member) đoán đúng `roomId` thật, có socket kết nối | Không nhận được bất kỳ `chat:message`/`chat:room` nào phát cho phòng đó | int |
| 7 | Cross-tenant: company B có phòng cùng cấu trúc | Socket company A không bao giờ ở chung `chatRoomName` với company B dù trùng thời điểm | int |
| 8 | Transaction rollback (mock `DatabaseService.withTenant` reject) trong `createGroup`/`addMember`/`removeMember` | `RealtimeEmitterService.emitChatRoom`/`syncRoomMembership` **0 lần gọi** | unit (mock, không cần LANE_DB) |
| 9 | Payload `chat:room` bắt được THẬT qua socket.io-client cho action `updated` | Object nhận được **không có key `unreadCount`** trong `room` (Zod `.omit` strip triệt để, không phải `undefined` còn key) | int |
| 10 | `openDirect` gọi 2 lần liên tiếp (idempotent) | Chỉ **đúng 1** `chat:room{action:"created"}` được phát (lần đầu); lần gọi thứ hai KHÔNG phát gì thêm | int |
| 11 | `updateMemberRole` (phong/hạ vai trò) | Phát `chat:room{action:"member_role_changed"}`; **không** có lệnh `socketsJoin`/`socketsLeave` nào chạy (mock `RealtimeEmitterService.syncRoomMembership`, assert 0 call) | unit + int |
| 12 | `REALTIME_ENABLED=false` (app riêng, set trước `compile()`) | Toàn bộ luồng REST tạo phòng/thêm/bớt thành viên vẫn 200/201 đúng dữ liệu DB — không phụ thuộc WS | int (app thứ 2, LANE_DB dùng chung được) |
| 13 | Grep `apps/api/src/realtime/**` + `apps/api/src/chat/**` | 0 chỗ nào đọc `roomId`/danh sách phòng từ `client.handshake` (auth/query/headers) để quyết định join | grep (structural) |
| 14 | Reconnect sau khi membership đổi | Kết nối MỚI (không đợi đổi gì thêm) join đúng theo trạng thái DB hiện tại — không cần cơ chế đặc biệt (đã phủ tự nhiên bởi §1.2 chạy lại mỗi lần connect) | int, tái dùng khuôn `realtime.gateway.io.spec.ts` "reconnect re-joins cleanly" |

**Khuôn test bắt buộc cho ca 1-2, 4-7, 9-10, 12, 14:** `Test.createTestingModule({ imports: [AppModule] }).compile()` → `app.listen(0)` (KHÔNG chỉ `app.init()` — cần cổng HTTP thật cho `socket.io-client`) → lấy port → `ioClient(`http://127.0.0.1:${port}/ws`, { auth: { token: tokenService.signAccessToken({...}) } })`. Seed dữ liệu qua `test/helpers/seed.ts` (như `chat-be1-*.int-spec.ts`), REST qua `supertest(app.getHttpServer())`, WS qua client thật. Đóng cả `app.close()` lẫn client sockets ở `afterAll`/`afterEach` (mirror `realtime.gateway.io.spec.ts:71-78`).

Chạy: `bash scripts/lane-db-setup.sh chatrt1` → `export LANE_DB=mediaos_chatrt1` → nạp env đúng chuỗi (memory `lane-db-run-needs-explicit-urls`, xem BE-1 §4) → `bash harness/check.sh --lane-db`. Drop lane khi xong.

---

## 5. Nợ / rủi ro

1. **Hợp đồng tích hợp BE-2 (§1.9) là GIẢ ĐỊNH chưa kiểm chứng bằng code thật** — người lập plan `S7-CHAT-BE-2` phải đọc lại §1.9 và xác nhận/điều chỉnh trước khi code, không coi đây là chốt cuối.
2. **"Cắt phiên WS khi khoá tài khoản" (§1.10) diễn giải hẹp, KHÔNG đóng gap AUTH lock-no-revoke** — user bị khoá vẫn giữ WS sống tới khi access token hết hạn tự nhiên (≤15 phút, `ACCESS_TOKEN_TTL_SEC`). RT-1 không làm gap này tệ hơn (nó đã tồn tại độc lập với CHAT), nhưng cũng không vá nó. Nếu owner cần vá trong wave này, cần một WO riêng chạm `auth/**`.
3. **Cửa sổ BE-5 chưa tồn tại:** cho tới khi `S7-CHAT-BE-5` ship, phòng `department`/`project` chỉ có thành viên từ lúc migration backfill (DB-1) — không tự cập nhật khi nhân sự đổi phòng ban/dự án. `syncRoomMembership` đã sẵn sàng nhận cuộc gọi từ BE-5 nhưng không ai gọi tới lúc đó. Theo chuỗi thi công của WAVE, BE-5 chạy **song song** RT-1 (cả hai chỉ phụ thuộc BE-1), không phụ thuộc RT-1 — rủi ro thời gian thấp.
4. **Multi-instance join/leave (đo thật #7) mới verify được ở tầng "API đúng"**, chưa có test THẬT chạy 2 process Node + Valkey thật trong CI để chứng minh `socketsJoin` cross-instance hoạt động khi triển khai PROD nhiều instance. Rủi ro thấp (adapter đã verify implement đúng method, không phải suy đoán) nhưng ghi nhận giới hạn của bộ test.
5. **`openDirect` cần thread cờ `created: boolean`** (§1.6 cảnh báo) — nếu người thi công bỏ sót, lỗi biểu hiện là "mở lại DM cũ vẫn bắn `chat:room created`" — sai nhưng KHÔNG gây rò dữ liệu (chỉ noise UI), nên không phải CRITICAL, vẫn phải sửa trước khi merge (ca test 10 bắt được).
6. FULL gate (`security-reviewer` + `database-reviewer` + `silent-failure-hunter`) **CHƯA chạy** — theo đúng thông lệ, để dành sau khi code xong (không spawn sub-agent ở giai đoạn lập plan).
