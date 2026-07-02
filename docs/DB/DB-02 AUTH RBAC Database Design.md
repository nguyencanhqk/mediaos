> 🔒 **BẤT BIẾN DB (bổ sung bắt buộc):** Mọi bảng có `company_id` PHẢI bật **RLS + FORCE**; `audit_logs` **append-only** (REVOKE UPDATE/DELETE + trigger); audit/event ghi qua **outbox** trong cùng transaction nghiệp vụ. Bộ docs gốc CHƯA mô tả 3 cơ chế này — DDL mẫu + `withTenant`/`set_config` tại [DECISIONS-02 §2–3](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md).

# DB-02: AUTH & RBAC DATABASE DESIGN

> **📚 Bộ tài liệu DB — Hệ thống Quản lý Doanh nghiệp**
> [DB-01 Tổng quan](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) · **DB-02 AUTH/RBAC** · [DB-03 HR](<DB-03_HR Database Design.md>) · [DB-04 ATT](<DB-04_ATT Database Design.md>) · [DB-05 LEAVE](<DB-05 LEAVE Database Design.md>) · [DB-06 TASK](<DB-06 TASK Database Design.md>) · [DB-07 NOTI/DASH](<DB-07 NOTI DASH Database Design.md>) · [DB-08 Audit/Files/Settings](<DB-08 Audit Files Settings Seeds Database Design.md>) · [DB-09 Index/Hiệu năng](<DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 Migration/Seed](<DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>)
>
> **Nguồn & liên quan:** [PRD-00 §9.1](<../PRD/PRD-00 Enterprise Management System .md>) · SPEC tương ứng: [SPEC-02 AUTH](<../SPEC/SPEC-02 AUTH.md>) · [SPEC-01 Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) · [Thiết kế API: API-02 AUTH](<../API Design/API-02 AUTH API Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DB-02 |
| Tên tài liệu | AUTH & RBAC Database Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Module | AUTH |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 → SPEC-08, DB-01 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả thiết kế database chi tiết cho module **AUTH & RBAC** của hệ thống quản lý doanh nghiệp nội bộ.

Module AUTH là nền tảng xác thực, phân quyền và kiểm soát phạm vi dữ liệu cho toàn bộ hệ thống. Tất cả module MVP như HR, ATT, LEAVE, TASK, DASH và NOTI đều cần dựa vào AUTH để xác định:

1. Người dùng đang đăng nhập là ai.
2. Người dùng thuộc công ty/tenant nào.
3. Người dùng có những role nào.
4. Role đó có những permission nào.
5. Permission đó được áp dụng trong phạm vi dữ liệu nào.
6. Người dùng có được truy cập màn hình/API/chức năng/dữ liệu hay không.
7. Các thao tác quan trọng cần ghi audit log như thế nào.

Tài liệu DB-02 là cơ sở để backend triển khai migration, model/entity, repository, seed data, middleware authentication và service authorization.

---

## 3. Phạm vi thiết kế

### 3.1 Bao gồm trong DB-02

DB-02 bao gồm các nhóm bảng sau:

| Nhóm | Bảng | Vai trò |
| --- | --- | --- |
| Account | `users` | Tài khoản đăng nhập |
| Session | `user_sessions` | Phiên đăng nhập/refresh token |
| Password | `password_reset_tokens` | Token quên mật khẩu/đặt lại mật khẩu |
| RBAC | `roles` | Vai trò người dùng |
| RBAC | `permissions` | Danh mục quyền toàn hệ thống |
| RBAC | `user_roles` | Gán role cho user |
| RBAC | `role_permissions` | Gán permission cho role kèm data scope |
| Logging | `login_logs` | Nhật ký đăng nhập |
| Security | `user_security_events` | Nhật ký sự kiện bảo mật tài khoản |
| Extension | `user_auth_providers` | Chuẩn bị cho OAuth/SSO phase sau |
| Extension | `user_mfa_methods` | Chuẩn bị cho 2FA phase sau |

### 3.2 Liên kết với bảng ngoài DB-02

DB-02 có quan hệ trực tiếp hoặc gián tiếp với các bảng nền tảng và module khác:

| Bảng ngoài | Module | Quan hệ với AUTH |
| --- | --- | --- |
| `companies` | Foundation | Mỗi user/role company-specific thuộc một công ty |
| `employees` | HR | Employee liên kết với User qua `employees.user_id` |
| `audit_logs` | Foundation | Ghi log thao tác quan trọng của AUTH/RBAC |
| `files` | Foundation | Avatar user có thể trỏ đến file |
| `modules` | Foundation | Permission gắn với module code |
| `notifications` | NOTI | Thông báo gửi theo `user_id` |
| `dashboard_widget_configs` | DASH | Widget có thể cấu hình theo role/user |

### 3.3 Chưa triển khai sâu trong MVP nhưng chừa thiết kế

Các phần sau chỉ thiết kế cột/bảng mở rộng, chưa bắt buộc hoàn thiện trong MVP:

1. OAuth/SSO Google Workspace.
2. OAuth/SSO Microsoft 365.
3. 2FA/MFA.
4. Quản lý thiết bị đăng nhập nâng cao.
5. IP allowlist/blocklist.
6. Policy mật khẩu nâng cao theo company.
7. Role hierarchy phức tạp.
8. User permission override riêng lẻ.
9. API client/service account cho integration.

---

## 4. Nguyên tắc thiết kế AUTH/RBAC

### 4.1 PostgreSQL làm database chính

Thiết kế sử dụng PostgreSQL vì hệ thống cần transaction, foreign key, unique constraint, JSONB cho điều kiện mở rộng và khả năng query dữ liệu quan hệ giữa user, role, permission, company và employee.

### 4.2 UUID làm primary key

Tất cả bảng trong DB-02 dùng:

```sql
id UUID PRIMARY KEY
```

Khuyến nghị dùng `gen_random_uuid()` từ extension `pgcrypto`.

### 4.3 Multi-tenant bằng `company_id`

Các bảng có dữ liệu thuộc phạm vi công ty cần có `company_id`:

```text
users
roles
user_roles
role_permissions
user_sessions
password_reset_tokens
login_logs
user_security_events
```

Riêng `permissions` là danh mục quyền toàn hệ thống nên mặc định không có `company_id`. Nếu sau này cần permission riêng theo tenant, có thể mở rộng bằng bảng `company_permissions` hoặc thêm `company_id` nullable.

### 4.4 Role có thể global hoặc company-specific

`roles.company_id` cho phép nullable:

| Trường hợp | `company_id` | Ví dụ |
| --- | --- | --- |
| Role toàn hệ thống | NULL | SUPER_ADMIN |
| Role theo công ty | Có giá trị | COMPANY_ADMIN, HR, MANAGER, EMPLOYEE |

Trong MVP, vẫn có thể seed role mặc định cho từng company để dễ quản trị.

### 4.5 Một user có thể có nhiều role

User nhận quyền qua bảng `user_roles`. Ví dụ một user có thể vừa là `EMPLOYEE`, vừa là `MANAGER`, hoặc vừa là `HR` vừa là `PAYROLL_OFFICER` ở phase sau.

### 4.6 Permission là đơn vị quyền nhỏ nhất

> **CHỐT 2026-07-02: code thắng** — permission KHÔNG lưu chuỗi `MODULE.RESOURCE.ACTION` làm khóa; engine khớp/deny theo CẶP `(action, resource_type)` với `uniqueIndex('permissions_action_resource_uq', [action, resource_type])` (apps/api/src/db/schema/permissions.ts:39-47). Chuỗi `MODULE.RESOURCE.ACTION` chỉ còn là quy ước ĐẶT TÊN hiển thị (CLAUDE.md §5). Lý do: seed catalog + khớp quyền theo cặp engine, đồng bộ backend↔DB không lệ thuộc chuỗi.

Permission dùng format:

```text
MODULE.RESOURCE.ACTION
```

Ví dụ:

```text
AUTH.USER.VIEW
HR.EMPLOYEE.UPDATE
ATT.ATTENDANCE.VIEW_TEAM
LEAVE.REQUEST.APPROVE
TASK.TASK.UPDATE_STATUS
DASH.WIDGET.VIEW_MY_TASKS
NOTI.NOTIFICATION.READ
```

### 4.7 Data scope nằm ở `role_permissions`

> **CHỐT 2026-07-02: code thắng** — `data_scope` canonical = `Own/Team/Department/Company/System` (5 bậc). `ROLE_DATA_SCOPES` (apps/api/src/db/schema/permissions.ts:153) khớp contracts `DATA_SCOPES` (packages/contracts/src/auth.ts:95), CHECK ở mig 0441. Giá trị `Project` ở bảng dưới ĐÃ BỎ CÓ CHỦ Ý trong code. Lý do: TASK định phạm vi dự án qua project-membership, không nhồi thành một bậc trong thang data_scope tuyến-tính.
>
> **OWNER-DECISION (data_scope 'Project') — ĐÃ CHỐT 2026-07-02 (Cian, Product Owner):**
> - **GIỮ 5 bậc** `Own/Team/Department/Company/System`. TASK định phạm vi dự án qua **project-membership** (bảng `project_members`, check ở service layer của TASK) — KHÔNG thêm bậc `data_scope = 'Project'`.
> - Lý do: Project là quan hệ THÀNH VIÊN (một dự án có thể xuyên phòng ban), không xếp được vào trục phân cấp tuyến tính System > Company > Department > Team > Own của `resolveStrongestScope`; thêm bậc engine-level cho giá trị chưa module nào dùng là speculative (YAGNI).
> - Nếu Sprint TASK phát hiện thật sự cần scope engine-level: thêm lại `'Project'` vào `ROLE_DATA_SCOPES` + CHECK (migration mới) + contracts `DATA_SCOPES` + `DataScopeResolver` — additive, không phá gì; phải kèm thiết kế semantics riêng (membership-based, KHÔNG so sánh "mạnh nhất" với các bậc org).

Data scope quyết định phạm vi dữ liệu mà permission được áp dụng:

| Scope | Ý nghĩa |
| --- | --- |
| Own | Chỉ dữ liệu của chính user/employee |
| Team | Dữ liệu nhân viên thuộc team/quản lý trực tiếp |
| Department | Dữ liệu thuộc phòng ban |
| Project | Dữ liệu thuộc dự án, chủ yếu cho TASK |
| Company | Dữ liệu toàn công ty |
| System | Dữ liệu toàn hệ thống |

Ví dụ:

```text
Role EMPLOYEE có HR.EMPLOYEE.VIEW với scope Own.
Role MANAGER có HR.EMPLOYEE.VIEW với scope Team.
Role HR có HR.EMPLOYEE.VIEW với scope Company.
Role SUPER_ADMIN có HR.EMPLOYEE.VIEW với scope System.
```

### 4.8 Backend luôn kiểm tra quyền

Frontend có thể ẩn menu/button, nhưng backend vẫn phải kiểm tra:

1. User có đăng nhập hợp lệ không.
2. Session/token còn hiệu lực không.
3. User có permission cần thiết không.
4. Permission có data scope phù hợp không.
5. Dữ liệu target có thuộc scope được phép không.
6. User/status/company/module có đang active không.

### 4.9 Soft delete dữ liệu quan trọng

Không xóa cứng các bảng quan trọng:

```text
users
roles
user_roles
role_permissions
user_sessions
password_reset_tokens
login_logs
```

Dữ liệu nên dùng `deleted_at`, `deleted_by` hoặc trạng thái `revoked_at`, `expired_at` tùy nghiệp vụ.

### 4.10 Audit log cho thao tác nhạy cảm

Các thao tác sau bắt buộc ghi `audit_logs`:

1. Tạo/sửa/khóa/mở khóa user.
2. Gán/gỡ role của user.
3. Tạo/sửa/vô hiệu hóa role.
4. Gán/gỡ permission của role.
5. Đổi mật khẩu.
6. Reset mật khẩu.
7. Đăng nhập thất bại nhiều lần.
8. Đăng xuất/thu hồi session nếu backend quản lý session.
9. Export danh sách user hoặc role.
10. Truy cập hoặc thay đổi dữ liệu nhạy cảm.

---

## 5. ERD cấp module AUTH/RBAC

### 5.1 ERD dạng text

```text
companies
  1 ─── n users
  1 ─── n roles
  1 ─── n user_roles
  1 ─── n login_logs

users
  1 ─── n user_sessions
  1 ─── n password_reset_tokens
  1 ─── n user_roles
  1 ─── n login_logs
  1 ─── n user_security_events
  1 ─── 0..1 employees  (qua employees.user_id)

roles
  1 ─── n user_roles
  1 ─── n role_permissions

permissions
  1 ─── n role_permissions

users.created_by / updated_by / deleted_by
  ─── references users.id

roles.created_by / updated_by / deleted_by
  ─── references users.id
```

### 5.2 Quan hệ chính

| Quan hệ | Loại | Ghi chú |
| --- | --- | --- |
| `companies.id` → `users.company_id` | 1-n | User thuộc một công ty |
| `users.id` → `user_roles.user_id` | 1-n | User có nhiều role |
| `roles.id` → `user_roles.role_id` | 1-n | Role được gán cho nhiều user |
| `roles.id` → `role_permissions.role_id` | 1-n | Role có nhiều permission |
| `permissions.id` → `role_permissions.permission_id` | 1-n | Permission được gán cho nhiều role |
| `users.id` → `user_sessions.user_id` | 1-n | User có nhiều phiên đăng nhập |
| `users.id` → `password_reset_tokens.user_id` | 1-n | User có thể có nhiều token reset theo thời gian |
| `users.id` → `login_logs.user_id` | 1-n | User có nhiều log đăng nhập |
| `users.id` → `employees.user_id` | 1-0..1 | Một user liên kết tối đa một employee trong MVP |

---

## 6. Danh sách bảng DB-02

| STT | Bảng | Bắt buộc MVP | Mô tả |
| --- | --- | --- | --- |
| 1 | `users` | Có | Tài khoản đăng nhập |
| 2 | `roles` | Có | Vai trò hệ thống/công ty |
| 3 | `permissions` | Có | Danh mục quyền |
| 4 | `user_roles` | Có | Gán role cho user |
| 5 | `role_permissions` | Có | Gán permission + data scope cho role |
| 6 | `user_sessions` | Có | Phiên đăng nhập/refresh token |
| 7 | `password_reset_tokens` | Có | Token đặt lại mật khẩu |
| 8 | `login_logs` | Có | Log đăng nhập thành công/thất bại |
| 9 | `user_security_events` | Nên có | Log sự kiện bảo mật tài khoản |
| 10 | `user_auth_providers` | Phase sau | OAuth/SSO external provider |
| 11 | `user_mfa_methods` | Phase sau | 2FA/MFA |

---

## 7. Thiết kế chi tiết bảng

### 7.1 Bảng `users`

#### Mục đích

Lưu tài khoản đăng nhập vào hệ thống.

Một user có thể:

1. Đăng nhập bằng email/password.
2. Có trạng thái tài khoản.
3. Có nhiều role.
4. Có nhiều session.
5. Có thể liên kết với employee trong HR.
6. Có thể bị khóa/mở khóa.
7. Có lịch sử đăng nhập và thao tác bảo mật.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có trong MVP | FK `companies.id`; nếu SaaS system user có thể nullable ở phase sau |
| `email` | VARCHAR(255) | Có | Email đăng nhập, unique theo company |
| `normalized_email` | VARCHAR(255) | Có | Email lowercase để unique/search |
| `password_hash` | VARCHAR(255) | Có nếu login password | Hash mật khẩu, không lưu plain text |
| `display_name` | VARCHAR(255) | Có | Tên hiển thị |
| `avatar_file_id` | UUID | Không | FK `files.id` |
| `status` | VARCHAR(50) | Có | Pending Activation/Active/Suspended/Inactive/Locked/Deleted (PascalCase — xem ghi chú AU-5) |
| `email_verified_at` | TIMESTAMP | Không | Thời điểm xác thực email |
| `last_login_at` | TIMESTAMP | Không | Lần đăng nhập thành công gần nhất |
| `last_login_ip` | VARCHAR(45) | Không | IPv4/IPv6 |
| `password_changed_at` | TIMESTAMP | Không | Lần đổi mật khẩu gần nhất |
| `failed_login_count` | INT | Có | Số lần login fail liên tiếp |
| `locked_at` | TIMESTAMP | Không | Thời điểm khóa tài khoản |
| `locked_reason` | TEXT | Không | Lý do khóa |
| `must_change_password` | BOOLEAN | Có | Bắt buộc đổi mật khẩu lần tới |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint đề xuất

```sql
ALTER TABLE users
ADD CONSTRAINT chk_users_status
CHECK (status IN ('Pending Activation', 'Active', 'Suspended', 'Inactive', 'Locked', 'Deleted')); -- sửa theo DRIFT AU-5: thêm 'Suspended' (PascalCase); code legacy lưu lowercase 'suspended' = cùng trạng thái

CREATE UNIQUE INDEX uq_users_company_email_active
ON users (company_id, normalized_email)
WHERE deleted_at IS NULL;
```

#### Index đề xuất

| Index | Cột | Mục đích |
| --- | --- | --- |
| `idx_users_company_status` | `(company_id, status)` | Lọc danh sách user theo công ty/trạng thái |
| `idx_users_normalized_email` | `(normalized_email)` | Tìm user khi login |
| `idx_users_created_at` | `(created_at)` | Sắp xếp danh sách user |
| `idx_users_last_login_at` | `(last_login_at)` | Báo cáo user active |

#### Ghi chú nghiệp vụ

1. Email nên được normalize lowercase trước khi lưu.
2. `password_hash` dùng bcrypt/argon2, không dùng MD5/SHA thường.
3. Khi tài khoản ở trạng thái `Locked`, `Suspended`, `Inactive`, `Deleted`, backend không cho login (xem AU-5). `Suspended` lưu lowercase `suspended` ở nhánh code legacy = cùng trạng thái.
4. Khi HR tạo employee và chọn tạo tài khoản, backend tạo user, gán role `EMPLOYEE`, sau đó HR liên kết qua `employees.user_id`.
5. Không lưu `employee_id` trong `users` để tránh vòng phụ thuộc giữa AUTH và HR. Quan hệ chính nằm ở `employees.user_id`.

---

### 7.2 Bảng `roles`

> **CHỐT 2026-07-02: code thắng** — bảng `roles` KHÔNG có cột `role_code` (cũng không `role_type`/`status`/`is_default`/`metadata`); định danh role = cột `name` (name ĐÓNG VAI code, ví dụ `company-admin`, `super-admin`) + cờ `is_system` + `requires_two_factor` + soft-delete `deleted_at`, UNIQUE partial trên `name` khi `deleted_at IS NULL` (apps/api/src/db/schema/permissions.ts:11-30, mig 0005). Các cột `role_code`/`role_type` ở bảng "Role mặc định MVP" bên dưới không tồn tại. Lý do: đơn-định-danh (`name`) giảm drift seed↔code.

#### Mục đích

Lưu vai trò của hệ thống hoặc của từng công ty.

Role là nhóm quyền. User nhận permission thông qua role.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Không | NULL nếu role global/system |
| `role_code` | VARCHAR(100) | Có | SUPER_ADMIN, COMPANY_ADMIN, HR, MANAGER, EMPLOYEE |
| `name` | VARCHAR(255) | Có | Tên hiển thị |
| `description` | TEXT | Không | Mô tả |
| `role_type` | VARCHAR(50) | Có | System/Company/Project/Future |
| `is_system_role` | BOOLEAN | Có | Role hệ thống không cho xóa/sửa code |
| `is_default` | BOOLEAN | Có | Role mặc định khi tạo user/employee |
| `status` | VARCHAR(50) | Có | Active/Inactive |
| `metadata` | JSONB | Không | Cấu hình mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint đề xuất

```sql
ALTER TABLE roles
ADD CONSTRAINT chk_roles_status
CHECK (status IN ('Active', 'Inactive'));

ALTER TABLE roles
ADD CONSTRAINT chk_roles_type
CHECK (role_type IN ('System', 'Company', 'Project', 'Future'));

CREATE UNIQUE INDEX uq_roles_company_code_active
ON roles (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), role_code)
WHERE deleted_at IS NULL;
```

#### Role mặc định MVP

| `role_code` | `name` | `role_type` | Scope mặc định | Ghi chú |
| --- | --- | --- | --- | --- |
| `SUPER_ADMIN` | Super Admin | System | System | Toàn quyền hệ thống |
| `COMPANY_ADMIN` | Admin công ty | Company | Company | Quản trị user/role trong công ty |
| `HR` | HR | Company | Company | Quản lý nhân sự, chấm công, nghỉ phép theo quyền |
| `MANAGER` | Manager | Company | Team | Quản lý team trực tiếp |
| `EMPLOYEE` | Employee | Company | Own | Người dùng hằng ngày |
| `PROJECT_MANAGER` | Project Manager | Company | Project | Vai trò nghiệp vụ cho TASK, có thể kết hợp project_members |
| `PAYROLL_OFFICER` | Payroll Officer | Future | Company | Chuẩn bị phase sau |
| `RECRUITER` | Recruiter | Future | Company | Chuẩn bị phase sau |
| `ASSET_MANAGER` | Asset Manager | Future | Company | Chuẩn bị phase sau |
| `OFFICE_ADMIN` | Office Admin | Future | Company | Chuẩn bị phase sau |

---

### 7.3 Bảng `permissions`

> **CHỐT 2026-07-02: code thắng** — `permissions` chỉ có `id` + `action` + `resource_type` + `is_sensitive`; KHÔNG có `permission_code`/`module_code`/`resource`/`is_active`/`sort_order`. UNIQUE = cặp `uniqueIndex('permissions_action_resource_uq', [action, resource_type])` (apps/api/src/db/schema/permissions.ts:39-47), KHÔNG UNIQUE trên `permission_code`. Catalog global (không `company_id`, không RLS); app role chỉ SELECT. Lý do: cặp `(action, resource_type)` là khóa nghiệp vụ engine dùng để khớp quyền.

#### Mục đích

Lưu danh mục quyền toàn hệ thống.

Permission không nên bị xóa cứng vì nhiều role đang tham chiếu. Khi không dùng nữa, đặt `is_active = false`.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `module_code` | VARCHAR(50) | Có | AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI/PAYROLL... |
| `permission_code` | VARCHAR(150) | Có | Mã quyền duy nhất |
| `resource` | VARCHAR(100) | Có | USER/ROLE/PERMISSION/EMPLOYEE... |
| `action` | VARCHAR(100) | Có | VIEW/CREATE/UPDATE/DELETE/APPROVE... |
| `description` | TEXT | Không | Mô tả quyền |
| `is_sensitive` | BOOLEAN | Có | Quyền truy cập dữ liệu nhạy cảm |
| `is_system_permission` | BOOLEAN | Có | Quyền seed hệ thống |
| `is_active` | BOOLEAN | Có | Bật/tắt quyền |
| `sort_order` | INT | Không | Thứ tự hiển thị |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |

#### Constraint đề xuất

```sql
CREATE UNIQUE INDEX uq_permissions_code
ON permissions (permission_code);

CREATE INDEX idx_permissions_module
ON permissions (module_code);

CREATE INDEX idx_permissions_resource_action
ON permissions (resource, action);
```

#### Ghi chú nghiệp vụ

1. Permission nên được seed từ code/migration để đồng bộ giữa backend và database.
2. Admin công ty có thể xem danh sách permission nhưng không nên tự tạo permission tùy ý trong MVP.
3. Chỉ Super Admin hoặc migration hệ thống được thêm permission mới.
4. Permission về payroll/lương phải tách riêng, không mặc định cấp cho HR nếu chưa được doanh nghiệp cho phép.

---

### 7.4 Bảng `user_roles`

#### Mục đích

Gán một hoặc nhiều role cho user.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `user_id` | UUID | Có | FK `users.id` |
| `role_id` | UUID | Có | FK `roles.id` |
| `assigned_by` | UUID | Không | FK `users.id` |
| `assigned_at` | TIMESTAMP | Có | Thời điểm gán |
| `expired_at` | TIMESTAMP | Không | Hết hạn role nếu có |
| `is_active` | BOOLEAN | Có | Còn hiệu lực không |
| `note` | TEXT | Không | Ghi chú |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `deleted_at` | TIMESTAMP | Không | Soft delete/gỡ role |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint đề xuất

```sql
CREATE UNIQUE INDEX uq_user_roles_active
ON user_roles (user_id, role_id)
WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX idx_user_roles_user_active
ON user_roles (user_id, is_active, expired_at);

CREATE INDEX idx_user_roles_company_role
ON user_roles (company_id, role_id);
```

#### Ghi chú nghiệp vụ

1. Khi gỡ role, có thể set `is_active = false`, `deleted_at`, `deleted_by` thay vì xóa cứng.
2. Nếu `expired_at < now()`, role không còn hiệu lực.
3. Khi user có nhiều role, quyền cuối cùng là hợp nhất các permission active từ tất cả role active.
4. Nếu cùng permission nhưng nhiều data scope, backend lấy scope mạnh nhất theo thứ tự: System > Company > Department > Team/Project > Own.

---

### 7.5 Bảng `role_permissions`

> **CHỐT 2026-07-02: code thắng** — `role_permissions` = `(role_id, permission_id, effect, data_scope)`. THÊM cột `effect` IN ('ALLOW','DENY') (`PERMISSION_EFFECTS`) — ALLOW+DENY cùng cặp co-exist, deny-overrides ở app layer; `data_scope` NOT NULL DEFAULT 'Company' PER-grant (`ROLE_DATA_SCOPES` = Own/Team/Department/Company/System, không Project). UNIQUE = `(role_id, permission_id, effect)` (KHÔNG gồm data_scope); KHÔNG có `is_active`/`conditions`/soft-delete → đổi effect/scope = DELETE+INSERT (không có grant UPDATE) (apps/api/src/db/schema/permissions.ts:62-76, mig 0005/0441). Lý do: grant append-only + deny-override cần `effect` tách bạch.

#### Mục đích

Gán permission cho role, đồng thời xác định data scope của permission đó.

Đây là bảng quan trọng nhất của RBAC vì nó quyết định role được làm gì và làm trong phạm vi dữ liệu nào.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Không | Company-specific nếu cần |
| `role_id` | UUID | Có | FK `roles.id` |
| `permission_id` | UUID | Có | FK `permissions.id` |
| `data_scope` | VARCHAR(50) | Có | Own/Team/Department/Project/Company/System |
| `conditions` | JSONB | Không | Điều kiện mở rộng |
| `is_active` | BOOLEAN | Có | Bật/tắt gán quyền |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint đề xuất

```sql
ALTER TABLE role_permissions
ADD CONSTRAINT chk_role_permissions_data_scope
CHECK (data_scope IN ('Own', 'Team', 'Department', 'Project', 'Company', 'System'));

CREATE UNIQUE INDEX uq_role_permissions_active
ON role_permissions (role_id, permission_id, data_scope)
WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX idx_role_permissions_role
ON role_permissions (role_id, is_active);

CREATE INDEX idx_role_permissions_permission
ON role_permissions (permission_id, data_scope);
```

#### Ví dụ `conditions`

```json
{
  "department_ids": ["uuid-1", "uuid-2"],
  "allow_export": false,
  "only_active_employee": true,
  "project_role_required": ["Owner", "Manager"]
}
```

MVP có thể chưa dùng `conditions`, nhưng để sẵn JSONB để mở rộng.

---

### 7.6 Bảng `user_sessions`

#### Mục đích

Lưu phiên đăng nhập hoặc refresh token nếu backend quản lý session/token server-side.

MVP khuyến nghị lưu refresh token dạng hash để có thể revoke session khi logout, đổi mật khẩu hoặc khóa tài khoản.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `user_id` | UUID | Có | FK `users.id` |
| `refresh_token_hash` | VARCHAR(255) | Có | Hash refresh token |
| `access_token_jti` | VARCHAR(255) | Không | JWT ID nếu dùng JWT |
| `ip_address` | VARCHAR(45) | Không | IPv4/IPv6 |
| `user_agent` | TEXT | Không | Browser/device |
| `device_id` | VARCHAR(255) | Không | ID thiết bị nếu có |
| `device_name` | VARCHAR(255) | Không | Tên thiết bị hiển thị |
| `platform` | VARCHAR(50) | Không | WEB/MOBILE/API |
| `last_used_at` | TIMESTAMP | Không | Lần dùng gần nhất |
| `expired_at` | TIMESTAMP | Có | Hết hạn |
| `revoked_at` | TIMESTAMP | Không | Thu hồi session |
| `revoked_by` | UUID | Không | FK `users.id` |
| `revoked_reason` | TEXT | Không | Lý do revoke |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |

#### Constraint/index đề xuất

```sql
CREATE INDEX idx_user_sessions_user_active
ON user_sessions (user_id, expired_at, revoked_at);

CREATE INDEX idx_user_sessions_token_hash
ON user_sessions (refresh_token_hash);

CREATE INDEX idx_user_sessions_company_created
ON user_sessions (company_id, created_at DESC);
```

#### Quy tắc session

1. Khi logout: set `revoked_at = now()`.
2. Khi đổi mật khẩu: revoke toàn bộ session cũ, trừ session hiện tại nếu cấu hình cho phép.
3. Khi khóa user: revoke toàn bộ session active.
4. Không lưu refresh token plain text.
5. Access token ngắn hạn, refresh token dài hơn nhưng có thể revoke.

---

### 7.7 Bảng `password_reset_tokens`

> **CHỐT 2026-07-02: code thắng** — `password_reset_tokens` KHÔNG có cột `purpose` (cũng không `sent_to_email`/`revoked_at`/`request_ip`): chỉ `id`/`company_id`/`user_id`/`token_hash`/`expires_at`/`used_at`/`created_at`, single-use + hash-at-rest (apps/api/src/db/schema/auth.ts:54-75, mig 0004). Luồng mời/kích-hoạt tài khoản KHÔNG dùng reset-token đa-purpose mà tách sang bảng RIÊNG `user_invites` (per-tenant `company_id` DEFAULT current_setting + FORCE-RLS; status pending→accepted→approved/rejected; mig 0410; apps/api/src/db/schema/user-invites.ts). Lý do: vòng đời invite (email/full_name/password đặt-ở-accept) khác reset → tách bảng để RLS + audit rạch ròi.

#### Mục đích

Lưu token đặt lại mật khẩu khi user dùng chức năng quên mật khẩu hoặc kích hoạt tài khoản ban đầu.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `user_id` | UUID | Có | FK `users.id` |
| `token_hash` | VARCHAR(255) | Có | Hash token reset |
| `purpose` | VARCHAR(50) | Có | ResetPassword/ActivateAccount/Invite |
| `sent_to_email` | VARCHAR(255) | Có | Email nhận link |
| `expired_at` | TIMESTAMP | Có | Thời điểm hết hạn |
| `used_at` | TIMESTAMP | Không | Thời điểm token được dùng |
| `revoked_at` | TIMESTAMP | Không | Thu hồi token |
| `request_ip` | VARCHAR(45) | Không | IP yêu cầu reset |
| `user_agent` | TEXT | Không | User agent |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |

#### Constraint/index đề xuất

```sql
ALTER TABLE password_reset_tokens
ADD CONSTRAINT chk_password_reset_purpose
CHECK (purpose IN ('ResetPassword', 'ActivateAccount', 'Invite'));

CREATE UNIQUE INDEX uq_password_reset_token_hash
ON password_reset_tokens (token_hash);

CREATE INDEX idx_password_reset_user_active
ON password_reset_tokens (user_id, expired_at, used_at, revoked_at);
```

#### Quy tắc bảo mật

1. Token chỉ dùng một lần.
2. Token hết hạn không được dùng.
3. Token đã `used_at` hoặc `revoked_at` không được dùng lại.
4. Khi tạo token mới cùng purpose, có thể revoke token cũ chưa dùng.
5. API quên mật khẩu không nên tiết lộ email có tồn tại hay không.

---

### 7.8 Bảng `login_logs`

#### Mục đích

Ghi nhận lịch sử đăng nhập thành công/thất bại.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Không | Có thể NULL nếu không xác định được company |
| `user_id` | UUID | Không | FK `users.id`, null nếu email không tồn tại |
| `email` | VARCHAR(255) | Có | Email người dùng nhập |
| `normalized_email` | VARCHAR(255) | Có | Email lowercase |
| `login_status` | VARCHAR(50) | Có | Success/Failed/Blocked |
| `failure_reason` | VARCHAR(100) | Không | WrongPassword/UserNotFound/Locked/Inactive... |
| `ip_address` | VARCHAR(45) | Không | IP đăng nhập |
| `user_agent` | TEXT | Không | Browser/device |
| `platform` | VARCHAR(50) | Không | WEB/MOBILE/API |
| `session_id` | UUID | Không | FK `user_sessions.id` nếu thành công |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm log |

#### Constraint/index đề xuất

```sql
ALTER TABLE login_logs
ADD CONSTRAINT chk_login_logs_status
CHECK (login_status IN ('Success', 'Failed', 'Blocked'));

CREATE INDEX idx_login_logs_user_created
ON login_logs (user_id, created_at DESC);

CREATE INDEX idx_login_logs_email_created
ON login_logs (normalized_email, created_at DESC);

CREATE INDEX idx_login_logs_company_created
ON login_logs (company_id, created_at DESC);

CREATE INDEX idx_login_logs_ip_created
ON login_logs (ip_address, created_at DESC);
```

#### Giá trị `failure_reason` đề xuất

| Mã | Ý nghĩa |
| --- | --- |
| `UserNotFound` | Email không tồn tại |
| `WrongPassword` | Sai mật khẩu |
| `PendingActivation` | Tài khoản chưa kích hoạt |
| `Inactive` | Tài khoản tạm ngưng |
| `Locked` | Tài khoản bị khóa |
| `Deleted` | Tài khoản đã xóa mềm |
| `TooManyAttempts` | Quá số lần đăng nhập sai |
| `CompanyInactive` | Công ty/tenant không hoạt động |

---

### 7.9 Bảng `user_security_events`

#### Mục đích

Lưu các sự kiện bảo mật liên quan đến user.

Bảng này bổ sung cho `login_logs` và `audit_logs`, dùng để hiển thị timeline bảo mật tài khoản hoặc phục vụ điều tra.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `user_id` | UUID | Có | FK `users.id` |
| `event_type` | VARCHAR(100) | Có | PASSWORD_CHANGED, USER_LOCKED... |
| `actor_user_id` | UUID | Không | User thực hiện, null nếu hệ thống |
| `ip_address` | VARCHAR(45) | Không | IP |
| `user_agent` | TEXT | Không | User agent |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm event |

#### Event type đề xuất

| Event | Mô tả |
| --- | --- |
| `PASSWORD_CHANGED` | User tự đổi mật khẩu |
| `PASSWORD_RESET_REQUESTED` | User yêu cầu quên mật khẩu |
| `PASSWORD_RESET_COMPLETED` | Đặt lại mật khẩu thành công |
| `ACCOUNT_ACTIVATED` | Tài khoản được kích hoạt |
| `USER_LOCKED` | User bị khóa |
| `USER_UNLOCKED` | User được mở khóa |
| `ROLE_ASSIGNED` | User được gán role |
| `ROLE_REMOVED` | User bị gỡ role |
| `SESSION_REVOKED` | Phiên đăng nhập bị thu hồi |
| `MULTIPLE_LOGIN_FAILED` | Nhiều lần đăng nhập thất bại |

---

### 7.10 Bảng `user_auth_providers` - phase sau

#### Mục đích

Chuẩn bị cho OAuth/SSO Google/Microsoft.

#### Cấu trúc cột đề xuất

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `user_id` | UUID | Có | FK `users.id` |
| `provider` | VARCHAR(50) | Có | GOOGLE/MICROSOFT/SSO |
| `provider_user_id` | VARCHAR(255) | Có | ID user từ provider |
| `provider_email` | VARCHAR(255) | Không | Email từ provider |
| `metadata` | JSONB | Không | Payload mở rộng |
| `linked_at` | TIMESTAMP | Có | Thời điểm liên kết |
| `last_login_at` | TIMESTAMP | Không | Lần login gần nhất |
| `created_at` | TIMESTAMP | Có |  |
| `deleted_at` | TIMESTAMP | Không | Soft delete |

#### Constraint đề xuất

```sql
CREATE UNIQUE INDEX uq_user_auth_provider_identity
ON user_auth_providers (provider, provider_user_id)
WHERE deleted_at IS NULL;
```

---

### 7.11 Bảng `user_mfa_methods` - phase sau

> **CHỐT 2026-07-02: code thắng** — 2FA KHÔNG phải "phase sau" và KHÔNG dùng bảng gộp `user_mfa_methods`; đã LIVE (mig 0120) bằng HAI bảng: `user_totp` (1 dòng/user, secret TOTP RFC-6238 **envelope-encrypted** 7 cột — BẤT BIẾN #3, KHÔNG plaintext; `enabled_at` NULL = đã enroll nhưng CHƯA xác nhận) + `user_recovery_codes` (mã 1-lần, chỉ lưu HASH SHA-256, `used_at` khi tiêu thụ). Cả hai FORCE-RLS theo `company_id` (apps/api/src/db/schema/two-factor.ts; export ở schema/index.ts:47). MVP chỉ TOTP → không cần cột `method_type` đa-method. Lý do: tách secret-envelope khỏi recovery-hash, giữ BẤT BIẾN #3.

#### Mục đích

Chuẩn bị cho xác thực hai lớp.

#### Cấu trúc cột đề xuất

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `user_id` | UUID | Có | FK `users.id` |
| `method_type` | VARCHAR(50) | Có | TOTP/SMS/EMAIL/WEBAUTHN |
| `secret_encrypted` | TEXT | Không | Secret đã mã hóa |
| `phone_masked` | VARCHAR(50) | Không | Nếu SMS |
| `email_masked` | VARCHAR(255) | Không | Nếu email OTP |
| `is_primary` | BOOLEAN | Có | Method chính |
| `is_enabled` | BOOLEAN | Có | Bật/tắt |
| `verified_at` | TIMESTAMP | Không | Đã xác thực setup |
| `last_used_at` | TIMESTAMP | Không | Lần dùng gần nhất |
| `created_at` | TIMESTAMP | Có |  |
| `deleted_at` | TIMESTAMP | Không | Soft delete |

---

## 8. SQL DDL đề xuất cho MVP

> DDL dưới đây là bản đề xuất ban đầu. Khi triển khai thực tế có thể tách thành nhiều migration theo thứ tự: `users` → `roles` → `permissions` → `user_roles` → `role_permissions` → `user_sessions` → `password_reset_tokens` → `login_logs` → `user_security_events`.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    email VARCHAR(255) NOT NULL,
    normalized_email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255),
    display_name VARCHAR(255) NOT NULL,
    avatar_file_id UUID NULL REFERENCES files(id),
    status VARCHAR(50) NOT NULL DEFAULT 'Pending Activation',
    email_verified_at TIMESTAMP NULL,
    last_login_at TIMESTAMP NULL,
    last_login_ip VARCHAR(45) NULL,
    password_changed_at TIMESTAMP NULL,
    failed_login_count INT NOT NULL DEFAULT 0,
    locked_at TIMESTAMP NULL,
    locked_reason TEXT NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID NULL REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID NULL REFERENCES users(id),
    deleted_at TIMESTAMP NULL,
    deleted_by UUID NULL REFERENCES users(id),
    CONSTRAINT chk_users_status CHECK (status IN ('Pending Activation', 'Active', 'Suspended', 'Inactive', 'Locked', 'Deleted')) -- sửa theo DRIFT AU-5: thêm 'Suspended'
);

