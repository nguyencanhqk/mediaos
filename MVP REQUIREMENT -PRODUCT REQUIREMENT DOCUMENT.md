# MVP REQUIREMENT / PRODUCT REQUIREMENT DOCUMENT

## MediaOS — Hệ thống quản trị công ty media đa kênh

### Phiên bản: MVP v1 — Internal Version

---

# 1. Tổng quan sản phẩm

## 1.1. Tên sản phẩm

**MediaOS**

## 1.2. Mục tiêu sản phẩm

MediaOS là hệ thống quản trị nội bộ dành cho công ty media sản xuất nội dung đa kênh, đa nền tảng, có quy mô khoảng:

* 200 nhân sự
* 100 kênh
* 300 video/tháng
* Nhiều phòng ban, nhiều team, nhiều project
* Nhiều hình thức làm việc: offline, remote, hybrid, freelancer
* Nhiều loại nội dung với workflow và tiêu chí đánh giá khác nhau

MVP v1 tập trung giải quyết các vấn đề chính:

1. Quản lý tập trung nhân sự, phòng ban, team, chức vụ, phân quyền.
2. Quản lý kênh, tài khoản nền tảng, project, video/content.
3. Chuẩn hóa quy trình sản xuất nội dung và quy trình văn phòng.
4. Tạo task tự động theo workflow.
5. Duyệt sản phẩm tối đa 3 cấp.
6. Trả sửa đúng người, đúng bước, chỉ khóa phần liên quan.
7. Chấm điểm sản phẩm và liên kết với KPI, thưởng, phạt, lương.
8. Quản lý chấm công, nghỉ phép, bảng lương cơ bản.
9. Quản lý doanh thu, chi phí, phân bổ chi phí và lợi nhuận cơ bản.
10. Có chat realtime, notification, lịch họp và task sau họp.
11. Web app dùng để quản trị đầy đủ, mobile app dùng cho thao tác nhanh.

---

# 2. Phạm vi MVP v1

## 2.1. Có trong MVP v1

MVP v1 gồm các nhóm chức năng chính:

1. Đăng nhập, tài khoản và bảo mật cơ bản
2. Quản lý công ty, phòng ban, team, chức vụ
3. Quản lý nhân sự
4. Role & Permission
5. Quản lý kênh và tài khoản nền tảng
6. Quản lý project và content/video
7. Workflow Builder
8. Task Management
9. Approval & Revision
10. Evaluation & KPI
11. Chấm công, nghỉ phép
12. Lương, thưởng, phạt cơ bản
13. Tài chính cơ bản: doanh thu, chi phí, lợi nhuận
14. Chat realtime
15. Notification Center
16. Meeting và task sau họp
17. Dashboard theo vai trò
18. Audit Log cho hành động quan trọng
19. Web app
20. Mobile app cơ bản

---

## 2.2. Chưa làm sâu trong MVP v1

Các phần sau chưa phải trọng tâm của MVP v1:

1. SaaS billing
2. Multi-company self-service onboarding
3. YouTube API tự động
4. TikTok/Facebook API tự động
5. AI analytics nâng cao
6. LMS đào tạo nội bộ đầy đủ
7. Tuyển dụng ATS đầy đủ
8. Quản lý thiết bị bằng QR nâng cao
9. Document knowledge base nâng cao
10. White-label SaaS
11. Marketplace workflow/template
12. Mobile đầy đủ như web

Tuy nhiên, database và kiến trúc phải được thiết kế sẵn để mở rộng các phần này về sau.

---

# 3. Nhóm người dùng

## 3.1. Company Owner / Ban lãnh đạo

Nhu cầu:

* Xem toàn cảnh công ty
* Xem doanh thu, chi phí, lợi nhuận
* Xem tình trạng sản xuất
* Xem hiệu suất kênh
* Xem KPI nhân sự, phòng ban, project
* Duyệt các vấn đề cấp cao
* Theo dõi rủi ro kênh, tài chính, nhân sự

---

## 3.2. System Admin

Nhu cầu:

* Quản lý cấu hình hệ thống
* Tạo role
* Gán quyền
* Quản lý người dùng
* Kiểm tra audit log
* Cấu hình workflow, notification, bảo mật

---

## 3.3. Department Manager / Trưởng phòng

Nhu cầu:

* Quản lý phòng ban
* Xem nhân sự trong phòng ban
* Quản lý team
* Theo dõi project thuộc phạm vi
* Duyệt công việc theo quyền
* Đánh giá KPI phòng ban/nhân sự
* Đề xuất thưởng/phạt

---

## 3.4. Team Leader

Nhu cầu:

* Giao task cho thành viên team
* Theo dõi tiến độ task
* Duyệt cấp 1
* Trả sửa
* Đánh giá chất lượng công việc
* Theo dõi task trễ, lỗi, năng suất team

---

## 3.5. Project Manager

Nhu cầu:

* Tạo project
* Gắn kênh vào project
* Gắn team/ekip
* Tạo video/content
* Chọn workflow
* Giao task
* Theo dõi tiến độ
* Duyệt sản phẩm
* Trả sửa
* Xem chi phí, KPI project nếu được cấp quyền

---

## 3.6. Channel Manager

Nhu cầu:

* Quản lý kênh
* Theo dõi video/content của kênh
* Theo dõi lịch đăng
* Theo dõi doanh thu/chi phí/lợi nhuận nếu được cấp quyền
* Quản lý trạng thái sức khỏe kênh
* Duyệt upload, thumbnail, SEO theo quyền

---

## 3.7. HR

Nhu cầu:

* Quản lý hồ sơ nhân sự
* Quản lý chấm công
* Quản lý nghỉ phép
* Quản lý KPI nhân sự
* Quản lý thưởng/phạt
* Hỗ trợ bảng lương
* Theo dõi nhân sự mới, nhân sự nghỉ, nhân sự vi phạm

---

## 3.8. Finance / Kế toán

Nhu cầu:

* Nhập doanh thu
* Nhập chi phí
* Quản lý đề xuất chi
* Duyệt/kiểm tra khoản chi
* Quản lý bảng lương
* Theo dõi lợi nhuận
* Xuất báo cáo tài chính theo quyền

---

## 3.9. Employee / Nhân viên

Nhu cầu:

* Nhận task
* Xem deadline
* Nộp sản phẩm
* Nhận feedback
* Sửa lỗi
* Chat với team/project
* Chấm công
* Xin nghỉ phép
* Xem KPI cá nhân
* Xem bảng lương cá nhân

---

## 3.10. Freelancer

Nhu cầu:

* Xem task được giao
* Xem file liên quan được cấp quyền
* Nộp sản phẩm
* Nhận feedback
* Chat trong phạm vi task/project được phân công

