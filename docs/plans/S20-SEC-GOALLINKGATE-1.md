# S20-SEC-GOALLINKGATE-1 — plan v1.1

> Zone 🔴 (permission / data-scope) · gate FULL · nhánh `fix/s20-sec-goallinkgate-1` cắt từ `98b18f16`.
> Đo trên `98b18f16`. Nhãn: **[ĐO]** = đọc mã/grep tại commit này · **[SUY RA]** = lập luận, chưa chạy.
> Quyết định owner 25/10/2026 (đã chốt, không mở lại): gắn việc vào mục tiêu `Completed`/`Cancelled` ⇒ từ chối; `Draft` ⇒ được gắn.
> v1.1 = v1 + plan-review (PASS_WITH_FIXES, 10 finding): áp cả 10, F9 áp phần ca đua (giữ thứ tự khoá-rồi-kiểm, lý do §3.3). Chi tiết §9.

## §1 Bất biến + phạm vi

- **I-1 (cùng dữ liệu, cùng quyết định quyền):** một việc đang thuộc mục tiêu A, khi được gắn sang mục tiêu B, thì mục tiêu A
  nhận ĐÚNG lớp quyết định (cho phép | từ chối + mã GOAL-ERR) mà đường tháo `DELETE /goals/A/tasks/:taskId` đưa ra cho cùng
  người gọi, cùng dữ liệu (quyền ghi `update:goal` trên A + A chưa chốt kỳ). «Chuyển» = «tháo khỏi A» + «gắn vào B»; mỗi đầu qua
  cổng của đường tương ứng. So sánh ở vế mục tiêu A, với người gọi CÓ quyền ghi việc (thứ tự kiểm việc/mục tiêu của hai đường khác
  nhau — `goal-tasks-link.service.ts:126` vs `:168/:172` — nên tổ hợp thiếu cả hai quyền không thuộc phép so).
  **Ngoại lệ ghi rõ (quy tắc DƯƠNG):** A đã xoá mềm (đọc được hàng A cùng công ty với `deleted_at IS NOT NULL`) ⇒ cho chuyển
  (đường tháo trả 404 cho A đã xoá; không cho chuyển = việc bị khoá chết, vì không đường nào khác ghi `goal_id` — §2a) và VẪN ghi
  audit ở A. Không đọc được hàng A ⇒ từ chối (fail-closed), không bao giờ «vắng ⇒ cho».
- **I-2:** mục tiêu đích chỉ nhận việc khi trạng thái thuộc tập cho phép `{Draft, Active}` (quy tắc DƯƠNG — trạng thái lạ/tương lai ⇒ từ chối).
- **I-3:** từ chối ⇒ 0 hàng `tasks` đổi, 0 hàng `audit_logs` mới (tất-cả-hoặc-không cho cả lô).
- **I-4:** chuyển thành công ⇒ audit ghi ở CẢ HAI mục tiêu (append-only) + tiến độ tính lại ở cả hai.
- **I-5:** kiểm + ghi trong MỘT transaction, trên hàng ĐÃ KHOÁ (việc + mục tiêu) ⇒ không có cửa sổ giữa «đọc liên kết / kiểm
  mục tiêu chưa chốt» và «ghi».
- **I-6:** cô lập tenant giữ nguyên (việc/mục tiêu công ty khác ⇒ 404, không đổi hàng nào).
- Phạm vi: `POST /goals/:id/tasks` + `DELETE /goals/:id/tasks/:taskId` (GOAL-API-010). Không migration, không đổi DTO/contracts, không đổi FE.

## §2 Đo trên `98b18f16`

### 2a. Census MỌI đường ghi `tasks.goal_id` [ĐO — grep `goal_id`/`goalId` trong `apps/api/src`, loại spec]

