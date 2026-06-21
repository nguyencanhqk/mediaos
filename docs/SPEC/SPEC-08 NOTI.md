# SPEC-08: THÔNG BÁO HỆ THỐNG

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · [SPEC-03 HR](<SPEC-03 HR.md>) · [SPEC-04 ATT](<SPEC-04 ATT.md>) · [SPEC-05 LEAVE](<SPEC-05 LEAVE.md>) · [SPEC-06 TASK](<SPEC-06 TASK.md>) · [SPEC-07 DASH](<SPEC-07 DASH.md>) · **SPEC-08 NOTI**
>
> **Liên quan:** [Thiết kế DB: DB-07 NOTI/DASH](<../DB/DB-07 NOTI DASH Database Design.md>) · [Sản phẩm: PRD-00 §9.7](<../PRD/PRD-00 Enterprise Management System .md>) · [Thiết kế API: API-07 NOTI](<../API Design/API-07_NOTI_API_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường                     | Nội dung                                                                |
| -------------------------- | ----------------------------------------------------------------------- |
| Mã tài liệu                | SPEC-08                                                                 |
| Tên tài liệu               | Thông báo hệ thống                                                      |
| Module code                | NOTI                                                                    |
| Tài liệu cha               | SPEC-01: Tổng quan hệ thống                                             |
| Module phụ thuộc trực tiếp | AUTH, HR                                                                |
| Module liên quan           | DASH, ATT, LEAVE, TASK, PAYROLL, RECRUIT, ASSET, ROOM, CHAT, SOCIAL, AI |
| Phiên bản                  | v1.0                                                                    |
| Trạng thái                 | Draft                                                                   |
| Giai đoạn                  | MVP Version 1.0                                                         |
| Người viết                 |                                                                         |
| Người duyệt                |                                                                         |
| Ngày tạo                   |                                                                         |
| Ngày cập nhật              |                                                                         |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết module **Thông báo hệ thống** của hệ thống quản lý doanh nghiệp nội bộ.

Module `NOTI` chịu trách nhiệm quản lý toàn bộ nghiệp vụ liên quan đến:

* Tạo thông báo khi có sự kiện quan trọng trong hệ thống.
* Gửi thông báo đến đúng người nhận.
* Hiển thị thông báo in-app cho người dùng.
* Quản lý trạng thái đã đọc/chưa đọc.
* Hiển thị số lượng thông báo chưa đọc.
* Hiển thị danh sách thông báo mới nhất.
* Cho phép người dùng đánh dấu đã đọc.
* Cho phép người dùng xem lịch sử thông báo.
* Cho phép Admin/HR cấu hình loại thông báo nếu được cấp quyền.
* Cung cấp dữ liệu thông báo cho Dashboard.
* Chuẩn bị khả năng mở rộng sang email, mobile push, realtime WebSocket và các kênh ngoài hệ thống ở giai đoạn sau.

Module `NOTI` là module dùng chung cho toàn bộ hệ thống. Các module nghiệp vụ như `HR`, `ATT`, `LEAVE`, `TASK`, `DASH`, `PAYROLL`, `RECRUIT`, `ASSET`, `ROOM`, `CHAT`, `SOCIAL` có thể phát sinh sự kiện và gọi `NOTI` để tạo thông báo.

---

## 3. Mối liên kết với các SPEC khác

### 3.1 Liên kết với [SPEC-01](<SPEC-01 Tổng quan.md>): Tổng quan hệ thống

Theo SPEC-01, module `NOTI` thuộc nhóm MVP Version 1.0.

Module `NOTI` có nhiệm vụ gửi thông báo cho người dùng khi có sự kiện quan trọng trong hệ thống.

Các nhóm thông báo chính trong MVP gồm:

* Thông báo tài khoản.
* Thông báo hồ sơ nhân sự.
* Thông báo hợp đồng sắp hết hạn.
* Thông báo chấm công.
* Thông báo điều chỉnh công.
* Thông báo nghỉ phép.
* Thông báo công việc/task.
* Thông báo dự án.
* Thông báo dashboard/cảnh báo hệ thống.
* Thông báo cấu hình hoặc lỗi hệ thống nếu cần.

---

### 3.2 Liên kết với [SPEC-02](<SPEC-02 AUTH.md>): AUTH

Module `NOTI` phụ thuộc vào `AUTH` để:

* Xác định người dùng nhận thông báo.
* Xác định user đang đăng nhập khi xem thông báo.
* Kiểm tra quyền truy cập danh sách thông báo.
* Kiểm tra user có active hay không trước khi gửi thông báo.
* Kiểm tra role và data scope nếu thông báo liên quan đến dữ liệu nhạy cảm.
* Gửi thông báo liên quan đến tài khoản như tạo tài khoản, khóa tài khoản, reset mật khẩu nếu cấu hình cho phép.

Ví dụ:

```text
AUTH tạo tài khoản cho nhân viên mới
→ AUTH phát event USER_CREATED
→ NOTI tạo thông báo cho user hoặc HR/Admin
→ Người nhận thấy thông báo trong hệ thống
```

---

### 3.3 Liên kết với [SPEC-03](<SPEC-03 HR.md>): HR

Module `NOTI` liên kết với `HR` để gửi thông báo khi:

* Hồ sơ nhân viên được tạo.
* Hồ sơ nhân viên được cập nhật.
* Employee gửi yêu cầu cập nhật hồ sơ cá nhân.
* HR duyệt hoặc từ chối yêu cầu cập nhật hồ sơ cá nhân.
* Nhân viên được đổi trạng thái.
* Hợp đồng sắp hết hạn.
* Hợp đồng đã hết hạn.
* Nhân viên sắp hết thử việc.
* Nhân viên mới vào làm.
* Nhân viên nghỉ việc.
* Phòng ban/chức vụ/quản lý trực tiếp thay đổi nếu cần thông báo.

Ví dụ:

```text
Employee gửi yêu cầu cập nhật số điện thoại
→ HR nhận thông báo có yêu cầu cần duyệt
→ HR duyệt yêu cầu
→ Employee nhận thông báo yêu cầu đã được duyệt
```

---

### 3.4 Liên kết với [SPEC-04](<SPEC-04 ATT.md>): ATT

Module `NOTI` liên kết với `ATT` để gửi thông báo khi:

* Nhân viên quên check-out.
* Nhân viên đi muộn nếu công ty muốn cảnh báo.
* Nhân viên bị ghi nhận vắng mặt.
* Nhân viên gửi yêu cầu điều chỉnh công.
* Manager/HR có yêu cầu điều chỉnh công cần duyệt.
* Yêu cầu điều chỉnh công được duyệt.
* Yêu cầu điều chỉnh công bị từ chối.
* HR/Admin điều chỉnh công trực tiếp.
* Có bất thường chấm công cần xử lý.
* Hệ thống tự động chấm công cho nhân viên đặc thù.
* Có lỗi đồng bộ thiết bị chấm công ở phase sau.

Ví dụ:

```text
Employee gửi yêu cầu điều chỉnh công
→ ATT phát event ATT_ADJUSTMENT_SUBMITTED
→ NOTI gửi thông báo cho Manager/HR có quyền duyệt
```

---

### 3.5 Liên kết với [SPEC-05](<SPEC-05 LEAVE.md>): LEAVE

Module `NOTI` liên kết với `LEAVE` để gửi thông báo khi:

* Employee gửi đơn nghỉ mới.
* Manager/HR có đơn nghỉ cần duyệt.
* Đơn nghỉ được duyệt.
* Đơn nghỉ bị từ chối.
* Đơn nghỉ bị hủy.
* Đơn nghỉ sắp tới ngày bắt đầu.
* Số ngày phép còn lại thấp.
* Số dư phép được điều chỉnh.
* Chính sách nghỉ phép được cập nhật nếu cần thông báo.

Ví dụ:

```text
Employee gửi đơn nghỉ phép
→ LEAVE xác định người duyệt là Direct Manager
→ LEAVE gọi NOTI tạo thông báo
→ Manager thấy thông báo “Bạn có một đơn nghỉ phép cần duyệt”
```

---

### 3.6 Liên kết với [SPEC-06](<SPEC-06 TASK.md>): TASK

Module `NOTI` liên kết với `TASK` để gửi thông báo khi:

* Người dùng được giao task mới.
* Task được cập nhật.
* Task đổi người phụ trách.
* Task đổi deadline.
* Task đổi độ ưu tiên.
* Task đổi trạng thái.
* Task có comment mới.
* Người dùng được mention trong comment.
* Task sắp đến hạn.
* Task quá hạn.
* Người dùng được thêm vào dự án.
* Thành viên bị xóa khỏi dự án.
* Project bị đóng, hủy hoặc lưu trữ.

Ví dụ:

```text
Manager tạo task và giao cho Employee A
→ TASK phát event TASK_ASSIGNED
→ NOTI tạo thông báo cho Employee A
→ Employee A thấy thông báo task mới
```

---

### 3.7 Liên kết với [SPEC-07](<SPEC-07 DASH.md>): DASH

Module `DASH` lấy dữ liệu từ `NOTI` để hiển thị:

* Số lượng thông báo chưa đọc.
* Danh sách thông báo mới nhất.
* Các cảnh báo cần xử lý.
* Widget thông báo mới.

Nguyên tắc:

* `DASH` chỉ hiển thị dữ liệu tóm tắt.
* `NOTI` chịu trách nhiệm tạo, lưu, đọc, đánh dấu đã đọc và quản lý thông báo.
* Khi user bấm thông báo trên Dashboard, hệ thống điều hướng sang màn hình chi tiết thông báo hoặc màn hình nghiệp vụ gốc.

Ví dụ:

```text
User mở Dashboard
→ DASH gọi NOTI lấy 5 thông báo mới nhất
→ Hiển thị widget “Thông báo mới”
→ User bấm vào thông báo task
→ Hệ thống mở chi tiết task trong module TASK
```

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

Module `NOTI` cần giúp doanh nghiệp:

1. Đảm bảo người dùng không bỏ lỡ các sự kiện quan trọng.
2. Giảm phụ thuộc vào email, tin nhắn ngoài hệ thống hoặc trao đổi thủ công.
3. Giúp Employee biết nhanh task mới, kết quả duyệt nghỉ, kết quả điều chỉnh công.
4. Giúp Manager biết nhanh các yêu cầu cần xử lý như đơn nghỉ, điều chỉnh công, task quá hạn.
5. Giúp HR theo dõi các sự kiện nhân sự, hợp đồng, chấm công, nghỉ phép.
6. Giúp Admin nắm được các cảnh báo cấu hình hoặc lỗi hệ thống.
7. Chuẩn hóa cách gửi thông báo giữa các module.
8. Hỗ trợ Dashboard hiển thị thông báo mới và số lượng chưa đọc.
9. Cho phép cấu hình loại thông báo nào được gửi, gửi cho ai và gửi qua kênh nào.
10. Tạo nền tảng mở rộng cho email, mobile push, realtime, digest và automation sau này.

---

### 4.2 Mục tiêu kỹ thuật

Module `NOTI` cần đảm bảo:

1. Mỗi thông báo có định danh duy nhất.
2. Mỗi thông báo có người nhận rõ ràng.
3. Mỗi thông báo gắn với module nguồn và sự kiện nguồn.
4. Có trạng thái đã đọc/chưa đọc.
5. Có thể đánh dấu một thông báo hoặc tất cả thông báo là đã đọc.
6. Có thể truy vấn danh sách thông báo theo user hiện tại.
7. Có thể lọc theo loại, trạng thái, module nguồn, mức độ ưu tiên và thời gian.
8. Backend luôn kiểm tra user chỉ xem được thông báo của chính mình, trừ Admin có quyền quản trị.
9. Có cơ chế tránh tạo thông báo trùng lặp trong các event lặp.
10. Có khả năng gửi thông báo bất đồng bộ qua queue/job.
11. Có thể mở rộng nhiều kênh gửi: in-app, email, mobile push, WebSocket.
12. Có thể lưu payload điều hướng để frontend mở đúng màn hình nghiệp vụ.
13. Có thể cấu hình template nội dung thông báo.
14. Có audit log cho thao tác quản trị/cấu hình.
15. Có thể lưu lịch sử gửi thất bại/thành công nếu dùng kênh ngoài hệ thống.

---

## 5. Phạm vi module

### 5.1 Bao gồm trong MVP

| Mã chức năng  | Tên chức năng                             | Độ ưu tiên |
| ------------- | ----------------------------------------- | ---------- |
| NOTI-FUNC-001 | Tạo thông báo in-app từ event hệ thống    | Rất cao    |
| NOTI-FUNC-002 | Xem danh sách thông báo của tôi           | Rất cao    |
| NOTI-FUNC-003 | Xem chi tiết thông báo                    | Cao        |
| NOTI-FUNC-004 | Đếm số thông báo chưa đọc                 | Rất cao    |
| NOTI-FUNC-005 | Đánh dấu một thông báo là đã đọc          | Rất cao    |
| NOTI-FUNC-006 | Đánh dấu tất cả thông báo là đã đọc       | Cao        |
| NOTI-FUNC-007 | Xóa/ẩn thông báo khỏi danh sách của tôi   | Trung bình |
| NOTI-FUNC-008 | Lọc thông báo theo trạng thái/loại/module | Cao        |
| NOTI-FUNC-009 | Điều hướng từ thông báo sang module gốc   | Rất cao    |
| NOTI-FUNC-010 | Gửi thông báo nghỉ phép                   | Rất cao    |
| NOTI-FUNC-011 | Gửi thông báo task/project                | Rất cao    |
| NOTI-FUNC-012 | Gửi thông báo chấm công/điều chỉnh công   | Cao        |
| NOTI-FUNC-013 | Gửi thông báo nhân sự/hợp đồng            | Cao        |
| NOTI-FUNC-014 | Cấu hình loại thông báo cơ bản            | Trung bình |
| NOTI-FUNC-015 | Cấu hình bật/tắt kênh thông báo           | Trung bình |
| NOTI-FUNC-016 | Quản lý template thông báo cơ bản         | Trung bình |
| NOTI-FUNC-017 | Ghi log gửi thông báo                     | Cao        |
| NOTI-FUNC-018 | API thông báo cho Dashboard               | Rất cao    |
| NOTI-FUNC-019 | Notification dropdown/header badge        | Rất cao    |
| NOTI-FUNC-020 | Job kiểm tra thông báo nhắc hạn/quá hạn   | Cao        |

---

### 5.2 Chưa bao gồm trong MVP nhưng cần thiết kế mở rộng

| Chức năng                                           | Giai đoạn |
| --------------------------------------------------- | --------- |
| Realtime notification qua WebSocket                 | Phase sau |
| Mobile push notification                            | Phase sau |
| Email notification nâng cao                         | Phase sau |
| Notification digest hằng ngày/tuần                  | Phase sau |
| Người dùng tự cấu hình preference thông báo cá nhân | Phase sau |
| Cấu hình quiet hours/không làm phiền                | Phase sau |
| Template đa ngôn ngữ                                | Phase sau |
| Gửi thông báo qua Slack/Microsoft Teams             | Phase sau |
| Notification rule engine nâng cao                   | Phase sau |
| Notification automation workflow                    | Phase sau |
| AI tóm tắt thông báo quan trọng                     | Phase 5   |
| Gộp thông báo thông minh                            | Phase sau |
| Phân tích tỷ lệ đọc thông báo                       | Phase sau |
| Retry nâng cao cho email/push thất bại              | Phase sau |

---

## 6. Nhóm người dùng liên quan

| Vai trò         | Mô tả trong module NOTI                                         |
| --------------- | --------------------------------------------------------------- |
| Super Admin     | Toàn quyền xem/cấu hình thông báo toàn hệ thống                 |
| Admin công ty   | Cấu hình thông báo trong phạm vi công ty nếu được cấp quyền     |
| HR              | Nhận và xử lý thông báo nhân sự, nghỉ phép, chấm công, hợp đồng |
| Manager         | Nhận thông báo cần duyệt/xử lý liên quan team                   |
| Employee        | Nhận thông báo cá nhân: task, nghỉ phép, chấm công, tài khoản   |
| Project Manager | Nhận thông báo liên quan dự án/task phụ trách                   |
| Payroll Officer | Nhận thông báo lương ở phase sau                                |
| Recruiter       | Nhận thông báo tuyển dụng ở phase sau                           |
| Asset Manager   | Nhận thông báo tài sản ở phase sau                              |
| Office Admin    | Nhận thông báo phòng họp/hành chính ở phase sau                 |

---

## 7. Khái niệm chính trong module

### 7.1 Notification

`Notification` là một bản ghi thông báo gửi đến một user cụ thể.

Một Notification thường gồm:

* Người nhận.
* Tiêu đề.
* Nội dung ngắn.
* Module nguồn.
* Event nguồn.
* Mức độ ưu tiên.
* Trạng thái đọc.
* Thời gian tạo.
* Link điều hướng.
* Payload liên quan.

Ví dụ:

```text
Tiêu đề: Bạn có task mới
Nội dung: Bạn được giao task “Thiết kế màn hình chấm công”
Module nguồn: TASK
Event: TASK_ASSIGNED
Người nhận: Employee A
Trạng thái: Unread
```

---

### 7.2 Notification Event

`Notification Event` là sự kiện phát sinh từ một module nghiệp vụ làm căn cứ tạo thông báo.

Ví dụ:

| Event                    | Module nguồn | Ý nghĩa                         |
| ------------------------ | ------------ | ------------------------------- |
| LEAVE_REQUEST_SUBMITTED  | LEAVE        | Employee gửi đơn nghỉ           |
| LEAVE_REQUEST_APPROVED   | LEAVE        | Đơn nghỉ được duyệt             |
| TASK_ASSIGNED            | TASK         | User được giao task             |
| TASK_MENTIONED           | TASK         | User được mention trong comment |
| ATT_ADJUSTMENT_SUBMITTED | ATT          | Có yêu cầu điều chỉnh công      |
| HR_CONTRACT_EXPIRING     | HR           | Hợp đồng sắp hết hạn            |
| AUTH_USER_CREATED        | AUTH         | Tài khoản được tạo              |

---

### 7.3 Notification Type

`Notification Type` là nhóm phân loại thông báo theo nghiệp vụ.

Giá trị đề xuất:

| Mã loại    | Tên hiển thị |
| ---------- | ------------ |
| System     | Hệ thống     |
| Account    | Tài khoản    |
| HR         | Nhân sự      |
| Attendance | Chấm công    |
| Leave      | Nghỉ phép    |
| Task       | Công việc    |
| Project    | Dự án        |
| Approval   | Phê duyệt    |
| Reminder   | Nhắc hạn     |
| Warning    | Cảnh báo     |
| Error      | Lỗi hệ thống |

---

### 7.4 Notification Channel

`Notification Channel` là kênh gửi thông báo.

Trong MVP ưu tiên `In-app`.

| Kênh        | Mã          | MVP                 | Mô tả                            |
| ----------- | ----------- | ------------------- | -------------------------------- |
| In-app      | IN_APP      | Có                  | Hiển thị trong hệ thống          |
| Email       | EMAIL       | Tùy cấu hình cơ bản | Gửi email, có thể phase sau      |
| Mobile Push | PUSH        | Phase sau           | Gửi push notification app mobile |
| WebSocket   | REALTIME    | Phase sau           | Đẩy realtime khi user online     |
| Slack/Teams | INTEGRATION | Phase sau           | Gửi qua công cụ bên ngoài        |

---

### 7.5 Notification Priority

`Notification Priority` là mức độ quan trọng của thông báo.

| Mã       | Tên          | Ý nghĩa                        |
| -------- | ------------ | ------------------------------ |
| Low      | Thấp         | Thông báo ít quan trọng        |
| Normal   | Bình thường  | Thông báo mặc định             |
| High     | Cao          | Cần chú ý                      |
| Urgent   | Khẩn cấp     | Cần xử lý ngay                 |
| Critical | Nghiêm trọng | Cảnh báo hệ thống hoặc bảo mật |

---

### 7.6 Notification Status

Trạng thái thông báo theo từng người nhận.

| Trạng thái | Mã       | Ý nghĩa                                       |
| ---------- | -------- | --------------------------------------------- |
| Chưa đọc   | Unread   | Người nhận chưa mở/đọc                        |
| Đã đọc     | Read     | Người nhận đã đọc                             |
| Đã ẩn      | Hidden   | Người nhận ẩn khỏi danh sách                  |
| Đã lưu trữ | Archived | Lưu trữ, không hiện mặc định                  |
| Đã xóa mềm | Deleted  | Xóa mềm theo user                             |
| Gửi lỗi    | Failed   | Dành cho kênh ngoài hệ thống nếu gửi thất bại |

---

### 7.7 Notification Template

`Notification Template` là mẫu nội dung dùng để tạo thông báo.

Ví dụ template:

```text
Tiêu đề: Bạn có một đơn nghỉ cần duyệt
Nội dung: {employee_name} đã gửi đơn nghỉ từ {start_date} đến {end_date}.
```

Template có thể chứa biến:

* `{employee_name}`
* `{task_title}`
* `{project_name}`
* `{leave_request_code}`
* `{start_date}`
* `{end_date}`
* `{approver_name}`
* `{status}`
* `{deadline}`

---

### 7.8 Target Link / Deep Link

`Target Link` hoặc `Deep Link` là thông tin điều hướng khi người dùng bấm vào thông báo.

Ví dụ:

```json
{
  "target_module": "LEAVE",
  "target_type": "LeaveRequest",
  "target_id": "leave-request-id",
  "target_url": "/leave/requests/leave-request-id"
}
```

Nguyên tắc:

* Nếu người dùng có quyền xem target, điều hướng đến màn hình chi tiết.
* Nếu không có quyền, hiển thị thông báo không có quyền.
* Không để lộ dữ liệu nhạy cảm trong URL hoặc payload.

---

## 8. Quyền trong module NOTI

### 8.1 Quy ước mã quyền

Cấu trúc:

```text
NOTI.RESOURCE.ACTION
```

Ví dụ:

```text
NOTI.NOTIFICATION.VIEW_OWN
NOTI.NOTIFICATION.MARK_READ
NOTI.CONFIG.UPDATE
```

---

### 8.2 Danh sách quyền NOTI trong MVP

| Mã quyền                            | Mô tả                                          |
| ----------------------------------- | ---------------------------------------------- |
| NOTI.NOTIFICATION.VIEW_OWN          | Xem thông báo của chính mình                   |
| NOTI.NOTIFICATION.VIEW_DETAIL_OWN   | Xem chi tiết thông báo của chính mình          |
| NOTI.NOTIFICATION.COUNT_UNREAD_OWN  | Xem số lượng thông báo chưa đọc của chính mình |
| NOTI.NOTIFICATION.MARK_READ_OWN     | Đánh dấu thông báo của mình là đã đọc          |
| NOTI.NOTIFICATION.MARK_ALL_READ_OWN | Đánh dấu tất cả thông báo của mình là đã đọc   |
| NOTI.NOTIFICATION.HIDE_OWN          | Ẩn thông báo của mình                          |
| NOTI.NOTIFICATION.DELETE_OWN        | Xóa mềm thông báo của mình                     |
| NOTI.NOTIFICATION.VIEW_COMPANY      | Xem thông báo toàn công ty nếu được cấp quyền  |
| NOTI.NOTIFICATION.CREATE_SYSTEM     | Tạo thông báo hệ thống thủ công                |
| NOTI.NOTIFICATION.SEND_SYSTEM       | Gửi thông báo hệ thống thủ công                |
| NOTI.EVENT.VIEW                     | Xem danh sách event thông báo (gồm cả loại/type) |
| NOTI.EVENT.CONFIG                   | Cấu hình event thông báo (bật/tắt event, loại)  |
| NOTI.TEMPLATE.VIEW                  | Xem template thông báo                         |
| NOTI.TEMPLATE.UPDATE                | Cập nhật template thông báo                    |
| NOTI.CHANNEL.VIEW                   | Xem cấu hình kênh thông báo                    |
| NOTI.CHANNEL.UPDATE                 | Cập nhật cấu hình kênh thông báo               |
| NOTI.LOG.VIEW                       | Xem log gửi thông báo                          |
| NOTI.AUDIT_LOG.VIEW                 | Xem audit log module NOTI                      |

---

## 9. Ma trận phân quyền MVP

| Chức năng                       | Super Admin | Admin công ty   | HR              | Manager | Employee |
| ------------------------------- | ----------- | --------------- | --------------- | ------- | -------- |
| Xem thông báo của mình          | Có          | Có              | Có              | Có      | Có       |
| Xem chi tiết thông báo của mình | Có          | Có              | Có              | Có      | Có       |
| Đếm thông báo chưa đọc          | Có          | Có              | Có              | Có      | Có       |
| Đánh dấu đã đọc                 | Có          | Có              | Có              | Có      | Có       |
| Đánh dấu tất cả đã đọc          | Có          | Có              | Có              | Có      | Có       |
| Ẩn/xóa mềm thông báo của mình   | Có          | Có              | Có              | Có      | Có       |
| Xem log thông báo toàn công ty  | Có          | Có nếu được cấp | Không mặc định  | Không   | Không    |
| Tạo thông báo hệ thống thủ công | Có          | Có nếu được cấp | Không mặc định  | Không   | Không    |
| Cấu hình loại thông báo         | Có          | Có nếu được cấp | Có nếu được cấp | Không   | Không    |
| Cấu hình template thông báo     | Có          | Có nếu được cấp | Có nếu được cấp | Không   | Không    |
| Cấu hình kênh gửi               | Có          | Có nếu được cấp | Không mặc định  | Không   | Không    |
| Xem audit log NOTI              | Có          | Có nếu được cấp | Không mặc định  | Không   | Không    |

---

## 10. Danh sách chức năng chi tiết

| Mã chức năng  | Tên chức năng                   | Mô tả ngắn                                     |
| ------------- | ------------------------------- | ---------------------------------------------- |
| NOTI-FUNC-001 | Tạo thông báo từ event          | Module nguồn gửi event, NOTI tạo notification  |
| NOTI-FUNC-002 | Xem danh sách thông báo của tôi | User xem các thông báo gửi cho mình            |
| NOTI-FUNC-003 | Xem chi tiết thông báo          | User mở chi tiết thông báo                     |
| NOTI-FUNC-004 | Đếm thông báo chưa đọc          | Trả số lượng unread cho header/dashboard       |
| NOTI-FUNC-005 | Đánh dấu đã đọc                 | Chuyển một notification sang Read              |
| NOTI-FUNC-006 | Đánh dấu tất cả đã đọc          | Chuyển toàn bộ notification của user sang Read |
| NOTI-FUNC-007 | Ẩn/xóa mềm thông báo            | User ẩn thông báo khỏi danh sách               |
| NOTI-FUNC-008 | Lọc thông báo                   | Lọc theo trạng thái, loại, module, thời gian   |
| NOTI-FUNC-009 | Điều hướng từ thông báo         | Mở màn hình nghiệp vụ gốc                      |
| NOTI-FUNC-010 | Thông báo nghỉ phép             | Event từ LEAVE                                 |
| NOTI-FUNC-011 | Thông báo task/project          | Event từ TASK                                  |
| NOTI-FUNC-012 | Thông báo chấm công             | Event từ ATT                                   |
| NOTI-FUNC-013 | Thông báo nhân sự/hợp đồng      | Event từ HR                                    |
| NOTI-FUNC-014 | Cấu hình loại thông báo         | Bật/tắt loại thông báo                         |
| NOTI-FUNC-015 | Cấu hình kênh gửi               | Bật/tắt in-app/email/push                      |
| NOTI-FUNC-016 | Quản lý template                | Cấu hình nội dung thông báo                    |
| NOTI-FUNC-017 | Log gửi thông báo               | Lưu trạng thái tạo/gửi                         |
| NOTI-FUNC-018 | API cho Dashboard               | Cung cấp số unread và list mới nhất            |
| NOTI-FUNC-019 | Header notification dropdown    | Hiển thị ở thanh header                        |
| NOTI-FUNC-020 | Job nhắc hạn/quá hạn            | Tạo thông báo cho task/leave/contract sắp hạn  |

---

## 11. Luồng nghiệp vụ tổng quan

### 11.1 Luồng tạo thông báo từ event hệ thống

```text
Module nguồn phát sinh sự kiện
→ Module nguồn gọi Notification Service hoặc publish event
→ NOTI nhận event
→ NOTI xác định loại thông báo
→ NOTI xác định người nhận
→ NOTI lấy template phù hợp
→ NOTI render nội dung thông báo
→ NOTI tạo notification record cho từng người nhận
→ NOTI ghi notification log
→ Người nhận thấy thông báo trong hệ thống
```

Ví dụ:

```text
TASK tạo task mới
→ Event TASK_ASSIGNED
→ Người nhận là assignee
→ NOTI tạo thông báo “Bạn có task mới”
→ Assignee thấy thông báo chưa đọc
```

---

### 11.2 Luồng xem danh sách thông báo của tôi

```text
User đăng nhập
→ Bấm biểu tượng thông báo trên header hoặc vào menu Thông báo
→ Frontend gọi API danh sách thông báo
→ NOTI xác định user_id hiện tại
→ Hệ thống lấy notification có recipient_user_id = user hiện tại
→ Áp dụng bộ lọc nếu có
→ Sắp xếp mới nhất trước
→ Trả danh sách thông báo
```

---

### 11.3 Luồng xem chi tiết thông báo

```text
User mở một thông báo
→ Hệ thống kiểm tra thông báo thuộc về user hiện tại
→ Nếu hợp lệ, hiển thị chi tiết thông báo
→ Nếu cấu hình auto mark as read, hệ thống chuyển trạng thái sang Read
→ User có thể bấm mở nghiệp vụ liên quan
```

---

### 11.4 Luồng đánh dấu một thông báo là đã đọc

```text
User mở danh sách thông báo
→ Chọn thông báo chưa đọc
→ Bấm Đánh dấu đã đọc
→ Hệ thống kiểm tra quyền sở hữu notification
→ Hệ thống cập nhật trạng thái Read
→ Cập nhật unread count
```

---

### 11.5 Luồng đánh dấu tất cả thông báo là đã đọc

```text
User mở danh sách thông báo
→ Bấm Đánh dấu tất cả đã đọc
→ Hệ thống xác nhận nếu cần
→ Hệ thống cập nhật toàn bộ notification Unread của user sang Read
→ Cập nhật unread count = 0
```

---

### 11.6 Luồng điều hướng từ thông báo sang module gốc

```text
User bấm vào thông báo
→ Frontend đọc target_module, target_type, target_id, target_url
→ Gọi API kiểm tra quyền hoặc mở route tương ứng
→ Module gốc kiểm tra quyền truy cập dữ liệu
→ Nếu có quyền, mở màn hình chi tiết
→ Nếu không có quyền, hiển thị thông báo không có quyền
```

Ví dụ:

```text
User bấm thông báo “Bạn có đơn nghỉ cần duyệt”
→ Mở LEAVE-SCREEN-004 Chi tiết đơn nghỉ phép
```

---

### 11.7 Luồng cấu hình loại thông báo

```text
Admin/HR có quyền vào Cấu hình thông báo
→ Chọn loại thông báo
→ Bật/tắt loại thông báo
→ Chọn kênh gửi
→ Cấu hình người nhận mặc định nếu có
→ Lưu cấu hình
→ Hệ thống ghi audit log
```

---

### 11.8 Luồng job nhắc hạn/quá hạn

```text
Scheduler chạy theo lịch cấu hình
→ Kiểm tra task sắp đến hạn/quá hạn
→ Kiểm tra hợp đồng sắp hết hạn
→ Kiểm tra đơn nghỉ sắp tới ngày bắt đầu nếu cần
→ Loại bỏ event đã gửi gần đây để tránh spam
→ Tạo notification cho người nhận phù hợp
→ Ghi log job
```

---

## 12. Danh sách màn hình

| Mã màn hình     | Tên màn hình                    | Người dùng truy cập        |
| --------------- | ------------------------------- | -------------------------- |
| NOTI-SCREEN-001 | Notification Dropdown/Header    | Tất cả user đã đăng nhập   |
| NOTI-SCREEN-002 | Danh sách thông báo của tôi     | Tất cả user đã đăng nhập   |
| NOTI-SCREEN-003 | Chi tiết thông báo              | Chủ sở hữu thông báo       |
| NOTI-SCREEN-004 | Cài đặt thông báo cá nhân       | Phase sau                  |
| NOTI-SCREEN-005 | Quản lý loại thông báo          | Admin/HR có quyền          |
| NOTI-SCREEN-006 | Quản lý template thông báo      | Admin/HR có quyền          |
| NOTI-SCREEN-007 | Cấu hình kênh gửi thông báo     | Admin có quyền             |
| NOTI-SCREEN-008 | Log gửi thông báo               | Admin/Super Admin có quyền |
| NOTI-SCREEN-009 | Tạo thông báo hệ thống thủ công | Admin/Super Admin có quyền |
| NOTI-SCREEN-010 | Notification Empty/Error State  | Tất cả user                |

---

## 13. Chi tiết màn hình

### 13.1 NOTI-SCREEN-001: Notification Dropdown/Header

#### Mục đích

Hiển thị nhanh số lượng thông báo chưa đọc và danh sách thông báo mới nhất ngay trên header hệ thống.

#### Người dùng truy cập

Tất cả user đã đăng nhập.

#### Thành phần giao diện

* Icon chuông thông báo.
* Badge số lượng unread.
* Dropdown danh sách thông báo mới nhất.
* Tab hoặc filter nhanh: Tất cả / Chưa đọc.
* Link “Xem tất cả”.
* Nút “Đánh dấu tất cả đã đọc”.
* Empty state nếu không có thông báo.
* Loading state khi đang tải.
* Error state nếu API lỗi.

#### Dữ liệu hiển thị

| Trường          | Mô tả           |
| --------------- | --------------- |
| notification_id | ID thông báo    |
| title           | Tiêu đề         |
| short_content   | Nội dung ngắn   |
| type            | Loại thông báo  |
| priority        | Mức độ ưu tiên  |
| source_module   | Module nguồn    |
| is_read         | Đã đọc/chưa đọc |
| created_at      | Thời gian tạo   |
| target_url      | Link điều hướng |

#### Quy tắc

* Chỉ hiển thị thông báo của user hiện tại.
* Mặc định hiển thị 5–10 thông báo mới nhất.
* Thông báo chưa đọc cần có style nổi bật.
* Badge chỉ đếm thông báo chưa đọc chưa bị hidden/deleted.
* Không hiển thị nội dung nhạy cảm nếu user không còn quyền xem target.
* Bấm thông báo có thể tự đánh dấu đã đọc nếu cấu hình cho phép.

---

### 13.2 NOTI-SCREEN-002: Danh sách thông báo của tôi

#### Mục đích

Cho phép user xem toàn bộ thông báo của mình, tìm kiếm, lọc và xử lý trạng thái đọc.

#### Người dùng truy cập

Tất cả user đã đăng nhập.

#### Thành phần giao diện

* Tiêu đề: Thông báo.
* Ô tìm kiếm.
* Bộ lọc trạng thái.
* Bộ lọc loại thông báo.
* Bộ lọc module nguồn.
* Bộ lọc mức độ ưu tiên.
* Bộ lọc thời gian.
* Danh sách hoặc bảng thông báo.
* Nút đánh dấu tất cả đã đọc.
* Nút ẩn/xóa thông báo.
* Phân trang hoặc infinite scroll.
* Empty state.
* Error state.

#### Bộ lọc

| Bộ lọc         | Mô tả                               |
| -------------- | ----------------------------------- |
| Từ khóa        | Tìm theo tiêu đề/nội dung           |
| Trạng thái     | Unread/Read/Archived                |
| Loại thông báo | System/HR/Leave/Task/Attendance/... |
| Module nguồn   | AUTH/HR/ATT/LEAVE/TASK/DASH         |
| Mức độ ưu tiên | Low/Normal/High/Urgent/Critical     |
| Thời gian      | Từ ngày - đến ngày                  |

#### Cột hiển thị

| Cột        | Mô tả                        |
| ---------- | ---------------------------- |
| Tiêu đề    | notification.title           |
| Nội dung   | notification.content rút gọn |
| Loại       | notification.type            |
| Module     | source_module                |
| Mức độ     | priority                     |
| Trạng thái | Read/Unread                  |
| Thời gian  | created_at                   |
| Hành động  | Xem/Đánh dấu đã đọc/Ẩn       |

---

### 13.3 NOTI-SCREEN-003: Chi tiết thông báo

#### Mục đích

Hiển thị đầy đủ nội dung một thông báo.

#### Nội dung hiển thị

* Tiêu đề thông báo.
* Nội dung chi tiết.
* Loại thông báo.
* Mức độ ưu tiên.
* Module nguồn.
* Thời gian tạo.
* Trạng thái đọc.
* Người gửi hoặc hệ thống gửi.
* Nút mở nghiệp vụ liên quan.
* Metadata nếu cần hiển thị.
* Lịch sử gửi nếu là Admin xem log.

#### Hành động

| Hành động             | Mô tả                               |
| --------------------- | ----------------------------------- |
| Mở chi tiết liên quan | Điều hướng sang module gốc          |
| Đánh dấu đã đọc       | Chuyển trạng thái Read              |
| Đánh dấu chưa đọc     | Tùy cấu hình                        |
| Ẩn thông báo          | Không hiển thị ở danh sách mặc định |
| Quay lại              | Về danh sách thông báo              |

---

### 13.4 NOTI-SCREEN-005: Quản lý loại thông báo

#### Mục đích

Cho phép Admin/HR có quyền cấu hình các loại thông báo của hệ thống.

#### Người dùng truy cập

* Super Admin.
* Admin công ty có quyền.
* HR có quyền nếu được cấp.

#### Dữ liệu hiển thị

| Trường                 | Mô tả             |
| ---------------------- | ----------------- |
| notification_type_code | Mã loại           |
| notification_type_name | Tên loại          |
| source_module          | Module nguồn      |
| default_priority       | Mức độ mặc định   |
| enabled                | Bật/tắt           |
| default_channel        | Kênh mặc định     |
| description            | Mô tả             |
| updated_at             | Cập nhật gần nhất |

#### Hành động

| Hành động              | Permission         |
| ---------------------- | ------------------ |
| Xem danh sách          | NOTI.EVENT.VIEW    |
| Cập nhật loại          | NOTI.EVENT.CONFIG  |
| Bật/tắt loại           | NOTI.EVENT.CONFIG  |
| Xem template liên quan | NOTI.TEMPLATE.VIEW |

---

### 13.5 NOTI-SCREEN-006: Quản lý template thông báo

#### Mục đích

Cho phép cấu hình mẫu tiêu đề và nội dung thông báo theo từng event.

#### Trường dữ liệu

| Trường           | Kiểu dữ liệu | Bắt buộc | Ghi chú               |
| ---------------- | ------------ | -------- | --------------------- |
| template_code    | String       | Có       | Unique                |
| event_code       | String       | Có       | Event liên quan       |
| title_template   | String       | Có       | Tiêu đề có biến       |
| content_template | Text         | Có       | Nội dung có biến      |
| short_template   | String       | Không    | Nội dung ngắn         |
| language         | String       | Không    | Mặc định vi           |
| channel          | Select       | Có       | IN_APP/EMAIL/PUSH     |
| enabled          | Boolean      | Có       | Bật/tắt               |
| variables        | JSON         | Không    | Danh sách biến hỗ trợ |

#### Validate

| Trường hợp                     | Xử lý                                           |
| ------------------------------ | ----------------------------------------------- |
| Thiếu event_code               | Báo lỗi                                         |
| Thiếu title_template           | Báo lỗi                                         |
| Biến không hợp lệ              | Báo lỗi hoặc cảnh báo                           |
| Template trùng event + channel | Không cho lưu nếu không cho phép nhiều template |
| Nội dung quá dài               | Báo lỗi theo giới hạn cấu hình                  |

---

### 13.6 NOTI-SCREEN-007: Cấu hình kênh gửi thông báo

#### Mục đích

Cấu hình kênh nào được dùng để gửi thông báo.

#### Trường cấu hình

| Trường                  | Kiểu dữ liệu    | Mô tả                          |
| ----------------------- | --------------- | ------------------------------ |
| channel                 | Select          | IN_APP/EMAIL/PUSH/REALTIME     |
| enabled                 | Boolean         | Bật/tắt kênh                   |
| default_enabled_for_all | Boolean         | Mặc định bật cho toàn hệ thống |
| retry_enabled           | Boolean         | Có retry nếu gửi lỗi           |
| max_retry               | Integer         | Số lần retry                   |
| provider                | String          | Nhà cung cấp email/push nếu có |
| sender_name             | String          | Tên người gửi                  |
| sender_email            | String          | Email gửi nếu là email         |
| rate_limit_per_minute   | Integer         | Giới hạn gửi                   |
| status                  | Active/Inactive | Trạng thái cấu hình            |

MVP đề xuất:

```text
IN_APP: Bắt buộc có.
EMAIL: Có thể cấu hình nhưng chưa bắt buộc triển khai đầy đủ.
PUSH/REALTIME: Thiết kế dữ liệu sẵn, triển khai phase sau.
```

---

### 13.7 NOTI-SCREEN-008: Log gửi thông báo

#### Mục đích

Cho phép Admin/Super Admin xem lịch sử tạo/gửi thông báo để kiểm tra lỗi.

#### Bộ lọc

| Bộ lọc         | Mô tả                       |
| -------------- | --------------------------- |
| Từ khóa        | Tìm theo title, recipient   |
| Module nguồn   | AUTH/HR/ATT/LEAVE/TASK/DASH |
| Event          | Event code                  |
| Kênh           | IN_APP/EMAIL/PUSH           |
| Trạng thái gửi | Pending/Sent/Delivered/Failed/Skipped/Cancelled (`delivery_status`, DB-07 §7.4) |
| Người nhận     | recipient_user_id           |
| Thời gian      | Từ ngày - đến ngày          |

#### Cột hiển thị

| Cột          | Mô tả         |
| ------------ | ------------- |
| Thời gian    | created_at    |
| Event        | event_code    |
| Module nguồn | source_module |
| Người nhận   | recipient     |
| Kênh         | channel       |
| Trạng thái   | status        |
| Lỗi          | error_message |
| Hành động    | Xem chi tiết  |

---

### 13.8 NOTI-SCREEN-009: Tạo thông báo hệ thống thủ công

#### Mục đích

Cho phép Admin/Super Admin tạo thông báo hệ thống gửi đến một nhóm người dùng.

#### Người dùng truy cập

* Super Admin.
* Admin công ty có quyền `NOTI.NOTIFICATION.CREATE_SYSTEM`.

#### Form dữ liệu

| Trường               | Kiểu dữ liệu | Bắt buộc               | Ghi chú                         |
| -------------------- | ------------ | ---------------------- | ------------------------------- |
| title                | String       | Có                     | Tiêu đề thông báo               |
| content              | Text         | Có                     | Nội dung                        |
| target_audience_type | Select       | Có                     | All/Role/Department/User        |
| target_roles         | Multi-select | Có nếu chọn Role       | Vai trò nhận                    |
| target_departments   | Multi-select | Có nếu chọn Department | Phòng ban nhận                  |
| target_users         | Multi-select | Có nếu chọn User       | User cụ thể                     |
| priority             | Select       | Có                     | Normal mặc định                 |
| channel              | Multi-select | Có                     | IN_APP mặc định                 |
| send_at              | DateTime     | Không                  | Gửi ngay hoặc hẹn giờ phase sau |
| target_url           | String       | Không                  | Link liên quan                  |
| require_confirmation | Boolean      | Không                  | Phase sau                       |

#### Quy tắc

* Không cho gửi tới user inactive/locked nếu cấu hình chặn.
* Gửi toàn công ty phải có quyền cao.
* Nội dung không được rỗng.
* Phải hiển thị xác nhận trước khi gửi số lượng lớn.
* Hệ thống ghi audit log đầy đủ.

---

### 13.9 NOTI-SCREEN-010: Notification Empty/Error State

#### Mục đích

Chuẩn hóa cách hiển thị các trạng thái không có dữ liệu, đang tải và tải lỗi của thông báo trên toàn hệ thống, áp dụng cho cả dropdown header (NOTI-SCREEN-001) và danh sách thông báo của tôi (NOTI-SCREEN-002), giúp người dùng hiểu rõ tình huống và có hành động phù hợp thay vì gặp màn hình trống hoặc UI bị crash.

#### Người dùng truy cập

Tất cả user đã đăng nhập.

#### Thành phần giao diện

* Khối trạng thái rỗng (empty state): icon, tiêu đề, mô tả ngắn.
* Khối trạng thái đang tải (loading state): skeleton/spinner thay cho danh sách.
* Khối trạng thái lỗi (error state): icon lỗi, thông điệp lỗi, nút thử lại.
* Nút “Thử lại” trong error state.
* Link “Xem tất cả thông báo” hoặc “Về danh sách” tùy ngữ cảnh.
* Giữ nguyên bộ lọc/từ khóa hiện tại khi hiển thị empty/error để user tinh chỉnh lại.

#### Các trạng thái và nội dung hiển thị

| Trạng thái             | Điều kiện kích hoạt                               | Thông điệp gợi ý                          | Hành động khả dụng | Mã lỗi liên quan |
| ---------------------- | ------------------------------------------------- | ----------------------------------------- | ------------------ | ---------------- |
| Empty – chưa có gì     | User chưa từng nhận thông báo nào                 | Bạn chưa có thông báo nào                 | Không              | —                |
| Empty – theo bộ lọc    | Có thông báo nhưng không khớp bộ lọc/từ khóa      | Không có thông báo phù hợp với bộ lọc     | Xóa bộ lọc         | —                |
| Empty – đã đọc hết     | Filter “Chưa đọc” nhưng không còn unread          | Bạn đã đọc hết thông báo                  | Bỏ filter Chưa đọc | —                |
| Loading                | Đang gọi API danh sách/đếm unread                 | Đang tải thông báo...                     | Không (chờ)        | —                |
| Error – tải thất bại   | API danh sách/unread-count lỗi hoặc timeout       | Không thể tải thông báo, vui lòng thử lại | Thử lại            | `AUTH-ERR-INTERNAL` (lỗi tải chung) |
| Error – không có quyền | Thiếu quyền `NOTI.NOTIFICATION.VIEW_OWN`          | Bạn không có quyền xem thông báo này      | Về trang chủ       | `AUTH-ERR-FORBIDDEN` |
| Error – không tồn tại  | Mở chi tiết một thông báo đã bị xóa/không tồn tại | Không tìm thấy thông báo                  | Về danh sách       | `NOTI-ERR-NOTIFICATION-NOT-FOUND` |
| Error – đã bị xóa      | Thông báo đã bị xóa mềm khi mở chi tiết           | Thông báo này đã bị xóa                   | Về danh sách       | `NOTI-ERR-NOTIFICATION-DELETED` |

#### Hành động

| Hành động    | Mô tả                                                |
| ------------ | ---------------------------------------------------- |
| Thử lại      | Gọi lại API tải danh sách/đếm unread sau khi gặp lỗi |
| Xóa bộ lọc   | Đặt lại bộ lọc/từ khóa để tải lại toàn bộ danh sách  |
| Về danh sách | Quay lại NOTI-SCREEN-002 khi chi tiết không hợp lệ   |
| Về trang chủ | Điều hướng khỏi màn hình khi không có quyền          |

#### Quy tắc

* Khi danh sách trả về rỗng, hiển thị empty state thay vì màn hình trắng; phân biệt rõ “chưa có thông báo” và “không khớp bộ lọc”.
* Loading state phải thay thế vùng danh sách, không che toàn bộ màn hình và không chặn thao tác header khác.
* Error state phải hiển thị thông điệp thân thiện, không lộ chi tiết kỹ thuật, không lộ dữ liệu nhạy cảm và không làm crash UI (xem §22 tiêu chí 22).
* Nút “Thử lại” gọi lại đúng API đã lỗi (NOTI-API-001 danh sách / NOTI-API-002 dropdown / NOTI-API-003 unread-count) và quay về loading trước khi hiển thị kết quả.
* Lỗi không có quyền dùng `AUTH-ERR-FORBIDDEN`; lỗi tải dữ liệu chung dùng `AUTH-ERR-INTERNAL`; mở chi tiết không tồn tại dùng `NOTI-ERR-NOTIFICATION-NOT-FOUND`; thông báo đã xóa dùng `NOTI-ERR-NOTIFICATION-DELETED`.
* Empty/error state áp dụng nhất quán cho cả dropdown header và màn hình danh sách đầy đủ.
* Badge unread khi đếm lỗi nên ẩn hoặc giữ giá trị cũ thay vì hiển thị số sai.

---

## 14. Dữ liệu cần lưu

> **Nguồn chuẩn schema = [DB-07 NOTI/DASH](<../DB/DB-07 NOTI DASH Database Design.md>) §7.** Bảng dưới là tóm tắt nghiệp vụ; tên bảng/cột canonical theo DB-07: `notification_events`, `notification_templates`, `notifications`, `notification_delivery_logs`, `notification_preferences`. **Mọi bảng vận hành có `company_id NOT NULL`** (Bất biến #1 — RLS + FORCE, xem [DECISIONS-02 §2](<../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md>)). Bảng danh mục (`notification_events`/`notification_templates`) dùng `company_id` nullable (NULL = global default, có giá trị = company override). Cấu hình kênh gửi (channel config) thuộc settings/DB-08, **không** là bảng riêng `notification_channels`.

### 14.1 Bảng notifications

| Trường                | Kiểu dữ liệu | Bắt buộc | Giá trị mặc định | Ghi chú                             |
| --------------------- | ------------ | -------- | ---------------- | ----------------------------------- |
| id                    | UUID         | Có       | Auto             | ID thông báo                        |
| company_id            | UUID         | Có       |                  | FK `companies.id` — Bất biến #1 (RLS + FORCE) |
| notification_code     | String       | Có       | Auto             | Mã thông báo                        |
| recipient_user_id     | UUID         | Có       |                  | User nhận                           |
| recipient_employee_id | UUID         | Không    |                  | Employee nhận nếu có                |
| title                 | String       | Có       |                  | Tiêu đề                             |
| content               | Text         | Có       |                  | Nội dung                            |
| short_content         | String       | Không    |                  | Nội dung rút gọn                    |
| notification_type     | String       | Có       | System           | Loại thông báo                      |
| priority              | String       | Có       | Normal           | Low/Normal/High/Urgent/Critical     |
| status                | String       | Có       | Unread           | Read/Unread/Hidden/Archived/Deleted |
| source_module         | String       | Có       |                  | AUTH/HR/ATT/LEAVE/TASK/DASH         |
| event_code            | String       | Có       |                  | Mã event                            |
| source_id             | UUID/String  | Không    |                  | ID bản ghi nguồn                    |
| source_type           | String       | Không    |                  | Task/LeaveRequest/Attendance/...    |
| target_module         | String       | Không    |                  | Module điều hướng                   |
| target_type           | String       | Không    |                  | Loại đối tượng điều hướng           |
| target_id             | UUID/String  | Không    |                  | ID đối tượng điều hướng             |
| target_url            | String       | Không    |                  | URL frontend                        |
| payload               | JSON         | Không    |                  | Dữ liệu bổ sung                     |
| is_read               | Boolean      | Có       | false            | Trạng thái đọc nhanh                |
| read_at               | DateTime     | Không    |                  | Thời điểm đọc                       |
| hidden_at             | DateTime     | Không    |                  | Thời điểm ẩn                        |
| archived_at           | DateTime     | Không    |                  | Thời điểm lưu trữ                   |
| created_at            | DateTime     | Có       | Auto             | Thời gian tạo                       |
| updated_at            | DateTime     | Có       | Auto             | Thời gian cập nhật                  |
| deleted_at            | DateTime     | Không    |                  | Xóa mềm                             |

---

### 14.2 Bảng notification_events

| Trường            | Kiểu dữ liệu | Bắt buộc | Ghi chú           |
| ----------------- | ------------ | -------- | ----------------- |
| id                | UUID         | Có       | ID event          |
| company_id        | UUID         | Không    | NULL = global event; có giá trị = override theo company (bảng danh mục) |
| event_code        | String       | Có       | Unique trong phạm vi global/company |
| event_name        | String       | Có       | Tên event         |
| source_module     | String       | Có       | Module nguồn      |
| notification_type | String       | Có       | Loại thông báo    |
| default_priority  | String       | Có       | Priority mặc định |
| enabled           | Boolean      | Có       | Bật/tắt event     |
| description       | Text         | Không    | Mô tả             |
| created_at        | DateTime     | Có       |                   |
| updated_at        | DateTime     | Có       |                   |

---

### 14.3 Bảng notification_templates

| Trường           | Kiểu dữ liệu | Bắt buộc | Ghi chú           |
| ---------------- | ------------ | -------- | ----------------- |
| id               | UUID         | Có       | ID template       |
| company_id       | UUID         | Không    | NULL = global template; có giá trị = company override (bảng danh mục) |
| template_code    | String       | Có       | Unique trong phạm vi global/company |
| event_code       | String       | Có       | Event áp dụng     |
| channel          | String       | Có       | IN_APP/EMAIL/PUSH |
| language         | String       | Có       | vi mặc định       |
| title_template   | String       | Có       | Tiêu đề           |
| content_template | Text         | Có       | Nội dung          |
| short_template   | String       | Không    | Nội dung ngắn     |
| variables_schema | JSON         | Không    | Biến hỗ trợ       |
| enabled          | Boolean      | Có       | Bật/tắt           |
| created_at       | DateTime     | Có       |                   |
| updated_at       | DateTime     | Có       |                   |

---

### 14.4 Cấu hình kênh gửi (channel config) — KHÔNG có bảng riêng

> **Không** dùng bảng riêng `notification_channels`. Cấu hình bật/tắt kênh (IN_APP/EMAIL/PUSH/REALTIME/INTEGRATION), provider, retry, rate limit… lưu ở **settings công ty** ([DB-08 Audit/Files/Settings](<../DB/DB-08 Audit Files Settings Seeds Database Design.md>)) dạng key-value/JSON theo `company_id`. Màn hình NOTI-SCREEN-007 đọc/ghi qua các API `NOTI-API-307/308` (`/api/v1/notifications/channels`). Lịch sử gửi từng notification ghi ở `notification_delivery_logs` (§14.5).

---

### 14.5 Bảng notification_delivery_logs

> Trước đây gọi là `notification_logs` — **tên chuẩn = `notification_delivery_logs`** (DB-07 §7.4).

| Trường              | Kiểu dữ liệu | Bắt buộc | Ghi chú                                       |
| ------------------- | ------------ | -------- | --------------------------------------------- |
| id                  | UUID         | Có       | ID log                                        |
| company_id          | UUID         | Có       | FK `companies.id` — Bất biến #1 (RLS + FORCE) |
| notification_id     | UUID         | Có       | Liên kết notification                         |
| recipient_user_id   | UUID         | Có       | Người nhận                                    |
| channel             | String       | Có       | IN_APP/EMAIL/PUSH/REALTIME/INTEGRATION        |
| provider            | String       | Không    | internal/smtp/fcm/slack…                      |
| delivery_status     | String       | Có       | Pending/Sent/Delivered/Failed/Skipped/Cancelled |
| attempt_no          | Integer      | Có       | Số lần thử                                    |
| max_attempts        | Integer      | Có       | Số lần thử tối đa                             |
| error_code          | String       | Không    | Mã lỗi                                        |
| error_message       | Text         | Không    | Chi tiết lỗi                                  |
| sent_at             | DateTime     | Không    | Thời điểm gửi thành công                      |
| next_retry_at       | DateTime     | Không    | Lần retry tiếp theo                           |
| created_at          | DateTime     | Có       | Thời điểm tạo log                             |

---

### 14.6 Bảng notification_preferences — Nên có / Phase sau

> Trước đây gọi là `notification_user_preferences` — **tên chuẩn = `notification_preferences`** (DB-07 §7.5).

| Trường      | Kiểu dữ liệu | Bắt buộc | Ghi chú                   |
| ----------- | ------------ | -------- | ------------------------- |
| id          | UUID         | Có       | ID                        |
| company_id  | UUID         | Có       | FK `companies.id` — Bất biến #1 (RLS + FORCE) |
| user_id     | UUID         | Có       | User                      |
| event_id    | UUID         | Không    | FK `notification_events.id`; null = áp theo module/type |
| channel     | String       | Có       | Kênh                      |
| is_enabled  | Boolean      | Có       | Bật/tắt                   |
| quiet_hours | JSON         | Không    | Khung giờ không làm phiền |
| created_at  | DateTime     | Có       |                           |
| updated_at  | DateTime     | Có       |                           |

---

## 15. Danh sách event thông báo MVP

> **Registry chuẩn (nguồn sự thật):** Các bảng event ở §15.1–15.6 là **event registry chuẩn** của NOTI (convention `UPPER_SNAKE`, prefix module). Mọi mô tả/ví dụ ở các mục khác (kể cả §3.4) phải dùng đúng `event_code` ở đây; ví dụ ATT dùng `ATT_ADJUSTMENT_SUBMITTED` (không phải `ATTENDANCE_ADJUSTMENT_SUBMITTED`), TASK mention dùng `TASK_MENTIONED` (không phải `TASK_COMMENT_MENTIONED`). DB-07 seed và BACKEND-09 dùng verbatim cùng bộ mã.

### 15.0 Ánh xạ với bộ mã sự kiện chuẩn (SPEC-01 §20.2)

[SPEC-01](<SPEC-01 Tổng quan.md>) §20.2 quy định 9 mã sự kiện MVP chuẩn `NOTI-EVENT-001..009`. SPEC-08 dùng `event_code` dạng chuỗi theo module nguồn; bảng dưới ánh xạ 1-1 để bảo đảm hợp đồng phát/nhận sự kiện giữa các module nhất quán. Các event khác ở §15.1–15.6 là phần mở rộng của SPEC-08 ngoài 9 mã chuẩn.

| Mã chuẩn SPEC-01 | event_code (SPEC-08)    | Sự kiện                   | Người nhận       |
| ---------------- | ----------------------- | ------------------------- | ---------------- |
| NOTI-EVENT-001   | AUTH_USER_CREATED       | Tài khoản được tạo        | User mới         |
| NOTI-EVENT-002   | TASK_ASSIGNED           | Có task mới               | Assignee         |
| NOTI-EVENT-003   | TASK_COMMENT_CREATED    | Có comment mới trong task | Assignee/Watcher |
| NOTI-EVENT-004   | TASK_DUE_SOON           | Task sắp đến hạn          | Assignee         |
| NOTI-EVENT-005   | TASK_OVERDUE            | Task quá hạn              | Assignee/Manager |
| NOTI-EVENT-006   | LEAVE_REQUEST_SUBMITTED | Có đơn nghỉ phép mới      | Manager/HR       |
| NOTI-EVENT-007   | LEAVE_REQUEST_APPROVED  | Đơn nghỉ được duyệt       | Employee         |
| NOTI-EVENT-008   | LEAVE_REQUEST_REJECTED  | Đơn nghỉ bị từ chối       | Employee         |
| NOTI-EVENT-009   | HR_CONTRACT_EXPIRING    | Hợp đồng sắp hết hạn      | HR/Admin         |

---

### 15.1 AUTH events

| Mã event                      | Sự kiện                 | Người nhận | Nội dung gợi ý                    |
| ----------------------------- | ----------------------- | ---------- | --------------------------------- |
| AUTH_USER_CREATED             | Tài khoản được tạo      | User mới   | Tài khoản của bạn đã được tạo     |
| AUTH_PASSWORD_RESET_REQUESTED | Yêu cầu reset mật khẩu  | User       | Bạn đã yêu cầu đặt lại mật khẩu   |
| AUTH_PASSWORD_CHANGED         | Đổi mật khẩu thành công | User       | Mật khẩu của bạn đã được thay đổi |
| AUTH_USER_LOCKED              | Tài khoản bị khóa       | User/Admin | Tài khoản đã bị khóa              |
| AUTH_USER_UNLOCKED            | Tài khoản được mở khóa  | User/Admin | Tài khoản đã được mở khóa         |

---

### 15.2 HR events

| Mã event                    | Sự kiện                        | Người nhận          | Nội dung gợi ý                        |
| --------------------------- | ------------------------------ | ------------------- | ------------------------------------- |
| HR_EMPLOYEE_CREATED         | Tạo nhân viên mới              | HR/Admin liên quan  | Hồ sơ nhân viên mới đã được tạo       |
| HR_PROFILE_CHANGE_SUBMITTED | Employee gửi yêu cầu sửa hồ sơ | HR/Admin            | Có yêu cầu cập nhật hồ sơ cần duyệt   |
| HR_PROFILE_CHANGE_APPROVED  | Yêu cầu sửa hồ sơ được duyệt   | Employee            | Yêu cầu cập nhật hồ sơ đã được duyệt  |
| HR_PROFILE_CHANGE_REJECTED  | Yêu cầu sửa hồ sơ bị từ chối   | Employee            | Yêu cầu cập nhật hồ sơ đã bị từ chối  |
| HR_CONTRACT_EXPIRING        | Hợp đồng sắp hết hạn           | HR/Admin            | Có hợp đồng sắp hết hạn               |
| HR_PROBATION_ENDING         | Nhân viên sắp hết thử việc     | HR/Manager          | Nhân viên sắp hết thời gian thử việc  |
| HR_EMPLOYEE_STATUS_CHANGED  | Trạng thái nhân viên thay đổi  | Employee/HR/Manager | Trạng thái nhân viên đã được cập nhật |

---

### 15.3 ATT events

| Mã event                    | Sự kiện                     | Người nhận                    | Nội dung gợi ý                        |
| --------------------------- | --------------------------- | ----------------------------- | ------------------------------------- |
| ATT_MISSING_CHECKOUT        | Thiếu check-out             | Employee/Manager/HR           | Bạn chưa check-out hôm nay            |
| ATT_LATE_DETECTED           | Đi muộn                     | Employee/Manager nếu cấu hình | Có bản ghi đi muộn                    |
| ATT_ABSENT_DETECTED         | Vắng mặt                    | Employee/Manager/HR           | Có bản ghi vắng mặt cần kiểm tra      |
| ATT_ADJUSTMENT_SUBMITTED    | Gửi yêu cầu điều chỉnh công | Manager/HR                    | Có yêu cầu điều chỉnh công cần xử lý  |
| ATT_ADJUSTMENT_APPROVED     | Điều chỉnh công được duyệt  | Employee                      | Yêu cầu điều chỉnh công đã được duyệt |
| ATT_ADJUSTMENT_REJECTED     | Điều chỉnh công bị từ chối  | Employee                      | Yêu cầu điều chỉnh công đã bị từ chối |
| ATT_AUTO_ATTENDANCE_CREATED | Tự động chấm công           | Employee/HR nếu cấu hình      | Công đã được ghi nhận tự động         |
| ATT_REMOTE_REQUEST_SUBMITTED | Gửi yêu cầu remote/công tác | Manager/HR                    | Có yêu cầu remote/công tác cần duyệt  |
| ATT_REMOTE_REQUEST_APPROVED | Yêu cầu remote được duyệt   | Employee                      | Yêu cầu remote/công tác đã được duyệt |
| ATT_REMOTE_REQUEST_REJECTED | Yêu cầu remote bị từ chối   | Employee                      | Yêu cầu remote/công tác đã bị từ chối |
| ATT_REMOTE_REQUEST_CANCELLED | Yêu cầu remote bị hủy       | Manager/HR/Employee liên quan | Yêu cầu remote/công tác đã được hủy   |
| ATT_CHECKIN_REMINDER         | Nhắc check-in đầu ngày      | Employee                      | Bạn chưa check-in hôm nay             |
| ATT_CHECKOUT_REMINDER        | Nhắc check-out cuối ngày    | Employee                      | Bạn chưa check-out, đừng quên chấm công ra |

> **Chốt DN-10:** Hai event nhắc check-in/out (`ATT_CHECKIN_REMINDER`/`ATT_CHECKOUT_REMINDER`) là **producer chính thức** cho mô tả "nhắc check-in/out" ở SPEC-07 DASH §4.1, do job nhắc hạn (NOTI-FUNC-020) phát theo cấu hình công ty; nếu công ty tắt nhắc thì không phát. Phân biệt với `ATT_MISSING_CHECKOUT` (cảnh báo đã bỏ lỡ check-out, không phải nhắc trước).

---

### 15.4 LEAVE events

| Mã event                | Sự kiện                    | Người nhận                    | Nội dung gợi ý                       |
| ----------------------- | -------------------------- | ----------------------------- | ------------------------------------ |
| LEAVE_REQUEST_SUBMITTED | Employee gửi đơn nghỉ      | Manager/HR                    | Có đơn nghỉ phép cần duyệt           |
| LEAVE_REQUEST_APPROVED  | Đơn nghỉ được duyệt        | Employee                      | Đơn nghỉ phép của bạn đã được duyệt  |
| LEAVE_REQUEST_REJECTED  | Đơn nghỉ bị từ chối        | Employee                      | Đơn nghỉ phép của bạn đã bị từ chối  |
| LEAVE_REQUEST_CANCELLED | Đơn nghỉ bị hủy            | Manager/HR/Employee liên quan | Đơn nghỉ phép đã được hủy            |
| LEAVE_REQUEST_REVOKED   | Đơn nghỉ đã duyệt bị thu hồi | Manager/HR/Employee liên quan | Đơn nghỉ phép đã được thu hồi        |
| LEAVE_START_REMINDER    | Sắp tới ngày nghỉ          | Employee/Manager nếu cấu hình | Bạn sắp có lịch nghỉ                 |
| LEAVE_BALANCE_LOW       | Số ngày phép thấp          | Employee                      | Số ngày phép còn lại của bạn sắp hết |
| LEAVE_BALANCE_ADJUSTED  | Số dư phép được điều chỉnh | Employee                      | Số dư phép của bạn đã được cập nhật  |
| LEAVE_SYNC_TO_ATT_FAILED | Đồng bộ nghỉ phép sang chấm công lỗi | Admin/HR             | Đồng bộ đơn nghỉ sang chấm công thất bại |

---

### 15.5 TASK events

| Mã event              | Sự kiện                  | Người nhận               | Nội dung gợi ý                        |
| --------------------- | ------------------------ | ------------------------ | ------------------------------------- |
| TASK_ASSIGNED         | User được giao task      | Assignee                 | Bạn có task mới                       |
| TASK_UPDATED          | Task được cập nhật       | Assignee/Watcher         | Công việc đã được cập nhật            |
| TASK_ASSIGNEE_CHANGED | Đổi người phụ trách      | Assignee cũ/mới, Watcher | Người phụ trách task đã thay đổi      |
| TASK_DEADLINE_CHANGED | Đổi deadline             | Assignee/Watcher         | Deadline task đã thay đổi             |
| TASK_STATUS_CHANGED   | Đổi trạng thái task      | Creator/Watcher          | Trạng thái task đã thay đổi           |
| TASK_COMMENT_CREATED  | Có comment mới           | Assignee/Watcher         | Có bình luận mới trong task           |
| TASK_MENTIONED        | User được mention        | Mentioned user           | Bạn được nhắc đến trong một bình luận |
| TASK_DUE_SOON         | Task sắp đến hạn         | Assignee                 | Task sắp đến hạn                      |
| TASK_OVERDUE          | Task quá hạn             | Assignee/Manager         | Task đã quá hạn                       |
| PROJECT_MEMBER_ADDED  | User được thêm vào dự án | User                     | Bạn đã được thêm vào dự án            |
| PROJECT_CLOSED        | Project đóng             | Thành viên dự án         | Dự án đã được đóng                    |

---

### 15.6 DASH/System events

| Mã event                  | Sự kiện                    | Người nhận           | Nội dung gợi ý                     |
| ------------------------- | -------------------------- | -------------------- | ---------------------------------- |
| DASH_WIDGET_ERROR         | Widget lỗi nhiều lần       | Admin                | Một widget dashboard đang gặp lỗi  |
| SYSTEM_CONFIG_CHANGED     | Cấu hình hệ thống thay đổi | Admin liên quan      | Cấu hình hệ thống đã được cập nhật |
| SYSTEM_MAINTENANCE_NOTICE | Thông báo bảo trì          | Người dùng liên quan | Hệ thống sẽ bảo trì theo lịch      |
| SYSTEM_IMPORT_FAILED      | Import dữ liệu lỗi         | Admin/HR             | Import dữ liệu thất bại            |
| SYSTEM_JOB_FAILED         | Job hệ thống lỗi           | Admin/Super Admin    | Một job hệ thống đã chạy lỗi       |

> **Event nội bộ cache (không phải notification người dùng):** `NOTIFICATION_CREATED` và `NOTIFICATION_READ` là event nội bộ do NOTI phát (sau khi tạo/đọc notification) để DASH invalidate cache widget thông báo. NOTI **phải** phát cả hai (hoặc gọi `/internal/v1/dashboard/cache/invalidate`) để widget unread-count/thông báo mới của Dashboard luôn đúng. Hai event này không tạo bản ghi `notifications` cho người dùng.

---

## 16. Quy tắc nghiệp vụ

### 16.1 Quy tắc tạo thông báo

1. Chỉ tạo thông báo khi event được bật.
2. Event phải có `event_code` hợp lệ.
3. Event phải xác định được ít nhất một người nhận.
4. Nếu không xác định được người nhận, ghi log `Skipped`.
5. Nếu người nhận inactive/locked, xử lý theo cấu hình.
6. Một event có thể tạo nhiều notification cho nhiều người nhận.
7. Mỗi notification phải gắn với `recipient_user_id`.
8. Nội dung thông báo phải được render từ template hoặc fallback mặc định.
9. Không lưu thông tin nhạy cảm quá mức trong notification content.
10. Target link phải điều hướng đến module gốc nếu có.

---

### 16.2 Quy tắc tránh gửi trùng

Hệ thống cần tránh tạo thông báo trùng trong các trường hợp:

* Cùng event.
* Cùng source_id.
* Cùng recipient_user_id.
* Cùng channel.
* Trong cùng khoảng thời gian cấu hình.

Ví dụ:

```text
TASK_OVERDUE cho task A đã gửi lúc 08:00.
Job chạy lại lúc 08:05.
Nếu cấu hình chỉ gửi 1 lần/ngày, không tạo thêm notification trùng.
```

---

### 16.3 Quy tắc người nhận

Người nhận có thể được xác định theo:

| Nguồn          | Ví dụ                        |
| -------------- | ---------------------------- |
| User cụ thể    | Assignee của task            |
| Role           | Toàn bộ HR                   |
| Data scope     | Manager của nhân viên        |
| Department     | Nhân viên thuộc phòng ban    |
| Project member | Thành viên dự án             |
| Config         | Nhóm Admin nhận lỗi hệ thống |

Nguyên tắc:

* Employee nhận thông báo cá nhân.
* Manager nhận thông báo liên quan nhân viên thuộc team.
* HR nhận thông báo toàn công ty nếu có quyền/scope.
* Admin nhận thông báo cấu hình/hệ thống.
* Không gửi thông báo nghiệp vụ cho user không liên quan.

---

### 16.4 Quy tắc trạng thái đọc

1. Notification mới mặc định là `Unread`.
2. Khi user mở chi tiết, hệ thống có thể tự chuyển sang `Read`.
3. User có thể tự đánh dấu đã đọc.
4. User có thể đánh dấu tất cả đã đọc.
5. Read status là theo từng user, không ảnh hưởng user khác.
6. Nếu notification bị hidden/deleted, không tính vào unread count.
7. Nếu notification được archive, không hiển thị mặc định nhưng vẫn có thể truy xuất nếu có filter.

---

### 16.5 Quy tắc bảo mật dữ liệu

1. User chỉ được xem notification của chính mình.
2. Admin chỉ được xem log/cấu hình khi có quyền.
3. Nội dung notification không nên chứa dữ liệu nhạy cảm như lương, CCCD, thông tin ngân hàng.
4. Nếu thông báo liên quan dữ liệu nhạy cảm, nội dung chỉ nên ghi chung chung và yêu cầu mở màn hình gốc.
5. Khi mở target, module gốc phải kiểm tra quyền một lần nữa.
6. Không dùng target_url để bỏ qua kiểm tra quyền.
7. Không trả payload nhạy cảm cho frontend nếu không cần thiết.
8. Log lỗi không được chứa token, mật khẩu hoặc dữ liệu bảo mật.

---

### 16.6 Quy tắc thời gian lưu trữ

Đề xuất MVP:

| Loại dữ liệu            | Thời gian lưu                      |
| ----------------------- | ---------------------------------- |
| Notification cá nhân    | 6–12 tháng hoặc theo cấu hình      |
| Notification log        | 3–6 tháng hoặc theo cấu hình       |
| Audit log cấu hình      | Theo chính sách audit chung        |
| Notification đã xóa mềm | Có thể dọn bằng job sau 30–90 ngày |

---

### 16.7 Quy tắc ưu tiên hiển thị

Danh sách thông báo nên sắp xếp theo:

```text
Unread trước nếu đang xem dropdown
→ Priority cao hơn
→ created_at mới nhất
```

Danh sách đầy đủ mặc định:

```text
created_at mới nhất trước
```

---

### 16.8 Quy tắc thông báo nhắc hạn

Với task/hợp đồng/đơn nghỉ sắp đến hạn:

* Chỉ gửi nếu target chưa hoàn thành/xử lý.
* Không gửi lặp quá nhiều lần.
* Có thể cấu hình thời điểm nhắc: trước 1 ngày, trước 3 ngày, trong ngày.
* Nếu task đã Done/Cancelled thì không gửi nhắc.
* Nếu hợp đồng đã gia hạn hoặc inactive thì không gửi nhắc.
* Nếu đơn nghỉ đã cancelled/rejected thì không gửi nhắc.

---

## 17. API sơ bộ

> **Nguồn chuẩn:** [API-07 NOTI](<../API Design/API-07_NOTI_API_Design.md>) = endpoint/method/permission · [DB-07 NOTI/DASH](<../DB/DB-07 NOTI DASH Database Design.md>) = schema. Bảng dưới đã đồng bộ theo API-07 (prefix `/api/v1`, internal dùng `/internal/v1`, verb POST cho mark-read/mark-all-read). Nếu lệch, lấy API-07/DB-07 làm chuẩn.

### 17.1 Notification API cho user

| Mã API       | Method | Endpoint                                       | Mục đích                                    | Permission                          |
| ------------ | ------ | ---------------------------------------------- | ------------------------------------------- | ----------------------------------- |
| NOTI-API-001 | GET    | /api/v1/notifications                          | Lấy danh sách thông báo của tôi             | NOTI.NOTIFICATION.VIEW_OWN          |
| NOTI-API-002 | GET    | /api/v1/notifications/dropdown                 | Lấy dropdown thông báo mới nhất cho header   | NOTI.NOTIFICATION.VIEW_OWN          |
| NOTI-API-003 | GET    | /api/v1/notifications/unread-count             | Đếm thông báo chưa đọc                      | NOTI.NOTIFICATION.COUNT_UNREAD_OWN  |
| NOTI-API-004 | GET    | /api/v1/notifications/{id}                     | Xem chi tiết thông báo                      | NOTI.NOTIFICATION.VIEW_DETAIL_OWN   |
| NOTI-API-005 | POST   | /api/v1/notifications/{id}/open-target         | Lấy target info an toàn và mark read tùy config | NOTI.NOTIFICATION.VIEW_DETAIL_OWN   |

---

### 17.2 Notification action API

| Mã API       | Method | Endpoint                                  | Mục đích                        | Permission                          |
| ------------ | ------ | ----------------------------------------- | ------------------------------- | ----------------------------------- |
| NOTI-API-101 | POST   | /api/v1/notifications/{id}/mark-read      | Đánh dấu một thông báo đã đọc   | NOTI.NOTIFICATION.MARK_READ_OWN     |
| NOTI-API-102 | POST   | /api/v1/notifications/{id}/mark-unread    | Đánh dấu chưa đọc nếu bật cấu hình | NOTI.NOTIFICATION.MARK_READ_OWN     |
| NOTI-API-103 | POST   | /api/v1/notifications/mark-all-read       | Đánh dấu tất cả đã đọc          | NOTI.NOTIFICATION.MARK_ALL_READ_OWN |
| NOTI-API-104 | POST   | /api/v1/notifications/{id}/hide           | Ẩn thông báo                    | NOTI.NOTIFICATION.HIDE_OWN          |
| NOTI-API-105 | POST   | /api/v1/notifications/{id}/archive        | Lưu trữ thông báo               | NOTI.NOTIFICATION.HIDE_OWN          |
| NOTI-API-106 | DELETE | /api/v1/notifications/{id}                | Xóa mềm thông báo               | NOTI.NOTIFICATION.DELETE_OWN        |

---

### 17.3 Admin/System notification API

| Mã API       | Method | Endpoint                                                       | Mục đích                        | Permission                      |
| ------------ | ------ | ------------------------------------------------------------- | ------------------------------- | ------------------------------- |
| NOTI-API-201 | GET    | /api/v1/notifications/admin/notifications                     | Danh sách notification công ty  | NOTI.NOTIFICATION.VIEW_COMPANY  |
| NOTI-API-202 | GET    | /api/v1/notifications/admin/notifications/{id}                | Chi tiết notification admin     | NOTI.NOTIFICATION.VIEW_COMPANY  |
| NOTI-API-203 | POST   | /api/v1/notifications/admin/system-notifications             | Tạo thông báo hệ thống thủ công | NOTI.NOTIFICATION.CREATE_SYSTEM |
| NOTI-API-204 | POST   | /api/v1/notifications/admin/system-notifications/{id}/send   | Gửi thông báo hệ thống thủ công | NOTI.NOTIFICATION.SEND_SYSTEM   |

---

### 17.4 Event/template/channel config API

| Mã API       | Method | Endpoint                                       | Mục đích                | Permission           |
| ------------ | ------ | ---------------------------------------------- | ----------------------- | -------------------- |
| NOTI-API-301 | GET    | /api/v1/notifications/events                   | Lấy danh sách event     | NOTI.EVENT.VIEW      |
| NOTI-API-302 | PATCH  | /api/v1/notifications/events/{id}              | Bật/tắt/cấu hình event  | NOTI.EVENT.CONFIG    |
| NOTI-API-303 | GET    | /api/v1/notifications/templates                | Lấy danh sách template  | NOTI.TEMPLATE.VIEW   |
| NOTI-API-304 | POST   | /api/v1/notifications/templates                | Tạo template            | NOTI.TEMPLATE.CREATE |
| NOTI-API-305 | PATCH  | /api/v1/notifications/templates/{id}           | Cập nhật template       | NOTI.TEMPLATE.UPDATE |
| NOTI-API-306 | POST   | /api/v1/notifications/templates/{id}/preview   | Preview render template | NOTI.TEMPLATE.VIEW   |
| NOTI-API-307 | GET    | /api/v1/notifications/channels                 | Lấy cấu hình kênh       | NOTI.CHANNEL.VIEW    |
| NOTI-API-308 | PATCH  | /api/v1/notifications/channels/{channel_code}  | Cập nhật kênh           | NOTI.CHANNEL.UPDATE  |

---

### 17.5 Delivery log API

| Mã API       | Method | Endpoint                                          | Mục đích                | Permission     |
| ------------ | ------ | ------------------------------------------------- | ----------------------- | -------------- |
| NOTI-API-401 | GET    | /api/v1/notifications/delivery-logs               | Xem delivery log        | NOTI.LOG.VIEW  |
| NOTI-API-402 | GET    | /api/v1/notifications/delivery-logs/{id}          | Chi tiết delivery log   | NOTI.LOG.VIEW  |
| NOTI-API-403 | POST   | /api/v1/notifications/delivery-logs/{id}/retry    | Retry log gửi thất bại  | NOTI.LOG.RETRY |

---

### 17.6 Internal/event API (module → NOTI, job)

| Mã API                | Method | Endpoint                                          | Mục đích                       | Auth            |
| --------------------- | ------ | ------------------------------------------------- | ------------------------------ | --------------- |
| INTERNAL-NOTI-API-001 | POST   | /internal/v1/notifications/events                 | Nhận event từ module khác      | Internal/System |
| INTERNAL-NOTI-API-002 | POST   | /internal/v1/notifications/send                   | Tạo/gửi notification trực tiếp | Internal/System |
| INTERNAL-NOTI-API-003 | POST   | /internal/v1/notifications/bulk-send              | Gửi nhiều notification         | Internal/System |
| INTERNAL-NOTI-API-004 | POST   | /internal/v1/notifications/reminder-jobs/run      | Chạy job nhắc hạn/quá hạn      | Internal/System |
| INTERNAL-NOTI-API-005 | POST   | /internal/v1/notifications/delivery-jobs/retry    | Retry delivery log Pending/Failed | Internal/System |

---

## 18. Response chuẩn

### 18.1 Response danh sách thông báo

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "notification-id",
        "title": "Bạn có task mới",
        "short_content": "Bạn được giao task Thiết kế màn hình chấm công",
        "notification_type": "Task",
        "priority": "Normal",
        "source_module": "TASK",
        "event_code": "TASK_ASSIGNED",
        "is_read": false,
        "created_at": "2026-06-20T09:00:00+07:00",
        "target_module": "TASK",
        "target_type": "Task",
        "target_id": "task-id",
        "target_url": "/tasks/task-id"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100
    }
  }
}
```

---

### 18.2 Response unread count

> Khớp [API-07](<../API Design/API-07_NOTI_API_Design.md>) §8.3/§11.3 và FE-12: ngoài `unread_count` còn trả số chưa đọc theo mức ưu tiên để header/badge tô màu/cảnh báo.

```json
{
  "success": true,
  "data": {
    "unread_count": 12,
    "high_priority_unread_count": 2,
    "urgent_unread_count": 1,
    "last_notification_at": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 18.3 Request tạo event nội bộ

```json
{
  "event_code": "TASK_ASSIGNED",
  "source_module": "TASK",
  "source_type": "Task",
  "source_id": "task-id",
  "actor_user_id": "manager-user-id",
  "recipients": [
    {
      "user_id": "assignee-user-id"
    }
  ],
  "variables": {
    "task_title": "Thiết kế màn hình chấm công",
    "project_name": "EMS MVP",
    "deadline": "2026-06-25"
  },
  "target": {
    "target_module": "TASK",
    "target_type": "Task",
    "target_id": "task-id",
    "target_url": "/tasks/task-id"
  }
}
```

---

### 18.4 Response lỗi chuẩn

```json
{
  "success": false,
  "error": {
    "code": "NOTI-ERR-NOTIFICATION-NOT-FOUND",
    "message": "Không tìm thấy thông báo"
  }
}
```

---

## 19. Mã lỗi

> **Hệ mã lỗi chuẩn = slug (theo [API-07](<../API Design/API-07_NOTI_API_Design.md>) §20).** Bộ số `NOTI-ERR-001..015` cũ đã bỏ; dùng slug bên dưới ở mọi tầng (SPEC/API/BE/FE). Lỗi authz/hệ thống dùng mã chung của AUTH (`AUTH-ERR-FORBIDDEN`, `AUTH-ERR-UNAUTHORIZED`, `AUTH-ERR-INTERNAL`), không tạo mã NOTI riêng cho quyền.

| Mã lỗi (slug chuẩn)                  | HTTP | Trường hợp                                          | (Mã số cũ) |
| ------------------------------------ | ---- | --------------------------------------------------- | ---------- |
| `NOTI-ERR-NOTIFICATION-NOT-FOUND`    | 404  | Không tìm thấy notification hoặc không thuộc user   | NOTI-ERR-001 |
| `NOTI-ERR-NOTIFICATION-DELETED`      | 410  | Notification đã bị xóa mềm/không còn truy cập       | NOTI-ERR-008 |
| `NOTI-ERR-TARGET-UNAVAILABLE`        | 422  | Notification không có target hợp lệ hoặc đã hết hạn  | NOTI-ERR-013 |
| `NOTI-ERR-EVENT-NOT-FOUND`           | 404  | Không tìm thấy notification event                   | NOTI-ERR-003 |
| `NOTI-ERR-EVENT-DISABLED`            | 422  | Event đang bị tắt                                   | NOTI-ERR-003 |
| `NOTI-ERR-TEMPLATE-NOT-FOUND`        | 404  | Không tìm thấy template                             | NOTI-ERR-005 |
| `NOTI-ERR-TEMPLATE-INVALID`          | 400  | Template không hợp lệ                               | NOTI-ERR-006 |
| `NOTI-ERR-TEMPLATE-VARIABLE-INVALID` | 400  | Biến template không hợp lệ hoặc bị cấm              | NOTI-ERR-006 |
| `NOTI-ERR-CHANNEL-NOT-SUPPORTED`     | 422  | Kênh gửi chưa hỗ trợ                                | NOTI-ERR-007 |
| `NOTI-ERR-CHANNEL-DISABLED`          | 422  | Kênh gửi đang bị tắt                                | NOTI-ERR-007 |
| `NOTI-ERR-RECIPIENT-NOT-FOUND`       | 422  | Không resolve được người nhận                       | NOTI-ERR-004 |
| `NOTI-ERR-RECIPIENT-INACTIVE`        | 422  | Người nhận inactive/locked theo policy              | NOTI-ERR-015 |
| `NOTI-ERR-DEDUPE-CONFLICT`           | 409  | Notification đã tạo trước đó theo dedupe key        | NOTI-ERR-014 |
| `NOTI-ERR-DELIVERY-LOG-NOT-FOUND`    | 404  | Không tìm thấy delivery log                         | —          |
| `NOTI-ERR-DELIVERY-NOT-RETRYABLE`    | 422  | Delivery log không đủ điều kiện retry               | NOTI-ERR-012 |
| `NOTI-ERR-SYSTEM-NOTIFICATION-INVALID` | 400 | Thông báo hệ thống không hợp lệ (nội dung rỗng…)   | NOTI-ERR-011 |

> Các trường hợp authz cũ: `NOTI-ERR-002`/`NOTI-ERR-010` (không có quyền xem/cấu hình) → dùng `AUTH-ERR-FORBIDDEN`; `NOTI-ERR-009` (không cập nhật được trạng thái) → trả `NOTI-ERR-NOTIFICATION-NOT-FOUND`/`NOTI-ERR-NOTIFICATION-DELETED` tùy nguyên nhân.

---

## 20. Notification liên quan đến chính module NOTI

| Mã sự kiện            | Sự kiện                     | Người nhận      | Nội dung                            | Kênh   |
| --------------------- | --------------------------- | --------------- | ----------------------------------- | ------ |
| NOTI_CONFIG_UPDATED   | Cấu hình thông báo thay đổi | Admin liên quan | Cấu hình thông báo đã được cập nhật | In-app |
| NOTI_TEMPLATE_UPDATED | Template thông báo thay đổi | Admin liên quan | Template thông báo đã được cập nhật | In-app |
| NOTI_CHANNEL_FAILED   | Kênh gửi bị lỗi             | Admin hệ thống  | Một kênh gửi thông báo đang lỗi     | In-app |
| NOTI_BULK_SENT        | Gửi thông báo hàng loạt     | Người tạo/Admin | Thông báo hàng loạt đã được gửi     | In-app |
| NOTI_JOB_FAILED       | Job thông báo lỗi           | Admin hệ thống  | Job xử lý thông báo gặp lỗi         | In-app |

---

## 21. Audit log

### 21.1 Hành động cần ghi log

| Hành động                            | Có ghi log không | Ghi chú                  |
| ------------------------------------ | ---------------- | ------------------------ |
| User xem danh sách thông báo cá nhân | Không bắt buộc   | Có thể log analytics sau |
| User đánh dấu đã đọc                 | Không bắt buộc   | Có thể không cần audit   |
| User xóa/ẩn thông báo                | Không bắt buộc   | Có thể ghi activity nhẹ  |
| Admin tạo thông báo hệ thống         | Có               | Bắt buộc                 |
| Admin gửi thông báo hàng loạt        | Có               | Bắt buộc                 |
| Admin cập nhật event                 | Có               | Bắt buộc                 |
| Admin cập nhật template              | Có               | Bắt buộc                 |
| Admin cập nhật channel               | Có               | Bắt buộc                 |
| Hệ thống gửi lỗi nhiều lần           | Có               | Ghi system log           |
| Thay đổi cấu hình notification       | Có               | Bắt buộc                 |

---

### 21.2 Thông tin log cần lưu

| Trường      | Mô tả                               |
| ----------- | ----------------------------------- |
| id          | ID log                              |
| actor_id    | Người thao tác                      |
| action      | Hành động                           |
| module      | NOTI                                |
| target_type | Notification/Event/Template/Channel |
| target_id   | ID đối tượng                        |
| old_value   | Dữ liệu cũ nếu có                   |
| new_value   | Dữ liệu mới nếu có                  |
| ip_address  | IP                                  |
| user_agent  | Thiết bị/trình duyệt                |
| created_at  | Thời gian                           |

---

## 22. Tiêu chí nghiệm thu tổng thể

Module `NOTI` được xem là hoàn thành MVP khi:

1. Module khác có thể tạo thông báo thông qua event.
2. Notification được lưu đúng người nhận.
3. User đăng nhập xem được danh sách thông báo của chính mình.
4. User không xem được thông báo của người khác.
5. Header hiển thị đúng số thông báo chưa đọc.
6. Dashboard lấy được danh sách thông báo mới nhất từ NOTI.
7. User đánh dấu một thông báo là đã đọc thành công.
8. User đánh dấu tất cả thông báo là đã đọc thành công.
9. Unread count cập nhật đúng sau khi đọc.
10. User bấm thông báo điều hướng đúng sang module gốc.
11. Module gốc vẫn kiểm tra quyền khi mở target.
12. Thông báo nghỉ phép được gửi đúng người duyệt/người tạo đơn.
13. Thông báo task được gửi đúng assignee/watcher/mentioned user.
14. Thông báo chấm công/điều chỉnh công được gửi đúng Manager/HR/Employee.
15. Thông báo hợp đồng sắp hết hạn được gửi cho HR/Admin đúng cấu hình.
16. Không tạo notification trùng lặp ngoài rule cho phép.
17. Admin có quyền cấu hình loại/template/kênh thông báo.
18. User không có quyền không truy cập được màn hình cấu hình.
19. Các thao tác cấu hình được ghi audit log.
20. API có phân trang, lọc và kiểm tra quyền đầy đủ.
21. Empty state hiển thị rõ khi không có thông báo.
22. Error state hiển thị rõ khi tải thông báo lỗi.
23. Dữ liệu nhạy cảm không bị lộ trong notification content.
24. Log gửi thông báo ghi nhận được `delivery_status` Pending/Sent/Delivered/Failed/Skipped/Cancelled (DB-07 §7.4).
25. Hệ thống thiết kế mở để thêm email/push/realtime ở phase sau.

---

## 23. Test case

| Mã test case | Trường hợp kiểm thử              | Bước thực hiện                        | Kết quả mong muốn                       |
| ------------ | -------------------------------- | ------------------------------------- | --------------------------------------- |
| NOTI-TC-001  | Tạo notification từ event task   | Giao task cho Employee                | Employee nhận thông báo task mới        |
| NOTI-TC-002  | Tạo notification nghỉ phép       | Employee gửi đơn nghỉ                 | Manager nhận thông báo cần duyệt        |
| NOTI-TC-003  | Đơn nghỉ được duyệt              | Manager duyệt đơn                     | Employee nhận thông báo được duyệt      |
| NOTI-TC-004  | Đơn nghỉ bị từ chối              | Manager từ chối đơn                   | Employee nhận thông báo bị từ chối      |
| NOTI-TC-005  | Comment task có mention          | Comment @user trong task              | User được mention nhận thông báo        |
| NOTI-TC-006  | Task quá hạn                     | Job kiểm tra task quá hạn             | Assignee/Manager nhận thông báo         |
| NOTI-TC-007  | Hợp đồng sắp hết hạn             | Job kiểm tra hợp đồng                 | HR nhận thông báo                       |
| NOTI-TC-008  | Xem danh sách thông báo          | User mở màn hình thông báo            | Chỉ thấy thông báo của mình             |
| NOTI-TC-009  | User xem notification người khác | Gọi API với ID không thuộc user       | Trả lỗi không có quyền                  |
| NOTI-TC-010  | Đếm unread                       | User có 3 thông báo chưa đọc          | API trả unread_count = 3                |
| NOTI-TC-011  | Đánh dấu một thông báo đã đọc    | User mark read 1 notification         | Status chuyển Read, count giảm          |
| NOTI-TC-012  | Đánh dấu tất cả đã đọc           | User bấm mark all read                | Unread count = 0                        |
| NOTI-TC-013  | Ẩn thông báo                     | User bấm ẩn                           | Thông báo không hiện danh sách mặc định |
| NOTI-TC-014  | Điều hướng task                  | Bấm thông báo task                    | Mở chi tiết task nếu có quyền           |
| NOTI-TC-015  | Điều hướng nhưng mất quyền       | User bấm target không có quyền        | Hiển thị lỗi không có quyền             |
| NOTI-TC-016  | Filter unread                    | Chọn filter Chưa đọc                  | Chỉ hiển thị notification Unread        |
| NOTI-TC-017  | Filter theo module               | Chọn module TASK                      | Chỉ hiển thị thông báo TASK             |
| NOTI-TC-018  | Admin cấu hình event             | Tắt event TASK_UPDATED                | Event đó không tạo notification mới     |
| NOTI-TC-019  | Admin sửa template               | Cập nhật title template               | Notification mới dùng template mới      |
| NOTI-TC-020  | Template lỗi biến                | Template dùng biến không tồn tại      | Báo lỗi hoặc dùng fallback              |
| NOTI-TC-021  | Tránh gửi trùng                  | Job quá hạn chạy 2 lần gần nhau       | Không tạo notification trùng            |
| NOTI-TC-022  | User inactive                    | Gửi event cho user inactive           | Skip hoặc xử lý theo cấu hình           |
| NOTI-TC-023  | Header badge                     | User có unread                        | Badge hiển thị đúng số                  |
| NOTI-TC-024  | Dashboard widget                 | Dashboard gọi latest notifications    | Hiển thị thông báo mới đúng             |
| NOTI-TC-025  | Không có thông báo               | User mới không có notification        | Empty state hiển thị rõ                 |
| NOTI-TC-026  | API lỗi                          | Giả lập lỗi server                    | Error state hiển thị, không crash UI    |
| NOTI-TC-027  | Tạo thông báo hệ thống           | Admin gửi thông báo tới role Employee | Employee nhận notification              |
| NOTI-TC-028  | User không có quyền cấu hình     | Employee vào cấu hình notification    | Bị chặn truy cập                        |
| NOTI-TC-029  | Audit log cấu hình               | Admin cập nhật channel                | Audit log được ghi                      |
| NOTI-TC-030  | Log gửi thất bại                 | Giả lập email fail                    | notification_delivery_logs ghi Failed   |

---

## 24. Câu hỏi cần xác nhận thêm

1. MVP có triển khai email notification ngay không, hay chỉ thiết kế sẵn và ưu tiên in-app?
2. Có cần realtime notification qua WebSocket trong MVP không?
3. Có cần mobile push notification trong MVP không?
4. Người dùng có được tự bật/tắt loại thông báo cá nhân không, hay chỉ Admin cấu hình toàn hệ thống?
5. Có cần thông báo hàng loạt thủ công trong MVP không?
6. Có cần phân biệt thông báo bắt buộc và thông báo có thể tắt không?
7. Có cần lưu thông báo vĩnh viễn không, hay tự dọn sau một khoảng thời gian?
8. Có cần gửi thông báo khi user bị mention trong comment task ngay trong MVP không?
9. Có cần gộp nhiều thông báo cùng loại không?
10. Có cần thông báo nhắc check-out vào cuối ngày không? → **Đã chốt (DN-10): CÓ**, qua event `ATT_CHECKOUT_REMINDER` (+ `ATT_CHECKIN_REMINDER`) ở §15.3, bật/tắt theo cấu hình công ty.
11. Có cần gửi thông báo đi muộn cho Manager không, hay chỉ Employee?
12. Có cần thông báo hợp đồng sắp hết hạn trong MVP không?
13. Có cần cho HR tạo thông báo nội bộ cho nhân viên không?
14. Có cần hiển thị thông báo trên mobile web riêng không?
15. Có cần phân loại thông báo theo “Cần xử lý” và “Chỉ để biết” không?

---

## 25. Kết luận

SPEC-08 NOTI hệ thống là module dùng chung giúp toàn bộ hệ thống quản lý doanh nghiệp vận hành liền mạch hơn.

Trong MVP, module `NOTI` cần tập trung vào:

* Tạo thông báo in-app từ các event nghiệp vụ.
* Gửi đúng người nhận.
* Hiển thị danh sách thông báo cá nhân.
* Hiển thị số lượng thông báo chưa đọc.
* Đánh dấu đã đọc/chưa đọc.
* Điều hướng từ thông báo sang module gốc.
* Hỗ trợ Dashboard hiển thị widget thông báo mới.
* Hỗ trợ các event quan trọng từ HR, ATT, LEAVE, TASK và DASH.
* Có cấu hình loại thông báo/template/kênh ở mức cơ bản.
* Có log/audit log cho cấu hình và lỗi gửi thông báo.
* Thiết kế mở để triển khai email, mobile push, realtime, digest và AI ở các phase sau.

Sau khi SPEC-08 được chốt, có thể triển khai tiếp:

1. SPEC-09: Tiền lương.
2. SPEC-10: Tuyển dụng.
3. Các module Phase 3 như Tài sản và Phòng họp.
4. Các mở rộng notification nâng cao như realtime, mobile push và email digest.
