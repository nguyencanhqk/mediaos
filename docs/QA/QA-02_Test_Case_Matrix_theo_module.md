# QA-02: TEST CASE MATRIX THEO MODULE
---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | QA-02 |
| Tên tài liệu | Test Case Matrix theo module |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | QA Planning / MVP Version 1.0 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

Tài liệu QA-02 định nghĩa **ma trận test case theo module** cho hệ thống quản lý doanh nghiệp nội bộ ở giai đoạn MVP.

Tài liệu này dùng để:

1. Chuyển phạm vi nghiệp vụ, API, UI, database và backend/frontend đã thiết kế thành danh sách test case có thể thực thi.
2. Chuẩn hóa mã test case theo module.
3. Xác định mức ưu tiên test cho từng nhóm chức năng.
4. Giúp QA tạo manual test case, API test, integration test, E2E test và regression suite.
5. Giúp Backend, Frontend và QA có chung checklist nghiệm thu theo từng module.
6. Làm cơ sở cho QA-03: End-to-End Flow Testing.
7. Làm cơ sở cho QA-04: API Testing & Contract Testing.
8. Làm cơ sở cho QA-05: Permission, Role & Data Scope Testing.

---

## 3. Phạm vi test case matrix MVP

### 3.1 Module thuộc phạm vi test bắt buộc

| Module | Tên module | Trạng thái test MVP | Ghi chú |
| --- | --- | --- | --- |
| AUTH | Tài khoản, đăng nhập & phân quyền | Bắt buộc | Nền tảng xác thực, session, RBAC, permission, data scope |
| FOUNDATION | Hệ thống nền tảng | Bắt buộc | Company, settings, module catalog, audit, files, seed, public holidays |
| HR | Nhân sự | Bắt buộc | Employee, department, position, contract, profile change request, employee code |
| ATT | Chấm công | Bắt buộc | Check-in/out, bảng công, ca/rule, adjustment, remote work |
| LEAVE | Nghỉ phép | Bắt buộc | Leave request, balance, approval, calendar, ATT sync |
| TASK | Công việc & Dự án | Bắt buộc | Project, task, assignee, Kanban, comment, checklist, file, activity |
| NOTI | Thông báo | Bắt buộc | Notification list, unread count, mark read, event/template, delivery log |
| DASH | Dashboard | Bắt buộc | Dashboard theo vai trò, widget, quick action, cache/fallback |
| CROSS | Liên module | Bắt buộc | Luồng nghiệp vụ liên module và regression suite |

### 3.2 Module chưa test sâu trong MVP

| Module | Hướng xử lý MVP |
| --- | --- |
| PAYROLL | Chỉ test placeholder/permission nếu hiển thị Coming Soon |
| RECRUIT | Chỉ test placeholder/permission nếu hiển thị Coming Soon |
| ASSET | Chỉ test placeholder/permission nếu hiển thị Coming Soon |
| ROOM | Chỉ test placeholder/permission nếu hiển thị Coming Soon |
| CHAT | Chỉ test placeholder/permission nếu hiển thị Coming Soon |
| SOCIAL | Chỉ test placeholder/permission nếu hiển thị Coming Soon |
| MOBILE native | Chưa test native app, chỉ test responsive/mobile web nếu có |
| AI | Chưa test trong MVP |

---

## 4. Quy ước mã test case

### 4.1 Format mã test case

```text
QA02-{MODULE}-{GROUP}-{NUMBER}
```

Ví dụ:

```text
QA02-AUTH-LOGIN-001
QA02-HR-EMP-001
QA02-ATT-CHECKIN-001
QA02-LEAVE-REQ-001
QA02-TASK-TASK-001
QA02-NOTI-MY-001
QA02-DASH-WIDGET-001
QA02-CROSS-LEAVE-ATT-001
```

> **Ngoại lệ quy ước:**
>
> - Test liên module dùng `QA02-CROSS-{MODULE_A}-{MODULE_B}-{NUMBER}` (5 phần), ví dụ `QA02-CROSS-LEAVE-ATT-001`, `QA02-CROSS-LEAVE-DASH-NOTI-001`.
> - Nhóm cross-cutting (API contract, UI state, accessibility, security, performance, regression) dùng chính nhóm làm prefix đầu thay cho `{MODULE}`: `QA02-{API|UI|A11Y|SEC|PERF|REG}-{SUBGROUP}-{NUMBER}`, ví dụ `QA02-API-CONTRACT-001`, `QA02-REG-SMOKE-001`.

### 4.2 Module code

| Code | Module |
| --- | --- |
| AUTH | Tài khoản & phân quyền |
| FOUNDATION | Hệ thống nền tảng |
| HR | Nhân sự |
| ATT | Chấm công |
| LEAVE | Nghỉ phép |
| TASK | Công việc & Dự án |
| NOTI | Thông báo |
| DASH | Dashboard |
| CROSS | Liên module |
| NFR | Non-functional Requirement |
| REG | Regression |

### 4.3 Nhóm test

| Group | Ý nghĩa |
| --- | --- |
| UI | Kiểm thử giao diện |
| API | Kiểm thử API |
| DB | Kiểm thử database/constraint/migration |
| PERM | Kiểm thử permission/data scope |
| FLOW | Kiểm thử luồng nghiệp vụ |
| VAL | Kiểm thử validation/business rule |
| ERR | Kiểm thử error/empty/forbidden/loading state |
| INT | Kiểm thử tích hợp module |
| SEC | Kiểm thử bảo mật |
| PERF | Kiểm thử hiệu năng |
| E2E | Kiểm thử end-to-end |

### 4.4 Mức ưu tiên

| Priority | Ý nghĩa | Bắt buộc trước release MVP |
| --- | --- | --- |
| P0 | Critical / blocker | Có |
| P1 | High | Có |
| P2 | Medium | Nên có |
| P3 | Low / nice-to-have | Không bắt buộc |

### 4.5 Loại test

| Type | Ý nghĩa |
| --- | --- |
| Positive | Trường hợp hợp lệ |
| Negative | Trường hợp lỗi |
| Boundary | Biên dữ liệu |
| Permission | Quyền và phạm vi dữ liệu |
| Integration | Tích hợp nhiều module |
| Regression | Chống lỗi quay lại |
| Security | Bảo mật |
| Performance | Hiệu năng |
| Accessibility | Khả năng truy cập |

---

## 5. Test coverage tổng quan theo module

| Module | UI | API | DB | Permission/Scope | Workflow | Integration | Security | Performance | Regression |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AUTH | Có | Có | Có | Có | Có | Có | Có | Có | Có |
| FOUNDATION | Có | Có | Có | Có | Có | Có | Có | Có | Có |
| HR | Có | Có | Có | Có | Có | Có | Có | Có | Có |
| ATT | Có | Có | Có | Có | Có | Có | Có | Có | Có |
| LEAVE | Có | Có | Có | Có | Có | Có | Có | Có | Có |
| TASK | Có | Có | Có | Có | Có | Có | Có | Có | Có |
| NOTI | Có | Có | Có | Có | Có | Có | Có | Có | Có |
| DASH | Có | Có | Có | Có | Có | Có | Có | Có | Có |
| CROSS | Có | Có | Có | Có | Có | Có | Có | Có | Có |

---

## 6. Ma trận test AUTH

### 6.1 Coverage AUTH

| Nhóm | Mục tiêu test |
| --- | --- |
| Login/logout | Đăng nhập, đăng xuất, lỗi sai thông tin, tài khoản bị khóa |
| Session/token | Access token, refresh token, token hết hạn, revoke session |
| User management | Tạo/sửa/khóa/mở user, liên kết employee |
| Role/permission | Tạo role, gán quyền, permission matrix, data scope |
| Route/API guard | Chặn truy cập trái quyền ở frontend và backend |
| Audit/security log | Login log, security event, audit thao tác quan trọng |

### 6.2 AUTH test case matrix