| #   | Nơi ghi                                                                                            | Gọi từ                                                                                                          | Có mục tiêu CŨ?                   | Cổng hiện có                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W1  | `goals.repository.ts:484-498` `setTaskGoalTx` (UPDATE không vị từ `goal_id`)                       | `goal-tasks-link.service.ts:133` `linkTasks`                                                                    | **có** (`task.goalId` đọc ở :124) | đích: `loadWritableGoalTx` :114 · việc: `update:task` write-scope :126 · neo GOAL-ERR-008 :127. Đường gắn chưa áp cho mục tiêu đang giữ việc cùng quyết định với đường tháo, và chưa có cổng trạng thái đích |
| W2  | `goals.repository.ts:504-520` `clearTaskGoalTx` (vị từ `goal_id = :goalId`)                        | `goal-tasks-link.service.ts:174` `unlinkTask`                                                                   | n/a (chính nó là cũ)              | `loadWritableGoalTx` :168 + `update:task` :172                                                                                                                                                               |
| W3  | `task-core.repository.ts:664-680` `insertTaskCoreTx` (`goal_id = v.goalId ?? null`)                | `task-core.service.ts:559` ← `createTaskInTx`; caller có `goalId` DUY NHẤT: `goal-decompose.service.ts:235/253` | không (việc mới)                  | `loadDecomposableGoalTx` :196-210 (ghi + chưa chốt + chặn `Cancelled` :206)                                                                                                                                  |
| W4  | FK `tasks.goal_id → goals` `ON DELETE SET NULL` (`migrations/0535_…:502`, FK tổng hợp theo tenant) | goals chỉ xoá MỀM (`goals.repository.ts` `softDeleteTx`) ⇒ không kích hoạt                                      | —                                 | —                                                                                                                                                                                                            |

- `POST /tasks` không nhận `goalId` (contracts `task.ts:738` chỉ ở response schema; `task-core.repository.ts:177-179`) [ĐO].
- PATCH task (`updateTaskCoreTx`, map không có `goal_id`, `task-core.repository.ts:693-703`) không ghi cột này; đổi dự án GIỮ liên kết (`task-core.service.ts:806`) [ĐO].
- Drizzle ĐÃ type cột `goalId` (`db/schema/workflow.ts:89`, trái chú thích cũ `goals.repository.ts:458`) ⇒ đo thêm: 2 lời gọi
  `.insert(tasks)` (`hr-tasks.service.ts:71`, `tasks.repository.ts:242`) không đặt `goalId`; 5 lời gọi `.update(tasks)` không đặt `goalId` [ĐO].
- Ngoài TASK/GOAL không module nào ghi cột này; migration chỉ 0504/0505/0510/0535 nhắc `goal_id`, không trigger ghi [ĐO].
- Không có đường khôi phục mục tiêu đã xoá mềm (grep `restore|undelete` trong `apps/api/src/goals` = 0) [ĐO].
- ⇒ Đường cần vá: **W1 duy nhất** (+ W2 dùng chung khuôn khoá). W3 chỉ lệch tập trạng thái (§8 N1).

### 2b. Hàm quyết định sẵn có [ĐO]

- `GoalTasksLinkService.loadWritableGoalTx` (`goal-tasks-link.service.ts:264-271`): `resolveActorScope(…,'update')` →
  `findByIdTx` (404, lọc `deleted_at is null` — `goals.repository.ts:213-219`) → `GoalAccessService.assertCanWriteExistingGoal`
  (`goal-access.service.ts:170-178`) → `assertNotFinalized` (:280-282). Đây là cổng của đường tháo (W2) ⇒ là hàm phải tái dùng cho
  mục tiêu cũ ở W1.
- `assertWriteTarget` (`goal-access.service.ts:243-276`) cho phép theo thứ tự: Owner/Manager dự án (mục tiêu cấp dự án) → Own
  (mục tiêu cá nhân của chính actor) → phòng trong phạm vi HOẶC actor là người phụ trách chính khi `allowOwnerFallback`
  (bật cho hàng đã lưu, :162) ⇒ fixture từ chối phải loại trừ hai nhánh cho phép đầu và nhánh người phụ trách (§4).
- Mã lỗi: `GOAL-ERR-005` (`FINALIZED`) · `GOAL-ERR-FORBIDDEN` (`FORBIDDEN_CREATE`, 403 minh bạch in-tenant) · `GOAL-ERR-008` neo ·
  `GOAL-ERR-009` phân rã. **Không có mã cho «gắn vào mục tiêu đã đóng»**; dải đang dùng `001…015` (`goals.errors.ts`, SPEC-10 §12,
  API-12 dòng 205/223) ⇒ thêm **GOAL-ERR-016**, 422 (khớp `CHECKIN_STATUS`/`DECOMPOSE_CANCELLED`).
