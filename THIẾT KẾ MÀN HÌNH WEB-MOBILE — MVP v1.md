# THIẾT KẾ MÀN HÌNH WEB/MOBILE — MVP v1

## Media Company Operating System

---

# 1. Nguyên tắc thiết kế UI/UX

## 1.1. Web App

Web app là trung tâm quản trị chính.

Web dùng cho:

```text
Ban lãnh đạo
Trưởng phòng
Trưởng dự án
Channel Manager
HR
Kế toán
Admin hệ thống
Nhân sự cần thao tác sâu
```

Web cần mạnh ở:

```text
Dashboard
Quản lý dữ liệu lớn
Tạo project
Tạo workflow
Phân quyền
Tài chính
Lương
KPI
Báo cáo
Quản lý kênh
Quản lý nhân sự
```

---

## 1.2. Mobile App

Mobile app dùng cho thao tác nhanh.

Mobile dùng cho:

```text
Nhân viên
Freelancer
Trưởng team
Trưởng dự án
Quản lý cần duyệt nhanh
Nhân sự đi làm offline/remote/hybrid
```

Mobile cần mạnh ở:

```text
Chat
Task
Thông báo
Duyệt nhanh
Trả sửa nhanh
Chấm công
Xin nghỉ phép
Lịch họp
Xem KPI cá nhân
Xem bảng lương
```

---

# 2. Cấu trúc Web App tổng thể

## 2.1. Layout chính

Web app nên dùng layout 3 vùng:

```text
┌──────────────────────────────────────────────┐
│ Top Bar: Search, Notification, Profile       │
├───────────────┬──────────────────────────────┤
│ Sidebar Menu  │ Main Content                 │
│               │                              │
│               │                              │
└───────────────┴──────────────────────────────┘
```

## 2.2. Sidebar menu chính

```text
Dashboard
Tổ chức
Nhân sự
Kênh & Nền tảng
Project & Nội dung
Workflow
Task
Duyệt & Trả sửa
KPI & Đánh giá
HR & Chấm công
Lương & Thưởng phạt
Tài chính
Họp
Chat
Thông báo
Cài đặt
```

---

# 3. Web Screen 1: Login / Đăng nhập

## Mục tiêu

Cho phép người dùng đăng nhập vào hệ thống.

## Thành phần màn hình

```text
Logo công ty
Email / Số điện thoại
Mật khẩu
Nút đăng nhập
Quên mật khẩu
Đăng nhập bằng Google nếu có
2FA nếu tài khoản yêu cầu
```

## Ghi chú

Tài khoản có quyền nhạy cảm nên bật 2FA bắt buộc.

---

# 4. Web Screen 2: Dashboard tổng quan

## Đối tượng

Ban lãnh đạo, quản lý cấp cao.

## Layout đề xuất

```text
┌──────────────────────────────────────────────┐
│ Bộ lọc: Tháng / Kênh / Project / Phòng ban  │
├──────────────────────────────────────────────┤
│ Doanh thu | Chi phí | Lợi nhuận | Video      │
├──────────────────────────────────────────────┤
│ Task trễ | Project trễ | Kênh rủi ro | Lỗi   │
├──────────────────────────────────────────────┤
│ Biểu đồ sản xuất video theo trạng thái       │
├──────────────────────┬───────────────────────┤
│ Top kênh tốt          │ Kênh cần chú ý        │
├──────────────────────┴───────────────────────┤
│ Danh sách cảnh báo quan trọng                │
└──────────────────────────────────────────────┘
```

## Dữ liệu hiển thị

```text
Tổng số nhân sự
Tổng số kênh
Tổng project đang chạy
Tổng video đang sản xuất
Video hoàn thành tháng này
Task quá hạn
Video chờ duyệt
Doanh thu tháng
Chi phí tháng
Lợi nhuận tháng
Kênh giảm hiệu suất
Nhân sự có nhiều lỗi
Team quá tải
```

## Hành động chính

```text
Xem chi tiết dashboard sản xuất
Xem báo cáo tài chính
Xem báo cáo kênh
Xem task trễ
Xem video chờ duyệt
```

---

# 5. Web Screen 3: Organization Chart / Sơ đồ tổ chức

## Mục tiêu

Hiển thị cấu trúc công ty theo khối, phòng ban, team, quản lý trực tiếp.

## Layout

```text
┌──────────────────────────────────────────────┐
│ Bộ lọc: Khối / Phòng ban / Team              │
├──────────────────────────────────────────────┤
│ Sơ đồ tổ chức dạng cây                       │
│                                              │
│ CEO                                          │
│ ├── Khối sản xuất                            │
│ │   ├── Team Script                          │
│ │   ├── Team Editor                          │
│ │   └── Team Thumbnail                       │
│ ├── Khối SEO                                 │
│ ├── HR                                       │
│ └── Kế toán                                  │
└──────────────────────────────────────────────┘
```

