> 🔒 **BẤT BIẾN DB (bổ sung bắt buộc):** Mọi bảng có `company_id` PHẢI bật **RLS + FORCE**; `audit_logs` **append-only** (REVOKE UPDATE/DELETE + trigger); audit/event ghi qua **outbox** trong cùng transaction nghiệp vụ. Bộ docs gốc CHƯA mô tả 3 cơ chế này — DDL mẫu + `withTenant`/`set_config` tại [DECISIONS-02 §2–3](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md).

# DB-03: HR DATABASE DESIGN

> **📚 Bộ tài liệu DB — Hệ thống Quản lý Doanh nghiệp**
> [DB-01 Tổng quan](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [DB-02 AUTH/RBAC](<DB-02 AUTH RBAC Database Design.md>) · **DB-03 HR** · [DB-04 ATT](<DB-04_ATT Database Design.md>) · [DB-05 LEAVE](<DB-05 LEAVE Database Design.md>) · [DB-06 TASK](<DB-06 TASK Database Design.md>) · [DB-07 NOTI/DASH](<DB-07 NOTI DASH Database Design.md>) · [DB-08 Audit/Files/Settings](<DB-08 Audit Files Settings Seeds Database Design.md>) · [DB-09 Index/Hiệu năng](<DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 Migration/Seed](<DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>)
>
> **Nguồn & liên quan:** [PRD-00 §9.2](<../PRD/PRD-00 Enterprise Management System .md>) · SPEC tương ứng: [SPEC-03 HR](<../SPEC/SPEC-03 HR.md>) · [SPEC-01 Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) · [Thiết kế API: API-03 HR](<../API Design/API-03_HR_API_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DB-03 |
| Tên tài liệu | HR Database Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Module | HR |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01, DB-02 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả thiết kế database chi tiết cho module **HR - Quản lý nhân sự** của hệ thống quản lý doanh nghiệp nội bộ.

Module HR là nguồn dữ liệu nhân sự trung tâm cho toàn bộ hệ thống. Các module khác như AUTH, ATT, LEAVE, TASK, DASH, NOTI và các module mở rộng sau MVP đều cần dữ liệu nhân viên, phòng ban, chức vụ, quản lý trực tiếp, hợp đồng và trạng thái làm việc để vận hành đúng nghiệp vụ.

Tài liệu DB-03 dùng làm cơ sở cho:

1. Backend triển khai migration, model/entity, repository và service HR.
2. API Design cho hồ sơ nhân viên, phòng ban, chức vụ, hợp đồng, file hồ sơ và yêu cầu cập nhật hồ sơ cá nhân.
3. UI/UX Design cho màn hình HR.
4. QA viết test case database và test case nghiệp vụ HR.
5. Các module ATT, LEAVE, TASK, DASH, NOTI tích hợp dữ liệu nhân sự đúng quan hệ.

---

## 3. Phạm vi thiết kế

### 3.1 Bao gồm trong DB-03

DB-03 bao gồm các nhóm bảng chính sau:

| Nhóm | Bảng | Vai trò |
| --- | --- | --- |
| Organization | `departments` | Phòng ban/cơ cấu tổ chức |
| Organization | `positions` | Chức vụ/vị trí công việc |
| Master data | `job_levels` | Cấp bậc nhân sự |
| Master data | `contract_types` | Loại hợp đồng |
| Employee core | `employees` | Hồ sơ nhân viên trung tâm |
| Employee lifecycle | `employee_status_histories` | Lịch sử trạng thái làm việc |
| Contract | `employee_contracts` | Hợp đồng lao động của nhân viên |
| File | `employee_files` | Liên kết file hồ sơ nhân viên, có thể triển khai qua `file_links` |
| Self-service | `profile_change_requests` | Yêu cầu cập nhật hồ sơ cá nhân |
| Self-service | `profile_change_request_items` | Chi tiết từng field thay đổi |
| Employee code | `employee_code_configs` | Cấu hình sinh mã nhân viên |
| Foundation reuse | `sequence_counters` | Bộ đếm sinh mã tự động, dùng chung toàn hệ thống |

### 3.2 Không đi sâu trong DB-03

Các phần sau không đi sâu trong DB-03, nhưng DB-03 phải thiết kế đủ mở để tích hợp:

| Nhóm | Giai đoạn | Ghi chú |
| --- | --- | --- |
| Payroll | Phase 2 | Dùng `employees`, `employee_contracts`, `departments`, `positions`, `job_levels` |
| Recruitment | Phase 2 | Candidate trúng tuyển có thể chuyển thành employee |
| Asset | Phase 3 | Gắn tài sản với `employees.id` |
| Room | Phase 3 | Gắn booking với `users.id` hoặc `employees.id` |
| Chat/Social | Phase 4 | Profile người dùng lấy từ `users` + `employees` |
| Mobile | Phase 5 | Hồ sơ nhân viên dùng cho mobile profile |
| AI | Phase 5 | Có thể phân tích dữ liệu HR có kiểm soát quyền |
| Onboarding/offboarding nâng cao | Phase sau | Có thể thêm bảng workflow riêng |
| Performance review | Phase sau | Có thể thêm bảng đánh giá năng lực |
| Reward/discipline | Phase sau | Có thể thêm bảng khen thưởng/kỷ luật |
| Insurance/tax | Phase sau | Có thể thêm bảng riêng vì dữ liệu nhạy cảm cao |

---

## 4. Nguyên tắc thiết kế HR

### 4.1 PostgreSQL làm database chính

DB-03 tiếp tục dùng PostgreSQL theo DB-01 vì module HR cần:

1. Quan hệ chặt giữa employee, user, department, position, contract.
2. Foreign key và unique constraint để bảo vệ dữ liệu.
3. Transaction khi tạo employee kèm user, sinh mã nhân viên, tạo hợp đồng, tạo log.
4. JSONB cho dữ liệu thay đổi linh hoạt trong profile change request.
5. Index tốt cho tìm kiếm, lọc, phân trang danh sách nhân viên.

### 4.2 UUID làm primary key

Tất cả bảng HR dùng:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
```

### 4.3 Multi-tenant bằng `company_id`

Các bảng HR bắt buộc có `company_id` trong MVP:

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

Nguyên tắc:

1. Mỗi employee thuộc đúng một company.
2. Mã nhân viên unique trong phạm vi company.
3. Department/position/job level/contract type unique theo company.
4. Query HR luôn filter theo `company_id` lấy từ auth context.
5. Super Admin có scope System mới được truy vấn liên công ty.

### 4.4 Soft delete dữ liệu HR quan trọng

Không xóa cứng:

```text
employees
departments
positions
job_levels
contract_types
employee_contracts
profile_change_requests
employee_files
```

Dùng cột:

```text
deleted_at
deleted_by
```

### 4.5 Audit log bắt buộc

Các thao tác sau phải ghi `audit_logs`:

1. Tạo employee.
2. Cập nhật employee.
3. Đổi trạng thái employee.
4. Liên kết/hủy liên kết user.
5. Tạo/sửa/xóa hợp đồng.
6. Upload/xóa file hồ sơ.
7. Employee gửi yêu cầu cập nhật hồ sơ cá nhân.
8. HR/Admin duyệt hoặc từ chối yêu cầu cập nhật hồ sơ.
9. Cấu hình sinh mã nhân viên.
10. Override mã nhân viên thủ công.
11. Export danh sách nhân viên.
12. Xem/tải file hoặc dữ liệu nhạy cảm nếu cấu hình yêu cầu.

### 4.6 Field-level permission cho dữ liệu nhạy cảm

Một số trường HR là dữ liệu nhạy cảm, backend không được trả về nếu user thiếu quyền.

Nhóm trường nhạy cảm đề xuất:

```text
date_of_birth
identity_number
identity_issue_date
identity_issue_place
tax_code
bank_account_number
bank_name
personal_email
phone
address
current_address
permanent_address
emergency_contact_name
emergency_contact_phone
contract_salary nếu phase sau bổ sung
file hồ sơ nhạy cảm
```

Permission cần kiểm tra:

```text
HR.EMPLOYEE.VIEW_SENSITIVE
HR.EMPLOYEE.EXPORT
HR.EMPLOYEE.FILE_VIEW
```

### 4.7 Employee Self-Service không cập nhật trực tiếp hồ sơ chính

Employee có thể đề xuất cập nhật một số trường cá nhân, nhưng không ghi trực tiếp vào bảng `employees`.

Luồng đúng:

```text
Employee nhập thông tin muốn sửa
-> Tạo profile_change_requests status Pending
-> Ghi chi tiết từng field vào profile_change_request_items
-> HR/Admin duyệt hoặc từ chối
-> Nếu duyệt, backend mới cập nhật employees
-> Ghi audit_logs
-> Gửi notification cho Employee
```

### 4.8 Mã nhân viên tự sinh theo cấu hình

`employee_code` mặc định do hệ thống tự sinh theo `employee_code_configs` và `sequence_counters`.

Chỉ cho nhập hoặc sửa thủ công khi thỏa cả hai điều kiện:

1. User có permission `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE`.
2. Cấu hình `allow_manual_override = true`.

---

## 5. ERD cấp module HR

### 5.1 ERD dạng text

```text
companies
  1 --- n departments
  1 --- n positions
  1 --- n job_levels
  1 --- n contract_types
  1 --- n employees
  1 --- n employee_code_configs

users
  1 --- 0..1 employees                    qua employees.user_id
  1 --- n employees.created_by/updated_by/deleted_by

employees
  n --- 1 departments                      qua employees.department_id
  n --- 1 positions                        qua employees.position_id
  n --- 0..1 job_levels                    qua employees.job_level_id
  n --- 0..1 employees                     qua employees.direct_manager_id
  1 --- n employee_contracts
  1 --- n employee_status_histories
  1 --- n employee_files
  1 --- n profile_change_requests

employee_contracts
  n --- 1 contract_types
  n --- 1 employees

profile_change_requests
  n --- 1 employees
  1 --- n profile_change_request_items
  n --- 0..1 users                         qua reviewed_by

files
  1 --- n employee_files                   hoặc dùng file_links generic
```

### 5.2 Quan hệ chính

| Quan hệ | Loại | Ghi chú |
| --- | --- | --- |
| `companies.id` -> `employees.company_id` | 1-n | Employee thuộc một công ty |
| `users.id` -> `employees.user_id` | 1-0..1 | Một user liên kết tối đa một employee active trong MVP |
| `departments.id` -> `employees.department_id` | 1-n | Employee thuộc phòng ban chính |
| `positions.id` -> `employees.position_id` | 1-n | Employee có chức vụ chính |
| `job_levels.id` -> `employees.job_level_id` | 1-n | Employee có cấp bậc, nullable |
| `employees.id` -> `employees.direct_manager_id` | 1-n self-reference | Manager trực tiếp |
| `employees.id` -> `employee_contracts.employee_id` | 1-n | Một employee có nhiều hợp đồng theo thời gian |
| `contract_types.id` -> `employee_contracts.contract_type_id` | 1-n | Hợp đồng thuộc một loại hợp đồng |
| `employees.id` -> `profile_change_requests.employee_id` | 1-n | Employee có nhiều yêu cầu cập nhật hồ sơ |
| `profile_change_requests.id` -> `profile_change_request_items.request_id` | 1-n | Một request gồm nhiều field thay đổi |

---

## 6. Danh sách bảng DB-03

| STT | Bảng | Bắt buộc MVP | Mô tả |
| --- | --- | --- | --- |
| 1 | `departments` | Có | Phòng ban/cây tổ chức |
| 2 | `positions` | Có | Chức vụ/vị trí |
| 3 | `job_levels` | Nên có | Cấp bậc nhân sự |
| 4 | `contract_types` | Nên có | Danh mục loại hợp đồng |
| 5 | `employees` | Có | Hồ sơ nhân viên trung tâm |
| 6 | `employee_contracts` | Có/Nên có | Hợp đồng nhân viên |
| 7 | `employee_status_histories` | Có | Lịch sử trạng thái nhân viên |
| 8 | `employee_files` | Nên có | File hồ sơ nhân viên |
| 9 | `profile_change_requests` | Có | Yêu cầu cập nhật hồ sơ cá nhân |
| 10 | `profile_change_request_items` | Có | Chi tiết từng trường thay đổi |
| 11 | `employee_code_configs` | Có | Cấu hình sinh mã nhân viên |
| 12 | `sequence_counters` | Dùng lại Foundation | Bộ đếm sinh mã tự động |

---

## 7. Thiết kế chi tiết bảng

### 7.1 Bảng `departments`

#### Mục đích

Lưu phòng ban/đơn vị tổ chức của công ty. Hỗ trợ cây phòng ban nhiều cấp bằng `parent_id`.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `department_code` | VARCHAR(100) | Có | Mã phòng ban, unique theo company |
| `name` | VARCHAR(255) | Có | Tên phòng ban |
| `description` | TEXT | Không | Mô tả |
| `parent_id` | UUID | Không | FK `departments.id`, dùng cho cây phòng ban |
| `manager_employee_id` | UUID | Không | FK `employees.id`, trưởng phòng |
| `status` | VARCHAR(50) | Có | Active/Inactive |
| `sort_order` | INT | Không | Thứ tự hiển thị |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint đề xuất

```sql
ALTER TABLE departments
ADD CONSTRAINT chk_departments_status
CHECK (status IN ('Active', 'Inactive'));

CREATE UNIQUE INDEX uq_departments_company_code_active
ON departments (company_id, department_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_departments_company_status
ON departments (company_id, status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_departments_parent
ON departments (company_id, parent_id)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Không cho tạo `department_code` trùng trong cùng company.
2. Không cho `parent_id = id`.
3. Không cho tạo vòng lặp cây phòng ban.
4. Không cho xóa mềm phòng ban đang có employee active, trừ khi có cơ chế chuyển phòng ban trước.
5. `manager_employee_id` phải là employee active cùng company.

---

### 7.2 Bảng `positions`

#### Mục đích

Lưu danh mục chức vụ/vị trí công việc.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `position_code` | VARCHAR(100) | Có | Mã chức vụ, unique theo company |
| `name` | VARCHAR(255) | Có | Tên chức vụ |
| `description` | TEXT | Không | Mô tả |
| `department_id` | UUID | Không | FK `departments.id`, nếu chức vụ gắn riêng phòng ban |
| `job_level_id` | UUID | Không | FK `job_levels.id`, level mặc định nếu cần |
| `status` | VARCHAR(50) | Có | Active/Inactive |
| `sort_order` | INT | Không | Thứ tự hiển thị |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE positions
ADD CONSTRAINT chk_positions_status
CHECK (status IN ('Active', 'Inactive'));

CREATE UNIQUE INDEX uq_positions_company_code_active
ON positions (company_id, position_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_positions_company_status
ON positions (company_id, status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_positions_department
ON positions (company_id, department_id)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Không tạo trùng `position_code` trong cùng company.
2. Không xóa mềm chức vụ đang có employee active nếu chưa chuyển chức vụ.
3. `department_id` nullable để một chức vụ có thể dùng chung nhiều phòng ban.

---

### 7.3 Bảng `job_levels`

#### Mục đích

Lưu cấp bậc nhân sự như Intern, Fresher, Junior, Middle, Senior, Lead, Manager, Director.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `level_code` | VARCHAR(100) | Có | Mã cấp bậc |
| `name` | VARCHAR(255) | Có | Tên cấp bậc |
| `rank_order` | INT | Không | Thứ tự cấp bậc, số càng lớn càng cao |
| `description` | TEXT | Không | Mô tả |
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
ALTER TABLE job_levels
ADD CONSTRAINT chk_job_levels_status
CHECK (status IN ('Active', 'Inactive'));

CREATE UNIQUE INDEX uq_job_levels_company_code_active
ON job_levels (company_id, level_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_job_levels_company_rank
ON job_levels (company_id, rank_order)
WHERE deleted_at IS NULL;
```

---

### 7.4 Bảng `contract_types`

#### Mục đích

Lưu danh mục loại hợp đồng lao động.

Ví dụ:

```text
Probation
Fixed Term
Indefinite Term
Part-time
Internship
Service Contract
```

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `contract_type_code` | VARCHAR(100) | Có | Mã loại hợp đồng |
| `name` | VARCHAR(255) | Có | Tên loại hợp đồng |
| `description` | TEXT | Không | Mô tả |
| `default_duration_months` | INT | Không | Thời hạn mặc định nếu có |
| `requires_end_date` | BOOLEAN | Có | Có bắt buộc end_date không |
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
ALTER TABLE contract_types
ADD CONSTRAINT chk_contract_types_status
CHECK (status IN ('Active', 'Inactive'));

CREATE UNIQUE INDEX uq_contract_types_company_code_active
ON contract_types (company_id, contract_type_code)
WHERE deleted_at IS NULL;
```

---

### 7.5 Bảng `employees`

#### Mục đích

Lưu hồ sơ nhân viên trung tâm của hệ thống.

Đây là bảng lõi của DB-03. Các module ATT, LEAVE, TASK, DASH, NOTI, PAYROLL, ASSET, ROOM đều tham chiếu hoặc sử dụng dữ liệu từ `employees`.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `user_id` | UUID | Không | FK `users.id`, liên kết tài khoản đăng nhập |
| `employee_code` | VARCHAR(100) | Có | Mã nhân viên, unique theo company |
| `full_name` | VARCHAR(255) | Có | Họ tên đầy đủ |
| `first_name` | VARCHAR(100) | Không | Tên |
| `last_name` | VARCHAR(100) | Không | Họ/tên đệm |
| `gender` | VARCHAR(50) | Không | Male/Female/Other/Unspecified |
| `date_of_birth` | DATE | Không | Ngày sinh, nhạy cảm |
| `avatar_file_id` | UUID | Không | FK `files.id` |
| `personal_email` | VARCHAR(255) | Không | Email cá nhân, nhạy cảm |
| `company_email` | VARCHAR(255) | Không | Email công ty |
| `phone` | VARCHAR(50) | Không | Số điện thoại, nhạy cảm |
| `address` | TEXT | Không | Địa chỉ gộp (legacy, giữ tương thích; không dùng trong form mới) |
| `current_address` | TEXT | Không | Địa chỉ hiện tại, nhạy cảm |
| `permanent_address` | TEXT | Không | Địa chỉ thường trú, nhạy cảm |
| `identity_number` | VARCHAR(100) | Không | CCCD/CMND/passport, nhạy cảm |
| `identity_issue_date` | DATE | Không | Ngày cấp giấy tờ |
| `identity_issue_place` | VARCHAR(255) | Không | Nơi cấp giấy tờ |
| `tax_code` | VARCHAR(100) | Không | Mã số thuế cá nhân, nhạy cảm |
| `bank_account_number` | VARCHAR(100) | Không | Số tài khoản, nhạy cảm |
| `bank_name` | VARCHAR(255) | Không | Ngân hàng |
| `emergency_contact_name` | VARCHAR(255) | Không | Liên hệ khẩn cấp |
| `emergency_contact_phone` | VARCHAR(50) | Không | SĐT khẩn cấp |
| `department_id` | UUID | Có | FK `departments.id` |
| `position_id` | UUID | Có | FK `positions.id` |
| `job_level_id` | UUID | Không | FK `job_levels.id` |
| `direct_manager_id` | UUID | Không | FK `employees.id` |
| `joined_date` | DATE | Có | Ngày vào làm |
| `official_date` | DATE | Không | Ngày chính thức |
| `probation_end_date` | DATE | Không | Ngày kết thúc thử việc |
| `resigned_date` | DATE | Không | Ngày nghỉ việc |
| `employment_status` | VARCHAR(50) | Có | Onboarding/Probation/Official/Temporarily Suspended/Resigned/Terminated |
| `employee_type` | VARCHAR(50) | Không | Full-time/Part-time/Intern/Contractor |
| `work_location` | VARCHAR(255) | Không | Văn phòng/chi nhánh/khu vực làm việc |
| `is_employee_code_locked` | BOOLEAN | Có | Khóa sửa mã sau khi tạo |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint đề xuất

```sql
ALTER TABLE employees
ADD CONSTRAINT chk_employees_employment_status
CHECK (employment_status IN (
    'Onboarding',
    'Probation',
    'Official',
    'Temporarily Suspended',
    'Resigned',
    'Terminated'
));

ALTER TABLE employees
ADD CONSTRAINT chk_employees_gender
CHECK (gender IS NULL OR gender IN ('Male', 'Female', 'Other', 'Unspecified'));

ALTER TABLE employees
ADD CONSTRAINT chk_employees_type
CHECK (employee_type IS NULL OR employee_type IN ('Full-time', 'Part-time', 'Intern', 'Contractor'));

CREATE UNIQUE INDEX uq_employees_company_code_active
ON employees (company_id, employee_code)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_employees_user_id_active
ON employees (user_id)
WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_employees_company_email_active
ON employees (company_id, lower(company_email))
WHERE company_email IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_employees_company_status
ON employees (company_id, employment_status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_employees_department
ON employees (company_id, department_id, employment_status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_employees_manager
ON employees (company_id, direct_manager_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_employees_joined_date
ON employees (company_id, joined_date DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_employees_full_name_trgm
ON employees USING gin (full_name gin_trgm_ops)
WHERE deleted_at IS NULL;
```

> Ghi chú: `gin_trgm_ops` cần extension `pg_trgm`. Nếu chưa dùng, có thể thay bằng index thường hoặc full-text search sau.

#### Quy tắc nghiệp vụ

1. `employee_code` bắt buộc và unique trong company.
2. `employee_code` mặc định sinh tự động, không nhập tay nếu không có quyền.
3. `department_id`, `position_id`, `joined_date`, `employment_status`, `full_name` là dữ liệu tối thiểu khi tạo employee.
4. `user_id` nullable vì không phải employee nào cũng cần đăng nhập.
5. Một user chỉ liên kết tối đa một employee active trong MVP.
6. `direct_manager_id` không được trỏ về chính employee đó.
7. Manager trực tiếp phải cùng company và không ở trạng thái `Resigned`/`Terminated`.
8. Employee ở trạng thái `Resigned` hoặc `Terminated` không được chấm công, xin nghỉ mới hoặc nhận task mới trừ khi module liên quan có rule ngoại lệ.
9. Khi đổi trạng thái employee, phải ghi `employee_status_histories` và `audit_logs`.

---

### 7.6 Bảng `employee_status_histories`

#### Mục đích

Lưu lịch sử thay đổi trạng thái làm việc của nhân viên.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `employee_id` | UUID | Có | FK `employees.id` |
| `old_status` | VARCHAR(50) | Không | Trạng thái cũ |
| `new_status` | VARCHAR(50) | Có | Trạng thái mới |
| `effective_date` | DATE | Có | Ngày hiệu lực |
| `reason` | TEXT | Không | Lý do thay đổi |
| `note` | TEXT | Không | Ghi chú |
| `changed_by` | UUID | Không | FK `users.id` |
| `changed_at` | TIMESTAMP | Có | Thời điểm thao tác |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |

#### Index đề xuất

```sql
CREATE INDEX idx_employee_status_histories_employee_date
ON employee_status_histories (employee_id, effective_date DESC);

CREATE INDEX idx_employee_status_histories_company_status
ON employee_status_histories (company_id, new_status, effective_date DESC);
```

#### Quy tắc nghiệp vụ

1. Mỗi lần đổi `employees.employment_status` phải thêm một dòng history.
2. `effective_date` có thể khác `changed_at` nếu HR nhập ngày hiệu lực trong quá khứ/tương lai.
3. Nếu status chuyển sang `Resigned` hoặc `Terminated`, backend có thể gọi AUTH khóa user/revoke session theo cấu hình.

---

### 7.7 Bảng `employee_contracts`

#### Mục đích

Lưu hợp đồng lao động/thỏa thuận làm việc của nhân viên.

Một employee có thể có nhiều hợp đồng theo thời gian, nhưng tại một thời điểm chỉ nên có một hợp đồng active chính.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `employee_id` | UUID | Có | FK `employees.id` |
| `contract_type_id` | UUID | Có | FK `contract_types.id` |
| `contract_code` | VARCHAR(100) | Không | Mã hợp đồng, unique nếu có |
| `title` | VARCHAR(255) | Không | Tên hợp đồng |
| `start_date` | DATE | Có | Ngày bắt đầu |
| `end_date` | DATE | Không | Ngày kết thúc |
| `signed_date` | DATE | Không | Ngày ký |
| `status` | VARCHAR(50) | Có | Draft/Active/Expired/Terminated/Cancelled |
| `is_primary` | BOOLEAN | Có | Hợp đồng chính hiện tại |
| `file_id` | UUID | Không | FK `files.id`, file hợp đồng |
| `note` | TEXT | Không | Ghi chú |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE employee_contracts
ADD CONSTRAINT chk_employee_contracts_status
CHECK (status IN ('Draft', 'Active', 'Expired', 'Terminated', 'Cancelled'));

ALTER TABLE employee_contracts
ADD CONSTRAINT chk_employee_contracts_date
CHECK (end_date IS NULL OR end_date >= start_date);

CREATE UNIQUE INDEX uq_employee_contracts_company_code_active
ON employee_contracts (company_id, contract_code)
WHERE contract_code IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_employee_contracts_primary_active
ON employee_contracts (employee_id)
WHERE is_primary = true AND status = 'Active' AND deleted_at IS NULL;

CREATE INDEX idx_employee_contracts_employee
ON employee_contracts (employee_id, start_date DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_employee_contracts_expiring
ON employee_contracts (company_id, status, end_date)
WHERE deleted_at IS NULL AND end_date IS NOT NULL;
```

#### Quy tắc nghiệp vụ

1. `end_date` không được nhỏ hơn `start_date`.
2. Nếu `contract_types.requires_end_date = true`, hợp đồng phải có `end_date`.
3. Không khuyến khích có nhiều hợp đồng `Active + is_primary = true` cho một employee.
4. Có thể cảnh báo khi hợp đồng active bị overlap thời gian.
5. Hợp đồng sắp hết hạn là nguồn dữ liệu cho DASH và NOTI.

---

### 7.8 Bảng `employee_files`

#### Mục đích

Liên kết file với hồ sơ nhân viên theo nghiệp vụ HR.

Có 2 cách triển khai:

1. Dùng bảng riêng `employee_files` để quản lý metadata HR-specific.
2. Dùng bảng dùng chung `file_links` với `module_code = 'HR'` và `entity_type = 'Employee'`.

Khuyến nghị MVP: dùng `employee_files` nếu cần quyền file nhạy cảm rõ ràng; đồng thời vẫn có thể liên kết tới bảng `files` dùng chung.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `employee_id` | UUID | Có | FK `employees.id` |
| `file_id` | UUID | Có | FK `files.id` |
| `file_category` | VARCHAR(100) | Có | CV/IDENTITY/CONTRACT/CERTIFICATE/DECISION/OTHER |
| `title` | VARCHAR(255) | Không | Tên hiển thị |
| `description` | TEXT | Không | Mô tả |
| `is_sensitive` | BOOLEAN | Có | File nhạy cảm |
| `status` | VARCHAR(50) | Có | Active/Archived |
| `uploaded_by` | UUID | Không | FK `users.id` |
| `uploaded_at` | TIMESTAMP | Có | Thời điểm upload |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE employee_files
ADD CONSTRAINT chk_employee_files_category
CHECK (file_category IN ('CV', 'IDENTITY', 'CONTRACT', 'CERTIFICATE', 'DECISION', 'OTHER'));

ALTER TABLE employee_files
ADD CONSTRAINT chk_employee_files_status
CHECK (status IN ('Active', 'Archived'));

CREATE INDEX idx_employee_files_employee
ON employee_files (employee_id, file_category)
WHERE deleted_at IS NULL;

CREATE INDEX idx_employee_files_company_sensitive
ON employee_files (company_id, is_sensitive)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. File nhạy cảm chỉ được xem bởi user có `HR.EMPLOYEE.FILE_VIEW` và đủ data scope.
2. Nếu `is_sensitive = true`, có thể yêu cầu thêm `HR.EMPLOYEE.VIEW_SENSITIVE`.
3. Upload/xóa/download file nên ghi audit log.

---

### 7.9 Bảng `profile_change_requests`

#### Mục đích

Lưu yêu cầu cập nhật hồ sơ cá nhân do Employee tạo.

Bảng này là phần quan trọng để đảm bảo Employee Self-Service có kiểm duyệt, tránh việc nhân viên tự sửa trực tiếp dữ liệu chính.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `request_code` | VARCHAR(100) | Không | Mã yêu cầu nếu cần |
| `employee_id` | UUID | Có | FK `employees.id`, người gửi yêu cầu |
| `submitted_by` | UUID | Có | FK `users.id` |
| `status` | VARCHAR(50) | Có | Draft/Pending/Approved/Rejected/Cancelled |
| `reason` | TEXT | Không | Lý do yêu cầu thay đổi |
| `reviewed_by` | UUID | Không | FK `users.id` |
| `reviewed_at` | TIMESTAMP | Không | Thời điểm duyệt/từ chối |
| `review_note` | TEXT | Không | Lý do từ chối/ghi chú duyệt |
| `applied_at` | TIMESTAMP | Không | Thời điểm áp dụng vào employees |
| `cancelled_at` | TIMESTAMP | Không | Thời điểm hủy |
| `cancelled_by` | UUID | Không | FK `users.id` |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE profile_change_requests
ADD CONSTRAINT chk_profile_change_requests_status
CHECK (status IN ('Draft', 'Pending', 'Approved', 'Rejected', 'Cancelled'));

CREATE UNIQUE INDEX uq_profile_change_requests_company_code_active
ON profile_change_requests (company_id, request_code)
WHERE request_code IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_profile_change_requests_employee_status
ON profile_change_requests (employee_id, status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_profile_change_requests_company_status
ON profile_change_requests (company_id, status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_profile_change_requests_reviewer
ON profile_change_requests (company_id, reviewed_by, reviewed_at DESC)
WHERE reviewed_by IS NOT NULL;
```

#### Quy tắc nghiệp vụ

1. Employee chỉ tạo request cho chính employee liên kết với user hiện tại.
2. Employee không được tạo request thay đổi các trường công việc như `department_id`, `position_id`, `job_level_id`, `employment_status`, `joined_date`, `direct_manager_id` nếu không có rule đặc biệt.
3. Khi request ở `Pending`, Employee có thể hủy nếu có quyền `HR.PROFILE_CHANGE_REQUEST.CANCEL_OWN`.
4. Khi request được Approved, backend áp dụng thay đổi trong transaction.
5. Nếu dữ liệu gốc đã đổi so với lúc tạo request, backend cần cảnh báo hoặc chặn duyệt để tránh ghi đè sai.
6. Duyệt/từ chối phải ghi audit log và gửi notification.

---

### 7.10 Bảng `profile_change_request_items`

#### Mục đích

Lưu từng field mà Employee yêu cầu thay đổi.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `request_id` | UUID | Có | FK `profile_change_requests.id` |
| `field_name` | VARCHAR(100) | Có | Tên field trong `employees` |
| `field_label` | VARCHAR(255) | Không | Tên hiển thị |
| `old_value` | JSONB | Không | Giá trị cũ tại lúc tạo request |
| `new_value` | JSONB | Có | Giá trị mới đề xuất |
| `value_type` | VARCHAR(50) | Không | String/Date/Number/Boolean/JSON |
| `is_sensitive` | BOOLEAN | Có | Field nhạy cảm |
| `validation_status` | VARCHAR(50) | Không | Valid/Invalid/Warning |
| `validation_message` | TEXT | Không | Nội dung kiểm tra nếu có |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |

#### Constraint/index đề xuất

```sql
ALTER TABLE profile_change_request_items
ADD CONSTRAINT chk_profile_change_request_items_validation_status
CHECK (validation_status IS NULL OR validation_status IN ('Valid', 'Invalid', 'Warning'));

CREATE UNIQUE INDEX uq_profile_change_request_items_field
ON profile_change_request_items (request_id, field_name);

CREATE INDEX idx_profile_change_request_items_request
ON profile_change_request_items (request_id);
```

#### Danh sách field Employee được đề xuất sửa trong MVP

| Field | Cho Employee đề xuất sửa | Nhạy cảm | Ghi chú |
| --- | --- | --- | --- |
| `phone` | Có | Có | Cần validate format |
| `personal_email` | Có | Có | Cần validate email |
| `current_address` | Có | Có | Có thể dài |
| `permanent_address` | Có | Có | Có thể dài |
| `emergency_contact_name` | Có | Có |  |
| `emergency_contact_phone` | Có | Có |  |
| `bank_account_number` | Tùy cấu hình | Có | Nên cần quyền/duyệt chặt |
| `bank_name` | Tùy cấu hình | Có |  |
| `tax_code` | Tùy cấu hình | Có |  |
| `identity_number` | Tùy cấu hình | Có | Có thể yêu cầu file đính kèm |
| `department_id` | Không | Không | HR/Admin xử lý |
| `position_id` | Không | Không | HR/Admin xử lý |
| `employment_status` | Không | Không | HR/Admin xử lý |
| `employee_code` | Không | Không | Chỉ theo cấu hình mã |

---

### 7.11 Bảng `employee_code_configs`

#### Mục đích

Lưu cấu hình sinh mã nhân viên theo từng company.

Ví dụ format:

```text
EMP0001
HR0001
DEV0001
2026-EMP-0001
FMC-HR-0001
```

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `config_name` | VARCHAR(255) | Có | Tên cấu hình |
| `prefix` | VARCHAR(50) | Không | Tiền tố mặc định |
| `suffix` | VARCHAR(50) | Không | Hậu tố nếu có |
| `pattern` | VARCHAR(255) | Có | Pattern sinh mã |
| `padding_length` | INT | Có | Số chữ số thứ tự |
| `start_number` | BIGINT | Có | Số bắt đầu |
| `current_number` | BIGINT | Có | Số hiện tại nếu không dùng sequence_counters |
| `reset_policy` | VARCHAR(50) | Có | Never/Yearly/Monthly/Daily |
| `include_year` | BOOLEAN | Có | Có dùng năm trong mã không |
| `include_month` | BOOLEAN | Có | Có dùng tháng trong mã không |
| `department_based` | BOOLEAN | Có | Có sinh theo phòng ban không |
| `allow_manual_override` | BOOLEAN | Có | Cho phép sửa tay nếu có quyền |
| `lock_after_created` | BOOLEAN | Có | Khóa mã sau khi tạo |
| `is_active` | BOOLEAN | Có | Cấu hình đang dùng |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE employee_code_configs
ADD CONSTRAINT chk_employee_code_configs_reset_policy
CHECK (reset_policy IN ('Never', 'Yearly', 'Monthly', 'Daily'));

ALTER TABLE employee_code_configs
ADD CONSTRAINT chk_employee_code_configs_padding
CHECK (padding_length BETWEEN 1 AND 12);

CREATE UNIQUE INDEX uq_employee_code_configs_active
ON employee_code_configs (company_id)
WHERE is_active = true AND deleted_at IS NULL;
```

#### Pattern đề xuất

| Pattern | Kết quả ví dụ | Ghi chú |
| --- | --- | --- |
| `{PREFIX}{SEQ}` | EMP0001 | Đơn giản |
| `{PREFIX}-{SEQ}` | EMP-0001 | Có dấu gạch |
| `{YEAR}-{PREFIX}-{SEQ}` | 2026-EMP-0001 | Reset theo năm nếu cần |
| `{PREFIX}-{DEPT_CODE}-{SEQ}` | FMC-HR-0001 | Theo phòng ban |
| `{YEAR}{MONTH}-{PREFIX}-{SEQ}` | 202606-EMP-0001 | Theo tháng |

#### Quy tắc nghiệp vụ

1. Mỗi company chỉ có một config active trong MVP.
2. Khi tạo employee, backend lấy config active để sinh mã.
3. Sinh mã phải chạy trong transaction hoặc dùng lock để tránh trùng khi nhiều người tạo cùng lúc.
4. Nếu đổi config, không ảnh hưởng mã nhân viên đã tạo.
5. Nếu `lock_after_created = true`, set `employees.is_employee_code_locked = true`.

---

### 7.12 Bảng dùng chung `sequence_counters`

#### Mục đích

Bảng này thuộc Foundation nhưng DB-03 sử dụng để sinh mã nhân viên an toàn.

#### Cấu trúc khuyến nghị liên quan HR

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `sequence_key` | VARCHAR(100) | Có | Ví dụ `EMPLOYEE_CODE` |
| `scope_key` | VARCHAR(100) | Không | Dùng nếu theo phòng ban/năm/tháng |
| `prefix` | VARCHAR(50) | Không | Prefix hiện hành |
| `current_value` | BIGINT | Có | Số hiện tại |
| `padding_length` | INT | Có | Độ dài số |
| `reset_policy` | VARCHAR(50) | Có | Never/Yearly/Monthly/Daily |
| `last_reset_at` | TIMESTAMP | Không | Lần reset gần nhất |
| `created_at` | TIMESTAMP | Có |  |
| `updated_at` | TIMESTAMP | Có |  |

#### Unique/index đề xuất

```sql
CREATE UNIQUE INDEX uq_sequence_counters_company_key_scope
ON sequence_counters (company_id, sequence_key, COALESCE(scope_key, ''));
```

#### Query sinh mã an toàn

```sql
BEGIN;

SELECT *
FROM sequence_counters
WHERE company_id = :company_id
  AND sequence_key = 'EMPLOYEE_CODE'
  AND COALESCE(scope_key, '') = COALESCE(:scope_key, '')
FOR UPDATE;

UPDATE sequence_counters
SET current_value = current_value + 1,
    updated_at = now()
WHERE id = :counter_id
RETURNING current_value;

-- Backend format employee_code từ pattern + current_value
-- Sau đó insert employees

COMMIT;
```

---

## 8. Quyền và data scope trong HR

### 8.1 Permission HR cần seed

| Permission | Mô tả | Scope mặc định đề xuất |
| --- | --- | --- |
| `HR.EMPLOYEE.VIEW` | Xem danh sách/hồ sơ nhân viên | Own/Team/Department/Company/System |
| `HR.EMPLOYEE.VIEW_SENSITIVE` | Xem dữ liệu nhạy cảm | Company/System, hạn chế Manager |
| `HR.EMPLOYEE.CREATE` | Tạo nhân viên | Company/System |
| `HR.EMPLOYEE.UPDATE` | Cập nhật hồ sơ nhân viên | Company/System |
| `HR.EMPLOYEE.CHANGE_STATUS` | Đổi trạng thái nhân viên | Company/System |
| `HR.EMPLOYEE.DELETE` | Xóa mềm nhân viên | Company/System |
| `HR.EMPLOYEE.EXPORT` | Xuất danh sách nhân viên | Company/System |
| `HR.EMPLOYEE.FILE_VIEW` | Xem file hồ sơ | Theo scope |
| `HR.EMPLOYEE.FILE_UPLOAD` | Upload file hồ sơ | Company/System |
| `HR.EMPLOYEE.FILE_DELETE` | Xóa file hồ sơ | Company/System |
| `HR.DEPARTMENT.VIEW` | Xem phòng ban | Company/System |
| `HR.DEPARTMENT.CREATE` | Tạo phòng ban | Company/System |
| `HR.DEPARTMENT.UPDATE` | Cập nhật phòng ban | Company/System |
| `HR.DEPARTMENT.DELETE` | Xóa mềm phòng ban | Company/System |
| `HR.POSITION.VIEW` | Xem chức vụ | Company/System |
| `HR.POSITION.CREATE` | Tạo chức vụ | Company/System |
| `HR.POSITION.UPDATE` | Cập nhật chức vụ | Company/System |
| `HR.POSITION.DELETE` | Xóa mềm chức vụ | Company/System |
| `HR.CONTRACT.VIEW` | Xem hợp đồng | Company/System |
| `HR.CONTRACT.CREATE` | Tạo hợp đồng | Company/System |
| `HR.CONTRACT.UPDATE` | Cập nhật hợp đồng | Company/System |
| `HR.CONTRACT.DELETE` | Xóa mềm hợp đồng | Company/System |
| `HR.AUDIT_LOG.VIEW` | Xem lịch sử thay đổi | Company/System |
| `HR.ORG_CHART.VIEW` | Xem sơ đồ tổ chức | Team/Department/Company/System |
| `HR.MASTER_DATA.MANAGE` | Quản lý level/contract type | Company/System |
| `HR.PROFILE_CHANGE_REQUEST.CREATE` | Employee gửi yêu cầu sửa hồ sơ | Own |
| `HR.PROFILE_CHANGE_REQUEST.VIEW_OWN` | Employee xem yêu cầu của mình | Own |
| `HR.PROFILE_CHANGE_REQUEST.VIEW` | HR/Admin xem danh sách yêu cầu | Company/System |
| `HR.PROFILE_CHANGE_REQUEST.APPROVE` | Duyệt yêu cầu cập nhật hồ sơ | Company/System |
| `HR.PROFILE_CHANGE_REQUEST.REJECT` | Từ chối yêu cầu cập nhật hồ sơ | Company/System |
| `HR.PROFILE_CHANGE_REQUEST.CANCEL_OWN` | Employee hủy yêu cầu của mình | Own |
| `HR.EMPLOYEE_CODE_CONFIG.VIEW` | Xem cấu hình mã nhân viên | Company/System |
| `HR.EMPLOYEE_CODE_CONFIG.UPDATE` | Cập nhật cấu hình mã nhân viên | Company/System |
| `HR.EMPLOYEE_CODE.PREVIEW` | Xem trước mã tiếp theo | Company/System |
| `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` | Sửa mã thủ công | Company/System, hạn chế |

### 8.2 Data scope trong HR

| Scope | Điều kiện query đề xuất |
| --- | --- |
| Own | `employees.user_id = current_user_id` hoặc `employees.id = current_employee_id` |
| Team | `employees.direct_manager_id = current_employee_id` |
| Department | `employees.department_id IN managed_department_ids` |
| Company | `employees.company_id = current_company_id` |
| System | Không giới hạn company, chỉ Super Admin |

### 8.3 Field masking theo quyền

Khi user thiếu `HR.EMPLOYEE.VIEW_SENSITIVE`, API response nên:

1. Không trả field nhạy cảm; hoặc
2. Trả masked value như `********1234`; hoặc
3. Trả `null` tùy convention API.

Khuyến nghị MVP: không trả field nhạy cảm nếu thiếu quyền, frontend hiển thị `Không có quyền xem`.

---

## 9. Luồng xử lý nghiệp vụ và tác động database

### 9.1 Luồng tạo employee không tạo user

```text
HR/Admin nhập thông tin nhân viên
-> Backend kiểm tra permission HR.EMPLOYEE.CREATE
-> Backend kiểm tra department/position/job_level active
-> Backend sinh employee_code theo employee_code_configs + sequence_counters
-> Insert employees
-> Insert employee_status_histories nếu có status ban đầu
-> Ghi audit_logs action CREATE
-> NOTI có thể tạo thông báo HR-NOTI-001 nếu cấu hình
```

Transaction đề xuất:

```text
BEGIN
  lock sequence_counters
  generate employee_code
  insert employees
  insert employee_status_histories
  insert audit_logs
COMMIT
```

### 9.2 Luồng tạo employee kèm user

```text
HR/Admin tạo employee và chọn create_user_account = true
-> HR service validate dữ liệu employee
-> AUTH service tạo users status Pending Activation
-> AUTH service gán role EMPLOYEE vào user_roles
-> HR service insert employees.user_id = users.id
-> Tạo password reset/activation token nếu có
-> Ghi audit log HR + AUTH
-> NOTI/email gửi link kích hoạt
```

Yêu cầu transaction:

1. Nếu tạo user thành công nhưng tạo employee fail, phải rollback hoặc cleanup.
2. Nếu tạo employee thành công nhưng gán role fail, phải rollback toàn bộ transaction nếu cùng database.
3. Nếu gửi email/notification fail, không rollback employee, nhưng ghi delivery log để retry.

### 9.3 Luồng liên kết user với employee có sẵn

```text
HR/Admin chọn employee
-> Chọn user chưa liên kết employee
-> Backend kiểm tra user cùng company
-> Backend kiểm tra user chưa liên kết employee active khác
-> Update employees.user_id
-> Ghi audit_logs
-> NOTI gửi thông báo cho user nếu cần
```

Constraint bảo vệ:

```sql
CREATE UNIQUE INDEX uq_employees_user_id_active
ON employees (user_id)
WHERE user_id IS NOT NULL AND deleted_at IS NULL;
```

### 9.4 Luồng Employee gửi yêu cầu cập nhật hồ sơ

```text
Employee mở Hồ sơ của tôi
-> Cập nhật trường được phép
-> Backend kiểm tra field whitelist
-> Insert profile_change_requests status Pending
-> Insert profile_change_request_items từng field
-> Ghi audit_logs action SUBMIT
-> NOTI gửi HR/Admin có quyền duyệt
```

### 9.5 Luồng HR/Admin duyệt yêu cầu cập nhật hồ sơ

```text
HR/Admin mở request Pending
-> Backend kiểm tra permission APPROVE
-> Backend kiểm tra request cùng company và còn Pending
-> Backend kiểm tra dữ liệu gốc có thay đổi không
-> Update employees theo new_value của từng item
-> Update profile_change_requests status Approved, reviewed_by, reviewed_at, applied_at
-> Ghi audit_logs old/new values
-> NOTI gửi Employee kết quả Approved
```

Transaction đề xuất:

```text
BEGIN
  SELECT profile_change_requests FOR UPDATE
  SELECT employees FOR UPDATE
  validate old_value conflict
  update employees
  update profile_change_requests
  insert audit_logs
COMMIT
```

### 9.6 Luồng HR/Admin từ chối yêu cầu cập nhật hồ sơ

```text
HR/Admin nhập lý do từ chối
-> Backend kiểm tra permission REJECT
-> Update profile_change_requests status Rejected, review_note
-> Không update employees
-> Ghi audit_logs
-> NOTI gửi Employee kết quả Rejected
```

### 9.7 Luồng đổi trạng thái employee

```text
HR/Admin đổi employment_status
-> Backend kiểm tra permission HR.EMPLOYEE.CHANGE_STATUS
-> Update employees.employment_status
-> Insert employee_status_histories
-> Nếu Resigned/Terminated: có thể gọi AUTH khóa user/revoke session
-> Ghi audit_logs
-> NOTI gửi HR/Admin/Manager liên quan
```

### 9.8 Luồng upload file hồ sơ

```text
HR/Admin upload file
-> File service lưu file vào storage
-> Insert files
-> Insert employee_files hoặc file_links
-> Nếu file nhạy cảm, set is_sensitive = true
-> Ghi audit_logs
```

---

## 10. Query pattern đề xuất

### 10.1 Query danh sách nhân viên theo Company

```sql
SELECT
    e.id,
    e.employee_code,
    e.full_name,
    e.company_email,
    e.employment_status,
    e.joined_date,
    d.name AS department_name,
    p.name AS position_name,
    jl.name AS job_level_name,
    m.full_name AS direct_manager_name
FROM employees e
JOIN departments d ON d.id = e.department_id
JOIN positions p ON p.id = e.position_id
LEFT JOIN job_levels jl ON jl.id = e.job_level_id
LEFT JOIN employees m ON m.id = e.direct_manager_id
WHERE e.company_id = :company_id
  AND e.deleted_at IS NULL
  AND (:status IS NULL OR e.employment_status = :status)
  AND (:department_id IS NULL OR e.department_id = :department_id)
ORDER BY e.created_at DESC
LIMIT :limit OFFSET :offset;
```

### 10.2 Query nhân viên theo scope Team

```sql
SELECT e.*
FROM employees e
WHERE e.company_id = :company_id
  AND e.direct_manager_id = :current_employee_id
  AND e.deleted_at IS NULL;
```

### 10.3 Query hồ sơ của tôi

```sql
SELECT e.*
FROM employees e
WHERE e.company_id = :company_id
  AND e.user_id = :current_user_id
  AND e.deleted_at IS NULL;
```

### 10.4 Query hợp đồng sắp hết hạn

```sql
SELECT
    ec.*,
    e.employee_code,
    e.full_name,
    d.name AS department_name
FROM employee_contracts ec
JOIN employees e ON e.id = ec.employee_id
JOIN departments d ON d.id = e.department_id
WHERE ec.company_id = :company_id
  AND ec.status = 'Active'
  AND ec.end_date IS NOT NULL
  AND ec.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
  AND ec.deleted_at IS NULL
  AND e.deleted_at IS NULL
ORDER BY ec.end_date ASC;
```

### 10.5 Query request cập nhật hồ sơ chờ duyệt

```sql
SELECT
    r.id,
    r.request_code,
    r.status,
    r.created_at,
    e.employee_code,
    e.full_name,
    d.name AS department_name,
    COUNT(i.id) AS changed_field_count
FROM profile_change_requests r
JOIN employees e ON e.id = r.employee_id
JOIN departments d ON d.id = e.department_id
JOIN profile_change_request_items i ON i.request_id = r.id
WHERE r.company_id = :company_id
  AND r.status = 'Pending'
  AND r.deleted_at IS NULL
GROUP BY r.id, e.employee_code, e.full_name, d.name
ORDER BY r.created_at ASC;
```

---

## 11. API -> bảng tác động

| API/Chức năng | Bảng đọc | Bảng ghi |
| --- | --- | --- |
| `GET /api/employees` | employees, departments, positions, job_levels | - |
| `POST /api/employees` | departments, positions, job_levels, employee_code_configs, sequence_counters | employees, employee_status_histories, audit_logs |
| `PUT /api/employees/{id}` | employees | employees, audit_logs |
| `PATCH /api/employees/{id}/status` | employees | employees, employee_status_histories, audit_logs |
| `POST /api/employees/{id}/link-user` | employees, users | employees, audit_logs |
| `GET /api/departments/tree` | departments | - |
| `POST /api/departments` | departments | departments, audit_logs |
| `POST /api/employees/{id}/contracts` | employees, contract_types | employee_contracts, audit_logs |
| `POST /api/employees/{id}/files` | employees, files | files, employee_files, audit_logs |
| `POST /api/profile-change-requests` | employees | profile_change_requests, profile_change_request_items, audit_logs |
| `POST /api/profile-change-requests/{id}/approve` | profile_change_requests, profile_change_request_items, employees | employees, profile_change_requests, audit_logs |
| `PUT /api/employee-code-config` | employee_code_configs | employee_code_configs, audit_logs |
| `GET /api/employee-code-config/preview` | employee_code_configs, sequence_counters | - |

---

## 12. Tích hợp với module khác

### 12.1 Tích hợp với AUTH

Quan hệ chính:

```text
employees.user_id -> users.id
```

AUTH cung cấp:

1. `current_user_id`.
2. `company_id`.
3. Roles/permissions.
4. Data scope.

HR cung cấp ngược lại:

1. `employee_id` tương ứng user.
2. Department/position/manager của user.
3. Employment status để các module khác kiểm tra.

### 12.2 Tích hợp với ATT

ATT cần HR để:

1. Xác định employee từ user.
2. Kiểm tra trạng thái nhân viên trước khi chấm công.
3. Lấy department/manager để áp dụng rule hoặc scope.
4. Chặn nhân viên đã nghỉ việc chấm công.
5. Hiển thị bảng công theo employee.

Quan hệ:

```text
attendance_records.employee_id -> employees.id
attendance_logs.employee_id -> employees.id
attendance_adjustment_requests.employee_id -> employees.id
remote_work_requests.employee_id -> employees.id
```

### 12.3 Tích hợp với LEAVE

LEAVE cần HR để:

1. Xác định employee tạo đơn nghỉ.
2. Lấy direct manager để duyệt đơn.
3. Lấy joined_date/employment_status để tính chính sách nghỉ.
4. Hiển thị lịch nghỉ theo team/department/company.

Quan hệ:

```text
leave_requests.employee_id -> employees.id
leave_balances.employee_id -> employees.id
leave_request_approvals.approver_employee_id -> employees.id
```

### 12.4 Tích hợp với TASK

TASK cần HR để:

1. Giao task cho employee active.
2. Xác định project owner/member/assignee.
3. Kiểm tra manager scope thông qua `direct_manager_id`.
4. Cảnh báo khi assignee đã nghỉ việc hoặc đang nghỉ phép.

Quan hệ:

```text
projects.owner_employee_id -> employees.id
project_members.employee_id -> employees.id
tasks.main_assignee_employee_id -> employees.id
task_assignees.employee_id -> employees.id
```

### 12.5 Tích hợp với DASH

DASH lấy dữ liệu HR để hiển thị:

1. Tổng số nhân viên active/probation/resigned.
2. Nhân sự mới trong tháng.
3. Hợp đồng sắp hết hạn.
4. Cơ cấu nhân sự theo phòng ban.
5. Yêu cầu cập nhật hồ sơ chờ xử lý.

DASH không sửa dữ liệu HR.

### 12.6 Tích hợp với NOTI

HR phát event cho NOTI khi:

1. Nhân viên mới được tạo.
2. Hồ sơ nhân viên được cập nhật.
3. Employee gửi yêu cầu cập nhật hồ sơ.
4. HR/Admin duyệt hoặc từ chối yêu cầu cập nhật hồ sơ.
5. Hợp đồng sắp hết hạn.
6. Trạng thái nhân viên thay đổi.
7. Nhân viên đổi phòng ban hoặc manager.

---

## 13. Dữ liệu nhạy cảm và bảo mật

### 13.1 Phân loại trường nhạy cảm

| Bảng | Trường | Mức nhạy cảm | Quyền cần có |
| --- | --- | --- | --- |
| employees | `date_of_birth` | Medium | `HR.EMPLOYEE.VIEW_SENSITIVE` |
| employees | `identity_number` | High | `HR.EMPLOYEE.VIEW_SENSITIVE` |
| employees | `identity_issue_date` | High | `HR.EMPLOYEE.VIEW_SENSITIVE` |
| employees | `identity_issue_place` | High | `HR.EMPLOYEE.VIEW_SENSITIVE` |
| employees | `personal_email` | Medium | `HR.EMPLOYEE.VIEW_SENSITIVE` hoặc Own |
| employees | `phone` | Medium | `HR.EMPLOYEE.VIEW_SENSITIVE` hoặc Own |
| employees | `address` | Medium | `HR.EMPLOYEE.VIEW_SENSITIVE` hoặc Own |
| employees | `current_address` | Medium | `HR.EMPLOYEE.VIEW_SENSITIVE` hoặc Own |
| employees | `permanent_address` | Medium | `HR.EMPLOYEE.VIEW_SENSITIVE` hoặc Own |
| employees | `tax_code` | High | `HR.EMPLOYEE.VIEW_SENSITIVE` |
| employees | `bank_account_number` | High | `HR.EMPLOYEE.VIEW_SENSITIVE` |
| employee_files | file `IDENTITY` | High | `HR.EMPLOYEE.FILE_VIEW` + sensitive |
| employee_contracts | file hợp đồng | Medium/High | `HR.CONTRACT.VIEW` |

### 13.2 Nguyên tắc API response

1. Backend quyết định field nào được trả, không phụ thuộc frontend.
2. Employee xem hồ sơ của chính mình có thể thấy dữ liệu cá nhân của mình, nhưng không thấy dữ liệu nội bộ như audit/admin note nếu có.
3. Manager không mặc định xem dữ liệu nhạy cảm của team.
4. Export phải áp dụng cùng rule field-level permission.
5. Tải file nhạy cảm nên ghi audit log.

---

## 14. Migration plan

### 14.1 Điều kiện trước khi chạy DB-03

DB-03 cần các bảng Foundation/AUTH đã tồn tại:

```text
companies
users
roles
permissions
user_roles
role_permissions
audit_logs
files
file_links
sequence_counters
```

### 14.2 Thứ tự migration DB-03

1. Tạo extension `pgcrypto` nếu chưa có.
2. Tạo extension `pg_trgm` nếu dùng tìm kiếm full_name bằng trigram.
3. Tạo bảng `departments` chưa có FK `manager_employee_id` trước, hoặc tạo FK sau.
4. Tạo bảng `job_levels`.
5. Tạo bảng `positions`.
6. Tạo bảng `contract_types`.
7. Tạo bảng `employees`.
8. Thêm FK `departments.manager_employee_id -> employees.id` nếu cần.
9. Tạo bảng `employee_status_histories`.
10. Tạo bảng `employee_contracts`.
11. Tạo bảng `employee_files`.
12. Tạo bảng `profile_change_requests`.
13. Tạo bảng `profile_change_request_items`.
14. Tạo bảng `employee_code_configs`.
15. Seed job levels mặc định nếu cần.
16. Seed contract types mặc định nếu cần.
17. Seed employee code config mặc định.
18. Seed HR permissions vào `permissions` nếu DB-02 chưa seed đủ.
19. Gán HR permissions vào role mặc định.
20. Tạo index và constraint nâng cao.

### 14.3 Lưu ý vòng FK

`departments.manager_employee_id` tham chiếu `employees.id`, trong khi `employees.department_id` tham chiếu `departments.id`.

Có 2 cách xử lý:

1. Tạo `departments` trước không có FK manager, tạo `employees`, sau đó ALTER TABLE add FK.
2. Giữ `manager_employee_id` không enforced FK ở migration đầu, enforce ở migration sau.

Khuyến nghị: dùng cách 1.

---

## 15. Seed data đề xuất

### 15.1 Job levels mặc định

| level_code | name | rank_order |
| --- | --- | --- |
| INTERN | Intern | 10 |
| FRESHER | Fresher | 20 |
| JUNIOR | Junior | 30 |
| MIDDLE | Middle | 40 |
| SENIOR | Senior | 50 |
| LEAD | Lead | 60 |
| MANAGER | Manager | 70 |
| DIRECTOR | Director | 80 |

### 15.2 Contract types mặc định

| contract_type_code | name | requires_end_date | default_duration_months |
| --- | --- | --- | --- |
| PROBATION | Hợp đồng thử việc | Có | 2 |
| FIXED_TERM | Hợp đồng xác định thời hạn | Có | 12 |
| INDEFINITE | Hợp đồng không xác định thời hạn | Không | NULL |
| PART_TIME | Hợp đồng bán thời gian | Có | 12 |
| INTERNSHIP | Thực tập | Có | 3 |
| SERVICE | Hợp đồng dịch vụ | Có | 12 |

### 15.3 Employee code config mặc định

```json
{
  "config_name": "Default Employee Code",
  "prefix": "EMP",
  "pattern": "{PREFIX}{SEQ}",
  "padding_length": 4,
  "start_number": 1,
  "reset_policy": "Never",
  "include_year": false,
  "include_month": false,
  "department_based": false,
  "allow_manual_override": false,
  "lock_after_created": true,
  "is_active": true
}
```

---

## 16. Test case database cần kiểm tra

| Mã test | Nội dung | Kỳ vọng |
| --- | --- | --- |
| DB03-TC-001 | Tạo department hợp lệ | Thành công |
| DB03-TC-002 | Tạo department trùng `department_code` cùng company | Bị chặn bởi unique index |
| DB03-TC-003 | Tạo department cùng code khác company | Cho phép |
| DB03-TC-004 | Tạo vòng lặp parent department | Bị chặn bởi service |
| DB03-TC-005 | Xóa department đang có employee active | Bị chặn hoặc yêu cầu chuyển employee |
| DB03-TC-006 | Tạo position hợp lệ | Thành công |
| DB03-TC-007 | Tạo position trùng code | Bị chặn |
| DB03-TC-008 | Tạo employee thiếu full_name | Bị chặn |
| DB03-TC-009 | Tạo employee thiếu department_id | Bị chặn |
| DB03-TC-010 | Tạo employee thiếu position_id | Bị chặn |
| DB03-TC-011 | Tạo employee tự sinh mã | Mã đúng pattern |
| DB03-TC-012 | Tạo nhiều employee song song | Không trùng employee_code |
| DB03-TC-013 | Tạo employee với company_email trùng | Bị chặn |
| DB03-TC-014 | Link một user cho hai employee active | Bị chặn bởi unique index |
| DB03-TC-015 | Employee tự xem hồ sơ của mình | Cho phép |
| DB03-TC-016 | Employee xem hồ sơ người khác bằng URL | Bị chặn bởi scope Own |
| DB03-TC-017 | Manager xem employee thuộc team | Cho phép |
| DB03-TC-018 | Manager xem employee ngoài team | Bị chặn |
| DB03-TC-019 | HR xem employee trong company | Cho phép |
| DB03-TC-020 | Company Admin xem employee công ty khác | Bị chặn |
| DB03-TC-021 | User thiếu VIEW_SENSITIVE gọi API chi tiết | Không trả field nhạy cảm |
| DB03-TC-022 | HR có VIEW_SENSITIVE gọi API chi tiết | Trả field nhạy cảm theo scope |
| DB03-TC-023 | Tạo contract end_date < start_date | Bị chặn |
| DB03-TC-024 | Tạo 2 contract primary active cùng employee | Bị chặn |
| DB03-TC-025 | Query hợp đồng sắp hết hạn | Trả đúng danh sách |
| DB03-TC-026 | Employee gửi profile change request hợp lệ | Tạo request + items status Pending |
| DB03-TC-027 | Employee yêu cầu sửa department_id | Bị chặn nếu không cho phép |
| DB03-TC-028 | HR duyệt profile change request | Update employees, status Approved, ghi audit |
| DB03-TC-029 | HR từ chối profile change request thiếu lý do | Bị chặn nếu cấu hình bắt buộc reason |
| DB03-TC-030 | Duyệt request khi dữ liệu gốc đã thay đổi | Cảnh báo hoặc bị chặn |
| DB03-TC-031 | Employee hủy request Pending của mình | Status Cancelled |
| DB03-TC-032 | Employee hủy request của người khác | Bị chặn |
| DB03-TC-033 | HR sửa employee_code khi không có quyền override | Bị chặn |
| DB03-TC-034 | HR sửa employee_code khi đã bị lock | Bị chặn |
| DB03-TC-035 | Admin đổi config mã nhân viên | Config mới lưu, mã cũ không đổi |
| DB03-TC-036 | Export employee thiếu quyền | Bị chặn |
| DB03-TC-037 | Export employee có quyền nhưng thiếu VIEW_SENSITIVE | File không chứa field nhạy cảm |
| DB03-TC-038 | Upload file hồ sơ nhạy cảm | Lưu file và đánh dấu sensitive |
| DB03-TC-039 | User thiếu quyền tải file nhạy cảm | Bị chặn |
| DB03-TC-040 | Đổi status employee sang Resigned | Ghi status history, có thể khóa user theo cấu hình |

---

## 17. Rủi ro và hướng xử lý

| Rủi ro | Mức độ | Hướng xử lý |
| --- | --- | --- |
| Dữ liệu nhân sự quá nhiều trường | Cao | Chia field theo nhóm, chỉ đưa MVP field cần thiết vào bảng chính, phần mở rộng dùng metadata hoặc bảng riêng |
| Lộ dữ liệu nhạy cảm | Cao | Field-level permission, masking, audit log khi xem/tải/export |
| Sinh mã nhân viên bị trùng khi tạo đồng thời | Cao | Dùng transaction + `SELECT FOR UPDATE` trên `sequence_counters` |
| Vòng lặp phòng ban | Trung bình | Validate bằng service hoặc recursive query trước khi lưu |
| Vòng lặp direct manager | Trung bình | Validate manager chain trước khi cập nhật |
| Employee có user nhưng user bị khóa | Trung bình | HR hiển thị trạng thái liên kết user và đồng bộ với AUTH khi nghỉ việc |
| Xóa phòng ban/chức vụ đang được dùng | Trung bình | Chặn xóa hoặc yêu cầu chuyển employee trước |
| Request self-service ghi đè dữ liệu mới | Cao | Lưu old_value và kiểm tra conflict trước khi approve |
| Contract overlap | Trung bình | MVP cảnh báo, phase sau enforce bằng exclusion constraint nếu cần |
| Query dashboard HR nặng | Trung bình | Tạo index theo status/department/date, cache ở DASH nếu cần |
| Multi-tenant rò dữ liệu | Cao | Mọi query bắt buộc filter `company_id`, test kỹ cross-company access |

---

## 18. Quyết định thiết kế đã chốt

1. DB-03 là thiết kế database chi tiết cho module HR.
2. `employees` là bảng trung tâm của HR và là nguồn dữ liệu chính cho ATT, LEAVE, TASK, DASH, NOTI và các module sau MVP.
3. `employees.user_id` là quan hệ liên kết với AUTH, không đặt `employee_id` trong bảng `users`.
4. Một user chỉ liên kết tối đa một employee active trong MVP.
5. Mã nhân viên `employee_code` unique theo `company_id` và mặc định sinh tự động.
6. Cấu hình sinh mã nằm ở `employee_code_configs`, bộ đếm dùng `sequence_counters`.
7. Employee Self-Service không cập nhật trực tiếp `employees`; phải tạo `profile_change_requests` và `profile_change_request_items`.
8. HR/Admin duyệt request mới áp dụng dữ liệu vào `employees`.
9. Các bảng HR quan trọng dùng soft delete.
10. Dữ liệu nhạy cảm phải kiểm soát bằng permission `HR.EMPLOYEE.VIEW_SENSITIVE` và các quyền file/export tương ứng.
11. Thay đổi hồ sơ, hợp đồng, trạng thái, file và cấu hình mã phải ghi audit log.
12. Department hỗ trợ cây nhiều cấp bằng `parent_id`.
13. Manager scope dựa chủ yếu vào `employees.direct_manager_id`.
14. Hợp đồng nhân viên lưu ở `employee_contracts`, có thể có nhiều hợp đồng theo thời gian.
15. File hồ sơ có thể quản lý qua `employee_files` kết hợp `files` dùng chung.

---

## 19. Việc cần làm tiếp theo

Sau DB-03, nên triển khai tiếp:

```text
DB-04: ATT Database Design
```

DB-04 cần dùng dữ liệu từ DB-03, đặc biệt:

1. `employees.id` làm khóa chính cho chấm công.
2. `employees.department_id` để áp dụng ca/rule theo phòng ban.
3. `employees.direct_manager_id` để xác định Manager duyệt điều chỉnh công.
4. `employees.employment_status` để chặn nhân viên đã nghỉ việc chấm công.
5. `employees.company_id` để bảo vệ multi-tenant.

---

## 20. Phụ lục: DDL mẫu rút gọn

> DDL này là bản tham khảo để backend viết migration. Tên constraint/index có thể điều chỉnh theo convention thực tế.

```sql
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    department_code VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES departments(id),
    manager_employee_id UUID NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    sort_order INT,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP NULL,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_departments_status CHECK (status IN ('Active', 'Inactive'))
);

CREATE TABLE job_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    level_code VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    rank_order INT,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP NULL,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_job_levels_status CHECK (status IN ('Active', 'Inactive'))
);

CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    position_code VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    department_id UUID NULL REFERENCES departments(id),
    job_level_id UUID NULL REFERENCES job_levels(id),
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    sort_order INT,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP NULL,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_positions_status CHECK (status IN ('Active', 'Inactive'))
);

CREATE TABLE contract_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    contract_type_code VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    default_duration_months INT,
    requires_end_date BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP NULL,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_contract_types_status CHECK (status IN ('Active', 'Inactive'))
);

CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NULL REFERENCES users(id),
    employee_code VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    gender VARCHAR(50),
    date_of_birth DATE,
    avatar_file_id UUID NULL REFERENCES files(id),
    personal_email VARCHAR(255),
    company_email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    current_address TEXT,
    permanent_address TEXT,
    identity_number VARCHAR(100),
    identity_issue_date DATE,
    identity_issue_place VARCHAR(255),
    tax_code VARCHAR(100),
    bank_account_number VARCHAR(100),
    bank_name VARCHAR(255),
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(50),
    department_id UUID NOT NULL REFERENCES departments(id),
    position_id UUID NOT NULL REFERENCES positions(id),
    job_level_id UUID NULL REFERENCES job_levels(id),
    direct_manager_id UUID NULL REFERENCES employees(id),
    joined_date DATE NOT NULL,
    official_date DATE,
    probation_end_date DATE,
    resigned_date DATE,
    employment_status VARCHAR(50) NOT NULL,
    employee_type VARCHAR(50),
    work_location VARCHAR(255),
    is_employee_code_locked BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP NULL,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_employees_employment_status CHECK (employment_status IN ('Onboarding', 'Probation', 'Official', 'Temporarily Suspended', 'Resigned', 'Terminated')),
    CONSTRAINT chk_employees_gender CHECK (gender IS NULL OR gender IN ('Male', 'Female', 'Other', 'Unspecified')),
    CONSTRAINT chk_employees_type CHECK (employee_type IS NULL OR employee_type IN ('Full-time', 'Part-time', 'Intern', 'Contractor'))
);

ALTER TABLE departments
ADD CONSTRAINT fk_departments_manager_employee
FOREIGN KEY (manager_employee_id) REFERENCES employees(id);

CREATE TABLE employee_status_histories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    employee_id UUID NOT NULL REFERENCES employees(id),
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    effective_date DATE NOT NULL,
    reason TEXT,
    note TEXT,
    changed_by UUID REFERENCES users(id),
    changed_at TIMESTAMP NOT NULL DEFAULT now(),
    metadata JSONB
);

CREATE TABLE employee_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    employee_id UUID NOT NULL REFERENCES employees(id),
    contract_type_id UUID NOT NULL REFERENCES contract_types(id),
    contract_code VARCHAR(100),
    title VARCHAR(255),
    start_date DATE NOT NULL,
    end_date DATE,
    signed_date DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'Draft',
    is_primary BOOLEAN NOT NULL DEFAULT false,
    file_id UUID NULL REFERENCES files(id),
    note TEXT,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP NULL,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_employee_contracts_status CHECK (status IN ('Draft', 'Active', 'Expired', 'Terminated', 'Cancelled')),
    CONSTRAINT chk_employee_contracts_date CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE employee_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    employee_id UUID NOT NULL REFERENCES employees(id),
    file_id UUID NOT NULL REFERENCES files(id),
    file_category VARCHAR(100) NOT NULL,
    title VARCHAR(255),
    description TEXT,
    is_sensitive BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMP NOT NULL DEFAULT now(),
    metadata JSONB,
    deleted_at TIMESTAMP NULL,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_employee_files_category CHECK (file_category IN ('CV', 'IDENTITY', 'CONTRACT', 'CERTIFICATE', 'DECISION', 'OTHER')),
    CONSTRAINT chk_employee_files_status CHECK (status IN ('Active', 'Archived'))
);

CREATE TABLE profile_change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    request_code VARCHAR(100),
    employee_id UUID NOT NULL REFERENCES employees(id),
    submitted_by UUID NOT NULL REFERENCES users(id),
    status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    reason TEXT,
    reviewed_by UUID NULL REFERENCES users(id),
    reviewed_at TIMESTAMP NULL,
    review_note TEXT,
    applied_at TIMESTAMP NULL,
    cancelled_at TIMESTAMP NULL,
    cancelled_by UUID NULL REFERENCES users(id),
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP NULL,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_profile_change_requests_status CHECK (status IN ('Draft', 'Pending', 'Approved', 'Rejected', 'Cancelled'))
);

