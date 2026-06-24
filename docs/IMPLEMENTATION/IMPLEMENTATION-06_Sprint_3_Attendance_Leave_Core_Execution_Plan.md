# IMPLEMENTATION-06: Sprint 3 Attendance & Leave Core Execution Plan
# KẾ HOẠCH THỰC THI SPRINT 3 - CHẤM CÔNG & NGHỈ PHÉP CORE

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | IMPLEMENTATION-06 |
| Tên tài liệu | Sprint 3 Attendance & Leave Core Execution Plan |
| Dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Giai đoạn | MVP Version 1.0 |
| Sprint | Sprint 3 |
| Trọng tâm | ATT + LEAVE Core |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-04, SPEC-05, DB-04, DB-05, DB-08, DB-10, API-04, API-05, UI-03, UI-04, UI-09, FRONTEND-04 |
| Sprint phụ thuộc | Sprint 1 Foundation, Sprint 2 Auth & HR Core |
| Sprint tiếp theo | IMPLEMENTATION-07: Sprint 4 Task, Notification & Dashboard Execution Plan |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả kế hoạch triển khai Sprint 3 cho hai module lõi:

```text
ATT   - Chấm công
LEAVE - Nghỉ phép
```

Sprint 3 có mục tiêu đưa hệ thống từ trạng thái đã có nền tảng `Foundation + AUTH + HR` sang trạng thái người dùng có thể thực hiện các nghiệp vụ vận hành hằng ngày:

1. Employee xem trạng thái chấm công hôm nay.
2. Employee check-in/check-out.
3. Employee xem bảng công cá nhân cơ bản.
4. Manager/HR xem bảng công theo phạm vi quyền cơ bản.
5. Employee xem số dư phép.
6. Employee tạo, lưu nháp và gửi đơn nghỉ.
7. Manager/HR duyệt hoặc từ chối đơn nghỉ.
8. Đơn nghỉ `Approved` đồng bộ sang chấm công.
9. Nếu nghỉ cả ngày, hệ thống chặn check-in/check-out.
10. Nếu nghỉ nửa ngày/theo giờ, hệ thống giảm thời gian công yêu cầu.
11. Backend ghi audit log và phát notification event tối thiểu.
12. Frontend có màn hình core đủ dùng cho ATT và LEAVE.
13. QA có bộ test case nghiệp vụ, permission, data scope và regression giữa ATT - LEAVE.

Tài liệu này dùng cho Product Owner, Tech Lead, Backend, Frontend, QA và DevOps để thống nhất phạm vi, thứ tự công việc, checklist nghiệm thu và rủi ro triển khai.

---

## 3. Bối cảnh Sprint 3

### 3.1 Trạng thái đầu vào giả định

Sprint 3 bắt đầu sau khi các phần sau đã hoàn thành ở Sprint 1 và Sprint 2:

| Nhóm | Trạng thái kỳ vọng |
| --- | --- |
| Project setup | Backend, frontend, database, env local/staging đã chạy được |
| Foundation | Company, module catalog, setting, audit log, file metadata, sequence cơ bản đã có |
| AUTH | Login/logout, session, role, permission, data scope, route/API guard đã hoạt động |
| HR | Employee, department, position, direct manager, employment status, user-employee mapping đã có |
| API client | Frontend có API client, query layer, error handling, auth refresh và query key convention |
| Layout | Home Portal, App Switcher, Module Workspace layout tối thiểu đã sẵn sàng hoặc có skeleton |
| QA base | Test environment, seed user/role/employee, smoke test auth/hr đã có |

### 3.2 Lý do ATT và LEAVE cần triển khai cùng sprint

ATT và LEAVE có liên kết nghiệp vụ rất chặt:

```text
Đơn nghỉ Approved ảnh hưởng trực tiếp đến nút check-in/check-out,
required working minutes và trạng thái ngày công.
```

Nếu triển khai ATT mà chưa có LEAVE sync, bảng công sẽ thiếu trạng thái nghỉ phép. Nếu triển khai LEAVE mà chưa có ATT integration, đơn nghỉ được duyệt nhưng không tác động đến ngày công. Vì vậy Sprint 3 gom hai module này vào cùng một execution plan.

---

## 4. Mục tiêu Sprint

### 4.1 Sprint goal

```text
Hoàn thiện luồng vận hành core của Chấm công và Nghỉ phép để Employee, Manager và HR có thể dùng được các nghiệp vụ hằng ngày trong MVP.
```

### 4.2 Kết quả cần đạt cuối sprint

Cuối Sprint 3, hệ thống phải demo được các flow sau trên môi trường staging:

1. Employee đăng nhập, mở app Chấm công.
2. Employee thấy trạng thái hôm nay và nút hành động hợp lệ.
3. Employee check-in thành công.
4. Employee check-out thành công.
5. Employee xem bảng công cá nhân.
6. Employee gửi yêu cầu điều chỉnh công tối thiểu hoặc mở được màn placeholder có state rõ ràng nếu chưa đưa vào scope xử lý đầy đủ.
7. Employee mở app Nghỉ phép.
8. Employee xem số dư phép.
9. Employee tạo đơn nghỉ full day hoặc half day.
10. Employee gửi đơn nghỉ.
11. Manager nhận danh sách đơn chờ duyệt theo team.
12. Manager duyệt đơn nghỉ.
13. Đơn nghỉ Approved được sync sang ATT.
14. Ngày nghỉ full day hiển thị `Leave` trong bảng công.
15. Ngày đã nghỉ full day disable check-in/check-out.
16. HR có thể xem danh sách bảng công và đơn nghỉ theo company nếu có quyền.
17. Notification event được ghi hoặc stubbed theo contract.
18. Audit log được ghi cho thao tác quan trọng.
19. API docs/OpenAPI được cập nhật cho endpoint Sprint 3.
20. QA regression xác nhận Auth/HR không bị phá vỡ.

---

## 5. Phạm vi Sprint 3

### 5.1 Trong phạm vi

| Module | Nhóm việc | Mô tả |
| --- | --- | --- |
| ATT | Today attendance | Lấy trạng thái hôm nay, ca/rule áp dụng, leave/remote context, allowed actions |
| ATT | Check-in/check-out | Check-in/out bằng web, dùng server time, ghi attendance record và attendance log |
| ATT | Attendance records | Bảng công cá nhân, team, company cơ bản theo permission/data scope |
| ATT | Attendance detail | Chi tiết ngày công gồm shift, rule, log, status, working minutes |
| ATT | Shift/rule default | Seed ca hành chính và rule cơ bản; CRUD có thể triển khai mức tối thiểu cho HR/Admin |
| ATT | Leave integration | Kiểm tra Approved leave để chặn/tính lại công |
| ATT | Adjustment skeleton | Tạo khung bảng/API/UI cho adjustment request nếu đủ thời gian; tối thiểu có backlog rõ |
| LEAVE | Leave type | Seed loại nghỉ phép cơ bản và API list |
| LEAVE | Leave balance | Employee xem số dư; HR điều chỉnh số dư tối thiểu nếu cần seed/demo |
| LEAVE | Leave request | Tạo nháp, cập nhật nháp, submit, xem danh sách, xem chi tiết, hủy nháp/pending |
| LEAVE | Approval | Manager/HR xem pending, approve, reject theo scope |
| LEAVE | Calculation | Preview ngày/giờ nghỉ, kiểm tra ngày lễ/ngày không làm việc cơ bản |
| LEAVE | ATT sync | Approved/Cancelled/Revoked sync sang ATT bằng service/event nội bộ |
| NOTI | Event contract | Ghi notification event hoặc gọi notification service stub |
| DASH | Cache invalidation | Invalidate widget liên quan hoặc ghi hook để Sprint sau dùng |
| QA | Test suite | API, permission, data scope, workflow, integration ATT-LEAVE |

### 5.2 Ngoài phạm vi Sprint 3

| Nhóm | Lý do đưa ra ngoài phạm vi |
| --- | --- |
| Tích hợp máy chấm công vật lý | Phase sau, cần device sync riêng |
| GPS/geofence nâng cao | Cần mobile/device policy riêng |
| Face recognition/QR attendance | Không thuộc core MVP Sprint 3 |
| Overtime | Phụ thuộc payroll/attendance period sau |
| Khóa kỳ công | Nên triển khai sau khi bảng công ổn định |
| Import Excel bảng công/nghỉ phép | Đưa sang phase vận hành hoặc Sprint hardening |
| Multi-level approval nâng cao | Sprint 3 chỉ làm single-level Manager/HR approval |
| Payroll calculation | Payroll là phase sau, chỉ chừa data contract |
| Calendar Google/Microsoft sync | Phase sau |
| Mobile native | Sprint 3 ưu tiên web app; API giữ mở cho mobile |

