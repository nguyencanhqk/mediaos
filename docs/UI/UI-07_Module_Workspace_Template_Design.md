# UI-07: MODULE WORKSPACE TEMPLATE DESIGN
# THIẾT KẾ TEMPLATE KHÔNG GIAN LÀM VIỆC THEO MODULE

> **📚 Bộ tài liệu UI — Hệ thống Quản lý Doanh nghiệp**
> [UI-01 Tổng quan](<UI-01_UIUX_Design_Tong_Quan.md>) · [UI-02 IA/Sitemap](<UI-02_Information_Architecture_Sitemap.md>) · [UI-03 User Flow](<UI-03_User_Flow_MVP.md>) · [UI-04 Screen List](<UI-04_Screen_List_Wireframe_Plan.md>) · [UI-05 Design System](<UI-05_Design_System_Component_Library.md>) · [UI-06 Home/App Switcher](<UI-06_Home_Portal_App_Switcher_UI_Design.md>) · **UI-07 Module Workspace** · [UI-08 Dashboard](<UI-08_Dashboard_UIUX_Design.md>) · [UI-09 Module UI](<UI-09_Module_UI_Design.md>) · [UI-10 Prototype/Handoff](<UI-10_Prototype_Frontend_Handoff_Guide.md>)
>
> **Liên quan:** [Đặc tả: SPEC-01 Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) · [Module/registry: API-09 FOUNDATION](<../API Design/API-09_FOUNDATION_API_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | UI-07 |
| Tên tài liệu | Module Workspace Template Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-05 |
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

Tài liệu UI-07 định nghĩa **template chuẩn cho Module Workspace** trong hệ thống quản lý doanh nghiệp nội bộ.

Module Workspace là không gian làm việc chi tiết sau khi người dùng chọn một ứng dụng/module từ **Home Portal** hoặc **App Switcher**. Đây là layout cốt lõi dùng cho các module MVP như Dashboard, Nhân sự, Chấm công, Nghỉ phép, Công việc, Thông báo và Hệ thống.

UI-07 dùng để:

1. Chốt cấu trúc layout chuẩn cho mọi module nghiệp vụ.
2. Chuẩn hóa topbar, sidebar, content shell, page header, filter, action, table, form, detail, drawer và modal.
3. Định nghĩa các page template tái sử dụng: overview, list, detail, form, approval, kanban, calendar, report, settings, audit log.
4. Định nghĩa cách mỗi module kế thừa template chung nhưng vẫn có menu và nghiệp vụ riêng.
5. Làm cơ sở cho UI/UX Designer dựng wireframe và high-fidelity thống nhất.
6. Làm cơ sở cho Frontend xây `ModuleWorkspaceLayout` reusable.
7. Làm checklist cho Backend/API về dữ liệu cần trả cho menu, permission, badge, counter và page state.
8. Làm cơ sở cho QA kiểm thử route guard, permission UI, responsive, loading, empty, error và forbidden state.

UI-07 không đi sâu vào thiết kế chi tiết từng màn hình nghiệp vụ. Thiết kế chi tiết từng module sẽ được triển khai ở các tài liệu sau như UI-08 Dashboard UI Design và UI-09 Module UI Design.

---

## 3. Căn cứ thiết kế

UI-07 bám theo các quyết định đã chốt trong bộ tài liệu UI trước đó:

1. Sau đăng nhập, người dùng vào **Home Portal** trước.
2. Từ Home Portal, người dùng chọn app/module để vào **Module Workspace**.
3. Trong mọi màn hình protected, người dùng có thể bấm nút **Ứng dụng** để mở **App Switcher**.
4. Module Workspace có sidebar riêng theo từng module.
5. Topbar dùng chung toàn hệ thống.
6. App, menu, route, button, quick action, badge và widget phải hiển thị theo permission và data scope.
7. Frontend chỉ ẩn/hiện UI để cải thiện trải nghiệm. Backend vẫn là lớp kiểm tra quyền cuối cùng.
8. Home Portal, Dashboard và App Switcher chỉ tổng hợp/điều hướng, không xử lý nghiệp vụ gốc.
9. Notification deep link và dashboard quick action phải điều hướng về module gốc để module đó kiểm tra lại permission, data scope và business rule.
10. Component sử dụng trong Module Workspace phải bám theo UI-05 Design System & Component Library.

---

## 4. Phạm vi UI-07

### 4.1 Bao gồm trong tài liệu này

| Nhóm | Nội dung |
| --- | --- |
| Layout foundation | ModuleWorkspaceLayout, Topbar, Sidebar, MainContentShell |
| Navigation | Breadcrumb, sidebar group, active state, collapse, badge, deep link |
| Page structure | PageHeader, action group, filter bar, tabs, content area |
| Page template | Overview, list/table, detail, form, approval, kanban, calendar, report, settings, audit log |
| Permission behavior | Hide, disable, forbidden, masked field, empty due to scope |
| State behavior | Loading, empty, error, forbidden, disabled module, stale data |
| Responsive | Desktop, tablet, mobile behavior của workspace |
| Module mapping | DASH, HR, ATT, LEAVE, TASK, NOTI, AUTH/SYSTEM workspace |
| Frontend handoff | Component tree, route metadata, sidebar config, layout slots |
| QA checklist | Acceptance criteria và test checklist |

### 4.2 Không bao gồm sâu trong tài liệu này

| Nội dung | Tài liệu xử lý |
| --- | --- |
| Home Portal high-fidelity | UI-06 |
| App Switcher high-fidelity | UI-06 |
| Dashboard widget chi tiết theo role | UI-08 |
| Từng màn hình HR/ATT/LEAVE/TASK/NOTI chi tiết | UI-09 |
| Prototype tương tác cuối cùng | UI-10 hoặc Figma prototype |
| Mobile app native | Tài liệu Mobile UI riêng ở phase sau |

---

## 5. Định nghĩa Module Workspace

### 5.1 Khái niệm

**Module Workspace** là layout làm việc chuyên sâu cho một module cụ thể.

Ví dụ:

```text
/home
  -> người dùng chọn app Nhân sự
  -> /hr
  -> HR Module Workspace

/attendance/today
  -> ATT Module Workspace

/tasks/kanban
  -> TASK Module Workspace
```

Module Workspace không phải là một màn hình đơn lẻ. Nó là **khung layout** chứa nhiều màn hình con của module.

### 5.2 Vai trò của Module Workspace

Module Workspace cần giúp người dùng:

1. Nhận biết mình đang ở module nào.
2. Điều hướng nhanh giữa các màn hình con trong module.
3. Thực hiện nghiệp vụ chính như xem danh sách, tạo mới, duyệt, cập nhật, xuất dữ liệu.
4. Chuyển sang module khác nhanh bằng App Switcher.
5. Nhận thông báo và quay lại nghiệp vụ gốc bằng deep link.
6. Làm việc hiệu quả với bảng dữ liệu lớn, form dài, drawer chi tiết, modal xác nhận và bộ lọc.

### 5.3 Nguyên tắc thiết kế

| Nguyên tắc | Diễn giải |
| --- | --- |
| Tách portal và workspace | Home Portal chỉ là cổng vào; Workspace mới xử lý nghiệp vụ sâu. |
| Một layout, nhiều module | Dùng chung layout shell, nhưng sidebar/menu/action thay đổi theo module. |
| Permission-driven | Menu/action/widget hiển thị theo permission backend trả về. |
| Data scope-aware | Dữ liệu trong content area tuân thủ Own/Team/Department/Company/System. |
| Table-first cho nghiệp vụ quản trị | HR, ATT, LEAVE, NOTI, SYSTEM ưu tiên table + filter + detail drawer. |
| Task-first cho công việc | TASK cần hỗ trợ list, kanban, detail và comment tốt hơn table thuần. |
| Không làm quá sâu menu | MVP không nên quá 2 cấp sidebar. |
| State đầy đủ | Loading, empty, error, forbidden, disabled, validation là bắt buộc. |
| Responsive có chủ đích | Desktop tối ưu productivity; tablet/mobile ưu tiên đọc, quick action và drawer. |

---

## 6. Anatomy tổng thể của Module Workspace

### 6.1 Cấu trúc desktop chuẩn

```text
+--------------------------------------------------------------------------------+
| GLOBAL TOPBAR                                                                  |
| Logo/Home | Current App | Search                         Apps | Noti | Avatar |
+----------------------------+---------------------------------------------------+
| MODULE SIDEBAR             | PAGE HEADER                                       |
| App identity               | Breadcrumb                                        |
| Navigation group           | Title + Description                    Actions   |
| Navigation item + badge    +---------------------------------------------------+
| Settings group             | FILTER / TABS / VIEW SWITCH                      |
| Collapse button            +---------------------------------------------------+
|                            | MAIN CONTENT                                      |
|                            | Table / Form / Detail / Kanban / Calendar / etc. |
|                            |                                                   |
+----------------------------+---------------------------------------------------+
```

### 6.2 Cây component tổng quát

```text
ModuleWorkspaceLayout
├── GlobalTopbar
│   ├── HomeLogoButton
│   ├── CurrentAppIndicator
│   ├── GlobalSearch / ModuleSearch
│   ├── AppSwitcherButton
│   ├── NotificationBadge
│   ├── HelpButton optional
│   └── AvatarMenu
├── ModuleSidebar
│   ├── ModuleIdentity
│   ├── SidebarNavGroup[]
│   ├── SidebarNavItem[]
│   ├── SidebarBadge optional
│   └── CollapseToggle
└── MainContentShell
    ├── Breadcrumb
    ├── PageHeader
    │   ├── Title
    │   ├── Description optional
    │   ├── PrimaryAction optional
    │   └── SecondaryActions optional
    ├── PageToolbar optional
    │   ├── SearchInput optional
    │   ├── FilterBar optional
    │   ├── Tabs optional
    │   ├── ViewSwitcher optional
    │   └── BulkActionBar optional
    ├── PageBody
    ├── RightDrawer optional
    ├── ModalLayer optional
    └── ToastLayer
```

### 6.3 Slot layout chuẩn

| Slot | Bắt buộc | Mục đích |
| --- | --- | --- |
| `topbar` | Có | Điều hướng global, app switcher, notification, avatar. |
| `sidebar` | Có trên desktop/tablet | Điều hướng trong module hiện tại. |
| `breadcrumb` | Có | Cho biết vị trí trong module. |
| `pageHeader` | Có | Tiêu đề, mô tả, hành động chính. |
| `toolbar` | Tùy màn | Search, filter, tabs, sort, view switch. |
| `content` | Có | Nội dung chính của màn hình. |
| `rightPanel` | Tùy màn | Detail drawer, quick view, activity, helper. |
| `modal` | Tùy hành động | Confirm, form nhanh, approve/reject. |
| `feedback` | Có | Toast, alert, error, validation. |

---

## 7. Quy chuẩn kích thước layout

### 7.1 Desktop

| Thành phần | Kích thước đề xuất |
| --- | --- |
| Topbar height | 56px - 64px |
| Sidebar expanded width | 248px - 280px |
| Sidebar collapsed width | 64px - 72px |
| Main content padding | 24px |
| Page header height | Auto, tối thiểu 72px |
| Toolbar height | 48px - 64px |
| Table row height | 44px - 56px |
| Drawer width | 420px - 720px tùy nội dung |
| Modal width small | 360px - 480px |
| Modal width medium | 560px - 720px |
| Modal width large | 800px - 960px |

### 7.2 Tablet

| Thành phần | Behavior |
| --- | --- |
| Topbar | Giữ đầy đủ nhưng search có thể thu gọn thành icon. |
| Sidebar | Mặc định collapsed hoặc drawer. |
| Main padding | 16px - 20px. |
| Table | Ưu tiên horizontal scroll hoặc responsive column priority. |
| Drawer | Có thể full-height, width 70% - 85%. |

### 7.3 Mobile web

| Thành phần | Behavior |
| --- | --- |
| Topbar | Logo/Home, app name rút gọn, Apps, Noti, Avatar/Menu. |
| Sidebar | Không cố định; mở dạng drawer hoặc bottom sheet. |
| Page header | Title + primary action rút gọn. |
| Toolbar | Filter mở drawer; search full width. |
| Table | Chuyển sang card list nếu màn nghiệp vụ thường dùng mobile. |
| Drawer | Full screen. |
| Modal | Full width gần fullscreen. |

---

## 8. Global Topbar Template

### 8.1 Mục đích

Global Topbar là thanh điều hướng chung xuất hiện trên mọi màn protected.

Topbar giúp người dùng:

1. Biết module hiện tại.
2. Quay về Home Portal.
3. Tìm kiếm nhanh.
4. Mở App Switcher.
5. Xem thông báo.
6. Mở hồ sơ cá nhân, đổi mật khẩu, đăng xuất.

### 8.2 Desktop anatomy

```text
+--------------------------------------------------------------------------------+
| [Logo/Home] [Module icon] Module name | Search...      [Ứng dụng] [Noti] [Avatar]|
+--------------------------------------------------------------------------------+
```

### 8.3 Thành phần

| Thành phần | Bắt buộc MVP | Rule |
| --- | --- | --- |
| Logo/Home | Có | Click về `/home`. |
| Current app indicator | Có | Hiển thị icon + tên module hiện tại. |
| Search | Có thể có | Tìm trong module hiện tại hoặc global search tùy cấu hình. |
| App Switcher button | Có | Luôn hiển thị với user đã đăng nhập. |
| Notification badge | Có | Chỉ hiển thị nếu user có quyền xem thông báo của mình. |
| Help button | Optional | Có thể để phase sau. |
| Settings shortcut | Optional | Chỉ hiện nếu có quyền cấu hình. |
| Avatar menu | Có | Profile, account settings, logout. |

### 8.4 App Switcher button

Nút App Switcher phải:

1. Dễ nhận biết, dùng nhãn `Ứng dụng` hoặc icon grid + tooltip.
2. Có trạng thái focus/hover rõ.
3. Có shortcut bàn phím nếu frontend hỗ trợ, ví dụ `Ctrl + K` mở search/app launcher.
4. Khi mở App Switcher, giữ nguyên route hiện tại phía sau overlay.
5. Khi chọn app khác, điều hướng sang module root hoặc route gần nhất user đã mở trong module đó nếu cấu hình cho phép.

### 8.5 Notification badge

Notification badge cần:

1. Hiển thị số unread nếu có.
2. Không hiển thị số nếu user không có quyền `NOTI.NOTIFICATION.VIEW_OWN`.
3. Click mở notification dropdown.
4. Item trong dropdown có thể deep link sang module gốc.
5. Khi deep link, module gốc phải kiểm tra quyền lại.

### 8.6 Avatar menu

Avatar menu đề xuất gồm:

```text
Hồ sơ của tôi
Tài khoản cá nhân
Đổi mật khẩu
Cài đặt giao diện nếu có
Đăng xuất
```

Với Admin/HR có thể thêm:

```text
Quản trị hệ thống
Cấu hình công ty
Audit log
```

---

## 9. Module Sidebar Template

### 9.1 Mục đích

Module Sidebar là menu điều hướng riêng của từng module.

Sidebar trả lời câu hỏi:

```text
Trong module này tôi có thể đi đến những khu vực nào?
```

### 9.2 Quy tắc hiển thị sidebar

1. Sidebar chỉ hiển thị trong Module Workspace.
2. Sidebar chỉ chứa menu của module hiện tại.
3. Menu được render từ cấu hình route/menu metadata, không hard-code theo role.
4. Menu không có quyền thì ẩn.
5. Menu cha chỉ hiện nếu có ít nhất một menu con được phép hiển thị.
6. Badge/counter chỉ hiện nếu user có quyền xem dữ liệu tương ứng.
7. Sidebar có trạng thái expanded/collapsed.
8. Mỗi module có thể có nhóm `Tổng quan`, `Nghiệp vụ`, `Quản lý`, `Báo cáo`, `Thiết lập`.
9. Không nên vượt quá 2 cấp trong MVP.

### 9.3 Sidebar anatomy

```text
+----------------------------+
| [Icon] Module name          |
| Short module description    |
+----------------------------+
| Tổng quan                   |
|   Dashboard                 |
| Nghiệp vụ                   |
|   Nhân viên            [12] |
|   Hợp đồng                  |
|   Yêu cầu chờ duyệt    [3]  |
| Quản lý                     |
|   Phòng ban                 |
|   Chức vụ                   |
| Báo cáo                     |
|   Báo cáo                   |
| Thiết lập                   |
|   Cài đặt                   |
+----------------------------+
| [<<] Thu gọn                |
+----------------------------+
```

### 9.4 Sidebar item metadata

```ts
interface WorkspaceSidebarItem {
  key: string;
  moduleCode: 'DASH' | 'HR' | 'ATT' | 'LEAVE' | 'TASK' | 'NOTI' | 'AUTH' | 'FOUNDATION';
  label: string;
  path?: string;
  icon?: string;
  group?: 'overview' | 'operation' | 'management' | 'report' | 'settings' | 'admin';
  parentKey?: string;
  order: number;
  exact?: boolean;
  requiredPermissions?: string[];
  requiredAnyPermissions?: string[];
  requiredScopes?: Array<'Own' | 'Team' | 'Department' | 'Project' | 'Company' | 'System'>;
  featureFlag?: string;
  badgeSource?: string;
  badgeVariant?: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
  isBeta?: boolean;
  isComingSoon?: boolean;
  children?: WorkspaceSidebarItem[];
}
```

### 9.5 Sidebar state

| State | UI behavior |
| --- | --- |
| Expanded | Hiển thị icon, label, badge, group label. |
| Collapsed | Chỉ hiển thị icon, tooltip label, badge dạng dot/số nhỏ. |
| Active item | Highlight item, bold label, active left border hoặc nền nhẹ. |
| Parent active | Mở nhóm cha, highlight cha nhẹ. |
| Hover | Nền nhẹ, cursor pointer. |
| Disabled feature | Có thể ẩn hoặc hiển thị khóa tùy policy. |
| Forbidden menu | Không render. |
| Empty sidebar | Hiển thị message `Bạn chưa có quyền sử dụng chức năng trong ứng dụng này.` |

### 9.6 Badge/counter trong sidebar

| Badge | Ví dụ | Nguồn dữ liệu |
| --- | --- | --- |
| Pending approval | Đơn nghỉ chờ duyệt `3` | LEAVE approval count theo scope |
| Unread | Thông báo chưa đọc `12` | NOTI unread count |
| Overdue | Task quá hạn `5` | TASK overdue count |
| Alert | Bất thường chấm công `2` | ATT anomaly/adjustment count |
| Draft | Nháp của tôi `1` | Module source API |

Badge phải tuân thủ permission và data scope. Không được hiển thị số liệu ngoài phạm vi user được phép xem.

---

## 10. Main Content Shell Template

### 10.1 Mục đích

Main Content Shell là phần nội dung chính bên phải sidebar, chứa mọi màn hình nghiệp vụ.

Shell cần nhất quán để user không bị thay đổi trải nghiệm giữa HR, ATT, LEAVE, TASK, NOTI và SYSTEM.

### 10.2 Anatomy chuẩn

```text
+--------------------------------------------------------------+
| Breadcrumb                                                   |
| Page title                                      Primary CTA   |
| Page description                              Secondary CTA   |
+--------------------------------------------------------------+
| Toolbar: search / filter / tabs / view switch / bulk action  |
+--------------------------------------------------------------+
| Alert / contextual notice optional                           |
+--------------------------------------------------------------+
| Content area                                                 |
+--------------------------------------------------------------+
```

### 10.3 PageHeader

PageHeader gồm:

| Thành phần | Bắt buộc | Ghi chú |
| --- | --- | --- |
| Breadcrumb | Có | Ví dụ `Nhân sự / Nhân viên`. |
| Title | Có | Tên màn hình rõ ràng. |
| Description | Optional | Nên có cho màn cấu hình/phức tạp. |
| Primary action | Theo quyền | Ví dụ `+ Thêm nhân viên`, `+ Tạo đơn nghỉ`. |
| Secondary actions | Theo quyền | Import, export, refresh, more menu. |
| Status badge | Optional | Dùng cho detail page: Draft, Pending, Approved. |

### 10.4 Toolbar

Toolbar có thể chứa:

1. Search input.
2. Filter dropdown.
3. Date range picker.
4. Department/team selector.
5. Status tabs.
6. View switch: table/card/kanban/calendar.
7. Sort.
8. Bulk action bar.
9. Refresh.
10. Saved view nếu phase sau.

### 10.5 Contextual alert

Dùng cho cảnh báo nghiệp vụ:

| Màn | Ví dụ alert |
| --- | --- |
| ATT Today | `Bạn đã có đơn nghỉ phép được duyệt hôm nay, không thể check-in.` |
| LEAVE Form | `Số ngày phép còn lại không đủ cho đơn này.` |
| TASK Assign | `Assignee đang nghỉ phép trong ngày deadline.` |
| HR Detail | `Một số trường nhạy cảm đã được ẩn do quyền truy cập.` |
| SYSTEM Settings | `Thay đổi cấu hình có thể ảnh hưởng toàn công ty.` |

---

## 11. Page Template 01 - Overview Template

### 11.1 Mục đích

Overview Template dùng cho trang tổng quan của từng module.

Ví dụ:

1. `/hr` - Tổng quan nhân sự.
2. `/attendance` - Tổng quan chấm công.
3. `/leave` - Tổng quan nghỉ phép.
4. `/tasks` - Tổng quan công việc.
5. `/system` - Tổng quan hệ thống.

### 11.2 Wireframe

```text
+--------------------------------------------------------------------------------+
| Breadcrumb / Module overview                                      [Refresh]     |
| Tổng quan module                                                               |
+--------------------------------------------------------------------------------+
| Metric card       Metric card       Metric card       Metric card              |
+--------------------------------------------------------------------------------+
| Main widget / chart / list                        Side widget / quick actions  |
|                                                     Recent activity             |
+--------------------------------------------------------------------------------+
| Recent records / Pending items / Alerts                                           |
+--------------------------------------------------------------------------------+
```

### 11.3 Thành phần

| Thành phần | Mô tả |
| --- | --- |
| Metric cards | Số liệu quan trọng theo quyền và scope. |
| Quick actions | Hành động nhanh: tạo đơn, check-in, tạo task, thêm nhân viên. |
| Pending list | Các mục cần xử lý. |
| Recent activity | Lịch sử gần đây. |
| Alert list | Cảnh báo quan trọng. |

### 11.4 Rule

1. Overview không thay thế dashboard tổng. Đây là tổng quan trong module.
2. Không xử lý nghiệp vụ sâu tại overview, chỉ điều hướng hoặc mở modal/drawer nếu action đơn giản.
3. Số liệu phải theo data scope.
4. Widget không có quyền thì ẩn.
5. Nếu module nguồn lỗi một widget, không làm sập cả trang; hiển thị widget error riêng.

---

## 12. Page Template 02 - List/Table Template

### 12.1 Mục đích

List/Table Template dùng cho các màn danh sách có filter, phân trang, sort, export.

Ví dụ:

1. Danh sách nhân viên.
2. Bảng công.
3. Danh sách đơn nghỉ.
4. Danh sách task.
5. Danh sách thông báo.
6. Audit log.

### 12.2 Wireframe

```text
+--------------------------------------------------------------------------------+
| Breadcrumb                                                                      |
| Danh sách nhân viên                                      [+ Thêm] [Export] [...] |
+--------------------------------------------------------------------------------+
| Search... | Phòng ban | Trạng thái | Ngày | More filters | Reset | Saved view    |
+--------------------------------------------------------------------------------+
| [ ] Bulk action bar nếu có item được chọn                                       |
+--------------------------------------------------------------------------------+
| Table header                                                                    |
| Row 1                                                                           |
| Row 2                                                                           |
| Row 3                                                                           |
+--------------------------------------------------------------------------------+
| Pagination: 1 2 3 ... | Per page                                               |
+--------------------------------------------------------------------------------+
```

### 12.3 Thành phần bắt buộc

| Thành phần | Bắt buộc | Ghi chú |
| --- | --- | --- |
| PageHeader | Có | Title + primary action nếu có quyền. |
| Search | Nên có | Tìm nhanh theo tên/mã/email/title. |
| FilterBar | Có nếu danh sách lớn | Status, department, date range. |
| DataTable | Có | Sort, column, row action. |
| Pagination | Có | Offset hoặc cursor tùy API. |
| EmptyState | Có | Khi không có dữ liệu. |
| ErrorState | Có | Khi API lỗi. |
| LoadingState | Có | Skeleton table. |

### 12.4 DataTable column pattern

| Loại cột | Ví dụ | Rule |
| --- | --- | --- |
| Identity | Mã + tên nhân viên | Luôn rõ đối tượng chính. |
| Status | Active/Pending/Approved | Dùng badge semantic. |
| Owner/Assignee | Người phụ trách | Avatar + name. |
| Date/time | Created, deadline | Format nhất quán. |
| Scope indicator | Own/Team/Company | Chỉ dùng khi cần giải thích phạm vi. |
| Actions | View/Edit/Delete/Approve | Theo permission từng row. |

### 12.5 Row action rule

1. Action không có quyền thì ẩn.
2. Action có quyền nhưng business rule không cho phép thì disable kèm tooltip.
3. Hành động nguy hiểm như xóa, hủy, từ chối phải có confirm dialog.
4. Hành động duyệt/từ chối nên mở drawer/modal để xem đủ thông tin trước khi submit.
5. Row click mặc định mở detail hoặc drawer tùy màn.

### 12.6 Empty state theo nguyên nhân

| Nguyên nhân | Message |
| --- | --- |
| Không có dữ liệu thật | `Chưa có dữ liệu.` |
| Filter quá hẹp | `Không tìm thấy kết quả phù hợp với bộ lọc.` |
| Không có dữ liệu do scope | `Bạn chưa có dữ liệu trong phạm vi được cấp quyền.` |
| Module chưa cấu hình | `Chức năng này cần được cấu hình trước khi sử dụng.` |
| Không có quyền tạo | Ẩn CTA tạo mới, chỉ hiển thị hướng dẫn xem dữ liệu. |

---

## 13. Page Template 03 - Detail Template

### 13.1 Mục đích

Detail Template dùng để xem chi tiết một entity.

Ví dụ:

1. Hồ sơ nhân viên.
2. Chi tiết ngày công.
3. Chi tiết đơn nghỉ.
4. Chi tiết task.
5. Chi tiết thông báo.
6. Chi tiết user/role.

### 13.2 Wireframe full page

```text
+--------------------------------------------------------------------------------+
| Breadcrumb                                                                      |
| Nguyễn Văn A / EMP0001                    [Edit] [More]                         |
| Active · Phòng Kỹ thuật · Nhân viên chính thức                                  |
+--------------------------------------------------------------------------------+
| Tabs: Tổng quan | Thông tin | File | Lịch sử | Audit                            |
+--------------------------------------------------------------------------------+
| Main detail sections                                      Right summary panel   |
| - Section 1                                                - Status             |
| - Section 2                                                - Owner              |
| - Section 3                                                - Quick actions      |
|                                                            - Activity           |
+--------------------------------------------------------------------------------+
```

### 13.3 Wireframe drawer detail

```text
+----------------------------------------------------------+
| Drawer title                                  [X]         |
| Status badge                                               |
+----------------------------------------------------------+
| Summary fields                                             |
| Detail fields                                              |
| Activity timeline                                          |
+----------------------------------------------------------+
| [Secondary]                                  [Primary]     |
+----------------------------------------------------------+
```

### 13.4 Khi dùng full page và khi dùng drawer

| Trường hợp | Dùng full page | Dùng drawer |
| --- | --- | --- |
| Entity phức tạp nhiều tab | Có | Không ưu tiên |
| Xem nhanh từ table | Optional | Có |
| Cần URL share/deep link | Có | Drawer có thể sync URL nhưng phức tạp hơn |
| Duyệt nhanh | Không bắt buộc | Có |
| Task detail nhiều tương tác | Có | Drawer quick view optional |
| Notification detail đơn giản | Có thể full page | Drawer/dropdown quick view optional |

### 13.5 Detail section pattern

| Section | Nội dung |
| --- | --- |
| Summary header | Tên entity, mã, status, metadata chính. |
| Key facts | Các trường quan trọng nhất. |
| Detail sections | Nhóm thông tin có tiêu đề. |
| Related records | File, comment, approval, activity. |
| Audit/activity | Timeline thay đổi. |
| Action footer | Edit, approve, reject, cancel, delete. |

### 13.6 Field-level permission

Với dữ liệu nhạy cảm:

1. Nếu không có quyền xem, không trả dữ liệu từ backend.
2. UI hiển thị `••••••` hoặc ẩn trường tùy policy.
3. Có thể hiển thị tooltip `Bạn không có quyền xem thông tin này.`
4. Không được render dữ liệu nhạy cảm rồi chỉ che bằng CSS.

---

## 14. Page Template 04 - Form Template

### 14.1 Mục đích

Form Template dùng cho tạo mới, cập nhật hoặc cấu hình.

Ví dụ:

1. Tạo nhân viên.
2. Cập nhật hồ sơ.
3. Gửi yêu cầu sửa hồ sơ cá nhân.
4. Tạo đơn nghỉ.
5. Tạo task.
6. Cấu hình ca làm/rule.
7. Cấu hình notification template.

### 14.2 Wireframe

```text
+--------------------------------------------------------------------------------+
| Breadcrumb                                                                      |
| Tạo đơn nghỉ phép                                      [Lưu nháp] [Gửi đơn]      |
+--------------------------------------------------------------------------------+
| Alert / guide nếu cần                                                           |
+--------------------------------------------------------------------------------+
| Form section 1                                                                  |
| [Field] [Field]                                                                 |
| [Field full width]                                                              |
+--------------------------------------------------------------------------------+
| Form section 2                                                                  |
| [Upload] [Textarea]                                                             |
+--------------------------------------------------------------------------------+
| Preview / Calculation / Validation summary                                      |
+--------------------------------------------------------------------------------+
| Sticky footer                                             [Cancel] [Save]       |
+--------------------------------------------------------------------------------+
```

### 14.3 Form section rule

1. Chia form theo nhóm rõ ràng.
2. Trường bắt buộc có indicator.
3. Validation hiển thị ngay dưới field và summary nếu lỗi nhiều.
4. Form dài nên có sticky action footer.
5. Có thể lưu nháp nếu nghiệp vụ hỗ trợ.
6. Hành động submit cần loading state và chống double submit.
7. Nếu có tính toán preview, đặt preview bên dưới hoặc right panel.

### 14.4 Field layout

| Loại form | Layout đề xuất |
| --- | --- |
| Form ngắn | 1 cột hoặc 2 cột trong card. |
| Form dài HR | Section + 2 cột desktop, 1 cột mobile. |
| Form nghỉ phép | 1-2 cột + preview calculation. |
| Form task | Main form + right metadata panel. |
| Form settings | Group theo category, có save từng nhóm. |

### 14.5 Validation state

| State | UI behavior |
| --- | --- |
| Required missing | Field error + message. |
| Invalid format | Field error cụ thể. |
| Business conflict | Alert phía trên form + field highlight nếu liên quan. |
| Permission denied | Disable field hoặc ẩn action. |
| Submit loading | Disable button, spinner. |
| Submit success | Toast + điều hướng hoặc giữ lại tùy action. |
| Submit failed | Error alert + retry. |

---

## 15. Page Template 05 - Approval Template

### 15.1 Mục đích

Approval Template dùng cho các màn phê duyệt/từ chối.

Ví dụ:

1. Duyệt đơn nghỉ.
2. Duyệt điều chỉnh công.
3. Duyệt yêu cầu cập nhật hồ sơ cá nhân.
4. Phase sau: duyệt overtime, payroll, asset request.

### 15.2 List approval wireframe

```text
+--------------------------------------------------------------------------------+
| Đơn cần duyệt                                           [Refresh] [Export]       |
+--------------------------------------------------------------------------------+
| Search | Loại yêu cầu | Người gửi | Trạng thái | Ngày gửi | Scope              |
+--------------------------------------------------------------------------------+
| Pending approval table                                                        |
| Row: request code, requester, type, date, summary, status, actions             |
+--------------------------------------------------------------------------------+
```

### 15.3 Approval detail wireframe

```text
+--------------------------------------------------------------------------------+
| Chi tiết yêu cầu #REQ001                     [Từ chối] [Duyệt]                 |
| Pending · Người gửi · Ngày gửi                                                  |
+--------------------------------------------------------------------------------+
| Before / After comparison nếu có                                                |
+--------------------------------------------------------------------------------+
| Request information                                                             |
| Reason / attachment                                                             |
| Impact preview                                                                  |
+--------------------------------------------------------------------------------+
| Approval history / comment                                                      |
+--------------------------------------------------------------------------------+
```

### 15.4 Approve/reject modal

```text
+------------------------------------------+
| Xác nhận duyệt yêu cầu                   |
| Bạn có chắc muốn duyệt yêu cầu này?      |
| Ghi chú optional                         |
| [Hủy]                         [Duyệt]    |
+------------------------------------------+
```

Reject cần bắt buộc nhập lý do nếu policy yêu cầu.

### 15.5 Rule approval

1. Chỉ hiển thị yêu cầu trong scope được phép.
2. Người duyệt không được duyệt yêu cầu nếu backend không cho phép.
3. Button approve/reject phải loading khi submit.
4. Sau khi duyệt/từ chối thành công, cập nhật row/detail ngay.
5. Nếu request đã được người khác xử lý trước đó, hiển thị conflict state và refresh dữ liệu.
6. Mọi action phê duyệt phải có audit log và notification event.

---

## 16. Page Template 06 - Kanban Template

### 16.1 Mục đích

Kanban Template chủ yếu dùng cho TASK, có thể mở rộng cho workflow khác.

### 16.2 Wireframe

```text
+--------------------------------------------------------------------------------+
| Kanban Board                                          [+ Task] [Filter] [...]    |
+--------------------------------------------------------------------------------+
| Search | Assignee | Priority | Due date | Project | View switch                |
+--------------------------------------------------------------------------------+
| Todo              | In Progress       | In Review         | Done                 |
| +--------------+  | +--------------+  | +--------------+  | +--------------+     |
| | Task card    |  | | Task card    |  | | Task card    |  | | Task card    |     |
| +--------------+  | +--------------+  | +--------------+  | +--------------+     |
+--------------------------------------------------------------------------------+
```

### 16.3 Kanban card content

| Thành phần | Rule |
| --- | --- |
| Title | Bắt buộc, tối đa 2 dòng. |
| Project/tag | Hiển thị nếu có. |
| Priority | Badge hoặc icon. |
| Due date | Đỏ/cảnh báo nếu quá hạn. |
| Assignee | Avatar group. |
| Checklist progress | Optional. |
| Comment/file count | Optional. |

### 16.4 Drag/drop rule

1. Chỉ cho drag nếu user có quyền cập nhật trạng thái task.
2. Nếu business rule không cho chuyển trạng thái, hiển thị toast lỗi và rollback UI.
3. Drag state phải rõ: card dragging, column droppable, invalid drop.
4. Cập nhật optimistic có thể dùng, nhưng cần rollback khi API lỗi.
5. Mobile có thể dùng action menu đổi trạng thái thay vì drag/drop.

---

## 17. Page Template 07 - Calendar Template

### 17.1 Mục đích

Calendar Template dùng cho lịch nghỉ, lịch công việc, lịch chấm công hoặc lịch công ty ở phase sau.

### 17.2 Wireframe

```text
+--------------------------------------------------------------------------------+
| Lịch nghỉ                                               [Today] [Month v]       |
+--------------------------------------------------------------------------------+
| Filters: Team | Department | Leave type | Status                               |
+--------------------------------------------------------------------------------+
| Calendar grid                                                                    |
| Mon Tue Wed Thu Fri Sat Sun                                                     |
| Event chips                                                                       |
+--------------------------------------------------------------------------------+
| Side panel: selected day events / detail                                         |
+--------------------------------------------------------------------------------+
```

### 17.3 View mode

| Mode | Dùng khi |
| --- | --- |
| Month | Tổng quan nghỉ phép/team. |
| Week | Lịch làm việc, task deadline, ca làm. |
| Day | Detail theo ngày. |
| List | Mobile hoặc dữ liệu nhiều. |

### 17.4 Rule

1. Event chip màu theo loại/trạng thái, nhưng không lạm dụng màu.
2. Dữ liệu hiển thị theo scope.
3. Click event mở detail drawer hoặc điều hướng detail page.
4. Ngày lễ/ngày nghỉ nên có background nhẹ.
5. Mobile ưu tiên list view.

---

## 18. Page Template 08 - Report Template

### 18.1 Mục đích

Report Template dùng cho báo cáo cơ bản trong MVP.

Ví dụ:

1. Báo cáo nhân sự.
2. Báo cáo bảng công.
3. Báo cáo nghỉ phép.
4. Báo cáo task/dự án.

### 18.2 Wireframe

```text
+--------------------------------------------------------------------------------+
| Báo cáo chấm công                                      [Export] [Schedule later] |
+--------------------------------------------------------------------------------+
| Date range | Department | Employee | Status | Apply                            |
+--------------------------------------------------------------------------------+
| Metric cards                                                                    |
+--------------------------------------------------------------------------------+
| Chart placeholder / summary table                                               |
+--------------------------------------------------------------------------------+
| Detailed table                                                                  |
+--------------------------------------------------------------------------------+
```

### 18.3 Rule

1. Báo cáo MVP ưu tiên rõ ràng hơn biểu đồ phức tạp.
2. Filter phải được đặt trước dữ liệu.
3. Export chỉ hiện nếu có quyền.
4. Query nặng cần loading rõ và có thể yêu cầu apply filter.
5. Dữ liệu nhạy cảm phải masked hoặc không trả về nếu thiếu quyền.

---

## 19. Page Template 09 - Settings Template

### 19.1 Mục đích

Settings Template dùng cho cấu hình module/system.

Ví dụ:

1. Cấu hình sinh mã nhân viên.
2. Cấu hình ca làm/rule chấm công.
3. Cấu hình chính sách nghỉ phép.
4. Cấu hình dashboard widget.
5. Cấu hình notification event/template.
6. Cấu hình company/system.

### 19.2 Wireframe

```text
+--------------------------------------------------------------------------------+
| Thiết lập module                                      [Reset] [Save changes]    |
+--------------------------------------------------------------------------------+
| Left settings nav       | Setting group title                                  |
| - General               | Description                                          |
| - Permission            | Fields                                               |
| - Notification          | Fields                                               |
| - Advanced              | Danger zone                                          |
+--------------------------------------------------------------------------------+
```

### 19.3 Rule

1. Cấu hình nên chia nhóm.
2. Thay đổi quan trọng cần confirm.
3. Có audit log cho cấu hình quan trọng.
4. Nếu thay đổi ảnh hưởng module khác, hiển thị warning.
5. Danger zone phải tách riêng và dùng màu semantic danger.
6. Nên hỗ trợ save từng group để tránh form quá lớn.

---

## 20. Page Template 10 - Audit/Activity Template

### 20.1 Mục đích

Audit/Activity Template dùng để xem lịch sử thao tác.

Ví dụ:

1. Lịch sử hồ sơ nhân viên.
2. Lịch sử duyệt đơn nghỉ.
3. Activity task.
4. Audit log hệ thống.
5. Login log.

### 20.2 Wireframe

```text
+--------------------------------------------------------------------------------+
| Lịch sử thao tác                                      [Export]                  |
+--------------------------------------------------------------------------------+
| Search actor | Module | Action | Date range | Target | Apply                  |
+--------------------------------------------------------------------------------+
| Timeline / Table                                                                  |
| Time | Actor | Action | Target | Summary | IP | Detail                      |
+--------------------------------------------------------------------------------+
```

### 20.3 Rule

1. Audit log chỉ hiển thị cho người có quyền.
2. Dữ liệu nhạy cảm trong diff phải masked theo quyền.
3. Có filter thời gian bắt buộc nếu dữ liệu lớn.
4. Mỗi row có thể mở detail drawer để xem payload/diff.
5. Không cho sửa/xóa audit log từ UI nghiệp vụ.

---

## 21. Module Workspace theo từng module

## 21.1 DASH Workspace

### Mục đích

DASH Workspace hiển thị dashboard theo vai trò, widget và cấu hình dashboard.

### Sidebar đề xuất

```text
Tổng quan
- Dashboard của tôi
- Dashboard nhân viên
- Dashboard quản lý
- Dashboard HR
- Dashboard Admin

Widget
- Danh sách widget
- Cấu hình widget

Quản trị
- Cache dashboard
- Audit dashboard
```

### Template ưu tiên

| Màn | Template |
| --- | --- |
| Dashboard của tôi | Overview / Widget grid |
| Dashboard theo role | Overview / Widget grid |
| Widget catalog | List/Table |
| Widget config | Settings/Form |
| Dashboard audit | Audit/Table |

### Lưu ý UX

1. DASH không xử lý nghiệp vụ gốc.
2. Quick action phải gọi module nguồn hoặc điều hướng module nguồn.
3. Widget lỗi độc lập không làm lỗi toàn bộ dashboard.
4. Widget hiển thị theo permission và data scope.

---

## 21.2 HR Workspace

### Mục đích

HR Workspace phục vụ quản lý nhân sự, hồ sơ, phòng ban, chức vụ, hợp đồng và self-service có kiểm duyệt.

### Sidebar đề xuất

```text
Tổng quan
- Tổng quan nhân sự

Hồ sơ
- Hồ sơ của tôi
- Nhân viên
- Yêu cầu cập nhật hồ sơ
- Hợp đồng
- File hồ sơ

Tổ chức
- Phòng ban
- Chức vụ
- Cấp bậc
- Loại hợp đồng

Báo cáo
- Báo cáo nhân sự
- Lịch sử thay đổi

Thiết lập
- Cấu hình mã nhân viên
- Thiết lập HR
```

### Template ưu tiên

| Màn | Template |
| --- | --- |
| Hồ sơ của tôi | Detail/Form self-service |
| Danh sách nhân viên | List/Table |
| Chi tiết nhân viên | Detail full page + tabs |
| Tạo/cập nhật nhân viên | Form multi-section |
| Yêu cầu cập nhật hồ sơ | Approval/List + detail comparison |
| Phòng ban/chức vụ | List/Table + Form drawer |
| Hợp đồng | List/Table + Detail/Form |
| Cấu hình mã nhân viên | Settings/Form |
| Lịch sử thay đổi | Audit/Activity |

### Lưu ý UX

1. Trường nhạy cảm phải masked nếu thiếu quyền.
2. Employee tự sửa hồ sơ phải tạo request, không cập nhật trực tiếp hồ sơ chính.
3. Mã nhân viên mặc định do hệ thống sinh, UI cần có preview mã tiếp theo.
4. Chi tiết nhân viên nên dùng tabs để tránh một trang quá dài.
5. Manager scope Team chỉ thấy nhân viên thuộc team.

---

## 21.3 ATT Workspace

### Mục đích

ATT Workspace phục vụ check-in/check-out, bảng công, điều chỉnh công, remote/công tác, ca làm và rule chấm công.

### Sidebar đề xuất

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
- Gán ca làm
- Rule chấm công

Báo cáo
- Báo cáo chấm công
- Log chấm công
```

### Template ưu tiên

| Màn | Template |
| --- | --- |
| Chấm công hôm nay | Detail/Status action card |
| Bảng công của tôi | Calendar/List hybrid |
| Bảng công team/công ty | List/Table + filter mạnh |
| Chi tiết ngày công | Detail drawer |
| Điều chỉnh công | Approval/List + Form request |
| Remote/Công tác | List/Form/Approval |
| Ca làm việc | List/Table + Settings/Form |
| Rule chấm công | Settings/Form |
| Log chấm công | Audit/Table |

### Lưu ý UX

1. Nút check-in/check-out phải nổi bật và có trạng thái loading rõ.
2. Nếu có đơn nghỉ approved full-day, disable check-in/check-out và giải thích lý do.
3. Remote approved có thể hiển thị trạng thái chấm công tự động hoặc yêu cầu check-in remote.
4. Bảng công cần filter theo tháng, nhân viên, team, phòng ban, trạng thái.
5. Điều chỉnh công cần before/after comparison.

---

## 21.4 LEAVE Workspace

### Mục đích

LEAVE Workspace phục vụ số dư phép, tạo đơn nghỉ, duyệt đơn, lịch nghỉ, loại nghỉ, chính sách và số dư nhân viên.

### Sidebar đề xuất

```text
Tổng quan
- Tổng quan nghỉ phép

Cá nhân
- Số dư phép của tôi
- Đơn nghỉ của tôi
- Tạo đơn nghỉ

Phê duyệt
- Đơn chờ duyệt
- Lịch nghỉ team

Quản lý
- Lịch nghỉ công ty
- Loại nghỉ
- Chính sách nghỉ
- Số dư phép nhân viên

Báo cáo
- Báo cáo nghỉ phép
- Lịch sử giao dịch
```

### Template ưu tiên

| Màn | Template |
| --- | --- |
| Số dư phép + đơn của tôi | Overview/List |
| Tạo đơn nghỉ | Form + calculation preview |
| Chi tiết đơn nghỉ | Detail + approval timeline |
| Đơn chờ duyệt | Approval/List |
| Lịch nghỉ | Calendar |
| Loại nghỉ/chính sách | List/Settings/Form |
| Số dư phép nhân viên | List/Table + adjustment modal |
| Lịch sử giao dịch | Audit/Table |

### Lưu ý UX

1. Form tạo đơn nghỉ cần preview số ngày nghỉ và số dư còn lại trước khi gửi.
2. Cảnh báo trùng ngày lễ, trùng đơn, không đủ balance phải rõ.
3. Manager chỉ thấy đơn thuộc team nếu scope Team.
4. HR có thể xem toàn công ty nếu có scope Company.
5. Duyệt/từ chối cần modal ghi chú/lý do.

---

## 21.5 TASK Workspace

### Mục đích

TASK Workspace phục vụ dự án, task, Kanban, comment, checklist, file và báo cáo tiến độ.

### Sidebar đề xuất

```text
Tổng quan
- Tổng quan công việc

Công việc
- Việc của tôi
- Task được giao cho tôi
- Task tôi tạo
- Tất cả task
- Kanban
- Task quá hạn

Dự án
- Dự án
- Thành viên dự án
- Báo cáo dự án

Trao đổi
- Comment/Mention
- File công việc

Thiết lập
- Thiết lập task
```

### Template ưu tiên

| Màn | Template |
| --- | --- |
| Việc của tôi | List/Card hybrid |
| Task detail | Detail full page + right activity/comment panel |
| Kanban | Kanban Template |
| Tạo/cập nhật task | Form + metadata side panel |
| Danh sách dự án | List/Table hoặc Card grid |
| Chi tiết dự án | Detail + tabs |
| Project board | Kanban |
| Thành viên dự án | List/Table |
| Báo cáo tiến độ | Report |

### Lưu ý UX

1. TASK cần tối ưu thao tác cập nhật trạng thái nhanh.
2. Comment, mention, checklist phải dễ thao tác trong detail.
3. Khi giao task cho người đang nghỉ phép, UI hiển thị warning nhưng chưa bắt buộc chặn trong MVP nếu nghiệp vụ cho phép.
4. Task overdue phải có badge/cảnh báo rõ.
5. Kanban trên mobile dùng list theo trạng thái hoặc action menu thay vì drag/drop phức tạp.

---

## 21.6 NOTI Workspace

### Mục đích

NOTI Workspace phục vụ xem thông báo, trạng thái đọc/chưa đọc, deep link và cấu hình notification.

### Sidebar đề xuất

```text
Thông báo
- Thông báo của tôi
- Chưa đọc
- Đã đọc
- Đã lưu trữ

Cấu hình
- Event thông báo
- Template thông báo
- Kênh gửi
- Delivery log

Quản trị
- Gửi thông báo hệ thống
- Audit thông báo
```

### Template ưu tiên

| Màn | Template |
| --- | --- |
| Danh sách thông báo | List/Table hoặc notification list |
| Chi tiết thông báo | Detail |
| Chưa đọc/đã đọc | List với filter |
| Event/template | List/Settings/Form |
| Delivery log | Audit/Table |
| Gửi thông báo hệ thống | Form |

### Lưu ý UX

1. Notification list cần phân biệt unread/read rõ.
2. Deep link phải an toàn; module target kiểm tra quyền lại.
3. Mark read/mark all read cần feedback nhẹ.
4. System notification gửi thủ công phải confirm nếu gửi nhiều người.
5. Delivery log chỉ dành cho Admin/Super Admin hoặc người có quyền.

---

## 21.7 SYSTEM / AUTH Workspace

### Mục đích

SYSTEM/AUTH Workspace phục vụ quản trị tài khoản, vai trò, quyền, cấu hình công ty, module catalog, file metadata và audit log.

### Sidebar đề xuất

```text
Tổng quan
- Tổng quan hệ thống

Tài khoản & quyền
- Người dùng
- Vai trò
- Quyền
- Gán vai trò
- Phiên đăng nhập
- Nhật ký đăng nhập

Hệ thống
- Thông tin công ty
- Module catalog
- Cấu hình hệ thống
- File metadata
- Audit log

Bảo mật
- Thiết lập bảo mật
- Sự kiện bảo mật
```

### Template ưu tiên

| Màn | Template |
| --- | --- |
| System overview | Overview |
| User list/detail | List/Detail/Form |
| Role/permission matrix | Settings/Table matrix |
| Company settings | Settings/Form |
| Module catalog | List/Card + status |
| File metadata | List/Table |
| Audit log | Audit/Table |
| Login log | Audit/Table |

### Lưu ý UX

1. Các màn quản trị phải cực kỳ rõ permission và action nguy hiểm.
2. Cấu hình hệ thống quan trọng cần confirm.
3. Role/permission matrix cần search, group theo module và save rõ ràng.
4. Super Admin/System scope mới thấy dữ liệu liên công ty nếu sau này bật SaaS.

---

## 22. Permission, data scope và UI behavior

### 22.1 Quy tắc chung

| Tình huống | UI behavior |
| --- | --- |
| Không có quyền xem menu | Ẩn menu. |
| Có quyền xem nhưng không có dữ liệu trong scope | Hiển thị trang + empty state theo scope. |
| Có quyền xem nhưng không có quyền tạo | Ẩn primary create button. |
| Có quyền xem nhưng không có quyền sửa | Hiển thị dữ liệu, ẩn/disable edit action. |
| Có quyền action nhưng business rule không cho | Disable action + tooltip lý do. |
| Truy cập URL trái quyền | Hiển thị ForbiddenPage hoặc redirect `/403`. |
| Module chưa active | Hiển thị ModuleDisabledState hoặc ẩn khỏi App Switcher. |
| Field nhạy cảm thiếu quyền | Mask/ẩn field, backend không trả raw value. |

### 22.2 PermissionGate component

```tsx
<PermissionGate
  anyOf={["HR.EMPLOYEE.CREATE"]}
  fallback={null}
>
  <Button>Thêm nhân viên</Button>
</PermissionGate>
```

### 22.3 DisabledActionTooltip pattern

```text
[Button disabled]
Tooltip: Bạn không thể duyệt đơn này vì đơn không thuộc phạm vi team của bạn.
```

### 22.4 Forbidden page trong workspace

```text
+----------------------------------------------------------+
| Bạn không có quyền truy cập màn hình này                 |
| Tài khoản của bạn chưa được cấp quyền phù hợp.           |
| [Quay lại Home] [Liên hệ quản trị viên]                  |
+----------------------------------------------------------+
```

### 22.5 Empty due to scope

```text
+----------------------------------------------------------+
| Không có dữ liệu trong phạm vi của bạn                   |
| Bạn đang xem dữ liệu theo phạm vi Team. Hiện chưa có bản |
| ghi nào thuộc team của bạn.                              |
+----------------------------------------------------------+
```

---

## 23. State bắt buộc trong Module Workspace

### 23.1 Route loading

Khi chuyển route trong cùng module:

1. Giữ topbar và sidebar.
2. Content area hiển thị skeleton.
3. Sidebar active state có thể cập nhật ngay.
4. Không làm trắng toàn màn hình nếu không cần.

### 23.2 Module loading

Khi mở module từ Home Portal/App Switcher:

1. Load app metadata.
2. Load sidebar theo quyền.
3. Load default route.
4. Hiển thị page skeleton trong content area.

### 23.3 Error state

| Error | UI behavior |
| --- | --- |
| API 401 | Redirect login hoặc session expired modal. |
| API 403 | ForbiddenPage trong content. |
| API 404 | NotFound state trong content. |
| API 409 | Conflict alert + refresh action. |
| API 422 | Validation error trên form. |
| API 500 | ErrorState + retry. |
| Network error | Offline/network alert + retry. |

### 23.4 Stale data state

Dùng khi dữ liệu đã bị thay đổi bởi người khác:

```text
Dữ liệu này đã được cập nhật bởi người khác. Vui lòng tải lại để xem phiên bản mới nhất.
[Refresh]
```

### 23.5 Long-running export/import state

MVP có thể xử lý đơn giản:

1. Khi bấm export, button loading.
2. Nếu export nhanh, tải file trực tiếp.
3. Nếu export lâu, hiển thị message `Đang chuẩn bị file xuất dữ liệu` và phase sau có job/download center.

---

## 24. Responsive behavior chi tiết

### 24.1 Desktop >= 1200px

| Thành phần | Behavior |
| --- | --- |
| Sidebar | Expanded mặc định, cho phép collapse. |
| Topbar | Hiển thị full. |
| Page header | Title + actions cùng hàng. |
| Toolbar | Hiển thị inline. |
| Table | Full table. |
| Drawer | Right drawer. |

### 24.2 Tablet 768px - 1199px

| Thành phần | Behavior |
| --- | --- |
| Sidebar | Collapsed mặc định hoặc drawer. |
| Topbar | Search có thể thu gọn. |
| Page header | Actions có thể gom vào more menu. |
| Toolbar | Một số filter gom vào filter drawer. |
| Table | Column priority hoặc horizontal scroll. |
| Drawer | Width 70% - 85%. |

### 24.3 Mobile < 768px

| Thành phần | Behavior |
| --- | --- |
| Sidebar | Mở bằng menu button, dạng full-screen drawer/bottom sheet. |
| Topbar | App name rút gọn, search icon. |
| Page header | Title 1-2 dòng, primary action dạng icon/button compact. |
| Toolbar | Search full width, filter button mở drawer. |
| Table | Card list nếu có thể. |
| Detail | Full-screen detail. |
| Drawer | Full-screen. |
| Modal | Full-width, gần fullscreen. |
| Kanban | Chuyển sang list theo status hoặc horizontal swipe. |

---

## 25. Route và layout metadata

### 25.1 Workspace route metadata

```ts
interface WorkspaceRouteMeta {
  routeKey: string;
  path: string;
  layout: 'MODULE_WORKSPACE';
  moduleCode: 'DASH' | 'HR' | 'ATT' | 'LEAVE' | 'TASK' | 'NOTI' | 'AUTH' | 'FOUNDATION';
  screenCode: string;
  title: string;
  breadcrumb?: Array<{ label: string; path?: string }>;
  sidebarKey?: string;
  requiredPermissions?: string[];
  requiredAnyPermissions?: string[];
  requiredScopes?: Array<'Own' | 'Team' | 'Department' | 'Project' | 'Company' | 'System'>;
  featureFlag?: string;
  showInSidebar?: boolean;
  showInTopbar?: boolean;
  order?: number;
  icon?: string;
  pageTemplate:
    | 'OVERVIEW'
    | 'LIST'
    | 'DETAIL'
    | 'FORM'
    | 'APPROVAL'
    | 'KANBAN'
    | 'CALENDAR'
    | 'REPORT'
    | 'SETTINGS'
    | 'AUDIT';
}
```

### 25.2 Ví dụ route HR employee list

```ts
{
  routeKey: 'hr.employees.list',
  path: '/hr/employees',
  layout: 'MODULE_WORKSPACE',
  moduleCode: 'HR',
  screenCode: 'UI-HR-SCREEN-002',
  title: 'Danh sách nhân viên',
  sidebarKey: 'hr.employees',
  requiredAnyPermissions: ['HR.EMPLOYEE.VIEW'],
  requiredScopes: ['Team', 'Department', 'Company', 'System'],
  showInSidebar: true,
  order: 20,
  icon: 'users',
  pageTemplate: 'LIST'
}
```

### 25.3 Ví dụ route Leave approval

```ts
{
  routeKey: 'leave.approvals.list',
  path: '/leave/approvals',
  layout: 'MODULE_WORKSPACE',
  moduleCode: 'LEAVE',
  screenCode: 'UI-LEAVE-SCREEN-003',
  title: 'Đơn nghỉ cần duyệt',
  sidebarKey: 'leave.approvals',
  requiredAnyPermissions: ['LEAVE.REQUEST.APPROVE'],
  requiredScopes: ['Team', 'Department', 'Company', 'System'],
  showInSidebar: true,
  badgeSource: 'leave.pending_approvals_count',
  order: 30,
  icon: 'approval',
  pageTemplate: 'APPROVAL'
}
```

---

## 26. Frontend implementation suggestion

### 26.1 Component folder đề xuất

```text
src/
  layouts/
    ModuleWorkspaceLayout/
      ModuleWorkspaceLayout.tsx
      GlobalTopbar.tsx
      ModuleSidebar.tsx
      MainContentShell.tsx
      WorkspaceBreadcrumb.tsx
      WorkspacePageHeader.tsx
      WorkspaceToolbar.tsx
      WorkspaceState.tsx
  components/
    data-table/
    forms/
    approval/
    kanban/
    calendar/
    audit/
    permission/
  modules/
    hr/
    attendance/
    leave/
    tasks/
    notifications/
    dashboard/
    system/
  routes/
    workspaceRoutes.ts
    sidebarRegistry.ts
    appRegistry.ts
```

### 26.2 Layout props

```ts
interface ModuleWorkspaceLayoutProps {
  moduleCode: string;
  moduleName: string;
  moduleIcon: string;
  sidebarItems: WorkspaceSidebarItem[];
  currentRoute: WorkspaceRouteMeta;
  userPermissions: string[];
  userScopes: string[];
  children: React.ReactNode;
}
```

### 26.3 Page shell props

```ts
interface WorkspacePageProps {
  title: string;
  description?: string;
  breadcrumb?: Array<{ label: string; path?: string }>;
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  toolbar?: React.ReactNode;
  alert?: React.ReactNode;
  children: React.ReactNode;
}
```

### 26.4 Permission rendering utility

Frontend nên có utility:

```ts
can(permission: string): boolean
canAny(permissions: string[]): boolean
hasScope(scope: DataScope): boolean
canRoute(routeMeta: WorkspaceRouteMeta): boolean
canAction(actionMeta: ActionMeta, row?: unknown): boolean
```

Lưu ý: các utility này chỉ phục vụ UX. Backend vẫn kiểm tra lại.

---

## 27. Backend/API data cần hỗ trợ UI-07

### 27.1 API cần trả cho frontend sau login

Frontend cần các nhóm dữ liệu sau để render Workspace đúng:

| Dữ liệu | Mục đích |
| --- | --- |
| User profile | Avatar, tên, account menu. |
| Employee mapping | Scope Own/Team và hiển thị thông tin cá nhân. |
| Permissions | Render menu/action. |
| Data scopes | Render dữ liệu và badge đúng phạm vi. |
| Active modules | App Switcher và route guard. |
| Company settings | Feature flag, module enabled/disabled. |
| Notification unread count | Topbar badge. |
| App registry | Icon, name, route root, status. |

### 27.2 API sidebar/badge

Có 2 hướng:

| Hướng | Mô tả | Khuyến nghị |
| --- | --- | --- |
| Frontend build sidebar từ static registry + permission | Dễ triển khai MVP. | Khuyến nghị MVP. |
| Backend trả menu resolved hoàn chỉnh | Linh hoạt SaaS/role dynamic. | Phase sau hoặc nếu backend sẵn. |

Với badge/counter, nên gọi API nhẹ theo module hoặc dashboard/header summary.

Ví dụ:

```http
GET /api/v1/dashboard/me
GET /api/v1/notifications/unread-count
GET /api/v1/leave/approvals/count
GET /api/v1/tasks/my-summary
GET /api/v1/attendance/summary
```

---

## 28. Accessibility checklist

Module Workspace cần đạt các yêu cầu accessibility cơ bản:

1. Có keyboard navigation cho topbar, app switcher, sidebar, menu, modal.
2. Focus state rõ ràng.
3. Modal/drawer trap focus khi mở.
4. Escape đóng modal/drawer nếu không mất dữ liệu quan trọng.
5. Table có header rõ.
6. Button icon-only phải có aria-label/tooltip.
7. Badge màu phải có text/icon phụ, không chỉ dựa vào màu.
8. Form field có label rõ, error message liên kết đúng field.
9. Contrast đạt mức đọc tốt cho text và action chính.
10. Sidebar collapsed phải có tooltip hoặc accessible label.

---

## 29. UX copy guideline

### 29.1 Nguyên tắc copy

1. Ngắn gọn, rõ việc user cần làm.
2. Không dùng thuật ngữ kỹ thuật nếu không cần.
3. Lỗi phải nói nguyên nhân và cách xử lý.
4. Forbidden/disabled phải nói vì sao nếu có thể.
5. Empty state nên gợi ý bước tiếp theo nếu user có quyền.

### 29.2 Ví dụ copy

| State | Copy đề xuất |
| --- | --- |
| Loading | `Đang tải dữ liệu...` |
| Empty list | `Chưa có dữ liệu.` |
| Empty filter | `Không tìm thấy kết quả phù hợp.` |
| Forbidden | `Bạn không có quyền truy cập màn hình này.` |
| Disabled action | `Bạn chưa có quyền thực hiện thao tác này.` |
| Conflict | `Dữ liệu đã thay đổi. Vui lòng tải lại trước khi tiếp tục.` |
| Success create | `Tạo mới thành công.` |
| Success update | `Cập nhật thành công.` |
| Approve success | `Đã duyệt yêu cầu.` |
| Reject success | `Đã từ chối yêu cầu.` |

---

## 30. Wireframe handoff checklist

Khi bàn giao wireframe Module Workspace, mỗi màn cần có:

| Checklist | Bắt buộc |
| --- | --- |
| Screen code | Có |
| Route | Có |
| Module code | Có |
| Page template type | Có |
| Actor chính | Có |
| Required permission | Có |
| Data scope behavior | Có |
| Sidebar active item | Có |
| Page title/breadcrumb | Có |
| Primary/secondary action | Có nếu có quyền |
| Loading state | Có |
| Empty state | Có |
| Error state | Có |
| Forbidden state | Có |
| Responsive note | Có |
| API integration note | Nên có |
| Audit/notification trigger note | Nên có với action quan trọng |

---

## 31. QA acceptance criteria

### 31.1 Layout acceptance criteria

| Mã | Acceptance criteria |
| --- | --- |
| UI07-AC-001 | Module Workspace có topbar, sidebar, content shell thống nhất trên mọi module. |
| UI07-AC-002 | Sidebar chỉ hiển thị menu thuộc module hiện tại. |
| UI07-AC-003 | Sidebar menu hiển thị theo permission, không hard-code theo role. |
| UI07-AC-004 | Người dùng có thể mở App Switcher từ mọi Module Workspace. |
| UI07-AC-005 | Notification badge hiển thị trong topbar nếu user có quyền. |
| UI07-AC-006 | PageHeader có breadcrumb, title và action theo quyền. |
| UI07-AC-007 | Route loading không làm mất topbar/sidebar. |
| UI07-AC-008 | Forbidden route hiển thị ForbiddenPage trong content area. |
| UI07-AC-009 | Empty state phân biệt được không có dữ liệu và không có dữ liệu do scope. |
| UI07-AC-010 | Responsive sidebar hoạt động đúng desktop/tablet/mobile. |

### 31.2 Permission acceptance criteria

| Mã | Acceptance criteria |
| --- | --- |
| UI07-AC-011 | Menu không có quyền không xuất hiện. |
| UI07-AC-012 | Action không có quyền không xuất hiện hoặc bị disable theo policy. |
| UI07-AC-013 | Field nhạy cảm không hiển thị raw value khi thiếu quyền. |
| UI07-AC-014 | Badge/counter không hiển thị số liệu ngoài data scope. |
| UI07-AC-015 | Deep link trái quyền bị chặn bằng route guard và backend guard. |

### 31.3 Template acceptance criteria

| Mã | Acceptance criteria |
| --- | --- |
| UI07-AC-016 | List/Table Template có search/filter/table/pagination/state đầy đủ. |
| UI07-AC-017 | Detail Template hỗ trợ full page và drawer pattern. |
| UI07-AC-018 | Form Template có validation, submit loading và sticky footer khi cần. |
| UI07-AC-019 | Approval Template có before/after, approval history và confirm modal. |
| UI07-AC-020 | Kanban Template có card, column, drag/drop state hoặc mobile fallback. |
| UI07-AC-021 | Calendar Template có filter, view mode và event detail. |
| UI07-AC-022 | Settings Template có group, save state, warning và audit note. |
| UI07-AC-023 | Audit Template có filter thời gian, actor, action, target và detail drawer. |

---

## 32. Rủi ro UX và phương án xử lý

| Rủi ro | Tác động | Phương án xử lý |
| --- | --- | --- |
| Sidebar quá nhiều item | Người dùng khó tìm menu | Group menu, giới hạn 2 cấp, dùng search phase sau. |
| Permission làm menu biến mất khó hiểu | User không biết thiếu quyền | Forbidden state khi vào URL trực tiếp, liên hệ admin. |
| Table quá rộng | Khó đọc trên màn nhỏ | Column priority, horizontal scroll, card view mobile. |
| Form quá dài | User dễ bỏ sót | Chia section, sticky footer, validation summary. |
| Approval thiếu ngữ cảnh | Duyệt sai | Detail comparison, impact preview, history. |
| Badge/counter sai scope | Rò rỉ thông tin | Backend count theo permission/scope. |
| App switcher che context | User mất luồng | Overlay đóng được, giữ route hiện tại phía sau. |
| Drawer quá nhiều nội dung | Khó thao tác | Entity phức tạp dùng full detail page. |

---

## 33. Thứ tự triển khai đề xuất

### Sprint UI-07.1 - Layout shell

1. ModuleWorkspaceLayout.
2. GlobalTopbar.
3. ModuleSidebar expanded/collapsed.
4. MainContentShell.
5. PageHeader.
6. Loading/empty/error/forbidden state.

### Sprint UI-07.2 - Core page templates

1. List/Table Template.
2. Detail Template.
3. Form Template.
4. Approval Template.
5. Settings Template.

### Sprint UI-07.3 - Specialized templates

1. Kanban Template.
2. Calendar Template.
3. Report Template.
4. Audit/Activity Template.

### Sprint UI-07.4 - Module mapping

1. HR Workspace.
2. ATT Workspace.
3. LEAVE Workspace.
4. TASK Workspace.
5. NOTI Workspace.
6. DASH Workspace.
7. SYSTEM/AUTH Workspace.

### Sprint UI-07.5 - Responsive & handoff

1. Desktop high fidelity.
2. Tablet behavior.
3. Mobile behavior.
4. Permission/state annotation.
5. Frontend component handoff.
6. QA checklist.

---

## 34. Đầu ra cần bàn giao sau UI-07

| Đầu ra | Mô tả |
| --- | --- |
| Figma ModuleWorkspaceLayout | Layout desktop/tablet/mobile. |
| Figma GlobalTopbar | Component topbar variants. |
| Figma ModuleSidebar | Expanded, collapsed, mobile drawer. |
| Figma PageHeader | Variants theo action. |
| Figma Page Templates | Overview, list, detail, form, approval, kanban, calendar, report, settings, audit. |
| Route metadata draft | File hoặc bảng route meta. |
| Sidebar registry draft | Menu từng module theo permission. |
| State screens | Loading, empty, error, forbidden, disabled module. |
| Frontend component note | Component props và folder structure. |
| QA checklist | Acceptance criteria từ UI-07. |

---

## 35. Kết luận

UI-07 chốt Module Workspace là layout làm việc chi tiết dùng chung cho toàn bộ hệ thống sau khi người dùng đi từ Home Portal hoặc App Switcher vào một module cụ thể.

Các quyết định quan trọng:

1. Module Workspace gồm topbar chung, sidebar theo module và content shell chuẩn.
2. Mỗi module dùng chung layout nhưng có sidebar/menu/action riêng theo permission.
3. Mọi màn nghiệp vụ phải kế thừa một trong các page template chuẩn: Overview, List, Detail, Form, Approval, Kanban, Calendar, Report, Settings hoặc Audit.
4. Permission và data scope ảnh hưởng trực tiếp đến menu, action, badge, field và dữ liệu hiển thị.
5. Frontend có thể ẩn/hiện UI để cải thiện trải nghiệm, nhưng backend vẫn là lớp bảo mật cuối cùng.
6. Tài liệu này là nền để tiếp tục triển khai UI-08 Dashboard UI Design và UI-09 thiết kế chi tiết từng module.

