# S4-NOTI-BE-2 — Event intake + notification engine (recipient resolver · renderer · delivery log · dedupe · actor-exclusion)

> Zone **RED / CROWN — trust boundary**. Gate **FULL**: `security-reviewer` + `silent-failure-hunter` + `database-reviewer`.
> **Bản v2 (2026-07-09)** — v1 bị `plan-reviewer` BLOCK. Ba lỗi đã sửa, ghi ở §0. Đọc §0 trước.
> `depends_on: S4-NOTI-SEED-1` (xong). **WO này KHÔNG thêm migration.**

---

## 0. Sửa gì so với v1 (đừng lặp lại)

| v1 sai | Vì sao sai | v2 làm |
|---|---|---|
| "bắt unique-violation `uq_notifications_dedupe_active` → đếm deduped, KHÔNG 500" — trong **một** transaction `withTenant` | Postgres **abort cả transaction** khi unique-violation. Mọi lệnh sau đó ném `current transaction is aborted`. Bắt lỗi ở tầng JS trong cùng tx ⇒ vẫn rollback toàn batch (mất notification của recipient khác) hoặc bật 500 — trái đúng acceptanceCheck "không 500 khi race" | **`SAVEPOINT` mỗi recipient** (nested tx). Unique-violation → `ROLLBACK TO SAVEPOINT` → `deduped_count++`, tx ngoài sống. §6 |
| `POST /send` khai trong scope (L0 + L3) nhưng **0 test** phủ nó | Đây là đường direct-send bỏ qua event catalog — admin tự soạn `title`/`body`/`target_url`/`payload`. Bề mặt rủi ro **cao hơn** `/events` trên một route crown | **OUT OF SCOPE** — `/send` + `internalDirectSendSchema` đẩy sang `S4-NOTI-BE-3`. BE-2 chỉ làm `/events`. §1 |
| Không nói rõ `createFromEngine` phải ghi cột nào | `uq_notifications_dedupe_active` đánh trên `(company_id, recipient_user_id, event_code, dedupe_key)` — toàn **cột MỚI**. Nếu chỉ set `user_id` legacy, `recipient_user_id` NULL → partial-unique coi NULL là distinct ⇒ **backstop vô hiệu, dedupe im lặng hỏng** | Dual-write bắt buộc: cột mới `recipient_user_id`, `event_code`, `dedupe_key`, `status` **và** cột legacy NOT NULL. Có assert. §5.3, §7 |

Ngoài ra: mã lỗi `422 EVENT-DISABLED` / `409 DEDUPE-CONFLICT` từng được liệt kê mà **không route nào kích** → §6.4 nói rõ chúng thuộc `/send` (BE-3), còn `/events` là fire-and-forget trả `200 + summary`.

---

## 1. Mục tiêu & phạm vi

**Mục tiêu:** biến một event nghiệp vụ đã chuẩn hoá thành bản ghi `notifications` IN_APP + `notification_delivery_logs`, qua pipeline **catalog → recipient resolver (actor-exclusion) → dedupe → template render → persist**.

Hai mặt tiếp nhận:
- `NotificationEngineService.intake(companyId, event)` — đường in-process cho outbox consumer (S4-INT-1 gọi).
- `POST /internal/v1/notifications/events` — đường HTTP nội bộ, gated fail-closed.

