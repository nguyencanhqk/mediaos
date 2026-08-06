# Kế hoạch thi công `S8-CHAT-UX-RT-1` — "đang gõ" (REST-ping) + "đang online" (presence thuần server)

> Vùng **ĐỎ** (crown-jewel: chạm cổng quyền WS + vòng đời phiên). Gate = **FULL**.
> Nguồn sự thật: `SPEC-15 §3.5 · §5.2 · CHAT-FUNC-021 · CHAT-DEC-005 · CHAT-DEC-017` ·
> `API-13 §5.1 (CHAT-API-023) · §7` · `DECISIONS-07` (hàng rào R1).
> Ngày lập: 06/08/2026.

---

## 1. Ràng buộc CỨNG — phá cái nào là hỏng WO

| # | Ràng buộc | Đo ở đâu |
| --- | --- | --- |
| R1 | **0 `@SubscribeMessage` trong TOÀN BỘ `apps/api/src`** (CHAT-DEC-005) | `apps/api/src/realtime/chat-realtime-structure.spec.ts:26` — quét đệ quy, đã strip comment |
| R2 | Gateway **chỉ** đọc `.handshake.auth` / `.handshake.headers` | cùng file, `:43` |
| R3 | `chat/**` chỉ được import `realtime-emitter.{service,module}` | cùng file, `:69` |
| R4 | Mọi payload server→client `.parse()` qua schema contracts trước khi emit | `RealtimeEmitterService` |
| R5 | Khoá presence trên Valkey **PHẢI mang tiền tố môi trường** + **PHẢI có TTL** | `API-13 §7` · memory `valkey-shared-across-all-envs-no-channel-prefix` |
| R6 | `chat:typing` **0 ghi DB · 0 audit**, trả `204` | `API-13 §5.1 CHAT-API-023` |

**Hệ quả kiến trúc:** typing đi vào bằng **REST** (`ChatRoomsController`), presence đi vào bằng **vòng đời
kết nối** (`handleConnection` / `handleDisconnect`). Không có đường thứ ba, và không thêm handler inbound nào.

---

## 2. Điểm xuất phát (ĐO THẬT, không theo trí nhớ)

- `RealtimeGateway.handleConnection` đã có 4 bước (0)(A)(B)(C) — join `userRoomName`, cổng quyền
  `view:chat-room`, join `chatRoomName`, tự-vá đua. Presence chèn **SAU** (A) — tức chỉ user đã qua cổng
  quyền CHAT mới vào bảng presence.
- `RealtimeEmitterService` có 4 emit chat + `syncRoomMembership` + `severUserSessions`, tất cả đi qua
  `.parse()`. Thêm 2 emit nữa theo đúng khuôn.
- `ValkeyService` (`apps/api/src/permission/valkey.service.ts`) hiện có `get/set/setNx/incr/del` — **KHÔNG có**
  primitive tập hợp. Presence cần SADD/SREM/SCARD/EXPIRE ⇒ phải bổ sung (mục 6).
- `resolveValkeyChannelKey()` (`ws-adapter-config.ts`) **đã giải đúng bài toán R5** cho kênh pub/sub:
  khoá = `socket.io:{NODE_ENV}:{db}`, `LANE_DB` thắng khi có. Đo thật 4 môi trường:

  | Môi trường | `NODE_ENV` | DB | Phạm vi suy ra |
  | --- | --- | --- | --- |
  | PROD (`.env`, `.env.prod`) | `production` | `mediaos` | `production:mediaos` |
  | dev-online (`.env.dev-online`) | *(không đặt → `development`)* | `mediaos_dev` | `development:mediaos_dev` |
  | dev local (`.env.dev`) | `development` | `mediaos` | `development:mediaos` |
  | test lane | `test` | `mediaos_<lane>` | `test:mediaos_<lane>` |

  ⇒ **Tái dùng đúng phép suy này**, không phát minh phép thứ hai. Rút `resolveEnvScope()` ra khỏi
  `resolveValkeyChannelKey()` và dùng chung cho cả hai.

---

## 3. Thiết kế — "đang gõ" (CHAT-API-023)

**Đường đi:** `POST /chat/rooms/:id/typing` → `ChatTypingService.ping()` → `RealtimeEmitterService.emitChatTyping()`
→ `chat:typing` vào `chatRoomName(companyId, roomId)`.

```ts
@Post("rooms/:id/typing")
@HttpCode(204)
@UseGuards(PermissionGuard)
@RequirePermission("send", "chat-message")   // ĐÚNG cặp API-13 §5.1, không phải view:chat-room
```

