# UI-04: SCREEN LIST & WIREFRAME PLAN
# DANH SÁCH MÀN HÌNH MVP & KẾ HOẠCH ƯU TIÊN WIREFRAME

> **📚 Bộ tài liệu UI — Hệ thống Quản lý Doanh nghiệp**
> [UI-01 Tổng quan](<UI-01_UIUX_Design_Tong_Quan.md>) · [UI-02 IA/Sitemap](<UI-02_Information_Architecture_Sitemap.md>) · [UI-03 User Flow](<UI-03_User_Flow_MVP.md>) · **UI-04 Screen List** · [UI-05 Design System](<UI-05_Design_System_Component_Library.md>) · [UI-06 Home/App Switcher](<UI-06_Home_Portal_App_Switcher_UI_Design.md>) · [UI-07 Module Workspace](<UI-07_Module_Workspace_Template_Design.md>) · [UI-08 Dashboard](<UI-08_Dashboard_UIUX_Design.md>) · [UI-09 Module UI](<UI-09_Module_UI_Design.md>) · [UI-10 Prototype/Handoff](<UI-10_Prototype_Frontend_Handoff_Guide.md>)
>
> **Liên quan:** [Sản phẩm: PRD-00](<../PRD/PRD-00 Enterprise Management System .md>) · [Đặc tả: SPEC-01 Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | UI-04 |
| Tên tài liệu | Screen List & Wireframe Plan |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01, UI-02, UI-03 |
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

Tài liệu UI-04 xác định **toàn bộ danh sách màn hình MVP** và **kế hoạch ưu tiên wireframe** cho hệ thống quản lý doanh nghiệp nội bộ.

UI-04 dùng để:

1. Chốt danh sách màn hình cần thiết kế trong MVP.
2. Gán mã màn hình chuẩn cho từng screen.
3. Xác định route, layout, actor, permission, data scope và trạng thái UI chính.
4. Phân loại mức ưu tiên wireframe: Must-have, Should-have, Could-have, Later.
5. Xác định thứ tự thiết kế wireframe để UI/UX Designer triển khai nhanh nhất.
6. Làm cơ sở cho UI-05 Design System, UI-06 Home Portal, UI-07 Module Workspace, UI-08 Dashboard và UI-09 Module UI Design.
7. Làm checklist cho Frontend, Backend và QA khi xây dựng MVP.

UI-04 không đi sâu vào giao diện high-fidelity cuối cùng. Tài liệu này tập trung vào **screen inventory**, **wireframe scope**, **layout skeleton**, **trạng thái màn hình** và **độ ưu tiên thiết kế**.

---

## 3. Căn cứ thiết kế

UI-04 bám theo các quyết định đã chốt trong bộ tài liệu UI trước đó:

1. Sau đăng nhập, người dùng vào **Home Portal** trước.
2. Từ Home Portal, người dùng chọn app/module để vào **Module Workspace**.
3. Trong mọi màn hình protected, người dùng có thể bấm nút **Ứng dụng** để mở **App Switcher**.
4. Module Workspace có sidebar riêng theo từng module.
5. Topbar dùng chung toàn hệ thống.
6. App, menu, route, button, quick action, badge và widget phải hiển thị theo permission và data scope.
7. Frontend chỉ hỗ trợ ẩn/hiện để cải thiện UX; backend vẫn là lớp kiểm tra quyền cuối cùng.
8. Home Portal và Dashboard không xử lý nghiệp vụ gốc. Các thao tác như check-in, tạo đơn nghỉ, duyệt đơn, cập nhật task, mark read notification phải gọi API module gốc.
9. Notification deep link và dashboard quick action phải điều hướng về module nghiệp vụ gốc để kiểm tra quyền và business rule lại.

---

## 4. Phạm vi UI-04 MVP

### 4.1 Module thuộc phạm vi screen list MVP

| Module code | Tên module | Có thiết kế screen MVP | Ghi chú |
| --- | --- | --- | --- |
| AUTH | Tài khoản, đăng nhập & phân quyền | Có | Login, forgot/reset password, account, user/role/permission admin |
| FOUNDATION | Hệ thống nền tảng | Có | Home Portal, App Switcher, settings, audit, module catalog |
| DASH | Dashboard | Có | Dashboard theo vai trò và widget |
| HR | Nhân sự | Có | Nhân viên, hồ sơ của tôi, yêu cầu sửa hồ sơ, phòng ban, chức vụ, hợp đồng |
| ATT | Chấm công | Có | Today, bảng công, điều chỉnh công, remote work, ca/rule |
| LEAVE | Nghỉ phép | Có | Số dư phép, đơn nghỉ, duyệt, lịch nghỉ, chính sách |
| TASK | Công việc & dự án | Có | Project, task, Kanban, comment, checklist, report |
| NOTI | Thông báo | Có | Dropdown, unread count, list, detail, config |

### 4.2 Module chỉ để placeholder trong MVP

| Module code | Tên module | UI behavior MVP |
| --- | --- | --- |
| PAYROLL | Tiền lương | Ẩn mặc định hoặc hiển thị Coming soon cho Admin/Super Admin |
| RECRUIT | Tuyển dụng | Ẩn mặc định hoặc Coming soon |
| ASSET | Tài sản | Ẩn mặc định hoặc Coming soon |
| ROOM | Phòng họp | Ẩn mặc định hoặc Coming soon |
| CHAT | Chat nội bộ | Ẩn mặc định hoặc Coming soon |
| SOCIAL | Mạng xã hội nội bộ | Ẩn mặc định hoặc Coming soon |
| AI | AI & Automation | Ẩn mặc định hoặc Coming soon |

---

## 5. Quy ước mã màn hình

> **Nguồn chuẩn screen code:** [UI-09 Module UI Design](<UI-09_Module_UI_Design.md>) là registry canonical cho screen code, route và taxonomy prefix của các màn nghiệp vụ (AUTH/ACCOUNT/SYSTEM, HR, ATT, LEAVE, TASK, NOTI, FOUNDATION). UI-04 phản chiếu theo UI-09; các nhóm chỉ có ở UI-04 (HOME/Layout, DASH, ERROR/State) do UI-04 tự quản. Route triển khai được chốt cuối cùng ở FRONTEND-03.

### 5.1 Format mã screen

```text
UI-{MODULE}-SCREEN-{NUMBER}
```

Ví dụ:

```text
UI-AUTH-SCREEN-001: Đăng nhập
UI-HOME-SCREEN-001: Home Portal
UI-ATT-SCREEN-001: Chấm công hôm nay
UI-LEAVE-SCREEN-004: Tạo đơn nghỉ phép
UI-TASK-SCREEN-006: Kanban Board
```

### 5.2 Module prefix dùng trong UI screen code

| Prefix | Ý nghĩa |
| --- | --- |
| UI-AUTH | Đăng nhập, khôi phục mật khẩu |
| UI-HOME | Home Portal và App Switcher |
| UI-LAYOUT | Layout dùng chung: topbar, sidebar, workspace, error state |
| UI-DASH | Dashboard |
| UI-HR | Nhân sự |
| UI-ATT | Chấm công |
| UI-LEAVE | Nghỉ phép |
| UI-TASK | Công việc & dự án |
| UI-NOTI | Thông báo |
| UI-SYSTEM | Quản trị user/role/permission/security |
| UI-FOUNDATION | Cấu hình nền hệ thống: company, modules, settings, files, audit, holidays, sequences |
| UI-ACCOUNT | Tài khoản cá nhân |
| UI-ERROR | Error/empty/forbidden/maintenance |

### 5.3 Trạng thái screen

| Trạng thái | Ý nghĩa |
| --- | --- |
| Required | Bắt buộc có trong MVP |
| Recommended | Nên có trong MVP, có thể tối giản nếu thiếu thời gian |
| Optional | Có thể wireframe low-fi, triển khai sau nếu cần |
| Later | Không thuộc MVP, chỉ ghi nhận để mở rộng |

---

## 6. Mức ưu tiên wireframe

### 6.1 Priority level

| Mức | Tên | Ý nghĩa | Bắt buộc wireframe |
| --- | --- | --- | --- |
| P0 | Critical MVP | Luồng sống còn, không có thì MVP không chạy được | Bắt buộc high-priority wireframe |
| P1 | Core MVP | Màn hình nghiệp vụ chính, cần cho vận hành MVP | Bắt buộc wireframe |
| P2 | Supporting MVP | Màn hình hỗ trợ, quản trị, cấu hình, báo cáo cơ bản | Wireframe low/mid fidelity |
| P3 | Nice to have | Có thể để sau khi core flow ổn định | Optional |
| P4 | Later phase | Module/flow không thuộc MVP | Không wireframe chi tiết trong UI-04 |

### 6.2 Nguyên tắc chọn P0

Một màn hình được xếp P0 nếu thuộc ít nhất một nhóm sau:

1. Người dùng bắt buộc đi qua để vào hệ thống.
2. Là layout nền tảng dùng bởi nhiều màn hình khác.
3. Thuộc flow hằng ngày của Employee: chấm công, xin nghỉ, xem task, nhận notification.
4. Thuộc flow xử lý của Manager/HR: duyệt nghỉ, xem bảng công, xử lý yêu cầu.
5. Nếu thiếu màn hình này, prototype MVP không thể demo được luồng chính.

### 6.3 Nguyên tắc chọn P1

Một màn hình được xếp P1 nếu:

1. Là màn hình danh sách/chi tiết cốt lõi của module.
2. Cần cho HR/Manager/Admin vận hành hệ thống thật.
3. Có nhiều trạng thái dữ liệu cần thiết kế rõ.
4. Là điểm deep link phổ biến từ dashboard hoặc notification.

---

## 7. Tổng quan số lượng màn hình MVP

| Nhóm | P0 | P1 | P2 | P3 | Tổng |
| --- | ---: | ---: | ---: | ---: | ---: |
| AUTH / Account | 1 | 4 | 1 | 0 | 6 |
| HOME / Layout | 5 | 2 | 4 | 2 | 13 |
| DASH | 1 | 4 | 3 | 1 | 9 |
| HR | 5 | 7 | 5 | 0 | 17 |
| ATT | 3 | 10 | 2 | 0 | 15 |
| LEAVE | 6 | 5 | 2 | 0 | 13 |
| TASK | 4 | 6 | 2 | 0 | 12 |
| NOTI | 2 | 1 | 5 | 0 | 8 |
| SYSTEM (user/role/RBAC) | 3 | 4 | 2 | 0 | 9 |
| FOUNDATION (cấu hình nền) | 0 | 6 | 2 | 0 | 8 |
| ERROR / STATE | 2 | 4 | 3 | 0 | 9 |
| **Tổng** | **32** | **53** | **31** | **3** | **119** |

Lưu ý: Không phải toàn bộ 119 màn hình đều cần thiết kế high-fidelity trong MVP. UI-04 dùng số lượng này để kiểm soát phạm vi. Wireframe ưu tiên sẽ tập trung P0 + P1 trước.

---

## 8. Danh sách màn hình P0 cần wireframe đầu tiên

| Thứ tự | Mã screen | Tên màn hình | Route/Entry | Module | Actor chính | Lý do ưu tiên |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | UI-AUTH-SCREEN-001 | Đăng nhập | `/login` | AUTH | Tất cả | Cổng vào hệ thống |
| 2 | UI-HOME-SCREEN-001 | Home Portal | `/home` | HOME | Tất cả | Màn đầu sau login |
| 3 | UI-HOME-SCREEN-002 | App Switcher Overlay | Global topbar | HOME | Tất cả | Chuyển app từ mọi màn protected |
| 4 | UI-LAYOUT-SCREEN-001 | Module Workspace Layout | `/{module}/*` | LAYOUT | Tất cả | Template nền cho mọi module |
| 5 | UI-LAYOUT-SCREEN-002 | Global Topbar | Protected area | LAYOUT | Tất cả | App switcher, notification, avatar |
| 6 | UI-LAYOUT-SCREEN-003 | Module Sidebar | Protected module | LAYOUT | Tất cả | Điều hướng trong module |
| 7 | UI-DASH-SCREEN-001 | Dashboard mặc định | `/dashboard` | DASH | Tất cả | Tổng quan theo role |
| 8 | UI-ATT-SCREEN-001 | Chấm công hôm nay | `/attendance/today` | ATT | EMP | Check-in/check-out hằng ngày |
| 9 | UI-ATT-SCREEN-002 | Bảng công của tôi | `/attendance/my-records` | ATT | EMP | Tra cứu công cá nhân |
| 10 | UI-LEAVE-SCREEN-003 | Đơn nghỉ của tôi | `/leave/me/requests` | LEAVE | EMP | Entry chính nghỉ phép |
| 11 | UI-LEAVE-SCREEN-004 | Tạo đơn nghỉ phép | `/leave/requests/new` | LEAVE | EMP | Flow xin nghỉ cốt lõi |
| 12 | UI-LEAVE-SCREEN-006 | Duyệt/từ chối đơn nghỉ | `/leave/approvals` | LEAVE | MGR/HR | Flow phê duyệt cốt lõi |
| 13 | UI-TASK-SCREEN-002 | Việc của tôi | `/tasks/my-tasks` | TASK | EMP/MGR | Flow xem việc hằng ngày |
| 14 | UI-TASK-SCREEN-005 | Chi tiết task | `/tasks/:id` | TASK | EMP/MGR | Update status, comment, checklist |
| 15 | UI-TASK-SCREEN-006 | Kanban Board | `/tasks/kanban` | TASK | EMP/MGR | Theo dõi tiến độ trực quan |
| 16 | UI-NOTI-SCREEN-001 | Notification dropdown | Global topbar | NOTI | Tất cả | Unread count, xử lý nhanh |
| 17 | UI-NOTI-SCREEN-002 | Danh sách thông báo | `/notifications` | NOTI | Tất cả | Lịch sử notification |
| 18 | UI-NOTI-SCREEN-003 | Chi tiết thông báo + deep link | `/notifications/:id` | NOTI | Tất cả | Điều hướng về module gốc |
| 19 | UI-HR-SCREEN-006 | Hồ sơ của tôi | `/hr/me` | HR | EMP | Self-service cá nhân |
| 20 | UI-HR-SCREEN-002 | Danh sách nhân viên | `/hr/employees` | HR | HR/MGR | Core HR operation |
| 21 | UI-ERROR-SCREEN-001 | Forbidden state / 403 | `/403` hoặc inline | ERROR | Tất cả | Bắt buộc cho permission guard |
| 22 | UI-ERROR-SCREEN-002 | Empty/loading/error state dùng chung | Component state | ERROR | Tất cả | Bắt buộc cho list/form/widget |

---

# PHẦN A: SCREEN LIST THEO NHÓM LAYOUT

---

## 9. AUTH / Account screen list

### 9.1 AUTH public screens

| Mã screen | Tên màn hình | Route | Layout | Actor | Priority | Trạng thái | Wireframe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-AUTH-SCREEN-001 | Đăng nhập | `/login` | Auth Layout | Tất cả | P0 | Required | High |
| UI-AUTH-SCREEN-002 | Quên mật khẩu | `/forgot-password` | Auth Layout | Tất cả | P1 | Required | Mid |
| UI-AUTH-SCREEN-003 | Đặt lại mật khẩu | `/reset-password` | Auth Layout | Tất cả | P1 | Required | Mid |
| UI-AUTH-SCREEN-004 | Đăng xuất / session expired | Action/State | Auth/System | Tất cả | P1 | Required | Low |

### 9.2 Account self-service screens

| Mã screen | Tên màn hình | Route | Layout | Actor | Priority | Trạng thái | Wireframe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-ACCOUNT-SCREEN-001 | Hồ sơ tài khoản | `/account/profile` | Account/Workspace | Tất cả | P1 | Required | Mid |
| UI-ACCOUNT-SCREEN-002 | Đổi mật khẩu | `/account/change-password` | Account/Workspace | Tất cả | P1 | Required | Mid |
| UI-ACCOUNT-SCREEN-003 | Phiên đăng nhập của tôi | `/account/sessions` | Account/Workspace | Tất cả | P2 | Recommended | Low |

> **Đồng bộ UI-09 (canonical):** Khớp ACCOUNT với [UI-09 §7.2](<UI-09_Module_UI_Design.md>); *Cập nhật hồ sơ tài khoản* gộp vào Hồ sơ tài khoản (`/account/profile`).

### 9.3 SYSTEM (AUTH/RBAC) admin screens — quản trị user & role

> Theo taxonomy UI-09: prefix `UI-AUTH-SCREEN-*` chỉ dùng cho đăng nhập/khôi phục mật khẩu; quản trị user/role/permission/security dùng prefix `UI-SYSTEM-SCREEN-*`.

| Mã screen | Tên màn hình | Route | Layout | Actor | Priority | Trạng thái | Wireframe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-SYSTEM-SCREEN-001 | Danh sách user | `/system/users` | Module Workspace/List | Admin/HR nếu được cấp | P0 | Required | High |
| UI-SYSTEM-SCREEN-002 | Chi tiết user | `/system/users/:id` | Module Workspace/Detail | Admin | P1 | Required | Mid |
| UI-SYSTEM-SCREEN-003 | Tạo/Sửa user | `/system/users/new`, `/system/users/:id/edit` | Module Workspace/Form | Admin | P1 | Required | Mid |
| UI-SYSTEM-SCREEN-004 | Danh sách role | `/system/roles` | Module Workspace/List | Admin | P0 | Required | High |
| UI-SYSTEM-SCREEN-005 | Chi tiết/Sửa role | `/system/roles/:id` | Module Workspace/Settings | Admin | P1 | Required | Mid |
| UI-SYSTEM-SCREEN-006 | Permission matrix | `/system/roles/:id/permissions` | Module Workspace/Matrix | Admin | P0 | Required | High |
| UI-SYSTEM-SCREEN-007 | Gán role cho user | `/system/users/:id/roles` | Module Workspace/Form | Admin | P1 | Required | Mid |
| UI-SYSTEM-SCREEN-008 | Nhật ký đăng nhập | `/system/login-logs` | Module Workspace/List | Admin/Security | P2 | Recommended | Low |
| UI-SYSTEM-SCREEN-009 | Sự kiện bảo mật | `/system/security-events` | Module Workspace/List | Admin/Security | P2 | Recommended | Low |

> **Đồng bộ UI-09 (canonical):** Khớp với [UI-09 §7.2](<UI-09_Module_UI_Design.md>). Mã chuyển từ `UI-AUTH-SCREEN-005..011` sang `UI-SYSTEM-SCREEN-001..009`; bổ sung *Nhật ký đăng nhập*, *Sự kiện bảo mật*.

---

## 10. HOME / App Switcher / Layout screen list

### 10.1 Home Portal screens

| Mã screen | Tên màn hình | Route/Entry | Layout | Actor | Priority | Trạng thái | Wireframe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-HOME-SCREEN-001 | Home Portal app grid | `/home` | Home Portal | Tất cả | P0 | Required | High |
| UI-HOME-SCREEN-002 | App Switcher Overlay | Topbar button | Overlay | Tất cả | P0 | Required | High |
| UI-HOME-SCREEN-003 | Home app search state | `/home`, App Switcher | Home/Overlay | Tất cả | P1 | Required | Mid |
| UI-HOME-SCREEN-004 | Recent/Favorite apps | `/home/recent`, `/home/favorites` | Home Portal | Tất cả | P2 | Recommended | Low |
| UI-HOME-SCREEN-005 | Locked/coming soon app state | Home/App Switcher | Home/Overlay | Tất cả | P2 | Recommended | Low |

### 10.2 Shared layout screens

| Mã screen | Tên màn hình | Entry | Layout | Actor | Priority | Trạng thái | Wireframe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-LAYOUT-SCREEN-001 | Module Workspace Layout | `/{module}/*` | Module Workspace | Tất cả | P0 | Required | High |
| UI-LAYOUT-SCREEN-002 | Global Topbar | Protected app shell | Topbar | Tất cả | P0 | Required | High |
| UI-LAYOUT-SCREEN-003 | Module Sidebar expanded/collapsed | Protected module | Sidebar | Tất cả | P0 | Required | High |
| UI-LAYOUT-SCREEN-004 | Page header + breadcrumb + actions | Protected module | Component | Tất cả | P1 | Required | Mid |
| UI-LAYOUT-SCREEN-005 | Filter bar / search / sort pattern | List pages | Component | Tất cả | P1 | Required | Mid |
| UI-LAYOUT-SCREEN-006 | Table list pattern | List pages | Component | Tất cả | P1 | Required | Mid |
| UI-LAYOUT-SCREEN-007 | Form page pattern | Create/Edit pages | Component | Tất cả | P1 | Required | Mid |
| UI-LAYOUT-SCREEN-008 | Detail drawer pattern | Detail/quick view | Drawer | Tất cả | P2 | Recommended | Low |

---

## 11. DASH screen list

| Mã screen | Tên màn hình | Route | Layout | Actor | Priority | Trạng thái | Wireframe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-DASH-SCREEN-001 | Dashboard mặc định của user | `/dashboard` | Module Workspace | Tất cả | P0 | Required | High |
| UI-DASH-SCREEN-002 | Employee Dashboard | `/dashboard/employee` | Module Workspace | EMP | P1 | Required | Mid |
| UI-DASH-SCREEN-003 | Manager Dashboard | `/dashboard/manager` | Module Workspace | MGR | P1 | Required | Mid |
| UI-DASH-SCREEN-004 | HR Dashboard | `/dashboard/hr` | Module Workspace | HR | P1 | Required | Mid |
| UI-DASH-SCREEN-005 | Admin Dashboard | `/dashboard/admin` | Module Workspace | ADMIN/SA | P1 | Required | Mid |
| UI-DASH-SCREEN-006 | Widget catalog | `/dashboard/widgets` | Module Workspace | ADMIN/HR | P2 | Recommended | Low |
| UI-DASH-SCREEN-007 | Dashboard config list | `/dashboard/configs` | Module Workspace | ADMIN/SA | P2 | Recommended | Low |
| UI-DASH-SCREEN-008 | Edit dashboard config | `/dashboard/configs/:id/edit` | Module Workspace/Form | ADMIN/SA | P2 | Recommended | Low |
| UI-DASH-SCREEN-009 | Widget error/empty/fallback state | Widget area | Component | Tất cả | P1 | Required | Mid |

---

## 12. HR screen list

| Mã screen | Tên màn hình | Route | Layout | Actor | Priority | Trạng thái | Wireframe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-HR-SCREEN-001 | HR Overview | `/hr` | Module Workspace/Overview | HR/Manager/Admin | P1 | Required | Mid |
| UI-HR-SCREEN-002 | Danh sách nhân viên | `/hr/employees` | Module Workspace/List | HR/Manager | P0 | Required | High |
| UI-HR-SCREEN-003 | Tạo nhân viên | `/hr/employees/new` | Module Workspace/Form | HR/Admin | P0 | Required | High |
| UI-HR-SCREEN-004 | Chi tiết nhân viên | `/hr/employees/:id` | Module Workspace/Detail | HR/Manager/Employee scope | P0 | Required | High |
| UI-HR-SCREEN-005 | Sửa hồ sơ nhân viên | `/hr/employees/:id/edit` | Module Workspace/Form | HR/Admin | P1 | Required | Mid |
| UI-HR-SCREEN-006 | Hồ sơ của tôi | `/hr/me` | Module Workspace/Detail | Employee | P0 | Required | High |
| UI-HR-SCREEN-007 | Gửi yêu cầu sửa hồ sơ | `/hr/me/change-request` | Module Workspace/Form | Employee | P0 | Required | High |
| UI-HR-SCREEN-008 | Danh sách yêu cầu cập nhật hồ sơ | `/hr/profile-change-requests` | Module Workspace/List | HR/Admin | P1 | Required | Mid |
| UI-HR-SCREEN-009 | Chi tiết/duyệt yêu cầu cập nhật | `/hr/profile-change-requests/:id` | Module Workspace/Approval | HR/Admin/Owner | P1 | Required | Mid |
| UI-HR-SCREEN-010 | Phòng ban | `/hr/departments` | Module Workspace/Tree | HR/Admin | P1 | Required | Mid |
| UI-HR-SCREEN-011 | Chức vụ | `/hr/positions` | Module Workspace/List | HR/Admin | P2 | Recommended | Low |
| UI-HR-SCREEN-012 | Cấp bậc | `/hr/job-levels` | Module Workspace/List | HR/Admin | P2 | Recommended | Low |
| UI-HR-SCREEN-013 | Loại hợp đồng | `/hr/contract-types` | Module Workspace/List | HR/Admin | P2 | Recommended | Low |
| UI-HR-SCREEN-014 | Hợp đồng nhân viên | `/hr/contracts` | Module Workspace/List | HR/Admin | P1 | Required | Mid |
| UI-HR-SCREEN-015 | Cấu hình mã nhân viên | `/hr/settings/employee-code` | Module Workspace/Settings | HR/Admin | P1 | Required | Mid |
| UI-HR-SCREEN-016 | Sơ đồ tổ chức | `/hr/org-chart` | Module Workspace/Tree | HR/Manager | P2 | Recommended | Low |
| UI-HR-SCREEN-017 | HR Audit Logs | `/hr/audit-logs` | Module Workspace/List | HR/Admin | P2 | Recommended | Low |

> **Đồng bộ UI-09 (canonical):** Khớp với [UI-09 §8.3](<UI-09_Module_UI_Design.md>). Các pseudo-screen cũ (Hợp đồng theo tab nhân viên, Upload/quản lý file hồ sơ, Field masking state, Export employee modal) là component/state thuộc Chi tiết nhân viên (UI-05 / UI-09 §8).

---

## 13. ATT screen list

| Mã screen | Tên màn hình | Route | Layout | Actor | Priority | Trạng thái | Wireframe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-ATT-SCREEN-001 | Chấm công hôm nay | `/attendance/today` | Module Workspace/Status | Employee | P0 | Required | High |
| UI-ATT-SCREEN-002 | Bảng công của tôi | `/attendance/my-records` | Module Workspace/List | Employee | P0 | Required | High |
| UI-ATT-SCREEN-003 | Bảng công team | `/attendance/team-records` | Module Workspace/List | Manager | P1 | Required | Mid |
| UI-ATT-SCREEN-004 | Bảng công công ty | `/attendance/records` | Module Workspace/List | HR/Admin | P1 | Required | Mid |
| UI-ATT-SCREEN-005 | Chi tiết ngày công | `/attendance/records/:id` | Module Workspace/Detail | Employee/Manager/HR | P1 | Required | Mid |
| UI-ATT-SCREEN-006 | Tạo yêu cầu điều chỉnh công | `/attendance/adjustment-requests/new` | Module Workspace/Form | Employee | P0 | Required | High |
| UI-ATT-SCREEN-007 | Danh sách yêu cầu điều chỉnh công | `/attendance/adjustment-requests` | Module Workspace/List | Employee/Manager/HR | P1 | Required | Mid |
| UI-ATT-SCREEN-008 | Chi tiết/duyệt điều chỉnh công | `/attendance/adjustment-requests/:id` | Module Workspace/Approval | Manager/HR | P1 | Required | Mid |
| UI-ATT-SCREEN-009 | Remote/Công tác | `/attendance/remote-work-requests` | Module Workspace/List | Employee/Manager/HR | P1 | Required | Mid |
| UI-ATT-SCREEN-010 | Tạo remote/công tác | `/attendance/remote-work-requests/new` | Module Workspace/Form | Employee | P1 | Required | Mid |
| UI-ATT-SCREEN-011 | Ca làm việc | `/attendance/shifts` | Module Workspace/Settings | HR/Admin | P1 | Required | Mid |
| UI-ATT-SCREEN-012 | Gán ca | `/attendance/shift-assignments` | Module Workspace/Settings | HR/Admin | P1 | Required | Mid |
| UI-ATT-SCREEN-013 | Rule chấm công | `/attendance/rules` | Module Workspace/Settings | HR/Admin | P1 | Required | Mid |
| UI-ATT-SCREEN-014 | Báo cáo chấm công | `/attendance/reports` | Module Workspace/Report | HR/Manager | P2 | Recommended | Low |
| UI-ATT-SCREEN-015 | Audit chấm công | `/attendance/audit-logs` | Module Workspace/List | HR/Admin | P2 | Recommended | Low |

> **Đồng bộ UI-09 (canonical):** Khớp với [UI-09 §9.3](<UI-09_Module_UI_Design.md>). Các state cũ (Modal xác nhận check-in/out, GPS/location permission, Leave/Remote blocking) là state của Chấm công hôm nay (UI-ATT-SCREEN-001), không tính là screen riêng.

---

## 14. LEAVE screen list

| Mã screen | Tên màn hình | Route | Layout | Actor | Priority | Trạng thái | Wireframe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-LEAVE-SCREEN-001 | Tổng quan nghỉ phép | `/leave` | Module Workspace/Overview | Employee/Manager/HR | P1 | Required | Mid |
| UI-LEAVE-SCREEN-002 | Số dư phép của tôi | `/leave/me/balances` | Module Workspace/List | Employee | P0 | Required | High |
| UI-LEAVE-SCREEN-003 | Đơn nghỉ của tôi | `/leave/me/requests` | Module Workspace/List | Employee | P0 | Required | High |
| UI-LEAVE-SCREEN-004 | Tạo đơn nghỉ | `/leave/requests/new` | Module Workspace/Form | Employee | P0 | Required | High |
| UI-LEAVE-SCREEN-005 | Chi tiết đơn nghỉ | `/leave/requests/:id` | Module Workspace/Detail | Owner/Manager/HR | P0 | Required | High |
| UI-LEAVE-SCREEN-006 | Đơn chờ duyệt | `/leave/approvals` | Module Workspace/Approval | Manager/HR | P0 | Required | High |
| UI-LEAVE-SCREEN-007 | Duyệt/Từ chối đơn | `/leave/approvals/:id` | Module Workspace/Approval | Manager/HR | P0 | Required | High |
| UI-LEAVE-SCREEN-008 | Lịch nghỉ | `/leave/calendar` | Module Workspace/Calendar | Employee/Manager/HR | P1 | Required | Mid |
| UI-LEAVE-SCREEN-009 | Loại nghỉ | `/leave/types` | Module Workspace/Settings | HR/Admin | P1 | Required | Mid |
| UI-LEAVE-SCREEN-010 | Chính sách nghỉ | `/leave/policies` | Module Workspace/Settings | HR/Admin | P1 | Required | Mid |
| UI-LEAVE-SCREEN-011 | Số dư phép nhân viên | `/leave/balances` | Module Workspace/List | HR/Admin | P1 | Required | Mid |
| UI-LEAVE-SCREEN-012 | Lịch sử số dư phép | `/leave/balances/:id/transactions` | Module Workspace/List | HR/Admin | P2 | Recommended | Low |
| UI-LEAVE-SCREEN-013 | Báo cáo nghỉ phép | `/leave/reports` | Module Workspace/Report | HR/Manager | P2 | Recommended | Low |

> **Đồng bộ UI-09 (canonical):** Khớp với [UI-09 §10.3](<UI-09_Module_UI_Design.md>). Các state/modal cũ (Modal tính thử số ngày, Modal approve/reject, Conflict/balance warning, File attachment, Cancel confirm) là state/component của Tạo đơn (004) và Duyệt đơn (007); *Lịch sử thao tác LEAVE* gộp vào audit chung.

---

## 15. TASK screen list

| Mã screen | Tên màn hình | Route | Layout | Actor | Priority | Trạng thái | Wireframe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-TASK-SCREEN-001 | Tổng quan công việc | `/tasks` | Module Workspace/Overview | Employee/Manager | P1 | Required | Mid |
| UI-TASK-SCREEN-002 | Việc của tôi | `/tasks/my-tasks` | Module Workspace/List | Employee | P0 | Required | High |
| UI-TASK-SCREEN-003 | Danh sách task | `/tasks/list` | Module Workspace/List | Employee/Manager | P0 | Required | High |
| UI-TASK-SCREEN-004 | Tạo task | `/tasks/new` | Module Workspace/Form | Manager/Employee nếu được cấp | P1 | Required | Mid |
| UI-TASK-SCREEN-005 | Chi tiết task | `/tasks/:id` | Module Workspace/Detail | Assignee/Watcher/Manager | P0 | Required | High |
| UI-TASK-SCREEN-006 | Kanban board | `/tasks/kanban` | Module Workspace/Kanban | Team/Project member | P0 | Required | High |
| UI-TASK-SCREEN-007 | Danh sách dự án | `/tasks/projects` | Module Workspace/List | Employee/Manager | P1 | Required | Mid |
| UI-TASK-SCREEN-008 | Tạo dự án | `/tasks/projects/new` | Module Workspace/Form | Manager/Admin | P1 | Required | Mid |
| UI-TASK-SCREEN-009 | Chi tiết dự án | `/tasks/projects/:id` | Module Workspace/Detail | Project member | P1 | Required | Mid |
| UI-TASK-SCREEN-010 | Thành viên dự án | `/tasks/projects/:id/members` | Module Workspace/List | Project owner/manager | P1 | Required | Mid |
| UI-TASK-SCREEN-011 | Báo cáo task/project | `/tasks/reports` | Module Workspace/Report | Manager | P2 | Recommended | Low |
| UI-TASK-SCREEN-012 | Activity log | `/tasks/activity` | Module Workspace/List | Manager/Admin | P2 | Recommended | Low |

> **Đồng bộ UI-09 (canonical):** Khớp screen code/route với [UI-09 §11.3](<UI-09_Module_UI_Design.md>). Mục cũ của UI-04 được hợp nhất: *Task được giao cho tôi* / *Task tôi tạo* → view-mode của Việc của tôi (`/tasks/my-tasks`); *Cập nhật task* → thao tác trong Chi tiết task; *Kanban dự án* / *Thiết lập dự án* → trong Chi tiết dự án; *Comment thread* / *Checklist* → component (UI-05 / UI-09 §16).

---

## 16. NOTI screen list

| Mã screen | Tên màn hình | Route/Entry | Layout | Actor | Priority | Trạng thái | Wireframe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-NOTI-SCREEN-001 | Notification dropdown | Topbar popover | Topbar/Overlay | Tất cả | P0 | Required | High |
| UI-NOTI-SCREEN-002 | Danh sách thông báo của tôi | `/notifications` | Module Workspace/List | Tất cả | P0 | Required | High |
| UI-NOTI-SCREEN-003 | Chi tiết thông báo | `/notifications/:id` | Module Workspace/Detail | Owner | P1 | Required | Mid |
| UI-NOTI-SCREEN-004 | Notification events | `/notifications/events` | Module Workspace/Settings | Admin | P2 | Recommended | Low |
| UI-NOTI-SCREEN-005 | Notification templates | `/notifications/templates` | Module Workspace/Settings | Admin | P2 | Recommended | Low |
| UI-NOTI-SCREEN-006 | Delivery logs | `/notifications/delivery-logs` | Module Workspace/List | Admin | P2 | Recommended | Low |
| UI-NOTI-SCREEN-007 | Gửi thông báo hệ thống | `/notifications/system/new` | Module Workspace/Form | Admin/Super Admin | P2 | Recommended | Low |
| UI-NOTI-SCREEN-008 | Notification settings | `/notifications/settings` | Module Workspace/Settings | Admin | P2 | Recommended | Low |

> **Đồng bộ UI-09 (canonical):** Khớp với [UI-09 §12.3](<UI-09_Module_UI_Design.md>). Các state cũ (Mark all read, Empty notification, Permission denied) là state của dropdown/list; *Audit NOTI* gộp vào delivery/audit chung. ⚠️ Route admin notification (`/notifications/system/new`, `/notifications/events`, `/notifications/templates`) vẫn cần đối chiếu API-07 ở bước sync UI-09 ↔ API.

---

## 17. FOUNDATION (cấu hình nền hệ thống) screen list

> Prefix `UI-FOUNDATION-SCREEN-*` dùng cho cấu hình nền (company, modules, settings, files, audit, holidays, sequences). Quản trị user/role/permission/security ở §9.3 dùng prefix `UI-SYSTEM-SCREEN-*`. Taxonomy theo [UI-09 §13.2](<UI-09_Module_UI_Design.md>).

| Mã screen | Tên màn hình | Route | Layout | Actor | Priority | Trạng thái | Wireframe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-FOUNDATION-SCREEN-001 | Tổng quan hệ thống | `/system` | Module Workspace/Overview | Admin | P1 | Required | Mid |
| UI-FOUNDATION-SCREEN-002 | Thông tin công ty | `/system/company` | Module Workspace/Settings | Admin | P1 | Required | Mid |
| UI-FOUNDATION-SCREEN-003 | Module catalog | `/system/modules` | Module Workspace/List | Admin | P1 | Required | Mid |
| UI-FOUNDATION-SCREEN-004 | Cấu hình hệ thống | `/system/settings` | Module Workspace/Settings | Admin | P1 | Required | Mid |
| UI-FOUNDATION-SCREEN-005 | File metadata | `/system/files` | Module Workspace/List | Admin | P2 | Recommended | Low |
| UI-FOUNDATION-SCREEN-006 | Audit logs | `/system/audit-logs` | Module Workspace/List | Admin/Security | P1 | Required | Mid |
| UI-FOUNDATION-SCREEN-007 | Public holidays | `/system/public-holidays` | Module Workspace/Calendar | HR/Admin | P1 | Required | Mid |
| UI-FOUNDATION-SCREEN-008 | Sequence counters | `/system/sequences` | Module Workspace/Settings | Admin | P2 | Recommended | Low |

> **Đồng bộ UI-09 (canonical):** Khớp với [UI-09 §13.2](<UI-09_Module_UI_Design.md>). Mã chuyển từ `UI-SYSTEM-SCREEN-*` sang `UI-FOUNDATION-SCREEN-*`. *Danh sách permission* gộp vào Permission matrix (`UI-SYSTEM-SCREEN-006`); các section/state/modal cũ (feature flags, settings sections, export modal, audit drawer, module disabled, save confirm) là section/state/component dùng chung.

---

## 18. ERROR / Common state screen list

| Mã screen | Tên màn hình/state | Route/Entry | Layout | Actor | Priority | Trạng thái | Wireframe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-ERROR-SCREEN-001 | 403 Forbidden | `/403` hoặc inline | Error Layout | Tất cả | P0 | Required | High |
| UI-ERROR-SCREEN-002 | Loading / skeleton state | Component | Common | Tất cả | P0 | Required | High |
| UI-ERROR-SCREEN-003 | Empty state | Component | Common | Tất cả | P1 | Required | Mid |
| UI-ERROR-SCREEN-004 | API error state | Component | Common | Tất cả | P1 | Required | Mid |
| UI-ERROR-SCREEN-005 | Disabled action state | Component | Common | Tất cả | P1 | Required | Mid |
| UI-ERROR-SCREEN-006 | 404 Not Found | `/404` | Error Layout | Tất cả | P1 | Required | Mid |
| UI-ERROR-SCREEN-007 | 500 Server Error | `/500` | Error Layout | Tất cả | P1 | Required | Mid |
| UI-ERROR-SCREEN-008 | Maintenance | `/maintenance` | Error Layout | Tất cả | P2 | Recommended | Low |
| UI-ERROR-SCREEN-009 | Unsaved changes confirm | Route change/App switch | Modal | Tất cả | P1 | Required | Mid |

---

# PHẦN B: WIREFRAME PLAN

---

## 19. Nguyên tắc triển khai wireframe

### 19.1 Từ low-fi đến mid-fi

Wireframe nên triển khai theo 3 lớp:

| Lớp | Mục tiêu | Đầu ra |
| --- | --- | --- |
| Low-fi structure | Chốt layout, vùng nội dung, navigation | Khung xám/trắng, không cần visual detail |
| Mid-fi interaction | Chốt form, table, button, state, flow | Có component rõ, data giả, annotation |
| Hi-fi sau UI-05 | Áp design token, màu, typography | Thực hiện ở UI-06/UI-09 sau khi có Design System |

### 19.2 Không thiết kế tất cả màn hình cùng độ chi tiết

| Nhóm màn hình | Độ chi tiết wireframe |
| --- | --- |
| P0 | Mid-fi + annotation đầy đủ |
| P1 | Mid-fi cơ bản + state chính |
| P2 | Low-fi hoặc reuse pattern |
| P3 | Chỉ cần mô tả layout/pattern |
| P4 | Không thiết kế chi tiết trong MVP |

### 19.3 Wireframe phải có state

Mỗi màn hình P0/P1 phải có tối thiểu:

1. Default/loaded state.
2. Loading state.
3. Empty state nếu là list/widget.
4. Error state.
5. Forbidden/disabled state nếu liên quan permission.
6. Validation state nếu là form.
7. Success state nếu có submit action.

---

## 20. Sprint wireframe đề xuất

### Sprint WF-01: Layout nền tảng và điều hướng

| Thứ tự | Screen | Đầu ra |
| ---: | --- | --- |
| 1 | Login | Auth layout + error state |
| 2 | Home Portal | App grid + search + recent/favorite |
| 3 | App Switcher | Overlay + search + app groups |
| 4 | Module Workspace | Topbar + sidebar + content shell |
| 5 | Permission/error state | 403, empty, disabled, loading |

**Mục tiêu:** Chốt khung trải nghiệm tổng thể trước khi đi vào từng module.

### Sprint WF-02: Employee daily core

| Thứ tự | Screen | Đầu ra |
| ---: | --- | --- |
| 1 | Chấm công hôm nay | Check-in/check-out state |
| 2 | Bảng công của tôi | Table tháng + detail drawer |
| 3 | Đơn nghỉ của tôi | Balance card + request list |
| 4 | Tạo đơn nghỉ | Form + calculation preview |
| 5 | Việc của tôi | List/filter/task status |
| 6 | Task detail | Status, comment, checklist |
| 7 | Notification dropdown/list | Badge, unread, mark read |

**Mục tiêu:** Demo trọn flow Employee hằng ngày.

### Sprint WF-03: Manager/HR approval core

| Thứ tự | Screen | Đầu ra |
| ---: | --- | --- |
| 1 | Manager Dashboard | Pending approvals + team task |
| 2 | Leave approvals | List + approve/reject detail |
| 3 | Team attendance records | Table + filter + abnormal badge |
| 4 | Adjustment approval detail | Before/after + action |
| 5 | Employee list | Search/filter/table |
| 6 | Employee detail | Tabs + sensitive fields |

**Mục tiêu:** Demo flow quản lý xử lý team/duyệt yêu cầu.

### Sprint WF-04: Task/project workspace

| Thứ tự | Screen | Đầu ra |
| ---: | --- | --- |
| 1 | Kanban tổng | Columns + card + drag state |
| 2 | Project list | Table/card view |
| 3 | Project detail | Overview + members + tasks |
| 4 | Project board | Project Kanban |
| 5 | Create/edit task | Form + assignee + deadline |
| 6 | Comment/mention/checklist | Component detail |

**Mục tiêu:** Hoàn thiện workspace công việc/dự án.

### Sprint WF-05: Admin/System và cấu hình nền

| Thứ tự | Screen | Đầu ra |
| ---: | --- | --- |
| 1 | User list/detail | System workspace pattern |
| 2 | Role/permission matrix | Permission assignment UI |
| 3 | System settings | Setting group form |
| 4 | Module catalog | Active/disabled state |
| 5 | Audit logs | Filterable log table |
| 6 | Notification event/template | Config pattern |

**Mục tiêu:** Có đủ màn hình quản trị tối thiểu cho MVP.

### Sprint WF-06: Review, prototype và handoff

| Thứ tự | Hạng mục | Đầu ra |
| ---: | --- | --- |
| 1 | Prototype flow Login -> Home -> App | Clickable prototype |
| 2 | Prototype flow Check-in -> Check-out | Clickable prototype |
| 3 | Prototype flow Create Leave -> Approve -> Noti | Clickable prototype |
| 4 | Prototype flow Task Assigned -> Noti -> Detail | Clickable prototype |
| 5 | Responsive annotation | Desktop/tablet/mobile notes |
| 6 | Component extraction | Danh sách component cho UI-05 |
| 7 | Handoff checklist | Bàn giao frontend/backend/QA |

---

## 21. Wireframe detail cho P0 screens

### 21.1 UI-AUTH-SCREEN-001: Đăng nhập

```text
+----------------------------------------------------------+
| Logo / Product name                                      |
|                                                          |
| [Email input]                                            |
| [Password input]                                         |
| [Remember me]                         [Forgot password]  |
| [Login button]                                           |
|                                                          |
| Error/locked/company inactive message                    |
+----------------------------------------------------------+
```

Thành phần bắt buộc:

1. Email input.
2. Password input.
3. Nút đăng nhập.
4. Link quên mật khẩu.
5. Loading state.
6. Error state không tiết lộ email tồn tại hay không.
7. Redirect về `/home` hoặc `returnUrl` hợp lệ sau login.

### 21.2 UI-HOME-SCREEN-001: Home Portal

```text
+--------------------------------------------------------------------------------+
| Logo / Search app                                  App Switcher  Noti  Avatar   |
+--------------------------------------------------------------------------------+
| Category chips: Recent | Favorite | My apps | All apps                         |
|                                                                                |
| [Dashboard] [Nhân sự] [Chấm công] [Nghỉ phép] [Công việc] [Thông báo]           |
|                                                                                |
| Phase later apps / Coming soon if enabled                                      |
+--------------------------------------------------------------------------------+
```

Thành phần bắt buộc:

1. App grid theo permission.
2. Search app theo tên/module code/alias.
3. Recent apps.
4. Favorite/pin state nếu dùng.
5. Locked/coming soon/disabled state.
6. Empty state nếu user không có app.

### 21.3 UI-HOME-SCREEN-002: App Switcher Overlay

```text
+------------------------------------------------------+
| X   Tìm kiếm ứng dụng...                             |
+------------------------------------------------------+
| Home                                                 |
| Gần đây:      [HR] [ATT] [LEAVE]                     |
| Ứng dụng của tôi                                     |
| [Dashboard] [Nhân sự] [Chấm công] [Nghỉ phép]        |
| [Công việc] [Thông báo] [Hệ thống nếu có quyền]      |
| Ứng dụng khác / Coming soon                          |
+------------------------------------------------------+
```

Thành phần bắt buộc:

1. Search app.
2. Link Home Portal.
3. Recent apps.
4. My apps theo permission.
5. Other apps/Coming soon nếu cấu hình.
6. Dirty form confirm khi đổi app từ form chưa lưu.

### 21.4 UI-LAYOUT-SCREEN-001: Module Workspace Layout

```text
+--------------------------------------------------------------------------------+
| App name / Global search                       App Switcher Noti Avatar        |
+-------------------------+------------------------------------------------------+
| Module Sidebar          | Breadcrumb / Page title / Primary action             |
| - Overview              +------------------------------------------------------+
| - List                  | Filter / Tabs                                         |
| - Approval              +------------------------------------------------------+
| - Settings              | Main content                                          |
+-------------------------+------------------------------------------------------+
```

Thành phần bắt buộc:

1. Topbar global.
2. Sidebar theo module.
3. Page header.
4. Content area.
5. Loading/empty/error/forbidden state.
6. Responsive behavior: sidebar collapse trên tablet/mobile.

### 21.5 UI-ATT-SCREEN-001: Chấm công hôm nay

```text
+----------------------------------------------------------+
| Chấm công hôm nay                         [Refresh]      |
+----------------------------------------------------------+
| Status card: Hôm nay / Ca làm / Trạng thái               |
| [Check-in button] hoặc [Check-out button]                 |
| Server time / Check-in time / Check-out time              |
| Leave/Remote/Auto attendance info                         |
| Rule notes: GPS, location, late/early                     |
+----------------------------------------------------------+
| Timeline log hôm nay                                      |
+----------------------------------------------------------+
```

State bắt buộc:

1. Chưa check-in.
2. Đã check-in, chưa check-out.
3. Đã check-out.
4. Có nghỉ phép full-day approved -> disable action.
5. Remote approved/auto attendance.
6. Không có ca làm hôm nay.
7. Thiếu GPS/location permission.
8. API/business error.

### 21.6 UI-LEAVE-SCREEN-004: Tạo đơn nghỉ phép

```text
+----------------------------------------------------------+
| Tạo đơn nghỉ phép                         [Lưu nháp] [Gửi]|
+----------------------------------------------------------+
| Loại nghỉ                                                |
| Khoảng ngày / buổi / theo giờ                            |
| Lý do                                                    |
| File đính kèm nếu cần                                    |
| Preview: số ngày nghỉ, số dư còn lại, cảnh báo conflict   |
| Người duyệt dự kiến                                      |
+----------------------------------------------------------+
```

State bắt buộc:

1. Form mặc định.
2. Validation lỗi required/date/balance.
3. Preview tính số ngày nghỉ.
4. Cảnh báo trùng lịch/ngày nghỉ/ngày lễ.
5. Lưu nháp thành công.
6. Gửi đơn thành công.
7. Không đủ quyền hoặc employee không active.

### 21.7 UI-LEAVE-SCREEN-006: Duyệt/từ chối đơn nghỉ

```text
+--------------------------------------------------------------------------------+
| Đơn nghỉ cần duyệt                                      Filter / Search         |
+------------------------------+-------------------------------------------------+
| List pending requests        | Request detail                                  |
| - Employee                   | Thông tin nhân viên                             |
| - Date range                 | Loại nghỉ, thời gian, số ngày                   |
| - Leave type/status          | Lý do, file, lịch sử                            |
|                              | [Approve] [Reject]                              |
+------------------------------+-------------------------------------------------+
```

State bắt buộc:

1. List pending.
2. Empty pending.
3. Detail selected request.
4. Approve confirm.
5. Reject modal có lý do.
6. Request đã được xử lý bởi người khác.
7. Không thuộc scope duyệt.

### 21.8 UI-TASK-SCREEN-005: Chi tiết task

```text
+----------------------------------------------------------+
| Task title                            Status / Priority  |
| Project / Assignee / Deadline / Watchers                 |
+----------------------------------------------------------+
| Description                                              |
| Checklist                                                |
| Attachments                                              |
| Activity / Comment thread                                |
| [Update status] [Comment] [Assign]                       |
+----------------------------------------------------------+
```

State bắt buộc:

1. Task loaded.
2. User có quyền update.
3. User chỉ có quyền xem.
4. Task overdue/due soon.
5. Comment mention.
6. Checklist update.
7. File attachment optional.
8. Permission denied từ notification deep link.

### 21.9 UI-NOTI-SCREEN-001: Notification dropdown

```text
+-------------------------------------------+
| Thông báo                    Mark all read |
+-------------------------------------------+
| Unread item: title, time, target module    |
| Read item                                  |
| Empty state                                |
| [Xem tất cả thông báo]                     |
+-------------------------------------------+
```

State bắt buộc:

1. Có unread.
2. Không có notification.
3. Mark read.
4. Mark all read.
5. Click deep link sang module gốc.
6. Notification target bị mất quyền -> hiển thị cảnh báo phù hợp.

---

## 22. Mapping screen với prototype flow MVP

| Prototype flow | Screen bắt buộc | Screen hỗ trợ |
| --- | --- | --- |
| Login -> Home -> App -> Workspace | Login, Home Portal, App Switcher, Module Workspace | 403, loading, sidebar |
| Check-in -> Check-out | Attendance Today, Confirm modal | Bảng công của tôi, business error state |
| Create Leave -> Submit -> Approve -> Notification | Leave create, Leave detail, Leave approvals, Noti dropdown/detail | Leave balance, approval modal |
| Task Assigned -> Notification -> Task Detail | Noti dropdown/list/detail, Task detail | My tasks, comment, checklist |
| Manager xem team | Manager Dashboard, Team Attendance, Leave approvals, Task list | Employee list/detail |
| HR vận hành | HR Dashboard, Employee list/detail, Company attendance, Leave balances | Audit logs, settings |
| Admin cấu hình | System overview, Users, Roles, Settings | Audit, modules, permissions |

---

## 23. Responsive wireframe plan

### 23.1 Breakpoint đề xuất

| Thiết bị | Width | Cách xử lý chính |
| --- | --- | --- |
| Desktop | >= 1200px | Sidebar cố định, content rộng, table đầy đủ |
| Laptop | 1024px - 1199px | Sidebar có thể collapse, table vẫn ưu tiên |
| Tablet | 768px - 1023px | Sidebar drawer/collapse, filter gọn, table scroll |
| Mobile web | < 768px | Bottom/app drawer, card list thay table, form full width |

### 23.2 Màn hình P0 cần responsive annotation

| Screen | Desktop | Tablet | Mobile web |
| --- | --- | --- | --- |
| Login | Có | Có | Có |
| Home Portal | Có | Có | Có |
| App Switcher | Modal lớn | Drawer/fullscreen | Fullscreen overlay |
| Module Workspace | Sidebar trái | Sidebar collapsed | Drawer/bottom nav |
| Attendance Today | Card + timeline | Card stacked | Full width card |
| Leave Form | 2-column form | 1-column form | Fullscreen form |
| Task Detail | Main + side panel | Stacked | Tabs/accordion |
| Notification Dropdown | Popover | Drawer | Fullscreen list |

---

## 24. Component cần tách sau UI-04

| Nhóm component | Component cần thiết kế trong UI-05 |
| --- | --- |
| Layout | AuthLayout, HomePortalLayout, ModuleWorkspaceLayout, Topbar, Sidebar, AppSwitcher |
| Navigation | Breadcrumb, Tabs, AppCard, SidebarItem, AvatarMenu |
| Form | Input, Select, DateRangePicker, TimePicker, Textarea, Upload, Switch, Checkbox |
| Data | DataTable, FilterBar, Sort, Pagination, CardList, DetailSection |
| Workflow | StatusBadge, ApprovalBox, Timeline, ActivityLog, CommentThread, Checklist |
| Feedback | Toast, Alert, ConfirmDialog, Modal, Drawer, Skeleton, EmptyState, ErrorState |
| Permission | ForbiddenPage, LockedApp, DisabledActionTooltip, MaskedField |
| Dashboard | MetricCard, WidgetCard, QuickActionCard, ListWidget, ChartPlaceholder |
| Notification | NotificationBadge, NotificationDropdownItem, NotificationListItem |
| Attendance | AttendanceStatusCard, CheckInOutButton, WorkLogTimeline |
| Leave | LeaveBalanceCard, LeaveRequestForm, LeaveCalculationPreview, ApprovalModal |
| Task | TaskCard, KanbanColumn, TaskDetailHeader, AssigneePicker |

---

## 25. Quy tắc annotation cho wireframe

Mỗi wireframe P0/P1 cần có annotation sau:

| Nhóm annotation | Nội dung cần ghi |
| --- | --- |
| Route | Path, layout, module code, screen code |
| Actor | Role chính được dùng màn hình |
| Permission | Permission để xem màn hình và action chính |
| Data scope | Own/Team/Department/Project/Company/System |
| API mapping | API load data, submit action, refresh |
| State | Loading, empty, error, forbidden, disabled, success |
| Action | Primary/secondary/destructive action |
| Validation | Field required, business rule, conflict |
| Navigation | Back, breadcrumb, deep link, app switcher behavior |
| Responsive | Desktop/tablet/mobile behavior |

Mẫu annotation:

```text
Screen code: UI-LEAVE-SCREEN-002
Route: /leave/requests/new
Layout: Module Workspace
Actor: EMP
Permission: LEAVE.REQUEST.CREATE
Scope: Own
Primary action: Submit leave request
API: POST /api/v1/leave/requests, POST /api/v1/leave/requests/{id}/submit
States: default, calculating, validation error, insufficient balance, success
Deep link: none
```

---

## 26. Wireframe checklist theo màn hình P0

| Mã screen | Layout rõ | State đủ | Permission rõ | API mapping | Responsive note | Prototype link |
| --- | --- | --- | --- | --- | --- | --- |
| UI-AUTH-SCREEN-001 |  |  |  |  |  |  |
| UI-HOME-SCREEN-001 |  |  |  |  |  |  |
| UI-HOME-SCREEN-002 |  |  |  |  |  |  |
| UI-LAYOUT-SCREEN-001 |  |  |  |  |  |  |
| UI-LAYOUT-SCREEN-002 |  |  |  |  |  |  |
| UI-LAYOUT-SCREEN-003 |  |  |  |  |  |  |
| UI-DASH-SCREEN-001 |  |  |  |  |  |  |
| UI-ATT-SCREEN-001 |  |  |  |  |  |  |
| UI-ATT-SCREEN-002 |  |  |  |  |  |  |
| UI-LEAVE-SCREEN-003 |  |  |  |  |  |  |
| UI-LEAVE-SCREEN-004 |  |  |  |  |  |  |
| UI-LEAVE-SCREEN-006 |  |  |  |  |  |  |
| UI-TASK-SCREEN-002 |  |  |  |  |  |  |
| UI-TASK-SCREEN-005 |  |  |  |  |  |  |
| UI-TASK-SCREEN-006 |  |  |  |  |  |  |
| UI-NOTI-SCREEN-001 |  |  |  |  |  |  |
| UI-NOTI-SCREEN-002 |  |  |  |  |  |  |
| UI-NOTI-SCREEN-003 |  |  |  |  |  |  |
| UI-HR-SCREEN-006 |  |  |  |  |  |  |
| UI-HR-SCREEN-002 |  |  |  |  |  |  |
| UI-ERROR-SCREEN-001 |  |  |  |  |  |  |
| UI-ERROR-SCREEN-002 |  |  |  |  |  |  |

---

## 27. Checklist bàn giao cho UI/UX Designer

| Hạng mục | Trạng thái |
| --- | --- |
| Có screen inventory đầy đủ theo module | Cần thực hiện |
| Có mã screen chuẩn cho từng màn | Cần thực hiện |
| Có mức ưu tiên P0/P1/P2/P3 | Cần thực hiện |
| Có wireframe plan theo sprint | Cần thực hiện |
| Có layout skeleton cho P0 screens | Cần thực hiện |
| Có state bắt buộc cho P0/P1 screens | Cần thực hiện |
| Có responsive note cho P0 screens | Cần thực hiện |
| Có component cần tách sang UI-05 | Cần thực hiện |
| Có annotation template | Cần thực hiện |
| Có checklist prototype flow | Cần thực hiện |

---

## 28. Checklist bàn giao cho Frontend

| Hạng mục | Trạng thái |
| --- | --- |
| Route registry có `screenCode` | Cần thực hiện |
| App registry map với Home Portal/App Switcher | Cần thực hiện |
| Sidebar registry map với screen list | Cần thực hiện |
| Shared layout shell sẵn cho Module Workspace | Cần thực hiện |
| Component loading/empty/error/forbidden dùng chung | Cần thực hiện |
| Permission guard route/action | Cần thực hiện |
| Dirty form guard khi đổi app/route | Cần thực hiện |
| Notification deep link handler | Cần thực hiện |
| Responsive shell desktop/tablet/mobile | Cần thực hiện |
| Storybook hoặc component preview nếu dùng | Khuyến nghị |

---

## 29. Checklist bàn giao cho Backend/API

| Hạng mục | Trạng thái |
| --- | --- |
| API login/me/permissions đủ cho app shell | Cần thực hiện |
| API module/app registry theo quyền | Cần thực hiện hoặc tạm FE registry |
| API dashboard/me + widget | Cần thực hiện |
| API attendance today/check-in/check-out | Cần thực hiện |
| API leave create/submit/approve/reject | Cần thực hiện |
| API task my-tasks/detail/update/comment | Cần thực hiện |
| API notification unread/dropdown/list/detail | Cần thực hiện |
| API trả `allowed_actions` cho action guard | Khuyến nghị |
| API error code rõ cho business rule | Cần thực hiện |
| Backend guard permission/data scope mọi API | Bắt buộc |

---

## 30. Checklist bàn giao cho QA

| Nhóm test | Nội dung cần test |
| --- | --- |
| Screen visibility | User chỉ thấy app/menu/screen có quyền |
| Direct route | Nhập URL trái quyền bị 403 hoặc forbidden state |
| App Switcher | Mở từ mọi màn protected, search alias đúng, không lộ app trái quyền |
| Dirty form | Đổi app khi form chưa lưu phải confirm |
| Attendance | Check-in/check-out đúng allowed actions, block khi nghỉ phép full-day |
| Leave | Tạo đơn, lưu nháp, gửi, approve, reject, cancel, insufficient balance |
| Task | Xem task, update status, comment, mention, checklist |
| Notification | Unread count, dropdown, mark read, deep link sang module gốc |
| Data scope | Own/Team/Company hiển thị đúng trong list/widget/badge |
| State | Loading, empty, error, forbidden, disabled, success đều có UI |
| Responsive | P0 screens hoạt động trên desktop/tablet/mobile web |

---

## 31. Acceptance criteria UI-04

| Mã | Tiêu chí nghiệm thu |
| --- | --- |
| UI04-AC-001 | Có danh sách màn hình MVP theo từng module AUTH, HOME, DASH, HR, ATT, LEAVE, TASK, NOTI, SYSTEM |
| UI04-AC-002 | Mỗi màn hình có mã screen, route/entry, layout, actor, priority và trạng thái wireframe |
| UI04-AC-003 | Có danh sách P0 screen cần wireframe đầu tiên |
| UI04-AC-004 | Có kế hoạch wireframe theo sprint, ưu tiên layout nền tảng trước nghiệp vụ chi tiết |
| UI04-AC-005 | Có mô tả wireframe skeleton cho các màn P0 quan trọng |
| UI04-AC-006 | Có yêu cầu state cho loading, empty, error, forbidden, disabled, validation và success |
| UI04-AC-007 | Có responsive plan cho các màn P0 |
| UI04-AC-008 | Có mapping screen với prototype flow MVP |
| UI04-AC-009 | Có danh sách component cần tách sang UI-05 Design System |
| UI04-AC-010 | Có checklist bàn giao cho UI/UX, Frontend, Backend/API và QA |

---

## 32. Kết luận

UI-04 chốt phạm vi màn hình và kế hoạch wireframe cho MVP theo hướng:

```text
Chốt layout nền tảng
-> Thiết kế flow Employee hằng ngày
-> Thiết kế flow Manager/HR xử lý yêu cầu
-> Hoàn thiện Task/Project workspace
-> Bổ sung Admin/System tối thiểu
-> Prototype + handoff
```

Các màn hình cần ưu tiên ngay là:

1. Login.
2. Home Portal.
3. App Switcher.
4. Module Workspace + Topbar + Sidebar.
5. Dashboard mặc định.
6. Chấm công hôm nay.
7. Tạo đơn nghỉ.
8. Duyệt đơn nghỉ.
9. Việc của tôi.
10. Chi tiết task.
11. Notification dropdown/list/detail.
12. Hồ sơ của tôi và danh sách nhân viên.

Sau UI-04, bước tiếp theo nên là:

```text
UI-05: Design System & Component Library
```

UI-05 sẽ dùng danh sách component trong UI-04 để chốt token, màu sắc, typography, spacing, button, form, table, modal, state và component foundation trước khi đi vào high-fidelity design.
