# KẾ HOẠCH CHIA PHASE PHÁT TRIỂN

## MediaOS — Internal MVP → SaaS Ready

---

# 1. Nguyên tắc chia phase

MediaOS là hệ thống lớn, không nên làm tất cả cùng lúc. Cần chia theo thứ tự phụ thuộc:

```text
Nền tảng hệ thống
→ Tổ chức & phân quyền
→ Kênh / Project / Content
→ Workflow / Task
→ Duyệt / Trả sửa / KPI
→ Chat / Notification / Mobile
→ HR / Payroll / Finance
→ Báo cáo / Tối ưu / SaaS
```

Nguyên tắc ưu tiên:

1. **Làm core vận hành trước**, chưa cần đẹp hoàn hảo.
2. **Web app trước, mobile app song song bản tối giản**.
3. **Workflow + Task là lõi sản xuất**, cần ưu tiên cao.
4. **Phân quyền phải làm sớm**, vì ảnh hưởng toàn hệ thống.
5. **Tài chính, lương, KPI làm sau khi task/workflow có dữ liệu thật**.
6. **SaaS chưa làm ngay**, nhưng database và kiến trúc phải sẵn sàng.

---

# 2. Tổng quan các phase

```text
Phase 0: Product Foundation & System Design
Phase 1: Core Platform — User, Organization, Permission
Phase 2: Media Core — Channel, Project, Content
Phase 3: Workflow & Task Engine
Phase 4: Approval, Revision, Evaluation, KPI
Phase 5: Chat, Notification, Meeting, Mobile Core
Phase 6: HR, Attendance, Leave, Payroll
Phase 7: Finance, Cost Allocation, Profit
Phase 8: Dashboard, Report, Internal Rollout
Phase 9: Stabilization & SaaS Preparation
```

---

# 3. Phase 0 — Product Foundation & System Design

## Mục tiêu

Chốt nền móng sản phẩm trước khi code.

## Công việc chính

* Chốt MVP requirement
* Chốt module list
* Chốt role & permission matrix
* Chốt ERD database
* Chốt workflow mẫu
* Chốt sitemap web/mobile
* Chốt UI wireframe cơ bản
* Chốt tech stack
* Chốt coding convention
* Chốt môi trường dev/staging/production
* Chốt quy trình QA/test

## Đầu ra

```text
Product Requirement Document
Module Architecture
Permission Matrix
Database ERD
Workflow Template
Web/Mobile Sitemap
Low-fidelity Wireframe
Technical Architecture
Development Backlog
```

## Tiêu chí nghiệm thu

* Đội dev hiểu rõ scope.
* Đội UI/UX có đủ màn hình để thiết kế.
* Đội backend có ERD để tạo schema.
* Đội frontend có sitemap để dựng layout.
* Đội quản lý biết phase nào làm trước/sau.

---

# 4. Phase 1 — Core Platform

## Tên phase

**Core Platform — User, Organization, Permission**

## Mục tiêu

Tạo nền tảng hệ thống: công ty, người dùng, phòng ban, team, chức vụ, role, permission.

## Module cần làm

### 1. Authentication

* Đăng nhập
* Đăng xuất
* Quên mật khẩu
* Đổi mật khẩu
* Session/token
* 2FA cơ bản cho tài khoản nhạy cảm nếu cần

### 2. Company Setup

* Thông tin công ty
* Logo
* Múi giờ
* Tiền tệ
* Ngôn ngữ
* Cấu hình ngày làm việc
* Cấu hình kỳ lương cơ bản

### 3. Organization

* Phòng ban/khối dạng cây
* Team/ekip
* Chức vụ
* Sơ đồ tổ chức

### 4. Employee

* Tạo nhân sự
* Import nhân sự
* Hồ sơ nhân sự
* Gán phòng ban
* Gán team
* Gán chức vụ
* Gán quản lý trực tiếp
* Trạng thái nhân sự

### 5. Role & Permission

* Role mặc định
* Permission theo module/action
* Scope theo công ty/phòng ban/team/project/kênh
* Gán role cho user
* Gán quyền đặc biệt cơ bản