CREATE UNIQUE INDEX uq_users_company_email_active
ON users (company_id, normalized_email)
WHERE deleted_at IS NULL;

CREATE INDEX idx_users_company_status
ON users (company_id, status);

CREATE INDEX idx_users_created_at
ON users (created_at DESC);

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NULL REFERENCES companies(id),
    role_code VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    role_type VARCHAR(50) NOT NULL DEFAULT 'Company',
    is_system_role BOOLEAN NOT NULL DEFAULT false,
    is_default BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    metadata JSONB NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID NULL REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID NULL REFERENCES users(id),
    deleted_at TIMESTAMP NULL,
    deleted_by UUID NULL REFERENCES users(id),
    CONSTRAINT chk_roles_status CHECK (status IN ('Active', 'Inactive')),
    CONSTRAINT chk_roles_type CHECK (role_type IN ('System', 'Company', 'Project', 'Future'))
);

CREATE UNIQUE INDEX uq_roles_company_code_active
ON roles (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), role_code)
WHERE deleted_at IS NULL;

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_code VARCHAR(50) NOT NULL,
    permission_code VARCHAR(150) NOT NULL,
    resource VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    description TEXT NULL,
    is_sensitive BOOLEAN NOT NULL DEFAULT false,
    is_system_permission BOOLEAN NOT NULL DEFAULT true,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_permissions_code
