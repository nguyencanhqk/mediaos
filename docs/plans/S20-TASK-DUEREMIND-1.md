# S20-TASK-DUEREMIND-1 — plan v1.1

> Nhắc sắp đến hạn/quá hạn chạy đúng cho việc SPEC-06 (quá hạn báo cả người giao việc) + chủ/quản lý dự án được báo khi việc vào Chờ duyệt.
> Zone 🟡 · gate FULL (chạm outbox/NOTI) · đo trên `3970b82a` · KHÔNG migration · KHÔNG đổi engine/index NOTI.
> Story: `docs/plans/S20-WORKUX-STORIES.md` US-TASK-NV-06 (gộp QL-02) + US-TASK-QL-09 · SPEC-06 §14.17, NOTI-EVENT-004/005.
> v1.1 = v1 + phản hồi plan-review (§9). Quyết định owner 26/10 (lookback 7 ngày · Q6 = B) giữ nguyên.

## §1 done_when ↔ cách làm

| #   | done_when                                                                                                                                        | Cách làm                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `queryDue` đọc `due_at`/`task_status` + `main_assignee_employee_id`→`user_id`, giữ nhánh `assignee_user_id`, 24h, office, chưa xoá, `withTenant` | Viết lại truy vấn (raw SQL, tệp mới `task-reminder.job-handler.query.ts`); vị từ «mở» chép đúng định nghĩa `isOverdue` của task-core                               |
| 2   | Dedupe theo (việc, sự kiện, mốc `due_at`); `TASK_OVERDUE` → phụ trách ∪ reporter/người tạo                                                       | `dedupeKey = <taskId>:<due_at ISO UTC ms>`; lọc trước người nhận đã TỪNG nhận (kể cả hàng đã xoá mềm) bằng đúng khoá engine sẽ tính; người nhận gộp không trùng    |
| 3   | Lỗi một việc không chặn việc khác; metadata ghi đúng failed                                                                                      | `try/catch` mỗi (việc, sự kiện); metadata thêm số bị bỏ do lookback + số đã nhắc                                                                                   |
| 4   | `TASK_STATUS_CHANGED` → In Review của việc thuộc dự án ⇒ + Owner/Manager còn hiệu lực                                                            | `TaskAudienceReader.projectReviewerUserIds()` đọc trong CÙNG `withTenant` của audience; registrar thêm khi `toStatus === 'In Review'`, khử trùng trước khi trả     |
| 5   | Int-spec `LANE_DB`, tạo việc qua task-core, cross-tenant                                                                                         | Viết lại `task-reminder-job.int-spec.ts` qua `applyMainPipeline` + `POST /tasks` · spec mới `s20-task-review-audience.int-spec.ts` · unit handler + unit registrar |

## §2 Đo trên `3970b82a`