## Hành động

```text
Tạo phòng ban
Tạo team
Gán trưởng phòng
Gán team leader
Xem nhân sự trong phòng ban
Xem KPI phòng ban
```

---

# 6. Web Screen 4: Employee List / Danh sách nhân sự

## Mục tiêu

Quản lý toàn bộ nhân sự.

## Layout

```text
┌──────────────────────────────────────────────┐
│ Search + Filter                              │
│ Phòng ban | Team | Chức vụ | Trạng thái      │
├──────────────────────────────────────────────┤
│ Bảng nhân sự                                 │
│ Mã NV | Tên | Phòng ban | Chức vụ | Manager │
│ Loại nhân sự | Trạng thái | KPI | Hành động │
└──────────────────────────────────────────────┘
```

## Hành động

```text
Thêm nhân sự
Import nhân sự
Xem hồ sơ
Sửa hồ sơ
Gán phòng ban
Gán team
Gán quản lý trực tiếp
Gán role
Khóa tài khoản
```

---

# 7. Web Screen 5: Employee Detail / Hồ sơ nhân sự

## Tabs đề xuất

```text
Tổng quan
Thông tin công việc
Team/Project tham gia
Task
KPI
Chấm công
Nghỉ phép
Lương
Thưởng/Phạt
Tài liệu
Lịch sử
```

## Nội dung tab Tổng quan

```text
Avatar
Họ tên
Mã nhân viên
Email
Số điện thoại
Phòng ban
Team
Chức vụ
Quản lý trực tiếp
Hình thức làm việc
Loại nhân sự
Trạng thái
Ngày vào làm
```

## Nội dung tab KPI

```text
Điểm KPI tháng
Task hoàn thành
Tỷ lệ đúng deadline
Số lỗi loại 1
Số lỗi loại 2
Điểm đánh giá trung bình
Đề xuất thưởng/phạt
```

## Lưu ý phân quyền

Nhân viên chỉ xem được hồ sơ của mình ở mức giới hạn. Lương chỉ hiển thị nếu có quyền phù hợp.

---

# 8. Web Screen 6: Channel List / Danh sách kênh

## Mục tiêu

Quản lý khoảng 100 kênh hiện tại và mở rộng nhiều nền tảng sau này.

## Layout

```text
┌──────────────────────────────────────────────┐
│ Search + Filter                              │
│ Nền tảng | Trạng thái | Ngách | Manager      │
├──────────────────────────────────────────────┤
│ Card/Bảng kênh                               │
│ Tên kênh | Nền tảng | Manager | Health       │
│ Doanh thu | Chi phí | Lợi nhuận | Trạng thái │
└──────────────────────────────────────────────┘
```

## Hành động

```text
Tạo kênh
Import danh sách kênh
Xem chi tiết kênh
Gán Channel Manager
Gán team phụ trách
Cập nhật trạng thái kênh
Xem báo cáo kênh
```

---

# 9. Web Screen 7: Channel Detail / Chi tiết kênh

## Tabs đề xuất

```text
Tổng quan
Tài khoản liên quan
Project
Video/Content
Lịch đăng
Doanh thu
Chi phí
Lợi nhuận
Channel Health
Team phụ trách
Cảnh báo
Audit Log
```

## Tab Tổng quan

```text
Tên kênh
Nền tảng
Link kênh
Ngôn ngữ
Quốc gia target
Ngách nội dung
Trạng thái
Channel Manager
Team phụ trách
Tần suất đăng
Ghi chú vận hành
```

## Tab Tài khoản liên quan

Hiển thị theo phân quyền:

```text
Gmail chính
Gmail phụ
Google Account
YouTube Account
AdSense
Analytics
Email recovery
Số điện thoại recovery
2FA note
```

Mức hiển thị:

```text
Không thấy
Chỉ thấy tên tài khoản
Được yêu cầu truy cập
Được xem thông tin đăng nhập
Được chỉnh sửa
```

## Tab Channel Health

```text
Health Score
View trend
Subscriber trend
Revenue trend
Profit trend
Upload consistency
Risk status
Copyright warning
Account risk
Team workload
```

---

# 10. Web Screen 8: Project List

## Mục tiêu

Quản lý project/chính dịch/gói nội dung.

## Layout

```text
┌──────────────────────────────────────────────┐
│ Search + Filter                              │
│ Loại project | Trạng thái | Kênh | Manager  │
├──────────────────────────────────────────────┤
│ Bảng project                                 │
│ Tên | Loại | Manager | Kênh | Video | Tiến độ│
│ Deadline | Trạng thái | Cảnh báo             │
└──────────────────────────────────────────────┘
```

## Loại project

```text
Sản xuất nội dung
Vận hành kênh
Chiến dịch tăng trưởng
Tuyển dụng
Đào tạo
Tài chính
Văn phòng nội bộ
Thiết bị
```