| Test ID | Test case | Priority | Type | Layer | Precondition | Steps tóm tắt | Expected result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA02-AUTH-LOGIN-001 | Login thành công bằng email/password hợp lệ | P0 | Positive | UI/API | User active, company active | Nhập email/password đúng -> Submit | Login success, nhận token/session, redirect Home Portal |
| QA02-AUTH-LOGIN-002 | Login sai password | P0 | Negative | UI/API | User tồn tại | Nhập password sai -> Submit | Trả lỗi chung, không tiết lộ email tồn tại hay không |
| QA02-AUTH-LOGIN-003 | Login user bị khóa | P0 | Negative | UI/API | User status Locked | Login | Bị từ chối, hiển thị thông báo liên hệ Admin/HR |
| QA02-AUTH-LOGIN-004 | Login company inactive | P1 | Negative | API | Company inactive | Login user thuộc company inactive | Không cho login, message phù hợp |
| QA02-AUTH-LOGIN-005 | Logout thành công | P0 | Positive | UI/API | User đang login | Click logout | Token/session bị revoke, clear cache, redirect login |
| QA02-AUTH-SESSION-001 | Access token hết hạn và refresh thành công | P0 | Positive | API/FE | Refresh token hợp lệ | Gọi API khi access token expired | Client refresh token, replay request thành công |
| QA02-AUTH-SESSION-002 | Refresh token bị revoke | P0 | Negative | API/FE | Refresh token revoked | Gọi API cần refresh | Redirect login, clear sensitive cache |
| QA02-AUTH-SESSION-003 | User bị khóa trong khi còn session | P0 | Security | API | User active có session, sau đó bị khóa | Gọi API protected | API trả 401/403 theo policy, session không còn hợp lệ |
| QA02-AUTH-USER-001 | Admin tạo user mới | P0 | Positive | UI/API/DB | Admin có AUTH.USER.CREATE | Tạo user với email hợp lệ | User được tạo, password flow đúng, audit log ghi nhận |
| QA02-AUTH-USER-002 | Tạo user email trùng | P0 | Negative | API/DB | Email đã tồn tại trong company | Submit tạo user | Validation/Conflict error, không tạo trùng |
| QA02-AUTH-USER-003 | Khóa user | P1 | Positive | UI/API/DB | Admin có quyền | Lock user active | User chuyển Locked, session có thể bị revoke, audit log |
| QA02-AUTH-USER-004 | Mở khóa user | P1 | Positive | UI/API/DB | User locked | Unlock user | User active trở lại, audit log |
| QA02-AUTH-USER-005 | User thiếu quyền xem danh sách user | P0 | Permission | UI/API | User không có AUTH.USER.VIEW | Vào /system/users hoặc GET users | UI route guard/403, API không trả dữ liệu |
| QA02-AUTH-ROLE-001 | Tạo role company-specific | P1 | Positive | UI/API/DB | Admin có AUTH.ROLE.CREATE | Tạo role | Role được tạo trong company hiện tại |
| QA02-AUTH-ROLE-002 | Gán nhiều role cho một user | P1 | Positive | UI/API/DB | Có user và role | Gán Employee + Manager | User có nhiều role, permission resolve đúng |
| QA02-AUTH-ROLE-003 | Cập nhật permission matrix | P0 | Positive | UI/API/DB | Admin có quyền cập nhật role | Thêm/bớt permission/scope -> Save | Role permissions cập nhật, audit log, cache permission invalidate |
| QA02-AUTH-ROLE-004 | Không cho tự gỡ quyền quản trị cuối cùng | P0 | Negative/Security | API | Chỉ còn một Super Admin có quyền | Gỡ quyền critical | Bị chặn bằng business error |
| QA02-AUTH-PERM-001 | API kiểm tra permission bắt buộc | P0 | Permission | API | User thiếu permission | Gọi endpoint protected | Trả 403, không xử lý business logic |
| QA02-AUTH-SCOPE-001 | Scope Own chỉ xem dữ liệu chính mình | P0 | Permission | API/DB | User có Own | Gọi API với target của người khác | 403/404 theo policy |
| QA02-AUTH-SCOPE-002 | Scope Team chỉ xem team trực tiếp | P0 | Permission | API/DB | Manager có Team scope | Gọi dữ liệu employee ngoài team | Không trả dữ liệu ngoài scope |
| QA02-AUTH-SCOPE-003 | Scope Company chỉ trong company hiện tại | P0 | Permission/Security | API/DB | Admin company A | Truy vấn id thuộc company B | 403/404, không rò dữ liệu cross-company |
| QA02-AUTH-AUDIT-001 | Ghi audit khi đổi role/permission | P1 | DB/Security | Admin cập nhật role | Save permission matrix | audit_logs có actor, action, target, diff |
| QA02-AUTH-SEC-001 | Không trả password_hash/refresh_token_hash | P0 | Security | API | User có quyền xem user | GET user detail | Response không chứa secret field |

---

## 7. Ma trận test FOUNDATION / SYSTEM

### 7.1 Coverage FOUNDATION

| Nhóm | Mục tiêu test |
| --- | --- |
| Company/tenant | Company active/inactive, multi-tenant isolation |
| Module catalog | Bật/tắt module, app visibility, Coming Soon/locked state |
| Settings | System setting, company setting, override, validation |
| Files | Upload/download private file, file link, permission, virus/type/size validation nếu có |
| Audit logs | Ghi log, xem log theo quyền, filter/search/export |
| Sequence | Sinh mã tự động cho employee/leave/project nếu cấu hình |
| Public holidays | Ngày nghỉ lễ ảnh hưởng ATT/LEAVE |
| Seed/migration | Seed idempotent, không tạo trùng dữ liệu nền |

### 7.2 FOUNDATION test case matrix

| Test ID | Test case | Priority | Type | Layer | Precondition | Steps tóm tắt | Expected result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA02-FOUNDATION-COMPANY-001 | Company active cho phép user login và dùng module | P0 | Positive | API/DB | Company active | User login và gọi API module | Thành công nếu có quyền |
| QA02-FOUNDATION-COMPANY-002 | Company inactive chặn truy cập nghiệp vụ | P0 | Negative | API | Company inactive | User gọi API protected | Bị chặn, không xử lý nghiệp vụ |
| QA02-FOUNDATION-MODULE-001 | Module active hiển thị trong Home Portal/App Switcher nếu có quyền | P0 | Positive | UI/API | Module active + user có quyền | Load app registry | App hiển thị đúng |
| QA02-FOUNDATION-MODULE-002 | Module inactive không hiển thị hoặc hiển thị locked theo policy | P0 | Permission/UI | Module inactive | Load app registry | App ẩn/locked, route bị chặn |
| QA02-FOUNDATION-SETTING-001 | Cập nhật company setting hợp lệ | P1 | Positive | UI/API/DB | Admin có quyền | Sửa setting | Setting lưu đúng, audit log |
| QA02-FOUNDATION-SETTING-002 | Setting sai kiểu dữ liệu | P1 | Negative | API | Admin có quyền | Gửi value sai schema | Validation error |
| QA02-FOUNDATION-FILE-001 | Upload file hợp lệ | P0 | Positive | UI/API/DB | User có quyền upload | Upload file cho employee/task/leave | File metadata tạo, file_links đúng entity |
| QA02-FOUNDATION-FILE-002 | Upload file quá dung lượng | P1 | Negative | API | Có limit file size | Upload file vượt limit | Validation error, không lưu metadata |
| QA02-FOUNDATION-FILE-003 | Download file private có quyền | P0 | Positive | API/Security | User có quyền file | Click download | Trả signed URL/blob hợp lệ, log access nếu bật |
| QA02-FOUNDATION-FILE-004 | Download file private không có quyền | P0 | Security | API | User thiếu quyền | Gọi download file_id | 403/404, không trả storage path |
| QA02-FOUNDATION-AUDIT-001 | Audit log ghi thao tác quan trọng | P0 | DB/Security | Có thao tác create/update/delete | Thực hiện action | audit_logs có actor, target, module, action, timestamp |
| QA02-FOUNDATION-AUDIT-002 | User thiếu quyền không xem được audit log | P0 | Permission | UI/API | User không có AUDIT_LOG.VIEW | Vào audit log | 403/Forbidden state |
| QA02-FOUNDATION-SEQ-001 | Sinh mã tuần tự không trùng | P0 | DB/Integration | Sequence config active | Tạo nhiều employee/leave/project cùng lúc | Mã sinh đúng format, không trùng |
| QA02-FOUNDATION-SEQ-002 | Preview mã kế tiếp không làm tăng counter | P1 | API/DB | Có sequence config | Gọi preview nhiều lần | Counter không tăng, preview ổn định theo policy |
| QA02-FOUNDATION-HOLIDAY-001 | Public holiday ảnh hưởng tính công/nghỉ | P1 | Integration | Có holiday configured | Tạo leave/check attendance ngày lễ | Rule ATT/LEAVE áp dụng đúng |
| QA02-FOUNDATION-SEED-001 | Seed chạy lại không tạo trùng | P0 | DB | DB đã seed | Chạy seed lần hai | Không duplicate modules/permissions/roles/templates |

---

## 8. Ma trận test HR

### 8.1 Coverage HR

| Nhóm | Mục tiêu test |
| --- | --- |
| Employee | Danh sách, chi tiết, tạo, sửa, đổi trạng thái, xóa mềm |
| My Profile | Employee xem hồ sơ chính mình |
| Profile change request | Employee gửi yêu cầu, HR/Admin duyệt/từ chối, áp dụng thay đổi |
| Department/position/job level | CRUD danh mục tổ chức |
| Contract | Quản lý hợp đồng, file hợp đồng, hợp đồng sắp hết hạn |
| Employee code | Sinh mã tự động theo cấu hình, không trùng |
| Permission/data scope | Own/Team/Department/Company/System |
| Sensitive data | Mask dữ liệu nhạy cảm nếu thiếu quyền |

### 8.2 HR test case matrix

