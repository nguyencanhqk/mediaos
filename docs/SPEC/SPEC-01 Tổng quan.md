# SPEC-01: TỔNG QUAN HỆ THỐNG QUẢN LÝ DOANH NGHIỆP

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> **SPEC-01 Tổng quan** · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · [SPEC-03 HR](<SPEC-03 HR.md>) · [SPEC-04 ATT](<SPEC-04 ATT.md>) · [SPEC-05 LEAVE](<SPEC-05 LEAVE.md>) · [SPEC-06 TASK](<SPEC-06 TASK.md>) · [SPEC-07 DASH](<SPEC-07 DASH.md>) · [SPEC-08 NOTI](<SPEC-08 NOTI.md>)
>
> **Liên quan:** [Thiết kế DB: DB-01 Tổng quan](<../DB/DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [Sản phẩm: PRD-00](<../PRD/PRD-00 Enterprise Management System .md>) · [Thiết kế API: API-01 Tổng quan](<../API Design/API-01 TỔNG QUAN.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường        | Nội dung                                |
| ------------- | --------------------------------------- |
| Mã tài liệu   | SPEC-01                                 |
| Tên tài liệu  | Tổng quan hệ thống quản lý doanh nghiệp |
| Tên dự án     | Hệ thống quản lý doanh nghiệp nội bộ    |
| Phiên bản     | v1.0                                    |
| Trạng thái    | Draft                                   |
| Người viết    |                                         |
| Người duyệt   |                                         |
| Ngày tạo      |                                         |
| Ngày cập nhật |                                         |

---

## 2. Mục đích của tài liệu

Tài liệu này mô tả tổng quan toàn bộ hệ thống quản lý doanh nghiệp nội bộ, bao gồm mục tiêu sản phẩm, phạm vi phát triển, nhóm người dùng, module chức năng, nguyên tắc vận hành, kiến trúc tổng thể, phân quyền tổng quan và cách liên kết với các tài liệu spec module chi tiết.

Tài liệu này đóng vai trò là **spec mẹ**. Các module chi tiết sẽ được tách thành các tài liệu spec riêng và được liên kết thông qua mã module, mã chức năng, mã màn hình, mã API và mã quyền.

---

## 3. Bối cảnh xây dựng hệ thống

Doanh nghiệp hiện có nhiều hoạt động quản lý nội bộ đang bị phân tán ở nhiều công cụ khác nhau như Excel, Google Sheet, email, tin nhắn, phần mềm chấm công, phần mềm quản lý task, file giấy và trao đổi thủ công.

Các nghiệp vụ cần được số hóa bao gồm:

* Quản lý nhân sự
* Quản lý tuyển dụng
* Quản lý chấm công
* Quản lý nghỉ phép
* Quản lý tiền lương
* Quản lý công việc theo dự án
* Quản lý phòng họp
* Quản lý tài sản
* Chat nội bộ
* Mạng xã hội nội bộ
* Dashboard và báo cáo
* Thông báo hệ thống
* Phân quyền và quản trị người dùng

Hệ thống được xây dựng nhằm gom các nghiệp vụ này vào một nền tảng thống nhất, giúp doanh nghiệp quản lý dữ liệu tập trung, giảm thao tác thủ công và tăng khả năng kiểm soát hoạt động nội bộ.

---

## 4. Mục tiêu sản phẩm

### 4.1 Mục tiêu tổng quát

Xây dựng một nền tảng quản lý doanh nghiệp nội bộ all-in-one, cho phép doanh nghiệp quản lý nhân sự, chấm công, nghỉ phép, công việc, lương, tuyển dụng, tài sản, phòng họp và giao tiếp nội bộ trên cùng một hệ thống.

### 4.2 Mục tiêu nghiệp vụ

Hệ thống cần đạt các mục tiêu sau:

1. Tập trung toàn bộ dữ liệu nhân sự vào một nơi duy nhất.
2. Chuẩn hóa quy trình quản lý nhân sự, nghỉ phép, chấm công và công việc.
3. Giúp nhân viên thao tác nhanh các nhu cầu thường ngày như chấm công, xin nghỉ, xem task, nhận thông báo.
4. Giúp HR giảm thao tác thủ công khi quản lý hồ sơ nhân viên, bảng công, hợp đồng và nghỉ phép.
5. Giúp quản lý theo dõi nhân viên, phê duyệt yêu cầu và kiểm soát tiến độ công việc.
6. Giúp ban lãnh đạo có dashboard tổng quan về tình hình công ty.
7. Giúp hệ thống có khả năng mở rộng thêm các module nâng cao như lương, tuyển dụng, tài sản, phòng họp, chat và AI.

### 4.3 Mục tiêu kỹ thuật

Hệ thống cần được thiết kế theo hướng:

1. Dễ mở rộng module mới.
2. Có phân quyền rõ ràng.
3. Có nhật ký hoạt động.
4. Bảo mật dữ liệu nhạy cảm.
5. Hỗ trợ realtime notification ở các nghiệp vụ quan trọng.
6. Có khả năng phát triển web app trước, mobile app sau.
7. Có thể triển khai theo mô hình SaaS trong tương lai.
8. Có thể tích hợp với hệ thống bên ngoài như máy chấm công, email, lịch, kế toán, lưu trữ file.

---

## 5. Định vị sản phẩm

Hệ thống được định vị là:

> Nền tảng quản lý doanh nghiệp nội bộ giúp số hóa toàn bộ hoạt động nhân sự, công việc, tài sản, phòng họp và giao tiếp trong công ty trên một hệ thống duy nhất.

Tên gọi nội bộ tạm thời:

> Enterprise Management System

Tên thương mại có thể thay đổi ở giai đoạn branding.

---

## 6. Phạm vi hệ thống

### 6.1 Phạm vi tổng thể

Hệ thống bao gồm các nhóm chức năng chính:

| Nhóm               | Mô tả                                            |
| ------------------ | ------------------------------------------------ |
| Quản trị hệ thống  | Tài khoản, vai trò, phân quyền, cấu hình công ty |
| Nhân sự            | Hồ sơ nhân viên, phòng ban, chức vụ, hợp đồng    |
| Chấm công          | Check-in, check-out, bảng công, ca làm           |
| Nghỉ phép          | Đơn nghỉ, duyệt nghỉ, số ngày phép               |
| Công việc          | Dự án, task, kanban, bình luận, file             |
| Dashboard          | Dữ liệu tổng quan theo vai trò                   |
| Thông báo          | In-app notification, email notification nếu cần  |
| Tiền lương         | Kỳ lương, bảng lương, phiếu lương                |
| Tuyển dụng         | Vị trí tuyển dụng, ứng viên, pipeline            |
| Tài sản            | Cấp phát, thu hồi, bảo trì, kiểm kê              |
| Phòng họp          | Đặt lịch, kiểm tra trùng lịch, quản lý phòng     |
| Chat               | Chat cá nhân, chat nhóm, chat dự án              |
| Mạng xã hội nội bộ | Bài đăng, like, comment, thông báo nội bộ        |
| Mobile app         | Chấm công, task, nghỉ phép, thông báo            |
| AI & tích hợp      | Tóm tắt, gợi ý, cảnh báo, đồng bộ hệ thống khác  |

---

## 7. Phạm vi MVP Version 1.0

### 7.1 Module thuộc MVP

Phiên bản MVP v1.0 tập trung vào các module lõi sau:

| Mã module | Tên module             | Tài liệu liên kết | Trạng thái     |
| --------- | ---------------------- | ----------------- | -------------- |
| AUTH      | Tài khoản & phân quyền | SPEC-02           | Cần triển khai |
| HR        | Quản lý nhân sự        | SPEC-03           | Cần triển khai |
| ATT       | Chấm công              | SPEC-04           | Cần triển khai |
| LEAVE     | Nghỉ phép              | SPEC-05           | Cần triển khai |
| TASK      | Công việc & dự án      | SPEC-06           | Cần triển khai |
| DASH      | Dashboard              | SPEC-07           | Cần triển khai |
| NOTI      | Thông báo hệ thống     | SPEC-08           | Cần triển khai |

### 7.2 Module chưa thuộc MVP

Các module sau chưa triển khai chi tiết trong MVP v1.0, nhưng hệ thống phải thiết kế để có thể mở rộng về sau:

| Mã module | Tên module             | Tài liệu liên kết | Giai đoạn |
| --------- | ---------------------- | ----------------- | --------- |
| PAYROLL   | Tiền lương             | SPEC-09           | Phase 2   |
| RECRUIT   | Tuyển dụng             | SPEC-10           | Phase 2   |
| ASSET     | Quản lý tài sản        | SPEC-11           | Phase 3   |
| ROOM      | Quản lý phòng họp      | SPEC-12           | Phase 3   |
| CHAT      | Chat nội bộ            | SPEC-13           | Phase 4   |
| SOCIAL    | Mạng xã hội nội bộ     | SPEC-14           | Phase 4   |
| MOBILE    | Mobile app             | SPEC-15           | Phase 5   |
| AI        | AI & tích hợp nâng cao | SPEC-16           | Phase 5   |

---

## 8. Danh sách tài liệu spec liên kết

Bộ tài liệu spec của dự án sẽ được tổ chức như sau:

| Mã tài liệu | Tên tài liệu                      | Vai trò     |
| ----------- | --------------------------------- | ----------- |
| SPEC-01     | Tổng quan hệ thống                | Spec mẹ     |
| SPEC-02     | Tài khoản, đăng nhập & phân quyền | Spec module |
| SPEC-03     | Quản lý nhân sự                   | Spec module |
| SPEC-04     | Chấm công                         | Spec module |
| SPEC-05     | Nghỉ phép                         | Spec module |
| SPEC-06     | Công việc & dự án                 | Spec module |
| SPEC-07     | Dashboard                         | Spec module |
| SPEC-08     | Thông báo hệ thống                | Spec module |
| SPEC-09     | Tiền lương                        | Spec module |
| SPEC-10     | Tuyển dụng                        | Spec module |
| SPEC-11     | Quản lý tài sản                   | Spec module |
| SPEC-12     | Quản lý phòng họp                 | Spec module |
| SPEC-13     | Chat nội bộ                       | Spec module |
| SPEC-14     | Mạng xã hội nội bộ                | Spec module |
| SPEC-15     | Mobile app                        | Spec module |
| SPEC-16     | AI & tích hợp nâng cao            | Spec module |

---

## 9. Quy ước mã hóa để liên kết spec

Để các tài liệu spec liên kết được với nhau, toàn bộ hệ thống sử dụng chung quy ước mã hóa sau.

### 9.1 Mã module

Cấu trúc:

```text
MODULE_CODE
```

Ví dụ:

```text
AUTH
HR
ATT
LEAVE
TASK
DASH
NOTI
PAYROLL
RECRUIT
ASSET
ROOM
CHAT
SOCIAL
```

### 9.2 Mã chức năng

Cấu trúc:

```text
MODULE-FUNC-XXX
```

Ví dụ:

```text
AUTH-FUNC-001: Đăng nhập
AUTH-FUNC-002: Đăng xuất
HR-FUNC-001: Xem danh sách nhân viên
HR-FUNC-002: Thêm nhân viên
ATT-FUNC-001: Check-in
LEAVE-FUNC-001: Tạo đơn nghỉ phép
TASK-FUNC-001: Tạo dự án
```

### 9.3 Mã màn hình

Cấu trúc:

```text
MODULE-SCREEN-XXX
```

Ví dụ:

```text
AUTH-SCREEN-001: Màn hình đăng nhập
HR-SCREEN-001: Danh sách nhân viên
HR-SCREEN-002: Chi tiết hồ sơ nhân viên
ATT-SCREEN-001: Màn hình chấm công hôm nay
TASK-SCREEN-001: Danh sách dự án
```

### 9.4 Mã API

Cấu trúc:

```text
MODULE-API-XXX
```

Ví dụ:

```text
AUTH-API-001: POST /api/auth/login
HR-API-001: GET /api/employees
HR-API-002: POST /api/employees
ATT-API-001: POST /api/attendance/check-in
```

### 9.5 Mã quyền

Cấu trúc:

```text
MODULE.PERMISSION.ACTION
```

Ví dụ:

```text
HR.EMPLOYEE.VIEW
HR.EMPLOYEE.CREATE
HR.EMPLOYEE.UPDATE
HR.EMPLOYEE.DELETE
ATT.ATTENDANCE.CHECK_IN
LEAVE.REQUEST.APPROVE
TASK.PROJECT.CREATE
TASK.TASK.UPDATE
```

### 9.6 Mã lỗi

Cấu trúc:

```text
MODULE-ERR-XXX
```

Ví dụ:

```text
AUTH-ERR-001: Email hoặc mật khẩu không đúng
HR-ERR-001: Email nhân viên đã tồn tại
ATT-ERR-001: Nhân viên đã check-in hôm nay
LEAVE-ERR-001: Số ngày nghỉ vượt quá số ngày phép còn lại
```

### 9.7 Mã test case

Cấu trúc:

```text
MODULE-TC-XXX
```

Ví dụ:

```text
AUTH-TC-001: Đăng nhập thành công
HR-TC-001: Tạo nhân viên hợp lệ
ATT-TC-001: Check-in thành công
LEAVE-TC-001: Tạo đơn nghỉ phép thành công
```

### 9.8 Mã sự kiện thông báo

Cấu trúc:

```text
NOTI-EVENT-XXX
```

Bộ mã sự kiện chuẩn kích hoạt thông báo (xem mục 20.2). Mỗi module phát sự kiện ánh xạ `event_code` nội bộ về mã chuẩn này (xem SPEC-08 §15.0).

### 9.9 Mã widget dashboard

Cấu trúc:

```text
MODULE-WIDGET-XXX
```

Ví dụ: `DASH-WIDGET-001` (xem SPEC-07).

### 9.10 Mã danh mục thông báo theo module

Cấu trúc:

```text
MODULE-NOTI-XXX
```

Ví dụ: `HR-NOTI-001`, `TASK-NOTI-001` — danh mục sự kiện thông báo cục bộ của module, ánh xạ về `NOTI-EVENT` khi thuộc bộ chuẩn.

---

## 10. Nhóm người dùng hệ thống

### 10.1 Super Admin

Super Admin là người có toàn quyền cao nhất trên toàn bộ hệ thống.

Quyền chính:

* Quản lý toàn bộ công ty trên hệ thống.
* Quản lý tenant nếu triển khai SaaS.
* Quản lý cấu hình hệ thống.
* Quản lý toàn bộ tài khoản.
* Quản lý vai trò và quyền.
* Truy cập toàn bộ module.
* Xem toàn bộ log hệ thống.

### 10.2 Admin công ty

Admin công ty là người quản trị hệ thống ở cấp doanh nghiệp.

Quyền chính:

* Cấu hình thông tin công ty.
* Quản lý tài khoản người dùng trong công ty.
* Gán vai trò cho người dùng.
* Quản lý phòng ban cơ bản.
* Xem dashboard quản trị công ty.
* Không nhất thiết được xem dữ liệu lương nếu không được cấp quyền riêng.

### 10.3 HR

HR là người phụ trách nghiệp vụ nhân sự.

Quyền chính:

* Quản lý hồ sơ nhân viên.
* Quản lý phòng ban, chức vụ.
* Quản lý hợp đồng.
* Quản lý chấm công.
* Quản lý nghỉ phép.
* Xem báo cáo nhân sự.
* Xuất dữ liệu nhân sự nếu có quyền.

### 10.4 Manager

Manager là người quản lý phòng ban hoặc nhóm làm việc.

Quyền chính:

* Xem nhân viên thuộc phạm vi quản lý.
* Duyệt hoặc từ chối đơn nghỉ phép.
* Xem bảng công nhân viên thuộc team.
* Tạo dự án hoặc task nếu được cấp quyền.
* Giao việc cho thành viên.
* Theo dõi tiến độ công việc.
* Xem dashboard quản lý.

### 10.5 Employee

Employee là nhân viên sử dụng hệ thống hằng ngày.

Quyền chính:

* Xem hồ sơ cá nhân.
* Cập nhật một số thông tin cá nhân nếu được cho phép.
* Check-in/check-out.
* Xem bảng công cá nhân.
* Gửi đơn nghỉ phép.
* Xem số ngày phép còn lại.
* Xem task được giao.
* Cập nhật trạng thái task.
* Nhận thông báo hệ thống.

### 10.6 Payroll Officer

Payroll Officer là người phụ trách tiền lương.

Quyền chính:

* Xem dữ liệu lương.
* Cấu hình kỳ lương.
* Tạo bảng lương.
* Kiểm tra bảng lương.
* Xuất phiếu lương.
* Khóa kỳ lương.

Vai trò này thuộc giai đoạn sau MVP.

### 10.7 Recruiter

Recruiter là người phụ trách tuyển dụng.

Quyền chính:

* Tạo vị trí tuyển dụng.
* Quản lý ứng viên.
* Cập nhật pipeline tuyển dụng.
* Tạo lịch phỏng vấn.
* Gửi offer.
* Chuyển ứng viên trúng tuyển thành nhân viên.

Vai trò này thuộc giai đoạn sau MVP.

### 10.8 Asset Manager

Asset Manager là người phụ trách tài sản công ty.

Quyền chính:

* Quản lý danh sách tài sản.
* Cấp phát tài sản.
* Thu hồi tài sản.
* Theo dõi bảo trì.
* Kiểm kê tài sản.

Vai trò này thuộc giai đoạn sau MVP.

### 10.9 Office Admin

Office Admin là người phụ trách hành chính văn phòng.

Quyền chính:

* Quản lý phòng họp.
* Duyệt hoặc quản lý lịch đặt phòng nếu cần.
* Quản lý thiết bị văn phòng.
* Theo dõi sử dụng phòng họp.

Vai trò này thuộc giai đoạn sau MVP.

### 10.10 Vai trò cấp dự án (project-level)

Ngoài các vai trò hệ thống ở trên, module TASK (SPEC-06) dùng các **vai trò cấp dự án** như `Project Owner` / `Project Manager`, `Project Member`, `Watcher`. Đây **không phải vai trò hệ thống** và không thay thế permission RBAC; chúng chỉ xác định phạm vi quyền trong từng dự án. DASH (SPEC-07) và NOTI (SPEC-08) tham chiếu các vai trò này khi hiển thị hoặc gửi thông báo theo dự án.

---

## 11. Nguyên tắc phân quyền tổng quan

### 11.1 Phân quyền theo vai trò

Hệ thống sử dụng cơ chế Role-Based Access Control.

Mỗi người dùng có thể có một hoặc nhiều vai trò.

Ví dụ:

* Một người có thể vừa là Employee vừa là Manager.
* Một người có thể vừa là HR vừa là Payroll Officer.
* Một người có thể vừa là Admin công ty vừa là HR.

### 11.2 Phân quyền theo phạm vi dữ liệu

Ngoài vai trò, hệ thống cần hỗ trợ phạm vi dữ liệu.

Các phạm vi dữ liệu gồm:

| Phạm vi    | Ý nghĩa                                 |
| ---------- | --------------------------------------- |
| Own        | Chỉ dữ liệu của chính mình              |
| Team       | Dữ liệu của team/phòng ban mình quản lý |
| Department | Dữ liệu trong phòng ban                 |
| Company    | Dữ liệu toàn công ty                    |
| System     | Dữ liệu toàn hệ thống                   |

> **Mở rộng:** Module TASK (SPEC-06) bổ sung phạm vi `Project` — dữ liệu trong phạm vi một dự án (theo thành viên dự án), chỉ áp dụng cho TASK.

Ví dụ:

* Employee xem bảng công của chính mình.
* Manager xem bảng công của nhân viên trong team.
* HR xem bảng công toàn công ty.
* Super Admin xem toàn bộ dữ liệu.

### 11.3 Nguyên tắc bảo mật dữ liệu nhạy cảm

Các dữ liệu sau được xem là nhạy cảm:

* Lương
* Tài khoản ngân hàng
* CCCD/CMND
* Hợp đồng lao động
* Hồ sơ nhân sự
* Dữ liệu kỷ luật
* Dữ liệu nghỉ việc
* Dữ liệu chấm công chi tiết
* Dữ liệu đánh giá ứng viên
* Log hệ thống

Nguyên tắc:

1. Không hiển thị dữ liệu nhạy cảm nếu người dùng không có quyền.
2. Không cho xuất dữ liệu nhạy cảm nếu không có quyền export.
3. Mọi thao tác xem, sửa, xuất dữ liệu nhạy cảm cần được ghi log.
4. Dữ liệu lương phải được tách quyền riêng, không mặc định cho HR nếu doanh nghiệp yêu cầu kiểm soát chặt.

### 11.4 Quy ước nguồn sự thật (single source of truth)

Khi các tài liệu thiết kế (SPEC/DB/API/BE/FE) mâu thuẫn nhau về cùng một giá trị, áp dụng thứ tự thẩm quyền sau:

| Loại giá trị | Nguồn sự thật |
| --- | --- |
| Giá trị enum lưu trữ (status, type...) | **DB CHECK constraint** (DB-02 → DB-10). DTO/API/FE phải khớp; chỉ mở rộng CHECK khi được liệt kê tường minh. |
| Đường dẫn endpoint / HTTP method | **API Design (API-02 → API-09) + BACKEND-12** (contract). |
| Mã quyền (permission code) | **API-10 Permission Matrix** (catalog duy nhất), seed tại **DB-10**. |
| Mã sự kiện thông báo (event code) | **Registry NOTI** (SPEC-08 §15.3 + DB-07 seed), convention `UPPER_SNAKE`. |

Tài liệu nào đang lệch so với nguồn tương ứng phải sửa về đúng nguồn, không tự đặt giá trị mới.

---

## 12. Module tổng quan

### 12.1 AUTH — Tài khoản, đăng nhập & phân quyền

Tài liệu chi tiết: SPEC-02

Mục tiêu:

Quản lý xác thực người dùng, tài khoản đăng nhập, vai trò, quyền truy cập và bảo mật hệ thống.

Chức năng chính:

* Đăng nhập
* Đăng xuất
* Quên mật khẩu
* Đổi mật khẩu
* Quản lý người dùng
* Quản lý vai trò
* Quản lý quyền
* Gán vai trò cho người dùng
* Khóa/mở tài khoản
* Quản lý phiên đăng nhập

Module liên quan:

* HR: tài khoản có thể liên kết với hồ sơ nhân viên.
* NOTI: gửi thông báo khi tài khoản được tạo hoặc reset mật khẩu.
* DASH: điều hướng dashboard theo vai trò.

---

### 12.2 HR — Quản lý nhân sự

Tài liệu chi tiết: SPEC-03

Mục tiêu:

Quản lý toàn bộ hồ sơ nhân viên, phòng ban, chức vụ, hợp đồng và trạng thái làm việc.

Chức năng chính:

* Danh sách nhân viên
* Thêm nhân viên
* Xem chi tiết nhân viên
* Cập nhật hồ sơ nhân viên
* Quản lý phòng ban
* Quản lý chức vụ
* Quản lý hợp đồng
* Quản lý trạng thái nhân viên
* File hồ sơ nhân viên
* Lịch sử thay đổi hồ sơ

Module liên quan:

* AUTH: tạo tài khoản đăng nhập cho nhân viên.
* ATT: nhân viên dùng để chấm công.
* LEAVE: nhân viên dùng để gửi đơn nghỉ phép.
* TASK: nhân viên được gán task.
* PAYROLL: dữ liệu nhân viên dùng để tính lương.
* RECRUIT: ứng viên trúng tuyển chuyển thành nhân viên.

---

### 12.3 ATT — Chấm công

Tài liệu chi tiết: SPEC-04

Mục tiêu:

Ghi nhận thời gian làm việc của nhân viên thông qua check-in, check-out, ca làm và bảng công.

Chức năng chính:

* Check-in
* Check-out
* Xem bảng công cá nhân
* Xem bảng công phòng ban
* Xem bảng công toàn công ty
* Quản lý ca làm
* Cấu hình ngày làm việc
* Điều chỉnh công
* Duyệt điều chỉnh công
* Xuất bảng công

Module liên quan:

* HR: lấy danh sách nhân viên.
* LEAVE: đồng bộ ngày nghỉ phép.
* PAYROLL: dùng dữ liệu công để tính lương.
* NOTI: gửi thông báo khi điều chỉnh công được duyệt hoặc từ chối.

---

### 12.4 LEAVE — Nghỉ phép

Tài liệu chi tiết: SPEC-05

Mục tiêu:

Quản lý quy trình gửi, duyệt, từ chối và theo dõi đơn nghỉ phép của nhân viên.

Chức năng chính:

* Tạo đơn nghỉ phép
* Chọn loại nghỉ
* Tính số ngày nghỉ
* Duyệt đơn nghỉ phép
* Từ chối đơn nghỉ phép
* Hủy đơn nghỉ phép
* Theo dõi số ngày phép còn lại
* Lịch nghỉ của team
* Lịch nghỉ toàn công ty

Module liên quan:

* HR: lấy thông tin nhân viên và phòng ban.
* ATT: cập nhật bảng công theo ngày nghỉ.
* NOTI: thông báo khi có đơn cần duyệt hoặc kết quả duyệt.
* DASH: hiển thị đơn chờ duyệt và lịch nghỉ.

---

### 12.5 TASK — Công việc & dự án

Tài liệu chi tiết: SPEC-06

Mục tiêu:

Quản lý dự án, công việc, người phụ trách, deadline, trạng thái, bình luận và file đính kèm.

Chức năng chính:

* Tạo dự án
* Cập nhật dự án
* Thêm thành viên dự án
* Tạo task
* Giao task
* Cập nhật trạng thái task
* Bình luận trong task
* Gắn file vào task
* Kanban board
* Việc của tôi
* Task quá hạn

Module liên quan:

* HR: lấy danh sách nhân viên.
* NOTI: gửi thông báo khi có task mới, comment mới, task sắp quá hạn.
* DASH: hiển thị task hôm nay, task quá hạn, tiến độ dự án.

---

### 12.6 DASH — Dashboard

Tài liệu chi tiết: SPEC-07

Mục tiêu:

Hiển thị thông tin tổng quan theo từng vai trò để người dùng nhanh chóng nắm được việc cần làm và dữ liệu quan trọng.

Chức năng chính:

* Dashboard nhân viên
* Dashboard HR
* Dashboard Manager
* Dashboard Admin
* Widget chấm công hôm nay
* Widget task hôm nay
* Widget đơn nghỉ chờ duyệt
* Widget nhân sự mới
* Widget hợp đồng sắp hết hạn
* Widget thông báo mới

Module liên quan:

* HR: dữ liệu nhân viên.
* ATT: dữ liệu chấm công.
* LEAVE: dữ liệu nghỉ phép.
* TASK: dữ liệu công việc.
* NOTI: dữ liệu thông báo.

---

### 12.7 NOTI — Thông báo hệ thống

Tài liệu chi tiết: SPEC-08

Mục tiêu:

Gửi thông báo cho người dùng khi có sự kiện quan trọng trong hệ thống.

Chức năng chính:

* Thông báo in-app
* Đánh dấu đã đọc
* Danh sách thông báo
* Thông báo task mới
* Thông báo comment mới
* Thông báo đơn nghỉ cần duyệt
* Thông báo kết quả duyệt nghỉ
* Thông báo hợp đồng sắp hết hạn
* Cấu hình loại thông báo

Module liên quan:

* AUTH: thông báo tài khoản.
* HR: thông báo hợp đồng, thay đổi hồ sơ.
* ATT: thông báo điều chỉnh công.
* LEAVE: thông báo đơn nghỉ.
* TASK: thông báo task.
* DASH: hiển thị số lượng thông báo chưa đọc.

---

### 12.8 PAYROLL — Tiền lương

Tài liệu chi tiết: SPEC-09

Giai đoạn: Phase 2

Mục tiêu:

Tính lương dựa trên dữ liệu nhân sự, chấm công, nghỉ phép, phụ cấp, thưởng, phạt và khấu trừ.

Chức năng chính:

* Cấu hình kỳ lương
* Lương cơ bản
* Phụ cấp
* Thưởng/phạt
* Khấu trừ
* Tạo bảng lương
* Duyệt bảng lương
* Phiếu lương
* Xuất Excel/PDF

Module liên quan:

* HR: hồ sơ nhân viên, lương cơ bản, tài khoản ngân hàng.
* ATT: dữ liệu ngày công.
* LEAVE: dữ liệu nghỉ phép.
* NOTI: thông báo phiếu lương.

---

### 12.9 RECRUIT — Tuyển dụng

Tài liệu chi tiết: SPEC-10

Giai đoạn: Phase 2

Mục tiêu:

Quản lý quy trình tuyển dụng từ vị trí tuyển dụng, ứng viên, phỏng vấn đến khi ứng viên trở thành nhân viên.

Chức năng chính:

* Vị trí tuyển dụng
* Hồ sơ ứng viên
* Pipeline tuyển dụng
* Lịch phỏng vấn
* Đánh giá ứng viên
* Gửi offer
* Chuyển ứng viên thành nhân viên

Module liên quan:

* HR: ứng viên trúng tuyển tạo thành nhân viên.
* NOTI: thông báo lịch phỏng vấn.
* DASH: báo cáo tuyển dụng.

---

### 12.10 ASSET — Quản lý tài sản

Tài liệu chi tiết: SPEC-11

Giai đoạn: Phase 3

Mục tiêu:

Quản lý tài sản công ty, quá trình cấp phát, thu hồi, bảo trì và kiểm kê.

Chức năng chính:

* Danh sách tài sản
* Loại tài sản
* Mã tài sản
* QR code tài sản
* Cấp phát tài sản
* Thu hồi tài sản
* Bảo trì tài sản
* Kiểm kê tài sản
* Thanh lý tài sản

Module liên quan:

* HR: liên kết tài sản với nhân viên sử dụng.
* NOTI: thông báo cấp phát, thu hồi, bảo trì.
* DASH: thống kê tài sản.

---

### 12.11 ROOM — Quản lý phòng họp

Tài liệu chi tiết: SPEC-12

Giai đoạn: Phase 3

Mục tiêu:

Quản lý danh sách phòng họp, lịch đặt phòng, thiết bị phòng họp và kiểm tra trùng lịch.

Chức năng chính:

* Danh sách phòng họp
* Thông tin sức chứa
* Thiết bị trong phòng
* Đặt lịch phòng
* Kiểm tra trùng lịch
* Hủy lịch đặt phòng
* Lịch sử sử dụng phòng

Module liên quan:

* HR: người đặt phòng là nhân viên trong hệ thống.
* NOTI: thông báo lịch họp.
* DASH: hiển thị lịch họp hôm nay.

---

### 12.12 CHAT — Chat nội bộ

Tài liệu chi tiết: SPEC-13

Giai đoạn: Phase 4

Mục tiêu:

Cung cấp công cụ trao đổi nội bộ giữa nhân viên, nhóm, phòng ban và dự án.

Chức năng chính:

* Chat 1-1
* Chat nhóm
* Chat theo phòng ban
* Chat theo dự án
* Gửi file
* Gửi hình ảnh
* Đã xem tin nhắn
* Tìm kiếm tin nhắn
* Realtime message

Module liên quan:

* HR: danh sách nhân viên.
* TASK: chat theo dự án hoặc task.
* NOTI: thông báo tin nhắn mới.

---

### 12.13 SOCIAL — Mạng xã hội nội bộ

Tài liệu chi tiết: SPEC-14

Giai đoạn: Phase 4

Mục tiêu:

Tạo không gian chia sẻ, truyền thông và gắn kết văn hóa nội bộ trong công ty.

Chức năng chính:

* Đăng bài
* Like
* Comment
* Gắn thẻ nhân viên
* Hashtag
* Thông báo công ty
* Chúc mừng sinh nhật
* Vinh danh nhân viên
* Khảo sát nội bộ

Module liên quan:

* HR: dữ liệu nhân viên, sinh nhật, nhân viên mới.
* NOTI: thông báo bài viết, tag, comment.
* DASH: hiển thị tin nội bộ mới.

---

## 13. Luồng nghiệp vụ tổng quan toàn hệ thống

### 13.1 Luồng nhân viên mới

```text
HR tạo hồ sơ nhân viên
→ Hệ thống lưu thông tin nhân viên
→ Admin hoặc HR tạo tài khoản đăng nhập
→ Hệ thống gửi thông báo tài khoản
→ Nhân viên đăng nhập
→ Nhân viên cập nhật hồ sơ cá nhân nếu được phép
→ Nhân viên có thể chấm công, xin nghỉ, nhận task
```

Module liên quan:

* HR
* AUTH
* NOTI
* ATT
* LEAVE
* TASK

---

### 13.2 Luồng chấm công

```text
Nhân viên đăng nhập
→ Vào màn hình chấm công
→ Bấm Check-in
→ Hệ thống ghi nhận thời gian vào làm
→ Cuối ngày nhân viên bấm Check-out
→ Hệ thống ghi nhận thời gian ra về
→ Dữ liệu hiển thị trong bảng công cá nhân
→ HR/Manager có thể xem bảng công theo quyền
```

Module liên quan:

* AUTH
* ATT
* HR
* DASH

---

### 13.3 Luồng nghỉ phép

```text
Nhân viên tạo đơn nghỉ phép
→ Hệ thống kiểm tra số ngày phép còn lại
→ Đơn được gửi đến Manager hoặc HR
→ Người duyệt nhận thông báo
→ Người duyệt duyệt hoặc từ chối
→ Nhân viên nhận kết quả
→ Nếu được duyệt, dữ liệu nghỉ phép được đồng bộ sang bảng công
```

Module liên quan:

* LEAVE
* HR
* ATT
* NOTI
* DASH

---

### 13.4 Luồng giao việc

```text
Manager tạo dự án
→ Thêm thành viên vào dự án
→ Tạo task
→ Giao task cho nhân viên
→ Nhân viên nhận thông báo
→ Nhân viên cập nhật trạng thái task
→ Manager theo dõi tiến độ
→ Task hoàn thành
```

Module liên quan:

* TASK
* HR
* NOTI
* DASH

---

### 13.5 Luồng dashboard

```text
Người dùng đăng nhập
→ Hệ thống xác định vai trò và quyền
→ Hệ thống lấy dữ liệu phù hợp
→ Dashboard hiển thị widget tương ứng
→ Người dùng nhấn vào widget để đi đến module chi tiết
```

Module liên quan:

* AUTH
* HR
* ATT
* LEAVE
* TASK
* NOTI
* DASH

---

## 14. Cấu trúc menu tổng quan

### 14.1 Menu MVP

Menu phiên bản MVP gồm:

```text
Dashboard
Nhân sự
Chấm công
Nghỉ phép
Dự án & Công việc
Thông báo
Cài đặt
```

### 14.2 Menu phiên bản đầy đủ

Menu phiên bản đầy đủ gồm:

```text
Dashboard

Nhân sự
- Danh sách nhân viên
- Phòng ban
- Chức vụ
- Hợp đồng
- Hồ sơ nghỉ việc

Chấm công
- Check-in / Check-out
- Bảng công cá nhân
- Bảng công công ty
- Ca làm việc
- Điều chỉnh công

Nghỉ phép
- Tạo đơn nghỉ
- Đơn của tôi
- Đơn chờ duyệt
- Lịch nghỉ
- Cấu hình ngày phép

Dự án & Công việc
- Dự án
- Việc của tôi
- Kanban
- Task quá hạn
- Báo cáo tiến độ

Tiền lương
- Kỳ lương
- Bảng lương
- Phiếu lương
- Phụ cấp / khấu trừ

Tuyển dụng
- Vị trí tuyển dụng
- Ứng viên
- Pipeline
- Lịch phỏng vấn

Tài sản
- Danh sách tài sản
- Cấp phát
- Thu hồi
- Bảo trì
- Kiểm kê

Phòng họp
- Danh sách phòng
- Lịch đặt phòng
- Đặt phòng

Chat

Mạng xã hội nội bộ

Thông báo

Báo cáo

Cài đặt
- Công ty
- Người dùng
- Vai trò
- Phân quyền
- Cấu hình hệ thống
```

---

## 15. Dashboard tổng quan theo vai trò

### 15.1 Dashboard Employee

Hiển thị:

* Trạng thái check-in hôm nay
* Giờ vào làm
* Giờ ra về
* Việc cần làm hôm nay
* Task quá hạn
* Đơn nghỉ phép gần nhất
* Số ngày phép còn lại
* Thông báo mới

Liên kết module:

* ATT
* LEAVE
* TASK
* NOTI

---

### 15.2 Dashboard Manager

Hiển thị:

* Nhân viên trong team
* Đơn nghỉ phép chờ duyệt
* Lịch nghỉ của team
* Task quá hạn của team
* Dự án đang chạy
* Tiến độ công việc
* Bảng công bất thường

Liên kết module:

* HR
* ATT
* LEAVE
* TASK
* NOTI

---

### 15.3 Dashboard HR

Hiển thị:

* Tổng số nhân viên
* Nhân viên mới trong tháng
* Nhân viên nghỉ việc trong tháng
* Hợp đồng sắp hết hạn
* Đơn nghỉ chờ xử lý
* Bảng công bất thường
* Sinh nhật nhân viên
* Hồ sơ cần cập nhật

Liên kết module:

* HR
* ATT
* LEAVE
* NOTI

---

### 15.4 Dashboard Admin

Hiển thị:

* Tổng số người dùng
* Tài khoản đang hoạt động
* Tài khoản bị khóa
* Số vai trò hệ thống
* Số module đang kích hoạt
* Log hoạt động gần đây
* Cấu hình công ty

Liên kết module:

* AUTH
* HR
* NOTI
* DASH

---

## 16. Nguyên tắc dữ liệu tổng quan

### 16.1 Định danh dữ liệu

Tất cả bản ghi chính trong hệ thống nên có định danh duy nhất.

Các bảng dữ liệu chính cần có trường:

| Trường     | Ý nghĩa                  |
| ---------- | ------------------------ |
| id         | Mã định danh duy nhất    |
| created_at | Thời gian tạo            |
| updated_at | Thời gian cập nhật       |
| created_by | Người tạo                |
| updated_by | Người cập nhật           |
| deleted_at | Thời gian xóa mềm nếu có |
| status     | Trạng thái bản ghi       |

### 16.2 Xóa mềm

Các dữ liệu quan trọng không nên xóa vĩnh viễn ngay.

Áp dụng xóa mềm cho:

* Nhân viên
* Phòng ban
* Chức vụ
* Hợp đồng
* Task
* Dự án
* Đơn nghỉ
* Tài sản
* Phòng họp
* Ứng viên

### 16.3 Nhật ký hoạt động

Hệ thống cần ghi log các hành động quan trọng:

* Đăng nhập
* Đăng nhập thất bại
* Tạo dữ liệu
* Cập nhật dữ liệu
* Xóa dữ liệu
* Khóa/mở tài khoản
* Duyệt yêu cầu
* Từ chối yêu cầu
* Xuất dữ liệu
* Thay đổi phân quyền
* Xem dữ liệu nhạy cảm nếu cần

Thông tin log cần lưu:

| Trường      | Mô tả                      |
| ----------- | -------------------------- |
| actor_id    | Người thực hiện            |
| action      | Hành động                  |
| module      | Module liên quan           |
| target_type | Loại dữ liệu bị tác động   |
| target_id   | ID dữ liệu bị tác động     |
| old_value   | Dữ liệu trước khi thay đổi |
| new_value   | Dữ liệu sau khi thay đổi   |
| ip_address  | IP người dùng              |
| user_agent  | Thiết bị/trình duyệt       |
| created_at  | Thời gian thao tác         |

---

## 17. Quy tắc trạng thái tổng quan

### 17.1 Trạng thái tài khoản

```text
Active
Inactive
Locked
Pending Activation
```

### 17.2 Trạng thái nhân viên

```text
Probation
Official
Temporarily Suspended
Resigned
Terminated
```

### 17.3 Trạng thái đơn nghỉ phép

```text
Draft
Pending
Approved
Rejected
Cancelled
```

### 17.4 Trạng thái task

```text
Todo
In Progress
In Review
Done
Cancelled
Overdue
```

### 17.5 Trạng thái dự án

```text
Planning
Active
On Hold
Completed
Cancelled
```

### 17.6 Trạng thái thông báo

```text
Unread
Read
Archived
```

### 17.7 Giá trị trạng thái mở rộng đã hợp thức

Các module được phép dùng thêm các giá trị dưới đây (đã hợp thức tại SPEC-01). Module **không** được thêm giá trị ngoài mục 17 mà không cập nhật tài liệu này.

* **Trạng thái tài khoản (SPEC-02):** không thêm status mới; tài khoản bị xóa dùng xóa mềm qua `deleted_at`.
* **Trạng thái nhân viên (SPEC-03):** thêm `Onboarding` (tùy chọn, trước `Probation`).
* **Trạng thái đơn nghỉ phép (SPEC-05):** thêm `Revoked` (thu hồi đơn đã duyệt).
* **Trạng thái task (SPEC-06):** `Overdue` (mục 17.4) là giá trị **dẫn xuất** tính từ deadline, không lưu cứng.
* **Trạng thái dự án (SPEC-06):** thêm `Archived` (lưu trữ dự án).
* **Trạng thái thông báo (SPEC-08):** thêm `Hidden` (người dùng ẩn), `Deleted` (xóa mềm), `Failed` (gửi thất bại).

---

## 18. Nguyên tắc UI/UX tổng quan

### 18.1 Nguyên tắc giao diện

Giao diện cần tuân thủ các nguyên tắc:

1. Rõ ràng, dễ hiểu, không quá nhiều thông tin trên một màn hình.
2. Các thao tác chính phải dễ nhìn và dễ truy cập.
3. Các màn hình danh sách cần có tìm kiếm, lọc và phân trang.
4. Form nhập liệu cần có kiểm tra dữ liệu rõ ràng.
5. Thông báo lỗi cần dễ hiểu và có hướng dẫn sửa.
6. Hành động nguy hiểm như xóa, khóa, hủy cần có modal xác nhận.
7. Dữ liệu nhạy cảm cần được ẩn hoặc chỉ hiển thị khi có quyền.
8. Giao diện cần responsive để dùng tốt trên desktop và tablet.

### 18.2 Layout tổng quan

Cấu trúc layout web app:

```text
Sidebar bên trái
Header phía trên
Khu vực nội dung chính
Khu vực thông báo
Menu tài khoản người dùng
```

### 18.3 Thành phần dùng chung

Các component dùng chung:

* Button
* Input
* Select
* Date Picker
* Table
* Filter
* Search Box
* Modal
* Drawer
* Tabs
* Badge
* Status Label
* Toast Message
* Pagination
* File Upload
* Avatar
* Notification Dropdown
* Confirmation Dialog

### 18.4 Quy tắc form

Mỗi form cần có:

* Label rõ ràng
* Placeholder nếu cần
* Trường bắt buộc đánh dấu rõ
* Validate trước khi submit
* Thông báo lỗi ngay dưới trường sai
* Nút Lưu
* Nút Hủy
* Loading state khi đang lưu
* Disable nút submit khi dữ liệu chưa hợp lệ nếu cần

---

## 19. Nguyên tắc API tổng quan

### 19.1 Định dạng endpoint

Endpoint nên dùng dạng RESTful.

Ví dụ:

```text
GET /api/employees
GET /api/employees/{id}
POST /api/employees
PUT /api/employees/{id}
DELETE /api/employees/{id}
```

### 19.2 Định dạng response thành công

```json
{
  "success": true,
  "data": {},
  "message": "Success"
}
```

### 19.3 Định dạng response lỗi

```json
{
  "success": false,
  "error": {
    "code": "HR-ERR-001",
    "message": "Email nhân viên đã tồn tại"
  }
}
```

### 19.4 Phân trang

Các API danh sách cần hỗ trợ phân trang.

```text
page
limit
sort_by
sort_order
keyword
filters
```

Response danh sách:

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "total_pages": 5
  }
}
```

### 19.5 Quy tắc bảo vệ API

Mọi API nội bộ cần kiểm tra:

1. Người dùng đã đăng nhập hay chưa.
2. Token có hợp lệ hay không.
3. Người dùng có quyền truy cập API hay không.
4. Người dùng có quyền với phạm vi dữ liệu hay không.
5. Dữ liệu đầu vào có hợp lệ hay không.

---

## 20. Nguyên tắc thông báo tổng quan

### 20.1 Kênh thông báo

Hệ thống cần hỗ trợ các kênh sau:

| Kênh                | Áp dụng               |
| ------------------- | --------------------- |
| In-app notification | Bắt buộc trong MVP    |
| Email notification  | Có thể triển khai sau |
| Push notification   | Khi có mobile app     |
| Chat notification   | Khi có module chat    |

### 20.2 Sự kiện cần gửi thông báo trong MVP

| Mã sự kiện     | Sự kiện                   | Người nhận               |
| -------------- | ------------------------- | ------------------------ |
| NOTI-EVENT-001 | Tài khoản được tạo        | Nhân viên                |
| NOTI-EVENT-002 | Có task mới               | Người được giao          |
| NOTI-EVENT-003 | Có comment mới trong task | Người liên quan          |
| NOTI-EVENT-004 | Task sắp đến hạn          | Người phụ trách          |
| NOTI-EVENT-005 | Task quá hạn              | Người phụ trách, Manager |
| NOTI-EVENT-006 | Có đơn nghỉ phép mới      | Manager/HR               |
| NOTI-EVENT-007 | Đơn nghỉ được duyệt       | Người tạo đơn            |
| NOTI-EVENT-008 | Đơn nghỉ bị từ chối       | Người tạo đơn            |
| NOTI-EVENT-009 | Hợp đồng sắp hết hạn      | HR                       |

---

## 21. Báo cáo tổng quan

### 21.1 Báo cáo trong MVP

Các báo cáo cơ bản cần có trong MVP:

| Báo cáo              | Module | Người xem         |
| -------------------- | ------ | ----------------- |
| Danh sách nhân viên  | HR     | HR/Admin          |
| Bảng công tháng      | ATT    | HR/Manager        |
| Danh sách đơn nghỉ   | LEAVE  | HR/Manager        |
| Task quá hạn         | TASK   | Manager/Admin     |
| Dự án đang hoạt động | TASK   | Manager/Admin     |
| Log hoạt động        | AUTH   | Admin/Super Admin |

### 21.2 Báo cáo sau MVP

Các báo cáo sẽ triển khai ở giai đoạn sau:

* Báo cáo chi phí lương
* Báo cáo tuyển dụng
* Báo cáo tài sản
* Báo cáo sử dụng phòng họp
* Báo cáo hiệu suất nhân viên
* Báo cáo tương tác nội bộ
* Báo cáo AI phân tích rủi ro công việc

---

## 22. Yêu cầu bảo mật tổng quan

Hệ thống cần đảm bảo các yêu cầu bảo mật sau:

1. Mật khẩu phải được mã hóa, không lưu plain text.
2. API cần xác thực bằng token/session hợp lệ.
3. Phân quyền phải được kiểm tra ở backend, không chỉ ở frontend.
4. Dữ liệu nhạy cảm chỉ hiển thị cho người có quyền.
5. Tài khoản bị khóa không được đăng nhập.
6. Hệ thống cần chống thao tác trái quyền.
7. Các thao tác quan trọng phải ghi log.
8. File upload cần kiểm tra định dạng và dung lượng.
9. Không cho tải file nhạy cảm nếu không có quyền.
10. Cần giới hạn số lần đăng nhập sai nếu triển khai bảo mật nâng cao.

---

## 23. Yêu cầu hiệu năng tổng quan

### 23.1 Yêu cầu hiệu năng MVP

Hệ thống cần đáp ứng:

* Trang danh sách tải trong thời gian chấp nhận được.
* Danh sách cần có phân trang.
* Tìm kiếm và lọc không làm treo giao diện.
* Dashboard chỉ tải dữ liệu cần thiết theo vai trò.
* API danh sách không trả toàn bộ dữ liệu quá lớn trong một lần.
* File upload cần có giới hạn dung lượng.

### 23.2 Dữ liệu dự kiến ban đầu

Trong MVP, hệ thống cần hoạt động tốt với quy mô:

| Loại dữ liệu      | Quy mô dự kiến     |
| ----------------- | ------------------ |
| Nhân viên         | 50 - 1.000         |
| User              | 50 - 1.000         |
| Task              | 1.000 - 50.000     |
| Bản ghi chấm công | 10.000 - 500.000   |
| Đơn nghỉ phép     | 1.000 - 50.000     |
| Thông báo         | 10.000 - 1.000.000 |

---

## 24. Yêu cầu mở rộng

Hệ thống cần thiết kế để sau này có thể mở rộng:

1. Nhiều công ty trên cùng hệ thống.
2. Nhiều chi nhánh trong một công ty.
3. Nhiều phòng ban và cấp quản lý.
4. Nhiều loại ca làm việc.
5. Nhiều chính sách nghỉ phép.
6. Nhiều công thức lương.
7. Nhiều workflow phê duyệt.
8. Mobile app.
9. Chat realtime.
10. AI assistant.
11. Tích hợp máy chấm công.
12. Tích hợp email/lịch.
13. Tích hợp kế toán.
14. Xuất báo cáo nâng cao.

---

## 25. Mô hình triển khai theo giai đoạn

### Phase 0 — Phân tích & thiết kế

Mục tiêu:

* Viết spec tổng quan.
* Viết spec module MVP.
* Thiết kế wireframe.
* Thiết kế database sơ bộ.
* Thiết kế API sơ bộ.
* Xác định roadmap.

Tài liệu liên quan:

* SPEC-01 đến SPEC-08

---

### Phase 1 — MVP Core

Module:

* AUTH
* HR
* ATT
* LEAVE
* TASK
* DASH
* NOTI

Kết quả:

* Người dùng đăng nhập được.
* HR quản lý được nhân viên.
* Nhân viên chấm công được.
* Nhân viên gửi đơn nghỉ được.
* Manager duyệt đơn nghỉ được.
* Team tạo và giao task được.
* Dashboard hiển thị dữ liệu theo vai trò.
* Thông báo hoạt động ở các luồng chính.

---

### Phase 2 — HR nâng cao

Module:

* PAYROLL
* RECRUIT

Kết quả:

* Tính lương cơ bản.
* Quản lý bảng lương.
* Xuất phiếu lương.
* Quản lý vị trí tuyển dụng.
* Quản lý ứng viên.
* Chuyển ứng viên thành nhân viên.

---

### Phase 3 — Quản trị văn phòng

Module:

* ASSET
* ROOM

Kết quả:

* Quản lý tài sản.
* Cấp phát và thu hồi tài sản.
* Đặt phòng họp.
* Kiểm tra trùng lịch phòng.

---

### Phase 4 — Giao tiếp nội bộ

Module:

* CHAT
* SOCIAL

Kết quả:

* Chat nội bộ.
* Chat nhóm.
* Đăng bài nội bộ.
* Like/comment.
* Truyền thông nội bộ.

---

### Phase 5 — Mobile, AI & tích hợp

Module:

* MOBILE
* AI
* INTEGRATION

Kết quả:

* App mobile.
* Push notification.
* AI tóm tắt công việc.
* AI gợi ý ứng viên.
* Tích hợp máy chấm công.
* Tích hợp lịch/email/kế toán.

---

## 26. Tiêu chí hoàn thành MVP

MVP được xem là hoàn thành khi đáp ứng các tiêu chí sau:

### 26.1 Tài khoản & phân quyền

* Người dùng đăng nhập được.
* Người dùng đăng xuất được.
* Admin tạo được tài khoản.
* Admin gán được vai trò.
* Người dùng chỉ thấy menu đúng quyền.
* API chặn truy cập trái quyền.

### 26.2 Nhân sự

* HR tạo được hồ sơ nhân viên.
* HR cập nhật được hồ sơ nhân viên.
* HR xem được danh sách nhân viên.
* HR quản lý được phòng ban.
* HR quản lý được chức vụ.
* HR quản lý được hợp đồng.
* Employee xem được hồ sơ cá nhân.

### 26.3 Chấm công

* Employee check-in được.
* Employee check-out được.
* Employee xem được bảng công cá nhân.
* Manager xem được bảng công team.
* HR xem được bảng công toàn công ty.
* Hệ thống ghi nhận thời gian chính xác.

### 26.4 Nghỉ phép

* Employee tạo được đơn nghỉ.
* Manager/HR duyệt được đơn nghỉ.
* Manager/HR từ chối được đơn nghỉ.
* Employee xem được trạng thái đơn.
* Đơn nghỉ được duyệt hiển thị trong lịch nghỉ.
* Số ngày phép được cập nhật theo rule.

### 26.5 Công việc & dự án

* Người có quyền tạo được dự án.
* Người có quyền tạo được task.
* Task gán được cho nhân viên.
* Người phụ trách cập nhật được trạng thái task.
* Người liên quan comment được trong task.
* Manager xem được task quá hạn.
* Kanban hiển thị đúng trạng thái task.

### 26.6 Dashboard

* Employee thấy dashboard cá nhân.
* Manager thấy dashboard quản lý.
* HR thấy dashboard nhân sự.
* Admin thấy dashboard quản trị.
* Dữ liệu dashboard liên kết đúng với module nguồn.

### 26.7 Thông báo

* Người dùng nhận thông báo khi có task mới.
* Người duyệt nhận thông báo khi có đơn nghỉ mới.
* Nhân viên nhận thông báo khi đơn nghỉ được duyệt/từ chối.
* Người dùng xem được danh sách thông báo.
* Người dùng đánh dấu đã đọc được.

### 26.8 Chất lượng chung

* Không còn lỗi nghiêm trọng ở luồng chính.
* Giao diện dùng tốt trên desktop.
* Dữ liệu chính được lưu đúng.
* Phân quyền hoạt động đúng.
* Có log cho thao tác quan trọng.
* Tài liệu spec module MVP đã hoàn thành.

---

## 27. Danh sách rủi ro

| Rủi ro                      | Mô tả                                 | Cách xử lý                                    |
| --------------------------- | ------------------------------------- | --------------------------------------------- |
| Scope quá lớn               | Làm quá nhiều module cùng lúc         | Chỉ làm MVP trước                             |
| Phân quyền phức tạp         | Nhiều vai trò, nhiều phạm vi dữ liệu  | Thiết kế RBAC + data scope từ đầu             |
| Công thức lương phức tạp    | Mỗi công ty tính lương khác nhau      | Đưa payroll sang Phase 2                      |
| Chấm công nhiều kiểu        | GPS, QR, Wi-Fi, máy chấm công         | MVP chỉ làm check-in/check-out cơ bản         |
| Chat realtime tốn thời gian | Cần websocket, lưu tin nhắn, realtime | Đưa chat sang Phase 4                         |
| Báo cáo nặng                | Dữ liệu lớn gây chậm dashboard        | Dashboard MVP chỉ hiển thị dữ liệu quan trọng |
| Dữ liệu nhạy cảm            | Lương, CCCD, hợp đồng cần bảo mật     | Tách quyền, ghi log, hạn chế export           |

---

## 28. Các giả định ban đầu

Các giả định để triển khai MVP:

1. Mỗi nhân viên có tối đa một tài khoản đăng nhập chính.
2. Mỗi nhân viên thuộc một phòng ban chính.
3. Một nhân viên có thể có một quản lý trực tiếp.
4. Manager chỉ quản lý nhân viên thuộc phạm vi được gán.
5. MVP chỉ hỗ trợ web app.
6. MVP chưa cần mobile app native.
7. MVP chưa tích hợp máy chấm công vật lý.
8. MVP chưa cần tính lương nâng cao.
9. MVP chưa cần chat realtime.
10. MVP chưa cần mạng xã hội nội bộ.
11. MVP sử dụng notification in-app là chính.
12. File upload chỉ hỗ trợ các định dạng được cấu hình.

---

## 29. Các vấn đề cần xác nhận thêm

Các điểm cần xác nhận trước khi viết spec module chi tiết:

1. Doanh nghiệp có một công ty hay nhiều công ty?
2. Có cần hỗ trợ nhiều chi nhánh không?
3. Cơ cấu phòng ban có nhiều cấp không?
4. Manager duyệt nghỉ theo phòng ban hay theo quản lý trực tiếp?
5. Chấm công MVP dùng web, GPS, QR hay Wi-Fi?
6. Có cần lưu vị trí check-in không?
7. Ngày phép tính theo tháng, theo năm hay nhập thủ công?
8. Nhân viên có được tự cập nhật hồ sơ cá nhân không?
9. HR có được xem lương không hay chỉ Payroll được xem?
10. Công việc quản lý theo dự án hay chỉ task cá nhân?
11. Có cần duyệt task hoàn thành không?
12. File upload lưu ở server nội bộ hay cloud storage?
13. Hệ thống dùng tiếng Việt, tiếng Anh hay đa ngôn ngữ?
14. Có cần phân quyền export dữ liệu riêng không?
15. Có cần audit log cho thao tác xem dữ liệu nhạy cảm không?

---

## 30. Mẫu liên kết từ SPEC-01 sang spec module

Khi một module được nhắc đến trong SPEC-01, cần liên kết sang tài liệu chi tiết theo format:

```text
Xem chi tiết tại: SPEC-XX - Tên module
Module code: MODULE_CODE
Các chức năng liên quan: MODULE-FUNC-XXX
Các màn hình liên quan: MODULE-SCREEN-XXX
Các API liên quan: MODULE-API-XXX
Các quyền liên quan: MODULE.PERMISSION.ACTION
```

Ví dụ:

```text
Module nhân sự được mô tả tổng quan tại SPEC-01, mục 12.2.
Chi tiết nghiệp vụ, màn hình, dữ liệu, API và test case được mô tả tại SPEC-03 - Quản lý nhân sự.
Module code: HR.
Chức năng chính:
- HR-FUNC-001: Xem danh sách nhân viên
- HR-FUNC-002: Thêm nhân viên
- HR-FUNC-003: Cập nhật hồ sơ nhân viên
- HR-FUNC-004: Quản lý phòng ban
- HR-FUNC-005: Quản lý chức vụ
```

---

## 31. Ma trận liên kết module MVP

| Module nguồn | Module phụ thuộc | Mối quan hệ                            |
| ------------ | ---------------- | -------------------------------------- |
| AUTH         | HR               | User có thể liên kết với employee      |
| HR           | ATT              | Nhân viên là đối tượng chấm công       |
| HR           | LEAVE            | Nhân viên là người tạo đơn nghỉ        |
| HR           | TASK             | Nhân viên được gán task                |
| ATT          | LEAVE            | Ngày nghỉ ảnh hưởng bảng công          |
| ATT          | PAYROLL          | Bảng công là dữ liệu tính lương        |
| LEAVE        | NOTI             | Đơn nghỉ tạo thông báo duyệt           |
| TASK         | NOTI             | Task tạo thông báo cho người liên quan |
| HR           | DASH             | Dashboard lấy dữ liệu nhân sự          |
| ATT          | DASH             | Dashboard lấy dữ liệu chấm công        |
| LEAVE        | DASH             | Dashboard lấy dữ liệu nghỉ phép        |
| TASK         | DASH             | Dashboard lấy dữ liệu công việc        |
| NOTI         | DASH             | Dashboard hiển thị thông báo mới       |

---

## 32. Kết luận

SPEC-01 là tài liệu nền tảng của toàn bộ dự án. Tài liệu này không đi quá sâu vào từng màn hình hoặc từng API, mà xác định phạm vi, module, vai trò, nguyên tắc, mối liên kết và tiêu chí hoàn thành tổng thể.

Các tài liệu module chi tiết cần được viết tiếp theo thứ tự:

1. SPEC-02: Tài khoản, đăng nhập & phân quyền
2. SPEC-03: Quản lý nhân sự
3. SPEC-04: Chấm công
4. SPEC-05: Nghỉ phép
5. SPEC-06: Công việc & dự án
6. SPEC-07: Dashboard
7. SPEC-08: Thông báo hệ thống

Sau khi hoàn thành SPEC-01 đến SPEC-08, đội phát triển có thể bắt đầu thiết kế UI, database, API và chia task triển khai MVP.
