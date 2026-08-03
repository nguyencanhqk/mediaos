# Micro-plan — `S7-CHAT-FE-1` (🟡 yellow · LIGHT gate) — rev 2 (02/08/2026), NEO LẠI 03/08/2026

> **rev 1 → `plan-reviewer` chấm BLOCK** (2 điều kiện gỡ khối C1/C2 + 6 HIGH H1..H6). rev 2 vá cả 8, cộng
> danh sách "cũng nên vá" của owner. Không đổi WO/phạm vi tổng thể — vẫn LIGHT gate, vẫn 0 UI.
>
> **Commit-sha NEO LẠI (03/08/2026):** `HEAD = 104294bd` — `docs(chat): CHAT-DEC-013 + 6 micro-plan wave S7
> (5 rev 2 + RT-0 mới) + đồng bộ backlog/STATUS`, đứng trên `631d683e` — `fix(chat): vá FULL gate
> S7-CHAT-BE-1/BE-2 — 1 HIGH + 5 MEDIUM`, đứng trên `54b4d8cd` (mốc đo CŨ của rev 2 — nay đã LỆCH). `git
> status --short`: **SẠCH** (0 file thay đổi). MỌI trích dẫn `file:line` bên dưới đã đo lại trên
> `104294bd`, không còn dựa vào ảnh chụp `54b4d8cd`. **`S7-CHAT-RT-0` giờ ĐÃ CÓ file plan**
> (`docs/plans/S7-CHAT-RT-0.md`, 198 dòng, thêm bởi `104294bd`) — SỬA khẳng định "MISSING" của bản đo
> trước — nhưng **CODE VẪN CHƯA LAND** (`apps/api/src/main.ts` chưa gọi `useWebSocketAdapter`, đo lại ở
> §0). **`S7-CHAT-RT-1` VẪN chỉ là plan doc, CHƯA có code** — `packages/contracts/src/realtime.ts`
> và `apps/api/src/realtime/**` chưa đổi gì so với HEAD (đo lại ở §0).
>
> ⚠️ **BLOCK thiết kế còn MỞ** (nêu bởi `plan-reviewer`, KHÔNG vá ở lần neo lại này — để nguyên cho pass
> sau): `event.affectedUserId` dùng trong §1.7.1 không tồn tại trong payload `chat:room` thật ·
> `socket.io-client` khai sai vị trí/tên gói ở §2 · kiểu trả về của `getAppSocket()` chưa chốt · quy tắc
> FIFO ở §1.7.2 có thể nuốt tin gửi lỗi · vi phạm Rules of Hooks tiềm ẩn ở gate `useChatRealtime` ·
> thiếu 4 file trong `paths` §2. Chỉ số dòng/tên hàm trong plan này được đo lại — quyết định thiết kế
> giữ nguyên.
>
> **WO:** Nền FE chat — `packages/contracts` (2 schema kết quả phụ) + `packages/web-core` (api-client +
> query-keys + **socket dùng chung app-shell**) + store Zustand `apps/app` + hook CHAT tiêu thụ socket đó.
> **Nguồn sự thật:** [SPEC-15 §3.5](<../SPEC/SPEC-15 CHAT.md>) (WS một chiều, CHAT-DEC-005) · **§13.8** (sự
> kiện realtime — ❗rev 1 trích nhầm "§7"; §7 thật của SPEC-15 là *"Mối liên kết với các module khác"*,
> không nói gì về WS) · §9 (CHAT-SCREEN-002) · §11 (bảng cặp quyền) · §13.1 (con trỏ `room_seq`) ·
> [API-13 §5.1](<../API Design/API-13_CHAT_API_Design.md>) · **§7** ("Kênh realtime (không phải REST)" —
> đúng mục, giữ nguyên).
> **Nhánh:** commit lên `wave/s7-chat` (❗KHÔNG `master` — [WAVE §4](<S7-CHAT-WAVE.md>)).
>
> **Phụ thuộc (backlog `harness/backlog.mjs:9816`):** `["S7-CHAT-BE-2", "S7-CHAT-RT-1", "S7-CHAT-RT-0"]`.
> `S7-CHAT-BE-2` code **đã land** (commit `54b4d8cd`, xác nhận lại ở §0) dù backlog vẫn ghi `status:"todo"`
> cho cả ba (ledger chưa đóng dấu — không phải tín hiệu code chưa xong). `S7-CHAT-RT-1` **và**
> `S7-CHAT-RT-0` đều **CHƯA có code**. `S7-CHAT-RT-0` (`backlog.mjs:9737-9766`) giờ **ĐÃ có file plan**
> (`docs/plans/S7-CHAT-RT-0.md`, đo `test -f` 03/08/2026 — sửa khẳng định "MISSING" của bản đo trước),
> nhưng phần code (`main.ts` gọi `useWebSocketAdapter`) chưa land (đo lại ở §0). RT-0 §1.5-§1.6 giao
> ngược hai việc cho FE-1, không phải quyết định mới của plan này: (a) tự chốt `transports` phía client
> khi tới lúc code — RT-0 CHỦ Ý không quyết thay (test cả `["polling","websocket"]` mặc định lẫn
> `["websocket"]` ở phía server); (b) chấp nhận giới hạn "client Node không thực thi CORS nên int-spec
> KHÔNG chứng minh được hành vi trình duyệt thật" — khớp đúng nhánh mặc định §1.6 mà plan này đã thiết kế
> sẵn (xem hàng RT-0 ở §0). Người thi công FE-1 **PHẢI** xác nhận cả hai `status:"done"` trong backlog
> trước khi bắt đầu code — plan này viết trước cả hai tồn tại, y hệt tình huống rev 1, nhưng rev 2 đã sửa
> để KHÔNG còn tự chế hợp đồng yếu hơn bản thật sẽ có (xem H1 §1.5).

---

## 0. Đo thật trước khi thiết kế (đo lại toàn bộ cho rev 2, không tái dùng số đo rev 1)

