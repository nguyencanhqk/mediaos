# BACKEND-06: ATTENDANCE BACKEND

> **📚 Bộ tài liệu BACKEND — Hệ thống Quản lý Doanh nghiệp**
> [BACKEND-01 Kiến trúc/Setup](<BACKEND-01_Backend_Architecture_Project_Setup.md>) · [BACKEND-02 Migration/ORM/Seed](<BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) · [BACKEND-03 Auth/RBAC](<BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) · [BACKEND-04 Foundation](<BACKEND-04_Foundation_Backend.md>) · [BACKEND-05 HR](<BACKEND-05_HR_Backend.md>) · **BACKEND-06 Attendance** · [BACKEND-07 Leave](<BACKEND-07_Leave_Backend.md>) · [BACKEND-08 Task](<BACKEND-08_Task_Backend.md>) · [BACKEND-09 Notification](<BACKEND-09_Notification_Backend.md>) · [BACKEND-10 Dashboard](<BACKEND-10_Dashboard_Backend.md>) · [BACKEND-11 File/Audit/Settings/Jobs](<BACKEND-11_File_Audit_Settings_System_Jobs.md>) · [BACKEND-12 API Contract/OpenAPI](<BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md>) · [BACKEND-13 Testing/Security/Perf](<BACKEND-13_Backend_Testing_Security_Performance.md>) · [BACKEND-14 Release Readiness](<BACKEND-14_Backend_Release_Readiness.md>)
>
> **Nguồn & liên quan:** [Đặc tả: SPEC-04 ATT](<../SPEC/SPEC-04 ATT.md>) · [DB: DB-04 ATT](<../DB/DB-04_ATT Database Design.md>) · [API: API-04 ATT](<../API Design/API-04_ATT_API_Design.md>) · [Màn hình: UI-09](<../UI/UI-09_Module_UI_Design.md>) · [Frontend: FRONTEND-09](<../FRONTEND/FRONTEND-09_Attendance_Frontend.md>) · [Chỉ mục: README](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | BACKEND-06 |
| Tên tài liệu | Attendance Backend Implementation |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | ATT - Chấm công |
| Giai đoạn | Backend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-10, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-05 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

BACKEND-06 mô tả cách triển khai backend cho module **ATT - Chấm công**.

Tài liệu này dùng để:

1. Chuyển SPEC-04, DB-04 và API-04 thành kế hoạch triển khai backend thực tế.
2. Xác định module structure, controller, DTO, service, repository, rule engine và job cho ATT.
3. Chuẩn hóa xử lý check-in/check-out bằng server time.
4. Chuẩn hóa bảng công cá nhân, bảng công team, bảng công toàn công ty theo permission và data scope.
5. Triển khai rule chấm công theo Company, Department hoặc Employee.
6. Triển khai ca làm việc và gán ca theo Company, Department hoặc Employee.
7. Triển khai request điều chỉnh công và luồng duyệt/từ chối bởi Manager/HR.
8. Triển khai HR/Admin điều chỉnh công trực tiếp.
9. Triển khai remote work / công tác / làm ngoài văn phòng trong module ATT.
10. Tích hợp LEAVE để chặn hoặc tính lại công khi có đơn nghỉ Approved.
11. Tích hợp NOTI để phát thông báo nghiệp vụ.
12. Tích hợp DASH để invalidate/cache dữ liệu widget.
13. Tích hợp Foundation để dùng audit log, file service, settings, public holiday và sequence.
14. Định nghĩa test case backend, migration checklist, security checklist và release checklist cho ATT.

BACKEND-06 không thiết kế lại database hoặc API contract. Tài liệu này bám theo DB-04 và API-04, tập trung vào cách tổ chức code và xử lý nghiệp vụ backend.

---

## 3. Vị trí BACKEND-06 trong roadmap backend

```text
BACKEND-01: Backend Architecture & Project Setup
BACKEND-02: Database Migration, ORM & Seed Implementation
BACKEND-03: Auth, Session, RBAC & Permission Guard
BACKEND-04: Foundation Backend
BACKEND-05: HR Backend
BACKEND-06: Attendance Backend
BACKEND-07: Leave Backend
BACKEND-08: Task Backend
BACKEND-09: Notification Backend
BACKEND-10: Dashboard Backend
BACKEND-11: File, Audit, Settings & System Jobs
BACKEND-12: API Integration Contract & OpenAPI/Swagger
BACKEND-13: Backend Testing, Security & Performance
BACKEND-14: Backend Release Readiness
```

BACKEND-06 nên triển khai sau BACKEND-05 vì ATT phụ thuộc mạnh vào HR để lấy employee, department, direct manager, employment status và user-employee mapping.

---

## 4. Căn cứ triển khai

BACKEND-06 bám theo các quyết định đã chốt:

1. ATT là module chấm công, bao gồm check-in, check-out, bảng công, ca làm, rule, điều chỉnh công, remote/công tác, tự động chấm công, audit log và event notification.
2. Backend luôn kiểm tra authentication, permission, data scope và business rule; frontend chỉ hỗ trợ UX.
3. `employee_id` là chủ thể nghiệp vụ của chấm công; `user_id` là actor thao tác.
4. Check-in/check-out luôn dùng server time làm thời gian nghiệp vụ chính.
5. `attendance_records` là dữ liệu tổng hợp; `attendance_logs` là log thô phục vụ truy vết.
6. Mỗi employee/ngày/ca chỉ có một attendance record chính trong MVP.
7. Shift có thể gán theo Company, Department hoặc Employee.
8. Rule chấm công có thể cấu hình theo Company, Department hoặc Employee.
9. Rule Employee ưu tiên hơn Department; Department ưu tiên hơn Company; Company ưu tiên hơn default.
10. Leave Approved có ưu tiên cao hơn check-in/check-out thủ công, remote và auto attendance.
11. Remote/công tác thuộc ATT vì là trạng thái đi làm, không phải nghỉ phép.
12. HR/Admin điều chỉnh công trực tiếp phải ghi audit log.
13. Adjustment request và remote request phải có trạng thái, lịch sử xử lý và notification event.
14. GPS, IP, device, user agent, ảnh bằng chứng và export chứa dữ liệu chấm công là dữ liệu nhạy cảm.
15. Dashboard không ghi dữ liệu ATT, chỉ đọc/tổng hợp/cache.
16. ATT cần chừa hướng mở rộng cho mobile, thiết bị chấm công, import, overtime, payroll và AI anomaly detection.

---

## 5. Phạm vi BACKEND-06

### 5.1 Bao gồm trong MVP

| Nhóm | Nội dung triển khai |
| --- | --- |
| Today Attendance | Lấy trạng thái chấm công hôm nay, shift/rule áp dụng, leave/remote context và action được phép |
| Check-in/out | Employee check-in/check-out bằng web/mobile, chống trùng, ghi log thô |
| Attendance Records | Bảng công cá nhân, team, company, chi tiết record, log record |
| Shift | CRUD ca làm việc, fixed/flexible, active/inactive |
| Shift Assignment | Gán ca theo company/department/employee, resolve effective shift |
| Attendance Rule | CRUD rule, resolve effective rule, cache rule, snapshot rule khi tính công |
| Adjustment Request | Employee gửi yêu cầu điều chỉnh, xem yêu cầu, hủy pending |
| Adjustment Approval | Manager/HR duyệt hoặc từ chối yêu cầu điều chỉnh theo scope |
| Manual Adjustment | HR/Admin điều chỉnh công trực tiếp theo quyền |
| Remote Work Request | Tạo, xem, duyệt, từ chối, hủy remote/công tác |
| Recalculate | Tính lại record khi leave/remote/rule/shift thay đổi |
| Jobs | Missing checkout, auto checkout, auto attendance nếu bật cấu hình |
| Export | Xuất bảng công theo quyền, mask dữ liệu nhạy cảm nếu thiếu quyền |
| Event integration | Emit event sang NOTI/DASH, consume event từ LEAVE/HR/Foundation |
| Audit | Ghi audit log cho thao tác quan trọng |
| Test | Unit, integration, e2e, permission/scope, concurrency, job test |

### 5.2 Chưa triển khai sâu trong MVP nhưng phải chừa thiết kế

| Nhóm | Hướng mở rộng |
| --- | --- |
| Device integration | Thêm attendance device, device log, sync batch |
| Import Excel/CSV | Import batch, validate row, preview, commit |
| Overtime | Overtime request/record, tính OT cho payroll |
| Period lock | Khóa kỳ công theo tháng, chặn sửa sau khi khóa |
| GPS/geofence nâng cao | Office locations, allowed radius, anti-spoofing |
| QR attendance | QR session/checkpoint |
| Face recognition | Tích hợp service riêng, ATT chỉ lưu metadata/private file reference |
| Payroll integration | Payroll đọc attendance_records, không sửa trực tiếp ATT |
| AI anomaly detection | Gắn cờ bất thường bằng job/AI service phase sau |

---

## 6. Module dependency

### 6.1 Phụ thuộc trực tiếp

| Module | Cách ATT Backend sử dụng |
| --- | --- |
| AUTH | Resolve auth context, user, company, permission, data scope |
| HR | Resolve employee hiện tại, employment status, department, direct manager, employee scope |
| LEAVE | Kiểm tra leave Approved để chặn/tính lại công |
| FOUNDATION | Audit log, file service, setting, public holiday, sequence, export file |
| NOTI | Gửi thông báo điều chỉnh công, remote request, quên check-out, bất thường |
| DASH | Invalidate dashboard cache/widget khi dữ liệu ATT thay đổi |
| TASK | Optional phase sau: remote request có thể gắn task/project |

### 6.2 Không được phụ thuộc ngược không kiểm soát

ATT không được gọi trực tiếp logic nội bộ của UI hoặc Dashboard. Dashboard chỉ đọc ATT hoặc nhận event invalidate. Notification chỉ nhận event và tạo thông báo, không tự sửa ATT.

---

## 7. Cấu trúc thư mục đề xuất

```text
src/modules/attendance
  attendance.module.ts

  controllers
    attendance-today.controller.ts
    attendance-check.controller.ts
    attendance-record.controller.ts
    attendance-adjustment.controller.ts
    attendance-remote.controller.ts
    attendance-shift.controller.ts
    attendance-rule.controller.ts
    attendance-export.controller.ts
    attendance-internal.controller.ts

  dto
    attendance-today.dto.ts
    check-in.dto.ts
    check-out.dto.ts
    attendance-record-query.dto.ts
    attendance-record.dto.ts
    attendance-log.dto.ts
    create-adjustment-request.dto.ts
    review-adjustment-request.dto.ts
    manual-adjust-attendance.dto.ts
    create-remote-work-request.dto.ts
    review-remote-work-request.dto.ts
    create-shift.dto.ts
    update-shift.dto.ts
    create-shift-assignment.dto.ts
    create-attendance-rule.dto.ts
    update-attendance-rule.dto.ts
    attendance-export.dto.ts
    internal-recalculate.dto.ts

  enums
    attendance-status.enum.ts
    attendance-source.enum.ts
    work-mode.enum.ts
    attendance-log-type.enum.ts
    attendance-log-status.enum.ts
    attendance-request-status.enum.ts
    shift-type.enum.ts
    shift-assignment-scope.enum.ts
    attendance-rule-scope.enum.ts
    remote-request-type.enum.ts
    remote-mode.enum.ts

  repositories
    attendance-record.repository.ts
    attendance-log.repository.ts
    shift.repository.ts
    shift-assignment.repository.ts
    attendance-rule.repository.ts
    attendance-adjustment-request.repository.ts
    attendance-adjustment-item.repository.ts
    remote-work-request.repository.ts
    remote-work-approval.repository.ts

  services
    attendance-today.service.ts
    check-in.service.ts
    check-out.service.ts
    attendance-record.service.ts
    attendance-log.service.ts
    attendance-calculation.service.ts
    attendance-rule-resolver.service.ts
    shift-resolver.service.ts
    attendance-leave-guard.service.ts
    attendance-remote-resolver.service.ts
    attendance-adjustment.service.ts
    manual-adjustment.service.ts
    remote-work-request.service.ts
    attendance-recalculate.service.ts
    attendance-export.service.ts
    attendance-event.service.ts
    attendance-sensitive-field.service.ts

  jobs
    missing-checkout.job.ts
    auto-checkout.job.ts
    auto-attendance.job.ts
    attendance-cache-warmup.job.ts

  policies
    attendance-permission.policy.ts
    attendance-scope.policy.ts
    attendance-sensitive.policy.ts

  validators
    attendance-date-range.validator.ts
    check-in-out.validator.ts
    shift-overlap.validator.ts
    rule-overlap.validator.ts
    adjustment-item.validator.ts
    remote-work-request.validator.ts

  mappers
    attendance-record.mapper.ts
    attendance-today.mapper.ts
    attendance-log.mapper.ts
    adjustment-request.mapper.ts
    remote-work-request.mapper.ts
    shift.mapper.ts
    rule.mapper.ts

  listeners
    leave-event.listener.ts
    hr-event.listener.ts
    foundation-event.listener.ts

  tests
    unit
    integration
    e2e
```

Tên file có thể điều chỉnh theo framework thực tế. Mục tiêu là tách rõ controller, service nghiệp vụ, repository, policy, validator, mapper và jobs.

---

## 8. Domain model backend

### 8.1 Entity chính

| Entity | Bảng | Vai trò |
| --- | --- | --- |
| Shift | `shifts` | Ca làm việc |
| ShiftAssignment | `shift_assignments` | Gán ca theo company/department/employee |
| AttendanceRule | `attendance_rules` | Rule chấm công |
| AttendanceRecord | `attendance_records` | Bản ghi công tổng hợp |
| AttendanceLog | `attendance_logs` | Log thô check-in/check-out |
| AttendanceAdjustmentRequest | `attendance_adjustment_requests` | Yêu cầu điều chỉnh công |
| AttendanceAdjustmentItem | `attendance_adjustment_items` | Chi tiết field điều chỉnh |
| RemoteWorkRequest | `remote_work_requests` | Yêu cầu remote/công tác |
| RemoteWorkRequestApproval | `remote_work_request_approvals` | Lịch sử duyệt remote/công tác |

### 8.2 Enum bắt buộc

```ts
export enum AttendanceSource {
  WEB = 'WEB',
  MOBILE = 'MOBILE',
  MANUAL = 'MANUAL',
  AUTO = 'AUTO',
  REMOTE = 'REMOTE',
  DEVICE = 'DEVICE',
  IMPORT = 'IMPORT',
  API = 'API',
}

export enum WorkMode {
  OFFICE = 'Office',
  REMOTE = 'Remote',
  BUSINESS_TRIP = 'BusinessTrip',
  AUTO = 'Auto',
  LEAVE = 'Leave',
}

export enum AttendanceStatus {
  NOT_CHECKED_IN = 'Not Checked-in',
  CHECKED_IN = 'Checked-in',
  CHECKED_OUT = 'Checked-out',
  PRESENT = 'Present',
  LATE = 'Late',
  EARLY_LEAVE = 'Early Leave',
  MISSING_HOURS = 'Missing Hours',
  MISSING_CHECK_IN = 'Missing Check-in',
  MISSING_CHECK_OUT = 'Missing Check-out',
  ABSENT = 'Absent',
  LEAVE = 'Leave',
  REMOTE_WORK = 'Remote Work',
  AUTO_ATTENDANCE = 'Auto Attendance',
  ADJUSTED = 'Adjusted',
  PENDING_ADJUSTMENT = 'Pending Adjustment',
  INVALID = 'Invalid',
}
```

### 8.3 Snapshot cần giữ trong AttendanceRecord

AttendanceRecord cần lưu snapshot để tránh dữ liệu quá khứ thay đổi ngoài ý muốn:

1. `department_id` tại thời điểm ghi công.
2. `position_id` nếu cần báo cáo.
3. `shift_id` hoặc `applied_shift_id`.
4. `applied_rule_id`.
5. `required_working_minutes`.
6. `calculation_snapshot`.
7. `attendance_source`.
8. `work_mode`.
9. `leave_request_id` hoặc `remote_work_request_id` nếu có.

---

## 9. Permission và data scope

### 9.1 Nguyên tắc

Backend kiểm tra theo công thức:

```text
auth context
+ required permission
+ granted data scope
+ target resource scope
+ business validation
```

Không hard-code theo role name. Role chỉ là seed mặc định.

### 9.2 Permission ATT MVP

| Permission | Dùng cho |
| --- | --- |
| `ATT.ATTENDANCE.CHECK_IN` | Check-in của chính mình |
| `ATT.ATTENDANCE.CHECK_OUT` | Check-out của chính mình |
| `ATT.ATTENDANCE.VIEW_OWN` | Bảng công cá nhân |
| `ATT.ATTENDANCE.VIEW_TEAM` | Bảng công team |
| `ATT.ATTENDANCE.VIEW_COMPANY` | Bảng công công ty |
| `ATT.ATTENDANCE.VIEW_DETAIL` | Chi tiết record và log |
| `ATT.ATTENDANCE.VIEW_SENSITIVE` | GPS/IP/device/ảnh bằng chứng |
| `ATT.ATTENDANCE.EXPORT` | Export bảng công |
| `ATT.ATTENDANCE.ADJUST_DIRECT` | HR/Admin điều chỉnh trực tiếp |
| `ATT.ATTENDANCE.RECALCULATE` | Tính lại bản ghi công |
| `ATT.ADJUSTMENT.CREATE_OWN` | Employee gửi điều chỉnh |
| `ATT.ADJUSTMENT.VIEW_OWN` | Xem điều chỉnh của mình |
| `ATT.ADJUSTMENT.VIEW_TEAM` | Manager xem điều chỉnh team |
| `ATT.ADJUSTMENT.VIEW_COMPANY` | HR/Admin xem điều chỉnh company |
| `ATT.ADJUSTMENT.APPROVE` | Duyệt điều chỉnh |
| `ATT.ADJUSTMENT.REJECT` | Từ chối điều chỉnh |
| `ATT.ADJUSTMENT.CANCEL_OWN` | Employee hủy pending adjustment |
| `ATT.SHIFT.VIEW` | Xem ca |
| `ATT.SHIFT.CREATE` | Tạo ca |
| `ATT.SHIFT.UPDATE` | Cập nhật ca |
| `ATT.SHIFT.DELETE` | Vô hiệu hóa/xóa mềm ca |
| `ATT.SHIFT_ASSIGNMENT.VIEW` | Xem gán ca |
| `ATT.SHIFT_ASSIGNMENT.UPDATE` | Tạo/cập nhật/hủy gán ca |
| `ATT.RULE.VIEW` | Xem rule |
| `ATT.RULE.CONFIG` | Cấu hình rule |
| `ATT.REMOTE_REQUEST.CREATE_OWN` | Gửi remote/công tác |
| `ATT.REMOTE_REQUEST.VIEW_OWN` | Xem remote/công tác của mình |
| `ATT.REMOTE_REQUEST.VIEW_TEAM` | Manager xem remote/công tác team |
| `ATT.REMOTE_REQUEST.VIEW_COMPANY` | HR/Admin xem remote/công tác company |
| `ATT.REMOTE_REQUEST.APPROVE` | Duyệt remote/công tác |
| `ATT.REMOTE_REQUEST.REJECT` | Từ chối remote/công tác |
| `ATT.REMOTE_REQUEST.CANCEL_OWN` | Employee hủy pending remote |
| `ATT.AUDIT_LOG.VIEW` | Xem audit log ATT |

### 9.3 Data scope ATT

| Scope | Cách backend áp dụng |
| --- | --- |
| Own | `employee_id = current_employee.id` |
| Team | `employee.direct_manager_id = current_employee.id` hoặc team scope resolver |
| Department | Employee thuộc department mà user được quản lý |
| Company | `company_id = auth.company_id` |
| System | Liên company, chỉ cho Super Admin hoặc endpoint nội bộ đặc biệt |

### 9.4 Scope helper

```ts
type AttendanceScopeFilter = {
  companyId: string;
  employeeIds?: string[];
  departmentIds?: string[];
  ownEmployeeId?: string;
  system?: boolean;
};

interface AttendanceScopeService {
  buildScopeFilter(actor: AuthContext, permission: string): Promise<AttendanceScopeFilter>;
  assertCanAccessEmployee(actor: AuthContext, employeeId: string, permission: string): Promise<void>;
  assertCanAccessRecord(actor: AuthContext, recordId: string, permission: string): Promise<void>;
}
```

---

## 10. Controller design

### 10.1 Today Attendance Controller

```text
GET /api/v1/attendance/today
```

Trách nhiệm:

1. Resolve current employee từ auth context.
2. Resolve work date theo timezone company.
3. Lấy shift đang áp dụng.
4. Lấy rule đang áp dụng.
5. Kiểm tra public holiday/weekend.
6. Kiểm tra leave Approved.
7. Kiểm tra remote Approved.
8. Lấy attendance record nếu đã có.
9. Tính action được phép: can_check_in, can_check_out, can_create_adjustment_request, can_create_remote_request.
10. Mask dữ liệu nhạy cảm.
11. Trả `AttendanceTodayResponse`.

Không được:

1. Tạo record mới nếu chỉ gọi GET today, trừ khi có policy explicit auto-init.
2. Tự xử lý nghiệp vụ leave/remote ngoài việc đọc context.
3. Tin work_date từ frontend nếu không có rule cho phép xem ngày khác.

### 10.2 Check Controller

```text
POST /api/v1/attendance/check-in
POST /api/v1/attendance/check-out
```

Trách nhiệm:

1. Kiểm tra permission check-in/check-out.
2. Resolve employee active/probation.
3. Dùng server time.
4. Validate source WEB/MOBILE.
5. Validate GPS/note/photo nếu rule yêu cầu.
6. Chống duplicate bằng unique constraint, lock hoặc idempotency key.
7. Ghi attendance log.
8. Tạo/cập nhật attendance record.
9. Tính lại status/minutes.
10. Ghi audit log nếu cấu hình yêu cầu.
11. Emit event.

### 10.3 Attendance Record Controller

```text
GET  /api/v1/attendance/my-records
GET  /api/v1/attendance/team-records
GET  /api/v1/attendance/records
GET  /api/v1/attendance/records/{id}
GET  /api/v1/attendance/records/{id}/logs
POST /api/v1/attendance/records/{id}/manual-adjust
POST /api/v1/attendance/records/{id}/recalculate
POST /api/v1/attendance/exports
```

Trách nhiệm:

1. Áp permission và data scope.
2. Whitelist filter/search/sort.
3. Không trả sensitive fields ở list.
4. Chỉ trả log chi tiết khi có quyền detail.
5. Manual adjust phải có reason, before/after snapshot, audit log.
6. Export phải kiểm tra quyền export và quyền sensitive nếu xuất GPS/IP/device.

### 10.4 Adjustment Controller

```text
GET  /api/v1/attendance/my-adjustment-requests
POST /api/v1/attendance/adjustment-requests
GET  /api/v1/attendance/adjustment-requests
GET  /api/v1/attendance/adjustment-requests/{id}
POST /api/v1/attendance/adjustment-requests/{id}/approve
POST /api/v1/attendance/adjustment-requests/{id}/reject
POST /api/v1/attendance/adjustment-requests/{id}/cancel
```

Trách nhiệm:

1. Employee chỉ tạo request cho record của chính mình.
2. Manager chỉ duyệt request của team.
3. HR/Admin duyệt theo company/scope.
4. Request pending mới được approve/reject/cancel.
5. Không cho approve request nếu record đã bị khóa kỳ công.
6. Lock request và record khi approve/reject.
7. Khi approve, apply adjustment item vào attendance record và recalculate.
8. Ghi audit log và notification event.

### 10.5 Remote Controller

```text
GET  /api/v1/attendance/my-remote-requests
POST /api/v1/attendance/remote-requests
GET  /api/v1/attendance/remote-requests
GET  /api/v1/attendance/remote-requests/{id}
POST /api/v1/attendance/remote-requests/{id}/approve
POST /api/v1/attendance/remote-requests/{id}/reject
POST /api/v1/attendance/remote-requests/{id}/cancel
```

Trách nhiệm:

1. Kiểm tra setting công ty có bật remote/công tác không.
2. Validate ngày remote không nằm trong leave full day Approved.
3. Validate không trùng request pending/approved cùng ngày nếu policy không cho phép.
4. Khi approve, nếu rule remote là auto attendance, tạo/cập nhật attendance record.
5. Nếu remote mode là self check-in/out, mở quyền check-in/out remote theo rule.
6. Leave Approved luôn ưu tiên cao hơn remote.

### 10.6 Shift và Rule Controller

```text
GET    /api/v1/attendance/shifts
POST   /api/v1/attendance/shifts
GET    /api/v1/attendance/shifts/{id}
PATCH  /api/v1/attendance/shifts/{id}
DELETE /api/v1/attendance/shifts/{id}

GET    /api/v1/attendance/shift-assignments
POST   /api/v1/attendance/shift-assignments
PATCH  /api/v1/attendance/shift-assignments/{id}
DELETE /api/v1/attendance/shift-assignments/{id}

GET    /api/v1/attendance/rules
POST   /api/v1/attendance/rules
PATCH  /api/v1/attendance/rules/{id}
DELETE /api/v1/attendance/rules/{id}
GET    /api/v1/attendance/effective-rule
```

Trách nhiệm:

1. Kiểm tra quyền config.
2. Validate effective date.
3. Validate assignment target theo scope.
4. Validate overlap.
5. Không xóa cứng nếu đã có record liên quan.
6. Ghi audit log.
7. Invalidate cache shift/rule.
8. Nếu thay đổi rule/shift có ảnh hưởng dữ liệu tương lai, không cần recalculate quá khứ tự động.
9. Nếu admin chủ động chạy recalculate quá khứ, phải dùng internal/recalculate có audit.

---

## 11. Service design

### 11.1 AttendanceTodayService

Trách nhiệm:

1. Resolve context của ngày hiện tại.
2. Build attendance today DTO.
3. Tính trạng thái button/action.
4. Mask sensitive fields.

Pseudo flow:

```text
getToday(actor):
  employee = hrEmployeeResolver.getCurrentEmployee(actor)
  assertEmployeeCanUseAttendance(employee)
  companyTimezone = settingService.getCompanyTimezone(actor.company_id)
  workDate = dateService.today(companyTimezone)

  shift = shiftResolver.resolve(employee, workDate)
  rule = ruleResolver.resolve(employee, workDate)
  leave = leaveGuard.getApprovedLeaveContext(employee, workDate)
  remote = remoteResolver.getApprovedRemoteContext(employee, workDate)
  record = recordRepo.findByEmployeeDateShift(company, employee, workDate, shift)

  actions = actionResolver.resolve({employee, shift, rule, leave, remote, record})
  return mapper.toTodayDto({employee, shift, rule, leave, remote, record, actions})
```

### 11.2 CheckInService

Trách nhiệm:

1. Kiểm tra permission.
2. Validate employee status.
3. Validate leave/remote/rule.
4. Tạo/cập nhật record.
5. Ghi log thô.
6. Emit event.

Pseudo flow:

```text
checkIn(actor, dto, idempotencyKey):
  assertPermission(actor, ATT.ATTENDANCE.CHECK_IN)
  employee = currentEmployee(actor)
  now = serverClock.now(companyTimezone)
  workDate = workDateResolver.resolve(now, employee, dto.source)

  withIdempotency(idempotencyKey):
    withTransaction:
      lock(attendance:{companyId}:{employeeId}:{workDate})
      context = attendanceContextResolver.resolve(employee, workDate)
      validateCanCheckIn(context, dto)

      record = recordRepo.findOrCreateDraft(context)
      assertNotAlreadyCheckedIn(record)

      log = logRepo.createCheckInLog(record, employee, dto, now)
      updatedRecord = calculationService.applyCheckIn(record, log, context)
      recordRepo.save(updatedRecord)

      audit.optional(...)
      # Không phát NOTI event cho self check-in. Invalidate dashboard cache (§19).
      dashboardCache.invalidate(...)
      return mapper.toRecordDto(updatedRecord)
```

### 11.3 CheckOutService

Trách nhiệm:

1. Kiểm tra permission.
2. Validate đã check-in.
3. Validate chưa check-out.
4. Ghi checkout log.
5. Tính working minutes, late, early leave, missing.
6. Emit event.

Pseudo flow:

```text
checkOut(actor, dto, idempotencyKey):
  assertPermission(actor, ATT.ATTENDANCE.CHECK_OUT)
  employee = currentEmployee(actor)
  now = serverClock.now(companyTimezone)
  workDate = workDateResolver.resolve(now, employee, dto.source)

  withIdempotency(idempotencyKey):
    withTransaction:
      lock(attendance:{companyId}:{employeeId}:{workDate})
      context = attendanceContextResolver.resolve(employee, workDate)
      record = recordRepo.findRequired(context)
      validateCanCheckOut(record, context, dto)

      log = logRepo.createCheckOutLog(record, employee, dto, now)
      updatedRecord = calculationService.applyCheckOut(record, log, context)
      recordRepo.save(updatedRecord)

      audit.optional(...)
      # Không phát NOTI event cho self check-out. Invalidate dashboard cache (§19).
      dashboardCache.invalidate(...)
      return mapper.toRecordDto(updatedRecord)
```

### 11.4 AttendanceCalculationService

Trách nhiệm:

1. Tính `working_minutes`.
2. Tính `required_working_minutes`.
3. Trừ leave half day/hourly nếu có.
4. Áp remote rule nếu có.
5. Tính late/early/missing.
6. Xác định attendance_status.
7. Tạo calculation_snapshot.

Input:

```ts
type AttendanceCalculationInput = {
  employee: EmployeeSnapshot;
  shift: ShiftSnapshot | null;
  rule: AttendanceRuleSnapshot;
  leaveContext?: LeaveAttendanceContext;
  remoteContext?: RemoteAttendanceContext;
  record: AttendanceRecord;
  logs: AttendanceLog[];
  now?: Date;
};
```

Output:

```ts
type AttendanceCalculationResult = {
  requiredWorkingMinutes: number;
  workingMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  missingMinutes: number;
  overtimeMinutes: number;
  attendanceStatus: AttendanceStatus;
  checkInStatus?: string;
  checkOutStatus?: string;
  calculationSnapshot: Record<string, unknown>;
};
```

### 11.5 ShiftResolverService

Thứ tự resolve shift:

```text
1. Employee assignment active theo ngày
2. Department assignment active theo ngày
3. Company assignment active theo ngày
4. Default shift của company
5. No shift nếu công ty cho phép flexible/no-shift
```

Yêu cầu:

1. Filter theo `company_id`.
2. Chỉ lấy assignment active, không deleted.
3. Kiểm tra effective date.
4. Nếu nhiều assignment cùng priority, báo lỗi cấu hình hoặc lấy priority cao nhất theo rule đã chốt.
5. Cache theo key `attendance:shift:{companyId}:{employeeId}:{workDate}` TTL ngắn.

### 11.6 AttendanceRuleResolverService

Thứ tự resolve rule:

```text
1. Employee rule active theo ngày
2. Department rule active theo ngày
3. Company rule active theo ngày
4. System/default rule
```

Yêu cầu:

1. Rule phải có status Active.
2. Rule phải nằm trong effective date.
3. Lưu `applied_rule_id` và snapshot vào record khi tính công.
4. Cache theo key `attendance:rule:{companyId}:{employeeId}:{workDate}` TTL ngắn.
5. Invalidate cache khi cập nhật rule.

### 11.7 AttendanceLeaveGuardService

Trách nhiệm:

1. Đọc record `Leave` trong `attendance_records` do event LEAVE tạo (không gọi LEAVE realtime lúc check-in). Cơ chế contract: xem §16.4.
2. Kiểm tra full day, half day, hourly từ record/context đã được ghi.
3. Chặn check-in/out nếu leave full day.
4. Giảm required minutes nếu leave half day/hourly.
5. Cung cấp context cho calculation service.
6. Consume event leave approved/cancelled/revoked để ghi/cập nhật record `Leave` và recalculate.

Rule:

```text
Leave Approved full day > Remote Approved > Auto Attendance > Manual Check-in/out
```

### 11.8 AttendanceAdjustmentService

Trách nhiệm:

1. Tạo request điều chỉnh.
2. Validate field được phép điều chỉnh.
3. Validate record thuộc employee/scope.
4. Chặn tạo request trùng pending cho cùng field/record nếu policy không cho phép.
5. Approve/reject/cancel.
6. Apply adjustment item vào record.
7. Tính lại record.
8. Ghi audit và notification.

Field whitelist MVP (theo DB-04 §7.7):

```text
check_in_at
check_out_at
attendance_status
note
work_mode
working_minutes   # chỉ HR/Admin (manual adjust) được đề xuất; employee không được
```

Không cho employee tự đề xuất sửa:

```text
working_minutes   # HR/Admin-only field
source            # nguồn chấm công do hệ thống ghi, không cho employee đề xuất
company_id
employee_id
department_id
applied_rule_id
calculation_snapshot
created_by
updated_by
locked_at
```

### 11.9 ManualAdjustmentService

Dùng cho HR/Admin điều chỉnh công trực tiếp.

Yêu cầu:

1. Có permission `ATT.ATTENDANCE.ADJUST_DIRECT`.
2. Có data scope phù hợp.
3. Record chưa bị khóa kỳ công.
4. Bắt buộc nhập reason.
5. Lưu before/after snapshot.
6. Ghi attendance log source `MANUAL` hoặc audit log.
7. Recalculate sau khi sửa.
8. Emit notification cho employee nếu cấu hình bật.

### 11.10 RemoteWorkRequestService

Trách nhiệm:

1. Employee tạo remote/công tác.
2. Manager/HR duyệt/từ chối.
3. Khi approve, apply remote context vào ATT.
4. Nếu `attendance_mode = AUTO_ATTENDANCE`, tạo attendance record source `REMOTE`.
5. Nếu `attendance_mode = SELF_CHECK_IN`, cho phép check-in/out remote theo rule.
6. Nếu `attendance_mode = NO_ATTENDANCE`, không tạo record tự động.
7. Nếu remote bị cancel/reject/revoked, recalculate record liên quan.
8. Leave full day Approved chặn remote hoặc khiến remote không được apply.

### 11.11 AttendanceRecalculateService

Dùng khi:

1. Leave Approved/Cancelled/Revoked.
2. Remote Approved/Cancelled.
3. HR/Admin manual adjust.
4. Rule/shift thay đổi và admin chủ động tính lại.
5. Job phát hiện missing checkout.
6. Auto checkout/auto attendance.

Input:

```ts
type RecalculateAttendanceInput = {
  companyId: string;
  employeeId?: string;
  recordId?: string;
  fromDate?: string;
  toDate?: string;
  reason: string;
  sourceEvent?: string;
  actorUserId?: string | null;
};
```

Yêu cầu:

1. Có transaction.
2. Lock record khi tính.
3. Không sửa record locked nếu không có override.
4. Lưu calculation_snapshot mới.
5. Ghi audit/system log.
6. Phát event nội bộ recalculated (không phải NOTI người dùng) để invalidate dashboard cache.

---

## 12. Business flow chi tiết

### 12.1 Flow GET today

```text
User mở màn chấm công hôm nay
-> Backend resolve auth context
-> Resolve employee từ HR
-> Kiểm tra employee active/probation
-> Resolve company timezone
-> Tính work_date
-> Resolve shift
-> Resolve rule
-> Kiểm tra public holiday/weekend
-> Kiểm tra leave Approved
-> Kiểm tra remote Approved
-> Lấy attendance_record nếu có
-> Tính action được phép
-> Mask dữ liệu nhạy cảm
-> Trả AttendanceTodayResponse
```

Kết quả trả về phải đủ để frontend hiển thị:

1. Hôm nay đã check-in chưa.
2. Có thể check-in/check-out không.
3. Vì sao bị disable.
4. Đang áp dụng ca nào.
5. Đang áp dụng rule nào.
6. Có leave/remote ảnh hưởng không.
7. Có pending adjustment không.

### 12.2 Flow check-in

```text
Employee bấm Check-in
-> Backend kiểm tra ATT.ATTENDANCE.CHECK_IN
-> Resolve employee
-> Kiểm tra trạng thái nhân viên
-> Dùng server time
-> Resolve work_date theo timezone
-> Resolve shift/rule/leave/remote
-> Nếu leave full day Approved: chặn
-> Nếu rule yêu cầu GPS/note/photo: validate
-> Lock employee + work_date + shift
-> Tìm hoặc tạo attendance_record
-> Nếu đã check-in: trả conflict hoặc idempotent response
-> Tạo attendance_log type CHECK_IN
-> Update attendance_record.check_in_at
-> Tính late/check_in_status
-> Lưu calculation_snapshot
-> Ghi audit nếu cần
-> Không phát NOTI event cho self check-in
-> Invalidate dashboard cache
-> Trả record/today response
```

### 12.3 Flow check-out

```text
Employee bấm Check-out
-> Backend kiểm tra ATT.ATTENDANCE.CHECK_OUT
-> Resolve employee
-> Dùng server time
-> Resolve work_date
-> Lock record
-> Nếu chưa check-in: lỗi
-> Nếu đã check-out: conflict hoặc idempotent response
-> Validate rule
-> Tạo attendance_log type CHECK_OUT
-> Update check_out_at
-> Tính working_minutes, early_leave, missing, status
-> Lưu calculation_snapshot
-> Ghi audit nếu cần
-> Không phát NOTI event cho self check-out
-> Invalidate dashboard cache
-> Trả record/today response
```

### 12.4 Flow bảng công cá nhân/team/company

```text
User gọi list records
-> Backend kiểm tra permission tương ứng
-> Build data scope filter
-> Whitelist filter/search/sort
-> Query attendance_records theo company_id + scope + date range
-> Join/batch load employee/department/shift summary
-> Mask sensitive fields
-> Trả pagination response
```

Không được:

1. Trả GPS/IP/device mặc định ở list.
2. Cho frontend truyền arbitrary SQL sort/filter.
3. Query không có `company_id`.
4. Query team bằng cách tin employee_id từ frontend.

### 12.5 Flow tạo adjustment request

```text
Employee tạo yêu cầu điều chỉnh công
-> Kiểm tra ATT.ADJUSTMENT.CREATE_OWN
-> Resolve employee hiện tại
-> Kiểm tra attendance_record thuộc employee
-> Kiểm tra record chưa locked
-> Validate request_type
-> Validate adjustment items theo whitelist
-> Validate file bằng chứng nếu có
-> Kiểm tra pending request trùng
-> Tạo request status Pending
-> Tạo adjustment items
-> Link file private nếu có
-> Ghi audit log
-> Emit ATT_ADJUSTMENT_SUBMITTED
-> Notify direct manager/HR theo policy
```

### 12.6 Flow approve adjustment

```text
Manager/HR approve adjustment
-> Kiểm tra ATT.ADJUSTMENT.APPROVE
-> Kiểm tra request thuộc scope
-> Lock request + attendance_record
-> Kiểm tra request status Pending
-> Kiểm tra record chưa locked
-> Apply adjustment items vào record
-> Recalculate attendance record
-> Update request Approved, reviewed_by, reviewed_at
-> Ghi audit before/after
-> Emit ATT_ADJUSTMENT_APPROVED
-> Notify employee
-> Invalidate dashboard cache
```

### 12.7 Flow reject adjustment

```text
Manager/HR reject adjustment
-> Kiểm tra ATT.ADJUSTMENT.REJECT
-> Kiểm tra scope
-> Lock request
-> Kiểm tra status Pending
-> Update Rejected + review_note
-> Ghi audit
-> Emit ATT_ADJUSTMENT_REJECTED
-> Notify employee
```

### 12.8 Flow manual adjust

```text
HR/Admin mở record
-> Bấm điều chỉnh trực tiếp
-> Backend kiểm tra ATT.ATTENDANCE.ADJUST_DIRECT
-> Kiểm tra scope
-> Lock record
-> Kiểm tra record chưa locked
-> Validate field và reason
-> Lưu before snapshot
-> Apply patch
-> Recalculate
-> Lưu after snapshot
-> Ghi attendance_log log_type = Manual
-> Ghi audit
-> Notify employee nếu cấu hình bật (không phải NOTI event chuẩn; dùng kênh thông báo nội bộ/audit)
```

### 12.9 Flow remote request

```text
Employee gửi remote/công tác
-> Kiểm tra ATT.REMOTE_REQUEST.CREATE_OWN
-> Kiểm tra setting cho phép remote
-> Validate date range
-> Kiểm tra không trùng leave full day Approved
-> Kiểm tra không trùng remote pending/approved nếu policy cấm
-> Tạo remote request Pending
-> Ghi audit
-> Emit ATT_REMOTE_REQUEST_SUBMITTED
-> Notify manager/HR
```

### 12.10 Flow approve remote

```text
Manager/HR approve remote
-> Kiểm tra ATT.REMOTE_REQUEST.APPROVE
-> Kiểm tra scope
-> Lock request
-> Kiểm tra status Pending
-> Kiểm tra leave Approved lần cuối
-> Update Approved
-> Tạo approval log
-> Nếu attendance_mode AUTO_ATTENDANCE: tạo/cập nhật attendance record source REMOTE
-> Nếu attendance_mode SELF_CHECK_IN: record sẽ tạo khi employee check-in/out
-> Ghi audit
-> Emit ATT_REMOTE_REQUEST_APPROVED
-> Notify employee
-> Invalidate dashboard cache
```

---

## 13. Transaction, locking và idempotency

### 13.1 Khi nào bắt buộc transaction

| Nghiệp vụ | Transaction |
| --- | --- |
| Check-in | Có |
| Check-out | Có |
| Approve adjustment | Có |
| Manual adjust | Có |
| Approve remote auto attendance | Có |
| Recalculate record | Có |
| Auto checkout job | Có |
| Auto attendance job | Có |
| Shift/rule config | Có nếu có nhiều bảng/log liên quan |

### 13.2 Lock chống trùng check-in/out

Khuyến nghị dùng một trong hai cách:

1. DB unique constraint + retry friendly.
2. Advisory lock theo key:

```text
attendance:{company_id}:{employee_id}:{work_date}:{shift_id_or_none}
```

### 13.3 Idempotency-Key

Các endpoint action nên hỗ trợ `Idempotency-Key`:

```text
POST /attendance/check-in
POST /attendance/check-out
POST /attendance/adjustment-requests/{id}/approve
POST /attendance/remote-requests/{id}/approve
POST /attendance/records/{id}/manual-adjust
POST /attendance/exports
```

Quy tắc:

1. Cùng actor + endpoint + idempotency key + body hash thì trả lại kết quả cũ.
2. Cùng key nhưng body khác thì trả lỗi `IDEMPOTENCY-ERR-409`.
3. TTL idempotency key theo cấu hình, ví dụ 24h.
4. Không dùng idempotency để bỏ qua permission/business validation.

### 13.4 Optimistic concurrency

Với approve adjustment và manual adjust, nên kiểm tra:

```text
record.updated_at hoặc record.version
request.updated_at hoặc request.version
```

Nếu record đã thay đổi sau khi request được tạo, có thể:

1. Tự recalculate nếu an toàn.
2. Yêu cầu reviewer xác nhận lại.
3. Trả lỗi conflict.

---

## 14. Validation rules

### 14.1 Employee validation

1. User phải liên kết với employee.
2. Employee phải thuộc company hiện tại.
3. Employee phải ở trạng thái được chấm công: Probation hoặc Official.
4. Employee đã resigned/terminated không được check-in/out.
5. Employee tạm nghỉ xử lý theo setting công ty.

### 14.2 Check-in validation

1. Có permission `ATT.ATTENDANCE.CHECK_IN`.
2. Không có leave full day Approved.
3. Nếu ngày lễ/cuối tuần, rule phải cho phép.
4. Source phải được rule cho phép: web/mobile/remote.
5. Nếu rule yêu cầu GPS, request phải có GPS hợp lệ.
6. Nếu rule yêu cầu note/photo, request phải có note/photo.
7. Không được check-in hai lần cho cùng record nếu policy không cho phép.
8. Không dùng client_time làm thời gian nghiệp vụ.

### 14.3 Check-out validation

1. Có permission `ATT.ATTENDANCE.CHECK_OUT`.
2. Record phải tồn tại hoặc policy cho phép tạo missing-check-in.
3. Record phải đã check-in.
4. Record chưa check-out.
5. Không có leave full day Approved.
6. Nếu rule yêu cầu GPS/note/photo, validate tương tự check-in.
7. `check_out_at` theo server time phải >= `check_in_at`.

### 14.4 Shift validation

1. `shift_code` unique theo company.
2. Fixed shift cần start/end time.
3. Flexible shift cần required working minutes.
4. `required_working_minutes > 0`.
5. Không xóa mềm shift đã có records; chỉ inactive.
6. Cross-day shift phải được calculation service hỗ trợ.

### 14.5 Rule validation

1. `rule_code` unique theo company.
2. Scope target đúng: Company không có department/employee, Department có department, Employee có employee.
3. Effective date hợp lệ.
4. Không overlap gây mâu thuẫn nếu cùng scope/target/priority.
5. Rule update không làm thay đổi record quá khứ nếu không chạy recalculation.

### 14.6 Adjustment validation

1. Chỉ record trong scope mới được điều chỉnh.
2. Employee chỉ tạo request cho chính mình.
3. Record chưa locked.
4. Field điều chỉnh nằm trong whitelist.
5. Không có pending request trùng field/record nếu policy cấm.
6. Review note bắt buộc khi reject.
7. Reason bắt buộc khi tạo request hoặc manual adjust.
8. File bằng chứng phải qua file service private.

### 14.7 Remote validation

1. Công ty phải bật remote/công tác.
2. Date range hợp lệ.
3. Không trùng leave full day Approved.
4. Không trùng remote pending/approved nếu policy cấm.
5. Nếu remote yêu cầu task/project, validate task/project thuộc scope.
6. Manager không được tự approve request của chính mình nếu policy cấm.

---

## 15. Error code đề xuất

| Code | Message gợi ý | HTTP |
| --- | --- | --- |
| `ATT-ERR-001` | Tài khoản chưa liên kết với hồ sơ nhân viên | 400 |
| `ATT-ERR-002` | Nhân viên không ở trạng thái được chấm công | 403 |
| `ATT-ERR-003` | Bạn đã có đơn nghỉ phép được duyệt trong ngày này | 409 |
| `ATT-ERR-004` | Không tìm thấy ca làm hợp lệ | 400 |
| `ATT-ERR-005` | Không tìm thấy rule chấm công hợp lệ | 400 |
| `ATT-ERR-006` | Bạn đã check-in rồi | 409 |
| `ATT-ERR-007` | Bạn chưa check-in nên không thể check-out | 409 |
| `ATT-ERR-008` | Bạn đã check-out rồi | 409 |
| `ATT-ERR-009` | Rule yêu cầu GPS nhưng request không có GPS hợp lệ | 422 |
| `ATT-ERR-010` | Rule yêu cầu ghi chú | 422 |
| `ATT-ERR-011` | Rule yêu cầu ảnh xác nhận | 422 |
| `ATT-ERR-012` | Bản ghi công đã bị khóa, không thể chỉnh sửa | 409 |
| `ATT-ERR-013` | Yêu cầu điều chỉnh không ở trạng thái Pending | 409 |
| `ATT-ERR-014` | Field điều chỉnh không được phép | 422 |
| `ATT-ERR-015` | Remote request trùng với đơn nghỉ phép đã duyệt | 409 |
| `ATT-ERR-016` | Remote request không ở trạng thái Pending | 409 |
| `ATT-ERR-017` | Dữ liệu chấm công không nằm trong phạm vi được phép | 403 |
| `ATT-ERR-018` | Bạn không có quyền xem dữ liệu nhạy cảm | 403 |
| `ATT-ERR-019` | Cấu hình ca làm bị overlap | 409 |
| `ATT-ERR-020` | Cấu hình rule bị overlap | 409 |
| `ATT-ERR-021` | Không thể export dữ liệu nhạy cảm khi thiếu quyền | 403 |
| `ATT-ERR-022` | Bản ghi công đã thay đổi, vui lòng tải lại dữ liệu | 409 |

---

## 16. Event design

### 16.1 Event ATT phát ra

Tên event dùng đúng registry NOTI chuẩn (prefix `ATT_`, `UPPER_SNAKE`). Không phát biến thể `ATTENDANCE_*_DETECTED`/`ATTENDANCE_CHECKED_IN`. Không có event cho self check-in/check-out.

| Event | Khi nào phát |
| --- | --- |
| `ATT_MISSING_CHECKOUT` | Job phát hiện quên check-out |
| `ATT_LATE_DETECTED` | Phát hiện đi muộn (nếu company bật cảnh báo) |
| `ATT_ABSENT_DETECTED` | Job phát hiện vắng mặt |
| `ATT_ADJUSTMENT_SUBMITTED` | Employee gửi điều chỉnh |
| `ATT_ADJUSTMENT_APPROVED` | Điều chỉnh được duyệt |
| `ATT_ADJUSTMENT_REJECTED` | Điều chỉnh bị từ chối |
| `ATT_AUTO_ATTENDANCE_CREATED` | Job auto attendance tạo công |
| `ATT_REMOTE_REQUEST_SUBMITTED` | Employee gửi remote/công tác |
| `ATT_REMOTE_REQUEST_APPROVED` | Remote/công tác được duyệt |
| `ATT_REMOTE_REQUEST_REJECTED` | Remote/công tác bị từ chối |
| `ATT_REMOTE_REQUEST_CANCELLED` | Remote/công tác bị hủy |

> Recalculate, export, rule/shift change và manual-adjust là sự kiện nội bộ/audit, không phát NOTI người dùng; ghi audit log theo §17 và invalidate dashboard cache theo §19.

### 16.2 Event ATT consume

| Event nguồn | Module | Hành động ATT |
| --- | --- | --- |
| `LEAVE_REQUEST_APPROVED` | LEAVE | Tạo/cập nhật record Leave, chặn check-in/out, recalculate |
| `LEAVE_REQUEST_CANCELLED` | LEAVE | Restore/recalculate required minutes |
| `LEAVE_REQUEST_REVOKED` | LEAVE | Restore/recalculate required minutes |
| `EMPLOYEE_STATUS_CHANGED` | HR | Chặn hoặc cho phép chấm công theo trạng thái mới |
| `EMPLOYEE_DEPARTMENT_CHANGED` | HR | Snapshot record mới theo department mới, không sửa record quá khứ nếu không recalculate |
| `PUBLIC_HOLIDAY_CREATED` | FOUNDATION | Recalculate nếu holiday ảnh hưởng rule |
| `PUBLIC_HOLIDAY_UPDATED` | FOUNDATION | Recalculate nếu holiday ảnh hưởng rule |

### 16.3 Payload event tối thiểu

```json
{
  "event_id": "uuid",
  "event_type": "ATT_ADJUSTMENT_SUBMITTED",
  "company_id": "company-uuid",
  "actor_user_id": "user-uuid",
  "employee_id": "employee-uuid",
  "resource_type": "attendance_adjustment_request",
  "resource_id": "request-uuid",
  "occurred_at": "2026-06-20T18:00:00+07:00",
  "payload": {
    "work_date": "2026-06-20",
    "request_type": "MISSING_CHECK_OUT",
    "request_code": "ATT-ADJ-2026-0001"
  }
}
```

### 16.4 Hợp đồng LEAVE → ATT (schema payload dùng chung)

Cơ chế chuẩn (đồng bộ với BACKEND-07 §13.8): LEAVE ghi outbox event `LEAVE_REQUEST_APPROVED/CANCELLED/REVOKED` → worker đẩy sang ATT; ATT **ghi/cập nhật record `Leave`** trong `attendance_records`. Guard check-in của ATT **đọc record `Leave` đó** (xem §11.7), **không gọi LEAVE realtime** lúc check-in.

ATT consume payload theo schema dùng chung sau (khớp BACKEND-07 §13.8):

```json
{
  "event_name": "LEAVE_REQUEST_APPROVED",
  "company_id": "uuid",
  "leave_request_id": "uuid",
  "employee_id": "uuid",
  "days": [
    { "leave_request_day_id": "uuid", "attendance_date": "2026-06-20",
      "duration_type": "FullDay", "leave_minutes": 480, "half_day_session": null }
  ],
  "occurred_at": "ISO8601"
}
```

Quy tắc ATT khi consume:

1. Khóa ngày = `attendance_date` (khớp cột `attendance_records.work_date`/ngày công ATT).
2. ATT link record `Leave` theo cặp `leave_request_id` + `leave_request_day_id` để có thể restore/recalculate khi `CANCELLED`/`REVOKED`.
3. `duration_type` dùng enum LEAVE chuẩn (`FullDay/HalfDay/Hourly/MultipleDays`); `half_day_session` xác định buổi khi `HalfDay`.
4. `leave_minutes` (thay cho `leave_hours`) dùng để giảm `required_working_minutes` khi half day/hourly; full day → `required_working_minutes = 0`, status `Leave`.

---

## 17. Audit log

### 17.1 Thao tác bắt buộc ghi audit

| Action | Resource |
| --- | --- |
| `ATT_SHIFT_CREATED` | shift |
| `ATT_SHIFT_UPDATED` | shift |
| `ATT_SHIFT_DISABLED` | shift |
| `ATT_SHIFT_ASSIGNMENT_CHANGED` | shift_assignment |
| `ATT_RULE_CREATED` | attendance_rule |
| `ATT_RULE_UPDATED` | attendance_rule |
| `ATT_RULE_DISABLED` | attendance_rule |
| `ATT_CHECK_IN` | attendance_record nếu setting bật |
| `ATT_CHECK_OUT` | attendance_record nếu setting bật |
| `ATT_ADJUSTMENT_SUBMITTED` | attendance_adjustment_request |
| `ATT_ADJUSTMENT_APPROVED` | attendance_adjustment_request + attendance_record |
| `ATT_ADJUSTMENT_REJECTED` | attendance_adjustment_request |
| `ATT_MANUAL_ADJUSTED` | attendance_record |
| `ATT_REMOTE_REQUEST_SUBMITTED` | remote_work_request |
| `ATT_REMOTE_REQUEST_APPROVED` | remote_work_request |
| `ATT_REMOTE_REQUEST_REJECTED` | remote_work_request |
| `ATT_AUTO_ATTENDANCE_CREATED` | attendance_record |
| `ATT_RECORD_RECALCULATED` | attendance_record |
| `ATT_EXPORT_CREATED` | export/file |

### 17.2 Audit payload

Audit log nên lưu:

1. `company_id`.
2. `actor_user_id`.
3. `actor_employee_id` nếu có.
4. `resource_type`.
5. `resource_id`.
6. `action`.
7. `before_snapshot`.
8. `after_snapshot`.
9. `reason`.
10. `ip_address` masked nếu cần.
11. `user_agent`.
12. `request_id`.
13. `idempotency_key` nếu có.

---

## 18. Notification integration

### 18.1 Notification khi adjustment

| Event | Người nhận |
| --- | --- |
| `ATT_ADJUSTMENT_SUBMITTED` | Direct manager, HR nếu policy bật |
| `ATT_ADJUSTMENT_APPROVED` | Employee tạo request |
| `ATT_ADJUSTMENT_REJECTED` | Employee tạo request |

### 18.2 Notification khi remote

| Event | Người nhận |
| --- | --- |
| `ATT_REMOTE_REQUEST_SUBMITTED` | Direct manager, HR nếu policy bật |
| `ATT_REMOTE_REQUEST_APPROVED` | Employee tạo request |
| `ATT_REMOTE_REQUEST_REJECTED` | Employee tạo request |
| `ATT_REMOTE_REQUEST_CANCELLED` | Người liên quan nếu đã có approval flow |

### 18.3 Notification khi bất thường

| Event | Người nhận |
| --- | --- |
| `ATT_MISSING_CHECKOUT` | Employee |
| `ATT_LATE_DETECTED` | Employee hoặc manager nếu policy bật |
| `ATT_ABSENT_DETECTED` | Employee, manager hoặc HR theo policy |

> Manual-adjust không có NOTI event chuẩn; thông báo cho employee (nếu bật) đi qua kênh nội bộ/audit, không phải registry NOTI.

ATT chỉ phát event. NOTI chịu trách nhiệm template, delivery, unread count và channel.

---

## 19. Dashboard/cache integration

### 19.1 Widget bị ảnh hưởng

| Widget | Khi invalidate |
| --- | --- |
| Attendance Today | Check-in/out, leave approved/cancelled, remote approved/cancelled |
| My Attendance Summary | Check-in/out, adjustment approved, recalculate |
| Team Attendance Summary | Check-in/out của employee trong team, missing checkout, absent |
| Pending Adjustment | Adjustment submitted/approved/rejected |
| Remote Request Pending | Remote submitted/approved/rejected |
| HR Attendance Overview | Check-in/out, absent, missing checkout, manual adjust |
| Attendance Anomaly | Missing checkout, missing hours, late/early leave |

### 19.2 Cache invalidation event

```json
{
  "event_type": "DASHBOARD_CACHE_INVALIDATE",
  "company_id": "company-uuid",
  "source_module": "ATT",
  "keys": [
    "dashboard:employee:{employee_id}:attendance_today",
    "dashboard:manager:{manager_employee_id}:team_attendance"
  ],
  "reason": "ATT_CHECK_IN"
}
```

ATT không tự ghi dashboard_widget_cache nếu không có service dùng chung đã chốt. Khuyến nghị ATT chỉ emit event để DASH xử lý.

---

## 20. Sensitive data và masking

### 20.1 Dữ liệu nhạy cảm

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

### 20.2 Policy trả dữ liệu

| API | Sensitive mặc định |
| --- | --- |
| List attendance records | Không trả GPS/IP/device |
| Detail attendance record | Chỉ trả nếu có VIEW_DETAIL + VIEW_SENSITIVE |
| Logs | Chỉ trả nếu có VIEW_DETAIL |
| Export | Cần EXPORT; nếu chứa GPS/IP cần VIEW_SENSITIVE hoặc setting riêng |
| Employee own today | Có thể trả trạng thái hợp lệ GPS, không cần trả tọa độ chi tiết |
| File bằng chứng | Luôn private URL, kiểm tra permission trước khi cấp link |

### 20.3 Masking service

```ts
interface AttendanceSensitiveFieldService {
  maskRecord(record: AttendanceRecordDto, actor: AuthContext): AttendanceRecordDto;
  maskLog(log: AttendanceLogDto, actor: AuthContext): AttendanceLogDto;
  canViewSensitive(actor: AuthContext): Promise<boolean>;
}
```

---

## 21. Query và performance

### 21.1 Query bắt buộc có company_id

Mọi repository query của ATT phải có `company_id`, trừ endpoint System scope đặc biệt.

Không được viết:

```sql
SELECT * FROM attendance_records WHERE employee_id = $1;
```

Phải viết:

```sql
SELECT * FROM attendance_records
WHERE company_id = $1
  AND employee_id = $2
  AND deleted_at IS NULL;
```

### 21.2 Index cần tận dụng

1. `attendance_records(company_id, employee_id, work_date DESC)`.
2. `attendance_records(company_id, department_id, work_date)`.
3. `attendance_records(company_id, work_date, attendance_status)`.
4. `attendance_logs(company_id, employee_id, log_time DESC)`.
5. `attendance_adjustment_requests(company_id, status, submitted_at)`.
6. `remote_work_requests(company_id, status, date_from, date_to)`.
7. `shift_assignments(company_id, employee_id, effective_from, effective_to)`.
8. `attendance_rules(company_id, employee_id, effective_from, effective_to)`.

### 21.3 Pagination

1. Records list dùng offset pagination trong MVP.
2. Log lớn dùng cursor pagination.
3. Export không được query toàn bộ vào memory.
4. Khi export lớn, dùng background job hoặc streaming.

### 21.4 N+1 prevention

List records không được load employee từng dòng. Cần:

1. Join projection nếu ORM hỗ trợ.
2. Batch load employees/departments/shifts.
3. Chỉ trả field summary cần thiết.
4. Không trả logs trong list.

### 21.5 Cache

Có thể cache:

1. Effective shift theo employee/date.
2. Effective rule theo employee/date.
3. Company attendance settings.
4. Public holidays theo company/year.
5. User permission/scope ở Auth layer.

Không cache:

1. Attendance record vừa thay đổi.
2. Pending adjustment count lâu hơn TTL ngắn.
3. Sensitive data response.

---

## 22. Jobs

### 22.1 MissingCheckoutJob

Mục đích:

1. Phát hiện record đã check-in nhưng chưa check-out sau ngưỡng cấu hình.
2. Mark `is_missing_check_out = true`.
3. Cập nhật status `Missing Check-out` hoặc `Missing Hours`.
4. Phát event `ATT_MISSING_CHECKOUT`.
5. Notify employee nếu cấu hình bật.

Tần suất đề xuất:

```text
Mỗi 30-60 phút hoặc cuối ngày làm việc theo timezone công ty.
```

### 22.2 AutoCheckoutJob

Mục đích:

1. Tự động check-out theo rule nếu bật `auto_check_out_enabled`.
2. Ghi log source `AUTO`.
3. Không chạy nếu record locked.
4. Không chạy nếu leave full day Approved.
5. Ghi audit/system log.

### 22.3 AutoAttendanceJob

Mục đích:

1. Tạo attendance record cho nhóm nhân viên/công việc đặc thù nếu rule bật auto attendance.
2. Tạo record source `AUTO` hoặc `REMOTE`.
3. Không tạo nếu có leave full day Approved.
4. Không tạo trùng record.
5. Ghi audit/system log.
6. Emit `ATT_AUTO_ATTENDANCE_CREATED`.

### 22.4 RecalculateJob

Mục đích:

1. Tính lại record theo batch khi leave/holiday/rule/shift thay đổi.
2. Có limit/batch size.
3. Có retry.
4. Có audit/system log.
5. Không sửa record locked nếu không có override.

---

## 23. API mapping sang service

| API | Controller | Service chính |
| --- | --- | --- |
| `GET /attendance/today` | AttendanceTodayController | AttendanceTodayService |
| `POST /attendance/check-in` | AttendanceCheckController | CheckInService |
| `POST /attendance/check-out` | AttendanceCheckController | CheckOutService |
| `GET /attendance/my-records` | AttendanceRecordController | AttendanceRecordService |
| `GET /attendance/team-records` | AttendanceRecordController | AttendanceRecordService |
| `GET /attendance/records` | AttendanceRecordController | AttendanceRecordService |
| `GET /attendance/records/{id}` | AttendanceRecordController | AttendanceRecordService |
| `GET /attendance/records/{id}/logs` | AttendanceRecordController | AttendanceLogService |
| `POST /attendance/records/{id}/manual-adjust` | AttendanceRecordController | ManualAdjustmentService |
| `POST /attendance/records/{id}/recalculate` | AttendanceRecordController | AttendanceRecalculateService |
| `POST /attendance/adjustment-requests` | AttendanceAdjustmentController | AttendanceAdjustmentService |
| `POST /attendance/adjustment-requests/{id}/approve` | AttendanceAdjustmentController | AttendanceAdjustmentService |
| `POST /attendance/adjustment-requests/{id}/reject` | AttendanceAdjustmentController | AttendanceAdjustmentService |
| `POST /attendance/remote-requests` | AttendanceRemoteController | RemoteWorkRequestService |
| `POST /attendance/remote-requests/{id}/approve` | AttendanceRemoteController | RemoteWorkRequestService |
| `GET /attendance/shifts` | AttendanceShiftController | ShiftService |
| `POST /attendance/shifts` | AttendanceShiftController | ShiftService |
| `POST /attendance/shift-assignments` | AttendanceShiftController | ShiftAssignmentService |
| `GET /attendance/rules` | AttendanceRuleController | AttendanceRuleService |
| `POST /attendance/rules` | AttendanceRuleController | AttendanceRuleService |
| `POST /attendance/exports` | AttendanceExportController | AttendanceExportService |
| `POST /internal/v1/attendance/recalculate` | AttendanceInternalController | AttendanceRecalculateService |

---

## 24. Request/response DTO triển khai

### 24.1 CheckInRequest

```ts
export type CheckInRequest = {
  source: 'WEB' | 'MOBILE';
  client_time?: string;
  client_timezone?: string;
  gps?: {
    latitude: number;
    longitude: number;
    accuracy_meters?: number;
  };
  device?: {
    device_id?: string;
    device_name?: string;
    device_type?: 'desktop' | 'mobile' | 'tablet';
  };
  note?: string;
  photo_file_id?: string;
};
```

### 24.2 CheckOutRequest

```ts
export type CheckOutRequest = {
  source: 'WEB' | 'MOBILE';
  client_time?: string;
  client_timezone?: string;
  gps?: {
    latitude: number;
    longitude: number;
    accuracy_meters?: number;
  };
  device?: {
    device_id?: string;
    device_name?: string;
    device_type?: 'desktop' | 'mobile' | 'tablet';
  };
  note?: string;
  photo_file_id?: string;
};
```

### 24.3 CreateAdjustmentRequest

```ts
export type CreateAttendanceAdjustmentRequest = {
  attendance_record_id: string;
  request_type:
    | 'MISSING_CHECK_IN'
    | 'MISSING_CHECK_OUT'
    | 'UPDATE_CHECK_IN'
    | 'UPDATE_CHECK_OUT'
    | 'EXPLAIN_LATE'
    | 'EXPLAIN_EARLY_LEAVE'
    | 'UPDATE_STATUS'
    | 'REMOTE_CORRECTION'
    | 'OTHER';
  reason: string;
  items: Array<{
    // Employee không được đề xuất working_minutes/source (HR/Admin-only / system-only)
    field_name: 'check_in_at' | 'check_out_at' | 'attendance_status' | 'note' | 'work_mode';
    new_value: string | number | boolean | null;
  }>;
  file_ids?: string[];
};
```

### 24.4 ReviewAdjustmentRequest

```ts
export type ReviewAttendanceAdjustmentRequest = {
  decision: 'approve' | 'reject';
  review_note?: string;
  expected_version?: string;
};
```

### 24.5 ManualAdjustAttendanceRequest

```ts
export type ManualAdjustAttendanceRequest = {
  reason: string;
  patch: {
    check_in_at?: string | null;
    check_out_at?: string | null;
    attendance_status?: string;
    work_mode?: string;
    note?: string | null;
  };
  expected_version?: string;
};
```

### 24.6 CreateRemoteWorkRequest

```ts
export type CreateRemoteWorkRequest = {
  request_type: 'Remote' | 'BusinessTrip' | 'Offsite';
  date_from: string;
  date_to: string;
  time_from?: string | null;
  time_to?: string | null;
  // DTO field `attendance_mode` map thẳng sang cột `remote_work_requests.attendance_mode` (DB-04 §7.8)
  attendance_mode?: 'SELF_CHECK_IN' | 'AUTO_ATTENDANCE' | 'NO_ATTENDANCE';
  reason: string;
  task_id?: string | null;
  project_id?: string | null;
  file_ids?: string[];
};
```

---

## 25. Security checklist

| Hạng mục | Bắt buộc |
| --- | --- |
| Mọi API public yêu cầu access token | Có |
| Backend resolve company_id từ auth context | Có |
| Không tin employee_id/company_id từ frontend khi check-in/out | Có |
| Backend kiểm tra permission + data scope | Có |
| Check-in/out dùng server time | Có |
| GPS/IP/device bị mask nếu thiếu quyền | Có |
| File bằng chứng qua private file service | Có |
| Export có audit log | Có |
| Export sensitive cần quyền riêng | Có |
| Internal API không public frontend | Có |
| Job có system actor rõ ràng | Có |
| Audit before/after cho manual adjust | Có |
| Idempotency cho action quan trọng | Nên có |
| Rate limit check-in/out | Nên có |
| Request body validation whitelist | Có |
| Không log raw GPS/IP quá chi tiết vào application log | Có |

---

## 26. Testing strategy

### 26.1 Unit test

| Service | Test cần có |
| --- | --- |
| AttendanceCalculationService | Tính late, early, missing, required minutes, leave half/hourly |
| ShiftResolverService | Employee > Department > Company > default |
| AttendanceRuleResolverService | Employee > Department > Company > default |
| AttendanceLeaveGuardService | Full day chặn, half/hourly giảm required minutes |
| CheckInService | Check-in hợp lệ, duplicate, leave full day, employee inactive |
| CheckOutService | Checkout hợp lệ, chưa check-in, duplicate checkout |
| AdjustmentService | Create, approve, reject, cancel, invalid field |
| RemoteWorkRequestService | Create, approve auto attendance, reject, leave conflict |
| SensitiveFieldService | Mask GPS/IP/device theo quyền |
| RecalculateService | Recalculate theo leave/remote/rule |

### 26.2 Integration test

1. Check-in tạo attendance_record + attendance_log.
2. Check-out cập nhật attendance_record + attendance_log.
3. Check-in hai lần không tạo record trùng.
4. Leave Approved full day chặn check-in.
5. Leave half day giảm required working minutes.
6. Manager chỉ xem/duyệt adjustment của team.
7. HR xem records company khi có scope Company.
8. User biết UUID record công ty khác vẫn không xem được.
9. Approve adjustment cập nhật record và audit log.
10. Manual adjust có before/after snapshot.
11. Approve remote auto tạo record source REMOTE.
12. Export không chứa GPS/IP nếu thiếu quyền sensitive.
13. MissingCheckoutJob mark missing checkout đúng timezone.
14. Recalculate event từ LEAVE cập nhật record.

### 26.3 E2E test flow

```text
Login employee
-> GET /attendance/today
-> POST /attendance/check-in
-> GET /attendance/today
-> POST /attendance/check-out
-> GET /attendance/my-records
```

```text
Employee quên check-out
-> POST adjustment request
-> Manager approve
-> Record được cập nhật
-> Employee nhận notification
```

```text
Employee gửi remote request
-> Manager approve
-> Today cho phép remote check-in hoặc auto attendance theo rule
```

### 26.4 Concurrency test

1. Gửi 2 request check-in cùng lúc.
2. Gửi 2 request check-out cùng lúc.
3. Manager A và HR B cùng approve một adjustment.
4. Leave approved đồng thời với check-in.
5. Auto attendance job chạy đồng thời với remote approve.

Kỳ vọng:

1. Không tạo record trùng.
2. Không approve request hai lần.
3. Không ghi sai status khi leave full day thắng remote/check-in.
4. Trả conflict/idempotent response rõ ràng.

---

## 27. Observability

### 27.1 Log nghiệp vụ

Log nên có:

1. `request_id`.
2. `actor_user_id`.
3. `company_id`.
4. `employee_id`.
5. `resource_id`.
6. `action`.
7. `result`.
8. `error_code` nếu lỗi.
9. Không log raw GPS/IP đầy đủ nếu không cần.

### 27.2 Metrics

| Metric | Ý nghĩa |
| --- | --- |
| `attendance_check_in_total` | Số lượt check-in |
| `attendance_check_out_total` | Số lượt check-out |
| `attendance_check_in_conflict_total` | Số request check-in trùng |
| `attendance_adjustment_pending_total` | Số adjustment pending |
| `attendance_missing_checkout_total` | Số missing checkout |
| `attendance_recalculate_duration_ms` | Thời gian tính lại công |
| `attendance_export_duration_ms` | Thời gian export |
| `attendance_job_failed_total` | Số job lỗi |

### 27.3 Alert

1. Missing checkout job failed.
2. Auto attendance job failed.
3. Recalculate queue backlog cao.
4. Export job thất bại nhiều lần.
5. Số conflict check-in tăng bất thường.
6. Query attendance records vượt ngưỡng thời gian.

---

## 28. Migration/seed checklist cho ATT Backend

BACKEND-06 không viết lại migration DB-04 nhưng trước khi code phải kiểm tra:

1. Bảng `shifts` đã có migration.
2. Bảng `shift_assignments` đã có migration.
3. Bảng `attendance_rules` đã có migration.
4. Bảng `attendance_records` đã có unique index chống trùng employee/date/shift.
5. Bảng `attendance_logs` đã có index theo employee/log_time.
6. Bảng `attendance_adjustment_requests` và items đã có index status/submitted_at.
7. Bảng `remote_work_requests` và approvals đã có index date/status.
8. Permission ATT đã seed.
9. Role-permission matrix đã gán quyền ATT mặc định.
10. Notification events ATT đã seed.
11. Dashboard widgets liên quan ATT đã seed.
12. Default shift/rule đã seed cho company mặc định nếu cần.
13. Public holiday service sẵn sàng.
14. File service private sẵn sàng.
15. Audit log service sẵn sàng.

---

## 29. Implementation roadmap

### Sprint 1 - Attendance Core

1. Tạo attendance module structure.
2. Implement repository cho attendance_records và attendance_logs.
3. Implement CurrentEmployee resolver integration từ HR.
4. Implement ShiftResolver cơ bản.
5. Implement RuleResolver cơ bản.
6. Implement AttendanceTodayService.
7. Implement CheckInService.
8. Implement CheckOutService.
9. Implement calculation cơ bản: fixed shift, late, early leave, missing hours.
10. Test check-in/out và today.

Acceptance criteria:

1. Employee active có thể check-in/check-out.
2. Dùng server time.
3. Không tạo record trùng.
4. Leave full day Approved bị chặn nếu LEAVE context đã có.
5. API trả đúng response format.

### Sprint 2 - Records, Scope & Sensitive Fields

1. Implement my records.
2. Implement team records.
3. Implement company records.
4. Implement detail record.
5. Implement logs.
6. Implement scope filter.
7. Implement sensitive field masking.
8. Implement pagination/filter/sort whitelist.
9. Test permission và data scope.

Acceptance criteria:

1. Employee chỉ thấy dữ liệu của mình.
2. Manager chỉ thấy team.
3. HR/Admin thấy company nếu có quyền.
4. GPS/IP/device không lộ ở list.
5. Direct URL trái scope bị chặn.

### Sprint 3 - Shift & Rule Config

1. Implement Shift CRUD.
2. Implement ShiftAssignment CRUD.
3. Implement AttendanceRule CRUD.
4. Implement effective shift/rule endpoint.
5. Validate overlap.
6. Cache shift/rule.
7. Invalidate cache khi cập nhật.
8. Audit log config.

Acceptance criteria:

1. Ca và rule gán theo Employee > Department > Company.
2. Rule update không tự sửa record quá khứ.
3. Audit log đầy đủ.

### Sprint 4 - Adjustment Workflow

1. Implement create adjustment request.
2. Implement my adjustment list.
3. Implement scope list pending.
4. Implement approve/reject/cancel.
5. Implement manual adjust.
6. Implement file link bằng chứng.
7. Emit notification events.
8. Test concurrency approve.

Acceptance criteria:

1. Employee gửi request cho record của mình.
2. Manager duyệt team.
3. HR duyệt company.
4. Approve cập nhật record và recalculate.
5. Manual adjust có audit before/after.

### Sprint 5 - Remote, Jobs & Export

1. Implement remote request.
2. Implement remote approve/reject/cancel.
3. Implement auto attendance khi remote approved nếu rule bật.
4. Implement missing checkout job.
5. Implement auto checkout job nếu MVP bật.
6. Implement export attendance.
7. Implement internal recalculate.
8. Hook events từ LEAVE.
9. Invalidate dashboard cache.

Acceptance criteria:

1. Remote Approved ảnh hưởng today/record đúng rule.
2. Leave full day ưu tiên hơn remote.
3. Missing checkout job tạo event.
4. Export theo scope và không lộ sensitive nếu thiếu quyền.
5. LEAVE event làm ATT recalculate đúng.

---

## 30. Acceptance criteria tổng thể

BACKEND-06 hoàn thành khi:

1. Có đủ controller cho Today, Check-in/out, Records, Adjustment, Remote, Shift, Rule, Export, Internal.
2. Có đủ service/repository tách domain rõ ràng.
3. Check-in/check-out chạy bằng server time.
4. Không tạo trùng record cho cùng employee/date/shift.
5. Attendance log luôn được ghi khi check-in/check-out.
6. Bảng công list/detail tuân thủ permission và data scope.
7. Sensitive fields được mask đúng.
8. Shift/rule resolve đúng thứ tự ưu tiên.
9. Leave Approved chặn hoặc tính lại công đúng rule.
10. Adjustment workflow có create/approve/reject/cancel.
11. Manual adjust có audit before/after.
12. Remote request có create/approve/reject/cancel và apply vào ATT.
13. Jobs missing checkout/auto attendance hoạt động theo setting.
14. Event sang NOTI/DASH được phát đúng.
15. Audit log có cho thao tác quan trọng.
16. Unit/integration/e2e tests phủ luồng P0.
17. Không có query ATT thiếu `company_id`.
18. Không có dữ liệu GPS/IP/device lộ trong response trái quyền.
19. Có OpenAPI/Swagger tag và schema tương ứng.
20. Có checklist release và rollback.

---

## 31. Rủi ro và biện pháp kiểm soát

| Rủi ro | Mức độ | Biện pháp |
| --- | --- | --- |
| Check-in trùng khi user bấm nhiều lần | Cao | Unique constraint + lock + idempotency |
| Sai ngày công do timezone | Cao | Company timezone service, server time, test cross-day |
| Leave Approved và check-in xảy ra đồng thời | Cao | Lock record, leave priority, recalculate event |
| Rule thay đổi làm sai dữ liệu quá khứ | Trung bình | Lưu calculation_snapshot, không recalculate tự động nếu không yêu cầu |
| Manager xem dữ liệu ngoài team | Cao | Scope filter từ HR, test permission |
| GPS/IP bị lộ | Cao | Sensitive masking, permission riêng, audit export |
| Export bảng công nặng | Trung bình | Background job/streaming, limit, audit |
| Approval adjustment bị double submit | Trung bình | Lock request, status transition, idempotency |
| Missing checkout job chạy sai timezone | Trung bình | Job theo company timezone, test nhiều timezone |
| N+1 query bảng công | Trung bình | Projection/batch load, query review |
| Remote và leave trùng ngày | Trung bình | Leave full day ưu tiên, validate trước approve và khi recalculate |

---

## 32. Checklist bàn giao cho Frontend

Frontend cần biết:

1. Endpoint today trả `actions.can_check_in`, `actions.can_check_out`, `disabled_reason`.
2. Frontend không gửi `company_id` khi check-in/out.
3. Frontend không gửi `employee_id` cho check-in/out cá nhân.
4. Frontend truyền `Idempotency-Key` cho action quan trọng nếu client hỗ trợ.
5. Frontend không tự tính late/missing; backend trả kết quả.
6. Frontend hiển thị disabled reason từ backend.
7. Frontend không tự quyết định dữ liệu sensitive.
8. Frontend dùng endpoint detail/log để xem dữ liệu chi tiết.
9. Frontend xử lý conflict/idempotent response thân thiện.
10. Frontend upload file bằng chứng qua File API trước, sau đó gửi `file_ids`.

---

## 33. Checklist bàn giao cho QA

QA cần test theo 6 nhóm:

1. Core attendance: today, check-in, check-out, duplicate.
2. Permission/scope: Own, Team, Department, Company, System.
3. Rule/shift: resolve priority, fixed/flexible, holiday/weekend.
4. Leave/remote: leave full/half/hourly, remote self/auto.
5. Adjustment/manual: create, approve, reject, cancel, direct adjust.
6. Security/performance: sensitive mask, export, concurrency, query pagination.

---

## 34. Kết luận

BACKEND-06 triển khai module ATT theo hướng:

1. Employee là chủ thể nghiệp vụ trung tâm.
2. Backend là nguồn kiểm soát quyền, scope, rule và thời gian.
3. Record tổng hợp và log thô được tách rõ.
4. Rule engine và shift resolver được thiết kế để mở rộng.
5. Leave Approved có ưu tiên cao nhất trong xử lý ngày công.
6. Remote/công tác nằm trong ATT vì vẫn là trạng thái đi làm.
7. Audit, notification, dashboard cache và security masking là phần bắt buộc, không phải phần phụ.
8. Thiết kế đủ chắc cho MVP và đủ mở cho mobile, thiết bị chấm công, payroll, overtime, import và AI ở phase sau.

Sau BACKEND-06, bước tiếp theo nên triển khai:

```text
BACKEND-07: Leave Backend
```

BACKEND-07 cần đặc biệt bám vào contract đồng bộ giữa LEAVE và ATT: khi leave Approved/Cancelled/Revoked, ATT phải nhận event để tạo/cập nhật/tính lại `attendance_records`.
