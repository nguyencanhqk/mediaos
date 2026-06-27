# UI-10: PROTOTYPE & FRONTEND HANDOFF GUIDE
# HƯỚNG DẪN PROTOTYPE, ANNOTATION & BÀN GIAO FRONTEND

> **📚 Bộ tài liệu UI — Hệ thống Quản lý Doanh nghiệp**
> [UI-01 Tổng quan](<UI-01_UIUX_Design_Tong_Quan.md>) · [UI-02 IA/Sitemap](<UI-02_Information_Architecture_Sitemap.md>) · [UI-03 User Flow](<UI-03_User_Flow_MVP.md>) · [UI-04 Screen List](<UI-04_Screen_List_Wireframe_Plan.md>) · [UI-05 Design System](<UI-05_Design_System_Component_Library.md>) · [UI-06 Home/App Switcher](<UI-06_Home_Portal_App_Switcher_UI_Design.md>) · [UI-07 Module Workspace](<UI-07_Module_Workspace_Template_Design.md>) · [UI-08 Dashboard](<UI-08_Dashboard_UIUX_Design.md>) · [UI-09 Module UI](<UI-09_Module_UI_Design.md>) · **UI-10 Prototype/Handoff**
>
> **Liên quan:** [Sản phẩm: PRD-00](<../PRD/PRD-00 Enterprise Management System .md>) · [Đặc tả: SPEC-01 Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) · [Chuẩn API: API-01 Tổng quan](<../API Design/API-01 TỔNG QUAN.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | UI-10 |
| Tên tài liệu | Prototype & Frontend Handoff Guide |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-09 |
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

Tài liệu UI-10 đóng vai trò là tài liệu bàn giao cuối cùng của giai đoạn UI/UX MVP cho đội Frontend, Backend/API và QA.

UI-10 không thiết kế lại nghiệp vụ, layout hoặc component. Các nội dung đó đã được chốt trong các tài liệu trước:

| Tài liệu | Vai trò |
| --- | --- |
| UI-01 | Chốt mô hình trải nghiệm tổng thể: Home Portal -> Module Workspace -> App Switcher |
| UI-02 | Chốt sitemap, route convention, sidebar, topbar và quyền hiển thị menu |
| UI-03 | Chốt user flow MVP: login, mở app, đổi app, check-in, xin nghỉ, duyệt, task, notification |
| UI-04 | Chốt danh sách màn hình MVP, screen code và ưu tiên wireframe |
| UI-05 | Chốt Design System, token, component library và state foundation |
| UI-06 | Chốt Home Portal & App Switcher UI Design |
| UI-07 | Chốt Module Workspace Template |
| UI-08 | Chốt Dashboard UI/UX Design |
| UI-09 | Chốt Module UI Design chi tiết theo nghiệp vụ |

UI-10 tập trung vào:

1. Chuẩn bị clickable prototype MVP.
2. Chuẩn hóa cách annotation interaction trong Figma hoặc công cụ thiết kế tương đương.
3. Chuẩn hóa bàn giao component, design token, route, API mapping và state cho Frontend.
4. Chuẩn hóa responsive annotation cho desktop, tablet và mobile web.
5. Chuẩn hóa permission/data scope annotation để Frontend không hard-code theo role.
6. Chuẩn hóa checklist nghiệm thu UI trước khi bước vào development.
7. Tạo cầu nối giữa UI/UX Design, Frontend implementation, API integration và QA test case.

---

## 3. Phạm vi UI-10

### 3.1 Bao gồm trong MVP

| Nhóm | Nội dung |
| --- | --- |
| Prototype structure | Danh sách prototype flow, frame, connection và entry point |
| Interaction annotation | Click, hover, focus, modal, drawer, dropdown, dirty form, confirm, toast |
| Route handoff | Route metadata, screen code, layout type, module code, permission, data scope |
| Component handoff | Mapping Figma component -> Frontend component -> props -> state |
| API mapping | Mapping màn hình/action với API module gốc |
| State handoff | Loading, empty, error, forbidden, disabled, validation, success, stale |
| Responsive handoff | Desktop, tablet, mobile web behavior cho P0/P1 screens |
| Permission handoff | Hide, disable, masked field, forbidden route, empty due to scope |
| Design token handoff | Color, typography, spacing, radius, shadow, breakpoint, z-index, motion |
| QA handoff | Checklist test theo screen, flow, permission, data scope, responsive và accessibility |
| Acceptance criteria | Tiêu chí chốt file UI-10 và chốt UI/UX MVP |

### 3.2 Không bao gồm trong MVP

| Nội dung | Giai đoạn đề xuất |
| --- | --- |
| Prototype mobile native app | Phase mobile riêng |
| Advanced drag/drop dashboard personalization | Phase sau |
| BI dashboard nâng cao | Phase reporting riêng |
| Chat/social realtime prototype | Phase 4 |
| AI assistant/automation prototype | Phase 5 |
| Full design token automation pipeline | Phase sau, khi frontend stack đã chốt |
| Storybook hoàn chỉnh cho mọi component | Nên làm song song với frontend, không bắt buộc trong tài liệu UI-10 |

---

## 4. Căn cứ thiết kế

UI-10 bám theo các quyết định đã chốt trong bộ UI trước đó:

1. Sau đăng nhập, user vào **Home Portal** trước.
2. Từ Home Portal, user chọn app/module để vào **Module Workspace**.
3. Trong mọi màn protected, user có thể bấm nút **Ứng dụng** để mở **App Switcher**.
4. Module Workspace dùng sidebar riêng theo module và topbar chung toàn hệ thống.
5. Frontend được phép ẩn/hiện thành phần UI để cải thiện trải nghiệm, nhưng Backend vẫn là lớp kiểm tra quyền cuối cùng.
6. App, menu, route, button, field, widget, badge và counter phải hiển thị theo permission và data scope.
7. Dashboard, Home Portal và App Switcher chỉ tổng hợp/điều hướng, không xử lý nghiệp vụ gốc.
8. Notification deep link và dashboard quick action phải điều hướng sang module gốc để kiểm tra permission, data scope và business rule lại.
9. Mọi màn nghiệp vụ phải dùng component, token và state đã định nghĩa ở UI-05.
10. Mỗi màn hình phải có screen code, route, actor, priority, permission, API mapping, component, state, responsive note và QA focus theo UI-09.

---

## 5. Nguyên tắc bàn giao tổng thể

### 5.1 Một nguồn sự thật cho từng lớp

| Lớp | Nguồn sự thật | Frontend sử dụng như thế nào |
| --- | --- | --- |
| Nghiệp vụ | SPEC/API | Validate business rule qua API response và allowed actions |
| Dữ liệu | DB/API | Không tự suy đoán dữ liệu ngoài response/schema |
| Route/menu | UI-02 + route registry | Render route, sidebar, app switcher theo metadata |
| Flow | UI-03 | Dựng prototype và test journey chính |
| Screen | UI-04 + UI-09 | Implement screen theo screen code và state |
| Component | UI-05 | Tái sử dụng component chuẩn, không tự tạo pattern mới tùy tiện |
| Layout | UI-06 + UI-07 + UI-08 | Dùng HomePortalLayout, ModuleWorkspaceLayout, Dashboard layout |
| Prototype/handoff | UI-10 | Bàn giao interaction, API, state, responsive, QA checklist |

### 5.2 Không bàn giao bằng hình ảnh đơn lẻ

Một màn hình chỉ được xem là bàn giao đủ khi có:

1. Frame desktop.
2. Frame tablet hoặc responsive annotation.
3. Frame mobile hoặc responsive annotation.
4. State bắt buộc.
5. Component mapping.
6. API mapping.
7. Permission/data scope rule.
8. Interaction annotation.
9. Acceptance criteria.
10. Link prototype nếu màn thuộc flow P0.

### 5.3 Không hard-code theo role

Frontend không được viết logic kiểu:

```ts
if (role === 'HR') showEmployeeMenu()
```

Frontend phải dựa vào:

```ts
hasPermission('HR.EMPLOYEE.VIEW')
getEffectiveScope('HR.EMPLOYEE.VIEW')
module.active
featureFlag.enabled
backendAllowedActions
```

Role chỉ là seed mặc định. Permission và scope mới là cơ sở hiển thị UI.

### 5.4 Backend vẫn là guard cuối cùng

Dù Frontend có route guard, permission utility và disabled action, mọi API nghiệp vụ vẫn phải được Backend kiểm tra lại.

Frontend cần xử lý các response sau:

| Response | UI behavior |
| --- | --- |
| 401 | Refresh token hoặc redirect login |
| 403 | Forbidden state, không lộ dữ liệu |
| 404 | Not found state |
| 409 | Conflict/business rule alert |
| 422 | Validation inline + error summary |
| 500 | ErrorState + retry + request id nếu có |

---

## 6. Bộ deliverable UI/UX cần bàn giao

### 6.1 Deliverable bắt buộc

| Mã | Deliverable | Người nhận | Bắt buộc MVP |
| --- | --- | --- | --- |
| UI10-DEL-001 | Figma file hoặc design file high-fidelity | UI/UX, FE, QA | Có |
| UI10-DEL-002 | Clickable prototype P0 flows | Stakeholder, FE, QA | Có |
| UI10-DEL-003 | Prototype flow map | FE, QA | Có |
| UI10-DEL-004 | Screen inventory final | FE, QA | Có |
| UI10-DEL-005 | Component mapping sheet | FE | Có |
| UI10-DEL-006 | API mapping sheet | FE, BE | Có |
| UI10-DEL-007 | Route metadata sheet | FE | Có |
| UI10-DEL-008 | Permission/data scope matrix UI | FE, BE, QA | Có |
| UI10-DEL-009 | Responsive annotation | FE, QA | Có |
| UI10-DEL-010 | State annotation | FE, QA | Có |
| UI10-DEL-011 | Accessibility checklist | FE, QA | Có |
| UI10-DEL-012 | QA acceptance checklist | QA | Có |

### 6.2 Deliverable khuyến nghị

| Mã | Deliverable | Ghi chú |
| --- | --- | --- |
| UI10-DEL-013 | Design token export JSON | Nếu team dùng token automation |
| UI10-DEL-014 | Storybook component checklist | Làm song song với frontend |
| UI10-DEL-015 | Visual regression baseline | Nếu có Playwright/Chromatic/Loki |
| UI10-DEL-016 | UX copy dictionary | Chuẩn hóa label, toast, error message |
| UI10-DEL-017 | Icon asset package | SVG theo module và action |
| UI10-DEL-018 | Prototype review recording | Dùng cho stakeholder/QA nếu cần |

---

## 7. Cấu trúc file thiết kế đề xuất

### 7.1 Page trong Figma

```text
00 Cover & Changelog
01 Design Tokens
02 Component Library
03 Layout Shells
04 Home Portal & App Switcher
05 Dashboard
06 AUTH & ACCOUNT
07 HR
08 ATT
09 LEAVE
10 TASK
11 NOTI
12 SYSTEM / FOUNDATION
13 Prototype Flows
14 Responsive Frames
15 Annotation & Handoff
16 Archive
```

### 7.2 Quy tắc đặt tên frame

Format:

```text
[SCREEN_CODE] - [Screen Name] - [Viewport] - [State]
```

Ví dụ:

```text
UI-AUTH-SCREEN-001 - Login - Desktop - Default
UI-HOME-SCREEN-001 - Home Portal - Desktop - Loaded
UI-ATT-SCREEN-001 - Today Attendance - Desktop - Can Check In
UI-LEAVE-SCREEN-003 - Create Leave Request - Mobile - Validation Error
UI-TASK-SCREEN-004 - Task Detail - Desktop - Comment Mention
UI-NOTI-SCREEN-001 - Notification Dropdown - Desktop - Unread
```

### 7.3 Quy tắc đặt tên component trong Figma

Format:

```text
Category/Component/Variant
```

Ví dụ:

```text
Button/Primary/Default
Button/Primary/Loading
Form/Input/Error
Table/DataTable/Default
Navigation/AppCard/Locked
Workflow/ApprovalBox/Pending
Task/KanbanColumn/Default
Notification/NotificationListItem/Unread
```

### 7.4 Quy tắc đặt tên component Frontend

Format:

```text
PascalCase + domain prefix nếu là domain component
```

Ví dụ:

```text
Button
DataTable
ConfirmDialog
ModuleWorkspaceLayout
AppSwitcher
AttendanceStatusCard
LeaveRequestForm
TaskCard
NotificationDropdown
EmployeeProfileHeader
PermissionGate
MaskedField
```

---

## 8. Prototype strategy

### 8.1 Mục tiêu prototype MVP

Prototype MVP phải chứng minh được hệ thống vận hành theo mô hình:

```text
Login
-> Home Portal
-> Mở app/module
-> Module Workspace
-> Thao tác nghiệp vụ
-> App Switcher để đổi app
-> Notification deep link về nghiệp vụ gốc
```

Prototype không cần mô phỏng toàn bộ backend, nhưng phải mô phỏng đủ:

1. Điều hướng chính.
2. State quan trọng.
3. Permission/forbidden cơ bản.
4. Form submit thành công/thất bại giả lập.
5. Modal/drawer/overlay/dropdown.
6. Responsive behavior chính.
7. Deep link từ notification.

### 8.2 Cấp độ prototype

| Cấp độ | Mục đích | Dùng cho |
| --- | --- | --- |
| Low-fidelity | Kiểm tra flow và layout | Review sớm |
| Mid-fidelity | Kiểm tra interaction, hierarchy, state | Review UI/UX + FE |
| High-fidelity | Kiểm tra visual, handoff, stakeholder sign-off | Chốt MVP |
| Implementation prototype | FE dựng bằng code với mock API | Sprint frontend đầu tiên |

MVP cần ít nhất **high-fidelity clickable prototype** cho các flow P0.

### 8.3 Prototype entry points

| Entry point | Frame bắt đầu | Mục tiêu |
| --- | --- | --- |
| Public | Login | Kiểm tra đăng nhập |
| Home | Home Portal | Kiểm tra mở app |
| Workspace | Module Workspace root | Kiểm tra layout module |
| Dashboard | Dashboard mặc định | Kiểm tra widget/quick action |
| Notification | Notification Dropdown | Kiểm tra deep link |
| Mobile | Home Portal mobile | Kiểm tra responsive navigation |

---

## 9. Prototype flow bắt buộc

### 9.1 UI10-PF-001: Login -> Home Portal -> mở app

| Thuộc tính | Nội dung |
| --- | --- |
| Actor | Employee / Manager / HR / Admin |
| Entry | `/login` |
| Exit | Module Workspace tương ứng |
| Màn hình | Login, Home Portal, App Switcher optional, Module Workspace |
| Mục tiêu | Chứng minh mô hình sau login không vào dashboard trực tiếp mà vào Home Portal |

Flow:

```text
Login
-> nhập email/password
-> loading
-> success
-> Home Portal
-> search app
-> chọn Chấm công / Nhân sự / Công việc
-> Module Workspace
```

State cần có:

| State | Frame/Annotation |
| --- | --- |
| Login default | Có |
| Login loading | Có |
| Login error | Có |
| Home loading app registry | Có |
| Home loaded with app grid | Có |
| Home empty if no app | Có |
| Module workspace loaded | Có |
| Forbidden direct route | Có |

Acceptance:

1. User chỉ thấy app có quyền.
2. Click app vào route mặc định có quyền.
3. App card phase sau không làm lộ dữ liệu nghiệp vụ.
4. App không active hiển thị locked/coming soon theo policy.

---

### 9.2 UI10-PF-002: App Switcher đổi module

| Thuộc tính | Nội dung |
| --- | --- |
| Actor | Authenticated user |
| Entry | Bất kỳ Module Workspace nào |
| Exit | Module Workspace khác hoặc giữ nguyên màn nếu đóng overlay |
| Màn hình | Module Workspace, App Switcher overlay/drawer/fullscreen |

Flow:

```text
Đang ở /tasks/my-tasks
-> bấm nút Ứng dụng trên topbar
-> App Switcher mở overlay
-> search "nghỉ"
-> chọn Nghỉ phép
-> nếu form không dirty: chuyển /leave
-> nếu form dirty: confirm trước khi rời
```

State cần có:

| State | Yêu cầu |
| --- | --- |
| Overlay desktop | Modal lớn hoặc drawer |
| Fullscreen mobile | Bắt buộc cho mobile |
| Search result | Có kết quả theo alias |
| Empty result | Message rõ |
| Locked app | Hiển thị nếu policy cho phép |
| Dirty form confirm | Có |

Acceptance:

1. App Switcher mở được từ mọi màn protected.
2. Đóng overlay không làm mất dữ liệu màn hiện tại.
3. Chọn app vẫn qua route guard.
4. Form dirty phải cảnh báo.

---

### 9.3 UI10-PF-003: Check-in / Check-out

| Thuộc tính | Nội dung |
| --- | --- |
| Actor | Employee |
| Entry | `/attendance/today` hoặc Dashboard quick action |
| Exit | Attendance Today đã cập nhật trạng thái |
| API chính | `GET /api/v1/attendance/today`, `POST /api/v1/attendance/check-in`, `POST /api/v1/attendance/check-out` |

Flow:

```text
Mở Chấm công hôm nay
-> hệ thống load trạng thái
-> nếu can_check_in: hiển thị Check-in
-> bấm Check-in
-> confirm modal
-> submit
-> success toast
-> cập nhật timeline
-> sau đó hiển thị Check-out nếu phù hợp
```

Business state cần prototype:

| Backend state | UI prototype |
| --- | --- |
| `can_check_in = true` | Nút Check-in active |
| `can_check_out = true` | Nút Check-out active |
| `blocked_by_leave = true` | Disable button + alert nghỉ phép |
| `missing_checkout_yesterday = true` | Alert + CTA tạo điều chỉnh công |
| `remote_auto_attendance = true` | Status tự chấm công remote |

Acceptance:

1. Không hiển thị Check-in khi bị nghỉ phép full-day approved.
2. Button có loading và chống double submit.
3. Lỗi business rule hiển thị trong card, không chỉ toast.
4. Timeline cập nhật sau success.

---

### 9.4 UI10-PF-004: Tạo đơn nghỉ phép

| Thuộc tính | Nội dung |
| --- | --- |
| Actor | Employee |
| Entry | `/leave/requests/new` hoặc Dashboard quick action |
| Exit | Leave request detail hoặc My Requests |
| API chính | `POST /api/v1/leave/requests`, preview calculation API nếu có |

Flow:

```text
Mở Tạo đơn nghỉ
-> chọn loại nghỉ
-> chọn ngày/giờ nghỉ
-> hệ thống preview số ngày trừ phép
-> nhập lý do
-> upload file nếu cần
-> lưu nháp hoặc gửi đơn
-> success toast
-> điều hướng detail request
```

State cần prototype:

| State | Yêu cầu |
| --- | --- |
| Default | Form trống |
| Calculating | Loading nhỏ ở phần số ngày nghỉ |
| Insufficient balance | Alert + disable submit hoặc warning theo policy |
| Date conflict | Alert conflict |
| Draft saved | Toast + status draft |
| Submitted | Success + status pending |
| Validation error | Inline error + error summary |

Acceptance:

1. Form có dirty guard.
2. Required field rõ ràng.
3. Balance preview hiển thị trước khi gửi.
4. Submit lỗi validation không mất dữ liệu đã nhập.

---

### 9.5 UI10-PF-005: Duyệt / từ chối đơn nghỉ

| Thuộc tính | Nội dung |
| --- | --- |
| Actor | Manager / HR |
| Entry | `/leave/approvals` hoặc notification deep link |
| Exit | Approval detail cập nhật trạng thái |
| API chính | `POST /api/v1/leave/requests/{id}/approve`, `POST /api/v1/leave/requests/{id}/reject` |

Flow approve:

```text
Mở danh sách chờ duyệt
-> chọn đơn
-> xem detail
-> bấm Duyệt
-> confirm modal
-> success
-> status Approved
-> ATT/NOTI xử lý qua backend event
```

Flow reject:

```text
Mở detail đơn
-> bấm Từ chối
-> modal nhập lý do bắt buộc
-> submit
-> success
-> status Rejected
```

State cần prototype:

| State | UI |
| --- | --- |
| Pending | Nút Duyệt/Từ chối visible nếu có quyền |
| Approved | Action bị ẩn hoặc disabled |
| Rejected | Hiển thị lý do từ chối |
| Out of scope | Forbidden hoặc empty due to scope |
| Already processed | Conflict alert |

Acceptance:

1. User chỉ duyệt đơn trong scope.
2. Từ chối bắt buộc nhập lý do.
3. Conflict khi đơn đã được xử lý bởi người khác phải hiển thị rõ.
4. Sau approve/reject cập nhật list và badge/counter.

---

### 9.6 UI10-PF-006: Task của tôi -> chi tiết task -> cập nhật trạng thái

| Thuộc tính | Nội dung |
| --- | --- |
| Actor | Employee / Manager |
| Entry | `/tasks/my-tasks` hoặc notification deep link |
| Exit | Task detail/list cập nhật trạng thái |
| API chính | `GET /api/v1/tasks/my-tasks`, `PATCH /api/v1/tasks/{id}`, comment/checklist APIs |

Flow:

```text
Mở Việc của tôi
-> filter task hôm nay/quá hạn
-> mở task detail drawer/page
-> cập nhật trạng thái In Progress / Done
-> thêm comment hoặc checklist item
-> mention user
-> success toast
```

State cần prototype:

| State | UI |
| --- | --- |
| Empty my tasks | Empty + message phù hợp |
| Overdue task | Badge danger |
| Due soon | Badge warning |
| Assignee on leave warning | Alert nhẹ khi giao task |
| Comment mention | Mention picker + notification hint |
| Checklist update | Optimistic hoặc loading item |

Acceptance:

1. Task detail có đủ summary, assignee, deadline, status, priority, comment, checklist, file.
2. Update status có loading tại action.
3. Không cho user không quyền sửa task thấy action update.
4. Mention tạo notification theo backend event.

---

### 9.7 UI10-PF-007: Notification dropdown -> mark read -> deep link

| Thuộc tính | Nội dung |
| --- | --- |
| Actor | Authenticated user |
| Entry | Notification badge trên topbar |
| Exit | Module gốc chứa nghiệp vụ liên quan |
| API chính | `GET /api/v1/notifications/dropdown`, `POST /api/v1/notifications/{id}/read` |

Flow:

```text
Bấm chuông thông báo
-> dropdown hiển thị unread count + latest notifications
-> click notification đơn nghỉ cần duyệt
-> mark read
-> deep link sang /leave/approvals/:id
-> LEAVE kiểm tra quyền lại
-> hiển thị detail hoặc forbidden
```

State cần prototype:

| State | UI |
| --- | --- |
| No unread | Badge ẩn hoặc 0 theo policy |
| Unread item | Bold/dot |
| Read item | Normal |
| Mark all read | Loading + success |
| Target unavailable | Error/disabled target state |
| Forbidden target | Module gốc hiển thị 403 |

Acceptance:

1. Notification dropdown không thay thế trang thông báo đầy đủ.
2. Deep link luôn đi qua module gốc.
3. Mark read không làm mất item đột ngột nếu user cần click target.
4. Unread count cập nhật sau mark read.

---

### 9.8 UI10-PF-008: Employee gửi yêu cầu sửa hồ sơ cá nhân

| Thuộc tính | Nội dung |
| --- | --- |
| Actor | Employee |
| Entry | `/hr/me/change-request` |
| Exit | Profile change request detail hoặc My Profile |
| API chính | `POST /api/v1/hr/profile-change-requests` |

Flow:

```text
Mở Hồ sơ của tôi
-> bấm Gửi yêu cầu chỉnh sửa
-> form hiển thị dữ liệu hiện tại
-> user nhập dữ liệu đề xuất
-> submit
-> request Pending
-> HR nhận notification
```

State cần prototype:

| State | UI |
| --- | --- |
| No pending request | Cho phép tạo request |
| Existing pending field | Cảnh báo field đang chờ duyệt |
| Sensitive field hidden | MaskedField nếu thiếu quyền |
| Submitted | Status Pending |
| Rejected | Hiển thị lý do từ chối |

Acceptance:

1. Employee không cập nhật trực tiếp hồ sơ chính.
2. Field self-service phải theo cấu hình.
3. Dữ liệu cũ/mới phải dễ so sánh.
4. Sau submit không làm thay đổi hồ sơ chính cho đến khi được duyệt.

---

### 9.9 UI10-PF-009: Admin chỉnh role-permission matrix

| Thuộc tính | Nội dung |
| --- | --- |
| Actor | Admin / Super Admin |
| Entry | `/system/roles/:id/permissions` |
| Exit | Role permission matrix đã lưu |
| API chính | Role permission APIs từ AUTH |

Flow:

```text
Mở Role detail
-> mở Permission matrix
-> search permission
-> tick/untick permission + scope
-> dirty indicator
-> bấm Lưu
-> modal review diff
-> confirm
-> success
```

State cần prototype:

| State | UI |
| --- | --- |
| Loading matrix | Skeleton table |
| Dirty changes | Badge/alert chưa lưu |
| Dangerous permission | Warning badge |
| Save diff | Modal liệt kê added/removed/changed scope |
| Conflict | Alert nếu role bị thay đổi bởi người khác |

Acceptance:

1. Permission matrix group theo module/resource.
2. Không tự gỡ quyền cuối cùng khiến Super Admin mất quyền quản trị.
3. Scope thay đổi phải dễ nhìn trong modal diff.
4. Save success cần invalidate permission cache nếu user hiện tại bị ảnh hưởng.

---

## 10. Prototype frame checklist theo module

### 10.1 AUTH / ACCOUNT / SYSTEM

| Screen | Desktop | Mobile | State cần có | Prototype P0 |
| --- | --- | --- | --- | --- |
| Login | Có | Có | Default, loading, error, locked | Có |
| Forgot password | Có | Optional | Default, success, error | Không bắt buộc |
| Reset password | Có | Optional | Invalid token, success | Không bắt buộc |
| User list | Có | Annotation | Loading, empty, forbidden | Có nếu Admin flow |
| Permission matrix | Có | Không bắt buộc mobile sâu | Dirty, save diff, conflict | Có nếu Admin flow |

### 10.2 HOME / APP SWITCHER

| Screen | Desktop | Mobile | State cần có | Prototype P0 |
| --- | --- | --- | --- | --- |
| Home Portal | Có | Có | Loading, loaded, empty, locked app, error | Có |
| App Switcher | Có | Có fullscreen | Search, empty, locked, recent | Có |
| Dirty form confirm | Có | Có | Confirm leave/cancel | Có |

### 10.3 DASH

| Screen | Desktop | Mobile | State cần có | Prototype P0 |
| --- | --- | --- | --- | --- |
| Dashboard default | Có | Có | Loading, degraded, stale, widget error | Có |
| Employee dashboard | Có | Có | Check-in quick action | Có |
| Manager dashboard | Có | Annotation | Pending approvals | Có |
| HR dashboard | Có | Annotation | Alerts, HR overview | P1 |
| Admin dashboard | Có | Annotation | System summary | P1 |

### 10.4 HR

| Screen | Desktop | Mobile | State cần có | Prototype P0 |
| --- | --- | --- | --- | --- |
| Employee list | Có | Card list annotation | Loading, empty, scope empty | Có |
| Employee detail | Có | Có nếu P0 | Masked field, forbidden tab | Có |
| My profile | Có | Có | Read-only, request pending | Có |
| Profile change request form | Có | Có | Validation, pending warning | Có |
| Profile change approval | Có | Annotation | Approve/reject, diff | P1 |

### 10.5 ATT

| Screen | Desktop | Mobile | State cần có | Prototype P0 |
| --- | --- | --- | --- | --- |
| Today attendance | Có | Có | Can check-in, can check-out, blocked by leave | Có |
| My records | Có | Card list annotation | Empty, loading, error | Có |
| Adjustment request | Có | Mobile annotation | Validation, success | P1 |
| Adjustment approval | Có | Annotation | Approve/reject/conflict | P1 |
| Shift/rule settings | Có | Không bắt buộc | Forbidden, validation | P2 |

### 10.6 LEAVE

| Screen | Desktop | Mobile | State cần có | Prototype P0 |
| --- | --- | --- | --- | --- |
| My balance | Có | Có | Low balance warning | Có |
| My requests | Có | Có | Draft, pending, approved, rejected | Có |
| Create leave request | Có | Có | Calculation, validation, insufficient balance | Có |
| Leave detail | Có | Có | Cancel allowed/not allowed | Có |
| Approval list/detail | Có | Annotation | Approve/reject/conflict | Có |
| Leave calendar | Có | Mobile month/list annotation | Empty, scoped view | P1 |

### 10.7 TASK

| Screen | Desktop | Mobile | State cần có | Prototype P0 |
| --- | --- | --- | --- | --- |
| My tasks | Có | Có | Empty, overdue, due soon | Có |
| Task detail | Có | Có | Comment, checklist, file, activity | Có |
| Task create/edit | Có | Annotation | Validation, assignee leave warning | P1 |
| Kanban board | Có | Mobile alternative annotation | Drag/drop, forbidden move | Có |
| Project list/detail | Có | Annotation | Empty, archived | P1 |

### 10.8 NOTI

| Screen | Desktop | Mobile | State cần có | Prototype P0 |
| --- | --- | --- | --- | --- |
| Notification badge/dropdown | Có | Có | Unread, empty, mark read | Có |
| Notification list | Có | Có | Filter read/unread, empty | Có |
| Notification detail | Có | Có | Target available/unavailable | P1 |
| Event/template admin | Có | Không bắt buộc | Enable/disable, validation | P2 |

---

## 11. Interaction annotation standard

### 11.1 Cấu trúc annotation cho mỗi interaction

Mỗi interaction quan trọng cần ghi theo mẫu:

```text
Interaction ID: UI10-INT-XXX
Trigger: Người dùng bấm / hover / focus / submit / kéo thả / chọn item
Source frame: Tên frame bắt đầu
Target frame/state: Tên frame/state sau hành động
Condition: Permission, status, data scope, business rule
API call: Endpoint nếu có
Loading behavior: Button loading / skeleton / optimistic update
Success behavior: Toast / refresh / redirect / update local state
Error behavior: Inline error / alert / modal / forbidden / retry
Analytics/Audit: Có cần event UI hoặc audit backend không
```

### 11.2 Ví dụ annotation: Check-in

```text
Interaction ID: UI10-INT-ATT-001
Trigger: Click nút Check-in
Source frame: UI-ATT-SCREEN-001 - Today Attendance - Desktop - Can Check In
Condition:
- User có ATT.ATTENDANCE.CHECK_IN
- can_check_in = true từ backend
- Không bị blocked_by_leave
API call: POST /api/v1/attendance/check-in
Loading behavior:
- Nút Check-in loading
- Disable nút trong lúc submit
Success behavior:
- Toast "Check-in thành công"
- Refresh GET /api/v1/attendance/today
- Timeline thêm log check-in
Error behavior:
- 409 business rule: hiển thị Alert trong AttendanceStatusCard
- 403: hiển thị forbidden state/action disabled
- Network: toast error + retry
```

### 11.3 Ví dụ annotation: App Switcher

```text
Interaction ID: UI10-INT-HOME-002
Trigger: Click nút Ứng dụng trên Topbar
Source frame: Any protected Module Workspace
Target frame/state: App Switcher overlay open
Condition:
- User authenticated
- App registry loaded hoặc fallback loading
API call:
- Optional GET /api/v1/foundation/modules/my-apps nếu cache miss
Loading behavior:
- Overlay mở kèm skeleton app grid
Success behavior:
- Hiển thị Recent Apps + My Apps theo permission
Error behavior:
- ErrorState nhỏ trong overlay + retry
```

### 11.4 Interaction cần annotation bắt buộc

| Nhóm | Interaction |
| --- | --- |
| Auth | Login submit, logout, token expired |
| Navigation | Open app, switch app, direct route forbidden |
| Form | Submit, save draft, validation, dirty form guard |
| Table | Search, filter, sort, pagination, row action, bulk action |
| Approval | Approve, reject, conflict, required reason |
| Task | Update status, drag/drop Kanban, comment, mention, checklist |
| Notification | Open dropdown, mark read, mark all read, deep link target |
| File | Upload, preview, download, remove |
| Permission | Hide action, disabled by business rule, masked field |
| Error | Retry, request id, fallback state |

---

## 12. State annotation standard

### 12.1 State bắt buộc cho mọi màn P0/P1

| State | Mô tả | Cách bàn giao |
| --- | --- | --- |
| Loading | Đang tải dữ liệu | Skeleton đúng layout |
| Empty | Không có dữ liệu | EmptyState + CTA nếu có quyền |
| Error | API/network/server lỗi | ErrorState + retry + request id nếu có |
| Forbidden | Không có quyền | Không lộ dữ liệu, giải thích ngắn |
| Disabled | Module/action bị tắt | Disabled state + tooltip/alert lý do |
| Validation | Form lỗi | Inline error + error summary |
| Success | Thao tác thành công | Toast + update UI/redirect |
| Stale | Dữ liệu cache có thể cũ | Last updated + refresh |
| Scope empty | Không có dữ liệu trong phạm vi | Empty message riêng theo data scope |

### 12.2 State matrix cho API list screen

| API status | UI state | Ghi chú |
| --- | --- | --- |
| Initial load | Skeleton table/card | Không dùng spinner trống cho bảng lớn |
| 200 + data | Loaded | Render table/list |
| 200 + empty | Empty | CTA theo permission create |
| 400 | Error/validation filter | Filter invalid |
| 401 | Auth handling | Refresh hoặc login |
| 403 | Forbidden | Không lộ data |
| 404 | Not found | Nếu route/detail không tồn tại |
| 500 | ErrorState | Có retry |
| Partial failure | Degraded | Dùng cho dashboard/widget |

### 12.3 State matrix cho form submit

| Giai đoạn | UI behavior |
| --- | --- |
| Editing | Form editable, dirty state nếu có thay đổi |
| Submit loading | Disable submit, giữ dữ liệu, button loading |
| Validation error | Hiển thị lỗi tại field, focus field đầu tiên lỗi |
| Business error | Alert trong form, giữ dữ liệu |
| Success create | Toast + redirect detail/list theo flow |
| Success update | Toast + refresh detail hoặc giữ form saved |
| Conflict | Alert có nội dung dữ liệu đã thay đổi bởi người khác |
| Cancel dirty | Confirm trước khi rời |

---

## 13. Permission, data scope và business rule handoff

### 13.1 UI permission behavior

| Trường hợp | UI behavior |
| --- | --- |
| Không có quyền xem module | Ẩn app/module khỏi Home Portal/App Switcher |
| Không có quyền xem route | Không hiển thị menu, direct URL -> 403 |
| Có quyền xem nhưng không có quyền thao tác | Hiển thị màn, ẩn action |
| Có quyền thao tác nhưng business rule chặn | Disable action + tooltip/alert lý do |
| Có quyền xem field nhưng field nhạy cảm bị hạn chế | MaskedField hoặc ẩn field theo policy |
| Có quyền xem dữ liệu nhưng scope không có data | Empty state `Không có dữ liệu trong phạm vi của bạn` |

### 13.2 Data scope cần hiển thị tự nhiên

| Scope | UI impact |
| --- | --- |
| Own | Filter mặc định chính mình, không cho chọn employee khác |
| Team | Hiển thị team selector nếu có nhiều team, badge `Team` nếu cần |
| Department | Cho filter phòng ban trong phạm vi được cấp |
| Project | Task/project chỉ hiện dự án liên quan |
| Company | HR/Admin xem toàn công ty |
| System | Super Admin xem liên company qua mode riêng |

### 13.3 Annotation cho từng action

Mỗi action quan trọng phải có:

```text
Action key:
Required permission:
Required scope:
Allowed status:
Disabled reason source:
Backend allowed_actions field:
Visible when:
Hidden when:
Disabled when:
Error handling:
```

Ví dụ:

```text
Action key: leave.request.approve
Required permission: LEAVE.REQUEST.APPROVE
Required scope: Team/Company/System
Allowed status: Pending
Visible when: User has permission and request in scope
Hidden when: Missing permission
Disabled when: Request already processed or backend allowed_actions.approve = false
Error handling: 409 conflict alert; 403 forbidden state
```

### 13.4 Backend allowed actions

Với các màn workflow, Frontend nên ưu tiên response `allowed_actions` từ backend.

Ví dụ:

```json
{
  "id": "leave-request-id",
  "status": "Pending",
  "allowed_actions": {
    "approve": true,
    "reject": true,
    "cancel": false,
    "edit": false
  },
  "disabled_reasons": {
    "cancel": "Đơn đã gửi, không thể hủy theo chính sách hiện tại."
  }
}
```

Frontend dùng `allowed_actions` để render action chính xác, nhưng vẫn giữ permission utility để ẩn action từ đầu khi thiếu quyền.

---

## 14. Route handoff guide

### 14.1 Route registry yêu cầu

Frontend cần có route registry tập trung, không rải logic permission trong từng page.

```ts
export type DataScope = 'Own' | 'Team' | 'Department' | 'Project' | 'Company' | 'System';

export interface RouteMeta {
  routeKey: string;
  path: string;
  layout: 'AUTH' | 'HOME_PORTAL' | 'MODULE_WORKSPACE' | 'ACCOUNT' | 'ERROR';
  moduleCode?: 'DASH' | 'HR' | 'ATT' | 'LEAVE' | 'TASK' | 'NOTI' | 'AUTH' | 'FOUNDATION';
  screenCode?: string;
  title: string;
  requiredPermissions?: string[];
  requiredAnyPermissions?: string[];
  requiredScopes?: DataScope[];
  featureFlag?: string;
  showInSidebar?: boolean;
  showInTopbar?: boolean;
  showInAppSwitcher?: boolean;
  sidebarGroup?: string;
  order?: number;
  icon?: string;
  isPublic?: boolean;
  exact?: boolean;
}
```

### 14.2 Route guard flow

```text
User mở route
-> route exists?
-> route public?
-> auth token valid?
-> user context loaded?
-> module active?
-> feature flag enabled?
-> permission valid?
-> scope valid?
-> render page hoặc forbidden/disabled/not found
```

### 14.3 Route fallback

| Tình huống | Behavior |
| --- | --- |
| Login success no returnUrl | `/home` |
| Login success with valid returnUrl | returnUrl |
| Login success but returnUrl forbidden | `/home` hoặc `/403` theo policy |
| App root route forbidden | Tìm route đầu tiên trong module user có quyền |
| Module không có route được phép | Không hiển thị app |
| Unknown route | `/404` |

### 14.4 Route handoff table template

| Screen code | Route | Layout | Module | Permission | Scope | API chính | Component chính | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UI-ATT-SCREEN-001 | `/attendance/today` | ModuleWorkspace | ATT | `ATT.ATTENDANCE.VIEW_OWN` | Own | `GET /attendance/today` | AttendanceStatusCard | P0 |

---

## 15. App registry và sidebar handoff

### 15.1 App registry model

```ts
export interface AppRegistryItem {
  moduleCode: string;
  appName: string;
  appNameEn?: string;
  description?: string;
  icon: string;
  accentToken: string;
  defaultRoute: string;
  aliases: string[];
  requiredAnyPermissions: string[];
  status: 'active' | 'disabled' | 'coming_soon' | 'beta' | 'maintenance';
  order: number;
  showInHome: boolean;
  showInAppSwitcher: boolean;
  isFavorite?: boolean;
  lastOpenedAt?: string;
  badge?: {
    label?: string;
    count?: number;
    variant?: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
  };
}
```

### 15.2 App list MVP đề xuất

| Module | App name | Default route | Alias |
| --- | --- | --- | --- |
| DASH | Dashboard | `/dashboard` | dashboard, tổng quan, báo cáo nhanh |
| HR | Nhân sự | `/hr` hoặc `/hr/employees` | nhân sự, hr, employee, hồ sơ |
| ATT | Chấm công | `/attendance/today` | công, chấm công, attendance, check-in |
| LEAVE | Nghỉ phép | `/leave` hoặc `/leave/requests` | nghỉ, phép, leave, xin nghỉ |
| TASK | Công việc | `/tasks/my-tasks` | task, công việc, dự án, kanban |
| NOTI | Thông báo | `/notifications` | thông báo, notification, bell |
| AUTH | Tài khoản | `/account/profile` | tài khoản, account, bảo mật |
| FOUNDATION | Hệ thống | `/system` | system, cấu hình, audit, settings |

### 15.3 Sidebar registry model

```ts
export interface SidebarItem {
  key: string;
  moduleCode: string;
  label: string;
  path?: string;
  icon?: string;
  group?: 'overview' | 'operation' | 'management' | 'report' | 'settings' | 'admin';
  parentKey?: string;
  order: number;
  requiredPermissions?: string[];
  requiredAnyPermissions?: string[];
  requiredScopes?: DataScope[];
  featureFlag?: string;
  badgeSource?: string;
  isBeta?: boolean;
  isComingSoon?: boolean;
  children?: SidebarItem[];
}
```

### 15.4 Sidebar rendering rule

```text
filter by moduleCode
-> filter module active
-> filter featureFlag
-> filter permission/scope
-> remove empty parent group
-> sort by order
-> render expanded/collapsed state
-> fetch badge only if user has permission for badge source
```

---

## 16. Component handoff guide

### 16.1 Component mapping template

| Figma component | Frontend component | Props chính | State | Ghi chú |
| --- | --- | --- | --- | --- |
| Button/Primary | `Button` | `variant`, `size`, `loading`, `disabled` | default, hover, focus, loading, disabled | Dùng cho CTA chính |
| Table/DataTable | `DataTable` | `columns`, `data`, `loading`, `pagination`, `rowActions` | loading, empty, error | Không tự hard-code column responsive |
| Permission/PermissionGate | `PermissionGate` | `permission`, `scope`, `fallback` | visible/hidden/disabled | Dùng cho action/block |

### 16.2 Component nhóm layout

| Component | Vai trò | Bắt buộc MVP |
| --- | --- | --- |
| `AuthLayout` | Login/forgot/reset password | Có |
| `HomePortalLayout` | Home Portal | Có |
| `ModuleWorkspaceLayout` | Workspace mọi module | Có |
| `GlobalTopbar` | Topbar protected | Có |
| `ModuleSidebar` | Sidebar theo module | Có |
| `MainContentShell` | Page header/toolbar/content | Có |
| `AppSwitcher` | Đổi app nhanh | Có |

### 16.3 Component foundation

| Component | State tối thiểu |
| --- | --- |
| `Button` | default, hover, focus, active, loading, disabled |
| `Input` | default, focus, filled, error, disabled, read-only |
| `Select` | closed, open, selected, empty, disabled, error |
| `DatePicker` | single, range, disabled date, error |
| `DataTable` | loading, loaded, empty, error, selected rows |
| `Modal` | open, loading action, confirm, error |
| `Drawer` | open, close, dirty guard |
| `Toast` | success, error, warning, info |
| `Alert` | info, warning, danger, success |
| `EmptyState` | no data, no data due to scope, no permission action |
| `ErrorState` | retry, request id, degraded |
| `ForbiddenPage` | route forbidden, data forbidden |
| `MaskedField` | masked, reveal allowed, no permission |

### 16.4 Domain component MVP

| Component | Module | Dùng cho |
| --- | --- | --- |
| `AttendanceStatusCard` | ATT | Chấm công hôm nay |
| `CheckInOutButton` | ATT | Check-in/check-out |
| `AttendanceTimeline` | ATT | Timeline log trong ngày |
| `LeaveBalanceCard` | LEAVE | Số dư phép |
| `LeaveRequestForm` | LEAVE | Tạo/sửa đơn nghỉ |
| `ApprovalBox` | LEAVE/ATT/HR | Duyệt/từ chối |
| `TaskCard` | TASK | Task list/Kanban |
| `KanbanColumn` | TASK | Board trạng thái |
| `CommentThread` | TASK | Bình luận task |
| `Checklist` | TASK | Checklist task |
| `NotificationDropdown` | NOTI | Dropdown topbar |
| `NotificationListItem` | NOTI | List notification |
| `EmployeeProfileHeader` | HR | Chi tiết nhân viên |
| `ProfileChangeDiffTable` | HR | Duyệt yêu cầu sửa hồ sơ |
| `PermissionMatrix` | AUTH/SYSTEM | Role permission |

### 16.5 Component ownership

| Loại component | Owner thiết kế | Owner frontend | Ghi chú |
| --- | --- | --- | --- |
| Foundation | UI/UX + FE Platform | FE Platform | Reusable toàn hệ thống |
| Layout | UI/UX + FE Platform | FE Platform | Không để từng module tự viết layout |
| Domain | UI/UX + FE module | FE module | Có thể reuse nếu domain liên quan |
| Workflow | UI/UX + FE Platform | FE Platform/module | Approval, status, activity dùng chung |
| Experimental | Module team | Module team | Không đưa vào library cho đến khi ổn định |

---

## 17. Design token handoff

### 17.1 Token cần bàn giao

| Nhóm token | Ví dụ |
| --- | --- |
| Color primitive | `gray.50`, `brand.500`, `danger.500` |
| Color semantic | `color.bg.canvas`, `color.text.primary`, `color.action.primary` |
| Module accent | `module.hr`, `module.att`, `module.leave`, `module.task` |
| Typography | `font.sans`, `text.sm`, `font.semibold`, `lineHeight.base` |
| Spacing | `space.1`, `space.2`, `space.4`, `space.6`, `space.8` |
| Radius | `radius.sm`, `radius.md`, `radius.lg`, `radius.xl` |
| Shadow | `shadow.sm`, `shadow.md`, `shadow.overlay` |
| Breakpoint | `bp.mobile`, `bp.tablet`, `bp.desktop`, `bp.wide` |
| Z-index | `z.dropdown`, `z.overlay`, `z.modal`, `z.toast` |
| Motion | `motion.fast`, `motion.normal`, `motion.slow` |

### 17.2 CSS variable output đề xuất

```css
:root {
  --color-bg-canvas: #F8FAFC;
  --color-bg-surface: #FFFFFF;
  --color-text-primary: #0F172A;
  --color-text-secondary: #475569;
  --color-border-default: #E2E8F0;
  --color-action-primary: #2F80ED;
  --radius-md: 8px;
  --radius-lg: 12px;
  --shadow-card: 0 1px 3px rgba(15, 23, 42, 0.08);
  --space-4: 16px;
}
```

### 17.3 Token handoff rule

1. Không bàn giao màu chỉ bằng screenshot.
2. Mọi màu trong Figma phải dùng token/style.
3. Mọi radius/spacing lặp lại phải dùng scale token.
4. Frontend không hard-code module color trong từng component.
5. Nếu token thay đổi, phải cập nhật changelog.
6. Nếu dùng Tailwind, token cần map sang `tailwind.config`.
7. Nếu dùng CSS variables, token cần có tên ổn định từ đầu.

---

## 18. API integration handoff

### 18.1 API mapping sheet template

| Screen code | Action | API | Method | Request chính | Response chính | Loading | Success | Error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UI-ATT-SCREEN-001 | Load today | `/api/v1/attendance/today` | GET | - | status, allowed_actions | Skeleton card | Render card | ErrorState |
| UI-ATT-SCREEN-001 | Check-in | `/api/v1/attendance/check-in` | POST | source, location? | record | Button loading | Toast + refresh | Alert/Toast |

### 18.2 API response UI contract tối thiểu

Danh sách dữ liệu:

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 100
  },
  "meta": {
    "request_id": "req_xxx"
  }
}
```

Object detail:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "Pending",
    "allowed_actions": {}
  },
  "meta": {
    "request_id": "req_xxx"
  }
}
```