ON permissions (permission_code);

CREATE INDEX idx_permissions_module
ON permissions (module_code);

CREATE INDEX idx_permissions_resource_action
ON permissions (resource, action);

CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NOT NULL REFERENCES users(id),
    role_id UUID NOT NULL REFERENCES roles(id),
    assigned_by UUID NULL REFERENCES users(id),
    assigned_at TIMESTAMP NOT NULL DEFAULT now(),
    expired_at TIMESTAMP NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    note TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    deleted_at TIMESTAMP NULL,
    deleted_by UUID NULL REFERENCES users(id)
);

CREATE UNIQUE INDEX uq_user_roles_active
ON user_roles (user_id, role_id)
WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX idx_user_roles_user_active
ON user_roles (user_id, is_active, expired_at);

CREATE INDEX idx_user_roles_company_role
ON user_roles (company_id, role_id);

CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NULL REFERENCES companies(id),
    role_id UUID NOT NULL REFERENCES roles(id),
    permission_id UUID NOT NULL REFERENCES permissions(id),
    data_scope VARCHAR(50) NOT NULL,
    conditions JSONB NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID NULL REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID NULL REFERENCES users(id),
    deleted_at TIMESTAMP NULL,
    deleted_by UUID NULL REFERENCES users(id),
    CONSTRAINT chk_role_permissions_data_scope CHECK (data_scope IN ('Own', 'Team', 'Department', 'Project', 'Company', 'System'))
);

