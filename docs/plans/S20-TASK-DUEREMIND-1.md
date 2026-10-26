# S20-TASK-DUEREMIND-1 — plan v1

> Nhắc sắp đến hạn/quá hạn chạy đúng cho việc SPEC-06 (quá hạn báo cả người giao việc) + chủ/quản lý dự án được báo khi việc vào Chờ duyệt.
> Zone 🟡 · gate FULL (chạm outbox/NOTI) · đo trên `3970b82a` · KHÔNG migration · KHÔNG đổi engine/index NOTI.
> Story: `docs/plans/S20-WORKUX-STORIES.md` US-TASK-NV-06 (gộp QL-02) + US-TASK-QL-09 · SPEC-06 §14.17, NOTI-EVENT-004/005.

## §1 done_when ↔ cách làm

| #   | done_when                                                                                                                                        | Cách làm                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `queryDue` đọc `due_at`/`task_status` + `main_assignee_employee_id`→`user_id`, giữ nhánh `assignee_user_id`, 24h, office, chưa xoá, `withTenant` | Viết lại truy vấn (raw SQL, tệp mới `task-reminder.job-handler.query.ts`); vị từ «mở» chép đúng định nghĩa `isOverdue` của task-core |
| 2   | Dedupe theo (việc, sự kiện, mốc `due_at`); `TASK_OVERDUE` → phụ trách ∪ reporter/người tạo                                                       | `dedupeKey = <taskId>:<due_at ISO>`; lọc trước người nhận đã TỪNG nhận (kể cả hàng đã xoá mềm); người nhận gộp không trùng           |
| 3   | Lỗi một việc không chặn việc khác; metadata ghi đúng failed                                                                                      | Giữ `try/catch` mỗi (việc, sự kiện); metadata thêm số bị bỏ do lookback + số đã nhắc                                                 |
| 4   | `TASK_STATUS_CHANGED` → In Review của việc thuộc dự án ⇒ + Owner/Manager còn hiệu lực                                                            | `TaskAudienceReader.projectReviewerUserIds()` đọc trong `withTenant`; registrar thêm khi `toStatus === 'In Review'`                  |
| 5   | Int-spec `LANE_DB`, tạo việc qua task-core, cross-tenant                                                                                         | Viết lại `task-reminder-job.int-spec.ts` qua `applyMainPipeline` + spec mới `s20-task-review-audience.int-spec.ts`                   |

## §2 Đo trên `3970b82a`

