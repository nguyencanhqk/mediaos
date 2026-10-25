# S20-SEC-GOALNAMEDTO-1 — plan v1.1

> Zone 🔴 · gate FULL · crown (permission / data-scope). Nhánh `fix/s20-sec-goalnamedto-1` cắt từ `98b18f16`.
> Quyết định owner 25/10/2026 (đã chốt, không mở lại): **che ở server**. Tên/mã mục tiêu đi kèm dữ liệu việc
> CHỈ trả khi người xem có quyền xem chính mục tiêu đó (cặp `('view','goal')` + phạm vi đọc của mục tiêu);
> còn lại trả cờ «có mục tiêu». Che tại điểm hợp nhất duy nhất của server; FE không tự ẩn thay server.
> Ký hiệu: **[ĐO]** = đã đọc/grep trên `98b18f16` · **[SUY RA]** = suy từ mã, xác nhận lúc RED/GREEN.
> v1.1 = v1 + plan-review (B1, B2, H1–H4, M1–M3, L1–L2 — xử lý ở §9).

## §1. Bất biến + phạm vi

- **I-1 (cùng dữ liệu, cùng quyết định):** với mọi dữ liệu việc trả ra, tên/mã/id mục tiêu G có mặt ⇔ người
  xem đọc được G qua đường đọc mục tiêu chuẩn (`GET /goals/:id` = `resolveActorScope('view')` +
  `loadReadableGoalTx`). Một biểu thức phạm vi, một hàm điều phối; khác biệt duy nhất giữa hai đường là
  `resolveAndAssert` (đường chuẩn, ném 403) với `resolveOrNull` (đường việc, null ⇒ che).
  Ngoại lệ có chủ đích (chặt hơn, không lỏng hơn): request mang cờ khoá API ⇒ che hết (§3.2).
- **I-2 (mặc định an toàn):** đường đọc nào không nối quyết định ⇒ ra null×3 (mất tên, không lộ tên).
- **I-3 (cờ trung tính):** `hasGoal: boolean` = việc đang gắn một mục tiêu SỐNG cùng tenant (join trúng).
  Cờ không mang id/tên/mã. Mục tiêu đã xoá mềm ⇒ `hasGoal=false`, `goalId=null`.
- **I-4 (tenant — hồi quy, không phải rào mới):** id mục tiêu công ty khác không xuất hiện trong dữ liệu việc.
  Rào đã có: composite FK `(company_id, goal_id) → goals` (`migrations/0535_…composite_tenant_fk.sql:502`,
  `tasks.company_id` NOT NULL ⇒ MATCH SIMPLE vẫn kiểm) + RLS FORCE + vế `gl.company_id` trong ON. [ĐO]
- **I-5 (không N+1):** một trang ⇒ tối đa MỘT truy vấn quyết định theo lô trên tx; trang không có hàng gắn
  mục tiêu ⇒ 0 truy vấn quyết định. Đường ghi/kanban/nhật ký nhận ngữ cảnh người xem resolve TRƯỚC tx (§3.4).
- **I-6 (ledger nguyên vẹn):** che ở nhật ký hoạt động là che LÚC ĐỌC; `task_activity_logs` không UPDATE.
- Phạm vi: mọi đường trả `TaskCoreResponseDto` (list · overdue · chi tiết · my-tasks · kanban · phản hồi ghi ·
  việc-của-mục-tiêu) + nhật ký hoạt động của việc/dự án (TASK-API-602/601) + contract + FE ô «Mục tiêu» + ghi
  chính sách vào `docs/permission-matrix-spec.md` §9b. Không migration, không đổi grant seed.

## §2. Đo trên `98b18f16`

**(a) Census đường trả goalId/goalCode/goalName trong dữ liệu việc**

