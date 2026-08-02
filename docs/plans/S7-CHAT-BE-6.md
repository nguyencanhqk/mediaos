# Micro-plan — `S7-CHAT-BE-6` (🟡 yellow · LIGHT gate + `security-reviewer` bắt buộc + `database-reviewer`/`silent-failure-hunter` bổ sung cho diff `chat/**`) — rev 2 (02/08/2026)

> **WO:** Thông báo CHAT qua `OutboxNotificationBridge` — `CHAT_MENTIONED` (gửi ngay) + `CHAT_DIRECT_MESSAGE`
> (gộp lô 15 phút), tôn trọng `muted_until`, payload KHÔNG chứa nội dung tin nhắn.
> **Nguồn sự thật:** [SPEC-15 §17](<../SPEC/SPEC-15 CHAT.md>) · mig `0538` (khối G/H) · memory
> `noti-outbox-bridge-generic` · `idempotency-key-must-be-content-derived` · `noti-catalog-check-lives-on-two-tables`.
> **Nhánh:** commit lên `wave/s7-chat` (❗KHÔNG `master` — WAVE §4).
> **Commit-sha đã đo lúc viết rev 2 (02/08/2026):** `HEAD = 54b4d8cd` — `feat(chat): S7-CHAT-BE-2 — tin nhắn
> (CHAT-API-009..014, 016)`, đứng trên `c77f48e0` — `feat(chat): S7-CHAT-BE-1 — ChatAccessService + phòng/
> thành viên (CHAT-API-001..008)`, đứng trên `4c5c2da6` (mig `0539`). `git status --short` tại thời điểm đo:
> chỉ 3 file KHÔNG liên quan WO này đang sửa dở (`docs/SPEC/SPEC-15 CHAT.md`, `docs/plans/S7-CHAT-WAVE.md`,
> `harness/backlog.mjs` — cập nhật DEC-013 + vài WO khác cùng tối). `apps/api/src/chat/**` và
> `apps/api/src/notifications/**` SẠCH (đã commit trong `54b4d8cd`).

---

## Vì sao có rev 2

`plan-reviewer` chấm rev 1 **BLOCK**. Lỗ nghiêm trọng nhất: rev 1 chốt "`apps/api/src/chat/**` — KHÔNG sửa"
và coi việc `outbox.enqueue()` là trách nhiệm của BE-2, nhưng `docs/plans/S7-CHAT-BE-2.md:125` ghi "Ngoài
phạm vi: … NOTI (BE-6)" — **không ai nhận việc enqueue**. `S7-CHAT-BE-2` đã commit thật (`54b4d8cd`) và grep
`enqueue|Outbox|EventBus` trong `apps/api/src/chat/**` = **0 hit** (xác nhận lại ngay dưới) — ship xong PROD
CHAT sẽ **0 notification** dù 12 ca test cũ của rev 1 đều xanh, vì chúng test lớp consumer bằng fixture tự
enqueue chứ không test lớp producer thật. Owner đã chốt 02/08: **BE-6 nhận producer.**

Rev 2 viết lại toàn bộ §1–§5 cho khớp với BE-2 **CODE THẬT** (không còn 🔶 GIẢ ĐỊNH nào — mọi hợp đồng payload
ở rev 1 §1.2 nay là phần WO này TỰ THI CÔNG, không phải chờ WO khác implement đúng).

---

## 0. Đo thật trước khi thiết kế (rev 2 — trên code THẬT của BE-2)

