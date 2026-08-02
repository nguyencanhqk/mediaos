# Micro-plan — `S7-CHAT-RT-1` (rev 2) (🔴 red · crown · FULL gate)

> **WO:** Realtime CHAT — join phòng SERVER-SIDE lúc handshake · emit SAU commit · đồng bộ join/leave khi membership đổi · giữ WS một chiều (CHAT-DEC-005).
> **Nguồn sự thật:** [SPEC-15 §3.5 · §13.8](<../SPEC/SPEC-15 CHAT.md>) · [API-13 §7](<../API Design/API-13_CHAT_API_Design.md>) · `apps/api/src/realtime/**` (hạ tầng đã ship) · `apps/api/src/chat/**` (BE-1 + BE-2, **đã commit**, xem đo thật §0) · [`S7-CHAT-BE-2.md`](S7-CHAT-BE-2.md) (chỗ tuyên bố "chừa nguyên") · `harness/backlog.mjs` (done_when RT-1, owner chốt 02/08/2026)
> **Nhánh:** tạo `wo/s7-chat-rt1` từ `wave/s7-chat`, PR **vào** `wave/s7-chat` (KHÔNG commit thẳng lên `wave/s7-chat`, KHÔNG bao giờ vào `master`) — `docs/plans/S7-CHAT-WAVE.md:98-100`. `autoMerge` TẮT (WAVE §4 dòng 100).
> **Lập ngày:** 02/08/2026 · **rev 2** — vá 9 điều kiện gỡ BLOCK từ HAI `plan-reviewer` độc lập (rev 1 bị BLOCK cả hai) + các mục MEDIUM kèm theo. Không đụng code, chỉ viết lại plan.

---

## 0. Đo thật trước khi thiết kế — đo lại 100% lúc viết rev 2

**Commit-sha đo lúc viết rev 2:** `git log --oneline -5` tại HEAD của `wave/s7-chat`:

```text
54b4d8cd feat(chat): S7-CHAT-BE-2 — tin nhắn (CHAT-API-009..014, 016)
c77f48e0 feat(chat): S7-CHAT-BE-1 — ChatAccessService + phòng/thành viên (CHAT-API-001..008)
4c5c2da6 feat(chat): S7-CHAT-DB-2 (mig 0539) — room_seq per-room, sửa công thức đếm chưa đọc SAI
7822abd7 feat(chat): khối (F′) — cấp 10 cặp CHAT cho role đang giữ toàn bộ catalog
d28d69e8 fix(chat): vá FULL gate cho S7-CHAT-DB-1 — 3 HIGH + 9 MEDIUM
```

`git status --short` lúc đo: chỉ 3 file M ngoài phạm vi RT-1 (`docs/SPEC/SPEC-15 CHAT.md`, `docs/plans/S7-CHAT-WAVE.md`, `harness/backlog.mjs` — quyết định owner, không phải code). **`apps/api/src/chat/**` đã commit sạch, không còn nằm trong working tree.**

⚠️ **Khác rev 1:** rev 1 đo lúc `S7-CHAT-BE-1` còn nằm ở working tree chưa commit và `S7-CHAT-BE-2` **chưa tồn tại**. Cả hai giờ đã commit. §1.9 của rev 1 (viết phần nhắn tin như "hợp đồng tích hợp giả định") **sai theo thời gian** — BE-2 là code thật, đọc được, và tự tuyên bố "chừa nguyên" phần emit (xem hàng 18 dưới). rev 2 thay bằng bảng ánh xạ cứng vào đúng dòng code thật.