---

## 6. Nguyên tắc triển khai bắt buộc

### 6.1 Backend là nguồn kiểm soát quyền cuối cùng

Frontend được phép ẩn/hiện button, menu, widget và screen theo permission để cải thiện UX, nhưng backend phải luôn kiểm tra:

```text
authentication
permission
data_scope
target resource
business rule
company_id
audit requirement
notification event requirement
```

### 6.2 Không tin dữ liệu nhạy cảm từ client

Backend không tin các giá trị sau nếu có thể resolve từ auth context hoặc database:

```text
company_id
user_id
employee_id
role
permission
check_in_at
check_out_at
attendance_status
leave_calculated_days
leave_balance_after
```

Đặc biệt:

```text
Check-in/check-out phải dùng server time làm nguồn chính.
```

### 6.3 Employee là chủ thể nghiệp vụ

Cả ATT và LEAVE đều dùng `employees.id` làm khóa nghiệp vụ chính.

```text
user_id  = actor đăng nhập/thao tác
employee_id = chủ thể nghiệp vụ được chấm công/nghỉ phép
```

### 6.4 LEAVE Approved ưu tiên hơn ATT thủ công

Quy tắc ưu tiên:

```text
Approved full-day leave
-> chặn check-in/check-out
-> attendance_status = Leave
-> required_working_minutes = 0
```

```text
Approved half-day/hourly leave
-> không chặn toàn bộ check-in/check-out
-> giảm required_working_minutes
-> bỏ tính late/early tương ứng với phần nghỉ
```

### 6.5 Mọi query phải có tenant boundary

Tất cả query ATT/LEAVE phải filter bằng `company_id` lấy từ auth context.

```text
WHERE company_id = current_company_id
```

Không trả dữ liệu cross-company kể cả khi client biết UUID.

### 6.6 Ghi audit log cho thao tác quan trọng

Bắt buộc ghi audit log cho:

1. Check-in/check-out.
2. HR/Admin manual adjust nếu có.
3. Tạo/gửi/hủy đơn nghỉ.
4. Duyệt/từ chối/thu hồi đơn nghỉ.
5. Điều chỉnh số dư phép.
6. Cấu hình ca/rule/chính sách nghỉ.
7. Export dữ liệu nếu có.
8. Xem/tải file nhạy cảm nếu có.

---

## 7. Kiến trúc triển khai Sprint 3

### 7.1 Backend modules

```text
src/modules/attendance
  -> attendance.controller
  -> attendance.service
  -> attendance.repository
  -> attendance-rule.service
  -> attendance-calculation.service
  -> attendance-permission.service
  -> attendance-sync.service
  -> shift.service
  -> attendance-adjustment.service
  -> remote-work.service

src/modules/leave
  -> leave.controller
  -> leave-request.service
  -> leave-balance.service
  -> leave-calculation.service
  -> leave-approval.service
  -> leave-policy.service
  -> leave-sync.service
  -> leave-permission.service

src/modules/notification
  -> notification-event-producer hoặc stub

src/modules/audit
  -> audit-log.service
```

### 7.2 Frontend modules

```text
src/features/attendance
  -> pages/AttendanceTodayPage
  -> pages/MyAttendanceRecordsPage
  -> pages/TeamAttendanceRecordsPage
  -> pages/AttendanceRecordDetailPage
  -> pages/ShiftRuleSettingsPage
  -> components/AttendanceStatusCard
  -> components/CheckInOutActions
  -> api/attendance.api
  -> hooks/attendance.queries

src/features/leave
  -> pages/MyLeaveBalancePage
  -> pages/MyLeaveRequestsPage
  -> pages/CreateLeaveRequestPage
  -> pages/LeaveRequestDetailPage
  -> pages/LeaveApprovalPage
  -> pages/LeaveCalendarPage
  -> pages/LeaveSettingsPage
  -> components/LeaveBalanceCard
  -> components/LeaveRequestForm
  -> components/LeaveApprovalBox
  -> api/leave.api
  -> hooks/leave.queries
```

### 7.3 Database focus

Sprint 3 cần hoàn thiện migration và seed cho các bảng bắt buộc:

```text
ATT:
- shifts
- shift_assignments
- attendance_rules
- attendance_records
- attendance_logs
- attendance_adjustment_requests
- attendance_adjustment_items
- remote_work_requests
- remote_work_request_approvals

LEAVE:
- leave_types
- leave_policies
- leave_balances
- leave_balance_transactions
- leave_requests
- leave_request_days
- leave_request_approvals
```

Nếu muốn giảm scope kỹ thuật, có thể tạo đủ bảng nhưng chỉ expose API core trong Sprint 3.

---

## 8. Backlog Sprint 3 theo Epic

## 8.1 EPIC-S3-ATT-01: Attendance Today & Check-in/out Core

### Mục tiêu

Employee có thể xem trạng thái chấm công hôm nay và check-in/check-out đúng rule.

### User stories

| ID | User story | Priority |
| --- | --- | --- |
| S3-ATT-001 | Là Employee, tôi muốn xem hôm nay mình đã check-in/check-out chưa | P0 |
| S3-ATT-002 | Là Employee, tôi muốn check-in bằng web | P0 |
| S3-ATT-003 | Là Employee, tôi muốn check-out bằng web | P0 |
| S3-ATT-004 | Là Employee, tôi muốn biết vì sao nút check-in/out bị disable | P0 |
| S3-ATT-005 | Là hệ thống, tôi muốn dùng server time để ghi nhận giờ công | P0 |
| S3-ATT-006 | Là hệ thống, tôi muốn chặn check-in nếu hôm nay nhân viên nghỉ phép cả ngày đã duyệt | P0 |

### Backend tasks

- [ ] Tạo `AttendanceTodayService`.
- [ ] Tạo API `GET /api/v1/attendance/today`.
- [ ] Tạo API `POST /api/v1/attendance/check-in`.
- [ ] Tạo API `POST /api/v1/attendance/check-out`.
- [ ] Resolve current employee từ auth context + HR mapping.
- [ ] Kiểm tra employment status hợp lệ.
- [ ] Resolve shift/rule hiệu lực theo Employee -> Department -> Company.
- [ ] Fallback khi không có ca hiệu lực: nếu không resolve được shift/rule nào, dùng default shift/rule đã seed (`OFFICE_8H` / `DEFAULT_OFFICE_RULE`); nếu vẫn không có, cho phép check-in/out ở chế độ "no effective shift" (chỉ ghi log giờ, không tính late/early/missing) và trả lý do rõ ràng thay vì lỗi 500.
- [ ] Kiểm tra Approved leave trong ngày.
- [ ] Tạo hoặc update `attendance_records` bằng transaction.
- [ ] Ghi `attendance_logs` cho mỗi lần check-in/out.
- [ ] Tính late/early/missing/working minutes cơ bản.
- [ ] Ghi audit log.
- [ ] Phát notification event/stub nếu business rule cần.

### Frontend tasks

- [ ] Tạo route `/attendance/today`.
- [ ] Tạo `AttendanceTodayPage`.
- [ ] Tạo `AttendanceStatusCard`.
- [ ] Tạo `CheckInOutActions`.
- [ ] Tạo query hook `useAttendanceToday()`.
- [ ] Tạo mutation `useCheckIn()`, `useCheckOut()`.
- [ ] Hiển thị disabled reason rõ ràng.
- [ ] Invalidate query sau check-in/out.
- [ ] Hiển thị toast success/error.
- [ ] Xử lý loading, empty, forbidden, error state.

### Acceptance criteria

- [ ] Chưa check-in thì hiển thị nút Check-in.
- [ ] Sau check-in thì nút Check-in disable, Check-out enable.
- [ ] Sau check-out thì cả hai nút disable.
- [ ] Full-day Approved leave thì cả hai nút disable.
- [ ] API không nhận giờ check-in/out từ client làm nguồn chính.
- [ ] Check-in spam nhiều lần không tạo trùng record.
- [ ] Người đã nghỉ việc không được check-in.
- [ ] Không có ca hiệu lực (no effective shift): hệ thống fallback sang default shift/rule; nếu vẫn không có thì check-in/out không crash, status hiển thị rõ "chưa cấu hình ca", không tính late/early/missing sai.
- [ ] Audit log có actor, action, target, timestamp.