- [ĐO] `task-reminder.job-handler.ts:108-131` lọc `tasks.dueDate` (cột `due_date`), `assigneeUserId`, `ne(status,'completed')` (cột legacy `status`); `:148` `dedupeKey = <taskId>:<YYYY-MM-DD>`; `:149` người nhận chỉ assignee.
- [ĐO] Task-core ghi `due_at` chứ không ghi `due_date`: `task-core.repository.ts:666-680` (insert), `task-actions.repository.ts:196` (đổi hạn). Cột legacy `status` giữ DEFAULT `'not_started'` ⇒ điều kiện `ne(status,'completed')` luôn đúng với việc SPEC-06, còn `isNotNull(due_date)` loại hết ⇒ việc SPEC-06 **không bao giờ** được nhắc.
- [ĐO] Không migration nào backfill `due_at` từ `due_date` (grep `migrations/*.sql`). Không controller nào gọi `TasksService.createTask` (đường legacy ghi `due_date`, `tasks.repository.ts:242-259`).
- [ĐO] Định nghĩa quá hạn của task-core: `due_at is not null and due_at < now() and (task_status is null or task_status not in ('Done','Cancelled'))` — `task-core.repository.ts:218-219, 396-397`.
- [ĐO] Index `idx_tasks_assignee_status_due (company_id, main_assignee_employee_id, task_status, due_at) WHERE deleted_at IS NULL` + `idx_tasks_overdue_candidate` — `0478:373-381` ⇒ không cần migration.
- [ĐO] Task-core tạo việc: `reporterEmployeeId = actorEmp.id`, `creatorUserId = user.id` (`task-core.service.ts:543,547`); ghi `assignee_user_id` đồng thời với `main_assignee_employee_id`.
- [ĐO] Dedupe tầng 1 `notification-dedupe.service.ts:102-116` lọc `isNull(deletedAt)`; tầng 2 `uq_notifications_dedupe_active ... WHERE dedupe_key IS NOT NULL AND deleted_at IS NULL` (`0479:279-281`) ⇒ người dùng xoá mềm thông báo thì lượt job sau phát lại.
- [ĐO] Khoá dedupe chiến lược `DedupeKey` = `<eventCode>:<dedupeKey>` (`notification-dedupe.service.ts:75-77`), không phụ thuộc người nhận; tầng 1/2 xét theo từng `recipient_user_id`.
- [ĐO] Resolver người nhận: gộp `Set`, lọc user active cùng công ty, loại actor (`notification-recipient-resolver.service.ts:38-54`).
- [ĐO] `task.status_changed` payload có `taskId`, `projectId`, `fromStatus`, `toStatus`, `actorUserId` (`task-actions.service.ts:276-284, 721-735`). Kéo cột cùng nhóm: `statusChanges=false` ⇒ không gọi `changeStatusTx` ⇒ không có sự kiện (`task-core.service.ts:931,959-969`).
- [ĐO] Thành viên dự án «còn hiệu lực»: `member_status='Active' and deleted_at is null` + `project_role in ('Owner','Manager')` (`task-core.repository.ts:339-348`, `project-access.service.ts:70-83`); `project_members.user_id` NOT NULL (`0478:290-292`); gỡ thành viên ghi `memberStatus='Removed'` (`projects.repository.ts:771`).
- [ĐO] Engine ghi cả `user_id` legacy = người nhận (`notification-engine.service.ts:186` → repo `userId: recipientUserId`); `notifications_user_id_idx (user_id)` không partial ⇒ đọc được cả hàng đã xoá mềm qua index.
- [ĐO] Spec cũ `task-reminder-job.int-spec.ts:40-60,111-113` insert cột legacy và tự dựng pipeline; ratchet `pipeline-parity.unit-spec.ts:29` `HAND_ROLLED_BASELINE = 269`.

## §3 Thiết kế

**Truy vấn ứng viên** (một `withTenant(companyId)` cho toàn bộ phần đọc, `company_id` bind tường minh):

- Vị từ chung: `tk.company_id = $c and tk.task_type = 'office' and tk.deleted_at is null and tk.due_at is not null and (tk.task_status is null or tk.task_status not in ('Done','Cancelled')) and (tk.main_assignee_employee_id is not null or tk.assignee_user_id is not null)`.
- Người phụ trách: `coalesce(ea.user_id, tk.assignee_user_id)` với `left join employee_profiles ea on ea.id = tk.main_assignee_employee_id and ea.company_id = $c and ea.deleted_at is null and ea.status = 'active'` (cùng điều kiện resolver dùng cho EmployeeIds).
- Reporter/người tạo (Q6 = B): `coalesce(er.user_id, tk.creator_user_id)` với join tương tự trên `reporter_employee_id`. [SUY RA] Lúc tạo hai giá trị là cùng một người; `coalesce` phủ hàng chỉ có `creator_user_id`.
- `TASK_DUE_SOON`: `due_at >= now and due_at <= now + 24h` → người phụ trách (SPEC-06 §14.17).
- `TASK_OVERDUE`: `due_at < now and due_at >= now - OVERDUE_LOOKBACK_MS` → phụ trách ∪ reporter, khử trùng trong job (resolver cũng khử).
- Quyết định owner 26/10: `OVERDUE_LOOKBACK_MS = 7 * DAY_MS` (hằng số đặt tên). Đếm `overdueSkippedByLookback` = cùng vị từ nhưng `due_at < now - lookback` ⇒ ghi metadata, không nuốt im lặng.

**Dedupe (việc, sự kiện, mốc hạn)** — không đổi engine/index:

- `dedupeKey = <taskId>:<due_at.toISOString()>` ⇒ chạy nhiều lần cùng mốc = 1 bản; đổi hạn ⇒ khoá mới ⇒ nhắc lại.
- Bẫy xoá mềm: trước khi gọi `intake`, job đọc một lần `notifications` (KHÔNG lọc `deleted_at`) theo `company_id`, `event_code in (TASK_DUE_SOON, TASK_OVERDUE)`, `recipient_user_id = any(...)`, `dedupe_key = any(...)`; khoá đầy đủ lấy từ `NotificationDedupeService.computeKey` (một nguồn định dạng khoá). Người nhận đã có hàng (còn hay đã xoá) bị bỏ; còn 0 người ⇒ không gọi `intake`, đếm `alreadyReminded`.
- Chọn cách này thay vì sửa tầng 1 của engine: phạm vi chỉ hai mã do job phát, không đổi hành vi dedupe của mọi sự kiện khác. Sổ nhắc riêng = bảng mới = migration ⇒ loại.
- Tầng 2 giữ nguyên làm lưới chống đua giữa hai lượt chạy.

**Cô lập lỗi**: phần đọc lỗi ⇒ job ném (lỗi hệ thống, JobRunner ghi thất bại). Mỗi (việc, sự kiện) gọi `intake` trong `try/catch` riêng ⇒ `failed++`, log có taskId, việc khác vẫn chạy. Metadata: `dueSoonCount, overdueCount, overdueSkippedByLookback, alreadyRemindedCount`.

**Review audience (done_when 4)**:

- `TaskAudienceReader.projectReviewerUserIds(tx, companyId, taskId)`: `select distinct pm.user_id from tasks tk join project_members pm on pm.company_id = $c and pm.project_id = tk.project_id where tk.id = $t and tk.company_id = $c and tk.deleted_at is null and tk.project_id is not null and pm.member_status = 'Active' and pm.deleted_at is null and pm.project_role in ('Owner','Manager')`.
- Registrar `TASK_STATUS_CHANGED`: nếu `toStatus === 'In Review'` ⇒ gộp thêm danh sách trên vào audience hiện tại (đọc trong cùng `withTenant` của `audienceOf`); trạng thái khác/không dự án ⇒ y như cũ. Actor do engine loại; trùng người do resolver gộp.

**Tệp ≤ 800 dòng**: handler giữ điều phối (~150 dòng), SQL tách sang `task-reminder.job-handler.query.ts`; không chạm `task-core.*` / `task-actions.*`.

## §4 Bảng ca

Int-spec chạy lane `mediaos_w26b`, dựng app qua `applyMainPipeline`, tạo việc bằng `POST /api/v1/tasks` (task-core, `dueAt` quá khứ được phép — contracts `task.ts:602,618`), đổi hạn qua route change-deadline. UUID chỉ `randomUUID()`.

**`task-reminder-job.int-spec.ts` (viết lại)**

| Ca                                                                                                     | Loại           | Kỳ vọng                                            | Đỏ trên mã cũ vì                 |
| ------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------------------------- | -------------------------------- |
| R1 việc office, phụ trách NV, `due_at` +2h, Todo                                                       | RED            | 1 `TASK_DUE_SOON` cho NV                           | job đọc `due_date` = NULL        |
| R2 `due_at` −2h, reporter ≠ phụ trách                                                                  | RED            | 1 `TASK_OVERDUE` cho NV + 1 cho reporter           | như R1 + người nhận chỉ assignee |
| R3 chạy job 3 lần                                                                                      | RED            | vẫn 1 bản/người                                    | R1/R2 chưa phát                  |
| R4 xoá mềm `TASK_OVERDUE` của NV qua API của NV → chạy lại                                             | RED (bắt buộc) | 0 bản mới                                          | tầng 1/2 bỏ qua hàng đã xoá      |
| R5 đổi hạn sang mốc quá hạn khác → chạy lại                                                            | RED            | thêm đúng 1 bản/người                              | khoá theo ngày                   |
| R6 Done · Cancelled · xoá mềm · không hạn · không phụ trách · `due_at` +3 ngày · task_type khác office | ALLOW-cạnh     | 0 bản                                              | (giữ hành vi)                    |
| R7 `due_at` −8 ngày                                                                                    | RED            | 0 bản, metadata `overdueSkippedByLookback ≥ 1`     | trường chưa có                   |
| R8 phụ trách = reporter                                                                                | ALLOW          | đúng 1 bản                                         | —                                |
| R9 nhánh legacy: task-core rồi đặt `main_assignee_employee_id = NULL` (còn `assignee_user_id`)         | ALLOW          | vẫn nhắc user đó                                   | —                                |
| R10 engine ném ở 1 việc (spy)                                                                          | RED            | việc khác vẫn có bản; `failed = 1`, `success` đúng | (kiểm metadata mới)              |
| X1 công ty B có việc quá hạn; chạy cho A                                                               | cross-tenant   | 0 hàng `notifications` của B; người B không nhận   | —                                |