---

# 4. Mức ưu tiên requirement

Hệ thống dùng 3 mức ưu tiên:

| Mức | Ý nghĩa                                       |
| --- | --------------------------------------------- |
| P0  | Bắt buộc có trong MVP v1                      |
| P1  | Rất cần, nên có trong MVP v1 hoặc ngay sau P0 |
| P2  | Có thể làm sau MVP v1                         |

---

# 5. Functional Requirements

---

# 5.1. Authentication & Account

## AUTH-001 — Đăng nhập

**Priority:** P0

Người dùng có thể đăng nhập bằng email/số điện thoại và mật khẩu.

Acceptance Criteria:

* Người dùng nhập email/số điện thoại và mật khẩu.
* Hệ thống kiểm tra thông tin hợp lệ.
* Nếu đúng, cho vào hệ thống.
* Nếu sai, hiển thị lỗi.
* Nếu tài khoản bị khóa, không cho đăng nhập.

---

## AUTH-002 — Quên mật khẩu

**Priority:** P1

Người dùng có thể yêu cầu đặt lại mật khẩu.

Acceptance Criteria:

* Người dùng nhập email.
* Hệ thống gửi link/OTP đặt lại mật khẩu.
* Người dùng tạo mật khẩu mới.
* Hệ thống lưu mật khẩu mới đã mã hóa.

---

## AUTH-003 — 2FA cho tài khoản nhạy cảm

**Priority:** P1

Tài khoản có quyền nhạy cảm cần xác thực 2 lớp.

Áp dụng cho:

* Company Owner
* System Admin
* Security Admin
* Finance Manager
* HR Manager
* Người có quyền xem mật khẩu kênh
* Người có quyền duyệt bảng lương

Acceptance Criteria:

* Admin có thể bật 2FA bắt buộc cho role hoặc user.
* Khi đăng nhập, user cần xác thực thêm.
* Hành động nhạy cảm có thể yêu cầu xác thực lại.

---

# 5.2. Company & Organization

## ORG-001 — Quản lý thông tin công ty

**Priority:** P0

Admin có thể cấu hình thông tin công ty.

Dữ liệu:

* Tên công ty
* Logo
* Múi giờ
* Tiền tệ
* Ngôn ngữ
* Cấu hình ngày làm việc
* Cấu hình kỳ lương

Acceptance Criteria:

* Admin xem/sửa được thông tin công ty.
* Thông tin công ty áp dụng cho toàn hệ thống.
* Chỉ user có quyền mới được sửa.

---

## ORG-002 — Quản lý phòng ban/khối dạng cây

**Priority:** P0

Hệ thống cho phép tạo phòng ban, khối, đơn vị con theo mô hình nhiều cấp.

Acceptance Criteria:

* Tạo được phòng ban cha/con.
* Gán được trưởng phòng.
* Gán được nhân sự vào phòng ban.
* Xem được sơ đồ tổ chức dạng cây.
* Có thể bật/tắt trạng thái phòng ban.

---

## ORG-003 — Quản lý team/ekip

**Priority:** P0

Hệ thống cho phép tạo team/ekip độc lập hoặc thuộc phòng ban.

Acceptance Criteria:

* Tạo được team.
* Gán team leader.
* Thêm/xóa thành viên.
* Một nhân sự có thể thuộc nhiều team.
* Team có thể tham gia nhiều project.

---

## ORG-004 — Quản lý chức vụ

**Priority:** P0

Admin/HR có thể tạo và quản lý chức vụ.

Acceptance Criteria:

* Tạo được chức vụ.
* Gán chức vụ cho nhân sự.
* Mỗi chức vụ có mô tả công việc.
* Có thể gắn role mặc định cho chức vụ nếu cần.

---

# 5.3. Employee Management

## EMP-001 — Tạo hồ sơ nhân sự

**Priority:** P0

HR/Admin có thể tạo hồ sơ nhân sự.

Dữ liệu:

* Họ tên
* Email
* Số điện thoại
* Mã nhân viên
* Phòng ban
* Team
* Chức vụ
* Quản lý trực tiếp
* Loại nhân sự
* Hình thức làm việc
* Ngày vào làm
* Trạng thái

Acceptance Criteria:

* Tạo được hồ sơ nhân sự.
* Gán được phòng ban, team, chức vụ.
* Gán được quản lý trực tiếp.
* Tạo được tài khoản đăng nhập nếu cần.
* Nhân sự xuất hiện trong danh sách nhân sự.

---

## EMP-002 — Một nhân sự tham gia nhiều team/project

**Priority:** P0

Hệ thống cho phép một nhân sự tham gia nhiều team và nhiều project.

Acceptance Criteria:

* User có thể thuộc nhiều team.
* User có thể được assign vào nhiều project.
* Trong mỗi project, user có thể có role khác nhau.
* Dashboard cá nhân hiển thị toàn bộ task từ nhiều project.

---

## EMP-003 — Hồ sơ nhân sự chi tiết

**Priority:** P0

Mỗi nhân sự có màn hình chi tiết.

Tabs cần có:

* Tổng quan
* Công việc
* Team/project
* Task
* KPI
* Chấm công
* Nghỉ phép
* Lương
* Thưởng/phạt
* Lịch sử

Acceptance Criteria:

* Người có quyền xem được hồ sơ.
* Nhân viên chỉ xem được dữ liệu cá nhân.
* Lương chỉ hiện với người có quyền.

---

# 5.4. Role & Permission

## PERM-001 — Tạo role

**Priority:** P0

Admin có thể tạo role.

Role mặc định:

* Company Owner
* System Admin
* Board
* Department Manager
* Team Leader
* Project Manager
* Channel Manager
* HR Manager
* Finance Manager
* Employee
* Freelancer

Acceptance Criteria:

* Tạo role mới.
* Sửa role.
* Bật/tắt role.
* Gán role cho user.

---

## PERM-002 — Permission theo module/action

**Priority:** P0

Hệ thống hỗ trợ quyền theo module và hành động.

Hành động gồm:

* View
* Create
* Edit
* Delete
* Approve
* Return Revision
* Export
* Configure
* View Sensitive Data

Acceptance Criteria:

* Admin gán permission vào role.
* User chỉ thấy/chỉ làm được hành động có quyền.
* UI ẩn hoặc khóa các nút không có quyền.

---

## PERM-003 — Scope permission

**Priority:** P0

Role có thể giới hạn theo phạm vi.

Scope gồm:

* Company
* Department
* Team
* Project
* Channel
* Own
* Custom

Acceptance Criteria:

* User có thể là Project Manager của Project A nhưng không có quyền với Project B.
* User có thể là Channel Manager của Channel X nhưng không thấy Channel Y.
* User có thể xem task của team nhưng không xem toàn công ty.

