# UI-05: DESIGN SYSTEM & COMPONENT LIBRARY
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

> **📚 Bộ tài liệu UI — Hệ thống Quản lý Doanh nghiệp**
> [UI-01 Tổng quan](<UI-01_UIUX_Design_Tong_Quan.md>) · [UI-02 IA/Sitemap](<UI-02_Information_Architecture_Sitemap.md>) · [UI-03 User Flow](<UI-03_User_Flow_MVP.md>) · [UI-04 Screen List](<UI-04_Screen_List_Wireframe_Plan.md>) · **UI-05 Design System** · [UI-06 Home/App Switcher](<UI-06_Home_Portal_App_Switcher_UI_Design.md>) · [UI-07 Module Workspace](<UI-07_Module_Workspace_Template_Design.md>) · [UI-08 Dashboard](<UI-08_Dashboard_UIUX_Design.md>) · [UI-09 Module UI](<UI-09_Module_UI_Design.md>) · [UI-10 Prototype/Handoff](<UI-10_Prototype_Frontend_Handoff_Guide.md>)
>
> **Liên quan:** [Sản phẩm: PRD-00](<../PRD/PRD-00 Enterprise Management System .md>) · [Đặc tả: SPEC-01 Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | UI-05 |
| Tên tài liệu | Design System & Component Library |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-04 |
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

Tài liệu UI-05 định nghĩa **Design System** và **Component Library** cho hệ thống quản lý doanh nghiệp nội bộ ở giai đoạn MVP Version 1.0.

UI-05 dùng để:

1. Chuẩn hóa phong cách giao diện toàn hệ thống.
2. Chốt design token: màu sắc, typography, spacing, radius, shadow, breakpoint, z-index, state.
3. Định nghĩa bộ component nền tảng dùng chung cho frontend.
4. Định nghĩa component theo nghiệp vụ MVP: AUTH, HOME, DASH, HR, ATT, LEAVE, TASK, NOTI, SYSTEM.
5. Đảm bảo Home Portal, Module Workspace và App Switcher có cùng ngôn ngữ thiết kế.
6. Đảm bảo table, form, modal, drawer, state, permission UI và dashboard widget nhất quán.
7. Giúp UI/UX Designer thiết kế high-fidelity nhanh hơn.
8. Giúp Frontend xây component reusable thay vì code rời rạc từng màn hình.
9. Giúp QA có tiêu chuẩn kiểm thử UI state, responsive, accessibility và permission behavior.
10. Làm nền tảng cho các tài liệu sau: UI-06 Home Portal & App Switcher, UI-07 Module Workspace Template, UI-08 Dashboard UI, UI-09 Module UI Design.

---

## 3. Căn cứ thiết kế

UI-05 bám theo các quyết định đã chốt trong bộ UI trước:

1. Sau khi đăng nhập, người dùng vào **Home Portal** trước.
2. Từ Home Portal, người dùng chọn app/module để vào **Module Workspace**.
3. Trong mọi màn hình protected, người dùng có thể bấm nút **Ứng dụng** để mở **App Switcher**.
4. Module Workspace có sidebar riêng theo từng module.
5. Topbar dùng chung toàn hệ thống.
6. App, menu, route, button, quick action, badge, widget phải hiển thị theo permission và data scope.
7. Frontend chỉ ẩn/hiện thành phần giao diện để cải thiện UX; backend vẫn là lớp kiểm tra quyền cuối cùng.
8. Dashboard, Home Portal và App Switcher chỉ tổng hợp/điều hướng, không xử lý nghiệp vụ gốc.
9. Notification deep link và dashboard quick action phải điều hướng về module gốc để module đó kiểm tra quyền và business rule.
10. Các màn hình P0/P1 đã được UI-04 liệt kê phải dùng component trong UI-05 làm nền.

---

## 4. Phạm vi Design System MVP

### 4.1 Bao gồm trong UI-05

| Nhóm | Nội dung |
| --- | --- |
| Foundation | Color, typography, spacing, radius, shadow, border, breakpoint, motion, z-index |
| Layout | AuthLayout, HomePortalLayout, ModuleWorkspaceLayout, Topbar, Sidebar, AppSwitcher |
| Navigation | Breadcrumb, Tabs, Menu, AppCard, SidebarItem, AvatarMenu, CategoryChip |
| Form | Input, PasswordInput, Select, Combobox, DatePicker, DateRangePicker, TimePicker, Textarea, Upload, Switch, Checkbox, Radio |
| Data display | DataTable, Card, Badge, Avatar, Tag, Tooltip, Timeline, ActivityLog, DetailSection |
| Feedback | Toast, Alert, Modal, ConfirmDialog, Drawer, Skeleton, Spinner, EmptyState, ErrorState |
| Permission | ForbiddenPage, LockedApp, DisabledActionTooltip, MaskedField, PermissionGate |
| Dashboard | MetricCard, WidgetCard, QuickActionCard, ListWidget, ChartPlaceholder |
| Workflow | ApprovalBox, StatusStepper, CommentThread, Checklist, AssigneePicker |
| Notification | NotificationBadge, NotificationDropdown, NotificationListItem, NotificationTargetLink |
| Domain components | AttendanceStatusCard, CheckInOutButton, LeaveBalanceCard, LeaveRequestForm, TaskCard, KanbanColumn, EmployeeProfileHeader |
| Handoff | Component naming, Figma variant, frontend naming, accessibility, responsive checklist |

### 4.2 Không bao gồm sâu trong UI-05

| Nội dung | Tài liệu xử lý sau |
| --- | --- |
| High-fidelity chi tiết Home Portal | UI-06 |
| High-fidelity chi tiết App Switcher | UI-06 |
| Template từng module workspace | UI-07 |
| Dashboard theo từng role | UI-08 |
| Thiết kế chi tiết từng màn AUTH/HR/ATT/LEAVE/TASK/NOTI | UI-09 |
| Prototype, interaction annotation, handoff cuối cùng | UI-10 |

---

## 5. Nguyên tắc thiết kế tổng thể

### 5.1 Phong cách sản phẩm

Phong cách thiết kế được chốt theo hướng:

```text
Enterprise SaaS hiện đại
Sạch, rõ ràng, chuyên nghiệp
Thân thiện với dữ liệu lớn
Có cảm giác nền tảng nhiều ứng dụng nội bộ
Dễ dùng cho Employee, Manager, HR và Admin
```

### 5.2 Nguyên tắc thị giác

1. **Rõ ràng hơn trang trí**: màn nghiệp vụ ưu tiên đọc dữ liệu, thao tác nhanh, trạng thái rõ.
2. **Home Portal có thể giàu hình ảnh hơn**: cho phép background, app grid, icon lớn, nhưng vẫn phải đảm bảo contrast.
3. **Module Workspace thực dụng hơn**: bảng, form, filter, drawer, detail phải dễ quét bằng mắt.
4. **Không lạm dụng màu**: màu chính dùng cho hành động chính, màu semantic dùng cho trạng thái.
5. **Permission phải rõ nhưng không gây rối**: không có quyền thì ẩn; có quyền xem nhưng không thao tác được thì disable kèm lý do.
6. **Data scope phải biểu hiện tự nhiên**: Own/Team/Company ảnh hưởng dữ liệu, badge, filter, dashboard widget.
7. **State là thành phần bắt buộc**: loading, empty, error, forbidden, disabled, validation, success đều phải có thiết kế thống nhất.
8. **Component trước, screen sau**: mọi màn P0/P1 nên được dựng từ component chuẩn.

### 5.3 Nguyên tắc UX theo vai trò

| Vai trò | Trọng tâm UI | Ưu tiên component |
| --- | --- | --- |
| Employee | Chấm công, xin nghỉ, task, thông báo, hồ sơ cá nhân | Quick action, status card, form đơn giản, notification |
| Manager | Duyệt, theo dõi team, task team, lịch nghỉ | ApprovalBox, DataTable, Team filter, Badge, Drawer |
| HR | Danh sách nhân sự, bảng công, nghỉ phép, hợp đồng | DataTable nâng cao, filter, detail section, export, audit |
| Admin | User, role, permission, settings, audit | Config form, permission matrix, audit table, system state |
| Super Admin | Tenant, module, system setting | System dashboard, tenant switcher, module status |

---

## 6. Design token architecture

### 6.1 Nguyên tắc token

Design token là lớp biến thiết kế dùng chung giữa UI design và frontend.

Token cần đảm bảo:

1. Có tên rõ nghĩa.
2. Không hard-code màu/radius/spacing trực tiếp trong component.
3. Có phân lớp: primitive token, semantic token, component token.
4. Có thể đổi theme sau này mà không sửa toàn bộ component.
5. Có thể map sang CSS variables, Tailwind config hoặc theme object của frontend.

### 6.2 Cấu trúc token đề xuất

```text
primitive
  color.blue.500
  color.gray.900
  spacing.4
  radius.lg

semantic
  color.bg.canvas
  color.text.primary
  color.border.default
  color.action.primary
  color.status.success

component
  button.primary.bg
  table.header.bg
  sidebar.item.active.bg
  appCard.hover.shadow
```

### 6.3 Quy ước đặt tên CSS variable

```css
--color-bg-canvas
--color-bg-surface
--color-text-primary
--color-text-secondary
--color-border-default
--color-action-primary
--radius-md
--shadow-card
--spacing-4
```

### 6.4 Quy ước scale token

| Nhóm | Scale |
| --- | --- |
| Color | 50, 100, 200, 300, 400, 500, 600, 700, 800, 900 |
| Spacing | 0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24 |
| Radius | none, xs, sm, md, lg, xl, 2xl, full |
| Shadow | none, xs, sm, md, lg, xl, overlay |
| Font size | xs, sm, base, md, lg, xl, 2xl, 3xl |
| Z-index | base, sticky, header, dropdown, overlay, modal, toast |

---

## 7. Color system

### 7.1 Color philosophy

Hệ thống cần dùng màu theo 4 lớp:

1. **Neutral**: nền, chữ, border, divider, table.
2. **Brand/Primary**: CTA chính, active navigation, focus ring.
3. **Semantic**: success, warning, danger, info.
4. **Module accent**: màu nhận diện module trên Home Portal, App Switcher, icon, badge nhẹ.

### 7.2 Primitive neutral palette

| Token | Hex | Dùng cho |
| --- | --- | --- |
| `gray.50` | `#F8FAFC` | Nền rất nhẹ |
| `gray.100` | `#F1F5F9` | Surface phụ, table row hover |
| `gray.200` | `#E2E8F0` | Border nhẹ |
| `gray.300` | `#CBD5E1` | Border input |
| `gray.400` | `#94A3B8` | Placeholder, disabled text |
| `gray.500` | `#64748B` | Text phụ |
| `gray.600` | `#475569` | Text secondary mạnh |
| `gray.700` | `#334155` | Heading phụ |
| `gray.800` | `#1E293B` | Text chính dark |
| `gray.900` | `#0F172A` | Heading chính |

### 7.3 Brand palette

| Token | Hex | Dùng cho |
| --- | --- | --- |
| `brand.50` | `#EEF6FF` | Background active nhẹ |
| `brand.100` | `#D9ECFF` | Badge/info nhẹ |
| `brand.200` | `#B9DCFF` | Border active nhẹ |
| `brand.300` | `#8BC5FF` | Focus/hover nhẹ |
| `brand.400` | `#58A8F7` | Icon active |
| `brand.500` | `#2F80ED` | Primary action |
| `brand.600` | `#1F6FD1` | Primary hover |
| `brand.700` | `#1759A8` | Primary pressed |
| `brand.800` | `#164A86` | Dark primary |
| `brand.900` | `#143D6B` | Strong dark |

### 7.4 Semantic palette

| Semantic | Light BG | Main | Dark | Dùng cho |
| --- | --- | --- | --- | --- |
| Success | `#ECFDF5` | `#10B981` | `#047857` | Approved, active, completed, check-in success |
| Warning | `#FFFBEB` | `#F59E0B` | `#B45309` | Pending, late, due soon, warning business rule |
| Danger | `#FEF2F2` | `#EF4444` | `#B91C1C` | Rejected, error, deleted, absent, overdue |
| Info | `#EFF6FF` | `#3B82F6` | `#1D4ED8` | New info, system notice, neutral notification |
| Neutral | `#F8FAFC` | `#64748B` | `#334155` | Draft, archived, disabled, unknown |

### 7.5 Semantic token mapping

| Token | Light value | Dark mode value đề xuất | Dùng cho |
| --- | --- | --- | --- |
| `color.bg.canvas` | `gray.50` | `gray.950` | Nền app |
| `color.bg.surface` | `#FFFFFF` | `gray.900` | Card, panel |
| `color.bg.subtle` | `gray.100` | `gray.800` | Section, table header |
| `color.text.primary` | `gray.900` | `gray.50` | Text chính |
| `color.text.secondary` | `gray.600` | `gray.300` | Text phụ |
| `color.text.muted` | `gray.500` | `gray.400` | Placeholder/meta |
| `color.border.default` | `gray.200` | `gray.700` | Border chung |
| `color.border.strong` | `gray.300` | `gray.600` | Border input |
| `color.action.primary` | `brand.500` | `brand.400` | Button primary |
| `color.action.primaryHover` | `brand.600` | `brand.300` | Hover primary |
| `color.focus.ring` | `brand.300` | `brand.400` | Focus visible |

### 7.6 Module accent color

| Module | Token | Main | Light BG | Dùng cho |
| --- | --- | --- | --- | --- |
| DASH | `module.dash` | `#6366F1` | `#EEF2FF` | Dashboard icon, widget accent |
| HR | `module.hr` | `#2563EB` | `#EFF6FF` | Nhân sự, employee, org |
| ATT | `module.att` | `#F97316` | `#FFF7ED` | Chấm công, check-in/out |
| LEAVE | `module.leave` | `#14B8A6` | `#F0FDFA` | Nghỉ phép, calendar |
| TASK | `module.task` | `#7C3AED` | `#F5F3FF` | Task, project, kanban |
| NOTI | `module.noti` | `#4F46E5` | `#EEF2FF` | Notification |
| AUTH | `module.auth` | `#475569` | `#F8FAFC` | Account, role, permission |
| SYSTEM | `module.system` | `#0F172A` | `#F1F5F9` | Settings, audit, foundation |

### 7.7 Quy tắc dùng màu

| Trường hợp | Quy tắc |
| --- | --- |
| CTA chính trên màn hình | Dùng brand primary, mỗi view chỉ nên có 1 CTA chính nổi bật |
| Action nguy hiểm | Dùng danger, luôn có confirm dialog nếu thay đổi dữ liệu quan trọng |
| Badge trạng thái | Dùng semantic color, không dùng module color nếu là trạng thái nghiệp vụ |
| Icon module | Dùng module accent |
| Sidebar active | Dùng brand hoặc module accent nhẹ, nhưng phải nhất quán toàn hệ thống |
| Table row selected | Dùng brand.50 hoặc module light BG với border rõ |
| Disabled | Không dùng opacity quá thấp; text vẫn phải đọc được |

---

## 8. Typography system

### 8.1 Font family

| Token | Font stack | Dùng cho |
| --- | --- | --- |
| `font.sans` | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | Toàn bộ UI |
| `font.mono` | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` | Code, ID, log, technical value |

Ghi chú: Nếu không license Inter hoặc không muốn tải font ngoài, dùng system font stack là đủ cho MVP.

### 8.2 Font size scale

| Token | Size | Line height | Dùng cho |
| --- | ---: | ---: | --- |
| `text.xs` | 12px | 16px | Label phụ, table meta, caption |
| `text.sm` | 14px | 20px | Body nhỏ, table cell, form helper |
| `text.base` | 16px | 24px | Body chính, input value |
| `text.md` | 18px | 28px | Section heading nhỏ |
| `text.lg` | 20px | 30px | Card title, widget title lớn |
| `text.xl` | 24px | 32px | Page title |
| `text.2xl` | 30px | 38px | Home Portal heading |
| `text.3xl` | 36px | 44px | Hero title nếu cần |

### 8.3 Font weight

| Token | Weight | Dùng cho |
| --- | ---: | --- |
| `font.regular` | 400 | Body text |
| `font.medium` | 500 | Label, button, menu |
| `font.semibold` | 600 | Card title, table header, section heading |
| `font.bold` | 700 | Page title, metric value |

### 8.4 Text style semantic

| Style | Size | Weight | Dùng cho |
| --- | --- | --- | --- |
| `display.title` | 30-36px | 700 | Home Portal title, empty major title |
| `page.title` | 24px | 700 | Tiêu đề trang trong Module Workspace |
| `section.title` | 18-20px | 600 | Tiêu đề section/card |
| `body.default` | 14-16px | 400 | Nội dung chính |
| `body.strong` | 14-16px | 600 | Text nhấn mạnh |
| `caption` | 12px | 400/500 | Helper, meta, time, status note |
| `button.label` | 14px | 600 | Button text |
| `table.header` | 12-14px | 600 | Header bảng |
| `table.cell` | 14px | 400 | Cell bảng |

### 8.5 Quy tắc typography

1. Không dùng quá 4 cấp heading trong một screen.
2. Bảng dữ liệu ưu tiên `text.sm` để hiển thị được nhiều thông tin.
3. Form label dùng `text.sm` + `font.medium`.
4. Error/helper text dùng `text.xs` hoặc `text.sm` tùy mật độ.
5. Metric number trên dashboard có thể dùng `text.2xl` hoặc `text.3xl` nhưng phải có label rõ.

---

## 9. Spacing, layout grid và sizing

### 9.1 Spacing scale

| Token | Value | Dùng cho |
| --- | ---: | --- |
| `space.0` | 0px | Reset |
| `space.1` | 4px | Gap nhỏ, icon-text |
| `space.2` | 8px | Form helper, badge gap |
| `space.3` | 12px | Button padding nhỏ |
| `space.4` | 16px | Card padding compact, form gap |
| `space.5` | 20px | Section gap |
| `space.6` | 24px | Card padding default, page header gap |
| `space.8` | 32px | Section lớn |
| `space.10` | 40px | Page block spacing |
| `space.12` | 48px | Layout major |
| `space.16` | 64px | Hero/Home Portal spacing |

### 9.2 Page spacing

| Khu vực | Desktop | Tablet | Mobile |
| --- | ---: | ---: | ---: |
| Page content padding | 24px | 20px | 16px |
| Card padding | 20-24px | 16-20px | 16px |
| Form field gap | 16px | 16px | 12px |
| Section gap | 24-32px | 24px | 20px |
| Table cell padding | 12px 16px | 10px 12px | Card list thay table |

### 9.3 Layout width

| Layout | Max width / behavior |
| --- | --- |
| Auth form | 400-480px |
| Home Portal content | Full width, nội dung chính nên nằm trong max 1280-1440px |
| Module Workspace | Full width, content fluid |
| Form page | 720-960px nếu form đơn; 2-column nếu nhiều field |
| Detail page | 960-1200px, có thể có side panel |
| Modal small | 400-480px |
| Modal medium | 560-720px |
| Modal large | 880-1040px |
| Drawer | 420-720px tùy nội dung |

### 9.4 Breakpoint

| Token | Width | Thiết bị | Cách xử lý |
| --- | ---: | --- | --- |
| `bp.mobile` | `<768px` | Mobile web | Card list, full-screen form, drawer/fullscreen overlay |
| `bp.tablet` | `768-1023px` | Tablet | Sidebar collapsed/drawer, table scroll |
| `bp.laptop` | `1024-1199px` | Laptop | Sidebar collapsible, filter gọn |
| `bp.desktop` | `>=1200px` | Desktop | Sidebar fixed, table đầy đủ |
| `bp.wide` | `>=1440px` | Wide desktop | Tăng content density có kiểm soát |

---

## 10. Radius, border, shadow, elevation

### 10.1 Radius

| Token | Value | Dùng cho |
| --- | ---: | --- |
| `radius.none` | 0px | Table internal, divider |
| `radius.xs` | 4px | Small badge, tag |
| `radius.sm` | 6px | Input compact, small button |
| `radius.md` | 8px | Button, input default |
| `radius.lg` | 12px | Card, modal inner |
| `radius.xl` | 16px | App card, widget card |
| `radius.2xl` | 24px | Home Portal hero/app surface |
| `radius.full` | 999px | Avatar, pill, chip |

### 10.2 Border

| Token | Value | Dùng cho |
| --- | --- | --- |
| `border.default` | 1px solid `color.border.default` | Card, table, input |
| `border.strong` | 1px solid `color.border.strong` | Focusable container, selected row |
| `border.dashed` | 1px dashed `color.border.default` | Upload/dropzone, empty placeholder |
| `border.focus` | 2px solid `color.focus.ring` | Focus visible |

### 10.3 Shadow

| Token | Value gợi ý | Dùng cho |
| --- | --- | --- |
| `shadow.none` | none | Flat table, simple layout |
| `shadow.xs` | 0 1px 2px rgba(15, 23, 42, 0.04) | Input/card subtle |
| `shadow.sm` | 0 1px 3px rgba(15, 23, 42, 0.08) | Card default |
| `shadow.md` | 0 4px 12px rgba(15, 23, 42, 0.10) | Dropdown, popover |
| `shadow.lg` | 0 12px 32px rgba(15, 23, 42, 0.16) | Modal, drawer |
| `shadow.overlay` | 0 24px 64px rgba(15, 23, 42, 0.24) | App Switcher overlay |

### 10.4 Elevation rule

| Layer | Component |
| --- | --- |
| Level 0 | Page canvas, section background |
| Level 1 | Card, widget, table container |
| Level 2 | Dropdown, tooltip, popover |
| Level 3 | Drawer, App Switcher |
| Level 4 | Modal, confirm dialog |
| Level 5 | Toast, critical alert |

---

## 11. Motion, transition và interaction

### 11.1 Motion token

| Token | Duration | Dùng cho |
| --- | ---: | --- |
| `motion.fast` | 120ms | Hover, active, small feedback |
| `motion.normal` | 180ms | Dropdown, sidebar collapse, tab switch |
| `motion.slow` | 240ms | Modal, drawer, app switcher |
| `motion.feedback` | 300ms | Toast enter/exit, success animation nhẹ |

### 11.2 Easing

| Token | Value | Dùng cho |
| --- | --- | --- |
| `ease.standard` | cubic-bezier(0.2, 0, 0, 1) | Hầu hết transition |
| `ease.enter` | cubic-bezier(0, 0, 0.2, 1) | Element xuất hiện |
| `ease.exit` | cubic-bezier(0.4, 0, 1, 1) | Element biến mất |

### 11.3 Quy tắc motion

1. Motion phải nhanh, không làm chậm thao tác nghiệp vụ.
2. App Switcher, drawer, modal có animation mượt nhưng không quá 240ms.
3. Loading skeleton không nên nhấp nháy quá mạnh.
4. Tôn trọng `prefers-reduced-motion`.
5. Không dùng animation trang trí trong màn nhiều dữ liệu nếu gây phân tâm.

---

## 12. Icon, illustration và visual asset

### 12.1 Icon style

| Thuộc tính | Quy chuẩn |
| --- | --- |
| Style | Line icon hoặc duotone nhẹ, không trộn quá nhiều style |
| Stroke | 1.5px - 2px |
| Size default | 20px |
| Size small | 16px |
| Size app icon | 40-56px |
| Corner | Rounded nhẹ, thân thiện |
| Color | Dùng semantic/module token, không hard-code |

### 12.2 Module icon rule

| Module | Icon gợi ý | Accent |
| --- | --- | --- |
| DASH | Gauge / chart / grid | `module.dash` |
| HR | User group / ID card | `module.hr` |
| ATT | Clock / check circle | `module.att` |
| LEAVE | Calendar / palm / document check | `module.leave` |
| TASK | Kanban / checklist | `module.task` |
| NOTI | Bell | `module.noti` |
| AUTH | Shield / key / user cog | `module.auth` |
| SYSTEM | Settings / database / server | `module.system` |

### 12.3 Illustration rule

| Trường hợp | Quy tắc |
| --- | --- |
| Empty state lớn | Có thể dùng illustration đơn giản, màu nhẹ |
| Error/Forbidden | Icon minh họa rõ, không gây sợ hãi |
| Home Portal | Có thể dùng background/gradient/abstract shape |
| Module Workspace | Hạn chế illustration lớn để tiết kiệm không gian |

---

## 13. Accessibility guideline

### 13.1 Tiêu chuẩn tối thiểu

UI MVP cần hướng tới WCAG 2.1 AA ở các điểm chính:

1. Text thường đạt contrast tối thiểu 4.5:1.
2. Text lớn đạt contrast tối thiểu 3:1.
3. Focus state phải nhìn rõ bằng bàn phím.
4. Mọi action icon-only phải có tooltip/aria-label.
5. Form error phải đọc được bằng screen reader.
6. Modal/drawer phải trap focus.
7. Toast quan trọng phải có aria-live phù hợp.
8. Không truyền đạt trạng thái chỉ bằng màu; cần có text/icon.

### 13.2 Keyboard interaction

| Component | Keyboard behavior |
| --- | --- |
| Button | Enter/Space activate |
| Input | Tab focus, Escape clear optional |
| Select/Combobox | Arrow navigate, Enter select, Escape close |
| Modal | Escape close nếu không phải critical confirm; focus trap |
| Drawer | Escape close nếu cho phép; focus trap |
| Tabs | Arrow navigate hoặc Tab theo implementation |
| App Switcher | Search autofocus, Arrow navigate optional, Escape close |
| DataTable | Tab qua interactive cells, không bắt buộc keyboard grid trong MVP |

### 13.3 Focus token

```css
--focus-ring-color: #8BC5FF;
--focus-ring-width: 2px;
--focus-ring-offset: 2px;
```

---

## 14. Layout components

## 14.1 AuthLayout

### Mục đích

Dùng cho public/auth screens như login, forgot password, reset password.

### Anatomy

```text
AuthLayout
├── Brand area
├── Auth card
│   ├── Title
│   ├── Description
│   ├── Form fields
│   ├── Submit button
│   ├── Secondary links
│   └── Error/locked/company inactive message
└── Footer optional
```

### Component spec

| Thuộc tính | Quy chuẩn |
| --- | --- |
| Max width form | 400-480px |
| Card padding | 24-32px |
| Background | Neutral/gradient nhẹ |
| Error | Không tiết lộ email tồn tại hay không |
| Loading | Button loading + disable form |
| Responsive | Mobile full width, padding 16px |

### State

| State | UI behavior |
| --- | --- |
| Default | Form sẵn sàng nhập |
| Loading | Button spinner, field disabled |
| Invalid | Field error + alert chung nếu cần |
| Locked | Alert warning/danger, hướng dẫn liên hệ admin |
| Company inactive | Alert danger, không cho login |

---

## 14.2 HomePortalLayout

### Mục đích

Dùng cho `/home`, là cổng vào tổng sau khi đăng nhập.

### Anatomy

```text
HomePortalLayout
├── Global header
│   ├── Logo / product name
│   ├── Search app
│   ├── App Switcher button
│   ├── Notification badge
│   └── Avatar menu
├── Hero / welcome area optional
├── Category chips
├── App grid
├── Recent/Favorite section optional
└── Empty/locked/coming soon state
```

### Component spec

| Thành phần | Quy chuẩn |
| --- | --- |
| Header height | 64px |
| App grid min card | 120x120px desktop, 96x96px mobile |
| Card radius | `radius.xl` hoặc `radius.2xl` |
| Background | Gradient/brand visual có overlay đảm bảo contrast |
| Search | Tìm theo tên app, code, alias tiếng Việt/Anh |
| Category | Recent, Favorite, My Apps, All Apps, group theo nghiệp vụ |

### App grid rule

| Trường hợp | UI behavior |
| --- | --- |
| App có quyền | Hiển thị bình thường |
| App không có quyền | Ẩn khỏi My Apps |
| App phase sau | Ẩn mặc định hoặc Coming soon theo company setting |
| App bị disabled | Mờ + badge `Chưa kích hoạt` nếu policy cho phép lộ |
| Không có app | Empty state liên hệ admin |

---

## 14.3 ModuleWorkspaceLayout

### Mục đích

Dùng cho tất cả màn hình nghiệp vụ chi tiết.

### Anatomy

```text
ModuleWorkspaceLayout
├── Global Topbar
├── Module Sidebar
└── Main content
    ├── PageHeader
    ├── FilterBar / Tabs optional
    ├── Content area
    └── Drawer/Modal optional
```

### Component spec

| Thành phần | Quy chuẩn |
| --- | --- |
| Topbar height | 56-64px |
| Sidebar width expanded | 240-280px |
| Sidebar collapsed | 64-72px |
| Main padding desktop | 24px |
| Main padding mobile | 16px |
| Content bg | `color.bg.canvas` |
| Card/table bg | `color.bg.surface` |

### State

| State | UI behavior |
| --- | --- |
| Loading route | Page skeleton, giữ topbar/sidebar |
| Forbidden route | ForbiddenPage trong content area |
| Empty due to scope | EmptyState có nói rõ phạm vi dữ liệu |
| Module disabled | ModuleDisabledState |
| API error | ErrorState + retry |

---

## 14.4 GlobalTopbar

### Mục đích

Topbar dùng chung cho mọi màn hình protected.

### Anatomy

```text
GlobalTopbar
├── Logo/Home
├── Current App Name
├── Global/Module Search optional
├── App Switcher Button
├── Quick Action optional
├── Notification Badge
├── Help optional
└── Avatar Menu
```

### Component spec

| Thành phần | Bắt buộc MVP | Rule |
| --- | --- | --- |
| Logo/Home | Có | Click về `/home` |
| Current app name | Có | Hiển thị trong module workspace |
| Search | Có thể tối giản | Search trong module hoặc app |
| App Switcher | Có | Authenticated |
| Quick Action | Có thể có | Theo permission action |
| Notification badge | Có | Chỉ hiện nếu có `NOTI.NOTIFICATION.VIEW_OWN` |
| Avatar menu | Có | Profile, đổi mật khẩu, logout |

### Quick action examples

| Role/Module | Quick action |
| --- | --- |
| Employee | Check-in/out, Tạo đơn nghỉ, Tạo task |
| Manager | Duyệt đơn nghỉ, Xem task team |
| HR | Thêm nhân viên, Xem yêu cầu cần xử lý |
| Admin | Tạo user, Cấu hình role |

---

## 14.5 ModuleSidebar

### Mục đích

Điều hướng trong từng module.

### Anatomy

```text
ModuleSidebar
├── Module header
├── Menu group
│   ├── SidebarItem
│   └── SidebarItem with children
├── Spacer
└── Collapse button
```

### Component spec

| Thuộc tính | Quy chuẩn |
| --- | --- |
| Expanded width | 240-280px |
| Collapsed width | 64-72px |
| Active item | Icon + text + active background |
| Tooltip | Bắt buộc khi collapsed |
| Menu depth | Tối đa 2 cấp trong MVP |
| Visibility | Theo permission, không hard-code role |

### Sidebar item state

| State | UI behavior |
| --- | --- |
| Default | Text + icon neutral |
| Hover | Background subtle |
| Active | Background brand/module light, text active |
| Disabled | Chỉ dùng khi có quyền xem nhưng feature bị tắt; có tooltip |
| Hidden | Không có permission thì ẩn |
| Counter | Badge nhỏ cho pending/unread nếu có quyền |

---

## 14.6 AppSwitcher

### Mục đích

Overlay chuyển ứng dụng từ mọi màn hình protected.

### Anatomy

```text
AppSwitcher
├── Header
│   ├── Close button
│   └── Search app input
├── Home link
├── Recent apps
├── Favorite apps
├── My apps
├── Other apps / Coming soon
└── Empty state
```

### Component spec

| Thuộc tính | Desktop | Tablet/Mobile |
| --- | --- | --- |
| Presentation | Modal lớn hoặc side drawer | Fullscreen overlay |
| Width | 720-960px | 100vw |
| Search | Autofocus | Autofocus |
| Dirty form | Confirm trước khi chuyển app | Confirm trước khi chuyển app |
| Escape | Đóng overlay | Đóng overlay |

### App item state

| State | UI behavior |
| --- | --- |
| Available | Click mở app |
| Active app | Highlight nhẹ |
| Recent | Hiển thị trong nhóm Gần đây |
| Favorite | Có pin/star marker |
| Locked | Mờ + tooltip/lý do nếu policy cho phép |
| Coming soon | Badge `Sắp ra mắt`, không click hoặc click xem giới thiệu |
| No result | Empty state `Không tìm thấy ứng dụng phù hợp` |

---

## 15. Navigation components

### 15.1 Breadcrumb

| Thuộc tính | Quy chuẩn |
| --- | --- |
| Dùng cho | Detail, edit, nested screen |
| Không dùng quá | 4-5 cấp hiển thị |
| Separator | `/` hoặc chevron |
| Home link | Có thể là `/home` hoặc module root |
| Truncate | Tên entity dài cần truncate |

Ví dụ:

```text
Home / Nhân sự / Nhân viên / Nguyễn Văn A
```

### 15.2 Tabs

| Variant | Dùng cho |
| --- | --- |
| Line tabs | Detail page, settings section |
| Pill tabs | Filter trạng thái nhẹ |
| Vertical tabs | Settings nhiều nhóm, optional |

State:

| State | UI behavior |
| --- | --- |
| Active | Border/underline brand, text strong |
| Hover | Text primary, bg subtle |
| Disabled | Text muted + tooltip nếu cần |
| Badge | Có thể hiển thị counter: Pending, Unread |

### 15.3 CategoryChip

Dùng trong Home Portal/App Switcher để lọc nhóm app.

| State | UI behavior |
| --- | --- |
| Default | Border neutral, bg surface |
| Selected | Bg brand light, text brand dark |
| Disabled | Không click, text muted |

### 15.4 AvatarMenu

| Item | Route/Action | Rule |
| --- | --- | --- |
| Hồ sơ tài khoản | `/account/profile` | Authenticated |
| Hồ sơ nhân viên của tôi | `/hr/me` | Có `HR.EMPLOYEE.VIEW_OWN` |
| Đổi mật khẩu | `/account/change-password` | Có `AUTH.PASSWORD.CHANGE` |
| Phiên đăng nhập | `/account/sessions` | Có `AUTH.PROFILE.VIEW` |
| Cài đặt | `/system/settings` hoặc user settings | Nếu có quyền |
| Đăng xuất | Action | Authenticated |

---

## 16. Button system

### 16.1 Button variants

| Variant | Dùng cho | Visual |
| --- | --- | --- |
| Primary | Action chính: Lưu, Gửi đơn, Check-in | Brand bg, white text |
| Secondary | Action phụ: Hủy, Quay lại | Surface bg, border |
| Tertiary/Ghost | Action nhẹ trong toolbar | Transparent, hover bg |
| Danger | Xóa, hủy, từ chối nguy hiểm | Danger bg hoặc danger text |
| Success | Approve/check-in success action nếu cần | Success bg |
| Link | Text action nhẹ | Brand text |
| Icon | Topbar/sidebar/table action | Icon-only + tooltip |

### 16.2 Button sizes

| Size | Height | Padding | Dùng cho |
| --- | ---: | --- | --- |
| xs | 28px | 8px 10px | Table action nhỏ |
| sm | 32px | 10px 12px | Filter/action compact |
| md | 40px | 14px 16px | Default |
| lg | 48px | 18px 20px | Login/hero/main CTA |

### 16.3 Button state

| State | UI behavior |
| --- | --- |
| Default | Có contrast rõ |
| Hover | Tối/sáng nhẹ theo variant |
| Active | Pressed state |
| Focus | Focus ring rõ |
| Loading | Spinner + disabled interaction |
| Disabled | Không click, text muted, tooltip nếu do business rule |
| Permission hidden | Không render nếu không có permission |

### 16.4 Button naming

```text
Button/Primary/md/Default
Button/Primary/md/Hover
Button/Primary/md/Loading
Button/Danger/md/Default
Button/Icon/sm/Default
```

---

## 17. Form component system

### 17.1 Form principles

1. Form phải chia section rõ nếu nhiều field.
2. Field bắt buộc có label.
3. Required field dùng dấu `*` hoặc text helper, không chỉ dùng màu.
4. Error message đặt ngay dưới field.
5. Validation server phải map đúng vào field nếu có thể.
6. Form nhiều thay đổi quan trọng cần dirty form guard khi rời route/app.
7. Submit loading phải disable action để tránh duplicate request.
8. Form có dữ liệu nhạy cảm phải hỗ trợ masked field.

### 17.2 Input

| Thuộc tính | Quy chuẩn |
| --- | --- |
| Height | 40px default |
| Radius | `radius.md` |
| Label | Trên input |
| Placeholder | Không thay thế label |
| Helper | Dưới input, text muted |
| Error | Border danger + message |
| Disabled | Bg subtle + text muted |
| Readonly | Bg subtle, vẫn copy được |

### 17.3 Select / Combobox

| Component | Dùng cho |
| --- | --- |
| Select | Danh sách ngắn, option cố định |
| Combobox | Danh sách dài: employee, department, project |
| MultiSelect | Role, permission, assignee, watcher |
| AsyncCombobox | Employee/project search lớn |

State bắt buộc: loading options, empty options, disabled, error, selected, clearable.

### 17.4 DatePicker / DateRangePicker / TimePicker

| Component | Dùng cho |
| --- | --- |
| DatePicker | Ngày sinh, ngày vào làm, ngày nghỉ đơn |
| DateRangePicker | Kỳ nghỉ, filter bảng công, report |
| TimePicker | Giờ check-in/out, nghỉ theo giờ, ca làm |
| MonthPicker | Bảng công tháng, leave balance year/month |

Quy tắc:

1. Hiển thị format Việt Nam: `DD/MM/YYYY`.
2. API vẫn dùng ISO date/time.
3. DateRange phải hiển thị số ngày được chọn nếu nghiệp vụ cần.
4. Ngày bị disabled phải có tooltip/lý do nếu có rule.

### 17.5 Textarea

Dùng cho lý do nghỉ, lý do từ chối, ghi chú task, comment dài.

| Thuộc tính | Quy chuẩn |
| --- | --- |
| Min rows | 3 |
| Max rows | 8-12 trước khi scroll |
| Counter | Dùng nếu có giới hạn ký tự |
| Autosize | Khuyến nghị |

### 17.6 Upload / FileDropzone

| State | UI behavior |
| --- | --- |
| Default | Dropzone dashed border, icon upload |
| Drag over | Border brand |
| Uploading | Progress bar |
| Success | File row + status |
| Error | File row danger + retry/remove |
| Forbidden | Ẩn nếu không có quyền upload |

Thông tin file row:

```text
Icon loại file | Tên file | Size | Uploaded by | Time | Download/View/Delete action
```

### 17.7 Switch / Checkbox / Radio

| Component | Dùng cho |
| --- | --- |
| Switch | Bật/tắt cấu hình, active/inactive |
| Checkbox | Chọn nhiều item, agreement, table selection |
| Radio | Chọn một option trong nhóm nhỏ |

### 17.8 Form layout patterns

| Pattern | Dùng cho |
| --- | --- |
| Single column | Mobile, form đơn giản, modal |
| Two columns | Employee form, settings, contract form |
| Sectioned form | Hồ sơ nhân viên, rule chấm công, leave policy |
| Inline edit | Profile/detail field ít thay đổi |
| Wizard/Stepper | Có thể dùng phase sau cho onboarding/import |

---

## 18. Data display components

## 18.1 DataTable

### Mục đích

Dùng cho danh sách nhân viên, bảng công, đơn nghỉ, task, notification admin, audit log.

### Anatomy

```text
DataTable
├── TableToolbar
│   ├── Search
│   ├── FilterBar
│   ├── Bulk actions
│   └── Export / Column settings
├── Table
│   ├── Header
│   ├── Rows
│   └── Inline actions
├── Empty/Error/Loading state
└── Pagination
```

### Table spec

| Thuộc tính | Quy chuẩn |
| --- | --- |
| Header bg | `color.bg.subtle` |
| Header text | `table.header` |
| Row hover | `gray.50` hoặc `brand.50` nhẹ |
| Row height | 48-56px desktop |
| Cell text | `text.sm` |
| Sticky header | Khuyến nghị cho bảng dài |
| Sticky action column | Optional |
| Horizontal scroll | Bắt buộc khi nhiều cột |
| Mobile | Chuyển sang CardList cho P0 nếu table quá rộng |

### Table state

| State | UI behavior |
| --- | --- |
| Loading | Skeleton rows |
| Empty no data | EmptyState mô tả chưa có dữ liệu |
| Empty after filter | EmptyState có nút clear filter |
| Error | ErrorState + retry |
| Forbidden | ForbiddenState nếu API 403 |
| Partial masked | Một số cell dùng MaskedField |

### Column definition metadata

```ts
interface TableColumnMeta {
  key: string;
  title: string;
  width?: number;
  minWidth?: number;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  filterable?: boolean;
  permission?: string;
  sensitive?: boolean;
  responsivePriority?: 1 | 2 | 3 | 4;
}
```

---

## 18.2 FilterBar

### Anatomy

```text
FilterBar
├── Keyword search
├── Date range
├── Status filter
├── Department/team/user filter
├── More filters dropdown
├── Reset filter
└── Saved view optional
```

### Quy tắc

1. Filter chính hiển thị trực tiếp.
2. Filter phụ đưa vào `More filters`.
3. Filter đã chọn phải hiện chip để user dễ xóa.
4. Filter theo data scope phải chỉ hiển thị option user được phép.
5. Mobile dùng drawer/filter sheet.

---

## 18.3 Pagination

| Loại | Dùng cho |
| --- | --- |
| Offset pagination | Danh sách nghiệp vụ thông thường |
| Cursor/keyset | Notification, audit log, bảng lớn phase sau |
| Infinite scroll | Notification dropdown/list nếu cần |

UI default:

```text
Tổng 126 kết quả | Trang 1 / 7 | [Trước] [1] [2] [3] ... [Sau] | 20 / trang
```

---

## 18.4 Card

| Variant | Dùng cho |
| --- | --- |
| BaseCard | Section, form panel |
| AppCard | Home Portal/App Switcher |
| MetricCard | Dashboard metric |
| QuickActionCard | Dashboard/Home action nhanh |
| TaskCard | Kanban/list task |
| EmployeeCard | Mobile employee list |

Card state: default, hover, selected, disabled, loading, error.

---

## 18.5 Badge / StatusBadge / Tag

### Status badge mapping chung

| Status | Semantic | Label gợi ý |
| --- | --- | --- |
| Draft | Neutral | Nháp |
| Pending | Warning | Chờ xử lý |
| Approved | Success | Đã duyệt |
| Rejected | Danger | Từ chối |
| Cancelled | Neutral | Đã hủy |
| Active | Success | Đang hoạt động |
| Inactive | Neutral | Không hoạt động |
| Locked | Danger/Neutral | Đã khóa |
| Completed | Success | Hoàn thành |
| Overdue | Danger | Quá hạn |
| Due soon | Warning | Sắp đến hạn |

### Badge size

| Size | Height | Dùng cho |
| --- | ---: | --- |
| sm | 20px | Table cell |
| md | 24px | Card/detail |
| lg | 28px | Page header/status block |

---

## 18.6 Avatar

| Type | Dùng cho |
| --- | --- |
| AvatarImage | User có ảnh |
| AvatarInitial | Không có ảnh, dùng chữ cái đầu |
| AvatarGroup | Assignees/watchers/project members |
| AvatarWithMeta | Tên, email, department, position |

Quy tắc:

1. Không hiển thị email/phone nếu user không có quyền xem.
2. AvatarGroup giới hạn 3-5 item rồi hiển thị `+N`.
3. Tooltip/avatar popover có thể hiển thị thông tin ngắn theo permission.

---

## 18.7 DetailSection

Dùng trong employee detail, leave request detail, attendance record detail, task detail.

```text
DetailSection
├── Section title
├── Optional action
├── Description list / field grid
└── Empty or masked field state
```

Variant:

1. 1-column description list.
2. 2-column field grid.
3. Tabbed detail section.
4. Collapsible section.

---

## 18.8 Timeline / ActivityLog

Dùng cho audit, task activity, leave approval history, attendance adjustment history.

| Item field | Mô tả |
| --- | --- |
| Actor | Người thực hiện |
| Action | Hành động |
| Timestamp | Thời điểm |
| Description | Mô tả ngắn |
| Diff optional | Trước/sau nếu có |
| Source | Web/mobile/system/job |

State:

1. Loading.
2. Empty no activity.
3. Collapsed long list.
4. Sensitive diff masked.

---

## 19. Feedback components

## 19.1 Toast

| Type | Dùng cho | Thời gian |
| --- | --- | ---: |
| Success | Lưu thành công, gửi đơn thành công | 3-5s |
| Error | API lỗi, thao tác thất bại | 5-8s hoặc manual dismiss |
| Warning | Business warning | 5-8s |
| Info | Thông tin hệ thống | 3-5s |

Quy tắc:

1. Toast không thay thế validation error dưới field.
2. Toast lỗi nghiêm trọng nên có nút `Xem chi tiết` hoặc `Thử lại` nếu phù hợp.
3. Không spam nhiều toast cùng lúc; group/dedupe nếu cần.

## 19.2 Alert

Dùng trong page/form để hiển thị thông báo cố định.

Variant:

1. Info alert.
2. Success alert.
3. Warning alert.
4. Danger alert.
5. Permission/Scope alert.

Ví dụ:

```text
Bạn đang xem dữ liệu trong phạm vi Team. Một số nhân viên ngoài phạm vi quản lý sẽ không được hiển thị.
```

## 19.3 Modal

| Size | Dùng cho |
| --- | --- |
| Small | Confirm đơn giản |
| Medium | Form ngắn, approve/reject |
| Large | Detail preview, complex form |

Quy tắc:

1. Modal có title rõ.
2. Nút chính đặt bên phải.
3. Danger action cần style danger.
4. Đóng modal khi form dirty phải confirm.
5. Escape/overlay click chỉ đóng nếu không gây mất dữ liệu.

## 19.4 ConfirmDialog

Dùng cho action quan trọng:

| Action | Confirm bắt buộc |
| --- | --- |
| Xóa mềm dữ liệu | Có |
| Hủy đơn nghỉ | Có |
| Từ chối đơn nghỉ | Có, thường cần lý do |
| Điều chỉnh công trực tiếp | Có |
| Khóa user | Có |
| Thay đổi role/permission | Có |
| Đổi app khi form chưa lưu | Có |

## 19.5 Drawer

Dùng cho quick detail, filter mobile, app switcher variant, task detail quick view.

| Drawer | Width |
| --- | ---: |
| Small | 360-420px |
| Medium | 480-640px |
| Large | 720-880px |
| Mobile | 100vw |

## 19.6 Skeleton

| Component | Skeleton |
| --- | --- |
| Table | Header + 5-10 row skeleton |
| Card | Rect title + lines |
| Detail | Section blocks |
| Dashboard | Metric blocks |
| App grid | App card placeholders |

## 19.7 EmptyState

### Anatomy

```text
EmptyState
├── Icon/illustration
├── Title
├── Description
├── Primary action optional
└── Secondary action optional
```

### Empty state types

| Type | Copy gợi ý |
| --- | --- |
| No data | `Chưa có dữ liệu.` |
| No result | `Không tìm thấy kết quả phù hợp.` |
| No permission apps | `Tài khoản của bạn chưa được cấp quyền sử dụng ứng dụng.` |
| No scope data | `Không có dữ liệu trong phạm vi bạn được phép xem.` |
| Coming soon | `Chức năng này sẽ được triển khai ở giai đoạn sau.` |

## 19.8 ErrorState

| Error | UI behavior |
| --- | --- |
| 400 validation | Field error + alert nếu cần |
| 401 | Redirect login hoặc refresh token |
| 403 | ForbiddenPage hoặc inline forbidden |
| 404 | NotFoundState |
| 409 conflict | Alert warning + hướng dẫn reload |
| 422 business rule | Disabled/explanation hoặc alert |
| 500 | ErrorState + retry |
| Network | ErrorState + retry |

---

## 20. Permission components

## 20.1 PermissionGate

Component logic dùng để ẩn/hiện UI theo permission.

```ts
interface PermissionGateProps {
  requiredPermissions?: string[];
  requiredAnyPermissions?: string[];
  requiredScopes?: string[];
  fallback?: ReactNode;
  mode?: 'hide' | 'disable' | 'readonly';
}
```

Quy tắc:

1. Không có quyền xem app/menu/route -> ẩn hoặc 403.
2. Không có quyền action -> ẩn action.
3. Có quyền xem nhưng business rule chặn -> disable + tooltip.
4. Field nhạy cảm thiếu quyền -> dùng MaskedField.

## 20.2 ForbiddenPage

### Anatomy

```text
ForbiddenPage
├── Icon shield/lock
├── Title: Bạn không có quyền truy cập
├── Description: Mô tả ngắn
├── Action: Quay về Home / Quay lại
└── Request access optional phase sau
```

Copy chuẩn:

```text
Bạn không có quyền truy cập nội dung này.
Vui lòng liên hệ quản trị viên nếu bạn cho rằng đây là nhầm lẫn.
```

## 20.3 LockedApp

Dùng cho app chưa kích hoạt hoặc module phase sau.

| State | Copy |
| --- | --- |
| No permission | Ẩn khỏi My Apps, không cần copy |
| Disabled by company | `Ứng dụng này chưa được kích hoạt cho công ty của bạn.` |
| Coming soon | `Ứng dụng này sẽ được triển khai ở giai đoạn sau.` |
| Beta | `Beta` badge, vẫn click nếu có quyền |

## 20.4 DisabledActionTooltip

Dùng khi action hiển thị nhưng không được phép do business rule.

Ví dụ:

| Action | Tooltip |
| --- | --- |
| Check-in khi nghỉ cả ngày | `Bạn đã có đơn nghỉ phép được duyệt trong hôm nay.` |
| Submit leave thiếu balance | `Số ngày phép còn lại không đủ.` |
| Update task đã Done/Cancelled | `Task đã đóng, không thể cập nhật.` |
| Approve request không thuộc team | `Yêu cầu không nằm trong phạm vi quản lý của bạn.` |

## 20.5 MaskedField

Dùng cho dữ liệu nhạy cảm.

| State | UI behavior |
| --- | --- |
| No permission | `••••••` + tooltip `Bạn không có quyền xem trường này` |
| Can reveal | Nút mắt để xem nếu có permission và audit nếu cần |
| Export hidden | Không đưa field vào export nếu thiếu quyền |

---

## 21. Dashboard components

## 21.1 WidgetCard

### Anatomy

```text
WidgetCard
├── Header
│   ├── Title
│   ├── Badge/counter optional
│   └── Action menu optional
├── Body
└── Footer/link optional
```

### State

| State | UI behavior |
| --- | --- |
| Loading | Skeleton widget |
| Empty | Empty widget compact |
| Error | Error widget + retry |
| Forbidden | Widget hidden hoặc forbidden compact theo policy |
| Stale cache | Hiển thị `Đang cập nhật...` nếu cần |

## 21.2 MetricCard

| Field | Mô tả |
| --- | --- |
| Label | Tên chỉ số |
| Value | Số chính |
| Delta | Tăng/giảm optional |
| Icon | Module/semantic icon |
| Drilldown | Link sang module gốc |

Ví dụ:

```text
Đơn nghỉ chờ duyệt | 8 | +2 hôm nay | Xem danh sách
```

## 21.3 QuickActionCard

Dùng cho hành động nhanh nhưng vẫn gọi API module gốc.

| Action | Module gốc |
| --- | --- |
| Check-in/check-out | ATT |
| Tạo đơn nghỉ | LEAVE |
| Tạo task | TASK |
| Duyệt đơn nghỉ | LEAVE |
| Thêm nhân viên | HR |

## 21.4 ChartPlaceholder

MVP có thể dùng chart đơn giản hoặc placeholder.

Quy tắc:

1. Chart phải có title, legend, empty state.
2. Không dùng quá nhiều màu.
3. Màu chart nên lấy từ token.
4. Có fallback table/list nếu chart chưa triển khai.

---

## 22. Workflow components

## 22.1 ApprovalBox

Dùng cho duyệt nghỉ, điều chỉnh công, profile change request.

### Anatomy

```text
ApprovalBox
├── Request summary
├── Requester info
├── Current status
├── Approver history
├── Comment/reason field optional
└── Actions: Approve / Reject / Cancel
```

### State

| State | Action |
| --- | --- |
| Pending | Approve/Reject nếu có quyền |
| Approved | Không cho approve lại, có thể revoke nếu HR/Admin có quyền |
| Rejected | Readonly, hiển thị lý do |
| Cancelled | Readonly |
| Out of scope | Ẩn action, hiển thị scope notice |

## 22.2 StatusStepper

Dùng cho luồng đơn nghỉ, profile change, task status nếu cần.

Ví dụ:

```text
Draft -> Pending -> Approved/Rejected -> Cancelled/Revoked
```

## 22.3 CommentThread

Dùng cho task comment và có thể dùng cho ghi chú duyệt.

| Feature | MVP |
| --- | --- |
| Add comment | Có |
| Edit/delete own comment | Có thể có |
| Mention user | Có nếu TASK hỗ trợ |
| Attachment | Optional |
| Reaction | Phase sau |

## 22.4 Checklist

Dùng trong task detail.

| State | UI behavior |
| --- | --- |
| Default | Checkbox + item text |
| Done | Text muted/line-through nhẹ |
| Editing | Inline input |
| Reorder | Phase sau nếu cần |

## 22.5 AssigneePicker

Dùng cho task/project, có thể dùng trong approval delegation phase sau.

Quy tắc:

1. Search employee theo permission/data scope.
2. Hiển thị avatar, tên, phòng ban, chức vụ.
3. Không cho chọn nhân viên inactive.
4. Cảnh báo nếu nhân viên đang nghỉ phép hoặc không thuộc project/team.

---

## 23. Notification components

## 23.1 NotificationBadge

| State | UI behavior |
| --- | --- |
| 0 unread | Không hiện số hoặc hiện icon neutral |
| 1-99 | Badge số |
| >99 | `99+` |
| Loading | Không nhấp nháy, có thể giữ count cũ |
| Error | Icon neutral, không phá topbar |

## 23.2 NotificationDropdown

### Anatomy

```text
NotificationDropdown
├── Header: Thông báo + mark all read
├── Tabs/filter: Tất cả / Chưa đọc optional
├── List latest notifications
├── Empty state
└── Footer: Xem tất cả
```

### Notification item anatomy

```text
Icon/module
Title
Short message
Time
Unread dot
Target indicator
Action optional
```

### Rule

1. Click notification phải mark read hoặc giữ unread theo policy rồi deep link.
2. Deep link điều hướng sang module gốc.
3. Module gốc vẫn kiểm tra permission/business rule lại.
4. Notification không được lộ dữ liệu nhạy cảm nếu user thiếu quyền.

## 23.3 NotificationListItem

Variant:

1. Compact item cho dropdown.
2. Full item cho page `/notifications`.
3. System notification item.
4. Approval/action notification item.

---

## 24. Domain component library

## 24.1 AUTH / Account components

| Component | Dùng cho | Ghi chú |
| --- | --- | --- |
| LoginForm | `/login` | Email, password, remember, forgot link |
| PasswordField | Login/reset/change password | Show/hide, strength optional |
| SessionExpiredState | Token hết hạn | Redirect login |
| AccountProfileCard | `/account/profile` | Avatar, name, email, roles |
| RoleBadgeList | User detail | Badge role theo quyền |
| PermissionMatrix | Role permission admin | Table/checkbox tree |

## 24.2 HOME components

| Component | Dùng cho | Ghi chú |
| --- | --- | --- |
| AppCard | Home Portal | Icon, name, badge, favorite |
| AppGrid | Home Portal | Responsive grid |
| AppSearchInput | Home/App Switcher | Alias search |
| AppCategoryChips | Home Portal | Recent/Favorite/My Apps |
| RecentAppList | Home/App Switcher | Theo lịch sử mở app |
| FavoriteButton | App card | Pin/unpin |
| ComingSoonAppCard | Phase later app | Disabled/teaser |

## 24.3 HR components

| Component | Dùng cho | Ghi chú |
| --- | --- | --- |
| EmployeeProfileHeader | Employee detail/my profile | Avatar, code, name, status, department |
| EmployeeStatusBadge | Employee list/detail | Probation/Official/Inactive/Resigned |
| EmployeeInfoSection | Detail | Field grid + masked field |
| DepartmentTree | Departments/org chart | Tree view |
| ContractCard | Employee contract | Status, date, file |
| ProfileChangeDiff | Profile change request | Old vs new value |
| SensitiveField | Employee sensitive data | Masked/audit reveal |
| EmployeeCodePreview | Code config | Preview next code |

## 24.4 ATT components

| Component | Dùng cho | Ghi chú |
| --- | --- | --- |
| AttendanceStatusCard | Attendance today | Check-in/out, state, shift |
| CheckInOutButton | Attendance today/dashboard | Allowed action + loading |
| WorkLogTimeline | Attendance detail | Logs trong ngày |
| AttendanceRecordStatusBadge | Table | Present/Late/Early/Absent/Leave/Remote |
| AttendanceAdjustmentForm | Adjustment request | Old/new time, reason, file |
| RemoteWorkRequestForm | Remote/công tác | Date, reason, task optional |
| ShiftCard | Shift list | Fixed/flexible |
| RuleSummaryCard | Attendance rule | Grace time, required minutes |

## 24.5 LEAVE components

| Component | Dùng cho | Ghi chú |
| --- | --- | --- |
| LeaveBalanceCard | My balances/dashboard | Remaining/used/pending |
| LeaveRequestForm | Create/edit leave | Date range, type, reason, file |
| LeaveCalculationPreview | Before submit | Số ngày/giờ, balance check |
| LeaveRequestStatusBadge | List/detail | Draft/Pending/Approved/Rejected/Cancelled |
| LeaveApprovalModal | Approve/reject | Comment required if reject |
| LeaveCalendar | Calendar view | Own/team/company by scope |
| LeavePolicySummary | Policy page | Rule summary |
| LeaveRequestTimeline | Detail | Submit/approve/reject/cancel history |

## 24.6 TASK components

| Component | Dùng cho | Ghi chú |
| --- | --- | --- |
| TaskCard | My tasks/Kanban | Title, priority, due, assignee |
| KanbanColumn | Kanban board | Todo/In Progress/In Review/Done |
| TaskDetailHeader | Task detail | Title, status, priority, actions |
| TaskPriorityBadge | List/card | Low/Medium/High/Urgent |
| TaskStatusBadge | List/card | Todo/In Progress/In Review/Done/Cancelled |
| TaskAssigneePicker | Create/update task | Employee search |
| TaskDueDateIndicator | Task card/detail | Due soon/overdue |
| ProjectCard | Project list | Progress, members, status |
| ChecklistPanel | Task detail | Checklist items |
| TaskCommentThread | Task detail | Comment/mention |
| TaskActivityLog | Task detail | History |

## 24.7 NOTI components

| Component | Dùng cho | Ghi chú |
| --- | --- | --- |
| NotificationBadge | Topbar | Count unread |
| NotificationDropdown | Topbar | Latest notifications |
| NotificationListItem | Notification page | Full list |
| NotificationDetailPanel | Detail | Payload + target |
| NotificationTemplatePreview | Admin template | Render variables |
| DeliveryStatusBadge | Delivery logs | Sent/Failed/Retrying |

## 24.8 DASH components

| Component | Dùng cho | Ghi chú |
| --- | --- | --- |
| DashboardGrid | Dashboard pages | Responsive widget grid |
| MetricCard | Dashboard | KPI/card số liệu |
| WidgetCard | Dashboard | Wrapper chuẩn |
| QuickActionCard | Dashboard | Shortcut gọi module gốc |
| ListWidget | Dashboard | Task, leave pending, notification |
| WidgetConfigPanel | Admin | Bật/tắt/order widget |
| WidgetFallbackState | Widget area | Empty/error/forbidden |

## 24.9 SYSTEM / FOUNDATION components

| Component | Dùng cho | Ghi chú |
| --- | --- | --- |
| SettingsFormSection | System settings | Group config |
| AuditLogTable | Audit logs | Actor/action/time/entity |
| FileListTable | Files | File metadata/action |
| ModuleStatusCard | Module catalog | Active/disabled/beta |
| CompanyProfileCard | Company settings | Info tenant |
| Seed/VersionInfo | System overview | Build/version optional |

---

## 25. State system chuẩn toàn hệ thống

### 25.1 Loading state

| Context | UI |
| --- | --- |
| Page loading | Page skeleton + giữ layout shell |
| Table loading | Skeleton rows |
| Button loading | Spinner trong button |
| Widget loading | Widget skeleton |
| Dropdown loading | Small spinner hoặc skeleton item |
| App grid loading | AppCard skeleton |

### 25.2 Empty state

| Context | Title | Action |
| --- | --- | --- |
| Employee list no data | Chưa có nhân viên | Thêm nhân viên nếu có quyền |
| Filter no result | Không tìm thấy kết quả phù hợp | Xóa bộ lọc |
| My tasks empty | Bạn chưa có việc nào | Tạo task nếu có quyền |
| Leave requests empty | Chưa có đơn nghỉ nào | Tạo đơn nghỉ |
| Notification empty | Chưa có thông báo | Không cần action |
| Scope empty | Không có dữ liệu trong phạm vi được phép | Quay lại hoặc đổi filter |

### 25.3 Error state

| Context | UI |
| --- | --- |
| API fail | ErrorState + retry |
| Validation fail | Field error + optional alert |
| Business rule fail | Alert warning/danger, giữ form data |
| Permission fail | ForbiddenPage/inline ForbiddenState |
| Network fail | Retry + giữ cache cũ nếu có |

### 25.4 Success state

| Action | UI |
| --- | --- |
| Save form | Toast success + redirect hoặc giữ page |
| Submit leave | Toast + status Pending + deep link detail |
| Approve leave | Toast + update status + close modal |
| Check-in/out | Success state in AttendanceStatusCard |
| Mark notification read | Unread dot biến mất, badge giảm |

### 25.5 Disabled state

Disabled không chỉ vì thiếu quyền, mà có thể vì business rule.

| Lý do | UI behavior |
| --- | --- |
| Không có permission | Ẩn action |
| Business rule chặn | Disable + tooltip lý do |
| Loading | Disable tạm thời + spinner |
| Data locked | Disable + lock icon |
| Module disabled | Disabled state toàn module |

---

## 26. Responsive component behavior

### 26.1 Layout responsive

| Component | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| HomePortalLayout | App grid rộng | App grid 3-4 cột | App grid 2 cột, search full width |
| ModuleWorkspaceLayout | Sidebar fixed | Sidebar collapsed/drawer | Sidebar drawer/bottom entry |
| AppSwitcher | Modal large | Drawer/fullscreen | Fullscreen overlay |
| DataTable | Full table | Horizontal scroll | CardList hoặc table scroll |
| Form | 2 columns nếu rộng | 1-2 columns | 1 column, full width |
| Drawer | Side drawer | Side drawer | Fullscreen/bottom sheet |
| NotificationDropdown | Popover | Drawer | Fullscreen list |

### 26.2 Mobile specific rules

1. Primary action nên nằm gần cuối form hoặc sticky bottom nếu form dài.
2. Filter nên chuyển vào drawer.
3. Table nhiều cột nên chuyển thành CardList cho màn P0.
4. App Switcher mobile là fullscreen overlay.
5. Sidebar không chiếm vĩnh viễn chiều ngang mobile.
6. Touch target tối thiểu 40x40px.

---

## 27. Component naming convention

### 27.1 Figma naming

```text
ComponentGroup/ComponentName/Variant/Size/State
```

Ví dụ:

```text
Button/Primary/md/Default
Button/Primary/md/Loading
Input/Text/md/Error
Badge/Status/Approved/sm
Layout/ModuleWorkspace/Desktop/Expanded
Navigation/AppCard/Available/Default
```

### 27.2 Frontend component naming

```text
BaseButton
BaseInput
BaseSelect
BaseModal
DataTable
AppCard
AppSwitcher
ModuleSidebar
PermissionGate
AttendanceStatusCard
LeaveRequestForm
TaskCard
NotificationDropdown
```

### 27.3 File structure đề xuất

```text
src/
  components/
    base/
      Button/
      Input/
      Select/
      Modal/
      Drawer/
      Toast/
    layout/
      AuthLayout/
      HomePortalLayout/
      ModuleWorkspaceLayout/
      Topbar/
      Sidebar/
      AppSwitcher/
    data/
      DataTable/
      Pagination/
      FilterBar/
      Badge/
      Avatar/
    feedback/
      EmptyState/
      ErrorState/
      ForbiddenPage/
      Skeleton/
    permission/
      PermissionGate/
      MaskedField/
      DisabledActionTooltip/
    domain/
      attendance/
      leave/
      task/
      hr/
      notification/
      dashboard/
  styles/
    tokens.css
    theme.css
  utils/
    permission.ts
    scope.ts
    formatDate.ts
```

---

## 28. Design token export format

### 28.1 CSS variables mẫu

```css
:root {
  --color-bg-canvas: #F8FAFC;
  --color-bg-surface: #FFFFFF;
  --color-bg-subtle: #F1F5F9;

  --color-text-primary: #0F172A;
  --color-text-secondary: #475569;
  --color-text-muted: #64748B;

  --color-border-default: #E2E8F0;
  --color-border-strong: #CBD5E1;

  --color-action-primary: #2F80ED;
  --color-action-primary-hover: #1F6FD1;
  --color-focus-ring: #8BC5FF;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  --shadow-card: 0 1px 3px rgba(15, 23, 42, 0.08);
  --shadow-dropdown: 0 4px 12px rgba(15, 23, 42, 0.10);
  --shadow-modal: 0 12px 32px rgba(15, 23, 42, 0.16);

  --topbar-height: 64px;
  --sidebar-width: 260px;
  --sidebar-collapsed-width: 72px;
}
```

### 28.2 Theme extension đề xuất

MVP có thể triển khai theme bằng CSS variables. Nếu dùng Tailwind, nên map token vào `tailwind.config` thay vì dùng hex trực tiếp trong component.

```ts
colors: {
  canvas: 'var(--color-bg-canvas)',
  surface: 'var(--color-bg-surface)',
  primary: 'var(--color-action-primary)',
  border: 'var(--color-border-default)',
}
```

---

## 29. Component specification template

Mỗi component trong Figma/frontend nên có spec tối thiểu theo mẫu:

```text
Component name:
Mục đích:
Dùng ở màn hình:
Anatomy:
Props/Variants:
States:
Permission behavior:
Responsive behavior:
Accessibility:
API/data dependency nếu có:
Acceptance criteria:
```

Ví dụ rút gọn:

```text
Component name: CheckInOutButton
Mục đích: Cho phép Employee check-in/check-out theo trạng thái ATT today.
Dùng ở màn hình: Attendance Today, Dashboard quick action.
Variants: check-in, check-out, disabled, loading, success.
States: allowed, blocked by leave, blocked by no shift, loading, error.
Permission behavior: chỉ render nếu có ATT.ATTENDANCE.CHECK_IN hoặc CHECK_OUT.
API dependency: /api/v1/attendance/today, /api/v1/attendance/check-in, /api/v1/attendance/check-out.
```

---

## 30. Component inventory MVP

### 30.1 Foundation components bắt buộc P0

| Mã | Component | Priority | Ghi chú |
| --- | --- | --- | --- |
| UI05-CMP-001 | Button | P0 | Primary/secondary/danger/icon/loading |
| UI05-CMP-002 | Input | P0 | Text/password/search/error |
| UI05-CMP-003 | Select/Combobox | P0 | Employee, status, type filter |
| UI05-CMP-004 | DatePicker/DateRangePicker | P0 | Leave/attendance/filter |
| UI05-CMP-005 | Modal/ConfirmDialog | P0 | Check-in, approve/reject, delete |
| UI05-CMP-006 | Toast/Alert | P0 | Feedback chung |
| UI05-CMP-007 | EmptyState/ErrorState/ForbiddenPage | P0 | State chung |
| UI05-CMP-008 | Skeleton/Spinner | P0 | Loading chung |
| UI05-CMP-009 | Badge/StatusBadge | P0 | Status nghiệp vụ |
| UI05-CMP-010 | DataTable | P0 | HR/ATT/LEAVE/TASK/NOTI |

### 30.2 Layout components bắt buộc P0

| Mã | Component | Priority | Ghi chú |
| --- | --- | --- | --- |
| UI05-CMP-011 | AuthLayout | P0 | Login/forgot/reset |
| UI05-CMP-012 | HomePortalLayout | P0 | `/home` |
| UI05-CMP-013 | ModuleWorkspaceLayout | P0 | `/{module}/*` |
| UI05-CMP-014 | GlobalTopbar | P0 | App switcher/noti/avatar |
| UI05-CMP-015 | ModuleSidebar | P0 | Sidebar per module |
| UI05-CMP-016 | AppSwitcher | P0 | Overlay đổi app |
| UI05-CMP-017 | PageHeader | P0 | Title/action/breadcrumb |
| UI05-CMP-018 | FilterBar | P0 | List pages |

### 30.3 Domain components P0/P1

| Mã | Component | Module | Priority |
| --- | --- | --- | --- |
| UI05-CMP-019 | AppCard | HOME | P0 |
| UI05-CMP-020 | NotificationBadge | NOTI | P0 |
| UI05-CMP-021 | NotificationDropdown | NOTI | P0 |
| UI05-CMP-022 | AttendanceStatusCard | ATT | P0 |
| UI05-CMP-023 | CheckInOutButton | ATT | P0 |
| UI05-CMP-024 | LeaveBalanceCard | LEAVE | P0 |
| UI05-CMP-025 | LeaveRequestForm | LEAVE | P0 |
| UI05-CMP-026 | LeaveCalculationPreview | LEAVE | P0 |
| UI05-CMP-027 | ApprovalBox | LEAVE/ATT/HR | P0 |
| UI05-CMP-028 | TaskCard | TASK | P0 |
| UI05-CMP-029 | KanbanColumn | TASK | P0 |
| UI05-CMP-030 | TaskDetailHeader | TASK | P0 |
| UI05-CMP-031 | CommentThread | TASK | P1 |
| UI05-CMP-032 | Checklist | TASK | P1 |
| UI05-CMP-033 | EmployeeProfileHeader | HR | P1 |
| UI05-CMP-034 | MaskedField | HR/SYSTEM | P1 |
| UI05-CMP-035 | MetricCard/WidgetCard | DASH | P1 |

---

## 31. API/data integration rules for components

### 31.1 Nguyên tắc chung

1. Component UI không tự quyết định business rule cuối cùng.
2. Component nhận `allowed_actions`, `permissions`, `scope`, `status` từ API hoặc auth context.
3. Action quan trọng phải gọi API module gốc.
4. Component phải xử lý `loading`, `error`, `empty`, `forbidden`.
5. Nếu API trả business error, UI phải hiển thị message rõ và giữ lại dữ liệu người dùng đã nhập.

### 31.2 Mapping component với API chính

| Component | API/source |
| --- | --- |
| AppGrid/AppSwitcher | `/api/v1/foundation/modules/my-apps`, `/api/v1/auth/me/permissions` |
| NotificationBadge | `/api/v1/notifications/unread-count` |
| NotificationDropdown | `/api/v1/notifications/dropdown` |
| AttendanceStatusCard | `/api/v1/attendance/today` |
| CheckInOutButton | `/api/v1/attendance/check-in`, `/api/v1/attendance/check-out` |
| LeaveRequestForm | `/api/v1/leave/requests`, `/api/v1/leave/calculate` |
| ApprovalBox | Approve/reject endpoints của module gốc |
| TaskCard/TaskDetail | `/api/v1/tasks/...` |
| EmployeeProfileHeader | `/api/v1/hr/employees/{id}` hoặc `/api/v1/hr/me` |
| WidgetCard | `/api/v1/dashboard/widgets/{widget_key}` |

---

## 32. Content guideline và microcopy

### 32.1 Tone of voice

```text
Ngắn gọn
Rõ ràng
Lịch sự
Không đổ lỗi cho người dùng
Ưu tiên hướng dẫn hành động tiếp theo
```

### 32.2 Button label chuẩn

| Action | Label |
| --- | --- |
| Create | Tạo mới |
| Save | Lưu |
| Save draft | Lưu nháp |
| Submit | Gửi |
| Approve | Duyệt |
| Reject | Từ chối |
| Cancel | Hủy |
| Delete | Xóa |
| Archive | Lưu trữ |
| Export | Xuất dữ liệu |
| Retry | Thử lại |
| Back | Quay lại |
| View detail | Xem chi tiết |

### 32.3 Error copy chuẩn

| Error | Copy |
| --- | --- |
| Required field | `Vui lòng nhập thông tin này.` |
| Invalid email | `Email không đúng định dạng.` |
| Forbidden | `Bạn không có quyền thực hiện thao tác này.` |
| Not found | `Không tìm thấy dữ liệu.` |
| Server error | `Hệ thống đang gặp lỗi. Vui lòng thử lại.` |
| Network error | `Không thể kết nối đến hệ thống. Vui lòng kiểm tra mạng.` |
| Business rule | Copy cụ thể từ API nếu có |

### 32.4 Success copy chuẩn

| Action | Copy |
| --- | --- |
| Save | `Đã lưu thay đổi.` |
| Create | `Tạo mới thành công.` |
| Submit leave | `Đã gửi đơn nghỉ phép.` |
| Approve | `Đã duyệt yêu cầu.` |
| Reject | `Đã từ chối yêu cầu.` |
| Check-in | `Check-in thành công.` |
| Check-out | `Check-out thành công.` |
| Mark read | `Đã đánh dấu đã đọc.` |

---

## 33. Dark mode và theme mở rộng

### 33.1 MVP decision

Trong MVP, ưu tiên thiết kế **light mode** trước để giảm phạm vi.

Tuy nhiên token phải chừa khả năng mở rộng dark mode bằng semantic token.

### 33.2 Dark mode readiness

| Hạng mục | Yêu cầu |
| --- | --- |
| Không hard-code màu | Bắt buộc |
| Dùng semantic token | Bắt buộc |
| Icon theo currentColor | Khuyến nghị |
| Chart color token | Khuyến nghị |
| Background image Home | Có overlay riêng cho dark/light |

### 33.3 Theme customization phase sau

Có thể mở rộng:

1. Brand color theo company.
2. Logo/company theme.
3. Light/dark mode.
4. Compact/comfortable density.
5. Module icon custom.

---

## 34. QA checklist cho Design System

| Nhóm test | Checklist |
| --- | --- |
| Token | Không hard-code màu/spacing/radius trong component chính |
| Button | Đủ state default/hover/focus/loading/disabled/error/danger |
| Form | Label, helper, validation, disabled, readonly, dirty guard |
| Table | Loading, empty, error, pagination, responsive, masked field |
| Permission | Hide/disable/forbidden đúng theo permission/scope |
| App Switcher | Mở từ mọi màn protected, search alias, không lộ app trái quyền |
| Topbar | Notification badge, avatar menu, quick action theo quyền |
| Sidebar | Menu theo module, active state, collapsed tooltip |
| Modal/Drawer | Focus trap, close rule, dirty confirm |
| Notification | Unread count, dropdown, mark read, deep link |
| Responsive | Desktop/tablet/mobile cho P0 screens |
| Accessibility | Contrast, keyboard, aria-label, focus visible |
| Microcopy | Error/success/empty rõ ràng, không mơ hồ |

---

## 35. Acceptance criteria UI-05

| Mã | Tiêu chí nghiệm thu |
| --- | --- |
| UI05-AC-001 | Có định nghĩa đầy đủ design token cho color, typography, spacing, radius, shadow, breakpoint, motion, z-index |
| UI05-AC-002 | Có color system gồm neutral, brand, semantic và module accent |
| UI05-AC-003 | Có typography system và quy tắc dùng text style |
| UI05-AC-004 | Có layout component cho AuthLayout, HomePortalLayout, ModuleWorkspaceLayout, Topbar, Sidebar, AppSwitcher |
| UI05-AC-005 | Có component foundation cho button, form, table, badge, modal, drawer, toast, alert, empty/error/loading/forbidden state |
| UI05-AC-006 | Có component permission: PermissionGate, LockedApp, DisabledActionTooltip, MaskedField, ForbiddenPage |
| UI05-AC-007 | Có component dashboard: MetricCard, WidgetCard, QuickActionCard, ListWidget, ChartPlaceholder |
| UI05-AC-008 | Có domain component cho HR, ATT, LEAVE, TASK, NOTI, DASH, SYSTEM |
| UI05-AC-009 | Có quy tắc responsive cho desktop, tablet, mobile web |
| UI05-AC-010 | Có accessibility guideline tối thiểu cho keyboard, focus, contrast, aria-label |
| UI05-AC-011 | Có component naming convention cho Figma và frontend |
| UI05-AC-012 | Có checklist QA để kiểm thử Design System |
| UI05-AC-013 | Component library đủ làm nền để triển khai UI-06, UI-07, UI-08 và UI-09 |

---

## 36. Kết luận

UI-05 chốt nền tảng Design System và Component Library cho MVP theo hướng:

```text
Design token nhất quán
-> Layout shell rõ ràng
-> Component foundation tái sử dụng
-> Permission/state/responsive/accessibility chuẩn
-> Domain component cho nghiệp vụ lõi
-> Sẵn sàng dựng high-fidelity và frontend implementation
```

Sau UI-05, bước tiếp theo nên triển khai:

```text
UI-06: Home Portal & App Switcher UI Design
```

UI-06 sẽ dùng các token và component trong UI-05 để thiết kế chi tiết giao diện Home Portal, App Switcher, app card, app grid, search app, recent/favorite apps, locked/coming soon state và responsive behavior.
