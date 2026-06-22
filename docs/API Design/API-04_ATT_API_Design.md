# API-04: ATT API DESIGN

**MODULE CHẤM CÔNG - ATTENDANCE API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · **API-04 ATT** · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>)
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-04 ATT](<../SPEC/SPEC-04 ATT.md>) · [Thiết kế DB: DB-04 ATT](<../DB/DB-04_ATT Database Design.md>) · [Sản phẩm: PRD-00 §9.3](<../PRD/PRD-00 Enterprise Management System .md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-04 |
| Tên tài liệu | ATT API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | ATT - Chấm công |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01, API-02, API-03 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết thiết kế API cho module **ATT - Chấm công** của hệ thống quản lý doanh nghiệp nội bộ.

Module ATT chịu trách nhiệm cung cấp API cho các nghiệp vụ:

1. Check-in hằng ngày.
2. Check-out hằng ngày.
3. Xem trạng thái chấm công hôm nay.
4. Xem bảng công cá nhân.
5. Xem bảng công team.
6. Xem bảng công toàn công ty theo quyền.
7. Xem chi tiết ngày công và log chấm công.
8. Quản lý ca làm việc.
9. Gán ca làm theo công ty, phòng ban hoặc nhân viên.
10. Quản lý rule chấm công.
11. Tính đi muộn, về sớm, thiếu giờ, đủ công.
12. Chặn chấm công khi có đơn nghỉ phép đã duyệt.
13. Xử lý chấm công remote/công tác.
14. Tạo, duyệt, từ chối và hủy yêu cầu điều chỉnh công.
15. HR/Admin điều chỉnh công trực tiếp.
16. Xuất bảng công.
17. Phát event cho Notification.
18. Cung cấp dữ liệu cho Dashboard.
19. Ghi audit log cho thao tác quan trọng.
20. Chừa khả năng mở rộng cho thiết bị chấm công, GPS nâng cao, import log, overtime và payroll.

Tài liệu API-04 dùng làm cơ sở cho:

1. Backend triển khai controller, route, DTO, validation, service, repository, rule engine và job tự động cho ATT.
2. Frontend triển khai màn hình chấm công hôm nay, bảng công cá nhân, bảng công team, cấu hình ca/rule, điều chỉnh công và remote request.
3. Mobile app triển khai check-in/check-out, remote attendance và gửi yêu cầu điều chỉnh công.
4. QA viết test case API, permission test, scope test, regression test và test case nghiệp vụ chấm công.
5. DevOps/API documentation tạo OpenAPI/Swagger cho module ATT.
6. Các module LEAVE, DASH, NOTI và PAYROLL phase sau tích hợp dữ liệu ATT đúng chuẩn.

---

## 3. Căn cứ thiết kế

API-04 tuân thủ các quyết định đã chốt trong bộ tài liệu dự án:

1. **API-01** quy định toàn bộ API dùng prefix `/api/v1`, response/error/pagination thống nhất, backend bắt buộc kiểm tra authentication, permission, data scope, business rule, audit log và notification event.
2. **SPEC-04** xác định ATT là module chấm công, bao gồm check-in, check-out, bảng công, ca làm, rule, điều chỉnh công, remote/công tác, tự động chấm công, audit log và event notification.
3. **DB-04** xác định các bảng chính của ATT gồm `shifts`, `shift_assignments`, `attendance_rules`, `attendance_records`, `attendance_logs`, `attendance_adjustment_requests`, `attendance_adjustment_items`, `remote_work_requests`, `remote_work_request_approvals`.
4. **SPEC-02/API-02 AUTH** là nền tảng xác thực, phân quyền, role, permission và data scope.
5. **SPEC-03/API-03 HR** cung cấp `employees`, `departments`, `positions`, `direct_manager_id`, `employment_status` và user-employee mapping.
6. **SPEC-05 LEAVE** cung cấp dữ liệu đơn nghỉ Approved để ATT chặn hoặc tính lại công.
7. **SPEC-07 DASH** đọc dữ liệu ATT để hiển thị chấm công hôm nay, bảng công tóm tắt và bất thường chấm công.
8. **SPEC-08 NOTI** nhận event từ ATT để gửi thông báo quên check-out, điều chỉnh công, remote request và bất thường.
9. **DB-08 FOUNDATION** cung cấp audit log, file service, setting service, sequence service và public holidays.
10. **DB-09** định hướng index, query pattern và performance cho bảng công, log, export và dashboard.

---

## 4. Phạm vi API-04

### 4.1 Bao gồm trong MVP

| Nhóm API | Mô tả |
| --- | --- |
| Today Attendance API | Lấy trạng thái chấm công hôm nay, rule đang áp dụng, nút hành động được phép |
| Check-in/Check-out API | Nhân viên check-in/check-out bằng web hoặc mobile |
| Attendance Record API | Xem bảng công cá nhân, team, toàn công ty, chi tiết record, log record |
| Attendance Adjustment API | Employee gửi yêu cầu điều chỉnh công, Manager/HR duyệt hoặc từ chối |
| Manual Adjustment API | HR/Admin điều chỉnh công trực tiếp theo quyền |
| Shift API | Quản lý ca làm việc cố định hoặc linh hoạt |
| Shift Assignment API | Gán ca theo company, department hoặc employee |
| Attendance Rule API | Quản lý rule chấm công theo company, department hoặc employee |
| Remote Work Request API | Tạo, xem, duyệt, từ chối, hủy request remote/công tác |
| Export API | Xuất bảng công theo bộ lọc và quyền |
| Audit/Log API | Xem log chấm công và lịch sử thao tác theo quyền |
| Internal Recalculate API | API nội bộ để tính lại công khi LEAVE/REMOTE/RULE thay đổi |

---

### 4.2 Chưa bao gồm trong MVP nhưng API cần chừa khả năng mở rộng

| Nhóm | Giai đoạn | Hướng mở rộng API |
| --- | --- | --- |
| Tích hợp thiết bị chấm công | Phase sau | `/api/v1/attendance/devices`, `/internal/v1/attendance/device-sync-batches` |
| Import Excel/CSV | Phase sau | `/api/v1/attendance/imports` |
| Overtime | Phase sau | `/api/v1/attendance/overtime-requests` |
| Khóa kỳ công | Phase sau | `/api/v1/attendance/period-locks` |
| GPS/geofence nâng cao | Phase sau | `/api/v1/attendance/geofences` |
| QR code attendance | Phase sau | `/api/v1/attendance/qr-sessions` |
| Face recognition | Phase sau | Tích hợp service riêng, ATT chỉ lưu metadata/private file reference |
| Payroll integration | Phase 2 | Payroll đọc `attendance_records`, không sửa trực tiếp dữ liệu ATT |
| AI anomaly detection | Phase 5 | `/api/v1/attendance/anomaly-flags` |

---

## 5. API prefix và nguyên tắc chung

### 5.1 Base prefix

Tất cả endpoint ATT public cho frontend/mobile app dùng prefix:

```http
/api/v1/attendance
```

Ví dụ:

```http
GET  /api/v1/attendance/today
POST /api/v1/attendance/check-in
POST /api/v1/attendance/check-out
GET  /api/v1/attendance/my-records
GET  /api/v1/attendance/records
POST /api/v1/attendance/adjustment-requests
GET  /api/v1/attendance/shifts
```

Các API nội bộ giữa module/job dùng prefix:

```http
/internal/v1/attendance
```

Ví dụ:

```http
POST /internal/v1/attendance/recalculate
POST /internal/v1/attendance/auto-checkout-job
POST /internal/v1/attendance/missing-checkout-job
```

Internal API không được gọi trực tiếp từ frontend/mobile.

---

### 5.2 Authentication

Tất cả API ATT public trong MVP yêu cầu access token hợp lệ:

```http
Authorization: Bearer <access_token>
```

Không có endpoint ATT public không cần đăng nhập trong MVP.

---

### 5.3 Multi-tenant

Backend resolve `company_id` từ auth context. Frontend không được tự truyền `company_id` trong request body cho nghiệp vụ ATT thông thường.

Quy tắc:

1. Mọi query ATT phải filter theo `company_id`.
2. Không tin `company_id`, `employee_id`, `department_id`, `role`, `permission` do frontend gửi nếu backend có thể resolve từ auth context hoặc dữ liệu HR.
3. Employee check-in/check-out luôn theo employee đang liên kết với user hiện tại.
4. Manager xem/duyệt theo scope Team dựa trên `employees.direct_manager_id` hoặc cơ chế scope được cấp.
5. HR/Admin xem dữ liệu company nếu có permission và data scope phù hợp.
6. Super Admin có scope `System` mới được truy vấn liên công ty qua endpoint riêng hoặc cơ chế đặc biệt.
7. Nếu biết UUID record của công ty khác, backend vẫn phải trả `404 Not Found` hoặc `403 Forbidden` theo policy bảo mật.

---

### 5.4 Response format

Tất cả response tuân thủ API-01.

#### Object response

```json
{
  "success": true,
  "message": "Lấy dữ liệu thành công",
  "data": {},
  "meta": {
    "request_id": "req_20260620_000001",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

#### List response

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

#### Error response

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

## 6. Authorization, permission và data scope

### 6.1 Nguyên tắc authorization

Backend không hard-code theo role. Backend kiểm tra theo:

```text
permission + data_scope + target resource + business validation
```

`Allowed roles` trong tài liệu chỉ là gợi ý nghiệp vụ dựa trên seed role mặc định.

Ví dụ:

```text
Employee có ATT.ATTENDANCE.VIEW_OWN scope Own
-> Chỉ xem bảng công của chính mình.

Manager có ATT.ADJUSTMENT.APPROVE scope Team
-> Chỉ duyệt yêu cầu điều chỉnh của nhân viên thuộc team.

HR có ATT.ATTENDANCE.VIEW_COMPANY scope Company
-> Xem bảng công toàn công ty.
```

---

### 6.2 Scope chuẩn trong ATT

| Scope | Ý nghĩa trong ATT |
| --- | --- |
| `Own` | Chỉ bản ghi công, log, adjustment request, remote request của employee liên kết với user hiện tại |
| `Team` | Dữ liệu nhân viên có `direct_manager_id` là employee hiện tại hoặc thuộc team được phân quyền |
| `Department` | Dữ liệu nhân viên thuộc phòng ban user được quản lý hoặc được phân quyền |
| `Company` | Toàn bộ dữ liệu ATT trong công ty hiện tại |
| `System` | Dữ liệu ATT liên công ty, chỉ dành cho Super Admin |

---

### 6.3 Quyền ATT trong MVP

| Permission | Mục đích |
| --- | --- |
| `ATT.ATTENDANCE.CHECK_IN` | Được check-in cho chính mình |
| `ATT.ATTENDANCE.CHECK_OUT` | Được check-out cho chính mình |
| `ATT.ATTENDANCE.VIEW_OWN` | Xem bảng công cá nhân |
| `ATT.ATTENDANCE.VIEW_TEAM` | Xem bảng công team |
| `ATT.ATTENDANCE.VIEW_COMPANY` | Xem bảng công toàn công ty |
| `ATT.ATTENDANCE.VIEW_DETAIL` | Xem chi tiết bản ghi công và log chi tiết |
| `ATT.ATTENDANCE.VIEW_SENSITIVE` | Xem dữ liệu nhạy cảm như GPS/IP/device nếu được cấu hình |
| `ATT.ATTENDANCE.EXPORT` | Xuất dữ liệu bảng công |
| `ATT.ATTENDANCE.ADJUST_DIRECT` | HR/Admin điều chỉnh công trực tiếp |
| `ATT.ATTENDANCE.RECALCULATE` | Tính lại bản ghi công thủ công hoặc qua job nội bộ |
| `ATT.ADJUSTMENT.CREATE_OWN` | Employee gửi yêu cầu điều chỉnh công |
| `ATT.ADJUSTMENT.VIEW_OWN` | Employee xem yêu cầu điều chỉnh của chính mình |
| `ATT.ADJUSTMENT.VIEW_TEAM` | Manager xem yêu cầu điều chỉnh của team |
| `ATT.ADJUSTMENT.VIEW_COMPANY` | HR/Admin xem yêu cầu điều chỉnh toàn công ty |
| `ATT.ADJUSTMENT.APPROVE` | Duyệt yêu cầu điều chỉnh công |
| `ATT.ADJUSTMENT.REJECT` | Từ chối yêu cầu điều chỉnh công |
| `ATT.ADJUSTMENT.CANCEL_OWN` | Employee hủy yêu cầu điều chỉnh khi còn Pending |
| `ATT.SHIFT.VIEW` | Xem ca làm |
| `ATT.SHIFT.CREATE` | Tạo ca làm |
| `ATT.SHIFT.UPDATE` | Cập nhật ca làm |
| `ATT.SHIFT.DELETE` | Xóa mềm/vô hiệu hóa ca làm |
| `ATT.SHIFT_ASSIGNMENT.VIEW` | Xem gán ca |
| `ATT.SHIFT_ASSIGNMENT.UPDATE` | Tạo/cập nhật/hủy gán ca |
| `ATT.RULE.VIEW` | Xem rule chấm công |
| `ATT.RULE.CONFIG` | Cấu hình rule chấm công |
| `ATT.REMOTE_REQUEST.CREATE_OWN` | Gửi yêu cầu remote/công tác |
| `ATT.REMOTE_REQUEST.VIEW_OWN` | Xem yêu cầu remote/công tác của mình |
| `ATT.REMOTE_REQUEST.VIEW_TEAM` | Manager xem yêu cầu remote/công tác của team |
| `ATT.REMOTE_REQUEST.VIEW_COMPANY` | HR/Admin xem yêu cầu remote/công tác toàn công ty |
| `ATT.REMOTE_REQUEST.APPROVE` | Duyệt yêu cầu remote/công tác |
| `ATT.REMOTE_REQUEST.REJECT` | Từ chối yêu cầu remote/công tác |
| `ATT.REMOTE_REQUEST.CANCEL_OWN` | Employee hủy remote request khi còn Pending |
| `ATT.AUDIT_LOG.VIEW` | Xem lịch sử thao tác ATT |

---

## 7. Dữ liệu nhạy cảm và field masking

### 7.1 Nhóm dữ liệu ATT nhạy cảm

Các dữ liệu sau được xem là nhạy cảm:

```text
gps_latitude
gps_longitude
ip_address
user_agent
device_id
device_name
photo_file_id
proof_file_id
adjustment_reason
remote_note
late/absent history
export file chứa dữ liệu chấm công
```

---

### 7.2 Nguyên tắc trả dữ liệu nhạy cảm

1. API list bảng công không trả GPS/IP/device chi tiết mặc định.
2. API chi tiết chỉ trả GPS/IP/device nếu user có `ATT.ATTENDANCE.VIEW_DETAIL` và `ATT.ATTENDANCE.VIEW_SENSITIVE` hoặc cấu hình cho phép.
3. Employee có thể xem trạng thái hợp lệ/không hợp lệ của GPS của chính mình, nhưng không nhất thiết thấy tọa độ chi tiết.
4. Manager chỉ xem dữ liệu nhạy cảm của nhân viên thuộc scope nếu có quyền.
5. HR/Admin export dữ liệu có GPS/IP cần có `ATT.ATTENDANCE.EXPORT` và quyền sensitive nếu cấu hình tách riêng.
6. File ảnh hoặc bằng chứng phải qua file service private, không dùng public URL trực tiếp.
7. Hành động xem/tải dữ liệu nhạy cảm có thể ghi audit log nếu company setting bật.

---

### 7.3 Ví dụ masking

```json
{
  "ip_address": "113.***.***.25",
  "gps": {
    "is_valid": true,
    "latitude": null,
    "longitude": null,
    "masked": true
  },
  "device": {
    "device_type": "mobile",
    "device_name": "iPhone ***"
  }
}
```

---

## 8. DTO dùng chung

### 8.1 Employee summary DTO

Dùng lại chuẩn HR Employee Summary DTO.

```json
{
  "id": "employee-uuid",
  "employee_code": "EMP0001",
  "full_name": "Nguyễn Văn A",
  "department": {
    "id": "department-uuid",
    "name": "Phòng Kỹ thuật"
  },
  "position": {
    "id": "position-uuid",
    "name": "Developer"
  },
  "employment_status": "Official"
}
```

---

### 8.2 Shift summary DTO

```json
{
  "id": "shift-uuid",
  "shift_code": "OFFICE_8H",
  "name": "Ca hành chính",
  "shift_type": "Fixed",
  "start_time": "08:00",
  "end_time": "17:30",
  "break_minutes": 90,
  "required_working_minutes": 480,
  "timezone": "Asia/Ho_Chi_Minh"
}
```

---

### 8.3 Attendance today DTO

```json
{
  "work_date": "2026-06-20",
  "timezone": "Asia/Ho_Chi_Minh",
  "employee": {
    "id": "employee-uuid",
    "employee_code": "EMP0001",
    "full_name": "Nguyễn Văn A"
  },
  "attendance_record": {
    "id": "attendance-record-uuid",
    "status": "Checked-in",
    "attendance_status": "Late",
    "check_in_at": "2026-06-20T08:12:00+07:00",
    "check_out_at": null,
    "worked_minutes": 0,
    "required_working_minutes": 480,
    "late_minutes": 12,
    "early_leave_minutes": 0,
    "missing_minutes": 0,
    "attendance_source": "WEB"
  },
  "shift": {
    "id": "shift-uuid",
    "name": "Ca hành chính",
    "start_time": "08:00",
    "end_time": "17:30"
  },
  "rule": {
    "id": "rule-uuid",
    "name": "Rule công ty mặc định",
    "requires_gps": false,
    "requires_note": false,
    "allow_remote_check_in": true
  },
  "leave": {
    "has_approved_leave": false,
    "leave_type": null,
    "leave_period": null
  },
  "remote": {
    "has_approved_remote": false,
    "remote_request_id": null,
    "attendance_mode": null
  },
  "actions": {
    "can_check_in": false,
    "can_check_out": true,
    "can_create_adjustment_request": true,
    "can_create_remote_request": true,
    "disabled_reason": null
  }
}
```

Ghi chú enum (pin chuẩn):

* `leave.leave_period` ∈ `FULL_DAY` | `AM` | `PM` | `HOURLY` | `null` (khớp FE-09 today DTO).
* `remote.attendance_mode` ∈ `SELF_CHECK_IN` | `AUTO_ATTENDANCE` | `NO_ATTENDANCE` | `null`. Đây là field DTO `attendance_mode` map thẳng sang cột `remote_work_requests.attendance_mode` (DB-04 §7.8); không dùng tên `remote_mode`.

---

### 8.4 Attendance record DTO

```json
{
  "id": "attendance-record-uuid",
  "work_date": "2026-06-20",
  "employee": {
    "id": "employee-uuid",
    "employee_code": "EMP0001",
    "full_name": "Nguyễn Văn A"
  },
  "department": {
    "id": "department-uuid",
    "name": "Phòng Kỹ thuật"
  },
  "shift": {
    "id": "shift-uuid",
    "name": "Ca hành chính"
  },
  "check_in_at": "2026-06-20T08:12:00+07:00",
  "check_out_at": "2026-06-20T17:35:00+07:00",
  "worked_minutes": 473,
  "required_working_minutes": 480,
  "late_minutes": 12,
  "early_leave_minutes": 0,
  "missing_minutes": 7,
  "attendance_status": "Missing Hours",
  "attendance_source": "WEB",
  "is_adjusted": false,
  "has_pending_adjustment": false,
  "applied_rule_id": "rule-uuid",
  "calculation_snapshot": {
    "grace_late_minutes": 5,
    "break_minutes": 90
  },
  "created_at": "2026-06-20T08:12:00+07:00",
  "updated_at": "2026-06-20T17:35:00+07:00"
}
```

---

### 8.5 Attendance log DTO

```json
{
  "id": "attendance-log-uuid",
  "attendance_record_id": "attendance-record-uuid",
  "employee_id": "employee-uuid",
  "log_type": "Check-in",
  "log_time": "2026-06-20T08:12:00+07:00",
  "source": "WEB",
  "status": "VALID",
  "client_time": "2026-06-20T08:11:58+07:00",
  "client_timezone": "Asia/Ho_Chi_Minh",
  "note": "",
  "metadata": {
    "browser": "Chrome",
    "device_type": "desktop"
  },
  "created_at": "2026-06-20T08:12:00+07:00"
}
```

---

### 8.6 Attendance adjustment request DTO

```json
{
  "id": "adjustment-request-uuid",
  "request_code": "ATT-ADJ-2026-0001",
  "attendance_record_id": "attendance-record-uuid",
  "employee": {
    "id": "employee-uuid",
    "employee_code": "EMP0001",
    "full_name": "Nguyễn Văn A"
  },
  "request_type": "MISSING_CHECK_OUT",
  "status": "Pending",
  "reason": "Quên bấm check-out do họp muộn",
  "items": [
    {
      "field_name": "check_out_at",
      "old_value": null,
      "new_value": "2026-06-20T17:45:00+07:00"
    }
  ],
  "files": [],
  "submitted_at": "2026-06-20T18:00:00+07:00",
  "reviewed_by": null,
  "reviewed_at": null,
  "review_note": null
}
```

---

### 8.7 Remote work request DTO

```json
{
  "id": "remote-request-uuid",
  "request_code": "REMOTE-2026-0001",
  "employee": {
    "id": "employee-uuid",
    "employee_code": "EMP0001",
    "full_name": "Nguyễn Văn A"
  },
  "request_type": "Remote",
  "date_from": "2026-06-24",
  "date_to": "2026-06-24",
  "time_from": null,
  "time_to": null,
  "attendance_mode": "SELF_CHECK_IN",
  "reason": "Làm việc tại nhà do lịch cá nhân",
  "status": "Pending",
  "task_id": null,
  "project_id": null,
  "submitted_at": "2026-06-20T10:00:00+07:00",
  "reviewed_by": null,
  "reviewed_at": null,
  "review_note": null
}
```

---

### 8.8 Attendance rule DTO

```json
{
  "id": "rule-uuid",
  "rule_code": "DEFAULT_COMPANY_RULE",
  "name": "Rule công ty mặc định",
  "scope_type": "Company",
  "scope_id": null,
  "priority": 100,
  "requires_check_in": true,
  "requires_check_out": true,
  "grace_late_minutes": 5,
  "grace_early_leave_minutes": 5,
  "minimum_working_minutes": 480,
  "requires_gps": false,
  "requires_note": false,
  "allow_remote_check_in": true,
  "allow_auto_attendance": false,
  "allow_weekend_attendance": false,
  "allow_holiday_attendance": false,
  "status": "Active"
}
```

---

## 9. Query params chuẩn

### 9.1 Pagination

Các API list dùng offset pagination:

| Param | Mặc định | Giới hạn | Mô tả |
| --- | ---: | ---: | --- |
| `page` | 1 | >= 1 | Trang hiện tại |
| `per_page` | 20 | 1 - 100 | Số bản ghi mỗi trang |

Các API log lớn có thể dùng cursor pagination:

| Param | Mặc định | Giới hạn | Mô tả |
| --- | ---: | ---: | --- |
| `cursor` | null | - | Cursor trang tiếp theo |
| `limit` | 20 | 1 - 100 | Số bản ghi |

---

### 9.2 Search

```http
GET /api/v1/attendance/records?search=nguyen
```

Search whitelist:

```text
employee_code
employee_full_name
company_email nếu join HR cho phép
request_code đối với adjustment/remote request
shift_code/name đối với shift
rule_code/name đối với rule
```

---

### 9.3 Sort

Format:

```http
GET /api/v1/attendance/records?sort=work_date:desc
```

Sort whitelist cho attendance records:

```text
work_date
check_in_at
check_out_at
late_minutes
early_leave_minutes
missing_minutes
worked_minutes
created_at
updated_at
```

Mặc định:

```text
work_date:desc
```

Nếu sort field không hợp lệ, trả `VALIDATION-ERR-001`.

---

### 9.4 Filter attendance records

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `from_date` | Date | Từ ngày làm việc |
| `to_date` | Date | Đến ngày làm việc |
| `employee_id` | UUID | Lọc theo nhân viên, chỉ dùng nếu scope cho phép |
| `department_id` | UUID | Lọc theo phòng ban |
| `shift_id` | UUID | Lọc theo ca làm |
| `attendance_status` | String | Present/Late/Early Leave/Missing Hours/Absent/Leave/Remote Work/Adjusted... |
| `source` | String | WEB/MOBILE/MANUAL/AUTO/REMOTE/DEVICE/IMPORT/API |
| `has_pending_adjustment` | Boolean | Có request điều chỉnh đang chờ |
| `is_adjusted` | Boolean | Đã từng điều chỉnh |
| `include_logs` | Boolean | Chỉ endpoint chi tiết hoặc quyền detail mới cho phép |

---

### 9.5 Filter adjustment requests

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `status` | String | Draft/Pending/Approved/Rejected/Cancelled |
| `request_type` | String | MISSING_CHECK_IN/MISSING_CHECK_OUT/UPDATE_CHECK_IN/UPDATE_CHECK_OUT/EXPLAIN_LATE/EXPLAIN_EARLY_LEAVE/UPDATE_STATUS/REMOTE_CORRECTION/OTHER |
| `employee_id` | UUID | Lọc theo nhân viên nếu scope cho phép |
| `department_id` | UUID | Lọc theo phòng ban |
| `from_date` | Date | Từ ngày công |
| `to_date` | Date | Đến ngày công |
| `submitted_from` | DateTime | Từ thời điểm gửi |
| `submitted_to` | DateTime | Đến thời điểm gửi |

---

### 9.6 Filter remote requests

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `status` | String | Draft/Pending/Approved/Rejected/Cancelled |
| `request_type` | String | Remote/BusinessTrip/Offsite |
| `employee_id` | UUID | Lọc theo nhân viên nếu scope cho phép |
| `department_id` | UUID | Lọc theo phòng ban |
| `date_from` | Date | Từ ngày remote |
| `date_to` | Date | Đến ngày remote |

---

## 10. Danh sách endpoint tổng quan

### 10.1 Today Attendance API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| ATT-API-001 | GET | `/api/v1/attendance/today` | Lấy trạng thái chấm công hôm nay của tôi | `ATT.ATTENDANCE.VIEW_OWN` |
| ATT-API-002 | POST | `/api/v1/attendance/check-in` | Check-in cho chính mình | `ATT.ATTENDANCE.CHECK_IN` |
| ATT-API-003 | POST | `/api/v1/attendance/check-out` | Check-out cho chính mình | `ATT.ATTENDANCE.CHECK_OUT` |

---

### 10.2 Attendance Record API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| ATT-API-101 | GET | `/api/v1/attendance/my-records` | Bảng công cá nhân | `ATT.ATTENDANCE.VIEW_OWN` |
| ATT-API-102 | GET | `/api/v1/attendance/team-records` | Bảng công team | `ATT.ATTENDANCE.VIEW_TEAM` |
| ATT-API-103 | GET | `/api/v1/attendance/records` | Bảng công theo scope Company/Department/System | `ATT.ATTENDANCE.VIEW_COMPANY` hoặc scope tương ứng |
| ATT-API-104 | GET | `/api/v1/attendance/records/{attendance_record_id}` | Chi tiết bản ghi công | `ATT.ATTENDANCE.VIEW_DETAIL` |
| ATT-API-105 | GET | `/api/v1/attendance/records/{attendance_record_id}/logs` | Log thô của bản ghi công | `ATT.ATTENDANCE.VIEW_DETAIL` |
| ATT-API-106 | POST | `/api/v1/attendance/records/{attendance_record_id}/manual-adjust` | HR/Admin điều chỉnh công trực tiếp | `ATT.ATTENDANCE.ADJUST_DIRECT` |
| ATT-API-107 | POST | `/api/v1/attendance/records/{attendance_record_id}/recalculate` | Tính lại một bản ghi công | `ATT.ATTENDANCE.RECALCULATE` |
| ATT-API-108 | POST | `/api/v1/attendance/exports` | Tạo file export bảng công | `ATT.ATTENDANCE.EXPORT` |

---

### 10.3 Attendance Adjustment Request API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| ATT-API-201 | GET | `/api/v1/attendance/my-adjustment-requests` | Yêu cầu điều chỉnh của tôi | `ATT.ADJUSTMENT.VIEW_OWN` |
| ATT-API-202 | POST | `/api/v1/attendance/adjustment-requests` | Employee gửi yêu cầu điều chỉnh công | `ATT.ADJUSTMENT.CREATE_OWN` |
| ATT-API-203 | GET | `/api/v1/attendance/adjustment-requests` | Danh sách yêu cầu điều chỉnh theo scope | `ATT.ADJUSTMENT.VIEW_TEAM` hoặc `ATT.ADJUSTMENT.VIEW_COMPANY` |
| ATT-API-204 | GET | `/api/v1/attendance/adjustment-requests/{request_id}` | Chi tiết yêu cầu điều chỉnh | Permission xem tương ứng |
| ATT-API-205 | POST | `/api/v1/attendance/adjustment-requests/{request_id}/approve` | Duyệt yêu cầu điều chỉnh | `ATT.ADJUSTMENT.APPROVE` |
| ATT-API-206 | POST | `/api/v1/attendance/adjustment-requests/{request_id}/reject` | Từ chối yêu cầu điều chỉnh | `ATT.ADJUSTMENT.REJECT` |
| ATT-API-207 | POST | `/api/v1/attendance/adjustment-requests/{request_id}/cancel` | Employee hủy yêu cầu của mình | `ATT.ADJUSTMENT.CANCEL_OWN` |

---

### 10.4 Remote Work Request API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| ATT-API-301 | GET | `/api/v1/attendance/my-remote-requests` | Remote/công tác của tôi | `ATT.REMOTE_REQUEST.VIEW_OWN` |
| ATT-API-302 | POST | `/api/v1/attendance/remote-requests` | Employee gửi remote/công tác | `ATT.REMOTE_REQUEST.CREATE_OWN` |
| ATT-API-303 | GET | `/api/v1/attendance/remote-requests` | Danh sách remote/công tác theo scope | `ATT.REMOTE_REQUEST.VIEW_TEAM` hoặc `ATT.REMOTE_REQUEST.VIEW_COMPANY` |
| ATT-API-304 | GET | `/api/v1/attendance/remote-requests/{request_id}` | Chi tiết remote/công tác | Permission xem tương ứng |
| ATT-API-305 | POST | `/api/v1/attendance/remote-requests/{request_id}/approve` | Duyệt remote/công tác | `ATT.REMOTE_REQUEST.APPROVE` |
| ATT-API-306 | POST | `/api/v1/attendance/remote-requests/{request_id}/reject` | Từ chối remote/công tác | `ATT.REMOTE_REQUEST.REJECT` |
| ATT-API-307 | POST | `/api/v1/attendance/remote-requests/{request_id}/cancel` | Employee hủy remote/công tác của mình | `ATT.REMOTE_REQUEST.CANCEL_OWN` |

---

### 10.5 Shift API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| ATT-API-401 | GET | `/api/v1/attendance/shifts` | Danh sách ca làm | `ATT.SHIFT.VIEW` |
| ATT-API-402 | POST | `/api/v1/attendance/shifts` | Tạo ca làm | `ATT.SHIFT.CREATE` |
| ATT-API-403 | GET | `/api/v1/attendance/shifts/{shift_id}` | Chi tiết ca làm | `ATT.SHIFT.VIEW` |
| ATT-API-404 | PATCH | `/api/v1/attendance/shifts/{shift_id}` | Cập nhật ca làm | `ATT.SHIFT.UPDATE` |
| ATT-API-405 | DELETE | `/api/v1/attendance/shifts/{shift_id}` | Xóa mềm/vô hiệu hóa ca làm | `ATT.SHIFT.DELETE` |

---

### 10.6 Shift Assignment API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| ATT-API-501 | GET | `/api/v1/attendance/shift-assignments` | Danh sách gán ca | `ATT.SHIFT_ASSIGNMENT.VIEW` |
| ATT-API-502 | POST | `/api/v1/attendance/shift-assignments` | Tạo gán ca | `ATT.SHIFT_ASSIGNMENT.UPDATE` |
| ATT-API-503 | GET | `/api/v1/attendance/shift-assignments/{assignment_id}` | Chi tiết gán ca | `ATT.SHIFT_ASSIGNMENT.VIEW` |
| ATT-API-504 | PATCH | `/api/v1/attendance/shift-assignments/{assignment_id}` | Cập nhật gán ca | `ATT.SHIFT_ASSIGNMENT.UPDATE` |
| ATT-API-505 | DELETE | `/api/v1/attendance/shift-assignments/{assignment_id}` | Hủy/xóa mềm gán ca | `ATT.SHIFT_ASSIGNMENT.UPDATE` |

---

### 10.7 Attendance Rule API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| ATT-API-601 | GET | `/api/v1/attendance/rules` | Danh sách rule chấm công | `ATT.RULE.VIEW` |
| ATT-API-602 | POST | `/api/v1/attendance/rules` | Tạo rule chấm công | `ATT.RULE.CONFIG` |
| ATT-API-603 | GET | `/api/v1/attendance/rules/{rule_id}` | Chi tiết rule chấm công | `ATT.RULE.VIEW` |
| ATT-API-604 | PATCH | `/api/v1/attendance/rules/{rule_id}` | Cập nhật rule chấm công | `ATT.RULE.CONFIG` |
| ATT-API-605 | DELETE | `/api/v1/attendance/rules/{rule_id}` | Xóa mềm/vô hiệu hóa rule | `ATT.RULE.CONFIG` |
| ATT-API-606 | GET | `/api/v1/attendance/effective-rule` | Xem rule hiệu lực của bản thân hoặc employee theo quyền | `ATT.RULE.VIEW` |

---

### 10.8 Audit/Log/Internal API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| ATT-API-701 | GET | `/api/v1/attendance/audit-logs` | Xem audit log ATT | `ATT.AUDIT_LOG.VIEW` |
| ATT-API-702 | GET | `/api/v1/attendance/logs` | Xem log thô chấm công theo scope | `ATT.ATTENDANCE.VIEW_DETAIL` |
| ATT-API-801 | POST | `/internal/v1/attendance/recalculate` | Internal tính lại công theo event | Internal service token |
| ATT-API-802 | POST | `/internal/v1/attendance/auto-attendance-job` | Internal job tự động chấm công | Internal service token |
| ATT-API-803 | POST | `/internal/v1/attendance/missing-checkout-job` | Internal job cảnh báo thiếu check-out | Internal service token |

---

## 11. Chi tiết API nghiệp vụ chính

## 11.1 ATT-API-001: Lấy trạng thái chấm công hôm nay

| Trường | Nội dung |
| --- | --- |
| Method | GET |
| Endpoint | `/api/v1/attendance/today` |
| Required permission | `ATT.ATTENDANCE.VIEW_OWN` |
| Allowed roles | Employee, Manager, HR, Admin công ty, Super Admin |
| Data scope | Own |
| Auth | Bắt buộc |
| Audit log | Không bắt buộc, có thể log access nếu cấu hình |
| Notification event | Không |
| Cache | Không cache hoặc cache rất ngắn 5-15 giây |

### Query params

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `date` | Date | Không | Ngày cần xem, mặc định hôm nay theo timezone công ty |

### Business validation

1. User phải liên kết với một employee active/probation.
2. Employee không được ở trạng thái Resigned/Terminated.
3. Backend xác định work date theo timezone công ty.
4. Backend kiểm tra ca hiệu lực, rule hiệu lực, leave Approved, remote Approved.
5. Nếu có leave full day Approved, trả `actions.can_check_in = false`, `actions.can_check_out = false`.
6. Nếu employee thuộc rule auto attendance, trả trạng thái tương ứng và disable nút thủ công nếu rule yêu cầu.

### Response mẫu

```json
{
  "success": true,
  "message": "Lấy trạng thái chấm công hôm nay thành công",
  "data": {
    "work_date": "2026-06-20",
    "timezone": "Asia/Ho_Chi_Minh",
    "attendance_record": null,
    "shift": {
      "id": "shift-uuid",
      "name": "Ca hành chính",
      "start_time": "08:00",
      "end_time": "17:30"
    },
    "actions": {
      "can_check_in": true,
      "can_check_out": false,
      "can_create_adjustment_request": true,
      "can_create_remote_request": true,
      "disabled_reason": null
    }
  },
  "meta": {
    "request_id": "req_20260620_000001",
    "timestamp": "2026-06-20T07:50:00+07:00"
  }
}
```

---

## 11.2 ATT-API-002: Check-in

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/attendance/check-in` |
| Required permission | `ATT.ATTENDANCE.CHECK_IN` |
| Allowed roles | Employee, Manager, HR, Admin công ty, Super Admin |
| Data scope | Own |
| Auth | Bắt buộc |
| Idempotency | Bắt buộc khuyến nghị qua `Idempotency-Key` |
| Audit log | Có thể bật theo company setting; luôn ghi `attendance_logs` |
| Notification event | Không có event self check-in; `ATT_LATE_DETECTED` nếu bật cảnh báo đi muộn |
| Transaction | Bắt buộc |

### Header

```http
Idempotency-Key: 1a8b8e7b-8d4a-4d6c-9f8b-22f7e2d11111
X-Client-Type: web
X-Client-Version: 1.0.0
```

### Request body

```json
{
  "source": "WEB",
  "note": "",
  "client_time": "2026-06-20T08:01:58+07:00",
  "client_timezone": "Asia/Ho_Chi_Minh",
  "gps": {
    "latitude": 10.7769,
    "longitude": 106.7009,
    "accuracy_meters": 30
  },
  "device": {
    "device_id": "web-browser-fingerprint",
    "device_type": "desktop",
    "device_name": "Chrome on Windows"
  }
}
```

### Business validation

1. Backend resolve employee từ user hiện tại.
2. Employee phải có trạng thái được phép chấm công: `Official`, `Probation` hoặc trạng thái được cấu hình.
3. Backend dùng server time làm `check_in_at`; `client_time` chỉ lưu tham khảo.
4. Backend xác định `work_date` theo timezone công ty.
5. Backend kiểm tra public holiday/non-working day theo rule.
6. Backend kiểm tra leave Approved trong ngày:
   - Full day leave: chặn check-in.
   - Half day/hourly leave: áp dụng rule giảm required minutes hoặc block theo khung giờ.
7. Backend kiểm tra remote Approved nếu check-in ngoài văn phòng.
8. Backend kiểm tra shift/rule hiệu lực theo thứ tự Employee -> Department -> Company -> Default.
9. Nếu rule yêu cầu GPS, request phải có GPS hợp lệ.
10. Nếu rule yêu cầu note, request phải có note.
11. Nếu đã check-in hợp lệ rồi, không tạo record trùng; trả lỗi hoặc trả lại record cũ theo idempotency.
12. Tạo hoặc cập nhật `attendance_records`.
13. Luôn tạo `attendance_logs` loại `CHECK_IN`.
14. Tính `late_minutes`, `attendance_status`, `required_working_minutes` và lưu `calculation_snapshot`.

### Response mẫu

```json
{
  "success": true,
  "message": "Check-in thành công",
  "data": {
    "attendance_record_id": "attendance-record-uuid",
    "work_date": "2026-06-20",
    "check_in_at": "2026-06-20T08:02:05+07:00",
    "attendance_status": "Late",
    "late_minutes": 2,
    "source": "WEB",
    "next_action": "CHECK_OUT"
  },
  "meta": {
    "request_id": "req_20260620_000002",
    "timestamp": "2026-06-20T08:02:05+07:00"
  }
}
```

---

## 11.3 ATT-API-003: Check-out

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/attendance/check-out` |
| Required permission | `ATT.ATTENDANCE.CHECK_OUT` |
| Allowed roles | Employee, Manager, HR, Admin công ty, Super Admin |
| Data scope | Own |
| Auth | Bắt buộc |
| Idempotency | Bắt buộc khuyến nghị |
| Audit log | Có thể bật theo company setting; luôn ghi `attendance_logs` |
| Notification event | Không có event self check-out (về sớm không có event NOTI chuẩn) |
| Transaction | Bắt buộc |

### Request body

```json
{
  "source": "WEB",
  "note": "",
  "client_time": "2026-06-20T17:31:00+07:00",
  "client_timezone": "Asia/Ho_Chi_Minh",
  "gps": {
    "latitude": 10.7769,
    "longitude": 106.7009,
    "accuracy_meters": 25
  },
  "device": {
    "device_id": "web-browser-fingerprint",
    "device_type": "desktop",
    "device_name": "Chrome on Windows"
  }
}
```

### Business validation

1. Employee phải có record ngày/ca đang check-in.
2. Nếu chưa check-in, tùy rule:
   - Chặn và yêu cầu tạo adjustment request.
   - Hoặc tạo log `CHECK_OUT` invalid để truy vết.
3. Backend dùng server time làm `check_out_at`.
4. `check_out_at` phải sau `check_in_at`.
5. Nếu đã check-out, không update trùng; xử lý theo idempotency.
6. Kiểm tra rule GPS/note tương tự check-in.
7. Tính `worked_minutes`, `early_leave_minutes`, `missing_minutes`, `attendance_status`.
8. Luôn ghi `attendance_logs` loại `CHECK_OUT`.
9. Nếu thiếu giờ hoặc về sớm, phát event nếu company bật cảnh báo.

### Response mẫu

```json
{
  "success": true,
  "message": "Check-out thành công",
  "data": {
    "attendance_record_id": "attendance-record-uuid",
    "work_date": "2026-06-20",
    "check_in_at": "2026-06-20T08:02:05+07:00",
    "check_out_at": "2026-06-20T17:31:05+07:00",
    "worked_minutes": 479,
    "required_working_minutes": 480,
    "missing_minutes": 1,
    "attendance_status": "Present"
  },
  "meta": {
    "request_id": "req_20260620_000003",
    "timestamp": "2026-06-20T17:31:05+07:00"
  }
}
```

---

## 11.4 ATT-API-101: Lấy bảng công cá nhân

| Trường | Nội dung |
| --- | --- |
| Method | GET |
| Endpoint | `/api/v1/attendance/my-records` |
| Required permission | `ATT.ATTENDANCE.VIEW_OWN` |
| Allowed roles | Employee, Manager, HR, Admin công ty, Super Admin |
| Data scope | Own |
| Audit log | Không bắt buộc |
| Cache | Có thể cache ngắn 30-60 giây nếu không phải ngày hiện tại |

### Query params

```http
GET /api/v1/attendance/my-records?from_date=2026-06-01&to_date=2026-06-30&page=1&per_page=20
```

### Business validation

1. Backend resolve employee hiện tại từ auth context.
2. Không cho truyền `employee_id` để xem người khác qua endpoint này.
3. `from_date` và `to_date` không vượt quá giới hạn range cấu hình, ví dụ tối đa 12 tháng/lần query.
4. Không trả GPS/IP/device chi tiết trong list.

---

## 11.5 ATT-API-103: Lấy bảng công toàn công ty/theo scope

| Trường | Nội dung |
| --- | --- |
| Method | GET |
| Endpoint | `/api/v1/attendance/records` |
| Required permission | `ATT.ATTENDANCE.VIEW_COMPANY` hoặc permission tương ứng với scope |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Department, Company, System |
| Audit log | Không bắt buộc; có thể log nếu xem dữ liệu nhạy cảm |
| Cache | Không cache hoặc cache ngắn theo dashboard/report |

### Query params

```http
GET /api/v1/attendance/records?from_date=2026-06-01&to_date=2026-06-30&department_id=dep-uuid&attendance_status=Late&page=1&per_page=50
```

### Business validation

1. Backend kiểm tra permission và data scope.
2. Nếu scope Department, chỉ cho filter/xem phòng ban được phân quyền.
3. Nếu scope Company, chỉ dữ liệu trong company hiện tại.
4. Không trả dữ liệu sensitive mặc định.
5. Nếu query range quá lớn, yêu cầu export hoặc giới hạn `per_page`.

---

## 11.6 ATT-API-106: HR/Admin điều chỉnh công trực tiếp

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/attendance/records/{attendance_record_id}/manual-adjust` |
| Required permission | `ATT.ATTENDANCE.ADJUST_DIRECT` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Team, Department, Company, System tùy quyền |
| Idempotency | Bắt buộc khuyến nghị |
| Audit log | Bắt buộc |
| Notification event | Không có event NOTI chuẩn cho manual-adjust (thông báo nội bộ/audit nếu bật) |
| Transaction | Bắt buộc |

### Request body

```json
{
  "check_in_at": "2026-06-20T08:00:00+07:00",
  "check_out_at": "2026-06-20T17:30:00+07:00",
  "attendance_status": "Present",
  "reason": "HR điều chỉnh theo xác nhận của quản lý",
  "recalculate": true,
  "version": "2026-06-20T17:35:00+07:00"
}
```

### Business validation

1. Record phải tồn tại trong company hiện tại và nằm trong data scope.
2. Không cho điều chỉnh nếu kỳ công đã khóa.
3. Không cho điều chỉnh nếu record đã bị ảnh hưởng bởi leave full day Approved mà không có quyền override đặc biệt.
4. `check_out_at` phải sau `check_in_at` nếu cả hai cùng tồn tại.
5. Phải có `reason`.
6. Kiểm tra optimistic lock bằng `version`/`updated_at` để tránh ghi đè dữ liệu mới.
7. Cập nhật `attendance_records`, ghi `attendance_logs` loại `Manual`, ghi `audit_logs`.
8. Phát notification cho employee nếu cấu hình bật.

---

## 11.7 ATT-API-202: Employee gửi yêu cầu điều chỉnh công

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/attendance/adjustment-requests` |
| Required permission | `ATT.ADJUSTMENT.CREATE_OWN` |
| Allowed roles | Employee, Manager, HR, Admin công ty |
| Data scope | Own |
| Idempotency | Bắt buộc khuyến nghị |
| Audit log | Bắt buộc |
| Notification event | `ATT_ADJUSTMENT_SUBMITTED` |
| Transaction | Bắt buộc |

### Request body

```json
{
  "attendance_record_id": "attendance-record-uuid",
  "request_type": "MISSING_CHECK_OUT",
  "reason": "Quên check-out do họp khách hàng",
  "items": [
    {
      "field_name": "check_out_at",
      "new_value": "2026-06-20T17:45:00+07:00"
    }
  ],
  "file_ids": ["file-uuid-1"]
}
```

### Business validation

1. Employee chỉ được tạo request cho record của chính mình.
2. Record phải thuộc company hiện tại.
3. Không cho tạo request nếu kỳ công đã khóa.
4. Không cho tạo nhiều request Pending cho cùng một record và cùng field nếu cấu hình không cho phép.
5. `reason` bắt buộc.
6. Field được điều chỉnh phải nằm trong whitelist employee-submittable (DB-04 §7.7): `check_in_at`, `check_out_at`, `attendance_status`, `note`, `work_mode`. KHÔNG cho employee đề xuất `source` (system-only) và `working_minutes` (HR/Admin-only manual adjust).
7. Nếu request cần file bằng chứng theo rule, `file_ids` bắt buộc và file phải thuộc user/company hiện tại.
8. Tạo `attendance_adjustment_requests`, `attendance_adjustment_items`, link file nếu có.
9. Gửi notification cho direct manager hoặc HR theo approval rule.

### Response mẫu

```json
{
  "success": true,
  "message": "Gửi yêu cầu điều chỉnh công thành công",
  "data": {
    "id": "adjustment-request-uuid",
    "request_code": "ATT-ADJ-2026-0001",
    "status": "Pending",
    "submitted_at": "2026-06-20T18:00:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000004",
    "timestamp": "2026-06-20T18:00:00+07:00"
  }
}
```

---

## 11.8 ATT-API-205: Duyệt yêu cầu điều chỉnh công

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/attendance/adjustment-requests/{request_id}/approve` |
| Required permission | `ATT.ADJUSTMENT.APPROVE` |
| Allowed roles | Manager, HR, Admin công ty, Super Admin |
| Data scope | Team, Department, Company, System |
| Idempotency | Bắt buộc khuyến nghị |
| Audit log | Bắt buộc |
| Notification event | `ATT_ADJUSTMENT_APPROVED` |
| Transaction | Bắt buộc |

### Request body

```json
{
  "review_note": "Đã xác nhận với quản lý trực tiếp",
  "version": "2026-06-20T18:00:00+07:00"
}
```

### Business validation

1. Request phải tồn tại, thuộc company hiện tại và nằm trong data scope.
2. Request phải ở trạng thái `Pending`.
3. Nếu approver là Manager, employee của request phải thuộc team.
4. Nếu approver là HR/Admin, phải có scope Company hoặc scope phù hợp.
5. Kiểm tra optimistic lock để tránh duyệt dữ liệu đã thay đổi.
6. Lock request và attendance record trong transaction.
7. Apply các adjustment items vào `attendance_records`.
8. Recalculate `worked_minutes`, `late_minutes`, `early_leave_minutes`, `missing_minutes`, `attendance_status` nếu cần.
9. Ghi `attendance_logs` loại `Adjustment` (giá trị mới được bổ sung vào DB-04 CHECK).
10. Ghi audit log.
11. Phát notification cho employee.

---

## 11.9 ATT-API-302: Employee gửi yêu cầu remote/công tác

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/attendance/remote-requests` |
| Required permission | `ATT.REMOTE_REQUEST.CREATE_OWN` |
| Allowed roles | Employee, Manager, HR, Admin công ty |
| Data scope | Own |
| Idempotency | Bắt buộc khuyến nghị |
| Audit log | Bắt buộc |
| Notification event | `ATT_REMOTE_REQUEST_SUBMITTED` |
| Transaction | Bắt buộc |

### Request body

```json
{
  "request_type": "Remote",
  "date_from": "2026-06-24",
  "date_to": "2026-06-24",
  "time_from": null,
  "time_to": null,
  "attendance_mode": "SELF_CHECK_IN",
  "reason": "Làm việc tại nhà",
  "task_id": null,
  "project_id": null,
  "file_ids": []
}
```

### Business validation

1. Employee chỉ tạo remote request cho chính mình.
2. Company setting phải bật remote/công tác.
3. `date_from <= date_to`.
4. Không cho tạo request trùng với leave full day Approved.
5. Nếu trùng leave half day/hourly, backend áp dụng rule hoặc trả cảnh báo theo cấu hình.
6. Không cho trùng với remote request Pending/Approved cùng thời gian nếu policy không cho phép.
7. Nếu rule remote yêu cầu task/project, phải truyền `task_id`/`project_id` hợp lệ và user có quyền nhìn task/project đó.
8. Nếu rule yêu cầu bằng chứng, phải có `file_ids`.
9. Tạo request trạng thái `Pending`, tạo approval log ban đầu nếu cần.
10. Gửi notification cho approver.

---

## 11.10 ATT-API-305: Duyệt remote/công tác

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/attendance/remote-requests/{request_id}/approve` |
| Required permission | `ATT.REMOTE_REQUEST.APPROVE` |
| Allowed roles | Manager, HR, Admin công ty, Super Admin |
| Data scope | Team, Department, Company, System |
| Idempotency | Bắt buộc khuyến nghị |
| Audit log | Bắt buộc |
| Notification event | `ATT_REMOTE_REQUEST_APPROVED` |
| Transaction | Bắt buộc |

### Request body

```json
{
  "review_note": "Đồng ý làm remote",
  "auto_create_attendance": false,
  "version": "2026-06-20T10:00:00+07:00"
}
```

### Business validation

1. Request phải ở trạng thái `Pending`.
2. Target employee phải nằm trong data scope của approver.
3. Không duyệt nếu đã có leave full day Approved trùng ngày.
4. Nếu `auto_create_attendance = true`, rule remote phải cho phép auto attendance.
5. Nếu tạo attendance tự động, backend tạo hoặc cập nhật `attendance_records` với `attendance_source = REMOTE` hoặc `AUTO` theo rule.
6. Ghi `remote_work_request_approvals`.
7. Ghi audit log.
8. Phát notification cho employee.

---

## 11.11 ATT-API-401: Tạo ca làm việc

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/attendance/shifts` |
| Required permission | `ATT.SHIFT.CREATE` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Company/System |
| Idempotency | Khuyến nghị nếu tạo từ UI có retry |
| Audit log | Bắt buộc |
| Notification event | Không mặc định |

### Request body

```json
{
  "shift_code": "OFFICE_8H",
  "name": "Ca hành chính",
  "description": "Ca làm việc văn phòng",
  "shift_type": "Fixed",
  "start_time": "08:00",
  "end_time": "17:30",
  "break_start_time": "12:00",
  "break_end_time": "13:30",
  "break_minutes": 90,
  "required_working_minutes": 480,
  "allow_flexible_start": false,
  "flexible_start_from": null,
  "flexible_start_to": null,
  "status": "Active"
}
```

### Business validation

1. `shift_code` unique trong company.
2. `start_time < end_time` với ca trong ngày; nếu hỗ trợ ca qua đêm, phải có flag riêng.
3. `required_working_minutes > 0`.
4. Nếu `shift_type = Flexible`, phải có cấu hình flexible hợp lệ.
5. Không cho xóa/cập nhật gây sai dữ liệu quá khứ nếu đã có attendance record; thay vào đó update effective range hoặc tạo shift mới.
6. Ghi audit log.

---

## 11.12 ATT-API-502: Tạo gán ca

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/attendance/shift-assignments` |
| Required permission | `ATT.SHIFT_ASSIGNMENT.UPDATE` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Company/System |
| Idempotency | Khuyến nghị |
| Audit log | Bắt buộc |

### Request body

```json
{
  "shift_id": "shift-uuid",
  "assignment_scope": "Department",
  "department_id": "department-uuid",
  "employee_id": null,
  "effective_from": "2026-07-01",
  "effective_to": null,
  "priority": 200,
  "status": "Active"
}
```

### Business validation

1. `shift_id` phải thuộc company hiện tại.
2. `assignment_scope` chỉ nhận `Company`, `Department`, `Employee` trong MVP.
3. Nếu scope `Company`, không truyền `department_id`, `employee_id`.
4. Nếu scope `Department`, `department_id` bắt buộc và thuộc company.
5. Nếu scope `Employee`, `employee_id` bắt buộc và thuộc company.
6. Không tạo assignment active bị overlap theo cùng scope nếu policy không cho phép.
7. Ưu tiên hiệu lực: Employee -> Department -> Company.
8. Ghi audit log.

---

## 11.13 ATT-API-602: Tạo rule chấm công

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/attendance/rules` |
| Required permission | `ATT.RULE.CONFIG` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Company/System |
| Idempotency | Khuyến nghị |
| Audit log | Bắt buộc |
| Notification event | Không mặc định |

### Request body

```json
{
  "rule_code": "DEFAULT_COMPANY_RULE",
  "name": "Rule công ty mặc định",
  "scope_type": "Company",
  "scope_id": null,
  "priority": 100,
  "requires_check_in": true,
  "requires_check_out": true,
  "grace_late_minutes": 5,
  "grace_early_leave_minutes": 5,
  "minimum_working_minutes": 480,
  "requires_gps": false,
  "requires_note": false,
  "allow_remote_check_in": true,
  "allow_auto_attendance": false,
  "allow_weekend_attendance": false,
  "allow_holiday_attendance": false,
  "status": "Active"
}
```

### Business validation

1. `rule_code` unique trong company.
2. `scope_type` chỉ nhận `Company`, `Department`, `Employee` trong MVP.
3. Nếu scope `Department`, `scope_id` phải là department thuộc company.
4. Nếu scope `Employee`, `scope_id` phải là employee thuộc company.
5. Không cho nhiều rule active trùng scope/effective time nếu policy không cho phép.
6. `grace_late_minutes`, `minimum_working_minutes` phải >= 0.
7. Nếu bật `allow_auto_attendance`, cần cấu hình rõ nguồn và điều kiện để tránh tự tạo công sai.
8. Rule thay đổi không tự sửa dữ liệu quá khứ; dữ liệu quá khứ dùng `calculation_snapshot` đã lưu. Nếu cần, gọi API recalculate có kiểm soát.
9. Ghi audit log.

---

## 11.14 ATT-API-108: Tạo export bảng công

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/attendance/exports` |
| Required permission | `ATT.ATTENDANCE.EXPORT` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Department, Company, System |
| Idempotency | Khuyến nghị |
| Audit log | Bắt buộc |
| Notification event | Không có event NOTI chuẩn cho export; thông báo file sẵn sàng đi qua kênh nội bộ nếu export async |
| Transaction | Không bắt buộc toàn bộ; nên chạy job nếu dữ liệu lớn |

### Request body

```json
{
  "from_date": "2026-06-01",
  "to_date": "2026-06-30",
  "department_id": "department-uuid",
  "employee_ids": [],
  "attendance_status": ["Late", "Missing Hours"],
  "format": "xlsx",
  "include_logs": false,
  "include_sensitive_fields": false
}
```

### Business validation

1. User phải có `ATT.ATTENDANCE.EXPORT`.
2. Nếu `include_sensitive_fields = true`, cần `ATT.ATTENDANCE.VIEW_SENSITIVE` hoặc permission export sensitive riêng nếu bổ sung.
3. Filter phải nằm trong data scope.
4. Range ngày không vượt quá giới hạn export đồng bộ. Nếu vượt, tạo async job.
5. File export lưu qua file service private.
6. Ghi audit log gồm filter, số dòng, format, include_sensitive_fields.
7. Không trả storage path thật; chỉ trả file metadata hoặc signed download URL qua file service.

### Response mẫu

```json
{
  "success": true,
  "message": "Tạo yêu cầu xuất bảng công thành công",
  "data": {
    "export_id": "export-job-uuid",
    "status": "Processing",
    "file": null
  },
  "meta": {
    "request_id": "req_20260620_000005",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

## 12. State machine

### 12.1 Attendance record status

| Status | Ý nghĩa |
| --- | --- |
| `Not Checked-in` | Chưa có check-in trong ngày/ca |
| `Checked-in` | Đã check-in, chưa check-out |
| `Checked-out` | Đã check-in và check-out |
| `Present` | Có đi làm hợp lệ |
| `Late` | Đi muộn |
| `Early Leave` | Về sớm |
| `Missing Hours` | Thiếu giờ làm |
| `Missing Check-in` | Thiếu check-in |
| `Missing Check-out` | Thiếu check-out |
| `Absent` | Vắng mặt |
| `Leave` | Nghỉ phép Approved |
| `Remote Work` | Remote/công tác Approved |
| `Auto Attendance` | Tự động chấm công |
| `Adjusted` | Đã điều chỉnh |
| `Pending Adjustment` | Có yêu cầu điều chỉnh Pending |
| `Invalid` | Không hợp lệ hoặc bị hủy |

---

### 12.2 Adjustment request status

```text
Draft -> Pending -> Approved
Draft -> Pending -> Rejected
Draft -> Pending -> Cancelled
```

Quy tắc:

1. Employee chỉ cancel khi status còn `Pending` và request của chính mình.
2. Approver chỉ approve/reject khi status là `Pending`.
3. Request Approved/Rejected/Cancelled không được sửa.
4. Nếu attendance record đã thay đổi sau lúc request gửi, approve phải kiểm tra conflict.

---

### 12.3 Remote request status

```text
Draft -> Pending -> Approved
Draft -> Pending -> Rejected
Draft -> Pending -> Cancelled
Approved -> Revoked   (phase sau nếu cần)
```

Quy tắc:

1. Leave Approved ưu tiên cao hơn Remote Approved.
2. Nếu remote Approved bị trùng leave sau này, ATT cần recalculate theo event từ LEAVE.
3. Remote Approved có thể tự tạo attendance record nếu rule cho phép auto attendance.

---

## 13. Idempotency và chống trùng request

### 13.1 API bắt buộc/khuyến nghị Idempotency-Key

| API | Mức độ | Lý do |
| --- | --- | --- |
| Check-in | Bắt buộc khuyến nghị | User có thể bấm nhiều lần hoặc mạng retry |
| Check-out | Bắt buộc khuyến nghị | Tránh check-out trùng |
| Manual adjust | Bắt buộc khuyến nghị | Tránh ghi đè nhiều lần |
| Submit adjustment request | Bắt buộc khuyến nghị | Tránh tạo nhiều request giống nhau |
| Approve/reject adjustment | Bắt buộc khuyến nghị | Tránh duyệt nhiều lần |
| Submit remote request | Bắt buộc khuyến nghị | Tránh tạo nhiều request giống nhau |
| Approve/reject remote | Bắt buộc khuyến nghị | Tránh duyệt nhiều lần |
| Export | Khuyến nghị | Tránh tạo nhiều file export trùng |

### 13.2 Quy tắc xử lý

1. Backend lưu idempotency key theo user + endpoint + method + request hash + thời gian TTL.
2. Nếu cùng key và cùng payload, trả lại response trước đó.
3. Nếu cùng key nhưng khác payload, trả `ATT-ERR-028 IDEMPOTENCY_CONFLICT`.
4. Với check-in/check-out, unique constraint `company_id + employee_id + work_date + shift_id` vẫn là lớp bảo vệ cuối cùng.

---

## 14. Transaction, lock và concurrency

### 14.1 API cần transaction

| API | Transaction | Lock đề xuất |
| --- | --- | --- |
| Check-in | Có | Lock attendance record theo employee/date/shift hoặc advisory lock |
| Check-out | Có | Lock attendance record |
| Manual adjust | Có | Lock attendance record |
| Submit adjustment | Có | Lock attendance record để kiểm tra pending request |
| Approve/reject adjustment | Có | Lock request + attendance record |
| Submit remote | Có | Lock theo employee/date range nếu cần |
| Approve/reject remote | Có | Lock request + attendance records liên quan |
| Shift/rule update | Có | Lock resource cấu hình |

### 14.2 Optimistic lock

Các API approve/manual adjust nên gửi `version` hoặc `updated_at` hiện tại.

Nếu dữ liệu đã thay đổi:

```http
409 Conflict
```

```json
{
  "success": false,
  "message": "Dữ liệu chấm công đã thay đổi, vui lòng tải lại",
  "error": {
    "code": "ATT-ERR-030",
    "type": "ConflictError",
    "details": null
  }
}
```

---

## 15. Audit log

### 15.1 Thao tác bắt buộc ghi audit log

1. Tạo/sửa/vô hiệu hóa shift.
2. Gán/sửa/hủy gán ca.
3. Tạo/sửa/vô hiệu hóa rule chấm công.
4. HR/Admin điều chỉnh công trực tiếp.
5. Employee gửi yêu cầu điều chỉnh công.
6. Manager/HR/Admin duyệt hoặc từ chối điều chỉnh công.
7. Employee gửi remote/công tác.
8. Manager/HR/Admin duyệt hoặc từ chối remote/công tác.
9. Job tự động tạo công hoặc auto checkout nếu có thay đổi dữ liệu.
10. Export bảng công.
11. Truy cập/tải dữ liệu GPS/IP/file nhạy cảm nếu company setting bật.

### 15.2 Audit payload đề xuất

```json
{
  "module_code": "ATT",
  "action": "APPROVE_ADJUSTMENT_REQUEST",
  "entity_type": "AttendanceAdjustmentRequest",
  "entity_id": "adjustment-request-uuid",
  "old_values": {
    "status": "Pending"
  },
  "new_values": {
    "status": "Approved"
  },
  "metadata": {
    "attendance_record_id": "attendance-record-uuid",
    "request_id": "req_20260620_000001",
    "ip": "113.xxx.xxx.25",
    "user_agent": "Chrome"
  }
}
```

---

## 16. Notification event

### 16.1 Event ATT phát cho NOTI

Dùng đúng registry NOTI chuẩn (prefix `ATT_`, `UPPER_SNAKE`). Self check-in/check-out không phát NOTI event. Manual-adjust, export là sự kiện nội bộ/audit, không nằm trong registry NOTI người dùng.

| Event code | Khi nào phát | Người nhận chính |
| --- | --- | --- |
| `ATT_LATE_DETECTED` | Employee đi muộn và company bật cảnh báo | Employee, Manager nếu cấu hình |
| `ATT_MISSING_CHECKOUT` | Job phát hiện thiếu check-out | Employee |
| `ATT_ABSENT_DETECTED` | Job phát hiện vắng mặt | Employee, Manager/HR nếu cấu hình |
| `ATT_ADJUSTMENT_SUBMITTED` | Employee gửi request điều chỉnh | Direct Manager/HR approver |
| `ATT_ADJUSTMENT_APPROVED` | Request điều chỉnh được duyệt | Employee |
| `ATT_ADJUSTMENT_REJECTED` | Request điều chỉnh bị từ chối | Employee |
| `ATT_AUTO_ATTENDANCE_CREATED` | Job tự động ghi công | Employee/HR nếu cấu hình |
| `ATT_REMOTE_REQUEST_SUBMITTED` | Employee gửi remote/công tác | Direct Manager/HR approver |
| `ATT_REMOTE_REQUEST_APPROVED` | Remote/công tác được duyệt | Employee |
| `ATT_REMOTE_REQUEST_REJECTED` | Remote/công tác bị từ chối | Employee |
| `ATT_REMOTE_REQUEST_CANCELLED` | Remote/công tác bị hủy | Manager/HR nếu đã có approval flow |

---

### 16.2 Payload event đề xuất

```json
{
  "event_code": "ATT_ADJUSTMENT_SUBMITTED",
  "source_module": "ATT",
  "company_id": "company-uuid",
  "actor_user_id": "user-uuid",
  "actor_employee_id": "employee-uuid",
  "target_type": "AttendanceAdjustmentRequest",
  "target_id": "adjustment-request-uuid",
  "dedupe_key": "ATT_ADJUSTMENT_SUBMITTED:adjustment-request-uuid",
  "payload": {
    "request_code": "ATT-ADJ-2026-0001",
    "employee_name": "Nguyễn Văn A",
    "work_date": "2026-06-20",
    "target_url": "/attendance/adjustment-requests/adjustment-request-uuid"
  }
}
```

Payload không chứa GPS/IP chi tiết, lý do quá nhạy cảm hoặc file private URL.

---

## 17. Error code ATT

| Mã lỗi | HTTP | Ý nghĩa |
| --- | ---: | --- |
| `ATT-ERR-001` | 401 | Chưa đăng nhập hoặc token không hợp lệ |
| `ATT-ERR-002` | 403 | Không có quyền ATT cần thiết |
| `ATT-ERR-003` | 400 | User chưa liên kết employee |
| `ATT-ERR-004` | 400 | Trạng thái nhân viên không được chấm công |
| `ATT-ERR-005` | 404 | Không tìm thấy ca làm |
| `ATT-ERR-006` | 404 | Không tìm thấy rule chấm công |
| `ATT-ERR-007` | 409 | Đã có đơn nghỉ phép Approved nên không thể chấm công |
| `ATT-ERR-008` | 409 | Đã check-in trước đó |
| `ATT-ERR-009` | 400 | Chưa check-in nên không thể check-out |
| `ATT-ERR-010` | 409 | Đã check-out trước đó |
| `ATT-ERR-011` | 400 | Check-out phải sau check-in |
| `ATT-ERR-012` | 400 | Ngoài khung giờ cho phép chấm công |
| `ATT-ERR-013` | 400 | Rule yêu cầu GPS nhưng request không có GPS |
| `ATT-ERR-014` | 400 | GPS không hợp lệ hoặc ngoài phạm vi cho phép |
| `ATT-ERR-015` | 400 | Rule yêu cầu ghi chú nhưng request không có note |
| `ATT-ERR-016` | 404 | Không tìm thấy bản ghi công |
| `ATT-ERR-017` | 409 | Kỳ công hoặc record đang bị khóa |
| `ATT-ERR-018` | 404 | Không tìm thấy yêu cầu điều chỉnh công |
| `ATT-ERR-019` | 409 | Trạng thái yêu cầu điều chỉnh không hợp lệ cho thao tác |
| `ATT-ERR-020` | 409 | Yêu cầu điều chỉnh xung đột với dữ liệu hiện tại |
| `ATT-ERR-021` | 404 | Không tìm thấy remote/công tác request |
| `ATT-ERR-022` | 409 | Remote request trùng với leave Approved |
| `ATT-ERR-023` | 409 | Trạng thái remote request không hợp lệ cho thao tác |
| `ATT-ERR-024` | 400 | Không xác định được người duyệt phù hợp |
| `ATT-ERR-025` | 403 | Không có quyền export bảng công |
| `ATT-ERR-026` | 400 | Dữ liệu request không hợp lệ |
| `ATT-ERR-027` | 409 | Dữ liệu bị trùng |
| `ATT-ERR-028` | 409 | Idempotency key đã dùng với payload khác |
| `ATT-ERR-029` | 403 | Không có quyền xem dữ liệu nhạy cảm |
| `ATT-ERR-030` | 409 | Dữ liệu chấm công đã thay đổi, vui lòng tải lại |
| `ATT-ERR-031` | 409 | Kỳ công đã khóa, không thể thay đổi |
| `ATT-ERR-032` | 400 | Ngày nghỉ lễ/ngày không làm việc không cho phép chấm công |
| `ATT-ERR-033` | 409 | Nhân viên thuộc rule tự động chấm công, không cho thao tác thủ công |
| `ATT-ERR-034` | 400 | File bằng chứng không hợp lệ hoặc thiếu file bắt buộc |
| `ATT-ERR-035` | 404 | Không tìm thấy dữ liệu trong công ty hiện tại |

---

## 18. Bảo mật và kiểm soát dữ liệu

### 18.1 Nguyên tắc bảo mật

1. Backend luôn kiểm tra access token.
2. Backend luôn kiểm tra permission và data scope.
3. Backend resolve employee hiện tại từ HR, không tin employee_id client gửi trong API Own.
4. Mọi query filter theo `company_id`.
5. GPS/IP/device/photo là dữ liệu nhạy cảm.
6. File proof/photo dùng private file service.
7. Export luôn ghi audit log.
8. Không trả storage path thật của file.
9. Không trả dữ liệu công ty khác dù biết UUID.
10. Internal API dùng service token hoặc cơ chế auth nội bộ riêng.

---

### 18.2 Rate limit đề xuất

| API | Rate limit đề xuất |
| --- | --- |
| Check-in/check-out | 10 request/phút/user |
| Today status | 60 request/phút/user |
| List records | 60 request/phút/user |
| Submit adjustment/remote | 20 request/giờ/user |
| Approve/reject | 60 request/phút/user |
| Export | 10 request/giờ/user |

---

## 19. Performance và query strategy

### 19.1 Query bảng công

Các API list bảng công phải:

1. Filter `company_id` đầu tiên.
2. Filter date range bắt buộc với API company/team nếu dữ liệu lớn.
3. Có index theo `company_id`, `employee_id`, `department_id`, `work_date`, `attendance_status`.
4. Không join quá nhiều bảng nếu chỉ cần list summary.
5. Dùng projection DTO thay vì trả toàn bộ entity.
6. Tránh N+1 khi join employee, department, shift.
7. Với export lớn, chạy async job.

---

### 19.2 Cache

| Dữ liệu | Cache đề xuất |
| --- | --- |
| Today attendance | Không cache hoặc TTL 5-15 giây |
| Shift list | TTL 5-15 phút, invalidate khi shift thay đổi |
| Attendance rule | TTL 5-15 phút, invalidate khi rule thay đổi |
| My records tháng cũ | TTL ngắn 1-5 phút nếu không có thay đổi |
| Dashboard attendance widget | Cache ở DASH 30-60 giây |

---

### 19.3 Export

1. Export nhỏ có thể xử lý sync.
2. Export lớn phải xử lý async.
3. Export file lưu private storage.
4. Người dùng nhận notification khi file sẵn sàng.
5. Export phải giới hạn range và số dòng theo cấu hình.

---

## 20. Tích hợp liên module

### 20.1 ATT với AUTH

1. Xác thực access token.
2. Kiểm tra permission và data scope.
3. Lấy actor user cho audit log.
4. Không hard-code role; role chỉ là nhóm quyền seed sẵn.

### 20.2 ATT với HR

1. Resolve employee từ user.
2. Kiểm tra `employment_status`.
3. Lấy `department_id`, `position_id` để snapshot vào record.
4. Xác định `direct_manager_id` để duyệt adjustment/remote theo Team scope.
5. Chặn employee Resigned/Terminated chấm công.

### 20.3 ATT với LEAVE

1. Kiểm tra leave Approved trong ngày trước khi check-in/check-out.
2. Leave full day Approved chặn check-in/check-out.
3. Leave half day/hourly làm giảm required working minutes hoặc block theo khung giờ.
4. Khi LEAVE Approved/Cancelled/Revoked, LEAVE phát event để ATT recalculate.
5. Leave Approved ưu tiên cao hơn Remote Approved.

### 20.4 ATT với NOTI

1. ATT phát event nghiệp vụ, NOTI quyết định template/kênh gửi.
2. Payload event không chứa GPS/IP hoặc dữ liệu nhạy cảm quá mức.
3. NOTI dùng `target_module`, `target_type`, `target_id`, `target_url` để điều hướng.

### 20.5 ATT với DASH

1. DASH đọc dữ liệu ATT qua API/service để hiển thị widget.
2. DASH không ghi `attendance_records`.
3. Widget chấm công hôm nay có thể gọi `GET /api/v1/attendance/today` hoặc endpoint dashboard riêng.

### 20.6 ATT với TASK

1. MVP chưa bắt buộc tính công theo task.
2. Remote request có thể chừa `task_id`, `project_id` nullable.
3. Phase sau có thể yêu cầu nhân viên remote chọn task/project.

---

## 21. Internal API và job

### 21.1 POST `/internal/v1/attendance/recalculate`

Dùng khi LEAVE/REMOTE/RULE thay đổi cần tính lại bảng công.

Request mẫu:

```json
{
  "company_id": "company-uuid",
  "employee_id": "employee-uuid",
  "date_from": "2026-06-20",
  "date_to": "2026-06-25",
  "reason": "LEAVE_APPROVED",
  "source_event_id": "event-uuid"
}
```

Quy tắc:

1. Chỉ service nội bộ được gọi.
2. Có idempotency theo `source_event_id`.
3. Không tin payload nếu không có service auth.
4. Ghi audit/system log nếu thay đổi dữ liệu.

---

### 21.2 POST `/internal/v1/attendance/missing-checkout-job`

Job phát hiện nhân viên thiếu check-out.

Quy tắc:

1. Chạy theo timezone company.
2. Tìm record `Checked-in` quá giờ kết thúc ca + grace period.
3. Cập nhật status `Missing Check-out` nếu rule cho phép.
4. Phát event `ATT_MISSING_CHECKOUT`.
5. Không spam notification; dùng dedupe key theo employee/date/shift.

---

### 21.3 POST `/internal/v1/attendance/auto-attendance-job`

Job tự động chấm công cho nhóm đặc thù.

Quy tắc:

1. Chỉ áp dụng employee/rule có `allow_auto_attendance = true`.
2. Không tạo công nếu có leave Approved full day.
3. Nếu remote Approved auto attendance, tạo record theo remote rule.
4. Ghi `attendance_source = AUTO` hoặc `REMOTE`.
5. Ghi audit/system log.
6. Phát event `ATT_AUTO_ATTENDANCE_CREATED` nếu cấu hình bật.

---

## 22. OpenAPI / Swagger

> Đặc tả OpenAPI 3.1 máy đọc cho toàn hệ thống: [`openapi/enterprise-api.yaml`](openapi/enterprise-api.yaml). Fragment của module: [`openapi/paths/att.paths.yaml`](openapi/paths/att.paths.yaml). Quy ước build & vendor extension: [`openapi/README.md`](openapi/README.md). Phân quyền: [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [Audit Report](<API-10 PERMISSION AUDIT REPORT.md>).

### 22.1 Security

`bearerAuth` (HTTP bearer JWT) cho `/api/v1/attendance/*`; job nội bộ `/internal/v1/attendance/*` dùng `internalServiceAuth`.

### 22.2 Tags của module

- `Attendance - Today` — trạng thái hôm nay, check-in/check-out
- `Attendance - Records` — bảng công (my/team/company), raw logs
- `Attendance - Adjustments` — yêu cầu điều chỉnh công
- `Attendance - Remote Requests` — remote/công tác
- `Attendance - Shifts` — ca làm việc
- `Attendance - Shift Assignments` — phân ca
- `Attendance - Rules` — quy tắc chấm công, effective rule
- `Attendance - Exports` — xuất dữ liệu công
- `Attendance - Audit Logs` — audit chấm công
- `Attendance - Internal` — job nội bộ (recalculate, auto-attendance, missing-checkout)

### 22.3 Vendor extensions (đồng nhất toàn hệ thống)

| Extension | Giá trị | Ý nghĩa |
| --------- | ------- | ------- |
| `x-required-permission` | `string` \| `string[]` \| `null` | permission bắt buộc (`null` = Public/Authenticated/Internal) |
| `x-permission-mode` | `allOf` \| `anyOf` | cách kết hợp khi là mảng (mặc định `allOf`) |
| `x-allowed-roles` | `string[]` | role gợi ý (không enforce) |
| `x-data-scope` | `string[]` | Own/Team/Department/Project/Company/System |
| `x-idempotency` | `Required` \| `Optional` \| `No` | header `Idempotency-Key` |
| `x-audit-log` | `always` \| `conditional` \| `none` | mức ghi audit |
| `x-notification-event` | `string` \| `null` | event phát ra |

operationId prefix: `att`.

### 22.4 Schema & response dùng chung

Tái dùng từ spec tổng (định nghĩa trong `enterprise-api.base.yaml`): envelope `SuccessResponse` / `SuccessListResponse` / `CursorListResponse`, lỗi `ErrorResponse` / `ValidationErrorResponse`, kèm `Meta` / `Pagination` / `CursorPagination`. Common responses 400/401/403/404/409/422/429/500. Common params `PageParam`, `PerPageParam`, `SearchParam`, `SortParam`, `CursorParam`, `LimitParam`, `IdempotencyKey`.

### 22.5 DTO đề xuất cho module

`AttendanceTodayResponse`, `AttendanceRecordDto`, `AttendanceLogDto`, `CheckInRequest`, `CheckOutRequest`, `CreateAttendanceAdjustmentRequest`, `ReviewAttendanceAdjustmentRequest`, `AttendanceAdjustmentDto`, `CreateRemoteWorkRequest`, `ReviewRemoteWorkRequest`, `RemoteWorkRequestDto`, `ShiftDto`, `ShiftAssignmentDto`, `AttendanceRuleDto`, `AttendanceExportRequest`, `ManualAdjustRequest`.

---

## 23. Test case API

### 23.1 Today/check-in/check-out

| Mã test | Trường hợp | Kết quả mong đợi |
| --- | --- | --- |
| ATT-TC-001 | Lấy today khi chưa check-in | Trả can_check_in = true |
| ATT-TC-002 | Check-in hợp lệ | Tạo attendance_record + attendance_log |
| ATT-TC-003 | Check-in hai lần | Không tạo record trùng, trả conflict hoặc response idempotent |
| ATT-TC-004 | Check-out khi chưa check-in | Trả lỗi theo rule |
| ATT-TC-005 | Check-out hợp lệ | Cập nhật check_out_at, worked_minutes |
| ATT-TC-006 | Check-out hai lần | Không update trùng |
| ATT-TC-007 | Check-in khi có leave full day Approved | Bị chặn |
| ATT-TC-008 | Check-in nhân viên Resigned | Bị chặn |
| ATT-TC-009 | Rule yêu cầu GPS nhưng không gửi GPS | Validation error |
| ATT-TC-010 | Client gửi giờ giả | Backend vẫn dùng server time |

---

### 23.2 Attendance records

| Mã test | Trường hợp | Kết quả mong đợi |
| --- | --- | --- |
| ATT-TC-101 | Employee xem my-records | Chỉ thấy record của mình |
| ATT-TC-102 | Manager xem team-records | Chỉ thấy team |
| ATT-TC-103 | HR xem records company | Thấy dữ liệu company |
| ATT-TC-104 | User cố xem record công ty khác | Bị chặn |
| ATT-TC-105 | List không trả GPS/IP mặc định | Không có field sensitive |
| ATT-TC-106 | User có quyền sensitive xem detail | Trả GPS/IP theo policy |
| ATT-TC-107 | Query date range lớn | Bị giới hạn hoặc yêu cầu export |

---

### 23.3 Adjustment request

| Mã test | Trường hợp | Kết quả mong đợi |
| --- | --- | --- |
| ATT-TC-201 | Employee tạo adjustment hợp lệ | Request Pending, gửi notification |
| ATT-TC-202 | Employee tạo adjustment cho người khác | Bị chặn |
| ATT-TC-203 | Tạo adjustment thiếu reason | Validation error |
| ATT-TC-204 | Manager duyệt request ngoài team | Bị chặn |
| ATT-TC-205 | Manager duyệt request trong team | Record được cập nhật, audit log được ghi |
| ATT-TC-206 | HR từ chối request | Request Rejected, employee nhận notification |
| ATT-TC-207 | Duyệt request đã thay đổi version | Conflict `ATT-ERR-030` |
| ATT-TC-208 | Employee hủy request Pending của mình | Request Cancelled |

---

### 23.4 Remote request

| Mã test | Trường hợp | Kết quả mong đợi |
| --- | --- | --- |
| ATT-TC-301 | Employee tạo remote hợp lệ | Request Pending |
| ATT-TC-302 | Remote trùng leave full day Approved | Bị chặn |
| ATT-TC-303 | Manager duyệt remote trong team | Request Approved |
| ATT-TC-304 | HR duyệt remote company | Request Approved |
| ATT-TC-305 | Approve remote auto attendance | Attendance record được tạo nếu rule cho phép |
| ATT-TC-306 | Employee hủy remote Pending | Request Cancelled |

---

### 23.5 Shift/rule/export

| Mã test | Trường hợp | Kết quả mong đợi |
| --- | --- | --- |
| ATT-TC-401 | Tạo shift hợp lệ | Shift Active |
| ATT-TC-402 | Tạo shift trùng code | Bị chặn |
| ATT-TC-403 | Gán ca theo department | Assignment tạo thành công |
| ATT-TC-404 | Rule employee override department | Effective rule là employee rule |
| ATT-TC-405 | Export không có quyền | Bị chặn |
| ATT-TC-406 | Export có quyền | Tạo file private, audit log được ghi |
| ATT-TC-407 | Export sensitive không có quyền sensitive | Bị chặn hoặc field bị mask |

---

## 24. Checklist triển khai backend

- [ ] Middleware xác thực access token.
- [ ] Guard kiểm tra permission + data scope.
- [ ] Service resolve employee hiện tại từ user.
- [ ] Rule engine xác định shift/rule hiệu lực.
- [ ] Leave checker kiểm tra leave Approved.
- [ ] Remote checker kiểm tra remote Approved.
- [ ] Transaction + lock cho check-in/check-out/approve/manual adjust.
- [ ] Idempotency service cho API action quan trọng.
- [ ] Attendance calculation service.
- [ ] Attendance log service.
- [ ] Audit log service.
- [ ] Notification event publisher.
- [ ] File service tích hợp cho bằng chứng/export.
- [ ] Export job nếu dữ liệu lớn.
- [ ] Unit test rule engine.
- [ ] Integration test permission/scope.
- [ ] E2E test check-in/check-out.

---

## 25. Roadmap triển khai API-04

### 25.1 Sprint 1 - Attendance Core

1. `GET /attendance/today`.
2. `POST /attendance/check-in`.
3. `POST /attendance/check-out`.
4. `GET /attendance/my-records`.
5. `GET /attendance/records/{id}`.
6. Rule cơ bản: fixed shift, late, early leave, missing hours.

### 25.2 Sprint 2 - Records & Team/HR View

1. `GET /attendance/team-records`.
2. `GET /attendance/records`.
3. `GET /attendance/records/{id}/logs`.
4. Data scope Team/Department/Company.
5. Mask dữ liệu sensitive.

### 25.3 Sprint 3 - Shift & Rule Config

1. Shift CRUD.
2. Shift assignment.
3. Attendance rule CRUD.
4. Effective rule endpoint.
5. Audit log cấu hình.

### 25.4 Sprint 4 - Adjustment Workflow

1. Employee submit adjustment.
2. My adjustment requests.
3. Manager/HR list pending adjustment.
4. Approve/reject/cancel.
5. Manual adjust.
6. Notification events.

### 25.5 Sprint 5 - Remote/Export/Internal Jobs

1. Remote request CRUD workflow.
2. Remote approve/reject.
3. Auto attendance theo remote nếu bật.
4. Export attendance.
5. Missing checkout job.
6. Internal recalculate API.

---

## 26. Kết luận

API-04 định nghĩa đầy đủ nhóm API cho module ATT trong MVP Version 1.0.

Các điểm quan trọng cần giữ khi triển khai:

1. ATT API phải tuân thủ chuẩn chung của API-01 về `/api/v1`, response format, error format, pagination, search/filter/sort, audit log, notification event và idempotency.
2. Backend luôn kiểm tra permission và data scope; frontend chỉ hỗ trợ UI, không thay thế backend authorization.
3. Employee là chủ thể nghiệp vụ của chấm công; user là actor thao tác.
4. Check-in/check-out luôn dùng server time, không tin thời gian từ client.
5. Mỗi employee/ngày/ca chỉ có một attendance record chính trong MVP.
6. `attendance_records` là dữ liệu tổng hợp; `attendance_logs` là log thô phục vụ truy vết.
7. Leave Approved ưu tiên cao hơn check-in/check-out thủ công và remote/auto attendance.
8. Remote/công tác thuộc ATT vì là trạng thái đi làm, không phải nghỉ phép.
9. HR/Admin điều chỉnh công trực tiếp phải ghi audit log.
10. Adjustment request và remote request phải có trạng thái, lịch sử xử lý và notification event.
11. GPS/IP/device/photo là dữ liệu nhạy cảm, không trả mặc định trong list và không export nếu thiếu quyền.
12. API phải đủ mở cho mobile, device integration, import, overtime, payroll và AI anomaly detection ở phase sau.