- [ĐO] `task-reminder.job-handler.ts:108-131` lọc `tasks.dueDate` (cột `due_date`), `assigneeUserId`, `ne(status,'completed')` (cột legacy `status`); `:148` `dedupeKey = <taskId>:<YYYY-MM-DD>`; `:149` người nhận chỉ assignee.
- [ĐO] Task-core ghi `due_at` chứ không ghi `due_date`: `task-core.repository.ts:666-680` (insert), `task-actions.repository.ts:196` (đổi hạn). Cột legacy `status` giữ DEFAULT `'not_started'` ⇒ điều kiện `ne(status,'completed')` luôn đúng với việc SPEC-06, còn `isNotNull(due_date)` loại hết ⇒ việc SPEC-06 **không bao giờ** được nhắc.
- [ĐO] Không migration nào backfill `due_at` từ `due_date` (grep `migrations/*.sql`). Không controller nào gọi `TasksService.createTask` (đường legacy ghi `due_date`, `tasks.repository.ts:242-259`).
- [ĐO] Định nghĩa quá hạn của task-core: `due_at is not null and due_at < now() and (task_status is null or task_status not in ('Done','Cancelled'))` — `task-core.repository.ts:218-219, 396-397`.
- [ĐO] Index `idx_tasks_assignee_status_due (company_id, main_assignee_employee_id, task_status, due_at) WHERE deleted_at IS NULL` + `idx_tasks_overdue_candidate` — `0478:373-381` ⇒ không cần migration.
- [ĐO] Task-core tạo việc: `reporterEmployeeId = actorEmp.id`, `creatorUserId = user.id` (`task-core.service.ts:543,547`); ghi `assignee_user_id` đồng thời với `main_assignee_employee_id` (`task-core.service.ts:541-542`, `task-patch-field-gate.ts:109-123`, `task-actions.repository.ts:203-215`).
- [ĐO] Dedupe tầng 1 `notification-dedupe.service.ts:102-116` lọc `isNull(deletedAt)`; tầng 2 `uq_notifications_dedupe_active ... WHERE dedupe_key IS NOT NULL AND deleted_at IS NULL` (`0479:279-281`) ⇒ người dùng xoá mềm thông báo thì lượt job sau phát lại.
- [ĐO] Khoá dedupe chiến lược `DedupeKey` = `<eventCode>:<dedupeKey>` (`notification-dedupe.service.ts:75-77`), không phụ thuộc người nhận; tầng 1/2 xét theo từng `recipient_user_id`. Engine chọn chiến lược bằng `resolveStrategy(ev)` — catalog thắng khi khác `'None'` (`:47-61`, engine `:99-112`).
- [ĐO] Tiền lệ «đã từng phát» bỏ qua `deleted_at`: `attendance-alert-noti.repository.ts:135-148` (chống hồi sinh sau xoá mềm).
- [ĐO] Resolver người nhận: gộp `Set`, lọc user active cùng công ty, loại actor (`notification-recipient-resolver.service.ts:38-54`); bridge cũng gộp `Set` (`outbox-notification-bridge.service.ts:116-117`).
- [ĐO] `task.status_changed` payload có `taskId`, `projectId`, `fromStatus`, `toStatus`, `actorUserId` (`task-actions.service.ts:276-284, 721-735`). Kéo cột cùng nhóm: `statusChanges=false` ⇒ không gọi `changeStatusTx` ⇒ không có sự kiện (`task-core.service.ts:931,959-969`).
- [ĐO] Thành viên dự án «còn hiệu lực»: `member_status='Active' and deleted_at is null` + `project_role in ('Owner','Manager')` (`task-core.repository.ts:339-348`, `project-access.service.ts:70-83`); `project_members.user_id` NOT NULL (`0478:290-292`); gỡ thành viên ghi `memberStatus='Removed'` + `deleted_at` (`projects.repository.ts:761-777`).
- [ĐO] Engine ghi cả `user_id` legacy = người nhận (`notifications.repository.ts` createFromEngine `userId: data.recipientUserId`); `notifications_user_id_idx (user_id)` (`0010:25`) + `(company_id, user_id, created_at)` (`0220:59`) không partial ⇒ đọc được cả hàng đã xoá mềm qua index.
- [ĐO] Spec cũ `task-reminder-job.int-spec.ts:40-60,111-113` insert cột legacy và tự dựng pipeline; ratchet `pipeline-parity.unit-spec.ts:29` `HAND_ROLLED_BASELINE = 269`.
- [ĐO] `timestamptz` qua `tx.execute(sql…)` về `Date` (không có `setTypeParser` trong `src/db`), nhưng mã sẵn có luôn chuẩn hoá cả chuỗi lẫn `Date` (`task-core.mapper.ts:91-94`, `task-actions.service.ts:767-770`).

## §3 Thiết kế

**Truy vấn ứng viên** (một `withTenant(companyId)` cho toàn bộ phần đọc, `company_id` bind tường minh):