Validation error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dữ liệu không hợp lệ.",
    "fields": {
      "start_date": ["Ngày bắt đầu là bắt buộc."]
    }
  },
  "meta": {
    "request_id": "req_xxx"
  }
}
```

### 18.3 API integration notes theo module

| Module | Ghi chú UI/FE |
| --- | --- |
| AUTH | Load user context và permission trước khi render protected app |
| FOUNDATION | App registry, module status, settings, file upload, audit |
| DASH | Dashboard lazy-load widget, degraded state nếu widget lỗi |
| HR | Field-level permission, MaskedField, profile change request diff |
| ATT | Today status dựa trên backend allowed actions, không tự tính rule ở FE |
| LEAVE | Preview calculation trước submit, approve/reject xử lý conflict |
| TASK | Task detail cần comment/checklist/activity, Kanban drag/drop cần rollback nếu lỗi |
| NOTI | Dropdown nhẹ, unread count cache ngắn, deep link qua module gốc |

### 18.4 Query state recommendation

Nếu frontend dùng React Query/TanStack Query hoặc công cụ tương đương:

| Loại dữ liệu | Cache gợi ý | Invalidate khi |
| --- | --- | --- |
| Auth me/permissions | Theo session | Login/logout/role changed |
| App registry | 5-15 phút hoặc session | Module setting/permission changed |
| Notification unread | 30-60 giây hoặc polling nhẹ | Mark read/new notification |
| Dashboard widget | Theo TTL backend | Event invalidate/cache refresh |
| Attendance today | Ngắn, 15-60 giây | Check-in/out/adjustment/leave approved |
| Leave balance | Ngắn-vừa | Submit/approve/cancel leave |
| Task list | Ngắn-vừa | Update task/comment/status |
| HR employee list | Vừa | Create/update employee/profile approval |

---

## 19. Form handoff guide

### 19.1 Form field annotation

Mỗi field cần có:

```text
Field key:
Label:
Type:
Required:
Default value:
Placeholder:
Helper text:
Validation:
Permission view/edit:
Sensitive/masked:
API field mapping:
Error message:
Responsive behavior:
```

### 19.2 Form submit rule

| Rule | Yêu cầu |
| --- | --- |
| Required field | Validate client-side cơ bản trước submit |
| Server validation | Hiển thị inline theo field từ API 422 |
| Dirty form | Confirm khi rời route/drawer/modal nếu có thay đổi |
| Double submit | Disable submit khi loading |
| Save draft | Chỉ hiện nếu workflow có draft |
| Cancel | Nếu dirty thì confirm, nếu clean thì back/close |
| Success | Toast + redirect/refresh theo flow |
| Error | Giữ dữ liệu user đã nhập |

### 19.3 Dirty form guard

Dirty form guard áp dụng cho:

1. Leave request form.
2. Profile change request form.
3. Employee create/edit form.
4. Task create/edit form.
5. Role permission matrix.
6. Settings/config form.
7. Modal/drawer có chỉnh sửa dữ liệu.

Flow:

```text
User có form dirty
-> user click sidebar/app switcher/back/browser close
-> confirm dialog
-> Hủy: ở lại
-> Rời khỏi: discard changes và điều hướng
```

---

## 20. Responsive handoff guide

### 20.1 Breakpoint chuẩn

| Breakpoint | Width | Handoff yêu cầu |
| --- | --- | --- |
| Mobile | `<768px` | Frame hoặc annotation bắt buộc cho P0 |
| Tablet | `768-1023px` | Annotation bắt buộc, frame nếu layout phức tạp |
| Laptop | `1024-1199px` | Desktop frame có thể áp dụng |
| Desktop | `>=1200px` | Frame chính |
| Wide | `>=1440px` | Optional annotation |

### 20.2 Responsive layout rule

| Thành phần | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Topbar | Full | Search rút gọn | Compact |
| Sidebar | Fixed expanded/collapsed | Drawer/collapsed | Drawer/bottom sheet |
| App Switcher | Overlay/modal | Drawer/fullscreen | Fullscreen |
| Table | Full columns | Scroll/priority columns | Card list |
| Filter | Inline toolbar | Wrapped/drawer | Filter drawer |
| Drawer | Right drawer | Wide drawer | Fullscreen |
| Modal | Center | Center/wide | Near fullscreen |
| Page action | Header right | Header/dropdown | Sticky bottom hoặc compact menu |

### 20.3 Mobile card list annotation

Khi table chuyển sang card list, cần ghi rõ:

```text
Card title field:
Primary meta:
Status badge:
Secondary fields:
Hidden fields:
Row actions:
Tap behavior:
Swipe behavior nếu có:
```

Ví dụ bảng công mobile:

```text
Card title: Ngày + thứ
Primary meta: Check-in / Check-out
Status badge: On time / Late / Leave / Remote
Secondary fields: Ca làm, tổng giờ
Action: Xem chi tiết, tạo điều chỉnh
```

### 20.4 Sticky action trên mobile

Các màn form P0 nên có sticky action cuối màn:

| Screen | Sticky action |
| --- | --- |
| Create leave request | Lưu nháp / Gửi đơn |
| Check-in today | Check-in / Check-out button nếu phù hợp |
| Approval detail | Duyệt / Từ chối |
| Task detail | Update status / Comment |
| Profile change request | Gửi yêu cầu |

---

## 21. Accessibility handoff

### 21.1 Yêu cầu tối thiểu

| Nhóm | Yêu cầu |
| --- | --- |
| Contrast | Text thường >= 4.5:1, text lớn >= 3:1 |
| Keyboard | Tất cả action chính dùng được bằng keyboard |
| Focus | Focus ring rõ cho button, link, input, menu item |
| Screen reader | Icon-only button có aria-label |
| Form | Error message liên kết với field |
| Modal/drawer | Trap focus, ESC đóng nếu không mất dữ liệu |
| Toast | Toast quan trọng có aria-live |
| Color | Không truyền trạng thái chỉ bằng màu, cần text/icon |
| Touch target | Mobile target tối thiểu khoảng 44x44px |
| Reduced motion | Tôn trọng prefers-reduced-motion |

### 21.2 Accessibility annotation cho component

Mỗi component interactive cần có:

```text
Keyboard behavior:
Focus order:
ARIA label/role:
Screen reader text:
Disabled behavior:
Error announcement:
```

### 21.3 Flow keyboard quan trọng

| Flow | Yêu cầu |
| --- | --- |
| Login | Tab qua email -> password -> remember -> submit -> forgot |
| App Switcher | Mở bằng shortcut optional, search focus, arrow/tab qua app, ESC đóng |
| Modal confirm | Focus vào modal, không tab ra ngoài, ESC/cancel rõ |
| DataTable | Row action focus được, pagination focus được |
| Form validation | Submit lỗi focus field đầu tiên lỗi |
| Notification dropdown | Tab qua item, Enter mở target |

---

## 22. Frontend architecture handoff đề xuất

### 22.1 Cấu trúc thư mục frontend tham khảo

```text
src/
  app/
    providers/
    router/
    layouts/
  modules/
    auth/
    home/
    dashboard/
    hr/
    attendance/
    leave/
    tasks/
    notifications/
    system/
  shared/
    components/
    hooks/
    utils/
    services/
    constants/
    types/
  design-system/
    tokens/
    components/
    icons/
  api/
    clients/
    endpoints/
    types/