## Hành động

```text
Tạo project
Gắn kênh
Gắn team
Gắn thành viên
Chọn workflow
Xem tiến độ
Xem chi phí
Xem báo cáo
```

---

# 11. Web Screen 9: Project Detail

## Tabs đề xuất

```text
Tổng quan
Kênh liên quan
Content/Video
Workflow
Task
Team/Ekip
File/Link
Duyệt & Lỗi
KPI
Chi phí
Doanh thu
Chat
Lịch sử
```

## Tab Tổng quan

```text
Tên project
Mã project
Loại project
Project Manager
Trạng thái
Ngày bắt đầu
Deadline
Mức ưu tiên
Ngân sách
Tiến độ
Số video/content
Số task
Task trễ
Lỗi nghiêm trọng
```

## Tab Content/Video

```text
Danh sách video/content thuộc project
Trạng thái sản xuất
Workflow đang chạy
Người phụ trách
Kênh đăng
Deadline
Tình trạng duyệt
```

---

# 12. Web Screen 10: Content/Video Detail

## Mục tiêu

Là màn hình trung tâm cho một video hoặc nội dung cụ thể.

## Layout tổng quan

```text
┌──────────────────────────────────────────────┐
│ Tên video + trạng thái + deadline            │
├──────────────────────────────────────────────┤
│ Thông tin chính | Người phụ trách | Kênh     │
├──────────────────────────────────────────────┤
│ Workflow timeline                            │
├──────────────────────────────────────────────┤
│ Task hiện tại / File / Comment / Duyệt       │
└──────────────────────────────────────────────┘
```

## Tabs đề xuất

```text
Tổng quan
Workflow
Task
Script
File/Asset
Thumbnail
SEO
Duyệt
Lỗi/Revision
Đánh giá
Chỉ số sau đăng
Chi phí/Lợi nhuận
Lịch sử
```

## Tab Workflow

Hiển thị dạng timeline:

```text
Ý tưởng → Script → Voice → Dựng → Thumbnail → SEO → QA → Upload
```

Mỗi bước hiển thị:

```text
Trạng thái
Người làm
Người duyệt
Deadline
Số lỗi
Điểm đánh giá
File nộp
```

## Hành động chính

```text
Giao task
Nộp sản phẩm
Duyệt
Trả sửa
Tạo lỗi
Chấm điểm
Upload file
Chuyển bước
Khóa/mở bước nếu có quyền
```

---

# 13. Web Screen 11: Workflow Builder

## Mục tiêu

Cho phép trưởng dự án/trưởng phòng/admin tạo workflow mẫu.

## Layout

```text
┌──────────────────────────────────────────────┐
│ Tên workflow | Loại workflow | Áp dụng cho   │
├───────────────┬──────────────────────────────┤
│ Danh sách bước│ Canvas thiết kế workflow     │
│               │                              │
│ Step 1        │ [Ý tưởng] → [Script]         │
│ Step 2        │          ↘ [Thumbnail]       │
│ Step 3        │ [Voice] → [Dựng] → [QA]      │
└───────────────┴──────────────────────────────┘
```

## Chức năng

```text
Tạo workflow
Thêm bước
Kéo thả thứ tự bước
Thiết lập bước song song
Thiết lập bước phụ thuộc
Gán role thực hiện mặc định
Gán role duyệt mặc định
Gán checklist
Gán form đánh giá
Thiết lập số cấp duyệt
Thiết lập rule trả sửa
Lưu bản nháp
Kích hoạt workflow
Nhân bản workflow
```

## Màn hình cấu hình từng bước

```text
Tên bước
Mô tả
Loại bước
Người thực hiện mặc định
Team mặc định
Người duyệt mặc định
Deadline mặc định
Checklist bắt buộc
File bắt buộc
Form đánh giá
Bước phụ thuộc
Cho phép chạy song song
Có ảnh hưởng KPI không
Có ảnh hưởng thưởng/phạt không
```

---

# 14. Web Screen 12: Task Board

## Mục tiêu

Quản lý **mọi công việc trong công ty** theo Kanban, bảng và lịch — KHÔNG chỉ task sản xuất video.

## Task là module độc lập (đọc kỹ phần này)

> **Task là đơn vị công việc dùng chung của toàn hệ thống.** Quy trình sản xuất video chỉ là **nguồn sinh task lớn nhất**, không phải chủ sở hữu của Task.

Một task được phân biệt bằng `task_type` (xem ERD bảng `tasks`), gom **7 nguồn**:

| `task_type` | Nguồn sinh ra | Gắn video/project? | Ví dụ |
| --- | --- | --- | --- |
| `production` | Workflow Instance của video | ✅ Bắt buộc | "Dựng video X", "Làm thumbnail" |
| `review` | Bước duyệt trong workflow | ✅ Bắt buộc | "Duyệt script video X" |
| `revision` | Defect / trả sửa | ✅ Bắt buộc | "Sửa lại voice video X" |
| `meeting_action` | Họp (module Communication) | ❌ Không | "Chuẩn bị báo cáo sau họp" |
| `office` | Giao tay thủ công | ❌ Không | Sếp giao việc bất kỳ |
| `finance` | Đề xuất / duyệt chi | ❌ Không | "Duyệt đề xuất chi 5tr" |
| `hr` | Đơn từ HR | ❌ Không | "Duyệt đơn nghỉ phép của A" |

Các cột `project_id`, `content_item_id`, `workflow_instance_id` trong bảng `tasks` là **nullable** — task `meeting_action / office / finance / hr` tồn tại **không cần** gắn video nào.

## View cần có

```text
Kanban
Table
Calendar
Timeline
My Tasks          ← gộp TẤT CẢ 7 loại của tôi
Team Tasks
Project Tasks     ← lọc theo task gắn project (production/review/revision)
Office Tasks      ← task không liên quan sản xuất (office/meeting_action)
Overdue Tasks
Waiting Review
Revision Tasks
```

Bộ lọc bắt buộc: **Loại task (`task_type`)** đặt ở đầu thanh filter, để người dùng tách rõ "việc sản xuất" và "việc văn phòng/duyệt/HR".

## Kanban mẫu

```text
Chưa bắt đầu | Đang làm | Chờ duyệt | Cần sửa | Đã duyệt | Hoàn thành
```

> Cột `Chờ duyệt / Cần sửa` chỉ áp dụng cho task có vòng duyệt (`production/review/revision`).
> Task `office / meeting_action / finance / hr` đi luồng rút gọn: `Chưa bắt đầu → Đang làm → Hoàn thành` (cột duyệt/sửa tự ẩn).

## Task Card hiển thị

```text
Tên task
Loại task (badge: Sản xuất / Họp / Văn phòng / Tài chính / HR)
Bối cảnh liên quan:
  • Nếu là production/review/revision → hiện Project / Video
  • Nếu là meeting_action            → hiện Cuộc họp nguồn
  • Nếu là office/finance/hr         → ẩn dòng này (không có video)
Người phụ trách
Deadline
Priority
Trạng thái
Số comment
File đính kèm
Có lỗi hay không (chỉ task có vòng duyệt)
```

## Task Detail Drawer

Khi bấm task, mở panel bên phải. Các nút hành động **hiện theo loại task**:

```text
Tên task
Mô tả
Người giao
Người nhận
Người duyệt        (chỉ task có vòng duyệt)
Deadline
Checklist
File nộp
Comment
Lịch sử

— Nút theo task_type —
production/review/revision : Nút nộp sản phẩm · Nút duyệt · Nút trả sửa
meeting_action / office     : Nút đánh dấu hoàn thành
finance / hr                : Nút duyệt · Nút từ chối (đẩy về module nguồn)
```

---

# 15. Web Screen 13: Approval Inbox / Hàng chờ duyệt

## Mục tiêu

Tập trung toàn bộ việc cần duyệt.

## Layout

```text
┌──────────────────────────────────────────────┐
│ Filter: Loại duyệt | Project | Kênh | Cấp   │
├──────────────────────────────────────────────┤
│ Danh sách chờ duyệt                          │
│ Tên sản phẩm | Người nộp | Cấp duyệt | Hạn  │
│ Project | Kênh | Trạng thái | Hành động      │
└──────────────────────────────────────────────┘
```

## Loại duyệt

```text
Video
Script
Thumbnail
SEO
Task
Chi phí
Nghỉ phép
Chấm công
Bảng lương
Tài liệu
```

## Hành động

```text
Xem chi tiết
Duyệt
Trả sửa
Từ chối
Chuyển người duyệt
Escalate lên cấp cao hơn
```

---

# 16. Web Screen 14: Revision / Defect Center

## Mục tiêu

Quản lý lỗi và trả sửa.

## Layout

```text
┌──────────────────────────────────────────────┐
│ Filter: Loại lỗi | Mức độ | Người phụ trách │
├──────────────────────────────────────────────┤
│ Danh sách lỗi                                │
│ Mã lỗi | Nội dung | Bước lỗi | Người chịu   │
│ Loại lỗi | Deadline sửa | KPI | Trạng thái  │
└──────────────────────────────────────────────┘
```

## Form tạo lỗi/trả sửa

```text
Project/video liên quan
Bước bị lỗi
Người chịu trách nhiệm
Loại lỗi: Cần sửa / Nghiêm trọng
Mức độ
Mô tả lỗi
File/hình minh chứng
Deadline sửa
Có ảnh hưởng KPI không
Có ảnh hưởng thưởng/phạt không
Phần bị khóa
Ghi chú cho người sửa
```