- Vị từ chung: `tk.company_id = $c and tk.task_type = 'office' and tk.deleted_at is null and tk.due_at is not null and (tk.task_status is null or tk.task_status not in ('Done','Cancelled'))`.
- Người phụ trách (F7): `case when tk.main_assignee_employee_id is not null then ea.user_id else tk.assignee_user_id end`, `ea` = `left join employee_profiles` cùng `company_id`, `deleted_at is null`, `status = 'active'`. Chỉ rơi về `assignee_user_id` khi việc KHÔNG có `main_assignee_employee_id` (nhánh legacy) ⇒ hồ sơ người phụ trách đã nghỉ thì không lấy lại user cũ qua cột đồng bộ.
- Ứng viên PHẢI có người phụ trách giải được (biểu thức trên `is not null`) — «không người phụ trách ⇒ không phát» áp cho cả hai sự kiện; hồ sơ người phụ trách inactive ⇒ việc không được nhắc (ca R11).
- Reporter/người tạo (Q6 = B): `case when tk.reporter_employee_id is not null then er.user_id else tk.creator_user_id end`, join `er` cùng điều kiện.
- `TASK_DUE_SOON`: `due_at >= now and due_at <= now + 24h` → người phụ trách (SPEC-06 §14.17).
- `TASK_OVERDUE`: `due_at < now and due_at >= now - OVERDUE_LOOKBACK_MS` → phụ trách ∪ reporter, khử trùng trong job.
- Quyết định owner 26/10: `OVERDUE_LOOKBACK_MS = 7 * DAY_MS` (hằng số đặt tên). `overdueSkippedByLookback` = `count(*)` cùng vị từ ứng viên nhưng `due_at < now - lookback` ⇒ ghi metadata, không nuốt im lặng.
- `due_at` chuẩn hoá bằng `toUtcIso(v: string | Date)` = `new Date(v).toISOString()` (UTC, mili-giây) — cùng cách `task-core.mapper.ts:91-94`; khoá không phụ thuộc TimeZone của phiên PG (F5).

**Dedupe (việc, sự kiện, mốc hạn)** — không đổi engine/index:

- `dedupeKey = <taskId>:<toUtcIso(due_at)>` ⇒ chạy nhiều lần cùng mốc = 1 bản; đổi hạn ⇒ khoá mới ⇒ nhắc lại.
- Bẫy xoá mềm — kiểm trước trong job, theo ĐÚNG chiến lược engine (F4): đọc dòng catalog bằng `NotificationEventRepository.findEnabledEvent` rồi `NotificationDedupeService.resolveStrategy` + `computeKey` (truyền `occurredAt = now` cho cả kiểm trước lẫn DTO ⇒ mọi chiến lược ra cùng khoá với engine). Chiến lược giải ra khác `DedupeKey` ⇒ `logger.warn` + `metadata.dedupeStrategyMismatch`; khoá `null` (chiến lược `None`) ⇒ không kiểm trước được, engine tự quyết. Sự kiện tắt/không có trong catalog ⇒ không kiểm trước, engine giữ hành vi cũ.
- Bộ lọc kiểm trước = tầng 1 trừ `deleted_at`: `company_id = $c and event_code = $e and recipient_user_id = any($r) and dedupe_key = any($k)` + `user_id = any($r)` chỉ để dùng index `user_id`; khớp theo cặp (người nhận, khoá) trong JS. Unit ghim vị từ qua `PgDialect` (không có `deleted_at`). Người nhận đã có hàng (còn hay đã xoá) bị bỏ; còn 0 người ⇒ không gọi `intake`, đếm `alreadyRemindedCount`.
- Chọn cách này thay vì sửa tầng 1 của engine: phạm vi chỉ hai mã do job phát, không đổi hành vi dedupe của mọi sự kiện khác. Sổ nhắc riêng = bảng mới = migration ⇒ loại. Tầng 2 giữ nguyên làm lưới chống đua giữa hai lượt chạy.

**Cô lập lỗi**: phần đọc lỗi ⇒ job ném (lỗi hệ thống, JobRunner ghi thất bại). Mỗi (việc, sự kiện) gọi `intake` trong `try/catch` riêng ⇒ `failed++`, log có taskId, việc khác vẫn chạy. `total` = số (việc, sự kiện) ứng viên; `success` = intake thành công + đã nhắc trước đó; `failed` = intake ném. Metadata: `dueSoonCount, overdueCount, overdueSkippedByLookback, alreadyRemindedCount` (+ `dedupeStrategyMismatch` khi có).