---

## 8.2 EPIC-S3-ATT-02: Attendance Records & Detail

### Mục tiêu

Employee, Manager và HR xem được bảng công theo phạm vi quyền.

### User stories

| ID | User story | Priority |
| --- | --- | --- |
| S3-ATT-010 | Là Employee, tôi muốn xem bảng công cá nhân theo tháng | P0 |
| S3-ATT-011 | Là Employee, tôi muốn xem chi tiết một ngày công | P0 |
| S3-ATT-012 | Là Manager, tôi muốn xem bảng công team | P1 |
| S3-ATT-013 | Là HR, tôi muốn xem bảng công toàn công ty | P1 |
| S3-ATT-014 | Là người có quyền, tôi muốn lọc bảng công theo ngày/trạng thái/phòng ban | P1 |

### Backend tasks

- [ ] API `GET /api/v1/attendance/my-records`.
- [ ] API `GET /api/v1/attendance/records/{record_id}`.
- [ ] API `GET /api/v1/attendance/team-records`.
- [ ] API `GET /api/v1/attendance/records` cho HR/Admin.
- [ ] Implement pagination, filter, sort whitelist.
- [ ] Apply data scope Own/Team/Department/Company.
- [ ] Mask GPS/IP/device trong list response.
- [ ] Không trả sensitive field nếu thiếu permission.
- [ ] Batch load employee summary để tránh N+1.

### Frontend tasks

- [ ] Tạo `MyAttendanceRecordsPage`.
- [ ] Tạo `TeamAttendanceRecordsPage`.
- [ ] Tạo `AttendanceRecordDetailPage`.
- [ ] Tạo table columns: ngày, ca, check-in, check-out, tổng giờ, trạng thái, nguồn, hành động.
- [ ] Tạo filter tháng/khoảng ngày/trạng thái.
- [ ] Tạo status badge cho Present/Late/Early/Missing/Leave.
- [ ] Xử lý permission để hiện/ẩn menu team/company.

### Acceptance criteria

- [ ] Employee chỉ xem được record của chính mình.
- [ ] Manager chỉ xem được team đúng scope.
- [ ] HR xem được company nếu có permission.
- [ ] Direct URL record ngoài scope bị 403 hoặc 404 theo policy.
- [ ] List không lộ GPS/IP/device chi tiết.
- [ ] Query có pagination và không bị N+1 rõ ràng.

---

## 8.3 EPIC-S3-ATT-03: Shift & Attendance Rule Minimum

### Mục tiêu

Có ca làm việc và rule chấm công cơ bản để ATT hoạt động ổn định.

### User stories

| ID | User story | Priority |
| --- | --- | --- |
| S3-ATT-020 | Là HR/Admin, tôi muốn có ca hành chính mặc định | P0 |
| S3-ATT-021 | Là HR/Admin, tôi muốn cấu hình giờ bắt đầu/kết thúc và break time | P1 |
| S3-ATT-022 | Là HR/Admin, tôi muốn gán ca theo company/department/employee | P1 |
| S3-ATT-023 | Là hệ thống, tôi muốn lấy rule hiệu lực để tính công | P0 |

### Backend tasks

- [ ] Seed default shift `OFFICE_8H`.
- [ ] Seed default attendance rule.
- [ ] API list shifts.
- [ ] API create/update shift nếu scope sprint cho phép.
- [ ] API list/update shift assignments nếu scope sprint cho phép.
- [ ] API list/update attendance rules nếu scope sprint cho phép.
- [ ] Service resolve effective shift/rule.
- [ ] Lưu snapshot rule khi tính `attendance_records`.

### Frontend tasks

- [ ] Settings page tối thiểu cho Shift/Rule hoặc placeholder rõ ràng.
- [ ] Form shift basic: code, name, type, start, end, break, required minutes.
- [ ] Form rule basic: grace late, grace early, allow web/mobile/remote flags.

### Acceptance criteria

- [ ] Hệ thống có default shift/rule sau seed.
- [ ] Check-in/out hoạt động ngay cả khi chưa cấu hình phức tạp.
- [ ] Rule change không làm sai dữ liệu quá khứ do có snapshot hoặc applied rule.

---

## 8.4 EPIC-S3-LEAVE-01: Leave Type, Policy & Balance Core

### Mục tiêu

Employee xem được số dư phép và hệ thống có loại nghỉ/chính sách nghỉ tối thiểu.

### User stories

| ID | User story | Priority |
| --- | --- | --- |
| S3-LEAVE-001 | Là Employee, tôi muốn xem số ngày phép còn lại | P0 |
| S3-LEAVE-002 | Là hệ thống, tôi muốn có danh mục loại nghỉ mặc định | P0 |
| S3-LEAVE-003 | Là HR, tôi muốn xem số dư phép nhân viên | P1 |
| S3-LEAVE-004 | Là HR, tôi muốn điều chỉnh số dư phép và có ledger | P1 |

### Backend tasks

- [ ] Seed leave types: Annual, Sick, Unpaid, Other.
- [ ] Seed leave policy cơ bản theo company.
- [ ] Seed leave balance demo hoặc tạo balance khi tạo employee.
- [ ] API `GET /api/v1/leave/me/balances`.
- [ ] API `GET /api/v1/leave/types`.
- [ ] API HR view balances nếu scope cho phép.
- [ ] API adjust balance nếu scope cho phép.
- [ ] Ghi `leave_balance_transactions` cho mọi thay đổi.

### Frontend tasks

- [ ] Tạo `MyLeaveBalancePage` hoặc widget trong Leave overview.
- [ ] Tạo `LeaveBalanceCard`.
- [ ] Tạo API hooks cho balances/types.
- [ ] Hiển thị balance theo leave type, used, reserved, remaining.
- [ ] HR balance page tối thiểu nếu đưa vào scope.

### Acceptance criteria

- [ ] Employee chỉ xem balance của mình.
- [ ] HR xem balance theo scope.
- [ ] Không sửa số dư nếu không tạo transaction ledger.
- [ ] Balance không âm nếu leave type không cho phép.

---

## 8.5 EPIC-S3-LEAVE-02: My Leave Request Workflow

### Mục tiêu

Employee tạo, lưu nháp, gửi, xem và hủy đơn nghỉ cơ bản.

### User stories

| ID | User story | Priority |
| --- | --- | --- |
| S3-LEAVE-010 | Là Employee, tôi muốn tạo đơn nghỉ phép | P0 |
| S3-LEAVE-011 | Là Employee, tôi muốn preview số ngày nghỉ trước khi gửi | P0 |
| S3-LEAVE-012 | Là Employee, tôi muốn lưu nháp đơn nghỉ | P1 |
| S3-LEAVE-013 | Là Employee, tôi muốn gửi đơn nghỉ để quản lý duyệt | P0 |
| S3-LEAVE-014 | Là Employee, tôi muốn xem danh sách đơn nghỉ của tôi | P0 |
| S3-LEAVE-015 | Là Employee, tôi muốn xem chi tiết đơn nghỉ | P0 |
| S3-LEAVE-016 | Là Employee, tôi muốn hủy đơn nháp hoặc pending theo policy | P1 |

### Backend tasks

- [ ] API `GET /api/v1/leave/me/requests`.
- [ ] API `POST /api/v1/leave/requests` tạo draft.
- [ ] API `PATCH /api/v1/leave/requests/{id}` cập nhật draft.
- [ ] API `POST /api/v1/leave/requests/{id}/submit`.
- [ ] API `POST /api/v1/leave/requests/{id}/cancel`.
- [ ] API `GET /api/v1/leave/requests/{id}`.
- [ ] API preview calculation.
- [ ] Validate leave type, duration, date range, balance, min notice.
- [ ] Validate overlap: từ chối đơn mới nếu trùng ngày/khoảng giờ với một đơn nghỉ `Approved` hoặc `Pending` khác của CÙNG employee (xem AC overlap bên dưới).
- [ ] Tạo `leave_request_days` khi preview/submit.
- [ ] Reserve balance nếu policy yêu cầu.
- [ ] Ghi approval log action `Submitted`.
- [ ] Ghi audit log.
- [ ] Phát event `LEAVE_REQUEST_SUBMITTED`.

### Frontend tasks

