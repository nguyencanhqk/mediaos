# SPEC-07: DASHBOARD

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · [SPEC-03 HR](<SPEC-03 HR.md>) · [SPEC-04 ATT](<SPEC-04 ATT.md>) · [SPEC-05 LEAVE](<SPEC-05 LEAVE.md>) · [SPEC-06 TASK](<SPEC-06 TASK.md>) · **SPEC-07 DASH** · [SPEC-08 NOTI](<SPEC-08 NOTI.md>) · [SPEC-09 ME](<SPEC-09 ME.md>) · [SPEC-10 GOAL](<SPEC-10 GOAL.md>)
>
> **Liên quan:** [Thiết kế DB: DB-07 NOTI/DASH](<../DB/DB-07 NOTI DASH Database Design.md>) · [Sản phẩm: PRD-00 §9.6](<../PRD/PRD-00 Enterprise Management System .md>) · [Thiết kế API: API-08 DASH](<../API Design/API-08_DASH_API_Design.md>) · [Chỉ mục tài liệu](<../README.md>)
>
> **Drift reconciliation 22/06 (theo [SPEC-DRIFT-MATRIX](<../_review/SPEC-DRIFT-MATRIX.md>) §6).** SPEC-07 đã đồng bộ về chuẩn DB-07/API-08/BACKEND-10: **DN-7** bổ sung quyền `DASH.CACHE.REFRESH` vào ma trận quyền (§8.2) — seed DB-07 §10.2/API-10 cần lane khác cập nhật · **DN-8** mã lỗi chốt **slug** theo API-08 (§19) · **DN-9** module nguồn widget §14.15–14.19 đổi từ "System config" mơ hồ sang `FOUNDATION`/`AUDIT` (khớp API-08/BACKEND-10). Khi mâu thuẫn, lấy DB-07/API-08 làm chuẩn.

---

## 1. Thông tin tài liệu

| Trường                     | Nội dung                                        |
| -------------------------- | ----------------------------------------------- |
| Mã tài liệu                | SPEC-07                                         |
| Tên tài liệu               | Dashboard                                       |
| Module code                | DASH                                            |
| Tài liệu cha               | SPEC-01: Tổng quan hệ thống                     |
| Module phụ thuộc trực tiếp | AUTH, HR, ATT, LEAVE, TASK, NOTI                |
| Module liên quan           | PAYROLL, RECRUIT, ASSET, ROOM, CHAT, SOCIAL, AI |
| Phiên bản                  | v1.0                                            |
| Trạng thái                 | Draft                                           |
| Giai đoạn                  | MVP Version 1.0                                 |
| Người viết                 |                                                 |
| Người duyệt                |                                                 |
| Ngày tạo                   |                                                 |
| Ngày cập nhật              |                                                 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết module **Dashboard** của hệ thống quản lý doanh nghiệp nội bộ.

Module `DASH` chịu trách nhiệm tổng hợp và hiển thị dữ liệu quan trọng từ các module khác theo từng vai trò người dùng, giúp người dùng nhanh chóng nắm được:

* Việc cần làm hôm nay.
* Trạng thái chấm công cá nhân.
* Task đang được giao.
* Task quá hạn hoặc sắp đến hạn.
* Đơn nghỉ phép đang chờ duyệt.
* Số ngày phép còn lại.
* Tình hình nhân sự.
* Tình hình chấm công.
* Tiến độ dự án.
* Thông báo mới.
* Các cảnh báo quan trọng cần xử lý.

Dashboard không phải là nơi xử lý nghiệp vụ gốc. Dashboard chỉ đóng vai trò **tổng hợp, hiển thị, điều hướng nhanh và cảnh báo**.

Ví dụ:

* Employee xem nhanh hôm nay đã check-in chưa, có task nào cần làm, còn bao nhiêu ngày phép.
* Manager xem nhanh đơn nghỉ đang chờ duyệt, task team quá hạn, lịch nghỉ team.
* HR xem nhanh số nhân viên đang làm việc, nhân sự mới, hợp đồng sắp hết hạn, đơn nghỉ chờ xử lý, bất thường chấm công.
* Admin xem tổng quan hệ thống, số user active, số module đang dùng, cảnh báo cấu hình hoặc dữ liệu.

---

## 3. Mối liên kết với các SPEC khác

### 3.1 Liên kết với [SPEC-01](<SPEC-01 Tổng quan.md>): Tổng quan hệ thống

Theo SPEC-01, module `DASH` thuộc MVP Version 1.0.

Module DASH có nhiệm vụ hiển thị thông tin tổng quan theo từng vai trò để người dùng nhanh chóng nắm được việc cần làm và dữ liệu quan trọng.

Các nhóm dashboard chính trong MVP:

* Dashboard nhân viên.
* Dashboard HR.
* Dashboard Manager.
* Dashboard Admin.
* Widget chấm công hôm nay.
* Widget task hôm nay.
* Widget đơn nghỉ chờ duyệt.
* Widget nhân sự mới.
* Widget hợp đồng sắp hết hạn.
* Widget thông báo mới.

---

### 3.2 Liên kết với [SPEC-02](<SPEC-02 AUTH.md>): AUTH

Module DASH phụ thuộc mạnh vào `AUTH` để:

* Xác định người dùng đang đăng nhập.
* Lấy danh sách role của người dùng.
* Lấy danh sách permission của người dùng.
* Xác định data scope: Own, Team, Department, Company, System.
* Quyết định dashboard nào được hiển thị.
* Quyết định widget nào được hiển thị.
* Quyết định dữ liệu trong widget được lấy theo phạm vi nào.
* Chặn truy cập dashboard/widget/API nếu không có quyền.

Ví dụ:

```text
Employee đăng nhập
→ AUTH xác định user có role Employee
→ DASH hiển thị Employee Dashboard
→ Widget chỉ lấy dữ liệu Own của chính employee đó
```

Ví dụ khác:

```text
Manager đăng nhập
→ AUTH xác định user có role Manager
→ DASH hiển thị Manager Dashboard
→ Widget nghỉ phép lấy đơn của nhân viên thuộc Team
→ Widget task lấy task của team hoặc project liên quan
```

---

### 3.3 Liên kết với [SPEC-03](<SPEC-03 HR.md>): HR

Module DASH lấy dữ liệu từ `HR` để hiển thị:

* Thông tin nhân viên hiện tại.
* Phòng ban.
* Chức vụ.
* Quản lý trực tiếp.
* Trạng thái nhân viên.
* Nhân sự mới trong tháng.
* Nhân sự sắp hết thử việc.
* Nhân sự nghỉ việc.
* Hợp đồng sắp hết hạn.
* Cơ cấu nhân sự theo phòng ban.
* Số lượng nhân viên active/probation/resigned.
* Dữ liệu phục vụ xác định team của Manager.

DASH không được tự sửa dữ liệu nhân sự. Khi người dùng bấm vào widget HR, hệ thống điều hướng sang màn hình tương ứng trong module HR.

---

### 3.4 Liên kết với [SPEC-04](<SPEC-04 ATT.md>): ATT

Module DASH lấy dữ liệu từ `ATT` để hiển thị:

* Trạng thái check-in/check-out hôm nay.
* Giờ check-in.
* Giờ check-out.
* Trạng thái đi muộn.
* Trạng thái về sớm.
* Thiếu check-out.
* Vắng mặt.
* Làm remote.
* Tự động chấm công.
* Bảng công cá nhân tóm tắt.
* Bất thường chấm công của team.
* Bất thường chấm công toàn công ty cho HR/Admin.

Ví dụ:

```text
Employee mở Dashboard
→ DASH gọi ATT lấy trạng thái chấm công hôm nay
→ Hiển thị nút Check-in hoặc Check-out tùy trạng thái
```

Lưu ý:

* Nút Check-in/Check-out có thể hiển thị trên Dashboard.
* Khi bấm nút, nghiệp vụ vẫn được xử lý bởi module ATT.
* DASH không tự ghi attendance record.

---

### 3.5 Liên kết với [SPEC-05](<SPEC-05 LEAVE.md>): LEAVE

Module DASH lấy dữ liệu từ `LEAVE` để hiển thị:

* Số ngày phép còn lại của cá nhân.
* Đơn nghỉ gần nhất của cá nhân.
* Đơn nghỉ đang chờ duyệt.
* Lịch nghỉ của team.
* Lịch nghỉ toàn công ty.
* Thống kê nghỉ phép theo tháng/năm.
* Cảnh báo số ngày phép thấp.
* Cảnh báo đơn nghỉ sắp tới ngày bắt đầu.

Ví dụ:

```text
Manager mở Dashboard
→ DASH gọi LEAVE lấy danh sách đơn Pending thuộc team
→ Hiển thị widget “Đơn nghỉ chờ duyệt”
→ Manager bấm vào đơn
→ Hệ thống điều hướng sang chi tiết đơn nghỉ trong LEAVE
```

---

### 3.6 Liên kết với [SPEC-06](<SPEC-06 TASK.md>): TASK

Module DASH lấy dữ liệu từ `TASK` để hiển thị:

* Task của tôi hôm nay.
* Task quá hạn của tôi.
* Task sắp đến hạn.
* Task đang làm.
* Task chờ review.
* Task team quá hạn.
* Dự án đang chạy.
* Tiến độ dự án.
* Số lượng task theo trạng thái.
* Việc cần ưu tiên.

Ví dụ:

```text
Employee mở Dashboard
→ DASH gọi TASK lấy task được giao cho employee
→ Hiển thị task hôm nay, task quá hạn, task sắp đến hạn
```

---

### 3.7 Liên kết với [SPEC-08](<SPEC-08 NOTI.md>): NOTI

Module DASH lấy dữ liệu từ `NOTI` để hiển thị:

* Số thông báo chưa đọc.
* Danh sách thông báo mới nhất.
* Thông báo task mới.
* Thông báo comment mới.
* Thông báo đơn nghỉ cần duyệt.
* Thông báo kết quả duyệt nghỉ.
* Thông báo điều chỉnh công.
* Thông báo hợp đồng sắp hết hạn.
* Thông báo hệ thống.

DASH chỉ hiển thị thông báo tóm tắt. Việc tạo, lưu, đánh dấu đã đọc và quản lý thông báo thuộc module NOTI.

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

Module DASH cần giúp doanh nghiệp:

1. Tạo một màn hình tổng quan sau khi người dùng đăng nhập.
2. Hiển thị dữ liệu quan trọng nhất theo đúng vai trò.
3. Giúp Employee biết nhanh việc cần làm trong ngày.
4. Giúp Manager biết nhanh việc cần xử lý của team.
5. Giúp HR theo dõi nhanh tình hình nhân sự, chấm công và nghỉ phép.
6. Giúp Admin nắm tình trạng vận hành hệ thống.
7. Giảm thời gian người dùng phải đi vào nhiều module để kiểm tra thông tin.
8. Tạo các điểm điều hướng nhanh sang nghiệp vụ liên quan.
9. Cảnh báo sớm các vấn đề quan trọng như task quá hạn, đơn nghỉ chờ duyệt, thiếu check-out, hợp đồng sắp hết hạn.
10. Chuẩn hóa cách hiển thị số liệu toàn hệ thống.

---

### 4.2 Mục tiêu kỹ thuật

Module DASH cần đảm bảo:

1. Dữ liệu dashboard được lấy theo quyền và data scope.
2. Không trả dữ liệu người dùng không có quyền xem.
3. Mỗi widget có API hoặc data service riêng để dễ mở rộng.
4. Widget có thể bật/tắt theo role, permission hoặc cấu hình công ty.
5. Dữ liệu có thể cache ngắn hạn để tránh query nặng.
6. Dữ liệu quan trọng như task quá hạn, đơn chờ duyệt cần đủ mới.
7. Dashboard không làm thay nghiệp vụ của module gốc.
8. Widget phải có loading state, empty state và error state.
9. Backend phải kiểm tra quyền cho từng endpoint dashboard.
10. Thiết kế đủ mở để thêm Payroll, Recruitment, Asset, Room, Chat, Social, AI ở phase sau.

---

## 5. Phạm vi module

### 5.1 Bao gồm trong MVP