**Review audience (done_when 4)**:

- `TaskAudienceReader.projectReviewerUserIds(tx, companyId, taskId)`: `select distinct pm.user_id from tasks tk join projects p on p.id = tk.project_id and p.company_id = $c and p.deleted_at is null join project_members pm on pm.company_id = $c and pm.project_id = tk.project_id where tk.id = $t and tk.company_id = $c and tk.deleted_at is null and pm.member_status = 'Active' and pm.deleted_at is null and pm.project_role in ('Owner','Manager')`.
- Registrar `TASK_STATUS_CHANGED`: đọc audience + (nếu `toStatus === 'In Review'`) danh sách trên trong CÙNG một `withTenant`; trả danh sách đã khử trùng. Trạng thái khác/không dự án ⇒ y như cũ. Actor do engine loại.
- F9 — người nhận mới đọc được việc: đường đọc việc của task-core cho mọi thành viên Active của dự án đọc mọi việc trong dự án (`task-core.repository.ts:332-350`, mode `read` không cap vai trò) khi có `read:task` ở bất kỳ phạm vi (`task-core.service.ts:1125-1132`); vai trò mặc định `employee` có `read:task @Own` (`0485:121`). `tasks` không có cột hiển thị riêng (chỉ `projects.visibility`, `0478:254`, không dùng ở đường đọc việc). Phần dư (Owner/Manager không có `read:task` ở phạm vi nào) = cùng tư thế với creator/watcher hiện tại ⇒ ghi followup, không chặn WO.

**Tệp ≤ 800 dòng**: handler giữ điều phối, SQL + hàm thuần tách sang `task-reminder.job-handler.query.ts`; không chạm `task-core.*` / `task-actions.*`.

## §4 Bảng ca

Int-spec chạy lane `mediaos_w26b`, dựng app qua `applyMainPipeline`, tạo việc bằng `POST /tasks` (task-core, `dueAt` quá khứ được phép — contracts `task.ts:602`), đổi hạn qua `POST /tasks/:id/change-deadline`, xoá thông báo qua `DELETE /notifications/:id` của chính người nhận. UUID chỉ `randomUUID()`.

**`task-reminder-job.int-spec.ts` (viết lại)** — mọi đếm theo `recipient_user_id` + `source_entity_id`, gồm cả hàng đã xoá mềm khi cần.