### 6. Audit Log cơ bản

* Log đăng nhập
* Log thay đổi user
* Log thay đổi role/permission
* Log thay đổi phòng ban/team

## Màn hình Web

```text
Login
Company Settings
Organization Chart
Department List
Team List
Position List
Employee List
Employee Detail
Role List
Permission Matrix
User Role Assignment
Audit Log
```

## Màn hình Mobile

```text
Login
Profile cơ bản
Thông tin cá nhân
```

## Database chính

```text
companies
users
employee_profiles
org_units
positions
teams
team_members
roles
permissions
role_permissions
user_roles
object_permissions
audit_logs
```

## Tiêu chí nghiệm thu

* Tạo được cấu trúc công ty.
* Tạo được phòng ban nhiều cấp.
* Tạo được team.
* Tạo được nhân sự.
* Một nhân sự có thể thuộc nhiều team.
* Gán được role cho user.
* User chỉ thấy menu theo quyền.
* Có audit log khi thay đổi quyền.

## Kết quả cuối phase

Hệ thống có nền tảng người dùng và phân quyền để các phase sau phát triển an toàn.

---

# 5. Phase 2 — Media Core

## Tên phase

**Channel, Project & Content Management**

## Mục tiêu

Quản lý kênh, tài khoản nền tảng, project, video/content.

## Module cần làm

### 1. Platform

* Danh sách nền tảng
* YouTube
* TikTok
* Facebook
* Instagram
* Website
* Podcast

### 2. Channel Management

* Tạo kênh
* Sửa kênh
* Gán nền tảng
* Gán Channel Manager
* Gán team phụ trách
* Trạng thái kênh
* Health status cơ bản

### 3. Platform Account

* Lưu tài khoản liên quan
* Liên kết tài khoản với kênh
* Phân quyền xem tài khoản
* Mã hóa mật khẩu
* Audit log khi xem/sửa tài khoản

### 4. Project Management

* Tạo project
* Loại project
* Project Manager
* Ngày bắt đầu/deadline
* Gắn nhiều kênh
* Gắn nhiều team
* Gắn nhiều thành viên
* Trạng thái project

### 5. Content / Video Management

* Tạo video/content
* Gắn vào project
* Gắn vào một hoặc nhiều kênh
* Chọn content type
* Ngày dự kiến đăng
* Trạng thái sản xuất
* Quản lý asset/link/file

### 6. Content Type

* Tạo loại nội dung
* Gắn workflow mặc định về sau
* Gắn evaluation template về sau

## Màn hình Web

```text
Platform List
Channel List
Channel Detail
Channel Account Tab
Project List
Project Detail
Content List
Content Detail
Content Asset Manager
Content Type List
```

## Màn hình Mobile

```text
Project/Content Quick View
Channel Quick View nếu có quyền
```

## Database chính

```text
platforms
channels
platform_accounts
channel_accounts
channel_members
projects
project_channels
project_teams
project_members
content_types
content_items
content_channels
content_assets
```

## Tiêu chí nghiệm thu

* Tạo được kênh.
* Gán được Channel Manager.
* Lưu được tài khoản kênh có mã hóa.
* Chỉ người có quyền mới xem được tài khoản nhạy cảm.
* Tạo được project có nhiều kênh.
* Tạo được project có nhiều team.
* Tạo được content/video trong project.
* Một content có thể đăng nhiều kênh.
* Có thể upload/link asset cho content.

## Kết quả cuối phase

Hệ thống bắt đầu quản lý được tài sản media cốt lõi: kênh, project, video/content.

---

# 6. Phase 3 — Workflow & Task Engine

## Tên phase

**Workflow Builder, Workflow Instance & Task Management**

## Mục tiêu

Biến project/content thành quy trình làm việc thực tế, có task, deadline, người phụ trách.

## Module cần làm

### 1. Workflow Template