| Thứ | Đo được 02/08/2026 | Nguồn |
| --- | --- | --- |
| `paths` của WO này | `packages/contracts/src/chat.ts` · `packages/web-core/src/**` · `apps/app/src/**` · plan doc | `harness/backlog.mjs:9809-9814` |
| Nền BE-1 (rooms/members) | **Đã commit** (`c77f48e0`) — 11 route thật | `apps/api/src/chat/chat-rooms.controller.ts:65-180` |
| Nền BE-2 (tin nhắn) | **Đã commit** (`54b4d8cd`) — 8 route thật (`GET/POST messages`, `recall`, `pin`/`unpin`, `pinned`, `POST read`, `GET unread-count`) | `docs/plans/S7-CHAT-BE-2.md:112-125` |
| `listRooms` trả **mảng trần** | `async listRooms(...): Promise<ChatRoomDto[]>` — KHÔNG wrapper `{data,meta}` | `apps/api/src/chat/chat-rooms.service.ts:65-72` |
| `unreadCount` per-room LUÔN là số | `unreadCount ?? row.unreadCount ?? 0` | `apps/api/src/chat/chat.mapper.ts:65` |
| **`chatMessageSchema.body` ĐÃ `.nullable()`** (SỬA số đo SAI của rev 1 §0) | `body: z.string().nullable()`, comment trích đúng `server-masking-needs-optional-fe-schema` — BE-2 land xong việc này, FE-1 KHÔNG còn gì phải sửa ở field này | `packages/contracts/src/chat.ts:69` |
| **`chatMessageSchema.roomSeq` ĐÃ có, BẮT BUỘC** (SỬA số đo SAI của rev 1 §0) | `roomSeq: z.number().int().positive()` — KHÔNG `.optional()`. Trường `seq` (cấp bảng) không còn xuất hiện trong DTO | `packages/contracts/src/chat.ts:97` |
| **`chatMessageSchema` KHÔNG mang `clientMessageId`** | DTO đọc (REST GET + WS `chat:message` — `wsChatMessageEventSchema = chatMessageSchema`, tái dùng nguyên, không phải bản sao) không có khoá này — chỉ `sendMessageSchema` (request POST) có; server lưu cột này để dedupe nhưng không echo lại qua response object | `packages/contracts/src/chat.ts:52-100` (`chatMessageSchema`) · `:102-119` (`sendMessageSchema`, `clientMessageId` dòng 114) · `packages/contracts/src/realtime.ts:70` (`wsChatMessageEventSchema`) · `apps/api/src/chat/chat-messages.repository.ts:106` |
| **2 route trả shape KHÁC `chatRoomSchema`** | `leaveRoom` → `Promise<{left: true}>`; `removeMember` → `Promise<{removed: true}>` — parse response bằng `chatRoomSchema` cho hai hàm này ăn `ZodError` (thiếu toàn bộ field bắt buộc của phòng) | `apps/api/src/chat/chat-rooms.service.ts:295,315` · `apps/api/src/chat/chat-members.service.ts:141,162` |
| **C1 — root cause thật của "WS không mở được từ trình duyệt"** | `ValkeyIoAdapter` (nơi DUY NHẤT set `cors` Socket.IO từ `CORS_ORIGIN` — `createIOServer`) **chưa bao giờ được gắn**: grep `useWebSocketAdapter` (không tính `node_modules`) = **0 hit** trong `apps/api/src/**`. `main.ts` KHÔNG gọi `app.useWebSocketAdapter(...)` lẫn `connectToValkey(...)` — `bootstrap()` chỉ gọi `app.enableCors()` (chỉ áp HTTP, KHÔNG áp engine.io) rồi `app.listen()` thẳng | `apps/api/src/main.ts:27-63` (0 dòng nào nhắc `ValkeyIoAdapter`) · `apps/api/src/realtime/valkey-io.adapter.ts:60-71` |
| Vì sao lỗ sống sót tới giờ | Client WS DUY NHẤT trong repo hiện tại là client Node (`realtime.gateway.io.spec.ts`) — Node không thực thi CORS nên int-spec không bao giờ chạm lỗ này | `harness/backlog.mjs:9757` (đo của `S7-CHAT-RT-0`) |
| **Việc vá C1 đã tách WO riêng, NGOÀI `paths` FE-1** | `S7-CHAT-RT-0` (`zone:"red"`, `paths: ["apps/api/src/main.ts","apps/api/src/realtime/**",...]`) — FE-1 **KHÔNG được** đụng `main.ts`/`realtime/**`. FE-1 chỉ phải **chịu đựng đúng** trạng thái "kết nối lỗi mà không biết lý do" (§1.6) chừng nào RT-0 chưa `done` | `harness/backlog.mjs:9737-9766` |
| **RT-0 giao ngược 2 việc cho FE-1 khi tới lúc thi công** (không phải quyết định mới của lần neo lại này) | (a) `transports` phía client — RT-0 CHỦ Ý không chốt thay, tự test cả `["polling","websocket"]` (mặc định) và `["websocket"]` ở phía server để FE-1 tự chọn theo nhu cầu mạng người dùng thật; (b) giới hạn: test `socket.io-client` (Node) của RT-0 KHÔNG thực thi Same-Origin Policy nên KHÔNG chứng minh được hành vi trình duyệt thật — khớp đúng phát hiện FE-1 tự đo ở hàng dưới (`harness/backlog.mjs:9757`) và nhánh mặc định §1.6 mà FE-1 đã thiết kế sẵn | `docs/plans/S7-CHAT-RT-0.md` §1.5 (dòng 96-98) · §1.6 (dòng 100-102) |
| Sự kiện WS v1 theo SPEC | 4 sự kiện server→client: `chat:message` · `chat:message-recalled` · `chat:read` · `chat:room`; **0** `@SubscribeMessage` (một chiều, CHAT-DEC-005) | SPEC-15 §13.8 |
| **`realtime.ts` HIỆN TẠI (HEAD `104294bd`) vẫn LỆCH SPEC v1 y hệt rev 1 đo** — RT-1 CHƯA code | `WS_EVENTS` còn 5 sự kiện client→server đời cũ (`CHAT_JOIN`/`LEAVE`/`SEND`/`TYPING`/`PRESENCE_LIST`) + `wsChatSendAckSchema`/`wsPresenceListAckSchema`/`wsAckSchema`; `chat:message-recalled`/`chat:read`/`chat:room` **CHƯA có schema nào** — xác nhận file này 0 thay đổi so với rev 1 vì `S7-CHAT-RT-1` còn `status:"todo"` | `packages/contracts/src/realtime.ts:16-114` |
| **RT-1 rev 2 (plan, chưa code) ĐÃ CHỐT hình dạng 3 schema còn thiếu** — FE-1 không được tự đoán khác | `wsChatRoomActionSchema = z.enum(["created","updated","archived","member_added","member_removed","member_role_changed","left"])`; `wsChatRoomEventSchema = z.object({roomId, action, room: chatRoomSchema.omit({unreadCount:true}).optional()})` — `room` **CHỈ** điền cho `created`/`updated`/`archived`; `wsChatMessageRecalledEventSchema = {messageId, roomId, recalledAt}` (KHÔNG kèm `body`); `wsChatReadEventSchema = {roomId, userId, lastReadSeq}` (đơn vị `room_seq`) — trích theo TÊN SCHEMA, không theo số dòng, vì RT-1 đang ở rev 2 và có thể neo lại tiếp | `docs/plans/S7-CHAT-RT-1.md` (rev 2) §1.3 `wsChatMessageRecalledEventSchema`/`wsChatReadEventSchema` · §1.4 `wsChatRoomActionSchema`/`wsChatRoomEventSchema` |
| RT-1 rev 2 cũng đã chốt xoá 7 event-key cũ (`CHAT_JOIN`/`CHAT_LEAVE`/`CHAT_SEND`/`CHAT_TYPING`/`CHAT_PRESENCE_LIST`/`CHAT_TYPING_EVENT`/`CHAT_PRESENCE`) + 10 schema chết + đổi `WS_EVENTS.CHAT_MESSAGE_RECALLED="chat:message-recalled"`/`CHAT_READ="chat:read"`/`CHAT_ROOM="chat:room"` | | `docs/plans/S7-CHAT-RT-1.md` (rev 2) §1.5 |
| Gateway hiện tại CHƯA join phòng chat | `handleConnection` chỉ `client.join(userRoomName(...))` | `apps/api/src/realtime/realtime.gateway.ts:84-94` |
| Auth handshake WS đọc token ở đâu | `client.handshake.auth.token` **hoặc** header `Authorization: Bearer …`; sai/thiếu → `next(new Error("unauthorized"))`; `REALTIME_ENABLED=false` → `next(new Error("realtime_disabled"))` cho MỌI client | `apps/api/src/realtime/realtime.gateway.ts:54-79,104-109` |
| **0 client WS ở FE hiện tại** | Grep `socket\|WS_NAMESPACE\|io(` trên `packages/web-core/src` + `apps/app/src` = 0 kết quả. `NotificationBadge` chỉ poll REST mỗi 30s | `apps/app/src/components/notifications/NotificationBadge.tsx` |
| **Cặp quyền: `access:chat` ≠ `view:chat-room`, hai việc khác nhau** | `('access','chat')` = *"cổng nav + panel nổi"*; `('view','chat-room')` = *"xem phòng · đọc tin"* — và `GET /chat/rooms` (route bootstrap FE-1 gọi) đòi ĐÚNG `view:chat-room`, không phải `access:chat` | SPEC-15 §11 dòng 298-299 · `apps/api/src/chat/chat-rooms.controller.ts:67` |
| `socket.io-client` hiện chỉ ở `apps/api` | `"socket.io-client": "^4.8.3"` trong `devDependencies`, KHÔNG có ở `apps/app/package.json` | `apps/api/package.json:64` |
| Base URL FE có prefix REST, WS thì KHÔNG | `getApiBaseUrl()` trả `http://localhost:3100/api/v1`; namespace Socket.IO đăng ký gốc + `/ws`. **Không có** `VITE_WS_URL` (`apps/app/.env` chỉ có `VITE_API_URL`) | `packages/web-core/src/lib/api-client.ts:32-33` · `packages/contracts/src/realtime.ts:13` · `apps/app/.env:2` |
| Access token + refresh export công khai | `getAccessToken()` đọc Zustand in-memory; `refreshAccessToken()` single-flight | `packages/web-core/src/stores/auth.ts:83-85` · `packages/web-core/src/lib/api-client.ts:264-271` · `packages/web-core/src/index.ts:9,27` |
| Shell mount-once thật sự | `ProtectedShell` bọc mọi route đã đăng nhập, chỉ render nhánh nội dung khi `isAuthenticated && user`; đăng xuất là hard navigation `window.location.href` | `apps/app/src/layouts/protected/ProtectedShell.tsx:87,99,115` |
| `<StrictMode>` bật ở FE | `main.tsx:57` — effect nào connect tài nguyên singleton phải chịu double-invoke | `apps/app/src/main.tsx:57` |
| Store Zustand app-local đã có tiền lệ | `useLayoutStore` ở `apps/app/src/stores/layout.store.ts` (KHÔNG ở `web-core`) | `apps/app/src/stores/layout.store.ts:1-58` |
| Khuôn `xxxApi` + `xxxKeys` đã chốt | `lib/<module>-api.ts` mảng trần `z.array(itemSchema)` + `<module>Keys` trong `query-keys.ts` | `packages/web-core/src/lib/goal-api.ts:1-70` |
| Test spec **colocated**, KHÔNG `apps/app/test/` | `vitest.config.ts` FE: `include: ["src/**/*.spec.{ts,tsx}"]` — đặt spec ngoài `src/**` là **không chạy, xanh giả** | `apps/app/vitest.config.ts:14` |
| Không có `no-restricted-imports` nào cho `socket.io-client` hiện tại | Grep `no-restricted-imports` trong `eslint.config.mjs` = 0 hit — "chỉ 1 file được import" hiện chỉ là quy ước bằng lời, không có cơ chế | `eslint.config.mjs` (toàn file) |
| `query-invalidation-contract.spec.ts` là nguồn thật, không phải suy đoán | Pin invalidation cho mutation ĐÃ CÓ UI gọi | `packages/web-core/src/lib/query-invalidation-contract.spec.ts` |
| Không có lib mock WS nào trong repo | `pnpm-lock.yaml` không có `mock-socket`/`socket.io-mock` | grep `pnpm-lock.yaml` = 0 hit |