---

# 17. Web Screen 15: KPI & Evaluation

## Mục tiêu

Quản lý tiêu chí đánh giá, điểm số và KPI.

## Màn hình chính

```text
KPI cá nhân
KPI team
KPI phòng ban
KPI kênh
KPI project
Form đánh giá
Kết quả đánh giá
```

## KPI cá nhân

```text
Nhân sự
Tháng
Task hoàn thành
Tỷ lệ đúng deadline
Điểm chất lượng
Lỗi loại 1
Lỗi loại 2
Điểm KPI tổng
Đề xuất thưởng/phạt
```

## Evaluation Form Builder

```text
Tên form
Áp dụng cho loại nội dung
Áp dụng cho bước workflow
Vai trò được đánh giá
Tiêu chí
Thang điểm
Trọng số
Điều kiện đạt
Có ảnh hưởng KPI không
```

---

# 18. Web Screen 16: Attendance / Chấm công

## Mục tiêu

Quản lý chấm công toàn công ty.

## Màn hình

```text
Bảng công ngày
Bảng công tháng
Đơn bổ sung công
Cấu hình ca làm
Báo cáo đi muộn/về sớm
```

## Bảng công tháng

```text
Nhân sự
Phòng ban
Số ngày công
Đi muộn
Về sớm
Nghỉ phép
Thiếu check-in
Thiếu check-out
Trạng thái khóa công
```

## Hành động

```text
Duyệt bổ sung công
Từ chối bổ sung công
Khóa kỳ công
Xuất báo cáo
Đồng bộ sang bảng lương
```

---

# 19. Web Screen 17: Leave Management / Nghỉ phép

## Màn hình

```text
Danh sách đơn nghỉ
Lịch nghỉ team
Số ngày phép còn lại
Cấu hình loại nghỉ
```

## Form xin nghỉ

```text
Loại nghỉ
Từ ngày
Đến ngày
Tổng số ngày
Lý do
Người bàn giao
Task bị ảnh hưởng
File đính kèm
```

## Duyệt nghỉ

```text
Duyệt
Từ chối
Yêu cầu bổ sung
Ghi chú
```

---

# 20. Web Screen 18: Payroll / Bảng lương

## Mục tiêu

Quản lý lương, thưởng, phạt, phụ cấp, khấu trừ.

## Màn hình chính

```text
Kỳ lương
Bảng lương nháp
Bảng lương chờ duyệt
Bảng lương đã phát hành
Thưởng/phạt
Khiếu nại lương
```

## Bảng lương

```text
Nhân sự
Lương cơ bản
Công thực tế
KPI
Thưởng
Phạt
Phụ cấp
Khấu trừ
Tổng nhận
Trạng thái
```

## Payslip nhân viên

```text
Kỳ lương
Lương cơ bản
Thưởng
Phạt
Phụ cấp
Khấu trừ
Tổng nhận
Ghi chú
Nút xác nhận
Nút khiếu nại
```

---

# 21. Web Screen 19: Finance

## Màn hình chính

```text
Doanh thu
Chi phí
Phân bổ chi phí
Lợi nhuận
Đề xuất chi
Duyệt chi
Báo cáo tài chính
```

## Revenue Screen

```text
Kênh
Nền tảng
Project
Video
Kỳ ghi nhận
Số tiền
Người nhập
File đính kèm
Trạng thái
```

## Cost Screen

```text
Loại chi phí
Số tiền
Kênh liên quan
Project liên quan
Video liên quan
Phòng ban
Team
Người liên quan
Phương thức phân bổ
```

## Profit Dashboard

```text
Lợi nhuận công ty
Lợi nhuận theo kênh
Lợi nhuận theo project
Lợi nhuận theo video
Chi phí theo phòng ban
Chi phí theo team
```

---

# 22. Web Screen 20: Expense Request / Đề xuất chi

## Form tạo đề xuất chi

```text
Tên khoản chi
Loại chi phí
Số tiền
Đơn vị tiền
Lý do
Phòng ban
Kênh liên quan
Project liên quan
Video liên quan
Ngày cần chi
File báo giá/chứng từ
Người duyệt đề xuất
```

## Hành động

```text
Lưu nháp
Gửi duyệt
Duyệt
Từ chối
Yêu cầu bổ sung
Upload chứng từ sau chi
Ghi nhận vào chi phí
```

---

# 23. Web Screen 21: Meeting Management

## Màn hình

```text
Lịch họp
Phòng họp
Cuộc họp của tôi
Biên bản họp
Task sau họp
```

## Tạo cuộc họp

```text
Tiêu đề
Thời gian
Phòng họp vật lý
Link online
Người tham gia
Project/kênh liên quan
Agenda
File đính kèm
```

## Biên bản họp

