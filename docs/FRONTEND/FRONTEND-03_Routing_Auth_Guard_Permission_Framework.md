> ⚠️ **ĐÍNH CHÍNH STACK (bắt buộc) — đọc trước:** Tài liệu này có thể còn nhắc Next.js/Prisma (lỗi thời). Stack đã CHỐT: **Vite + React 19 SPA + TanStack Router (KHÔNG Next.js)** · **Drizzle (KHÔNG Prisma)** · **Valkey** · **Vitest**. Các token an toàn đã thay inline; phần khái niệm lấy [DECISIONS-02](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md) làm chuẩn.

# FRONTEND-03: ROUTING, AUTH GUARD & PERMISSION FRAMEWORK

> **📚 Bộ tài liệu FRONTEND — Hệ thống Quản lý Doanh nghiệp**
> [FRONTEND-01 Kiến trúc & Setup](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [FRONTEND-02 Design System](<FRONTEND-02_Design_System_Implementation.md>) · **FRONTEND-03 Routing/Auth/Permission** · [FRONTEND-04 API Client](<FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · [FRONTEND-05 Layout](<FRONTEND-05_Layout_Implementation.md>) · [FRONTEND-06 AUTH/Account](<FRONTEND-06_AUTH_Account_Frontend.md>) · [FRONTEND-07 Dashboard](<FRONTEND-07_Dashboard_Frontend.md>) · [FRONTEND-08 HR](<FRONTEND-08_HR_Frontend.md>) · [FRONTEND-09 Attendance](<FRONTEND-09_Attendance_Frontend.md>) · [FRONTEND-10 Leave](<FRONTEND-10_Leave_Frontend.md>) · [FRONTEND-11 Task](<FRONTEND-11_Task_Frontend.md>) · [FRONTEND-12 Notification](<FRONTEND-12_Notification_Frontend.md>) · [FRONTEND-13 System/Foundation](<FRONTEND-13_System_Foundation_Frontend.md>) · [FRONTEND-14 QA & Release](<FRONTEND-14_QA_Performance_Release_Readiness.md>)
>
> **Liên quan:** [Sitemap & route: UI-02](<../UI/UI-02_Information_Architecture_Sitemap.md>) · [Permission matrix: API-10](<../API Design/API-10 PERMISSION MATRIX.md>) · [AUTH API: API-02](<../API Design/API-02 AUTH API Design.md>) · [Chuẩn API & 401/403: API-01](<../API Design/API-01 TỔNG QUAN.md>) · [Kiến trúc FE: FRONTEND-01](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | FRONTEND-03 |
| Tên tài liệu | Routing, Auth Guard & Permission Framework |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Frontend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01, FRONTEND-02 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

FRONTEND-03 mô tả cách triển khai lớp **routing**, **authentication guard** và **permission framework** cho frontend của hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chốt route structure cho public route, protected route, Home Portal và Module Workspace.
2. Chốt cách boot session sau khi app load hoặc user login.
3. Chốt cách kiểm tra user đã đăng nhập hay chưa trước khi vào protected route.
4. Chốt cách kiểm tra permission và data scope khi user truy cập route trực tiếp.
5. Chốt cách lọc app, menu, sidebar item, tab, button, widget và field theo permission.
6. Chốt cách xử lý token expired, refresh token, logout và redirect return URL.
7. Chốt cách xử lý trạng thái 401, 403, 404, module disabled, feature flag off và empty due to scope.
8. Chốt route metadata, app registry, sidebar registry và action registry.
9. Tạo code skeleton TypeScript để frontend team bắt đầu triển khai.
10. Làm nền cho FRONTEND-04, FRONTEND-05 và các module frontend nghiệp vụ.

---

## 3. Vị trí FRONTEND-03 trong roadmap frontend

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

FRONTEND-03 là lớp nền bắt buộc trước khi đi sâu vào Home Portal, App Switcher, Module Workspace và màn hình nghiệp vụ.

---

## 4. Căn cứ triển khai

FRONTEND-03 bám theo các quyết định đã chốt:

1. Sau đăng nhập, user vào **Home Portal** trước, không đi thẳng vào dashboard nghiệp vụ.
2. Từ Home Portal, user chọn app/module để vào **Module Workspace**.
3. Trong mọi màn protected, user có thể mở **App Switcher**.
4. Module Workspace dùng sidebar riêng theo module và topbar chung toàn hệ thống.
5. Frontend được phép ẩn/hiện UI để cải thiện trải nghiệm, nhưng backend vẫn là lớp kiểm tra quyền cuối cùng.
6. App, menu, route, button, field, widget, badge và counter phải hiển thị theo permission và data scope.
7. Menu không được hard-code theo role name. Role chỉ là seed mặc định; permission và data scope mới là nguồn kiểm tra chính.
8. Direct URL trái quyền phải bị chặn bằng route guard ở frontend và backend guard ở API.
9. Dashboard, Home Portal và App Switcher chỉ tổng hợp/điều hướng, không xử lý nghiệp vụ gốc.
10. Notification deep link và Dashboard quick action phải điều hướng sang module gốc để module đó kiểm tra permission, data scope và business rule lại.
11. Component permission UI đã được FRONTEND-02 định hướng gồm `PermissionGate`, `ForbiddenState`, `DisabledActionTooltip` và `MaskedField`.
12. Backend API theo API-01 là nguồn xác thực và phân quyền cuối cùng.

---

## 5. Phạm vi FRONTEND-03

### 5.1 Bao gồm

| Nhóm | Nội dung |
| --- | --- |
| Route architecture | Public route, protected route, route group, route metadata, error route |
| Auth bootstrap | Load current user, company, employee, roles, permissions, data scopes, active modules |
| Auth guard | Chặn protected route khi chưa login, token hết hạn, account inactive |
| Permission guard | Kiểm tra route permission, any/all permission, required scope, module status, feature flag |
| Permission utility | `can`, `canAny`, `canAll`, `hasScope`, `getScopes`, `canAccessRoute`, `canSeeAction` |
| Data scope utility | Own, Team, Department, Project, Company, System; check scope theo hierarchy chuẩn (scope rộng hơn thỏa scope hẹp hơn), `Project` khớp tường minh |
| App registry | Registry cho Home Portal và App Switcher |
| Sidebar registry | Registry menu theo module, lọc theo permission |
| Action registry | Registry action/button/quick action theo permission và business state |
| Field guard | Mask/disable/hide field nhạy cảm theo permission |
| Redirect strategy | Login redirect, return URL, forbidden redirect, default app redirect |
| Error state | 401, 403, 404, 409, 422, 500, module disabled, feature off |
| Dirty form guard | Chặn đổi route/app khi form chưa lưu |
| Test checklist | Unit test permission utility, component guard, E2E route guard |

### 5.2 Không bao gồm

| Nội dung | Chuyển sang |
| --- | --- |
| API client/interceptor chi tiết | FRONTEND-04 |
| Layout visual hoàn chỉnh | FRONTEND-05 |
| Login form, forgot/reset password chi tiết | FRONTEND-06 |
| Home Portal/App Switcher UI hoàn chỉnh | FRONTEND-05 hoặc FRONTEND-04 theo roadmap thực tế |
| Dashboard widget tích hợp API | FRONTEND-07 |
| HR/ATT/LEAVE/TASK/NOTI screen | FRONTEND-08 -> FRONTEND-12 |
| Backend permission enforcement | Backend/API |
| Role/permission admin CRUD chi tiết | FRONTEND-06 / System module |

---

## 6. Nguyên tắc thiết kế quan trọng

### 6.1 Frontend guard không thay thế backend guard

Frontend guard chỉ giúp:

1. Ẩn menu không phù hợp.
2. Tránh user đi vào màn không có quyền.
3. Hiển thị trạng thái forbidden rõ ràng.
4. Cải thiện UX khi token hết hạn.
5. Giảm thao tác lỗi.

Backend vẫn bắt buộc kiểm tra:

1. Authentication.
2. User status.
3. Company/tenant status.
4. Permission.
5. Data scope.
6. Business rule.
7. Audit log.
8. Notification event.

### 6.2 Không hard-code role

Không viết:

```ts
if (user.role === 'HR') {
  showEmployeeCreateButton();
}
```

Phải viết:

```ts
if (permission.can('HR.EMPLOYEE.CREATE')) {
  showEmployeeCreateButton();
}
```

Lý do:

1. Một user có thể có nhiều role.
2. Role có thể được admin đổi quyền.
3. Một role có thể có nhiều data scope.
4. Phase sau có thể có custom role theo từng công ty.

### 6.3 Route theo metadata

Không để route chỉ là file path. Mỗi route phải có metadata để guard, sidebar, breadcrumb, title, screen code và QA cùng dùng chung.

### 6.4 Permission đi kèm data scope

Ví dụ user có:

```text
LEAVE.REQUEST.APPROVE + Team
```

User có thể thấy màn duyệt đơn nghỉ, nhưng dữ liệu backend trả về chỉ nên nằm trong phạm vi team. Frontend được phép hiển thị menu `Đơn cần duyệt`, nhưng không được tự suy luận dữ liệu ngoài phạm vi backend trả về.

### 6.5 Business rule khác permission

Có permission không có nghĩa action luôn khả dụng.

Ví dụ:

| Trường hợp | Permission | Business rule | UI behavior |
| --- | --- | --- | --- |
| Employee có quyền check-in | Có | Hôm nay đã có đơn nghỉ full-day approved | Disable check-in + tooltip |
| Manager có quyền approve leave | Có | Đơn đã được HR xử lý trước | Disable approve + hiển thị trạng thái mới |
| User có quyền update task | Có | Task đã Done/Cancelled | Disable một số field/action |

---

## 7. Auth context chuẩn

### 7.1 Auth context cần có gì

Frontend cần một `AuthContext` hoặc `SessionStore` chứa tối thiểu:

```ts
export type AuthStatus =
  | 'unknown'
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'
  | 'expired'
  | 'forbidden';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  status: 'Active' | 'Inactive' | 'Locked' | 'Pending Activation';
  companyId: string;
  employeeId?: string | null;
  roles: AuthRole[];
  permissions: UserPermission[];
}

export interface AuthRole {
  id: string;
  code: string;
  name: string;
}

export type DataScope =
  | 'Own'
  | 'Team'
  | 'Department'
  | 'Project'
  | 'Company'
  | 'System';

export interface UserPermission {
  permission: string;
  scopes: DataScope[];
}

export interface CompanyContext {
  id: string;
  name: string;
  code?: string;
  status: 'Active' | 'Inactive' | 'Suspended';
}

export interface ModuleAccessItem {
  moduleCode: ModuleCode;
  status: 'active' | 'locked' | 'coming_soon' | 'maintenance' | 'hidden';
  featureFlags?: Record<string, boolean>;
}

export interface SessionContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  company: CompanyContext | null;
  modules: ModuleAccessItem[];
  loadedAt?: string;
}
```

### 7.2 Endpoint bootstrap đề xuất

Khi frontend load protected area, cần gọi endpoint tương đương:

```http
GET /api/v1/auth/me
```

`/auth/me` là **payload đầy đủ trong một call** (khớp API-02 AUTH-API-050 + BACKEND-03 §15.2): trả `user`, `company`, `employee`, `roles`, `permissions`, `modules`, `session`. Frontend dùng trực tiếp payload này để bootstrap session và build permission checker, không cần gọi thêm `/auth/me/permissions`. `/auth/me/permissions` và `/auth/me/menu` chỉ là endpoint granular bổ trợ.

Response nên có:

```ts
export interface AuthMeResponse {
  user: AuthUser;                 // gồm roles + permissions (mỗi permission có scopes: DataScope[])
  company: CompanyContext;
  employee?: {
    id: string;
    employeeCode: string;
    fullName: string;
    departmentId?: string | null;
    directManagerId?: string | null;
    employmentStatus: string;
  } | null;
  roles: AuthRole[];              // payload đầy đủ trả roles ở top-level (mirror của user.roles)
  permissions: UserPermission[];  // payload đầy đủ trả permissions ở top-level; mỗi item dùng scopes: DataScope[]
  modules: ModuleAccessItem[];
  session: {
    id: string;
    expiresAt: string;
  };
  settings?: {
    locale?: string;
    timezone?: string;
    dateFormat?: string;
  };
}
```

> **Scope shape:** mỗi permission luôn dùng `scopes: DataScope[]` (mảng hợp scope), KHÔNG phải `data_scope` số ít. `data_scope` số ít chỉ tồn tại ở từng row `role_permissions` phía backend.

### 7.3 Auth bootstrap flow

```text
App load
  -> Nếu route public
     -> Không bắt buộc load session ngay
     -> Nếu đã authenticated và vào /login, redirect /home

  -> Nếu route protected
     -> Load session từ /auth/me
     -> Nếu success và user active
        -> Lưu auth context
        -> Build permission checker
        -> Check route metadata
        -> Render page
     -> Nếu 401
        -> Thử refresh token một lần
        -> Nếu refresh success: gọi lại /auth/me
        -> Nếu refresh fail: redirect /login?returnUrl=<current_url>
     -> Nếu 403/account locked/company inactive
        -> Render forbidden/account locked state
```

### 7.4 Login success flow

```text
User submit login
  -> POST /api/v1/auth/login
  -> Backend set refresh cookie hoặc trả token theo strategy
  -> Frontend gọi /api/v1/auth/me
  -> Lưu auth context
  -> Prefetch app registry/sidebar registry nếu cần
  -> Redirect returnUrl nếu hợp lệ và user có quyền
  -> Nếu không có returnUrl: redirect /home
```

### 7.5 Logout flow

```text
User click logout
  -> POST /api/v1/auth/logout
  -> Clear auth context
  -> Clear sensitive query cache
  -> Clear app/sidebar/action cache theo user
  -> Redirect /login
```

---

## 8. Token strategy phía frontend

### 8.1 Khuyến nghị MVP

| Thành phần | Khuyến nghị |
| --- | --- |
| Access token | HttpOnly cookie hoặc memory-only nếu backend chưa hỗ trợ cookie |
| Refresh token | HttpOnly Secure SameSite cookie |
| Token trong localStorage | Không khuyến nghị |
| Token trong sessionStorage | Chỉ dùng tạm ở môi trường dev nếu bắt buộc |
| CSRF | Cần cân nhắc nếu dùng cookie auth |

### 8.2 Nguyên tắc refresh token

Khi API trả 401:

```text
API request -> 401
  -> Nếu chưa retry
     -> Gọi refresh token
     -> Refresh success: replay request
     -> Refresh fail: logout + redirect login
  -> Nếu đã retry
     -> logout + redirect login
```

Cần có refresh lock để tránh nhiều request cùng refresh:

```ts
let refreshPromise: Promise<boolean> | null = null;

export async function refreshSessionOnce() {
  if (!refreshPromise) {
    refreshPromise = refreshSession()
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}
```

### 8.3 Không lưu dữ liệu nhạy cảm quá lâu

Frontend không nên persist toàn bộ permission/user profile nhạy cảm vào localStorage. Khuyến nghị:

1. Auth context ở memory.
2. Query cache clear khi logout.
3. Persist nhẹ các preference không nhạy cảm như theme, sidebar collapsed, recent app.
4. Không persist access token nếu có thể dùng cookie hoặc memory strategy.

---

## 9. Permission model frontend

### 9.1 Permission format

Permission dùng format:

```text
MODULE.RESOURCE.ACTION
```

Ví dụ:

```text
AUTH.USER.VIEW
AUTH.ROLE.UPDATE
HR.EMPLOYEE.VIEW
HR.EMPLOYEE.CREATE
ATT.ATTENDANCE.CHECK_IN
ATT.ATTENDANCE.VIEW_TEAM
LEAVE.REQUEST.CREATE
LEAVE.REQUEST.APPROVE
TASK.TASK.UPDATE_STATUS
DASH.DASHBOARD.VIEW
NOTI.NOTIFICATION.VIEW_OWN
FOUNDATION.AUDIT_LOG.VIEW
```

### 9.2 Data scope

| Scope | Ý nghĩa UI |
| --- | --- |
| Own | Dữ liệu của chính user/employee |
| Team | Dữ liệu team do user quản lý |
| Department | Dữ liệu phòng ban |
| Project | Dữ liệu dự án liên quan |
| Company | Dữ liệu toàn công ty/tenant |
| System | Dữ liệu cấp hệ thống hoặc liên công ty nếu có |

### 9.3 Data scope hierarchy chuẩn

Theo API-10 §3 (nhắc lại API-01 §7.2), data scope tuyến tính tuân theo chuỗi bao hàm:

```text
Own ⊂ Team ⊂ Department ⊂ Company ⊂ System
```

Scope rộng hơn bao trùm mọi scope hẹp hơn. Vì vậy nếu user giữ permission ở scope rộng hơn scope mà route/action yêu cầu, user vẫn thỏa điều kiện scope đó. Quy ước thứ hạng:

```text
Own(0) < Team(1) < Department(2) < Company(3) < System(4)
```

Frontend nên dùng nguyên tắc:

```text
Route/action yêu cầu scope nào -> user thỏa nếu giữ permission ở đúng scope đó HOẶC ở bất kỳ scope rộng hơn trong chuỗi (rank(userScope) >= rank(requiredScope))
```

`Project` là scope **ngang** (theo membership dự án), không nằm trong chuỗi tuyến tính trên. Vì vậy `Project` phải được khớp **tường minh**: user chỉ thỏa yêu cầu `Project` khi giữ đúng scope `Project`, và scope tuyến tính không tự động thỏa `Project` (và ngược lại).

Nếu một module cần policy scope riêng ngoài chuỗi chuẩn, khai báo rõ trong metadata hoặc module-specific policy.

---

## 10. Permission utility

### 10.1 Type chuẩn

```ts
export type PermissionCode = string;

export interface PermissionRequirement {
  requiredPermissions?: PermissionCode[];
  requiredAnyPermissions?: PermissionCode[];
  requiredScopes?: DataScope[];
  scopeMode?: 'any' | 'all';
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?:
    | 'NO_PERMISSION'
    | 'NO_SCOPE'
    | 'NO_SESSION'
    | 'USER_INACTIVE'
    | 'COMPANY_INACTIVE'
    | 'MODULE_DISABLED'
    | 'FEATURE_DISABLED';
  missingPermissions?: PermissionCode[];
  missingScopes?: DataScope[];
}
```

### 10.2 Permission checker

```ts
// Chuỗi scope tuyến tính theo API-10 §3: Own ⊂ Team ⊂ Department ⊂ Company ⊂ System.
// Scope rộng hơn (rank cao hơn) thỏa mọi scope hẹp hơn.
const LINEAR_SCOPE_RANK: Record<string, number> = {
  Own: 0,
  Team: 1,
  Department: 2,
  Company: 3,
  System: 4,
};

// `Project` là scope ngang (orthogonal), không nằm trong chuỗi tuyến tính.
// Phải khớp tường minh, không được suy ra từ scope tuyến tính.
function satisfiesScope(userScopes: Set<DataScope>, requiredScope: DataScope): boolean {
  if (userScopes.has(requiredScope)) return true;

  const requiredRank = LINEAR_SCOPE_RANK[requiredScope];
  if (requiredRank === undefined) {
    // requiredScope là scope ngang (vd. Project) -> chỉ thỏa khi khớp đúng.
    return false;
  }

  for (const userScope of userScopes) {
    const userRank = LINEAR_SCOPE_RANK[userScope];
    if (userRank !== undefined && userRank >= requiredRank) {
      return true;
    }
  }

  return false;
}

export function createPermissionChecker(userPermissions: UserPermission[]) {
  const map = new Map<PermissionCode, Set<DataScope>>();

  for (const item of userPermissions) {
    map.set(item.permission, new Set(item.scopes));
  }

  function can(permission: PermissionCode): boolean {
    return map.has(permission);
  }

  function canAll(permissions: PermissionCode[] = []): boolean {
    return permissions.every(can);
  }

  function canAny(permissions: PermissionCode[] = []): boolean {
    if (permissions.length === 0) return true;
    return permissions.some(can);
  }

  function getScopes(permission: PermissionCode): DataScope[] {
    return Array.from(map.get(permission) ?? []);
  }

  function hasScope(permission: PermissionCode, scope: DataScope): boolean {
    const scopes = map.get(permission);
    if (!scopes) return false;
    return satisfiesScope(scopes, scope);
  }

  function hasAnyScope(permission: PermissionCode, requiredScopes: DataScope[] = []) {
    if (requiredScopes.length === 0) return true;
    const scopes = map.get(permission);
    if (!scopes) return false;
    return requiredScopes.some((scope) => satisfiesScope(scopes, scope));
  }

  function checkRequirement(requirement: PermissionRequirement): PermissionCheckResult {
    const requiredPermissions = requirement.requiredPermissions ?? [];
    const requiredAnyPermissions = requirement.requiredAnyPermissions ?? [];
    const requiredScopes = requirement.requiredScopes ?? [];

    const missingAll = requiredPermissions.filter((permission) => !can(permission));

    if (missingAll.length > 0) {
      return {
        allowed: false,
        reason: 'NO_PERMISSION',
        missingPermissions: missingAll,
      };
    }

    if (requiredAnyPermissions.length > 0 && !canAny(requiredAnyPermissions)) {
      return {
        allowed: false,
        reason: 'NO_PERMISSION',
        missingPermissions: requiredAnyPermissions,
      };
    }

    if (requiredScopes.length > 0) {
      const candidatePermissions = [...requiredPermissions, ...requiredAnyPermissions].filter(can);
      const hasScope = candidatePermissions.some((permission) =>
        hasAnyScope(permission, requiredScopes),
      );

      if (!hasScope) {
        return {
          allowed: false,
          reason: 'NO_SCOPE',
          missingScopes: requiredScopes,
        };
      }
    }

    return { allowed: true };
  }

  return {
    can,
    canAll,
    canAny,
    getScopes,
    hasScope,
    hasAnyScope,
    checkRequirement,
  };
}
```

### 10.3 Permission hook

```ts
export function usePermission() {
  const { session } = useAuthSession();

  return useMemo(() => {
    return createPermissionChecker(session.user?.permissions ?? []);
  }, [session.user?.permissions]);
}
```

---

## 11. Module code chuẩn

```ts
export type ModuleCode =
  | 'AUTH'
  | 'FOUNDATION'
  | 'DASH'
  | 'HR'
  | 'ATT'
  | 'LEAVE'
  | 'TASK'
  | 'NOTI'
  | 'PAYROLL'
  | 'RECRUIT'
  | 'ASSET'
  | 'ROOM'
  | 'CHAT'
  | 'SOCIAL'
  | 'AI';
```

---

## 12. Route metadata

### 12.1 Route type

```ts
export type LayoutType =
  | 'AUTH'
  | 'HOME_PORTAL'
  | 'MODULE_WORKSPACE'
  | 'ACCOUNT'
  | 'ERROR';

export type PageTemplate =
  | 'OVERVIEW'
  | 'LIST'
  | 'DETAIL'
  | 'FORM'
  | 'APPROVAL'
  | 'KANBAN'
  | 'CALENDAR'
  | 'REPORT'
  | 'SETTINGS'
  | 'AUDIT_LOG';

export interface RouteMeta extends PermissionRequirement {
  routeKey: string;
  path: string;
  layout: LayoutType;
  moduleCode?: ModuleCode;
  screenCode?: string;
  title: string;
  description?: string;
  sidebarKey?: string;
  sidebarGroup?: string;
  icon?: string;
  order?: number;
  isPublic?: boolean;
  exact?: boolean;
  showInSidebar?: boolean;
  showInTopbar?: boolean;
  showInAppSwitcher?: boolean;
  featureFlag?: string;
  pageTemplate?: PageTemplate;
  breadcrumb?: Array<{ label: string; href?: string }>;
}
```

### 12.2 Quy tắc route metadata

| Rule | Mô tả |
| --- | --- |
| `routeKey` unique | Không trùng toàn hệ thống |
| `path` stable | Không đổi tùy tiện vì notification deep link có thể phụ thuộc route |
| `moduleCode` bắt buộc với Module Workspace | Trừ `/home`, `/account`, `/403`, `/404` |
| `screenCode` bắt buộc với màn nghiệp vụ | Dùng cho QA, analytics, bug report |
| `requiredAnyPermissions` cho menu cha | User chỉ cần một quyền con để thấy menu cha |
| `requiredPermissions` cho action cụ thể | Action quan trọng cần quyền chính xác |
| `requiredScopes` chỉ để UX | Backend vẫn filter/guard dữ liệu cuối cùng |

### 12.3 Route metadata ví dụ

```ts
export const routeRegistry: RouteMeta[] = [
  {
    routeKey: 'auth.login',
    path: '/login',
    layout: 'AUTH',
    title: 'Đăng nhập',
    isPublic: true,
  },
  {
    routeKey: 'home.portal',
    path: '/home',
    layout: 'HOME_PORTAL',
    title: 'Trang chủ',
  },
  {
    routeKey: 'leave.approvals',
    path: '/leave/approvals',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'LEAVE',
    screenCode: 'LEAVE-SCREEN-APPROVALS',
    title: 'Đơn nghỉ cần duyệt',
    sidebarKey: 'leave.approvals',
    showInSidebar: true,
    requiredAnyPermissions: ['LEAVE.REQUEST.APPROVE', 'LEAVE.REQUEST.VIEW'],
    requiredScopes: ['Team'],
    pageTemplate: 'APPROVAL',
    order: 30,
  },
  {
    routeKey: 'attendance.today',
    path: '/attendance/today',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'ATT',
    screenCode: 'ATT-SCREEN-TODAY',
    title: 'Chấm công hôm nay',
    sidebarKey: 'attendance.today',
    showInSidebar: true,
    requiredAnyPermissions: ['ATT.ATTENDANCE.VIEW_OWN'],
    requiredScopes: ['Own'],
    pageTemplate: 'OVERVIEW',
    order: 10,
  },
];
```

---

## 13. Route structure đề xuất với Next.js App Router

### 13.1 Folder route

```text
src/app/
  (public)/
    login/
      page.tsx
    forgot-password/
      page.tsx
    reset-password/
      page.tsx

  (protected)/
    layout.tsx
    home/
      page.tsx
    dashboard/
      page.tsx
      employee/page.tsx
      manager/page.tsx
      hr/page.tsx
      admin/page.tsx
    hr/
      page.tsx
      employees/page.tsx
      employees/new/page.tsx
      employees/[employeeId]/page.tsx
      me/page.tsx
      profile-change-requests/page.tsx
    attendance/
      page.tsx
      today/page.tsx
      my-records/page.tsx
      team-records/page.tsx
      records/page.tsx
      adjustment-requests/page.tsx
      remote-work-requests/page.tsx
      shifts/page.tsx
      rules/page.tsx
    leave/
      page.tsx
      me/balances/page.tsx
      me/requests/page.tsx
      requests/new/page.tsx
      requests/[requestId]/page.tsx
      approvals/page.tsx
      calendar/page.tsx
      types/page.tsx
      policies/page.tsx
      balances/page.tsx
    tasks/
      page.tsx
      my-tasks/page.tsx
      assigned-to-me/page.tsx
      created-by-me/page.tsx
      projects/page.tsx
      projects/[projectId]/page.tsx
      list/page.tsx
      new/page.tsx
      [taskId]/page.tsx
      kanban/page.tsx
    notifications/
      page.tsx
      [notificationId]/page.tsx
      settings/page.tsx
      admin/events/page.tsx
      admin/templates/page.tsx
      admin/delivery-logs/page.tsx
      admin/system-send/page.tsx
    system/
      users/page.tsx
      roles/page.tsx
      permissions/page.tsx
      company/page.tsx
      modules/page.tsx
      settings/page.tsx
      files/page.tsx
      audit-logs/page.tsx
    account/
      profile/page.tsx
      change-password/page.tsx
      sessions/page.tsx

  forbidden/
    page.tsx
  not-found.tsx
```

### 13.2 Protected layout

`src/app/(protected)/layout.tsx` chịu trách nhiệm:

1. Bootstrap session.
2. Redirect login nếu chưa đăng nhập.
3. Render provider cho permission.
4. Render loading shell khi đang kiểm tra session.
5. Không xử lý nghiệp vụ module.

```tsx
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthBootstrapBoundary>
      <PermissionProvider>
        {children}
      </PermissionProvider>
    </AuthBootstrapBoundary>
  );
}
```

Nếu dùng client-side guard toàn bộ:

```tsx
'use client';

export function AuthBootstrapBoundary({ children }: { children: React.ReactNode }) {
  const { status, bootstrap } = useAuthSession();
  const pathname = usePathname();

  useEffect(() => {
    bootstrap({ returnUrl: pathname });
  }, [bootstrap, pathname]);

  if (status === 'unknown' || status === 'loading') {
    return <FullPageLoadingState label="Đang kiểm tra phiên đăng nhập..." />;
  }

  if (status === 'unauthenticated') {
    return null;
  }

  return <>{children}</>;
}
```

---

## 14. Route guard

### 14.1 Route guard type

```ts
export interface RouteGuardContext {
  session: SessionContextValue;
  route: RouteMeta;
  permission: ReturnType<typeof createPermissionChecker>;
}

export interface RouteGuardResult {
  allowed: boolean;
  action: 'ALLOW' | 'REDIRECT_LOGIN' | 'SHOW_403' | 'SHOW_404' | 'SHOW_DISABLED' | 'SHOW_LOADING';
  redirectTo?: string;
  reason?: string;
}
```

### 14.2 Guard algorithm

```ts
export function evaluateRouteAccess(ctx: RouteGuardContext): RouteGuardResult {
  const { session, route, permission } = ctx;

  if (route.isPublic) {
    return { allowed: true, action: 'ALLOW' };
  }

  if (session.status === 'unknown' || session.status === 'loading') {
    return { allowed: false, action: 'SHOW_LOADING' };
  }

  if (!session.user || session.status === 'unauthenticated' || session.status === 'expired') {
    return {
      allowed: false,
      action: 'REDIRECT_LOGIN',
      redirectTo: `/login?returnUrl=${encodeURIComponent(route.path)}`,
      reason: 'NO_SESSION',
    };
  }

  if (session.user.status !== 'Active') {
    return {
      allowed: false,
      action: 'SHOW_403',
      reason: 'USER_INACTIVE',
    };
  }

  if (session.company?.status !== 'Active') {
    return {
      allowed: false,
      action: 'SHOW_403',
      reason: 'COMPANY_INACTIVE',
    };
  }

  if (route.moduleCode) {
    const moduleAccess = session.modules.find((item) => item.moduleCode === route.moduleCode);

    if (!moduleAccess || moduleAccess.status === 'hidden') {
      return { allowed: false, action: 'SHOW_404', reason: 'MODULE_HIDDEN' };
    }

    if (moduleAccess.status !== 'active') {
      return { allowed: false, action: 'SHOW_DISABLED', reason: 'MODULE_DISABLED' };
    }

    if (route.featureFlag && moduleAccess.featureFlags?.[route.featureFlag] === false) {
      return { allowed: false, action: 'SHOW_DISABLED', reason: 'FEATURE_DISABLED' };
    }
  }

  const permissionResult = permission.checkRequirement(route);

  if (!permissionResult.allowed) {
    return {
      allowed: false,
      action: 'SHOW_403',
      reason: permissionResult.reason,
    };
  }

  return { allowed: true, action: 'ALLOW' };
}
```

> **Trạng thái tài khoản / công ty (khớp BACKEND-03 + SPEC-02 §10):**
>
> 1. **`Deleted` là sentinel soft-delete, không phải state định tuyến.** Frontend không cần một status `Deleted` riêng trong `AuthUser.status`: backend từ chối user/company `Deleted` ngay ở tầng auth (`/auth/me` trả 401/403), nên FE chỉ xử lý qua `REDIRECT_LOGIN`/`SHOW_403`, không render màn hình riêng cho `Deleted`.
> 2. **Company `Suspended` xử lý y hệt `Inactive`.** Guard coi mọi company status khác `Active` (gồm `Suspended`) là `SHOW_403` với reason `COMPANY_INACTIVE` — không có nhánh riêng cho `Suspended`. Khớp lỗi backend `AUTH-ERR-COMPANY-INACTIVE`.

### 14.3 Component guard

```tsx
export function RouteGuard({ route, children }: { route: RouteMeta; children: React.ReactNode }) {
  const session = useSessionContext();
  const permission = usePermission();
  const result = evaluateRouteAccess({ session, route, permission });

  if (result.action === 'SHOW_LOADING') {
    return <FullPageLoadingState label="Đang kiểm tra quyền truy cập..." />;
  }

  if (result.action === 'REDIRECT_LOGIN') {
    redirect(result.redirectTo ?? '/login');
  }

  if (result.action === 'SHOW_403') {
    return <ForbiddenState reason={result.reason} />;
  }

  if (result.action === 'SHOW_404') {
    notFound();
  }

  if (result.action === 'SHOW_DISABLED') {
    return <DisabledModuleState moduleCode={route.moduleCode} reason={result.reason} />;
  }

  return <>{children}</>;
}
```

---

## 15. Public route guard

Public route guard xử lý trường hợp user đã đăng nhập mà vào `/login`.

```text
User đã authenticated + vào /login
  -> Nếu có returnUrl hợp lệ và có quyền: redirect returnUrl
  -> Nếu không: redirect /home
```

Không cho redirect đến domain ngoài để tránh open redirect.

```ts
export function sanitizeReturnUrl(returnUrl?: string | null) {
  if (!returnUrl) return '/home';
  if (!returnUrl.startsWith('/')) return '/home';
  if (returnUrl.startsWith('//')) return '/home';
  if (returnUrl.startsWith('/login')) return '/home';
  return returnUrl;
}
```

---

## 16. App registry

### 16.1 Mục đích

App registry phục vụ:

1. Home Portal app grid.
2. App Switcher.
3. Recent apps.
4. Favorite apps.
5. Module status/locked/coming soon.
6. Default route khi user mở app.

### 16.2 Type

```ts
export interface AppRegistryItem extends PermissionRequirement {
  moduleCode: ModuleCode;
  appKey: string;
  name: string;
  shortName?: string;
  description: string;
  icon: string;
  rootPath: string;
  defaultRoute: string;
  category: 'core' | 'hr' | 'operation' | 'collaboration' | 'system' | 'future';
  aliases?: string[];
  status: 'active' | 'locked' | 'coming_soon' | 'maintenance' | 'hidden';
  order: number;
}
```

### 16.3 App registry MVP

```ts
export const appRegistry: AppRegistryItem[] = [
  {
    appKey: 'dashboard',
    moduleCode: 'DASH',
    name: 'Dashboard',
    description: 'Tổng quan công việc, chấm công, nghỉ phép và cảnh báo.',
    icon: 'layout-dashboard',
    rootPath: '/dashboard',
    defaultRoute: '/dashboard',
    category: 'core',
    aliases: ['tong quan', 'bao cao', 'dashboard'],
    requiredAnyPermissions: ['DASH.DASHBOARD.VIEW'],
    status: 'active',
    order: 10,
  },
  {
    appKey: 'hr',
    moduleCode: 'HR',
    name: 'Nhân sự',
    description: 'Hồ sơ nhân viên, phòng ban, chức vụ và hợp đồng.',
    icon: 'users',
    rootPath: '/hr',
    defaultRoute: '/hr',
    category: 'hr',
    aliases: ['nhan su', 'employee', 'hr'],
    requiredAnyPermissions: ['HR.EMPLOYEE.VIEW'],
    status: 'active',
    order: 20,
  },
  {
    appKey: 'attendance',
    moduleCode: 'ATT',
    name: 'Chấm công',
    description: 'Check-in, check-out, bảng công, ca làm và điều chỉnh công.',
    icon: 'clock',
    rootPath: '/attendance',
    defaultRoute: '/attendance/today',
    category: 'operation',
    aliases: ['cham cong', 'attendance', 'checkin', 'checkout'],
    requiredAnyPermissions: ['ATT.ATTENDANCE.VIEW_OWN', 'ATT.ATTENDANCE.VIEW_TEAM', 'ATT.ATTENDANCE.VIEW_COMPANY'],
    status: 'active',
    order: 30,
  },
  {
    appKey: 'leave',
    moduleCode: 'LEAVE',
    name: 'Nghỉ phép',
    description: 'Số dư phép, tạo đơn nghỉ, duyệt đơn và lịch nghỉ.',
    icon: 'calendar-days',
    rootPath: '/leave',
    defaultRoute: '/leave/me/requests',
    category: 'operation',
    aliases: ['nghi phep', 'leave', 'absence'],
    requiredAnyPermissions: ['LEAVE.REQUEST.VIEW_OWN', 'LEAVE.REQUEST.VIEW', 'LEAVE.REQUEST.APPROVE'],
    status: 'active',
    order: 40,
  },
  {
    appKey: 'tasks',
    moduleCode: 'TASK',
    name: 'Công việc',
    description: 'Dự án, task, Kanban, bình luận, checklist và file.',
    icon: 'kanban-square',
    rootPath: '/tasks',
    defaultRoute: '/tasks/my-tasks',
    category: 'collaboration',
    aliases: ['cong viec', 'task', 'project', 'kanban'],
    requiredAnyPermissions: ['TASK.TASK.VIEW', 'TASK.PROJECT.VIEW'],
    status: 'active',
    order: 50,
  },
  {
    appKey: 'notifications',
    moduleCode: 'NOTI',
    name: 'Thông báo',
    description: 'Danh sách thông báo, trạng thái đọc và cấu hình thông báo.',
    icon: 'bell',
    rootPath: '/notifications',
    defaultRoute: '/notifications',
    category: 'core',
    aliases: ['thong bao', 'notification', 'noti'],
    requiredAnyPermissions: ['NOTI.NOTIFICATION.VIEW_OWN'],
    status: 'active',
    order: 60,
  },
  {
    appKey: 'system',
    moduleCode: 'FOUNDATION',
    name: 'Hệ thống',
    description: 'Người dùng, vai trò, quyền, cấu hình, audit log và module catalog.',
    icon: 'settings',
    rootPath: '/system',
    defaultRoute: '/system/settings',
    category: 'system',
    aliases: ['he thong', 'system', 'settings', 'admin'],
    requiredAnyPermissions: [
      'AUTH.USER.VIEW',
      'AUTH.ROLE.VIEW',
      'FOUNDATION.SETTING.VIEW',
      'FOUNDATION.AUDIT_LOG.VIEW',
    ],
    status: 'active',
    order: 70,
  },
];
```

### 16.4 Filter app visibility

```ts
export function getVisibleApps(args: {
  apps: AppRegistryItem[];
  session: SessionContextValue;
  permission: ReturnType<typeof createPermissionChecker>;
}) {
  const { apps, session, permission } = args;

  return apps
    .filter((app) => {
      const moduleAccess = session.modules.find((item) => item.moduleCode === app.moduleCode);
      const moduleStatus = moduleAccess?.status ?? app.status;

      if (moduleStatus === 'hidden') return false;
      if (app.status === 'hidden') return false;

      const result = permission.checkRequirement(app);
      return result.allowed || moduleStatus === 'coming_soon' || moduleStatus === 'locked';
    })
    .sort((a, b) => a.order - b.order);
}
```

---

## 17. Sidebar registry

### 17.1 Type

```ts
export interface SidebarItemMeta extends PermissionRequirement {
  sidebarKey: string;
  moduleCode: ModuleCode;
  label: string;
  path?: string;
  icon?: string;
  group?: string;
  order: number;
  badgeKey?: string;
  children?: SidebarItemMeta[];
  featureFlag?: string;
  isDivider?: boolean;
}
```

### 17.2 LEAVE sidebar ví dụ

```ts
export const leaveSidebar: SidebarItemMeta[] = [
  {
    sidebarKey: 'leave.overview',
    moduleCode: 'LEAVE',
    label: 'Tổng quan',
    path: '/leave',
    icon: 'home',
    order: 10,
    requiredAnyPermissions: ['LEAVE.REQUEST.VIEW_OWN', 'LEAVE.REQUEST.VIEW'],
  },
  {
    sidebarKey: 'leave.my-requests',
    moduleCode: 'LEAVE',
    label: 'Đơn nghỉ của tôi',
    path: '/leave/me/requests',
    icon: 'file-text',
    order: 20,
    requiredAnyPermissions: ['LEAVE.REQUEST.VIEW_OWN'],
    requiredScopes: ['Own'],
  },
  {
    sidebarKey: 'leave.approvals',
    moduleCode: 'LEAVE',
    label: 'Đơn cần duyệt',
    path: '/leave/approvals',
    icon: 'check-circle',
    order: 30,
    badgeKey: 'leave.pendingApprovals',
    requiredAnyPermissions: ['LEAVE.REQUEST.APPROVE', 'LEAVE.REQUEST.VIEW'],
    requiredScopes: ['Team'],
  },
  {
    sidebarKey: 'leave.calendar',
    moduleCode: 'LEAVE',
    label: 'Lịch nghỉ',
    path: '/leave/calendar',
    icon: 'calendar',
    order: 40,
    requiredAnyPermissions: ['LEAVE.CALENDAR.VIEW'],
  },
  {
    sidebarKey: 'leave.settings',
    moduleCode: 'LEAVE',
    label: 'Cấu hình',
    icon: 'settings',
    order: 90,
    requiredAnyPermissions: ['LEAVE.TYPE.VIEW', 'LEAVE.POLICY.VIEW', 'LEAVE.BALANCE.VIEW'],
    children: [
      {
        sidebarKey: 'leave.types',
        moduleCode: 'LEAVE',
        label: 'Loại nghỉ',
        path: '/leave/types',
        order: 91,
        requiredAnyPermissions: ['LEAVE.TYPE.VIEW'],
      },
      {
        sidebarKey: 'leave.policies',
        moduleCode: 'LEAVE',
        label: 'Chính sách nghỉ',
        path: '/leave/policies',
        order: 92,
        requiredAnyPermissions: ['LEAVE.POLICY.VIEW'],
      },
      {
        sidebarKey: 'leave.balances',
        moduleCode: 'LEAVE',
        label: 'Số dư phép',
        path: '/leave/balances',
        order: 93,
        requiredAnyPermissions: ['LEAVE.BALANCE.VIEW'],
      },
    ],
  },
];
```

### 17.3 Filter sidebar

```ts
export function filterSidebarItems(
  items: SidebarItemMeta[],
  permission: ReturnType<typeof createPermissionChecker>,
): SidebarItemMeta[] {
  return items
    .map((item) => {
      const children = item.children ? filterSidebarItems(item.children, permission) : undefined;
      const selfAllowed = permission.checkRequirement(item).allowed;
      const hasVisibleChildren = Boolean(children?.length);

      if (!selfAllowed && !hasVisibleChildren) return null;

      return {
        ...item,
        children,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order) as SidebarItemMeta[];
}
```

---

## 18. Action registry

### 18.1 Mục đích

Action registry dùng để kiểm soát:

1. Button trong page header.
2. Row action trong table.
3. Quick action trong dashboard.
4. Context menu.
5. Bulk action.
6. Action trong notification target.

### 18.2 Type

```ts
export interface ActionMeta extends PermissionRequirement {
  actionKey: string;
  moduleCode: ModuleCode;
  label: string;
  icon?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  placement: 'page-header' | 'table-row' | 'bulk' | 'quick-action' | 'detail' | 'dropdown';
  order?: number;
  featureFlag?: string;
  requiresConfirmation?: boolean;
  disabledReason?: string;
}

export interface ActionRuntimeContext<T = unknown> {
  record?: T;
  businessState?: Record<string, unknown>;
}
```

### 18.3 Action ví dụ

```ts
export const leaveActions: ActionMeta[] = [
  {
    actionKey: 'leave.request.create',
    moduleCode: 'LEAVE',
    label: 'Tạo đơn nghỉ',
    icon: 'plus',
    variant: 'primary',
    placement: 'page-header',
    requiredPermissions: ['LEAVE.REQUEST.CREATE'],
    requiredScopes: ['Own'],
  },
  {
    actionKey: 'leave.request.approve',
    moduleCode: 'LEAVE',
    label: 'Duyệt đơn',
    icon: 'check',
    variant: 'primary',
    placement: 'detail',
    requiredPermissions: ['LEAVE.REQUEST.APPROVE'],
    requiredScopes: ['Team'],
    requiresConfirmation: true,
  },
  {
    actionKey: 'leave.request.reject',
    moduleCode: 'LEAVE',
    label: 'Từ chối',
    icon: 'x',
    variant: 'danger',
    placement: 'detail',
    requiredPermissions: ['LEAVE.REQUEST.REJECT'],
    requiredScopes: ['Team'],
    requiresConfirmation: true,
  },
];
```

### 18.4 Runtime business state

Permission chỉ quyết định user có thể thấy action hay không. Business state quyết định action có đang khả dụng hay không.

```ts
export function getLeaveApproveDisabledReason(request: LeaveRequestDetail) {
  if (request.status !== 'Pending') {
    return 'Đơn nghỉ không còn ở trạng thái chờ duyệt.';
  }

  if (request.isLocked) {
    return 'Đơn nghỉ đã bị khóa do kỳ công đã chốt.';
  }

  return null;
}
```

---

## 19. PermissionGate component

### 19.1 Mục đích

`PermissionGate` dùng cho button, widget, section hoặc field nhỏ.

### 19.2 API đề xuất

```tsx
interface PermissionGateProps extends PermissionRequirement {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  mode?: 'hide' | 'disable' | 'mask' | 'forbidden';
  disabledReason?: string;
}

export function PermissionGate({
  children,
  fallback = null,
  mode = 'hide',
  disabledReason,
  ...requirement
}: PermissionGateProps) {
  const permission = usePermission();
  const result = permission.checkRequirement(requirement);

  if (result.allowed) return <>{children}</>;

  if (mode === 'hide') return <>{fallback}</>;

  if (mode === 'forbidden') {
    return <ForbiddenState reason={result.reason} />;
  }

  if (mode === 'mask') {
    return <MaskedField />;
  }

  if (mode === 'disable') {
    return <DisabledActionTooltip reason={disabledReason ?? 'Bạn không có quyền thực hiện thao tác này.'}>{children}</DisabledActionTooltip>;
  }

  return <>{fallback}</>;
}
```

### 19.3 Cách dùng

```tsx
<PermissionGate requiredPermissions={['HR.EMPLOYEE.CREATE']}>
  <Button onClick={openCreateEmployeeDrawer}>Thêm nhân viên</Button>
</PermissionGate>
```

```tsx
<PermissionGate
  requiredPermissions={['HR.EMPLOYEE.VIEW_SENSITIVE']}
  mode="mask"
>
  <EmployeeSalaryField value={salary} />
</PermissionGate>
```

---

## 20. Field-level permission

### 20.1 Khi nào dùng

Field-level permission dùng cho dữ liệu nhạy cảm như:

1. Số giấy tờ tùy thân.
2. Địa chỉ cá nhân.
3. Số điện thoại cá nhân nếu policy yêu cầu.
4. File hợp đồng.
5. Thông tin lương ở phase sau.
6. Audit log/security event.

### 20.2 Nguyên tắc

| Trường hợp | UI behavior |
| --- | --- |
| Backend không trả field | Hiển thị `Không có quyền xem` hoặc masked placeholder |
| Backend trả masked value | Hiển thị masked value đúng như backend trả |
| Frontend thiếu permission | Không render field hoặc render MaskedField |
| Export dữ liệu | Không phụ thuộc field UI; backend phải kiểm tra riêng |

### 20.3 Field guard type

```ts
export interface FieldPermissionMeta extends PermissionRequirement {
  fieldKey: string;
  label: string;
  sensitive?: boolean;
  maskPattern?: 'full' | 'partial' | 'last4';
}
```

---

## 21. Data scope UX pattern

### 21.1 Own scope

Ví dụ:

```text
/hr/me
/attendance/my-records
/leave/me/requests
/tasks/my-tasks
```

UI copy nên dùng:

```text
Của tôi
Hồ sơ của tôi
Bảng công của tôi
Đơn nghỉ của tôi
```

### 21.2 Team scope

Ví dụ:

```text
/attendance/team-records
/leave/approvals
/tasks/team
```

UI cần hiển thị rõ:

```text
Dữ liệu trong phạm vi team bạn quản lý.
```

### 21.3 Company/System scope

Ví dụ:

```text
/hr/employees
/system/users
/leave/balances
```

UI cần cẩn trọng với:

1. Filter mặc định.
2. Export.
3. Bulk action.
4. Audit log.
5. Dữ liệu nhạy cảm.

---

## 22. Deep link và notification target

### 22.1 Nguyên tắc

Notification có thể đưa user vào module gốc. Khi click notification:

```text
Click notification
  -> Mark read nếu policy bật
  -> Resolve target route
  -> Kiểm tra route guard frontend
  -> Điều hướng sang module gốc
  -> Module gốc gọi API detail
  -> Backend kiểm tra permission/data scope/business rule lại
```

### 22.2 Target route type

```ts
export interface NotificationTarget {
  moduleCode: ModuleCode;
  routeKey?: string;
  path: string;
  entityType?: string;
  entityId?: string;
}
```

### 22.3 Không tin hoàn toàn vào path từ notification

Frontend nên validate target:

1. Path phải là internal path.
2. Route phải tồn tại trong route registry.
3. User phải có quyền route.
4. Nếu không có quyền, hiển thị Forbidden hoặc notification target unavailable.

```ts
export function resolveSafeNotificationTarget(target: NotificationTarget) {
  if (!target.path.startsWith('/')) return '/home';
  if (target.path.startsWith('//')) return '/home';

  const route = matchRoute(target.path, routeRegistry);
  if (!route) return '/404';

  return target.path;
}
```

---

## 23. Dirty form guard

### 23.1 Khi nào cần

Dirty form guard cần dùng khi user:

1. Đang tạo đơn nghỉ.
2. Đang sửa hồ sơ nhân viên.
3. Đang chỉnh role-permission matrix.
4. Đang tạo task/comment dài.
5. Đổi app bằng App Switcher.
6. Click sidebar sang route khác.
7. Logout khi form chưa lưu.

### 23.2 Dirty form store

```ts
interface DirtyFormState {
  dirtyKeys: Set<string>;
  markDirty: (key: string) => void;
  markClean: (key: string) => void;
  isDirty: () => boolean;
}
```

### 23.3 Navigation blocker

```ts
export function useDirtyNavigationGuard() {
  const isDirty = useDirtyFormStore((state) => state.isDirty);

  function confirmIfDirty() {
    if (!isDirty()) return true;
    return window.confirm('Bạn có thay đổi chưa lưu. Bạn có chắc muốn rời khỏi trang này?');
  }

  return { confirmIfDirty };
}
```

MVP có thể dùng confirm dialog của Design System thay `window.confirm`.

---

## 24. Error handling trong guard

### 24.1 Route-level error

| Tình huống | UI behavior |
| --- | --- |
| Auth loading | Full page skeleton/loading |
| 401 chưa refresh | Loading + refresh session |
| 401 refresh fail | Redirect `/login?returnUrl=...` |
| 403 route | Forbidden page |
| 403 API trong màn | Inline ForbiddenState hoặc toast tùy ngữ cảnh |
| 404 route | NotFound page |
| Module maintenance | Maintenance state |
| Feature flag off | Disabled/Coming soon state |
| Scope không có dữ liệu | EmptyState với copy rõ ràng |

### 24.2 Forbidden copy đề xuất

```text
Bạn không có quyền truy cập màn hình này.
Nếu bạn cho rằng đây là nhầm lẫn, vui lòng liên hệ quản trị viên hệ thống.
```

### 24.3 Empty due to scope copy đề xuất

```text
Không có dữ liệu trong phạm vi bạn được cấp quyền.
```

---

## 25. Query cache và permission change

### 25.1 Khi permission thay đổi

Nếu admin thay đổi role/permission của user đang online, có 3 hướng:

| Hướng | MVP |
| --- | --- |
| User cần logout/login lại | Chấp nhận được cho MVP nhỏ |
| Polling `/auth/me` định kỳ | Khuyến nghị nếu hệ thống có thay đổi quyền thường xuyên |
| Realtime permission invalidation | Phase sau |

### 25.2 Clear cache khi logout

Khi logout:

```ts
queryClient.clear();
authStore.reset();
permissionStore.reset();
recentAppStore.persistIfAllowed();
```

### 25.3 Cache theo user

Query key nên chứa user/company khi liên quan permission:

```ts
['auth', 'me']
['app-registry', userId, companyId]
['sidebar', moduleCode, userId, companyId]
['dashboard', dashboardType, userId, companyId]
```

---

## 26. Registry file structure

```text
src/
  routes/
    types.ts
    routeRegistry.ts
    appRegistry.ts
    sidebarRegistry.ts
    actionRegistry.ts
    routeMatcher.ts
    routeGuard.ts
    visibility.ts

  modules/
    auth/
      services/auth.api.ts
      stores/auth.store.ts
      hooks/useAuthSession.ts
      components/AuthBootstrapBoundary.tsx
    permissions/
      types.ts
      permissionChecker.ts
      PermissionProvider.tsx
      PermissionGate.tsx
      FieldGuard.tsx

  shared/
    design-system/
      components/permission/
        ForbiddenState/
        DisabledActionTooltip/
        MaskedField/
```

---

## 27. Route registry mẫu theo module

### 27.1 HR routes

```ts
export const hrRoutes: RouteMeta[] = [
  {
    routeKey: 'hr.overview',
    path: '/hr',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'HR',
    screenCode: 'HR-SCREEN-OVERVIEW',
    title: 'Nhân sự',
    requiredAnyPermissions: ['HR.EMPLOYEE.VIEW'],
    pageTemplate: 'OVERVIEW',
  },
  {
    routeKey: 'hr.employees.list',
    path: '/hr/employees',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'HR',
    screenCode: 'HR-SCREEN-EMPLOYEE-LIST',
    title: 'Danh sách nhân viên',
    sidebarKey: 'hr.employees',
    showInSidebar: true,
    requiredAnyPermissions: ['HR.EMPLOYEE.VIEW'],
    requiredScopes: ['Team'],
    pageTemplate: 'LIST',
  },
  {
    routeKey: 'hr.me',
    path: '/hr/me',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'HR',
    screenCode: 'HR-SCREEN-MY-PROFILE',
    title: 'Hồ sơ của tôi',
    sidebarKey: 'hr.me',
    showInSidebar: true,
    requiredAnyPermissions: ['HR.EMPLOYEE.VIEW'],
    requiredScopes: ['Own'],
    pageTemplate: 'DETAIL',
  },
];
```

### 27.2 ATT routes

```ts
export const attendanceRoutes: RouteMeta[] = [
  {
    routeKey: 'attendance.today',
    path: '/attendance/today',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'ATT',
    screenCode: 'ATT-SCREEN-TODAY',
    title: 'Chấm công hôm nay',
    sidebarKey: 'attendance.today',
    showInSidebar: true,
    requiredAnyPermissions: ['ATT.ATTENDANCE.VIEW_OWN'],
    requiredScopes: ['Own'],
    pageTemplate: 'OVERVIEW',
  },
  {
    routeKey: 'attendance.team-records',
    path: '/attendance/team-records',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'ATT',
    screenCode: 'ATT-SCREEN-TEAM-RECORDS',
    title: 'Bảng công team',
    sidebarKey: 'attendance.teamRecords',
    showInSidebar: true,
    requiredAnyPermissions: ['ATT.ATTENDANCE.VIEW_TEAM'],
    requiredScopes: ['Team'],
    pageTemplate: 'LIST',
  },
];
```

### 27.3 TASK routes

```ts
export const taskRoutes: RouteMeta[] = [
  {
    routeKey: 'tasks.my-tasks',
    path: '/tasks/my-tasks',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'TASK',
    screenCode: 'TASK-SCREEN-MY-TASKS',
    title: 'Việc của tôi',
    sidebarKey: 'tasks.myTasks',
    showInSidebar: true,
    requiredAnyPermissions: ['TASK.TASK.VIEW'],
    requiredScopes: ['Own', 'Project', 'Team', 'Company', 'System'],
    pageTemplate: 'LIST',
  },
  {
    routeKey: 'tasks.assigned-to-me',
    path: '/tasks/assigned-to-me',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'TASK',
    screenCode: 'TASK-SCREEN-ASSIGNED-TO-ME',
    title: 'Task được giao',
    sidebarKey: 'tasks.assignedToMe',
    showInSidebar: true,
    requiredAnyPermissions: ['TASK.TASK.VIEW'],
    requiredScopes: ['Own', 'Project'],
    pageTemplate: 'LIST',
  },
  {
    routeKey: 'tasks.created-by-me',
    path: '/tasks/created-by-me',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'TASK',
    screenCode: 'TASK-SCREEN-CREATED-BY-ME',
    title: 'Task tôi tạo',
    sidebarKey: 'tasks.createdByMe',
    showInSidebar: true,
    requiredAnyPermissions: ['TASK.TASK.VIEW'],
    requiredScopes: ['Own', 'Project'],
    pageTemplate: 'LIST',
  },
  {
    routeKey: 'tasks.list',
    path: '/tasks/list',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'TASK',
    screenCode: 'TASK-SCREEN-LIST',
    title: 'Danh sách task',
    sidebarKey: 'tasks.list',
    showInSidebar: true,
    requiredAnyPermissions: ['TASK.TASK.VIEW'],
    requiredScopes: ['Own', 'Project'],
    pageTemplate: 'LIST',
  },
  {
    routeKey: 'tasks.new',
    path: '/tasks/new',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'TASK',
    screenCode: 'TASK-SCREEN-NEW',
    title: 'Tạo task',
    requiredAnyPermissions: ['TASK.TASK.CREATE'],
    requiredScopes: ['Project'],
    pageTemplate: 'FORM',
  },
  {
    routeKey: 'tasks.kanban',
    path: '/tasks/kanban',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'TASK',
    screenCode: 'TASK-SCREEN-KANBAN',
    title: 'Kanban',
    sidebarKey: 'tasks.kanban',
    showInSidebar: true,
    requiredAnyPermissions: ['TASK.TASK.VIEW', 'TASK.PROJECT.VIEW'],
    pageTemplate: 'KANBAN',
  },
];
```

### 27.4 NOTI routes

```ts
export const notificationRoutes: RouteMeta[] = [
  {
    routeKey: 'notifications.list',
    path: '/notifications',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'NOTI',
    screenCode: 'NOTI-SCREEN-LIST',
    title: 'Thông báo của tôi',
    sidebarKey: 'notifications.list',
    showInSidebar: true,
    requiredAnyPermissions: ['NOTI.NOTIFICATION.VIEW_OWN'],
    requiredScopes: ['Own'],
    pageTemplate: 'LIST',
  },
  {
    routeKey: 'notifications.settings',
    path: '/notifications/settings',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'NOTI',
    screenCode: 'NOTI-SCREEN-SETTINGS',
    title: 'Thiết lập thông báo cá nhân',
    sidebarKey: 'notifications.settings',
    showInSidebar: true,
    requiredAnyPermissions: ['NOTI.NOTIFICATION.VIEW_OWN'],
    requiredScopes: ['Own'],
    pageTemplate: 'SETTINGS',
  },
  {
    routeKey: 'notifications.admin.events',
    path: '/notifications/admin/events',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'NOTI',
    screenCode: 'NOTI-SCREEN-ADMIN-EVENTS',
    title: 'Cấu hình event thông báo',
    sidebarKey: 'notifications.adminEvents',
    showInSidebar: true,
    requiredAnyPermissions: ['NOTI.EVENT.VIEW'],
    requiredScopes: ['Company'],
    pageTemplate: 'SETTINGS',
  },
  {
    routeKey: 'notifications.admin.templates',
    path: '/notifications/admin/templates',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'NOTI',
    screenCode: 'NOTI-SCREEN-ADMIN-TEMPLATES',
    title: 'Template thông báo',
    sidebarKey: 'notifications.adminTemplates',
    showInSidebar: true,
    requiredAnyPermissions: ['NOTI.TEMPLATE.VIEW'],
    requiredScopes: ['Company'],
    pageTemplate: 'LIST',
  },
  {
    routeKey: 'notifications.admin.delivery-logs',
    path: '/notifications/admin/delivery-logs',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'NOTI',
    screenCode: 'NOTI-SCREEN-ADMIN-DELIVERY-LOGS',
    title: 'Delivery logs',
    sidebarKey: 'notifications.adminDeliveryLogs',
    showInSidebar: true,
    requiredAnyPermissions: ['NOTI.LOG.VIEW'],
    requiredScopes: ['Company'],
    pageTemplate: 'LIST',
  },
  {
    routeKey: 'notifications.admin.system-send',
    path: '/notifications/admin/system-send',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'NOTI',
    screenCode: 'NOTI-SCREEN-ADMIN-SYSTEM-SEND',
    title: 'Gửi thông báo hệ thống',
    sidebarKey: 'notifications.adminSystemSend',
    showInSidebar: true,
    requiredAnyPermissions: ['NOTI.NOTIFICATION.SEND_SYSTEM'],
    requiredScopes: ['Company'],
    pageTemplate: 'FORM',
  },
];
```

### 27.5 SYSTEM routes

```ts
export const systemRoutes: RouteMeta[] = [
  {
    routeKey: 'system.users',
    path: '/system/users',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'FOUNDATION',
    screenCode: 'SYSTEM-SCREEN-USERS',
    title: 'Danh sách user',
    sidebarKey: 'system.users',
    showInSidebar: true,
    requiredAnyPermissions: ['AUTH.USER.VIEW'],
    requiredScopes: ['Company'],
    pageTemplate: 'LIST',
  },
  {
    routeKey: 'system.roles',
    path: '/system/roles',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'FOUNDATION',
    screenCode: 'SYSTEM-SCREEN-ROLES',
    title: 'Danh sách role',
    sidebarKey: 'system.roles',
    showInSidebar: true,
    requiredAnyPermissions: ['AUTH.ROLE.VIEW'],
    requiredScopes: ['Company'],
    pageTemplate: 'LIST',
  },
  {
    routeKey: 'system.permissions',
    path: '/system/permissions',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'FOUNDATION',
    screenCode: 'SYSTEM-SCREEN-PERMISSIONS',
    title: 'Danh sách permission',
    sidebarKey: 'system.permissions',
    showInSidebar: true,
    requiredAnyPermissions: ['AUTH.PERMISSION.VIEW'],
    requiredScopes: ['Company'],
    pageTemplate: 'LIST',
  },
  {
    routeKey: 'system.company',
    path: '/system/company',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'FOUNDATION',
    screenCode: 'SYSTEM-SCREEN-COMPANY',
    title: 'Thông tin công ty',
    sidebarKey: 'system.company',
    showInSidebar: true,
    requiredAnyPermissions: ['FOUNDATION.COMPANY.VIEW'],
    requiredScopes: ['Company'],
    pageTemplate: 'SETTINGS',
  },
  {
    routeKey: 'system.modules',
    path: '/system/modules',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'FOUNDATION',
    screenCode: 'SYSTEM-SCREEN-MODULES',
    title: 'Module catalog',
    sidebarKey: 'system.modules',
    showInSidebar: true,
    requiredAnyPermissions: ['FOUNDATION.MODULE.VIEW'],
    requiredScopes: ['Company'],
    pageTemplate: 'LIST',
  },
  {
    routeKey: 'system.settings',
    path: '/system/settings',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'FOUNDATION',
    screenCode: 'SYSTEM-SCREEN-SETTINGS',
    title: 'Cấu hình hệ thống/công ty',
    sidebarKey: 'system.settings',
    showInSidebar: true,
    requiredAnyPermissions: ['FOUNDATION.SETTING.VIEW'],
    requiredScopes: ['Company'],
    pageTemplate: 'SETTINGS',
  },
  {
    routeKey: 'system.files',
    path: '/system/files',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'FOUNDATION',
    screenCode: 'SYSTEM-SCREEN-FILES',
    title: 'File metadata',
    sidebarKey: 'system.files',
    showInSidebar: true,
    requiredAnyPermissions: ['FOUNDATION.FILE.VIEW'],
    requiredScopes: ['Company'],
    pageTemplate: 'LIST',
  },
  {
    routeKey: 'system.audit-logs',
    path: '/system/audit-logs',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'FOUNDATION',
    screenCode: 'SYSTEM-SCREEN-AUDIT-LOGS',
    title: 'Audit log toàn hệ thống',
    sidebarKey: 'system.auditLogs',
    showInSidebar: true,
    requiredAnyPermissions: ['FOUNDATION.AUDIT_LOG.VIEW'],
    requiredScopes: ['Company'],
    pageTemplate: 'AUDIT_LOG',
  },
];
```

---

## 28. Permission matrix starter cho MVP

> Đây là starter để frontend có metadata ban đầu. Backend/seed vẫn là nguồn chính thức.

| Module | Route/action | Permission |
| --- | --- | --- |
| AUTH | Xem user | `AUTH.USER.VIEW` |
| AUTH | Tạo user | `AUTH.USER.CREATE` |
| AUTH | Xem role | `AUTH.ROLE.VIEW` |
| AUTH | Cập nhật role | `AUTH.ROLE.UPDATE` |
| HR | Xem hồ sơ của tôi | `HR.EMPLOYEE.VIEW` (scope `Own`) |
| HR | Xem danh sách nhân viên | `HR.EMPLOYEE.VIEW` |
| HR | Tạo nhân viên | `HR.EMPLOYEE.CREATE` |
| HR | Cập nhật nhân viên | `HR.EMPLOYEE.UPDATE` |
| ATT | Xem chấm công hôm nay | `ATT.ATTENDANCE.VIEW_OWN` |
| ATT | Check-in | `ATT.ATTENDANCE.CHECK_IN` |
| ATT | Check-out | `ATT.ATTENDANCE.CHECK_OUT` |
| ATT | Xem bảng công team | `ATT.ATTENDANCE.VIEW_TEAM` |
| ATT | Duyệt điều chỉnh công | `ATT.ADJUSTMENT.APPROVE` |
| LEAVE | Xem đơn nghỉ của tôi | `LEAVE.REQUEST.VIEW_OWN` |
| LEAVE | Tạo đơn nghỉ | `LEAVE.REQUEST.CREATE` |
| LEAVE | Duyệt đơn nghỉ | `LEAVE.REQUEST.APPROVE` |
| LEAVE | Xem chính sách nghỉ | `LEAVE.POLICY.VIEW` |
| TASK | Xem task | `TASK.TASK.VIEW` |
| TASK | Tạo task | `TASK.TASK.CREATE` |
| TASK | Cập nhật trạng thái task | `TASK.TASK.UPDATE_STATUS` |
| TASK | Xem project | `TASK.PROJECT.VIEW` |
| DASH | Xem dashboard | `DASH.DASHBOARD.VIEW` |
| NOTI | Đọc thông báo | `NOTI.NOTIFICATION.VIEW_OWN` |
| NOTI | Cấu hình template | `NOTI.TEMPLATE.UPDATE` |
| FOUNDATION | Xem setting | `FOUNDATION.SETTING.VIEW` |
| FOUNDATION | Xem audit log | `FOUNDATION.AUDIT_LOG.VIEW` |

---

## 29. Route guard behavior matrix

| User state | Route | Kết quả |
| --- | --- | --- |
| Chưa login | `/home` | Redirect `/login?returnUrl=/home` |
| Chưa login | `/login` | Hiển thị login |
| Đã login | `/login` | Redirect `/home` |
| Đã login, đủ quyền | `/leave/approvals` | Render page |
| Đã login, thiếu quyền | `/leave/approvals` | 403 Forbidden |
| Đã login, module inactive | `/leave` | Disabled module state hoặc 404 theo policy |
| Đã login, feature off | `/leave/policies` | Disabled feature state |
| Đã login, scope không phù hợp | `/attendance/team-records` | 403 hoặc empty due to scope tùy route |
| Token expired | Any protected | Refresh token, nếu fail redirect login |
| User locked | Any protected | Account locked state |
| Company suspended | Any protected | Company inactive state |

---

## 30. Guard UX state

### 30.1 Loading

```tsx
<FullPageLoadingState label="Đang kiểm tra phiên đăng nhập..." />
```

### 30.2 Forbidden

```tsx
<ForbiddenState
  title="Bạn không có quyền truy cập"
  description="Tài khoản của bạn chưa được cấp quyền để mở màn hình này."
  primaryAction={{ label: 'Về trang chủ', href: '/home' }}
/>
```

### 30.3 Disabled module

```tsx
<DisabledModuleState
  title="Module đang tạm tắt"
  description="Ứng dụng này hiện chưa được bật cho công ty của bạn."
/>
```

### 30.4 Empty due to scope

```tsx
<EmptyState
  title="Không có dữ liệu trong phạm vi của bạn"
  description="Bạn chỉ thấy dữ liệu thuộc phạm vi được cấp quyền."
/>
```

---

## 31. Integration với API client

FRONTEND-03 chỉ định nghĩa contract. FRONTEND-04 sẽ đi sâu API client.

Tuy nhiên guard cần các API nền:

| API | Dùng cho |
| --- | --- |
| `POST /api/v1/auth/login` | Login |
| `POST /api/v1/auth/logout` | Logout |
| `POST /api/v1/auth/refresh-token` | Refresh token nếu dùng token endpoint |
| `GET /api/v1/auth/me` | Bootstrap session, user, permission, data scope |
| `GET /api/v1/foundation/modules` | Module active/status nếu backend-driven |
| `GET /api/v1/notifications/unread-count` | Topbar badge nếu có quyền |

### 31.1 API 401/403 behavior

```ts
export function handleApiAuthError(error: ApiError) {
  if (error.status === 401) {
    authEvents.emit('SESSION_EXPIRED');
    return;
  }

  if (error.status === 403) {
    toast.error('Bạn không có quyền thực hiện thao tác này.');
    return;
  }
}
```

---

## 32. Security notes cho frontend

1. Không lưu access token trong localStorage nếu tránh được.
2. Không expose permission debug ở production nếu chứa dữ liệu nhạy cảm.
3. Không tin `returnUrl` từ query nếu là external URL.
4. Không render app/menu chỉ dựa trên role name.
5. Không tự truyền `company_id` cho API nghiệp vụ thông thường.
6. Không tự suy luận được xem dữ liệu chỉ vì UI có route.
7. Không dùng frontend mask thay thế backend field-level permission.
8. Không log token/session vào console.
9. Không cache dữ liệu user A sau khi logout rồi user B login.
10. Không để notification target điều hướng đến path ngoài hệ thống.

---

## 33. Testing strategy

### 33.1 Unit test permission utility

| Test | Kỳ vọng |
| --- | --- |
| User có permission | `can()` trả true |
| User thiếu permission | `can()` trả false |
| User có một trong nhiều quyền | `canAny()` trả true |
| User thiếu một quyền required all | `canAll()` trả false |
| User có đúng scope yêu cầu | `checkRequirement()` allowed |
| User có scope rộng hơn scope yêu cầu (vd. Company khi route cần Team) | `checkRequirement()` allowed |
| User chỉ có scope hẹp hơn scope yêu cầu (vd. Own khi route cần Team) | reason `NO_SCOPE` |
| Route yêu cầu `Project` nhưng user chỉ có scope tuyến tính | reason `NO_SCOPE` (Project khớp tường minh) |
| User thiếu scope | reason `NO_SCOPE` |
| Requirement rỗng | allowed |

### 33.2 Component test

| Component | Test |
| --- | --- |
| `PermissionGate` | Hide fallback khi thiếu quyền |
| `PermissionGate mode=disable` | Render disabled tooltip |
| `PermissionGate mode=mask` | Render MaskedField |
| `RouteGuard` | Render Forbidden khi thiếu quyền |
| `RouteGuard` | Redirect login khi unauthenticated |
| `Sidebar` | Chỉ render item có quyền |
| `AppSwitcher` | Không render app hidden |

### 33.3 E2E test

| Mã | Test |
| --- | --- |
| FE03-E2E-001 | Chưa login vào `/home` bị redirect `/login` |
| FE03-E2E-002 | Login thành công vào `/home` |
| FE03-E2E-003 | Employee không thấy menu quản lý user/role |
| FE03-E2E-004 | Nhập URL `/system/users` khi thiếu quyền hiển thị 403 |
| FE03-E2E-005 | Manager thấy `/leave/approvals` nếu có `LEAVE.REQUEST.APPROVE + Team` |
| FE03-E2E-006 | Token expired refresh thành công thì tiếp tục ở route hiện tại |
| FE03-E2E-007 | Token expired refresh fail thì về login với returnUrl |
| FE03-E2E-008 | Notification deep link vào leave detail vẫn qua route guard |
| FE03-E2E-009 | Dirty form khi đổi app hiển thị confirm |
| FE03-E2E-010 | Module inactive không xuất hiện trong Home/App Switcher |

---

## 34. File skeleton cần tạo

```text
src/
  modules/
    auth/
      components/
        AuthBootstrapBoundary.tsx
        PublicRouteGuard.tsx
      hooks/
        useAuthSession.ts
      services/
        auth.api.ts
      stores/
        auth.store.ts
      types/
        auth.types.ts

    permissions/
      components/
        PermissionGate.tsx
        FieldGuard.tsx
      hooks/
        usePermission.ts
      providers/
        PermissionProvider.tsx
      utils/
        permissionChecker.ts
      types/
        permission.types.ts

  routes/
    types.ts
    routeRegistry.ts
    appRegistry.ts
    sidebarRegistry.ts
    actionRegistry.ts
    routeMatcher.ts
    routeGuard.ts
    visibility.ts
    modules/
      auth.routes.ts
      dashboard.routes.ts
      hr.routes.ts
      attendance.routes.ts
      leave.routes.ts
      task.routes.ts
      notification.routes.ts
      system.routes.ts

  shared/
    guards/
      sanitizeReturnUrl.ts
      dirtyNavigationGuard.ts
    errors/
      authErrorMapper.ts
```

---

## 35. Implementation order đề xuất

```text
Bước 1: Tạo type nền
  -> DataScope, PermissionCode, ModuleCode, RouteMeta, AppRegistryItem, SidebarItemMeta

Bước 2: Tạo permission checker
  -> can, canAny, canAll, getScopes, hasAnyScope, checkRequirement

Bước 3: Tạo auth store/session hook
  -> status, user, company, modules, bootstrap, logout

Bước 4: Tạo route registry
  -> public, home, dashboard, hr, attendance, leave, task, notification, system

Bước 5: Tạo route guard
  -> evaluateRouteAccess, RouteGuard, PublicRouteGuard

Bước 6: Tạo app/sidebar/action visibility filter
  -> Home Portal và Module Workspace dùng lại

Bước 7: Tạo PermissionGate/FieldGuard
  -> Button, widget, field dùng lại

Bước 8: Tạo dirty form guard
  -> Dùng cho route/app switching

Bước 9: Viết unit test
  -> Permission checker, route guard, visibility filter

Bước 10: Viết E2E smoke test
  -> Login, redirect, forbidden, sidebar visibility
```

---

## 36. Acceptance criteria

FRONTEND-03 được xem là hoàn thành khi:

1. Có route metadata type chuẩn.
2. Có route registry MVP cho AUTH, HOME, DASH, HR, ATT, LEAVE, TASK, NOTI, SYSTEM.
3. Có auth session bootstrap flow rõ ràng.
4. Có `AuthBootstrapBoundary` hoặc cơ chế tương đương cho protected route.
5. Có `PublicRouteGuard` cho login/forgot/reset.
6. Có permission checker không hard-code role.
7. Có data scope utility cơ bản.
8. Có route guard kiểm tra login, user status, company status, module status, feature flag, permission và scope.
9. Có app registry cho Home Portal/App Switcher.
10. Có sidebar registry theo module và filter theo permission.
11. Có action registry cho button/quick action.
12. Có `PermissionGate`, `FieldGuard`, `ForbiddenState` integration.
13. Có xử lý redirect returnUrl an toàn.
14. Có dirty form guard khi đổi route/app.
15. Có test case unit cho permission utility.
16. Có test case E2E cho protected route, forbidden route và menu visibility.
17. Không có đoạn code nào kiểm tra quyền bằng `user.role === 'HR'` hoặc role hard-code tương tự.
18. Tài liệu đủ để chuyển sang FRONTEND-04/05.

---

## 37. Rủi ro và cách giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Hard-code theo role | Sai quyền khi role thay đổi | Bắt buộc dùng permission/data scope utility |
| Route metadata thiếu | Sidebar, breadcrumb, QA mapping lệch | Route nào cũng phải có metadata |
| Permission backend/frontend lệch | UI hiện sai hoặc thiếu action | Backend trả `/auth/me`; QA test 403 từ API |
| Refresh token race condition | Nhiều request refresh cùng lúc | Dùng refresh lock |
| Return URL không kiểm tra | Open redirect | Chỉ nhận internal path bắt đầu bằng `/` |
| Scope hierarchy hiểu sai (vd. coi `Project` nằm trong chuỗi tuyến tính) | Lộ menu/dữ liệu sai | Áp dụng đúng chuỗi `Own ⊂ Team ⊂ Department ⊂ Company ⊂ System` (§9.3), `Project` khớp tường minh; backend vẫn guard dữ liệu cuối cùng |
| Cache user cũ sau logout | Lộ dữ liệu | Clear query cache và auth store khi logout |
| Notification deep link đi sai quyền | User vào route trái quyền | Resolve route registry + route guard lại |
| Field nhạy cảm bị frontend tự mask nhưng API vẫn trả raw | Rò rỉ dữ liệu qua network | Backend phải field-level permission/mask |

---

## 38. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| FE03-OQ-001 | Backend dùng HttpOnly cookie hay bearer token memory cho MVP? | BE/FE Lead | Cao |
| FE03-OQ-002 | Endpoint `/api/v1/auth/me` trả permissions/scopes theo format nào? | BE Lead | Cao |
| FE03-OQ-003 | Module/app registry backend-driven hay frontend local config ở MVP? | Product/BE/FE | Trung bình |
| FE03-OQ-004 | Khi thiếu scope route thì hiển thị 403 hay empty due to scope? | Product/UX | Trung bình |
| FE03-OQ-005 | Có cần realtime/polling khi quyền user thay đổi không? | Product/BE/FE | Thấp |
| FE03-OQ-006 | Field-level permission backend mask hay frontend mask? | BE/FE | Cao |
| FE03-OQ-007 | Module phase sau hiển thị locked/coming soon hay ẩn hoàn toàn? | Product | Trung bình |
| FE03-OQ-008 | Dirty form guard dùng browser confirm hay modal Design System? | FE/UX | Thấp |

---

## 39. Kết luận

FRONTEND-03 chốt lớp nền điều hướng và phân quyền cho toàn bộ frontend MVP.

Tư duy triển khai cần giữ nhất quán:

```text
Session từ backend
-> Permission/data scope từ backend
-> Route/app/sidebar/action theo metadata
-> UI ẩn/disable/mask theo permission
-> Direct URL luôn qua route guard
-> API vẫn là guard cuối cùng
```

Sau FRONTEND-03, đội frontend có thể tiếp tục triển khai:

```text
FRONTEND-04: API Client, Query Layer & Error Handling
FRONTEND-05: Layout Implementation
FRONTEND-06: AUTH & Account Frontend
```

