# FRONTEND-06: AUTH & ACCOUNT FRONTEND

> **📚 Bộ tài liệu FRONTEND — Hệ thống Quản lý Doanh nghiệp**
> [FRONTEND-01 Kiến trúc & Setup](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [FRONTEND-02 Design System](<FRONTEND-02_Design_System_Implementation.md>) · [FRONTEND-03 Routing/Auth/Permission](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [FRONTEND-04 API Client](<FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · [FRONTEND-05 Layout](<FRONTEND-05_Layout_Implementation.md>) · **FRONTEND-06 AUTH/Account** · [FRONTEND-07 Dashboard](<FRONTEND-07_Dashboard_Frontend.md>) · [FRONTEND-08 HR](<FRONTEND-08_HR_Frontend.md>) · [FRONTEND-09 Attendance](<FRONTEND-09_Attendance_Frontend.md>) · [FRONTEND-10 Leave](<FRONTEND-10_Leave_Frontend.md>) · [FRONTEND-11 Task](<FRONTEND-11_Task_Frontend.md>) · [FRONTEND-12 Notification](<FRONTEND-12_Notification_Frontend.md>) · [FRONTEND-13 System/Foundation](<FRONTEND-13_System_Foundation_Frontend.md>) · [FRONTEND-14 QA & Release](<FRONTEND-14_QA_Performance_Release_Readiness.md>)
>
> **Liên quan:** [Đặc tả: SPEC-02 AUTH](<../SPEC/SPEC-02 AUTH.md>) · [AUTH API: API-02](<../API Design/API-02 AUTH API Design.md>) · [Màn hình: UI-09](<../UI/UI-09_Module_UI_Design.md>) · [Routing/Auth: FRONTEND-03](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | FRONTEND-06 |
| Tên tài liệu | AUTH & Account Frontend |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Frontend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-05 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

FRONTEND-06 mô tả cách triển khai frontend cho nhóm chức năng **AUTH & Account** trong hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chốt phạm vi màn hình đăng nhập, quên mật khẩu, đặt lại mật khẩu, hồ sơ tài khoản và đổi mật khẩu.
2. Chốt phạm vi màn hình quản trị user, role, permission, role-permission matrix, gán role cho user, login log và security event.
3. Chuẩn hóa cách frontend tích hợp với API auth, user, role và permission.
4. Chuẩn hóa cách dùng route guard, permission guard, data scope và field-level permission trong nhóm màn AUTH/ACCOUNT/SYSTEM.
5. Chốt cấu trúc thư mục, component, hook, schema validation và query key cho module auth.
6. Chốt state UI bắt buộc: loading, validation, success, error, forbidden, locked, expired token, session expired.
7. Chốt quy tắc bảo mật frontend: không lưu token nhạy cảm trong localStorage, không log password/token, clear cache khi logout.
8. Làm cơ sở để frontend team triển khai code thật cho AUTH trước khi đi vào Dashboard, HR, ATT, LEAVE, TASK và NOTI.

---

## 3. Vị trí FRONTEND-06 trong roadmap frontend

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

FRONTEND-06 là module nghiệp vụ frontend đầu tiên nên triển khai vì toàn bộ module sau đều phụ thuộc vào session, user context, permission và auth state.

---

## 4. Căn cứ triển khai

FRONTEND-06 bám theo các quyết định đã chốt:

1. AUTH là module nền tảng để xác định người dùng, role, permission và data scope.
2. Sau đăng nhập thành công, user được điều hướng vào **Home Portal** `/home`, không đi thẳng vào dashboard nghiệp vụ.
3. Frontend chỉ ẩn/hiện/disable/mask UI để cải thiện trải nghiệm; backend vẫn là lớp kiểm tra quyền cuối cùng.
4. Mọi route protected phải đi qua auth guard và permission guard.
5. Menu, button, tab, field, table action và quick action không được hard-code theo role name; phải dựa trên permission và data scope backend trả về.
6. API client, query layer, error mapper và refresh token flow dùng lại từ FRONTEND-04.
7. Layout dùng lại từ FRONTEND-05: `AuthLayout`, `ModuleWorkspaceLayout`, `Topbar`, `Sidebar`, `AppSwitcher`.
8. Component UI dùng lại từ Design System: `AuthCard`, `Input`, `PasswordInput`, `Button`, `Alert`, `Form`, `DataTable`, `Modal`, `Drawer`, `ConfirmDialog`, `PermissionGate`, `MaskedField`, `ForbiddenState`, `EmptyState`, `ErrorState`, `Skeleton`, `StatusBadge`.
9. Các action nguy hiểm như khóa user, mở khóa user, gán role, gỡ quyền phải có confirm và nêu rõ hậu quả.
10. Không tiết lộ thông tin nhạy cảm trong lỗi đăng nhập/quên mật khẩu.

---

## 5. Phạm vi FRONTEND-06

### 5.1 Bao gồm trong MVP

| Nhóm | Nội dung |
| --- | --- |
| Public Auth | Login, forgot password, reset password, session expired state |
| Auth Session | Login mutation, logout mutation, refresh/me integration, auth bootstrap hook |
| Account Self-service | My account profile, change password, my sessions nếu API sẵn sàng |
| User Admin | User list, user detail, create user, update user, lock/unlock user, assign role |
| Role Admin | Role list, role detail, create/update role, disable role nếu có quyền |
| Permission Admin | Permission list, role-permission matrix, search/group permission by module |
| Logs | Login log, security event list ở mức đọc nếu có API |
| Permission UI | Hide/disable action, forbidden route, masked field nếu thiếu quyền |
| API integration | `auth.api.ts`, `user.api.ts`, `role.api.ts`, `permission.api.ts`, hooks và query keys |
| Mock API | MSW handler cho login, me, users, roles, permissions |
| Testing | Unit/component test cho form, hook, route guard integration, permission UI |

### 5.2 Không bao gồm trong MVP

| Nội dung | Giai đoạn đề xuất |
| --- | --- |
| SSO Google/Microsoft | Phase sau |
| MFA/2FA UI đầy đủ | Phase sau |
| IP allowlist/blocklist | Phase sau |
| Device management nâng cao | Phase sau |
| Password policy builder nâng cao | Phase sau |
| User permission override riêng lẻ | Phase sau |
| Audit diff nâng cao cho role permission | Phase sau |
| Realtime permission refresh | Phase sau |

---

## 6. Nguyên tắc UX cho AUTH & Account

### 6.1 Public auth UX

1. Form đăng nhập phải đơn giản, rõ ràng và có thể submit bằng phím Enter.
2. Lỗi đăng nhập không được tiết lộ email có tồn tại hay không.
3. Màn quên mật khẩu luôn hiển thị thông báo trung tính sau khi submit.
4. Màn đặt lại mật khẩu phải xử lý token hết hạn, token không hợp lệ và token đã dùng.
5. Nếu user đã đăng nhập và token còn hợp lệ, vào `/login` phải redirect về `/home`.
6. Loading state phải chống double submit.
7. Password input phải có nút hiện/ẩn mật khẩu.

### 6.2 Account self-service UX

1. User thường được xem thông tin tài khoản của chính mình.
2. Đổi mật khẩu yêu cầu nhập mật khẩu hiện tại, mật khẩu mới và xác nhận mật khẩu mới.
3. Sau đổi mật khẩu thành công, hiển thị toast và có thể yêu cầu đăng nhập lại nếu backend yêu cầu.
4. Nếu có màn phiên đăng nhập, user có thể xem phiên hiện tại và các phiên gần đây; terminate session khác chỉ làm nếu API hỗ trợ.

### 6.3 Admin AUTH UX

1. User list phải có search, filter, sort, pagination.
2. Role và permission phải nhóm theo module để tránh cấp quyền sai.
3. Permission matrix phải có search, filter module, dirty state và review diff trước khi lưu.
4. Gán role cho user phải hiển thị role hiện tại, role sắp thêm, role sắp gỡ và cảnh báo role nhạy cảm.
5. Khóa/mở tài khoản phải có confirm.
6. Không cho Admin thường tự nâng quyền vượt phạm vi backend trả về.
7. Không cho thao tác trên Super Admin nếu backend trả về `allowed_actions` không cho phép.

---

## 7. Route map FRONTEND-06

### 7.1 Public routes

| Route | Screen code | Layout | Permission | Ghi chú |
| --- | --- | --- | --- | --- |
| `/login` | UI-AUTH-SCREEN-001 | AuthLayout | Public | Redirect `/home` nếu đã login |
| `/forgot-password` | UI-AUTH-SCREEN-002 | AuthLayout | Public | Không tiết lộ email tồn tại |
| `/reset-password` | UI-AUTH-SCREEN-003 | AuthLayout | Public token | Token lấy từ query string |
| `/session-expired` | UI-AUTH-SCREEN-004 | Auth/System | Public | Có CTA đăng nhập lại |

### 7.2 Account routes

| Route | Screen code | Layout | Permission | Data scope |
| --- | --- | --- | --- | --- |
| `/account/profile` | UI-ACCOUNT-SCREEN-001 | ModuleWorkspaceLayout hoặc AccountLayout | Authenticated | Own |
| `/account/profile/edit` | UI-ACCOUNT-SCREEN-002 | ModuleWorkspaceLayout hoặc AccountLayout | Authenticated | Own |
| `/account/change-password` | UI-ACCOUNT-SCREEN-003 | ModuleWorkspaceLayout hoặc AccountLayout | `AUTH.PASSWORD.CHANGE` | Own |
| `/account/sessions` | UI-ACCOUNT-SCREEN-004 | ModuleWorkspaceLayout hoặc AccountLayout | Authenticated | Own |

> **Ghi chú gate hồ sơ cá nhân (khớp canonical decisions §2.2):** Màn hình hồ sơ cá nhân của chính user (`/account/profile`, `/account/profile/edit`) gate bằng `Authenticated`, KHÔNG dùng `AUTH.PROFILE.VIEW`/`AUTH.PROFILE.UPDATE` làm guard (các code này là non-guard, chỉ là nhãn mô tả). Mọi user đã đăng nhập đều xem/sửa được hồ sơ của chính mình. Riêng `/account/change-password` vẫn gate bằng `AUTH.PASSWORD.CHANGE` (đây là guard thật). `/account/sessions` là self-service `Authenticated` (không cần `AUTH.SESSION.*`).

### 7.3 System/Auth admin routes

| Route | Screen code | Layout | Permission | Data scope |
| --- | --- | --- | --- | --- |
| `/system/users` | UI-AUTH-SCREEN-005 | ModuleWorkspaceLayout | `AUTH.USER.VIEW` | Company/System |
| `/system/users/new` | UI-AUTH-SCREEN-006 | ModuleWorkspaceLayout | `AUTH.USER.CREATE` | Company/System |
| `/system/users/:id` | UI-AUTH-SCREEN-007 | ModuleWorkspaceLayout | `AUTH.USER.VIEW` | Company/System |
| `/system/users/:id/edit` | UI-AUTH-SCREEN-008 | ModuleWorkspaceLayout | `AUTH.USER.UPDATE` | Company/System |
| `/system/users/:id/roles` | UI-AUTH-SCREEN-009 | ModuleWorkspaceLayout | `AUTH.USER.ASSIGN_ROLE` | Company/System |
| `/system/roles` | UI-AUTH-SCREEN-010 | ModuleWorkspaceLayout | `AUTH.ROLE.VIEW` | Company/System |
| `/system/roles/new` | UI-AUTH-SCREEN-011 | ModuleWorkspaceLayout | `AUTH.ROLE.CREATE` | Company/System |
| `/system/roles/:id` | UI-AUTH-SCREEN-012 | ModuleWorkspaceLayout | `AUTH.ROLE.VIEW` | Company/System |
| `/system/roles/:id/edit` | UI-AUTH-SCREEN-013 | ModuleWorkspaceLayout | `AUTH.ROLE.UPDATE` | Company/System |
| `/system/roles/:id/permissions` | UI-AUTH-SCREEN-014 | ModuleWorkspaceLayout | `AUTH.PERMISSION.ASSIGN` | Company/System |
| `/system/permissions` | UI-AUTH-SCREEN-015 | ModuleWorkspaceLayout | `AUTH.PERMISSION.VIEW` | Company/System |
| `/system/login-logs` | UI-AUTH-SCREEN-016 | ModuleWorkspaceLayout | `AUTH.AUDIT_LOG.VIEW` | Company/System |
| `/system/security-events` | UI-AUTH-SCREEN-017 | ModuleWorkspaceLayout | `AUTH.AUDIT_LOG.VIEW` | Company/System |

---

## 8. Sidebar SYSTEM/AUTH đề xuất

```text
Tài khoản
- Người dùng
- Vai trò
- Quyền

Bảo mật
- Nhật ký đăng nhập
- Sự kiện bảo mật

Thiết lập
- Chính sách đăng nhập        (phase sau)
- SSO / OAuth                 (phase sau)
- MFA                         (phase sau)
```

Quy tắc:

1. Menu `Người dùng` chỉ hiện nếu có `AUTH.USER.VIEW`.
2. Menu `Vai trò` chỉ hiện nếu có `AUTH.ROLE.VIEW`.
3. Menu `Quyền` chỉ hiện nếu có `AUTH.PERMISSION.VIEW`.
4. Menu log chỉ hiện nếu có `AUTH.AUDIT_LOG.VIEW`.
5. Menu phase sau mặc định ẩn hoặc locked tùy app registry/company setting.

---

## 9. API mapping

### 9.1 Auth API

| Action frontend | Method | Endpoint đề xuất | Hook |
| --- | --- | --- | --- |
| Login | POST | `/api/v1/auth/login` | `useLoginMutation` |
| Logout | POST | `/api/v1/auth/logout` | `useLogoutMutation` |
| Refresh token | POST | `/api/v1/auth/refresh-token` | API client internal |
| Get current user | GET | `/api/v1/auth/me` | `useAuthMeQuery` |
| Get current permissions | GET | `/api/v1/auth/me/permissions` | Có thể gộp trong `/auth/me` |
| Forgot password | POST | `/api/v1/auth/forgot-password` | `useForgotPasswordMutation` |
| Reset password | POST | `/api/v1/auth/reset-password` | `useResetPasswordMutation` |
| Change password | POST | `/api/v1/auth/change-password` | `useChangePasswordMutation` |

### 9.2 User API

| Action frontend | Method | Endpoint đề xuất | Permission |
| --- | --- | --- | --- |
| List users | GET | `/api/v1/auth/users` | `AUTH.USER.VIEW` |
| User detail | GET | `/api/v1/auth/users/:id` | `AUTH.USER.VIEW` |
| Create user | POST | `/api/v1/auth/users` | `AUTH.USER.CREATE` |
| Update user | PATCH/PUT | `/api/v1/auth/users/:id` | `AUTH.USER.UPDATE` |
| Lock user | POST | `/api/v1/auth/users/:id/lock` | `AUTH.USER.LOCK` |
| Unlock user | POST | `/api/v1/auth/users/:id/unlock` | `AUTH.USER.UNLOCK` |
| Assign roles | PUT | `/api/v1/auth/users/:id/roles` | `AUTH.USER.ASSIGN_ROLE` |
| Reset user password by admin | POST | `/api/v1/auth/users/:id/reset-password` | `AUTH.USER.UPDATE` hoặc quyền riêng |

### 9.3 Role & permission API

| Action frontend | Method | Endpoint đề xuất | Permission |
| --- | --- | --- | --- |
| List roles | GET | `/api/v1/auth/roles` | `AUTH.ROLE.VIEW` |
| Role detail | GET | `/api/v1/auth/roles/:id` | `AUTH.ROLE.VIEW` |
| Create role | POST | `/api/v1/auth/roles` | `AUTH.ROLE.CREATE` |
| Update role | PATCH/PUT | `/api/v1/auth/roles/:id` | `AUTH.ROLE.UPDATE` |
| Disable role | DELETE | `/api/v1/auth/roles/:id` | `AUTH.ROLE.DELETE` |
| List permissions | GET | `/api/v1/auth/permissions` | `AUTH.PERMISSION.VIEW` |
| Get role permissions | GET | `/api/v1/auth/roles/:id/permissions` | `AUTH.ROLE.VIEW` |
| Update role permissions | PUT | `/api/v1/auth/roles/:id/permissions` | `AUTH.PERMISSION.ASSIGN` |

### 9.4 Log API

| Action frontend | Method | Endpoint đề xuất | Permission |
| --- | --- | --- | --- |
| Login logs | GET | `/api/v1/auth/login-logs` | `AUTH.AUDIT_LOG.VIEW` |
| Security events | GET | `/api/v1/auth/security-events` | `AUTH.AUDIT_LOG.VIEW` |

Lưu ý: Nếu backend API-02 dùng prefix khác như `/api/v1/users` hoặc `/api/v1/roles`, frontend chỉ cần đổi trong service layer, không đổi component.

---

## 10. Data model TypeScript đề xuất

### 10.1 Auth session model

```ts
// 6 scope chuẩn (khớp DB-02 §4.7, SPEC-02 §7.5, FRONTEND-03 §7.1).
// `Project` chỉ dùng cho TASK; là scope ngang, không nằm trong chuỗi tuyến tính.
export type DataScope = 'Own' | 'Team' | 'Department' | 'Project' | 'Company' | 'System';

export interface AuthPermission {
  code: string;
  module: string;
  resource: string;
  action: string;
  scopes: DataScope[]; // luôn là mảng hợp scope; không dùng data_scope số ít
}

export interface AuthRole {
  id: string;
  code: string;
  name: string;
  is_system?: boolean;
  scope?: DataScope;
}

export interface AuthCompany {
  id: string;
  name: string;
  code?: string;
  status: 'active' | 'inactive' | 'locked';
}

export interface AuthEmployeeSummary {
  id: string;
  employee_code: string;
  full_name: string;
  department_name?: string;
  position_name?: string;
  avatar_url?: string;
}

// `/auth/me` là payload đầy đủ một call (khớp API-02 AUTH-API-050 + BACKEND-03 §15.2):
// user, company, employee, roles, permissions, modules, session.
export interface AuthModuleAccess {
  code: string;
  name: string;
  status: 'Active' | 'Inactive' | 'Maintenance' | 'Hidden';
}

export interface AuthSessionInfo {
  id: string;
  expires_at: string;
}

export interface AuthUserMe {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  status: 'active' | 'locked' | 'inactive' | 'pending_activation';
  company: AuthCompany;
  employee?: AuthEmployeeSummary;
  roles: AuthRole[];
  permissions: AuthPermission[];
  modules: AuthModuleAccess[];
  session: AuthSessionInfo;
  allowed_actions?: string[];
}
```

Lưu ý: `/auth/me/permissions` và `/auth/me/menu` chỉ là endpoint granular bổ trợ; bootstrap dùng trực tiếp payload đầy đủ `/auth/me`, không cần gọi thêm để lấy permission/menu.

### 10.2 User admin model

```ts
export interface UserListItem {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  status: 'active' | 'locked' | 'inactive' | 'pending_activation';
  employee?: AuthEmployeeSummary;
  roles: AuthRole[];
  last_login_at?: string;
  created_at: string;
  allowed_actions?: Array<'view' | 'update' | 'lock' | 'unlock' | 'assign_role' | 'reset_password'>;
}

export interface UserDetail extends UserListItem {
  phone?: string;
  login_count?: number;
  security_flags?: string[];
  created_by?: string;
  updated_at?: string;
}
```

### 10.3 Role/permission model

```ts
export interface PermissionListItem {
  id: string;
  code: string;
  name: string;
  description?: string;
  module: string;
  resource: string;
  action: string;
  available_scopes: DataScope[];
  is_sensitive?: boolean;
}

export interface RoleListItem {
  id: string;
  code: string;
  name: string;
  description?: string;
  status: 'active' | 'inactive';
  is_system: boolean;
  user_count?: number;
  permission_count?: number;
  created_at: string;
  allowed_actions?: Array<'view' | 'update' | 'delete' | 'assign_permission'>;
}

export interface RolePermissionMatrixItem {
  permission_code: string;
  permission_name: string;
  module: string;
  resource: string;
  is_sensitive?: boolean;
  available_scopes: DataScope[];
  selected_scopes: DataScope[];
}
```

---

## 11. Cấu trúc thư mục đề xuất

```text
src/
  modules/
    auth/
      components/
        AuthCard.tsx
        LoginForm.tsx
        ForgotPasswordForm.tsx
        ResetPasswordForm.tsx
        ChangePasswordForm.tsx
        AccountProfileCard.tsx
        SessionExpiredView.tsx
        UserStatusBadge.tsx
        RoleBadgeList.tsx
        PermissionMatrix.tsx
        PermissionDiffDialog.tsx
        AssignUserRolesForm.tsx
      pages/
        LoginPage.tsx
        ForgotPasswordPage.tsx
        ResetPasswordPage.tsx
        SessionExpiredPage.tsx
        AccountProfilePage.tsx
        ChangePasswordPage.tsx
        MySessionsPage.tsx
        UserListPage.tsx
        UserDetailPage.tsx
        UserFormPage.tsx
        AssignUserRolesPage.tsx
        RoleListPage.tsx
        RoleDetailPage.tsx
        RoleFormPage.tsx
        RolePermissionMatrixPage.tsx
        PermissionListPage.tsx
        LoginLogsPage.tsx
        SecurityEventsPage.tsx
      services/
        auth.api.ts
        auth.keys.ts
        auth.types.ts
      hooks/
        useAuthMeQuery.ts
        useLoginMutation.ts
        useLogoutMutation.ts
        useForgotPasswordMutation.ts
        useResetPasswordMutation.ts
        useChangePasswordMutation.ts
        useUsersQuery.ts
        useUserDetailQuery.ts
        useCreateUserMutation.ts
        useUpdateUserMutation.ts
        useLockUserMutation.ts
        useUnlockUserMutation.ts
        useAssignUserRolesMutation.ts
        useRolesQuery.ts
        useRoleDetailQuery.ts
        useCreateRoleMutation.ts
        useUpdateRoleMutation.ts
        usePermissionsQuery.ts
        useRolePermissionMatrixQuery.ts
        useUpdateRolePermissionsMutation.ts
      schemas/
        login.schema.ts
        forgot-password.schema.ts
        reset-password.schema.ts
        change-password.schema.ts
        user.schema.ts
        role.schema.ts
        assign-role.schema.ts
      routes/
        auth.routes.tsx
        account.routes.tsx
        system-auth.routes.tsx
      mocks/
        auth.handlers.ts
        auth.fixtures.ts
      tests/
        LoginForm.test.tsx
        PermissionMatrix.test.tsx
        auth-hooks.test.ts
```

---

## 12. Query key convention

```ts
export const authKeys = {
  all: ['auth'] as const,
  me: () => [...authKeys.all, 'me'] as const,
  permissions: () => [...authKeys.all, 'me', 'permissions'] as const,
  users: {
    all: () => [...authKeys.all, 'users'] as const,
    list: (params: UserListParams) => [...authKeys.users.all(), 'list', params] as const,
    detail: (id: string) => [...authKeys.users.all(), 'detail', id] as const,
  },
  roles: {
    all: () => [...authKeys.all, 'roles'] as const,
    list: (params?: RoleListParams) => [...authKeys.roles.all(), 'list', params ?? {}] as const,
    detail: (id: string) => [...authKeys.roles.all(), 'detail', id] as const,
    permissions: (id: string) => [...authKeys.roles.detail(id), 'permissions'] as const,
  },
  permissions: {
    all: () => [...authKeys.all, 'permissions'] as const,
    list: (params?: PermissionListParams) => [...authKeys.permissions.all(), 'list', params ?? {}] as const,
  },
  logs: {
    login: (params: LogListParams) => [...authKeys.all, 'login-logs', params] as const,
    security: (params: LogListParams) => [...authKeys.all, 'security-events', params] as const,
  },
};
```

Cache rule:

| Query | staleTime đề xuất | Ghi chú |
| --- | --- | --- |
| `authKeys.me()` | 1-5 phút | Refetch khi app focus nếu cần |
| User list | 30-60 giây | Invalidate khi create/update/lock/unlock |
| User detail | 30-60 giây | Invalidate theo user id |
| Role list | 1-5 phút | Role ít đổi hơn user |
| Permission list | 10-30 phút | Permission catalog gần như static |
| Role permission matrix | 1-5 phút | Invalidate sau save matrix |
| Login/security log | 30-60 giây | Có pagination/filter |

---

## 13. API service skeleton

### 13.1 `auth.api.ts`

```ts
import { apiClient } from '@/services/api/api-client';
import type {
  AuthUserMe,
  LoginRequest,
  LoginResponse,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ChangePasswordRequest,
} from './auth.types';

export const authApi = {
  login(input: LoginRequest) {
    return apiClient.post<LoginResponse>('/auth/login', {
      body: input,
      requireAuth: false,
    });
  },

  logout() {
    return apiClient.post<void>('/auth/logout');
  },

  me() {
    return apiClient.get<AuthUserMe>('/auth/me');
  },

  forgotPassword(input: ForgotPasswordRequest) {
    return apiClient.post<void>('/auth/forgot-password', {
      body: input,
      requireAuth: false,
    });
  },

  resetPassword(input: ResetPasswordRequest) {
    return apiClient.post<void>('/auth/reset-password', {
      body: input,
      requireAuth: false,
    });
  },

  changePassword(input: ChangePasswordRequest) {
    return apiClient.post<void>('/auth/change-password', {
      body: input,
    });
  },
};
```

### 13.2 `user.api.ts`

```ts
export const userApi = {
  list(params: UserListParams) {
    return apiClient.getList<UserListItem>('/auth/users', { query: params });
  },

  detail(id: string) {
    return apiClient.get<UserDetail>(`/auth/users/${id}`);
  },

  create(input: CreateUserRequest) {
    return apiClient.post<UserDetail>('/auth/users', {
      body: input,
      idempotencyKey: createIdempotencyKey('create_user'),
    });
  },

  update(id: string, input: UpdateUserRequest) {
    return apiClient.patch<UserDetail>(`/auth/users/${id}`, { body: input });
  },

  lock(id: string, input?: LockUserRequest) {
    return apiClient.post<void>(`/auth/users/${id}/lock`, { body: input ?? {} });
  },

  unlock(id: string) {
    return apiClient.post<void>(`/auth/users/${id}/unlock`);
  },

  assignRoles(id: string, input: AssignUserRolesRequest) {
    return apiClient.put<UserDetail>(`/auth/users/${id}/roles`, { body: input });
  },
};
```

### 13.3 `role.api.ts`

```ts
export const roleApi = {
  list(params?: RoleListParams) {
    return apiClient.getList<RoleListItem>('/auth/roles', { query: params });
  },

  detail(id: string) {
    return apiClient.get<RoleDetail>(`/auth/roles/${id}`);
  },

  create(input: CreateRoleRequest) {
    return apiClient.post<RoleDetail>('/auth/roles', {
      body: input,
      idempotencyKey: createIdempotencyKey('create_role'),
    });
  },

  update(id: string, input: UpdateRoleRequest) {
    return apiClient.patch<RoleDetail>(`/auth/roles/${id}`, { body: input });
  },

  permissions(id: string) {
    return apiClient.get<RolePermissionMatrixItem[]>(`/auth/roles/${id}/permissions`);
  },

  updatePermissions(id: string, input: UpdateRolePermissionsRequest) {
    return apiClient.put<RolePermissionMatrixItem[]>(`/auth/roles/${id}/permissions`, {
      body: input,
    });
  },
};
```

---

## 14. Mutation invalidation matrix

| Mutation | Invalidate query | Extra action |
| --- | --- | --- |
| Login | `authKeys.me()` | Set token nếu dùng bearer memory, redirect `/home` |
| Logout | All query cache | Clear auth store, redirect `/login` |
| Forgot password | Không cần | Show neutral success message |
| Reset password | Không cần | Redirect `/login` |
| Change password | `authKeys.me()` optional | Toast success, có thể logout all sessions nếu backend yêu cầu |
| Create user | User list | Redirect detail hoặc list |
| Update user | User list + user detail | Toast success |
| Lock/unlock user | User list + user detail | Confirm trước khi gọi |
| Assign roles | User detail + user list + auth me nếu target là current user | Nếu current user bị đổi role, refetch session |
| Create/update role | Role list + role detail | Toast success |
| Update role permissions | Role detail + role permissions + user permissions affected optional | Show diff confirmation trước khi save |

---

## 15. Validation schema đề xuất

### 15.1 Login schema

```ts
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().min(1, 'Vui lòng nhập email').email('Email không đúng định dạng'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
  remember_me: z.boolean().optional(),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
```

### 15.2 Reset password schema

```ts
export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, 'Token không hợp lệ'),
    new_password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự'),
    confirm_password: z.string().min(1, 'Vui lòng xác nhận mật khẩu'),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    path: ['confirm_password'],
    message: 'Mật khẩu xác nhận không khớp',
  });
```

### 15.3 Change password schema

```ts
export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại'),
    new_password: z.string().min(8, 'Mật khẩu mới phải có ít nhất 8 ký tự'),
    confirm_password: z.string().min(1, 'Vui lòng xác nhận mật khẩu mới'),
    // Request field chuẩn (khớp API-02 AUTH-API-007 + BACKEND-03 §25.2).
    logout_other_sessions: z.boolean().optional().default(false),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    path: ['confirm_password'],
    message: 'Mật khẩu xác nhận không khớp',
  })
  .refine((data) => data.current_password !== data.new_password, {
    path: ['new_password'],
    message: 'Mật khẩu mới không được trùng mật khẩu hiện tại',
  });
```

Response trả `other_sessions_revoked` (boolean). Nếu user chọn `logout_other_sessions = true`, FE hiển thị xác nhận các phiên khác đã bị đăng xuất dựa trên `other_sessions_revoked`.

### 15.4 Create user schema

```ts
export const createUserSchema = z.object({
  email: z.string().min(1, 'Vui lòng nhập email').email('Email không đúng định dạng'),
  name: z.string().min(1, 'Vui lòng nhập tên người dùng'),
  employee_id: z.string().uuid().optional().nullable(),
  role_ids: z.array(z.string().uuid()).min(1, 'Vui lòng chọn ít nhất một vai trò'),
  status: z.enum(['active', 'pending_activation', 'inactive']).default('pending_activation'),
  send_activation_email: z.boolean().default(true),
});
```

---

## 16. Screen implementation detail

### 16.1 Login Page

| Thuộc tính | Nội dung |
| --- | --- |
| Route | `/login` |
| Layout | `AuthLayout` |
| Component chính | `LoginForm`, `AuthCard`, `EmailInput`, `PasswordInput`, `Button`, `Alert` |
| API | `POST /api/v1/auth/login` |
| State | idle, submitting, invalid credentials, locked, inactive, server error |
| Redirect thành công | `/home` hoặc `returnUrl` hợp lệ |

Flow:

```text
User nhập email/password
-> FE validate format
-> useLoginMutation gọi API
-> Nếu success: lưu access token nếu có, refetch /auth/me
-> Clear stale auth errors
-> Redirect /home hoặc returnUrl
-> Nếu lỗi: map error sang alert/form field
```

Quy tắc:

1. `returnUrl` chỉ chấp nhận internal path, không redirect ra domain ngoài.
2. Không hiển thị raw error từ backend nếu message nhạy cảm.
3. Không log password trong console hoặc telemetry.
4. Disable submit khi mutation pending.
5. Sau 401/invalid credentials, không clear password nếu UX muốn user sửa nhanh; nhưng không persist.

### 16.2 Forgot Password Page

| Thuộc tính | Nội dung |
| --- | --- |
| Route | `/forgot-password` |
| Layout | `AuthLayout` |
| API | `POST /api/v1/auth/forgot-password` |
| Success copy | `Nếu email tồn tại trong hệ thống, chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu.` |

Quy tắc:

1. Dù email tồn tại hay không, UI success nên giống nhau.
2. Nếu rate limit, hiển thị message nhẹ: `Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.`
3. Có link quay về đăng nhập.

### 16.3 Reset Password Page

| Thuộc tính | Nội dung |
| --- | --- |
| Route | `/reset-password?token=...` |
| Layout | `AuthLayout` |
| API | `POST /api/v1/auth/reset-password` |
| State | token missing, token invalid, token expired, submitting, success |

Quy tắc:

1. Nếu thiếu token: hiển thị `Link đặt lại mật khẩu không hợp lệ`.
2. Nếu reset thành công: redirect login sau khi user bấm `Đăng nhập`.
3. Không tự login sau reset trừ khi backend/product chốt.

### 16.4 Account Profile Page

| Thuộc tính | Nội dung |
| --- | --- |
| Route | `/account/profile` |
| Layout | `ModuleWorkspaceLayout` hoặc `AccountLayout` |
| Permission | Authenticated (hồ sơ của chính mình, không dùng `AUTH.PROFILE.VIEW` làm guard) |
| API | `GET /api/v1/auth/me` |

Nội dung:

1. Avatar, tên, email.
2. Employee link nếu có: mã nhân viên, phòng ban, chức vụ.
3. Role hiện tại dạng badge.
4. Trạng thái tài khoản.
5. Lần đăng nhập gần nhất nếu API trả.
6. CTA đổi mật khẩu nếu có quyền.

### 16.5 Change Password Page

| Thuộc tính | Nội dung |
| --- | --- |
| Route | `/account/change-password` |
| Permission | `AUTH.PASSWORD.CHANGE` |
| API | `POST /api/v1/auth/change-password` |

Form:

1. Current password.
2. New password.
3. Confirm new password.
4. Tùy chọn `logout_other_sessions` (đăng xuất các phiên khác).
5. Password strength hint nếu policy có trả.

Request gửi field `logout_other_sessions` (boolean). Response trả `other_sessions_revoked` (boolean).

Success behavior:

```text
Toast: Mật khẩu đã được thay đổi thành công.
```

Nếu request gửi `logout_other_sessions = true` và response trả `other_sessions_revoked = true`:

```text
Các phiên khác đã bị đăng xuất. Phiên hiện tại vẫn giữ; nếu backend yêu cầu đăng nhập lại thì
clear session -> redirect /login?reason=password_changed.
```

### 16.6 User List Page

| Thuộc tính | Nội dung |
| --- | --- |
| Route | `/system/users` |
| Template | List/Table |
| Permission | `AUTH.USER.VIEW` |
| API | `GET /api/v1/auth/users` |
| Primary action | `+ Tạo user` nếu có `AUTH.USER.CREATE` |

Column:

| Cột | Nội dung |
| --- | --- |
| User | Avatar, name, email |
| Employee | Employee code, department, position nếu đã link |
| Role | Role badges |
| Status | Active, Locked, Inactive, Pending |
| Last login | Relative time |
| Action | View, Edit, Lock/Unlock, Assign role |

Filter:

1. Keyword.
2. Status.
3. Role.
4. Department.
5. Linked/unlinked employee.
6. Last login range.

Row action rule:

| Action | Điều kiện hiển thị |
| --- | --- |
| View | `AUTH.USER.VIEW` |
| Edit | `AUTH.USER.UPDATE` và `allowed_actions` chứa `update` |
| Lock | `AUTH.USER.LOCK` và user đang active |
| Unlock | `AUTH.USER.UNLOCK` và user đang locked |
| Assign role | `AUTH.USER.ASSIGN_ROLE` |

### 16.7 User Form Page

Dùng cho create/update user.

Fields:

| Field | Create | Update | Ghi chú |
| --- | --- | --- | --- |
| Email | Có | Có thể readonly nếu policy | Unique theo company |
| Name | Có | Có | Tên hiển thị |
| Employee link | Optional | Optional | Search employee chưa có user |
| Role | Có | Có | Multi-select role |
| Status | Có | Có | Không cho tự lock nếu thiếu quyền |
| Send activation email | Có | Không | Nếu backend hỗ trợ |

Rule:

1. Nếu chọn employee link, hiển thị employee summary.
2. Nếu employee đã có user, disable chọn và hiển thị lý do.
3. Role nhạy cảm có warning.
4. Submit create dùng idempotency key.

### 16.8 User Detail Page

Tabs:

```text
Tổng quan
Vai trò
Phiên đăng nhập
Nhật ký bảo mật
Audit
```

Actions:

1. Sửa user.
2. Khóa/mở khóa.
3. Gán role.
4. Gửi reset password.

Rule:

1. Không hiển thị tab log nếu thiếu quyền.
2. Không hiển thị dữ liệu nhạy cảm nếu backend không trả hoặc trả masked.
3. Action nguy hiểm dùng `ConfirmDialog`.

### 16.9 Role List Page

| Thuộc tính | Nội dung |
| --- | --- |
| Route | `/system/roles` |
| Permission | `AUTH.ROLE.VIEW` |
| API | `GET /api/v1/auth/roles` |

Columns:

1. Role name/code.
2. Description.
3. System role badge.
4. User count.
5. Permission count.
6. Status.
7. Action.

### 16.10 Role Permission Matrix Page

| Thuộc tính | Nội dung |
| --- | --- |
| Route | `/system/roles/:id/permissions` |
| Permission | `AUTH.PERMISSION.ASSIGN` |
| API | `GET/PUT /api/v1/auth/roles/:id/permissions` |

UI structure:

```text
PageHeader: Role name + status + Save changes
Search permission
Module tabs/chips: AUTH | HR | ATT | LEAVE | TASK | DASH | NOTI | SYSTEM
Matrix table:
- Permission
- Own
- Team
- Department
- Company
- System
- Warning
```

Save flow:

```text
Admin chỉnh matrix
-> Dirty indicator hiển thị
-> Click Lưu
-> FE tính diff cục bộ
-> Mở PermissionDiffDialog
-> Admin xác nhận
-> useUpdateRolePermissionsMutation
-> Success toast + invalidate role permission matrix
```

Diff cần hiển thị:

1. Permission được thêm.
2. Permission bị gỡ.
3. Scope được thêm/gỡ.
4. Permission nhạy cảm bị thay đổi.

Chặn frontend:

1. Không cho save nếu không có thay đổi.
2. Không cho chọn scope ngoài `available_scopes`.
3. Nếu role là system role và backend `allowed_actions` không cho update, chuyển page sang read-only.

Backend vẫn quyết định cuối cùng.

---

## 17. Permission behavior frontend

### 17.1 Route guard

Route protected phải có metadata:

```ts
export const systemAuthRoutes = [
  {
    path: '/system/users',
    element: <UserListPage />,
    meta: {
      module: 'AUTH',
      screenCode: 'UI-AUTH-SCREEN-005',
      requiredPermission: 'AUTH.USER.VIEW',
      requiredScope: ['Company', 'System'],
      layout: 'ModuleWorkspaceLayout',
    },
  },
];
```

Guard behavior:

| Trường hợp | UI |
| --- | --- |
| Chưa login | Redirect `/login?returnUrl=...` |
| Token expired refresh success | Cho tiếp tục route |
| Token expired refresh fail | Redirect `/session-expired` hoặc `/login` |
| Thiếu permission | `ForbiddenState` |
| Có permission nhưng không có data trong scope | Empty state `Không có dữ liệu trong phạm vi của bạn` |

### 17.2 Action guard

```tsx
<PermissionGate permission="AUTH.USER.CREATE">
  <Button onClick={goCreateUser}>Tạo user</Button>
</PermissionGate>
```

Nếu action bị chặn bởi business rule từ backend:

```tsx
<Button disabled title="Không thể khóa tài khoản Super Admin">
  Khóa tài khoản
</Button>
```

### 17.3 Field-level UI

1. Không tự hiển thị field backend không trả.
2. Nếu backend trả masked value, hiển thị bằng `MaskedField`.
3. Không cố đoán hoặc restore dữ liệu nhạy cảm từ cache cũ.
4. Khi logout phải clear query cache để không lộ dữ liệu user trước.

---

## 18. Security checklist frontend

| Nhóm | Checklist |
| --- | --- |
| Token | Không lưu access token trong localStorage nếu có thể tránh |
| Token | Nếu dùng bearer memory, clear token khi logout/session expired |
| Password | Không log password, reset token, access token, refresh token |
| Password | Password field dùng type password, có toggle show/hide |
| Error | Không hiển thị raw stack trace hoặc raw backend exception |
| Redirect | Chỉ cho redirect returnUrl nội bộ |
| Cache | Clear auth/user/permission cache khi logout |
| Cache | Không persist cache chứa dữ liệu nhạy cảm |
| Permission | Không hard-code role name để cho phép action |
| Permission | Tất cả action quản trị phải dựa permission + allowed_actions |
| Sensitive action | Lock/unlock/assign permission phải confirm |
| Browser | Không đưa token reset password vào log/analytics |
| XSS | Không render HTML từ API nếu không sanitize |
| Audit | Request id từ API error hiển thị trong ErrorState nếu cần support |

---

## 19. Error mapping riêng cho AUTH

| Error kind/code | Context | UI behavior |
| --- | --- | --- |
| Invalid credentials | Login | Alert: `Email hoặc mật khẩu không đúng` |
| Account locked | Login | Alert: `Tài khoản không thể đăng nhập. Vui lòng liên hệ quản trị viên.` |
| Account inactive | Login | Alert: `Tài khoản chưa sẵn sàng để đăng nhập.` |
| Token expired | Protected route | Refresh một lần, fail thì redirect login/session expired |
| Reset token invalid | Reset password | ErrorState trong AuthCard |
| Reset token expired | Reset password | ErrorState + CTA gửi lại yêu cầu |
| Validation | Form | Inline field error + error summary |
| Forbidden | Admin screen | ForbiddenState, không lộ danh sách |
| Scope denied | Admin screen | ForbiddenState hoặc Empty due to scope |
| Conflict email exists | Create user | Inline error field email |
| Conflict role code exists | Create role | Inline error field role code |
| Business rule | Lock/gán quyền | Alert/Confirm result, refetch detail |
| Server error | Any | ErrorState/toast + request id |

---

## 20. Mock API strategy

Trong khi backend chưa hoàn thiện, dùng MSW để mock tối thiểu:

| Mock endpoint | Mục đích |
| --- | --- |
| `POST /api/v1/auth/login` | Test login success/failure |
| `POST /api/v1/auth/logout` | Test logout |
| `GET /api/v1/auth/me` | Test session bootstrap |
| `POST /api/v1/auth/forgot-password` | Test neutral success |
| `POST /api/v1/auth/reset-password` | Test reset success/token expired |
| `GET /api/v1/auth/users` | Test user table |
| `GET /api/v1/auth/users/:id` | Test user detail |
| `GET /api/v1/auth/roles` | Test role list/select |
| `GET /api/v1/auth/permissions` | Test permission matrix |
| `PUT /api/v1/auth/roles/:id/permissions` | Test save diff |

Mock account đề xuất:

```text
1. Super Admin: full permission, scope System
2. Company Admin: AUTH user/role permission, scope Company
3. HR: HR permission, không có role permission
4. Manager: Team scope, không thấy system user menu
5. Employee: Own scope, chỉ account/profile/change password
6. Locked user: login bị từ chối
```

---

## 21. Component checklist

### 21.1 Public auth components

| Component | Vai trò |
| --- | --- |
| `AuthCard` | Container form public auth |
| `LoginForm` | Form login |
| `ForgotPasswordForm` | Form gửi yêu cầu reset |
| `ResetPasswordForm` | Form nhập mật khẩu mới |
| `SessionExpiredView` | View phiên hết hạn |

### 21.2 Account components

| Component | Vai trò |
| --- | --- |
| `AccountProfileCard` | Hiển thị thông tin tài khoản |
| `ChangePasswordForm` | Đổi mật khẩu |
| `MySessionList` | Danh sách phiên đăng nhập nếu API sẵn |

### 21.3 Admin components

| Component | Vai trò |
| --- | --- |
| `UserStatusBadge` | Badge trạng thái user |
| `RoleBadgeList` | Hiển thị role dạng badge |
| `UserFilterBar` | Filter user list |
| `UserForm` | Create/update user |
| `AssignUserRolesForm` | Gán role cho user |
| `RoleForm` | Create/update role |
| `PermissionMatrix` | Bảng gán quyền theo scope |
| `PermissionDiffDialog` | Review thay đổi trước khi lưu |
| `SensitivePermissionBadge` | Cảnh báo permission nhạy cảm |

---

## 22. Test plan FRONTEND-06

### 22.1 Unit test

| Nhóm | Test case |
| --- | --- |
| Schema | Login thiếu email/password |
| Schema | Reset password confirm không khớp |
| Schema | Change password mới trùng hiện tại |
| Permission util | User có permission + scope hợp lệ |
| Permission util | User thiếu scope bị chặn |
| Diff util | Permission matrix tính đúng added/removed scope |
| Error mapper | Invalid credential map đúng login alert |

### 22.2 Component test

| Component | Test case |
| --- | --- |
| LoginForm | Submit thành công gọi mutation đúng payload |
| LoginForm | Submit lỗi hiển thị alert |
| ForgotPasswordForm | Success luôn hiển thị neutral copy |
| ResetPasswordForm | Thiếu token hiển thị error state |
| UserListPage | Thiếu quyền tạo thì ẩn CTA create |
| UserListPage | User locked hiển thị badge locked |
| PermissionMatrix | Search permission hoạt động |
| PermissionMatrix | Scope ngoài available bị disabled |
| PermissionDiffDialog | Hiển thị quyền thêm/gỡ trước khi save |

### 22.3 Integration test

| Flow | Kỳ vọng |
| --- | --- |
| Login success | Redirect `/home`, có auth context |
| Login fail | Không redirect, hiển thị lỗi |
| Token expired | Refresh một lần, fail thì redirect login/session expired |
| Logout | Clear query cache, token store, redirect login |
| User direct URL thiếu quyền | ForbiddenState |
| Create user | Invalidate user list |
| Lock user | Confirm -> mutation -> invalidate detail/list |
| Assign role | Save -> invalidate user detail/list |
| Update role permissions | Diff confirm -> mutation -> invalidate matrix |

### 22.4 E2E smoke test

1. Login bằng Super Admin.
2. Vào `/system/users` thấy danh sách user.
3. Tạo user mới ở trạng thái pending activation.
4. Gán role Employee cho user.
5. Khóa user.
6. Logout.
7. Login bằng user bị khóa phải bị từ chối.
8. Login bằng Employee active chỉ thấy account/profile/change-password, không thấy system user menu.
9. Quên mật khẩu hiển thị thông báo trung tính.
10. Reset password bằng token expired hiển thị lỗi đúng.

---

## 23. Acceptance criteria theo màn hình

### 23.1 Login

1. Validate email/password trước khi gọi API.
2. Gọi API qua `authApi.login`, không dùng fetch trực tiếp.
3. Login thành công refetch `/auth/me` hoặc set auth context từ response.
4. Redirect `/home` hoặc returnUrl nội bộ hợp lệ.
5. Login lỗi không tiết lộ email tồn tại.
6. Loading chống double submit.

### 23.2 Forgot/reset password

1. Forgot password hiển thị neutral success copy.
2. Reset password yêu cầu token hợp lệ.
3. Password confirm không khớp phải báo field error.
4. Token expired có CTA quay lại forgot password.
5. Không log token vào console.

### 23.3 Account profile/change password

1. Profile lấy từ `authKeys.me()`.
2. Role hiển thị dạng badge.
3. Employee link hiển thị nếu có.
4. Change password validate đầy đủ.
5. Success hiển thị toast và xử lý relogin nếu backend yêu cầu.

### 23.4 User admin

1. User list có search/filter/sort/pagination.
2. Row action hiển thị theo permission + allowed_actions.
3. Create/update user có validation.
4. Lock/unlock có confirm.
5. Mutation invalidate đúng query.
6. Không hiển thị dữ liệu ngoài scope.

### 23.5 Role/permission

1. Role list có search/filter nếu cần.
2. Permission matrix group theo module/resource.
3. Có dirty state khi thay đổi.
4. Save phải review diff trước.
5. Không cho chọn scope không khả dụng.
6. Permission nhạy cảm có warning.
7. Backend denied phải hiển thị lỗi rõ và refetch nếu cần.

---

## 24. Rủi ro và cách giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Frontend hard-code theo role | Sai quyền khi role thay đổi | Dùng permission/data scope/allowed_actions |
| Cache user cũ sau logout | Lộ dữ liệu | Clear query cache + auth store |
| Lưu token localStorage | Tăng rủi ro XSS | Ưu tiên HttpOnly cookie hoặc memory token |
| Permission matrix khó hiểu | Admin cấp quyền sai | Group theo module, search, warning, diff confirm |
| Login error tiết lộ email | Dễ dò tài khoản | Message trung tính |
| Reset token bị log | Lộ reset link | Không log query token, không gửi analytics raw URL |
| Lock nhầm user | User không đăng nhập được | Confirm dialog + mô tả hậu quả |
| Admin tự gỡ quyền quản trị cuối | Mất quyền vận hành | Backend chặn, frontend warning nếu detect |
| API prefix thay đổi | Sửa nhiều nơi | Tập trung endpoint trong service layer |
| Backend chưa sẵn | FE bị chờ | MSW mock theo contract |

---

## 25. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| FE06-OQ-001 | Backend chốt auth token bằng HttpOnly cookie hay bearer memory? | BE/FE Lead | Cao |
| FE06-OQ-002 | `/auth/login` trả đủ user/permissions hay cần gọi `/auth/me` sau login? | BE Lead | Cao |
| FE06-OQ-003 | `/auth/me` có trả `allowed_actions` và field-level mask không? | BE Lead | Cao |
| FE06-OQ-004 | Prefix user/role API là `/auth/users` hay `/users`? | BE/FE | Trung bình |
| FE06-OQ-005 | Có API quản lý phiên đăng nhập cá nhân trong MVP không? | Product/BE | Trung bình |
| FE06-OQ-006 | Admin reset password user bằng email link hay set password trực tiếp? | Product/BE | Cao |
| FE06-OQ-007 | Permission matrix update dùng replace toàn bộ hay patch diff? | BE/FE | Cao |
| FE06-OQ-008 | Có cần hiển thị role system read-only không? | Product/BE | Trung bình |
| FE06-OQ-009 | Login log/security event nằm trong AUTH hay FOUNDATION audit UI? | Product/BE | Trung bình |
| FE06-OQ-010 | Sau đổi mật khẩu có bắt buộc logout tất cả phiên không? | Product/Security | Trung bình |

---

## 26. Thứ tự triển khai đề xuất

### Phase 1: Public auth và session

1. Tạo `auth.types.ts`, `auth.api.ts`, `auth.keys.ts`.
2. Tạo `useLoginMutation`, `useLogoutMutation`, `useAuthMeQuery`.
3. Hoàn thiện Login/Forgot/Reset pages.
4. Kết nối auth provider/route guard đã có.
5. Test login/logout/session expired.

### Phase 2: Account self-service

1. Account profile page.
2. Change password page.
3. My sessions page nếu API có.
4. Account menu link từ Topbar.

### Phase 3: User admin

1. User list + filter + pagination.
2. User detail.
3. Create/update user form.
4. Lock/unlock confirm.
5. Assign user roles.

### Phase 4: Role & permission admin

1. Role list/detail/form.
2. Permission list.
3. Role permission matrix.
4. Permission diff dialog.
5. Save matrix + invalidation.

### Phase 5: Logs và hardening

1. Login log page.
2. Security event page.
3. Accessibility review.
4. E2E smoke test.
5. Security checklist review.

---

## 27. Definition of Done cho FRONTEND-06

FRONTEND-06 được xem là hoàn thành khi:

1. Login, forgot password, reset password hoạt động qua API client chung.
2. Login thành công điều hướng về Home Portal `/home`.
3. Logout clear token/auth store/query cache và redirect login.
4. Auth bootstrap lấy được current user, company, employee, role, permission và data scope.
5. Account profile và change password hoạt động.
6. User list/detail/create/update/lock/unlock/assign role hoạt động theo permission.
7. Role list/detail/create/update hoạt động theo permission.
8. Permission matrix hiển thị theo module/resource/scope và lưu thay đổi có review diff.
9. Route admin thiếu quyền hiển thị ForbiddenState, không lộ dữ liệu.
10. Action nguy hiểm có ConfirmDialog.
11. API validation error map đúng vào React Hook Form.
12. Query invalidation đúng sau mutation.
13. Cache nhạy cảm được clear khi logout/session expired.
14. Mock API có đủ để chạy UI khi backend chưa sẵn.
15. Unit/component/integration test tối thiểu pass.
16. Security checklist được review.
17. Các open questions còn lại được ghi nhận rõ trước khi tích hợp production.

---

## 28. Kết luận

FRONTEND-06 chốt cách triển khai nhóm chức năng AUTH & Account ở tầng frontend.

Tư duy triển khai chính:

```text
Auth UI đơn giản, an toàn
-> Session từ backend
-> Permission/data scope là nguồn hiển thị UI
-> Admin user/role/permission có guard chặt
-> Action nhạy cảm có confirm và audit phía backend
-> API client/query/error dùng chung
-> Logout/session expired phải clear dữ liệu nhạy cảm
```

Sau FRONTEND-06, đội frontend có thể tiếp tục triển khai:

```text
FRONTEND-07: Dashboard Frontend
```

Dashboard sẽ dùng session, permission, account menu, app shell và API/query foundation đã hoàn thiện từ FRONTEND-01 đến FRONTEND-06.