CREATE TABLE profile_change_request_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    request_id UUID NOT NULL REFERENCES profile_change_requests(id),
    field_name VARCHAR(100) NOT NULL,
    field_label VARCHAR(255),
    old_value JSONB,
    new_value JSONB NOT NULL,
    value_type VARCHAR(50),
    is_sensitive BOOLEAN NOT NULL DEFAULT false,
    validation_status VARCHAR(50),
    validation_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_profile_change_request_items_validation_status CHECK (validation_status IS NULL OR validation_status IN ('Valid', 'Invalid', 'Warning'))
);

CREATE TABLE employee_code_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    config_name VARCHAR(255) NOT NULL,
    prefix VARCHAR(50),
    suffix VARCHAR(50),
    pattern VARCHAR(255) NOT NULL,
    padding_length INT NOT NULL DEFAULT 4,
    start_number BIGINT NOT NULL DEFAULT 1,
    current_number BIGINT NOT NULL DEFAULT 0,
    reset_policy VARCHAR(50) NOT NULL DEFAULT 'Never',
    include_year BOOLEAN NOT NULL DEFAULT false,
    include_month BOOLEAN NOT NULL DEFAULT false,
    department_based BOOLEAN NOT NULL DEFAULT false,
    allow_manual_override BOOLEAN NOT NULL DEFAULT false,
    lock_after_created BOOLEAN NOT NULL DEFAULT true,
    is_active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP NULL,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_employee_code_configs_reset_policy CHECK (reset_policy IN ('Never', 'Yearly', 'Monthly', 'Daily')),
    CONSTRAINT chk_employee_code_configs_padding CHECK (padding_length BETWEEN 1 AND 12)
);

CREATE UNIQUE INDEX uq_departments_company_code_active
ON departments (company_id, department_code)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_positions_company_code_active
ON positions (company_id, position_code)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_job_levels_company_code_active
ON job_levels (company_id, level_code)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_contract_types_company_code_active
ON contract_types (company_id, contract_type_code)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_employees_company_code_active
ON employees (company_id, employee_code)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_employees_user_id_active
ON employees (user_id)
WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_employees_company_email_active
ON employees (company_id, lower(company_email))
WHERE company_email IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_employee_contracts_primary_active
ON employee_contracts (employee_id)
WHERE is_primary = true AND status = 'Active' AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_profile_change_request_items_field
ON profile_change_request_items (request_id, field_name);

CREATE UNIQUE INDEX uq_employee_code_configs_active
ON employee_code_configs (company_id)
WHERE is_active = true AND deleted_at IS NULL;
```
