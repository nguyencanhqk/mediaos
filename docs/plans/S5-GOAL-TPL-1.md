# S5-GOAL-TPL-1 — Đợt D: Phân rã mục tiêu từ template

> WO `S5-GOAL-TPL-1` · module GOAL · layer FULL · zone 🟡 yellow (LIGHT gate) · depends_on `S5-GOAL-DB-2`, `S5-GOAL-FE-2`
> Nguồn: SPEC-10 §9 (GOAL-SCREEN-004/006) · §10 (GOAL-FUNC-007/008) · §11 (`manage:task-template`) · §12 (GOAL-ERR-005/008/009) · §15 (GOAL-API-011/012) · DB-11 §6.3/§6.4 · GOAL-DEC-004 (KHÔNG AI)

---

## 1. Phạm vi

| Mã | Việc | Nơi |
| --- | --- | --- |
| GOAL-API-012 | CRUD `task_templates` + `task_template_items` (quyền `manage:task-template`) | `apps/api/src/goals/task-templates.*` |
| GOAL-API-011 | `POST /goals/:id/decompose` — tạo bulk task TRONG 1 transaction | `apps/api/src/goals/goal-decompose.service.ts` |
| GOAL-SCREEN-006 | Danh mục task template (CRUD + items) | `apps/app/src/routes/goals/TaskTemplateListPage.tsx` |
| GOAL-SCREEN-004 | Wizard phân rã: chọn template → preview sửa/xoá/thêm/gán người/cột board/hạn → áp dụng | `apps/app/src/routes/goals/components/GoalDecomposeWizard.tsx` |

**KHÔNG làm ở WO này:** migration (bảng + quyền + audit object_type đã có ở `0526`/`0527`/`0528` — WO này chỉ tiêu thụ) · AI sinh việc (GOAL-DEC-004 owner từ chối) · sửa `estimate_hours` vào task (xem §6 nợ).

---

## 2. Hạ tầng đã có (tiêu thụ, KHÔNG dựng lại)

| Có sẵn | Ở đâu | Dùng cho |
| --- | --- | --- |
| 2 bảng + RLS/FORCE + grant (SELECT/INSERT/UPDATE, KHÔNG DELETE) | mig `0526`, parity `schema/task-templates.ts` | repository template |
| Cặp quyền `('manage','task-template')` `is_sensitive=false` + grant manager@Department · company-admin@Company | mig `0527` | gate controller + data-scope service |
| `audit_logs.object_type` nhận `'task_template'` | mig `0528` | audit CRUD template |
| `tasks.goal_id` (FK đơn cột → goals) + index partial | mig `0505` | task sinh ra mang `goal_id` |
| Toàn bộ gate TASK create (scope · project role D-24 · assignee · cột board · cây con) | `TaskCoreService.createTask` | phân rã ĐI QUA gate này |
| `TaskChecklistsRepository.insertChecklistTx/insertItemTx` | `tasks/task-checklists.repository.ts` | checklist JSONB → `task_checklists` |
| Lớp phạm vi/gate GOAL (403-in-tenant · 404-chéo-tenant · `assertNotFinalized`) | `GoalAccessService` | gate mục tiêu bị phân rã |
| `GoalProgressEngineService.recomputeGoalTx/recomputeProjectGoalsTx` | `tasks/goal-progress-engine.service.ts` | recompute sau khi tạo bulk |

---

## 3. Quyết định của lane (ghi lại để review không hiểu nhầm là thiếu sót)

**D1 — Cặp quyền của `decompose` = `('update','goal')` + `('create','task')`.**
SPEC-10 §11 KHÔNG định nghĩa cặp riêng cho phân rã và mig `0506` chỉ seed 7 cặp `goal`. Bịa cặp mới ở code = cặp không có trong bảng `permissions` ⇒ 403 cho MỌI người (bài học đã ghi ở `GoalTasksLinkService`). Phân rã ĐỔI TẬP ĐO của mục tiêu (giống gắn task) ⇒ thuộc `update:goal`; đồng thời nó TẠO TASK ⇒ phải qua **đúng gate TASK hiện hành** (`create:task`, + `update-state:task` khi có `stateId`) — KHÔNG bypass. Hai cổng, cố ý.

**D2 — Reuse gate TASK bằng cách TÁCH `createTask` thành pre-flight + thân-tx, KHÔNG copy luật.**
`TaskCoreService.createTask` hiện tự mở `db.withTenant` ⇒ gọi nó 50 lần = 50 transaction, **vỡ yêu cầu "fail giữa chừng rollback HẾT"**. Tách:

- `resolveCreateGate(user, dtoLike)` (public) — resolve `create:task` scope + gate `stateId` (`update-state:task` + `projectId` bắt buộc + cấm với `parentTaskId`);
- `createTaskInTx(tx, user, dto, ctx)` (public) — NGUYÊN VĂN thân tx hiện tại, thêm `ctx.goalId` (ghi `tasks.goal_id` ngay lúc INSERT) + `ctx.deferGoalRecompute`;
- `createTask` = `resolveCreateGate` → `allocateTaskCodeOutsideTx` → `withTenant(createTaskInTx)` → `reload`. Hành vi POST /tasks KHÔNG đổi.

Bản sao thứ hai của luật tạo task là bản sao sẽ trôi (assignee scope · project role · cột board · cây con · activity/audit) — vì thế KHÔNG viết insert task riêng trong `goals/`.

**D3 — Mã task cấp TRƯỚC business tx, N mã cho N item.**
`allocateTaskCodeOutsideTx` mở `withTenant` RIÊNG (`FOR UPDATE` counter) — gọi trong tx đang mở sẽ giữ 2 connection + lock counter suốt tx dài (`S5-SEQ-HARDEN-1`). Vì `dto.items` đã là danh sách CUỐI (đã sửa ở preview) nên **N biết trước khi mở tx** ⇒ cấp N mã tuần tự rồi mới mở business tx. Rollback ⇒ mã bị "đốt" (gap OK, đúng thiết kế counter).

**D4 — Neo (anchor) SUY TỪ MỤC TIÊU, không nhận từ client.**
Để task sinh ra tự thoả GOAL-ERR-008 tại thời điểm tạo:

| Cấp mục tiêu | `projectId` | `departmentId` | `assigneeEmployeeId` | `stateId` |
| --- | --- | --- | --- | --- |
| `project` | = `goal.project_id` (ÉP) | null | tuỳ item (gate TASK kiểm member dự án) | cho phép (phải thuộc dự án đó) |
| `department` | null | = `goal.department_id` (ÉP) | tuỳ item | cấm (không có dự án ⇒ 400 STATE_INVALID của TASK) |
| `employee` | null | null | **ÉP = `goal.employee_id`** (item khai khác ⇒ 422 GOAL-ERR-008) | cấm |

`company` không tới được đây (GOAL-ERR-004 chặn từ create).

**D5 — Mã lỗi.** `finalized_at` ⇒ **GOAL-ERR-005** (§12 ghi rõ ERR-005 bao gồm "phân rã"; dùng lại `assertNotFinalized` — một hàm cho mọi đường ghi). `Cancelled` · danh sách rỗng · > 50 item ⇒ **GOAL-ERR-009** (422). Zod chỉ chặn trần CỨNG `GOAL_DECOMPOSE_HARD_MAX = 200` (chống payload khổng lồ ở biên) — giới hạn nghiệp vụ 50 nằm ở service để trả **422 kèm mã** thay vì 400 zod vô danh (đúng convention "lỏng ở Zod, chặt ở service" của `contracts/goal.ts`).

**D6 — `default_priority` LOWERCASE ≠ `task_priority` TitleCase.** `task_template_items.default_priority` CHECK = `urgent|high|medium|low|none` (DB-06 §8.5 legacy, mig `0526`), còn `tasks.task_priority` CHECK = `Low|Medium|High|Urgent` (mig `0478`). Bắc cầu bằng 1 map DUY NHẤT (`none` → `null`); truyền thẳng = vỡ CHECK ⇒ 500 mờ.

**D7 — Tenant-scope tường minh cho MỌI id client gửi (carry-forward gate `S5-GOAL-DB-2`).**
FK `task_templates.department_id → org_units` và `task_template_items.template_id → task_templates` là FK ĐƠN CỘT, **không ép cùng-tenant ở DB** (RLS che đọc chéo nhưng vẫn cho set id lạ nếu biết UUID). Vì thế: `departmentId` (create/update template) phải resolve dưới `company_id` actor ⇒ không thấy = **404**; `templateId` (item CRUD + decompose) resolve qua repo có `AND company_id` ⇒ 404. Mẫu `reused-method-must-be-actor-scoped`.

**D8 — data_scope của `manage:task-template`.** `Department` ⇒ chỉ thao tác template có `department_id ∈ {phòng mình ∪ phòng mình phụ trách}` **hoặc** template dùng-chung (`department_id IS NULL`) ở chế độ **CHỈ ĐỌC** (không sửa/xoá template toàn công ty khi scope Department — đó là tài sản chung). `Company/System` ⇒ toàn tenant. Ngoài phạm vi mà cùng tenant ⇒ 403 (quy ước minh bạch in-tenant của GOAL).

