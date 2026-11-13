# S20-TASK-MYTASKSLOAD-1 — «Việc của tôi» tải nhẹ + chip mục tiêu lọc /tasks

Nguồn: `harness/backlog.mjs` (done_when ×5) · S20-WORKUX-STORIES US-TASK-NV-02 + US-GOAL-NV-07 · SPEC-06 §13.9 · TASK-API-210 · SPEC-10 §7.
Nền: `2a0c7a56`. Không migration (index 0478 đã có).

## 1. Đo hiện trạng (file:line)

| # | Điểm đo | Kết quả |
|---|---|---|
| H1 | `apps/api/src/tasks/tasks.controller.ts:104-109` `GET /tasks/my` | Không có `@Query` — mọi tham số bị bỏ qua |
| H2 | `task-core.service.ts:389-398` `getMyTasks` → `task-core.repository.ts:572-612` `findMyTasksTx` | Không `limit`, không lọc trạng thái ⇒ trả MỌI việc kể cả Done/Cancelled |
| H3 | `packages/contracts/src/task.ts:537-541` `taskCoreOptionalBooleanParam` | ĐO bằng node trên dist: `overdue:"abc"` ⇒ `success, data:{}` — rác bị nuốt thành `undefined`, KHÔNG 400. Khuôn này không đạt «abc ⇒ 400» |
| H4 | `task.ts:566-588` `listTaskCoreQuerySchema` | Không có `goalId`. ĐO: `{goalId:"not-uuid"}` ⇒ `success, data:{}` — khoá lạ bị STRIP (zod 4 mặc định), không từ chối |
| H5 | `task-core.repository.ts:49-53,407` | `filter.goalId` ĐÃ có ở repo (dùng cho `GET /goals/:id/tasks`), chỉ thiếu nối từ query |
| H6 | `task-core.service.ts:183-217` `listTasks` | Không truyền `goalId`; trang trí qua `resolveSignedUrls(…,{user})` (:1365 → `task-row-decorations.ts:50`) |
| H7 | `task-goal-ref.policy.ts:63-109` + `task-core.mapper.ts:138-184` | Che `goalId/goalCode/goalName` ở server ĐÃ có (S20-SEC-GOALNAMEDTO-1): không `view:goal`/ngoài phạm vi/khoá API ⇒ null + `hasGoal` |
| H8 | `/tasks/my` + board | ĐÃ điền goalName có che: list/my qua `decorateTaskRows`; board `task-kanban.service.ts` (`visibleGoalIdsTx`). Int-spec `task-goal-ref-visibility.int-spec.ts` R4/R5/A1/A1b phủ cả `/tasks/my` và kanban |
| H9 | FE `/me/tasks` = `routes/me/MeTasksPage.tsx` | Chỉ đọc `GET /me/task-summary` (`contracts/me.ts:188-192` — 3 con số), KHÔNG có dòng việc ⇒ không có chỗ cho goalName/chip (N/A) |
| H10 | Người gọi nội bộ `getMyTasks(user)` | `dashboard/dashboard-widget-handlers.service.ts:277,283` (MY_TASKS đếm `rows.length` gồm cả việc đóng — vùng chuỗi B) · `me/me-aggregation.service.ts:274` (tự lọc việc đóng) |
| H11 | Tín hiệu cắt ở endpoint khác | Không route tasks nào dùng header cắt; `config/cors-options.ts:13` chỉ expose `Content-Disposition`; `web-core api-client.ts apiFetch` không trả header. Cơ chế sẵn có: `common/pagination.ts paginated()` → interceptor hoist khối `pagination` ngang `data` (data vẫn là mảng trần) |
| H12 | FE `MyTasksPage.tsx:348-355` | `taskKeys.my()` + `getMyTasks()`; `showDone` đã trên URL; `my-tasks-groups.ts:86` ẩn nhóm done ở client |
| H13 | `taskKeys.my` (`web-core query-keys.ts:454`) | Dùng ở `LeaveTaskHandoff.tsx:143` (tự lọc việc đóng, `leave-task-handoff.ts:37`) · `routes/tasks/hooks/optimistic-task-rows.ts:45` (PREFIX + `isRowArray`) · `query-keys.ts:524,528,1055` (invalidate theo prefix) |
| H14 | FE `task-list-search.ts` | Không có `goalId`; `TASK_LIST_FILTER_KEYS` quyết định «Xoá bộ lọc» |
| H15 | Chỗ gắn chip | `MyTasksPage.tsx:109-110` (dòng meta cạnh projectName) · `task-columns.tsx:25-40` (cột tiêu đề) · `KanbanCard.tsx` (244 dòng) |
| H16 | i18n | `vi/tasks-workux.ts:54 myTasks`, `:99 goalRef` (trộn vào namespace `tasks`) |
| H17 | Docs | `API-06` §13.1 (dòng 1156) bảng query; §13.3 (1353) ghi `/tasks/my-tasks` trong khi code là `/tasks/my` |

