# PRD-00: PRODUCT REQUIREMENTS DOCUMENT

> **📚 Bộ tài liệu — Hệ thống Quản lý Doanh nghiệp (Enterprise Management System)**
> **PRD-00 (Tài liệu này)** · [Bộ SPEC →](<../SPEC/SPEC-01 Tổng quan.md>) · [Bộ DB →](<../DB/DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [Chỉ mục tài liệu](<../README.md>)
>
> Danh sách link đầy đủ tới SPEC & DB ở mục [19. Tài liệu liên quan](#19-tài-liệu-liên-quan).

---

## 1. Thông tin tài liệu

| Trường        | Nội dung                                                             |
| ------------- | -------------------------------------------------------------------- |
| Mã tài liệu   | PRD-00                                                               |
| Tên tài liệu  | Product Requirements Document - Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm  | Enterprise Management System                                         |
| Phiên bản     | v1.0                                                                 |
| Trạng thái    | Draft                                                                |
| Giai đoạn     | MVP Version 1.0                                                      |
| Người viết    |                                                                      |
| Người duyệt   |                                                                      |
| Ngày tạo      | 20/06/2026                                                           |
| Ngày cập nhật | 20/06/2026                                                           |

---

## 2. Mục đích tài liệu

Tài liệu PRD này mô tả yêu cầu sản phẩm cấp cao cho hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chốt mục tiêu sản phẩm.
2. Chốt phạm vi MVP Version 1.0.
3. Xác định nhóm người dùng chính.
4. Xác định các module thuộc MVP.
5. Mô tả các nghiệp vụ chính ở cấp sản phẩm.
6. Làm cơ sở cho Database Design, API Design, UI/UX Design và kế hoạch triển khai.
7. Giúp Product, Business, UI/UX, Backend, Frontend và QA hiểu thống nhất sản phẩm cần xây dựng.

PRD không thay thế các tài liệu SPEC chi tiết. PRD đóng vai trò tài liệu định hướng sản phẩm tổng thể, còn các SPEC module mô tả chi tiết nghiệp vụ, màn hình, quyền, API, rule, lỗi và test case.

---

## 3. Bối cảnh và vấn đề cần giải quyết

Hiện tại, nhiều doanh nghiệp đang quản lý hoạt động nội bộ bằng nhiều công cụ rời rạc như Excel, Google Sheet, email, tin nhắn, phần mềm chấm công riêng, phần mềm quản lý task riêng và file giấy.

Cách vận hành này tạo ra nhiều vấn đề:

1. Dữ liệu nhân sự bị phân tán.
2. HR mất nhiều thời gian tổng hợp hồ sơ, bảng công, đơn nghỉ.
3. Nhân viên phải thao tác qua nhiều kênh khác nhau để chấm công, xin nghỉ, nhận việc.
4. Manager khó theo dõi nhân sự, bảng công, đơn nghỉ và tiến độ công việc của team.
5. Dữ liệu chấm công, nghỉ phép và công việc không liên kết chặt chẽ.
6. Ban lãnh đạo thiếu dashboard tổng quan theo thời gian gần thực tế.
7. Thông báo nghiệp vụ dễ bị bỏ sót khi phụ thuộc vào chat/email bên ngoài.
8. Khó kiểm soát quyền truy cập dữ liệu nhạy cảm như hồ sơ nhân sự, hợp đồng, bảng công, dữ liệu lương.
9. Khó mở rộng hệ thống sang các nghiệp vụ nâng cao như payroll, tuyển dụng, tài sản, phòng họp, chat nội bộ và AI.

Vì vậy, cần xây dựng một nền tảng quản lý doanh nghiệp nội bộ tập trung, có khả năng gom các nghiệp vụ quan trọng vào một hệ thống thống nhất.

---

## 4. Tầm nhìn sản phẩm

Xây dựng một hệ thống quản lý doanh nghiệp nội bộ all-in-one, giúp doanh nghiệp số hóa và quản lý tập trung các nghiệp vụ cốt lõi như tài khoản, phân quyền, nhân sự, chấm công, nghỉ phép, công việc, dashboard và thông báo.

Sản phẩm cần hướng tới ba giá trị chính:

1. **Tập trung dữ liệu**
   Toàn bộ dữ liệu nhân sự, chấm công, nghỉ phép, task và thông báo được quản lý trên một nền tảng thống nhất.

2. **Chuẩn hóa quy trình**
   Các quy trình nội bộ như tạo nhân viên, chấm công, xin nghỉ, duyệt đơn, giao việc, nhận thông báo được chuẩn hóa và có thể truy vết.

3. **Mở rộng lâu dài**
   Hệ thống được thiết kế đủ mở để sau MVP có thể phát triển thêm payroll, tuyển dụng, tài sản, phòng họp, chat nội bộ, mobile app, AI và mô hình SaaS.

---

## 5. Mục tiêu sản phẩm

### 5.1 Mục tiêu nghiệp vụ

Hệ thống cần đạt các mục tiêu nghiệp vụ sau:

1. Cho phép doanh nghiệp quản lý dữ liệu nhân sự tập trung.
2. Cho phép nhân viên đăng nhập, xem hồ sơ cá nhân, chấm công, xin nghỉ, xem task và nhận thông báo.
3. Cho phép HR quản lý hồ sơ nhân viên, hợp đồng, phòng ban, chức vụ, bảng công và đơn nghỉ.
4. Cho phép Manager theo dõi nhân viên trong phạm vi quản lý, duyệt đơn nghỉ, duyệt điều chỉnh công và kiểm soát tiến độ task.
5. Cho phép Admin quản lý tài khoản, vai trò, quyền truy cập và cấu hình hệ thống.
6. Tự động liên kết dữ liệu giữa nghỉ phép và chấm công.
7. Cung cấp dashboard theo vai trò để người dùng nắm nhanh thông tin quan trọng.
8. Tự động tạo thông báo khi có sự kiện quan trọng.
9. Giảm thao tác thủ công qua Excel, Google Sheet, email và tin nhắn.
10. Tạo nền tảng dữ liệu để triển khai payroll, tuyển dụng, tài sản, phòng họp và AI ở các phase sau.

### 5.2 Mục tiêu kỹ thuật

Hệ thống cần đảm bảo:

1. Có kiến trúc module rõ ràng.
2. Có phân quyền theo vai trò và phạm vi dữ liệu.
3. Có audit log cho thao tác quan trọng.
4. Có khả năng mở rộng module mới.
5. Có thể phát triển web app trước, mobile app sau.
6. Có thể tích hợp với thiết bị chấm công, email, lịch, file storage, kế toán và các hệ thống ngoài ở giai đoạn sau.
7. Có thể mở rộng sang mô hình SaaS trong tương lai.
8. Bảo mật dữ liệu nhạy cảm.
9. Backend luôn kiểm tra quyền, không chỉ phụ thuộc vào frontend.
10. Các nghiệp vụ quan trọng có trạng thái, lịch sử và khả năng truy vết.

---

## 6. Định vị sản phẩm

Sản phẩm được định vị là:

> Nền tảng quản lý doanh nghiệp nội bộ giúp số hóa toàn bộ hoạt động nhân sự, chấm công, nghỉ phép, công việc, dashboard và thông báo trên một hệ thống duy nhất.

Tên gọi nội bộ:

```text
Enterprise Management System
```

Tên thương mại có thể được thay đổi ở giai đoạn branding.

---

## 7. Nhóm người dùng mục tiêu

### 7.1 Super Admin

Super Admin là vai trò cao nhất trong hệ thống.

Nhu cầu chính:

1. Quản lý toàn bộ hệ thống.
2. Quản lý tenant nếu sau này triển khai SaaS.
3. Quản lý cấu hình hệ thống.
4. Xem toàn bộ dữ liệu và log.
5. Can thiệp khi có sự cố hoặc lỗi cấu hình.

### 7.2 Admin công ty

Admin công ty là người quản trị hệ thống ở cấp doanh nghiệp.

Nhu cầu chính:

1. Quản lý tài khoản người dùng trong công ty.
2. Gán vai trò cho user.
3. Cấu hình thông tin công ty.
4. Xem dashboard quản trị.
5. Quản lý module được bật/tắt nếu hệ thống hỗ trợ.

### 7.3 HR

HR là người phụ trách nghiệp vụ nhân sự.

Nhu cầu chính:

1. Quản lý hồ sơ nhân viên.
2. Quản lý phòng ban, chức vụ, cấp bậc.
3. Quản lý hợp đồng lao động.
4. Theo dõi bảng công.
5. Quản lý nghỉ phép.
6. Xử lý yêu cầu cập nhật hồ sơ cá nhân.
7. Điều chỉnh dữ liệu nhân sự, chấm công, nghỉ phép theo quyền.
8. Xem dashboard nhân sự và các cảnh báo liên quan.

### 7.4 Manager

Manager là người quản lý phòng ban, team hoặc dự án.

Nhu cầu chính:

1. Xem nhân viên thuộc phạm vi quản lý.
2. Xem bảng công team.
3. Duyệt hoặc từ chối đơn nghỉ phép.
4. Duyệt hoặc từ chối yêu cầu điều chỉnh công.
5. Tạo dự án, giao task, theo dõi task nếu được cấp quyền.
6. Xem dashboard team.
7. Nhận thông báo về các việc cần xử lý.

### 7.5 Employee

Employee là nhân viên sử dụng hệ thống hằng ngày.

Nhu cầu chính:

1. Đăng nhập hệ thống.
2. Xem hồ sơ cá nhân.
3. Gửi yêu cầu cập nhật hồ sơ cá nhân nếu được phép.
4. Check-in/check-out.
5. Xem bảng công cá nhân.
6. Gửi yêu cầu điều chỉnh công.
7. Gửi đơn nghỉ phép.
8. Xem số ngày phép còn lại.
9. Xem task được giao.
10. Cập nhật trạng thái task.
11. Nhận thông báo hệ thống.

### 7.6 Project Manager

Project Manager là vai trò nghiệp vụ trong từng dự án.

Nhu cầu chính:

1. Quản lý dự án được phân công.
2. Thêm/xóa thành viên dự án.
3. Tạo và giao task.
4. Theo dõi tiến độ dự án.
5. Nhận thông báo về task, deadline và cập nhật dự án.

### 7.7 Vai trò sau MVP

Các vai trò sau chưa thuộc trọng tâm MVP nhưng cần thiết kế mở rộng:

1. Payroll Officer.
2. Recruiter.
3. Asset Manager.
4. Office Admin.
5. Executive/Leadership.
6. Auditor.

---

## 8. Phạm vi sản phẩm MVP Version 1.0

### 8.1 Module thuộc MVP

MVP Version 1.0 bao gồm các module sau:

| Mã module | Tên module                        | Vai trò trong MVP                                       |
| --------- | --------------------------------- | ------------------------------------------------------- |
| AUTH      | Tài khoản, đăng nhập & phân quyền | Nền tảng xác thực, tài khoản, vai trò, quyền            |
| HR        | Quản lý nhân sự                   | Quản lý dữ liệu nhân viên, phòng ban, chức vụ, hợp đồng |
| ATT       | Chấm công                         | Check-in/check-out, bảng công, ca làm, rule chấm công   |
| LEAVE     | Nghỉ phép                         | Tạo đơn nghỉ, duyệt nghỉ, số dư phép, lịch nghỉ         |
| TASK      | Công việc & dự án                 | Quản lý dự án, task, giao việc, kanban, comment, file   |
| DASH      | Dashboard                         | Tổng hợp dữ liệu theo vai trò                           |
| NOTI      | Thông báo hệ thống                | Tạo và hiển thị thông báo in-app                        |

#### MVP bổ sung

Bổ sung sau khi chốt 7 module lõi, cùng giai đoạn MVP Version 1.0:

| Mã module | Tên module                            | Vai trò trong MVP                                      |
| --------- | ------------------------------------- | ----------------------------------------------------- |
| ME        | Trung tâm cá nhân & Cài đặt tài khoản | Personal Hub / Employee Self-service: tổng hợp dữ liệu Own của user hiện tại (AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH), self-service hồ sơ, tài khoản, bảo mật và cài đặt cá nhân |

ME là lớp trải nghiệm tổng hợp, **không sở hữu dữ liệu nghiệp vụ gốc** — mọi thao tác thay đổi vẫn gọi module sở hữu và tuân thủ quy trình phê duyệt. Chi tiết tại SPEC-09.

### 8.2 Module chưa thuộc MVP

Các module sau chưa triển khai trong MVP nhưng cần thiết kế để mở rộng:

| Mã module | Tên module             | Giai đoạn |
| --------- | ---------------------- | --------- |
| PAYROLL   | Tiền lương             | Phase 2   |
| RECRUIT   | Tuyển dụng             | Phase 2   |
| ASSET     | Quản lý tài sản        | Phase 3   |
| ROOM      | Quản lý phòng họp      | Phase 3   |
| CHAT      | Chat nội bộ            | Phase 4   |
| SOCIAL    | Mạng xã hội nội bộ     | Phase 4   |
| MOBILE    | Mobile app             | Phase 5   |
| AI        | AI & tích hợp nâng cao | Phase 5   |

---

## 9. Yêu cầu sản phẩm cấp cao theo module

## 9.1 AUTH - Tài khoản, đăng nhập & phân quyền

### Mục tiêu

Cung cấp nền tảng xác thực, quản lý tài khoản, vai trò, quyền và phạm vi dữ liệu cho toàn bộ hệ thống.

### Chức năng chính

1. Đăng nhập.
2. Đăng xuất.
3. Quên mật khẩu.
4. Đặt lại mật khẩu.
5. Đổi mật khẩu.
6. Quản lý tài khoản người dùng.
7. Khóa/mở tài khoản.
8. Quản lý vai trò.
9. Quản lý quyền.
10. Gán vai trò cho người dùng.
11. Kiểm tra quyền truy cập menu, màn hình, chức năng, API.
12. Kiểm tra data scope.
13. Liên kết tài khoản với hồ sơ nhân viên.
14. Ghi log đăng nhập và thao tác quan trọng.

### Kết quả mong muốn

1. Người dùng đăng nhập được bằng tài khoản hợp lệ.
2. Người dùng chỉ thấy chức năng được cấp quyền.
3. API backend luôn kiểm tra quyền.
4. Employee, Manager, HR, Admin có phạm vi dữ liệu khác nhau.
5. Dữ liệu nhạy cảm không bị lộ cho người không có quyền.

---

## 9.2 HR - Quản lý nhân sự

### Mục tiêu

Quản lý tập trung toàn bộ dữ liệu nhân sự cốt lõi của doanh nghiệp.

### Chức năng chính

1. Xem danh sách nhân viên.
2. Tìm kiếm và lọc nhân viên.
3. Xem chi tiết hồ sơ nhân viên.
4. Thêm nhân viên mới.
5. Cập nhật hồ sơ nhân viên.
6. Đổi trạng thái nhân viên.
7. Quản lý phòng ban.
8. Quản lý chức vụ.
9. Quản lý cấp bậc.
10. Quản lý hợp đồng lao động.
11. Upload và quản lý file hồ sơ.
12. Liên kết nhân viên với tài khoản đăng nhập.
13. Xem lịch sử thay đổi hồ sơ.
14. Employee xem hồ sơ cá nhân.
15. Employee gửi yêu cầu cập nhật hồ sơ cá nhân.
16. HR/Admin duyệt hoặc từ chối yêu cầu cập nhật hồ sơ cá nhân.
17. Cấu hình quy tắc sinh mã nhân viên.
18. Xem trước mã nhân viên tiếp theo.
19. Khóa/mở quyền sửa mã nhân viên thủ công.

### Quyết định nghiệp vụ quan trọng

1. Employee được phép đề xuất chỉnh sửa một số thông tin cá nhân.
2. Thay đổi hồ sơ cá nhân của Employee không có hiệu lực ngay.
3. Thay đổi chỉ được áp dụng sau khi HR/Admin/Super Admin duyệt.
4. Mã nhân viên được hệ thống tự sinh theo cấu hình.
5. Chỉ người có quyền đặc biệt mới được sửa mã nhân viên thủ công nếu cấu hình cho phép.

### Kết quả mong muốn

1. HR quản lý được dữ liệu nhân viên tập trung.
2. Employee xem được hồ sơ cá nhân của mình.
3. Hệ thống có lịch sử thay đổi hồ sơ.
4. Dữ liệu nhạy cảm được bảo vệ theo quyền.
5. Các module khác có thể sử dụng dữ liệu nhân viên làm nguồn dữ liệu chính.

---

## 9.3 ATT - Chấm công

### Mục tiêu

Số hóa quy trình chấm công, bảng công, ca làm, rule chấm công, remote work và điều chỉnh công.

### Chức năng chính

1. Check-in.
2. Check-out.
3. Xem trạng thái chấm công hôm nay.
4. Xem bảng công cá nhân.
5. Xem chi tiết ngày công.
6. Xem bảng công team.
7. Xem bảng công toàn công ty.
8. Quản lý ca làm việc.
9. Gán ca làm cho công ty, phòng ban hoặc nhân viên.
10. Cấu hình rule chấm công.
11. Tính đi muộn.
12. Tính về sớm.
13. Tính thiếu giờ/đủ công.
14. Chặn chấm công khi có đơn nghỉ phép Approved.
15. Xử lý remote/công tác.
16. Tự động chấm công theo cấu hình.
17. Employee gửi yêu cầu điều chỉnh công.
18. Manager/HR duyệt hoặc từ chối yêu cầu điều chỉnh công.
19. HR/Admin điều chỉnh công trực tiếp.
20. Xuất bảng công.
21. Ghi audit log chấm công.

### Quyết định nghiệp vụ quan trọng

1. Check-in/check-out hỗ trợ web và mobile.
2. Hệ thống cần chuẩn bị khả năng tích hợp thiết bị chấm công vật lý ở giai đoạn sau.
3. Rule chấm công có thể cấu hình theo công ty, phòng ban hoặc nhân viên.
4. Một số nhân viên/công việc đặc thù có thể được tự động chấm công.
5. HR và vai trò cao hơn có quyền điều chỉnh công.
6. Manager trực tiếp có thể xử lý/duyệt điều chỉnh công trong phạm vi team.
7. Hỗ trợ ca cố định và ca linh hoạt.
8. Nhân viên đã có đơn nghỉ phép Approved cả ngày sẽ bị chặn chấm công.
9. Nếu có đơn remote/công tác Approved, hệ thống áp dụng rule remote.
10. Backend sử dụng server time để ghi nhận thời gian chấm công.

### Kết quả mong muốn

1. Nhân viên chấm công nhanh và chính xác.
2. HR kiểm soát được bảng công.
3. Manager xử lý được bất thường trong team.
4. Dữ liệu chấm công đủ tin cậy để phục vụ payroll sau này.
5. Hệ thống giảm phụ thuộc vào Excel hoặc thao tác thủ công.

---

## 9.4 LEAVE - Nghỉ phép

### Mục tiêu

Số hóa quy trình xin nghỉ, duyệt nghỉ, quản lý số dư phép và đồng bộ nghỉ phép sang chấm công.

### Chức năng chính

1. Xem số ngày phép còn lại.
2. Tạo đơn nghỉ phép.
3. Lưu nháp đơn nghỉ phép.
4. Gửi đơn nghỉ phép.
5. Xem danh sách đơn nghỉ của tôi.
6. Xem chi tiết đơn nghỉ.
7. Hủy đơn nghỉ.
8. Xem danh sách đơn chờ duyệt.
9. Duyệt đơn nghỉ.
10. Từ chối đơn nghỉ.
11. Xem lịch nghỉ cá nhân.
12. Xem lịch nghỉ team.
13. Xem lịch nghỉ toàn công ty.
14. Quản lý loại nghỉ phép.
15. Quản lý chính sách ngày phép.
16. Quản lý số dư phép nhân viên.
17. Điều chỉnh số dư phép.
18. Đồng bộ nghỉ phép sang chấm công.
19. Gửi thông báo nghỉ phép.
20. Xem lịch sử xử lý đơn nghỉ.
21. Xuất dữ liệu nghỉ phép.

### Quyết định nghiệp vụ quan trọng

1. Employee có thể tạo đơn nghỉ của chính mình.
2. Manager duyệt/từ chối đơn nghỉ của nhân viên thuộc team.
3. HR có thể xem và xử lý đơn nghỉ toàn công ty nếu được cấp quyền.
4. Đơn nghỉ Approved ảnh hưởng trực tiếp đến bảng công.
5. Nếu nghỉ cả ngày, ATT phải cập nhật trạng thái công là Leave và chặn chấm công.
6. Nếu nghỉ nửa ngày hoặc theo giờ, ATT cần tính lại required working minutes.
7. Nếu đơn nghỉ Approved bị hủy/thu hồi, ATT cần tính lại bảng công.
8. Leave Balance cần theo dõi số phép được cấp, đã dùng, chờ duyệt và còn lại.

### Kết quả mong muốn

1. Nhân viên chủ động gửi và theo dõi đơn nghỉ.
2. Manager/HR xử lý đơn nghỉ tập trung.
3. HR kiểm soát được lịch nghỉ và số dư phép.
4. Nghỉ phép đồng bộ chính xác sang chấm công.
5. Dữ liệu nghỉ phép sẵn sàng phục vụ payroll sau MVP.

---

## 9.5 TASK - Công việc & dự án

### Mục tiêu

Quản lý tập trung dự án, task, giao việc, deadline, trạng thái, bình luận và file đính kèm.

### Chức năng chính

1. Xem danh sách dự án.
2. Tạo dự án.
3. Cập nhật dự án.
4. Đóng/hủy/xóa mềm dự án.
5. Quản lý thành viên dự án.
6. Phân vai trò thành viên dự án.
7. Xem danh sách task.
8. Tạo task.
9. Giao task cho nhân viên.
10. Cập nhật thông tin task.
11. Cập nhật trạng thái task.
12. Xem việc của tôi.
13. Kanban board.
14. Bình luận trong task.
15. Đính kèm file trong task.
16. Checklist trong task.
17. Theo dõi task quá hạn/sắp đến hạn.
18. Tìm kiếm, lọc, sắp xếp task.
19. Lịch sử hoạt động task/project.
20. Báo cáo tiến độ dự án cơ bản.

### Quyết định nghiệp vụ quan trọng

1. Task có thể thuộc một project.
2. MVP ưu tiên mỗi task có một assignee chính.
3. Có thể có watcher/follower.
4. Project có thành viên và vai trò cấp dự án.
5. Project role không thay thế RBAC hệ thống.
6. Employee xem và cập nhật task được giao.
7. Manager/Project Manager giao việc và theo dõi tiến độ theo phạm vi quyền.
8. Nếu assignee đang nghỉ phép, hệ thống có thể cảnh báo khi giao task.
9. Overdue có thể là trạng thái tính toán thay vì trạng thái lưu cố định.

### Kết quả mong muốn

1. Manager giao việc rõ ràng.
2. Employee biết việc cần làm và deadline.
3. Dữ liệu task không bị thất lạc trong chat/email.
4. Dự án có thể theo dõi tiến độ cơ bản.
5. Dashboard và Notification có dữ liệu task để cảnh báo kịp thời.

---

## 9.6 DASH - Dashboard

### Mục tiêu

Tổng hợp và hiển thị dữ liệu quan trọng theo từng vai trò người dùng.

### Chức năng chính

1. Hiển thị dashboard theo vai trò.
2. Dashboard Employee.
3. Dashboard Manager.
4. Dashboard HR.
5. Dashboard Admin.
6. Widget chấm công hôm nay.
7. Widget task của tôi.
8. Widget task quá hạn/sắp đến hạn.
9. Widget số ngày phép còn lại.
10. Widget đơn nghỉ chờ duyệt.
11. Widget lịch nghỉ team/công ty.
12. Widget thông báo mới.
13. Widget tổng quan nhân sự.
14. Widget nhân sự mới.
15. Widget hợp đồng sắp hết hạn.
16. Widget bất thường chấm công.
17. Widget tiến độ dự án.
18. Điều hướng nhanh sang module liên quan.
19. Cấu hình hiển thị widget cơ bản theo role.
20. API tổng hợp dữ liệu dashboard.

### Quyết định nghiệp vụ quan trọng

1. Dashboard chỉ hiển thị, tổng hợp và điều hướng.
2. Dashboard không xử lý nghiệp vụ gốc thay module nguồn.
3. Dữ liệu dashboard phải theo role, permission và data scope.
4. Người dùng không được xem dữ liệu ngoài phạm vi quyền.
5. Widget cần có loading state, empty state và error state.
6. Các dữ liệu quan trọng như task quá hạn, đơn chờ duyệt, thiếu check-out cần đủ mới.

### Kết quả mong muốn

1. Employee thấy nhanh việc cần làm trong ngày.
2. Manager thấy nhanh việc cần xử lý của team.
3. HR thấy nhanh tình hình nhân sự, chấm công, nghỉ phép.
4. Admin thấy nhanh trạng thái vận hành hệ thống.
5. Người dùng giảm thời gian phải đi qua nhiều module để kiểm tra thông tin.

---

## 9.7 NOTI - Thông báo hệ thống

### Mục tiêu

Tạo, lưu, hiển thị và quản lý thông báo khi có sự kiện quan trọng trong hệ thống.

### Chức năng chính

1. Tạo thông báo in-app từ event hệ thống.
2. Xem danh sách thông báo của tôi.
3. Xem chi tiết thông báo.
4. Đếm số thông báo chưa đọc.
5. Đánh dấu một thông báo là đã đọc.
6. Đánh dấu tất cả thông báo là đã đọc.
7. Xóa/ẩn thông báo khỏi danh sách của tôi.
8. Lọc thông báo theo trạng thái, loại, module.
9. Điều hướng từ thông báo sang module gốc.
10. Gửi thông báo nghỉ phép.
11. Gửi thông báo task/project.
12. Gửi thông báo chấm công/điều chỉnh công.
13. Gửi thông báo nhân sự/hợp đồng.
14. Cấu hình loại thông báo cơ bản.
15. Cấu hình bật/tắt kênh thông báo.
16. Quản lý template thông báo cơ bản.
17. Ghi log gửi thông báo.
18. API thông báo cho Dashboard.
19. Notification dropdown/header badge.
20. Job kiểm tra nhắc hạn/quá hạn.

### Quyết định nghiệp vụ quan trọng

1. MVP ưu tiên thông báo in-app.
2. Email notification có thể cấu hình cơ bản hoặc để phase sau.
3. Mobile push và realtime WebSocket là hướng mở rộng sau MVP.
4. Mỗi notification gửi đến một user cụ thể.
5. Notification cần chứa module nguồn, event nguồn, trạng thái đọc và target link.
6. Khi user bấm notification, hệ thống điều hướng sang module gốc nếu user có quyền xem.
7. Không để lộ dữ liệu nhạy cảm trong URL hoặc payload thông báo.

### Kết quả mong muốn

1. Người dùng không bỏ lỡ task, đơn nghỉ, điều chỉnh công, hợp đồng sắp hết hạn.
2. Manager/HR nhận được thông báo cần xử lý.
3. Employee nhận kết quả duyệt nghỉ, duyệt điều chỉnh công, task mới.
4. Dashboard hiển thị được số thông báo chưa đọc và thông báo mới.
5. Hệ thống có nền tảng mở rộng sang email, mobile push, realtime và automation.

---

## 10. Luồng nghiệp vụ sản phẩm chính

## 10.1 Luồng tạo nhân viên mới

```text
HR/Admin đăng nhập
→ Vào module HR
→ Tạo hồ sơ nhân viên mới
→ Hệ thống sinh mã nhân viên theo cấu hình
→ HR/Admin nhập thông tin cá nhân, công việc, phòng ban, chức vụ, quản lý trực tiếp
→ HR/Admin chọn có tạo tài khoản đăng nhập hay không
→ Nếu có, hệ thống gọi AUTH tạo user
→ Hệ thống liên kết user với employee
→ Hệ thống ghi audit log
→ NOTI gửi thông báo nếu cấu hình bật
```

## 10.2 Luồng Employee cập nhật hồ sơ cá nhân

```text
Employee đăng nhập
→ Vào Hồ sơ của tôi
→ Chỉnh sửa các trường được phép đề xuất
→ Gửi yêu cầu cập nhật hồ sơ
→ Hệ thống tạo profile change request trạng thái Pending
→ NOTI gửi thông báo cho HR/Admin
→ HR/Admin xem dữ liệu cũ và dữ liệu mới
→ HR/Admin duyệt hoặc từ chối
→ Nếu duyệt, hệ thống cập nhật hồ sơ chính
→ Employee nhận thông báo kết quả
```

## 10.3 Luồng chấm công hằng ngày

```text
Employee đăng nhập
→ Mở Dashboard hoặc màn hình Chấm công hôm nay
→ Hệ thống kiểm tra trạng thái nhân viên
→ Hệ thống kiểm tra ngày làm việc/ngày nghỉ
→ Hệ thống kiểm tra đơn nghỉ Approved
→ Hệ thống kiểm tra đơn remote/công tác Approved
→ Hệ thống xác định rule và ca làm áp dụng
→ Employee bấm Check-in
→ Hệ thống ghi nhận server time, nguồn chấm công, log chấm công
→ Cuối ngày Employee bấm Check-out
→ Hệ thống tính tổng thời gian làm việc, đi muộn, về sớm, thiếu giờ
→ Bảng công được cập nhật
```

## 10.4 Luồng điều chỉnh công

```text
Employee phát hiện thiếu/sai dữ liệu công
→ Tạo yêu cầu điều chỉnh công
→ Nhập lý do và file đính kèm nếu có
→ Hệ thống gửi yêu cầu đến Manager/HR có quyền
→ Manager/HR xem yêu cầu
→ Manager/HR duyệt hoặc từ chối
→ Nếu duyệt, attendance record được cập nhật
→ Hệ thống ghi audit log
→ Employee nhận thông báo kết quả
```

## 10.5 Luồng xin nghỉ phép

```text
Employee đăng nhập
→ Vào module Nghỉ phép
→ Tạo đơn nghỉ
→ Chọn loại nghỉ, thời gian nghỉ, lý do
→ Hệ thống tính số ngày/giờ nghỉ
→ Hệ thống kiểm tra số dư phép
→ Employee gửi đơn
→ Hệ thống chuyển đơn sang Pending
→ Hệ thống xác định người duyệt
→ NOTI gửi thông báo cho Manager/HR
→ Manager/HR duyệt hoặc từ chối
→ Nếu duyệt, hệ thống cập nhật số dư phép và đồng bộ sang ATT
→ Employee nhận thông báo kết quả
```

## 10.6 Luồng giao task

```text
Manager/Project Manager đăng nhập
→ Vào module TASK
→ Tạo project nếu cần
→ Thêm thành viên dự án
→ Tạo task
→ Chọn assignee, deadline, priority
→ Hệ thống kiểm tra quyền và trạng thái nhân viên
→ Nếu assignee có lịch nghỉ, hệ thống hiển thị cảnh báo nếu có dữ liệu
→ Task được tạo
→ NOTI gửi thông báo cho assignee
→ Employee xem task trong Dashboard hoặc My Tasks
→ Employee cập nhật trạng thái task
```

## 10.7 Luồng Dashboard sau đăng nhập

```text
User đăng nhập
→ AUTH xác định role, permission và data scope
→ DASH xác định dashboard phù hợp
→ DASH lấy dữ liệu từ HR, ATT, LEAVE, TASK, NOTI
→ Hệ thống hiển thị widget theo quyền
→ User bấm vào widget
→ Hệ thống điều hướng sang module gốc
```

---

## 11. Yêu cầu phân quyền và phạm vi dữ liệu

### 11.1 Nguyên tắc phân quyền

Hệ thống sử dụng RBAC - Role-Based Access Control.

Một user có thể có nhiều role.

Ví dụ:

1. Một người có thể vừa là Employee vừa là Manager.
2. Một người có thể vừa là HR vừa là Payroll Officer.
3. Một người có thể vừa là Admin công ty vừa là HR.

### 11.2 Data Scope

Hệ thống cần hỗ trợ các phạm vi dữ liệu sau:

| Scope      | Ý nghĩa                                       |
| ---------- | --------------------------------------------- |
| Own        | Chỉ dữ liệu của chính mình                    |
| Team       | Dữ liệu của team hoặc nhân viên trực thuộc    |
| Department | Dữ liệu thuộc phòng ban                       |
| Project    | Dữ liệu thuộc dự án, áp dụng chủ yếu cho TASK |
| Company    | Dữ liệu toàn công ty                          |
| System     | Dữ liệu toàn hệ thống                         |

### 11.3 Nguyên tắc bảo mật dữ liệu nhạy cảm

Các dữ liệu sau được xem là nhạy cảm:

1. Lương.
2. Tài khoản ngân hàng.
3. CCCD/CMND.
4. Hợp đồng lao động.
5. Hồ sơ nhân sự.
6. Dữ liệu nghỉ việc.
7. Dữ liệu chấm công chi tiết.
8. Dữ liệu điều chỉnh công.
9. Dữ liệu nghỉ phép.
10. Log hệ thống.

Nguyên tắc:

1. Không trả dữ liệu nhạy cảm nếu user không có quyền.
2. Không hiển thị dữ liệu nhạy cảm ở UI nếu không có quyền.
3. Không cho export dữ liệu nhạy cảm nếu không có quyền export.
4. Mọi thao tác xem, sửa, xóa, export dữ liệu nhạy cảm cần được ghi log.
5. Dữ liệu lương phải có quyền riêng, không mặc định cho HR nếu doanh nghiệp yêu cầu kiểm soát chặt.

---

## 12. Yêu cầu phi chức năng

### 12.1 Bảo mật

1. Mật khẩu không lưu plain text.
2. Token/session có thời hạn.
3. API backend phải kiểm tra authentication và authorization.
4. Dữ liệu nhạy cảm cần được kiểm soát theo quyền.
5. Các thao tác quan trọng cần audit log.
6. Có cơ chế khóa tài khoản.
7. Có thể mở rộng sang 2FA, SSO, Google Workspace, Microsoft 365 ở phase sau.

### 12.2 Hiệu năng

1. Danh sách dữ liệu phải có phân trang.
2. Các màn hình danh sách cần hỗ trợ tìm kiếm, lọc, sắp xếp.
3. Dashboard cần cache ngắn hạn nếu query nặng.
4. Notification count cần truy vấn nhanh.
5. Các API thường dùng như trạng thái chấm công hôm nay, thông báo chưa đọc, task của tôi cần tối ưu.

### 12.3 Khả năng mở rộng

1. Có thể thêm module mới mà không phá vỡ module cũ.
2. Có thể thêm permission mới.
3. Có thể thêm role mới.
4. Có thể mở rộng từ single company sang multi-company/SaaS.
5. Có thể tích hợp thiết bị chấm công, email, calendar, file storage, payroll, accounting.
6. Có thể phát triển mobile app sau MVP.

### 12.4 Audit và truy vết

Các hành động cần ghi log:

1. Đăng nhập/đăng xuất.
2. Tạo/sửa/khóa user.
3. Gán role/permission.
4. Tạo/sửa/xóa hồ sơ nhân viên.
5. Xem hoặc export dữ liệu nhạy cảm.
6. Chấm công, điều chỉnh công.
7. Duyệt/từ chối điều chỉnh công.
8. Tạo/duyệt/từ chối/hủy đơn nghỉ.
9. Tạo/sửa/giao task.
10. Cập nhật cấu hình hệ thống.
11. Gửi thông báo hệ thống thủ công nếu có.

### 12.5 Khả dụng và ổn định

1. Hệ thống cần xử lý lỗi rõ ràng.
2. Các màn hình cần có loading state, empty state, error state.
3. Không để lỗi một module làm sập toàn bộ hệ thống.
4. Các job nền như notification reminder cần có log chạy thành công/thất bại.
5. Các thao tác quan trọng cần có transaction để tránh dữ liệu lệch.

---

## 13. Tiêu chí thành công của MVP

MVP được xem là thành công khi đạt các tiêu chí sau:

### 13.1 Tiêu chí sử dụng

1. Employee có thể đăng nhập và sử dụng các chức năng hằng ngày.
2. Employee có thể check-in/check-out.
3. Employee có thể xem bảng công cá nhân.
4. Employee có thể gửi đơn nghỉ phép.
5. Employee có thể xem task được giao.
6. Manager có thể duyệt nghỉ, duyệt điều chỉnh công và theo dõi task team.
7. HR có thể quản lý hồ sơ nhân viên, bảng công và nghỉ phép.
8. Admin có thể quản lý user, role và permission.
9. Người dùng nhận được thông báo quan trọng trong hệ thống.
10. Dashboard hiển thị đúng dữ liệu theo vai trò.

### 13.2 Tiêu chí nghiệp vụ

1. HR giảm thao tác thủ công khi quản lý nhân sự và bảng công.
2. Đơn nghỉ phép được xử lý tập trung trên hệ thống.
3. Dữ liệu nghỉ phép đồng bộ sang chấm công.
4. Task được giao và theo dõi rõ ràng.
5. Manager có thể theo dõi việc cần xử lý qua Dashboard.
6. Dữ liệu nhạy cảm được kiểm soát theo quyền.

### 13.3 Tiêu chí kỹ thuật

1. Hệ thống có database design rõ ràng.
2. Hệ thống có API design rõ ràng.
3. Backend kiểm tra quyền cho các API quan trọng.
4. Có audit log cho nghiệp vụ nhạy cảm.
5. Có cấu trúc dữ liệu đủ mở để triển khai phase sau.
6. Các module MVP có thể liên kết dữ liệu với nhau.
7. Hệ thống có thể mở rộng thêm payroll, recruitment, asset, room, chat, mobile, AI.

---

## 14. User Stories cấp cao

### 14.1 Employee

1. Là Employee, tôi muốn đăng nhập vào hệ thống để sử dụng các chức năng nội bộ.
2. Là Employee, tôi muốn xem hồ sơ cá nhân để kiểm tra thông tin của mình.
3. Là Employee, tôi muốn gửi yêu cầu cập nhật hồ sơ cá nhân để sửa thông tin khi cần.
4. Là Employee, tôi muốn check-in/check-out để ghi nhận thời gian làm việc.
5. Là Employee, tôi muốn xem bảng công cá nhân để biết ngày công của mình.
6. Là Employee, tôi muốn gửi yêu cầu điều chỉnh công khi dữ liệu công bị sai.
7. Là Employee, tôi muốn gửi đơn nghỉ phép để xin nghỉ trên hệ thống.
8. Là Employee, tôi muốn xem số ngày phép còn lại để biết mình còn bao nhiêu phép.
9. Là Employee, tôi muốn xem task được giao để biết việc cần làm.
10. Là Employee, tôi muốn nhận thông báo khi có task mới, kết quả duyệt nghỉ hoặc kết quả điều chỉnh công.

### 14.2 Manager

1. Là Manager, tôi muốn xem danh sách nhân viên thuộc team để quản lý nhân sự.
2. Là Manager, tôi muốn xem bảng công team để kiểm tra tình hình đi làm.
3. Là Manager, tôi muốn duyệt/từ chối yêu cầu điều chỉnh công để xử lý bất thường.
4. Là Manager, tôi muốn duyệt/từ chối đơn nghỉ phép để quản lý lịch nghỉ team.
5. Là Manager, tôi muốn tạo và giao task cho nhân viên để quản lý công việc.
6. Là Manager, tôi muốn xem task quá hạn để xử lý kịp thời.
7. Là Manager, tôi muốn xem dashboard team để biết việc cần xử lý hôm nay.
8. Là Manager, tôi muốn nhận thông báo khi có đơn nghỉ, điều chỉnh công hoặc task quá hạn.

### 14.3 HR

1. Là HR, tôi muốn quản lý hồ sơ nhân viên để dữ liệu nhân sự được tập trung.
2. Là HR, tôi muốn tạo nhân viên mới và liên kết tài khoản để onboarding nhân sự.
3. Là HR, tôi muốn quản lý phòng ban, chức vụ, cấp bậc để chuẩn hóa cơ cấu tổ chức.
4. Là HR, tôi muốn quản lý hợp đồng để theo dõi quá trình làm việc.
5. Là HR, tôi muốn xử lý yêu cầu cập nhật hồ sơ cá nhân của Employee.
6. Là HR, tôi muốn xem bảng công toàn công ty để kiểm tra dữ liệu công.
7. Là HR, tôi muốn điều chỉnh công trực tiếp khi có quyền và lý do hợp lệ.
8. Là HR, tôi muốn quản lý chính sách nghỉ phép và số dư phép.
9. Là HR, tôi muốn xem dashboard HR để nắm tình hình nhân sự, công và nghỉ phép.
10. Là HR, tôi muốn nhận thông báo hợp đồng sắp hết hạn, đơn nghỉ, điều chỉnh công và sự kiện nhân sự.

### 14.4 Admin công ty

1. Là Admin công ty, tôi muốn quản lý user để kiểm soát người dùng hệ thống.
2. Là Admin công ty, tôi muốn gán role cho user để phân quyền sử dụng.
3. Là Admin công ty, tôi muốn cấu hình quyền và module để phù hợp doanh nghiệp.
4. Là Admin công ty, tôi muốn xem dashboard quản trị để nắm tình trạng hệ thống.
5. Là Admin công ty, tôi muốn xem audit log khi cần kiểm tra thao tác.

---

## 15. Out of Scope của MVP

Các nội dung sau không bắt buộc triển khai trong MVP Version 1.0:

1. Tính lương đầy đủ.
2. Phiếu lương.
3. Quy trình tuyển dụng.
4. Quản lý ứng viên.
5. Quản lý tài sản.
6. Quản lý phòng họp.
7. Chat realtime.
8. Mạng xã hội nội bộ.
9. Mobile app hoàn chỉnh.
10. AI assistant.
11. Nhận diện khuôn mặt.
12. Tích hợp máy chấm công vật lý.
13. Đồng bộ Google Calendar/Microsoft Calendar.
14. SSO doanh nghiệp.
15. 2FA.
16. Workflow approval nhiều cấp phức tạp.
17. Dashboard BI nâng cao.
18. Gantt chart/Sprint/Time tracking nâng cao.
19. Payroll integration.
20. Accounting integration.

---

## 16. Giả định và ràng buộc

### 16.1 Giả định

1. MVP ưu tiên web app.
2. Mobile app hoặc mobile-optimized web có thể phát triển sau.
3. Doanh nghiệp sử dụng một công ty/tenant ở MVP, nhưng database nên thiết kế sẵn khả năng mở rộng multi-tenant.
4. PostgreSQL là lựa chọn phù hợp cho database quan hệ.
5. Các module MVP cần triển khai trước các module phase sau.
6. Dữ liệu lương chưa triển khai ở MVP nhưng cần tách quyền riêng từ sớm.
7. Hệ thống sẽ có nhiều role và một user có thể có nhiều role.
8. Notification MVP ưu tiên in-app.
9. Remote/công tác được quản lý trong module ATT ở MVP.
10. File upload có thể dùng chung cho HR, LEAVE, TASK, ATT.

### 16.2 Ràng buộc

1. Backend phải kiểm tra quyền, không chỉ dựa vào UI.
2. Dữ liệu nhân sự, chấm công, nghỉ phép phải có audit log.
3. Không xóa cứng dữ liệu quan trọng.
4. Các module cần dùng chung quy ước mã module, mã chức năng, mã quyền.
5. Dashboard không được xử lý nghiệp vụ gốc thay module nguồn.
6. Notification không được chứa dữ liệu nhạy cảm trong URL/payload.
7. Hệ thống phải hỗ trợ phân quyền theo role và data scope.
8. Các API danh sách phải hỗ trợ phân trang.

---

## 17. Rủi ro sản phẩm

| Rủi ro                                          | Mức độ     | Hướng xử lý                                                                   |
| ----------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| Phạm vi MVP quá lớn                             | Cao        | Chia sprint theo module, ưu tiên AUTH → HR → ATT → LEAVE → TASK → NOTI → DASH |
| Phân quyền phức tạp                             | Cao        | Thiết kế RBAC + data scope từ đầu                                             |
| Dữ liệu chấm công và nghỉ phép lệch nhau        | Cao        | Thiết kế rule đồng bộ ATT-LEAVE rõ ràng                                       |
| Dashboard query nặng                            | Trung bình | Dùng API riêng cho widget, cache ngắn hạn                                     |
| Notification spam                               | Trung bình | Có event rule, template, trạng thái đọc/ẩn                                    |
| HR data nhạy cảm bị lộ                          | Cao        | Kiểm soát permission + audit log                                              |
| Rule chấm công quá linh hoạt gây khó triển khai | Cao        | MVP chỉ làm rule quan trọng, phase sau mở rộng                                |
| Database thiết kế thiếu mở rộng                 | Cao        | Thiết kế company_id, module code, audit log, soft delete từ đầu               |

---

## 18. Ưu tiên triển khai đề xuất

### Phase MVP Core - Nền tảng

1. Database foundation.
2. AUTH/RBAC.
3. HR core.
4. Audit log.
5. File upload foundation.

### Phase MVP Operation - Nghiệp vụ hằng ngày

1. ATT check-in/check-out.
2. Shift/rule cơ bản.
3. Attendance records/logs.
4. LEAVE request/approval.
5. Đồng bộ LEAVE → ATT.

### Phase MVP Collaboration - Công việc

1. Project.
2. Task.
3. Assignee.
4. Comment.
5. File attachment.
6. Kanban cơ bản.

### Phase MVP Experience - Tổng hợp và thông báo

1. NOTI in-app.
2. Notification badge/dropdown.
3. Dashboard Employee.
4. Dashboard Manager.
5. Dashboard HR.
6. Dashboard Admin.

---

## 19. Tài liệu liên quan

| Mã tài liệu | Tên tài liệu | Trạng thái |
| ----------- | ------------ | ---------- |
| [SPEC-01](<../SPEC/SPEC-01 Tổng quan.md>) | Tổng quan hệ thống | Đã có |
| [SPEC-02](<../SPEC/SPEC-02 AUTH.md>) | Tài khoản, đăng nhập & phân quyền | Đã có |
| [SPEC-03](<../SPEC/SPEC-03 HR.md>) | Quản lý nhân sự | Đã có |
| [SPEC-04](<../SPEC/SPEC-04 ATT.md>) | Chấm công | Đã có |
| [SPEC-05](<../SPEC/SPEC-05 LEAVE.md>) | Nghỉ phép | Đã có |
| [SPEC-06](<../SPEC/SPEC-06 TASK.md>) | Công việc & dự án | Đã có |
| [SPEC-07](<../SPEC/SPEC-07 DASH.md>) | Dashboard | Đã có |
| [SPEC-08](<../SPEC/SPEC-08 NOTI.md>) | Thông báo hệ thống | Đã có |
| [DB-01](<../DB/DB-01 DATABASE DESIGN TỔNG QUAN.md>) | Database Design tổng quan + ERD | Đã có |
| [DB-02](<../DB/DB-02 AUTH RBAC Database Design.md>) | AUTH & RBAC Database Design | Đã có |
| [DB-03](<../DB/DB-03_HR Database Design.md>) | HR Database Design | Đã có |
| [DB-04](<../DB/DB-04_ATT Database Design.md>) | ATT Database Design | Đã có |
| [DB-05](<../DB/DB-05 LEAVE Database Design.md>) | LEAVE Database Design | Đã có |
| [DB-06](<../DB/DB-06 TASK Database Design.md>) | TASK Database Design | Đã có |
| [DB-07](<../DB/DB-07 NOTI DASH Database Design.md>) | NOTI & DASH Database Design | Đã có |
| [DB-08](<../DB/DB-08 Audit Files Settings Seeds Database Design.md>) | Audit, Files, Settings, Seeds | Đã có |
| [DB-09](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) | Index, Query Pattern & Performance | Đã có |
| [DB-10](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) | Migration Plan & Initial Seed Data | Đã có |
| API-01 | API Design | Sẽ viết sau |
| UI-01 | UI/UX Design | Sẽ viết sau |
| TEST-01 | Test Plan | Sẽ viết sau |

---

## 20. Kết luận

MVP Version 1.0 của hệ thống quản lý doanh nghiệp nội bộ tập trung vào việc xây dựng nền tảng vận hành cốt lõi gồm:

1. Tài khoản và phân quyền.
2. Quản lý nhân sự.
3. Chấm công.
4. Nghỉ phép.
5. Công việc và dự án.
6. Dashboard.
7. Thông báo hệ thống.