| #   | Nơi                                                          | file:dòng                                                                                                                                                                                                                                                                                                                                                                                            | Ghi chú                                                                                                                                                                             |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Projection                                                   | `apps/api/src/tasks/task-core.repository.ts:229-231` (select) · `:247-248` (LEFT JOIN `goals gl` ràng `company_id` + `deleted_at`)                                                                                                                                                                                                                                                                   | [ĐO] `goalId` lấy từ cột thô `tk.goal_id`, tên/mã từ join ⇒ hai nguồn lệch DUY NHẤT khi mục tiêu đã xoá mềm (`softDeleteTx` `goals.repository.ts:522-538` không gỡ `tasks.goal_id`) |
| 2   | Mapper hợp nhất                                              | `apps/api/src/tasks/task-core.mapper.ts:149-155` (`toTaskCoreDto`)                                                                                                                                                                                                                                                                                                                                   | [ĐO] trả nguyên 3 trường, không xét quyền đọc mục tiêu                                                                                                                              |
| 3   | GET /tasks (+ overdue, + filter)                             | `task-core.service.ts:166-200` (map `:199`, trang trí SAU tx)                                                                                                                                                                                                                                                                                                                                        | [ĐO]                                                                                                                                                                                |
| 4   | GET /tasks/:id                                               | `task-core.service.ts:202-223` (`:218`, trang trí SAU tx)                                                                                                                                                                                                                                                                                                                                            | [ĐO]                                                                                                                                                                                |
| 5   | GET /tasks/my                                                | `task-core.service.ts:345-354` (`:353`, trang trí SAU tx)                                                                                                                                                                                                                                                                                                                                            | [ĐO]                                                                                                                                                                                |
| 6   | Phản hồi tạo/PATCH/move-state                                | `task-core.service.ts:1315-1322` (`reload`, gọi `:398`, `:815`, `:846`) — TRONG tx ghi                                                                                                                                                                                                                                                                                                               | [ĐO]                                                                                                                                                                                |
| 7   | Phản hồi assign/status/priority/deadline/watch               | `task-actions.service.ts:737-764` (`respond`, 9 nơi gọi; tx mở ở `:112`, `:200`, `:312`, `:375`, `:435`) — TRONG tx ghi                                                                                                                                                                                                                                                                              | [ĐO]; `changeStatusTx` còn được gọi trong tx của move-state                                                                                                                         |
| 8   | Kanban                                                       | `task-kanban.service.ts:72-185` (`:180`) — TRONG tx                                                                                                                                                                                                                                                                                                                                                  | [ĐO]                                                                                                                                                                                |
| 9   | GET /goals/:id/tasks                                         | `apps/api/src/goals/goal-tasks-link.service.ts:69-101`                                                                                                                                                                                                                                                                                                                                               | [ĐO] đã qua `loadReadableGoalTx` cho đúng mục tiêu; hàng lọc `tk.goal_id = goalId` (`task-core.repository.ts:402`)                                                                  |
| 10  | Nhật ký hoạt động việc (TASK-API-602) + dự án (TASK-API-601) | ghi: `goal-decompose.service.ts:263-272` (dòng `TASK_GOAL_DECOMPOSED`: `newValues {goalId, goalCode, templateItemId}` + `message` chứa tên mục tiêu) · đọc: `task-activity-feed.service.ts:50-75` (list), `:83-99` (listByProject), `:112-125` (gom trang), `:143-161` (`toDto` trả nguyên `message`/`newValues`) · FE: `apps/app/src/routes/tasks/ActivityFeedList.tsx:88` (`log.message ?? label`) | [ĐO] không xét quyền đọc mục tiêu. `TASK_GOAL_DECOMPOSED` là action DUY NHẤT mang dữ liệu mục tiêu (`task-activity.service.ts:62`; `goals/` chỉ ghi activity ở decompose)           |
| —   | Widget MY_TASKS/TASK_ALERTS                                  | `dashboard-widget-handlers.service.ts:275-325`                                                                                                                                                                                                                                                                                                                                                       | [ĐO] dùng `getMyTasks` rồi map trường HẸP (không có goal\*)                                                                                                                         |
| —   | /me tổng quan                                                | `me-aggregation.service.ts:255-268`                                                                                                                                                                                                                                                                                                                                                                  | [ĐO] chỉ đếm                                                                                                                                                                        |
| —   | Panel việc con                                               | `task-core.service.ts:318-341` (`toSubtaskItem`)                                                                                                                                                                                                                                                                                                                                                     | [ĐO] DTO hẹp                                                                                                                                                                        |
| —   | Realtime                                                     | `apps/api/src/realtime/`                                                                                                                                                                                                                                                                                                                                                                             | [ĐO] không có emitter task                                                                                                                                                          |
| —   | Export                                                       | `apps/api/src/tasks/`                                                                                                                                                                                                                                                                                                                                                                                | [ĐO] không có đường export task                                                                                                                                                     |
| —   | Widget tiến độ mục tiêu · NOTI mục tiêu                      | `dashboard-widget-handlers.service.ts:745-768` · `goal-noti.payload.ts`                                                                                                                                                                                                                                                                                                                              | [ĐO] dữ liệu MỤC TIÊU qua đường đọc mục tiêu (view:goal) / audience mục tiêu — ngoài phạm vi                                                                                        |

