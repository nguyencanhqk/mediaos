# SPEC-04: CHẤM CÔNG

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · [SPEC-03 HR](<SPEC-03 HR.md>) · **SPEC-04 ATT** · [SPEC-05 LEAVE](<SPEC-05 LEAVE.md>) · [SPEC-06 TASK](<SPEC-06 TASK.md>) · [SPEC-07 DASH](<SPEC-07 DASH.md>) · [SPEC-08 NOTI](<SPEC-08 NOTI.md>)
>
> **Liên quan:** [Thiết kế DB: DB-04 ATT](<../DB/DB-04_ATT Database Design.md>) · [Sản phẩm: PRD-00 §9.3](<../PRD/PRD-00 Enterprise Management System .md>) · [Thiết kế API: API-04 ATT](<../API Design/API-04_ATT_API_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường                     | Nội dung                    |
| -------------------------- | --------------------------- |
| Mã tài liệu                | SPEC-04                     |
| Tên tài liệu               | Chấm công                   |
| Module code                | ATT                         |
| Tài liệu cha               | SPEC-01: Tổng quan hệ thống |
| Module phụ thuộc trực tiếp | AUTH, HR                    |
| Module liên quan           | LEAVE, DASH, NOTI, TASK     |
| Phiên bản                  | v1.0                        |
| Trạng thái                 | Draft                       |
| Giai đoạn                  | MVP Version 1.0             |
| Người viết                 |                             |
| Người duyệt                |                             |
| Ngày tạo                   |                             |
| Ngày cập nhật              |                             |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết module **Chấm công** trong hệ thống quản lý doanh nghiệp nội bộ.

Module `ATT` chịu trách nhiệm quản lý toàn bộ nghiệp vụ liên quan đến:

* Check-in.
* Check-out.
* Xem trạng thái chấm công hôm nay.
* Quản lý ca làm việc.
* Gán ca làm việc cho công ty, phòng ban hoặc nhân viên.
* Cấu hình rule chấm công.
* Tính đi muộn, về sớm, thiếu giờ, đủ công.
* Quản lý bảng công cá nhân, bảng công team và bảng công toàn công ty.
* Quản lý yêu cầu điều chỉnh công.
* Duyệt hoặc từ chối yêu cầu điều chỉnh công.
* HR/Admin điều chỉnh công trực tiếp nếu có quyền.
* Hỗ trợ chấm công web và mobile.
* Hỗ trợ tự động chấm công cho một số nhân viên hoặc công việc đặc thù.
* Hỗ trợ làm việc remote/công tác theo rule được duyệt.
* Chuẩn bị khả năng tích hợp thiết bị chấm công vật lý ở giai đoạn sau.
* Ghi audit log đầy đủ cho mọi thao tác quan trọng.

Module `ATT` là một trong các module lõi của MVP vì dữ liệu chấm công ảnh hưởng trực tiếp đến quản lý nhân sự, nghỉ phép, dashboard, thông báo và tính lương ở các phase sau.

---

## 3. Mối liên kết với các SPEC khác

### 3.1 Liên kết với [SPEC-01](<SPEC-01 Tổng quan.md>): Tổng quan hệ thống

Theo SPEC-01, module này có mã:

```text
ATT
```

Module `ATT` thuộc nhóm MVP Version 1.0 và chịu trách nhiệm cho nhóm nghiệp vụ chấm công, bảng công và ca làm việc.

---

### 3.2 Liên kết với [SPEC-02](<SPEC-02 AUTH.md>): AUTH

Module `ATT` phụ thuộc vào `AUTH` để:

* Xác định user đang đăng nhập.
* Kiểm tra token/session.
* Kiểm tra quyền truy cập màn hình chấm công.
* Kiểm tra quyền gọi API check-in/check-out.
* Kiểm tra quyền xem bảng công cá nhân, team hoặc toàn công ty.
* Kiểm tra quyền điều chỉnh công.
* Kiểm tra quyền duyệt yêu cầu điều chỉnh công.
* Kiểm tra quyền cấu hình rule chấm công.
* Áp dụng data scope: Own, Team, Department, Company, System.
* Ghi nhận actor khi có thao tác chấm công, điều chỉnh, duyệt, từ chối hoặc export.

Ví dụ:

```text
Employee chỉ được check-in/check-out cho chính mình.
Manager chỉ được xem và duyệt điều chỉnh công của nhân viên thuộc team.
HR có thể xem và xử lý bảng công toàn công ty nếu có quyền.
```

---

### 3.3 Liên kết với [SPEC-03](<SPEC-03 HR.md>): HR

Module `ATT` phụ thuộc vào `HR` để:

* Xác định user hiện tại đang liên kết với employee nào.
* Lấy mã nhân viên, họ tên, phòng ban, chức vụ, cấp bậc.
* Kiểm tra trạng thái nhân viên.
* Xác định quản lý trực tiếp của nhân viên.
* Xác định nhân viên thuộc phòng ban/team nào.
* Lấy cấu hình ca/rule theo nhân viên hoặc phòng ban nếu được lưu từ HR.
* Chặn nhân viên đã nghỉ việc hoặc bị chấm dứt hợp đồng chấm công.
* Cung cấp dữ liệu bảng công theo nhân viên cho HR quản lý.

Ví dụ:

```text
User A đăng nhập
→ AUTH xác định user_id
→ ATT gọi HR lấy employee_id tương ứng
→ ATT kiểm tra employee_status
→ Nếu employee đang Official/Probation thì cho phép check-in theo rule
```

---

### 3.4 Liên kết với [SPEC-05](<SPEC-05 LEAVE.md>): LEAVE

Module `ATT` liên kết chặt với `LEAVE` vì đơn nghỉ phép ảnh hưởng trực tiếp đến chấm công.

Cơ chế đồng bộ chuẩn: khi đơn nghỉ được duyệt/hủy/thu hồi, `LEAVE` phát event (`LEAVE_REQUEST_APPROVED/CANCELLED/REVOKED`) → ATT **ghi/cập nhật record `Leave`** trong `attendance_records`. Khi kiểm tra check-in/check-out, `ATT` **đọc record `Leave` trong `attendance_records` do event LEAVE tạo** (không gọi/pull `LEAVE` realtime tại thời điểm check-in) để biết:

* Nhân viên có đơn nghỉ phép được duyệt trong ngày hay không.
* Đơn nghỉ là cả ngày, nửa ngày, theo giờ hay nhiều ngày.
* Có cần chặn check-in/check-out hay không.
* Có cần giảm required working minutes hay không.
* Có cần ghi trạng thái ngày công là `Leave` hay không.
* Nếu đơn nghỉ đã duyệt bị hủy/thu hồi, ATT cần tính lại bảng công tương ứng theo event.

Nguyên tắc:

```text
Đơn nghỉ phép Approved có ưu tiên cao hơn check-in/check-out thủ công.
```

Ví dụ:

```text
Employee đã có đơn nghỉ cả ngày Approved
→ Employee mở màn hình Chấm công hôm nay
→ ATT đọc record Leave trong attendance_records (do event LEAVE tạo)
→ Hệ thống ẩn/disable nút Check-in và Check-out
→ Hiển thị thông báo: "Bạn đã có đơn nghỉ phép được duyệt trong ngày hôm nay."
```

---

### 3.5 Liên kết với Remote Work Request / Work Request

Trong MVP, đề xuất quản lý **Remote Work Request / Công tác / Làm việc ngoài văn phòng** trong module `ATT`, vì nhóm request này ảnh hưởng trực tiếp đến rule chấm công.

Module `ATT` cần hỗ trợ:

* Tạo request làm remote/công tác nếu doanh nghiệp bật cấu hình.
* Duyệt/từ chối request remote/công tác.
* Áp dụng rule remote khi request được duyệt.
* Tự động chấm công cho ngày remote nếu rule cho phép.
* Cho phép check-in/check-out remote nếu rule yêu cầu nhân viên tự chấm công.
* Yêu cầu GPS/ghi chú/ảnh xác nhận nếu cấu hình.
* Hiển thị remote work trong bảng công.

Lưu ý:

* `LEAVE` chỉ nên quản lý nghỉ phép.
* `ATT` quản lý remote/công tác vì đây là trạng thái đi làm, không phải trạng thái nghỉ.
* Phase sau có thể tách thành module riêng `WORK_REQUEST` nếu hệ thống cần quản lý nhiều loại yêu cầu phức tạp.

---

### 3.6 Liên kết với [SPEC-06](<SPEC-06 TASK.md>): TASK

Trong MVP, `ATT` chưa bắt buộc tính công theo task.

Tuy nhiên có thể liên kết `TASK` ở các điểm sau:

* Remote work có thể yêu cầu chọn task/project đang làm.
* Nhân viên remote có thể cần nhập ghi chú công việc.
* Dashboard hiển thị trạng thái chấm công cùng task hôm nay.
* Phase sau có thể tính thời gian làm việc theo task.
* Phase sau có thể xác nhận công remote bằng task hoàn thành.

---

### 3.7 Liên kết với [SPEC-07](<SPEC-07 DASH.md>): DASH

Module `DASH` lấy dữ liệu từ `ATT` để hiển thị:

* Trạng thái check-in/check-out hôm nay.
* Giờ check-in.
* Giờ check-out.
* Nút check-in/check-out nhanh.
* Trạng thái đi muộn.
* Trạng thái về sớm.
* Thiếu check-out.
* Vắng mặt.
* Làm remote.
* Tự động chấm công.
* Bất thường chấm công của team.
* Bất thường chấm công toàn công ty cho HR/Admin.

Nguyên tắc:

* `DASH` chỉ hiển thị và điều hướng.
* `ATT` chịu trách nhiệm xử lý nghiệp vụ chấm công.
* Khi bấm check-in/check-out trên Dashboard, request vẫn gọi API của `ATT`.

---

### 3.8 Liên kết với [SPEC-08](<SPEC-08 NOTI.md>): NOTI

Module `ATT` phát sinh event để `NOTI` gửi thông báo khi:

* Nhân viên quên check-out.
* Nhân viên bị ghi nhận vắng mặt.
* Nhân viên đi muộn nếu công ty bật cảnh báo.
* Nhân viên về sớm nếu công ty bật cảnh báo.
* Nhân viên gửi yêu cầu điều chỉnh công.
* Manager/HR có yêu cầu điều chỉnh công cần duyệt.
* Yêu cầu điều chỉnh công được duyệt.
* Yêu cầu điều chỉnh công bị từ chối.
* HR/Admin điều chỉnh công trực tiếp.
* Hệ thống tự động chấm công cho nhân viên đặc thù.
* Có bất thường chấm công cần xử lý.
* Có lỗi đồng bộ thiết bị chấm công ở phase sau.

Ví dụ:

```text
Employee gửi yêu cầu điều chỉnh công
→ ATT phát event ATT_ADJUSTMENT_SUBMITTED
→ NOTI gửi thông báo cho Manager/HR có quyền duyệt
```

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

Module `ATT` cần giúp doanh nghiệp:

1. Số hóa quy trình chấm công hằng ngày.
2. Cho phép nhân viên check-in/check-out nhanh qua web hoặc mobile.
3. Hỗ trợ nhiều mô hình làm việc: văn phòng, remote, công tác, ca cố định, ca linh hoạt.
4. Cho phép cấu hình rule chấm công theo công ty, phòng ban hoặc từng nhân viên.
5. Tự động tính đi muộn, về sớm, thiếu giờ, đủ công.
6. Chặn chấm công khi nhân viên đã có đơn nghỉ phép được duyệt.
7. Hỗ trợ tự động chấm công cho nhóm nhân viên/công việc đặc thù.
8. Cho phép nhân viên gửi yêu cầu điều chỉnh công khi thiếu check-in/check-out hoặc có lý do hợp lệ.
9. Cho phép Manager/HR duyệt điều chỉnh công theo đúng phạm vi quản lý.
10. Cho phép HR kiểm tra, điều chỉnh và xuất bảng công phục vụ tính lương sau này.
11. Giảm thao tác thủ công qua Excel, tin nhắn hoặc giấy tờ.
12. Cung cấp dữ liệu cho dashboard, thông báo và payroll ở phase sau.

---

### 4.2 Mục tiêu kỹ thuật

Module `ATT` cần đảm bảo:

1. Mỗi bản ghi công có định danh duy nhất.
2. Mỗi bản ghi công gắn với một employee.
3. Mỗi ngày/ca chỉ có một bản ghi công chính trong MVP.
4. Có thể lưu log thô của từng lần check-in/check-out.
5. Backend luôn dùng server time để ghi nhận thời gian.
6. Backend luôn kiểm tra quyền, không phụ thuộc vào frontend.
7. Có kiểm tra data scope theo role.
8. Có audit log cho mọi thao tác quan trọng.
9. Có cơ chế chống tạo trùng bản ghi khi user bấm nhiều lần.
10. Có cấu trúc dữ liệu đủ mở để tích hợp máy chấm công ở phase sau.
11. Có cấu trúc dữ liệu đủ mở để import/export bảng công.
12. Có thể xử lý lại bảng công khi dữ liệu nghỉ phép hoặc remote thay đổi.
13. Có thể mở rộng sang tính tăng ca, tính lương, đối soát thiết bị, GPS nâng cao, QR code, nhận diện khuôn mặt.

---

## 5. Phạm vi module

### 5.1 Bao gồm trong MVP

| Mã chức năng | Tên chức năng                                   | Độ ưu tiên |
| ------------ | ----------------------------------------------- | ---------- |
| ATT-FUNC-001 | Check-in                                        | Rất cao    |
| ATT-FUNC-002 | Check-out                                       | Rất cao    |
| ATT-FUNC-003 | Xem trạng thái chấm công hôm nay                | Rất cao    |
| ATT-FUNC-004 | Xem bảng công cá nhân                           | Rất cao    |
| ATT-FUNC-005 | Xem chi tiết ngày công                          | Rất cao    |
| ATT-FUNC-006 | Xem bảng công team                              | Cao        |
| ATT-FUNC-007 | Xem bảng công toàn công ty                      | Cao        |
| ATT-FUNC-008 | Tìm kiếm, lọc, phân trang bảng công             | Cao        |
| ATT-FUNC-009 | Quản lý ca làm việc                             | Rất cao    |
| ATT-FUNC-010 | Gán ca làm việc cho công ty/phòng ban/nhân viên | Rất cao    |
| ATT-FUNC-011 | Cấu hình rule chấm công                         | Rất cao    |
| ATT-FUNC-012 | Tính đi muộn                                    | Rất cao    |
| ATT-FUNC-013 | Tính về sớm                                     | Rất cao    |
| ATT-FUNC-014 | Tính thiếu giờ/đủ công                          | Rất cao    |
| ATT-FUNC-015 | Chặn chấm công khi có nghỉ phép Approved        | Rất cao    |
| ATT-FUNC-016 | Xử lý chấm công remote/công tác                 | Cao        |
| ATT-FUNC-017 | Tự động chấm công theo cấu hình                 | Cao        |
| ATT-FUNC-018 | Employee gửi yêu cầu điều chỉnh công            | Rất cao    |
| ATT-FUNC-019 | Manager/HR duyệt yêu cầu điều chỉnh công        | Rất cao    |
| ATT-FUNC-020 | Manager/HR từ chối yêu cầu điều chỉnh công      | Rất cao    |
| ATT-FUNC-021 | HR/Admin điều chỉnh công trực tiếp              | Cao        |
| ATT-FUNC-022 | Xem lịch sử điều chỉnh công                     | Cao        |
| ATT-FUNC-023 | Gửi thông báo chấm công                         | Cao        |
| ATT-FUNC-024 | Xuất bảng công                                  | Trung bình |
| ATT-FUNC-025 | Ghi audit log chấm công                         | Rất cao    |

---

### 5.2 Chưa bao gồm trong MVP nhưng cần thiết kế mở rộng

| Chức năng                         | Giai đoạn |
| --------------------------------- | --------- |
| Tích hợp máy chấm công vân tay    | Phase sau |
| Tích hợp máy nhận diện khuôn mặt  | Phase sau |
| Tích hợp thẻ từ                   | Phase sau |
| Chấm công bằng QR code nâng cao   | Phase sau |
| Chấm công bằng Wi-Fi/IP công ty   | Phase sau |
| Chống giả lập GPS nâng cao        | Phase sau |
| Mobile offline check-in           | Phase sau |
| Đồng bộ log từ thiết bị vật lý    | Phase sau |
| Import log chấm công từ Excel/CSV | Phase sau |
| Tính tăng ca/overtime nâng cao    | Phase sau |
| Quy trình duyệt tăng ca           | Phase sau |
| Khóa kỳ công                      | Phase sau |
| Đối soát bảng công trước payroll  | Phase sau |
| Tích hợp Payroll                  | Phase 2   |
| Báo cáo chấm công nâng cao        | Phase sau |
| AI phát hiện bất thường chấm công | Phase 5   |

---

## 6. Nhóm người dùng liên quan

| Vai trò         | Mô tả trong module ATT                                                                        |
| --------------- | --------------------------------------------------------------------------------------------- |
| Super Admin     | Toàn quyền dữ liệu chấm công toàn hệ thống                                                    |
| Admin công ty   | Quản trị chấm công trong công ty nếu được cấp quyền                                           |
| HR              | Quản lý bảng công, rule, ca làm, điều chỉnh công                                              |
| Manager         | Xem bảng công team, duyệt/từ chối yêu cầu điều chỉnh công của nhân viên thuộc phạm vi quản lý |
| Employee        | Check-in/check-out, xem bảng công cá nhân, gửi yêu cầu điều chỉnh công                        |
| Payroll Officer | Xem dữ liệu công phục vụ tính lương ở phase sau                                               |

---

## 7. Khái niệm chính trong module

### 7.1 Attendance

`Attendance` là nghiệp vụ ghi nhận sự có mặt/làm việc của nhân viên trong một ngày hoặc một ca.

Attendance có thể đến từ:

* Check-in/check-out thủ công.
* HR/Admin điều chỉnh.
* Tự động chấm công.
* Remote work.
* Thiết bị chấm công ở phase sau.
* Import dữ liệu ở phase sau.

---

### 7.2 Check-in

`Check-in` là hành động ghi nhận thời điểm nhân viên bắt đầu làm việc.

Thông tin cần ghi nhận:

* Nhân viên.
* Ngày làm việc.
* Thời gian check-in.
* Ca làm áp dụng.
* Nền tảng check-in: web/mobile.
* Thiết bị.
* IP.
* Vị trí GPS nếu có.
* Trạng thái: đúng giờ, đi muộn, remote, ngoại lệ.
* Ghi chú nếu rule yêu cầu.

---

### 7.3 Check-out

`Check-out` là hành động ghi nhận thời điểm nhân viên kết thúc làm việc.

Thông tin cần ghi nhận:

* Nhân viên.
* Ngày làm việc.
* Thời gian check-out.
* Tổng thời gian làm việc.
* Tổng thời gian thiếu nếu có.
* Trạng thái về sớm nếu có.
* Trạng thái đủ công/thiếu công.
* Nền tảng check-out.
* Thiết bị.
* IP.
* Vị trí GPS nếu có.
* Ghi chú nếu rule yêu cầu.

---

### 7.4 Attendance Record

`Attendance Record` là bản ghi công tổng hợp theo ngày hoặc theo ca.

Một bản ghi có thể gồm:

```text
Ngày làm việc
Nhân viên
Ca làm
Giờ check-in chính
Giờ check-out chính
Tổng phút làm việc
Tổng phút yêu cầu
Số phút đi muộn
Số phút về sớm
Số phút thiếu
Trạng thái công
Nguồn chấm công
Ghi chú
```

MVP đề xuất:

```text
Mỗi employee có một attendance record chính cho mỗi ngày/ca.
```

---

### 7.5 Attendance Log

`Attendance Log` là log thô của từng thao tác check-in/check-out.

Ví dụ:

```text
08:03 - Check-in từ mobile
17:35 - Check-out từ web
```

Attendance Record là dữ liệu tổng hợp; Attendance Log là dữ liệu phục vụ truy vết.

---

### 7.6 Shift

`Shift` là ca làm việc.

Ví dụ:

```text
Ca hành chính: 08:00 - 17:30
Ca sáng: 08:00 - 12:00
Ca chiều: 13:30 - 17:30
Ca linh hoạt: check-in từ 07:00 - 10:00, làm đủ 8 giờ
```

Một ca làm có thể gồm:

* Giờ bắt đầu.
* Giờ kết thúc.
* Thời gian nghỉ giữa ca.
* Số phút làm việc yêu cầu.
* Thời gian cho phép đi muộn.
* Thời gian cho phép về sớm.
* Có cho check-in sớm không.
* Có cho check-out muộn không.
* Có tính tăng ca không.
* Có áp dụng cuối tuần/ngày lễ không.

---

### 7.7 Shift Assignment

`Shift Assignment` là việc gán ca làm cho một phạm vi cụ thể.

Phạm vi gán ca:

* Công ty.
* Phòng ban.
* Nhân viên.
* Nhóm nhân viên.
* Ngày cụ thể.
* Khoảng thời gian cụ thể.

Thứ tự ưu tiên:

```text
Ca gán riêng cho nhân viên
→ Ca gán cho phòng ban
→ Ca mặc định công ty
→ Rule mặc định hệ thống
```

---

### 7.8 Attendance Rule

`Attendance Rule` là tập quy định dùng để xác định việc chấm công hợp lệ hay không.

Rule có thể bao gồm:

* Có bắt buộc check-in không.
* Có bắt buộc check-out không.
* Cho phép đi muộn bao nhiêu phút.
* Cho phép về sớm bao nhiêu phút.
* Số phút làm việc tối thiểu.
* Có yêu cầu GPS không.
* Có yêu cầu ghi chú không.
* Có cho chấm công cuối tuần/ngày lễ không.
* Có cho chấm công khi không có ca không.
* Có tự động check-out không.
* Có tự động chấm công không.
* Có cho remote check-in không.
* Có cho Employee gửi điều chỉnh công không.

---

### 7.9 Attendance Adjustment Request

`Attendance Adjustment Request` là yêu cầu điều chỉnh công do Employee gửi.

Dùng trong các trường hợp:

* Quên check-in.
* Quên check-out.
* Check-in sai do lỗi hệ thống.
* Check-out sai do lỗi hệ thống.
* Đi muộn có lý do hợp lệ.
* Về sớm có lý do hợp lệ.
* Làm remote nhưng chưa được ghi nhận đúng.
* Có dữ liệu chấm công bị thiếu.
* HR/Manager yêu cầu nhân viên giải trình.

---

### 7.10 Manual Adjustment

`Manual Adjustment` là thao tác HR/Admin điều chỉnh trực tiếp bản ghi công mà không cần Employee gửi request.

Chỉ người có quyền mới được thực hiện.

Mọi thao tác manual adjustment bắt buộc ghi audit log.

---

### 7.11 Remote Attendance

`Remote Attendance` là chấm công trong trường hợp nhân viên làm việc từ xa/công tác/ngoài văn phòng.

Các chế độ remote trong MVP:

| Chế độ                       | Mô tả                                           |
| ---------------------------- | ----------------------------------------------- |
| Remote tự check-in/check-out | Nhân viên vẫn tự bấm check-in/check-out         |
| Remote tự động chấm công     | Hệ thống tự ghi nhận công theo request đã duyệt |
| Remote cần GPS               | Nhân viên phải gửi vị trí khi chấm công         |
| Remote cần ghi chú           | Nhân viên phải nhập ghi chú công việc           |
| Remote cần task xác nhận     | Có thể liên kết task ở phase sau                |

---

## 8. Nguồn chấm công

| Nguồn               | Mã     | MVP       | Mô tả                                |
| ------------------- | ------ | --------- | ------------------------------------ |
| Web app             | WEB    | Có        | Nhân viên chấm công trên trình duyệt |
| Mobile app          | MOBILE | Có        | Nhân viên chấm công trên điện thoại  |
| Admin/HR adjustment | MANUAL | Có        | HR/Admin điều chỉnh công             |
| Auto attendance     | AUTO   | Có        | Hệ thống tự ghi nhận công theo rule  |
| Remote attendance   | REMOTE | Có        | Chấm công khi làm remote/công tác    |
| Device              | DEVICE | Phase sau | Máy chấm công vật lý                 |
| Import              | IMPORT | Phase sau | Import log từ file                   |
| API integration     | API    | Phase sau | Đồng bộ từ hệ thống khác             |

---

## 9. Trạng thái chấm công

| Trạng thái        | Mã                 | Ý nghĩa                                         |
| ----------------- | ------------------ | ----------------------------------------------- |
| Chưa chấm công    | Not Checked-in     | Chưa có check-in trong ngày/ca                  |
| Đã check-in       | Checked-in         | Đã có giờ vào, chưa có giờ ra                   |
| Đã check-out      | Checked-out        | Đã có giờ vào và giờ ra                         |
| Có mặt            | Present            | Có đi làm hợp lệ                                |
| Đi muộn           | Late               | Check-in sau giờ cho phép                       |
| Về sớm            | Early Leave        | Check-out trước giờ cho phép                    |
| Thiếu giờ         | Missing Hours      | Tổng giờ làm nhỏ hơn số giờ yêu cầu             |
| Thiếu check-in    | Missing Check-in   | Có check-out hoặc log khác nhưng thiếu check-in |
| Thiếu check-out   | Missing Check-out  | Có check-in nhưng chưa có check-out             |
| Vắng mặt          | Absent             | Không chấm công và không có lý do hợp lệ        |
| Nghỉ phép         | Leave              | Có đơn nghỉ phép được duyệt                     |
| Làm remote        | Remote Work        | Có đơn remote/công tác được duyệt               |
| Tự động chấm công | Auto Attendance    | Hệ thống tự ghi nhận công                       |
| Đã điều chỉnh     | Adjusted           | Bản ghi đã được điều chỉnh                      |
| Chờ điều chỉnh    | Pending Adjustment | Có yêu cầu điều chỉnh đang chờ duyệt            |
| Không hợp lệ      | Invalid            | Bản ghi không hợp lệ hoặc bị hủy                |

---

## 10. Nguyên tắc ưu tiên rule

Khi xác định nhân viên có được check-in/check-out hay không, hệ thống kiểm tra theo thứ tự ưu tiên:

```text
1. Trạng thái nhân viên
2. Ngày nghỉ lễ/ngày không làm việc
3. Đơn nghỉ phép đã duyệt
4. Đơn remote/công tác đã duyệt
5. Rule tự động chấm công
6. Rule chấm công riêng của nhân viên
7. Rule chấm công của phòng ban
8. Rule chấm công của công ty
9. Rule mặc định hệ thống
```

Nguyên tắc:

1. Trạng thái nhân viên luôn được kiểm tra đầu tiên.
2. Nhân viên đã nghỉ việc không được chấm công.
3. Đơn nghỉ phép Approved có ưu tiên cao hơn check-in/check-out thủ công.
4. Nếu nghỉ cả ngày, hệ thống chặn check-in/check-out.
5. Nếu nghỉ nửa ngày/theo giờ, hệ thống chỉ chặn hoặc tính lại phần thời gian tương ứng.
6. Nếu có remote/công tác Approved, hệ thống áp dụng rule remote.
7. Rule nhân viên ưu tiên cao hơn rule phòng ban.
8. Rule phòng ban ưu tiên cao hơn rule công ty.
9. Nếu nhân viên thuộc diện tự động chấm công, hệ thống có thể không yêu cầu check-in/check-out thủ công.
10. Nếu nhiều rule xung đột, hệ thống dùng rule có độ ưu tiên cao hơn và ghi nhận rule đã áp dụng vào attendance record.

---

## 11. Quyền trong module ATT

### 11.1 Quy ước mã quyền

Cấu trúc:

```text
ATT.RESOURCE.ACTION
```

Ví dụ:

```text
ATT.ATTENDANCE.CHECK_IN
ATT.ATTENDANCE.VIEW_OWN
ATT.ADJUSTMENT.APPROVE
```

---

### 11.2 Danh sách quyền ATT trong MVP

| Mã quyền                        | Mô tả                                       |
| ------------------------------- | ------------------------------------------- |
| ATT.ATTENDANCE.CHECK_IN         | Được check-in                               |
| ATT.ATTENDANCE.CHECK_OUT        | Được check-out                              |
| ATT.ATTENDANCE.VIEW_OWN         | Xem bảng công cá nhân                       |
| ATT.ATTENDANCE.VIEW_TEAM        | Xem bảng công team                          |
| ATT.ATTENDANCE.VIEW_COMPANY     | Xem bảng công toàn công ty                  |
| ATT.ATTENDANCE.VIEW_DETAIL      | Xem chi tiết bản ghi chấm công              |
| ATT.ATTENDANCE.VIEW_SENSITIVE   | Xem dữ liệu nhạy cảm GPS/IP/device/ảnh      |
| ATT.ATTENDANCE.EXPORT           | Xuất dữ liệu công                           |
| ATT.ATTENDANCE.ADJUST_DIRECT    | Điều chỉnh công trực tiếp                   |
| ATT.ATTENDANCE.RECALCULATE      | Tính lại bản ghi công (thủ công/job nội bộ) |
| ATT.ADJUSTMENT.CREATE_OWN       | Gửi yêu cầu điều chỉnh công của chính mình  |
| ATT.ADJUSTMENT.VIEW_OWN         | Xem yêu cầu điều chỉnh công của chính mình  |
| ATT.ADJUSTMENT.VIEW_TEAM        | Xem yêu cầu điều chỉnh công của team        |
| ATT.ADJUSTMENT.VIEW_COMPANY     | Xem yêu cầu điều chỉnh công toàn công ty    |
| ATT.ADJUSTMENT.APPROVE          | Duyệt yêu cầu điều chỉnh công               |
| ATT.ADJUSTMENT.REJECT           | Từ chối yêu cầu điều chỉnh công             |
| ATT.ADJUSTMENT.CANCEL_OWN       | Hủy yêu cầu điều chỉnh công khi còn Pending |
| ATT.SHIFT.VIEW                  | Xem ca làm                                  |
| ATT.SHIFT.CREATE                | Tạo ca làm                                  |
| ATT.SHIFT.UPDATE                | Cập nhật ca làm                             |
| ATT.SHIFT.DELETE                | Xóa mềm/vô hiệu hóa ca làm                  |
| ATT.SHIFT_ASSIGNMENT.VIEW       | Xem gán ca                                  |
| ATT.SHIFT_ASSIGNMENT.UPDATE     | Gán/cập nhật ca                             |
| ATT.RULE.VIEW                   | Xem rule chấm công                          |
| ATT.RULE.CONFIG                 | Cấu hình rule chấm công                     |
| ATT.REMOTE_REQUEST.CREATE_OWN   | Gửi yêu cầu remote/công tác                 |
| ATT.REMOTE_REQUEST.VIEW_OWN     | Xem yêu cầu remote/công tác của mình        |
| ATT.REMOTE_REQUEST.VIEW_TEAM    | Xem yêu cầu remote/công tác của team        |
| ATT.REMOTE_REQUEST.VIEW_COMPANY | Xem yêu cầu remote/công tác toàn công ty    |
| ATT.REMOTE_REQUEST.APPROVE      | Duyệt yêu cầu remote/công tác               |
| ATT.REMOTE_REQUEST.REJECT       | Từ chối yêu cầu remote/công tác             |
| ATT.REMOTE_REQUEST.CANCEL_OWN   | Hủy yêu cầu remote/công tác khi còn Pending |
| ATT.AUDIT_LOG.VIEW              | Xem lịch sử thao tác chấm công              |

---

## 12. Ma trận phân quyền MVP

| Chức năng                           | Super Admin | Admin công ty   | HR              | Manager        | Employee |
| ----------------------------------- | ----------- | --------------- | --------------- | -------------- | -------- |
| Check-in cá nhân                    | Có          | Có              | Có              | Có             | Có       |
| Check-out cá nhân                   | Có          | Có              | Có              | Có             | Có       |
| Xem trạng thái hôm nay của bản thân | Có          | Có              | Có              | Có             | Có       |
| Xem bảng công cá nhân               | Có          | Có              | Có              | Có             | Có       |
| Xem bảng công team                  | Có          | Có nếu được cấp | Có nếu được cấp | Có             | Không    |
| Xem bảng công toàn công ty          | Có          | Có nếu được cấp | Có              | Không mặc định | Không    |
| Xem chi tiết ngày công              | Có          | Có nếu được cấp | Có              | Có với team    | Chỉ Own  |
| Cấu hình ca làm                     | Có          | Có nếu được cấp | Có nếu được cấp | Không          | Không    |
| Gán ca làm                          | Có          | Có nếu được cấp | Có nếu được cấp | Không mặc định | Không    |
| Cấu hình rule chấm công             | Có          | Có nếu được cấp | Có nếu được cấp | Không          | Không    |
| Gửi yêu cầu điều chỉnh công         | Có          | Có              | Có              | Có             | Có       |
| Xem yêu cầu điều chỉnh của mình     | Có          | Có              | Có              | Có             | Có       |
| Xem yêu cầu điều chỉnh team         | Có          | Có nếu được cấp | Có nếu được cấp | Có             | Không    |
| Xem yêu cầu điều chỉnh toàn công ty | Có          | Có nếu được cấp | Có              | Không          | Không    |
| Duyệt điều chỉnh công               | Có          | Có nếu được cấp | Có              | Có với team    | Không    |
| Từ chối điều chỉnh công             | Có          | Có nếu được cấp | Có              | Có với team    | Không    |
| Điều chỉnh công trực tiếp           | Có          | Có nếu được cấp | Có              | Không mặc định | Không    |
| Gửi yêu cầu remote/công tác         | Có          | Có              | Có              | Có             | Có       |
| Duyệt remote/công tác               | Có          | Có nếu được cấp | Có nếu được cấp | Có với team    | Không    |
| Xuất bảng công                      | Có          | Có nếu được cấp | Có nếu được cấp | Không mặc định | Không    |
| Xem audit log ATT                   | Có          | Có nếu được cấp | Có nếu được cấp | Không mặc định | Không    |

---

## 13. Danh sách màn hình

| Mã màn hình    | Tên màn hình                          | Người dùng truy cập                      |
| -------------- | ------------------------------------- | ---------------------------------------- |
| ATT-SCREEN-001 | Chấm công hôm nay                     | Employee, Manager, HR, Admin             |
| ATT-SCREEN-002 | Bảng công cá nhân                     | Tất cả user có employee_id               |
| ATT-SCREEN-003 | Chi tiết ngày công                    | Chủ bản ghi, Manager/HR/Admin theo quyền |
| ATT-SCREEN-004 | Bảng công team                        | Manager, HR/Admin theo quyền             |
| ATT-SCREEN-005 | Bảng công toàn công ty                | HR/Admin                                 |
| ATT-SCREEN-006 | Danh sách yêu cầu điều chỉnh công     | Employee Own, Manager, HR/Admin          |
| ATT-SCREEN-007 | Tạo yêu cầu điều chỉnh công           | Employee, Manager, HR/Admin              |
| ATT-SCREEN-008 | Chi tiết yêu cầu điều chỉnh công      | Người tạo, Manager/HR/Admin theo quyền   |
| ATT-SCREEN-009 | Duyệt/từ chối yêu cầu điều chỉnh công | Manager, HR/Admin                        |
| ATT-SCREEN-010 | Điều chỉnh công trực tiếp             | HR/Admin có quyền                        |
| ATT-SCREEN-011 | Danh sách ca làm                      | HR/Admin                                 |
| ATT-SCREEN-012 | Tạo/chỉnh sửa ca làm                  | HR/Admin                                 |
| ATT-SCREEN-013 | Gán ca làm                            | HR/Admin                                 |
| ATT-SCREEN-014 | Cấu hình rule chấm công               | HR/Admin                                 |
| ATT-SCREEN-015 | Remote/Công tác của tôi               | Employee, Manager, HR/Admin              |
| ATT-SCREEN-016 | Danh sách yêu cầu remote/công tác     | Manager, HR/Admin                        |
| ATT-SCREEN-017 | Chi tiết yêu cầu remote/công tác      | Người tạo, Manager/HR/Admin theo quyền   |
| ATT-SCREEN-018 | Lịch sử thao tác chấm công            | HR/Admin có quyền                        |
| ATT-SCREEN-019 | Xuất bảng công                        | HR/Admin có quyền                        |

---

## 14. Luồng nghiệp vụ tổng quan

### 14.1 Luồng check-in

```text
Employee đăng nhập
→ Vào Dashboard hoặc màn hình Chấm công hôm nay
→ Hệ thống hiển thị trạng thái chấm công hôm nay
→ Employee bấm Check-in
→ Hệ thống kiểm tra quyền
→ Hệ thống lấy employee_id từ user hiện tại
→ Hệ thống kiểm tra trạng thái nhân viên
→ Hệ thống kiểm tra ngày làm việc/ca làm
→ Hệ thống kiểm tra đơn nghỉ phép Approved
→ Hệ thống kiểm tra đơn remote/công tác Approved
→ Hệ thống kiểm tra rule tự động chấm công
→ Hệ thống lấy thời gian server
→ Hệ thống ghi nhận check-in
→ Hệ thống tính đúng giờ/đi muộn
→ Hệ thống tạo/cập nhật attendance record
→ Hệ thống tạo attendance log
→ Hệ thống ghi audit log
→ Hệ thống hiển thị kết quả thành công
```

---

### 14.2 Luồng check-out

```text
Employee đăng nhập
→ Vào Dashboard hoặc màn hình Chấm công hôm nay
→ Hệ thống hiển thị đã check-in
→ Employee bấm Check-out
→ Hệ thống kiểm tra quyền
→ Hệ thống lấy attendance record hôm nay
→ Hệ thống kiểm tra đã check-in chưa
→ Hệ thống kiểm tra đã check-out chưa
→ Hệ thống lấy thời gian server
→ Hệ thống ghi nhận check-out
→ Hệ thống tính tổng thời gian làm việc
→ Hệ thống tính về sớm nếu có
→ Hệ thống tính thiếu giờ/đủ công
→ Hệ thống cập nhật attendance record
→ Hệ thống tạo attendance log
→ Hệ thống ghi audit log
→ Hệ thống hiển thị kết quả thành công
```

---

### 14.3 Luồng Employee xem bảng công cá nhân

```text
Employee đăng nhập
→ Vào Chấm công > Bảng công của tôi
→ Hệ thống lấy employee_id hiện tại
→ Hệ thống hiển thị danh sách bản ghi công theo tháng
→ Employee có thể lọc theo tháng, trạng thái, nguồn chấm công
→ Employee mở chi tiết một ngày công
→ Employee có thể gửi yêu cầu điều chỉnh nếu cần
```

---

### 14.4 Luồng Manager xem bảng công team

```text
Manager đăng nhập
→ Vào Chấm công > Bảng công team
→ Hệ thống xác định scope Team của Manager
→ Hệ thống hiển thị bảng công nhân viên thuộc team
→ Manager lọc theo nhân viên, phòng ban, trạng thái, ngày
→ Manager mở chi tiết ngày công nếu có quyền
→ Manager xử lý yêu cầu điều chỉnh công nếu có
```

---

### 14.5 Luồng HR xem bảng công toàn công ty

```text
HR đăng nhập
→ Vào Chấm công > Bảng công
→ Hệ thống kiểm tra quyền ATT.ATTENDANCE.VIEW_COMPANY
→ Hệ thống hiển thị bảng công toàn công ty
→ HR lọc theo phòng ban, nhân viên, ca, trạng thái, ngày
→ HR kiểm tra bất thường
→ HR có thể điều chỉnh công trực tiếp nếu có quyền
→ HR có thể xuất bảng công nếu có quyền
```

---

### 14.6 Luồng Employee gửi yêu cầu điều chỉnh công

```text
Employee mở Bảng công của tôi
→ Chọn ngày công cần điều chỉnh
→ Bấm Gửi yêu cầu điều chỉnh
→ Chọn loại điều chỉnh: thiếu check-in, thiếu check-out, sai giờ, lý do đi muộn/về sớm
→ Nhập giờ đề xuất nếu cần
→ Nhập lý do
→ Đính kèm file nếu có
→ Bấm Gửi yêu cầu
→ Hệ thống tạo adjustment request trạng thái Pending
→ Hệ thống gửi thông báo cho Manager/HR có quyền duyệt
→ Hệ thống ghi audit log
```

---

### 14.7 Luồng Manager/HR duyệt điều chỉnh công

```text
Manager/HR mở danh sách yêu cầu điều chỉnh công
→ Chọn yêu cầu Pending
→ Xem thông tin nhân viên
→ Xem bản ghi công hiện tại
→ Xem giá trị nhân viên đề xuất
→ Xem lý do và file đính kèm
→ Bấm Duyệt
→ Hệ thống cập nhật attendance record
→ Hệ thống chuyển adjustment request sang Approved
→ Hệ thống ghi audit log
→ Hệ thống gửi thông báo kết quả cho Employee
```

---

### 14.8 Luồng Manager/HR từ chối điều chỉnh công

```text
Manager/HR mở yêu cầu Pending
→ Xem nội dung điều chỉnh
→ Bấm Từ chối
→ Nhập lý do từ chối
→ Hệ thống chuyển adjustment request sang Rejected
→ Attendance record không thay đổi
→ Hệ thống ghi audit log
→ Hệ thống gửi thông báo kết quả cho Employee
```

---

### 14.9 Luồng HR/Admin điều chỉnh công trực tiếp

```text
HR/Admin mở chi tiết ngày công
→ Bấm Điều chỉnh trực tiếp
→ Nhập giờ check-in/check-out mới hoặc trạng thái mới
→ Nhập lý do bắt buộc
→ Xác nhận
→ Hệ thống kiểm tra quyền
→ Hệ thống cập nhật attendance record
→ Hệ thống tạo adjustment log
→ Hệ thống ghi audit log
→ Hệ thống có thể gửi thông báo cho Employee
```

---

### 14.10 Luồng tự động chấm công

```text
Đến thời điểm job tự động chạy
→ Hệ thống lấy danh sách nhân viên thuộc diện tự động chấm công
→ Kiểm tra trạng thái nhân viên
→ Kiểm tra ngày làm việc/ca làm
→ Kiểm tra nghỉ phép Approved
→ Kiểm tra remote/công tác nếu có
→ Tạo attendance record nguồn AUTO
→ Ghi trạng thái Auto Attendance hoặc Present
→ Ghi audit/system log
→ Gửi thông báo nếu cấu hình
```

---

### 14.11 Luồng remote/công tác tự động chấm công

```text
Remote/Công tác request được Approved
→ Đến ngày áp dụng
→ Hệ thống kiểm tra rule remote
→ Nếu remote auto attendance
→ Hệ thống tạo attendance record nguồn REMOTE/AUTO
→ Ghi worked_minutes theo cấu hình
→ Trạng thái Remote Work
→ Employee không cần check-in/check-out
```

---

## 15. Chi tiết chức năng

### 15.1 ATT-FUNC-001: Check-in

#### Mục tiêu

Cho phép nhân viên ghi nhận thời điểm bắt đầu làm việc.

#### Người dùng

* Employee.
* Manager.
* HR.
* Admin công ty.
* Super Admin.

Điều kiện: user phải liên kết với một employee hợp lệ.

#### Điều kiện trước

* User đã đăng nhập.
* Token/session hợp lệ.
* User có quyền `ATT.ATTENDANCE.CHECK_IN`.
* Employee đang ở trạng thái được phép chấm công.
* Ngày hiện tại là ngày được phép chấm công theo rule.
* Employee chưa check-in trong ngày/ca nếu MVP chỉ cho một lần check-in.
* Employee không có đơn nghỉ cả ngày Approved.
* Employee không thuộc rule tự động chấm công bắt buộc.

#### Dữ liệu client gửi

| Trường      | Bắt buộc | Ghi chú                  |
| ----------- | -------- | ------------------------ |
| source      | Có       | WEB/MOBILE               |
| device_id   | Không    | ID thiết bị nếu có       |
| device_name | Không    | Tên thiết bị             |
| platform    | Không    | Browser/iOS/Android      |
| latitude    | Tùy rule | GPS nếu rule yêu cầu     |
| longitude   | Tùy rule | GPS nếu rule yêu cầu     |
| note        | Tùy rule | Ghi chú nếu rule yêu cầu |

Lưu ý:

```text
Client không được gửi check_in_at trong MVP.
Backend luôn dùng server time.
```

#### Luồng chính

1. User bấm Check-in.
2. Frontend gọi API check-in.
3. Backend xác thực user.
4. Backend lấy employee_id.
5. Backend kiểm tra quyền.
6. Backend kiểm tra trạng thái nhân viên.
7. Backend xác định ca/rule áp dụng.
8. Backend kiểm tra leave/remote/auto attendance.
9. Backend kiểm tra đã check-in chưa.
10. Backend lấy server time.
11. Backend tạo hoặc cập nhật attendance record.
12. Backend tạo attendance log.
13. Backend tính trạng thái Late/On time.
14. Backend ghi audit log.
15. Backend trả kết quả.

#### Kết quả thành công

* Attendance record được tạo hoặc cập nhật.
* Attendance log được tạo.
* Giờ check-in được ghi bằng server time.
* Trạng thái đúng giờ/đi muộn được tính.
* User thấy thông báo check-in thành công.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp                   | Thông báo                                                |
| ----------- | ---------------------------- | -------------------------------------------------------- |
| ATT-ERR-001 | Chưa đăng nhập               | Bạn cần đăng nhập để chấm công                           |
| ATT-ERR-002 | Không có quyền check-in      | Bạn không có quyền check-in                              |
| ATT-ERR-003 | User chưa liên kết employee  | Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên |
| ATT-ERR-004 | Nhân viên không còn làm việc | Tài khoản nhân viên không còn ở trạng thái làm việc      |
| ATT-ERR-005 | Không phải ngày làm việc     | Hôm nay không phải ngày làm việc theo lịch của bạn       |
| ATT-ERR-006 | Có đơn nghỉ cả ngày Approved | Bạn đã có đơn nghỉ phép được duyệt trong ngày hôm nay    |
| ATT-ERR-007 | Remote auto attendance       | Hôm nay bạn đã được ghi nhận công remote tự động         |
| ATT-ERR-008 | Auto attendance              | Bạn thuộc nhóm được tự động chấm công                    |
| ATT-ERR-009 | Đã check-in                  | Bạn đã check-in hôm nay                                  |
| ATT-ERR-010 | GPS bắt buộc nhưng thiếu     | Vui lòng bật định vị để chấm công                        |
| ATT-ERR-011 | Vị trí không hợp lệ          | Vị trí chấm công không hợp lệ                            |

---

### 15.2 ATT-FUNC-002: Check-out

#### Mục tiêu

Cho phép nhân viên ghi nhận thời điểm kết thúc làm việc.

#### Điều kiện trước

* User đã đăng nhập.
* User có quyền `ATT.ATTENDANCE.CHECK_OUT`.
* Employee đã check-in.
* Employee chưa check-out.
* Check-out time theo server phải lớn hơn check-in time.
* Nếu rule yêu cầu GPS/ghi chú, client phải gửi đủ dữ liệu.

#### Dữ liệu client gửi

| Trường      | Bắt buộc | Ghi chú                  |
| ----------- | -------- | ------------------------ |
| source      | Có       | WEB/MOBILE               |
| device_id   | Không    | ID thiết bị nếu có       |
| device_name | Không    | Tên thiết bị             |
| platform    | Không    | Browser/iOS/Android      |
| latitude    | Tùy rule | GPS nếu rule yêu cầu     |
| longitude   | Tùy rule | GPS nếu rule yêu cầu     |
| note        | Tùy rule | Ghi chú nếu rule yêu cầu |

#### Luồng chính

1. User bấm Check-out.
2. Frontend gọi API check-out.
3. Backend xác thực user.
4. Backend lấy employee_id.
5. Backend kiểm tra quyền.
6. Backend lấy attendance record hôm nay.
7. Backend kiểm tra đã check-in chưa.
8. Backend kiểm tra đã check-out chưa.
9. Backend lấy server time.
10. Backend tính tổng phút làm việc.
11. Backend tính về sớm nếu có.
12. Backend tính thiếu giờ/đủ công.
13. Backend cập nhật attendance record.
14. Backend tạo attendance log.
15. Backend ghi audit log.
16. Backend trả kết quả.

#### Kết quả thành công

* Attendance record được cập nhật check_out_at.
* Attendance log được tạo.
* Tổng phút làm việc được tính.
* Trạng thái về sớm/thiếu giờ/đủ công được tính.
* User thấy thông báo check-out thành công.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp                   | Thông báo                                 |
| ----------- | ---------------------------- | ----------------------------------------- |
| ATT-ERR-012 | Không có quyền check-out     | Bạn không có quyền check-out              |
| ATT-ERR-013 | Chưa check-in                | Bạn chưa check-in nên không thể check-out |
| ATT-ERR-014 | Đã check-out                 | Bạn đã check-out hôm nay                  |
| ATT-ERR-015 | Thời gian không hợp lệ       | Thời gian check-out không hợp lệ          |
| ATT-ERR-016 | Không tìm thấy bản ghi công  | Không tìm thấy bản ghi chấm công hôm nay  |
| ATT-ERR-010 | GPS bắt buộc nhưng thiếu     | Vui lòng bật định vị để chấm công         |
| ATT-ERR-017 | Ghi chú bắt buộc nhưng thiếu | Vui lòng nhập ghi chú trước khi check-out |

---

### 15.3 ATT-FUNC-003: Xem trạng thái chấm công hôm nay

#### Mục tiêu

Hiển thị trạng thái chấm công hiện tại của user trong ngày.

#### Dữ liệu hiển thị

* Ngày hiện tại.
* Giờ hiện tại theo server.
* Nhân viên.
* Ca làm hôm nay.
* Rule áp dụng.
* Trạng thái check-in/check-out.
* Giờ check-in.
* Giờ check-out.
* Tổng thời gian làm việc.
* Trạng thái đi muộn/về sớm/thiếu giờ.
* Trạng thái leave/remote/auto attendance nếu có.
* Nút Check-in/Check-out tương ứng.
* Cảnh báo nếu không thể chấm công.

#### Quy tắc hiển thị nút

| Trạng thái                         | Nút Check-in | Nút Check-out |
| ---------------------------------- | ------------ | ------------- |
| Chưa check-in                      | Hiển thị     | Ẩn/Disable    |
| Đã check-in                        | Ẩn/Disable   | Hiển thị      |
| Đã check-out                       | Ẩn/Disable   | Ẩn/Disable    |
| Nghỉ phép cả ngày                  | Ẩn/Disable   | Ẩn/Disable    |
| Remote tự động                     | Ẩn/Disable   | Ẩn/Disable    |
| Tự động chấm công                  | Ẩn/Disable   | Ẩn/Disable    |
| Không có ca và rule bắt buộc có ca | Ẩn/Disable   | Ẩn/Disable    |

---

### 15.4 ATT-FUNC-004: Xem bảng công cá nhân

#### Mục tiêu

Cho phép Employee xem lịch sử chấm công của chính mình.

#### Bộ lọc

| Bộ lọc      | Mô tả                                          |
| ----------- | ---------------------------------------------- |
| Tháng       | Chọn tháng xem bảng công                       |
| Khoảng ngày | Từ ngày - đến ngày                             |
| Trạng thái  | Present/Late/Early Leave/Missing Check-out/... |
| Nguồn       | WEB/MOBILE/REMOTE/AUTO/MANUAL                  |
| Ca làm      | Lọc theo shift                                 |

#### Cột hiển thị

| Cột        | Mô tả                            |
| ---------- | -------------------------------- |
| Ngày       | Ngày làm việc                    |
| Ca         | Ca áp dụng                       |
| Check-in   | Giờ vào                          |
| Check-out  | Giờ ra                           |
| Tổng giờ   | Tổng thời gian làm việc          |
| Trạng thái | Trạng thái công                  |
| Nguồn      | Nguồn chấm công                  |
| Ghi chú    | Ghi chú nếu có                   |
| Hành động  | Xem chi tiết, yêu cầu điều chỉnh |

---

### 15.5 ATT-FUNC-005: Xem chi tiết ngày công

#### Mục tiêu

Hiển thị toàn bộ thông tin của một bản ghi chấm công.

#### Nội dung

* Thông tin nhân viên.
* Ngày làm việc.
* Ca áp dụng.
* Rule áp dụng.
* Check-in time.
* Check-out time.
* Working minutes.
* Required working minutes.
* Late minutes.
* Early leave minutes.
* Missing minutes.
* Attendance status.
* Source.
* Device.
* IP.
* GPS nếu có.
* Attendance logs.
* Điều chỉnh đã duyệt nếu có.
* Yêu cầu điều chỉnh liên quan nếu có.
* Audit log nếu có quyền.

---

### 15.5.1 ATT-FUNC-006: Xem bảng công team

#### Mục tiêu

Cho phép Manager (và HR/Admin được cấp quyền) xem bảng công của nhân viên thuộc phạm vi quản lý.

#### Người dùng

* Manager với scope Team.
* HR/Admin nếu được cấp quyền.
* Super Admin.

#### Điều kiện trước

* User đã đăng nhập.
* Token/session hợp lệ.
* User có quyền `ATT.ATTENDANCE.VIEW_TEAM`.
* User có scope quản lý Team hợp lệ.

#### Bộ lọc

| Bộ lọc      | Mô tả                         |
| ----------- | ----------------------------- |
| Nhân viên   | Lọc theo nhân viên trong team |
| Phòng ban   | Lọc theo phòng ban            |
| Trạng thái  | Present/Late/Early Leave/...  |
| Nguồn       | WEB/MOBILE/REMOTE/AUTO/MANUAL |
| Ca làm      | Lọc theo shift                |
| Khoảng ngày | Từ ngày - đến ngày            |

#### Luồng chính

1. Manager mở Bảng công team.
2. Frontend gọi API bảng công team.
3. Backend xác thực user.
4. Backend kiểm tra quyền `ATT.ATTENDANCE.VIEW_TEAM`.
5. Backend xác định scope Team của Manager.
6. Backend lấy danh sách nhân viên thuộc team.
7. Backend áp dụng bộ lọc và phân trang.
8. Backend trả dữ liệu trong phạm vi data scope.
9. Manager mở chi tiết ngày công nếu có quyền.

#### Kết quả thành công

* Hiển thị bảng công của nhân viên thuộc team.
* Không trả dữ liệu ngoài data scope.
* Có phân trang và bộ lọc hoạt động đúng.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp                   | Thông báo                          |
| ----------- | ---------------------------- | ---------------------------------- |
| ATT-ERR-001 | Chưa đăng nhập               | Bạn cần đăng nhập để chấm công     |
| ATT-ERR-018 | Không có quyền xem bảng công | Bạn không có quyền xem dữ liệu này |

#### Tiêu chí nghiệm thu

1. Manager chỉ xem được nhân viên thuộc scope Team.
2. Không trả dữ liệu ngoài data scope.
3. Bộ lọc và phân trang hoạt động đúng.
4. User không có quyền `ATT.ATTENDANCE.VIEW_TEAM` bị chặn.

---

### 15.5.2 ATT-FUNC-007: Xem bảng công toàn công ty

#### Mục tiêu

Cho phép HR/Admin xem bảng công của toàn bộ nhân viên trong công ty.

#### Người dùng

* HR.
* Admin công ty nếu được cấp quyền.
* Super Admin.

#### Điều kiện trước

* User đã đăng nhập.
* Token/session hợp lệ.
* User có quyền `ATT.ATTENDANCE.VIEW_COMPANY`.

#### Bộ lọc

| Bộ lọc          | Mô tả                         |
| --------------- | ----------------------------- |
| Phòng ban       | Lọc theo phòng ban            |
| Nhân viên       | Lọc theo nhân viên            |
| Trạng thái công | Present/Late/Absent/...       |
| Trạng thái NV   | Probation/Official/...        |
| Nguồn           | WEB/MOBILE/REMOTE/AUTO/MANUAL |
| Ca làm          | Lọc theo shift                |
| Khoảng ngày     | Từ ngày - đến ngày            |

#### Luồng chính

1. HR mở Bảng công toàn công ty.
2. Frontend gọi API bảng công toàn công ty.
3. Backend xác thực user.
4. Backend kiểm tra quyền `ATT.ATTENDANCE.VIEW_COMPANY`.
5. Backend lấy dữ liệu trong phạm vi công ty.
6. Backend áp dụng bộ lọc và phân trang.
7. Backend trả dữ liệu kèm cảnh báo bất thường nếu có.
8. HR có thể mở chi tiết, điều chỉnh hoặc xuất bảng công nếu có quyền.

#### Kết quả thành công

* Hiển thị bảng công toàn công ty.
* Cảnh báo bất thường được hiển thị nếu có.
* Có phân trang và bộ lọc hoạt động đúng.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp                   | Thông báo                          |
| ----------- | ---------------------------- | ---------------------------------- |
| ATT-ERR-001 | Chưa đăng nhập               | Bạn cần đăng nhập để chấm công     |
| ATT-ERR-018 | Không có quyền xem bảng công | Bạn không có quyền xem dữ liệu này |

#### Tiêu chí nghiệm thu

1. HR xem được bảng công toàn công ty nếu có quyền.
2. Không trả dữ liệu ngoài phạm vi công ty.
3. Bộ lọc và phân trang hoạt động đúng.
4. User không có quyền `ATT.ATTENDANCE.VIEW_COMPANY` bị chặn.

---

### 15.5.3 ATT-FUNC-008: Tìm kiếm, lọc, phân trang bảng công

#### Mục tiêu

Cung cấp khả năng tìm kiếm, lọc và phân trang dùng chung cho các màn hình bảng công cá nhân, team và toàn công ty.

#### Người dùng

* Employee với scope Own.
* Manager với scope Team.
* HR/Admin với scope Company.

#### Điều kiện trước

* User đã đăng nhập.
* User có một trong các quyền xem bảng công tương ứng scope: `ATT.ATTENDANCE.VIEW_OWN`, `ATT.ATTENDANCE.VIEW_TEAM`, `ATT.ATTENDANCE.VIEW_COMPANY`.

#### Tham số tìm kiếm/lọc

| Tham số    | Mô tả                     |
| ---------- | ------------------------- |
| keyword    | Tìm theo tên/mã nhân viên |
| month      | Lọc theo tháng            |
| date_from  | Từ ngày                   |
| date_to    | Đến ngày                  |
| status     | Trạng thái công           |
| source     | Nguồn chấm công           |
| shift_id   | Ca làm                    |
| department | Phòng ban                 |
| page       | Trang hiện tại            |
| limit      | Số bản ghi mỗi trang      |

#### Luồng chính

1. User nhập từ khóa hoặc chọn bộ lọc.
2. Frontend gọi API bảng công kèm tham số.
3. Backend xác thực user và xác định data scope theo quyền.
4. Backend validate tham số lọc và phân trang.
5. Backend áp dụng điều kiện lọc trong phạm vi scope.
6. Backend trả về dữ liệu phân trang theo chuẩn `{page, limit, total, total_pages}`.

#### Kết quả thành công

* Kết quả trả về đúng theo bộ lọc và scope.
* Phân trang trả về đúng tổng số bản ghi và số trang.
* Tìm kiếm theo từ khóa hoạt động đúng.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp                   | Thông báo                          |
| ----------- | ---------------------------- | ---------------------------------- |
| ATT-ERR-001 | Chưa đăng nhập               | Bạn cần đăng nhập để chấm công     |
| ATT-ERR-018 | Không có quyền xem bảng công | Bạn không có quyền xem dữ liệu này |

#### Tiêu chí nghiệm thu

1. Bộ lọc hoạt động đúng trên cả ba scope.
2. Phân trang trả về đúng dữ liệu meta.
3. Tìm kiếm theo từ khóa hoạt động đúng.
4. Kết quả luôn nằm trong data scope của user.

---

### 15.6 ATT-FUNC-009: Quản lý ca làm việc

#### Mục tiêu

Cho phép HR/Admin tạo và quản lý danh mục ca làm việc.

#### Trường dữ liệu ca làm

| Trường                    | Bắt buộc     | Ghi chú                                |
| ------------------------- | ------------ | -------------------------------------- |
| shift_code                | Có           | Mã ca                                  |
| shift_name                | Có           | Tên ca                                 |
| shift_type                | Có           | Fixed/Flexible                         |
| start_time                | Có nếu fixed | Giờ bắt đầu                            |
| end_time                  | Có nếu fixed | Giờ kết thúc                           |
| break_start_time          | Không        | Giờ bắt đầu nghỉ giữa ca               |
| break_end_time            | Không        | Giờ kết thúc nghỉ giữa ca              |
| required_worked_minutes  | Có           | Số phút làm việc yêu cầu               |
| check_in_from             | Không        | Thời gian cho phép check-in sớm nhất   |
| check_in_to               | Không        | Thời gian cho phép check-in muộn nhất  |
| check_out_from            | Không        | Thời gian cho phép check-out sớm nhất  |
| check_out_to              | Không        | Thời gian cho phép check-out muộn nhất |
| late_grace_minutes        | Không        | Số phút cho phép đi muộn               |
| early_leave_grace_minutes | Không        | Số phút cho phép về sớm                |
| is_active                 | Có           | Trạng thái sử dụng                     |

#### Quy tắc

1. Không được xóa cứng ca đã có dữ liệu chấm công.
2. Nếu ca không dùng nữa, chuyển `is_active = false`.
3. Khi sửa ca đã dùng trong quá khứ, hệ thống cần cân nhắc versioning hoặc chỉ áp dụng cho tương lai.
4. Nếu sửa ca ảnh hưởng bảng công cũ, cần có chức năng tính lại công và audit log.

---

### 15.7 ATT-FUNC-010: Gán ca làm việc

#### Mục tiêu

Gán ca làm cho công ty, phòng ban hoặc từng nhân viên.

#### Phạm vi gán

| Phạm vi       | Ví dụ                                |
| ------------- | ------------------------------------ |
| Company       | Toàn công ty dùng ca hành chính      |
| Department    | Phòng CSKH dùng ca xoay              |
| Employee      | Nhân viên A dùng ca linh hoạt        |
| Date range    | Áp dụng từ 01/07/2026 đến 31/07/2026 |
| Specific date | Gán ca riêng cho một ngày            |

#### Quy tắc ưu tiên

```text
Employee assignment
→ Department assignment
→ Company assignment
→ Default shift
```

---

### 15.8 ATT-FUNC-011: Cấu hình rule chấm công

#### Mục tiêu

Cho phép HR/Admin cấu hình cách hệ thống xử lý chấm công.

#### Các nhóm rule

#### Nhóm check-in/check-out

| Rule                         | Mô tả                                 |
| ---------------------------- | ------------------------------------- |
| require_check_in             | Có bắt buộc check-in không            |
| require_check_out            | Có bắt buộc check-out không           |
| allow_multiple_check_in_out  | Có cho nhiều lần vào/ra không         |
| auto_checkout_enabled        | Có tự động check-out không            |
| auto_checkout_time           | Giờ tự động check-out                 |
| allow_check_in_without_shift | Có cho check-in khi chưa gán ca không |

#### Nhóm đi muộn/về sớm

| Rule                         | Mô tả                           |
| ---------------------------- | ------------------------------- |
| late_grace_minutes           | Cho phép đi muộn bao nhiêu phút |
| early_leave_grace_minutes    | Cho phép về sớm bao nhiêu phút  |
| mark_late_after_grace        | Đánh dấu Late sau grace         |
| mark_early_leave_after_grace | Đánh dấu Early Leave sau grace  |

#### Nhóm remote

| Rule                           | Mô tả                                 |
| ------------------------------ | ------------------------------------- |
| remote_enabled                 | Có hỗ trợ remote không                |
| remote_requires_approval       | Remote có cần duyệt không             |
| remote_attendance_mode         | SELF_CHECK_IN/AUTO_ATTENDANCE/NO_ATTENDANCE |
| remote_requires_gps            | Remote có cần GPS không               |
| remote_requires_note           | Remote có cần ghi chú không           |
| default_remote_worked_minutes | Số phút công mặc định khi remote auto |

#### Nhóm GPS/mobile

| Rule                      | Mô tả                           |
| ------------------------- | ------------------------------- |
| gps_required_for_mobile   | Mobile có bắt buộc GPS không    |
| gps_allowed_radius_meters | Bán kính hợp lệ                 |
| allowed_locations         | Danh sách vị trí được chấm công |
| block_mock_location       | Chặn GPS giả lập, phase sau     |

#### Nhóm tự động chấm công

| Rule                            | Mô tả                          |
| ------------------------------- | ------------------------------ |
| auto_attendance_enabled         | Có bật tự động chấm công không |
| auto_attendance_scope           | Company/Department/Employee    |
| auto_attendance_days            | Ngày áp dụng                   |
| auto_attendance_worked_minutes | Số phút công ghi nhận          |
| auto_attendance_status          | Present/Auto Attendance        |

---

### 15.8.1 ATT-FUNC-012: Tính đi muộn

#### Mục tiêu

Tự động xác định nhân viên đi muộn và số phút đi muộn khi check-in.

#### Người dùng

* Hệ thống (chạy khi xử lý check-in).

#### Điều kiện trước

* Đã có check-in hợp lệ.
* Đã xác định được ca/rule áp dụng.

#### Quy tắc tính

Áp dụng theo §18:

* Ca cố định: nếu `check_in_at` lớn hơn `start_time + late_grace_minutes` thì đánh dấu `Late`.
* Công thức: `late_minutes = check_in_at - (start_time + late_grace_minutes)`.
* Ca linh hoạt: tính theo khoảng check-in cho phép hoặc bỏ qua đi muộn, chỉ tính thiếu giờ tùy cấu hình.

#### Luồng chính

1. Backend nhận sự kiện check-in.
2. Backend lấy ca/rule áp dụng.
3. Backend so sánh `check_in_at` với giờ cho phép theo grace.
4. Backend tính `late_minutes` nếu vượt grace.
5. Backend cập nhật trạng thái `Late` vào attendance record.
6. Backend ghi `rule_snapshot` đã áp dụng.

#### Kết quả thành công

* `late_minutes` được tính đúng.
* Trạng thái `Late` được ghi nhận khi vượt grace.
* Rule áp dụng được lưu vào record.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp        | Thông báo                            |
| ----------- | ----------------- | ------------------------------------ |
| ATT-ERR-026 | Rule không hợp lệ | Cấu hình rule chấm công không hợp lệ |

#### Tiêu chí nghiệm thu

1. Check-in trong grace không bị tính muộn.
2. Check-in sau grace ghi `Late` đúng số phút.
3. Ca linh hoạt xử lý theo cấu hình.
4. Rule áp dụng được lưu vào record.

---

### 15.8.2 ATT-FUNC-013: Tính về sớm

#### Mục tiêu

Tự động xác định nhân viên về sớm và số phút về sớm khi check-out.

#### Người dùng

* Hệ thống (chạy khi xử lý check-out).

#### Điều kiện trước

* Đã có check-in và check-out hợp lệ.
* Đã xác định được ca/rule áp dụng.

#### Quy tắc tính

Áp dụng theo §19:

* Ca cố định: nếu `check_out_at` nhỏ hơn `end_time - early_leave_grace_minutes` thì đánh dấu `Early Leave`.
* Công thức: `early_leave_minutes = (end_time - early_leave_grace_minutes) - check_out_at`.
* Ca linh hoạt: thường không tính về sớm theo giờ ra cố định, chuyển sang xét đủ giờ.
* Nếu có nghỉ phép buổi chiều Approved, check-out buổi trưa không bị tính về sớm.

#### Luồng chính

1. Backend nhận sự kiện check-out.
2. Backend lấy ca/rule áp dụng.
3. Backend kiểm tra nghỉ phép nửa ngày/theo giờ.
4. Backend so sánh `check_out_at` với giờ cho phép theo grace.
5. Backend tính `early_leave_minutes` nếu về sớm.
6. Backend cập nhật trạng thái `Early Leave` vào attendance record.

#### Kết quả thành công

* `early_leave_minutes` được tính đúng.
* Trạng thái `Early Leave` được ghi nhận khi về sớm.
* Trường hợp nghỉ phép nửa ngày được xử lý đúng.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp        | Thông báo                            |
| ----------- | ----------------- | ------------------------------------ |
| ATT-ERR-026 | Rule không hợp lệ | Cấu hình rule chấm công không hợp lệ |

#### Tiêu chí nghiệm thu

1. Check-out trong grace không bị tính về sớm.
2. Check-out trước giờ cho phép ghi `Early Leave` đúng số phút.
3. Nghỉ phép buổi chiều không bị tính về sớm.
4. Ca linh hoạt xử lý theo cấu hình.

---

### 15.8.3 ATT-FUNC-014: Tính thiếu giờ/đủ công

#### Mục tiêu

Tự động tính tổng phút làm việc, số phút thiếu và xác định ngày công đủ hay thiếu.

#### Người dùng

* Hệ thống (chạy khi xử lý check-out hoặc tính lại công).

#### Điều kiện trước

* Đã có dữ liệu check-in/check-out hoặc dữ liệu công hợp lệ.
* Đã xác định được `required_worked_minutes`.

#### Quy tắc tính

Áp dụng theo §20:

* `worked_minutes = check_out_at - check_in_at - break_minutes`.
* Nếu `worked_minutes >= required_worked_minutes` thì đủ công.
* Ngược lại ghi `Missing Hours` với `missing_minutes = required_worked_minutes - worked_minutes`.
* Nghỉ nửa ngày Approved làm giảm `required_worked_minutes` tương ứng.
* Remote auto attendance dùng `default_remote_worked_minutes`.

#### Luồng chính

1. Backend lấy attendance record cần tính.
2. Backend tính `worked_minutes` thực tế.
3. Backend xác định `required_worked_minutes` sau khi trừ nghỉ phép nửa ngày.
4. Backend so sánh và tính `missing_minutes`.
5. Backend cập nhật trạng thái đủ công hoặc `Missing Hours`.

#### Kết quả thành công

* `worked_minutes` và `missing_minutes` được tính đúng.
* Trạng thái đủ công/thiếu giờ được ghi nhận.
* Nghỉ nửa ngày làm giảm required đúng.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp        | Thông báo                            |
| ----------- | ----------------- | ------------------------------------ |
| ATT-ERR-026 | Rule không hợp lệ | Cấu hình rule chấm công không hợp lệ |

#### Tiêu chí nghiệm thu

1. Đủ giờ ghi đủ công.
2. Thiếu giờ ghi `Missing Hours` đúng số phút.
3. Ca linh hoạt tính theo tổng giờ.
4. Nghỉ nửa ngày giảm required đúng.

---

### 15.8.4 ATT-FUNC-015: Chặn chấm công khi có nghỉ phép Approved

#### Mục tiêu

Ngăn nhân viên check-in/check-out khi đã có đơn nghỉ phép Approved theo phạm vi tương ứng.

#### Người dùng

* Hệ thống (chạy trong luồng kiểm tra check-in/check-out).

#### Điều kiện trước

* Đang xử lý request check-in hoặc check-out.
* Có thể truy vấn dữ liệu nghỉ phép từ LEAVE.

#### Quy tắc

Áp dụng theo §16.5 và §10:

* Đơn nghỉ phép Approved ưu tiên cao hơn check-in/check-out thủ công.
* Nghỉ cả ngày: chặn cả check-in và check-out, ghi trạng thái `Leave`.
* Nghỉ nửa ngày/theo giờ: chỉ chặn hoặc tính lại phần thời gian tương ứng.
* Đơn nghỉ Rejected/Cancelled không ảnh hưởng.
* Nếu đơn nghỉ Approved bị hủy sau đó, hệ thống cần tính lại bản ghi công.

#### Luồng chính

1. Backend nhận request check-in/check-out.
2. Backend truy vấn đơn nghỉ phép Approved trong ngày.
3. Nếu nghỉ cả ngày thì chặn thao tác và trả lỗi.
4. Nếu nghỉ nửa ngày/theo giờ thì điều chỉnh phạm vi cho phép và `required_worked_minutes`.
5. Backend ghi trạng thái `Leave` cho phần nghỉ.

#### Kết quả thành công

* Nghỉ cả ngày bị chặn chấm công.
* Nghỉ nửa ngày được xử lý đúng phần thời gian.
* Trạng thái `Leave` được ghi nhận đúng.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp           | Thông báo                                              |
| ----------- | -------------------- | ------------------------------------------------------ |
| ATT-ERR-006 | Có đơn nghỉ Approved | Bạn đã có đơn nghỉ phép được duyệt trong thời gian này |

#### Tiêu chí nghiệm thu

1. Nghỉ cả ngày Approved bị chặn check-in/check-out.
2. Nghỉ nửa ngày xử lý đúng phần thời gian.
3. Đơn nghỉ bị hủy sau Approved khiến công được tính lại.
4. Đơn Rejected/Cancelled không ảnh hưởng.

---

### 15.8.5 ATT-FUNC-016: Xử lý chấm công remote/công tác

#### Mục tiêu

Áp dụng rule remote khi nhân viên có đơn remote/công tác Approved.

#### Người dùng

* Employee có đơn remote/công tác Approved.
* Hệ thống xử lý theo rule remote.

#### Điều kiện trước

* Có đơn remote/công tác Approved trong ngày.
* Rule remote được bật cho phạm vi áp dụng.

#### Quy tắc

Áp dụng theo §16.6 và §20.4:

* Remote tự check-in/check-out: cho phép chấm công, ghi trạng thái `Remote Work`.
* Remote tự động chấm công: hệ thống tạo công tự động, không cần check-in/check-out.
* Nếu rule yêu cầu GPS/ghi chú, client phải gửi đủ dữ liệu.
* Đặt `work_mode = Remote` (hoặc `BusinessTrip`) trên attendance record (DB-04 không có cột `is_remote`).

#### Luồng chính

1. Backend kiểm tra đơn remote/công tác Approved.
2. Backend lấy `attendance_mode` (SELF_CHECK_IN/AUTO_ATTENDANCE/NO_ATTENDANCE).
3. Nếu SELF_CHECK_IN thì cho phép check-in/check-out với trạng thái `Remote Work`.
4. Nếu AUTO_ATTENDANCE thì tạo attendance record nguồn REMOTE/AUTO.
5. Nếu NO_ATTENDANCE thì không tạo record tự động.
6. Backend áp dụng yêu cầu GPS/ghi chú theo rule.
7. Backend ghi audit log.

#### Kết quả thành công

* Ngày remote được ghi nhận đúng trạng thái `Remote Work`.
* `work_mode` được đặt đúng (`Remote`/`BusinessTrip`).
* Yêu cầu GPS/ghi chú được áp dụng theo rule.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp     | Thông báo                                        |
| ----------- | -------------- | ------------------------------------------------ |
| ATT-ERR-007 | Remote tự động | Hôm nay bạn đã được ghi nhận công remote tự động |
| ATT-ERR-010 | Thiếu GPS      | Vui lòng bật định vị để chấm công                |
| ATT-ERR-017 | Thiếu ghi chú  | Vui lòng nhập ghi chú                            |

#### Tiêu chí nghiệm thu

1. Remote tự check-in/check-out ghi trạng thái `Remote Work`.
2. Remote auto tạo công tự động.
3. Yêu cầu GPS/ghi chú được áp dụng đúng.
4. Audit log được ghi.

---

### 15.8.6 ATT-FUNC-017: Tự động chấm công theo cấu hình

#### Mục tiêu

Tự động tạo bản ghi công cho nhóm nhân viên/công việc đặc thù theo rule auto attendance.

#### Người dùng

* Hệ thống (job tự động chạy theo lịch).

#### Điều kiện trước

* `auto_attendance_enabled = true` cho phạm vi áp dụng.
* Đã xác định danh sách nhân viên thuộc diện tự động chấm công.

#### Quy tắc

Áp dụng theo §14.10 và §10:

* Kiểm tra trạng thái nhân viên trước tiên.
* Nghỉ phép Approved ưu tiên cao hơn auto attendance.
* Tạo attendance record nguồn AUTO với `is_auto = true`.
* Ghi `worked_minutes = auto_attendance_worked_minutes`.
* Ghi trạng thái `Auto Attendance` hoặc `Present` theo cấu hình.

#### Luồng chính

1. Job tự động chạy đến thời điểm cấu hình.
2. Hệ thống lấy danh sách nhân viên thuộc diện auto attendance.
3. Hệ thống kiểm tra trạng thái nhân viên và ngày làm việc.
4. Hệ thống kiểm tra nghỉ phép/remote Approved.
5. Hệ thống tạo attendance record nguồn AUTO.
6. Hệ thống ghi audit/system log.
7. Hệ thống gửi thông báo nếu cấu hình bật.

#### Kết quả thành công

* Bản ghi công AUTO được tạo đúng.
* `is_auto` được đặt đúng.
* Nghỉ phép Approved vẫn được ưu tiên.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp        | Thông báo                            |
| ----------- | ----------------- | ------------------------------------ |
| ATT-ERR-026 | Rule không hợp lệ | Cấu hình rule chấm công không hợp lệ |

#### Tiêu chí nghiệm thu

1. Nhân viên thuộc nhóm auto được ghi công tự động.
2. Bản ghi nguồn AUTO được tạo đúng.
3. Nghỉ phép Approved ưu tiên cao hơn auto attendance.
4. Audit/system log được ghi.

---

### 15.9 ATT-FUNC-018: Employee gửi yêu cầu điều chỉnh công

#### Mục tiêu

Cho phép Employee đề xuất chỉnh sửa bản ghi công khi có sai sót hoặc lý do hợp lệ.

#### Loại yêu cầu điều chỉnh

| Loại                | Mã                  | Ví dụ                    |
| ------------------- | ------------------- | ------------------------ |
| Bổ sung check-in    | MISSING_CHECK_IN    | Quên check-in buổi sáng  |
| Bổ sung check-out   | MISSING_CHECK_OUT   | Quên check-out cuối ngày |
| Sửa giờ check-in    | UPDATE_CHECK_IN     | Check-in sai do lỗi mạng |
| Sửa giờ check-out   | UPDATE_CHECK_OUT    | Check-out sai            |
| Giải trình đi muộn  | EXPLAIN_LATE        | Đi muộn do gặp sự cố     |
| Giải trình về sớm   | EXPLAIN_EARLY_LEAVE | Về sớm có lý do          |
| Sửa trạng thái công | UPDATE_STATUS       | Bị ghi vắng mặt sai      |
| Sửa nhận diện remote| REMOTE_CORRECTION   | Remote chưa ghi nhận đúng|
| Khác                | OTHER               | Trường hợp đặc biệt      |

#### Trường dữ liệu

| Trường                   | Bắt buộc | Ghi chú                  |
| ------------------------ | -------- | ------------------------ |
| attendance_record_id     | Có       | Ngày công cần điều chỉnh |
| adjustment_type          | Có       | Loại điều chỉnh          |
| requested_check_in_at  | Tùy loại | Giờ check-in đề xuất     |
| requested_check_out_at | Tùy loại | Giờ check-out đề xuất    |
| requested_status         | Tùy loại | Trạng thái đề xuất       |
| reason                   | Có       | Lý do điều chỉnh         |
| attachments              | Không    | File chứng minh nếu có   |

#### Quy tắc

1. Employee chỉ được gửi yêu cầu cho bản ghi của chính mình.
2. Không được gửi yêu cầu cho kỳ công đã khóa, trừ khi HR/Admin cho phép.
3. Một bản ghi công có thể có tối đa một yêu cầu Pending tại một thời điểm.
4. Yêu cầu mặc định ở trạng thái `Pending`.
5. Employee có thể hủy yêu cầu khi còn `Pending`.
6. Khi yêu cầu được duyệt, attendance record mới được cập nhật.
7. Khi yêu cầu bị từ chối, attendance record giữ nguyên.
8. Mọi thao tác phải ghi audit log.

---

### 15.10 ATT-FUNC-019/020: Duyệt hoặc từ chối yêu cầu điều chỉnh công

#### Người dùng

* Manager có quyền với scope Team.
* HR có quyền với scope Company.
* Admin công ty nếu được cấp quyền.
* Super Admin.

#### Luồng duyệt

```text
Người duyệt mở yêu cầu Pending
→ Xem dữ liệu hiện tại
→ Xem dữ liệu đề xuất
→ Xem lý do và file đính kèm
→ Bấm Duyệt
→ Hệ thống cập nhật attendance record
→ Hệ thống cập nhật trạng thái request = Approved
→ Hệ thống ghi audit log
→ Hệ thống gửi thông báo cho Employee
```

#### Luồng từ chối

```text
Người duyệt mở yêu cầu Pending
→ Bấm Từ chối
→ Nhập lý do từ chối
→ Hệ thống cập nhật trạng thái request = Rejected
→ Attendance record không thay đổi
→ Hệ thống ghi audit log
→ Hệ thống gửi thông báo cho Employee
```

#### Quy tắc

1. Chỉ yêu cầu `Pending` mới được duyệt/từ chối (FSM tường minh: `Draft → Pending → Approved | Rejected | Cancelled`; trạng thái cuối `Approved`/`Rejected`/`Cancelled` là bất biến, không quay lại `Pending`).
2. Từ chối bắt buộc nhập lý do.
3. Nếu attendance record đã bị thay đổi sau khi request được tạo, hệ thống cần cảnh báo xung đột.
4. Manager chỉ được duyệt nhân viên thuộc scope quản lý.
5. HR có thể duyệt toàn công ty nếu có quyền.
6. **Hard-rule (cấm tuyệt đối): người tạo request KHÔNG được tự duyệt/từ chối request của chính mình** — `requested_by ≠ approver_id`. Backend ép kiểm tra ở tầng service, không phụ thuộc cấu hình; vi phạm trả `ATT-ERR-SELF-APPROVAL`. Bắt buộc có deny-path test (RED-trước).
7. Sau khi Approved/Rejected, request không được chỉnh sửa.

---

### 15.11 ATT-FUNC-021: HR/Admin điều chỉnh công trực tiếp

#### Mục tiêu

Cho phép HR/Admin điều chỉnh bản ghi công trực tiếp trong các trường hợp đặc biệt.

#### Trường được phép điều chỉnh

* check_in_at.
* check_out_at.
* attendance_status.
* worked_minutes.
* required_worked_minutes.
* late_minutes.
* early_leave_minutes.
* missing_minutes.
* note.
* adjustment_reason.

#### Quy tắc

1. Chỉ người có quyền `ATT.ATTENDANCE.ADJUST_DIRECT` được thao tác.
2. Bắt buộc nhập lý do điều chỉnh.
3. Hệ thống phải lưu dữ liệu trước và sau điều chỉnh.
4. Hệ thống phải ghi audit log.
5. Có thể gửi thông báo cho Employee nếu cấu hình bật.
6. Nếu kỳ công đã khóa, chỉ Super Admin hoặc HR có quyền đặc biệt mới được mở khóa/điều chỉnh.

---

### 15.12 ATT-FUNC-022: Xem lịch sử điều chỉnh công

#### Mục tiêu

Cho phép xem lịch sử các yêu cầu điều chỉnh và thao tác điều chỉnh trực tiếp đã thực hiện trên bản ghi công.

#### Người dùng

* Employee xem lịch sử của chính mình.
* Manager xem lịch sử trong scope Team.
* HR/Admin xem lịch sử toàn công ty nếu có quyền.

#### Điều kiện trước

* User đã đăng nhập.
* User có một trong các quyền: `ATT.ADJUSTMENT.VIEW_OWN`, `ATT.ADJUSTMENT.VIEW_TEAM`, `ATT.ADJUSTMENT.VIEW_COMPANY` theo scope.

#### Dữ liệu hiển thị

| Trường          | Mô tả                                        |
| --------------- | -------------------------------------------- |
| Ngày công       | Bản ghi công liên quan                       |
| Loại            | Yêu cầu điều chỉnh hoặc điều chỉnh trực tiếp |
| Giá trị cũ      | Dữ liệu trước điều chỉnh                     |
| Giá trị mới     | Dữ liệu sau điều chỉnh                       |
| Người thực hiện | Người gửi/người duyệt/HR                     |
| Trạng thái      | Pending/Approved/Rejected/Cancelled          |
| Thời gian       | Thời điểm thao tác                           |

#### Luồng chính

1. User mở lịch sử điều chỉnh của một bản ghi công hoặc theo bộ lọc.
2. Frontend gọi API danh sách yêu cầu/lịch sử điều chỉnh.
3. Backend xác thực user và xác định data scope.
4. Backend lấy lịch sử yêu cầu điều chỉnh và điều chỉnh trực tiếp.
5. Backend áp dụng bộ lọc và phân trang.
6. Backend trả dữ liệu trong phạm vi scope.

#### Kết quả thành công

* Hiển thị đầy đủ lịch sử điều chỉnh theo scope.
* Hiển thị giá trị cũ/mới của từng lần điều chỉnh.
* Có phân trang.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp                   | Thông báo                          |
| ----------- | ---------------------------- | ---------------------------------- |
| ATT-ERR-001 | Chưa đăng nhập               | Bạn cần đăng nhập để chấm công     |
| ATT-ERR-018 | Không có quyền xem bảng công | Bạn không có quyền xem dữ liệu này |

#### Tiêu chí nghiệm thu

1. Lịch sử điều chỉnh hiển thị đúng theo scope.
2. Giá trị cũ/mới hiển thị đầy đủ.
3. Có phân trang và bộ lọc.
4. Không trả dữ liệu ngoài data scope.

---

### 15.13 ATT-FUNC-023: Gửi thông báo chấm công

#### Mục tiêu

Phát sinh event để module NOTI gửi thông báo cho các sự kiện chấm công quan trọng.

#### Người dùng

* Hệ thống (phát event).
* Người nhận: Employee, Manager, HR/Admin tùy event.

#### Điều kiện trước

* Có cấu hình bật thông báo cho loại sự kiện tương ứng.
* Có sự kiện chấm công vừa xảy ra.

#### Các event chính

Tham chiếu §24:

| Event                          | Người nhận          |
| ------------------------------ | ------------------- |
| ATT_MISSING_CHECKOUT           | Employee/Manager/HR |
| ATT_LATE_DETECTED              | Employee/Manager    |
| ATT_ABSENT_DETECTED            | Employee/Manager/HR |
| ATT_ADJUSTMENT_SUBMITTED       | Manager/HR          |
| ATT_ADJUSTMENT_APPROVED        | Employee            |
| ATT_ADJUSTMENT_REJECTED        | Employee            |
| ATT_AUTO_ATTENDANCE_CREATED    | Employee/HR         |
| ATT_REMOTE_REQUEST_SUBMITTED   | Manager/HR          |
| ATT_REMOTE_REQUEST_APPROVED    | Employee            |
| ATT_REMOTE_REQUEST_REJECTED    | Employee            |
| ATT_REMOTE_REQUEST_CANCELLED   | Manager/HR          |

#### Luồng chính

1. Một sự kiện chấm công xảy ra.
2. ATT kiểm tra cấu hình thông báo cho sự kiện.
3. ATT phát event tương ứng kèm dữ liệu ngữ cảnh.
4. NOTI nhận event và gửi thông báo đến người nhận.
5. Khi người nhận mở thông báo, module gốc kiểm tra lại quyền.

#### Kết quả thành công

* Event được phát đúng loại và đúng người nhận.
* Thông báo được gửi nếu cấu hình bật.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp       | Thông báo                                       |
| ----------- | ---------------- | ----------------------------------------------- |
| ATT-ERR-030 | Xung đột dữ liệu | Dữ liệu chấm công đã thay đổi, vui lòng tải lại |

#### Tiêu chí nghiệm thu

1. Event được phát đúng theo cấu hình.
2. Người nhận đúng theo §24.
3. Mở notification target vẫn kiểm tra lại quyền.
4. Không gửi thông báo nếu cấu hình tắt.

---

### 15.14 ATT-FUNC-024: Xuất bảng công

#### Mục tiêu

Cho phép HR/Admin xuất dữ liệu bảng công ra file phục vụ kiểm tra và tính lương sau này.

#### Người dùng

* HR.
* Admin công ty nếu được cấp quyền.
* Super Admin.

#### Điều kiện trước

* User đã đăng nhập.
* User có quyền `ATT.ATTENDANCE.EXPORT`.
* Đã chọn phạm vi và bộ lọc dữ liệu cần xuất.

#### Tham số xuất

| Tham số    | Mô tả               |
| ---------- | ------------------- |
| date_from  | Từ ngày             |
| date_to    | Đến ngày            |
| department | Phòng ban           |
| status     | Trạng thái công     |
| format     | Định dạng file xuất |

#### Luồng chính

1. HR chọn phạm vi và bộ lọc bảng công.
2. HR bấm Xuất file.
3. Frontend gọi API export.
4. Backend xác thực user.
5. Backend kiểm tra quyền `ATT.ATTENDANCE.EXPORT`.
6. Backend lấy dữ liệu trong phạm vi data scope.
7. Backend tạo file theo định dạng yêu cầu.
8. Backend ghi audit log thao tác export.
9. Backend trả file cho user.

#### Kết quả thành công

* File bảng công được tạo đúng phạm vi và bộ lọc.
* Audit log thao tác export được ghi.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp            | Thông báo                         |
| ----------- | --------------------- | --------------------------------- |
| ATT-ERR-001 | Chưa đăng nhập        | Bạn cần đăng nhập để chấm công    |
| ATT-ERR-027 | Không có quyền export | Bạn không có quyền xuất bảng công |

#### Tiêu chí nghiệm thu

1. HR có quyền xuất được file đúng dữ liệu.
2. User không có quyền `ATT.ATTENDANCE.EXPORT` bị chặn.
3. Dữ liệu xuất nằm trong data scope.
4. Audit log thao tác export được ghi.

---

### 15.15 ATT-FUNC-025: Ghi audit log chấm công

#### Mục tiêu

Ghi nhận đầy đủ mọi thao tác quan trọng trong module ATT để phục vụ truy vết và đối soát.

#### Người dùng

* Hệ thống (ghi log).
* HR/Admin có quyền `ATT.AUDIT_LOG.VIEW` để xem.

#### Điều kiện trước

* Có thao tác quan trọng vừa được thực hiện.

#### Hành động cần ghi log

Tham chiếu §25.1:

* Check-in/check-out (thành công và thất bại do rule quan trọng).
* Tạo/cập nhật/vô hiệu hóa ca làm.
* Gán ca làm.
* Cập nhật rule chấm công.
* Tạo/hủy/duyệt/từ chối yêu cầu điều chỉnh công.
* Điều chỉnh công trực tiếp.
* Tạo/duyệt/từ chối remote request.
* Tự động chấm công.
* Xuất bảng công.

#### Luồng chính

1. Một thao tác quan trọng được thực hiện.
2. Backend ghi audit log với actor, target, old_value, new_value.
3. Backend lưu IP và user agent.
4. Khi HR/Admin có quyền mở lịch sử, hệ thống trả dữ liệu log theo scope.

#### Kết quả thành công

* Audit log được ghi đầy đủ cho mọi thao tác quan trọng.
* Lưu được dữ liệu trước và sau khi thay đổi.

#### Lỗi có thể xảy ra

| Mã lỗi      | Trường hợp                   | Thông báo                          |
| ----------- | ---------------------------- | ---------------------------------- |
| ATT-ERR-018 | Không có quyền xem bảng công | Bạn không có quyền xem dữ liệu này |

#### Tiêu chí nghiệm thu

1. Mọi thao tác trong §25.1 đều ghi audit log.
2. Log lưu đủ dữ liệu trước và sau.
3. Chỉ user có quyền `ATT.AUDIT_LOG.VIEW` xem được log.
4. Log không bị sửa/xóa bởi user thường.

---

## 16. Quy tắc kiểm tra trước khi check-in

### 16.1 Kiểm tra đăng nhập

Điều kiện:

* User đã đăng nhập.
* Token/session hợp lệ.
* User có quyền `ATT.ATTENDANCE.CHECK_IN`.

Nếu không hợp lệ:

```text
Bạn cần đăng nhập để chấm công.
```

---

### 16.2 Kiểm tra liên kết employee

Điều kiện:

* User hiện tại phải liên kết với một `employee_id`.

Nếu chưa liên kết:

```text
Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên.
```

---

### 16.3 Kiểm tra trạng thái nhân viên

| Trạng thái nhân viên  | Cho phép chấm công |
| --------------------- | ------------------ |
| Probation             | Có                 |
| Official              | Có                 |
| Temporarily Suspended | Theo cấu hình      |
| Resigned              | Không              |
| Terminated            | Không              |

Nếu nhân viên đã nghỉ việc:

```text
Tài khoản nhân viên không còn ở trạng thái làm việc, không thể chấm công.
```

---

### 16.4 Kiểm tra ngày làm việc

| Trường hợp                | Xử lý                                           |
| ------------------------- | ----------------------------------------------- |
| Ngày làm việc bình thường | Cho phép check-in                               |
| Ngày nghỉ cuối tuần       | Chặn hoặc cho phép nếu có ca/lệnh làm thêm      |
| Ngày lễ                   | Chặn hoặc cho phép nếu có rule làm việc ngày lễ |
| Ngày không có ca          | Chặn hoặc cho phép theo ca linh hoạt            |

Thông báo nếu bị chặn:

```text
Hôm nay không phải ngày làm việc theo lịch của bạn.
```

---

### 16.5 Kiểm tra đơn nghỉ phép

| Loại nghỉ                   | Xử lý                                                         |
| --------------------------- | ------------------------------------------------------------- |
| Nghỉ cả ngày                | Chặn check-in                                                 |
| Nghỉ buổi sáng              | Chặn check-in trong buổi sáng, có thể cho check-in buổi chiều |
| Nghỉ buổi chiều             | Cho check-in buổi sáng, xử lý check-out theo rule             |
| Nghỉ theo giờ               | Chặn check-in trong khoảng giờ nghỉ                           |
| Đơn nghỉ Pending            | Cảnh báo hoặc cho phép theo cấu hình                          |
| Đơn nghỉ Rejected/Cancelled | Không ảnh hưởng                                               |

Thông báo:

```text
Bạn đã có đơn nghỉ phép được duyệt trong thời gian này, không thể chấm công.
```

---

### 16.6 Kiểm tra đơn remote/công tác

Nếu nhân viên có đơn remote/công tác Approved trong ngày, hệ thống áp dụng rule remote.

| Chế độ                       | Xử lý                                                  |
| ---------------------------- | ------------------------------------------------------ |
| Remote tự check-in/check-out | Cho phép check-in/check-out với trạng thái Remote Work |
| Remote tự động chấm công     | Không cần check-in, hệ thống tạo công tự động          |
| Remote cần GPS               | Yêu cầu lấy vị trí                                     |
| Remote cần ghi chú           | Bắt buộc nhập ghi chú                                  |
| Remote cần task xác nhận     | Có thể liên kết TASK ở phase sau                       |

---

### 16.7 Kiểm tra tự động chấm công

Nếu nhân viên thuộc nhóm tự động chấm công:

* Hệ thống có thể không hiển thị nút check-in/check-out.
* Hoặc hiển thị trạng thái: “Bạn thuộc nhóm tự động chấm công.”
* Attendance record được tạo tự động theo rule.

---

### 16.8 Kiểm tra ca làm

Thứ tự lấy ca:

```text
Ca gán riêng cho nhân viên
→ Ca gán cho phòng ban
→ Ca mặc định công ty
→ Không có ca
```

Nếu không có ca và hệ thống không cho phép ca linh hoạt:

```text
Bạn chưa được gán ca làm việc cho hôm nay.
```

---

### 16.9 Kiểm tra trùng check-in

MVP đề xuất:

```text
Mỗi nhân viên chỉ có một check-in chính và một check-out chính cho mỗi ngày/ca.
```

Nếu đã check-in:

```text
Bạn đã check-in hôm nay.
```

---

## 17. Quy tắc kiểm tra trước khi check-out

### 17.1 Kiểm tra đã check-in hay chưa

Nếu chưa check-in:

```text
Bạn chưa check-in nên không thể check-out.
```

---

### 17.2 Kiểm tra đã check-out hay chưa

Nếu đã check-out:

```text
Bạn đã check-out hôm nay.
```

---

### 17.3 Check-out phải sau check-in

Nếu check-out time theo server nhỏ hơn hoặc bằng check-in time:

```text
Thời gian check-out không hợp lệ.
```

---

### 17.4 Kiểm tra nghỉ phép nửa ngày/theo giờ

Nếu có đơn nghỉ buổi chiều được duyệt:

```text
Check-out buổi trưa không bị tính về sớm.
```

Nếu có đơn nghỉ theo giờ:

```text
Khoảng thời gian nghỉ được trừ khỏi required working minutes.
```

---

### 17.5 Kiểm tra remote

Nếu đang trong ngày remote:

* Check-out được ghi nhận là remote check-out.
* Có thể yêu cầu GPS.
* Có thể yêu cầu ghi chú.
* Có thể yêu cầu ảnh xác nhận ở phase sau.

---

## 18. Rule tính đi muộn

### 18.1 Với ca cố định

Ví dụ:

```text
Giờ bắt đầu: 08:00
Cho phép đi muộn: 5 phút
```

Rule:

```text
Nếu check_in_at <= 08:05 → Đúng giờ
Nếu check_in_at > 08:05 → Đi muộn
```

Công thức:

```text
late_minutes = check_in_at - allowed_check_in_at
```

Ví dụ:

| Check-in | Kết quả         |
| -------- | --------------- |
| 07:55    | Đúng giờ        |
| 08:03    | Đúng giờ        |
| 08:05    | Đúng giờ        |
| 08:06    | Đi muộn 1 phút  |
| 08:20    | Đi muộn 15 phút |

---

### 18.2 Với ca linh hoạt

Có 2 cách tính.

Cách 1: Theo khoảng check-in cho phép.

```text
Cho phép check-in từ 07:00 đến 10:00
Tối thiểu làm 8 giờ
```

Rule:

* Check-in trong khoảng 07:00 - 10:00: hợp lệ.
* Check-in sau 10:00: đi muộn hoặc không hợp lệ tùy cấu hình.

Cách 2: Không tính đi muộn, chỉ tính thiếu giờ.

```text
Miễn tổng thời gian làm việc >= required_worked_minutes
```

---

## 19. Rule tính về sớm

### 19.1 Với ca cố định

Ví dụ:

```text
Giờ kết thúc ca: 17:30
Cho phép về sớm: 5 phút
```

Rule:

```text
Nếu check_out_at >= 17:25 → Không tính về sớm
Nếu check_out_at < 17:25 → Về sớm
```

Công thức:

```text
early_leave_minutes = allowed_check_out_at - check_out_at
```

---

### 19.2 Với ca linh hoạt

Với ca linh hoạt, hệ thống có thể không tính về sớm theo giờ ra cố định.

Rule đề xuất:

```text
Nếu worked_minutes >= required_worked_minutes → Đủ công
Nếu worked_minutes < required_worked_minutes → Thiếu giờ
```

---

## 20. Rule tính đủ công

### 20.1 Với ca cố định

Một ngày được tính đủ công nếu:

* Có check-in hợp lệ.
* Có check-out hợp lệ.
* Không có nghỉ phép không hợp lệ.
* Không vượt quá ngưỡng đi muộn/về sớm theo rule.
* Hoặc tổng giờ làm đạt yêu cầu tối thiểu.

Rule đề xuất:

```text
Nếu worked_minutes >= required_worked_minutes
→ Đủ công
Ngược lại
→ Thiếu công
```

---

### 20.2 Với ca linh hoạt

```text
worked_minutes >= required_worked_minutes
```

Không cần đúng giờ vào/ra cố định, trừ khi rule yêu cầu.

---

### 20.3 Với nghỉ nửa ngày

Nếu nhân viên nghỉ nửa ngày được duyệt, required working minutes cần giảm tương ứng.

Ví dụ:

```text
Ca full ngày: 8 giờ
Nghỉ phép buổi sáng được duyệt
Required working time còn lại: 4 giờ
```

---

### 20.4 Với remote

Nếu remote tự check-in/check-out:

```text
Tính như ngày làm bình thường nhưng trạng thái nguồn là Remote Work.
```

Nếu remote tự động chấm công:

```text
worked_minutes = default_remote_worked_minutes
```

---

## 21. Chi tiết màn hình

### 21.1 ATT-SCREEN-001: Chấm công hôm nay

#### Mục đích

Cho phép nhân viên check-in/check-out và xem trạng thái chấm công trong ngày.

#### Thành phần giao diện

* Ngày hiện tại.
* Giờ hiện tại theo server.
* Tên nhân viên.
* Ca làm hôm nay.
* Rule áp dụng.
* Trạng thái chấm công.
* Giờ check-in.
* Giờ check-out.
* Tổng giờ làm.
* Trạng thái đi muộn/về sớm/đủ công.
* Nút Check-in.
* Nút Check-out.
* Ghi chú nếu cần.
* Cảnh báo nếu có đơn nghỉ phép/remote.
* Link xem bảng công cá nhân.
* Link gửi yêu cầu điều chỉnh công.

#### Hành động

| Hành động              | Permission                |
| ---------------------- | ------------------------- |
| Xem trạng thái         | ATT.ATTENDANCE.VIEW_OWN   |
| Check-in               | ATT.ATTENDANCE.CHECK_IN   |
| Check-out              | ATT.ATTENDANCE.CHECK_OUT  |
| Gửi yêu cầu điều chỉnh | ATT.ADJUSTMENT.CREATE_OWN |

---

### 21.2 ATT-SCREEN-002: Bảng công cá nhân

#### Mục đích

Cho phép nhân viên xem lịch sử chấm công của mình.

#### Thành phần

* Bộ lọc tháng.
* Bộ lọc khoảng ngày.
* Bộ lọc trạng thái.
* Bảng dữ liệu.
* Nút xem chi tiết.
* Nút gửi yêu cầu điều chỉnh.

---

### 21.2.1 ATT-SCREEN-003: Chi tiết ngày công

#### Mục đích

Hiển thị toàn bộ thông tin của một bản ghi chấm công và các thao tác liên quan theo quyền.

#### Thành phần

* Thông tin nhân viên.
* Ngày làm việc.
* Ca áp dụng.
* Rule áp dụng.
* Giờ check-in/check-out.
* Tổng phút làm việc và số phút yêu cầu.
* Số phút đi muộn/về sớm/thiếu.
* Trạng thái công.
* Nguồn, thiết bị, IP, GPS nếu có.
* Danh sách attendance log.
* Lịch sử điều chỉnh liên quan.
* Audit log nếu có quyền.
* Nút gửi yêu cầu điều chỉnh.
* Nút điều chỉnh trực tiếp nếu có quyền.

#### Quy tắc hiển thị

* Employee chỉ xem được bản ghi của chính mình.
* Manager/HR/Admin xem theo data scope.
* GPS là dữ liệu nhạy cảm, chỉ hiển thị cho người có quyền.

#### Hành động

| Hành động              | Permission                   |
| ---------------------- | ---------------------------- |
| Xem chi tiết           | ATT.ATTENDANCE.VIEW_DETAIL   |
| Gửi yêu cầu điều chỉnh | ATT.ADJUSTMENT.CREATE_OWN    |
| Điều chỉnh trực tiếp   | ATT.ATTENDANCE.ADJUST_DIRECT |
| Xem audit log          | ATT.AUDIT_LOG.VIEW           |

---

### 21.3 ATT-SCREEN-004: Bảng công team

#### Mục đích

Cho phép Manager xem bảng công của nhân viên thuộc phạm vi quản lý.

#### Bộ lọc

* Nhân viên.
* Phòng ban.
* Trạng thái.
* Ca làm.
* Khoảng ngày.
* Nguồn chấm công.

#### Quy tắc hiển thị

* Manager chỉ thấy nhân viên thuộc scope Team.
* Không hiển thị dữ liệu ngoài phạm vi.
* Nếu không có quyền xem chi tiết, chỉ hiển thị dữ liệu tổng quan.

---

### 21.4 ATT-SCREEN-005: Bảng công toàn công ty

#### Mục đích

Cho phép HR/Admin xem, lọc, kiểm tra và xuất bảng công toàn công ty.

#### Thành phần

* Bộ lọc phòng ban.
* Bộ lọc nhân viên.
* Bộ lọc trạng thái nhân viên.
* Bộ lọc trạng thái công.
* Bộ lọc ca làm.
* Bộ lọc nguồn chấm công.
* Bảng dữ liệu.
* Cảnh báo bất thường.
* Nút xuất file.
* Nút điều chỉnh công nếu có quyền.

---

### 21.5 ATT-SCREEN-006: Danh sách yêu cầu điều chỉnh công

#### Mục đích

Hiển thị danh sách yêu cầu điều chỉnh công theo quyền.

#### Trạng thái request

| Trạng thái | Ý nghĩa             |
| ---------- | ------------------- |
| Draft      | Bản nháp nếu hỗ trợ |
| Pending    | Đang chờ xử lý      |
| Approved   | Đã duyệt            |
| Rejected   | Đã từ chối          |
| Cancelled  | Người tạo tự hủy    |

#### Bộ lọc

* Người gửi.
* Phòng ban.
* Ngày công.
* Loại yêu cầu.
* Trạng thái.
* Người duyệt.
* Khoảng ngày gửi.

---

### 21.5.1 ATT-SCREEN-007: Tạo yêu cầu điều chỉnh công

#### Mục đích

Cho phép nhân viên gửi yêu cầu điều chỉnh công cho một bản ghi của chính mình.

#### Thành phần

* Thông tin ngày công liên quan.
* Chọn loại điều chỉnh.
* Nhập giờ check-in/check-out đề xuất nếu cần.
* Nhập trạng thái đề xuất nếu cần.
* Nhập lý do bắt buộc.
* Đính kèm file nếu có.
* Nút Gửi yêu cầu.

#### Quy tắc hiển thị

* Chỉ cho gửi yêu cầu cho bản ghi của chính mình.
* Một bản ghi chỉ có tối đa một yêu cầu Pending tại một thời điểm.
* Không cho gửi nếu kỳ công đã khóa.

#### Hành động

| Hành động   | Permission                |
| ----------- | ------------------------- |
| Gửi yêu cầu | ATT.ADJUSTMENT.CREATE_OWN |

---

### 21.5.2 ATT-SCREEN-008: Chi tiết yêu cầu điều chỉnh công

#### Mục đích

Hiển thị chi tiết một yêu cầu điều chỉnh công và cho phép thao tác theo quyền.

#### Thành phần

* Thông tin người gửi.
* Bản ghi công liên quan.
* Giá trị hiện tại.
* Giá trị đề xuất.
* Lý do và file đính kèm.
* Trạng thái yêu cầu.
* Thông tin người duyệt và thời gian xử lý.
* Lý do từ chối nếu có.
* Nút Duyệt/Từ chối nếu có quyền.
* Nút Hủy nếu là người tạo và còn Pending.

#### Quy tắc hiển thị

* Người tạo, Manager/HR/Admin xem theo data scope.
* Chỉ yêu cầu Pending mới có thao tác Duyệt/Từ chối/Hủy.

#### Hành động

| Hành động    | Permission                |
| ------------ | ------------------------- |
| Xem chi tiết | Theo quyền theo scope     |
| Duyệt        | ATT.ADJUSTMENT.APPROVE    |
| Từ chối      | ATT.ADJUSTMENT.REJECT     |
| Hủy          | ATT.ADJUSTMENT.CANCEL_OWN |

---

### 21.5.3 ATT-SCREEN-009: Duyệt/từ chối yêu cầu điều chỉnh công

#### Mục đích

Cho phép Manager/HR/Admin duyệt hoặc từ chối yêu cầu điều chỉnh công theo phạm vi quản lý.

#### Thành phần

* Danh sách yêu cầu Pending.
* So sánh giá trị hiện tại và giá trị đề xuất.
* Lý do và file đính kèm.
* Nút Duyệt.
* Nút Từ chối.
* Ô nhập lý do từ chối.

#### Quy tắc hiển thị

* Manager chỉ xử lý nhân viên thuộc scope Team.
* HR/Admin xử lý theo phạm vi công ty nếu có quyền.
* Từ chối bắt buộc nhập lý do.
* Cảnh báo nếu bản ghi đã thay đổi sau khi tạo yêu cầu.

#### Hành động

| Hành động | Permission             |
| --------- | ---------------------- |
| Duyệt     | ATT.ADJUSTMENT.APPROVE |
| Từ chối   | ATT.ADJUSTMENT.REJECT  |

---

### 21.5.4 ATT-SCREEN-010: Điều chỉnh công trực tiếp

#### Mục đích

Cho phép HR/Admin có quyền điều chỉnh trực tiếp bản ghi công trong các trường hợp đặc biệt.

#### Thành phần

* Thông tin bản ghi công hiện tại.
* Form chỉnh giờ check-in/check-out.
* Form chỉnh trạng thái và số phút.
* Ô nhập lý do điều chỉnh bắt buộc.
* Hiển thị dữ liệu trước và sau điều chỉnh.
* Nút Xác nhận.

#### Quy tắc hiển thị

* Chỉ user có quyền `ATT.ATTENDANCE.ADJUST_DIRECT` thấy thao tác này.
* Bắt buộc nhập lý do.
* Nếu kỳ công đã khóa thì cảnh báo, chỉ người có quyền đặc biệt mới điều chỉnh.

#### Hành động

| Hành động            | Permission                   |
| -------------------- | ---------------------------- |
| Điều chỉnh trực tiếp | ATT.ATTENDANCE.ADJUST_DIRECT |

---

### 21.6 ATT-SCREEN-011/012: Danh sách và tạo/chỉnh sửa ca làm

#### Mục đích

Cho phép HR/Admin quản lý ca làm.

#### Thành phần

* Danh sách ca.
* Bộ lọc trạng thái.
* Nút thêm ca.
* Form tạo/sửa ca.
* Nút vô hiệu hóa ca.
* Cảnh báo nếu ca đã được dùng.

---

### 21.6.1 ATT-SCREEN-013: Gán ca làm

#### Mục đích

Cho phép HR/Admin gán ca làm cho công ty, phòng ban hoặc từng nhân viên.

#### Thành phần

* Chọn ca làm.
* Chọn phạm vi gán: Company/Department/Employee.
* Chọn đối tượng áp dụng.
* Chọn khoảng thời gian hiệu lực.
* Đặt độ ưu tiên.
* Danh sách gán ca hiện có.
* Nút lưu gán ca.

#### Quy tắc hiển thị

* Áp dụng thứ tự ưu tiên: Employee → Department → Company → Default.
* Cảnh báo nếu khoảng hiệu lực chồng lấn.
* Chỉ user có quyền gán ca mới thao tác được.

#### Hành động

| Hành động    | Permission                  |
| ------------ | --------------------------- |
| Xem gán ca   | ATT.SHIFT_ASSIGNMENT.VIEW   |
| Gán/cập nhật | ATT.SHIFT_ASSIGNMENT.UPDATE |

---

### 21.7 ATT-SCREEN-014: Cấu hình rule chấm công

#### Mục đích

Cho phép HR/Admin cấu hình rule chấm công theo công ty, phòng ban hoặc nhân viên.

#### Thành phần

* Chọn phạm vi áp dụng.
* Chọn rule check-in/check-out.
* Chọn rule đi muộn/về sớm.
* Chọn rule remote.
* Chọn rule GPS/mobile.
* Chọn rule auto attendance.
* Nút lưu.
* Lịch sử thay đổi rule.

---

### 21.8 ATT-SCREEN-015: Remote/Công tác của tôi

#### Mục đích

Cho phép nhân viên tạo và theo dõi các yêu cầu remote/công tác của chính mình.

#### Thành phần

* Danh sách yêu cầu remote/công tác của tôi.
* Bộ lọc trạng thái và khoảng ngày.
* Nút tạo yêu cầu mới.
* Form chọn loại, ngày, lý do, địa điểm, chế độ chấm công.
* Trạng thái từng yêu cầu.
* Nút hủy nếu còn Pending.

#### Quy tắc hiển thị

* Chỉ hiển thị yêu cầu của chính nhân viên.
* Chế độ chấm công: SELF_CHECK_IN, AUTO_ATTENDANCE hoặc NO_ATTENDANCE theo rule.

#### Hành động

| Hành động   | Permission                    |
| ----------- | ----------------------------- |
| Xem yêu cầu | ATT.REMOTE_REQUEST.VIEW_OWN   |
| Tạo yêu cầu | ATT.REMOTE_REQUEST.CREATE_OWN |

---

### 21.9 ATT-SCREEN-016: Danh sách yêu cầu remote/công tác

#### Mục đích

Cho phép Manager/HR/Admin xem danh sách yêu cầu remote/công tác theo phạm vi quản lý.

#### Thành phần

* Bảng danh sách yêu cầu.
* Bộ lọc nhân viên, phòng ban, loại, trạng thái, khoảng ngày.
* Nút mở chi tiết.
* Nút Duyệt/Từ chối nhanh nếu có quyền.

#### Quy tắc hiển thị

* Manager chỉ thấy yêu cầu trong scope Team.
* HR/Admin thấy theo phạm vi công ty nếu có quyền.

#### Hành động

| Hành động     | Permission                           |
| ------------- | ------------------------------------ |
| Xem danh sách | ATT.REMOTE_REQUEST.VIEW_TEAM/COMPANY |
| Duyệt         | ATT.REMOTE_REQUEST.APPROVE           |
| Từ chối       | ATT.REMOTE_REQUEST.REJECT            |

---

### 21.10 ATT-SCREEN-017: Chi tiết yêu cầu remote/công tác

#### Mục đích

Hiển thị chi tiết một yêu cầu remote/công tác và cho phép thao tác theo quyền.

#### Thành phần

* Thông tin người gửi.
* Loại yêu cầu, khoảng thời gian, địa điểm.
* Chế độ chấm công.
* Lý do.
* Trạng thái yêu cầu.
* Thông tin người duyệt và thời gian xử lý.
* Lý do từ chối nếu có.
* Nút Duyệt/Từ chối nếu có quyền.
* Nút Hủy nếu là người tạo và còn Pending.

#### Quy tắc hiển thị

* Người tạo, Manager/HR/Admin xem theo data scope.
* Chỉ yêu cầu Pending mới có thao tác Duyệt/Từ chối.

#### Hành động

| Hành động    | Permission                 |
| ------------ | -------------------------- |
| Xem chi tiết | Theo quyền theo scope      |
| Duyệt        | ATT.REMOTE_REQUEST.APPROVE |
| Từ chối      | ATT.REMOTE_REQUEST.REJECT  |

---

### 21.11 ATT-SCREEN-018: Lịch sử thao tác chấm công

#### Mục đích

Cho phép HR/Admin có quyền xem audit log các thao tác chấm công.

#### Thành phần

* Bảng audit log.
* Bộ lọc theo nhân viên, hành động, đối tượng, khoảng ngày.
* Hiển thị actor, target, giá trị cũ/mới.
* Hiển thị IP và user agent.
* Phân trang.

#### Quy tắc hiển thị

* Chỉ user có quyền `ATT.AUDIT_LOG.VIEW` xem được.
* Dữ liệu hiển thị theo data scope.
* Log không thể chỉnh sửa từ màn hình này.

#### Hành động

| Hành động     | Permission         |
| ------------- | ------------------ |
| Xem audit log | ATT.AUDIT_LOG.VIEW |

---

### 21.12 ATT-SCREEN-019: Xuất bảng công

#### Mục đích

Cho phép HR/Admin có quyền xuất dữ liệu bảng công ra file.

#### Thành phần

* Chọn phạm vi và khoảng ngày.
* Bộ lọc phòng ban, trạng thái.
* Chọn định dạng file.
* Nút Xuất file.
* Trạng thái tiến trình xuất nếu có.

#### Quy tắc hiển thị

* Chỉ user có quyền `ATT.ATTENDANCE.EXPORT` thấy thao tác này.
* Dữ liệu xuất nằm trong data scope.
* Thao tác export được ghi audit log.

#### Hành động

| Hành động      | Permission            |
| -------------- | --------------------- |
| Xuất bảng công | ATT.ATTENDANCE.EXPORT |

---

## 22. Dữ liệu cần lưu

### 22.1 Bảng `attendance_records`

| Trường                   | Kiểu dữ liệu | Bắt buộc | Ghi chú                            |
| ------------------------ | ------------ | -------- | ---------------------------------- |
| id                       | UUID         | Có       | Khóa chính                         |
| company_id               | UUID         | Có       | Công ty                            |
| employee_id              | UUID         | Có       | Nhân viên                          |
| work_date                | Date         | Có       | Ngày công                          |
| shift_id                 | UUID         | Không    | Ca áp dụng                         |
| applied_rule_id          | UUID         | Không    | FK `attendance_rules.id`, rule đã áp dụng |
| check_in_at              | DateTime     | Không    | Giờ vào                            |
| check_out_at             | DateTime     | Không    | Giờ ra                             |
| worked_minutes           | Integer      | Không    | Tổng phút làm việc                 |
| required_worked_minutes | Integer      | Không    | Số phút yêu cầu                    |
| late_minutes             | Integer      | Không    | Số phút đi muộn                    |
| early_leave_minutes      | Integer      | Không    | Số phút về sớm                     |
| missing_minutes          | Integer      | Không    | Số phút thiếu                      |
| overtime_minutes         | Integer      | Không    | Số phút tăng ca (chuẩn bị phase sau) |
| attendance_status        | String       | Có       | Trạng thái công                    |
| attendance_source        | String       | Có       | WEB/MOBILE/MANUAL/AUTO/REMOTE/DEVICE/IMPORT/API |
| work_mode                | String       | Có       | Office/Remote/BusinessTrip/Auto/Leave |
| is_auto                  | Boolean      | Có       | Có phải tự động chấm công không    |
| is_adjusted              | Boolean      | Có       | Đã điều chỉnh chưa                 |
| has_pending_adjustment   | Boolean      | Có       | Có yêu cầu điều chỉnh đang chờ duyệt |
| note                     | Text         | Không    | Ghi chú                            |
| calculation_snapshot     | JSON         | Không    | Snapshot rule/shift/leave đã áp dụng tại thời điểm tính |
| created_at               | DateTime     | Có       | Thời gian tạo                      |
| updated_at               | DateTime     | Có       | Thời gian cập nhật                 |
| created_by               | UUID         | Không    | User tạo                           |
| updated_by               | UUID         | Không    | User cập nhật                      |
| deleted_at               | DateTime     | Không    | Xóa mềm                            |

> Đầy đủ cột (snapshot `department_id`/`position_id`, `check_in_status`/`check_out_status`, các cờ `is_late`/`is_early_leave`/`is_missing_check_in`/`is_missing_check_out`, `leave_request_id`, `remote_work_request_id`, `first_log_id`/`last_log_id`, `locked_at`/`locked_by`) theo [DB-04 §7.4](<../DB/DB-04_ATT Database Design.md>) — DB là nguồn chuẩn.

Unique đề xuất:

```text
company_id + employee_id + work_date + shift_id
```

---

### 22.2 Bảng `attendance_logs`

| Trường               | Kiểu dữ liệu | Bắt buộc | Ghi chú               |
| -------------------- | ------------ | -------- | --------------------- |
| id                   | UUID         | Có       | Khóa chính            |
| attendance_record_id | UUID         | Có       | Bản ghi công          |
| employee_id          | UUID         | Có       | Nhân viên             |
| log_type             | String       | Có       | CHECK_IN/CHECK_OUT    |
| log_time             | DateTime     | Có       | Server time           |
| source               | String       | Có       | WEB/MOBILE/DEVICE/API |
| device_id            | String       | Không    | Thiết bị              |
| device_name          | String       | Không    | Tên thiết bị          |
| platform             | String       | Không    | Browser/iOS/Android   |
| ip_address           | String       | Không    | IP                    |
| latitude             | Decimal      | Không    | GPS                   |
| longitude            | Decimal      | Không    | GPS                   |
| note                 | Text         | Không    | Ghi chú               |
| raw_payload          | JSON         | Không    | Payload gốc           |
| created_at           | DateTime     | Có       | Thời gian tạo         |

---

### 22.3 Bảng `shifts`

| Trường                    | Kiểu dữ liệu | Bắt buộc | Ghi chú            |
| ------------------------- | ------------ | -------- | ------------------ |
| id                        | UUID         | Có       | Khóa chính         |
| company_id                | UUID         | Có       | Công ty            |
| shift_code                | String       | Có       | Mã ca              |
| name                      | String       | Có       | Tên ca             |
| shift_type                | String       | Có       | Fixed/Flexible/Split/Night |
| start_time                | Time         | Không    | Giờ bắt đầu        |
| end_time                  | Time         | Không    | Giờ kết thúc       |
| break_start_time          | Time         | Không    | Bắt đầu nghỉ       |
| break_end_time            | Time         | Không    | Kết thúc nghỉ      |
| required_worked_minutes  | Integer      | Có       | Số phút yêu cầu    |
| late_grace_minutes        | Integer      | Không    | Grace đi muộn      |
| early_leave_grace_minutes | Integer      | Không    | Grace về sớm       |
| is_active                 | Boolean      | Có       | Trạng thái         |
| created_at                | DateTime     | Có       | Thời gian tạo      |
| updated_at                | DateTime     | Có       | Thời gian cập nhật |

---

### 22.4 Bảng `shift_assignments`

| Trường         | Kiểu dữ liệu | Bắt buộc | Ghi chú                     |
| -------------- | ------------ | -------- | --------------------------- |
| id             | UUID         | Có       | Khóa chính                  |
| company_id     | UUID         | Có       | Công ty                     |
| shift_id       | UUID         | Có       | Ca làm                      |
| target_type    | String       | Có       | Company/Department/Employee |
| target_id      | UUID         | Không    | ID phòng ban/nhân viên      |
| effective_from | Date         | Có       | Ngày bắt đầu                |
| effective_to   | Date         | Không    | Ngày kết thúc               |
| priority       | Integer      | Có       | Độ ưu tiên                  |
| is_active      | Boolean      | Có       | Trạng thái                  |
| created_at     | DateTime     | Có       | Thời gian tạo               |
| updated_at     | DateTime     | Có       | Thời gian cập nhật          |

---

### 22.5 Bảng `attendance_rules`

| Trường         | Kiểu dữ liệu | Bắt buộc | Ghi chú                     |
| -------------- | ------------ | -------- | --------------------------- |
| id             | UUID         | Có       | Khóa chính                  |
| company_id     | UUID         | Có       | Công ty                     |
| rule_name      | String       | Có       | Tên rule                    |
| target_type    | String       | Có       | Company/Department/Employee |
| target_id      | UUID         | Không    | ID phạm vi                  |
| config         | JSON         | Có       | Cấu hình rule               |
| priority       | Integer      | Có       | Độ ưu tiên                  |
| effective_from | Date         | Có       | Ngày hiệu lực               |
| effective_to   | Date         | Không    | Ngày hết hiệu lực           |
| is_active      | Boolean      | Có       | Trạng thái                  |
| created_at     | DateTime     | Có       | Thời gian tạo               |
| updated_at     | DateTime     | Có       | Thời gian cập nhật          |

---

### 22.6 Bảng `attendance_adjustment_requests`

| Trường               | Kiểu dữ liệu | Bắt buộc | Ghi chú                             |
| -------------------- | ------------ | -------- | ----------------------------------- |
| id                   | UUID         | Có       | Khóa chính                          |
| company_id           | UUID         | Có       | Công ty                             |
| attendance_record_id | UUID         | Có       | Bản ghi công                        |
| employee_id          | UUID         | Có       | Nhân viên gửi                       |
| request_type         | String       | Có       | Loại yêu cầu                        |
| old_values           | JSON         | Có       | Dữ liệu cũ                          |
| requested_values     | JSON         | Có       | Dữ liệu đề xuất                     |
| reason               | Text         | Có       | Lý do                               |
| attachments          | JSON         | Không    | File đính kèm                       |
| status               | String       | Có       | Pending/Approved/Rejected/Cancelled |
| approver_id          | UUID         | Không    | Người xử lý                         |
| approved_at          | DateTime     | Không    | Thời gian duyệt                     |
| rejected_at          | DateTime     | Không    | Thời gian từ chối                   |
| rejection_reason     | Text         | Không    | Lý do từ chối                       |
| created_at           | DateTime     | Có       | Thời gian tạo                       |
| updated_at           | DateTime     | Có       | Thời gian cập nhật                  |

---

### 22.7 Bảng `remote_work_requests`

| Trường           | Kiểu dữ liệu | Bắt buộc | Ghi chú                             |
| ---------------- | ------------ | -------- | ----------------------------------- |
| id               | UUID         | Có       | Khóa chính                          |
| company_id       | UUID         | Có       | Công ty                             |
| employee_id      | UUID         | Có       | Nhân viên                           |
| request_type     | String       | Có       | Remote/BusinessTrip/Offsite         |
| start_date       | Date         | Có       | Ngày bắt đầu                        |
| end_date         | Date         | Có       | Ngày kết thúc                       |
| start_time       | Time         | Không    | Nếu theo giờ                        |
| end_time         | Time         | Không    | Nếu theo giờ                        |
| reason           | Text         | Có       | Lý do                               |
| location_text    | String       | Không    | Địa điểm làm việc/công tác           |
| attendance_mode  | String       | Có       | SELF_CHECK_IN/AUTO_ATTENDANCE/NO_ATTENDANCE |
| status           | String       | Có       | Pending/Approved/Rejected/Cancelled |
| approver_id      | UUID         | Không    | Người duyệt                         |
| approved_at      | DateTime     | Không    | Thời gian duyệt                     |
| rejected_at      | DateTime     | Không    | Thời gian từ chối                   |
| rejection_reason | Text         | Không    | Lý do từ chối                       |
| created_at       | DateTime     | Có       | Thời gian tạo                       |
| updated_at       | DateTime     | Có       | Thời gian cập nhật                  |

---

### 22.8 Audit log ATT — dùng `audit_logs` chung

ATT **không có bảng audit riêng**. Mọi thao tác quan trọng (xem §25) ghi vào bảng **`audit_logs` dùng chung** của Foundation (append-only — xem [DB-08](<../DB/DB-08 Audit Files Settings Seeds Database Design.md>) và BẤT BIẾN #2). Các `object_type` của ATT (`AttendanceRecord`, `AttendanceLog`, `Shift`, `ShiftAssignment`, `AttendanceRule`, `AttendanceAdjustmentRequest`, `RemoteWorkRequest`) được bổ sung vào CHECK `object_types` của `audit_logs` (union additive, không tạo bảng mới).

---

## 23. API sơ bộ

> **Chuẩn API:** Mọi endpoint dưới đây tuân theo chuẩn response/error/pagination tại [SPEC-01](<SPEC-01 Tổng quan.md>) §19 — bao response `{success, data, message}`, lỗi `{success: false, error: {code, message}}`, phân trang `{page, limit, total, total_pages}`.

### 23.1 API check-in/check-out

| Mã API      | Method | Endpoint                  | Mục đích               | Quyền                    |
| ----------- | ------ | ------------------------- | ---------------------- | ------------------------ |
| ATT-API-001 | GET    | /api/v1/attendance/today     | Lấy trạng thái hôm nay | ATT.ATTENDANCE.VIEW_OWN  |
| ATT-API-002 | POST   | /api/v1/attendance/check-in  | Check-in               | ATT.ATTENDANCE.CHECK_IN  |
| ATT-API-003 | POST   | /api/v1/attendance/check-out | Check-out              | ATT.ATTENDANCE.CHECK_OUT |

---

### 23.2 API bảng công

| Mã API      | Method | Endpoint                       | Mục đích               | Quyền                       |
| ----------- | ------ | ------------------------------ | ---------------------- | --------------------------- |
| ATT-API-004 | GET    | /api/v1/attendance/my-records     | Bảng công cá nhân      | ATT.ATTENDANCE.VIEW_OWN     |
| ATT-API-005 | GET    | /api/v1/attendance/team-records   | Bảng công team         | ATT.ATTENDANCE.VIEW_TEAM    |
| ATT-API-006 | GET    | /api/v1/attendance/records        | Bảng công toàn công ty | ATT.ATTENDANCE.VIEW_COMPANY |
| ATT-API-007 | GET    | /api/v1/attendance/records/{id}   | Chi tiết ngày công     | ATT.ATTENDANCE.VIEW_DETAIL  |
| ATT-API-008 | GET    | /api/v1/attendance/records/export | Xuất bảng công         | ATT.ATTENDANCE.EXPORT       |

---

### 23.3 API điều chỉnh công

| Mã API      | Method | Endpoint                                         | Mục đích               | Quyền                            |
| ----------- | ------ | ------------------------------------------------ | ---------------------- | -------------------------------- |
| ATT-API-009 | POST   | /api/v1/attendance/adjustment-requests              | Tạo yêu cầu điều chỉnh | ATT.ADJUSTMENT.CREATE_OWN        |
| ATT-API-010 | GET    | /api/v1/attendance/adjustment-requests/my           | Yêu cầu của tôi        | ATT.ADJUSTMENT.VIEW_OWN          |
| ATT-API-011 | GET    | /api/v1/attendance/adjustment-requests              | Danh sách yêu cầu      | ATT.ADJUSTMENT.VIEW_TEAM/COMPANY |
| ATT-API-012 | GET    | /api/v1/attendance/adjustment-requests/{id}         | Chi tiết yêu cầu       | Theo quyền                       |
| ATT-API-013 | POST   | /api/v1/attendance/adjustment-requests/{id}/approve | Duyệt yêu cầu          | ATT.ADJUSTMENT.APPROVE           |
| ATT-API-014 | POST   | /api/v1/attendance/adjustment-requests/{id}/reject  | Từ chối yêu cầu        | ATT.ADJUSTMENT.REJECT            |
| ATT-API-015 | POST   | /api/v1/attendance/adjustment-requests/{id}/cancel  | Hủy yêu cầu của mình   | ATT.ADJUSTMENT.CANCEL_OWN        |
| ATT-API-016 | POST   | /api/v1/attendance/records/{id}/manual-adjust       | Điều chỉnh trực tiếp   | ATT.ATTENDANCE.ADJUST_DIRECT     |

---

### 23.4 API ca làm và rule

| Mã API      | Method | Endpoint                          | Mục đích         | Quyền                       |
| ----------- | ------ | --------------------------------- | ---------------- | --------------------------- |
| ATT-API-017 | GET    | /api/v1/attendance/shifts            | Danh sách ca     | ATT.SHIFT.VIEW              |
| ATT-API-018 | POST   | /api/v1/attendance/shifts            | Tạo ca           | ATT.SHIFT.CREATE            |
| ATT-API-019 | PUT    | /api/v1/attendance/shifts/{id}       | Cập nhật ca      | ATT.SHIFT.UPDATE            |
| ATT-API-020 | DELETE | /api/v1/attendance/shifts/{id}       | Vô hiệu hóa ca   | ATT.SHIFT.DELETE            |
| ATT-API-021 | GET    | /api/v1/attendance/shift-assignments | Danh sách gán ca | ATT.SHIFT_ASSIGNMENT.VIEW   |
| ATT-API-022 | POST   | /api/v1/attendance/shift-assignments | Gán ca           | ATT.SHIFT_ASSIGNMENT.UPDATE |
| ATT-API-023 | GET    | /api/v1/attendance/rules             | Xem rule         | ATT.RULE.VIEW               |
| ATT-API-024 | POST   | /api/v1/attendance/rules             | Tạo rule         | ATT.RULE.CONFIG             |
| ATT-API-025 | PUT    | /api/v1/attendance/rules/{id}        | Cập nhật rule    | ATT.RULE.CONFIG             |

---

### 23.5 API remote/công tác

| Mã API      | Method | Endpoint                                     | Mục đích                    | Quyền                                |
| ----------- | ------ | -------------------------------------------- | --------------------------- | ------------------------------------ |
| ATT-API-026 | POST   | /api/v1/attendance/remote-requests              | Tạo yêu cầu remote/công tác | ATT.REMOTE_REQUEST.CREATE_OWN        |
| ATT-API-027 | GET    | /api/v1/attendance/remote-requests/my           | Yêu cầu remote của tôi      | ATT.REMOTE_REQUEST.VIEW_OWN          |
| ATT-API-028 | GET    | /api/v1/attendance/remote-requests              | Danh sách yêu cầu remote    | ATT.REMOTE_REQUEST.VIEW_TEAM/COMPANY |
| ATT-API-029 | POST   | /api/v1/attendance/remote-requests/{id}/approve | Duyệt remote                | ATT.REMOTE_REQUEST.APPROVE           |
| ATT-API-030 | POST   | /api/v1/attendance/remote-requests/{id}/reject  | Từ chối remote              | ATT.REMOTE_REQUEST.REJECT            |

---

## 24. Event thông báo

> Dùng đúng registry NOTI chuẩn (prefix `ATT_`, `UPPER_SNAKE`). Self check-in/check-out không phát NOTI event. Manual-adjust và conflict là sự kiện nội bộ/audit, không nằm trong registry NOTI người dùng.

| Event                          | Module nguồn | Người nhận                    | Khi nào phát sinh                |
| ------------------------------ | ------------ | ----------------------------- | -------------------------------- |
| ATT_MISSING_CHECKOUT           | ATT          | Employee/Manager/HR           | Nhân viên quên check-out         |
| ATT_LATE_DETECTED              | ATT          | Employee/Manager nếu cấu hình | Nhân viên đi muộn                |
| ATT_ABSENT_DETECTED            | ATT          | Employee/Manager/HR           | Nhân viên vắng mặt               |
| ATT_ADJUSTMENT_SUBMITTED       | ATT          | Manager/HR                    | Có yêu cầu điều chỉnh công mới   |
| ATT_ADJUSTMENT_APPROVED        | ATT          | Employee                      | Yêu cầu điều chỉnh được duyệt    |
| ATT_ADJUSTMENT_REJECTED        | ATT          | Employee                      | Yêu cầu điều chỉnh bị từ chối    |
| ATT_AUTO_ATTENDANCE_CREATED    | ATT          | Employee/HR nếu cấu hình      | Hệ thống tự động chấm công       |
| ATT_REMOTE_REQUEST_SUBMITTED   | ATT          | Manager/HR                    | Có yêu cầu remote/công tác mới   |
| ATT_REMOTE_REQUEST_APPROVED    | ATT          | Employee                      | Remote/công tác được duyệt       |
| ATT_REMOTE_REQUEST_REJECTED    | ATT          | Employee                      | Remote/công tác bị từ chối       |
| ATT_REMOTE_REQUEST_CANCELLED   | ATT          | Manager/HR                    | Remote/công tác bị hủy           |

---

## 25. Audit log

### 25.1 Hành động cần ghi log

* Check-in.
* Check-out.
* Check-in thất bại do rule quan trọng.
* Check-out thất bại do rule quan trọng.
* Tạo/cập nhật/vô hiệu hóa ca làm.
* Gán ca làm.
* Cập nhật rule chấm công.
* Tạo yêu cầu điều chỉnh công.
* Hủy yêu cầu điều chỉnh công.
* Duyệt yêu cầu điều chỉnh công.
* Từ chối yêu cầu điều chỉnh công.
* Điều chỉnh công trực tiếp.
* Tạo/duyệt/từ chối remote request.
* Tự động chấm công.
* Xuất bảng công.
* Xem dữ liệu nhạy cảm nếu cấu hình yêu cầu.

### 25.2 Dữ liệu log cần lưu

| Trường      | Mô tả                              |
| ----------- | ---------------------------------- |
| actor_id    | User thực hiện                     |
| employee_id | Nhân viên liên quan                |
| action      | Hành động                          |
| module_code | ATT                                |
| target_type | AttendanceRecord/AttendanceLog/... |
| target_id   | ID bản ghi                         |
| old_value   | Dữ liệu trước                      |
| new_value   | Dữ liệu sau                        |
| ip_address  | IP                                 |
| user_agent  | Thiết bị/trình duyệt               |
| created_at  | Thời gian                          |

---

## 26. Quy tắc bảo mật

1. Backend phải kiểm tra quyền cho mọi API.
2. Không tin tưởng thời gian từ client.
3. Check-in/check-out luôn dùng server time.
4. Không cho client tự gửi `check_in_at` hoặc `check_out_at` trong MVP.
5. Client chỉ gửi metadata như source, platform, device, GPS, note.
6. Nếu dùng GPS, backend phải validate vị trí theo rule.
7. Employee không được sửa trực tiếp bản ghi chấm công.
8. Mọi điều chỉnh phải thông qua yêu cầu điều chỉnh hoặc HR/Admin có quyền.
9. Check-in/check-out thất bại liên quan bảo mật nên được ghi log.
10. API phải chống gọi lặp nhiều lần gây trùng bản ghi.
11. Cần xử lý concurrency khi người dùng bấm nhiều lần hoặc mở nhiều tab.
12. Không cho user xem bảng công ngoài data scope.
13. Không export dữ liệu nếu không có quyền.
14. Dữ liệu vị trí GPS được xem là dữ liệu nhạy cảm, chỉ người có quyền mới được xem.
15. Khi mở notification target, module gốc vẫn phải kiểm tra quyền lại.

---

## 27. Quy tắc xử lý trùng và concurrency

### 27.1 Bấm check-in nhiều lần

Nếu user bấm check-in liên tục:

* Request đầu tiên thành công.
* Request sau trả lỗi `ATT-ERR-009`.
* Không tạo nhiều bản ghi check-in.

### 27.2 Bấm check-out nhiều lần

Nếu user bấm check-out liên tục:

* Request đầu tiên thành công.
* Request sau trả lỗi `ATT-ERR-014`.
* Không cập nhật check-out nhiều lần.

### 27.3 Cơ chế đề xuất

* Dùng unique constraint theo `company_id + employee_id + work_date + shift_id`.
* Dùng transaction khi tạo/cập nhật attendance record.
* Có thể dùng lock ngắn khi xử lý check-in/check-out.
* Frontend disable nút sau khi bấm.
* Backend vẫn là nơi đảm bảo chống trùng.

---

## 28. Trường hợp đặc biệt

### 28.1 Quên check-out

Nếu đến cuối ngày nhân viên chưa check-out:

* Trạng thái là `Missing Check-out`.
* Employee có thể gửi yêu cầu điều chỉnh công.
* HR/Manager có thể xử lý.
* Nếu cấu hình auto check-out, hệ thống tự tạo check-out tại giờ kết thúc ca.

---

### 28.2 Quên check-in

Nếu nhân viên không check-in nhưng có check-out hoặc có bằng chứng đi làm:

* Trạng thái có thể là `Missing Check-in`.
* Employee gửi yêu cầu điều chỉnh.
* Manager/HR duyệt thì hệ thống cập nhật giờ check-in hợp lệ.

---

### 28.3 Check-in muộn nhưng có lý do

Nếu đi muộn có lý do:

* Employee vẫn check-in bình thường.
* Hệ thống đánh dấu Late.
* Employee có thể gửi yêu cầu giải trình/điều chỉnh.
* HR/Manager duyệt thì trạng thái có thể được điều chỉnh.

---

### 28.4 Check-out sớm do nghỉ phép nửa ngày

Nếu có đơn nghỉ buổi chiều được duyệt:

* Check-out buổi trưa không bị tính về sớm.
* Bản ghi công ghi nhận phần làm việc thực tế.
* Phần còn lại ghi nhận Leave.

---

### 28.5 Có đơn remote nhưng vẫn check-in ở văn phòng

Tùy cấu hình:

| Cấu hình       | Xử lý                                             |
| -------------- | ------------------------------------------------- |
| Cho phép       | Ghi nhận là check-in thường hoặc remote tùy nguồn |
| Không cho phép | Cảnh báo đang có đơn remote                       |
| Ưu tiên remote | Ghi nhận trạng thái Remote Work                   |

---

### 28.6 Nhân viên nghỉ việc nhưng user vẫn active

Nếu employee status là Resigned/Terminated:

* Chặn check-in/check-out.
* Có thể gửi cảnh báo cho HR nếu user vẫn active.

---

### 28.7 Không có ca làm

Tùy cấu hình:

| Cấu hình                       | Xử lý                                      |
| ------------------------------ | ------------------------------------------ |
| Bắt buộc có ca                 | Chặn check-in                              |
| Cho phép ca linh hoạt mặc định | Cho check-in, dùng required hours mặc định |
| Cho HR bổ sung sau             | Ghi nhận tạm, trạng thái cần kiểm tra      |

---

### 28.8 Mất mạng khi check-in mobile

MVP đề xuất:

* Không hỗ trợ offline check-in để tránh gian lận thời gian.
* Mobile cần có mạng để gửi request lên server.
* Phase sau có thể hỗ trợ offline log nhưng cần cơ chế chống gian lận.

---

## 29. Error code

| Mã lỗi      | Trường hợp                       | Thông báo                                                |
| ----------- | -------------------------------- | -------------------------------------------------------- |
| ATT-ERR-001 | Chưa đăng nhập                   | Bạn cần đăng nhập để chấm công                           |
| ATT-ERR-002 | Không có quyền check-in          | Bạn không có quyền check-in                              |
| ATT-ERR-003 | User chưa liên kết employee      | Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên |
| ATT-ERR-004 | Nhân viên không còn làm việc     | Tài khoản nhân viên không còn ở trạng thái làm việc      |
| ATT-ERR-005 | Không phải ngày làm việc         | Hôm nay không phải ngày làm việc theo lịch của bạn       |
| ATT-ERR-006 | Có đơn nghỉ Approved             | Bạn đã có đơn nghỉ phép được duyệt trong thời gian này   |
| ATT-ERR-007 | Remote tự động                   | Hôm nay bạn đã được ghi nhận công remote tự động         |
| ATT-ERR-008 | Tự động chấm công                | Bạn thuộc nhóm được tự động chấm công                    |
| ATT-ERR-009 | Đã check-in                      | Bạn đã check-in hôm nay                                  |
| ATT-ERR-010 | Thiếu GPS                        | Vui lòng bật định vị để chấm công                        |
| ATT-ERR-011 | Vị trí không hợp lệ              | Vị trí chấm công không hợp lệ                            |
| ATT-ERR-012 | Không có quyền check-out         | Bạn không có quyền check-out                             |
| ATT-ERR-013 | Chưa check-in                    | Bạn chưa check-in nên không thể check-out                |
| ATT-ERR-014 | Đã check-out                     | Bạn đã check-out hôm nay                                 |
| ATT-ERR-015 | Thời gian check-out không hợp lệ | Thời gian check-out không hợp lệ                         |
| ATT-ERR-016 | Không tìm thấy bản ghi công      | Không tìm thấy bản ghi chấm công                         |
| ATT-ERR-017 | Thiếu ghi chú                    | Vui lòng nhập ghi chú                                    |
| ATT-ERR-018 | Không có quyền xem bảng công     | Bạn không có quyền xem dữ liệu này                       |
| ATT-ERR-019 | Không có quyền điều chỉnh công   | Bạn không có quyền điều chỉnh công                       |
| ATT-ERR-020 | Yêu cầu điều chỉnh không tồn tại | Không tìm thấy yêu cầu điều chỉnh công                   |
| ATT-ERR-021 | Yêu cầu không còn Pending        | Yêu cầu này đã được xử lý                                |
| ATT-ERR-022 | Thiếu lý do từ chối              | Vui lòng nhập lý do từ chối                              |
| ATT-ERR-023 | Đang có yêu cầu Pending          | Ngày công này đang có yêu cầu điều chỉnh chờ xử lý       |
| ATT-ERR-024 | Kỳ công đã khóa                  | Kỳ công đã khóa, không thể điều chỉnh                    |
| ATT-ERR-025 | Ca làm không tồn tại             | Không tìm thấy ca làm                                    |
| ATT-ERR-026 | Rule không hợp lệ                | Cấu hình rule chấm công không hợp lệ                     |
| ATT-ERR-027 | Không có quyền export            | Bạn không có quyền xuất bảng công                        |
| ATT-ERR-028 | Remote request không tồn tại     | Không tìm thấy yêu cầu remote/công tác                   |
| ATT-ERR-029 | Không có quyền duyệt remote      | Bạn không có quyền duyệt yêu cầu remote/công tác         |
| ATT-ERR-030 | Xung đột dữ liệu                 | Dữ liệu chấm công đã thay đổi, vui lòng tải lại          |
| ATT-ERR-SELF-APPROVAL | Tự duyệt request của chính mình | Bạn không thể tự duyệt/từ chối yêu cầu do chính mình tạo |

---

## 30. Tiêu chí nghiệm thu

### 30.1 Check-in

Chức năng check-in hoàn thành khi:

1. Employee đăng nhập có thể check-in.
2. User chưa liên kết employee bị chặn.
3. Nhân viên đã nghỉ việc bị chặn.
4. Nhân viên có đơn nghỉ cả ngày Approved bị chặn.
5. Nhân viên có đơn remote Approved được xử lý theo rule remote.
6. Nhân viên thuộc nhóm tự động chấm công không cần check-in thủ công.
7. Hệ thống dùng server time để ghi nhận giờ.
8. Hệ thống không cho check-in trùng trong cùng ngày/ca.
9. Hệ thống tính được trạng thái đúng giờ/đi muộn.
10. Attendance record và attendance log được tạo đúng.
11. Audit log được ghi.

---

### 30.2 Check-out

Chức năng check-out hoàn thành khi:

1. Employee đã check-in có thể check-out.
2. Employee chưa check-in không thể check-out.
3. Employee đã check-out không thể check-out lần nữa.
4. Check-out time luôn lớn hơn check-in time.
5. Hệ thống tính được tổng giờ làm.
6. Hệ thống tính được về sớm nếu có.
7. Hệ thống tính được thiếu giờ nếu có.
8. Hệ thống xử lý đúng ca cố định.
9. Hệ thống xử lý đúng ca linh hoạt.
10. Attendance record được cập nhật đúng.
11. Attendance log được tạo đúng.
12. Audit log được ghi.

---

### 30.3 Bảng công

Bảng công hoàn thành khi:

1. Employee chỉ xem được bảng công cá nhân.
2. Manager chỉ xem được bảng công team.
3. HR xem được bảng công toàn công ty nếu có quyền.
4. Bộ lọc hoạt động đúng.
5. Dữ liệu trạng thái hiển thị đúng.
6. Không trả dữ liệu ngoài data scope.
7. Có phân trang.
8. Có xem chi tiết ngày công.
9. Có thể export nếu có quyền.

---

### 30.4 Điều chỉnh công

Chức năng điều chỉnh công hoàn thành khi:

1. Employee gửi được yêu cầu điều chỉnh công.
2. Không gửi được nếu không nhập lý do bắt buộc.
3. Không gửi được yêu cầu trùng Pending cho cùng ngày công.
4. Manager duyệt được yêu cầu của nhân viên thuộc team.
5. Manager không duyệt được yêu cầu ngoài team.
6. HR duyệt được yêu cầu toàn công ty nếu có quyền.
7. Khi duyệt, attendance record được cập nhật.
8. Khi từ chối, attendance record giữ nguyên.
9. Employee nhận thông báo kết quả.
10. Audit log được ghi đầy đủ.

---

### 30.5 Ca làm và rule

Chức năng ca làm/rule hoàn thành khi:

1. HR/Admin tạo được ca cố định.
2. HR/Admin tạo được ca linh hoạt.
3. HR/Admin gán được ca cho công ty.
4. HR/Admin gán được ca cho phòng ban.
5. HR/Admin gán được ca cho nhân viên.
6. Hệ thống áp dụng đúng thứ tự ưu tiên ca.
7. HR/Admin cấu hình được rule chấm công.
8. Rule nhân viên ưu tiên hơn rule phòng ban.
9. Rule phòng ban ưu tiên hơn rule công ty.
10. Thay đổi rule được ghi audit log.

---

### 30.6 Remote và tự động chấm công

Chức năng remote/auto hoàn thành khi:

1. Employee gửi được yêu cầu remote/công tác.
2. Manager/HR duyệt/từ chối được theo quyền.
3. Remote Approved áp dụng đúng rule.
4. Remote tự check-in/check-out ghi trạng thái Remote Work.
5. Remote auto tạo attendance record tự động.
6. Nhân viên thuộc nhóm auto attendance được ghi công tự động.
7. Nghỉ phép Approved vẫn ưu tiên cao hơn auto attendance.
8. Audit log được ghi.

---

## 31. Test case chính

| Mã test case | Tên test case                                   | Kết quả mong muốn                   |
| ------------ | ----------------------------------------------- | ----------------------------------- |
| ATT-TC-001   | Employee check-in thành công trên web           | Tạo attendance record và log        |
| ATT-TC-002   | Employee check-out thành công trên web          | Cập nhật check-out và tổng giờ      |
| ATT-TC-003   | Employee check-in thành công trên mobile        | Ghi source MOBILE                   |
| ATT-TC-004   | User chưa liên kết employee check-in            | Bị chặn                             |
| ATT-TC-005   | Nhân viên Resigned check-in                     | Bị chặn                             |
| ATT-TC-006   | Employee có nghỉ phép cả ngày Approved check-in | Bị chặn                             |
| ATT-TC-007   | Employee có nghỉ buổi chiều check-out buổi trưa | Không tính về sớm                   |
| ATT-TC-008   | Employee check-in trùng                         | Không tạo bản ghi trùng             |
| ATT-TC-009   | Employee check-out khi chưa check-in            | Bị chặn                             |
| ATT-TC-010   | Employee check-out trùng                        | Bị chặn                             |
| ATT-TC-011   | Check-in sau grace time                         | Ghi Late                            |
| ATT-TC-012   | Check-out trước giờ cho phép                    | Ghi Early Leave                     |
| ATT-TC-013   | Tổng giờ làm thiếu                              | Ghi Missing Hours                   |
| ATT-TC-014   | Ca linh hoạt đủ giờ                             | Ghi đủ công                         |
| ATT-TC-015   | Ca linh hoạt thiếu giờ                          | Ghi thiếu giờ                       |
| ATT-TC-016   | Employee gửi yêu cầu điều chỉnh công            | Request Pending được tạo            |
| ATT-TC-017   | Manager duyệt yêu cầu team                      | Attendance record cập nhật          |
| ATT-TC-018   | Manager duyệt yêu cầu ngoài team                | Bị chặn                             |
| ATT-TC-019   | HR từ chối yêu cầu điều chỉnh                   | Request Rejected, record giữ nguyên |
| ATT-TC-020   | HR điều chỉnh công trực tiếp                    | Record cập nhật, audit log ghi      |
| ATT-TC-021   | Remote tự check-in/check-out                    | Ghi Remote Work                     |
| ATT-TC-022   | Remote auto attendance                          | Tạo công tự động                    |
| ATT-TC-023   | Auto attendance nhân viên đặc thù               | Tạo record AUTO                     |
| ATT-TC-024   | GPS bắt buộc nhưng không gửi                    | Bị chặn                             |
| ATT-TC-025   | Export bảng công không có quyền                 | Bị chặn                             |
| ATT-TC-026   | HR export bảng công có quyền                    | File được tạo                       |
| ATT-TC-027   | Thay đổi rule chấm công                         | Audit log được ghi                  |
| ATT-TC-028   | Dữ liệu ngoài scope                             | Không được trả về                   |
| ATT-TC-029   | Bấm check-in nhiều lần liên tục                 | Chỉ request đầu thành công          |
| ATT-TC-030   | Đơn nghỉ bị hủy sau Approved                    | ATT tính lại bản ghi công           |

---

## 32. Gợi ý triển khai MVP

### 32.1 Ưu tiên triển khai trước

1. Check-in/check-out.
2. Trạng thái chấm công hôm nay.
3. Bảng công cá nhân.
4. Bảng công team/toàn công ty.
5. Ca làm cố định.
6. Ca linh hoạt cơ bản.
7. Rule đi muộn/về sớm/thiếu giờ.
8. Chặn nghỉ phép Approved.
9. Yêu cầu điều chỉnh công.
10. Duyệt/từ chối điều chỉnh công.
11. Audit log.
12. Notification cơ bản.

### 32.2 Có thể làm ngay sau MVP lõi

1. Remote/công tác request.
2. Tự động chấm công.
3. Export bảng công.
4. Rule GPS mobile.
5. Dashboard bất thường chấm công.
6. Auto reminder quên check-out.

### 32.3 Để phase sau

1. Thiết bị chấm công vật lý.
2. QR code nâng cao.
3. Nhận diện khuôn mặt.
4. Chống giả lập GPS nâng cao.
5. Import log thiết bị.
6. Khóa kỳ công.
7. Tính tăng ca nâng cao.
8. Payroll integration.

---

## 33. Ghi chú quyết định nghiệp vụ

1. MVP chỉ hỗ trợ một check-in chính và một check-out chính cho mỗi ngày/ca.
2. Web và mobile đều được hỗ trợ trong MVP.
3. Tích hợp thiết bị chấm công vật lý để phase sau nhưng data model phải mở sẵn `source = DEVICE`.
4. Rule có thể cấu hình theo công ty, phòng ban hoặc nhân viên.
5. Nhân viên có đơn nghỉ phép Approved cả ngày bị chặn chấm công.
6. Remote/công tác được quản lý trong module ATT ở MVP.
7. Remote có thể tự chấm công hoặc tự động chấm công theo rule.
8. HR và vai trò cao hơn có quyền điều chỉnh công nếu được cấp quyền.
9. Manager có quyền duyệt điều chỉnh công trong phạm vi team.
10. Employee không được sửa trực tiếp bảng công, chỉ được gửi yêu cầu điều chỉnh.
11. Backend luôn dùng server time, không dùng giờ client gửi lên.
12. Mọi điều chỉnh quan trọng phải có audit log.
