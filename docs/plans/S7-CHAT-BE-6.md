# Micro-plan — `S7-CHAT-BE-6` (🟡 yellow · LIGHT gate + security-reviewer) — rev 1 (02/08/2026)

> **WO:** Thông báo CHAT qua `OutboxNotificationBridge` — `CHAT_MENTIONED` (gửi ngay) + `CHAT_DIRECT_MESSAGE`
> (gộp lô 15 phút khi vắng mặt), tôn trọng `muted_until`, payload KHÔNG chứa nội dung tin nhắn.
> **Nguồn sự thật:** [SPEC-15 §17](<../SPEC/SPEC-15 CHAT.md>) · mig `0538` (khối G/H) · memory
> `noti-outbox-bridge-generic` · `idempotency-key-must-be-content-derived` · `noti-catalog-check-lives-on-two-tables`.
> **Nhánh:** commit lên `wave/s7-chat` (❗KHÔNG `master` — WAVE §4).
> **Nền:** `S7-CHAT-DB-1` (mig `0538`, đã land `4c5c2da6`…`1a6ec20a`) — **XONG**. `S7-CHAT-BE-2` (tin nhắn) —
> **CHƯA TỒN TẠI** (0 file `*message*` trong `apps/api/src/chat/`, xác nhận Glob). WO này viết phần tiêu thụ
> sự kiện + khai HỢP ĐỒNG tích hợp mà BE-2 phải đáp ứng; mọi mục đánh dấu 🔶 GIẢ ĐỊNH phải xác nhận lại khi
> BE-2 code thật land.

---

## 0. Đo thật trước khi thiết kế

