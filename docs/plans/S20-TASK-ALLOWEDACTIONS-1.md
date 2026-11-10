# S20-TASK-ALLOWEDACTIONS-1 — plan v2

> Zone 🟠 amber · gate FULL (đọc kết quả quyền để trình bày; KHÔNG đổi cổng). Nhánh `feat/s20-task-allowedactions-1`, nền `5b5a3222`.
> Nhãn: **[ĐO]** = đọc trên mã ở nền; **[SUY RA]** = đo lại khi thi công. Nguồn: S20-WORKUX-STORIES US-TASK-NV-13 · FRONTEND-11 §10.3 · SPEC-06 §13.7.
> v2 (09/11): sửa theo review đối kháng — xem «Phản biện» cuối plan.

## §1 Đo hiện trạng

### 1.1 Cổng THẬT của từng hành động [ĐO]

| Khoá `allowedActions` | Route (`tasks.controller.ts`) | Cặp guard | Cổng service (lớp 2) | Phạm vi việc | Vòng đời / điều kiện hàng |
| --- | --- | --- | --- | --- | --- |
| `changeStatus` | `POST :id/change-status` `:326-336` | `update-status:task` | `task-actions.service.ts:191` resolveAndAssert | `loadMutable` → `assertTaskInScopeTx(…,"write")` `:546` | workflow ⇒ 400; **Cancelled được** (`allowCancelled` `:228`) |
| `changeState` (thêm, §2 Q2) | `POST :id/move-state` | `update-state:task` | `task-core.service.ts:829` (`prepareStateWrite`) | `applyStateChangeTx` → `assertInScopeForWrite(scopeState)` `:876` | workflow ⇒ 400 `:801`; không chặn Cancelled; **không dự án ⇒ 400 `:866`; việc con ⇒ 400 `:871`**; cột dự án khác ⇒ 400 `:879` |
| `changeDeadline` | `POST :id/change-deadline` `:395-405` | `update-deadline:task` | `:371` | `loadMutable` write | workflow 400 · Cancelled 422 `:537` |
| `assign` | `POST :id/assign` `:313-323` | `assign:task` | `:109` | `loadMutable` write (+ người nhận theo phạm vi assign khi gửi) | workflow 400 · Cancelled 422 |
| `changePriority` | `POST :id/change-priority` `:382-392` | `update-priority:task` | `:308` | `loadMutable` write | workflow 400 · Cancelled 422 |
| `edit` | `PATCH :id` `:193-202` | `update:task` | `task-core.service.ts:606` | `assertInScopeForWrite` `:630` | workflow 400 `:627`; không chặn Cancelled |
| `delete` | `DELETE :id` `:208-217` | `delete:task` `{isSensitive:true}` | `:944` (cùng `isSensitive`) | `assertInScopeForWrite` `:961` | workflow 400; + duyệt quyền ghi TỪNG CON (D-38 `:998-1010`) |