| Ca                                                                                                     | Loại           | Kỳ vọng                                                                                     | Đỏ trên mã cũ vì                 |
| ------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------- | -------------------------------- |
| R1 việc office, phụ trách NV, `due_at` +2h, Todo                                                       | RED            | 1 `TASK_DUE_SOON` cho NV                                                                    | job đọc `due_date` = NULL        |
| R2 `due_at` −2h, reporter ≠ phụ trách                                                                  | RED            | 1 `TASK_OVERDUE` cho NV + 1 cho reporter                                                    | như R1 + người nhận chỉ assignee |
| R3 chạy job 3 lần                                                                                      | RED            | vẫn 1 bản/người                                                                             | R1/R2 chưa phát                  |
| R4a NV xoá mềm `TASK_OVERDUE` → chạy lại                                                               | RED (bắt buộc) | 0 bản mới cho NV; reporter vẫn đúng 1                                                       | tầng 1/2 bỏ qua hàng đã xoá      |
| R4b NV xoá mềm `TASK_DUE_SOON` → chạy lại                                                              | RED            | 0 bản mới cho NV                                                                            | như R4a                          |
| R4c ALLOW cạnh R4: việc chỉ NV nhận lượt đầu, NV xoá; sau đó việc có reporter (gán lại) → chạy lại     | ALLOW          | reporter nhận đúng 1, NV 0 bản mới (lọc theo từng người nhận, không theo việc)              | (mã cũ không phát gì)            |
| R5 đổi hạn sang mốc quá hạn khác → chạy lại                                                            | RED            | thêm đúng 1 bản/người, `dedupe_key` khác bản trước                                          | khoá theo ngày                   |
| R6 Done · Cancelled · xoá mềm · không hạn · không phụ trách · `due_at` +3 ngày · task_type khác office | ALLOW-cạnh     | 0 bản                                                                                       | (giữ hành vi)                    |
| R7 cùng một lượt: việc `due_at` −8 ngày + việc −6 ngày                                                 | RED            | −8 ngày: 0 bản; −6 ngày: được nhắc; `metadata.overdueSkippedByLookback === 1` CHÍNH XÁC     | trường chưa có                   |
| R8 phụ trách = reporter                                                                                | ALLOW          | đúng 1 bản                                                                                  | —                                |
| R9 nhánh legacy: task-core rồi đặt `main_assignee_employee_id = NULL` (còn `assignee_user_id`)         | ALLOW          | vẫn nhắc user đó                                                                            | —                                |
| R10 engine ném ở 1 việc (spy) → việc khác trong cùng lượt                                              | RED            | việc khác có bản; `failed === 1`; gỡ spy, chạy lại ⇒ việc lỗi được nhắc (không bị đánh dấu) | metadata/đếm mới                 |
| R11 hồ sơ người phụ trách inactive (F7)                                                                | ALLOW-cạnh     | 0 bản cho cả phụ trách lẫn reporter                                                         | —                                |
| X1 công ty B có việc quá hạn cùng hình dạng; chạy cho A trước/sau khi gieo B                           | cross-tenant   | 0 hàng `notifications` của B; bộ đếm của A không đổi; chạy cho B ⇒ chỉ người của B nhận     | —                                |

**`s20-task-review-audience.int-spec.ts` (mới)** — dự án P tạo qua `POST /projects` (cột mặc định có «Chờ duyệt»): Owner QL1 (cũng là người tạo việc), Manager QL2 (thuần — không tạo/phụ trách/theo dõi), Manager đã gỡ QLR, Member NV (phụ trách + người đổi trạng thái); drain outbox bằng `drainOutboxUntilSettled` + `acquireOutboxWorkerLock`.

| Ca                                                         | Loại         | Kỳ vọng                                                                                                       |
| ---------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| A1 NV đổi trạng thái Todo → In Review (change-status)      | RED          | QL2 nhận đúng 1 `TASK_STATUS_CHANGED` (thông báo duy nhất có thể của QL2 cho việc này); NV (actor) không nhận |
| A2 NV kéo sang cột «Chờ duyệt» (move-state)                | RED          | QL2 nhận đúng 1 cho việc này                                                                                  |
| A3 kéo giữa hai cột cùng nhóm review                       | ALLOW-cạnh   | số hàng `outbox_events` `task.status_changed` của việc KHÔNG đổi (đo trên outbox, không đếm thông báo)        |
| A4 QLR đã bị gỡ khỏi P                                     | RED-cạnh     | QLR không nhận                                                                                                |
| A5 QL1 vừa người tạo vừa Owner                             | ALLOW        | int: đúng 1 thông báo có `payload.toStatus = 'In Review'` cho QL1; unit registrar: QL1 xuất hiện 1 lần        |
| A6 trạng thái khác (In Progress) / việc không dự án        | ALLOW-cạnh   | QL2 không nhận; người tạo vẫn nhận như cũ                                                                     |
| A7 QL2 tự đổi sang In Review                               | ALLOW-cạnh   | QL2 (actor) không nhận; QL1 nhận                                                                              |
| X2 hàng `project_members` của công ty B trỏ dự án P (gieo) | cross-tenant | Owner của B không bao giờ là người nhận                                                                       |