---

## 1. Lựa chọn thiết kế — chốt ở đây, không để người thi công tự quyết

### 1.1 Ranh giới các tầng — cập nhật cho rev 2

| Tầng | Gì | Lý do |
| --- | --- | --- |
| `packages/contracts/src/chat.ts` | Additive **CHỈ 2 schema kết quả mới** (§1.4 dưới) — KHÔNG đụng `body`/`roomSeq` (đã đúng, BE-2 land rồi) | Tránh sửa lại field một WO khác đã chốt và test đã pin |
| `packages/web-core/src/lib/chat-api.ts` (mới) | `chatApi` — mirror 11 route BE-1 + 8 route BE-2, **TẤT CẢ ĐỀU THẬT** (không còn "ASSUMED" như rev 1 vì cả hai đã commit) | Đúng khuôn `goal-api.ts` |
| `packages/web-core/src/lib/query-keys.ts` | `chatKeys` (+ `rootKeys.chat`) | Đúng khuôn hiện có |
| **`packages/web-core/src/lib/realtime-socket.ts` (mới)** | `getAppSocket()` — singleton Socket.IO **DÙNG CHUNG NOTI + CHAT**, sống ở `web-core` (không phải app-local) | H5 — xem §1.2 |
| `packages/web-core/src/index.ts` | Export `chatApi`, `chatKeys`, `getAppSocket` (+ type) | Barrel |
| `apps/app/src/stores/chat.store.ts` (mới) | Zustand — nguồn sự thật hiển thị (rooms/messages/pending/kết nối) | CHAT chỉ dùng ở `apps/app`, đúng tiền lệ `layout.store.ts` |
| `apps/app/src/hooks/use-chat-realtime.ts` (mới) | Hook CHAT: gọi `getAppSocket()` (KHÔNG tự `io()`), đăng ký/gỡ 4 listener `chat:*`, gate bằng `view:chat-room` | Tách khỏi socket dùng chung — xem §1.2 |
| `eslint.config.mjs` | +1 block `no-restricted-imports` cho `socket.io-client` | H5 — ép cấu trúc, không phải quy ước bằng lời |

### 1.2 MỘT kết nối WS — sở hữu bởi hạ tầng REALTIME CHUNG, không phải CHAT (vá H5)

**Vấn đề rev 1:** `getChatSocket()` sống trong `apps/app/src/hooks/use-chat-realtime.ts`, gate mở kết nối bằng `useCan('access','chat')`. Hai lỗi:

1. Người không có `access:chat` (module CHAT bị tắt cho role của họ) thì **vĩnh viễn không có kết nối `/ws` nào cả** — kể cả `notification:new` (namespace `/ws` đang là namespace DUY NHẤT, dùng chung NOTI). Một tài khoản không được cấp CHAT sẽ mất luôn realtime NOTI, dù NOTI không liên quan gì tới CHAT.
2. WO NOTI-FE (chưa tồn tại) sau này cần một socket cũng namespace `/ws` — nếu không tìm thấy điểm dùng chung, WO đó buộc phải mở `io()` thứ hai, đúng thứ rev 1 tự khoe đã ngăn được ("kết nối thứ hai không có code path để tồn tại" chỉ đúng TRONG `apps/app`, không đúng xuyên module).

**Chốt rev 2 — tách hai lớp:**

```text
packages/web-core/src/lib/realtime-socket.ts
  getAppSocket(): Socket
    - module-private `let socket: Socket | null = null`
    - if (socket) return socket
    - gate DUY NHẤT: phiên đã xác thực (getAccessToken() !== null) — KHÔNG có cặp quyền CHAT nào ở đây
    - socket = io(`${wsOrigin()}/${WS_NAMESPACE}`, { auth: (cb) => cb({ token: getAccessToken() ?? undefined }) })
    - return socket

apps/app/src/hooks/use-chat-realtime.ts
  useChatRealtime()
    - canReadChat = useCan('view', 'chat-room')          // KHÔNG dùng access:chat (xem §1.7 "cũng nên vá")
    - if (!canReadChat) return                             // hook không làm gì — KHÔNG gọi getAppSocket()
    - const socket = getAppSocket()                         // dùng lại, KHÔNG tạo mới
    - bootstrap chatApi.listRooms() (react-query, enabled: canReadChat)
    - đăng ký 4 listener chat:* lên CHÍNH socket đó
    - cleanup: chỉ socket.off(event, handler) — KHÔNG BAO GIỜ socket.disconnect() (§1.3, không đổi)
```