| Mã chức năng  | Tên chức năng                             | Độ ưu tiên |
| ------------- | ----------------------------------------- | ---------- |
| DASH-FUNC-001 | Hiển thị dashboard theo vai trò           | Rất cao    |
| DASH-FUNC-002 | Dashboard Employee                        | Rất cao    |
| DASH-FUNC-003 | Dashboard Manager                         | Rất cao    |
| DASH-FUNC-004 | Dashboard HR                              | Rất cao    |
| DASH-FUNC-005 | Dashboard Admin                           | Cao        |
| DASH-FUNC-006 | Widget chấm công hôm nay                  | Rất cao    |
| DASH-FUNC-007 | Widget task của tôi                       | Rất cao    |
| DASH-FUNC-008 | Widget task quá hạn/sắp đến hạn           | Rất cao    |
| DASH-FUNC-009 | Widget số ngày phép còn lại               | Cao        |
| DASH-FUNC-010 | Widget đơn nghỉ chờ duyệt                 | Rất cao    |
| DASH-FUNC-011 | Widget lịch nghỉ team/công ty             | Cao        |
| DASH-FUNC-012 | Widget thông báo mới                      | Cao        |
| DASH-FUNC-013 | Widget tổng quan nhân sự                  | Cao        |
| DASH-FUNC-014 | Widget nhân sự mới                        | Trung bình |
| DASH-FUNC-015 | Widget hợp đồng sắp hết hạn               | Trung bình |
| DASH-FUNC-016 | Widget bất thường chấm công               | Cao        |
| DASH-FUNC-017 | Widget tiến độ dự án                      | Cao        |
| DASH-FUNC-018 | Điều hướng nhanh sang module liên quan    | Rất cao    |
| DASH-FUNC-019 | Cấu hình hiển thị widget cơ bản theo role | Trung bình |
| DASH-FUNC-020 | API tổng hợp dữ liệu dashboard            | Rất cao    |

---

### 5.2 Chưa bao gồm trong MVP nhưng cần thiết kế mở rộng

| Chức năng                                           | Giai đoạn |
| --------------------------------------------------- | --------- |
| Người dùng tự kéo thả vị trí widget                 | Phase sau |
| Người dùng tự chọn widget cá nhân                   | Phase sau |
| Dashboard realtime bằng WebSocket                   | Phase sau |
| Dashboard BI nâng cao                               | Phase sau |
| Biểu đồ lương và chi phí nhân sự                    | Phase 2   |
| Dashboard tuyển dụng                                | Phase 2   |
| Dashboard tài sản                                   | Phase 3   |
| Dashboard phòng họp                                 | Phase 3   |
| Dashboard chat/social engagement                    | Phase 4   |
| AI tóm tắt ngày làm việc                            | Phase 5   |
| AI cảnh báo bất thường                              | Phase 5   |
| Export dashboard PDF                                | Phase sau |
| Gửi dashboard digest qua email                      | Phase sau |
| Dashboard cho lãnh đạo cấp cao với biểu đồ nâng cao | Phase sau |

---

## 6. Nhóm người dùng liên quan

| Vai trò         | Mô tả trong module DASH                                             |
| --------------- | ------------------------------------------------------------------- |
| Super Admin     | Xem dashboard toàn hệ thống, toàn công ty, toàn module              |
| Admin công ty   | Xem dashboard quản trị công ty, user, cấu hình, tình trạng vận hành |
| HR              | Xem dashboard nhân sự, chấm công, nghỉ phép, hợp đồng               |
| Manager         | Xem dashboard team, đơn nghỉ chờ duyệt, task team, chấm công team   |
| Employee        | Xem dashboard cá nhân: chấm công, task, nghỉ phép, thông báo        |
| Project Manager | Xem dashboard dự án phụ trách nếu được cấp quyền                    |
| Payroll Officer | Xem dashboard lương ở phase sau nếu có quyền                        |
| Recruiter       | Xem dashboard tuyển dụng ở phase sau                                |
| Asset Manager   | Xem dashboard tài sản ở phase sau                                   |
| Office Admin    | Xem dashboard phòng họp/hành chính ở phase sau                      |

---

## 7. Khái niệm chính trong module

### 7.1 Dashboard

`Dashboard` là màn hình tổng quan hiển thị nhiều widget theo vai trò người dùng.

Một dashboard có thể gồm:

* Header chào người dùng.
* Thông tin ngày hiện tại.
* Quick actions.
* Danh sách widget.
* Khu vực cảnh báo.
* Khu vực thông báo.
* Link điều hướng nhanh.

---

### 7.2 Widget

`Widget` là một khối dữ liệu nhỏ trên Dashboard.

Ví dụ:

* Chấm công hôm nay.
* Task của tôi.
* Đơn nghỉ chờ duyệt.
* Phép còn lại.
* Thông báo mới.
* Nhân sự mới.
* Hợp đồng sắp hết hạn.
* Tiến độ dự án.

Một widget cần có:

* Mã widget.
* Tên widget.
* Module nguồn.
* Permission cần có.
* Data scope.
* Trạng thái hiển thị.
* Thứ tự hiển thị.
* Dữ liệu trả về.
* Hành động điều hướng.

---

### 7.3 Role-based Dashboard

`Role-based Dashboard` là dashboard được xác định theo role chính của người dùng.

Ví dụ:

| Role          | Dashboard mặc định     |
| ------------- | ---------------------- |
| Employee      | Employee Dashboard     |
| Manager       | Manager Dashboard      |
| HR            | HR Dashboard           |
| Admin công ty | Admin Dashboard        |
| Super Admin   | System/Admin Dashboard |

Nếu user có nhiều role, hệ thống cần xác định dashboard ưu tiên hoặc cho phép chuyển chế độ xem.

Ví dụ:

```text
User vừa là HR vừa là Manager
→ Mặc định hiển thị HR Dashboard
→ Có dropdown chuyển sang Manager Dashboard nếu có quyền
```

---

### 7.4 Data Scope trong Dashboard

Data Scope xác định phạm vi dữ liệu widget được phép lấy.

| Scope      | Ý nghĩa                                        |
| ---------- | ---------------------------------------------- |
| Own        | Chỉ dữ liệu cá nhân                            |
| Team       | Dữ liệu nhân viên thuộc team/quản lý trực tiếp |
| Department | Dữ liệu phòng ban                              |
| Company    | Dữ liệu toàn công ty                           |
| System     | Dữ liệu toàn hệ thống                          |

Ví dụ:

```text
Widget Task quá hạn:
Employee → chỉ task của mình
Manager → task của team
HR/Admin → task toàn công ty nếu được cấp quyền
```

---

### 7.5 Quick Action

`Quick Action` là hành động nhanh từ Dashboard để chuyển sang nghiệp vụ liên quan.

Ví dụ:

* Check-in.
* Check-out.
* Tạo đơn nghỉ phép.
* Tạo task.
* Xem task của tôi.
* Duyệt đơn nghỉ.
* Xem bảng công.
* Xem danh sách nhân viên.
* Xem thông báo.

Dashboard chỉ điều hướng hoặc gọi action đã được module gốc cung cấp.

---

## 8. Quyền trong module DASH

### 8.1 Quy ước mã quyền

Cấu trúc:

```text
DASH.RESOURCE.ACTION
```

Ví dụ:

```text
DASH.DASHBOARD.VIEW
DASH.WIDGET.VIEW_ATTENDANCE_TODAY
DASH.WIDGET.VIEW_MY_TASKS
```

---

### 8.2 Danh sách quyền DASH trong MVP

| Mã quyền                              | Mô tả                               |
| ------------------------------------- | ----------------------------------- |
| DASH.DASHBOARD.VIEW                   | Được truy cập dashboard             |
| DASH.DASHBOARD.VIEW_EMPLOYEE          | Xem dashboard Employee              |
| DASH.DASHBOARD.VIEW_MANAGER           | Xem dashboard Manager               |
| DASH.DASHBOARD.VIEW_HR                | Xem dashboard HR                    |
| DASH.DASHBOARD.VIEW_ADMIN             | Xem dashboard Admin                 |
| DASH.WIDGET.VIEW_ATTENDANCE_TODAY     | Xem widget chấm công hôm nay        |
| DASH.WIDGET.VIEW_MY_TASKS             | Xem widget task của tôi             |
| DASH.WIDGET.VIEW_TASK_ALERTS          | Xem widget task quá hạn/sắp đến hạn |
| DASH.WIDGET.VIEW_LEAVE_BALANCE        | Xem widget số ngày phép còn lại     |
| DASH.WIDGET.VIEW_PENDING_LEAVE        | Xem widget đơn nghỉ chờ duyệt       |
| DASH.WIDGET.VIEW_LEAVE_CALENDAR       | Xem widget lịch nghỉ                |
| DASH.WIDGET.VIEW_NOTIFICATIONS        | Xem widget thông báo mới            |
| DASH.WIDGET.VIEW_HR_OVERVIEW          | Xem widget tổng quan nhân sự        |
| DASH.WIDGET.VIEW_NEW_EMPLOYEES        | Xem widget nhân sự mới              |
| DASH.WIDGET.VIEW_CONTRACT_EXPIRING    | Xem widget hợp đồng sắp hết hạn     |
| DASH.WIDGET.VIEW_ATTENDANCE_ALERTS    | Xem widget bất thường chấm công     |
| DASH.WIDGET.VIEW_PROJECT_PROGRESS     | Xem widget tiến độ dự án            |
| DASH.WIDGET.VIEW_USER_SUMMARY         | Xem widget tổng số user             |
| DASH.WIDGET.VIEW_EMPLOYEE_SUMMARY     | Xem widget tổng số nhân viên        |
| DASH.WIDGET.VIEW_MODULE_STATUS        | Xem widget module đang dùng         |
| DASH.WIDGET.VIEW_CONFIG_WARNINGS      | Xem widget cảnh báo cấu hình        |
| DASH.WIDGET.VIEW_NEW_USERS            | Xem widget tài khoản mới            |
| DASH.WIDGET.VIEW_SYSTEM_LOGS          | Xem widget log quan trọng gần đây   |
| DASH.WIDGET.VIEW_SYSTEM_NOTIFICATIONS | Xem widget thông báo hệ thống       |
| DASH.WIDGET.VIEW_LATEST_LEAVE         | Xem widget đơn nghỉ gần nhất        |
| DASH.WIDGET.VIEW_TEAM_TASKS_TODAY     | Xem widget task team hôm nay        |
| DASH.WIDGET.VIEW_PROBATION_ENDING     | Xem widget sắp hết thử việc         |
| DASH.CONFIG.VIEW                      | Xem cấu hình dashboard/widget       |
| DASH.CONFIG.UPDATE                    | Cập nhật cấu hình dashboard/widget  |
| DASH.CACHE.REFRESH                    | Làm mới/invalidate cache widget/dashboard (API/BE dùng) |
| DASH.AUDIT_LOG.VIEW                   | Xem log liên quan dashboard         |

---

## 9. Ma trận phân quyền MVP

