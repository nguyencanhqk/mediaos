# S4-NOTI-BE-2 — BE Event intake + notification engine (recipient resolver · template renderer · delivery log · dedupe · actor-exclusion)

> Zone **RED / CROWN — trust boundary**. IMPLEMENT + REVIEW: Opus. Gate: **FULL** (`security-reviewer` + `silent-failure-hunter` + `plan-reviewer` PASS trước khi code). Test **RED-trước**, deny-path đi đầu.
> `depends_on: S4-NOTI-SEED-1` (XONG). Head migration hiện tại = **0482** (journal idx 162). **WO này KHÔNG thêm migration** — nó tiêu thụ schema 0479 + seed 0481 đã có.

---

## 1. Mục tiêu & phạm vi

**Mục tiêu:** dựng "engine" NOTI biến 1 event nghiệp vụ (đã chuẩn hoá) thành các bản ghi `notifications` IN_APP + `notification_delivery_logs`, đi qua pipeline: **catalog lookup → recipient resolver (actor-exclusion) → dedupe → template render → persist**. Mở 2 mặt tiếp nhận: (a) **service method** `NotificationEngineService.intake()` (đường in-process cho outbox consumer — INT-1 gọi), (b) **HTTP nội bộ** `POST /internal/v1/notifications/events` + `/send` gated fail-closed.

### IN (BE-2 làm)
- `NotificationEngineService.intake(companyId, event)` — pipeline đầy đủ, chạy trong `withTenant(companyId)`.
- Repositories đọc catalog: `notification_events` (enabled?), `notification_templates` (active?), ghi `notifications` (dual-write legacy+new cols) + `notification_delivery_logs` (INSERT-terminal-status, append-only).
- `NotificationRecipientResolverService` — modes **UserIds / EmployeeIds / ManagerOfEmployee**. Actor-exclusion + lọc active/cùng-company.
- `NotificationRendererService` — thay placeholder `{var}` từ payload; fallback mặc định khi template missing; ban key nhạy cảm + validate target_url nội bộ.
- Dedupe theo `dedupe_strategy`/`dedupe_window_seconds` của catalog + backstop bằng partial-unique-index `uq_notifications_dedupe_active`.
- `InternalNotificationsController` (`/internal/v1/notifications/events` + `/send`) gated **JwtAuthGuard (global) + `InternalGuard` (x-internal-key)**.
- Contracts additive (DTO intake/send + enum TitleCase mới) + int-spec RED-trước.

### OUT (KHÔNG làm ở WO này)
- **KHÔNG wiring TASK/PROJECT event → NOTI** (đăng ký consumer theo eventType thật). Đó là **S4-INT-1**. BE-2 test pipeline bằng **event giả** qua HTTP intake — độc lập hoàn toàn với producer TASK.
- KHÔNG My-notification APIs (list/dropdown/unread/mark-read) — đó là **S4-NOTI-BE-1**.
- KHÔNG `bulk-send` / `reminder-jobs` / `delivery-jobs/retry` (S4-NOTI-BE-3).
- KHÔNG kênh EMAIL/PUSH/REALTIME thật (chỉ IN_APP).
- KHÔNG migration, KHÔNG đụng `env.schema.ts` (ngoài `paths`).

---

## 2. Sự thật đã xác minh (đường dẫn:dòng)

