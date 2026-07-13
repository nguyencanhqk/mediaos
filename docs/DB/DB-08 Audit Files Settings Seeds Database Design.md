> 🔒 **BẤT BIẾN DB (bổ sung bắt buộc):** Mọi bảng có `company_id` PHẢI bật **RLS + FORCE**; `audit_logs` **append-only** (REVOKE UPDATE/DELETE + trigger); audit/event ghi qua **outbox** trong cùng transaction nghiệp vụ. Bộ docs gốc CHƯA mô tả 3 cơ chế này — DDL mẫu + `withTenant`/`set_config` tại [DECISIONS-02 §2–3](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md).

# DB-08: AUDIT, FILES, SETTINGS, SEEDS DATABASE DESIGN

> **📚 Bộ tài liệu DB — Hệ thống Quản lý Doanh nghiệp**
> [DB-01 Tổng quan](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [DB-02 AUTH/RBAC](<DB-02 AUTH RBAC Database Design.md>) · [DB-03 HR](<DB-03_HR Database Design.md>) · [DB-04 ATT](<DB-04_ATT Database Design.md>) · [DB-05 LEAVE](<DB-05 LEAVE Database Design.md>) · [DB-06 TASK](<DB-06 TASK Database Design.md>) · [DB-07 NOTI/DASH](<DB-07 NOTI DASH Database Design.md>) · **DB-08 Audit/Files/Settings** · [DB-09 Index/Hiệu năng](<DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 Migration/Seed](<DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>)
>
> **Nguồn & liên quan:** [PRD-00 §12.4](<../PRD/PRD-00 Enterprise Management System .md>) · [SPEC-01 Tổng quan (§16 dữ liệu, audit)](<../SPEC/SPEC-01 Tổng quan.md>) · [Thiết kế API: API-09 FOUNDATION](<../API Design/API-09_FOUNDATION_API_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DB-08 |
| Tên tài liệu | Audit, Files, Settings, Seeds Database Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Nhóm dữ liệu | Foundation / System / Shared Infrastructure |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-07 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả thiết kế database chi tiết cho nhóm bảng nền tảng dùng chung của hệ thống quản lý doanh nghiệp nội bộ.

DB-08 không đại diện cho một module nghiệp vụ riêng như AUTH, HR, ATT, LEAVE, TASK, NOTI hoặc DASH. DB-08 là lớp dữ liệu nền tảng phục vụ toàn bộ hệ thống, bao gồm:

1. Quản lý công ty / tenant.
2. Quản lý danh mục module hệ thống.
3. Quản lý cấu hình hệ thống và cấu hình công ty.
4. Ghi nhật ký thao tác quan trọng toàn hệ thống.
5. Quản lý metadata file dùng chung.
6. Liên kết file với bản ghi nghiệp vụ ở nhiều module.
7. Quản lý log truy cập file nhạy cảm.
8. Quản lý bộ đếm sinh mã tự động.
9. Quản lý ngày nghỉ lễ / ngày không làm việc.
10. Quản lý chính sách lưu trữ dữ liệu, retention và cleanup.
11. Quản lý seed data nền tảng, idempotent seed và thứ tự migration MVP.

Tài liệu DB-08 dùng làm cơ sở để backend triển khai migration, entity/model, repository, service dùng chung, audit middleware, file service, setting service, sequence service, seed service và test case database cho lớp foundation.

---

## 3. Vai trò của DB-08 trong toàn hệ thống

DB-08 là lớp dữ liệu nền tảng nằm dưới các module nghiệp vụ.

```text
Foundation DB-08
  -> companies
  -> modules
  -> system_settings
  -> company_settings
  -> audit_logs
  -> files
  -> file_links
  -> file_access_logs
  -> sequence_counters
  -> public_holidays
  -> data_retention_policies
  -> seed_batches
  -> seed_items

AUTH DB-02
  -> users, roles, permissions

HR DB-03
  -> employees, departments, contracts, profile change

ATT DB-04
  -> attendance, shifts, rules, remote work

LEAVE DB-05
  -> leave requests, balances, policies

TASK DB-06
  -> projects, tasks, comments, checklist

NOTI/DASH DB-07
  -> notifications, templates, widgets, cache
```

Nếu DB-08 thiết kế không chắc, các module khác sẽ gặp các vấn đề sau:

1. Không có tenant/company chuẩn để phân tách dữ liệu.
2. Không có audit log thống nhất để truy vết.
3. Mỗi module tự thiết kế file attachment riêng gây trùng lặp.
4. Cấu hình bị phân tán, khó quản trị.
5. Sinh mã nhân viên, mã đơn nghỉ, mã project không nhất quán.
6. ATT và LEAVE khó xác định ngày lễ / ngày không làm việc.
7. Seed permission, role, module, notification event và dashboard widget khó lặp lại giữa môi trường dev/staging/production.

---

## 4. Phạm vi thiết kế

### 4.1 Bao gồm trong DB-08

| Nhóm | Bảng | Bắt buộc MVP | Vai trò |
| --- | --- | --- | --- |
| Tenant | `companies` | Có | Công ty / tenant chính của hệ thống |
| Module catalog | `modules` | Có | Danh mục module: AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI |
| Settings | `system_settings` | Có | Cấu hình cấp hệ thống / global default |
| Settings | `company_settings` | Có | Cấu hình riêng theo công ty |
| Audit | `audit_logs` | Có | Nhật ký thao tác quan trọng toàn hệ thống |
| File | `files` | Có | Metadata file dùng chung |
| File | `file_links` | Có | Liên kết file với entity nghiệp vụ |
| File security | `file_access_logs` | Nên có | Log xem/tải/xóa file, đặc biệt file nhạy cảm |
| Sequence | `sequence_counters` | Có | Bộ đếm sinh mã tự động |
| Calendar | `public_holidays` | Có | Ngày nghỉ lễ/ngày không làm việc cho ATT/LEAVE |
| Retention | `data_retention_policies` | Nên có | Chính sách lưu trữ log/file/cache |
| Seed | `seed_batches` | Nên có | Theo dõi batch seed đã chạy |
| Seed | `seed_items` | Nên có | Theo dõi từng item seed để idempotent |
| System job | `system_job_runs` | Nên có | Nhật ký mỗi lần chạy system job nền |
| System job | `system_job_locks` | Nên có | Lock tránh chạy trùng job giữa các instance |

### 4.2 Bảng thuộc module khác nhưng phụ thuộc DB-08

| Bảng/module | Phụ thuộc DB-08 |
| --- | --- |
| `users` | `company_id`, `avatar_file_id`, audit actor |
| `roles` | `company_id`, role global/company-specific |
| `employees` | `company_id`, `files`, `file_links`, `sequence_counters`, audit log |
| `employee_contracts` | File hợp đồng, audit log |
| `attendance_records` | `company_id`, `public_holidays`, audit log |
| `attendance_adjustment_requests` | File bằng chứng, audit log |
| `remote_work_requests` | File/ảnh bằng chứng, audit log |
| `leave_requests` | Mã đơn tự sinh, file đính kèm, public holidays, audit log |
| `projects` | Mã project tự sinh, file project, audit log |
| `tasks` | Mã task, file task, audit/activity log |
| `notifications` | `company_id`, module code, audit log |
| `dashboard_widget_cache` | `company_id`, retention policy, cache invalidation |

### 4.3 Chưa đi sâu trong DB-08 nhưng cần chừa thiết kế

| Nhóm | Giai đoạn | Ghi chú thiết kế |
| --- | --- | --- |
| Multi-tenant SaaS nâng cao | Phase sau | Bổ sung plan, subscription, billing tenant |
| Branch/location | Phase sau | Có thể thêm `company_branches` hoặc `work_locations` |
| Storage provider nâng cao | Phase sau | Có thể thêm `storage_providers`, `storage_buckets` |
| File versioning | Phase sau | Có thể thêm `file_versions` |
| Antivirus scanning | Phase sau | Mở rộng `files.scan_status`, hoặc thêm `file_scan_logs` |
| Data archival | Phase sau | Có thể thêm archive tables hoặc object storage cold tier |
| Legal hold | Phase sau | Mở rộng `data_retention_policies` và bảng `legal_holds` |
| Advanced audit search | Phase sau | Có thể dùng OpenSearch/Elastic sync từ `audit_logs` |
| Config approval workflow | Phase sau | Cấu hình quan trọng cần workflow duyệt trước khi áp dụng |
| Seed/migration orchestration | Phase sau | Có thể tách tool migration riêng ngoài database |

---

## 5. Nguyên tắc thiết kế Foundation

### 5.1 PostgreSQL làm database chính

DB-08 tiếp tục dùng PostgreSQL vì các bảng foundation cần:

1. Transaction khi sinh mã tự động bằng `sequence_counters`.
2. Foreign key với `companies`, `users`, `modules`, `files`.
3. JSONB cho cấu hình động, audit diff, metadata file và seed payload.
4. Index tốt cho audit log, file lookup, setting lookup, public holiday lookup.
5. Có thể partition bảng lớn như `audit_logs` và `file_access_logs` theo thời gian.
6. Hỗ trợ UUID và constraint mạnh.

### 5.2 UUID làm primary key

Tất cả bảng DB-08 dùng:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
```

Yêu cầu extension:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### 5.3 Multi-tenant bằng `company_id`

Các bảng dữ liệu vận hành bắt buộc có `company_id`:

```text
company_settings
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

Một số bảng cho phép `company_id` nullable để hỗ trợ global default:

```text
system_settings      không cần company_id
modules              không cần company_id trong MVP
public_holidays      company_id nullable nếu holiday global theo quốc gia
sequence_counters    company_id nullable nếu sequence cấp system
```

Nguyên tắc:

1. Query dữ liệu vận hành phải filter theo `company_id` từ auth context.
2. Không tin `company_id` từ request body frontend.
3. `company_id = NULL` chỉ dùng cho global/system default hoặc dữ liệu system-level.
4. Super Admin scope System mới được truy vấn dữ liệu liên công ty.
5. Unique index quan trọng phải đặt `company_id` ở cột đầu nếu dữ liệu company-specific.

### 5.4 Foundation không xử lý nghiệp vụ gốc

Foundation chỉ cung cấp hạ tầng dữ liệu:

1. Audit service ghi log.
2. File service upload/link/unlink/download.
3. Setting service đọc/ghi cấu hình.
4. Sequence service sinh mã.
5. Holiday service tra cứu ngày lễ.
6. Seed service kiểm soát seed data.

Foundation không tự quyết định:

1. Ai được duyệt nghỉ.
2. Ai được chấm công.
3. Task nào quá hạn.
4. Dashboard nào hiển thị dữ liệu gì.
5. Notification nào gửi cho ai.

Các quyết định nghiệp vụ nằm ở module tương ứng.

### 5.5 Audit log là append-only

`audit_logs` là ledger hệ thống. Nguyên tắc:

1. Không update audit log sau khi ghi.
2. Không xóa mềm audit log như dữ liệu nghiệp vụ thường.
3. Nếu cần che/mask dữ liệu nhạy cảm, thực hiện trước khi insert.
4. Nếu cần xóa theo retention, dùng job archive/delete có quyền hệ thống và ghi log riêng.
5. Mỗi request quan trọng nên có `request_id` hoặc `correlation_id` để truy vết xuyên module.

### 5.6 File metadata nằm trong DB, file binary nằm ngoài DB

Database chỉ lưu metadata file:

1. Tên file.
2. MIME type.
3. Dung lượng.
4. Storage provider.
5. Storage path.
6. Checksum/hash.
7. Upload status.
8. Quyền riêng tư.
9. Người upload.
10. Liên kết đến entity nghiệp vụ.

Nội dung file binary lưu ở storage riêng:

```text
local private storage / S3 / GCS / MinIO / Azure Blob
```

MVP có thể dùng local/private storage nhưng database phải chừa `storage_provider` để chuyển sang object storage sau này.

### 5.7 File private là mặc định

Trong hệ thống quản lý doanh nghiệp, đa số file là dữ liệu nội bộ hoặc nhạy cảm:

1. Hợp đồng lao động.
2. Hồ sơ nhân viên.
3. CCCD/CMND.
4. File chứng minh nghỉ phép.
5. Ảnh bằng chứng điều chỉnh công.
6. Tài liệu dự án nội bộ.

Do đó `files.visibility` mặc định là:

```text
Private
```

Không lưu public URL cố định cho file private. Backend chỉ tạo signed URL ngắn hạn sau khi kiểm tra permission.

### 5.8 `file_links` dùng polymorphic reference có kiểm soát

`file_links` cần liên kết file với nhiều entity khác nhau:

```text
Employee
EmployeeContract
LeaveRequest
AttendanceAdjustmentRequest
RemoteWorkRequest
Project
Task
TaskComment
```

Vì PostgreSQL không thể tạo foreign key động theo `entity_type`, backend phải chịu trách nhiệm:

1. Validate entity tồn tại.
2. Validate entity cùng company.
3. Validate user có quyền upload/link/unlink file vào entity đó.
4. Validate quyền xem/tải file dựa vào module gốc.
5. Ghi audit/file access log nếu file nhạy cảm.

### 5.9 Setting có precedence rõ ràng

Cấu hình có nhiều tầng:

```text
System default
  -> Company override
  -> Module-specific company setting
  -> Department/Employee setting ở module nghiệp vụ nếu cần
```

DB-08 xử lý các tầng foundation:

1. `system_settings`: default toàn hệ thống.
2. `company_settings`: override theo công ty.
3. `user_preferences`: tùy chọn cá nhân theo user (tầng **User**) — locale/timezone/theme/date_format/default_landing/density/layout ME (xem §8.16, SPEC-09 §15.2). Tầng User chỉ ghi đè các preference thuộc quyền cá nhân (`ME.PREFERENCE.UPDATE_OWN`), không ghi đè policy công ty bắt buộc (ví dụ timezone chỉ override được nếu company policy cho phép — SPEC-09 ME-DEC-008).

Thứ tự precedence khi resolve preference cá nhân:

```text
System default
  -> Company override (company_settings)
  -> User override (user_preferences) nếu key thuộc phạm vi cá nhân
```

> **Phương án B (nếu owner chọn tái dùng):** thay vì tạo bảng `user_preferences`, có thể mở rộng hệ setting hiện có sang **scope User** (System → Company → Role → User) như SPEC-09 §15.3. Khi đó tầng User nằm trong bảng setting mở rộng thay vì bảng riêng; quyết định canonical do owner chốt ở PR (ME-DEC / S5-ME-DB-1). DB-08 mô tả phương án A (bảng riêng `user_preferences`) làm mặc định vì tách rõ tenant + unique per-user và không làm phình bảng setting key-value.

Các cấu hình nghiệp vụ chuyên sâu nằm ở module riêng:

```text
attendance_rules
leave_policies
employee_code_configs
notification_preferences
dashboard_widget_configs
```

### 5.10 Sequence counter phải chống race condition

Sinh mã tự động cần transaction và row lock:

```sql
SELECT *
FROM sequence_counters
WHERE company_id = :company_id
  AND sequence_key = :sequence_key
FOR UPDATE;
```

Sau đó service tăng `current_value`, format code và commit.

Không được sinh mã bằng cách:

```text
SELECT MAX(code) + 1
```

vì dễ race condition khi nhiều user tạo dữ liệu cùng lúc.

### 5.11 Public holiday dùng cho cả ATT và LEAVE

`public_holidays` là nguồn tham chiếu dùng chung:

1. ATT xác định ngày không làm việc, có cần chấm công không.
2. LEAVE xác định ngày có trừ phép không.
3. DASH hiển thị lịch nghỉ/cảnh báo nếu cần.
4. PAYROLL sau này tính công/lương theo ngày lễ.

MVP nên hỗ trợ holiday theo company và global theo quốc gia.

### 5.12 Seed data phải idempotent

Seed có thể chạy nhiều lần mà không tạo trùng dữ liệu.

Nguyên tắc:

1. Mỗi seed item có `seed_key` ổn định.
2. Seed dùng upsert theo business key.
3. Không phụ thuộc UUID cố định nếu không cần.
4. Có ghi `seed_batches` và `seed_items` để kiểm tra seed đã chạy.
5. Seed có checksum để phát hiện thay đổi nội dung seed.
6. Seed quyền/module/template/widget cần version hóa.

---

## 6. ERD cấp Foundation

### 6.1 ERD dạng text

```text
companies
  1 --- n company_settings
  1 --- n audit_logs
  1 --- n files
  1 --- n file_links
  1 --- n file_access_logs
  1 --- n sequence_counters
  1 --- n public_holidays
  1 --- n data_retention_policies
  1 --- n seed_batches

modules
  1 --- n system_settings           qua module_code logic
  1 --- n company_settings          qua module_code logic
  1 --- n audit_logs                qua module_code logic
  1 --- n file_links                qua module_code logic
  1 --- n sequence_counters         qua module_code logic
  1 --- n data_retention_policies   qua module_code logic

files
  1 --- n file_links
  1 --- n file_access_logs

seed_batches
  1 --- n seed_items

system_job_runs        (độc lập; company_id nullable cho job cấp system)
system_job_locks       (độc lập; khóa theo job_code)

users
  1 --- n audit_logs.actor_user_id
  1 --- n files.uploaded_by
  1 --- n file_links.created_by
  1 --- n file_access_logs.actor_user_id
  1 --- n settings created_by/updated_by
```

### 6.2 Quan hệ chính

| Quan hệ | Loại | Ghi chú |
| --- | --- | --- |
| `companies.id` -> `company_settings.company_id` | 1-n | Cấu hình riêng theo công ty |
| `companies.id` -> `audit_logs.company_id` | 1-n | Audit theo tenant, nullable cho system log |
| `companies.id` -> `files.company_id` | 1-n | File thuộc một company |
| `files.id` -> `file_links.file_id` | 1-n | Một file có thể gắn nhiều entity nếu cho phép |
| `files.id` -> `file_access_logs.file_id` | 1-n | Log truy cập file |
| `companies.id` -> `sequence_counters.company_id` | 1-n | Bộ đếm theo company |
| `companies.id` -> `public_holidays.company_id` | 1-n nullable | Holiday riêng theo company hoặc global |
| `seed_batches.id` -> `seed_items.seed_batch_id` | 1-n | Một batch seed gồm nhiều item |

---

## 7. Danh sách bảng DB-08

| STT | Bảng | Bắt buộc MVP | Mô tả |
| --- | --- | --- | --- |
| 1 | `companies` | Có | Công ty/tenant |
| 2 | `modules` | Có | Danh mục module hệ thống |
| 3 | `system_settings` | Có | Cấu hình global/system |
| 4 | `company_settings` | Có | Cấu hình riêng theo công ty |
| 5 | `audit_logs` | Có | Nhật ký thao tác quan trọng |
| 6 | `files` | Có | Metadata file |
| 7 | `file_links` | Có | Liên kết file với entity nghiệp vụ |
| 8 | `file_access_logs` | Nên có | Log truy cập file |
| 9 | `sequence_counters` | Có | Bộ đếm sinh mã tự động |
| 10 | `public_holidays` | Có | Ngày nghỉ lễ/ngày không làm việc |
| 11 | `data_retention_policies` | Nên có | Chính sách lưu trữ/xóa dữ liệu |
| 12 | `seed_batches` | Nên có | Theo dõi batch seed |
| 13 | `seed_items` | Nên có | Theo dõi item seed |
| 14 | `system_job_runs` | Nên có | Nhật ký mỗi lần chạy system job (cleanup/retention/retry/overdue...) |
| 15 | `system_job_locks` | Nên có | Lock tránh nhiều instance chạy trùng một job |
| 16 | `user_preferences` | Nên có | Tùy chọn cá nhân theo user (scope User) cho module ME — SPEC-09 §15.2 (xem §8.16) |

---

## 8. Thiết kế chi tiết bảng

### 8.1 Bảng `companies`

#### Mục đích

Lưu thông tin công ty/tenant trong hệ thống.

> **CHỐT 2026-07-02 (OWNER-DECISION #1 — PIN code thắng ở N=1 single-tenant; reconcile khi mở multi-company):** bảng `companies` triển khai (mig 0002) LỆCH §8.1 có chủ đích cho single-tenant: (a) business key = `slug` (text NOT NULL, unique khi chưa xoá mềm) thay `company_code` — cột `company_code` chỉ là additive nullable (mig 0360); (b) `status` CHECK = **('active','suspended')** (lowercase, 2 giá trị) thay 'Active/Inactive/Suspended/Deleted'; (c) THIẾU `legal_name`(code có `legal_rep_name`)/`country_code`/`default_locale`(code `language`)/`currency_code`(code `currency`); (d) còn `GRANT DELETE` cho `mediaos_app` (mig 0002) — lệch quy tắc #4 no-hard-delete, ghi nhận là nợ; (e) cột legacy hướng cũ `working_days_json`/`payroll_config_json`/`schema_version`. Ở N=1 các lệch này KHÔNG ảnh hưởng cô lập/nghiệp vụ. **Cần owner chốt lần cuối trước merge.** Khi mở multi-company: reconcile về §8.1 (thêm cột pháp lý, đổi status enum, gỡ DELETE grant).

Trong MVP có thể chỉ có một công ty, nhưng vẫn thiết kế `companies` để chuẩn bị cho SaaS/multi-tenant.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_code` | VARCHAR(100) | Có | Mã công ty, unique |
| `name` | VARCHAR(255) | Có | Tên công ty hiển thị |
| `legal_name` | VARCHAR(255) | Không | Tên pháp lý |
| `tax_code` | VARCHAR(100) | Không | Mã số thuế |
| `email` | VARCHAR(255) | Không | Email công ty |
| `phone` | VARCHAR(50) | Không | Số điện thoại |
| `website` | VARCHAR(255) | Không | Website |
| `address` | TEXT | Không | Địa chỉ |
| `country_code` | VARCHAR(10) | Không | Ví dụ `VN` |
| `timezone` | VARCHAR(100) | Có | Ví dụ `Asia/Ho_Chi_Minh` |
| `default_locale` | VARCHAR(20) | Có | Ví dụ `vi-VN` |
| `currency_code` | VARCHAR(10) | Không | Ví dụ `VND` |
| `logo_file_id` | UUID | Không | FK `files.id`, thêm FK sau khi bảng `files` tồn tại |
| `status` | VARCHAR(50) | Có | Active/Inactive/Suspended/Deleted |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id`, thêm FK sau AUTH |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id`, thêm FK sau AUTH |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id`, thêm FK sau AUTH |

#### Constraint/index đề xuất

```sql
ALTER TABLE companies
ADD CONSTRAINT chk_companies_status
CHECK (status IN ('Active', 'Inactive', 'Suspended', 'Deleted'));

CREATE UNIQUE INDEX uq_companies_company_code_active
ON companies (company_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_companies_status
ON companies (status)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. `company_code` không được trùng giữa các công ty active.
2. `timezone` là bắt buộc vì ATT/LEAVE/DASH cần xử lý ngày giờ đúng.
3. MVP seed một company mặc định nếu hệ thống chưa có tenant.
4. Không xóa cứng company đã có dữ liệu nghiệp vụ.
5. Nếu `status = Suspended`, user thuộc company không được đăng nhập, trừ Super Admin nếu có cơ chế hỗ trợ.
6. `logo_file_id` không bắt buộc trong MVP.

---

### 8.2 Bảng `modules`

#### Mục đích

Lưu danh mục module hệ thống để:

1. Quản lý module code thống nhất.
2. Seed permission theo module.
3. Cấu hình bật/tắt module trong tương lai.
4. Phân nhóm dashboard, notification, audit log theo module.
5. Chuẩn bị mở rộng PAYROLL, RECRUIT, ASSET, ROOM, CHAT, SOCIAL, MOBILE, AI.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `module_code` | VARCHAR(50) | Có | AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI |
| `name` | VARCHAR(255) | Có | Tên module |
| `description` | TEXT | Không | Mô tả |
| `module_group` | VARCHAR(100) | Không | Foundation/Core/Operation/Experience/Extension |
| `version` | VARCHAR(50) | Không | Version module |
| `is_core` | BOOLEAN | Có | Module nền tảng không được tắt tùy tiện |
| `is_mvp` | BOOLEAN | Có | Thuộc MVP hay không |
| `is_active` | BOOLEAN | Có | Đang bật |
| `sort_order` | INT | Không | Thứ tự hiển thị |
| `dependencies` | JSONB | Không | Danh sách module phụ thuộc |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `deleted_at` | TIMESTAMP | Không | Soft delete nếu cần |
| `deleted_by` | UUID | Không | FK `users.id`, thêm sau AUTH |

> **CHỐT 2026-07-02 (OWNER-DECISION #2 — PIN code, cosmetic):** seed `modules.sort_order` triển khai (mig 0435) dùng **1..15 LIỀN** (AUTH=1, HR=2, ATT=3, LEAVE=4, TASK=5, DASH=6, NOTI=7, PAYROLL=8…AI=15) thay khoảng cách 10-70 kiểu doc. Chỉ ảnh hưởng thứ tự hiển thị (`ORDER BY sort_order`), KHÔNG có tác động nghiệp vụ/khoá — PIN code, không đổi lại. Cần owner chốt lần cuối trước merge.

#### Constraint/index đề xuất

```sql
CREATE UNIQUE INDEX uq_modules_module_code_active
ON modules (module_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_modules_group_active
ON modules (module_group, is_active)
WHERE deleted_at IS NULL;
```

#### Seed module MVP

| Module code | Name | Group | Core | MVP | Active |
| --- | --- | --- | --- | --- | --- |
| `AUTH` | Tài khoản & phân quyền | Core | true | true | true |
| `HR` | Quản lý nhân sự | Core | true | true | true |
| `ATT` | Chấm công | Operation | false | true | true |
| `LEAVE` | Nghỉ phép | Operation | false | true | true |
| `TASK` | Công việc & Dự án | Collaboration | false | true | true |
| `DASH` | Dashboard | Experience | false | true | true |
| `NOTI` | Thông báo hệ thống | Experience | false | true | true |
| `PAYROLL` | Tiền lương | Extension | false | false | false |
| `RECRUIT` | Tuyển dụng | Extension | false | false | false |
| `ASSET` | Tài sản | Extension | false | false | false |
| `ROOM` | Phòng họp | Extension | false | false | false |
| `CHAT` | Chat nội bộ | Extension | false | false | false |
| `SOCIAL` | Mạng xã hội nội bộ | Extension | false | false | false |
| `MOBILE` | Mobile app | Extension | false | false | false |
| `AI` | AI & tích hợp | Extension | false | false | false |

#### Quy tắc nghiệp vụ

1. `module_code` là business key và được dùng trong permission, audit log, notification, file link.
2. Module core không được disable nếu còn dữ liệu phụ thuộc.
3. Module phase sau có thể seed trước với `is_active = false`.
4. Không hard delete module đã phát sinh permission/audit/log/config.

---

### 8.3 Bảng `system_settings`

#### Mục đích

Lưu cấu hình cấp hệ thống, làm global default cho toàn bộ tenant.

Ví dụ:

1. Default timezone.
2. Default locale.
3. File upload max size mặc định.
4. Danh sách MIME type cho phép.
5. Password policy mặc định.
6. Audit retention mặc định.
7. Feature flag global.
8. Storage provider mặc định.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `setting_key` | VARCHAR(150) | Có | Key cấu hình |
| `setting_value` | JSONB | Có | Giá trị cấu hình |
| `value_type` | VARCHAR(50) | Có | String/Number/Boolean/JSON/Array/SecretRef |
| `category` | VARCHAR(100) | Có | General/Security/File/Audit/Notification/Dashboard |
| `module_code` | VARCHAR(50) | Không | Module liên quan nếu có |
| `description` | TEXT | Không | Mô tả |
| `is_public` | BOOLEAN | Có | Frontend có được đọc không |
| `is_sensitive` | BOOLEAN | Có | Có nhạy cảm không |
| `is_encrypted` | BOOLEAN | Có | Giá trị có được mã hóa không |
| `secret_ref` | VARCHAR(255) | Không | Tham chiếu secret manager nếu có |
| `validation_schema` | JSONB | Không | Schema validate value |
| `effective_from` | TIMESTAMP | Không | Hiệu lực từ |
| `effective_to` | TIMESTAMP | Không | Hiệu lực đến |
| `status` | VARCHAR(50) | Có | Active/Inactive |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id`, thêm sau AUTH |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id`, thêm sau AUTH |

#### Constraint/index đề xuất

```sql
ALTER TABLE system_settings
ADD CONSTRAINT chk_system_settings_value_type
CHECK (value_type IN ('String', 'Number', 'Boolean', 'JSON', 'Array', 'SecretRef'));

ALTER TABLE system_settings
ADD CONSTRAINT chk_system_settings_status
CHECK (status IN ('Active', 'Inactive'));

CREATE UNIQUE INDEX uq_system_settings_key_active
ON system_settings (setting_key)
WHERE status = 'Active';

CREATE INDEX idx_system_settings_category
ON system_settings (category, module_code, status);
```

#### Quy tắc nghiệp vụ

1. `setting_key` phải ổn định, dùng dạng dot notation.
2. Không lưu secret thật trong `setting_value` nếu có thể dùng `secret_ref`.
3. `is_public = true` chỉ dùng cho cấu hình an toàn để frontend đọc.
4. Cấu hình sensitive không được trả về API nếu user không có quyền system admin.
5. Khi cập nhật setting quan trọng phải ghi `audit_logs`.
6. Nếu cần rollback cấu hình, phase sau có thể thêm bảng setting history.

#### Ví dụ setting key

```text
system.default_timezone
system.default_locale
file.max_upload_size_mb
file.allowed_mime_types
audit.default_retention_days
security.password_min_length
security.session_ttl_minutes
notification.default_channel
```

---

### 8.4 Bảng `company_settings`

#### Mục đích

Lưu cấu hình riêng theo công ty, override `system_settings`.

Ví dụ:

1. Timezone công ty.
2. Locale mặc định.
3. File upload max size riêng.
4. Bật/tắt module.
5. Cấu hình notification channel.
6. Cấu hình dashboard mặc định.
7. Cấu hình quy tắc sinh mã ở cấp company nếu không dùng bảng riêng.
8. Cấu hình bảo mật ở cấp company.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `setting_key` | VARCHAR(150) | Có | Key cấu hình |
| `setting_value` | JSONB | Có | Giá trị cấu hình |
| `value_type` | VARCHAR(50) | Có | String/Number/Boolean/JSON/Array/SecretRef |
| `category` | VARCHAR(100) | Có | General/Security/File/Audit/Notification/Dashboard |
| `module_code` | VARCHAR(50) | Không | Module liên quan nếu có |
| `description` | TEXT | Không | Mô tả |
| `is_public` | BOOLEAN | Có | Frontend có thể đọc không |
| `is_sensitive` | BOOLEAN | Có | Có nhạy cảm không |
| `is_encrypted` | BOOLEAN | Có | Có mã hóa không |
| `secret_ref` | VARCHAR(255) | Không | Tham chiếu secret manager |
| `validation_schema` | JSONB | Không | Schema validate |
| `effective_from` | TIMESTAMP | Không | Hiệu lực từ |
| `effective_to` | TIMESTAMP | Không | Hiệu lực đến |
| `status` | VARCHAR(50) | Có | Active/Inactive |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE company_settings
ADD CONSTRAINT chk_company_settings_value_type
CHECK (value_type IN ('String', 'Number', 'Boolean', 'JSON', 'Array', 'SecretRef'));

ALTER TABLE company_settings
ADD CONSTRAINT chk_company_settings_status
CHECK (status IN ('Active', 'Inactive'));

CREATE UNIQUE INDEX uq_company_settings_key_active
ON company_settings (company_id, setting_key)
WHERE deleted_at IS NULL AND status = 'Active';

CREATE INDEX idx_company_settings_company_category
ON company_settings (company_id, category, module_code, status)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Khi đọc setting, service ưu tiên `company_settings`, nếu không có thì fallback `system_settings`.
2. Cấu hình nhạy cảm không trả về frontend.
3. User thường không được sửa setting; cần permission quản trị.
4. Mọi thay đổi setting quan trọng phải ghi audit log.
5. Không dùng `company_settings` thay thế bảng nghiệp vụ phức tạp như `attendance_rules` hoặc `leave_policies`.
6. Company setting nên dùng cho cấu hình nhẹ, dạng key-value.

#### Precedence khi đọc cấu hình

```text
1. company_settings active theo company_id + setting_key
2. system_settings active theo setting_key
3. default hard-coded trong service nếu chưa seed
```

---

### 8.5 Bảng `audit_logs`

#### Mục đích

Ghi nhật ký các thao tác quan trọng toàn hệ thống.

> **CHỐT 2026-07-02 (Option-A, code thắng — mạnh hơn doc):** bảng `audit_logs` triển khai (mig 0003 tạo + RLS/FORCE, 0432/0438 shape §8.5) với: (1) `company_id` **NOT NULL** — mạnh hơn §8.5 (spec cho nullable "system event"); ở N=1 không có sự kiện không-công-ty, mọi writer chạy trong `withTenant` (DB DEFAULT điền `company_id`), bất biến #1 cấm nới. (2) GIỮ cột legacy `object_type`(NOT NULL)/`object_id`/`before`/`after`/`ip_address` cho AuditService v1 song song 23 cột §8.5 (đều nullable) — writer cũ + v2 KHÔNG vỡ. (3) `object_type` có CHECK = **UNION append-only** (0011…0464, ADD-only). (4) append-only: REVOKE UPDATE/DELETE + GRANT SELECT,INSERT cho `mediaos_app` — ghi-rồi-update PHẢI FAIL. Nới `company_id` sang nullable = FOLLOW-UP Phase sau (audit platform-level), KHÔNG làm ở N=1.

Audit log dùng để:

1. Truy vết ai làm gì, lúc nào.
2. Xác định dữ liệu nào bị thay đổi.
3. Hỗ trợ điều tra lỗi nghiệp vụ.
4. Hỗ trợ kiểm soát bảo mật.
5. Hỗ trợ Admin/HR kiểm tra thao tác nhạy cảm.
6. Hỗ trợ compliance ở phase sau.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Không | FK `companies.id`, nullable cho system event |
| `actor_user_id` | UUID | Không | FK `users.id`; user thực hiện |
| `actor_employee_id` | UUID | Không | FK `employees.id`; employee tương ứng nếu có |
| `actor_type` | VARCHAR(50) | Có | User/System/Job/Integration |
| `module_code` | VARCHAR(50) | Có | AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI/SYSTEM |
| `action` | VARCHAR(100) | Có | CREATE/UPDATE/DELETE/APPROVE/REJECT/EXPORT... |
| `action_group` | VARCHAR(100) | Không | Auth/HR/Profile/Attendance/Leave/Task/File/Setting |
| `entity_type` | VARCHAR(100) | Có | Tên entity bị tác động |
| `entity_id` | UUID | Không | ID bản ghi nếu là UUID |
| `entity_id_text` | VARCHAR(255) | Không | ID dạng text nếu external/entity đặc biệt |
| `entity_code` | VARCHAR(255) | Không | Mã nghiệp vụ nếu có |
| `permission_code` | VARCHAR(150) | Không | Permission được dùng |
| `data_scope` | VARCHAR(50) | Không | Own/Team/Department/Company/System |
| `request_id` | VARCHAR(100) | Không | Request id |
| `correlation_id` | VARCHAR(100) | Không | Trace xuyên module/job |
| `ip_address` | VARCHAR(45) | Không | IPv4/IPv6 |
| `user_agent` | TEXT | Không | Browser/device |
| `device_info` | JSONB | Không | Thông tin thiết bị |
| `old_values` | JSONB | Không | Dữ liệu trước, đã mask nếu cần |
| `new_values` | JSONB | Không | Dữ liệu sau, đã mask nếu cần |
| `changed_fields` | JSONB | Không | Danh sách field thay đổi |
| `diff_summary` | TEXT | Không | Mô tả ngắn |
| `sensitivity_level` | VARCHAR(50) | Có | Normal/Sensitive/HighlySensitive |
| `result_status` | VARCHAR(50) | Có | Success/Failure/Denied/Error |
| `error_code` | VARCHAR(100) | Không | Mã lỗi nếu có |
| `error_message` | TEXT | Không | Thông tin lỗi đã lọc nhạy cảm |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm ghi log |

#### Constraint/index đề xuất

```sql
ALTER TABLE audit_logs
ADD CONSTRAINT chk_audit_logs_actor_type
CHECK (actor_type IN ('User', 'System', 'Job', 'Integration'));

ALTER TABLE audit_logs
ADD CONSTRAINT chk_audit_logs_sensitivity_level
CHECK (sensitivity_level IN ('Normal', 'Sensitive', 'HighlySensitive'));

ALTER TABLE audit_logs
ADD CONSTRAINT chk_audit_logs_result_status
CHECK (result_status IN ('Success', 'Failure', 'Denied', 'Error'));

CREATE INDEX idx_audit_logs_company_created
ON audit_logs (company_id, created_at DESC);

CREATE INDEX idx_audit_logs_actor_created
ON audit_logs (actor_user_id, created_at DESC);

CREATE INDEX idx_audit_logs_entity
ON audit_logs (module_code, entity_type, entity_id, created_at DESC);

CREATE INDEX idx_audit_logs_request
ON audit_logs (request_id);

CREATE INDEX idx_audit_logs_correlation
ON audit_logs (correlation_id);

CREATE INDEX idx_audit_logs_action
ON audit_logs (company_id, module_code, action, created_at DESC);
```

#### Partition đề xuất

Vì `audit_logs` có thể rất lớn, đề xuất partition theo tháng ở phase production:

```sql
-- Ý tưởng triển khai
PARTITION BY RANGE (created_at)
```

Ví dụ partition:

```text
audit_logs_2026_06
audit_logs_2026_07
audit_logs_2026_08
```

MVP có thể tạo bảng thường, nhưng migration nên chuẩn bị để chuyển sang partition khi dữ liệu lớn.

#### Quy tắc nghiệp vụ

1. Audit log là append-only.
2. Không update audit log sau khi insert.
3. Không ghi plain text password/token/secret vào audit log.
4. Dữ liệu nhạy cảm trong `old_values`, `new_values` phải được mask.
5. Các thao tác bị từ chối do thiếu quyền cũng nên ghi audit ở mức bảo mật nếu có rủi ro.
6. Export dữ liệu, tải file nhạy cảm, xem dữ liệu nhạy cảm có thể ghi audit tùy cấu hình.
7. Job hệ thống phải dùng `actor_type = Job` và có `metadata.job_name`.
8. Integration phải dùng `actor_type = Integration` và có `metadata.integration_name`.

#### Các action code đề xuất

| Action | Ý nghĩa |
| --- | --- |
| `CREATE` | Tạo bản ghi |
| `UPDATE` | Cập nhật bản ghi |
| `DELETE` | Xóa mềm |
| `RESTORE` | Khôi phục |
| `APPROVE` | Duyệt |
| `REJECT` | Từ chối |
| `CANCEL` | Hủy |
| `SUBMIT` | Gửi yêu cầu |
| `LOGIN` | Đăng nhập |
| `LOGOUT` | Đăng xuất |
| `LOCK` | Khóa tài khoản |
| `UNLOCK` | Mở khóa |
| `ASSIGN_ROLE` | Gán role |
| `REMOVE_ROLE` | Gỡ role |
| `UPLOAD_FILE` | Upload file |
| `DOWNLOAD_FILE` | Tải file |
| `VIEW_SENSITIVE` | Xem dữ liệu nhạy cảm |
| `EXPORT` | Xuất dữ liệu |
| `IMPORT` | Import dữ liệu |
| `RUN_JOB` | Chạy job |
| `CONFIG_UPDATE` | Cập nhật cấu hình |

#### Field masking đề xuất

Các field sau không nên ghi raw value vào audit log:

```text
password
password_hash
refresh_token
token
secret
bank_account_number
identity_number
salary
private_file_url
signed_url
```

Ví dụ mask:

```json
{
  "identity_number": "***MASKED***",
  "bank_account_number": "***MASKED***"
}
```

---

### 8.6 Bảng `files`

#### Mục đích

Lưu metadata file dùng chung cho toàn hệ thống.

File có thể đến từ:

1. Avatar user.
2. Hồ sơ nhân viên.
3. Hợp đồng lao động.
4. File chứng minh nghỉ phép.
5. File bằng chứng điều chỉnh công.
6. File remote/công tác.
7. File dự án.
8. File task/comment.
9. File import/export.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `original_name` | VARCHAR(500) | Có | Tên file gốc |
| `stored_name` | VARCHAR(500) | Có | Tên file trong storage |
| `file_extension` | VARCHAR(50) | Không | Extension lowercase |
| `mime_type` | VARCHAR(255) | Có | MIME type |
| `file_size_bytes` | BIGINT | Có | Dung lượng |
| `storage_provider` | VARCHAR(50) | Có | Local/S3/GCS/MinIO/Azure |
| `storage_bucket` | VARCHAR(255) | Không | Bucket/container |
| `storage_path` | TEXT | Có | Path/key trong storage |
| `checksum_sha256` | VARCHAR(128) | Không | Checksum |
| `content_hash` | VARCHAR(128) | Không | Hash để detect duplicate |
| `visibility` | VARCHAR(50) | Có | Private/Internal/Public |
| `upload_status` | VARCHAR(50) | Có | Pending/Uploaded/Failed/Deleted |
| `scan_status` | VARCHAR(50) | Có | NotRequired/Pending/Clean/Infected/Failed |
| `scan_result` | JSONB | Không | Kết quả scan nếu có |
| `owner_user_id` | UUID | Không | User sở hữu file nếu cần |
| `uploaded_by` | UUID | Có | FK `users.id` |
| `uploaded_at` | TIMESTAMP | Có | Thời điểm upload |
| `last_accessed_at` | TIMESTAMP | Không | Lần truy cập gần nhất |
| `download_count` | INT | Có | Số lượt download |
| `is_temporary` | BOOLEAN | Có | File tạm chưa link nghiệp vụ |
| `expires_at` | TIMESTAMP | Không | Hết hạn file tạm |
| `retention_until` | TIMESTAMP | Không | Giữ đến ngày nào |
| `metadata` | JSONB | Không | Width/height/page count/exif... |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo metadata |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `deleted_at` | TIMESTAMP | Không | Soft delete metadata |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE files
ADD CONSTRAINT chk_files_storage_provider
CHECK (storage_provider IN ('Local', 'S3', 'GCS', 'MinIO', 'Azure'));

ALTER TABLE files
ADD CONSTRAINT chk_files_visibility
CHECK (visibility IN ('Private', 'Internal', 'Public'));

ALTER TABLE files
ADD CONSTRAINT chk_files_upload_status
CHECK (upload_status IN ('Pending', 'Uploaded', 'Failed', 'Deleted'));

ALTER TABLE files
ADD CONSTRAINT chk_files_scan_status
CHECK (scan_status IN ('NotRequired', 'Pending', 'Clean', 'Infected', 'Failed'));

ALTER TABLE files
ADD CONSTRAINT chk_files_size_non_negative
CHECK (file_size_bytes >= 0);

CREATE INDEX idx_files_company_uploaded
ON files (company_id, uploaded_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_files_uploaded_by
ON files (company_id, uploaded_by, uploaded_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_files_content_hash
ON files (company_id, content_hash)
WHERE deleted_at IS NULL AND content_hash IS NOT NULL;

CREATE INDEX idx_files_temporary_expiry
ON files (company_id, is_temporary, expires_at)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. File private là mặc định.
2. Không lưu raw file binary trong database.
3. Không trả `storage_path` trực tiếp cho frontend nếu file private.
4. File private chỉ được download qua backend/signed URL ngắn hạn sau khi kiểm tra quyền.
5. File tạm không được link entity thì job cleanup xóa sau thời hạn cấu hình.
6. File bị `scan_status = Infected` không được link vào nghiệp vụ.
7. Nếu soft delete file, không nhất thiết xóa binary ngay; có thể chờ retention.
8. Nếu file đã link vào hợp đồng/đơn nghỉ/task, không xóa cứng ngay cả khi user gỡ link.
9. Upload file phải ghi audit hoặc file access log nếu module yêu cầu.

---

### 8.7 Bảng `file_links`

#### Mục đích

Liên kết file với bản ghi nghiệp vụ.

Một file có thể được liên kết với nhiều entity nếu cấu hình cho phép, ví dụ:

```text
files.id -> Employee profile
files.id -> EmployeeContract
files.id -> LeaveRequest
files.id -> Task
```

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `file_id` | UUID | Có | FK `files.id` |
| `module_code` | VARCHAR(50) | Có | HR/ATT/LEAVE/TASK/AUTH |
| `entity_type` | VARCHAR(100) | Có | Employee/LeaveRequest/Task... |
| `entity_id` | UUID | Có | ID bản ghi nghiệp vụ |
| `entity_code` | VARCHAR(255) | Không | Mã nghiệp vụ nếu có |
| `link_type` | VARCHAR(100) | Có | Avatar/Attachment/Contract/Proof/Document/Import/Export |
| `purpose` | VARCHAR(255) | Không | Mục đích file |
| `is_primary` | BOOLEAN | Có | File chính trong nhóm |
| `sort_order` | INT | Không | Thứ tự hiển thị |
| `access_scope` | VARCHAR(50) | Có | Owner/Team/Department/Company/System |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm link |
| `created_by` | UUID | Có | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete link |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE file_links
ADD CONSTRAINT chk_file_links_link_type
CHECK (link_type IN ('Avatar', 'Attachment', 'Contract', 'Proof', 'Document', 'Import', 'Export', 'Other'));

ALTER TABLE file_links
ADD CONSTRAINT chk_file_links_access_scope
CHECK (access_scope IN ('Owner', 'Team', 'Department', 'Company', 'System'));

CREATE INDEX idx_file_links_entity
ON file_links (company_id, module_code, entity_type, entity_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_file_links_file
ON file_links (file_id)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_file_links_primary_per_entity_type
ON file_links (company_id, module_code, entity_type, entity_id, link_type)
WHERE is_primary = true AND deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Backend phải validate entity tồn tại trước khi tạo link.
2. Entity và file phải cùng `company_id`.
3. Không cho link file `upload_status != Uploaded`.
4. Không cho link file `scan_status = Infected`.
5. Gỡ file khỏi entity là soft delete `file_links`, không xóa file ngay.
6. Nếu link_type là `Contract` hoặc `Proof`, nên ghi audit log.
7. Quyền xem file được quyết định bởi module gốc, không chỉ bởi `file_links.access_scope`.
8. `access_scope` là gợi ý để file service hỗ trợ kiểm tra nhanh, không thay thế permission module.

#### Entity type đề xuất theo module

| Module | Entity type | Link type |
| --- | --- | --- |
| AUTH | User | Avatar |
| HR | Employee | Avatar/Attachment/Document |
| HR | EmployeeContract | Contract |
| HR | ProfileChangeRequest | Attachment/Proof |
| ATT | AttendanceAdjustmentRequest | Proof/Attachment |
| ATT | RemoteWorkRequest | Proof/Attachment |
| LEAVE | LeaveRequest | Proof/Attachment |
| TASK | Project | Document/Attachment |
| TASK | Task | Attachment/Document |
| TASK | TaskComment | Attachment |

---

### 8.8 Bảng `file_access_logs`

#### Mục đích

Ghi log truy cập file, đặc biệt cho file nhạy cảm.

Dùng để trả lời các câu hỏi:

1. Ai đã tải file hợp đồng?
2. Ai đã xem file hồ sơ nhân viên?
3. Ai xóa/gỡ link file?
4. File private có bị truy cập trái phép không?
5. Tải file thất bại vì thiếu quyền hay file không tồn tại?

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `file_id` | UUID | Có | FK `files.id` |
| `file_link_id` | UUID | Không | FK `file_links.id` nếu có |
| `actor_user_id` | UUID | Không | FK `users.id` |
| `actor_employee_id` | UUID | Không | FK `employees.id` nếu có |
| `action` | VARCHAR(50) | Có | Preview/Download/Upload/Delete/Link/Unlink |
| `module_code` | VARCHAR(50) | Không | Module ngữ cảnh |
| `entity_type` | VARCHAR(100) | Không | Entity ngữ cảnh |
| `entity_id` | UUID | Không | Entity id |
| `permission_code` | VARCHAR(150) | Không | Permission đã kiểm tra |
| `access_granted` | BOOLEAN | Có | Có được phép không |
| `denied_reason` | VARCHAR(255) | Không | Lý do từ chối |
| `ip_address` | VARCHAR(45) | Không | IP |
| `user_agent` | TEXT | Không | User agent |
| `request_id` | VARCHAR(100) | Không | Request id |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm log |

#### Constraint/index đề xuất

```sql
ALTER TABLE file_access_logs
ADD CONSTRAINT chk_file_access_logs_action
CHECK (action IN ('Preview', 'Download', 'Upload', 'Delete', 'Link', 'Unlink', 'GenerateSignedUrl'));

CREATE INDEX idx_file_access_logs_file_created
ON file_access_logs (file_id, created_at DESC);

CREATE INDEX idx_file_access_logs_actor_created
ON file_access_logs (company_id, actor_user_id, created_at DESC);

CREATE INDEX idx_file_access_logs_entity
ON file_access_logs (company_id, module_code, entity_type, entity_id, created_at DESC);
```

#### Quy tắc nghiệp vụ

1. Tải/xem file nhạy cảm nên ghi log.
2. Truy cập bị từ chối cũng nên ghi log để phát hiện hành vi bất thường.
3. Không ghi signed URL vào log.
4. `file_access_logs` có thể partition theo tháng nếu dữ liệu lớn.
5. Không dùng bảng này thay thế `audit_logs`; bảng này chuyên cho file access.

---

### 8.9 Bảng `sequence_counters`

#### Mục đích

Quản lý bộ đếm sinh mã tự động cho nhiều nghiệp vụ.

Ví dụ:

1. Mã nhân viên: `EMP0001`, `DEV0001`, `2026-EMP-0001`.
2. Mã đơn nghỉ: `LV-2026-0001`.
3. Mã project: `PRJ-2026-0001`.
4. Mã task: `TASK-2026-0001`.
5. Mã hợp đồng: `CT-2026-0001`.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Không | FK `companies.id`, nullable cho system sequence |
| `module_code` | VARCHAR(50) | Có | HR/LEAVE/TASK/ATT/SYSTEM |
| `sequence_key` | VARCHAR(150) | Có | EMPLOYEE_CODE, LEAVE_REQUEST_CODE... |
| `scope_type` | VARCHAR(50) | Có | System/Company/Department/Employee/Custom |
| `scope_reference_id` | UUID | Không | department_id/employee_id nếu cần |
| `prefix` | VARCHAR(100) | Không | Tiền tố |
| `suffix` | VARCHAR(100) | Không | Hậu tố |
| `current_value` | BIGINT | Có | Giá trị hiện tại |
| `increment_by` | INT | Có | Mỗi lần tăng bao nhiêu |
| `padding_length` | INT | Có | Số chữ số padding |
| `reset_policy` | VARCHAR(50) | Có | Never/Yearly/Monthly/Daily |
| `reset_format` | VARCHAR(50) | Không | yyyy/yyyyMM/yyyyMMdd |
| `last_reset_at` | TIMESTAMP | Không | Lần reset gần nhất |
| `last_generated_code` | VARCHAR(255) | Không | Mã gần nhất |
| `format_pattern` | VARCHAR(255) | Không | Pattern format nâng cao |
| `lock_version` | INT | Có | Optimistic lock nếu cần |
| `status` | VARCHAR(50) | Có | Active/Inactive |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE sequence_counters
ADD CONSTRAINT chk_sequence_counters_scope_type
CHECK (scope_type IN ('System', 'Company', 'Department', 'Employee', 'Custom'));

ALTER TABLE sequence_counters
ADD CONSTRAINT chk_sequence_counters_reset_policy
CHECK (reset_policy IN ('Never', 'Yearly', 'Monthly', 'Daily'));

ALTER TABLE sequence_counters
ADD CONSTRAINT chk_sequence_counters_status
CHECK (status IN ('Active', 'Inactive'));

ALTER TABLE sequence_counters
ADD CONSTRAINT chk_sequence_counters_increment_positive
CHECK (increment_by > 0);

ALTER TABLE sequence_counters
ADD CONSTRAINT chk_sequence_counters_padding_non_negative
CHECK (padding_length >= 0);

CREATE UNIQUE INDEX uq_sequence_counters_company_key_scope_active
ON sequence_counters (company_id, sequence_key, scope_type, COALESCE(scope_reference_id, '00000000-0000-0000-0000-000000000000'::uuid))
WHERE deleted_at IS NULL;

CREATE INDEX idx_sequence_counters_company_module
ON sequence_counters (company_id, module_code, status)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Sinh mã phải dùng transaction và `FOR UPDATE`.
2. Không dùng `MAX(code) + 1`.
3. `current_value` lưu số đã cấp gần nhất hoặc số hiện tại theo quy ước service, phải thống nhất.
4. Khi reset theo năm/tháng/ngày, service kiểm tra `last_reset_at` và reset `current_value` về 0 nếu sang kỳ mới.
5. Khi tạo mã nhân viên theo phòng ban, dùng `scope_type = Department` và `scope_reference_id = department_id`.
6. Nếu cho phép sửa mã thủ công, vẫn không được làm sequence sinh trùng.
7. Mọi cập nhật cấu hình sequence phải ghi audit log.

#### Pattern format đề xuất

| Pattern | Kết quả ví dụ |
| --- | --- |
| `{PREFIX}{NUMBER}` | `EMP0001` |
| `{PREFIX}-{YYYY}-{NUMBER}` | `EMP-2026-0001` |
| `{DEPT_CODE}{NUMBER}` | `DEV0001` |
| `{COMPANY_CODE}-{PREFIX}-{NUMBER}` | `FMC-HR-0001` |
| `{PREFIX}-{YYYYMM}-{NUMBER}` | `LV-202606-0001` |

#### Sequence key MVP đề xuất

| Sequence key | Module | Ví dụ |
| --- | --- | --- |
| `EMPLOYEE_CODE` | HR | `EMP0001` |
| `CONTRACT_CODE` | HR | `CT-2026-0001` |
| `LEAVE_REQUEST_CODE` | LEAVE | `LV-2026-0001` |
| `PROJECT_CODE` | TASK | `PRJ-2026-0001` |
| `TASK_CODE` | TASK | `TASK-2026-0001` |
| `ATT_ADJUSTMENT_CODE` | ATT | `ADJ-2026-0001` |
| `REMOTE_WORK_REQUEST_CODE` | ATT | `RW-2026-0001` |

---

### 8.10 Bảng `public_holidays`

#### Mục đích

Lưu ngày nghỉ lễ/ngày không làm việc dùng chung cho ATT, LEAVE, DASH và PAYROLL phase sau.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Không | NULL = global holiday, có giá trị = holiday riêng công ty |
| `holiday_code` | VARCHAR(100) | Có | Mã ngày nghỉ |
| `name` | VARCHAR(255) | Có | Tên ngày nghỉ |
| `holiday_date` | DATE | Có | Ngày nghỉ |
| `holiday_type` | VARCHAR(50) | Có | PublicHoliday/CompanyHoliday/WorkingDayOverride/SpecialDay |
| `country_code` | VARCHAR(10) | Không | Ví dụ VN |
| `region_code` | VARCHAR(50) | Không | Vùng/tỉnh nếu cần |
| `is_recurring` | BOOLEAN | Có | Lặp hằng năm không |
| `recurring_rule` | JSONB | Không | Rule lặp nếu có |
| `affects_attendance` | BOOLEAN | Có | Có ảnh hưởng ATT không |
| `affects_leave_calculation` | BOOLEAN | Có | Có loại trừ khi tính phép không |
| `is_paid` | BOOLEAN | Có | Có hưởng lương không |
| `status` | VARCHAR(50) | Có | Active/Inactive |
| `source` | VARCHAR(100) | Không | Manual/System/Import/API |
| `description` | TEXT | Không | Mô tả |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

> **CHỐT 2026-07-02 (code thắng):** cột `is_paid` (dòng trên) ĐÃ triển khai với tên `is_paid_holiday` (`boolean NOT NULL DEFAULT true`) theo HỢP ĐỒNG WO — ép ở migration 0434 + `schema/holidays.ts`. Ngữ nghĩa không đổi (ngày nghỉ có hưởng lương). Đọc code là `is_paid_holiday`.

#### Constraint/index đề xuất

```sql
ALTER TABLE public_holidays
ADD CONSTRAINT chk_public_holidays_type
CHECK (holiday_type IN ('PublicHoliday', 'CompanyHoliday', 'WorkingDayOverride', 'SpecialDay'));

ALTER TABLE public_holidays
ADD CONSTRAINT chk_public_holidays_status
CHECK (status IN ('Active', 'Inactive'));

CREATE UNIQUE INDEX uq_public_holidays_global_date_code_active
ON public_holidays (country_code, holiday_date, holiday_code)
WHERE company_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_public_holidays_company_date_code_active
ON public_holidays (company_id, holiday_date, holiday_code)
WHERE company_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_public_holidays_company_date
ON public_holidays (company_id, holiday_date, status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_public_holidays_country_date
ON public_holidays (country_code, holiday_date, status)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Khi tra cứu ngày nghỉ, ưu tiên holiday riêng company rồi đến global holiday theo country.
2. `WorkingDayOverride` dùng cho trường hợp ngày thường bị chuyển thành ngày làm bù.
3. ATT dùng `affects_attendance` để quyết định có yêu cầu chấm công không.
4. LEAVE dùng `affects_leave_calculation` để quyết định có trừ phép không.
5. Không hard delete holiday đã được dùng trong tính công/nghỉ; chỉ inactive/soft delete và cho phép re-calculate nếu cần.
6. Cập nhật holiday quá khứ cần quyền cao vì có thể ảnh hưởng bảng công/phép đã tính.

---

### 8.11 Bảng `data_retention_policies`

#### Mục đích

Lưu chính sách lưu trữ, archive và cleanup dữ liệu.

> **CHỐT 2026-07-02 (code thắng — an toàn hơn doc):** `RetentionService.PROTECTED_TABLES` (app-layer defense-in-depth TRÊN REVOKE-ở-DB) liệt kê `audit_logs` + `file_access_logs` (cùng login_logs/user_security_events/security_alerts/api_key_usages/các ledger ATT-LEAVE-TASK-NOTI/employee_status_histories/payslips/kpi_results/seed_batches/seed_items) → **KHÔNG BAO GIỜ purge** dù policy `cleanup_action=Delete` + `is_enabled=true` + `dryRun=false` (no-op, deletedRecords=0). Chặt hơn §8.11. `archive_after_days`/archive/anonymize = tính năng future (chưa nối job). Retention hiện chỉ chạy Delete cho bảng KHÔNG-append-only.

Trong MVP, bảng này có thể ở mức cơ bản để định nghĩa retention cho:

1. Audit log.
2. File tạm.
3. File đã xóa mềm.
4. Notification cũ.
5. Dashboard cache.
6. Login logs.
7. File access logs.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Không | NULL = global default, có = company override |
| `module_code` | VARCHAR(50) | Có | SYSTEM/AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH |
| `entity_type` | VARCHAR(100) | Có | AuditLog/File/Notification/Cache... |
| `retention_days` | INT | Có | Số ngày giữ dữ liệu active |
| `archive_after_days` | INT | Không | Sau bao lâu archive |
| `delete_after_days` | INT | Không | Sau bao lâu xóa hẳn |
| `cleanup_action` | VARCHAR(50) | Có | None/Archive/Delete/Anonymize |
| `is_legal_hold_supported` | BOOLEAN | Có | Có hỗ trợ giữ pháp lý không |
| `is_enabled` | BOOLEAN | Có | Chính sách có bật không |
| `description` | TEXT | Không | Mô tả |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE data_retention_policies
ADD CONSTRAINT chk_data_retention_cleanup_action
CHECK (cleanup_action IN ('None', 'Archive', 'Delete', 'Anonymize'));

ALTER TABLE data_retention_policies
ADD CONSTRAINT chk_data_retention_days_positive
CHECK (retention_days >= 0);

CREATE UNIQUE INDEX uq_data_retention_company_module_entity_active
ON data_retention_policies (company_id, module_code, entity_type)
WHERE deleted_at IS NULL AND is_enabled = true;

CREATE INDEX idx_data_retention_module_entity
ON data_retention_policies (module_code, entity_type, is_enabled)
WHERE deleted_at IS NULL;
```

#### Seed retention đề xuất

| Entity | Retention đề xuất MVP | Ghi chú |
| --- | --- | --- |
| `AuditLog` | 365 ngày hoặc lâu hơn | Có thể tăng theo yêu cầu doanh nghiệp |
| `FileAccessLog` | 365 ngày | File nhạy cảm nên giữ log lâu |
| `TemporaryFile` | 1-7 ngày | Cleanup file chưa link |
| `DeletedFile` | 30-90 ngày | Cho phép restore nếu cần |
| `DashboardCache` | vài phút đến vài giờ | Do cache có TTL riêng |
| `Notification` | 180-365 ngày | Tùy dung lượng |
| `LoginLog` | 365 ngày | Phục vụ security audit |

#### Quy tắc nghiệp vụ

1. Retention policy không được xóa dữ liệu đang bị legal hold.
2. Cleanup job phải ghi audit log cấp system.
3. Với dữ liệu nhạy cảm, prefer archive/anonymize trước khi delete cứng.
4. Trong MVP có thể chỉ áp dụng cho file tạm và dashboard cache; audit retention có thể để phase sau.

---

### 8.12 Bảng `seed_batches`

#### Mục đích

Theo dõi các batch seed data đã chạy.

> **CHỐT 2026-07-02 (xác nhận — code khớp doc, KHÔNG sửa):** `seed_batches.status` enum §8.12 = Pending/Running/Success/Failed/Skipped/RolledBack đã KHỚP code (`schema/seed-tracking.ts` default 'Pending' + CHECK migration; runner mark 'Success'/'Failed'). Đây là mốc chuẩn cho DB-10 §9.2 (doc DB-10 ghi 'Applied' là DRIFT → đã sửa về 'Success').

Seed batch giúp:

1. Chạy seed nhiều lần không trùng dữ liệu.
2. Biết version seed nào đã áp dụng.
3. Rollback hoặc kiểm tra seed lỗi.
4. Đồng bộ dev/staging/production.
5. Quản lý seed permission, role, module, notification event, dashboard widget.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Không | NULL = global seed, có = seed theo company |
| `seed_key` | VARCHAR(150) | Có | Key batch seed |
| `seed_version` | VARCHAR(50) | Có | Version seed |
| `environment` | VARCHAR(50) | Không | dev/staging/prod/all |
| `description` | TEXT | Không | Mô tả |
| `checksum` | VARCHAR(128) | Không | Checksum nội dung seed |
| `status` | VARCHAR(50) | Có | Pending/Running/Success/Failed/Skipped/RolledBack |
| `started_at` | TIMESTAMP | Không | Bắt đầu |
| `finished_at` | TIMESTAMP | Không | Kết thúc |
| `executed_by` | UUID | Không | FK `users.id` hoặc null nếu migration tool |
| `error_message` | TEXT | Không | Lỗi nếu có |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |

#### Constraint/index đề xuất

```sql
ALTER TABLE seed_batches
ADD CONSTRAINT chk_seed_batches_status
CHECK (status IN ('Pending', 'Running', 'Success', 'Failed', 'Skipped', 'RolledBack'));

CREATE UNIQUE INDEX uq_seed_batches_key_version_company
ON seed_batches (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), seed_key, seed_version);

CREATE INDEX idx_seed_batches_status
ON seed_batches (status, created_at DESC);
```

#### Quy tắc nghiệp vụ

1. Mỗi seed batch có `seed_key + seed_version` ổn định.
2. Nếu batch đã Success cùng checksum, chạy lại thì Skip.
3. Nếu batch đã Success nhưng checksum thay đổi, phải tạo version mới hoặc báo lỗi.
4. Seed global chạy trước seed company.
5. Seed lỗi phải rollback transaction nếu có thể.

---

### 8.13 Bảng `seed_items`

#### Mục đích

Theo dõi từng item trong seed batch.

Ví dụ trong batch `MVP_PERMISSIONS_V1` có các item:

```text
AUTH.USER.VIEW
HR.EMPLOYEE.VIEW
ATT.ATTENDANCE.CHECK_IN
LEAVE.REQUEST.APPROVE
TASK.TASK.UPDATE_STATUS
DASH.DASHBOARD.VIEW
NOTI.NOTIFICATION.READ
```

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `seed_batch_id` | UUID | Có | FK `seed_batches.id` |
| `company_id` | UUID | Không | NULL = global, có = company seed |
| `target_table` | VARCHAR(100) | Có | Bảng được seed |
| `target_key` | VARCHAR(255) | Có | Business key của row seed |
| `operation` | VARCHAR(50) | Có | Insert/Update/Upsert/Delete/Skip |
| `payload` | JSONB | Không | Payload seed |
| `checksum` | VARCHAR(128) | Không | Checksum item |
| `status` | VARCHAR(50) | Có | Pending/Success/Failed/Skipped |
| `target_id` | UUID | Không | ID bản ghi sau khi seed |
| `error_message` | TEXT | Không | Lỗi nếu có |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |

#### Constraint/index đề xuất

```sql
ALTER TABLE seed_items
ADD CONSTRAINT chk_seed_items_operation
CHECK (operation IN ('Insert', 'Update', 'Upsert', 'Delete', 'Skip'));

ALTER TABLE seed_items
ADD CONSTRAINT chk_seed_items_status
CHECK (status IN ('Pending', 'Success', 'Failed', 'Skipped'));

CREATE UNIQUE INDEX uq_seed_items_batch_target
ON seed_items (seed_batch_id, target_table, target_key);

CREATE INDEX idx_seed_items_target
ON seed_items (target_table, target_key);
```

#### Quy tắc nghiệp vụ

1. `target_key` là business key ổn định, không nên là UUID random.
2. Seed permissions dùng `permission_code` làm `target_key`.
3. Seed roles dùng `role_code` làm `target_key`.
4. Seed modules dùng `module_code` làm `target_key`.
5. Seed notification events dùng `event_code` làm `target_key`.
6. Seed dashboard widgets dùng `widget_code` làm `target_key`.
7. Seed item lỗi không được coi batch là Success.

---

### 8.14 Bảng `system_job_runs`

#### Mục đích

Ghi nhật ký mỗi lần chạy một system job nền (xem catalog job ở BACKEND-11 §18.2: `TEMP_FILE_CLEANUP`, `DASHBOARD_CACHE_CLEANUP`, `AUDIT_LOG_RETENTION`, `FILE_ACCESS_LOG_RETENTION`, `NOTIFICATION_RETRY`, `TASK_OVERDUE_DETECTOR`, `LEAVE_ACCRUAL`...).

Dùng để:

1. Biết job nào đã chạy, lúc nào, kết quả gì.
2. Theo dõi số item xử lý/thành công/thất bại.
3. Hỗ trợ alert khi job lỗi nhiều lần.
4. Tránh trùng với `audit_logs` (audit ghi summary action `SYSTEM_JOB_RUN_COMPLETED`; bảng này lưu chi tiết kỹ thuật run).

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Không | NULL = job cấp system, có giá trị = job theo company |
| `job_code` | VARCHAR(100) | Có | Mã job (TEMP_FILE_CLEANUP, AUDIT_LOG_RETENTION...) |
| `status` | VARCHAR(50) | Có | Running/Success/Failed/Partial/Skipped |
| `triggered_by` | VARCHAR(50) | Có | Scheduler/User/System |
| `triggered_by_user_id` | UUID | Không | FK `users.id` nếu chạy thủ công |
| `started_at` | TIMESTAMP | Có | Thời điểm bắt đầu |
| `finished_at` | TIMESTAMP | Không | Thời điểm kết thúc |
| `duration_ms` | BIGINT | Không | Thời lượng chạy |
| `total_items` | INT | Không | Tổng item xử lý |
| `success_items` | INT | Không | Số item thành công |
| `failed_items` | INT | Không | Số item lỗi |
| `error_message` | TEXT | Không | Lỗi đã lọc nhạy cảm nếu có |
| `metadata` | JSONB | Không | Dữ liệu mở rộng (job_name, batch range...) |
| `created_at` | TIMESTAMP | Có | Thời điểm ghi |

#### Constraint/index đề xuất

```sql
ALTER TABLE system_job_runs
ADD CONSTRAINT chk_system_job_runs_status
CHECK (status IN ('Running', 'Success', 'Failed', 'Partial', 'Skipped'));

ALTER TABLE system_job_runs
ADD CONSTRAINT chk_system_job_runs_triggered_by
CHECK (triggered_by IN ('Scheduler', 'User', 'System'));

CREATE INDEX idx_system_job_runs_job_time
ON system_job_runs (job_code, started_at DESC);

CREATE INDEX idx_system_job_runs_company_job_time
ON system_job_runs (company_id, job_code, started_at DESC);
```

#### Quy tắc nghiệp vụ

1. Mỗi lần chạy job tạo một row mới; không update sau khi finish ngoài việc set kết quả cuối.
2. Job nền chạy với `triggered_by = Scheduler`; chạy thủ công cần permission `FOUNDATION.JOB.RUN` và set `triggered_by = User` + `triggered_by_user_id`.
3. Không ghi secret/token vào `error_message` hoặc `metadata`.
4. Có thể partition theo tháng nếu dữ liệu lớn.

---

### 8.15 Bảng `system_job_locks`

#### Mục đích

Tránh nhiều instance backend chạy cùng một job đồng thời (giải pháp thay thế PostgreSQL advisory lock).

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `job_code` | VARCHAR(100) | Có | PK; mã job |
| `locked_by` | VARCHAR(255) | Có | Instance/worker đang giữ lock |
| `locked_until` | TIMESTAMP | Có | Lock hết hạn (tránh deadlock khi worker chết) |
| `acquired_at` | TIMESTAMP | Có | Thời điểm acquire lock |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |

#### Constraint/index đề xuất

```sql
-- job_code là PRIMARY KEY nên đã unique; lock theo job.
CREATE INDEX idx_system_job_locks_locked_until
ON system_job_locks (locked_until);
```

#### Quy tắc nghiệp vụ

1. Trước khi chạy job, worker acquire lock theo `job_code`; nếu đã có lock còn hạn (`locked_until > now()`) thì bỏ qua lần chạy này.
2. Worker hoàn tất hoặc lỗi phải release lock (xóa row hoặc set `locked_until` về quá khứ).
3. `locked_until` giúp tự giải phóng lock khi worker chết giữa chừng.
4. MVP có thể dùng PostgreSQL advisory lock thay bảng này; bảng dùng khi cần lock có thể quan sát/audit.

---

### 8.16 Bảng `user_preferences`

#### Mục đích

Lưu tùy chọn cá nhân theo user cho module **ME** (Trung tâm cá nhân, SPEC-09 §15.2): giao diện, locale, timezone, format ngày giờ, trang mặc định sau login, module yêu thích và cấu hình layout ME. Đây là tầng **User** trong precedence setting (§5.9): System → Company → **User**.

> **BẤT BIẾN #1 (DECISIONS-02 §2):** `user_preferences` có `company_id` NOT NULL, bật **RLS ENABLE + FORCE ROW LEVEL SECURITY** với policy `tenant_isolation` (`company_id = current_setting('app.current_company_id')::uuid`). Mọi truy vấn đi qua `withTenant(companyId, fn)`; không query trần. `UNIQUE (company_id, user_id)` bảo đảm mỗi user trong một tenant chỉ có một bản ghi preference.

> **Phạm vi (SPEC-09 §15.3, phương án B):** nếu owner chọn tái dùng hệ setting hiện có mở rộng sang scope User thay vì tạo bảng riêng thì bỏ bảng này và lưu tầng User trong bảng setting mở rộng; quyết định canonical chốt ở PR (ME-DEC / S5-ME-DB-1). DB-08 lấy bảng riêng làm phương án A mặc định.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` — tenant (bất biến #1, RLS+FORCE) |
| `user_id` | UUID | Có | FK `users.id` — user sở hữu preference |
| `locale` | VARCHAR(20) | Không | Ngôn ngữ (`vi`/`en`); fallback company/system |
| `timezone` | VARCHAR(64) | Không | Múi giờ; chỉ override nếu company policy cho phép (ME-DEC-008) |
| `theme` | VARCHAR(20) | Không | `system`/`light`/`dark` |
| `date_format` | VARCHAR(30) | Không | Format ngày |
| `time_format` | VARCHAR(10) | Không | `12h`/`24h` |
| `default_landing` | VARCHAR(120) | Không | Trang/route mặc định sau login |
| `density` | VARCHAR(20) | Không | `comfortable`/`compact` |
| `favorite_modules` | JSONB | Không | Danh sách module yêu thích |
| `me_layout_config` | JSONB | Không | Cấu hình layout khu vực ME |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
-- Bất biến #1: bật RLS + FORCE và policy tenant trước khi ghi dữ liệu.
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_preferences
USING (company_id = current_setting('app.current_company_id')::uuid)
WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);

ALTER TABLE user_preferences
ADD CONSTRAINT chk_user_preferences_theme
CHECK (theme IS NULL OR theme IN ('system', 'light', 'dark'));

ALTER TABLE user_preferences
ADD CONSTRAINT chk_user_preferences_density
CHECK (density IS NULL OR density IN ('comfortable', 'compact'));

-- Mỗi user (trong 1 tenant) chỉ có 1 bản ghi preference (xem DB-09).
CREATE UNIQUE INDEX idx_user_preferences_company_user
ON user_preferences (company_id, user_id);
```

#### Quy tắc nghiệp vụ

1. Endpoint ME resolve `user_id` + `company_id` từ access token, **không** nhận từ client (SPEC-09 §14.4).
2. Upsert theo business key `company_id + user_id` (idempotent).
3. `timezone`/`locale` chỉ được override nếu company policy cho phép; nếu không, fallback company/system setting theo precedence §5.9.
4. Thay đổi notification preference bắt buộc/security không lưu ở đây mà ở `notification_preferences`/AUTH (SPEC-09 §16 lưu ý).
5. Không lưu dữ liệu nhạy cảm/secret trong `favorite_modules`/`me_layout_config`.

#### Precedence khi đọc preference cá nhân

```text
1. user_preferences active theo company_id + user_id
2. company_settings theo company_id (nếu key có ở company scope)
3. system_settings theo setting_key
4. default hard-coded trong service
```

---

## 9. Ma trận bảng Foundation và module sử dụng

| Bảng foundation | AUTH | HR | ATT | LEAVE | TASK | NOTI | DASH | Phase sau |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `companies` | Có | Có | Có | Có | Có | Có | Có | Tất cả |
| `modules` | Có | Có | Có | Có | Có | Có | Có | Tất cả |
| `system_settings` | Có | Có | Có | Có | Có | Có | Có | Tất cả |
| `company_settings` | Có | Có | Có | Có | Có | Có | Có | Tất cả |
| `audit_logs` | Có | Có | Có | Có | Có | Có | Có | Tất cả |
| `files` | Avatar | Hồ sơ/HĐ | Bằng chứng | Đính kèm | File task | Icon sau | Icon sau | Tất cả |
| `file_links` | Avatar | Hồ sơ/HĐ | Bằng chứng | Đính kèm | File task/project | Sau MVP | Sau MVP | Tất cả |
| `file_access_logs` | Avatar/private | Hồ sơ nhạy cảm | Bằng chứng | Lý do/file nghỉ | File dự án | Sau MVP | Sau MVP | Tất cả |
| `sequence_counters` | User code nếu cần | Employee/Contract | Adjustment/Remote | Leave request | Project/Task | Sau MVP | Không | Tất cả |
| `public_holidays` | Không | Tham khảo | Tính công | Tính phép | Cảnh báo deadline | Không | Lịch nghỉ | Payroll |
| `data_retention_policies` | Login/session | Hồ sơ/file | Log công | Đơn/file | Task/file | Notification | Cache | Tất cả |
| `seed_batches` | Permission/role | Master data | Rule seed | Leave type | Status/widget | Event/template | Widget | Tất cả |
| `seed_items` | Permission/role | Master data | Rule seed | Leave type | Status/widget | Event/template | Widget | Tất cả |
| `user_preferences` | Preference tài khoản | — | — | — | — | — | Layout/landing | ME (Own) — SPEC-09 |

---

## 10. Quy tắc bảo mật dữ liệu Foundation

### 10.1 Bảo mật audit log

1. Chỉ Admin/Super Admin hoặc vai trò có permission audit mới xem được audit log.
2. HR có thể xem audit liên quan HR nếu được cấp quyền.
3. Employee không được xem audit log hệ thống.
4. Audit log không chứa secret, password, token, signed URL.
5. Dữ liệu nhạy cảm phải mask trước khi ghi.
6. Export audit log cần permission riêng và phải ghi audit log.

Permission đề xuất:

```text
FOUNDATION.AUDIT_LOG.VIEW
FOUNDATION.AUDIT_LOG.EXPORT
```

### 10.2 Bảo mật file

1. File private không trả storage path trực tiếp.
2. File download phải kiểm tra permission module gốc.
3. Signed URL nếu dùng phải có thời hạn ngắn.
4. File nhạy cảm phải ghi `file_access_logs` khi preview/download.
5. File bị soft delete không được download.
6. File tạm hết hạn phải cleanup.
7. File nghi nhiễm virus không được link entity.
8. Không dùng URL public cho hợp đồng, CCCD/CMND, hồ sơ nhân viên, file nghỉ phép, file điều chỉnh công.

Permission đề xuất:

```text
FOUNDATION.FILE.VIEW
FOUNDATION.FILE.UPLOAD
FOUNDATION.FILE.DOWNLOAD
FOUNDATION.FILE.DELETE
```

### 10.3 Bảo mật settings

1. Cấu hình public mới được frontend đọc trực tiếp.
2. Cấu hình sensitive chỉ Admin/Super Admin được xem.
3. Secret không lưu raw value trong database nếu có secret manager.
4. Thay đổi setting quan trọng cần audit log.
5. Thay đổi cấu hình security/file/audit nên yêu cầu quyền cao.

Permission đề xuất:

```text
SYSTEM.SETTING.VIEW
SYSTEM.SETTING.UPDATE
SYSTEM.SETTING.VIEW_SENSITIVE
```

### 10.4 Bảo mật sequence

1. Chỉ service backend được tăng counter.
2. User không gọi trực tiếp API tăng sequence.
3. Cập nhật format/rule sinh mã cần quyền quản trị.
4. Override mã thủ công ở module HR phải kiểm tra permission riêng.
5. Không cho tạo mã trùng trong cùng company/module.

Permission đề xuất:

```text
SYSTEM.SEQUENCE.VIEW
SYSTEM.SEQUENCE.UPDATE
SYSTEM.SEQUENCE.GENERATE
```

---

## 11. Chiến lược migration MVP

### 11.1 Nguyên tắc migration

1. Migration phải chạy được trên database trống.
2. Migration phải tách schema và seed rõ ràng.
3. Foundation phải tạo trước AUTH vì `users.company_id` phụ thuộc `companies`.
4. Một số FK vòng giữa `companies`, `users`, `files` cần thêm sau.
5. Seed permission/module/role phải idempotent.
6. Không hard-code UUID nếu không cần.
7. Mỗi migration nhỏ, rõ mục đích, dễ rollback.

### 11.2 Thứ tự migration đề xuất

```text
000_enable_extensions.sql
001_create_foundation_companies_modules.sql
002_create_foundation_settings.sql
003_create_foundation_audit_logs.sql
004_create_foundation_files.sql
005_create_foundation_sequence_holidays.sql
006_create_foundation_retention_seed_tracking.sql
007_create_foundation_system_jobs.sql   -- system_job_runs, system_job_locks

010_create_auth_users_roles_permissions.sql
011_create_auth_sessions_logs_security.sql
012_add_foundation_fk_to_users_files.sql

020_create_hr_core.sql
021_create_hr_contract_profile_change.sql
022_create_hr_employee_code_config.sql

030_create_att_shift_rules.sql
031_create_att_records_logs.sql
032_create_att_adjustment_remote.sql

040_create_leave_types_policies.sql
041_create_leave_balances_requests.sql
042_create_leave_approvals_days.sql

050_create_task_projects_tasks.sql
051_create_task_comments_checklists_files.sql
052_create_task_activity_logs.sql

060_create_noti_events_templates.sql
061_create_noti_notifications_delivery.sql
062_create_dash_widgets_configs_cache.sql

070_add_cross_module_indexes.sql
080_seed_mvp_modules.sql
081_seed_mvp_permissions.sql
082_seed_mvp_roles_role_permissions.sql
083_seed_mvp_company_settings.sql
084_seed_mvp_notification_events_templates.sql
085_seed_mvp_dashboard_widgets.sql
086_seed_mvp_leave_types_attendance_defaults.sql
```

### 11.3 Xử lý FK vòng

Một số quan hệ cần thêm FK sau:

| Cột | Lý do |
| --- | --- |
| `companies.created_by` -> `users.id` | `companies` tạo trước `users` |
| `companies.logo_file_id` -> `files.id` | `companies` tạo trước `files` |
| `users.avatar_file_id` -> `files.id` | AUTH tạo sau Foundation |
| `files.uploaded_by` -> `users.id` | `files` có thể tạo trước `users` nếu foundation migration |

Cách xử lý:

1. Cho phép nullable ở migration đầu.
2. Thêm FK sau khi bảng đích tồn tại.
3. Không bắt buộc `created_by` trong seed hệ thống đầu tiên.

---

## 12. Seed data MVP

### 12.1 Seed bắt buộc

| Nhóm seed | Bảng đích | Ghi chú |
| --- | --- | --- |
| Company mặc định | `companies` | Nếu triển khai single-company MVP |
| Module MVP | `modules` | AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI |
| Module phase sau | `modules` | PAYROLL, RECRUIT, ASSET, ROOM, CHAT, SOCIAL, MOBILE, AI inactive |
| System settings | `system_settings` | timezone, locale, file max size, audit retention |
| Company settings | `company_settings` | override mặc định cho company |
| Permissions | `permissions` | Từ DB-02 đến DB-07 |
| Roles | `roles` | Super Admin, Admin công ty, HR, Manager, Employee |
| Role permissions | `role_permissions` | Permission + data scope |
| Sequence counters | `sequence_counters` | Employee code, leave request, project, task |
| Public holidays | `public_holidays` | Có thể seed ngày lễ VN cơ bản hoặc để HR/Admin nhập |
| Notification events | `notification_events` | Event AUTH/HR/ATT/LEAVE/TASK |
| Notification templates | `notification_templates` | Template IN_APP vi-VN |
| Dashboard widgets | `dashboard_widgets` | Widget Employee/Manager/HR/Admin |
| Dashboard configs | `dashboard_widget_configs` | Cấu hình widget mặc định theo role |
| Leave types | `leave_types` | Annual, unpaid, sick, other |
| Attendance defaults | `shifts`, `attendance_rules` | Nếu MVP cần seed ca/rule mặc định |

### 12.2 Seed module code

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
SYSTEM
```

### 12.3 Seed system settings đề xuất

| Key | Value ví dụ | Public | Sensitive |
| --- | --- | --- | --- |
| `system.default_timezone` | `"Asia/Ho_Chi_Minh"` | true | false |
| `system.default_locale` | `"vi-VN"` | true | false |
| `file.max_upload_size_mb` | `20` | false | false |
| `file.allowed_mime_types` | `["image/png","image/jpeg","application/pdf"]` | false | false |
| `file.default_visibility` | `"Private"` | false | false |
| `audit.default_retention_days` | `365` | false | false |
| `security.session_ttl_minutes` | `1440` | false | false |
| `security.password_min_length` | `8` | false | false |
| `notification.default_channels` | `["IN_APP"]` | false | false |
| `dashboard.cache_default_ttl_seconds` | `300` | false | false |

### 12.4 Seed sequence counters đề xuất

| Sequence key | Prefix | Reset | Padding | Ví dụ |
| --- | --- | --- | --- | --- |
| `EMPLOYEE_CODE` | `EMP` | Never | 4 | EMP0001 |
| `CONTRACT_CODE` | `CT` | Yearly | 4 | CT-2026-0001 |
| `LEAVE_REQUEST_CODE` | `LV` | Yearly | 4 | LV-2026-0001 |
| `PROJECT_CODE` | `PRJ` | Yearly | 4 | PRJ-2026-0001 |
| `TASK_CODE` | `TASK` | Yearly | 5 | TASK-2026-00001 |
| `ATT_ADJUSTMENT_CODE` | `ADJ` | Yearly | 4 | ADJ-2026-0001 |
| `REMOTE_WORK_REQUEST_CODE` | `RW` | Yearly | 4 | RW-2026-0001 |

### 12.5 Seed retention policy đề xuất

| Module | Entity | Retention | Cleanup |
| --- | --- | --- | --- |
| SYSTEM | AuditLog | 365 ngày | Archive |
| SYSTEM | FileAccessLog | 365 ngày | Archive |
| SYSTEM | TemporaryFile | 7 ngày | Delete |
| SYSTEM | DeletedFile | 90 ngày | Delete |
| AUTH | LoginLog | 365 ngày | Archive |
| NOTI | Notification | 365 ngày | Archive |
| DASH | DashboardCache | 1 ngày | Delete |

---

## 13. Query pattern quan trọng

### 13.1 Đọc setting có fallback

```sql
SELECT setting_value
FROM company_settings
WHERE company_id = :company_id
  AND setting_key = :setting_key
  AND status = 'Active'
  AND deleted_at IS NULL
UNION ALL
SELECT setting_value
FROM system_settings
WHERE setting_key = :setting_key
  AND status = 'Active'
ORDER BY 1
LIMIT 1;
```

Trong thực tế nên xử lý precedence ở service để tránh logic SQL khó đọc.

### 13.2 Lấy file của entity

```sql
SELECT f.*, fl.link_type, fl.purpose, fl.is_primary
FROM file_links fl
JOIN files f ON f.id = fl.file_id
WHERE fl.company_id = :company_id
  AND fl.module_code = :module_code
  AND fl.entity_type = :entity_type
  AND fl.entity_id = :entity_id
  AND fl.deleted_at IS NULL
  AND f.deleted_at IS NULL
ORDER BY fl.is_primary DESC, fl.sort_order ASC, fl.created_at ASC;
```

### 13.3 Lấy audit log của một entity

```sql
SELECT *
FROM audit_logs
WHERE company_id = :company_id
  AND module_code = :module_code
  AND entity_type = :entity_type
  AND entity_id = :entity_id
ORDER BY created_at DESC
LIMIT :limit OFFSET :offset;
```

### 13.4 Sinh mã tự động an toàn

```sql
BEGIN;

SELECT *
FROM sequence_counters
WHERE company_id = :company_id
  AND sequence_key = :sequence_key
  AND deleted_at IS NULL
FOR UPDATE;

UPDATE sequence_counters
SET current_value = current_value + increment_by,
    updated_at = now()
WHERE id = :id;

COMMIT;
```

Service sau đó format code theo `prefix`, `padding_length`, `reset_policy`, `format_pattern`.

### 13.5 Kiểm tra ngày lễ

```sql
SELECT *
FROM public_holidays
WHERE holiday_date = :work_date
  AND status = 'Active'
  AND deleted_at IS NULL
  AND (
    company_id = :company_id
    OR (company_id IS NULL AND country_code = :country_code)
  )
ORDER BY company_id NULLS LAST
LIMIT 1;
```

---

## 14. Service layer đề xuất

### 14.1 Company service

Chịu trách nhiệm:

1. Tạo/cập nhật company.
2. Lấy thông tin tenant hiện tại.
3. Kiểm tra company active/suspended.
4. Quản lý logo công ty.
5. Cung cấp timezone/locale mặc định.

### 14.2 Setting service

Chịu trách nhiệm:

1. Đọc setting theo precedence.
2. Validate setting bằng schema.
3. Mask setting sensitive.
4. Cache setting ngắn hạn.
5. Ghi audit khi cập nhật setting.

### 14.3 Audit service

Chịu trách nhiệm:

1. Chuẩn hóa action code.
2. Tự động lấy actor từ auth context.
3. Mask field nhạy cảm.
4. Ghi audit log async hoặc sync tùy độ quan trọng.
5. Hỗ trợ query audit theo entity/user/action.

### 14.4 File service

Chịu trách nhiệm:

1. Validate file size/MIME type.
2. Upload file lên storage.
3. Tạo metadata trong `files`.
4. Link file với entity qua `file_links`.
5. Kiểm tra permission khi preview/download.
6. Tạo signed URL nếu dùng object storage.
7. Ghi `file_access_logs`.
8. Cleanup file tạm.

### 14.5 Sequence service

Chịu trách nhiệm:

1. Sinh mã tự động theo key.
2. Lock counter khi tăng số.
3. Reset counter theo năm/tháng/ngày.
4. Format mã theo pattern.
5. Đảm bảo không trùng mã trong company.

### 14.6 Holiday service

Chịu trách nhiệm:

1. Tra cứu ngày lễ theo company/country.
2. Cho ATT biết ngày có cần chấm công không.
3. Cho LEAVE biết ngày có trừ phép không.
4. Cung cấp dữ liệu lịch nghỉ cho DASH nếu cần.

### 14.7 Seed service

Chịu trách nhiệm:

1. Chạy seed theo version.
2. Ghi `seed_batches`, `seed_items`.
3. Upsert seed data idempotent.
4. Phát hiện checksum thay đổi.
5. Dừng seed nếu item critical lỗi.

---

## 15. API gợi ý cho Foundation

DB-08 không phải API Design chi tiết, nhưng database nên hỗ trợ các API sau.

### 15.1 Company API

```text
GET    /api/companies/current
GET    /api/admin/companies
POST   /api/admin/companies
PATCH  /api/admin/companies/{company_id}
PATCH  /api/admin/companies/{company_id}/status
```

### 15.2 Setting API

```text
GET    /api/settings/public
GET    /api/admin/settings/system
PATCH  /api/admin/settings/system/{setting_key}
GET    /api/admin/settings/company
PATCH  /api/admin/settings/company/{setting_key}
```

### 15.3 Audit API

```text
GET    /api/admin/audit-logs
GET    /api/admin/audit-logs/{id}
GET    /api/admin/audit-logs/entity/{module_code}/{entity_type}/{entity_id}
EXPORT /api/admin/audit-logs/export
```

### 15.4 File API

```text
POST   /api/files/upload
GET    /api/files/{file_id}
GET    /api/files/{file_id}/download
POST   /api/files/{file_id}/links
DELETE /api/files/{file_id}/links/{file_link_id}
GET    /api/files/entity/{module_code}/{entity_type}/{entity_id}
GET    /api/admin/files/access-logs
```

### 15.5 Sequence API nội bộ

Không nên public cho frontend:

```text
POST /internal/sequences/{sequence_key}/next
GET  /internal/sequences/{sequence_key}/preview
```

### 15.6 Holiday API

```text
GET    /api/admin/public-holidays
POST   /api/admin/public-holidays
PATCH  /api/admin/public-holidays/{id}
DELETE /api/admin/public-holidays/{id}
GET    /api/calendar/holidays?from=&to=
```

---

## 16. Test case database Foundation

### 16.1 Companies

- [ ] Không tạo trùng `company_code` active.
- [ ] Không cho user thường sửa company.
- [ ] Company suspended thì user thuộc company không đăng nhập được.
- [ ] Soft delete company không xóa dữ liệu liên quan.

### 16.2 Settings

- [ ] Đọc company setting ưu tiên hơn system setting.
- [ ] Nếu company setting không có thì fallback system setting.
- [ ] Không trả setting sensitive cho API public.
- [ ] Update setting ghi audit log.
- [ ] Không cho value sai `validation_schema`.

### 16.3 Audit logs

- [ ] Tạo employee ghi audit log CREATE.
- [ ] Cập nhật dữ liệu nhạy cảm mask trong `old_values/new_values`.
- [ ] Export dữ liệu ghi audit log EXPORT.
- [ ] Audit log có `request_id` để trace.
- [ ] User không có quyền không xem được audit log.

### 16.4 Files

- [ ] Không upload file vượt size.
- [ ] Không upload MIME type bị cấm.
- [ ] File private không trả `storage_path` cho frontend.
- [ ] File chưa scan hoặc infected không được link nếu policy yêu cầu.
- [ ] Link file khác company bị chặn.
- [ ] Download file nhạy cảm ghi `file_access_logs`.
- [ ] User không có quyền không download được file.
- [ ] File tạm hết hạn bị cleanup.

### 16.5 Sequence

- [ ] Sinh mã không trùng khi gọi đồng thời.
- [ ] Reset yearly đúng khi sang năm mới.
- [ ] Padding đúng độ dài.
- [ ] Scope department sinh mã độc lập nếu cấu hình.
- [ ] Manual override không làm sequence sinh mã trùng.

### 16.6 Public holidays

- [ ] Holiday company override global holiday.
- [ ] ATT nhận biết ngày nghỉ không cần chấm công.
- [ ] LEAVE không trừ phép ngày holiday nếu config yêu cầu.
- [ ] WorkingDayOverride biến ngày nghỉ thành ngày làm việc.
- [ ] Cập nhật holiday quá khứ cần quyền cao và ghi audit.

### 16.7 Seeds

- [ ] Chạy seed lần 1 tạo dữ liệu.
- [ ] Chạy seed lần 2 không tạo trùng.
- [ ] Seed checksum thay đổi nhưng version không đổi thì báo lỗi.
- [ ] Seed permission đầy đủ cho AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI.
- [ ] Seed role_permissions đúng data scope.
- [ ] Seed notification events/templates và dashboard widgets đúng business key.

---

## 17. Rủi ro và phương án giảm thiểu

| Rủi ro | Mức độ | Giảm thiểu |
| --- | --- | --- |
| Audit log phình quá nhanh | Cao | Index đúng, partition theo tháng, retention/archive policy |
| Lộ dữ liệu nhạy cảm trong audit log | Rất cao | Mask field trước khi insert, không log secret/token |
| File private bị truy cập bằng URL trực tiếp | Rất cao | Không public storage path, dùng signed URL ngắn hạn, kiểm tra permission |
| File metadata và storage bị lệch | Cao | Upload transaction pattern, job reconcile, upload_status rõ ràng |
| Race condition khi sinh mã | Cao | Dùng transaction + `FOR UPDATE` trên `sequence_counters` |
| Setting quá linh hoạt gây khó kiểm soát | Trung bình | Có validation_schema, permission, audit log |
| Public holiday thay đổi làm lệch công/phép | Cao | Ghi audit, yêu cầu quyền cao, cho phép re-calculate có kiểm soát |
| Seed chạy nhiều lần tạo trùng | Cao | Seed idempotent bằng business key, seed_batches, seed_items |
| FK vòng giữa foundation và auth/file | Trung bình | Cho nullable ban đầu, add FK sau migration AUTH/files |
| Multi-tenant leak | Rất cao | Mọi query vận hành filter `company_id`, unique index có company_id |

---

## 18. Checklist triển khai backend

### 18.1 Migration

- [ ] Bật extension `pgcrypto`.
- [ ] Tạo bảng `companies`.
- [ ] Tạo bảng `modules`.
- [ ] Tạo bảng `system_settings`.
- [ ] Tạo bảng `company_settings`.
- [ ] Tạo bảng `audit_logs`.
- [ ] Tạo bảng `files`.
- [ ] Tạo bảng `file_links`.
- [ ] Tạo bảng `file_access_logs`.
- [ ] Tạo bảng `sequence_counters`.
- [ ] Tạo bảng `public_holidays`.
- [ ] Tạo bảng `data_retention_policies`.
- [ ] Tạo bảng `seed_batches`.
- [ ] Tạo bảng `seed_items`.
- [ ] Tạo bảng `system_job_runs`.
- [ ] Tạo bảng `system_job_locks`.
- [ ] Tạo index/constraint theo tài liệu.
- [ ] Add FK vòng sau khi AUTH/files hoàn tất.

### 18.2 Service

- [ ] Company service.
- [ ] Setting service.
- [ ] Audit service.
- [ ] File upload service.
- [ ] File permission service.
- [ ] File access log service.
- [ ] Sequence service.
- [ ] Holiday service.
- [ ] Retention cleanup job.
- [ ] Seed service.

### 18.3 Security

- [ ] Mask field nhạy cảm trong audit.
- [ ] Không trả setting sensitive qua public API.
- [ ] Không trả storage path file private.
- [ ] Kiểm tra permission trước khi download file.
- [ ] Ghi log truy cập file nhạy cảm.
- [ ] Kiểm tra company_id trong mọi query foundation.
- [ ] Chặn file infected.
- [ ] Validate MIME type và file size.

### 18.4 Seed

- [ ] Seed modules MVP.
- [ ] Seed modules phase sau inactive.
- [ ] Seed system settings.
- [ ] Seed default company nếu cần.
- [ ] Seed company settings mặc định.
- [ ] Seed sequence counters.
- [ ] Seed permissions.
- [ ] Seed roles.
- [ ] Seed role permissions.
- [ ] Seed notification events/templates.
- [ ] Seed dashboard widgets/configs.
- [ ] Seed leave types/attendance defaults nếu cần.

---

## 19. Quyết định thiết kế đã chốt

1. DB-08 là tài liệu Foundation, không phải module nghiệp vụ riêng.
2. `companies` là tenant root cho toàn bộ dữ liệu MVP.
3. `modules` là catalog module dùng chung cho permission, audit, notification, dashboard và settings.
4. `system_settings` lưu global default, `company_settings` lưu company override.
5. Không dùng settings để thay thế bảng rule/policy nghiệp vụ phức tạp.
6. `audit_logs` là append-only ledger cho thao tác quan trọng.
7. Audit log phải mask dữ liệu nhạy cảm trước khi ghi.
8. File binary không lưu trong database, chỉ lưu metadata ở `files`.
9. File private là mặc định; không trả storage path trực tiếp cho frontend.
10. `file_links` dùng polymorphic reference, backend validate entity và permission.
11. `file_access_logs` nên có để theo dõi truy cập file nhạy cảm.
12. `sequence_counters` là nguồn sinh mã tự động, phải dùng transaction và row lock.
13. `public_holidays` dùng chung cho ATT và LEAVE.
14. `data_retention_policies` chuẩn bị retention/cleanup cho log, file, notification và cache.
15. `seed_batches` và `seed_items` giúp seed idempotent, dễ kiểm soát giữa môi trường.
16. `system_job_runs` lưu nhật ký chạy system job nền; `system_job_locks` chống chạy trùng (thay thế advisory lock khi cần) — chuẩn theo BACKEND-11 §18.5/§22.
17. Migration Foundation phải chạy trước AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH.
18. Một số FK vòng như `companies.created_by`, `files.uploaded_by`, `users.avatar_file_id` sẽ add sau khi bảng liên quan tồn tại.
19. Mọi bảng vận hành cần `company_id` và query phải filter theo auth context.
20. Seed MVP phải bao gồm modules, permissions, roles, role_permissions, settings, sequence, notification events/templates và dashboard widgets.
21. DB-08 là nền để tiếp tục viết DB-09 về Index, Query Pattern & Performance hoặc DB-10 Migration Plan & Initial Seed Data chi tiết.

---

## 20. Việc cần làm tiếp theo

Sau DB-08, nên triển khai tiếp một trong hai hướng sau:

```text
DB-09: Database Index, Query Pattern & Performance Design
```

DB-09 nên đi sâu vào:

1. Index tổng thể cho toàn bộ MVP.
2. Query pattern theo từng màn hình/API.
3. Pagination strategy.
4. Search/filter strategy.
5. Partition audit log, attendance log, notification log.
6. Dashboard cache performance.
7. Explain analyze checklist.
8. N+1 query prevention.
9. Data scope query optimization.
10. Chiến lược archive dữ liệu lớn.

Hoặc:

```text
DB-10: Migration Plan & Initial Seed Data
```

DB-10 nên đi sâu vào:

1. Thứ tự migration chi tiết.
2. SQL seed cụ thể.
3. Permission seed đầy đủ.
4. Role permission matrix seed.
5. Notification event/template seed.
6. Dashboard widget seed.
7. Leave type/attendance default seed.
8. Checklist chạy migration từ database trống.

---

## 21. Kết luận

DB-08 hoàn thiện lớp foundation cho hệ thống quản lý doanh nghiệp nội bộ theo hướng:

1. Có tenant/company rõ ràng.
2. Có module catalog thống nhất.
3. Có settings global và company override.
4. Có audit log append-only để truy vết thao tác quan trọng.
5. Có file storage metadata dùng chung toàn hệ thống.
6. Có file link polymorphic để các module dùng chung file service.
7. Có file access log để kiểm soát truy cập file nhạy cảm.
8. Có sequence counter an toàn để sinh mã tự động.
9. Có public holiday dùng chung cho chấm công và nghỉ phép.
10. Có retention policy để chuẩn bị cleanup/archive.
11. Có seed tracking để seed dữ liệu MVP idempotent.
12. Có thứ tự migration đủ rõ để triển khai database từ đầu.

Với DB-08, bộ database design MVP đã có nền tảng chung cho AUTH, HR, ATT, LEAVE, TASK, NOTI và DASH, đồng thời đủ mở để phát triển Payroll, Recruitment, Asset, Room, Chat, Social, Mobile và AI ở các phase sau.