| Chức năng / Widget                  | Super Admin | Admin công ty   | HR               | Manager        | Employee         |
| ----------------------------------- | ----------- | --------------- | ---------------- | -------------- | ---------------- |
| Xem Dashboard                       | Có          | Có              | Có               | Có             | Có               |
| Dashboard Employee                  | Có          | Có              | Có               | Có             | Có               |
| Dashboard Manager                   | Có          | Có nếu được cấp | Có nếu được cấp  | Có             | Không            |
| Dashboard HR                        | Có          | Có nếu được cấp | Có               | Không mặc định | Không            |
| Dashboard Admin                     | Có          | Có              | Không mặc định   | Không          | Không            |
| Widget chấm công hôm nay            | Có          | Có              | Có               | Có             | Có               |
| Widget task của tôi                 | Có          | Có              | Có               | Có             | Có               |
| Widget task team quá hạn            | Có          | Có nếu được cấp | Có nếu được cấp  | Có             | Không            |
| Widget số ngày phép còn lại         | Có          | Có              | Có               | Có             | Có               |
| Widget đơn nghỉ chờ duyệt           | Có          | Có nếu được cấp | Có nếu được cấp  | Có với team    | Không            |
| Widget lịch nghỉ team               | Có          | Có nếu được cấp | Có nếu được cấp  | Có             | Không            |
| Widget lịch nghỉ công ty            | Có          | Có nếu được cấp | Có               | Không mặc định | Không            |
| Widget thông báo mới                | Có          | Có              | Có               | Có             | Có               |
| Widget tổng quan nhân sự            | Có          | Có nếu được cấp | Có               | Không mặc định | Không            |
| Widget nhân sự mới                  | Có          | Có nếu được cấp | Có               | Không mặc định | Không            |
| Widget hợp đồng sắp hết hạn         | Có          | Có nếu được cấp | Có               | Không mặc định | Không            |
| Widget bất thường chấm công team    | Có          | Có nếu được cấp | Có nếu được cấp  | Có             | Không            |
| Widget bất thường chấm công công ty | Có          | Có nếu được cấp | Có               | Không mặc định | Không            |
| Widget tiến độ dự án                | Có          | Có nếu được cấp | Có nếu liên quan | Có theo scope  | Có nếu là member |
| Widget tổng số user                 | Có          | Có              | Không mặc định   | Không          | Không            |
| Widget tổng số nhân viên            | Có          | Có              | Không mặc định   | Không          | Không            |
| Widget module đang dùng             | Có          | Có              | Không mặc định   | Không          | Không            |
| Widget cảnh báo cấu hình            | Có          | Có              | Không mặc định   | Không          | Không            |
| Widget tài khoản mới                | Có          | Có              | Không mặc định   | Không          | Không            |
| Widget log quan trọng gần đây       | Có          | Có              | Không mặc định   | Không          | Không            |
| Widget thông báo hệ thống           | Có          | Có              | Không mặc định   | Không          | Không            |
| Widget đơn nghỉ gần nhất            | Có          | Có              | Có               | Có             | Có               |
| Widget task team hôm nay            | Có          | Có nếu được cấp | Có nếu được cấp  | Có             | Không            |
| Widget sắp hết thử việc             | Có          | Có nếu được cấp | Có               | Không mặc định | Không            |
| Cấu hình widget theo role           | Có          | Có nếu được cấp | Không mặc định   | Không          | Không            |

---

## 10. Danh sách chức năng chi tiết

| Mã chức năng  | Tên chức năng                   | Mô tả ngắn                                     |
| ------------- | ------------------------------- | ---------------------------------------------- |
| DASH-FUNC-001 | Hiển thị dashboard theo vai trò | Xác định dashboard phù hợp sau đăng nhập       |
| DASH-FUNC-002 | Dashboard Employee              | Hiển thị tổng quan cá nhân                     |
| DASH-FUNC-003 | Dashboard Manager               | Hiển thị tổng quan team                        |
| DASH-FUNC-004 | Dashboard HR                    | Hiển thị tổng quan nhân sự/chấm công/nghỉ phép |
| DASH-FUNC-005 | Dashboard Admin                 | Hiển thị tổng quan quản trị hệ thống/công ty   |
| DASH-FUNC-006 | Widget chấm công hôm nay        | Hiển thị trạng thái check-in/check-out         |
| DASH-FUNC-007 | Widget task của tôi             | Hiển thị task cá nhân cần xử lý                |
| DASH-FUNC-008 | Widget task quá hạn/sắp đến hạn | Hiển thị cảnh báo task                         |
| DASH-FUNC-009 | Widget số ngày phép còn lại     | Hiển thị leave balance cá nhân                 |
| DASH-FUNC-010 | Widget đơn nghỉ chờ duyệt       | Hiển thị đơn nghỉ Pending cần xử lý            |
| DASH-FUNC-011 | Widget lịch nghỉ                | Hiển thị lịch nghỉ team/công ty                |
| DASH-FUNC-012 | Widget thông báo mới            | Hiển thị notification mới                      |
| DASH-FUNC-013 | Widget tổng quan nhân sự        | Hiển thị số liệu nhân sự                       |
| DASH-FUNC-014 | Widget nhân sự mới              | Hiển thị nhân viên mới trong kỳ                |
| DASH-FUNC-015 | Widget hợp đồng sắp hết hạn     | Hiển thị hợp đồng cần xử lý                    |
| DASH-FUNC-016 | Widget bất thường chấm công     | Hiển thị đi muộn, thiếu checkout, vắng mặt     |
| DASH-FUNC-017 | Widget tiến độ dự án            | Hiển thị tiến độ dự án/task                    |
| DASH-FUNC-018 | Điều hướng nhanh                | Điều hướng đến module gốc                      |
| DASH-FUNC-019 | Cấu hình widget cơ bản          | Bật/tắt widget theo role                       |
| DASH-FUNC-020 | API tổng hợp dashboard          | Cung cấp dữ liệu dashboard cho frontend        |

---

## 11. Luồng nghiệp vụ tổng quan

### 11.1 Luồng hiển thị Dashboard sau đăng nhập

```text
User đăng nhập thành công
→ AUTH trả về user, role, permission, data scope
→ Frontend điều hướng đến Dashboard
→ DASH xác định dashboard mặc định theo role
→ DASH lấy danh sách widget được phép hiển thị
→ DASH gọi API lấy dữ liệu từng widget
→ Hệ thống hiển thị dashboard theo quyền
```

---

### 11.2 Luồng xác định dashboard mặc định

```text
User có một hoặc nhiều role
→ Bước 1 (personal default config): nếu user có cấu hình dashboard mặc định cá nhân
   và dashboard đó còn hợp lệ với quyền hiện tại → dùng cấu hình cá nhân
→ Bước 2 (role priority): nếu không có personal default hợp lệ, chọn theo thứ tự ưu tiên role
→ Nếu Super Admin → Admin/System Dashboard
→ Nếu Admin công ty → Admin Dashboard
→ Nếu HR → HR Dashboard
→ Nếu Manager → Manager Dashboard
→ Nếu Project Manager → Manager Dashboard (theo scope dự án)
→ Nếu Employee → Employee Dashboard
→ Nếu nhiều role → hiển thị dashboard ưu tiên và cho phép đổi chế độ nếu có quyền
```

Thứ tự ưu tiên đề xuất:

```text
Personal default config (nếu hợp lệ)
→ Super Admin
→ Admin công ty
→ HR
→ Manager
→ Project Manager
→ Employee
```

> **Personal default config** khớp BACKEND-10 §13.2/§13.3 (`findUserDefaultDashboard` được kiểm tra trước role priority) và API-08 §7.2/UI-08. Project Manager dùng Manager Dashboard giới hạn theo scope dự án; chưa có dashboard type `Project` riêng trong MVP.

---

### 11.3 Luồng tải dữ liệu widget

```text
Dashboard render layout
→ Với mỗi widget, kiểm tra permission
→ Nếu có quyền, gọi API widget
→ API kiểm tra token/session
→ API kiểm tra permission và data scope
→ API gọi module nguồn hoặc query dữ liệu summary
→ Trả dữ liệu về frontend
→ Widget hiển thị dữ liệu
```

---

### 11.4 Luồng bấm hành động nhanh

```text
User bấm quick action trên dashboard
→ Hệ thống kiểm tra quyền action
→ Nếu action thuộc module khác, điều hướng sang module đó
→ Nếu action là check-in/check-out, gọi API ATT
→ Nếu action là tạo đơn nghỉ, mở màn hình LEAVE
→ Nếu action là tạo task, mở màn hình TASK
→ Nếu không có quyền, hiển thị thông báo không có quyền
```

---

### 11.5 Luồng xem cảnh báo

```text
DASH lấy danh sách cảnh báo theo user
→ Hệ thống gom cảnh báo từ ATT/LEAVE/TASK/HR/NOTI
→ Sắp xếp theo độ ưu tiên
→ Hiển thị trên Dashboard
→ User bấm vào cảnh báo
→ Điều hướng đến màn hình xử lý gốc
```

---

## 12. Danh sách màn hình

| Mã màn hình     | Tên màn hình                           | Người dùng truy cập                        |
| --------------- | -------------------------------------- | ------------------------------------------ |
| DASH-SCREEN-001 | Dashboard chung / điều hướng dashboard | Tất cả user đã đăng nhập                   |
| DASH-SCREEN-002 | Employee Dashboard                     | Employee, Manager, HR, Admin, Super Admin  |
| DASH-SCREEN-003 | Manager Dashboard                      | Manager, HR/Admin có quyền                 |
| DASH-SCREEN-004 | HR Dashboard                           | HR, Admin có quyền, Super Admin            |
| DASH-SCREEN-005 | Admin Dashboard                        | Admin công ty, Super Admin                 |
| DASH-SCREEN-006 | Dashboard Widget Settings              | Admin có quyền cấu hình                    |
| DASH-SCREEN-007 | Dashboard Empty/Error State            | Tất cả user                                |
| DASH-SCREEN-008 | Dashboard Mobile View                  | Tất cả user nếu dùng mobile/web responsive |

---

## 13. Chi tiết màn hình

### 13.1 DASH-SCREEN-001: Dashboard chung

#### Mục đích

Là màn hình đích sau khi người dùng đăng nhập thành công. Màn hình này xác định dashboard phù hợp theo role và hiển thị layout tương ứng.

#### Người dùng truy cập

Tất cả user đã đăng nhập và có quyền `DASH.DASHBOARD.VIEW`.

#### Thành phần giao diện

* Header chào người dùng.
* Ngày hiện tại.
* Vai trò hiện tại.
* Dropdown đổi dashboard nếu user có nhiều role.
* Khu vực quick actions.
* Khu vực widget chính.
* Khu vực cảnh báo.
* Khu vực thông báo mới.
* Loading state.
* Empty state.
* Error state.

#### Quy tắc hiển thị

* User không đăng nhập không được vào Dashboard.
* User bị khóa hoặc inactive không được vào Dashboard.
* User chưa có role hợp lệ hiển thị thông báo cần liên hệ Admin.
* Widget chỉ hiển thị nếu user có quyền.
* Dữ liệu widget phải lọc theo data scope.
* Nếu widget lỗi, chỉ hiển thị lỗi tại widget đó, không làm sập toàn dashboard.

---

### 13.2 DASH-SCREEN-002: Employee Dashboard

#### Mục đích

Cho phép nhân viên xem nhanh các thông tin cá nhân cần xử lý trong ngày.

#### Người dùng truy cập

* Employee.
* Manager/HR/Admin/Super Admin khi xem dưới chế độ Employee.

#### Widget đề xuất

| Widget               | Mục đích                                    |
| -------------------- | ------------------------------------------- |
| Chấm công hôm nay    | Xem trạng thái check-in/check-out           |
| Task của tôi hôm nay | Xem việc cần làm                            |
| Task quá hạn của tôi | Cảnh báo việc quá hạn                       |
| Số ngày phép còn lại | Xem phép khả dụng                           |
| Đơn nghỉ gần nhất    | Theo dõi đơn nghỉ mới nhất                  |
| Thông báo mới        | Xem notification chưa đọc                   |
| Quick actions        | Check-in, Check-out, Tạo đơn nghỉ, Xem task |

#### Layout đề xuất

```text
[Chào buổi sáng, Nguyễn Văn A]
[Chấm công hôm nay] [Phép còn lại] [Thông báo mới]
[Task của tôi hôm nay]
[Task quá hạn / sắp đến hạn]
[Đơn nghỉ gần nhất]
[Quick actions]
```

---

### 13.3 DASH-SCREEN-003: Manager Dashboard

#### Mục đích

Cho phép Manager theo dõi tình hình team, các việc cần duyệt và tiến độ công việc.

#### Người dùng truy cập

* Manager.
* Project Manager nếu có quyền.
* HR/Admin/Super Admin nếu có quyền xem scope tương ứng.

#### Widget đề xuất

| Widget                    | Mục đích                             |
| ------------------------- | ------------------------------------ |
| Đơn nghỉ chờ duyệt        | Duyệt/từ chối đơn nghỉ của team      |
| Task team quá hạn         | Theo dõi công việc team chậm tiến độ |
| Task team hôm nay         | Theo dõi việc team cần làm           |
| Lịch nghỉ team            | Biết ai đang nghỉ/sắp nghỉ           |
| Bất thường chấm công team | Đi muộn, vắng mặt, thiếu checkout    |
| Tiến độ dự án             | Xem tiến độ dự án phụ trách          |
| Thông báo mới             | Xem thông báo liên quan              |

#### Layout đề xuất

```text
[Manager Dashboard]
[Đơn nghỉ chờ duyệt] [Task team quá hạn] [Bất thường chấm công]
[Lịch nghỉ team]
[Tiến độ dự án]
[Task team hôm nay]
[Thông báo mới]
```