### 2.1 Schema thật 0479/0481
- **`notification_events`** (`migrations/0479_*.sql:37-96` · `apps/api/src/db/schema/noti.ts:34-91`): `company_id` **NULLABLE** (NULL=global), `event_code`, `is_enabled`, `is_system_event`, `dedupe_strategy` CHECK ∈ `('None','DedupeKey','TimeWindow','EntityRecipient')` DEFAULT `'None'`, `dedupe_window_seconds` **NULLABLE**, `default_channels jsonb DEFAULT '["IN_APP"]'`, `recipient_rule_config jsonb`. **GRANT app SELECT-only** (0479:95).
- **`notification_templates`** (`0479:99-154`): `company_id` NULLABLE, `event_id` FK, `channel` DEFAULT `IN_APP`, `locale` DEFAULT `vi-VN`, `title_template`/`body_template` NOT NULL, `target_url_template`, `status` CHECK ∈ `('Draft','Active','Inactive','Archived')`, `is_default`. **GRANT app SELECT-only** (0479:153).
- **`notification_delivery_logs`** (`0479:158-206`): `company_id NOT NULL DEFAULT` GUC, `notification_id` **FK NOT NULL**, `recipient_user_id` FK NOT NULL, `delivery_status` CHECK ∈ `('Pending','Sent','Delivered','Failed','Skipped','Cancelled')`, `attempt_no ≥1`. **APPEND-ONLY: `GRANT SELECT, INSERT` — KHÔNG UPDATE/DELETE** (0479:205, đã xác minh độc lập). **KHÔNG có unique index dedupe.**
- **`notifications` ALTER-ADD** (`0479:214-281`): cột mới `recipient_user_id`, `event_id`, `template_id`, `event_code`, `notification_type`, `priority`, `status`, `title`, `source_entity_*`, `target_*`, `payload jsonb`, `dedupe_key`, `read_at`… **MỌI cột NULLABLE**. **GIỮ legacy NOT NULL**: `user_id`, `type` (DEFAULT 'general'), `body`, `is_read`. CHECK `status IS NULL OR IN ('Unread','Read','Hidden','Archived','Deleted','Failed')`. **Dedupe backstop**: `uq_notifications_dedupe_active` UNIQUE `(company_id, recipient_user_id, event_code, dedupe_key) WHERE dedupe_key IS NOT NULL AND deleted_at IS NULL` (0479:279-281).
- **Seed 0481**: 36 event `is_enabled=true` + 16 event `is_enabled=false`, tất cả `company_id NULL`; 36 template IN_APP/vi-VN cho event enabled. **⚠ Mọi event seed để `dedupe_strategy='None'`, `dedupe_window_seconds=NULL`** (INSERT 0481:47-104 không set 2 cột này ⇒ nhận DEFAULT).

### 2.2 Đã tồn tại gì trong `apps/api/src/notifications`
- `notifications.service.ts` — **service LEGACY** (media-era): `create()` ghi cột legacy `userId/type/body/isRead`, enum lowercase (`packages/contracts/src/notification.ts:3-16`), emit WS qua `RealtimeEmitterService`. **KHÔNG dùng catalog/template/delivery_log.** → BE-2 **KHÔNG viết lại**; thêm engine MỚI song song.
- `notifications.repository.ts` — CRUD legacy. Engine cần method create mới (dual-write).
- `notifications.module.ts` — imports `DatabaseModule, EventsModule, RealtimeEmitterModule`. **EventsModule đã cấp `OutboxService`, `AuditService`, `EventBus`**.
- Drizzle schema 3 bảng mới ĐÃ có (`db/schema/noti.ts`) → **không cần db:generate**.

### 2.3 Outbox / event-bus hiện trạng
- `events/outbox.service.ts:17` — `enqueue(tx, {eventType, payload})` cùng tx nghiệp vụ.
- `events/outbox-worker.ts` — `processBatch()` claim `FOR UPDATE SKIP LOCKED`, gọi `EventBus.consumersFor(eventType)`, idempotency `processed_events`, retry→dead-letter. Consumer nhận `{eventId, companyId, eventType, payload}` (`event-bus.ts:7-15`).
- **Producer TASK chưa có** → BE-2 **KHÔNG** đăng ký consumer theo eventType TASK (INT-1 làm).

### 2.4 Internal-auth hiện trạng (CÓ — reuse, fail-closed)
- **`InternalGuard`** (`permission/guards/internal.guard.ts:18-36`): so `x-internal-key` với `process.env['INTERNAL_API_KEY']`; **env unset → 403 (fail-closed)**. Không log key.
- **`JwtAuthGuard` là APP_GUARD toàn cục** (`app.module.ts:87-89`) → route không `@Public()` sẽ chạy JWT→Company→(2FA) + `InternalGuard` — **hai lớp**. Mẫu đã duyệt: `attendance/attendance-internal.controller.ts:25-42`.
- **⚠ `INTERNAL_API_KEY` KHÔNG có trong `env.schema.ts`** — `InternalGuard` đọc thẳng `process.env` và fail-closed nếu thiếu ⇒ an toàn. **KHÔNG sửa env.schema** (ngoài paths); ghi chú vận hành ở §9.