CREATE UNIQUE INDEX uq_role_permissions_active
ON role_permissions (role_id, permission_id, data_scope)
WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX idx_role_permissions_role
ON role_permissions (role_id, is_active);

CREATE INDEX idx_role_permissions_permission
ON role_permissions (permission_id, data_scope);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NOT NULL REFERENCES users(id),
    refresh_token_hash VARCHAR(255) NOT NULL,
    access_token_jti VARCHAR(255) NULL,
    ip_address VARCHAR(45) NULL,
    user_agent TEXT NULL,
    device_id VARCHAR(255) NULL,
    device_name VARCHAR(255) NULL,
    platform VARCHAR(50) NULL,
    last_used_at TIMESTAMP NULL,
    expired_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP NULL,
    revoked_by UUID NULL REFERENCES users(id),
    revoked_reason TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_sessions_user_active
ON user_sessions (user_id, expired_at, revoked_at);

CREATE INDEX idx_user_sessions_token_hash
ON user_sessions (refresh_token_hash);

CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NOT NULL REFERENCES users(id),
    token_hash VARCHAR(255) NOT NULL,
    purpose VARCHAR(50) NOT NULL,
    sent_to_email VARCHAR(255) NOT NULL,
    expired_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP NULL,
    revoked_at TIMESTAMP NULL,
    request_ip VARCHAR(45) NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_password_reset_purpose CHECK (purpose IN ('ResetPassword', 'ActivateAccount', 'Invite'))
);

CREATE UNIQUE INDEX uq_password_reset_token_hash
ON password_reset_tokens (token_hash);

CREATE INDEX idx_password_reset_user_active
ON password_reset_tokens (user_id, expired_at, used_at, revoked_at);

CREATE TABLE login_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NULL REFERENCES companies(id),
    user_id UUID NULL REFERENCES users(id),
    email VARCHAR(255) NOT NULL,
    normalized_email VARCHAR(255) NOT NULL,
    login_status VARCHAR(50) NOT NULL,
    failure_reason VARCHAR(100) NULL,
    ip_address VARCHAR(45) NULL,
    user_agent TEXT NULL,
    platform VARCHAR(50) NULL,
    session_id UUID NULL REFERENCES user_sessions(id),
    metadata JSONB NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_login_logs_status CHECK (login_status IN ('Success', 'Failed', 'Blocked'))
);

CREATE INDEX idx_login_logs_user_created
ON login_logs (user_id, created_at DESC);

CREATE INDEX idx_login_logs_email_created
ON login_logs (normalized_email, created_at DESC);

CREATE INDEX idx_login_logs_company_created
ON login_logs (company_id, created_at DESC);

CREATE INDEX idx_login_logs_ip_created
ON login_logs (ip_address, created_at DESC);

CREATE TABLE user_security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NOT NULL REFERENCES users(id),
    event_type VARCHAR(100) NOT NULL,
    actor_user_id UUID NULL REFERENCES users(id),
    ip_address VARCHAR(45) NULL,
    user_agent TEXT NULL,
    metadata JSONB NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_security_events_user_created
ON user_security_events (user_id, created_at DESC);