---

### 13.4 DASH-SCREEN-004: HR Dashboard

#### Mục đích

Cho phép HR theo dõi nhanh tình hình nhân sự, nghỉ phép, chấm công và hợp đồng.

#### Người dùng truy cập

* HR.
* Admin có quyền.
* Super Admin.

#### Widget đề xuất

| Widget               | Mục đích                                 |
| -------------------- | ---------------------------------------- |
| Tổng quan nhân sự    | Tổng nhân viên active/probation/resigned |
| Nhân sự mới          | Nhân viên mới trong kỳ                   |
| Sắp hết thử việc     | Nhân viên sắp hết thử việc               |
| Hợp đồng sắp hết hạn | Cảnh báo hợp đồng cần xử lý              |
| Đơn nghỉ chờ xử lý   | Đơn nghỉ Pending toàn công ty            |
| Lịch nghỉ công ty    | Theo dõi lịch nghỉ toàn công ty          |
| Bất thường chấm công | Đi muộn, vắng mặt, thiếu checkout        |
| Thông báo HR         | Thông báo liên quan HR                   |

#### Layout đề xuất

```text
[HR Dashboard]
[Tổng nhân sự] [Nhân sự mới] [Sắp hết thử việc] [Hợp đồng sắp hết hạn]
[Đơn nghỉ chờ xử lý] [Bất thường chấm công]
[Lịch nghỉ công ty]
[Thông báo HR]
```

---

### 13.5 DASH-SCREEN-005: Admin Dashboard

#### Mục đích

Cho phép Admin công ty hoặc Super Admin xem tổng quan vận hành hệ thống.

#### Người dùng truy cập

* Admin công ty.
* Super Admin.

#### Widget đề xuất

| Widget                 | Mục đích                              |
| ---------------------- | ------------------------------------- |
| Tổng số user           | Số user active/inactive/locked        |
| Tổng số nhân viên      | Số employee active/probation/resigned |
| Module đang dùng       | Trạng thái các module MVP             |
| Cảnh báo cấu hình      | Thiếu cấu hình chấm công/nghỉ phép    |
| Tài khoản mới          | User mới tạo trong kỳ                 |
| Log quan trọng gần đây | Thao tác hệ thống quan trọng          |
| Thông báo hệ thống     | Notification/cảnh báo hệ thống        |

#### Layout đề xuất

```text
[Admin Dashboard]
[User active] [User locked] [Employee active] [Module active]
[Cảnh báo cấu hình]
[Log quan trọng gần đây]
[Thông báo hệ thống]
```

---

### 13.6 DASH-SCREEN-006: Dashboard Widget Settings

#### Mục đích

Cho phép Admin cấu hình widget nào được hiển thị theo từng role.

#### Người dùng truy cập

* Super Admin.
* Admin công ty có quyền `DASH.CONFIG.UPDATE`.

#### Thành phần giao diện

* Chọn role.
* Danh sách widget.
* Bật/tắt widget.
* Sắp xếp thứ tự widget.
* Cấu hình số lượng item hiển thị.
* Cấu hình khoảng thời gian dữ liệu mặc định.
* Nút lưu cấu hình.
* Nút khôi phục mặc định.

#### Trường dữ liệu

| Trường             | Kiểu dữ liệu | Bắt buộc | Ghi chú                 |
| ------------------ | ------------ | -------- | ----------------------- |
| role_code          | String       | Có       | Role áp dụng            |
| widget_code        | String       | Có       | Mã widget               |
| is_enabled         | Boolean      | Có       | Bật/tắt                 |
| display_order      | Integer      | Có       | Thứ tự hiển thị         |
| default_limit      | Integer      | Không    | Số item hiển thị        |
| default_date_range | String       | Không    | today/week/month/custom |
| config_json        | JSON         | Không    | Cấu hình mở rộng        |

---

## 14. Chi tiết widget

### 14.1 DASH-WIDGET-001: Chấm công hôm nay

#### Mục tiêu

Hiển thị trạng thái check-in/check-out của user trong ngày hiện tại.

#### Module nguồn

`ATT`

#### Người dùng

* Employee.
* Manager.
* HR.
* Admin.
* Super Admin.

#### Dữ liệu hiển thị

| Trường              | Mô tả                         |
| ------------------- | ----------------------------- |
| attendance_date     | Ngày chấm công                |
| check_in_time       | Giờ check-in                  |
| check_out_time      | Giờ check-out                 |
| attendance_status   | Trạng thái chấm công          |
| shift_name          | Ca làm                        |
| working_minutes     | Tổng phút làm việc            |
| late_minutes        | Số phút đi muộn               |
| early_leave_minutes | Số phút về sớm                |
| source              | WEB/MOBILE/AUTO/REMOTE/MANUAL |
| can_check_in        | Có được check-in không        |
| can_check_out       | Có được check-out không       |

#### Hành động

| Hành động     | Điều kiện                          |
| ------------- | ---------------------------------- |
| Check-in      | Chưa check-in và được ATT cho phép |
| Check-out     | Đã check-in, chưa check-out        |
| Xem bảng công | Có quyền xem bảng công cá nhân     |
| Xem chi tiết  | Điều hướng sang ATT                |

#### Quy tắc

* Thời gian hiển thị lấy từ server.
* Nếu nhân viên nghỉ phép cả ngày đã duyệt, hiển thị trạng thái Leave.
* Nếu remote tự động, hiển thị trạng thái Remote/Auto Attendance.
* Nếu thiếu check-out, hiển thị cảnh báo.
* Dashboard không tự xử lý logic chấm công, chỉ gọi API ATT.

---

### 14.2 DASH-WIDGET-002: Task của tôi hôm nay

#### Mục tiêu

Hiển thị các task người dùng cần xử lý trong ngày.

#### Module nguồn

`TASK`

#### Dữ liệu hiển thị

| Trường       | Mô tả            |
| ------------ | ---------------- |
| task_id      | ID task          |
| task_code    | Mã task          |
| title        | Tiêu đề task     |
| project_name | Dự án            |
| priority     | Mức ưu tiên      |
| status       | Trạng thái       |
| due_date     | Deadline         |
| assignee     | Người phụ trách  |
| is_overdue   | Có quá hạn không |

#### Bộ lọc mặc định

```text
assignee = current_employee
AND status NOT IN (Done, Cancelled)
AND due_date <= today hoặc task được đánh dấu hôm nay
```

#### Hành động

* Xem chi tiết task.
* Cập nhật trạng thái nhanh nếu có quyền.
* Chuyển sang màn hình Việc của tôi.
* Chuyển sang Kanban nếu task thuộc project.

---

### 14.3 DASH-WIDGET-003: Task quá hạn/sắp đến hạn

#### Mục tiêu

Cảnh báo các task cần ưu tiên xử lý.

#### Module nguồn

`TASK`

#### Dữ liệu hiển thị

| Trường          | Mô tả                   |
| --------------- | ----------------------- |
| overdue_count   | Số task quá hạn         |
| due_today_count | Số task đến hạn hôm nay |
| due_soon_count  | Số task sắp đến hạn     |
| urgent_count    | Số task khẩn cấp        |
| task_list       | Danh sách task ưu tiên  |

#### Quy tắc

* Task quá hạn nếu `due_date < current_date` và status chưa Done/Cancelled.
* Task đến hạn hôm nay nếu `due_date = current_date`.
* Task sắp đến hạn nếu deadline nằm trong khoảng cấu hình, ví dụ 3 ngày tới.
* Employee chỉ thấy task của mình.
* Manager thấy task team/project theo scope.
* HR/Admin chỉ thấy nếu có quyền xem TASK.

---

### 14.4 DASH-WIDGET-004: Số ngày phép còn lại

#### Mục tiêu

Hiển thị số ngày phép khả dụng của người dùng.

#### Module nguồn

`LEAVE`

#### Dữ liệu hiển thị

| Trường              | Mô tả                  |
| ------------------- | ---------------------- |
| leave_type          | Loại phép              |
| granted_days        | Số ngày được cấp       |
| used_days           | Số ngày đã dùng        |
| pending_days        | Số ngày đang chờ duyệt |
| remaining_days      | Số ngày còn lại        |
| nearest_expiry_date | Ngày hết hạn nếu có    |

#### Hành động

* Tạo đơn nghỉ phép.
* Xem số dư phép chi tiết.
* Xem đơn nghỉ của tôi.

#### Quy tắc

* Employee chỉ xem số dư phép của chính mình.
* Manager không mặc định xem số dư phép của nhân viên khác trừ khi được cấp quyền.
* HR/Admin có thể xem số dư phép nhân viên theo quyền.

---

### 14.5 DASH-WIDGET-005: Đơn nghỉ chờ duyệt

#### Mục tiêu

Hiển thị danh sách đơn nghỉ đang chờ người dùng xử lý.

#### Module nguồn

`LEAVE`

#### Người dùng

* Manager.
* HR.
* Admin có quyền.
* Super Admin.

#### Dữ liệu hiển thị

| Trường             | Mô tả              |
| ------------------ | ------------------ |
| leave_request_id   | ID đơn nghỉ        |
| leave_request_code | Mã đơn             |
| employee_name      | Nhân viên xin nghỉ |
| department_name    | Phòng ban          |
| leave_type_name    | Loại nghỉ          |
| start_date         | Ngày bắt đầu       |
| end_date           | Ngày kết thúc      |
| calculated_days    | Số ngày nghỉ       |
| submitted_at       | Ngày gửi           |
| status             | Pending            |

#### Hành động

* Xem chi tiết.
* Duyệt nhanh nếu cấu hình cho phép.
* Từ chối nhanh nếu cấu hình cho phép.
* Mở màn hình đơn chờ duyệt.

#### Quy tắc

* Manager chỉ xem đơn thuộc team.
* HR có thể xem đơn toàn công ty nếu có quyền.
* Từ chối bắt buộc nhập lý do, nên hành động nhanh chỉ mở modal nhập lý do.
* Không hiển thị đơn đã xử lý.

---

### 14.6 DASH-WIDGET-006: Lịch nghỉ team/công ty

#### Mục tiêu

Hiển thị lịch nghỉ sắp tới để Manager/HR chủ động điều phối nhân sự.

#### Module nguồn

`LEAVE`

#### Dữ liệu hiển thị

| Trường          | Mô tả                         |
| --------------- | ----------------------------- |
| employee_name   | Nhân viên nghỉ                |
| department_name | Phòng ban                     |
| leave_type      | Loại nghỉ                     |
| start_date      | Ngày bắt đầu                  |
| end_date        | Ngày kết thúc                 |
| duration        | Thời lượng                    |
| status          | Approved/Pending tùy cấu hình |

#### Quy tắc

* Employee chỉ xem lịch nghỉ của mình ở dashboard cá nhân nếu có widget.
* Manager xem lịch nghỉ team.
* HR/Admin xem lịch nghỉ công ty nếu có quyền.
* Có thể ẩn lý do nghỉ nếu người xem không có quyền xem chi tiết.

---

### 14.7 DASH-WIDGET-007: Thông báo mới

#### Mục tiêu

Hiển thị các thông báo mới nhất hoặc chưa đọc.

#### Module nguồn

`NOTI`

#### Dữ liệu hiển thị

| Trường          | Mô tả            |
| --------------- | ---------------- |
| notification_id | ID thông báo     |
| title           | Tiêu đề          |
| content         | Nội dung tóm tắt |
| type            | Loại thông báo   |
| is_read         | Đã đọc/chưa đọc  |
| created_at      | Thời gian        |
| target_url      | Link điều hướng  |

#### Hành động

* Mở thông báo.
* Đánh dấu đã đọc.
* Xem tất cả thông báo.

---

### 14.8 DASH-WIDGET-008: Tổng quan nhân sự

#### Mục tiêu

Cho HR/Admin xem nhanh tình hình nhân sự.

#### Module nguồn

`HR`

#### Dữ liệu hiển thị

| Trường                 | Mô tả                         |
| ---------------------- | ----------------------------- |
| total_active_employees | Tổng nhân viên đang làm việc  |
| probation_count        | Số nhân viên thử việc         |
| official_count         | Số nhân viên chính thức       |
| resigned_this_month    | Số nhân viên nghỉ trong tháng |
| new_joiners_this_month | Số nhân viên mới trong tháng  |
| department_breakdown   | Cơ cấu theo phòng ban         |

