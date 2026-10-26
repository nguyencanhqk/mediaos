# S20-TASK-ASSIGNNOTI-1 — plan v1.1

> v1.1 (sau plan-review PASS_WITH_FIXES): §3 thêm điểm 7–10, §4 thêm C4′ · C6b · C12 và siết C8 · C11,
> §8 ghi quyết định từng finding (chấp nhận / chấp nhận một phần + lý do có file:dòng).

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
7. **(v1.1 · F3) Một khuôn payload** — `commonPayload` (task-actions :721-736) chuyển thành hàm thuần export
   `commonTaskPayload(eventCode, task{id,title,taskCode,projectId}, actorUserId, actorEmployeeId)` trong
   `task-assign-events.ts`; `changeStatusTx` (:279, ngoài phạm vi chuyển) gọi CÙNG hàm. Sau sửa, grep
   `commonPayload` / `commonTaskPayload` chỉ thấy MỘT định nghĩa, ở `task-assign-events.ts`.
8. **(v1.1 · F4) Payload PATCH theo hàng SAU patch** — `recordPatchedTx` đọc lại hàng (`findActionRawTx`, cùng
   `tx`, chỉ khi có trường cổng đổi) và lấy `assigneeUserId`/`title`/`projectId` của hàng SAU patch cho cả ba
   loại sự kiện; giá trị cũ (`oldAssigneeEmployeeId`/`oldDueAt`/`oldPriority`) lấy từ `raw` trước patch.
   PATCH đổi người + hạn + ưu tiên trong một request ⇒ GIỮ ba sự kiện (= gọi ba route chuyên trách nối tiếp);
   gộp thông báo là quyết định sản phẩm ⇒ followup, không tự đổi.
9. **(v1.1 · F2) Thứ tự** — enqueue nằm trong `recordCreatedTx`, gọi TRƯỚC `recomputeProjectGoalsTx`
   (task-core :596); `recordPatchedTx` thay khối :761-798, TRƯỚC recompute :805-809.
10. **(v1.1 · F9) warnings** — tính ở `createTask` (wrapper HTTP) bằng `createdWarningsTx(tx, companyId, id)`
    SAU `createTaskInTx`, cùng `tx`; phân rã mục tiêu (gọi `createTaskInTx` trực tiếp) KHÔNG tốn truy vấn
    cảnh báo. (Thay cho «createTaskInTx trả warnings» ở điểm 3.)