CREATE INDEX idx_user_security_events_company_created
ON user_security_events (company_id, created_at DESC);
```

---

## 9. Seed permission MVP

### 9.1 Nhóm AUTH

| Permission code | Resource | Action | Sensitive | Mô tả |
| --- | --- | --- | --- | --- |
| `AUTH.LOGIN.ACCESS` | LOGIN | ACCESS | No | Được phép đăng nhập |
| `AUTH.PROFILE.VIEW` | PROFILE | VIEW | No | Xem hồ sơ tài khoản cá nhân |
| `AUTH.PROFILE.UPDATE` | PROFILE | UPDATE | No | Cập nhật hồ sơ tài khoản cá nhân |
| `AUTH.PASSWORD.CHANGE` | PASSWORD | CHANGE | Yes | Đổi mật khẩu cá nhân |
| `AUTH.USER.VIEW` | USER | VIEW | Yes | Xem danh sách user |
| `AUTH.USER.CREATE` | USER | CREATE | Yes | Tạo user |
| `AUTH.USER.UPDATE` | USER | UPDATE | Yes | Cập nhật user |
| `AUTH.USER.LOCK` | USER | LOCK | Yes | Khóa user |
| `AUTH.USER.UNLOCK` | USER | UNLOCK | Yes | Mở khóa user |
| `AUTH.USER.DELETE` | USER | DELETE | Yes | Xóa mềm user (soft-delete; chỉ set `deleted_at`/`status`, KHÔNG hard-delete — BẤT BIẾN #2) |
| `AUTH.USER.ASSIGN_ROLE` | USER | ASSIGN_ROLE | Yes | Gán role cho user |
| `AUTH.ROLE.VIEW` | ROLE | VIEW | Yes | Xem danh sách role |
| `AUTH.ROLE.CREATE` | ROLE | CREATE | Yes | Tạo role |
| `AUTH.ROLE.UPDATE` | ROLE | UPDATE | Yes | Cập nhật role |
| `AUTH.ROLE.DELETE` | ROLE | DELETE | Yes | Xóa/vô hiệu hóa role |
| `AUTH.PERMISSION.VIEW` | PERMISSION | VIEW | Yes | Xem danh sách permission |
| `AUTH.PERMISSION.ASSIGN` | PERMISSION | ASSIGN | Yes | Gán permission cho role |
| `AUTH.AUDIT_LOG.VIEW` | AUDIT_LOG | VIEW | Yes | Xem log liên quan AUTH |

> <!-- sửa theo DRIFT AU-9 --> **Non-guard (không phải permission guard):** `AUTH.LOGIN.ACCESS`, `AUTH.PROFILE.VIEW`, `AUTH.PROFILE.UPDATE` chỉ là **nhãn mô tả/ví dụ payload**, KHÔNG dùng làm permission guard. Màn hồ sơ cá nhân và đăng nhập gate bằng `Authenticated` (đã đăng nhập), không kiểm permission code. Vì vậy số permission AUTH thực-guard = **14** (khớp [API-10 PERMISSION MATRIX](<../API Design/API-10 PERMISSION MATRIX.md>)); 3 mã trên có thể seed để hiển thị/tham chiếu nhưng không sinh guard. Tổng dòng seed AUTH = 17 (gồm `AUTH.USER.DELETE` thêm theo AU-11).
> <!-- sửa theo DRIFT AU-11 --> `AUTH.USER.DELETE` (is_sensitive=true) phục vụ admin xóa-mềm user; backend chỉ set `deleted_at`/`status`, KHÔNG hard-delete (BẤT BIẾN #2).

### 9.2 Nhóm HR

| Permission code | Resource | Action | Sensitive | Mô tả |
| --- | --- | --- | --- | --- |
| `HR.EMPLOYEE.VIEW` | EMPLOYEE | VIEW | Yes | Xem danh sách/hồ sơ nhân viên |
| `HR.EMPLOYEE.VIEW_SENSITIVE` | EMPLOYEE | VIEW_SENSITIVE | Yes | Xem dữ liệu nhạy cảm |
| `HR.EMPLOYEE.CREATE` | EMPLOYEE | CREATE | Yes | Tạo hồ sơ nhân viên |
| `HR.EMPLOYEE.UPDATE` | EMPLOYEE | UPDATE | Yes | Cập nhật hồ sơ nhân viên |
| `HR.EMPLOYEE.CHANGE_STATUS` | EMPLOYEE | CHANGE_STATUS | Yes | Đổi trạng thái nhân viên |
| `HR.EMPLOYEE.DELETE` | EMPLOYEE | DELETE | Yes | Xóa mềm/vô hiệu hóa nhân viên |
| `HR.EMPLOYEE.EXPORT` | EMPLOYEE | EXPORT | Yes | Xuất danh sách nhân viên |
| `HR.EMPLOYEE.FILE_VIEW` | EMPLOYEE_FILE | VIEW | Yes | Xem file hồ sơ |
| `HR.EMPLOYEE.FILE_UPLOAD` | EMPLOYEE_FILE | UPLOAD | Yes | Upload file hồ sơ |
| `HR.EMPLOYEE.FILE_DELETE` | EMPLOYEE_FILE | DELETE | Yes | Xóa file hồ sơ |
| `HR.DEPARTMENT.VIEW` | DEPARTMENT | VIEW | No | Xem phòng ban |
| `HR.DEPARTMENT.CREATE` | DEPARTMENT | CREATE | Yes | Tạo phòng ban |
| `HR.DEPARTMENT.UPDATE` | DEPARTMENT | UPDATE | Yes | Cập nhật phòng ban |
| `HR.DEPARTMENT.DELETE` | DEPARTMENT | DELETE | Yes | Xóa mềm phòng ban |
| `HR.POSITION.VIEW` | POSITION | VIEW | No | Xem chức vụ |
| `HR.POSITION.CREATE` | POSITION | CREATE | Yes | Tạo chức vụ |
| `HR.POSITION.UPDATE` | POSITION | UPDATE | Yes | Cập nhật chức vụ |
| `HR.POSITION.DELETE` | POSITION | DELETE | Yes | Xóa mềm chức vụ |
| `HR.CONTRACT.VIEW` | CONTRACT | VIEW | Yes | Xem hợp đồng |
| `HR.CONTRACT.CREATE` | CONTRACT | CREATE | Yes | Tạo hợp đồng |
| `HR.CONTRACT.UPDATE` | CONTRACT | UPDATE | Yes | Cập nhật hợp đồng |
| `HR.CONTRACT.DELETE` | CONTRACT | DELETE | Yes | Xóa mềm hợp đồng |
| `HR.PROFILE_CHANGE_REQUEST.CREATE` | PROFILE_CHANGE_REQUEST | CREATE | No | Employee gửi yêu cầu sửa hồ sơ |
| `HR.PROFILE_CHANGE_REQUEST.VIEW_OWN` | PROFILE_CHANGE_REQUEST | VIEW_OWN | No | Xem yêu cầu của chính mình |
| `HR.PROFILE_CHANGE_REQUEST.VIEW` | PROFILE_CHANGE_REQUEST | VIEW | Yes | HR/Admin xem danh sách yêu cầu |
| `HR.PROFILE_CHANGE_REQUEST.APPROVE` | PROFILE_CHANGE_REQUEST | APPROVE | Yes | Duyệt yêu cầu sửa hồ sơ |
| `HR.PROFILE_CHANGE_REQUEST.REJECT` | PROFILE_CHANGE_REQUEST | REJECT | Yes | Từ chối yêu cầu sửa hồ sơ |
| `HR.EMPLOYEE_CODE_CONFIG.VIEW` | EMPLOYEE_CODE_CONFIG | VIEW | Yes | Xem cấu hình mã nhân viên |
| `HR.EMPLOYEE_CODE_CONFIG.UPDATE` | EMPLOYEE_CODE_CONFIG | UPDATE | Yes | Cập nhật cấu hình mã nhân viên |
| `HR.EMPLOYEE_CODE.PREVIEW` | EMPLOYEE_CODE | PREVIEW | Yes | Preview mã nhân viên |
| `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` | EMPLOYEE_CODE | MANUAL_OVERRIDE | Yes | Sửa mã thủ công nếu được phép |

### 9.3 Nhóm ATT

| Permission code | Resource | Action | Sensitive | Mô tả |
| --- | --- | --- | --- | --- |
| `ATT.ATTENDANCE.CHECK_IN` | ATTENDANCE | CHECK_IN | No | Check-in |
| `ATT.ATTENDANCE.CHECK_OUT` | ATTENDANCE | CHECK_OUT | No | Check-out |
| `ATT.ATTENDANCE.VIEW_OWN` | ATTENDANCE | VIEW_OWN | Yes | Xem công cá nhân |
| `ATT.ATTENDANCE.VIEW_TEAM` | ATTENDANCE | VIEW_TEAM | Yes | Xem công team |
| `ATT.ATTENDANCE.VIEW_COMPANY` | ATTENDANCE | VIEW_COMPANY | Yes | Xem công toàn công ty |
| `ATT.ATTENDANCE.VIEW_DETAIL` | ATTENDANCE | VIEW_DETAIL | Yes | Xem chi tiết bản ghi công |
| `ATT.ATTENDANCE.EXPORT` | ATTENDANCE | EXPORT | Yes | Xuất dữ liệu công |
| `ATT.ATTENDANCE.ADJUST_DIRECT` | ATTENDANCE | ADJUST_DIRECT | Yes | HR/Admin điều chỉnh công trực tiếp |
| `ATT.ADJUSTMENT.CREATE_OWN` | ADJUSTMENT | CREATE_OWN | No | Employee gửi yêu cầu điều chỉnh công |
| `ATT.ADJUSTMENT.VIEW_OWN` | ADJUSTMENT | VIEW_OWN | Yes | Xem yêu cầu của chính mình |
| `ATT.ADJUSTMENT.VIEW_TEAM` | ADJUSTMENT | VIEW_TEAM | Yes | Xem yêu cầu team |
| `ATT.ADJUSTMENT.VIEW_COMPANY` | ADJUSTMENT | VIEW_COMPANY | Yes | Xem yêu cầu toàn công ty |
| `ATT.ADJUSTMENT.APPROVE` | ADJUSTMENT | APPROVE | Yes | Duyệt yêu cầu điều chỉnh công |
| `ATT.ADJUSTMENT.REJECT` | ADJUSTMENT | REJECT | Yes | Từ chối yêu cầu điều chỉnh công |
| `ATT.SHIFT.VIEW` | SHIFT | VIEW | No | Xem ca làm |
| `ATT.SHIFT.CREATE` | SHIFT | CREATE | Yes | Tạo ca làm |
| `ATT.SHIFT.UPDATE` | SHIFT | UPDATE | Yes | Cập nhật ca làm |
| `ATT.SHIFT.DELETE` | SHIFT | DELETE | Yes | Xóa mềm ca làm |
| `ATT.RULE.VIEW` | RULE | VIEW | Yes | Xem rule chấm công |
| `ATT.RULE.CONFIG` | RULE | CONFIG | Yes | Cấu hình rule chấm công |
| `ATT.REMOTE_REQUEST.CREATE_OWN` | REMOTE_REQUEST | CREATE_OWN | No | Gửi yêu cầu remote/công tác |
| `ATT.REMOTE_REQUEST.VIEW_OWN` | REMOTE_REQUEST | VIEW_OWN | Yes | Xem remote của chính mình |
| `ATT.REMOTE_REQUEST.VIEW_TEAM` | REMOTE_REQUEST | VIEW_TEAM | Yes | Xem remote team |
| `ATT.REMOTE_REQUEST.APPROVE` | REMOTE_REQUEST | APPROVE | Yes | Duyệt remote/công tác |
| `ATT.AUDIT_LOG.VIEW` | AUDIT_LOG | VIEW | Yes | Xem log chấm công |

### 9.4 Nhóm LEAVE

| Permission code | Resource | Action | Sensitive | Mô tả |
| --- | --- | --- | --- | --- |
| `LEAVE.REQUEST.CREATE` | REQUEST | CREATE | No | Tạo đơn nghỉ |
| `LEAVE.REQUEST.VIEW_OWN` | REQUEST | VIEW_OWN | Yes | Xem đơn của chính mình |
| `LEAVE.REQUEST.VIEW_TEAM` | REQUEST | VIEW_TEAM | Yes | Xem đơn team |
| `LEAVE.REQUEST.VIEW_DEPARTMENT` | REQUEST | VIEW_DEPARTMENT | Yes | Xem đơn phòng ban |
| `LEAVE.REQUEST.VIEW_COMPANY` | REQUEST | VIEW_COMPANY | Yes | Xem đơn toàn công ty |
| `LEAVE.REQUEST.UPDATE_OWN` | REQUEST | UPDATE_OWN | No | Sửa đơn nháp của mình |
| `LEAVE.REQUEST.CANCEL_OWN` | REQUEST | CANCEL_OWN | No | Hủy đơn của mình |
| `LEAVE.REQUEST.APPROVE` | REQUEST | APPROVE | Yes | Duyệt đơn nghỉ |
| `LEAVE.REQUEST.REJECT` | REQUEST | REJECT | Yes | Từ chối đơn nghỉ |
| `LEAVE.REQUEST.CANCEL_ANY` | REQUEST | CANCEL_ANY | Yes | Hủy đơn người khác |
| `LEAVE.REQUEST.EXPORT` | REQUEST | EXPORT | Yes | Xuất dữ liệu nghỉ |
| `LEAVE.TYPE.VIEW` | TYPE | VIEW | No | Xem loại nghỉ |
| `LEAVE.TYPE.CREATE` | TYPE | CREATE | Yes | Tạo loại nghỉ |
| `LEAVE.TYPE.UPDATE` | TYPE | UPDATE | Yes | Cập nhật loại nghỉ |
| `LEAVE.TYPE.DELETE` | TYPE | DELETE | Yes | Vô hiệu hóa loại nghỉ |
| `LEAVE.POLICY.VIEW` | POLICY | VIEW | Yes | Xem chính sách nghỉ |
| `LEAVE.POLICY.UPDATE` | POLICY | UPDATE | Yes | Cập nhật chính sách nghỉ |
| `LEAVE.BALANCE.VIEW_OWN` | BALANCE | VIEW_OWN | Yes | Xem số dư phép cá nhân |
| `LEAVE.BALANCE.VIEW` | BALANCE | VIEW | Yes | Xem số dư phép nhân viên |
| `LEAVE.BALANCE.ADJUST` | BALANCE | ADJUST | Yes | Điều chỉnh số dư phép |
| `LEAVE.CALENDAR.VIEW_OWN` | CALENDAR | VIEW_OWN | No | Xem lịch nghỉ cá nhân |
| `LEAVE.CALENDAR.VIEW_TEAM` | CALENDAR | VIEW_TEAM | Yes | Xem lịch nghỉ team |
| `LEAVE.CALENDAR.VIEW_COMPANY` | CALENDAR | VIEW_COMPANY | Yes | Xem lịch nghỉ công ty |
| `LEAVE.AUDIT_LOG.VIEW` | AUDIT_LOG | VIEW | Yes | Xem lịch sử xử lý nghỉ |

### 9.5 Nhóm TASK

| Permission code | Resource | Action | Sensitive | Mô tả |
| --- | --- | --- | --- | --- |
| `TASK.PROJECT.VIEW` | PROJECT | VIEW | No | Xem dự án |
| `TASK.PROJECT.CREATE` | PROJECT | CREATE | No | Tạo dự án |
| `TASK.PROJECT.UPDATE` | PROJECT | UPDATE | No | Cập nhật dự án |
| `TASK.PROJECT.DELETE` | PROJECT | DELETE | Yes | Xóa mềm dự án |
| `TASK.PROJECT.CLOSE` | PROJECT | CLOSE | No | Đóng dự án |
| `TASK.PROJECT.ARCHIVE` | PROJECT | ARCHIVE | No | Lưu trữ dự án |
| `TASK.PROJECT.MANAGE_MEMBER` | PROJECT | MANAGE_MEMBER | Yes | Quản lý thành viên dự án |
| `TASK.PROJECT.VIEW_REPORT` | PROJECT | VIEW_REPORT | Yes | Xem báo cáo dự án |
| `TASK.TASK.VIEW` | TASK | VIEW | No | Xem task |
| `TASK.TASK.CREATE` | TASK | CREATE | No | Tạo task |
| `TASK.TASK.UPDATE` | TASK | UPDATE | No | Cập nhật task |
| `TASK.TASK.DELETE` | TASK | DELETE | Yes | Xóa mềm task |
| `TASK.TASK.ASSIGN` | TASK | ASSIGN | No | Giao task |
| `TASK.TASK.UPDATE_STATUS` | TASK | UPDATE_STATUS | No | Cập nhật trạng thái |
| `TASK.TASK.UPDATE_PRIORITY` | TASK | UPDATE_PRIORITY | No | Cập nhật ưu tiên |
| `TASK.TASK.UPDATE_DEADLINE` | TASK | UPDATE_DEADLINE | No | Cập nhật deadline |
| `TASK.TASK.COMMENT` | TASK | COMMENT | No | Bình luận task |
| `TASK.TASK.FILE_UPLOAD` | TASK | FILE_UPLOAD | No | Upload file task |
| `TASK.TASK.FILE_DELETE` | TASK | FILE_DELETE | Yes | Xóa file task |
| `TASK.TASK.WATCH` | TASK | WATCH | No | Theo dõi/bỏ theo dõi task |
| `TASK.TASK.VIEW_KANBAN` | TASK | VIEW_KANBAN | No | Xem Kanban |
| `TASK.TASK.EXPORT` | TASK | EXPORT | Yes | Xuất danh sách task |
| `TASK.AUDIT_LOG.VIEW` | AUDIT_LOG | VIEW | Yes | Xem log task/project |

### 9.6 Nhóm DASH

| Permission code | Resource | Action | Sensitive | Mô tả |
| --- | --- | --- | --- | --- |
| `DASH.DASHBOARD.VIEW` | DASHBOARD | VIEW | No | Truy cập dashboard |
| `DASH.DASHBOARD.VIEW_EMPLOYEE` | DASHBOARD | VIEW_EMPLOYEE | No | Dashboard Employee |
| `DASH.DASHBOARD.VIEW_MANAGER` | DASHBOARD | VIEW_MANAGER | No | Dashboard Manager |
| `DASH.DASHBOARD.VIEW_HR` | DASHBOARD | VIEW_HR | Yes | Dashboard HR |
| `DASH.DASHBOARD.VIEW_ADMIN` | DASHBOARD | VIEW_ADMIN | Yes | Dashboard Admin |
| `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` | WIDGET | VIEW_ATTENDANCE_TODAY | No | Widget chấm công hôm nay |
| `DASH.WIDGET.VIEW_MY_TASKS` | WIDGET | VIEW_MY_TASKS | No | Widget task của tôi |
| `DASH.WIDGET.VIEW_TASK_ALERTS` | WIDGET | VIEW_TASK_ALERTS | No | Widget task quá hạn/sắp hạn |
| `DASH.WIDGET.VIEW_LEAVE_BALANCE` | WIDGET | VIEW_LEAVE_BALANCE | Yes | Widget số ngày phép |
| `DASH.WIDGET.VIEW_PENDING_LEAVE` | WIDGET | VIEW_PENDING_LEAVE | Yes | Widget đơn nghỉ chờ duyệt |
| `DASH.WIDGET.VIEW_LEAVE_CALENDAR` | WIDGET | VIEW_LEAVE_CALENDAR | Yes | Widget lịch nghỉ |
| `DASH.WIDGET.VIEW_NOTIFICATIONS` | WIDGET | VIEW_NOTIFICATIONS | No | Widget thông báo |
| `DASH.WIDGET.VIEW_HR_OVERVIEW` | WIDGET | VIEW_HR_OVERVIEW | Yes | Widget tổng quan HR |
| `DASH.WIDGET.VIEW_ATTENDANCE_ALERTS` | WIDGET | VIEW_ATTENDANCE_ALERTS | Yes | Widget bất thường công |
| `DASH.WIDGET.VIEW_PROJECT_PROGRESS` | WIDGET | VIEW_PROJECT_PROGRESS | Yes | Widget tiến độ dự án |
| `DASH.CONFIG.VIEW` | CONFIG | VIEW | Yes | Xem cấu hình dashboard |
| `DASH.CONFIG.UPDATE` | CONFIG | UPDATE | Yes | Cập nhật cấu hình dashboard |
| `DASH.AUDIT_LOG.VIEW` | AUDIT_LOG | VIEW | Yes | Xem log dashboard |

### 9.7 Nhóm NOTI

| Permission code | Resource | Action | Sensitive | Mô tả |
| --- | --- | --- | --- | --- |
| `NOTI.NOTIFICATION.VIEW_OWN` | NOTIFICATION | VIEW_OWN | No | Xem thông báo của tôi |
| `NOTI.NOTIFICATION.READ_OWN` | NOTIFICATION | READ_OWN | No | Đánh dấu đã đọc |
| `NOTI.NOTIFICATION.HIDE_OWN` | NOTIFICATION | HIDE_OWN | No | Ẩn/xóa mềm thông báo của tôi |
| `NOTI.NOTIFICATION.MARK_ALL_READ` | NOTIFICATION | MARK_ALL_READ | No | Đánh dấu tất cả đã đọc |
| `NOTI.CONFIG.VIEW` | CONFIG | VIEW | Yes | Xem cấu hình thông báo |
| `NOTI.CONFIG.UPDATE` | CONFIG | UPDATE | Yes | Cập nhật cấu hình thông báo |
| `NOTI.TEMPLATE.VIEW` | TEMPLATE | VIEW | Yes | Xem template thông báo |
| `NOTI.TEMPLATE.UPDATE` | TEMPLATE | UPDATE | Yes | Cập nhật template thông báo |
| `NOTI.DELIVERY_LOG.VIEW` | DELIVERY_LOG | VIEW | Yes | Xem log gửi thông báo |
| `NOTI.AUDIT_LOG.VIEW` | AUDIT_LOG | VIEW | Yes | Xem log NOTI |

---

## 10. Mapping role mặc định → permission

### 10.1 Nguyên tắc mapping

1. `SUPER_ADMIN` có toàn bộ permission với scope `System`.
2. `COMPANY_ADMIN` có quyền quản trị user/role trong company, không mặc định có quyền xem lương.
3. `HR` có quyền nghiệp vụ HR/ATT/LEAVE theo scope `Company`, nhưng không mặc định quản lý role/permission hệ thống.
4. `MANAGER` có quyền xem/xử lý dữ liệu team theo scope `Team`, một số quyền TASK có scope `Project` hoặc `Team`.
5. `EMPLOYEE` chỉ có quyền self-service với scope `Own`.
6. `PROJECT_MANAGER` tập trung vào project/task với scope `Project`.

### 10.2 Matrix rút gọn

| Role | Permission nhóm chính | Scope mặc định |
| --- | --- | --- |
| `SUPER_ADMIN` | Tất cả permission active | System |
| `COMPANY_ADMIN` | AUTH user/role, DASH admin, cấu hình công ty, xem dữ liệu theo cấp công ty nếu được cấp | Company |
| `HR` | HR employee/contract/profile request, ATT company, LEAVE company, DASH HR | Company |
| `MANAGER` | HR employee view team, ATT team, LEAVE approve team, TASK team/project, DASH manager | Team/Project |
| `EMPLOYEE` | Login, profile, password, HR own, ATT own, LEAVE own, TASK own, DASH employee, NOTI own | Own |
| `PROJECT_MANAGER` | Project/task manage member, task assign/update/report | Project |

### 10.3 Mapping chi tiết đề xuất cho `EMPLOYEE`

| Permission | Scope |
| --- | --- |
| `AUTH.LOGIN.ACCESS` | Own |
| `AUTH.PROFILE.VIEW` | Own |
| `AUTH.PROFILE.UPDATE` | Own |
| `AUTH.PASSWORD.CHANGE` | Own |
| `HR.EMPLOYEE.VIEW` | Own |
| `HR.PROFILE_CHANGE_REQUEST.CREATE` | Own |
| `HR.PROFILE_CHANGE_REQUEST.VIEW_OWN` | Own |
| `ATT.ATTENDANCE.CHECK_IN` | Own |
| `ATT.ATTENDANCE.CHECK_OUT` | Own |
| `ATT.ATTENDANCE.VIEW_OWN` | Own |
| `ATT.ADJUSTMENT.CREATE_OWN` | Own |
| `ATT.ADJUSTMENT.VIEW_OWN` | Own |
| `ATT.REMOTE_REQUEST.CREATE_OWN` | Own |
| `ATT.REMOTE_REQUEST.VIEW_OWN` | Own |
| `LEAVE.REQUEST.CREATE` | Own |
| `LEAVE.REQUEST.VIEW_OWN` | Own |
| `LEAVE.REQUEST.UPDATE_OWN` | Own |
| `LEAVE.REQUEST.CANCEL_OWN` | Own |
| `LEAVE.BALANCE.VIEW_OWN` | Own |
| `LEAVE.CALENDAR.VIEW_OWN` | Own |
| `TASK.TASK.VIEW` | Own/Project |
| `TASK.TASK.UPDATE_STATUS` | Own |
| `TASK.TASK.COMMENT` | Own/Project |
| `TASK.TASK.FILE_UPLOAD` | Own/Project |
| `TASK.TASK.WATCH` | Own/Project |
| `DASH.DASHBOARD.VIEW` | Own |
| `DASH.DASHBOARD.VIEW_EMPLOYEE` | Own |
| `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` | Own |
| `DASH.WIDGET.VIEW_MY_TASKS` | Own |
| `DASH.WIDGET.VIEW_LEAVE_BALANCE` | Own |
| `DASH.WIDGET.VIEW_NOTIFICATIONS` | Own |
| `NOTI.NOTIFICATION.VIEW_OWN` | Own |
| `NOTI.NOTIFICATION.READ_OWN` | Own |
| `NOTI.NOTIFICATION.HIDE_OWN` | Own |

### 10.4 Mapping chi tiết đề xuất cho `MANAGER`

Manager thường vẫn có role `EMPLOYEE`. Các quyền dưới đây là phần bổ sung.

| Permission | Scope |
| --- | --- |
| `HR.EMPLOYEE.VIEW` | Team |
| `ATT.ATTENDANCE.VIEW_TEAM` | Team |
| `ATT.ADJUSTMENT.VIEW_TEAM` | Team |
| `ATT.ADJUSTMENT.APPROVE` | Team |
| `ATT.ADJUSTMENT.REJECT` | Team |
| `ATT.REMOTE_REQUEST.VIEW_TEAM` | Team |
| `ATT.REMOTE_REQUEST.APPROVE` | Team |
| `LEAVE.REQUEST.VIEW_TEAM` | Team |
| `LEAVE.REQUEST.APPROVE` | Team |
| `LEAVE.REQUEST.REJECT` | Team |
| `LEAVE.CALENDAR.VIEW_TEAM` | Team |
| `TASK.PROJECT.VIEW` | Project/Team |
| `TASK.PROJECT.CREATE` | Team |
| `TASK.PROJECT.UPDATE` | Project |
| `TASK.PROJECT.MANAGE_MEMBER` | Project |
| `TASK.TASK.VIEW` | Team/Project |
| `TASK.TASK.CREATE` | Team/Project |
| `TASK.TASK.UPDATE` | Team/Project |
| `TASK.TASK.ASSIGN` | Team/Project |
| `TASK.TASK.UPDATE_STATUS` | Team/Project |
| `TASK.TASK.VIEW_KANBAN` | Team/Project |
| `DASH.DASHBOARD.VIEW_MANAGER` | Team |
| `DASH.WIDGET.VIEW_PENDING_LEAVE` | Team |
| `DASH.WIDGET.VIEW_LEAVE_CALENDAR` | Team |
| `DASH.WIDGET.VIEW_TASK_ALERTS` | Team |
| `DASH.WIDGET.VIEW_PROJECT_PROGRESS` | Project |

### 10.5 Mapping chi tiết đề xuất cho `HR`

| Permission | Scope |
| --- | --- |
| `AUTH.USER.CREATE` | Company, nếu HR được phép tạo account khi tạo employee |
| `AUTH.USER.VIEW` | Company, nếu HR được cấp |
| `HR.EMPLOYEE.VIEW` | Company |
| `HR.EMPLOYEE.VIEW_SENSITIVE` | Company, nếu được cấp riêng |
| `HR.EMPLOYEE.CREATE` | Company |
| `HR.EMPLOYEE.UPDATE` | Company |
| `HR.EMPLOYEE.CHANGE_STATUS` | Company |
| `HR.EMPLOYEE.EXPORT` | Company, nếu được cấp riêng |
| `HR.EMPLOYEE.FILE_VIEW` | Company, nếu được cấp |
| `HR.EMPLOYEE.FILE_UPLOAD` | Company |
| `HR.DEPARTMENT.*` | Company |
| `HR.POSITION.*` | Company |
| `HR.CONTRACT.*` | Company |
| `HR.PROFILE_CHANGE_REQUEST.VIEW` | Company |
| `HR.PROFILE_CHANGE_REQUEST.APPROVE` | Company |
| `HR.PROFILE_CHANGE_REQUEST.REJECT` | Company |
| `HR.EMPLOYEE_CODE_CONFIG.*` | Company, nếu được cấp |
| `ATT.ATTENDANCE.VIEW_COMPANY` | Company |
| `ATT.ATTENDANCE.ADJUST_DIRECT` | Company, nếu được cấp |
| `ATT.ADJUSTMENT.VIEW_COMPANY` | Company |
| `ATT.ADJUSTMENT.APPROVE` | Company |
| `ATT.ADJUSTMENT.REJECT` | Company |
| `ATT.SHIFT.*` | Company |
| `ATT.RULE.*` | Company |
| `LEAVE.REQUEST.VIEW_COMPANY` | Company |
| `LEAVE.REQUEST.APPROVE` | Company, nếu HR được duyệt |
| `LEAVE.REQUEST.REJECT` | Company, nếu HR được duyệt |
| `LEAVE.TYPE.*` | Company |
| `LEAVE.POLICY.*` | Company |
| `LEAVE.BALANCE.VIEW` | Company |
| `LEAVE.BALANCE.ADJUST` | Company |
| `DASH.DASHBOARD.VIEW_HR` | Company |
| `DASH.WIDGET.VIEW_HR_OVERVIEW` | Company |
| `DASH.WIDGET.VIEW_ATTENDANCE_ALERTS` | Company |

### 10.6 Mapping chi tiết đề xuất cho `COMPANY_ADMIN`

| Permission | Scope |
| --- | --- |
| `AUTH.USER.VIEW` | Company |
| `AUTH.USER.CREATE` | Company |
| `AUTH.USER.UPDATE` | Company |
| `AUTH.USER.LOCK` | Company |
| `AUTH.USER.UNLOCK` | Company |
| `AUTH.USER.ASSIGN_ROLE` | Company |
| `AUTH.ROLE.VIEW` | Company |
| `AUTH.ROLE.CREATE` | Company |
| `AUTH.ROLE.UPDATE` | Company |
| `AUTH.ROLE.DELETE` | Company |
| `AUTH.PERMISSION.VIEW` | Company |
| `AUTH.PERMISSION.ASSIGN` | Company |
| `AUTH.AUDIT_LOG.VIEW` | Company |
| `DASH.DASHBOARD.VIEW_ADMIN` | Company |
| `DASH.CONFIG.VIEW` | Company |
| `DASH.CONFIG.UPDATE` | Company |
| `NOTI.CONFIG.VIEW` | Company |
| `NOTI.CONFIG.UPDATE` | Company |

---

## 11. Luồng xử lý nghiệp vụ và tác động database

### 11.1 Luồng đăng nhập

```text
User nhập email/password
→ Backend normalize email
→ Tìm users theo company_id + normalized_email + deleted_at IS NULL
→ Kiểm tra company active
→ Kiểm tra user.status
→ Verify password_hash
→ Nếu fail: ghi login_logs Failed, tăng failed_login_count
→ Nếu quá số lần sai: status = Locked, ghi user_security_events
→ Nếu success: reset failed_login_count
→ Tạo user_sessions
→ Ghi login_logs Success
→ Cập nhật users.last_login_at, last_login_ip
→ Load roles + permissions + data_scope
→ Trả access token/refresh token và auth context
```

#### Query load auth context

```sql
SELECT
    u.id AS user_id,
    u.company_id,
    u.email,
    u.display_name,
    u.status,
    r.role_code,
    p.permission_code,
    rp.data_scope,
    rp.conditions