Callers của `toTaskCoreDto` = đúng 4: `task-core.service.ts:1344` · `task-actions.service.ts:797` ·
`task-kanban.service.ts:168` (qua `toTaskKanbanCardDto`) · `goal-tasks-link.service.ts:101`. `findScopedByIdTx`
ở `task-comments.service.ts:266,:339` · `task-checklists.service.ts:380` · `project-access.service.ts:153` chỉ
dùng nội bộ, không ra DTO. [ĐO] Ghi chú ở `task-core.repository.ts:233-237` («FK đơn cột») đã cũ sau 0535 —
không sửa ở WO này (repository không đổi; §8).

**(b) Hàm quyết định «xem được mục tiêu G» sẵn có** [ĐO]

- `GoalAccessService.resolveActorScope` (`goal-access.service.ts:65-95`): `resolveAndAssert('view','goal')` →
  `resolveContext` → nhân viên active (bản GOAL `goals.repository.ts:324-337`) → `deptOrgUnitIds` (inline own ∪
  headed, chỉ Department — cùng kết quả `DataScopeService.departmentOrgUnitIds`, `data-scope.service.ts`) →
  Company/System ⇒ không predicate; còn lại `GoalsRepository.buildReadScopeExists` (`goals.repository.ts:134-169`).
- `isInReadScopeTx` (`goals.repository.ts:223-237`): một id/lần, WHERE `id + company_id + deleted_at is null + scope`.
- `GoalsModule → TasksModule` một chiều (`goals.module.ts:34`) ⇒ TasksModule KHÔNG inject được GoalAccessService.
- `DataScopeService.resolveOrNull` (`data-scope.service.ts:111-119`) = bản không-ném, cùng engine; grant memo ≤2s
  TRONG một request HTTP (`:125-127`); `resolveContext` (`:151`) đọc mới mỗi lần, KHÔNG cache, kết nối ngoài tx.
- Khoá API: `PermissionGuard` giao `scopeKeys` (`permission/guards/permission.guard.ts:100-115`), nhưng
  `ApiKeyAuthGuard` ĐÃ GỠ khỏi APP_GUARD (`app.module.ts:141-145`, token không-JWT ⇒ 401) ⇒ hôm nay không
  request HTTP nào mang `viaApiKey`. [ĐO]

**(c) Giữ hay che `goalId`** — FE dùng `goalId` ở: `TaskGoalField.tsx:47` · `use-task-action-mutation.ts:131` ·
`TaskKanbanPage.tsx:170,229` · `GoalTaskPickerDialog.tsx:89,102`. [ĐO] Mọi chỗ chỉ có nghĩa khi người xem
đọc được mục tiêu đó (gỡ/đổi ở server qua `loadReadableGoalTx`; cache mục tiêu không đọc được không có ở client)
[SUY RA] ⇒ **che `goalId` cùng tên/mã**.

**(d) Tệp quá 800 dòng** [ĐO `wc -l`]: `task-core.repository.ts` 909 · `packages/contracts/src/task.ts` 826 ·
`task-core.service.ts` 1389 · `apps/app/src/i18n/locales/vi/tasks.ts` 953; sát ngưỡng `task-actions.service.ts` 799. ⇒ repository KHÔNG đổi; các tệp >800 đổi với ròng ≤ 0; `task-actions.service.ts` giữ ≤ 800 (đo ở checkpoint).
Hàm private không ai gọi: `task-core.service.ts` `toIso/toBool` (`:1327-1336`) · `task-actions.service.ts`
`toBool` (`:783`). Còn dùng: actions `toMs` (`:379,:385`) · `toIso` (`:404,:413,:420,:617`). [ĐO grep]

**(e) FE đang hiện tên mục tiêu của việc**: `TaskGoalField.tsx:101-104` (chỉ đọc) · `:136-137` (option «đang
gắn») · `ActivityFeedList.tsx:88` (message nhật ký). Kanban/list/my-tasks CHƯA có chip mục tiêu. [ĐO]

**(f) Grant seed**: phân bố cặp liên quan + bảng vai trò × đường × kết quả: tệp chi tiết NGOÀI repo. [ĐO]

## §3. Thiết kế