| Test ID | Test case | Priority | Type | Layer | Precondition | Steps tóm tắt | Expected result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA02-HR-EMP-001 | HR xem danh sách nhân viên toàn công ty | P0 | Positive | UI/API | HR có HR.EMPLOYEE.VIEW scope Company | GET /hr/employees | Trả đúng nhân viên trong company, phân trang |
| QA02-HR-EMP-002 | Manager xem danh sách nhân viên team | P0 | Permission | UI/API | Manager scope Team | GET employees | Chỉ trả nhân viên thuộc team |
| QA02-HR-EMP-003 | Employee chỉ xem hồ sơ chính mình | P0 | Permission | UI/API | Employee scope Own | Vào /hr/me hoặc GET my profile | Trả hồ sơ chính mình, không xem người khác |
| QA02-HR-EMP-004 | Tạo nhân viên hợp lệ | P0 | Positive | UI/API/DB | HR có quyền create | Submit form tạo nhân viên | Employee tạo thành công, employee_code tự sinh, audit log |
| QA02-HR-EMP-005 | Tạo nhân viên email trùng | P0 | Negative | API/DB | Email đã tồn tại | Submit email trùng | Validation/Conflict error |
| QA02-HR-EMP-006 | Tạo nhân viên thiếu field bắt buộc | P0 | Negative | UI/API | Form thiếu full_name/department/status | Submit | Validation inline + API details |
| QA02-HR-EMP-007 | Cập nhật hồ sơ nhân viên | P1 | Positive | UI/API/DB | HR có update | Sửa thông tin công việc | Dữ liệu cập nhật, lịch sử thay đổi/audit log |
| QA02-HR-EMP-008 | Đổi trạng thái nhân viên Official -> Resigned | P1 | Positive | UI/API/DB | HR có quyền | Đổi trạng thái | Status update, status history tạo, audit log |
| QA02-HR-EMP-009 | Nhân viên đã nghỉ việc không được chấm công | P0 | Integration | HR/ATT | Set employee Resigned -> gọi check-in | ATT chặn check-in |
| QA02-HR-EMP-010 | Xóa mềm nhân viên | P1 | Positive | API/DB | HR/Admin có quyền | Delete employee | Soft delete, không xóa cứng dữ liệu liên quan |
| QA02-HR-SENSITIVE-001 | Mask thông tin nhạy cảm nếu thiếu quyền | P0 | Security | UI/API | User thiếu HR.EMPLOYEE.VIEW_SENSITIVE | Xem employee detail | Dữ liệu nhạy cảm null/masked, UI MaskedField |
| QA02-HR-DEPT-001 | Tạo phòng ban mới | P1 | Positive | UI/API/DB | HR/Admin có quyền | Create department | Department active, unique trong company |
| QA02-HR-DEPT-002 | Tạo phòng ban trùng tên cùng company | P1 | Negative | API/DB | Department name tồn tại | Create trùng | Conflict/validation error |
| QA02-HR-DEPT-003 | Cây phòng ban không tạo vòng lặp | P1 | Negative | API/DB | Có parent/child dept | Set parent thành chính child | Bị chặn business rule |
| QA02-HR-POS-001 | Tạo chức vụ | P2 | Positive | UI/API/DB | Có quyền | Create position | Tạo thành công |
| QA02-HR-CONTRACT-001 | Tạo hợp đồng nhân viên | P1 | Positive | UI/API/DB | Employee active | Create contract | Contract tạo, file link nếu có, audit log |
| QA02-HR-CONTRACT-002 | Hợp đồng end_date trước start_date | P1 | Negative | API | Contract form | Submit date sai | Validation error |
| QA02-HR-CONTRACT-003 | Hợp đồng sắp hết hạn hiển thị dashboard HR | P2 | Integration | HR/DASH | Contract gần hết hạn | Load HR dashboard | Widget cảnh báo hiển thị nếu có quyền |
| QA02-HR-PROFILE-001 | Employee gửi yêu cầu sửa hồ sơ | P0 | Positive | UI/API/DB/NOTI | Employee active | Sửa phone/address -> Submit | Tạo profile_change_request Pending, HR nhận notification |
| QA02-HR-PROFILE-002 | Employee request không cập nhật hồ sơ chính ngay | P0 | Business | API/DB | Có request Pending | Kiểm tra employee record | Hồ sơ chính chưa đổi trước khi approve |
| QA02-HR-PROFILE-003 | HR duyệt profile change request | P0 | Positive | UI/API/DB/NOTI | Request Pending | Approve | Hồ sơ chính cập nhật, request Approved, employee nhận notification |
| QA02-HR-PROFILE-004 | HR từ chối profile change request | P1 | Positive | UI/API/DB/NOTI | Request Pending | Reject với lý do | Request Rejected, hồ sơ giữ nguyên, employee nhận notification |
| QA02-HR-PROFILE-005 | Duyệt request đã xử lý bởi người khác | P1 | Negative/Conflict | API | Request đã Approved | Approve lại | 409 conflict hoặc idempotent theo policy, UI refresh status |
| QA02-HR-CODE-001 | Cấu hình mã nhân viên hợp lệ | P1 | Positive | UI/API/DB | Admin/HR có quyền | Update employee_code_config | Rule lưu đúng, preview được mã kế tiếp |
| QA02-HR-CODE-002 | Sinh mã nhân viên song song không trùng | P0 | DB/Concurrency | Có sequence | Tạo nhiều employee đồng thời | employee_code unique trong company |
| QA02-HR-EXPORT-001 | Export danh sách nhân viên theo scope | P2 | Permission | API | HR scope Department | Export | File chỉ chứa nhân viên trong scope, audit log nếu bật |

---

## 9. Ma trận test ATT

### 9.1 Coverage ATT

| Nhóm | Mục tiêu test |
| --- | --- |
| Today attendance | Lấy trạng thái hôm nay, action được phép, lý do disabled |
| Check-in/out | Check-in/out web/mobile, server time, chống double submit |
| Leave blocking | Chặn chấm công khi có leave approved |
| Remote work | Tạo/duyệt remote/công tác, áp dụng rule remote |
| Attendance records | My/team/company records, filter, sort, pagination |
| Adjustment | Employee tạo request, Manager/HR duyệt/từ chối, HR manual adjust |
| Shift/rule | Quản lý ca, rule, assignment theo company/department/employee |
| Sensitive data | GPS/IP/device/file proof masking |
| Recalculate | Tính lại bảng công khi leave/remote/rule thay đổi |

### 9.2 ATT test case matrix

| Test ID | Test case | Priority | Type | Layer | Precondition | Steps tóm tắt | Expected result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA02-ATT-TODAY-001 | Lấy trạng thái chấm công hôm nay khi chưa check-in | P0 | Positive | UI/API | Employee active, không có leave | GET /attendance/today | can_check_in=true, can_check_out=false |
| QA02-ATT-TODAY-002 | Today attendance khi đã check-in | P0 | Positive | UI/API | Employee đã check-in | GET today | can_check_in=false, can_check_out=true |
| QA02-ATT-CHECKIN-001 | Check-in thành công bằng web | P0 | Positive | UI/API/DB | Employee active, có rule/shift | POST check-in | Tạo attendance_record/log, dùng server time, dashboard invalidated |
| QA02-ATT-CHECKIN-002 | Double check-in trong cùng ngày | P0 | Negative/Idempotency | API/DB | Đã check-in | Gửi check-in lần hai | Không tạo log/record trùng, trả lỗi business hoặc idempotent |
| QA02-ATT-CHECKIN-003 | Check-in khi employee chưa link user | P0 | Negative | API/UI | User không có employee_id | POST check-in | Bị chặn, UI báo liên hệ HR/Admin |
| QA02-ATT-CHECKIN-004 | Check-in khi nhân viên Resigned | P0 | Business | API | Employee status Resigned | POST check-in | Business error, không tạo record |
| QA02-ATT-CHECKIN-005 | Check-in khi có leave full-day Approved | P0 | Integration | ATT/LEAVE | Có đơn nghỉ cả ngày approved | GET today/POST check-in | Nút bị disable, API chặn, message rõ |
| QA02-ATT-CHECKIN-006 | Check-in remote khi remote request Approved | P1 | Integration | ATT | Có remote approved rule self check-in | POST remote check-in | Cho phép theo rule remote, source REMOTE/MOBILE/WEB đúng |
| QA02-ATT-CHECKOUT-001 | Check-out thành công | P0 | Positive | UI/API/DB | Employee đã check-in | POST check-out | attendance_record update checkout, worked_minutes tính đúng |
| QA02-ATT-CHECKOUT-002 | Check-out khi chưa check-in | P0 | Negative | API | Chưa có record | POST check-out | Business error |
| QA02-ATT-CHECKOUT-003 | Missing checkout hiển thị alert và CTA adjustment | P1 | UI/Business | Có record thiếu checkout | Load Today hoặc record detail | Alert hiển thị, CTA tạo adjustment nếu có quyền |
| QA02-ATT-RECORD-001 | Employee xem bảng công cá nhân | P0 | Permission | UI/API | Employee có VIEW_OWN | GET my-records | Chỉ trả record của chính mình |
| QA02-ATT-RECORD-002 | Manager xem bảng công team | P0 | Permission | UI/API | Manager scope Team | GET records | Chỉ team records |
| QA02-ATT-RECORD-003 | HR xem bảng công toàn công ty | P0 | Permission | UI/API | HR scope Company | GET records | Records trong company hiện tại |
| QA02-ATT-RECORD-004 | Filter bảng công theo date range | P1 | Positive | API | Có records | Query from_date/to_date | Trả đúng range, pagination đúng |
| QA02-ATT-RECORD-005 | Query range quá lớn | P2 | Negative/Performance | API | Range vượt limit | GET records | Bị giới hạn hoặc yêu cầu export theo policy |
| QA02-ATT-ADJ-001 | Employee gửi yêu cầu điều chỉnh quên checkout | P0 | Positive | UI/API/DB/NOTI | Có record thiếu checkout | Submit adjustment | Request Pending, notification manager/HR, audit nếu cần |
| QA02-ATT-ADJ-002 | Employee hủy adjustment Pending của mình | P1 | Positive | UI/API | Request Pending owner | Cancel | Status Cancelled |
| QA02-ATT-ADJ-003 | Employee hủy adjustment đã Approved | P1 | Negative | API | Request Approved | Cancel | Business error |
| QA02-ATT-ADJ-004 | Manager duyệt adjustment team | P0 | Positive | UI/API/DB/NOTI | Manager scope Team, request Pending | Approve | Record update, request Approved, notification employee |
| QA02-ATT-ADJ-005 | Manager duyệt request ngoài team | P0 | Permission | API | Request của employee ngoài team | Approve | 403/404, không cập nhật |
| QA02-ATT-ADJ-006 | HR/Admin điều chỉnh công trực tiếp | P0 | Positive/Sensitive | UI/API/DB/NOTI | HR có ADJUST_DIRECT | Manual adjust record | Transaction thành công, audit bắt buộc, notification nếu cấu hình |
| QA02-ATT-SHIFT-001 | Tạo ca cố định hợp lệ | P1 | Positive | UI/API/DB | HR/Admin có quyền | Create shift | Shift Active |
| QA02-ATT-SHIFT-002 | Tạo ca end_time không hợp lệ | P1 | Negative | API | Input sai | Submit | Validation error |
| QA02-ATT-SHIFT-003 | Gán ca theo phòng ban | P1 | Positive | UI/API/DB | Có department | Create shift_assignment Department | Employee thuộc dept resolve shift đúng |
| QA02-ATT-RULE-001 | Rule theo employee ưu tiên hơn department/company | P1 | Business | API/DB | Có nhiều rule scope | GET today | Rule priority đúng |
| QA02-ATT-REMOTE-001 | Employee tạo remote request | P1 | Positive | UI/API/DB/NOTI | Company bật remote | Submit remote request | Pending, gửi notification approver |
| QA02-ATT-REMOTE-002 | Duyệt remote request | P1 | Positive | UI/API/DB | Request Pending | Approve | Approved, today/record áp dụng rule remote |
| QA02-ATT-REMOTE-003 | Remote request trùng leave approved | P1 | Negative/Integration | ATT/LEAVE | Có leave approved cùng ngày | Submit remote | Bị chặn hoặc cảnh báo theo policy |
| QA02-ATT-SENSITIVE-001 | API list không trả GPS/IP/device chi tiết mặc định | P0 | Security | API | Có logs sensitive | GET records | Sensitive fields masked/không trả |
| QA02-ATT-SENSITIVE-002 | User có quyền sensitive xem chi tiết GPS/IP/device | P1 | Security | API/UI | HR có VIEW_SENSITIVE | GET detail | Trả/mask đúng theo quyền |
| QA02-ATT-RECALC-001 | Tính lại công khi leave approved | P0 | Integration | ATT/LEAVE | Có attendance record và leave approved | Trigger recalculate | Record status/required minutes cập nhật đúng |
| QA02-ATT-PERF-001 | Query bảng công tháng không N+1 employee summary | P2 | Performance | API | Có dữ liệu lớn | GET records month | Response trong SLA, query optimized |