---

## PERM-004 — Object permission cho dữ liệu nhạy cảm

**Priority:** P1

Hệ thống cho phép cấp quyền đặc biệt cho từng object.

Ví dụ:

* Xem tài khoản kênh A trong 24 giờ.
* Xem báo cáo tài chính project B.
* Duyệt bảng lương kỳ C.

Acceptance Criteria:

* Cấp quyền theo object.
* Có thời hạn quyền nếu cần.
* Có lý do cấp quyền.
* Mọi hành động nhạy cảm ghi audit log.

---

# 5.5. Channel Management

## CH-001 — Tạo và quản lý kênh

**Priority:** P0

Người có quyền có thể tạo và quản lý kênh.

Dữ liệu:

* Tên kênh
* Nền tảng
* Link kênh
* Ngôn ngữ
* Quốc gia target
* Ngách
* Channel Manager
* Team phụ trách
* Trạng thái
* Health status

Acceptance Criteria:

* Tạo được kênh.
* Sửa được thông tin kênh.
* Gán Channel Manager.
* Gán team phụ trách.
* Lọc kênh theo nền tảng, trạng thái, manager.

---

## CH-002 — Quản lý tài khoản nền tảng

**Priority:** P0

Hệ thống lưu tài khoản liên quan đến kênh.

Dữ liệu:

* Gmail chính
* Gmail phụ
* Google Account
* YouTube Account
* AdSense
* Analytics
* Recovery email
* Recovery phone
* 2FA note
* Mật khẩu mã hóa

Acceptance Criteria:

* Chỉ người có quyền mới xem được thông tin nhạy cảm.
* Mật khẩu không lưu plain text.
* Mọi lần xem/sửa tài khoản phải ghi audit log.
* Có thể liên kết nhiều tài khoản với một kênh.

---

## CH-003 — Channel Health

**Priority:** P1

Hệ thống cho phép theo dõi sức khỏe kênh.

Chỉ số:

* Health score
* Health status
* View trend
* Subscriber trend
* Revenue trend
* Upload consistency
* Risk note
* Copyright/account warning

Acceptance Criteria:

* Channel Manager có thể cập nhật health status.
* Hệ thống hiển thị kênh cần chú ý.
* Dashboard lãnh đạo thấy kênh rủi ro.

---

# 5.6. Project Management

## PRJ-001 — Tạo project

**Priority:** P0

Người có quyền có thể tạo project.

Loại project:

* Content Production
* Channel Operation
* Growth Campaign
* Recruitment
* Training
* Finance
* Office Internal
* Equipment

Acceptance Criteria:

* Tạo được project.
* Gán Project Manager.
* Gán ngày bắt đầu/deadline.
* Gán trạng thái, priority.
* Project xuất hiện trong danh sách.

---

## PRJ-002 — Project có nhiều kênh

**Priority:** P0

Một project có thể liên kết nhiều kênh.

Acceptance Criteria:

* Gắn được nhiều kênh vào project.
* Một kênh có thể nằm trong nhiều project.
* Project detail hiển thị danh sách kênh liên quan.

---

## PRJ-003 — Project có nhiều team/ekip

**Priority:** P0

Một project có thể có nhiều team/ekip tham gia.

Acceptance Criteria:

* Gắn được nhiều team vào project.
* Gán role của team trong project.
* Xem được team nào phụ trách phần nào.

---

## PRJ-004 — Project có nhiều thành viên

**Priority:** P0

Một project có thể có nhiều thành viên, mỗi thành viên có role riêng.

Acceptance Criteria:

* Thêm user vào project.
* Gán role trong project.
* Gán workload nếu cần.
* User chỉ thấy project theo quyền.

---

# 5.7. Content / Video Management

## CNT-001 — Tạo content/video trong project

**Priority:** P0

Người có quyền có thể tạo content/video thuộc project.

Dữ liệu:

* Tên content/video
* Loại nội dung
* Project
* Kênh chính
* Kênh/nền tảng đăng
* Người phụ trách
* Deadline
* Ngày dự kiến đăng
* Trạng thái sản xuất

Acceptance Criteria:

* Tạo được video/content.
* Gắn được vào project.
* Gắn được vào một hoặc nhiều kênh.
* Chọn được content type.
* Hệ thống gợi ý workflow theo content type.

---

## CNT-002 — Content đăng đa kênh/đa nền tảng

**Priority:** P0

Một content có thể được đăng trên nhiều kênh/nền tảng.

Acceptance Criteria:

* Gắn nhiều kênh vào một content.
* Mỗi kênh có lịch đăng riêng.
* Mỗi kênh có publish status riêng.
* Lưu được link sau khi đăng.

---

## CNT-003 — Quản lý asset của content

**Priority:** P0

Mỗi content có thể có nhiều file/link.

Asset type:

* Script
* Voice
* Raw video
* Edited video
* Thumbnail
* SEO document
* Reference
* Final output

Acceptance Criteria:

* Upload hoặc gắn link asset.
* Có version asset.
* Gắn asset vào task hoặc workflow step.
* Người không có quyền không xem được asset.

---

# 5.8. Workflow Builder

## WF-001 — Tạo workflow template

**Priority:** P0

Người có quyền từ trưởng dự án trở lên có thể tạo workflow template.

Dữ liệu:

* Tên workflow
* Loại workflow
* Áp dụng cho đối tượng nào
* Danh sách bước
* Rule song song/tuần tự
* Rule duyệt
* Rule trả sửa

Acceptance Criteria:

* Tạo workflow.
* Thêm/sửa/xóa bước.
* Lưu bản nháp.
* Kích hoạt workflow.
* Nhân bản workflow.

---

## WF-002 — Cấu hình bước workflow

**Priority:** P0

Mỗi bước workflow có cấu hình riêng.

Cấu hình:

* Tên bước
* Người/role thực hiện mặc định
* Team mặc định
* Người/role duyệt mặc định
* Deadline mặc định
* Checklist
* File bắt buộc
* Evaluation form
* Có ảnh hưởng KPI không
* Cho phép chạy song song không
* Bước phụ thuộc

Acceptance Criteria:

* Tạo được bước.
* Gán người/role/team mặc định.
* Gán checklist.
* Gán form đánh giá.
* Cấu hình dependency.

---

## WF-003 — Workflow hỗ trợ bước song song và tuần tự

**Priority:** P0

Workflow phải hỗ trợ cả quy trình tuần tự và song song.

Acceptance Criteria:

* Bước A có thể bắt buộc hoàn thành trước bước B.
* Bước C và D có thể chạy song song.
* Bước upload chỉ mở khi các bước bắt buộc đã duyệt.
* Nếu bước bị lỗi, chỉ khóa phần liên quan.