```text
Nội dung thảo luận
Quyết định
Task sau họp
Người phụ trách
Deadline
File đính kèm
```

---

# 24. Web Screen 22: Chat

## Layout

```text
┌──────────────┬───────────────────────────────┐
│ Danh sách chat│ Nội dung chat                 │
│              │                               │
│ Cá nhân      │ Tin nhắn                      │
│ Project      │ File                          │
│ Kênh         │ Mention                       │
│ Phòng ban    │ Task reference                │
└──────────────┴───────────────────────────────┘
```

## Loại phòng chat

```text
Chat 1-1
Group thủ công
Group project
Group kênh
Group phòng ban
Group team
Group cuộc họp
```

## Chức năng

```text
Gửi tin nhắn
Gửi file
Mention
Reaction
Ghim tin
Tìm kiếm
Link task
Link project
Link video
```

---

# 25. Web Screen 23: Notification Center

## Màn hình

```text
Tất cả thông báo
Công việc
Duyệt
Trả sửa
Họp
Chấm công
Lương/thưởng
KPI
Tài chính
Kênh
Bảo mật
```

## Thông báo hiển thị

```text
Tiêu đề
Nội dung
Loại thông báo
Độ ưu tiên
Có bắt buộc không
Thời gian
Nút hành động nhanh
```

## Hành động nhanh

```text
Xem task
Duyệt ngay
Trả sửa
Xác nhận
Mở chat
Xem bảng lương
Xem lịch họp
```

---

# 26. Web Screen 24: System Settings

## Tabs

```text
Company Config
Role & Permission
Workflow Config
Notification Rule
Payroll Config
Finance Config
Channel Config
Audit Log
Security
```

## Role & Permission Screen

```text
Danh sách role
Danh sách permission
Gán role cho user
Gán scope
Gán quyền đặc biệt
Xem lịch sử phân quyền
```

## Audit Log Screen

```text
Người thực hiện
Hành động
Đối tượng
Thời gian
IP
Dữ liệu trước
Dữ liệu sau
Lý do
```

---

# 27. Mobile App — Cấu trúc tổng thể

## Bottom Navigation đề xuất

```text
Home
Task
Chat
Duyệt
Cá nhân
```

Hoặc bản mở rộng:

```text
Home
Task
Chat
Thông báo
Cá nhân
```

Phần “Duyệt” có thể hiển thị riêng với người có quyền duyệt.

---

# 28. Mobile Screen 1: Home

## Mục tiêu

Cho người dùng thấy việc quan trọng nhất trong ngày.

## Layout

```text
Xin chào, [Tên]

[Chấm công nhanh]

Task hôm nay
- Task 1
- Task 2
- Task quá hạn

Thông báo quan trọng
- Bị trả sửa
- Có lịch họp
- Bảng lương mới

Lịch hôm nay
- Họp 10:00
- Deadline 17:00

KPI tháng
- Điểm hiện tại
- Task hoàn thành
```

## Hành động nhanh

```text
Check-in / Check-out
Xem task
Mở chat
Duyệt nhanh
Xin nghỉ
Xem lịch họp
```

---

# 29. Mobile Screen 2: My Tasks

## Tabs

```text
Hôm nay
Sắp tới
Quá hạn
Chờ duyệt
Cần sửa
Hoàn thành
```

## Task Card

```text
Tên task
Project/video
Deadline
Trạng thái
Mức ưu tiên
Người giao
```

## Task Detail

```text
Mô tả
Checklist
File/link
Comment
Lịch sử
Nộp sản phẩm
Xin gia hạn
Chat với người giao
```

---

# 30. Mobile Screen 3: Submit Work / Nộp sản phẩm

## Form

```text
Task
Ghi chú
File upload
Link file
Checklist xác nhận
Nút nộp
```

## Checklist trước khi nộp

```text
Tôi đã kiểm tra yêu cầu
Tôi đã đính kèm đúng file
Tôi đã hoàn thành checklist
Tôi xác nhận sản phẩm sẵn sàng duyệt
```

---

# 31. Mobile Screen 4: Approval Inbox

## Dành cho

```text
Team Leader
Project Manager
Channel Manager
Trưởng phòng
Ban lãnh đạo
HR
Kế toán
```

## Tabs

```text
Chờ tôi duyệt
Đã duyệt
Đã trả sửa
Quá hạn duyệt
```

## Approval Card

```text
Tên sản phẩm/task
Người nộp
Project/kênh
Cấp duyệt
Deadline
Loại duyệt
```

## Hành động

```text
Duyệt
Trả sửa
Từ chối
Comment
Xem file
```

---

# 32. Mobile Screen 5: Return Revision / Trả sửa

## Form

```text
Bước bị lỗi
Người chịu trách nhiệm
Loại lỗi
Mức độ
Mô tả lỗi
Ảnh/file minh chứng
Deadline sửa
Ảnh hưởng KPI?
Ảnh hưởng thưởng/phạt?
Nút gửi trả sửa
```

