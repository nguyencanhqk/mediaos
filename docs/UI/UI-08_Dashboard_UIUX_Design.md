# UI-08: DASHBOARD UI/UX DESIGN
# THIẾT KẾ DASHBOARD THEO VAI TRÒ, WIDGET, QUICK ACTION VÀ CẢNH BÁO

> **📚 Bộ tài liệu UI — Hệ thống Quản lý Doanh nghiệp**
> [UI-01 Tổng quan](<UI-01_UIUX_Design_Tong_Quan.md>) · [UI-02 IA/Sitemap](<UI-02_Information_Architecture_Sitemap.md>) · [UI-03 User Flow](<UI-03_User_Flow_MVP.md>) · [UI-04 Screen List](<UI-04_Screen_List_Wireframe_Plan.md>) · [UI-05 Design System](<UI-05_Design_System_Component_Library.md>) · [UI-06 Home/App Switcher](<UI-06_Home_Portal_App_Switcher_UI_Design.md>) · [UI-07 Module Workspace](<UI-07_Module_Workspace_Template_Design.md>) · **UI-08 Dashboard** · [UI-09 Module UI](<UI-09_Module_UI_Design.md>) · [UI-10 Prototype/Handoff](<UI-10_Prototype_Frontend_Handoff_Guide.md>)
>
> **Liên quan:** [Đặc tả: SPEC-07 DASH](<../SPEC/SPEC-07 DASH.md>) · [Thiết kế DB: DB-07 NOTI/DASH](<../DB/DB-07 NOTI DASH Database Design.md>) · [Thiết kế API: API-08 DASH](<../API Design/API-08_DASH_API_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | UI-08 |
| Tên tài liệu | Dashboard UI/UX Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | DASH - Dashboard |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-06 |
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

Tài liệu UI-08 mô tả chi tiết thiết kế UI/UX cho **Dashboard Workspace** của hệ thống quản lý doanh nghiệp nội bộ.

Dashboard là nơi tổng hợp dữ liệu quan trọng từ các module khác theo từng vai trò người dùng, bao gồm Employee, Manager, HR và Admin. Dashboard giúp người dùng nắm nhanh việc cần làm, trạng thái hiện tại, cảnh báo quan trọng và điều hướng nhanh sang module nghiệp vụ gốc.

Tài liệu này dùng để:

1. Chốt cấu trúc giao diện Dashboard theo từng vai trò.
2. Chốt danh sách widget MVP và thứ tự ưu tiên hiển thị.
3. Định nghĩa layout desktop, tablet và mobile web cho Dashboard.
4. Chuẩn hóa UI cho Metric Card, Widget Card, Quick Action, Alert, List Widget và Chart Placeholder.
5. Xác định rule hiển thị widget theo permission và data scope.
6. Xác định trạng thái UI bắt buộc: loading, empty, error, degraded, forbidden, disabled, stale data.
7. Mapping Dashboard UI với API-08 và module nguồn: ATT, LEAVE, TASK, HR, NOTI, AUTH, FOUNDATION.
8. Làm cơ sở cho UI/UX Designer dựng high-fidelity trên Figma.
9. Làm cơ sở cho Frontend triển khai component Dashboard reusable.
10. Làm checklist cho Backend/API và QA khi kiểm thử dashboard theo vai trò.

---

## 3. Căn cứ thiết kế

UI-08 bám theo các quyết định đã chốt trong bộ tài liệu dự án:

1. Sau khi đăng nhập, người dùng vào **Home Portal** trước; Dashboard là một app/module có thể mở từ Home Portal hoặc App Switcher.
2. Khi vào Dashboard, người dùng làm việc trong **Module Workspace Layout** với sidebar riêng, topbar chung và content area chính.
3. Dashboard chỉ tổng hợp, hiển thị, cảnh báo và điều hướng; không xử lý nghiệp vụ gốc thay ATT, LEAVE, TASK, HR hoặc NOTI.
4. Widget, badge, quick action và dữ liệu hiển thị phải theo permission và data scope.
5. Frontend được phép ẩn/hiện widget để cải thiện UX, nhưng backend vẫn là lớp kiểm tra quyền cuối cùng.
6. Dashboard cần dùng lại Design System ở UI-05: MetricCard, WidgetCard, QuickActionCard, ListWidget, ChartPlaceholder, Badge, EmptyState, ErrorState, Skeleton, PermissionGate.
7. Dashboard lấy dữ liệu theo API-08: `/api/v1/dashboard/me`, `/api/v1/dashboard/{type}`, `/api/v1/dashboard/widgets/{widget_slug}`.
8. Dashboard cần hỗ trợ cache, lazy load widget và fallback khi module nguồn lỗi.
9. Notification deep link và dashboard quick action phải điều hướng sang module gốc để module đó kiểm tra quyền và business rule lại.
10. Dashboard phải có thiết kế responsive cho desktop, tablet và mobile web.

---

## 4. Phạm vi UI-08

### 4.1 Bao gồm trong MVP

| Nhóm | Thành phần |
| --- | --- |
| Dashboard shell | Sidebar DASH, topbar, page header, dashboard type switcher, date context, refresh state |
| Role dashboard | Employee Dashboard, Manager Dashboard, HR Dashboard, Admin Dashboard |
| Widget layout | Grid 12 cột desktop, 2 cột tablet, 1 cột mobile |
| Widget types | Metric, list, status, alert, calendar mini, progress, chart placeholder |
| Quick actions | Check-in/out, tạo đơn nghỉ, xem task, duyệt đơn, xem bảng công, quản lý nhân viên |
| Permission UX | Ẩn widget thiếu quyền, disabled action khi business rule không cho phép |
| Data scope UX | Own, Team, Department, Project, Company, System |
| State | Loading, empty, error, degraded, stale, forbidden, disabled, success |
| API mapping | Mapping widget với endpoint API-08 và module nguồn |
| Handoff | Figma frame list, component mapping, frontend notes, QA checklist, acceptance criteria |

### 4.2 Chưa đi sâu trong MVP

| Nhóm | Giai đoạn đề xuất | Ghi chú |
| --- | --- | --- |
| Kéo thả widget cá nhân | Phase sau | Có thể dùng `dashboard_user_widget_states` |
| User tự chọn widget | Phase sau | MVP chỉ cấu hình theo role/company/user cơ bản |
| Dashboard realtime WebSocket | Phase sau | MVP dùng refresh/cache/invalidation |
| BI dashboard nâng cao | Phase sau | Nên tách reporting/BI service |
| Export dashboard PDF/Excel | Phase sau | Dùng job/export riêng |
| Dashboard Payroll/Recruit/Asset/Room | Phase 2+ | Bổ sung widget theo module mới |
| AI summary dashboard | Phase 5 | Chỉ dùng dữ liệu đã kiểm quyền |
| Public TV mode | Phase sau | Token riêng, read-only, không hiển thị dữ liệu nhạy cảm |

---

## 5. Định nghĩa khái niệm

| Khái niệm | Định nghĩa |
| --- | --- |
| Dashboard Workspace | Không gian làm việc của module DASH, chứa dashboard theo vai trò và widget |
| Dashboard Type | Loại dashboard theo ngữ cảnh người dùng: Employee, Manager, HR, Admin |
| Widget | Khối dữ liệu nhỏ hiển thị trên dashboard, có permission, source module, layout và state riêng |
| Metric Card | Card hiển thị số liệu ngắn: tổng nhân viên, task quá hạn, đơn chờ duyệt |
| List Widget | Widget dạng danh sách: task hôm nay, thông báo mới, đơn nghỉ chờ duyệt |
| Status Widget | Widget trạng thái: chấm công hôm nay, hệ thống, module active |
| Alert Widget | Widget cảnh báo: hợp đồng sắp hết hạn, thiếu check-out, task quá hạn |
| Quick Action | Hành động nhanh từ dashboard, điều hướng hoặc gọi API module gốc |
| Data Scope | Phạm vi dữ liệu được phép xem: Own, Team, Department, Project, Company, System |
| Degraded State | Widget không tải được đầy đủ do module nguồn lỗi một phần nhưng dashboard vẫn hoạt động |
| Stale Data | Dữ liệu cũ hơn TTL hoặc lần cập nhật cuối, cần hiển thị thời điểm cập nhật |

---

## 6. Vai trò của Dashboard trong kiến trúc UI tổng thể

### 6.1 Dashboard không thay thế Home Portal

Home Portal là cổng vào app/module sau đăng nhập. Dashboard là một app trong hệ thống.

```text
Login
  -> Home Portal
    -> Chọn Dashboard
      -> Dashboard Workspace
        -> Xem widget theo vai trò
        -> Click quick action/deep link
          -> Điều hướng sang module nghiệp vụ gốc
```

### 6.2 Dashboard nằm trong Module Workspace Layout

Dashboard sử dụng layout chung của module:

```text
+------------------------------------------------------------------------------------------------+
| App Switcher | Search | Notification | Avatar                                                   |
+----------------------+-------------------------------------------------------------------------+
| DASH Sidebar         | Page Header: Dashboard / Type switcher / Date context / Refresh          |
| - Tổng quan          +-------------------------------------------------------------------------+
| - Employee           | Dashboard content grid                                                    |
| - Manager            | Widget cards, metric cards, quick actions, alerts                         |
| - HR                 |                                                                         |
| - Admin              |                                                                         |
| - Cấu hình widget    |                                                                         |
+----------------------+-------------------------------------------------------------------------+
```

### 6.3 Dashboard không xử lý nghiệp vụ gốc

| Nhu cầu | Dashboard được làm | Dashboard không được làm |
| --- | --- | --- |
| Check-in/out | Hiển thị trạng thái, nút action nếu ATT cho phép | Không tự ghi attendance record |
| Duyệt đơn nghỉ | Hiển thị danh sách pending, điều hướng sang LEAVE hoặc mở approval action từ LEAVE | Không tự đổi trạng thái leave request nếu không gọi LEAVE API |
| Cập nhật task | Hiển thị task và CTA | Không tự xử lý rule task phức tạp ngoài TASK API |
| Mark notification read | Có thể gọi NOTI API nếu được thiết kế là action nguồn | Không tự thay đổi notification state cục bộ rồi bỏ qua backend |
| Cấu hình dashboard | Cho phép Admin cập nhật config DASH | Không thay đổi cấu hình module nguồn |

---

## 7. Dashboard type và route

### 7.1 Dashboard type trong MVP

| Dashboard type | Người dùng chính | Mục tiêu UX | Scope chính |
| --- | --- | --- | --- |
| Employee | Nhân viên | Biết hôm nay cần làm gì, đã chấm công chưa, task nào cần xử lý, còn phép bao nhiêu | Own |
| Manager | Quản lý | Theo dõi team, duyệt yêu cầu, kiểm soát task và bất thường chấm công | Team, Project, Own |
| HR | HR | Theo dõi nhân sự, bảng công, nghỉ phép, hợp đồng, cảnh báo vận hành nhân sự | Company, Department |
| Admin | Admin công ty/Super Admin | Theo dõi user, module, cấu hình, log, cảnh báo hệ thống | Company, System |

### 7.2 Route đề xuất

| Route | Màn hình | Permission | Layout |
| --- | --- | --- | --- |
| `/dashboard` | Dashboard mặc định của user | `DASH.DASHBOARD.VIEW` | Module Workspace |
| `/dashboard/employee` | Employee Dashboard | `DASH.DASHBOARD.VIEW_EMPLOYEE` | Module Workspace |
| `/dashboard/manager` | Manager Dashboard | `DASH.DASHBOARD.VIEW_MANAGER` | Module Workspace |
| `/dashboard/hr` | HR Dashboard | `DASH.DASHBOARD.VIEW_HR` | Module Workspace |
| `/dashboard/admin` | Admin Dashboard | `DASH.DASHBOARD.VIEW_ADMIN` | Module Workspace |
| `/dashboard/widgets` | Widget Catalog | `DASH.DASHBOARD.VIEW` | Module Workspace |
| `/dashboard/configs` | Dashboard Config | `DASH.CONFIG.VIEW` | Module Workspace |
| `/dashboard/configs/:id/edit` | Sửa cấu hình dashboard | `DASH.CONFIG.UPDATE` | Module Workspace |

### 7.3 Quy tắc chọn dashboard mặc định

Khi user vào `/dashboard`, backend hoặc frontend nhận dữ liệu từ `/api/v1/dashboard/me` để xác định dashboard mặc định.

Thứ tự ưu tiên đề xuất:

```text
1. Nếu user có cấu hình dashboard mặc định cá nhân -> dùng nếu còn hợp lệ.
2. Nếu user có quyền Admin Dashboard -> Admin Dashboard.
3. Nếu user có quyền HR Dashboard -> HR Dashboard.
4. Nếu user có quyền Manager Dashboard -> Manager Dashboard.
5. Nếu user có quyền Employee Dashboard -> Employee Dashboard.
6. Nếu không có dashboard hợp lệ -> hiển thị Forbidden/Empty permission state.
```

### 7.4 Người dùng có nhiều vai trò

Nếu user có nhiều dashboard được phép xem, hiển thị `Dashboard Type Switcher` trong page header.

Ví dụ:

```text
Dashboard: [HR Dashboard v]    Hôm nay: 20/06/2026    [Làm mới]
Dropdown:
- HR Dashboard
- Manager Dashboard
- Employee Dashboard
```

Quy tắc:

1. Chỉ hiển thị dashboard type user có quyền.
2. Type hiện tại được highlight.
3. Khi đổi type, URL đổi tương ứng.
4. Nếu form/config chưa lưu trong Dashboard Config, đổi type cần dirty confirm.
5. Lưu lựa chọn gần nhất nếu có `user dashboard preference`.

---

## 8. Screen list UI-08

| Mã screen | Tên màn hình | Route/Entry | Actor | Priority | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| UI-DASH-SCREEN-001 | Dashboard mặc định của tôi | `/dashboard` | Tất cả user có quyền | P0 | Resolve theo role/permission |
| UI-DASH-SCREEN-002 | Employee Dashboard | `/dashboard/employee` | Employee/role có quyền | P0 | Chấm công, task, phép, thông báo |
| UI-DASH-SCREEN-003 | Manager Dashboard | `/dashboard/manager` | Manager | P0 | Duyệt, team, task, chấm công |
| UI-DASH-SCREEN-004 | HR Dashboard | `/dashboard/hr` | HR/Admin được cấp quyền | P0 | Nhân sự, hợp đồng, bảng công, nghỉ phép |
| UI-DASH-SCREEN-005 | Admin Dashboard | `/dashboard/admin` | Admin/Super Admin | P1 | User, module, config, log |
| UI-DASH-SCREEN-006 | Widget Catalog | `/dashboard/widgets` | Admin/HR nếu được cấp | P2 | Danh mục widget |
| UI-DASH-SCREEN-007 | Dashboard Config List | `/dashboard/configs` | Admin | P2 | Cấu hình widget theo role/company/user |
| UI-DASH-SCREEN-008 | Dashboard Config Edit | `/dashboard/configs/:id/edit` | Admin | P2 | Layout, bật/tắt, order, size |
| UI-DASH-SCREEN-009 | Widget Detail/Preview Drawer | Drawer | Admin/Designer/QA | P2 | Xem metadata, permission, source module |
| UI-DASH-SCREEN-010 | Dashboard Forbidden State | `/dashboard/*` | User thiếu quyền | P0 | Không lộ dữ liệu |
| UI-DASH-SCREEN-011 | Dashboard Mobile | Responsive | Tất cả | P1 | Card stack, quick action sticky |

---

## 9. Nguyên tắc UX tổng thể cho Dashboard

### 9.1 Ưu tiên hành động trước báo cáo

Dashboard MVP phải giúp user hành động nhanh, không chỉ xem số liệu.

Thứ tự ưu tiên trên dashboard:

```text
1. Việc cần làm ngay
2. Cảnh báo cần xử lý
3. Trạng thái hôm nay
4. Số liệu tổng quan
5. Biểu đồ/summary mở rộng
```

### 9.2 Widget phải có mục tiêu rõ

Mỗi widget cần trả lời một câu hỏi cụ thể.

| Widget | Câu hỏi cần trả lời |
| --- | --- |
| Chấm công hôm nay | Hôm nay tôi đã check-in/check-out chưa? Có thể làm gì tiếp? |
| Task của tôi | Hôm nay tôi cần xử lý task nào trước? |
| Task alerts | Task nào đã quá hạn/sắp đến hạn? |
| Số ngày phép còn lại | Tôi còn bao nhiêu ngày phép? Có cảnh báo thấp không? |
| Đơn nghỉ chờ duyệt | Có yêu cầu nào cần tôi duyệt ngay không? |
| Thông báo mới | Có thông báo quan trọng nào chưa đọc không? |
| HR overview | Tình hình nhân sự hiện tại thế nào? |
| Attendance alerts | Có bất thường chấm công nào cần xử lý không? |

### 9.3 Dashboard phải nhẹ và dễ quét

1. Không hiển thị bảng quá dài trong Dashboard.
2. Widget list chỉ nên hiển thị 3-7 item đầu, có link `Xem tất cả`.
3. Biểu đồ trong MVP chỉ cần chart placeholder hoặc chart đơn giản.
4. Không đưa form phức tạp vào Dashboard.
5. Action phức tạp nên mở module gốc hoặc drawer/module workflow.
6. Dashboard phải hiển thị `last_updated_at` cho widget dữ liệu quan trọng.

### 9.4 Widget không có dữ liệu vẫn phải hữu ích

Empty state tốt hơn là card trống.

Ví dụ:

| Widget | Empty copy đề xuất | CTA |
| --- | --- | --- |
| Task của tôi | `Bạn chưa có task nào cần xử lý hôm nay.` | `Xem tất cả task` |
| Đơn nghỉ chờ duyệt | `Không có đơn nghỉ nào đang chờ duyệt.` | `Mở nghỉ phép` |
| Attendance alerts | `Không có bất thường chấm công trong phạm vi của bạn.` | `Xem bảng công` |
| Notifications | `Bạn chưa có thông báo mới.` | `Xem lịch sử thông báo` |

---

## 10. Dashboard layout system

### 10.1 Layout desktop

Desktop dùng grid 12 cột, tối ưu cho màn hình >= 1200px.

```text
+------------------------------------------------------------------------------------------------+
| Page Header: Dashboard type | Date | Scope badge | Refresh | Configure if permission              |
+------------------------------------------------------------------------------------------------+
| Quick Actions: [Check-in] [Tạo đơn nghỉ] [Task của tôi] [Duyệt yêu cầu]                         |
+------------------------------------------------------------------------------------------------+
| Alert strip / Important notices                                                                 |
+------------------------------------------------------------------------------------------------+
| [Metric 3 cols] [Metric 3 cols] [Metric 3 cols] [Metric 3 cols]                                 |
+------------------------------------------------------------------------------------------------+
| [Widget medium 6 cols]                       [Widget medium 6 cols]                             |
+------------------------------------------------------------------------------------------------+
| [Widget large 8 cols]                                      [Widget small 4 cols]                |
+------------------------------------------------------------------------------------------------+
```

### 10.2 Grid size token

| Size | Desktop width | Tablet | Mobile | Dùng cho |
| --- | --- | --- | --- | --- |
| `small` | 3/12 cột | 1/2 dòng | full width | Metric, status nhỏ |
| `medium` | 6/12 cột | full/half tùy ưu tiên | full width | List widget, alert widget |
| `large` | 8/12 hoặc 12/12 | full width | full width | Chart, calendar, project progress |
| `full` | 12/12 | full width | full width | Alert lớn, HR overview, admin overview |

### 10.3 Layout tablet

Tablet dùng 2 cột linh hoạt:

```text
+----------------------------------------------+
| Header + Dashboard type switcher             |
+----------------------------------------------+
| Quick actions wrap thành 2 hàng              |
+----------------------+-----------------------+
| Metric               | Metric                |
+----------------------+-----------------------+
| Widget full width                            |
+----------------------------------------------+
| Widget full width                            |
+----------------------------------------------+
```

### 10.4 Layout mobile web

Mobile dùng 1 cột, ưu tiên action và trạng thái hôm nay.

```text
+--------------------------------+
| Dashboard type | Refresh       |
+--------------------------------+
| Quick action sticky/scroll x    |
+--------------------------------+
| Alert important                 |
+--------------------------------+
| Attendance today                |
+--------------------------------+
| My tasks                        |
+--------------------------------+
| Leave balance                   |
+--------------------------------+
| Notifications                   |
+--------------------------------+
```

Quy tắc mobile:

1. Không dùng bảng rộng trong dashboard mobile.
2. List widget chuyển thành card list.
3. Quick action có thể dùng horizontal scroll.
4. Widget có thể collapse/expand nếu nội dung dài.
5. CTA chính phải nằm trong vùng dễ chạm.
6. Touch target tối thiểu 44px.

---

## 11. Dashboard shell anatomy

### 11.1 Page header

```text
DashboardHeader
├── Breadcrumb: Home / Dashboard
├── Title: Dashboard
├── DashboardTypeSwitcher
├── ScopeBadge: Own / Team / Company
├── DateContext: Hôm nay, Tuần này, Tháng này
├── RefreshButton
├── LastUpdatedInfo
└── ConfigureButton nếu có DASH.CONFIG.UPDATE
```

### 11.2 Header content theo role

| Role | Title | Subtitle |
| --- | --- | --- |
| Employee | `Dashboard của tôi` | `Tổng quan ngày làm việc, task, nghỉ phép và thông báo.` |
| Manager | `Dashboard quản lý` | `Theo dõi team, duyệt yêu cầu và kiểm soát tiến độ.` |
| HR | `Dashboard nhân sự` | `Tổng quan nhân sự, chấm công, nghỉ phép và hợp đồng.` |
| Admin | `Dashboard quản trị` | `Theo dõi user, module, cấu hình và cảnh báo hệ thống.` |

### 11.3 Scope badge

Scope badge giúp user hiểu dữ liệu đang hiển thị thuộc phạm vi nào.

| Scope | Label UI | Mô tả tooltip |
| --- | --- | --- |
| Own | `Dữ liệu cá nhân` | `Chỉ hiển thị dữ liệu của bạn.` |
| Team | `Team của tôi` | `Hiển thị nhân viên thuộc phạm vi quản lý trực tiếp.` |
| Department | `Phòng ban` | `Hiển thị dữ liệu thuộc phòng ban được phân quyền.` |
| Project | `Dự án liên quan` | `Hiển thị task/dự án bạn là thành viên hoặc có quyền.` |
| Company | `Toàn công ty` | `Hiển thị dữ liệu trong công ty hiện tại.` |
| System | `Toàn hệ thống` | `Hiển thị dữ liệu liên công ty/toàn hệ thống nếu được cấp quyền.` |

### 11.4 Refresh behavior

| Action | UI behavior |
| --- | --- |
| Click refresh dashboard | Refresh toàn bộ widget được phép refresh |
| Click refresh widget | Refresh widget riêng lẻ |
| Refresh đang chạy | Button loading, widget skeleton hoặc soft loading |
| Refresh lỗi | Toast nhẹ + widget error state |
| Cache hit | Hiển thị `Cập nhật lúc ...` |
| Stale data | Badge `Dữ liệu có thể chưa mới` + retry |

---

## 12. Dashboard quick actions

### 12.1 Quick action anatomy

```text
QuickActionCard
├── Icon
├── Label
├── Description optional
├── Badge/count optional
├── Enabled/disabled state
└── Target module
```

### 12.2 Quick action theo dashboard type

| Dashboard | Quick action ưu tiên |
| --- | --- |
| Employee | Check-in/out, Tạo đơn nghỉ, Xem task của tôi, Xem thông báo |
| Manager | Duyệt đơn nghỉ, Duyệt điều chỉnh công, Xem task team, Tạo task |
| HR | Thêm nhân viên, Xem bảng công, Xem đơn nghỉ, Hợp đồng sắp hết hạn |
| Admin | Tạo user, Quản lý role, Cấu hình hệ thống, Xem audit log |

### 12.3 Quick action state

| State | UI behavior |
| --- | --- |
| Enabled | Hiển thị rõ, có hover/focus, click được |
| Disabled by permission | Ẩn nếu user không có quyền |
| Disabled by business rule | Hiển thị mờ + tooltip lý do |
| Loading | Button/card loading |
| Success | Toast thành công nếu action gọi API module gốc |
| Error | Toast lỗi + giữ state không đổi |

### 12.4 Quick action không được làm lộ dữ liệu

1. Nếu user không có permission, action không hiển thị.
2. Nếu user có permission nhưng không có dữ liệu trong scope, action có thể hiển thị nhưng điều hướng sang màn empty state.
3. Nếu action gọi API module gốc, API đó vẫn phải kiểm tra quyền.
4. Không truyền `employee_id`, `department_id`, `company_id` từ frontend nếu backend có thể resolve.

---

## 13. Widget component system

### 13.1 Widget card anatomy

```text
WidgetCard
├── Header
│   ├── Icon / accent
│   ├── Title
│   ├── Status badge optional
│   ├── Last updated optional
│   └── More menu optional
├── Body
│   ├── Metric / list / chart / status / calendar
├── Footer optional
│   ├── Primary link
│   └── Secondary info
└── State layer
    ├── Loading skeleton
    ├── Empty state
    ├── Error state
    ├── Degraded state
    └── Forbidden state
```

### 13.2 Widget types

| Widget type | Dùng cho | Component chính |
| --- | --- | --- |
| Metric | Số liệu tổng quan | MetricCard |
| Status | Trạng thái hôm nay | StatusCard |
| List | Danh sách task/đơn/thông báo | ListWidget |
| Alert | Cảnh báo cần xử lý | AlertWidget |
| Mini Calendar | Lịch nghỉ team/công ty | CalendarMiniWidget |
| Progress | Tiến độ dự án/task | ProgressWidget |
| Chart | Tổng quan nhân sự/chấm công | ChartPlaceholder/ChartCard |
| Config/System | Module/config/log | SystemWidget |

### 13.3 Widget header rule

| Thành phần | Quy tắc |
| --- | --- |
| Title | Ngắn, dễ hiểu, không dùng thuật ngữ kỹ thuật |
| Icon | Dùng module accent theo source module |
| Last updated | Bắt buộc với widget cache hoặc số liệu quan trọng |
| More menu | Chỉ hiển thị nếu có action như refresh, hide, configure |
| View all | Đặt ở footer hoặc header phải nhất quán |

### 13.4 Widget body density

| Widget size | Số item tối đa | Ghi chú |
| --- | ---: | --- |
| Small | 1-3 item | Metric/status |
| Medium | 3-5 item | Task, pending leave, notifications |
| Large | 5-8 item | Calendar, project progress, HR overview |
| Full | Tùy thiết kế | Không nên biến thành table dài trong MVP |

---

## 14. Widget catalog UI MVP

### 14.1 Danh sách widget MVP

| Widget code | Tên hiển thị | Type | Module nguồn | Priority |
| --- | --- | --- | --- | --- |
| `ATTENDANCE_TODAY` | Chấm công hôm nay | Status + Action | ATT, LEAVE | P0 |
| `MY_TASKS` | Task của tôi hôm nay | List | TASK | P0 |
| `TASK_ALERTS` | Task quá hạn/sắp đến hạn | Alert/List | TASK | P0 |
| `LEAVE_BALANCE` | Số ngày phép còn lại | Metric | LEAVE | P0 |
| `PENDING_LEAVE` | Đơn nghỉ chờ duyệt | List/Approval | LEAVE | P0 |
| `LEAVE_CALENDAR` | Lịch nghỉ | Mini Calendar/List | LEAVE | P1 |
| `NOTIFICATIONS` | Thông báo mới | List | NOTI | P0 |
| `HR_OVERVIEW` | Tổng quan nhân sự | Metric/Chart | HR | P1 |
| `NEW_EMPLOYEES` | Nhân sự mới | List | HR | P2 |
| `CONTRACT_EXPIRING` | Hợp đồng sắp hết hạn | Alert/List | HR | P1 |
| `ATTENDANCE_ALERTS` | Bất thường chấm công | Alert/List | ATT | P0 cho Manager/HR |
| `PROJECT_PROGRESS` | Tiến độ dự án | Progress/List | TASK | P1 |
| `USER_SUMMARY` | Tổng quan user | Metric | AUTH | P1 Admin |
| `EMPLOYEE_SUMMARY` | Tổng số nhân viên | Metric | HR | P1 Admin/HR |
| `MODULE_STATUS` | Module đang dùng | Status/List | FOUNDATION | P1 Admin |
| `CONFIG_WARNINGS` | Cảnh báo cấu hình | Alert/List | FOUNDATION | P1 Admin |
| `NEW_USERS` | Tài khoản mới | List | AUTH | P2 Admin |
| `SYSTEM_LOGS` | Log quan trọng gần đây | List | FOUNDATION | P2 Admin |
| `SYSTEM_NOTIFICATIONS` | Thông báo hệ thống | List | NOTI | P1 Admin |
| `LATEST_LEAVE` | Đơn nghỉ gần nhất | List | LEAVE | P1 Employee |
| `TEAM_TASKS_TODAY` | Task team hôm nay | List | TASK | P0 Manager |
| `PROBATION_ENDING` | Sắp hết thử việc | Alert/List | HR | P1 HR |

### 14.2 Mapping widget theo dashboard type

| Widget | Employee | Manager | HR | Admin |
| --- | --- | --- | --- | --- |
| Chấm công hôm nay | Có | Có | Có nếu cần | Optional |
| Task của tôi hôm nay | Có | Có | Có | Có nếu liên quan |
| Task alerts | Có | Có theo team/project | Có nếu được cấp | Optional |
| Số ngày phép còn lại | Có | Có cá nhân | Có nếu cần | Optional |
| Đơn nghỉ chờ duyệt | Không | Có theo team | Có theo company | Optional |
| Lịch nghỉ | Cá nhân/Team nếu có quyền | Team | Company | Optional |
| Thông báo mới | Có | Có | Có | Có |
| HR overview | Không | Optional team | Có | Có nếu được cấp |
| Nhân sự mới | Không | Optional | Có | Có nếu được cấp |
| Hợp đồng sắp hết hạn | Không | Không mặc định | Có | Có nếu được cấp |
| Bất thường chấm công | Không | Có team | Có company | Có nếu được cấp |
| Tiến độ dự án | Có nếu member | Có | Optional | Optional |
| User summary | Không | Không | Không mặc định | Có |
| Module status | Không | Không | Không mặc định | Có |
| Config warnings | Không | Không | Không mặc định | Có |

---

## 15. Employee Dashboard UI

### 15.1 Mục tiêu

Employee Dashboard giúp nhân viên trả lời nhanh:

```text
Hôm nay tôi đã chấm công chưa?
Tôi cần làm task nào?
Tôi còn bao nhiêu ngày phép?
Có thông báo hoặc cảnh báo nào cần xem không?
```

### 15.2 Layout desktop đề xuất

```text
+------------------------------------------------------------------------------------------------+
| Dashboard của tôi                             Hôm nay 20/06/2026      [Làm mới]                 |
+------------------------------------------------------------------------------------------------+
| Quick actions: [Check-in/out] [Tạo đơn nghỉ] [Task của tôi] [Thông báo]                         |
+------------------------------------------------------------------------------------------------+
| [Chấm công hôm nay - 6 cols]                     [Số ngày phép còn lại - 3] [Thông báo - 3]    |
+------------------------------------------------------------------------------------------------+
| [Task của tôi hôm nay - 6 cols]                  [Task quá hạn/sắp hạn - 6 cols]               |
+------------------------------------------------------------------------------------------------+
| [Đơn nghỉ gần nhất - 6 cols]                     [Tiến độ dự án liên quan - 6 cols]            |
+------------------------------------------------------------------------------------------------+
```

### 15.3 Widget ưu tiên

| Thứ tự | Widget | Lý do |
| ---: | --- | --- |
| 1 | Chấm công hôm nay | Hành động thường xuyên nhất |
| 2 | Task của tôi hôm nay | Việc cần làm trong ngày |
| 3 | Task quá hạn/sắp hạn | Cảnh báo ưu tiên |
| 4 | Số ngày phép còn lại | Nhu cầu cá nhân thường xuyên |
| 5 | Thông báo mới | Nhận cập nhật hệ thống |
| 6 | Đơn nghỉ gần nhất | Theo dõi trạng thái đơn |
| 7 | Tiến độ dự án liên quan | Nếu user tham gia dự án |

### 15.4 Copy gợi ý

| Khu vực | Copy |
| --- | --- |
| Header subtitle | `Tổng quan ngày làm việc, task, nghỉ phép và thông báo của bạn.` |
| Empty task | `Bạn chưa có task nào cần xử lý hôm nay.` |
| Empty notification | `Bạn chưa có thông báo mới.` |
| Leave low warning | `Số ngày phép còn lại thấp. Hãy kiểm tra trước khi tạo đơn mới.` |
| Attendance blocked by leave | `Bạn đã có đơn nghỉ được duyệt hôm nay, không cần chấm công.` |

### 15.5 Mobile priority

Mobile Employee Dashboard hiển thị theo thứ tự:

1. Quick actions.
2. Chấm công hôm nay.
3. Task của tôi.
4. Cảnh báo task.
5. Phép còn lại.
6. Thông báo mới.
7. Đơn nghỉ gần nhất.

---

## 16. Manager Dashboard UI

### 16.1 Mục tiêu

Manager Dashboard giúp quản lý trả lời nhanh:

```text
Team của tôi có vấn đề gì cần xử lý không?
Có đơn nghỉ hoặc điều chỉnh công nào chờ duyệt không?
Task team đang tiến triển ra sao?
Ai đang nghỉ hoặc có bất thường chấm công?
```

### 16.2 Layout desktop đề xuất

```text
+------------------------------------------------------------------------------------------------+
| Dashboard quản lý        Scope: Team của tôi        [Team filter] [Làm mới]                    |
+------------------------------------------------------------------------------------------------+
| Quick actions: [Duyệt đơn nghỉ] [Duyệt điều chỉnh công] [Tạo task] [Xem task team]             |
+------------------------------------------------------------------------------------------------+
| [Đơn nghỉ chờ duyệt - 4] [Bất thường chấm công - 4] [Task team quá hạn - 4]                    |
+------------------------------------------------------------------------------------------------+
| [Task team hôm nay - 6 cols]                 [Lịch nghỉ team - 6 cols]                         |
+------------------------------------------------------------------------------------------------+
| [Tiến độ dự án - 8 cols]                                  [Thông báo mới - 4 cols]             |
+------------------------------------------------------------------------------------------------+
```

### 16.3 Widget ưu tiên

| Thứ tự | Widget | Lý do |
| ---: | --- | --- |
| 1 | Đơn nghỉ chờ duyệt | Cần xử lý để không chậm quy trình |
| 2 | Bất thường chấm công team | Cần kiểm soát vận hành |
| 3 | Task team quá hạn/sắp hạn | Cần điều phối công việc |
| 4 | Task team hôm nay | Theo dõi workload |
| 5 | Lịch nghỉ team | Tránh thiếu nhân sự |
| 6 | Tiến độ dự án | Quản lý kết quả |
| 7 | Thông báo mới | Cập nhật sự kiện liên quan |

### 16.4 Team filter

Manager Dashboard nên có filter phạm vi nếu manager quản lý nhiều team/project.

```text
[Team của tôi v] [Dự án v] [Thời gian: Tuần này v]
```

Quy tắc:

1. Filter chỉ hiển thị option trong data scope.
2. Không cho chọn phòng ban/team ngoài quyền.
3. Khi đổi filter, refresh widget liên quan.
4. Widget không liên quan filter giữ nguyên nếu source không cần.

### 16.5 Approval UX

Widget approval không nên hiển thị quá nhiều nút trong card nhỏ.

Gợi ý:

```text
Đơn nghỉ chờ duyệt
- Nguyễn Văn A | Nghỉ phép | 21/06 | 1 ngày
  [Xem]
- Trần Thị B | Nghỉ ốm | 22/06 | 0.5 ngày
  [Xem]
Footer: Xem tất cả đơn chờ duyệt
```

MVP khuyến nghị click `Xem` mở chi tiết trong LEAVE. Nếu muốn approve ngay trong dashboard, phải dùng modal/drawer của LEAVE API và vẫn kiểm tra quyền ở backend.

---

## 17. HR Dashboard UI

### 17.1 Mục tiêu

HR Dashboard giúp HR trả lời nhanh:

```text
Tình hình nhân sự hiện tại thế nào?
Có hợp đồng nào sắp hết hạn không?
Có đơn nghỉ, bảng công hoặc bất thường nào cần xử lý không?
Có nhân viên mới/sắp hết thử việc cần theo dõi không?
```

### 17.2 Layout desktop đề xuất

```text
+------------------------------------------------------------------------------------------------+
| Dashboard nhân sự       Scope: Toàn công ty / Phòng ban      [Month filter] [Làm mới]          |
+------------------------------------------------------------------------------------------------+
| Quick actions: [Thêm nhân viên] [Xem bảng công] [Xem đơn nghỉ] [Hợp đồng sắp hết hạn]          |
+------------------------------------------------------------------------------------------------+
| [Tổng nhân viên - 3] [Nhân sự mới - 3] [Đơn nghỉ pending - 3] [Bất thường công - 3]             |
+------------------------------------------------------------------------------------------------+
| [Tổng quan nhân sự - 6 cols]                 [Hợp đồng sắp hết hạn - 6 cols]                   |
+------------------------------------------------------------------------------------------------+
| [Sắp hết thử việc - 6 cols]                  [Lịch nghỉ công ty - 6 cols]                      |
+------------------------------------------------------------------------------------------------+
| [Thông báo HR - 4] [Attendance alerts - 4] [Recent profile changes - 4 optional]               |
+------------------------------------------------------------------------------------------------+
```

### 17.3 Widget ưu tiên

| Thứ tự | Widget | Lý do |
| ---: | --- | --- |
| 1 | Tổng quan nhân sự | Số liệu nền cho HR |
| 2 | Đơn nghỉ chờ xử lý | Quy trình thường xuyên |
| 3 | Bất thường chấm công | Ảnh hưởng bảng công/lương |
| 4 | Hợp đồng sắp hết hạn | Cảnh báo rủi ro nhân sự |
| 5 | Nhân sự mới | Theo dõi onboarding cơ bản |
| 6 | Sắp hết thử việc | Cần nhắc đánh giá/chuyển trạng thái |
| 7 | Lịch nghỉ công ty | Theo dõi vận hành |
| 8 | Thông báo mới | Nhận event HR/ATT/LEAVE |

### 17.4 HR overview widget

Nên hiển thị ở dạng metric + chart placeholder đơn giản.

```text
Tổng quan nhân sự
[Active: 126] [Probation: 12] [On leave today: 5] [Resigned this month: 2]
Chart: Cơ cấu nhân sự theo phòng ban
Footer: Xem danh sách nhân viên
```

### 17.5 Sensitive data rule

HR Dashboard có thể chứa dữ liệu nhạy cảm. UI phải tuân thủ:

1. Không hiển thị số giấy tờ, thông tin cá nhân nhạy cảm trên widget.
2. Hợp đồng sắp hết hạn chỉ hiển thị tên, mã nhân viên, vị trí, ngày hết hạn, không hiển thị lương.
3. Nếu user thiếu field-level permission, dùng masked field hoặc ẩn widget.
4. Export không nằm trong dashboard card, phải điều hướng sang module HR/ATT/LEAVE.

---

## 18. Admin Dashboard UI

### 18.1 Mục tiêu

Admin Dashboard giúp Admin trả lời nhanh:

```text
Hệ thống đang vận hành ổn không?
Có user/module/cấu hình nào cần xử lý không?
Có log hoặc cảnh báo quan trọng nào không?
```

### 18.2 Layout desktop đề xuất

```text
+------------------------------------------------------------------------------------------------+
| Dashboard quản trị      Scope: Company/System        [Làm mới] [Cấu hình dashboard]            |
+------------------------------------------------------------------------------------------------+
| Quick actions: [Tạo user] [Quản lý role] [Cấu hình hệ thống] [Audit log]                       |
+------------------------------------------------------------------------------------------------+
| [Tổng user - 3] [Tổng nhân viên - 3] [Module active - 3] [Config warnings - 3]                  |
+------------------------------------------------------------------------------------------------+
| [Module status - 6 cols]                 [Cảnh báo cấu hình - 6 cols]                          |
+------------------------------------------------------------------------------------------------+
| [Tài khoản mới - 4] [Log quan trọng - 4] [Thông báo hệ thống - 4]                              |
+------------------------------------------------------------------------------------------------+
```

### 18.3 Widget ưu tiên

| Thứ tự | Widget | Lý do |
| ---: | --- | --- |
| 1 | User summary | Quản lý truy cập |
| 2 | Module status | Biết module active/disabled/maintenance |
| 3 | Config warnings | Cảnh báo cấu hình thiếu hoặc sai |
| 4 | New users | Theo dõi tài khoản mới |
| 5 | System logs | Theo dõi thao tác quan trọng |
| 6 | System notifications | Nhận thông báo hệ thống |

### 18.4 Admin dashboard security

1. Chỉ user có quyền Admin mới thấy Admin Dashboard.
2. Không hiển thị log chứa payload nhạy cảm trong widget.
3. Log widget chỉ hiển thị summary; click sang Audit Log để xem chi tiết nếu có quyền.
4. Config warning có thể hiển thị tên cấu hình thiếu, không hiển thị secret/token.
5. Module status không lộ module bị tắt với user không có quyền quản trị module.

---

## 19. Thiết kế chi tiết widget MVP

## 19.1 Widget: Chấm công hôm nay

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `ATTENDANCE_TODAY` |
| Dashboard | Employee, Manager optional, HR optional |
| Type | Status + Quick Action |
| Source module | ATT, LEAVE, HR |
| Permission | `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` |
| Data scope | Own |
| Priority | P0 |

### UI anatomy

```text
Chấm công hôm nay                    Cập nhật 08:31
Trạng thái: Đã check-in
Giờ vào: 08:28        Giờ ra: --
Ca làm: 08:30 - 17:30
[Check-out]
Ghi chú: Bạn đang làm việc tại văn phòng
```

### State

| State | UI behavior |
| --- | --- |
| Chưa check-in | Hiển thị nút `Check-in` nổi bật |
| Đã check-in | Hiển thị giờ vào + nút `Check-out` |
| Đã check-out | Hiển thị đủ giờ vào/ra + trạng thái hoàn thành |
| Đi muộn | Badge warning `Đi muộn` |
| Thiếu check-out | Badge danger/warning + CTA `Gửi yêu cầu điều chỉnh` |
| Nghỉ phép full-day approved | Disable action, hiển thị `Bạn đã nghỉ phép hôm nay` |
| Remote approved | Hiển thị badge `Remote` và action theo rule remote |
| Auto attendance | Hiển thị badge `Tự động chấm công` |
| Lỗi tải ATT | Degraded state + retry |

### CTA

| CTA | Điều kiện | Target |
| --- | --- | --- |
| Check-in | ATT trả allowed_action = check_in | ATT API |
| Check-out | ATT trả allowed_action = check_out | ATT API |
| Xem bảng công | Có permission ATT record view | `/attendance/my-records` |
| Điều chỉnh công | Có rule cho phép | `/attendance/adjustments/new` |

---

## 19.2 Widget: Task của tôi hôm nay

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `MY_TASKS` |
| Dashboard | Employee, Manager, HR nếu có task |
| Type | List |
| Source module | TASK |
| Permission | `DASH.WIDGET.VIEW_MY_TASKS` |
| Data scope | Own/Project |
| Priority | P0 |

### UI anatomy

```text
Task của tôi hôm nay                         Xem tất cả
[High] Hoàn thiện API Leave       Hôm nay 17:00
[Medium] Review UI Dashboard      Ngày mai
[Low] Cập nhật tài liệu task      Không có deadline
```

### List item fields

| Field | Hiển thị |
| --- | --- |
| Priority | Badge Low/Medium/High/Urgent |
| Title | Tối đa 2 dòng |
| Project | Optional, text phụ |
| Due date | Ngày/giờ hoặc relative label |
| Status | Todo/In Progress/In Review/Done |
| Assignee | Ẩn nếu là của tôi; hiện avatar nếu nhiều assignee |

### State

| State | UI behavior |
| --- | --- |
| Empty | `Bạn chưa có task nào cần xử lý hôm nay.` |
| Có task quá hạn | Đẩy lên đầu, badge danger |
| Loading | Skeleton 3 dòng |
| Error | ErrorState + retry |

---

## 19.3 Widget: Task quá hạn/sắp đến hạn

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `TASK_ALERTS` |
| Dashboard | Employee, Manager, HR/Admin optional |
| Type | Alert/List |
| Source module | TASK |
| Permission | `DASH.WIDGET.VIEW_TASK_ALERTS` |
| Data scope | Own/Team/Project/Company theo quyền |
| Priority | P0 |

### UI behavior

1. Task quá hạn hiển thị trước task sắp đến hạn.
2. Dùng màu danger cho quá hạn, warning cho sắp hạn.
3. Không hiển thị hơn 5 item trong widget medium.
4. Có footer `Xem tất cả task quá hạn`.
5. Nếu Manager xem Team, item nên hiển thị assignee.

---

## 19.4 Widget: Số ngày phép còn lại

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `LEAVE_BALANCE` |
| Dashboard | Employee, Manager optional, HR optional |
| Type | Metric |
| Source module | LEAVE |
| Permission | `DASH.WIDGET.VIEW_LEAVE_BALANCE` |
| Data scope | Own |
| Priority | P0 |

### UI anatomy

```text
Phép còn lại
8.5 ngày
Đã dùng: 3.5 ngày     Chờ duyệt: 1 ngày
[Tạo đơn nghỉ]
```

### State

| State | UI behavior |
| --- | --- |
| Balance bình thường | Metric neutral/success |
| Balance thấp | Warning badge `Sắp hết phép` |
| Balance âm nếu policy cho phép | Danger badge `Vượt phép` |
| Không có policy | Degraded/config warning nếu user có quyền admin; employee thấy message đơn giản |

---

## 19.5 Widget: Đơn nghỉ chờ duyệt

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `PENDING_LEAVE` |
| Dashboard | Manager, HR, Admin optional |
| Type | List/Approval |
| Source module | LEAVE |
| Permission | `DASH.WIDGET.VIEW_PENDING_LEAVE` |
| Data scope | Team/Department/Company |
| Priority | P0 |

### UI anatomy

```text
Đơn nghỉ chờ duyệt                         4 đơn
Nguyễn Văn A     Nghỉ phép     21/06     1 ngày     [Xem]
Trần Thị B       Nghỉ ốm       22/06     0.5 ngày   [Xem]
Footer: Xem tất cả
```

### Quy tắc

1. Không approve trực tiếp trong list nếu chưa có modal chuẩn.
2. Click `Xem` mở Leave Detail hoặc drawer từ LEAVE.
3. Hiển thị người gửi, loại nghỉ, thời gian, số ngày, trạng thái pending.
4. Với HR scope Company, có thêm phòng ban.
5. Không hiển thị lý do nghỉ nhạy cảm trên widget nếu policy yêu cầu ẩn.

---

## 19.6 Widget: Lịch nghỉ

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `LEAVE_CALENDAR` |
| Dashboard | Manager, HR, Employee optional |
| Type | Mini Calendar/List |
| Source module | LEAVE |
| Permission | `DASH.WIDGET.VIEW_LEAVE_CALENDAR` |
| Data scope | Own/Team/Department/Company |
| Priority | P1 |

### UI variants

| Variant | Dùng cho |
| --- | --- |
| Mini list | Mobile, widget small/medium |
| Mini calendar | Desktop, widget large |
| Timeline tuần | Manager/HR nếu muốn xem ai nghỉ trong tuần |

### Rule

1. Employee chỉ thấy lịch nghỉ của bản thân nếu không có quyền team/company.
2. Manager thấy team.
3. HR thấy company hoặc department theo quyền.
4. Không hiển thị lý do nghỉ chi tiết nếu thiếu quyền.

---

## 19.7 Widget: Thông báo mới

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `NOTIFICATIONS` |
| Dashboard | Tất cả |
| Type | List |
| Source module | NOTI |
| Permission | `DASH.WIDGET.VIEW_NOTIFICATIONS` |
| Data scope | Own |
| Priority | P0 |

### UI anatomy

```text
Thông báo mới                              5 chưa đọc
[Leave] Đơn nghỉ của bạn đã được duyệt     5 phút trước
[Task] Bạn được giao task mới              20 phút trước
[ATT] Bạn chưa check-out hôm qua           Hôm qua
Footer: Xem tất cả thông báo
```

### Interaction

1. Click item -> mark read nếu NOTI API cho phép -> điều hướng target.
2. Có badge unread.
3. Không hiển thị payload nhạy cảm vượt quyền.
4. Nếu notification target không còn quyền, hiển thị thông báo không truy cập được.

---

## 19.8 Widget: Tổng quan nhân sự

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `HR_OVERVIEW` |
| Dashboard | HR, Admin optional |
| Type | Metric + Chart |
| Source module | HR |
| Permission | `DASH.WIDGET.VIEW_HR_OVERVIEW` |
| Data scope | Department/Company/System |
| Priority | P1 |

### UI anatomy

```text
Tổng quan nhân sự
Active: 126     Probation: 12     On leave today: 5     Resigned this month: 2
[Chart placeholder: Nhân sự theo phòng ban]
Footer: Xem danh sách nhân viên
```

---

## 19.9 Widget: Hợp đồng sắp hết hạn

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `CONTRACT_EXPIRING` |
| Dashboard | HR, Admin optional |
| Type | Alert/List |
| Source module | HR |
| Permission | `DASH.WIDGET.VIEW_CONTRACT_EXPIRING` |
| Data scope | Company/Department |
| Priority | P1 |

### UI rule

1. Mặc định hiển thị hợp đồng hết hạn trong 30 ngày.
2. Item gồm: nhân viên, phòng ban, loại hợp đồng, ngày hết hạn.
3. Không hiển thị lương/phụ cấp trên widget.
4. CTA `Xem hợp đồng` điều hướng sang HR.

---

## 19.10 Widget: Bất thường chấm công

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `ATTENDANCE_ALERTS` |
| Dashboard | Manager, HR |
| Type | Alert/List |
| Source module | ATT |
| Permission | `DASH.WIDGET.VIEW_ATTENDANCE_ALERTS` |
| Data scope | Team/Department/Company |
| Priority | P0 với Manager/HR |

### Alert types

| Type | Badge | Mô tả |
| --- | --- | --- |
| `MISSING_CHECKOUT` | Warning | Quên check-out |
| `LATE_CHECKIN` | Warning | Đi muộn |
| `EARLY_CHECKOUT` | Warning | Về sớm |
| `ABSENT` | Danger | Vắng mặt |
| `REMOTE_PENDING` | Info/Warning | Remote request chờ duyệt |
| `ADJUSTMENT_PENDING` | Warning | Điều chỉnh công chờ duyệt |

---

## 19.11 Widget: Tiến độ dự án

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `PROJECT_PROGRESS` |
| Dashboard | Manager, Employee nếu liên quan, HR/Admin optional |
| Type | Progress/List |
| Source module | TASK |
| Permission | `DASH.WIDGET.VIEW_PROJECT_PROGRESS` |
| Data scope | Project/Team/Company |
| Priority | P1 |

### UI anatomy

```text
Tiến độ dự án
EMS MVP UI/UX       68%     12/34 task done     3 quá hạn
API Design          82%     41/50 task done     1 quá hạn
Footer: Xem dự án
```

---

## 19.12 Widget: Cảnh báo cấu hình

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `CONFIG_WARNINGS` |
| Dashboard | Admin |
| Type | Alert/List |
| Source module | FOUNDATION, AUTH, HR, ATT, LEAVE, NOTI |
| Permission | `DASH.WIDGET.VIEW_CONFIG_WARNINGS` |
| Data scope | Company/System |
| Priority | P1 Admin |

### Warning examples

| Warning | CTA |
| --- | --- |
| Chưa cấu hình rule chấm công mặc định | `Cấu hình chấm công` |
| Chưa seed leave type mặc định | `Cấu hình nghỉ phép` |
| Có role chưa gán permission | `Xem role` |
| Notification template bị tắt | `Xem template` |
| Module đang bảo trì | `Xem module status` |

---

## 20. Permission và visibility rule

### 20.1 Nguyên tắc hiển thị widget

```text
Widget hiển thị khi:
- Module DASH active
- User có quyền xem dashboard type
- User có quyền xem widget
- User có scope phù hợp
- Module nguồn active hoặc widget có fallback hợp lệ
- Widget config đang bật
```

### 20.2 Widget visibility state

| Trường hợp | UI behavior |
| --- | --- |
| Thiếu permission widget | Ẩn widget |
| Thiếu permission dashboard type | Không cho vào route, hiển thị 403 |
| Có permission nhưng không có dữ liệu trong scope | Empty state |
| Module nguồn disabled | Widget degraded hoặc ẩn theo config |
| Widget bị admin tắt | Không hiển thị với user thường |
| Widget lỗi API | Error state trong widget, không làm sập toàn dashboard |

### 20.3 Action visibility

| Trường hợp | UI behavior |
| --- | --- |
| Không có quyền action | Ẩn action |
| Có quyền nhưng business rule chặn | Disable + tooltip lý do |
| Action nguy hiểm | Confirm dialog hoặc điều hướng sang module gốc |
| Action cần dữ liệu nhạy cảm | Chỉ hiển thị nếu field-level permission hợp lệ |

### 20.4 Data scope display

Dashboard cần biểu hiện data scope tự nhiên:

1. Header có scope badge.
2. Widget list có label `Team`, `Công ty`, `Cá nhân` nếu cần.
3. Filter chỉ hiển thị option user được phép.
4. Empty state phải nói rõ phạm vi: `Không có đơn nghỉ chờ duyệt trong team của bạn.`
5. Không hiển thị count tổng vượt scope.

---

## 21. State design cho Dashboard

### 21.1 Page-level states

| State | UI behavior |
| --- | --- |
| Loading dashboard | Skeleton page header + skeleton widget grid |
| Empty permission | Không có dashboard nào được cấp quyền, hiển thị Forbidden/Contact admin |
| Partial success | Widget nào lỗi hiển thị lỗi riêng, dashboard vẫn hiển thị widget còn lại |
| Full error | Không tải được cấu hình dashboard, hiển thị ErrorState + retry |
| Forbidden | `/403` hoặc ForbiddenPage |
| Maintenance | Module DASH maintenance state |

### 21.2 Widget-level states

| State | UI behavior |
| --- | --- |
| Loading | Skeleton phù hợp type widget |
| Empty | EmptyState ngắn, có CTA nếu hợp lệ |
| Error | ErrorState nhỏ + retry widget |
| Degraded | Badge `Dữ liệu chưa đầy đủ` + fallback nếu có |
| Stale | Hiển thị `Cập nhật lần cuối ...` + refresh |
| Forbidden | Không nên xuất hiện với user thường; admin preview có thể thấy |
| Disabled | Widget bị tắt trong config, chỉ thấy trong config/admin |

### 21.3 Toast và feedback

| Tình huống | Feedback |
| --- | --- |
| Refresh thành công | Không cần toast nếu chỉ cập nhật dữ liệu; cập nhật timestamp là đủ |
| Refresh lỗi | Toast warning nhẹ |
| Quick action thành công | Toast success từ module gốc |
| Quick action lỗi business | Toast/error message theo module gốc |
| Widget config saved | Toast success |
| Không có quyền | Toast hoặc ForbiddenState tùy ngữ cảnh |

---

## 22. Responsive guideline

### 22.1 Desktop

1. Sidebar DASH cố định hoặc collapsible.
2. Dashboard content dùng grid 12 cột.
3. Quick action nằm trên widget grid.
4. Widget quan trọng nằm trên fold đầu tiên.
5. Header có dashboard type switcher, scope badge, refresh, config.

### 22.2 Tablet

1. Sidebar có thể collapse hoặc drawer.
2. Grid chuyển 2 cột.
3. Metric card hiển thị 2 card/hàng.
4. List widget full width nếu nội dung nhiều.
5. Filter nằm trong dropdown/drawer nếu quá dài.

### 22.3 Mobile web

1. Một cột duy nhất.
2. Quick action horizontal scroll hoặc sticky section.
3. Widget collapse optional.
4. Không dùng chart phức tạp; dùng metric/list summary.
5. Dashboard type switcher dạng dropdown full width.
6. Footer CTA rõ ràng, không đặt quá nhiều button trong item.

### 22.4 Breakpoint behavior

| Breakpoint | Behavior |
| --- | --- |
| `>=1200px` | 12-column grid, desktop density |
| `1024-1199px` | Sidebar collapsible, grid 8-12 cột tùy layout |
| `768-1023px` | 2-column, filter compact |
| `<768px` | 1-column, card stack, drawer/fullscreen |

---

## 23. Accessibility guideline

### 23.1 Tiêu chuẩn tối thiểu

1. Widget title phải là heading semantic hợp lý.
2. Metric number phải có label rõ, không đọc số đơn lẻ bằng screen reader.
3. Icon-only action phải có aria-label và tooltip.
4. Focus state rõ cho widget action, quick action, refresh, dropdown.
5. Không truyền đạt trạng thái chỉ bằng màu; badge phải có text.
6. Chart phải có text summary thay thế.
7. Loading skeleton không được gây nhấp nháy mạnh.
8. Error state phải cho phép retry bằng keyboard.
9. Touch target mobile tối thiểu 44px.
10. Dashboard type switcher phải dùng được bằng keyboard.

### 23.2 Keyboard interaction

| Component | Keyboard behavior |
| --- | --- |
| Dashboard type switcher | Tab focus, Enter mở, Arrow chọn, Escape đóng |
| Quick action | Enter/Space activate |
| Widget more menu | Enter mở menu, Escape đóng |
| Widget link | Tab focus theo thứ tự nội dung |
| Refresh button | Enter/Space refresh |
| Modal/drawer config | Focus trap |

---

## 24. API mapping cho Frontend

### 24.1 API tổng quan dashboard

| UI nhu cầu | API đề xuất | Ghi chú |
| --- | --- | --- |
| Lấy dashboard mặc định | `GET /api/v1/dashboard/me` | Dùng khi vào `/dashboard` |
| Lấy dashboard type được phép | `GET /api/v1/dashboard/types` | Render type switcher |
| Lấy widget catalog | `GET /api/v1/dashboard/widgets` | Admin/config hoặc lazy render |
| Lấy Employee Dashboard | `GET /api/v1/dashboard/employee` | Full dashboard |
| Lấy Manager Dashboard | `GET /api/v1/dashboard/manager` | Full dashboard |
| Lấy HR Dashboard | `GET /api/v1/dashboard/hr` | Full dashboard |
| Lấy Admin Dashboard | `GET /api/v1/dashboard/admin` | Full dashboard |
| Lấy widget riêng | `GET /api/v1/dashboard/widgets/{slug}` | Lazy load/refresh |
| Lấy config | `GET /api/v1/dashboard/configs` | Admin |
| Update config | `PATCH /api/v1/dashboard/configs/{id}` | Admin |

### 24.2 API mapping widget

| Widget | API slug | Endpoint |
| --- | --- | --- |
| Chấm công hôm nay | `attendance-today` | `/api/v1/dashboard/widgets/attendance-today` |
| Task của tôi | `my-tasks` | `/api/v1/dashboard/widgets/my-tasks` |
| Task alerts | `task-alerts` | `/api/v1/dashboard/widgets/task-alerts` |
| Số ngày phép còn lại | `leave-balance` | `/api/v1/dashboard/widgets/leave-balance` |
| Đơn nghỉ chờ duyệt | `pending-leave` | `/api/v1/dashboard/widgets/pending-leave` |
| Lịch nghỉ | `leave-calendar` | `/api/v1/dashboard/widgets/leave-calendar` |
| Thông báo mới | `notifications` | `/api/v1/dashboard/widgets/notifications` |
| Tổng quan nhân sự | `hr-overview` | `/api/v1/dashboard/widgets/hr-overview` |
| Hợp đồng sắp hết hạn | `contract-expiring` | `/api/v1/dashboard/widgets/contract-expiring` |
| Bất thường chấm công | `attendance-alerts` | `/api/v1/dashboard/widgets/attendance-alerts` |
| Tiến độ dự án | `project-progress` | `/api/v1/dashboard/widgets/project-progress` |
| Cảnh báo cấu hình | `config-warnings` | `/api/v1/dashboard/widgets/config-warnings` |

### 24.3 Frontend data model đề xuất

```ts
type DashboardType = 'Employee' | 'Manager' | 'HR' | 'Admin';
type WidgetStatus = 'Active' | 'Inactive' | 'Hidden' | 'Loading' | 'Empty' | 'Error' | 'Degraded' | 'Stale';
type WidgetSize = 'small' | 'medium' | 'large' | 'full';

interface DashboardViewModel {
  dashboardType: DashboardType;
  title: string;
  subtitle?: string;
  scopeLabel: string;
  lastUpdatedAt?: string;
  quickActions: QuickActionVM[];
  widgets: DashboardWidgetVM[];
}

interface DashboardWidgetVM {
  widgetCode: string;
  title: string;
  type: 'metric' | 'status' | 'list' | 'alert' | 'calendar' | 'progress' | 'chart' | 'system';
  status: WidgetStatus;
  size: WidgetSize;
  order: number;
  sourceModules: string[];
  permission?: string;
  dataScope?: string;
  data: unknown;
  emptyState?: WidgetEmptyState;
  errorState?: WidgetErrorState;
  lastUpdatedAt?: string;
  actions?: QuickActionVM[];
}

interface QuickActionVM {
  actionCode: string;
  label: string;
  targetModule: string;
  method: 'NAVIGATE' | 'API_CALL' | 'OPEN_DRAWER' | 'OPEN_MODAL';
  targetUrl?: string;
  apiEndpoint?: string;
  enabled: boolean;
  disabledReason?: string;
}
```

---

## 25. Component mapping với UI-05

| UI-08 thành phần | Component UI-05 | Frontend component gợi ý |
| --- | --- | --- |
| Dashboard Shell | ModuleWorkspaceLayout | `DashboardLayout` |
| Page Header | PageHeader, Breadcrumb | `DashboardHeader` |
| Type Switcher | Select/Tabs | `DashboardTypeSwitcher` |
| Scope Badge | Badge/Tag | `ScopeBadge` |
| Quick Actions | QuickActionCard | `DashboardQuickActions` |
| Metric Widget | MetricCard | `MetricWidget` |
| Widget Container | WidgetCard | `DashboardWidgetCard` |
| Task list | ListWidget, TaskCard | `TaskListWidget` |
| Leave approval | ListWidget, ApprovalBox | `PendingLeaveWidget` |
| Attendance today | AttendanceStatusCard, CheckInOutButton | `AttendanceTodayWidget` |
| Leave balance | LeaveBalanceCard | `LeaveBalanceWidget` |
| Notifications | NotificationListItem | `NotificationsWidget` |
| Chart placeholder | ChartPlaceholder | `ChartWidget` |
| Loading | Skeleton | `WidgetSkeleton` |
| Empty | EmptyState | `WidgetEmptyState` |
| Error | ErrorState | `WidgetErrorState` |
| Config drawer | Drawer, Form | `WidgetConfigDrawer` |

---

## 26. Dashboard Config UI

### 26.1 Mục tiêu

Dashboard Config cho phép Admin hoặc người có quyền cấu hình widget theo company/role/user/dashboard type ở mức MVP.

### 26.2 Screen: Dashboard Config List

```text
+--------------------------------------------------------------------------------+
| Cấu hình Dashboard                                [Tạo cấu hình nếu cần]        |
+--------------------------------------------------------------------------------+
| Filter: Dashboard type | Role | Status | Keyword                                |
+--------------------------------------------------------------------------------+
| Dashboard type | Scope config | Role/User | Widget count | Status | Actions      |
| Employee       | Company      | Employee  | 7            | Active | Edit         |
| Manager        | Company      | Manager   | 8            | Active | Edit         |
| HR             | Company      | HR        | 10           | Active | Edit         |
+--------------------------------------------------------------------------------+
```

### 26.3 Screen: Dashboard Config Edit

```text
+--------------------------------------------------------------------------------+
| Sửa cấu hình HR Dashboard                                                      |
+--------------------------------------------------------------------------------+
| [Widget list / drag order optional MVP can use up/down]                         |
| [x] HR Overview              Size: Large      Order: 1                          |
| [x] Pending Leave            Size: Medium     Order: 2                          |
| [x] Attendance Alerts        Size: Medium     Order: 3                          |
| [ ] Project Progress         Size: Medium     Order: 4                          |
+--------------------------------------------------------------------------------+
| [Reset mặc định]                                      [Hủy] [Lưu cấu hình]       |
+--------------------------------------------------------------------------------+
```

### 26.4 MVP config rule

1. MVP có thể chưa cần kéo thả phức tạp; dùng order number hoặc up/down.
2. Chỉ Admin có `DASH.CONFIG.UPDATE` được sửa.
3. Widget bị tắt không hiển thị với user thường.
4. Config không được cấp quyền vượt permission thật của user.
5. Khi config thay đổi, cần invalidate cache dashboard.
6. Ghi audit log khi bật/tắt, đổi thứ tự, đổi size widget.

---

## 27. Figma frame list đề xuất

### 27.1 Desktop frames

| Frame | Nội dung |
| --- | --- |
| UI08-DESKTOP-001 | Dashboard Default Resolve |
| UI08-DESKTOP-002 | Employee Dashboard |
| UI08-DESKTOP-003 | Manager Dashboard |
| UI08-DESKTOP-004 | HR Dashboard |
| UI08-DESKTOP-005 | Admin Dashboard |
| UI08-DESKTOP-006 | Widget Loading States |
| UI08-DESKTOP-007 | Widget Empty/Error/Degraded States |
| UI08-DESKTOP-008 | Dashboard Config List |
| UI08-DESKTOP-009 | Dashboard Config Edit |
| UI08-DESKTOP-010 | Widget Detail/Preview Drawer |

### 27.2 Tablet frames

| Frame | Nội dung |
| --- | --- |
| UI08-TABLET-001 | Employee Dashboard Tablet |
| UI08-TABLET-002 | Manager Dashboard Tablet |
| UI08-TABLET-003 | HR Dashboard Tablet |
| UI08-TABLET-004 | Admin Dashboard Tablet |

### 27.3 Mobile frames

| Frame | Nội dung |
| --- | --- |
| UI08-MOBILE-001 | Employee Dashboard Mobile |
| UI08-MOBILE-002 | Manager Dashboard Mobile |
| UI08-MOBILE-003 | HR Dashboard Mobile |
| UI08-MOBILE-004 | Admin Dashboard Mobile |
| UI08-MOBILE-005 | Widget Error/Empty Mobile |
| UI08-MOBILE-006 | Dashboard Type Switcher Mobile |

### 27.4 Component frames

| Frame | Nội dung |
| --- | --- |
| UI08-COMP-001 | Dashboard Header |
| UI08-COMP-002 | Dashboard Type Switcher |
| UI08-COMP-003 | Quick Action Card |
| UI08-COMP-004 | Metric Widget |
| UI08-COMP-005 | List Widget |
| UI08-COMP-006 | Status Widget |
| UI08-COMP-007 | Alert Widget |
| UI08-COMP-008 | Progress Widget |
| UI08-COMP-009 | Widget State Variants |

---

## 28. Frontend implementation notes

### 28.1 Render strategy

Khuyến nghị render Dashboard theo 2 bước:

```text
1. Load dashboard shell + config + allowed widgets từ `/dashboard/me`.
2. Lazy load các widget nặng hoặc refresh widget riêng qua `/dashboard/widgets/{slug}`.
```

### 28.2 Error isolation

1. Lỗi một widget không làm sập toàn dashboard.
2. Mỗi widget có error boundary riêng.
3. Nếu `/dashboard/me` lỗi toàn bộ, hiển thị page-level error.
4. Nếu widget source module lỗi, hiển thị degraded/error state trong widget.

### 28.3 Cache UX

1. Hiển thị timestamp `Cập nhật lúc HH:mm`.
2. Nếu refresh thủ công, không blank toàn bộ dashboard; dùng soft loading.
3. Widget realtime hoặc gần realtime như notification có TTL ngắn.
4. HR overview có TTL dài hơn.

### 28.4 Permission guard

1. Route guard kiểm tra dashboard type.
2. Component guard kiểm tra action/widget nếu frontend có permission map.
3. Không tin dữ liệu frontend cho scope.
4. Nếu backend trả widget hidden, frontend không render.

### 28.5 Deep link

Quick action và widget item nên có target URL an toàn:

| Source | Target |
| --- | --- |
| Attendance today | `/attendance/today` hoặc `/attendance/my-records` |
| Pending leave | `/leave/requests/:id` hoặc `/leave/approvals` |
| My task | `/tasks/:id` |
| Notification | Target do NOTI trả về |
| Contract expiring | `/hr/employees/:id/contracts` |
| Config warning | `/system/settings` hoặc module config tương ứng |

---

## 29. Backend/API notes cho UI

### 29.1 Backend cần trả metadata đủ cho UI

Mỗi widget response nên có:

1. `widget_code`.
2. `widget_name`.
3. `widget_type`.
4. `status`.
5. `layout`.
6. `permission`.
7. `data_scope`.
8. `source_modules`.
9. `data`.
10. `empty_state`.
11. `error_state`.
12. `last_updated_at`.
13. `cache`.
14. `actions`.

### 29.2 Backend cần trả action state

Quick action không nên để frontend tự đoán.

Ví dụ ATT trả:

```json
{
  "action_code": "CHECK_OUT",
  "label": "Check-out",
  "enabled": true,
  "disabled_reason": null,
  "target_module": "ATT",
  "method": "API_CALL",
  "api_endpoint": "/api/v1/attendance/check-out"
}
```

### 29.3 Backend cần phân biệt lỗi

| Lỗi | UI behavior |
| --- | --- |
| 401 | Redirect login/refresh token |
| 403 dashboard | Forbidden page |
| 403 widget | Ẩn widget hoặc Forbidden preview với admin |
| 404 target | Notification/task link không còn tồn tại |
| 409 business rule | Disable/action error message |
| 422 validation | Hiển thị lỗi form nếu config |
| 500 source module | Widget degraded/error |

---

## 30. QA checklist

### 30.1 Permission và data scope

| Test | Kỳ vọng |
| --- | --- |
| Employee vào Dashboard | Chỉ thấy Employee widgets được cấp quyền |
| Employee nhập `/dashboard/hr` | Bị 403 hoặc không truy cập được |
| Manager xem pending leave | Chỉ thấy đơn thuộc team |
| HR xem attendance alerts | Chỉ thấy dữ liệu trong scope HR được cấp |
| Admin xem system logs | Chỉ thấy log summary, không lộ payload nhạy cảm |
| User mất quyền widget | Widget biến mất sau refresh |
| User có nhiều role | Type switcher chỉ có dashboard được phép |

### 30.2 Widget state

| Test | Kỳ vọng |
| --- | --- |
| API widget loading | Skeleton đúng loại widget |
| Widget empty | Empty copy đúng ngữ cảnh |
| Widget lỗi source module | Error/degraded state, dashboard vẫn hoạt động |
| Cache stale | Hiển thị last updated/stale warning |
| Refresh widget | Chỉ widget đó loading/refresh |
| Refresh dashboard | Widget refresh nhưng không blank toàn page |

### 30.3 Quick action

| Test | Kỳ vọng |
| --- | --- |
| Check-in từ dashboard | Gọi ATT API, cập nhật widget state |
| Đã có leave full-day | Check-in disabled/ẩn theo ATT rule |
| Click task | Điều hướng sang task detail và TASK kiểm quyền |
| Click pending leave | Điều hướng sang LEAVE detail/approval |
| User thiếu quyền approve | Không thấy approve action |
| Business rule chặn action | Disabled + tooltip/message |

### 30.4 Responsive

| Test | Kỳ vọng |
| --- | --- |
| Desktop 1440px | Grid 12 cột đúng layout |
| Laptop 1024px | Sidebar collapsible, widget không vỡ |
| Tablet 768px | 2 cột hoặc stacked hợp lý |
| Mobile 375px | 1 cột, quick action dễ chạm |
| Mobile chart | Có summary text thay chart phức tạp |

### 30.5 Accessibility

| Test | Kỳ vọng |
| --- | --- |
| Keyboard tab | Đi qua quick action/widget link hợp lý |
| Focus visible | Focus ring rõ |
| Screen reader metric | Đọc được label + value |
| Icon-only action | Có aria-label |
| Chart | Có text summary |
| Color state | Badge có text, không chỉ dùng màu |

---

## 31. Acceptance criteria UI-08

| Mã | Tiêu chí nghiệm thu |
| --- | --- |
| UI08-AC-001 | Có định nghĩa rõ Dashboard là app/workspace riêng, không thay Home Portal |
| UI08-AC-002 | Có thiết kế Employee, Manager, HR, Admin Dashboard |
| UI08-AC-003 | Có route, screen code và dashboard type đầy đủ |
| UI08-AC-004 | Có widget catalog MVP với code, type, module nguồn, permission và priority |
| UI08-AC-005 | Có layout desktop/tablet/mobile cho dashboard |
| UI08-AC-006 | Có quy tắc quick action và nguyên tắc không xử lý nghiệp vụ gốc trong DASH |
| UI08-AC-007 | Có rule hiển thị widget theo permission, data scope, module status và widget config |
| UI08-AC-008 | Có state design cho loading, empty, error, degraded, stale, forbidden và disabled |
| UI08-AC-009 | Có mapping widget với API-08 và module nguồn |
| UI08-AC-010 | Có component mapping với UI-05 Design System |
| UI08-AC-011 | Có guideline responsive và accessibility |
| UI08-AC-012 | Có Dashboard Config UI ở mức MVP cho Admin |
| UI08-AC-013 | Có Figma frame list để UI/UX Designer triển khai |
| UI08-AC-014 | Có checklist QA cho permission, scope, widget state, quick action, responsive và accessibility |
| UI08-AC-015 | Tài liệu đủ làm cơ sở để triển khai high-fidelity, frontend component và API integration |

---

## 32. Kết luận

UI-08 chốt thiết kế Dashboard UI/UX cho MVP theo hướng:

```text
Dashboard là app/workspace riêng
-> Hiển thị theo vai trò Employee / Manager / HR / Admin
-> Widget hóa dữ liệu từ ATT, LEAVE, TASK, HR, NOTI, AUTH, FOUNDATION
-> Quick action chỉ điều hướng hoặc gọi module gốc
-> Permission + data scope quyết định toàn bộ dữ liệu và hành động
-> Có state, responsive, accessibility và QA checklist đầy đủ
```

Sau UI-08, bước tiếp theo nên triển khai:

```text
UI-09: Module UI Design
```

UI-09 sẽ đi vào thiết kế chi tiết từng màn nghiệp vụ của AUTH, HR, ATT, LEAVE, TASK và NOTI dựa trên layout, component và dashboard đã được chốt trong UI-01 -> UI-08.
