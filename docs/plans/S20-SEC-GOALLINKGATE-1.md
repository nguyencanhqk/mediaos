# S20-SEC-GOALLINKGATE-1 — plan v1

> Zone 🔴 (permission / data-scope) · gate FULL · nhánh `fix/s20-sec-goallinkgate-1` cắt từ `98b18f16`.
> Đo trên `98b18f16`. Nhãn: **[ĐO]** = đọc mã/grep tại commit này · **[SUY RA]** = lập luận, chưa chạy.
> Quyết định owner 25/10/2026 (đã chốt, không mở lại): gắn việc vào mục tiêu `Completed`/`Cancelled` ⇒ từ chối; `Draft` ⇒ được gắn.

## §1 Bất biến + phạm vi

- **I-1 (cùng dữ liệu, cùng quyết định quyền):** một việc đang thuộc mục tiêu A, khi được gắn sang mục tiêu B, thì mục tiêu A
  nhận ĐÚNG quyết định mà đường tháo `DELETE /goals/A/tasks/:taskId` đưa ra cho cùng người gọi, cùng dữ liệu (quyền ghi
  `update:goal` trên A + A chưa chốt kỳ). «Chuyển» = «tháo khỏi A» + «gắn vào B»; mỗi đầu qua cổng của đường tương ứng.
- **I-2:** mục tiêu đích chỉ nhận việc khi trạng thái thuộc tập cho phép `{Draft, Active}` (quy tắc DƯƠNG — trạng thái lạ/tương lai ⇒ từ chối).
- **I-3:** từ chối ⇒ 0 hàng `tasks` đổi, 0 hàng `audit_logs` mới (tất-cả-hoặc-không cho cả lô).
- **I-4:** chuyển thành công ⇒ audit ghi ở CẢ HAI mục tiêu (append-only) + tiến độ tính lại ở cả hai.
- **I-5:** kiểm + ghi trong MỘT transaction, trên hàng ĐÃ KHOÁ ⇒ không có cửa sổ giữa «kiểm A chưa chốt» và «ghi».
- **I-6:** cô lập tenant giữ nguyên (việc/mục tiêu công ty khác ⇒ 404, không đổi hàng nào).
- Phạm vi: `POST /goals/:id/tasks` + `DELETE /goals/:id/tasks/:taskId` (GOAL-API-010). Không migration, không đổi DTO/contracts, không đổi FE.

## §2 Đo trên `98b18f16`

### 2a. Census MỌI đường ghi `tasks.goal_id` [ĐO — grep `goal_id`/`goalId` trong `apps/api/src`, loại spec]

| #   | Nơi ghi                                                                                            | Gọi từ                                                                                                          | Có mục tiêu CŨ?                   | Cổng hiện có                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | `goals.repository.ts:484-498` `setTaskGoalTx` (UPDATE không vị từ `goal_id`)                       | `goal-tasks-link.service.ts:133` `linkTasks`                                                                    | **có** (`task.goalId` đọc ở :124) | đích: `loadWritableGoalTx` :114 (= `update:goal` + phạm vi ghi + chưa chốt) · việc: `update:task` write-scope :126 · neo GOAL-ERR-008 :127. **Mục tiêu cũ: 0 kiểm tra.** Trạng thái đích: 0 kiểm tra |
| W2  | `goals.repository.ts:504-520` `clearTaskGoalTx` (vị từ `goal_id = :goalId`)                        | `goal-tasks-link.service.ts:174` `unlinkTask`                                                                   | n/a (chính nó là cũ)              | `loadWritableGoalTx` :168 + `update:task` :172                                                                                                                                                       |
| W3  | `task-core.repository.ts:664-680` `insertTaskCoreTx` (`goal_id = v.goalId ?? null`)                | `task-core.service.ts:559` ← `createTaskInTx`; caller có `goalId` DUY NHẤT: `goal-decompose.service.ts:235/253` | không (việc mới)                  | `loadDecomposableGoalTx` :196-210 (ghi + chưa chốt + chặn `Cancelled` :206)                                                                                                                          |
| W4  | FK `tasks.goal_id → goals` `ON DELETE SET NULL` (`migrations/0535_…:502`, FK tổng hợp theo tenant) | goals chỉ xoá MỀM (`goals.repository.ts` `softDeleteTx`) ⇒ không kích hoạt                                      | —                                 | —                                                                                                                                                                                                    |