- FE hiện thông điệp server nguyên văn (`GoalCheckinDialog.tsx:29`, `GoalTaskPickerDialog.tsx:125-126`) ⇒ mã mới không cần FE [ĐO].
- Mã HTTP thành công khác nhau: POST `:id/tasks` 201, DELETE `:id/tasks/:taskId` 200 (không `@HttpCode`, `goals.controller.ts:180/192`) [ĐO].

### 2c. Khoá hàng [ĐO]

- `apps/api/src/goals/**` có **0** câu `FOR UPDATE` trong đường gắn/tháo. Chốt kỳ dùng vị từ `finalized_at is null` trên UPDATE
  (`goals.repository.ts:410-434`, `goal-checkin.service.ts:166-167`) — chống đua chốt↔chốt, KHÔNG chống đua chốt↔chuyển việc.
- Khuôn có sẵn: drizzle `.for("update")` (`task-file.repository.ts:238`); mảng tham số `any(${sql.param([...ids])}::uuid[])`
  (`room-audience.reader.ts:37`); vị từ chờ khoá dùng chung `waitForBlockedBy` (`test/helpers/lock-wait.ts:61`, đếm cạnh chặn thật
  `pg_blocking_pids` của holder, không khớp chữ câu lệnh).
- Thứ tự khoá của writer TASK: UPDATE `tasks` rồi recompute UPDATE `goals` (task → goal) [ĐO `task-core.service.ts:800-812`].
- `recomputeGoalTx` chỉ UPDATE khi giá trị đổi (`goal-progress-engine.service.ts:126-128`) và bỏ qua mục tiêu đã chốt (:124);
  mode `tasks` = `done/total`, `total = 0` ⇒ `null` (:71-73) [ĐO].
- `tasks` có `FORCE ROW LEVEL SECURITY` (`migrations/0008_workflow.sql:220`); request chạy trong `withTenant` [ĐO].

### 2d. Dữ liệu cấp quyền (seed) [ĐO]

- `update:goal` seed ở 3 phạm vi Own / Department / Company (`0506:74-76`); `update:task` ở Own/Team/Company (`0485:155,178` · `0501:44,46`).
  Bảng vai trò × đường × kết quả: tệp chi tiết NGOÀI repo (kênh owner).

### 2e. Hồi quy tiềm năng [ĐO]

- Int-spec đang gắn việc (`goal-be2-link`, `goal-be2-progress`, `goal-be2-checkin`, `goals-param-uuid`, `routehttp3-tasks-goals`):
  mọi mục tiêu đích `status: "Active"` hoặc `seedGoal()` mặc định `Active`; ca chuyển `goal-be2-link` L3 chạy bằng vai trò Company
  với mục tiêu cũ Active chưa chốt ⇒ không đổi kết quả.
- Mục tiêu xoá mềm KHÔNG gỡ `tasks.goal_id` (đường xoá chỉ chặn còn mục tiêu con) ⇒ việc có thể trỏ tới mục tiêu đã xoá.

## §3 Thiết kế

1. **Một hàm quyết định ghi** `assertGoalWritableTx(tx, user, actor, goal)` (private, `GoalTasksLinkService`) = đúng hai dòng
   `assertCanWriteExistingGoal` + `assertNotFinalized` tách khỏi `loadWritableGoalTx`. Gọi ở: đích W1 · **mục tiêu cũ W1** · W2.
   Không biểu thức quyền thứ hai. `actor` = `resolveActorScope('update')` resolve MỘT lần/request, dùng cho mọi đầu.
2. **Cổng trạng thái đích** `assertLinkTargetOpen(goal)`: `LINKABLE_GOAL_STATUSES = {Draft, Active}`; ngoài tập ⇒ 422
   `GOAL_ERR.LINK_CLOSED(status)` = `GOAL-ERR-016`. Chỉ áp cho ĐÍCH của W1 (tháo khỏi mục tiêu đã đóng vẫn theo luật W2 hiện hành).
