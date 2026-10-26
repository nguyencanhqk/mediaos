# S20-TASK-ASSIGNNOTI-1 — plan v1

> Giao việc qua form Tạo, hoặc đổi người/hạn/ưu tiên qua form Sửa, cũng báo cho người được giao như khi
> đổi trong chi tiết việc. Zone 🟡 · gate FULL (chạm audit/outbox/NOTI) · không migration · không đổi cổng
> quyền. Nguồn: `docs/plans/S20-WORKUX-STORIES.md` US-TASK-QL-01 · SPEC-06 NOTI-EVENT-002. Base `3970b82a`.
> Ký hiệu: **[ĐO]** = đọc trực tiếp trên `3970b82a`; **[SUY RA]** = kết luận từ phép đo, chưa chạy.

## §1 done_when ↔ cách làm

| #   | done_when                                                                                                                                              | Cách làm                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Create có người phụ trách ≠ người tạo ⇒ 1 `TASK_ASSIGNED` + 1 outbox `task.assigned` cùng tx với task/activity/audit; tự giao/không người ⇒ không phát | `createTaskInTx` gọi `TaskAssignEvents.recordCreatedTx` (activity+audit `TASK_CREATED` chuyển nguyên văn + outbox) ngay sau insert, CÙNG `tx`                                                   |
| 2   | PATCH đổi người/hạn/ưu tiên dùng CHUNG helper với `task-actions.service.ts`; chỉ tiêu đề/mô tả ⇒ không phát; payload không description                 | `updateTask` gọi `recordPatchedTx` (activity+audit `TASK_UPDATED` chuyển nguyên văn + outbox theo `fieldChanges`); `/assign` · `/change-deadline` · `/change-priority` gọi CÙNG các hàm enqueue |
| 3   | Lỗi giữa chừng (400/403) ⇒ rollback, 0 outbox; đang nghỉ ⇒ `warnings[]` `ASSIGNEE-ON-LEAVE`                                                            | outbox đi qua `tx` của caller (không mở kết nối mới); warnings dùng CHUNG `buildAssignWarningsTx` chuyển từ task-actions                                                                        |
| 4   | Không đổi cổng PATCH                                                                                                                                   | không chạm `task-patch-field-gate.ts` / `prepare` / `assertTx`; emission đặt SAU mọi cổng; lệch cổng thấy được ⇒ followups                                                                      |
| 5   | KPI #10                                                                                                                                                | KHÔNG đo ở lượt này — owner kiểm tay sau deploy (ghi trong prBody)                                                                                                                              |
| 6   | Int-spec LANE_DB phủ 6 tiêu chí                                                                                                                        | `apps/api/test/integration/s20-task-assign-noti.int-spec.ts` MỚI qua `applyMainPipeline`, lane `mediaos_w26b`                                                                                   |

## §2 Đo trên `3970b82a`

- [ĐO] `apps/api/src/tasks/task-actions.service.ts` 771 dòng. `assign` :138-140 chọn `TASK_ASSIGNED`/`task.assigned`
  khi Main cũ null, ngược lại `TASK_ASSIGNEE_CHANGED`/`task.assignee_changed`; activity :141, audit :153, outbox :161
  (payload = `commonPayload` + old/new assignee + `assigneeUserId`), tất cả trong `db.withTenant` cùng `tx`.
  Priority enqueue :347, deadline :416. Warnings: `buildAssignWarnings` :611-639 (ON-LEAVE theo ngày `dueAt` +
  NOT-MEMBER khi có dự án), `buildDeadlineWarnings` :641-655, `warnOnLeave`/`warnNotMember` :657-668.
- [ĐO] `apps/api/src/tasks/task-core.service.ts` 1.363 dòng (đã quá 800). `createTask` :392-405 → `createTaskInTx`
  :421-602: insert :534, activity `TASK_CREATED` :557-574, audit `TaskCreated` :575-588 — KHÔNG outbox.
  `updateTask` :605-821: `computeChanged` + `patchGate.assertTx` trước mọi ghi; activity/audit `TASK_UPDATED`
  :761-800 — KHÔNG outbox. Hàm khởi tạo :133-166 (tham số mới thêm CUỐI — spec dựng theo VỊ TRÍ :152-157).
