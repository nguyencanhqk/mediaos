# Plan S4-INT-1 — Outbox TASK/PROJECT → NOTI intake IN-PROCESS bridge

> Zone crown/FULL gate (permission/audit-adjacent event wiring, KHÔNG đụng DB schema). Zero-migration.
> Trạng thái: implement + verify xong trong lane `int1Bridge` (worktree `../mediaos-s4-int-1`, branch `auto/S4-INT-1`).

## 1. Phạm vi

Nối 8 mã event TASK/PROJECT (SPEC-06 §19 Producer) đã/chưa phát từ outbox sang `NotificationEngineService.intake()`
**IN-PROCESS** (không qua HTTP `/internal/v1/notifications/events`) — caller thứ 3 sau `TaskReminderJobHandler`
(S4-NOTI-BE-3) và `AttendanceLeaveSyncService` (S3-INT-1), cùng pattern `EventBus` consumer đăng ký ở
`OnModuleInit`.

8 mã: `TASK_ASSIGNED · TASK_ASSIGNEE_CHANGED · TASK_STATUS_CHANGED · TASK_PRIORITY_CHANGED ·
TASK_DUE_DATE_CHANGED · TASK_COMMENT_CREATED · TASK_MENTIONED · PROJECT_MEMBER_ADDED`. 7/8 producer đã tồn tại
(S4-TASK-BE-3/4); `PROJECT_MEMBER_ADDED` THIẾU — vá trong `ProjectsService.addMember`.

## 2. Kiến trúc

- **`OutboxNotificationBridge`** (`notifications/outbox-notification-bridge.service.ts`) — lõi GENERIC,
  module-agnostic. `registerSource(mapping)` fail-loud tại boot nếu `eventCode ∉ NOTI_EVENT_CATALOG
  (is_enabled=true)`. Handler: gom recipient thô → `dedupe + filter(Boolean)` → build
  `InternalEventIntakeDto` → `engine.intake(companyId, dto)`. KHÔNG tự lọc actor (engine lo, tránh lặp logic
  2 nơi). Lỗi: log rồi RE-THROW (OutboxWorker retry/dead-letter, mirror `attendance.module.ts:70`).
- **`TaskAudienceReader`** (`notifications/task-audience.reader.ts`) — raw SQL `tasks` + `task_watchers JOIN
  employee_profiles`, `withTenant` + `company_id` bind tường minh. Trả `{assigneeUserId, creatorUserId,
  watcherUserIds[]}` THEO TRẠNG THÁI HIỆN TẠI (đọc lại sau khi producer đã commit) — KHÔNG dựa payload rời
  rạc (payload comment mang `assigneeEmployeeId` là EMPLOYEE id, không phải user_id).
- **`TaskNotiBridgeRegistrar`** (`notifications/task-noti-bridge.registrar.ts`, `OnModuleInit`) — đăng ký 8
  mapping. Import CHỈ từ `notifications/**` + `db/**` — KHÔNG import `TasksModule` (acyclic, mirror
  `TaskReminderJobHandler`).

Recipient theo mapping (đối chiếu WO/nghiệm thu):

| event_code | recipient |
| --- | --- |
| TASK_ASSIGNED | assignee mới |
| TASK_ASSIGNEE_CHANGED | assignee mới ∪ watcher (KHÔNG assignee cũ — audience đọc SAU đổi) |
| TASK_STATUS_CHANGED | reporter(creator) ∪ assignee ∪ watcher |
| TASK_PRIORITY_CHANGED | assignee ∪ watcher |
| TASK_DUE_DATE_CHANGED | assignee ∪ watcher |
| TASK_COMMENT_CREATED | assignee ∪ reporter(creator) ∪ watcher |
| TASK_MENTIONED | mentionedUserIds (đọc thẳng payload — producer đã resolve) |
| PROJECT_MEMBER_ADDED | memberUserId (đọc thẳng payload) |

Actor-exclusion: bridge truyền nguyên `actorUserId` từ payload; `NotificationRecipientResolverService`
(engine) tự loại — KHÔNG lặp logic ở bridge.

## 3. Producer gap vá — `ProjectsService.addMember`

Inject `OutboxService` (đã export từ `@Global EventsModule`, `TasksModule` đã import). Thêm 1 khối
`outbox.enqueue(tx, {eventType:'project.member_added', payload:{eventCode, projectId, memberEmployeeId,
memberUserId, actorUserId}})` NGAY SAU activity+audit, TRONG tx `addMember` hiện có. `emp.userId` đã
fail-loud non-null (`ERR.MEMBER_NO_ACCOUNT`) TRƯỚC điểm chèn — an toàn truyền thẳng. Additive, KHÔNG đổi
chữ ký `addMember`.

## 4. Idempotency — `notification-dedupe.const.ts`

APPEND 6 khoá `strategy:'DedupeKey'` (dedupeKey mặc định = `ctx.eventId`, ổn định qua mọi lần re-consume của
CÙNG outbox event): `TASK_ASSIGNED · TASK_ASSIGNEE_CHANGED · TASK_PRIORITY_CHANGED · TASK_DUE_DATE_CHANGED ·
TASK_MENTIONED · PROJECT_MEMBER_ADDED`. GIỮ NGUYÊN `TASK_STATUS_CHANGED`/`TASK_COMMENT_CREATED` =
`TimeWindow(300s)` (đã có từ S4-NOTI-BE-3, chống spam trong-cửa-sổ). Bảo vệ 2 TẦNG cùng
`OutboxWorker.processed_events` (tầng 1, theo `consumer_name+event_id`): nếu event bị re-claim mà
processed_events mất dấu (crash giữa insert↔markProcessed), tầng NÀY (partial-unique
`uq_notifications_dedupe_active`) vẫn chặn tạo notification trùng — verify ở test (15) 2 tầng độc lập.

## 5. Wiring — `notifications.module.ts`

APPEND 3 provider (`OutboxNotificationBridge`, `TaskAudienceReader`, `TaskNotiBridgeRegistrar`) vào
`providers[]`. KHÔNG đụng `exports[]`/`controllers[]`. Zero-migration (head giữ nguyên 0492).

## 6. Test — `test/integration/task-noti-e2e.int-spec.ts` (16 test + boot-guard standalone)

RED-trước xác nhận: tắt tạm `TaskNotiBridgeRegistrar` khỏi `providers[]` → 12/16 test đỏ (4 test còn lại
xanh vì assert PHỦ ĐỊNH — mention-403/no-outbox, boot-guard chạy độc lập không cần DB). Bật lại → 16/16 xanh
(GREEN). Regression: `noti-event-intake.int-spec.ts` (20) + `noti-seed-catalog-permissions.int-spec.ts` (151)
+ `task-actions.int-spec.ts` (26) + `task-projects.int-spec.ts` (28) + `task-comments-checklists.int-spec.ts`
(10) + `task-reminder-job.int-spec.ts` (5) — 240/240 xanh trên cùng `LANE_DB=mediaos_int1`.

## 7. Việc còn nợ (ngoài phạm vi lane này)

- `PROJECT_MEMBER_REMOVED`/`PROJECT_CLOSED` (is_enabled=false trong catalog) — chưa có producer, chưa wire
  bridge (boot-guard đã chứng minh registerSource sẽ fail-loud nếu ai wire nhầm trước khi catalog bật).
- `TASK_DUE_SOON`/`TASK_OVERDUE` đã có bridge riêng (`TaskReminderJobHandler`, S4-NOTI-BE-3) — KHÔNG trùng
  lặp với lane này.