- `POST /tasks` không nhận `goalId` (contracts `task.ts:738` chỉ ở response schema; `task-core.repository.ts:177-179`) [ĐO].
- PATCH task (`updateTaskCoreTx`) không ghi `goal_id`; đổi dự án GIỮ liên kết (`task-core.service.ts:806`) [ĐO].
- Ngoài TASK/GOAL không module nào ghi cột này; migration chỉ 0504/0505/0510/0535 nhắc `goal_id`, không trigger ghi [ĐO].
- ⇒ Đường có lỗ: **W1 duy nhất**. W3 chỉ thiếu vế `Completed` (§8).

### 2b. Hàm quyết định sẵn có [ĐO]

- `GoalTasksLinkService.loadWritableGoalTx` (`goal-tasks-link.service.ts:264-271`): `resolveActorScope(…,'update')` →
  `findByIdTx` (404) → `GoalAccessService.assertCanWriteExistingGoal` (`goal-access.service.ts:170-178`) → `assertNotFinalized` (:280-282).
  Đây là cổng của đường tháo (W2) ⇒ là hàm phải tái dùng cho mục tiêu cũ ở W1.
- Mã lỗi: `GOAL-ERR-005` (`FINALIZED`) · `GOAL-ERR-FORBIDDEN` (`FORBIDDEN_CREATE`, 403 minh bạch in-tenant) · `GOAL-ERR-008` neo ·
  `GOAL-ERR-009` phân rã. **Không có mã cho «gắn vào mục tiêu đã đóng»**; dải đang dùng `001…015` (`goals.errors.ts`, SPEC-10 §12,
  API-12 dòng 205/223) ⇒ thêm **GOAL-ERR-016**, 422 (khớp `CHECKIN_STATUS`/`DECOMPOSE_CANCELLED`).
- FE hiện thông điệp server nguyên văn (`GoalCheckinDialog.tsx:29`, picker nhánh error) ⇒ mã mới không cần FE [ĐO].

### 2c. Khoá hàng [ĐO]

- `apps/api/src/goals/**` có **0** câu `FOR UPDATE`. Chốt kỳ dùng vị từ `finalized_at is null` trên UPDATE
  (`goals.repository.ts:410-434`, `goal-checkin.service.ts:166-167`) — chống đua chốt↔chốt, KHÔNG chống đua chốt↔chuyển việc.
- Khuôn có sẵn: drizzle `.for("update")` (`task-file.repository.ts:238`); mảng tham số `any(${sql.param([...ids])}::uuid[])`
  (`room-audience.reader.ts:37`).
- Thứ tự khoá của writer TASK: UPDATE `tasks` rồi recompute UPDATE `goals` (task → goal) [ĐO `task-core.service.ts:800-812`].

### 2d. Dữ liệu cấp quyền (seed) [ĐO]

- `update:goal`: 3 vai trò canonical, phạm vi Own / Department / Company (`0506:74-76`); `update:task`: 4 vai trò, Own/Team/Company
  (`0485:155,178` · `0501:44,46`). Bảng vai trò × đường × kết quả: tệp chi tiết NGOÀI repo (kênh owner).
- [SUY RA] Hệ quả: người có `update:goal` ở phạm vi hẹp + `update:task` trên việc đang gắn mục tiêu ngoài phạm vi ghi của mình
  đổi được liên kết của mục tiêu đó qua W1 trong khi W2 từ chối cùng thao tác trên cùng dữ liệu ⇒ vi phạm I-1.

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
   - `repo.lockGoalsTx(tx, companyId, ids)` — `{đích} ∪ {goal cũ ≠ đích}`, `order by id`, `.for("update")`, lọc `deleted_at is null`;
   - quyết định CUỐI trên hàng đã khoá: đích (biến mất ⇒ 404) qua lại `assertGoalWritableTx` + `assertLinkTargetOpen`; mỗi việc:
     `assertTaskWritableTx` → `assertLinkAllowed` (GOAL-ERR-008) → nếu có goal cũ còn sống: `assertGoalWritableTx(cũ)`.
   - Goal cũ đã xoá mềm (không có trong tập khoá) ⇒ không còn gì để bảo vệ ⇒ cho chuyển (không 404, tránh khoá chết việc).