#### Quy tắc

* Chỉ HR/Admin/Super Admin hoặc user có quyền HR overview được xem.
* Không hiển thị dữ liệu nhạy cảm.
* Nếu có data scope Department, chỉ hiển thị phòng ban tương ứng.

---

### 14.9 DASH-WIDGET-009: Nhân sự mới

#### Mục tiêu

Hiển thị danh sách nhân viên mới trong khoảng thời gian cấu hình.

#### Module nguồn

`HR`

#### Dữ liệu hiển thị

| Trường            | Mô tả        |
| ----------------- | ------------ |
| employee_id       | ID nhân viên |
| employee_code     | Mã nhân viên |
| full_name         | Họ tên       |
| department_name   | Phòng ban    |
| position_name     | Chức vụ      |
| joined_date       | Ngày vào làm |
| employment_status | Trạng thái   |

#### Quy tắc

* Mặc định lấy nhân viên có `joined_date` trong tháng hiện tại.
* Có thể cấu hình 7 ngày, 30 ngày hoặc tháng hiện tại.
* Không hiển thị thông tin nhạy cảm.

---

### 14.10 DASH-WIDGET-010: Hợp đồng sắp hết hạn

#### Mục tiêu

Cảnh báo HR/Admin về hợp đồng cần xử lý.

#### Module nguồn

`HR`

#### Dữ liệu hiển thị

| Trường            | Mô tả               |
| ----------------- | ------------------- |
| employee_name     | Nhân viên           |
| employee_code     | Mã nhân viên        |
| department_name   | Phòng ban           |
| contract_type     | Loại hợp đồng       |
| contract_end_date | Ngày hết hạn        |
| days_remaining    | Số ngày còn lại     |
| contract_status   | Trạng thái hợp đồng |

#### Quy tắc

* Mặc định cảnh báo hợp đồng hết hạn trong 30 ngày tới.
* Có thể cấu hình số ngày cảnh báo.
* Chỉ người có quyền xem hợp đồng mới được xem widget.
* Không hiển thị file hợp đồng trên dashboard.

---

### 14.11 DASH-WIDGET-011: Bất thường chấm công

#### Mục tiêu

Hiển thị các bất thường chấm công cần kiểm tra.

#### Module nguồn

`ATT`

#### Dữ liệu hiển thị

| Trường                   | Mô tả                           |
| ------------------------ | ------------------------------- |
| late_count               | Số lượt đi muộn                 |
| early_leave_count        | Số lượt về sớm                  |
| missing_checkout_count   | Số lượt thiếu check-out         |
| absent_count             | Số lượt vắng mặt                |
| pending_adjustment_count | Số yêu cầu điều chỉnh chờ duyệt |
| list                     | Danh sách bản ghi nổi bật       |

#### Quy tắc

* Employee chỉ thấy bất thường của chính mình nếu có.
* Manager thấy bất thường của team.
* HR thấy bất thường toàn công ty nếu có quyền.
* Không tính nhân viên có đơn nghỉ phép hợp lệ là vắng mặt.
* Remote/auto attendance cần hiển thị đúng trạng thái để tránh nhầm bất thường.

---

### 14.12 DASH-WIDGET-012: Tiến độ dự án

#### Mục tiêu

Hiển thị tiến độ dự án mà user có quyền xem.

#### Module nguồn

`TASK`

#### Dữ liệu hiển thị

| Trường              | Mô tả            |
| ------------------- | ---------------- |
| project_id          | ID dự án         |
| project_name        | Tên dự án        |
| owner_name          | Người phụ trách  |
| total_tasks         | Tổng task        |
| done_tasks          | Task hoàn thành  |
| overdue_tasks       | Task quá hạn     |
| progress_percentage | % hoàn thành     |
| project_status      | Trạng thái dự án |

#### Quy tắc

* Project Member chỉ xem dự án mình tham gia.
* Manager xem dự án thuộc team hoặc do mình phụ trách.
* Admin/HR chỉ xem nếu có quyền TASK tương ứng.
* Tiến độ tính theo tỷ lệ task Done trên tổng task không bị Cancelled.

---

### 14.13 DASH-WIDGET-013: Tổng số user

#### Mục tiêu

Cho Admin/Super Admin xem nhanh tổng số tài khoản người dùng và trạng thái hoạt động.

#### Module nguồn

`AUTH` (SPEC-02)

> Dữ liệu user và trạng thái tài khoản thuộc sở hữu của module AUTH. DASH chỉ tổng hợp số liệu, không tự quản lý tài khoản.

#### Người dùng

* Admin công ty.
* Super Admin.

#### Dữ liệu hiển thị

| Trường             | Mô tả                  |
| ------------------ | ---------------------- |
| total_users        | Tổng số user           |
| active_users       | Số user đang hoạt động |
| inactive_users     | Số user inactive       |
| locked_users       | Số user bị khóa        |
| last_calculated_at | Thời điểm tính số liệu |

#### Hành động

| Hành động          | Điều kiện                        |
| ------------------ | -------------------------------- |
| Xem danh sách user | Có quyền quản lý user trong AUTH |
| Xem chi tiết       | Điều hướng sang AUTH             |

#### Quy tắc

* Chỉ Admin công ty/Super Admin hoặc user có quyền `DASH.WIDGET.VIEW_USER_SUMMARY` được xem.
* Số liệu phải đồng bộ với module AUTH, không tự tính lại logic trạng thái.
* Admin công ty chỉ xem user thuộc công ty của mình theo data scope Company.
* Super Admin có thể xem theo scope System nếu được cấp quyền.
* Không hiển thị thông tin nhạy cảm như mật khẩu hay token.

---

### 14.14 DASH-WIDGET-014: Tổng số nhân viên

#### Mục tiêu

Cho Admin/Super Admin xem nhanh tổng số nhân viên và phân bố theo trạng thái nhân sự.

#### Module nguồn

`HR`

#### Người dùng

* Admin công ty.
* Super Admin.

#### Dữ liệu hiển thị

| Trường             | Mô tả                      |
| ------------------ | -------------------------- |
| total_employees    | Tổng số nhân viên          |
| active_count       | Số nhân viên đang làm việc |
| probation_count    | Số nhân viên thử việc      |
| resigned_count     | Số nhân viên nghỉ việc     |
| last_calculated_at | Thời điểm tính số liệu     |

#### Hành động

| Hành động               | Điều kiện                     |
| ----------------------- | ----------------------------- |
| Xem danh sách nhân viên | Có quyền xem nhân sự trong HR |
| Xem chi tiết            | Điều hướng sang HR            |

#### Quy tắc

* Chỉ Admin công ty/Super Admin hoặc user có quyền `DASH.WIDGET.VIEW_EMPLOYEE_SUMMARY` được xem.
* Số liệu phải đồng bộ với module HR.
* Không hiển thị thông tin nhạy cảm của từng nhân viên trên widget.
* Nếu có data scope Department, chỉ hiển thị phòng ban tương ứng.

---

### 14.15 DASH-WIDGET-015: Module đang dùng

#### Mục tiêu

Cho Admin/Super Admin xem trạng thái các module MVP đang được bật/sử dụng.

#### Module nguồn

`FOUNDATION` (module catalog + company settings; khớp API-08/BACKEND-10)

> Trạng thái bật/tắt module thuộc module catalog/cấu hình của FOUNDATION. DASH chỉ đọc và hiển thị, không tự thay đổi cấu hình module.

#### Người dùng

* Admin công ty.
* Super Admin.

#### Dữ liệu hiển thị

| Trường          | Mô tả                            |
| --------------- | -------------------------------- |
| module_code     | Mã module (HR/ATT/LEAVE/TASK...) |
| module_name     | Tên module                       |
| is_enabled      | Module đang bật/tắt              |
| status          | Trạng thái vận hành              |
| last_checked_at | Thời điểm kiểm tra trạng thái    |

#### Hành động

| Hành động           | Điều kiện                         |
| ------------------- | --------------------------------- |
| Xem cấu hình module | Có quyền quản trị hệ thống        |
| Xem chi tiết        | Điều hướng sang cấu hình hệ thống |

#### Quy tắc

* Chỉ Admin công ty/Super Admin hoặc user có quyền `DASH.WIDGET.VIEW_MODULE_STATUS` được xem.
* Trạng thái module lấy từ cấu hình hệ thống, không tự suy luận.
* Chỉ hiển thị các module trong phạm vi MVP và các module được cấp phép cho công ty.

---

### 14.16 DASH-WIDGET-016: Cảnh báo cấu hình

#### Mục tiêu

Cảnh báo Admin/Super Admin về các cấu hình còn thiếu hoặc chưa hợp lệ, ví dụ thiếu cấu hình chấm công hoặc nghỉ phép.

#### Module nguồn

`FOUNDATION, AUTH, HR, ATT, LEAVE, NOTI` (tổng hợp cấu hình công ty + module catalog của FOUNDATION và các module nguồn; khớp API-08 §12.16/BACKEND-10)

> Cảnh báo cấu hình được tổng hợp từ FOUNDATION (company settings/module catalog) và các module nguồn. DASH chỉ hiển thị cảnh báo, việc sửa cấu hình thực hiện ở màn hình cấu hình gốc.

#### Người dùng

* Admin công ty.
* Super Admin.

#### Dữ liệu hiển thị

| Trường          | Mô tả                          |
| --------------- | ------------------------------ |
| warning_code    | Mã cảnh báo cấu hình           |
| warning_message | Nội dung cảnh báo              |
| related_module  | Module liên quan               |
| severity        | Mức độ nghiêm trọng            |
| target_url      | Link đến màn hình cấu hình gốc |

#### Hành động

| Hành động             | Điều kiện                         |
| --------------------- | --------------------------------- |
| Xem chi tiết cảnh báo | Có quyền quản trị cấu hình        |
| Đi đến cấu hình       | Điều hướng sang màn hình cấu hình |

#### Quy tắc

* Chỉ Admin công ty/Super Admin hoặc user có quyền `DASH.WIDGET.VIEW_CONFIG_WARNINGS` được xem.
* Cảnh báo phải tổng hợp từ cấu hình hệ thống và các module nguồn, không tự bịa.
* Sắp xếp cảnh báo theo mức độ nghiêm trọng.
* DASH không tự sửa cấu hình, chỉ điều hướng đến màn hình cấu hình gốc.

---

### 14.17 DASH-WIDGET-017: Tài khoản mới

#### Mục tiêu

Hiển thị danh sách tài khoản user mới được tạo trong khoảng thời gian cấu hình.

#### Module nguồn

`AUTH` (SPEC-02)

> Dữ liệu tài khoản thuộc module AUTH. DASH chỉ hiển thị danh sách tài khoản mới, không tự tạo hay sửa tài khoản.

#### Người dùng

* Admin công ty.
* Super Admin.

#### Dữ liệu hiển thị

| Trường         | Mô tả                   |
| -------------- | ----------------------- |
| user_id        | ID user                 |
| username       | Tên đăng nhập           |
| full_name      | Họ tên                  |
| roles          | Danh sách role được gán |
| created_at     | Thời gian tạo tài khoản |
| account_status | Trạng thái tài khoản    |

#### Hành động

| Hành động            | Điều kiện                        |
| -------------------- | -------------------------------- |
| Xem chi tiết user    | Có quyền quản lý user trong AUTH |
| Xem tất cả tài khoản | Điều hướng sang AUTH             |

#### Quy tắc

* Chỉ Admin công ty/Super Admin hoặc user có quyền `DASH.WIDGET.VIEW_NEW_USERS` được xem.
* Mặc định lấy tài khoản tạo trong tháng hiện tại.
* Có thể cấu hình 7 ngày, 30 ngày hoặc tháng hiện tại.
* Không hiển thị mật khẩu, token hay thông tin nhạy cảm.
* Admin công ty chỉ xem tài khoản thuộc công ty của mình theo data scope.

---

### 14.18 DASH-WIDGET-018: Log quan trọng gần đây

#### Mục tiêu

Hiển thị các thao tác hệ thống quan trọng gần đây để Admin/Super Admin theo dõi.

#### Module nguồn

`FOUNDATION/AUDIT` (audit log hệ thống — `audit_logs` chung; cần quyền `FOUNDATION.AUDIT_LOG.VIEW`; khớp API-08 §12.18/§19.7)