| Thứ | Đo được 02/08/2026 | Nguồn |
| --- | --- | --- |
| `apps/api/src/chat/` có 16 file (BE-1: 11, BE-2 thêm 5: `chat-messages.controller.ts`, `chat-messages.service.ts`, `chat-messages.repository.ts`, `chat-message-moderation.service.ts`, `chat-message-rules.ts`) | `ls apps/api/src/chat/` | Bash |
| `enqueue\|Outbox\|EventBus` trong `apps/api/src/chat/**` = **0 hit** — xác nhận lại lỗ mà rev 1 bỏ sót | Grep | Grep |
| `ChatMessagesService.sendMessage` — thứ tự tx THẬT: `assertMember` → chặn phòng lưu trữ → tra `clientMessageId` (idempotent replay) → validate `replyToMessageId` → `filterMentionsToMembers` → `allocateRoomSeq` → `insertMessage` → `setLastReadSeq` (BƯỚC CUỐI của tx) → (ngoài tx) `.catch` bắt `23505` retry tx MỚI | `chat-messages.service.ts:86-167` | đọc code |
| `ChatActor` chỉ có `{id, companyId}` — **KHÔNG có tên hiển thị** | `chat-rooms.service.ts:26-29`; `AuthenticatedRequest.user: {id, companyId}` — `chat-messages.controller.ts:23` | đọc code |
| `ChatRoomAccess.room`/`.membership` (trả về từ `assertMember`) **không có** `directKey` lẫn tên hiển thị của actor — chỉ đủ cho payload `room_name` (`acc.room.name`/`acc.room.roomCode`), KHÔNG đủ cho `actor_name` lẫn `recipientUserId` của phòng `direct` | `chat-access.service.ts:9-32` | đọc code |
| `ChatMessagesRepository` đã có tiền lệ đọc `chat_room_members` cho mục đích AUDIENCE (không phải bảo mật, không 404) — `filterMentionsToMembers` | `chat-messages.repository.ts:381-401` | đọc code |
| `users.email` là `NOT NULL` — fallback an toàn khi `fullName` NULL, đúng tiền lệ `task-comments.service.ts:104-112` ("đọc lại row NGAY sau insert để lấy `userName`, coalesce `email`") | `users.ts:20`; `task-comments.service.ts:104-112` | đọc code |
| `chat-access.service.ts` là file **3 BẤT BIẾN** (điểm khẳng định membership DUY NHẤT, vừa qua FULL gate) — KHÔNG được sửa trong WO này | `chat-access.service.ts:60-77` (comment 3 bất biến) | đọc code |
| `OutboxService.enqueue(tx, {eventType, payload})` — `companyId` lấy từ ngữ cảnh `tx` (RLS GUC), không phải tham số | `outbox.service.ts:16-23` | đọc code |
| `OutboxService` là `@Global()` — inject thẳng vào `ChatMessagesService`, không cần import `EventsModule` | `events.module.ts:14` | đọc code |
| `EventBus.consumersFor(eventType)` **đã tồn tại** — dùng được cho ca boot-guard "đúng 1 consumer" | `event-bus.ts:44-46` | đọc code |
| Outbox transactional đã CHỨNG MINH ở tầng generic (`OutboxService`) — test CHAT không cần chứng minh lại cơ chế đó, chỉ cần chứng minh **WIRING trong `sendMessage` đặt enqueue đúng chỗ** | `outbox.int-spec.ts:29-38` (`rollback nghiệp vụ ⇒ outbox KHÔNG có event`) | đọc code |
| `NotificationEngineService.intake()` — khi trùng `dedupeKey` (tầng app HOẶC tầng DB) thì **SKIP hoàn toàn**, KHÔNG có nhánh UPDATE notification đã tồn tại | `notification-engine.service.ts:114-125` (`dedupedCount++; continue`) — xác nhận cơ chế **KHÔNG BAO GIỜ** cập nhật lại `unread_count` của notification đã tạo, bất kể tính ở đâu | đọc code |
| `NotiEventMapping.resolveRecipients` (async) chạy **TRƯỚC**, `payloadOf` (sync) chạy SAU, cả hai đọc CHUNG `ctx` bất biến — không có kênh phụ hợp lệ để `resolveRecipients` "báo" số liệu sang `payloadOf` | `outbox-notification-bridge.service.ts:82-97` | đọc code |
| Bridge đọc `actorUserId` cho actor-exclusion từ `ctx.payload` THÔ, **không** từ `outPayload` đã whitelist — whitelist không phá actor-exclusion | `outbox-notification-bridge.service.ts:80,87` | đọc code |
| `assertInternalTargetUrl` dùng `INTERNAL_TARGET_URL_RE` — char-class **không chứa `{`/`}`** ⇒ `target_url` còn sót `{room_id}` chưa thay (payload thiếu `roomId`) tự động ném `TargetUnavailableError` (422) LOUD, bridge re-throw, KHÔNG nuốt | `notification-engine.errors.ts:161-167`; `outbox-notification-bridge.service.ts:101-108` | đọc code |
| `resolveStrategy`: catalog THẮNG, `DEFAULT_DEDUPE` chỉ áp khi `catalog='None'` — `CHAT_MENTIONED` seed `dedupe_strategy='None'` (`0538:711-720`) ⇒ đúng điều kiện áp `DEFAULT_DEDUPE` | `notification-dedupe.service.ts:44-56` · `0538:711-720` | đọc code + migration |
| Template CHAT `variables_schema` — `CHAT_MENTIONED={actor_name,room_name,room_id}`, `CHAT_DIRECT_MESSAGE={actor_name,unread_count,room_id}`; `body_template` DM = `"Bạn có {unread_count} tin nhắn chưa đọc từ {actor_name}."` | `0538:736-747` | migration |
| `notification-renderer.service.ts.interpolate`: thiếu key ⇒ giữ nguyên `{key}` (non-fatal, không nuốt) | `notification-renderer.service.ts:64-70` | đọc code |
| Census ca 14 (`assertMember` là đường DUY NHẤT) hiện CHỈ quét `apps/api/src/chat/` — reader ở `notifications/**` dựng lại đúng vế predicate mà không bị bắt | `chat-be1-access.int-spec.ts:451` (`chatDir = join(__dirname, "..", "..", "src", "chat")`), quét toàn bộ describe ca 14 dòng 448-554 | đọc code |
| `CHAT-DEC-013` **đã chốt và đã ghi vào SPEC** — "gửi mọi DM trừ khi `muted_until` còn hiệu lực, bỏ điều kiện presence ở v1" | `docs/SPEC/SPEC-15 CHAT.md:627` (bảng quyết định) + `:631` (ghi chú thời điểm chốt) | SPEC |
| `chat_room_members.mutedUntil` **vẫn 0 đường ghi HTTP** — grep `mutedUntil` trong `chat.dto.ts`/`chat-rooms.controller.ts`/`chat-messages.controller.ts`/`packages/contracts/src/chat.ts` = 0 hit | grep | grep |
| Không WO nào trong `harness/backlog.mjs` (id `S7-CHAT-*`) nhận việc cấp API set `muted_until` — 19 id hiện có (`DOC-1/2, DB-1/2, BE-1..7, RT-0/1, FE-1..5, QA-1, CLEAN-1`), không id nào rảnh cho việc này | `grep 'id: "S7-CHAT' harness/backlog.mjs'` | backlog |

---

## 1. Lựa chọn thiết kế — chốt ở đây, không để người thi công tự quyết

### 1.1 (C1) BE-6 SỞ HỮU PRODUCER — enqueue nằm TRONG `ChatMessagesService.sendMessage`

**Đảo ngược quyết định của rev 1.** Lý do: `paths` của WO này (`harness/backlog.mjs:9714-9719`) đã có sẵn
`apps/api/src/chat/**`, `done_when` ghi rõ "Enqueue trong CÙNG transaction với INSERT tin nhắn" — hạ tầng
cho phép, chỉ chưa ai code. `S7-CHAT-BE-2.md:125` tự loại NOTI khỏi phạm vi của nó. Owner chốt 02/08: **BE-6
là chủ của việc enqueue.**

**Vị trí chính xác** — sửa `apps/api/src/chat/chat-messages.service.ts` (KHÔNG file mới), chèn MỘT lời gọi
`await this.enqueueNotifications(tx, actor, acc, {...})` **giữa** `insertMessage` và `setLastReadSeq`
(dòng 127-144 hiện tại):

```ts
const inserted = await this.repo.insertMessage(tx, { …, roomSeq, attachmentCount: 0 });

// S7-CHAT-BE-6 — enqueue TRONG CÙNG tx, SAU insert (có messageId/roomSeq), TRƯỚC setLastReadSeq.
await this.enqueueNotifications(tx, actor, acc, {
  messageId: inserted.id,
  roomSeq,
  mentions,           // biến CỤC BỘ đã lọc bởi filterMentionsToMembers — KHÔNG query lại
  createdAt: now,      // biến CỤC BỘ đã có — KHÔNG Date.now() lần hai
});

// Tin của chính mình luôn tự nâng con trỏ đọc, TRONG CÙNG tx — GIỮ NGUYÊN vị trí CUỐI CÙNG của tx (lý do:
// test rollback §4 ca 11 spy đúng lời gọi NÀY để buộc throw SAU enqueue).
await this.repo.setLastReadSeq(tx, actor.companyId, acc.membership.id, roomSeq);
return inserted.id;
```

