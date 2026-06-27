# UI-01: UI/UX DESIGN TỔNG QUAN - PHIÊN BẢN CẬP NHẬT BỐ CỤC
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

> **📚 Bộ tài liệu UI — Hệ thống Quản lý Doanh nghiệp**
> **UI-01 Tổng quan** · [UI-02 IA/Sitemap](<UI-02_Information_Architecture_Sitemap.md>) · [UI-03 User Flow](<UI-03_User_Flow_MVP.md>) · [UI-04 Screen List](<UI-04_Screen_List_Wireframe_Plan.md>) · [UI-05 Design System](<UI-05_Design_System_Component_Library.md>) · [UI-06 Home/App Switcher](<UI-06_Home_Portal_App_Switcher_UI_Design.md>) · [UI-07 Module Workspace](<UI-07_Module_Workspace_Template_Design.md>) · [UI-08 Dashboard](<UI-08_Dashboard_UIUX_Design.md>) · [UI-09 Module UI](<UI-09_Module_UI_Design.md>) · [UI-10 Prototype/Handoff](<UI-10_Prototype_Frontend_Handoff_Guide.md>)
>
> **Liên quan:** [Sản phẩm: PRD-00](<../PRD/PRD-00 Enterprise Management System .md>) · [Đặc tả: SPEC-01 Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) · [Thiết kế DB: DB-01](<../DB/DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [Chuẩn API: API-01](<../API Design/API-01 TỔNG QUAN.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | UI-01 |
| Tên tài liệu | UI/UX Design Tổng quan - Cập nhật bố cục Home Portal, Module Workspace và App Switcher |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, yêu cầu cập nhật bố cục theo ảnh tham chiếu |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Người viết |  |
| Người duyệt |  |

### Lịch sử thay đổi (Changelog)

| Phiên bản | Ngày | Thay đổi | Người thực hiện |
| --- | --- | --- | --- |
| v1.0 | 20/06/2026 | Khởi tạo tài liệu MVP; hợp nhất bố cục Home Portal / Module Workspace / App Switcher. | |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả định hướng UI/UX tổng quan cho hệ thống quản lý doanh nghiệp nội bộ ở giai đoạn MVP Version 1.0.

Phiên bản cập nhật này bổ sung quyết định thiết kế quan trọng:

```text
Sau khi đăng nhập, người dùng không đi thẳng vào một dashboard nghiệp vụ chi tiết.
Người dùng sẽ vào Home Portal tổng của hệ thống trước.
Từ Home Portal, người dùng chọn ứng dụng/module để vào không gian làm việc chi tiết của từng module.
Trong mọi màn hình, người dùng có thể bấm nút Ứng dụng để mở App Switcher và chuyển nhanh sang module khác.
```

Tài liệu UI-01 đóng vai trò là tài liệu nền tảng cho toàn bộ bước thiết kế giao diện. Các tài liệu UI tiếp theo như UI-02 Sitemap, UI-03 User Flow, UI-04 Screen List, UI-05 Design System và UI-06 Dashboard Design phải bám theo các nguyên tắc trong tài liệu này.

---

## 3. Phạm vi UI/UX MVP

### 3.1 Module thuộc phạm vi MVP

UI/UX MVP cần thiết kế cho các module chính sau:

| Module | Tên module | Vai trò trong UI/UX MVP |
| --- | --- | --- |
| AUTH | Tài khoản, đăng nhập & phân quyền | Login, session, profile, user, role, permission |
| HR | Quản lý nhân sự | Hồ sơ nhân viên, phòng ban, chức vụ, hợp đồng, yêu cầu cập nhật hồ sơ |
| ATT | Chấm công | Check-in/check-out, bảng công, ca làm, rule, điều chỉnh công, remote work |
| LEAVE | Nghỉ phép | Số dư phép, tạo đơn nghỉ, duyệt đơn, lịch nghỉ, chính sách nghỉ |
| TASK | Công việc & dự án | Project, task, Kanban, comment, checklist, file, tiến độ |
| DASH | Dashboard | Widget tổng hợp theo vai trò, quick actions, cảnh báo |
| NOTI | Thông báo hệ thống | Badge, dropdown, danh sách thông báo, trạng thái đọc/chưa đọc |
| FOUNDATION | Nền tảng hệ thống | Company, settings, audit log, file, module catalog, app registry |

### 3.2 Module chưa thiết kế sâu trong MVP

Các module sau chỉ cần xuất hiện ở mức định hướng mở rộng hoặc app placeholder nếu hệ thống muốn thể hiện ecosystem:

| Module | Giai đoạn đề xuất |
| --- | --- |
| PAYROLL - Tiền lương | Phase 2 |
| RECRUIT - Tuyển dụng | Phase 2 |
| ASSET - Tài sản | Phase 3 |
| ROOM - Phòng họp | Phase 3 |
| CHAT - Chat nội bộ | Phase 4 |
| SOCIAL - Mạng xã hội nội bộ | Phase 4 |
| MOBILE - Mobile app | Phase sau |
| AI - AI & automation | Phase sau |

---

## 4. Quyết định thiết kế UX đã chốt

### 4.1 Quyết định 1: Sau đăng nhập vào Home Portal

Sau khi đăng nhập thành công, người dùng sẽ được đưa đến **Home Portal** thay vì đi trực tiếp vào dashboard nghiệp vụ.

Home Portal là trang tổng của hệ thống, có nhiệm vụ:

1. Hiển thị các ứng dụng/module mà người dùng được phép truy cập.
2. Cho phép người dùng tìm kiếm ứng dụng nhanh.
3. Cho phép người dùng mở ứng dụng gần đây hoặc ứng dụng yêu thích.
4. Tạo cảm giác hệ thống là một nền tảng all-in-one, có nhiều ứng dụng nội bộ.
5. Giảm cảm giác phức tạp khi người dùng lần đầu đăng nhập.

### 4.2 Quyết định 2: Vào module sẽ dùng Module Workspace Layout

Khi người dùng chọn một module từ Home Portal hoặc App Switcher, hệ thống chuyển sang **Module Workspace Layout**.

Module Workspace là bố cục làm việc chi tiết cho từng module, gồm:

1. Sidebar trái riêng theo module.
2. Topbar dùng chung.
3. Khu vực nội dung chính.
4. Breadcrumb hoặc page title.
5. Bộ lọc, tab, bảng, biểu đồ, form, modal tùy nghiệp vụ.

### 4.3 Quyết định 3: Có nút Ứng dụng để mở App Switcher

Hệ thống cần có một nút **Ứng dụng** hiển thị ở topbar hoặc vị trí global cố định.

Khi bấm nút này, hệ thống mở **App Switcher / App Drawer / App Launcher** để hiển thị toàn bộ ứng dụng người dùng có quyền truy cập.

App Switcher giúp:

1. Chuyển nhanh giữa các module.
2. Không cần quay lại Home Portal mỗi lần muốn đổi ứng dụng.
3. Tăng tính nhất quán với mô hình ecosystem/workspace.
4. Hỗ trợ tìm kiếm nhanh ứng dụng.
5. Hỗ trợ nhóm Gần đây, Ứng dụng của tôi, Ứng dụng khác.

---

## 5. Mô hình điều hướng tổng thể

### 5.1 Mô hình 3 lớp điều hướng

Hệ thống dùng mô hình điều hướng 3 lớp:

```text
Lớp 1: Home Portal
  -> Cổng vào tổng sau khi đăng nhập
  -> Hiển thị app/module dạng icon grid
  -> Hỗ trợ search, category, recent, favorite

Lớp 2: Module Workspace
  -> Không gian làm việc chi tiết của từng module
  -> Có sidebar riêng theo module
  -> Có topbar, content area, widget, table, form

Lớp 3: App Switcher Overlay
  -> Lớp chuyển ứng dụng nhanh
  -> Mở được từ mọi màn hình
  -> Hiển thị app theo quyền của user
```

### 5.2 Flow điều hướng chuẩn

```text
Login
  -> Home Portal
    -> Chọn ứng dụng/module
      -> Module Workspace
        -> Thao tác nghiệp vụ
        -> Bấm nút Ứng dụng
          -> App Switcher
            -> Chuyển sang module khác
```

### 5.3 Flow quay về Home

Người dùng có thể quay về Home Portal bằng một trong các cách sau:

1. Click logo hệ thống.
2. Click nút Home trong App Switcher.
3. Click nút Home ở sidebar nếu module hỗ trợ.
4. Dùng breadcrumb nếu đang ở màn hình sâu.

---

## 6. Layout type của hệ thống

### 6.1 Layout 01 - Home Portal Layout

#### 6.1.1 Mục đích

Home Portal Layout dùng cho trang đầu tiên sau khi đăng nhập.

Đây là nơi người dùng chọn ứng dụng để bắt đầu làm việc.

#### 6.1.2 Đặc điểm giao diện

1. Giao diện toàn màn hình, thoáng, hiện đại.
2. Có thể dùng background hình ảnh, gradient hoặc hình nền thương hiệu.
3. App hiển thị dạng icon grid.
4. Ưu tiên trải nghiệm chọn nhanh, tìm nhanh, mở nhanh.
5. Không hiển thị quá nhiều dữ liệu nghiệp vụ nặng.
6. Không dùng sidebar nghiệp vụ dài.

#### 6.1.3 Thành phần chính

| Khu vực | Thành phần |
| --- | --- |
| Global header | Logo, nút quay lại/home, search, nút Ứng dụng, setting, avatar |
| Category bar | Gần đây, Yêu thích, Ứng dụng của tôi, Tất cả, Nhân sự, Vận hành, Tài chính, Hệ thống |
| App grid | Các app/module dạng icon card |
| App status | Badge đã cài, chưa kích hoạt, beta, khóa quyền, yêu thích |
| Pagination/slider | Dùng khi số app nhiều |
| Background | Hình nền/gradient có overlay đảm bảo dễ đọc |

#### 6.1.4 Cấu trúc gợi ý

```text
+--------------------------------------------------------------------------------+
| Logo     Search                                             Ứng dụng  Settings |
+--------------------------------------------------------------------------------+
|                                                                                |
|                  Category chips / App filters                                  |
|                                                                                |
|                    [HR] [Task] [Payroll] [Attendance]                          |
|                    [Leave] [Workflow] [Accounting] [System]                    |
|                    [Asset] [Recruit] [Room] [Social]                           |
|                                                                                |
|                         Carousel / Page indicator                              |
|                                                                                |
+--------------------------------------------------------------------------------+
```

#### 6.1.5 Rule hiển thị app trên Home Portal

| Trường hợp | Cách xử lý UI |
| --- | --- |
| User có quyền truy cập module | Hiển thị app bình thường |
| User không có quyền truy cập module | Ẩn app khỏi Home Portal |
| Module chưa kích hoạt nhưng user có quyền xem | Hiển thị mờ kèm badge Chưa kích hoạt nếu business muốn |
| Module đang beta | Hiển thị badge Beta |
| Module thường dùng | Cho phép ghim/Yêu thích |
| Module mới mở gần đây | Hiển thị trong nhóm Gần đây |

---

### 6.2 Layout 02 - Module Workspace Layout

#### 6.2.1 Mục đích

Module Workspace Layout dùng cho tất cả màn hình làm việc chi tiết của từng module.

Ví dụ:

1. HR Workspace.
2. ATT Workspace.
3. LEAVE Workspace.
4. TASK Workspace.
5. NOTI Workspace.
6. ADMIN/FOUNDATION Workspace.

#### 6.2.2 Đặc điểm giao diện

1. Có sidebar trái riêng cho module.
2. Có topbar dùng chung.
3. Có content area rộng cho bảng, biểu đồ, form và dashboard.
4. Hỗ trợ nhiều tab, filter, action button.
5. Tối ưu cho thao tác nghiệp vụ thường xuyên.
6. Có thể thu gọn sidebar để tăng không gian làm việc.

#### 6.2.3 Thành phần chính

| Khu vực | Thành phần |
| --- | --- |
| Module sidebar | Menu con của module, icon, active state, collapse |
| Topbar | App switcher, search, notification, help, settings, avatar |
| Page header | Tiêu đề trang, breadcrumb, action chính |
| Filter bar | Search, filter, sort, date range, unit selector |
| Content area | Dashboard, table, detail, form, kanban, calendar |
| Right panel optional | Detail drawer, quick view, chat/help, AI assistant phase sau |

#### 6.2.4 Cấu trúc gợi ý

```text
+--------------------------------------------------------------------------------+
| App icon + Module name   Search                  App Switcher  Noti  Avatar    |
+----------------------+---------------------------------------------------------+
| Module sidebar       | Page header / Breadcrumb / Actions                    |
|                      +---------------------------------------------------------+
| - Tổng quan          | Filter bar / Tabs                                      |
| - Danh sách          +---------------------------------------------------------+
| - Duyệt yêu cầu      | Main content: table, chart, form, kanban, calendar     |
| - Báo cáo            |                                                         |
| - Thiết lập          |                                                         |
+----------------------+---------------------------------------------------------+
```

#### 6.2.5 Rule sidebar module

1. Sidebar chỉ hiển thị menu thuộc module hiện tại.
2. Menu hiển thị theo permission của user.
3. Menu không có quyền thì ẩn, không chỉ disable.
4. Với menu có quyền xem nhưng không có quyền thao tác, vẫn cho vào trang nhưng ẩn/disable action tương ứng.
5. Sidebar có trạng thái expanded/collapsed.
6. Sidebar phải hỗ trợ item nhiều cấp nhưng không nên lạm dụng quá 2 cấp trong MVP.

---

### 6.3 Layout 03 - App Switcher Overlay

#### 6.3.1 Mục đích

App Switcher Overlay là lớp mở nhanh toàn bộ ứng dụng từ bất kỳ màn hình nào.

#### 6.3.2 Kiểu hiển thị đề xuất

Có 3 kiểu có thể chọn:

| Kiểu | Mô tả | Khuyến nghị |
| --- | --- | --- |
| Modal lớn ở giữa màn hình | Giống app launcher, dễ tập trung | Khuyến nghị cho desktop |
| Side drawer từ trái/phải | Tốt khi muốn giữ ngữ cảnh màn hình hiện tại | Có thể dùng |
| Fullscreen overlay | Tốt cho mobile/tablet | Khuyến nghị cho responsive nhỏ |

#### 6.3.3 Thành phần chính

| Khu vực | Thành phần |
| --- | --- |
| Header | Nút đóng, search app, link Chợ ứng dụng nếu có |
| Gần đây | App vừa mở gần nhất |
| Ứng dụng của tôi | App user có quyền hoặc đã được gán |
| Ứng dụng khác | App chưa kích hoạt, app phase sau hoặc app doanh nghiệp mở rộng |
| App item | Icon, tên app, badge, trạng thái, pin/favorite |

#### 6.3.4 Cấu trúc gợi ý

```text
+------------------------------------------------------+
| X   Tìm kiếm ứng dụng...                  Chợ ứng dụng |
+------------------------------------------------------+
| Gần đây                                              |
| [HR] [Task] [Payroll] [Attendance] [Employee]        |
|                                                      |
| Ứng dụng của tôi                                     |
| HR        ATT       LEAVE      TASK      NOTI        |
| DASH      SYSTEM    FILES      REPORT    SETTINGS    |
|                                                      |
| Ứng dụng khác                                        |
| Recruit   Asset     Room       Chat      Social      |
+------------------------------------------------------+
```

#### 6.3.5 Rule tìm kiếm app

Search trong App Switcher cần hỗ trợ:

1. Tìm theo tên tiếng Việt.
2. Tìm theo tên tiếng Anh/module code.
3. Tìm không dấu nếu có thể.
4. Tìm theo alias thông dụng.
5. Ưu tiên app user có quyền lên trước.
6. Nếu không có kết quả, hiển thị empty state có hướng dẫn.

Ví dụ alias:

| Từ khóa | App gợi ý |
| --- | --- |
| nhân sự, hr, employee | HR |
| công, chấm công, attendance | ATT |
| nghỉ, phép, leave | LEAVE |
| task, công việc, dự án | TASK |
| thông báo, notification | NOTI |
| quyền, user, role | AUTH / SYSTEM |

---

## 7. Nguyên tắc thiết kế trải nghiệm theo vai trò

### 7.1 Nhóm người dùng chính

| Vai trò | Nhu cầu chính trên UI |
| --- | --- |
| Employee | Chấm công, xem task, xin nghỉ, xem hồ sơ cá nhân, nhận thông báo |
| Manager | Theo dõi team, duyệt nghỉ, duyệt điều chỉnh công, giao việc, xem tiến độ |
| HR | Quản lý nhân viên, hợp đồng, bảng công, nghỉ phép, cảnh báo nhân sự |
| Admin công ty | Quản lý user, role, permission, cấu hình hệ thống |
| Super Admin | Quản trị toàn hệ thống, tenant, module, cấu hình nền tảng |

### 7.2 Nguyên tắc role-based UX

1. User chỉ thấy app/module có quyền truy cập.
2. User chỉ thấy menu có quyền xem.
3. User chỉ thấy action có quyền thao tác.
4. User có nhiều role có thể được gợi ý nhiều dashboard/module khác nhau.
5. Data trong dashboard/module phải bám data scope: Own, Team, Department, Project, Company, System.
6. UI không được giả định quyền chỉ dựa trên tên role, mà phải dựa vào permission backend trả về.

### 7.3 Trải nghiệm theo vai trò sau login

| Role | Home Portal ưu tiên app | Module mở nhanh đề xuất |
| --- | --- | --- |
| Employee | Chấm công, Nghỉ phép, Công việc, Thông báo, Hồ sơ của tôi | ATT, LEAVE, TASK |
| Manager | Dashboard, Công việc, Nghỉ phép, Chấm công team, Nhân sự team | DASH, TASK, LEAVE, ATT |
| HR | Nhân sự, Chấm công, Nghỉ phép, Dashboard, Thông báo | HR, ATT, LEAVE, DASH |
| Admin | Hệ thống, User, Role, Permission, Settings, Audit | AUTH, FOUNDATION |
| Super Admin | Company, Module, System settings, Audit, User management | FOUNDATION, AUTH |

---

## 8. Home Portal UX Design

### 8.1 Mục tiêu Home Portal

Home Portal cần giúp người dùng trả lời nhanh 3 câu hỏi:

```text
Tôi có thể dùng những ứng dụng nào?
Tôi muốn mở nhanh ứng dụng nào?
Có ứng dụng nào tôi thường dùng hoặc vừa dùng gần đây không?
```

### 8.2 Không nên đưa nghiệp vụ quá sâu vào Home Portal

Home Portal không phải nơi xử lý nghiệp vụ chi tiết.

Không nên đặt quá nhiều bảng, biểu đồ, báo cáo phức tạp tại Home Portal.

Nếu cần hiển thị thông tin nhẹ, chỉ nên dùng:

1. App gần đây.
2. App yêu thích.
3. Thông báo quan trọng rất ngắn.
4. Quick link vào dashboard/module.

### 8.3 App card trên Home Portal

Mỗi app card nên có:

| Thành phần | Mô tả |
| --- | --- |
| Icon | Icon nhận diện module |
| Tên app | Tên dễ hiểu: Nhân sự, Chấm công, Nghỉ phép |
| Badge trạng thái | Beta, New, Locked, Active nếu cần |
| Favorite marker | Cho phép ghim app |
| Permission status | Nếu app bị khóa có thể ẩn hoặc hiển thị mờ theo policy |

### 8.4 Nhóm app đề xuất

| Nhóm | App/module |
| --- | --- |
| Công việc hằng ngày | Chấm công, Nghỉ phép, Công việc, Thông báo |
| Nhân sự | Nhân viên, Thông tin nhân sự, Hợp đồng, Tuyển dụng phase sau |
| Quản trị | Hệ thống, User, Role, Permission, Settings |
| Vận hành | Quy trình, Workflow, Phòng họp, Tài sản phase sau |
| Tài chính | Tiền lương, Kế toán, Thuế TNCN phase sau |
| Giao tiếp | Chat, Mạng xã hội nội bộ phase sau |

### 8.5 Background và độ dễ đọc

Nếu dùng background ảnh như ảnh tham chiếu, cần áp dụng:

1. Overlay màu tối/nhạt để tăng contrast.
2. App text phải đủ rõ trên nền.
3. Không đặt text nhỏ trực tiếp lên vùng ảnh quá phức tạp.
4. Nút, chip, icon phải có shadow hoặc surface riêng.
5. Có fallback background màu/gradient khi ảnh chưa tải.

---

## 9. Module Workspace UX Design

### 9.1 Mục tiêu Module Workspace

Module Workspace cần tối ưu cho thao tác nghiệp vụ sâu:

1. Xem danh sách.
2. Tìm kiếm/lọc/sắp xếp.
3. Xem chi tiết.
4. Tạo mới/cập nhật/xóa mềm.
5. Duyệt/từ chối.
6. Xem lịch sử/audit.
7. Export nếu có quyền.
8. Điều hướng nhanh giữa các màn hình con trong cùng module.

### 9.2 Sidebar theo từng module

#### 9.2.1 AUTH / System Workspace

```text
Tổng quan
Người dùng
Vai trò
Quyền
Gán vai trò
Phiên đăng nhập
Nhật ký đăng nhập
Thiết lập bảo mật
```

#### 9.2.2 HR Workspace

```text
Tổng quan
Nhân viên
Hồ sơ
Hợp đồng
Phòng ban
Chức vụ
Cấp bậc
Yêu cầu cập nhật hồ sơ
File hồ sơ
Báo cáo
Thiết lập
```

#### 9.2.3 ATT Workspace

```text
Tổng quan
Chấm công hôm nay
Bảng công của tôi
Bảng công team
Bảng công công ty
Điều chỉnh công
Remote/Công tác
Ca làm việc
Rule chấm công
Báo cáo
Thiết lập
```

#### 9.2.4 LEAVE Workspace

```text
Tổng quan
Số dư phép của tôi
Đơn nghỉ của tôi
Tạo đơn nghỉ
Duyệt đơn nghỉ
Lịch nghỉ
Loại nghỉ
Chính sách nghỉ
Số dư phép nhân viên
Báo cáo
Thiết lập
```

#### 9.2.5 TASK Workspace

```text
Tổng quan
Dự án
Task của tôi
Tất cả task
Kanban
Task quá hạn
Comment/Mention
Báo cáo tiến độ
Thiết lập
```

#### 9.2.6 NOTI Workspace

```text
Thông báo của tôi
Tất cả thông báo
Chưa đọc
Đã đọc
Cấu hình event
Template thông báo
Delivery log
Thiết lập
```

### 9.3 Topbar trong Module Workspace

Topbar nên dùng chung cho mọi module.

| Thành phần | Mục đích |
| --- | --- |
| App icon/module name | Nhận diện module hiện tại |
| Global search | Tìm kiếm trong module hoặc toàn hệ thống tùy cấu hình |
| App Switcher button | Mở danh sách ứng dụng |
| Notification badge | Xem thông báo nhanh |
| Help/AI assistant | Phase sau hoặc hỗ trợ nhanh |
| Settings | Thiết lập cá nhân/hệ thống theo quyền |
| Avatar menu | Profile, đổi mật khẩu, logout |

### 9.4 Page header chuẩn

Mỗi màn hình trong module nên có page header gồm:

1. Breadcrumb.
2. Tiêu đề màn hình.
3. Mô tả ngắn nếu cần.
4. Primary action.
5. Secondary actions.
6. Export/import nếu có quyền.

Ví dụ:

```text
Nhân sự / Nhân viên
Danh sách nhân viên
[+ Thêm nhân viên] [Import] [Export]
```

---

## 10. App Switcher UX Design

### 10.1 Mục tiêu App Switcher

App Switcher giúp người dùng chuyển module nhanh mà không phá vỡ luồng làm việc hiện tại.

Người dùng có thể mở App Switcher từ:

1. Home Portal.
2. Module Workspace.
3. Bất kỳ màn hình chi tiết nào.

### 10.2 Vị trí nút mở App Switcher

Khuyến nghị đặt ở topbar, gần khu vực search hoặc avatar.

Có thể dùng:

```text
Icon grid 3x3 + label "Ứng dụng"
```

Trên màn hình nhỏ, có thể chỉ hiển thị icon.

### 10.3 Trạng thái App Switcher

| State | Mô tả |
| --- | --- |
| Default | Hiển thị app gần đây và ứng dụng của tôi |
| Searching | Hiển thị kết quả theo từ khóa |
| Empty search | Không có ứng dụng phù hợp |
| Loading | Đang tải danh sách app theo permission |
| Error | Không tải được app, có nút thử lại |
| No permission | Không hiển thị app không có quyền hoặc hiển thị mờ theo policy |

### 10.4 App Switcher permission rule

1. App Switcher lấy danh sách app từ backend hoặc app registry đã kiểm quyền.
2. Không tin danh sách app hard-code ở frontend.
3. App không có permission truy cập phải ẩn khỏi danh sách chính.
4. Nếu sản phẩm muốn hiển thị app chưa kích hoạt để giới thiệu, phải phân biệt rõ trạng thái `disabled`, `not_available`, `coming_soon`.
5. Click vào app không có quyền phải chặn bằng backend nếu frontend bị bypass.

---

## 11. Dashboard UX Strategy

### 11.1 Vị trí Dashboard sau cập nhật bố cục

Sau cập nhật bố cục, Dashboard không còn là trang bắt buộc đầu tiên sau login.

Dashboard sẽ là:

1. Một app/module trên Home Portal, hoặc
2. Màn hình Tổng quan bên trong từng module, hoặc
3. Dashboard mặc định khi người dùng mở module DASH.

### 11.2 Dashboard theo vai trò

| Dashboard | Người dùng chính | Nội dung ưu tiên |
| --- | --- | --- |
| Employee Dashboard | Employee | Chấm công hôm nay, task của tôi, số dư phép, thông báo mới |
| Manager Dashboard | Manager | Đơn cần duyệt, task team, bất thường chấm công, lịch nghỉ team |
| HR Dashboard | HR | Tổng nhân sự, hợp đồng sắp hết hạn, đơn nghỉ, bảng công, cảnh báo HR |
| Admin Dashboard | Admin | User active, role/permission, module status, cấu hình, audit |

### 11.3 Dashboard không xử lý nghiệp vụ gốc

Dashboard chỉ hiển thị, tổng hợp và điều hướng.

Ví dụ:

| Action trên Dashboard | API/module xử lý thật |
| --- | --- |
| Check-in | ATT |
| Tạo đơn nghỉ | LEAVE |
| Duyệt đơn nghỉ | LEAVE |
| Duyệt điều chỉnh công | ATT |
| Tạo task | TASK |
| Xem hồ sơ nhân viên | HR |
| Mark notification read | NOTI |

### 11.4 Widget state

Mỗi widget cần có đủ state:

1. Loading.
2. Loaded.
3. Empty.
4. Error.
5. Forbidden.
6. No data due to scope.
7. Stale cache nếu dùng cache.

---

## 12. UI theo permission và data scope

### 12.1 Nguyên tắc chung

Frontend có nhiệm vụ cải thiện trải nghiệm bằng cách ẩn/hiện menu, action và dữ liệu theo quyền. Tuy nhiên frontend không phải lớp bảo mật cuối cùng. Backend vẫn phải kiểm tra authentication, permission, data scope và business rule.

### 12.2 UI permission behavior

| Trường hợp | UI behavior |
| --- | --- |
| Không có quyền truy cập app | Ẩn app trên Home Portal và App Switcher |
| Không có quyền xem menu | Ẩn menu trong sidebar |
| Có quyền xem nhưng không có quyền tạo | Hiển thị danh sách, ẩn nút tạo |
| Có quyền xem nhưng không có quyền sửa | Hiển thị detail read-only |
| Có quyền thao tác nhưng business rule không cho phép | Disable action + tooltip lý do |
| Token hết hạn | Redirect login hoặc refresh token theo AUTH rule |
| API trả 403 | Hiển thị forbidden state thân thiện |
| Dữ liệu nhạy cảm bị hạn chế | Mask hoặc ẩn field theo field-level permission |

### 12.3 Data scope behavior

| Scope | UI behavior |
| --- | --- |
| Own | Chỉ hiển thị dữ liệu cá nhân |
| Team | Hiển thị dữ liệu nhân viên thuộc team |
| Department | Hiển thị dữ liệu theo phòng ban |
| Project | Hiển thị dữ liệu thuộc dự án liên quan |
| Company | Hiển thị dữ liệu toàn công ty |
| System | Hiển thị dữ liệu liên công ty/toàn hệ thống nếu có màn hình riêng |

---

## 13. Design System Direction

### 13.1 Phong cách thiết kế

Hệ thống nên theo phong cách:

```text
Enterprise SaaS hiện đại
Sạch, rõ ràng, chuyên nghiệp
Thân thiện với dữ liệu lớn
Có cảm giác ecosystem/app platform
```

### 13.2 Nguyên tắc thị giác

1. Home Portal có thể sáng tạo hơn, dùng icon lớn, nền đẹp, app grid.
2. Module Workspace cần thực dụng hơn, ưu tiên khả năng đọc dữ liệu.
3. Màu sắc phải nhất quán theo design token.
4. Không dùng quá nhiều màu cho action quan trọng.
5. Trạng thái cần rõ: success, warning, danger, info, disabled.
6. Bảng và form phải dễ quét bằng mắt.
7. Widget phải có spacing đủ thoáng.

### 13.3 Component nền tảng

| Nhóm | Component |
| --- | --- |
| Layout | Home Portal, Module Workspace, App Switcher, Sidebar, Topbar |
| Navigation | Breadcrumb, Tabs, Menu, App card, Category chip |
| Form | Input, Select, Date picker, Time picker, Textarea, Upload, Switch |
| Data | Table, Card, Badge, Avatar, Timeline, Empty state |
| Feedback | Toast, Alert, Modal, Confirm dialog, Drawer |
| Dashboard | Metric card, Chart card, List widget, Quick action card |
| Permission | Forbidden page, Disabled action, Masked field, Locked app |
| Workflow | Approval box, Comment thread, Activity log, Status stepper |

### 13.4 Icon system

Mỗi module cần có icon riêng để dùng thống nhất ở:

1. Home Portal.
2. App Switcher.
3. Module sidebar/header.
4. Notification target.
5. Breadcrumb nếu cần.

Gợi ý màu icon theo module:

| Module | Màu gợi ý |
| --- | --- |
| HR | Blue |
| ATT | Orange |
| LEAVE | Green/Teal |
| TASK | Purple/Blue |
| NOTI | Indigo |
| AUTH/System | Slate/Gray |
| DASH | Blue/Violet |
| FOUNDATION | Gray/Neutral |

Lưu ý: màu gợi ý cần được chốt lại trong UI-05 Design System, không hard-code tùy tiện.

---

## 14. UI State chuẩn toàn hệ thống

### 14.1 Loading state

Dùng khi đang tải dữ liệu:

1. Skeleton cho table/widget/card.
2. Spinner nhỏ cho button action.
3. Không dùng loading toàn trang nếu chỉ một widget đang tải.

### 14.2 Empty state

Dùng khi không có dữ liệu:

| Màn hình | Empty message gợi ý |
| --- | --- |
| Danh sách nhân viên | Chưa có nhân viên nào |
| Task của tôi | Bạn chưa có công việc nào |
| Đơn nghỉ | Chưa có đơn nghỉ phép |
| Thông báo | Bạn chưa có thông báo mới |
| App search | Không tìm thấy ứng dụng phù hợp |

### 14.3 Error state

Dùng khi API lỗi:

1. Hiển thị message thân thiện.
2. Có nút Thử lại.
3. Không làm mất dữ liệu cũ nếu có cache.
4. Với widget, lỗi ở widget nào chỉ ảnh hưởng widget đó.

### 14.4 Forbidden state

Dùng khi user không có quyền:

```text
Bạn không có quyền truy cập nội dung này.
Vui lòng liên hệ quản trị viên nếu bạn cần quyền truy cập.
```

Không hiển thị thông tin nhạy cảm trong forbidden state.

### 14.5 Disabled state

Dùng khi user có quyền nhìn thấy action nhưng chưa đủ điều kiện nghiệp vụ.

Ví dụ:

| Action | Lý do disabled |
| --- | --- |
| Check-in | Bạn đã có đơn nghỉ cả ngày được duyệt |
| Gửi đơn nghỉ | Thiếu loại nghỉ hoặc thời gian nghỉ |
| Duyệt đơn | Đơn không còn ở trạng thái Pending |
| Sửa hồ sơ | Hồ sơ đang có yêu cầu cập nhật chờ duyệt |

---

## 15. Responsive và Mobile-ready Guideline

### 15.1 Desktop first cho MVP

MVP ưu tiên web desktop trước vì các nghiệp vụ HR, bảng công, task và cấu hình cần không gian lớn.

Breakpoint đề xuất:

| Thiết bị | Width |
| --- | --- |
| Mobile | < 768px |
| Tablet | 768px - 1023px |
| Desktop | 1024px - 1439px |
| Large desktop | >= 1440px |

### 15.2 Home Portal responsive

| Thiết bị | Cách hiển thị |
| --- | --- |
| Desktop | App grid nhiều cột, background đầy đủ |
| Tablet | App grid ít cột, category scroll ngang |
| Mobile | App grid 2 cột hoặc list, App Switcher fullscreen |

### 15.3 Module Workspace responsive

| Thiết bị | Cách hiển thị |
| --- | --- |
| Desktop | Sidebar trái cố định/collapse, content rộng |
| Tablet | Sidebar collapse mặc định, mở bằng icon |
| Mobile | Sidebar chuyển thành drawer, table chuyển card/list nếu cần |

### 15.4 App Switcher responsive

| Thiết bị | Cách hiển thị |
| --- | --- |
| Desktop | Modal hoặc side panel lớn |
| Tablet | Modal gần fullscreen |
| Mobile | Fullscreen overlay |

---

## 16. Accessibility và usability

### 16.1 Nguyên tắc accessibility

1. Text đủ contrast.
2. Button có focus state.
3. Có thể dùng bàn phím để tab qua control chính.
4. Icon quan trọng phải có label hoặc tooltip.
5. Không dùng màu làm tín hiệu duy nhất cho trạng thái.
6. Form error phải hiển thị gần field lỗi.
7. App Switcher search phải focus ngay khi mở.

### 16.2 Nguyên tắc usability

1. Action chính của mỗi màn hình phải rõ.
2. Không đặt quá nhiều action ngang hàng.
3. Các thao tác nguy hiểm cần confirm modal.
4. Form dài nên chia section hoặc tabs.
5. Table nhiều cột cần có sticky header hoặc column priority.
6. Filter đã áp dụng phải dễ nhìn và dễ reset.
7. Trạng thái nghiệp vụ phải dùng badge thống nhất.

---

## 17. Route và URL strategy

### 17.1 Route Home Portal

```text
/home
```

Hoặc nếu muốn Home là root sau login:

```text
/app
```

### 17.2 Route module

Gợi ý route theo module:

```text
/app/hr
/app/attendance
/app/leave
/app/tasks
/app/dashboard
/app/notifications
/app/system
```

### 17.3 Route màn hình con

Ví dụ HR:

```text
/app/hr/overview
/app/hr/employees
/app/hr/employees/:employeeId
/app/hr/departments
/app/hr/profile-change-requests
/app/hr/settings/employee-code
```

Ví dụ ATT:

```text
/app/attendance/overview
/app/attendance/today
/app/attendance/my-records
/app/attendance/records
/app/attendance/adjustment-requests
/app/attendance/shifts
/app/attendance/rules
```

Ví dụ LEAVE:

```text
/app/leave/overview
/app/leave/me/balances
/app/leave/me/requests
/app/leave/requests/new
/app/leave/approvals
/app/leave/calendar
/app/leave/settings/types
/app/leave/settings/policies
```

Ví dụ TASK:

```text
/app/tasks/overview
/app/tasks/projects
/app/tasks/projects/:projectId
/app/tasks/my-tasks
/app/tasks/kanban
/app/tasks/:taskId
```

### 17.4 Deep link rule

1. User mở deep link phải kiểm tra login.
2. Nếu chưa login, redirect login rồi quay lại link cũ sau khi đăng nhập.
3. Nếu đã login nhưng không có quyền, hiển thị forbidden hoặc redirect Home Portal.
4. Nếu app/module không tồn tại, hiển thị not found.

---

## 18. Mapping UI với API

### 18.1 Nguyên tắc mapping

1. UI không tự xử lý business rule phức tạp nếu backend đã có API.
2. UI chỉ dùng permission/data scope do backend trả về để hiển thị phù hợp.
3. Mọi action quan trọng phải gọi API module gốc.
4. Dashboard/App Switcher chỉ tổng hợp và điều hướng, không sửa dữ liệu nghiệp vụ gốc.

### 18.2 API cần hỗ trợ cho Home Portal/App Switcher

Để triển khai bố cục mới, backend/API nên có hoặc bổ sung endpoint tương ứng:

```http
GET /api/v1/auth/me
GET /api/v1/auth/me/permissions
GET /api/v1/foundation/modules/my-apps
GET /api/v1/foundation/modules/recent-apps
POST /api/v1/foundation/modules/{module_code}/open
POST /api/v1/foundation/modules/{module_code}/favorite
DELETE /api/v1/foundation/modules/{module_code}/favorite
```

Nếu chưa có API riêng cho app registry, frontend có thể tạm cấu hình local theo permission, nhưng giải pháp chính thức nên để backend trả danh sách app theo quyền.

---

## 19. Roadmap tài liệu UI/UX tiếp theo

Sau UI-01, cần triển khai các tài liệu sau:

| Mã tài liệu | Tên tài liệu | Nội dung chính |
| --- | --- | --- |
| UI-02 | Information Architecture & Sitemap | Sitemap Home Portal, App Switcher, Module Workspace, route tree |
| UI-03 | User Flow MVP | Login, mở app, đổi app, check-in, xin nghỉ, duyệt, task, notification |
| UI-04 | Screen List & Wireframe Plan | Danh sách màn hình MVP, ưu tiên wireframe |
| UI-05 | Design System & Component Library | Token, màu, typography, component, icon, state |
| UI-06 | Home Portal & App Switcher UI Design | Thiết kế chi tiết Home Portal và App Switcher |
| UI-07 | Module Workspace Template Design | Template chung cho sidebar/topbar/page/table/form |
| UI-08 | Dashboard UI/UX Design | Employee/Manager/HR/Admin dashboard và widget |
| UI-09 | Module UI Design | AUTH, HR, ATT, LEAVE, TASK, NOTI screen detail |
| UI-10 | Prototype & Frontend Handoff Guide | Prototype, annotation, API mapping, responsive, acceptance checklist |

---

## 20. Roadmap triển khai UI/UX theo sprint

### Sprint UI/UX 1 - Chốt layout nền tảng

1. Home Portal wireframe.
2. Module Workspace wireframe.
3. App Switcher wireframe.
4. Global topbar.
5. Sidebar pattern.
6. App card pattern.
7. Permission state cơ bản.

### Sprint UI/UX 2 - Design System nền

1. Color token.
2. Typography.
3. Spacing.
4. Button.
5. Form.
6. Table.
7. Badge.
8. Modal/drawer.
9. Empty/error/loading state.

### Sprint UI/UX 3 - Home Portal + App Switcher high-fidelity

1. Home Portal desktop.
2. Home Portal responsive.
3. App Switcher desktop.
4. App Switcher mobile/fullscreen.
5. App search state.
6. App permission/locked/beta state.

### Sprint UI/UX 4 - Module Workspace template

1. HR Workspace template.
2. ATT Workspace template.
3. LEAVE Workspace template.
4. TASK Workspace template.
5. NOTI Workspace template.
6. SYSTEM Workspace template.

### Sprint UI/UX 5 - Core screens MVP

1. Login.
2. Employee Dashboard.
3. HR employee list/detail.
4. Attendance today.
5. Leave request create/approve.
6. Task list/detail/Kanban.
7. Notification dropdown/list.

### Sprint UI/UX 6 - Prototype & handoff

1. Clickable prototype.
2. Interaction annotation.
3. Responsive annotation.
4. Component naming.
5. API mapping.
6. Permission matrix.
7. Acceptance checklist.

---

## 21. Checklist nghiệm thu UI-01

UI-01 được xem là đạt khi đáp ứng các tiêu chí sau:

| STT | Tiêu chí | Trạng thái |
| --- | --- | --- |
| 1 | Chốt sau login vào Home Portal |  |
| 2 | Chốt vào module dùng Module Workspace Layout |  |
| 3 | Chốt có nút Ứng dụng mở App Switcher |  |
| 4 | Định nghĩa rõ 3 layout: Home Portal, Module Workspace, App Switcher |  |
| 5 | Có flow điều hướng Login -> Home -> Module -> App Switcher |  |
| 6 | Có rule hiển thị app theo permission |  |
| 7 | Có định hướng sidebar theo từng module |  |
| 8 | Có nguyên tắc dashboard sau cập nhật bố cục |  |
| 9 | Có UI state chuẩn: loading, empty, error, forbidden, disabled |  |
| 10 | Có responsive guideline |  |
| 11 | Có route strategy |  |
| 12 | Có roadmap tài liệu UI tiếp theo |  |
| 13 | Có roadmap sprint UI/UX |  |

---

## 22. Kết luận

Phiên bản UI-01 cập nhật chốt kiến trúc trải nghiệm mới cho hệ thống:

```text
Home Portal sau đăng nhập
  -> Module Workspace khi vào từng ứng dụng
  -> App Switcher để chuyển nhanh toàn bộ ứng dụng
```

Kiến trúc này phù hợp với định hướng hệ thống quản lý doanh nghiệp dạng nền tảng all-in-one, giúp sản phẩm:

1. Dễ mở rộng nhiều module trong tương lai.
2. Dễ dùng hơn cho người mới.
3. Tách rõ trải nghiệm điều hướng tổng và trải nghiệm nghiệp vụ chi tiết.
4. Tạo cảm giác chuyên nghiệp như một hệ sinh thái ứng dụng doanh nghiệp.
5. Giữ được nguyên tắc bảo mật theo permission và data scope.
6. Giúp frontend có layout chuẩn để triển khai đồng bộ toàn hệ thống.