FROM users u
JOIN user_roles ur
    ON ur.user_id = u.id
   AND ur.is_active = true
   AND ur.deleted_at IS NULL
   AND (ur.expired_at IS NULL OR ur.expired_at > now())
JOIN roles r
    ON r.id = ur.role_id
   AND r.status = 'Active'
   AND r.deleted_at IS NULL
JOIN role_permissions rp
    ON rp.role_id = r.id
   AND rp.is_active = true
   AND rp.deleted_at IS NULL
JOIN permissions p
    ON p.id = rp.permission_id
   AND p.is_active = true
WHERE u.id = :user_id
  AND u.status = 'Active'
  AND u.deleted_at IS NULL;
```

### 11.2 Luồng đăng xuất

```text
User bấm đăng xuất
→ Backend xác định session hiện tại
→ Set user_sessions.revoked_at = now()
→ Set revoked_reason = 'UserLogout'
→ Client xóa access token/refresh token
```

### 11.3 Luồng tạo user cho employee mới

```text
HR/Admin tạo employee trong HR
→ Chọn tạo tài khoản đăng nhập
→ Backend tạo users status Pending Activation
→ Gán role EMPLOYEE vào user_roles
→ Tạo password_reset_tokens purpose ActivateAccount
→ NOTI/email gửi link kích hoạt
→ Employee đặt mật khẩu
→ users.status = Active
→ password_reset_tokens.used_at = now()
→ HR liên kết employees.user_id = users.id
```

### 11.4 Luồng gán role cho user

```text
Admin chọn user
→ Chọn role cần gán
→ Backend kiểm tra AUTH.USER.ASSIGN_ROLE
→ Kiểm tra admin không vượt phạm vi company/system
→ Insert user_roles
→ Ghi user_security_events ROLE_ASSIGNED
→ Ghi audit_logs action ASSIGN_ROLE
```

### 11.5 Luồng kiểm tra permission API

```text
Request đi vào backend
→ Middleware xác thực access token/session
→ Lấy auth context từ cache hoặc database
→ Kiểm tra permission_code cần thiết
→ Nếu không có permission: 403
→ Nếu có permission: kiểm tra data_scope
→ Nếu target entity thuộc scope: cho xử lý
→ Nếu không thuộc scope: 403
```

#### Hàm kiểm tra scope ở service layer

| Scope | Cách kiểm tra dữ liệu target |
| --- | --- |
| Own | `target.employee_id = current_employee.id` hoặc `target.user_id = current_user.id` |
| Team | Target employee có `direct_manager_id = current_employee.id` hoặc nằm trong team mở rộng |
| Department | Target employee thuộc department mà user quản lý/có quyền |
| Project | Target task/project có user là project member/owner/manager |
| Company | `target.company_id = current_user.company_id` |
| System | Không giới hạn company, chỉ Super Admin/system role |

---

## 12. Chính sách trạng thái tài khoản

### 12.1 `users.status`

| Status | Được login? | Ghi chú |
| --- | --- | --- |
| `Pending Activation` | Không | Tài khoản mới tạo, chưa đặt mật khẩu/kích hoạt |
| `Active` | Có | Được đăng nhập nếu company active |
| `Inactive` | Không | Tạm ngưng |
| `Locked` | Không | Bị khóa thủ công hoặc do bảo mật |
| `Deleted` | Không | Xóa mềm |

### 12.2 Chuyển trạng thái

```text
Pending Activation → Active
Active → Locked
Locked → Active
Active → Inactive
Inactive → Active
Active/Inactive/Locked → Deleted
```

### 12.3 Quy tắc khóa tài khoản

MVP đề xuất:

| Điều kiện | Hành động |
| --- | --- |
| Sai mật khẩu 5 lần liên tiếp | Set `status = Locked`, `locked_at = now()` |
| Admin khóa thủ công | Set `status = Locked`, ghi reason |
| HR chuyển employee nghỉ việc và chọn khóa user | Set `status = Locked` hoặc `Inactive` |
| Company bị suspended | Không đổi user status, nhưng backend chặn login do company inactive/suspended |

---

## 13. Audit log cho AUTH/RBAC

### 13.1 Hành động cần ghi log

| Action | Entity | Khi nào ghi |
| --- | --- | --- |
| `AUTH_USER_CREATED` | User | Tạo user |
| `AUTH_USER_UPDATED` | User | Cập nhật user |
| `AUTH_USER_LOCKED` | User | Khóa user |
| `AUTH_USER_UNLOCKED` | User | Mở khóa user |
| `AUTH_USER_DELETED` | User | Xóa mềm user |
| `AUTH_PASSWORD_CHANGED` | User | User đổi mật khẩu |
| `AUTH_PASSWORD_RESET_REQUESTED` | User | Yêu cầu reset password |
| `AUTH_PASSWORD_RESET_COMPLETED` | User | Reset password thành công |
| `AUTH_ROLE_CREATED` | Role | Tạo role |
| `AUTH_ROLE_UPDATED` | Role | Cập nhật role |
| `AUTH_ROLE_DISABLED` | Role | Vô hiệu hóa role |
| `AUTH_USER_ROLE_ASSIGNED` | UserRole | Gán role cho user |
| `AUTH_USER_ROLE_REMOVED` | UserRole | Gỡ role khỏi user |
| `AUTH_ROLE_PERMISSION_ASSIGNED` | RolePermission | Gán permission cho role |
| `AUTH_ROLE_PERMISSION_REMOVED` | RolePermission | Gỡ permission khỏi role |
| `AUTH_LOGIN_SUCCESS` | LoginLog | Đăng nhập thành công, có thể chỉ lưu login_logs để tránh log quá nhiều |
| `AUTH_LOGIN_FAILED` | LoginLog | Đăng nhập thất bại nhiều lần hoặc nghi ngờ bất thường |
| `AUTH_SESSION_REVOKED` | Session | Thu hồi session |
| `AUTH_USER_EXPORTED` | User | Export danh sách user |
| `AUTH_ROLE_EXPORTED` | Role | Export danh sách role |

### 13.2 Payload audit log gợi ý

```json
{
  "actor_user_id": "uuid-admin",
  "module_code": "AUTH",
  "action": "AUTH_USER_ROLE_ASSIGNED",
  "entity_type": "UserRole",
  "entity_id": "uuid-user-role",
  "old_values": null,
  "new_values": {
    "user_id": "uuid-user",
    "role_id": "uuid-role",
    "role_code": "MANAGER"
  },
  "metadata": {
    "ip_address": "127.0.0.1",
    "user_agent": "Mozilla...",
    "request_id": "req-123"
  }
}
```

---

## 14. Query pattern quan trọng

### 14.1 Kiểm tra user có permission không

```sql
SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = :user_id
      AND ur.company_id = :company_id
      AND ur.is_active = true
      AND ur.deleted_at IS NULL
      AND (ur.expired_at IS NULL OR ur.expired_at > now())
      AND r.status = 'Active'
      AND r.deleted_at IS NULL
      AND rp.is_active = true
      AND rp.deleted_at IS NULL
      AND p.is_active = true
      AND p.permission_code = :permission_code
) AS has_permission;
```

### 14.2 Lấy danh sách permission effective của user

```sql
SELECT DISTINCT
    p.permission_code,
    rp.data_scope,
    rp.conditions