* Tạo workflow
* Tạo bước
* Cấu hình thứ tự
* Cấu hình bước song song/tuần tự
* Cấu hình dependency cơ bản
* Cấu hình người/role thực hiện mặc định
* Cấu hình reviewer mặc định
* Cấu hình checklist
* Cấu hình file bắt buộc

### 2. Workflow Instance

* Áp dụng workflow vào project/content
* Sinh workflow instance
* Sinh step instance
* Theo dõi trạng thái từng bước

### 3. Task Management

* Tạo task thủ công
* Tạo task tự động từ workflow
* Gán người/team
* Deadline
* Priority
* Checklist
* File
* Comment
* Task status
* My Tasks
* Team Tasks
* Project Tasks

### 4. Task Board

* Kanban view
* Table view
* My Tasks
* Waiting Review
* Overdue Tasks
* Revision Tasks về sau

## Màn hình Web

```text
Workflow Template List
Workflow Builder
Workflow Step Config
Workflow Instance View
Task Board
Task Detail Drawer
My Tasks
Team Tasks
Project Tasks
```

## Màn hình Mobile

```text
My Tasks
Task Detail
Submit Work
Comment
Upload file/link
```

## Database chính

```text
workflow_templates
workflow_step_templates
workflow_step_dependencies
workflow_instances
workflow_step_instances
tasks
task_comments
task_attachments
checklists
checklist_items
```

## Tiêu chí nghiệm thu

* Tạo được workflow template.
* Tạo được step trong workflow.
* Có thể cấu hình bước phụ thuộc.
* Có thể cấu hình bước song song cơ bản.
* Áp workflow vào content/project.
* Hệ thống sinh workflow instance.
* Hệ thống sinh task.
* Nhân viên thấy task trong My Tasks.
* Nhân viên nộp sản phẩm.
* Comment/file trong task hoạt động.

## Kết quả cuối phase

Công ty bắt đầu vận hành sản xuất bằng hệ thống thay vì quản lý rời rạc bằng chat/sheet.

---

# 7. Phase 4 — Approval, Revision, Evaluation & KPI

## Tên phase

**Quality Control & Performance Data**

## Mục tiêu

Kiểm soát chất lượng sản phẩm, duyệt nhiều cấp, trả sửa đúng người, chấm điểm và tạo dữ liệu KPI.

## Module cần làm

### 1. Approval

* Approval rule
* Approval request
* Approval steps
* Duyệt 1-3 cấp
* Approval Inbox
* Duyệt trên web
* Duyệt nhanh trên mobile

### 2. Revision / Defect

* Trả sửa
* Chọn bước lỗi
* Chọn người chịu trách nhiệm
* Chọn loại lỗi
* Lỗi cần sửa
* Lỗi nghiêm trọng
* Deadline sửa
* Khóa phần liên quan
* Revision task
* Defect history

### 3. Evaluation

* Evaluation template
* Evaluation criteria
* Chấm điểm từng tiêu chí
* Tổng điểm
* Pass/fail
* Gắn evaluation vào workflow step

### 4. KPI cơ bản

* KPI cá nhân
* KPI task
* KPI deadline
* KPI lỗi
* KPI điểm đánh giá
* Tổng hợp theo tháng
* Xem KPI cá nhân
* Quản lý xem KPI trong scope

## Màn hình Web

```text
Approval Inbox
Approval Detail
Revision / Defect Center
Defect Detail
Evaluation Form Builder
Evaluation Result
KPI Individual
KPI Team Basic
KPI Department Basic
```

## Màn hình Mobile

```text
Approval Inbox
Approve / Reject / Return Revision
Revision Form
KPI cá nhân
```

## Database chính

```text
approval_rules
approval_requests
approval_steps
defects
defect_histories
evaluation_templates
evaluation_criteria
evaluation_results
evaluation_scores
kpi_definitions
kpi_results
performance_reviews
```

## Tiêu chí nghiệm thu