- `getAppSocket()` là hàm **DUY NHẤT** trong toàn repo gọi `io(...)` cho namespace `/ws` phía client — ép bằng ESLint (§1.2.1), không phải quy ước.
- Vì gate mở kết nối chỉ cần "đã đăng nhập", một WO NOTI-FE tương lai gọi thẳng `getAppSocket()` từ `web-core`, đăng ký listener `notification:*` của riêng nó, KHÔNG cần sửa `use-chat-realtime.ts`, KHÔNG mở kết nối thứ hai.
- `access:chat` (cổng nav — SPEC-15 §11) vẫn tồn tại nguyên vẹn cho `S7-CHAT-FE-2`/`FE-3` dùng để ẩn/hiện mục nav + panel nổi — **không xoá cặp quyền này**, chỉ không dùng nó để gate socket.

#### 1.2.1 Ép cấu trúc — `no-restricted-imports`, không phải "grep thủ công trong DoD"

Thêm block sau vào `eslint.config.mjs` (append, cạnh block `apps/web/**` hiện có, KHÔNG sửa block khác):

```js
{
  // S7-CHAT-FE-1: socket.io-client chỉ được import ở ĐÚNG 1 file singleton dùng chung app-shell.
  // Import trực tiếp ở nơi khác = mở kết nối /ws thứ hai — cấm bằng lint, không phải quy ước bằng lời.
  files: ["apps/app/src/**/*.{ts,tsx}", "packages/web-core/src/**/*.{ts,tsx}"],
  ignores: ["packages/web-core/src/lib/realtime-socket.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      { paths: [{ name: "socket.io-client", message: "Dùng getAppSocket() từ @mediaos/web-core — KHÔNG tự io() (xem docs/plans/S7-CHAT-FE-1.md §1.2)." }] },
    ],
  },
},
```

`pnpm lint` xanh ⇒ chứng minh cấu trúc, không cần review-time grep tay. DoD giữ grep như một xác nhận PHỤ (§5), không còn là cơ chế DUY NHẤT.

### 1.3 `<StrictMode>` — KHÔNG disconnect trong cleanup của effect wiring (giữ nguyên rev 1, reviewer khen)

`main.tsx:57` bọc `<StrictMode>`. Cleanup của `useChatRealtime()` chỉ gỡ **listener** (`socket.off(event, handler)`) — KHÔNG BAO GIỜ gọi `socket.disconnect()`. Socket sống tới khi tab đóng/tải lại; đăng xuất là hard navigation (`ProtectedShell.tsx:99`), trình duyệt tự huỷ WS.

### 1.4 Hợp đồng với `S7-CHAT-BE-2` — ĐÃ THẬT, không còn ASSUMED (vá C2)

BE-2 đã commit `54b4d8cd`. Không còn "hợp đồng giả định" — đo trực tiếp DTO thật ở §0. Hệ quả cho phạm vi contracts của FE-1:

- **KHÔNG sửa `chatMessageSchema.body`/`roomSeq`** — cả hai đã đúng hình dạng SPEC đòi. Bất kỳ diff nào của FE-1 chạm 2 field này là dấu hiệu người thi công đang đọc plan cũ (rev 1) thay vì đo lại — DỪNG, đọc lại §0 bảng đo.
- **CHỈ thêm 2 schema kết quả mới**, vì 2 route trả shape khác `chatRoomSchema` (đo thật §0):

```ts
// packages/contracts/src/chat.ts — additive, cuối file, KHÔNG đụng export nào có sẵn

/** Kết quả POST /chat/rooms/:id/leave (CHAT-API-008) — KHÔNG phải ChatRoomDto. */
export const chatLeaveRoomResultSchema = z.object({ left: z.literal(true) });
export type ChatLeaveRoomResult = z.infer<typeof chatLeaveRoomResultSchema>;

/** Kết quả DELETE /chat/rooms/:id/members/:userId (CHAT-API-007b) — KHÔNG phải ChatRoomDto. */
export const chatRemoveMemberResultSchema = z.object({ removed: z.literal(true) });
export type ChatRemoveMemberResult = z.infer<typeof chatRemoveMemberResultSchema>;
```

- `chatApi.leaveRoom`/`chatApi.removeMember` trong `chat-api.ts` PHẢI parse response bằng 2 schema trên — parse bằng `chatRoomSchema` cho 2 hàm này là bug đã biết trước (§0), không phải lỗi ngầm phát hiện sau.
- Mọi hàm còn lại của `chatApi` (11 route BE-1 + 6 route BE-2 còn lại: `getMessages`/`sendMessage`/`recallMessage`/`pinMessage`/`unpinMessage`/`getPinned`/`markRead`/`getUnreadCount`) map 1:1 route thật, KHÔNG còn comment `🚧 ASSUMED CONTRACT` — route/DTO đã xác nhận ở §0.
- Badge tổng chưa đọc: **derive client-side** (tổng `unreadCount` từng phòng trong `roomsById`), KHÔNG gọi `GET /chat/unread-count` (CHAT-API-016) — dù route này giờ đã có thật (BE-2), giữ quyết định của rev 1: badge thật lên UI ở `FE-3`, không phải WO này.

### 1.5 Hợp đồng với `S7-CHAT-RT-1` — CÓ ĐIỀU KIỆN, không tự dựng bản sao yếu hơn (vá H1)

**Vấn đề rev 1:** viết sẵn `apps/app/src/hooks/chat-ws-events.ts` với schema tạm cục bộ — trong đó `wsChatRoomSchema.action: z.string()` (chuỗi bất kỳ). Nhưng RT-1 (dù mới là plan) đã CHỐT `action` là **enum 7 giá trị cụ thể** (`wsChatRoomActionSchema`, §0). Vì `FE-1.depends_on` **BẮT BUỘC** `S7-CHAT-RT-1` phải `status:"done"` trước khi FE-1 bắt đầu, tới lúc người thi công thật sự viết code, `packages/contracts/src/realtime.ts` PHẢI ĐÃ CÓ 3 schema thật rồi. Bản sao cục bộ của rev 1 là **hàng chết yểu ngay từ lúc tạo ra** — yếu hơn bản thật (mất kiểm tra enum), tồn tại 0 phút trước khi bị xoá theo đúng kế hoạch dọn nợ của rev 1.

**Chốt rev 2 — quy trình có điều kiện, không viết code thừa:**

1. **Trước khi viết `use-chat-realtime.ts`**, người thi công BẮT BUỘC `grep "wsChatRoomEventSchema\|wsChatMessageRecalledEventSchema\|wsChatReadEventSchema" packages/contracts/src/realtime.ts`.
2. **Có kết quả** (trường hợp bình thường, vì RT-1 là dependency cứng) → **import thẳng** 3 schema + `WS_EVENTS.CHAT_MESSAGE_RECALLED`/`CHAT_READ`/`CHAT_ROOM` từ `@mediaos/contracts`. KHÔNG tạo `chat-ws-events.ts`. `chat:message` vẫn dùng `wsChatMessageEventSchema` đã có từ trước (không đổi).
3. **Không có kết quả** (RT-1 lệch backlog — status ghi `"done"` nhưng code chưa land, hoặc người thi công cố tình vi phạm `depends_on`) → **DỪNG, KHÔNG viết `use-chat-realtime.ts`**. Ghi lại trong PR/commit lý do dừng, quay lại khi RT-1 thật sự land. Đây KHÔNG phải lỗi cần code phòng thủ — là tín hiệu "phụ thuộc chưa xong, đừng code theo trí nhớ của plan" (banner đầu file, giữ nguyên tinh thần rev 1).

`apps/app/src/hooks/chat-ws-events.ts` **BỊ GỠ KHỎI PHẠM VI THI CÔNG BẮT BUỘC** của §2. Namespace kết nối: `` `${wsOrigin}/${WS_NAMESPACE}` `` — `WS_NAMESPACE` import thật từ `@mediaos/contracts` (không đổi).

