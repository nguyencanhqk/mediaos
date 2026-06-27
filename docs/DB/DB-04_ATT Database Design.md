> 🔒 **BẤT BIẾN DB (bổ sung bắt buộc):** Mọi bảng có `company_id` PHẢI bật **RLS + FORCE**; `audit_logs` **append-only** (REVOKE UPDATE/DELETE + trigger); audit/event ghi qua **outbox** trong cùng transaction nghiệp vụ. Bộ docs gốc CHƯA mô tả 3 cơ chế này — DDL mẫu + `withTenant`/`set_config` tại [DECISIONS-02 §2–3](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md).

# DB-04: ATT DATABASE DESIGN

> **📚 Bộ tài liệu DB — Hệ thống Quản lý Doanh nghiệp**
> [DB-01 Tổng quan](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [DB-02 AUTH/RBAC](<DB-02 AUTH RBAC Database Design.md>) · [DB-03 HR](<DB-03_HR Database Design.md>) · **DB-04 ATT** · [DB-05 LEAVE](<DB-05 LEAVE Database Design.md>) · [DB-06 TASK](<DB-06 TASK Database Design.md>) · [DB-07 NOTI/DASH](<DB-07 NOTI DASH Database Design.md>) · [DB-08 Audit/Files/Settings](<DB-08 Audit Files Settings Seeds Database Design.md>) · [DB-09 Index/Hiệu năng](<DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 Migration/Seed](<DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>)
>
> **Nguồn & liên quan:** [PRD-00 §9.3](<../PRD/PRD-00 Enterprise Management System .md>) · SPEC tương ứng: [SPEC-04 ATT](<../SPEC/SPEC-04 ATT.md>) · [SPEC-01 Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) · [Thiết kế API: API-04 ATT](<../API Design/API-04_ATT_API_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DB-04 |
| Tên tài liệu | ATT Database Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Module | ATT - Chấm công |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01, DB-02, DB-03 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả thiết kế database chi tiết cho module **ATT - Chấm công** trong hệ thống quản lý doanh nghiệp nội bộ.

Module ATT chịu trách nhiệm lưu trữ, truy vết và xử lý dữ liệu liên quan đến:

1. Check-in / check-out hằng ngày.
2. Trạng thái chấm công hôm nay.
3. Bảng công cá nhân, bảng công team, bảng công toàn công ty.
4. Ca làm việc cố định và ca làm việc linh hoạt.
5. Gán ca theo công ty, phòng ban hoặc từng nhân viên.
6. Rule chấm công theo công ty, phòng ban hoặc từng nhân viên.
7. Tính đi muộn, về sớm, thiếu giờ, đủ công.
8. Chặn chấm công khi có đơn nghỉ phép đã duyệt.
9. Chấm công remote / công tác.
10. Tự động chấm công cho nhóm nhân viên/công việc đặc thù.
11. Yêu cầu điều chỉnh công do Employee gửi.
12. Duyệt/từ chối điều chỉnh công bởi Manager/HR.
13. Điều chỉnh công trực tiếp bởi HR/Admin.
14. Lưu log thô từng lần check-in/check-out.
15. Ghi audit log và cung cấp dữ liệu cho DASH, NOTI, LEAVE, PAYROLL phase sau.

Tài liệu DB-04 là cơ sở để backend triển khai migration, model/entity, repository, attendance service, rule engine, job tự động, API chấm công và test case database cho module ATT.

---

## 3. Phạm vi thiết kế

### 3.1 Bao gồm trong DB-04

DB-04 bao gồm các bảng chính sau:

| Nhóm | Bảng | Vai trò |
| --- | --- | --- |
| Shift | `shifts` | Danh mục ca làm việc |
| Shift | `shift_assignments` | Gán ca theo company/department/employee |
| Rule | `attendance_rules` | Rule chấm công theo phạm vi |
| Attendance | `attendance_records` | Bản ghi công tổng hợp theo ngày/ca |
| Attendance | `attendance_logs` | Log thô từng lần check-in/check-out |
| Adjustment | `attendance_adjustment_requests` | Yêu cầu điều chỉnh công |
| Adjustment | `attendance_adjustment_items` | Chi tiết field cần điều chỉnh |
| Remote work | `remote_work_requests` | Yêu cầu remote/công tác/làm ngoài văn phòng |
| Remote work | `remote_work_request_approvals` | Lịch sử duyệt remote/công tác |

### 3.2 Bảng dùng lại từ module khác

DB-04 không tạo lại các bảng sau, nhưng phụ thuộc trực tiếp vào chúng:

| Bảng | Module | Cách ATT sử dụng |
| --- | --- | --- |
| `companies` | Foundation | Mỗi bản ghi ATT thuộc một company/tenant |
| `users` | AUTH | Actor thực hiện check-in, duyệt, điều chỉnh, tạo request |
| `roles` / `permissions` / `role_permissions` | AUTH | Kiểm soát quyền và data scope |
| `employees` | HR | Nhân viên là chủ thể chấm công |
| `departments` | HR | Gán ca/rule theo phòng ban, lọc bảng công team/department |
| `positions` | HR | Hiển thị thông tin nhân sự, có thể dùng rule mở rộng |
| `leave_requests` / `leave_request_days` | LEAVE | Kiểm tra nghỉ phép Approved để chặn/tính lại công |
| `tasks` / `projects` | TASK | Remote work có thể liên kết task/project ở phase sau |
| `notifications` / `notification_events` | NOTI | Gửi thông báo quên check-out, điều chỉnh công, bất thường |
| `dashboard_widget_cache` | DASH | Dashboard có thể cache summary, không xử lý nghiệp vụ gốc |
| `audit_logs` | Foundation | Ghi log thao tác quan trọng |
| `files` / `file_links` | Foundation | File/ảnh bằng chứng khi điều chỉnh công hoặc remote |
| `public_holidays` | Foundation | Kiểm tra ngày nghỉ lễ/ngày không làm việc |

### 3.3 Không đi sâu trong DB-04 nhưng cần chừa thiết kế

| Nhóm | Giai đoạn | Ghi chú thiết kế |
| --- | --- | --- |
| Payroll | Phase 2 | Payroll dùng `attendance_records`, `leave_request_days`, `employees` để tính lương |
| Device integration | Phase sau | Có thể thêm bảng `attendance_devices`, `device_attendance_logs`, `device_sync_batches` |
| GPS nâng cao | Phase sau | Có thể thêm geofence, anti-spoofing, mobile device fingerprint |
| QR code | Phase sau | Có thể thêm bảng QR session/checkpoint |
| Face recognition | Phase sau | Không lưu ảnh gốc trong ATT; lưu file/private reference nếu cần |
| Overtime | Phase sau | Có thể thêm bảng `overtime_requests`, `overtime_records` |
| Attendance period lock | Phase sau | Có thể thêm bảng `attendance_period_locks` để khóa kỳ công |
| Import Excel/CSV | Phase sau | Có thể thêm bảng `attendance_import_batches`, `attendance_import_rows` |
| AI anomaly detection | Phase 5 | Có thể thêm bảng `attendance_anomaly_flags` |

---

## 4. Nguyên tắc thiết kế ATT

### 4.1 PostgreSQL làm database chính

DB-04 tiếp tục dùng PostgreSQL theo DB-01 vì module ATT cần:

1. Transaction mạnh khi check-in/check-out, duyệt điều chỉnh, tự động chấm công.
2. Unique constraint để chống tạo trùng bản ghi công.
3. Foreign key để bảo vệ quan hệ với employee, user, company, shift.
4. Index tốt cho bảng công theo ngày/tháng/team/công ty.
5. JSONB cho rule linh hoạt và metadata thiết bị/GPS.
6. Có thể mở rộng sang payroll, device integration và mobile sau này.

### 4.2 UUID làm primary key

Tất cả bảng ATT dùng:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
```

### 4.3 Multi-tenant bằng `company_id`

Tất cả bảng ATT bắt buộc có `company_id`.

Nguyên tắc:

1. Mỗi bản ghi công thuộc đúng một công ty.
2. Mọi query ATT phải filter theo `company_id` lấy từ auth context.
3. Không tin `company_id` từ request body của frontend.
4. Super Admin có scope System mới được truy vấn liên công ty.
5. Các unique/index chính luôn ưu tiên `company_id` ở cột đầu.

### 4.4 Employee là chủ thể trung tâm của ATT

ATT không chấm công trực tiếp theo `user_id`, mà chấm công theo `employee_id`.

Lý do:

1. Chấm công là nghiệp vụ nhân sự, gắn với hồ sơ nhân viên.
2. Một user đăng nhập phải liên kết với một employee active/probation mới được chấm công.
3. Manager scope dựa vào `employees.direct_manager_id`.
4. Phòng ban để lọc bảng công lấy từ `employees.department_id` hoặc snapshot trong `attendance_records`.
5. Payroll sau này tính theo employee, không tính theo user.

### 4.5 Tách `attendance_records` và `attendance_logs`

Thiết kế dùng 2 lớp dữ liệu:

| Lớp | Bảng | Vai trò |
| --- | --- | --- |
| Tổng hợp | `attendance_records` | Một dòng chính theo employee + work_date + shift |
| Log thô | `attendance_logs` | Nhiều dòng log check-in/check-out/device/import |

Nguyên tắc:

1. `attendance_records` phục vụ bảng công, dashboard, payroll.
2. `attendance_logs` phục vụ truy vết và tính toán lại.
3. Check-in/check-out tạo hoặc cập nhật `attendance_records`, đồng thời luôn ghi `attendance_logs`.
4. Nếu sau này đồng bộ máy chấm công, log thiết bị được lưu thô trước, sau đó service tổng hợp vào record.

### 4.6 Mỗi ngày/ca chỉ có một bản ghi công chính trong MVP

MVP áp dụng unique logic:

```text
company_id + employee_id + work_date + shift_id
```

Nếu nhân viên chưa có shift, dùng `shift_id IS NULL` và cần unique expression/index riêng.

Quy tắc:

1. Một employee không được có 2 record chính cho cùng ngày/ca.
2. Bấm check-in nhiều lần liên tục không tạo record trùng.
3. Bấm check-out nhiều lần sau khi đã check-out bị chặn hoặc ghi log Invalid tùy cấu hình.

### 4.7 Backend dùng server time làm nguồn thời gian chuẩn

Không lấy giờ check-in/check-out từ client làm nguồn chính.

Cột từ client chỉ lưu để tham khảo:

```text
client_time
client_timezone
client_offset_minutes
```

Cột nghiệp vụ chính dùng server time:

```text
check_in_at
check_out_at
log_time
created_at
```

### 4.8 Snapshot dữ liệu quan trọng vào `attendance_records`

Một số thông tin nên snapshot để bảng công không bị thay đổi ngoài ý muốn khi HR sửa hồ sơ sau này:

1. `department_id` tại thời điểm ghi công.
2. `position_id` nếu cần báo cáo.
3. `shift_id` và `shift_code` nếu cần.
4. `rule_id` và rule snapshot nếu cần.
5. `required_working_minutes` sau khi đã tính nghỉ phép/remote.

Khuyến nghị MVP:

1. Lưu `department_id` trong `attendance_records` để query bảng công team/phòng ban nhanh.
2. Lưu `applied_rule_id`, `applied_shift_id`.
3. Lưu `calculation_snapshot JSONB` để debug cách tính công.

### 4.9 Rule ưu tiên

Khi xác định có được chấm công không, ATT áp dụng thứ tự:

```text
1. Trạng thái nhân viên
2. Ngày nghỉ lễ/ngày không làm việc
3. Đơn nghỉ phép Approved
4. Đơn remote/công tác Approved
5. Rule tự động chấm công
6. Rule riêng của nhân viên
7. Rule của phòng ban
8. Rule của công ty
9. Rule mặc định hệ thống
```

Kết quả rule đã áp dụng cần lưu vào `attendance_records.applied_rule_id` và `attendance_records.calculation_snapshot`.

### 4.10 Soft delete và audit log

Không xóa cứng dữ liệu ATT quan trọng:

```text
shifts
shift_assignments
attendance_rules
attendance_records
attendance_logs
attendance_adjustment_requests
remote_work_requests
```

Các thao tác sau phải ghi `audit_logs`:

1. Tạo/sửa/vô hiệu hóa shift.
2. Gán/sửa/hủy gán ca.
3. Cấu hình rule chấm công.
4. Check-in/check-out nếu công ty yêu cầu log nghiệp vụ đầy đủ.
5. HR/Admin điều chỉnh công trực tiếp.
6. Employee gửi yêu cầu điều chỉnh công.
7. Manager/HR duyệt hoặc từ chối điều chỉnh công.
8. Tạo/duyệt/từ chối remote request.
9. Job tự động tạo công.
10. Export bảng công.

### 4.11 Quyền và data scope

Backend phải kiểm tra permission và data scope trước khi trả dữ liệu.

| Scope | Ý nghĩa trong ATT |
| --- | --- |
| Own | Chỉ bản ghi công/yêu cầu của chính employee hiện tại |
| Team | Nhân viên có `direct_manager_id` là employee hiện tại |
| Department | Nhân viên thuộc phòng ban user được quản lý |
| Company | Toàn bộ dữ liệu ATT trong công ty |
| System | Toàn bộ dữ liệu ATT trong hệ thống |

### 4.12 Dữ liệu GPS/IP/thiết bị là dữ liệu nhạy cảm

Các trường GPS, IP, device, user agent cần được xem là dữ liệu nhạy cảm.

Nguyên tắc:

1. Không trả GPS chi tiết cho user không có quyền xem chi tiết.
2. Có thể mask tọa độ hoặc chỉ trả trạng thái hợp lệ/không hợp lệ.
3. File ảnh bằng chứng phải dùng private storage.
4. Export bảng công có GPS/IP cần permission riêng hoặc cấu hình riêng.

---

## 5. ERD cấp module ATT

### 5.1 ERD dạng text

```text
companies
  1 --- n shifts
  1 --- n shift_assignments
  1 --- n attendance_rules
  1 --- n attendance_records
  1 --- n attendance_logs
  1 --- n attendance_adjustment_requests
  1 --- n remote_work_requests

employees
  1 --- n attendance_records
  1 --- n attendance_logs
  1 --- n attendance_adjustment_requests
  1 --- n remote_work_requests
  1 --- n shift_assignments                  nếu assignment_scope = Employee

users
  1 --- n attendance_logs.created_by
  1 --- n attendance_adjustment_requests.requested_by
  1 --- n attendance_adjustment_requests.reviewed_by
  1 --- n remote_work_requests.requested_by
  1 --- n remote_work_request_approvals.approver_user_id

shifts
  1 --- n shift_assignments
  1 --- n attendance_records

attendance_rules
  1 --- n attendance_records                  qua applied_rule_id

attendance_records
  1 --- n attendance_logs
  1 --- n attendance_adjustment_requests

attendance_adjustment_requests
  1 --- n attendance_adjustment_items

remote_work_requests
  1 --- n remote_work_request_approvals
  0..1 --- n attendance_records               logic: records generated/applied from remote request
```

### 5.2 Quan hệ chính

| Quan hệ | Loại | Ghi chú |
| --- | --- | --- |
| `companies.id` -> `attendance_records.company_id` | 1-n | Multi-tenant |
| `employees.id` -> `attendance_records.employee_id` | 1-n | Employee có nhiều bản ghi công |
| `departments.id` -> `attendance_records.department_id` | 1-n | Snapshot/filter theo phòng ban |
| `shifts.id` -> `attendance_records.shift_id` | 1-n | Bản ghi công theo ca |
| `attendance_rules.id` -> `attendance_records.applied_rule_id` | 1-n | Rule đã áp dụng |
| `attendance_records.id` -> `attendance_logs.attendance_record_id` | 1-n | Một record có nhiều log thô |
| `employees.id` -> `attendance_logs.employee_id` | 1-n | Log gắn với employee |
| `attendance_records.id` -> `attendance_adjustment_requests.attendance_record_id` | 1-n | Yêu cầu điều chỉnh cho một ngày công |
| `attendance_adjustment_requests.id` -> `attendance_adjustment_items.request_id` | 1-n | Chi tiết field điều chỉnh |
| `remote_work_requests.id` -> `remote_work_request_approvals.remote_work_request_id` | 1-n | Lịch sử duyệt remote |

---

## 6. Danh sách bảng DB-04

| STT | Bảng | Bắt buộc MVP | Mô tả |
| --- | --- | --- | --- |
| 1 | `shifts` | Có | Danh mục ca làm việc |
| 2 | `shift_assignments` | Có | Gán ca theo company/department/employee |
| 3 | `attendance_rules` | Có | Rule chấm công |
| 4 | `attendance_records` | Có | Bản ghi công tổng hợp |
| 5 | `attendance_logs` | Có | Log thô check-in/check-out |
| 6 | `attendance_adjustment_requests` | Có | Yêu cầu điều chỉnh công |
| 7 | `attendance_adjustment_items` | Có | Chi tiết điều chỉnh công |
| 8 | `remote_work_requests` | Nên có | Yêu cầu remote/công tác |
| 9 | `remote_work_request_approvals` | Nên có | Lịch sử duyệt remote/công tác |

---

## 7. Thiết kế chi tiết bảng

### 7.1 Bảng `shifts`

#### Mục đích

Lưu danh mục ca làm việc của công ty, bao gồm ca cố định và ca linh hoạt.

Ví dụ:

```text
Ca hành chính: 08:00 - 17:30
Ca sáng: 08:00 - 12:00
Ca chiều: 13:30 - 17:30
Ca linh hoạt: check-in từ 07:00 - 10:00, làm đủ 8 giờ
```

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `shift_code` | VARCHAR(100) | Có | Mã ca, unique theo company |
| `name` | VARCHAR(255) | Có | Tên ca |
| `description` | TEXT | Không | Mô tả |
| `shift_type` | VARCHAR(50) | Có | Fixed/Flexible/Split/Night |
| `start_time` | TIME | Không | Giờ bắt đầu ca cố định |
| `end_time` | TIME | Không | Giờ kết thúc ca cố định |
| `break_start_time` | TIME | Không | Giờ bắt đầu nghỉ giữa ca |
| `break_end_time` | TIME | Không | Giờ kết thúc nghỉ giữa ca |
| `break_minutes` | INT | Có | Tổng phút nghỉ |
| `required_working_minutes` | INT | Có | Số phút làm việc yêu cầu |
| `flexible_check_in_from` | TIME | Không | Giờ bắt đầu được check-in cho ca linh hoạt |
| `flexible_check_in_to` | TIME | Không | Giờ cuối được check-in cho ca linh hoạt |
| `grace_late_minutes` | INT | Có | Số phút cho phép đi muộn |
| `grace_early_leave_minutes` | INT | Có | Số phút cho phép về sớm |
| `allow_early_check_in` | BOOLEAN | Có | Có cho check-in sớm không |
| `allow_late_check_out` | BOOLEAN | Có | Có cho check-out muộn không |
| `cross_day` | BOOLEAN | Có | Ca qua ngày, ví dụ 22:00 -> 06:00 |
| `work_days` | JSONB | Không | Danh sách thứ áp dụng nếu cần |
| `status` | VARCHAR(50) | Có | Active/Inactive |
| `is_default` | BOOLEAN | Có | Ca mặc định công ty |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE shifts
ADD CONSTRAINT chk_shifts_type
CHECK (shift_type IN ('Fixed', 'Flexible', 'Split', 'Night'));

ALTER TABLE shifts
ADD CONSTRAINT chk_shifts_status
CHECK (status IN ('Active', 'Inactive'));

ALTER TABLE shifts
ADD CONSTRAINT chk_shifts_minutes
CHECK (required_working_minutes > 0 AND break_minutes >= 0);

CREATE UNIQUE INDEX uq_shifts_company_code_active
ON shifts (company_id, shift_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_shifts_company_status
ON shifts (company_id, status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_shifts_company_default
ON shifts (company_id, is_default)
WHERE deleted_at IS NULL AND status = 'Active';
```

#### Quy tắc nghiệp vụ

1. `shift_code` không được trùng trong cùng company.
2. Ca `Fixed` nên có `start_time` và `end_time`.
3. Ca `Flexible` phải có `required_working_minutes`; có thể có hoặc không có khung check-in.
4. Nếu `cross_day = false`, `end_time` nên lớn hơn `start_time`.
5. Nếu `cross_day = true`, service phải hiểu ngày công bắt đầu từ `work_date` nhưng checkout có thể sang ngày kế tiếp.
6. Không xóa mềm ca đã có `attendance_records`; chỉ chuyển `status = Inactive`.

---

### 7.2 Bảng `shift_assignments`

#### Mục đích

Lưu việc gán ca cho một phạm vi cụ thể: công ty, phòng ban hoặc nhân viên.

Thứ tự ưu tiên nghiệp vụ:

```text
Employee -> Department -> Company -> Default
```

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `shift_id` | UUID | Có | FK `shifts.id` |
| `assignment_scope` | VARCHAR(50) | Có | Company/Department/Employee |
| `department_id` | UUID | Không | FK `departments.id`, khi scope Department |
| `employee_id` | UUID | Không | FK `employees.id`, khi scope Employee |
| `effective_from` | DATE | Có | Ngày bắt đầu hiệu lực |
| `effective_to` | DATE | Không | Ngày kết thúc hiệu lực |
| `priority` | INT | Có | Độ ưu tiên khi có nhiều assignment |
| `status` | VARCHAR(50) | Có | Active/Inactive |
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
ALTER TABLE shift_assignments
ADD CONSTRAINT chk_shift_assignments_scope
CHECK (assignment_scope IN ('Company', 'Department', 'Employee'));

ALTER TABLE shift_assignments
ADD CONSTRAINT chk_shift_assignments_status
CHECK (status IN ('Active', 'Inactive'));

ALTER TABLE shift_assignments
ADD CONSTRAINT chk_shift_assignments_date
CHECK (effective_to IS NULL OR effective_to >= effective_from);

ALTER TABLE shift_assignments
ADD CONSTRAINT chk_shift_assignments_target
CHECK (
  (assignment_scope = 'Company' AND department_id IS NULL AND employee_id IS NULL)
  OR (assignment_scope = 'Department' AND department_id IS NOT NULL AND employee_id IS NULL)
  OR (assignment_scope = 'Employee' AND employee_id IS NOT NULL)
);

CREATE INDEX idx_shift_assignments_company_scope
ON shift_assignments (company_id, assignment_scope, status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_shift_assignments_department_date
ON shift_assignments (company_id, department_id, effective_from, effective_to)
WHERE deleted_at IS NULL;

CREATE INDEX idx_shift_assignments_employee_date
ON shift_assignments (company_id, employee_id, effective_from, effective_to)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Khi tìm ca cho employee trong ngày, service kiểm tra assignment theo thứ tự Employee -> Department -> Company.
2. Nếu nhiều assignment cùng scope trùng hiệu lực, chọn `priority` cao hơn hoặc báo lỗi cấu hình.
3. Nên cảnh báo khi tạo assignment bị overlap trong cùng scope/target/date range.
4. `department_id` và `employee_id` phải thuộc cùng company.
5. Khi employee đổi phòng ban, assignment theo Department tự áp dụng từ ngày thay đổi nếu HR cập nhật đúng effective date.

---

### 7.3 Bảng `attendance_rules`

#### Mục đích

Lưu rule chấm công theo công ty, phòng ban hoặc nhân viên.

Rule có thể điều khiển:

1. Có bắt buộc check-in/check-out không.
2. Grace time đi muộn/về sớm.
3. Có yêu cầu GPS/ghi chú/ảnh xác nhận không.
4. Có cho remote check-in không.
5. Có cho tự động chấm công không.
6. Có cho Employee gửi điều chỉnh công không.
7. Có cho chấm công ngày nghỉ/lễ không.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `rule_code` | VARCHAR(100) | Có | Mã rule |
| `name` | VARCHAR(255) | Có | Tên rule |
| `description` | TEXT | Không | Mô tả |
| `rule_scope` | VARCHAR(50) | Có | System/Company/Department/Employee |
| `department_id` | UUID | Không | FK `departments.id`, khi scope Department |
| `employee_id` | UUID | Không | FK `employees.id`, khi scope Employee |
| `priority` | INT | Có | Độ ưu tiên |
| `effective_from` | DATE | Có | Ngày bắt đầu hiệu lực |
| `effective_to` | DATE | Không | Ngày kết thúc hiệu lực |
| `require_check_in` | BOOLEAN | Có | Có bắt buộc check-in không |
| `require_check_out` | BOOLEAN | Có | Có bắt buộc check-out không |
| `allow_web_check_in` | BOOLEAN | Có | Cho check-in web |
| `allow_mobile_check_in` | BOOLEAN | Có | Cho check-in mobile |
| `allow_remote_check_in` | BOOLEAN | Có | Cho check-in remote |
| `allow_adjustment_request` | BOOLEAN | Có | Cho Employee gửi điều chỉnh công |
| `require_gps` | BOOLEAN | Có | Có yêu cầu GPS không |
| `require_note` | BOOLEAN | Có | Có yêu cầu ghi chú không |
| `require_photo` | BOOLEAN | Có | Có yêu cầu ảnh không |
| `allow_holiday_attendance` | BOOLEAN | Có | Cho chấm công ngày lễ |
| `allow_weekend_attendance` | BOOLEAN | Có | Cho chấm công cuối tuần |
| `auto_attendance_enabled` | BOOLEAN | Có | Bật tự động chấm công |
| `auto_check_out_enabled` | BOOLEAN | Có | Bật auto checkout |
| `auto_attendance_working_minutes` | INT | Không | Số phút ghi nhận khi auto |
| `rule_config` | JSONB | Không | Cấu hình linh hoạt |
| `status` | VARCHAR(50) | Có | Active/Inactive |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Gợi ý `rule_config JSONB`

```json
{
  "late_grace_minutes_override": 5,
  "early_leave_grace_minutes_override": 5,
  "min_working_minutes_for_present": 480,
  "remote": {
    "mode": "SELF_CHECK_IN",
    "default_working_minutes": 480,
    "require_task_note": false
  },
  "gps": {
    "allowed_radius_meters": 200,
    "office_locations": [
      {"name": "Head Office", "lat": 10.0, "lng": 106.0}
    ]
  },
  "auto_checkout": {
    "time": "18:30",
    "mark_missing_if_no_checkout": true
  }
}
```

#### Constraint/index đề xuất

```sql
ALTER TABLE attendance_rules
ADD CONSTRAINT chk_attendance_rules_scope
CHECK (rule_scope IN ('System', 'Company', 'Department', 'Employee'));

ALTER TABLE attendance_rules
ADD CONSTRAINT chk_attendance_rules_status
CHECK (status IN ('Active', 'Inactive'));

ALTER TABLE attendance_rules
ADD CONSTRAINT chk_attendance_rules_date
CHECK (effective_to IS NULL OR effective_to >= effective_from);

ALTER TABLE attendance_rules
ADD CONSTRAINT chk_attendance_rules_target
CHECK (
  (rule_scope IN ('System', 'Company') AND department_id IS NULL AND employee_id IS NULL)
  OR (rule_scope = 'Department' AND department_id IS NOT NULL AND employee_id IS NULL)
  OR (rule_scope = 'Employee' AND employee_id IS NOT NULL)
);

CREATE UNIQUE INDEX uq_attendance_rules_company_code_active
ON attendance_rules (company_id, rule_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_rules_company_scope
ON attendance_rules (company_id, rule_scope, status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_rules_department_date
ON attendance_rules (company_id, department_id, effective_from, effective_to)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_rules_employee_date
ON attendance_rules (company_id, employee_id, effective_from, effective_to)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Rule Employee ưu tiên hơn Department.
2. Rule Department ưu tiên hơn Company.
3. Rule Company ưu tiên hơn System/default.
4. Rule hiệu lực theo `effective_from` và `effective_to`.
5. Khi update rule, không nên làm thay đổi kết quả bảng công quá khứ nếu không chạy job recalculation có kiểm soát.
6. Khi record được tính, lưu `applied_rule_id` và `calculation_snapshot` để truy vết.

---

### 7.4 Bảng `attendance_records`

#### Mục đích

Lưu bản ghi công tổng hợp theo employee + ngày làm việc + ca.

Đây là bảng lõi của DB-04, phục vụ:

1. Bảng công cá nhân.
2. Bảng công team.
3. Bảng công toàn công ty.
4. Dashboard chấm công.
5. Bất thường chấm công.
6. Payroll phase sau.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `employee_id` | UUID | Có | FK `employees.id` |
| `department_id` | UUID | Không | Snapshot FK `departments.id` |
| `position_id` | UUID | Không | Snapshot FK `positions.id` |
| `work_date` | DATE | Có | Ngày công |
| `shift_id` | UUID | Không | FK `shifts.id` |
| `applied_rule_id` | UUID | Không | FK `attendance_rules.id` |
| `check_in_at` | TIMESTAMP | Không | Giờ check-in chính theo server |
| `check_out_at` | TIMESTAMP | Không | Giờ check-out chính theo server |
| `first_log_id` | UUID | Không | Log đầu tiên liên quan |
| `last_log_id` | UUID | Không | Log cuối cùng liên quan |
| `required_working_minutes` | INT | Có | Số phút yêu cầu sau khi trừ leave/remote |
| `working_minutes` | INT | Có | Số phút làm thực tế |
| `break_minutes` | INT | Có | Phút nghỉ |
| `late_minutes` | INT | Có | Số phút đi muộn |
| `early_leave_minutes` | INT | Có | Số phút về sớm |
| `missing_minutes` | INT | Có | Số phút thiếu |
| `overtime_minutes` | INT | Có | Chuẩn bị phase sau |
| `attendance_status` | VARCHAR(50) | Có | Present/Late/Absent/Leave... |
| `check_in_status` | VARCHAR(50) | Không | On Time/Late/Missing... |
| `check_out_status` | VARCHAR(50) | Không | Normal/Early/Missing... |
| `attendance_source` | VARCHAR(50) | Có | WEB/MOBILE/MANUAL/AUTO/REMOTE/DEVICE/IMPORT/API |
| `work_mode` | VARCHAR(50) | Có | Office/Remote/BusinessTrip/Auto/Leave |
| `is_late` | BOOLEAN | Có | Đi muộn |
| `is_early_leave` | BOOLEAN | Có | Về sớm |
| `is_missing_check_in` | BOOLEAN | Có | Thiếu check-in |
| `is_missing_check_out` | BOOLEAN | Có | Thiếu check-out |
| `is_adjusted` | BOOLEAN | Có | Đã được điều chỉnh |
| `is_auto` | BOOLEAN | Có | Tự động chấm công |
| `leave_request_id` | UUID | Không | FK logic tới leave request nếu có |
| `remote_work_request_id` | UUID | Không | FK `remote_work_requests.id` nếu có |
| `locked_at` | TIMESTAMP | Không | Khóa record/kỳ công nếu có |
| `locked_by` | UUID | Không | FK `users.id` |
| `note` | TEXT | Không | Ghi chú |
| `calculation_snapshot` | JSONB | Không | Snapshot rule/shift/leave dùng để tính |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` hoặc null nếu system |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Giá trị `attendance_status` đề xuất

| Mã | Ý nghĩa |
| --- | --- |
| `Not Checked-in` | Chưa chấm công |
| `Checked-in` | Đã check-in, chưa check-out |
| `Checked-out` | Đã check-out |
| `Present` | Có mặt hợp lệ |
| `Late` | Đi muộn |
| `Early Leave` | Về sớm |
| `Missing Hours` | Thiếu giờ |
| `Missing Check-in` | Thiếu check-in |
| `Missing Check-out` | Thiếu check-out |
| `Absent` | Vắng mặt |
| `Leave` | Nghỉ phép Approved |
| `Remote Work` | Remote/công tác |
| `Auto Attendance` | Tự động chấm công |
| `Adjusted` | Đã điều chỉnh |
| `Pending Adjustment` | Có yêu cầu điều chỉnh pending |
| `Invalid` | Không hợp lệ |

#### Constraint/index đề xuất

```sql
ALTER TABLE attendance_records
ADD CONSTRAINT chk_attendance_records_status
CHECK (attendance_status IN (
  'Not Checked-in', 'Checked-in', 'Checked-out', 'Present', 'Late',
  'Early Leave', 'Missing Hours', 'Missing Check-in', 'Missing Check-out',
  'Absent', 'Leave', 'Remote Work', 'Auto Attendance', 'Adjusted',
  'Pending Adjustment', 'Invalid'
));

ALTER TABLE attendance_records
ADD CONSTRAINT chk_attendance_records_source
CHECK (attendance_source IN ('WEB', 'MOBILE', 'MANUAL', 'AUTO', 'REMOTE', 'DEVICE', 'IMPORT', 'API'));

ALTER TABLE attendance_records
ADD CONSTRAINT chk_attendance_records_work_mode
CHECK (work_mode IN ('Office', 'Remote', 'BusinessTrip', 'Auto', 'Leave'));

ALTER TABLE attendance_records
ADD CONSTRAINT chk_attendance_records_minutes
CHECK (
  required_working_minutes >= 0
  AND working_minutes >= 0
  AND break_minutes >= 0
  AND late_minutes >= 0
  AND early_leave_minutes >= 0
  AND missing_minutes >= 0
  AND overtime_minutes >= 0
);

ALTER TABLE attendance_records
ADD CONSTRAINT chk_attendance_records_time_order
CHECK (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at);

CREATE UNIQUE INDEX uq_attendance_records_employee_date_shift
ON attendance_records (company_id, employee_id, work_date, shift_id)
WHERE deleted_at IS NULL AND shift_id IS NOT NULL;

CREATE UNIQUE INDEX uq_attendance_records_employee_date_no_shift
ON attendance_records (company_id, employee_id, work_date)
WHERE deleted_at IS NULL AND shift_id IS NULL;

CREATE INDEX idx_attendance_records_employee_date
ON attendance_records (company_id, employee_id, work_date DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_records_company_date_status
ON attendance_records (company_id, work_date, attendance_status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_records_department_date
ON attendance_records (company_id, department_id, work_date)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_records_remote_request
ON attendance_records (remote_work_request_id)
WHERE remote_work_request_id IS NOT NULL;
```

#### Quy tắc nghiệp vụ

1. Check-in tạo record nếu chưa tồn tại.
2. Check-out cập nhật record đã check-in.
3. Nếu đã có đơn nghỉ cả ngày Approved, tạo/cập nhật record trạng thái `Leave` và chặn check-in/out thủ công.
4. Nếu nghỉ nửa ngày/theo giờ, giảm `required_working_minutes` và tính lại late/early/missing.
5. Nếu remote Approved và mode auto, tạo record source `REMOTE` hoặc `AUTO` tùy rule.
6. Nếu HR/Admin điều chỉnh trực tiếp, set `is_adjusted = true`, source có thể là `MANUAL` hoặc giữ source gốc kèm metadata.
7. Nếu record đã khóa, không cho điều chỉnh trừ user có quyền đặc biệt.

---

### 7.5 Bảng `attendance_logs`

#### Mục đích

Lưu log thô từng lần check-in/check-out hoặc log từ nguồn khác.

Một `attendance_record` có thể có nhiều `attendance_logs`.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `attendance_record_id` | UUID | Không | FK `attendance_records.id` |
| `employee_id` | UUID | Có | FK `employees.id` |
| `user_id` | UUID | Không | FK `users.id`, người bấm nếu có |
| `work_date` | DATE | Có | Ngày công |
| `log_type` | VARCHAR(50) | Có | Check-in/Check-out/Auto/Manual/Adjustment/Device/Import |
| `log_time` | TIMESTAMP | Có | Giờ server ghi nhận |
| `client_time` | TIMESTAMP | Không | Giờ từ client nếu có |
| `client_timezone` | VARCHAR(100) | Không | Timezone client |
| `source` | VARCHAR(50) | Có | WEB/MOBILE/MANUAL/AUTO/REMOTE/DEVICE/IMPORT/API |
| `platform` | VARCHAR(50) | Không | WEB/MOBILE/API |
| `device_id` | VARCHAR(255) | Không | ID thiết bị nếu có |
| `device_name` | VARCHAR(255) | Không | Tên thiết bị |
| `ip_address` | VARCHAR(45) | Không | IP |
| `user_agent` | TEXT | Không | User agent |
| `gps_latitude` | NUMERIC(10,7) | Không | Vĩ độ |
| `gps_longitude` | NUMERIC(10,7) | Không | Kinh độ |
| `gps_accuracy_meters` | NUMERIC(10,2) | Không | Sai số GPS |
| `location_label` | VARCHAR(255) | Không | Văn phòng/địa điểm nếu resolve được |
| `is_valid` | BOOLEAN | Có | Log hợp lệ không |
| `invalid_reason` | VARCHAR(255) | Không | Lý do invalid |
| `note` | TEXT | Không | Ghi chú người dùng |
| `photo_file_id` | UUID | Không | FK `files.id`, ảnh xác nhận nếu có |
| `raw_payload` | JSONB | Không | Payload gốc từ client/device |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE attendance_logs
ADD CONSTRAINT chk_attendance_logs_type
CHECK (log_type IN ('Check-in', 'Check-out', 'Auto', 'Manual', 'Adjustment', 'Device', 'Import'));

ALTER TABLE attendance_logs
ADD CONSTRAINT chk_attendance_logs_source
CHECK (source IN ('WEB', 'MOBILE', 'MANUAL', 'AUTO', 'REMOTE', 'DEVICE', 'IMPORT', 'API'));

CREATE INDEX idx_attendance_logs_record_time
ON attendance_logs (attendance_record_id, log_time)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_logs_employee_time
ON attendance_logs (company_id, employee_id, log_time DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_logs_company_work_date
ON attendance_logs (company_id, work_date, source)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_logs_invalid
ON attendance_logs (company_id, is_valid, log_time DESC)
WHERE deleted_at IS NULL AND is_valid = false;
```

#### Quy tắc nghiệp vụ

1. Mọi check-in/check-out hợp lệ đều phải ghi log.
2. Log không hợp lệ vẫn có thể lưu với `is_valid = false` để phục vụ điều tra.
3. GPS/IP/device không nên dùng làm điều kiện duy nhất để chấm công nếu rule không yêu cầu.
4. Nếu có ảnh xác nhận, file phải private.
5. Khi HR/Admin điều chỉnh công, nên ghi log `Manual` hoặc ghi vào adjustment/audit tùy thiết kế service.

---

### 7.6 Bảng `attendance_adjustment_requests`

#### Mục đích

Lưu yêu cầu điều chỉnh công do Employee gửi, hoặc request do Manager/HR tạo thay nếu có quyền.

Các trường hợp:

1. Quên check-in.
2. Quên check-out.
3. Sửa giờ check-in.
4. Sửa giờ check-out.
5. Giải trình đi muộn.
6. Giải trình về sớm.
7. Sửa trạng thái công.
8. Làm remote nhưng chưa được ghi nhận đúng.
9. Dữ liệu chấm công bị thiếu/sai.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `request_code` | VARCHAR(100) | Không | Mã yêu cầu, có thể sinh tự động |
| `attendance_record_id` | UUID | Không | FK `attendance_records.id` |
| `employee_id` | UUID | Có | FK `employees.id` |
| `work_date` | DATE | Có | Ngày cần điều chỉnh |
| `request_type` | VARCHAR(100) | Có | MISSING_CHECK_IN/MISSING_CHECK_OUT/... |
| `reason` | TEXT | Có | Lý do yêu cầu |
| `status` | VARCHAR(50) | Có | Draft/Pending/Approved/Rejected/Cancelled |
| `submitted_at` | TIMESTAMP | Không | Thời điểm gửi duyệt |
| `requested_by` | UUID | Có | FK `users.id` |
| `current_approver_user_id` | UUID | Không | User cần duyệt hiện tại |
| `current_approver_employee_id` | UUID | Không | Employee approver nếu có |
| `reviewed_by` | UUID | Không | FK `users.id` |
| `reviewed_at` | TIMESTAMP | Không | Thời điểm xử lý |
| `review_note` | TEXT | Không | Ghi chú duyệt/từ chối |
| `attachment_file_id` | UUID | Không | FK `files.id` nếu có file bằng chứng |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE attendance_adjustment_requests
ADD CONSTRAINT chk_att_adj_requests_type
CHECK (request_type IN (
  'MISSING_CHECK_IN', 'MISSING_CHECK_OUT', 'UPDATE_CHECK_IN', 'UPDATE_CHECK_OUT',
  'EXPLAIN_LATE', 'EXPLAIN_EARLY_LEAVE', 'UPDATE_STATUS', 'REMOTE_CORRECTION', 'OTHER'
));

ALTER TABLE attendance_adjustment_requests
ADD CONSTRAINT chk_att_adj_requests_status
CHECK (status IN ('Draft', 'Pending', 'Approved', 'Rejected', 'Cancelled'));

CREATE UNIQUE INDEX uq_att_adj_pending_employee_date_type
ON attendance_adjustment_requests (company_id, employee_id, work_date, request_type)
WHERE deleted_at IS NULL AND status = 'Pending';

CREATE INDEX idx_att_adj_employee_status
ON attendance_adjustment_requests (company_id, employee_id, status, work_date DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_att_adj_status_submitted
ON attendance_adjustment_requests (company_id, status, submitted_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_att_adj_current_approver
ON attendance_adjustment_requests (company_id, current_approver_user_id, status)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Một ngày công không nên có nhiều request Pending cùng loại.
2. Employee chỉ được tạo request cho chính mình trừ khi có quyền tạo thay.
3. Manager chỉ được duyệt request thuộc team/scope.
4. HR/Admin duyệt theo quyền Company.
5. Request đã Approved/Rejected/Cancelled không được sửa nội dung.
6. Khi Approved, service cập nhật `attendance_records`, ghi `attendance_adjustment_items`, ghi audit log và gửi notification.
7. Khi Rejected, bắt buộc có `review_note`.
8. Nếu record/kỳ công đã khóa, không cho tạo hoặc duyệt request trừ quyền đặc biệt.

---

### 7.7 Bảng `attendance_adjustment_items`

#### Mục đích

Lưu chi tiết các field được đề xuất thay đổi trong một yêu cầu điều chỉnh công.

Ví dụ:

```text
field_name = check_in_at
old_value = 2026-06-20T08:45:00
new_value = 2026-06-20T08:05:00
```

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `request_id` | UUID | Có | FK `attendance_adjustment_requests.id` |
| `field_name` | VARCHAR(100) | Có | Tên field cần đổi |
| `old_value` | JSONB | Không | Giá trị cũ |
| `new_value` | JSONB | Có | Giá trị mới đề xuất |
| `applied_value` | JSONB | Không | Giá trị thực tế đã apply nếu khác |
| `is_applied` | BOOLEAN | Có | Đã apply chưa |
| `note` | TEXT | Không | Ghi chú |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
CREATE INDEX idx_att_adj_items_request
ON attendance_adjustment_items (request_id);

CREATE INDEX idx_att_adj_items_field
ON attendance_adjustment_items (company_id, field_name);
```

#### Field được phép điều chỉnh trong MVP

| Field | Ghi chú |
| --- | --- |
| `check_in_at` | Sửa/bổ sung giờ vào |
| `check_out_at` | Sửa/bổ sung giờ ra |
| `attendance_status` | Sửa trạng thái công |
| `working_minutes` | Sửa tổng phút làm việc nếu HR/Admin cho phép |
| `note` | Bổ sung ghi chú |
| `work_mode` | Office/Remote/BusinessTrip nếu cần |

#### Quy tắc nghiệp vụ

1. Không cho sửa field ngoài whitelist.
2. Không cho Employee tự đề xuất field nhạy cảm nếu rule không cho phép.
3. Khi request Approved, service apply item theo thứ tự an toàn.
4. Sau khi apply, service tính lại late/early/missing/status.

---

### 7.8 Bảng `remote_work_requests`

#### Mục đích

Lưu yêu cầu làm remote/công tác/làm việc ngoài văn phòng.

Trong MVP, nhóm request này đặt trong ATT vì đây là trạng thái đi làm, ảnh hưởng trực tiếp đến rule chấm công, không phải nghỉ phép.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `request_code` | VARCHAR(100) | Không | Mã request |
| `employee_id` | UUID | Có | FK `employees.id` |
| `request_type` | VARCHAR(50) | Có | Remote/BusinessTrip/Offsite |
| `start_date` | DATE | Có | Ngày bắt đầu |
| `end_date` | DATE | Có | Ngày kết thúc |
| `start_time` | TIME | Không | Nếu remote theo giờ |
| `end_time` | TIME | Không | Nếu remote theo giờ |
| `attendance_mode` | VARCHAR(50) | Có | SELF_CHECK_IN/AUTO_ATTENDANCE/NO_ATTENDANCE |
| `location_text` | VARCHAR(255) | Không | Địa điểm làm việc/công tác |
| `reason` | TEXT | Có | Lý do |
| `task_id` | UUID | Không | FK logic tới TASK nếu phase sau |
| `project_id` | UUID | Không | FK logic tới PROJECT nếu phase sau |
| `status` | VARCHAR(50) | Có | Draft/Pending/Approved/Rejected/Cancelled |
| `submitted_at` | TIMESTAMP | Không | Thời điểm gửi |
| `requested_by` | UUID | Có | FK `users.id` |
| `current_approver_user_id` | UUID | Không | User đang cần duyệt |
| `current_approver_employee_id` | UUID | Không | Employee approver |
| `approved_by` | UUID | Không | FK `users.id` |
| `approved_at` | TIMESTAMP | Không | Thời điểm duyệt |
| `rejected_by` | UUID | Không | FK `users.id` |
| `rejected_at` | TIMESTAMP | Không | Thời điểm từ chối |
| `reject_reason` | TEXT | Không | Lý do từ chối |
| `cancelled_at` | TIMESTAMP | Không | Thời điểm hủy |
| `cancelled_by` | UUID | Không | FK `users.id` |
| `attachment_file_id` | UUID | Không | File bằng chứng nếu có |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE remote_work_requests
ADD CONSTRAINT chk_remote_requests_type
CHECK (request_type IN ('Remote', 'BusinessTrip', 'Offsite'));

ALTER TABLE remote_work_requests
ADD CONSTRAINT chk_remote_requests_mode
CHECK (attendance_mode IN ('SELF_CHECK_IN', 'AUTO_ATTENDANCE', 'NO_ATTENDANCE'));

ALTER TABLE remote_work_requests
ADD CONSTRAINT chk_remote_requests_status
CHECK (status IN ('Draft', 'Pending', 'Approved', 'Rejected', 'Cancelled'));

ALTER TABLE remote_work_requests
ADD CONSTRAINT chk_remote_requests_date
CHECK (end_date >= start_date);

CREATE INDEX idx_remote_requests_employee_date
ON remote_work_requests (company_id, employee_id, start_date, end_date)
WHERE deleted_at IS NULL;

CREATE INDEX idx_remote_requests_status_submitted
ON remote_work_requests (company_id, status, submitted_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_remote_requests_approver
ON remote_work_requests (company_id, current_approver_user_id, status)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Remote request Approved ảnh hưởng rule chấm công trong khoảng ngày.
2. Nếu `attendance_mode = SELF_CHECK_IN`, employee vẫn phải check-in/check-out nhưng dùng rule remote.
3. Nếu `attendance_mode = AUTO_ATTENDANCE`, job tự động tạo attendance record.
4. Nếu `attendance_mode = NO_ATTENDANCE`, không tạo record tự động, chỉ đánh dấu thông tin làm việc ngoài văn phòng nếu cần.
5. Nếu có leave Approved cùng ngày, leave ưu tiên cao hơn remote.
6. Manager duyệt theo team scope; HR/Admin duyệt theo company scope nếu có quyền.

---

### 7.9 Bảng `remote_work_request_approvals`

#### Mục đích

Lưu lịch sử xử lý remote/công tác.

Bảng này giúp mở rộng nhiều cấp duyệt sau này.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `remote_work_request_id` | UUID | Có | FK `remote_work_requests.id` |
| `step_order` | INT | Có | Thứ tự bước duyệt |
| `approver_user_id` | UUID | Không | FK `users.id` |
| `approver_employee_id` | UUID | Không | FK `employees.id` |
| `action` | VARCHAR(50) | Có | Submitted/Approved/Rejected/Cancelled |
| `note` | TEXT | Không | Ghi chú |
| `acted_at` | TIMESTAMP | Có | Thời điểm xử lý |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |

#### Constraint/index đề xuất

```sql
ALTER TABLE remote_work_request_approvals
ADD CONSTRAINT chk_remote_approvals_action
CHECK (action IN ('Submitted', 'Approved', 'Rejected', 'Cancelled'));

CREATE INDEX idx_remote_approvals_request
ON remote_work_request_approvals (remote_work_request_id, step_order, acted_at);

CREATE INDEX idx_remote_approvals_approver
ON remote_work_request_approvals (company_id, approver_user_id, acted_at DESC);
```

---

## 8. SQL DDL đề xuất cho MVP

> DDL dưới đây là bản khung ban đầu. Khi triển khai thực tế nên tách thành nhiều migration nhỏ theo thứ tự: `shifts` -> `shift_assignments` -> `attendance_rules` -> `attendance_records` -> `attendance_logs` -> `attendance_adjustment_requests` -> `attendance_adjustment_items` -> `remote_work_requests` -> `remote_work_request_approvals`.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    shift_code VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    shift_type VARCHAR(50) NOT NULL DEFAULT 'Fixed',
    start_time TIME,
    end_time TIME,
    break_start_time TIME,
    break_end_time TIME,
    break_minutes INT NOT NULL DEFAULT 0,
    required_working_minutes INT NOT NULL,
    flexible_check_in_from TIME,
    flexible_check_in_to TIME,
    grace_late_minutes INT NOT NULL DEFAULT 0,
    grace_early_leave_minutes INT NOT NULL DEFAULT 0,
    allow_early_check_in BOOLEAN NOT NULL DEFAULT true,
    allow_late_check_out BOOLEAN NOT NULL DEFAULT true,
    cross_day BOOLEAN NOT NULL DEFAULT false,
    work_days JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    is_default BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_shifts_type CHECK (shift_type IN ('Fixed', 'Flexible', 'Split', 'Night')),
    CONSTRAINT chk_shifts_status CHECK (status IN ('Active', 'Inactive')),
    CONSTRAINT chk_shifts_minutes CHECK (required_working_minutes > 0 AND break_minutes >= 0)
);

CREATE TABLE shift_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    shift_id UUID NOT NULL REFERENCES shifts(id),
    assignment_scope VARCHAR(50) NOT NULL,
    department_id UUID REFERENCES departments(id),
    employee_id UUID REFERENCES employees(id),
    effective_from DATE NOT NULL,
    effective_to DATE,
    priority INT NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    note TEXT,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_shift_assignments_scope CHECK (assignment_scope IN ('Company', 'Department', 'Employee')),
    CONSTRAINT chk_shift_assignments_status CHECK (status IN ('Active', 'Inactive')),
    CONSTRAINT chk_shift_assignments_date CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT chk_shift_assignments_target CHECK (
      (assignment_scope = 'Company' AND department_id IS NULL AND employee_id IS NULL)
      OR (assignment_scope = 'Department' AND department_id IS NOT NULL AND employee_id IS NULL)
      OR (assignment_scope = 'Employee' AND employee_id IS NOT NULL)
    )
);

CREATE TABLE attendance_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    rule_code VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    rule_scope VARCHAR(50) NOT NULL,
    department_id UUID REFERENCES departments(id),
    employee_id UUID REFERENCES employees(id),
    priority INT NOT NULL DEFAULT 0,
    effective_from DATE NOT NULL,
    effective_to DATE,
    require_check_in BOOLEAN NOT NULL DEFAULT true,
    require_check_out BOOLEAN NOT NULL DEFAULT true,
    allow_web_check_in BOOLEAN NOT NULL DEFAULT true,
    allow_mobile_check_in BOOLEAN NOT NULL DEFAULT true,
    allow_remote_check_in BOOLEAN NOT NULL DEFAULT false,
    allow_adjustment_request BOOLEAN NOT NULL DEFAULT true,
    require_gps BOOLEAN NOT NULL DEFAULT false,
    require_note BOOLEAN NOT NULL DEFAULT false,
    require_photo BOOLEAN NOT NULL DEFAULT false,
    allow_holiday_attendance BOOLEAN NOT NULL DEFAULT false,
    allow_weekend_attendance BOOLEAN NOT NULL DEFAULT false,
    auto_attendance_enabled BOOLEAN NOT NULL DEFAULT false,
    auto_check_out_enabled BOOLEAN NOT NULL DEFAULT false,
    auto_attendance_working_minutes INT,
    rule_config JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_attendance_rules_scope CHECK (rule_scope IN ('System', 'Company', 'Department', 'Employee')),
    CONSTRAINT chk_attendance_rules_status CHECK (status IN ('Active', 'Inactive')),
    CONSTRAINT chk_attendance_rules_date CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT chk_attendance_rules_target CHECK (
      (rule_scope IN ('System', 'Company') AND department_id IS NULL AND employee_id IS NULL)
      OR (rule_scope = 'Department' AND department_id IS NOT NULL AND employee_id IS NULL)
      OR (rule_scope = 'Employee' AND employee_id IS NOT NULL)
    )
);

CREATE TABLE attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    employee_id UUID NOT NULL REFERENCES employees(id),
    department_id UUID REFERENCES departments(id),
    position_id UUID REFERENCES positions(id),
    work_date DATE NOT NULL,
    shift_id UUID REFERENCES shifts(id),
    applied_rule_id UUID REFERENCES attendance_rules(id),
    check_in_at TIMESTAMP,
    check_out_at TIMESTAMP,
    first_log_id UUID,
    last_log_id UUID,
    required_working_minutes INT NOT NULL DEFAULT 0,
    working_minutes INT NOT NULL DEFAULT 0,
    break_minutes INT NOT NULL DEFAULT 0,
    late_minutes INT NOT NULL DEFAULT 0,
    early_leave_minutes INT NOT NULL DEFAULT 0,
    missing_minutes INT NOT NULL DEFAULT 0,
    overtime_minutes INT NOT NULL DEFAULT 0,
    attendance_status VARCHAR(50) NOT NULL DEFAULT 'Not Checked-in',
    check_in_status VARCHAR(50),
    check_out_status VARCHAR(50),
    attendance_source VARCHAR(50) NOT NULL DEFAULT 'WEB',
    work_mode VARCHAR(50) NOT NULL DEFAULT 'Office',
    is_late BOOLEAN NOT NULL DEFAULT false,
    is_early_leave BOOLEAN NOT NULL DEFAULT false,
    is_missing_check_in BOOLEAN NOT NULL DEFAULT false,
    is_missing_check_out BOOLEAN NOT NULL DEFAULT false,
    is_adjusted BOOLEAN NOT NULL DEFAULT false,
    is_auto BOOLEAN NOT NULL DEFAULT false,
    leave_request_id UUID,
    remote_work_request_id UUID,
    locked_at TIMESTAMP,
    locked_by UUID REFERENCES users(id),
    note TEXT,
    calculation_snapshot JSONB,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_attendance_records_source CHECK (attendance_source IN ('WEB', 'MOBILE', 'MANUAL', 'AUTO', 'REMOTE', 'DEVICE', 'IMPORT', 'API')),
    CONSTRAINT chk_attendance_records_work_mode CHECK (work_mode IN ('Office', 'Remote', 'BusinessTrip', 'Auto', 'Leave')),
    CONSTRAINT chk_attendance_records_time_order CHECK (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at)
);

CREATE TABLE attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    attendance_record_id UUID REFERENCES attendance_records(id),
    employee_id UUID NOT NULL REFERENCES employees(id),
    user_id UUID REFERENCES users(id),
    work_date DATE NOT NULL,
    log_type VARCHAR(50) NOT NULL,
    log_time TIMESTAMP NOT NULL DEFAULT now(),
    client_time TIMESTAMP,
    client_timezone VARCHAR(100),
    source VARCHAR(50) NOT NULL,
    platform VARCHAR(50),
    device_id VARCHAR(255),
    device_name VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    gps_latitude NUMERIC(10,7),
    gps_longitude NUMERIC(10,7),
    gps_accuracy_meters NUMERIC(10,2),
    location_label VARCHAR(255),
    is_valid BOOLEAN NOT NULL DEFAULT true,
    invalid_reason VARCHAR(255),
    note TEXT,
    photo_file_id UUID REFERENCES files(id),
    raw_payload JSONB,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_attendance_logs_type CHECK (log_type IN ('Check-in', 'Check-out', 'Auto', 'Manual', 'Adjustment', 'Device', 'Import')),
    CONSTRAINT chk_attendance_logs_source CHECK (source IN ('WEB', 'MOBILE', 'MANUAL', 'AUTO', 'REMOTE', 'DEVICE', 'IMPORT', 'API'))
);