Unit `task-reminder.job-handler.spec.ts`: định dạng khoá (chuỗi `+07:00` ≡ `Date` cùng thời điểm), gộp người nhận, cô lập lỗi + metadata, kiểm trước theo chiến lược engine (lệch chiến lược ⇒ warn + metadata), vị từ kiểm trước không có `deleted_at`. Unit `task-noti-bridge.registrar.spec.ts`: In Review gộp reviewer, khử trùng; trạng thái khác không gọi reader reviewer.

## §5 Tệp đổi

Trong `paths`: `apps/api/src/notifications/task-reminder.job-handler.ts` · `task-reminder.job-handler.query.ts` (mới) · `task-reminder.job-handler.spec.ts` (mới) · `task-audience.reader.ts` · `task-noti-bridge.registrar.ts` · `task-noti-bridge.registrar.spec.ts` (mới) · `apps/api/test/integration/task-reminder-job.int-spec.ts` · `apps/api/test/integration/s20-task-review-audience.int-spec.ts` (mới) · plan này.

pathsNeeded ngoài `paths` (F6): `apps/api/test/foundation/pipeline-parity.unit-spec.ts` — hạ `HAND_ROLLED_BASELINE` 269 → 268 vì spec reminder chuyển sang `applyMainPipeline` (ratchet đỏ nếu không hạ). `apps/api/test/integration/task-subtask-counting.int-spec.ts` — ca «reminder job» (D-37) khẳng định job KHÔNG thấy việc task-core (đúng lỗi WO này sửa); đổi sang: cha quá hạn có con vẫn là ứng viên (+1), con không hạn không tính. Luồng chính mở rộng `paths` bằng commit backlog riêng (agent không sửa `harness/backlog.mjs`) và chạy `bash harness/check.sh --all --lane-db=w26b` trước khi mở PR.

## §6 Deploy · tương thích · rollback

- Chỉ API (deploy tay); không FE, không migration, không đổi contracts.
- Lượt chạy đầu sau deploy phát một đợt `TASK_OVERDUE` cho việc SPEC-06 quá hạn ≤ 7 ngày + `TASK_DUE_SOON` cho việc hạn trong 24h (trước đó chưa từng nhắc) — chính là mục đích của lookback.
- Hàng legacy chỉ có `due_date` (không có `due_at`) thôi được nhắc — nhất quán với task-core không coi chúng quá hạn. Khoá cũ `<taskId>:<ngày>` không va khoá mới.
- F8: trước merge luồng chính đo (chỉ đọc) trên PROD hai số — việc office mở có `due_date` mà không `due_at`; việc SPEC-06 mở quá hạn trong 7 ngày — và ghi vào PR; số thứ nhất > 0 ⇒ followup cho owner, không backfill ở WO này.
- Rollback: revert commit + deploy lại API; thông báo đã tạo vẫn hợp lệ.

## §7 Ngoài phạm vi / nợ

- Deep-link mở thẳng việc (Q7 = B) — WO đỏ riêng; reporter nhận `TASK_OVERDUE` vẫn tới `/tasks/my-tasks`.
- Truy vấn «đã từng nhận» chạy trên index `user_id` (không partial); index riêng cho hàng đã xoá cần migration — chỉ làm nếu đo thấy chậm.
- `idx_tasks_overdue_candidate` loại hàng `task_status IS NULL` ⇒ vế `NULL = Todo` không dùng hết index; task-core luôn ghi `'Todo'`.
- Đổi hạn về đúng mốc cũ thì không nhắc lại (cùng khoá) — chấp nhận.
- F3(iv) khoảng trống sản phẩm sẵn có: `TASK_STATUS_CHANGED` dedupe `TimeWindow 300s` theo (việc, người nhận) ⇒ creator/assignee đã nhận một thông báo đổi trạng thái của cùng việc trong 5 phút thì không nhận tín hiệu In Review. Không đổi dedupe ở WO này — followup.
- F9 phần dư: Owner/Manager dự án không có `read:task` ở phạm vi nào vẫn nhận tiêu đề việc — cùng tư thế creator/watcher hiện có; followup nếu owner muốn lọc theo quyền đọc ở bridge.
- WO S20-TASK-ASSIGNNOTI-1 cùng chuỗi có thể sửa `task-noti-bridge.registrar.ts` ⇒ xung đột khi gộp, xử lý tuần tự.