**Ba ràng buộc vị trí bắt buộc** (theo yêu cầu C1):

- **(a) KHÔNG enqueue ở nhánh idempotent-replay.** Nhánh `if (existing) return existing.id;` (dòng 106,
  TRƯỚC `allocateRoomSeq`) **return SỚM**, không bao giờ chạm `enqueueNotifications` — đúng bằng CẤU TRÚC
  code (return nằm trước lời gọi), không cần cờ canh riêng. Ca test 9 (§4) chứng minh bằng HTTP thật.
- **(b) KHÔNG enqueue trong nhánh `.catch` đua 23505.** Nhánh `.catch(async (err) => {...})` (dòng 147-164)
  chỉ gọi lại `findByClientMessageId` trong tx MỚI rồi `return raced.id` — KHÔNG gọi lại `enqueueNotifications`
  (đúng bằng cấu trúc: `enqueueNotifications` chỉ tồn tại trong closure của tx ĐẦU, không phải trong `.catch`).
  Ca test 10 (§4) ép race thật bằng `Promise.all` chứng minh.
- **(c) Dữ liệu payload lấy từ `acc` — KHÔNG dựng điểm khẳng định membership thứ hai.** `enqueueNotifications`
  KHÔNG được gọi `assertMember`/`assertMessageAccess` lần nữa, KHÔNG viết lại predicate
  `isNull(chatRooms.deletedAt) + isNull(chatRoomMembers.leftAt) + eq(...userId, actorUserId)` (đó là bản sao
  luật quyền — census ca 14 §0 cấm). Hai việc còn cần TRA DB (tên hiển thị người gửi, người-kia của phòng
  `direct`) **không phải** truy vấn bảo mật — mirror tiền lệ `filterMentionsToMembers` đã có sẵn trong CHÍNH
  file `chat-messages.repository.ts` (đọc `chat_room_members` cho mục đích audience, không phải cổng 404):

  ```ts
  // chat-messages.repository.ts — 2 hàm THÊM, KHÔNG chạm chat-access.service.ts.

  /** Tên hiển thị người gửi cho payload outbox NOTI — KHÔNG BAO GIỜ null (coalesce email NOT NULL —
   *  users.ts:20). KHÔNG phải điểm khẳng định membership, chỉ tra tên — mirror
   *  task-comments.service.ts:104-112. */
  async findSenderDisplayName(tx: TenantTx, companyId: string, userId: string): Promise<string | null> {
    const rows = await tx.select({ fullName: users.fullName, email: users.email })
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.id, userId)))
      .limit(1);
    return rows[0] ? (rows[0].fullName ?? rows[0].email) : null;
  }

  /** Người CÒN ACTIVE duy nhất khác `excludeUserId` trong phòng — dùng cho `direct` (luôn đúng 2 thành
   *  viên). Mirror `filterMentionsToMembers` (đọc chat_room_members cho AUDIENCE, không phải bảo mật —
   *  không 404, không phải bản sao của assertMember). NULL khi peer đã left_at (race hiếm). */
  async findDirectPeer(
    tx: TenantTx, companyId: string, roomId: string, excludeUserId: string,
  ): Promise<{ userId: string; lastReadSeq: number } | null> {
    const rows = await tx.select({ userId: chatRoomMembers.userId, lastReadSeq: chatRoomMembers.lastReadSeq })
      .from(chatRoomMembers)
      .where(and(
        eq(chatRoomMembers.companyId, companyId),
        eq(chatRoomMembers.roomId, roomId),
        isNull(chatRoomMembers.leftAt),
        ne(chatRoomMembers.userId, excludeUserId),
      ))
      .limit(1);
    return rows[0] ?? null;
  }
  ```

  (`ne` thêm vào import `drizzle-orm` của file này — hiện chưa import.)