---

## 10. Ma trận test LEAVE

### 10.1 Coverage LEAVE

| Nhóm | Mục tiêu test |
| --- | --- |
| Leave balance | My balance, admin adjust balance, ledger transaction |
| Leave request | Create draft, preview, submit, cancel |
| Approval | Manager/HR approve/reject, conflict, scope |
| Calendar | Lịch nghỉ cá nhân/team/company, không lộ thông tin nhạy cảm |
| Leave type/policy | CRUD loại nghỉ, policy, rule tính phép |
| ATT sync | Approved/cancelled/revoked đồng bộ sang bảng công |
| Notification | Event submit/approve/reject/cancel/balance adjusted |
| Transaction/locking | Balance không âm, approve đồng thời không double deduct |

### 10.2 LEAVE test case matrix

| Test ID | Test case | Priority | Type | Layer | Precondition | Steps tóm tắt | Expected result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA02-LEAVE-BAL-001 | Employee xem số dư phép của mình | P0 | Positive | UI/API | Employee active có balance | GET my leave balance | Trả đúng balance theo leave type/year |
| QA02-LEAVE-BAL-002 | HR xem balance nhân viên theo scope | P1 | Permission | API | HR scope Company/Department | GET balances | Chỉ trả trong scope |
| QA02-LEAVE-BAL-003 | HR điều chỉnh số dư phép | P0 | Positive/DB | UI/API/DB/NOTI | HR có quyền | Adjust balance | Balance update, transaction ledger, audit, notification |
| QA02-LEAVE-BAL-004 | Điều chỉnh balance âm vượt policy | P0 | Negative | API | Balance nhỏ | Adjust âm quá mức | Business error |
| QA02-LEAVE-REQ-001 | Employee tạo draft đơn nghỉ | P0 | Positive | UI/API/DB | Có leave type active | Save draft | Request Draft, chưa trừ balance chính thức theo policy |
| QA02-LEAVE-REQ-002 | Preview số ngày nghỉ full-day | P0 | Positive | API | Có shift/holiday config | Preview date range | Tính đúng working days, loại trừ holiday nếu policy |
| QA02-LEAVE-REQ-003 | Preview nghỉ half-day | P1 | Boundary | API | Có shift | Preview half day | Tính 0.5 ngày hoặc minutes đúng |
| QA02-LEAVE-REQ-004 | Preview nghỉ theo giờ | P1 | Boundary | API | Có shift | Preview hourly | Tính minutes đúng, không vượt shift |
| QA02-LEAVE-REQ-005 | Submit đơn nghỉ hợp lệ | P0 | Positive/Integration | UI/API/DB/NOTI | Balance đủ, no conflict | Submit | Status Pending, reserve/deduct theo policy, notification approver |
| QA02-LEAVE-REQ-006 | Submit vượt số dư phép | P0 | Negative | UI/API | Balance không đủ | Submit | Disable submit hoặc business error rõ |
| QA02-LEAVE-REQ-007 | Submit ngày kết thúc trước ngày bắt đầu | P0 | Negative | UI/API | Input date invalid | Submit | Validation error |
| QA02-LEAVE-REQ-008 | Submit trùng đơn nghỉ đã Approved/Pending | P0 | Negative | API/DB | Có request overlap | Submit | Business error conflict |
| QA02-LEAVE-REQ-009 | Employee hủy đơn Pending của mình | P1 | Positive | UI/API/DB/NOTI | Request Pending owner | Cancel | Status Cancelled, release balance, notification nếu cần |
| QA02-LEAVE-REQ-010 | Employee hủy đơn đã Approved theo policy không cho phép | P1 | Negative | API | Request Approved | Cancel | Business error |
| QA02-LEAVE-APP-001 | Manager xem đơn chờ duyệt của team | P0 | Permission | UI/API | Manager scope Team | GET approvals | Chỉ đơn của team |
| QA02-LEAVE-APP-002 | Manager duyệt đơn team | P0 | Positive/Integration | UI/API/DB/ATT/NOTI | Request Pending thuộc team | Approve | Approved, balance update, leave_request_days, ATT sync event, notification employee |
| QA02-LEAVE-APP-003 | Manager duyệt đơn ngoài team | P0 | Permission | API | Request ngoài team | Approve | 403/404, không thay đổi dữ liệu |
| QA02-LEAVE-APP-004 | HR duyệt đơn toàn công ty | P0 | Permission | API | HR scope Company | Approve request bất kỳ trong company | Thành công nếu policy cho phép |
| QA02-LEAVE-APP-005 | Reject đơn nghỉ bắt buộc có lý do | P0 | Negative | UI/API | Request Pending | Reject không reason | Validation error |
| QA02-LEAVE-APP-006 | Reject đơn nghỉ hợp lệ | P0 | Positive | UI/API/DB/NOTI | Request Pending | Reject reason | Rejected, release balance, notification employee |
| QA02-LEAVE-APP-007 | Hai người duyệt cùng lúc | P0 | Concurrency | API/DB | Request Pending | Approve đồng thời từ 2 actors | Chỉ một success, một conflict/idempotent, balance không trừ đôi |
| QA02-LEAVE-CAL-001 | Employee xem lịch nghỉ cá nhân | P1 | Positive | UI/API | Employee có request | GET my calendar | Trả ngày nghỉ của chính mình |
| QA02-LEAVE-CAL-002 | Manager xem lịch nghỉ team | P1 | Permission | UI/API | Manager scope Team | GET team calendar | Chỉ team, không lộ reason nhạy cảm nếu thiếu quyền |
| QA02-LEAVE-CAL-003 | HR xem lịch nghỉ company | P1 | Permission | UI/API | HR scope Company | GET company calendar | Trả đúng scope company |
| QA02-LEAVE-TYPE-001 | HR tạo loại nghỉ phép | P1 | Positive | UI/API/DB | HR/Admin có quyền | Create leave type | Leave type active |
| QA02-LEAVE-TYPE-002 | Không cho xóa cứng leave type đã dùng | P1 | Negative/DB | Leave type đã có request | Delete | Soft delete/disable hoặc business error |
| QA02-LEAVE-POLICY-001 | Tạo policy theo department | P1 | Positive | UI/API/DB | Có department | Create policy | Employee thuộc department resolve policy đúng |
| QA02-LEAVE-POLICY-002 | Policy employee override department/company | P1 | Business | API/DB | Có nhiều policy | Preview leave | Resolve policy priority đúng |
| QA02-LEAVE-SYNC-001 | Approved full-day đồng bộ ATT trạng thái Leave | P0 | Integration | LEAVE/ATT | Request full-day approved | Approve | attendance_records status Leave, check-in disabled |
| QA02-LEAVE-SYNC-002 | Cancel/Revoke đơn approved tính lại ATT | P0 | Integration | LEAVE/ATT | Request approved đã sync ATT | Cancel/Revoke | ATT recalculated, balance refund theo policy |
| QA02-LEAVE-NOTI-001 | Submit/approve/reject phát notification đúng người | P0 | Integration | LEAVE/NOTI | Có approver/employee | Thực hiện submit/approve/reject | Notification tạo đúng recipient, payload an toàn |
| QA02-LEAVE-PERF-001 | Pending approvals query không chậm | P2 | Performance | API/DB | Dữ liệu lớn | GET pending approvals | SLA đạt, index đúng |

---

## 11. Ma trận test TASK

### 11.1 Coverage TASK

| Nhóm | Mục tiêu test |
| --- | --- |
| Project | CRUD project, archive/close/cancel, member role |
| Task | Create/update/delete, status, priority, deadline, assignee/watchers |
| My tasks | Task được giao, task tạo, task theo dõi, overdue/due soon |
| Kanban | Board theo project/status, kéo thả đổi trạng thái |
| Comment/mention | Comment, edit/delete, mention tạo notification |
| Checklist | Tạo checklist, item, tick hoàn thành |
| File | Upload/download/delete file project/task |
| Activity/audit | Ghi activity log cho thay đổi quan trọng |
| Permission/scope | Own/Team/Project/Company/System và project role |
| LEAVE warning | Cảnh báo assignee đang nghỉ phép hoặc deadline trùng kỳ nghỉ |

### 11.2 TASK test case matrix