## §9 Phản hồi plan-review (v1 → v1.1)

| Finding | Xác minh                                                                                                                                               | Xử lý                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| F1 HIGH | Đúng: worktree đang ở nhánh WO kế. Đã `switch` về `fix/s20-task-dueremind-1` (cây sạch, đầu `d44710f6`), đọc plan từ chính commit đó.                  | Thi công tuần tự trên nhánh này.                                                                     |
| F2 HIGH | Đúng: bảng v1 thiếu ca DUE_SOON xoá mềm, ALLOW theo từng người nhận, lookback chính xác, vi phân cross-tenant.                                         | Thêm R4b · R4c · R7 chính xác · R10 chạy lại · X1 vi phân.                                           |
| F3 HIGH | Đúng: `TASK_STATUS_CHANGED` TimeWindow 300s (`notification-dedupe.const.ts:24`, khoá `:83-90`).                                                        | A1/A2 dùng QL2 thuần · A3 đo outbox · A5 lọc `payload.toStatus` + unit registrar · followup F3(iv).  |
| F4 MED  | Đúng: `resolveStrategy` catalog thắng (`notification-dedupe.service.ts:47-61`).                                                                        | Kiểm trước giải chiến lược như engine + `occurredAt` chung; lệch ⇒ warn + metadata; unit ghim vị từ. |
| F5 MED  | Đúng về nguy cơ (`due_at` qua raw SQL); thực tế về `Date`, nhưng không nên dựa vào đó.                                                                 | `toUtcIso` nhận chuỗi lẫn `Date`; unit `+07:00` ≡ `Date`.                                            |
| F6 MED  | Đúng: ghi chú WO đòi commit backlog riêng.                                                                                                             | Ghi pathsNeeded; luồng chính commit backlog + chạy `check.sh --all --lane-db=w26b`.                  |
| F7 MED  | Đúng: cột `assignee_user_id` đồng bộ với người phụ trách (`task-patch-field-gate.ts:109-123`) ⇒ `coalesce` lấy lại user đã nghỉ.                       | `case` theo `main_assignee_employee_id is null`; ứng viên cần phụ trách giải được; ca R11.           |
| F8 LOW  | Đúng.                                                                                                                                                  | §6 + PR do luồng chính đo (agent không truy cập PROD).                                               |
| F9 LOW  | Đúng là v1 chưa trích dẫn; đã đo: nhánh thành viên đọc mọi việc của dự án (`task-core.repository.ts:332-350`), `employee read:task @Own` (`0485:121`). | Trích dẫn ở §3; thêm join `projects.deleted_at is null`; phần dư → followup.                         |

## §10 Kết quả thi công

- RED trên mã cũ (`92c48428`): 16 đỏ / 10 xanh — R1–R5 · R7 · R8 · R9 · R10 · X1 · A1 · A2 (+A3 phần phụ thuộc A2) · unit registrar «In Review». Ca ALLOW-cạnh (R6 · R11 · A4–A7 · X2 · A3 phần outbox) xanh ngay trên mã cũ.
- Đỏ đúng lý do của bẫy xoá mềm: truy vấn mới nhưng TẮT kiểm trước ⇒ R4a · R4b · R4c đỏ `[true, false]` ≠ `[true]` (hàng đã xoá + bản phát lại), R5 kéo theo (3 ≠ 2); mọi ca khác xanh. Bật kiểm trước ⇒ xanh.
- GREEN: 4 tệp mới/viết lại 35/35; hồi quy `src/notifications` (14 tệp) + `task-noti-e2e` · `qa2-e2e-task-noti-dash` · `task-move-state` · `task-actions` · `task-kanban-move-activity` · `task-subtask-counting` · `dashboard-cache-invalidate` · `s5-noti-fix1-deeplink` · `pipeline-parity` · `outbox-worker-lock` xanh trên lane; typecheck API · eslint tệp chạm · prettier sạch.