- [ ] Tạo `MyLeaveRequestsPage`.
- [ ] Tạo `CreateLeaveRequestPage`.
- [ ] Tạo `LeaveRequestForm`.
- [ ] Tạo date range picker, duration type, half-day selector.
- [ ] Tạo preview box: số ngày/giờ, balance trước/sau.
- [ ] Tạo submit/cancel action.
- [ ] Tạo `LeaveRequestDetailPage`.
- [ ] Hiển thị status stepper/timeline.
- [ ] Map validation error vào form.

### Acceptance criteria

- [ ] Employee không tạo đơn cho employee khác.
- [ ] Không submit nếu thiếu leave type/date/reason bắt buộc.
- [ ] Không submit nếu vượt balance và policy không cho âm.
- [ ] Draft có thể sửa; Pending không sửa trực tiếp.
- [ ] Submit chuyển trạng thái Draft -> Pending.
- [ ] Hủy Pending chuyển sang Cancelled nếu policy cho phép.
- [ ] Tạo `leave_request_days` đủ để ATT sync sau approve.
- [ ] **Overlap validation:** từ chối (422) đơn nghỉ mới nếu khoảng ngày trùng (kể cả trùng một phần half-day/hourly) với một đơn `Approved` hoặc `Pending` đang tồn tại của cùng employee; thông báo lỗi chỉ rõ đơn/ngày bị trùng. Đơn ở trạng thái `Rejected`/`Cancelled`/`Revoked` KHÔNG tính là trùng.
- [ ] **Hành vi với check-in đã tồn tại:** cho phép submit đơn nghỉ trên ngày đã có check-in/out, nhưng KHÔNG ghi đè dữ liệu chấm công tại bước submit; việc tính lại bảng công chỉ xảy ra khi đơn được Approved (qua LEAVE -> ATT sync, mục 8.7) và phần check-in/out đã có trên ngày đó phải được recalculate, không bị mất.

---

## 8.6 EPIC-S3-LEAVE-03: Leave Approval Workflow

### Mục tiêu

Manager/HR duyệt hoặc từ chối đơn nghỉ theo data scope.

### User stories

| ID | User story | Priority |
| --- | --- | --- |
| S3-LEAVE-020 | Là Manager, tôi muốn xem đơn nghỉ chờ duyệt của team | P0 |
| S3-LEAVE-021 | Là Manager, tôi muốn duyệt đơn nghỉ | P0 |
| S3-LEAVE-022 | Là Manager, tôi muốn từ chối đơn nghỉ và nhập lý do | P0 |
| S3-LEAVE-023 | Là HR, tôi muốn xem và xử lý đơn nghỉ toàn công ty nếu có quyền | P1 |
| S3-LEAVE-024 | Là hệ thống, tôi muốn giữ lịch sử xử lý đơn nghỉ | P0 |

### Backend tasks

- [ ] API `GET /api/v1/leave/requests?status=Pending` theo scope.
- [ ] API `POST /api/v1/leave/requests/{id}/approve`.
- [ ] API `POST /api/v1/leave/requests/{id}/reject`.
- [ ] Check permission `LEAVE.REQUEST.APPROVE/REJECT`.
- [ ] Check data scope Team/Department/Company.
- [ ] Check state transition Pending -> Approved/Rejected.
- [ ] Khi approve: convert reserve -> use hoặc trừ balance.
- [ ] Khi reject: release reserve nếu có.
- [ ] Ghi `leave_request_approvals`.
- [ ] Ghi audit log.
- [ ] Phát event `LEAVE_REQUEST_APPROVED/REJECTED`.
- [ ] Trigger sync sang ATT khi Approved.

### Frontend tasks

- [ ] Tạo `LeaveApprovalPage`.
- [ ] Tạo pending request table.
- [ ] Tạo approval detail drawer/modal.
- [ ] Tạo approve/reject confirmation.
- [ ] Tạo reject reason textarea.
- [ ] Invalidate list/detail/balance/calendar sau mutation.

### Acceptance criteria

- [ ] Manager chỉ thấy đơn của team.
- [ ] HR chỉ thấy company nếu có permission.
- [ ] Người không có quyền không thấy approve/reject button.
- [ ] Direct API approve ngoài scope bị chặn.
- [ ] Approve tạo sync event sang ATT.
- [ ] Reject không tạo attendance leave record.
- [ ] Mọi action có approval history.

---

## 8.7 EPIC-S3-INTEGRATION-01: LEAVE -> ATT Sync

### Mục tiêu

Đơn nghỉ được duyệt phải cập nhật hoặc tính lại bảng công chính xác.

### User stories

| ID | User story | Priority |
| --- | --- | --- |
| S3-SYNC-001 | Là hệ thống, tôi muốn Approved full-day leave tạo attendance status Leave | P0 |
| S3-SYNC-002 | Là hệ thống, tôi muốn half-day leave giảm required minutes | P0 |
| S3-SYNC-003 | Là hệ thống, tôi muốn hourly leave trừ leave minutes khỏi required minutes | P1 |
| S3-SYNC-004 | Là hệ thống, tôi muốn Cancelled/Revoked leave (kể cả đơn đã Approved + đã sync) tính lại attendance và hoàn/khôi phục balance idempotent | P1 (nếu defer phải tracked qua CO-S4-009, xem AC bên dưới) |
| S3-SYNC-005 | Là Employee, tôi không thể check-in ngày nghỉ full day đã duyệt | P0 |

### Backend tasks

- [ ] Tạo internal event handler `onLeaveApproved`.
- [ ] Tạo service `AttendanceLeaveSyncService`.
- [ ] Mapping `leave_request_days` sang `attendance_records`.
- [ ] Với full day: set status Leave, required minutes 0.
- [ ] Với half day: reduce required minutes.
- [ ] Với hourly: reduce required minutes theo minutes.
- [ ] Nếu record đã có check-in/out, recalculate.
- [ ] Cập nhật `leave_request_days.attendance_sync_status`.
- [ ] Lưu sync error nếu fail.
- [ ] Tạo retry hoặc manual recalculate endpoint nội bộ tối thiểu.
- [ ] Tạo handler `onLeaveCancelled`/`onLeaveRevoked` cho đơn ĐÃ Approved (đã sync ATT): tính lại `attendance_records` của các ngày liên quan VÀ release/restore lại balance một cách idempotent (xem S3-SYNC-004).

### Acceptance criteria

- [ ] Full-day Approved leave hiển thị trong bảng công là Leave.
- [ ] Full-day Approved leave disable check-in/out.
- [ ] Half-day Approved leave không disable toàn bộ check-in/out.
- [ ] Nếu sync thất bại, trạng thái sync được lưu và có log.
- [ ] Không tạo trùng attendance record cho cùng employee/date/shift.
- [ ] **(S3-SYNC-004) Cancel/Revoke đơn nghỉ ĐÃ Approved và ĐÃ sync sang ATT:** hệ thống PHẢI tính lại (`recalculate`) các `attendance_records` của những ngày bị ảnh hưởng - gỡ status `Leave`, khôi phục `required_working_minutes` về mức của shift/rule hiệu lực, và tính lại late/early/missing nếu đã có check-in/out trên ngày đó.
- [ ] **(S3-SYNC-004) Release/restore balance idempotent:** balance đã trừ/used khi approve phải được hoàn lại đúng số; chạy lại cùng một sự kiện cancel/revoke (retry) KHÔNG được hoàn phép hai lần (dùng idempotency key hoặc kiểm tra trạng thái sync trước khi áp dụng).
- [ ] **(S3-SYNC-004) Nếu defer khỏi Sprint 3:** PHẢI có backlog item được tracked (xem `CO-S4-009`) thay vì để mở mơ hồ; tài liệu không được để recalc/restore ở trạng thái "P1 maybe defer" không xác định.

---

## 8.8 EPIC-S3-FE-01: ATT & LEAVE Frontend Integration

### Mục tiêu

Người dùng có thể thao tác ATT/LEAVE bằng UI thống nhất trong Module Workspace.

### Routes đề xuất

```text
/attendance/today
/attendance/my-records
/attendance/team-records
/attendance/records
/attendance/records/:id
/attendance/settings/shifts
/attendance/settings/rules

/leave/overview
/leave/me/balances
/leave/me/requests
/leave/requests/new
/leave/requests/:id
/leave/approvals
/leave/calendar
/leave/settings/types
/leave/settings/policies
/leave/settings/balances
```

### Frontend tasks chung