| Test ID | Test case | Priority | Type | Layer | Precondition | Steps tóm tắt | Expected result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA02-TASK-PROJ-001 | Tạo project hợp lệ | P0 | Positive | UI/API/DB | User có TASK.PROJECT.CREATE | Create project | Project active, creator/owner set, activity log |
| QA02-TASK-PROJ-002 | Tạo project thiếu tên | P0 | Negative | UI/API | Form thiếu name | Submit | Validation error |
| QA02-TASK-PROJ-003 | Thêm thành viên project | P0 | Positive | UI/API/DB/NOTI | Project owner/manager | Add member | project_members tạo, notification nếu bật |
| QA02-TASK-PROJ-004 | User ngoài project xem private project | P0 | Permission | API/UI | Project private, user không member | GET project detail | 403/404 |
| QA02-TASK-PROJ-005 | Cập nhật role member trong project | P1 | Positive | UI/API/DB | Có quyền quản lý member | Update role | Role cập nhật, activity log |
| QA02-TASK-PROJ-006 | Archive/close project | P1 | Positive | UI/API/DB | Có quyền | Archive/close | Project status đổi, task update behavior theo policy |
| QA02-TASK-TASK-001 | Tạo task thuộc project | P0 | Positive | UI/API/DB/NOTI | Có project, có assignee | Create task | Task created, assignee set, notification assignee, activity log |
| QA02-TASK-TASK-002 | Tạo task cá nhân nếu cấu hình cho phép | P1 | Positive | API/UI | Personal task enabled | Create personal task | Task không cần project, owner đúng |
| QA02-TASK-TASK-003 | Tạo task không có title | P0 | Negative | UI/API | Missing title | Submit | Validation error |
| QA02-TASK-TASK-004 | Giao task cho nhân viên inactive/resigned | P0 | Negative | API/HR | Employee inactive | Assign task | Business error hoặc không cho chọn |
| QA02-TASK-TASK-005 | Giao task cho nhân viên đang nghỉ phép | P1 | Integration | UI/API/LEAVE | Assignee có leave approved | Assign | UI hiển thị warning, backend xử lý theo policy |
| QA02-TASK-TASK-006 | Deadline nằm trong kỳ nghỉ approved của assignee | P1 | Integration | UI/API/LEAVE | Assignee leave | Set deadline trong leave | Warning/cảnh báo đúng |
| QA02-TASK-TASK-007 | Employee xem My Tasks | P0 | Permission | UI/API | Có task assigned | GET my-tasks | Chỉ trả task liên quan user hiện tại |
| QA02-TASK-TASK-008 | Manager xem task team | P1 | Permission | API | Manager scope Team | GET tasks | Chỉ task team/project liên quan |
| QA02-TASK-STATUS-001 | Cập nhật trạng thái Todo -> In Progress | P0 | Positive | UI/API/DB/NOTI | User có quyền update | PATCH task status | Status update, activity log, notification nếu cấu hình |
| QA02-TASK-STATUS-002 | Cập nhật Done task không có quyền | P0 | Permission | API/UI | User thiếu update | PATCH task | 403, UI ẩn/disable action |
| QA02-TASK-STATUS-003 | Chuyển trạng thái không hợp lệ theo workflow | P1 | Negative | API | Workflow config không cho | PATCH status | Business error |
| QA02-TASK-KANBAN-001 | Load Kanban board theo project | P0 | Positive | UI/API | User có quyền xem project | GET board | Columns/status/task đúng scope |
| QA02-TASK-KANBAN-002 | Drag task đổi trạng thái thành công | P0 | Positive | UI/API | User có quyền update | Drag card | Status đổi, optimistic rollback nếu API lỗi |
| QA02-TASK-KANBAN-003 | Drag task khi thiếu quyền | P0 | Permission | UI/API | User thiếu update | Drag card | UI không cho drag hoặc API 403, rollback card |
| QA02-TASK-CMT-001 | Thêm comment task | P1 | Positive | UI/API/DB | User có quyền comment | Submit comment | Comment tạo, activity log |
| QA02-TASK-CMT-002 | Mention user trong comment | P1 | Integration | TASK/NOTI | Mention valid user | Submit comment @user | Notification TASK_MENTIONED tạo đúng recipient |
| QA02-TASK-CMT-003 | Sửa comment của người khác không có quyền | P1 | Permission | API/UI | User không phải author/admin | Edit comment | 403/ẩn action |
| QA02-TASK-CHECK-001 | Tạo checklist và item | P1 | Positive | UI/API/DB | Có task | Add checklist/items | Items tạo đúng thứ tự |
| QA02-TASK-CHECK-002 | Tick checklist item hoàn thành | P1 | Positive | UI/API/DB | Có checklist item | Click checkbox | Item completed, activity nếu cấu hình |
| QA02-TASK-FILE-001 | Upload file task | P1 | Positive | UI/API/DB | Có quyền upload | Upload file | file metadata/link task_files tạo |
| QA02-TASK-FILE-002 | Download file task thiếu quyền | P0 | Security | API | User không có quyền task/file | Download | 403/404, không lộ private URL |
| QA02-TASK-ACT-001 | Activity log ghi khi đổi assignee/status/deadline | P1 | DB | Có task | Update fields | task_activity_logs có event chính |
| QA02-TASK-OVERDUE-001 | Task quá hạn hiển thị badge/cảnh báo | P1 | UI/API | Task due_at < today chưa Done | Load list/dashboard | Badge overdue đúng |
| QA02-TASK-PERF-001 | My Tasks không N+1 employee/project | P2 | Performance | API/DB | Dữ liệu lớn | GET my-tasks | SLA đạt, query optimized |

---

## 12. Ma trận test NOTI

### 12.1 Coverage NOTI

| Nhóm | Mục tiêu test |
| --- | --- |
| My notifications | List, dropdown, unread count, detail |
| Actions | Mark read, mark all read, hide/archive/delete soft |
| Deep link | Resolve target, module gốc kiểm tra quyền lại |
| Admin config | Event, template, channel, delivery log |
| Internal event | Module khác phát event, recipient resolver, dedupe |
| Delivery | Delivery log, retry, provider failure |
| Security | Notification chỉ owner xem, payload không chứa secret/sensitive quá mức |
| Performance | Unread count, dropdown, notification list |

### 12.2 NOTI test case matrix

| Test ID | Test case | Priority | Type | Layer | Precondition | Steps tóm tắt | Expected result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA02-NOTI-MY-001 | User xem unread count của mình | P0 | Positive | UI/API/DB | Có unread notifications | GET unread-count | Count đúng recipient_user_id hiện tại |
| QA02-NOTI-MY-002 | User xem dropdown notification | P0 | Positive | UI/API | Có notifications | GET dropdown | Trả latest items, phân biệt unread/read |
| QA02-NOTI-MY-003 | User xem danh sách notification | P0 | Positive | UI/API | Có notifications | GET notifications | List phân trang, filter read/unread đúng |
| QA02-NOTI-MY-004 | User xem notification không thuộc mình | P0 | Security | API | Notification của user khác | GET notification_id | 403/404 |
| QA02-NOTI-ACTION-001 | Mark read notification Unread | P0 | Positive | UI/API/DB | Notification Unread của user | POST mark-read | read_at set, unread count giảm |
| QA02-NOTI-ACTION-002 | Mark read notification đã Read | P1 | Idempotency | API | Notification đã read | POST mark-read | Success idempotent, không lỗi |
| QA02-NOTI-ACTION-003 | Mark all read | P0 | Positive | UI/API/DB | Có nhiều unread của user | POST mark-all-read | Chỉ update notification của user hiện tại, count về 0 |
| QA02-NOTI-ACTION-004 | Hide/archive notification | P1 | Positive | UI/API/DB | Notification của user | Hide/archive | Không xuất hiện trong list mặc định |
| QA02-NOTI-ACTION-005 | Delete soft notification | P1 | Positive/DB | Notification của user | DELETE | Soft delete, delivery log vẫn còn |
| QA02-NOTI-DEEP-001 | Click notification mark read và deep link sang module gốc | P0 | E2E/Integration | Có notification target | Click notification | Mark read, điều hướng target, module gốc kiểm tra quyền |
| QA02-NOTI-DEEP-002 | Deep link target đã bị xóa | P1 | Negative | UI/API | Target entity deleted | Click target | UI hiển thị target unavailable/404 thân thiện |
| QA02-NOTI-DEEP-003 | User mất quyền sau khi nhận notification | P0 | Permission | UI/API | User có notification nhưng thiếu quyền target | Click target | Module gốc trả 403, NOTI không bypass permission |
| QA02-NOTI-EVENT-001 | Event TASK_ASSIGNED tạo notification assignee | P0 | Integration | Internal API | Trigger TASK_ASSIGNED | Notification tạo đúng assignee, payload an toàn |
| QA02-NOTI-EVENT-002 | Event LEAVE_REQUEST_SUBMITTED gửi manager/HR | P0 | Integration | Internal API/HR | Trigger leave submit | Recipient resolver đúng approver |
| QA02-NOTI-EVENT-003 | Event disabled không tạo notification mới | P1 | Business | API/DB | Event disabled | Trigger event | Skipped/log theo policy, không tạo notification |
| QA02-NOTI-EVENT-004 | Dedupe key trùng | P1 | Idempotency | API/DB | Same event/dedupe_key | Trigger 2 lần | Không tạo trùng, deduped_count/log đúng |
| QA02-NOTI-EVENT-005 | Payload chứa password/token/secret | P0 | Security | API | Event payload có secret | Trigger event | Validation error, không lưu payload nguy hiểm |
| QA02-NOTI-TPL-001 | Admin xem danh mục event/template | P1 | Permission | UI/API | Admin có quyền | GET events/templates | Trả danh sách theo scope |
| QA02-NOTI-TPL-002 | Tạo template với biến không có schema | P1 | Negative | UI/API | Admin có quyền | Create template invalid var | Validation error |
| QA02-NOTI-TPL-003 | Preview template hợp lệ | P2 | Positive | UI/API | Template có schema | Preview | Render đúng biến |
| QA02-NOTI-DELIVERY-001 | Xem delivery log không có quyền | P1 | Permission | API/UI | User thiếu quyền | GET delivery logs | 403 |
| QA02-NOTI-DELIVERY-002 | Retry failed delivery log | P2 | Positive | API/DB | Failed log còn attempt | Retry | Tạo attempt mới hoặc set Pending |
| QA02-NOTI-DELIVERY-003 | Retry log Sent | P2 | Negative | API | Log already Sent | Retry | Business error |
| QA02-NOTI-PERF-001 | Unread count không scan toàn bảng | P1 | Performance | DB/API | Dữ liệu lớn | GET unread-count | SLA đạt, index theo recipient/status/company |

---

## 13. Ma trận test DASH

### 13.1 Coverage DASH