* Người duyệt thấy hàng chờ duyệt.
* Duyệt được 1-3 cấp.
* Trả sửa phải chọn đúng bước và người chịu trách nhiệm.
* Hệ thống tạo revision task.
* Lỗi nghiêm trọng có flag ảnh hưởng KPI/thưởng/phạt.
* Chỉ khóa phần liên quan.
* Chấm điểm được sản phẩm/task.
* KPI cá nhân tổng hợp được từ task, deadline, lỗi, điểm.

## Kết quả cuối phase

Hệ thống không chỉ giao việc mà còn kiểm soát chất lượng và bắt đầu đo hiệu suất nhân sự.

---

# 8. Phase 5 — Communication, Notification, Meeting & Mobile Core

## Tên phase

**Daily Operation Layer**

## Mục tiêu

Đưa giao tiếp nội bộ, thông báo và thao tác mobile vào hệ thống để nhân sự dùng hằng ngày.

## Module cần làm

### 1. Realtime Chat

* Chat 1-1
* Group chat thủ công
* Group chat project
* Group chat kênh
* Group chat phòng ban/team
* Gửi text
* Gửi file/ảnh
* Mention
* Ghim tin cơ bản

### 2. Auto Group Chat

* Tạo project → tự tạo group
* Tạo kênh → tự tạo group
* Thêm thành viên project → thêm vào group
* Rời project → xử lý quyền chat

### 3. Notification Center

* Thông báo task
* Deadline
* Duyệt
* Trả sửa
* Comment/mention
* Họp
* Chấm công/lương/KPI về sau
* Thông báo bắt buộc
* Tùy chỉnh notification theo rule

### 4. Meeting

* Phòng họp vật lý/online
* Tạo cuộc họp
* Mời người tham gia
* Agenda
* Biên bản họp
* Task sau họp

### 5. Mobile Core

* Home
* My Tasks
* Task Detail
* Submit Work
* Approval Inbox
* Revision
* Chat
* Notification
* Meeting
* Profile

## Màn hình Web

```text
Chat
Notification Center
Notification Rule
Meeting Calendar
Meeting Room
Meeting Detail
Meeting Notes
Meeting Tasks
```

## Màn hình Mobile

```text
Home
Task
Submit Work
Approval
Revision
Chat
Notification
Meeting
Profile
```

## Database chính

```text
chat_rooms
chat_members
messages
notifications
notification_rules
notification_preferences
meeting_rooms
meetings
meeting_attendees
meeting_notes
meeting_tasks
```

## Tiêu chí nghiệm thu

* Chat realtime hoạt động.
* Có group thủ công.
* Có group tự động theo project/kênh.
* Notification realtime hoạt động.
* Thông báo bắt buộc không tắt được.
* Tạo được lịch họp.
* Tạo được biên bản họp.
* Tạo task sau họp.
* Mobile xử lý được task, chat, thông báo, duyệt, họp.

## Kết quả cuối phase

Nhân sự bắt đầu dùng MediaOS hằng ngày thay cho chat rời rạc và ghi chú thủ công.

---

# 9. Phase 6 — HR, Attendance, Leave & Payroll

## Tên phase

**HR Operation & Payroll Basic**

## Mục tiêu

Kết nối dữ liệu nhân sự, chấm công, nghỉ phép, KPI với bảng lương, thưởng, phạt.

## Module cần làm

### 1. Attendance

* Check-in/check-out web/mobile
* Ca làm
* Đi muộn/về sớm
* Bảng công ngày/tháng
* Đơn bổ sung công
* Duyệt bổ sung công
* Khóa kỳ công

### 2. Leave

* Loại nghỉ
* Số ngày phép
* Đơn nghỉ phép
* Duyệt nghỉ phép
* Lịch nghỉ team
* Đồng bộ dữ liệu công

### 3. Salary Profile

* Lương cơ bản
* Loại lương
* Chu kỳ trả
* Phụ cấp cơ bản
* Hiệu lực lương

### 4. Payroll

* Kỳ lương
* Tạo bảng lương nháp
* Lấy dữ liệu công
* Lấy dữ liệu KPI
* Lấy thưởng/phạt
* Payslip
* Duyệt bảng lương
* Phát hành payslip
* Nhân viên xác nhận/khiếu nại