## Lưu ý UX

Form mobile cần ngắn, dùng lựa chọn nhanh. Mô tả lỗi có thể nhập text hoặc voice note nếu sau này hỗ trợ.

---

# 33. Mobile Screen 6: Chat

## Tabs

```text
Tất cả
Cá nhân
Project
Kênh
Team
Phòng ban
```

## Chức năng

```text
Gửi tin nhắn
Gửi ảnh/file
Mention
Reaction
Ghim tin
Mở task được link
Mở project được link
```

## Chat detail

```text
Tên phòng chat
Danh sách thành viên
Tin nhắn
File
Task liên quan
Thông báo ghim
```

---

# 34. Mobile Screen 7: Notification Center

## Tabs

```text
Tất cả
Bắt buộc
Task
Duyệt
Trả sửa
Họp
Chấm công
Lương
KPI
Tài chính
Kênh
```

## Card thông báo

```text
Icon loại thông báo
Tiêu đề
Nội dung ngắn
Thời gian
Độ ưu tiên
Nút hành động nhanh
```

## Quy tắc

Thông báo bắt buộc không cho tắt.

---

# 35. Mobile Screen 8: Attendance / Chấm công

## Màn hình

```text
Trạng thái hôm nay
Giờ check-in
Giờ check-out
Vị trí nếu cần
Ca làm
Nút check-in/check-out
Lịch sử chấm công
Đơn bổ sung công
```

## Hành động

```text
Check-in
Check-out
Tạo đơn quên chấm công
Xem bảng công tháng
```

---

# 36. Mobile Screen 9: Leave Request / Xin nghỉ phép

## Form

```text
Loại nghỉ
Từ ngày
Đến ngày
Lý do
Người bàn giao việc
Task bị ảnh hưởng
File đính kèm
Nút gửi duyệt
```

## Màn hình phụ

```text
Số ngày phép còn lại
Đơn đã gửi
Đơn đang chờ duyệt
Đơn đã duyệt
Đơn bị từ chối
```

---

# 37. Mobile Screen 10: Meeting / Lịch họp

## Màn hình

```text
Lịch hôm nay
Lịch tuần
Cuộc họp sắp tới
Cuộc họp đã tham gia
Task sau họp
```

## Meeting Detail

```text
Tiêu đề
Thời gian
Phòng họp/link online
Người tham gia
Agenda
Biên bản
Task sau họp
Nút tham gia họp
```

---

# 38. Mobile Screen 11: Payslip / Bảng lương cá nhân

## Màn hình

```text
Kỳ lương
Tổng nhận
Lương cơ bản
Thưởng
Phạt
Phụ cấp
Khấu trừ
KPI liên quan
Nút xác nhận
Nút khiếu nại
```

## Lưu ý bảo mật

Mobile cần yêu cầu xác thực lại khi xem bảng lương:

```text
PIN
Face ID
Vân tay
Mật khẩu
```

---

# 39. Mobile Screen 12: KPI cá nhân

## Màn hình

```text
Điểm KPI tháng
Task hoàn thành
Tỷ lệ đúng deadline
Điểm chất lượng
Số lỗi loại 1
Số lỗi loại 2
Thưởng/phạt liên quan
Nhận xét quản lý
```

## Hành động

```text
Xem chi tiết
Gửi phản hồi
Xem lịch sử KPI
```

---

# 40. Mobile Screen 13: Project/Video Quick View

## Mục tiêu

Cho nhân sự và quản lý xem nhanh project/video liên quan.

## Nội dung

```text
Tên project/video
Trạng thái
Workflow hiện tại
Task của tôi
Người phụ trách
Deadline
File liên quan
Chat project
Lỗi/revision nếu có
```

Không cần đầy đủ như web.

---

# 41. Mobile Screen 14: Profile / Cá nhân

## Màn hình

```text
Thông tin cá nhân
Phòng ban
Chức vụ
Quản lý trực tiếp
Team
Chấm công
Nghỉ phép
KPI
Bảng lương
Cài đặt thông báo
Bảo mật tài khoản
Đăng xuất
```

---

# 42. Màn hình ưu tiên phát triển Web MVP

## Ưu tiên P0 — Bắt buộc

```text
Login
Dashboard cơ bản
Organization
Employee List/Detail
Role & Permission
Channel List/Detail
Project List/Detail
Content/Video Detail
Workflow Builder
Task Board
Approval Inbox
Revision/Defect Center
Notification Center
Chat
```

## Ưu tiên P1 — Rất cần

```text
KPI & Evaluation
Attendance
Leave Management
Payroll
Finance
Expense Request
Meeting Management
Audit Log
```

## Ưu tiên P2 — Sau MVP lõi