CREATE TABLE attendance_adjustment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    request_code VARCHAR(100),
    attendance_record_id UUID REFERENCES attendance_records(id),
    employee_id UUID NOT NULL REFERENCES employees(id),
    work_date DATE NOT NULL,
    request_type VARCHAR(100) NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    submitted_at TIMESTAMP,
    requested_by UUID NOT NULL REFERENCES users(id),
    current_approver_user_id UUID REFERENCES users(id),
    current_approver_employee_id UUID REFERENCES employees(id),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP,
    review_note TEXT,
    attachment_file_id UUID REFERENCES files(id),
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_att_adj_requests_status CHECK (status IN ('Draft', 'Pending', 'Approved', 'Rejected', 'Cancelled'))
);

CREATE TABLE attendance_adjustment_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    request_id UUID NOT NULL REFERENCES attendance_adjustment_requests(id),
    field_name VARCHAR(100) NOT NULL,
    old_value JSONB,
    new_value JSONB NOT NULL,
    applied_value JSONB,
    is_applied BOOLEAN NOT NULL DEFAULT false,
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id)
);

CREATE TABLE remote_work_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    request_code VARCHAR(100),
    employee_id UUID NOT NULL REFERENCES employees(id),
    request_type VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    attendance_mode VARCHAR(50) NOT NULL DEFAULT 'SELF_CHECK_IN',
    location_text VARCHAR(255),
    reason TEXT NOT NULL,
    task_id UUID,
    project_id UUID,
    status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    submitted_at TIMESTAMP,
    requested_by UUID NOT NULL REFERENCES users(id),
    current_approver_user_id UUID REFERENCES users(id),
    current_approver_employee_id UUID REFERENCES employees(id),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    rejected_by UUID REFERENCES users(id),
    rejected_at TIMESTAMP,
    reject_reason TEXT,
    cancelled_at TIMESTAMP,
    cancelled_by UUID REFERENCES users(id),
    attachment_file_id UUID REFERENCES files(id),
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP,
    deleted_by UUID REFERENCES users(id),
    CONSTRAINT chk_remote_requests_type CHECK (request_type IN ('Remote', 'BusinessTrip', 'Offsite')),
    CONSTRAINT chk_remote_requests_mode CHECK (attendance_mode IN ('SELF_CHECK_IN', 'AUTO_ATTENDANCE', 'NO_ATTENDANCE')),
    CONSTRAINT chk_remote_requests_status CHECK (status IN ('Draft', 'Pending', 'Approved', 'Rejected', 'Cancelled')),
    CONSTRAINT chk_remote_requests_date CHECK (end_date >= start_date)
);