## 2. Quyết định

- **D1 — boolean CHẶT mới, không sửa helper cũ.** `taskCoreStrictBooleanParam` trong `packages/contracts/src/task-my.ts`: preprocess `"true"/true⇒true`, `"false"/false⇒false`, `undefined⇒undefined`, giá trị khác ĐI NGUYÊN ⇒ `z.boolean()` từ chối ⇒ 400. Lặp 2 lần (pipe kép) vẫn ổn. Lý do: sửa helper cũ đổi hành vi `overdue/parentOnly` (H3) — ngoài phạm vi.
- **D2 — `myTasksQuerySchema = z.object({ includeClosed: strict.optional() })`** + `MY_TASKS_CLOSED_LIMIT = 100` trong `task-my.ts`; `MyTasksQueryDto` ở `tasks.dto.ts`.
- **D3 — tín hiệu cắt = khối `pagination` của envelope** (H11), CHỈ khi `includeClosed=true`: `paginated(items, {page:1, per_page:max(items.length,1), total, total_pages:1, has_next: truncated, has_prev:false})`. `data` vẫn là mảng trần ⇒ FE cũ (`apiFetch` chỉ lấy `.data`) parse nguyên. Không dùng header: cần sửa CORS (ngoài paths) + đường api-client mới. `total` = số mở + số đóng thật; đếm thêm (count) CHỈ khi chạm trần.
- **D4 — truy vấn mới ở tệp mới** `apps/api/src/tasks/task-my-tasks.query.ts` (hàm thuần nhận `tx`, không DI ⇒ không chạm `tasks.module.ts`): dựng 3 vị từ assigned/created/watched một chỗ; `selectMyTasksTx(mode:'all'|'open'|'closed', limit?)`, `countMyClosedTx`. Đóng = `task_status in ('Done','Cancelled')`; mở = `is null or not in (…)`. Đóng sắp `coalesce(completed_at, updated_at) desc, id desc`, lấy `LIMIT+1`. Repo: chỉ `export` `TASK_CORE_SELECT`/`TASK_CORE_JOINS` và thân `findMyTasksTx` uỷ về `selectMyTasksTx('all')` (repo CO lại).
- **D5 — người gọi nội bộ giữ nguyên.** `getMyTasks(user)` giữ chữ ký + hành vi (mọi việc) cho dashboard (chuỗi B) và /me. Thêm `getMyTasksForList(user, {includeClosed})` → `{items, truncated, total}`; controller gọi hàm này. Service chỉ thêm dòng nối dây; ráp kết quả + dựng `pagination` ở `task-my-tasks.query.ts`/helper nhỏ.
- **D6 — `goalId` trên `GET /tasks`:** thêm `goalId: idSchema.optional()` vào `listTaskCoreQuerySchema` (+2 dòng). Service: `resolveViewer` NGOÀI tx (chỉ khi có goalId); trong tx: phạm vi đọc task (403 như cũ) → `visibleGoalIdsTx(tx, viewer, [goalId])`; không chứa ⇒ trả `[]` (không 404/403 — không lộ tồn tại); có ⇒ `listTx({…, goalId})` vẫn AND với phạm vi đọc. Helper `assertGoalFilterVisibleTx` ở tệp mới `task-core.goal-filter.ts`. Công ty khác/không tồn tại/xoá mềm ⇒ `selectReadableGoalIdsTx` trả rỗng ⇒ `[]`. Khoá API ⇒ viewer che hết ⇒ `[]` (khớp luật che).
- **D7 — che goalName: KHÔNG đổi luật** (H7/H8 đã đạt); WO chỉ thêm ca hồi quy cho đường việc-đã-đóng. Không vượt «null khi không `view:goal`» ⇒ không cần nâng vùng.
- **D8 — FE cache giữ MẢNG.** `taskKeys.my(params?)`: `includeClosed===true` ⇒ `[...,"my",{includeClosed:true}]`, ngược lại ⇒ `[...,"my"]` (chuẩn hoá ⇒ MyTasksPage mặc định và LeaveTaskHandoff dùng chung cache; prefix ở H13 vẫn khớp; `optimistic-task-rows.ts` không phải sửa). `getMyTasks(query?)` vẫn trả `MyTaskItemDto[]`, chỉ gửi `includeClosed=true` khi bật. Thông báo «chỉ hiện tối đa N việc đã xong gần nhất» khi `showDone` và số việc đóng ≥ `MY_TASKS_CLOSED_LIMIT` (chữ «tối đa» đúng cả ca bằng trần) — không đổi dạng cache để đọc envelope.
- **D9 — TaskGoalChip** (`routes/tasks/TaskGoalChip.tsx`): chỉ vẽ khi `goalId && goalCode`; `hasGoal` mà bị che ⇒ KHÔNG chip. `<Link to="/tasks" search={{goalId}}>`, `title="{code} — {name}"`, `max-w-[12rem] truncate min-w-0`, `stopPropagation` (không mở drawer/không kéo thẻ board).
- **D10 — /tasks lọc mục tiêu:** `goalId` vào `TaskListSearch` (uuid, rác ⇒ bỏ) + `TASK_LIST_FILTER_KEYS` + `toTaskListQuery`. Nhãn «Đang lọc theo mục tiêu {code — name}» lấy từ dòng đầu; danh sách rỗng ⇒ «Đang lọc theo một mục tiêu»; nút «Bỏ lọc mục tiêu». Không gọi API goals.
- **D11 — TƯƠNG THÍCH FE lên trước API** (đo H1/H4): `/tasks/my?includeClosed=true` trên API cũ ⇒ tham số bị bỏ, trả mọi việc ⇒ FE chạy như hôm nay (vì thế GIỮ việc ẩn nhóm done ở client, H12). `/tasks?goalId=` trên API cũ ⇒ strip, 200, danh sách KHÔNG lọc ⇒ không 400/không trắng màn; chặn nhãn sai bằng lọc phòng thủ ở client `rows.filter(r => r.goalId === search.goalId)` (no-op trên API mới vì cổng D6 đảm bảo `goalId` hiện). API lên trước FE (ít gặp): FE cũ không gửi tham số ⇒ «Hiện việc đã xong» trống tới khi Pages lên.

