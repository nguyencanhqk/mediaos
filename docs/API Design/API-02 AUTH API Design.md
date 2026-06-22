# API-02: AUTH API DESIGN

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · **API-02 AUTH** · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>)
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-02 AUTH](<../SPEC/SPEC-02 AUTH.md>) · [Thiết kế DB: DB-02 AUTH/RBAC](<../DB/DB-02 AUTH RBAC Database Design.md>) · [Sản phẩm: PRD-00 §9.1](<../PRD/PRD-00 Enterprise Management System .md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường         | Nội dung                                    |
| -------------- | ------------------------------------------- |
| Mã tài liệu    | API-02                                      |
| Tên tài liệu   | AUTH API Design                             |
| Tên dự án      | Hệ thống quản lý doanh nghiệp nội bộ        |
| Module         | AUTH                                        |
| Phiên bản      | v1.0                                        |
| Trạng thái     | Draft                                       |
| Giai đoạn      | MVP Version 1.0                             |
| Tài liệu nguồn | API-01, SPEC-02, DB-02, DB-08, DB-09, DB-10 |
| Ngày tạo       | 20/06/2026                                  |
| Ngày cập nhật  | 20/06/2026                                  |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả thiết kế API chi tiết cho module **AUTH — Tài khoản, đăng nhập & phân quyền**.

Module AUTH chịu trách nhiệm cung cấp API cho:

1. Đăng nhập.
2. Làm mới access token.
3. Đăng xuất.
4. Quên mật khẩu.
5. Đặt lại mật khẩu.
6. Đổi mật khẩu.
7. Lấy thông tin user hiện tại.
8. Lấy quyền hiện tại của user.
9. Lấy menu/sidebar theo quyền.
10. Quản lý user.
11. Khóa/mở khóa user.
12. Gán role cho user.
13. Quản lý role.
14. Gán permission cho role kèm data scope.
15. Xem danh mục permission.
16. Quản lý phiên đăng nhập.
17. Xem login log/security event/audit log liên quan AUTH.

AUTH là module nền tảng. Các module HR, ATT, LEAVE, TASK, DASH, NOTI đều phụ thuộc AUTH để xác định user hiện tại, company hiện tại, role, permission và data scope.

---

## 3. Nguyên tắc thiết kế API AUTH

## 3.1 Base path

Theo API-01, module AUTH dùng prefix:

```http
/api/v1/auth
```

Các nhóm endpoint chính:

```http
/api/v1/auth/login
/api/v1/auth/refresh-token
/api/v1/auth/logout
/api/v1/auth/me
/api/v1/auth/users
/api/v1/auth/roles
/api/v1/auth/permissions
/api/v1/auth/sessions
/api/v1/auth/security-events
/api/v1/auth/audit-logs
```

Ghi chú:

SPEC-02 có bản API sơ bộ dùng `/api/auth`, `/api/users`, `/api/roles`. Trong API-02, thống nhất theo API-01 thành `/api/v1/auth/...`.

---

## 3.2 Authentication

Các API protected cần header:

```http
Authorization: Bearer <access_token>
```

Các API public:

```http
POST /api/v1/auth/login
POST /api/v1/auth/refresh-token
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
```

Các API còn lại mặc định yêu cầu access token hợp lệ.

---

## 3.3 Token strategy

MVP sử dụng:

```text
Access Token + Refresh Token
```

Access token dùng để gọi API.

Refresh token dùng để lấy access token mới.

Đề xuất thời hạn:

| Token                | Thời hạn MVP |
| -------------------- | -----------: |
| Access token         |   15–60 phút |
| Refresh token        |    7–30 ngày |
| Password reset token |   15–60 phút |

Refresh token phải được lưu dạng hash trong `user_sessions.refresh_token_hash`, không lưu plain text.

---

## 3.4 Permission strategy

Backend kiểm tra theo thứ tự:

```text
1. Access token hợp lệ
2. Session còn hiệu lực
3. User tồn tại
4. User thuộc company hợp lệ
5. User status = Active
6. Company status = Active
7. User có required permission
8. Permission có data scope phù hợp
9. Target data thuộc data scope được phép
10. Business validation hợp lệ
```

Không hard-code logic theo role, trừ role đặc biệt như `SUPER_ADMIN`.

Role chỉ là nhóm permission đã seed sẵn.

---

## 3.5 Data scope

AUTH dùng các scope chuẩn:

| Scope      | Ý nghĩa                                   |
| ---------- | ----------------------------------------- |
| Own        | Dữ liệu của chính user/employee           |
| Team       | Dữ liệu nhân viên thuộc team mình quản lý |
| Department | Dữ liệu thuộc phòng ban                   |
| Project    | Dữ liệu thuộc project liên quan           |
| Company    | Dữ liệu toàn công ty                      |
| System     | Dữ liệu toàn hệ thống                     |

Trong API-02, scope chủ yếu dùng cho user/role/audit:

| API group             | Scope áp dụng      |
| --------------------- | ------------------ |
| Me/Profile            | Own                |
| User management       | Company/System     |
| Role management       | Company/System     |
| Permission management | Company/System     |
| Session management    | Own/Company/System |
| Audit/Security log    | Own/Company/System |

---

## 3.6 Không trả dữ liệu nhạy cảm

API AUTH tuyệt đối không trả các field sau về frontend:

```text
password_hash
refresh_token_hash
password_reset_token_hash
access_token_jti nội bộ nếu không cần
secret
private_key
internal_metadata nhạy cảm
```

---

## 3.7 Audit log bắt buộc

Các API sau bắt buộc ghi audit log:

| Action                   | API liên quan                          |
| ------------------------ | -------------------------------------- |
| LOGIN_SUCCESS            | Đăng nhập thành công                   |
| LOGIN_FAILED             | Đăng nhập thất bại                     |
| LOGOUT                   | Đăng xuất                              |
| REFRESH_TOKEN_ROTATED    | Làm mới token nếu rotate refresh token |
| PASSWORD_CHANGED         | Đổi mật khẩu                           |
| PASSWORD_RESET_REQUESTED | Quên mật khẩu                          |
| PASSWORD_RESET_COMPLETED | Đặt lại mật khẩu                       |
| USER_CREATED             | Tạo user                               |
| USER_UPDATED             | Cập nhật user                          |
| USER_LOCKED              | Khóa user                              |
| USER_UNLOCKED            | Mở khóa user                           |
| USER_ROLE_UPDATED        | Gán/gỡ role user                       |
| ROLE_CREATED             | Tạo role                               |
| ROLE_UPDATED             | Cập nhật role                          |
| ROLE_DISABLED            | Vô hiệu hóa role                       |
| ROLE_PERMISSION_UPDATED  | Gán/gỡ permission cho role             |
| SESSION_REVOKED          | Thu hồi session                        |
| AUTH_AUDIT_EXPORTED      | Export log nếu có                      |

---

## 3.8 Notification event

AUTH có thể phát event cho NOTI:

| Event code                    | Khi nào phát                    | Người nhận |
| ----------------------------- | ------------------------------- | ---------- |
| AUTH.USER_CREATED             | User mới được tạo               | User mới   |
| AUTH.PASSWORD_CHANGED         | User đổi mật khẩu               | User       |
| AUTH.PASSWORD_RESET_REQUESTED | Có yêu cầu reset password       | User       |
| AUTH.USER_LOCKED              | User bị khóa                    | User/Admin |
| AUTH.USER_UNLOCKED            | User được mở khóa               | User       |
| AUTH.USER_ROLE_CHANGED        | Role của user thay đổi          | User       |
| AUTH.LOGIN_SUSPICIOUS         | Đăng nhập bất thường, phase sau | User/Admin |

Trong MVP, có thể chỉ ghi in-app notification hoặc audit log. Email có thể mở rộng sau.

---

## 4. Chuẩn response dùng trong API-02

### 4.1 Success object

```json
{
  "success": true,
  "message": "Thao tác thành công",
  "data": {},
  "meta": {
    "request_id": "req_20260620_000001",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 4.2 Success list

```json
{
  "success": true,
  "message": "Lấy danh sách thành công",
  "data": [],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 100,
    "total_pages": 5,
    "has_next": true,
    "has_prev": false
  },
  "meta": {
    "request_id": "req_20260620_000002",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 4.3 Error response

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
    "request_id": "req_20260620_000003",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 4.4 Validation error

```json
{
  "success": false,
  "message": "Dữ liệu không hợp lệ",
  "error": {
    "code": "VALIDATION-ERR-001",
    "type": "ValidationError",
    "details": [
      {
        "field": "email",
        "message": "Email không đúng định dạng",
        "rule": "email"
      }
    ]
  },
  "meta": {
    "request_id": "req_20260620_000004",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

## 5. Danh sách endpoint tổng quan

### 5.1 Authentication API

| Mã API       | Method | Endpoint                       | Mục đích                   | Permission                |
| ------------ | ------ | ------------------------------ | -------------------------- | ------------------------- |
| AUTH-API-001 | POST   | `/api/v1/auth/login`           | Đăng nhập                  | Public                    |
| AUTH-API-002 | POST   | `/api/v1/auth/refresh-token`   | Làm mới token              | Public with refresh token |
| AUTH-API-003 | POST   | `/api/v1/auth/logout`          | Đăng xuất session hiện tại | Authenticated             |
| AUTH-API-004 | POST   | `/api/v1/auth/logout-all`      | Đăng xuất mọi thiết bị     | Authenticated             |
| AUTH-API-005 | POST   | `/api/v1/auth/forgot-password` | Quên mật khẩu              | Public                    |
| AUTH-API-006 | POST   | `/api/v1/auth/reset-password`  | Đặt lại mật khẩu           | Public with reset token   |
| AUTH-API-007 | POST   | `/api/v1/auth/change-password` | Đổi mật khẩu               | `AUTH.PASSWORD.CHANGE`    |

---

### 5.2 Current user API

| Mã API       | Method | Endpoint                                | Mục đích                    | Permission    |
| ------------ | ------ | --------------------------------------- | --------------------------- | ------------- |
| AUTH-API-050 | GET    | `/api/v1/auth/me`                       | Lấy thông tin user hiện tại | Authenticated |
| AUTH-API-051 | GET    | `/api/v1/auth/me/permissions`           | Lấy permission hiện tại     | Authenticated |
| AUTH-API-052 | GET    | `/api/v1/auth/me/roles`                 | Lấy role hiện tại           | Authenticated |
| AUTH-API-053 | GET    | `/api/v1/auth/me/menu`                  | Lấy menu/sidebar theo quyền | Authenticated |
| AUTH-API-054 | GET    | `/api/v1/auth/me/sessions`              | Lấy session của tôi         | Authenticated |
| AUTH-API-055 | DELETE | `/api/v1/auth/me/sessions/{session_id}` | Thu hồi session của tôi     | Authenticated |

---

### 5.3 User management API

| Mã API       | Method | Endpoint                                             | Mục đích                        | Permission              |
| ------------ | ------ | ---------------------------------------------------- | ------------------------------- | ----------------------- |
| AUTH-API-101 | GET    | `/api/v1/auth/users`                                 | Danh sách user                  | `AUTH.USER.VIEW`        |
| AUTH-API-102 | GET    | `/api/v1/auth/users/{user_id}`                       | Chi tiết user                   | `AUTH.USER.VIEW`        |
| AUTH-API-103 | POST   | `/api/v1/auth/users`                                 | Tạo user                        | `AUTH.USER.CREATE`      |
| AUTH-API-104 | PATCH  | `/api/v1/auth/users/{user_id}`                       | Cập nhật user                   | `AUTH.USER.UPDATE`      |
| AUTH-API-105 | POST   | `/api/v1/auth/users/{user_id}/lock`                  | Khóa user                       | `AUTH.USER.LOCK`        |
| AUTH-API-106 | POST   | `/api/v1/auth/users/{user_id}/unlock`                | Mở khóa user                    | `AUTH.USER.UNLOCK`      |
| AUTH-API-107 | PUT    | `/api/v1/auth/users/{user_id}/roles`                 | Thay thế role của user          | `AUTH.USER.ASSIGN_ROLE` |
| AUTH-API-108 | POST   | `/api/v1/auth/users/{user_id}/roles`                 | Gán thêm role                   | `AUTH.USER.ASSIGN_ROLE` |
| AUTH-API-109 | DELETE | `/api/v1/auth/users/{user_id}/roles/{role_id}`       | Gỡ role khỏi user               | `AUTH.USER.ASSIGN_ROLE` |
| AUTH-API-110 | POST   | `/api/v1/auth/users/{user_id}/force-reset-password`  | Admin yêu cầu user đổi mật khẩu | `AUTH.USER.UPDATE`      |
| AUTH-API-111 | GET    | `/api/v1/auth/users/{user_id}/sessions`              | Xem session của user            | `AUTH.USER.VIEW`        |
| AUTH-API-112 | DELETE | `/api/v1/auth/users/{user_id}/sessions/{session_id}` | Thu hồi session user            | `AUTH.USER.UPDATE`      |

---

### 5.4 Role API

| Mã API       | Method | Endpoint                                                   | Mục đích                     | Permission               |
| ------------ | ------ | ---------------------------------------------------------- | ---------------------------- | ------------------------ |
| AUTH-API-201 | GET    | `/api/v1/auth/roles`                                       | Danh sách role               | `AUTH.ROLE.VIEW`         |
| AUTH-API-202 | GET    | `/api/v1/auth/roles/{role_id}`                             | Chi tiết role                | `AUTH.ROLE.VIEW`         |
| AUTH-API-203 | POST   | `/api/v1/auth/roles`                                       | Tạo role                     | `AUTH.ROLE.CREATE`       |
| AUTH-API-204 | PATCH  | `/api/v1/auth/roles/{role_id}`                             | Cập nhật role                | `AUTH.ROLE.UPDATE`       |
| AUTH-API-205 | DELETE | `/api/v1/auth/roles/{role_id}`                             | Vô hiệu hóa role             | `AUTH.ROLE.DELETE`       |
| AUTH-API-206 | GET    | `/api/v1/auth/roles/{role_id}/permissions`                 | Xem permission của role      | `AUTH.ROLE.VIEW`         |
| AUTH-API-207 | PUT    | `/api/v1/auth/roles/{role_id}/permissions`                 | Thay thế permission của role | `AUTH.PERMISSION.ASSIGN` |
| AUTH-API-208 | POST   | `/api/v1/auth/roles/{role_id}/permissions`                 | Gán thêm permission          | `AUTH.PERMISSION.ASSIGN` |
| AUTH-API-209 | DELETE | `/api/v1/auth/roles/{role_id}/permissions/{permission_id}` | Gỡ permission khỏi role      | `AUTH.PERMISSION.ASSIGN` |

---

### 5.5 Permission API

| Mã API       | Method | Endpoint                                   | Mục đích                                      | Permission             |
| ------------ | ------ | ------------------------------------------ | --------------------------------------------- | ---------------------- |
| AUTH-API-301 | GET    | `/api/v1/auth/permissions`                 | Danh sách permission                          | `AUTH.PERMISSION.VIEW` |
| AUTH-API-302 | GET    | `/api/v1/auth/permissions/{permission_id}` | Chi tiết permission                           | `AUTH.PERMISSION.VIEW` |
| AUTH-API-303 | GET    | `/api/v1/auth/permissions/modules`         | Danh sách module có permission                | `AUTH.PERMISSION.VIEW` |
| AUTH-API-304 | GET    | `/api/v1/auth/permissions/matrix`          | Permission matrix theo module/resource/action | `AUTH.PERMISSION.VIEW` |

Ghi chú MVP:

Không cho Admin công ty tự tạo permission mới bằng API. Permission nên được seed từ backend/migration. Chỉ Super Admin hoặc system migration mới thêm permission.

---

### 5.6 Security log API

| Mã API       | Method | Endpoint                       | Mục đích           | Permission            |
| ------------ | ------ | ------------------------------ | ------------------ | --------------------- |
| AUTH-API-401 | GET    | `/api/v1/auth/login-logs`      | Xem login log      | `AUTH.AUDIT_LOG.VIEW` |
| AUTH-API-402 | GET    | `/api/v1/auth/security-events` | Xem security event | `AUTH.AUDIT_LOG.VIEW` |
| AUTH-API-403 | GET    | `/api/v1/auth/audit-logs`      | Xem audit log AUTH | `AUTH.AUDIT_LOG.VIEW` |

---

## 6. DTO dùng chung

### 6.1 UserSummary DTO

```json
{
  "id": "uuid",
  "email": "user@company.com",
  "display_name": "Nguyễn Văn A",
  "status": "Active",
  "avatar_url": null,
  "employee": {
    "id": "uuid",
    "employee_code": "EMP0001",
    "full_name": "Nguyễn Văn A",
    "department": {
      "id": "uuid",
      "name": "Phòng Kỹ thuật"
    },
    "position": {
      "id": "uuid",
      "name": "Developer"
    }
  },
  "roles": [
    {
      "id": "uuid",
      "role_code": "EMPLOYEE",
      "name": "Employee"
    }
  ],
  "last_login_at": "2026-06-20T08:00:00+07:00",
  "created_at": "2026-06-20T08:00:00+07:00"
}
```

---

### 6.2 RoleSummary DTO

```json
{
  "id": "uuid",
  "role_code": "HR",
  "name": "HR",
  "description": "Quản lý nhân sự",
  "role_type": "Company",
  "is_system_role": false,
  "is_default": false,
  "status": "Active",
  "permission_count": 35,
  "user_count": 5
}
```

---

### 6.3 Permission DTO

```json
{
  "id": "uuid",
  "module_code": "AUTH",
  "permission_code": "AUTH.USER.VIEW",
  "resource": "USER",
  "action": "VIEW",
  "description": "Xem danh sách user",
  "is_sensitive": false,
  "is_system_permission": true,
  "is_active": true
}
```

---

### 6.4 RolePermission DTO

```json
{
  "permission": {
    "id": "uuid",
    "permission_code": "HR.EMPLOYEE.VIEW",
    "module_code": "HR",
    "resource": "EMPLOYEE",
    "action": "VIEW"
  },
  "data_scope": "Company",
  "conditions": null,
  "is_active": true
}
```

---

## 7. Chi tiết Authentication API

---

### AUTH-API-001: Đăng nhập

```http
POST /api/v1/auth/login
```

#### Mục đích

Cho phép user đăng nhập bằng email và mật khẩu.

#### Required permission

```text
Public
```

#### Allowed roles

Tất cả user có tài khoản hợp lệ.

#### Data scope

Không áp dụng.

#### Request headers

```http
Content-Type: application/json
Accept: application/json
X-Request-Id: req_20260620_000001
X-Client-Type: web
X-Client-Version: 1.0.0
```

#### Request body

```json
{
  "email": "user@company.com",
  "password": "P@ssword123",
  "remember_me": true
}
```

#### Validation

| Field       | Rule                                    |
| ----------- | --------------------------------------- |
| email       | Bắt buộc, đúng định dạng email, max 255 |
| password    | Bắt buộc                                |
| remember_me | Boolean, optional                       |

#### Business validation

1. Normalize email về lowercase.
2. Tìm user theo `normalized_email` và `company_id` nếu có cơ chế tenant resolution.
3. Không tiết lộ email có tồn tại hay không.
4. User phải tồn tại.
5. User `status` phải là `Active`.
6. User không bị soft delete.
7. Company phải active.
8. Mật khẩu phải đúng.
9. Nếu sai mật khẩu, tăng `failed_login_count`.
10. Nếu vượt ngưỡng sai mật khẩu, có thể lock user theo cấu hình.
11. Nếu đúng mật khẩu, reset `failed_login_count`.
12. Tạo `user_sessions`.
13. Tạo access token.
14. Tạo refresh token và lưu hash.
15. Ghi `login_logs`.

#### Response success

```json
{
  "success": true,
  "message": "Đăng nhập thành công",
  "data": {
    "access_token": "jwt_access_token",
    "refresh_token": "refresh_token_plain_once",
    "token_type": "Bearer",
    "expires_in": 3600,
    "refresh_expires_in": 2592000,
    "user": {
      "id": "uuid",
      "email": "user@company.com",
      "display_name": "Nguyễn Văn A",
      "status": "Active",
      "company": {
        "id": "uuid",
        "name": "Demo Company"
      },
      "employee": {
        "id": "uuid",
        "employee_code": "EMP0001",
        "full_name": "Nguyễn Văn A"
      },
      "roles": [
        {
          "id": "uuid",
          "role_code": "EMPLOYEE",
          "name": "Employee"
        }
      ]
    }
  },
  "meta": {
    "request_id": "req_20260620_000001",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

#### Error cases

| HTTP | Error code                   | Trường hợp                     |
| ---: | ---------------------------- | ------------------------------ |
|  400 | AUTH-ERR-EMAIL-REQUIRED      | Thiếu email                    |
|  400 | AUTH-ERR-PASSWORD-REQUIRED   | Thiếu password                 |
|  401 | AUTH-ERR-INVALID-CREDENTIALS | Email hoặc mật khẩu không đúng |
|  403 | AUTH-ERR-USER-LOCKED         | Tài khoản bị khóa              |
|  403 | AUTH-ERR-USER-INACTIVE       | Tài khoản không hoạt động      |
|  403 | AUTH-ERR-COMPANY-INACTIVE    | Công ty không hoạt động        |
|  429 | AUTH-ERR-TOO-MANY-ATTEMPTS   | Đăng nhập sai quá nhiều lần    |

#### Audit log

| Field       | Value                                           |
| ----------- | ----------------------------------------------- |
| action      | `LOGIN_SUCCESS` hoặc `LOGIN_FAILED`             |
| module_code | `AUTH`                                          |
| target_type | `User`                                          |
| target_id   | `user_id` nếu xác định được                     |
| old_value   | null                                            |
| new_value   | `{ "ip_address": "...", "client_type": "web" }` |

#### Notification event

Không gửi notification trong login thường.

Nếu phát hiện bất thường ở phase sau:

```text
AUTH.LOGIN_SUSPICIOUS
```

#### Idempotency

Không yêu cầu `Idempotency-Key`.

---

### AUTH-API-002: Refresh token

```http
POST /api/v1/auth/refresh-token
```

#### Mục đích

Dùng refresh token để lấy access token mới.

#### Required permission

```text
Public with valid refresh token
```

#### Request body

```json
{
  "refresh_token": "refresh_token_plain"
}
```

#### Validation

| Field         | Rule     |
| ------------- | -------- |
| refresh_token | Bắt buộc |

#### Business validation

1. Hash refresh token từ request.
2. Tìm `user_sessions.refresh_token_hash`.
3. Session phải chưa hết hạn.
4. Session chưa bị revoke.
5. User phải `Active`.
6. Company phải active.
7. Nếu bật refresh token rotation: revoke refresh token cũ và tạo refresh token mới.
8. Tạo access token mới.
9. Cập nhật `last_used_at`.

#### Response success

```json
{
  "success": true,
  "message": "Làm mới token thành công",
  "data": {
    "access_token": "new_access_token",
    "refresh_token": "new_refresh_token_if_rotated",
    "token_type": "Bearer",
    "expires_in": 3600,
    "refresh_expires_in": 2592000
  },
  "meta": {
    "request_id": "req_20260620_000002",
    "timestamp": "2026-06-20T10:05:00+07:00"
  }
}
```

#### Error cases

| HTTP | Error code                      | Trường hợp                 |
| ---: | ------------------------------- | -------------------------- |
|  400 | AUTH-ERR-REFRESH-TOKEN-REQUIRED | Thiếu refresh token        |
|  401 | AUTH-ERR-REFRESH-TOKEN-INVALID  | Refresh token không hợp lệ |
|  401 | AUTH-ERR-REFRESH-TOKEN-EXPIRED  | Refresh token hết hạn      |
|  401 | AUTH-ERR-SESSION-REVOKED        | Session đã bị thu hồi      |
|  403 | AUTH-ERR-USER-LOCKED            | User bị khóa               |

#### Audit log

Không bắt buộc ghi audit log cho mỗi lần refresh trong MVP, nhưng nên ghi `user_sessions.last_used_at`.

Nếu rotate token:

```text
REFRESH_TOKEN_ROTATED
```

#### Idempotency

Không yêu cầu.

---

### AUTH-API-003: Đăng xuất session hiện tại

```http
POST /api/v1/auth/logout
```

#### Required permission

```text
Authenticated
```

#### Request body

```json
{
  "refresh_token": "refresh_token_plain"
}
```

#### Business validation

1. Xác định user từ access token.
2. Xác định session hiện tại từ `session_id` trong token hoặc refresh token.
3. Set `user_sessions.revoked_at = now()`.
4. Set `revoked_reason = Logout`.
5. Access token hiện tại hết hạn tự nhiên hoặc đưa `jti` vào blacklist nếu hệ thống hỗ trợ.

#### Response success

```json
{
  "success": true,
  "message": "Đăng xuất thành công",
  "data": null,
  "meta": {
    "request_id": "req_20260620_000003",
    "timestamp": "2026-06-20T10:10:00+07:00"
  }
}
```

#### Audit log

```text
LOGOUT
```

#### Idempotency

Nên chấp nhận gọi lặp. Nếu session đã revoke, vẫn trả success.

---

### AUTH-API-004: Đăng xuất tất cả thiết bị

```http
POST /api/v1/auth/logout-all
```

#### Required permission

```text
Authenticated
```

#### Business validation

1. Xác định user hiện tại.
2. Revoke toàn bộ session active của user.
3. Có thể giữ session hiện tại nếu body `except_current_session = true`.

#### Request body

```json
{
  "except_current_session": false
}
```

#### Response success

```json
{
  "success": true,
  "message": "Đã đăng xuất khỏi tất cả thiết bị",
  "data": {
    "revoked_session_count": 3
  },
  "meta": {
    "request_id": "req_20260620_000004",
    "timestamp": "2026-06-20T10:15:00+07:00"
  }
}
```

#### Audit log

```text
LOGOUT_ALL
```

---

### AUTH-API-005: Quên mật khẩu

```http
POST /api/v1/auth/forgot-password
```

#### Required permission

```text
Public
```

#### Request body

```json
{
  "email": "user@company.com"
}
```

#### Validation

| Field | Rule                   |
| ----- | ---------------------- |
| email | Bắt buộc, email format |

#### Business validation

1. Không tiết lộ email có tồn tại hay không.
2. Nếu user tồn tại và active, tạo `password_reset_tokens`.
3. Token lưu dạng hash.
4. Token có `expired_at`.
5. Token chỉ dùng một lần.
6. Gửi email hoặc notification theo cấu hình.
7. Ghi audit/security event.

#### Response success

Luôn trả cùng một thông báo để tránh dò email:

```json
{
  "success": true,
  "message": "Nếu email tồn tại trong hệ thống, chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu.",
  "data": null,
  "meta": {
    "request_id": "req_20260620_000005",
    "timestamp": "2026-06-20T10:20:00+07:00"
  }
}
```

#### Audit log

Nếu user tồn tại:

```text
PASSWORD_RESET_REQUESTED
```

#### Notification event

```text
AUTH.PASSWORD_RESET_REQUESTED
```

---

### AUTH-API-006: Đặt lại mật khẩu

```http
POST /api/v1/auth/reset-password
```

#### Required permission

```text
Public with valid reset token
```

#### Request body

```json
{
  "token": "reset_token_plain",
  "new_password": "NewP@ssword123",
  "confirm_password": "NewP@ssword123"
}
```

#### Validation

| Field            | Rule                               |
| ---------------- | ---------------------------------- |
| token            | Bắt buộc                           |
| new_password     | Bắt buộc, đạt password policy      |
| confirm_password | Bắt buộc, phải khớp `new_password` |

#### Business validation

1. Hash token và tìm trong `password_reset_tokens`.
2. Token phải tồn tại.
3. Token chưa hết hạn.
4. Token chưa dùng.
5. User phải active.
6. Password mới đạt chính sách.
7. Password mới không được trùng password hiện tại nếu cấu hình yêu cầu.
8. Cập nhật `users.password_hash`.
9. Set `password_changed_at`.
10. Set token `used_at`.
11. Revoke toàn bộ session cũ của user.
12. Ghi audit log.

#### Response success

```json
{
  "success": true,
  "message": "Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.",
  "data": null,
  "meta": {
    "request_id": "req_20260620_000006",
    "timestamp": "2026-06-20T10:25:00+07:00"
  }
}
```

#### Error cases

| HTTP | Error code                         | Trường hợp                   |
| ---: | ---------------------------------- | ---------------------------- |
|  400 | AUTH-ERR-RESET-TOKEN-REQUIRED      | Thiếu token                  |
|  400 | AUTH-ERR-PASSWORD-CONFIRM-MISMATCH | Mật khẩu xác nhận không khớp |
|  400 | AUTH-ERR-PASSWORD-POLICY           | Mật khẩu không đạt yêu cầu   |
|  401 | AUTH-ERR-RESET-TOKEN-INVALID       | Token không hợp lệ           |
|  401 | AUTH-ERR-RESET-TOKEN-EXPIRED       | Token hết hạn                |
|  401 | AUTH-ERR-RESET-TOKEN-USED          | Token đã sử dụng             |

#### Audit log

```text
PASSWORD_RESET_COMPLETED
```

#### Notification event

```text
AUTH.PASSWORD_CHANGED
```

---

### AUTH-API-007: Đổi mật khẩu

```http
POST /api/v1/auth/change-password
```

#### Required permission

```text
AUTH.PASSWORD.CHANGE
```

#### Allowed roles

Super Admin, Admin công ty, HR, Manager, Employee và các user active có quyền tương ứng.

#### Data scope

```text
Own
```

#### Request body

```json
{
  "current_password": "OldP@ssword123",
  "new_password": "NewP@ssword123",
  "confirm_password": "NewP@ssword123",
  "logout_other_sessions": true
}
```

#### Business validation

1. User phải active.
2. `current_password` phải đúng.
3. `new_password` đạt chính sách.
4. `confirm_password` phải khớp.
5. Mật khẩu mới không nên trùng mật khẩu hiện tại.
6. Cập nhật `password_hash`.
7. Set `password_changed_at`.
8. Nếu `logout_other_sessions = true`, revoke session khác.
9. Ghi audit log.

#### Response success

```json
{
  "success": true,
  "message": "Đổi mật khẩu thành công",
  "data": {
    "other_sessions_revoked": true
  },
  "meta": {
    "request_id": "req_20260620_000007",
    "timestamp": "2026-06-20T10:30:00+07:00"
  }
}
```

#### Audit log

```text
PASSWORD_CHANGED
```

#### Notification event

```text
AUTH.PASSWORD_CHANGED
```

---

## 8. Chi tiết Current User API

---

### AUTH-API-050: Lấy thông tin user hiện tại

```http
GET /api/v1/auth/me
```

#### Required permission

```text
Authenticated
```

#### Data scope

```text
Own
```

#### Mục đích

`/auth/me` là **payload đầy đủ trong một call** dùng để bootstrap session cho frontend (route guard, Home Portal, App Switcher, Sidebar, Permission UI). Trả `user`, `company`, `employee`, `roles`, `permissions`, `modules`, `session`. `/auth/me/permissions` (AUTH-API-051) và `/auth/me/menu` (AUTH-API-053) là endpoint granular bổ trợ, không thay thế payload đầy đủ này.

#### Response success

```json
{
  "success": true,
  "message": "Lấy thông tin user hiện tại thành công",
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@company.com",
      "display_name": "Nguyễn Văn A",
      "status": "Active",
      "avatar_url": null,
      "last_login_at": "2026-06-20T08:00:00+07:00"
    },
    "company": {
      "id": "uuid",
      "name": "Demo Company",
      "status": "Active"
    },
    "employee": {
      "id": "uuid",
      "employee_code": "EMP0001",
      "full_name": "Nguyễn Văn A",
      "department": {
        "id": "uuid",
        "name": "Phòng Kỹ thuật"
      },
      "position": {
        "id": "uuid",
        "name": "Developer"
      }
    },
    "roles": [
      {
        "id": "uuid",
        "role_code": "EMPLOYEE",
        "name": "Employee"
      }
    ],
    "permissions": [
      {
        "permission_code": "ATT.ATTENDANCE.CHECK_IN",
        "module_code": "ATT",
        "resource": "ATTENDANCE",
        "action": "CHECK_IN",
        "scopes": ["Own"]
      },
      {
        "permission_code": "LEAVE.REQUEST.CREATE",
        "module_code": "LEAVE",
        "resource": "REQUEST",
        "action": "CREATE",
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
      "id": "uuid",
      "expires_at": "2026-07-20T21:00:00+07:00"
    }
  },
  "meta": {
    "request_id": "req_20260620_000050",
    "timestamp": "2026-06-20T10:35:00+07:00"
  }
}
```

#### Business validation

1. Token hợp lệ.
2. User active.
3. Company active.
4. Nếu user liên kết employee thì trả employee summary.
5. Không trả dữ liệu nhạy cảm của employee nếu API này không có quyền HR sensitive.
6. Trả đủ `permissions` + `modules` trong cùng response (payload đầy đủ một call). Mỗi permission serialize `scopes: DataScope[]` (mảng hợp scope), KHÔNG dùng `data_scope` số ít. `data_scope` số ít chỉ tồn tại ở row `role_permissions`.
7. SUPER_ADMIN/System: backend có thể short-circuit theo `System` scope như ngoại lệ hợp lệ (khớp §3.4).

---

### AUTH-API-051: Lấy permission hiện tại

```http
GET /api/v1/auth/me/permissions
```

#### Required permission

```text
Authenticated
```

#### Response success

```json
{
  "success": true,
  "message": "Lấy danh sách quyền thành công",
  "data": {
    "permissions": [
      {
        "permission_code": "ATT.ATTENDANCE.VIEW",
        "module_code": "ATT",
        "resource": "ATTENDANCE",
        "action": "VIEW",
        "scopes": ["Own"]
      },
      {
        "permission_code": "LEAVE.REQUEST.VIEW",
        "module_code": "LEAVE",
        "resource": "REQUEST",
        "action": "VIEW",
        "scopes": ["Own", "Team"]
      }
    ],
    "permission_codes": [
      "ATT.ATTENDANCE.VIEW",
      "LEAVE.REQUEST.VIEW"
    ],
    "resolved_at": "2026-06-20T10:40:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000051",
    "timestamp": "2026-06-20T10:40:00+07:00"
  }
}
```

#### Business validation

1. Lấy role active của user.
2. Lấy permission active từ role active.
3. Bỏ qua role hết hạn.
4. Bỏ qua permission inactive.
5. Nếu cùng permission có nhiều scope (từ nhiều role/row), **luôn trả `scopes: DataScope[]` là mảng hợp (union) các scope**. KHÔNG serialize thành `data_scope` số ít. `data_scope` số ít chỉ đúng cho một row `role_permissions` đơn lẻ; effective permission sau merge luôn là `scopes[]`.
6. Có thể cache ngắn hạn theo `user_id + company_id + permission_version`.

---

### AUTH-API-053: Lấy menu/sidebar theo quyền

```http
GET /api/v1/auth/me/menu
```

#### Required permission

```text
Authenticated
```

#### Mục đích

Trả về danh sách menu frontend được phép hiển thị theo permission hiện tại.

#### Response success

```json
{
  "success": true,
  "message": "Lấy menu thành công",
  "data": [
    {
      "menu_code": "DASHBOARD",
      "label": "Dashboard",
      "path": "/dashboard",
      "icon": "dashboard",
      "children": []
    },
    {
      "menu_code": "HR_EMPLOYEES",
      "label": "Nhân sự",
      "path": "/hr/employees",
      "icon": "users",
      "required_permission": "HR.EMPLOYEE.VIEW",
      "children": []
    }
  ],
  "meta": {
    "request_id": "req_20260620_000053",
    "timestamp": "2026-06-20T10:45:00+07:00"
  }
}
```

#### Business validation

1. Backend resolve permission.
2. Menu chỉ trả item user có quyền.
3. Frontend có thể ẩn menu, nhưng backend vẫn phải kiểm tra permission ở API nghiệp vụ.
4. Menu có thể lấy từ seed/module config ở Foundation.

---

## 9. Chi tiết User Management API

---

### AUTH-API-101: Lấy danh sách user

```http
GET /api/v1/auth/users
```

#### Required permission

```text
AUTH.USER.VIEW
```

#### Allowed roles

Super Admin, Admin công ty, HR nếu được cấp quyền.

#### Data scope

| Scope      | Quyền truy cập                               |
| ---------- | -------------------------------------------- |
| Company    | Xem user trong công ty hiện tại              |
| System     | Xem user toàn hệ thống                       |
| Department | Không khuyến nghị dùng cho quản trị user MVP |
| Team       | Không khuyến nghị dùng cho quản trị user MVP |
| Own        | Không áp dụng cho danh sách user quản trị    |

#### Query params

```http
GET /api/v1/auth/users?page=1&per_page=20&q=nguyen&status=Active&role_code=EMPLOYEE&sort=created_at:desc
```

| Param         | Kiểu   | Mô tả                                                |
| ------------- | ------ | ---------------------------------------------------- |
| page          | number | Trang hiện tại                                       |
| per_page      | number | Số item/trang, max 100                               |
| q             | string | Search email/display_name/employee_code              |
| status        | string | Active, Locked, Inactive, Pending Activation         |
| role_code     | string | Lọc theo role                                        |
| department_id | uuid   | Lọc theo department nếu join HR                      |
| sort          | string | `created_at:desc`, `email:asc`, `last_login_at:desc` |

#### Response success

```json
{
  "success": true,
  "message": "Lấy danh sách user thành công",
  "data": [
    {
      "id": "uuid",
      "email": "user@company.com",
      "display_name": "Nguyễn Văn A",
      "status": "Active",
      "employee": {
        "id": "uuid",
        "employee_code": "EMP0001",
        "full_name": "Nguyễn Văn A"
      },
      "roles": [
        {
          "id": "uuid",
          "role_code": "EMPLOYEE",
          "name": "Employee"
        }
      ],
      "last_login_at": "2026-06-20T08:00:00+07:00",
      "created_at": "2026-06-20T08:00:00+07:00"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 1,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  },
  "meta": {
    "request_id": "req_20260620_000101",
    "timestamp": "2026-06-20T11:00:00+07:00"
  }
}
```

#### Business validation

1. Backend resolve `company_id` từ auth context.
2. Không nhận `company_id` từ query trừ Super Admin scope System.
3. Chỉ trả user chưa soft delete.
4. Không trả `password_hash`.
5. Filter role phải join `user_roles`, `roles`.
6. Nếu user scope Company thì filter `users.company_id = current_company_id`.
7. Nếu user scope System thì cho phép filter `company_id`.
8. Search phải dùng normalized field/index.

#### Audit log

Không bắt buộc khi xem danh sách.

Nếu export danh sách user ở phase sau thì bắt buộc audit.

---

### AUTH-API-102: Lấy chi tiết user

```http
GET /api/v1/auth/users/{user_id}
```

#### Required permission

```text
AUTH.USER.VIEW
```

#### Data scope

Company/System.

#### Response success

```json
{
  "success": true,
  "message": "Lấy chi tiết user thành công",
  "data": {
    "id": "uuid",
    "email": "user@company.com",
    "display_name": "Nguyễn Văn A",
    "status": "Active",
    "email_verified_at": "2026-06-20T08:00:00+07:00",
    "last_login_at": "2026-06-20T08:00:00+07:00",
    "password_changed_at": "2026-06-20T08:00:00+07:00",
    "must_change_password": false,
    "employee": {
      "id": "uuid",
      "employee_code": "EMP0001",
      "full_name": "Nguyễn Văn A",
      "department": {
        "id": "uuid",
        "name": "Phòng Kỹ thuật"
      },
      "position": {
        "id": "uuid",
        "name": "Developer"
      }
    },
    "roles": [
      {
        "id": "uuid",
        "role_code": "EMPLOYEE",
        "name": "Employee",
        "assigned_at": "2026-06-20T08:00:00+07:00"
      }
    ],
    "created_at": "2026-06-20T08:00:00+07:00",
    "updated_at": "2026-06-20T08:30:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000102",
    "timestamp": "2026-06-20T11:05:00+07:00"
  }
}
```

#### Business validation

1. User target phải thuộc company trong scope.
2. Super Admin scope System được xem liên company.
3. Không trả password/token/hash.
4. Nếu target là Super Admin, Admin thường không được xem/can thiệp nếu thiếu quyền đặc biệt.

---

### AUTH-API-103: Tạo user

```http
POST /api/v1/auth/users
```

#### Required permission

```text
AUTH.USER.CREATE
```

#### Allowed roles

Super Admin, Admin công ty, HR nếu được cấp quyền.

#### Data scope

Company/System.

#### Request body

```json
{
  "email": "new.user@company.com",
  "display_name": "Nguyễn Văn B",
  "employee_id": "uuid",
  "role_ids": ["uuid"],
  "status": "Pending Activation",
  "must_change_password": true,
  "send_activation_email": true
}
```

#### Validation

| Field                 | Rule                                         |
| --------------------- | -------------------------------------------- |
| email                 | Bắt buộc, email format, unique trong company |
| display_name          | Bắt buộc, max 255                            |
| employee_id           | UUID, optional                               |
| role_ids              | Array UUID, optional                         |
| status                | Pending Activation/Active/Inactive           |
| must_change_password  | Boolean                                      |
| send_activation_email | Boolean                                      |

#### Business validation

1. Email normalize lowercase.
2. Email không được trùng trong cùng company.
3. Nếu có `employee_id`, employee phải thuộc cùng company.
4. Employee chưa được link với user khác.
5. Người tạo không được tạo user scope cao hơn quyền của mình.
6. Admin công ty không được tạo Super Admin.
7. HR chỉ được tạo user cho employee nếu có quyền.
8. Role gán phải thuộc cùng company hoặc role global hợp lệ.
9. Không cho tự gán role vượt quyền.
10. Nếu không truyền password, tạo activation/reset token.
11. Nếu `send_activation_email = true`, phát notification/email kích hoạt.
12. Ghi audit log.

#### Response success

```json
{
  "success": true,
  "message": "Tạo user thành công",
  "data": {
    "id": "uuid",
    "email": "new.user@company.com",
    "display_name": "Nguyễn Văn B",
    "status": "Pending Activation",
    "employee": {
      "id": "uuid",
      "employee_code": "EMP0002",
      "full_name": "Nguyễn Văn B"
    },
    "roles": [
      {
        "id": "uuid",
        "role_code": "EMPLOYEE",
        "name": "Employee"
      }
    ]
  },
  "meta": {
    "request_id": "req_20260620_000103",
    "timestamp": "2026-06-20T11:10:00+07:00"
  }
}
```

#### Audit log

```text
USER_CREATED
```

#### Notification event

```text
AUTH.USER_CREATED
```

#### Idempotency

Nên yêu cầu `Idempotency-Key`.

Lý do: tránh tạo trùng user khi frontend retry.

---

### AUTH-API-104: Cập nhật user

```http
PATCH /api/v1/auth/users/{user_id}
```

#### Required permission

```text
AUTH.USER.UPDATE
```

#### Request body

```json
{
  "display_name": "Nguyễn Văn B Updated",
  "status": "Active",
  "avatar_file_id": "uuid",
  "must_change_password": false
}
```

#### Business validation

1. Target user thuộc scope.
2. Không cho sửa email trực tiếp nếu chưa có nghiệp vụ verify email.
3. Không cho sửa `password_hash`.
4. Không cho Admin thường cập nhật Super Admin.
5. Nếu đổi status sang Inactive/Locked thì revoke session active nếu cấu hình.
6. Nếu `avatar_file_id`, file phải thuộc company và user có quyền dùng.
7. Ghi audit log old/new diff.

#### Audit log

```text
USER_UPDATED
```

---

### AUTH-API-105: Khóa user

```http
POST /api/v1/auth/users/{user_id}/lock
```

#### Required permission

```text
AUTH.USER.LOCK
```

#### Request body

```json
{
  "reason": "Vi phạm chính sách bảo mật",
  "revoke_sessions": true
}
```

#### Business validation

1. Không được tự khóa chính mình nếu là admin duy nhất.
2. Admin công ty không được khóa Super Admin.
3. Target user thuộc scope.
4. User chưa bị deleted.
5. Set `status = Locked`.
6. Set `locked_at`, `locked_reason`.
7. Nếu `revoke_sessions = true`, revoke toàn bộ session.
8. Ghi audit log.

#### Response success

```json
{
  "success": true,
  "message": "Khóa user thành công",
  "data": {
    "id": "uuid",
    "status": "Locked",
    "locked_at": "2026-06-20T11:20:00+07:00",
    "revoked_session_count": 2
  },
  "meta": {
    "request_id": "req_20260620_000105",
    "timestamp": "2026-06-20T11:20:00+07:00"
  }
}
```

#### Audit log

```text
USER_LOCKED
```

#### Notification event

```text
AUTH.USER_LOCKED
```

---

### AUTH-API-106: Mở khóa user

```http
POST /api/v1/auth/users/{user_id}/unlock
```

#### Required permission

```text
AUTH.USER.UNLOCK
```

#### Request body

```json
{
  "reason": "Đã xác minh lại tài khoản"
}
```

#### Business validation

1. Target user thuộc scope.
2. User đang Locked.
3. Không cho mở khóa user Deleted.
4. Set `status = Active`.
5. Clear hoặc giữ `locked_reason` theo policy.
6. Ghi audit log.

#### Audit log

```text
USER_UNLOCKED
```

#### Notification event

```text
AUTH.USER_UNLOCKED
```

---

### AUTH-API-107: Thay thế role của user

```http
PUT /api/v1/auth/users/{user_id}/roles
```

#### Required permission

```text
AUTH.USER.ASSIGN_ROLE
```

#### Request body

```json
{
  "role_ids": ["uuid-1", "uuid-2"],
  "reason": "Cập nhật vai trò theo vị trí mới"
}
```

#### Business validation

1. Target user thuộc scope.
2. Role phải active.
3. Role thuộc cùng company hoặc là global role hợp lệ.
4. Không được gán role `SUPER_ADMIN` nếu actor không phải Super Admin.
5. Không được tự nâng quyền cho chính mình nếu không có quyền đặc biệt.
6. Không được gỡ role quản trị cuối cùng khiến company không còn admin nếu cấu hình yêu cầu.
7. Gỡ role cũ không còn trong danh sách.
8. Thêm role mới.
9. Invalidate permission cache của user.
10. Recalculate effective permissions.
11. Ghi audit log.

#### Response success

```json
{
  "success": true,
  "message": "Cập nhật role của user thành công",
  "data": {
    "user_id": "uuid",
    "roles": [
      {
        "id": "uuid-1",
        "role_code": "EMPLOYEE",
        "name": "Employee"
      },
      {
        "id": "uuid-2",
        "role_code": "MANAGER",
        "name": "Manager"
      }
    ]
  },
  "meta": {
    "request_id": "req_20260620_000107",
    "timestamp": "2026-06-20T11:30:00+07:00"
  }
}
```

#### Audit log

```text
USER_ROLE_UPDATED
```

#### Notification event

```text
AUTH.USER_ROLE_CHANGED
```

#### Idempotency

Nên hỗ trợ idempotent vì `PUT` cùng body nhiều lần cho cùng kết quả.

---

## 10. Chi tiết Role API

---

### AUTH-API-201: Lấy danh sách role

```http
GET /api/v1/auth/roles
```

#### Required permission

```text
AUTH.ROLE.VIEW
```

#### Query params

```http
GET /api/v1/auth/roles?page=1&per_page=20&q=hr&status=Active&role_type=Company
```

| Param                | Mô tả                         |
| -------------------- | ----------------------------- |
| q                    | Search role_code/name         |
| status               | Active/Inactive               |
| role_type            | System/Company/Project/Future |
| include_system_roles | true/false                    |

#### Response success

```json
{
  "success": true,
  "message": "Lấy danh sách role thành công",
  "data": [
    {
      "id": "uuid",
      "role_code": "HR",
      "name": "HR",
      "description": "Quản lý nhân sự",
      "role_type": "Company",
      "is_system_role": false,
      "is_default": false,
      "status": "Active",
      "permission_count": 25,
      "user_count": 3
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 1,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  },
  "meta": {
    "request_id": "req_20260620_000201",
    "timestamp": "2026-06-20T11:40:00+07:00"
  }
}
```

#### Business validation

1. Company Admin chỉ xem role trong company + role global được phép.
2. Super Admin scope System xem toàn bộ.
3. Không trả role deleted.

---

### AUTH-API-203: Tạo role

```http
POST /api/v1/auth/roles
```

#### Required permission

```text
AUTH.ROLE.CREATE
```

#### Request body

```json
{
  "role_code": "TEAM_LEAD",
  "name": "Team Lead",
  "description": "Trưởng nhóm",
  "role_type": "Company",
  "is_default": false,
  "status": "Active"
}
```

#### Validation

| Field      | Rule                                                 |
| ---------- | ---------------------------------------------------- |
| role_code  | Bắt buộc, uppercase snake case, unique trong company |
| name       | Bắt buộc                                             |
| role_type  | Company/Project/Future                               |
| is_default | Boolean                                              |
| status     | Active/Inactive                                      |

#### Business validation

1. `role_code` không trùng trong company.
2. Company Admin không được tạo role type System.
3. `is_system_role` chỉ system/migration được tạo.
4. Không tự động gán permission nếu không truyền.
5. Ghi audit log.

#### Audit log

```text
ROLE_CREATED
```

#### Idempotency

Nên yêu cầu `Idempotency-Key`.

---

### AUTH-API-204: Cập nhật role

```http
PATCH /api/v1/auth/roles/{role_id}
```

#### Required permission

```text
AUTH.ROLE.UPDATE
```

#### Request body

```json
{
  "name": "Team Lead Updated",
  "description": "Trưởng nhóm cập nhật",
  "is_default": false,
  "status": "Active"
}
```

#### Business validation

1. Role thuộc scope.
2. Không cho sửa `role_code` của system role.
3. Không cho Admin công ty sửa role `SUPER_ADMIN`.
4. Nếu set inactive, permission từ role không còn hiệu lực.
5. Invalidate permission cache của users đang có role.
6. Ghi audit log.

#### Audit log

```text
ROLE_UPDATED
```

---

### AUTH-API-205: Vô hiệu hóa role

```http
DELETE /api/v1/auth/roles/{role_id}
```

#### Required permission

```text
AUTH.ROLE.DELETE
```

#### Business validation

1. Role thuộc scope.
2. Không được xóa system role.
3. Không được xóa role đang là role quản trị cuối cùng nếu cấu hình yêu cầu.
4. Không xóa cứng, chỉ set `status = Inactive`, `deleted_at`.
5. Invalidate permission cache của users liên quan.
6. Ghi audit log.

#### Response success

```json
{
  "success": true,
  "message": "Vô hiệu hóa role thành công",
  "data": null,
  "meta": {
    "request_id": "req_20260620_000205",
    "timestamp": "2026-06-20T11:50:00+07:00"
  }
}
```

#### Audit log

```text
ROLE_DISABLED
```

---

### AUTH-API-207: Thay thế permission của role

```http
PUT /api/v1/auth/roles/{role_id}/permissions
```

#### Required permission

```text
AUTH.PERMISSION.ASSIGN
```

#### Request body

```json
{
  "permissions": [
    {
      "permission_id": "uuid-1",
      "data_scope": "Company",
      "conditions": null
    },
    {
      "permission_id": "uuid-2",
      "data_scope": "Own",
      "conditions": {
        "only_active_employee": true
      }
    }
  ],
  "reason": "Cập nhật quyền cho role HR"
}
```

#### Validation

| Field         | Rule                                       |
| ------------- | ------------------------------------------ |
| permissions   | Array bắt buộc                             |
| permission_id | UUID bắt buộc                              |
| data_scope    | Own/Team/Department/Project/Company/System |
| conditions    | JSON object optional                       |

#### Business validation

1. Role thuộc scope.
2. Permission tồn tại và active.
3. Actor không thể gán permission mà chính actor không có, trừ Super Admin.
4. Company Admin không được gán scope System.
5. Không gán permission sensitive nếu actor thiếu quyền đặc biệt.
6. Không gán payroll permission cho HR mặc định nếu policy chưa cho phép.
7. Xóa/gỡ các role_permissions không còn trong danh sách.
8. Thêm/cập nhật permission mới.
9. Invalidate permission cache của toàn bộ user có role này.
10. Ghi audit log.

#### Response success

```json
{
  "success": true,
  "message": "Cập nhật permission cho role thành công",
  "data": {
    "role_id": "uuid",
    "permission_count": 2,
    "permissions": [
      {
        "permission_code": "HR.EMPLOYEE.VIEW",
        "data_scope": "Company"
      },
      {
        "permission_code": "AUTH.PROFILE.VIEW",
        "data_scope": "Own"
      }
    ]
  },
  "meta": {
    "request_id": "req_20260620_000207",
    "timestamp": "2026-06-20T12:00:00+07:00"
  }
}
```

#### Audit log

```text
ROLE_PERMISSION_UPDATED
```

#### Idempotency

`PUT` nên idempotent.

---

## 11. Chi tiết Permission API

---

### AUTH-API-301: Lấy danh sách permission

```http
GET /api/v1/auth/permissions
```

#### Required permission

```text
AUTH.PERMISSION.VIEW
```

#### Query params

```http
GET /api/v1/auth/permissions?module_code=HR&resource=EMPLOYEE&action=VIEW&q=employee
```

| Param        | Mô tả                              |
| ------------ | ---------------------------------- |
| module_code  | Lọc theo module                    |
| resource     | Lọc theo resource                  |
| action       | Lọc theo action                    |
| is_sensitive | true/false                         |
| q            | Search permission_code/description |

#### Response success

```json
{
  "success": true,
  "message": "Lấy danh sách permission thành công",
  "data": [
    {
      "id": "uuid",
      "module_code": "AUTH",
      "permission_code": "AUTH.USER.VIEW",
      "resource": "USER",
      "action": "VIEW",
      "description": "Xem danh sách user",
      "is_sensitive": false,
      "is_system_permission": true,
      "is_active": true
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 50,
    "total": 1,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  },
  "meta": {
    "request_id": "req_20260620_000301",
    "timestamp": "2026-06-20T12:10:00+07:00"
  }
}
```

#### Business validation

1. Chỉ trả permission active mặc định.
2. Nếu query `include_inactive=true`, cần quyền đặc biệt hoặc Super Admin.
3. Permission là catalog hệ thống, không phụ thuộc company trong MVP.

---

### AUTH-API-304: Permission matrix

```http
GET /api/v1/auth/permissions/matrix
```

#### Required permission

```text
AUTH.PERMISSION.VIEW
```

#### Mục đích

Trả permission dạng nhóm theo module/resource/action để UI gán quyền dễ hiển thị.

#### Response success

```json
{
  "success": true,
  "message": "Lấy permission matrix thành công",
  "data": [
    {
      "module_code": "AUTH",
      "resources": [
        {
          "resource": "USER",
          "actions": [
            {
              "action": "VIEW",
              "permission_id": "uuid",
              "permission_code": "AUTH.USER.VIEW",
              "description": "Xem danh sách user",
              "allowed_scopes": ["Company", "System"]
            },
            {
              "action": "CREATE",
              "permission_id": "uuid",
              "permission_code": "AUTH.USER.CREATE",
              "description": "Tạo user",
              "allowed_scopes": ["Company", "System"]
            }
          ]
        }
      ]
    }
  ],
  "meta": {
    "request_id": "req_20260620_000304",
    "timestamp": "2026-06-20T12:15:00+07:00"
  }
}
```

---

## 12. Session API

---

### AUTH-API-054: Lấy session của tôi

```http
GET /api/v1/auth/me/sessions
```

#### Required permission

```text
Authenticated
```

#### Data scope

```text
Own
```

#### Response success

```json
{
  "success": true,
  "message": "Lấy danh sách phiên đăng nhập thành công",
  "data": [
    {
      "id": "uuid",
      "platform": "WEB",
      "device_name": "Chrome on Windows",
      "ip_address": "127.0.0.1",
      "last_used_at": "2026-06-20T12:20:00+07:00",
      "expired_at": "2026-07-20T12:20:00+07:00",
      "is_current_session": true,
      "created_at": "2026-06-20T08:00:00+07:00"
    }
  ],
  "meta": {
    "request_id": "req_20260620_000054",
    "timestamp": "2026-06-20T12:20:00+07:00"
  }
}
```

---

### AUTH-API-055: Thu hồi session của tôi

```http
DELETE /api/v1/auth/me/sessions/{session_id}
```

#### Required permission

```text
Authenticated
```

#### Business validation

1. Session phải thuộc user hiện tại.
2. Session chưa revoke thì set `revoked_at`.
3. Nếu session đã revoke, vẫn trả success.
4. Không được xóa cứng.

#### Audit log

```text
SESSION_REVOKED
```

---

## 13. Security log API

---

### AUTH-API-401: Xem login log

```http
GET /api/v1/auth/login-logs
```

#### Required permission

```text
AUTH.AUDIT_LOG.VIEW
```

#### Data scope

| Scope   | Dữ liệu được xem         |
| ------- | ------------------------ |
| Own     | Login log của chính mình |
| Company | Login log trong công ty  |
| System  | Login log toàn hệ thống  |

#### Query params

```http
GET /api/v1/auth/login-logs?page=1&per_page=20&user_id=uuid&status=SUCCESS&from_date=2026-06-01&to_date=2026-06-20
```

#### Response success

```json
{
  "success": true,
  "message": "Lấy login log thành công",
  "data": [
    {
      "id": "uuid",
      "user": {
        "id": "uuid",
        "email": "user@company.com",
        "display_name": "Nguyễn Văn A"
      },
      "status": "SUCCESS",
      "ip_address": "127.0.0.1",
      "user_agent": "Mozilla/5.0",
      "failure_reason": null,
      "created_at": "2026-06-20T08:00:00+07:00"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 1,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  },
  "meta": {
    "request_id": "req_20260620_000401",
    "timestamp": "2026-06-20T12:30:00+07:00"
  }
}
```

---

## 14. Error code chuẩn cho AUTH

| HTTP | Code                               | Message                                          |
| ---: | ---------------------------------- | ------------------------------------------------ |
|  400 | AUTH-ERR-EMAIL-REQUIRED            | Vui lòng nhập email                              |
|  400 | AUTH-ERR-PASSWORD-REQUIRED         | Vui lòng nhập mật khẩu                           |
|  400 | AUTH-ERR-INVALID-EMAIL-FORMAT      | Email không đúng định dạng                       |
|  400 | AUTH-ERR-PASSWORD-CONFIRM-MISMATCH | Mật khẩu xác nhận không khớp                     |
|  400 | AUTH-ERR-PASSWORD-POLICY           | Mật khẩu chưa đáp ứng yêu cầu bảo mật            |
|  401 | AUTH-ERR-INVALID-CREDENTIALS       | Email hoặc mật khẩu không đúng                   |
|  401 | AUTH-ERR-UNAUTHENTICATED           | Bạn cần đăng nhập để tiếp tục                    |
|  401 | AUTH-ERR-TOKEN-EXPIRED             | Phiên đăng nhập đã hết hạn                       |
|  401 | AUTH-ERR-REFRESH-TOKEN-INVALID     | Refresh token không hợp lệ                       |
|  401 | AUTH-ERR-RESET-TOKEN-INVALID       | Link đặt lại mật khẩu không hợp lệ               |
|  403 | AUTH-ERR-FORBIDDEN                 | Bạn không có quyền thực hiện thao tác này        |
|  403 | AUTH-ERR-USER-LOCKED               | Tài khoản của bạn đã bị khóa                     |
|  403 | AUTH-ERR-USER-INACTIVE             | Tài khoản không hoạt động                        |
|  403 | AUTH-ERR-COMPANY-INACTIVE          | Công ty không hoạt động                          |
|  403 | AUTH-ERR-SCOPE-DENIED              | Dữ liệu không thuộc phạm vi được phép            |
|  404 | AUTH-ERR-USER-NOT-FOUND            | Không tìm thấy user                              |
|  404 | AUTH-ERR-ROLE-NOT-FOUND            | Không tìm thấy role                              |
|  404 | AUTH-ERR-PERMISSION-NOT-FOUND      | Không tìm thấy permission                        |
|  409 | AUTH-ERR-EMAIL-EXISTS              | Email đã tồn tại                                 |
|  409 | AUTH-ERR-ROLE-CODE-EXISTS          | Mã role đã tồn tại                               |
|  409 | AUTH-ERR-ROLE-IN-USE               | Role đang được sử dụng                           |
|  429 | AUTH-ERR-TOO-MANY-ATTEMPTS         | Bạn thao tác quá nhiều lần, vui lòng thử lại sau |

---

## 15. Status code convention riêng cho AUTH

| Trường hợp                | HTTP |
| ------------------------- | ---: |
| Login success             |  200 |
| Refresh token success     |  200 |
| Logout success            |  200 |
| Create user               |  201 |
| Create role               |  201 |
| Update user/role          |  200 |
| Lock/unlock user          |  200 |
| Delete/disable role       |  200 |
| Validation error          |  400 |
| Token missing/invalid     |  401 |
| Permission denied         |  403 |
| Resource not found        |  404 |
| Duplicate email/role code |  409 |
| Rate limit                |  429 |
| Server error              |  500 |

---

## 16. Idempotency rule cho AUTH

| API               | Có cần Idempotency-Key            | Lý do                         |
| ----------------- | --------------------------------- | ----------------------------- |
| Login             | Không                             | Mỗi lần login tạo session mới |
| Refresh token     | Không bắt buộc                    | Có rotation riêng             |
| Logout            | Không                             | Gọi lặp vẫn success           |
| Forgot password   | Nên rate limit hơn là idempotency |                               |
| Reset password    | Không                             | Token chỉ dùng một lần        |
| Change password   | Không                             |                               |
| Create user       | Có                                |                               |
| Create role       | Có                                |                               |
| Assign role       | Nên có                            |                               |
| Assign permission | Nên có                            |                               |
| Lock/unlock user  | Nên có                            |                               |

---

## 17. Rate limit đề xuất

| API               | Limit đề xuất                |
| ----------------- | ---------------------------- |
| Login             | 5 lần / 5 phút / email + IP  |
| Forgot password   | 3 lần / 15 phút / email + IP |
| Reset password    | 5 lần / 15 phút / token/IP   |
| Refresh token     | 30 lần / phút / user         |
| Change password   | 5 lần / 15 phút / user       |
| Create user/role  | Theo permission, có audit    |
| Assign permission | Theo permission, có audit    |

---

## 18. Security checklist

1. Không lưu password plain text.
2. Không trả `password_hash`.
3. Refresh token lưu hash.
4. Password reset token lưu hash.
5. Reset token chỉ dùng một lần.
6. Không tiết lộ email tồn tại hay không ở forgot password.
7. User Locked/Inactive/Deleted không được login.
8. Khi user bị khóa, revoke toàn bộ session.
9. Khi đổi/reset password, revoke session cũ theo policy.
10. Backend luôn kiểm tra permission.
11. Backend luôn kiểm tra data scope.
12. Admin thường không được chỉnh Super Admin.
13. User không được tự nâng quyền.
14. Role system không được xóa/sửa code.
15. Permission catalog không cho user thường tự tạo.
16. Mọi thao tác quản trị phải audit.
17. API danh sách phải phân trang.
18. Search/filter phải luôn theo `company_id`.
19. Không nhận `company_id` từ body nghiệp vụ thông thường.
20. Dữ liệu nhạy cảm trong audit log phải mask trước khi ghi.

---

## 19. Test case chính cho API-02

| Mã test      | API               | Nội dung                            | Kỳ vọng                            |
| ------------ | ----------------- | ----------------------------------- | ---------------------------------- |
| API02-TC-001 | Login             | Đăng nhập đúng email/password       | Thành công, tạo session            |
| API02-TC-002 | Login             | Sai password                        | 401, ghi login failed              |
| API02-TC-003 | Login             | User Locked                         | 403                                |
| API02-TC-004 | Login             | User Inactive                       | 403                                |
| API02-TC-005 | Refresh           | Refresh token hợp lệ                | Cấp access token mới               |
| API02-TC-006 | Refresh           | Refresh token expired               | 401                                |
| API02-TC-007 | Logout            | Logout session hiện tại             | Revoke session                     |
| API02-TC-008 | Forgot password   | Email tồn tại                       | Tạo reset token, trả message chung |
| API02-TC-009 | Forgot password   | Email không tồn tại                 | Vẫn trả message chung              |
| API02-TC-010 | Reset password    | Token hợp lệ                        | Đổi mật khẩu thành công            |
| API02-TC-011 | Reset password    | Token đã dùng                       | 401                                |
| API02-TC-012 | Change password   | Current password đúng               | Thành công                         |
| API02-TC-013 | Change password   | Current password sai                | 400/401                            |
| API02-TC-014 | User list         | Không có token                      | 401                                |
| API02-TC-015 | User list         | Không có permission                 | 403                                |
| API02-TC-016 | Create user       | Email trùng company                 | 409                                |
| API02-TC-017 | Create user       | Email giống khác company            | Cho phép nếu multi-tenant          |
| API02-TC-018 | Lock user         | Admin khóa user                     | User không login được              |
| API02-TC-019 | Unlock user       | Admin mở khóa user                  | User login lại được                |
| API02-TC-020 | Assign role       | Gán role hợp lệ                     | User nhận quyền mới                |
| API02-TC-021 | Assign role       | Admin thường gán Super Admin        | Bị chặn                            |
| API02-TC-022 | Assign permission | Gán scope System bởi Company Admin  | Bị chặn                            |
| API02-TC-023 | Permission cache  | Đổi role/permission                 | Permission cache bị invalidate     |
| API02-TC-024 | Audit             | Tạo user/role/gán quyền             | Có audit log                       |
| API02-TC-025 | Data scope        | Company Admin xem user công ty khác | Bị chặn                            |
| API02-TC-026 | System scope      | Super Admin xem user toàn hệ thống  | Thành công                         |

---

## 20. OpenAPI / Swagger

> Đặc tả OpenAPI 3.1 máy đọc cho toàn hệ thống: [`openapi/enterprise-api.yaml`](openapi/enterprise-api.yaml). Fragment của module: [`openapi/paths/auth.paths.yaml`](openapi/paths/auth.paths.yaml). Quy ước build & vendor extension: [`openapi/README.md`](openapi/README.md). Phân quyền: [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [Audit Report](<API-10 PERMISSION AUDIT REPORT.md>).

### 20.1 Security
`bearerAuth` (HTTP bearer JWT) cho `/api/v1/*` cần đăng nhập; `internalServiceAuth` (header `X-Internal-Token`) cho `/internal/v1/*`; endpoint public (login, refresh-token, forgot-password, reset-password) dùng `security: []`.

### 20.2 Tags của module
- `Auth - Session` — login/logout/refresh/đổi-quên-đặt lại mật khẩu
- `Auth - Me` — thông tin user hiện tại, session của tôi
- `Auth - Users` — quản lý user
- `Auth - Roles` — quản lý role
- `Auth - Permissions` — permission catalog & matrix
- `Auth - Security Logs` — login log, security event, audit log

### 20.3 Vendor extensions (đồng nhất toàn hệ thống)
| Extension | Giá trị | Ý nghĩa |
| --------- | ------- | ------- |
| `x-required-permission` | `string` \| `string[]` \| `null` | permission bắt buộc (`null` = Public/Authenticated) |
| `x-permission-mode` | `allOf` \| `anyOf` | cách kết hợp khi là mảng (mặc định `allOf`) |
| `x-allowed-roles` | `string[]` | role gợi ý (không enforce) |
| `x-data-scope` | `string[]` | Own/Team/Department/Project/Company/System |
| `x-idempotency` | `Required` \| `Optional` \| `No` | header `Idempotency-Key` |
| `x-audit-log` | `always` \| `conditional` \| `none` | mức ghi audit |
| `x-notification-event` | `string` \| `null` | event phát ra |

operationId prefix: `auth`.

### 20.4 Schema & response dùng chung
Tái dùng từ spec tổng (định nghĩa trong `enterprise-api.base.yaml`): envelope `SuccessResponse` / `SuccessListResponse` / `CursorListResponse`, lỗi `ErrorResponse` / `ValidationErrorResponse`, kèm `Meta` / `Pagination` / `CursorPagination`. Common responses 400/401/403/404/409/422/429/500. Common params `PageParam`, `PerPageParam`, `SearchParam`, `SortParam`, `IdempotencyKey`.

### 20.5 DTO đề xuất cho module
`LoginRequest`, `TokenPairResponse`, `RefreshTokenRequest`, `ChangePasswordRequest`, `ForgotPasswordRequest`, `ResetPasswordRequest`, `CurrentUserDto`, `UserSummaryDto`, `UserDetailDto`, `CreateUserRequest`, `UpdateUserRequest`, `AssignRolesRequest`, `RoleSummaryDto`, `RoleDetailDto`, `CreateRoleRequest`, `UpdateRoleRequest`, `PermissionDto`, `RolePermissionDto`, `PermissionMatrixDto`, `SessionDto`, `LoginLogDto`, `SecurityEventDto`, `AuthAuditLogDto`.

---

## 21. Kết luận

API-02 hoàn thiện thiết kế API cho module AUTH theo MVP v1.0, bao gồm:

1. Authentication bằng access token + refresh token.
2. Quản lý session có thể revoke.
3. Quên mật khẩu/reset mật khẩu an toàn.
4. Đổi mật khẩu cá nhân.
5. Lấy thông tin user hiện tại.
6. Lấy role/permission/menu theo user.
7. Quản lý user.
8. Khóa/mở khóa user.
9. Gán role cho user.
10. Quản lý role.
11. Gán permission cho role kèm data scope.
12. Xem permission catalog.
13. Xem login log/security/audit log.
14. Chuẩn hóa error code, status code, audit log, notification event và test case.

Bước tiếp theo nên triển khai:

```text
API-03: HR API Design
```

Trong API-03 cần đặc biệt bám theo AUTH để mọi API HR đều có:

```text
Required permission
Allowed roles
Data scope
Business validation
Audit log
Notification event nếu có
```