| Nhóm | Mục tiêu test |
| --- | --- |
| Dashboard me/type | Lấy dashboard mặc định, dashboard type Employee/Manager/HR/Admin |
| Widget visibility | Widget theo permission, role, data scope, config |
| Widget data | Attendance today, leave balance, pending approvals, task alerts, HR summary, notification |
| Quick action | Điều hướng về module gốc, không xử lý nghiệp vụ trực tiếp |
| Cache/fallback | Cache key theo user/scope/company, invalidation, degraded state |
| Admin config | Bật/tắt/sắp xếp widget theo company/role/user |
| Security | Không expose dữ liệu nhạy cảm, không dùng cache sai user |
| Performance | Dashboard /me phản hồi nhanh với nhiều widget |

### 13.2 DASH test case matrix

| Test ID | Test case | Priority | Type | Layer | Precondition | Steps tóm tắt | Expected result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA02-DASH-ME-001 | Employee load dashboard mặc định | P0 | Positive | UI/API | Employee có quyền DASH | GET /dashboard/me | Trả Employee dashboard + widget phù hợp |
| QA02-DASH-ME-002 | Manager load dashboard mặc định | P0 | Positive | UI/API | Manager có quyền | GET /dashboard/me | Trả dashboard type/summary theo role/permission |
| QA02-DASH-ME-003 | HR load dashboard mặc định | P0 | Positive | UI/API | HR có quyền | GET /dashboard/me | Trả HR widgets đúng scope |
| QA02-DASH-ME-004 | Admin load dashboard mặc định | P1 | Positive | UI/API | Admin có quyền | GET /dashboard/me | Trả Admin dashboard widgets |
| QA02-DASH-PERM-001 | Employee không xem Admin Dashboard | P0 | Permission | UI/API | Employee thiếu quyền | GET /dashboard/admin | 403 hoặc không trả type |
| QA02-DASH-PERM-002 | User thiếu permission widget không nhận widget trong /me | P0 | Permission | API/UI | Remove widget permission | GET /dashboard/me | Widget bị ẩn/không trả |
| QA02-DASH-SCOPE-001 | Manager widget pending leave chỉ team | P0 | Permission | API/DB | Manager scope Team | GET pending leave widget | Chỉ đơn của team |
| QA02-DASH-SCOPE-002 | HR scope Department không xem toàn company | P0 | Permission | API/DB | HR scope Department | GET HR overview | Chỉ department hoặc 403 với company overview |
| QA02-DASH-WIDGET-001 | Widget attendance today phản ánh trạng thái check-in | P0 | Integration | DASH/ATT | Employee check-in | GET attendance widget | Widget status Checked-in |
| QA02-DASH-WIDGET-002 | Widget leave balance cập nhật sau submit/approve/cancel | P0 | Integration | DASH/LEAVE | Có leave action | Refresh widget | Balance/count đúng sau invalidation |
| QA02-DASH-WIDGET-003 | Widget task alerts không tính Done/Cancelled quá hạn | P1 | Business | DASH/TASK | Có task nhiều status | GET task-alerts | Chỉ Todo/In Progress/In Review overdue/due soon |
| QA02-DASH-WIDGET-004 | Widget notification latest chỉ của user hiện tại | P0 | Security | DASH/NOTI | Có notification nhiều user | GET notification widget | Chỉ recipient current user |
| QA02-DASH-WIDGET-005 | Widget HR contract expiring chỉ khi có quyền nguồn | P1 | Permission | DASH/HR | User thiếu HR contract permission | GET dashboard | Không trả widget/data nhạy cảm |
| QA02-DASH-QUICK-001 | Quick action Check-in điều hướng/call ATT đúng | P0 | Integration/UI | Employee có can_check_in | Click quick action | Gọi ATT hoặc điều hướng ATT, ATT kiểm tra lại rule |
| QA02-DASH-QUICK-002 | Quick action Approve Leave điều hướng về LEAVE | P0 | Integration/UI | Manager có pending leave | Click action | Sang LEAVE approvals, LEAVE guard kiểm tra lại |
| QA02-DASH-CACHE-001 | Cache key không dùng chung giữa user khác nhau | P0 | Security/DB | Có widgets Own data | Load dashboard 2 user | Không rò dữ liệu user A sang B |
| QA02-DASH-CACHE-002 | Invalidate cache khi task đổi trạng thái | P1 | Integration | DASH/TASK | Task status update | Load widget | Widget stale/refresh đúng |
| QA02-DASH-CACHE-003 | Source ATT lỗi chỉ widget attendance degraded | P1 | Resilience | API | Simulate ATT failure | GET dashboard | Dashboard tổng success, widget degraded/error state |
| QA02-DASH-CONFIG-001 | Admin tắt widget theo role | P1 | Positive | UI/API/DB | Admin có config permission | Disable widget | Widget không trả cho role tương ứng |
| QA02-DASH-CONFIG-002 | Config widget trùng | P1 | Negative | API/DB | Existing config | Create duplicate | 409 conflict/upsert theo strategy |
| QA02-DASH-SEC-001 | Dashboard không trả audit diff nhạy cảm | P0 | Security | API | System logs widget | GET widget | old_value/new_value sensitive masked/không trả |
| QA02-DASH-PERF-001 | /dashboard/me với 5-8 widget phản hồi trong SLA | P1 | Performance | API | Dữ liệu đủ lớn | GET /dashboard/me | Response đạt SLA, không N+1 |

---

## 14. Ma trận test luồng liên module CROSS

### 14.1 Coverage CROSS

| Luồng | Module liên quan | Mục tiêu test |
| --- | --- | --- |
| Login -> Home -> Module Workspace -> App Switcher | AUTH, FOUNDATION, UI shell | Điều hướng, app visibility, route guard |
| HR tạo employee -> AUTH link user -> Employee login | HR, AUTH, NOTI | Tạo nhân viên và tài khoản hoạt động đúng |
| Employee profile change -> HR approve -> NOTI | HR, AUTH, NOTI | Self-service có kiểm duyệt |
| Check-in -> DASH widget -> NOTI missing checkout | ATT, DASH, NOTI | Chấm công cập nhật dashboard và notification |
| Leave submit -> Manager approve -> ATT sync -> DASH/NOTI | LEAVE, HR, AUTH, ATT, DASH, NOTI | Luồng nghỉ phép cốt lõi |
| Task assign -> NOTI -> DASH task alerts | TASK, HR, NOTI, DASH | Giao việc, thông báo, dashboard |
| Notification deep link -> module gốc guard | NOTI, AUTH, module target | Deep link an toàn |
| File upload/download trên nhiều module | FOUNDATION, HR, LEAVE, TASK, ATT | File service dùng chung, permission |
| Audit log thao tác quan trọng | FOUNDATION, all modules | Truy vết đầy đủ |

### 14.2 CROSS test case matrix

| Test ID | Test case | Priority | Type | Layer | Precondition | Steps tóm tắt | Expected result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA02-CROSS-NAV-001 | Login thành công -> Home Portal | P0 | E2E | UI/API | User active | Login | Vào /home, app grid theo permission |
| QA02-CROSS-NAV-002 | Home Portal -> Module Workspace | P0 | E2E | UI | User có quyền app | Click HR/ATT/LEAVE/TASK | Vào workspace đúng, sidebar module đúng |
| QA02-CROSS-NAV-003 | App Switcher đổi module | P0 | E2E | UI | Đang trong module | Mở App Switcher -> chọn app khác | Điều hướng module mới, dirty form guard nếu có form chưa lưu |
| QA02-CROSS-HR-AUTH-001 | HR tạo employee và liên kết user | P0 | Integration | HR/AUTH | HR có quyền | Create employee + user link | Employee có user login được, data scope Own đúng |
| QA02-CROSS-HR-NOTI-001 | Employee gửi profile change -> HR nhận notification | P0 | E2E | HR/NOTI | Employee active, HR approver | Submit request | HR có notification/unread count tăng |
| QA02-CROSS-HR-NOTI-002 | HR approve profile change -> Employee nhận notification | P0 | E2E | HR/NOTI | Request Pending | HR approve | Employee notification, profile updated |
| QA02-CROSS-ATT-DASH-001 | Check-in cập nhật attendance widget | P0 | Integration | ATT/DASH | Employee active | Check-in -> refresh dashboard | Widget attendance status update |
| QA02-CROSS-ATT-NOTI-001 | Missing checkout job tạo notification | P1 | Integration | ATT/NOTI | Record thiếu checkout | Run job | Notification ATT_MISSING_CHECKOUT cho employee |
| QA02-CROSS-LEAVE-ATT-001 | Leave approved full-day chặn check-in | P0 | E2E | LEAVE/ATT | Employee có leave full-day approved hôm nay | Employee mở ATT today | Check-in/out disabled, API cũng chặn |
| QA02-CROSS-LEAVE-ATT-002 | Leave hourly giảm required working minutes | P1 | Integration | LEAVE/ATT | Leave hourly approved | Recalculate attendance | Required minutes giảm đúng |
| QA02-CROSS-LEAVE-DASH-NOTI-001 | Submit leave tăng pending approval widget và notification | P0 | E2E | LEAVE/DASH/NOTI | Employee submit leave | Load manager dashboard/noti | Pending count tăng, notification xuất hiện |
| QA02-CROSS-LEAVE-DASH-NOTI-002 | Approve leave cập nhật balance, calendar, attendance, dashboard, notification | P0 | E2E | LEAVE/ATT/DASH/NOTI | Request Pending | Approve | Balance/calendar/ATT/DASH/NOTI đồng bộ đúng |
| QA02-CROSS-TASK-NOTI-001 | Assign task gửi notification assignee | P0 | E2E | TASK/NOTI | Task created with assignee | Assign | Assignee nhận notification TASK_ASSIGNED |
| QA02-CROSS-TASK-DASH-001 | Task overdue xuất hiện dashboard task alerts | P1 | Integration | TASK/DASH | Task overdue chưa Done | Load dashboard | Widget task alerts hiển thị đúng |
| QA02-CROSS-TASK-LEAVE-001 | Assign task cho employee đang nghỉ phép hiển thị warning | P1 | Integration | TASK/LEAVE | Assignee có leave approved | Assign task | Warning hiển thị theo policy |
| QA02-CROSS-NOTI-DEEP-001 | Notification deep link sang leave request | P0 | E2E/Security | User có noti leave | Click notification | Mark read, mở LEAVE detail nếu còn quyền |
| QA02-CROSS-NOTI-DEEP-002 | Notification deep link khi mất quyền target | P0 | Security | NOTI/AUTH/Target | User bị gỡ quyền sau khi nhận noti | Click notification | Target module trả forbidden, không lộ dữ liệu |
| QA02-CROSS-FILE-001 | Upload file chứng minh leave qua file service | P1 | Integration | LEAVE/FOUNDATION | User tạo leave có file | Upload + submit | File linked đúng leave, private |
| QA02-CROSS-FILE-002 | User không có quyền không tải được file task/employee | P0 | Security | TASK/HR/FOUNDATION | File private | Download trái quyền | 403/404 |
| QA02-CROSS-AUDIT-001 | Các action quan trọng ghi audit log | P0 | Integration | All/FOUNDATION | Thực hiện create/update/approve/manual adjust | Kiểm tra audit | Log có actor/action/target/module/company |

