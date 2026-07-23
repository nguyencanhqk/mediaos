# S5-GOAL-BE-1 — BE GoalsModule (CRUD 3 cấp · cây theo kỳ · data-scope service-layer)

> Nguồn sự thật: [SPEC-10 GOAL](<../spec/SPEC-10 GOAL.md>) §10 (FUNC-001/002) · §12 (mã lỗi) · §15
> (GOAL-API-001..006 + 013) · §18 (audit/bảo mật) — và [DB-11](<../DB/DB-11 GOAL Database Design.md>) §6.1/§8.
> Bảng `goals`/`goal_updates`, seed permission + counter `goal` + audit CHECK `'goal'` ĐÃ có từ
> **S5-GOAL-DB-1** (migration 0504–0507). WO này **KHÔNG tạo file DB mới**.

Trạng thái: **ĐÃ HIỆN THỰC** (lane `s5goalbe1`, worktree `../mediaos-s5goalbe1`) — 54 int-spec xanh trên
DB cô lập `mediaos_s5goalbe1`; toàn bộ suite api xanh (219 unit-file/3395 test + 179 int-file/3196 test).

---

## 1. Phạm vi đã làm

| Mã           | Endpoint            | Ghi chú hiện thực                                                                  |
| ------------ | ------------------- | ---------------------------------------------------------------------------------- |
| GOAL-API-001 | `GET /goals`        | filter level/department/project/employee/parent/status + kỳ giao nhau + phân trang |
| GOAL-API-002 | `POST /goals`       | validate §12, `goal_code` qua SequenceService                                      |
| GOAL-API-003 | `GET /goals/:id`    | + breadcrumb cha + `childCount`                                                    |
| GOAL-API-004 | `PATCH /goals/:id`  | merge trạng thái rồi **re-validate TOÀN BỘ**                                       |
| GOAL-API-005 | `DELETE /goals/:id` | **xoá mềm**; còn con ⇒ 422 GOAL-ERR-007                                            |
| GOAL-API-006 | `GET /goals/tree`   | cây ≤3 tầng, dựng in-memory từ list phẳng đã lọc scope                             |
| GOAL-API-013 | `GET /me/goals`     | own-scope **resolve từ token** (SPEC-09 §14.4)                                     |

Ngoài phạm vi (thuộc **S5-GOAL-BE-2**): check-in/finalize/reopen (`goal_updates`), 4 progress_mode +
rollup + job đối soát, link/unlink task↔goal, 2 event NOTI. WO này **không chạm** `goal_updates`.

## 2. File đã tạo/sửa

**Mới**

- `packages/contracts/src/goal.ts` — enum DB-11 §7 · `createGoalSchema`/`updateGoalSchema` ·
  `goalCoreResponseSchema`/`goalDetailResponseSchema`/`goalTreeNodeSchema` (z.lazy) ·
  `listGoalsQuerySchema`/`goalTreeQuerySchema`/`meGoalsQuerySchema`.
- `apps/api/src/goals/`: `goals.module.ts` · `goals.controller.ts` · `me-goals.controller.ts` ·
  `goals.service.ts` · `goals-validation.service.ts` · `goals.repository.ts` · `goals.mapper.ts` ·
  `goals.dto.ts` · `goals.errors.ts`.
- `apps/api/test/integration/goal-be1-scope.int-spec.ts` (30 test) ·
  `goal-be1-validate.int-spec.ts` (24 test).

**Sửa (append-only, hot-file)**

- `packages/contracts/src/index.ts` — thêm 1 khối `export * from "./goal";` ở CUỐI.
- `apps/api/src/app.module.ts` — import + `GoalsModule` trong mảng `imports` (khối additive cuối).
- `apps/api/src/tasks/tasks.module.ts` — **1 dòng**: thêm `ProjectAccessService` vào `exports` (mở
  visibility DI; KHÔNG re-provide, KHÔNG đổi logic project-role).