Mọi payload nhận từ socket qua `.safeParse()` bằng schema THẬT trước khi merge vào store — payload sai hình dạng thì log + bỏ qua, KHÔNG throw (không đổi so với rev 1).

### 1.6 Vòng đời kết nối — 4 trạng thái, có nhánh mặc định (vá C1 phần đuôi + H3)

**Vấn đề rev 1:** máy trạng thái chỉ xử lý đúng 2 message `connect_error` (`"unauthorized"`/`"realtime_disabled"`). Với C1 đã xác nhận: cho tới khi `S7-CHAT-RT-0` land, trình duyệt gặp lỗi CORS ở handshake Socket.IO — message lỗi đó **không phải** 1 trong 2 message trên (kiểu `"xhr poll error"`/transport error), làm app kẹt `'connecting'` vĩnh viễn, và **hoàn toàn không có** listener cho sự kiện `disconnect` (rớt mạng giữa phiên đang `'connected'` thì trạng thái không đổi, poll bù không kích hoạt vì điều kiện đang là `connectionStatus !== 'connected'` mà state vẫn báo `'connected'` sai sự thật).

```text
type ChatConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'polling-fallback'

'connecting' (khởi tạo)
  │
  ├─ 'connect' (thành công) ──────────────────────────────► 'connected'
  │                                                                │
  │                                              'disconnect' (BẤT KỲ lý do nào) │
  │                                                                ▼
  │                                                         'disconnected'
  │                                                                │
  │                                              'connect' (reconnect tự động) │
  │                                                                ▼
  │                                              CATCH-UP MỘT LẦN NGAY (không đợi 10s):
  │                                              - với MỌI roomId ∈ subscribedRoomIds:
  │                                                  chatApi.getMessages(roomId, {afterSeq: lastKnownSeq[roomId]})
  │                                              - refetch chatApi.listRooms() (đổi tên/thành viên lỡ trong lúc đứt)
  │                                              rồi chuyển 'connected'
  │
  ├─ connect_error("unauthorized") ──► refreshAccessToken() 1 lần, để socket.io-client tự backoff-retry
  │                                     (không đổi connectionStatus, auth callback đọc token MỚI mỗi lần thử)
  │
  ├─ connect_error("realtime_disabled") ──► 'polling-fallback' — TẮT auto-reconnect (server fail-closed
  │                                          THEO CHỦ ĐÍCH qua REALTIME_ENABLED=false); mọi phòng đang
  │                                          subscribe bù bằng afterSeq mỗi 10s
  │
  └─ connect_error(BẤT KỲ message nào KHÁC 2 cái trên — nhánh MẶC ĐỊNH, vá C1) ──► 'disconnected'
                                          — auto-reconnect socket.io-client MẶC ĐỊNH vẫn chạy nền (không tắt,
                                          khác 'realtime_disabled'); nếu cuối cùng connect được, 'connect' tự
                                          đưa về 'connected' + catch-up như nhánh reconnect ở trên. Đây CHÍNH
                                          là nhánh sẽ chạy trong lúc S7-CHAT-RT-0 chưa land: người dùng thấy
                                          "đang kết nối lại" thay vì app đứng hình vô thời hạn ở 'connecting'.
```

Quy tắc poll bù (không đổi từ rev 1): mọi phòng ∈ `subscribedRoomIds` tự bù `afterSeq` mỗi 10s (`setInterval`, dọn khi `unsubscribeFromRoom`) khi `connectionStatus !== 'connected'` — điều kiện này giờ ĐÚNG cho cả `'connecting'`, `'disconnected'`, `'polling-fallback'`, không chỉ 1 trong 4.

`io(url, { auth: (cb) => cb({ token: getAccessToken() ?? undefined }) })` — hàm, không phải object tĩnh (không đổi, reviewer khen ở rev 1).

### 1.7 Store — cấu trúc đầy đủ, chốt hành vi `chat:room` + gửi lạc quan (vá H2, H4, H6)

`useChatStore`:

```ts
interface ChatStoreState {
  roomsById: Record<string, ChatRoomDto>;
  roomOrder: string[];                              // sort theo lastMessageAt DESC, null cuối cùng (§4 ca 12)
  messagesByRoom: Record<string, ChatMessageDto[]>;  // trần MAX 200 tin/phòng (§4 ca 28), tăng dần theo roomSeq
  pendingByClientId: Record<string, PendingChatMessage>;
  connectionStatus: ChatConnectionStatus;
  subscribedRoomIds: Record<string, { pollIntervalId: ReturnType<typeof setInterval> | null }>;
}

interface PendingChatMessage {
  clientMessageId: string;
  roomId: string;
  body: string;
  createdAt: string;
  status: 'sending' | 'failed';
  resolvedMessageId?: string;   // gán khi WS echo về TRƯỚC response POST (§4 ca 18)
}
```

#### 1.7.1 `upsertRoom`/`applyRoomEvent` — allowlist, KHÔNG full-replace (vá H2)

**Vấn đề rev 1:** chữ ký `upsertRoom` không chốt merge hay thay-nguyên-object. Payload `chat:room` từ RT-1 CỐ Ý `.omit({unreadCount:true})` — nếu code thay nguyên `roomsById[id] = incomingPartial`, `unreadCount` (field per-member, không nằm trong payload) biến mất/về `undefined` mỗi lần ai đó đổi tên/lưu trữ phòng, badge phòng đó **về 0 sai** dù không ai đọc tin gì thêm.

**Chốt:** `hydrateRooms` (từ REST, full object) khác hẳn `applyRoomEvent` (từ WS, object thiếu field CỐ Ý) — hai hàm riêng, KHÔNG dùng chung một "upsert tổng quát":

```text
hydrateRooms(rooms: ChatRoomDto[])
  — REST listRooms trả full object (CÓ unreadCount đúng) → SET THẲNG roomsById[r.id] = r cho từng room.

applyRoomEvent(event: WsChatRoomEvent)   // event.action ∈ 7 giá trị enum RT-1 (§1.5)
  case "created":
    nếu event.room có mặt:
      nếu roomsById[event.roomId] ĐÃ tồn tại (trùng lặp/đua) → bỏ qua (idempotent)
      ngược lại → chèn { ...event.room, unreadCount: 0 }   // phòng mới, chưa có tin nào lúc tạo
    nếu event.room KHÔNG có mặt (không đúng hợp đồng RT-1 nhưng fail-soft) → gọi lại chatApi.listRooms()
  case "updated" | "archived":
    nếu roomsById[event.roomId] tồn tại VÀ event.room có mặt:
      roomsById[event.roomId] = { ...roomsById[event.roomId], ...ALLOWLIST_MERGE(event.room) }
      // ALLOWLIST_MERGE chỉ lấy: name, description, isArchived, lastMessageAt, lastMessageSeq
      // ⚠️ TUYỆT ĐỐI KHÔNG ghi đè unreadCount — event.room vốn dĩ không có khoá này (Zod .omit strip),
      //    nhưng ALLOWLIST_MERGE tường minh là lớp phòng thủ THỨ HAI, không dựa may rủi vào .omit
    ngược lại → bỏ qua (không có gì để cập nhật)
  case "member_added":
    nếu event.affectedUserId === myUserId VÀ roomsById[event.roomId] chưa có:
      // room KHÔNG có mặt trong payload action này (bảng RT-1 §1.4) — PHẢI fetch, không suy diễn
      → hook gọi chatApi.getRoom(event.roomId) rồi store.hydrateRooms([dto])
    khác → no-op (danh sách thành viên không thuộc phạm vi store FE-1 — FE-2/3 tự mở rộng nếu cần)
  case "member_removed" | "left":
    nếu event.affectedUserId === myUserId:
      removeRoomForSelf(event.roomId)   // xem 1.7.3
    khác → no-op
  case "member_role_changed":
    no-op (đổi vai trò không đổi metadata phòng lẫn danh sách phòng của FE-1)
```