3. **Khoá, thứ tự cố định task → goal** (khớp writer TASK, tránh 40P01 giữa hai phép chuyển chéo):
   - fail-fast trên hàng CHƯA khoá: `findByIdTx(đích)` → 404 · `assertGoalWritableTx` · `assertLinkTargetOpen` (giữ thứ tự lỗi hiện tại);
   - `repo.lockTaskRefsTx(tx, companyId, taskIds)` — cùng projection `resolveTaskRefTx`, `id = any(…)`, `order by tk.id`, `for update of tk`;
     thiếu id nào ⇒ 404 `REF_NOT_FOUND` (cả lô);
   - `repo.lockGoalsTx(tx, companyId, ids)` — `{đích} ∪ {goal cũ ≠ đích}`, `order by id`, `.for("update")`, **KHÔNG lọc `deleted_at`**
     (trả cả hàng xoá mềm, kèm `deletedAt`);
   - quyết định CUỐI trên hàng đã khoá: đích vắng hoặc `deletedAt ≠ null` ⇒ 404 `NOT_FOUND`; đích qua lại `assertGoalWritableTx` +
     `assertLinkTargetOpen`; mỗi việc: `assertTaskWritableTx` → `assertLinkAllowed` (GOAL-ERR-008) → nếu `goalId ≠ null` và ≠ đích:
     hàng cũ vắng ⇒ 404 `NOT_FOUND` (fail-closed; dưới FK tổng hợp + không xoá cứng thì không với tới bằng dữ liệu — phòng thủ) ·
     hàng cũ `deletedAt ≠ null` ⇒ cho (ngoại lệ I-1) · còn lại ⇒ `assertGoalWritableTx(cũ)`.
   - Kiểm phạm vi ghi việc chạy SAU khoá (không thêm vòng kiểm trước khoá): khoá chỉ sống trong tx, lần từ chối đầu tiên rollback
     nhả khoá; số hàng khoá ≤ trần bulk của DTO; vòng kiểm trước khoá vẫn phải lặp lại sau khoá ⇒ gấp đôi truy vấn mà không đổi quyết định.
4. **W2 cùng khuôn:** fail-fast → `lockTaskRefsTx([taskId])` → `lockGoalsTx([goalId])` → `assertGoalWritableTx` trên hàng khoá → clear.
5. **Audit (I-4):** giữ `GoalTaskLinked` ở đích (`after.previousGoalId`); thêm `GoalTaskUnlinked` ở mục tiêu cũ — kể cả mục tiêu cũ
   đã xoá mềm — (`before {taskId, taskCode}`, `after {movedToGoalId}`); tái dùng action của W2, `objectType 'goal'` đã có (không đổi CHECK).
6. **Recompute:** giữ nguyên khối `goal-tasks-link.service.ts:150-155` (đích + mọi goal cũ + dự án). Goal cũ đã xoá mềm:
   `findProgressRowTx` lọc `deleted_at` ⇒ no-op [ĐO `goal-progress-engine.repository.ts` dòng `g.deleted_at is null`].
7. Repository: `resolveTaskRefTx` thay bằng `lockTaskRefsTx` ở W1/W2, xoá nếu 0 caller. Khi chạm mã: sửa chú thích cũ «FK ĐƠN CỘT»
   (`goals.repository.ts:461`, `goal-tasks-link.service.ts:42`) theo 0535 (FK tổng hợp theo tenant) và chú thích «cột chưa typed»
   (`goals.repository.ts:458`). `goals.repository.ts` 540 → ~580 dòng; service 272 → ~330 dòng (< 800).

## §4 Bảng ca test — int-spec MỚI `apps/api/test/integration/goal-linkgate.int-spec.ts`

Dựng app qua `applyMainPipeline` (`test/helpers/bootstrap-app.ts`); `describe.skipIf(!hasLaneDb)`; chạy lane `mediaos_w25r`.