---

## 4. Thứ tự thực thi (1 lane, tuần tự)

1. `packages/contracts/src/goal.ts` — APPEND schema template + item + decompose (+ `GOAL_DECOMPOSE_MAX/HARD_MAX`).
2. `apps/api/src/tasks/task-core.{service,repository}.ts` — tách `resolveCreateGate`/`createTaskInTx`, `insertTaskCoreTx` nhận `goalId`.
3. `apps/api/src/tasks/tasks.module.ts` — APPEND `exports: [TaskChecklistsRepository]` (chỉ mở visibility DI, KHÔNG instance thứ 2).
4. `apps/api/src/goals/` — `task-templates.repository.ts` · `task-templates.service.ts` · `task-templates.controller.ts` · `goal-decompose.service.ts` · APPEND `goals.dto.ts` / `goals.errors.ts` / `goals.module.ts` / route `POST /goals/:id/decompose` ở `goals.controller.ts`.
5. Int-spec `apps/api/test/integration/goal-tpl1-decompose.int-spec.ts`.
6. `packages/web-core` — APPEND `goal-api.ts` (`taskTemplateApi` + `decompose`) · `query-keys.ts` (`taskTemplateKeys` + invalidation).
7. `apps/app` — `TaskTemplateListPage.tsx` · `components/GoalDecomposeWizard.tsx` · nút trong `GoalDetailPage` · route `/goals/templates` · i18n `vi/goals`.
8. Cập nhật `harness/backlog.mjs` (paths thật: + `packages/web-core/**`, + `apps/app/src/router.tsx`) → `bash harness/check.sh`.

---

## 5. Test (RED trước cho deny-path)

Int-spec `goal-tpl1-decompose.int-spec.ts` (gate `hasDb && LANE_DB`):

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 1 | **Rollback toàn phần**: item thứ 2 vi phạm (assignee ngoài phạm vi / stateId của dự án khác) | 4xx **và** `COUNT(tasks WHERE goal_id = :id) = 0` |
| 2 | Mục tiêu đã chốt kỳ | 422 `GOAL-ERR-005`, 0 task |
| 3 | Mục tiêu `Cancelled` | 422 `GOAL-ERR-009`, 0 task |
| 4 | `items` rỗng | 400 (Zod `min(1)`) hoặc 422 ERR-009 |
| 5 | 51 item | 422 `GOAL-ERR-009`, 0 task |
| 6 | `templateId` của công ty KHÁC | 404 (không 500 vỡ FK) |
| 7 | Template của công ty khác qua **item CRUD** (`POST /task-templates/:id/items`) | 404 |
| 8 | Đường vui: 3 item + checklist | 201 · 3 task mang `goal_id` · `task_checklists` + items · activity `TASK_CREATED` + audit `GoalDecomposed` · `progress_percent` mục tiêu mode `tasks` đổi từ NULL → 0 |
| 9 | Mục tiêu cấp nhân viên + item khai assignee khác | 422 `GOAL-ERR-008` |
| 10 | `manage:task-template` KHÔNG có ⇒ CRUD template | 403 |

FE: `TaskTemplateListPage.spec.tsx` + `GoalDecomposeWizard.spec.tsx` (render/permission-gate/preview edit) — vitest jsdom, mẫu `GoalTaskPickerDialog.spec.tsx`.

---

## 6. Rủi ro & nợ ghi lại

| Rủi ro | Xử lý |
| --- | --- |
| Sửa `task-core.service.ts` (đường TẠO TASK đang LIVE) | Tách THUẦN (di chuyển, không đổi luật); `tasks.service.spec.ts` + `tasks.permissions.spec.ts` + int-spec TASK hiện có là lưới an toàn — phải xanh KHÔNG sửa test |
| 50 lần `recomputeProjectGoalsTx` trong 1 tx | `ctx.deferGoalRecompute` ⇒ recompute MỘT LẦN sau vòng lặp (goal đang phân rã + goal mode `project` của dự án) |
| `estimate_hours` của item không có cột tương ứng ở `tasks` | **Nợ ghi rõ**: template giữ `estimate_hours` cho preview/tổng-hợp; phân rã KHÔNG ghi vào task (không có cột — thêm cột = migration, ngoài phạm vi WO). Seed WO sau nếu owner cần. |
| Wizard cho phép thêm item không có trong template | Cho phép (spec: "sửa/xóa/thêm") — `templateItemId` optional; `templateId` chỉ để provenance + audit |