## 3. Lát thi công

- **L1 contracts** — `task-my.ts` (strict bool, `myTasksQuerySchema`, `MY_TASKS_CLOSED_LIMIT`) + `task-my.spec.ts`; `task.ts` +`goalId`; `index.ts` export. Build `pk`.
- **L2 API /my** — `task-my-tasks.query.ts` (+ `.spec.ts` cho dựng pagination/cắt); repo export 2 hằng + uỷ thân; `tasks.dto.ts` `MyTasksQueryDto`; service `getMyTasksForList`; controller `@Query() query: MyTasksQueryDto`, trả `paginated` khi `includeClosed`.
- **L3 API goalId** — `task-core.goal-filter.ts`; nối 4-6 dòng vào `listTasks`.
- **L4 int-spec** — `apps/api/test/integration/s20-task-mytasks-load.int-spec.ts` (dựng app qua `applyMainPipeline`; seed 500 Done bằng MỘT `insert … generate_series`; công ty riêng, dọn ở `afterAll`).
- **L5 web-core** — `task-core-api.ts getMyTasks(query?)`; `query-keys.ts taskKeys.my(params?)` (+ ca ở `query-keys.spec.ts`). Build `pk`.
- **L6 FE** — `TaskGoalChip.tsx` (+spec); `MyTasksPage.tsx` (key/queryFn theo `showDone`, chip, thông báo trần); `task-columns.tsx` chip; `KanbanCard.tsx` chip; `task-list-search.ts` + `TaskListPage.tsx` (nhãn + bỏ lọc + lọc phòng thủ); `LeaveTaskHandoff.tsx` giữ `taskKeys.my()` (xác nhận, chỉ sửa nếu typecheck đòi); `vi/tasks-workux.ts` thêm khoá gốc `goalChip` + `myTasks.closedCapped`.
- **L7 docs** — API-06 §13.1 thêm dòng `goal_id`/`goalId`; §13.3 một câu `includeClosed` (mặc định false, trần 100, `pagination.has_next` = bị cắt; route thật `/tasks/my`).

## 4. Ca RED (DENY ⇄ ALLOW đứng cạnh)

