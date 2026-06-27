# BACKEND-10: DASHBOARD BACKEND
# TRIỂN KHAI BACKEND MODULE DASHBOARD - DASH

> **📚 Bộ tài liệu BACKEND — Hệ thống Quản lý Doanh nghiệp**
> [BACKEND-01 Kiến trúc/Setup](<BACKEND-01_Backend_Architecture_Project_Setup.md>) · [BACKEND-02 Migration/ORM/Seed](<BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) · [BACKEND-03 Auth/RBAC](<BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) · [BACKEND-04 Foundation](<BACKEND-04_Foundation_Backend.md>) · [BACKEND-05 HR](<BACKEND-05_HR_Backend.md>) · [BACKEND-06 Attendance](<BACKEND-06_Attendance_Backend.md>) · [BACKEND-07 Leave](<BACKEND-07_Leave_Backend.md>) · [BACKEND-08 Task](<BACKEND-08_Task_Backend.md>) · [BACKEND-09 Notification](<BACKEND-09_Notification_Backend.md>) · **BACKEND-10 Dashboard** · [BACKEND-11 File/Audit/Settings/Jobs](<BACKEND-11_File_Audit_Settings_System_Jobs.md>) · [BACKEND-12 API Contract/OpenAPI](<BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md>) · [BACKEND-13 Testing/Security/Perf](<BACKEND-13_Backend_Testing_Security_Performance.md>) · [BACKEND-14 Release Readiness](<BACKEND-14_Backend_Release_Readiness.md>)
>
> **Nguồn & liên quan:** [Đặc tả: SPEC-07 DASH](<../SPEC/SPEC-07 DASH.md>) · [DB: DB-07 NOTI/DASH](<../DB/DB-07 NOTI DASH Database Design.md>) · [API: API-08 DASH](<../API Design/API-08_DASH_API_Design.md>) · [Màn hình: UI-08](<../UI/UI-08_Dashboard_UIUX_Design.md>) · [Frontend: FRONTEND-07](<../FRONTEND/FRONTEND-07_Dashboard_Frontend.md>) · [Chỉ mục: README](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | BACKEND-10 |
| Tên tài liệu | Dashboard Backend |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Module | DASH - Dashboard |
| Giai đoạn | Backend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-10, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-09 |
| Phụ thuộc backend | Foundation, AUTH/RBAC, HR, ATT, LEAVE, TASK, NOTI |

---

## 2. Mục đích tài liệu

BACKEND-10 mô tả cách triển khai backend cho module **DASH - Dashboard**.

Dashboard Backend chịu trách nhiệm:

1. Trả dashboard mặc định cho user hiện tại sau đăng nhập.
2. Trả danh sách dashboard type mà user được quyền xem: Employee, Manager, HR, Admin.
3. Trả danh mục widget khả dụng theo permission và data scope.
4. Tổng hợp dữ liệu widget từ các module nguồn: HR, ATT, LEAVE, TASK, NOTI, AUTH và FOUNDATION.
5. Chuẩn hóa response widget cho frontend.
6. Áp dụng permission, source permission và data scope tại backend.
7. Hỗ trợ lazy load từng widget.
8. Hỗ trợ cache widget/dashboard theo TTL.
9. Invalidate cache khi module nguồn phát sinh event.
10. Quản lý cấu hình dashboard/widget theo global, company, role hoặc user.
11. Ghi audit log khi cấu hình dashboard thay đổi hoặc khi truy cập widget nhạy cảm.
12. Đảm bảo widget lỗi không làm toàn bộ dashboard lỗi.

Dashboard Backend **không xử lý nghiệp vụ gốc**. Các nghiệp vụ như check-in, tạo đơn nghỉ, duyệt nghỉ, cập nhật task, sửa hồ sơ nhân sự phải gọi API module gốc tương ứng.

---

## 3. Vị trí BACKEND-10 trong roadmap backend

```text
BACKEND-01: Backend Architecture & Project Setup
BACKEND-02: Database Migration, ORM & Seed Implementation
BACKEND-03: Auth, Session, RBAC & Permission Guard
BACKEND-04: Foundation Backend
BACKEND-05: HR Backend
BACKEND-06: Attendance Backend
BACKEND-07: Leave Backend
BACKEND-08: Task Backend
BACKEND-09: Notification Backend
BACKEND-10: Dashboard Backend
BACKEND-11: File, Audit, Settings & System Jobs
BACKEND-12: API Integration Contract & OpenAPI/Swagger
BACKEND-13: Backend Testing, Security & Performance
BACKEND-14: Backend Release Readiness
```

BACKEND-10 được triển khai sau NOTI vì Dashboard cần đọc notification unread count, danh sách thông báo mới và có thể nhận event để invalidate cache.

---

## 4. Căn cứ triển khai

BACKEND-10 bám theo các quyết định đã chốt:

1. DASH là module tổng hợp dữ liệu theo vai trò, permission và data scope.
2. DASH chỉ đọc dữ liệu từ module nguồn, format thành widget và điều hướng người dùng sang module gốc khi cần thao tác.
3. API public dùng prefix `/api/v1/dashboard`.
4. API nội bộ dùng prefix `/internal/v1/dashboard`.
5. Tất cả public API yêu cầu access token hợp lệ.
6. Backend resolve `company_id`, `user_id`, `employee_id`, role, permission và data scope từ auth context.
7. Frontend không được tự truyền `company_id` cho nghiệp vụ dashboard thông thường.
8. Mọi query dashboard/config/cache phải filter theo `company_id`.
9. Widget phải kiểm tra cả permission DASH và permission module nguồn nếu widget chứa dữ liệu nhạy cảm.
10. Dashboard response phải hỗ trợ trạng thái per widget: Active, Hidden, Empty, Error, Degraded.
11. Widget lỗi source module không làm toàn bộ dashboard fail.
12. Cache dashboard có TTL và invalidation theo event module nguồn.
13. Cấu hình widget ưu tiên: user-specific > role-specific > company default > global default.
14. Quick action trên dashboard chỉ là metadata điều hướng hoặc chỉ rõ API module gốc cần gọi.
15. Audit log bắt buộc cho thay đổi cấu hình dashboard/widget.

---

## 5. Phạm vi BACKEND-10

### 5.1 Bao gồm trong MVP

| Nhóm | Nội dung |
| --- | --- |
| Dashboard Me | API lấy dashboard mặc định của user hiện tại |
| Dashboard Type | API lấy danh sách dashboard type được phép xem |
| Widget Catalog | API lấy danh mục widget khả dụng theo permission |
| Widget Data | API lấy dữ liệu từng widget riêng lẻ |
| Role Dashboard | Employee, Manager, HR, Admin dashboard |
| Widget Config | CRUD cấu hình dashboard/widget theo company/role/user |
| Widget Layout | Reorder, enable/disable, reset default |
| Cache | Read/write widget cache, refresh, invalidate |
| Internal Event | Nhận event từ module nguồn để invalidate cache |
| Audit | Ghi audit log cấu hình và truy cập widget nhạy cảm |
| Test | Unit, integration, permission/scope, cache, degraded state, performance |

### 5.2 Chưa đi sâu trong MVP nhưng chừa thiết kế

| Nhóm | Giai đoạn | Hướng mở rộng |
| --- | --- | --- |
| Realtime dashboard | Phase sau | WebSocket/SSE khi cache invalidation hoặc source event xảy ra |
| Drag/drop cá nhân nâng cao | Phase sau | `dashboard_user_widget_states` |
| BI/report dashboard | Phase sau | Materialized view hoặc reporting service riêng |
| Export dashboard PDF/Excel | Phase sau | Background job riêng, không xử lý sync trong request |
| Dashboard payroll/recruit/asset/room | Phase 2+ | Bổ sung widget theo module mới |
| AI summary dashboard | Phase 5 | Summary dựa trên dữ liệu đã kiểm quyền |
| Public TV dashboard | Phase sau | Token read-only, không hiển thị dữ liệu nhạy cảm |

---

## 6. Kiến trúc tổng thể Dashboard Backend

### 6.1 Luồng xử lý chính

```text
Frontend
  -> GET /api/v1/dashboard/me
  -> AuthGuard xác thực token
  -> PermissionGuard kiểm DASH.DASHBOARD.VIEW
  -> DashboardController
  -> DashboardService.resolveDashboard()
  -> DashboardPermissionService resolve permission + data scope
  -> DashboardConfigService resolve config theo priority
  -> DashboardWidgetRegistry lấy widget handler
  -> DashboardCacheService kiểm cache còn hiệu lực
  -> Widget handler query module nguồn nếu cache miss/refresh
  -> Format DashboardWidgetDto
  -> Trả DashboardResponseDto
```

### 6.2 Nguyên tắc module boundary

Dashboard Backend được phép gọi dữ liệu module nguồn thông qua:

1. **Service nội bộ** nếu backend là modular monolith.
2. **Repository/query service read-only** nếu đã tách data access rõ ràng.
3. **Internal API client** nếu module được tách service riêng ở phase sau.

Dashboard Backend không được:

1. Cập nhật trực tiếp bảng nghiệp vụ của HR, ATT, LEAVE, TASK, NOTI.
2. Tự quyết định business rule gốc thay module nguồn.
3. Trả dữ liệu nhạy cảm nếu user thiếu permission module nguồn.
4. Tin `company_id`, `employee_id`, `role`, `permission`, `data_scope` do frontend gửi.
5. Để lỗi một widget làm lỗi toàn bộ dashboard.

---

## 7. Cấu trúc thư mục đề xuất

```text
src/modules/dashboard/
  dashboard.module.ts

  controllers/
    dashboard.controller.ts
    dashboard-widget.controller.ts
    dashboard-config.controller.ts
    internal-dashboard.controller.ts

  services/
    dashboard.service.ts
    dashboard-type.service.ts
    dashboard-widget-registry.service.ts
    dashboard-widget-runner.service.ts
    dashboard-permission.service.ts
    dashboard-scope.service.ts
    dashboard-config.service.ts
    dashboard-cache.service.ts
    dashboard-cache-invalidation.service.ts
    dashboard-audit.service.ts

  repositories/
    dashboard-widget.repository.ts
    dashboard-widget-config.repository.ts
    dashboard-widget-cache.repository.ts
    dashboard-cache-invalidation.repository.ts

  widgets/
    base-widget.handler.ts
    attendance-today.widget.ts
    my-tasks.widget.ts
    task-alerts.widget.ts
    leave-balance.widget.ts
    pending-leave.widget.ts
    leave-calendar.widget.ts
    notifications.widget.ts
    hr-overview.widget.ts
    new-employees.widget.ts
    contract-expiring.widget.ts
    attendance-alerts.widget.ts
    project-progress.widget.ts
    user-summary.widget.ts
    employee-summary.widget.ts
    module-status.widget.ts
    config-warnings.widget.ts
    new-users.widget.ts
    system-logs.widget.ts
    system-notifications.widget.ts
    latest-leave.widget.ts
    team-tasks-today.widget.ts
    probation-ending.widget.ts

  dto/
    dashboard-response.dto.ts
    dashboard-type.dto.ts
    dashboard-widget.dto.ts
    widget-layout.dto.ts
    widget-cache.dto.ts
    widget-error-state.dto.ts
    quick-action.dto.ts
    dashboard-config.dto.ts
    dashboard-query.dto.ts
    create-dashboard-config.dto.ts
    update-dashboard-config.dto.ts
    reorder-dashboard-config.dto.ts
    internal-cache-invalidate.dto.ts
    internal-cache-refresh.dto.ts

  constants/
    dashboard-permissions.ts
    dashboard-widget-codes.ts
    dashboard-types.ts
    dashboard-cache-policy.ts
    dashboard-error-codes.ts

  mappers/
    dashboard-widget.mapper.ts
    dashboard-config.mapper.ts
    dashboard-error.mapper.ts

  tests/
    dashboard.service.spec.ts
    dashboard-permission.service.spec.ts
    dashboard-cache.service.spec.ts
    dashboard-widget-runner.service.spec.ts
    dashboard-config.service.spec.ts
```

---

## 8. Database backend sử dụng

BACKEND-10 không tạo lại database design, nhưng triển khai repository/service dựa trên các bảng sau:

| Bảng | Vai trò backend |
| --- | --- |
| `dashboard_widgets` | Danh mục widget hệ thống, slug, permission, source module, cache policy |
| `dashboard_widget_configs` | Cấu hình widget theo global/company/role/user/dashboard type |
| `dashboard_widget_cache` | Cache dữ liệu widget theo cache key/scope/user/role |
| `dashboard_cache_invalidations` | Log invalidate cache theo event module nguồn |
| `dashboard_user_widget_states` | Có thể tạo sẵn hoặc để phase sau cho layout cá nhân |
| `audit_logs` | Ghi audit thay đổi config/cache/widget nhạy cảm |
| `users`, `roles`, `permissions`, `role_permissions` | Resolve permission và data scope |
| `employees`, `departments` | Resolve employee hiện tại, team, department scope |
| `attendance_records`, `attendance_adjustment_requests` | Widget ATT |
| `leave_requests`, `leave_balances` | Widget LEAVE |
| `tasks`, `projects`, `project_members` | Widget TASK |
| `notifications` | Widget NOTI |
| `modules`, `company_settings`, `system_settings` | Widget FOUNDATION/Admin |

### 8.1 Nguyên tắc repository

1. Repository của DASH chỉ thao tác các bảng `dashboard_*`.
2. Dữ liệu module nguồn nên lấy qua query service module nguồn, không join tùy tiện xuyên module nếu đã có service chuẩn.
3. Nếu cần aggregate trực tiếp, query phải read-only, có `company_id` và áp dụng data scope.
4. Không trả raw entity ra controller; luôn map qua DTO.
5. Không cache dữ liệu nhạy cảm nếu không có chiến lược invalidation và TTL phù hợp.

---

## 9. Endpoint public cần triển khai

### 9.1 Dashboard endpoints

| Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/dashboard/me` | Lấy dashboard mặc định của user hiện tại | `DASH.DASHBOARD.VIEW` |
| GET | `/api/v1/dashboard/types` | Lấy danh sách dashboard type được phép xem | `DASH.DASHBOARD.VIEW` |
| GET | `/api/v1/dashboard/widgets` | Lấy widget catalog khả dụng theo quyền | `DASH.DASHBOARD.VIEW` |
| GET | `/api/v1/dashboard/employee` | Lấy Employee Dashboard | `DASH.DASHBOARD.VIEW_EMPLOYEE` |
| GET | `/api/v1/dashboard/manager` | Lấy Manager Dashboard | `DASH.DASHBOARD.VIEW_MANAGER` |
| GET | `/api/v1/dashboard/hr` | Lấy HR Dashboard | `DASH.DASHBOARD.VIEW_HR` |
| GET | `/api/v1/dashboard/admin` | Lấy Admin Dashboard | `DASH.DASHBOARD.VIEW_ADMIN` |
| GET | `/api/v1/dashboard/summary` | Lấy summary dashboard nhẹ cho header/mobile | `DASH.DASHBOARD.VIEW` |

### 9.2 Widget data endpoints

| Method | Endpoint | Widget | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/dashboard/widgets/attendance-today` | Chấm công hôm nay | `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` |
| GET | `/api/v1/dashboard/widgets/my-tasks` | Task của tôi hôm nay | `DASH.WIDGET.VIEW_MY_TASKS` |
| GET | `/api/v1/dashboard/widgets/task-alerts` | Task quá hạn/sắp đến hạn | `DASH.WIDGET.VIEW_TASK_ALERTS` |
| GET | `/api/v1/dashboard/widgets/leave-balance` | Số ngày phép còn lại | `DASH.WIDGET.VIEW_LEAVE_BALANCE` |
| GET | `/api/v1/dashboard/widgets/pending-leave` | Đơn nghỉ chờ duyệt | `DASH.WIDGET.VIEW_PENDING_LEAVE` |
| GET | `/api/v1/dashboard/widgets/leave-calendar` | Lịch nghỉ team/công ty | `DASH.WIDGET.VIEW_LEAVE_CALENDAR` |
| GET | `/api/v1/dashboard/widgets/notifications` | Thông báo mới | `DASH.WIDGET.VIEW_NOTIFICATIONS` |
| GET | `/api/v1/dashboard/widgets/hr-overview` | Tổng quan nhân sự | `DASH.WIDGET.VIEW_HR_OVERVIEW` |
| GET | `/api/v1/dashboard/widgets/new-employees` | Nhân sự mới | `DASH.WIDGET.VIEW_NEW_EMPLOYEES` |
| GET | `/api/v1/dashboard/widgets/contract-expiring` | Hợp đồng sắp hết hạn | `DASH.WIDGET.VIEW_CONTRACT_EXPIRING` |
| GET | `/api/v1/dashboard/widgets/attendance-alerts` | Bất thường chấm công | `DASH.WIDGET.VIEW_ATTENDANCE_ALERTS` |
| GET | `/api/v1/dashboard/widgets/project-progress` | Tiến độ dự án | `DASH.WIDGET.VIEW_PROJECT_PROGRESS` |
| GET | `/api/v1/dashboard/widgets/user-summary` | Tổng số user | `DASH.WIDGET.VIEW_USER_SUMMARY` |
| GET | `/api/v1/dashboard/widgets/employee-summary` | Tổng số nhân viên | `DASH.WIDGET.VIEW_EMPLOYEE_SUMMARY` |
| GET | `/api/v1/dashboard/widgets/module-status` | Module đang dùng | `DASH.WIDGET.VIEW_MODULE_STATUS` |
| GET | `/api/v1/dashboard/widgets/config-warnings` | Cảnh báo cấu hình | `DASH.WIDGET.VIEW_CONFIG_WARNINGS` |
| GET | `/api/v1/dashboard/widgets/new-users` | Tài khoản mới | `DASH.WIDGET.VIEW_NEW_USERS` |
| GET | `/api/v1/dashboard/widgets/system-logs` | Log quan trọng gần đây | `DASH.WIDGET.VIEW_SYSTEM_LOGS` |
| GET | `/api/v1/dashboard/widgets/system-notifications` | Thông báo hệ thống | `DASH.WIDGET.VIEW_SYSTEM_NOTIFICATIONS` |
| GET | `/api/v1/dashboard/widgets/latest-leave` | Đơn nghỉ gần nhất | `DASH.WIDGET.VIEW_LATEST_LEAVE` |
| GET | `/api/v1/dashboard/widgets/team-tasks-today` | Task team hôm nay | `DASH.WIDGET.VIEW_TEAM_TASKS_TODAY` |
| GET | `/api/v1/dashboard/widgets/probation-ending` | Sắp hết thử việc | `DASH.WIDGET.VIEW_PROBATION_ENDING` |

### 9.3 Dashboard config endpoints

| Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/dashboard/configs` | Lấy danh sách cấu hình widget | `DASH.CONFIG.VIEW` |
| POST | `/api/v1/dashboard/configs` | Tạo cấu hình widget | `DASH.CONFIG.UPDATE` |
| GET | `/api/v1/dashboard/configs/{config_id}` | Xem chi tiết cấu hình widget | `DASH.CONFIG.VIEW` |
| PATCH | `/api/v1/dashboard/configs/{config_id}` | Cập nhật cấu hình widget | `DASH.CONFIG.UPDATE` |
| DELETE | `/api/v1/dashboard/configs/{config_id}` | Xóa mềm/vô hiệu hóa cấu hình widget | `DASH.CONFIG.UPDATE` |
| POST | `/api/v1/dashboard/configs/reset-default` | Khôi phục cấu hình mặc định | `DASH.CONFIG.UPDATE` |
| POST | `/api/v1/dashboard/configs/reorder` | Cập nhật thứ tự widget | `DASH.CONFIG.UPDATE` |
| POST | `/api/v1/dashboard/configs/bulk-update` | Cập nhật nhiều cấu hình widget | `DASH.CONFIG.UPDATE` |

---

## 10. Endpoint nội bộ cần triển khai

| Method | Endpoint | Mục đích | Auth |
| --- | --- | --- | --- |
| POST | `/internal/v1/dashboard/cache/invalidate` | Invalidate cache theo event/module/entity | Internal service token |
| POST | `/internal/v1/dashboard/cache/refresh` | Refresh cache widget/dashboard | Internal service token |
| POST | `/internal/v1/dashboard/events/module-updated` | Nhận event module nguồn thay đổi | Internal service token |
| POST | `/internal/v1/dashboard/jobs/warmup-cache` | Job warmup cache dashboard | Internal service token |

### 10.1 Payload invalidate cache

```json
{
  "module_code": "TASK",
  "event_code": "TASK_STATUS_CHANGED",
  "source_entity_type": "Task",
  "source_entity_id": "uuid",
  "cache_scope": "Own",
  "scope_reference_id": "employee-id",
  "cache_key_pattern": "dash:TASK:*",
  "correlation_id": "req_20260620_000001"
}
```

### 10.2 Quy tắc bảo mật internal API

1. Không cho frontend/mobile gọi internal API.
2. Yêu cầu internal service token hoặc mTLS nếu tách service.
3. Ghi log request id/correlation id.
4. Rate limit internal API theo source service.
5. Không trả dữ liệu widget qua internal invalidation endpoint.

---

## 11. DTO chuẩn

### 11.1 DashboardResponseDto

```ts
export interface DashboardResponseDto {
  dashboard_type: 'Employee' | 'Manager' | 'HR' | 'Admin';
  resolved_from: 'user_config' | 'role_priority' | 'query' | 'fallback';
  user: DashboardUserSummaryDto;
  employee?: DashboardEmployeeSummaryDto | null;
  available_dashboard_types: DashboardTypeDto[];
  widgets: DashboardWidgetDto[];
  summary?: DashboardSummaryDto;
}
```

### 11.2 DashboardWidgetDto

```ts
export interface DashboardWidgetDto {
  widget_code: string;
  widget_name: string;
  widget_type: 'Metric' | 'List' | 'Status' | 'Alert' | 'Calendar' | 'Progress' | 'Chart' | 'Custom';
  status: 'Active' | 'Inactive' | 'Hidden' | 'Empty' | 'Error' | 'Degraded';
  permission: string;
  data_scope: 'Own' | 'Team' | 'Department' | 'Project' | 'Company' | 'System';
  source_modules: string[];
  layout: WidgetLayoutDto;
  data: unknown;
  empty_state?: WidgetEmptyStateDto | null;
  error_state?: WidgetErrorStateDto | null;
  actions?: QuickActionDto[];
  last_updated_at?: string | null;
  last_success_at?: string | null;
  cache?: WidgetCacheDto | null;
}
```

### 11.3 QuickActionDto

```ts
export interface QuickActionDto {
  action_code: string;
  label: string;
  target_module: 'ATT' | 'LEAVE' | 'TASK' | 'HR' | 'NOTI' | 'AUTH' | 'FOUNDATION' | 'DASH';
  method: 'NAVIGATE' | 'API_CALL' | 'OPEN_MODAL' | 'OPEN_DRAWER';
  target_url?: string | null;
  api_endpoint?: string | null;
  enabled: boolean;
  disabled_reason?: string | null;
  required_permission?: string | null;
}
```

### 11.4 WidgetErrorStateDto

```ts
export interface WidgetErrorStateDto {
  code: string;
  message: string;
  source_module?: string | null;
  retryable: boolean;
  request_id?: string | null;
}
```

---

## 12. Permission constants

```ts
export const DASH_PERMISSIONS = {
  DASHBOARD_VIEW: 'DASH.DASHBOARD.VIEW',
  DASHBOARD_VIEW_EMPLOYEE: 'DASH.DASHBOARD.VIEW_EMPLOYEE',
  DASHBOARD_VIEW_MANAGER: 'DASH.DASHBOARD.VIEW_MANAGER',
  DASHBOARD_VIEW_HR: 'DASH.DASHBOARD.VIEW_HR',
  DASHBOARD_VIEW_ADMIN: 'DASH.DASHBOARD.VIEW_ADMIN',

  WIDGET_VIEW_ATTENDANCE_TODAY: 'DASH.WIDGET.VIEW_ATTENDANCE_TODAY',
  WIDGET_VIEW_MY_TASKS: 'DASH.WIDGET.VIEW_MY_TASKS',
  WIDGET_VIEW_TASK_ALERTS: 'DASH.WIDGET.VIEW_TASK_ALERTS',
  WIDGET_VIEW_LEAVE_BALANCE: 'DASH.WIDGET.VIEW_LEAVE_BALANCE',
  WIDGET_VIEW_PENDING_LEAVE: 'DASH.WIDGET.VIEW_PENDING_LEAVE',
  WIDGET_VIEW_LEAVE_CALENDAR: 'DASH.WIDGET.VIEW_LEAVE_CALENDAR',
  WIDGET_VIEW_NOTIFICATIONS: 'DASH.WIDGET.VIEW_NOTIFICATIONS',
  WIDGET_VIEW_HR_OVERVIEW: 'DASH.WIDGET.VIEW_HR_OVERVIEW',
  WIDGET_VIEW_NEW_EMPLOYEES: 'DASH.WIDGET.VIEW_NEW_EMPLOYEES',
  WIDGET_VIEW_CONTRACT_EXPIRING: 'DASH.WIDGET.VIEW_CONTRACT_EXPIRING',
  WIDGET_VIEW_ATTENDANCE_ALERTS: 'DASH.WIDGET.VIEW_ATTENDANCE_ALERTS',
  WIDGET_VIEW_PROJECT_PROGRESS: 'DASH.WIDGET.VIEW_PROJECT_PROGRESS',
  WIDGET_VIEW_USER_SUMMARY: 'DASH.WIDGET.VIEW_USER_SUMMARY',
  WIDGET_VIEW_EMPLOYEE_SUMMARY: 'DASH.WIDGET.VIEW_EMPLOYEE_SUMMARY',
  WIDGET_VIEW_MODULE_STATUS: 'DASH.WIDGET.VIEW_MODULE_STATUS',
  WIDGET_VIEW_CONFIG_WARNINGS: 'DASH.WIDGET.VIEW_CONFIG_WARNINGS',
  WIDGET_VIEW_NEW_USERS: 'DASH.WIDGET.VIEW_NEW_USERS',
  WIDGET_VIEW_SYSTEM_LOGS: 'DASH.WIDGET.VIEW_SYSTEM_LOGS',
  WIDGET_VIEW_SYSTEM_NOTIFICATIONS: 'DASH.WIDGET.VIEW_SYSTEM_NOTIFICATIONS',
  WIDGET_VIEW_LATEST_LEAVE: 'DASH.WIDGET.VIEW_LATEST_LEAVE',
  WIDGET_VIEW_TEAM_TASKS_TODAY: 'DASH.WIDGET.VIEW_TEAM_TASKS_TODAY',
  WIDGET_VIEW_PROBATION_ENDING: 'DASH.WIDGET.VIEW_PROBATION_ENDING',

  CONFIG_VIEW: 'DASH.CONFIG.VIEW',
  CONFIG_UPDATE: 'DASH.CONFIG.UPDATE',
  AUDIT_LOG_VIEW: 'DASH.AUDIT_LOG.VIEW',
  CACHE_REFRESH: 'DASH.CACHE.REFRESH',
} as const;
```

---

## 13. Dashboard type resolution

### 13.1 Dashboard type hợp lệ

| Type | Permission | Mục đích |
| --- | --- | --- |
| `Employee` | `DASH.DASHBOARD.VIEW_EMPLOYEE` | Dashboard cá nhân |
| `Manager` | `DASH.DASHBOARD.VIEW_MANAGER` | Dashboard quản lý team |
| `HR` | `DASH.DASHBOARD.VIEW_HR` | Dashboard nhân sự/chấm công/nghỉ phép |
| `Admin` | `DASH.DASHBOARD.VIEW_ADMIN` | Dashboard quản trị công ty/hệ thống |

### 13.2 Thứ tự resolve dashboard mặc định

```text
1. Nếu user có cấu hình dashboard mặc định cá nhân -> dùng cấu hình đó nếu còn hợp lệ.
2. Nếu user có quyền Admin Dashboard -> Admin.
3. Nếu user có quyền HR Dashboard -> HR.
4. Nếu user có quyền Manager Dashboard -> Manager.
5. Nếu user có quyền Employee Dashboard -> Employee.
6. Nếu không có dashboard nào -> trả DASH-ERR-DASHBOARD_NOT_RESOLVED.
```

### 13.3 Pseudo-code

```ts
async resolveDefaultDashboardType(ctx: AuthContext): Promise<DashboardType> {
  const userDefault = await configService.findUserDefaultDashboard(ctx.companyId, ctx.userId);
  if (userDefault && permissionService.can(ctx, permissionForType(userDefault.type))) {
    return userDefault.type;
  }

  const priority: DashboardType[] = ['Admin', 'HR', 'Manager', 'Employee'];
  for (const type of priority) {
    if (permissionService.can(ctx, permissionForType(type))) return type;
  }

  throw new BusinessError('DASH-ERR-DASHBOARD_NOT_RESOLVED');
}
```

---

## 14. Data scope resolution

### 14.1 Scope chuẩn

| Scope | Backend cần resolve |
| --- | --- |
| `Own` | `employee_id` của user hiện tại |
| `Team` | Danh sách employee do user là direct manager hoặc được phân quyền quản lý |
| `Department` | Department user được phân quyền hoặc quản lý |
| `Project` | Project mà user là owner/member hoặc có quyền xem |
| `Company` | Toàn bộ company hiện tại |
| `System` | Liên công ty hoặc system-wide, chỉ Super Admin/service đặc biệt |

### 14.2 Nguyên tắc áp dụng scope

1. Scope phải được áp dụng trước khi aggregate/count.
2. Không aggregate toàn công ty rồi mới filter sau.
3. Với `Team`, backend cần lấy danh sách employee/team từ HR service.
4. Với `Project`, backend cần check project membership từ TASK service.
5. Với `Company`, vẫn phải filter `company_id`.
6. Với `System`, chỉ dùng endpoint/mode riêng nếu đã thiết kế.
7. Nếu scope hợp lệ nhưng không có dữ liệu, trả widget status `Empty`, không trả 403.
8. Nếu user thiếu quyền, trả `Hidden` trong dashboard tổng hoặc 403 khi gọi trực tiếp widget endpoint.

---

## 15. Widget registry

### 15.1 Interface chung

```ts
export interface DashboardWidgetHandler<TData = unknown> {
  code: string;
  slug: string;
  sourceModules: string[];
  requiredPermission: string;
  requiredSourcePermissions?: string[];
  defaultScope: DataScope;
  cachePolicy: WidgetCachePolicy;

  load(context: DashboardWidgetContext): Promise<DashboardWidgetResult<TData>>;
}
```

### 15.2 DashboardWidgetContext

```ts
export interface DashboardWidgetContext {
  auth: AuthContext;
  dashboardType: DashboardType;
  widgetCode: string;
  query: DashboardQueryDto;
  scope: ResolvedDataScope;
  companyTimezone: string;
  requestId: string;
  refresh: boolean;
}
```

### 15.3 DashboardWidgetResult

```ts
export interface DashboardWidgetResult<TData = unknown> {
  status: 'Active' | 'Empty' | 'Degraded';
  data: TData | null;
  actions?: QuickActionDto[];
  emptyState?: WidgetEmptyStateDto | null;
  sourceVersion?: string | null;
  metadata?: Record<string, unknown>;
}
```

### 15.4 Registry rule

1. Mỗi `widget_code` có đúng một handler active.
2. Handler phải khai báo `requiredPermission`.
3. Handler phải khai báo `sourceModules`.
4. Handler không tự bypass permission guard.
5. Handler không throw lỗi ra ngoài nếu lỗi có thể degrade; nên trả `Degraded` qua runner.
6. Widget runner dùng `Promise.allSettled` khi load dashboard nhiều widget.

---

## 16. Widget MVP cần triển khai

### 16.1 Employee widgets

> **`source_modules` chuẩn (một danh sách duy nhất):** cột "Nguồn" dưới đây là danh sách `source_modules` chuẩn của mỗi widget, dùng verbatim trong `DashboardWidgetHandler.sourceModules`, response `DashboardWidgetDto.source_modules` (API-08 §6) và seed. `dashboard_widgets.module_code` (DB-07) chỉ lưu **module nguồn chính** (module đầu tiên trong danh sách); danh sách đầy đủ nằm ở handler/response. SPEC-07 §14 mô tả module nguồn chính cho từng widget — không mâu thuẫn vì đó là primary module.

| Widget | Nguồn (`source_modules`) | Scope | Ghi chú backend |
| --- | --- | --- | --- |
| `ATTENDANCE_TODAY` | ATT, LEAVE, HR | Own | Trả trạng thái hôm nay, nút check-in/out enabled/disabled theo ATT |
| `MY_TASKS` | TASK | Own/Project | Task của tôi hôm nay, sắp đến hạn |
| `TASK_ALERTS` | TASK | Own/Project | Task quá hạn hoặc due soon |
| `LEAVE_BALANCE` | LEAVE | Own | Số ngày phép còn lại |
| `NOTIFICATIONS` | NOTI | Own | Unread count + notification mới nhất |
| `LATEST_LEAVE` | LEAVE | Own | Đơn nghỉ gần nhất của tôi |

### 16.2 Manager widgets

| Widget | Nguồn | Scope | Ghi chú backend |
| --- | --- | --- | --- |
| `PENDING_LEAVE` | LEAVE + HR | Team | Đơn nghỉ team đang chờ duyệt |
| `LEAVE_CALENDAR` | LEAVE + HR | Team/Department | Lịch nghỉ team |
| `TEAM_TASKS_TODAY` | TASK + HR | Team/Project | Task team hôm nay |
| `TASK_ALERTS` | TASK + HR | Team/Project | Task team quá hạn/sắp đến hạn |
| `ATTENDANCE_ALERTS` | ATT + HR | Team | Thiếu check-out, đi muộn, vắng bất thường |
| `PROJECT_PROGRESS` | TASK | Project/Team | Tiến độ dự án manager liên quan |

### 16.3 HR widgets

| Widget | Nguồn | Scope | Ghi chú backend |
| --- | --- | --- | --- |
| `HR_OVERVIEW` | HR | Company/Department | Tổng nhân viên active/probation/resigned |
| `NEW_EMPLOYEES` | HR | Company/Department | Nhân sự mới trong tháng |
| `CONTRACT_EXPIRING` | HR | Company/Department | Hợp đồng sắp hết hạn |
| `PROBATION_ENDING` | HR | Company/Department | Nhân sự sắp hết thử việc |
| `PENDING_LEAVE` | LEAVE + HR | Company/Department | Đơn nghỉ chờ HR xử lý |
| `ATTENDANCE_ALERTS` | ATT + HR | Company/Department | Bất thường chấm công |
| `EMPLOYEE_SUMMARY` | HR | Company | Tổng hợp nhân sự |

### 16.4 Admin widgets

| Widget | Nguồn | Scope | Ghi chú backend |
| --- | --- | --- | --- |
| `USER_SUMMARY` | AUTH | Company/System | Tổng user active/locked/new |
| `MODULE_STATUS` | FOUNDATION | Company/System | Module đang bật/tắt/bảo trì |
| `CONFIG_WARNINGS` | FOUNDATION/AUTH/HR/ATT/LEAVE/NOTI | Company | Cảnh báo thiếu cấu hình |
| `NEW_USERS` | AUTH + HR | Company | Tài khoản mới |
| `SYSTEM_LOGS` | AUDIT | Company/System | Log quan trọng, cần quyền nguồn |
| `SYSTEM_NOTIFICATIONS` | NOTI | Company/System | Thông báo hệ thống |

### 16.5 Per-widget required source permissions (bắt buộc cho widget nhạy cảm)

Ngoài permission `DASH.*`, các widget nhạy cảm phải kiểm thêm permission module nguồn (`requiredSourcePermissions`) trong widget runner trước khi trả dữ liệu. Bảng này đồng bộ với API-08 §6.5; runner check là **bắt buộc**, không để optional/"if needed".

| Widget | `requiredPermission` (DASH) | `requiredSourcePermissions` (module nguồn) |
| --- | --- | --- |
| `HR_OVERVIEW` | `DASH.WIDGET.VIEW_HR_OVERVIEW` | `HR.EMPLOYEE.VIEW` |
| `EMPLOYEE_SUMMARY` | `DASH.WIDGET.VIEW_EMPLOYEE_SUMMARY` | `HR.EMPLOYEE.VIEW` |
| `NEW_EMPLOYEES` | `DASH.WIDGET.VIEW_NEW_EMPLOYEES` | `HR.EMPLOYEE.VIEW` |
| `CONTRACT_EXPIRING` | `DASH.WIDGET.VIEW_CONTRACT_EXPIRING` | `HR.CONTRACT.VIEW` |
| `PROBATION_ENDING` | `DASH.WIDGET.VIEW_PROBATION_ENDING` | `HR.EMPLOYEE.VIEW` |
| `ATTENDANCE_ALERTS` | `DASH.WIDGET.VIEW_ATTENDANCE_ALERTS` | `ATT.ATTENDANCE.VIEW` hoặc `ATT.ATTENDANCE.VIEW_TEAM` |
| `PENDING_LEAVE` | `DASH.WIDGET.VIEW_PENDING_LEAVE` | `LEAVE.REQUEST.VIEW` (+ `LEAVE.REQUEST.APPROVE` nếu hiển thị action duyệt) |
| `PROJECT_PROGRESS` | `DASH.WIDGET.VIEW_PROJECT_PROGRESS` | `TASK.PROJECT.VIEW` |
| `USER_SUMMARY` | `DASH.WIDGET.VIEW_USER_SUMMARY` | `AUTH.USER.VIEW` |
| `NEW_USERS` | `DASH.WIDGET.VIEW_NEW_USERS` | `AUTH.USER.VIEW` |
| `SYSTEM_LOGS` | `DASH.WIDGET.VIEW_SYSTEM_LOGS` | `FOUNDATION.AUDIT_LOG.VIEW` |
| `SYSTEM_NOTIFICATIONS` | `DASH.WIDGET.VIEW_SYSTEM_NOTIFICATIONS` | `NOTI.NOTIFICATION.VIEW_COMPANY` |

Quy tắc runner:

1. Widget handler khai báo `requiredSourcePermissions` (xem §15.1 interface).
2. Nếu user thiếu bất kỳ source permission bắt buộc → trả widget `Hidden` trong dashboard tổng, hoặc `403` khi gọi trực tiếp widget endpoint.
3. Source permission check chạy **trước** khi load/aggregate dữ liệu.

---

## 17. Cache policy

### 17.1 Cache key convention

```text
dash:{company_id}:{dashboard_type}:{widget_code}:{scope}:{scope_reference_id}:{period}:{view}:{hash(query)}
```

Ví dụ:

```text
dash:company-01:Manager:PENDING_LEAVE:Team:employee-123:current_month:full:9f2a11
```

### 17.2 TTL đề xuất

| Nhóm widget | TTL | Invalidation event |
| --- | --- | --- |
| Chấm công hôm nay | 10-30 giây | `attendance.checked_in`, `attendance.checked_out`, `leave.request.approved` |
| Task cá nhân/team | 30-60 giây | `TASK_CREATED`, `TASK_UPDATED`, `TASK_STATUS_CHANGED`, `TASK_ASSIGNED` |
| Nghỉ phép | 30-120 giây | `LEAVE_REQUEST_SUBMITTED`, `leave.request.approved`, `LEAVE_REJECTED`, `LEAVE_BALANCE_ADJUSTED` |

> Các tín hiệu `attendance.checked_in`, `attendance.checked_out`, `leave.request.approved` là **sự kiện domain/cache nội bộ, không phải NOTI notification** (dạng dotted-lowercase khớp BACKEND-12 §23.1 `x-domain-events`). Self check-in/out không có event NOTI người dùng.
| Notification | 0-10 giây | `NOTIFICATION_CREATED`, `NOTIFICATION_READ` |
| HR overview | 5-15 phút | `EMPLOYEE_CREATED`, `EMPLOYEE_UPDATED`, `CONTRACT_UPDATED` |
| Admin/system | 1-10 phút | `USER_CREATED`, `ROLE_UPDATED`, `MODULE_CONFIG_UPDATED` |

### 17.3 Cache service behavior

```text
Request widget
  -> build cache key
  -> nếu refresh=true và có DASH.CACHE.REFRESH: bỏ qua cache
  -> tìm cache Fresh, chưa expires_at
  -> nếu hit: trả cache data + cache.hit=true
  -> nếu miss: gọi widget handler
  -> lưu cache nếu widget cacheable
  -> trả data + cache.hit=false
```

### 17.4 Cache status

| Status | Ý nghĩa |
| --- | --- |
| `Fresh` | Cache còn hạn và dùng được |
| `Stale` | Cache đã hết hạn nhưng có thể dùng fallback nếu source lỗi |
| `Invalidated` | Cache bị invalidate do event |
| `Refreshing` | Cache đang được refresh bởi job |
| `Failed` | Refresh cache lỗi |

### 17.5 Degraded fallback

Nếu source module lỗi:

1. Nếu có cache cũ chưa quá stale threshold, trả widget `Degraded` với data cache cũ.
2. Nếu không có cache, trả widget `Degraded` với `data = null` và `error_state`.
3. Không làm toàn bộ dashboard fail.
4. Ghi log lỗi kèm request id/correlation id.

---

## 18. Cache invalidation mapping

> `attendance.checked_in` / `attendance.checked_out` là **sự kiện domain/cache nội bộ, không phải NOTI notification** (dạng dotted-lowercase khớp BACKEND-12 §23.1 `x-domain-events`). Self check-in/out không có event NOTI người dùng.

| Event nguồn | Widget bị ảnh hưởng | Scope invalidate |
| --- | --- | --- |
| `attendance.checked_in` | `ATTENDANCE_TODAY`, `ATTENDANCE_ALERTS` | Own, Team, Department, Company |
| `attendance.checked_out` | `ATTENDANCE_TODAY`, `ATTENDANCE_ALERTS` | Own, Team, Department, Company |
| `ATT_ADJUSTMENT_SUBMITTED` | `ATTENDANCE_ALERTS` | Team, Department, Company |
| `LEAVE_REQUEST_SUBMITTED` | `PENDING_LEAVE`, `LATEST_LEAVE`, `LEAVE_CALENDAR` | Own, Team, Department, Company |
| `LEAVE_REQUEST_APPROVED` | `LEAVE_BALANCE`, `LEAVE_CALENDAR`, `ATTENDANCE_TODAY` | Own, Team, Department, Company |
| `LEAVE_BALANCE_ADJUSTED` | `LEAVE_BALANCE` | Own |
| `TASK_ASSIGNED` | `MY_TASKS`, `TASK_ALERTS`, `TEAM_TASKS_TODAY`, `PROJECT_PROGRESS` | Own, Team, Project |
| `TASK_STATUS_CHANGED` | `MY_TASKS`, `TASK_ALERTS`, `TEAM_TASKS_TODAY`, `PROJECT_PROGRESS` | Own, Team, Project |
| `TASK_OVERDUE` | `TASK_ALERTS` | Own, Team, Project |
| `NOTIFICATION_CREATED` | `NOTIFICATIONS`, `SYSTEM_NOTIFICATIONS` | Own, Company |
| `NOTIFICATION_READ` | `NOTIFICATIONS` | Own |

> **Producer (X-35):** `NOTIFICATION_CREATED` và `NOTIFICATION_READ` do BACKEND-09 phát (NotificationCreateService phát CREATED sau commit; NotificationActionService phát READ khi mark read / mark all read), hoặc BE-09 gọi trực tiếp `POST /internal/v1/dashboard/cache/invalidate`. Không còn phụ thuộc event thiếu producer.
| `EMPLOYEE_CREATED` | `HR_OVERVIEW`, `NEW_EMPLOYEES`, `EMPLOYEE_SUMMARY` | Department, Company |
| `EMPLOYEE_UPDATED` | `HR_OVERVIEW`, `EMPLOYEE_SUMMARY`, `PROBATION_ENDING` | Department, Company |
| `CONTRACT_UPDATED` | `CONTRACT_EXPIRING` | Department, Company |
| `USER_CREATED` | `USER_SUMMARY`, `NEW_USERS` | Company |
| `MODULE_CONFIG_UPDATED` | `MODULE_STATUS`, `CONFIG_WARNINGS` | Company |

---

## 19. Config resolution

### 19.1 Config priority

```text
1. User-specific config
2. Role-specific config
3. Company default config
4. Global default config
5. Widget catalog default
```

### 19.2 Rule khi user có nhiều role

1. Lấy tất cả role active của user.
2. Lọc config role theo dashboard type.
3. Nếu nhiều config cùng widget, ưu tiên role có priority cao hơn theo role priority seed.
4. User-specific config luôn override role config.
5. Config disabled ở cấp user có thể ẩn widget kể cả role/company đang bật, nếu policy cho phép.

### 19.3 Validate config

Khi tạo/cập nhật config:

1. `widget_id` phải tồn tại và active.
2. `dashboard_type` hợp lệ.
3. Chỉ được cấu hình trong `company_id` hiện tại trừ Super Admin scope System.
4. Không tạo config trùng cùng `company_id + dashboard_type + widget_id + role_id/user_id`.
5. Layout order không âm.
6. Size hợp lệ: small, medium, large, full.
7. Nếu config theo role, role phải thuộc company hoặc global hợp lệ.
8. Nếu config theo user, user phải thuộc company.
9. Ghi audit log diff cũ/mới.

---

## 20. Quick action backend

### 20.1 Nguyên tắc

1. Quick action chỉ là metadata cho frontend.
2. Nếu action gọi API, `api_endpoint` phải là endpoint module gốc.
3. Backend DASH không thực thi nghiệp vụ check-in, approve leave, update task.
4. Action phải có `enabled` và `disabled_reason` để frontend không tự đoán.
5. Action phải kiểm permission nguồn trước khi trả.

### 20.2 Ví dụ action check-out

```json
{
  "action_code": "CHECK_OUT",
  "label": "Check-out",
  "target_module": "ATT",
  "method": "API_CALL",
  "target_url": null,
  "api_endpoint": "/api/v1/attendance/check-out",
  "enabled": true,
  "disabled_reason": null,
  "required_permission": "ATT.ATTENDANCE.CHECK_OUT"
}
```

### 20.3 Ví dụ action duyệt nghỉ

```json
{
  "action_code": "OPEN_PENDING_LEAVE_APPROVAL",
  "label": "Duyệt đơn",
  "target_module": "LEAVE",
  "method": "NAVIGATE",
  "target_url": "/leave/approvals?status=Pending",
  "api_endpoint": null,
  "enabled": true,
  "disabled_reason": null,
  "required_permission": "LEAVE.REQUEST.APPROVE"
}
```

---

## 21. Error handling

### 21.1 Error code đề xuất

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu/sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có quyền dashboard/widget/config |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 409 | `DASH-ERR-CONFIG_CONFLICT` | Config trùng hoặc xung đột layout |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn lỗi |
| 500 | `DASH-ERR-CACHE_UNAVAILABLE` | Cache service lỗi |
| 500 | `DASH-ERR-INTERNAL` | Lỗi nội bộ không xác định |

### 21.2 Quy tắc lỗi dashboard tổng

1. Lỗi auth/permission/dashboard type invalid -> response lỗi toàn request.
2. Lỗi một widget source module -> dashboard vẫn success, widget status `Error` hoặc `Degraded`.
3. Lỗi cache -> backend query source nếu có thể; nếu không thì widget degraded.
4. Lỗi config trùng -> 409.
5. Gọi trực tiếp widget endpoint mà thiếu permission -> 403.
6. Widget code không tồn tại -> 404.

---

## 22. Audit log

### 22.1 Bắt buộc ghi audit

| Hành động | Action code đề xuất |
| --- | --- |
| Tạo dashboard widget config | `DASH_CONFIG_CREATED` |
| Cập nhật dashboard widget config | `DASH_CONFIG_UPDATED` |
| Xóa mềm/vô hiệu hóa config | `DASH_CONFIG_DELETED` |
| Reset config default | `DASH_CONFIG_RESET_DEFAULT` |
| Reorder widget | `DASH_WIDGET_REORDERED` |
| Bulk update config | `DASH_CONFIG_BULK_UPDATED` |
| Refresh cache thủ công | `DASH_CACHE_REFRESHED` |
| Invalidate cache thủ công | `DASH_CACHE_INVALIDATED` |
| Xem widget system logs | `DASH_SENSITIVE_WIDGET_VIEWED` |

### 22.2 Audit payload tối thiểu

```json
{
  "module_code": "DASH",
  "action": "DASH_CONFIG_UPDATED",
  "entity_type": "dashboard_widget_config",
  "entity_id": "config-id",
  "company_id": "company-id",
  "actor_user_id": "user-id",
  "before": {},
  "after": {},
  "metadata": {
    "dashboard_type": "HR",
    "widget_code": "HR_OVERVIEW",
    "request_id": "req_20260620_000001"
  }
}
```

---

## 23. Security checklist

1. Tất cả public API có AuthGuard.
2. Tất cả endpoint config có PermissionGuard.
3. Tất cả widget kiểm permission DASH.
4. Widget nhạy cảm kiểm thêm permission module nguồn.
5. Query luôn filter `company_id` từ auth context.
6. Không tin `company_id`, `user_id`, `employee_id`, `role`, `permission`, `data_scope` do frontend gửi.
7. Direct URL trái quyền trả 403 hoặc 404 theo policy.
8. Không trả dữ liệu nhạy cảm trong widget nếu thiếu source permission.
9. Không log payload chứa dữ liệu nhạy cảm.
10. Cache key không chứa dữ liệu cá nhân nhạy cảm dạng raw.
11. Cache data có TTL phù hợp.
12. System/Admin widget phải có rate limit và audit nếu nhạy cảm.
13. Internal API không public.
14. Refresh cache endpoint cần chống abuse.
15. Error response không lộ SQL/query stack trace.

---

## 24. Performance checklist

1. `/api/v1/dashboard/me` nên load 5-8 widget phổ biến trong thời gian thấp.
2. Widget handler chạy song song bằng `Promise.allSettled` có giới hạn concurrency nếu cần.
3. Query aggregate nặng phải có cache hoặc TTL.
4. Query notification unread count không scan toàn bảng.
5. Query pending leave/team task dùng index theo company/scope/status/date.
6. Không phát sinh N+1 khi widget trả employee/user summary.
7. Không join quá nhiều bảng trong một widget nếu có query service tối ưu.
8. Cache cleanup job chạy định kỳ.
9. Có monitoring slow query > 1s.
10. Có log cache hit/miss/degraded rate.
11. Có rate limit refresh dashboard/widget.
12. Kiểm tra `EXPLAIN ANALYZE` cho widget HR overview, attendance alerts, pending leave, my tasks, notifications.

---

## 25. Jobs liên quan

### 25.1 Dashboard cache cleanup job

```text
Tên job: dashboard_cache_cleanup
Tần suất: mỗi 1 giờ hoặc theo config
Mục đích:
  - Xóa mềm hoặc hard delete cache đã expired quá retention
  - Giữ lại cache lỗi gần nhất nếu cần debug
```

### 25.2 Dashboard cache invalidation processor

```text
Tên job: dashboard_cache_invalidation_processor
Tần suất: mỗi 1-5 phút hoặc event-driven
Mục đích:
  - Đọc dashboard_cache_invalidations status Pending
  - Tìm cache match pattern/scope
  - Đổi status cache thành Invalidated
  - Cập nhật invalidated_count + processed_at
```

### 25.3 Dashboard warmup job

```text
Tên job: dashboard_warmup_cache
Tần suất: theo lịch hoặc sau deploy/seed
Mục đích:
  - Warmup widget phổ biến cho Admin/HR/Manager nếu dữ liệu nặng
  - Không warmup dữ liệu quá cá nhân nếu số user lớn
```

---

## 26. Testing plan

### 26.1 Unit test

| Nhóm | Test case |
| --- | --- |
| Dashboard type | Resolve Employee/Manager/HR/Admin theo permission |
| Permission | User thiếu permission không thấy widget |
| Data scope | Own/Team/Department/Company áp dụng đúng |
| Config | Priority user > role > company > global |
| Cache | Hit/miss/expired/refresh/invalidate |
| Widget runner | Một widget lỗi không làm dashboard lỗi |
| Quick action | Trả enabled/disabled đúng |
| Error mapper | Source error -> Degraded/Error state |

### 26.2 Integration test

| API | Kỳ vọng |
| --- | --- |
| `GET /dashboard/me` | Trả dashboard đúng type và widget allowed |
| `GET /dashboard/employee` | Employee xem được Own widgets |
| `GET /dashboard/manager` | Manager chỉ thấy dữ liệu team |
| `GET /dashboard/hr` | HR thấy Company/Department theo scope |
| `GET /dashboard/admin` | Admin thấy system/company widgets theo quyền |
| `GET /dashboard/widgets/{slug}` | Lazy load widget đúng permission |
| `POST /dashboard/configs` | Tạo config và ghi audit |
| `PATCH /dashboard/configs/{id}` | Update config và invalidate cache liên quan |
| `POST /internal/dashboard/cache/invalidate` | Internal token hợp lệ mới được gọi |

### 26.3 Business workflow test

1. Sau khi check-in ở ATT, widget `ATTENDANCE_TODAY` đổi trạng thái sau cache invalidation.
2. Sau khi task đổi assignee, widget `MY_TASKS` của assignee mới được cập nhật.
3. Sau khi leave request submitted, widget `PENDING_LEAVE` của manager tăng count.
4. Sau khi HR cập nhật contract end date, widget `CONTRACT_EXPIRING` cập nhật sau TTL/invalidation.
5. Sau khi config widget disabled, dashboard không trả widget đó hoặc trả hidden theo query.

### 26.4 Error/fallback test

1. ATT service lỗi -> chỉ widget attendance degraded, dashboard tổng vẫn success.
2. Cache service lỗi -> backend query source nếu có thể hoặc trả degraded.
3. Widget code không tồn tại -> 404.
4. Config trùng -> 409.
5. Dashboard type không hợp lệ -> 422.

### 26.5 Performance test

1. Dashboard `/me` phản hồi ổn định với 5-8 widget phổ biến.
2. Unread notification count không scan toàn bảng notifications.
3. HR overview dùng cache hoặc query aggregate tối ưu.
4. Không phát sinh N+1 query khi widget task/leave trả employee summary.
5. Refresh dashboard liên tục bị rate limit phù hợp.

---

## 27. Seed data backend cần có

### 27.1 Seed dashboard widgets

Mỗi widget seed tối thiểu:

```json
{
  "widget_code": "MY_TASKS",
  "widget_slug": "my-tasks",
  "widget_name": "Task của tôi hôm nay",
  "widget_type": "List",
  "module_code": "DASH",
  "source_modules": ["TASK", "HR"],
  "required_permission_code": "DASH.WIDGET.VIEW_MY_TASKS",
  "default_data_scope": "Own",
  "default_cache_ttl_seconds": 60,
  "is_enabled": true,
  "is_system_widget": true
}
```

### 27.2 Seed dashboard configs

| Dashboard type | Widget ưu tiên |
| --- | --- |
| Employee | ATTENDANCE_TODAY, MY_TASKS, LEAVE_BALANCE, NOTIFICATIONS, LATEST_LEAVE |
| Manager | PENDING_LEAVE, TEAM_TASKS_TODAY, TASK_ALERTS, LEAVE_CALENDAR, ATTENDANCE_ALERTS |
| HR | HR_OVERVIEW, NEW_EMPLOYEES, CONTRACT_EXPIRING, PENDING_LEAVE, ATTENDANCE_ALERTS, PROBATION_ENDING |
| Admin | USER_SUMMARY, EMPLOYEE_SUMMARY, MODULE_STATUS, CONFIG_WARNINGS, NEW_USERS, SYSTEM_LOGS |

### 27.3 Seed permissions

Seed đầy đủ các permission `DASH.*` trong AUTH/RBAC và gán role mặc định:

| Role | Permission chính |
| --- | --- |
| Employee | Employee dashboard, attendance today, my tasks, leave balance, notifications |
| Manager | Employee + Manager dashboard, pending leave team, team task, task alerts |
| HR | HR dashboard, HR overview, contract expiring, attendance alerts, pending leave company |
| Admin | Admin dashboard, user summary, module status, config warnings, dashboard config |
| Super Admin | Toàn bộ DASH permission với scope System |

---

## 28. Controller skeleton

```ts
@Controller('/api/v1/dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('/me')
  @RequirePermission('DASH.DASHBOARD.VIEW')
  getMe(@CurrentAuth() auth: AuthContext, @Query() query: DashboardQueryDto) {
    return this.dashboardService.getMyDashboard(auth, query);
  }

  @Get('/types')
  @RequirePermission('DASH.DASHBOARD.VIEW')
  getTypes(@CurrentAuth() auth: AuthContext) {
    return this.dashboardService.getAvailableTypes(auth);
  }

  @Get('/widgets')
  @RequirePermission('DASH.DASHBOARD.VIEW')
  getWidgets(@CurrentAuth() auth: AuthContext, @Query() query: DashboardQueryDto) {
    return this.dashboardService.getWidgetCatalog(auth, query);
  }

  @Get('/:type')
  getDashboardByType(@Param('type') type: string, @CurrentAuth() auth: AuthContext, @Query() query: DashboardQueryDto) {
    return this.dashboardService.getDashboardByType(auth, type, query);
  }
}
```

```ts
@Controller('/api/v1/dashboard/widgets')
@UseGuards(AuthGuard)
export class DashboardWidgetController {
  constructor(private readonly widgetRunner: DashboardWidgetRunnerService) {}

  @Get('/:slug')
  getWidget(@Param('slug') slug: string, @CurrentAuth() auth: AuthContext, @Query() query: DashboardQueryDto) {
    return this.widgetRunner.runSingleWidget(auth, slug, query);
  }
}
```

```ts
@Controller('/internal/v1/dashboard')
@UseGuards(InternalServiceGuard)
export class InternalDashboardController {
  constructor(private readonly cacheInvalidationService: DashboardCacheInvalidationService) {}

  @Post('/cache/invalidate')
  invalidate(@Body() body: InternalCacheInvalidateDto) {
    return this.cacheInvalidationService.invalidate(body);
  }

  @Post('/cache/refresh')
  refresh(@Body() body: InternalCacheRefreshDto) {
    return this.cacheInvalidationService.refresh(body);
  }
}
```

---

## 29. Service flow chi tiết

### 29.1 `DashboardService.getMyDashboard()`

```text
1. Validate auth context.
2. Resolve company timezone.
3. Resolve dashboard type mặc định.
4. Resolve available dashboard types.
5. Load widget configs theo dashboard type.
6. Merge configs theo priority.
7. Filter widget theo permission DASH.
8. Filter widget theo source permission nếu cần.
9. Resolve data scope cho từng widget.
10. Run widget handlers song song.
11. Map data/cache/error/actions sang DTO.
12. Trả response theo API-01.
```

### 29.2 `DashboardWidgetRunner.runWidget()`

```text
1. Load widget catalog by slug/code.
2. Check widget active.
3. Check DASH permission.
4. Check source permission.
5. Resolve scope.
6. Build cache key.
7. Nếu cache hit và refresh=false -> return cache.
8. Nếu cache miss -> call handler.load().
9. Save cache nếu cacheable.
10. Nếu handler lỗi -> degraded/error fallback.
11. Return DashboardWidgetDto.
```

### 29.3 `DashboardConfigService.resolveConfigs()`

```text
1. Load global default configs.
2. Load company default configs.
3. Load role configs theo roles của user.
4. Load user configs.
5. Merge theo priority.
6. Sort theo layout.order.
7. Remove duplicate widget.
8. Return effective configs.
```

---

## 30. Acceptance criteria

BACKEND-10 được xem là hoàn thành khi:

1. Có đầy đủ route `/api/v1/dashboard/*` theo API-08.
2. Có internal route `/internal/v1/dashboard/*` cho cache/event.
3. Dashboard `/me` tự resolve dashboard type đúng theo user permission.
4. Widget chỉ hiển thị khi user có permission và data scope hợp lệ.
5. Widget nhạy cảm kiểm thêm permission module nguồn.
6. Query luôn filter theo `company_id` từ auth context.
7. Có widget registry và mỗi widget có handler riêng.
8. Có cache TTL cho widget nặng.
9. Có cache invalidation theo event module nguồn.
10. Widget source lỗi trả `Degraded`/`Error`, dashboard tổng vẫn success.
11. Config widget có CRUD, reorder, reset default, bulk update.
12. Thay đổi config ghi audit log đầy đủ.
13. Quick action trả `enabled/disabled_reason`, không để frontend tự đoán.
14. Có unit test cho permission, scope, config priority, cache và widget runner.
15. Có integration test cho Employee/Manager/HR/Admin dashboard.
16. Có performance test cho `/dashboard/me` và các widget nặng.
17. Không lộ dữ liệu trái quyền trong response, cache, log hoặc error.
18. Swagger/OpenAPI có tag Dashboard, Dashboard Widgets, Dashboard Configs, Dashboard Internal Cache.

---

## 31. Thứ tự triển khai đề xuất

### Phase 1 - Skeleton và foundation

1. Tạo `DashboardModule`.
2. Tạo controller public/internal.
3. Tạo DTO, constants, error codes.
4. Tạo repository cho `dashboard_widgets`, `dashboard_widget_configs`, `dashboard_widget_cache`.
5. Kết nối AuthGuard, PermissionGuard, AuditService.

### Phase 2 - Registry, permission và config

1. Tạo `DashboardWidgetRegistryService`.
2. Tạo `DashboardPermissionService`.
3. Tạo `DashboardScopeService`.
4. Tạo `DashboardConfigService`.
5. Implement dashboard type resolution.
6. Implement config priority merge.

### Phase 3 - Cache

1. Tạo `DashboardCacheService`.
2. Implement cache key builder.
3. Implement cache hit/miss/expired/stale.
4. Implement cache write.
5. Implement internal invalidate/refresh endpoint.
6. Implement cache invalidation processor job.

### Phase 4 - Widget MVP nhóm Employee

1. `ATTENDANCE_TODAY`.
2. `MY_TASKS`.
3. `TASK_ALERTS`.
4. `LEAVE_BALANCE`.
5. `NOTIFICATIONS`.
6. `LATEST_LEAVE`.

### Phase 5 - Widget Manager/HR/Admin

1. `PENDING_LEAVE`.
2. `LEAVE_CALENDAR`.
3. `TEAM_TASKS_TODAY`.
4. `HR_OVERVIEW`.
5. `NEW_EMPLOYEES`.
6. `CONTRACT_EXPIRING`.
7. `ATTENDANCE_ALERTS`.
8. `PROJECT_PROGRESS`.
9. `USER_SUMMARY`.
10. `MODULE_STATUS`.
11. `CONFIG_WARNINGS`.
12. `SYSTEM_LOGS`.

### Phase 6 - Config admin và audit

1. CRUD config.
2. Reorder/bulk update.
3. Reset default.
4. Audit diff.
5. Permission test.

### Phase 7 - Test và tối ưu

1. Unit test.
2. Integration test.
3. Performance test.
4. Security test.
5. EXPLAIN ANALYZE query nặng.
6. Swagger/OpenAPI.

---

## 32. Checklist bàn giao cho Frontend

Backend cần đảm bảo response đủ cho UI:

1. `widget_code`.
2. `widget_name`.
3. `widget_type`.
4. `status`.
5. `layout`.
6. `permission`.
7. `data_scope`.
8. `source_modules`.
9. `data`.
10. `empty_state`.
11. `error_state`.
12. `last_updated_at`.
13. `cache`.
14. `actions`.
15. `enabled` và `disabled_reason` cho từng quick action.
16. `request_id` trong meta/error để frontend hiển thị hoặc gửi support.
17. `degraded` state khi module nguồn lỗi.
18. `stale`/`last_success_at` nếu dùng fallback cache.

---

## 33. Kết luận

BACKEND-10 hoàn thiện lớp backend cho Dashboard của hệ thống.

Trọng tâm triển khai là:

1. Dashboard chỉ tổng hợp dữ liệu và điều hướng, không xử lý nghiệp vụ gốc.
2. Backend là nơi kiểm permission, source permission và data scope cuối cùng.
3. Widget phải được thiết kế dạng registry/handler để dễ mở rộng.
4. Cache dashboard cần TTL, invalidation và degraded fallback.
5. Config widget cần hỗ trợ global/company/role/user và ghi audit log.
6. Dashboard phải chịu lỗi cục bộ theo từng widget, không sập toàn trang.
7. Toàn bộ response phải phục vụ tốt cho frontend dashboard theo role, lazy load widget và responsive UI.

Sau BACKEND-10, bước tiếp theo nên triển khai:

```text
BACKEND-11: File, Audit, Settings & System Jobs
```

Nội dung BACKEND-11 tập trung vào Foundation implementation (file, audit log, settings, sequence, holiday, retention) và catalog system jobs nền (cache cleanup, retention, reminder). Event bus nội bộ, background jobs liên-module, cache invalidation thống nhất, contract test và OpenAPI hợp nhất được chuẩn hóa ở BACKEND-12.