4. **W2 cùng khuôn:** fail-fast → `lockTaskRefsTx([taskId])` → `lockGoalsTx([goalId])` → `assertGoalWritableTx` trên hàng khoá → clear.
5. **Audit (I-4):** giữ `GoalTaskLinked` ở đích (`after.previousGoalId`); thêm `GoalTaskUnlinked` ở mục tiêu cũ
   (`before {taskId, taskCode}`, `after {movedToGoalId}`) — tái dùng action của W2, `objectType 'goal'` đã có (không đổi CHECK).
6. **Recompute:** giữ nguyên khối `goal-tasks-link.service.ts:150-155` (đích + mọi goal cũ + dự án).
7. Repository: `resolveTaskRefTx` giữ (không caller khác ngoài W1/W2 sau đổi ⇒ thay bằng `lockTaskRefsTx`, xoá nếu 0 caller).
   `goals.repository.ts` 540 → ~575 dòng; service 272 → ~320 dòng (< 800).

## §4 Bảng ca test — int-spec MỚI `apps/api/test/integration/goal-linkgate.int-spec.ts`

Dựng app qua `applyMainPipeline` (`test/helpers/bootstrap-app.ts`); `describe.skipIf(!hasLaneDb)`; chạy lane `mediaos_w25r`.
Vai trò TỰ TẠO trong spec (cặp + phạm vi là dữ liệu fixture, không dùng tên vai trò canonical):
**P-Dept** = `update:goal@Department` (phòng X) + `view:goal@Company` + `update:task@Company` + `read:task@Company` (cô lập cổng goal) ·
**P-Own** = `update:goal@Own` + `update:task@Own` + `view:goal@Department` + `read:task@Own` · **P-Co** = mọi cặp @Company.

| Ca  | Thiết lập                                                                                                                                                                                               | Kỳ vọng mới                                                | Trên mã cũ        | Lý do đỏ                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------- | ---------------------------------------- |
| R1  | P-Dept chuyển việc từ mục tiêu phòng Y → mục tiêu phòng X                                                                                                                                               | 403 GOAL-ERR-FORBIDDEN · `goal_id` = Y · 0 audit mới       | 201               | W1 không kiểm goal cũ                    |
| A1  | P-Dept chuyển việc từ mục tiêu phòng X (thứ hai) → mục tiêu phòng X                                                                                                                                     | 201 · tiến độ cả hai tính lại · 2 audit                    | 201               | đứng cạnh R1                             |
| R2  | P-Own chuyển việc mình phụ trách từ mục tiêu phòng → mục tiêu cá nhân mình                                                                                                                              | 403 · `goal_id` giữ                                        | 201               | như R1, phạm vi Own                      |
| A2  | P-Own chuyển việc mình từ mục tiêu cá nhân (cũ) của mình → mục tiêu cá nhân khác của mình                                                                                                               | 201                                                        | 201               | đứng cạnh R2                             |
| P1  | Cùng người gọi, cùng việc: `DELETE /goals/cũ/tasks/:id` và `POST /goals/mới/tasks`                                                                                                                      | CÙNG mã HTTP + CÙNG mã lỗi (bảng cho P-Dept, P-Own, P-Co)  | lệch (403 vs 201) | bất biến I-1                             |
| R3  | P-Co chuyển việc từ mục tiêu đã chốt kỳ                                                                                                                                                                 | 422 GOAL-ERR-005 · `goal_id` giữ · tiến độ đã chốt giữ     | 201               | thiếu `assertNotFinalized(cũ)`           |
| A3  | P-Co chuyển việc từ mục tiêu chưa chốt (Active)                                                                                                                                                         | 201 · 2 audit (`GoalTaskUnlinked` ở cũ có `movedToGoalId`) | 201 + 1 audit     | audit cũ là RED phụ (I-4)                |
| R4  | gắn vào mục tiêu `Completed`                                                                                                                                                                            | 422 GOAL-ERR-016 · 0 hàng đổi                              | 201               | thiếu cổng trạng thái                    |
| R5  | gắn vào mục tiêu `Cancelled`                                                                                                                                                                            | 422 GOAL-ERR-016                                           | 201               | như R4                                   |
| A4  | gắn vào mục tiêu `Draft`                                                                                                                                                                                | 201                                                        | 201               | quyết định owner                         |
| R6  | lô `[việc hợp lệ, việc từ mục tiêu đã chốt]`                                                                                                                                                            | 422 · việc hợp lệ KHÔNG đổi `goal_id` · 0 audit            | 201               | I-3                                      |
| R7  | đua chốt kỳ: kết nối riêng giữ khoá + set `finalized_at` mục tiêu cũ (chưa commit) → gửi chuyển → chờ thấy request ở trạng thái chờ khoá (`pg_stat_activity.wait_event_type='Lock'`, trần 5 s) → commit | 422 GOAL-ERR-005 · `goal_id` giữ                           | 201               | I-5 khoá goal                            |
| R8  | đua đổi liên kết: kết nối riêng giữ UPDATE `tasks.goal_id` → mục tiêu ngoài phạm vi P-Dept (chưa commit) → P-Dept gửi chuyển → commit                                                                   | 403 · `goal_id` = giá trị đã commit                        | 201               | I-5 khoá việc (đọc lại goal cũ sau khoá) |
| A5  | việc trỏ tới mục tiêu đã xoá mềm → chuyển                                                                                                                                                               | 201                                                        | 201               | chặn fail-closed sai                     |
| X1  | P-Co công ty A chuyển việc công ty B (đang gắn mục tiêu B)                                                                                                                                              | 404 · hàng B không đổi · 0 audit ở B                       | 404               | đứng cạnh I-6                            |
| X2  | P-Co công ty A gắn việc A vào mục tiêu công ty B                                                                                                                                                        | 404                                                        | 404               | I-6                                      |
| U1  | `DELETE` tháo khỏi mục tiêu đã chốt (P-Co)                                                                                                                                                              | 422 GOAL-ERR-005 (không đổi)                               | 422               | hồi quy W2 sau refactor                  |