**Vai trò TỰ TẠO** qua `seedRole`/`seedRolePermission` (`test/helpers/seed.ts`), tên mang tiền tố riêng của spec (`goal-linkgate-…`),
công ty seed qua `seedCompany` cũng mang tiền tố đó. `afterAll`: `tasks.goal_id = NULL` → xoá `goal_updates` → xoá `goals` →
`cleanupTenants` (đã xoá `user_roles`/`role_permissions`/`roles` không-hệ-thống theo công ty — `seed.ts:785-789`); khuôn `goal-be2-link.int-spec.ts:214-224`.
Ba vai trò (cặp + phạm vi là dữ liệu fixture, không dùng tên vai trò canonical):
**P-Dept** = `update:goal@Department` (phòng X) + `view:goal@Company` + `update:task@Company` + `read:task@Company` (cô lập cổng goal) ·
**P-Own** = `update:goal@Own` + `update:task@Own` + `view:goal@Department` + `read:task@Own` · **P-Co** = mọi cặp @Company.

**Ràng buộc fixture (đọc lại hàng, assert tiền điều kiện trong spec):**

- Mục tiêu cũ của ca từ chối quyền: cấp `department`/`employee` (KHÔNG `project`), `owner_employee_id ≠` nhân viên của actor, actor
  không là thành viên dự án nào của việc.
- Ca tiến độ (A1, A3): cả hai mục tiêu `progress_mode='tasks'`; việc được chuyển ở trạng thái Done; mục tiêu cũ có thêm một việc
  chưa Done ⇒ assert số cụ thể: cũ 50 → 0, mới null → 100.
- Mỗi probe ghi dữ liệu chạy trên fixture MỚI (việc + mục tiêu riêng) — không probe nào đọc kết quả ghi của probe khác.
- Ca đua (R7, R8, R9): holder lấy từ pool RIÊNG (không chiếm `directPool` max 4), `end()` trong `finally`. Trình tự: holder mở tx +
  giữ khoá hàng (chưa commit) → phóng request → `waitForBlockedBy(pool, holderPid, 1, { timeoutMs: 5000 })` PHẢI `true` (assert có
  nhãn; hết trần ⇒ ca ĐỎ, không lặng lẽ commit) → holder commit → assert kết quả request + hàng DB.

| Ca  | Bất biến được kiểm                                                                                                           | Kỳ vọng                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| R1  | I-1 — mục tiêu cũ ngoài phạm vi ghi (P-Dept, cũ ở phòng ≠ X)                                                                 | 403 GOAL-ERR-FORBIDDEN · `goal_id` giữ · 0 audit mới                                             |
| A1  | I-1 + I-4 — mục tiêu cũ trong phạm vi ghi (P-Dept, cũ ở phòng X)                                                             | 201 · cũ 50→0, mới null→100 · 2 audit                                                            |
| R2  | I-1 — như R1 với phạm vi Own (cũ là mục tiêu phòng)                                                                          | 403 · `goal_id` giữ                                                                              |
| A2  | I-1 — phạm vi Own, cũ là mục tiêu cá nhân của chính actor                                                                    | 201                                                                                              |
| P1  | I-1 parity — cùng người gọi + cùng dữ liệu (fixture mới mỗi probe): `DELETE /goals/cũ/tasks/:id` và chuyển sang mục tiêu mới | CÙNG lớp quyết định ở vế cũ (cho phép · hoặc từ chối + CÙNG mã GOAL-ERR) cho P-Dept, P-Own, P-Co |
| R3  | I-1 — mục tiêu cũ đã chốt kỳ (P-Co)                                                                                          | 422 GOAL-ERR-005 · `goal_id` giữ                                                                 |
| A3  | I-4 — mục tiêu cũ chưa chốt (P-Co)                                                                                           | 201 · `GoalTaskUnlinked` ở cũ có `movedToGoalId` · số tiến độ như A1                             |
| R4  | I-2 — đích `Completed`                                                                                                       | 422 GOAL-ERR-016 · 0 hàng đổi                                                                    |
| R5  | I-2 — đích `Cancelled`                                                                                                       | 422 GOAL-ERR-016                                                                                 |
| A4  | I-2 — đích `Draft` (quyết định owner)                                                                                        | 201                                                                                              |
| R6  | I-3 — lô có một việc vi phạm I-1                                                                                             | 422 · việc hợp lệ KHÔNG đổi `goal_id` · 0 audit                                                  |
| R7  | I-5 vế mục tiêu — đồng thời với chốt kỳ mục tiêu cũ (holder: UPDATE `finalized_at` của cũ)                                   | 422 GOAL-ERR-005 · `goal_id` giữ                                                                 |
| R8  | I-5 vế việc — đồng thời với đổi liên kết của việc sang mục tiêu ngoài phạm vi P-Dept (holder: UPDATE `tasks.goal_id`)        | 403 · `goal_id` = giá trị holder đã commit                                                       |
| R9  | I-5 vế đích — đồng thời với chốt kỳ mục tiêu đích (holder: UPDATE `finalized_at` của đích)                                   | 422 GOAL-ERR-005 · `goal_id` giữ                                                                 |
| A5  | I-1 ngoại lệ — mục tiêu cũ đã xoá mềm                                                                                        | 201 · `GoalTaskUnlinked` ở mục tiêu cũ (đã xoá) có `movedToGoalId`                               |
| X1  | I-6 — việc công ty khác (đang gắn mục tiêu của công ty đó)                                                                   | 404 · hàng công ty kia không đổi · 0 audit ở đó                                                  |
| X2  | I-6 — mục tiêu đích công ty khác                                                                                             | 404                                                                                              |
| U1  | hồi quy W2 sau refactor — tháo khỏi mục tiêu đã chốt (P-Co)                                                                  | 422 GOAL-ERR-005                                                                                 |