Ca test 25/26 ở §4 pin bằng runtime: phòng `unreadCount:5` nhận `chat:room{action:"updated"}` → vẫn `5`.

#### 1.7.2 Gửi lạc quan + ghép với echo WS (vá H4)

**Vấn đề rev 1:** `chatMessageSchema` không có `clientMessageId` (§0) — bản lạc quan (khoá `clientMessageId`) và bản `chat:message` từ WS (khoá `id`) không tự ghép được. Echo WS thường về TRƯỚC response POST (WS là push tức thời, HTTP response còn phải round-trip thêm) ⇒ rev 1 không có quy tắc reconcile ⇒ hai bong bóng.

**Chốt — 2 action, 1 quy tắc FIFO theo phòng:**

```text
applyOptimisticSend(clientMessageId, roomId, body)
  pendingByClientId[clientMessageId] = { clientMessageId, roomId, body, createdAt: now(), status: 'sending' }
  // UI (FE-2, ngoài phạm vi WO này) đọc messagesByRoom[roomId] GHÉP với
  // Object.values(pendingByClientId).filter(p => p.roomId === roomId && !p.resolvedMessageId) để vẽ bong bóng tạm

applyIncomingMessage(message: ChatMessageDto)   // nguồn: WS chat:message HOẶC response POST đã .parse()
  nếu messagesByRoom[message.roomId] đã có message.id → bỏ qua (dedupe theo id, ca 9 không đổi)
  nếu message.senderId === myUserId:
    tìm entry CŨ NHẤT trong pendingByClientId có roomId === message.roomId, status === 'sending',
      resolvedMessageId === undefined   // FIFO — tin gửi trước server cấp room_seq trước, do khoá hàng phòng (BE-2 §1.2)
    nếu tìm thấy pending:
      pending.resolvedMessageId = message.id
      chèn message vào messagesByRoom[message.roomId] (thay bong bóng tạm bằng bản thật)
      XOÁ pending khỏi pendingByClientId SAU KHI resolvePendingSend (xem dưới) đã chạy hoặc timeout hợp lý —
        KHÔNG xoá ngay ở đây, vì response POST (đang bay) còn cần đọc resolvedMessageId để biết "khỏi chèn nữa"
      trả về
  // không khớp pending nào (tin của người khác, hoặc gửi lạc quan không qua applyOptimisticSend) → chèn thẳng
  chèn message vào messagesByRoom[message.roomId]

resolvePendingSend(clientMessageId, message: ChatMessageDto | null)   // gọi khi response POST resolve
  pending = pendingByClientId[clientMessageId]
  nếu message === null (gửi lỗi):
    pending.status = 'failed'   // KHÔNG xoá — resend dùng LẠI clientMessageId cũ (SPEC-15 §14, "nút gửi lại")
    return
  nếu pending.resolvedMessageId ĐÃ có (WS echo về trước) → XOÁ pendingByClientId[clientMessageId], KHÔNG chèn gì thêm
  ngược lại (response POST về trước WS, đường thường) → chèn message vào messagesByRoom, XOÁ pendingByClientId[clientMessageId]
```

Ca test 18/19/20 ở §4 pin cả 2 thứ tự tới + ca thất bại.

#### 1.7.3 `removeRoomForSelf` — dọn store khi bị bớt khỏi phòng (vá H6)

```text
removeRoomForSelf(roomId)
  xoá roomsById[roomId]
  xoá roomId khỏi roomOrder
  xoá messagesByRoom[roomId]
  nếu subscribedRoomIds[roomId] tồn tại: clearInterval(subscribedRoomIds[roomId].pollIntervalId); xoá khoá
```

Rev 1 chỉ có `upsertRoom` chung chung — bị bớt khỏi phòng (`chat:room{action:"member_removed"|"left", affectedUserId: mình}`) sẽ để lại rác: phòng vẫn còn trong `roomsById`/`roomOrder` (badge/tên phòng "ma"), `messagesByRoom[roomId]` vẫn giữ toàn bộ lịch sử của phòng mình không còn quyền đọc, và nếu đang subscribe thì interval poll tiếp tục gọi `GET messages` cho một phòng giờ trả 404 (đã rời — `assertMember` chặn) mỗi 10 giây vô thời hạn.

---

## 2. Phạm vi thi công

| File | Việc |
| --- | --- |
| `packages/contracts/src/chat.ts` | Additive **CHỈ** `chatLeaveRoomResultSchema` + `chatRemoveMemberResultSchema` (§1.4). KHÔNG đụng `body`/`roomSeq`/schema phòng-thành viên đã có |
| `packages/web-core/src/lib/chat-api.ts` (mới) | `chatApi` — 11 hàm BE-1 + 8 hàm BE-2, TẤT CẢ THẬT (§1.4); `leaveRoom`/`removeMember` parse bằng 2 schema mới |
| `packages/web-core/src/lib/query-keys.ts` | `rootKeys.chat`, `chatKeys` (rooms: all/list/detail/members) |
| `packages/web-core/src/lib/realtime-socket.ts` (mới) | `getAppSocket()` — singleton, gate = phiên đã xác thực (§1.2) |
| `packages/web-core/src/index.ts` | Export `chatApi`, `chatKeys`, `getAppSocket`, `ChatConnectionStatus` (nếu type cần export) |
| `eslint.config.mjs` | +1 block `no-restricted-imports` cho `socket.io-client` (§1.2.1) |
| `apps/app/package.json` | `"socket.io-client": "^4.8.3"` vào `dependencies` THẬT (khớp version `apps/api`) |
| `pnpm-lock.yaml` | Cập nhật theo `pnpm install` sau khi thêm dependency — **NGOÀI `paths` khai báo hiện tại của WO trong backlog**, phải bổ sung khi cập nhật `harness/backlog.mjs` (§5 DoD) |
| `apps/app/src/stores/chat.store.ts` (mới) | Zustand đầy đủ theo §1.7: `hydrateRooms`/`applyRoomEvent`/`removeRoomForSelf`/`applyOptimisticSend`/`applyIncomingMessage`/`resolvePendingSend`/`setConnectionStatus`/`subscribeToRoom`/`unsubscribeFromRoom`/`createClientMessageId`; trần `messagesByRoom` = 200 tin/phòng (FIFO evict tin CŨ NHẤT khi vượt, không evict entry đang trong `pendingByClientId`) |
| `apps/app/src/hooks/use-chat-realtime.ts` (mới) | Gate `useCan('view','chat-room')` → `getAppSocket()` (KHÔNG tự `io()`) → bootstrap `chatApi.listRooms()` (react-query, `enabled: canReadChat`) → `hydrateRooms` → đăng ký 4 listener (grep contracts theo §1.5 TRƯỚC khi viết) → máy trạng thái §1.6 (bao gồm `disconnect`/reconnect catch-up) → poll `afterSeq` khi `connectionStatus !== 'connected'` |
| `apps/app/src/layouts/protected/ProtectedShell.tsx` | **+1 dòng**: `useChatRealtime();` cạnh `useFavicon(...)` (dòng 87) — append, không rewrite |

**KHÔNG** tạo `apps/app/src/hooks/chat-ws-events.ts` (§1.5) trừ khi nhánh "dừng" của §1.5 kích hoạt — nếu vậy, KHÔNG code tiếp, không phải tạo file thay thế.

---

## 3. KHÔNG làm trong WO này

