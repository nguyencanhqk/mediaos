> 🔒 **BẤT BIẾN DB (bổ sung bắt buộc):** Mọi bảng có `company_id` PHẢI bật **RLS + FORCE**; `audit_logs` **append-only** (REVOKE UPDATE/DELETE + trigger); audit/event ghi qua **outbox** trong cùng transaction nghiệp vụ. Bộ docs gốc CHƯA mô tả 3 cơ chế này — DDL mẫu + `withTenant`/`set_config` tại [DECISIONS-02 §2–3](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md).

# DB-10: MIGRATION PLAN & INITIAL SEED DATA DATABASE DESIGN

**KẾ HOẠCH MIGRATION & DỮ LIỆU SEED BAN ĐẦU**

> **📚 Bộ tài liệu DB — Hệ thống Quản lý Doanh nghiệp**
> [DB-01 Tổng quan](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [DB-02 AUTH/RBAC](<DB-02 AUTH RBAC Database Design.md>) · [DB-03 HR](<DB-03_HR Database Design.md>) · [DB-04 ATT](<DB-04_ATT Database Design.md>) · [DB-05 LEAVE](<DB-05 LEAVE Database Design.md>) · [DB-06 TASK](<DB-06 TASK Database Design.md>) · [DB-07 NOTI/DASH](<DB-07 NOTI DASH Database Design.md>) · [DB-08 Audit/Files/Settings](<DB-08 Audit Files Settings Seeds Database Design.md>) · [DB-09 Index/Hiệu năng](<DB-09 Database Index Query Pattern Performance Design.md>) · **DB-10 Migration/Seed**
>
> **Nguồn & liên quan:** [PRD-00 §18 ưu tiên triển khai](<../PRD/PRD-00 Enterprise Management System .md>) · [SPEC-01 Tổng quan (§25 giai đoạn)](<../SPEC/SPEC-01 Tổng quan.md>) · [Chuẩn API: API-01 Tổng quan](<../API Design/API-01 TỔNG QUAN.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DB-10 |
| Tên tài liệu | Migration Plan & Initial Seed Data Database Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Nhóm dữ liệu | Cross-module / Migration / Seed / Bootstrap |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0, chuẩn bị mở rộng Phase 2+ |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-09 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả kế hoạch migration database và dữ liệu seed ban đầu cho hệ thống quản lý doanh nghiệp nội bộ.

DB-10 không thiết kế thêm module nghiệp vụ mới. DB-10 đóng vai trò là tài liệu triển khai database từ trạng thái trống đến trạng thái có thể chạy MVP, bao gồm:

1. Thứ tự chạy migration toàn hệ thống.
2. Quy ước đặt tên file migration.
3. Quy tắc tạo bảng, tạo constraint, tạo foreign key và tạo index.
4. Chiến lược seed dữ liệu nền tảng.
5. Seed module catalog.
6. Seed công ty mặc định nếu cần.
7. Seed system settings và company settings mặc định.
8. Seed permissions toàn hệ thống.
9. Seed roles mặc định.
10. Seed role-permission matrix theo data scope.
11. Seed notification events và templates.
12. Seed dashboard widgets và widget configs.
13. Seed leave types, attendance defaults, sequence counters và public holidays.
14. Checklist dựng database từ đầu.
15. Checklist kiểm thử sau migration.
16. Quy tắc rollback, re-run, idempotent seed và bảo mật dữ liệu bootstrap.

---

## 3. Căn cứ thiết kế

DB-10 bám theo các quyết định đã chốt trong bộ tài liệu database trước đó:

1. PostgreSQL là database chính.
2. Tất cả bảng chính dùng UUID primary key.
3. Hệ thống thiết kế sẵn multi-tenant bằng `company_id`.
4. Dữ liệu quan trọng dùng soft delete, không xóa cứng.
5. Audit log, file, setting, sequence, public holiday và seed tracking thuộc lớp Foundation.
6. AUTH/RBAC là nền tảng phân quyền cho toàn bộ module.
7. HR là nguồn dữ liệu nhân sự trung tâm.
8. ATT, LEAVE, TASK đều gắn nghiệp vụ chính với `employees.id`.
9. NOTI và DASH là module dùng chung, không xử lý nghiệp vụ gốc.
10. DB-09 đã định nghĩa index/query pattern nên DB-10 cần đưa index vào đúng giai đoạn migration.

---

## 4. Phạm vi thiết kế

### 4.1 Bao gồm

| Nhóm | Nội dung |
| --- | --- |
| Migration convention | Quy ước đặt tên, version, transaction, rollback |
| Migration order | Thứ tự tạo bảng Foundation, AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH |
| Extension setup | `pgcrypto`, `pg_trgm`, `unaccent` |
| Constraint strategy | PK, FK, unique, check constraint, partial unique |
| Cross-module FK | Xử lý FK vòng và FK liên module |
| Index migration | Áp dụng index theo DB-09 |
| Seed strategy | Idempotent seed, seed key, checksum, upsert |
| Initial seed | Modules, settings, company, permissions, roles, role permissions |
| Business default seed | HR defaults, ATT defaults, LEAVE defaults, NOTI/DASH defaults |
| Bootstrap admin | Quy trình tạo tài khoản quản trị đầu tiên |
| Verification | Checklist kiểm tra migration/seed |

### 4.2 Không bao gồm

1. SQL đầy đủ cho từng field của tất cả bảng.
2. Logic service nghiệp vụ như approve leave, check-in, assign task.
3. Import dữ liệu thật từ hệ thống cũ.
4. Data warehouse/BI nâng cao.
5. Database design chi tiết cho module Phase 2+.
6. CI/CD hạ tầng chi tiết.

---

## 5. Nguyên tắc migration tổng thể

### 5.1 Migration phải chạy được từ database trống

Một database trống sau khi chạy migration + seed phải có thể dùng để test MVP:

```text
create database -> run migration -> run seed -> create/bootstrap admin -> login -> test modules
```

Kết quả tối thiểu:

1. Có toàn bộ bảng MVP.
2. Có constraint và FK hợp lệ.
3. Có index quan trọng.
4. Có module catalog.
5. Có permission catalog.
6. Có role mặc định.
7. Có role-permission matrix.
8. Có company mặc định nếu triển khai single tenant.
9. Có system/company settings mặc định.
10. Có notification events/templates.
11. Có dashboard widgets/configs.
12. Có leave types, attendance defaults, sequence counters.

### 5.2 Migration phải deterministic

Cùng một source code migration chạy trên local, development, staging và production phải tạo cùng một cấu trúc database.

Không được:

```text
SELECT MAX(code) + 1 để sinh mã
Tạo constraint với tên ngẫu nhiên
Tự ý drop dữ liệu production
Tự ý update dữ liệu nhạy cảm hàng loạt
Dựa vào dữ liệu hiện có để đoán schema
```

Được phép dùng `gen_random_uuid()` cho primary key và seed nếu seed có business key ổn định để upsert.

### 5.3 Tách schema migration và seed migration

Khuyến nghị cấu trúc:

```text
migrations/schema
migrations/indexes
seeds/system
seeds/company
seeds/dev-only
```

Schema migration chỉ tạo/cập nhật cấu trúc. Seed migration tạo dữ liệu mặc định. Dev-only seed không được chạy ở production.

### 5.4 Tạo bảng trước, thêm FK vòng sau

Một số FK có vòng phụ thuộc:

| FK | Lý do |
| --- | --- |
| `companies.created_by -> users.id` | `companies` phải có trước `users` |
| `users.avatar_file_id -> files.id` | `users` và `files` phụ thuộc lẫn nhau |
| `files.uploaded_by -> users.id` | file actor là user |
| `departments.manager_employee_id -> employees.id` | departments và employees phụ thuộc nhau |
| `employees.direct_manager_id -> employees.id` | self-reference |

Cách xử lý:

1. Tạo cột nullable trước.
2. Tạo bảng chính trước.
3. Add FK vòng ở migration riêng sau khi tất cả bảng liên quan đã tồn tại.
4. Không dùng cascade delete cho dữ liệu nghiệp vụ quan trọng.

### 5.5 Seed phải idempotent

Seed có thể chạy nhiều lần mà không tạo dữ liệu trùng.

Business key seed:

| Dữ liệu | Business key |
| --- | --- |
| Module | `module_code` |
| Permission | `permission_code` |
| Global role | `role_code` |
| Company role | `company_id + role_code` |
| System setting | `setting_key` |
| Company setting | `company_id + setting_key` |
| Notification event | `company_id/global + event_code` |
| Notification template | `event_code + channel + locale + company_id/global` |
| Dashboard widget | `widget_code` |
| Leave type | `company_id + leave_type_code` |
| Sequence counter | `company_id + sequence_key` |

---

## 6. Quy ước đặt tên migration

### 6.1 Format đề xuất

```text
{version}_{module}_{action}_{target}.sql
```

Ví dụ:

```text
202606200001_foundation_enable_extensions.sql
202606200010_foundation_create_companies.sql
202606200020_auth_create_users.sql
202606200030_hr_create_employees.sql
202606200040_att_create_attendance_records.sql
202606200050_leave_create_leave_requests.sql
202606200060_task_create_projects_tasks.sql
202606200070_noti_dash_create_notifications_widgets.sql
202606200080_cross_module_add_foreign_keys.sql
202606200090_cross_module_add_indexes.sql
```

### 6.2 Quy ước thư mục

```text
migrations/
  schema/
  indexes/
  constraints/
  backfills/
seeds/
  system/
  tenant/
  dev-only/
```

### 6.3 Quy tắc version

| Thành phần | Ý nghĩa |
| --- | --- |
| `YYYYMMDD` | Ngày tạo migration |
| `NNNN` | Số thứ tự tăng dần |
| `module` | foundation/auth/hr/att/leave/task/noti_dash/cross_module |
| `action` | create/add/alter/backfill/index/seed |
| `target` | bảng hoặc nhóm bảng tác động |

---

## 7. Thứ tự migration tổng thể

### 7.1 Dependency graph

```text
PostgreSQL extensions
  -> Foundation base tables
    -> AUTH tables
      -> HR tables
        -> ATT tables
        -> LEAVE tables
        -> TASK tables
          -> NOTI/DASH tables
            -> Cross-module FKs
              -> Indexes
                -> Seed data
                  -> Bootstrap admin
```

### 7.2 Migration order MVP

| Bước | Nhóm | Nội dung | Phụ thuộc |
| --- | --- | --- | --- |
| M00 | Extension | `pgcrypto`, `pg_trgm`, `unaccent` | PostgreSQL |
| M01 | Foundation base | `companies`, `modules`, `system_settings`, `company_settings` | M00 |
| M02 | Foundation ops | `audit_logs`, `files`, `file_links`, `file_access_logs`, `sequence_counters`, `public_holidays`, `data_retention_policies`, `seed_batches`, `seed_items` | M01 |
| M03 | AUTH | `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, sessions, logs | M01-M02 |
| M04 | HR | departments, positions, job levels, contracts, employees, profile change, employee code configs | M03 |
| M05 | ATT | shifts, assignments, rules, attendance records/logs, adjustments, remote work | M04 |
| M06 | LEAVE | leave types, policies, balances, requests, days, approvals | M04-M05 |
| M07 | TASK | projects, members, tasks, assignees, comments, checklist, activity logs | M04 |
| M08 | NOTI/DASH | events, templates, notifications, delivery logs, widgets, configs, cache | M03-M07 |
| M09 | Cross-module FK | Add FK vòng và FK liên module | M01-M08 |
| M10 | Index | Apply indexes theo DB-09 | M01-M09 |
| S00 | Seed system | modules, settings, permissions | M10 |
| S01 | Seed tenant | default company, company settings, sequences | S00 |
| S02 | Seed RBAC | roles, role permissions, admin user | S01 |
| S03 | Seed business defaults | HR/ATT/LEAVE/NOTI/DASH defaults | S02 |
| V00 | Verification | smoke test, permission test, query test | S03 |

---

## 8. Migration batch chi tiết

## 8.1 M00 - Enable extensions

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Checklist:

- [ ] Local database hỗ trợ extension.
- [ ] Staging database hỗ trợ extension.
- [ ] Production đã bật hoặc DBA có quyền bật.
- [ ] Nếu không dùng search tiếng Việt giai đoạn đầu, `pg_trgm` và `unaccent` vẫn nên chuẩn bị nhưng có thể bật sau.

## 8.2 M01 - Foundation base

Tạo bảng:

```text
companies
modules
system_settings
company_settings
```

Checklist:

- [ ] `companies.company_code` unique active.
- [ ] `companies.timezone` bắt buộc.
- [ ] `modules.module_code` unique active.
- [ ] `system_settings.setting_key` unique active.
- [ ] `company_settings.company_id + setting_key` unique active.
- [ ] Các cột `created_by`, `updated_by` tạm nullable.

## 8.3 M02 - Foundation operation

Tạo bảng:

```text
audit_logs
files
file_links
file_access_logs
sequence_counters
public_holidays
data_retention_policies
seed_batches
seed_items
```

Checklist:

- [ ] `audit_logs` append-only, không soft delete.
- [ ] `files.visibility` mặc định `Private`.
- [ ] `file_links` dùng `module_code`, `entity_type`, `entity_id`.
- [ ] `sequence_counters.company_id + sequence_key` unique.
- [ ] `public_holidays.company_id` nullable để hỗ trợ holiday global.
- [ ] `seed_batches` và `seed_items` có checksum/version.

## 8.4 M03 - AUTH/RBAC

Tạo bảng:

```text
users
roles
permissions
user_roles
role_permissions
user_sessions
password_reset_tokens
login_logs
user_security_events
user_auth_providers
user_mfa_methods
```

Checklist:

- [ ] `users.company_id + normalized_email` unique active.
- [ ] `roles.company_id` nullable cho global role.
- [ ] `permissions.permission_code` unique.
- [ ] `role_permissions.data_scope` check constraint: Own/Team/Department/Project/Company/System.
- [ ] Session/reset token chỉ lưu hash.
- [ ] Login log có index theo company/time.

## 8.5 M04 - HR

Tạo bảng:

```text
departments
positions
job_levels
contract_types
employees
employee_contracts
employee_status_histories
employee_files
profile_change_requests
profile_change_request_items
employee_code_configs
```

Checklist:

- [ ] Tạo master data trước employee.
- [ ] `employees.company_id + employee_code` unique active.
- [ ] `employees.user_id` unique active nếu not null.
- [ ] `employees.direct_manager_id` self-reference.
- [ ] `departments.manager_employee_id` add FK sau.
- [ ] Profile change request có status Draft/Pending/Approved/Rejected/Cancelled.

## 8.6 M05 - ATT

Tạo bảng:

```text
shifts
shift_assignments
attendance_rules
attendance_records
attendance_logs
attendance_adjustment_requests
attendance_adjustment_items
remote_work_requests
remote_work_request_approvals
```

Checklist:

- [ ] `shifts.company_id + shift_code` unique active.
- [ ] `shift_assignments` hỗ trợ scope Company/Department/Employee.
- [ ] `attendance_rules` hỗ trợ rule theo company/department/employee.
- [ ] `attendance_records.employee_id` FK employees.
- [ ] Unique logic: employee + work_date + shift.
- [ ] `attendance_logs` lưu log thô, có server time và client metadata.
- [ ] Adjustment/remote request có status machine rõ ràng.

## 8.7 M06 - LEAVE

Tạo bảng:

```text
leave_types
leave_policies
leave_balances
leave_balance_transactions
leave_requests
leave_request_days
leave_request_approvals
```

Checklist:

- [ ] `leave_types.company_id + leave_type_code` unique active.
- [ ] `leave_balances.company_id + employee_id + leave_type_id + balance_year` unique active.
- [ ] `leave_requests.leave_request_code` unique active theo company.
- [ ] `leave_request_days` phục vụ lịch nghỉ và đồng bộ ATT.
- [ ] `leave_balance_transactions` là ledger, không bỏ qua khi đổi số dư.
- [ ] Status: Draft/Pending/Approved/Rejected/Cancelled/Revoked.

## 8.8 M07 - TASK

Tạo bảng:

```text
projects
project_members
project_files
tasks
task_assignees
task_watchers
task_comments
task_comment_mentions
task_checklists
task_checklist_items
task_files
task_activity_logs
```

Checklist:

- [ ] `projects.company_id + project_code` unique active.
- [ ] `tasks.company_id + task_code` unique active.
- [ ] `project_members.project_id + employee_id` unique active.
- [ ] `tasks.main_assignee_employee_id` dùng để query nhanh.
- [ ] `task_assignees` vẫn giữ để mở rộng nhiều assignee.
- [ ] `task_activity_logs` lưu ledger nghiệp vụ.

## 8.9 M08 - NOTI/DASH

Tạo bảng:

```text
notification_events
notification_templates
notifications
notification_delivery_logs
notification_preferences
dashboard_widgets
dashboard_widget_configs
dashboard_widget_cache
dashboard_user_widget_states
dashboard_cache_invalidations
```

Checklist:

- [ ] Notification event có global/company override.
- [ ] Notification template có channel/locale.
- [ ] Một dòng notification tương ứng một recipient.
- [ ] Có `dedupe_key` để chống trùng.
- [ ] Dashboard chỉ lưu catalog/config/cache, không lưu dữ liệu nghiệp vụ gốc.
- [ ] Cache có TTL, generated_at, expires_at, status.

## 8.10 M09 - Cross-module foreign keys

FK thêm sau:

```text
companies.created_by -> users.id
companies.logo_file_id -> files.id
users.avatar_file_id -> files.id
files.uploaded_by -> users.id
departments.manager_employee_id -> employees.id
employees.user_id -> users.id
employees.direct_manager_id -> employees.id
employee_files.file_id -> files.id
project_files.file_id -> files.id
task_files.file_id -> files.id
```

Rule:

1. FK nghiệp vụ chính dùng `ON DELETE RESTRICT`.
2. FK audit actor có thể nullable hoặc `ON DELETE SET NULL` nếu cần.
3. Không cascade delete employee, user, attendance, leave, task.
4. Dữ liệu nghiệp vụ dùng soft delete.

## 8.11 M10 - Index migration

Áp dụng index theo DB-09:

1. Index bắt đầu bằng `company_id` cho bảng tenant-specific.
2. Partial index cho dữ liệu active `WHERE deleted_at IS NULL`.
3. Unique business key theo company.
4. Index FK thường join/filter.
5. Index notification unread count.
6. Index attendance theo employee/date.
7. Index leave request pending/approved day.
8. Index task theo assignee/status/due.
9. Index audit/log theo time.
10. Index search bằng trigram nếu cần.

---

## 9. Seed strategy

### 9.1 Seed layers

| Layer | Tên | Nội dung |
| --- | --- | --- |
| S00 | System seed | Modules, system settings, permissions global |
| S01 | Tenant seed | Default company, company settings, sequence counters |
| S02 | RBAC seed | Roles, role permissions, bootstrap admin |
| S03 | HR seed | Job levels, contract types, employee code config |
| S04 | ATT seed | Shifts, attendance rules, shift assignment mặc định |
| S05 | LEAVE seed | Leave types, leave policy mặc định |
| S06 | TASK seed | Project/task sequences, task priority/status config nếu dùng lookup |
| S07 | NOTI seed | Notification events và templates |
| S08 | DASH seed | Dashboard widgets và widget configs |
| S09 | Dev-only seed | Sample employees/tasks/leaves cho local, không chạy production |

> **CHỐT 2026-07-02 (code thắng — nơi chạy seed):** seed **company-scoped** (S01/S03-S08: sequence counters, HR job levels/contract types, ATT shifts/rules, LEAVE types…) triển khai chạy ở **RUNTIME** qua `MasterDataSeedRunner.reconcileAllCompanies()` (S3-FND-SEEDRUN-1) — enumerate mọi company chưa xoá × mỗi seeder module `register()` lúc `onModuleInit`, mỗi (company, seeder) một `seed_batches` idempotent (uq company+seed_key+version) trong `withTenant`. KHÔNG bake vào migration SQL (migration không có `company_id` runtime). CHỈ seed **global/catalog** (S00: modules/permissions/system_settings — mig 0435; S02 canonical roles+perms — mig 0444) nằm trong migration. Lý do: seed theo tenant phải chạy sau khi company tồn tại + qua RLS `withTenant`.

### 9.2 Seed tracking

Mỗi lần chạy seed cần ghi:

```text
seed_batches
seed_items
```

Thông tin nên lưu:

1. `batch_key`.
2. `seed_key`.
3. `seed_version`.
4. `checksum`.
5. `status`: Pending/Running/Success/Failed/Skipped/RolledBack. <!-- CHỐT 2026-07-02 (doc-fix, khớp DB-08 §8.12 + code seed-tracking.ts): trước ghi 'Applied' là DRIFT — enum thật là 'Success' (Pending→Running→Success/Failed/Skipped/RolledBack). -->
6. `applied_at`.
7. `environment`.
8. `error_message` nếu lỗi.

### 9.3 Không hardcode secret trong seed

Không hardcode:

1. Mật khẩu admin production.
2. SMTP password.
3. Storage access key.
4. OAuth secret.
5. Token API bên thứ ba.
6. Dữ liệu nhân viên thật.

Secret phải lấy từ environment variable hoặc secret manager.

---

## 10. Seed modules

### 10.1 Module MVP active

| Module code | Tên module | Group | Core | MVP | Active | Sort |
| --- | --- | --- | --- | --- | --- | --- |
| AUTH | Tài khoản & phân quyền | Core | true | true | true | 10 |
| HR | Quản lý nhân sự | Core | true | true | true | 20 |
| ATT | Chấm công | Operation | false | true | true | 30 |
| LEAVE | Nghỉ phép | Operation | false | true | true | 40 |
| TASK | Công việc & Dự án | Collaboration | false | true | true | 50 |
| DASH | Dashboard | Experience | false | true | true | 60 |
| NOTI | Thông báo hệ thống | Experience | false | true | true | 70 |

### 10.2 Module phase sau inactive

| Module code | Tên module | Phase | Active |
| --- | --- | --- | --- |
| PAYROLL | Tiền lương | Phase 2 | false |
| RECRUIT | Tuyển dụng | Phase 2 | false |
| ASSET | Quản lý tài sản | Phase 3 | false |
| ROOM | Quản lý phòng họp | Phase 3 | false |
| CHAT | Chat nội bộ | Phase 4 | false |
| SOCIAL | Mạng xã hội nội bộ | Phase 4 | false |
| MOBILE | Mobile app | Phase 5 | false |
| AI | AI & tích hợp nâng cao | Phase 5 | false |

---

## 11. Seed settings

### 11.1 System settings mặc định

| Setting key | Module | Category | Giá trị đề xuất | Public | Sensitive |
| --- | --- | --- | --- | --- | --- |
| `system.default_timezone` | SYSTEM | General | `Asia/Ho_Chi_Minh` | true | false |
| `system.default_locale` | SYSTEM | General | `vi-VN` | true | false |
| `system.default_currency` | SYSTEM | General | `VND` | true | false |
| `security.password_min_length` | AUTH | Security | `8` | false | false |
| `security.password_require_uppercase` | AUTH | Security | `true` | false | false |
| `security.password_require_number` | AUTH | Security | `true` | false | false |
| `security.session_ttl_minutes` | AUTH | Security | `1440` | false | false |
| `security.refresh_token_ttl_days` | AUTH | Security | `30` | false | false |
| `file.max_upload_size_mb` | FOUNDATION | File | `20` | true | false |
| `file.default_visibility` | FOUNDATION | File | `Private` | false | false |
| `audit.default_retention_days` | FOUNDATION | Audit | `365` | false | false |
| `notification.in_app_enabled` | NOTI | Notification | `true` | true | false |
| `notification.email_enabled` | NOTI | Notification | `false` | false | false |
| `dashboard.cache_default_ttl_seconds` | DASH | Dashboard | `300` | false | false |

> **CHỐT 2026-07-03 (code thắng — WO S2-FND-SEED-4, mig `0470`):** 2 giá trị lệch giữ theo CODE đang chạy, **KHÔNG đổi giá trị runtime**: `file.max_upload_size_mb` = **`25`** (không `20`) vì seed `0435` + fallback `SETTING_DEFAULTS` đã dùng 25MB trên môi trường đang chạy, hạ về 20 = đổi hành vi upload không cần thiết; `system.default_locale` = **`vi`** (không `vi-VN`) vì `companies.language` CHECK `IN ('vi','en')` (mig `0015`) chỉ nhận mã 2 ký tự và `react-i18next` dùng `'vi'`, `'vi-VN'` sẽ vi phạm CHECK khi đồng bộ `company.language`. Bảng trên giữ nguyên GIÁ TRỊ ĐỀ XUẤT gốc để tham chiếu; runtime canonical = code. 10 key còn thiếu (`system.default_currency`, `security.*` ×5, `file.default_visibility`, `notification.*` ×2, `dashboard.cache_default_ttl_seconds`) seed đúng §11.1 ở mig `0470` (idempotent `ON CONFLICT (setting_key) WHERE status='Active' DO NOTHING`). `file.allowed_mime_types` là key DÔI (ngoài 14-key §11.1, seed `0435`) — giữ, KHÔNG xoá.

### 11.2 Company settings mặc định

| Setting key | Module | Giá trị đề xuất |
| --- | --- | --- |
| `company.timezone` | SYSTEM | `Asia/Ho_Chi_Minh` |
| `company.locale` | SYSTEM | `vi-VN` |
| `company.currency` | SYSTEM | `VND` |
| `attendance.default_shift_code` | ATT | `OFFICE_8H` |
| `attendance.allow_web_checkin` | ATT | `true` |
| `attendance.allow_mobile_checkin` | ATT | `true` |
| `attendance.block_checkin_when_leave_approved` | ATT | `true` |
| `leave.allow_negative_balance` | LEAVE | `false` |
| `leave.default_annual_leave_days` | LEAVE | `12` |
| `task.allow_personal_task` | TASK | `true` |
| `notification.in_app_enabled` | NOTI | `true` |
| `dashboard.cache_enabled` | DASH | `true` |

---

## 12. Seed permissions

### 12.1 AUTH permissions

| Permission code | Mô tả |
| --- | --- |
| `AUTH.LOGIN.ACCESS` | Đăng nhập hệ thống |
| `AUTH.PROFILE.VIEW` | Xem hồ sơ tài khoản cá nhân |
| `AUTH.PROFILE.UPDATE` | Cập nhật hồ sơ tài khoản cá nhân |
| `AUTH.PASSWORD.CHANGE` | Đổi mật khẩu cá nhân |
| `AUTH.USER.VIEW` | Xem danh sách user |
| `AUTH.USER.CREATE` | Tạo user |
| `AUTH.USER.UPDATE` | Cập nhật user |
| `AUTH.USER.LOCK` | Khóa user |
| `AUTH.USER.UNLOCK` | Mở khóa user |
| `AUTH.USER.ASSIGN_ROLE` | Gán role cho user |
| `AUTH.ROLE.VIEW` | Xem role |
| `AUTH.ROLE.CREATE` | Tạo role |
| `AUTH.ROLE.UPDATE` | Cập nhật role |
| `AUTH.ROLE.DELETE` | Xóa/vô hiệu hóa role |
| `AUTH.PERMISSION.VIEW` | Xem permission |
| `AUTH.PERMISSION.ASSIGN` | Gán permission cho role |
| `AUTH.AUDIT_LOG.VIEW` | Xem audit log AUTH |

### 12.2 HR permissions

| Permission code | Mô tả |
| --- | --- |
| `HR.EMPLOYEE.VIEW` | Xem hồ sơ nhân viên |
| `HR.EMPLOYEE.VIEW_SENSITIVE` | Xem dữ liệu nhạy cảm |
| `HR.EMPLOYEE.CREATE` | Tạo nhân viên |
| `HR.EMPLOYEE.UPDATE` | Cập nhật nhân viên |
| `HR.EMPLOYEE.CHANGE_STATUS` | Đổi trạng thái nhân viên |
| `HR.EMPLOYEE.DELETE` | Xóa mềm nhân viên |
| `HR.EMPLOYEE.EXPORT` | Xuất danh sách nhân viên |
| `HR.EMPLOYEE.FILE_VIEW` | Xem file hồ sơ |
| `HR.EMPLOYEE.FILE_UPLOAD` | Upload file hồ sơ |
| `HR.EMPLOYEE.FILE_DELETE` | Xóa file hồ sơ |
| `HR.DEPARTMENT.MANAGE` | Quản lý phòng ban |
| `HR.POSITION.MANAGE` | Quản lý chức vụ |
| `HR.CONTRACT.MANAGE` | Quản lý hợp đồng |
| `HR.PROFILE_CHANGE_REQUEST.CREATE` | Employee gửi yêu cầu cập nhật hồ sơ |
| `HR.PROFILE_CHANGE_REQUEST.VIEW_OWN` | Xem yêu cầu của chính mình |
| `HR.PROFILE_CHANGE_REQUEST.VIEW` | HR/Admin xem yêu cầu |
| `HR.PROFILE_CHANGE_REQUEST.APPROVE` | Duyệt yêu cầu cập nhật hồ sơ |
| `HR.PROFILE_CHANGE_REQUEST.REJECT` | Từ chối yêu cầu cập nhật hồ sơ |
| `HR.EMPLOYEE_CODE_CONFIG.VIEW` | Xem cấu hình mã nhân viên |
| `HR.EMPLOYEE_CODE_CONFIG.UPDATE` | Cập nhật cấu hình mã nhân viên |
| `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` | Sửa mã nhân viên thủ công nếu cấu hình cho phép |

### 12.3 ATT permissions

| Permission code | Mô tả |
| --- | --- |
| `ATT.ATTENDANCE.CHECK_IN` | Check-in |
| `ATT.ATTENDANCE.CHECK_OUT` | Check-out |
| `ATT.ATTENDANCE.VIEW` | Xem bảng công |
| `ATT.ATTENDANCE.VIEW_DETAIL` | Xem chi tiết ngày công |
| `ATT.ATTENDANCE.ADJUST` | HR/Admin điều chỉnh công trực tiếp |
| `ATT.ADJUSTMENT.CREATE` | Employee gửi yêu cầu điều chỉnh công |
| `ATT.ADJUSTMENT.VIEW` | Xem yêu cầu điều chỉnh công |
| `ATT.ADJUSTMENT.APPROVE` | Duyệt điều chỉnh công |
| `ATT.ADJUSTMENT.REJECT` | Từ chối điều chỉnh công |
| `ATT.SHIFT.MANAGE` | Quản lý ca làm |
| `ATT.RULE.MANAGE` | Quản lý rule chấm công |
| `ATT.REMOTE_REQUEST.CREATE` | Tạo request remote/công tác |
| `ATT.REMOTE_REQUEST.APPROVE` | Duyệt remote/công tác |
| `ATT.REMOTE_REQUEST.REJECT` | Từ chối remote/công tác |
| `ATT.EXPORT` | Xuất bảng công |

### 12.4 LEAVE permissions

| Permission code | Mô tả |
| --- | --- |
| `LEAVE.BALANCE.VIEW` | Xem số dư phép |
| `LEAVE.REQUEST.CREATE` | Tạo đơn nghỉ |
| `LEAVE.REQUEST.VIEW` | Xem đơn nghỉ |
| `LEAVE.REQUEST.UPDATE` | Cập nhật đơn nghỉ draft |
| `LEAVE.REQUEST.CANCEL` | Hủy đơn nghỉ |
| `LEAVE.REQUEST.APPROVE` | Duyệt đơn nghỉ |
| `LEAVE.REQUEST.REJECT` | Từ chối đơn nghỉ |
| `LEAVE.REQUEST.REVOKE` | Thu hồi đơn nghỉ đã duyệt |
| `LEAVE.TYPE.MANAGE` | Quản lý loại nghỉ |
| `LEAVE.POLICY.MANAGE` | Quản lý chính sách nghỉ |
| `LEAVE.BALANCE.ADJUST` | Điều chỉnh số dư phép |
| `LEAVE.CALENDAR.VIEW` | Xem lịch nghỉ |
| `LEAVE.EXPORT` | Xuất dữ liệu nghỉ phép |

### 12.5 TASK permissions

| Permission code | Mô tả |
| --- | --- |
| `TASK.PROJECT.VIEW` | Xem dự án |
| `TASK.PROJECT.CREATE` | Tạo dự án |
| `TASK.PROJECT.UPDATE` | Cập nhật dự án |
| `TASK.PROJECT.DELETE` | Xóa/đóng dự án |
| `TASK.PROJECT.MEMBER_MANAGE` | Quản lý thành viên dự án |
| `TASK.TASK.VIEW` | Xem task |
| `TASK.TASK.CREATE` | Tạo task |
| `TASK.TASK.UPDATE` | Cập nhật task |
| `TASK.TASK.ASSIGN` | Giao task |
| `TASK.TASK.UPDATE_STATUS` | Cập nhật trạng thái task |
| `TASK.COMMENT.CREATE` | Bình luận task |
| `TASK.FILE.UPLOAD` | Upload file task/project |
| `TASK.CHECKLIST.MANAGE` | Quản lý checklist |
| `TASK.REPORT.VIEW` | Xem báo cáo tiến độ |

### 12.6 NOTI/DASH permissions

| Permission code | Mô tả |
| --- | --- |
| `NOTI.NOTIFICATION.VIEW` | Xem thông báo của mình |
| `NOTI.NOTIFICATION.READ` | Đánh dấu đã đọc |
| `NOTI.NOTIFICATION.DELETE` | Ẩn/xóa thông báo khỏi danh sách |
| `NOTI.TEMPLATE.MANAGE` | Quản lý template thông báo |
| `DASH.DASHBOARD.VIEW` | Xem dashboard (gồm route widget-catalog) |
| `DASH.WIDGET.CONFIGURE` | Cấu hình widget |

> **Bỏ permission chung `DASH.WIDGET.VIEW`** khỏi seed: route widget-catalog gate bằng `DASH.DASHBOARD.VIEW`; widget nhạy cảm gate thêm bằng `DASH.WIDGET.VIEW_<WIDGET>` (per-widget, xem [API-10 Matrix §5.7](<../API Design/API-10 PERMISSION MATRIX.md>)). ATT check-in/out dùng `ATT.ATTENDANCE.CHECK_IN`/`ATT.ATTENDANCE.CHECK_OUT` (§12.3), **không** dùng `ATT.CHECK_IN.CREATE`.

### 12.7 FOUNDATION permissions

> Catalog chuẩn = [BACKEND-11 §8.1](<../BACKEND/BACKEND-11_File_Audit_Settings_System_Jobs.md>). Bỏ tiền tố `SYSTEM.*`. Company tách `VIEW`/`UPDATE`. Settings dùng `VIEW`/`UPDATE`/`SYSTEM_MANAGE`. Audit dùng `FOUNDATION.AUDIT_LOG.*`.

| Permission code | Mô tả |
| --- | --- |
| `FOUNDATION.COMPANY.VIEW` | Xem thông tin công ty |
| `FOUNDATION.COMPANY.UPDATE` | Cập nhật thông tin công ty |
| `FOUNDATION.MODULE.VIEW` | Xem danh mục module |
| `FOUNDATION.MODULE.UPDATE` | Bật/tắt/cập nhật module |
| `FOUNDATION.SETTING.VIEW` | Xem setting (company + resolve) |
| `FOUNDATION.SETTING.UPDATE` | Cập nhật company setting |
| `FOUNDATION.SETTING.SYSTEM_MANAGE` | Xem + sửa system setting (System scope) |
| `FOUNDATION.AUDIT_LOG.VIEW` | Xem audit log |
| `FOUNDATION.AUDIT_LOG.EXPORT` | Xuất audit log |
| `FOUNDATION.FILE.UPLOAD` | Upload file |
| `FOUNDATION.FILE.VIEW` | Xem metadata file |
| `FOUNDATION.FILE.DOWNLOAD` | Tải file |
| `FOUNDATION.FILE.DELETE` | Xóa file |
| `FOUNDATION.FILE.LINK` | Liên kết file với entity |
| `FOUNDATION.FILE.UNLINK` | Gỡ liên kết file |
| `FOUNDATION.SEQUENCE.VIEW` | Xem cấu hình sinh mã |
| `FOUNDATION.SEQUENCE.UPDATE` | Cập nhật cấu hình sinh mã |
| `FOUNDATION.HOLIDAY.VIEW` | Xem ngày nghỉ lễ |
| `FOUNDATION.HOLIDAY.MANAGE` | Quản lý ngày nghỉ lễ |
| `FOUNDATION.RETENTION.VIEW` | Xem chính sách retention |
| `FOUNDATION.RETENTION.MANAGE` | Quản lý chính sách retention |
| `FOUNDATION.JOB.VIEW` | Xem system job + lịch sử chạy |
| `FOUNDATION.JOB.RUN` | Chạy system job thủ công (System scope) |
| `FOUNDATION.SEED.VIEW` | Xem batch/item seed |
| `FOUNDATION.SEED.RUN` | Chạy seed (internal/System scope) |

---

## 13. Seed roles và role-permission matrix

### 13.1 Roles mặc định

| Role code | Tên | Type | Company scope | Mô tả |
| --- | --- | --- | --- | --- |
| `SUPER_ADMIN` | Super Admin | System | NULL | Toàn quyền toàn hệ thống |
| `COMPANY_ADMIN` | Admin công ty | Company | company_id | Quản trị hệ thống trong công ty |
| `HR` | HR | Company | company_id | Quản lý nhân sự, công, nghỉ phép |
| `MANAGER` | Manager | Company | company_id | Quản lý team, duyệt đơn, giao task |
| `EMPLOYEE` | Employee | Company | company_id | Nhân viên sử dụng hệ thống hằng ngày |
| `PROJECT_MANAGER` | Project Manager | Company | company_id | Quản lý dự án được phân công |
| `PAYROLL_OFFICER` | Payroll Officer | Company | company_id | Phase 2, xem dữ liệu tính lương |

### 13.2 Scope chuẩn

| Scope | Ý nghĩa |
| --- | --- |
| Own | Dữ liệu của chính user/employee |
| Team | Dữ liệu nhân viên trực thuộc quản lý trực tiếp |
| Department | Dữ liệu thuộc phòng ban |
| Project | Dữ liệu thuộc project mà user tham gia/quản lý |
| Company | Dữ liệu toàn công ty |
| System | Dữ liệu toàn hệ thống |

### 13.3 Matrix role tổng quan

| Permission group | Super Admin | Company Admin | HR | Manager | Employee | Project Manager |
| --- | --- | --- | --- | --- | --- | --- |
| AUTH user/role | System | Company | Không mặc định | Không | Own profile | Không |
| HR employee | System | Company | Company | Team/Department | Own | Project-related limited |
| HR sensitive | System | Company nếu cấp | Company nếu cấp | Không mặc định | Không | Không |
| ATT attendance | System | Company | Company | Team | Own | Own |
| ATT adjustment approve | System | Company | Company | Team | Không | Không |
| LEAVE request | System | Company | Company | Team approve | Own create/view | Own |
| TASK project/task | System | Company | Company nếu cấp | Team/Project | Own/Assigned | Project |
| NOTI | System | Own/Admin | Own | Own | Own | Own |
| DASH | System | Company dashboard | HR dashboard | Manager dashboard | Employee dashboard | Project dashboard |
| Settings/Audit | System | Company | Hạn chế | Không | Không | Không |

### 13.4 Seed role permissions khuyến nghị

| Role | Permission pattern | Scope |
| --- | --- | --- |
| SUPER_ADMIN | `*` hoặc tất cả permissions | System |
| COMPANY_ADMIN | AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI, FOUNDATION trong company | Company |
| HR | HR full, ATT view/adjust, LEAVE manage, DASH HR, NOTI own | Company |
| MANAGER | HR view team, ATT view/approve team, LEAVE approve team, TASK team/project, DASH manager | Team/Project |
| EMPLOYEE | AUTH profile, HR own, ATT own, LEAVE own, TASK assigned, NOTI own, DASH own | Own |
| PROJECT_MANAGER | TASK project manage, TASK report project, NOTI own, DASH project | Project |
| PAYROLL_OFFICER | HR limited, ATT view, LEAVE view, PAYROLL phase sau | Company |

---

## 14. Seed business defaults

## 14.1 HR defaults

### Job levels

| Code | Name | Sort |
| --- | --- | --- |
| INTERN | Intern | 10 |
| FRESHER | Fresher | 20 |
| JUNIOR | Junior | 30 |
| MIDDLE | Middle | 40 |
| SENIOR | Senior | 50 |
| LEAD | Lead | 60 |
| MANAGER | Manager | 70 |
| DIRECTOR | Director | 80 |

### Contract types

| Code | Name |
| --- | --- |
| PROBATION | Hợp đồng thử việc |
| DEFINITE_TERM | Hợp đồng xác định thời hạn |
| INDEFINITE_TERM | Hợp đồng không xác định thời hạn |
| SERVICE | Hợp đồng dịch vụ/cộng tác |
| INTERN | Thực tập |

### Employee code config

| Field | Giá trị đề xuất |
| --- | --- |
| `sequence_key` | `EMPLOYEE_CODE` |
| `prefix` | `EMP` |
| `padding_length` | 4 |
| `format_template` | `{PREFIX}{NUMBER}` |
| `reset_policy` | `Never` |
| `allow_manual_override` | `false` |

## 14.2 ATT defaults

### Shift mặc định

| Field | Giá trị |
| --- | --- |
| `shift_code` | `OFFICE_8H` |
| `name` | Ca hành chính 8 giờ |
| `start_time` | `08:00` |
| `end_time` | `17:00` |
| `break_start_time` | `12:00` |
| `break_end_time` | `13:00` |
| `required_working_minutes` | `480` |
| `is_flexible` | `false` |

### Attendance rule mặc định

| Field | Giá trị |
| --- | --- |
| `rule_code` | `DEFAULT_OFFICE_RULE` |
| `allow_web_checkin` | true |
| `allow_mobile_checkin` | true |
| `late_grace_minutes` | 5 |
| `early_leave_grace_minutes` | 5 |
| `require_checkout` | true |
| `block_when_leave_approved` | true |
| `allow_remote_checkin` | true nếu có remote request approved |
| `auto_attendance_enabled` | false mặc định |

### Sequence ATT

| Sequence key | Prefix | Format |
| --- | --- | --- |
| `ATT_ADJUSTMENT_REQUEST_CODE` | `AR` | `AR{YYYY}{NUMBER}` |
| `REMOTE_WORK_REQUEST_CODE` | `RW` | `RW{YYYY}{NUMBER}` |

## 14.3 LEAVE defaults

> **CHỐT 2026-07-04 (S3-LEAVE-SEED-2, code thắng):** giữ mã **NGẮN** `ANNUAL/SICK/UNPAID/OTHER` + 4 mã ngắn mới `MATERNITY/MARRIAGE/BEREAVEMENT/COMPENSATORY` thay hậu tố `_LEAVE` (bản nháp cũ) — vì `leave_requests.leave_type_id` đã tham chiếu mã ngắn ở môi trường đang chạy; đổi sang mã dài cần 1 migration DATA riêng (KHÔNG làm ở lane này). Nguồn sự thật mã = `packages/contracts` (`LEAVE_TYPE_CODES` — 8 mã) → seeder `apps/api/src/leave/leave-master-data.seeder.ts` import từ đó, KHÔNG hard-code. Ngoài ra **`ANNUAL.allow_hourly = false`** (code thắng bảng policy `allow_hourly=true` dưới đây — nghỉ phép năm KHÔNG cho theo giờ ở mặc định); nếu owner lật, int-spec `leave-master-data-seeder.int.spec.ts` là điểm assert phải cập nhật đo được.

### Leave types

Mã ngắn (code-wins); thuộc tính `deduct/paid/attachment` là bất biến CHỐT do seeder ép (S3-LEAVE-SEED-2). `sortOrder` 1–8, `is_system_default=true`.

| Code | Name | Deduct balance | Paid | Requires attachment |
| --- | --- | --- | --- | --- |
| `ANNUAL` | Nghỉ phép năm | true | true | false |
| `SICK` | Nghỉ ốm | true hoặc theo policy | true | true tùy cấu hình |
| `UNPAID` | Nghỉ không lương | false | false | false |
| `OTHER` | Khác | theo cấu hình | theo cấu hình | false |
| `MATERNITY` | Nghỉ thai sản | false | true | true |
| `MARRIAGE` | Nghỉ kết hôn | false | true | true |
| `BEREAVEMENT` | Nghỉ tang | false | true | false |
| `COMPENSATORY` | Nghỉ bù | true | true | false |

### Leave policy mặc định

Chỉ seed **DEFAULT_ANNUAL** (loại `ANNUAL`) — KHÔNG seed default policy cho loại mới (thai sản/nghỉ bù có workflow riêng, Phase sau — SPEC-05 §245/§297-300).

| Field | Giá trị |
| --- | --- |
| `policy_code` | `DEFAULT_ANNUAL` |
| `scope_type` | `Company` |
| `annual_days` | 12 |
| `allow_half_day` | true |
| `allow_hourly` | true _(bản nháp — loại `ANNUAL` CHỐT `allow_hourly=false`, xem CHỐT ở đầu §14.3)_ |
| `allow_negative_balance` | false |
| `exclude_weekends` | true |
| `exclude_public_holidays` | true |
| `approval_flow` | Direct Manager -> HR optional |

### Sequence LEAVE

| Sequence key | Prefix | Format |
| --- | --- | --- |
| `LEAVE_REQUEST_CODE` | `LV` | `LV{YYYY}{NUMBER}` |
| `LEAVE_BALANCE_ADJUSTMENT_CODE` | `LBA` | `LBA{YYYY}{NUMBER}` |

## 14.4 TASK defaults

| Sequence key | Prefix | Format |
| --- | --- | --- |
| `PROJECT_CODE` | `PRJ` | `PRJ{YYYY}{NUMBER}` |
| `TASK_CODE` | `TSK` | `TSK{YYYY}{NUMBER}` |

Task status mặc định nếu dùng lookup/config:

```text
Todo
In Progress
In Review
Done
Cancelled
```

Task priority mặc định:

```text
Low
Medium
High
Urgent
```

---

## 15. Seed notification events và templates

### 15.1 Notification events MVP

| Event code | Source module | Trigger |
| --- | --- | --- |
| `USER_CREATED` | AUTH | Tạo user mới |
| `USER_LOCKED` | AUTH | Khóa tài khoản |
| `PASSWORD_RESET_REQUESTED` | AUTH | Yêu cầu reset mật khẩu |
| `EMPLOYEE_CREATED` | HR | Tạo nhân viên mới |
| `HR_PROFILE_CHANGE_SUBMITTED` | HR | Employee gửi yêu cầu cập nhật hồ sơ |
| `HR_PROFILE_CHANGE_APPROVED` | HR | HR duyệt yêu cầu cập nhật hồ sơ |
| `HR_PROFILE_CHANGE_REJECTED` | HR | HR từ chối yêu cầu cập nhật hồ sơ |
| `CONTRACT_EXPIRING_SOON` | HR | Hợp đồng sắp hết hạn |
| `ATT_MISSING_CHECKOUT` | ATT | Quên check-out |
| `ATT_ADJUSTMENT_SUBMITTED` | ATT | Gửi yêu cầu điều chỉnh công |
| `ATT_ADJUSTMENT_APPROVED` | ATT | Duyệt điều chỉnh công |
| `ATT_ADJUSTMENT_REJECTED` | ATT | Từ chối điều chỉnh công |
| `ATT_REMOTE_REQUEST_SUBMITTED` | ATT | Gửi request remote/công tác |
| `ATT_REMOTE_REQUEST_APPROVED` | ATT | Duyệt remote/công tác |
| `LEAVE_REQUEST_SUBMITTED` | LEAVE | Gửi đơn nghỉ |
| `LEAVE_REQUEST_APPROVED` | LEAVE | Duyệt đơn nghỉ |
| `LEAVE_REQUEST_REJECTED` | LEAVE | Từ chối đơn nghỉ |
| `LEAVE_REQUEST_CANCELLED` | LEAVE | Hủy đơn nghỉ |
| `TASK_ASSIGNED` | TASK | Giao task mới |
| `TASK_UPDATED` | TASK | Task được cập nhật |
| `TASK_COMMENTED` | TASK | Có comment mới |
| `TASK_MENTIONED` | TASK | User được mention |
| `TASK_DUE_SOON` | TASK | Task sắp đến hạn |
| `TASK_OVERDUE` | TASK | Task quá hạn |

### 15.2 Template mẫu

| Event code | Channel | Title template | Body template |
| --- | --- | --- | --- |
| `LEAVE_REQUEST_SUBMITTED` | IN_APP | `Có đơn nghỉ phép cần duyệt` | `{employee_name} đã gửi đơn nghỉ {leave_type_name}` |
| `LEAVE_REQUEST_APPROVED` | IN_APP | `Đơn nghỉ phép đã được duyệt` | `Đơn nghỉ {leave_request_code} của bạn đã được duyệt` |
| `ATT_ADJUSTMENT_SUBMITTED` | IN_APP | `Có yêu cầu điều chỉnh công` | `{employee_name} đã gửi yêu cầu điều chỉnh công ngày {work_date}` |
| `TASK_ASSIGNED` | IN_APP | `Bạn được giao task mới` | `Task {task_code}: {task_title}` |
| `TASK_DUE_SOON` | IN_APP | `Task sắp đến hạn` | `Task {task_code} sẽ đến hạn vào {due_at}` |
| `HR_PROFILE_CHANGE_SUBMITTED` | IN_APP | `Có yêu cầu cập nhật hồ sơ` | `{employee_name} đã gửi yêu cầu cập nhật hồ sơ cá nhân` |

Nguyên tắc template:

1. Không đưa dữ liệu nhạy cảm vào notification payload.
2. Payload chỉ nên chứa `target_module`, `target_type`, `target_id`, `target_url`, `display_code`.
3. Khi user bấm vào thông báo, module gốc phải kiểm tra permission trước khi trả chi tiết.

---

## 16. Seed dashboard widgets

### 16.1 Widget catalog MVP

| Widget code | Dashboard type | Source module | Permission | Cache TTL |
| --- | --- | --- | --- | --- |
| `EMPLOYEE_ATTENDANCE_TODAY` | Employee | ATT | `ATT.ATTENDANCE.VIEW` | 60s |
| `EMPLOYEE_MY_TASKS` | Employee | TASK | `TASK.TASK.VIEW` | 120s |
| `EMPLOYEE_LEAVE_BALANCE` | Employee | LEAVE | `LEAVE.BALANCE.VIEW` | 300s |
| `EMPLOYEE_NOTIFICATIONS` | Employee | NOTI | `NOTI.NOTIFICATION.VIEW` | 60s |
| `MANAGER_PENDING_LEAVES` | Manager | LEAVE | `LEAVE.REQUEST.APPROVE` | 120s |
| `MANAGER_TEAM_ATTENDANCE_ALERTS` | Manager | ATT | `ATT.ATTENDANCE.VIEW` | 120s |
| `MANAGER_TEAM_TASKS_OVERDUE` | Manager | TASK | `TASK.TASK.VIEW` | 120s |
| `HR_EMPLOYEE_OVERVIEW` | HR | HR | `HR.EMPLOYEE.VIEW` | 300s |
| `HR_CONTRACT_EXPIRING` | HR | HR | `HR.CONTRACT.MANAGE` | 300s |
| `HR_ATTENDANCE_ANOMALIES` | HR | ATT | `ATT.ATTENDANCE.VIEW` | 120s |
| `ADMIN_USER_OVERVIEW` | Admin | AUTH | `AUTH.USER.VIEW` | 300s |
| `ADMIN_SYSTEM_ALERTS` | Admin | FOUNDATION | `FOUNDATION.AUDIT_LOG.VIEW` | 300s |

### 16.2 Widget config mặc định theo role

| Role | Widget mặc định |
| --- | --- |
| EMPLOYEE | Attendance today, My tasks, Leave balance, Notifications |
| MANAGER | Pending leaves, Team attendance alerts, Team tasks overdue, Notifications |
| HR | Employee overview, Contract expiring, Attendance anomalies, Pending leaves |
| COMPANY_ADMIN | User overview, System alerts, Employee overview, Notifications |
| SUPER_ADMIN | System alerts, Tenant overview nếu có, Audit overview |

---

## 17. Bootstrap company và admin

## 17.1 Default company seed

Nếu MVP chạy single-company, seed một company mặc định:

| Field | Giá trị đề xuất |
| --- | --- |
| `company_code` | `DEFAULT` hoặc mã thật của công ty |
| `name` | `Default Company` hoặc tên công ty thật |
| `timezone` | `Asia/Ho_Chi_Minh` |
| `default_locale` | `vi-VN` |
| `currency_code` | `VND` |
| `status` | `Active` |

Nếu sản phẩm triển khai SaaS ngay từ đầu, không seed company mặc định trong production; thay vào đó dùng tenant onboarding flow.

## 17.2 Bootstrap admin user

Quy trình production khuyến nghị:

1. Seed role và permission trước.
2. Tạo company đầu tiên.
3. Tạo admin user bằng CLI hoặc onboarding flow bảo mật.
4. Mật khẩu tạm lấy từ secret/environment, không commit vào source code.
5. Bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên.
6. Ghi audit log `BOOTSTRAP_ADMIN_CREATED`.

Thông tin cần có:

```text
email
display_name
company_id
role_code = COMPANY_ADMIN hoặc SUPER_ADMIN
password_hash
must_change_password = true
status = Active
```

---

## 18. Rollback strategy

### 18.1 Local/development

Có thể rollback mạnh hơn:

```text
drop schema public cascade
create schema public
run migrations
run seeds
```

### 18.2 Staging

Rollback cần giữ dữ liệu test quan trọng nếu có:

1. Backup trước migration.
2. Chạy rollback migration nếu framework hỗ trợ.
3. Nếu migration đã đổi dữ liệu, dùng restore hoặc script rollback riêng.
4. Chạy verification sau rollback.

### 18.3 Production

Production không nên phụ thuộc rollback destructive.

Nguyên tắc:

1. Backup trước migration.
2. Migration phải backward-compatible nếu có thể.
3. Không drop column/table trong cùng release thêm column/table mới.
4. Dùng expand/contract migration.
5. Nếu lỗi nghiêm trọng, rollback application trước, database giữ trạng thái compatible.
6. Restore database chỉ dùng khi sự cố nghiêm trọng và có approval.

---

## 19. Verification sau migration/seed

### 19.1 Kiểm tra schema

- [ ] Tất cả bảng MVP tồn tại.
- [ ] Tất cả primary key là UUID.
- [ ] Bảng tenant-specific có `company_id`.
- [ ] Bảng quan trọng có audit columns.
- [ ] Bảng soft delete có `deleted_at`, `deleted_by`.
- [ ] FK quan trọng đã được tạo.
- [ ] Unique business key đã được tạo.
- [ ] Check constraint status đã được tạo.
- [ ] Index theo DB-09 đã được tạo.

### 19.2 Kiểm tra seed

- [ ] Có modules AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI active.
- [ ] Module phase sau inactive đã được seed.
- [ ] Có permissions cho toàn bộ MVP.
- [ ] Có roles mặc định.
- [ ] Role permissions đúng scope.
- [ ] Có company mặc định nếu môi trường cần.
- [ ] Có system/company settings.
- [ ] Có sequence counters.
- [ ] Có leave types mặc định.
- [ ] Có shift/rule attendance mặc định.
- [ ] Có notification events/templates.
- [ ] Có dashboard widgets/configs.
- [ ] `seed_batches` và `seed_items` ghi nhận thành công.

### 19.3 Smoke test nghiệp vụ

| Test | Kỳ vọng |
| --- | --- |
| Login admin | Thành công |
| Resolve permission admin | Có quyền theo role |
| Tạo employee | Sinh employee_code đúng rule |
| Employee gửi profile change request | Request Pending, hồ sơ chính chưa đổi |
| Check-in | Tạo attendance_record và attendance_log |
| Tạo leave request | Sinh leave_request_code, status Draft/Pending |
| Approve leave | Tạo leave_request_days và balance transaction |
| Tạo project/task | Sinh project_code/task_code |
| Assign task | Tạo task_assignee và notification |
| Dashboard employee | Trả widget đúng role/scope |
| Notification unread | Đếm đúng notification chưa đọc |

---

## 20. Test case DB-10

| Mã test | Nội dung | Kỳ vọng |
| --- | --- | --- |
| DB10-TC-001 | Chạy migration từ database trống | Thành công |
| DB10-TC-002 | Chạy seed lần đầu | Tạo đủ dữ liệu mặc định |
| DB10-TC-003 | Chạy seed lần hai | Không tạo trùng dữ liệu |
| DB10-TC-004 | Thiếu extension `pgcrypto` | Migration báo lỗi rõ hoặc tự tạo |
| DB10-TC-005 | Duplicate permission_code | Bị unique constraint chặn |
| DB10-TC-006 | Role permission scope sai | Bị check constraint chặn |
| DB10-TC-007 | Employee code sequence chạy đồng thời | Không trùng mã |
| DB10-TC-008 | Bootstrap admin thiếu password secret | Không tạo user, báo lỗi rõ |
| DB10-TC-009 | Company setting override | Ưu tiên company setting so với system setting |
| DB10-TC-010 | Notification template seed update | Cập nhật theo checksum/version |
| DB10-TC-011 | Dashboard widget seed update | Không tạo trùng widget_code |
| DB10-TC-012 | Rollback local | Có thể dựng lại database từ đầu |
| DB10-TC-013 | FK vòng add sau | Không lỗi phụ thuộc bảng |
| DB10-TC-014 | Dev-only seed ở production | Bị chặn |
| DB10-TC-015 | Query sau index | Query quan trọng dùng index hợp lý |

---

## 21. Rủi ro và hướng xử lý

| Rủi ro | Mức độ | Hướng xử lý |
| --- | --- | --- |
| Chạy sai thứ tự migration | Cao | Dùng version migration và CI kiểm tra từ DB trống |
| Seed permission thiếu | Cao | Quản lý permission bằng file seed versioned, test resolve permission |
| Seed chạy nhiều lần tạo trùng | Cao | Upsert theo business key, dùng seed_items/checksum |
| FK vòng gây lỗi | Trung bình | Tạo FK vòng ở batch riêng sau cùng |
| Production drop dữ liệu | Rất cao | Cấm destructive migration nếu chưa có approval/backfill plan |
| Bootstrap admin lộ mật khẩu | Rất cao | Dùng secret manager/env, bắt buộc đổi password lần đầu |
| Role scope sai làm lộ dữ liệu | Rất cao | Test matrix permission và data scope trước release |
| Index tạo chậm production | Trung bình | Dùng concurrent index nếu cần, chạy ngoài giờ thấp điểm |
| Seed dev chạy vào production | Cao | Tách dev-only seed và kiểm tra environment |
| Migration khác nhau giữa local/staging/prod | Cao | CI dựng DB từ trống và so schema |

---

## 22. Checklist triển khai DB-10

### 22.1 Trước khi chạy migration

- [ ] Backup database nếu không phải môi trường local.
- [ ] Kiểm tra biến môi trường database.
- [ ] Kiểm tra quyền tạo extension.
- [ ] Kiểm tra version PostgreSQL.
- [ ] Kiểm tra migration chưa bị chỉnh sửa sau khi đã deploy.
- [ ] Kiểm tra seed production không chứa dữ liệu mẫu.
- [ ] Kiểm tra secret bootstrap admin đã có.

### 22.2 Khi chạy migration

- [ ] Chạy migration theo đúng thứ tự.
- [ ] Ghi log migration output.
- [ ] Dừng ngay nếu có lỗi schema.
- [ ] Không chạy seed nếu migration chưa hoàn tất.
- [ ] Không bỏ qua failed migration bằng tay nếu chưa hiểu nguyên nhân.

### 22.3 Sau khi chạy migration

- [ ] Kiểm tra bảng tồn tại.
- [ ] Kiểm tra FK/constraint/index.
- [ ] Chạy seed system.
- [ ] Chạy seed tenant.
- [ ] Chạy seed RBAC.
- [ ] Chạy seed business defaults.
- [ ] Tạo/bootstrap admin.
- [ ] Chạy smoke test.
- [ ] Kiểm tra audit log bootstrap.
- [ ] Kiểm tra app login và dashboard.

---

## 23. Quyết định thiết kế đã chốt

1. DB-10 là tài liệu Migration Plan & Initial Seed Data, không phải module nghiệp vụ mới.
2. Migration chạy theo thứ tự Foundation -> AUTH -> HR -> ATT/LEAVE/TASK -> NOTI/DASH -> FK -> Index -> Seed.
3. Schema migration và seed data cần tách rõ.
4. Seed phải idempotent và theo dõi bằng `seed_batches`, `seed_items`.
5. Permission seed là dữ liệu nền tảng bắt buộc, phải đầy đủ cho AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI và Foundation.
6. Role-permission seed phải kèm `data_scope`.
7. Company mặc định chỉ seed khi môi trường cần single tenant hoặc local/dev.
8. Bootstrap admin không được hardcode mật khẩu trong source code.
9. FK vòng được add ở batch riêng sau khi bảng chính tồn tại.
10. Index được add sau schema chính và bám theo DB-09.
11. Dev-only seed phải tách khỏi production seed.
12. Production migration không được destructive nếu chưa có backup, approval và rollback plan.

---

## 24. Việc cần làm tiếp theo

Sau DB-10, nên triển khai tiếp một trong các hướng sau:

```text
DB-11: Phase 2+ Extension Database Design
```

DB-11 nên đi sâu vào:

1. PAYROLL database design.
2. RECRUIT database design.
3. ASSET database design.
4. ROOM database design.
5. CHAT/SOCIAL database design.
6. MOBILE device/push database design.
7. AI logs/suggestions/summaries database design.

Hoặc:

```text
API-01: API Design Tổng Quan
```

API-01 nên đi sâu vào:

1. API convention.
2. Auth middleware.
3. Permission/data scope middleware.
4. Error format.
5. Pagination/filter/search convention.
6. API module AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI.

---

## 25. Kết luận

DB-10 hoàn thiện kế hoạch dựng database MVP từ đầu theo hướng an toàn, có thứ tự và có thể lặp lại.

Các điểm quan trọng nhất:

1. Migration phải deterministic và chạy được từ database trống.
2. Foundation phải chạy trước để có tenant, module, settings, audit, file, sequence và seed tracking.
3. AUTH/RBAC phải chạy sớm để các module sau có user, role, permission và data scope.
4. HR là nguồn dữ liệu employee cho ATT, LEAVE, TASK, DASH và NOTI.
5. ATT, LEAVE, TASK cần migration độc lập nhưng liên kết qua employee, company và notification/dashboard.
6. NOTI/DASH chạy sau các module gốc vì phụ thuộc event/widget/permission.
7. FK vòng và index nên tách thành batch riêng.
8. Seed phải idempotent, có tracking, có checksum và không hardcode secret.
9. Role-permission matrix phải được test kỹ để tránh lộ dữ liệu.
10. Sau DB-10, hệ thống đã có đủ cơ sở để backend bắt đầu viết migration thật, seed service và pipeline dựng database MVP.