FROM user_roles ur
JOIN roles r ON r.id = ur.role_id
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE ur.user_id = :user_id
  AND ur.company_id = :company_id
  AND ur.is_active = true
  AND ur.deleted_at IS NULL
  AND (ur.expired_at IS NULL OR ur.expired_at > now())
  AND r.status = 'Active'
  AND r.deleted_at IS NULL
  AND rp.is_active = true
  AND rp.deleted_at IS NULL
  AND p.is_active = true;
```

### 14.3 Tìm user theo email khi login

```sql
SELECT *
FROM users
WHERE company_id = :company_id
  AND normalized_email = lower(:email)
  AND deleted_at IS NULL
LIMIT 1;
```

### 14.4 Danh sách user phân trang cho Admin

```sql
SELECT
    u.id,
    u.email,
    u.display_name,
    u.status,
    u.last_login_at,
    array_agg(r.role_code ORDER BY r.role_code) AS roles
FROM users u
LEFT JOIN user_roles ur
    ON ur.user_id = u.id
   AND ur.is_active = true
   AND ur.deleted_at IS NULL
LEFT JOIN roles r
    ON r.id = ur.role_id
   AND r.deleted_at IS NULL
WHERE u.company_id = :company_id
  AND u.deleted_at IS NULL
  AND (:status IS NULL OR u.status = :status)
  AND (:keyword IS NULL OR u.normalized_email ILIKE '%' || lower(:keyword) || '%' OR u.display_name ILIKE '%' || :keyword || '%')