- ❌ Bất kỳ UI nào — trang `/chat`, panel nổi, badge header, hộp thoại tạo nhóm. Đó là `S7-CHAT-FE-2`/`FE-3`.
- ❌ Sửa `packages/contracts/src/realtime.ts` — thuộc `paths` của `S7-CHAT-RT-1`, không phải FE-1; chỉ ĐỌC (import) sau khi RT-1 `done` (§1.5).
- ❌ Sửa `apps/api/src/main.ts` / `apps/api/src/realtime/**` — thuộc `S7-CHAT-RT-0`/`S7-CHAT-RT-1`. FE-1 không tự vá C1; chỉ xử lý ĐÚNG trạng thái lỗi mà nó gây ra (§1.6 nhánh mặc định).
- ❌ Xoá 5 sự kiện WS hai chiều đời cũ trong `realtime.ts` — thuộc `S7-CHAT-RT-1` (đã ghi trong plan RT-1 §1.5, không lặp ở đây).
- ❌ Gọi thật `GET /chat/unread-count` (CHAT-API-016) — badge tổng derive client-side (§1.4), dù route đã có thật.
- ❌ Đang gõ / trạng thái online — ngoài phạm vi v1.
- ❌ Thêm `VITE_WS_URL`/env mới — origin WS tự tách từ `getApiBaseUrl()`.
- ❌ Wire mutation vào nút bấm/form nào — `chatApi.*` là hàm sẵn có, không có UI gọi ở WO này.
- ❌ Thêm entry `chat` vào `query-invalidation-contract.spec.ts` — CHAT chưa có mutation nào được UI gọi ở WO này (không đổi từ rev 1).
- ❌ Cache danh sách/thành viên phòng cho mục đích FE-2/FE-3 (vd hiển thị `members[]` đầy đủ) — store FE-1 chỉ giữ đủ cho infra realtime + badge tổng (§1.7).

---

## 4. Test (vitest, `apps/app` + `packages/web-core`) — colocated `src/**/*.spec.{ts,tsx}` (KHÔNG `apps/app/test/`)

Không chạm DB → không cần `LANE_DB`. Mock `socket.io-client` qua `vi.mock("socket.io-client")`.

**Chứng minh RED cho pin schema (ca 21/22) KHÔNG sửa `packages/contracts/src/chat.ts` thật** — dựng schema CLONE cục bộ trong chính file test (vd `z.object({ body: z.string(), roomSeq: z.number() })` không `.nullable()`/không optional) để đối chứng, KHÔNG bao giờ tạm xoá `.nullable()`/`.optional()` trong file nguồn dùng chung với các WO khác.

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 1 | Gọi `getAppSocket()` nhiều lần | Trả **cùng một** instance (so sánh reference) |
| 2 | Mount `useChatRealtime()` 2 lần liên tiếp (mô phỏng StrictMode) | `io()` (mock) chỉ bị gọi **đúng 1 lần** |
| 3 | Session CHƯA xác thực (`getAccessToken()` trả `null`) | `getAppSocket()` **không** gọi `io()` |
| 4 | Session ĐÃ xác thực nhưng `useCan('view','chat-room')` trả `false` | `getAppSocket()`/`io()` **CÓ** thể được gọi (session hợp lệ) nhưng `chatApi.listRooms` **KHÔNG** được gọi, 4 listener `chat:*` **KHÔNG** được đăng ký lên socket |
| 5 | Origin WS tách từ `getApiBaseUrl()="http://localhost:3100/api/v1"` | `io()` gọi với `"http://localhost:3100/ws"` |
| 6 | Option `auth` truyền cho `io()` | Là **hàm**; gọi hàm đó → invoke `getAccessToken()` |
| 7 | `connect_error` message `"realtime_disabled"` | `connectionStatus: 'polling-fallback'`; auto-reconnect tắt |
| 8 | `connect_error` message `"unauthorized"` | `refreshAccessToken()` (mock) gọi **đúng 1 lần**; `connectionStatus` KHÔNG chuyển `'polling-fallback'` |
| 9 | `connect_error` message **không nhận diện được** (vd `"xhr poll error"`) | `connectionStatus: 'disconnected'`; auto-reconnect **KHÔNG** bị tắt (khác ca 7) — vá C1 |
| 10 | Emit `disconnect` (fake socket) khi đang `'connected'` | `connectionStatus: 'disconnected'` — test đi từ **sự kiện socket phát ra**, không gọi `setConnectionStatus` tay — vá H3 |
| 11 | Emit `connect` (fake socket) sau khi đang `'disconnected'`, có `subscribedRoomIds` với `afterSeq` đã biết, dùng fake timers | `chatApi.getMessages` (mock) được gọi NGAY tại thời điểm `connect` (t=0), KHÔNG đợi tick 10s tiếp theo; `chatApi.listRooms` refetch cũng được gọi; cuối cùng `connectionStatus: 'connected'` — vá H3 |
| 12 | `hydrateRooms([...3 phòng, 1 phòng lastMessageAt: null])` | `roomOrder` sắp theo `lastMessageAt` DESC; phòng `null` xếp **cuối cùng**, không throw/không `NaN` giữa danh sách |
| 13 | Nhận `chat:message` hợp lệ (qua `wsChatMessageEventSchema` thật) 2 lần cùng `id` | `messagesByRoom[roomId]` chỉ có 1 bản ghi |
| 14 | Nhận `chat:message-recalled` (schema THẬT import từ `@mediaos/contracts`, KHÔNG phải clone cục bộ) khớp 1 tin đã cache | `body: null` + `recalledAt` đúng |
| 15 | Nhận payload méo trên bất kỳ 1/4 kênh | `safeParse` fail; store không đổi; không throw |
| 16 | Pin: schema THẬT `chatMessageSchema.safeParse({...hợp lệ, body: null})` | `success: true` |
| 17 | Đối chứng KHÔNG sửa file nguồn: schema CLONE cục bộ (không `.nullable()`) `.safeParse({..., body: null})` | `success: false` — chứng minh `.nullable()` của bản THẬT có tác dụng mà không đụng `chat.ts` |
| 18 | Pin: schema THẬT `chatMessageSchema.safeParse({...hợp lệ, roomSeq: <bỏ trường này>})` | `success: false` — chứng minh `roomSeq` BẮT BUỘC (vá C2) |
| 19 | `createClientMessageId()` gọi 2 lần | 2 giá trị khác nhau |
| 20 | `applyOptimisticSend(id, roomId, body)` rồi `applyIncomingMessage(message thật cùng senderId=mình, roomId)` **TRƯỚC KHI** `resolvePendingSend(id, message)` được gọi | Sau cả 2 bước: `messagesByRoom[roomId]` có **ĐÚNG 1** bản ghi (khoá `message.id`); `pendingByClientId[id]` đã bị xoá sau `resolvePendingSend`; KHÔNG có bong bóng trùng — vá H4, thứ tự "WS về TRƯỚC POST" |
| 21 | Y hệt ca 20 nhưng đảo thứ tự: `resolvePendingSend(id, message)` **TRƯỚC**, `applyIncomingMessage(message trùng id)` **SAU** (mô phỏng WS echo tới muộn) | Vẫn **ĐÚNG 1** bản ghi (dedupe theo `id`, ca 13 chặn) — đường thường vẫn đúng |
| 22 | `resolvePendingSend(id, null)` (gửi lỗi) | `pendingByClientId[id].status === 'failed'`; entry **KHÔNG** bị xoá; gọi lại `applyOptimisticSend` với **CÙNG** `id` không tạo entry thứ hai |
| 23 | `subscribeToRoom(roomId)` khi `connectionStatus` ∈ `{'disconnected','polling-fallback','connecting'}`, fake timers | `chatApi.getMessages` gọi mỗi 10s; `unsubscribeFromRoom` dừng gọi, không leak interval |
| 24 | `subscribeToRoom(roomId)` khi `connectionStatus='connected'` | Poll fallback KHÔNG chạy |
| 25 | Room `unreadCount: 5` trong store, nhận `applyRoomEvent({roomId, action:"updated", room: {...omit unreadCount}})` | `roomsById[roomId].unreadCount` **VẪN LÀ 5** — vá H2 |
| 26 | `applyRoomEvent({roomId, action:"member_removed", affectedUserId: myUserId})` khi phòng đang subscribe (có interval sống) | `roomsById[roomId]` bị xoá; `messagesByRoom[roomId]` bị xoá; `chatApi.getMessages` KHÔNG còn được gọi định kỳ nữa (interval đã `clearInterval`) — vá H6 |
| 27 | `applyRoomEvent({roomId, action:"member_added", affectedUserId: myUserId})`, phòng CHƯA có trong store | `chatApi.getRoom` (mock) được gọi với đúng `roomId`; sau khi resolve, `roomsById[roomId]` được điền |
| 28 | `chatApi.leaveRoom(roomId)` | `apiFetch`/response được parse bằng `chatLeaveRoomResultSchema` (KHÔNG `chatRoomSchema`) — không ném `ZodError` với payload `{left:true}` |
| 29 | Đẩy 205 tin vào `messagesByRoom[roomId]` qua `applyIncomingMessage` liên tiếp | Độ dài mảng dừng ở **200**, tin CŨ NHẤT bị evict trước, tin MỚI NHẤT còn nguyên |
| 30 | `chatApi.listRooms()` | `apiFetch` gọi với schema `z.array(chatRoomSchema)`, KHÔNG `{data,meta}` |
| 31 | `ProtectedShell` render `isAuthenticated=true` | `useChatRealtime` gọi (spy) đúng 1 lần, không nhân bản qua route con |