```

### 22.2 Layering rule

| Layer | Có thể import từ | Không nên import từ |
| --- | --- | --- |
| `design-system` | token, primitive | module nghiệp vụ |
| `shared` | design-system | module cụ thể nếu gây vòng |
| `modules/*` | shared, api, design-system | module khác trực tiếp nếu không qua shared contract |
| `app/router` | route registry | page internal logic |
| `api` | types, client | UI component |

### 22.3 Guard utility cần có

```ts
function hasPermission(permission: string): boolean;
function hasAnyPermission(permissions: string[]): boolean;
function getEffectiveScope(permission: string): DataScope | null;
function canAccessRoute(routeMeta: RouteMeta): boolean;
function canAccessModule(moduleCode: string): boolean;
function getAllowedActions(entity: unknown): Record<string, boolean>;
```

### 22.4 Component API design rule

Component nền tảng không nên biết nghiệp vụ cụ thể.

Ví dụ tốt:

```tsx
<Button variant="primary" loading={isSubmitting}>Gửi đơn</Button>
```

Ví dụ không tốt:

```tsx
<Button isLeaveSubmitButton status={leaveStatus}>Gửi đơn</Button>
```

Domain component mới biết nghiệp vụ:

```tsx
<LeaveSubmitButton requestStatus={status} allowedActions={allowedActions} />
```

---

## 23. QA handoff guide

### 23.1 QA checklist theo flow

| Flow | Checklist |
| --- | --- |
| Login | Success, wrong password, locked account, token expired, returnUrl |
| Home Portal | App visibility, search alias, recent/favorite, locked app, empty/error |
| App Switcher | Open from every protected screen, search, dirty form confirm, permission |
| Dashboard | Widget visibility, lazy load, degraded state, quick action route |
| Attendance | Check-in/out allowed actions, blocked by leave, missing checkout, remote auto |
| Leave | Create draft/submit, balance preview, insufficient balance, approve/reject/conflict |
| Task | My tasks, update status, comment, mention, checklist, Kanban move rollback |
| Notification | Unread count, dropdown, mark read, mark all read, deep link, forbidden target |
| HR | Employee list scope, profile masked fields, profile change request, approval diff |
| System | User/role list, permission matrix, dangerous permission warning, save diff |

### 23.2 QA checklist theo state

| State | Cần test |
| --- | --- |
| Loading | Skeleton đúng layout, không nhấp nháy dữ liệu trái quyền |
| Empty | Message đúng, CTA chỉ hiện nếu có quyền |
| Error | Retry hoạt động, có request id nếu backend trả |
| Forbidden | Không lộ dữ liệu, không render menu/action trái quyền |
| Disabled | Tooltip/alert lý do rõ |
| Validation | Inline error đúng field |
| Success | Toast + refresh/redirect đúng |
| Stale | Last updated/refresh đúng |
| Scope empty | Message phân biệt với empty toàn hệ thống |

### 23.3 QA checklist responsive

| Viewport | Cần test |
| --- | --- |
| Desktop | Sidebar expanded/collapsed, table columns, drawer width |
| Tablet | Sidebar drawer/collapsed, filter wrap, table scroll |
| Mobile | Card list, fullscreen drawer/modal, sticky actions, touch target |
| Wide | Content không giãn quá khó đọc, dashboard grid hợp lý |

### 23.4 QA checklist accessibility

| Nhóm | Cần test |
| --- | --- |
| Keyboard | Tab order, Enter/Space action, ESC close overlay |
| Focus | Focus ring rõ, focus trap modal/drawer |
| Screen reader | aria-label icon button, error announcement |
| Contrast | Text/semantic color đủ tương phản |
| Motion | Reduced motion không phá trải nghiệm |

---

## 24. Frontend implementation checklist

### 24.1 Sprint FE-00: Setup nền tảng

| Hạng mục | Trạng thái |
| --- | --- |
| App shell + router | Cần triển khai |
| Auth provider/session handling | Cần triển khai |
| API client + interceptor 401/403/422/500 | Cần triển khai |
| Design token setup | Cần triển khai |
| Base component setup | Cần triển khai |
| Route registry | Cần triển khai |
| Permission utility | Cần triển khai |
| Layout shells | Cần triển khai |
| Global error boundary | Cần triển khai |

### 24.2 Sprint FE-01: Navigation foundation

| Hạng mục | Trạng thái |
| --- | --- |
| Login flow | Cần triển khai |
| Load user context/permissions | Cần triển khai |
| Home Portal | Cần triển khai |
| App registry | Cần triển khai |
| App Switcher | Cần triển khai |
| ModuleWorkspaceLayout | Cần triển khai |
| Sidebar registry | Cần triển khai |
| Notification badge shell | Cần triển khai |

### 24.3 Sprint FE-02: Employee daily flows

| Hạng mục | Trạng thái |
| --- | --- |
| Dashboard default/employee widgets | Cần triển khai |
| Attendance Today | Cần triển khai |
| My attendance records | Cần triển khai |
| Leave balance | Cần triển khai |
| Create leave request | Cần triển khai |
| My tasks | Cần triển khai |
| Notification dropdown/list | Cần triển khai |

### 24.4 Sprint FE-03: Manager/HR flows

| Hạng mục | Trạng thái |
| --- | --- |
| Leave approval list/detail | Cần triển khai |
| Attendance adjustment approval | Cần triển khai |
| Team attendance records | Cần triển khai |
| Employee list/detail | Cần triển khai |
| Profile change request/approval | Cần triển khai |
| Task team/list/detail | Cần triển khai |

### 24.5 Sprint FE-04: Admin/system and hardening

| Hạng mục | Trạng thái |
| --- | --- |
| User/role/permission matrix | Cần triển khai |
| Module catalog/settings | Cần triển khai |
| Audit logs | Cần triển khai |
| Notification template/event UI | Cần triển khai |
| Responsive P0/P1 pass | Cần triển khai |
| Accessibility pass | Cần triển khai |
| Visual regression baseline | Khuyến nghị |

---

## 25. Backend/API handoff notes cho UI

### 25.1 API cần ổn định trước khi FE triển khai P0

| Nhóm API | Endpoint/contract cần có |
| --- | --- |
| Auth context | Login, refresh/logout, me, me/permissions |
| App registry | My apps/module status hoặc FE config + permission source |
| Notification shell | Unread count, dropdown latest, mark read |
| Attendance today | Today status + allowed_actions, check-in, check-out |
| Leave core | Balance, request create/submit, request detail, approvals |
| Task core | My tasks, task detail, update status, comments/checklist |
| HR core | My profile, employee list/detail, profile change request |
| Dashboard | Dashboard me/widgets nếu dashboard làm P0 |

### 25.2 Response cần hỗ trợ UI tốt

Backend nên trả:

1. `request_id` trong error.
2. `allowed_actions` cho workflow entity.
3. `disabled_reasons` nếu action bị chặn.
4. `status_label` hoặc status code đủ chuẩn để FE map.
5. Pagination metadata thống nhất.
6. Field error theo key form.
7. Data scope resolved nếu cần debug UI.
8. Last updated/cached_at cho widget cache.

---

## 26. UX copy handoff

### 26.1 Toast message chuẩn

| Tình huống | Message đề xuất |
| --- | --- |
| Check-in thành công | `Check-in thành công.` |
| Check-out thành công | `Check-out thành công.` |
| Gửi đơn nghỉ | `Đơn nghỉ đã được gửi và đang chờ duyệt.` |
| Lưu nháp | `Đã lưu nháp.` |
| Duyệt đơn | `Đã duyệt đơn nghỉ.` |
| Từ chối đơn | `Đã từ chối đơn nghỉ.` |
| Cập nhật task | `Đã cập nhật công việc.` |
| Mark read | `Đã đánh dấu thông báo là đã đọc.` |
| Save settings | `Đã lưu cấu hình.` |

### 26.2 Error message chuẩn

| Tình huống | Message đề xuất |
| --- | --- |
| Network | `Không thể kết nối đến máy chủ. Vui lòng thử lại.` |
| 403 | `Bạn không có quyền thực hiện thao tác này.` |
| 404 | `Không tìm thấy dữ liệu yêu cầu.` |
| 409 | `Dữ liệu đã thay đổi. Vui lòng tải lại và thử lại.` |
| Validation | `Vui lòng kiểm tra lại các thông tin đã nhập.` |
| Unknown | `Có lỗi xảy ra. Vui lòng thử lại sau.` |

### 26.3 Empty state chuẩn

| Tình huống | Message |
| --- | --- |
| Không có dữ liệu chung | `Chưa có dữ liệu.` |
| Không có dữ liệu trong scope | `Không có dữ liệu trong phạm vi của bạn.` |
| Không có thông báo | `Bạn chưa có thông báo nào.` |
| Không có task | `Bạn chưa có công việc nào cần xử lý.` |
| Không có đơn nghỉ | `Bạn chưa có đơn nghỉ phép nào.` |
| Không có nhân viên | `Chưa có nhân viên nào trong phạm vi của bạn.` |

---

## 27. Review & sign-off workflow

### 27.1 Các vòng review đề xuất

| Vòng | Người tham gia | Mục tiêu |
| --- | --- | --- |
| Review 1 | Product + UI/UX | Chốt flow, frame, state |
| Review 2 | Frontend Lead | Chốt component, token, route, responsive |
| Review 3 | Backend/API Lead | Chốt API mapping, allowed actions, error contract |
| Review 4 | QA Lead | Chốt test case, acceptance criteria |
| Review 5 | Stakeholder | Chốt trải nghiệm MVP |

### 27.2 Điều kiện sign-off UI/UX MVP

UI/UX MVP chỉ nên sign-off khi:

1. P0 prototype flows đã clickable.
2. P0/P1 screens có đủ state annotation.
3. Route registry và screen code đã khớp UI-04/UI-09.
4. Component mapping đã khớp UI-05.
5. API mapping đã được Backend/API review.
6. Permission/data scope behavior đã được QA review.
7. Responsive mobile cho P0 đã có frame hoặc annotation rõ.
8. Accessibility tối thiểu đã được kiểm tra.
9. Changelog đã ghi lại các thay đổi cuối.
10. Tất cả open question P0 đã được resolve hoặc ghi rõ owner/deadline.

---

## 28. Open questions cần chốt trước frontend sprint

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| UI10-OQ-001 | Frontend stack chính là React/Next/Vue hay framework khác? | Tech Lead | Cao |
| UI10-OQ-002 | App registry lấy từ API hay config frontend kết hợp permission? | FE + BE | Cao |
| UI10-OQ-003 | Có dùng Storybook ngay từ MVP không? | FE Lead | Trung bình |
| UI10-OQ-004 | Có dùng token export tự động từ Figma không? | UI/UX + FE | Trung bình |
| UI10-OQ-005 | Notification dropdown có realtime ngay MVP hay polling/cache? | BE + FE | Trung bình |
| UI10-OQ-006 | Dashboard widget cache TTL hiển thị cho user như thế nào? | BE + Product | Trung bình |
| UI10-OQ-007 | Mobile web có phải priority P0 cho tất cả flow hay chỉ Employee flow? | Product | Cao |
| UI10-OQ-008 | File upload preview dùng service nào và giới hạn file ra sao? | BE + FE | Trung bình |
| UI10-OQ-009 | Permission field-level cho HR nhạy cảm trả về theo mask hay FE tự mask? | BE + FE | Cao |
| UI10-OQ-010 | Có cần audit UI event ngoài audit backend không? | Product + Tech | Thấp |

---

## 29. Rủi ro handoff và cách giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| UI chỉ có ảnh, thiếu annotation | FE hiểu sai interaction | Bắt buộc interaction annotation cho P0 |
| Component không thống nhất | FE code trùng lặp | Component mapping + Storybook checklist |
| Permission hard-code theo role | Sai quyền khi role thay đổi | Route/app/sidebar metadata dựa permission |
| API chưa có allowed_actions | FE tự đoán business rule | Backend bổ sung allowed_actions cho workflow |
| Responsive không rõ | Mobile vỡ layout | Annotation cho P0 mobile |
| State thiếu | QA/FE bỏ sót lỗi | State matrix bắt buộc |
| Notification deep link bỏ qua module guard | Lộ route hoặc lỗi quyền | Deep link luôn route qua module gốc |
| Dashboard xử lý nghiệp vụ trực tiếp | Sai kiến trúc | Dashboard chỉ điều hướng/call module gốc nếu action thuộc module |
| Form dirty không xử lý | Mất dữ liệu user | Dirty form guard dùng chung |
| Error message không chuẩn | UX kém, khó debug | Error contract + UX copy dictionary |

---

## 30. Acceptance criteria UI-10

| Mã | Tiêu chí nghiệm thu |
| --- | --- |
| UI10-AC-001 | Có danh sách deliverable UI/UX cần bàn giao cho Frontend, Backend/API và QA |
| UI10-AC-002 | Có prototype strategy và danh sách prototype flow P0 bắt buộc |
| UI10-AC-003 | Có frame checklist theo module AUTH, HOME, DASH, HR, ATT, LEAVE, TASK, NOTI, SYSTEM |
| UI10-AC-004 | Có chuẩn interaction annotation cho click, modal, drawer, form, table, approval, notification |
| UI10-AC-005 | Có chuẩn state annotation cho loading, empty, error, forbidden, disabled, validation, success, stale |
| UI10-AC-006 | Có chuẩn permission/data scope handoff và không hard-code theo role |
| UI10-AC-007 | Có route registry, app registry và sidebar registry mẫu cho Frontend |
| UI10-AC-008 | Có component handoff guide mapping Figma component với Frontend component |
| UI10-AC-009 | Có design token handoff guideline |
| UI10-AC-010 | Có API integration handoff, response contract và module integration notes |
| UI10-AC-011 | Có form handoff, dirty form guard và validation rule |
| UI10-AC-012 | Có responsive handoff cho desktop, tablet và mobile web |
| UI10-AC-013 | Có accessibility handoff tối thiểu |
| UI10-AC-014 | Có frontend implementation checklist theo sprint |
| UI10-AC-015 | Có QA checklist theo flow, state, responsive và accessibility |
| UI10-AC-016 | Có review/sign-off workflow cho UI/UX MVP |
| UI10-AC-017 | Có open questions và rủi ro cần chốt trước frontend sprint |
| UI10-AC-018 | Tài liệu đủ để bắt đầu Frontend implementation MVP mà không phải suy đoán layout, flow, route, component, state và permission behavior |

---

## 31. Kết luận

UI-10 chốt cách đóng gói prototype và bàn giao UI/UX sang Frontend cho MVP.

Tư duy triển khai chính:

```text
Prototype rõ flow
-> Annotation rõ interaction
-> Component mapping rõ ràng
-> Route/menu/app registry theo permission
-> API mapping theo module gốc
-> State/responsive/accessibility đầy đủ
-> QA có checklist test được
-> Frontend có thể bắt đầu implementation theo sprint
```

Sau UI-10, bước tiếp theo của dự án nên là:

```text
FRONTEND-01: Frontend Architecture & Project Setup
FRONTEND-02: Design System Implementation
FRONTEND-03: Auth, Route Guard, Home Portal & App Switcher
FRONTEND-04: Module Workspace Layout
FRONTEND-05: Core MVP Screens Implementation
QA-01: UI/API Test Case Design
```