`ChatTypingService.ping(actor, roomId)` — file MỚI `apps/api/src/chat/chat-typing.service.ts`:

1. `withTenant` → `ChatAccessService.assertMember()` — **điểm khẳng định membership duy nhất** (API-13 §6.1).
   Không thành viên / phòng lạ ⇒ `404 CHAT-ERR-001`. Đây là **đọc**, R6 chỉ cấm **ghi**.
2. **Tiết lưu server** (mục 5) — trượt cửa sổ ⇒ **vẫn trả `204`**, chỉ bỏ emit. Không `429`: client không có
   gì để xử lý khác đi, và một mã lỗi mới cho việc mỹ thuật là nợ hợp đồng.
3. Phòng đã lưu trữ (`access.room.isArchived`) ⇒ **không emit**, vẫn `204`. Phòng lưu trữ là CHỈ ĐỌC
   (`CHAT-ERR-005`); phát "đang gõ" ở đó là báo một việc không thể xảy ra. Đây là **luật nghiệp vụ có chủ
   đích**, không phải nuốt lỗi — ghi `logger.debug` và có ca test đóng đinh.
4. `emitChatTyping(companyId, roomId, { roomId, userId: actor.id })`.

**Không** ghi `audit_logs`, **không** ghi bảng nào, **không** đụng `chat_messages`. Ca test đếm hàng
`audit_logs` trước/sau để đóng đinh R6.

Payload chỉ `{ roomId, userId }` — **không** trạng thái start/stop, **không** nội dung. FE tự tắt chỉ báo sau
5 s (CHAT-DEC-017), nên server không cần phát sự kiện "ngừng gõ" và không giữ trạng thái gõ ở đâu cả.

---

## 4. Thiết kế — "đang online" (presence)

**Vòng đời, thuần server:**

| Móc | Hành động |
| --- | --- |
| `handleConnection`, **sau** cổng quyền (A) | `presence.markOnline(companyId, userId, socketId)` |
| `handleDisconnect` | `presence.markOffline(companyId, userId, socketId)` |
| nhịp tim mỗi `PRESENCE_TTL_SEC / 2` | `presence.refresh()` cho mọi socket **cục bộ** của instance này |

Đặt sau (A) là có chủ đích: người **trượt cặp `view:chat-room`** không xuất hiện trong presence của ai —
cổng quyền CHAT phủ cả kênh này, không chỉ kênh tin nhắn.

### 4.1 Cấu trúc khoá (R5)

```text
chat:presence:{envScope}:co:{companyId}:user:{userId}   →  SET<socketId>,  TTL = PRESENCE_TTL_SEC (60)
```

- `{envScope}` = `resolveEnvScope(env, LANE_DB)` = `{NODE_ENV}:{db}` — **cùng phép suy** với kênh Socket.IO.
- **SET chứ không phải cờ boolean:** một người mở nhiều tab/thiết bị. Đóng một tab không được làm họ offline.
- **TTL trên cả SET, làm mới ở mỗi nhịp tim.** Ngắt bẩn (kill process) ⇒ không ai `SREM`, nhưng cũng không ai
  làm mới ⇒ khoá tự hết hạn sau ≤60 s. **Không** dựa vào `handleDisconnect` chạy được — đó là điều kiện
  `done_when` số 4.

### 4.2 Phát hiện chuyển trạng thái (đúng cả khi nhiều instance)

- `markOnline` → `SADD` + `EXPIRE` + `SCARD` (một pipeline). `SCARD === 1` ⇒ **chuyển offline→online** ⇒ emit.
  Hai socket nối đồng thời: chỉ đúng một cái thấy `SCARD === 1`.
- `markOffline` → `SREM` + `SCARD`. `SCARD === 0` ⇒ `DEL` + emit `offline`.
- `refresh` → `SADD` + `EXPIRE` (idempotent). Nếu khoá vừa hết hạn oan mà socket còn sống, nhịp tim dựng lại.

### 4.3 Ai nhận sự kiện

`API-13 §7` ghi đích là "`co:{companyId}:user:{userId}` của những người có chung phòng `direct`".

⚠️ **Thi công dùng `chatUserRoomName`, KHÔNG phải `userRoomName`** — cùng lập luận đã đóng đinh ở jsdoc
`rooms.ts` và ở `emitChatRoom`: `userRoomName` chứa **mọi** socket đã xác thực, kể cả người đã bị **thu hồi**
cặp `view:chat-room` ⇒ bắn vào đó là đi vòng qua cổng quyền WS (memory `ws-permission-gate-needs-its-own-room`).
Bảng §7 của API-13 đang mô tả **lỏng** — nó ghi y hệt như vậy cho `chat:room`, mà code hiện tại (đã qua FULL
gate S7) dùng `chatUserRoomName`. ⇒ Sửa luôn hai dòng của bảng §7 trong WO này cho doc khớp code.