1. **Một hàm điều phối thuần** — tệp mới `apps/api/src/goals/goal-read-scope.ts` (không DI, không import tasks/):
   - `buildGoalActorScope(scope, ctx, actorEmployeeId, user, dataScope)` — gồm CẢ nhánh Company/System (không
     predicate) + `deptOrgUnitIds` (gọi `dataScope.departmentOrgUnitIds(ctx)` — bỏ bản inline, cùng kết quả) +
     `readScopeExists` (`dataScope.buildEmployeeScopeCondition`). `dataScope` truyền vào chỉ cho 2 hàm thuần đó.
   - `buildGoalReadScopeExists(...)` — chuyển NGUYÊN VĂN thân `GoalsRepository.buildReadScopeExists`.
   - `findActiveActorEmployeeTx(tx, companyId, userId)` — chuyển NGUYÊN VĂN truy vấn bản GOAL (`:324-337`).
   - `selectReadableGoalIdsTx(tx, companyId, ids, readScopeExists?)` → `Set<string>`: cùng WHERE với
     `isInReadScopeTx` + `inArray(ids)`; `readScopeExists` vắng (Company/System) ⇒ chỉ `id/company_id/deleted_at`.
   - Ủy quyền một dòng: `GoalsRepository.buildReadScopeExists` · `findActiveEmployeeByUserTx` · `isInReadScopeTx`;
     `GoalAccessService.resolveActorScope` = `resolveAndAssert` → `resolveContext` → `findActiveActorEmployeeTx` →
     `buildGoalActorScope`. Hồi quy GOAL bằng int-spec GOAL có sẵn.
2. **Policy theo lô** — provider mới `TaskGoalRefPolicy` (`apps/api/src/tasks/task-goal-ref.policy.ts`, khai trong
   TasksModule + export cho GoalsModule):
   - `resolveViewer(user)` (KHÔNG tx): `user.viaApiKey === true` ⇒ viewer «che hết» (0 lời gọi engine) ·
     `resolveOrNull('view','goal')` null ⇒ «che hết» · scope ∈ {Own, Team, Department} ⇒ thêm `resolveContext`.
   - `visibleGoalIdsTx(tx, viewer, user, candidateIds)`: rỗng hoặc «che hết» ⇒ `Set` rỗng, 0 truy vấn · còn lại
     ⇒ `findActiveActorEmployeeTx` (chỉ khi có predicate) + `buildGoalActorScope` + MỘT `selectReadableGoalIdsTx`
     trên tx. Company/System cũng đi truy vấn lô (đồng nhất; nhật ký không có join để dựa vào).
   - `visibleGoalIds(user, candidateIds)` cho đường trang trí SAU tx (#3-#5): resolve lười (0 lời gọi khi không có
     ứng viên) rồi tự `withTenant`.
   - Không nuốt lỗi hạ tầng (lỗi engine ⇒ ném tiếp, không thành «che hết»). Trên tx chung: tuần tự, không `Promise.all`.
3. **Mapper fail-closed** — `toTaskCoreDto` đọc `goalRefVisible` từ object trang trí (`signedUrlsForRow` nhận thêm
   tập id thấy được): `goalRefVisible === true && goalCode != null` ⇒ 3 trường; ngược lại null×3.
   `hasGoal = goalCode != null` (join trúng = mục tiêu sống cùng tenant). Ứng viên = goalId của hàng có `goalCode != null`.
4. **Nối điểm gọi, ngữ cảnh resolve TRƯỚC tx ở mọi đường trang trí trong tx** (M3):
   - #3-#5: `visibleGoalIds` sau tx. #6: 3 caller của `reload` resolve viewer trước `withTenant`, `reload(tx, user,