- [ ] Cập nhật app registry cho ATT và LEAVE.
- [ ] Cập nhật sidebar registry theo permission.
- [ ] Tạo API service modules: `attendanceApi`, `leaveApi`.
- [ ] Tạo query key factory cho ATT/LEAVE.
- [ ] Tạo mutation invalidation matrix.
- [ ] Dùng component Design System: DataTable, StatusBadge, Modal, Drawer, Form, EmptyState, ErrorState.
- [ ] Map backend validation error vào form.
- [ ] Xử lý dirty form khi chuyển app.
- [ ] Kiểm thử responsive desktop/tablet/mobile web cho màn P0.

---

## 8.9 EPIC-S3-QA-01: QA, Regression & UAT Prep

### Mục tiêu

Đảm bảo ATT/LEAVE core đủ ổn định để demo và dùng làm nền cho Sprint 4.

### QA tasks

- [ ] Viết API test cho ATT Today, Check-in, Check-out.
- [ ] Viết API test cho Attendance Records scope Own/Team/Company.
- [ ] Viết API test cho Leave Balance.
- [ ] Viết API test cho Leave Request Draft/Submit/Cancel.
- [ ] Viết API test cho Leave Approval Approve/Reject.
- [ ] Viết integration test LEAVE Approved -> ATT record.
- [ ] Viết test chặn check-in khi full-day leave approved.
- [ ] Viết permission test cho Employee/Manager/HR/Admin.
- [ ] Viết data scope test cross-team/cross-company.
- [ ] Viết frontend smoke test cho các màn P0.
- [ ] Viết regression test Auth/HR mapping.
- [ ] Chuẩn bị UAT script demo cho PO.

---

## 9. Kế hoạch thực thi theo ngày

> Giả định sprint 2 tuần, 10 ngày làm việc. Nếu team dùng sprint length khác, giữ thứ tự ưu tiên và điều chỉnh timebox.

### Day 1 - Sprint planning & technical alignment

| Nhóm | Việc cần làm | Output |
| --- | --- | --- |
| PO/BA | Chốt scope Sprint 3 và P0/P1 | Sprint scope baseline |
| Tech Lead | Review DB/API/permission ATT-LEAVE | Technical checklist |
| Backend | Chốt schema migration và seed | Migration task list |
| Frontend | Chốt routes/sidebar/query keys | FE route map |
| QA | Chốt test strategy và UAT flow | QA checklist draft |

### Day 2 - Database migration & seed

| Nhóm | Việc cần làm | Output |
| --- | --- | --- |
| Backend | Migration ATT tables | ATT schema ready |
| Backend | Migration LEAVE tables | LEAVE schema ready |
| Backend | Seed permissions ATT/LEAVE | Permission seed ready |
| Backend | Seed default shift/rule/leave type | Business default ready |
| QA | Verify migration fresh DB | Migration smoke pass |

### Day 3 - ATT Today & Check-in backend

| Nhóm | Việc cần làm | Output |
| --- | --- | --- |
| Backend | Implement `GET /attendance/today` | Today API ready |
| Backend | Implement check-in | Check-in API ready |
| Backend | Implement calculation basic | Late/missing draft |
| Frontend | Build Attendance Today UI skeleton | FE skeleton ready |
| QA | API test draft | Test case draft |

### Day 4 - ATT Check-out & Records

| Nhóm | Việc cần làm | Output |
| --- | --- | --- |
| Backend | Implement check-out | Check-out API ready |
| Backend | Implement my records/detail | Records API ready |
| Backend | Implement Team/Company records base | Scope API draft |
| Frontend | Integrate today/check-in/check-out | UI usable |
| QA | Test check-in/out states | ATT smoke pass |

### Day 5 - LEAVE Balance & Request Draft/Submit

| Nhóm | Việc cần làm | Output |
| --- | --- | --- |
| Backend | Implement leave types/balance | Balance API ready |
| Backend | Implement create/update draft | Draft API ready |
| Backend | Implement submit + validation | Submit API ready |
| Frontend | Build leave balance/request form | Leave form draft |
| QA | Test leave request validation | Test draft |

### Day 6 - LEAVE Approval

| Nhóm | Việc cần làm | Output |
| --- | --- | --- |
| Backend | Implement pending list by scope | Approval list API |
| Backend | Implement approve/reject | Approval mutation ready |
| Backend | Implement balance transaction | Ledger ready |
| Frontend | Build approval page/detail drawer | Approval UI ready |
| QA | Test Manager/HR scope | Scope test draft |

### Day 7 - LEAVE -> ATT Sync

| Nhóm | Việc cần làm | Output |
| --- | --- | --- |
| Backend | Implement sync service | Sync ready |
| Backend | Implement full-day mapping | Leave status ready |
| Backend | Implement half-day/hourly base | Required minutes adjust |
| Backend | Update attendance today to read approved leave | Check-in block ready |
| Frontend | Display leave disabled reason | UX ready |
| QA | Integration test Approved leave -> ATT | Integration pass draft |

### Day 8 - Frontend completion & notification/audit hooks

| Nhóm | Việc cần làm | Output |
| --- | --- | --- |
| Backend | Add audit logs + notification events/stubs | Event/audit ready |
| Frontend | Finish attendance records pages | ATT FE ready |
| Frontend | Finish leave request/detail pages | LEAVE FE ready |
| Frontend | Add permission UI states | Guard ready |
| QA | Frontend smoke tests | Smoke report |

### Day 9 - Stabilization, regression & bug fixing

| Nhóm | Việc cần làm | Output |
| --- | --- | --- |
| Backend | Fix API bugs, optimize queries | RC build candidate |
| Frontend | Fix UI/form/state bugs | FE RC candidate |
| QA | Run API + E2E regression | Bug list |
| DevOps | Deploy staging RC | Staging ready |
| PO | Start UAT smoke | UAT feedback |

### Day 10 - Demo, acceptance & Sprint close

| Nhóm | Việc cần làm | Output |
| --- | --- | --- |
| Team | Sprint demo ATT/LEAVE core | Demo completed |
| QA | Final regression and release notes | QA sign-off draft |
| PO | Review acceptance criteria | PO acceptance |
| Tech Lead | Confirm tech debt/backlog | Carry-over list |
| Scrum/PM | Close sprint and plan next | Sprint report |

---

## 10. API checklist Sprint 3

### 10.1 ATT endpoints P0/P1

| Endpoint | Method | Priority | Ghi chú |
| --- | --- | --- | --- |
| `/api/v1/attendance/today` | GET | P0 | Trạng thái hôm nay + actions |
| `/api/v1/attendance/check-in` | POST | P0 | Dùng server time |
| `/api/v1/attendance/check-out` | POST | P0 | Tính working minutes |
| `/api/v1/attendance/my-records` | GET | P0 | Own scope |
| `/api/v1/attendance/records/{id}` | GET | P0 | Detail + logs cơ bản |
| `/api/v1/attendance/team-records` | GET | P1 | Manager scope |
| `/api/v1/attendance/records` | GET | P1 | HR/Admin scope |
| `/api/v1/attendance/shifts` | GET | P1 | List shift |
| `/api/v1/attendance/rules/effective` | GET | P1 | Effective rule |
| `/internal/v1/attendance/recalculate` | POST | P1 | Internal sync/recalculate |

### 10.2 LEAVE endpoints P0/P1

| Endpoint | Method | Priority | Ghi chú |
| --- | --- | --- | --- |
| `/api/v1/leave/me/balances` | GET | P0 | Balance của tôi |
| `/api/v1/leave/types` | GET | P0 | Leave type active |
| `/api/v1/leave/me/requests` | GET | P0 | Đơn của tôi |
| `/api/v1/leave/requests` | POST | P0 | Tạo draft/request |
| `/api/v1/leave/requests/{id}` | GET | P0 | Detail |
| `/api/v1/leave/requests/{id}` | PATCH | P1 | Update draft |
| `/api/v1/leave/requests/{id}/submit` | POST | P0 | Submit |
| `/api/v1/leave/requests/{id}/cancel` | POST | P1 | Cancel |
| `/api/v1/leave/requests` | GET | P0 | Pending list theo scope |
| `/api/v1/leave/requests/{id}/approve` | POST | P0 | Approve |
| `/api/v1/leave/requests/{id}/reject` | POST | P0 | Reject |
| `/api/v1/leave/calculate` | POST | P0 | Preview calculation |
| `/api/v1/leave/calendar` | GET | P1 | Calendar scope |