Danh sách người nhận: `ChatRoomsRepository.listDirectPeerUserIds(tx, companyId, userId)` (hàm MỚI) —
`DISTINCT` user còn hoạt động trong các phòng `room_type='direct'` chung với actor, loại chính actor.
`company_id` khớp ở **cả ba** bảng trong join, `deleted_at IS NULL`, `left_at IS NULL` ở cả hai vế thành viên.

### 4.4 Cắt phiên ⇒ biến mất khỏi presence (`done_when` 5)

`severUserSessions` gọi `disconnectSockets(true)` ⇒ Socket.IO đóng kết nối ⇒ `handleDisconnect` chạy (ở
**chính instance** đang giữ socket đó, kể cả khi lệnh tới qua adapter) ⇒ `markOffline`. **Không cần code mới**,
nhưng cần **ca test** chứng minh đường này chạy chứ không chỉ suy luận.

### 4.5 Presence KHÔNG được làm hỏng kết nối (fail-soft có kêu)

`handleConnection` hiện **fail-LOUD**: lỗi ở khối `try` ⇒ `client.disconnect(true)`, vì "connected mà 0 phòng"
là trạng thái nói dối. Presence **không** thuộc nhóm đó — nó là mỹ thuật, còn kết nối là đường sống của tin
nhắn. ⇒ `markOnline`/`markOffline` **tự bắt lỗi bên trong** (`logger.warn`, không ném lên), để một Valkey
lỗi hoặc một truy vấn peer hỏng **không bao giờ** ngắt phiên chat của người dùng.

Cùng lý do, `handleDisconnect` (Socket.IO **không** await) phải nuốt-có-log mọi lỗi async — một promise
reject ở đó là `unhandledRejection` giết cả tiến trình test (memory `vitest-unhandled-rejection-after-teardown`).

**Nhịp tim phải dọn được:** `setInterval` gọi `.unref()` + gỡ ở `OnModuleDestroy`, và **chỉ** khởi động trong
`afterInit` khi `REALTIME_ENABLED=true`. Timer sống sót sau teardown là nguồn flake kinh điển của suite này.
Sổ socket cục bộ (`Map<socketId, …>`) phải xoá ở `handleDisconnect`, nếu không là rò bộ nhớ chậm.

### 4.6 Cố ý NGOÀI phạm vi WO này

- **Không** có REST đọc "ai đang online" — `API-13 §5.1` không cấp endpoint nào, và `done_when` không đòi.
  ⇒ FE chỉ thấy các **chuyển trạng thái sau khi nối**, chưa thấy ảnh chụp lúc mở app.
  `ChatPresenceService.getOnlineUserIds(companyId, userIds)` được viết **public + có test** để WO FE/BE kế
  tiếp gắn vào (`CHAT-API-007a` là chỗ tự nhiên). **Ghi rõ khoảng trống này trong PR** — không để WO FE phát
  hiện lúc thi công.
- **Không** fallback in-memory khi `VALKEY_URL` vắng: presence thành no-op + WARN lúc khởi động. Một bản sao
  in-memory chỉ đúng ở 1 instance và sẽ nói dối ngay khi scale — thà tắt hẳn còn hơn đúng-một-nửa.

---

## 5. Tiết lưu typing

Khoá `chat:typing:{envScope}:co:{cid}:room:{rid}:user:{uid}`, `setNx(..., ttl=TYPING_THROTTLE_SEC=2)`.

- `setNx` trả `true` ⇒ người đầu tiên trong cửa sổ ⇒ **emit**.
- trả `false` ⇒ trong cửa sổ ⇒ **bỏ emit**.
- trả `null` (Valkey tắt/lỗi) ⇒ **fallback `Map` in-memory** trong service (kèm dọn rác theo hạn), theo đúng
  idiom `LoginRateLimiter`. Ở đây fallback là hợp lệ: tiết lưu là **giảm ồn**, không phải thuộc tính an toàn;
  sai lệch giữa các instance chỉ làm phát dư vài sự kiện mỹ thuật.

---

## 6. Đổi hợp đồng & file chạm

