# FRONTEND-07: DASHBOARD FRONTEND

> **📚 Bộ tài liệu FRONTEND — Hệ thống Quản lý Doanh nghiệp**
> [FRONTEND-01 Kiến trúc & Setup](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [FRONTEND-02 Design System](<FRONTEND-02_Design_System_Implementation.md>) · [FRONTEND-03 Routing/Auth/Permission](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [FRONTEND-04 API Client](<FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · [FRONTEND-05 Layout](<FRONTEND-05_Layout_Implementation.md>) · [FRONTEND-06 AUTH/Account](<FRONTEND-06_AUTH_Account_Frontend.md>) · **FRONTEND-07 Dashboard** · [FRONTEND-08 HR](<FRONTEND-08_HR_Frontend.md>) · [FRONTEND-09 Attendance](<FRONTEND-09_Attendance_Frontend.md>) · [FRONTEND-10 Leave](<FRONTEND-10_Leave_Frontend.md>) · [FRONTEND-11 Task](<FRONTEND-11_Task_Frontend.md>) · [FRONTEND-12 Notification](<FRONTEND-12_Notification_Frontend.md>) · [FRONTEND-13 System/Foundation](<FRONTEND-13_System_Foundation_Frontend.md>) · [FRONTEND-14 QA & Release](<FRONTEND-14_QA_Performance_Release_Readiness.md>)
>
> **Liên quan:** [Đặc tả: SPEC-07 DASH](<../SPEC/SPEC-07 DASH.md>) · [DASH API: API-08](<../API Design/API-08_DASH_API_Design.md>) · [Dashboard UI: UI-08](<../UI/UI-08_Dashboard_UIUX_Design.md>) · [API Client: FRONTEND-04](<FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | FRONTEND-07 |
| Tên tài liệu | Dashboard Frontend |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | DASH - Dashboard |
| Giai đoạn | Frontend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-06 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

FRONTEND-07 mô tả cách triển khai frontend cho module **Dashboard** của hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chuyển thiết kế Dashboard từ UI-08 sang kiến trúc frontend có thể code được.
2. Chuẩn hóa route, page, component, hook, API service và state cho Dashboard.
3. Triển khai Dashboard theo vai trò: Employee, Manager, HR, Admin.
4. Triển khai hệ thống widget: metric, list, status, alert, calendar mini, progress, chart placeholder.
5. Triển khai quick action theo permission, data scope và business state do backend trả về.
6. Đảm bảo Dashboard dùng lại Module Workspace Layout, Design System, API Client và Permission Framework đã chốt ở các bước frontend trước.
7. Đảm bảo Dashboard chỉ tổng hợp, hiển thị, cảnh báo và điều hướng; không xử lý nghiệp vụ gốc thay các module ATT, LEAVE, TASK, HR, NOTI, AUTH hoặc FOUNDATION.
8. Chuẩn hóa cache, lazy load, refresh, fallback và degraded state cho từng widget.
9. Chuẩn hóa test case, acceptance criteria và Definition of Done cho Dashboard Frontend.

---

## 3. Vị trí FRONTEND-07 trong roadmap frontend

```text
FRONTEND-01: Frontend Architecture & Project Setup
FRONTEND-02: Design System Implementation
FRONTEND-03: Routing, Auth Guard & Permission Framework
FRONTEND-04: API Client, Query Layer & Error Handling
FRONTEND-05: Layout Implementation
FRONTEND-06: AUTH & Account Frontend
FRONTEND-07: Dashboard Frontend
FRONTEND-08: HR Frontend
FRONTEND-09: Attendance Frontend
FRONTEND-10: Leave Frontend
FRONTEND-11: Task Frontend
FRONTEND-12: Notification Frontend
FRONTEND-13: System/Foundation Frontend
FRONTEND-14: QA, Performance & Release Readiness
```

FRONTEND-07 là module nghiệp vụ frontend đầu tiên sau khi các lớp nền đã có:

1. Design System.
2. Route guard.
3. Permission utility.
4. API client.
5. Query layer.
6. Layout shell.
7. Auth/session context.

Dashboard là nơi kiểm tra khả năng tích hợp nhiều lớp nền cùng lúc, vì một màn Dashboard cần session, permission, module workspace layout, widget grid, API query, error state, notification badge, quick action và deep link sang module khác.

---

## 4. Căn cứ triển khai

FRONTEND-07 bám theo các quyết định đã chốt:

1. Dashboard là một app/module riêng, được mở từ Home Portal hoặc App Switcher.
2. Dashboard chạy trong `ModuleWorkspaceLayout`, dùng sidebar DASH và topbar chung.
3. Dashboard có các dashboard type: Employee, Manager, HR, Admin.
4. User có thể có nhiều dashboard type nếu có nhiều permission.
5. Dashboard mặc định được resolve qua API `/api/v1/dashboard/me`.
6. Dashboard chỉ tổng hợp dữ liệu, không thay module gốc xử lý nghiệp vụ.
7. Widget, badge, counter, quick action phải hiển thị theo permission và data scope.
8. Backend vẫn là nguồn kiểm soát quyền cuối cùng.
9. Widget cần hỗ trợ loading, empty, error, degraded, stale, forbidden và disabled state.
10. Widget có thể lazy load hoặc refresh riêng.
11. Quick action có thể điều hướng, mở drawer/modal hoặc gọi API module gốc nếu đã được thiết kế rõ.
12. Notification deep link và Dashboard quick action phải đi về module gốc để module đó kiểm tra quyền và business rule lại.
13. Dashboard phải responsive: desktop 12 cột, tablet 2 cột, mobile 1 cột.
14. Không hard-code theo role name; phải kiểm tra permission và data scope.
15. Khi logout phải clear cache Dashboard theo user.

---

## 5. Phạm vi FRONTEND-07

### 5.1 Bao gồm trong MVP

| Nhóm | Nội dung |
| --- | --- |
| Route | `/dashboard`, `/dashboard/employee`, `/dashboard/manager`, `/dashboard/hr`, `/dashboard/admin`, `/dashboard/widgets`, `/dashboard/configs` |
| Page | Dashboard mặc định, Employee Dashboard, Manager Dashboard, HR Dashboard, Admin Dashboard |
| Widget | Attendance today, My tasks, Task alerts, Leave balance, Pending leave, Leave calendar, Notifications, HR overview, New employees, Contract expiring, Attendance alerts, Project progress, Admin/System widgets |
| Quick action | Check-in/out, tạo đơn nghỉ, xem task, duyệt đơn, xem bảng công, quản lý nhân viên, cấu hình dashboard |
| API service | `dashboard.api.ts` |
| Query hooks | `useDashboardMe`, `useDashboardTypes`, `useDashboardByType`, `useDashboardWidget`, `useDashboardConfigs` |
| Component | `DashboardPage`, `DashboardHeader`, `DashboardTypeSwitcher`, `DashboardWidgetGrid`, `DashboardWidgetCard`, widget renderer, quick actions |
| Permission | Route permission, widget permission, action permission, config permission |
| State | Loading, empty, error, degraded, stale, forbidden, disabled, refreshing |
| Responsive | Desktop/tablet/mobile web |
| Mock | MSW/mock data cho dashboard và widget |
| Test | Unit, component, integration và E2E flow cơ bản |

### 5.2 Không bao gồm trong FRONTEND-07

| Nội dung | Chuyển sang |
| --- | --- |
| Check-in/check-out full flow chi tiết | FRONTEND-09 Attendance Frontend |
| Tạo/duyệt nghỉ phép full form | FRONTEND-10 Leave Frontend |
| Task detail, Kanban, comment, checklist | FRONTEND-11 Task Frontend |
| Notification list/detail/config | FRONTEND-12 Notification Frontend |
| User/role/permission admin chi tiết | FRONTEND-06 hoặc FRONTEND-13 |
| Drag/drop cá nhân hóa widget nâng cao | Phase sau |
| Realtime WebSocket dashboard | Phase sau |
| BI dashboard nâng cao | Phase sau |
| Export PDF/Excel dashboard | Phase sau |

---

## 6. Nguyên tắc triển khai quan trọng

### 6.1 Dashboard không xử lý nghiệp vụ gốc

Dashboard được phép:

1. Hiển thị số liệu tổng hợp.
2. Hiển thị danh sách ngắn.
3. Hiển thị trạng thái/cảnh báo.
4. Điều hướng sang module gốc.
5. Gọi API module gốc cho action nhỏ nếu action đó đã được thiết kế an toàn, ví dụ mark notification read hoặc refresh widget.

Dashboard không được:

1. Tự ghi attendance record.
2. Tự đổi trạng thái leave request nếu không gọi LEAVE API.
3. Tự update task status bằng state cục bộ rồi bỏ qua TASK API.
4. Tự tính permission/data scope thay backend.
5. Tự tổng hợp dữ liệu nhạy cảm từ nhiều endpoint nếu API-08 đã có endpoint widget chuẩn.

### 6.2 Widget là đơn vị render độc lập

Mỗi widget phải có:

1. `widgetCode` duy nhất.
2. `widgetType` rõ ràng.
3. Permission cần thiết.
4. Source module.
5. Layout size.
6. State riêng.
7. Error/empty fallback riêng.
8. Refresh riêng nếu được phép.

### 6.3 Quick action phải có metadata

Không hard-code action trong component theo role. Action nên đến từ backend hoặc registry có metadata:

```ts
interface QuickActionVM {
  actionCode: string;
  label: string;
  targetModule: ModuleCode;
  method: 'NAVIGATE' | 'API_CALL' | 'OPEN_DRAWER' | 'OPEN_MODAL';
  targetUrl?: string;
  apiEndpoint?: string;
  enabled: boolean;
  disabledReason?: string | null;
  requiredPermission?: string;
}
```

### 6.4 Frontend chỉ hide/disable để UX tốt hơn

Nếu backend trả widget/action user không có quyền, frontend vẫn phải xử lý an toàn:

| Trường hợp | UI behavior |
| --- | --- |
| Widget thiếu permission | Không render hoặc render forbidden placeholder nếu backend yêu cầu |
| Widget status Hidden | Không hiển thị trong grid mặc định |
| Widget status Inactive | Ẩn hoặc hiển thị trong config screen |
| Action disabled | Disable button + tooltip/reason |
| Action forbidden từ backend | Hiển thị toast/alert 403 và refetch dashboard nếu cần |

---

## 7. Route architecture cho Dashboard

### 7.1 Route list

| Route | Page | Permission | Layout | Priority |
| --- | --- | --- | --- | --- |
| `/dashboard` | Dashboard mặc định của tôi | `DASH.DASHBOARD.VIEW` | Module Workspace | P0 |
| `/dashboard/employee` | Employee Dashboard | `DASH.DASHBOARD.VIEW_EMPLOYEE` | Module Workspace | P0 |
| `/dashboard/manager` | Manager Dashboard | `DASH.DASHBOARD.VIEW_MANAGER` | Module Workspace | P0 |
| `/dashboard/hr` | HR Dashboard | `DASH.DASHBOARD.VIEW_HR` | Module Workspace | P0 |
| `/dashboard/admin` | Admin Dashboard | `DASH.DASHBOARD.VIEW_ADMIN` | Module Workspace | P1 |
| `/dashboard/widgets` | Widget Catalog | `DASH.DASHBOARD.VIEW` | Module Workspace | P2 |
| `/dashboard/configs` | Dashboard Config List | `DASH.CONFIG.VIEW` | Module Workspace | P2 |
| `/dashboard/configs/:configId/edit` | Dashboard Config Edit | `DASH.CONFIG.UPDATE` | Module Workspace | P2 |

### 7.2 Route metadata đề xuất

```ts
export const dashboardRoutes: RouteMeta[] = [
  {
    routeKey: 'dashboard.me',
    path: '/dashboard',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'DASH',
    screenCode: 'FE-DASH-SCREEN-001',
    title: 'Dashboard',
    sidebarKey: 'dashboard.overview',
    pageTemplate: 'OVERVIEW',
    requiredPermissions: ['DASH.DASHBOARD.VIEW'],
    showInSidebar: true,
  },
  {
    routeKey: 'dashboard.employee',
    path: '/dashboard/employee',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'DASH',
    screenCode: 'FE-DASH-SCREEN-002',
    title: 'Dashboard của tôi',
    sidebarKey: 'dashboard.employee',
    pageTemplate: 'OVERVIEW',
    requiredPermissions: ['DASH.DASHBOARD.VIEW_EMPLOYEE'],
    showInSidebar: true,
  },
  {
    routeKey: 'dashboard.manager',
    path: '/dashboard/manager',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'DASH',
    screenCode: 'FE-DASH-SCREEN-003',
    title: 'Dashboard quản lý',
    sidebarKey: 'dashboard.manager',
    pageTemplate: 'OVERVIEW',
    requiredPermissions: ['DASH.DASHBOARD.VIEW_MANAGER'],
    showInSidebar: true,
  },
  {
    routeKey: 'dashboard.hr',
    path: '/dashboard/hr',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'DASH',
    screenCode: 'FE-DASH-SCREEN-004',
    title: 'Dashboard nhân sự',
    sidebarKey: 'dashboard.hr',
    pageTemplate: 'OVERVIEW',
    requiredPermissions: ['DASH.DASHBOARD.VIEW_HR'],
    showInSidebar: true,
  },
  {
    routeKey: 'dashboard.admin',
    path: '/dashboard/admin',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'DASH',
    screenCode: 'FE-DASH-SCREEN-005',
    title: 'Dashboard quản trị',
    sidebarKey: 'dashboard.admin',
    pageTemplate: 'OVERVIEW',
    requiredPermissions: ['DASH.DASHBOARD.VIEW_ADMIN'],
    showInSidebar: true,
  },
  {
    routeKey: 'dashboard.configs',
    path: '/dashboard/configs',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'DASH',
    screenCode: 'FE-DASH-SCREEN-007',
    title: 'Cấu hình Dashboard',
    sidebarKey: 'dashboard.configs',
    pageTemplate: 'SETTINGS',
    requiredPermissions: ['DASH.CONFIG.VIEW'],
    showInSidebar: true,
  },
];
```

### 7.3 Redirect rule cho `/dashboard`

Khi user vào `/dashboard`:

```text
1. Gọi useDashboardMe()
2. Nếu backend trả default_dashboard_type = Admin -> redirect /dashboard/admin
3. Nếu default_dashboard_type = HR -> redirect /dashboard/hr
4. Nếu default_dashboard_type = Manager -> redirect /dashboard/manager
5. Nếu default_dashboard_type = Employee -> redirect /dashboard/employee
6. Nếu backend trả full dashboard data cho /dashboard -> render trực tiếp, không cần redirect
7. Nếu không có dashboard hợp lệ -> ForbiddenState hoặc EmptyPermissionState
```

Khuyến nghị MVP: `/dashboard` gọi `/api/v1/dashboard/me`, sau đó render trực tiếp dashboard mặc định hoặc redirect theo `dashboard_type`. Nếu cần URL rõ ràng cho deep link, ưu tiên redirect sang route type cụ thể.

---

## 8. Sidebar DASH

### 8.1 Sidebar item

| Sidebar key | Label | Route | Permission | Badge |
| --- | --- | --- | --- | --- |
| `dashboard.overview` | Tổng quan | `/dashboard` | `DASH.DASHBOARD.VIEW` | Không |
| `dashboard.employee` | Cá nhân | `/dashboard/employee` | `DASH.DASHBOARD.VIEW_EMPLOYEE` | Không |
| `dashboard.manager` | Quản lý | `/dashboard/manager` | `DASH.DASHBOARD.VIEW_MANAGER` | Pending approvals nếu có |
| `dashboard.hr` | Nhân sự | `/dashboard/hr` | `DASH.DASHBOARD.VIEW_HR` | HR alerts nếu có |
| `dashboard.admin` | Quản trị | `/dashboard/admin` | `DASH.DASHBOARD.VIEW_ADMIN` | Config warnings nếu có |
| `dashboard.widgets` | Widget | `/dashboard/widgets` | `DASH.DASHBOARD.VIEW` | Không |
| `dashboard.configs` | Cấu hình | `/dashboard/configs` | `DASH.CONFIG.VIEW` | Không |

### 8.2 Sidebar config

```ts
export const dashboardSidebarItems: SidebarItemMeta[] = [
  {
    key: 'dashboard.overview',
    label: 'Tổng quan',
    href: '/dashboard',
    icon: 'LayoutDashboard',
    requiredPermissions: ['DASH.DASHBOARD.VIEW'],
    order: 10,
  },
  {
    key: 'dashboard.employee',
    label: 'Cá nhân',
    href: '/dashboard/employee',
    icon: 'UserRound',
    requiredPermissions: ['DASH.DASHBOARD.VIEW_EMPLOYEE'],
    order: 20,
  },
  {
    key: 'dashboard.manager',
    label: 'Quản lý',
    href: '/dashboard/manager',
    icon: 'UsersRound',
    requiredPermissions: ['DASH.DASHBOARD.VIEW_MANAGER'],
    order: 30,
  },
  {
    key: 'dashboard.hr',
    label: 'Nhân sự',
    href: '/dashboard/hr',
    icon: 'BriefcaseBusiness',
    requiredPermissions: ['DASH.DASHBOARD.VIEW_HR'],
    order: 40,
  },
  {
    key: 'dashboard.admin',
    label: 'Quản trị',
    href: '/dashboard/admin',
    icon: 'ShieldCheck',
    requiredPermissions: ['DASH.DASHBOARD.VIEW_ADMIN'],
    order: 50,
  },
  {
    key: 'dashboard.configs',
    label: 'Cấu hình',
    href: '/dashboard/configs',
    icon: 'Settings',
    requiredPermissions: ['DASH.CONFIG.VIEW'],
    order: 90,
  },
];
```

---

## 9. Cấu trúc thư mục đề xuất

```text
src/
  modules/
    dashboard/
      dashboard.routes.ts
      dashboard.sidebar.ts
      dashboard.permissions.ts
      dashboard.constants.ts
      dashboard.types.ts
      dashboard.mappers.ts
      services/
        dashboard.api.ts
        dashboard.keys.ts
      hooks/
        useDashboardMe.ts
        useDashboardTypes.ts
        useDashboardByType.ts
        useDashboardWidget.ts
        useRefreshDashboard.ts
        useDashboardConfigs.ts
        useUpdateDashboardConfig.ts
      components/
        DashboardPage/
          DashboardPage.tsx
          DashboardPage.test.tsx
          index.ts
        DashboardHeader/
          DashboardHeader.tsx
          DashboardHeader.types.ts
          index.ts
        DashboardTypeSwitcher/
          DashboardTypeSwitcher.tsx
          index.ts
        DashboardScopeBadge/
          DashboardScopeBadge.tsx
          index.ts
        DashboardQuickActions/
          DashboardQuickActions.tsx
          QuickActionCardAdapter.tsx
          index.ts
        DashboardAlertStrip/
          DashboardAlertStrip.tsx
          index.ts
        DashboardWidgetGrid/
          DashboardWidgetGrid.tsx
          index.ts
        DashboardWidgetCard/
          DashboardWidgetCard.tsx
          DashboardWidgetCard.types.ts
          index.ts
        DashboardWidgetRenderer/
          DashboardWidgetRenderer.tsx
          widget-renderer-map.ts
          index.ts
        widgets/
          AttendanceTodayWidget.tsx
          MyTasksWidget.tsx
          TaskAlertsWidget.tsx
          LeaveBalanceWidget.tsx
          PendingLeaveWidget.tsx
          LeaveCalendarWidget.tsx
          NotificationsWidget.tsx
          HrOverviewWidget.tsx
          NewEmployeesWidget.tsx
          ContractExpiringWidget.tsx
          AttendanceAlertsWidget.tsx
          ProjectProgressWidget.tsx
          UserSummaryWidget.tsx
          EmployeeSummaryWidget.tsx
          ModuleStatusWidget.tsx
          ConfigWarningsWidget.tsx
          SystemLogsWidget.tsx
          UnknownWidget.tsx
        states/
          DashboardLoadingState.tsx
          DashboardForbiddenState.tsx
          DashboardEmptyState.tsx
          DashboardErrorState.tsx
          WidgetLoadingState.tsx
          WidgetEmptyState.tsx
          WidgetErrorState.tsx
          WidgetDegradedState.tsx
          WidgetStaleBadge.tsx
        config/
          DashboardConfigListPage.tsx
          DashboardConfigEditPage.tsx
          WidgetCatalogPage.tsx
          WidgetPreviewDrawer.tsx
      pages/
        DashboardMePage.tsx
        EmployeeDashboardPage.tsx
        ManagerDashboardPage.tsx
        HrDashboardPage.tsx
        AdminDashboardPage.tsx
      mocks/
        dashboard.mock.ts
        dashboard.msw.ts
      tests/
        dashboard.fixtures.ts
        dashboard.test-utils.tsx
```

---

## 10. TypeScript data model

### 10.1 Dashboard type

```ts
export type DashboardType = 'Employee' | 'Manager' | 'HR' | 'Admin';

export type DashboardRouteType = 'employee' | 'manager' | 'hr' | 'admin';

export const dashboardTypeToRoute: Record<DashboardType, DashboardRouteType> = {
  Employee: 'employee',
  Manager: 'manager',
  HR: 'hr',
  Admin: 'admin',
};

export const dashboardRouteToType: Record<DashboardRouteType, DashboardType> = {
  employee: 'Employee',
  manager: 'Manager',
  hr: 'HR',
  admin: 'Admin',
};
```

### 10.2 Widget status và size

```ts
export type WidgetStatus =
  | 'Active'
  | 'Inactive'
  | 'Hidden'
  | 'Loading'
  | 'Empty'
  | 'Error'
  | 'Degraded'
  | 'Stale';

export type WidgetSize = 'small' | 'medium' | 'large' | 'full';

export type WidgetType =
  | 'metric'
  | 'status'
  | 'list'
  | 'alert'
  | 'calendar'
  | 'progress'
  | 'chart'
  | 'system';
```

### 10.3 Dashboard view model

```ts
export interface DashboardViewModel {
  dashboardType: DashboardType;
  title: string;
  subtitle?: string;
  scopeLabel: string;
  scope?: DataScope;
  lastUpdatedAt?: string | null;
  availableTypes: DashboardType[];
  quickActions: QuickActionVM[];
  alerts: DashboardAlertVM[];
  widgets: DashboardWidgetVM[];
  config?: DashboardLayoutConfigVM | null;
}

export interface DashboardAlertVM {
  alertCode: string;
  title: string;
  description?: string;
  severity: 'info' | 'success' | 'warning' | 'danger';
  targetUrl?: string;
  dismissible?: boolean;
}

export interface DashboardLayoutConfigVM {
  configId?: string;
  dashboardType: DashboardType;
  layoutMode: 'default' | 'company' | 'role' | 'user';
  canConfigure: boolean;
}
```

### 10.4 Widget view model

```ts
export interface DashboardWidgetVM<TData = unknown> {
  widgetCode: DashboardWidgetCode;
  title: string;
  description?: string;
  type: WidgetType;
  status: WidgetStatus;
  size: WidgetSize;
  order: number;
  sourceModules: ModuleCode[];
  permission?: string;
  dataScope?: DataScope;
  data: TData | null;
  emptyState?: WidgetEmptyState | null;
  errorState?: WidgetErrorState | null;
  lastUpdatedAt?: string | null;
  lastSuccessAt?: string | null;
  cache?: WidgetCacheInfo | null;
  actions?: QuickActionVM[];
}

export interface WidgetEmptyState {
  title: string;
  description?: string;
  action?: QuickActionVM | null;
}

export interface WidgetErrorState {
  code: string;
  message: string;
  sourceModule?: ModuleCode;
  retryable: boolean;
  requestId?: string;
}

export interface WidgetCacheInfo {
  hit: boolean;
  ttlSeconds?: number;
  expiresAt?: string | null;
}
```

### 10.5 Quick action VM

```ts
export interface QuickActionVM {
  actionCode: string;
  label: string;
  description?: string;
  targetModule: ModuleCode;
  method: 'NAVIGATE' | 'API_CALL' | 'OPEN_DRAWER' | 'OPEN_MODAL';
  targetUrl?: string | null;
  apiEndpoint?: string | null;
  enabled: boolean;
  disabledReason?: string | null;
  badgeCount?: number | null;
  requiredPermission?: string | null;
  variant?: 'primary' | 'secondary' | 'warning' | 'danger' | 'ghost';
}
```

### 10.6 Widget code

```ts
export type DashboardWidgetCode =
  | 'ATTENDANCE_TODAY'
  | 'MY_TASKS'
  | 'TASK_ALERTS'
  | 'LEAVE_BALANCE'
  | 'PENDING_LEAVE'
  | 'LEAVE_CALENDAR'
  | 'NOTIFICATIONS'
  | 'HR_OVERVIEW'
  | 'NEW_EMPLOYEES'
  | 'CONTRACT_EXPIRING'
  | 'ATTENDANCE_ALERTS'
  | 'PROJECT_PROGRESS'
  | 'USER_SUMMARY'
  | 'EMPLOYEE_SUMMARY'
  | 'MODULE_STATUS'
  | 'CONFIG_WARNINGS'
  | 'NEW_USERS'
  | 'SYSTEM_LOGS'
  | 'SYSTEM_NOTIFICATIONS'
  | 'LATEST_LEAVE'
  | 'TEAM_TASKS_TODAY'
  | 'PROBATION_ENDING';
```

---

## 11. API service cho Dashboard

### 11.1 File `dashboard.api.ts`

```ts
// src/modules/dashboard/services/dashboard.api.ts
import { apiClient } from '@/services/api/api-client';
import type {
  DashboardType,
  DashboardViewModel,
  DashboardWidgetCode,
  DashboardWidgetVM,
  DashboardConfigListItem,
  DashboardConfigDetail,
  UpdateDashboardConfigRequest,
  WidgetCatalogItem,
} from '../dashboard.types';

export interface DashboardQueryParams {
  view?: 'full' | 'compact';
  period?: 'today' | 'current_week' | 'current_month' | 'custom';
  from_date?: string;
  to_date?: string;
  refresh?: boolean;
  include_config?: boolean;
  include_empty_widgets?: boolean;
  limit?: number;
  widget_codes?: DashboardWidgetCode[];
}

export const dashboardApi = {
  getMe(params?: DashboardQueryParams) {
    return apiClient.get<DashboardViewModel>('/dashboard/me', {
      query: params,
    });
  },

  getTypes() {
    return apiClient.get<{ types: DashboardType[]; default_type: DashboardType }>('/dashboard/types');
  },

  getDashboardByType(type: DashboardType, params?: DashboardQueryParams) {
    const pathMap: Record<DashboardType, string> = {
      Employee: '/dashboard/employee',
      Manager: '/dashboard/manager',
      HR: '/dashboard/hr',
      Admin: '/dashboard/admin',
    };

    return apiClient.get<DashboardViewModel>(pathMap[type], {
      query: params,
    });
  },

  getWidget<TData = unknown>(widgetSlug: string, params?: DashboardQueryParams) {
    return apiClient.get<DashboardWidgetVM<TData>>(`/dashboard/widgets/${widgetSlug}`, {
      query: params,
    });
  },

  getWidgetCatalog(params?: { dashboard_type?: DashboardType; search?: string }) {
    return apiClient.get<WidgetCatalogItem[]>('/dashboard/widgets', {
      query: params,
    });
  },

  getConfigs(params?: {
    dashboard_type?: DashboardType;
    role_id?: string;
    status?: string;
    search?: string;
    page?: number;
    per_page?: number;
  }) {
    return apiClient.get<DashboardConfigListItem[]>('/dashboard/configs', {
      query: params,
    });
  },

  getConfig(configId: string) {
    return apiClient.get<DashboardConfigDetail>(`/dashboard/configs/${configId}`);
  },

  updateConfig(configId: string, body: UpdateDashboardConfigRequest) {
    return apiClient.patch<DashboardConfigDetail, UpdateDashboardConfigRequest>(
      `/dashboard/configs/${configId}`,
      body,
    );
  },

  refreshCache(params?: { dashboard_type?: DashboardType; widget_code?: DashboardWidgetCode }) {
    return apiClient.post<{ refreshed: boolean }>('/dashboard/cache/refresh', params ?? {});
  },
};
```

### 11.2 Lưu ý về endpoint refresh cache

Nếu backend chỉ cho phép Admin gọi refresh cache, nút refresh dashboard thông thường không nên gọi `/dashboard/cache/refresh`. Khi user click refresh, frontend nên truyền query `refresh=true` vào dashboard/widget endpoint. Backend sẽ quyết định có bypass cache hay không theo quyền.

---

## 12. Query keys

### 12.1 File `dashboard.keys.ts`

```ts
// src/modules/dashboard/services/dashboard.keys.ts
import type { DashboardType, DashboardWidgetCode } from '../dashboard.types';
import type { DashboardQueryParams } from './dashboard.api';

export const dashboardKeys = {
  all: ['dashboard'] as const,

  me: (params?: DashboardQueryParams) =>
    [...dashboardKeys.all, 'me', params] as const,

  types: () =>
    [...dashboardKeys.all, 'types'] as const,

  byType: (type: DashboardType, params?: DashboardQueryParams) =>
    [...dashboardKeys.all, 'type', type, params] as const,

  widgets: {
    all: () => [...dashboardKeys.all, 'widgets'] as const,
    catalog: (params?: Record<string, unknown>) =>
      [...dashboardKeys.widgets.all(), 'catalog', params] as const,
    detail: (widgetCode: DashboardWidgetCode | string, params?: DashboardQueryParams) =>
      [...dashboardKeys.widgets.all(), 'detail', widgetCode, params] as const,
  },

  configs: {
    all: () => [...dashboardKeys.all, 'configs'] as const,
    list: (params?: Record<string, unknown>) =>
      [...dashboardKeys.configs.all(), 'list', params] as const,
    detail: (configId: string) =>
      [...dashboardKeys.configs.all(), 'detail', configId] as const,
  },
};
```

---

## 13. Query hooks

### 13.1 `useDashboardMe`

```ts
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, type DashboardQueryParams } from '../services/dashboard.api';
import { dashboardKeys } from '../services/dashboard.keys';

export function useDashboardMe(params?: DashboardQueryParams) {
  return useQuery({
    queryKey: dashboardKeys.me(params),
    queryFn: ({ signal }) => dashboardApi.getMe({ ...params, signal } as DashboardQueryParams),
    staleTime: 30_000,
  });
}
```

Nếu `apiClient` nhận `signal` trong options riêng thay vì query params, dùng pattern:

```ts
queryFn: ({ signal }) => dashboardApi.getMe(params, { signal })
```

Tùy theo API client đã chốt ở FRONTEND-04 mà điều chỉnh signature.

### 13.2 `useDashboardTypes`

```ts
export function useDashboardTypes() {
  return useQuery({
    queryKey: dashboardKeys.types(),
    queryFn: () => dashboardApi.getTypes(),
    staleTime: 60_000,
  });
}
```

### 13.3 `useDashboardByType`

```ts
export function useDashboardByType(type: DashboardType, params?: DashboardQueryParams) {
  return useQuery({
    queryKey: dashboardKeys.byType(type, params),
    queryFn: () => dashboardApi.getDashboardByType(type, params),
    staleTime: 30_000,
    enabled: Boolean(type),
  });
}
```

### 13.4 `useDashboardWidget`

```ts
export function useDashboardWidget<TData = unknown>(
  widgetSlug: string,
  params?: DashboardQueryParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: dashboardKeys.widgets.detail(widgetSlug, params),
    queryFn: () => dashboardApi.getWidget<TData>(widgetSlug, params),
    staleTime: 30_000,
    enabled: options?.enabled ?? Boolean(widgetSlug),
  });
}
```

### 13.5 `useRefreshDashboard`

```ts
import { useQueryClient } from '@tanstack/react-query';

export function useRefreshDashboard() {
  const queryClient = useQueryClient();

  return {
    refreshAll() {
      return queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },

    refreshDashboard(type: DashboardType) {
      return queryClient.invalidateQueries({ queryKey: [...dashboardKeys.all, 'type', type] });
    },

    refreshWidget(widgetCode: DashboardWidgetCode | string) {
      return queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          query.queryKey.includes('widgets') &&
          query.queryKey.includes(widgetCode),
      });
    },
  };
}
```

---

## 14. Mapping API DTO sang ViewModel

### 14.1 Vì sao cần mapper

Backend có thể trả format snake_case theo API contract, trong khi component frontend nên dùng camelCase. Không nên để component phụ thuộc trực tiếp vào DTO thô.

```text
API DTO -> mapper -> ViewModel -> Component
```

### 14.2 Mapper mẫu

```ts
export function mapDashboardDtoToVM(dto: DashboardDto): DashboardViewModel {
  return {
    dashboardType: dto.dashboard_type,
    title: dto.title,
    subtitle: dto.subtitle ?? undefined,
    scopeLabel: dto.scope_label,
    scope: dto.data_scope,
    lastUpdatedAt: dto.last_updated_at,
    availableTypes: dto.available_types ?? [],
    quickActions: (dto.quick_actions ?? []).map(mapQuickActionDtoToVM),
    alerts: (dto.alerts ?? []).map(mapDashboardAlertDtoToVM),
    widgets: (dto.widgets ?? []).map(mapWidgetDtoToVM).sort((a, b) => a.order - b.order),
    config: dto.config ? mapDashboardConfigDtoToVM(dto.config) : null,
  };
}

export function mapWidgetDtoToVM(dto: DashboardWidgetDto): DashboardWidgetVM {
  return {
    widgetCode: dto.widget_code,
    title: dto.widget_name,
    description: dto.description ?? undefined,
    type: mapWidgetType(dto.widget_type),
    status: dto.status,
    size: dto.layout?.size ?? 'medium',
    order: dto.layout?.order ?? 999,
    sourceModules: dto.source_modules ?? [],
    permission: dto.permission,
    dataScope: dto.data_scope,
    data: dto.data ?? null,
    emptyState: dto.empty_state ? mapEmptyState(dto.empty_state) : null,
    errorState: dto.error_state ? mapErrorState(dto.error_state) : null,
    lastUpdatedAt: dto.last_updated_at,
    lastSuccessAt: dto.last_success_at,
    cache: dto.cache
      ? {
          hit: dto.cache.hit,
          ttlSeconds: dto.cache.ttl_seconds,
          expiresAt: dto.cache.expires_at,
        }
      : null,
    actions: (dto.actions ?? []).map(mapQuickActionDtoToVM),
  };
}
```

---

## 15. Component architecture

### 15.1 Component tree

```text
DashboardPage
├── DashboardHeader
│   ├── Breadcrumb
│   ├── DashboardTypeSwitcher
│   ├── DashboardScopeBadge
│   ├── RefreshButton
│   └── ConfigureButton
├── DashboardQuickActions
│   └── QuickActionCardAdapter[]
├── DashboardAlertStrip
└── DashboardWidgetGrid
    └── DashboardWidgetCard[]
        └── DashboardWidgetRenderer
            ├── AttendanceTodayWidget
            ├── MyTasksWidget
            ├── LeaveBalanceWidget
            ├── PendingLeaveWidget
            ├── NotificationsWidget
            └── UnknownWidget
```

### 15.2 `DashboardPage`

```tsx
interface DashboardPageProps {
  dashboardType?: DashboardType;
  mode?: 'me' | 'type';
}

export function DashboardPage({ dashboardType, mode = 'type' }: DashboardPageProps) {
  const params = { view: 'full' as const, include_config: true };

  const query = mode === 'me'
    ? useDashboardMe(params)
    : useDashboardByType(dashboardType!, params);

  if (query.isLoading) return <DashboardLoadingState />;
  if (query.isError) return <DashboardErrorState error={query.error} onRetry={query.refetch} />;
  if (!query.data) return <DashboardEmptyState />;

  return (
    <div className="space-y-6">
      <DashboardHeader dashboard={query.data} onRefresh={() => query.refetch()} />
      <DashboardQuickActions actions={query.data.quickActions} />
      <DashboardAlertStrip alerts={query.data.alerts} />
      <DashboardWidgetGrid widgets={query.data.widgets} />
    </div>
  );
}
```

### 15.3 `DashboardHeader`

```tsx
interface DashboardHeaderProps {
  dashboard: DashboardViewModel;
  onRefresh: () => void;
  refreshing?: boolean;
}

export function DashboardHeader({ dashboard, onRefresh, refreshing }: DashboardHeaderProps) {
  return (
    <PageHeader
      title={dashboard.title}
      description={dashboard.subtitle}
      breadcrumb={[{ label: 'Home', href: '/home' }, { label: 'Dashboard' }]}
      actions={
        <div className="flex items-center gap-2">
          <DashboardTypeSwitcher
            currentType={dashboard.dashboardType}
            availableTypes={dashboard.availableTypes}
          />
          <DashboardScopeBadge scope={dashboard.scope} label={dashboard.scopeLabel} />
          <Button variant="secondary" onClick={onRefresh} loading={refreshing}>
            Làm mới
          </Button>
          {dashboard.config?.canConfigure ? (
            <Button variant="ghost" asChild>
              <Link href="/dashboard/configs">Cấu hình</Link>
            </Button>
          ) : null}
        </div>
      }
    />
  );
}
```

### 15.4 `DashboardTypeSwitcher`

```tsx
const dashboardTypeOptions: Record<DashboardType, { label: string; href: string }> = {
  Employee: { label: 'Cá nhân', href: '/dashboard/employee' },
  Manager: { label: 'Quản lý', href: '/dashboard/manager' },
  HR: { label: 'Nhân sự', href: '/dashboard/hr' },
  Admin: { label: 'Quản trị', href: '/dashboard/admin' },
};

export function DashboardTypeSwitcher({ currentType, availableTypes }: {
  currentType: DashboardType;
  availableTypes: DashboardType[];
}) {
  if (availableTypes.length <= 1) return null;

  return (
    <Select
      value={currentType}
      onValueChange={(nextType) => {
        const href = dashboardTypeOptions[nextType as DashboardType].href;
        navigateWithDirtyGuard(href);
      }}
      options={availableTypes.map((type) => ({
        value: type,
        label: dashboardTypeOptions[type].label,
      }))}
      aria-label="Chọn loại dashboard"
    />
  );
}
```

---

## 16. Widget grid implementation

### 16.1 Layout class theo size

```ts
export function getWidgetGridClass(size: WidgetSize) {
  switch (size) {
    case 'small':
      return 'col-span-12 md:col-span-6 xl:col-span-3';
    case 'medium':
      return 'col-span-12 xl:col-span-6';
    case 'large':
      return 'col-span-12 xl:col-span-8';
    case 'full':
      return 'col-span-12';
    default:
      return 'col-span-12 xl:col-span-6';
  }
}
```

### 16.2 `DashboardWidgetGrid`

```tsx
export function DashboardWidgetGrid({ widgets }: { widgets: DashboardWidgetVM[] }) {
  const visibleWidgets = widgets
    .filter((widget) => widget.status !== 'Hidden' && widget.status !== 'Inactive')
    .sort((a, b) => a.order - b.order);

  if (visibleWidgets.length === 0) {
    return (
      <EmptyState
        title="Chưa có widget nào được hiển thị"
        description="Dashboard hiện chưa có widget phù hợp với quyền hoặc cấu hình của bạn."
      />
    );
  }

  return (
    <div className="grid grid-cols-12 gap-4 xl:gap-6">
      {visibleWidgets.map((widget) => (
        <div key={widget.widgetCode} className={getWidgetGridClass(widget.size)}>
          <DashboardWidgetCard widget={widget} />
        </div>
      ))}
    </div>
  );
}
```

### 16.3 `DashboardWidgetCard`

```tsx
export function DashboardWidgetCard({ widget }: { widget: DashboardWidgetVM }) {
  return (
    <WidgetCard
      title={widget.title}
      description={widget.description}
      actions={<WidgetActions widget={widget} />}
      footer={<WidgetFooter widget={widget} />}
    >
      <DashboardWidgetRenderer widget={widget} />
    </WidgetCard>
  );
}
```

### 16.4 Widget state renderer

```tsx
export function DashboardWidgetRenderer({ widget }: { widget: DashboardWidgetVM }) {
  if (widget.status === 'Loading') return <WidgetLoadingState />;
  if (widget.status === 'Empty') return <WidgetEmptyState state={widget.emptyState} />;
  if (widget.status === 'Error') return <WidgetErrorState state={widget.errorState} />;
  if (widget.status === 'Degraded') return <WidgetDegradedState widget={widget} />;

  const Component = widgetRendererMap[widget.widgetCode] ?? UnknownWidget;
  return <Component widget={widget} />;
}
```

---

## 17. Widget renderer map

```ts
export const widgetRendererMap: Partial<
  Record<DashboardWidgetCode, React.ComponentType<{ widget: DashboardWidgetVM }>>
> = {
  ATTENDANCE_TODAY: AttendanceTodayWidget,
  MY_TASKS: MyTasksWidget,
  TASK_ALERTS: TaskAlertsWidget,
  LEAVE_BALANCE: LeaveBalanceWidget,
  PENDING_LEAVE: PendingLeaveWidget,
  LEAVE_CALENDAR: LeaveCalendarWidget,
  NOTIFICATIONS: NotificationsWidget,
  HR_OVERVIEW: HrOverviewWidget,
  NEW_EMPLOYEES: NewEmployeesWidget,
  CONTRACT_EXPIRING: ContractExpiringWidget,
  ATTENDANCE_ALERTS: AttendanceAlertsWidget,
  PROJECT_PROGRESS: ProjectProgressWidget,
  USER_SUMMARY: UserSummaryWidget,
  EMPLOYEE_SUMMARY: EmployeeSummaryWidget,
  MODULE_STATUS: ModuleStatusWidget,
  CONFIG_WARNINGS: ConfigWarningsWidget,
  NEW_USERS: NewUsersWidget,
  SYSTEM_LOGS: SystemLogsWidget,
  SYSTEM_NOTIFICATIONS: SystemNotificationsWidget,
  LATEST_LEAVE: LatestLeaveWidget,
  TEAM_TASKS_TODAY: TeamTasksTodayWidget,
  PROBATION_ENDING: ProbationEndingWidget,
};
```

---

## 18. Widget implementation chi tiết

### 18.1 `ATTENDANCE_TODAY` widget

#### Mục tiêu

Cho Employee biết hôm nay đã check-in/check-out chưa và action tiếp theo là gì.

#### Data đề xuất

```ts
export interface AttendanceTodayWidgetData {
  date: string;
  status: 'NotCheckedIn' | 'CheckedIn' | 'CheckedOut' | 'Leave' | 'Remote' | 'Blocked';
  checkInAt?: string | null;
  checkOutAt?: string | null;
  workingMinutes?: number | null;
  message?: string | null;
  nextAction?: QuickActionVM | null;
}
```

#### Component

```tsx
export function AttendanceTodayWidget({ widget }: { widget: DashboardWidgetVM<AttendanceTodayWidgetData> }) {
  const data = widget.data;
  if (!data) return <WidgetEmptyState state={widget.emptyState} />;

  return (
    <AttendanceStatusCard
      date={data.date}
      status={data.status}
      checkInAt={data.checkInAt}
      checkOutAt={data.checkOutAt}
      workingMinutes={data.workingMinutes}
      message={data.message}
      action={data.nextAction ? <QuickActionCardAdapter action={data.nextAction} compact /> : null}
    />
  );
}
```

#### Lưu ý

1. Nếu hôm nay có đơn nghỉ full-day approved, backend nên trả status `Leave` hoặc action disabled.
2. Nút check-in/check-out nếu được hiển thị phải gọi ATT API hoặc điều hướng sang `/attendance/today`, tùy quyết định nghiệp vụ.
3. Sau khi check-in/out thành công, invalidate `dashboardKeys` và `attendanceKeys.today()`.

---

### 18.2 `MY_TASKS` widget

#### Mục tiêu

Hiển thị 3-7 task cần xử lý gần nhất của user.

#### Data đề xuất

```ts
export interface MyTasksWidgetData {
  total: number;
  items: Array<{
    id: string;
    title: string;
    status: 'Todo' | 'InProgress' | 'InReview' | 'Done' | 'Cancelled';
    priority: 'Low' | 'Medium' | 'High' | 'Urgent';
    dueDate?: string | null;
    project?: { id: string; name: string } | null;
    targetUrl: string;
  }>;
}
```

#### Component

```tsx
export function MyTasksWidget({ widget }: { widget: DashboardWidgetVM<MyTasksWidgetData> }) {
  const data = widget.data;
  if (!data || data.items.length === 0) return <WidgetEmptyState state={widget.emptyState} />;

  return (
    <ListWidget
      items={data.items}
      renderItem={(task) => (
        <TaskCard
          title={task.title}
          status={task.status}
          priority={task.priority}
          dueDate={task.dueDate}
          projectName={task.project?.name}
          href={task.targetUrl}
          compact
        />
      )}
      footerLink={{ label: 'Xem tất cả task', href: '/tasks/my-tasks' }}
    />
  );
}
```

---

### 18.3 `TASK_ALERTS` widget

#### Mục tiêu

Hiển thị task quá hạn hoặc sắp đến hạn.

#### UI behavior

| Trạng thái | UI |
| --- | --- |
| Có task quá hạn | Alert/list ưu tiên cao |
| Chỉ có task sắp đến hạn | Warning nhẹ |
| Không có task | Empty state tích cực |
| TASK module lỗi | Degraded state |

---

### 18.4 `LEAVE_BALANCE` widget

#### Data đề xuất

```ts
export interface LeaveBalanceWidgetData {
  balances: Array<{
    leaveTypeCode: string;
    leaveTypeName: string;
    remainingDays: number;
    usedDays: number;
    totalDays: number;
    warning?: 'LOW_BALANCE' | 'EXPIRED_SOON' | null;
  }>;
  createRequestAction?: QuickActionVM | null;
}
```

#### Component

```tsx
export function LeaveBalanceWidget({ widget }: { widget: DashboardWidgetVM<LeaveBalanceWidgetData> }) {
  const data = widget.data;
  if (!data) return <WidgetEmptyState state={widget.emptyState} />;

  return (
    <div className="space-y-3">
      {data.balances.map((balance) => (
        <LeaveBalanceCard
          key={balance.leaveTypeCode}
          leaveTypeName={balance.leaveTypeName}
          remainingDays={balance.remainingDays}
          usedDays={balance.usedDays}
          totalDays={balance.totalDays}
          warning={balance.warning}
          compact
        />
      ))}
      {data.createRequestAction ? <QuickActionCardAdapter action={data.createRequestAction} compact /> : null}
    </div>
  );
}
```

---

### 18.5 `PENDING_LEAVE` widget

#### Mục tiêu

Hiển thị đơn nghỉ đang chờ duyệt theo scope của Manager/HR.

#### Data đề xuất

```ts
export interface PendingLeaveWidgetData {
  total: number;
  items: Array<{
    id: string;
    employeeName: string;
    employeeCode: string;
    leaveTypeName: string;
    fromDate: string;
    toDate: string;
    totalDays: number;
    submittedAt: string;
    targetUrl: string;
    approveAction?: QuickActionVM | null;
    rejectAction?: QuickActionVM | null;
  }>;
}
```

#### Nguyên tắc action

1. MVP an toàn nhất: click item điều hướng sang `/leave/approvals/{requestId}`.
2. Nếu duyệt nhanh trên Dashboard, phải gọi LEAVE API và xử lý confirm dialog.
3. Sau approve/reject thành công, invalidate dashboard, leave approval list và notification unread count nếu liên quan.

---

### 18.6 `NOTIFICATIONS` widget

#### Mục tiêu

Hiển thị thông báo mới nhất và unread count.

#### Data đề xuất

```ts
export interface NotificationsWidgetData {
  // Shape object theo API-07 UnreadCountDto (không dùng scalar unreadCount)
  unread_count: {
    unread_count: number;
    high_priority_unread_count: number;
    urgent_unread_count: number;
    last_notification_at: string | null;
  };
  items: Array<{
    notification_id: string;
    title: string;
    short_content?: string;
    created_at: string;
    is_read: boolean;
    target_url?: string | null;
  }>;
}
```

#### Lưu ý

1. Widget dùng shape `unread_count` (object) theo API-07 UnreadCountDto, không dùng scalar `unreadCount`.
2. Item key chuẩn là `notification_id` (không dùng `id`); nội dung ngắn dùng `short_content` (DTO), ánh xạ cột DB `short_body`.
3. Notification item click nên gọi NOTI API mark read nếu policy cho phép.
4. Sau mark read, invalidate notification query và dashboard widget notification.
5. Deep link phải đi qua route guard.

---

### 18.7 `HR_OVERVIEW` widget

#### Data đề xuất

```ts
export interface HrOverviewWidgetData {
  totalEmployees: number;
  activeEmployees: number;
  probationEmployees: number;
  resignedThisMonth: number;
  byDepartment?: Array<{ departmentName: string; total: number }>;
}
```

#### UI

1. Hiển thị metric cards nhỏ.
2. Có thể có chart placeholder theo phòng ban.
3. CTA: `Xem nhân sự` -> `/hr/employees`.

---

### 18.8 `ATTENDANCE_ALERTS` widget

#### Mục tiêu

Hiển thị bất thường chấm công: quên check-out, đi muộn, thiếu giờ, yêu cầu điều chỉnh đang chờ.

#### Lưu ý

Widget này nhạy cảm theo scope. Không render nếu user không có permission phù hợp.

---

### 18.9 `PROJECT_PROGRESS` widget

#### Mục tiêu

Hiển thị tiến độ dự án liên quan hoặc dự án team.

#### UI

1. Danh sách 3-5 project.
2. Progress bar.
3. Số task done/total.
4. Cảnh báo overdue nếu có.
5. CTA: `Xem dự án`.

---

### 18.10 Admin/System widgets

| Widget | Data chính | CTA |
| --- | --- | --- |
| `USER_SUMMARY` | Tổng user, active, locked, pending | `/auth/users` |
| `MODULE_STATUS` | Module active/maintenance/disabled | `/system/modules` |
| `CONFIG_WARNINGS` | Cảnh báo cấu hình thiếu hoặc lỗi | `/system/settings` |
| `SYSTEM_LOGS` | Log quan trọng gần đây | `/system/audit-logs` |
| `SYSTEM_NOTIFICATIONS` | Thông báo hệ thống | `/notifications` |

---

## 19. Quick action implementation

### 19.1 `DashboardQuickActions`

```tsx
export function DashboardQuickActions({ actions }: { actions: QuickActionVM[] }) {
  const visibleActions = actions.filter(Boolean);
  if (visibleActions.length === 0) return null;

  return (
    <section aria-label="Hành động nhanh" className="flex gap-3 overflow-x-auto pb-1">
      {visibleActions.map((action) => (
        <QuickActionCardAdapter key={action.actionCode} action={action} />
      ))}
    </section>
  );
}
```

### 19.2 `QuickActionCardAdapter`

```tsx
export function QuickActionCardAdapter({ action, compact = false }: {
  action: QuickActionVM;
  compact?: boolean;
}) {
  const router = useRouter();

  const handleClick = async () => {
    if (!action.enabled) return;

    switch (action.method) {
      case 'NAVIGATE':
        if (action.targetUrl) router.push(action.targetUrl);
        return;
      case 'OPEN_DRAWER':
        openDashboardActionDrawer(action);
        return;
      case 'OPEN_MODAL':
        openDashboardActionModal(action);
        return;
      case 'API_CALL':
        await executeDashboardQuickAction(action);
        return;
      default:
        return;
    }
  };

  return (
    <QuickActionCard
      label={action.label}
      description={compact ? undefined : action.description}
      badgeCount={action.badgeCount ?? undefined}
      disabled={!action.enabled}
      disabledReason={action.disabledReason ?? undefined}
      variant={action.variant ?? 'secondary'}
      onClick={handleClick}
    />
  );
}
```

### 19.3 Nguyên tắc `API_CALL` action

`API_CALL` từ Dashboard chỉ nên dùng cho action nhỏ và an toàn:

| Action | Cho phép trong Dashboard? | Ghi chú |
| --- | --- | --- |
| Mark notification read | Có | Gọi NOTI API |
| Refresh widget | Có | Gọi dashboard/widget query |
| Check-in/out | Cân nhắc | Tốt hơn gọi ATT hook dùng chung, cần idempotency + confirm rule |
| Approve/reject leave | Cân nhắc | Nên mở module LEAVE hoặc drawer confirm dùng LEAVE API |
| Update task status | Cân nhắc | Nên mở task detail hoặc dùng TASK mutation với confirm/state rõ |
| Xóa/cấu hình nhạy cảm | Không | Điều hướng sang module gốc/config page |

---

## 20. Dashboard Config Frontend

### 20.1 Mục tiêu MVP

Dashboard Config cho phép Admin hoặc user có quyền:

1. Xem danh sách cấu hình dashboard.
2. Xem widget catalog.
3. Bật/tắt widget theo dashboard type.
4. Cập nhật order và size widget.
5. Reset về mặc định nếu API hỗ trợ.

MVP không cần drag/drop nâng cao. Có thể dùng form/table đơn giản.

### 20.2 `DashboardConfigListPage`

```tsx
export function DashboardConfigListPage() {
  const [params, setParams] = useDashboardConfigFilters();
  const query = useDashboardConfigs(params);

  return (
    <PageShell>
      <PageHeader title="Cấu hình Dashboard" description="Quản lý widget theo dashboard type, role hoặc user." />
      <DashboardConfigFilterBar value={params} onChange={setParams} />
      <DataTable
        data={query.data ?? []}
        loading={query.isLoading}
        error={query.error}
        columns={dashboardConfigColumns}
        empty={<EmptyState title="Chưa có cấu hình dashboard" />}
      />
    </PageShell>
  );
}
```

### 20.3 `DashboardConfigEditPage`

Màn edit nên dùng:

1. Page header.
2. Thông tin config: dashboard type, scope, role/user/company.
3. Danh sách widget config dạng table.
4. Select size: small/medium/large/full.
5. Input order.
6. Switch active/inactive.
7. Save/cancel.
8. Dirty form guard.

---

## 21. State handling

### 21.1 Page-level states

| State | Khi nào | Component |
| --- | --- | --- |
| Loading | Đang load dashboard | `DashboardLoadingState` |
| Error | API lỗi toàn trang | `DashboardErrorState` |
| Forbidden | 403 hoặc thiếu permission route | `DashboardForbiddenState` |
| Empty | Không có dashboard/widget phù hợp | `DashboardEmptyState` |
| Refreshing | Refetch dashboard | Soft loading trên refresh button |
| Stale | Dữ liệu quá TTL | Badge trong header/widget |

### 21.2 Widget-level states

| State | UI |
| --- | --- |
| Loading | Skeleton trong widget card |
| Empty | EmptyState nhỏ, có CTA nếu phù hợp |
| Error | ErrorState nhỏ, có retry nếu retryable |
| Degraded | Cảnh báo nhỏ, vẫn hiển thị dữ liệu fallback nếu có |
| Stale | Badge `Dữ liệu có thể chưa mới` + last updated |
| Hidden | Không render |
| Inactive | Không render ở dashboard, chỉ hiển thị trong config |

### 21.3 Error mapper dùng chung

```tsx
export function DashboardErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const uiError = mapApiErrorToUi(error);

  if (uiError.kind === 'FORBIDDEN') {
    return <ForbiddenState title="Bạn không có quyền xem dashboard này" />;
  }

  return (
    <ErrorState
      title="Không thể tải Dashboard"
      description={uiError.message}
      requestId={uiError.requestId}
      action={onRetry ? { label: 'Thử lại', onClick: onRetry } : undefined}
    />
  );
}
```

---

## 22. Lazy load widget

### 22.1 Hai chiến lược MVP

| Chiến lược | Cách làm | Ưu điểm | Nhược điểm |
| --- | --- | --- | --- |
| Load dashboard full | `/dashboard/{type}` trả toàn bộ widget data | Đơn giản, ít request | Widget nặng có thể chậm |
| Lazy load widget | Dashboard trả config, từng widget gọi `/widgets/{slug}` | Linh hoạt, fallback tốt | Nhiều request hơn |

Khuyến nghị MVP:

1. P0 dashboard dùng `GET /dashboard/{type}` trả widget data cơ bản.
2. Widget nặng hoặc chart dùng lazy load riêng.
3. Refresh widget riêng dùng `useDashboardWidget`.
4. Nếu widget lỗi, không làm hỏng toàn dashboard.

### 22.2 `LazyDashboardWidget`

```tsx
export function LazyDashboardWidget({ widget }: { widget: DashboardWidgetVM }) {
  const slug = widgetCodeToSlug(widget.widgetCode);
  const shouldLazyLoad = widget.status === 'Active' && widget.data === null;

  const query = useDashboardWidget(slug, undefined, { enabled: shouldLazyLoad });

  if (!shouldLazyLoad) return <DashboardWidgetCard widget={widget} />;
  if (query.isLoading) return <WidgetLoadingState />;
  if (query.isError) return <WidgetErrorState error={query.error} onRetry={query.refetch} />;

  return <DashboardWidgetCard widget={query.data ?? widget} />;
}
```

---

## 23. Cache và invalidation

### 23.1 Query stale time đề xuất

| Query | staleTime | Ghi chú |
| --- | ---: | --- |
| `dashboard.me` | 30 giây | Dữ liệu tổng hợp cá nhân |
| `dashboard.byType` | 30-60 giây | Tùy dashboard type |
| `dashboard.types` | 60 giây - 5 phút | Ít thay đổi |
| `dashboard.widgets.detail` | 30-60 giây | Tùy widget |
| `dashboard.configs.list` | 60 giây | Admin config |
| `dashboard.config.detail` | 60 giây | Invalidate sau update |

### 23.2 Invalidation sau mutation module nguồn

Khi các module sau có mutation thành công, nên invalidate dashboard liên quan:

| Mutation | Invalidate |
| --- | --- |
| ATT check-in/check-out | `dashboardKeys.all`, `attendanceKeys.today()` |
| LEAVE create/submit/approve/reject | `dashboardKeys.all`, `leaveKeys.requests`, `leaveKeys.balances` |
| TASK update status/comment/assign | `dashboardKeys.all`, `taskKeys.*` liên quan |
| NOTI mark read | `dashboardKeys.widgets.detail('notifications')`, `notificationKeys.unreadCount()` |
| HR create/update employee/contract | `dashboardKeys.byType('HR')`, HR keys liên quan |
| AUTH user lock/unlock/create | `dashboardKeys.byType('Admin')`, auth keys liên quan |

### 23.3 Refresh button behavior

1. Refresh toàn dashboard: invalidate query dashboard hiện tại.
2. Refresh widget: invalidate query widget riêng nếu lazy; nếu full dashboard thì refetch dashboard hiện tại.
3. Hiển thị soft loading, không xóa toàn bộ UI cũ ngay.
4. Nếu refresh lỗi, giữ dữ liệu cũ và hiển thị toast/error nhỏ.

---

## 24. Permission behavior

### 24.1 Route permission

Route guard xử lý quyền vào dashboard type:

```ts
canAccessRoute('/dashboard/hr')
  -> requires DASH.DASHBOARD.VIEW_HR
```

Nếu user không có quyền:

1. Direct URL: hiển thị 403 hoặc redirect dashboard mặc định nếu phù hợp.
2. Sidebar: không hiển thị item.
3. Type switcher: không hiển thị option.

### 24.2 Widget permission

Widget có permission riêng:

```ts
DASH.WIDGET.VIEW_PENDING_LEAVE
```

Frontend behavior:

1. Nếu backend không trả widget: không render.
2. Nếu backend trả status Hidden: không render.
3. Nếu backend trả Error/Forbidden: render widget error nếu policy cần minh bạch.
4. Không tự thêm widget chỉ vì user có route permission.

### 24.3 Quick action permission

Quick action phải xét cả:

1. Permission DASH nếu action thuộc dashboard.
2. Permission module nguồn nếu action xử lý nghiệp vụ.
3. Business rule do backend trả về.

Ví dụ:

```text
User có DASH.WIDGET.VIEW_PENDING_LEAVE
nhưng không có LEAVE.REQUEST.APPROVE
-> Widget có thể hiển thị danh sách nếu được phép xem
-> Nút Approve không hiển thị hoặc disabled
```

### 24.4 Empty due to scope

Nếu user có quyền nhưng scope không có dữ liệu:

```text
Bạn chưa có dữ liệu trong phạm vi được phân quyền.
```

Không nên hiển thị:

```text
Bạn không có quyền.
```

Vì đây là hai trạng thái khác nhau.

---

## 25. Responsive implementation

### 25.1 Desktop

| Khu vực | Behavior |
| --- | --- |
| Header | Type switcher, scope, refresh, configure cùng hàng |
| Quick actions | Horizontal group, wrap nếu nhiều |
| Widget grid | 12 cột |
| List widget | Hiển thị 5-7 item |
| Chart placeholder | Có thể dùng medium/large card |

### 25.2 Tablet

| Khu vực | Behavior |
| --- | --- |
| Header | Actions wrap xuống dòng |
| Widget grid | 2 cột hoặc full width theo size |
| Quick actions | Wrap 2 hàng |
| Sidebar | Có thể collapsed theo layout chung |

### 25.3 Mobile web

| Khu vực | Behavior |
| --- | --- |
| Header | Title + type switcher + refresh gọn |
| Quick actions | Horizontal scroll hoặc sticky section |
| Widget grid | 1 cột |
| List widget | Card list, tối đa 3-5 item |
| Config page | Có thể dùng stacked form/table card |

### 25.4 CSS grid mẫu

```tsx
<div className="grid grid-cols-12 gap-4">
  <div className="col-span-12 md:col-span-6 xl:col-span-3">Metric</div>
  <div className="col-span-12 xl:col-span-6">List</div>
  <div className="col-span-12 xl:col-span-8">Chart</div>
</div>
```

---

## 26. Accessibility

### 26.1 Checklist accessibility Dashboard

| Thành phần | Yêu cầu |
| --- | --- |
| Dashboard type switcher | Có label rõ, keyboard accessible |
| Quick action | Button/link có accessible name |
| Widget card | Heading hierarchy hợp lý |
| Metric | Screen reader đọc được label + value + unit |
| Chart | Có text summary, không chỉ dựa vào hình |
| Badge màu | Có text, không chỉ dùng màu |
| Error state | Có message rõ, request id nếu có |
| Refresh | Loading state được thông báo bằng aria-busy nếu cần |
| Mobile action | Touch target tối thiểu 44px |

### 26.2 Heading structure

```text
h1: Dashboard title
h2: Quick actions / Alert section / Widget section nếu cần
h3: Widget title
```

### 26.3 Loading và busy state

Widget đang refresh nên có:

```tsx
<section aria-busy={isRefreshing} aria-live="polite">
  ...
</section>
```

---

## 27. Mock data và MSW

### 27.1 Mục tiêu mock

Mock giúp frontend triển khai trước khi backend hoàn thiện API-08.

Cần mock:

1. Dashboard Employee.
2. Dashboard Manager.
3. Dashboard HR.
4. Dashboard Admin.
5. Widget success.
6. Widget empty.
7. Widget error.
8. Widget degraded.
9. Permission hidden widget.
10. Config list/edit.

### 27.2 Mock handler mẫu

```ts
import { http, HttpResponse } from 'msw';

export const dashboardHandlers = [
  http.get('/api/v1/dashboard/me', () => {
    return HttpResponse.json({
      success: true,
      message: 'Lấy dữ liệu thành công',
      data: mockEmployeeDashboard,
      meta: createMockMeta(),
    });
  }),

  http.get('/api/v1/dashboard/employee', () => {
    return HttpResponse.json({
      success: true,
      message: 'Lấy dữ liệu thành công',
      data: mockEmployeeDashboard,
      meta: createMockMeta(),
    });
  }),

  http.get('/api/v1/dashboard/hr', () => {
    return HttpResponse.json({
      success: true,
      message: 'Lấy dữ liệu thành công',
      data: mockHrDashboard,
      meta: createMockMeta(),
    });
  }),
];
```

---

## 28. Test plan

### 28.1 Unit test

| Nhóm | Test |
| --- | --- |
| Mapper | Map DTO snake_case sang VM camelCase đúng |
| Widget grid | Sort theo order, ẩn Hidden/Inactive |
| Widget class | size -> grid class đúng |
| Type switcher | Chỉ hiển thị available types |
| Quick action | NAVIGATE/API_CALL/OPEN_MODAL xử lý đúng |
| Permission | Widget/action thiếu quyền không render hoặc disabled đúng |
| Error mapper | 403/500/network map đúng UI state |

### 28.2 Component test

| Component | Test |
| --- | --- |
| DashboardPage | Loading, success, error, empty |
| DashboardHeader | Render title, scope, refresh, configure |
| DashboardQuickActions | Render action enabled/disabled |
| DashboardWidgetGrid | Render đúng số widget visible |
| DashboardWidgetCard | Render loading/empty/error/degraded |
| AttendanceTodayWidget | Render trạng thái check-in/out/leave |
| PendingLeaveWidget | Render list và CTA |
| NotificationsWidget | Render unread count và item |

### 28.3 Integration test

| Flow | Kỳ vọng |
| --- | --- |
| Vào `/dashboard` | Gọi dashboard me, render default dashboard hoặc redirect đúng |
| Đổi dashboard type | URL đổi, dashboard mới được load |
| Refresh dashboard | Query refetch, UI không mất dữ liệu cũ nếu lỗi |
| Click quick action navigate | Điều hướng sang module gốc |
| Widget lỗi nguồn | Chỉ widget đó error/degraded, dashboard vẫn hoạt động |
| User thiếu quyền | Route guard hoặc forbidden state đúng |

### 28.4 E2E test MVP

| Mã | Scenario |
| --- | --- |
| FE07-E2E-001 | Employee login -> Home -> Dashboard -> thấy Attendance, My Tasks, Leave Balance |
| FE07-E2E-002 | Manager login -> Dashboard Manager -> thấy Pending Leave và Team Tasks nếu có quyền |
| FE07-E2E-003 | HR login -> Dashboard HR -> thấy HR Overview, Contract Expiring, Attendance Alerts |
| FE07-E2E-004 | Admin login -> Dashboard Admin -> thấy User Summary, Module Status, Config Warnings |
| FE07-E2E-005 | User direct URL `/dashboard/hr` không có quyền -> 403 hoặc redirect an toàn |
| FE07-E2E-006 | Click notification widget item -> đi qua route guard sang target module |
| FE07-E2E-007 | Mobile viewport -> widget stack 1 cột và quick actions dùng được |

---

## 29. Performance

### 29.1 Rủi ro hiệu năng

| Rủi ro | Cách giảm |
| --- | --- |
| Dashboard load quá nhiều widget | Backend trả widget theo quyền, frontend lazy load widget nặng |
| Nhiều request widget cùng lúc | Group widget cơ bản trong `/dashboard/{type}`, lazy load có limit |
| Re-render toàn dashboard | Memo widget renderer, stable query data, key rõ ràng |
| Chart nặng | Chart placeholder MVP hoặc lazy import chart lib |
| Refresh liên tục | Debounce refresh, disable button khi đang refetch |
| Mobile chậm | Giảm item limit, dùng compact view |

### 29.2 Lazy import widget nặng

```tsx
const ProjectProgressWidget = lazy(() => import('./widgets/ProjectProgressWidget'));
const HrOverviewWidget = lazy(() => import('./widgets/HrOverviewWidget'));
```

Dùng `Suspense` trong renderer:

```tsx
<Suspense fallback={<WidgetLoadingState />}>
  <Component widget={widget} />
</Suspense>
```

### 29.3 Item limit trong widget list

| Widget | Limit MVP |
| --- | ---: |
| My Tasks | 5 |
| Pending Leave | 5 |
| Notifications | 5 |
| Attendance Alerts | 5 |
| Contract Expiring | 5 |
| New Employees | 5 |
| System Logs | 5 |

---

## 30. Security checklist

| Rủi ro | Yêu cầu frontend |
| --- | --- |
| Lộ widget trái quyền | Không hard-code widget; render theo backend + permission guard |
| Direct URL trái quyền | Route guard bắt buộc |
| Quick action bypass module gốc | Action phải điều hướng/gọi API module gốc |
| Cache user cũ sau logout | Clear dashboard query cache khi logout |
| Dữ liệu nhạy cảm trong localStorage | Không persist dashboard data nhạy cảm |
| Log API chứa dữ liệu nhạy cảm | Không console.log response production |
| Widget degraded làm hiểu sai dữ liệu | Hiển thị last updated/last success rõ |
| Frontend tự gửi company_id/user_id | Không gửi nếu backend tự resolve được |

---

## 31. Implementation phases

### Phase FE07-1: Route + shell

1. Tạo module folder `modules/dashboard`.
2. Khai báo route metadata.
3. Khai báo sidebar DASH.
4. Tạo page skeleton cho `/dashboard`, `/dashboard/employee`, `/dashboard/manager`, `/dashboard/hr`, `/dashboard/admin`.
5. Tích hợp `ModuleWorkspaceLayout`.
6. Thêm permission guard route.

### Phase FE07-2: API service + query hooks

1. Tạo `dashboard.api.ts`.
2. Tạo `dashboard.keys.ts`.
3. Tạo hooks: `useDashboardMe`, `useDashboardTypes`, `useDashboardByType`, `useDashboardWidget`.
4. Tạo mock data + MSW.
5. Test query hook cơ bản.

### Phase FE07-3: Component foundation

1. `DashboardPage`.
2. `DashboardHeader`.
3. `DashboardTypeSwitcher`.
4. `DashboardScopeBadge`.
5. `DashboardQuickActions`.
6. `DashboardWidgetGrid`.
7. `DashboardWidgetCard`.
8. Widget state components.

### Phase FE07-4: MVP widgets

Ưu tiên implement widget theo thứ tự:

1. `ATTENDANCE_TODAY`.
2. `MY_TASKS`.
3. `LEAVE_BALANCE`.
4. `PENDING_LEAVE`.
5. `NOTIFICATIONS`.
6. `TASK_ALERTS`.
7. `HR_OVERVIEW`.
8. `ATTENDANCE_ALERTS`.
9. `CONTRACT_EXPIRING`.
10. `PROJECT_PROGRESS`.
11. Admin/System widgets.

### Phase FE07-5: Config UI MVP

1. Widget catalog page.
2. Dashboard config list.
3. Dashboard config edit.
4. Update config mutation.
5. Dirty form guard.
6. Permission guard `DASH.CONFIG.VIEW/UPDATE`.

### Phase FE07-6: QA + polish

1. Responsive test.
2. Accessibility test.
3. Permission matrix test.
4. E2E smoke test.
5. Error/degraded state test.
6. Performance check.

---

## 32. Acceptance criteria

| Mã | Tiêu chí nghiệm thu |
| --- | --- |
| FE07-AC-001 | Có đầy đủ route Dashboard: default, employee, manager, HR, admin |
| FE07-AC-002 | Dashboard chạy trong Module Workspace Layout và sidebar DASH |
| FE07-AC-003 | Route guard kiểm tra permission theo route metadata |
| FE07-AC-004 | Type switcher chỉ hiển thị dashboard type user được phép xem |
| FE07-AC-005 | Dashboard dùng API service và TanStack Query, không gọi fetch trực tiếp trong component |
| FE07-AC-006 | Widget grid responsive đúng desktop/tablet/mobile |
| FE07-AC-007 | Widget render theo backend config, permission và status |
| FE07-AC-008 | Có state loading, empty, error, degraded, stale, forbidden |
| FE07-AC-009 | Quick action không bypass module gốc |
| FE07-AC-010 | Refresh dashboard/widget hoạt động và không làm mất dữ liệu cũ khi lỗi |
| FE07-AC-011 | Employee Dashboard có Attendance, My Tasks, Leave Balance, Notifications ở mức MVP |
| FE07-AC-012 | Manager Dashboard có Pending Leave, Team Tasks/Task Alerts, Attendance Alerts ở mức MVP |
| FE07-AC-013 | HR Dashboard có HR Overview, Contract Expiring, Attendance Alerts, Pending Leave ở mức MVP |
| FE07-AC-014 | Admin Dashboard có User Summary, Module Status, Config Warnings ở mức MVP |
| FE07-AC-015 | Dashboard Config UI có list/edit cơ bản nếu user có quyền |
| FE07-AC-016 | Mock API/MSW đủ để chạy frontend khi backend chưa hoàn thiện |
| FE07-AC-017 | Có unit/component/integration test cho phần chính |
| FE07-AC-018 | Mobile web không vỡ layout, widget stack 1 cột |
| FE07-AC-019 | Accessibility cơ bản đạt: keyboard, focus visible, aria-label, text cho metric/chart |
| FE07-AC-020 | Clear cache Dashboard khi logout hoặc đổi user |

---

## 33. Definition of Done cho FRONTEND-07

FRONTEND-07 được xem là hoàn thành khi:

1. Tất cả route Dashboard MVP hoạt động.
2. Dashboard route được đăng ký trong app registry/sidebar registry.
3. User thiếu quyền không thấy menu hoặc bị chặn khi direct URL.
4. Dashboard default resolve đúng theo API `/dashboard/me` hoặc redirect sang dashboard type phù hợp.
5. Employee/Manager/HR/Admin Dashboard render được với mock API hoặc API thật.
6. Widget grid dùng responsive layout chuẩn.
7. Các widget P0 có UI hoàn chỉnh: Attendance Today, My Tasks, Leave Balance, Pending Leave, Notifications.
8. Widget P1 có skeleton/render cơ bản: Task Alerts, HR Overview, Attendance Alerts, Contract Expiring, Project Progress, Admin widgets.
9. Widget state đầy đủ: loading, empty, error, degraded, stale.
10. Quick action điều hướng hoặc gọi đúng API module nguồn.
11. Dashboard Config list/edit cơ bản có permission guard.
12. Không có `fetch` trực tiếp trong component Dashboard.
13. Không hard-code role name để hiển thị dashboard/widget/action.
14. Query keys ổn định và có invalidation rule.
15. Mock data đủ các dashboard type và state.
16. Có test cho mapper, widget grid, quick action, route guard và dashboard render.
17. Responsive desktop/tablet/mobile đã kiểm thử.
18. Accessibility cơ bản đã kiểm thử.
19. Security checklist đã review.
20. Các open questions còn lại được ghi rõ để xử lý ở FRONTEND-08+ hoặc backend/API.

---

## 34. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| FE07-OQ-001 | `/api/v1/dashboard/me` sẽ trả full dashboard data hay chỉ trả default type để frontend redirect? | BE/FE | Cao |
| FE07-OQ-002 | Quick action check-in/out trên Dashboard có gọi trực tiếp ATT API hay chỉ điều hướng sang `/attendance/today`? | Product/BE/FE | Cao |
| FE07-OQ-003 | Approve/reject leave nhanh trên Dashboard có nằm trong MVP không? | Product/HR/FE | Trung bình |
| FE07-OQ-004 | Widget catalog/config API đã có đủ để edit order/size/status chưa? | BE/FE | Trung bình |
| FE07-OQ-005 | Widget nào lazy load riêng, widget nào trả chung trong dashboard response? | BE/FE | Trung bình |
| FE07-OQ-006 | Có cần polling notification/dashboard widget trong MVP không? | Product/BE/FE | Thấp |
| FE07-OQ-007 | Chart library dùng gì nếu triển khai chart thật trong MVP? | FE/UI | Thấp |
| FE07-OQ-008 | Dashboard user preference lưu ở backend hay local preference trước? | Product/BE/FE | Thấp |

---

## 35. Kết luận

FRONTEND-07 chốt cách triển khai Dashboard Frontend theo hướng:

```text
Dashboard là module tổng hợp
-> Chạy trong Module Workspace
-> Render theo dashboard type và permission
-> Widget hóa toàn bộ dữ liệu
-> Quick action điều hướng/gọi module gốc
-> API/query/cache/error state thống nhất
-> Responsive và accessible
-> Không thay thế nghiệp vụ nguồn
```

Sau FRONTEND-07, đội frontend có thể tiếp tục triển khai các module nghiệp vụ nguồn mà Dashboard đang liên kết:

```text
FRONTEND-08: HR Frontend
FRONTEND-09: Attendance Frontend
FRONTEND-10: Leave Frontend
FRONTEND-11: Task Frontend
FRONTEND-12: Notification Frontend
```
