# Micro-plan — `S7-CHAT-FE-1` (🟡 yellow · LIGHT gate) — rev 1 (02/08/2026)

> **WO:** Nền FE chat — `packages/contracts` + `packages/web-core` (api-client + query-keys) + store Zustand dùng chung + **MỘT** kết nối WebSocket duy nhất cho toàn app shell `apps/app` (trang full-screen `/chat` của FE-2 và panel nổi của FE-3 dùng CHUNG store + CHUNG socket).
> **Nguồn sự thật:** [SPEC-15 §3.5](<../SPEC/SPEC-15 CHAT.md>) (WS một chiều, CHAT-DEC-005) · §7 (sự kiện realtime) · §9 (CHAT-SCREEN-002) · §13.1 (con trỏ `room_seq`, ĐÍNH CHÍNH 02/08) · §13.8 · §19 · [API-13 §5.1](<../API Design/API-13_CHAT_API_Design.md>) · §7
> **Nhánh:** commit lên `wave/s7-chat` (❗KHÔNG `master` — [WAVE §4](<S7-CHAT-WAVE.md>)).
>
> ⚠️ **Cảnh báo trình tự — đọc trước khi thi công.** WO này viết plan TRƯỚC khi hai WO nó `depends_on`
> (`S7-CHAT-BE-2` tin nhắn, `S7-CHAT-RT-1` realtime) tồn tại — cả hai `status:"todo"` trong
> `harness/backlog.mjs` tại thời điểm viết plan (02/08/2026), ngược quy ước thường lệ của wave ("viết
> **ngay trước** khi thi công WO đó" — `S7-CHAT-WAVE.md` dòng 3). Phần đụng tới tin nhắn/realtime ở
> §1.4/§1.5 dưới đây là **hợp đồng dựng theo tài liệu** (SPEC-15/API-13), **CHƯA có code BE xác nhận**.
> **Người thi công BẮT BUỘC** kiểm `harness/backlog.mjs` (`S7-CHAT-BE-2`, `S7-CHAT-RT-1` phải
> `status:"done"`) và đối chiếu lại DTO/route/event THẬT trước khi tin bất kỳ dòng nào ở hai mục đó —
> nếu lệch, sửa plan trước khi code, đừng code theo trí nhớ của plan.

---

## 0. Đo thật trước khi thiết kế

| Thứ | Đo được 02/08/2026 | Nguồn |
| --- | --- | --- |
| `paths` của WO này | `packages/contracts/src/chat.ts` · `packages/web-core/src/**` · `apps/app/src/**` · plan doc — **KHÔNG** có `packages/contracts/src/realtime.ts` (đó là paths của `S7-CHAT-RT-1`) | `harness/backlog.mjs:9766-9771` |
| Nền BE-1 (rooms/members) | **Đã code**, chưa commit (`git status` untracked `apps/api/src/chat/`) — 11 route thật: `GET/POST rooms`, `POST rooms/direct`, `GET/PATCH rooms/:id`, `POST archive`, `POST leave`, `GET/POST members`, `PATCH/DELETE members/:userId` | `apps/api/src/chat/chat-rooms.controller.ts:65-180` |
| `listRooms` trả **mảng trần** | `async listRooms(...): Promise<ChatRoomDto[]>` — KHÔNG có wrapper `{data,meta}`, khớp bẫy `apifetch-drops-pagination-bare-array` | `apps/api/src/chat/chat-rooms.service.ts:65-72` |
| `unreadCount` per-room LUÔN là số | `unreadCount ?? row.unreadCount ?? 0` (mapper) trên công thức `GREATEST(0, COALESCE(last_message_seq,0) − last_read_seq)` (repo) — không bao giờ `null` | `apps/api/src/chat/chat.mapper.ts:65` · `apps/api/src/chat/chat-rooms.repository.ts:135` |
| **`chatMessageSchema.body` CHƯA `.nullable()`** | `body: z.string(),` — nhưng SPEC-15 §13.6 + `S7-CHAT-BE-2` `src` note đòi thu hồi trả `body:null`; thiếu `.nullable()` = ZodError trắng trang đúng lúc BE-2 ship tính năng thu hồi | `packages/contracts/src/chat.ts:56` |
| **`chatMessageSchema` KHÔNG có `roomSeq`** | Chỉ có `seq` (identity **cấp bảng**, đã bị chính comment trong file cấm dùng cho mọi thứ hướng-client); tên trường thay thế đã **CHỐT SẴN** trong comment: *"BE-2 phải thay bằng `roomSeq` (per-room)… cho MỌI thứ hướng-client: con trỏ beforeSeq/afterSeq, đếm chưa đọc, đã xem bởi"* | `packages/contracts/src/chat.ts:63-78` |
| Sự kiện WS v1 theo SPEC | 4 sự kiện server→client: `chat:message` · `chat:message-recalled` · `chat:read` · `chat:room`; **0** `@SubscribeMessage` (một chiều, CHAT-DEC-005) | SPEC-15 §7, §13.8 |
| **`realtime.ts` hiện tại LỆCH SPEC v1** | `WS_EVENTS` còn 5 sự kiện **client→server** kiểu hai chiều đời cũ: `CHAT_JOIN`/`CHAT_LEAVE`/`CHAT_SEND`/`CHAT_TYPING`/`CHAT_PRESENCE_LIST` + ack `wsChatSendAckSchema`/`wsPresenceListAckSchema` — mâu thuẫn CHAT-DEC-005 và API-13 §4.2 (typing/presence NGOÀI phạm vi v1). Chỉ `CHAT_MESSAGE:"chat:message"` khớp SPEC; **`chat:message-recalled`/`chat:read`/`chat:room` CHƯA có schema nào** | `packages/contracts/src/realtime.ts:16-32,38-65,106-114` |
| Gateway hiện tại CHƯA join phòng chat | `handleConnection` chỉ `client.join(userRoomName(...))` (room cho `notification:new`) — không có logic join phòng chat nào; đó là việc của `S7-CHAT-RT-1` | `apps/api/src/realtime/realtime.gateway.ts:84-94` |
| Auth handshake WS đọc token ở đâu | `client.handshake.auth.token` (string) **hoặc** header `Authorization: Bearer …`; sai/thiếu token → `next(new Error("unauthorized"))`; `REALTIME_ENABLED=false` → `next(new Error("realtime_disabled"))` cho **mọi** client, chạy TRƯỚC `connect` | `apps/api/src/realtime/realtime.gateway.ts:54-79,104-109` |
| **0 client WS ở FE hiện tại** | Grep `socket\|WS_NAMESPACE\|io(` trên `packages/web-core/src` **và** `apps/app/src` = **0 kết quả**. `NotificationBadge` (ứng viên gần nhất) chỉ poll REST `unread-count` mỗi 30s, không đụng WS dù gateway đã tồn tại | `apps/app/src/components/notifications/NotificationBadge.tsx:11,29-34` |
| `socket.io-client` hiện chỉ ở `apps/api` | `"socket.io-client": "^4.8.3"` nằm trong `devDependencies` (dùng cho test gateway), **KHÔNG** có trong `apps/app/package.json` (0 hit ở mọi `dependencies`) | `apps/api/package.json:64` |
| Base URL FE **có** prefix REST, WS thì KHÔNG | `getApiBaseUrl()` trả `http://localhost:3100/api/v1` (`apps/app/.env:2`); namespace Socket.IO đăng ký ở gốc + `/ws` (`WS_NAMESPACE="ws"`), không đi qua `/api/v1`. **Không có** `VITE_WS_URL` nào trong `.env.example` — phải tự tách origin từ `getApiBaseUrl()` | `packages/web-core/src/lib/api-client.ts:7,27-34` · `packages/contracts/src/realtime.ts:13` · `.env.example` (0 hit `VITE_WS_URL`) |
| Access token + refresh đã sẵn, export công khai | `getAccessToken()` đọc Zustand in-memory; `refreshAccessToken()` single-flight (dùng lại được cho WS reconnect-on-401) — cả hai đã export ở barrel `index.ts` | `packages/web-core/src/stores/auth.ts:82-85` · `packages/web-core/src/lib/api-client.ts:264-271` · `packages/web-core/src/index.ts:9,27` |
| Shell mount-once thật sự | `ProtectedShell` là component DUY NHẤT bọc mọi route đã đăng nhập (`GlobalTopbar` + `children` + `AppSwitcher`), chỉ render nhánh nội dung khi `isAuthenticated && user` đã xác nhận; đăng xuất/hỏng phiên là **hard navigation** `window.location.href = getAuthRedirectUrl()` (tự huỷ mọi WS đang mở, không cần code dọn tay) | `apps/app/src/layouts/protected/ProtectedShell.tsx:97-101,130-139` |
| `<StrictMode>` bật ở FE | `main.tsx` bọc `RouterProvider` trong `<StrictMode>` — effect nào connect tài nguyên singleton phải chịu được double-invoke lúc dev | `apps/app/src/main.tsx:57` |
| Store Zustand app-local đã có tiền lệ | `useLayoutStore` sống ở `apps/app/src/stores/layout.store.ts` (KHÔNG phải `web-core` — web-core chỉ giữ `stores/auth.ts`, sự thật CHUNG cả 3 app kể cả `apps/auth`) | `apps/app/src/stores/layout.store.ts:1-58` · `packages/web-core/src/stores/auth.ts` |
| Khuôn `xxxApi` + `xxxKeys` đã chốt | Mọi module (`goal`, `hr`, `task`…) có `lib/<module>-api.ts` (mảng trần dùng `z.array(itemSchema)`, KHÔNG `{data,meta}`) + `<module>Keys`/`<module>Invalidation` trong `query-keys.ts`, cả hai export ở `index.ts` | `packages/web-core/src/lib/goal-api.ts:1-70` · `packages/web-core/src/lib/query-keys.ts:14-27,836-848` · `packages/web-core/src/index.ts:194-195` |
| `useCan`/`useCanExact` đã có sẵn | Không cần dựng mới; `access:chat` là cặp **thường** (`is_sensitive=false`) nên gate bằng `useCan`, KHÔNG cần `useCanExact` (chỉ `view:chat-oversight` mới cần) | `packages/web-core/src/hooks/use-can.ts:13-41` · SPEC-15 §11 dòng `is_sensitive` |
| `S7-CHAT-BE-2` xác nhận endpoint CHƯA có | `done_when` liệt kê `GET messages`/`POST messages`/thu hồi/`POST /read`/`GET /unread-count`/ghim — tất cả `status:"todo"` | `harness/backlog.mjs:9568-9600` |
| Không có lib mock WS nào trong repo | `pnpm-lock.yaml` không có `mock-socket`/`socket.io-mock` — test phải tự `vi.mock("socket.io-client")` | grep `pnpm-lock.yaml` = 0 hit |

---

## 1. Lựa chọn thiết kế — chốt ở đây, không để người thi công tự quyết

### 1.1 Ranh giới 3 tầng — cái gì ở đâu, vì sao

| Tầng | Gì | Lý do |
| --- | --- | --- |
| `packages/contracts/src/chat.ts` | Vá **additive** 2 chỗ (§1.4) — schema DTO, không hành vi | Nguồn sự thật DTO dùng chung server+client (CLAUDE.md §4) |
| `packages/web-core/src/lib/chat-api.ts` (mới) | `chatApi` — REST client 1:1 với `ChatRoomsController` (thật, đã code) + hàm cho tin nhắn (GIẢ ĐỊNH, đánh dấu rõ) | Đúng khuôn `goal-api.ts`/`hr-api.ts` — web-core là nơi 3 app (`app`/`console`/`auth`) DÙNG CHUNG được, dù hiện chỉ `apps/app` cần CHAT |
| `packages/web-core/src/lib/query-keys.ts` | `chatKeys` (+ `rootKeys.chat`) | Đúng khuôn hiện có, không có lý do lệch |
| `apps/app/src/stores/chat.store.ts` (mới) | Zustand — **nguồn sự thật hiển thị** (rooms/messages/unread/trạng thái kết nối) | CHAT chỉ dùng ở `apps/app` (không phải `console`/`auth`) — đúng tiền lệ `layout.store.ts` ở app-local, KHÔNG đẩy lên `web-core` (web-core không có precedent giữ store UI-domain, chỉ giữ `auth` — sự thật phiên đăng nhập DÙNG CHUNG 3 app) |
| `apps/app/src/hooks/use-chat-realtime.ts` (mới) | Singleton `Socket` (module-private, KHÔNG export hàm tạo socket thứ hai) + hook wiring | `socket.io-client` được thêm vào `apps/app` làm dependency THẬT (không phải devDependency như `apps/api`) — đúng done_when |

### 1.2 MỘT kết nối WS — khiến kết nối thứ hai KHÔNG THỂ xảy ra, không phải "đừng làm thế"

Cơ chế ép, không phải quy ước bằng lời:

1. `getChatSocket()` là hàm **DUY NHẤT** trong toàn bộ `apps/app` gọi `io(...)`. Nó **không export** cách tạo `Socket` thứ hai — chỉ có `if (socket) return socket; socket = io(...); return socket`. Không file nào khác trong `apps/app/src/**` được phép import `socket.io-client` trực tiếp (review-time check, không cần ESLint rule mới cho LIGHT gate).
2. Đường nối vào store CHỈ chạy từ **một** hook, `useChatRealtime()`, được gọi ở **một** chỗ — bên trong `ProtectedShell` (nhánh render đã xác thực), thêm **1 dòng** cạnh `useFavicon(...)` đã có, **append KHÔNG rewrite** (`ProtectedShell.tsx:87`).
3. FE-2 (trang `/chat`) và FE-3 (panel nổi) sau này chỉ **đọc** `useChatStore` — không file nào của chúng được gọi `getChatSocket()`/`io()`. "Mở panel không tạo kết nối mới" vì panel **không có code path** để tạo kết nối.
4. Gate bằng `useCan('access', 'chat')` (cặp thường — SPEC-15 §11): người không có quyền vào CHAT thì hook **không** gọi `getChatSocket()` — không hard-code kết nối vô điều kiện, và không lãng phí handshake cho tài khoản chưa được cấp module.

### 1.3 `<StrictMode>` — KHÔNG disconnect trong cleanup của effect wiring

`main.tsx:57` bọc `<StrictMode>` ⇒ dev double-invoke effect (mount→unmount→mount). Nếu cleanup của `useChatRealtime()` gọi `socket.disconnect()`, lần mount thứ hai sẽ tạo một handshake MỚI dù singleton object không đổi — gây nhấp nháy connect/disconnect ở dev, và (tệ hơn) nếu tách sai chỗ, có thể che giấu một logic lẽ ra phải thật sự tách kết nối theo phiên.

**Chốt:** cleanup của hook chỉ gỡ **listener** (`socket.off(event, handler)`) mà chính instance hook đó đã đăng ký — KHÔNG bao giờ gọi `socket.disconnect()`. Socket sống tới khi tab đóng/tải lại. Đăng xuất là **hard navigation** (`ProtectedShell.tsx:99` — `window.location.href`), trình duyệt tự huỷ WS khi rời trang — không cần code dọn tay cho luồng đăng xuất.

### 1.4 Hợp đồng GIẢ ĐỊNH với `S7-CHAT-BE-2` — 🚧 xác nhận lại khi land

> ⚠️ **ĐÍNH CHÍNH 02/08 (đo lại trên working tree, không phải trên HEAD):** hai việc mục này định giao cho FE-1 thì **`S7-CHAT-BE-1` ĐÃ LÀM RỒI** trong working tree chưa commit. Bảng §0 đo nhầm trên bản đã commit (`git show HEAD:packages/contracts/src/chat.ts` → `body: z.string()` ở dòng 56, không có `roomSeq`), nên hai dòng đó của §0 **đọc là SAI** so với cây làm việc hiện tại.

Số đo thật trên working tree:

| Field | Trạng thái THẬT | Bằng chứng |
| --- | --- | --- |
| `chatMessageSchema.body` | **đã** `z.string().nullable()` kèm comment trích đúng memory `server-masking-needs-optional-fe-schema` | `packages/contracts/src/chat.ts:63` |
| `chatMessageSchema.roomSeq` | **đã có**, và là **BẮT BUỘC** — `z.number().int().positive()`, KHÔNG `.optional()` | `packages/contracts/src/chat.ts:91` |

**Hệ quả cho FE-1 (thay cho khối code cũ):** FE-1 **KHÔNG thêm, KHÔNG sửa** hai field này — chúng đã chốt. Việc còn lại của FE-1 chỉ là **tiêu thụ** đúng: dùng `roomSeq` làm con trỏ (không bao giờ `seq`), và xử lý `body === null` như tin đã thu hồi. `roomSeq` là **required** ⇒ store không được coi nó là `undefined`; nếu BE-2 trả tin thiếu field này thì đó là lỗi của BE-2, phải vỡ ở `.parse()` chứ không im lặng.

Nếu tới lúc thi công mà BE-1 vẫn chưa commit, đo lại **cây làm việc** rồi mới quyết — đừng đo `HEAD`. Đây đúng là bẫy đã làm hỏng hai dòng §0 của chính plan này.

Hàm `chatApi` cho tin nhắn (`getMessages`/`sendMessage`/`recallMessage`/`pinMessage`/`unpinMessage`/`markRead`) viết theo **hợp đồng tài liệu** API-13 §5.1 (CHAT-API-009/010/011/012/014), **KHÔNG** viết `unreadCount` tổng qua `GET /chat/unread-count` (CHAT-API-016) — badge tổng **derive client-side** bằng tổng `unreadCount` từng phòng đã có sẵn trong `chatRoomSchema` (đo thật §0: luôn là số, không bao giờ `null`), tránh phụ thuộc một endpoint chưa tồn tại cho một con số tính được từ dữ liệu đã có. Nếu `S7-CHAT-BE-2` sau này thấy tổng client-side lệch/tốn (ví dụ phòng không tải hết), có thể đổi sang gọi endpoint thật — quyết định đó thuộc `S7-CHAT-FE-3` (nơi badge thật sự lên UI), không phải WO này.

Mọi hàm-tin-nhắn trong `chat-api.ts` gắn comment `// 🚧 ASSUMED CONTRACT — S7-CHAT-BE-2 chưa tồn tại lúc viết (xem docs/plans/S7-CHAT-FE-1.md §1.4). Xác nhận route/DTO thật trước khi coi hàm này là chốt.`

### 1.5 Hợp đồng GIẢ ĐỊNH với `S7-CHAT-RT-1` — sự kiện WS chưa có schema dùng chung

`packages/contracts/src/realtime.ts` không nằm trong `paths` của WO này — FE-1 **không được sửa** file đó. Nhưng store cần phản ứng với `chat:message-recalled`/`chat:read`/`chat:room` (chưa có schema) và **không được** dùng 5 sự kiện hai-chiều đời cũ (`CHAT_JOIN`/`CHAT_SEND`/`CHAT_TYPING`/`CHAT_PRESENCE_LIST` — đã chết theo CHAT-DEC-005, gateway hiện tại 0 `@SubscribeMessage` nên emit các event đó sẽ không có gì lắng nghe, hoặc tệ hơn là mở lại chính hai-chiều mà SPEC vừa cấm).

**Chốt:** định nghĩa schema Zod **tạm, cục bộ trong `apps/app`** (KHÔNG vào `contracts`) cho 3 sự kiện còn thiếu, khớp nguyên văn bảng SPEC-15 §7:

```ts
// apps/app/src/hooks/chat-ws-events.ts
// 🚧 TẠM — bản sao cục bộ vì packages/contracts/src/realtime.ts thuộc paths của S7-CHAT-RT-1.
// KHI RT-1 land: xoá file này, import thẳng từ @mediaos/contracts, và sửa lại use-chat-realtime.ts.
const wsChatMessageRecalledSchema = z.object({
  messageId: z.string().uuid(), roomId: z.string().uuid(), recalledAt: z.string().datetime(),
});
const wsChatReadSchema = z.object({
  roomId: z.string().uuid(), userId: z.string().uuid(), lastReadSeq: z.number().int().nonnegative(),
});
const wsChatRoomSchema = z.object({
  roomId: z.string().uuid(), action: z.string(), room: chatRoomSchema.optional(),
});
```

`chat:message` DÙNG THẲNG `wsChatMessageEventSchema` đã có thật trong `realtime.ts:70-71` (an toàn, không giả định). Namespace kết nối: `` `${wsOrigin}/${WS_NAMESPACE}` `` — `WS_NAMESPACE` import thật từ `@mediaos/contracts` (đã tồn tại, không giả định).

Mọi payload nhận từ socket phải qua `.safeParse()` bằng schema tương ứng TRƯỚC khi merge vào store — payload sai hình dạng thì **log + bỏ qua**, KHÔNG throw làm crash toàn app (kỷ luật fail-soft phía nhận, đối xứng với "server luôn `.parse()` trước khi emit" phía gửi).

### 1.6 Vòng đời kết nối — 3 trạng thái, không suy diễn thêm

```text
'connecting' → (connect thành công) → 'connected'
                                          │ connect_error("unauthorized")
                                          ├─→ gọi refreshAccessToken() 1 lần (dùng lại hàm single-flight có sẵn),
                                          │    để socket.io-client tự backoff-retry — auth callback đọc
                                          │    getAccessToken() LẠI mỗi lần thử (KHÔNG đóng băng token cũ)
                                          │
                                          │ connect_error("realtime_disabled")
                                          └─→ TẮT auto-reconnect (server đã fail-closed vĩnh viễn theo cấu hình
                                               hiện tại), chuyển 'polling-fallback' — mọi phòng đang subscribe
                                               tự bù qua afterSeq mỗi 10s (setInterval, dọn khi phòng unsubscribe)
```

`io(url, { auth: (cb) => cb({ token: getAccessToken() ?? undefined }) })` — dùng **hàm**, không phải object tĩnh: mỗi lần thử kết nối lại, callback đọc token MỚI NHẤT từ store — token xoay do `refreshAccessToken()` tự động có hiệu lực ở lần retry kế tiếp mà không cần code nào phá-rồi-dựng-lại socket thủ công.

### 1.7 Store là nguồn sự thật DUY NHẤT — không có query cache thứ hai cho danh sách phòng

`useChatStore` giữ `roomsById`/`messagesByRoom`/`connectionStatus`. Bootstrap: `useChatRealtime()` gọi `useQuery({queryKey: chatKeys.rooms.all, queryFn: chatApi.listRooms, enabled: canAccessChat})` (mượn retry/loading của react-query — đúng quy ước dự án) rồi `useEffect` đẩy `data` vào `useChatStore.getState().hydrateRooms(data)` mỗi khi đổi. FE-2/FE-3 (sau này) đọc phòng từ `useChatStore`, **KHÔNG** tự `useQuery(chatKeys.rooms.all, ...)` lần hai — tránh hai nguồn sự thật lệch nhau khi WS đẩy một cập nhật mà cache react-query riêng của màn khác chưa biết.

---

## 2. Phạm vi thi công

| File | Việc |
| --- | --- |
| `packages/contracts/src/chat.ts` | Additive: `chatMessageSchema.body` → `.nullable()`; thêm `chatMessageSchema.roomSeq` `.optional()` (§1.4). KHÔNG đụng `seq`, KHÔNG đụng schema phòng/thành viên đã có |
| `packages/web-core/src/lib/chat-api.ts` (mới) | `chatApi` — mirror `ChatRoomsController` (11 hàm THẬT: `listRooms/createRoom/openDirect/getRoom/updateRoom/archiveRoom/leaveRoom/listMembers/addMember/updateMemberRole/removeMember`) + hàm tin nhắn ASSUMED (§1.4), mỗi hàm ASSUMED có comment cảnh báo |
| `packages/web-core/src/lib/query-keys.ts` | Thêm `rootKeys.chat`, `chatKeys` (rooms: all/list/detail/members) theo đúng khuôn `hrKeys`/`goalKeys` |
| `packages/web-core/src/index.ts` | Export `chatApi`, `chatKeys` (barrel, theo đúng vị trí các export module khác) |
| `apps/app/package.json` | Thêm `"socket.io-client": "^4.8.3"` vào `dependencies` THẬT (khớp version `apps/api` đang dùng, tránh version-drift 2 phía cùng namespace) |
| `apps/app/src/stores/chat.store.ts` (mới) | Zustand: `roomsById`, `roomOrder` (sort theo `lastMessageAt` desc), `messagesByRoom`, `connectionStatus`, `subscribedRoomIds`; actions `hydrateRooms`/`upsertRoom`/`applyIncomingMessage`/`applyRecall`/`applyReadReceipt`/`setConnectionStatus`/`subscribeToRoom`/`unsubscribeFromRoom`/`createClientMessageId` |
| `apps/app/src/hooks/chat-ws-events.ts` (mới) | 3 schema Zod tạm (§1.5) + `parseIncomingChatEvent(eventName, payload)` dispatcher trả `{ok:true,event,data} \| {ok:false}` |
| `apps/app/src/hooks/use-chat-realtime.ts` (mới) | `getChatSocket()` (module-private, singleton) + hook `useChatRealtime()`: gate `useCan('access','chat')` → bootstrap `chatApi.listRooms()` (react-query) → `hydrateRooms` → connect socket → đăng ký 4 listener (`chat:message` qua schema thật, 3 còn lại qua `chat-ws-events.ts`) → `connect_error` state machine (§1.6) → poll `afterSeq` mỗi 10s cho phòng đang `subscribedRoomIds` khi `connectionStatus !== 'connected'` |
| `apps/app/src/layouts/protected/ProtectedShell.tsx` | **+1 dòng**: `useChatRealtime();` cạnh `useFavicon(...)` (dòng 87) — append, không rewrite |

---

## 3. KHÔNG làm trong WO này

- ❌ Bất kỳ UI nào — trang `/chat`, panel nổi, badge header, hộp thoại tạo nhóm. Đó là `S7-CHAT-FE-2`/`FE-3`.
- ❌ Sửa `packages/contracts/src/realtime.ts` — không nằm trong `paths`; dùng schema tạm cục bộ (§1.5).
- ❌ Xoá 5 sự kiện WS hai-chiều đời cũ (`CHAT_JOIN`/`SEND`/`TYPING`/`PRESENCE_LIST` + ack) dù đã xác nhận chết — xoá là quyết định cần review riêng (memory `review-gate-blind-to-deletions`), không phải `paths` của WO này. Ghi nợ ở §5.
- ❌ Gọi thật `GET /chat/unread-count` (CHAT-API-016) — badge tổng derive client-side (§1.4).
- ❌ Đang gõ / trạng thái online — ngoài phạm vi v1 (API-13 §4.2), và 2 sự kiện WS tương ứng đã chết theo §1.5.
- ❌ Đổi hạ tầng server (`REALTIME_ENABLED`, gateway, join-phòng-lúc-handshake) — thuộc `S7-CHAT-RT-1`.
- ❌ Thêm `VITE_WS_URL`/env mới — origin WS tự tách từ `getApiBaseUrl()` (§0).
- ❌ Wire mutation vào nút bấm/form nào — `chatApi.createRoom`/`updateRoom`/… là hàm sẵn có, KHÔNG có UI gọi chúng ở WO này.
- ❌ Thêm entry `chat` vào `query-invalidation-contract.spec.ts` — test đó pin invalidation cho mutation ĐÃ CÓ UI gọi (§13.3 IMPLEMENTATION-08); CHAT chưa có mutation nào được gọi từ UI ở WO này, thêm vào sẽ pin một hành vi chưa tồn tại.

---

## 4. Test (vitest, `apps/app` + `packages/web-core`)

Không chạm DB → không cần `LANE_DB`. Mock `socket.io-client` qua `vi.mock("socket.io-client")` (không có lib mock sẵn trong repo — đo thật §0).

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 1 | Gọi `getChatSocket()` nhiều lần | Trả **cùng một** instance (so sánh reference) |
| 2 | Mount `useChatRealtime()` 2 lần liên tiếp (mô phỏng `<StrictMode>` double-invoke) | `io()` (mock) chỉ bị gọi **đúng 1 lần** |
| 3 | `useCan('access','chat')` trả `false` | `getChatSocket()`/`io()` **không** được gọi |
| 4 | Origin WS tách từ `getApiBaseUrl()="http://localhost:3100/api/v1"` | `io()` được gọi với `"http://localhost:3100/ws"` (bỏ `/api/v1`, thêm `/ws`) |
| 5 | Option `auth` truyền cho `io()` | Là **hàm** (không phải object tĩnh); gọi hàm đó → invoke `getAccessToken()` |
| 6 | `connect_error` message `"realtime_disabled"` | store chuyển `connectionStatus: 'polling-fallback'`; auto-reconnect bị tắt (assert flag/`disconnect()` gọi đúng 1 lần, không lặp) |
| 7 | `connect_error` message `"unauthorized"` | `refreshAccessToken()` (mock) được gọi **đúng 1 lần**; `connectionStatus` KHÔNG chuyển `polling-fallback` |
| 8 | `hydrateRooms([...3 phòng])` | `roomOrder` sắp theo `lastMessageAt` giảm dần; `roomsById` đủ 3 khoá |
| 9 | Nhận `chat:message` (payload hợp lệ qua `wsChatMessageEventSchema` thật) 2 lần với cùng `id` | `messagesByRoom[roomId]` chỉ có **1** bản ghi (dedupe theo `id`) |
| 10 | Nhận `chat:message-recalled` khớp 1 tin đã cache | Tin đó có `body: null` + `recalledAt` đúng giá trị |
| 11 | Nhận payload méo (thiếu field bắt buộc) trên bất kỳ 1 trong 4 kênh | `parseIncomingChatEvent` trả `{ok:false}`; store **không đổi**; không throw (app không crash) |
| 12 | Pin schema: `chatMessageSchema.safeParse({...hợp lệ, body: null})` | `success:true` — chứng minh `.nullable()` THẬT có tác dụng (gỡ tạm `.nullable()` để thấy ca này đỏ trước khi tin, theo kỷ luật memory `server-masking-needs-optional-fe-schema`) |
| 13 | `createClientMessageId()` gọi 2 lần | Trả 2 giá trị **khác nhau**; đồng thời: gọi cùng 1 giá trị đã lưu trước đó vào action `applyOptimisticSend(id, ...)` 2 lần → không tạo 2 bản ghi (mô phỏng "resend dùng lại id cũ") |
| 14 | `subscribeToRoom(roomId)` khi `connectionStatus='polling-fallback'`, dùng fake timers | `chatApi.getMessages` (mock) được gọi mỗi 10s; `unsubscribeFromRoom(roomId)` → dừng gọi, không leak interval |
| 15 | `subscribeToRoom(roomId)` khi `connectionStatus='connected'` | Poll fallback **không** chạy (không gọi `chatApi.getMessages` theo chu kỳ) |
| 16 | `chatApi.listRooms()` | `apiFetch` (mock) được gọi với schema `z.array(chatRoomSchema)` — KHÔNG phải schema `{data,meta}` (chứng minh không dính bẫy `apifetch-drops-pagination-bare-array`) |
| 17 | `ProtectedShell` render với `isAuthenticated=true` | `useChatRealtime` được gọi (spy) đúng 1 lần trong cây render — không nhân bản qua route con |

Coverage mục tiêu ≥80% cho 4 file mới (`chat-api.ts`, `chat.store.ts`, `chat-ws-events.ts`, `use-chat-realtime.ts`).

**Bắt buộc trước khi tin `pnpm typecheck`/chạy test:** rebuild dist theo đúng thứ tự phụ thuộc — `pnpm --filter @mediaos/contracts build` rồi `pnpm --filter @mediaos/web-core build` — TRƯỚC khi typecheck/test `apps/app` (2 bẫy đã biết: `stale-contracts-dist-typecheck-false-red`, `web-core-stale-dist-white-page`; dist KHÔNG tự rebuild khi sửa `src/**`).

---

## 5. Definition of Done + nợ/rủi ro

- [ ] `socket.io-client` là dependency THẬT của `apps/app` (không phải dev); version khớp `apps/api` (`^4.8.3`)
- [ ] Đúng **MỘT** hàm gọi `io()` trong toàn `apps/app/src/**` (grep xác nhận) — kết nối thứ hai không có code path để tồn tại
- [ ] `useChatStore` là nguồn sự thật dùng chung; cache tin theo phòng + `subscribedRoomIds`; WS đứt → poll `afterSeq` 10s (ASSUMED contract, đánh dấu rõ — §1.4)
- [ ] `chatMessageSchema.body` `.nullable()` + `roomSeq` `.optional()` — additive, pin test ca 12 chứng minh THẬT có hiệu lực
- [ ] `createClientMessageId()` sinh 1 lần, action nhận id làm tham số tường minh (không tự sinh trong thân hàm — kỷ luật `react-query-v5-stale-mutationfn-closure`)
- [ ] REBUILD `packages/contracts` + `packages/web-core` dist trước khi tin typecheck (2 bẫy đã biết)
- [ ] 17 ca test §4 xanh, coverage ≥80% trên 4 file mới
- [ ] LIGHT gate (`react-reviewer` + `typescript-reviewer` + `quality-gate`) PASS
- [ ] Cập nhật `harness/backlog.mjs` (`S7-CHAT-FE-1` → `status:"done"`)

**Nợ/rủi ro ghi lại tường minh (không chôn trong code):**

1. **Rủi ro lớn nhất:** toàn bộ §1.4/§1.5 dựng trên hợp đồng TÀI LIỆU, chưa có BE xác nhận. Nếu `S7-CHAT-BE-2` đặt tên trường khác `roomSeq`, hoặc `S7-CHAT-RT-1` đặt tên sự kiện khác 3 cái đã giả định (`chat:message-recalled`/`chat:read`/`chat:room`), toàn bộ `use-chat-realtime.ts` + `chat-ws-events.ts` phải sửa lại — không phải lỗi, đây là chi phí đã biết trước của việc viết plan trước dependency.
2. **Sau khi `S7-CHAT-RT-1` land:** xoá `apps/app/src/hooks/chat-ws-events.ts`, import thẳng schema từ `@mediaos/contracts`. Sau khi `S7-CHAT-BE-2` land: gỡ comment `🚧 ASSUMED CONTRACT` khỏi `chat-api.ts`, đối chiếu lại từng route/DTO với controller THẬT.
3. **5 sự kiện WS hai-chiều đời cũ** (`CHAT_JOIN`/`SEND`/`TYPING`/`PRESENCE_LIST`) trong `realtime.ts` vẫn còn — WO này không xoá (ngoài `paths`). Đề xuất `S7-CHAT-RT-1` dọn cùng lúc thêm 3 sự kiện mới, tránh một WO dọn riêng chỉ để xoá vài dòng.
4. **Badge tổng chưa đọc** derive client-side (tổng `unreadCount` từng phòng trong `useChatStore`) thay vì gọi `GET /chat/unread-count` thật — quyết định lại ở `S7-CHAT-FE-3` nếu cách này không đủ (ví dụ cần tổng của phòng chưa từng tải vào store).
5. Plan này **không** tự chạy `plan-reviewer` — theo CLAUDE.md §6, LIGHT gate không bắt buộc vòng plan-review đối kháng trước khi code (chỉ crown/FULL mới bắt buộc). Nếu người chốt muốn review plan trước khi giao Sonnet code, gọi `plan-reviewer` thủ công.