| File | Đổi | Trong `paths` WO? |
| --- | --- | --- |
| `packages/contracts/src/realtime.ts` | +2 key `WS_EVENTS`, +2 schema, **viết lại** khối ⚠️ đang ghi "typing/presence để SAU v1" (nay SAI — CHAT-DEC-017 đảo) | ➕ thêm (WO ghi `chat.ts`, nhưng `WS_EVENTS` sống ở `realtime.ts`) |
| `apps/api/src/realtime/realtime-emitter.service.ts` | `emitChatTyping` · `emitChatPresence` | ✅ |
| `apps/api/src/realtime/chat-presence.service.ts` | **MỚI** | ✅ |
| `apps/api/src/realtime/realtime.gateway.ts` | móc presence + nhịp tim | ✅ |
| `apps/api/src/realtime/ws-adapter-config.ts` | rút `resolveEnvScope()` (refactor thuần) | ➕ thêm |
| `apps/api/src/realtime/realtime.module.ts` | provide `ChatPresenceService` | ➕ thêm |
| `apps/api/src/chat/chat-rooms.controller.ts` | +1 route | ✅ |
| `apps/api/src/chat/chat-typing.service.ts` | **MỚI** | ➕ thêm |
| `apps/api/src/chat/chat-rooms.repository.ts` | `listDirectPeerUserIds` | ➕ thêm |
| `apps/api/src/chat/chat.module.ts` | provide `ChatTypingService` (khối additive) | ➕ thêm |
| `apps/api/src/permission/valkey.service.ts` | `sAddWithTtl` · `sRem` · `sCard` | ➕ thêm |
| `apps/api/test/foundation/route-census.ts` | regen (`ROUTE_CENSUS_WRITE=1`) | ➕ thêm |
| `docs/API Design/API-13_CHAT_API_Design.md` | §7: sửa đích `chat:room` + `chat:presence` → `chatuser` | ➕ thêm |

> **Mở rộng `paths` là có chủ đích và phải cập nhật `harness/backlog.mjs`** — memory `wo-paths-drive-gate-and-scheduler`:
> `paths` lái gate + lịch. Không có `migrations/**` nào ở đây ⇒ WO này **không** đụng schema, không đánh số migration.

**Không** đổi: `chat-realtime-structure.spec.ts` (ratchet — sửa nó là tự tháo cổng), `rooms.ts`,
`severUserSessions`, bất kỳ file `chat/**` nào import ngoài `realtime-emitter.*`.

---

## 7. Ca test — RED TRƯỚC

**Deny-path (viết & chạy ĐỎ trước khi có code):**

1. `POST /chat/rooms/:id/typing` bởi **không phải thành viên** ⇒ `404` (không phải 403 — CHAT-ERR-001).
2. Thành viên nhưng **thiếu cặp `send:chat-message`** ⇒ `403`.
3. Phòng **không tồn tại** ⇒ `404` **giống hệt** ca 1 (không thành oracle dò).

**Hành vi:**

4. Thành viên hợp lệ ⇒ `204`, `audit_logs` **không tăng**, `chat_messages` **không tăng**.
5. Payload emit **đúng 2 khoá** `{roomId, userId}` — parse qua schema strip mọi khoá thừa (thử truyền dư).
6. Hai ping liên tiếp trong cửa sổ ⇒ **1** emit.
7. Phòng đã lưu trữ ⇒ `204` + **0** emit.
8. **A/B môi trường:** hai `ChatPresenceService` cấu hình `production:mediaos` và `development:mediaos_dev`
   trên **cùng một** kho Valkey giả ⇒ đánh dấu online ở cái thứ nhất, cái thứ hai **thấy offline**. Đây là
   bằng chứng cho `done_when` 3 (không cần Valkey thật, và đo đúng thứ cần đo: **không gian khoá**).
9. `markOnline` đặt **TTL > 0** trên khoá (`done_when` 4 — ngắt bẩn tự hết hạn).
10. Hai socket cùng user ⇒ **1** sự kiện `online`; đóng 1 ⇒ **0** sự kiện `offline`; đóng nốt ⇒ `offline`.
11. `severUserSessions` ⇒ `handleDisconnect` ⇒ user rời presence (`done_when` 5).
12. User **trượt cổng `view:chat-room`** ⇒ **không** vào presence, **không** ai nhận `chat:presence` về họ.
13. **Ratchet:** chạy lại `chat-realtime-structure.spec.ts` — 4/4 xanh, dán kết quả vào PR (`done_when` 1).

**Chạy như CI:** `bash harness/check.sh --lane-db=s8chatuxrt1` — int-spec deny-path phải **thực thi thật**,
không được SKIP (memory `integration-test-lane-db-gate`; `LANE_DB` thiếu ⇒ "XANH KHÔNG ĐỦ BẰNG CHỨNG").

---

## 8. Bẫy đã biết phải né