### 2.5 ⚠ Mâu thuẫn done_when ↔ schema thật (KHÔNG lờ)
1. **Append-only vs "cập nhật trạng thái delivery"**: app chỉ có `SELECT, INSERT` trên `notification_delivery_logs`. ⇒ **CẤM** pattern "INSERT Pending → UPDATE Sent" (DB từ chối `permission denied`). **Giải:** IN_APP ghi **1 INSERT trạng thái terminal `Sent`** ngay; Skipped/Failed cũng INSERT-terminal; retry (job sau) = **INSERT hàng `attempt_no` MỚI**. Không update in-place ⇒ không phá BẤT BIẾN #2.
2. **"Event disabled → delivery_log Skipped" bất khả thi qua FK**: delivery_log cần `notification_id NOT NULL`. Event disabled ⇒ không tạo notification ⇒ **không thể** viết delivery_log. **Giải — phân tầng "Skipped":**
   - **Event-level** (disabled / 0 recipient): KHÔNG notification, KHÔNG delivery_log; ghi **`audit_logs`** (`notification_skipped` + reason) + `skipped_count` trong summary. Deny-path RÕ, không im lặng.
   - **Channel/recipient-level** (sau khi đã có notification): INSERT delivery_log `Skipped` hợp lệ.
   Điểm lệch ghi rõ: done_when nói "event disabled → delivery log Skipped", FK buộc chọn audit-skip cho event-level. **Spec thắng về Ý ĐỊNH (không nuốt lỗi); FK quyết cách GHI.**
3. **Dedupe seed = None**: mọi event seed `dedupe_strategy='None'`. ⇒ dedupe comment/status **không bật out-of-box**. **Giải:** engine đọc catalog làm nguồn chính + **DEFAULT_DEDUPE policy** (const nội bộ) cho `TASK_COMMENT_CREATED`/`TASK_STATUS_CHANGED`, áp dụng CHỈ khi catalog `dedupe_strategy='None'` — catalog override được. Không cần migration.
4. **Legacy NOT NULL cols**: INSERT notification phải set `user_id`(=recipient), `body`(=rendered), `type`(→`'general'`), `is_read=false` cùng cột mới. Quên = INSERT fail. Dual-write Option-A.

---

## 3. Thiết kế trust boundary (CROWN)

| Đường vào | Ngữ cảnh | Xác thực | company_id |
|-----------|----------|----------|-----------|
| `NotificationEngineService.intake()` | **in-process** — outbox worker consumer (INT-1) | trusted-by-construction (worker role, in-tx) | từ `EventContext.companyId` |
| `POST /internal/v1/notifications/events` + `/send` | job/manual/service khác | **JwtAuthGuard (global) → 401 nếu thiếu Bearer** + **`InternalGuard` → 403 nếu thiếu/sai key, hoặc env unset** | **từ `req.user.companyId`** — KHÔNG lấy từ body |