- [ĐO] `grep task.assigned|task.assignee_changed|task.due_date_changed|task.priority_changed` trong `apps/api/src`
  (bỏ spec): producer DUY NHẤT là `task-actions.service.ts`; consumer = `notifications/task-noti-bridge.registrar.ts`
  :77-103 (assigned → `assigneeUserId`; assignee_changed/priority/due → assignee ∪ watchers) +
  `dashboard/dashboard-cache-invalidation.registrar.ts` :56-71.
- [ĐO] Người nhận lấy từ `task-audience.reader.ts` :37 = `tasks.assignee_user_id` HIỆN TẠI (không đọc payload).
  Create ghi `assigneeUserId` :542; PATCH ghi qua `buildGatedPatch` (`task-patch-field-gate.ts` :101-123) ⇒ cùng cột.
- [ĐO] Actor KHÔNG tự lọc ở bridge — engine loại actor (`outbox-notification-bridge.service.ts` :16, :114-125).
- [ĐO] `createTaskInTx` có caller thứ hai: `goals/goal-decompose.service.ts` :241 (phân rã mục tiêu, cùng tx).
- [ĐO] `tasks.controller.ts` :153-158 trả thẳng kết quả service, không `ZodSerializerDto` ⇒ trường thêm không bị lọc.
- [ĐO] `packages/contracts/src/task.ts` 823 dòng, `taskCoreResponseSchema` :670; `taskActionWarningSchema` ở
  `task-actions.ts` :100 (114 dòng).
- [ĐO] Spec dựng `new TaskCoreService(...)` theo vị trí: `task-core-codegen.spec.ts` :99 (gọi `createTask`).
  Không spec nào dựng `TaskActionsService` bằng `new` hay khai provider tay cho hai service.

## §3 Thiết kế

1. **Một nguồn** — tệp MỚI `apps/api/src/tasks/task-assign-events.ts`, `@Injectable() TaskAssignEvents`
   (deps: `OutboxService`, `TaskActionsRepository`, `AuditService`, `TaskActivityService` — đều đã có trong
   `TasksModule`). Hàm (mọi hàm nhận `tx` của caller, KHÔNG tự mở `withTenant`):
   - `assignKind(oldMainEmployeeId)` → `{activityAction, auditAction, eventType, eventCode}` (bảng :138-140 chuyển nguyên).
   - `enqueueAssigneeTx` · `enqueueDueDateTx` · `enqueuePriorityTx` — khối outbox :161 / :416 / :347 chuyển nguyên
     văn; payload chung `{eventCode, taskId, taskTitle, taskCode, projectId, actorUserId, actorEmployeeId}` +
     trường riêng như hiện hành; KHÔNG `description`, KHÔNG `reason`.
   - `buildAssignWarningsTx` · `buildDeadlineWarningsTx` (+ 2 hằng warning) — chuyển từ :611-668.
   - `recordCreatedTx` — activity+audit `TASK_CREATED` (chuyển nguyên :557-588) rồi, nếu có người phụ trách và
     `assignee.userId !== actor.id`, `enqueueAssigneeTx(old = null)` ⇒ `task.assigned`.
   - `recordPatchedTx` — activity+audit `TASK_UPDATED` (chuyển nguyên :761-800, giữ điều kiện «rỗng ⇒ không ghi»)
     rồi theo `fieldChanges` (đã tính trước cổng): người phụ trách đổi sang người MỚI khác null ⇒ `enqueueAssigneeTx`
     (old null ⇒ `task.assigned`, ngược lại `task.assignee_changed` — y `/assign`); `dueAt` đổi ⇒ due; `priority`
     đổi ⇒ priority. Gỡ người (→ null) ⇒ không phát (route `/assign` không có ca này). Tiêu đề trong payload =
     tiêu đề SAU patch.
2. **task-actions.service.ts**: thay các khối trên bằng lời gọi helper; tham số `assignEvents` thêm CUỐI hàm khởi
   tạo. Activity/audit riêng của `/assign` giữ nguyên tên hành động (lấy từ `assignKind`). Ước net ≈ −45 dòng.