viewer, id)`. #7: 5 điểm mở tx resolve viewer trước tx; `changeStatusTx` nhận thêm `viewer` (caller move-state
     truyền viewer đã resolve). `respond` chuyển sang tệp mới `apps/api/src/tasks/task-action-respond.ts` và dùng
     `signedUrlsForRow` (L1) — bớt dòng cho `task-actions.service.ts`. #8 kanban: viewer trước tx. #9: theo vị trí
     trang trí (trong tx ⇒ viewer trước tx; sau tx ⇒ `visibleGoalIds`) [SUY RA].
   - Trong tx chỉ còn truy vấn trên chính tx (nhân viên active + lô).
5. **Nhật ký hoạt động (B1)** — `TaskActivityFeedService.list` / `listByProject`: viewer resolve trước tx (cùng chỗ
   `auditScope`); trong `toDtosWithNamesTx` gom `newValues.goalId` (UUID hợp lệ — tái dùng `UUID_RE`) của dòng
   `TASK_GOAL_DECOMPOSED` trên trang ⇒ MỘT `visibleGoalIdsTx`. Hàm thuần mới
   `apps/api/src/tasks/task-activity-goal-redact.ts`: dòng decompose mà goalId không thuộc tập thấy được (hoặc
   goalId không hợp lệ ⇒ fail-closed) ⇒ trả object MỚI: `message` = câu trung tính không tên, `newValues` bỏ
   `goalId`/`goalCode` (giữ khoá khác). Không đổi ghi ở `goal-decompose.service.ts`; ledger không UPDATE (I-6).
6. **Contract** — tệp mới `packages/contracts/src/task-goal-ref.ts`: `taskGoalRefShape` = 3 trường cũ +
   `hasGoal: z.boolean().optional()` (additive, không `.default()` — khuôn Input=Output); `task.ts` thay khối
   `:735-740` bằng spread (ròng âm). Export additive ở `index.ts`. Contract nhật ký không đổi (`newValues` vốn mở).
7. **FE** — `TaskGoalField.tsx`: `hasGoal ?? (goalId != null)`; có cờ mà không có `goalCode` ⇒ chip trung tính +
   tooltip giải thích (i18n mới ở `tasks-workux.ts`), KHÔNG mount picker kể cả khi `canEdit`. FE nhật ký không
   đổi (message đã trung tính từ server). FE không tự ẩn gì server đã trả.
8. **Chính sách** — `docs/permission-matrix-spec.md` §9b thêm gạch đầu dòng I-1…I-6 (trung tính).

## §4. Ca test

Int-spec MỚI `apps/api/test/integration/task-goal-ref-visibility.int-spec.ts`: dựng app qua `applyMainPipeline`
(`test/helpers/bootstrap-app.ts`), `describe.skipIf(!(hasDb && LANE_DB))`, lane `mediaos_w25r`.
**Diễn viên** (vai trò tự seed trong spec): V⁺ = đọc được mục tiêu đang xét qua đường đọc mục tiêu chuẩn · V⁻ =
đường đọc chuẩn trả 403 cho mục tiêu đó · V⁰ = không có cặp đọc mục tiêu. Mỗi diễn viên có ĐỦ cặp cho đường được
thử; quyền đọc mục tiêu là biến duy nhất. Bảng cặp cụ thể từng diễn viên: tệp chi tiết ngoài repo.
**Luật đặt tên ca:** mô tả bất biến («cùng dữ liệu, cùng quyết định quyền»), không mô tả cách vượt quyền.

| Ca  | Bất biến · đường được phủ                                                                                         | Kỳ vọng                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| R1  | I-1 · V⁰ · danh sách việc                                                                                         | null×3, `hasGoal=true`                                           |
| R2  | I-1 · V⁻ · danh sách việc                                                                                         | null×3, `hasGoal=true`                                           |
| R3  | I-1 · V⁻ · chi tiết việc                                                                                          | như R2                                                           |
| R4  | I-1 · V⁻ (người phụ trách) · việc của tôi                                                                         | như R2                                                           |
| R5  | I-1 · V⁻ · kanban dự án                                                                                           | như R2                                                           |
| R6  | I-1 · V⁻ · phản hồi PATCH + một action                                                                            | như R2                                                           |
| R7  | I-3 · mục tiêu đã xoá mềm qua `DELETE /goals/:id` · V⁺ phạm vi công ty và V⁺ phạm vi phòng · chi tiết + danh sách | `goalId=null`, `hasGoal=false`                                   |
| R8  | I-1/I-6 · V⁻ là người liên quan · nhật ký việc (602) + nhật ký dự án (601)                                        | message không chứa tên; `newValues` không có `goalId`/`goalCode` |
| A1  | đứng cạnh · V⁺ · đủ đường R2-R6                                                                                   | 3 trường đúng mục tiêu                                           |
| A2  | đứng cạnh vế member dự án · V⁺ qua membership · chi tiết                                                          | tên mục tiêu dự án                                               |
| A2' | I-1 · V⁻ (không membership) · cùng việc A2                                                                        | null×3, `hasGoal=true`                                           |
| A3  | đứng cạnh phạm vi công ty · danh sách                                                                             | đủ tên                                                           |
| A4  | đứng cạnh #9 · V⁺ · việc-của-mục-tiêu                                                                             | đủ tên                                                           |
| A5  | I-3 · việc không mục tiêu · mọi diễn viên                                                                         | null×3, `hasGoal=false`                                          |
| A6  | đứng cạnh R8 · V⁺ là người liên quan · nhật ký việc                                                               | message + `newValues` nguyên văn                                 |
| X1  | I-4 hồi quy · diễn viên công ty khác · chi tiết việc                                                              | 404 (không đổi)                                                  |

**Kỷ luật assert (M1, M2):** status 200 trước body · tìm hàng THEO ID + `expect(row).toBeDefined()` · rồi
`goalName` → `goalCode` → `goalId` null → cuối cùng `hasGoal` · danh sách lọc theo `projectId`/`search` duy nhất
của spec (không rơi khỏi trang) · cấm `?? null`/optional-chaining trong vế kỳ vọng. Chạy RED trên `98b18f16`: ghi
lại assert hỏng ĐẦU TIÊN — R1-R6, A2' phải hỏng ở `goalName`; R7 ở `goalId`; R8 ở message. Assert hỏng khác ⇒ sửa
arrange trước khi GREEN. R7 arrange bằng API (mục tiêu chưa chốt, không con); không ghi thẳng DB bỏ qua FK.

Unit (không DB): **U1** mapper — không trang trí ⇒ null×3; `goalRefVisible` + join trượt ⇒ null×3, `hasGoal=false`
· **U2** policy — 0 ứng viên ⇒ không gọi engine; N hàng/K mục tiêu ⇒ đúng 1 truy vấn lô; `resolveOrNull` null ⇒
rỗng, 0 truy vấn; engine ném ⇒ ném tiếp · **U2b** `viaApiKey` ⇒ rỗng, 0 lời gọi engine · **U3** contract parse cả
dạng cũ lẫn mới · **U4** đối chiếu: với Own/Team/Department/Company/System, đường chuẩn (`resolveActorScope`) và
policy dựng CÙNG SQL (so `PgDialect.sqlToQuery`) · **U5** redact nhật ký — dòng decompose không thấy ⇒ object mới,
khoá khác giữ; dòng khác không đổi; goalId hỏng ⇒ che · **U6** mọi đường dựng URL trang trí qua `signedUrlsForRow`
· **F1-F3** `TaskGoalField.spec.tsx`: cờ không tên ⇒ chip trung tính, không picker; dạng server cũ ⇒ như trước;
`goalId` null + không cờ ⇒ «—». Hồi quy: `goal-be1-scope` · `goal-be2-link` (ca `:363` — nếu diễn viên không đọc
được mục tiêu thì đó là thay đổi đúng chính sách, ghi deviation) · `task-core*` · `task-kanban-*` · `task-activity*`
· `routehttp3-tasks-goals` · `pipeline-parity.unit-spec`.

## §5. Đột biến (chạy tay trên GREEN, hoàn nguyên sau mỗi lần)

| #   | Đột biến                                                                                                                                                                | Ca giết                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| M1  | mapper trả `row.goalName/goalCode` bỏ qua `goalRefVisible`                                                                                                              | R1-R6, U1                          |
| M2  | policy coi `resolveOrNull` null như phạm vi công ty                                                                                                                     | R1                                 |
| M3  | policy bỏ predicate cho phạm vi phòng                                                                                                                                   | R2-R6, A2'                         |
| M4  | builder bỏ vế member dự án                                                                                                                                              | A2                                 |
| M5  | policy dùng phạm vi đọc việc thay đọc mục tiêu                                                                                                                          | R2                                 |
| M6  | mapper vẫn trả `goalId` khi che                                                                                                                                         | R1-R6                              |
| M7a | `hasGoal`/`goalId` lấy từ `tk.goal_id` thô (bỏ điều kiện join trúng)                                                                                                    | R7                                 |
| M7b | truy vấn lô bỏ `company_id` — **đột biến tương đương**: composite FK 0535 + RLS FORCE chặn trước; int-spec không giết được ⇒ giết bằng U4 (hình SQL có vế `company_id`) | U4                                 |
| M8  | kanban (hoặc `respond`) không truyền tập id                                                                                                                             | A1                                 |
| M9  | policy `catch` lỗi engine ⇒ tập rỗng                                                                                                                                    | U2                                 |
| M10 | `buildGoalActorScope` trả phòng cho scope Own                                                                                                                           | hồi quy `goal-be1-scope` S1/S2, U4 |
| M11 | nhật ký không che                                                                                                                                                       | R8, U5                             |
| M12 | bỏ nhánh `viaApiKey`                                                                                                                                                    | U2b                                |

## §6. Tệp đổi

Trong `paths` WO: `task-core.mapper.ts` (+ `task-core.mapper.spec.ts`) · `packages/contracts/src/task.ts` (ròng âm)
· `apps/api/test/integration/task-goal-ref-visibility.int-spec.ts` (mới) · `docs/permission-matrix-spec.md` ·
plan này. `task-core.repository.ts`: KHÔNG đổi.

**pathsNeeded (ngoài `paths`)**: `apps/api/src/goals/goal-read-scope.ts` (mới) · `goals.repository.ts` ·
`goal-access.service.ts` · `goal-tasks-link.service.ts` · `apps/api/src/tasks/task-goal-ref.policy.ts` + `.spec.ts`
(mới) · `task-action-respond.ts` (mới) · `task-activity-goal-redact.ts` + `.spec.ts` (mới) ·
`task-activity-feed.service.ts` · `task-core.service.ts` (ròng ≤ 0) · `task-actions.service.ts` (≤ 800) ·
`task-kanban.service.ts` · `tasks.module.ts` (additive) · spec khởi tạo service theo vị trí cần thêm mock
(`task-core-codegen.spec.ts`; spec feed/actions nếu có — đo lúc GREEN) · `packages/contracts/src/task-goal-ref.ts`
(mới) + `index.ts` · `apps/app/src/routes/tasks/TaskGoalField.tsx` + `.spec.tsx` · `apps/app/src/i18n/locales/vi/tasks-workux.ts`.

⚠️ Chồng lấn với **S20-SEC-GOALLINKGATE-1** (cùng chuỗi, tuần tự): `goal-access.service.ts` · `goals.repository.ts`
· `goal-tasks-link.service.ts`. Giữ hunk ở đây tối thiểu (ủy quyền một dòng + nối policy); WO sau rebase lên.

## §7. Deploy · tương thích · rollback

- Không migration. **Không push/PR cho tới khi owner mở khung deploy** (chuỗi R giữ cục bộ). Trong khung đó, liền
  một mạch: merge → deploy API ngay (`m prod-update api` — lệnh không pull/không cài deps ⇒ đo commit đang chạy
  trước và sau) → ĐO trên PROD bằng diễn viên giới hạn (thấy `hasGoal`, không có tên). FE Pages tự lên khi merge;
  hai chiều đã tương thích (dưới). Cùng khung với **S20-SEC-GOALLINKGATE-1**.
- **FE mới + API cũ**: `hasGoal` vắng ⇒ FE suy `goalId != null` ⇒ y hành vi hiện tại.
- **FE cũ + API mới**: `hasGoal` là khoá lạ (bỏ qua); việc bị che hiện «—» ở chỉ đọc; chế độ sửa hiện select trống
  (`TaskGoalField.tsx:119-139`) — luật kiểm mục tiêu cũ là việc của GOALLINKGATE-1 (lý do chung khung).
- Contract additive `.optional()` ⇒ không ZodError cả hai chiều (U3).
- **Thay đổi hành vi có chủ đích (L2):** người có quyền sửa việc + sửa mục tiêu nhưng KHÔNG đọc được mục tiêu đang
  gắn sẽ không đổi/gỡ được mục tiêu đó từ ô việc (chip trung tính + tooltip) — hệ quả của quyết định owner.
- Rollback = revert commit API (tên trở lại, không dữ liệu nào đổi); FE mới vẫn chạy với API đã revert.

## §8. Ngoài phạm vi / nợ

- Kiểm quyền mục tiêu CŨ khi chuyển việc sang mục tiêu khác — S20-SEC-GOALLINKGATE-1.
- Chip mục tiêu trên «Việc của tôi»/list/kanban — S20-TASK-MYTASKSLOAD-1 (dùng `hasGoal` + 3 trường từ WO này).
- Dữ liệu mục tiêu trong NOTI/widget mục tiêu (đường đọc mục tiêu riêng, đã gate `view:goal`).
- Khuôn khớp `scopeKeys` lặp ở `permission.guard.ts:100-115` và `chat/chat-oversight-audit.guard.ts:151-156` — gom
  một hàm khi đường khoá API được gắn lại (followup; WO này không chép khuôn thứ ba).
- Ghi chú cũ «FK đơn cột» ở `task-core.repository.ts:233-237` (sai sau 0535) — sửa ở WO chạm repository kế tiếp.
- `check.sh --all --lane-db` + FULL gate: luồng chính.

## §9. Xử lý plan-review (v1 → v1.1)

| Finding                        | Xác minh                                                                                                                           | Xử lý                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| B1 nhật ký hoạt động           | ĐÚNG — `goal-decompose.service.ts:263-272`, `task-activity-feed.service.ts:50-75,:83-99,:143-161`, `ActivityFeedList.tsx:88`       | ÁP: §2(a) #10, §3.5, R8/A6/U5, M11. Không thu hẹp phạm vi                                         |
| B2 lệch tenant không dựng được | ĐÚNG — `0535…:502` composite FK; `softDeleteTx` `goals.repository.ts:522-538` không gỡ `goal_id`                                   | ÁP: I-3/I-4 viết lại, R7 = mục tiêu xoá mềm, M7 tách a/b (b tương đương)                          |
| H1 bản điều phối thứ hai       | ĐÚNG — `goal-access.service.ts:65-95` vs policy; bản tra nhân viên TASK `task-core.repository.ts:612-624` khác bản GOAL `:324-337` | ÁP: `buildGoalActorScope` + `findActiveActorEmployeeTx` dùng chung, U4                            |
| H2 khoá API                    | ĐÚNG về mã guard, nhưng đường KHÔNG gắn hôm nay (`app.module.ts:141-145`)                                                          | ÁP MỘT PHẦN: `viaApiKey` ⇒ che hết (chặt hơn, không chép khuôn khớp), U2b, M12; gom khuôn = nợ §8 |
| H3 repo public                 | ĐÚNG                                                                                                                               | ÁP: §2(f)/§4 trung tính, chi tiết ra tệp ngoài repo; commit v1 được AMEND (nhánh chưa push)       |
| H4 thứ tự deploy               | ĐÚNG                                                                                                                               | ÁP: §7                                                                                            |
| M1 thứ tự assert / trang       | ĐÚNG — `task-core.repository.ts:408-416` phân trang                                                                                | ÁP: §4 kỷ luật assert                                                                             |
| M2 grant diễn viên             | ĐÚNG — kanban gate `view-kanban` (`task-kanban.service.ts:69`)                                                                     | ÁP: §4 + tệp chi tiết                                                                             |
| M3 engine trong tx ghi         | ĐÚNG — `resolveContext` kết nối ngoài tx (`data-scope.service.ts:151`)                                                             | ÁP: §3.2/§3.4 viewer trước tx                                                                     |
| L1 `respond` tự dựng URL       | ĐÚNG — `task-actions.service.ts:757-761`                                                                                           | ÁP: tệp `task-action-respond.ts` + `signedUrlsForRow`, U6; `toBool` actions 0 caller              |
| L2 hành vi FE                  | ĐÚNG — `TaskGoalField.tsx:95-145`                                                                                                  | ÁP: §7 + tooltip                                                                                  |

## §10. Thi công (GREEN) — lệch plan có chủ đích

| Điểm plan                                          | Thi công                                                                                                                                                                                                      | Lý do                                                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.4 `respond` sang tệp `task-action-respond.ts`   | Tệp `apps/api/src/tasks/task-row-decorations.ts`: `decorateTaskRows` (avatar · bìa · quyết định mục tiêu theo lô) + `reloadTaskDtoTx` dùng CHUNG cho `TaskCoreService.reload` và `TaskActionsService.respond` | `reload` và `respond` là cùng một thân (tải lại + trang trí + mapper) — một hàm thay hai bản; `task-core.service.ts` 1389 → 1364, `task-actions.service.ts` 799 → 769 |
| §3.3 `signedUrlsForRow(row, avatars, covers, ids)` | `signedUrlsForRow(row, deco)` với `TaskRowDecorations { avatars, covers, goals }`                                                                                                                             | ba tham số vị trí cùng kiểu Map/Set dễ hoán vị mà tsc không bắt                                                                                                       |
| §3.4 move-state truyền viewer vào `changeStatusTx` | `changeStatusTx(..., viewer = hiddenGoalRefViewer(user))` — move-state bỏ phản hồi của lời gọi này (phản hồi thật đi `reload` với viewer đã resolve)                                                          | 0 lời gọi engine thừa; giá trị mặc định là che (fail-closed)                                                                                                          |
| §3.7 FE `hasGoal ?? (goalId != null)`              | chip trung tính khi `hasGoal === true && !goalCode`                                                                                                                                                           | chỉ cờ TƯỜNG MINH của server bật nhánh mới ⇒ phản hồi API cũ giữ y hành vi cũ (kể cả ca mục tiêu đã xoá mềm)                                                          |
| §4 U6                                              | ca cấu trúc trong `task-core.mapper.spec.ts`: không tệp nguồn nào ngoài mapper tự đặt `goalRefVisible` hay tự dựng URL avatar                                                                                 | —                                                                                                                                                                     |
| §5 đột biến                                        | chưa chạy tay ở bước này                                                                                                                                                                                      | để cho FULL gate của luồng chính                                                                                                                                      |