Đo RED: chạy spec trên mã `98b18f16` TRƯỚC khi vá (dự kiến đỏ R1–R8 + P1 + audit A3; xanh A1/A2/A4/A5/X1/X2/U1).
Hồi quy: chạy lại `goal-be2-link`, `goal-be2-progress`, `goals-param-uuid`, `routehttp3-tasks-goals`, `goal-tpl1-decompose` (lô ≤ 3 tệp).
Unit: `apps/api/src/goals/` có 0 tệp spec [ĐO] — cổng sống ở int-spec (đường thật, DB thật); đột biến đo bằng int-spec.

## §5 Đột biến (mỗi cái phải bị ít nhất một ca giết)

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
| M10 | bỏ audit ở goal cũ                                                     | A3                            |
| M11 | goal cũ không còn (xoá mềm) ⇒ ném 404                                  | A5                            |
| M12 | bắt lỗi từng việc rồi bỏ qua (gắn một phần)                            | R6                            |
| M13 | bỏ `company_id` ở `lockTaskRefsTx`                                     | X1                            |

Chạy đột biến bằng script ngoài repo (khuôn `kept/…/mutants-*.mjs`): áp từng đột biến → chạy spec → khôi phục; ghi số sống/chết.

## §6 Tệp đổi

Trong `paths` WO: `apps/api/src/goals/goal-tasks-link.service.ts` · `goals.repository.ts` · `goals.errors.ts` (+ `LINK_CLOSED` GOAL-ERR-016) ·
`apps/api/test/integration/goal-linkgate.int-spec.ts` (mới) · `docs/SPEC/SPEC-10 GOAL.md` §12 (dòng GOAL-ERR-016 + ghi chú «chuyển = tháo + gắn»;
GOAL-ERR-005 thêm «chuyển việc khỏi mục tiêu đã chốt») · `docs/plans/S20-SEC-GOALLINKGATE-1.md`.
`goal-access.service.ts` dự kiến KHÔNG đổi (hàm tái dùng nằm sẵn ở đó).

pathsNeeded (ngoài `paths`): `docs/API Design/API-12_GOAL_API_Design.md` dòng 205/223 (dải `001…015` → `001…016`).
`harness/backlog.mjs` là việc luồng chính.

## §7 Deploy · tương thích · rollback

- Chỉ API (owner deploy tay). FE Pages không đổi. Không migration, không backfill, không đổi shape DTO.
- FE cũ + API mới: hai trường hợp mới bị từ chối trả 403/422 kèm thông điệp có mã — FE hiện nguyên văn (§2b) ⇒ không gãy.
  API cũ + FE mới: không có FE mới trong WO.
- Rollback: revert commit + deploy lại API; không dữ liệu nào cần đảo (WO chỉ thêm từ chối + thêm hàng audit append-only).
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