- **Vì sao KHÔNG public:** endpoint tạo notification cho user bất kỳ trong tenant ⇒ rò key = spam/impersonation toàn tenant. Giữ trong chuỗi APP_GUARD ⇒ cần **CẢ** JWT hợp lệ **VÀ** internal key (defense-in-depth).
- **company_id spoof-proof:** engine `withTenant(req.user.companyId)`. Body có `company_id` khác token → **reject 400**. RLS FORCE đảm bảo recipient company khác **vô hình** (resolve 0 row).
- **Chặn SSRF / target-URL ngoài:** `target_url` PHẢI khớp `^/(?!/)[\w\-./?=&%#]*$` — bắt đầu `/`, không scheme (`http:`/`javascript:`/`data:`), không `//`, không `\`. Ngoài whitelist → **422 `NOTI-ERR-TARGET-UNAVAILABLE`** (loud), không âm thầm strip.
- **Ban payload nhạy cảm:** từ chối payload chứa key ∈ `{password, token, salary, bank_account, identity_number, private_file_url}` hoặc comment > N ký tự → **400 `NOTI-ERR-TEMPLATE-VARIABLE-INVALID`**.
- **Secret:** `INTERNAL_API_KEY` từ env, không log, không vào DTO/response.

---

## 4. Lanes (theo domain + thứ tự phụ thuộc)

Một WO tuần tự (không fan-out). Không có migration lane.

| lane | nội dung | file | phụ thuộc |
|------|----------|------|-----------|
| L0 contracts | DTO intake/send + enum TitleCase + summary | `packages/contracts/src/notification.ts` | — |
| L1 repos | event/template/delivery-log repo + engine-create notification (dual-write) | `apps/api/src/notifications/notification-{event,template,delivery-log}.repository.ts`, sửa `notifications.repository.ts` | L0 |
| L2 engine | resolver + renderer + dedupe + `NotificationEngineService` | `notification-{recipient-resolver,renderer,dedupe,engine}.service.ts` | L1 |
| L3 http | `InternalNotificationsController` + module wiring | `internal-notifications.controller.ts`, `notifications.module.ts` | L2 |
| L4 test | int-spec RED-trước (deny đầu) | `apps/api/test/integration/noti-event-intake.int-spec.ts` | viết RED trước L1–L3 |

Reviewer: `security-reviewer` + `silent-failure-hunter` (FULL, trust boundary) + `database-reviewer` (append-only/RLS) + `typescript-reviewer` + `plan-reviewer` (plan này trước code).

---

## 5. Steps

1. **L4 RED trước** — viết `noti-event-intake.int-spec.ts` với 8 nhóm (a–h §8), chạy phải ĐỎ. Gate `hasDb && Boolean(process.env.LANE_DB)`.
2. **L0** — thêm vào `contracts/notification.ts` (ADDITIVE, không sửa `notificationSchema` legacy):
   - `notificationTypeEnumSchema` TitleCase = `['System','Account','HR','Attendance','Leave','Task','Project','Approval','Reminder','Warning','Error']` (khớp CHECK 0479:64-65).
   - `notificationPrioritySchema` = `['Low','Normal','High','Urgent','Critical']`.
   - `internalEventIntakeSchema` (event_code, actorUserId?, sourceModule, sourceEntityType?, sourceEntityId?, dedupeKey?, recipient:{mode,userIds[],employeeIds[]}, payload, priorityOverride?, channelsOverride?, occurredAt?) — mirror API-07 §16.1.
   - `internalDirectSendSchema` (recipientUserId, title, content, notificationType, priority, sourceModule, eventCode, target*, payload, channels[], dedupeKey?) — mirror §16.2. **KHÔNG có company_id trong body.**
   - `intakeSummarySchema` (createdNotificationCount, skippedCount, dedupedCount, batchKey?).
3. **L1 repos** (mỗi file <400 dòng):
   - `notification-event.repository.ts`: `findEnabledEvent(tx, companyId, eventCode)` — company-override rồi global, `is_enabled=true`, `deleted_at IS NULL`.
   - `notification-template.repository.ts`: `findActiveTemplate(tx, eventId, channel, locale)` — status='Active', company-override>global, is_default fallback.
   - `notification-delivery-log.repository.ts`: `insertLog(tx, {...terminalStatus})` — **CHỈ INSERT**. `findRecent(...)` cho test.
   - `notifications.repository.ts`: thêm `createFromEngine(tx, row)` dual-write legacy+new; bắt unique-violation `uq_notifications_dedupe_active` → ném `DedupeConflict` (engine đếm, không lộ 500).
4. **L2 engine**:
   - `notification-recipient-resolver.service.ts`: `resolve(tx, companyId, event, intake)` → `recipientUserId[]`. Modes `UserIds` / `EmployeeIds` (join employee_profiles→active user) / `ManagerOfEmployee` (HR manager-tree, S2-INT-2). Lọc user active/không locked/không deleted. **Actor-exclusion**: bỏ `intake.actorUserId` **TRỪ** `event.is_system_event=true`.
   - `notification-renderer.service.ts`: `render(template|null, payload)` — thay `{var}`; **template missing/inactive → fallback** (title=`event_name`, `metadata.reason='template_fallback'`, cờ `fallback=true` để log WARN — KHÔNG im lặng); validate target_url + ban key nhạy cảm.
   - `notification-dedupe.service.ts`: `computeKey(event, intake, recipientUserId)` + `isDuplicate(tx, ...)`.
   - `notification-engine.service.ts`: orchestrate trong 1 `withTenant`; ghi audit; emit WS qua DTO đã mask (KHÔNG raw row); trả `intakeSummary`.
5. **L3 http**: `internal-notifications.controller.ts` — `@Controller("internal/v1/notifications")` `@UseGuards(InternalGuard)` (JwtAuthGuard/CompanyGuard đã global) `@UsePipes(ZodValidationPipe)`; 2 route POST; `companyId=req.user.companyId`, reject mismatch. Wire providers vào `notifications.module.ts` (khối additive).
6. **L4 GREEN**: `bash scripts/lane-db-setup.sh notibe2` → `export LANE_DB=mediaos_notibe2` → `pnpm --filter @mediaos/api test`.
7. **Gate FULL** → checkpoint.

---

## 6. Pipeline engine

```
intake(companyId, event) → withTenant(companyId):
 1. validate DTO (Zod) + target_url nội bộ + ban key nhạy cảm      → 400/422 (loud)
 2. findEnabledEvent(companyId, event_code)
      • not found  → NOTI-ERR-EVENT-NOT-FOUND (404) [HTTP] / audit-skip [consumer]
      • disabled   → NO notification, NO delivery_log; audit 'notification_skipped'
                     reason='event_disabled'; summary.skipped_count++      (nuance §2.5-2)
 3. resolveRecipients() → userIds[]
      • actor-exclusion: drop actorUserId UNLESS event.is_system_event
      • filter active/same-company (RLS → cross-tenant user vô hình)
      • empty → audit-skip reason='no_recipient'; skipped_count++
 4. for each recipient:
      a. dedupe: computeKey + isDuplicate(window) → deduped_count++, continue
      b. findActiveTemplate(eventId,'IN_APP',locale) → render()
           • missing/inactive → fallback default (fallback=true, non-silent)
      c. createFromEngine(dual-write legacy+new, status='Unread', dedupe_key, source_entity_*, target_*)
           • unique-violation uq_notifications_dedupe_active → treat as deduped (race backstop)
      d. insertLog(channel='IN_APP', delivery_status='Sent', attempt_no=1, sent_at=now)  ← INSERT-terminal
              if fallback → metadata.reason='template_fallback' (loud)
      e. audit 'notification_created'
      f. emit WS via masked DTO (best-effort, no raw row)
 5. return summary{ created, skipped, deduped, batch_key }