| Ca | DENY | ALLOW |
|---|---|---|
| M1 | 500 Done + 15 mở, không tham số ⇒ đúng 15, không có Done | `includeClosed=true` ⇒ 15 + 100 Done, `pagination.has_next=true`, `total=515` |
| M2 | `includeClosed=abc` ⇒ 400 (mã lỗi validate, không 500); `includeClosed=` ⇒ 400 | `includeClosed=false` ⇒ 200, 15 |
| M3 | 3 Done (dưới trần) + `includeClosed=true` ⇒ `has_next=false`, `total=18` (không báo cắt oan) | — |
| M4 | `data` luôn là mảng (`Array.isArray`) ở cả hai chế độ | — |
| M5 | Người công ty B `includeClosed=true` ⇒ 0 việc của A | Người A thấy việc của A |
| M6 | Việc Done gắn mục tiêu ngoài phạm vi `view:goal` ⇒ `goalName=null`, `hasGoal=true` | Mục tiêu trong phạm vi ⇒ đủ 3 trường |
| G1 | `goalId=abc` ⇒ 400 | `goalId=<uuid hợp lệ>` ⇒ 200 |
| G2 | Việc không gắn G / gắn mục tiêu khác ⇒ không có trong kết quả | Việc gắn G trong phạm vi đọc ⇒ có |
| G3 | `goalId` = mục tiêu công ty B / uuid không tồn tại / mục tiêu xoá mềm ⇒ `[]`, 200 | — |
| G4 | Người đọc được việc của G nhưng không `view:goal` (hoặc G ngoài phạm vi mục tiêu) ⇒ `[]` | Người có `view:goal` với G ⇒ danh sách việc của G |
| G5 | Việc gắn G nhưng ngoài phạm vi `read:task` ⇒ vẫn bị loại (bộ lọc không nới quyền) | — |
| G6 | Không có `read:task` + `goalId` ⇒ 403 như cũ (cổng quyền chạy trước cổng mục tiêu) | — |
| F1 | Chip: `goalId=null` (`hasGoal=true`) ⇒ không vẽ | Có mã+tên ⇒ link `/tasks?goalId=…`, có `title`, lớp `truncate` |
| F2 | `?goalId=rác` ⇒ bị bỏ khỏi search, không ném | `?goalId=<uuid>` ⇒ query có `goalId`, nhãn + «Bỏ lọc mục tiêu» xoá khoá |
| F3 | Mặc định: `getMyTasks` gọi KHÔNG `includeClosed` | Bật «Hiện việc đã xong» ⇒ gọi `{includeClosed:true}`, key khác; ≥100 việc đóng ⇒ thông báo trần |
| F4 | `taskKeys.my({includeClosed:false})` deep-equal `taskKeys.my()` | `taskKeys.my()` là prefix của `my({includeClosed:true})` |
| F5 | API cũ (mock trả mảng không lọc) + `?goalId=G` ⇒ chỉ hiện dòng `goalId===G` | — |

## 5. Hồi quy cần chạy (qua run-heavy, từng tệp)

- Int (lane `mediaos_w5a`): `s20-task-mytasks-load` (mới) · `task-goal-ref-visibility` · `task-core` · `task-subtask-counting` · `task-read-paths-scope` · `tasks-core-param-uuid` · `s20-task-allowed-actions` · `task-qa1-permission-matrix` · `qae2e1-full-journey` · `dashboard-widget-data` + `me-personal-hub` (người gọi nội bộ, kỳ vọng không đổi). Dòng «Test Files»: skipped = KHÔNG đạt.
- Unit API: `task-core.mapper.spec.ts`, `task-my-tasks.query.spec.ts`; typecheck api.
- Contracts/web-core: `task-my.spec.ts`, `query-keys.spec.ts`, build `pk`.
- FE: `MyTasksPage.spec.tsx`, `MyTasksPage.quickedit.spec.tsx`, `my-tasks-groups.spec.ts`, `TaskListPage.spec.tsx`, `task-list-search.spec.ts`, `TaskKanbanPage.card.spec.tsx`, `TaskGoalChip.spec.tsx`, `LeaveTaskHandoff.spec.tsx`, `LeaveRequestDetailPage.spec.tsx`; typecheck app; eslint các tệp đổi.
- Cuối: `bash harness/check.sh --all --lane-db=w5a` (census route/OpenAPI có thể thấy `@Query` mới trên `/tasks/my`).

## 6. Nợ / rủi ro

- Widget dashboard MY_TASKS vẫn tải mọi việc kể cả đóng và đếm `rows.length` gồm việc đóng (H10, vùng chuỗi B) — WO riêng.
- Tập việc MỞ vẫn không trần (giữ hành vi); người có hàng nghìn việc mở chưa được bảo vệ.
- Lọc phòng thủ client (D11) gỡ được khi API đã lên chắc chắn.
- API-06 §13.3 còn lệch tên route (`/my-tasks` vs `/my`) và bộ query mô tả chưa có — chỉ thêm câu ngắn, không viết lại.
- Chip trên thẻ board: kiểm `stopPropagation` không phá kéo-thả (dnd) — đo ở spec card.

## 7. Chốt sau review plan (thực thi)