---

## WF-004 — Áp dụng workflow vào content/project

**Priority:** P0

Khi tạo content/project, hệ thống tạo workflow instance từ template.

Acceptance Criteria:

* Chọn workflow template.
* Hệ thống sinh workflow instance.
* Hệ thống sinh step instance.
* Hệ thống sinh task theo bước.
* Gửi thông báo cho người liên quan.

---

# 5.9. Task Management

## TASK-001 — Tạo task thủ công

**Priority:** P0

Người có quyền có thể tạo task.

Dữ liệu:

* Tên task
* Mô tả
* Người phụ trách
* Team phụ trách
* Project
* Content/video
* Deadline
* Priority
* Reviewer
* Checklist
* File

Acceptance Criteria:

* Tạo được task.
* Gán người thực hiện.
* Gán reviewer.
* Task xuất hiện ở My Tasks của người được giao.

---

## TASK-002 — Tạo task tự động từ workflow

**Priority:** P0

Hệ thống tự tạo task theo workflow step.

Acceptance Criteria:

* Khi workflow instance được tạo, task được sinh theo bước.
* Task có deadline mặc định nếu workflow có cấu hình.
* Task có assignee/reviewer mặc định nếu có cấu hình.
* Task liên kết với workflow step.

---

## TASK-003 — Task status

**Priority:** P0

Task có các trạng thái:

* Not Started
* In Progress
* Waiting Review
* Revision Required
* Approved
* Completed
* Overdue
* Cancelled

Acceptance Criteria:

* User chuyển trạng thái theo quyền.
* Khi nộp sản phẩm, task chuyển Waiting Review.
* Khi duyệt, task chuyển Approved/Completed.
* Khi trả sửa, task chuyển Revision Required.
* Task quá deadline hiển thị Overdue.

---

## TASK-004 — Comment và file trong task

**Priority:** P0

Task hỗ trợ comment và attachment.

Acceptance Criteria:

* User trong task có thể comment.
* Có thể mention người khác.
* Có thể upload file/link.
* Comment và file lưu lịch sử.

---

# 5.10. Approval & Revision

## APR-001 — Duyệt tối đa 3 cấp

**Priority:** P0

Hệ thống hỗ trợ duyệt 1-3 cấp.

Acceptance Criteria:

* Cấu hình được số cấp duyệt.
* Mỗi cấp có người/role duyệt.
* Cấp sau chỉ mở khi cấp trước đã duyệt.
* Có thể duyệt, từ chối, trả sửa.

---

## APR-002 — Approval Inbox

**Priority:** P0

Người có quyền duyệt có màn hình hàng chờ duyệt.

Acceptance Criteria:

* Hiển thị danh sách item cần duyệt.
* Lọc theo loại, project, kênh, cấp duyệt.
* Có nút duyệt/trả sửa/từ chối.
* Mobile cũng có Approval Inbox cơ bản.

---

## APR-003 — Trả sửa đúng người, đúng bước

**Priority:** P0

Khi trả sửa, người duyệt phải chọn bước lỗi và người chịu trách nhiệm.

Acceptance Criteria:

* Chọn được workflow step bị lỗi.
* Chọn được responsible user.
* Nhập mô tả lỗi.
* Đính kèm minh chứng.
* Chọn deadline sửa.
* Hệ thống tạo revision task.
* Hệ thống gửi thông báo cho người chịu trách nhiệm.

---

## APR-004 — Chỉ khóa phần liên quan

**Priority:** P0

Khi có lỗi, hệ thống chỉ khóa phần liên quan.

Acceptance Criteria:

* Lỗi thumbnail chỉ khóa upload, không khóa voice/script đã duyệt.
* Lỗi voice khóa bước dựng liên quan.
* Lỗi một cảnh AI chỉ khóa cảnh/bước liên quan nếu cấu hình.
* Người có quyền có thể xem lý do bước bị khóa.

---

## APR-005 — Phân loại lỗi

**Priority:** P0

Hệ thống hỗ trợ 2 loại lỗi:

1. Lỗi cần sửa
2. Lỗi nghiêm trọng

Acceptance Criteria:

* Khi tạo lỗi, chọn được loại lỗi.
* Lỗi nghiêm trọng có thể ảnh hưởng KPI/thưởng/phạt.
* Lỗi được lưu lịch sử.
* Dashboard hiển thị lỗi nghiêm trọng.

---

# 5.11. Evaluation & KPI

## KPI-001 — Tạo Evaluation Form

**Priority:** P0

Người có quyền có thể tạo form đánh giá.

Dữ liệu:

* Tên form
* Áp dụng cho content type
* Áp dụng cho workflow step
* Vai trò được đánh giá
* Tiêu chí
* Thang điểm
* Trọng số
* Điểm đạt
* Có ảnh hưởng KPI không

Acceptance Criteria:

* Tạo được form đánh giá.
* Thêm tiêu chí.
* Gán trọng số.
* Gắn form vào workflow step.

---

## KPI-002 — Chấm điểm sản phẩm/task

**Priority:** P0

Người duyệt có thể chấm điểm sản phẩm/task.

Acceptance Criteria:

* Khi duyệt, người duyệt có thể mở form đánh giá.
* Nhập điểm từng tiêu chí.
* Hệ thống tính tổng điểm.
* Điểm lưu vào evaluation result.
* Điểm có thể đưa vào KPI.

---

## KPI-003 — KPI cá nhân

**Priority:** P0

Hệ thống tính KPI cá nhân theo kỳ.

Dữ liệu đầu vào:

* Task hoàn thành
* Tỷ lệ đúng deadline
* Điểm đánh giá trung bình
* Lỗi loại 1
* Lỗi loại 2
* Tỷ lệ duyệt lần đầu
* Số vòng sửa

Acceptance Criteria:

* User xem được KPI cá nhân.
* Quản lý xem KPI nhân sự trong phạm vi.
* KPI có thể khóa theo kỳ.
* KPI liên kết thưởng/phạt.

---

## KPI-004 — KPI team/phòng ban/kênh

**Priority:** P1

Hệ thống tổng hợp KPI theo team, phòng ban, kênh.

Acceptance Criteria:

* Xem KPI team.
* Xem KPI phòng ban.
* Xem KPI kênh.
* Dashboard hiển thị nhóm yếu/tốt.

---

# 5.12. Attendance & Leave

## HR-001 — Chấm công

**Priority:** P0

Mobile và web hỗ trợ chấm công.

Acceptance Criteria:

* Nhân viên check-in/check-out.
* Lưu thời gian.
* Lưu vị trí nếu cấu hình.
* Ghi nhận đi muộn/về sớm.
* HR xem bảng công.
* Dữ liệu công đưa vào payroll.

