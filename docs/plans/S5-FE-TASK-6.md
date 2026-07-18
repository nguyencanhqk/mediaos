# S5-FE-TASK-6 — Task quá hạn (SCREEN-010) + Báo cáo tiến độ dự án (SCREEN-011)

> Zone **yellow**, FE-only. BE đã sẵn (query `overdue` + `GET /projects/:id/report`). LIGHT gate
> (react-reviewer + typescript-reviewer + quality-gate). depends_on: S5-FE-TASK-NAV-1 (đã ship).

## Mục tiêu

Hai màn FE mới, KHÔNG thêm/đổi endpoint BE:

1. **TASK-SCREEN-010 — Task quá hạn** (`/tasks/overdue`): danh sách công việc quá hạn, tái dùng
   bảng/hàng của TaskListPage, ghim filter `overdue=true`, sắp theo `due_at` tăng dần, header hiện
   tổng số quá hạn. Vào từ sidebar TASK.
2. **TASK-SCREEN-011 — Báo cáo tiến độ dự án** (`/tasks/projects/:projectId/report`): mở rộng
   `ProjectProgressCard` thành TRANG — hàng KPI tiles + breakdown theo status + bar theo người phụ
   trách. Vào từ nút "Xem báo cáo" trong ProjectDetailPage. KHÔNG vào sidebar.

## Chốt PATH (theo yêu cầu done_when)

| Màn | Route | screenCode | showInSidebar | Route gate | Content gate |
| --- | --- | --- | --- | --- | --- |
| SCREEN-010 | `/tasks/overdue` | `TASK-SCREEN-010` | true | `TASK.TASK.VIEW` (read:task) | `useCan(read:task)` |
| SCREEN-011 | `/tasks/projects/:projectId/report` | `TASK-SCREEN-011` | false | `TASK.PROJECT.VIEW` (read:project) | `useCanExact(view-report:project)` |

- SCREEN-011 nằm DƯỚI `/tasks/projects/:projectId` (path param) — mirror `task.projects.detail`
  (showInSidebar false, resolve param qua `useParams`). Route tĩnh `/tasks/projects` xếp hạng trên
  param → không nuốt nhau (TanStack). `/tasks/overdue` là route TĨNH 2-segment, xếp hạng TRÊN
  `/tasks/$taskId` (giống `/tasks/my-tasks`) → không bị route detail nuốt.
- **Route gate SCREEN-011 = read:project** (giống route detail) chứ KHÔNG phải cặp sensitive:
  người đến từ ProjectDetailPage đã có read:project. Cổng THẬT của báo cáo nhạy cảm là
  `useCanExact(view-report:project)` TRONG page (fail-closed, mirror `ProjectProgressCard`) + server
  enforce (`GET /projects/:id/report`, view-report:project SENSITIVE, seed 0485). Nút "Xem báo cáo"
  cũng gate `useCanExact(view-report:project)` → user không có quyền KHÔNG thấy nút, deep-link thẳng
  vẫn thấy trang "forbidden".

## Tái dùng & DRY

- Trích 7 cột ĐỌC của TaskListPage (title link · project · assignee · priority · status · due+overdue
  badge · creator) sang hook dùng chung `useTaskReadColumns()` (file mới `task-columns.tsx`).
  TaskListPage giữ cột "actions" riêng (edit/delete gate). OverdueTasksPage dùng nguyên cột đọc.
- SCREEN-010 fetch `listTasks({ overdue:true, limit:200 })`, sort client `due_at` ASC, đưa vào
  `DataTable` (client-paginate `pageSize:20`). Header đếm số dòng đã tải.
- SCREEN-011 dùng lại `taskProjectApi.getReport` + `taskKeys.projects.report` (như card) + KPI tiles
  bằng `StatCard` (packages/ui). Bar người-phụ-trách theo mẫu bar `ProjectProgressWidget`
  (`bg-brand` trên track `bg-muted`) — theme token, đạt light+dark.

## Quyết định hiển thị

- KPI tiles SCREEN-011: **Tổng** = Σ countsByStatus · **Hoàn thành** = `Done` · **Chưa hoàn thành**
  = `Todo + In Progress + In Review` (KHÔNG gồm `Cancelled` — huỷ là đóng khác, hiện riêng ở
  breakdown) · **Quá hạn** = `overdueCount`. Breakdown liệt kê đủ 5 status (gồm Cancelled).
- Bar người phụ trách = `assigneeWorkload` (activeCount — task ACTIVE ∉ Done/Cancelled). BE đã cap
  top-20 (`TASK_PROJECT_REPORT_WORKLOAD_LIMIT`). Rỗng → dòng "chưa có việc đang làm".

## GAP / giới hạn (KHÔNG mở rộng trong WO này)

- **BE list task sắp `created_at desc`, KHÔNG có sort param** (`task-core.repository.ts` listTx).
  FE-only ⇒ sort `due_at` ASC ở client trên tập đã tải (cap 200). Nếu >200 task quá hạn (hiếm ở
  single-company MVP) → header hiện "200+" và danh sách là 200 quá-hạn-mới-nhất đã sort. Muốn chính
  xác tuyệt đối cần BE sort/count → NGOÀI phạm vi (không thêm endpoint).
- `GET /tasks` trả mảng trần (không `total`). "Tổng số quá hạn" = số dòng đã tải (≤200).
- SCREEN-011 chỉ render field `ProjectReportDto` server trả (projectId · countsByStatus ·
  overdueCount · assigneeWorkload). KHÔNG có thêm field nào cần → không ghi gap thiếu field.

## Files

- `apps/app/src/routes/tasks/task-columns.tsx` (mới) — `useTaskReadColumns()`
- `apps/app/src/routes/tasks/TaskListPage.tsx` — dùng cột chung
- `apps/app/src/routes/tasks/OverdueTasksPage.tsx` (+ `.spec.tsx`) — SCREEN-010
- `apps/app/src/routes/tasks/ProjectReportPage.tsx` (+ `.spec.tsx`) — SCREEN-011
- `apps/app/src/routes/tasks/ProjectDetailPage.tsx` — nút "Xem báo cáo" (gated)
- `packages/web-core/src/lib/registry.ts` (+ `registry.spec.ts`) — 2 route mới
- `apps/app/src/layouts/workspace/sidebar-registry.ts` — item "Task quá hạn"
- `apps/app/src/router.tsx` — `overdueTasksRoute` + `tasksProjectReportRoute` + addChildren
- `apps/app/src/i18n/locales/vi/tasks.ts` — key mới

## Test (LIGHT gate + "FE spec")

- OverdueTasksPage.spec: forbidden (thiếu read:task) · loading · error · empty · sort due_at ASC ·
  chỉ fetch với overdue=true.
- ProjectReportPage.spec: forbidden fail-closed (thiếu EXACT view-report:project, `*:*` KHÔNG mở) ·
  KPI tiles đúng số · empty (total 0) · error.
- registry.spec: 2 route mới (path/screenCode/gate/showInSidebar).
- **REBUILD `@mediaos/web-core` dist sau đổi registry** (bài học web-core-stale-dist trang trắng).
