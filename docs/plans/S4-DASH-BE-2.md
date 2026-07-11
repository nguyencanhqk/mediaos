# S4-DASH-BE-2 — Widget DATA + cache + degraded (CROWN)

> Lane `L2-widget-data-cache`. Nối tiếp S4-DASH-BE-1 (registry/metadata `data=null`) → cấp DATA thật 7 widget
> in-sprint. NGUỒN chuẩn nghiệp vụ: API-08 §8/§9/§10.1/§11.3, BACKEND-10 §9.7/§17.5, DB-07 §8.3, mig 0482
> header §29-30 (nghĩa vụ mask+scope chuyển từ DDL sang service).

## 1. Kiến trúc (SHIPPED)

- **DashboardWidgetDataController** — controller THỨ BA trên `@Controller('dashboard')` (song song
  DashboardController legacy + DashboardResolverController BE-1). `@UseGuards(PermissionGuard)` mức class, gate
  `read:dashboard` (DASH_READ_PAIR). Route `widgets` + `widgets/:slug` — KHÔNG trùng path+method.
- **DashboardWidgetHandlersService** — registry `slug → {gateAndResolve, fetch}` cho 7 widget. Mỗi handler:
  `PermissionService.can(cặp source-module)` [+ `DataScopeService` cho widget scope-theo-người-xem] TRƯỚC
  aggregate; CHỈ gọi METHOD ĐÃ TỒN TẠI + ĐÃ-SCOPE của module nguồn (KHÔNG raw-query bảng khác, KHÔNG thêm
  method vào module nguồn).
- **DashboardWidgetCacheService** — đọc-tươi + upsert INSERT/UPDATE (uq company_id,cache_key active,
  **KHÔNG DELETE** — BẤT BIẾN #2), compose cache_key, min-refresh, resolve widget_id catalog.
- **DashboardWidgetDataService** (runner) — orchestrate gate→cache→fetch; Promise.allSettled cho catalog;
  degraded per-widget; **KHÔNG nuốt ForbiddenException/HttpException** (403/404/400 propagate — fail-closed).

## 2. 7 widget → method module nguồn (đã-scope)

| slug | widget | gate pair | method nguồn (đã-scope) |
| --- | --- | --- | --- |
| my-tasks | MY_TASKS | read:task | `TaskCoreService.getMyTasks(user)` (self-lock) |
| task-alerts | TASK_ALERTS | read:task | `TaskCoreService.getMyTasks` → filter due-soon/overdue TRONG handler |
| project-progress | PROJECT_PROGRESS | read:project | `ProjectsService.getProject(user,pid)` authorize TRƯỚC → `TasksService.listByProject(company,pid)` aggregate |
| notifications | NOTIFICATIONS | read:notification | `MyNotificationsService.list` (recipient self-lock) |
| attendance-today | ATTENDANCE_TODAY | view-own:attendance | `AttendanceReadService.listMyRecords` + mốc 'hôm nay' `tz.util.localDateOf` theo `companies.timezone` |
| pending-leave | PENDING_LEAVE | view:leave | `LeaveApprovalService.listPending` (assertOwnerInScope) |
| hr-overview | HR_OVERVIEW | read:employee | `HrReadService.listHrEmployees` → count headcount/status/org-unit (viewer-independent, KHÔNG lương/PII) |

## 3. Cache-key + share policy (chống rò chéo người xem)

- per-user (`shareScope='user'`): key kèm `u:{userId}` → 2 user ⇒ key KHÁC ⇒ KHÔNG dùng chung. Áp cho
  MY_TASKS/TASK_ALERTS/NOTIFICATIONS/ATTENDANCE_TODAY/PENDING_LEAVE/PROJECT_PROGRESS.
- company-shared (`shareScope='company'`): CHỈ HR_OVERVIEW khi resolved scope=Company/System (viewer-independent,
  KHÔNG field mask-theo-người-xem). scope < Company ⇒ per-user (aggregate scoped-theo-viewer).
- TTL nhóm §9.2: ATT 30s · TASK 60s · LEAVE 120s · NOTI 10s · HR 900s. refresh min-interval 10s/user/widget.
- Cache CHỈ chứa data ĐÃ MASK + TRONG-SCOPE (ép ở service — DDL không chặn). Đọc cache re-verify quyền người
  đọc (gateAndResolve luôn chạy TRƯỚC serve).

## 4. Machine-readable (RECONCILE-REFRESH)

```yaml
lane: L2-widget-data-cache
wo: S4-DASH-BE-2
status: shipped
controller: apps/api/src/dashboard/dashboard-widget-data.controller.ts   # widgets · widgets/:slug (3rd on @Controller dashboard)
services:
  - apps/api/src/dashboard/dashboard-widget-data.service.ts       # runner (gate→cache→fetch, degraded, catalog)
  - apps/api/src/dashboard/dashboard-widget-handlers.service.ts   # 7 handler registry
  - apps/api/src/dashboard/dashboard-widget-cache.service.ts      # cache read/upsert (INSERT/UPDATE no-DELETE)
errors_appended:                                                  # dashboard-resolver.errors.ts (APPEND)
  - DASH-ERR-SOURCE_MODULE_UNAVAILABLE
  - DASH-ERR-NO_EMPLOYEE_LINK
  - DASH-ERR-VALIDATION
  - DASH-ERR-WIDGET_NOT_FOUND
di_exports_additive:
  - module: apps/api/src/notifications/notifications.module.ts
    added: [MyNotificationsService]
  - module: apps/api/src/leave/leave.module.ts
    added: [LeaveApprovalService]
  - module: apps/api/src/tasks/tasks.module.ts
    added: [TaskCoreService, ProjectsService]   # ProjectsService = GAP vòng reconcile (PROJECT_PROGRESS authorize)
already_exported_untouched:
  - AttendanceReadService   # attendance.module.ts
  - HrReadService           # employees.module.ts
contracts: packages/contracts/src/dashboard-widget-data.ts        # widgetDataQuerySchema (+ project_id? uuid) — L1 06f229a
test: apps/api/test/integration/dashboard-widget-data.int-spec.ts # 13/13 xanh mediaos_dashbe2
invariants:
  tenant: withTenant(companyId) mọi query cache/source (RLS+FORCE)
  append_only: dashboard_widget_cache app GRANT SELECT/INSERT/UPDATE, KHÔNG DELETE
  fail_closed: ForbiddenException/HttpException KHÔNG nuốt thành Degraded (403/404/400 propagate)
unblocks: [S4-DASH-CATALOG-2, S4-INT-2, S4-FE-DASH-1, S4-QA-1]
```

## 5. Còn nợ lane khác

- **S4-INT-2** — cache invalidation từ event TASK/NOTI/ATT/LEAVE (UPDATE deleted_at, KHÔNG DELETE).
- **S4-FE-DASH-1** — render widget data + degraded/empty state.
- **S4-QA-1** — QA end-to-end 7 widget.