Đo RED: chạy spec trên mã `98b18f16` TRƯỚC khi vá; kết quả từng ca (và lý do đỏ) ghi ở tệp chi tiết NGOÀI repo; PR chỉ ghi số tổng
(N đỏ / M xanh trước vá · tất cả xanh sau vá). Tên `it(...)` mô tả bất biến (cột 2), không mô tả đường đi.
Hồi quy: chạy lại `goal-be2-link`, `goal-be2-progress`, `goals-param-uuid`, `routehttp3-tasks-goals`, `goal-tpl1-decompose` (lô ≤ 3 tệp).
Unit: `apps/api/src/goals/` có 0 tệp spec [ĐO] — cổng sống ở int-spec (đường thật, DB thật); đột biến đo bằng int-spec.

## §5 Đột biến (mỗi cái phải bị ít nhất một ca giết, trừ cái ghi «tương đương»)

| M   | Đột biến                                                               | Ca giết                       |
| --- | ---------------------------------------------------------------------- | ----------------------------- |
| M1  | bỏ lời gọi `assertGoalWritableTx(cũ)`                                  | R1 · R2 · R3 · P1             |
| M2  | goal cũ chỉ `assertNotFinalized` (bỏ vế quyền ghi)                     | R1 · R2 · P1                  |
| M3  | goal cũ chỉ quyền ghi (bỏ `assertNotFinalized`)                        | R3 · R6 · R7                  |
| M4  | goal cũ dùng actor `view` thay `update`                                | R1 (P-Dept có `view@Company`) |
| M5  | bỏ `assertLinkTargetOpen`                                              | R4 · R5                       |
| M6  | tập cho phép chỉ loại `Cancelled` (như phân rã)                        | R4                            |
| M7  | tập cho phép chỉ `{Active}`                                            | A4                            |
| M8  | bỏ `.for("update")` ở `lockGoalsTx`                                    | R7                            |
| M9  | bỏ `for update of tk` ở `lockTaskRefsTx` (đọc `goal_id` cũ trước khoá) | R8                            |
| M10 | bỏ audit ở goal cũ                                                     | A3 · A5                       |
| M11 | goal cũ đã xoá mềm ⇒ ném 404                                           | A5                            |
| M12 | bắt lỗi từng việc rồi bỏ qua (gắn một phần)                            | R6                            |
| M13 | bỏ `company_id` ở `lockTaskRefsTx`                                     | **tương đương** — xem dưới    |
| M14 | bỏ recompute goal cũ (`goal-tasks-link.service.ts:151-152`)            | A1 · A3                       |
| M15 | bỏ kiểm lại đích trên hàng đã khoá (chỉ giữ fail-fast)                 | R9                            |
| M16 | goal cũ vắng khỏi kết quả khoá ⇒ cho chuyển (mô hình âm)               | **tương đương** — xem dưới    |