---

## 11. Permission seed Sprint 3

### 11.0 Mô hình data scope chuẩn (canonical)

> **QUAN TRỌNG - đồng bộ với Sprint 2 / BACKEND-03 / IMPLEMENTATION-05.**
>
> Mô hình RBAC chuẩn của MVP KHÔNG mã hóa phạm vi dữ liệu (Own/Team/Company) vào TÊN permission. Phạm vi được resolve qua cột `data_scope` trên bảng `role_permissions`, không phải qua tên permission.
>
> ```text
> permission = HÀNH ĐỘNG (action), ví dụ: ATT.ATTENDANCE.VIEW
> data_scope = Own | Team | Department | Company | System  (cột riêng trên role_permissions)
> ```
>
> Nghĩa là một permission như `ATT.ATTENDANCE.VIEW` được cấp cho role với `data_scope = Own` cho Employee, `data_scope = Team` cho Manager, `data_scope = Company` cho HR - thay vì tạo ba permission `VIEW_OWN`/`VIEW_TEAM`/`VIEW_COMPANY` riêng biệt.
>
> Các tên permission liệt kê ở 11.1 và 11.2 (bao gồm các hậu tố `_OWN`/`_TEAM`/`_COMPANY` còn sót) được giữ ở mức tham chiếu danh mục hành động; khi seed thực tế, hậu tố phạm vi PHẢI ánh xạ sang cột `data_scope` theo mô hình canonical ở trên để KHÔNG mâu thuẫn với Sprint 2. Không bắt buộc đổi tên hàng loạt trong tài liệu này, nhưng mọi kiểm tra backend (mục 6.1) phải dựa trên `permission action + data_scope column`, không dựa trên việc parse phạm vi từ tên permission.

### 11.1 ATT permissions cần seed

```text
ATT.ATTENDANCE.CHECK_IN
ATT.ATTENDANCE.CHECK_OUT
ATT.ATTENDANCE.VIEW_OWN
ATT.ATTENDANCE.VIEW_TEAM
ATT.ATTENDANCE.VIEW_COMPANY
ATT.ATTENDANCE.VIEW_DETAIL
ATT.ATTENDANCE.VIEW_SENSITIVE
ATT.ATTENDANCE.EXPORT
ATT.ATTENDANCE.ADJUST_DIRECT
ATT.ATTENDANCE.RECALCULATE
ATT.ADJUSTMENT.CREATE_OWN
ATT.ADJUSTMENT.VIEW_OWN
ATT.ADJUSTMENT.VIEW_TEAM
ATT.ADJUSTMENT.VIEW_COMPANY
ATT.ADJUSTMENT.APPROVE
ATT.ADJUSTMENT.REJECT
ATT.ADJUSTMENT.CANCEL_OWN
ATT.SHIFT.VIEW
ATT.SHIFT.CREATE
ATT.SHIFT.UPDATE
ATT.SHIFT.DELETE
ATT.SHIFT_ASSIGNMENT.VIEW
ATT.SHIFT_ASSIGNMENT.UPDATE
ATT.RULE.VIEW
ATT.RULE.CONFIG
ATT.REMOTE_REQUEST.CREATE_OWN
ATT.REMOTE_REQUEST.VIEW_OWN
ATT.REMOTE_REQUEST.VIEW_TEAM
ATT.REMOTE_REQUEST.VIEW_COMPANY
ATT.REMOTE_REQUEST.APPROVE
ATT.REMOTE_REQUEST.REJECT
ATT.REMOTE_REQUEST.CANCEL_OWN
ATT.AUDIT_LOG.VIEW
```

### 11.2 LEAVE permissions cần seed

```text
LEAVE.BALANCE.VIEW_OWN
LEAVE.BALANCE.VIEW
LEAVE.BALANCE.ADJUST
LEAVE.BALANCE.TRANSACTION_VIEW
LEAVE.REQUEST.CREATE
LEAVE.REQUEST.SUBMIT
LEAVE.REQUEST.VIEW_OWN
LEAVE.REQUEST.VIEW
LEAVE.REQUEST.UPDATE_DRAFT
LEAVE.REQUEST.CANCEL_OWN
LEAVE.REQUEST.APPROVE
LEAVE.REQUEST.REJECT
LEAVE.REQUEST.CANCEL_ANY
LEAVE.REQUEST.REVOKE
LEAVE.REQUEST.EXPORT
LEAVE.CALENDAR.VIEW_OWN
LEAVE.CALENDAR.VIEW_TEAM
LEAVE.CALENDAR.VIEW_COMPANY
LEAVE.TYPE.VIEW
LEAVE.TYPE.CREATE
LEAVE.TYPE.UPDATE
LEAVE.TYPE.DELETE
LEAVE.POLICY.VIEW
LEAVE.POLICY.CREATE
LEAVE.POLICY.UPDATE
LEAVE.POLICY.DELETE
LEAVE.FILE.VIEW
LEAVE.FILE.UPLOAD
LEAVE.FILE.DELETE
LEAVE.AUDIT_LOG.VIEW
```

### 11.3 Role mapping gợi ý

| Role | ATT scope | LEAVE scope |
| --- | --- | --- |
| Employee | Own: check-in/out, view own records, create own adjustment | Own: view balance, create/submit/view/cancel own request |
| Manager | Team: view team records, approve adjustment nếu bật | Team: view/approve/reject team leave, view team calendar |
| HR | Company: view records, manage shifts/rules, adjust if permitted | Company: view/approve/reject, manage balance/type/policy |
| Admin | Company/System tùy tenant | Company/System tùy tenant |
| Super Admin | System | System |

---

## 12. Data seed Sprint 3

### 12.1 Attendance seed

```text
Shift:
- shift_code: OFFICE_8H
- name: Ca hành chính
- shift_type: Fixed
- start_time: 08:00
- end_time: 17:30
- break_minutes: 90
- required_working_minutes: 480
- timezone: Asia/Ho_Chi_Minh

Attendance rule:
- rule_code: DEFAULT_OFFICE_RULE
- grace_late_minutes: 5
- grace_early_leave_minutes: 5
- allow_web_check_in: true
- allow_mobile_check_in: true
- require_gps: false
- require_note: false
- missing_checkout_policy: MarkMissingCheckout
```

### 12.2 Leave seed

```text
Leave types:
- ANNUAL: Nghỉ phép năm, paid, balance required, half-day allowed
- SICK: Nghỉ ốm, paid, balance optional/configurable, attachment optional
- UNPAID: Nghỉ không lương, unpaid, balance not required
- OTHER: Nghỉ khác, configurable

Leave policy:
- Default company policy
- Annual leave default balance: 12 days/year nếu chưa có cấu hình khác
- Allow half-day: true
- Allow hourly: optional false trong MVP nếu muốn giảm scope
- Min notice days: 1 cho Annual, 0 cho Sick/Unpaid nếu policy cho phép
```

---

## 13. Test plan Sprint 3

### 13.1 API test matrix

| Nhóm | Test case chính |
| --- | --- |
| Attendance today | Chưa check-in, đã check-in, đã check-out, nghỉ full-day, không có ca |
| Check-in/out | Thành công, double click, user không có employee, employee resigned, ngoài scope |
| Attendance records | Own/Team/Company scope, pagination, filter, forbidden cross-scope |
| Leave balance | Own balance, HR view, insufficient permission, ledger integrity |
| Leave request | Draft, update draft, submit, validation, cancel |
| Leave approval | Manager approve team, reject with reason, HR approve company, outside scope forbidden |
| Leave sync | Full-day to Leave record, half-day reduce minutes, cancel/revoke recalc |
| Notification/audit | Event emitted/stubbed, audit log created |

### 13.2 E2E/UAT flow

```text
Flow 1: Employee check-in/check-out
1. Login employee.
2. Open Attendance Today.
3. Click Check-in.
4. Verify status checked-in.
5. Click Check-out.
6. Verify attendance record completed.
7. Open My Records.
8. Verify record exists.

Flow 2: Employee submit leave, Manager approve, ATT blocks check-in
1. Login employee.
2. Open Leave.
3. Create full-day annual leave request for tomorrow.
4. Submit request.
5. Login manager.
6. Open Leave Approvals.
7. Approve request.
8. Login employee.
9. Open Attendance Today on leave date or simulate date in test env.
10. Verify Check-in/Check-out disabled.
11. Open My Attendance Records.
12. Verify status Leave.
```