KHÔNG đụng: `apps/api/migrations/**`, `src/db/schema/**`, seed permission, audit `object_types`.

## 3. Mô hình phân quyền đã hiện thực

Hai lớp (mirror TASK đợt C, **mã lỗi khác**):

1. **Cặp + data_scope** — `PermissionGuard` per-route với đúng cặp seed 0506
   (`view/create/update/delete` × `goal`), rồi `DataScopeService.resolveAndAssert` ở service
   (defense-in-depth).
2. **Vai trò dự án** — `ProjectAccessService.getMembershipTx` (tái dùng, KHÔNG re-implement): Owner/
   Manager Active của dự án ghi được goal cấp dự án **kể cả khác phòng ban** (SPEC-10 §11 ghi chú).
   Không đủ vai ⇒ **rơi xuống** luật scope thường (trưởng đơn vị vẫn quản goal dự án THUỘC PHÒNG MÌNH).

Vị từ ĐỌC (`buildReadScopeExists`, scope < Company) = OR của 4 nhánh: người phụ trách trong scope ·
chủ thể (goal cá nhân) trong scope · `department_id ∈ phòng actor` · actor là member Active của dự án.

Luật GHI khi scope < Company: `Own` ⇒ CHỈ goal cấp employee của chính actor · `Department` ⇒ neo nằm
trong phòng actor HOẶC actor là người phụ trách.

**Gắn cha** = liên kết dữ liệu ⇒ `parent_goal_id` phải nằm trong phạm vi **('view','goal')** của actor
(không phải phạm vi ghi): nhân viên treo mục tiêu cá nhân dưới mục tiêu PHÒNG MÌNH được, treo sang
phòng khác ⇒ 403.

## 4. Quyết định chốt trong WO này

| #   | Quyết định                                                                                                       | Lý do                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **403 khi ngoài phạm vi trong CÙNG tenant · 404 khi chéo tenant** (kể cả actor scope Company)                    | SPEC-10 §20.2 + done_when; NGƯỢC pattern fail-closed-404 của TASK — ghi to trong docblock service/spec để không bị "sửa cho giống TASK"                               |
| D2  | "con active" của **GOAL-ERR-007** = goal con **chưa xoá mềm**, KỂ CẢ status `Cancelled`                          | SPEC-10 §12 không định nghĩa; chọn theo CẤU TRÚC (mirror `activeChildExists` của TASK D-32): huỷ ≠ biến mất khỏi cây, xoá cha sẽ để lại con mồ côi                    |
| D3  | Luật CÓ MÃ LỖI để **lỏng ở Zod, chặt ở service** (`periodStart/End`, `weight`, `level='company'`, `targetValue`) | để trả **422 + mã GOAL-ERR-XXX** thay vì 400 zod vô danh; ràng buộc hình thức (uuid/enum/độ dài) vẫn 400 tại biên                                                     |
| D4  | `goal_code` cấp **trước** tx nghiệp vụ, **KHÔNG ensure-on-miss**                                                 | chỉ thị WO: counter đã seed 0506 cho MỌI company ⇒ thiếu là lỗi seed thật, phải nổ (khác pattern task_code). Validate lỗi ⇒ "đốt" 1 số (gap OK, cùng khuôn task_code) |
| D5  | PATCH **merge rồi re-validate toàn bộ** (không patch từng field)                                                 | chống "đổi 1 cột làm vỡ bất biến mà CHECK Postgres vẫn cho qua" (vd đổi `level` giữ neo cũ ⇒ 422 GOAL-ERR-001)                                                        |
| D6  | `deptOrgUnitIds` chỉ có giá trị khi scope = `Department`                                                         | scope `Own`/`Team` mà mang theo phòng ⇒ đọc/ghi được MỌI mục tiêu cấp phòng của phòng mình = nới quyền câm (đã dựng test regression, ĐÃ CHỨNG MINH ĐỎ trước khi vá)   |