| Memory | Áp vào đâu |
| --- | --- |
| `valkey-shared-across-all-envs-no-channel-prefix` | §4.1 — `envScope` bắt buộc, tái dùng phép suy có sẵn |
| `ws-permission-gate-needs-its-own-room` | §4.3 — `chatUserRoomName`, không `userRoomName` |
| `engineio-cors-never-rejects` | không đụng, nhưng **cấm** thêm cấu hình CORS coi như cổng |
| `route-census-runtime-gate` | §6 — thêm route ⇒ regen census, nếu không `route-guard-coverage` ĐỎ |
| `s1-fnd-module-metadata-seed-drift` | `PermissionGuard` **opt-in per route** — quên `@UseGuards` = route MỞ, im lặng |
| `integration-test-lane-db-gate` | §7 — không có `LANE_DB` thì deny-path **không chạy** |
| `ws-payload-narrower-than-rest-dto` | §3 — payload WS hẹp có chủ đích; FE schema phải khớp bản hẹp |
| `wo-paths-drive-gate-and-scheduler` | §6 — mở rộng `paths` phải ghi vào `backlog.mjs` |
| `module-is-active-is-not-a-gate` | CHAT còn `is_active=false` ở PROD — **không** coi đó là cổng chặn |

---

## 9. Định nghĩa hoàn thành

- [x] Ca test §7 xanh: **13** int-spec (`chat-s8-rt1-typing`) + **17** unit presence + **10** unit typing
      + **9** emitter + **5** gateway-presence + **3** env-scope.
- [x] **Chứng minh ĐỎ THẬT bằng đột biến có kiểm soát** (không phải "route chưa có nên 404"):
      | Đột biến | Ca đỏ | Quan sát |
      | --- | --- | --- |
      | gỡ `@UseGuards(PermissionGuard)` khỏi route typing | ca 3 | `expected 204 to be 403` — route MỞ im lặng |
      | bỏ qua `assertMember` trong `ping()` | ca 1 | `expected 204 to be 404` — mất ranh giới dữ liệu |
      Cả hai đã khôi phục và xanh lại.
- [x] `chat-realtime-structure.spec.ts` **4/4 xanh** (ratchet 0 `@SubscribeMessage` còn nguyên).
- [x] `bash harness/check.sh --lane-db=s8rt1` → **XANH ✅** (secret-literals · lint · typecheck ·
      migration-no-drop · tooling-tests · test). `LANE_DB` CÓ set ⇒ **không** rơi vào "XANH KHÔNG ĐỦ
      BẰNG CHỨNG"; 502/502 file spec của `@mediaos/api` chạy thật.
- [x] Route census regen (482→483 route, gated 430→431); `route-guard-coverage` 9/9 xanh.
- [x] `harness/backlog.mjs` cập nhật `paths` (7→17); API-13 §7 sửa `user` → `chatuser` + ghi chú lý do.
- [ ] FULL gate (`security-reviewer` + `silent-failure-hunter`) **PASS** — chưa chạy, xem §10.

## 10. Hai lỗi TỰ REVIEW bắt được (ghi lại để gate người đọc kiểm chứng)

| # | Lỗi | Vì sao nguy hiểm | Vá |
| --- | --- | --- | --- |
| 1 | `markOnline` ném ⇒ rơi vào `catch` fail-loud của `handleConnection` ⇒ **ngắt phiên chat** | Một Valkey lỗi biến tính năng mỹ thuật thành điểm chết của cả module CHAT | `.catch()` **tại điểm gọi** trong gateway, không dựa vào kỷ luật nội bộ của service |
| 2 | Socket **trượt cổng quyền** `view:chat-room` vẫn phát `chat:presence{offline}` lúc disconnect | `SREM` trên khoá không tồn tại trả `0` — trùng đúng tín hiệu "vừa gỡ socket cuối" ⇒ **offline MA**, và là sự kiện CHAT phát ra bởi người mà cổng quyền vừa từ chối | Cổng `locals.has(socketId)` ở đầu `markOffline`; 2 ca test đóng đinh (đã chứng minh ĐỎ trước khi vá) |

> ⚠️ **FULL gate chưa chạy.** `done_when` mục 6 đòi `security-reviewer` + `silent-failure-hunter`.
> Phiên này chạy dưới chỉ thị KHÔNG gọi sub-agent, nên hai reviewer đó **chưa** được spawn — mục 9 cuối
> còn bỏ trống có chủ đích. Bảng §10 là kết quả tự-review, **không thay thế** gate độc lập
> (memory `reviewers-pass-real-bugs` cắt cả hai chiều).