### 5. Bonus/Penalty

* Thưởng thủ công
* Phạt thủ công
* Thưởng/phạt từ KPI/lỗi
* Gắn reference task/defect/KPI
* Duyệt thưởng/phạt

## Màn hình Web

```text
Attendance Dashboard
Attendance Monthly Table
Attendance Adjustment Requests
Leave Requests
Leave Calendar
Salary Profile
Payroll Period
Payslip List
Payslip Detail
Bonus/Penalty
Payroll Approval
```

## Màn hình Mobile

```text
Check-in / Check-out
Attendance History
Attendance Adjustment
Leave Request
Payslip
Payslip Confirmation
KPI cá nhân
```

## Database chính

```text
work_schedules
attendance_records
attendance_adjustment_requests
leave_types
leave_requests
leave_balances
salary_profiles
payroll_periods
payslips
payslip_items
bonus_penalties
```

## Tiêu chí nghiệm thu

* Nhân viên chấm công được trên mobile.
* HR xem được bảng công.
* Nhân viên gửi đơn bổ sung công.
* Quản lý/HR duyệt được đơn.
* Nhân viên gửi đơn nghỉ.
* Hệ thống trừ ngày phép.
* Tạo được salary profile.
* Tạo được kỳ lương.
* Tạo được payslip.
* Thưởng/phạt đi vào bảng lương.
* Nhân viên xem và xác nhận bảng lương.

## Kết quả cuối phase

Hệ thống bắt đầu quản lý vòng đời nhân sự hằng tháng: công, phép, KPI, lương, thưởng, phạt.

---

# 10. Phase 7 — Finance, Cost Allocation & Profit

## Tên phase

**Financial Operation Basic**

## Mục tiêu

Quản lý doanh thu, chi phí, phân bổ chi phí và lợi nhuận theo công ty, kênh, project, video.

## Module cần làm

### 1. Revenue

* Nhập doanh thu thủ công
* Gắn doanh thu với nền tảng
* Gắn với kênh
* Gắn với project
* Gắn với video nếu có
* Upload file báo cáo
* Audit log khi sửa/xóa

### 2. Cost

* Nhập chi phí
* Loại chi phí
* Gắn với phòng ban/team
* Gắn với kênh/project/video
* Gắn với nhân sự/vendor
* Upload chứng từ

### 3. Cost Allocation

* Chia đều
* Theo số video
* Theo số task
* Theo phần trăm thủ công
* Theo giờ làm nếu có dữ liệu

### 4. Profit

* Lợi nhuận công ty
* Lợi nhuận kênh
* Lợi nhuận project
* Lợi nhuận video
* Profit snapshot

### 5. Expense Request

* Tạo đề xuất chi
* Duyệt chi nhiều cấp
* Upload báo giá/chứng từ
* Sau duyệt tạo cost record

## Màn hình Web

```text
Revenue List
Revenue Entry Form
Cost List
Cost Entry Form
Cost Allocation
Profit Dashboard
Expense Request
Expense Approval
Finance Report
```

## Màn hình Mobile

```text
Expense Request cơ bản
Expense Approval cơ bản cho quản lý
Thông báo tài chính
```

## Database chính

```text
revenue_records
cost_records
cost_allocations
profit_snapshots
expense_requests
expense_approvals
```

## Tiêu chí nghiệm thu

* Nhập được doanh thu theo kênh/project/video.
* Nhập được chi phí theo nhiều chiều.
* Có chứng từ/file đính kèm.
* Phân bổ chi phí cơ bản.
* Tính lợi nhuận theo kênh/project/video.
* Tạo và duyệt đề xuất chi.
* Dữ liệu tài chính chỉ hiển thị theo quyền.
* Sửa/xóa tài chính ghi audit log.

## Kết quả cuối phase

Ban lãnh đạo bắt đầu biết kênh nào lãi/lỗ, project nào tốn chi phí, video nào hiệu quả.

---

# 11. Phase 8 — Dashboard, Report & Internal Rollout