- Cơ chế R8/M9: trên mã vá, request chờ ở `lockTaskRefsTx` (khoá hàng việc) rồi đọc `goal_id` holder đã commit ⇒ 403. Dưới M9,
  request đọc `goal_id` cũ không chờ, qua kiểm, rồi chờ ở `setTaskGoalTx` (UPDATE cùng hàng) và ghi đè ⇒ 201. Cả hai đều đạt
  điều kiện chờ của `waitForBlockedBy`; chỉ kết quả khác ⇒ M9 bị giết.
- Cơ chế R7/M8 và R9/M15: trên mã vá, request chờ ở `lockGoalsTx`; dưới đột biến, request hoặc không bị chặn (hết trần ⇒ ca ĐỎ)
  hoặc chỉ bị chặn ở recompute/ghi rồi trả 201 ⇒ cả hai nhánh đều giết.
- M13 tương đương: `tasks` FORCE RLS (`0008_workflow.sql:220`) + request trong `withTenant` ⇒ hàng công ty khác không hiện với
  câu khoá dù bỏ vị từ `company_id`; X1 vẫn 404. Lớp chặn ở đây là RLS (đã có test cô lập 2-tenant); vị từ `company_id` giữ làm
  lớp thứ hai theo CLAUDE.md §2.1. Loại khỏi phép đếm sống/chết.
- M16 tương đương với dữ liệu với tới được: FK tổng hợp `(company_id, goal_id)` (0535:502) + mục tiêu chỉ xoá mềm ⇒ việc có
  `goal_id ≠ null` luôn có hàng mục tiêu cùng công ty. Nhánh fail-closed là phòng thủ; ghi rõ không có ca giết.

Chạy đột biến bằng script ngoài repo (khuôn `kept/…/mutants-*.mjs`): áp từng đột biến → chạy spec → khôi phục; ghi số sống/chết
(14 đột biến được đếm, 2 tương đương có lý do).

## §6 Tệp đổi

Trong `paths` WO: `apps/api/src/goals/goal-tasks-link.service.ts` · `goals.repository.ts` · `goals.errors.ts` (+ `LINK_CLOSED` GOAL-ERR-016) ·
`apps/api/test/integration/goal-linkgate.int-spec.ts` (mới) · `docs/SPEC/SPEC-10 GOAL.md` §12 (dòng GOAL-ERR-016 + ghi chú «chuyển = tháo + gắn»,
ngoại lệ mục tiêu cũ đã xoá mềm; GOAL-ERR-005 thêm «chuyển việc khỏi mục tiêu đã chốt») · `docs/plans/S20-SEC-GOALLINKGATE-1.md`.
`goal-access.service.ts` dự kiến KHÔNG đổi (hàm tái dùng nằm sẵn ở đó).

pathsNeeded (ngoài `paths`): `docs/API Design/API-12_GOAL_API_Design.md` dòng 205/223 (dải `001…015` → `001…016`).
`harness/backlog.mjs` là việc luồng chính.

## §7 Deploy · tương thích · rollback

- Chỉ API (owner deploy tay). FE Pages không đổi. Không migration, không backfill, không đổi shape DTO.
- FE cũ + API mới: hai trường hợp mới bị từ chối trả 403/422 kèm thông điệp có mã — FE hiện nguyên văn (§2b) ⇒ không gãy.
  API cũ + FE mới: không có FE mới trong WO.
- Rollback: revert commit + deploy lại API; không dữ liệu nào cần đảo (WO chỉ thêm từ chối + thêm hàng audit append-only).
- **Thứ tự với `S20-GOAL-BULKLINK-1`** (chuỗi G, FE tự lên Pages khi merge): BULKLINK KHÔNG được lên PROD trước khi API của WO này
  đã deploy (ghi chú của cả hai WO trong backlog đòi điều này, nhưng `depends_on` của BULKLINK chưa có WO này). Đề nghị luồng chính:
  thêm `S20-SEC-GOALLINKGATE-1` vào `depends_on` của BULKLINK, hoặc giữ PR BULKLINK ở trạng thái chờ tới khi API này deploy.