### 13.3 Regression bắt buộc

- [ ] Login/logout không lỗi.
- [ ] Auth refresh token vẫn hoạt động.
- [ ] User-employee mapping đúng.
- [ ] Manager direct team scope đúng.
- [ ] HR employee list không bị ảnh hưởng.
- [ ] Permission seed không phá menu cũ.
- [ ] Migration chạy được từ database trống.
- [ ] Seed chạy lại idempotent.

---

## 14. Definition of Ready

Một story Sprint 3 chỉ được kéo vào development khi:

- [ ] Có mô tả user story rõ actor + mục tiêu.
- [ ] Có acceptance criteria.
- [ ] Có API contract hoặc DTO draft.
- [ ] Có permission/data scope xác định.
- [ ] Có database table/field liên quan đã rõ.
- [ ] Có UI route hoặc component target nếu là frontend story.
- [ ] Có test case chính dự kiến.
- [ ] Không phụ thuộc blocking vào task chưa sẵn sàng.

---

## 15. Definition of Done

Một story Sprint 3 được xem là Done khi:

- [ ] Code merged vào branch sprint/main theo quy trình.
- [ ] Unit test hoặc service test liên quan pass.
- [ ] API test pass với role Employee/Manager/HR tối thiểu.
- [ ] Permission và data scope được kiểm tra ở backend.
- [ ] Frontend có loading/empty/error/forbidden state.
- [ ] Form validation map đúng lỗi backend.
- [ ] Audit log/event được ghi nếu story yêu cầu.
- [ ] Không lộ dữ liệu nhạy cảm trong list response.
- [ ] Không có lỗi TypeScript/lint/build.
- [ ] QA xác nhận acceptance criteria.
- [ ] API docs/OpenAPI hoặc contract mock được cập nhật.

---

## 16. Rủi ro và phương án giảm thiểu

| Rủi ro | Mức độ | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- | --- |
| Trùng attendance record khi check-in nhiều lần | Cao | Sai bảng công | Unique index employee/date/shift + transaction lock/upsert |
| Client giả giờ check-in | Cao | Gian lận công | Dùng server time, client_time chỉ lưu tham khảo |
| Leave approved nhưng không sync ATT | Cao | Bảng công sai | Sync status, retry, audit sync error |
| Manager duyệt ngoài team | Cao | Lộ/sai dữ liệu | Backend data scope check bằng direct_manager_id |
| Query bảng công chậm | Trung bình | UX chậm | Index company/employee/date/status, pagination |
| Rule thay đổi làm sai dữ liệu cũ | Trung bình | Sai báo cáo | Lưu applied_rule_id và calculation snapshot |
| Balance bị âm ngoài policy | Cao | Sai phép | Transaction + validation + row lock balance |
| Double approve leave request | Cao | Trừ phép 2 lần | State machine + row lock + idempotency key |
| Notification chưa sẵn sàng | Thấp/Trung bình | Thiếu UX feedback | Ghi event/stub trước, Sprint 4 xử lý UI notification đầy đủ |
| Scope Sprint quá rộng | Cao | Không kịp Done | Ưu tiên P0: Today, check-in/out, leave request, approve, sync |

---

## 17. Cutline nếu thiếu thời gian

Nếu sprint có nguy cơ không hoàn thành, ưu tiên giữ lại P0 và cắt P1/P2 theo thứ tự sau:

### Giữ lại bắt buộc

1. `GET /attendance/today`.
2. `POST /attendance/check-in`.
3. `POST /attendance/check-out`.
4. `GET /attendance/my-records`.
5. `GET /leave/me/balances`.
6. `POST /leave/requests`.
7. `POST /leave/requests/{id}/submit`.
8. `GET /leave/requests` pending theo scope.
9. `POST /leave/requests/{id}/approve`.
10. LEAVE Approved full-day -> ATT Leave record.
11. Full-day leave chặn check-in/out.

### Có thể defer sang Sprint sau

1. Remote work workflow đầy đủ.
2. Adjustment workflow đầy đủ.
3. Shift/rule CRUD nâng cao.
4. Leave policy CRUD nâng cao.
5. HR balance adjust UI nâng cao.
6. Leave calendar đẹp/đầy đủ.
7. Export bảng công/nghỉ phép.
8. Hourly leave nếu chưa bắt buộc.
9. Notification realtime UI.
10. Dashboard widget hoàn chỉnh.

---

## 18. Sprint demo script

### Demo 1 - Attendance Core

1. Login Employee.
2. Vào Home Portal.
3. Mở app Chấm công.
4. Xem Attendance Today.
5. Click Check-in.
6. Refresh page, verify trạng thái vẫn đúng.
7. Click Check-out.
8. Mở bảng công cá nhân.
9. Xem chi tiết ngày công.

### Demo 2 - Leave Request & Approval

1. Login Employee.
2. Mở app Nghỉ phép.
3. Xem số dư phép.
4. Tạo đơn nghỉ full-day.
5. Preview số ngày nghỉ và số dư sau khi nghỉ.
6. Submit request.
7. Login Manager.
8. Mở màn Duyệt nghỉ.
9. Xem chi tiết request.
10. Approve.
11. Login Employee.
12. Verify đơn chuyển Approved.

### Demo 3 - Leave Sync to Attendance

1. Dùng ngày nghỉ đã Approved.
2. Mở Attendance Today của employee cho ngày đó hoặc dùng test env time override.
3. Verify nút Check-in/Check-out disabled.
4. Verify disabled reason: đã có đơn nghỉ được duyệt.
5. Mở bảng công.
6. Verify attendance status = Leave.

---

## 19. Checklist bàn giao cuối Sprint 3

### 19.1 Backend

- [ ] Migration ATT/LEAVE chạy từ database trống.
- [ ] Seed permission/role mapping không lỗi.
- [ ] Seed shift/rule/leave type/policy chạy idempotent.
- [ ] API ATT P0 hoàn thành.
- [ ] API LEAVE P0 hoàn thành.
- [ ] LEAVE -> ATT sync hoàn thành mức full-day, half-day cơ bản.
- [ ] Permission guard/data scope guard có test.
- [ ] Audit log/event hook có test hoặc verification.
- [ ] OpenAPI/Swagger cập nhật.

### 19.2 Frontend

- [ ] App registry có ATT/LEAVE.
- [ ] Sidebar ATT/LEAVE theo permission.
- [ ] Attendance Today hoạt động.
- [ ] My Attendance Records hoạt động.
- [ ] Leave Balance hoạt động.
- [ ] My Leave Requests hoạt động.
- [ ] Create Leave Request hoạt động.
- [ ] Leave Approval hoạt động.
- [ ] Loading/empty/error/forbidden state đầy đủ cho P0.
- [ ] Query invalidation đúng sau mutation.

### 19.3 QA

- [ ] API test P0 pass.
- [ ] E2E smoke pass.
- [ ] Permission test pass.
- [ ] Data scope test pass.
- [ ] Regression Auth/HR pass.
- [ ] Bug P0/P1 được xử lý hoặc có quyết định defer.
- [ ] UAT script đã bàn giao PO.

### 19.4 DevOps/Release

- [ ] Staging deploy thành công.
- [ ] Env vars không thiếu.
- [ ] Migration rollback plan có mô tả.
- [ ] Log lỗi backend/frontend quan sát được.
- [ ] Seed demo data đủ cho UAT.

---

## 20. Output của Sprint 3

Sau Sprint 3, repo/project cần có các output sau:

```text
Backend:
- Attendance module core
- Leave module core
- ATT/LEAVE migrations
- ATT/LEAVE seeds
- ATT/LEAVE API contracts
- LEAVE -> ATT sync service
- Permission/data scope tests

Frontend:
- Attendance pages P0
- Leave pages P0
- ATT/LEAVE API hooks
- ATT/LEAVE sidebar/routes
- Form validation + query invalidation

QA:
- ATT API test cases
- LEAVE API test cases
- Integration test LEAVE -> ATT
- Permission/data scope test matrix
- UAT script

Docs:
- Updated OpenAPI/Swagger
- Sprint demo notes
- Known issues / carry-over backlog
```

---

## 21. Carry-over backlog đề xuất sang Sprint 4