```

### Actor-exclusion + ngoại lệ system-mandatory
Loại `actorUserId` khỏi recipients. **Ngoại lệ:** `is_system_event=true` (SYSTEM_*/DASH_WIDGET_ERROR, seed 0481:85-86,99-103) ⇒ KHÔNG loại.

### Dedupe key + window — ép ở đâu
- **Cấu hình:** `event.dedupe_strategy` + `dedupe_window_seconds`. Fallback `DEFAULT_DEDUPE` (const) cho `TASK_COMMENT_CREATED`/`TASK_STATUS_CHANGED` khi catalog='None', window 300s.
- **Key:**
  - `TimeWindow` → `{event_code}:{source_entity_id}:{recipientUserId}:{floor(epoch/window)}` (bucket) ⇒ trùng trong bucket bị chặn, sang bucket mới cho qua.
  - `EntityRecipient`/`DedupeKey` (once-ever) → key ổn định không bucket.
  - `None` (và ngoài DEFAULT) → không set dedupe_key ⇒ không dedupe.
- **Ép 2 tầng:** (1) app query `isDuplicate`. (2) **Race backstop DB**: partial-unique `uq_notifications_dedupe_active` — 2 intake đồng thời cùng key ⇒ INSERT thứ 2 unique-violation ⇒ engine bắt → `deduped_count++` (KHÔNG 500). Không dựa read-then-write.

### Failure taxonomy (KHÔNG nuốt lỗi)
| Tình huống | Xử lý | Ghi nhận |
|-----------|-------|----------|
| Event disabled | skip toàn bộ | audit `notification_skipped` + skipped_count (KHÔNG delivery_log — FK) |
| Không resolve recipient | skip | audit reason='no_recipient' + skipped_count |
| Recipient inactive/locked | loại recipient đó | delivery_log `Skipped` per-recipient |
| Template missing/inactive | **fallback default** | notification + delivery_log `Sent` với `metadata.reason='template_fallback'` (loud) |
| Dedupe hit | skip recipient đó | deduped_count |
| target_url ngoài / payload nhạy cảm | **reject** cả request | 422/400 loud |
| DB unique race | coi như deduped | không throw ra client |

Mã lỗi verbatim SPEC-08 §19: `NOTI-ERR-EVENT-NOT-FOUND`(404) · `NOTI-ERR-EVENT-DISABLED`(422) · `NOTI-ERR-TEMPLATE-NOT-FOUND`(404) · `NOTI-ERR-TEMPLATE-VARIABLE-INVALID`(400) · `NOTI-ERR-RECIPIENT-NOT-FOUND`(422) · `NOTI-ERR-RECIPIENT-INACTIVE`(422) · `NOTI-ERR-DEDUPE-CONFLICT`(409) · `NOTI-ERR-TARGET-UNAVAILABLE`(422). Authz → `AUTH-ERR-FORBIDDEN`.

---

## 7. acceptanceChecks[]

1. `POST /internal/v1/notifications/events` không Bearer → **401**; có JWT nhưng thiếu/sai `x-internal-key` → **403**; env `INTERNAL_API_KEY` unset → **403** (fail-closed).
2. Intake `TASK_ASSIGNED` (seeded enabled + template), `recipient.mode=UserIds=[u]` → **đúng 1** `notifications` (status='Unread', legacy `user_id`/`body`/`is_read` set) + **đúng 1** `notification_delivery_logs` (`IN_APP`, `Sent`, `attempt_no=1`). Summary `created=1`.
3. `actorUserId=u` ∈ recipients, event non-system → **u KHÔNG có notification**; event `is_system_event=true` → u CÓ.
4. 2 intake `TASK_COMMENT_CREATED` cùng `source_entity_id` + recipient trong window → **created=1, deduped=1**; sang bucket kế → tạo notification MỚI.
5. Recipient thuộc company khác → **KHÔNG** tạo; `body.company_id ≠ token.company_id` → **400**.
6. Event `is_enabled=false` → **0 notification, 0 delivery_log**, có `audit_logs` `notification_skipped`, summary `skipped≥1`, **KHÔNG 500**.
7. Template inactive/thiếu → notification **fallback** + dấu vết non-silent. KHÔNG giống bản render bình thường, KHÔNG im lặng.
8. `target_url='https://evil.com'` (hoặc `//evil`, `javascript:`) → **422**, 0 notification. `payload.salary` → **400**.
9. Engine KHÔNG bao giờ UPDATE `notification_delivery_logs` (chỉ INSERT).
10. `pnpm --filter @mediaos/api typecheck` + contracts build xanh; `check.sh` (TURBO_FORCE=1) xanh; FULL gate PASS.