11. **(v1.1 · F5) Chuyển nguyên văn** — helper nhận `auditedChanges`, `parentChanged`, `raw` đã tính ở caller,
    không tính lại; giữ tên hành động `TASK_CREATED`/`TaskCreated`/`TASK_UPDATED`/`TaskUpdated`, giữ khuôn
    `oldValues`/`newValues`/`before`/`after` (timeline #245 pin `newValues`).

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

v1.1 — ca thêm / siết theo plan-review:

| Ca                                                      | Loại     | Kỳ vọng                                                                                                                                                                                                                          | Trên mã cũ |
| ------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| C4′ (siết C4, F1) — W ≠ QL đều là watcher; người cũ A   | RED      | B 1 · W 1 · QL 0 · A 0 thông báo `TASK_ASSIGNEE_CHANGED` của việc đó; đo cả «∪ watchers» lẫn «loại actor»                                                                                                                        | ĐỎ         |
| C6b (F4) — PATCH A→B + `dueAt` + `priority` một request | RED      | đúng 1 outbox mỗi loại `task.assignee_changed` · `task.due_date_changed` · `task.priority_changed`; payload hạn/ưu tiên mang `assigneeUserId` = B; sau drain B nhận 1 thông báo mỗi mã (3), A 0                                  | ĐỎ         |
| C8 (siết, F2) — spy ném 400 ở recompute                 | chốt     | spy được gọi ĐÚNG 1 lần; không gửi `Idempotency-Key` (interceptor bỏ qua khi thiếu khoá); cặp dương tính cùng dữ liệu không spy = C1                                                                                             | xanh (giữ) |
| C11 (siết, F6) — cross-tenant                           | DENY     | (1) outbox `task.assigned` của C1 có `company_id` = A; (2) người B PATCH việc A ⇒ 404 + 0 outbox mới cho việc đó; (3) người B tạo việc ở B giao NV công ty A ⇒ 400 + 0 outbox theo tiêu đề; (4) sau drain người B có 0 thông báo | xanh (giữ) |
| C12 — quét payload                                      | bất biến | mọi outbox `task.*` của hai công ty trong spec: không có khoá `description` / `reason`                                                                                                                                           | xanh (giữ) |

Ca nhãn «xanh (giữ)» xanh trên mã cũ theo thiết kế — không tính là RED; mỗi ca đó đứng cạnh một ca dương tính
(C2/C3 ↔ C1 · C7 ↔ C6 · C8 ↔ C1 · C9 ↔ C4 · C11 ↔ C1). Assert người nhận bằng id người dùng cụ thể của spec,
không đếm toàn bảng (lane dùng chung với WO kia của chuỗi).

Hồi quy phải xanh KHÔNG sửa dòng nào (F5): `task-noti-e2e.int-spec.ts`, `task-actions.int-spec.ts`,
`task-patch-field-gate.int-spec.ts`, `goal-be2-link.int-spec.ts`, `task-core.int-spec.ts`; unit
`task-core-codegen.spec.ts` chỉ thêm đối số DI cuối.

Chạy RED trước: commit spec, chạy trên mã cũ (C1, C4, C5, C6, C6b, C10 đỏ; còn lại xanh), rồi mới implement.
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
- (gate SEC-ASN-1) Form Tạo trong dự án ở scope Own/Team: người được giao chỉ cần là thành viên Active của dự án
  (D-27, `resolveAssigneeForProject`), không qua phạm vi tổ chức; `createdWarningsTx` vẫn trả bit
  `TASK-WARN-ASSIGNEE-ON-LEAVE` cho người đó, trong khi `/assign` với cùng người trả 403 `ASSIGNEE_OUT_OF_SCOPE`.
  Tiền lệ cùng bit: `/change-deadline` (`buildDeadlineWarningsTx`) không kiểm phạm vi người đổi hạn với người
  phụ trách. Quyết định sản phẩm cho owner: lịch nghỉ của thành viên dự án ngoài team có cần giới hạn không; nếu
  có ⇒ chỉ thêm cảnh báo khi người được giao trong phạm vi tạo (Company/System luôn được), áp cùng quy tắc cho
  `buildDeadlineWarningsTx`, kèm ca int «PM@Own giao cho thành viên ngoài team đang nghỉ».
- (gate correctness F2) PATCH tự giao khi trước đó chưa có người vẫn phát `task.assigned`, như `/assign`; engine
  NOTI loại actor nên người dùng không thấy gì. Thống nhất với form Tạo = thêm điều kiện `userId !== actor.id` vào
  `enqueueAssigneeTx`, đổi luôn `/assign`.
- (gate silent F2) Tra nghỉ phép/thành viên lỗi ⇒ cả lệnh tạo rollback (500), giống `/assign`. Giữ fail-loud; nếu
  muốn tạo vẫn thành công thì cần mã cảnh báo riêng (vd. `TASK-WARN-LEAVE-CHECK-FAILED`) kèm log lỗi, không nuốt.
- (gate DB-1) Tạo việc CÓ người phụ trách vẫn đọc lại một hàng theo PK cho cảnh báo; bỏ hẳn được bằng cách cho
  `createTaskInTx` trả người phụ trách + dự án hiệu lực (đổi kiểu trả về dùng chung với phân rã) — chưa làm.

## §8 Phản hồi plan-review (v1.1)

| Finding                                                  | Quyết định                                                                                                                         | Căn cứ đo                                                                                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F0 HIGH — plan không đọc được lúc rà                     | Chấp nhận: đối chiếu bảng ca với F1–F6, vá thành v1.1 trước commit RED                                                             | plan có ở `e39bb121`; bảng ca §4                                                                                                                                                 |
| F1 HIGH — «không phát» chỉ đếm thông báo thì xanh rỗng   | Chấp nhận. C2/C3 đã assert ở tầng outbox (v1); C4′ thêm W ≠ QL và A = 0                                                            | engine loại actor `notification-recipient-resolver.service.ts:50-51`; audience đọc watcher `task-audience.reader.ts`                                                             |
| F2 MED — C8 chỉ có nghĩa khi enqueue trước recompute     | Chấp nhận (§3.9, C8 siết). Đột biến «enqueue qua kết nối riêng» bị C8 bắt (hàng outbox commit độc lập ⇒ 1 ≠ 0) và C1 (`xmin` lệch) | recompute `task-core.service.ts:596-598`; interceptor bỏ qua khi thiếu khoá `idempotency.interceptor.ts:70`                                                                      |
| F3 MED — `commonPayload` còn dùng ở changeStatus         | Chấp nhận (§3.7)                                                                                                                   | `task-actions.service.ts:279`                                                                                                                                                    |
| F4 MED — payload hạn/ưu tiên mang người CŨ khi PATCH gộp | Chấp nhận (§3.8, C6b); gộp thông báo ⇒ followup cho owner                                                                          | `buildGatedPatch` ghi người mới cùng request `task-patch-field-gate.ts:118-123`; cache dashboard theo `payload.assigneeUserId` `dashboard-cache-invalidation.registrar.ts:70-74` |
| F5 MED — chuyển khối audit phải chứng minh không đổi     | Chấp nhận (§3.11 + danh sách hồi quy §4)                                                                                           | `task-core.service.ts:761-798`                                                                                                                                                   |
| F6 MED — cross-tenant chưa cụ thể                        | Chấp nhận (C11 siết 4 vế)                                                                                                          | `outbox_events` chung, claim không lọc tenant — drain qua `acquireOutboxWorkerLock`                                                                                              |
| F7 MED — chung worktree/lane với WO kia                  | Chấp nhận: assert theo id cụ thể; rebase + chạy lại int-spec mới sau khi WO kia merge = việc của luồng chính (followup)            | —                                                                                                                                                                                |
| F8 LOW                                                   | Chấp nhận: hạn C10 lúc 05:00Z                                                                                                      | `task-actions.service.ts:618-623`                                                                                                                                                |
| F9 LOW                                                   | Chấp nhận một phần: warnings chỉ tính ở wrapper (§3.10); không thêm ca int cho phân rã (followup)                                  | `goal-decompose.service.ts:241-263`                                                                                                                                              |
| F10 · F11 LOW                                            | Followup (KPI #10 chưa đo; đua đọc không khoá có sẵn như `/assign`)                                                                | `task-core.service.ts:623`, `task-actions.service.ts:522`                                                                                                                        |

## §9 Kết quả đo (lane `mediaos_w26b`)

- RED (`80557cc2`, mã cũ): int-spec 6 đỏ / 7 xanh — đỏ đúng C1 · C4 · C5 · C6 · C6b (0 outbox) và C10 (không có
  `warnings`); C2 · C3 · C7 · C8 · C9 · C11 · C12 xanh theo thiết kế. Unit đỏ vì chưa có module.
- GREEN (`ba29d9df`): int-spec 13/13 + unit 8/8 + `task-core-codegen` 4/4. Hồi quy xanh không sửa dòng nào:
  `task-noti-e2e` · `task-actions` · `task-patch-field-gate` · `goal-be2-link` · `task-core` · `goal-tpl1-decompose`
  · `qa2-e2e-task-noti-dash` · `dashboard-cache-invalidate` · `task-qa1-fsm-collab` · `task-move-state` ·
  `task-kanban-move-activity` · `task-subtask-counting` + ratchet `pipeline-parity` · `outbox-worker-lock` + unit
  `src/tasks` · `src/goals` · `src/dashboard` (455). Typecheck api + build contracts + eslint tệp chạm: sạch.
- Đột biến (F2): cho `task.assigned` của form Tạo đi qua kết nối riêng ⇒ C1 đỏ (`xmin` outbox ≠ `xmin` hàng việc)
  và C8 đỏ (1 outbox sau rollback). Đã hoàn nguyên.

## §10 Xử lý finding gate

| Finding                                             | Quyết định                                                                                                     | Căn cứ đo                                                                                                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| silent F1 — PATCH đổi người, hàng sau không có user | Vá: nhánh này nổ `TASK-ERR-ASSIGNEE-WITHOUT-USER` (500, rollback cả PATCH) thay vì bỏ sự kiện không tiếng động | Bất biến có sẵn: `resolveAssignee` đòi tài khoản (400) trước khi ghi. Ca unit mới; gỡ vá ⇒ đỏ «promise resolved "undefined" instead of rejecting». Thêm ca «gỡ người phụ trách ⇒ không phát, không nổ» |
| DB-1 · correctness F1 — đọc lại hàng mọi lần tạo    | Vá: `createTask` chỉ gọi `createdWarningsTx` khi dto có người phụ trách                                        | Ca unit mới ở `task-core-codegen.spec.ts` (+ ca dương có người phụ trách); gỡ vá ⇒ đỏ «expected "spy" to not be called at all, but actually been called 1 times»                                       |
| SEC-ASN-1 LOW — bit nghỉ phép ngoài phạm vi tổ chức | Nợ §7, quyết định sản phẩm cho owner                                                                           | `/assign` dùng `assertAssigneeInScope`; nhánh dự án dùng `resolveAssigneeForProject` (D-27); `/change-deadline` cùng bit không kiểm phạm vi                                                            |
| correctness F2 — PATCH tự giao vẫn phát             | Giữ (khớp `/assign`), ghi §7 + PR                                                                              | `enqueueAssigneeTx` không so actor ở cả hai đường; done_when 1 chỉ nói form Tạo                                                                                                                        |
| silent F2 — tra cảnh báo lỗi làm hỏng cả lệnh tạo   | Giữ fail-loud (khớp `/assign`), ghi §7 + PR                                                                    | `/assign` cũng gọi `buildAssignWarningsTx` trong tx                                                                                                                                                    |

Sau vá (lane `mediaos_w26b`): unit `task-assign-events` + `task-core-codegen` 16/16 · int `s20-task-assign-noti` 13/13
· `task-patch-field-gate` + `task-core` 37/37 · typecheck api + eslint tệp chạm sạch.