```text
Advanced Report
Advanced Channel Health
Advanced Payroll
Advanced Finance Allocation
Training
Recruitment
Equipment
Document Knowledge Base
```

---

# 43. Màn hình ưu tiên phát triển Mobile MVP

## P0 — Bắt buộc

```text
Login
Home
My Tasks
Task Detail
Submit Work
Approval Inbox
Return Revision
Chat
Notification
Attendance
Meeting
Profile
```

## P1 — Rất cần

```text
Leave Request
Payslip
KPI cá nhân
Project/Video Quick View
```

## P2 — Sau MVP

```text
Finance approval nâng cao
Channel dashboard mobile
Team dashboard mobile
Document viewer
Training mobile
Equipment request
```

---

# 44. Luồng người dùng quan trọng trên Web

## 44.1. Tạo project sản xuất nội dung

```text
Project List
→ Create Project
→ Chọn loại project
→ Gắn kênh
→ Gắn team/ekip
→ Thêm thành viên
→ Chọn content type
→ Chọn workflow
→ Tạo content/video
→ Hệ thống sinh task
→ Gửi thông báo
```

## 44.2. Quản lý một video

```text
Content/Video Detail
→ Xem workflow
→ Gán người từng bước
→ Theo dõi task
→ Nhận sản phẩm nộp
→ Duyệt hoặc trả sửa
→ Chấm điểm
→ Upload
→ Nhập chỉ số/doanh thu
```

## 44.3. Trả sửa

```text
Approval Inbox
→ Mở sản phẩm
→ Chọn Trả sửa
→ Chọn bước lỗi
→ Chọn người chịu trách nhiệm
→ Chọn loại lỗi
→ Nhập mô tả
→ Gửi revision
→ Hệ thống tạo task sửa
```

## 44.4. Tính KPI/lương

```text
Task hoàn thành
→ Evaluation Result
→ KPI Result
→ Bonus/Penalty
→ Payroll
→ Payslip
→ Nhân viên xác nhận
```

---

# 45. Luồng người dùng quan trọng trên Mobile

## 45.1. Nhân viên nhận task và nộp việc

```text
Home
→ My Tasks
→ Task Detail
→ Xem yêu cầu
→ Làm việc
→ Upload file/link
→ Submit Work
→ Nhận thông báo duyệt/trả sửa
```

## 45.2. Quản lý duyệt nhanh

```text
Notification
→ Approval Inbox
→ Mở sản phẩm
→ Xem file
→ Duyệt hoặc trả sửa
→ Comment
→ Gửi kết quả
```

## 45.3. Chấm công

```text
Home
→ Check-in
→ Làm việc
→ Check-out
→ Xem bảng công
```

## 45.4. Xin nghỉ

```text
Profile / Home
→ Leave Request
→ Chọn loại nghỉ
→ Chọn ngày
→ Nhập lý do
→ Gửi duyệt
→ Nhận thông báo kết quả
```

---

# 46. Component UI cần chuẩn hóa

## Component chung

```text
Data Table
Filter Bar
Search Box
Status Badge
Priority Badge
User Avatar
Role Badge
Permission Badge
Timeline
Kanban Board
File Upload
Comment Box
Approval Panel
Revision Form
KPI Card
Finance Card
Notification Card
Chat Bubble
Audit Log Item
```

## Status màu sắc gợi ý

```text
Draft: Xám
In Progress: Xanh dương
Waiting Review: Vàng
Approved: Xanh lá
Revision: Cam
Blocked: Đỏ
Completed: Xanh lá đậm
Cancelled: Xám đậm
Critical: Đỏ đậm
```

---

# 47. Thiết kế responsive

## Desktop

```text
Sidebar cố định
Main content rộng
Bảng dữ liệu lớn
Dashboard nhiều cột
Workflow canvas
Kanban board
```

## Tablet

```text
Sidebar thu gọn
Bảng chuyển thành card
Workflow xem dạng timeline
Dashboard 2 cột
```

## Mobile

```text
Bottom navigation
Card-based layout
Form ngắn
Action button nổi
Notification realtime
Không hiển thị bảng quá rộng
```

---

# 48. Kết luận thiết kế màn hình

MVP v1 nên tập trung vào 6 cụm màn hình quan trọng nhất:

```text
1. Quản trị tổ chức và phân quyền
2. Quản lý kênh
3. Quản lý project/video/content
4. Workflow/task/duyệt/trả sửa
5. KPI/lương/tài chính cơ bản
6. Chat/thông báo/mobile thao tác nhanh
```

Web app là nơi tạo và quản lý hệ thống.
Mobile app là nơi nhân viên và quản lý xử lý công việc hằng ngày.

Cách thiết kế này giúp hệ thống đủ dùng cho nội bộ trước, đồng thời vẫn có nền tảng để mở rộng thành SaaS sau này.