- Guard dùng `PermissionService.can` (`permission.guard.ts:123`); service dùng `resolveStrongestScope` → cùng `decideStrongestScope` (`permission.service.ts:772-784`, `:817-832`). Route chỉ qua khi CẢ HAI qua ⇒ `allowedActions` bám lớp service (chặt hơn hoặc bằng). [ĐO]
- Hàm phạm vi KHÔNG NÉM đã có: `ProjectAccessService.checkTaskInScopeTx` (`project-access.service.ts:135`) — `assertTaskInScopeTx` = hàm này + throw ⇒ một nguồn logic. Company/System ⇒ `true` không truy vấn. Còn lại: `dataScope.resolveContext` (`:143`) → `DataScopeRepository.getRequesterScopeContext` mở **`db.withTenant` RIÊNG** (`data-scope.repository.ts:44`) = **một kết nối LỒNG** trong lúc tx của người gọi còn giữ kết nối; `resolveContext` KHÔNG memo (`data-scope.service.ts:151`) ⇒ mỗi lời gọi một kết nối lồng. Sau đó 2 truy vấn trong tx (employee · EXISTS). Khuôn lồng này đã có sẵn (`resolveReadScopeExists` `:1097`, `loadMutable`) — WO này thêm, không mở khuôn mới. [ĐO]
- N cặp một lượt: `DataScopeService.resolveManyOrNull` (`data-scope.service.ts:138`) trả **mảng theo chỉ số** (tra theo khoá ⇒ `undefined` ⇒ deny hoá allow). [ĐO]
- Phạm vi write (`task-core.repository.ts:314-352`): người phụ trách (theo scopeCond) HOẶC thành viên dự án `project_role ∈ {Owner, Manager}` (`:337-339`). Mode `read` nhận MỌI thành viên Active. **Không nhánh nào cho người theo dõi** ⇒ người theo dõi có `read@Own` mà không là thành viên dự án thì GET đã 404; người theo dõi THẬT đọc được việc người khác thường là thành viên dự án role Member/Viewer (hoặc có read@Department/Company). [ĐO]
- **Lệch guard route ↔ cổng PATCH:** không thấy lệch MỚI. Đã biết (không vá ở đây): PATCH trường thường không chặn Cancelled trong khi route chuyên trách 422 (TASKPATCHGATE nợ D1) — `edit` phản ánh đúng PATCH; `POST :id/move` deprecated chỉ gác `update-status` (vòng qua `update-state`, chú thích `:344-347`). Ba trường có cổng của PATCH đã hội tụ cặp chuyên trách (#641, `task-patch-field-gate.ts`). security-reviewer đối chiếu lại bảng này; lệch thật ⇒ DỪNG phần đó, tách WO đỏ.

### 1.2 Hợp đồng + FE [ĐO]

- `taskCoreResponseSchema` `packages/contracts/src/task.ts:671-740` (z.object strip); `myTaskItemSchema` extend nó `:784`. FE parse chi tiết bằng chính schema này (`web-core task-core-api.ts:66-67`) ⇒ trường mới PHẢI vào schema, không thì bị strip.
- `getTask` `task-core.service.ts:210-231`: 404 khi `findScopedByIdTx` rỗng (company + RLS + read-scope) ⇒ mọi tính toán sau dòng này không lộ tồn tại.
- FE khoá theo `useCan`: `TaskInlineFields.tsx` status `:172`, state `:221`, priority `:294`, deadline+assign `:341-347`, assignee `:489`, row assignee `:540`, title `:611`, mô tả `:690`; `TaskDetailContent.tsx` canUpdate/canSetState `:88-96`, canDelete `useCanExact` `:272`. Hook `useTaskPatchFieldLocks` (`task-patch-field-locks.ts`, 27 dòng) dùng cho form Sửa. `TaskStateField` KHÔNG ẩn với việc con (chỉ ẩn khi không dự án/không cột `:252`; `TaskDetailContent.tsx:131` vẽ vô điều kiện) ⇒ hôm nay việc con bấm chip cột ⇒ 400.
- **Cache chi tiết sau thao tác:** `use-task-action-mutation.ts` `onSuccess` HỢP NHẤT `{...prev, ...result.task}` (`:134`), `onSettled` (`:140-151`) invalidate list/my/kanban/goal nhưng KHÔNG `taskKeys.detail`; `TaskStateField` (`TaskInlineFields.tsx:238-249`) cùng khuôn. Hook đã nhận `onSaved` (`:99,138`). Rollback 403: `:117-121` khôi phục `previous`. ⇒ phản hồi action không mang `allowedActions` thì bản cũ ở lại cache.
- Đường đổi trạng thái khác (ngoài `paths`): `TaskKanbanPage.tsx`, `hooks/use-task-bulk-action.ts`, `TaskRowQuickEdit.tsx`, `SubtaskInlineControls.tsx` — không invalidate `detail`. Chỉ `TaskLabelPicker.tsx:237` invalidate `detail`.
- Cỡ tệp: `task.ts` 824 · `task-core.service.ts` 1331 · `TaskInlineFields.tsx` **771** (sát trần 800) · `TaskDetailContent.tsx` 471 · `tasks-workux.ts` 217.
- Seed (`task-permissions.const.ts:102-142`): employee có `update`/`update-status`/`update-state` @Own, KHÔNG có assign/priority/deadline/delete.

### 1.3 Phụ thuộc S20-SEC-TASKPATCHGATE-1 [ĐO]

- #641 đã merge = `c9fd89c7`; sổ hậu merge `98b18f16` đóng dấu; `docs/STATUS.md` liệt kê trong «Đã xong (v2)». `harness/backlog.mjs:26236` `status: "todo"` là trường tĩnh — trạng thái thật lấy từ ledger (memory `wo-status-auto-ledger`) ⇒ phụ thuộc ĐÃ thoả. Mã nền có `task-patch-field-gate.ts` (`TaskPatchFieldGate`). Ghi một dòng trong mô tả PR để reviewer khỏi tra lại. Khoá dựa vào nó: `edit` (PATCH đòi cặp chuyên trách khi hạn/ưu tiên/người phụ trách đổi — FE vẫn khoá riêng từng trường theo `changeDeadline`/`changePriority`/`assign`).

## §2 Quyết định

- **Q1 Chỉ chi tiết việc.** Chi phí thêm ở `getTask`: 1 lượt đọc grant (memo trong request ≤2s, `read:task` vừa resolve ⇒ thường 0 round-trip [SUY RA]) + với MỖI phạm vi khác Company/System khác nhau (Own · Team · Department — thực tế ≤2): **1 kết nối lồng** (`resolveContext`, §1.1) + 2 truy vấn trong tx; + ≤1 truy vấn người theo dõi. Người gọi Company ⇒ 0 kết nối lồng. Dòng danh sách = N× ⇒ KHÔNG làm (nợ N1). Ca test ghim: `GET /tasks`, `/tasks/my` không có `allowedActions`.
- **Q2 Thêm khoá `changeState`** (cặp sẵn có `update-state:task`, không cặp mới): chi tiết vẽ CẢ `TaskStateField` lẫn `TaskStatusField` (`TaskDetailContent.tsx:131-132`); bỏ nó thì người theo dõi vẫn bấm được chip cột rồi lỗi ⇒ trượt tiêu chí 2. Chip cột đổi nhóm còn đòi `update-status` — giữ nguyên lỗi server hiện có.
- **Q3 Một bảng, một hàm.** `TASK_ALLOWED_ACTION_GATES` (khoá → `{action, isSensitive?, blockCancelled, rowGuard?}`) trong `apps/api/src/tasks/task-allowed-actions.ts`; cặp lấy đúng theo §1.1. Giá trị = `scope != null` (so lỏng) ∧ `checkTaskInScopeTx(…, scope, "write")` (memo theo giá trị scope) ∧ không phải workflow ∧ (`blockCancelled` ⇒ không Cancelled) ∧ (`rowGuard` ⇒ đúng). Không biểu thức quyền thứ hai.
  - `changeState` **gộp điều kiện hàng** `rowGuard = projectId != null ∧ parentTaskId == null` (đọc từ `row`, 0 truy vấn) — đúng hai nhánh 400 của `applyStateChangeTx` không phụ thuộc đầu vào. Lý do: FE KHÔNG ẩn chip cột với việc con (§1.2) ⇒ bit quyền thuần sẽ cho `true` cạnh 400, phá oracle O. Nhánh «cột dự án khác» phụ thuộc đầu vào (FE chỉ liệt kê cột của chính dự án) ⇒ không gộp. Ghim bằng unit (việc con ⇒ false; không dự án ⇒ false) + int R6.
  - Chế độ phạm vi LUÔN `"write"` (hằng trong helper, không tham số) — unit assert mọi lời gọi `checkTaskInScopeTx` mang `mode === "write"`.
- **Q4 Trước tx / trong tx.** `resolveManyOrNull` gọi TRƯỚC `withTenant` (khuôn `prepareStateWrite`); đọc kết quả bằng `[i]` của CHÍNH mảng requests. `checkTaskInScopeTx` + truy vấn người theo dõi chạy trong tx của `getTask`, SAU khi tìm thấy hàng — `checkTaskInScopeTx` tự mở kết nối lồng qua `resolveContext` (§1.1), helper memo theo giá trị scope ⇒ `resolveContext` chạy ≤1 lần/phạm vi khác nhau (≤2 với Own+Team), không bao giờ một lần/khoá. KHÔNG chép thân `checkTaskInScopeTx` vào helper (giữ một nguồn logic); biến thể nhận `ScopeContext` tính sẵn trước tx = nợ N8 (`project-access.service.ts` ngoài `paths`).
- **Q5 `delete` = điều kiện cần, chưa đủ:** không duyệt cây con (tốn truy vấn); xoá cha có con ngoài tầm ⇒ server vẫn từ chối như hiện nay (nợ N2).
- **Q6 `lockReason: "watcher" | null`** — chỉ khi `changeStatus`, `changeDeadline`, `assign` đều `false` VÀ người gọi đang theo dõi (`TaskActionsRepository.findActiveWatcherTx`, `task-actions.repository.ts:255`). FE: `"watcher"` ⇒ «Bạn chỉ theo dõi việc này»; còn lại ⇒ `fieldGate.locked` sẵn có. Inject `TaskActionsRepository` ở **CUỐI** constructor `TaskCoreService` (đã là provider của TasksModule — không đổi module).
- **Q7 Tương thích.** Trường `allowedActions` optional; từng khoá boolean optional (khoá thiếu ⇒ FE quay về `useCan` cho riêng khoá đó, parse không vỡ). Client cũ: schema cũ strip ⇒ không vỡ. Người gọi `viaApiKey` ⇒ bỏ trường (guard còn lọc scopeKeys mà helper không mô phỏng; đường này hiện chết — ApiKeyAuthGuard đã gỡ).
- **Q8 FE: server thắng khi có trường** (kể cả khi `useCan` nói khác); thiếu trường ⇒ đúng hành vi hiện tại. Không bao giờ dùng `allowedActions` thay cho cổng server. Vì `allowedActions` giờ mang cả trạng thái vòng đời (Cancelled) và phạm vi (người phụ trách), mọi thao tác trong `paths` có thể đổi chúng PHẢI invalidate `taskKeys.detail` sau thành công (Q10).
- **Q9 Không đổi cổng quyền, không thêm cặp, không migration.**
- **Q10 Invalidate chi tiết sau thao tác đổi vòng đời/phạm vi** (đóng N3 trong `paths`): thêm `useInvalidateTaskDetail(taskId)` vào `task-patch-field-locks.ts` (trả callback ổn định gọi `queryClient.invalidateQueries({queryKey: taskKeys.detail(taskId)})`). Gắn LUÔN (đơn giản hơn so trạng thái vào/ra Cancelled) ở: `TaskStatusField` qua `onSaved`; `TaskStateField.onSuccess` (sau `setQueryData` — auto-map có thể đổi status); hook assign (`TaskInlineFields.tsx:443`, phủ cả `TaskAssigneeField` lẫn `TaskRowAssigneeControl` — `/assign` đổi phạm vi ghi của người assign@Own). Priority/deadline KHÔNG đổi vòng đời/phạm vi ⇒ không gắn (tránh GET thừa). Mỗi chỗ +1 dòng; ngân sách `TaskInlineFields.tsx` vẫn ≤ 771 (hook L5 thay các khối `useCan` 4 dòng). `use-task-action-mutation.ts` KHÔNG sửa.

## §3 Lát thi công (thứ tự = RED trước)

1. **L1 contracts** — MỚI `packages/contracts/src/task-allowed-actions.ts` (`taskAllowedActionsSchema` 7 khoá boolean optional + `lockReason` enum nullable optional; type `TaskAllowedActions`; hằng `TASK_ALLOWED_ACTION_KEYS`) · `index.ts` +1 export · `task.ts` +1 import +1 dòng `allowedActions: taskAllowedActionsSchema.optional()` (KHÔNG import ngược task.ts ⇒ không vòng). Build qua run-heavy `pk`.
2. **L2 int-spec RED** — MỚI `apps/api/test/integration/s20-task-allowed-actions.int-spec.ts` (khuôn `task-patch-field-gate.int-spec.ts`: `applyMainPipeline`, `grant()`/`seedEmployee` — `grant()` tạo role riêng theo (scope, user) ⇒ mỗi người gọi một role; cổng `hasDb && LANE_DB`, không `Promise.all` quanh supertest; đánh dấu hàng seed + xoá ở `afterAll`). Chạy trên nền ⇒ ĐỎ (trường vắng).
3. **L3 helper BE** — MỚI `apps/api/src/tasks/task-allowed-actions.ts` (hàm thuần + `computeTaskAllowedActions(deps, …)`; deps = `projectAccess`, hàm kiểm theo dõi) + `task-allowed-actions.spec.ts` (unit).
4. **L4 nối `getTask`** — `task-core.service.ts`: resolve trước tx, tính trong tx sau khi có `row`, gắn vào DTO trả về; net ≤ +12 dòng. Cập nhật `task-core-codegen.spec.ts` (dựng theo vị trí — NGOÀI `paths`, ghi rõ trong PR).
5. **L5 FE** — `task-patch-field-locks.ts`: thêm `useTaskActionAccess(task)` (gọi `useCan`/`useCanExact` vô điều kiện, server thắng khi có khoá) + `useInvalidateTaskDetail(taskId)` (Q10) · `TaskInlineFields.tsx`: thay các khối `useCan` 4 dòng bằng hook, gắn invalidate ở status/state/assign (đo `wc -l` trước/sau, PHẢI ≤ 771) + hint lý do ở status/state/priority/deadline/assignee · `TaskFieldLockedHint.tsx`: prop `reason` · `TaskDetailContent.tsx`: canUpdate/canSetState/canDelete qua hook · `vi/tasks-workux.ts`: `fieldGate.watcherOnly`. Không namespace mới.
6. **L6 verify + review** — §5; security-reviewer đối chiếu §1.1 với guard + service thật.

## §4 Ca test (DENY ↔ ALLOW đứng cạnh)

Int-spec — người gọi theo cặp (mỗi người một role riêng qua `grant()`): **X** = read@Own + update/update-status/update-state@Own, là người phụ trách T · **X3** = như X, phụ trách T3 riêng (chỉ dùng cho R3) · **Y** = read@Company + cùng cặp @Own, KHÔNG phụ trách, không thành viên, ĐANG theo dõi T (hồ sơ tổng hợp) · **Y2** = cặp seed employee (read/update/update-status/update-state @Own), thành viên dự án của T `project_role='Member'`, ĐANG theo dõi T (giao cho X) — hồ sơ người theo dõi THẬT · **Z** = cặp như Y2, thành viên `project_role='Manager'`, không phụ trách · **M** = 7 cặp @Company · **B** = công ty khác, 7 cặp @Company. Dự án của T có ≥2 cột CÙNG nhóm (move-state không cần auto-map).

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| A1 ALLOW | X `GET /tasks/T` | `changeStatus`·`changeState`·`edit` = true; `assign`·`changeDeadline`·`changePriority`·`delete` = false; `lockReason` null; `POST change-status` 200 |
| R1 DENY | Y `GET /tasks/T` | 3 khoá chính + changeState/edit = false, `lockReason:"watcher"`; `POST change-status` ⇒ 404 (ngoài phạm vi ghi), hàng DB không đổi |
| R1b DENY | Y2 `GET /tasks/T` (đọc qua nhánh thành viên) | mọi khoá ghi false, `lockReason:"watcher"`; `POST change-status` ⇒ 404, hàng DB không đổi |
| A1b ALLOW | Z `GET /tasks/T` | `changeStatus`·`changeState`·`edit` = true (nhánh thành viên Manager ở mode write); `assign`·`changeDeadline`·`changePriority`·`delete` = false; `POST change-status` 2xx |
| A2 ALLOW | M `GET /tasks/T` | 7 khoá true |
| R2 DENY | B `GET /tasks/T` | 404; thân phản hồi trùng thân 404 của UUID ngẫu nhiên (bỏ requestId); không chứa chuỗi `allowedActions` |
| R3 DENY | X3 GET T3 (changeStatus true) → xoá grant `update-status` của role X3 qua `directPool` → `app.get("CACHED_PERMISSION_REPO").invalidateUser(companyId, X3)` (bỏ qua thì cache grant cho guard qua ⇒ xanh/đỏ giả) → `POST change-status` | 403 (thông điệp guard); GET lại ⇒ `changeStatus:false`. Role riêng X3 ⇒ X/Y/M của các ca sau không bị ảnh hưởng dù thứ tự chạy |
| R4 | M trên việc Cancelled | assign/changeDeadline/changePriority false; changeStatus/changeState/edit/delete true; oracle `change-priority` ⇒ 422 |
| R5 | M trên việc `task_type` workflow | mọi khoá false; oracle ⇒ 400 |
| R6 | M trên việc con (có dự án của cha) và trên việc không dự án | `changeState` false; oracle `POST move-state` ⇒ 400 cả hai; các khoá khác theo cặp |
| O | Oracle X/Y/Y2/Z/M × {changeStatus, changeState, changePriority, changeDeadline, assign, edit} trên việc mới mỗi lượt | `allowedActions[k]` ⇔ route trả 2xx (body no-op/chuyển hợp lệ; move-state sang cột khác cùng nhóm) |
| O-del | `delete`: M trên việc riêng ⇒ `delete:true` ⇔ `DELETE` 204 · X trên việc của X ⇒ `delete:false` ⇔ `DELETE` 403 | đứng cạnh nhau |
| L | `GET /tasks`, `GET /tasks/my` | dòng KHÔNG có `allowedActions` |

Unit helper: đọc theo chỉ số (phần tử `undefined` ⇒ false) · Company không gọi `checkTaskInScopeTx` · memo một lần/phạm vi (Own+Team ⇒ đúng 2 lời gọi, dù 7 khoá) · mọi lời gọi `checkTaskInScopeTx` có `mode === "write"` · `changeState` false với việc con / không dự án dù có cặp · `viaApiKey` ⇒ `undefined` · `lockReason` chỉ khi 3 khoá false ∧ đang theo dõi.

FE (`TaskInlineFields.spec.tsx`, `TaskDetailContent.discuss.spec.tsx`, `task-patch-field-locks.spec.ts` mới):

- F1 ALLOW: `allowedActions.changeStatus:true`, `useCan` false ⇒ badge bấm được. ↔ F2 DENY: 7 khoá false + `lockReason:"watcher"`, `useCan` true ⇒ badge/hạn/người phụ trách chỉ đọc + «Bạn chỉ theo dõi việc này» (đo bằng `textContent`); ô bình luận vẫn hiện, gửi được.
- F3: không có trường ⇒ hành vi `useCan` cũ (spec hiện có xanh nguyên) + ca tường minh.
- F4: `changeStatus:true`, API 403 ⇒ cache về giá trị cũ + FieldError.
- F5: `delete:false` ẩn nút Xoá dù `useCanExact` true ↔ trường vắng ⇒ theo `useCanExact`.
- F6: chi tiết `status:'Cancelled'` + `changeDeadline:false` → change-status sang `'To Do'` thành công ⇒ `queryClient.getQueryState(taskKeys.detail(id)).isInvalidated === true`. ↔ F6b: change-priority thành công ⇒ `detail` KHÔNG bị invalidate (ghim phạm vi Q10).
- F7: move-state thành công và assign thành công ⇒ `detail` invalidated.
- Mỗi ca R/F2/F5/F6/F7 chạy trên mã CHƯA vá trước ⇒ phải ĐỎ.

## §5 Hồi quy (CHỈ qua run-heavy chuỗi A, theo tệp)

- `pk` contracts+web-core build (TURBO_FORCE=1) → `tcapi` + `tc` typecheck api/app.
- Int-spec: `s20-task-allowed-actions` · `task-patch-field-gate` · `task-core` · `task-actions` · `task-core-tenant-deny` · `task-read-paths-scope` (dòng Test Files, skipped = KHÔNG đạt).
- Unit: `task-allowed-actions.spec` · `task-core-codegen.spec` · `task-core.mapper.spec` · `tasks.permissions.spec`.
- FE: `TaskInlineFields.spec` · `TaskDetailContent.*.spec` · `TaskDetailDrawer.spec` · `TaskDetailPage.spec` · `TaskFormDrawer` spec (dùng `useTaskPatchFieldLocks`) · `task-patch-field-locks.spec` · spec của `use-task-action-mutation` (không sửa, chạy lại vì `onSaved` mới dùng).
- eslint các tệp chạm; `bash harness/check.sh --lane-db` (WO đòi); trước PR nên `--all --lane-db` (amber).

## §6 Nợ / ngoài phạm vi

- N1 dòng danh sách không có `allowedActions` (cần truy vấn EXISTS gộp theo lô — WO riêng nếu cần).
- N2 `delete` không duyệt cây con (D-38) — server vẫn chặn.
- N3 (thu hẹp) cache chi tiết giữ `allowedActions` cũ: ĐÃ ĐÓNG trong `paths` cho status/state/assign (Q10). CÒN: đường đổi trạng thái ngoài `paths` (`TaskKanbanPage.tsx`, `use-task-bulk-action.ts`, `TaskRowQuickEdit.tsx`, `SubtaskInlineControls.tsx`) không invalidate `detail` ⇒ mở chi tiết đã có trong cache sau khi huỷ/khôi phục ở đó có thể thấy khoá cũ tới hết staleTime của query chi tiết [SUY RA] — WO riêng (gom một chỗ invalidate `detail` trong `taskCoreInvalidation`).
- N4 (đã biết) PATCH trường thường không chặn Cancelled; `POST :id/move` deprecated chỉ gác `update-status` — không vá ở đây; nếu security-reviewer xếp là lệch cổng ⇒ WO đỏ riêng.
- N5 `task.ts` (824→826) và `task-core.service.ts` (>800) cần tách.
- N6 tương đương `can()` (guard) ↔ `resolveStrongestScope` (service) chưa có test trực tiếp; ca Oracle phủ đầu-cuối cho cặp seed.
- N7 cùng màn chi tiết, `TaskLabelStrip` (`TaskLabelPicker.tsx`), checklist (`TaskChecklistPanel`), việc con (`TaskSubtaskPanel`), `TaskGoalField` vẫn khoá theo `useCan(update:task)` ⇒ người theo dõi có cặp @Own vẫn thấy bấm được và ăn 404 ở đó. Tiêu chí WO chỉ nêu trạng thái/hạn/người phụ trách; các tệp này ngoài `paths` ⇒ WO riêng (nối `allowedActions.edit`).
- N8 `checkTaskInScopeTx` mở kết nối lồng qua `resolveContext` ⇒ tới 2 kết nối lồng/GET chi tiết cho người gọi không phải Company. Hướng vá: biến thể nhận `ScopeContext` tính sẵn TRƯỚC tx (sửa `project-access.service.ts` — ngoài `paths`, WO riêng); phủ luôn `resolveReadScopeExists`/`loadMutable`.
- Chạm ngoài `paths`: `task-core-codegen.spec.ts` (constructor theo vị trí) — báo trong PR.

## Phản biện (review đối kháng v1 → v2)

1. **HIGH FE hồi quy cache sau change-status/move-state — NHẬN.** Đo đúng: merge + không invalidate `detail` (`use-task-action-mutation.ts:134,140-151`; `TaskInlineFields.tsx:238-249`). N3 v1 sai khi nói vá nằm ngoài `paths` — `onSaved` có sẵn, ba trường nằm trong `TaskInlineFields.tsx`. Thêm Q10 + F6/F6b/F7, thu hẹp N3. Chọn invalidate LUÔN ở status/state/assign (đơn giản), KHÔNG ở priority/deadline (không đổi vòng đời/phạm vi) — có ca ghim.
2. **MEDIUM thiếu ALLOW/DENY cho `changeState`/`delete` — NHẬN.** Thêm `changeState` vào O, thêm O-del, điền R4. Chọn GỘP điều kiện hàng (không dự án / việc con) vào `changeState` thay vì bit quyền thuần: phản biện nhỏ với gợi ý của review — FE KHÔNG ẩn chip cột với việc con (`TaskDetailContent.tsx:131` vẽ vô điều kiện, `:252` chỉ ẩn khi không dự án/không cột), nên bit thuần sẽ cho `true` cạnh 400. Thêm R6 + unit.
3. **MEDIUM deny-path thực tế cho người theo dõi — NHẬN.** Đo đúng: `buildReadScopeExists` không có nhánh watcher, write cap Owner/Manager (`:337-339`). Thêm Y2 (R1b), Z (A1b) và unit assert `mode === "write"`.
4. **MEDIUM kết nối lồng — NHẬN.** Đo đúng: `resolveContext` → `withTenant` riêng (`data-scope.repository.ts:44`), không memo (`data-scope.service.ts:151`). Sửa §1.1/Q1/Q4, memo theo scope (≤2), nợ N8; không chép thân hàm.
5. **LOW phủ UX một phần — NHẬN** dưới dạng nợ N7 (các tệp ngoài `paths`).
6. **LOW phụ thuộc TASKPATCHGATE — NHẬN một phần.** Đã đo: #641 merge `c9fd89c7`, ledger đóng dấu (STATUS «Đã xong»); `status:"todo"` trong `backlog.mjs` là trường tĩnh, không phải trạng thái thật ⇒ không có phần đỏ còn mở. Ghi §1.3 + một dòng trong PR.
7. **LOW cô lập R3 — NHẬN, bổ sung.** `grant()` vốn tạo role riêng theo (scope, user) nên X không chung role với Y/M; vẫn tách sang người gọi riêng X3/T3 để thứ tự chạy không đổi `changeStatus` của X ở O. Bổ sung điểm review bỏ sót: xoá grant qua `directPool` không đi qua outbox ⇒ PHẢI `invalidateUser` trên `CACHED_PERMISSION_REPO` (khuôn `chat-s7-call-rt1-signalling.int-spec.ts:1580`), không thì guard đọc grant cũ. Hàng seed đánh dấu + xoá ở `afterAll`.

## Sổ vết (thi công 09/11)

- RED (mã nền, int-spec + unit): `s20-task-allowed-actions.int-spec` 14 ca ĐỎ / 13 xanh (ca DENY đỏ vì trường `allowedActions` vắng: A1 · A1b · A2 · R1 · R1b · R3 · R4 · R5 · R6 · O×5 · O-del; R2/L/A giữ xanh có chủ đích như ca ghim). GREEN sau nối `getTask`: 7 int-spec (s20-task-allowed-actions · task-patch-field-gate · task-core · task-actions · task-core-tenant-deny) 116 ca xanh, 0 skipped.
- FE: các tệp spec mới import hook chưa tồn tại trên mã nền ⇒ không chạy được trên mã cũ (đỏ vì thiếu mô-đun); 136 ca FE vùng tasks xanh sau vá.
- Phản biện còn mở xử lý: (HIGH) nút «Đổi dự án» KHÔNG đọc `changeState` — `canMove = edit ∧ useCan(update-state)` (ca ALLOW việc không dự án + DENY thiếu cặp + DENY người theo dõi + F3 ở `TaskDetailContent.allowed-actions.spec.tsx`). (MEDIUM) `isWatcher` chạy LƯỜI: chỉ khi 3 khoá chính đều false (unit ghim). (LOW) form Sửa (`useTaskPatchFieldLocks`) vẫn chưa đọc `allowedActions` — `TaskFormDrawer` nằm ngoài `paths` ⇒ nợ N9 (còn mở lệch hai tín hiệu trên việc Cancelled: ô inline khoá, form Sửa vẫn mở; thuộc TASKPATCHGATE D1).
- Nợ mới: `task-core.service.ts` 1331 → ~1367 dòng (+36 > ước +12; N5 tách vẫn mở). Chưa chạy `check.sh --lane-db` / `--all --lane-db` (cả suite — bị cấm trên máy suy giảm CPU); PR cần chạy ở máy/CI khác.

## Sổ vết (vá review vòng 2, 09/11)

- [LOW security] `delete` true cạnh 403 TASK-ERR-047 — BÁC vá (giữ nợ N2), có lý do: đã chốt ở Q5 vì mỗi lần đọc chi tiết sẽ thêm 1 truy vấn con + N lần `checkTaskInScopeTx` (mỗi lần mở kết nối lồng, ≤1 lần/phạm vi đã memo cho cha nhưng con thì khác id nên không memo được) cho một khoá chỉ để trình bày; server vẫn chặn, không leo quyền. Không có ca test (không đổi hành vi).
- [LOW react-a11y] lý do khoá không gắn vào ô — VÁ: `useLockedFieldA11y` (`TaskFieldLockedHint.tsx`) sinh id bằng `useId` (hết trùng id khi ngăn kéo đè trang), khung giá trị chỉ-đọc có `role="group"` + `aria-label` «Chỉ đọc» (khoá i18n `fieldGate.readOnly`) + `aria-describedby` trỏ lời lý do chỉ khi lời đó được vẽ; áp cho 5 ô (trạng thái · cột · ưu tiên · người · hạn). Ca F2b (đỏ trên mã cũ: không có group/describedby → xanh) + F2c (không lý do ⇒ không describedby treo). Các id hằng `task-*-locked` không còn.