---

## 15. Ma trận test API contract chung

| Test ID | Test case | Priority | Type | Layer | Precondition | Steps tóm tắt | Expected result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA02-API-CONTRACT-001 | Tất cả API protected yêu cầu Authorization header | P0 | Security | API | Không gửi token | Gọi API nghiệp vụ | 401 |
| QA02-API-CONTRACT-002 | Response success có success/message/data/meta | P0 | Contract | API | Gọi API thành công | Verify schema | Đúng contract chung |
| QA02-API-CONTRACT-003 | Response list có pagination | P0 | Contract | API | Gọi list API | Verify schema | Có pagination đúng |
| QA02-API-CONTRACT-004 | Validation error có details theo field | P0 | Contract | API | Gửi body invalid | Verify error | success=false, error.details đầy đủ |
| QA02-API-CONTRACT-005 | Forbidden trả 403 và không xử lý nghiệp vụ | P0 | Security | API | User thiếu quyền | Gọi action | 403, không mutate DB |
| QA02-API-CONTRACT-006 | API không tin company_id từ frontend | P0 | Security | API | Body/query truyền company_id khác | Gọi API | Backend dùng auth context, không cross-company |
| QA02-API-CONTRACT-007 | API quan trọng hỗ trợ Idempotency-Key | P0 | Reliability | API/DB | Action submit/approve/check-in | Retry cùng key | Không tạo trùng, response theo policy |
| QA02-API-CONTRACT-008 | Date/time ISO 8601 + timezone đúng | P1 | Contract | API | Gọi API có date/time | Verify response | ISO 8601, timezone Asia/Ho_Chi_Minh khi phù hợp |
| QA02-API-CONTRACT-009 | API list search/filter/sort theo whitelist | P1 | Contract | API | Query sort/filter invalid | Gọi API | Validation error, không SQL injection |
| QA02-API-CONTRACT-010 | Không trả stack trace khi lỗi server | P0 | Security | API | Simulate server error | Gọi API | Error sanitized, có request_id |

---

## 16. Ma trận test UI state chung

| Test ID | Test case | Priority | Type | Layer | Precondition | Steps tóm tắt | Expected result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA02-UI-STATE-001 | Loading state table dùng skeleton | P1 | UI | FE | API loading | Mở list screen | Skeleton đúng layout |
| QA02-UI-STATE-002 | Empty state có message phù hợp | P1 | UI | FE | API trả data rỗng | Mở list | Empty theo ngữ cảnh, CTA nếu có quyền |
| QA02-UI-STATE-003 | Error state có retry và request id nếu có | P1 | UI | FE/API lỗi | Mở screen | ErrorState + Retry + request_id |
| QA02-UI-STATE-004 | Forbidden state không lộ dữ liệu | P0 | Security/UI | User thiếu quyền | Vào route trái quyền | Forbidden page, không render dữ liệu |
| QA02-UI-STATE-005 | Disabled action có tooltip lý do business rule | P1 | UI | Button disabled do rule | Hover/click | Tooltip/message rõ |
| QA02-UI-STATE-006 | Dirty form guard khi rời form chưa lưu | P1 | UI | Form có thay đổi | Đổi route/app | Confirm dialog hiển thị |
| QA02-UI-STATE-007 | Double submit bị chặn | P0 | UI/Reliability | Submit đang loading | Click liên tục | Button loading/disabled, không gửi trùng |
| QA02-UI-STATE-008 | Toast success/error phù hợp sau mutation | P1 | UI | Mutation success/error | Thực hiện action | Toast đúng, query invalidation đúng |
| QA02-UI-STATE-009 | Field-level validation inline | P1 | UI/API | Form invalid | Submit | Field error + error summary nếu nhiều lỗi |
| QA02-UI-STATE-010 | Stale data hiển thị last_updated khi dashboard cache | P2 | UI | Widget cached | Load dashboard | Có last_updated/stale indicator nếu cần |

---

## 17. Ma trận test responsive & accessibility

| Test ID | Test case | Priority | Type | Layer | Precondition | Steps tóm tắt | Expected result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA02-A11Y-RESP-001 | Desktop layout Module Workspace | P1 | Responsive | UI | Desktop viewport | Mở HR/ATT/LEAVE/TASK | Sidebar/topbar/content đúng |
| QA02-A11Y-RESP-002 | Tablet sidebar collapsed/drawer | P1 | Responsive | UI | Tablet viewport | Mở module | Sidebar responsive đúng |
| QA02-A11Y-RESP-003 | Mobile list dạng card hoặc table scroll hợp lý | P1 | Responsive | UI | Mobile web | Mở list P0 | Không vỡ layout, action dùng menu/drawer |
| QA02-A11Y-RESP-004 | Form mobile fullscreen/drawer không mất field | P1 | Responsive | UI | Mobile web | Mở form leave/task/profile | Dùng fullscreen/drawer, submit visible |
| QA02-A11Y-KEY-001 | Keyboard tab order hợp lý | P1 | Accessibility | UI | Keyboard only | Tab qua form/action | Focus order logic, không bị trap sai |
| QA02-A11Y-KEY-002 | Modal/drawer focus trap đúng | P1 | Accessibility | UI | Mở modal/drawer | Tab/Esc | Focus trong modal, Esc/close đúng policy |
| QA02-A11Y-VIS-001 | Icon-only button có aria-label/title | P1 | Accessibility | UI | Có icon button | Inspect UI | Screen reader label đủ |
| QA02-A11Y-VIS-002 | Trạng thái không chỉ dùng màu | P1 | Accessibility | UI | Status badge/error | Inspect | Có text/icon/badge, không chỉ màu |
| QA02-A11Y-VIS-003 | Focus visible trên button/link/input | P1 | Accessibility | UI | Keyboard navigation | Tab | Focus ring rõ |

---

## 18. Ma trận test security

| Test ID | Test case | Priority | Type | Layer | Precondition | Steps tóm tắt | Expected result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA02-SEC-AUTH-001 | API nghiệp vụ không cho anonymous | P0 | Security | API | Không token | Gọi API | 401 |
| QA02-SEC-AUTH-002 | Token user A không xem dữ liệu user B Own | P0 | Security | API | User A token | Gọi target user B | 403/404 |
| QA02-SEC-TENANT-001 | Cross-company id enumeration bị chặn | P0 | Security | API/DB | User company A biết id company B | GET target | 403/404, không leak existence |
| QA02-SEC-PERM-001 | Frontend hide action nhưng API vẫn guard | P0 | Security | API/UI | User thiếu quyền | Gọi API trực tiếp bằng curl/Postman | 403 |
| QA02-SEC-FILE-001 | Private file không trả storage path/public URL | P0 | Security | API | Download file | Inspect response | Không lộ storage internal path |
| QA02-SEC-FILE-002 | File access sensitive ghi log nếu setting bật | P1 | Security/DB | Setting bật | Download sensitive file | file_access_logs có record |
| QA02-SEC-PAYLOAD-001 | Notification payload không chứa secret/sensitive quá mức | P0 | Security | API/DB | Trigger notification | Inspect DB/response | Không lưu token/password/private data |
| QA02-SEC-EXPORT-001 | Export dữ liệu theo permission/scope | P1 | Security | API | User scope Department | Export HR/ATT/LEAVE | File chỉ chứa dữ liệu trong scope |
| QA02-SEC-LOG-001 | Error response không có stack trace/SQL detail | P0 | Security | API | Simulate exception | Inspect response | Sanitized error + request_id |
| QA02-SEC-CACHE-001 | Logout clear sensitive cache | P0 | Security/FE | User logged in có dữ liệu sensitive | Logout -> login user khác | Không thấy dữ liệu user cũ |

---

## 19. Ma trận test performance MVP

| Test ID | Test case | Priority | Type | Layer | Dataset đề xuất | SLA mục tiêu gợi ý | Expected result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA02-PERF-AUTH-001 | Login API response time | P1 | Performance | API | 1k users | <= 1s p95 | Login ổn định |
| QA02-PERF-HR-001 | Employee list search/filter/pagination | P1 | Performance | API/DB | 10k employees | <= 1.5s p95 | Không full scan bất hợp lý |
| QA02-PERF-ATT-001 | Attendance records month query | P1 | Performance | API/DB | 10k employees x 31 days | <= 2s p95 | Query dùng index, pagination |
| QA02-PERF-LEAVE-001 | Pending approvals query | P1 | Performance | API/DB | 50k requests | <= 1.5s p95 | Query theo approver/scope nhanh |
| QA02-PERF-TASK-001 | My tasks / Kanban board | P1 | Performance | API/DB | 100k tasks | <= 2s p95 | Không N+1, pagination/lazy load |
| QA02-PERF-NOTI-001 | Unread count | P0 | Performance | API/DB | 1M notifications | <= 500ms p95 | Có index/cache phù hợp |
| QA02-PERF-DASH-001 | Dashboard /me 5-8 widgets | P1 | Performance | API | Dataset tích hợp | <= 2s p95 | Widget cache/lazy load/fallback |
| QA02-PERF-EXPORT-001 | Export lớn chạy async hoặc giới hạn | P2 | Performance | API | 100k records | Không timeout request thường | Có job/export policy nếu cần |