## Tên phase

**Management Visibility & Internal Adoption**

## Mục tiêu

Tối ưu dashboard, báo cáo và triển khai nội bộ theo từng nhóm người dùng.

## Module cần làm

### 1. Dashboard lãnh đạo

* Tổng quan công ty
* Sản xuất
* Kênh
* Tài chính
* Nhân sự
* KPI
* Cảnh báo

### 2. Dashboard quản lý

* Project phụ trách
* Task team
* Video chờ duyệt
* Task trễ
* Lỗi
* KPI team
* Tiến độ workflow

### 3. Dashboard nhân viên

* Task hôm nay
* Task cần sửa
* Lịch họp
* Chấm công
* KPI
* Thông báo bắt buộc

### 4. Dashboard HR

* Chấm công thiếu
* Nghỉ phép
* KPI nhân sự
* Thưởng/phạt
* Bảng lương

### 5. Dashboard Finance

* Doanh thu
* Chi phí
* Lợi nhuận
* Đề xuất chi
* Bảng lương
* Cảnh báo chi phí

### 6. Internal Rollout

* Pilot một phòng ban
* Pilot một số kênh
* Pilot một số project
* Thu feedback
* Chỉnh UI/UX
* Sửa lỗi nghiệp vụ
* Tạo tài liệu hướng dẫn
* Đào tạo người dùng

## Màn hình Web

```text
Leadership Dashboard
Manager Dashboard
Employee Dashboard
HR Dashboard
Finance Dashboard
Channel Report
Project Report
Content Production Report
KPI Report
```

## Màn hình Mobile

```text
Home Dashboard
Personal KPI
Task Summary
Notification Summary
```

## Tiêu chí nghiệm thu

* Mỗi nhóm user có dashboard riêng.
* Dashboard chỉ hiển thị dữ liệu theo quyền.
* Có cảnh báo task trễ, lỗi nghiêm trọng, kênh rủi ro.
* Có report project/kênh cơ bản.
* Pilot team sử dụng được trong vận hành thật.
* Có tài liệu hướng dẫn nội bộ.
* Có feedback loop để cải tiến.

## Kết quả cuối phase

MediaOS chuyển từ “phần mềm đang build” sang “công cụ vận hành nội bộ thực tế”.

---

# 12. Phase 9 — Stabilization & SaaS Preparation

## Tên phase

**Hardening, Optimization & SaaS Ready**

## Mục tiêu

Ổn định hệ thống, tối ưu hiệu năng, bảo mật và chuẩn bị đóng gói SaaS.

## Module/công việc cần làm

### 1. Stabilization

* Fix bug vận hành thật
* Tối ưu query
* Tối ưu dashboard
* Tối ưu notification
* Tối ưu mobile
* Kiểm tra phân quyền
* Kiểm tra audit log
* Backup/restore

### 2. Security Hardening

* 2FA nâng cao
* Log truy cập nhạy cảm
* Cảnh báo bảo mật
* Mã hóa dữ liệu nhạy cảm
* Kiểm tra quyền theo scope
* Kiểm tra leak dữ liệu

### 3. SaaS Preparation

* Multi-tenant isolation
* Workspace/company management
* Subscription plan design
* Feature flag
* Usage limit
* Trial workspace
* Template workflow
* Template role
* Template dashboard
* Billing chuẩn bị sau

### 4. Integration Preparation

* YouTube API planning
* AdSense API planning
* TikTok/Facebook planning
* Google Drive integration planning
* Email notification planning
* SSO planning

## Tiêu chí nghiệm thu

* Hệ thống chạy ổn với dữ liệu thực tế.
* Không lỗi nghiêm trọng về phân quyền.
* Dashboard tải ổn.
* Chat/notification ổn định.
* Dữ liệu nhạy cảm được bảo vệ.
* Database đã sẵn sàng multi-tenant.
* Có thể clone template cho công ty khác trong tương lai.

## Kết quả cuối phase

MediaOS sẵn sàng bước sang giai đoạn SaaS productization.

---

