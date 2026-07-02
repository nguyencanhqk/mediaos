# BACKEND-03: AUTH, SESSION, RBAC & PERMISSION GUARD

> **📚 Bộ tài liệu BACKEND — Hệ thống Quản lý Doanh nghiệp**
> [BACKEND-01 Kiến trúc/Setup](<BACKEND-01_Backend_Architecture_Project_Setup.md>) · [BACKEND-02 Migration/ORM/Seed](<BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) · **BACKEND-03 Auth/RBAC** · [BACKEND-04 Foundation](<BACKEND-04_Foundation_Backend.md>) · [BACKEND-05 HR](<BACKEND-05_HR_Backend.md>) · [BACKEND-06 Attendance](<BACKEND-06_Attendance_Backend.md>) · [BACKEND-07 Leave](<BACKEND-07_Leave_Backend.md>) · [BACKEND-08 Task](<BACKEND-08_Task_Backend.md>) · [BACKEND-09 Notification](<BACKEND-09_Notification_Backend.md>) · [BACKEND-10 Dashboard](<BACKEND-10_Dashboard_Backend.md>) · [BACKEND-11 File/Audit/Settings/Jobs](<BACKEND-11_File_Audit_Settings_System_Jobs.md>) · [BACKEND-12 API Contract/OpenAPI](<BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md>) · [BACKEND-13 Testing/Security/Perf](<BACKEND-13_Backend_Testing_Security_Performance.md>) · [BACKEND-14 Release Readiness](<BACKEND-14_Backend_Release_Readiness.md>)
>
> **Nguồn & liên quan:** [Đặc tả: SPEC-02 AUTH](<../SPEC/SPEC-02 AUTH.md>) · [DB: DB-02](<../DB/DB-02 AUTH RBAC Database Design.md>) · [API: API-02](<../API Design/API-02 AUTH API Design.md>) · [Permission Matrix: API-10](<../API Design/API-10 PERMISSION MATRIX.md>) · [Frontend: FRONTEND-03](<../FRONTEND/FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [Chỉ mục: README](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | BACKEND-03 |
| Tên tài liệu | Auth, Session, RBAC & Permission Guard |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Backend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-10, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-02 |
| Module chính | AUTH |
| Module phụ thuộc | FOUNDATION, HR, NOTI, DASH |
| Module sử dụng guard | HR, ATT, LEAVE, TASK, DASH, NOTI, FOUNDATION |

---

## 2. Mục đích tài liệu

BACKEND-03 mô tả cách triển khai lớp **xác thực**, **quản lý phiên đăng nhập**, **RBAC**, **data scope** và **permission guard** ở backend.

Tài liệu này dùng để:

1. Chốt cách backend xác thực access token và refresh token.
2. Chốt cách tạo, lưu, revoke và rotate session.
3. Chốt cách resolve `AuthContext` cho mỗi request.
4. Chốt cách tính role, permission và data scope từ database.
5. Chốt cách backend kiểm tra permission trước khi xử lý API.
6. Chốt cách backend kiểm tra target data có nằm trong scope được phép hay không.
7. Chốt cách cấp dữ liệu `/api/v1/auth/me` cho frontend route guard, Home Portal, App Switcher, Sidebar và Permission UI.
8. Chốt cách xử lý 401, 403, token hết hạn, user bị khóa, company inactive và module disabled.
9. Chốt cách ghi login log, security event và audit log cho AUTH/RBAC.
10. Làm nền để triển khai các backend module tiếp theo: HR, ATT, LEAVE, TASK, NOTI, DASH và FOUNDATION.

BACKEND-03 không chỉ phục vụ màn hình AUTH. Đây là lớp bảo mật nền cho toàn bộ hệ thống.

---

## 3. Vị trí BACKEND-03 trong roadmap backend

Roadmap backend đề xuất:

| Mã | Tên tài liệu | Mục tiêu |
| --- | --- | --- |
| BACKEND-01 | Backend Architecture & Project Setup | Chốt stack, cấu trúc source, config, module boundary, health check |
| BACKEND-02 | Database Migration, ORM & Seed Implementation | Triển khai migration, ORM schema/entity, seed nền tảng |
| BACKEND-03 | Auth, Session, RBAC & Permission Guard | Xác thực, session, role, permission, data scope, guard |
| BACKEND-04 | Foundation Backend | Company, setting, module catalog, file, audit, sequence, public holiday (skeleton, chi tiết impl xem BACKEND-11) |
| BACKEND-05 | HR Backend | Employee, department, position, contract, profile change |
| BACKEND-06 | Attendance Backend | Check-in/out, attendance record, shift, rule, adjustment, remote |
| BACKEND-07 | Leave Backend | Leave request, approval, balance, policy, ATT sync |
| BACKEND-08 | Task Backend | Project, task, assignee, comment, checklist, activity |
| BACKEND-09 | Notification Backend | Event, template, notification, delivery log |
| BACKEND-10 | Dashboard Backend | Widget registry, role dashboard, cache, summary query |
| BACKEND-11 | File, Audit, Settings & System Jobs | Impl chuẩn Foundation: file, audit, settings, sequence, holiday, system jobs |
| BACKEND-12 | API Integration Contract & OpenAPI/Swagger | OpenAPI, permission-endpoint matrix, contract test, breaking-change detection |
| BACKEND-13 | Backend Testing, Security & Performance | Unit/integration/e2e/security/performance test |
| BACKEND-14 | Backend Release Readiness | Deploy, logging, monitoring, rollback, runbook, release readiness |

BACKEND-03 nên được triển khai ngay sau BACKEND-02 vì mọi API nghiệp vụ sau đó đều cần guard.

---

## 4. Căn cứ triển khai

BACKEND-03 bám theo các quyết định đã chốt:

1. AUTH là module nền tảng, các module HR, ATT, LEAVE, TASK, DASH và NOTI đều dựa vào AUTH để xác định user, role, permission và data scope.
2. Backend là nguồn kiểm soát quyền cuối cùng. Frontend chỉ được ẩn/hiện UI để cải thiện UX.
3. MVP dùng cơ chế `Access Token + Refresh Token`.
4. Access token dùng để gọi API qua header `Authorization: Bearer <access_token>`.
5. Refresh token dùng để xin access token mới, cần lưu hash trong database và có thể bị revoke.
6. Backend không nên nhét toàn bộ permission vào access token nếu permission có thể thay đổi thường xuyên.
7. Mỗi API nghiệp vụ phải khai báo `Required permission`, `Allowed roles`, `Data scope`, `Business validation`, `Audit log` và `Notification event` nếu có.
8. Role chỉ là nhóm quyền được seed mặc định. Backend không được hard-code kiểu `if role === 'HR'` cho nghiệp vụ thông thường.
9. Data scope chuẩn gồm `Own`, `Team`, `Department`, `Project`, `Company`, `System`.
10. DB-02 dùng các bảng `users`, `user_sessions`, `password_reset_tokens`, `roles`, `permissions`, `user_roles`, `role_permissions`, `login_logs`, `user_security_events`.
11. DB-08 cung cấp `companies`, `modules`, `company_settings`, `audit_logs` và seed tracking.
12. HR cung cấp `employees`, `departments`, `direct_manager_id` để resolve scope Own/Team/Department.
13. TASK có scope `Project`, kết hợp RBAC hệ thống với project membership.
14. NOTI và DASH đọc auth context để hiển thị đúng thông báo/widget theo user.
15. Frontend cần `/api/v1/auth/me` để bootstrap user, company, employee, roles, permissions, scopes, active modules và app/menu visibility.

---

## 5. Phạm vi BACKEND-03

### 5.1 Bao gồm trong MVP

| Nhóm | Nội dung |
| --- | --- |
| Auth API | Login, logout, refresh token, me, change password, forgot password, reset password |
| Session API | Danh sách session của tôi, revoke session, logout all |
| User auth state | Kiểm tra user active/locked/deleted/must change password |
| Token service | Tạo/verify access token, tạo/hash/verify/rotate refresh token |
| Session service | Tạo session, revoke session, revoke all session, kiểm tra session active |
| RBAC service | Load role, permission, data scope của user |
| Permission guard | Kiểm tra route/API permission trước controller/service |
| Data scope guard | Kiểm tra target data nằm trong scope được phép |
| Auth context | Resolve user, company, employee, roles, permissions, scopes cho request |
| `/auth/me` | Trả session bootstrap cho frontend |
| Password flow | Đổi mật khẩu, quên mật khẩu, đặt lại mật khẩu, revoke token/session liên quan |
| Login log | Ghi login success/failed/logout/refresh failed |
| Security event | Ghi lock, unlock, password changed, reset requested, refresh reuse detected |
| Audit integration | Ghi audit log cho thao tác user/role/permission/session quan trọng |
| Cache | Cache permission ngắn hạn và invalidate khi RBAC thay đổi |
| Test | Unit, integration, e2e, security test cho auth/guard |

### 5.2 Không bao gồm sâu trong MVP

| Nội dung | Giai đoạn đề xuất | Ghi chú |
| --- | --- | --- |
| OAuth Google/Microsoft | Phase sau | Đã có bảng `user_auth_providers` để mở rộng |
| SSO doanh nghiệp | Phase sau | Cần tenant domain, SAML/OIDC |
| MFA/2FA | Phase sau | Đã chừa bảng `user_mfa_methods` |
| IP allowlist/blocklist | Phase sau | Có thể thêm company security policy |
| Device trust nâng cao | Phase sau | Có thể mở rộng `user_sessions.device_id` |
| User permission override | Phase sau | MVP dùng role permission, chưa override từng user |
| Role hierarchy phức tạp | Phase sau | MVP dùng nhiều role + union permission |
| Fine-grained ABAC đầy đủ | Phase sau | MVP dùng RBAC + data scope + optional conditions JSONB |
| Service account/API key | Phase sau | Dành cho integration |

---

## 6. Nguyên tắc bảo mật bắt buộc

### 6.1 Backend guard là bắt buộc

Mọi API protected phải đi qua pipeline:

```text
Request
-> RequestId/Correlation middleware
-> Authentication guard
-> Session guard
-> User status guard
-> Company/module status guard
-> Permission guard
-> Data scope guard
-> Controller DTO validation
-> Service business validation
-> Repository query with company_id + scope filter
-> Audit/notification/event hooks
-> Response transformer
```

Không API nghiệp vụ nào được bỏ qua auth guard, trừ endpoint được đánh dấu rõ `@Public()`.

### 6.2 Không hard-code theo role cho quyền nghiệp vụ

Không dùng:

```ts
if (user.role === 'HR') {
  // allow
}
```

Phải dùng:

```ts
await permissionGuard.assertCan(ctx, 'HR.EMPLOYEE.UPDATE', targetEmployee)
```

Role chỉ dùng để seed quyền mặc định và hiển thị nghiệp vụ. Permission + scope mới là nguồn kiểm tra cuối.

**Ngoại lệ hợp lệ duy nhất — SUPER_ADMIN/System:** Guard được phép short-circuit theo `System` scope cho SUPER_ADMIN, tức là khi grant của user chứa scope `System` thì coi như thỏa mọi permission/scope check (khớp API-02 §3.4). Đây là ngoại lệ được chốt, không phải hard-code theo role name nghiệp vụ. Mọi role khác vẫn phải đi qua permission + scope như thường.

> **CHỐT 2026-07-02: code thắng, permission engine dùng CẶP `(action, resource_type)` làm định danh — KHÔNG phải chuỗi `MODULE.RESOURCE.ACTION`.** `assertCan(ctx, 'HR.EMPLOYEE.UPDATE', ...)` ở trên là **cách viết minh hoạ**; check thật resolve về cặp `(action, resource_type)`: bảng `permissions` có `uniqueIndex('permissions_action_resource_uq', [action, resource_type])`, `role_permissions.effect ∈ {ALLOW, DENY}` (deny-overrides ở app layer) — `apps/api/src/db/schema/permissions.ts`. `/auth/me` serialize `capabilities`/`scopes` keyed `"action:resourceType"`. Lý do: chuỗi `MODULE.RESOURCE.ACTION` chỉ là nhãn đọc; guard/seed/serialize đều đi theo cặp engine → tránh drift cặp-quyền (khớp API-02 §3.4).

### 6.3 Không tin dữ liệu định danh từ frontend

Frontend không được quyết định:

```text
company_id
user_id
employee_id
role
permission
data_scope
```

Backend luôn resolve từ token/session/database/cache nội bộ.

### 6.4 Multi-tenant filter là bắt buộc

Mọi query dữ liệu tenant phải có `company_id` lấy từ `AuthContext`, trừ trường hợp `System` scope và API cross-company được thiết kế riêng.

### 6.5 Không trả dữ liệu nhạy cảm

API không bao giờ trả:

```text
password_hash
refresh_token_hash
reset_token_hash
secret setting
private file storage path
full permission raw nếu không cần thiết
```

Field nhạy cảm phải được backend mask hoặc remove nếu user thiếu field-level permission.

---

## 7. Kiến trúc module backend

### 7.1 Module chính

```text
src/
  modules/
    auth/
      auth.module.ts
      auth.controller.ts
      auth.service.ts
      auth.repository.ts
      session.service.ts
      token.service.ts
      password.service.ts
      rbac.service.ts
      permission.service.ts
      data-scope.service.ts
      auth-context.service.ts
      login-log.service.ts
      security-event.service.ts
      dto/
      guards/
      decorators/
      strategies/
      types/
      tests/
```

### 7.2 Shared security foundation

```text
src/
  common/
    guards/
      authentication.guard.ts
      permission.guard.ts
      data-scope.guard.ts
      module-status.guard.ts
    decorators/
      public.decorator.ts
      require-permission.decorator.ts
      require-any-permission.decorator.ts
      require-scope.decorator.ts
      audit-action.decorator.ts
      sensitive-field.decorator.ts
    interceptors/
      audit.interceptor.ts
      request-context.interceptor.ts
    filters/
      api-exception.filter.ts
    types/
      auth-context.type.ts
      permission.type.ts
      data-scope.type.ts
```

### 7.3 Dependency direction

```text
Controller
  -> Guard/Decorator
  -> AuthContextService
  -> PermissionService / DataScopeService
  -> Domain service
  -> Repository
  -> Database
```

Auth module có thể đọc HR employee mapping thông qua `EmployeeIdentityReader` interface để tránh phụ thuộc vòng.

---

## 8. Database mapping

BACKEND-03 không tạo lại database design, nhưng phải map đúng các bảng đã có từ DB-02 và DB-08.

### 8.1 Bảng AUTH bắt buộc

| Bảng | Backend sử dụng |
| --- | --- |
| `users` | Login, user status, password hash, user profile cơ bản |
| `user_sessions` | Refresh token hash, session active/revoked/expired, device metadata |
| `password_reset_tokens` | Forgot/reset password, activation token nếu dùng chung |
| `roles` | Danh mục role system/company |
| `permissions` | Danh mục permission toàn hệ thống |
| `user_roles` | Role active của user |
| `role_permissions` | Permission + data scope theo role |
| `login_logs` | Ghi lịch sử đăng nhập thành công/thất bại/logout |
| `user_security_events` | Ghi sự kiện bảo mật tài khoản |

### 8.2 Bảng foundation liên quan

| Bảng | Backend sử dụng |
| --- | --- |
| `companies` | Kiểm tra tenant/company active |
| `modules` | Kiểm tra module enabled/disabled, module catalog |
| `company_settings` | TTL token, password policy, lock policy nếu cấu hình |
| `audit_logs` | Ghi thao tác quan trọng |
| `seed_batches`, `seed_items` | Đảm bảo seed permission/role idempotent |

### 8.3 Bảng HR liên quan

| Bảng | Backend sử dụng |
| --- | --- |
| `employees` | Map user -> employee, employee status, department, direct manager |
| `departments` | Resolve Department scope |
| `positions`, `job_levels` | Context hiển thị hoặc rule mở rộng |

---

## 9. AuthContext chuẩn

Mỗi request protected phải có `AuthContext`.

### 9.1 Type đề xuất

```ts
export type DataScope = 'Own' | 'Team' | 'Department' | 'Project' | 'Company' | 'System'

export type PermissionGrant = {
  permission: string
  scopes: DataScope[]
  conditions?: Record<string, unknown>
}

export type AuthContext = {
  requestId: string
  correlationId?: string

  userId: string
  companyId: string | null
  sessionId: string
  accessTokenJti?: string

  email: string
  displayName: string
  userStatus: 'Pending Activation' | 'Active' | 'Inactive' | 'Locked' | 'Deleted'
  mustChangePassword: boolean

  companyStatus?: 'Active' | 'Inactive' | 'Suspended' | 'Deleted'

  employeeId?: string | null
  employeeCode?: string | null
  employeeStatus?: string | null
  departmentId?: string | null
  directManagerId?: string | null

  roles: Array<{
    id: string
    code: string
    name: string
    type: string
  }>

  permissions: Record<string, PermissionGrant>
  permissionCodes: string[]

  client: {
    ip?: string
    userAgent?: string
    clientType?: 'web' | 'mobile' | 'system'
    clientVersion?: string
    deviceId?: string
  }
}
```

### 9.2 Quy tắc resolve AuthContext

```text
1. Đọc Authorization header.
2. Verify access token chữ ký + expiry + token_type = access.
3. Lấy user_id, company_id, session_id, jti từ token.
4. Kiểm tra session còn active nếu backend lưu session.
5. Kiểm tra user tồn tại và status = Active.
6. Kiểm tra company active nếu user thuộc company.
7. Load employee mapping từ HR nếu có.
8. Load roles active của user.
9. Load permissions active từ role_permissions.
10. Merge permission + scope.
11. Gắn AuthContext vào request.
```

#### Quy tắc trạng thái user/company khi resolve

1. **`Deleted` là sentinel soft-delete, không phải trạng thái định tuyến.** User `Deleted` (đi kèm `deleted_at`) và company `Deleted` không thể login và không thể tiếp tục dùng API; backend coi như không tồn tại trong luồng auth bình thường. Không thiết kế route/màn hình riêng cho trạng thái `Deleted`.
2. **User `Inactive`/`Locked`/`Deleted`** → backend từ chối: `AUTH-ERR-USER-INACTIVE` (Inactive/Deleted) hoặc `AUTH-ERR-USER-LOCKED` (Locked).
3. **Company `Inactive`, `Suspended` và `Deleted`** đều map về cùng một lỗi 403 `AUTH-ERR-COMPANY-INACTIVE`. `Suspended` không có luồng riêng — xử lý y hệt company inactive.

### 9.3 Không nhét full permission vào access token

Access token chỉ nên chứa claim tối thiểu:

```json
{
  "sub": "user_uuid",
  "company_id": "company_uuid",
  "session_id": "session_uuid",
  "token_type": "access",
  "jti": "jwt_id",
  "iat": 1718850000,
  "exp": 1718853600
}
```

Permission được load từ DB/cache để khi role/permission thay đổi có thể invalidate nhanh.

---

## 10. Token strategy

### 10.1 Cơ chế MVP đề xuất

| Token | Cách dùng | Lưu phía client web | Lưu backend |
| --- | --- | --- | --- |
| Access token | Gọi API qua `Authorization: Bearer` | Memory hoặc secure client store theo quyết định FE/BE | Không cần lưu full token, có thể lưu `jti` nếu cần revoke |
| Refresh token | Xin access token mới | HttpOnly Secure SameSite cookie cho web; secure storage cho mobile | Hash trong `user_sessions.refresh_token_hash` |
| Password reset token | Đặt lại mật khẩu | Chỉ nằm trong link/form reset | Hash trong `password_reset_tokens` |

### 10.2 TTL đề xuất

| Token | TTL MVP đề xuất | Ghi chú |
| --- | --- | --- |
| Access token | 15 - 60 phút | Nên chọn 15 - 30 phút nếu dữ liệu nhạy cảm cao |
| Refresh token | 7 - 30 ngày | Có thể cấu hình theo company |
| Reset token | 15 - 60 phút | Dùng một lần |

### 10.3 Refresh token rotation

MVP nên triển khai refresh token rotation:

```text
POST /api/v1/auth/refresh-token
-> Verify refresh token hash với session active
-> Nếu hợp lệ: revoke token cũ hoặc update hash token mới
-> Tạo access token mới
-> Tạo refresh token mới
-> Update user_sessions.refresh_token_hash
-> Return access token + set refresh cookie mới
```

Nếu phát hiện refresh token cũ đã bị dùng lại sau khi rotate:

```text
1. Revoke toàn bộ session của user hoặc session liên quan.
2. Ghi user_security_events = REFRESH_TOKEN_REUSE_DETECTED.
3. Trả 401 và yêu cầu đăng nhập lại.
```

### 10.4 Khi nào revoke session

| Sự kiện | Hành động |
| --- | --- |
| Logout | Revoke session hiện tại |
| Logout all | Revoke toàn bộ session active của user |
| Change password | Revoke toàn bộ session cũ, có thể giữ session hiện tại nếu cấu hình cho phép |
| Reset password | Revoke toàn bộ session active |
| Lock user | Revoke toàn bộ session active |
| User deleted/inactive | Revoke toàn bộ session active |
| Role/permission thay đổi | Invalidate permission cache; không bắt buộc revoke session |
| Suspicious login | Có thể revoke session và ghi security event |

> **CHỐT 2026-07-02: code thắng, `refresh_tokens` (rotation/family) SONG SONG `user_sessions` — CẢ HAI đang live, không drop cái nào.** `apps/api/src/db/schema/auth.ts` giữ đồng thời: (1) `refresh_tokens` với `family_id` (login phát family mới; rotation kế thừa; reuse/logout thu hồi cả họ) và (2) `user_sessions` (bảng phiên canonical `refresh_token_hash`). Code chú thích rõ "KHÔNG drop refresh_tokens". Ngoài ra, **đổi mật khẩu thu hồi MỌI phiên** (không giữ phiên hiện tại): `auth.service.ts` thu hồi tất cả `refresh_tokens` còn sống + `revokeAllSessionsForUserTx(..., "password_changed")` cho `user_sessions` (mirror reset password, khớp SPEC-02 §14.5) — hàng "Change password" ở bảng trên đọc là revoke-ALL. Lý do: hai lớp phiên cùng tồn tại tới khi hợp nhất (S2-OQ-001); mọi thao tác thu hồi phải quét cả hai.

---

## 11. Password strategy

### 11.1 Hash mật khẩu

Khuyến nghị:

```text
Argon2id nếu stack hỗ trợ tốt.
Bcrypt nếu muốn phổ biến, cost tối thiểu 10-12 cho MVP.
```

Không dùng:

```text
MD5
SHA1
SHA256 plain hash không salt chuyên dụng
```

### 11.2 Password policy MVP

| Rule | Đề xuất MVP |
| --- | --- |
| Min length | 8 hoặc 10 ký tự |
| Complexity | Có chữ hoa, chữ thường, số hoặc ký tự đặc biệt nếu công ty bật policy |
| Confirm password | Bắt buộc trong reset/change |
| Same old password | Không cho đặt trùng mật khẩu hiện tại |
| Common password | Nên chặn danh sách mật khẩu phổ biến |
| Must change password | Hỗ trợ `users.must_change_password` |

### 11.3 Login failed policy

| Điều kiện | Hành động |
| --- | --- |
| Sai mật khẩu | Tăng `failed_login_count` |
| Vượt ngưỡng, ví dụ 5 lần | Khóa tạm hoặc yêu cầu reset tùy setting |
| Login thành công | Reset `failed_login_count = 0`, update `last_login_at`, `last_login_ip` |
| Login fail nhiều lần | Ghi `login_logs` và `user_security_events` |

> **CHỐT 2026-07-02: code thắng, lỗi login là 401 ĐỒNG NHẤT cho mọi nhánh (sai mật khẩu · user không tồn tại · Locked · Inactive · company Inactive).** `auth.service.ts` ném cùng `UnauthorizedException(UNIFORM_LOGIN_ERROR)` (const dòng 61) → anti-enumeration, KHÔNG lộ trạng thái tài khoản qua HTTP code/message. Việc tăng `failed_login_count` / khoá tạm vẫn diễn ra ở tầng service nhưng KHÔNG phản ánh khác biệt ra response. 403 trạng thái (locked/inactive) chỉ dùng cho API protected sau xác thực. Lý do: mọi thông điệp login khác nhau đều là kênh dò tài khoản.

---

## 12. API Auth public/protected

### 12.1 Public endpoints

| Method | Endpoint | Mục đích | Auth |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | Đăng nhập | Public |
| POST | `/api/v1/auth/refresh-token` | Refresh access token | Public nhưng cần refresh token hợp lệ |
| POST | `/api/v1/auth/forgot-password` | Yêu cầu reset password | Public |
| POST | `/api/v1/auth/reset-password` | Đặt lại password bằng token | Public |
| GET | `/api/v1/health` | Health check | Public |

> **CHỐT 2026-07-02: code thắng, path THẬT (`apps/api/src/auth/auth.controller.ts`).** Refresh = `/api/v1/auth/refresh` (`@Post("refresh")`), KHÔNG phải `/refresh-token`. Thêm public/near-public: `POST /api/v1/auth/2fa/verify` (bước 2 login bằng `challengeToken`) và `GET /api/v1/auth/redirect-allowed` (allowlist SSO redirect). Ở §12.2, path THẬT là `GET /api/v1/auth/sessions` + `POST /api/v1/auth/sessions/:id/revoke` + `POST /api/v1/auth/sessions/revoke-others` (thay `/auth/my-sessions` và `/auth/logout-all`). Lý do: pin route thật để FE/QA gọi đúng.

### 12.2 Protected user endpoints

| Method | Endpoint | Permission | Scope | Mục đích |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/auth/me` | Authenticated | Own | Lấy bootstrap session/current user |
| POST | `/api/v1/auth/logout` | Authenticated | Own | Logout session hiện tại |
| POST | `/api/v1/auth/logout-all` | Authenticated | Own | Logout toàn bộ session của tôi |
| POST | `/api/v1/auth/change-password` | `AUTH.PASSWORD.CHANGE` | Own | Đổi mật khẩu |
| GET | `/api/v1/auth/my-sessions` | Authenticated | Own | Xem phiên đăng nhập của tôi |
| DELETE | `/api/v1/auth/my-sessions/{session_id}` | Authenticated | Own | Revoke một session của tôi |

### 12.3 Admin user/role endpoints

| Method | Endpoint | Permission | Scope |
| --- | --- | --- | --- |
| GET | `/api/v1/auth/users` | `AUTH.USER.VIEW` | Company/System |
| POST | `/api/v1/auth/users` | `AUTH.USER.CREATE` | Company/System |
| GET | `/api/v1/auth/users/{user_id}` | `AUTH.USER.VIEW` | Company/System hoặc Own nếu self |
| PATCH | `/api/v1/auth/users/{user_id}` | `AUTH.USER.UPDATE` | Company/System |
| POST | `/api/v1/auth/users/{user_id}/lock` | `AUTH.USER.LOCK` | Company/System |
| POST | `/api/v1/auth/users/{user_id}/unlock` | `AUTH.USER.UNLOCK` | Company/System |
| POST | `/api/v1/auth/users/{user_id}/assign-roles` | `AUTH.USER.ASSIGN_ROLE` | Company/System |
| DELETE | `/api/v1/auth/users/{user_id}/roles/{role_id}` | `AUTH.USER.ASSIGN_ROLE` | Company/System |
| GET | `/api/v1/auth/roles` | `AUTH.ROLE.VIEW` | Company/System |
| POST | `/api/v1/auth/roles` | `AUTH.ROLE.CREATE` | Company/System |
| PATCH | `/api/v1/auth/roles/{role_id}` | `AUTH.ROLE.UPDATE` | Company/System |
| DELETE | `/api/v1/auth/roles/{role_id}` | `AUTH.ROLE.DELETE` | Company/System |
| GET | `/api/v1/auth/permissions` | `AUTH.PERMISSION.VIEW` | Company/System |
| PUT | `/api/v1/auth/roles/{role_id}/permissions` | `AUTH.PERMISSION.ASSIGN` | Company/System |
| GET | `/api/v1/auth/login-logs` | `AUTH.AUDIT_LOG.VIEW` | Company/System |
| GET | `/api/v1/auth/security-events` | `AUTH.AUDIT_LOG.VIEW` | Company/System |

---

## 13. Login flow

### 13.1 Request

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{
  "email": "nguyenvana@company.com",
  "password": "********",
  "remember_me": true
}
```

### 13.2 Luồng xử lý backend

```text
1. Validate email/password.
2. Normalize email lowercase.
3. Tìm user theo normalized_email và company context nếu có.
4. Nếu user không tồn tại: trả lỗi generic, ghi login failed nếu phù hợp.
5. Kiểm tra user.status = Active.
6. Verify password bằng password_hash.
7. Nếu sai: tăng failed_login_count, ghi login log, có thể lock nếu vượt ngưỡng.
8. Nếu đúng: reset failed_login_count.
9. Tạo user_sessions record.
10. Tạo access token.
11. Tạo refresh token, hash và lưu vào user_sessions.
12. Load AuthContext tối thiểu.
13. Ghi login_logs LOGIN_SUCCESS.
14. Return token + user bootstrap tối thiểu hoặc yêu cầu frontend gọi /auth/me.
```

### 13.3 Response thành công đề xuất

```json
{
  "success": true,
  "message": "Đăng nhập thành công",
  "data": {
    "access_token": "eyJhbGciOi...",
    "expires_in": 1800,
    "token_type": "Bearer",
    "user": {
      "id": "user_uuid",
      "email": "nguyenvana@company.com",
      "display_name": "Nguyễn Văn A",
      "must_change_password": false
    }
  },
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-06-20T21:00:00+07:00"
  }
}
```

Nếu refresh token dùng HttpOnly cookie, response body không cần trả `refresh_token`.

> **CHỐT 2026-07-02: code thắng, login response là UNION hai nhánh.** Khi user CHƯA bật 2FA → trả token như trên. Khi user ĐÃ bật 2FA → `login()` trả `{ twoFactorRequired: true, challengeToken }` (`auth.service.ts:343-344`) thay vì token; client gọi tiếp `POST /api/v1/auth/2fa/verify` (verify `challengeToken` + mã TOTP/recovery, single-use) để lấy token. Ngoài ra login request THẬT cần `companySlug` bắt buộc (`loginRequestSchema` = `{ companySlug, email, password }`, `contracts/auth.ts:10`). Lý do: BE trả 2 hình dạng response tuỳ trạng thái 2FA — client phải xử lý cả hai.

### 13.4 Lỗi login

| HTTP | Code | Trường hợp | Message |
| --- | --- | --- | --- |
| 400 | `AUTH-ERR-VALIDATION` | Thiếu/sai format email/password | Dữ liệu đăng nhập không hợp lệ |
| 401 | `AUTH-ERR-INVALID-CREDENTIALS` | Email hoặc mật khẩu sai | Email hoặc mật khẩu không đúng |
| 403 | `AUTH-ERR-USER-LOCKED` | Tài khoản bị khóa | Tài khoản của bạn đã bị khóa |
| 403 | `AUTH-ERR-USER-INACTIVE` | Tài khoản inactive/deleted | Tài khoản không còn hoạt động |
| 403 | `AUTH-ERR-MUST-CHANGE-PASSWORD` | Cần đổi mật khẩu | Bạn cần đổi mật khẩu để tiếp tục |
| 429 | `AUTH-ERR-TOO-MANY-ATTEMPTS` | Login fail quá nhiều | Vui lòng thử lại sau |

Không nên thông báo rõ email có tồn tại hay không.

> **CHỐT 2026-07-02: code thắng — 3 nhánh 403 (`USER-LOCKED`, `USER-INACTIVE`, `MUST-CHANGE-PASSWORD`) ở nhánh LOGIN được GỘP về 401 ĐỒNG NHẤT.** `auth.service.ts` login ném cùng `UnauthorizedException(UNIFORM_LOGIN_ERROR)` cho mọi lý do thất bại (sai mật khẩu · không tồn tại · Locked · Inactive · company Inactive) → anti-enumeration. 403 trạng thái chỉ dùng cho **API protected** sau khi đã xác thực (guard trạng thái user/company), KHÔNG cho `/auth/login`. `must_change_password` được surface qua `/auth/me` + response sau login, không phải 403 tại login. Lý do: khác biệt HTTP code/message ở login = kênh dò trạng thái tài khoản. Khớp API-02 §7 AUTH-API-001.

---

## 14. Refresh token flow

### 14.1 Request

```http
POST /api/v1/auth/refresh-token
```

Web dùng HttpOnly cookie:

```text
Cookie: refresh_token=...
```

Mobile có thể gửi body nếu không dùng cookie:

```json
{
  "refresh_token": "opaque_refresh_token"
}
```

### 14.2 Luồng xử lý

```text
1. Lấy refresh token từ cookie/body.
2. Hash refresh token input.
3. Tìm user_sessions theo refresh_token_hash.
4. Kiểm tra session chưa expired, chưa revoked.
5. Kiểm tra user vẫn Active.
6. Kiểm tra company active.
7. Rotate refresh token nếu bật.
8. Update last_used_at.
9. Tạo access token mới.
10. Return access token mới.
```

### 14.3 Response

```json
{
  "success": true,
  "message": "Làm mới phiên đăng nhập thành công",
  "data": {
    "access_token": "eyJhbGciOi...",
    "expires_in": 1800,
    "token_type": "Bearer"
  },
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-06-20T21:10:00+07:00"
  }
}
```

---

## 15. `/api/v1/auth/me` bootstrap contract

Endpoint này là cầu nối giữa backend guard và frontend guard.

### 15.1 Mục đích

Frontend dùng `/auth/me` để:

1. Biết user hiện tại.
2. Biết company hiện tại.
3. Biết employee mapping.
4. Biết role hiện tại.
5. Biết permission và data scope.
6. Biết module nào active.
7. Lọc Home Portal apps, App Switcher, sidebar, button, widget, field.
8. Hiển thị đúng trạng thái must change password, locked/inactive/session expired.

### 15.2 Response đề xuất

```json
{
  "success": true,
  "message": "Lấy thông tin phiên đăng nhập thành công",
  "data": {
    "user": {
      "id": "user_uuid",
      "email": "nguyenvana@company.com",
      "display_name": "Nguyễn Văn A",
      "avatar_url": null,
      "status": "Active",
      "must_change_password": false
    },
    "company": {
      "id": "company_uuid",
      "name": "Demo Company",
      "status": "Active"
    },
    "employee": {
      "id": "employee_uuid",
      "employee_code": "EMP0001",
      "full_name": "Nguyễn Văn A",
      "department_id": "department_uuid",
      "direct_manager_id": "manager_employee_uuid",
      "employment_status": "Official"
    },
    "roles": [
      {
        "id": "role_uuid",
        "code": "EMPLOYEE",
        "name": "Employee"
      }
    ],
    "permissions": [
      {
        "code": "ATT.ATTENDANCE.CHECK_IN",
        "scopes": ["Own"]
      },
      {
        "code": "LEAVE.REQUEST.CREATE",
        "scopes": ["Own"]
      }
    ],
    "modules": [
      {
        "code": "DASH",
        "name": "Dashboard",
        "status": "Active"
      },
      {
        "code": "ATT",
        "name": "Chấm công",
        "status": "Active"
      }
    ],
    "session": {
      "id": "session_uuid",
      "expires_at": "2026-07-20T21:00:00+07:00"
    }
  },
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-06-20T21:15:00+07:00"
  }
}
```

### 15.3 Quy tắc response `/auth/me`

1. Không trả `password_hash`.
2. Không trả `refresh_token_hash`.
3. Không trả permission inactive.
4. Không trả role expired/inactive.
5. Nếu user có nhiều role, merge permission theo role active.
6. Nếu permission trùng nhưng nhiều scope, **luôn trả `scopes: DataScope[]` là mảng hợp (union) các scope** cho permission đó. Không serialize thành một `data_scope` số ít ở effective permission. `data_scope` (số ít) chỉ tồn tại ở từng row `role_permissions` trong DB; sau khi merge nhiều role/row, kết quả luôn là `scopes[]`.
7. `/auth/me` là **payload đầy đủ một call**: trả `user`, `company`, `employee`, `roles`, `permissions`, `modules`, `session`. `/auth/me/permissions` và `/auth/me/menu` là endpoint granular bổ trợ, không thay thế payload đầy đủ. Backend vẫn giữ map nội bộ cho guard.

---

## 16. RBAC service

### 16.1 Nguồn dữ liệu

```text
users
-> user_roles active
-> roles active
-> role_permissions active
-> permissions active
```

### 16.2 Quy tắc role active

Role được xem là active khi:

```text
user_roles.is_active = true
user_roles.deleted_at IS NULL
(user_roles.expired_at IS NULL OR user_roles.expired_at > now())
roles.status = Active
roles.deleted_at IS NULL
```

### 16.3 Quy tắc permission active

Permission được xem là active khi:

```text
role_permissions.is_active = true
role_permissions.deleted_at IS NULL
permissions.is_active = true
```

### 16.4 Merge permission nhiều role

Nếu user có nhiều role:

```text
Permission cuối = union(permission từ tất cả role active)
Scope cuối của một permission = union(scope từ các grant active)
Condition cuối = merge hoặc giữ theo từng grant tùy permission service
```

Ví dụ:

```text
User có role EMPLOYEE: HR.EMPLOYEE.VIEW scope Own
User có role MANAGER: HR.EMPLOYEE.VIEW scope Team
=> User có HR.EMPLOYEE.VIEW scopes [Own, Team]
```

### 16.5 Scope strength

Dùng khi cần chọn scope mạnh nhất:

```text
System > Company > Department > Team > Project > Own
```

Lưu ý: `Project` không phải lúc nào cũng mạnh hơn `Team`. Với TASK, Project là scope riêng theo project membership. Vì vậy service nên hỗ trợ both:

1. `getScopeSet(permission)` để check intersection.
2. `getStrongestScope(permission, domain)` nếu cần hiển thị hoặc query đơn giản.

---

## 17. Permission guard

### 17.1 Decorator đề xuất

```ts
@Public()
@RequirePermission('HR.EMPLOYEE.VIEW')
@RequirePermission('LEAVE.REQUEST.APPROVE', { scopes: ['Team', 'Company', 'System'] })
@RequireAnyPermission(['AUTH.USER.VIEW', 'AUTH.ROLE.VIEW'])
@RequireAllPermissions(['TASK.TASK.UPDATE', 'TASK.TASK.ASSIGN'])
@RequireModule('HR')
@AuditAction({ module: 'HR', action: 'EMPLOYEE_VIEW', target: 'employees' })
```

### 17.2 Luồng permission guard

```text
1. Đọc metadata RequiredPermission từ route.
2. Nếu route Public -> bỏ qua authentication.
3. Nếu route không Public -> yêu cầu AuthContext.
4. Kiểm tra permission code có trong AuthContext.permissions.
5. Nếu route yêu cầu scope cụ thể -> kiểm tra scope intersection.
6. Nếu thiếu permission -> throw ForbiddenError.
7. Nếu đủ permission -> pass sang controller/service.
```

### 17.3 Pseudocode

```ts
async function assertPermission(
  ctx: AuthContext,
  permission: string,
  requiredScopes?: DataScope[],
) {
  const grant = ctx.permissions[permission]

  if (!grant) {
    throw new ForbiddenError('AUTH-ERR-FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này')
  }

  if (requiredScopes?.length) {
    const ok = grant.scopes.some(scope => requiredScopes.includes(scope))
    if (!ok) {
      throw new ForbiddenError('AUTH-ERR-FORBIDDEN', 'Bạn không có phạm vi dữ liệu phù hợp')
    }
  }

  return grant
}
```

---

## 18. Data scope guard

Permission guard chỉ trả lời câu hỏi:

```text
User có quyền làm hành động này không?
```

Data scope guard trả lời câu hỏi:

```text
Target data cụ thể có nằm trong phạm vi user được phép không?
```

### 18.1 Scope semantics

| Scope | Ý nghĩa backend | Cách kiểm tra target |
| --- | --- | --- |
| Own | Dữ liệu của chính user/employee | `target.user_id = ctx.userId` hoặc `target.employee_id = ctx.employeeId` |
| Team | Dữ liệu nhân viên trực thuộc quản lý | `target.employee.direct_manager_id = ctx.employeeId` hoặc nằm trong team tree nếu bật |
| Department | Dữ liệu thuộc phòng ban | `target.department_id = ctx.departmentId` |
| Project | Dữ liệu thuộc project liên quan | User là project member/owner/manager hoặc assignee/watcher theo rule |
| Company | Dữ liệu cùng company | `target.company_id = ctx.companyId` |
| System | Dữ liệu toàn hệ thống | Chỉ role/permission đặc biệt, kiểm soát chặt |

### 18.2 Scope check cho single resource

```ts
async function assertResourceInScope(params: {
  ctx: AuthContext
  permission: string
  target: ScopeTarget
}) {
  const grant = ctx.permissions[params.permission]
  if (!grant) throw new ForbiddenError()

  if (grant.scopes.includes('System')) return true
  if (grant.scopes.includes('Company') && params.target.companyId === params.ctx.companyId) return true
  if (grant.scopes.includes('Own') && params.target.employeeId === params.ctx.employeeId) return true
  if (grant.scopes.includes('Department') && params.target.departmentId === params.ctx.departmentId) return true

  if (grant.scopes.includes('Team')) {
    return await isInManagedTeam(params.ctx.employeeId, params.target.employeeId)
  }

  if (grant.scopes.includes('Project')) {
    return await isInProjectScope(params.ctx, params.target.projectId)
  }

  throw new ForbiddenError('AUTH-ERR-FORBIDDEN', 'Dữ liệu không nằm trong phạm vi được phép')
}
```

### 18.3 Scope filter cho list query

Không chỉ check sau khi query. List API phải filter từ database.

Ví dụ:

```ts
function applyEmployeeScopeFilter(query, ctx, permission) {
  const scopes = ctx.permissions[permission]?.scopes ?? []

  if (scopes.includes('System')) return query
  if (scopes.includes('Company')) return query.where({ companyId: ctx.companyId })

  if (scopes.includes('Department')) {
    return query.where({ companyId: ctx.companyId, departmentId: ctx.departmentId })
  }

  if (scopes.includes('Team')) {
    return query.where({ companyId: ctx.companyId, directManagerId: ctx.employeeId })
  }

  if (scopes.includes('Own')) {
    return query.where({ companyId: ctx.companyId, id: ctx.employeeId })
  }

  return query.whereRaw('1 = 0')
}
```

### 18.4 Scope theo module

| Module | Own | Team | Department | Project | Company | System |
| --- | --- | --- | --- | --- | --- | --- |
| HR | Hồ sơ của tôi | Nhân viên trực thuộc | Nhân viên cùng phòng ban | Không chính | Toàn công ty | Liên công ty |
| ATT | Bảng công của tôi | Bảng công team | Bảng công phòng ban | Không chính | Toàn công ty | Liên công ty |
| LEAVE | Đơn nghỉ của tôi | Đơn nghỉ team | Đơn nghỉ phòng ban | Không chính | Toàn công ty | Liên công ty |
| TASK | Task của tôi | Task team nếu có manager rule | Task theo phòng ban | Project liên quan | Toàn công ty | Liên công ty |
| DASH | Widget của tôi | Widget team | Widget phòng ban | Widget project | Dashboard công ty | System dashboard |
| NOTI | Thông báo của tôi | Admin view theo team nếu thiết kế | Theo phòng ban nếu thiết kế | Theo project nếu thiết kế | Admin notification company | System notification |

---

## 19. Field-level permission và masking

Một số field nhạy cảm không nên trả raw dù user xem được resource.

### 19.1 Ví dụ field nhạy cảm

| Module | Field | Permission đề xuất |
| --- | --- | --- |
| HR | CCCD/CMND, ngày sinh, số tài khoản, địa chỉ cá nhân | `HR.EMPLOYEE.SENSITIVE_VIEW` |
| AUTH | Security events, login IP, session device | `AUTH.AUDIT_LOG.VIEW` |
| ATT | GPS, ảnh check-in nếu có | `ATT.ATTENDANCE.SENSITIVE_VIEW` |
| LEAVE | File chứng minh nghỉ bệnh nếu có | `LEAVE.REQUEST.SENSITIVE_VIEW` |
| PAYROLL phase sau | Lương, phụ cấp, thuế | Permission riêng, không cấp mặc định cho HR |

### 19.2 Quy tắc masking

```text
1. Repository có thể lấy raw data theo scope hợp lệ.
2. Response mapper kiểm tra field-level permission.
3. Nếu thiếu quyền: remove field hoặc mask.
4. Không để frontend tự mask dữ liệu mà API vẫn trả raw qua network.
```

Ví dụ:

```json
{
  "identity_number": "********1234",
  "bank_account_number": null
}
```

---

## 20. Module/app status guard

Mỗi request thuộc module nghiệp vụ nên kiểm tra module có active với company không.

### 20.1 Quy tắc

```text
1. Super Admin/System có thể truy cập module catalog theo quyền.
2. User công ty chỉ gọi API module nếu module enabled cho company.
3. Nếu module maintenance/disabled, trả 403 hoặc 503 tùy trạng thái.
4. Endpoint AUTH cơ bản như login/me/logout không phụ thuộc module catalog nghiệp vụ.
```

### 20.2 Lỗi đề xuất

| HTTP | Code | Trường hợp |
| --- | --- | --- |
| 403 | `MODULE-ERR-DISABLED` | Module chưa được bật cho company |
| 503 | `MODULE-ERR-MAINTENANCE` | Module đang bảo trì |

---

## 21. Permission cache

### 21.1 Mục tiêu

Giảm query lặp lại ở mọi request nhưng vẫn đảm bảo quyền thay đổi được áp dụng nhanh.

### 21.2 Cache key đề xuất

```text
auth:permissions:{company_id}:{user_id}:v{permission_version}
auth:me:{company_id}:{user_id}:v{permission_version}
```

`permission_version` có thể nằm ở user metadata, company setting hoặc bảng version riêng. MVP có thể dùng TTL ngắn.

### 21.3 TTL đề xuất

| Cache | TTL |
| --- | --- |
| Permission grants | 1 - 5 phút |
| `/auth/me` bootstrap | 30 giây - 2 phút |
| Module registry | 5 - 15 phút |

### 21.4 Khi nào invalidate

| Sự kiện | Invalidate |
| --- | --- |
| Assign/remove role | User permission cache |
| Update role permission | Tất cả user có role đó hoặc company permission cache |
| Disable permission | Company/global permission cache |
| Lock/unlock user | User auth cache + session check |
| Change employee department/manager | Data scope cache liên quan |
| Disable module | Module registry + auth/me cache |

---

## 22. Audit log, login log và security event

### 22.1 Login logs

Ghi vào `login_logs` cho:

| Event | Khi nào |
| --- | --- |
| `LOGIN_SUCCESS` | Đăng nhập thành công |
| `LOGIN_FAILED` | Sai email/password hoặc user inactive/locked |
| `LOGOUT` | User logout |
| `REFRESH_SUCCESS` | Refresh token thành công nếu cần truy vết |
| `REFRESH_FAILED` | Refresh token sai/hết hạn/revoked |

### 22.2 Security events

Ghi vào `user_security_events` cho:

| Event | Khi nào |
| --- | --- |
| `PASSWORD_CHANGED` | User đổi mật khẩu |
| `PASSWORD_RESET_REQUESTED` | User yêu cầu reset password |
| `PASSWORD_RESET_COMPLETED` | Reset password thành công |
| `USER_LOCKED` | Admin/system khóa user |
| `USER_UNLOCKED` | Admin mở khóa user |
| `SESSION_REVOKED` | Revoke session |
| `ALL_SESSIONS_REVOKED` | Logout all / reset password / lock user |
| `REFRESH_TOKEN_REUSE_DETECTED` | Phát hiện token reuse |
| `PERMISSION_CHANGED` | Role permission thay đổi |
| `ROLE_ASSIGNED` | User được gán role |
| `ROLE_REMOVED` | User bị gỡ role |

### 22.3 Audit logs

Ghi `audit_logs` cho thao tác thay đổi dữ liệu quan trọng:

| Action | Target | Module |
| --- | --- | --- |
| `AUTH.USER.CREATED` | `users` | AUTH |
| `AUTH.USER.UPDATED` | `users` | AUTH |
| `AUTH.USER.LOCKED` | `users` | AUTH |
| `AUTH.USER.UNLOCKED` | `users` | AUTH |
| `AUTH.USER.ROLE_ASSIGNED` | `user_roles` | AUTH |
| `AUTH.ROLE.CREATED` | `roles` | AUTH |
| `AUTH.ROLE.UPDATED` | `roles` | AUTH |
| `AUTH.ROLE.PERMISSION_UPDATED` | `role_permissions` | AUTH |
| `AUTH.PASSWORD.CHANGED` | `users` | AUTH |
| `AUTH.SESSION.REVOKED` | `user_sessions` | AUTH |

---

## 23. Notification events từ AUTH

MVP có thể phát event sang NOTI cho một số hành động.

| Event | Người nhận | Khi nào |
| --- | --- | --- |
| `AUTH.USER_CREATED` | User mới, HR/Admin nếu cấu hình | Tạo tài khoản |
| `AUTH.USER_LOCKED` | User bị khóa, Admin | Khóa tài khoản |
| `AUTH.USER_UNLOCKED` | User được mở khóa | Mở khóa tài khoản |
| `AUTH.PASSWORD_CHANGED` | User | Đổi mật khẩu thành công |
| `AUTH.PASSWORD_RESET_REQUESTED` | User | Có yêu cầu reset password |
| `AUTH.ROLE_CHANGED` | User hoặc Admin | Role user thay đổi nếu cấu hình thông báo |
| `AUTH.SUSPICIOUS_LOGIN` | User/Admin | Login bất thường nếu phát hiện |

Với MVP, có thể chỉ ghi audit/security event trước, notification event triển khai sau nếu NOTI chưa sẵn sàng.

---

## 24. Error code chuẩn cho BACKEND-03

| HTTP | Code | Ý nghĩa |
| --- | --- | --- |
| 400 | `AUTH-ERR-VALIDATION` | Dữ liệu auth không hợp lệ |
| 401 | `AUTH-ERR-UNAUTHENTICATED` | Chưa đăng nhập hoặc thiếu token |
| 401 | `AUTH-ERR-TOKEN-EXPIRED` | Access token hết hạn |
| 401 | `AUTH-ERR-TOKEN-INVALID` | Token sai chữ ký/sai loại/sai format |
| 401 | `AUTH-ERR-SESSION-EXPIRED` | Session hết hạn |
| 401 | `AUTH-ERR-SESSION-REVOKED` | Session đã bị revoke |
| 401 | `AUTH-ERR-REFRESH-INVALID` | Refresh token không hợp lệ |
| 403 | `AUTH-ERR-FORBIDDEN` | Không có permission |
| 403 | `AUTH-ERR-SCOPE-DENIED` | Target data ngoài data scope |
| 403 | `AUTH-ERR-USER-LOCKED` | User bị khóa |
| 403 | `AUTH-ERR-USER-INACTIVE` | User inactive/deleted |
| 403 | `AUTH-ERR-COMPANY-INACTIVE` | Company inactive/suspended |
| 403 | `AUTH-ERR-MUST-CHANGE-PASSWORD` | User bắt buộc đổi mật khẩu |
| 404 | `AUTH-ERR-USER-NOT-FOUND` | User không tồn tại hoặc ngoài scope |
| 409 | `AUTH-ERR-EMAIL-EXISTS` | Email đã tồn tại trong company |
| 409 | `AUTH-ERR-ROLE-IN-USE` | Không thể xóa role đang được dùng |
| 429 | `AUTH-ERR-TOO-MANY-ATTEMPTS` | Quá nhiều request/login attempt |
| 500 | `AUTH-ERR-INTERNAL` | Lỗi hệ thống |

Response lỗi phải theo chuẩn API-01:

```json
{
  "success": false,
  "message": "Bạn không có quyền thực hiện thao tác này",
  "error": {
    "code": "AUTH-ERR-FORBIDDEN",
    "type": "ForbiddenError",
    "details": null
  },
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-06-20T21:30:00+07:00"
  }
}
```

---

## 25. DTO validation

### 25.1 Login DTO

```ts
export class LoginDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(1)
  password!: string

  @IsOptional()
  @IsBoolean()
  remember_me?: boolean
}
```

### 25.2 Change password DTO

```ts
export class ChangePasswordDto {
  @IsString()
  current_password!: string

  @IsString()
  @MinLength(8)
  new_password!: string

  @IsString()
  confirm_password!: string

  @IsOptional()
  @IsBoolean()
  logout_other_sessions?: boolean
}
```

Request dùng field `logout_other_sessions` (boolean). Response trả `other_sessions_revoked` (boolean) cho biết các session khác đã bị revoke hay chưa (khớp API-02 AUTH-API-007 và FE-06).

### 25.3 Assign role DTO

```ts
export class AssignRolesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  role_ids!: string[]

  @IsOptional()
  @IsString()
  note?: string
}
```

### 25.4 Update role permissions DTO

```ts
export class UpdateRolePermissionsDto {
  @IsArray()
  permissions!: Array<{
    permission_code: string
    data_scope: DataScope
    conditions?: Record<string, unknown>
  }>
}
```

---

## 26. Service interface đề xuất

### 26.1 AuthService

```ts
export interface AuthService {
  login(dto: LoginDto, client: ClientContext): Promise<LoginResult>
  refreshToken(input: RefreshTokenInput, client: ClientContext): Promise<RefreshResult>
  logout(ctx: AuthContext): Promise<void>
  logoutAll(ctx: AuthContext): Promise<void>
  getMe(ctx: AuthContext): Promise<AuthMeResponse>
  changePassword(ctx: AuthContext, dto: ChangePasswordDto): Promise<void>
  forgotPassword(dto: ForgotPasswordDto, client: ClientContext): Promise<void>
  resetPassword(dto: ResetPasswordDto, client: ClientContext): Promise<void>
}
```

### 26.2 TokenService

```ts
export type ResetTokenPurpose = 'ResetPassword' | 'ActivateAccount' | 'Invite'

export interface TokenService {
  signAccessToken(payload: AccessTokenPayload): Promise<string>
  verifyAccessToken(token: string): Promise<AccessTokenPayload>
  generateRefreshToken(): Promise<string>
  hashRefreshToken(token: string): Promise<string>
  verifyRefreshToken(token: string, hash: string): Promise<boolean>
  generateResetToken(purpose: ResetTokenPurpose): Promise<string>
  hashResetToken(token: string): Promise<string>
}
```

Token reset/activation dùng discriminator `purpose ∈ {ResetPassword, ActivateAccount, Invite}` (khớp cột `password_reset_tokens.purpose` ở DB-02 §7.7) khi create và verify. Forgot/reset password dùng `ResetPassword`; kích hoạt tài khoản mới dùng `ActivateAccount`; mời user dùng `Invite`.

### 26.3 PermissionService

```ts
export interface PermissionService {
  loadUserGrants(userId: string, companyId: string | null): Promise<PermissionGrant[]>
  buildPermissionMap(grants: PermissionGrant[]): Record<string, PermissionGrant>
  hasPermission(ctx: AuthContext, permission: string): boolean
  assertPermission(ctx: AuthContext, permission: string, scopes?: DataScope[]): Promise<void>
  invalidateUserPermissionCache(userId: string, companyId: string | null): Promise<void>
}
```

### 26.4 DataScopeService

```ts
export interface DataScopeService {
  assertResourceScope(params: AssertScopeParams): Promise<void>
  applyListScopeFilter<TQuery>(query: TQuery, params: ApplyScopeFilterParams): TQuery
  isEmployeeInScope(ctx: AuthContext, employeeId: string, permission: string): Promise<boolean>
  isProjectInScope(ctx: AuthContext, projectId: string, permission: string): Promise<boolean>
}
```

---

## 27. Repository query patterns

### 27.1 Load user for login

```sql
SELECT *
FROM users
WHERE normalized_email = :normalized_email
  AND deleted_at IS NULL
LIMIT 1;
```

Nếu multi-tenant login dùng subdomain/company code:

```sql
SELECT *
FROM users
WHERE company_id = :company_id
  AND normalized_email = :normalized_email
  AND deleted_at IS NULL
LIMIT 1;
```

### 27.2 Load active roles and permissions

```sql
SELECT
  r.id AS role_id,
  r.role_code,
  r.name AS role_name,
  p.permission_code,
  rp.data_scope,
  rp.conditions
FROM user_roles ur
JOIN roles r ON r.id = ur.role_id
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE ur.user_id = :user_id
  AND ur.is_active = true
  AND ur.deleted_at IS NULL
  AND (ur.expired_at IS NULL OR ur.expired_at > now())
  AND r.status = 'Active'
  AND r.deleted_at IS NULL
  AND rp.is_active = true
  AND rp.deleted_at IS NULL
  AND p.is_active = true;
```

### 27.3 Session active check

```sql
SELECT *
FROM user_sessions
WHERE id = :session_id
  AND user_id = :user_id
  AND revoked_at IS NULL
  AND expired_at > now()
LIMIT 1;
```

---

## 28. Rate limiting

### 28.1 Endpoint cần rate limit

| Endpoint | Rule đề xuất |
| --- | --- |
| `POST /auth/login` | Theo IP + email, ví dụ 5 lần/phút, 20 lần/giờ |
| `POST /auth/forgot-password` | Theo IP + email, ví dụ 3 lần/15 phút |
| `POST /auth/reset-password` | Theo token/IP, ví dụ 5 lần/15 phút |
| `POST /auth/refresh-token` | Theo session/IP, tránh refresh storm |
| Admin role/permission endpoints | Theo user/admin, chống spam audit |

### 28.2 Response 429

```json
{
  "success": false,
  "message": "Bạn thao tác quá nhanh, vui lòng thử lại sau",
  "error": {
    "code": "AUTH-ERR-TOO-MANY-ATTEMPTS",
    "type": "RateLimitError",
    "details": {
      "retry_after_seconds": 60
    }
  },
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-06-20T21:35:00+07:00"
  }
}
```

---

## 29. Permission seed requirements

BACKEND-03 phụ thuộc seed từ BACKEND-02/DB-10.

### 29.1 Permission AUTH MVP

Các permission AUTH **được dùng làm guard** (seed vào `role_permissions`, kiểm tra ở permission guard):

```text
AUTH.PASSWORD.CHANGE
AUTH.USER.VIEW
AUTH.USER.CREATE
AUTH.USER.UPDATE
AUTH.USER.LOCK
AUTH.USER.UNLOCK
AUTH.USER.ASSIGN_ROLE
AUTH.ROLE.VIEW
AUTH.ROLE.CREATE
AUTH.ROLE.UPDATE
AUTH.ROLE.DELETE
AUTH.PERMISSION.VIEW
AUTH.PERMISSION.ASSIGN
AUTH.AUDIT_LOG.VIEW
```

Ghi chú quan trọng (khớp canonical decisions §2.2):

1. **Bỏ `AUTH.SESSION.VIEW` và `AUTH.SESSION.REVOKE`.** Các endpoint `/auth/me/sessions*` (xem/revoke phiên của chính mình) là **self-service `Authenticated`**, không cần permission. Điều này đồng bộ với §12.2 (`/auth/my-sessions` GET/DELETE = `Authenticated`).
2. **`AUTH.LOGIN.ACCESS`, `AUTH.PROFILE.VIEW`, `AUTH.PROFILE.UPDATE` KHÔNG dùng làm guard.** Màn hình hồ sơ cá nhân và đăng nhập gate bằng `Authenticated`. Ba code này nếu giữ trong catalog chỉ là nhãn mô tả (non-guard), không seed vào `role_permissions` như guard. FE-06 gate route hồ sơ cá nhân về `Authenticated`.

### 29.2 Role default mapping tối thiểu

| Role | Permission AUTH tối thiểu | Scope |
| --- | --- | --- |
| SUPER_ADMIN | Tất cả permission | System |
| COMPANY_ADMIN | User/Role/Permission admin trong company | Company |
| HR | `AUTH.USER.CREATE` nếu doanh nghiệp cho HR tạo tài khoản nhân viên | Company |
| MANAGER | `AUTH.PASSWORD.CHANGE` | Own |
| EMPLOYEE | `AUTH.PASSWORD.CHANGE` | Own |

Lưu ý:

1. HR không mặc định được quản trị role/permission nếu chưa cấp quyền.
2. Không seed `AUTH.SESSION.VIEW/REVOKE` cho bất kỳ role nào — endpoint session self-service là `Authenticated` (xem §29.1).
3. Không seed `AUTH.PROFILE.VIEW/UPDATE`, `AUTH.LOGIN.ACCESS` như guard — màn hồ sơ cá nhân và đăng nhập gate bằng `Authenticated`. Mọi user đã đăng nhập (mọi role) đương nhiên xem/sửa hồ sơ của chính mình và đổi mật khẩu (`AUTH.PASSWORD.CHANGE`).

---

## 30. Integration với frontend

### 30.1 Frontend cần gì từ backend

| Nhu cầu frontend | Backend cung cấp |
| --- | --- |
| Boot session sau app load | `GET /api/v1/auth/me` |
| Route guard | permissions + scopes từ `/auth/me` |
| App visibility | modules + permissions |
| Sidebar visibility | permissions + module status |
| Button/action visibility | permissions + scopes + business state từ API module |
| Token expired | 401 `AUTH-ERR-TOKEN-EXPIRED` |
| Refresh token | `POST /api/v1/auth/refresh-token` |
| Forbidden state | 403 `AUTH-ERR-FORBIDDEN` hoặc `AUTH-ERR-SCOPE-DENIED` |
| Logout cleanup | `POST /api/v1/auth/logout` |
| User role changed | frontend gọi lại `/auth/me` sau invalidate hoặc nhận event phase sau |

### 30.2 Backend không phụ thuộc frontend guard

Frontend có thể ẩn app/menu/button, nhưng nếu user gọi API trực tiếp bằng URL hoặc devtools, backend vẫn phải trả 401/403 đúng.

---

## 31. Integration với các module nghiệp vụ

### 31.1 HR

HR dùng guard để:

1. Xem danh sách nhân viên theo `HR.EMPLOYEE.VIEW`.
2. Tạo nhân viên theo `HR.EMPLOYEE.CREATE`.
3. Cập nhật hồ sơ theo `HR.EMPLOYEE.UPDATE`.
4. Áp data scope Own/Team/Department/Company/System.
5. Mask field nhạy cảm nếu thiếu `HR.EMPLOYEE.SENSITIVE_VIEW`.

### 31.2 ATT

ATT dùng guard để:

1. Check-in/check-out theo `ATT.ATTENDANCE.CHECK_IN` / `CHECK_OUT` scope Own.
2. Xem bảng công theo `ATT.ATTENDANCE.VIEW` scope Own/Team/Department/Company.
3. Duyệt điều chỉnh công theo `ATT.ADJUSTMENT.APPROVE` scope Team/Company.
4. HR/Admin chỉnh công trực tiếp theo permission riêng.

### 31.3 LEAVE

LEAVE dùng guard để:

1. Tạo đơn nghỉ theo `LEAVE.REQUEST.CREATE` scope Own.
2. Xem đơn nghỉ theo `LEAVE.REQUEST.VIEW`.
3. Duyệt đơn nghỉ theo `LEAVE.REQUEST.APPROVE` scope Team/Company.
4. Quản lý loại nghỉ/chính sách/số dư theo permission HR/Admin.

### 31.4 TASK

TASK dùng guard để:

1. Tạo project theo `TASK.PROJECT.CREATE`.
2. Xem project/task theo Company/Project/Own tùy context.
3. Cập nhật task theo RBAC + project membership + assignee rule.
4. Comment/mention theo quyền truy cập task.

### 31.5 DASH

DASH dùng guard để:

1. Xác định dashboard type user được xem.
2. Lọc widget theo permission.
3. Query dữ liệu widget theo data scope.
4. Không xử lý nghiệp vụ gốc thay module nguồn.

### 31.6 NOTI

NOTI dùng guard để:

1. User chỉ xem notification của chính mình theo Own.
2. Admin xem notification company theo permission riêng.
3. Notification target deep link phải kiểm tra quyền lại ở module gốc.

---

## 32. Test plan

### 32.1 Unit test

| Nhóm | Test case |
| --- | --- |
| TokenService | Sign/verify access token, reject expired/wrong type/wrong signature |
| PasswordService | Hash/verify password, reject wrong password |
| SessionService | Create/revoke/expire session, refresh rotation |
| PermissionService | Merge permission nhiều role, scope union, inactive role ignored |
| DataScopeService | Own/Team/Department/Project/Company/System checks |
| Decorator/Guard | Public route skip, protected route require auth, permission missing -> 403 |
| Field masking | Sensitive field removed/masked nếu thiếu permission |

### 32.2 Integration test

| Flow | Kỳ vọng |
| --- | --- |
| Login success | Tạo session, trả access token, ghi login log |
| Login failed | Không tạo session, tăng failed count, ghi login failed |
| Refresh success | Rotate refresh token, trả access token mới |
| Refresh revoked | Trả 401 |
| Logout | Revoke session, token cũ không refresh được |
| Change password | Update hash, revoke old sessions, ghi security event |
| Assign role | User nhận permission mới sau invalidate cache |
| Remove role | User mất permission, API liên quan trả 403 |
| User locked | Login fail, session active bị revoke hoặc API trả 403 |

### 32.3 E2E permission test

| Case | Kỳ vọng |
| --- | --- |
| Employee gọi `GET /auth/users` | 403 |
| Admin gọi `GET /auth/users` | 200, chỉ user cùng company |
| Manager xem bảng công nhân viên ngoài team | 403 hoặc list không có dữ liệu ngoài scope |
| HR duyệt leave toàn công ty | 200 nếu có permission + Company scope |
| Employee dùng URL dashboard admin | 403 |
| Token hết hạn gọi API | 401 `AUTH-ERR-TOKEN-EXPIRED` |
| Không token gọi API protected | 401 `AUTH-ERR-UNAUTHENTICATED` |
| User inactive gọi API | 403 `AUTH-ERR-USER-INACTIVE` |

### 32.4 Security test

1. Không login được bằng tài khoản locked/inactive/deleted.
2. Không dùng lại refresh token đã rotate.
3. Không dùng reset token quá hạn hoặc đã dùng.
4. Không brute-force login không bị rate limit.
5. Không truy cập cross-company bằng cách sửa URL/body.
6. Không xem field nhạy cảm nếu thiếu permission.
7. Không inject `company_id` trong body để lấy dữ liệu công ty khác.
8. Không bypass guard bằng direct API call.
9. Không trả token/hash/secret trong log hoặc response.

---

## 33. Checklist triển khai

### 33.1 Code foundation

- [ ] Tạo `AuthModule`.
- [ ] Tạo `TokenService`.
- [ ] Tạo `PasswordService`.
- [ ] Tạo `SessionService`.
- [ ] Tạo `RbacService`.
- [ ] Tạo `PermissionService`.
- [ ] Tạo `DataScopeService`.
- [ ] Tạo `AuthContextService`.
- [ ] Tạo decorators: `@Public`, `@RequirePermission`, `@RequireAnyPermission`, `@RequireAllPermissions`, `@AuditAction`.
- [ ] Tạo guards: Authentication, Session, Permission, DataScope, ModuleStatus.
- [ ] Tạo exception types chuẩn 401/403.
- [ ] Tạo response mapper cho `/auth/me`.

### 33.2 API

- [ ] `POST /api/v1/auth/login`.
- [ ] `POST /api/v1/auth/refresh-token`.
- [ ] `POST /api/v1/auth/logout`.
- [ ] `POST /api/v1/auth/logout-all`.
- [ ] `GET /api/v1/auth/me`.
- [ ] `POST /api/v1/auth/change-password`.
- [ ] `POST /api/v1/auth/forgot-password`.
- [ ] `POST /api/v1/auth/reset-password`.
- [ ] `GET /api/v1/auth/my-sessions`.
- [ ] `DELETE /api/v1/auth/my-sessions/{session_id}`.
- [ ] Admin user/role/permission endpoints tối thiểu nếu chưa có API-02 riêng.

### 33.3 Security

- [ ] Password hash bằng Argon2id hoặc bcrypt.
- [ ] Refresh token lưu hash, không lưu plain text.
- [ ] Reset token lưu hash, dùng một lần.
- [ ] Rate limit login/forgot/reset/refresh.
- [ ] Revoke session khi logout/change/reset/lock.
- [ ] Permission cache có invalidate.
- [ ] Không log token/password.
- [ ] CORS/cookie policy phù hợp frontend domain.
- [ ] Response không trả hash/secret.

### 33.4 Logging/audit

- [ ] Ghi login_logs login success/failed/logout/refresh failed.
- [ ] Ghi user_security_events password/reset/lock/session events.
- [ ] Ghi audit_logs user/role/permission/session admin actions.
- [ ] Mọi log có request_id, actor, company_id, ip, user_agent.

### 33.5 Test

- [ ] Unit test token/password/session/permission/scope.
- [ ] Integration test login/refresh/logout/me.
- [ ] E2E test 401/403/data scope.
- [ ] Security test brute-force/token reuse/cross-company.
- [ ] Regression test role permission changed.

---

## 34. Acceptance criteria

BACKEND-03 được xem là hoàn thành khi:

1. Tất cả API protected đều yêu cầu access token hợp lệ.
2. Access token hết hạn trả 401 chuẩn.
3. Refresh token hợp lệ cấp access token mới.
4. Refresh token bị revoke/expired không dùng được.
5. Login thành công tạo session và ghi login log.
6. Login thất bại không tiết lộ email tồn tại hay không.
7. Logout revoke session hiện tại.
8. Change/reset password revoke session theo rule.
9. `/api/v1/auth/me` trả đủ user, company, employee, roles, permissions, scopes, modules.
10. Backend kiểm tra permission ở mọi API nghiệp vụ.
11. Backend kiểm tra data scope cho list API và detail/action API.
12. Không có logic nghiệp vụ hard-code theo role name.
13. Cross-company access bị chặn.
14. Field nhạy cảm không bị trả raw nếu thiếu field-level permission.
15. Role/permission thay đổi có cơ chế invalidate permission cache.
16. User locked/inactive/deleted không thể login hoặc tiếp tục dùng API.
17. Audit/security/login logs được ghi cho thao tác quan trọng.
18. Có test unit/integration/e2e/security cho các flow chính.
19. Frontend có thể dùng `/auth/me` để triển khai route/app/sidebar/action guard.
20. Tài liệu đủ rõ để chuyển sang BACKEND-04 và các module nghiệp vụ.

---

## 35. Rủi ro và cách giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Nhét permission vào JWT quá nhiều | Quyền thay đổi không có hiệu lực ngay | JWT chỉ chứa claim tối thiểu, permission lấy từ DB/cache |
| Không rotate refresh token | Tăng rủi ro token bị đánh cắp dùng lâu dài | Rotate refresh token, detect reuse |
| Không revoke session khi lock/reset password | User bị khóa vẫn dùng được hệ thống | Session guard kiểm DB và revoke session khi lock/reset |
| Hard-code theo role | Sai quyền khi role được tùy chỉnh | Bắt buộc check permission + scope |
| Scope chỉ check ở frontend | Lộ dữ liệu qua API direct call | Backend query filter + resource scope check |
| List API query rồi mới filter in-memory | Lộ dữ liệu/log, performance kém | Apply scope filter ở repository/database |
| Cache permission quá lâu | User giữ quyền cũ sau khi bị gỡ role | TTL ngắn + invalidate theo event |
| Field nhạy cảm chỉ mask ở frontend | Dữ liệu raw lộ qua network | Backend mapper mask/remove field |
| Refresh token race condition | Refresh nhiều lần tạo trạng thái lệch | Refresh lock theo session hoặc rotation version |
| Open redirect returnUrl | Lừa user redirect ra ngoài | Chỉ cho internal path bắt đầu bằng `/` |
| Token/password bị ghi log | Rò rỉ bảo mật | Redact logger, không log body auth nhạy cảm |

---

## 36. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ | Đề xuất MVP |
| --- | --- | --- | --- | --- |
| BE03-OQ-001 | Web dùng HttpOnly cookie cho refresh token hay body token? | BE/FE Lead | Cao | HttpOnly Secure cookie cho web, secure storage cho mobile |
| BE03-OQ-002 | Access token lưu ở frontend memory hay storage? | BE/FE Lead | Cao | Memory nếu có thể; tránh localStorage nếu dữ liệu nhạy cảm |
| BE03-OQ-003 | TTL token chính thức là bao lâu? | Product/BE | Trung bình | Access 30 phút, refresh 14 ngày |
| BE03-OQ-004 | Password policy MVP ở mức nào? | Product/HR/Admin | Trung bình | Min 8, complexity configurable |
| BE03-OQ-005 | Team scope chỉ direct report hay cây cấp dưới nhiều tầng? | Product/HR | Cao | MVP direct report; phase sau tree scope |
| BE03-OQ-006 | Project scope kết hợp project member role thế nào? | Product/Task | Cao | MVP project member/owner/assignee/watcher tùy API |
| BE03-OQ-007 | Có invalidate permission realtime không? | BE/FE | Thấp | MVP TTL ngắn + gọi lại `/auth/me` sau admin change |
| BE03-OQ-008 | `/auth/me` có trả app/menu registry backend-driven không? | Product/BE/FE | Trung bình | MVP trả modules + permissions; frontend build menu từ registry local |
| BE03-OQ-009 | Field-level permission backend mask hay remove field? | BE/FE/UX | Cao | Backend mask với field phổ biến, remove với field cực nhạy cảm |
| BE03-OQ-010 | Có bắt buộc logout all khi đổi mật khẩu không? | Product/Security | Trung bình | Có, trừ session hiện tại nếu cấu hình cho phép |

---

## 37. Kết luận

BACKEND-03 là lớp bảo mật trung tâm của toàn bộ MVP.

Tư duy triển khai cần giữ nhất quán:

```text
Token xác thực user
-> Session xác nhận phiên còn hiệu lực
-> AuthContext resolve company/employee/role/permission/scope
-> Permission guard kiểm API action
-> Data scope guard kiểm target data
-> Service kiểm business rule
-> Repository luôn filter company_id + scope
-> Audit/security log mọi thao tác quan trọng
```

Sau BACKEND-03, đội backend có thể chuyển sang:

```text
BACKEND-04: Foundation Backend
```

và bắt đầu triển khai các module nghiệp vụ HR, ATT, LEAVE, TASK, NOTI, DASH với guard thống nhất.