---

## 20. Ma trận regression suite đề xuất

### 20.1 Smoke regression P0 trước mỗi release

| Test ID | Luồng smoke | Module | Priority | Expected result |
| --- | --- | --- | --- | --- |
| QA02-REG-SMOKE-001 | Login -> Home Portal -> App Switcher | AUTH/FOUNDATION | P0 | User vào được Home, app đúng quyền |
| QA02-REG-SMOKE-002 | Open Dashboard /me | DASH | P0 | Dashboard load success, widget không lỗi toàn trang |
| QA02-REG-SMOKE-003 | HR employee list/detail | HR | P0 | Danh sách và detail load đúng scope |
| QA02-REG-SMOKE-004 | Check-in -> check-out | ATT | P0 | Record/log tạo đúng |
| QA02-REG-SMOKE-005 | Create leave -> submit -> approve | LEAVE | P0 | State transition đúng, notification/ATT sync |
| QA02-REG-SMOKE-006 | Create task -> assign -> update status | TASK | P0 | Task flow thành công, notification assignee |
| QA02-REG-SMOKE-007 | Notification unread -> mark read -> deep link | NOTI | P0 | Count giảm, target guard đúng |
| QA02-REG-SMOKE-008 | Permission 403 trực tiếp API | AUTH/All | P0 | User thiếu quyền không truy cập được |

### 20.2 Regression theo module khi có thay đổi

| Khu vực thay đổi | Regression bắt buộc |
| --- | --- |
| Auth/session/permission | Toàn bộ QA02-AUTH + permission test các module P0 |
| Employee/department/direct manager | HR P0 + ATT/LEAVE/TASK scope + Dashboard Manager |
| Attendance rule/shift | ATT P0/P1 + LEAVE sync + Dashboard attendance |
| Leave policy/balance | LEAVE P0/P1 + ATT sync + Dashboard leave widgets |
| Task status/assignee/comment | TASK P0/P1 + NOTI + DASH task alerts |
| Notification event/template | NOTI P0/P1 + all event producers |
| Dashboard cache/widget | DASH P0/P1 + source module mutation invalidation |
| File service | FOUNDATION file + HR/LEAVE/TASK/ATT file cases |
| API client/error handling | API contract + UI state/error mapping + smoke E2E |

---

## 21. Test data tối thiểu cần chuẩn bị

### 21.1 Company/user/role

| Nhóm | Dữ liệu tối thiểu |
| --- | --- |
| Company | Company A active, Company B active, Company C inactive |
| Roles | SUPER_ADMIN, COMPANY_ADMIN, HR, MANAGER, EMPLOYEE, PROJECT_MANAGER |
| Users | 1 Super Admin, 1 Company Admin, 2 HR, 2 Manager, 5 Employee, 1 locked user |
| Scope | Employee Own, Manager Team, HR Department, HR Company, Super Admin System |

### 21.2 HR data

| Nhóm | Dữ liệu tối thiểu |
| --- | --- |
| Departments | Engineering, HR, Sales, nested department |
| Positions | Developer, HR Executive, Sales Executive, Manager |
| Employees | Active, Probation, Official, Inactive, Resigned |
| Contracts | Active contract, expiring soon, expired |
| Profile change | Draft/Pending/Approved/Rejected request |

### 21.3 ATT data

| Nhóm | Dữ liệu tối thiểu |
| --- | --- |
| Shifts | Fixed office shift, flexible shift |
| Rules | Company rule, department rule, employee override rule |
| Attendance records | Present, Late, Missing checkout, Leave, Remote, Adjusted |
| Adjustment | Pending, Approved, Rejected, Cancelled |
| Remote request | Pending, Approved, Rejected, Cancelled |

### 21.4 LEAVE data

| Nhóm | Dữ liệu tối thiểu |
| --- | --- |
| Leave types | Annual leave, Sick leave, Unpaid leave |
| Policies | Company policy, department policy, employee override |
| Balances | Đủ phép, gần hết phép, hết phép |
| Requests | Draft, Pending, Approved, Rejected, Cancelled, Revoked |
| Leave periods | Full-day, half-day, hourly, multiple days |

### 21.5 TASK data

| Nhóm | Dữ liệu tối thiểu |
| --- | --- |
| Projects | Public/internal project, private project, archived project |
| Members | Owner, Manager, Member, Viewer |
| Tasks | Todo, In Progress, In Review, Done, Cancelled |
| Deadlines | Due today, due soon, overdue |
| Comments | Comment thường, comment mention |
| Checklist | Completed/incomplete items |

### 21.6 NOTI/DASH data

| Nhóm | Dữ liệu tối thiểu |
| --- | --- |
| Notifications | Read/unread, archived, target deleted, target forbidden |
| Events | Enabled/disabled event |
| Templates | Global template, company override, invalid template |
| Dashboard widgets | Active/inactive widget, role/user/company config |
| Cache | Valid cache, expired cache, stale cache |

---

## 22. Điều kiện vào/ra của QA-02

### 22.1 Entry criteria

QA-02 có thể bắt đầu thực thi khi:

1. API contract các module P0 đã được chốt.
2. Permission seed cơ bản đã có.
3. Test environment có database và seed data tối thiểu.
4. Frontend có route/layout chính hoặc có API test thay thế.
5. Backend có logging request_id để trace lỗi.
6. QA có tài khoản test theo role/scope.

### 22.2 Exit criteria

QA-02 được xem là đạt cho MVP release khi:

1. 100% test P0 đã chạy và pass hoặc có quyết định waiver được duyệt.
2. >= 95% test P1 pass.
3. Không còn defect severity Critical/Blocker.
4. Defect severity High có workaround hoặc được Product/Tech Lead chấp nhận.
5. Smoke regression pass trên staging.
6. Security P0 pass.
7. Cross-module P0 pass.
8. Dashboard/Notification không có lỗi rò dữ liệu hoặc sai scope.
9. Có báo cáo test execution và defect summary.

---

## 23. Checklist bàn giao cho các tài liệu QA tiếp theo

| Tài liệu tiếp theo | Nội dung cần triển khai tiếp |
| --- | --- |
| QA-03 End-to-End Flow Testing | Ghép test case theo module thành flow nghiệp vụ xuyên module |
| QA-04 API Testing & Contract Testing | Chi tiết test API contract/response/error/validation theo module |
| QA-05 Permission, Role & Data Scope Testing | Ma trận RBAC, data scope, field/route/menu/action guard |
| QA-06 Security Testing | OWASP, IDOR/BOLA, multi-tenant isolation, file/security |
| QA-07 Performance & Load Testing | Load/stress/soak, SLA/SLO, query/dashboard/notification |
| QA-08 Bug Tracking, Regression & Release Criteria | Quy trình bug, regression suite, release gate |
| QA-09 UAT Plan & Business Acceptance | Nghiệm thu nghiệp vụ với stakeholder |
| QA-10 MVP Release Readiness Checklist | Release readiness checklist tổng hợp trước go-live |

---

## 24. Kết luận

QA-02 chuyển phạm vi MVP thành ma trận test case có thể quản lý theo module và theo rủi ro.

Trọng tâm test của MVP là:

1. **AUTH/RBAC/data scope** vì đây là nền tảng bảo mật cho toàn hệ thống.
2. **HR** vì là nguồn dữ liệu nhân sự trung tâm cho các module khác.
3. **ATT + LEAVE** vì có nghiệp vụ thời gian, số dư phép, đồng bộ và nhiều rủi ro business rule.
4. **TASK + NOTI + DASH** vì có nhiều luồng liên module, deep link, cache và permission theo dữ liệu.
5. **FOUNDATION** vì file, audit, settings, sequence và multi-tenant ảnh hưởng toàn hệ thống.
6. **Cross-module regression** vì phần lớn lỗi MVP có khả năng xuất hiện ở ranh giới giữa các module.

Tài liệu này nên được cập nhật sau mỗi lần thay đổi lớn ở API, UI flow, permission matrix, dashboard widget hoặc business rule.

---

## 25. Tài liệu liên quan

| Mã | Tài liệu | Quan hệ |
| --- | --- | --- |
| [QA-01](QA-01_QA_Strategy_And_Test_Plan.md) | QA Strategy & Test Plan | Tài liệu nền: chiến lược, phạm vi, tiêu chí |
| **QA-02 (tài liệu này)** | Test Case Matrix theo module | Ma trận test case theo module/role/scope |
| [QA-03](QA-03_End-to-End_Flow_Testing.md) | End-to-End Flow Testing | Ghép test case thành flow xuyên module |
| [QA-04](QA-04_API_Testing_Contract_Testing.md) | API Testing & Contract Testing | Kiểm thử API contract/response/error |
| [QA-05](QA-05_Permission_Role_Data_Scope_Testing.md) | Permission, Role & Data Scope Testing | RBAC, data scope, field/route guard |
| [QA-06](QA-06_Security_Testing.md) | Security Testing | Bảo mật, OWASP, multi-tenant isolation |
| [QA-07](QA-07_Performance_Load_Testing.md) | Performance & Load Testing | Hiệu năng, tải, SLA/SLO |
| [QA-08](QA-08_Bug_Tracking_Regression_Release_Criteria.md) | Bug Tracking, Regression & Release Criteria | **Chuẩn severity (S0–S4)**, bug lifecycle, release gate |
| [QA-09](QA-09_UAT_Plan_Business_Acceptance.md) | UAT Plan & Business Acceptance | Nghiệm thu nghiệp vụ với stakeholder |
| [QA-10](QA-10_MVP_Release_Readiness_Checklist.md) | MVP Release Readiness Checklist | Checklist release gate cuối |