## 5. Bẫy đã xử lý

- **FK đơn cột KHÔNG ép cùng-tenant** (finding MEDIUM gate DB-1): mọi id client gửi
  (`department_id`/`project_id`/`employee_id`/`owner_employee_id`/`parent_goal_id`) resolve **dưới
  `company_id`** trước khi ghi ⇒ chéo tenant = **404 sạch**, không vỡ FK thành 500.
- **Thứ tự route Nest**: `GET /goals/tree` khai **trước** `GET /goals/:id`.
- **`employee_profiles.status` là chữ THƯỜNG** (`active`) — không nhầm với `goals.status` TitleCase.
- **/me/goals anti-IDOR**: `meGoalsQuerySchema` **không khai** `employeeId` (zod strip) + service resolve
  employee từ token; actor chưa link hồ sơ ⇒ mảng rỗng (không lỗi).
- **`progress_percent` NULL giữ nguyên NULL** ở mọi projection (SPEC-10 §13.2 — "chưa đo" ≠ 0%).
- **Chu trình cây**: luật chiều cấp chặn phần lớn ca; guard đi-ngược-cây (trần 16 bước) chặn vòng dựng
  từ dữ liệu lệch — int-spec dựng đúng ca đó bằng direct pool rồi PATCH qua API.

## 6. Kiểm chứng đã chạy

```bash
bash scripts/lane-db-setup.sh s5goalbe1
export LANE_DB=mediaos_s5goalbe1
pnpm --filter @mediaos/contracts build            # dual ESM/CJS (chống stale-dist false-red)
pnpm --filter @mediaos/api typecheck              # sạch
pnpm --filter @mediaos/api lint                   # 0 error (43 warning tiền tồn ở file khác)
npx vitest run test/integration/goal-be1-*.int-spec.ts   # 54 passed
npx vitest run src                                # 219 file / 3395 test passed
npx vitest run test/integration                   # 179 file / 3196 test passed (1 skip tiền tồn)
```

RED trước GREEN (bằng chứng): chạy 2 int-spec khi CHƯA có module ⇒ 18/19 fail với
`Cannot POST /goals` (route chưa tồn tại). Riêng regression D6: revert đúng 4 dòng ⇒ test
"view@Own KHÔNG thấy mục tiêu cấp phòng" ĐỎ, khôi phục ⇒ xanh.

## 7. Còn nợ / bàn giao

- **S5-GOAL-BE-2**: check-in/finalize/reopen + 4 progress_mode + bubble + job đối soát + link task↔goal
  - 2 event NOTI. `progress_percent`/`current_value`/`finalized_at` hiện **chỉ đọc** (không có writer ở
    WO này) ⇒ luôn NULL cho goal mới tạo — đúng thiết kế "chưa đo".
- **FE (S5-GOAL-FE-1)**: DTO đã sẵn ở `@mediaos/contracts` (`goalCoreResponseSchema`,
  `goalTreeNodeSchema`, `goalDetailResponseSchema`). Danh sách trả **mảng trần** (envelope do
  interceptor bọc) — KHÔNG có `{data,meta}` phân trang (mirror `GET /projects`).
- **Giới hạn đã biết**: `GET /goals/tree` cắt ở 500 nút/lần (SPEC-10 §19 ước ~200 nút/phòng/kỳ). Vượt
  ngưỡng cần phân trang theo phòng — mở WO riêng nếu dữ liệu thật chạm trần.
- **Company mới tạo sau 0506** chưa có counter `goal` ⇒ `POST /goals` fail-loud (SequenceNotFoundError).
  Đây là hành vi CHỦ Ý; nếu onboarding company mới trở thành luồng thật ⇒ WO seed counter theo module
  lúc provisioning (KHÔNG vá bằng ensure-on-miss trong GoalsService).
- **API-12 (GOAL API Design)**: cập nhật request/response thật của 7 endpoint theo file này — thuộc
  S5-GOAL-DOC-1.