| # | Thứ | Đo được 02/08/2026 (rev 2) | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Gateway hiện có | `RealtimeGateway` namespace `/ws`; auth ở **handshake middleware** trong `afterInit` — verify JWT qua `TokenService.verifyAccessToken`, gắn `{id, companyId}` vào `socket.data.user`. Fail-closed: thiếu/sai token → `next(new Error(...))`, `REALTIME_ENABLED=false` → middleware từ chối MỌI connection. **Không đổi so với rev 1** — `realtime/**` chưa bị chạm bởi BE-1/BE-2 | `realtime.gateway.ts:39-82` |
| 2 | `handleConnection` hiện tại | CHỈ join `userRoomName(companyId, userId)` (đích `notification:new`). **0 query DB, 0 room chat nào được join.** Toàn bộ việc RT-1 cần thêm | `realtime.gateway.ts:84-94` |
| 3 | `RealtimeEmitterService` hiện có | CHỈ `emitNotification` + `emitNotificationRead`. **0 method chat** | `realtime-emitter.service.ts:22-63` |
| 4 | `rooms.ts` hiện có | CHỈ `userRoomName()`. Chưa có `chatRoomName()` | `rooms.ts:1-11` |
| 5 | `packages/contracts/src/realtime.ts` **vẫn còn khai WS CHAT SONG HƯỚNG** (không đổi từ rev 1, đọc lại xác nhận) | `WS_EVENTS.CHAT_JOIN/CHAT_LEAVE/CHAT_SEND/CHAT_TYPING/CHAT_PRESENCE_LIST` + `wsChatJoinSchema`/`wsChatSendSchema`/…/`wsAckSchema` — mâu thuẫn CHAT-DEC-005. 0 usage repo-wide ngoài chính file này | `realtime.ts:16-32` (event keys) · `realtime.ts:38-65` (request schema) · `realtime.ts:99-115` (ack schema) |
| 6 | 4 sự kiện THẬT theo spec | `chat:message` đã đúng (`WS_EVENTS.CHAT_MESSAGE`, dòng 24). **`chat:message-recalled` · `chat:read` · `chat:room` CHƯA khai** ở đâu cả | `realtime.ts:24` · SPEC-15 §13.8 · API-13 §7 |
| 7 | `@socket.io/redis-adapter@8.3.0` hỗ trợ remote room-ops xuyên instance | `addSockets`/`delSockets`/`disconnectSockets` implement thật (không no-op) → `.socketsJoin()/.socketsLeave()/.disconnectSockets()` đúng dù socket ở instance khác, miễn Valkey adapter đã gắn | `node_modules/.pnpm/@socket.io+redis-adapter@8.3.0.../dist/index.js:583,599,615` |
| 8 | `RealtimeEmitterModule` là leaf module tách riêng để phá cycle `Realtime→Chat→Realtime` | Comment gốc còn nguyên | `realtime-emitter.module.ts:7-9` |
| 9 | **`chat.module.ts` — ĐÃ COMMIT** (khác rev 1: lúc đó còn working tree) | `providers` = 8 (`ChatAccessService, ChatRoomsService, ChatMembersService, ChatRoomsRepository, ChatRoomCodeService, ChatMessagesService, ChatMessageModerationService, ChatMessagesRepository`); `controllers` = 2 (`ChatRoomsController, ChatMessagesController`); `exports` = **3** (`ChatAccessService, ChatRoomsRepository, ChatMessagesRepository`) — `ChatMessagesRepository` mới thêm bởi BE-2, RT-1 **không cần** nó (dùng lại `ChatRoomsRepository.listRoomsForUser` như rev 1 đã chọn) | `chat.module.ts:35-50` |
| 10 | `toChatRoomDto` LUÔN gán `unreadCount` một SỐ CỤ THỂ | `unreadCount: unreadCount ?? row.unreadCount ?? 0` — **dòng 65** (rev 1 ghi nhầm dòng 59, hàm nay ở 45-68 vì `toChatMessageDto` được BE-2 chèn ngay sau nó trong cùng file) — tái dùng thẳng hàm này cho payload broadcast `chat:room` vẫn phát "0 chưa đọc" SAI cho mọi người nhận | `chat.mapper.ts:45-68`, cụ thể dòng 65 |
| 11 | Wiring module cấp app — **đã commit**, không còn trong diff | `app.module.ts` import cả `RealtimeModule` (dòng 20, dùng dòng 64) và `ChatModule` (dòng 35, dùng dòng 98); `openapi-modules.ts` có mục `CHAT` (dòng 98-104, `code: "CHAT"` dòng 100). RT-1 **không** đụng 2 file này | `app.module.ts:20,35,64,98` · `openapi-modules.ts:98-104` |
| 12 | Mint JWT thật trong test không cần login | `TokenService.signAccessToken(claims)` ký token hợp lệ trực tiếp | `token.service.ts:79-85` |
| 13 | `REALTIME_ENABLED` đọc 1 lần lúc khởi tạo gateway | `RealtimeGateway.enabled` field `readonly`, gán từ `loadEnv().REALTIME_ENABLED` trong constructor. Test 2 chế độ cần 2 `TestingModule` riêng | `realtime.gateway.ts:44` · `env.schema.ts:315` (định nghĩa `loadEnv`) · `env.schema.ts:59` (field) |
| 14 | 0 cơ chế "kick-on-lock" một socket đang sống | Grep `disconnect` toàn `apps/api/src` chỉ khớp nhánh handshake fail-closed. `auth/**` NGOÀI `paths` của WO này | `realtime.gateway.ts:90` · `env.schema.ts:64` (`ACCESS_TOKEN_TTL_SEC` default 900s) |
| 15 | Khuôn test WS+DB colocated (KHÔNG ở `test/integration/`) | `realtime.gateway.spec.ts` + `realtime.gateway.io.spec.ts` nằm **`apps/api/src/realtime/`** (memory `vitest-unit-specs-must-be-colocated`) — server+client Socket.IO thật nhưng **không có DB/AppModule**. `apps/api/test/integration/chat-be1-*.int-spec.ts` + `chat-be2-messages.int-spec.ts` có `AppModule`+`LANE_DB` thật nhưng **không có WS**. RT-1 cần cả hai — file mới đặt `apps/api/test/integration/chat-rt1-*.int-spec.ts` theo đúng khuôn đặt tên đã có | `apps/api/src/realtime/realtime.gateway.io.spec.ts:39-69` · `apps/api/test/integration/chat-be1-access.int-spec.ts:23-44` |
| 16 | Comment đầu 3 file realtime sẽ SAI sau khi RT-1 ship | `realtime.gateway.ts:29-31`, `realtime.module.ts:13`, `realtime-emitter.service.ts:20` đều viết "cụm chat = out-of-scope đã gỡ" — **không đổi từ rev 1**, vẫn phải sửa cùng lúc | như trên |
| 17 🆕 | **BE-2 đã là code thật, đọc được, VÀ tự tuyên bố không emit** | `ChatMessagesService.sendMessage` (tx tại `chat-messages.service.ts:91-146`, xử lý race tại `:147-164`), `.markRead` (`:173-190`); `ChatMessageModerationService.recall` (`:38-68`). Docstring BE-2 nói thẳng: *"`RealtimeEmitterService` đã tồn tại, nhưng WS là `S7-CHAT-RT-1`. Emit ở đây sẽ (a) thiếu room join server-side nên không ai nhận, (b) dễ bị viết TRONG tx… Chừa nguyên."* | `docs/plans/S7-CHAT-BE-2.md:106-108` |
| 18 🆕 | Backlog `done_when` của RT-1 — owner đã chốt quyền sở hữu điểm gọi (02/08/2026) | *"⚠️ WO NÀY SỞ HỮU CẢ ĐIỂM GỌI: tự thêm lời gọi emit vào `ChatMessagesService.sendMessage`/`markRead` + `ChatMessageModerationService.recall` — S7-CHAT-BE-2 đã tuyên bố 'chừa nguyên' nên KHÔNG ai khác wire; dựng emitter mà không có nơi gọi = 3/4 sự kiện là dead code"* — cùng dòng cũng chốt luôn cổng quyền WS (#2 dưới) và payload recall không kèm `body` (#4 dưới) | `harness/backlog.mjs:9789-9799` |
| 19 🆕 | `packages/contracts/src/chat.ts` — con trỏ `roomSeq`, **KHÔNG còn `seq` toàn cục ở `chatMessageSchema`** | Comment tại chỗ: *"CỐ Ý KHÔNG CÓ `seq`. `chat_messages.seq` là identity cấp BẢNG…"*; field thật là `roomSeq: z.number().int().positive()`. Nợ `seq` mà rev 1 §1.9 nhắc BE-2 phải tự đối chiếu **đã không còn tồn tại** — DB-2 (mig `0539`) + BE-2 đã dọn xong trước khi RT-1 viết lại plan này | `chat.ts:86` (comment) · `chat.ts:91` (field) |
| 20 🆕 | Cặp quyền `('view','chat-room')` — `is_sensitive = false` | Verify block của `0538` tự RAISE EXCEPTION nếu flip — pin cứng, không phải suy đoán. Cần cho thiết kế cổng quyền WS (#2): gọi `PermissionService.can()` type-level, KHÔNG cần `ctx` reauth | `apps/api/migrations/0538_s7chatdb1_chat_v1.sql:408,797-813` |
| 21 🆕 | `PermissionService.can()` — chữ ký & cách gọi trực tiếp từ service (không qua Guard) đã có TIỀN LỆ | `CanInput{userId,companyId,action,resourceType,resourceId?,isSensitive?,ctx?}` → `Promise<PermissionDecision{allow:boolean,...}>` (field là `.allow`, KHÔNG phải `.allowed`). `PermissionModule.exports` gồm `PermissionService` — module khác import thẳng `PermissionModule` là gọi được, không bắt buộc qua `PermissionGuard`. Tiền lệ gọi trực tiếp từ service (ngoài guard): `file-policy.service.ts`, `me-avatar-file.resolver.ts` (memory `avatar-own-scope-presign-wrapper`) | `permission/permission.types.ts:16-23,31-46` · `permission/guards/permission.guard.ts:128-139` · `permission/permission.module.ts:146-153` |
| 22 🆕 | `ChatRoomsRepository.listRoomsForUser` dùng **ĐÚNG cùng 4 điều kiện** với `ChatAccessService.assertMember` | `listRoomsForUser`: `companyId` khớp · `chatRooms.deletedAt IS NULL` · `chatRoomMembers.userId = userId` · `leftAt IS NULL`. `assertMember`/`activeMembershipJoin`+`visibleRoom`: CÙNG 4 điều kiện, cột-cho-cột. Đây là đọc DẠNG DANH SÁCH của cùng luật, không phải luật thứ hai — dùng cho §1.11 | `chat-rooms.repository.ts:113-119` · `chat-access.service.ts:276-288` |
| 23 🆕 | `resurrectDirect` hiện tại — lỗ 0 sync khi cả hai thành viên còn active | Vòng lặp chỉ gọi `insertMember`/`reactivateMember` khi `!existing` hoặc `existing.leftAt` — nhánh "existing && !leftAt" (thành viên chưa từng rời) không có hành động nào, kể cả khi phòng vừa được `restoreRoom` (undelete). Bug CÓ THẬT trong code đã ship, không phải suy đoán | `chat-rooms.service.ts:334-357` |
| 24 🆕 | 10 call-site `new RealtimeGateway(...)` cần cập nhật khi đổi constructor | `realtime.gateway.spec.ts` — 9 site (dòng 62,80,96,119,135,154,172,183,194); `realtime.gateway.io.spec.ts` — 1 site (dòng 47). Cả 10 đều gọi `new RealtimeGateway(tokens, emitter)` 2 tham số — đổi constructor RT-1 (thêm `PermissionService`, `ChatRoomsRepository`, `DatabaseService`) làm ĐỦ 10 chỗ gãy compile cùng lúc | `grep -n "new RealtimeGateway(" apps/api/src/realtime/*.spec.ts` → đúng 10 dòng |
| 25 🆕 | Luật nhánh WAVE — RT-1 rev 1 viết sai | *"nhánh wave: `wave/s7-chat`… mỗi WO: `wo/s7-chat-<xx>` → PR vào `wave/s7-chat` ❗KHÔNG vào master… autoMerge: TẮT"* — rev 1 ghi "commit lên `wave/s7-chat`" là sai, đã sửa ở header | `docs/plans/S7-CHAT-WAVE.md:98-100` |

---

## 1. Quyết định thiết kế — chốt ở đây, không để người thi công tự quyết

### 1.1 Kiến trúc module — mirror cấu trúc đã từng tồn tại (đo thật #8), THÊM `PermissionModule`

```text
RealtimeModule  ──imports──▶  ChatModule  ──imports──▶  RealtimeEmitterModule (leaf)
      │        ──imports──▶  PermissionModule (leaf, đã @Global-adjacent qua exports)
      └──────────────────────imports (RealtimeEmitterModule)──────────────────────────▶
```

- **`RealtimeModule` thêm `ChatModule` VÀ `PermissionModule` vào `imports`** — `ChatModule` để `RealtimeGateway` inject `ChatRoomsRepository`; `PermissionModule` để inject `PermissionService` (cổng quyền §1.2). `PermissionModule.exports` đã có sẵn `PermissionService` (đo thật #21) — không cần đổi gì ở `PermissionModule`.
- **`ChatModule` thêm `RealtimeEmitterModule` vào `imports`** — để `ChatRoomsService`/`ChatMembersService`/`ChatMessagesService`/`ChatMessageModerationService` inject `RealtimeEmitterService`.
- **KHÔNG** để `ChatModule` import `RealtimeModule` (chỉ import `RealtimeEmitterModule`, leaf) — lý do gốc ở đo thật #8. Xem thêm §1.12 (MEDIUM) — luật này áp cho MỌI file trong `apps/api/src/chat/`, không chỉ lúc viết code lần đầu.
- **`PermissionModule` không tạo cycle mới**: `PermissionModule.imports = [DatabaseModule, EventsModule, forwardRef(() => AuthModule)]` — không có cạnh nào trỏ về `RealtimeModule`/`ChatModule`. Đồ thị tổng vẫn ACYCLIC — verify bằng `pnpm --filter @mediaos/api build` (Nest DI báo lỗi ngay nếu có cycle).

### 1.2 Join phòng lúc connect — server tự tra, cổng quyền, fail loud khi lỗi, tự-vá đua race

`RealtimeGateway.handleConnection` đổi từ `void` (sync) sang **async**, và constructor thêm `PermissionService` + `ChatRoomsRepository` + `DatabaseService`:

```text
handleConnection(client):
  user = getUser(client)                                    // KHÔNG ĐỔI — auth đã xong ở middleware
  if !user → disconnect(true); return
  client.join(userRoomName(user.companyId, user.id))         // KHÔNG ĐỔI — đích notification:new sống ngay

  // ─── (A) CỔNG QUYỀN — điều kiện gỡ BLOCK #2 ─────────────────────────────────────
  decision = permission.can({
    userId: user.id, companyId: user.companyId,
    action: "view", resourceType: "chat-room",
    // type-level: resourceId bỏ trống — CÙNG MỨC với @RequirePermission("view","chat-room") của
    // chat-rooms.controller.ts (đo thật #20: is_sensitive=false → không cần isSensitive/ctx).
  })
  if (!decision.allow):
    logger.debug("user thiếu cặp view:chat-room — chỉ join user-room (đường NOTI)", {userId})
    return   // KHÔNG join phòng chat nào — KHÔNG disconnect (NOTI vẫn phải sống)

  // ─── (B) TRA DANH SÁCH PHÒNG + FAIL LOUD — điều kiện gỡ BLOCK #6 ───────────────
  try:
    rooms = withTenant(user.companyId, tx =>
              chatRoomsRepo.listRoomsForUser(tx, user.companyId, user.id, {archived: false}))
  catch (err):
    logger.error("join chat rooms lúc connect thất bại — disconnect để FE thấy MẤT KẾT NỐI rõ ràng",
                 {userId, error})
    client.disconnect(true)                                  // ĐỔI từ fail-soft (rev 1) — xem lý do dưới
    return

  for r of rooms: client.join(chatRoomName(user.companyId, r.id))

  // ─── (C) RE-CHECK SAU VÒNG JOIN — điều kiện gỡ BLOCK #4 ────────────────────────
  fresh = withTenant(user.companyId, tx =>
            chatRoomsRepo.listRoomsForUser(tx, user.companyId, user.id, {archived: false}))
  freshIds = new Set(fresh.map(r => r.id))
  for r of rooms:
    if !freshIds.has(r.id): client.leave(chatRoomName(user.companyId, r.id))
```

**(A) Cổng quyền đường đọc WS** — `chat-rooms.controller.ts` bắt buộc `@RequirePermission("view","chat-room")` cho MỌI route đọc (đo thật, `chat-rooms.controller.ts:65-70`); gateway trước rev 2 hoàn toàn không kiểm cặp nào. Phòng `department`/`project` (khi BE-5 ship) có thành viên **dẫn xuất** — hàng `chat_room_members` không tự mất khi quyền CHAT của user bị thu hồi ở tầng permission, chỉ mất khi có job đồng bộ riêng chạy. Do đó **membership không thay được cặp quyền** — phải kiểm CẢ HAI, đúng đúng nguyên tắc đã ghi ở `chat-rooms.controller.ts:44-48` ("hai tầng khác nhau"). RED-trước: role **thường** (không phải SA) là thành viên hợp lệ của ≥1 phòng nhưng **không** có cặp `view:chat-room` → connect **thành công** (JWT hợp lệ) nhưng nhận **0** `chat:room`/`chat:message` — chỉ còn đường NOTI.

**(B) Fail loud thay fail soft** — rev 1 chọn fail-soft (không disconnect khi query lỗi) với lý do "mất realtime chat tạm thời không phải lỗ bảo mật". Vấn đề: FE (`S7-CHAT-FE-1`, chưa lập plan) chỉ bù bằng `afterSeq` khi `connectionStatus !== 'connected'` — nhưng "connected mà 0 phòng join" và "connected mà join đủ" là **hai trạng thái không thể phân biệt được từ phía client** (Socket.IO không phát sự kiện nào cho "handleConnection nội bộ bị lỗi nhưng vẫn connect"). Kết quả: FE tin đang realtime, không bù, không polling — mất tin lặng lẽ vô thời hạn cho tới khi user tự F5. Đổi sang `client.disconnect(true)` (+ `logger.error`) đánh đổi: **có** làm chết luôn đường NOTI của lần connect đó, **nhưng** disconnect là sự kiện Socket.IO client CHẮC CHẮN nhận được — `connectionStatus` chuyển `disconnected`, `afterSeq` bù chạy cho CẢ NOTI lẫn CHAT, và `socket.io-client` mặc định tự reconnect (exponential backoff) nên khi DB hồi phục, lần connect kế tiếp thành công bình thường. Đây là quyết định "thà mất kết nối rõ ràng còn hơn sống dối" — nhất quán với triết lý fail-closed đã dùng ở khâu auth (`realtime.gateway.ts:36`), chỉ khác là ở ĐÂY nguyên nhân là lỗi hạ tầng chứ không phải biên bảo mật.

**(C) Đua connect ↔ `removeMember`** — `handleConnection` là async nhưng Socket.IO **không** await nó; nếu `ChatMembersService.removeMember` chạy `syncRoomMembership(..., "leave")` (→ `server.in(userRoomName(...)).socketsLeave(chatRoomName(...))`) đúng lúc socket ĐÃ join `userRoomName` (bước đầu, sync, chạy trước A/B/C) nhưng **CHƯA** join `chatRoomName` (vòng lặp ở B chưa chạy tới phòng đó) thì `socketsLeave` là no-op (không có gì để rời) — sau đó vòng lặp B mới join phòng đã-bị-gỡ, socket kẹt vĩnh viễn trong phòng đó tới khi disconnect. Bước (C) tự-vá: đọc lại `listRoomsForUser` (cùng truy vấn, `fresh`) NGAY sau vòng join, `leave` mọi phòng không còn trong `fresh`. Đóng gần hết cửa sổ đua (còn lại là khoảng thời gian giữa (C) và chính nó chạy xong — cực nhỏ, và **không phải lỗ dữ liệu tuyệt đối**: `assertMember`/`assertMessageAccess` vẫn chặn MỌI đường REST bất kể trạng thái join Socket.IO — cửa sổ còn sót chỉ có thể làm rò tối đa một vài sự kiện `chat:message` realtime, không phải quyền truy cập REST). Ca test bắt buộc: connect và `DELETE /chat/rooms/:id/members/:userId` chạy đan xen (test 2 ở §4).

**Fail-SOFT vẫn giữ nguyên ở (A)** — thiếu cặp quyền không phải lỗi hạ tầng, là quyết định nghiệp vụ hợp lệ (giống 403 ở REST) — không disconnect, chỉ không join phòng chat.

**`getUser`, middleware auth, `userRoomName` giữ NGUYÊN — không đổi.**

### 1.3 `RealtimeEmitterService` — 5 method mới, cùng khuôn `.parse()` + try/catch no-throw đã có

| Method | Đích Socket.IO | Payload `.parse()` qua |
| --- | --- | --- |
| `emitChatMessage(companyId, roomId, message)` | `chatRoomName(companyId, roomId)` | `wsChatMessageEventSchema` (= `chatMessageSchema`, đã có) |
| `emitChatMessageRecalled(companyId, roomId, payload)` | như trên | `wsChatMessageRecalledEventSchema` (mới) |
| `emitChatRead(companyId, roomId, payload)` | như trên | `wsChatReadEventSchema` (mới) |
| `emitChatRoom(companyId, roomId, payload, affectedUserIds)` | `[chatRoomName(companyId, roomId), ...affectedUserIds.map(uid => userRoomName(companyId, uid))]` — Socket.IO `server.to(Room[])` nhận mảng, UNION tự nhiên (không double-deliver socket ở cả hai) | `wsChatRoomEventSchema` (mới) |
| `syncRoomMembership(companyId, roomId, userId, action: "join"\|"leave")` | không emit — `server.in(userRoomName(companyId,userId)).socketsJoin(chatRoomName(...))` hoặc `.socketsLeave(...)` | — (không phải payload) |

⚠️ **Đổi so với rev 1**: `emitChatRoom` nhận `affectedUserIds: string[]` (mảng, **bắt buộc**, có thể rỗng `[]`) — KHÔNG còn `affectedUserId?: string` (optional, số ít). Lý do ở §1.6 (điều kiện gỡ BLOCK #3).

Mọi method giữ nguyên khuôn hiện có: `if (!this.server) return;` đầu hàm (no-op khi `REALTIME_ENABLED=false`) + `try/catch` quanh phần còn lại, `logger.warn` khi lỗi, **KHÔNG BAO GIỜ throw lên caller** (`realtime-emitter.service.ts:16-18`).

**Schema mới, viết đủ hình dạng (không để "3 schema mới" mập mờ như rev 1):**

```ts
// packages/contracts/src/realtime.ts
export const wsChatMessageRecalledEventSchema = z.object({
  messageId: z.string().uuid(),
  roomId: z.string().uuid(),
  recalledAt: z.string().datetime(),   // luôn có giá trị thật lúc emit — KHÔNG nullable (khác chatMessageSchema.recalledAt)
});
export type WsChatMessageRecalledEvent = z.infer<typeof wsChatMessageRecalledEventSchema>;

export const wsChatReadEventSchema = z.object({
  roomId: z.string().uuid(),
  userId: z.string().uuid(),
  lastReadSeq: z.number().int().nonnegative(),   // hệ room_seq (mig 0539), KHÔNG phải chat_messages.seq
});
export type WsChatReadEvent = z.infer<typeof wsChatReadEventSchema>;
```

(`wsChatRoomEventSchema` + `wsChatRoomActionSchema` — xem §1.4, không đổi từ rev 1.)

### 1.4 `chat:room` — `room` field KHÔNG mang `unreadCount` (vá lỗ ở đo thật #10)

```ts
export const wsChatRoomActionSchema = z.enum([
  "created", "updated", "archived",
  "member_added", "member_removed", "member_role_changed", "left",
]);
export type WsChatRoomAction = z.infer<typeof wsChatRoomActionSchema>;

export const wsChatRoomEventSchema = z.object({
  roomId: z.string().uuid(),
  action: wsChatRoomActionSchema,
  // ⚠️ omit unreadCount: field này PER-MEMBER, không có giá trị đúng để broadcast chung — xem chat.mapper.ts:65.
  room: chatRoomSchema.omit({ unreadCount: true }).optional(),
});
```

`room` field CHỈ điền cho action `created`/`updated`/`archived` (metadata phòng thật sự đổi). Với `member_added`/`member_removed`/`member_role_changed`/`left` thì `room` để trống. Bất kỳ code build payload `chat:room` mà set `room.unreadCount` bằng tay là VI PHẠM — ca test 9 ở §4 pin bằng runtime assertion (Zod `.omit()` strip triệt để).

### 1.5 Dọn code chết trong `packages/contracts/src/realtime.ts` (đo thật #5) — COMMIT RIÊNG

**Xoá** (0 usage repo-wide, mâu thuẫn CHAT-DEC-005 — SPEC-15 dòng 167 xác nhận typing/presence "đo nhu cầu thật SAU v1"):
`WS_EVENTS.CHAT_JOIN` · `CHAT_LEAVE` · `CHAT_SEND` · `CHAT_TYPING` · `CHAT_PRESENCE_LIST` · `CHAT_TYPING_EVENT` · `CHAT_PRESENCE`, cùng `wsChatJoinSchema` · `wsChatLeaveSchema` · `wsChatSendSchema` · `wsChatTypingSchema` · `wsChatPresenceListSchema` · `wsChatTypingEventSchema` · `wsChatPresenceEventSchema` · `wsChatSendAckSchema` · `wsPresenceListAckSchema` · `wsAckSchema`.

**Thêm:** `WS_EVENTS.CHAT_MESSAGE_RECALLED = "chat:message-recalled"` · `CHAT_READ = "chat:read"` · `CHAT_ROOM = "chat:room"`, cùng schema ở §1.3/§1.4 + import thêm `chatRoomSchema` từ `./chat` (giữ nguyên `WS_EVENTS.CHAT_MESSAGE` và `wsChatMessageEventSchema` đã đúng).

⚠️ **Kỷ luật commit (MEDIUM, rẻ nhưng cụ thể):** việc xoá 7 event-key + 10 schema chết ở trên phải là **MỘT COMMIT RIÊNG**, tách khỏi mọi commit thêm hành vi mới (join/emit/permission gate). Commit message kèm bằng chứng grep dán vào body:

```bash
grep -rn "CHAT_JOIN\|CHAT_SEND\|wsChatSendSchema\|wsChatSendAckSchema\|wsPresenceListAckSchema" \
  --include="*.ts" apps/ packages/ | grep -v "packages/contracts/src/realtime.ts"
# → 0 dòng (chính realtime.ts là nơi khai, không ai import)
```

Lý do tách: reviewer đọc "đây thật sự là dọn dẹp cấu trúc, không lẫn logic mới" mà không phải lội qua diff hành vi trong cùng hunk — bài học `review-gate-blind-to-deletions` (gate PASS mà không soi kỹ phần bị xoá) đi theo hướng ngược — ở đây ta CHỦ ĐỘNG làm phần xoá dễ soi nhất có thể.

### 1.6 Bảng ánh xạ hành động → sự kiện `chat:room` — chốt CỨNG

⚠️ **Đổi so với rev 1** (điều kiện gỡ BLOCK #3): cột `affectedUserId?` (số ít, optional) đổi thành `affectedUserIds` (mảng, luôn truyền, có thể rỗng). Lý do: lúc `chat:room{action:"created"}` phát ra, **chưa có socket nào join `chatRoomName` của phòng vừa tạo** (room mới tinh, hoặc vừa hồi sinh — `syncRoomMembership` chạy SAU emit theo §1.7, và kể cả chạy trước thì bản thân người được mời cũng chưa từng join room này bao giờ). Nếu chỉ target `chatRoomName`, event rơi vào phòng rỗng — 0 người nhận. Sửa: với `created`/`resurrect`, `affectedUserIds` phải là **TOÀN BỘ thành viên khởi tạo**, và `emitChatRoom` gửi tới `chatRoomName` **VÀ** `userRoomName` của từng người trong danh sách (đích thứ hai LUÔN có người, vì `userRoomName` được join ngay bước đầu `handleConnection`, đồng bộ, trước mọi bước bất đối xứng khác).

| Service · method | `action` | `affectedUserIds` | `syncRoomMembership` kèm theo |
| --- | --- | --- | --- |
| `ChatRoomsService.createGroup` | `"created"` | `[actor.id, ...invitees]` (TOÀN BỘ thành viên khởi tạo) | `join` cho từng id trong `affectedUserIds` |
| `ChatRoomsService.openDirect` — nhánh THẬT SỰ TẠO MỚI | `"created"` | `[actor.id, dto.peerUserId]` | `join` cho actor + peer |
| `ChatRoomsService.openDirect` → `resurrectDirect` | `"created"` | **TOÀN BỘ thành viên ACTIVE sau khi restore** (kể cả người KHÔNG bị đổi hàng — xem MEDIUM fix §1.6.1) | `join` cho từng id trong `affectedUserIds` |
| `ChatRoomsService.updateRoom` | `"updated"` | `[]` (thành viên hiện có đã join `chatRoomName` từ trước, đích room-broadcast đủ) | không |
| `ChatRoomsService.archiveRoom` | `"archived"` | `[]` | không |
| `ChatRoomsService.leaveRoom` | `"left"` | `[actor.id]` (để CÁC THIẾT BỊ KHÁC của actor cùng cập nhật UI) | `leave` cho actor |
| `ChatMembersService.addMember` | `"member_added"` | `[dto.userId]` | `join` cho `dto.userId` |
| `ChatMembersService.updateMemberRole` | `"member_role_changed"` | `[targetUserId]` | **không** (đổi vai trò không đổi tư cách thành viên phòng) |
| `ChatMembersService.removeMember` | `"member_removed"` | `[targetUserId]` | `leave` cho `targetUserId` |

`openDirect` vẫn cần thread cờ `created: boolean` qua kết quả tx để phân biệt: (a) nhánh `existing && !existing.deletedAt` (early return, KHÔNG emit), (b) nhánh tx thật sự tạo/hồi sinh (`created=true`, emit), (c) nhánh đua-thua (`raced.id`, `created=false`, KHÔNG emit — bên thắng đã emit). Thiếu cờ này ⇒ gọi `openDirect` lần 2 vẫn bắn `"created"` lần nữa — sai ngữ nghĩa, bắt bởi ca test 10 ở §4.

#### 1.6.1 MEDIUM — `resurrectDirect` phải sync CẢ thành viên không đổi hàng

Code hiện tại (đo thật #23, `chat-rooms.service.ts:334-357`) chỉ chạm hàng của người **mới thêm** (`!existing`) hoặc **vừa rời** (`existing.leftAt`) — người vẫn đang active không có hành động gì, kể cả khi CHÍNH PHÒNG vừa được `restoreRoom` (undelete). Đổi chữ ký nội bộ: `resurrectDirect` trả về `Promise<string[]>` = TOÀN BỘ userId active sau khi xử lý (không còn trả `room.id`, caller đã có `room.id` từ `again.id`):

```text
resurrectDirect(tx, actor, room):
  if room.deletedAt: restoreRoom(tx, ...)
  affected = []
  for userId of [actor.id, ...peerOf(room, actor)]:
    existing = findMemberRow(tx, ..., userId)
    if !existing: insertMember(tx, ...); affected.push(userId)
    elif existing.leftAt: reactivateMember(tx, ...); affected.push(userId)
    else: affected.push(userId)   // 🆕 MEDIUM fix — vẫn active, nhưng phòng vừa hồi sinh là sự kiện có ý nghĩa với họ
  return affected
```

`syncRoomMembership("join")` cho một socket đã join sẵn là no-op an toàn (Socket.IO `socketsJoin` idempotent) — không có tác dụng phụ khi thêm người "vẫn active" vào danh sách affected.

### 1.7 Vị trí gọi — mirror khuôn `notifications.service.ts:197-199`

```text
async someMethod(actor, ...) {
  const result = await this.db.withTenant(actor.companyId, async (tx) => {
    ... ghi DB + audit trong CÙNG tx ...
    return { dto, changed: boolean, membershipChanges: [...] };   // KHÔNG emit ở đây
  });
  // ↓ TỚI ĐÂY tx đã COMMIT
  if (result.changed) {   // 🆕 rev 2 — điều kiện gỡ BLOCK #5, xem §1.9
    this.realtime.emitChatRoom(actor.companyId, roomId, { roomId, action, room }, affectedUserIds);
    for (const c of result.membershipChanges) {
      this.realtime.syncRoomMembership(actor.companyId, roomId, c.userId, c.action);
    }
  }
  return result.dto;
}
```

Thứ tự **emit trước, sync sau**: `emitChatRoom` dùng multi-target nên không phụ thuộc việc socket đã join/leave phòng hay chưa. `result.changed` (rev 2 thêm — rev 1 không có) là cổng chung "chỉ emit khi giao dịch THỰC SỰ đổi trạng thái", áp dụng đồng nhất cho cả nhóm `chat-rooms.service.ts`/`chat-members.service.ts` (chương này) lẫn nhóm tin nhắn (§1.9).

### 1.8 `chatRoomName` — thêm vào `rooms.ts`, giữ nguyên tiền tố

```ts
export function chatRoomName(companyId: string, roomId: string): string {
  return `co:${companyId}:chatroom:${roomId}`;
}
```

### 1.9 Bảng ánh xạ CỨNG — 3 điểm gọi RT-1 tự thêm vào code THẬT của BE-2

⚠️ Thay hoàn toàn "hợp đồng tích hợp giả định" của rev 1 §1.9. BE-2 đã commit (đo thật #17), tự tuyên bố chừa nguyên (đo thật #17-18) — RT-1 **CHỈNH SỬA TRỰC TIẾP** 2 file dưới đây (thêm vào `paths` của WO — đã có sẵn `apps/api/src/chat/**`).

#### (a) `ChatMessagesService.sendMessage` (`chat-messages.service.ts:86-167`) → `chat:message`

Vấn đề cần vá cùng lúc (điều kiện gỡ BLOCK #5 — không emit lặp): gửi lại cùng `clientMessageId` (early return `if (existing) return existing.id;`, dòng 106) và nhánh đua-thua trong `.catch` (dòng 152-163) đều KHÔNG được emit — chỉ nhánh **INSERT thật sự chạy** mới emit. Đổi tx trả về `{ messageId, isNew: boolean }` thay vì chỉ `id`:

```text
sendMessage(actor, roomId, dto):
  { messageId, isNew } = await withTenant(tx => {
      ... assertMember, chặn archived, tra clientMessageId ...
      if (existing) return { messageId: existing.id, isNew: false }        // replay — KHÔNG emit
      ... validate reply, mentions, allocateRoomSeq, insertMessage, setLastReadSeq (tự-nâng, §1.9.3) ...
      return { messageId: inserted.id, isNew: true }                       // thật sự tạo mới
    }).catch(err => {
      if (!isClientIdConflict(err)) throw err
      raced = withTenant(tx => findByClientMessageId(...))
      if (!raced) throw err
      return { messageId: raced.id, isNew: false }                         // đua thua — bên thắng đã emit
    })

  dto2 = await readMessage(actor, messageId)     // tx đọc lại, đã tồn tại sẵn — KHÔNG đổi
  if (isNew): this.realtime.emitChatMessage(actor.companyId, roomId, dto2)
  return dto2
```

Test bắt buộc (§4): gửi lại đúng `clientMessageId` → đúng **1** `chat:message` (không phải 2).

#### (b) `ChatMessagesService.markRead` (`chat-messages.service.ts:173-190`) → `chat:read`

`clampReadCursor` đã tự bảo vệ "số nhỏ hơn → bỏ qua im lặng" — nhưng code hiện tại LUÔN trả 200 dù có ghi hay không. Thread cờ `changed` ra khỏi tx:

```text
markRead(actor, roomId, dto):
  result = await withTenant(tx => {
      acc = assertMember(...)
      next = clampReadCursor(dto.seq, acc.membership.lastReadSeq, acc.room.lastMessageSeq)
      changed = next !== acc.membership.lastReadSeq
      if (changed): setLastReadSeq(tx, ..., next)
      return { roomId, lastReadSeq: next, unreadCount: unreadOf(acc.room.lastMessageSeq, next), changed }
    })
  if (result.changed):
    this.realtime.emitChatRead(actor.companyId, roomId, { roomId, userId: actor.id, lastReadSeq: result.lastReadSeq })
  const { changed, ...dto2 } = result   // ⚠️ `changed` là cờ NỘI BỘ — KHÔNG được lọt vào ChatMarkReadResultDto trả cho client
  return dto2
```

Test bắt buộc: `markRead` với `seq` nhỏ hơn con trỏ hiện tại → HTTP 200 như cũ, nhưng **0** `chat:read`.

#### (c) `ChatMessageModerationService.recall` (`chat-message-moderation.service.ts:38-68`) → `chat:message-recalled`

Idempotent (dòng 41: `if (acc.message.recalledAt) return this.readDto(...)`) — nhánh idempotent KHÔNG được emit lại. Thread `recalledNow`:

```text
recall(actor, messageId):
  result = await withTenant(tx => {
      acc = assertMessageAccess(...)
      if (acc.message.recalledAt):
        return { dto: readDto(tx,...), recalledNow: false, roomId: acc.message.roomId, recalledAt: null }
      now = new Date()
      assertCanRecall(acc, now)
      setRecalled(tx, ..., now, actor.id); unlinkMessageFiles(tx, ..., now)
      audit.record(tx, ...)   // KHÔNG ĐỔI
      return { dto: readDto(tx,...), recalledNow: true, roomId: acc.message.roomId, recalledAt: now.toISOString() }
    })
  if (result.recalledNow):
    this.realtime.emitChatMessageRecalled(actor.companyId, result.roomId,
      { messageId, roomId: result.roomId, recalledAt: result.recalledAt })
  return result.dto
```

⚠️ **Payload KHÔNG kèm `body`** (kể cả `null`) — **owner đã chốt 02/08/2026** (đo thật #18), đúng API-13 §7 dòng 2. Câu "emit `body:null`" từng có trong một bản backlog cũ đã được owner sửa — plan này ghi nhận quyết định CHỐT, không phải đang đề xuất. Test bắt buộc: thu hồi 2 lần liên tiếp → đúng **1** `chat:message-recalled`.

#### 1.9.1 Constructor injection

`ChatMessagesService` và `ChatMessageModerationService` thêm `RealtimeEmitterService` vào constructor (cùng khuôn `ChatRoomsService`/`ChatMembersService` — xem §2).

#### 1.9.2 KHÔNG emit `chat:read` cho lần tự-nâng con trỏ của chính người gửi (MEDIUM)

`sendMessage` tự gọi `this.repo.setLastReadSeq(tx, ..., roomSeq)` cho CHÍNH người gửi TRONG CÙNG tx (`chat-messages.service.ts:144`, giữ nguyên — SPEC-15 §13.2). Thiết kế (a) ở trên **chỉ** gọi `emitChatMessage`, không bao giờ gọi `emitChatRead` từ `sendMessage` — đây là RÀNG BUỘC, không phải tình cờ. Người thi công KHÔNG được "tiện tay" thêm `emitChatRead` vào nhánh tự-nâng: người gửi đã biết mình vừa gửi tin (chính họ bấm gửi), một `chat:read` dội lại là nhiễu vô nghĩa, và với phòng nhóm đông người sẽ nhân N sự kiện `chat:read` giả cho mỗi tin gửi. Chỉ đường `markRead` tường minh (b) mới được gọi `emitChatRead`.

### 1.10 "user bị khoá/vô hiệu hoá → cắt phiên WS" — diễn giải HẸP, KHÔNG tự chế cơ chế ngoài phạm vi

Không đổi từ rev 1 — đo thật #14 vẫn xác nhận **không có nguồn sự kiện nào trong `paths` của RT-1** kích hoạt "khoá tài khoản"; hành động đó sống ở `apps/api/src/auth/**`, NGOÀI paths, và AUTH hiện chưa revoke access token đang sống khi khoá (gap đã biết, memory `auth-account-audit-2026-07`).

**Chốt:** RT-1 diễn giải bullet này = hệ quả TỰ NHIÊN của "rời mọi phòng dẫn xuất" (SPEC-15 §13.3) — đã phủ đủ bởi `syncRoomMembership` generic ở §1.3 (bất kỳ code nào set `left_at` đều gọi được cùng primitive). RT-1 **KHÔNG** dựng cơ chế "ngắt toàn bộ socket khi tài khoản bị khoá" — gap AUTH cấp hệ thống, ảnh hưởng MỌI kênh WS, nên vá ở đúng tầng AUTH khi có WO riêng. Ghi rủi ro ở §6.

> ⚠️ Nếu owner không đồng ý cách diễn giải này, cần mở rộng `paths` sang `apps/api/src/auth/**` và xác nhận lại TRƯỚC khi code.

### 1.11 MEDIUM — vì sao dùng `listRoomsForUser` thay vì gọi `assertMember` N lần

`ChatAccessService.assertMember` khẳng định membership **một phòng, một lần**, ném 404 nếu sai — không phù hợp cho "liệt kê TẤT CẢ phòng của user lúc connect" (không có `roomId` để truyền vào, và N lần gọi cho N phòng là round-trip thừa). `ChatRoomsRepository.listRoomsForUser` là bản LIỆT KÊ của **CÙNG một luật**, không phải luật thứ hai: đối chiếu cột-cho-cột (đo thật #22) — `companyId` khớp · `chatRooms.deletedAt IS NULL` · `chatRoomMembers.userId = actorUserId` · `leftAt IS NULL` — **giống hệt** `activeMembershipJoin` + `visibleRoom` của `ChatAccessService`. RT-1 không viết lại vị từ này; nó tái dùng đúng phương thức đã được `ChatModule` export SẴN CHO MỤC ĐÍCH NÀY (comment gốc: *"`ChatAccessService` được `exports` để … `S7-CHAT-RT-1` (WebSocket) dùng LẠI ĐÚNG hàm này"*, `chat.module.ts:27-29` — dù dòng đó nói về `ChatAccessService`, nguyên tắc tương tự áp cho `ChatRoomsRepository` đã export). FULL-gate reviewer khi kiểm "có bản sao thứ hai của luật quyền không" nên diff hai khối `and(...)` này, không chỉ nhìn tên hàm khác nhau mà kết luận vội.

### 1.12 MEDIUM — `RealtimeEmitterService` chỉ được import từ file lá

Luật: chỉ `apps/api/src/realtime/realtime-emitter.service.ts` (qua `RealtimeEmitterModule`, leaf — đo thật #8) được các service trong `apps/api/src/chat/**` import. **CẤM** bất kỳ file nào dưới `apps/api/src/chat/` import trực tiếp `RealtimeGateway` hoặc `RealtimeModule` — làm vậy là dựng lại đúng cycle `Realtime→Chat→Realtime` mà `RealtimeEmitterModule` được tách riêng để tránh (§1.1). Grep kiểm chứng, đưa vào test cấu trúc (§4 ca 13b):

```bash
grep -rn "from .*realtime\.gateway\|from .*realtime\.module\"" apps/api/src/chat/
# → 0 dòng
```

---

## 2. Phạm vi thi công

| File | Việc |
| --- | --- |
| `packages/contracts/src/realtime.ts` | Xoá 7 event key + 10 schema chết (§1.5, **commit riêng**); thêm 3 event key + 4 schema mới (§1.3, §1.4); import thêm `chatRoomSchema` từ `./chat` |
| `apps/api/src/realtime/rooms.ts` | Thêm `chatRoomName(companyId, roomId)` (§1.8) |
| `apps/api/src/realtime/realtime-emitter.service.ts` | Thêm 5 method (§1.3); sửa comment dòng 20 |
| `apps/api/src/realtime/realtime.gateway.ts` | `handleConnection` → async, cổng quyền + join + re-check (§1.2); constructor thêm `PermissionService`, `ChatRoomsRepository`, `DatabaseService`; sửa comment dòng 29-31 |
| `apps/api/src/realtime/realtime.module.ts` | `imports` thêm `ChatModule` + `PermissionModule` (§1.1); sửa comment dòng 13 |
| `apps/api/src/chat/chat.module.ts` | `imports` thêm `RealtimeEmitterModule` (§1.1) — **APPEND-ONLY**, xem kỷ luật hot-file dưới |
| `apps/api/src/chat/chat-rooms.service.ts` | Wiring emit/sync cho `createGroup`/`openDirect`/`resurrectDirect`/`updateRoom`/`archiveRoom`/`leaveRoom` (§1.6, §1.6.1, §1.7); constructor inject `RealtimeEmitterService` |
| `apps/api/src/chat/chat-members.service.ts` | Wiring emit/sync cho `addMember`/`updateMemberRole`/`removeMember` (§1.6, §1.7); constructor inject `RealtimeEmitterService` |
| `apps/api/src/chat/chat-messages.service.ts` | 🆕 Wiring `emitChatMessage`/`emitChatRead` vào `sendMessage`/`markRead` (§1.9a, §1.9b, §1.9.2); constructor inject `RealtimeEmitterService` |
| `apps/api/src/chat/chat-message-moderation.service.ts` | 🆕 Wiring `emitChatMessageRecalled` vào `recall` (§1.9c); constructor inject `RealtimeEmitterService` |
| `apps/api/src/realtime/realtime.gateway.spec.ts` | 9 call-site `new RealtimeGateway(...)` cần thêm tham số constructor mới (đo thật #24) — CHỈ nới stub (thêm mock `PermissionService`/`ChatRoomsRepository`/`DatabaseService`), **CẤM làm yếu bất kỳ assert cũ nào** |
| `apps/api/src/realtime/realtime.gateway.io.spec.ts` | 1 call-site tương tự (đo thật #24) — cùng luật "chỉ nới stub" |
| `apps/api/test/integration/chat-rt1-*.int-spec.ts` | Test mới — xem §4 |

### Kỷ luật hot-file + thứ tự merge (RT-1 chạy SAU BE-2, SONG SONG BE-3/4/5/6)

RT-1 phụ thuộc `S7-CHAT-BE-2` (backlog `depends_on`) nhưng chạy **song song** với `S7-CHAT-BE-3` (tệp), `S7-CHAT-BE-4` (tìm kiếm), `S7-CHAT-BE-5` (thành viên dẫn xuất), `S7-CHAT-BE-6` (NOTI) — TẤT CẢ cùng chạm `apps/api/src/chat/**`. Rủi ro xung đột merge cụ thể:

- **`chat.module.ts`** — RT-1 chỉ THÊM một dòng vào `imports` (`RealtimeEmitterModule`). BE-3/4/5/6 nhiều khả năng cũng thêm provider/import riêng vào CÙNG file. Luật: **append-only** — không xoá, không sắp xếp lại danh sách hiện có, chỉ thêm vào cuối mảng tương ứng. Ai merge SAU phải tự rebase, KHÔNG revert khối của người merge TRƯỚC.
- **`chat-rooms.service.ts` / `chat-members.service.ts`** — RT-1 thêm lời gọi emit/sync tại các điểm SAU `withTenant` resolve (điểm chèn cụ thể đã chỉ rõ ở §1.7, §1.9) — không refactor logic nghiệp vụ hiện có trong các file này. Nếu BE-5 (đồng bộ thành viên dẫn xuất) cũng cần sửa `chat-members.service.ts` song song, người merge sau đọc lại `membershipChanges`/`affectedUserIds` đã được RT-1 thread ra để tái dùng thay vì tạo cơ chế thứ hai.
- **`chat-messages.service.ts` / `chat-message-moderation.service.ts`** — tương tự, RT-1 chỉ thêm lời gọi emit SAU tx, không đổi thứ tự các bước nghiệp vụ đã có (idempotency, validate, assertMember…).
- Theo `docs/plans/S7-CHAT-WAVE.md` §4: mỗi WO có nhánh `wo/s7-chat-<xx>` riêng, PR vào `wave/s7-chat`, KHÔNG auto-merge — người merge PR sau phải tự rebase lên `wave/s7-chat` mới nhất trước khi merge, không phải máy tự làm.

---

## 3. KHÔNG làm trong WO này

- ❌ Bất kỳ endpoint/service MỚI nào của `S7-CHAT-BE-2`/`BE-3`/`BE-4`/`BE-5`/`BE-6`/`BE-7` — RT-1 chỉ THÊM lời gọi emit vào code BE-2 **đã tồn tại**, không đổi logic nghiệp vụ của nó.
- ❌ `S7-CHAT-BE-5` (đồng bộ thành viên dẫn xuất phòng ban/dự án) — `syncRoomMembership` là primitive TỔNG QUÁT sẵn sàng cho BE-5 gọi khi nó tồn tại, RT-1 không tự dựng job đối soát.
- ❌ `S7-CHAT-BE-7` (đọc-vượt Super Admin, `/chat/oversight/*`) — SPEC-15 §3.3 dòng 6 chốt SA **không** join room chat, **không** nhận `chat:message` realtime. Danh sách join đến từ `chat_room_members` thật — SA không có hàng ở đó cho phòng mình không thuộc, không cần code loại trừ riêng.
- ❌ Cơ chế "cắt phiên WS khi khoá/vô hiệu hoá tài khoản" chủ động — xem §1.10.
- ❌ Bất kỳ `@SubscribeMessage` nào — giữ nguyên CHAT-DEC-005.
- ❌ Đổi FE (`apps/app`, `packages/web-core`) — RT-1 chỉ là mặt BE; FE tiêu thụ ở `S7-CHAT-FE-1..3`. Quyết định "fail loud disconnect" ở §1.2(B) là ràng buộc RT-1 đặt ra CHO `S7-CHAT-FE-1` tuân theo (dùng cơ chế reconnect + afterSeq có sẵn của `socket.io-client`), không phải RT-1 tự sửa FE.
- ❌ Đụng `app.module.ts`/`config/openapi-modules.ts` — đã wire xong ở BE-1 (đo thật #11), 0 route HTTP mới nên không cần regen route-census.
- ❌ Permission pair mới / migration mới — RT-1 không có bề mặt HTTP mới, tái dùng NGUYÊN cặp `('view','chat-room')` đã seed ở `0538` (đo thật #20).
- ❌ Typing indicator / presence online-offline — SPEC-15 dòng 167 chốt "đo nhu cầu thật sau v1".

---

## 4. Test RED-trước

⚠️ Chủ thể test **KHÔNG được là Super Admin** (cùng lý do BE-1/BE-2 — SA giữ toàn bộ catalog, không đại diện được actor thường).

| # | Ca | Kỳ vọng | Lớp test |
| --- | --- | --- | --- |
| 1 | User có N phòng active (không lưu trữ), có cặp `view:chat-room` | Socket join ĐỦ N room `chatRoomName` + 1 `userRoomName` (`fetchSockets()` phía server) | int (`AppModule` + `LANE_DB` + `app.listen(0)` + `socket.io-client` thật) |
| 2 🆕 | Đan xen: user đang connect (giữa bước join-loop) trong khi admin gọi `DELETE /chat/rooms/:id/members/:userId` gỡ CHÍNH user đó | Socket **không** kẹt lại trong phòng đã gỡ sau khi connect hoàn tất (§1.2 bước C bắt được) | int, race thật (không mock timer) |
| 3 | User có phòng ĐÃ lưu trữ | Socket **không** join room của phòng đó | int, cùng bộ với #1 |
| 4 | Client gửi frame `chat:join` giả mạo (không có `@SubscribeMessage` xử lý) | 0 hiệu ứng — grep 0 `@SubscribeMessage` + 1 test kết nối thật xác nhận server không đổi trạng thái join | grep (structural) + int |
| 5 | Admin thêm user A vào phòng qua `POST /chat/rooms/:id/members`, A đang kết nối | Socket của A join room mới NGAY (verify nhận thật 1 `chat:room` kế tiếp) | int |
| 6 | Admin bớt user B khỏi phòng, B đang kết nối (KHÔNG đan xen với connect — ca 2 đã phủ phần đan xen) | Socket B rời room ngay; broadcast tiếp theo không tới B; B **có** nhận đúng 1 `chat:room{member_removed}` qua user-room | int |
| 7 | Người ngoài phòng đoán đúng `roomId`, có socket kết nối | Không nhận bất kỳ `chat:message`/`chat:room` nào của phòng đó | int |
| 8 | Cross-tenant company B cùng cấu trúc | Socket company A không bao giờ chung `chatRoomName` với company B | int |
| 9 | Transaction rollback (`withTenant` reject) trong `createGroup`/`addMember`/`removeMember`/`sendMessage`/`markRead`/`recall` | `emitChatRoom`/`emitChatMessage`/`emitChatRead`/`emitChatMessageRecalled`/`syncRoomMembership` **0 lần gọi cho MỖI method** | unit (mock, không cần `LANE_DB`) |
| 10 | Payload `chat:room` action `updated` bắt thật qua `socket.io-client` | Object nhận được **không có key** `unreadCount` trong `room` | int |
| 11 | `openDirect` gọi 2 lần liên tiếp (idempotent) | Đúng **1** `chat:room{created}` phát (lần đầu); lần hai KHÔNG phát gì | int |
| 12 🆕 | `openDirect` → `resurrectDirect`, CẢ HAI thành viên vẫn active lúc phòng bị soft-delete rồi resurrect (test dựng trạng thái này thẳng qua repo, không qua API — v1 chưa có endpoint xoá mềm phòng) | CẢ HAI nhận `chat:room{created}` + `syncRoomMembership("join")`, kể cả người không đổi hàng `chat_room_members` (§1.6.1) | int |
| 13 | `updateMemberRole` | Phát `chat:room{member_role_changed}`; **0** lệnh `socketsJoin`/`socketsLeave` (mock `syncRoomMembership`, assert 0 call) | unit + int |
| 13b 🆕 | Grep `apps/api/src/chat/**` | 0 import trực tiếp `realtime.gateway`/`realtime.module` (§1.12) | grep (structural) |
| 14 | `REALTIME_ENABLED=false` (app riêng) | Luồng REST tạo phòng/thêm/bớt/gửi/thu hồi/đánh dấu đọc vẫn 200/201 đúng dữ liệu DB | int (app thứ 2, `LANE_DB` dùng chung được) |
| 15 | Grep `apps/api/src/realtime/**` + `apps/api/src/chat/**` | 0 chỗ đọc `roomId`/danh sách phòng từ `client.handshake` để quyết định join | grep (structural) |
| 16 | Reconnect sau khi membership đổi | Kết nối MỚI join đúng theo trạng thái DB hiện tại | int, khuôn `realtime.gateway.io.spec.ts` "reconnect re-joins cleanly" |
| 17 🆕 | Role **thường**, là thành viên hợp lệ của phòng, nhưng **thiếu** cặp `view:chat-room` (thu hồi permission, KHÔNG thu hồi membership) | Connect **thành công** (JWT hợp lệ) nhưng **0** phòng chat được join; vẫn nhận `notification:new` bình thường; gửi tin từ người khác trong phòng đó → **0** `chat:message` tới socket này | int (§1.2 bước A) |
| 18 🆕 | `sendMessage` gửi lại đúng `clientMessageId` (idempotent replay) | Đúng **1** `chat:message` phát (lần đầu); lần replay **0** | int (§1.9a) |
| 19 🆕 | `recall` gọi 2 lần liên tiếp trên cùng `messageId` | Đúng **1** `chat:message-recalled`; payload **không có key** `body` | int (§1.9c) |
| 20 🆕 | `markRead` gửi `seq` NHỎ HƠN con trỏ hiện tại | HTTP 200 như cũ (không đổi hành vi REST); **0** `chat:read` phát | int (§1.9b) |
| 21 🆕 | `sendMessage` (không phải `markRead`) — tin của CHÍNH người gửi tự nâng `last_read_seq` trong cùng tx | **0** `chat:read` phát cho lần tự-nâng này — chỉ `chat:message` | int (§1.9.2) |
| 22 🆕 | `handleConnection` khi `listRoomsForUser` ném lỗi (mock `DatabaseService.withTenant` reject cho lần gọi ĐẦU) | `client.disconnect(true)` được gọi; `logger.error` ghi nhận | unit (§1.2 bước B) |
| 23 🆕 | `createGroup` tạo nhóm gồm actor + user B, B đang online (socket đã connect trước đó, join sẵn `userRoomName` của B) | B nhận đúng **1** `chat:room{created}` **KHÔNG cần reconnect** — verify qua chính `userRoomName(B)`, không phải `chatRoomName` của phòng mới | int (§1.6) |

**Khuôn test bắt buộc cho ca cần WS+DB thật:** `Test.createTestingModule({ imports: [AppModule] }).compile()` → `app.listen(0)` (KHÔNG chỉ `app.init()`) → lấy port → `ioClient(url, { auth: { token: tokenService.signAccessToken({...}) } })` với `url = http://127.0.0.1:${port}/ws`. Seed qua `test/helpers/seed.ts`, REST qua `supertest(app.getHttpServer())`, WS qua client thật. Đóng cả `app.close()` lẫn client sockets ở `afterAll`/`afterEach`.

Chạy: `bash scripts/lane-db-setup.sh chatrt1` → `export LANE_DB=mediaos_chatrt1` → nạp env đúng chuỗi (memory `lane-db-run-needs-explicit-urls`, xem BE-1 §4) → `bash harness/check.sh --lane-db`. Drop lane khi xong.

### 4.1 Bằng chứng RED (bắt buộc — vá tạm, chạy, hoàn nguyên)

| Vá tạm | Ca ĐỎ kỳ vọng |
| --- | --- |
| Bỏ bước (A) cổng quyền khỏi `handleConnection` (join thẳng không kiểm `permission.can`) | ca 17 |
| Bỏ bước (C) re-check sau vòng join | ca 2 |
| Đổi `client.disconnect(true)` (B) lại thành fail-soft (log rồi return, không disconnect) | ca 22 |
| Bỏ cờ `isNew` ở `sendMessage`, luôn emit sau mỗi lần gọi (kể cả replay) | ca 18 |
| Bỏ cờ `recalledNow` ở `recall`, luôn emit | ca 19 |
| Bỏ cờ `changed` ở `markRead`, luôn emit | ca 20 |
| Thêm nhầm `emitChatRead` vào nhánh tự-nâng của `sendMessage` | ca 21 |
| Đổi `emitChatRoom` chỉ target `chatRoomName` (bỏ `affectedUserIds`) | ca 23 |
| Bỏ nhánh "else: affected.push(userId)" ở `resurrectDirect` (§1.6.1) | ca 12 |
| Bọc `emitChatRoom`/`syncRoomMembership` TRONG `withTenant` (trước commit) thay vì sau | ca 9 |

---

## 5. Definition of Done — map 1-1 với `done_when` của backlog (`harness/backlog.mjs:9789-9799`)

- [ ] `chatRoomName(companyId, roomId)` thêm vào `realtime/rooms.ts`, prefix `co:{companyId}:` giữ nguyên (§1.8) — ca test 8
- [ ] `handleConnection` join TẤT CẢ phòng của user, danh sách đọc từ DB phía SERVER — CẤM nhận `roomId` từ payload client; **0** `@SubscribeMessage` mới (§1.2, §3) — ca test 1, 4, 15
- [ ] Emit `chat:message`/`chat:message-recalled`/`chat:read`/`chat:room` SAU KHI transaction commit; **RT-1 tự thêm lời gọi vào `ChatMessagesService.sendMessage`/`markRead` + `ChatMessageModerationService.recall`** — KHÔNG còn dead code (§1.7, §1.9) — ca test 9, 18, 19, 20, 21
- [ ] Cổng quyền đường đọc WS: `PermissionService.can({action:"view", resourceType:"chat-room"})` TRƯỚC vòng join phòng chat, deny → chỉ join user-room (§1.2 bước A) — ca test 17
- [ ] Mọi payload `.parse()` qua schema contracts trong `RealtimeEmitterService` — cấm `io.emit` row DB thẳng; `chat:message-recalled` đúng `{messageId, roomId, recalledAt}`, KHÔNG kèm `body` (§1.3, §1.9c — owner chốt 02/08/2026) — ca test 19
- [ ] Membership đổi (thêm/bớt/rời) → server buộc socket join/leave NGAY, không đợi reconnect (§1.6, §1.7) — ca test 5, 6, 23; đua connect↔removeMember tự-vá (§1.2 bước C) — ca test 2
- [ ] `REALTIME_ENABLED=false` → gateway từ chối ở handshake, nghiệp vụ vẫn ĐÚNG HOÀN TOÀN qua bù `afterSeq` (test cả 2 chế độ) — ca test 14
- [ ] RED-trước: socket ngoài phòng KHÔNG nhận emit dù đoán đúng `roomId`; cross-tenant không bao giờ chung room — ca test 7, 8
- [ ] "user bị khoá/vô hiệu hoá → cắt phiên WS" — diễn giải hẹp đã ghi rõ ở §1.10, owner chưa yêu cầu mở rộng `paths`
- [ ] FULL gate (`security-reviewer` + `database-reviewer` + `silent-failure-hunter`) PASS — chờ sau khi code xong

---

## 6. Nợ / rủi ro

1. **Cửa sổ đua connect↔removeMember không đóng 100% tuyệt đối** (§1.2 bước C) — chỉ thu hẹp còn khoảng thời gian giữa lần đọc `fresh` thứ hai và các lệnh `leave` thực thi (micro-giây). KHÔNG phải lỗ REST (mọi endpoint vẫn qua `assertMember`), chỉ có thể rò tối đa vài sự kiện realtime trong cửa sổ cực hẹp. Nếu cần đóng tuyệt đối, cần cơ chế khoá/hàng đợi theo `userId` — ngoài phạm vi rẻ-tiền của WO này, ghi nợ.
2. **`client.disconnect(true)` khi DB lỗi lúc connect (§1.2 bước B) làm chết luôn đường NOTI của lần connect đó** — đánh đổi có chủ đích (xem lý do đầy đủ ở §1.2), phụ thuộc `socket.io-client` tự reconnect đúng cấu hình mặc định. Nếu `S7-CHAT-FE-1` tắt auto-reconnect, đánh đổi này thành mất NOTI thật — cần FE-1 xác nhận giữ auto-reconnect mặc định.
3. **"Cắt phiên WS khi khoá tài khoản" (§1.10) diễn giải hẹp, KHÔNG đóng gap AUTH lock-no-revoke** — user bị khoá vẫn giữ WS sống tới khi access token hết hạn tự nhiên (≤15 phút). Không phải RT-1 làm tệ hơn, nhưng cũng không vá. Owner cần WO riêng chạm `auth/**` nếu muốn đóng.
4. **Cửa sổ BE-5 chưa tồn tại:** phòng `department`/`project` chỉ có thành viên từ backfill DB-1, không tự cập nhật khi đổi phòng ban/dự án. `syncRoomMembership` sẵn sàng nhận cuộc gọi từ BE-5. BE-5 chạy song song RT-1, không phụ thuộc RT-1 — rủi ro thời gian thấp.
5. **Multi-instance join/leave (đo thật #7) mới verify ở tầng "API đúng"** — chưa có test 2-process Node + Valkey thật trong CI. Rủi ro thấp (adapter đã verify implement đúng), ghi nhận giới hạn bộ test.
6. **`openDirect` cần thread cờ `created: boolean` đúng** — bỏ sót thì "mở lại DM cũ vẫn bắn `chat:room created`" — sai nhưng không rò dữ liệu, bắt bởi ca test 11.
7. **`resurrectDirect` §1.6.1 chỉ có ý nghĩa khi có đường xoá mềm phòng thật** — v1 chưa có endpoint đó (chỉ có nhánh nội bộ dùng cho race/lưới tương lai) — ca test 12 phải tự dựng trạng thái "phòng đã xoá mềm" thẳng qua repo/SQL trong test, không qua API công khai.
8. **Kỷ luật hot-file (§2) dựa vào con người rebase đúng** — không có gate tự động nào chặn 2 WO song song ghi đè nhau ở `chat.module.ts`/`chat-*.service.ts` ngoài review-by-eye lúc merge PR. Nếu wave chạy nhiều lane song song thật (không chỉ tuần tự như mô hình hiện tại — CLAUDE.md §9), rủi ro này tăng.
9. FULL gate (`security-reviewer` + `database-reviewer` + `silent-failure-hunter`) **CHƯA chạy** — để dành sau khi code xong (không spawn sub-agent ở giai đoạn lập plan).