---

## HR-002 — Đơn bổ sung/chỉnh sửa công

**Priority:** P0

Nhân viên có thể tạo đơn bổ sung công.

Acceptance Criteria:

* Chọn ngày.
* Nhập giờ đề xuất.
* Nhập lý do.
* Gửi duyệt.
* Quản lý/HR duyệt hoặc từ chối.
* Nếu duyệt, cập nhật bảng công.

---

## HR-003 — Nghỉ phép

**Priority:** P0

Nhân viên có thể tạo đơn nghỉ phép.

Acceptance Criteria:

* Chọn loại nghỉ.
* Chọn thời gian.
* Nhập lý do.
* Chọn người bàn giao nếu cần.
* Gửi duyệt.
* Quản lý/HR duyệt.
* Cập nhật số ngày phép.
* Đồng bộ lịch team.

---

# 5.13. Payroll, Bonus & Penalty

## PAY-001 — Salary Profile

**Priority:** P0

HR/Finance có thể tạo thông tin lương cho nhân sự.

Dữ liệu:

* Lương cơ bản
* Loại lương
* Chu kỳ trả
* Hiệu lực từ ngày
* Phụ cấp mặc định nếu có

Acceptance Criteria:

* Tạo salary profile.
* Chỉ người có quyền xem/sửa.
* Ghi audit log khi sửa.

---

## PAY-002 — Tạo bảng lương

**Priority:** P0

Hệ thống tạo bảng lương theo kỳ.

Dữ liệu đầu vào:

* Lương cơ bản
* Chấm công
* Nghỉ phép
* KPI
* Thưởng
* Phạt
* Phụ cấp
* Khấu trừ

Acceptance Criteria:

* Tạo kỳ lương.
* Tạo payslip cho nhân sự.
* Tính tổng nhận.
* Kế toán/HR kiểm tra.
* Duyệt bảng lương.
* Phát hành bảng lương cho nhân viên.

---

## PAY-003 — Thưởng/phạt

**Priority:** P0

Hệ thống hỗ trợ thưởng/phạt thủ công và từ KPI/lỗi.

Acceptance Criteria:

* Tạo khoản thưởng.
* Tạo khoản phạt.
* Gắn lý do.
* Gắn reference task/defect/KPI nếu có.
* Duyệt khoản thưởng/phạt nếu cần.
* Đưa vào payslip.

---

## PAY-004 — Nhân viên xem bảng lương

**Priority:** P0

Nhân viên xem bảng lương cá nhân.

Acceptance Criteria:

* Nhân viên chỉ xem payslip của mình.
* Có xác thực lại trên mobile nếu cấu hình.
* Nhân viên xác nhận đã xem.
* Nhân viên gửi khiếu nại nếu có sai lệch.

---

# 5.14. Finance

## FIN-001 — Nhập doanh thu

**Priority:** P0

Finance/Channel Manager theo quyền có thể nhập doanh thu.

Dữ liệu:

* Nền tảng
* Kênh
* Project
* Video nếu có
* Kỳ ghi nhận
* Số tiền
* File đính kèm
* Người nhập

Acceptance Criteria:

* Nhập được doanh thu.
* Gắn doanh thu vào kênh/project/video.
* Sửa/xóa theo quyền.
* Ghi audit log khi sửa/xóa.

---

## FIN-002 — Nhập chi phí

**Priority:** P0

Finance/người có quyền có thể nhập chi phí.

Loại chi phí:

* Lương
* Freelancer
* Phần mềm
* Thiết bị
* Quảng cáo
* Sản xuất
* Đào tạo
* Tuyển dụng
* Vận hành
* Khác

Acceptance Criteria:

* Nhập được chi phí.
* Gắn chi phí với kênh/project/video/team/phòng ban.
* Upload chứng từ.
* Ghi audit log.

---

## FIN-003 — Phân bổ chi phí tự động cơ bản

**Priority:** P0

Hệ thống hỗ trợ phân bổ chi phí.

Phương thức:

* Chia đều
* Theo số video
* Theo số task
* Theo phần trăm thủ công
* Theo số giờ làm nếu có dữ liệu

Acceptance Criteria:

* Chọn được phương thức phân bổ.
* Hệ thống tạo cost allocation.
* Dashboard tính được chi phí sau phân bổ.

---

## FIN-004 — Tính lợi nhuận

**Priority:** P0

Hệ thống tính lợi nhuận cơ bản.

Công thức:

```text
Lợi nhuận = Doanh thu - Chi phí trực tiếp - Chi phí phân bổ
```

Acceptance Criteria:

* Tính lợi nhuận theo công ty.
* Tính lợi nhuận theo kênh.
* Tính lợi nhuận theo project.
* Tính lợi nhuận theo video nếu có dữ liệu.

---

## FIN-005 — Đề xuất chi

**Priority:** P1

Người dùng có thể tạo đề xuất chi.

Acceptance Criteria:

* Tạo đề xuất chi.
* Gắn kênh/project/phòng ban.
* Upload báo giá/chứng từ.
* Duyệt theo cấp.
* Nếu duyệt, tạo cost record.

---

# 5.15. Chat

## CHAT-001 — Chat realtime 1-1

**Priority:** P0

Người dùng có thể chat 1-1.

Acceptance Criteria:

* Gửi/nhận tin nhắn realtime.
* Hiển thị trạng thái tin nhắn.
* Lưu lịch sử chat.
* Tìm kiếm cơ bản.

---

## CHAT-002 — Group chat thủ công

**Priority:** P0

Người dùng có quyền có thể tạo group chat.

Acceptance Criteria:

* Tạo group.
* Thêm/xóa thành viên.
* Gửi tin/file.
* Mention user.
* Ghim tin.

---

## CHAT-003 — Group chat tự động

**Priority:** P0

Hệ thống tự tạo group chat theo project/kênh/phòng ban nếu cấu hình bật.

Acceptance Criteria:

* Tạo project thì tạo group project.
* Tạo kênh thì tạo group kênh.
* Thêm thành viên project thì tự thêm vào group.
* Rời project thì xử lý quyền chat theo cấu hình.

---

# 5.16. Notification

## NOTI-001 — Notification Center

**Priority:** P0

Hệ thống có trung tâm thông báo.

Loại thông báo:

* Task
* Deadline
* Duyệt
* Trả sửa
* Họp
* Chấm công
* Nghỉ phép
* Lương/thưởng
* KPI
* Tài chính
* Kênh
* Bảo mật

Acceptance Criteria:

* User nhận thông báo trong web.
* User nhận push trên mobile.
* Thông báo có trạng thái đã đọc/chưa đọc.
* Có nút hành động nhanh nếu phù hợp.