**KHÔNG sửa `chat-access.service.ts`.** File 3-bất-biến vừa qua FULL gate — mọi dữ liệu cần cho payload lấy
từ `acc` (đã có sẵn `room.id`, `room.name`, `room.roomCode`, `room.roomType`) hoặc 2 hàm mới ở trên. Đây là
lý do rev 2 đề nghị thêm `database-reviewer` + `silent-failure-hunter` cho riêng diff `chat/**` (xem "Cũng
nên vá").

### 1.2 Hợp đồng payload — KHÔNG còn 🔶 GIẢ ĐỊNH, đây là phần WO này TỰ THI CÔNG

| Điều kiện | eventType enqueue | eventCode đích |
| --- | --- | --- |
| `acc.room.roomType === 'direct'` AND `messageType !== 'system'` | `chat.message.direct_sent` | `CHAT_DIRECT_MESSAGE` |
| `acc.room.roomType !== 'direct'` AND `mentions.length > 0` (đã lọc active member) AND `messageType !== 'system'` | `chat.message.mentioned` | `CHAT_MENTIONED` |
| Còn lại (group/department/project không mention) | — KHÔNG enqueue gì | — |

`messageType` hiện `insertMessage` CỐ ĐỊNH `"text"` (`chat-messages.service.ts:132`) — chưa WO nào sinh tin
`system` (đó là nợ của `S7-CHAT-BE-5`, ghi ở backlog). `enqueueNotifications` vẫn viết guard
`if (messageType === "system") return;` để BE-5 không phải nhớ quay lại đây khi nó bắt đầu sinh tin hệ thống.

Payload (camelCase = trường nội bộ; snake_case = trường ĐÃ RENDER SẴN, khớp CHÍNH XÁC `variables_schema`,
vì `payloadOf` ĐỒNG BỘ, không query DB được):

```text
chat.message.mentioned:
  roomId, messageId, actorUserId, mentionedUserIds, createdAt (ISO)
  actor_name (string, resolve users.fullName ?? email, KHÔNG null)
  room_name  (string, acc.room.name ?? acc.room.roomCode — KHÔNG null, xem H5 §1.5)

chat.message.direct_sent:
  roomId, messageId, actorUserId, recipientUserId, createdAt (ISO)
  actor_name   (string, resolve, KHÔNG null)
  unread_count (number = unreadOf(roomSeq, peer.lastReadSeq) — TÍNH TẠI THỜI ĐIỂM ENQUEUE, xem §1.8)
```

`messageId` → `sourceEntityIdOf`, `sourceEntityType = 'chat_message'` (`notifications.source_entity_type`
tự do, không CHECK — `0479:225`). `sourceModule = 'CHAT'` (khớp `CHAT_MODULE_CODE` — `chat.errors.ts:152`).

### 1.3 `dedupeKeyOf` — bucket từ `payload.createdAt`, KHÔNG `Date.now()` lúc consume — GIỮ NGUYÊN rev 1

```ts
const DM_BUCKET_MS = 15 * 60 * 1000;
function bucket15m(createdAtIso: string): number {
  return Math.floor(Date.parse(createdAtIso) / DM_BUCKET_MS);
}
// dedupeKeyOf CHAT_DIRECT_MESSAGE:
`chat:${roomId}:${recipientUserId}:${bucket15m(createdAt)}`
```

⚠️ **Bucket là BIÊN CỐ ĐỊNH** (`Math.floor(epoch / 15p)`), KHÔNG phải cửa sổ trượt: tin gửi 14:59 và 15:01
rơi vào 2 bucket khác nhau dù cách nhau 2 phút thực ⇒ **2 notification riêng biệt** — đây là hệ quả CHỦ Ý
của công thức, không phải bug. Ghi rõ ở đây để QA không mở issue khi gặp.

`CHAT_MENTIONED` **không cần** `dedupeKeyOf` tường minh — bridge mặc định `ctx.eventId` (once-ever). Nhưng
KHÁC rev 1: `notification-dedupe.const.ts` **PHẢI sửa** — xem §1.4b (H3).

### 1.4a `ChatAudienceReader` — vá thiếu `deleted_at`/`is_archived` của rev 1 (H6.i)

Rev 1 §1.4 chốt điều kiện "còn nhận được" chỉ có `left_at IS NULL` + `muted_until` + `company_id` — **THIẾU**
`chat_rooms.deleted_at IS NULL` và `NOT chat_rooms.is_archived`. Dù `sendMessage` chặn gửi vào phòng lưu trữ
(409 — `chat-messages.service.ts:94-97`) nên đường thật không bao giờ enqueue cho phòng archived/deleted,
đây vẫn phải là defense-in-depth (đúng tinh thần ca 10 §4 — "không dựa may rủi vào producer luôn đúng"):

```ts
// apps/api/src/notifications/chat-audience.reader.ts — import THẲNG bảng Drizzle, KHÔNG import ChatModule.
class ChatAudienceReader {
  async resolveMentionRecipients(
    tx: TenantTx, companyId: string, roomId: string, candidateUserIds: string[],
  ): Promise<string[]> { … }

  async resolveDirectRecipient(
    tx: TenantTx, companyId: string, roomId: string, recipientUserId: string,
  ): Promise<string[]> { … }

  /** Điều kiện "còn nhận được" — DUY NHẤT MỘT chỗ, dùng chung 2 hàm trên. */
  private stillReceivingCondition(userId: string): SQL {
    return and(
      eq(chatRoomMembers.roomId, chatRooms.id),
      eq(chatRoomMembers.companyId, chatRooms.companyId),
      eq(chatRoomMembers.userId, userId),
      isNull(chatRoomMembers.leftAt),
      isNull(chatRooms.deletedAt),          // ← THÊM (H6.i) — rev 1 thiếu
      eq(chatRooms.isArchived, false),      // ← THÊM (H6.i) — rev 1 thiếu
      or(isNull(chatRoomMembers.mutedUntil), lte(chatRoomMembers.mutedUntil, sql`now()`)),
    ) as SQL;
  }
}
```

`resolveMentionRecipients` JOIN thêm so `roomType != 'direct'` (defense-in-depth ca 13 §4); `resolveDirectRecipient`
so `roomType = 'direct'`. `resolveRecipients` của mapping tự mở `db.withTenant(...)` — tx đọc RIÊNG, mirror
`LeaveNotiBridgeRegistrar.managerOf`.

### 1.4b (H3) `notification-dedupe.const.ts` **PHẢI sửa** — đảo ngược quyết định rev 1

Rev 1 chốt "KHÔNG thêm entry nào" vì đọc nhầm: catalog `CHAT_MENTIONED='None'` (`0538:711`) **không phải**
"None nghĩa là đã đúng ý muốn" — nó là giá trị MẶC ĐỊNH của cột khi migration KHÔNG set gì khác, và ý định
thật của SPEC-15 §17 là "gửi ngay" (không gộp LÔ theo cửa sổ thời gian) — nhưng "gửi ngay" **vẫn cần** chống
trùng khi outbox event bị re-claim (crash giữa `insert ↔ markProcessed` — memory
`idempotency-key-must-be-content-derived`). `resolveStrategy` (`notification-dedupe.service.ts:44-56`) chỉ
rơi về `DEFAULT_DEDUPE` khi catalog `='None'` — đúng trường hợp `CHAT_MENTIONED`. Không set ⇒ `dedupe_key`
NULL ⇒ partial-unique coi NULL distinct ⇒ **0 bảo vệ tầng 2**.

```ts
// notification-dedupe.const.ts — THÊM entry (rev 1 nói "KHÔNG sửa" — SAI, đây là điểm vá H3):
CHAT_MENTIONED: { strategy: "DedupeKey", windowSeconds: null },
```

`dedupeKeyOf` cho mapping `CHAT_MENTIONED` **giữ mặc định `ctx.eventId`** (KHÔNG viết hàm riêng) — mirror
`LEAVE_REQUEST_SUBMITTED` (không khai `dedupeKeyOf`). Không migration, không đổi ngữ nghĩa "gửi ngay, không
gộp theo cửa sổ thời gian" — chỉ thêm bảo vệ chống-trùng once-ever theo outbox event. Đừng nhầm "không gộp
lô" với "không idempotent".

### 1.5 `payloadOf` — WHITELIST + coalesce non-null (H5)

Giữ nguyên nguyên tắc whitelist của rev 1 (điểm rủi ro bảo mật lớn nhất WO — lý do `security-reviewer` bắt
buộc), **thêm** yêu cầu coalesce ở PHÍA PRODUCER (không phải ở `payloadOf`, vì `payloadOf` chỉ đổi tên field
chứ không có logic):

```ts
payloadOf: (ctx) => ({           // CHAT_MENTIONED
  actor_name: ctx.payload.actor_name,
  room_name:  ctx.payload.room_name,
  room_id:    ctx.payload.roomId,
}),
payloadOf: (ctx) => ({           // CHAT_DIRECT_MESSAGE
  actor_name:    ctx.payload.actor_name,
  unread_count:  ctx.payload.unread_count,
  room_id:       ctx.payload.roomId,
}),
```

Producer (§1.1) đã đảm bảo `actor_name` KHÔNG null (`findSenderDisplayName` coalesce `email`) và `room_name`
KHÔNG null (`acc.room.name ?? acc.room.roomCode` — phòng `direct` không có tên nhưng `CHAT_MENTIONED` chỉ
enqueue cho phòng KHÔNG `direct`, nơi `roomCode` luôn có giá trị). Ca test 15 (§4) assert `title`/`body`/
`target_url` của MỌI hàng `notifications` tạo trong WO này KHÔNG chứa ký tự `{` — chứng minh coalesce có
hiệu lực thật, không chỉ đọc code.

### 1.6 `muted_until` — CHỈ ĐỌC trong WO này, nhưng KHÔNG còn là nợ trôi nổi (điều kiện 8)

`paths` không có `packages/contracts/**` ⇒ WO này KHÔNG được thêm DTO/API set `muted_until`. Nhưng sau
`CHAT-DEC-013` (§1.7), `muted_until` là **lớp chống-spam DUY NHẤT do người dùng điều khiển** cho DM — 0
đường ghi là lỗ hổng chặn go-live, không phải "nợ để đó". Test set `muted_until` trực tiếp qua SQL fixture.

**Mở WO mới — đề xuất id `S7-CHAT-BE-8`** (chưa tồn tại trong `harness/backlog.mjs` — 19 id `S7-CHAT-*`
hiện có không id nào nhận việc này, xem §0):

- **Tên đề xuất:** `PATCH /chat/rooms/:id/mute` — actor tự đặt/gỡ `muted_until` của CHÍNH mình trong phòng
  (own-scope, KHÔNG cần quyền quản trị — bất kỳ thành viên nào cũng tắt được thông báo phòng của họ).
- **paths đề xuất:** `apps/api/src/chat/**`, `packages/contracts/src/chat.ts`, `apps/api/test/integration/**`.
- **depends_on:** `S7-CHAT-BE-1` (đủ — chỉ cần `ChatAccessService.assertMember`, không cần BE-2/BE-6).
- **Điều kiện mở:** `zone: yellow`, `depends_on` như trên; KHÔNG phụ thuộc BE-6 (đọc/ghi độc lập).
- **Điều kiện đóng đề xuất:** DTO `muteRoomSchema` (`{ mutedUntil: string | null }`, ISO hoặc `null` để gỡ) ·
  cặp quyền tái dùng `('view','chat-room')` (đủ, vì chỉ tự-bound theo actor, không phải hành động quản trị)
  · route đi qua `assertMember` (không route mới nào bỏ qua cổng) · test set + gỡ + set về quá khứ (hết hạn
  ngay) đều 200.
- **Ghi chú go-live:** WO này (`S7-CHAT-BE-8`) nên được thêm vào bảng go-live gate cùng nhóm với `S7-CHAT-QA-1`
  trước khi CHAT lên PROD — vì thiếu nó, `CHAT-DEC-013` ("gửi mọi DM trừ khi mute") không có cách nào người
  dùng thực sự tắt được. **Việc thêm id này vào `harness/backlog.mjs` + `docs/plans/S7-CHAT-WAVE.md` nằm
  NGOÀI phạm vi sửa file của rev 2 này** (yêu cầu gốc chỉ cho phép sửa đúng file plan `S7-CHAT-BE-6.md`) —
  đây là khuyến nghị cần một bước riêng để ghi vào backlog.

### 1.7 (điều kiện 7) `CHAT-DEC-013` — đã chốt, dọn câu treo

`SPEC-15 CHAT.md:627` đã ghi quyết định cuối: gửi mọi DM trừ khi `muted_until` còn hiệu lực; bỏ điều kiện
"đang mở phòng" (presence) ở v1 — chống spam thực tế = gộp lô 15 phút (§1.3) + `muted_until` (§1.6, cần
`S7-CHAT-BE-8`). **KHÔNG còn câu "cần owner xác nhận trước khi code" hay "phải chốt hay chặn WO"** — rev 1
còn 2 câu treo kiểu này ở §1.7/§5, rev 2 xoá hẳn (chính tài liệu này chỉ còn nói "đã chốt, xem
`CHAT-DEC-013`"). DoD trỏ thẳng `SPEC-15 CHAT.md:621-627` (bảng quyết định) thay vì lặp lại lập luận.

### 1.8 (H4) `unread_count` của `CHAT_DIRECT_MESSAGE` — chốt MỘT trong ba, chọn (a)

`NotificationEngineService.intake()` khi trùng `dedupeKey` chỉ **SKIP**, KHÔNG có nhánh UPDATE lại
notification đã persist (`notification-engine.service.ts:114-125` — xác nhận ở §0). Hệ quả: dù `unread_count`
được TÍNH Ở ĐÂU (producer lúc enqueue, hay consumer lúc `payloadOf`), notification ĐẦU TIÊN của mỗi bucket
15 phút là bản DUY NHẤT từng được ghi — mọi tin sau trong cùng bucket bị dedupe, `unread_count` trong body
KHÔNG BAO GIỜ cập nhật cho tới bucket kế tiếp.

**Ba lựa chọn rev 1 nêu:**

- **(a) Chấp nhận ngữ nghĩa "số chưa đọc TẠI THỜI ĐIỂM tin ĐẦU bucket"** — không sửa gì thêm, chỉ tính đúng
  một lần lúc enqueue (đã có sẵn dữ liệu qua `findDirectPeer`, §1.1), ghi rõ vào plan + assert đúng hành vi.
- **(b) Tính lúc consume** — **BỊ LOẠI**: `resolveRecipients` (async) chạy trước `payloadOf` (sync, thuần
  hàm của `ctx.payload`) — không có kênh hợp lệ để hàm async "truyền" số đã tính sang hàm sync (§0). Dựng
  kênh phụ (biến mutable theo `ctx.eventId`) là thêm trạng thái chia sẻ giữa 2 lời gọi trong CÙNG instance
  singleton — rủi ro đua giữa các event xử lý đồng thời, đổi lại **KHÔNG có gì khác** so với (a): vì
  `intake()` không update, "tính lúc consume" chỉ ảnh hưởng giá trị của LẦN ĐẦU (giống hệt (a)), không ảnh
  hưởng các lần sau (vẫn bị dedupe-skip). Đổi kiến trúc để đổi lấy 0 khác biệt hành vi — không đáng.
- **(c) Bỏ `unread_count` khỏi body** — cần sửa `notification_templates.body_template` (migration) — `paths`
  không có `apps/api/migrations/**` ⇒ ngoài phạm vi, cần WO khác.

**Chốt: (a).** Ca test 6 (§4) assert TƯỜNG MINH: 3 tin cùng bucket → `unread_count` trong body của
notification DUY NHẤT bằng giá trị TẠI TIN ĐẦU (không phải tổng 3), và số này CÓ THỂ khác badge
`GET /chat/unread-count` (tính real-time qua `unreadOf`, luôn đúng — `chat-messages.repository.ts:346-375`)
— đây là sai khác CHỦ Ý giữa notification (ảnh chụp lúc gửi) và badge (real-time), ghi vào plan để QA không
mở bug.

### 1.9 KHÔNG import `ChatModule` cho phần CONSUMER — giữ nguyên quyết định rev 1

`ChatAudienceReader`/`ChatNotiBridgeRegistrar` ở `notifications/**` **vẫn KHÔNG** import `ChatModule` — đọc
thẳng `chatRoomMembers`/`chatRooms` (bảng Drizzle typed, không phải DI module) — mirror 5/5 tiền lệ. Đây là
quyết định TÁCH BẠCH khỏi §1.1: **producer** (enqueue) sống trong `chat/**`, dùng lại `acc` + repo nội bộ;
**consumer** (đọc audience, render) sống trong `notifications/**`, đọc bảng thẳng, không phụ thuộc DI hai
chiều. Rev 1 gộp nhầm hai quyết định này thành một — rev 2 tách rõ để không ai đọc rồi tưởng "BE-6 sở hữu cả
chat/** " nghĩa là được phép import `ChatModule` vào `NotificationsModule` (KHÔNG — vẫn cấm, giữ acyclic).

---

## 2. Thi công

| File | Việc |
| --- | --- |
| `apps/api/src/chat/chat-messages.service.ts` (SỬA — không phải file mới) | Thêm `outbox: OutboxService` vào constructor; thêm method `private async enqueueNotifications(...)` (§1.1/§1.2); 1 lời gọi chèn giữa `insertMessage` và `setLastReadSeq` trong `sendMessage` |
| `apps/api/src/chat/chat-messages.repository.ts` (SỬA) | Thêm `findSenderDisplayName` + `findDirectPeer` (§1.1c); thêm `ne` vào import `drizzle-orm` |
| `apps/api/src/chat/chat-access.service.ts` | **KHÔNG sửa** — file 3-bất-biến, giữ nguyên (§1.1) |
| `apps/api/src/notifications/chat-audience.reader.ts` (MỚI) | 2 hàm §1.4a, predicate dùng chung có `deletedAt`/`isArchived`/`mutedUntil` |
| `apps/api/src/notifications/chat-noti-bridge.registrar.ts` (MỚI) | `OnModuleInit`, đăng ký 2 mapping §1.2/§1.3/§1.5, mirror `leave-noti-bridge.registrar.ts` (helper `strField` cục bộ) |
| `apps/api/src/notifications/notification-dedupe.const.ts` (SỬA) | Thêm entry `CHAT_MENTIONED` (§1.4b — H3, đảo quyết định rev 1) |
| `apps/api/src/notifications/notifications.module.ts` (SỬA, additive) | Thêm `ChatAudienceReader`, `ChatNotiBridgeRegistrar` vào `providers` — khối comment mirror 5 WO trước |
| `apps/api/test/integration/chat-noti-e2e.int-spec.ts` (MỚI) | Bộ ca §4 |
| `apps/api/test/integration/chat-be1-access.int-spec.ts` (SỬA) | Mở rộng census ca 14 (§1.4a/H6.ii — xem §4 ca 19) |
| `packages/contracts/src/chat.ts` | **KHÔNG sửa** — payload outbox không đi qua DTO công khai |
| `apps/api/migrations/**` | **KHÔNG sửa** — catalog/CHECK/template CHAT đã đủ từ `0538` |

`sourceModule = 'CHAT'`, `sourceEntityType = 'chat_message'` cho cả 2 mapping.

**Kỷ luật hot-file** — `apps/api/src/chat/chat-messages.service.ts` và `chat-messages.repository.ts` là
file NHIỀU WO cùng sửa: `S7-CHAT-BE-3` (đính kèm, `attachmentCount`/`fileIds`), `S7-CHAT-BE-4` (tìm kiếm),
đề xuất `S7-CHAT-BE-8` (§1.6) đều còn `todo` và sẽ chạm lại 2 file này. Sửa của WO này PHẢI là **APPEND**
(thêm 1 method `enqueueNotifications` + 1 lời gọi chèn giữa 2 dòng có sẵn; thêm 2 method mới cuối
`ChatMessagesRepository`), **KHÔNG** đổi chữ ký `insertMessage`/`setLastReadSeq`/thứ tự tham số hiện có —
WO sau đọc diff sẽ thấy khối thêm rõ ràng, không phải rewrite lẫn vào code cũ (mirror nguyên tắc CLAUDE.md
§9 "Hot-file = append, KHÔNG rewrite").

---

## 3. KHÔNG làm trong WO này

- ❌ Sửa `apps/api/src/chat/chat-access.service.ts` — file 3-bất-biến, quyết định §1.1.
- ❌ Migration mới — catalog/CHECK/template CHAT đã đủ từ `0538`; `paths` không có `apps/api/migrations/**`.
- ❌ API/DTO set `muted_until` — đề xuất WO mới `S7-CHAT-BE-8` (§1.6); `paths` không có `packages/contracts/**`.
- ❌ Bỏ `unread_count` khỏi body template — lựa chọn (c) của H4, cần migration, ngoài phạm vi (§1.8).
- ❌ Presence "đang mở phòng" (RT-1) — `CHAT-DEC-013` đã bỏ điều kiện này ở v1 (§1.7).
- ❌ Sửa `packages/contracts/src/chat.ts` — không cần cho WO này.
- ❌ Audit CHAT-specific mới — audit đã có sẵn ở tầng generic `NotificationEngineService.persistRecipient`/`recordSkip`.
- ❌ Notification cho recall/pin — ngoài phạm vi `done_when` gốc (chỉ `CHAT_MENTIONED`/`CHAT_DIRECT_MESSAGE`).
- ❌ Sinh tin `system` (BE-5 chưa nhận) — `enqueueNotifications` chỉ viết GUARD chờ sẵn (§1.2), không tự sinh.
- ❌ Thêm `harness/backlog.mjs`/`docs/plans/S7-CHAT-WAVE.md` id `S7-CHAT-BE-8` — chỉ ĐỀ XUẤT trong plan này (§1.6); ghi vào backlog là bước riêng.

---

## 4. Test RED-trước

Chủ thể **KHÔNG** là Super Admin. Chạy: `bash scripts/lane-db-setup.sh chatbe6` →
`export LANE_DB=mediaos_chatbe6` → `bash harness/check.sh --lane-db`. Nạp env trước khi gọi vitest tay
(memory `lane-db-run-needs-explicit-urls`):

```bash
set -a && . ./.env && set +a
unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL PGBOUNCER_URL
export LANE_DB=mediaos_chatbe6
```

| # | Ca | Đường | Kỳ vọng |
| --- | --- | --- | --- |
| 1 | Boot: `registerSource()` 2 eventCode CHAT (`is_enabled=true`) | app thật | KHÔNG throw |
| 2 | Boot: wire 1 eventType CHAT giả sang eventCode NGOÀI catalog (vd `CHAT_TYPING`) | app thật | throw TẠI BOOT, message nêu đúng eventCode |
| 2b | Boot: `EventBus.consumersFor("chat.message.mentioned")` và `("chat.message.direct_sent")` mỗi cái đúng **1** consumer | app thật, `app.get(EventBus)` | length === 1 cho cả hai — bắt "dựng bridge tay quên đăng ký registrar" |
| 3 | **HTTP thật** — `POST /chat/rooms/:id/messages` mention 2 người trong phòng `group`, 1 người đã `left_at` | `supertest` qua controller | 200; chỉ người active nhận; đúng 1 `notifications`; payload đúng 3 khoá `{actor_name, room_name, room_id}` |
| 4 | **HTTP thật** — người được mention có `muted_until` tương lai (gieo qua SQL fixture trước khi gửi) | supertest | 200 gửi tin; KHÔNG notification cho người đó |
| 5 | **HTTP thật** — gửi 1 tin vào phòng `direct` | supertest | recipient nhận `CHAT_DIRECT_MESSAGE`; payload đúng 3 khoá `{actor_name, unread_count, room_id}`; `unread_count = 1` |
| 6 | **HTTP thật** — 3 tin cùng phòng `direct`, cùng recipient, `createdAt` cùng bucket 15 phút | supertest × 3 | Chỉ **1** `notifications`; `dedupe_key = 'CHAT_MENTIONED:...'`\/`'CHAT_DIRECT_MESSAGE:chat:{roomId}:{recipientUserId}:{bucket}'`; `unread_count` trong body = giá trị TẠI TIN ĐẦU (§1.8 — KHÔNG phải tổng 3), ghi rõ đây là hành vi ĐÚNG THIẾT KẾ |
| 7 | **HTTP thật** — 2 tin cách nhau > 15 phút (gieo `created_at` lùi giữa 2 lần gửi) | supertest | **2** `notifications` riêng biệt |
| 8 | **HTTP thật** — gửi tin phòng `group` KHÔNG mention | supertest | 0 outbox event mới cho `roomId` này (so đếm trước/sau) |
| 9 | **HTTP thật** — gửi lại CÙNG `clientMessageId` vào phòng `direct` (idempotent replay) | supertest × 2 | Ràng buộc (a) §1.1: CHỈ **1** `notifications` (không phải 2), `last_message_seq` không tăng lần 2 |
| 10 | **HTTP thật, đồng thời** — 2 request `Promise.all`, CÙNG actor + CÙNG `clientMessageId`, phòng `direct` | supertest × 2 song song | Ràng buộc (b) §1.1: race `23505` → CHỈ **1** hàng `chat_messages`, CHỈ **1** `notifications` |
| 11 | **Rollback** — `vi.spyOn(app.get(ChatMessagesRepository), "setLastReadSeq").mockRejectedValueOnce(...)` (bước CUỐI trong tx, chạy SAU `enqueueNotifications` — §1.1) rồi gọi HTTP thật | supertest, 500 | `chat_messages` VÀ `outbox_events` đều **0 hàng mới** cho phòng đó — chứng minh transaction thật rollback cả 2, không phải chỉ outbox (khác `outbox.int-spec.ts:29-38` vốn chỉ chứng minh cơ chế generic) |
| 12 | Adversarial (fixture — `outbox.enqueue` tay, KHÔNG qua producer thật) — payload CÓ thêm khoá `body`/`preview` | fixture tx + `OutboxWorker.processBatch()` | `notifications.payload` KHÔNG chứa `body`/`preview` — chỉ đúng field whitelist §1.5 |
| 13 | Adversarial (fixture) — enqueue `chat.message.direct_sent` cho phòng `roomType != 'direct'` | fixture | 0 notification (reader chặn qua `room_type` — defense-in-depth) |
| 14 | Adversarial (fixture) — enqueue `chat.message.mentioned` với payload THIẾU `roomId` | fixture + `processBatch()` | `target_url` render còn `{room_id}` → `assertInternalTargetUrl` ném `TargetUnavailableError` (422) LOUD; bridge re-throw (không nuốt); OutboxWorker đánh dấu lỗi — chứng minh payload hỏng KHÔNG rơi vào notification rác trong im lặng |
| 15 | **HTTP thật** — sau ca 3 và ca 5 | query DB | `title`/`body`/`target_url` của MỌI hàng `notifications` vừa tạo KHÔNG chứa ký tự `{` |
| 16 | Cross-tenant — `mentionedUserIds` chứa 1 `userId` company khác (gieo qua fixture, gửi qua HTTP) | supertest | 0 notification cho company đó (RLS + resolver company-bind) |
| 17 | Defense-in-depth — phòng archived/đã xoá mềm gieo trực tiếp qua SQL, gọi `ChatAudienceReader.resolveMentionRecipients` TRỰC TIẾP qua `app.get(...)` (không qua HTTP — `sendMessage` chặn 409/404 trước khi tới đây) | `app.get(ChatAudienceReader)` | Trả `[]` — chứng minh predicate §1.4a THẬT SỰ lọc `deletedAt`/`isArchived`, không chỉ nằm trên giấy |
| 18 | Không route nào sửa `body`/gọi `enqueueNotifications` ngoài `sendMessage` | grep + census (mirror BE-2 ca 21) | 0 hit |
| 19 | **Census mở rộng (H6.ii)** — quét thêm `apps/api/src/notifications/chat-*.ts` cho predicate "còn nhận được" (`isNull(chatRoomMembers.leftAt)` ghép `isNull(chatRooms.deletedAt)`) | mở rộng `describe("ca 14...")` trong `chat-be1-access.int-spec.ts` | Đúng **1** file NGOÀI `chat-access.service.ts` được whitelist chứa predicate này: `chat-audience.reader.ts`. File thứ ba xuất hiện với cùng pattern ⇒ đỏ |

Bằng chứng RED — dự kiến chạy thật (vá tạm → đo → hoàn nguyên), tối thiểu:

| Vá tạm | Kết quả đo mong đợi |
| --- | --- |
| Bỏ lời gọi `enqueueNotifications` khỏi `sendMessage` | ĐỎ ca 3, 5 (0 notification dù gửi tin thành công) |
| `notification-dedupe.const.ts` bỏ entry `CHAT_MENTIONED` (đúng như rev 1 để nguyên) | ĐỎ khi ép re-claim event (dựng lại processed_events mất dấu) — trùng notification |
| Bỏ `payloadOf` whitelist (pass-through mặc định) | ĐỎ ca 12 |
| `ChatAudienceReader` predicate bỏ `isArchived`/`deletedAt` (đúng bản rev 1) | ĐỎ ca 17 |
| Đặt `enqueueNotifications` TRƯỚC nhánh `if (existing) return` | ĐỎ ca 9 (2 notification thay vì 1) |

⚠️ Không `| head` khi chạy vitest (memory từ BE-2: giết tiến trình trước `afterAll`, tenant rác lan sang lần
chạy sau). Drop lane DB sau khi xong (`pgdata-bloat-lane-dbs-and-job-log`).

---

## 5. Definition of Done / Nợ & rủi ro

- [ ] `enqueueNotifications` nằm TRONG `ChatMessagesService.sendMessage`, đúng vị trí §1.1 (giữa `insertMessage` và `setLastReadSeq`); `chat-access.service.ts` KHÔNG bị đụng (`git diff --stat` xác nhận)
- [ ] Ràng buộc (a)/(b)/(c) §1.1 đúng bằng CẤU TRÚC code, không chỉ bằng test — reviewer đọc lại vị trí dòng
- [ ] `findSenderDisplayName`/`findDirectPeer` mới trong `chat-messages.repository.ts`, KHÔNG viết lại predicate membership (mirror `filterMentionsToMembers`)
- [ ] `ChatAudienceReader` predicate CÓ `deletedAt`/`isArchived`/`mutedUntil` (H6.i)
- [ ] `notification-dedupe.const.ts` CÓ entry `CHAT_MENTIONED` (H3 — đảo quyết định rev 1)
- [ ] `payloadOf` WHITELIST cả hai mapping, KHÔNG pass-through; producer coalesce `actor_name`/`room_name` non-null (H5)
- [ ] `dedupeKeyOf` CHAT_DIRECT_MESSAGE tính từ `payload.createdAt`, KHÔNG `Date.now()`
- [ ] `unread_count` — hành vi (a) §1.8 được ASSERT tường minh (ca 6), không chỉ tài liệu
- [ ] 20 ca §4 (1,2,2b,3-19) xanh trên `LANE_DB`, tối thiểu 4 ca đi qua HTTP thật (thực tế: ca 3,4,5,6,7,8,9,10,15,16 = 10 ca)
- [ ] Census ca 14 mở rộng phủ `apps/api/src/notifications/chat-*.ts` (ca 19, H6.ii)
- [ ] `packages/contracts/**`, `apps/api/migrations/**` KHÔNG bị đụng
- [ ] LIGHT gate (`typescript-reviewer` + `quality-gate`) + `security-reviewer` (bắt buộc, đường rò nội dung) PASS
- [ ] **Bổ sung theo rev 2:** `database-reviewer` + `silent-failure-hunter` review RIÊNG diff `apps/api/src/chat/**` (vùng vừa qua FULL gate, nay bị chạm lại bởi producer) — không phải toàn WO, chỉ phần diff này
- [ ] Câu treo DEC-013 ("cần owner xác nhận"/"phải chốt hay chặn WO") đã xoá khỏi văn bản, trỏ `SPEC-15 CHAT.md:621-627`
- [ ] Đề xuất WO `S7-CHAT-BE-8` (§1.6) đã ghi rõ trong plan — ghi vào `harness/backlog.mjs`/`S7-CHAT-WAVE.md` là bước tiếp theo, NGOÀI phạm vi sửa file của rev 2
- [ ] lane DB `mediaos_chatbe6` drop sau khi xong

**Rủi ro cao nhất cho reviewer:** `enqueueNotifications` chạm lại `ChatMessagesService.sendMessage` — file
vừa qua FULL gate của `S7-CHAT-BE-2`. Sai vị trí (đặt trước `insertMessage`, hoặc trong nhánh `.catch`, hoặc
trước nhánh `existing`) phá một trong ba bất biến C1(a)/(b)/(c) mà KHÔNG có test nào tự động bắt được nếu
ca 9/10/11 bị bỏ qua — đọc kỹ vị trí dòng trước khi PASS.

**Nợ chuyển tiếp:**

1. `S7-CHAT-BE-8` (đề xuất §1.6) — set `muted_until` qua HTTP. Nên chặn go-live cùng `S7-CHAT-QA-1`.
2. Khi `S7-CHAT-RT-1` land — WS emit là việc RIÊNG, không liên quan enqueue outbox của WO này (2 cơ chế độc lập).
3. `S7-CHAT-BE-5` (phòng dẫn xuất) phải đảm bảo `chatRooms.name` KHÔNG NULL cho phòng `department`/`project` — nếu không, `room_name` payload `CHAT_MENTIONED` rỗng cho các loại phòng đó (hiện tại chỉ `group` tồn tại thật nên rủi ro chưa phát tác; `acc.room.name ?? acc.room.roomCode` §1.5 đã có lưới cuối nên KHÔNG bao giờ null, nhưng `roomCode` không phải tên thân thiện).
4. Lựa chọn (c) của H4 (bỏ `unread_count` khỏi body, đo lúc đọc thay vì lúc gửi) — nếu sau này thấy hành vi (a) gây khó chịu UX thật, cần WO migration riêng sửa `notification_templates.body_template`.