- Tệp cổng mục tiêu đặt tên `task-core.goal-filter.ts` (khớp glob `task-core.*` của WO) thay `task-list-goal-filter.ts`.
- `myTasksBaseWhere` (company_id + `deleted_at IS NULL` + OR 3 nguồn) dùng chung cho chế độ all/open/closed và phép đếm; spec đo SQL có đủ hai điều kiện; int-spec có việc Done xoá mềm (không có trong `data`, không vào `total`).
- `getMyTasksForList` và `getMyTasks` chung `decorateMyRows` (cùng `resolveAndAssert` + `resolveSignedUrls` + `toMyDto`) ⇒ che mục tiêu ở cả dòng mở lẫn đóng (ca M6 phủ cả hai).
- `total_pages = ceil(total / per_page)`; chỉ `has_next` + `total` mang nghĩa tín hiệu cắt. Đóng sắp theo `coalesce(completed_at, cancelled_at, updated_at) desc, id desc`.
- FE: `includeClosed` suy từ biến `showDone` tổng hợp (cả `?group=done`); `placeholderData: keepPreviousData` + giữ dòng tốt gần nhất khi lần tải sau lỗi (lỗi chỉ báo tại chỗ). Thông báo trần chỉ khi số việc đóng nhận về BẰNG trần (lớn hơn ⇒ API cũ ⇒ ẩn).
- Chip nằm NGOÀI mặt thẻ role=button trên board; chặn `onClick` + `onPointerDown`, `draggable={false}` (board dùng kéo-thả HTML5 gốc, không dnd-kit). 375px: jsdom không đo được ⇒ chip `max-w-[12rem] truncate min-w-0`, kiểm bằng mắt là nợ.
- Cổng quyền của lát `goalId`: unit spec phủ nhánh viewer che hết (khoá API / không `view:goal`) ⇒ không truy vấn; nên có `security-reviewer` trong vòng review.
- Ghi chú WO: D1 thay khuôn `taskCoreOptionalBooleanParam` bằng helper chặt (helper cũ nuốt `abc` thành undefined, không 400); `overdue`/`parentOnly` vẫn nuốt rác (nợ, WO riêng).

## 8. Sổ vết

- RED int-spec `s20-task-mytasks-load` trên mã cũ (contracts đã có `goalId`): 8 ca ĐỎ / 4 xanh (xanh: ca vốn đúng trên mã cũ — G1/G3-nhánh rác/G6/M-tenant). Sau code: 12/12 xanh.
- Unit: `task-my.spec.ts` 10 · `task-my-tasks.query.spec.ts` 10+ · FE mới: `MyTasksPage.load` 5 · `TaskGoalChip` 4 · `KanbanCard.goalchip` 2 · `TaskListPage` +4 · `task-list-search` +2 · `query-keys` +2.
- Hồi quy int (lane `mediaos_w5a`): task-goal-ref-visibility + task-core (40) · subtask-counting + read-paths-scope + param-uuid (127) · allowed-actions + qa1-permission-matrix (81) · qae2e1 + dashboard-widget-data + me-personal-hub (48) — xanh, không skip. (Chạy 5 tệp một lệnh gặp thoát bất thường của tiến trình vitest — chạy lại 2–3 tệp/lệnh xanh.)
- Tương thích FE lên Pages trước API (đo H1/H4): `/tasks/my?includeClosed=true` trên API cũ ⇒ tham số bị bỏ, trả mọi việc ⇒ FE chạy như hôm nay (không thông báo trần vì số việc đóng > trần). `/tasks?goalId=` trên API cũ ⇒ query DTO strip khoá lạ, 200, danh sách không lọc ⇒ lọc phòng thủ client giữ danh sách đúng; không 400.
- Vá review (FE): [LOW] công tắc «đã xong» không báo đang tải ⇒ `isPlaceholderData` ⇒ dòng `role=status` (`my-tasks-closed-loading`) + `aria-busy`; ca mới bật công tắc false→true (lần 2 gọi `{includeClosed:true}`, danh sách mở còn nguyên) ĐỎ→xanh. [MEDIUM] tải lại nền lỗi khi công tắc tắt im lặng ⇒ báo lỗi tại chỗ cho mọi `isError && data` (thông điệp chung `myTasks.refreshError` khi tắt) + dòng dự phòng nhớ kèm khoá `includeClosed`, khác khoá ⇒ chỉ dùng lại dòng mở; ca refetch lỗi khi tắt ĐỎ→xanh, ca đổi khoá xanh (khoá hành vi). Spec load 8 ca + họ MyTasksPage 45 xanh; typecheck + eslint xanh.