| Mã | Backlog | Lý do |
| --- | --- | --- |
| CO-S4-001 | Notification UI realtime cho ATT/LEAVE | Sprint 4 có NOTI core |
| CO-S4-002 | Dashboard widgets ATT/LEAVE | Sprint 4 có DASH core |
| CO-S4-003 | Attendance adjustment workflow đầy đủ | Có thể cần thêm UX và approval detail |
| CO-S4-004 | Remote work request workflow đầy đủ | Liên quan notification/dashboard |
| CO-S4-005 | Leave calendar nâng cao | Có thể tích hợp dashboard/team view |
| CO-S4-006 | Export attendance/leave | Nên đi cùng performance và audit export |
| CO-S4-007 | Shift/rule policy UI nâng cao | Sau khi core rule ổn định |
| CO-S4-008 | Leave policy/balance admin nâng cao | Cần HR/Admin UAT thêm |
| CO-S4-009 | Cancel/Revoke đơn nghỉ đã Approved: recalc ATT + restore balance idempotent (S3-SYNC-004) | Chỉ tracked tại đây nếu S3-SYNC-004 bị defer khỏi Sprint 3; không để mở mơ hồ |

---

## 22. Capacity & Estimation

Sprint 3 hiện thực hóa các story của IMPLEMENTATION-02: EPIC-04 (ATT, story 038-051) + EPIC-05 (LEAVE, story 052-064) + story 100 (LEAVE<->ATT integration của EPIC-10).

### 22.1 Thang điểm tham chiếu

Áp dụng thang Story Point của IMPLEMENTATION-02 §3.5:

| Point | Độ phức tạp tham chiếu |
| --- | --- |
| 1 | Sửa nhỏ, copy UI, validation đơn giản |
| 2 | Task nhỏ, ít dependency |
| 3 | Story nhỏ, 1 API hoặc 1 UI state |
| 5 | Story vừa, có API + UI + test cơ bản |
| 8 | Story lớn, có nhiều state/quyền/dependency |
| 13 | Story rất lớn, cần tách task kỹ thuật nội bộ |

Story lớn hơn 13 point phải được tách trước khi đưa vào sprint.

### 22.2 Giả định capacity

| Thông số | Giả định |
| --- | --- |
| Độ dài sprint | 2 tuần (10 ngày làm việc) |
| Backend | 2-4 dev |
| Frontend | 2-4 dev |
| QA | 1-2 |
| DevOps | 1 |
| Velocity tham chiếu | ~40-80 point/sprint |

### 22.3 Bảng story và điểm

| Story ID | Epic | Mô tả ngắn | Priority | Point |
| --- | --- | --- | --- | ---: |
| IMP02-STORY-038 | EPIC-04 ATT | Xem trạng thái chấm công hôm nay | P0 | 8 |
| IMP02-STORY-039 | EPIC-04 ATT | Check-in web/mobile web | P0 | 8 |
| IMP02-STORY-040 | EPIC-04 ATT | Check-out web/mobile web | P0 | 8 |
| IMP02-STORY-041 | EPIC-04 ATT | Bảng công cá nhân/team/company | P0 | 13 |
| IMP02-STORY-042 | EPIC-04 ATT | Chi tiết ngày công và log | P1 | 5 |
| IMP02-STORY-043 | EPIC-04 ATT | Quản lý ca làm việc | P0 | 8 |
| IMP02-STORY-044 | EPIC-04 ATT | Gán ca theo company/department/employee | P0 | 8 |
| IMP02-STORY-045 | EPIC-04 ATT | Cấu hình rule chấm công | P0 | 8 |
| IMP02-STORY-046 | EPIC-04 ATT | Gửi yêu cầu điều chỉnh công | P0 | 8 |
| IMP02-STORY-047 | EPIC-04 ATT | Duyệt/từ chối điều chỉnh công | P0 | 8 |
| IMP02-STORY-048 | EPIC-04 ATT | Điều chỉnh công trực tiếp | P1 | 8 |
| IMP02-STORY-049 | EPIC-04 ATT | Tạo request remote/công tác | P1 | 8 |
| IMP02-STORY-050 | EPIC-04 ATT | Duyệt remote/công tác | P1 | 8 |
| IMP02-STORY-051 | EPIC-04 ATT | Export bảng công | P2 | 5 |
| IMP02-STORY-052 | EPIC-05 LEAVE | Xem số dư phép | P0 | 5 |
| IMP02-STORY-053 | EPIC-05 LEAVE | Preview tính ngày nghỉ | P0 | 8 |
| IMP02-STORY-054 | EPIC-05 LEAVE | Tạo/lưu nháp/gửi đơn nghỉ | P0 | 13 |
| IMP02-STORY-055 | EPIC-05 LEAVE | Danh sách/chi tiết đơn nghỉ | P0 | 5 |
| IMP02-STORY-056 | EPIC-05 LEAVE | Hủy đơn nghỉ theo rule | P1 | 5 |
| IMP02-STORY-057 | EPIC-05 LEAVE | Danh sách đơn chờ duyệt theo scope | P0 | 8 |
| IMP02-STORY-058 | EPIC-05 LEAVE | Duyệt/từ chối đơn nghỉ | P0 | 13 |
| IMP02-STORY-059 | EPIC-05 LEAVE | Hủy/thu hồi đơn đã duyệt | P1 | 8 |
| IMP02-STORY-060 | EPIC-05 LEAVE | Lịch nghỉ theo scope | P1 | 8 |
| IMP02-STORY-061 | EPIC-05 LEAVE | Quản lý loại nghỉ phép | P0 | 5 |
| IMP02-STORY-062 | EPIC-05 LEAVE | Quản lý chính sách nghỉ phép | P0 | 13 |
| IMP02-STORY-063 | EPIC-05 LEAVE | Quản lý số dư phép và ledger | P0 | 13 |
| IMP02-STORY-064 | EPIC-05 LEAVE | Đồng bộ Leave -> Attendance | P0 | 13 |
| IMP02-STORY-100 | EPIC-10 INTEGRATION | Tích hợp LEAVE với ATT chặn/tính lại công | P0 | 13 |
| **Tổng** | | | | **241** |

Phân rã: ATT (EPIC-04) = 111 point; LEAVE (EPIC-05) = 117 point; integration story 100 = 13 point.

### 22.4 CẢNH BÁO capacity

> **241 point là tải nặng nhất toàn bộ MVP.** Con số này gấp khoảng 3-5 lần velocity tham chiếu của một sprint 2 tuần (~40-80 point), được hình thành do gộp ATT (111) + LEAVE (117) + sync integration (13) vào cùng một sprint.
>
> Đây cũng chính là rủi ro mà tài liệu đã tự nêu ở mục 16 ("Scope Sprint quá rộng" - mức Cao).
>
> **BẮT BUỘC chọn một trong các phương án trước khi commit sprint:**
>
> 1. **Tách thành 2 sprint:** Sprint 3a = ATT core (EPIC-04), Sprint 3b = LEAVE + LEAVE->ATT sync (EPIC-05 + story 100/064).
> 2. **Kéo dài thời lượng sprint** tương ứng với khối lượng (ví dụ 4-6 tuần thay vì 2 tuần).
> 3. **Tăng số dev song song** (thêm BE/FE) để nâng velocity hiệu dụng cho riêng sprint này.
>
> Nếu vẫn giữ một sprint 2 tuần với capacity hiện tại, PHẢI áp dụng cutline mục 17 và chấp nhận chỉ hoàn thành tập P0 cốt lõi; phần P1/P2 chuyển sang carry-over (mục 21).

---

## 23. Kết luận

IMPLEMENTATION-06 tập trung vào hai nghiệp vụ cốt lõi nhất sau Auth và HR:

```text
Chấm công hằng ngày
+
Nghỉ phép có phê duyệt
+
Đồng bộ nghỉ phép sang bảng công
```

Điểm quan trọng nhất của Sprint 3 không phải là làm đầy đủ mọi tính năng ATT/LEAVE, mà là hoàn thiện đường xương sống nghiệp vụ:

```text
Employee thao tác
-> Backend kiểm quyền và scope
-> Dữ liệu gắn với employee
-> Manager/HR xử lý theo phạm vi
-> Audit/event được ghi
-> LEAVE Approved tác động chính xác đến ATT
-> Frontend hiển thị đúng state và disabled reason
-> QA kiểm được end-to-end
```

Khi Sprint 3 hoàn thành, hệ thống đã có nền vận hành hằng ngày đủ rõ để tiếp tục Sprint 4 (IMPLEMENTATION-07: Sprint 4 Task, Notification & Dashboard Execution Plan) với Task, Notification & Dashboard core.