**OUT:**
- `POST /internal/v1/notifications/send` + `internalDirectSendSchema` → **S4-NOTI-BE-3**.
- Wiring TASK→NOTI (đăng ký consumer theo eventType thật) → **S4-INT-1**. BE-2 test bằng **event giả** qua HTTP intake, độc lập hoàn toàn với producer TASK (chưa tồn tại).
- My-notification APIs → S4-NOTI-BE-1 (PR #133).
- `bulk-send` / reminder job / delivery retry job → S4-NOTI-BE-3.
- Kênh EMAIL/PUSH/REALTIME thật (chỉ IN_APP).
- Migration; `env.schema.ts`.

---

## 2. Sự thật đã xác minh

### 2.1 Schema 0479 / seed 0481
- **`notification_events`** (`0479:37-96`): `company_id` NULLABLE (NULL = global), `is_enabled`, `is_system_event`, `dedupe_strategy` CHECK ∈ `('None','DedupeKey','TimeWindow','EntityRecipient')` DEFAULT `'None'`, `dedupe_window_seconds` NULLABLE, `default_channels jsonb`, `recipient_rule_config jsonb`. App `GRANT SELECT` (`:95`).
- **`notification_templates`** (`0479:99-154`): `event_id` FK, `channel` DEFAULT `IN_APP`, `locale` DEFAULT `vi-VN`, `title_template`/`body_template` NOT NULL, `target_url_template`, `status` CHECK ∈ `('Draft','Active','Inactive','Archived')`, `is_default`. App `GRANT SELECT`.
- **`notification_delivery_logs`** (`0479:158-206`): `notification_id` **FK NOT NULL**, `recipient_user_id` FK NOT NULL, `delivery_status` CHECK ∈ `('Pending','Sent','Delivered','Failed','Skipped','Cancelled')`, `attempt_no ≥ 1`. **`GRANT SELECT, INSERT` — không UPDATE/DELETE** (`:205`, đã kiểm chứng độc lập). Không có unique index dedupe.
- **`notifications` ALTER-ADD** (`0479:214-281`): cột mới đều NULLABLE (`recipient_user_id`, `event_id`, `event_code`, `notification_type`, `priority`, `status`, `title`, `source_entity_*`, `target_*`, `payload`, `dedupe_key`, `read_at`…). **Giữ legacy NOT NULL**: `user_id`, `type` (DEFAULT `'general'`), `body`, `is_read`.
  - **Dedupe backstop**: `uq_notifications_dedupe_active` UNIQUE `(company_id, recipient_user_id, event_code, dedupe_key) WHERE dedupe_key IS NOT NULL AND deleted_at IS NULL` (`:279-281`).
  - Partial index unread: `idx_notifications_unread ON (company_id, recipient_user_id) WHERE status='Unread'` (`:264-266`).
- **Seed 0481**: 36 event `is_enabled=true` + 16 `is_enabled=false`, tất cả global; 36 template IN_APP/vi-VN cho event enabled. ⚠ Mọi event seed **không set** `dedupe_strategy`/`dedupe_window_seconds` (`:47-104`) ⇒ nhận DEFAULT `'None'`/NULL.

### 2.2 Đã tồn tại gì trong `apps/api/src/notifications`
- `notifications.service.ts` — service **legacy** (media-era): ghi cột legacy, enum lowercase (`contracts/notification.ts:3-16`), emit WS. **Không** dùng catalog/template/delivery_log. → **không viết lại**; thêm engine mới song song.
- `notifications.module.ts` — imports `DatabaseModule, EventsModule, RealtimeEmitterModule`. **EventsModule đã cấp** `OutboxService`, `AuditService`, `EventBus`.
- Drizzle schema 3 bảng mới đã có (`db/schema/noti.ts`) ⇒ **không cần `db:generate`**.
- ⚠ PR #133 (S4-NOTI-BE-1) đang sửa `notifications.module.ts` + `notifications.controller.ts` và thêm `my-notifications.*`. **WO này phải rebase sau khi #133 merge**, nếu không sẽ conflict.

### 2.3 Outbox / event-bus
- `events/outbox.service.ts:17` — `enqueue(tx, {eventType, payload})` cùng tx nghiệp vụ.
- `events/outbox-worker.ts` — `processBatch()` claim `FOR UPDATE SKIP LOCKED`, gọi `EventBus.consumersFor(eventType)`, idempotency `processed_events`, retry → dead-letter.
- Consumer nhận `{eventId, companyId, eventType, payload}` (`event-bus.ts:7-15`); `consumerName` phải duy nhất toàn hệ (`:34`).
- **Producer TASK chưa tồn tại** ⇒ BE-2 **không** đăng ký consumer eventType TASK.

### 2.4 Internal-auth (đã có — reuse, fail-closed)
- `permission/guards/internal.guard.ts:18-36` — so `x-internal-key` với `process.env['INTERNAL_API_KEY']`; **env unset → 403** (fail-closed); không log key.
- `JwtAuthGuard` là **APP_GUARD toàn cục** (`app.module.ts:87-89`) ⇒ route không `@Public()` chạy JWT → Company → (2FA) → `InternalGuard`. Mẫu đã duyệt: `attendance/attendance-internal.controller.ts:25-42`.
- ⚠ `INTERNAL_API_KEY` **không** có trong `env.schema.ts`; guard đọc thẳng `process.env` và fail-closed nếu thiếu ⇒ an toàn. **Không sửa `env.schema.ts`** (ngoài paths).

### 2.5 Mâu thuẫn done_when ↔ schema thật (đã giải, không lờ)
1. **Append-only vs "cập nhật trạng thái delivery"** — app chỉ có `SELECT, INSERT`. Pattern "INSERT Pending → UPDATE Sent" sẽ `permission denied`. → IN_APP ghi **1 INSERT trạng thái terminal `Sent`**; Skipped/Failed cũng INSERT-terminal; retry (job sau) = INSERT hàng `attempt_no` mới.
2. **"Event disabled → delivery_log Skipped" bất khả thi** — `delivery_log.notification_id` là FK NOT NULL, mà event disabled thì không có notification để tham chiếu. → phân tầng:
   - **Event-level** (disabled / 0 recipient): không notification, không delivery_log; ghi `audit_logs` (`notification_skipped` + reason) + `skipped_count` trong summary.
   - **Channel/recipient-level** (sau khi đã có notification): INSERT delivery_log `Skipped` hợp lệ.
3. **Seed dedupe = `'None'`** — dedupe cho comment/status không bật out-of-box. → engine đọc catalog làm nguồn chính + **`DEFAULT_DEDUPE`** (const nội bộ) cho `TASK_COMMENT_CREATED` / `TASK_STATUS_CHANGED`, chỉ áp khi catalog `= 'None'`; catalog override được. Không cần migration.

---

## 3. Trust boundary (CROWN)

| Đường vào | Ngữ cảnh | Xác thực | company_id |
|---|---|---|---|
| `NotificationEngineService.intake()` | in-process, outbox worker (S4-INT-1) | trusted-by-construction (worker role, in-tx) | từ `EventContext.companyId` |
| `POST /internal/v1/notifications/events` | job / service khác | `JwtAuthGuard` toàn cục → **401** nếu thiếu Bearer; `InternalGuard` → **403** nếu thiếu/sai `x-internal-key` hoặc env unset | **từ `req.user.companyId`** — không lấy từ body |

- **Không `@Public()`.** Route tạo notification cho user bất kỳ trong tenant ⇒ rò key = spam/impersonation toàn tenant. Cần **cả** JWT hợp lệ **và** internal key (defense-in-depth).
- **company_id spoof-proof:** engine chạy `withTenant(req.user.companyId)`. Body có `company_id` khác token → **400**. RLS FORCE khiến recipient company khác **vô hình** (resolve 0 row).
- **Chặn SSRF / target-URL ngoài:** `target_url` phải khớp `^/(?!/)[\w\-./?=&%#]*$` — bắt đầu `/`, không scheme (`http:`/`https:`/`javascript:`/`data:`), không `//`, không `\`. Ngoài whitelist → **422 `NOTI-ERR-TARGET-UNAVAILABLE`** (loud), **không** âm thầm strip.
- **Ban payload nhạy cảm:** key ∈ `{password, token, salary, bank_account, identity_number, private_file_url}` hoặc chuỗi comment quá dài → **400 `NOTI-ERR-TEMPLATE-VARIABLE-INVALID`**.
- **Secret:** `INTERNAL_API_KEY` từ env; không log, không vào DTO/response.

---

## 4. Lanes

| lane | nội dung | paths |
|---|---|---|
| L0 contracts | enum TitleCase + `internalEventIntakeSchema` + `intakeSummarySchema` (**không** `internalDirectSendSchema`) | `packages/contracts/src/notification.ts`, `index.ts` |
| L1 repos | 3 repo đọc catalog + `createFromEngine` dual-write | `apps/api/src/notifications/notification-{event,template,delivery-log}.repository.ts`, `notifications.repository.ts` |
| L2 engine | resolver + renderer + dedupe + engine (mỗi file ≤ 400 dòng) | `notification-{recipient-resolver,renderer,dedupe,engine}.service.ts` |
| L3 http | controller 1 route `/events` + wiring | `internal-notifications.controller.ts`, `notifications.module.ts` |
| L4 test | int-spec RED-trước | `apps/api/test/integration/noti-event-intake.int-spec.ts` |

---

## 5. Steps

1. **L4 RED trước** — viết int-spec 7 nhóm (a–g §7), chạy phải ĐỎ.
2. **L0** — additive vào `contracts/notification.ts`, **không sửa** `notificationSchema` legacy:
   - `notificationTypeEnumSchema` TitleCase = `['System','Account','HR','Attendance','Leave','Task','Project','Approval','Reminder','Warning','Error']` (khớp CHECK `0479:64-65`).
   - `notificationPrioritySchema` = `['Low','Normal','High','Urgent','Critical']`.
   - `internalEventIntakeSchema`: `eventCode`, `actorUserId?`, `sourceModule`, `sourceEntityType?`, `sourceEntityId?`, `dedupeKey?`, `recipient: { mode, userIds[], employeeIds[] }`, `payload`, `priorityOverride?`, `occurredAt?`. **Không có `company_id`.**
   - `intakeSummarySchema`: `createdCount`, `skippedCount`, `dedupedCount`.
3. **L1 repos**
   - `findEnabledEvent(tx, companyId, eventCode)` — company-override > global, `is_enabled = true`, `deleted_at IS NULL`.
   - `findActiveTemplate(tx, eventId, channel, locale)` — `status='Active'`, company-override > global, `is_default` fallback.
   - `insertLog(tx, {...terminalStatus})` — **chỉ INSERT**.
   - **`createFromEngine(tx, row)`** — dual-write:
     - cột mới: `recipient_user_id`, `event_id`, `event_code`, `notification_type`, `priority`, `status='Unread'`, `title`, `dedupe_key`, `source_entity_*`, `target_*`, `payload`
     - cột legacy NOT NULL: `user_id` (= recipient), `body` (= rendered), `type='general'`, `is_read=false`
     > Bỏ `recipient_user_id`/`event_code`/`dedupe_key` = partial-unique index coi NULL là distinct ⇒ **backstop chết im lặng**. §7(b2) khoá điều này.
4. **L2 engine** — xem §6.
5. **L3 http** — `@Controller("internal/v1/notifications")` `@UseGuards(InternalGuard)` `@UsePipes(ZodValidationPipe)`; **1 route** `POST /events`; `companyId = req.user.companyId`; body có company khác → 400. Wire providers khối additive vào `notifications.module.ts`. **Không** đăng ký consumer eventType TASK.
6. **L4 GREEN** — `bash scripts/lane-db-setup.sh notibe2` → `export LANE_DB=mediaos_notibe2` → `pnpm --filter @mediaos/api test`.

---

## 6. Pipeline engine

```text
intake(companyId, event) → withTenant(companyId):
 1. validate DTO + target_url nội bộ + ban key nhạy cảm          → 400/422 (loud)
 2. findEnabledEvent(companyId, eventCode)
      • not found  → 404 NOTI-ERR-EVENT-NOT-FOUND
      • disabled   → 0 notification, 0 delivery_log;
                     audit 'notification_skipped' reason='event_disabled'; skipped_count++
 3. resolveRecipients() → userIds[]
      • actor-exclusion: bỏ actorUserId TRỪ event.is_system_event
      • lọc active / cùng company (RLS ⇒ cross-tenant user vô hình)
      • rỗng → audit reason='no_recipient'; skipped_count++
 4. for each recipient:
      SAVEPOINT sp_recipient                       ← BẮT BUỘC (xem 6.2)
        a. dedupe: computeKey + isDuplicate(window) → deduped_count++, RELEASE, continue
        b. findActiveTemplate → render()
             • missing/inactive → fallback (fallback=true, non-silent)
        c. createFromEngine(dual-write legacy + MỚI, dedupe_key, status='Unread')
             • unique_violation (23505) → ROLLBACK TO sp_recipient; deduped_count++; continue
        d. insertLog(IN_APP, 'Sent', attempt_no=1)           ← INSERT-terminal
             • fallback → metadata.reason='template_fallback' (loud)
        e. audit 'notification_created'
      RELEASE SAVEPOINT sp_recipient
 5. emit WS qua DTO đã mask (sau commit, best-effort)
 6. return summary { createdCount, skippedCount, dedupedCount }
```

### 6.1 Actor-exclusion
Bỏ `actorUserId` khỏi recipients. **Ngoại lệ:** `is_system_event = true` (SYSTEM_* / DASH_WIDGET_ERROR, seed `0481:85-86,99-103`) ⇒ không bỏ.

### 6.2 Dedupe — ép 2 tầng, và tại sao phải có SAVEPOINT
- **Cấu hình:** `event.dedupe_strategy` + `dedupe_window_seconds`; fallback `DEFAULT_DEDUPE` const cho `TASK_COMMENT_CREATED`/`TASK_STATUS_CHANGED` (window 300s) khi catalog `= 'None'`.
- **Key:**
  - `TimeWindow` → `{eventCode}:{sourceEntityId}:{recipientUserId}:{floor(epoch/window)}` (bucket) ⇒ trùng trong bucket bị chặn, sang bucket mới cho qua.
  - `EntityRecipient` / `DedupeKey` (once-ever) → key ổn định, không bucket.
  - `None` (và ngoài `DEFAULT_DEDUPE`) → **không set `dedupe_key`** ⇒ không dedupe (partial index không áp).
- **Tầng 1 (app):** query `isDuplicate` trước khi INSERT.
- **Tầng 2 (DB, chống race):** partial-unique `uq_notifications_dedupe_active`. Hai intake đồng thời cùng key ⇒ INSERT thứ hai ném `23505`.

> **Bắt buộc `SAVEPOINT`.** Trong Postgres, unique-violation làm **abort cả transaction**: mọi lệnh tiếp theo ném `current transaction is aborted, commands ignored until end of transaction block`. Bắt `23505` ở tầng JS mà không có savepoint ⇒ `insertLog`/`audit`/`COMMIT` sau đó đều lỗi, mất luôn notification của các recipient còn lại, hoặc bật 500. Vì vậy mỗi recipient bọc `SAVEPOINT sp_recipient` … `ROLLBACK TO sp_recipient` khi `23505`. Không dựa read-then-write.

### 6.3 Failure taxonomy (không nuốt lỗi)

| Tình huống | Xử lý | Ghi nhận |
|---|---|---|
| Event không tồn tại | reject | 404 `NOTI-ERR-EVENT-NOT-FOUND` |
| Event disabled | skip toàn bộ | audit `notification_skipped`; `skipped_count`; **không** delivery_log (FK) |
| 0 recipient | skip | audit `reason='no_recipient'`; `skipped_count` |
| Recipient inactive/locked | loại recipient đó | delivery_log `Skipped` (đã có notification) |
| Template missing/inactive | **fallback** | notification + delivery_log `Sent`, `metadata.reason='template_fallback'` (loud) |
| Dedupe hit (app hoặc DB) | skip recipient đó | `deduped_count` |
| target_url ngoài / payload nhạy cảm | reject cả request | 422 / 400 loud |

### 6.4 Mã lỗi — route nào kích cái nào
`/events` là **fire-and-forget**: event disabled hoặc dedupe **không** ném lỗi, mà trả `200` + `summary` (`skippedCount` / `dedupedCount`). Vì vậy:
- `/events` dùng: **404** `NOTI-ERR-EVENT-NOT-FOUND` · **422** `NOTI-ERR-TARGET-UNAVAILABLE` · **400** `NOTI-ERR-TEMPLATE-VARIABLE-INVALID` · **401/403** authn/authz.
- **422 `NOTI-ERR-EVENT-DISABLED`** và **409 `NOTI-ERR-DEDUPE-CONFLICT`** là ngữ nghĩa **single-shot**, thuộc `POST /send` → **S4-NOTI-BE-3**. Không khai báo chúng ở BE-2 (mã treo không có deny-path).
- Ghi chú deviation vs SPEC-08 §19 vào code comment để BE-3 biết.

---

## 7. testTasks — RED trước, deny-path đi đầu

File `apps/api/test/integration/noti-event-intake.int-spec.ts`.
Gate cứng: `const runDb = hasDb && Boolean(process.env.LANE_DB); describe.skipIf(!runDb)(...)`.
Bootstrap Nest app thật (JwtAuthGuard → CompanyGuard → InternalGuard → controller); seed company A + company B + users (actor, recipient, recipient-B) qua `directPool`; set `process.env.INTERNAL_API_KEY`.

- **(a) untrusted context** — không Bearer → **401**; JWT hợp lệ + thiếu `x-internal-key` → **403**; sai key → **403**; env unset → **403**.
- **(b) dedupe (app)** — `TASK_COMMENT_CREATED` cùng `sourceEntityId` + recipient, 2 lần trong window → `created=1, deduped=1`, đúng 1 notification; bucket kế → tạo mới.
- **(b2) dedupe (backstop DB + savepoint)** — chèn **trước** một row xung đột qua `directPool` (cùng `company_id`/`recipient_user_id`/`event_code`/`dedupe_key`), rồi intake **2 recipient** cùng lúc. Assert: recipient trùng → `deduped_count++`; recipient còn lại **vẫn được tạo**; response **không 500**. Đồng thời assert notification tạo ra có `recipient_user_id`, `event_code`, `dedupe_key` **NOT NULL** (nếu NULL thì index không bao giờ bắt được — dedupe hỏng im lặng).
- **(c) actor-exclusion** — actor ∈ recipients, event non-system → actor 0 notification; `is_system_event=true` → actor có.
- **(d) cross-tenant** — recipient thuộc company B → không tạo; `body.company_id = B`, token = A → **400**.
- **(e) event disabled** — 0 notification, 0 delivery_log, có `audit_logs` `notification_skipped`, response 200 + `skippedCount ≥ 1`, **không 500**.
- **(f) template missing** — notification fallback + dấu vết non-silent (assert `metadata.reason` khác path thường).
- **(g) target ngoài** — `target_url` = `https://evil.com` / `//evil` / `javascript:` → **422**; payload chứa `salary`/`token` → **400**.
- **(h) happy-path** — `TASK_ASSIGNED` + `mode=UserIds` → 1 notification (đủ cột legacy + mới) + 1 delivery_log `Sent`, `attempt_no=1`.

---

## 8. Rủi ro

- **Savepoint bị bỏ quên** → race dedupe làm hỏng cả batch. `(b2)` là lưới an toàn.
- **Quên dual-write cột mới** → partial-unique không bắt (NULL distinct) ⇒ dedupe hỏng **im lặng**, test `(b)` vẫn xanh vì tầng app chặn. Chỉ `(b2)` phát hiện.
- **False-green test** — quên `LANE_DB` → skip im lặng; DB chung thiếu band 0479–0481 → đỏ-giả.
- **Append-only** — mọi `UPDATE notification_delivery_logs` từ app role sẽ `permission denied`. Chỉ INSERT-terminal.
- **Quên legacy NOT NULL** (`user_id`/`body`/`type`/`is_read`) → INSERT fail toàn bộ.
- **`company_id` từ body** thay vì token → cross-tenant spoof.
- **`@Public()` nhầm** trên internal controller → mất lớp JWT.
- **Consumer trùng eventType** — không đăng ký consumer TASK ở BE-2 (INT-1 làm); `consumerName` trùng sẽ throw.
- **enum lẫn lộn** — legacy lowercase vs mới TitleCase. Thêm enum mới, giữ legacy.
- **`INTERNAL_API_KEY` thiếu ở `.env`** → route 403 toàn bộ (fail-closed, đúng ý) nhưng dễ bị hiểu là "im lặng không gửi". Đường in-process (INT-1) không cần key.
- **Rebase sau PR #133** — `notifications.module.ts` bị cả hai WO sửa.
- **File > 800 dòng** — tách engine/resolver/renderer/dedupe (≤ 400 dòng/file).

---

## 9. Definition of Done

- `NotificationEngineService.intake()` + `POST /internal/v1/notifications/events` chạy: catalog → resolver (actor-exclusion) → dedupe (savepoint) → render (fallback) → persist notification + delivery_log terminal. Độc lập producer TASK.
- Trust boundary fail-closed: no-JWT → 401; no/sai key → 403; env unset → 403; `company_id` từ token; recipient cross-tenant không tạo.
- Dedupe 2 tầng có `SAVEPOINT`; dual-write cột mới có assert; disabled → audit-skip; template missing → fallback non-silent; target ngoài → reject. Không nuốt lỗi.
- Append-only tôn trọng; `withTenant` mọi query; audit hành động quan trọng; secret không log.
- `/send` **không** có trong diff (đã đẩy sang BE-3).
- Contracts additive dual-build; int-spec (a–h) xanh dưới `LANE_DB`; `typecheck` + `check.sh` (`TURBO_FORCE=1`) xanh.
- **FULL gate** `security-reviewer` + `silent-failure-hunter` + `database-reviewer` PASS.
- Migration: **không** (head giữ nguyên).