Coverage mục tiêu ≥80% cho các file mới (`chat-api.ts`, `chat.store.ts`, `use-chat-realtime.ts`, `realtime-socket.ts`).

**Bắt buộc trước khi tin `pnpm typecheck`/chạy test:** `pnpm --filter @mediaos/contracts build` rồi `pnpm --filter @mediaos/web-core build` TRƯỚC khi typecheck/test `apps/app` (bẫy `stale-contracts-dist-typecheck-false-red`, `web-core-stale-dist-white-page` — không đổi từ rev 1).

---

## 5. Definition of Done + nợ/rủi ro

- [ ] `socket.io-client` là dependency THẬT của `apps/app`; version khớp `apps/api` (`^4.8.3`); `pnpm-lock.yaml` cập nhật theo
- [ ] Đúng **MỘT** file (`packages/web-core/src/lib/realtime-socket.ts`) gọi `io()` trong toàn repo phía client — ép bằng ESLint `no-restricted-imports` (§1.2.1), `pnpm lint` xanh là bằng chứng, grep chỉ là xác nhận phụ
- [ ] Gate mở socket = phiên đã xác thực (KHÔNG phải `access:chat`); gate bootstrap/listener CHAT = `useCan('view','chat-room')` (KHÔNG phải `access:chat`) — khớp đúng cặp quyền BE thật sự đòi ở `GET /chat/rooms` (§0)
- [ ] Máy trạng thái 4 nhánh (§1.6) có nhánh mặc định cho `connect_error` không nhận diện được + có listener `disconnect` + catch-up một lần ngay khi reconnect
- [ ] `applyRoomEvent` là allowlist merge, KHÔNG bao giờ ghi đè `unreadCount` từ payload `chat:room`; `member_removed`/`left` với `affectedUserId===mình` dọn sạch store (§1.7.1, §1.7.3)
- [ ] `pendingByClientId` + `applyOptimisticSend`/`applyIncomingMessage`/`resolvePendingSend` ghép đúng bất kể thứ tự WS/POST tới trước (§1.7.2)
- [ ] `packages/contracts/src/chat.ts` CHỈ thêm 2 schema kết quả mới — KHÔNG đụng `body`/`roomSeq` đã đúng
- [ ] Nếu tới lúc thi công `packages/contracts/src/realtime.ts` CHƯA có 3 schema RT-1 hứa → DỪNG, không tự dựng bản sao (§1.5)
- [ ] `createClientMessageId()` sinh 1 lần, action nhận id làm tham số tường minh
- [ ] REBUILD `packages/contracts` + `packages/web-core` dist trước khi tin typecheck
- [ ] 31 ca test §4 xanh, coverage ≥80% trên 4 file mới
- [ ] LIGHT gate (`react-reviewer` + `typescript-reviewer` + `quality-gate`) PASS
- [ ] **Smoke tay bằng trình duyệt thật** (không chỉ test unit): mở `apps/app`, xác nhận đúng **1** kết nối `/ws` trong tab Network, không nhân đôi khi đổi route/mở panel (không nhân đôi vì chưa CÓ panel ở WO này — smoke ở mức "route khác trong app không mở kết nối thứ 2")
- [ ] Cập nhật `harness/backlog.mjs`: `S7-CHAT-FE-1` → `status:"done"`; bổ sung `pnpm-lock.yaml` vào `paths` nếu chưa có (§2)

**Nợ/rủi ro ghi lại tường minh:**

1. **FE-1 phụ thuộc cứng vào `S7-CHAT-RT-0` VÀ `S7-CHAT-RT-1` đều `done`.** Tới thời điểm viết rev 2, cả hai còn `status:"todo"`; `S7-CHAT-RT-0` còn chưa có file plan. Nếu FE-1 bị code trước khi hai WO này xong (vi phạm `depends_on`), toàn bộ §1.5 (import schema thật) và §1.6 (giả định người dùng cuối cùng connect được) sụp — đây không phải rủi ro kỹ thuật, là rủi ro QUY TRÌNH, phải chặn ở cấp điều phối (auto-loop/backlog), không phải plan.
2. **Nhánh mặc định của §1.6 (`connect_error` lạ → `'disconnected'`) là lưới an toàn, KHÔNG phải cách vá C1.** Cho tới khi `S7-CHAT-RT-0` land, người dùng thật vẫn KHÔNG có realtime CHAT/NOTI qua WS — chỉ khác là UI không còn kẹt `'connecting'` vô thời hạn, và poll `afterSeq`/REST vẫn hoạt động đúng (SPEC-15 §14 "mất kết nối" state).
3. **`member_added` với `room` rỗng buộc thêm 1 round-trip `GET /chat/rooms/:id`** (§1.7.1) — chấp nhận được vì tần suất thấp (chỉ khi actor được thêm vào phòng), và đúng hợp đồng RT-1 đã chốt (không tự chế trường `room` mà RT-1 cố ý không gửi).
4. **Store FE-1 không cache `members[]` đầy đủ của phòng** — nếu `S7-CHAT-FE-2`/`FE-3` cần hiển thị "ai vừa được thêm" theo thời gian thực, phải tự mở rộng store hoặc tự query `chatRoomDetailSchema` khi cần, không phải trách nhiệm của WO nền tảng này.
5. **`no-restricted-imports` chỉ chặn được `apps/app/src/**` + `packages/web-core/src/**`** (2 nơi khai trong `files`) — nếu sau này có app FE thứ tư dùng CHAT/NOTI, block ESLint phải mở rộng `files` cùng lúc, không tự động phủ.
6. Plan này không tự chạy `plan-reviewer` lần nữa trước khi giao code — theo CLAUDE.md §6, LIGHT gate không bắt buộc vòng đối kháng. Rev 2 đã vá đúng 8 điều kiện BLOCK + danh sách "cũng nên vá"; nếu người chốt muốn một vòng review nữa trước khi Sonnet code, gọi `plan-reviewer` thủ công.