CREATE TABLE remote_work_request_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    remote_work_request_id UUID NOT NULL REFERENCES remote_work_requests(id),
    step_order INT NOT NULL DEFAULT 1,
    approver_user_id UUID REFERENCES users(id),
    approver_employee_id UUID REFERENCES employees(id),
    action VARCHAR(50) NOT NULL,
    note TEXT,
    acted_at TIMESTAMP NOT NULL DEFAULT now(),
    metadata JSONB,
    CONSTRAINT chk_remote_approvals_action CHECK (action IN ('Submitted', 'Approved', 'Rejected', 'Cancelled'))
);
```

---

## 9. Index tổng hợp đề xuất

```sql
-- shifts
CREATE UNIQUE INDEX uq_shifts_company_code_active
ON shifts (company_id, shift_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_shifts_company_status
ON shifts (company_id, status)
WHERE deleted_at IS NULL;

-- shift_assignments
CREATE INDEX idx_shift_assignments_company_scope
ON shift_assignments (company_id, assignment_scope, status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_shift_assignments_department_date
ON shift_assignments (company_id, department_id, effective_from, effective_to)
WHERE deleted_at IS NULL;

CREATE INDEX idx_shift_assignments_employee_date
ON shift_assignments (company_id, employee_id, effective_from, effective_to)
WHERE deleted_at IS NULL;

-- attendance_rules
CREATE UNIQUE INDEX uq_attendance_rules_company_code_active
ON attendance_rules (company_id, rule_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_rules_company_scope
ON attendance_rules (company_id, rule_scope, status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_rules_department_date
ON attendance_rules (company_id, department_id, effective_from, effective_to)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_rules_employee_date
ON attendance_rules (company_id, employee_id, effective_from, effective_to)
WHERE deleted_at IS NULL;

-- attendance_records
CREATE UNIQUE INDEX uq_attendance_records_employee_date_shift
ON attendance_records (company_id, employee_id, work_date, shift_id)
WHERE deleted_at IS NULL AND shift_id IS NOT NULL;

CREATE UNIQUE INDEX uq_attendance_records_employee_date_no_shift
ON attendance_records (company_id, employee_id, work_date)
WHERE deleted_at IS NULL AND shift_id IS NULL;

CREATE INDEX idx_attendance_records_employee_date
ON attendance_records (company_id, employee_id, work_date DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_records_company_date_status
ON attendance_records (company_id, work_date, attendance_status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_records_department_date
ON attendance_records (company_id, department_id, work_date)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_records_alerts
ON attendance_records (company_id, work_date, is_late, is_missing_check_out, attendance_status)
WHERE deleted_at IS NULL;

-- attendance_logs
CREATE INDEX idx_attendance_logs_record_time
ON attendance_logs (attendance_record_id, log_time)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_logs_employee_time
ON attendance_logs (company_id, employee_id, log_time DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_attendance_logs_company_work_date
ON attendance_logs (company_id, work_date, source)
WHERE deleted_at IS NULL;

-- adjustment
CREATE UNIQUE INDEX uq_att_adj_pending_employee_date_type
ON attendance_adjustment_requests (company_id, employee_id, work_date, request_type)
WHERE deleted_at IS NULL AND status = 'Pending';

CREATE INDEX idx_att_adj_employee_status
ON attendance_adjustment_requests (company_id, employee_id, status, work_date DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_att_adj_status_submitted
ON attendance_adjustment_requests (company_id, status, submitted_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_att_adj_current_approver
ON attendance_adjustment_requests (company_id, current_approver_user_id, status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_att_adj_items_request
ON attendance_adjustment_items (request_id);

-- remote
CREATE INDEX idx_remote_requests_employee_date
ON remote_work_requests (company_id, employee_id, start_date, end_date)
WHERE deleted_at IS NULL;

CREATE INDEX idx_remote_requests_status_submitted
ON remote_work_requests (company_id, status, submitted_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_remote_requests_approver
ON remote_work_requests (company_id, current_approver_user_id, status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_remote_approvals_request
ON remote_work_request_approvals (remote_work_request_id, step_order, acted_at);
```

---

## 10. Luồng transaction nghiệp vụ chính

### 10.1 Transaction check-in

```text
1. Backend lấy user từ token/session.
2. Tìm employee liên kết với user.
3. Kiểm tra employee cùng company và status hợp lệ: Probation/Official.
4. Kiểm tra permission ATT.ATTENDANCE.CHECK_IN.
5. Xác định work_date theo timezone công ty.
6. Kiểm tra ngày nghỉ lễ/ngày không làm việc nếu rule không cho phép.
7. Kiểm tra LEAVE Approved trong ngày.
8. Nếu nghỉ cả ngày Approved -> chặn check-in.
9. Kiểm tra remote request Approved.
10. Xác định shift áp dụng.
11. Xác định attendance rule áp dụng.
12. Validate GPS/note/photo nếu rule yêu cầu.
13. Lock hoặc upsert attendance_records theo company_id + employee_id + work_date + shift_id.
14. Nếu đã check-in -> trả lỗi đã check-in hoặc idempotent response.
15. Tạo attendance_logs log_type = Check-in.
16. Cập nhật attendance_records.check_in_at, status, late_minutes, calculation_snapshot.
17. Ghi audit log nếu cấu hình yêu cầu.
18. Commit transaction.
19. Phát event cho NOTI/DASH nếu cần.
```

### 10.2 Transaction check-out

```text
1. Backend lấy user và employee.
2. Kiểm tra permission ATT.ATTENDANCE.CHECK_OUT.
3. Xác định work_date/shift.
4. Tìm attendance_records hiện tại.
5. Nếu không có check-in và rule không cho phép -> trả lỗi chưa check-in.
6. Nếu đã check-out -> trả lỗi đã check-out.
7. Validate GPS/note/photo nếu rule yêu cầu.
8. Tạo attendance_logs log_type = Check-out.
9. Cập nhật check_out_at, working_minutes, early_leave_minutes, missing_minutes.
10. Tính attendance_status cuối cùng.
11. Ghi audit log nếu cần.
12. Commit transaction.
13. Phát event nếu thiếu giờ/về sớm/bất thường.
```

### 10.3 Transaction gửi yêu cầu điều chỉnh công

```text
1. Employee chọn ngày công cần điều chỉnh.
2. Backend kiểm tra permission ATT.ADJUSTMENT.CREATE_OWN.
3. Kiểm tra record/kỳ công chưa bị khóa.
4. Kiểm tra không có request Pending trùng loại.
5. Tạo attendance_adjustment_requests status Pending.
6. Tạo attendance_adjustment_items tương ứng.
7. Set attendance_records.attendance_status = Pending Adjustment nếu phù hợp.
8. Xác định approver: direct manager hoặc HR theo rule.
9. Ghi audit log.
10. Gửi notification cho approver.
```

### 10.4 Transaction duyệt điều chỉnh công

```text
1. Manager/HR mở request Pending.
2. Backend kiểm tra permission ATT.ADJUSTMENT.APPROVE.
3. Kiểm tra data scope: Team/Department/Company/System.
4. Lock request và attendance record.
5. Kiểm tra request vẫn Pending.
6. Apply attendance_adjustment_items vào attendance_records.
7. Tính lại working_minutes, late, early, missing, status.
8. Update request status Approved.
9. Set items.is_applied = true.
10. Ghi attendance_logs Manual nếu cần.
11. Ghi audit_logs old_values/new_values.
12. Gửi notification cho employee.
```

### 10.5 Transaction từ chối điều chỉnh công

```text
1. Approver mở request Pending.
2. Backend kiểm tra quyền reject và data scope.
3. Bắt buộc nhập review_note.
4. Update request status Rejected.
5. Không thay đổi attendance_records, trừ khi cần bỏ Pending Adjustment nếu không còn request pending.
6. Ghi audit log.
7. Gửi notification cho employee.
```

### 10.6 Transaction HR/Admin điều chỉnh trực tiếp

```text
1. HR/Admin mở attendance record.
2. Backend kiểm tra ATT.ATTENDANCE.ADJUST_DIRECT.
3. Kiểm tra record/kỳ công chưa khóa hoặc user có quyền override.
4. Lock attendance record.
5. Lưu old_values.
6. Cập nhật field được phép.
7. Tính lại trạng thái.
8. Set is_adjusted = true.
9. Tạo attendance_logs Manual nếu cần.
10. Ghi audit_logs chi tiết.
11. Gửi notification nếu cấu hình bật.
```

### 10.7 Transaction duyệt remote/công tác

```text
1. Manager/HR mở remote_work_requests Pending.
2. Backend kiểm tra ATT.REMOTE_REQUEST.APPROVE và data scope.
3. Update request status Approved.
4. Ghi remote_work_request_approvals action Approved.
5. Nếu attendance_mode = AUTO_ATTENDANCE, tạo job hoặc tạo ngay attendance_records cho từng ngày.
6. Nếu attendance_mode = SELF_CHECK_IN, rule check-in trong ngày đó chuyển sang remote.
7. Ghi audit log.
8. Gửi notification cho employee.
```

### 10.8 Job tự động chấm công

```text
1. Job chạy theo lịch cấu hình.
2. Lấy danh sách employee thuộc rule auto_attendance_enabled.
3. Kiểm tra employment_status hợp lệ.
4. Kiểm tra public holiday/weekend theo rule.
5. Kiểm tra leave Approved; nếu có leave cả ngày thì bỏ qua hoặc set Leave.
6. Kiểm tra remote Approved.
7. Upsert attendance_records source AUTO.
8. Set working_minutes = auto_attendance_working_minutes.
9. Ghi audit/system log.
10. Gửi notification nếu bật.
```

### 10.9 Recalculate khi LEAVE thay đổi

Khi đơn nghỉ được Approved/Cancelled/Revoked, LEAVE phát event để ATT tính lại.

```text
1. Nhận event leave_request_changed.
2. Xác định employee_id và danh sách ngày bị ảnh hưởng.
3. Lock attendance_records tương ứng.
4. Nếu leave Approved cả ngày -> status Leave, required_working_minutes = 0.
5. Nếu leave nửa ngày/theo giờ -> giảm required_working_minutes.
6. Nếu leave bị hủy/thu hồi -> khôi phục required_working_minutes theo shift/rule.
7. Tính lại late/early/missing/status.
8. Ghi audit/system log.
9. Gửi notification nếu cần.
```

---

## 11. Quy tắc tính toán dữ liệu công

### 11.1 Công thức cơ bản

```text
working_minutes = check_out_at - check_in_at - break_minutes
missing_minutes = max(required_working_minutes - working_minutes, 0)
late_minutes = max(check_in_at - allowed_start_time, 0)
early_leave_minutes = max(allowed_end_time - check_out_at, 0)
```

### 11.2 Ca cố định

```text
allowed_start_time = shift.start_time + grace_late_minutes
allowed_end_time = shift.end_time - grace_early_leave_minutes
```

Nếu `check_in_at > allowed_start_time` -> Late.

Nếu `check_out_at < allowed_end_time` -> Early Leave.

Nếu `working_minutes < required_working_minutes` -> Missing Hours.

### 11.3 Ca linh hoạt

Với ca linh hoạt, không nhất thiết tính đi muộn theo `start_time`.

Có thể áp dụng:

```text
Nếu check_in_at ngoài flexible_check_in_from/to -> Late hoặc Invalid tùy rule.
Nếu working_minutes >= required_working_minutes -> Present.
Nếu working_minutes < required_working_minutes -> Missing Hours.
```

### 11.4 Nghỉ phép ảnh hưởng required minutes

```text
Full day leave:
required_working_minutes = 0
attendance_status = Leave

Half day leave:
required_working_minutes = shift.required_working_minutes / 2

Hourly leave:
required_working_minutes = shift.required_working_minutes - leave_minutes
```

### 11.5 Remote work

```text
SELF_CHECK_IN:
Employee vẫn check-in/check-out, work_mode = Remote.

AUTO_ATTENDANCE:
System tạo record, source = AUTO hoặc REMOTE, is_auto = true.

NO_ATTENDANCE:
Không tạo record hoặc tạo record informational tùy cấu hình công ty.
```

---

## 12. Permission seed đề xuất cho ATT

| Permission code | Resource | Action | Sensitive | Ghi chú |
| --- | --- | --- | --- | --- |
| `ATT.ATTENDANCE.CHECK_IN` | ATTENDANCE | CHECK_IN | No | Check-in |
| `ATT.ATTENDANCE.CHECK_OUT` | ATTENDANCE | CHECK_OUT | No | Check-out |
| `ATT.ATTENDANCE.VIEW_OWN` | ATTENDANCE | VIEW_OWN | Yes | Xem công cá nhân |
| `ATT.ATTENDANCE.VIEW_TEAM` | ATTENDANCE | VIEW_TEAM | Yes | Xem công team |
| `ATT.ATTENDANCE.VIEW_COMPANY` | ATTENDANCE | VIEW_COMPANY | Yes | Xem công toàn công ty |
| `ATT.ATTENDANCE.VIEW_DETAIL` | ATTENDANCE | VIEW_DETAIL | Yes | Xem chi tiết ngày công |
| `ATT.ATTENDANCE.EXPORT` | ATTENDANCE | EXPORT | Yes | Xuất dữ liệu công |
| `ATT.ATTENDANCE.ADJUST_DIRECT` | ATTENDANCE | ADJUST_DIRECT | Yes | Điều chỉnh trực tiếp |
| `ATT.ADJUSTMENT.CREATE_OWN` | ADJUSTMENT | CREATE_OWN | No | Tạo yêu cầu điều chỉnh |
| `ATT.ADJUSTMENT.VIEW_OWN` | ADJUSTMENT | VIEW_OWN | Yes | Xem request của mình |
| `ATT.ADJUSTMENT.VIEW_TEAM` | ADJUSTMENT | VIEW_TEAM | Yes | Xem request team |
| `ATT.ADJUSTMENT.VIEW_COMPANY` | ADJUSTMENT | VIEW_COMPANY | Yes | Xem request công ty |
| `ATT.ADJUSTMENT.APPROVE` | ADJUSTMENT | APPROVE | Yes | Duyệt điều chỉnh |
| `ATT.ADJUSTMENT.REJECT` | ADJUSTMENT | REJECT | Yes | Từ chối điều chỉnh |
| `ATT.ADJUSTMENT.CANCEL_OWN` | ADJUSTMENT | CANCEL_OWN | No | Hủy request của mình |
| `ATT.SHIFT.VIEW` | SHIFT | VIEW | No | Xem ca |
| `ATT.SHIFT.CREATE` | SHIFT | CREATE | Yes | Tạo ca |
| `ATT.SHIFT.UPDATE` | SHIFT | UPDATE | Yes | Sửa ca |
| `ATT.SHIFT.DELETE` | SHIFT | DELETE | Yes | Vô hiệu hóa ca |
| `ATT.SHIFT_ASSIGNMENT.VIEW` | SHIFT_ASSIGNMENT | VIEW | Yes | Xem gán ca |
| `ATT.SHIFT_ASSIGNMENT.UPDATE` | SHIFT_ASSIGNMENT | UPDATE | Yes | Gán/sửa ca |
| `ATT.RULE.VIEW` | RULE | VIEW | Yes | Xem rule |
| `ATT.RULE.CONFIG` | RULE | CONFIG | Yes | Cấu hình rule |
| `ATT.REMOTE_REQUEST.CREATE_OWN` | REMOTE_REQUEST | CREATE_OWN | No | Tạo request remote |
| `ATT.REMOTE_REQUEST.VIEW_OWN` | REMOTE_REQUEST | VIEW_OWN | Yes | Xem remote của mình |
| `ATT.REMOTE_REQUEST.VIEW_TEAM` | REMOTE_REQUEST | VIEW_TEAM | Yes | Xem remote team |
| `ATT.REMOTE_REQUEST.VIEW_COMPANY` | REMOTE_REQUEST | VIEW_COMPANY | Yes | Xem remote công ty |
| `ATT.REMOTE_REQUEST.APPROVE` | REMOTE_REQUEST | APPROVE | Yes | Duyệt remote |
| `ATT.REMOTE_REQUEST.REJECT` | REMOTE_REQUEST | REJECT | Yes | Từ chối remote |
| `ATT.AUDIT_LOG.VIEW` | AUDIT_LOG | VIEW | Yes | Xem log ATT |

---

## 13. Seed data đề xuất

### 13.1 Attendance source

```text
WEB
MOBILE
MANUAL
AUTO
REMOTE
DEVICE
IMPORT
API
```

### 13.2 Attendance status

```text
Not Checked-in
Checked-in
Checked-out
Present
Late
Early Leave
Missing Hours
Missing Check-in
Missing Check-out
Absent
Leave
Remote Work
Auto Attendance
Adjusted
Pending Adjustment
Invalid
```

### 13.3 Adjustment request type

```text
MISSING_CHECK_IN
MISSING_CHECK_OUT
UPDATE_CHECK_IN
UPDATE_CHECK_OUT
EXPLAIN_LATE
EXPLAIN_EARLY_LEAVE
UPDATE_STATUS
REMOTE_CORRECTION
OTHER
```

### 13.4 Remote request type

```text
Remote
BusinessTrip
Offsite
```

### 13.5 Remote attendance mode

```text
SELF_CHECK_IN
AUTO_ATTENDANCE
NO_ATTENDANCE
```

### 13.6 Default shift đề xuất

```text
shift_code: OFFICE_8H
name: Ca hành chính 8h
shift_type: Fixed
start_time: 08:00
end_time: 17:30
break_minutes: 90
required_working_minutes: 480
grace_late_minutes: 5
grace_early_leave_minutes: 5
is_default: true
```

### 13.7 Default attendance rule đề xuất

```text
rule_code: DEFAULT_ATTENDANCE_RULE
name: Rule chấm công mặc định
rule_scope: Company
require_check_in: true
require_check_out: true
allow_web_check_in: true
allow_mobile_check_in: true
allow_remote_check_in: false
allow_adjustment_request: true
require_gps: false
require_note: false
require_photo: false
auto_attendance_enabled: false
auto_check_out_enabled: false
status: Active
```

---

## 14. Query pattern quan trọng

### 14.1 Lấy trạng thái hôm nay của tôi

```sql
SELECT ar.*
FROM attendance_records ar
WHERE ar.company_id = :company_id
  AND ar.employee_id = :employee_id
  AND ar.work_date = :today
  AND ar.deleted_at IS NULL
ORDER BY ar.created_at DESC
LIMIT 1;
```

### 14.2 Bảng công cá nhân theo tháng

```sql
SELECT ar.*
FROM attendance_records ar
WHERE ar.company_id = :company_id
  AND ar.employee_id = :employee_id
  AND ar.work_date >= :from_date
  AND ar.work_date <= :to_date
  AND ar.deleted_at IS NULL
ORDER BY ar.work_date DESC;
```

### 14.3 Bảng công team của Manager

```sql
SELECT ar.*
FROM attendance_records ar
JOIN employees e ON e.id = ar.employee_id
WHERE ar.company_id = :company_id
  AND e.direct_manager_id = :manager_employee_id
  AND ar.work_date BETWEEN :from_date AND :to_date
  AND ar.deleted_at IS NULL
ORDER BY ar.work_date DESC, e.full_name ASC;
```

### 14.4 Bất thường chấm công trong ngày

```sql
SELECT ar.*
FROM attendance_records ar
WHERE ar.company_id = :company_id
  AND ar.work_date = :work_date
  AND ar.deleted_at IS NULL
  AND (
    ar.is_late = true
    OR ar.is_early_leave = true
    OR ar.is_missing_check_out = true
    OR ar.attendance_status IN ('Absent', 'Missing Hours')
  );
```

### 14.5 Request điều chỉnh đang chờ duyệt

```sql
SELECT r.*
FROM attendance_adjustment_requests r
WHERE r.company_id = :company_id
  AND r.status = 'Pending'
  AND r.current_approver_user_id = :user_id
  AND r.deleted_at IS NULL
ORDER BY r.submitted_at DESC;
```

### 14.6 Remote Approved theo ngày

```sql
SELECT r.*
FROM remote_work_requests r
WHERE r.company_id = :company_id
  AND r.employee_id = :employee_id
  AND r.status = 'Approved'
  AND :work_date BETWEEN r.start_date AND r.end_date
  AND r.deleted_at IS NULL;
```

---

## 15. Liên kết với module khác

### 15.1 ATT với AUTH/RBAC

ATT dùng AUTH để:

1. Xác định user đang đăng nhập.
2. Kiểm tra session/token.
3. Kiểm tra permission.
4. Kiểm tra data scope.
5. Ghi actor vào audit log.

Các bảng ATT lưu `created_by`, `updated_by`, `requested_by`, `reviewed_by`, `approved_by` tham chiếu `users.id`.

### 15.2 ATT với HR

ATT dùng HR để:

1. Tìm employee từ user.
2. Kiểm tra `employment_status`.
3. Lấy `department_id`, `position_id` để snapshot.
4. Xác định `direct_manager_id` cho scope Team và approver.
5. Chặn nhân viên đã Resigned/Terminated chấm công.

### 15.3 ATT với LEAVE

ATT dùng LEAVE để:

1. Kiểm tra đơn nghỉ Approved trong ngày.
2. Chặn check-in/check-out nếu nghỉ cả ngày.
3. Giảm `required_working_minutes` nếu nghỉ nửa ngày/theo giờ.
4. Set `attendance_status = Leave` nếu nghỉ cả ngày.
5. Tính lại bảng công nếu đơn nghỉ bị hủy/thu hồi.

### 15.4 ATT với TASK

Trong MVP, ATT chưa bắt buộc tính công theo task.

Thiết kế để mở:

1. Remote request có `task_id`, `project_id` nullable.
2. Phase sau có thể thêm `attendance_task_logs` để tracking thời gian theo task.
3. Có thể yêu cầu note/task khi remote nếu rule bật.

### 15.5 ATT với NOTI

ATT phát event cho NOTI khi:

1. Quên check-out.
2. Vắng mặt.
3. Đi muộn/về sớm nếu bật cảnh báo.
4. Employee gửi yêu cầu điều chỉnh công.
5. Request điều chỉnh được duyệt/từ chối.
6. HR/Admin điều chỉnh trực tiếp.
7. Remote request được duyệt/từ chối.
8. Auto attendance được ghi nhận.

### 15.6 ATT với DASH

DASH query hoặc gọi service ATT để hiển thị:

1. Chấm công hôm nay.
2. Bảng công cá nhân tóm tắt.
3. Bất thường chấm công team.
4. Bất thường chấm công toàn công ty.
5. Pending adjustment.
6. Remote work status.

DASH không ghi `attendance_records` trực tiếp.

---

## 16. Bảo mật dữ liệu ATT

### 16.1 Dữ liệu nhạy cảm

Nhóm dữ liệu ATT nhạy cảm:

1. GPS latitude/longitude.
2. IP address.
3. User agent/device info.
4. Ảnh xác nhận chấm công.
5. Lý do điều chỉnh công.
6. Lịch sử đi muộn/vắng mặt.
7. Export bảng công.

### 16.2 Nguyên tắc bảo mật

1. Backend luôn kiểm tra permission.
2. Query luôn filter `company_id`.
3. Employee chỉ xem dữ liệu của chính mình.
4. Manager chỉ xem team theo `direct_manager_id` hoặc scope được cấp.
5. HR/Admin xem theo Company nếu có quyền.
6. GPS/IP chỉ trả trong API chi tiết nếu có quyền `ATT.ATTENDANCE.VIEW_DETAIL` hoặc quyền nhạy cảm tương ứng.
7. Export bảng công phải ghi audit log.
8. File ảnh/private attachment không dùng public URL trực tiếp.

---

## 17. Chiến lược migration

### 17.1 Thứ tự migration đề xuất

```text
006_01_create_shifts
006_02_create_shift_assignments
006_03_create_attendance_rules
006_04_create_attendance_records
006_05_create_attendance_logs
006_06_create_attendance_adjustment_requests
006_07_create_attendance_adjustment_items
006_08_create_remote_work_requests
006_09_create_remote_work_request_approvals
006_10_create_attendance_indexes
006_11_seed_attendance_permissions
006_12_seed_default_shift_and_rule
```

### 17.2 Phụ thuộc trước khi chạy DB-04

DB-04 cần các migration trước đó:

```text
001_create_companies
002_create_users_roles_permissions
003_create_audit_logs
004_create_files
005_create_hr_core
```

Lý do:

1. ATT cần `companies`.
2. ATT cần `users` cho actor.
3. ATT cần `employees`, `departments`, `positions`.
4. ATT cần `audit_logs` và `files`.

---

## 18. Rủi ro và cách giảm thiểu

| Rủi ro | Mức độ | Cách giảm thiểu |
| --- | --- | --- |
| Tạo trùng record khi bấm check-in nhiều lần | Cao | Unique index + transaction lock/upsert |
| Sai giờ do client gửi thời gian giả | Cao | Dùng server time làm nguồn chính |
| Rò dữ liệu cross-company | Cao | Mọi query bắt buộc filter `company_id` |
| Manager xem dữ liệu ngoài team | Cao | Scope Team dựa trên `employees.direct_manager_id` |
| Rule thay đổi làm sai dữ liệu quá khứ | Trung bình | Lưu `applied_rule_id` và `calculation_snapshot` |
| Bảng công nặng khi query theo tháng | Trung bình | Index theo employee/date, department/date, status/date |
| GPS/IP là dữ liệu nhạy cảm | Trung bình | Mask/ẩn theo permission, audit khi export |
| Leave thay đổi sau khi đã chấm công | Cao | Event recalculate từ LEAVE sang ATT |
| Remote và Leave trùng ngày | Trung bình | Leave Approved ưu tiên cao hơn remote |
| Duyệt điều chỉnh khi record đã thay đổi | Trung bình | Lock record/request và kiểm tra version/updated_at |

---

## 19. Quyết định thiết kế đã chốt

1. DB-04 là thiết kế database chi tiết cho module ATT.
2. ATT dùng `employees.id` làm khóa nghiệp vụ chính, không dùng `users.id` làm chủ thể chấm công.
3. Mỗi employee/ngày/ca chỉ có một `attendance_records` chính trong MVP.
4. `attendance_records` là dữ liệu tổng hợp; `attendance_logs` là log thô.
5. Check-in/check-out luôn dùng server time.
6. Shift có thể gán theo Company/Department/Employee.
7. Rule chấm công có thể cấu hình theo Company/Department/Employee.
8. Rule Employee ưu tiên hơn Department; Department ưu tiên hơn Company.
9. Leave Approved ưu tiên cao hơn check-in/check-out thủ công và auto attendance.
10. Remote/công tác nằm trong ATT vì là trạng thái đi làm, không phải nghỉ phép.
11. HR/Admin điều chỉnh trực tiếp phải ghi audit log.
12. Employee adjustment request phải có trạng thái và lịch sử xử lý.
13. Manager duyệt điều chỉnh/remote theo scope Team.
14. HR/Admin duyệt theo Company nếu được cấp quyền.
15. Dữ liệu GPS/IP/device được xem là nhạy cảm.
16. Bảng công cần thiết kế sẵn cho Payroll phase sau.
17. Thiết bị chấm công vật lý chưa thuộc MVP nhưng `attendance_source = DEVICE` được chừa sẵn.
18. Import Excel/CSV chưa thuộc MVP nhưng `attendance_source = IMPORT` được chừa sẵn.
19. `department_id` được denormalize vào `attendance_records` để query team/phòng ban nhanh.
20. Dashboard không ghi dữ liệu ATT, chỉ đọc/tổng hợp/cache.

---

## 20. Việc cần làm tiếp theo

Sau DB-04, nên triển khai:

```text
DB-05: LEAVE Database Design
```

DB-05 cần bám chặt vào DB-04 ở các điểm:

1. `leave_request_days` phải đủ chi tiết để ATT biết ngày nào nghỉ full/half/hourly.
2. Khi leave Approved, LEAVE cần phát event để ATT cập nhật/tính lại `attendance_records`.
3. Khi leave Cancelled/Revoked, ATT cần restore/tính lại required minutes.
4. `leave_requests.employee_id` và `attendance_records.employee_id` phải cùng nguồn từ `employees.id`.
5. LEAVE và ATT cần thống nhất timezone/date boundary theo company.

---

## 21. Phụ lục: API mapping sang bảng

| API | Bảng chính | Bảng phụ |
| --- | --- | --- |
| `GET /api/attendance/today` | `attendance_records` | `shifts`, `attendance_rules`, `leave_request_days`, `remote_work_requests` |
| `POST /api/attendance/check-in` | `attendance_records` | `attendance_logs`, `audit_logs` |
| `POST /api/attendance/check-out` | `attendance_records` | `attendance_logs`, `audit_logs` |
| `GET /api/attendance/my-records` | `attendance_records` | `attendance_logs` |
| `GET /api/attendance/team-records` | `attendance_records` | `employees` |
| `GET /api/attendance/records` | `attendance_records` | `employees`, `departments` |
| `POST /api/attendance/adjustment-requests` | `attendance_adjustment_requests` | `attendance_adjustment_items`, `files`, `notifications` |
| `POST /api/attendance/adjustment-requests/{id}/approve` | `attendance_adjustment_requests` | `attendance_records`, `attendance_adjustment_items`, `audit_logs`, `notifications` |
| `POST /api/attendance/records/{id}/manual-adjust` | `attendance_records` | `attendance_logs`, `audit_logs`, `notifications` |
| `GET /api/attendance/shifts` | `shifts` | `shift_assignments` |
| `POST /api/attendance/shifts` | `shifts` | `audit_logs` |
| `POST /api/attendance/shift-assignments` | `shift_assignments` | `audit_logs` |
| `POST /api/attendance/rules` | `attendance_rules` | `audit_logs` |
| `POST /api/attendance/remote-requests` | `remote_work_requests` | `remote_work_request_approvals`, `notifications` |
| `POST /api/attendance/remote-requests/{id}/approve` | `remote_work_requests` | `remote_work_request_approvals`, `attendance_records`, `notifications` |

---

## 22. Kết luận

DB-04 thiết kế module ATT theo hướng:

1. Chặt chẽ với AUTH/RBAC để kiểm soát quyền và data scope.
2. Chặt chẽ với HR vì employee là trung tâm của chấm công.
3. Chặt chẽ với LEAVE vì nghỉ phép ảnh hưởng trực tiếp đến trạng thái công.
4. Đủ mở cho remote, auto attendance, mobile, device integration và payroll.
5. Có cấu trúc record/log rõ ràng để vừa phục vụ nghiệp vụ, vừa truy vết được dữ liệu.
6. Có index và constraint để chống trùng dữ liệu, tối ưu bảng công, hỗ trợ dashboard.
7. Có audit log và bảo mật dữ liệu nhạy cảm như GPS/IP/file bằng chứng.

Tài liệu DB-04 có thể dùng trực tiếp làm cơ sở để backend viết migration, entity, repository, service rule engine và API cho module chấm công.