# 13. Thứ tự release khuyến nghị

Không nên chờ xong toàn bộ mới dùng. Nên release nội bộ theo từng mốc.

## Release 1 — Admin Internal

Bao gồm:

```text
Login
Company
Organization
Employee
Role & Permission
Audit Log cơ bản
```

Người dùng chính:

```text
Admin
HR
Ban lãnh đạo
```

---

## Release 2 — Media Management

Bao gồm:

```text
Channel
Platform Account
Project
Content/Video
Content Asset
```

Người dùng chính:

```text
Channel Manager
Project Manager
Production Manager
```

---

## Release 3 — Production Operation

Bao gồm:

```text
Workflow
Task
My Tasks
Task Comment
Submit Work
```

Người dùng chính:

```text
Trưởng dự án
Team leader
Nhân viên sản xuất
Freelancer
```

---

## Release 4 — Quality Control

Bao gồm:

```text
Approval
Revision
Defect
Evaluation
KPI cơ bản
```

Người dùng chính:

```text
QA
Team Leader
Project Manager
Trưởng phòng
```

---

## Release 5 — Daily Communication

Bao gồm:

```text
Chat
Notification
Meeting
Mobile Core
```

Người dùng chính:

```text
Tất cả nhân sự
```

---

## Release 6 — HR & Payroll

Bao gồm:

```text
Chấm công
Nghỉ phép
Salary Profile
Payroll
Bonus/Penalty
Payslip
```

Người dùng chính:

```text
HR
Kế toán
Quản lý
Nhân viên
```

---

## Release 7 — Finance & Profit

Bao gồm:

```text
Revenue
Cost
Cost Allocation
Profit
Expense Request
Finance Dashboard
```

Người dùng chính:

```text
Kế toán
Finance Manager
CFO
Ban lãnh đạo
Channel Manager
```

---

## Release 8 — Full Internal Rollout

Bao gồm:

```text
Dashboard đầy đủ
Report
Training nội bộ
Pilot toàn công ty
Tối ưu theo feedback
```

Người dùng chính:

```text
Toàn công ty
```

---

# 14. Gợi ý chia sprint backlog

## Epic 1 — Core Platform

```text
User login
Company settings
Organization unit
Team
Position
Employee profile
Role
Permission
Scope permission
Audit log
```

## Epic 2 — Channel & Account

```text
Platform
Channel
Channel member
Platform account
Channel account relation
Sensitive access
Channel health basic
```

## Epic 3 — Project & Content

```text
Project
Project channel
Project team
Project member
Content type
Content item
Content channel
Content asset
```

## Epic 4 — Workflow

```text
Workflow template
Workflow step template
Step dependency
Workflow instance
Step instance
Auto task generation
Workflow timeline
```

## Epic 5 — Task

```text
Task board
My tasks
Task detail
Task comments
Task attachments
Checklist
Submit work
Overdue logic
```

## Epic 6 — Approval & Revision

```text
Approval rules
Approval requests
Approval steps
Approval inbox
Return revision
Defect
Defect history
Lock related scope
Revision task
```

## Epic 7 — Evaluation & KPI

```text
Evaluation template
Criteria
Evaluation result
Evaluation score
KPI definition
KPI result
KPI dashboard
```

## Epic 8 — Chat & Notification

```text
Chat room
Chat member
Message
Auto group chat
Notification event
Notification center
Notification rule
Notification preference
Push notification
```

## Epic 9 — HR & Payroll

```text
Work schedule
Attendance
Attendance adjustment
Leave type
Leave request
Leave balance
Salary profile
Payroll period
Payslip
Payslip item
Bonus/penalty
```

## Epic 10 — Finance

```text
Revenue record
Cost record
Cost allocation
Profit snapshot
Expense request
Expense approval
Finance dashboard
```

## Epic 11 — Meeting

```text
Meeting room
Meeting
Attendees
Meeting note
Meeting task
Calendar view
```

## Epic 12 — Mobile