3. **task-core.service.ts**: `createTaskInTx` gọi `recordCreatedTx` + `buildAssignWarningsTx` (khi có người phụ
   trách), trả thêm `warnings` (additive — `goal-decompose` bỏ qua); `createTask` trả `{...task, warnings}`.
   `updateTask` thay khối :761-800 bằng `recordPatchedTx`. Tham số mới thêm CUỐI. Ước net ≈ −50 dòng (yêu cầu ≤ 0).
4. **Contracts (additive)**: tệp MỚI `packages/contracts/src/task-create-response.ts` —
   `taskCoreCreateResponseSchema = taskCoreResponseSchema.extend({ warnings: z.array(taskActionWarningSchema).optional() })`
   kèm type; export qua `index.ts`. `task.ts` không đổi. FE cũ không vỡ (trường optional, FE không parse strict).
5. **Quyết định đã chốt áp dụng**: không đổi cổng PATCH (done_when 4); bridge + người nhận giữ nguyên (story);
   self-assign khi create ⇒ không phát (done_when 1); payload không description (BẤT BIẾN #3 của service).
6. **[SUY RA] Phân rã mục tiêu** đi qua `createTaskInTx` ⇒ từ nay việc phân rã có người phụ trách ≠ người phân rã
   cũng phát `task.assigned` (đúng NOTI-EVENT-002 «được giao việc»). Không cần quyết định mới để làm; nếu owner
   muốn tắt cho phân rã thì thêm cờ `ctx.skipAssignEvent` ở caller đó (một dòng) — ghi ở openQuestions.

## §4 Bảng ca

Unit `apps/api/src/tasks/task-assign-events.spec.ts` (MỚI, mock deps): `assignKind` null→assigned, A→changed;
`recordCreatedTx` self-assign/không người ⇒ 0 enqueue, khác người ⇒ 1 enqueue cùng `tx` object; `recordPatchedTx`
chỉ title/description ⇒ 0 enqueue, 3 trường đổi ⇒ 3 enqueue; payload mọi loại không có khoá `description`/`reason`.

Int `s20-task-assign-noti.int-spec.ts` (MỚI, `applyMainPipeline`, `describe.skipIf(!(hasDb && LANE_DB))`, id qua
`randomUUID()`/seed helper — KHÔNG UUID literal; drain outbox qua `acquireOutboxWorkerLock` + `drainOutboxUntilSettled`):

| Ca                                                                                                                           | Loại                 | Kỳ vọng                                                                                                                                                                                                                                                                                                   | Trên mã cũ                       |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| C1 QL tạo việc giao A                                                                                                        | RED                  | 1 outbox `task.assigned` (taskId) + 1 audit `TaskCreated` + 1 activity `TASK_CREATED`; CÙNG tx đo bằng `xmin` của 4 hàng (task · outbox · audit · activity) đọc qua direct pool NGAY sau POST, TRƯỚC drain (worker cập nhật hàng outbox ⇒ đổi `xmin`); sau drain A có đúng 1 notification `TASK_ASSIGNED` | ĐỎ: 0 outbox                     |
| C2 QL tự giao chính mình                                                                                                     | ALLOW đứng cạnh C1   | 0 outbox `task.assigned`, task tạo được                                                                                                                                                                                                                                                                   | xanh (chốt)                      |
| C3 tạo không người phụ trách                                                                                                 | ALLOW                | 0 outbox                                                                                                                                                                                                                                                                                                  | xanh (chốt)                      |
| C4 PATCH A→B, W là watcher, QL cũng là watcher                                                                               | RED                  | 1 outbox `task.assignee_changed`; sau drain B và W nhận `TASK_ASSIGNEE_CHANGED`, QL không; tập người nhận = tập của ca đối chứng qua `/assign` trên việc song sinh                                                                                                                                        | ĐỎ: 0 outbox                     |
| C5 PATCH null→A                                                                                                              | RED                  | 1 outbox `task.assigned` (y `/assign`)                                                                                                                                                                                                                                                                    | ĐỎ                               |
| C6 PATCH đổi `dueAt` + `priority`                                                                                            | RED                  | 1 `task.due_date_changed` + 1 `task.priority_changed`                                                                                                                                                                                                                                                     | ĐỎ                               |
| C7 PATCH chỉ title + description                                                                                             | ALLOW                | 0 outbox task.\* mới; vẫn có 1 audit `TaskUpdated`                                                                                                                                                                                                                                                        | xanh (chốt)                      |
| C8 create lỗi SAU điểm phát (spy `GoalProgressEngineService.recomputeProjectGoalsTx` ném 400 một lần, việc có dự án + người) | chốt rollback        | 400; 0 task/0 outbox/0 audit/0 activity theo tiêu đề duy nhất; spy được gọi (chống xanh rỗng)                                                                                                                                                                                                             | xanh rỗng trên mã cũ ⇒ đi cặp C1 |
| C9 PATCH đổi người khi thiếu cặp `assign`                                                                                    | DENY (403 trước ghi) | 403; 0 outbox; task không đổi                                                                                                                                                                                                                                                                             | xanh (chốt) — cặp với C4         |
| C10 create, A có đơn nghỉ approved trùng ngày `dueAt`                                                                        | RED                  | `warnings[]` có `TASK-WARN-ASSIGNEE-ON-LEAVE`; payload outbox không có khoá `description`                                                                                                                                                                                                                 | ĐỎ: không có `warnings`          |
| C11 cross-tenant: actor công ty B PATCH việc công ty A / create ở B với nhân viên A                                          | DENY                 | 404/400; 0 outbox ở cả A và B; người nhận sau drain không bao giờ thuộc công ty khác                                                                                                                                                                                                                      | xanh (chốt)                      |

Chạy RED trước: commit spec, chạy trên mã cũ (C1, C4, C5, C6, C10 đỏ; còn lại xanh), rồi mới implement.
Hồi quy: `task-noti-e2e.int-spec.ts`, `task-actions.int-spec.ts`, `task-patch-field-gate.int-spec.ts`,
`goal-be2-link.int-spec.ts` + unit `task-core-codegen.spec.ts` (chia lô ≤ 3 tệp qua wrapper, lane `mediaos_w26b`).

## §5 Tệp đổi

Trong `paths`: `task-assign-events.ts` (MỚI) · `task-assign-events.spec.ts` (MỚI) · `task-actions.service.ts`
(net < 0) · `task-core.service.ts` (net < 0) · `test/integration/s20-task-assign-noti.int-spec.ts` (MỚI) ·
`docs/plans/S20-TASK-ASSIGNNOTI-1.md`.

pathsNeeded (ngoài `paths`, tối thiểu):

- `apps/api/src/tasks/tasks.module.ts` — khai provider `TaskAssignEvents` (khối additive).
- `apps/api/src/tasks/task-core-codegen.spec.ts` — thêm đối số cuối cho hàm khởi tạo theo vị trí.
- `packages/contracts/src/task-create-response.ts` (MỚI) + `packages/contracts/src/index.ts` (1 dòng export) —
  `task.ts` đã 823 dòng nên schema không đặt ở đó.

## §6 Deploy · tương thích · rollback

- Không migration, không seed quyền, không dependency mới (lockfile không đổi).
- API: deploy tay sau merge. FE: không đổi mã FE; Pages tự lên từ master, không phụ thuộc thứ tự.
- Tương thích: response create thêm `warnings` optional; FE cũ bỏ qua. Payload outbox giữ khuôn hiện hành ⇒ bridge,
  cache dashboard không đổi. Thêm nguồn phát ⇒ thêm thông báo cho người được giao qua form + phân rã (§3.6).
- Rollback: revert squash commit + deploy lại API. Bản ghi outbox đã phát là thông báo hợp lệ, không cần dọn.

## §7 Ngoài phạm vi / nợ

- KPI #10 (≤ 10 thao tác, 0 chuyển trang) — owner đo tay trên trình duyệt thật sau deploy.
- FE hiển thị `warnings[]` sau khi tạo (toast) — followup FE, chưa có WO.
- PATCH chưa trả `warnings[]` (done_when chỉ đòi create) — followup.
- PATCH không ghi `task_assignees` như `/assign` (lệch có sẵn, «Risk #7» trong task-actions) — không sửa ở đây.
- Ngày kiểm nghỉ phép lấy `dueAt.slice(0,10)` theo UTC (hành vi sẵn có của `/assign`) — nợ múi giờ công ty, ghi followups.
- `TasksService.createTask` (đường cũ, `tasks.service.ts` :188) — park, không phát.