> Log thao tác hệ thống được tổng hợp từ `audit_logs` chung của FOUNDATION/AUDIT. DASH chỉ hiển thị tóm tắt, không tự ghi log nghiệp vụ của module khác.

#### Người dùng

* Admin công ty.
* Super Admin.

#### Dữ liệu hiển thị

| Trường     | Mô tả              |
| ---------- | ------------------ |
| log_id     | ID log             |
| actor_name | Người thao tác     |
| action     | Hành động          |
| module     | Module liên quan   |
| target     | Đối tượng tác động |
| created_at | Thời gian thao tác |

#### Hành động

| Hành động        | Điều kiện                          |
| ---------------- | ---------------------------------- |
| Xem chi tiết log | Có quyền xem audit log             |
| Xem tất cả log   | Điều hướng sang màn hình audit log |

#### Quy tắc

* Chỉ Admin công ty/Super Admin hoặc user có quyền `DASH.WIDGET.VIEW_SYSTEM_LOGS` được xem.
* Mặc định hiển thị các thao tác quan trọng gần nhất theo cấu hình số lượng.
* Chỉ hiển thị log trong phạm vi quyền và data scope của người xem.
* Không hiển thị dữ liệu nhạy cảm trong nội dung log.

---

### 14.19 DASH-WIDGET-019: Thông báo hệ thống

#### Mục tiêu

Hiển thị các thông báo và cảnh báo cấp hệ thống cho Admin/Super Admin.

#### Module nguồn

`NOTI, FOUNDATION` (khớp API-08 §12.19)

> Thông báo hệ thống do NOTI và FOUNDATION (company settings/cấu hình hệ thống) cung cấp. DASH chỉ hiển thị tóm tắt, việc tạo và quản lý thông báo thuộc module NOTI.

#### Người dùng

* Admin công ty.
* Super Admin.

#### Dữ liệu hiển thị

| Trường          | Mô tả                       |
| --------------- | --------------------------- |
| notification_id | ID thông báo                |
| title           | Tiêu đề                     |
| content         | Nội dung tóm tắt            |
| level           | Mức độ (info/warning/error) |
| created_at      | Thời gian                   |
| target_url      | Link điều hướng             |

#### Hành động

| Hành động            | Điều kiện                       |
| -------------------- | ------------------------------- |
| Mở thông báo         | Có quyền xem thông báo hệ thống |
| Xem tất cả thông báo | Điều hướng sang NOTI            |

#### Quy tắc

* Chỉ Admin công ty/Super Admin hoặc user có quyền `DASH.WIDGET.VIEW_SYSTEM_NOTIFICATIONS` được xem.
* Chỉ hiển thị thông báo cấp hệ thống, không trộn với thông báo cá nhân.
* Sắp xếp theo mức độ và thời gian.
* DASH không tự tạo thông báo, chỉ hiển thị từ NOTI/cấu hình hệ thống.

---

### 14.20 DASH-WIDGET-020: Đơn nghỉ gần nhất

#### Mục tiêu

Hiển thị đơn nghỉ phép mới nhất của chính người dùng để theo dõi trạng thái.

#### Module nguồn

`LEAVE`

#### Người dùng

* Employee.
* Manager/HR/Admin/Super Admin khi xem dưới chế độ Employee.

#### Dữ liệu hiển thị

| Trường             | Mô tả          |
| ------------------ | -------------- |
| leave_request_id   | ID đơn nghỉ    |
| leave_request_code | Mã đơn         |
| leave_type_name    | Loại nghỉ      |
| start_date         | Ngày bắt đầu   |
| end_date           | Ngày kết thúc  |
| calculated_days    | Số ngày nghỉ   |
| status             | Trạng thái đơn |
| submitted_at       | Ngày gửi       |

#### Hành động

| Hành động            | Điều kiện             |
| -------------------- | --------------------- |
| Xem chi tiết đơn     | Điều hướng sang LEAVE |
| Tạo đơn nghỉ mới     | Có quyền tạo đơn nghỉ |
| Xem đơn nghỉ của tôi | Điều hướng sang LEAVE |

#### Quy tắc

* Employee chỉ xem đơn nghỉ gần nhất của chính mình theo data scope Own.
* Mặc định lấy đơn nghỉ có `submitted_at` mới nhất.
* Nếu chưa có đơn nghỉ nào, hiển thị empty state.
* DASH không tự xử lý nghiệp vụ nghỉ phép, chỉ hiển thị và điều hướng.

---

### 14.21 DASH-WIDGET-021: Task team hôm nay

#### Mục tiêu

Hiển thị các task của team cần xử lý trong ngày để Manager theo dõi.

#### Module nguồn

`TASK`

#### Người dùng

* Manager.
* Project Manager nếu có quyền.
* HR/Admin/Super Admin nếu có quyền xem scope tương ứng.

#### Dữ liệu hiển thị

| Trường       | Mô tả           |
| ------------ | --------------- |
| task_id      | ID task         |
| task_code    | Mã task         |
| title        | Tiêu đề task    |
| assignee     | Người phụ trách |
| project_name | Dự án           |
| priority     | Mức ưu tiên     |
| status       | Trạng thái      |
| due_date     | Deadline        |

#### Bộ lọc mặc định

```text
assignee IN team_members
AND status NOT IN (Done, Cancelled)
AND due_date <= today hoặc task được đánh dấu hôm nay
```

#### Hành động

* Xem chi tiết task.
* Mở danh sách task của team.
* Chuyển sang Kanban nếu task thuộc project.

#### Quy tắc

* Manager chỉ xem task của nhân viên thuộc team theo data scope Team.
* Project Manager xem task thuộc dự án mình phụ trách.
* HR/Admin chỉ xem nếu có quyền xem TASK tương ứng.
* DASH không tự cập nhật task, chỉ hiển thị và điều hướng.

---

### 14.22 DASH-WIDGET-022: Sắp hết thử việc

#### Mục tiêu

Cảnh báo HR/Admin về các nhân viên sắp hết thời gian thử việc cần xử lý.

#### Module nguồn

`HR`

#### Người dùng

* HR.
* Admin có quyền.
* Super Admin.

#### Dữ liệu hiển thị

| Trường             | Mô tả             |
| ------------------ | ----------------- |
| employee_id        | ID nhân viên      |
| employee_code      | Mã nhân viên      |
| full_name          | Họ tên            |
| department_name    | Phòng ban         |
| position_name      | Chức vụ           |
| probation_end_date | Ngày hết thử việc |
| days_remaining     | Số ngày còn lại   |

#### Hành động

| Hành động              | Điều kiện                     |
| ---------------------- | ----------------------------- |
| Xem chi tiết nhân viên | Có quyền xem nhân sự trong HR |
| Xem danh sách thử việc | Điều hướng sang HR            |

#### Quy tắc

* Chỉ HR/Admin/Super Admin hoặc user có quyền `DASH.WIDGET.VIEW_PROBATION_ENDING` được xem.
* Mặc định cảnh báo nhân viên hết thử việc trong 30 ngày tới.
* Có thể cấu hình số ngày cảnh báo.
* Nếu có data scope Department, chỉ hiển thị phòng ban tương ứng.
* Không hiển thị thông tin nhạy cảm của nhân viên trên dashboard.

---

## 15. Dữ liệu cần lưu

### 15.1 Bảng dashboard_widget_configs

| Tên trường     | Kiểu dữ liệu | Bắt buộc | Mặc định | Ghi chú                   |
| -------------- | ------------ | -------- | -------- | ------------------------- |
| id             | UUID         | Có       | Auto     | ID cấu hình               |
| company_id     | UUID         | Có       |          | Công ty áp dụng           |
| role_code      | String       | Có       |          | Role áp dụng              |
| dashboard_type | String       | Có       |          | Employee/Manager/HR/Admin |
| widget_code    | String       | Có       |          | Mã widget                 |
| widget_name    | String       | Có       |          | Tên widget                |
| is_enabled     | Boolean      | Có       | true     | Bật/tắt                   |
| display_order  | Integer      | Có       | 0        | Thứ tự                    |
| default_limit  | Integer      | Không    | 5        | Số item hiển thị          |
| config_json    | JSON         | Không    |          | Cấu hình riêng            |
| created_at     | DateTime     | Có       | Auto     | Thời gian tạo             |
| updated_at     | DateTime     | Có       | Auto     | Thời gian cập nhật        |
| created_by     | User ID      | Có       | Auto     | Người tạo                 |
| updated_by     | User ID      | Không    | Auto     | Người cập nhật            |

---

### 15.2 Bảng dashboard_user_preferences

Giai đoạn MVP có thể chưa cần, nhưng nên thiết kế sẵn.

| Tên trường     | Kiểu dữ liệu | Bắt buộc | Mặc định | Ghi chú                 |
| -------------- | ------------ | -------- | -------- | ----------------------- |
| id             | UUID         | Có       | Auto     | ID                      |
| user_id        | UUID         | Có       |          | User                    |
| dashboard_type | String       | Có       |          | Dashboard đang cấu hình |
| widget_code    | String       | Có       |          | Widget                  |
| is_visible     | Boolean      | Có       | true     | Người dùng bật/tắt      |
| display_order  | Integer      | Không    | 0        | Thứ tự cá nhân          |
| config_json    | JSON         | Không    |          | Cấu hình cá nhân        |
| created_at     | DateTime     | Có       | Auto     | Tạo lúc                 |
| updated_at     | DateTime     | Có       | Auto     | Cập nhật lúc            |

Trong MVP có thể chưa cho user tự tùy chỉnh, nhưng bảng này giúp mở rộng phase sau.

---

### 15.3 Dữ liệu dashboard summary/cache

Tùy quy mô dữ liệu, có thể cần bảng cache/summary.

| Tên trường    | Kiểu dữ liệu | Bắt buộc | Ghi chú                     |
| ------------- | ------------ | -------- | --------------------------- |
| id            | UUID         | Có       | ID                          |
| company_id    | UUID         | Có       | Công ty                     |
| scope_type    | String       | Có       | Own/Team/Department/Company |
| scope_id      | UUID         | Không    | ID scope                    |
| metric_code   | String       | Có       | Mã chỉ số                   |
| metric_value  | JSON/Number  | Có       | Giá trị                     |
| calculated_at | DateTime     | Có       | Thời điểm tính              |
| expired_at    | DateTime     | Không    | Hết hạn cache               |

MVP có thể query trực tiếp nếu dữ liệu chưa lớn. Khi dữ liệu lớn, dùng cache hoặc materialized view.

---

## 16. Quy tắc nghiệp vụ quan trọng

### 16.1 Quy tắc phân quyền

1. User phải đăng nhập mới được xem Dashboard.
2. Dashboard phải xác định role và permission từ AUTH.
3. Mỗi widget phải khai báo permission riêng.
4. Backend phải kiểm tra quyền ở từng API widget.
5. Data trả về phải lọc theo data scope.
6. Không được dựa vào frontend để ẩn dữ liệu nhạy cảm.
7. User có nhiều role có thể xem nhiều loại dashboard nếu có quyền.
8. Nếu không có quyền xem widget, widget không được hiển thị và API không được trả dữ liệu.

---

### 16.2 Quy tắc dữ liệu

1. DASH không lưu dữ liệu nghiệp vụ gốc.
2. Dữ liệu gốc thuộc module nào thì module đó chịu trách nhiệm tính đúng.
3. DASH chỉ tổng hợp, hiển thị và điều hướng.
4. Dữ liệu số lượng cần thống nhất với module nguồn.
5. Dữ liệu nhạy cảm không hiển thị trên dashboard mặc định.
6. Widget lỗi không được làm lỗi toàn bộ dashboard.
7. Dữ liệu dashboard cần có thời điểm cập nhật cuối cùng nếu dùng cache.
8. Các số liệu quan trọng nên có link xem chi tiết.
9. **Scope trước aggregate:** backend phải áp dụng data scope (Own/Team/Department/Project/Company) **trước khi** count/aggregate/limit, không aggregate toàn công ty rồi mới filter theo scope. Quy tắc này áp cho mọi widget có dữ liệu phạm vi (đồng bộ BACKEND-10 §14.2 và API-08 §6.x).

---

### 16.3 Quy tắc dashboard theo nhiều role

Nếu user có nhiều role:

1. Hệ thống chọn dashboard mặc định theo role ưu tiên cao nhất.
2. User có thể chuyển dashboard nếu được cấp quyền.
3. Mỗi dashboard vẫn phải kiểm tra permission riêng.
4. Không gộp dữ liệu nhạy cảm giữa các role nếu không có quyền.
5. Có thể hiển thị dropdown “Chế độ xem” ở header dashboard.

Ví dụ:

```text
User có role HR + Manager
→ Mặc định vào HR Dashboard
→ Có thể chuyển sang Manager Dashboard
→ Manager Dashboard chỉ hiển thị dữ liệu team
→ HR Dashboard hiển thị dữ liệu công ty nếu có scope Company
```

---

### 16.4 Quy tắc quick action

1. Quick action chỉ hiển thị nếu user có quyền thao tác.
2. Quick action check-in/check-out phải gọi module ATT.
3. Quick action tạo đơn nghỉ phải điều hướng sang LEAVE.
4. Quick action tạo task phải điều hướng sang TASK.
5. Nếu action cần form phức tạp, không xử lý ngay trên dashboard mà mở màn hình module gốc.
6. Nếu action lỗi, hiển thị thông báo rõ ràng.

---

### 16.5 Quy tắc thời gian

1. Tất cả dữ liệu ngày/giờ cần dùng timezone công ty hoặc timezone user theo cấu hình.
2. Task quá hạn phải dùng server time.
3. Chấm công hôm nay phải theo ngày làm việc của user/công ty.
4. Lịch nghỉ cần hiển thị theo ngày local.
5. Dashboard nên hiển thị “Cập nhật lần cuối” nếu dữ liệu được cache.

---

### 16.6 Quy tắc empty state

Widget phải có trạng thái rỗng thân thiện.

Ví dụ:

| Widget               | Empty state                        |
| -------------------- | ---------------------------------- |
| Task của tôi         | Hôm nay bạn chưa có task cần xử lý |
| Đơn nghỉ chờ duyệt   | Không có đơn nghỉ nào chờ duyệt    |
| Thông báo mới        | Bạn không có thông báo mới         |
| Hợp đồng sắp hết hạn | Không có hợp đồng sắp hết hạn      |
| Bất thường chấm công | Chưa có bất thường chấm công       |

---

### 16.7 Quy tắc error state

Nếu widget lỗi:

* Không làm lỗi toàn bộ dashboard.
* Hiển thị thông báo ở widget đó.
* Có nút tải lại widget.
* Ghi log lỗi backend nếu cần.

Ví dụ:

```text
Không thể tải dữ liệu task. Vui lòng thử lại.
```

---

## 17. API sơ bộ

### 17.1 Dashboard API

| Mã API       | Method | Endpoint                | Mục đích                                   | Permission                   |
| ------------ | ------ | ----------------------- | ------------------------------------------ | ---------------------------- |
| DASH-API-001 | GET    | /api/v1/dashboard/me       | Lấy dashboard mặc định của user hiện tại   | DASH.DASHBOARD.VIEW          |
| DASH-API-002 | GET    | /api/v1/dashboard/types    | Lấy danh sách dashboard user được phép xem | DASH.DASHBOARD.VIEW          |
| DASH-API-003 | GET    | /api/v1/dashboard/widgets  | Lấy danh sách widget được phép hiển thị    | DASH.DASHBOARD.VIEW          |
| DASH-API-004 | GET    | /api/v1/dashboard/employee | Lấy dữ liệu Employee Dashboard             | DASH.DASHBOARD.VIEW_EMPLOYEE |
| DASH-API-005 | GET    | /api/v1/dashboard/manager  | Lấy dữ liệu Manager Dashboard              | DASH.DASHBOARD.VIEW_MANAGER  |
| DASH-API-006 | GET    | /api/v1/dashboard/hr       | Lấy dữ liệu HR Dashboard                   | DASH.DASHBOARD.VIEW_HR       |
| DASH-API-007 | GET    | /api/v1/dashboard/admin    | Lấy dữ liệu Admin Dashboard                | DASH.DASHBOARD.VIEW_ADMIN    |

---

### 17.2 Widget API

| Mã API       | Method | Endpoint                                    | Mục đích                        | Permission                            |
| ------------ | ------ | ------------------------------------------- | ------------------------------- | ------------------------------------- |
| DASH-API-101 | GET    | /api/v1/dashboard/widgets/attendance-today     | Widget chấm công hôm nay        | DASH.WIDGET.VIEW_ATTENDANCE_TODAY     |
| DASH-API-102 | GET    | /api/v1/dashboard/widgets/my-tasks             | Widget task của tôi             | DASH.WIDGET.VIEW_MY_TASKS             |
| DASH-API-103 | GET    | /api/v1/dashboard/widgets/task-alerts          | Widget task quá hạn/sắp đến hạn | DASH.WIDGET.VIEW_TASK_ALERTS          |
| DASH-API-104 | GET    | /api/v1/dashboard/widgets/leave-balance        | Widget số ngày phép còn lại     | DASH.WIDGET.VIEW_LEAVE_BALANCE        |
| DASH-API-105 | GET    | /api/v1/dashboard/widgets/pending-leave        | Widget đơn nghỉ chờ duyệt       | DASH.WIDGET.VIEW_PENDING_LEAVE        |
| DASH-API-106 | GET    | /api/v1/dashboard/widgets/leave-calendar       | Widget lịch nghỉ                | DASH.WIDGET.VIEW_LEAVE_CALENDAR       |
| DASH-API-107 | GET    | /api/v1/dashboard/widgets/notifications        | Widget thông báo mới            | DASH.WIDGET.VIEW_NOTIFICATIONS        |
| DASH-API-108 | GET    | /api/v1/dashboard/widgets/hr-overview          | Widget tổng quan nhân sự        | DASH.WIDGET.VIEW_HR_OVERVIEW          |
| DASH-API-109 | GET    | /api/v1/dashboard/widgets/new-employees        | Widget nhân sự mới              | DASH.WIDGET.VIEW_NEW_EMPLOYEES        |
| DASH-API-110 | GET    | /api/v1/dashboard/widgets/contract-expiring    | Widget hợp đồng sắp hết hạn     | DASH.WIDGET.VIEW_CONTRACT_EXPIRING    |
| DASH-API-111 | GET    | /api/v1/dashboard/widgets/attendance-alerts    | Widget bất thường chấm công     | DASH.WIDGET.VIEW_ATTENDANCE_ALERTS    |
| DASH-API-112 | GET    | /api/v1/dashboard/widgets/project-progress     | Widget tiến độ dự án            | DASH.WIDGET.VIEW_PROJECT_PROGRESS     |
| DASH-API-113 | GET    | /api/v1/dashboard/widgets/user-summary         | Widget tổng số user             | DASH.WIDGET.VIEW_USER_SUMMARY         |
| DASH-API-114 | GET    | /api/v1/dashboard/widgets/employee-summary     | Widget tổng số nhân viên        | DASH.WIDGET.VIEW_EMPLOYEE_SUMMARY     |
| DASH-API-115 | GET    | /api/v1/dashboard/widgets/module-status        | Widget module đang dùng         | DASH.WIDGET.VIEW_MODULE_STATUS        |
| DASH-API-116 | GET    | /api/v1/dashboard/widgets/config-warnings      | Widget cảnh báo cấu hình        | DASH.WIDGET.VIEW_CONFIG_WARNINGS      |
| DASH-API-117 | GET    | /api/v1/dashboard/widgets/new-users            | Widget tài khoản mới            | DASH.WIDGET.VIEW_NEW_USERS            |
| DASH-API-118 | GET    | /api/v1/dashboard/widgets/system-logs          | Widget log quan trọng gần đây   | DASH.WIDGET.VIEW_SYSTEM_LOGS          |
| DASH-API-119 | GET    | /api/v1/dashboard/widgets/system-notifications | Widget thông báo hệ thống       | DASH.WIDGET.VIEW_SYSTEM_NOTIFICATIONS |
| DASH-API-120 | GET    | /api/v1/dashboard/widgets/latest-leave         | Widget đơn nghỉ gần nhất        | DASH.WIDGET.VIEW_LATEST_LEAVE         |
| DASH-API-121 | GET    | /api/v1/dashboard/widgets/team-tasks-today     | Widget task team hôm nay        | DASH.WIDGET.VIEW_TEAM_TASKS_TODAY     |
| DASH-API-122 | GET    | /api/v1/dashboard/widgets/probation-ending     | Widget sắp hết thử việc         | DASH.WIDGET.VIEW_PROBATION_ENDING     |

---

### 17.3 Config API

| Mã API       | Method | Endpoint                             | Mục đích                        | Permission         |
| ------------ | ------ | ------------------------------------ | ------------------------------- | ------------------ |
| DASH-API-201 | GET    | /api/v1/dashboard/configs               | Lấy cấu hình dashboard/widget   | DASH.CONFIG.VIEW   |
| DASH-API-202 | POST   | /api/v1/dashboard/configs               | Tạo cấu hình widget             | DASH.CONFIG.UPDATE |
| DASH-API-203 | PATCH  | /api/v1/dashboard/configs/{id}          | Cập nhật cấu hình widget        | DASH.CONFIG.UPDATE |
| DASH-API-204 | DELETE | /api/v1/dashboard/configs/{id}          | Xóa/vô hiệu hóa cấu hình widget | DASH.CONFIG.UPDATE |
| DASH-API-205 | POST   | /api/v1/dashboard/configs/reset-default | Khôi phục cấu hình mặc định     | DASH.CONFIG.UPDATE |

---

## 18. Response chuẩn

### 18.1 Response dashboard tổng hợp

```json
{
  "success": true,
  "data": {
    "dashboard_type": "Employee",
    "user": {
      "id": "user-id",
      "full_name": "Nguyễn Văn A",
      "roles": ["Employee"]
    },
    "widgets": [
      {
        "widget_code": "ATTENDANCE_TODAY",
        "widget_name": "Chấm công hôm nay",
        "data": {},
        "last_updated_at": "2026-06-20T08:00:00+07:00"
      }
    ]
  },
  "message": "Success"
}
```

---

### 18.2 Response widget

```json
{
  "success": true,
  "data": {
    "widget_code": "MY_TASKS",
    "items": [],
    "summary": {
      "total": 0
    },
    "last_updated_at": "2026-06-20T08:00:00+07:00"
  },
  "message": "Success"
}
```

---

### 18.3 Response lỗi

```json
{
  "success": false,
  "error": {
    "code": "DASH-ERR-FORBIDDEN",
    "message": "Bạn không có quyền xem dashboard này"
  }
}
```

---

## 19. Error code

> **Hệ mã lỗi chuẩn = slug (theo [API-08](<../API Design/API-08_DASH_API_Design.md>)).** Bộ số `DASH-ERR-001..010` cũ đã bỏ; dùng slug bên dưới ở mọi tầng (SPEC/API/BE/FE). Lỗi xác thực dùng mã chung AUTH (`AUTH-ERR-UNAUTHORIZED`).