---

## 8. testTasks[] — RED TRƯỚC, deny-path ĐI ĐẦU

**File:** `apps/api/test/integration/noti-event-intake.int-spec.ts` (vitest include `test/**/*.int-spec.ts` — `apps/api/vitest.config.ts:47`).

**Gate cứng** (chống false-red — `.env` làm `hasDb=true` nên `skipIf(!hasDb)` là chưa đủ):
```ts
import { directPool, hasDb } from "../helpers/integration-db";
const runDb = hasDb && Boolean(process.env.LANE_DB);
describe.skipIf(!runDb)("S4-NOTI-BE-2 event intake engine (DB cô lập)", () => { ... });
```
Bootstrap Nest app thật (JwtAuthGuard→CompanyGuard→InternalGuard→controller), seed company + users (actor, recipient, recipient-company-B) qua `directPool`, set `process.env.INTERNAL_API_KEY`.

Thứ tự (deny đầu):
- **(a) untrusted context** — không token → 401; thiếu `x-internal-key` → 403; sai key → 403; env unset → 403.
- **(b) dedupe** — cùng entity+recipient 2 lần trong window → created=1/deduped=1; bucket kế → tạo mới.
- **(c) actor-exclusion** — actor ∈ recipients, non-system → 0 notification cho actor; `is_system_event=true` → có.
- **(d) cross-tenant** — recipient company B → không tạo; `body.company_id=B`, token=A → 400.
- **(e) event disabled** — 0 notification, 0 delivery_log, có audit `notification_skipped`, KHÔNG 500.
- **(f) template missing** — notification fallback + dấu vết non-silent (assert `metadata.reason` / delivery status ≠ path thường).
- **(g) target ngoài** — `target_url` external/`javascript:` → 422; payload chứa `salary`/`token` → 400.
- **(h) happy-path** — TASK_ASSIGNED UserIds → 1 notification (legacy+new cols) + 1 delivery_log `Sent`.