```text
Mobile login
Mobile home
Mobile task
Mobile submit work
Mobile approval
Mobile revision
Mobile chat
Mobile notification
Mobile attendance
Mobile leave
Mobile payslip
```

---

# 15. Đề xuất đội phát triển tối thiểu

Để làm MediaOS đúng hướng, đội tối thiểu nên có:

```text
1 Product Owner
1 Business Analyst
1 UI/UX Designer
1 Tech Lead / Architect
2-3 Backend Developers
2 Frontend Web Developers
1-2 Mobile Developers
1 QA Tester
1 DevOps/Cloud Engineer bán thời gian
```

Nếu muốn đi nhanh hơn:

```text
1 Product Owner
2 BA
2 UI/UX
1 Architect
4 Backend
3 Frontend
2 Mobile
2 QA
1 DevOps
```

---

# 16. Rủi ro theo từng phase

## Phase 1 Risk

Rủi ro: phân quyền làm quá phức tạp ngay từ đầu.

Cách xử lý:

```text
MVP dùng role cốt lõi trước.
Object permission làm tối thiểu cho dữ liệu nhạy cảm.
```

---

## Phase 2 Risk

Rủi ro: dữ liệu kênh/tài khoản nhạy cảm dễ lộ.

Cách xử lý:

```text
Mã hóa mật khẩu.
Tách quyền xem tài khoản.
Audit log bắt buộc.
```

---

## Phase 3 Risk

Rủi ro: workflow builder quá khó.

Cách xử lý:

```text
MVP làm workflow dạng form + dependency đơn giản.
Canvas kéo thả nâng cao để sau.
```

---

## Phase 4 Risk

Rủi ro: KPI chưa chuẩn gây tranh cãi.

Cách xử lý:

```text
Giai đoạn đầu KPI là dữ liệu tham khảo.
HR/quản lý xác nhận trước khi đưa vào lương.
```

---

## Phase 5 Risk

Rủi ro: chat realtime tốn hạ tầng.

Cách xử lý:

```text
Làm text/file/mention trước.
Search nâng cao, voice, call để sau.
```

---

## Phase 6 Risk

Rủi ro: payroll sai gây ảnh hưởng niềm tin.

Cách xử lý:

```text
Bảng lương cần trạng thái draft.
Kế toán/HR duyệt trước khi phát hành.
Audit log mọi thay đổi.
```

---

## Phase 7 Risk

Rủi ro: phân bổ chi phí chưa chính xác.

Cách xử lý:

```text
Cho phép phân bổ thủ công và điều chỉnh.
Lưu snapshot để so sánh.
```

---

# 17. Ưu tiên nếu cần rút gọn MVP

Nếu nguồn lực hạn chế, nên làm MVP theo thứ tự rút gọn:

## Must-have

```text
1. User / Organization / Permission
2. Channel
3. Project / Content
4. Workflow basic
5. Task
6. Approval / Revision
7. Chat / Notification
8. Dashboard basic
```

## Should-have

```text
9. Evaluation / KPI basic
10. Attendance
11. Leave
12. Payroll basic
13. Finance basic
```

## Later

```text
14. Meeting nâng cao
15. Cost allocation nâng cao
16. Channel health nâng cao
17. Mobile mở rộng
18. SaaS billing
19. API integration
```

---

# 18. Kết luận

Lộ trình phát triển MediaOS nên đi theo 4 chặng lớn:

## Chặng 1 — Xây nền

```text
Core Platform
Organization
Employee
Permission
```

## Chặng 2 — Vận hành media

```text
Channel
Project
Content
Workflow
Task
Approval
Revision
```

## Chặng 3 — Quản trị công ty

```text
KPI
HR
Payroll
Finance
Meeting
Dashboard
```

## Chặng 4 — Mở rộng sản phẩm

```text
Optimization
Internal rollout
SaaS ready
API integration
Advanced analytics
```

Nếu làm đúng thứ tự này, hệ thống sẽ không bị vỡ kiến trúc, không bị loạn quyền, không bị hard-code workflow và có thể mở rộng thành SaaS sau khi vận hành nội bộ ổn định.
