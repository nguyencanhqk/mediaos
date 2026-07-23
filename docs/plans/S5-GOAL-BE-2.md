# S5-GOAL-BE-2 — BE vòng đo mục tiêu (progress engine 4 mode · check-in/chốt kỳ · gắn task · NOTI · job đối soát)

> Nguồn sự thật: [SPEC-10 GOAL](<../spec/SPEC-10 GOAL.md>) §13 (đo tiến độ) · §12 (GOAL-ERR-005/006/008/
> 012/013/014) · §15 (GOAL-API-007..010) · §17 (2 event NOTI) · §11 (cặp quyền) · §18 (audit/bảo mật);
> [DB-11](<../DB/DB-11 GOAL Database Design.md>) §6.2 (`goal_updates`) · §6.5 (`tasks.goal_id`).
> Nền: **S5-GOAL-DB-1** (migration 0504–0507) + **S5-GOAL-BE-1** (PR #263 — CRUD/cây/scope).
> WO này **KHÔNG tạo migration** (band 0510+ đã có WO khác giữ chỗ) — chỉ code.

Trạng thái: **ĐÃ HIỆN THỰC + XANH** (lane `s5goalbe2`, worktree `../mediaos-s5goalbe2`, DB cô lập
`mediaos_s5goalbe2`). 33 int-spec BE-2 mới + 17 unit-spec engine; 69 int-spec BE-1 giữ nguyên XANH;
toàn bộ suite `apps/api` xanh (220 unit-file/3412 test · 183 int-file/3247 test).

---

## 1. Phạm vi đã làm

| Mã           | Endpoint / cơ chế                              | Ghi chú hiện thực                                                              |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| GOAL-API-007 | `POST /goals/:id/check-in`                     | cặp `('checkin','goal')`; GOAL-ERR-006; ghi sổ `goal_updates` type `checkin`   |
| GOAL-API-008 | `GET /goals/:id/updates`                       | cặp `('view','goal')`; phân trang `z.coerce` (idempotent 2 lần pipe)           |
| GOAL-API-009 | `POST /goals/:id/finalize` · `/reopen`         | cặp `('finalize','goal')`; GOAL-ERR-014; ledger `finalize`/`reopen` + audit    |
| GOAL-API-010 | `GET`/`POST /goals/:id/tasks` · `DELETE .../:taskId` | cặp `('update','goal')` (quyết định D2 bên dưới); GOAL-ERR-008           |
| §13.1        | `GoalProgressEngineService` (4 mode)           | đặt ở `apps/api/src/tasks/` — xem D1                                           |
| §13.3        | recompute ĐỒNG BỘ trong tx tại writer THẬT     | `task-actions.changeStatusTx` · `task-core.updateTask/deleteTask` · GOAL writer |
| §17          | `GOAL_ASSIGNED` / `GOAL_FINALIZED`             | registrar mới trên `OutboxNotificationBridge` ĐÃ SHIP (không dựng bridge mới)  |
| §13.3        | job đối soát đêm `GOAL_PROGRESS_RECONCILE`     | `@SystemJobHandler`, gom qua DiscoveryService (KHÔNG sửa `scheduler.module.ts`) |

## 2. File đã tạo / sửa

**Mới**

- `apps/api/src/tasks/goal-progress-engine.service.ts` + `.repository.ts` + `.service.spec.ts`
- `apps/api/src/goals/goal-access.service.ts` (tách thuần từ `goals.service.ts`) ·
  `goal-updates.repository.ts` · `goal-checkin.service.ts` · `goal-tasks-link.service.ts` ·
  `goal-noti.payload.ts` · `goal-reconciliation.job-handler.ts`
- `apps/api/src/notifications/goal-audience.reader.ts` · `goal-noti-bridge.registrar.ts`
- `apps/api/test/integration/goal-be2-{progress,checkin,link}.int-spec.ts`

**Sửa (additive)**

- `packages/contracts/src/goal.ts` — khối BE-2 ở CUỐI (check-in/finalize/updates/link + `GOAL_LINK_TASKS_MAX`).
- `packages/contracts/src/task.ts` — `goalId`/`goalCode`/`goalName` `.optional().nullable()` vào
  `taskCoreResponseSchema` (KHÔNG `.default()` — giữ Input=Output cho `apiFetch<T>`).
- `apps/api/src/tasks/task-core.repository.ts` — `TASK_CORE_SELECT` + LEFT JOIN `goals gl` (ràng
  `company_id` trong ON) · `goalId` vào `TaskRawRow`/`listActiveChildrenTx` · filter `goalId`.
- `apps/api/src/tasks/task-core.mapper.ts` — 3 field mới trong `toTaskCoreDto` (MAPPER DUY NHẤT).
- `apps/api/src/tasks/task-actions.repository.ts` — `goal_id` vào `findActionRawTx`.
- `apps/api/src/tasks/{task-actions,task-core}.service.ts` — inject engine + hook recompute (xem §4).
- `apps/api/src/tasks/tasks.module.ts` · `goals.module.ts` · `notifications.module.ts` — khối additive.
- `apps/api/src/goals/{goals.service,goals.repository,goals.mapper,goals.errors,goals.dto,goals.controller}.ts`.
- `apps/api/src/tasks/task-core-codegen.spec.ts` — thêm mock dependency CUỐI danh sách (spec dựng theo vị trí).

KHÔNG đụng: `apps/api/migrations/**`, `src/db/schema/**`, seed permission, audit `object_types`.

## 3. Quyết định chốt trong WO này

| #   | Quyết định                                                                                                 | Lý do                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Engine đo tiến độ đặt trong `apps/api/src/tasks/`**, không trong `goals/`                                | `GoalsModule` đã import `TasksModule` (lấy `ProjectAccessService` từ BE-1). Đặt engine ở `goals/` buộc `TasksModule` import ngược ⇒ **cycle DI**. Nguồn số cũng nằm ở `tasks`/`projects`.                                                     |
| D2  | **Gắn/tháo task dùng LẠI cặp `('update','goal')`**, KHÔNG bịa cặp mới                                      | SPEC-10 §11 không định nghĩa cặp riêng; migration 0506 chỉ seed 7 cặp. Cặp không có trong bảng `permissions` ⇒ `resolveAndAssert` ném 403 cho MỌI người (kể cả admin), và lane này **không được tạo migration**. Gắn task = sửa tập đo của goal. |
| D3  | `GET /goals/:id/tasks` gate **HAI cổng**: `view:goal` (controller) + `read:task` scope (service)            | Chỉ gate `view:goal` thì người thấy mục tiêu đọc được tiêu đề/người phụ trách của việc họ không mở được (bài học `read-path-gate-pair-must-match-download-pair`). Đọc bằng đúng `TaskCoreRepository.listTx` + `toTaskCoreDto`.                |
| D4  | Check-in ghi **`current_value`**, engine là writer **DUY NHẤT** của `progress_percent`                      | Nếu check-in ghi thẳng `progress_percent` thì với mode `tasks/project/children` số người nhập sẽ bị job đối soát đêm "sửa" ngược lại mỗi đêm — người dùng thấy số của mình biến mất mà không hiểu vì sao.                                     |
| D5  | Gửi CẢ `currentValue` lẫn `progressPercent` ⇒ **422**, không đoán hộ                                        | Hai field là hai cách gọi cùng một cột tuỳ `measure_type`; đoán hộ ⇒ ghi sai ~50% số lần mà không ai biết.                                                                                                                                   |
| D6  | Recompute **KHÔNG ghi `goal_updates`**                                                                     | DB-11 §6.2 ghi rõ: sổ chỉ nhận `checkin`/`finalize`/`reopen` (hành vi CỦA NGƯỜI). Ghi recompute vào sổ = phình bảng append-only bằng nhiễu máy sinh, và không xoá được.                                                                       |
| D7  | Recompute **KHÔNG bump `updated_at/updated_by`** của `goals`                                               | Đây là hệ quả tự động, không phải "người dùng sửa mục tiêu"; bump mốc sẽ đẩy goal lên đầu danh sách "mới cập nhật" mỗi lần ai đó tick một task.                                                                                              |
| D8  | Bulk link là **TẤT-CẢ-HOẶC-KHÔNG** (một task vi phạm GOAL-ERR-008 ⇒ 422, 0 hàng ghi)                        | Gắn nửa lô rồi báo lỗi để lại trạng thái không ai kiểm chứng được; người dùng bấm lại sẽ nhân đôi phần đã gắn.                                                                                                                               |
| D9  | Job đối soát chỉ đọc goal của **kỳ đang chạy** và **chưa chốt**, gói trong ĐÚNG MỘT `withTenant`            | `JobRunner` đóng tx enumerate TRƯỚC khi gọi `run()`; PgBouncer transaction-mode + tx lồng = treo. Quét toàn bộ lịch sử mỗi đêm cũng vô nghĩa (kỳ cũ đã chốt hoặc không ai xem nữa).                                                            |
| D10 | Goal đã chốt kỳ **KHÔNG được job sửa**, kể cả khi cache bị làm lệch bằng SQL tay                            | Đóng băng nghĩa là đóng băng. Job "sửa hộ" số đã chốt = thay đổi kết quả đánh giá sau khi đã chốt, im lặng.                                                                                                                                  |

## 4. Điểm móc recompute (đã grep writer THẬT, không tin comment)

| Writer                                            | Móc gì                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `TaskActionsService.changeStatusTx`               | `recomputeForTaskTx(raw.goalId, raw.projectId)` — SAU khi FSM/khoá/activity/audit/outbox xong |
| `TaskCoreService.updateTask`                      | đổi `projectId` ⇒ recompute goal mode='project' của dự án **CŨ + MỚI**; + goal của task     |
| `TaskCoreService.deleteTask`                      | recompute goal của **từng con** vừa xoá lan + goal của cha + goal mode='project'             |
| `GoalsService.createGoal/updateGoal/deleteGoal`   | recompute chính nó **+ `recomputeParentTx`** (xem bẫy B1)                                    |
| `GoalCheckinService.checkIn/finalize/reopen`      | recompute trước khi ghi sổ (finalize: recompute lần cuối TRƯỚC khi đóng băng)                |
| `GoalTasksLinkService.linkTasks/unlinkTask`       | recompute goal MỚI + goal CŨ của từng task + goal mode='project' của dự án liên quan         |

## 5. Bẫy đã xử lý

- **B1 — cha KHÔNG tự cập nhật khi con đổi (BUG THẬT, int-spec P4 bắt được, không phải giả định):**
  `recomputeGoalTx` chỉ bubble khi tiến độ **của chính nó** đổi. Huỷ một mục tiêu con 100% không làm
  tiến độ con đổi (vẫn 100%) nhưng làm cha phải bỏ nó khỏi rollup ⇒ cha giữ số cũ, âm thầm sai. Vá bằng
  `recomputeParentTx` gọi tường minh ở create/update/delete goal. **RED trước GREEN**: test kỳ vọng 60
  nhận 70 trước khi vá.
- **B2 — mode='project' và cột chết**: engine gọi `ProjectsRepository.countsByStatusLeafTx` CÙNG TX;
  int-spec đặt `projects.progress_percent = 99` và chứng minh số của mục tiêu KHÔNG đổi theo.
- **B3 — `null` ≠ `0%`**: phủ ở cả unit (công thức) lẫn int-spec (0 task gắn ⇒ NULL; gắn 2 task chưa
  Done ⇒ 0 — hai giá trị KHÁC NHAU đi qua cùng một đường).
- **B4 — payload NOTI câm**: int-spec đọc `notification_templates` THẬT của 0507, rút mọi `{placeholder}`
  bằng regex rồi assert payload outbox có ĐỦ khoá. Sai tên khoá ⇒ renderer giữ nguyên `{...}`, không lỗi.
- **B5 — append-only ở tầng GRANT**: probe mở kết nối bằng ĐÚNG app role (`DATABASE_URL`, không phải
  direct superuser) và khẳng định `UPDATE`/`DELETE goal_updates` bị Postgres từ chối `permission denied`.
- **B6 — FK đơn cột không ép cùng-tenant**: mọi `taskId`/`goalId` resolve dưới `company_id` TRƯỚC khi
  ghi; int-spec L2 thử 7 vector chéo tenant ⇒ 404 sạch + hậu kiểm SQL "0 task của A trỏ sang goal của B".
- **B7 — backtick trong template SQL**: comment chứa `` ` `` bên trong `` sql`...` `` làm vỡ parse
  TypeScript (TS1005/TS1127) — comment về JOIN phải nằm NGOÀI template literal.
- **B8 — spec dựng service theo VỊ TRÍ tham số**: dependency mới của `TaskCoreService` phải thêm ở CUỐI
  constructor và cuối mock trong `task-core-codegen.spec.ts`.
- **B9 — `POST /tasks/:id/change-status` trả 200** (route khai `@HttpCode(200)`), không phải 201.
- **B10 — `tasks.task_type` có CHECK** (`office`/`production`/…): seed task bằng direct pool phải dùng
  giá trị hợp lệ, `'general'` vỡ constraint.

## 6. Kiểm chứng đã chạy

```bash
bash scripts/lane-db-setup.sh s5goalbe2     # đã có sẵn (worktree chuẩn bị trước)
export LANE_DB=mediaos_s5goalbe2
pnpm --filter @mediaos/contracts build      # dual ESM/CJS (chống stale-dist false-red)
pnpm --filter @mediaos/api typecheck        # sạch
pnpm --filter @mediaos/api lint             # 0 error (42 warning tiền tồn ở file khác, 0 ở file mới)

npx vitest run src/tasks/goal-progress-engine.service.spec.ts   # 17 passed (unit công thức)
npx vitest run test/integration/goal-be2-progress.int-spec.ts   # 14 passed
npx vitest run test/integration/goal-be2-checkin.int-spec.ts    #  9 passed
npx vitest run test/integration/goal-be2-link.int-spec.ts       # 10 passed
npx vitest run test/integration/goal-be1-*.int-spec.ts          # 69 passed (REGRESSION BE-1)
npx vitest run src --shard=1/2 && --shard=2/2                   # 220 file / 3412 test passed
npx vitest run test/integration --shard=1..3/3                  # 183 file / 3247 test passed
```

> ⚠️ Bẫy hạ tầng (đã ghi ở BE-1): `vitest run src` một lượt có thể chết giữa chừng với
> `ERR_IPC_CHANNEL_CLOSED` — **crash worker, KHÔNG phải test đỏ**. Chạy theo `--shard` mới ra kết luận thật.

Bằng chứng RED trước GREEN: (a) B1 ở trên — test đỏ với số sai trước khi thêm `recomputeParentTx`;
(b) 3 int-spec BE-2 chạy khi chưa có route ⇒ toàn bộ 404 `Cannot POST /goals/:id/check-in`.

## 7. Còn nợ / bàn giao

- **Chưa làm (ngoài phạm vi WO)**: GOAL-API-011 phân rã từ template (`decompose`) + GOAL-API-012
  (`task_templates`) — bảng chưa tạo, thuộc WO riêng. `GOAL-ERR-009` do đó chưa có đường kích hoạt.
- **Job `GOAL_PROGRESS_RECONCILE`** đã được DiscoveryService gom (có int-spec chứng minh trong container
  thật) nhưng **chưa có hàng `system_jobs`** — không cần cho `JobRunner` (nó tự tạo run-row/lock); nếu
  màn hình quản trị job cần liệt kê thì seed thuộc WO ops riêng.
- **FE (S5-GOAL-FE-\*)**: DTO đã sẵn ở `@mediaos/contracts` — `checkinGoalSchema`,
  `goalUpdateResponseSchema`, `linkGoalTasksSchema`, `goalTaskLinkResultSchema`, và
  `taskCoreResponseSchema.goalId/goalName`. Nhớ luật hiển thị: `progressPercent === null` ⇒ "—",
  **KHÔNG** 0% (SPEC-10 §13.2/§14).
- **API-12 (GOAL API Design)**: bổ sung request/response thật của 6 endpoint mới — thuộc S5-GOAL-DOC-1.
- **Giới hạn đã biết**: `GET /goals/:id/tasks` cắt ở 200 việc/lần (chưa phân trang); bulk link tối đa
  `GOAL_LINK_TASKS_MAX = 100` id/lần.
