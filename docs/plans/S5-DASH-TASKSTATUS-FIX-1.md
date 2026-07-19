# Plan — S5-DASH-TASKSTATUS-FIX-1: MV dashboard đếm SAI cột trạng thái

> WO backlog: `S5-DASH-TASKSTATUS-FIX-1` (zone đỏ, layer BE). ADR: **DECISIONS-03 D-30** (đã viết, owner chốt khi merge).
> Bug CÓ SẴN từ G14: `mv_dashboard_task_status` (mig 0102) `GROUP BY status` legacy — luồng task core (0478+)
> chỉ ghi `task_status` TitleCase ⇒ mọi task văn phòng hiện `not_started` vĩnh viễn trên `GET /dashboard/mv-stats`.

## 1. Hiện trạng đã kiểm chứng (số liệu thật 20/07/2026 — done_when #1)

| DB | Bằng chứng |
| --- | --- |
| `mediaos_dev` | 22 task office hiện đại (Todo 11 · In Progress 6 · In Review 2 · Done 2 · Cancelled 1) — **100% mang `status='not_started'`**; MV chưa từng populate (0102 WITH NO DATA). |
| `mediaos` (prod) | 114 task toàn họ legacy (`task_status` NULL 100%): hr 6 · meeting_action 4 · office-cũ 56 · workflow_step 48 (approved 17 · not_started 29 · revision 2). MV "đúng tình cờ". |

- Writer hai họ: task core → `task_status` (không đụng `status` ⇒ DEFAULT not_started); HR `closeTaskTx` → `status` approved/completed; workflow studio → `status` legacy. CHECK `tasks_status_check`: not_started/in_progress/waiting_review/revision/approved/completed.
- Consumer MV: `MvDashboardService.getTaskStatusStats` → `GET /dashboard/mv-stats` (gate read:dashboard). **0 consumer FE** (chỉ web-core `getMvStats`, chưa page nào gọi). `taskStatusStatSchema.status = z.string()` ⇒ đổi tập giá trị không vỡ contract.
- Refresh: `DashboardRefreshService` — probe populated (`SELECT 1 … LIMIT 1` bắt lỗi "has not been populated") → lần đầu refresh THƯỜNG, sau đó CONCURRENTLY (cần UNIQUE INDEX).
- Int-spec hiện có: `mv-dashboard-tenant-isolation` (assert TỔNG per-tenant — sống qua đổi định nghĩa) + `dash-xmodule-2tenant` (marker project_id ở `mv_dashboard_output` — không đụng).

## 2. Quyết định (D-30 — tóm tắt)

MV đếm **trạng thái CANONICAL**: `COALESCE(task_status, map(status))` với map
`not_started→Todo · in_progress→In Progress · waiting_review→In Review · revision→In Progress · approved→Done · completed→Done`,
giá trị lạ → giữ raw (fail-visible). `mv_dashboard_output` (media-era, parked) GIỮ NGUYÊN — thuộc WO dọn de-media-fy.

## 3. Các bước (RED trước — done_when #4)

1. **RED int-spec** `apps/api/src/dashboard/mv-taskstatus-canonical.int.spec.ts` (colocated, gate `hasDb && LANE_DB`, khuôn task-detail):
   - C1 (đường sống HTTP): login → `POST /tasks` (create:task) → `POST /tasks/:id/change-status` Done → REFRESH MV (direct pool, owner) → `GET /dashboard/mv-stats` (read:dashboard) ⇒ taskStatus có `{Done, 1}` và **KHÔNG** có not_started cho task đó. HIỆN TẠI RED (đếm not_started).
   - C2 regression HR: insert task `task_type='hr'`, `status='approved'`, `task_status=NULL` ⇒ đếm vào `Done`.
   - C3 regression workflow: `status='revision'` ⇒ `In Progress`; `status='not_started'` + `task_status` NULL ⇒ `Todo`.
   - C4 cô lập tenant: task tenant B không lọt vào taskStatus của A (mirror spec isolation, qua đường HTTP).
   - C5 giá trị legacy lạ ngoài map (nếu chèn được — CHECK chặn ⇒ bỏ qua nếu không chèn nổi; fail-visible đã cover bằng ELSE giữ raw).
2. **Migration `0502_s5_dashfix1_mv_task_status_canonical.sql`** (journal idx 182, `when` +5000 theo nếp):
   - `DROP MATERIALIZED VIEW IF EXISTS mv_dashboard_task_status;`
   - `CREATE MATERIALIZED VIEW mv_dashboard_task_status AS SELECT company_id, COALESCE(task_status, CASE status … END) AS status, COUNT(*)::bigint AS task_count FROM tasks WHERE deleted_at IS NULL GROUP BY company_id, 2 WITH DATA;` (WITH DATA = populate ngay trong migration — done_when #3 "refresh lại sau migrate"; REFRESH thường trong tx hợp lệ, không cần CONCURRENTLY ở đây)
   - Tạo lại `UNIQUE INDEX (company_id, status)` (REFRESH CONCURRENTLY cần) + index `company_id`.
   - **GRANT lại theo trạng thái CUỐI 0102+0103** (DROP làm mất grant): `GRANT SELECT … TO mediaos_app; GRANT SELECT … TO mediaos_worker;` — KHÔNG grant ALL (0103 đã siết).
   - KHÔNG đụng `mv_dashboard_output`.
3. GREEN: chạy lại int-spec lane DB. Cập nhật jsdoc `mv-dashboard.service.ts` + `dashboard.controller.ts` (tập giá trị canonical + trỏ D-30). KHÔNG đổi service/DTO/FE.
4. Regression rộng: chạy chunk `src/dashboard` + `test/integration/mv-dashboard-tenant-isolation` + `dash-xmodule-2tenant` + `dashboard-agg-routes-deny` trên lane DB.
5. **FULL gate** (migration + số liệu báo cáo): security-reviewer + reviewer lens DB + lens silent-failure; `bash harness/check.sh --lane-db`; vùng đỏ → owner chốt merge (ADR D-30 trong PR).

## 4. Rủi ro & chốt chặn

- **R1 — DROP làm mất GRANT** ⇒ app 42501 khi đọc MV: bước 2 grant lại tường minh; int-spec C1 đi đường HTTP bằng app-pool nên bắt được nếu thiếu.
- **R2 — REFRESH CONCURRENTLY sau migrate cần UNIQUE INDEX khớp định nghĩa mới**: index (company_id, status) tạo lại ngay trong migration; `DashboardRefreshService` probe populated vẫn đúng (WITH DATA ⇒ đi thẳng CONCURRENTLY).
- **R3 — GROUP BY alias trùng tên cột gốc `status`**: dùng `GROUP BY company_id, 2` (positional) — tránh Postgres resolve nhầm về cột input.
- **R4 — thứ tự với S5-TASK-SUBTASK-1 (đếm-lá)**: WO này đi TRƯỚC (đúng src backlog); subtask sau này thêm điều kiện lá lên công thức canonical.
- **R5 — hai spec MV cũ**: isolation assert tổng (sống); xmodule assert marker output MV (không đụng). Nếu đỏ bất ngờ = tín hiệu thật, không nới assertion.
- **R6 — dev-online/prod sau merge**: cần `m dev-online-db` (có migration) — MV populate ngay trong migrate; prod theo quy trình owner.
