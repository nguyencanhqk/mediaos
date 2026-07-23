# S5-GOAL-BE-1 — BE GoalsModule (CRUD 3 cấp · cây theo kỳ · data-scope service-layer)

> Nguồn sự thật: [SPEC-10 GOAL](<../spec/SPEC-10 GOAL.md>) §10 (FUNC-001/002) · §12 (mã lỗi) · §15
> (GOAL-API-001..006 + 013) · §18 (audit/bảo mật) — và [DB-11](<../DB/DB-11 GOAL Database Design.md>) §6.1/§8.
> Bảng `goals`/`goal_updates`, seed permission + counter `goal` + audit CHECK `'goal'` ĐÃ có từ
> **S5-GOAL-DB-1** (migration 0504–0507). WO này **KHÔNG tạo file DB mới**.

Trạng thái: **ĐÃ HIỆN THỰC + ĐÃ QUA FULL GATE (vòng 2)** (lane `s5goalbe1`, worktree
`../mediaos-s5goalbe1`) — 68 int-spec xanh trên DB cô lập `mediaos_s5goalbe1`; toàn bộ suite api xanh
(219 unit-file/3395 test + 179 int-file/3213 test). Chi tiết gate + bản vá: **mục 8**.

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
trong phòng actor **HOẶC** actor là người phụ trách — vế thứ hai chỉ dùng được khi `allowOwnerFallback`
bật (D7): TẮT ở CREATE, bật ở update/delete trên bản ghi đã lưu, và ở UPDATE thì chỉ bật khi **neo
không đổi** (được sửa mục tiêu mình được giao ở phòng khác, KHÔNG được di dời nó sang phòng thứ ba).

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
| D7  | Vế "actor là người phụ trách" của luật GHI phải qua cờ `allowOwnerFallback` (TẮT khi CREATE)                     | `ownerEmployeeId` do client khai, vắng thì suy về CHÍNH actor ⇒ để nguyên là vế owner TỰ THOẢ, biến `create:goal@Department` thành `@Company` (finding HIGH-1, mục 8) |

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
npx vitest run test/integration/goal-be1-*.int-spec.ts   # 68 passed (54 + 14 ca gate vòng 2)
npx vitest run src                                # 219 file / 3395 test passed
npx vitest run test/integration                   # 179 file / 3213 test passed (1 skip tiền tồn)
```

RED trước GREEN (bằng chứng): chạy 2 int-spec khi CHƯA có module ⇒ 18/19 fail với
`Cannot POST /goals` (route chưa tồn tại). Riêng regression D6: revert đúng 4 dòng ⇒ test
"view@Own KHÔNG thấy mục tiêu cấp phòng" ĐỎ, khôi phục ⇒ xanh.

> ⚠️ Bẫy hạ tầng: `vitest run src` chạy song song có thể chết giữa chừng với
> `ERR_IPC_CHANNEL_CLOSED` (crash worker, KHÔNG phải test đỏ). Chạy lại với `--no-file-parallelism`
> mới ra kết luận thật.

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

## 8. FULL gate (2026-07-23) — findings và cách xử lý

Chạy trên commit `183e9fa7`: `security-reviewer` (domain permission) **BLOCK** +
`rls-tenant-isolation-tester` **PASS** (0 CRITICAL/HIGH). Cả hai tự dựng probe chạy đường THẬT rồi xoá.

| #                | Finding                                                                                                                                                                                                                                                                                                                                                                                                                              | Xử lý                                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HIGH-1**       | **Leo quyền GHI chéo phòng**: `ownerEmployeeId` vắng ⇒ validator suy về chính actor ⇒ vế `isOwner` TỰ THOẢ ở đường CREATE. Probe (role `manager`, grant `create/update/delete × goal @Department`): tạo goal cấp phòng cho PHÒNG KHÁC **201**, goal cấp dự án của dự án phòng khác **201**, rồi PATCH **200** / DELETE **204** — đều phải là 403. Grant thật trong DB xác nhận role canonical dính lỗ, không phải role bịa của test. | **ĐÃ VÁ** — thêm cờ `allowOwnerFallback` (D7): CREATE tắt · update/delete trên hàng đã lưu bật · UPDATE chỉ bật khi **neo không đổi** (cấm dùng quyền owner để di dời goal sang phòng thứ ba). `goals.service.ts`                                                                                   |
| **HIGH-2**       | Deny-path thiếu đúng vector bị thủng: nhóm S2 chỉ phủ **UPDATE** goal phòng khác (owner là NGƯỜI KHÁC nên vô tình né lỗ), không có ca **CREATE** cross-department/cross-project.                                                                                                                                                                                                                                                     | **ĐÃ VÁ** — thêm nhóm `S2b` (8 ca): 4 deny (tạo goal phòng khác · dự án phòng khác · NV phòng khác · khai owner=mình vẫn 403) + 4 control chống vá quá tay (tạo cho phòng mình · goal cá nhân · sửa goal được giao ở phòng khác · nhưng cấm di dời).                                                |
| MEDIUM-1 (sec)   | `GET /goals/tree` cắt câm ở 500 nút; nút mất-cha bị dựng thành nút GỐC ⇒ cây thiếu trông y hệt cây đủ.                                                                                                                                                                                                                                                                                                                               | **ĐÃ VÁ** — lấy `CAP + 1` để phát hiện tràn, trả **422 `GOAL-ERR-TREE-TOO-LARGE`** kèm hướng dẫn lọc hẹp.                                                                                                                                                                                           |
| MEDIUM-2 (sec)   | GOAL-ERR-005 (đóng băng sau chốt kỳ) chưa ép ở PATCH/DELETE — route đã LIVE, guard rơi giữa BE-1 và BE-2.                                                                                                                                                                                                                                                                                                                            | **ĐÃ VÁ** — `assertNotFinalized` ở cả hai đường ghi + 2 int-spec (`S2c`). BE-2 chỉ việc dùng lại.                                                                                                                                                                                                   |
| MEDIUM-1/2 (rls) | Lưới test cross-tenant thiếu 5 vector: PATCH `department_id`/`project_id`/`employee_id`/`owner_employee_id` và POST `owner_employee_id` ĐƠN LẺ (ca cũ gửi kèm `employeeId` nên nổ ở nhánh resolve TRƯỚC, nhánh owner chưa từng được kiểm thật).                                                                                                                                                                                      | **ĐÃ VÁ** — thêm 3 ca vào `S3` + 1 ca hậu kiểm bằng SQL "0 hàng của A trỏ sang thực thể của B".                                                                                                                                                                                                     |
| MEDIUM-3 (sec)   | `nextCode` chạy trước kiểm phạm vi ⇒ request bị 403 vẫn "đốt" một số `goal_code`.                                                                                                                                                                                                                                                                                                                                                    | **KHÔNG SỬA (chủ ý)** — đây đúng khuôn nhà (`hr-write.service.ts` cũng `nextCode` trước `withTenant`); đưa xuống trong tx sẽ **xin connection lồng trong tx đang mở** (rủi ro cạn pool qua PgBouncer) để đổi lấy thứ không phải lỗ hổng: hệ quả chỉ là gap mã + counter phình. D4 đã chấp nhận gap. |
| LOW-1 (sec)      | Nhánh `project_members` của `buildReadScopeExists` áp cho mọi scope, kể cả `Own` ⇒ member Viewer của dự án phòng khác đọc được goal dự án đó.                                                                                                                                                                                                                                                                                        | **KHÔNG SỬA** — đúng mẫu TASK đang chạy (`task-core.repository.ts`, DECISIONS-04 D-23/D-24); không role canonical nào có `view:goal @Own`. Siết một mình GOAL sẽ lệch chuẩn hai module. Nếu owner muốn siết ⇒ WO riêng sửa CẢ HAI.                                                                  |
| LOW-2 (sec)      | Breadcrumb cha + `childCount` không lọc theo phạm vi đọc.                                                                                                                                                                                                                                                                                                                                                                            | **KHÔNG SỬA** — đúng quy ước "minh bạch in-tenant" của D1; docblock `assertParentVisible` đã ghi rõ để không bị siết nhầm.                                                                                                                                                                          |
| LOW-2 (rls)      | `goals`/`goal_updates` chưa có policy `*_all_tenant_read` cho `mediaos_readonly` (bảng `tasks`/`projects` có).                                                                                                                                                                                                                                                                                                                       | **KHÔNG SỬA** — mặc định là DENY (an toàn), chỉ là khoảng trống tính năng cho surface operator; thuộc DB, không thuộc WO này.                                                                                                                                                                       |
| LOW-3 (sec)      | File probe untracked còn sót trong worktree.                                                                                                                                                                                                                                                                                                                                                                                         | **ĐÃ DỌN** — cả hai reviewer tự xoá; `git status` sạch trước khi commit.                                                                                                                                                                                                                            |
| LOW-4 (sec)      | `mapper` fallback câm (`weight ?? 1`, `createdAt ?? 1970`) trên cột `NOT NULL`.                                                                                                                                                                                                                                                                                                                                                      | **KHÔNG SỬA** — nhánh chết (DB đã NOT NULL); ghi nhận để BE-2 đừng nhân bản mẫu này.                                                                                                                                                                                                                |

**Bằng chứng RED cho HIGH-1** = probe của gate chạy trên chính commit `183e9fa7` (201/200/204 nơi phải
403). 4 ca deny mới ở `S2b` phủ đúng các vector đó và XANH sau vá; 4 ca control chứng minh luồng hợp lệ
không bị vá quá tay. `rls-tenant-isolation-tester` đã đo tận DB: `goals`/`goal_updates` đều
`RLS + FORCE`, app role không bypass, và **FK đơn cột thật sự KHÔNG ép cùng-tenant** (INSERT goal của A
neo vào employee của B thành công ở tầng DB) ⇒ lớp resolve dưới `company_id` ở service là hàng phòng thủ
DUY NHẤT — mọi WO GOAL sau phải đi qua đúng lớp đó.