| Thứ | Đo được 02/08/2026 | Nguồn |
| --- | --- | --- |
| BE-2 chưa tồn tại | `Glob apps/api/src/chat/**` = 11 file (`chat.errors.ts`, `chat-room-code.service.ts`, `chat.dto.ts`, `chat-rooms.controller.ts`, `chat.module.ts`, `chat-members.service.ts`, `chat-rooms.service.ts`, `chat-access.service.ts`, `chat-room-rules.ts`, `chat-rooms.repository.ts`, `chat.mapper.ts`) — **0** file gửi/đọc tin nhắn | Glob |
| `ChatModule` mời BE-2..6 tái dùng `ChatAccessService`/`ChatRoomsRepository` | Comment tường minh "được `exports` để `S7-CHAT-BE-2..6` … dùng LẠI ĐÚNG hàm này" | `chat.module.ts:22-24,40` |
| **NHƯNG** 5 bridge trước (LEAVE/TASK/ATT/GOAL/HR-PCR) đều **KHÔNG** import module nguồn — đọc raw qua reader riêng trong `notifications/**`, lý do "giữ acyclic" | `leave-noti-bridge.registrar.ts:18-21` · `task-audience.reader.ts:26-31` · comment tương tự ở `att-`/`goal-`/`hr-pcr-noti-bridge.registrar.ts` (grep 5/5 khớp) | đọc code |
| `ChatAccessService.assertMember` chữ ký single-user-assert, KHÔNG hợp cho truy vấn "danh sách audience của phòng" | `chat-access.service.ts:73-78` (nhận 1 `actorUserId`, không nhận mảng) | đọc code |
| `ChatRoomsRepository.listActiveMembers` KHÔNG select `mutedUntil` | `chat-rooms.repository.ts:243-272` (SELECT: id/roomId/userId/userName/role/joinedAt/lastReadSeq — thiếu `mutedUntil`) | đọc code |
| `chat_room_members.mutedUntil` **tồn tại** ở schema nhưng **0 đường ghi HTTP** | cột `communication.ts:300`; grep `mutedUntil` / `muted_until` trong `chat.dto.ts`/`chat-rooms.controller.ts`/`chat-members.service.ts`/`packages/contracts/src/chat.ts` = **0 hit** | grep |
| `paths` của WO **không có** `packages/contracts/**` lẫn `apps/api/migrations/**` | `harness/backlog.mjs:9703-9708` — chỉ `apps/api/src/chat/**`, `apps/api/src/notifications/**`, `apps/api/test/integration/**`, plan doc | backlog |
| `EventContext` **không có** `occurredAt` | `event-bus.ts:7-12` (`eventId`,`companyId`,`eventType`,`payload` — hết) | đọc code |
| `NotiEventMapping.dedupeKeyOf`/`payloadOf` là hàm **ĐỒNG BỘ** | `outbox-notification-bridge.service.ts:27,38` (`(ctx) => string \| undefined` / `(ctx) => Record<...>` — không `Promise`) | đọc code |
| `mapping.payloadOf?.(ctx) ?? payload` — **mặc định pass-through TOÀN BỘ** payload nếu không khai `payloadOf` | `outbox-notification-bridge.service.ts:87` | đọc code |
| `assertPayloadSafe` KHÔNG có khoá `body`/`content`/`preview` trong danh sách cấm | `notification-engine.errors.ts:84-98` (`SENSITIVE_PAYLOAD_KEYS` = password/token/…/salary/bank_account/identity_number/private_file_url/signed_url/resettokenenc) | đọc code |
| Cả 2 event CHAT **đã** seed `is_enabled=true` từ `0538`, verify fail-loud xác nhận đúng 2/2 enabled | `0538:717-720` (INSERT) · `0538:859-862` (verify khối H mục 10) | migration |
| `dedupe_strategy` đã CHỐT ở catalog: `CHAT_DIRECT_MESSAGE='DedupeKey'`, `CHAT_MENTIONED='None'`; catalog THẮNG `DEFAULT_DEDUPE` | `0538:707-720` · `notification-dedupe.service.ts:52-54` (`if (catalog !== "None") return {strategy: catalog, ...}`) | migration + code |
| CHECK `module_code`/`notification_type` đã nới **CẢ HAI** bảng cho CHAT | `0538:642-643` (`notification_events`) · `0538:685` (`notifications`) | migration |
| Template CHAT đã seed, `variables_schema` CHÍNH XÁC | `CHAT_MENTIONED` = `{actor_name, room_name, room_id}`, `target_url` = `/chat/{room_id}` — `0538:736-741`; `CHAT_DIRECT_MESSAGE` = `{actor_name, unread_count, room_id}`, `target_url` = `/chat/{room_id}` — `0538:742-747` | migration |
| Renderer thay `{key}` bằng `payload[key]` **VERBATIM**, không đổi case | `notification-renderer.service.ts:64-69` | đọc code |
| Producer resolve tên hiển thị **TRƯỚC** khi enqueue, đặt field snake_case khớp CHÍNH XÁC placeholder — tiền lệ | `task-comments.service.ts:360-388` (`actor_name: actorName` — resolve qua `users.fullName`, fallback non-null, comment dòng 344-348 nói rõ "khớp CHÍNH XÁC placeholder") | đọc code |
| `chat_messages.mentions` jsonb **đã tồn tại**, `NOT NULL DEFAULT []` | `communication.ts:343` | đọc code |
| `EventsModule` là `@Global()` | `events.module.ts:14` — `OutboxService`/`EventBus`/`AuditService` inject được bất kỳ đâu, không cần import tường minh | đọc code |
| `NotificationRecipientResolverService` tự lọc active/locked/deleted + tự loại actor (trừ `is_system_event`) | `notification-recipient-resolver.service.ts:44-54,87-107` — reader/bridge KHÔNG cần lặp lại việc này | đọc code |
| Precedent test 2 ca boot-guard (positive + negative wire-nhầm) | `leave-noti-e2e.int-spec.ts:82,101`; driver outbox thật qua `OutboxWorker.processBatch()`/`drainOutboxUntilSettled` | `leave-noti-e2e.int-spec.ts:46,269` |

---

## 1. Lựa chọn thiết kế — chốt ở đây, không để người thi công tự quyết

### 1.1 KHÔNG import `ChatModule` — viết `ChatAudienceReader` riêng trong `notifications/**`

