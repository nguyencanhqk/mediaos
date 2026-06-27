# UI-09: MODULE UI DESIGN
# THIẾT KẾ CHI TIẾT MÀN HÌNH NGHIỆP VỤ THEO MODULE

> **📚 Bộ tài liệu UI — Hệ thống Quản lý Doanh nghiệp**
> [UI-01 Tổng quan](<UI-01_UIUX_Design_Tong_Quan.md>) · [UI-02 IA/Sitemap](<UI-02_Information_Architecture_Sitemap.md>) · [UI-03 User Flow](<UI-03_User_Flow_MVP.md>) · [UI-04 Screen List](<UI-04_Screen_List_Wireframe_Plan.md>) · [UI-05 Design System](<UI-05_Design_System_Component_Library.md>) · [UI-06 Home/App Switcher](<UI-06_Home_Portal_App_Switcher_UI_Design.md>) · [UI-07 Module Workspace](<UI-07_Module_Workspace_Template_Design.md>) · [UI-08 Dashboard](<UI-08_Dashboard_UIUX_Design.md>) · **UI-09 Module UI** · [UI-10 Prototype/Handoff](<UI-10_Prototype_Frontend_Handoff_Guide.md>)
>
> **Liên quan:** [Đặc tả nghiệp vụ: SPEC-01 Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) · [Chuẩn API: API-01 Tổng quan](<../API Design/API-01 TỔNG QUAN.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | UI-09 |
| Tên tài liệu | Module UI Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-08 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Người viết |  |
| Người duyệt |  |

### Lịch sử thay đổi (Changelog)

| Phiên bản | Ngày | Thay đổi | Người thực hiện |
| --- | --- | --- | --- |
| v1.0 | 20/06/2026 | Khởi tạo tài liệu cho giai đoạn MVP v1.0. | |

---

## 2. Mục đích tài liệu

Tài liệu UI-09 mô tả chi tiết thiết kế UI/UX cho các màn hình nghiệp vụ chính của hệ thống quản lý doanh nghiệp nội bộ.

UI-09 là bước tiếp nối sau:

| Tài liệu | Vai trò |
| --- | --- |
| UI-01 | Chốt định hướng tổng quan: Home Portal -> Module Workspace -> App Switcher |
| UI-02 | Chốt sitemap, route, sidebar, topbar, quyền hiển thị menu |
| UI-03 | Chốt user flow MVP |
| UI-04 | Chốt danh sách màn hình MVP và ưu tiên wireframe |
| UI-05 | Chốt Design System và Component Library |
| UI-06 | Chốt Home Portal và App Switcher |
| UI-07 | Chốt Module Workspace Template |
| UI-08 | Chốt Dashboard UI/UX |

UI-09 không thiết kế lại layout nền tảng. Tài liệu này đi vào chi tiết từng màn hình nghiệp vụ của các module MVP:

1. AUTH / ACCOUNT / SYSTEM.
2. HR - Nhân sự.
3. ATT - Chấm công.
4. LEAVE - Nghỉ phép.
5. TASK - Công việc & Dự án.
6. NOTI - Thông báo.
7. FOUNDATION/SYSTEM - Cấu hình, file, audit, module catalog.

Mục tiêu là giúp UI/UX Designer, Frontend, Backend và QA có cùng một bản mô tả rõ ràng về:

1. Mỗi màn hình cần hiển thị gì.
2. Màn hình dùng template nào.
3. Dữ liệu lấy từ API nào.
4. Action nào được phép xuất hiện.
5. State nào bắt buộc phải có.
6. Permission/data scope ảnh hưởng UI ra sao.
7. Màn nào cần ưu tiên thiết kế high-fidelity trước.
8. Checklist nghiệm thu từng module.

---

## 3. Căn cứ thiết kế

UI-09 bám theo các quyết định đã chốt:

1. Sau đăng nhập, người dùng vào **Home Portal** trước.
2. Từ Home Portal, người dùng chọn module để vào **Module Workspace**.
3. Trong mọi màn protected, người dùng có thể mở **App Switcher** để đổi module.
4. Mọi màn nghiệp vụ dùng **ModuleWorkspaceLayout**: topbar chung, sidebar module, content shell.
5. Frontend có thể ẩn/hiện app, menu, button, field để cải thiện UX; backend vẫn là lớp kiểm tra quyền cuối cùng.
6. Mọi dữ liệu danh sách, badge, counter, widget và action phải tuân thủ permission + data scope.
7. Dashboard, Home Portal và App Switcher chỉ tổng hợp/điều hướng; action nghiệp vụ phải gọi API module gốc.
8. Notification deep link phải điều hướng về module gốc và module gốc kiểm tra quyền/business rule lại.
9. Thiết kế phải dùng lại Design System UI-05: DataTable, Form, Drawer, Modal, StatusBadge, PermissionGate, EmptyState, ErrorState, Skeleton, Timeline, ActivityLog, ApprovalBox, CommentThread, Checklist.
10. Các màn P0 cần có responsive annotation cho desktop, tablet và mobile web.

---

## 4. Phạm vi UI-09

### 4.1 Bao gồm trong MVP

| Module | Nhóm màn hình |
| --- | --- |
| AUTH/ACCOUNT | Login, quên mật khẩu, reset mật khẩu, hồ sơ tài khoản, đổi mật khẩu, phiên đăng nhập |
| SYSTEM/AUTH Admin | User, role, permission, role-permission matrix, login log, security event |
| HR | Employee list/detail/form, My Profile, profile change request, department, position, job level, contract, employee code config, org chart |
| ATT | Today attendance, check-in/out, attendance records, adjustment request, remote work, shift, assignment, rule, report |
| LEAVE | My balance, my request, create leave, detail, approval, calendar, leave type, policy, balance, report |
| TASK | Project, project detail, member, my task, task list, task detail, Kanban, comment, checklist, file, report |
| NOTI | Notification dropdown, list, detail, event, template, delivery log, notification settings |
| FOUNDATION | Company settings, module catalog, file metadata, audit log, system settings |

### 4.2 Không bao gồm sâu trong MVP

| Nội dung | Giai đoạn đề xuất |
| --- | --- |
| Payroll UI chi tiết | Phase 2 |
| Recruitment UI chi tiết | Phase 2 |
| Asset/Room UI chi tiết | Phase 3 |
| Chat/Social UI chi tiết | Phase 4 |
| Mobile native app UI | Phase mobile riêng |
| BI dashboard nâng cao | Phase reporting riêng |
| AI assistant/automation UI | Phase 5 |

---

## 5. Nguyên tắc UI chung cho màn nghiệp vụ

### 5.1 Quy tắc ưu tiên template

| Loại màn hình | Template dùng |
| --- | --- |
| Tổng quan module | Overview Template |
| Danh sách dữ liệu lớn | List/Table Template |
| Chi tiết entity | Detail Template |
| Tạo/cập nhật dữ liệu | Form Template |
| Duyệt/từ chối yêu cầu | Approval Template |
| Bảng Kanban | Kanban Template |
| Lịch nghỉ/lịch làm việc | Calendar Template |
| Báo cáo đơn giản | Report Template |
| Thiết lập/cấu hình | Settings Template |
| Nhật ký/audit/activity | Audit/Activity Template |

### 5.2 Quy tắc action

| Loại action | Cách hiển thị |
| --- | --- |
| Primary action | Đặt ở PageHeader bên phải, chỉ hiện khi có quyền |
| Secondary action | Đặt cạnh primary hoặc trong More menu |
| Row action | View/Edit/Delete/Approve đặt trong row menu |
| Bulk action | Chỉ hiện khi chọn ít nhất một dòng |
| Dangerous action | Phải có ConfirmDialog, mô tả hậu quả rõ |
| Disabled by business rule | Disable + tooltip lý do |
| Missing permission | Ẩn action |
| API processing | Loading state tại button/action, chống double submit |

### 5.3 Quy tắc detail page

Detail page dùng khi entity có nhiều dữ liệu hoặc workflow phức tạp.

Cấu trúc chung:

```text
Breadcrumb
PageHeader: Tên entity + status + actions
Summary card
Tabs:
- Tổng quan
- Thông tin chi tiết
- File / Đính kèm
- Lịch sử / Activity
- Audit nếu có quyền
```

### 5.4 Quy tắc drawer

Drawer dùng cho quick view hoặc action nhẹ:

| Dùng drawer khi | Không dùng drawer khi |
| --- | --- |
| Xem nhanh thông tin một dòng trong table | Form quá dài |
| Duyệt/từ chối nhanh có ít field | Entity có nhiều tab |
| Preview task/notification/leave request | Cần upload nhiều file hoặc cấu hình phức tạp |
| Xem activity ngắn | Có nhiều quan hệ dữ liệu cần chỉnh sửa |

### 5.5 Quy tắc form

Form phải có:

1. Label rõ ràng.
2. Required indicator.
3. Helper text nếu field khó hiểu.
4. Validation inline.
5. Error summary nếu submit lỗi nhiều field.
6. Dirty form guard khi rời màn hình.
7. Nút `Lưu`, `Hủy`, `Lưu nháp` nếu workflow hỗ trợ.
8. Disable submit khi đang loading.
9. Chỉ hiển thị field người dùng có quyền xem/sửa.
10. Field nhạy cảm dùng MaskedField nếu thiếu field-level permission.

### 5.6 Quy tắc table

Table phải có:

1. Search.
2. Filter chính.
3. Sort các cột quan trọng.
4. Pagination.
5. Column priority cho responsive.
6. Empty state theo ngữ cảnh.
7. Row action theo quyền.
8. Bulk action nếu nghiệp vụ cần.
9. Loading skeleton.
10. Error state có retry.
11. Không hiển thị dữ liệu ngoài scope.

### 5.7 Quy tắc state bắt buộc

| State | Yêu cầu UI |
| --- | --- |
| Loading | Skeleton đúng layout, không dùng spinner trống cho table lớn |
| Empty | Có message rõ + CTA phù hợp nếu có quyền tạo |
| Error | ErrorState + retry + request id nếu có |
| Forbidden | Không lộ dữ liệu, giải thích thiếu quyền |
| Disabled module | Module chưa bật hoặc đang bảo trì |
| Validation | Hiển thị lỗi tại field + error summary |
| Success | Toast + cập nhật dữ liệu hoặc điều hướng hợp lý |
| Stale data | Hiển thị thời điểm cập nhật cuối nếu dữ liệu cache |
| No data due to scope | Empty state nói rõ “không có dữ liệu trong phạm vi của bạn” |

---

## 6. Quy chuẩn mã màn hình UI-09

> **Canonical:** UI-09 là nguồn chuẩn cho screen code, route và taxonomy prefix của các màn nghiệp vụ. [UI-04 Screen List](<UI-04_Screen_List_Wireframe_Plan.md>) đã được đồng bộ theo bảng này; route triển khai chốt ở FRONTEND-03.

### 6.1 Format screen code

```text
UI-{MODULE}-SCREEN-{NUMBER}
```

Ví dụ:

```text
UI-HR-SCREEN-001
UI-ATT-SCREEN-001
UI-LEAVE-SCREEN-003
UI-TASK-SCREEN-004
UI-NOTI-SCREEN-001
UI-SYSTEM-SCREEN-001
```

### 6.2 Format route key

```text
{module}.{resource}.{screen/action}
```

Ví dụ:

```text
hr.employee.list
attendance.today.view
leave.request.create
task.task.detail
notification.my.list
system.user.list
```

### 6.3 Cấu trúc mô tả screen

Mỗi screen trong UI-09 nên có các trường:

| Trường | Mô tả |
| --- | --- |
| Screen code | Mã màn hình |
| Route | Đường dẫn frontend |
| Actor | User chính |
| Priority | P0/P1/P2 |
| Template | Template UI dùng |
| Permission | Permission cần có |
| Data scope | Own/Team/Department/Project/Company/System |
| API mapping | API chính |
| Component | Component chính |
| State | State bắt buộc |
| Responsive note | Ghi chú responsive |
| QA focus | Điểm cần test |

---

## 7. AUTH / ACCOUNT / SYSTEM UI DESIGN

### 7.1 Mục tiêu UX

Module AUTH/SYSTEM cần giúp Admin quản lý tài khoản, vai trò, quyền, phiên đăng nhập và bảo mật. Với user thường, nhóm Account giúp xem hồ sơ tài khoản, đổi mật khẩu và quản lý phiên cá nhân.

Nguyên tắc UX:

1. Màn đăng nhập phải đơn giản, rõ lỗi nhưng không tiết lộ thông tin nhạy cảm.
2. Màn user/role/permission phải ưu tiên quản trị an toàn, tránh cấp quyền sai.
3. Action nguy hiểm như khóa user, reset mật khẩu, đổi role phải có confirm.
4. Permission matrix phải có tìm kiếm, nhóm theo module, diff thay đổi trước khi lưu.
5. Audit/login log chỉ hiển thị theo quyền, có filter thời gian và actor.

### 7.2 Screen list AUTH/ACCOUNT/SYSTEM

| Screen code | Tên màn hình | Route | Actor | Priority | Template |
| --- | --- | --- | --- | --- | --- |
| UI-AUTH-SCREEN-001 | Đăng nhập | `/login` | Public | P0 | Auth Form |
| UI-AUTH-SCREEN-002 | Quên mật khẩu | `/forgot-password` | Public | P1 | Auth Form |
| UI-AUTH-SCREEN-003 | Đặt lại mật khẩu | `/reset-password` | Public token | P1 | Auth Form |
| UI-ACCOUNT-SCREEN-001 | Hồ sơ tài khoản | `/account/profile` | Authenticated | P1 | Detail/Form |
| UI-ACCOUNT-SCREEN-002 | Đổi mật khẩu | `/account/change-password` | Authenticated | P1 | Form |
| UI-ACCOUNT-SCREEN-003 | Phiên đăng nhập của tôi | `/account/sessions` | Authenticated | P2 | List/Table |
| UI-SYSTEM-SCREEN-001 | Danh sách user | `/system/users` | Admin/HR nếu được cấp | P0 | List/Table |
| UI-SYSTEM-SCREEN-002 | Chi tiết user | `/system/users/:id` | Admin | P1 | Detail |
| UI-SYSTEM-SCREEN-003 | Tạo/Sửa user | `/system/users/new`, `/system/users/:id/edit` | Admin | P1 | Form |
| UI-SYSTEM-SCREEN-004 | Danh sách role | `/system/roles` | Admin | P0 | List/Table |
| UI-SYSTEM-SCREEN-005 | Chi tiết/Sửa role | `/system/roles/:id` | Admin | P1 | Detail/Settings |
| UI-SYSTEM-SCREEN-006 | Permission matrix | `/system/roles/:id/permissions` | Admin | P0 | Settings/Table Matrix |
| UI-SYSTEM-SCREEN-007 | Gán role cho user | `/system/users/:id/roles` | Admin | P1 | Form/Matrix |
| UI-SYSTEM-SCREEN-008 | Nhật ký đăng nhập | `/system/login-logs` | Admin/Security | P2 | Audit/Table |
| UI-SYSTEM-SCREEN-009 | Sự kiện bảo mật | `/system/security-events` | Admin/Security | P2 | Audit/Table |

### 7.2b Bàn giao FE — Screen ↔ API · Component · Responsive · State

> Endpoint rút gọn (path đầy đủ ở §17.1); component theo thư viện UI-05 + §16; state nền tảng ở §5.7.

| Screen code | API chính | Component chính | Responsive | State bắt buộc |
| --- | --- | --- | --- | --- |
| UI-AUTH-SCREEN-001 | `POST /auth/login` | AuthForm, Input, Button | Auth full-screen | default, loading, error, locked |
| UI-AUTH-SCREEN-002 | Forgot-password API | AuthForm | Auth full-screen | default, success, error |
| UI-AUTH-SCREEN-003 | Reset-password API | AuthForm | Auth full-screen | invalid-token, success |
| UI-ACCOUNT-SCREEN-001 | `GET /auth/me` | DetailSection, Form | Stack mobile | loading, read-only/edit |
| UI-ACCOUNT-SCREEN-002 | Change-password API | Form (UI-05) | Stack mobile | validation, success, error |
| UI-ACCOUNT-SCREEN-003 | Sessions API | DataTable, RevokeButton | Stack mobile | loading, empty |
| UI-SYSTEM-SCREEN-001 | `GET /auth/users` | DataTable, FilterBar, StatusBadge | Desktop | loading, empty, forbidden |
| UI-SYSTEM-SCREEN-002 | `GET /auth/users/{id}`, `POST .../lock·unlock` | DetailSection, Tabs | Desktop | loading, error |
| UI-SYSTEM-SCREEN-003 | `POST·PATCH /auth/users` | Form (UI-05) | Desktop | validation, success |
| UI-SYSTEM-SCREEN-004 | `GET /auth/roles` | DataTable | Desktop | loading, empty |
| UI-SYSTEM-SCREEN-005 | `GET·POST /auth/roles` | DetailSection, SettingsForm | Desktop | loading, validation |
| UI-SYSTEM-SCREEN-006 | `GET /auth/permissions`, `PUT /auth/roles/{id}/permissions` | PermissionMatrixTable, ModuleTabs, DiffConfirmModal | Desktop (mobile khuyến nghị tránh) | loading skeleton, dirty, save-diff, conflict |
| UI-SYSTEM-SCREEN-007 | `PUT .../users/{id}/roles` | AssignMatrix, ConfirmDialog | Desktop | loading, validation |
| UI-SYSTEM-SCREEN-008 | Login-logs API | AuditTable | Desktop | loading, empty |
| UI-SYSTEM-SCREEN-009 | Security-events API | AuditTable, AuditDetailDrawer | Desktop | loading, empty |

### 7.3 Screen UI-AUTH-SCREEN-001: Đăng nhập

| Thuộc tính | Nội dung |
| --- | --- |
| Route | `/login` |
| Layout | AuthLayout |
| API | `POST /api/v1/auth/login` |
| Component | AuthCard, EmailInput, PasswordInput, Button, Alert |
| State | Idle, loading, invalid credentials, locked account, server error |
| Redirect | Thành công -> `/home` |

Wireframe:

```text
+------------------------------------------------------+
| Logo / Product name                                  |
| Đăng nhập vào hệ thống                               |
| Email                                                |
| Password                                  [Hiện/ẩn]  |
| [ ] Ghi nhớ đăng nhập                                |
| [Đăng nhập]                                          |
| Quên mật khẩu?                                       |
+------------------------------------------------------+
```

UX rule:

1. Không nói rõ email tồn tại hay không.
2. Nếu tài khoản bị khóa, hiển thị thông báo chung và hướng liên hệ Admin/HR.
3. Submit bằng Enter.
4. Password có nút hiện/ẩn.
5. Loading không cho submit lần hai.
6. Nếu user đã login và token hợp lệ, redirect `/home`.

### 7.4 Screen UI-SYSTEM-SCREEN-001: Danh sách user

| Thuộc tính | Nội dung |
| --- | --- |
| Route | `/system/users` |
| Permission | `AUTH.USER.VIEW` |
| Data scope | Company/System |
| API | `GET /api/v1/auth/users` |
| Template | List/Table |
| Primary action | `+ Tạo user` nếu có `AUTH.USER.CREATE` |

Column đề xuất:

| Cột | Nội dung |
| --- | --- |
| User | Avatar, name, email |
| Employee | Mã nhân viên, phòng ban nếu đã link |
| Role | Role badges |
| Trạng thái | Active/Locked/Inactive |
| Lần đăng nhập cuối | Relative time |
| MFA/SSO | Optional phase sau |
| Action | Xem, sửa, khóa/mở, reset password |

Filter:

1. Keyword.
2. Role.
3. Status.
4. Department.
5. Linked/unlinked employee.
6. Last login range.

State đặc biệt:

| State | UI |
| --- | --- |
| Chưa có user | Empty + CTA tạo user đầu tiên |
| User thiếu employee link | Badge `Chưa liên kết nhân viên` |
| User bị khóa | Row dim nhẹ + status badge |
| Không có quyền tạo | Ẩn CTA tạo |

### 7.5 Screen UI-SYSTEM-SCREEN-006: Permission matrix

Mục tiêu: Admin cấu hình quyền cho role theo module và data scope.

Wireframe:

```text
Role: HR Manager                                      [Lưu thay đổi]
Search permission...
Tabs: AUTH | HR | ATT | LEAVE | TASK | DASH | NOTI | SYSTEM

+--------------------------+-------+-------+------------+---------+
| Permission               | Own   | Team  | Department | Company |
+--------------------------+-------+-------+------------+---------+
| HR.EMPLOYEE.VIEW         | [ ]   | [x]   | [x]        | [x]     |
| HR.EMPLOYEE.UPDATE       | [ ]   | [ ]   | [ ]        | [x]     |
| LEAVE.REQUEST.APPROVE    | [ ]   | [x]   | [ ]        | [x]     |
+--------------------------+-------+-------+------------+---------+
```

UX rule:

1. Group permission theo module/resource.
2. Có search theo permission code và tên tiếng Việt.
3. Thay đổi chưa lưu phải có dirty indicator.
4. Click save mở modal review diff:
   - Quyền được thêm.
   - Quyền bị gỡ.
   - Scope thay đổi.
5. Không cho tự gỡ quyền cuối cùng của Super Admin nếu gây mất quyền quản trị.
6. Permission nguy hiểm cần badge warning, ví dụ `AUTH.ROLE.UPDATE`, `SYSTEM.SETTING.UPDATE`.

---

## 8. HR MODULE UI DESIGN

### 8.1 Mục tiêu UX

HR Workspace là nơi quản lý dữ liệu nhân sự trung tâm. UI cần tối ưu cho:

1. HR xem, lọc, tạo và cập nhật hồ sơ nhân viên.
2. Employee xem hồ sơ cá nhân và gửi yêu cầu cập nhật thông tin.
3. HR/Admin duyệt hoặc từ chối yêu cầu cập nhật hồ sơ.
4. Quản lý phòng ban, chức vụ, cấp bậc, loại hợp đồng.
5. Kiểm soát mã nhân viên tự sinh.
6. Truy vết lịch sử thay đổi dữ liệu nhân sự.

Nguyên tắc HR UI:

1. Dữ liệu nhạy cảm phải có MaskedField nếu thiếu quyền.
2. Employee không cập nhật trực tiếp hồ sơ chính; tạo profile change request.
3. Màn employee detail nên chia tab rõ để tránh form quá dài.
4. HR list phải có filter mạnh: phòng ban, trạng thái, chức vụ, hợp đồng.
5. Tất cả thao tác đổi trạng thái nhân viên phải có confirm + audit.

### 8.2 HR sidebar đề xuất

```text
Tổng quan
- Tổng quan nhân sự

Nhân viên
- Danh sách nhân viên
- Hồ sơ của tôi
- Yêu cầu cập nhật hồ sơ
- Sơ đồ tổ chức

Hợp đồng & danh mục
- Hợp đồng
- Phòng ban
- Chức vụ
- Cấp bậc
- Loại hợp đồng

Thiết lập
- Cấu hình mã nhân viên
- Audit HR
```

### 8.3 Screen list HR

| Screen code | Tên màn hình | Route | Actor | Priority | Template |
| --- | --- | --- | --- | --- | --- |
| UI-HR-SCREEN-001 | HR Overview | `/hr` | HR/Manager/Admin | P1 | Overview |
| UI-HR-SCREEN-002 | Danh sách nhân viên | `/hr/employees` | HR/Manager | P0 | List/Table |
| UI-HR-SCREEN-003 | Tạo nhân viên | `/hr/employees/new` | HR/Admin | P0 | Form |
| UI-HR-SCREEN-004 | Chi tiết nhân viên | `/hr/employees/:id` | HR/Manager/Employee scope | P0 | Detail |
| UI-HR-SCREEN-005 | Sửa hồ sơ nhân viên | `/hr/employees/:id/edit` | HR/Admin | P1 | Form |
| UI-HR-SCREEN-006 | Hồ sơ của tôi | `/hr/me` | Employee | P0 | Detail |
| UI-HR-SCREEN-007 | Gửi yêu cầu sửa hồ sơ | `/hr/me/change-request` | Employee | P0 | Form |
| UI-HR-SCREEN-008 | Danh sách yêu cầu cập nhật hồ sơ | `/hr/profile-change-requests` | HR/Admin | P1 | List/Table |
| UI-HR-SCREEN-009 | Chi tiết/duyệt yêu cầu cập nhật | `/hr/profile-change-requests/:id` | HR/Admin/Owner | P1 | Approval |
| UI-HR-SCREEN-010 | Phòng ban | `/hr/departments` | HR/Admin | P1 | Tree/List |
| UI-HR-SCREEN-011 | Chức vụ | `/hr/positions` | HR/Admin | P2 | List/Form |
| UI-HR-SCREEN-012 | Cấp bậc | `/hr/job-levels` | HR/Admin | P2 | List/Form |
| UI-HR-SCREEN-013 | Loại hợp đồng | `/hr/contract-types` | HR/Admin | P2 | List/Form |
| UI-HR-SCREEN-014 | Hợp đồng nhân viên | `/hr/contracts` | HR/Admin | P1 | List/Table |
| UI-HR-SCREEN-015 | Cấu hình mã nhân viên | `/hr/settings/employee-code` | HR/Admin | P1 | Settings |
| UI-HR-SCREEN-016 | Sơ đồ tổ chức | `/hr/org-chart` | HR/Manager | P2 | Tree/Chart |
| UI-HR-SCREEN-017 | HR Audit Logs | `/hr/audit-logs` | HR/Admin | P2 | Audit/Table |

### 8.3b Bàn giao FE — Screen ↔ API · Component · Responsive · State

> Endpoint rút gọn (path đầy đủ ở §17.2); component theo thư viện UI-05 + §16; state nền tảng ở §5.7.

| Screen code | API chính | Component chính | Responsive | State bắt buộc |
| --- | --- | --- | --- | --- |
| UI-HR-SCREEN-001 | `GET /hr/employees` (tổng hợp) | StatCard, Charts | Stack mobile | loading, empty, error |
| UI-HR-SCREEN-002 | `GET /hr/employees` | DataTable, EmployeeAvatarCell, StatusBadge, FilterBar | Table → card | loading, empty, scope-empty |
| UI-HR-SCREEN-003 | `POST /hr/employees` | Form (UI-05) | Form full-screen | validation, success, error |
| UI-HR-SCREEN-004 | `GET /hr/employees/{id}` | EmployeeProfileHeader, DetailSection, Tabs, Timeline, FileList, MaskedField | Tabs → accordion mobile | loading, forbidden tab, masked-field |
| UI-HR-SCREEN-005 | `PATCH /hr/employees/{id}` | Form (UI-05) | Form full-screen | validation, success |
| UI-HR-SCREEN-006 | `GET /hr/me` | EmployeeProfileHeader, DetailSection, MaskedField | Accordion mobile | loading, read-only, request-pending |
| UI-HR-SCREEN-007 | `POST /hr/me/profile-change-requests` | Form (UI-05), DiffTable | Form full-screen | validation, pending-warning, success |
| UI-HR-SCREEN-008 | `GET /hr/profile-change-requests` | DataTable, StatusBadge | Table → card | loading, empty |
| UI-HR-SCREEN-009 | `POST .../profile-change-requests/{id}/approve·reject` | ApprovalBox, DiffTable, ConfirmDialog | Stacked | pending, approve/reject, diff |
| UI-HR-SCREEN-010 | `GET /hr/departments` | TreeView, DataTable | Tree → list mobile | loading, empty |
| UI-HR-SCREEN-011 | `GET /hr/positions` | DataTable, Form | Desktop | loading, empty |
| UI-HR-SCREEN-012 | Job-levels API | DataTable, Form | Desktop | loading, empty |
| UI-HR-SCREEN-013 | Contract-types API | DataTable, Form | Desktop | loading, empty |
| UI-HR-SCREEN-014 | `GET /hr/contracts` | DataTable, StatusBadge | Table → card | loading, empty |
| UI-HR-SCREEN-015 | `GET·PATCH /hr/settings/employee-code` | SettingsForm | Desktop | loading, validation, success |
| UI-HR-SCREEN-016 | Org-chart API | OrgChart/Tree | Desktop | loading, empty |
| UI-HR-SCREEN-017 | HR audit API | AuditTable, AuditDetailDrawer | Desktop | loading, empty |

### 8.4 Screen UI-HR-SCREEN-002: Danh sách nhân viên

| Thuộc tính | Nội dung |
| --- | --- |
| Permission | `HR.EMPLOYEE.VIEW` |
| Data scope | Team/Department/Company/System |
| API | `GET /api/v1/hr/employees` |
| Component | DataTable, EmployeeAvatarCell, StatusBadge, FilterBar |
| Primary action | `+ Thêm nhân viên` nếu có `HR.EMPLOYEE.CREATE` |

Wireframe:

```text
Nhân sự / Danh sách nhân viên                         [+ Thêm nhân viên]
Tìm kiếm tên, mã, email | Phòng ban | Trạng thái | Chức vụ | More filters

[ ]  Nhân viên              Phòng ban       Chức vụ       Trạng thái     Action
[ ]  EMP0001 Nguyễn Văn A   Kỹ thuật        Developer     Chính thức     ...
[ ]  EMP0002 Trần Thị B     Nhân sự         HR Executive  Thử việc       ...
```

Column priority:

| Cột | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Avatar + tên + mã | Hiện | Hiện | Card title |
| Email/phone | Hiện nếu có quyền | Ẩn bớt | Trong card detail |
| Phòng ban | Hiện | Hiện | Text phụ |
| Chức vụ | Hiện | Optional | Text phụ |
| Trạng thái | Hiện | Hiện | Badge |
| Hợp đồng | Optional | Ẩn | Ẩn |
| Action | Row menu | Row menu | More button |

Empty state:

```text
Chưa có nhân viên nào trong phạm vi của bạn.
```

Nếu có quyền tạo:

```text
CTA: Thêm nhân viên đầu tiên
```

### 8.5 Screen UI-HR-SCREEN-004: Chi tiết nhân viên

Cấu trúc:

```text
EmployeeProfileHeader
- Avatar
- Họ tên
- Mã nhân viên
- Phòng ban / Chức vụ
- Trạng thái
- Direct manager
- Actions: Sửa, Đổi trạng thái, Tạo hợp đồng, Liên kết user

Tabs:
- Tổng quan
- Thông tin cá nhân
- Công việc
- Hợp đồng
- File hồ sơ
- Lịch sử thay đổi
```

Rule hiển thị:

| Khu vực | Rule |
| --- | --- |
| Thông tin cá nhân nhạy cảm | Mask nếu thiếu field-level permission |
| Nút sửa | Chỉ hiện nếu `HR.EMPLOYEE.UPDATE` |
| Đổi trạng thái | Confirm modal bắt buộc |
| File hồ sơ | Chỉ hiện file user có quyền xem |
| Audit tab | Chỉ hiện nếu `HR.AUDIT_LOG.VIEW` |

### 8.6 Screen UI-HR-SCREEN-007: Employee gửi yêu cầu sửa hồ sơ

Mục tiêu: Employee cập nhật thông tin cá nhân nhưng không ghi trực tiếp vào hồ sơ chính.

Form đề xuất:

| Nhóm | Field |
| --- | --- |
| Liên hệ | Số điện thoại, email cá nhân, địa chỉ |
| Thông tin cá nhân cho phép | Ngày sinh, tình trạng hôn nhân nếu policy cho phép |
| Thông tin khẩn cấp | Người liên hệ khẩn cấp, số điện thoại |
| File chứng minh | Upload nếu cần |
| Lý do thay đổi | Textarea |

UX rule:

1. Hiển thị dữ liệu hiện tại ở cột trái, dữ liệu mới ở cột phải nếu user chỉnh.
2. Chỉ những field được cấu hình self-service mới edit được.
3. Submit tạo request trạng thái `Pending`.
4. Nếu có request pending cùng field, cảnh báo user.
5. Sau submit, điều hướng sang detail request hoặc my profile với toast.

### 8.7 Screen UI-HR-SCREEN-009: Duyệt yêu cầu cập nhật hồ sơ

Approval layout:

```text
Yêu cầu cập nhật hồ sơ #PCR-0001                  [Duyệt] [Từ chối]
Người gửi: Nguyễn Văn A
Ngày gửi: 20/06/2026
Trạng thái: Pending

+----------------------+----------------------+----------------------+
| Field                | Dữ liệu hiện tại     | Dữ liệu đề xuất      |
+----------------------+----------------------+----------------------+
| Số điện thoại         | 090...123            | 091...888            |
| Địa chỉ              | Cũ                   | Mới                  |
+----------------------+----------------------+----------------------+

File đính kèm
Lịch sử xử lý
```

Rule:

1. Dữ liệu nhạy cảm chỉ hiển thị cho HR/Admin có quyền.
2. Duyệt phải có confirm nếu thay đổi field quan trọng.
3. Từ chối bắt buộc nhập lý do.
4. Sau approve, dữ liệu mới mới được áp vào hồ sơ chính.
5. Employee nhận notification kết quả.

---

## 9. ATT MODULE UI DESIGN

### 9.1 Mục tiêu UX

ATT Workspace phục vụ hai nhóm nhu cầu:

1. Employee thao tác hằng ngày: xem trạng thái, check-in, check-out, tạo yêu cầu điều chỉnh công, request remote/công tác.
2. Manager/HR/Admin quản lý: xem bảng công, duyệt điều chỉnh công, cấu hình ca/rule, xử lý bất thường.

Nguyên tắc ATT UI:

1. Màn Today Attendance phải cực kỳ rõ: user có thể làm gì tiếp theo.
2. Check-in/check-out phải hiển thị allowed action do backend trả.
3. Nếu có đơn nghỉ Approved full-day, disable check-in/out và giải thích rõ.
4. Bảng công phải hỗ trợ xem theo tháng, theo team, theo công ty.
5. Điều chỉnh công phải có before/after diff và approval history.
6. Cấu hình ca/rule cần có preview tác động trước khi lưu.

### 9.2 ATT sidebar đề xuất

```text
Tổng quan
- Tổng quan chấm công
- Chấm công hôm nay

Bảng công
- Bảng công của tôi
- Bảng công team
- Bảng công công ty

Yêu cầu
- Điều chỉnh công
- Remote/Công tác

Cấu hình
- Ca làm việc
- Gán ca
- Rule chấm công

Báo cáo
- Báo cáo chấm công
- Audit chấm công
```

### 9.3 Screen list ATT

| Screen code | Tên màn hình | Route | Actor | Priority | Template |
| --- | --- | --- | --- | --- | --- |
| UI-ATT-SCREEN-001 | Chấm công hôm nay | `/attendance/today` | Employee | P0 | Status/Action |
| UI-ATT-SCREEN-002 | Bảng công của tôi | `/attendance/my-records` | Employee | P0 | List/Table |
| UI-ATT-SCREEN-003 | Bảng công team | `/attendance/team-records` | Manager | P1 | List/Table |
| UI-ATT-SCREEN-004 | Bảng công công ty | `/attendance/records` | HR/Admin | P1 | List/Table |
| UI-ATT-SCREEN-005 | Chi tiết ngày công | `/attendance/records/:id` | Employee/Manager/HR | P1 | Detail |
| UI-ATT-SCREEN-006 | Tạo yêu cầu điều chỉnh công | `/attendance/adjustment-requests/new` | Employee | P0 | Form |
| UI-ATT-SCREEN-007 | Danh sách yêu cầu điều chỉnh công | `/attendance/adjustment-requests` | Employee/Manager/HR | P1 | List/Table |
| UI-ATT-SCREEN-008 | Chi tiết/duyệt điều chỉnh công | `/attendance/adjustment-requests/:id` | Manager/HR | P1 | Approval |
| UI-ATT-SCREEN-009 | Remote/Công tác | `/attendance/remote-work-requests` | Employee/Manager/HR | P1 | List/Table |
| UI-ATT-SCREEN-010 | Tạo remote/công tác | `/attendance/remote-work-requests/new` | Employee | P1 | Form |
| UI-ATT-SCREEN-011 | Ca làm việc | `/attendance/shifts` | HR/Admin | P1 | Settings/List |
| UI-ATT-SCREEN-012 | Gán ca | `/attendance/shift-assignments` | HR/Admin | P1 | Settings |
| UI-ATT-SCREEN-013 | Rule chấm công | `/attendance/rules` | HR/Admin | P1 | Settings |
| UI-ATT-SCREEN-014 | Báo cáo chấm công | `/attendance/reports` | HR/Manager | P2 | Report |
| UI-ATT-SCREEN-015 | Audit chấm công | `/attendance/audit-logs` | HR/Admin | P2 | Audit/Table |

### 9.3b Bàn giao FE — Screen ↔ API · Component · Responsive · State

> Endpoint rút gọn (path đầy đủ ở §17.3); component theo thư viện UI-05 + §16; state nền tảng ở §5.7.

| Screen code | API chính | Component chính | Responsive | State bắt buộc |
| --- | --- | --- | --- | --- |
| UI-ATT-SCREEN-001 | `GET /attendance/today`, `POST .../check-in·check-out` | AttendanceStatusCard, CheckInOutButton, WorkLogTimeline | Today card full-width mobile | loading, can-checkin/out, blocked-by-leave, success, error |
| UI-ATT-SCREEN-002 | `GET /attendance/my-records` | DataTable, MonthPicker, StatusBadge | Table → card theo ngày | loading, empty, error |
| UI-ATT-SCREEN-003 | `GET /attendance/team-records` | DataTable, FilterBar, MonthPicker | Table scroll; desktop ưu tiên | loading, empty, scope-empty |
| UI-ATT-SCREEN-004 | `GET /attendance/records` | DataTable, FilterBar, ExportButton | Desktop ưu tiên | loading, empty, error |
| UI-ATT-SCREEN-005 | `GET /attendance/records/{id}` | DetailSection, WorkLogTimeline | Right panel → stacked | loading, error, forbidden |
| UI-ATT-SCREEN-006 | `POST /attendance/adjustment-requests` | Form (UI-05), EvidenceFileList | Form full-screen mobile | validation, success, error |
| UI-ATT-SCREEN-007 | `GET /attendance/adjustment-requests` | DataTable, StatusBadge | Table → card | loading, empty |
| UI-ATT-SCREEN-008 | `POST .../adjustment-requests/{id}/approve·reject` | ApprovalBox, DiffTable, EvidenceFileList | Stacked mobile | pending, approved, rejected, conflict |
| UI-ATT-SCREEN-009 | `GET /attendance/remote-work-requests` | DataTable, StatusBadge | Table → card | loading, empty |
| UI-ATT-SCREEN-010 | `POST /attendance/remote-work-requests` | Form (UI-05) | Form full-screen mobile | validation, success |
| UI-ATT-SCREEN-011 | `GET /attendance/shifts` | DataTable, SettingsForm | Desktop ưu tiên | loading, empty, forbidden |
| UI-ATT-SCREEN-012 | Shift-assignments API | SettingsForm, AssignTable | Desktop | loading, validation |
| UI-ATT-SCREEN-013 | `GET /attendance/rules` | SettingsForm | Desktop | loading, validation, forbidden |
| UI-ATT-SCREEN-014 | Report API (ATT) | Report/Chart, FilterBar | Desktop | loading, empty |
| UI-ATT-SCREEN-015 | Audit API (ATT) | AuditTable, AuditDetailDrawer | Desktop | loading, empty |

### 9.4 Screen UI-ATT-SCREEN-001: Chấm công hôm nay

API chính:

```http
GET /api/v1/attendance/today
POST /api/v1/attendance/check-in
POST /api/v1/attendance/check-out
```

Wireframe:

```text
Chấm công hôm nay                                Hôm nay 20/06/2026

+--------------------------------------------------------------+
| Trạng thái: Chưa check-in / Đã check-in / Đã check-out        |
| Ca làm: 08:00 - 17:00                                        |
| Giờ hiện tại: 08:24                                          |
|                                                              |
| [Check-in] hoặc [Check-out]                                  |
|                                                              |
| Alert: Bạn đã có đơn nghỉ phép được duyệt hôm nay...          |
+--------------------------------------------------------------+

Timeline hôm nay
08:05 Check-in bằng Web
12:00 Break optional
17:10 Check-out bằng Web

Thông tin rule
- Cho phép đi muộn: 15 phút
- Yêu cầu GPS: Không
- Remote: Không
```

State theo allowed action:

| Backend trả | UI |
| --- | --- |
| `can_check_in = true` | Hiển thị nút Check-in |
| `can_check_out = true` | Hiển thị nút Check-out |
| `blocked_by_leave = true` | Disable button + alert nghỉ phép |
| `blocked_by_status = true` | Alert nhân viên không hợp lệ |
| `missing_checkout_yesterday = true` | Alert + CTA tạo điều chỉnh công |
| `remote_auto_attendance = true` | Hiển thị trạng thái tự chấm công remote |

Confirm check-in/out:

1. Modal xác nhận ngắn.
2. Hiển thị thời gian hệ thống.
3. Nếu mobile web có GPS/photo rule thì hiển thị field tương ứng.
4. Thành công cập nhật timeline ngay.
5. Lỗi business rule hiển thị Alert trong card.

### 9.5 Screen UI-ATT-SCREEN-002/003/004: Bảng công

Table column:

| Cột | Nội dung |
| --- | --- |
| Ngày | Date + thứ |
| Nhân viên | Chỉ hiện ở team/company view |
| Ca làm | Tên ca |
| Check-in | Giờ + nguồn |
| Check-out | Giờ + nguồn |
| Tổng giờ | Duration |
| Trạng thái | On time/Late/Early/Missing/Leave/Remote |
| Ghi chú | Icon nếu có |
| Action | Xem detail, tạo điều chỉnh, export |

Filter:

1. Tháng/năm.
2. Employee/team/department.
3. Status.
4. Shift.
5. Missing checkout.
6. Remote.
7. Late/early.

Mobile:

1. Chuyển table thành card list.
2. Mỗi card hiển thị ngày, trạng thái, check-in/out, tổng giờ.
3. Filter mở dạng drawer.

### 9.6 Screen UI-ATT-SCREEN-008: Duyệt điều chỉnh công

Approval UI:

```text
Yêu cầu điều chỉnh công #ATT-ADJ-0001             [Duyệt] [Từ chối]
Người gửi: Nguyễn Văn A
Ngày công: 19/06/2026
Lý do: Quên check-out

Dữ liệu hiện tại:
- Check-in: 08:03
- Check-out: Trống
- Trạng thái: Missing checkout

Đề xuất:
- Check-out: 17:35
- Ghi chú: Quên bấm check-out

File/ảnh bằng chứng
Lịch sử xử lý
```

Rule:

1. Manager chỉ duyệt nhân viên trong team.
2. HR có thể duyệt company scope nếu có quyền.
3. Approve cần modal confirm và preview ngày công sau khi áp dụng.
4. Reject bắt buộc lý do.
5. Nếu kỳ công bị khóa ở phase sau, disable action + tooltip.

---

## 10. LEAVE MODULE UI DESIGN

### 10.1 Mục tiêu UX

LEAVE Workspace giúp Employee tạo đơn nghỉ nhanh, xem số dư phép và theo dõi trạng thái. Manager/HR xử lý duyệt/từ chối, xem lịch nghỉ và quản lý chính sách/số dư.

Nguyên tắc LEAVE UI:

1. Form tạo đơn nghỉ phải có preview số ngày/giờ nghỉ trước khi gửi.
2. Số dư phép phải luôn dễ thấy.
3. Duyệt đơn phải có đầy đủ thông tin tác động: người nghỉ, loại nghỉ, thời gian, số ngày, lịch team.
4. Không hiển thị lý do nghỉ nhạy cảm cho người không có quyền.
5. Calendar phải hỗ trợ view cá nhân/team/company theo scope.
6. Chính sách và số dư phép là dữ liệu nhạy cảm, cần permission rõ.

### 10.2 LEAVE sidebar đề xuất

```text
Tổng quan
- Tổng quan nghỉ phép
- Số dư phép của tôi

Đơn nghỉ
- Đơn nghỉ của tôi
- Tạo đơn nghỉ
- Chờ tôi duyệt

Lịch nghỉ
- Lịch nghỉ

Quản lý
- Loại nghỉ
- Chính sách nghỉ
- Số dư phép

Báo cáo
- Báo cáo nghỉ phép
```

### 10.3 Screen list LEAVE

| Screen code | Tên màn hình | Route | Actor | Priority | Template |
| --- | --- | --- | --- | --- | --- |
| UI-LEAVE-SCREEN-001 | Tổng quan nghỉ phép | `/leave` | Employee/Manager/HR | P1 | Overview |
| UI-LEAVE-SCREEN-002 | Số dư phép của tôi | `/leave/me/balances` | Employee | P0 | Metric/List |
| UI-LEAVE-SCREEN-003 | Đơn nghỉ của tôi | `/leave/me/requests` | Employee | P0 | List/Table |
| UI-LEAVE-SCREEN-004 | Tạo đơn nghỉ | `/leave/requests/new` | Employee | P0 | Form |
| UI-LEAVE-SCREEN-005 | Chi tiết đơn nghỉ | `/leave/requests/:id` | Owner/Manager/HR | P0 | Detail |
| UI-LEAVE-SCREEN-006 | Đơn chờ duyệt | `/leave/approvals` | Manager/HR | P0 | Approval List |
| UI-LEAVE-SCREEN-007 | Duyệt/Từ chối đơn | `/leave/approvals/:id` | Manager/HR | P0 | Approval |
| UI-LEAVE-SCREEN-008 | Lịch nghỉ | `/leave/calendar` | Employee/Manager/HR | P1 | Calendar |
| UI-LEAVE-SCREEN-009 | Loại nghỉ | `/leave/types` | HR/Admin | P1 | Settings/List |
| UI-LEAVE-SCREEN-010 | Chính sách nghỉ | `/leave/policies` | HR/Admin | P1 | Settings |
| UI-LEAVE-SCREEN-011 | Số dư phép nhân viên | `/leave/balances` | HR/Admin | P1 | List/Table |
| UI-LEAVE-SCREEN-012 | Lịch sử số dư phép | `/leave/balances/:id/transactions` | HR/Admin | P2 | Audit/List |
| UI-LEAVE-SCREEN-013 | Báo cáo nghỉ phép | `/leave/reports` | HR/Manager | P2 | Report |

### 10.3b Bàn giao FE — Screen ↔ API · Component · Responsive · State

> Endpoint rút gọn (path đầy đủ ở §17.4); component theo thư viện UI-05 + §16; state nền tảng ở §5.7.

| Screen code | API chính | Component chính | Responsive | State bắt buộc |
| --- | --- | --- | --- | --- |
| UI-LEAVE-SCREEN-001 | `GET /leave/me/balances·requests` | LeaveBalanceCard, SummaryCards | Overview stack mobile | loading, empty, error |
| UI-LEAVE-SCREEN-002 | `GET /leave/me/balances` | LeaveBalanceCard, StatusBadge | Stack mobile | loading, low-balance warning, error |
| UI-LEAVE-SCREEN-003 | `GET /leave/me/requests` | DataTable, StatusBadge, FilterTabs | Table → card | loading, empty (draft/pending/approved/rejected) |
| UI-LEAVE-SCREEN-004 | `POST /leave/me/requests`, `POST /leave/requests/calculate` | LeaveRequestForm, LeaveBalanceCard, LeaveCalculationPreview | Form full-screen; preview sticky | calculating, insufficient-balance, date-conflict, validation, success |
| UI-LEAVE-SCREEN-005 | `GET /leave/requests/{id}`, `POST .../submit·cancel` | DetailSection, StatusBadge, ApprovalBox | Stacked mobile | loading, cancel-allowed/not, error |
| UI-LEAVE-SCREEN-006 | `GET /leave/approvals` | DataTable, ApprovalBox, FilterBar | Table → list | loading, empty, scope-empty |
| UI-LEAVE-SCREEN-007 | `POST /leave/approvals/{id}/approve·reject` | ApprovalBox, TeamCalendarMini, Diff/ImpactPreview | Stacked | pending, approved, rejected, conflict |
| UI-LEAVE-SCREEN-008 | `GET /leave/calendar` | CalendarView, FilterBar, EventPopover | Week/list trên mobile | loading, empty, scope |
| UI-LEAVE-SCREEN-009 | `GET /leave/types` | DataTable, SettingsForm | Desktop | loading, validation |
| UI-LEAVE-SCREEN-010 | `GET /leave/policies` | SettingsForm | Desktop | loading, validation |
| UI-LEAVE-SCREEN-011 | `GET /leave/balances` | DataTable, FilterBar | Desktop | loading, empty |
| UI-LEAVE-SCREEN-012 | `GET /leave/balances/{id}/transactions` | DataTable, AuditList | Desktop | loading, empty |
| UI-LEAVE-SCREEN-013 | Report API (LEAVE) | Report/Chart | Desktop | loading, empty |

### 10.4 Screen UI-LEAVE-SCREEN-004: Tạo đơn nghỉ

API:

```http
GET /api/v1/leave/me/balances
POST /api/v1/leave/requests/calculate
POST /api/v1/leave/me/requests
POST /api/v1/leave/me/requests/{id}/submit
```

Wireframe:

```text
Nghỉ phép / Tạo đơn nghỉ                              [Lưu nháp] [Gửi đơn]

Số dư phép
+----------------+----------------+----------------+
| Phép năm       | Nghỉ ốm        | Nghỉ không lương|
| Còn 8 ngày     | Còn 3 ngày     | Không giới hạn |
+----------------+----------------+----------------+

Thông tin đơn
Loại nghỉ *
Kiểu nghỉ: Cả ngày / Nửa ngày / Theo giờ
Từ ngày *
Đến ngày *
Buổi nghỉ / Giờ nghỉ nếu applicable
Lý do *
Người bàn giao công việc optional
File đính kèm optional

Preview
- Số ngày tính phép: 2 ngày
- Số dư sau khi nghỉ: 6 ngày
- Cảnh báo trùng lịch nghỉ team: Không
```

UX rule:

1. Khi đổi ngày/loại nghỉ, gọi calculate/preview.
2. Nếu số dư không đủ, disable `Gửi đơn`, vẫn có thể lưu nháp nếu policy cho phép.
3. Nếu ngày nghỉ trùng public holiday hoặc weekend, preview giải thích rõ.
4. Nếu nghỉ full-day Approved rồi, ATT sẽ block check-in; hiển thị note.
5. Upload file nếu loại nghỉ yêu cầu chứng minh.
6. Dirty form guard khi rời màn.

### 10.5 Screen UI-LEAVE-SCREEN-007: Duyệt/Từ chối đơn nghỉ

Approval layout:

```text
Đơn nghỉ #LV-0001                                  [Duyệt] [Từ chối]
Người gửi: Nguyễn Văn A - Developer - Team Mobile
Loại nghỉ: Phép năm
Thời gian: 24/06/2026 - 25/06/2026
Số ngày: 2 ngày
Trạng thái: Pending

Preview tác động:
- Số dư hiện tại: 8 ngày
- Sau khi duyệt: 6 ngày
- Lịch team: 1 người khác cũng nghỉ cùng ngày
- Task/deadline liên quan: 2 task sắp đến hạn

Lý do nghỉ
File đính kèm
Lịch sử xử lý
```

Rule:

1. Duyệt phải kiểm tra đơn còn trạng thái Pending.
2. Từ chối bắt buộc nhập lý do.
3. Nếu Manager không thuộc scope, ẩn action và hiển thị forbidden nếu direct URL.
4. Nếu thiếu quyền xem lý do chi tiết, mask lý do.
5. Sau duyệt, hiển thị toast và cập nhật danh sách pending.

### 10.6 Screen UI-LEAVE-SCREEN-008: Lịch nghỉ

Calendar view:

| View | Dùng cho |
| --- | --- |
| Month | HR xem toàn công ty |
| Week | Manager xem team |
| List | Mobile và employee |
| Department filter | HR |
| Team filter | Manager |
| Leave type filter | HR/Manager nếu có quyền |

Rule:

1. Employee chỉ thấy lịch cá nhân hoặc lịch team nếu được cấp.
2. Không hiển thị lý do nghỉ nhạy cảm trong calendar tooltip nếu thiếu quyền.
3. Click event mở Leave Detail hoặc quick drawer theo quyền.
4. Ngày hôm nay highlight.
5. Có indicator ngày lễ nếu public holiday có dữ liệu.

---

## 11. TASK MODULE UI DESIGN

### 11.1 Mục tiêu UX

TASK Workspace cần giúp team quản lý dự án, task, trạng thái, deadline, comment, checklist và file tập trung.

Nguyên tắc TASK UI:

1. User phải thấy nhanh “việc của tôi” và deadline.
2. Task detail là trung tâm tương tác: mô tả, assignee, status, comment, checklist, file, activity.
3. Kanban phải dễ kéo thả nhưng vẫn tuân thủ permission và business rule.
4. Khi giao task, nếu assignee đang nghỉ phép hoặc deadline trùng kỳ nghỉ, hiển thị cảnh báo.
5. Comment/mention cần rõ người được mention và phát notification.
6. Project detail cần phân biệt thông tin dự án, thành viên, task và tiến độ.

### 11.2 TASK sidebar đề xuất

```text
Tổng quan
- Tổng quan công việc

Công việc
- Việc của tôi
- Danh sách task
- Kanban

Dự án
- Dự án
- Thành viên dự án

Báo cáo
- Báo cáo tiến độ
- Activity log
```

### 11.3 Screen list TASK

| Screen code | Tên màn hình | Route | Actor | Priority | Template |
| --- | --- | --- | --- | --- | --- |
| UI-TASK-SCREEN-001 | Tổng quan công việc | `/tasks` | Employee/Manager | P1 | Overview |
| UI-TASK-SCREEN-002 | Việc của tôi | `/tasks/my-tasks` | Employee | P0 | List/Card |
| UI-TASK-SCREEN-003 | Danh sách task | `/tasks/list` | Employee/Manager | P0 | List/Table |
| UI-TASK-SCREEN-004 | Tạo task | `/tasks/new` | Manager/Employee nếu được cấp | P1 | Form |
| UI-TASK-SCREEN-005 | Chi tiết task | `/tasks/:id` | Assignee/Watcher/Manager | P0 | Detail |
| UI-TASK-SCREEN-006 | Kanban board | `/tasks/kanban` | Team/Project member | P0 | Kanban |
| UI-TASK-SCREEN-007 | Danh sách dự án | `/tasks/projects` | Employee/Manager | P1 | List/Card |
| UI-TASK-SCREEN-008 | Tạo dự án | `/tasks/projects/new` | Manager/Admin | P1 | Form |
| UI-TASK-SCREEN-009 | Chi tiết dự án | `/tasks/projects/:id` | Project member | P1 | Detail |
| UI-TASK-SCREEN-010 | Thành viên dự án | `/tasks/projects/:id/members` | Project owner/manager | P1 | List/Table |
| UI-TASK-SCREEN-011 | Báo cáo task/project | `/tasks/reports` | Manager | P2 | Report |
| UI-TASK-SCREEN-012 | Activity log | `/tasks/activity` | Manager/Admin | P2 | Activity |

### 11.3b Bàn giao FE — Screen ↔ API · Component · Responsive · State

> Endpoint rút gọn (path đầy đủ ở §17.5); component theo thư viện UI-05 + §16; state nền tảng ở §5.7.

| Screen code | API chính | Component chính | Responsive | State bắt buộc |
| --- | --- | --- | --- | --- |
| UI-TASK-SCREEN-001 | `GET /tasks` (tổng hợp) | TaskCard, StatCard, FilterTabs | Desktop grid → mobile stack | loading, empty, error |
| UI-TASK-SCREEN-002 | `GET /tasks/my-tasks` | TaskCard, FilterTabs, PriorityBadge | Card list trên mobile | loading, empty, scope-empty, error |
| UI-TASK-SCREEN-003 | `GET /tasks` | DataTable, FilterBar, StatusBadge | Table → card | loading, empty, error |
| UI-TASK-SCREEN-004 | `POST /tasks` | Form (UI-05), AssigneePicker, DatePicker | Form full-screen mobile | validation, submit-loading, success, error |
| UI-TASK-SCREEN-005 | `GET·PATCH /tasks/{id}`, `POST /tasks/{id}/status·comments·checklists` | TaskDetailHeader, Checklist, CommentThread, ActivityLog | Main + right panel → tabs/accordion | loading, error, forbidden, optimistic update |
| UI-TASK-SCREEN-006 | `GET /tasks/kanban`, `POST /tasks/kanban/move` | KanbanBoard, KanbanColumn, TaskCard | Horizontal scroll; mobile optional list | loading, optimistic move + rollback, error |
| UI-TASK-SCREEN-007 | `GET /tasks/projects` | DataTable/CardList, StatusBadge | Table → card | loading, empty, error |
| UI-TASK-SCREEN-008 | `POST /tasks/projects` | Form (UI-05) | Form full-screen mobile | validation, success, error |
| UI-TASK-SCREEN-009 | `GET /tasks/projects/{id}` | DetailSection, Tabs, Timeline | Right panel → tabs | loading, error, forbidden |
| UI-TASK-SCREEN-010 | `GET /tasks/projects/{id}/members` | DataTable, MemberRow | Table → card | loading, empty |
| UI-TASK-SCREEN-011 | Report API (TASK) | Report/Chart, FilterBar | Desktop ưu tiên | loading, empty, error |
| UI-TASK-SCREEN-012 | Activity API (TASK) | ActivityLog, AuditTable | List | loading, empty |

### 11.4 Screen UI-TASK-SCREEN-002: Việc của tôi

View modes:

1. Today.
2. Upcoming.
3. Overdue.
4. Assigned to me.
5. Created by me.
6. Watching.

Card fields:

| Field | Hiển thị |
| --- | --- |
| Priority | Badge |
| Title | 2 dòng |
| Project | Optional |
| Due date | Relative label |
| Status | Badge |
| Checklist progress | x/y |
| Comment count | Icon |
| Assignee | Ẩn nếu của tôi, hiện nếu nhiều người |

Mobile ưu tiên card list.

### 11.5 Screen UI-TASK-SCREEN-005: Chi tiết task

Wireframe:

```text
Task #TASK-0001                                     [Edit] [More]
Hoàn thiện API Leave Design                         Status: In Progress

Main
- Description
- Checklist
- Attachments
- Comments

Right panel
- Assignee
- Reporter
- Watchers
- Priority
- Due date
- Project
- Tags optional
- Activity timeline
```

Tabs/sections:

| Section | Nội dung |
| --- | --- |
| Overview | Title, description, status, priority |
| Checklist | Checklist group + item |
| Comment | CommentThread + mention |
| File | Task files |
| Activity | Status changes, assignee changes, comments, file uploads |

Actions:

| Action | Permission/rule |
| --- | --- |
| Edit task | `TASK.TASK.UPDATE` hoặc owner/project role |
| Update status | Assignee/manager có quyền |
| Add comment | Member/watcher có quyền |
| Mention user | User thuộc project/company và có quyền xem task |
| Add checklist | Có quyền update task |
| Upload file | Có quyền upload file |
| Delete task | Permission riêng + confirm |

### 11.6 Screen UI-TASK-SCREEN-006: Kanban board

Columns MVP:

```text
Todo | In Progress | In Review | Done | Cancelled
```

Card:

```text
[High] Task title
Project / Assignee avatar
Due date / Checklist progress / Comment count
```

Rule:

1. Drag/drop chỉ cho phép nếu user có quyền update status.
2. Nếu backend từ chối transition, card quay về cột cũ + toast lỗi.
3. Task quá hạn có badge danger.
4. Filter theo project, assignee, priority, due date.
5. Mobile dùng column horizontal scroll hoặc list theo status.

### 11.7 Screen UI-TASK-SCREEN-009: Chi tiết dự án

Tabs:

1. Overview.
2. Tasks.
3. Kanban.
4. Members.
5. Files.
6. Activity.
7. Reports.

Project summary:

| Field | Hiển thị |
| --- | --- |
| Tên dự án | Header |
| Trạng thái | Active/Completed/Cancelled/Archived |
| Owner | Avatar/name |
| Deadline | Date |
| Progress | % Done |
| Members | Avatar group |
| Task summary | Todo/In Progress/Done/Overdue |

---

## 12. NOTI MODULE UI DESIGN

### 12.1 Mục tiêu UX

NOTI giúp user không bỏ sót sự kiện quan trọng và có thể đi thẳng đến nghiệp vụ gốc.

Nguyên tắc NOTI UI:

1. Notification badge phải phản ánh unread count đúng scope Own.
2. Dropdown chỉ hiển thị thông báo gần nhất, không thay thế trang danh sách.
3. Click notification có thể mark read rồi deep link đến target.
4. Nếu target đã bị xóa hoặc user mất quyền, hiển thị thông báo không truy cập được.
5. Notification list phải filter theo trạng thái, module nguồn, thời gian.
6. Admin config event/template phải rõ ràng, tránh spam notification.

### 12.2 NOTI sidebar đề xuất

```text
Thông báo của tôi
- Tất cả thông báo
- Chưa đọc
- Đã lưu trữ

Quản trị thông báo
- Notification events
- Templates
- Delivery logs
- System notification

Thiết lập
- Kênh gửi
- Preferences optional
```

### 12.3 Screen list NOTI

| Screen code | Tên màn hình | Route | Actor | Priority | Template |
| --- | --- | --- | --- | --- | --- |
| UI-NOTI-SCREEN-001 | Notification dropdown | Topbar popover | All users | P0 | Dropdown |
| UI-NOTI-SCREEN-002 | Danh sách thông báo của tôi | `/notifications` | All users | P0 | List |
| UI-NOTI-SCREEN-003 | Chi tiết thông báo | `/notifications/:id` | Owner | P1 | Detail |
| UI-NOTI-SCREEN-004 | Notification events | `/notifications/events` | Admin | P2 | Settings/List |
| UI-NOTI-SCREEN-005 | Notification templates | `/notifications/templates` | Admin | P2 | Settings/List |
| UI-NOTI-SCREEN-006 | Delivery logs | `/notifications/delivery-logs` | Admin | P2 | Audit/Table |
| UI-NOTI-SCREEN-007 | Gửi thông báo hệ thống | `/notifications/system/new` | Admin/Super Admin | P2 | Form |
| UI-NOTI-SCREEN-008 | Notification settings | `/notifications/settings` | Admin | P2 | Settings |

### 12.3b Bàn giao FE — Screen ↔ API · Component · Responsive · State

> Endpoint rút gọn (path đầy đủ ở §17.6); component theo thư viện UI-05 + §16; state nền tảng ở §5.7.

| Screen code | API chính | Component chính | Responsive | State bắt buộc |
| --- | --- | --- | --- | --- |
| UI-NOTI-SCREEN-001 | `GET /notifications/unread-count·dropdown`, `POST .../mark-read·mark-all-read` | NotificationBadge, NotificationDropdownItem | Fullscreen list mobile | no-unread, unread, mark-read loading, error |
| UI-NOTI-SCREEN-002 | `GET /notifications` | NotificationListItem, FilterTabs | Fullscreen list | loading, empty, filter read/unread |
| UI-NOTI-SCREEN-003 | `GET /notifications/{id}`, `POST .../mark-read` | DetailSection, DeepLinkButton | Stacked | loading, target available/unavailable, forbidden-target |
| UI-NOTI-SCREEN-004 | `GET /notifications/events` | DataTable, ToggleSwitch | Desktop | loading, empty |
| UI-NOTI-SCREEN-005 | `GET /notifications/templates` | DataTable, Form | Desktop | loading, validation |
| UI-NOTI-SCREEN-006 | `GET /notifications/delivery-logs` | AuditTable | Desktop | loading, empty |
| UI-NOTI-SCREEN-007 | System-send API | Form (UI-05) | Desktop | validation, success |
| UI-NOTI-SCREEN-008 | Settings API | SettingsForm, ToggleSwitch | Stack mobile | loading, success |

### 12.4 Screen UI-NOTI-SCREEN-001: Notification dropdown

Anatomy:

```text
Thông báo                                      5 chưa đọc
[Tab] Tất cả | Chưa đọc

[Leave] Đơn nghỉ của bạn đã được duyệt         5 phút trước
[Task] Bạn được giao task mới                  20 phút trước
[ATT] Bạn chưa check-out hôm qua               Hôm qua

[Đánh dấu tất cả đã đọc]       [Xem tất cả]
```

Rule:

1. Dropdown load nhanh, tối đa 5-7 item.
2. Item unread có nền nhẹ hoặc dot.
3. Click item:
   - Gọi mark read nếu chưa đọc.
   - Điều hướng target route.
4. Nếu target cần app khác, App Switcher không cần mở; điều hướng trực tiếp vào Module Workspace.
5. Nếu API lỗi, show mini ErrorState trong dropdown.
6. Nếu không có thông báo, empty state ngắn.

### 12.5 Screen UI-NOTI-SCREEN-002: Danh sách thông báo

Filter:

1. All/Unread/Read/Archived.
2. Module nguồn: HR, ATT, LEAVE, TASK, SYSTEM.
3. Date range.
4. Priority/type.
5. Search title/content.

List item fields:

| Field | Hiển thị |
| --- | --- |
| Module badge | HR/ATT/LEAVE/TASK/SYSTEM |
| Title | Dòng chính |
| Content preview | 1-2 dòng |
| Time | Relative + absolute tooltip |
| Read state | Dot/unread style |
| Target | CTA mở nghiệp vụ |
| Actions | Mark read, archive, delete soft |

### 12.6 Screen UI-NOTI-SCREEN-005: Notification templates

Template table:

| Cột | Nội dung |
| --- | --- |
| Event code | Ví dụ `LEAVE_REQUEST_APPROVED` |
| Channel | In-app/Email/Push phase sau |
| Language | vi/en |
| Title template | Preview |
| Status | Active/Inactive |
| Updated at | Date |
| Action | Edit, preview, deactivate |

Template editor:

1. Event info panel.
2. Title template.
3. Body template.
4. Variable helper.
5. Preview with sample payload.
6. Test render.
7. Save with confirm.

---

## 13. FOUNDATION / SYSTEM UI DESIGN

### 13.1 Mục tiêu UX

FOUNDATION/SYSTEM Workspace phục vụ cấu hình nền tảng: công ty, module catalog, system settings, file metadata, audit log.

Nguyên tắc:

1. Cấu hình ảnh hưởng toàn hệ thống phải có cảnh báo.
2. Audit log phải filter/search tốt.
3. Module catalog phải hiển thị module active/inactive/coming soon/maintenance.
4. File metadata không nên cho tải file nếu thiếu quyền.
5. System settings cần chia nhóm rõ, không đưa tất cả vào một form dài.

### 13.2 Screen list FOUNDATION/SYSTEM

| Screen code | Tên màn hình | Route | Actor | Priority | Template |
| --- | --- | --- | --- | --- | --- |
| UI-FOUNDATION-SCREEN-001 | Tổng quan hệ thống | `/system` | Admin | P1 | Overview |
| UI-FOUNDATION-SCREEN-002 | Thông tin công ty | `/system/company` | Admin | P1 | Settings/Form |
| UI-FOUNDATION-SCREEN-003 | Module catalog | `/system/modules` | Admin | P1 | Card/List |
| UI-FOUNDATION-SCREEN-004 | Cấu hình hệ thống | `/system/settings` | Admin | P1 | Settings |
| UI-FOUNDATION-SCREEN-005 | File metadata | `/system/files` | Admin | P2 | List/Table |
| UI-FOUNDATION-SCREEN-006 | Audit logs | `/system/audit-logs` | Admin/Security | P1 | Audit/Table |
| UI-FOUNDATION-SCREEN-007 | Public holidays | `/system/public-holidays` | HR/Admin | P1 | Calendar/List |
| UI-FOUNDATION-SCREEN-008 | Sequence counters | `/system/sequences` | Admin | P2 | Settings/List |

### 13.2b Bàn giao FE — Screen ↔ API · Component · Responsive · State

> Endpoint theo [API-09 FOUNDATION](<../API Design/API-09_FOUNDATION_API_Design.md>); component theo thư viện UI-05 + §16; state nền tảng ở §5.7.

| Screen code | API chính | Component chính | Responsive | State bắt buộc |
| --- | --- | --- | --- | --- |
| UI-FOUNDATION-SCREEN-001 | API-09 (system overview) | StatCard, Charts | Stack mobile | loading, error |
| UI-FOUNDATION-SCREEN-002 | API-09 (company) | SettingsForm | Stack mobile | loading, validation, success |
| UI-FOUNDATION-SCREEN-003 | API-09 (modules) | ModuleCard, ToggleSwitch | Card grid → stack | loading, empty, disabled-state |
| UI-FOUNDATION-SCREEN-004 | API-09 (settings) | SettingsForm, Tabs | Desktop | loading, validation, save-confirm |
| UI-FOUNDATION-SCREEN-005 | API-09 (files) | DataTable, FilePreview | Desktop | loading, empty |
| UI-FOUNDATION-SCREEN-006 | API-09 (audit-logs) | AuditTable, AuditDetailDrawer, JsonViewerCollapsed | Desktop | loading, empty |
| UI-FOUNDATION-SCREEN-007 | API-09 (public-holidays) | CalendarView, DataTable | Desktop | loading, empty |
| UI-FOUNDATION-SCREEN-008 | API-09 (sequences) | SettingsForm | Desktop | loading, validation |

### 13.3 Screen UI-FOUNDATION-SCREEN-003: Module catalog

Card/list fields:

| Field | Nội dung |
| --- | --- |
| Module icon/name | AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI |
| Status | Active/Inactive/Maintenance/Beta/Coming soon |
| Visible in Home | Yes/No |
| Required permission | App access permission |
| Last updated | Date |
| Action | Configure, disable/enable nếu có quyền |

Rule:

1. Không cho disable module nền tảng bắt buộc nếu gây lỗi hệ thống.
2. Module phase sau mặc định ẩn hoặc locked.
3. Nếu bật module, cần confirm và mô tả tác động.

### 13.4 Screen UI-FOUNDATION-SCREEN-006: Audit logs

Filter:

1. Module.
2. Actor.
3. Action.
4. Target entity.
5. Date range.
6. IP/device.
7. Severity.

Columns:

| Cột | Nội dung |
| --- | --- |
| Time | Date/time |
| Actor | User |
| Module | HR/ATT/LEAVE/TASK/... |
| Action | CREATE/UPDATE/DELETE/APPROVE |
| Target | Entity type + id/code |
| Summary | Mô tả ngắn |
| IP/User agent | Optional |
| Action | View detail |

Detail drawer:

1. Before/after diff.
2. Request id/correlation id.
3. Actor info.
4. Target entity.
5. Metadata JSON collapsed by default.
6. Link đến record gốc nếu có quyền.

---

## 14. Cross-module interaction patterns

### 14.1 Notification deep link

Flow:

```text
User click notification
-> NOTI mark read
-> Resolve target module/route
-> Navigate to target Module Workspace
-> Module checks permission/data scope
-> If allowed: show detail
-> If not allowed: show Forbidden/TargetUnavailable state
```

Target unavailable copy:

```text
Bạn không thể mở nội dung này.
Nội dung có thể đã bị xóa, thay đổi trạng thái hoặc bạn không còn quyền truy cập.
```

### 14.2 Dashboard quick action to module

Dashboard action không thay thế module gốc.

| Quick action | Target |
| --- | --- |
| Check-in/out | ATT Today |
| Tạo đơn nghỉ | Leave Create |
| Duyệt đơn nghỉ | Leave Approval |
| Xem task | Task Detail/List |
| Thêm nhân viên | HR Employee Create |
| Xem audit | System Audit Logs |

### 14.3 Dirty form guard

Áp dụng khi:

1. Đổi route trong sidebar.
2. Mở App Switcher chọn app khác.
3. Click logo Home.
4. Browser back.
5. Đóng tab nếu frontend hỗ trợ.

Confirm copy:

```text
Bạn có thay đổi chưa lưu.
Nếu rời khỏi màn hình, các thay đổi này sẽ bị mất.

[Ở lại] [Rời khỏi]
```

### 14.4 Permission denied pattern

| Trường hợp | UI |
| --- | --- |
| App không có quyền | Ẩn khỏi Home/App Switcher |
| Menu không có quyền | Ẩn khỏi sidebar |
| Direct URL thiếu quyền | ForbiddenPage |
| Action thiếu quyền | Ẩn action |
| Action có quyền nhưng rule không cho | Disable + tooltip |
| Field nhạy cảm thiếu quyền | MaskedField hoặc không render |

### 14.5 Scope empty pattern

Dùng khi user có quyền vào màn nhưng không có dữ liệu trong scope.

Copy mẫu:

```text
Không có dữ liệu trong phạm vi của bạn.
Bạn đang xem dữ liệu theo phạm vi: Team của tôi.
```

CTA optional:

```text
Đổi bộ lọc
Làm mới
```

Không hiển thị CTA tạo nếu user không có quyền tạo.

---

## 15. Responsive behavior theo module

### 15.1 Desktop

| Module | Ưu tiên desktop |
| --- | --- |
| HR | Table đầy đủ, detail page nhiều tab |
| ATT | Bảng công theo tháng, filter rộng |
| LEAVE | Form + preview side panel |
| TASK | Kanban nhiều cột, task detail có right panel |
| NOTI | List + detail drawer |
| SYSTEM | Matrix/table/settings nhiều cột |

### 15.2 Tablet

| Pattern | Behavior |
| --- | --- |
| Sidebar | Collapsed hoặc drawer |
| Table | Horizontal scroll hoặc column priority |
| Detail | Right panel chuyển xuống dưới |
| Form | 1-2 cột tùy độ rộng |
| Kanban | Horizontal scroll |
| Calendar | Week/list view ưu tiên |

### 15.3 Mobile web

| Module | Mobile rule |
| --- | --- |
| HR | Employee list thành card; detail dùng accordion/tabs |
| ATT | Today card full width; bảng công thành card theo ngày |
| LEAVE | Form full screen; preview sticky hoặc collapsible |
| TASK | My tasks card list; task detail tabs; Kanban optional horizontal |
| NOTI | Dropdown thành fullscreen list |
| SYSTEM | Chỉ hỗ trợ các màn quản trị đơn giản; matrix phức tạp khuyến nghị desktop |

---

## 16. Component mapping UI-09

| Nghiệp vụ | Component chính |
| --- | --- |
| Employee list | DataTable, EmployeeAvatarCell, StatusBadge, FilterBar |
| Employee detail | EmployeeProfileHeader, DetailSection, Tabs, Timeline, FileList |
| Profile change approval | ApprovalBox, DiffTable, ConfirmDialog |
| Attendance today | AttendanceStatusCard, CheckInOutButton, WorkLogTimeline |
| Attendance records | DataTable, MonthPicker, StatusBadge, ExportButton |
| Attendance adjustment | ApprovalBox, DiffTable, EvidenceFileList |
| Leave create | LeaveRequestForm, LeaveBalanceCard, LeaveCalculationPreview |
| Leave approval | ApprovalBox, TeamCalendarMini, Diff/ImpactPreview |
| Leave calendar | CalendarView, FilterBar, EventPopover |
| My tasks | TaskCard, FilterTabs, PriorityBadge |
| Task detail | TaskDetailHeader, Checklist, CommentThread, ActivityLog |
| Kanban | KanbanBoard, KanbanColumn, TaskCard |
| Notification dropdown | NotificationBadge, NotificationDropdownItem |
| Notification list | NotificationListItem, FilterTabs |
| Permission matrix | PermissionMatrixTable, ModuleTabs, DiffConfirmModal |
| Audit log | AuditTable, AuditDetailDrawer, JsonViewerCollapsed |

---

## 17. API mapping tổng quan

### 17.1 AUTH/SYSTEM

```http
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
GET    /api/v1/auth/me/permissions
GET    /api/v1/auth/users
POST   /api/v1/auth/users
GET    /api/v1/auth/users/{user_id}
PATCH  /api/v1/auth/users/{user_id}
POST   /api/v1/auth/users/{user_id}/lock
POST   /api/v1/auth/users/{user_id}/unlock
GET    /api/v1/auth/roles
POST   /api/v1/auth/roles
GET    /api/v1/auth/permissions
PUT    /api/v1/auth/roles/{role_id}/permissions
```

### 17.2 HR

```http
GET    /api/v1/hr/employees
POST   /api/v1/hr/employees
GET    /api/v1/hr/employees/{employee_id}
PATCH  /api/v1/hr/employees/{employee_id}
GET    /api/v1/hr/me
POST   /api/v1/hr/me/profile-change-requests
GET    /api/v1/hr/profile-change-requests
POST   /api/v1/hr/profile-change-requests/{request_id}/approve
POST   /api/v1/hr/profile-change-requests/{request_id}/reject
GET    /api/v1/hr/departments
GET    /api/v1/hr/positions
GET    /api/v1/hr/contracts
GET    /api/v1/hr/settings/employee-code
PATCH  /api/v1/hr/settings/employee-code
```

### 17.3 ATT

```http
GET    /api/v1/attendance/today
POST   /api/v1/attendance/check-in
POST   /api/v1/attendance/check-out
GET    /api/v1/attendance/records
GET    /api/v1/attendance/records/{record_id}
GET    /api/v1/attendance/adjustment-requests
POST   /api/v1/attendance/adjustment-requests
POST   /api/v1/attendance/adjustment-requests/{request_id}/approve
POST   /api/v1/attendance/adjustment-requests/{request_id}/reject
GET    /api/v1/attendance/remote-work-requests
POST   /api/v1/attendance/remote-work-requests
GET    /api/v1/attendance/shifts
GET    /api/v1/attendance/rules
```

### 17.4 LEAVE

```http
GET    /api/v1/leave/me/balances
GET    /api/v1/leave/me/requests
POST   /api/v1/leave/me/requests
POST   /api/v1/leave/requests/calculate
GET    /api/v1/leave/requests/{request_id}
POST   /api/v1/leave/requests/{request_id}/submit
POST   /api/v1/leave/requests/{request_id}/cancel
GET    /api/v1/leave/approvals
POST   /api/v1/leave/approvals/{request_id}/approve
POST   /api/v1/leave/approvals/{request_id}/reject
GET    /api/v1/leave/calendar
GET    /api/v1/leave/types
GET    /api/v1/leave/policies
GET    /api/v1/leave/balances
```

### 17.5 TASK

```http
GET    /api/v1/tasks/my-tasks
GET    /api/v1/tasks
POST   /api/v1/tasks
GET    /api/v1/tasks/{task_id}
PATCH  /api/v1/tasks/{task_id}
POST   /api/v1/tasks/{task_id}/status
POST   /api/v1/tasks/{task_id}/comments
POST   /api/v1/tasks/{task_id}/checklists
GET    /api/v1/tasks/kanban
POST   /api/v1/tasks/kanban/move
GET    /api/v1/tasks/projects
POST   /api/v1/tasks/projects
GET    /api/v1/tasks/projects/{project_id}
GET    /api/v1/tasks/projects/{project_id}/members
```

### 17.6 NOTI

```http
GET    /api/v1/notifications/unread-count
GET    /api/v1/notifications/dropdown
GET    /api/v1/notifications
GET    /api/v1/notifications/{notification_id}
POST   /api/v1/notifications/{notification_id}/mark-read
POST   /api/v1/notifications/mark-all-read
POST   /api/v1/notifications/{notification_id}/archive
GET    /api/v1/notifications/events
GET    /api/v1/notifications/templates
GET    /api/v1/notifications/delivery-logs
```

---

## 18. Figma frame list đề xuất

### 18.1 AUTH/SYSTEM

| Frame | Priority |
| --- | --- |
| AUTH / Login | P0 |
| AUTH / Forgot Password | P1 |
| SYSTEM / Users List | P0 |
| SYSTEM / User Detail | P1 |
| SYSTEM / Role List | P0 |
| SYSTEM / Permission Matrix | P0 |
| SYSTEM / Audit Logs | P1 |

### 18.2 HR

| Frame | Priority |
| --- | --- |
| HR / Employee List | P0 |
| HR / Employee Detail | P0 |
| HR / Employee Create Form | P0 |
| HR / My Profile | P0 |
| HR / Profile Change Request Form | P0 |
| HR / Profile Change Approval | P1 |
| HR / Department Tree | P1 |
| HR / Employee Code Config | P1 |

### 18.3 ATT

| Frame | Priority |
| --- | --- |
| ATT / Today Attendance | P0 |
| ATT / Check-in Confirm Modal | P0 |
| ATT / My Records | P0 |
| ATT / Team Records | P1 |
| ATT / Adjustment Request Form | P0 |
| ATT / Adjustment Approval | P1 |
| ATT / Shift Settings | P1 |
| ATT / Rule Settings | P1 |

### 18.4 LEAVE

| Frame | Priority |
| --- | --- |
| LEAVE / My Balance | P0 |
| LEAVE / My Requests | P0 |
| LEAVE / Create Request | P0 |
| LEAVE / Request Detail | P0 |
| LEAVE / Approval List | P0 |
| LEAVE / Approval Detail | P0 |
| LEAVE / Calendar | P1 |
| LEAVE / Policy Settings | P1 |

### 18.5 TASK

| Frame | Priority |
| --- | --- |
| TASK / My Tasks | P0 |
| TASK / Task List | P0 |
| TASK / Task Detail | P0 |
| TASK / Kanban Board | P0 |
| TASK / Task Create Form | P1 |
| TASK / Project List | P1 |
| TASK / Project Detail | P1 |

### 18.6 NOTI

| Frame | Priority |
| --- | --- |
| NOTI / Dropdown | P0 |
| NOTI / Notification List | P0 |
| NOTI / Notification Detail | P1 |
| NOTI / Template List | P2 |
| NOTI / Template Editor | P2 |
| NOTI / Delivery Logs | P2 |

---

## 19. Frontend handoff notes

### 19.1 Route registry

Frontend cần route metadata cho mọi màn:

```ts
{
  routeKey: "leave.request.create",
  path: "/leave/requests/new",
  layout: "MODULE_WORKSPACE",
  moduleCode: "LEAVE",
  screenCode: "UI-LEAVE-SCREEN-004",
  title: "Tạo đơn nghỉ",
  requiredPermissions: ["LEAVE.REQUEST.CREATE"],
  requiredScopes: ["Own"],
  showInSidebar: true,
  sidebarGroup: "operation",
  order: 20
}
```

### 19.2 Action guard

Mỗi screen nên nhận hoặc resolve:

```ts
allowedActions: {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
  canReject: boolean;
  canExport: boolean;
  disabledReason?: string;
}
```

Frontend chỉ dùng để hiển thị UX. Backend vẫn kiểm tra khi gọi API.

### 19.3 Component folder đề xuất

```text
src/
  layouts/
    AuthLayout/
    HomePortalLayout/
    ModuleWorkspaceLayout/
  modules/
    auth/
    system/
    hr/
    attendance/
    leave/
    task/
    notification/
  components/
    data-table/
    form/
    feedback/
    workflow/
    permission/
    audit/
```

### 19.4 State handling

Mọi page cần chuẩn hóa:

```ts
type PageState =
  | "loading"
  | "ready"
  | "empty"
  | "error"
  | "forbidden"
  | "disabled"
  | "submitting"
  | "success";
```

---

## 20. Backend/API handoff notes

Backend cần hỗ trợ UI-09 bằng các điểm sau:

1. Tất cả API list có pagination, search, filter, sort.
2. API detail trả `allowed_actions` hoặc đủ thông tin để frontend xác định action state.
3. API trả error code rõ cho business rule, ví dụ leave insufficient balance, attendance blocked by leave.
4. API không trả field nhạy cảm nếu user không có quyền; không chỉ để frontend mask.
5. API count/badge phải tính theo permission và data scope.
6. API notification target phải kiểm tra quyền khi deep link.
7. API approve/reject phải trả trạng thái mới và audit/activity.
8. API form preview như leave calculation, attendance recalculation, shift rule preview nên có trước khi submit.
9. API nên trả `request_id` trong meta để UI hiển thị khi lỗi.
10. API upload/file phải trả metadata và permission tải/xóa.

---

## 21. QA checklist UI-09

### 21.1 Permission & scope

| Test | Kỳ vọng |
| --- | --- |
| User không có quyền app | Không thấy app trong Home/App Switcher |
| User không có quyền menu | Không thấy menu sidebar |
| Direct URL trái quyền | ForbiddenPage |
| Employee scope Own | Chỉ thấy dữ liệu cá nhân |
| Manager scope Team | Chỉ thấy dữ liệu team |
| HR scope Company | Thấy dữ liệu công ty theo quyền |
| Field nhạy cảm thiếu quyền | Không trả raw hoặc bị mask |
| Badge/counter | Không lộ số liệu ngoài scope |

### 21.2 AUTH/SYSTEM

| Test | Kỳ vọng |
| --- | --- |
| Login sai | Lỗi chung, không tiết lộ email |
| Account locked | Hiển thị thông báo phù hợp |
| Permission matrix dirty | Có confirm khi rời/lưu |
| Gỡ quyền nguy hiểm | Có warning/confirm |
| User lock/unlock | Cập nhật status + audit |

### 21.3 HR

| Test | Kỳ vọng |
| --- | --- |
| Employee list filter | Lọc đúng phòng ban/trạng thái |
| My profile | Chỉ xem Own |
| Self-service update | Tạo request, không cập nhật hồ sơ chính ngay |
| HR approve request | Apply thay đổi sau approve |
| Reject request | Bắt buộc lý do |
| Employee code config | Preview mã tiếp theo đúng |

### 21.4 ATT

| Test | Kỳ vọng |
| --- | --- |
| Check-in allowed | Button hiển thị đúng |
| Check-out allowed | Button hiển thị đúng |
| Có nghỉ phép full-day | Block check-in/out |
| Missing checkout | Alert + CTA adjustment |
| Adjustment approve | Before/after rõ, cập nhật record |
| Team/company records | Scope đúng |

### 21.5 LEAVE

| Test | Kỳ vọng |
| --- | --- |
| Create leave | Preview ngày nghỉ/số dư |
| Insufficient balance | Disable submit hoặc lỗi rõ |
| Save draft | Lưu nháp thành công |
| Submit | Trạng thái Pending |
| Approve/reject | State transition đúng |
| Calendar | Không lộ lý do nghỉ nhạy cảm |

### 21.6 TASK

| Test | Kỳ vọng |
| --- | --- |
| My tasks | Chỉ task được giao/liên quan |
| Task detail | Comment/checklist/activity đúng |
| Kanban drag | Permission + API transition đúng |
| Mention | Tạo notification |
| Assign vào kỳ nghỉ | Hiển thị cảnh báo |
| Delete/cancel task | Confirm rõ |

### 21.7 NOTI

| Test | Kỳ vọng |
| --- | --- |
| Unread count | Đúng Own |
| Dropdown | Tối đa item, loading/error/empty |
| Click notification | Mark read + deep link |
| Target no permission | Target unavailable/forbidden |
| Mark all read | Count về 0 |
| Template preview | Render biến đúng |

### 21.8 Responsive & accessibility

| Test | Kỳ vọng |
| --- | --- |
| Desktop | Sidebar cố định, table đầy đủ |
| Tablet | Sidebar collapsed/drawer, table scroll |
| Mobile | Card list, fullscreen form/drawer |
| Keyboard tab | Đi qua form/action hợp lý |
| Focus visible | Có focus ring |
| Icon-only button | Có aria-label |
| Color state | Không chỉ dùng màu, có text/badge |

---

## 22. Acceptance criteria UI-09

| Mã | Tiêu chí nghiệm thu |
| --- | --- |
| UI09-AC-001 | Có thiết kế chi tiết màn nghiệp vụ cho AUTH/ACCOUNT/SYSTEM, HR, ATT, LEAVE, TASK, NOTI và FOUNDATION |
| UI09-AC-002 | Mỗi module có mục tiêu UX, sidebar đề xuất, screen list và screen detail P0/P1 |
| UI09-AC-003 | Mỗi screen chính có route, actor, priority, template, permission, data scope, API mapping và state |
| UI09-AC-004 | Có wireframe skeleton cho các màn P0: Login, Employee List/Detail, Attendance Today, Leave Create/Approval, My Tasks, Task Detail, Kanban, Notification Dropdown/List |
| UI09-AC-005 | Có quy tắc permission/data scope/field masking/action guard xuyên suốt |
| UI09-AC-006 | Có cross-module patterns: notification deep link, dashboard quick action, dirty form guard, scope empty |
| UI09-AC-007 | Có responsive behavior desktop/tablet/mobile cho từng module |
| UI09-AC-008 | Có component mapping với UI-05 Design System |
| UI09-AC-009 | Có API mapping tổng quan với API-02 -> API-09 |
| UI09-AC-010 | Có Figma frame list ưu tiên P0/P1/P2 |
| UI09-AC-011 | Có handoff notes cho Frontend và Backend/API |
| UI09-AC-012 | Có QA checklist theo module, permission, scope, responsive và accessibility |
| UI09-AC-013 | Tài liệu đủ để UI/UX Designer dựng high-fidelity và Frontend triển khai screen MVP |

---

## 23. Thứ tự triển khai đề xuất

### Sprint UI-09.1 - Core Employee daily flow

1. Login.
2. Home -> mở ATT/LEAVE/TASK/NOTI.
3. Attendance Today.
4. My Attendance Records.
5. My Leave Balance.
6. Create Leave Request.
7. My Tasks.
8. Notification Dropdown.

### Sprint UI-09.2 - Manager/HR approval flow

1. Leave Approval List.
2. Leave Approval Detail.
3. Attendance Adjustment Approval.
4. Team Attendance Records.
5. Task Team/List.
6. Employee List.
7. Employee Detail.

### Sprint UI-09.3 - HR administration

1. Employee Create/Edit.
2. My Profile.
3. Profile Change Request Form.
4. Profile Change Approval.
5. Department/Position.
6. Contract list/detail.
7. Employee Code Config.

### Sprint UI-09.4 - Task workspace

1. Task Detail.
2. Kanban Board.
3. Task Create/Edit.
4. Project List.
5. Project Detail.
6. Project Members.
7. Task Reports basic.

### Sprint UI-09.5 - System/Notification administration

1. User List/Detail.
2. Role List.
3. Permission Matrix.
4. Module Catalog.
5. Audit Logs.
6. Notification List/Detail.
7. Notification Template/Event UI.

### Sprint UI-09.6 - Responsive, accessibility and handoff

1. Mobile responsive cho P0 screens.
2. Tablet annotation.
3. Accessibility pass.
4. Empty/error/forbidden state.
5. Prototype links.
6. Frontend route registry.
7. QA checklist final.

---

## 24. Kết luận

UI-09 chốt thiết kế chi tiết các màn nghiệp vụ cốt lõi của MVP.

Tư duy triển khai chính:

```text
Module Workspace làm khung chung
-> Mỗi module có sidebar và screen riêng
-> Mỗi screen dùng template chuẩn
-> Permission + data scope quyết định UI
-> Business rule do backend kiểm tra
-> Action quan trọng gọi API module gốc
-> Notification và Dashboard chỉ điều hướng/tổng hợp
-> State, responsive, accessibility và QA phải đầy đủ
```

Sau UI-09, bước tiếp theo nên triển khai:

```text
UI-10: Prototype & Frontend Handoff Guide
```

UI-10 sẽ đóng gói clickable prototype, interaction annotation, route metadata, component mapping, API integration notes, responsive annotation và checklist bàn giao cuối cùng cho Frontend/QA.