- Repo public: merge và deploy API trong cùng khung thời gian; mô tả PR trung tính (bất biến + số đo), không mô tả cách tái hiện.

## §8 Ngoài phạm vi / nợ

- N1 — Phân rã (W3) chặn `Cancelled` nhưng cho `Completed` (`goal-decompose.service.ts:206`); I-2 cho gắn chặn cả hai.
  Lệch tập trạng thái giữa hai đường tạo liên kết ⇒ cần owner chốt (ghi ở openQuestions; KHÔNG sửa trong WO này).
- N2 — Chốt kỳ (`goal-checkin.service.ts:149-195`) không khoá hàng goal trước recompute cuối ⇒ ảnh chụp tiến độ có thể lỡ
  một thay đổi việc ĐỒNG THỜI (đúng cho mọi writer TASK, không riêng WO này). Bất biến liên kết vẫn giữ nhờ khoá phía chuyển.
- N3 — Bubble lên goal cha khi recompute không theo thứ tự khoá cố định (có từ trước) ⇒ 40P01 hiếm vẫn có thể; không đổi ở đây.
- N4 — FE: tab «Công việc gắn»/picker nên khoá nút gắn khi mục tiêu `Completed`/`Cancelled` và báo trước «việc đang thuộc mục tiêu
  khác» (thuộc S20-GOAL-BULKLINK-1 / luồng auto-link).
- N5 — Thông điệp 403 ở goal cũ là thông điệp chung của `assertCanWriteExistingGoal` (cùng hàm ⇒ cùng câu chữ); làm rõ «mục tiêu
  đang giữ việc» là việc UX phía FE.
- N6 — Mục tiêu xoá mềm vẫn để `tasks.goal_id` trỏ tới (có từ trước, §2e).

## §9 Plan-review v1 → v1.1 (xác minh từng finding bằng mã)

| F   | Kết luận    | Đo / thay đổi                                                                                                                                                         |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | áp          | Ca đua dùng chung một trình tự đồng bộ (§4) qua `waitForBlockedBy` (`lock-wait.ts:61`) thay vị từ `wait_event_type` khớp chữ; cơ chế M9 ghi ở §5                      |
| F2  | áp          | §2a hàng W1 viết lại thành câu bất biến; bỏ đoạn suy luận tổ hợp quyền ở §2d; §4 chỉ còn «ca · bất biến · kỳ vọng»; chi tiết đo ở tệp ngoài repo                      |
| F3  | áp          | `findByIdTx` lọc `deleted_at` (`goals.repository.ts:217`) ⇒ `lockGoalsTx` không lọc, quy tắc dương `deletedAt ≠ null` ⇒ cho; vắng ⇒ 404; ghi vào I-1; A5 assert audit |
| F4  | áp          | POST 201 / DELETE 200 (`goals.controller.ts:180/192`) ⇒ parity theo lớp quyết định; fixture mới mỗi probe; tổ hợp có quyền ghi việc                                   |
| F5  | áp          | `0008_workflow.sql:220` FORCE RLS ⇒ M13 tương đương, loại khỏi đếm; sửa chú thích «FK ĐƠN CỘT» khi chạm mã (§3.7)                                                     |
| F6  | áp          | `applyIfChangedTx` chỉ ghi khi đổi (`goal-progress-engine.service.ts:126-128`) ⇒ fixture mode `tasks` + số cụ thể; thêm M14                                           |
| F7  | áp          | `backlog.mjs` BULKLINK `depends_on` không có WO này ⇒ §7 thêm ràng buộc thứ tự, đề nghị luồng chính                                                                   |
| F8  | áp          | `goal-access.service.ts:243-252` (vai trò dự án) + `:267-271` (người phụ trách) ⇒ ràng buộc fixture + assert tiền điều kiện                                           |
| F9  | áp một phần | Thêm R9 + M15 (kiểm lại đích sau khoá). Không thêm vòng kiểm phạm vi việc trước khoá — lý do ở §3.3                                                                   |
| F10 | áp          | Tiền tố riêng cho vai trò/công ty; `cleanupTenants` đã xoá `roles`/`role_permissions` theo công ty (`seed.ts:785-789`)                                                |