Đây là quyết định **NGƯỢC** lời mời trong comment `chat.module.ts:22-24`. Lý do:

1. **Nhất quán 5/5 tiền lệ đã ship** (LEAVE/TASK/ATT/GOAL/HR-PCR) — không bridge nào import module nguồn, tất cả đọc raw qua reader riêng trong `notifications/**`, lý do ghi rõ "giữ acyclic". Một comment 1-ngày-tuổi của WO liền trước (chưa qua thực chiến) không đủ trọng lượng để phá quy ước lặp lại 5 lần — mirror bài học `wo-plans-built-on-code-comments` (ưu tiên quy ước ĐÃ CHỨNG MINH qua code thật hơn lời mời trong comment).
2. `ChatAccessService.assertMember` (`chat-access.service.ts:73`) là hàm **single-user-assert** (ném 404 nếu KHÔNG phải thành viên) — sai hình dạng cho nhu cầu "cho tôi danh sách ai còn ĐANG là thành viên + có bị mute không", không tái dùng được nguyên trạng.
3. `ChatRoomsRepository.listActiveMembers` thiếu cột `mutedUntil` — tái dùng đòi sửa file BE-1 đã ship (rủi ro động vào code đã qua FULL gate + 16 ca test của BE-1).
4. Tách notifications/** khỏi chat/** giữ hai module thay đổi độc lập — sửa NOTI không kéo review lại CHAT và ngược lại.

**KHÔNG mất type-safety:** khác TASK (dùng raw SQL vì cột 0478 chưa typed), `chatRoomMembers`/`chatRooms` **đã** là bảng Drizzle typed đầy đủ (`db/schema/communication.ts`) — reader import THẲNG 2 table object đó (KHÔNG phải `ChatModule`, chỉ là schema const, không đụng DI/NestJS module boundary) và dùng query builder, không cần raw SQL.

### 1.2 Hợp đồng payload BE-2 phải đáp ứng — 🔶 GIẢ ĐỊNH, xác nhận lại khi BE-2 land

BE-2 (trong CÙNG transaction insert `chat_messages`), tuỳ nội dung + loại phòng, **enqueue 0, 1, hoặc nhiều** outbox event — KHÔNG enqueue-rồi-để-bridge-tự-bỏ-qua (tránh audit noise: mỗi lần `intake()` trả 0 recipient vẫn ghi 1 dòng `audit_logs` `notification_skipped`, và chat sinh sự kiện nhiều gấp hàng chục lần module khác — SPEC-15 §17 dòng mở đầu):

| Điều kiện | eventType enqueue | eventCode đích |
| --- | --- | --- |
| `roomType === 'direct'` AND `messageType !== 'system'` | `chat.message.direct_sent` | `CHAT_DIRECT_MESSAGE` |
| `roomType !== 'direct'` AND có `mentionedUserIds` (sau khi lọc active member — CHAT-ERR-010) AND `messageType !== 'system'` | `chat.message.mentioned` | `CHAT_MENTIONED` |
| Còn lại (group/department/project không mention) | — KHÔNG enqueue gì | — |

Payload tối thiểu (camelCase = trường nội bộ cho `resolveRecipients`/`dedupeKeyOf`/`sourceEntityIdOf`; snake_case = trường ĐÃ RENDER SẴN, khớp CHÍNH XÁC `variables_schema` của template — vì `payloadOf` là hàm ĐỒNG BỘ, bridge KHÔNG query DB để tự dịch `userId → tên hiển thị` được, mirror `task-comments.service.ts:360-388`):

```text
chat.message.mentioned:
  roomId, messageId, actorUserId, mentionedUserIds: string[], createdAt (ISO)
  actor_name (string, đã resolve users.fullName, KHÔNG null),
  room_name  (string, chatRooms.name)

chat.message.direct_sent:
  roomId, messageId, actorUserId, recipientUserId, createdAt (ISO)
  actor_name   (string, đã resolve, KHÔNG null)
  unread_count (number — unreadOf(newLastMessageSeq, recipient.lastReadSeq), tái dùng
                 apps/api/src/chat/chat-room-rules.ts `unreadOf()` — hàm THUẦN, không DB)
```

`messageId` → `sourceEntityIdOf`, `sourceEntityType = 'chat_message'` (`notifications.source_entity_type` là `varchar(100)` tự do, KHÔNG có CHECK — `0479:225`, không cần khớp union `audit_logs.object_type`).

### 1.3 `dedupeKeyOf` — bucket tính từ `payload.createdAt`, KHÔNG phải `Date.now()` lúc consume

`EventContext` không có `occurredAt` (§0). Nếu tính bucket bằng `Date.now()` tại thời điểm `OutboxWorker` xử lý, một lần retry (reaper timeout, dead-letter re-claim) xử lý CHẬM hơn 15 phút so với lần đầu sẽ cho **bucket khác** ⇒ mất tính "ổn định qua retry" mà mọi mapping khác đang dựa vào (memory `idempotency-key-must-be-content-derived`). Bucket PHẢI suy từ `payload.createdAt` (thời điểm BE-2 tạo tin, cố định, không đổi qua retry):

```ts
const DM_BUCKET_MS = 15 * 60 * 1000;
function bucket15m(createdAtIso: string): number {
  return Math.floor(Date.parse(createdAtIso) / DM_BUCKET_MS);
}
// dedupeKeyOf CHAT_DIRECT_MESSAGE:
`chat:${roomId}:${recipientUserId}:${bucket15m(createdAt)}`
```

Thiếu `roomId`/`recipientUserId`/`createdAt` trong payload ⇒ `dedupeKeyOf` trả `undefined` ⇒ `computeKey` trả `null` ⇒ **không dedupe** (tạo mọi lần, KHÔNG throw) — fail-soft đọc, mirror `LeaveNotiBridgeRegistrar` ("payload hỏng ⇒ recipient rỗng, KHÔNG throw"). Chấp nhận được: thà thừa 1 notification hơn mất notification.

`CHAT_MENTIONED` **không cần** `dedupeKeyOf` — catalog `dedupe_strategy='None'` (mig `0538:711`, "gửi ngay, không gộp"), đúng ý muốn. **KHÔNG thêm entry nào** vào `notification-dedupe.const.ts` cho 2 mã CHAT: catalog đã set tường minh cho cả hai, `resolveStrategy` ưu tiên catalog TRƯỚC `DEFAULT_DEDUPE` (`notification-dedupe.service.ts:52-54`) — `DEFAULT_DEDUPE` chỉ có tác dụng khi catalog để `'None'` VÀ ta MUỐN override sang chế độ khác, mà `CHAT_MENTIONED='None'` chính là hành vi mong muốn.

### 1.4 `ChatAudienceReader` — 2 hàm, dùng chung 1 điều kiện "còn nhận được thông báo"

```ts
// apps/api/src/notifications/chat-audience.reader.ts — import THẲNG bảng Drizzle, KHÔNG import ChatModule.
class ChatAudienceReader {
  /** CHAT_MENTIONED: subset của candidateUserIds còn active + không mute, CHỈ khi roomType != 'direct'
   *  (defense-in-depth — phòng BE-2 gửi sai eventType). */
  async resolveMentionRecipients(
    tx: TenantTx, companyId: string, roomId: string, candidateUserIds: string[],
  ): Promise<string[]>

  /** CHAT_DIRECT_MESSAGE: [recipientUserId] nếu còn active + không mute + roomType === 'direct', else []. */
  async resolveDirectRecipient(
    tx: TenantTx, companyId: string, roomId: string, recipientUserId: string,
  ): Promise<string[]>
}
```

Điều kiện "còn nhận được" (dùng chung, viết 1 chỗ trong reader — KHÔNG lặp 2 nơi):
`chat_room_members.left_at IS NULL AND (muted_until IS NULL OR muted_until <= now()) AND company_id khớp`,
JOIN `chat_rooms` lấy `room_type` để so `= 'direct'` (hàm 2) hoặc `!= 'direct'` (hàm 1).

`resolveRecipients` của mapping **tự mở** `db.withTenant(ctx.companyId, tx => reader.resolveXxx(tx, …))` — tx đọc RIÊNG, KHÔNG chung tx với `engine.intake()` (engine tự mở tx ghi của nó) — mirror `LeaveNotiBridgeRegistrar.managerOf` (`leave-noti-bridge.registrar.ts:64-71`).

`NotificationRecipientResolverService` (đã có, chạy sau) tự lọc lại active/locked/deleted + actor-exclusion (§0) — reader **không cần** lặp việc đó, chỉ lo phần riêng CHAT (membership + mute).

### 1.5 `payloadOf` — WHITELIST bắt buộc, KHÔNG cho pass-through mặc định

Đây là điểm rủi ro bảo mật lớn nhất WO — lý do backlog ép thêm `security-reviewer` vào LIGHT gate. `mapping.payloadOf?.(ctx) ?? payload` mặc định forward **TOÀN BỘ** `ctx.payload` (§0), và `assertPayloadSafe` không chặn khoá `body`/`content`/`preview` (§0) — nếu BE-2 (hoặc một sửa đổi sau này) lỡ nhét thêm field xem-trước nội dung tin vào payload outbox (vì lý do khác, ví dụ tái dùng object cho WS emit ở RT-1), NOTI sẽ vô tình lưu nó vào `notifications.payload` — đúng thứ SPEC-15 §17 dòng 527 và mig `0538:725-727` (BẤT BIẾN #3) cấm ("notification có nhiều người đọc hơn phòng chat").

`payloadOf` PHẢI dựng **object mới**, chỉ copy đúng field cho phép — không có field lạ nào lọt qua được kể cả khi payload nguồn phình to:

```ts
payloadOf: (ctx) => ({           // CHAT_MENTIONED
  actor_name: ctx.payload.actor_name,
  room_name:  ctx.payload.room_name,
  room_id:    ctx.payload.roomId,   // rename camelCase nội bộ → snake_case khớp template (0538:740)
}),
payloadOf: (ctx) => ({           // CHAT_DIRECT_MESSAGE
  actor_name:    ctx.payload.actor_name,
  unread_count:  ctx.payload.unread_count,
  room_id:       ctx.payload.roomId,
}),
```

Ca test 8 (§4) dựng payload BE-2 giả lập CÓ field `body`/`preview` (mô phỏng lỗi tương lai) để chứng minh field đó KHÔNG xuất hiện trong `notifications.payload` sau `intake()`.

### 1.6 `muted_until` — CHỈ ĐỌC, không xây API set trong WO này

`paths` không có `packages/contracts/**` (§0) ⇒ không được thêm DTO/API công khai. SPEC-15 gán việc "tuỳ chọn tắt thông báo" cho luồng "ME | tuỳ chọn cá nhân" (SPEC-15:209), một mặt hàng khác. Test set `muted_until` **trực tiếp qua SQL fixture**, không qua HTTP.

### 1.7 "Recipient không đang mở phòng" (SPEC-15 §17) — ✅ OWNER ĐÃ CHỐT 02/08/2026: **CHAT-DEC-013**

> **Cập nhật 02/08 tối — mục này KHÔNG còn là giả định.** Owner đã phán quyết đúng phương án dưới đây và nó đã được ghi vào `docs/SPEC/SPEC-15 CHAT.md` §17 + §22 dưới mã **CHAT-DEC-013**: gửi mọi DM, **trừ khi `muted_until` còn hiệu lực**; bỏ điều kiện presence ở v1. Phần văn bản còn lại của mục này giữ nguyên vì lập luận vẫn đúng — chỉ đọc "GIẢ ĐỊNH" thành "quyết định đã chốt", và **bỏ** yêu cầu "owner phải xác nhận trước khi code" ở §5.
>
> ⚠️ Kèm theo phán quyết là một lỗ hổng chưa ai nhận: `muted_until` giờ là **lớp chống-spam duy nhất do người dùng điều khiển**, mà cột đó **không có đường ghi** (0 endpoint, 0 DTO). Không thuộc phạm vi WO này, nhưng phải có WO cấp đường ghi trước khi CHAT lên PROD — đã ghi cảnh báo ở SPEC-15 §22.

SPEC nói `CHAT_DIRECT_MESSAGE` chỉ gửi khi "người nhận **không đang mở phòng đó**". Xác định "đang mở phòng" cần tín hiệu presence (WS join theo phòng) — đó là `S7-CHAT-RT-1`, và **BE-6 không phụ thuộc RT-1** (`depends_on` chỉ có `BE-2`,`DB-1` — `backlog.mjs:9710`; sơ đồ WAVE §5 cũng đặt BE-6 song song RT-1, không sau nó). Không có hạ tầng để biết "đang mở phòng" tại thời điểm WO này thi công.

**Quyết định v1:** gửi `CHAT_DIRECT_MESSAGE` cho **mọi** tin nhắn direct mà recipient còn active + không mute (bỏ qua điều kiện "đang mở phòng"). Gộp lô 15 phút (§1.3) + `muted_until` là hai lớp chống-spam thực tế thay thế cho presence-check. Đây là **sai khác có chủ ý** với câu chữ SPEC-15 §17 dòng 520, không phải bug — **owner/plan-reviewer phải chốt** đây là hành vi v1 chấp nhận được hay phải chặn WO tới khi RT-1 có presence (ghi ở §5 nợ).

---

## 2. Thi công

| File | Việc |
| --- | --- |
| `apps/api/src/notifications/chat-audience.reader.ts` (mới) | 2 hàm §1.4, Drizzle query builder trên `chatRoomMembers`/`chatRooms` (import từ `db/schema/communication`, KHÔNG import `ChatModule`) |
| `apps/api/src/notifications/chat-noti-bridge.registrar.ts` (mới) | `OnModuleInit`, đăng ký 2 mapping §1.2/§1.3/§1.5, mirror cấu trúc `leave-noti-bridge.registrar.ts` (helper `strField`/`strArrayField` cục bộ, KHÔNG import từ file registrar khác) |
| `apps/api/src/notifications/notifications.module.ts` | Thêm `ChatAudienceReader`, `ChatNotiBridgeRegistrar` vào `providers` — **additive**, theo đúng khuôn khối comment 5 WO trước (mỗi khối 2-3 dòng comment nêu rõ nguồn WO + lý do KHÔNG import module nguồn) |
| `apps/api/test/integration/chat-noti-e2e.int-spec.ts` (mới) | 12 ca §4, mirror cấu trúc `leave-noti-e2e.int-spec.ts` (boot-guard 2 ca ở top-level, còn lại trong `describe.skipIf(!hasLaneDb)`) |
| `apps/api/src/notifications/notification-dedupe.const.ts` | **KHÔNG sửa** (§1.3 giải thích lý do) |
| `apps/api/src/chat/**` | **KHÔNG sửa** (§1.1) dù nằm trong `paths` cho phép — quyết định là KHÔNG cần |

`sourceModule = 'CHAT'`, `sourceEntityType = 'chat_message'` cho cả 2 mapping.

---

## 3. KHÔNG làm trong WO này

- ❌ Xây `S7-CHAT-BE-2` (gửi tin nhắn thật, cột `mentions`, transaction insert) — chỉ khai hợp đồng §1.2, đánh dấu 🔶 GIẢ ĐỊNH.
- ❌ Sửa `apps/api/src/chat/**` — quyết định §1.1, dù `paths` cho phép.
- ❌ Migration mới — catalog/CHECK/template CHAT đã đủ từ `0538` (§0); `paths` cũng không có `apps/api/migrations/**`.
- ❌ API/DTO set `muted_until` — `paths` không có `packages/contracts/**` (§1.6).
- ❌ Presence "đang mở phòng" (RT-1) — §1.7, GIẢ ĐỊNH v1 thay thế.
- ❌ Sửa `packages/contracts/src/chat.ts` — không cần cho WO này.
- ❌ Audit CHAT-specific mới — audit đã có sẵn ở tầng generic `NotificationEngineService.persistRecipient`/`recordSkip` (`objectType:'notification'`), không cần code CHAT nào thêm.
- ❌ Badge chưa đọc — tự động qua `last_message_seq`/`last_read_seq` (BE-1/BE-2), không cần code trong WO này ("badge vẫn tăng" là hệ quả có sẵn, không phải việc phải làm).

---

## 4. Test RED-trước

⚠️ Vì BE-2 chưa tồn tại, mọi ca "gửi tin nhắn" dùng **fixture mô phỏng** (mở `withTenant`, insert 1 hàng `chat_messages` hợp lệ + gọi `outboxService.enqueue(tx, {...})` đúng hợp đồng §1.2, commit) — KHÔNG gọi qua HTTP. Khi BE-2 land, thêm 1 ca e2e thật qua controller (ghi nợ §5); 12 ca dưới đây vẫn phải xanh nguyên trạng vì chúng test đúng lớp BE-6 (registrar + reader + payload), không phải lớp BE-2.

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 1 | Boot: `registerSource()` 2 eventCode CHAT (`is_enabled=true`) | KHÔNG throw |
| 2 | Boot: wire 1 eventType CHAT giả sang eventCode NGOÀI catalog (vd `CHAT_TYPING`) | throw TẠI BOOT, message nêu đúng eventCode |
| 3 | Mention trong phòng `group`: 2 người được mention, 1 người đã `left_at` | Chỉ người active nhận — đúng 1 `notifications`, payload = **đúng 3 khoá** `{actor_name, room_name, room_id}` |
| 4 | Người được mention đang bị mute (`muted_until` tương lai) | KHÔNG notification cho người đó |
| 5 | DM: tin nhắn phòng `direct` | Recipient nhận `CHAT_DIRECT_MESSAGE`, payload = **đúng 3 khoá** `{actor_name, unread_count, room_id}` |
| 6 | DM: 3 tin cùng phòng, cùng recipient, trong 15 phút (`createdAt` cùng bucket) | Chỉ **1** `notifications` được tạo; `dedupe_key = 'CHAT_DIRECT_MESSAGE:chat:{roomId}:{recipientUserId}:{bucket}'` |
| 7 | DM: 2 tin cách nhau > 15 phút (`createdAt` khác bucket) | **2** `notifications` riêng biệt |
| 8 | Adversarial: payload fixture CÓ thêm khoá `body`/`preview` (mô phỏng BE-2 lỗi tương lai) | `notifications.payload` **KHÔNG** chứa `body`/`preview` — chỉ đúng field whitelist |
| 9 | Rollback: mở tx, insert `chat_messages` + `outbox.enqueue`, **ROLLBACK** (throw trong tx) | `outbox_events` 0 hàng mới; chạy `OutboxWorker.processBatch()` sau đó → `notifications` 0 hàng mới |
| 10 | Defense-in-depth: enqueue `chat.message.direct_sent` cho phòng `roomType != 'direct'` (mô phỏng bug BE-2) | 0 notification (reader chặn qua điều kiện `room_type` — không dựa may rủi vào BE-2 luôn đúng) |
| 11 | Cross-tenant: `mentionedUserIds` chứa 1 `userId` thuộc company khác | 0 notification cho company đó (RLS + resolver company-bind, mirror ca 8 của `leave-noti-e2e`) |
| 12 | Phòng `group` gửi tin **không** mention | 0 outbox event được enqueue (fixture tự kiểm tra, xác nhận hợp đồng §1.2 "còn lại không enqueue gì") |

Chủ thể dựng trong test là nhân viên thường (KHÔNG phải Super Admin — SA có `*:*`, dù không liên quan permission gate ở WO này nhưng giữ thói quen chung của wave).

Chạy: `bash scripts/lane-db-setup.sh chatbe6` → `export LANE_DB=mediaos_chatbe6` → `bash harness/check.sh --lane-db`.
Nạp env trước khi gọi vitest tay (memory `lane-db-run-needs-explicit-urls`):

```bash
set -a && . ./.env && set +a
unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL PGBOUNCER_URL
export LANE_DB=mediaos_chatbe6
```

Drop lane DB sau khi xong (`pgdata-bloat-lane-dbs-and-job-log`).

---

## 5. Definition of Done / Nợ & rủi ro

- [ ] `ChatAudienceReader` + `ChatNotiBridgeRegistrar` mới, `notifications.module.ts` cập nhật additive
- [ ] `apps/api/src/chat/**` KHÔNG bị đụng (xác nhận bằng `git diff --stat`)
- [ ] 2 mapping đăng ký đúng eventCode/eventType §1.2, `payloadOf` WHITELIST cả hai (không pass-through)
- [ ] `dedupeKeyOf` CHAT_DIRECT_MESSAGE tính từ `payload.createdAt`, KHÔNG `Date.now()`
- [ ] 12 ca §4 xanh trên `LANE_DB`, có ca RED-trước (bỏ `payloadOf`/whitelist để chứng minh ca 8 thật sự bắt được rò payload trước khi vá)
- [ ] `notification-dedupe.const.ts` KHÔNG bị sửa
- [ ] `packages/contracts/**`, `apps/api/migrations/**` KHÔNG bị đụng
- [ ] LIGHT gate (`typescript-reviewer` + `quality-gate`) + **`security-reviewer`** (bắt buộc theo `done_when` gốc — đường rò nội dung) PASS
- [ ] lane DB `mediaos_chatbe6` drop sau khi xong

**Rủi ro cao nhất cho reviewer (§1.1):** quyết định KHÔNG import `ChatModule` đi NGƯỢC comment mời gọi tường minh trong `chat.module.ts:22-24` do chính `S7-CHAT-BE-1` (cùng wave, mới 1 ngày tuổi) để lại. Nếu plan-reviewer/owner cho rằng nên tái dùng `ChatRoomsRepository` thay vì viết reader song song, cần lật quyết định này TRƯỚC khi code — đổi sau khi code sẽ phải viết lại cả reader lẫn 5 ca test liên quan.

**Rủi ro thứ hai (§1.7):** hành vi "gửi mọi DM trừ khi mute" thay vì đúng "chỉ gửi khi recipient không đang mở phòng" là suy diễn của người viết plan do thiếu hạ tầng presence, KHÔNG phải quyết định của owner trong 12 mục `S7-CHAT-WAVE.md` §2. Cần owner xác nhận trước khi code, không phải sau.

**Nợ chuyển tiếp:**
1. Khi `S7-CHAT-BE-2` land — verify lại TOÀN BỘ hợp đồng payload §1.2 khớp thực tế implementation (tên field, thời điểm resolve `actor_name`/`unread_count`, điều kiện khi nào enqueue), và thêm ít nhất 1 ca e2e xuyên suốt HTTP → outbox → NOTI thật (mirror `leave-noti-e2e.int-spec.ts`), thay vì chỉ fixture mô phỏng.
2. Khi `S7-CHAT-RT-1` land — xét lại §1.7: có presence rồi thì bổ sung điều kiện "không đang mở phòng" thật, hoặc owner xác nhận giữ nguyên hành vi v1.
3. `S7-CHAT-BE-5` (phòng dẫn xuất department/project) phải đảm bảo `chatRooms.name` KHÔNG NULL — nếu không, `room_name` trong payload `CHAT_MENTIONED` sẽ rỗng cho phòng dẫn xuất (hiện tại chỉ `group` tồn tại thật nên rủi ro chưa phát tác).
4. `muted_until` chưa có API set (§1.6) — theo dõi ở WO "ME/tuỳ chọn cá nhân" hoặc `S7-CHAT-QA-1`.