GROUP BY u.id
ORDER BY u.created_at DESC
LIMIT :limit OFFSET :offset;
```

---

## 15. Quy tắc cache quyền

### 15.1 Có nên cache permission không?

Nên cache auth context sau login để giảm query nặng.

Cache có thể gồm:

```json
{
  "user_id": "uuid",
  "company_id": "uuid",
  "roles": ["EMPLOYEE", "MANAGER"],
  "permissions": [
    {
      "permission_code": "LEAVE.REQUEST.APPROVE",
      "data_scope": "Team",
      "conditions": null
    }
  ]
}
```

### 15.2 Khi nào phải invalidate cache?

| Sự kiện | Hành động |
| --- | --- |
| User bị khóa/mở khóa | Xóa cache user |
| Gán/gỡ role | Xóa cache user |
| Role bị sửa | Xóa cache tất cả user có role |
| Role được gán/gỡ permission | Xóa cache tất cả user có role |
| Permission bị tắt | Xóa cache toàn bộ user liên quan |
| Company bị inactive/suspended | Xóa cache user thuộc company |

### 15.3 Cache TTL

MVP đề xuất:

```text
Auth context cache TTL: 5 - 15 phút
Session validation: theo access token TTL
Refresh token: kiểm tra database khi refresh
```

---

## 16. Bảo mật dữ liệu nhạy cảm

### 16.1 Nguyên tắc chung

1. Không lưu mật khẩu plain text.
2. Không lưu token reset/refresh plain text.
3. Không trả `password_hash`, `refresh_token_hash`, `token_hash` ra API.
4. Không ghi mật khẩu/token vào log.
5. Dữ liệu nhạy cảm phải có permission riêng.
6. Export dữ liệu nhạy cảm phải có permission export riêng.
7. Mọi thao tác quản trị user/role/permission cần audit log.
8. Các URL notification hoặc deep link không được chứa token hoặc dữ liệu nhạy cảm.

### 16.2 Trường cần ẩn khỏi API response

| Bảng | Trường không trả về client |
| --- | --- |
| `users` | `password_hash`, `metadata` nhạy cảm |
| `user_sessions` | `refresh_token_hash`, `access_token_jti` |
| `password_reset_tokens` | `token_hash` |
| `user_auth_providers` | access token/refresh token nếu sau này có lưu encrypted |
| `user_mfa_methods` | `secret_encrypted` |

### 16.3 Password hash

Khuyến nghị:

```text
Argon2id hoặc bcrypt
Không tự triển khai thuật toán hash
Có password pepper ở application secret nếu cần
```

---

## 17. Tích hợp với module HR

### 17.1 Quan hệ User - Employee

Thiết kế khuyến nghị:

```text
employees.user_id → users.id
```

Lý do:

1. HR là nguồn dữ liệu nhân sự chính.
2. Không phải employee nào cũng bắt buộc có user trong MVP.
3. User có thể được tạo trước, sau đó HR liên kết employee.
4. Tránh AUTH phụ thuộc ngược vào bảng employees khi bootstrap user đầu tiên.

### 17.2 Constraint ở HR DB-03 cần có

Trong DB-03, bảng `employees` nên có:

```sql
user_id UUID NULL REFERENCES users(id)
```

Và unique partial index:

```sql
CREATE UNIQUE INDEX uq_employees_user_id_active
ON employees (user_id)
WHERE user_id IS NOT NULL AND deleted_at IS NULL;
```

### 17.3 Khi employee nghỉ việc

Khi HR chuyển trạng thái employee sang `Resigned` hoặc `Terminated`, hệ thống có thể:

1. Giữ user nhưng set `Inactive`.
2. Khóa user bằng `Locked`.
3. Revoke toàn bộ session active.
4. Ghi audit log ở cả HR và AUTH.
5. Không xóa cứng user để giữ lịch sử task, nghỉ phép, chấm công.

---

## 18. Tích hợp với các module khác

### 18.1 ATT

ATT dùng AUTH để:

1. Xác định user đang đăng nhập.
2. Join sang employee qua HR.
3. Kiểm tra permission `ATT.ATTENDANCE.CHECK_IN`, `ATT.ATTENDANCE.CHECK_OUT`.
4. Áp dụng scope Own/Team/Company khi xem bảng công.
5. Ghi actor khi điều chỉnh công.

### 18.2 LEAVE

LEAVE dùng AUTH để:

1. Xác định người tạo đơn.
2. Kiểm tra permission tạo/xem/duyệt/từ chối/hủy đơn.
3. Áp dụng scope Own/Team/Department/Company/System.
4. Ghi actor khi xử lý đơn.

### 18.3 TASK

TASK dùng AUTH để:

1. Kiểm tra quyền tạo dự án/task.
2. Kiểm tra quyền giao task.
3. Kiểm tra scope Own/Team/Project/Company.
4. Kết hợp với project role trong `project_members`.

### 18.4 DASH

DASH dùng AUTH để:

1. Xác định dashboard mặc định theo role.
2. Xác định widget nào được hiển thị.
3. Query dữ liệu widget theo scope.
4. Chặn API dashboard nếu không có permission.

### 18.5 NOTI

NOTI dùng AUTH để:

1. Gửi thông báo theo `user_id`.
2. Kiểm tra user active trước khi gửi.
3. Kiểm tra user chỉ xem thông báo của chính mình.
4. Điều hướng deep link nhưng vẫn cần module gốc kiểm tra permission.

---

## 19. Migration plan

### 19.1 Thứ tự migration DB-02

1. Tạo extension `pgcrypto` nếu chưa có.
2. Tạo bảng `users` sau khi có `companies`, `files`.
3. Tạo bảng `roles`.
4. Tạo bảng `permissions`.
5. Tạo bảng `user_roles`.
6. Tạo bảng `role_permissions`.
7. Tạo bảng `user_sessions`.
8. Tạo bảng `password_reset_tokens`.
9. Tạo bảng `login_logs`.
10. Tạo bảng `user_security_events`.
11. Seed permissions.
12. Seed roles mặc định.
13. Seed role_permissions mặc định.
14. Tạo Super Admin đầu tiên.
15. Tạo Company Admin đầu tiên cho company MVP.

### 19.2 Seed dữ liệu bắt buộc

#### Modules

```text
AUTH
HR
ATT
LEAVE
TASK
DASH
NOTI
PAYROLL
RECRUIT
ASSET
ROOM
CHAT
SOCIAL
MOBILE
AI
```

#### Roles MVP

```text
SUPER_ADMIN
COMPANY_ADMIN
HR
MANAGER
EMPLOYEE
PROJECT_MANAGER
```

#### Future roles

```text
PAYROLL_OFFICER
RECRUITER
ASSET_MANAGER
OFFICE_ADMIN
EXECUTIVE
AUDITOR
```

---

## 20. Test case database/RBAC cần kiểm tra

| Mã test | Nội dung | Kỳ vọng |
| --- | --- | --- |
| DB02-TC-001 | Tạo user email trùng trong cùng company | Bị chặn bởi unique index |
| DB02-TC-002 | Tạo user email giống nhau ở khác company | Cho phép nếu multi-tenant |
| DB02-TC-003 | User Active login đúng mật khẩu | Tạo session, ghi login success |
| DB02-TC-004 | User Locked login | Bị chặn, ghi login failed/blocked |
| DB02-TC-005 | Sai mật khẩu nhiều lần | Tăng failed count, có thể lock user |
| DB02-TC-006 | Password reset token hết hạn | Không cho reset |
| DB02-TC-007 | Password reset token đã dùng | Không cho dùng lại |
| DB02-TC-008 | Gán role cho user | Insert user_roles, ghi audit log |
| DB02-TC-009 | Gán role trùng active | Bị chặn bởi unique index |
| DB02-TC-010 | Role inactive | Permission từ role không có hiệu lực |
| DB02-TC-011 | Permission inactive | User không nhận quyền đó |
| DB02-TC-012 | Employee xem hồ sơ người khác với scope Own | Bị chặn |
| DB02-TC-013 | Manager xem nhân viên team với scope Team | Cho phép |
| DB02-TC-014 | Manager xem nhân viên ngoài team | Bị chặn |
| DB02-TC-015 | HR xem nhân viên company với scope Company | Cho phép |
| DB02-TC-016 | Admin công ty xem user công ty khác | Bị chặn |
| DB02-TC-017 | Super Admin scope System | Xem được toàn hệ thống |
| DB02-TC-018 | User bị khóa | Revoke toàn bộ session active |
| DB02-TC-019 | Gỡ role | Cache quyền bị invalidate |
| DB02-TC-020 | Export user không có quyền | Bị chặn và có thể ghi security event |

---

## 21. Rủi ro và hướng xử lý

| Rủi ro | Mức độ | Hướng xử lý |
| --- | --- | --- |
| Phân quyền quá phức tạp | Cao | MVP dùng RBAC + data scope đơn giản, chưa dùng ABAC phức tạp |
| User có nhiều role tạo xung đột scope | Trung bình | Dùng nguyên tắc scope mạnh nhất hoặc service quyết định theo permission |
| Super Admin lẫn Company Admin | Cao | Tách `role_type`, `company_id` nullable và scope System/Company |
| Lộ dữ liệu nhạy cảm qua API | Cao | Backend kiểm tra permission + field-level permission |
| Token bị lộ | Cao | Lưu hash token, hỗ trợ revoke session |
| Dashboard/notification dùng sai scope | Trung bình | Tất cả API widget/notification phải gọi auth context |
| Seed permission thiếu | Cao | Quản lý permission bằng migration/versioned seed |
| Role bị sửa ảnh hưởng user đang online | Trung bình | Invalidate cache quyền khi role/permission thay đổi |
| HR tạo employee nhưng chưa tạo user | Thấp | Cho phép employee không có user; tạo user sau |
| SaaS phase sau cần tenant | Trung bình | Dùng `company_id` từ đầu |

---

## 22. Quyết định thiết kế đã chốt

1. DB-02 sử dụng PostgreSQL, UUID, snake_case và soft delete theo DB-01.
2. `users.company_id` bắt buộc trong MVP.
3. `roles.company_id` nullable để hỗ trợ role global/system.
4. `permissions` là global catalog, không gắn company trong MVP.
5. Data scope đặt ở `role_permissions.data_scope`.
6. User có thể có nhiều role qua `user_roles`.
7. Employee liên kết với user ở bảng `employees.user_id`, không đặt `employee_id` trong `users`.
8. Refresh token/reset token chỉ lưu hash.
9. Login history lưu ở `login_logs`.
10. Security event lưu ở `user_security_events` để phục vụ audit/bảo mật.
11. Audit log chi tiết dùng bảng chung `audit_logs` của Foundation.
12. Permission seed phải bao gồm AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI ngay từ MVP để các module sau có thể triển khai nhất quán.

---

## 23. Việc cần làm tiếp theo

Sau DB-02, nên triển khai tiếp:

```text
DB-03: HR Database Design
```

DB-03 cần đi sâu vào:

1. `employees`.
2. `departments`.
3. `positions`.
4. `job_levels`.
5. `employee_contracts`.
6. `profile_change_requests`.
7. `profile_change_request_items`.
8. `employee_code_configs`.
9. Quan hệ `employees.user_id` với `users.id`.
10. Quyền xem dữ liệu nhạy cảm và workflow Employee Self-Service.
