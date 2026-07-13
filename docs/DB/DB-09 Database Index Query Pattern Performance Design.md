> 🔒 **BẤT BIẾN DB (bổ sung bắt buộc):** Mọi bảng có `company_id` PHẢI bật **RLS + FORCE**; `audit_logs` **append-only** (REVOKE UPDATE/DELETE + trigger); audit/event ghi qua **outbox** trong cùng transaction nghiệp vụ. Bộ docs gốc CHƯA mô tả 3 cơ chế này — DDL mẫu + `withTenant`/`set_config` tại [DECISIONS-02 §2–3](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md).

# DB-09: DATABASE INDEX, QUERY PATTERN & PERFORMANCE DESIGN

**THIẾT KẾ INDEX, TRUY VẤN & HIỆU NĂNG DATABASE**

> **📚 Bộ tài liệu DB — Hệ thống Quản lý Doanh nghiệp**
> [DB-01 Tổng quan](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [DB-02 AUTH/RBAC](<DB-02 AUTH RBAC Database Design.md>) · [DB-03 HR](<DB-03_HR Database Design.md>) · [DB-04 ATT](<DB-04_ATT Database Design.md>) · [DB-05 LEAVE](<DB-05 LEAVE Database Design.md>) · [DB-06 TASK](<DB-06 TASK Database Design.md>) · [DB-07 NOTI/DASH](<DB-07 NOTI DASH Database Design.md>) · [DB-08 Audit/Files/Settings](<DB-08 Audit Files Settings Seeds Database Design.md>) · **DB-09 Index/Hiệu năng** · [DB-10 Migration/Seed](<DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>)
>
> **Nguồn & liên quan:** [PRD-00 §12.2](<../PRD/PRD-00 Enterprise Management System .md>) · [SPEC-01 Tổng quan (§23 hiệu năng)](<../SPEC/SPEC-01 Tổng quan.md>) · [Chuẩn API: API-01 Tổng quan](<../API Design/API-01 TỔNG QUAN.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DB-09 |
| Tên tài liệu | Database Index, Query Pattern & Performance Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Nhóm dữ liệu | Cross-module / Performance / Query Optimization |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0, chuẩn bị mở rộng Phase 2+ |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-08 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả thiết kế index, query pattern và chiến lược hiệu năng database cho toàn bộ hệ thống quản lý doanh nghiệp nội bộ.

DB-09 không thiết kế thêm một module nghiệp vụ mới. DB-09 là tài liệu tối ưu hóa xuyên suốt các nhóm bảng đã được định nghĩa trong:

1. DB-02 AUTH & RBAC.
2. DB-03 HR.
3. DB-04 ATT.
4. DB-05 LEAVE.
5. DB-06 TASK.
6. DB-07 NOTI & DASH.
7. DB-08 Audit, Files, Settings, Seeds.

Tài liệu này dùng để:

1. Chuẩn hóa cách tạo index cho toàn bộ database.
2. Xác định query pattern quan trọng theo từng màn hình/API.
3. Tối ưu pagination, search, filter, sort.
4. Giảm rủi ro query chậm khi dữ liệu tăng.
5. Chuẩn bị partition cho các bảng log lớn.
6. Chuẩn hóa cách query theo `company_id`, permission và data scope.
7. Tối ưu Dashboard cache và Notification unread count.
8. Hạn chế N+1 query khi backend trả dữ liệu danh sách.
9. Làm cơ sở cho backend triển khai migration index và kiểm thử `EXPLAIN ANALYZE`.

---

## 3. Lý do cần DB-09

Các tài liệu DB-02 -> DB-08 đã mô tả bảng, field, quan hệ, constraint và nghiệp vụ chính. Tuy nhiên hệ thống này có nhiều truy vấn có khả năng phát sinh tải lớn:

1. Danh sách nhân viên theo phòng ban, trạng thái, từ khóa.
2. Bảng công theo tháng, team, phòng ban, công ty.
3. Log chấm công thô theo thời gian.
4. Đơn nghỉ chờ duyệt theo manager/HR.
5. Task của tôi, task team, Kanban, task quá hạn.
6. Thông báo chưa đọc theo user.
7. Dashboard tổng hợp theo role và data scope.
8. Audit log, login log, notification delivery log tăng rất nhanh.

Nếu chỉ có bảng đúng mà không có index/query strategy, hệ thống dễ gặp vấn đề:

1. API danh sách chậm khi dữ liệu tăng.
2. Dashboard timeout do query tổng hợp trực tiếp quá nhiều bảng.
3. Notification badge chậm nếu mỗi lần đếm unread phải scan bảng lớn.
4. Export HR/ATT/LEAVE làm ảnh hưởng truy vấn realtime.
5. Permission/data scope query bị lặp, gây N+1.
6. Log lớn làm database phình to và vacuum/index chậm.

DB-09 giải quyết các rủi ro trên ở tầng thiết kế database.

---

## 4. Phạm vi thiết kế

### 4.1 Bao gồm trong DB-09

DB-09 bao gồm:

| Nhóm | Nội dung |
| --- | --- |
| Index convention | Quy ước đặt tên index, thứ tự cột, partial index, unique index |
| Cross-module indexes | Index dùng chung cho `company_id`, soft delete, audit columns, FK |
| Module indexes | Index đề xuất cho Foundation, AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH |
| Query pattern | Các query quan trọng theo màn hình/API |
| Pagination | Offset pagination, keyset pagination, cursor strategy |
| Search/filter | Search theo normalized field, trigram, full-text search cơ bản |
| Data scope optimization | Tối ưu query Own, Team, Department, Project, Company, System |
| Partitioning | Partition audit log, attendance log, notification log, file access log |
| Dashboard performance | Cache key, TTL, invalidation, aggregate query |
| N+1 prevention | Query batch, join/preload, projection pattern |
| Explain checklist | Checklist kiểm tra query trước khi release |
| Archive strategy | Chiến lược lưu trữ dữ liệu lớn sau retention |

### 4.2 Không bao gồm trong DB-09

DB-09 không đi sâu vào:

1. Migration SQL đầy đủ cho từng bảng.
2. Stored procedure chi tiết cho từng nghiệp vụ.
3. Thiết kế data warehouse/BI nâng cao.
4. Thiết kế sharding database.
5. Thiết kế read replica hạ tầng cloud chi tiết.
6. Thiết kế từng API response DTO.
7. Thiết kế module Phase 2+ như PAYROLL/RECRUIT ở mức bảng chi tiết.

Các nội dung này có thể tách thành:

```text
DB-10: Migration Plan & Initial Seed Data
DB-11: Phase 2+ Extension Database Design
DB-12: Reporting, BI & Data Warehouse Design
```

---

## 5. Nguyên tắc hiệu năng tổng thể

### 5.1 PostgreSQL là database chính

Toàn bộ index/query pattern trong DB-09 giả định hệ thống dùng PostgreSQL.

Extension khuyến nghị:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Trong đó:

| Extension | Mục đích |
| --- | --- |
| `pgcrypto` | Sinh UUID bằng `gen_random_uuid()` |
| `pg_trgm` | Tối ưu tìm kiếm gần đúng theo tên/email/code |
| `unaccent` | Hỗ trợ search tiếng Việt không dấu nếu cần |

### 5.2 Mọi query nghiệp vụ phải có `company_id`

Vì hệ thống thiết kế sẵn multi-tenant, mọi query dữ liệu vận hành phải filter theo `company_id`.

Mẫu đúng:

```sql
SELECT *
FROM employees
WHERE company_id = :company_id
  AND deleted_at IS NULL;
```

Mẫu không được dùng:

```sql
SELECT *
FROM employees
WHERE deleted_at IS NULL;
```

Ngoại lệ:

1. Super Admin có scope System.
2. Bảng global như `permissions`, `modules`, `system_settings`.
3. Bảng có `company_id IS NULL` dùng làm global default.

### 5.3 Index chính nên bắt đầu bằng `company_id`

Đối với bảng dữ liệu tenant-specific, index nên đặt `company_id` ở đầu.

Ví dụ:

```sql
CREATE INDEX idx_employees_company_status_department
ON employees (company_id, employment_status, department_id)
WHERE deleted_at IS NULL;
```

Lý do:

1. Query luôn filter theo company.
2. Tăng khả năng PostgreSQL dùng index hiệu quả trong môi trường SaaS.
3. Tránh scan dữ liệu công ty khác.

### 5.4 Soft delete nên dùng partial index

Với bảng có `deleted_at`, index phục vụ query active nên dùng partial index.

Mẫu:

```sql
CREATE INDEX idx_tasks_active_by_company_status
ON tasks (company_id, status, due_at)
WHERE deleted_at IS NULL;
```

Không nên chỉ tạo:

```sql
CREATE INDEX idx_tasks_status
ON tasks (status);
```

vì phần lớn query nghiệp vụ chỉ đọc dữ liệu chưa bị xóa mềm.

### 5.5 Cột trạng thái và thời gian thường đi cùng nhau

Nhiều màn hình lọc theo status và sort theo thời gian.

Pattern phổ biến:

```text
company_id + status + created_at DESC
company_id + status + updated_at DESC
company_id + employee_id + work_date DESC
company_id + recipient_user_id + read_at + created_at DESC
```

### 5.6 Không over-index

Không tạo index cho mọi cột. Mỗi index làm tăng chi phí:

1. Insert chậm hơn.
2. Update chậm hơn.
3. Tốn storage.
4. Vacuum/index maintenance nặng hơn.
5. Migration production lâu hơn.

Chỉ tạo index khi:

1. Cột thường xuyên dùng trong `WHERE`, `JOIN`, `ORDER BY`.
2. Query xuất hiện trong màn hình/API quan trọng.
3. Bảng có khả năng tăng dữ liệu lớn.
4. `EXPLAIN ANALYZE` cho thấy sequential scan không hợp lý.

### 5.7 Foreign key nên có index phía con

PostgreSQL không tự tạo index cho foreign key. Các FK thường dùng join/filter cần index.

Ví dụ:

```sql
CREATE INDEX idx_employees_department_id
ON employees (department_id)
WHERE deleted_at IS NULL;
```

Tuy nhiên trong hệ thống multi-tenant, nên ưu tiên composite:

```sql
CREATE INDEX idx_employees_company_department
ON employees (company_id, department_id)
WHERE deleted_at IS NULL;
```

### 5.8 JSONB không thay thế relational column

JSONB chỉ dùng cho:

1. Metadata mở rộng.
2. Snapshot tính toán.
3. Payload thông báo.
4. Diff audit log.
5. Cấu hình linh hoạt.

Không nên giấu field nghiệp vụ thường xuyên filter vào JSONB.

Ví dụ không nên:

```text
employees.metadata.department_id
```

Nên dùng:

```text
employees.department_id
```

Nếu cần query JSONB thường xuyên, phải có GIN index hoặc expression index.

### 5.9 Mã nghiệp vụ cần unique index riêng

Các mã như `employee_code`, `leave_request_code`, `project_code`, `task_code` phải unique theo company.

Ví dụ:

```sql
CREATE UNIQUE INDEX uq_employees_company_employee_code_active
ON employees (company_id, employee_code)
WHERE deleted_at IS NULL;
```

### 5.10 Các bảng log lớn cần partition sớm

Những bảng có thể tăng nhanh:

1. `audit_logs`
2. `login_logs`
3. `attendance_logs`
4. `file_access_logs`
5. `notification_delivery_logs`
6. `task_activity_logs`

MVP có thể chưa partition nếu dữ liệu nhỏ, nhưng migration nên chuẩn bị cấu trúc để dễ chuyển sang partition theo tháng/quý.

---

## 6. Quy ước đặt tên index

### 6.1 Quy ước chung

```text
idx_{table}_{column_or_purpose}
uq_{table}_{column_or_purpose}
gin_{table}_{column_or_purpose}
brin_{table}_{column_or_purpose}
```

Ví dụ:

```text
idx_employees_company_status_department
uq_users_company_email_active
gin_tasks_search_text
brin_audit_logs_created_at
```

### 6.2 Quy ước partial index

Nếu index chỉ áp dụng cho active record, thêm hậu tố:

```text
_active
```

Ví dụ:

```sql
CREATE INDEX idx_leave_requests_pending_active
ON leave_requests (company_id, status, submitted_at DESC)
WHERE deleted_at IS NULL AND status = 'Pending';
```

### 6.3 Quy ước unique active

Nếu unique chỉ áp dụng khi chưa soft delete:

```text
uq_{table}_{business_key}_active
```

Ví dụ:

```sql
CREATE UNIQUE INDEX uq_users_company_email_active
ON users (company_id, normalized_email)
WHERE deleted_at IS NULL;
```

---

## 7. Index nền tảng dùng chung toàn hệ thống

### 7.1 Audit columns

Các bảng nghiệp vụ chính thường cần index:

```sql
CREATE INDEX idx_{table}_company_created_at
ON {table} (company_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_{table}_company_updated_at
ON {table} (company_id, updated_at DESC)
WHERE deleted_at IS NULL;
```

Không bắt buộc tạo cho mọi bảng ngay từ đầu. Chỉ nên tạo cho bảng có danh sách/sort theo thời gian.

### 7.2 Soft delete

Không cần tạo index riêng cho `deleted_at` nếu mọi query đã dùng partial index.

Chỉ tạo index theo `deleted_at` khi có màn hình thùng rác/khôi phục:

```sql
CREATE INDEX idx_{table}_company_deleted_at
ON {table} (company_id, deleted_at DESC)
WHERE deleted_at IS NOT NULL;
```

### 7.3 FK actor user

Các cột `created_by`, `updated_by`, `deleted_by` thường không cần index riêng trừ khi có màn hình audit theo actor.

Nếu cần:

```sql
CREATE INDEX idx_{table}_company_created_by
ON {table} (company_id, created_by, created_at DESC);
```

---

## 8. Index cho Foundation / DB-08

### 8.1 `companies`

#### Query chính

1. Tìm company theo `company_code`.
2. Lọc company theo status.
3. Super Admin xem danh sách tenant.

#### Index đề xuất

```sql
CREATE UNIQUE INDEX uq_companies_company_code_active
ON companies (company_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_companies_status_active
ON companies (status, created_at DESC)
WHERE deleted_at IS NULL;
```

### 8.2 `modules`

#### Query chính

1. Lấy module theo `module_code`.
2. Lấy danh sách module active.
3. Lấy module theo group.

#### Index đề xuất

```sql
CREATE UNIQUE INDEX uq_modules_module_code_active
ON modules (module_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_modules_group_active
ON modules (module_group, is_active, sort_order)
WHERE deleted_at IS NULL;
```

### 8.3 `system_settings`

#### Query chính

1. Lấy setting global theo key.
2. Lấy setting theo module/category.

#### Index đề xuất

```sql
CREATE UNIQUE INDEX uq_system_settings_key_active
ON system_settings (setting_key)
WHERE status = 'Active';

CREATE INDEX idx_system_settings_module_category
ON system_settings (module_code, category, status);
```

### 8.4 `company_settings`

#### Query chính

1. Lấy override setting theo company + key.
2. Lấy setting theo module/category.

#### Index đề xuất

```sql
CREATE UNIQUE INDEX uq_company_settings_company_key_active
ON company_settings (company_id, setting_key)
WHERE status = 'Active';

CREATE INDEX idx_company_settings_module_category
ON company_settings (company_id, module_code, category, status);
```

### 8.5 `audit_logs`

#### Query chính

1. Xem audit log theo company.
2. Lọc theo module, action, entity, actor, thời gian.
3. Truy vết theo `correlation_id`.

> **CHỐT 2026-07-02 (ghi chú lệch kế thừa — code thắng):** index audit thực tế (mig 0432/0438) có 2 index KHÔNG dẫn đầu bằng `company_id`: `idx_audit_logs_actor_created (actor_user_id, created_at DESC)` và `idx_audit_logs_entity (module_code, entity_type, entity_id)` — khác mẫu §8.5 (company_id-first). Chấp nhận: cô lập tenant ép ở RLS+FORCE (không phụ thuộc thứ tự cột index); các truy vấn có `company_id` vẫn dùng `idx_audit_logs_company_created`/`idx_audit_logs_action` (đều company_id-first). Không re-create ở WO này (tránh DROP index đang dùng).

#### Index đề xuất

```sql
CREATE INDEX idx_audit_logs_company_created_at
ON audit_logs (company_id, created_at DESC);

CREATE INDEX idx_audit_logs_company_module_action_time
ON audit_logs (company_id, module_code, action, created_at DESC);

CREATE INDEX idx_audit_logs_company_entity
ON audit_logs (company_id, entity_type, entity_id, created_at DESC);

CREATE INDEX idx_audit_logs_company_actor_time
ON audit_logs (company_id, actor_user_id, created_at DESC);

CREATE INDEX idx_audit_logs_correlation_id
ON audit_logs (correlation_id)
WHERE correlation_id IS NOT NULL;
```

#### Partition khuyến nghị

Nếu audit log lớn hơn 5-10 triệu dòng:

```text
Partition by RANGE(created_at), theo tháng hoặc quý.
```

### 8.6 `files`

#### Query chính

1. Lấy file theo id.
2. Lọc file theo người upload.
3. Cleanup file tạm/đã xóa.
4. Tìm file theo checksum để chống upload trùng.

#### Index đề xuất

```sql
CREATE INDEX idx_files_company_uploaded_at
ON files (company_id, uploaded_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_files_company_uploaded_by
ON files (company_id, uploaded_by, uploaded_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_files_company_status
ON files (company_id, upload_status, uploaded_at DESC)
WHERE deleted_at IS NULL;

<!-- CHỐT 2026-07-02 (doc-fix, khớp DB-08/code): bảng `files` KHÔNG có cột `checksum`; code (schema/files.ts) dùng `checksum_sha256` + `content_hash`. Index dedup thật = `idx_files_content_hash` trên (company_id, content_hash). Sửa dưới đây cho khớp code. -->
CREATE INDEX idx_files_content_hash
ON files (company_id, content_hash)
WHERE content_hash IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_files_cleanup_deleted
ON files (deleted_at)
WHERE deleted_at IS NOT NULL;
```

### 8.7 `file_links`

#### Query chính

1. Lấy file của một entity.
2. Kiểm tra file đang được link ở đâu.
3. Lọc file theo module.

#### Index đề xuất

```sql
CREATE INDEX idx_file_links_entity
ON file_links (company_id, module_code, entity_type, entity_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_file_links_file_id
ON file_links (file_id)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_file_links_entity_file_active
ON file_links (company_id, module_code, entity_type, entity_id, file_id, link_type)
WHERE deleted_at IS NULL;
```

### 8.8 `file_access_logs`

#### Query chính

1. Audit ai xem/tải file.
2. Truy vết file nhạy cảm.
3. Retention cleanup.

#### Index đề xuất

<!-- CHỐT 2026-07-02 (doc-fix, khớp DB-08/code): `file_access_logs` KHÔNG có cột thời-gian-truy-cập riêng; code (schema/files.ts, mig 0433) dùng `created_at` (timestamptz) làm mốc thời gian. Đã đổi cột index/partition dưới đây sang `created_at`. Index thật: idx_file_access_logs_file_created / _actor_created / _entity. -->

```sql
CREATE INDEX idx_file_access_logs_company_time
ON file_access_logs (company_id, created_at DESC);

CREATE INDEX idx_file_access_logs_file_time
ON file_access_logs (file_id, created_at DESC);

CREATE INDEX idx_file_access_logs_actor_time
ON file_access_logs (company_id, actor_user_id, created_at DESC);
```

#### Partition khuyến nghị

```text
Partition by RANGE(created_at), theo tháng.
```

### 8.9 `sequence_counters`

#### Query chính

1. Sinh mã tự động theo company + sequence key.
2. Lock row khi tăng counter.

#### Index đề xuất

```sql
CREATE UNIQUE INDEX uq_sequence_counters_company_key
ON sequence_counters (company_id, sequence_key);

CREATE INDEX idx_sequence_counters_reset
ON sequence_counters (reset_policy, last_reset_at)
WHERE reset_policy IN ('Yearly', 'Monthly', 'Daily');
```

> **Casing chuẩn = PascalCase** `Never/Yearly/Monthly/Daily`, khớp DB-08 CHECK `chk_sequence_counters_reset_policy` và seed DB-10. Nếu partial index dùng UPPER (`YEARLY`...) sẽ **không match** row PascalCase → index vô dụng.

#### Query sinh mã chuẩn

```sql
SELECT *
FROM sequence_counters
WHERE company_id = :company_id
  AND sequence_key = :sequence_key
FOR UPDATE;
```

### 8.10 `public_holidays`

#### Query chính

1. ATT/LEAVE kiểm tra một ngày có phải ngày nghỉ không.
2. Lấy danh sách ngày lễ trong khoảng thời gian.

#### Index đề xuất

```sql
CREATE INDEX idx_public_holidays_company_date
ON public_holidays (company_id, holiday_date)
WHERE deleted_at IS NULL;

CREATE INDEX idx_public_holidays_country_date
ON public_holidays (country_code, holiday_date)
WHERE deleted_at IS NULL;

<!-- CHỐT 2026-07-02 (doc-fix, khớp DB-08/code mig 0434): uq public_holidays key trên `holiday_code` (KHÔNG `name`), và tách 2 partial theo scope tenant: global (company_id IS NULL) vs company (company_id IS NOT NULL). -->
CREATE UNIQUE INDEX uq_public_holidays_global_date_code_active
ON public_holidays (country_code, holiday_date, holiday_code)
WHERE company_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_public_holidays_company_date_code_active
ON public_holidays (company_id, holiday_date, holiday_code)
WHERE company_id IS NOT NULL AND deleted_at IS NULL;
```

### 8.11 `system_job_runs`

#### Query chính

1. Lấy lần chạy gần nhất của một job (theo `job_code`).
2. Lọc run theo company + job.
3. Tìm run lỗi để alert/điều tra.

#### Index đề xuất

```sql
CREATE INDEX idx_system_job_runs_job_time
ON system_job_runs (job_code, started_at DESC);

CREATE INDEX idx_system_job_runs_company_job_time
ON system_job_runs (company_id, job_code, started_at DESC);

CREATE INDEX idx_system_job_runs_status_time
ON system_job_runs (status, started_at DESC)
WHERE status IN ('Failed', 'Partial');
```

> Bảng có thể tăng nhanh nếu nhiều job chạy thường xuyên → partition by `RANGE(started_at)` theo tháng khi lớn (tương tự `audit_logs`).

### 8.12 `system_job_locks`

#### Query chính

1. Acquire/check lock theo `job_code` (PK).
2. Dọn lock hết hạn.

#### Index đề xuất

```sql
-- job_code là PRIMARY KEY (đã unique). Chỉ cần index phụ cho cleanup lock hết hạn.
CREATE INDEX idx_system_job_locks_locked_until
ON system_job_locks (locked_until);
```

> Bảng nhỏ (mỗi job 1 row); không cần partial index. Acquire lock dùng `INSERT ... ON CONFLICT (job_code)` hoặc `SELECT ... FOR UPDATE`.

### 8.13 `user_preferences`

#### Query chính

1. Lấy preference của current user theo `company_id + user_id` (endpoint ME, resolve từ token — SPEC-09 §14.4).
2. Upsert preference (`INSERT ... ON CONFLICT (company_id, user_id)`).

#### Index đề xuất

```sql
-- Mỗi user (trong 1 tenant) chỉ có 1 bản ghi preference; index UNIQUE cũng phục vụ lookup theo (company_id, user_id).
CREATE UNIQUE INDEX idx_user_preferences_company_user
ON user_preferences (company_id, user_id);
```

> Bảng không có `deleted_at` (upsert 1 row/user) nên **không cần partial soft-delete index**. Cô lập tenant ép ở RLS + FORCE (DB-08 §8.16, bất biến #1). Nếu phase sau thêm soft-delete, đổi UNIQUE sang partial `WHERE deleted_at IS NULL` theo §6.3.

---

## 9. Index cho AUTH / DB-02

### 9.1 `users`

#### Query chính

1. Login bằng email.
2. Tìm user theo employee/user id.
3. Admin xem danh sách user theo status/role.
4. Kiểm tra user active/locked.

#### Index đề xuất

```sql
CREATE UNIQUE INDEX uq_users_company_email_active
ON users (company_id, normalized_email)
WHERE deleted_at IS NULL;

CREATE INDEX idx_users_company_status
ON users (company_id, status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_users_company_display_name_trgm
ON users USING GIN (display_name gin_trgm_ops)
WHERE deleted_at IS NULL;

CREATE INDEX idx_users_last_login
ON users (company_id, last_login_at DESC)
WHERE deleted_at IS NULL;
```

### 9.2 `roles`

```sql
CREATE UNIQUE INDEX uq_roles_company_code_active
ON roles (company_id, role_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_roles_company_status
ON roles (company_id, status, is_system_role)
WHERE deleted_at IS NULL;
```

### 9.3 `permissions`

```sql
CREATE UNIQUE INDEX uq_permissions_code
ON permissions (permission_code);

CREATE INDEX idx_permissions_module_resource
ON permissions (module_code, resource, action)
WHERE is_active = true;
```

### 9.4 `user_roles`

#### Query chính

1. Lấy role của user hiện tại.
2. Lấy user theo role.
3. Kiểm tra gán trùng role.

#### Index đề xuất

```sql
CREATE UNIQUE INDEX uq_user_roles_active
ON user_roles (company_id, user_id, role_id)
WHERE revoked_at IS NULL AND deleted_at IS NULL;

CREATE INDEX idx_user_roles_user_active
ON user_roles (company_id, user_id, is_active)
WHERE deleted_at IS NULL;

CREATE INDEX idx_user_roles_role_active
ON user_roles (company_id, role_id, is_active)
WHERE deleted_at IS NULL;
```

### 9.5 `role_permissions`

#### Query chính

1. Resolve permission của user qua role.
2. Lấy permission theo role.
3. Kiểm tra data scope.

#### Index đề xuất

```sql
CREATE UNIQUE INDEX uq_role_permissions_active
ON role_permissions (company_id, role_id, permission_id, data_scope)
WHERE deleted_at IS NULL;

CREATE INDEX idx_role_permissions_role
ON role_permissions (role_id, permission_id, data_scope)
WHERE deleted_at IS NULL;

CREATE INDEX idx_role_permissions_permission
ON role_permissions (permission_id, data_scope)
WHERE deleted_at IS NULL;
```

### 9.6 `user_sessions`

```sql
CREATE INDEX idx_user_sessions_user_active
ON user_sessions (company_id, user_id, status, expires_at DESC)
WHERE revoked_at IS NULL;

CREATE INDEX idx_user_sessions_token_hash
ON user_sessions (session_token_hash)
WHERE revoked_at IS NULL;

CREATE INDEX idx_user_sessions_cleanup
ON user_sessions (expires_at)
WHERE status = 'Expired' OR expires_at < now();
```

### 9.7 `password_reset_tokens`

```sql
CREATE UNIQUE INDEX uq_password_reset_token_hash_active
ON password_reset_tokens (token_hash)
WHERE used_at IS NULL;

CREATE INDEX idx_password_reset_user_active
ON password_reset_tokens (company_id, user_id, expires_at DESC)
WHERE used_at IS NULL;
```

### 9.8 `login_logs`

```sql
CREATE INDEX idx_login_logs_company_time
ON login_logs (company_id, created_at DESC);

CREATE INDEX idx_login_logs_user_time
ON login_logs (company_id, user_id, created_at DESC);

CREATE INDEX idx_login_logs_email_time
ON login_logs (company_id, normalized_email, created_at DESC);
```

Partition nếu log lớn:

```text
Partition by RANGE(created_at), theo tháng/quý.
```

---

## 10. Index cho HR / DB-03

### 10.1 `departments`

```sql
CREATE UNIQUE INDEX uq_departments_company_code_active
ON departments (company_id, department_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_departments_company_parent
ON departments (company_id, parent_id, sort_order)
WHERE deleted_at IS NULL;

CREATE INDEX idx_departments_company_manager
ON departments (company_id, manager_employee_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_departments_name_trgm
ON departments USING GIN (name gin_trgm_ops)
WHERE deleted_at IS NULL;
```

### 10.2 `positions`, `job_levels`, `contract_types`

```sql
CREATE UNIQUE INDEX uq_positions_company_code_active
ON positions (company_id, position_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_positions_company_status
ON positions (company_id, status, sort_order)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_job_levels_company_code_active
ON job_levels (company_id, level_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_job_levels_company_sort
ON job_levels (company_id, sort_order)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_contract_types_company_code_active
ON contract_types (company_id, contract_type_code)
WHERE deleted_at IS NULL;
```

### 10.3 `employees`

#### Query chính

1. Danh sách nhân viên HR.
2. Hồ sơ cá nhân của tôi.
3. Nhân viên theo phòng ban.
4. Nhân viên theo manager/team.
5. Tìm theo mã, tên, email, số điện thoại.
6. Kiểm tra employee active/probation cho ATT/LEAVE/TASK.

#### Index đề xuất

```sql
CREATE UNIQUE INDEX uq_employees_company_employee_code_active
ON employees (company_id, employee_code)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_employees_company_user_active
ON employees (company_id, user_id)
WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_employees_company_status_department
ON employees (company_id, employment_status, department_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_employees_company_department_position
ON employees (company_id, department_id, position_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_employees_company_manager_status
ON employees (company_id, direct_manager_id, employment_status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_employees_company_start_date
ON employees (company_id, start_date DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_employees_full_name_trgm
ON employees USING GIN (full_name gin_trgm_ops)
WHERE deleted_at IS NULL;

CREATE INDEX idx_employees_work_email_trgm
ON employees USING GIN (work_email gin_trgm_ops)
WHERE deleted_at IS NULL;
```

#### Search nâng cao đề xuất

Nếu cần search một ô trên nhiều field:

```sql
ALTER TABLE employees
ADD COLUMN search_text TEXT GENERATED ALWAYS AS (
  coalesce(employee_code, '') || ' ' ||
  coalesce(full_name, '') || ' ' ||
  coalesce(work_email, '') || ' ' ||
  coalesce(phone, '')
) STORED;

CREATE INDEX gin_employees_search_text
ON employees USING GIN (search_text gin_trgm_ops)
WHERE deleted_at IS NULL;
```

### 10.4 `employee_contracts`

#### Query chính

1. Hợp đồng hiện tại của employee.
2. Hợp đồng sắp hết hạn.
3. HR lọc theo loại hợp đồng/trạng thái.

#### Index đề xuất

```sql
CREATE INDEX idx_employee_contracts_employee_time
ON employee_contracts (company_id, employee_id, start_date DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_employee_contracts_company_status_end_date
ON employee_contracts (company_id, status, end_date)
WHERE deleted_at IS NULL;

CREATE INDEX idx_employee_contracts_expiring
ON employee_contracts (company_id, end_date)
WHERE deleted_at IS NULL AND status = 'Active';
```

### 10.5 `employee_status_histories`

```sql
CREATE INDEX idx_employee_status_histories_employee_time
ON employee_status_histories (company_id, employee_id, effective_from DESC);

CREATE INDEX idx_employee_status_histories_status_time
ON employee_status_histories (company_id, status, effective_from DESC);
```

### 10.6 `profile_change_requests`

#### Query chính

1. Employee xem yêu cầu của mình.
2. HR xem yêu cầu Pending.
3. Duyệt/từ chối request.

#### Index đề xuất

```sql
CREATE INDEX idx_profile_change_requests_employee
ON profile_change_requests (company_id, employee_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_profile_change_requests_pending
ON profile_change_requests (company_id, status, submitted_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_profile_change_requests_reviewer
ON profile_change_requests (company_id, reviewed_by, reviewed_at DESC)
WHERE reviewed_by IS NOT NULL;
```

### 10.7 `profile_change_request_items`

```sql
CREATE INDEX idx_profile_change_request_items_request
ON profile_change_request_items (company_id, request_id);

CREATE INDEX idx_profile_change_request_items_field
ON profile_change_request_items (company_id, field_name);
```

---

## 11. Index cho ATT / DB-04

### 11.1 `shifts`

```sql
CREATE UNIQUE INDEX uq_shifts_company_code_active
ON shifts (company_id, shift_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_shifts_company_status
ON shifts (company_id, status, sort_order)
WHERE deleted_at IS NULL;
```

### 11.2 `shift_assignments`

#### Query chính

1. Tìm ca áp dụng cho employee.
2. Tìm ca theo department.
3. Tìm ca mặc định company.

#### Index đề xuất

```sql
CREATE INDEX idx_shift_assignments_employee_active
ON shift_assignments (company_id, employee_id, effective_from DESC, effective_to)
WHERE deleted_at IS NULL AND assignment_scope = 'Employee';

CREATE INDEX idx_shift_assignments_department_active
ON shift_assignments (company_id, department_id, effective_from DESC, effective_to)
WHERE deleted_at IS NULL AND assignment_scope = 'Department';

CREATE INDEX idx_shift_assignments_company_active
ON shift_assignments (company_id, assignment_scope, effective_from DESC, effective_to)
WHERE deleted_at IS NULL;
```

### 11.3 `attendance_rules`

```sql
CREATE INDEX idx_attendance_rules_employee_active
ON attendance_rules (company_id, employee_id, priority, effective_from DESC)
WHERE deleted_at IS NULL AND rule_scope = 'Employee';

CREATE INDEX idx_attendance_rules_department_active
ON attendance_rules (company_id, department_id, priority, effective_from DESC)
WHERE deleted_at IS NULL AND rule_scope = 'Department';

CREATE INDEX idx_attendance_rules_company_active
ON attendance_rules (company_id, rule_scope, priority, effective_from DESC)
WHERE deleted_at IS NULL;
```

### 11.4 `attendance_records`

#### Query chính

1. Trạng thái chấm công hôm nay.
2. Bảng công cá nhân theo tháng.
3. Bảng công team/phòng ban.
4. Bảng công toàn công ty theo ngày/tháng.
5. Dashboard bất thường chấm công.
6. Payroll phase sau lấy dữ liệu theo kỳ.

#### Index đề xuất

```sql
CREATE UNIQUE INDEX uq_attendance_records_employee_date_shift_active
ON attendance_records (company_id, employee_id, work_date, applied_shift_id)
WHERE deleted_at IS NULL AND applied_shift_id IS NOT NULL;

CREATE UNIQUE INDEX uq_attendance_records_employee_date_no_shift_active
ON attendance_records (company_id, employee_id, work_date)
WHERE deleted_at IS NULL AND applied_shift_id IS NULL;

CREATE INDEX idx_attendance_records_employee_date
ON attendance_records (company_id, employee_id, work_date DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_records_department_date
ON attendance_records (company_id, department_id, work_date DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_records_status_date
ON attendance_records (company_id, attendance_status, work_date DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_records_missing_checkout
ON attendance_records (company_id, work_date DESC)
WHERE deleted_at IS NULL AND check_in_at IS NOT NULL AND check_out_at IS NULL;

CREATE INDEX idx_attendance_records_late_early
ON attendance_records (company_id, work_date DESC, is_late, is_early_leave)
WHERE deleted_at IS NULL;
```

### 11.5 `attendance_logs`

#### Query chính

1. Truy vết log thô của một attendance record.
2. Import/device sync phase sau.
3. Audit check-in/check-out.

#### Index đề xuất

```sql
CREATE INDEX idx_attendance_logs_record_time
ON attendance_logs (company_id, attendance_record_id, log_time DESC);

CREATE INDEX idx_attendance_logs_employee_time
ON attendance_logs (company_id, employee_id, log_time DESC);

CREATE INDEX idx_attendance_logs_source_time
ON attendance_logs (company_id, source_type, log_time DESC);
```

#### Partition khuyến nghị

```text
Partition by RANGE(log_time), theo tháng.
```

### 11.6 `attendance_adjustment_requests`

```sql
CREATE UNIQUE INDEX uq_attendance_adjustment_request_code_active
ON attendance_adjustment_requests (company_id, request_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_adjustment_employee
ON attendance_adjustment_requests (company_id, employee_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_adjustment_pending
ON attendance_adjustment_requests (company_id, status, submitted_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_adjustment_record
ON attendance_adjustment_requests (company_id, attendance_record_id)
WHERE deleted_at IS NULL;
```

### 11.7 `remote_work_requests`

```sql
CREATE UNIQUE INDEX uq_remote_work_request_code_active
ON remote_work_requests (company_id, request_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_remote_work_employee_date
ON remote_work_requests (company_id, employee_id, start_date DESC, end_date DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_remote_work_pending
ON remote_work_requests (company_id, status, submitted_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_remote_work_approved_date
ON remote_work_requests (company_id, start_date, end_date)
WHERE deleted_at IS NULL AND status = 'Approved';
```

---

## 12. Index cho LEAVE / DB-05

### 12.1 `leave_types`

```sql
CREATE UNIQUE INDEX uq_leave_types_company_code_active
ON leave_types (company_id, leave_type_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_leave_types_company_status
ON leave_types (company_id, status, sort_order)
WHERE deleted_at IS NULL;
```

### 12.2 `leave_policies`

```sql
CREATE INDEX idx_leave_policies_scope_active
ON leave_policies (company_id, policy_scope, department_id, employee_id, job_level_id, contract_type_id, priority)
WHERE deleted_at IS NULL AND status = 'Active';

CREATE INDEX idx_leave_policies_leave_type
ON leave_policies (company_id, leave_type_id, status)
WHERE deleted_at IS NULL;
```

### 12.3 `leave_balances`

#### Query chính

1. Employee xem số ngày phép còn lại.
2. HR xem số dư phép theo nhân viên/năm.
3. Kiểm tra số dư khi tạo/gửi/duyệt đơn.

#### Index đề xuất

```sql
CREATE UNIQUE INDEX uq_leave_balances_employee_type_period
ON leave_balances (company_id, employee_id, leave_type_id, balance_year, period_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_leave_balances_employee_year
ON leave_balances (company_id, employee_id, balance_year)
WHERE deleted_at IS NULL;

CREATE INDEX idx_leave_balances_low_available
ON leave_balances (company_id, balance_year, available_days)
WHERE deleted_at IS NULL;
```

### 12.4 `leave_balance_transactions`

```sql
CREATE INDEX idx_leave_balance_tx_balance_time
ON leave_balance_transactions (company_id, leave_balance_id, created_at DESC);

CREATE INDEX idx_leave_balance_tx_employee_time
ON leave_balance_transactions (company_id, employee_id, created_at DESC);

CREATE INDEX idx_leave_balance_tx_reference
ON leave_balance_transactions (company_id, reference_type, reference_id)
WHERE reference_id IS NOT NULL;
```

### 12.5 `leave_requests`

#### Query chính

1. Employee xem đơn của mình.
2. Manager/HR xem đơn Pending.
3. Lịch nghỉ team/company.
4. Tìm đơn theo mã.

#### Index đề xuất

```sql
CREATE UNIQUE INDEX uq_leave_requests_company_code_active
ON leave_requests (company_id, leave_request_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_leave_requests_employee_created
ON leave_requests (company_id, employee_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_leave_requests_status_submitted
ON leave_requests (company_id, status, submitted_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_leave_requests_approver_pending
ON leave_requests (company_id, current_approver_user_id, submitted_at DESC)
WHERE deleted_at IS NULL AND status = 'Pending';

CREATE INDEX idx_leave_requests_date_range
ON leave_requests (company_id, start_date, end_date, status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_leave_requests_department_status
ON leave_requests (company_id, department_id, status, start_date DESC)
WHERE deleted_at IS NULL;
```

### 12.6 `leave_request_days`

#### Query chính

1. ATT kiểm tra employee có nghỉ ngày X không.
2. Lịch nghỉ team/company.
3. Payroll phase sau tính ngày nghỉ trong kỳ.

#### Index đề xuất

```sql
CREATE INDEX idx_leave_request_days_employee_date
ON leave_request_days (company_id, employee_id, leave_date)
WHERE deleted_at IS NULL;

CREATE INDEX idx_leave_request_days_company_date_status
ON leave_request_days (company_id, leave_date, status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_leave_request_days_request
ON leave_request_days (company_id, leave_request_id, leave_date)
WHERE deleted_at IS NULL;

CREATE INDEX idx_leave_request_days_sync_status
ON leave_request_days (company_id, sync_status, leave_date)
WHERE deleted_at IS NULL AND sync_status IN ('Pending', 'Failed', 'Pending Revert');
```

### 12.7 `leave_request_approvals`

```sql
CREATE INDEX idx_leave_approvals_request_step
ON leave_request_approvals (company_id, leave_request_id, approval_step, created_at DESC);

CREATE INDEX idx_leave_approvals_approver_time
ON leave_request_approvals (company_id, approver_user_id, created_at DESC);
```

---

## 13. Index cho TASK / DB-06

### 13.1 `projects`

```sql
CREATE UNIQUE INDEX uq_projects_company_code_active
ON projects (company_id, project_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_projects_company_status
ON projects (company_id, status, updated_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_projects_owner_status
ON projects (company_id, owner_employee_id, status, updated_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_projects_department_status
ON projects (company_id, department_id, status, updated_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_projects_name_trgm
ON projects USING GIN (name gin_trgm_ops)
WHERE deleted_at IS NULL;
```

### 13.2 `project_members`

```sql
CREATE UNIQUE INDEX uq_project_members_active
ON project_members (company_id, project_id, employee_id)
WHERE removed_at IS NULL AND deleted_at IS NULL;

CREATE INDEX idx_project_members_employee
ON project_members (company_id, employee_id, project_role)
WHERE removed_at IS NULL AND deleted_at IS NULL;

CREATE INDEX idx_project_members_project_role
ON project_members (company_id, project_id, project_role)
WHERE removed_at IS NULL AND deleted_at IS NULL;
```

### 13.3 `tasks`

#### Query chính

1. Việc của tôi.
2. Task trong project/Kanban.
3. Task quá hạn.
4. Task sắp đến hạn.
5. Task theo trạng thái/priority.
6. Tìm task theo từ khóa.

#### Index đề xuất

```sql
CREATE UNIQUE INDEX uq_tasks_company_code_active
ON tasks (company_id, task_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_tasks_project_status_sort
ON tasks (company_id, project_id, status, sort_order, updated_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_tasks_assignee_status_due
ON tasks (company_id, main_assignee_employee_id, status, due_at ASC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_tasks_reporter_created
ON tasks (company_id, reporter_employee_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_tasks_status_due
ON tasks (company_id, status, due_at ASC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_tasks_priority_due
ON tasks (company_id, priority, due_at ASC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_tasks_overdue_open
ON tasks (company_id, due_at ASC)
WHERE deleted_at IS NULL AND status NOT IN ('Done', 'Cancelled');

CREATE INDEX idx_tasks_title_trgm
ON tasks USING GIN (title gin_trgm_ops)
WHERE deleted_at IS NULL;
```

#### Lưu ý về Overdue

Không lưu `Overdue` như trạng thái cứng trong `tasks.status`. Query overdue dùng điều kiện:

```sql
WHERE due_at < now()
  AND status NOT IN ('Done', 'Cancelled')
  AND deleted_at IS NULL
```

### 13.4 `task_assignees`

```sql
CREATE UNIQUE INDEX uq_task_assignees_active_role
ON task_assignees (company_id, task_id, employee_id, assignee_role)
WHERE removed_at IS NULL AND deleted_at IS NULL;

CREATE INDEX idx_task_assignees_employee
ON task_assignees (company_id, employee_id, assigned_at DESC)
WHERE removed_at IS NULL AND deleted_at IS NULL;

CREATE INDEX idx_task_assignees_task
ON task_assignees (company_id, task_id)
WHERE removed_at IS NULL AND deleted_at IS NULL;
```

### 13.5 `task_watchers`

```sql
CREATE UNIQUE INDEX uq_task_watchers_active
ON task_watchers (company_id, task_id, employee_id)
WHERE removed_at IS NULL AND deleted_at IS NULL;

CREATE INDEX idx_task_watchers_employee
ON task_watchers (company_id, employee_id, created_at DESC)
WHERE removed_at IS NULL AND deleted_at IS NULL;
```

### 13.6 `task_comments`

```sql
CREATE INDEX idx_task_comments_task_created
ON task_comments (company_id, task_id, created_at ASC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_task_comments_author_created
ON task_comments (company_id, author_user_id, created_at DESC)
WHERE deleted_at IS NULL;
```

### 13.7 `task_comment_mentions`

```sql
CREATE UNIQUE INDEX uq_task_comment_mentions_active
ON task_comment_mentions (company_id, comment_id, mentioned_employee_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_task_comment_mentions_employee
ON task_comment_mentions (company_id, mentioned_employee_id, created_at DESC)
WHERE deleted_at IS NULL;
```

### 13.8 `task_checklists` và `task_checklist_items`

```sql
CREATE INDEX idx_task_checklists_task_sort
ON task_checklists (company_id, task_id, sort_order)
WHERE deleted_at IS NULL;

CREATE INDEX idx_task_checklist_items_checklist_sort
ON task_checklist_items (company_id, checklist_id, sort_order)
WHERE deleted_at IS NULL;

CREATE INDEX idx_task_checklist_items_task_done
ON task_checklist_items (company_id, task_id, is_done)
WHERE deleted_at IS NULL;
```

### 13.9 `task_activity_logs`

```sql
CREATE INDEX idx_task_activity_logs_task_time
ON task_activity_logs (company_id, task_id, created_at DESC);

CREATE INDEX idx_task_activity_logs_project_time
ON task_activity_logs (company_id, project_id, created_at DESC);

CREATE INDEX idx_task_activity_logs_actor_time
ON task_activity_logs (company_id, actor_user_id, created_at DESC);

CREATE INDEX idx_task_activity_logs_action_time
ON task_activity_logs (company_id, action, created_at DESC);
```

Partition nếu lớn:

```text
Partition by RANGE(created_at), theo tháng/quý.
```

---

## 14. Index cho NOTI / DB-07

### 14.1 `notification_events`

```sql
CREATE UNIQUE INDEX uq_notification_events_code_active
ON notification_events (event_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notification_events_module_active
ON notification_events (source_module, is_active)
WHERE deleted_at IS NULL;
```

### 14.2 `notification_templates`

```sql
CREATE UNIQUE INDEX uq_notification_templates_event_channel_locale_active
ON notification_templates (company_id, event_code, channel, locale)
WHERE deleted_at IS NULL AND status = 'Active';

CREATE INDEX idx_notification_templates_event
ON notification_templates (event_code, channel, status)
WHERE deleted_at IS NULL;
```

### 14.3 `notifications`

#### Query chính

1. Đếm unread của user.
2. Dropdown thông báo mới nhất.
3. Danh sách notification theo filter.
4. Đánh dấu đã đọc tất cả.
5. Chống trùng notification bằng dedupe key.

#### Index đề xuất

```sql
CREATE INDEX idx_notifications_recipient_created
ON notifications (company_id, recipient_user_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notifications_unread
ON notifications (company_id, recipient_user_id, created_at DESC)
WHERE deleted_at IS NULL AND read_at IS NULL AND hidden_at IS NULL;

CREATE INDEX idx_notifications_module_type
ON notifications (company_id, recipient_user_id, source_module, notification_type, created_at DESC)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_notifications_dedupe_active
ON notifications (company_id, recipient_user_id, event_code, dedupe_key)
WHERE dedupe_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_notifications_target
ON notifications (company_id, target_module, target_type, target_id)
WHERE target_id IS NOT NULL AND deleted_at IS NULL;
```

#### Query unread count tối ưu

```sql
SELECT count(*)
FROM notifications
WHERE company_id = :company_id
  AND recipient_user_id = :user_id
  AND read_at IS NULL
  AND hidden_at IS NULL
  AND deleted_at IS NULL;
```

### 14.4 `notification_delivery_logs`

```sql
CREATE INDEX idx_notification_delivery_notification
ON notification_delivery_logs (company_id, notification_id, created_at DESC);

CREATE INDEX idx_notification_delivery_status_retry
ON notification_delivery_logs (company_id, channel, status, next_retry_at)
WHERE status IN ('Pending', 'Failed');

CREATE INDEX idx_notification_delivery_recipient_time
ON notification_delivery_logs (company_id, recipient_user_id, created_at DESC);
```

Partition nếu lớn:

```text
Partition by RANGE(created_at), theo tháng.
```

### 14.5 `notification_preferences`

```sql
CREATE UNIQUE INDEX uq_notification_preferences_user_event_channel
ON notification_preferences (company_id, user_id, event_code, channel)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notification_preferences_user
ON notification_preferences (company_id, user_id)
WHERE deleted_at IS NULL;
```

---

## 15. Index cho DASH / DB-07

### 15.1 `dashboard_widgets`

```sql
CREATE UNIQUE INDEX uq_dashboard_widgets_code_active
ON dashboard_widgets (widget_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_dashboard_widgets_dashboard_type
ON dashboard_widgets (dashboard_type, is_active, sort_order)
WHERE deleted_at IS NULL;

CREATE INDEX idx_dashboard_widgets_permission
ON dashboard_widgets (required_permission_code)
WHERE required_permission_code IS NOT NULL AND deleted_at IS NULL;
```

### 15.2 `dashboard_widget_configs`

```sql
CREATE INDEX idx_dashboard_widget_configs_company_role
ON dashboard_widget_configs (company_id, role_id, dashboard_type, sort_order)
WHERE deleted_at IS NULL AND is_enabled = true;

CREATE INDEX idx_dashboard_widget_configs_user
ON dashboard_widget_configs (company_id, user_id, dashboard_type, sort_order)
WHERE deleted_at IS NULL AND is_enabled = true;

CREATE UNIQUE INDEX uq_dashboard_widget_configs_scope
ON dashboard_widget_configs (company_id, widget_id, config_scope, role_id, user_id, dashboard_type)
WHERE deleted_at IS NULL;
```

### 15.3 `dashboard_widget_cache`

#### Query chính

1. Lấy cache theo widget/user/scope.
2. Invalidate cache theo event.
3. Cleanup cache hết hạn.

#### Index đề xuất

```sql
CREATE UNIQUE INDEX uq_dashboard_widget_cache_key_active
ON dashboard_widget_cache (company_id, cache_key)
WHERE status = 'Active';

CREATE INDEX idx_dashboard_widget_cache_lookup
ON dashboard_widget_cache (company_id, widget_code, cache_scope, scope_reference_id, status)
WHERE status = 'Active';

CREATE INDEX idx_dashboard_widget_cache_expires
ON dashboard_widget_cache (expires_at)
WHERE status = 'Active';

CREATE INDEX idx_dashboard_widget_cache_user
ON dashboard_widget_cache (company_id, user_id, generated_at DESC)
WHERE status = 'Active';
```

### 15.4 `dashboard_cache_invalidations`

```sql
CREATE INDEX idx_dashboard_cache_invalidations_event_time
ON dashboard_cache_invalidations (company_id, event_code, created_at DESC);

CREATE INDEX idx_dashboard_cache_invalidations_status
ON dashboard_cache_invalidations (company_id, status, created_at ASC)
WHERE status = 'Pending';
```

---

## 16. Query pattern quan trọng theo module

### 16.1 AUTH: login bằng email

```sql
SELECT id, company_id, password_hash, status, failed_login_count
FROM users
WHERE company_id = :company_id
  AND normalized_email = lower(:email)
  AND deleted_at IS NULL
LIMIT 1;
```

Index sử dụng:

```text
uq_users_company_email_active
```

### 16.2 AUTH: resolve permission của user

```sql
SELECT p.permission_code, rp.data_scope
FROM user_roles ur
JOIN roles r ON r.id = ur.role_id
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE ur.company_id = :company_id
  AND ur.user_id = :user_id
  AND ur.is_active = true
  AND ur.deleted_at IS NULL
  AND r.status = 'Active'
  AND r.deleted_at IS NULL
  AND p.is_active = true
  AND rp.deleted_at IS NULL;
```

Khuyến nghị:

1. Cache permission trong memory/Valkey theo session nếu được.
2. Invalidate cache khi đổi role/permission/user status.
3. Không query permission lặp lại trong từng repository call.

### 16.3 HR: danh sách nhân viên

```sql
SELECT e.id, e.employee_code, e.full_name, e.work_email,
       e.employment_status, e.department_id, e.position_id,
       d.name AS department_name,
       p.name AS position_name
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
LEFT JOIN positions p ON p.id = e.position_id
WHERE e.company_id = :company_id
  AND e.deleted_at IS NULL
  AND (:status IS NULL OR e.employment_status = :status)
  AND (:department_id IS NULL OR e.department_id = :department_id)
ORDER BY e.created_at DESC, e.id DESC
LIMIT :limit;
```

Nếu dùng cursor:

```sql
AND (e.created_at, e.id) < (:cursor_created_at, :cursor_id)
```

### 16.4 ATT: trạng thái chấm công hôm nay

```sql
SELECT *
FROM attendance_records
WHERE company_id = :company_id
  AND employee_id = :employee_id
  AND work_date = :today
  AND deleted_at IS NULL
LIMIT 1;
```

Index sử dụng:

```text
idx_attendance_records_employee_date
```

### 16.5 ATT: bảng công cá nhân theo tháng

```sql
SELECT *
FROM attendance_records
WHERE company_id = :company_id
  AND employee_id = :employee_id
  AND work_date BETWEEN :month_start AND :month_end
  AND deleted_at IS NULL
ORDER BY work_date ASC;
```

### 16.6 ATT: bảng công team

```sql
SELECT ar.*
FROM attendance_records ar
JOIN employees e ON e.id = ar.employee_id
WHERE ar.company_id = :company_id
  AND e.direct_manager_id = :manager_employee_id
  AND ar.work_date BETWEEN :date_from AND :date_to
  AND ar.deleted_at IS NULL
  AND e.deleted_at IS NULL
ORDER BY ar.work_date DESC, e.full_name ASC;
```

Tối ưu:

1. `employees(company_id, direct_manager_id, employment_status)`.
2. `attendance_records(company_id, employee_id, work_date)`.
3. Có thể lấy employee ids trước, sau đó query `employee_id = ANY(:employee_ids)` nếu team nhỏ.

### 16.7 LEAVE: kiểm tra nghỉ phép approved trong ngày

```sql
SELECT *
FROM leave_request_days
WHERE company_id = :company_id
  AND employee_id = :employee_id
  AND leave_date = :work_date
  AND status = 'Approved'
  AND deleted_at IS NULL;
```

Index sử dụng:

```text
idx_leave_request_days_employee_date
```

### 16.8 LEAVE: đơn chờ duyệt của manager

```sql
SELECT lr.*
FROM leave_requests lr
WHERE lr.company_id = :company_id
  AND lr.current_approver_user_id = :user_id
  AND lr.status = 'Pending'
  AND lr.deleted_at IS NULL
ORDER BY lr.submitted_at ASC;
```

### 16.9 TASK: việc của tôi

```sql
SELECT t.*
FROM tasks t
WHERE t.company_id = :company_id
  AND t.main_assignee_employee_id = :employee_id
  AND t.status NOT IN ('Done', 'Cancelled')
  AND t.deleted_at IS NULL
ORDER BY t.due_at ASC NULLS LAST, t.priority DESC, t.updated_at DESC
LIMIT :limit;
```

### 16.10 TASK: Kanban project

```sql
SELECT t.*
FROM tasks t
WHERE t.company_id = :company_id
  AND t.project_id = :project_id
  AND t.deleted_at IS NULL
ORDER BY t.status, t.sort_order ASC, t.updated_at DESC;
```

### 16.11 NOTI: dropdown thông báo mới nhất

```sql
SELECT id, title, body, event_code, source_module,
       target_module, target_type, target_id,
       read_at, created_at
FROM notifications
WHERE company_id = :company_id
  AND recipient_user_id = :user_id
  AND hidden_at IS NULL
  AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 20;
```

### 16.12 DASH: widget notification unread count

```sql
SELECT count(*) AS unread_count
FROM notifications
WHERE company_id = :company_id
  AND recipient_user_id = :user_id
  AND read_at IS NULL
  AND hidden_at IS NULL
  AND deleted_at IS NULL;
```

Nếu user online nhiều và notification rất lớn, có thể cache unread count hoặc duy trì counter riêng ở phase sau.

---

## 17. Pagination strategy

### 17.1 Offset pagination

Dùng cho:

1. Danh mục nhỏ.
2. Admin list ít dữ liệu.
3. Màn hình cần nhảy trang cụ thể.

Ví dụ:

```sql
ORDER BY created_at DESC
LIMIT 20 OFFSET 40;
```

Nhược điểm:

1. Offset lớn sẽ chậm.
2. Dữ liệu thay đổi giữa lúc phân trang có thể bị lệch.

### 17.2 Keyset pagination

Dùng cho bảng lớn:

1. Notifications.
2. Audit logs.
3. Attendance logs.
4. Task list.
5. Employee list lớn.

Mẫu:

```sql
SELECT *
FROM notifications
WHERE company_id = :company_id
  AND recipient_user_id = :user_id
  AND deleted_at IS NULL
  AND (created_at, id) < (:cursor_created_at, :cursor_id)
ORDER BY created_at DESC, id DESC
LIMIT :limit;
```

Ưu điểm:

1. Nhanh hơn offset lớn.
2. Ổn định hơn khi có insert mới.
3. Phù hợp infinite scroll.

### 17.3 Cursor format đề xuất

Cursor có thể encode JSON:

```json
{
  "created_at": "2026-06-20T10:00:00Z",
  "id": "uuid"
}
```

Backend encode base64 để frontend không phụ thuộc cấu trúc nội bộ.

---

## 18. Search/filter strategy

### 18.1 Search đơn giản bằng normalized column

Các field nên có normalized variant:

| Bảng | Cột gốc | Cột normalized |
| --- | --- | --- |
| `users` | `email` | `normalized_email` |
| `employees` | `work_email` | `normalized_work_email` |
| `employees` | `full_name` | `normalized_full_name` nếu cần |
| `departments` | `name` | `normalized_name` nếu cần |

### 18.2 Search tiếng Việt không dấu

Có thể dùng generated column:

```sql
ALTER TABLE employees
ADD COLUMN search_text_unaccent TEXT GENERATED ALWAYS AS (
  unaccent(coalesce(employee_code, '') || ' ' || coalesce(full_name, '') || ' ' || coalesce(work_email, ''))
) STORED;

CREATE INDEX gin_employees_search_text_unaccent
ON employees USING GIN (search_text_unaccent gin_trgm_ops)
WHERE deleted_at IS NULL;
```

### 18.3 Tránh leading wildcard nếu không có trigram

Không nên dùng trên bảng lớn nếu chưa có trigram index:

```sql
WHERE full_name ILIKE '%van%'
```

Nên dùng `pg_trgm` hoặc search_text indexed.

### 18.4 Filter enum/status

Status thường có cardinality thấp. Index status riêng lẻ ít hiệu quả. Nên kết hợp:

```text
company_id + status + created_at
company_id + status + department_id
company_id + status + submitted_at
```

---

## 19. Data scope query optimization

### 19.1 Own scope

Mẫu:

```sql
WHERE employee_id = :current_employee_id
```

Index cần:

```text
company_id + employee_id + created_at/work_date
```

### 19.2 Team scope

MVP xác định team qua:

```text
employees.direct_manager_id = current_employee_id
```

Mẫu:

```sql
SELECT id
FROM employees
WHERE company_id = :company_id
  AND direct_manager_id = :manager_employee_id
  AND deleted_at IS NULL;
```

Index cần:

```text
employees(company_id, direct_manager_id, employment_status)
```

### 19.3 Department scope

Mẫu:

```sql
WHERE department_id = :department_id
```

Index cần:

```text
company_id + department_id + status/date
```

### 19.4 Project scope

Dùng cho TASK:

```sql
SELECT project_id
FROM project_members
WHERE company_id = :company_id
  AND employee_id = :employee_id
  AND removed_at IS NULL;
```

Sau đó filter:

```sql
WHERE project_id = ANY(:project_ids)
```

Index cần:

```text
project_members(company_id, employee_id, project_role)
tasks(company_id, project_id, status, sort_order)
```

### 19.5 Company scope

Company scope là filter theo:

```sql
WHERE company_id = :company_id
```

Cần đảm bảo mọi bảng lớn đều có index bắt đầu bằng `company_id`.

### 19.6 System scope

System scope chỉ cho Super Admin. Query liên công ty cần cẩn trọng:

1. Phân trang bắt buộc.
2. Không export toàn bộ nếu không có background job.
3. Có thể yêu cầu filter theo company/time.
4. Ghi audit log khi truy cập dữ liệu nhạy cảm liên tenant.

---

## 20. Dashboard performance design

### 20.1 Nguyên tắc

Dashboard không xử lý nghiệp vụ gốc và không copy dữ liệu nghiệp vụ thành source of truth. Dashboard chỉ:

1. Query nhanh từ module nguồn.
2. Dùng cache ngắn hạn nếu query nặng.
3. Invalidate cache khi có event liên quan.
4. Kiểm tra permission/data scope trước khi trả widget.

### 20.2 Cache key đề xuất

```text
DASH:{company_id}:{widget_code}:{scope}:{scope_id}:{date_key}:{filter_hash}
```

Ví dụ:

```text
DASH:COMPANY_A:EMPLOYEE_TODAY_ATTENDANCE:OWN:EMPLOYEE_ID:2026-06-20:default
DASH:COMPANY_A:MANAGER_PENDING_LEAVE:TEAM:MANAGER_EMPLOYEE_ID:2026-06-20:default
DASH:COMPANY_A:HR_ATTENDANCE_ALERTS:COMPANY:COMPANY_ID:2026-06:default
```

### 20.3 TTL đề xuất

| Widget | TTL đề xuất | Ghi chú |
| --- | --- | --- |
| Chấm công hôm nay | 30-60 giây | Cần khá mới |
| Task của tôi | 60-120 giây | Có thể invalidate khi task update |
| Đơn nghỉ chờ duyệt | 60 giây | Cần đủ mới |
| Notification unread | 15-30 giây hoặc realtime | Nếu chưa có WebSocket |
| HR overview | 5-15 phút | Không cần realtime |
| Project progress | 2-5 phút | Có thể invalidate theo task status |
| Attendance alerts | 1-5 phút | Tùy nghiệp vụ |

### 20.4 Invalidation event

> `attendance.checked_in` / `attendance.checked_out` là **sự kiện domain/cache nội bộ, không phải NOTI notification** (dạng dotted-lowercase khớp BACKEND-12 §23.1 `x-domain-events`). Self check-in/out không có event NOTI người dùng.

| Event | Widget cần invalidate |
| --- | --- |
| `attendance.checked_in` | Employee attendance today, HR attendance alerts |
| `attendance.checked_out` | Employee attendance today, attendance summary |
| `LEAVE_REQUEST_SUBMITTED` | Manager pending leave, HR pending leave |
| `LEAVE_REQUEST_APPROVED` | Leave calendar, attendance today, leave balance |
| `TASK_ASSIGNED` | My tasks, team tasks, notification widget |
| `TASK_STATUS_CHANGED` | My tasks, project progress, overdue tasks |
| `NOTIFICATION_CREATED` | Notification unread, latest notifications |
| `EMPLOYEE_CREATED` | HR overview, department headcount |
| `CONTRACT_EXPIRING` | HR contract alerts |

---

## 21. Partitioning strategy

### 21.1 Khi nào cần partition

Nên cân nhắc partition khi bảng đạt một trong các ngưỡng:

| Bảng | Ngưỡng đề xuất |
| --- | --- |
| `audit_logs` | > 5 triệu dòng |
| `attendance_logs` | > 5 triệu dòng |
| `login_logs` | > 2 triệu dòng |
| `file_access_logs` | > 2 triệu dòng |
| `notification_delivery_logs` | > 5 triệu dòng |
| `task_activity_logs` | > 5 triệu dòng |
| `notifications` | > 10 triệu dòng |

### 21.2 Partition theo thời gian

Các bảng log nên partition theo cột thời gian:

| Bảng | Cột partition | Chu kỳ |
| --- | --- | --- |
| `audit_logs` | `created_at` | Monthly/Quarterly |
| `attendance_logs` | `log_time` | Monthly |
| `login_logs` | `created_at` | Monthly/Quarterly |
| `file_access_logs` | `created_at` | Monthly |
| `notification_delivery_logs` | `created_at` | Monthly |
| `task_activity_logs` | `created_at` | Monthly/Quarterly |
| `system_job_runs` | `started_at` | Monthly (khi job chạy dày) |

### 21.3 BRIN index cho bảng thời gian rất lớn

Với bảng append-only theo thời gian, có thể dùng BRIN:

```sql
CREATE INDEX brin_audit_logs_created_at
ON audit_logs USING BRIN (created_at);
```

BRIN phù hợp khi dữ liệu insert theo thứ tự thời gian và query theo khoảng thời gian lớn.

---

## 22. Archive và retention strategy

### 22.1 Dữ liệu nên archive

| Dữ liệu | Chính sách đề xuất |
| --- | --- |
| Audit logs | Archive sau 12-24 tháng tùy công ty |
| Login logs | Archive sau 12 tháng |
| Attendance logs thô | Archive sau 12-24 tháng |
| Notification delivery logs | Archive sau 6-12 tháng |
| Dashboard cache | Xóa sau 1-7 ngày |
| Temporary files | Xóa sau 7 ngày |
| Deleted files | Xóa vật lý sau 90 ngày nếu policy cho phép |

### 22.2 Không archive source of truth sớm

Không archive/xóa sớm:

1. `employees`
2. `employee_contracts`
3. `attendance_records`
4. `leave_requests`
5. `leave_balances`
6. `leave_balance_transactions`
7. `tasks` quan trọng chưa đóng/lưu trữ
8. `files` còn link với entity active

### 22.3 Archive table naming

```text
archive_audit_logs_2026
archive_attendance_logs_2026_06
archive_notification_delivery_logs_2026_06
```

Hoặc dùng object storage cold tier nếu log quá lớn.

---

## 23. N+1 query prevention

### 23.1 Nguyên tắc

Không để API danh sách gọi query riêng cho từng dòng.

Ví dụ sai:

```text
GET /employees
-> query 20 employees
-> mỗi employee query department riêng
-> mỗi employee query position riêng
```

Nên dùng:

1. Join projection.
2. Batch loading.
3. Preload theo danh sách id.
4. Cache danh mục nhỏ.

### 23.2 HR employee list

Nên query một lần có join department/position:

```sql
SELECT e.id, e.full_name, d.name, p.name
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
LEFT JOIN positions p ON p.id = e.position_id
WHERE e.company_id = :company_id;
```

### 23.3 TASK list

Không query assignee từng task. Nên join `employees` hoặc dùng batch:

```sql
SELECT t.*, e.full_name AS assignee_name
FROM tasks t
LEFT JOIN employees e ON e.id = t.main_assignee_employee_id
WHERE t.company_id = :company_id;
```

### 23.4 NOTI list

Notification list không nên join nhiều bảng nghiệp vụ gốc. Notification chỉ hiển thị summary đã render. Khi user bấm vào thì module gốc kiểm tra quyền và tải chi tiết.

---

## 24. EXPLAIN ANALYZE checklist

Trước khi release API quan trọng, cần kiểm tra:

1. Query có filter `company_id` chưa?
2. Query có filter `deleted_at IS NULL` chưa?
3. Query có dùng index đúng không?
4. Có sequential scan trên bảng lớn không?
5. Số row estimate có lệch quá nhiều so với actual không?
6. Có sort lớn không dùng index không?
7. Có nested loop bất thường với số row lớn không?
8. Có join thiếu điều kiện company không?
9. Có query lặp N+1 không?
10. Có offset quá lớn không?
11. Có trả quá nhiều cột không cần thiết không?
12. Có filter trên JSONB không có index không?
13. Có query dashboard chạy quá 500ms không?
14. Có query realtime như notification unread chạy quá 100ms không?

Mẫu chạy:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT ...;
```

---

## 25. SLA hiệu năng đề xuất cho MVP

| Nhóm API | Mục tiêu p95 |
| --- | --- |
| Login | < 500ms |
| Permission resolve từ cache | < 50ms |
| Permission resolve từ DB | < 200ms |
| Employee list | < 500ms |
| Attendance today | < 200ms |
| Attendance monthly personal | < 500ms |
| Leave pending approval | < 300ms |
| My tasks | < 500ms |
| Notification unread count | < 100ms |
| Notification dropdown | < 200ms |
| Dashboard initial load | < 1.5s |
| Dashboard widget cached | < 200ms |
| Dashboard widget uncached | < 800ms |
| Audit log list | < 1s với filter thời gian |

Nếu API vượt mục tiêu, cần:

1. Kiểm tra index.
2. Kiểm tra query plan.
3. Giảm cột trả về.
4. Chuyển sang keyset pagination.
5. Cache nếu dữ liệu cho phép.
6. Tách query nặng sang background/materialized summary.

---

## 26. Query pattern cho export dữ liệu

Export có thể nặng và không nên dùng chung API list thông thường.

### 26.1 Nguyên tắc export

1. Luôn kiểm tra permission export riêng.
2. Luôn ghi audit log.
3. Bắt buộc filter thời gian hoặc phạm vi nếu dữ liệu lớn.
4. Không export dữ liệu nhạy cảm nếu thiếu quyền.
5. Export lớn nên chạy background job.
6. File export lưu qua `files` và `file_links` nếu cần.

### 26.2 Export bảng công

Filter bắt buộc:

```text
company_id
month/date range
department_id hoặc employee_id nếu không phải HR/Admin company scope
```

Index hỗ trợ:

```text
attendance_records(company_id, department_id, work_date)
attendance_records(company_id, employee_id, work_date)
```

### 26.3 Export nhân viên

Cần field-level permission:

1. Nếu thiếu `HR.EMPLOYEE.VIEW_SENSITIVE`, mask trường nhạy cảm.
2. Nếu thiếu `HR.EMPLOYEE.EXPORT`, chặn export.
3. Ghi `audit_logs` action `EXPORT`.

---

## 27. Migration index strategy

### 27.1 Thứ tự thêm index

Sau khi đã tạo bảng từ DB-02 -> DB-08, chạy migration index theo thứ tự:

```text
090_create_foundation_indexes.sql
091_create_auth_indexes.sql
092_create_hr_indexes.sql
093_create_att_indexes.sql
094_create_leave_indexes.sql
095_create_task_indexes.sql
096_create_noti_dash_indexes.sql
097_create_cross_module_performance_indexes.sql
098_create_partition_preparation.sql
```

### 27.2 Production migration

Với database production đã có dữ liệu, nên dùng:

```sql
CREATE INDEX CONCURRENTLY ...
```

Lưu ý:

1. Không chạy trong transaction block.
2. Theo dõi lock và thời gian chạy.
3. Chạy ngoài giờ cao điểm.
4. Có rollback plan.
5. Kiểm tra duplicate trước khi tạo unique index.

### 27.3 Kiểm tra trước unique index

Ví dụ kiểm tra trùng email user:

```sql
SELECT company_id, normalized_email, count(*)
FROM users
WHERE deleted_at IS NULL
GROUP BY company_id, normalized_email
HAVING count(*) > 1;
```

---

## 28. Test case database performance

| Mã test | Nội dung | Kỳ vọng |
| --- | --- | --- |
| DB09-TC-001 | Login bằng email có 100k users | Query dùng `uq_users_company_email_active` |
| DB09-TC-002 | Employee list filter status + department | Không sequential scan toàn bảng employees |
| DB09-TC-003 | Manager xem bảng công team 1 tháng | Query < 500ms với dữ liệu giả lập |
| DB09-TC-004 | ATT today theo employee/date | Dùng index employee/date |
| DB09-TC-005 | Check duplicate attendance record | Unique index chặn trùng employee/date/shift |
| DB09-TC-006 | Leave pending approval | Dùng index approver/status |
| DB09-TC-007 | Leave approved day lookup cho ATT | Query theo employee/date nhanh |
| DB09-TC-008 | My tasks sort by due date | Dùng index assignee/status/due |
| DB09-TC-009 | Kanban project 1000 tasks | Query theo project/status/sort ổn định |
| DB09-TC-010 | Notification unread count 1M notifications | Query dùng partial unread index |
| DB09-TC-011 | Notification dedupe | Unique dedupe key chặn thông báo trùng |
| DB09-TC-012 | Dashboard cached widget | Lookup cache key dùng unique index |
| DB09-TC-013 | Audit log filter module/time | Query dùng index module/action/time hoặc partition pruning |
| DB09-TC-014 | Search employee tiếng Việt | Dùng trigram/unaccent index nếu bật |
| DB09-TC-015 | Keyset pagination notification | Không dùng offset lớn |
| DB09-TC-016 | Export attendance theo tháng | Có filter date range và ghi audit log |
| DB09-TC-017 | Soft-deleted record không vi phạm unique active | Cho phép tạo mã/email cũ nếu record đã soft delete theo policy |
| DB09-TC-018 | Query data scope Team | Dùng index employees direct_manager_id |
| DB09-TC-019 | Query project scope | Dùng index project_members employee/project |
| DB09-TC-020 | Dashboard uncached query | Có TTL/invalidation, không query quá nặng liên tục |

---

## 29. Checklist triển khai DB-09

### 29.1 Checklist index

- [ ] Mỗi bảng lớn có index bắt đầu bằng `company_id`.
- [ ] Mỗi business code có unique index theo company.
- [ ] Mỗi bảng soft delete có partial index cho active records.
- [ ] FK thường join/filter đã có index.
- [ ] Notification unread count có partial index.
- [ ] Attendance records có unique theo employee/date/shift.
- [ ] Leave request days có index employee/date.
- [ ] Task list có index assignee/status/due.
- [ ] Audit/log tables có index time và kế hoạch partition.
- [ ] Search fields có normalized/trigram index nếu cần.

### 29.2 Checklist query

- [ ] Query không thiếu `company_id`.
- [ ] Query không trả field nhạy cảm nếu thiếu quyền.
- [ ] Query list có limit.
- [ ] Query bảng lớn dùng keyset pagination nếu phù hợp.
- [ ] Query dashboard có cache hoặc TTL nếu nặng.
- [ ] Query export chạy background nếu dữ liệu lớn.
- [ ] Query permission được cache theo session/context.
- [ ] Query không bị N+1.
- [ ] Query đã kiểm tra `EXPLAIN ANALYZE`.

### 29.3 Checklist vận hành

- [ ] Có job cleanup dashboard cache.
- [ ] Có job archive log theo retention.
- [ ] Có monitoring slow query.
- [ ] Có threshold cảnh báo query > 1s.
- [ ] Có migration index riêng và rollback plan.
- [ ] Có seed extension `pg_trgm`, `unaccent` nếu dùng search.
- [ ] Có tài liệu query pattern cho backend team.

---

## 30. Kết luận

DB-09 hoàn thiện lớp thiết kế hiệu năng cho database của hệ thống quản lý doanh nghiệp nội bộ.

Các điểm quan trọng nhất:

1. Mọi query nghiệp vụ phải đi theo `company_id` và data scope.
2. Bảng soft delete nên dùng partial index.
3. Bảng log lớn cần chuẩn bị partition/retention từ sớm.
4. Notification unread count, attendance today, leave approved day, my tasks và dashboard widgets là các query cần ưu tiên tối ưu.
5. Dashboard không lưu dữ liệu gốc, chỉ dùng config/cache/invalidation.
6. Backend cần tránh N+1 query và dùng keyset pagination cho bảng lớn.
7. Mọi API quan trọng cần kiểm tra `EXPLAIN ANALYZE` trước khi release.
8. DB-09 là cơ sở để viết tiếp DB-10 về migration plan/seed chi tiết hoặc DB-11 về thiết kế database cho các module Phase 2+.