**`s20-task-review-audience.int-spec.ts` (mới)** — dự án P: Owner QL1 (cũng là người tạo việc), Manager QL2, Member NV; drain outbox bằng `drainOutboxUntilSettled` + `acquireOutboxWorkerLock`.

| Ca                                                  | Loại         | Kỳ vọng                                                      |
| --------------------------------------------------- | ------------ | ------------------------------------------------------------ |
| A1 NV đổi trạng thái → In Review                    | RED          | QL1, QL2 nhận `TASK_STATUS_CHANGED`; NV (actor) không        |
| A2 NV kéo sang cột nhóm review                      | RED          | như A1                                                       |
| A3 kéo giữa hai cột cùng nhóm review                | ALLOW-cạnh   | 0 bản mới                                                    |
| A4 QL2 đã bị gỡ khỏi P                              | RED-cạnh     | QL2 không nhận                                               |
| A5 QL1 vừa người tạo vừa Owner                      | ALLOW        | QL1 đúng 1 bản                                               |
| A6 trạng thái khác (In Progress) / việc không dự án | ALLOW-cạnh   | người nhận như cũ (creator ∪ assignee ∪ watchers), không QL2 |
| X2 công ty B có Owner trùng tên dự án               | cross-tenant | không người nào của B trong người nhận                       |

Unit `task-reminder.job-handler.spec.ts`: định dạng khoá, gộp người nhận, cô lập lỗi + metadata (engine giả).

## §5 Tệp đổi

Trong `paths`: `apps/api/src/notifications/task-reminder.job-handler.ts` · `task-reminder.job-handler.query.ts` (mới) · `task-reminder.job-handler.spec.ts` (mới) · `task-audience.reader.ts` · `task-noti-bridge.registrar.ts` · `apps/api/test/integration/task-reminder-job.int-spec.ts` · `apps/api/test/integration/s20-task-review-audience.int-spec.ts` (mới) · plan này.

pathsNeeded ngoài `paths`: `apps/api/test/foundation/pipeline-parity.unit-spec.ts` — hạ `HAND_ROLLED_BASELINE` 269 → 268 vì spec reminder chuyển sang `applyMainPipeline` (ratchet đỏ nếu không hạ).

## §6 Deploy · tương thích · rollback

- Chỉ API (deploy tay); không FE, không migration, không đổi contracts.
- [SUY RA] Lượt chạy đầu sau deploy phát một đợt cho việc quá hạn ≤ 7 ngày + sắp hạn 24h (trước đó chưa từng nhắc) — chính là mục đích của lookback.
- Đổi định dạng khoá: thông báo cũ khoá `<taskId>:<ngày>` chỉ thuộc hàng legacy `due_date` — nay không còn là ứng viên ⇒ không phát trùng.
- Hàng legacy chỉ có `due_date` (không có `due_at`) thôi được nhắc — nhất quán với task-core không coi chúng quá hạn.
- Rollback: revert commit + deploy lại API; thông báo đã tạo vẫn hợp lệ.

## §7 Ngoài phạm vi / nợ

- Deep-link mở thẳng việc (Q7 = B) — WO đỏ riêng; reporter nhận `TASK_OVERDUE` vẫn tới `/tasks/my-tasks`.
- Truy vấn «đã từng nhận» chạy trên index `user_id` (không partial); index riêng cho hàng đã xoá cần migration — chỉ làm nếu đo thấy chậm.
- `idx_tasks_overdue_candidate` loại hàng `task_status IS NULL` ⇒ vế `NULL = Todo` không dùng hết index; task-core luôn ghi `'Todo'`.
- Đổi hạn về đúng mốc cũ thì không nhắc lại (cùng khoá) — chấp nhận.
- WO S20-TASK-ASSIGNNOTI-1 cùng chuỗi có thể sửa `task-noti-bridge.registrar.ts` ⇒ xung đột khi gộp, xử lý tuần tự.