---

## NOTI-002 — Thông báo bắt buộc

**Priority:** P0

Một số thông báo không được tắt.

Thông báo bắt buộc:

* Task được giao
* Deadline
* Bị trả sửa
* Lịch họp bắt buộc
* Chấm công
* Bảng lương
* KPI
* Thưởng/phạt
* Cảnh báo bảo mật

Acceptance Criteria:

* Admin cấu hình loại thông báo bắt buộc.
* User không thể tắt thông báo bắt buộc.
* User có thể tắt/tùy chỉnh thông báo không bắt buộc.

---

# 5.17. Meeting

## MEET-001 — Quản lý phòng họp

**Priority:** P1

Hệ thống quản lý phòng họp vật lý và online.

Acceptance Criteria:

* Tạo phòng họp.
* Xem lịch phòng.
* Kiểm tra trùng lịch.
* Đặt phòng.

---

## MEET-002 — Tạo cuộc họp

**Priority:** P1

Người dùng có thể tạo cuộc họp.

Dữ liệu:

* Tiêu đề
* Thời gian
* Phòng họp/link online
* Người tham gia
* Project/kênh liên quan
* Agenda

Acceptance Criteria:

* Tạo cuộc họp.
* Gửi thông báo cho người tham gia.
* Hiển thị trên lịch.
* Có thể chỉnh/hủy cuộc họp.

---

## MEET-003 — Biên bản họp và task sau họp

**Priority:** P1

Cuộc họp có thể tạo biên bản và task sau họp.

Acceptance Criteria:

* Ghi biên bản.
* Tạo task từ biên bản.
* Gán người phụ trách.
* Task liên kết với meeting.

---

# 5.18. Dashboard

## DASH-001 — Dashboard lãnh đạo

**Priority:** P0

Ban lãnh đạo có dashboard tổng quan.

Hiển thị:

* Tổng nhân sự
* Tổng kênh
* Tổng project
* Tổng video đang sản xuất
* Task trễ
* Video chờ duyệt
* Kênh rủi ro
* Doanh thu
* Chi phí
* Lợi nhuận
* KPI tổng quan
* Lỗi nghiêm trọng

Acceptance Criteria:

* Dashboard hiển thị dữ liệu theo quyền.
* Có filter theo tháng/kênh/project/phòng ban.
* Click vào chỉ số để xem chi tiết.

---

## DASH-002 — Dashboard quản lý

**Priority:** P0

Quản lý xem dữ liệu trong phạm vi.

Hiển thị:

* Project phụ trách
* Task team
* Task trễ
* Video chờ duyệt
* Lỗi phát sinh
* KPI team
* Tiến độ workflow

Acceptance Criteria:

* Chỉ hiển thị dữ liệu trong scope.
* Có danh sách action cần xử lý.

---

## DASH-003 — Dashboard nhân viên

**Priority:** P0

Nhân viên có dashboard cá nhân.

Hiển thị:

* Task hôm nay
* Task sắp deadline
* Task bị trả sửa
* Lịch họp
* Chấm công hôm nay
* KPI cá nhân
* Thông báo bắt buộc

Acceptance Criteria:

* Web và mobile đều có.
* Hiển thị đúng dữ liệu cá nhân.
* Có action nhanh.

---

## DASH-004 — Dashboard HR

**Priority:** P1

HR có dashboard nhân sự.

Hiển thị:

* Chấm công thiếu
* Đơn nghỉ chờ duyệt
* Nhân sự mới
* KPI nhân sự
* Thưởng/phạt
* Bảng lương liên quan

---

## DASH-005 — Dashboard Finance

**Priority:** P1

Finance có dashboard tài chính.

Hiển thị:

* Doanh thu
* Chi phí
* Lợi nhuận
* Đề xuất chi chờ duyệt
* Bảng lương chờ xử lý
* Chi phí theo kênh/project

---

# 5.19. Audit Log

## AUD-001 — Ghi audit log hành động quan trọng

**Priority:** P0

Hệ thống phải ghi lại các hành động quan trọng.

Hành động bắt buộc ghi log:

* Đăng nhập thất bại nhiều lần
* Xem/sửa tài khoản kênh
* Xem mật khẩu
* Thay đổi phân quyền
* Tạo/xóa nhân sự
* Sửa bảng lương
* Duyệt bảng lương
* Nhập/sửa doanh thu
* Nhập/sửa chi phí
* Xóa project/video
* Duyệt/trả sửa sản phẩm
* Đóng lỗi nghiêm trọng
* Thay đổi workflow
* Xuất báo cáo tài chính

Acceptance Criteria:

* Lưu actor.
* Lưu action.
* Lưu object.
* Lưu thời gian.
* Lưu old/new value nếu có.
* Lưu IP/user agent nếu có.
* Người có quyền xem được audit log.

---

# 6. Mobile Requirements

---

## MOB-001 — Mobile login

**Priority:** P0

Người dùng đăng nhập được trên mobile.

Acceptance Criteria:

* Đăng nhập bằng email/số điện thoại.
* Hỗ trợ phiên đăng nhập.
* Hỗ trợ xác thực lại khi xem dữ liệu nhạy cảm.

---

## MOB-002 — Mobile Home

**Priority:** P0

Mobile có màn hình Home cá nhân.

Hiển thị:

* Chấm công nhanh
* Task hôm nay
* Task quá hạn
* Thông báo quan trọng
* Lịch họp
* KPI nhanh

---

## MOB-003 — Mobile Task

**Priority:** P0

Người dùng xem và xử lý task trên mobile.

Acceptance Criteria:

* Xem My Tasks.
* Xem task detail.
* Nộp sản phẩm bằng file/link.
* Comment.
* Nhận feedback.
* Xem task cần sửa.

---

## MOB-004 — Mobile Approval

**Priority:** P0

Người có quyền có thể duyệt trên mobile.

Acceptance Criteria:

* Xem hàng chờ duyệt.
* Xem file/link sản phẩm.
* Duyệt.
* Trả sửa.
* Nhập comment.
* Tạo lỗi cơ bản.

---

## MOB-005 — Mobile Chat

**Priority:** P0

Mobile có chat realtime.

Acceptance Criteria:

* Chat 1-1.
* Chat group.
* Gửi file/ảnh.
* Mention.
* Nhận notification chat.

---

## MOB-006 — Mobile Notification

**Priority:** P0

Mobile nhận thông báo.

Acceptance Criteria:

* Push notification.
* Notification center.
* Phân loại thông báo.
* Thông báo bắt buộc không được tắt.

---

## MOB-007 — Mobile Attendance

**Priority:** P0

Mobile hỗ trợ chấm công.

Acceptance Criteria:

* Check-in/check-out.
* Lưu thời gian.
* Lưu vị trí nếu cấu hình.
* Tạo đơn bổ sung công.

---

## MOB-008 — Mobile Leave Request

**Priority:** P1

Mobile hỗ trợ xin nghỉ phép.

Acceptance Criteria:

* Tạo đơn nghỉ.
* Xem ngày phép còn lại.
* Xem trạng thái đơn.
* Nhận thông báo duyệt/từ chối.

---

## MOB-009 — Mobile Payslip

**Priority:** P1

Mobile cho nhân viên xem bảng lương.

Acceptance Criteria:

* Xem payslip cá nhân.
* Xác thực lại nếu cần.
* Xác nhận đã xem.
* Gửi khiếu nại.

---

## MOB-010 — Mobile KPI

**Priority:** P1

Mobile cho nhân viên xem KPI cá nhân.

Acceptance Criteria:

* Xem điểm KPI tháng.
* Xem task hoàn thành.
* Xem lỗi.
* Xem thưởng/phạt liên quan.

---

# 7. Non-Functional Requirements

---

## NFR-001 — Bảo mật

**Priority:** P0

Yêu cầu:

* Mật khẩu được hash.
* Mật khẩu tài khoản nền tảng được mã hóa.
* Dữ liệu nhạy cảm chỉ hiển thị theo quyền.
* Hành động nhạy cảm ghi audit log.
* Có thể yêu cầu xác thực lại khi xem lương/mật khẩu/tài chính.
* Không lộ dữ liệu giữa các scope quyền.

---

## NFR-002 — Hiệu năng MVP

**Priority:** P0

Hệ thống cần đáp ứng:

* 200-500 nhân sự
* 100-300 kênh
* 300-1000 video/tháng
* Hàng chục nghìn task/tháng
* Chat realtime nội bộ
* Notification realtime
* Dashboard tải trong thời gian chấp nhận được

---

## NFR-003 — Multi-tenant ready

**Priority:** P0

Dù dùng nội bộ, database phải sẵn sàng SaaS.

Yêu cầu:

* Bảng chính có `company_id`.
* Dữ liệu tách theo company.
* Permission kiểm tra theo company.
* Không hard-code một công ty duy nhất.

---

## NFR-004 — Auditability

**Priority:** P0

Mọi dữ liệu quan trọng cần truy vết được.

Yêu cầu:

* Biết ai tạo.
* Ai sửa.
* Sửa lúc nào.
* Sửa cái gì.
* Dữ liệu trước/sau.
* Lý do nếu là hành động nhạy cảm.

---

## NFR-005 — Scalability

**Priority:** P1

Kiến trúc phải mở rộng được cho:

* Nhiều công ty
* Nhiều kênh
* Nhiều workflow
* Nhiều nền tảng
* Nhiều loại nội dung
* API tích hợp YouTube/TikTok/Facebook sau này

---

## NFR-006 — Usability

**Priority:** P0

UI phải dễ dùng với nhân sự không rành kỹ thuật.

Yêu cầu:

* Menu rõ ràng.
* Task dễ hiểu.
* Mobile thao tác nhanh.
* Notification có action nhanh.
* Form dài chia step.
* Dữ liệu nhạy cảm có cảnh báo.

---

# 8. Business Rules quan trọng

---

## BR-001 — Một nhân sự có thể có nhiều vai trò

Một người có thể vừa là:

* Nhân viên phòng ban
* Thành viên team
* Thành viên project
* Người quản lý project
* Người duyệt trong workflow
* Channel Manager của kênh nhất định

---

## BR-002 — Quyền nhạy cảm không tự kế thừa

Các quyền sau phải cấp riêng:

* Xem lương người khác
* Sửa bảng lương
* Xem mật khẩu/tài khoản kênh
* Xem lợi nhuận
* Xuất báo cáo tài chính
* Thay đổi phân quyền
* Đóng lỗi nghiêm trọng

---

## BR-003 — Project có thể chứa nhiều kênh và nhiều content

Một project không đồng nghĩa với một video.

Cấu trúc đúng:

```text
Project
→ Nhiều kênh
→ Nhiều video/content
→ Nhiều team
→ Nhiều nhân sự
```

---

## BR-004 — Workflow không được hard-code

Mọi quy trình phải tạo được bằng Workflow Builder.

Bao gồm:

* Quy trình sản xuất video
* Quy trình shorts
* Quy trình AI animation
* Quy trình đề xuất chi
* Quy trình nghỉ phép
* Quy trình bảng lương
* Quy trình họp
* Quy trình văn phòng khác

---

## BR-005 — Trả sửa phải gắn với người và bước

Không được trả sửa chung chung.

Khi trả sửa phải có:

* Bước lỗi
* Người chịu trách nhiệm
* Loại lỗi
* Mô tả lỗi
* Deadline sửa
* Có ảnh hưởng KPI không
* Có ảnh hưởng thưởng/phạt không

---

## BR-006 — Lỗi chỉ khóa phần liên quan

Không khóa toàn bộ workflow nếu lỗi chỉ nằm ở một phần.

Ví dụ:

* Thumbnail lỗi → khóa upload
* Voice lỗi → khóa dựng/video final
* Script lỗi nghiêm trọng → khóa các bước phụ thuộc script
* SEO lỗi → khóa upload nhưng không khóa thumbnail/video nếu đã đạt

---

## BR-007 — KPI ảnh hưởng thưởng/phạt/lương

Điểm đánh giá, deadline, lỗi và hiệu suất có thể ảnh hưởng:

* KPI cá nhân
* KPI team
* Thưởng
* Phạt
* Bảng lương
* Đánh giá hiệu suất

---

# 9. MVP Acceptance Criteria tổng thể

MVP v1 được xem là đạt khi hệ thống làm được các việc sau:

1. Tạo được công ty, phòng ban, team, chức vụ, nhân sự.
2. Một nhân sự có thể thuộc nhiều team/project.
3. Phân quyền được theo role, scope, object.
4. Quản lý được danh sách kênh và tài khoản liên quan.
5. Bảo vệ được dữ liệu tài khoản kênh bằng quyền nhạy cảm.
6. Tạo được project gồm nhiều kênh, nhiều team, nhiều video/content.
7. Tạo được content/video và gắn vào project/kênh.
8. Tạo được workflow template.
9. Workflow hỗ trợ bước tuần tự và song song.
10. Áp dụng workflow vào content/project và sinh task.
11. Nhân viên nhận task, comment, upload file, nộp sản phẩm.
12. Người duyệt thấy hàng chờ duyệt.
13. Duyệt được tối đa 3 cấp.
14. Trả sửa được đúng người, đúng bước.
15. Lỗi chỉ khóa phần liên quan.
16. Tạo được evaluation form.
17. Chấm điểm được sản phẩm/task.
18. Tính được KPI cá nhân cơ bản.
19. Quản lý được chấm công.
20. Quản lý được nghỉ phép.
21. Tạo được bảng lương cơ bản.
22. Gắn được thưởng/phạt vào nhân sự.
23. Nhập được doanh thu.
24. Nhập được chi phí.
25. Phân bổ chi phí cơ bản.
26. Tính được lợi nhuận cơ bản.
27. Có chat realtime.
28. Có group chat tự động theo project/kênh.
29. Có notification center.
30. Có thông báo bắt buộc không thể tắt.
31. Có tạo lịch họp, biên bản họp và task sau họp.
32. Có dashboard cho lãnh đạo, quản lý, nhân viên.
33. Có mobile app cho task, chat, thông báo, duyệt, chấm công.
34. Có audit log cho hành động quan trọng.
35. Kiến trúc database có `company_id` để sẵn sàng SaaS.

---

# 10. Roadmap triển khai MVP v1

## Phase 1 — Core Platform

Mục tiêu: tạo nền tảng hệ thống.

Chức năng:

1. Authentication
2. Company setup
3. Organization
4. Employee
5. Role & Permission
6. Audit log cơ bản

Kết quả:

* Có hệ thống user/role/scope.
* Có cấu trúc công ty.
* Có nhân sự đăng nhập được.

---

## Phase 2 — Media Core

Mục tiêu: quản lý kênh, project, content.

Chức năng:

1. Channel Management
2. Platform Account
3. Project Management
4. Content/Video Management
5. Content Asset

Kết quả:

* Quản lý được 100 kênh.
* Tạo được project nhiều kênh.
* Tạo được content/video trong project.

---

## Phase 3 — Workflow & Task

Mục tiêu: vận hành sản xuất.

Chức năng:

1. Workflow Builder
2. Workflow Instance
3. Step Instance
4. Task Management
5. Comment/File
6. Notification task

Kết quả:

* Tạo workflow.
* Áp workflow vào video/project.
* Tự sinh task.
* Nhân viên nhận và nộp việc.

---

## Phase 4 — Approval, Revision, KPI

Mục tiêu: kiểm soát chất lượng.

Chức năng:

1. Approval 3 cấp
2. Approval Inbox
3. Revision/Defect
4. Evaluation Form
5. Evaluation Result
6. KPI cá nhân cơ bản

Kết quả:

* Duyệt được sản phẩm.
* Trả sửa đúng người.
* Ghi nhận lỗi.
* Chấm điểm và tính KPI.

---

## Phase 5 — HR, Payroll, Finance

Mục tiêu: kết nối vận hành với nhân sự và tài chính.

Chức năng:

1. Chấm công
2. Nghỉ phép
3. Salary profile
4. Payroll
5. Bonus/Penalty
6. Revenue
7. Cost
8. Cost Allocation
9. Profit

Kết quả:

* Có bảng công.
* Có bảng lương.
* Có doanh thu/chi phí/lợi nhuận.

---

## Phase 6 — Communication & Mobile

Mục tiêu: dùng hằng ngày trên web/mobile.

Chức năng:

1. Chat realtime
2. Group chat tự động
3. Notification Center
4. Meeting
5. Mobile Home
6. Mobile Task
7. Mobile Approval
8. Mobile Chat
9. Mobile Attendance

Kết quả:

* Nhân sự có thể dùng mobile để làm việc hằng ngày.
* Quản lý có thể duyệt nhanh.
* Giao tiếp nội bộ nằm trong hệ thống.

---

# 11. Rủi ro MVP v1

## Rủi ro 1 — Scope quá lớn

MVP v1 có phạm vi rộng. Cần chia phase rõ, không làm tất cả cùng lúc.

Giải pháp:

* Ưu tiên Core Platform → Media Core → Workflow/Task trước.
* HR/Payroll/Finance làm sau khi task/workflow ổn định.

---

## Rủi ro 2 — Phân quyền phức tạp

Phân quyền theo role + scope + object dễ phức tạp.

Giải pháp:

* MVP dùng 10 role cốt lõi.
* Dữ liệu nhạy cảm tách quyền riêng.
* Object permission làm P1 nếu P0 quá nặng.

---

## Rủi ro 3 — Workflow Builder khó làm

Workflow có song song, dependency, approval, revision.

Giải pháp:

* MVP chỉ cần workflow builder dạng đơn giản.
* Hỗ trợ dependency cơ bản.
* Advanced workflow canvas làm sau.

---

## Rủi ro 4 — Chat realtime ảnh hưởng hạ tầng

Chat realtime cần thiết kế kỹ.

Giải pháp:

* MVP chat text/file/mention trước.
* Reaction, search nâng cao, voice note làm sau.

---

## Rủi ro 5 — KPI/lương dễ gây tranh cãi

Nếu công thức KPI/lương chưa rõ, hệ thống có thể gây sai lệch.

Giải pháp:

* MVP cho phép cấu hình thủ công.
* KPI tính gợi ý, HR/Finance duyệt trước khi phát hành lương.
* Mọi thay đổi phải có audit log.

---

# 12. Đề xuất MVP tối thiểu thực sự nên build trước

Nếu cần rút gọn để ra bản dùng được nhanh, MVP tối thiểu nên gồm:

```text
1. User / Organization / Permission
2. Channel Management
3. Project / Content
4. Workflow Template đơn giản
5. Task Management
6. Approval / Revision
7. Evaluation Form cơ bản
8. KPI cá nhân cơ bản
9. Chat / Notification
10. Dashboard cơ bản
```

Sau đó mới thêm:

```text
11. Chấm công
12. Nghỉ phép
13. Payroll
14. Finance
15. Meeting
16. Mobile mở rộng
```

---

# 13. Kết luận

MVP v1 của MediaOS cần được hiểu là **nền tảng vận hành nội bộ đầu tiên**, không phải bản thử nghiệm nhỏ.

Mục tiêu quan trọng nhất:

```text
Quản lý được người
Quản lý được kênh
Quản lý được project/video
Quản lý được workflow/task
Duyệt và trả sửa đúng người
Đo được KPI
Có dữ liệu cho lương/thưởng/phạt
Có dữ liệu doanh thu/chi phí/lợi nhuận
Có chat và thông báo để vận hành hằng ngày
```

Khi MVP v1 chạy ổn trong nội bộ, hệ thống có thể tiếp tục phát triển thành SaaS bằng cách mở rộng:

```text
Multi-tenant self-service
Billing
Template marketplace
Public API
White-label
Advanced analytics
Integrations với YouTube/TikTok/Facebook
```