Chạy: `bash scripts/lane-db-setup.sh notibe2` → `export LANE_DB=mediaos_notibe2` → `pnpm --filter @mediaos/api test`.

---

## 9. Rủi ro & landmine

- **False-green test**: quên gate `LANE_DB` → int-spec skip âm thầm ⇒ xanh-giả. DB chung thiếu band 0479–0481 → đỏ-giả.
- **Append-only vi phạm**: bất kỳ `UPDATE notification_delivery_logs` từ app role → runtime `permission denied`. Engine chỉ INSERT-terminal.
- **Quên legacy NOT NULL** (`user_id`/`body`/`type`/`is_read`) → INSERT fail toàn bộ.
- **company_id từ body** thay vì token → cross-tenant spoof. Luôn `req.user.companyId`.
- **`@Public()` nhầm** trên internal controller → mất lớp JWT. KHÔNG `@Public`.
- **Dedupe read-then-write race** không backstop → double notification. Dựa partial-unique index, bắt unique-violation.
- **Seed dedupe='None'**: nếu chỉ đọc catalog thì dedupe comment/status không bật ⇒ done_when 2 fail. Dùng `DEFAULT_DEDUPE` const (catalog-overridable). Không thêm migration.
- **Consumer trùng eventType**: KHÔNG đăng ký consumer TASK ở BE-2 (INT-1 làm) — tránh double-consume + `consumerName` trùng.
- **enum lẫn lộn**: legacy lowercase vs mới TitleCase. Thêm enum MỚI, giữ legacy.
- **`INTERNAL_API_KEY` thiếu ở `.env`** → route 403 toàn bộ (fail-closed, đúng ý) nhưng có thể gây "im lặng không gửi". Set key khi bật route; đường in-process (INT-1) KHÔNG cần key.
- **Realtime masking**: emit WS PHẢI qua DTO đã mask (CLAUDE.md §5); cấm `io.emit` raw row.
- **File >800 dòng**: tách engine/resolver/renderer/dedupe (≤400 dòng/file).

---

## 10. Definition of Done

- `NotificationEngineService.intake()` + `InternalNotificationsController` hoạt động: catalog→resolver(actor-exclusion)→dedupe→render(fallback)→persist notification IN_APP + delivery_log terminal; **độc lập producer TASK**.
- Trust boundary fail-closed: no-JWT→401, no/sai key→403, env unset→403; company_id từ token; cross-tenant recipient không tạo.
- Dedupe window + backstop unique-index; actor-exclusion + ngoại lệ system; disabled→audit-skip; template-missing→fallback non-silent; target ngoài→reject. KHÔNG nuốt lỗi.
- Append-only tôn trọng; `withTenant` mọi query; audit hành động quan trọng; secret không log.
- Contracts additive dual-build; int-spec RED-trước (a–h) xanh dưới `LANE_DB`; typecheck + `check.sh` (TURBO_FORCE=1) xanh.
- **FULL gate** `security-reviewer` + `silent-failure-hunter` + `database-reviewer` + `plan-reviewer` PASS.
- Cập nhật `harness/backlog.mjs` (status done). Migration: **không** (head giữ 0482).