| Mã lỗi (slug chuẩn)                  | HTTP | Trường hợp                                         | (Mã số cũ)        |
| ------------------------------------ | ---- | -------------------------------------------------- | ----------------- |
| `DASH-ERR-FORBIDDEN`                 | 403  | Không có permission hoặc data scope phù hợp (dashboard/widget) | DASH-ERR-001/002/009 |
| `DASH-ERR-DASHBOARD_NOT_RESOLVED`    | 404  | Không xác định được dashboard phù hợp / user chưa có role hợp lệ | DASH-ERR-003/004 |
| `DASH-ERR-NOT_FOUND`                 | 404  | Dashboard/widget/config không tồn tại hoặc ngoài company | DASH-ERR-006     |
| `DASH-ERR-VALIDATION`                | 422  | Query/body hoặc cấu hình widget không hợp lệ       | DASH-ERR-007      |
| `DASH-ERR-NO_EMPLOYEE_LINK`          | 422  | Tài khoản chưa liên kết hồ sơ nhân viên            | DASH-ERR-008      |
| `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | 500  | Module nguồn hoặc cache service lỗi / không tải được dữ liệu widget | DASH-ERR-005/010 |

---

## 20. Notification liên quan

Module DASH chủ yếu hiển thị notification từ module NOTI. Tuy nhiên, DASH có thể phát sinh một số event nội bộ phục vụ log hoặc cấu hình.

| Mã sự kiện    | Sự kiện                            | Người nhận           | Nội dung                                     | Kênh   |
| ------------- | ---------------------------------- | -------------------- | -------------------------------------------- | ------ |
| DASH-NOTI-001 | Cấu hình dashboard thay đổi        | Admin/Role liên quan | Cấu hình dashboard đã được cập nhật          | In-app |
| DASH-NOTI-002 | Widget bị lỗi nhiều lần            | Admin hệ thống       | Một widget dashboard đang gặp lỗi            | In-app |
| DASH-NOTI-003 | Dashboard không xác định được role | Admin                | Có user chưa được gán role dashboard phù hợp | In-app |
| DASH-NOTI-004 | Cảnh báo dữ liệu quan trọng        | Người có quyền       | Có dữ liệu cần xử lý trên dashboard          | In-app |

Trong MVP, các notification này có thể chỉ ghi audit log. Thông báo nghiệp vụ chính vẫn do NOTI quản lý.

---

## 21. Audit log

### 21.1 Hành động cần ghi log

| Hành động                      | Có ghi log không | Ghi chú                           |
| ------------------------------ | ---------------- | --------------------------------- |
| User mở dashboard              | Không bắt buộc   | Có thể log analytics sau          |
| User xem widget nhạy cảm       | Có               | Ví dụ HR overview, hợp đồng       |
| Admin thay đổi cấu hình widget | Có               | Bắt buộc                          |
| Admin reset cấu hình dashboard | Có               | Bắt buộc                          |
| Lỗi phân quyền widget          | Có thể           | Ghi security log nếu nghiêm trọng |
| Export dashboard               | Phase sau        | Nếu triển khai export             |

---

### 21.2 Thông tin log cần lưu

| Trường      | Mô tả                   |
| ----------- | ----------------------- |
| id          | ID log                  |
| actor_id    | Người thao tác          |
| action      | Hành động               |
| module      | DASH                    |
| target_type | Dashboard/Widget/Config |
| target_id   | ID đối tượng            |
| old_value   | Dữ liệu cũ nếu có       |
| new_value   | Dữ liệu mới nếu có      |
| ip_address  | IP                      |
| user_agent  | Thiết bị/trình duyệt    |
| created_at  | Thời gian               |

---

## 22. Tiêu chí nghiệm thu tổng thể

Module DASH được xem là hoàn thành MVP khi:

1. User đăng nhập thành công được điều hướng vào dashboard phù hợp.
2. Employee thấy Employee Dashboard.
3. Manager thấy Manager Dashboard nếu có role/quyền.
4. HR thấy HR Dashboard nếu có role/quyền.
5. Admin thấy Admin Dashboard nếu có role/quyền.
6. User chỉ thấy widget đúng quyền.
7. API widget kiểm tra quyền ở backend.
8. Dữ liệu widget được lọc đúng data scope.
9. Widget chấm công hôm nay hiển thị đúng trạng thái từ ATT.
10. Widget task của tôi hiển thị đúng task từ TASK.
11. Widget task quá hạn/sắp đến hạn tính đúng.
12. Widget số ngày phép còn lại hiển thị đúng từ LEAVE.
13. Widget đơn nghỉ chờ duyệt hiển thị đúng theo scope.
14. Widget thông báo mới hiển thị đúng từ NOTI.
15. Widget tổng quan nhân sự chỉ hiển thị với người có quyền.
16. Widget lỗi không làm sập toàn bộ Dashboard.
17. Empty state hiển thị rõ ràng khi không có dữ liệu.
18. Loading state hiển thị khi đang tải.
19. Admin có thể bật/tắt widget cơ bản theo role nếu triển khai config trong MVP.
20. Các thao tác cấu hình dashboard được ghi audit log.

---

## 23. Test case

| Mã test case | Trường hợp kiểm thử              | Bước thực hiện                     | Kết quả mong muốn                                     |
| ------------ | -------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| DASH-TC-001  | Employee vào dashboard           | Đăng nhập bằng user Employee       | Hiển thị Employee Dashboard                           |
| DASH-TC-002  | Manager vào dashboard            | Đăng nhập bằng user Manager        | Hiển thị Manager Dashboard                            |
| DASH-TC-003  | HR vào dashboard                 | Đăng nhập bằng user HR             | Hiển thị HR Dashboard                                 |
| DASH-TC-004  | Admin vào dashboard              | Đăng nhập bằng user Admin          | Hiển thị Admin Dashboard                              |
| DASH-TC-005  | User không có role               | Đăng nhập user chưa gán role       | Hiển thị lỗi role không hợp lệ                        |
| DASH-TC-006  | Employee xem task của tôi        | Có task được giao                  | Widget hiển thị đúng task                             |
| DASH-TC-007  | Employee không có task           | Không có task                      | Hiển thị empty state                                  |
| DASH-TC-008  | Task quá hạn                     | Có task due_date đã qua            | Widget hiển thị task quá hạn                          |
| DASH-TC-009  | Chấm công chưa check-in          | Employee chưa check-in             | Widget hiển thị nút Check-in                          |
| DASH-TC-010  | Chấm công đã check-in            | Employee đã check-in               | Widget hiển thị nút Check-out                         |
| DASH-TC-011  | Nghỉ phép cả ngày                | Employee có đơn nghỉ Approved      | Widget chấm công hiển thị Leave                       |
| DASH-TC-012  | Manager xem đơn chờ duyệt        | Có đơn Pending thuộc team          | Widget hiển thị đơn                                   |
| DASH-TC-013  | Manager không xem đơn ngoài team | Có đơn Pending ngoài team          | Không hiển thị đơn ngoài scope                        |
| DASH-TC-014  | HR xem tổng quan nhân sự         | Đăng nhập HR                       | Widget tổng quan nhân sự hiển thị                     |
| DASH-TC-015  | Employee không xem HR overview   | Đăng nhập Employee                 | Widget HR overview không hiển thị                     |
| DASH-TC-016  | Widget lỗi                       | API TASK lỗi                       | Chỉ widget task hiển thị lỗi, dashboard vẫn hoạt động |
| DASH-TC-017  | Không có quyền API widget        | Gọi API widget không có permission | Trả lỗi DASH-ERR-FORBIDDEN                            |
| DASH-TC-018  | Admin tắt widget                 | Admin tắt widget theo role         | Widget không hiển thị với role đó                     |
| DASH-TC-019  | User nhiều role                  | User có HR + Manager               | Hiển thị dashboard ưu tiên và có thể đổi nếu có quyền |
| DASH-TC-020  | Data scope Own                   | Employee gọi widget leave balance  | Chỉ trả dữ liệu của chính employee                    |

---

## 24. Rủi ro và hướng xử lý

| Rủi ro                                      | Ảnh hưởng                         | Hướng xử lý                                         |
| ------------------------------------------- | --------------------------------- | --------------------------------------------------- |
| Query dashboard quá nặng                    | Dashboard tải chậm                | Tách API widget, cache ngắn hạn                     |
| Sai data scope                              | Lộ dữ liệu nhạy cảm               | Backend kiểm tra quyền và scope                     |
| Widget phụ thuộc module lỗi                 | Dashboard lỗi theo                | Cô lập lỗi từng widget                              |
| Số liệu không đồng bộ module gốc            | Người dùng mất niềm tin           | Dữ liệu phải lấy từ module nguồn hoặc summary chuẩn |
| Nhiều role gây rối dashboard                | User không biết xem dashboard nào | Có thứ tự ưu tiên và dropdown chọn dashboard        |
| Task quá hạn lệch timezone                  | Cảnh báo sai                      | Dùng server time và timezone công ty                |
| Chấm công hiển thị sai trạng thái nghỉ phép | Employee thao tác sai             | ATT/LEAVE phải là source of truth                   |
| Dashboard quá nhiều widget                  | Giao diện rối                     | MVP chỉ giữ widget quan trọng, cho config sau       |
| Dữ liệu nhân sự nhạy cảm lộ trên widget     | Rủi ro bảo mật                    | Không hiển thị dữ liệu nhạy cảm mặc định            |
| Widget realtime phức tạp                    | Tốn chi phí MVP                   | MVP dùng refresh thủ công hoặc auto refresh nhẹ     |

---

## 25. Ghi chú triển khai MVP

### 25.1 Đề xuất triển khai trước

Trong MVP nên ưu tiên các widget sau:

#### Employee

1. Chấm công hôm nay.
2. Task của tôi hôm nay.
3. Task quá hạn/sắp đến hạn.
4. Số ngày phép còn lại.
5. Thông báo mới.

#### Manager

1. Đơn nghỉ chờ duyệt.
2. Task team quá hạn.
3. Lịch nghỉ team.
4. Bất thường chấm công team.
5. Tiến độ dự án.

#### HR

1. Tổng quan nhân sự.
2. Đơn nghỉ chờ xử lý.
3. Bất thường chấm công.
4. Nhân sự mới.
5. Hợp đồng sắp hết hạn.

#### Admin

1. Tổng user.
2. Tổng nhân viên.
3. Cảnh báo cấu hình.
4. Log quan trọng gần đây.
5. Module đang dùng.

---

### 25.2 Đề xuất kỹ thuật

1. Không nên gom toàn bộ dashboard vào một query lớn.
2. Nên tách API từng widget để dễ lazy load.
3. Frontend hiển thị skeleton loading từng widget.
4. Backend kiểm tra permission cho từng widget.
5. Dữ liệu tổng hợp có thể cache 1-5 phút tùy loại.
6. Dữ liệu chấm công hôm nay không nên cache quá lâu.
7. Dữ liệu task quá hạn nên cập nhật đủ nhanh.
8. Dữ liệu HR overview có thể cache lâu hơn.
9. Cần chuẩn hóa response widget.
10. Nên có mã widget cố định để frontend cấu hình layout.

---

## 26. Các điểm cần xác nhận thêm

Trước khi chốt bản final, cần xác nhận:

1. User có nhiều role thì dashboard mặc định ưu tiên role nào?
2. MVP có cần cho user tự sắp xếp widget không?
3. MVP có cần Admin cấu hình bật/tắt widget theo role không?
4. Dashboard có cần auto refresh không, nếu có thì mỗi bao lâu?
5. Widget chấm công có cho check-in/check-out trực tiếp trên dashboard không?
6. Widget đơn nghỉ chờ duyệt có cho duyệt nhanh không?
7. Widget task có cho cập nhật trạng thái nhanh không?
8. Dashboard Admin cần tập trung vào hệ thống hay dữ liệu công ty?
9. Có cần biểu đồ trong MVP không hay chỉ cần card/list?
10. Có cần dashboard dạng mobile riêng không?
11. Có cần cache dashboard không ngay từ MVP?
12. Có cần ghi log khi user xem dashboard không?
13. Có cần ẩn lý do nghỉ phép trên lịch nghỉ team không?
14. Có cần hiển thị dữ liệu realtime notification trên dashboard không?
15. Có cần cảnh báo hợp đồng sắp hết hạn trong MVP không?

---

## 27. Kết luận

SPEC-07 DASH là module tổng hợp giúp người dùng bắt đầu ngày làm việc nhanh hơn và giúp các vai trò quản lý kiểm soát công việc, chấm công, nghỉ phép và nhân sự từ một màn hình duy nhất.

Trong MVP, Dashboard cần tập trung vào:

* Hiển thị đúng dashboard theo vai trò.
* Hiển thị đúng widget theo quyền.
* Lọc dữ liệu đúng data scope.
* Tích hợp dữ liệu từ AUTH, HR, ATT, LEAVE, TASK và NOTI.
* Cung cấp quick action và điều hướng nhanh sang module gốc.
* Cảnh báo các việc cần xử lý như task quá hạn, đơn nghỉ chờ duyệt, thiếu check-out, hợp đồng sắp hết hạn.
* Đảm bảo bảo mật dữ liệu nhạy cảm.
* Đảm bảo widget lỗi không ảnh hưởng toàn bộ dashboard.

Sau khi SPEC-07 được chốt, có thể triển khai tiếp:

1. SPEC-08: Thông báo hệ thống.
2. SPEC-09: Trung tâm cá nhân & Cài đặt tài khoản (ME).
3. Các dashboard nâng cao cho tiền lương, tuyển dụng, tài sản, phòng họp và AI.
