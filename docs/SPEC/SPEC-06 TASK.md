# SPEC-06: CÔNG VIỆC & DỰ ÁN

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · [SPEC-03 HR](<SPEC-03 HR.md>) · [SPEC-04 ATT](<SPEC-04 ATT.md>) · [SPEC-05 LEAVE](<SPEC-05 LEAVE.md>) · **SPEC-06 TASK** · [SPEC-07 DASH](<SPEC-07 DASH.md>) · [SPEC-08 NOTI](<SPEC-08 NOTI.md>) · [SPEC-09 ME](<SPEC-09 ME.md>)
>
> **Liên quan:** [Thiết kế DB: DB-06 TASK](<../DB/DB-06 TASK Database Design.md>) · [Sản phẩm: PRD-00 §9.5](<../PRD/PRD-00 Enterprise Management System .md>) · [Thiết kế API: API-06 TASK](<../API Design/API-06_TASK_API_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường                     | Nội dung                    |
| -------------------------- | --------------------------- |
| Mã tài liệu                | SPEC-06                     |
| Tên tài liệu               | Công việc & Dự án           |
| Module code                | TASK                        |
| Tài liệu cha               | SPEC-01: Tổng quan hệ thống |
| Module phụ thuộc trực tiếp | AUTH, HR                    |
| Module liên quan           | NOTI, DASH, ATT, LEAVE      |
| Phiên bản                  | v1.0                        |
| Trạng thái                 | Draft                       |
| Giai đoạn                  | MVP Version 1.0             |
| Người viết                 |                             |
| Người duyệt                |                             |
| Ngày tạo                   |                             |
| Ngày cập nhật              |                             |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết module **Công việc & Dự án** trong hệ thống quản lý doanh nghiệp nội bộ.

Module TASK chịu trách nhiệm quản lý các nghiệp vụ liên quan đến:

* Quản lý dự án.
* Quản lý thành viên dự án.
* Quản lý công việc/task.
* Giao việc cho nhân viên.
* Theo dõi trạng thái công việc.
* Quản lý deadline.
* Bình luận trong task.
* Đính kèm file trong task.
* Hiển thị Kanban board.
* Hiển thị danh sách việc của tôi.
* Theo dõi task quá hạn.
* Báo cáo tiến độ dự án cơ bản.
* Ghi lịch sử hoạt động của dự án và task.

Module này giúp Manager, Project Owner và nhân viên làm việc tập trung hơn, giảm việc giao task thủ công qua tin nhắn rời rạc, đồng thời cung cấp dữ liệu cho Dashboard và hệ thống thông báo.

---

## 3. Mối liên kết với các spec khác

### 3.1 Liên kết với [SPEC-01](<SPEC-01 Tổng quan.md>)

Theo tổng quan hệ thống, module này có mã:

```text
TASK
```

Module TASK thuộc nhóm MVP Version 1.0 và có vai trò quản lý công việc, dự án, tiến độ, người phụ trách, deadline, bình luận và file đính kèm.

### 3.2 Liên kết với [SPEC-02](<SPEC-02 AUTH.md>): AUTH

Module TASK phụ thuộc AUTH để:

* Xác định người dùng đang đăng nhập.
* Xác định user liên kết với employee nào.
* Kiểm tra quyền tạo dự án, tạo task, giao task, cập nhật task.
* Kiểm tra data scope: Own, Team, Department, Company, System.
* Kiểm tra quyền truy cập màn hình, button và API.
* Ghi nhận người tạo, người cập nhật, người giao việc.
* Ghi audit log các thao tác quan trọng.

Ví dụ:

```text
User A có role Manager
→ Có quyền TASK.PROJECT.CREATE
→ Có scope Team
→ Có thể tạo dự án và giao task cho nhân viên thuộc team hoặc thành viên dự án
```

### 3.3 Liên kết với [SPEC-03](<SPEC-03 HR.md>): HR

Module TASK phụ thuộc HR để:

* Lấy danh sách nhân viên.
* Lấy phòng ban của nhân viên.
* Lấy chức vụ của nhân viên.
* Lấy quản lý trực tiếp.
* Kiểm tra trạng thái nhân viên.
* Chỉ cho giao task cho nhân viên đang làm việc hợp lệ.
* Hiển thị thông tin người phụ trách, người giao việc, thành viên dự án.
* Xác định phạm vi team của Manager.

### 3.4 Liên kết với [SPEC-04](<SPEC-04 ATT.md>): ATT

Trong MVP, module TASK chưa bắt buộc phải tính công theo task.

Tuy nhiên, TASK có thể liên kết ATT ở các điểm sau:

* Remote work có thể yêu cầu task xác nhận.
* Dashboard có thể hiển thị task hôm nay cùng trạng thái chấm công.
* Giai đoạn sau có thể ghi nhận thời gian làm việc theo task.
* Giai đoạn sau có thể so sánh thời gian check-in/check-out với task đã hoàn thành.

### 3.5 Liên kết với [SPEC-05](<SPEC-05 LEAVE.md>): LEAVE

Module TASK có thể liên kết LEAVE để:

* Cảnh báo khi giao task cho nhân viên đang nghỉ phép.
* Cảnh báo khi deadline nằm trong kỳ nghỉ đã được duyệt của assignee.
* Hiển thị lịch nghỉ của thành viên trong dự án nếu có quyền.
* Hỗ trợ Manager điều phối lại task khi nhân viên nghỉ dài ngày.

Trong MVP, hệ thống có thể chỉ hiển thị cảnh báo, chưa bắt buộc tự động chặn giao việc.

### 3.6 Liên kết với [SPEC-07](<SPEC-07 DASH.md>): DASH

Module DASH lấy dữ liệu TASK để hiển thị:

* Task của tôi hôm nay.
* Task quá hạn của tôi.
* Task đang chờ xử lý.
* Task team quá hạn.
* Dự án đang chạy.
* Tiến độ dự án.
* Số lượng task theo trạng thái.
* Việc cần ưu tiên.

### 3.7 Liên kết với [SPEC-08](<SPEC-08 NOTI.md>): NOTI

Module NOTI dùng để gửi thông báo khi:

* Người dùng được giao task mới.
* Task được cập nhật.
* Task có comment mới.
* Task sắp đến hạn.
* Task quá hạn.
* Người dùng được thêm vào dự án.
* Task bị đổi người phụ trách.
* Task được đánh dấu hoàn thành.
* Project bị đóng hoặc hủy.

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

Module TASK cần giúp doanh nghiệp:

1. Quản lý tập trung danh sách dự án và công việc.
2. Chuẩn hóa quy trình giao việc, nhận việc và cập nhật trạng thái.
3. Giúp Manager theo dõi tiến độ của team.
4. Giúp Employee biết rõ việc được giao, deadline và mức độ ưu tiên.
5. Giảm thất lạc thông tin khi giao việc qua chat, email hoặc lời nói.
6. Cho phép trao đổi trực tiếp trong từng task.
7. Lưu file, tài liệu liên quan đến công việc.
8. Theo dõi task quá hạn, task sắp đến hạn và task chưa có người phụ trách.
9. Cung cấp dữ liệu cho Dashboard theo vai trò.
10. Ghi lịch sử thay đổi để truy vết trách nhiệm.

### 4.2 Mục tiêu kỹ thuật

Module TASK cần đảm bảo:

1. Dữ liệu dự án và task có định danh duy nhất.
2. API kiểm tra quyền ở backend.
3. Mỗi task có thể gắn với một dự án hoặc là task cá nhân nếu cấu hình cho phép.
4. Mỗi task có thể có một hoặc nhiều người phụ trách tùy cấu hình.
5. Mỗi task có trạng thái rõ ràng.
6. Có kiểm soát data scope theo user.
7. Có soft delete cho dữ liệu quan trọng.
8. Có audit log hoặc activity log cho task/project.
9. Có tìm kiếm, lọc, phân trang, sắp xếp.
10. Có khả năng mở rộng sang Kanban nâng cao, Sprint, Gantt chart, Time tracking, Automation và AI ở giai đoạn sau.

---

## 5. Phạm vi module

### 5.1 Bao gồm trong MVP

| Mã chức năng  | Tên chức năng                     | Độ ưu tiên |
| ------------- | --------------------------------- | ---------- |
| TASK-FUNC-001 | Xem danh sách dự án               | Rất cao    |
| TASK-FUNC-002 | Tạo dự án                         | Rất cao    |
| TASK-FUNC-003 | Cập nhật dự án                    | Cao        |
| TASK-FUNC-004 | Đóng/hủy/xóa mềm dự án            | Cao        |
| TASK-FUNC-005 | Quản lý thành viên dự án          | Rất cao    |
| TASK-FUNC-006 | Phân vai trò thành viên dự án     | Cao        |
| TASK-FUNC-007 | Xem danh sách task                | Rất cao    |
| TASK-FUNC-008 | Tạo task                          | Rất cao    |
| TASK-FUNC-009 | Giao task cho nhân viên           | Rất cao    |
| TASK-FUNC-010 | Cập nhật thông tin task           | Rất cao    |
| TASK-FUNC-011 | Cập nhật trạng thái task          | Rất cao    |
| TASK-FUNC-012 | Xem việc của tôi                  | Rất cao    |
| TASK-FUNC-013 | Kanban board                      | Cao        |
| TASK-FUNC-014 | Bình luận trong task              | Cao        |
| TASK-FUNC-015 | Đính kèm file trong task          | Cao        |
| TASK-FUNC-016 | Checklist trong task              | Trung bình |
| TASK-FUNC-017 | Theo dõi task quá hạn/sắp đến hạn | Cao        |
| TASK-FUNC-018 | Tìm kiếm, lọc, sắp xếp task       | Rất cao    |
| TASK-FUNC-019 | Lịch sử hoạt động task/project    | Cao        |
| TASK-FUNC-020 | Báo cáo tiến độ dự án cơ bản      | Trung bình |

---

### 5.2 Chưa bao gồm trong MVP nhưng cần thiết kế mở rộng

| Chức năng                                | Giai đoạn |
| ---------------------------------------- | --------- |
| Gantt chart                              | Phase sau |
| Sprint/Scrum nâng cao                    | Phase sau |
| Time tracking theo task                  | Phase sau |
| Ước lượng effort/story point             | Phase sau |
| Quản lý phụ thuộc giữa các task          | Phase sau |
| Template dự án/task                      | Phase sau |
| Tự động hóa workflow                     | Phase sau |
| Approval workflow cho task quan trọng    | Phase sau |
| Tích hợp calendar                        | Phase sau |
| Tích hợp Google Drive/Microsoft OneDrive | Phase sau |
| Chat realtime trong dự án                | Phase sau |
| AI tóm tắt tiến độ dự án                 | Phase sau |
| AI gợi ý phân việc                       | Phase sau |
| Báo cáo năng suất cá nhân                | Phase sau |
| Quản lý ngân sách dự án                  | Phase sau |
| Quản lý khách hàng/client trong dự án    | Phase sau |

---

## 6. Định nghĩa khái niệm trong module

### 6.1 Project

`Project` là một dự án, nhóm công việc hoặc sáng kiến có mục tiêu, thành viên, trạng thái và thời gian thực hiện.

Ví dụ:

* Triển khai website công ty.
* Xây dựng hệ thống quản lý doanh nghiệp.
* Chiến dịch marketing tháng 7.
* Tuyển dụng nhân sự phòng Kỹ thuật.
* Tối ưu quy trình chấm công.

Một Project có thể có:

* Mã dự án.
* Tên dự án.
* Mô tả.
* Người quản lý dự án.
* Thành viên.
* Ngày bắt đầu.
* Ngày kết thúc dự kiến.
* Trạng thái.
* Danh sách task.
* File/tài liệu liên quan.
* Lịch sử hoạt động.

---

### 6.2 Task

`Task` là một công việc cụ thể cần được thực hiện.

Một Task có thể:

* Thuộc một Project.
* Có tiêu đề.
* Có mô tả.
* Có người giao việc.
* Có người phụ trách.
* Có deadline.
* Có trạng thái.
* Có độ ưu tiên.
* Có bình luận.
* Có file đính kèm.
* Có checklist.
* Có lịch sử thay đổi.

---

### 6.3 Assignee

`Assignee` là người được giao phụ trách task.

Một task có thể có:

* Một assignee chính.
* Nhiều assignee nếu cấu hình cho phép.
* Người theo dõi task không trực tiếp xử lý.

MVP đề xuất:

```text
Mỗi task có một assignee chính.
Có thể có thêm danh sách follower/watcher.
```

---

### 6.4 Reporter / Creator

`Reporter` hoặc `Creator` là người tạo task.

Người tạo task có thể là:

* Manager.
* Project Manager.
* Admin.
* HR nếu dùng task cho nghiệp vụ nội bộ.
* Employee nếu được cấp quyền tạo task.

---

### 6.5 Project Owner / Project Manager

`Project Owner` hoặc `Project Manager` là người chịu trách nhiệm chính cho dự án.

Người này có quyền:

* Cập nhật thông tin dự án.
* Thêm/xóa thành viên.
* Tạo task trong dự án.
* Giao task cho thành viên.
* Theo dõi tiến độ.
* Đóng dự án nếu có quyền.

---

### 6.6 Project Member

`Project Member` là nhân viên tham gia dự án.

Thành viên dự án có thể:

* Xem dự án nếu có quyền.
* Xem task trong dự án tùy role.
* Nhận task.
* Cập nhật task được giao.
* Bình luận trong task.
* Upload file nếu có quyền.

---

### 6.7 Watcher / Follower

`Watcher` là người theo dõi task nhưng không trực tiếp xử lý.

Watcher nhận thông báo khi:

* Task được cập nhật.
* Task có comment mới.
* Task đổi trạng thái.
* Task sắp đến hạn hoặc quá hạn nếu cấu hình.

---

### 6.8 Kanban Board

`Kanban Board` là giao diện hiển thị task theo cột trạng thái.

Ví dụ cột:

```text
Todo → In Progress → In Review → Done
```

Người dùng có thể kéo thả task giữa các cột nếu có quyền cập nhật trạng thái.

---

### 6.9 Task Priority

`Priority` là mức độ ưu tiên của task.

Giá trị đề xuất:

| Mã     | Tên        | Ý nghĩa        |
| ------ | ---------- | -------------- |
| Low    | Thấp       | Không gấp      |
| Medium | Trung bình | Mức mặc định   |
| High   | Cao        | Cần ưu tiên    |
| Urgent | Khẩn cấp   | Cần xử lý ngay |

---

### 6.10 Task Status

Trạng thái task đề xuất:

| Mã trạng thái | Tên hiển thị | Ý nghĩa                              |
| ------------- | ------------ | ------------------------------------ |
| Todo          | Cần làm      | Task mới, chưa bắt đầu               |
| In Progress   | Đang làm     | Assignee đang xử lý                  |
| In Review     | Chờ kiểm tra | Đã làm xong, chờ review              |
| Done          | Hoàn thành   | Task đã hoàn tất                     |
| Cancelled     | Đã hủy       | Task không còn thực hiện             |
| Overdue       | Quá hạn      | Task quá deadline và chưa hoàn thành |

Lưu ý:

* `Overdue` có thể là trạng thái tính toán, không nhất thiết là trạng thái lưu trực tiếp.
* Nếu `due_at < current_date` và status chưa phải Done/Cancelled, task được xem là quá hạn.

---

### 6.11 Project Status

Trạng thái dự án đề xuất:

| Mã trạng thái | Tên hiển thị   | Ý nghĩa                           |
| ------------- | -------------- | --------------------------------- |
| Planning      | Lên kế hoạch   | Dự án đang chuẩn bị               |
| Active        | Đang thực hiện | Dự án đang chạy                   |
| On Hold       | Tạm dừng       | Dự án tạm ngưng                   |
| Completed     | Hoàn thành     | Dự án đã hoàn tất                 |
| Cancelled     | Đã hủy         | Dự án bị hủy                      |
| Archived      | Lưu trữ        | Dự án không còn hiển thị mặc định |

---

## 7. Nhóm người dùng liên quan

| Vai trò         | Mô tả trong module TASK                                              |
| --------------- | -------------------------------------------------------------------- |
| Super Admin     | Toàn quyền với tất cả dự án/task                                     |
| Admin công ty   | Có thể quản lý dự án/task trong công ty nếu được cấp quyền           |
| HR              | Có thể xem/giao task nghiệp vụ HR nếu được cấp quyền                 |
| Manager         | Tạo dự án, giao task, theo dõi task team nếu được cấp quyền          |
| Project Manager | Vai trò nghiệp vụ trong từng dự án, quản lý project cụ thể           |
| Employee        | Xem và cập nhật task được giao                                       |
| Watcher         | Theo dõi task/project được thêm vào                                  |
| Payroll Officer | Không mặc định dùng TASK, có thể dùng task nội bộ nếu được cấp quyền |
| Recruiter       | Có thể dùng task tuyển dụng ở phase sau                              |
| Asset Manager   | Có thể dùng task tài sản ở phase sau                                 |
| Office Admin    | Có thể dùng task hành chính ở phase sau                              |

---

## 8. Quyền trong module TASK

### 8.1 Quy ước mã quyền

Cấu trúc:

```text
TASK.RESOURCE.ACTION
```

Ví dụ:

```text
TASK.PROJECT.VIEW
TASK.PROJECT.CREATE
TASK.TASK.UPDATE
TASK.TASK.ASSIGN
```

---

### 8.2 Danh sách quyền TASK trong MVP

> **TK-1 (chuẩn = API-06 §8):** đã bổ sung quyền file cấp **dự án** (`TASK.PROJECT.FILE_UPLOAD/DELETE`) mà API/BE dùng nhưng SPEC bản cũ thiếu — tách biệt với quyền file cấp **task** (`TASK.TASK.FILE_UPLOAD/DELETE`).

| Mã quyền                   | Mô tả                              |
| -------------------------- | ---------------------------------- |
| TASK.PROJECT.VIEW          | Xem danh sách và chi tiết dự án    |
| TASK.PROJECT.CREATE        | Tạo dự án                          |
| TASK.PROJECT.UPDATE        | Cập nhật dự án                     |
| TASK.PROJECT.DELETE        | Xóa mềm dự án                      |
| TASK.PROJECT.CLOSE         | Đóng/hoàn thành dự án              |
| TASK.PROJECT.ARCHIVE       | Lưu trữ dự án                      |
| TASK.PROJECT.MANAGE_MEMBER | Thêm/xóa/cập nhật thành viên dự án |
| TASK.PROJECT.FILE_UPLOAD   | Upload file dự án                  |
| TASK.PROJECT.FILE_DELETE   | Xóa file dự án                     |
| TASK.PROJECT.VIEW_REPORT   | Xem báo cáo tiến độ dự án          |
| TASK.TASK.VIEW             | Xem task                           |
| TASK.TASK.CREATE           | Tạo task                           |
| TASK.TASK.UPDATE           | Cập nhật task                      |
| TASK.TASK.DELETE           | Xóa mềm task                       |
| TASK.TASK.ASSIGN           | Giao task hoặc đổi assignee        |
| TASK.TASK.UPDATE_STATUS    | Cập nhật trạng thái task           |
| TASK.TASK.UPDATE_PRIORITY  | Cập nhật độ ưu tiên                |
| TASK.TASK.UPDATE_DEADLINE  | Cập nhật deadline                  |
| TASK.TASK.COMMENT          | Bình luận trong task               |
| TASK.TASK.FILE_UPLOAD      | Upload file vào task               |
| TASK.TASK.FILE_DELETE      | Xóa file trong task                |
| TASK.TASK.WATCH            | Theo dõi/bỏ theo dõi task          |
| TASK.TASK.VIEW_KANBAN      | Xem Kanban board                   |
| TASK.TASK.EXPORT           | Xuất danh sách task                |
| TASK.AUDIT_LOG.VIEW        | Xem lịch sử hoạt động task/project |

---

### 8.3 Phân quyền theo data scope

| Scope      | Ý nghĩa trong TASK                            |
| ---------- | --------------------------------------------- |
| Own        | Chỉ task do mình tạo, được giao hoặc theo dõi |
| Team       | Task của nhân viên thuộc team mình quản lý    |
| Department | Task thuộc phòng ban mình quản lý             |
| Project    | Task thuộc dự án mà mình là thành viên        |
| Company    | Tất cả task/dự án trong công ty               |
| System     | Tất cả task/dự án toàn hệ thống               |

Ví dụ:

```text
Employee có TASK.TASK.VIEW với scope Own.
Manager có TASK.TASK.VIEW với scope Team hoặc Project.
Project Manager có TASK.TASK.VIEW với scope Project.
Admin có TASK.TASK.VIEW với scope Company nếu được cấp quyền.
Super Admin có TASK.TASK.VIEW với scope System.
```

---

## 9. Ma trận phân quyền MVP cho module TASK

| Chức năng                | Super Admin | Admin công ty        | HR                   | Manager                 | Project Manager        | Employee                      |
| ------------------------ | ----------- | -------------------- | -------------------- | ----------------------- | ---------------------- | ----------------------------- |
| Xem danh sách dự án      | Có          | Có nếu được cấp      | Có nếu được cấp      | Có theo scope           | Có với dự án phụ trách | Có nếu là member              |
| Tạo dự án                | Có          | Có nếu được cấp      | Có nếu được cấp      | Có nếu được cấp         | Có nếu được cấp        | Không mặc định                |
| Cập nhật dự án           | Có          | Có nếu được cấp      | Có nếu được cấp      | Có với dự án quản lý    | Có với dự án phụ trách | Không mặc định                |
| Đóng/hủy dự án           | Có          | Có nếu được cấp      | Không mặc định       | Có nếu là owner         | Có nếu là owner        | Không                         |
| Quản lý thành viên       | Có          | Có nếu được cấp      | Không mặc định       | Có nếu là owner         | Có nếu là owner        | Không                         |
| Xem danh sách task       | Có          | Có nếu được cấp      | Có nếu được cấp      | Có theo team/project    | Có theo project        | Chỉ task liên quan            |
| Tạo task                 | Có          | Có nếu được cấp      | Có nếu được cấp      | Có                      | Có                     | Có nếu được cấp               |
| Giao task                | Có          | Có nếu được cấp      | Có nếu được cấp      | Có trong team/project   | Có trong project       | Không mặc định                |
| Cập nhật task            | Có          | Có nếu được cấp      | Có nếu được cấp      | Có theo scope           | Có theo project        | Có giới hạn với task của mình |
| Cập nhật trạng thái task | Có          | Có nếu được cấp      | Có nếu được cấp      | Có theo scope           | Có theo project        | Có nếu là assignee            |
| Bình luận task           | Có          | Có nếu xem được task | Có nếu xem được task | Có nếu xem được task    | Có nếu xem được task   | Có nếu xem được task          |
| Upload file task         | Có          | Có nếu được cấp      | Có nếu được cấp      | Có nếu xem được task    | Có nếu xem được task   | Có nếu được cấp               |
| Xóa task                 | Có          | Có nếu được cấp      | Không mặc định       | Có nếu là creator/owner | Có nếu là owner        | Không mặc định                |
| Xem báo cáo dự án        | Có          | Có nếu được cấp      | Có nếu được cấp      | Có theo scope           | Có với dự án phụ trách | Không mặc định                |
| Xuất task                | Có          | Có nếu được cấp      | Có nếu được cấp      | Có nếu được cấp         | Có nếu được cấp        | Không mặc định                |

---

## 10. Danh sách chức năng chi tiết

| Mã chức năng  | Tên chức năng                     | Mô tả ngắn                             |
| ------------- | --------------------------------- | -------------------------------------- |
| TASK-FUNC-001 | Xem danh sách dự án               | Hiển thị dự án theo quyền và scope     |
| TASK-FUNC-002 | Tạo dự án                         | Tạo project mới                        |
| TASK-FUNC-003 | Cập nhật dự án                    | Sửa tên, mô tả, thời gian, trạng thái  |
| TASK-FUNC-004 | Đóng/hủy/xóa mềm dự án            | Kết thúc hoặc vô hiệu hóa dự án        |
| TASK-FUNC-005 | Quản lý thành viên dự án          | Thêm/xóa thành viên dự án              |
| TASK-FUNC-006 | Phân vai trò thành viên dự án     | Owner, Manager, Member, Viewer         |
| TASK-FUNC-007 | Xem danh sách task                | Hiển thị task theo bộ lọc              |
| TASK-FUNC-008 | Tạo task                          | Tạo công việc mới                      |
| TASK-FUNC-009 | Giao task                         | Gán assignee, watcher                  |
| TASK-FUNC-010 | Cập nhật thông tin task           | Sửa tiêu đề, mô tả, deadline, priority |
| TASK-FUNC-011 | Cập nhật trạng thái task          | Todo, In Progress, In Review, Done     |
| TASK-FUNC-012 | Xem việc của tôi                  | Danh sách task liên quan user hiện tại |
| TASK-FUNC-013 | Kanban board                      | Xem và kéo thả task theo trạng thái    |
| TASK-FUNC-014 | Bình luận task                    | Trao đổi trong task                    |
| TASK-FUNC-015 | Đính kèm file                     | Upload/xem/xóa file task               |
| TASK-FUNC-016 | Checklist                         | Thêm checklist nhỏ trong task          |
| TASK-FUNC-017 | Theo dõi task quá hạn/sắp đến hạn | Cảnh báo task cần xử lý                |
| TASK-FUNC-018 | Tìm kiếm/lọc/sắp xếp task         | Tìm task theo nhiều tiêu chí           |
| TASK-FUNC-019 | Lịch sử hoạt động                 | Ghi và xem activity log                |
| TASK-FUNC-020 | Báo cáo tiến độ dự án             | Thống kê task theo trạng thái          |

---

## 11. Luồng nghiệp vụ tổng quan

### 11.1 Luồng tạo dự án

```text
Manager/Admin đăng nhập
→ Vào menu Dự án & Công việc
→ Chọn Tạo dự án
→ Nhập thông tin dự án
→ Chọn Project Owner/Project Manager
→ Chọn ngày bắt đầu/ngày kết thúc dự kiến
→ Thêm thành viên nếu có
→ Bấm Lưu
→ Hệ thống kiểm tra quyền
→ Hệ thống validate dữ liệu
→ Hệ thống tạo dự án
→ Hệ thống ghi activity log
→ Thành viên được thêm nhận thông báo
```

---

### 11.2 Luồng thêm thành viên dự án

```text
Project Owner mở chi tiết dự án
→ Vào tab Thành viên
→ Bấm Thêm thành viên
→ Chọn nhân viên từ danh sách HR
→ Chọn vai trò trong dự án
→ Bấm Lưu
→ Hệ thống kiểm tra nhân viên hợp lệ
→ Hệ thống thêm thành viên vào dự án
→ Thành viên nhận thông báo
```

---

### 11.3 Luồng tạo task trong dự án

```text
Người có quyền mở dự án
→ Chọn Tạo task
→ Nhập tiêu đề task
→ Nhập mô tả
→ Chọn assignee
→ Chọn priority
→ Chọn deadline
→ Thêm checklist/file nếu có
→ Bấm Lưu
→ Hệ thống kiểm tra quyền
→ Hệ thống kiểm tra assignee hợp lệ
→ Hệ thống tạo task
→ Assignee nhận thông báo task mới
```

---

### 11.4 Luồng cập nhật trạng thái task

```text
Assignee mở task được giao
→ Chọn trạng thái mới
→ Nhập ghi chú nếu cần
→ Bấm Cập nhật
→ Hệ thống kiểm tra quyền cập nhật trạng thái
→ Hệ thống cập nhật task
→ Hệ thống ghi activity log
→ Người liên quan nhận thông báo
```

---

### 11.5 Luồng bình luận task

```text
Người dùng mở task có quyền xem
→ Nhập nội dung bình luận
→ Gắn mention nếu cần
→ Bấm Gửi
→ Hệ thống lưu comment
→ Hệ thống gửi thông báo cho người được mention hoặc người liên quan
```

---

### 11.6 Luồng xem việc của tôi

```text
Employee đăng nhập
→ Vào menu Việc của tôi
→ Hệ thống lấy user hiện tại
→ Hệ thống tìm employee_id liên kết
→ Hệ thống lấy task do user được giao/tạo/theo dõi
→ Hiển thị task theo nhóm: Hôm nay, Sắp đến hạn, Quá hạn, Đang làm, Chờ review
```

---

### 11.7 Luồng Kanban board

```text
Người dùng mở dự án
→ Chọn tab Kanban
→ Hệ thống lấy task trong dự án theo quyền
→ Hiển thị task theo cột trạng thái
→ Người dùng kéo task sang cột khác
→ Hệ thống kiểm tra quyền cập nhật trạng thái
→ Hệ thống cập nhật trạng thái task
→ Ghi activity log
```

---

### 11.8 Luồng task quá hạn

```text
Hệ thống kiểm tra task chưa Done/Cancelled
→ So sánh due_at với ngày hiện tại
→ Nếu due_at đã qua, task được đánh dấu quá hạn
→ Dashboard hiển thị task quá hạn
→ NOTI gửi cảnh báo nếu cấu hình
```

---

## 12. Danh sách màn hình

| Mã màn hình     | Tên màn hình                   | Người dùng truy cập                |
| --------------- | ------------------------------ | ---------------------------------- |
| TASK-SCREEN-001 | Danh sách dự án                | Admin, Manager, Project Member     |
| TASK-SCREEN-002 | Tạo/chỉnh sửa dự án            | Người có quyền tạo/sửa dự án       |
| TASK-SCREEN-003 | Chi tiết dự án                 | Thành viên dự án, người có quyền   |
| TASK-SCREEN-004 | Thành viên dự án               | Project Owner/Manager              |
| TASK-SCREEN-005 | Danh sách task                 | Người có quyền xem task            |
| TASK-SCREEN-006 | Tạo/chỉnh sửa task             | Người có quyền tạo/sửa task        |
| TASK-SCREEN-007 | Chi tiết task                  | Người có quyền xem task            |
| TASK-SCREEN-008 | Kanban board                   | Người có quyền xem board           |
| TASK-SCREEN-009 | Việc của tôi                   | Tất cả user có employee liên kết   |
| TASK-SCREEN-010 | Task quá hạn                   | Manager, Project Manager, Employee |
| TASK-SCREEN-011 | Báo cáo tiến độ dự án          | Manager, Project Manager, Admin    |
| TASK-SCREEN-012 | Lịch sử hoạt động task/project | Người có quyền xem log             |

---

## 13. Chi tiết màn hình

### 13.1 TASK-SCREEN-001: Danh sách dự án

#### Mục đích

Hiển thị danh sách dự án theo quyền và phạm vi dữ liệu của người dùng.

#### Thành phần giao diện

* Tiêu đề: Dự án.
* Nút Tạo dự án.
* Ô tìm kiếm.
* Bộ lọc trạng thái.
* Bộ lọc người quản lý dự án.
* Bộ lọc phòng ban.
* Bộ lọc thời gian.
* Bộ lọc vai trò của tôi trong dự án.
* Bảng danh sách dự án.
* Phân trang.
* Menu hành động từng dòng.

#### Bộ lọc

| Bộ lọc          | Mô tả                                                     |
| --------------- | --------------------------------------------------------- |
| Từ khóa         | Tìm theo mã dự án, tên dự án                              |
| Trạng thái      | Planning, Active, On Hold, Completed, Cancelled, Archived |
| Project Owner   | Lọc theo người phụ trách                                  |
| Phòng ban       | Lọc theo phòng ban liên quan                              |
| Ngày bắt đầu    | Từ ngày - đến ngày                                        |
| Ngày kết thúc   | Từ ngày - đến ngày                                        |
| Vai trò của tôi | Owner, Manager, Member, Viewer                            |
| Có task quá hạn | Có/Không                                                  |

#### Cột hiển thị

| Cột           | Mô tả                |
| ------------- | -------------------- |
| Mã dự án      | project_code         |
| Tên dự án     | project_name         |
| Owner/Manager | Người phụ trách      |
| Thành viên    | Số lượng thành viên  |
| Task          | Tổng task            |
| Hoàn thành    | Số task Done         |
| Quá hạn       | Số task quá hạn      |
| Tiến độ       | Phần trăm hoàn thành |
| Ngày bắt đầu  | start_date           |
| Deadline      | end_date             |
| Trạng thái    | status               |
| Hành động     | Xem/Sửa/Đóng/Lưu trữ |

#### Hành động

| Hành động     | Permission           |
| ------------- | -------------------- |
| Xem danh sách | TASK.PROJECT.VIEW    |
| Tạo dự án     | TASK.PROJECT.CREATE  |
| Xem chi tiết  | TASK.PROJECT.VIEW    |
| Sửa dự án     | TASK.PROJECT.UPDATE  |
| Đóng dự án    | TASK.PROJECT.CLOSE   |
| Lưu trữ       | TASK.PROJECT.ARCHIVE |
| Xóa mềm       | TASK.PROJECT.DELETE  |

---

### 13.2 TASK-SCREEN-002: Tạo/chỉnh sửa dự án

#### Mục đích

Cho phép người có quyền tạo hoặc cập nhật dự án.

#### Trường dữ liệu

| Trường        | Kiểu dữ liệu | Bắt buộc | Ghi chú                               |
| ------------- | ------------ | -------- | ------------------------------------- |
| project_code  | String       | Có       | Unique trong công ty                  |
| project_name  | String       | Có       | Tên dự án                             |
| description   | Text         | Không    | Mô tả dự án                           |
| owner_id      | Employee ID  | Có       | Người chịu trách nhiệm                |
| department_id | ID           | Không    | Phòng ban liên quan                   |
| start_date    | Date         | Không    | Ngày bắt đầu                          |
| end_date      | Date         | Không    | Ngày kết thúc dự kiến                 |
| priority      | Select       | Không    | Low/Medium/High/Urgent                |
| status        | Select       | Có       | Mặc định Planning hoặc Active         |
| visibility    | Select       | Có       | Private/Internal/Public trong công ty |
| note          | Text         | Không    | Ghi chú                               |

#### Validate

| Trường       | Rule                                   |
| ------------ | -------------------------------------- |
| project_code | Bắt buộc, unique                       |
| project_name | Bắt buộc, không quá độ dài cấu hình    |
| owner_id     | Phải là employee hợp lệ                |
| end_date     | Không được nhỏ hơn start_date          |
| status       | Phải thuộc danh sách trạng thái hợp lệ |
| visibility   | Phải thuộc danh sách cấu hình hợp lệ   |

---

### 13.3 TASK-SCREEN-003: Chi tiết dự án

#### Mục đích

Hiển thị toàn bộ thông tin dự án, task, thành viên và tiến độ.

#### Cấu trúc màn hình

| Tab        | Nội dung                          |
| ---------- | --------------------------------- |
| Tổng quan  | Thông tin dự án, tiến độ, số task |
| Task       | Danh sách task thuộc dự án        |
| Kanban     | Board task theo trạng thái        |
| Thành viên | Danh sách thành viên dự án        |
| File       | Tài liệu dự án nếu có             |
| Báo cáo    | Thống kê tiến độ                  |
| Hoạt động  | Lịch sử thay đổi                  |

#### Thông tin tổng quan

| Trường          | Mô tả               |
| --------------- | ------------------- |
| Tên dự án       | project_name        |
| Mã dự án        | project_code        |
| Mô tả           | description         |
| Owner           | Người phụ trách     |
| Trạng thái      | status              |
| Ngày bắt đầu    | start_date          |
| Ngày kết thúc   | end_date            |
| Tổng task       | total_tasks         |
| Task hoàn thành | done_tasks          |
| Task quá hạn    | overdue_tasks       |
| Tiến độ         | progress_percentage |

---

### 13.4 TASK-SCREEN-004: Thành viên dự án

#### Mục đích

Quản lý danh sách thành viên tham gia dự án.

#### Cột hiển thị

| Cột           | Mô tả                      |
| ------------- | -------------------------- |
| Nhân viên     | employee_name              |
| Mã nhân viên  | employee_code              |
| Phòng ban     | department_name            |
| Vai trò dự án | project_role               |
| Ngày tham gia | joined_at                  |
| Trạng thái    | Active/Removed             |
| Hành động     | Đổi vai trò/Xóa khỏi dự án |

#### Vai trò thành viên dự án

| Vai trò | Ý nghĩa                                  |
| ------- | ---------------------------------------- |
| Owner   | Chủ dự án, quyền cao nhất trong project  |
| Manager | Quản lý task và thành viên trong project |
| Member  | Thực hiện task                           |
| Viewer  | Chỉ xem dự án/task                       |

---

### 13.5 TASK-SCREEN-005: Danh sách task

#### Mục đích

Hiển thị danh sách task theo quyền và bộ lọc.

#### Bộ lọc

| Bộ lọc             | Mô tả                                     |
| ------------------ | ----------------------------------------- |
| Từ khóa            | Tiêu đề, mã task, mô tả                   |
| Dự án              | Lọc theo project                          |
| Người phụ trách    | main_assignee_employee_id                               |
| Người tạo          | created_by                                |
| Trạng thái         | Todo/In Progress/In Review/Done/Cancelled |
| Priority           | Low/Medium/High/Urgent                    |
| Deadline           | Từ ngày - đến ngày                        |
| Task quá hạn       | Có/Không                                  |
| Task của tôi       | Có/Không                                  |
| Phòng ban assignee | department_id                             |
| Tag                | Nếu hỗ trợ tag                            |

#### Cột hiển thị

| Cột           | Mô tả                       |
| ------------- | --------------------------- |
| Mã task       | task_code                   |
| Tiêu đề       | title                       |
| Dự án         | project_name                |
| Assignee      | Người phụ trách             |
| Priority      | Độ ưu tiên                  |
| Trạng thái    | status                      |
| Deadline      | due_at                    |
| Quá hạn       | overdue flag                |
| Người tạo     | creator                     |
| Cập nhật cuối | updated_at                  |
| Hành động     | Xem/Sửa/Cập nhật trạng thái |

---

### 13.6 TASK-SCREEN-006: Tạo/chỉnh sửa task

#### Mục đích

Cho phép người có quyền tạo hoặc cập nhật task.

#### Trường dữ liệu

| Trường          | Kiểu dữ liệu   | Bắt buộc              | Ghi chú             |
| --------------- | -------------- | --------------------- | ------------------- |
| project_id      | Select         | Không/Có tùy cấu hình | Dự án chứa task     |
| task_code       | String         | Có                    | Có thể tự sinh      |
| title           | String         | Có                    | Tiêu đề task        |
| description     | Rich Text/Text | Không                 | Mô tả chi tiết      |
| main_assignee_employee_id     | Employee ID    | Không/Có tùy cấu hình | Người phụ trách     |
| reporter_employee_id     | Employee ID    | Có                    | Người tạo/giao      |
| priority        | Select         | Có                    | Mặc định Medium     |
| status          | Select         | Có                    | Mặc định Todo       |
| start_at        | DateTime       | Không                 | Thời điểm bắt đầu   |
| due_at        | DateTime/Date  | Không                 | Deadline            |
| estimated_minutes | Number       | Không                 | Ước lượng số phút làm |
| parent_task_id  | ID             | Không                 | Nếu hỗ trợ task cha |
| tags            | Array          | Không                 | Nhãn task           |
| watchers        | Array          | Không                 | Người theo dõi      |
| attachments     | File           | Không                 | File đính kèm       |
| checklist       | Array          | Không                 | Checklist           |

#### Validate

| Trường          | Rule                                                              |
| --------------- | ----------------------------------------------------------------- |
| title           | Bắt buộc                                                          |
| project_id      | Nếu task thuộc dự án thì project phải tồn tại và active           |
| main_assignee_employee_id     | Phải là employee hợp lệ                                           |
| main_assignee_employee_id     | Nếu project bắt buộc member thì assignee phải là thành viên dự án |
| due_at        | Không được nhỏ hơn start_at nếu có start_at                       |
| priority        | Phải thuộc danh sách hợp lệ                                       |
| status          | Phải thuộc workflow hợp lệ                                        |
| estimated_minutes | Không âm                                                        |

---

### 13.7 TASK-SCREEN-007: Chi tiết task

#### Mục đích

Hiển thị chi tiết task và cho phép người có quyền thao tác.

#### Thành phần giao diện

* Tiêu đề task.
* Mã task.
* Trạng thái.
* Priority.
* Assignee.
* Reporter/Creator.
* Project.
* Deadline.
* Mô tả.
* Checklist.
* File đính kèm.
* Bình luận.
* Lịch sử hoạt động.
* Nút cập nhật trạng thái.
* Nút chỉnh sửa.
* Nút xóa mềm nếu có quyền.

#### Hành động nhanh

| Hành động               | Điều kiện                               |
| ----------------------- | --------------------------------------- |
| Chuyển sang In Progress | User có quyền cập nhật trạng thái       |
| Chuyển sang In Review   | User có quyền cập nhật trạng thái       |
| Chuyển sang Done        | User có quyền cập nhật trạng thái       |
| Đổi assignee            | User có quyền TASK.TASK.ASSIGN          |
| Đổi deadline            | User có quyền TASK.TASK.UPDATE_DEADLINE |
| Bình luận               | User có quyền TASK.TASK.COMMENT         |
| Upload file             | User có quyền TASK.TASK.FILE_UPLOAD     |

---

### 13.8 TASK-SCREEN-008: Kanban board

#### Mục đích

Hiển thị task theo cột trạng thái để dễ theo dõi tiến độ.

#### Cột mặc định

| Cột        | Trạng thái  |
| ---------- | ----------- |
| Cần làm    | Todo        |
| Đang làm   | In Progress |
| Chờ review | In Review   |
| Hoàn thành | Done        |
| Đã hủy     | Cancelled   |

#### Card task hiển thị

| Thông tin          | Mô tả                      |
| ------------------ | -------------------------- |
| Tiêu đề            | title                      |
| Priority           | priority                   |
| Assignee           | avatar/name                |
| Deadline           | due_at                   |
| Comment count      | Số bình luận               |
| Attachment count   | Số file                    |
| Checklist progress | Số checklist đã hoàn thành |
| Overdue badge      | Nếu quá hạn                |

* Badge Comment/Attachment/Checklist **chỉ hiển thị khi count tương ứng > 0** — card không có tín hiệu nào (0 bình luận, 0 file, 0 checklist) thì không hiện badge đó (tránh nhiễu thị giác).
* Assignee hiển thị bằng **avatar chữ cái viết tắt (initials)** thay vì text tên thô; card không có người phụ trách hiển thị avatar rỗng/placeholder.
* Card ở trạng thái **Done hoặc Cancelled** hiển thị phân biệt: nền/viền mờ (muted) và **tiêu đề gạch ngang** — giúp phân biệt nhanh task đã xong/đã hủy với task còn hoạt động, không cần đọc cột.

#### Quy tắc kéo thả

* Chỉ người có quyền cập nhật trạng thái mới kéo thả được.
* Nếu task bị khóa hoặc dự án đã đóng, không kéo thả được.
* Nếu workflow không cho chuyển trạng thái trực tiếp, hệ thống chặn.
* Sau khi kéo thả thành công, ghi activity log.

#### Lọc theo người phụ trách (client-side)

* Board có dải chip lọc theo assignee, gồm: chip **"Tất cả"** (bỏ lọc, mặc định) + 1 chip/người phụ trách + chip **"Chưa giao"** (task có `main_assignee_employee_id = null`).
* Danh sách người phụ trách trong dải chip **suy ra từ chính tập task đang hiển thị trên board** (duyệt qua toàn bộ cột) — **không** gọi thêm API danh sách thành viên/nhân sự nào khác; chip "Chưa giao" chỉ xuất hiện nếu board có ít nhất 1 task chưa gán.
* Lọc chạy **hoàn toàn phía client** trong từng cột (không gọi lại API, không đổi query lên server) — chọn 1 assignee (hoặc "Chưa giao") thì mỗi cột chỉ hiển thị các card khớp điều kiện đó; số đếm ở header cột vẫn phản ánh tổng số task gốc của cột (không đổi theo bộ lọc).
* Bộ lọc **kết hợp được** với kéo-thả hiện có: kéo thả vẫn hoạt động bình thường trên tập card đang lọc, không ảnh hưởng tới quyền (`TASK.TASK.UPDATE_STATUS`) hay dữ liệu gốc của board.
* Lọc theo assignee **không** thay đổi quyền xem/kéo thả và **không** phát sinh lời gọi API mới — chỉ là view-state cục bộ trên dữ liệu Kanban đã tải.

---

### 13.9 TASK-SCREEN-009: Việc của tôi

#### Mục đích

Cho phép Employee xem tất cả task liên quan đến mình.

#### Nhóm hiển thị đề xuất

| Nhóm         | Mô tả                                |
| ------------ | ------------------------------------ |
| Hôm nay      | Task có deadline hôm nay             |
| Sắp đến hạn  | Task deadline trong số ngày cấu hình |
| Quá hạn      | Task đã quá hạn                      |
| Đang làm     | Task trạng thái In Progress          |
| Chờ review   | Task In Review                       |
| Tôi tạo      | Task do mình tạo                     |
| Tôi theo dõi | Task mình là watcher                 |

#### Quy tắc

* User phải liên kết employee.
* Employee chỉ thấy task của mình hoặc task được phép xem.
* Không hiển thị task thuộc dự án private nếu user không phải member.
* Task Done/Cancelled có thể ẩn mặc định.

---

### 13.10 TASK-SCREEN-010: Task quá hạn

#### Mục đích

Hiển thị danh sách task quá hạn để Manager/Employee xử lý.

#### Điều kiện quá hạn

```text
due_at < current_datetime
AND status NOT IN (Done, Cancelled)
AND deleted_at IS NULL
```

#### Cột hiển thị

| Cột             | Mô tả                              |
| --------------- | ---------------------------------- |
| Task            | title                              |
| Dự án           | project_name                       |
| Assignee        | Người phụ trách                    |
| Deadline        | due_at                           |
| Quá hạn bao lâu | overdue_days/hours                 |
| Priority        | priority                           |
| Trạng thái      | status                             |
| Người quản lý   | project owner/manager              |
| Hành động       | Xem/Cập nhật deadline/Đổi assignee |

---

### 13.11 TASK-SCREEN-011: Báo cáo tiến độ dự án

#### Mục đích

Hiển thị thống kê tiến độ dự án ở mức cơ bản.

#### Chỉ số hiển thị

| Chỉ số             | Mô tả                           |
| ------------------ | ------------------------------- |
| Tổng task          | total_tasks                     |
| Task Todo          | todo_count                      |
| Task In Progress   | in_progress_count               |
| Task In Review     | in_review_count                 |
| Task Done          | done_count                      |
| Task Cancelled     | cancelled_count                 |
| Task quá hạn       | overdue_count                   |
| Tỷ lệ hoàn thành   | done_count / total_active_tasks |
| Task theo assignee | Số task từng người              |
| Task theo priority | Low/Medium/High/Urgent          |
| Task sắp đến hạn   | due soon                        |

---

### 13.12 TASK-SCREEN-012: Lịch sử hoạt động

#### Mục đích

Hiển thị các thay đổi quan trọng của project/task.

#### Cột hiển thị

| Cột             | Mô tả                     |
| --------------- | ------------------------- |
| Thời gian       | created_at                |
| Người thực hiện | actor                     |
| Hành động       | action                    |
| Đối tượng       | Project/Task/Comment/File |
| Dữ liệu cũ      | old_value                 |
| Dữ liệu mới     | new_value                 |
| IP/Thiết bị     | Nếu có                    |

---

## 14. Chi tiết chức năng

### 14.1 TASK-FUNC-001: Xem danh sách dự án

#### Mục tiêu

Cho phép người dùng xem danh sách dự án theo quyền và data scope.

#### Người dùng

* Super Admin
* Admin công ty
* Manager
* Project Manager
* Project Member
* HR nếu được cấp quyền

#### Điều kiện trước

* Người dùng đã đăng nhập.
* Người dùng có quyền `TASK.PROJECT.VIEW`.
* Hệ thống xác định được data scope.

#### Luồng chính

1. Người dùng vào menu Dự án & Công việc.
2. Chọn tab Dự án.
3. Hệ thống kiểm tra quyền.
4. Hệ thống xác định phạm vi dữ liệu.
5. Hệ thống lấy danh sách dự án phù hợp.
6. Hiển thị danh sách dự án.
7. Người dùng tìm kiếm/lọc/phân trang nếu cần.

#### Kết quả thành công

* Danh sách dự án hiển thị đúng scope.
* Không hiển thị dự án private nếu user không có quyền.

#### Tiêu chí nghiệm thu

* User có quyền xem được dự án.
* User không có quyền bị chặn.
* Project Member chỉ thấy dự án liên quan.
* Manager thấy dự án thuộc team/scope.
* Có tìm kiếm, lọc, phân trang.

---

### 14.2 TASK-FUNC-002: Tạo dự án

#### Mục tiêu

Cho phép người có quyền tạo dự án mới.

#### Người dùng

* Super Admin
* Admin công ty có quyền
* Manager có quyền
* Project Manager nếu được cấp quyền

#### Luồng chính

1. Người dùng vào danh sách dự án.
2. Bấm Tạo dự án.
3. Nhập thông tin dự án.
4. Chọn owner.
5. Chọn ngày bắt đầu/kết thúc nếu có.
6. Bấm Lưu.
7. Hệ thống validate dữ liệu.
8. Hệ thống tạo project.
9. Hệ thống thêm owner vào project_members.
10. Hệ thống ghi activity log.
11. Hiển thị thông báo thành công.

#### Trường hợp lỗi

| Mã lỗi       | Trường hợp                 | Thông báo                                     |
| ------------ | -------------------------- | --------------------------------------------- |
| TASK-ERR-001 | Không có quyền tạo dự án   | Bạn không có quyền tạo dự án                  |
| TASK-ERR-002 | Thiếu tên dự án            | Vui lòng nhập tên dự án                       |
| TASK-ERR-003 | Mã dự án đã tồn tại        | Mã dự án đã được sử dụng                      |
| TASK-ERR-004 | Owner không hợp lệ         | Người phụ trách dự án không hợp lệ            |
| TASK-ERR-005 | Ngày kết thúc không hợp lệ | Ngày kết thúc không được nhỏ hơn ngày bắt đầu |

#### Tiêu chí nghiệm thu

* Tạo dự án thành công với dữ liệu hợp lệ.
* Không tạo được nếu thiếu tên dự án.
* Không tạo được nếu mã dự án trùng.
* Owner được thêm vào thành viên dự án.
* Activity log được ghi.

---

### 14.3 TASK-FUNC-003: Cập nhật dự án

#### Mục tiêu

Cho phép người có quyền cập nhật thông tin dự án.

#### Luồng chính

1. Người dùng mở chi tiết dự án.
2. Bấm Chỉnh sửa.
3. Cập nhật thông tin.
4. Bấm Lưu.
5. Hệ thống kiểm tra quyền.
6. Hệ thống validate dữ liệu.
7. Hệ thống lưu thay đổi.
8. Hệ thống ghi activity log.
9. Người liên quan nhận thông báo nếu thay đổi quan trọng.

#### Quy tắc

* Không được sửa project nếu project đã Archived, trừ người có quyền đặc biệt.
* Không được đổi owner sang nhân viên inactive.
* Không được đổi trạng thái Completed nếu còn task chưa Done/Cancelled, trừ khi cấu hình cho phép.
* Mọi thay đổi quan trọng phải ghi log.

---

### 14.4 TASK-FUNC-004: Đóng/hủy/xóa mềm dự án

#### Mục tiêu

Cho phép người có quyền kết thúc, hủy hoặc xóa mềm dự án.

#### Quy tắc

* Dự án Completed không hiển thị trong danh sách Active mặc định.
* Dự án Cancelled giữ nguyên lịch sử task.
* Dự án Archived chỉ ẩn khỏi danh sách mặc định.
* Xóa dự án là xóa mềm.
* Không xóa cứng dự án trong MVP.
* Khi đóng dự án, hệ thống cảnh báo nếu còn task chưa hoàn thành.

#### Trường hợp lỗi

| Mã lỗi       | Trường hợp                | Thông báo                               |
| ------------ | ------------------------- | --------------------------------------- |
| TASK-ERR-006 | Không có quyền đóng dự án | Bạn không có quyền đóng dự án           |
| TASK-ERR-007 | Dự án không tồn tại       | Không tìm thấy dự án                    |
| TASK-ERR-008 | Dự án đã bị xóa           | Dự án không còn hoạt động               |
| TASK-ERR-009 | Còn task chưa hoàn thành  | Dự án vẫn còn công việc chưa hoàn thành |

---

### 14.5 TASK-FUNC-005: Quản lý thành viên dự án

#### Mục tiêu

Cho phép Project Owner/Manager thêm, xóa và cập nhật thành viên dự án.

#### Luồng thêm thành viên

1. Mở chi tiết dự án.
2. Vào tab Thành viên.
3. Bấm Thêm thành viên.
4. Chọn employee.
5. Chọn vai trò trong dự án.
6. Bấm Lưu.
7. Hệ thống kiểm tra employee hợp lệ.
8. Hệ thống thêm thành viên.
9. Gửi notification.

#### Quy tắc

* Chỉ employee active mới được thêm vào dự án.
* Không thêm trùng một employee vào cùng dự án.
* Không xóa owner cuối cùng khỏi dự án.
* Member bị removed không còn thấy dự án private.
* Nếu member đang có task active, khi xóa khỏi dự án cần cảnh báo.

---

### 14.6 TASK-FUNC-006: Phân vai trò thành viên dự án

#### Mục tiêu

Cho phép phân quyền nội bộ trong từng dự án.

#### Vai trò dự án

| Vai trò | Quyền gợi ý                   |
| ------- | ----------------------------- |
| Owner   | Toàn quyền trong dự án        |
| Manager | Quản lý task và thành viên    |
| Member  | Xem dự án, nhận/cập nhật task |
| Viewer  | Chỉ xem dự án/task            |

#### Quy tắc

* Project role không thay thế permission hệ thống.
* User cần có quyền hệ thống cơ bản và role dự án phù hợp.
* Owner không được tự hạ quyền nếu là owner duy nhất.
* Thay đổi role dự án phải ghi log.

---

### 14.7 TASK-FUNC-007: Xem danh sách task

#### Mục tiêu

Cho phép người dùng xem task theo quyền, scope và bộ lọc.

#### Luồng chính

1. Người dùng vào màn hình task.
2. Hệ thống kiểm tra quyền `TASK.TASK.VIEW`.
3. Hệ thống xác định data scope.
4. Hệ thống lấy danh sách task phù hợp.
5. Người dùng tìm kiếm/lọc/sắp xếp/phân trang.

#### Quy tắc

* Employee chỉ thấy task được giao, tạo, theo dõi hoặc task trong dự án được phép xem.
* Manager thấy task của team hoặc project mình quản lý.
* Admin chỉ thấy toàn công ty nếu được cấp scope Company.
* Task thuộc project private chỉ hiển thị cho thành viên hoặc người có quyền cao hơn.

---

### 14.8 TASK-FUNC-008: Tạo task

#### Mục tiêu

Cho phép tạo công việc mới.

#### Luồng chính

1. Người dùng bấm Tạo task.
2. Nhập tiêu đề.
3. Chọn project nếu có.
4. Chọn assignee.
5. Chọn priority.
6. Chọn deadline.
7. Nhập mô tả/checklist/file nếu có.
8. Bấm Lưu.
9. Hệ thống validate.
10. Hệ thống tạo task.
11. Gửi thông báo cho assignee.
12. Ghi activity log.

#### Trường hợp lỗi

| Mã lỗi       | Trường hợp                 | Thông báo                                |
| ------------ | -------------------------- | ---------------------------------------- |
| TASK-ERR-010 | Không có quyền tạo task    | Bạn không có quyền tạo công việc         |
| TASK-ERR-011 | Thiếu tiêu đề task         | Vui lòng nhập tiêu đề công việc          |
| TASK-ERR-012 | Project không hợp lệ       | Dự án không tồn tại hoặc không hoạt động |
| TASK-ERR-013 | Assignee không hợp lệ      | Người phụ trách không hợp lệ             |
| TASK-ERR-014 | Assignee không thuộc dự án | Người phụ trách chưa thuộc dự án         |
| TASK-ERR-015 | Deadline không hợp lệ      | Deadline không hợp lệ                    |

---

### 14.9 TASK-FUNC-009: Giao task

#### Mục tiêu

Cho phép người có quyền giao task cho nhân viên.

#### Quy tắc

* Người giao task phải có quyền `TASK.TASK.ASSIGN`.
* Assignee phải là employee active.
* Nếu task thuộc project, assignee nên là thành viên dự án.
* Có thể cấu hình cho phép giao task cho người ngoài dự án nhưng phải cảnh báo.
* Khi đổi assignee, assignee cũ và mới đều nhận thông báo.
* Đổi assignee phải ghi activity log.

---

### 14.10 TASK-FUNC-010: Cập nhật thông tin task

#### Mục tiêu

Cho phép người có quyền sửa thông tin task.

#### Thông tin có thể cập nhật

| Trường      | Quyền đề xuất                         |
| ----------- | ------------------------------------- |
| title       | TASK.TASK.UPDATE                      |
| description | TASK.TASK.UPDATE                      |
| main_assignee_employee_id | TASK.TASK.ASSIGN                      |
| priority    | TASK.TASK.UPDATE_PRIORITY             |
| due_at    | TASK.TASK.UPDATE_DEADLINE             |
| status      | TASK.TASK.UPDATE_STATUS               |
| tags        | TASK.TASK.UPDATE                      |
| checklist   | TASK.TASK.UPDATE                      |
| watchers    | TASK.TASK.WATCH hoặc TASK.TASK.UPDATE |

#### Quy tắc

* Assignee có thể cập nhật mô tả tiến độ nếu cấu hình cho phép.
* Assignee không được tự đổi deadline nếu không có quyền.
* Assignee không được tự đổi assignee nếu không có quyền.
* Task Done có thể bị khóa chỉnh sửa, trừ comment hoặc reopen nếu có quyền.
* Mọi thay đổi quan trọng phải ghi activity log.

---

### 14.11 TASK-FUNC-011: Cập nhật trạng thái task

#### Mục tiêu

Cho phép cập nhật trạng thái task theo workflow.

#### Bảng chuyển trạng thái chuẩn (state machine)

Đây là bảng transition chuẩn (nguồn gốc) cho toàn hệ thống; BACKEND-08 và API-06 phải conform theo bảng này.

| Từ trạng thái | Sang trạng thái hợp lệ |
| ------------- | ---------------------- |
| Todo          | In Progress, Cancelled |
| In Progress   | In Review, Done, Cancelled |
| In Review     | In Progress, Done, Cancelled |
| Done          | In Progress (reopen nếu policy cho phép) |
| Cancelled     | (terminal — không reopen) |

```text
Todo        → In Progress | Cancelled
In Progress → In Review | Done | Cancelled
In Review   → In Progress | Done | Cancelled
Done        → In Progress (reopen)
Cancelled   → (terminal)
```

#### Quy tắc

* Assignee có thể chuyển Todo → In Progress.
* Assignee có thể chuyển In Progress → In Review hoặc Done tùy cấu hình.
* Manager/Project Manager có thể chuyển In Review → Done.
* `Cancelled` là trạng thái cuối, không cho reopen về Todo.
* Task Done có thể không cho sửa nếu project đã đóng; chỉ reopen về In Progress nếu policy cho phép.
* Nếu checklist bắt buộc hoàn thành trước Done, hệ thống chặn Done khi còn checklist chưa xong.
* Mọi thay đổi trạng thái phải ghi log.

#### Trường hợp lỗi

| Mã lỗi       | Trường hợp                         | Thông báo                                         |
| ------------ | ---------------------------------- | ------------------------------------------------- |
| TASK-ERR-016 | Không có quyền cập nhật trạng thái | Bạn không có quyền cập nhật trạng thái công việc  |
| TASK-ERR-017 | Chuyển trạng thái không hợp lệ     | Không thể chuyển sang trạng thái này              |
| TASK-ERR-018 | Checklist chưa hoàn thành          | Vui lòng hoàn thành checklist trước khi đóng task |
| TASK-ERR-019 | Task đã bị hủy                     | Công việc đã bị hủy, không thể cập nhật           |

---

### 14.12 TASK-FUNC-012: Xem việc của tôi

#### Mục tiêu

Cho phép người dùng xem các task liên quan đến mình.

#### Điều kiện

* User đã đăng nhập.
* User liên kết với employee.
* User có quyền `TASK.TASK.VIEW`.

#### Dữ liệu hiển thị

* Task được giao cho tôi.
* Task do tôi tạo.
* Task tôi đang theo dõi.
* Task trong dự án tôi tham gia.
* Task quá hạn của tôi.
* Task sắp đến hạn của tôi.

#### Tiêu chí nghiệm thu

* Employee xem được task của mình.
* Không xem được task không liên quan nếu thiếu quyền.
* Có lọc theo trạng thái, deadline, priority.
* Task quá hạn được hiển thị rõ.

---

### 14.13 TASK-FUNC-013: Kanban board

#### Mục tiêu

Hiển thị task theo trạng thái dạng board.

#### Quy tắc

* Người có quyền view kanban mới truy cập được.
* Người không có quyền update status chỉ xem, không kéo thả.
* Kéo thả task phải gọi API cập nhật trạng thái.
* Backend kiểm tra workflow hợp lệ.
* Mọi thao tác kéo thả thành công ghi activity log.

---

### 14.14 TASK-FUNC-014: Bình luận trong task

#### Mục tiêu

Cho phép người liên quan trao đổi trong task.

#### Chức năng con

* Thêm comment.
* Sửa comment của chính mình nếu cấu hình cho phép.
* Xóa comment của chính mình hoặc của người khác nếu có quyền.
* Mention người dùng.
* Gửi notification khi có mention hoặc comment mới.

#### Quy tắc

* Chỉ người xem được task mới comment được.
* Comment không được rỗng.
* Comment đã xóa nên là soft delete.
* Mention người không có quyền xem task cần cảnh báo.
* Nội dung comment cần lưu người tạo và thời gian tạo.

---

### 14.15 TASK-FUNC-015: Đính kèm file trong task

#### Mục tiêu

Cho phép upload file liên quan đến task.

#### Định dạng file đề xuất

* PDF
* DOC/DOCX
* XLS/XLSX
* JPG/JPEG
* PNG
* ZIP nếu cấu hình cho phép

#### Quy tắc

* Chỉ người có quyền upload mới upload được.
* File phải gắn với task_id.
* Có giới hạn dung lượng file.
* File bị xóa là soft delete.
* File nhạy cảm cần phân quyền nếu có.
* Upload/xóa file phải ghi activity log.

---

### 14.16 TASK-FUNC-016: Checklist trong task

#### Mục tiêu

Cho phép chia nhỏ task thành các đầu việc nhỏ.

#### Dữ liệu checklist

| Trường      | Mô tả                     |
| ----------- | ------------------------- |
| title       | Nội dung checklist        |
| is_done     | Đã hoàn thành chưa        |
| done_by     | Người đánh dấu hoàn thành |
| done_at     | Thời gian hoàn thành      |
| order_index | Thứ tự hiển thị           |

#### Quy tắc

* Checklist thuộc một task.
* Người có quyền cập nhật task được thêm/sửa checklist.
* Assignee có thể tick hoàn thành checklist nếu cấu hình cho phép.
* Nếu cấu hình bắt buộc checklist hoàn thành trước Done, hệ thống kiểm tra khi đóng task.

---

### 14.17 TASK-FUNC-017: Theo dõi task quá hạn/sắp đến hạn

#### Mục tiêu

Giúp người dùng và Manager nhận biết task cần xử lý.

#### Rule task sắp đến hạn

```text
due_at nằm trong khoảng current_datetime đến current_datetime + số ngày cấu hình
AND status NOT IN (Done, Cancelled)
```

Mặc định gợi ý:

```text
Sắp đến hạn = deadline trong 24 giờ tới
```

#### Rule task quá hạn

```text
due_at < current_datetime
AND status NOT IN (Done, Cancelled)
```

#### Thông báo

* Gửi cho assignee.
* Gửi cho creator nếu cấu hình.
* Gửi cho project manager nếu quá hạn lâu.
* Hiển thị trên Dashboard.

---

### 14.18 TASK-FUNC-018: Tìm kiếm, lọc, sắp xếp task

#### Mục tiêu

Cho phép người dùng tìm task nhanh.

#### Tìm kiếm theo từ khóa

Áp dụng cho:

* task_code
* title
* description
* project_name
* assignee name
* creator name

#### Sắp xếp

| Trường     | Mô tả             |
| ---------- | ----------------- |
| due_at   | Deadline gần nhất |
| priority   | Ưu tiên cao nhất  |
| created_at | Mới nhất/cũ nhất  |
| updated_at | Cập nhật gần nhất |
| status     | Theo trạng thái   |
| project    | Theo dự án        |

---

### 14.19 TASK-FUNC-019: Lịch sử hoạt động task/project

#### Mục tiêu

Lưu và hiển thị lịch sử thay đổi.

#### Hành động cần ghi log

* Tạo project.
* Cập nhật project.
* Đóng/hủy/lưu trữ project.
* Thêm/xóa member.
* Đổi role member.
* Tạo task.
* Cập nhật task.
* Đổi assignee.
* Đổi status.
* Đổi priority.
* Đổi deadline.
* Thêm/xóa comment.
* Upload/xóa file.
* Thêm/sửa/xóa checklist.
* Export dữ liệu.

---

### 14.20 TASK-FUNC-020: Báo cáo tiến độ dự án cơ bản

#### Mục tiêu

Cho phép Manager/Project Manager xem tiến độ dự án.

#### Chỉ số MVP

* Tổng số task.
* Số task theo trạng thái.
* Số task theo người phụ trách.
* Số task quá hạn.
* Số task sắp đến hạn.
* Tỷ lệ hoàn thành.
* Task priority cao chưa xong.
* Thành viên có nhiều task quá hạn.

#### Công thức tiến độ đề xuất

```text
progress_percentage = done_tasks / total_non_cancelled_tasks * 100
```

Nếu `total_non_cancelled_tasks = 0`:

```text
progress_percentage = 0
```

---

## 15. Dữ liệu cần lưu

> **TK-9 (Bất biến #1 — chuẩn = DB-06):** `company_id` là **NOT NULL ở MỌI bảng** TASK (`projects`, `project_members`, `tasks`, `task_assignees`, `task_watchers`, `task_comments`, `task_files`, `task_checklists`, `task_checklist_items`, `task_activity_logs`). Bỏ diễn đạt "Có nếu multi-company" — hệ chạy ở N=1 nhưng `company_id` vẫn bắt buộc, RLS + FORCE ép cô lập ở tầng DB (DECISIONS-02 §2). Bảng con không có `company_id` trực tiếp vẫn phải denormalize cột này để bật RLS.
>
> **TK-6 (chuẩn = DB-06 §7):** field bảng `tasks` đổi tên theo DB: `due_date` → `due_at` · `order_index` → `sort_order` · `is_archived` → `is_locked` · `assignee_id` → `main_assignee_employee_id` (multi-assignee qua bảng `task_assignees`) · `reporter_id` → `reporter_employee_id`. Lưu ý: bảng **checklist** vẫn dùng `order_index` (không đổi). Các phần narrative/flow còn nhắc tên cũ là tham chiếu lịch sử; tên cột chuẩn lấy theo DB-06.

### 15.1 Bảng projects

| Trường              | Kiểu dữ liệu | Bắt buộc             | Ghi chú                                              |
| ------------------- | ------------ | -------------------- | ---------------------------------------------------- |
| id                  | UUID/Integer | Có                   | ID dự án                                             |
| company_id          | UUID/Integer | Có                   | Công ty (NOT NULL, RLS + FORCE)                      |
| project_code        | String       | Có                   | Unique                                               |
| project_name        | String       | Có                   | Tên dự án                                            |
| description         | Text         | Không                | Mô tả                                                |
| owner_id            | UUID/Integer | Có                   | Employee owner                                       |
| department_id       | UUID/Integer | Không                | Phòng ban liên quan                                  |
| start_date          | Date         | Không                | Ngày bắt đầu                                         |
| end_date            | Date         | Không                | Ngày kết thúc dự kiến                                |
| actual_end_date     | Date         | Không                | Ngày hoàn thành thực tế                              |
| priority            | String       | Có                   | Low/Medium/High/Urgent                               |
| status              | String       | Có                   | Planning/Active/On Hold/Completed/Cancelled/Archived |
| visibility          | String       | Có                   | Private/Internal/Public                              |
| progress_percentage | Decimal      | Không                | Có thể tính động                                     |
| note                | Text         | Không                | Ghi chú                                              |
| created_at          | DateTime     | Có                   |                                                      |
| updated_at          | DateTime     | Có                   |                                                      |
| deleted_at          | DateTime     | Không                | Soft delete                                          |
| created_by          | UUID/Integer | Có                   | User tạo                                             |
| updated_by          | UUID/Integer | Không                | User cập nhật                                        |

---

### 15.2 Bảng project_members

| Trường       | Kiểu dữ liệu | Bắt buộc | Ghi chú                     |
| ------------ | ------------ | -------- | --------------------------- |
| id           | UUID/Integer | Có       | ID                          |
| company_id   | UUID/Integer | Có       | Công ty (NOT NULL, RLS + FORCE) |
| project_id   | UUID/Integer | Có       | Dự án                       |
| employee_id  | UUID/Integer | Có       | Nhân viên                   |
| user_id      | UUID/Integer | Không    | User liên kết               |
| project_role | String       | Có       | Owner/Manager/Member/Viewer |
| status       | String       | Có       | Active/Removed              |
| joined_at    | DateTime     | Có       | Ngày tham gia               |
| removed_at   | DateTime     | Không    | Ngày rời dự án              |
| added_by     | UUID/Integer | Không    | Người thêm                  |
| removed_by   | UUID/Integer | Không    | Người xóa                   |
| created_at   | DateTime     | Có       |                             |
| updated_at   | DateTime     | Có       |                             |

---

### 15.3 Bảng tasks

| Trường          | Kiểu dữ liệu  | Bắt buộc             | Ghi chú                                   |
| --------------- | ------------- | -------------------- | ----------------------------------------- |
| id              | UUID/Integer  | Có                   | ID task                                   |
| company_id      | UUID/Integer  | Có                   | Công ty (NOT NULL, RLS + FORCE)           |
| project_id      | UUID/Integer  | Không                | Dự án                                     |
| task_code       | String        | Có                   | Mã task                                   |
| title           | String        | Có                   | Tiêu đề                                   |
| description     | Text/RichText | Không                | Mô tả                                     |
| reporter_employee_id | UUID/Integer | Có               | Employee tạo/giao (DB-06: `reporter_employee_id`) |
| main_assignee_employee_id | UUID/Integer | Không      | Người phụ trách chính (DB-06: `main_assignee_employee_id`; multi-assignee qua `task_assignees`) |
| parent_task_id  | UUID/Integer  | Không                | Task cha nếu có                           |
| priority        | String        | Có                   | Low/Medium/High/Urgent                    |
| status          | String        | Có                   | Todo/In Progress/In Review/Done/Cancelled |
| start_at        | DateTime      | Không                | Thời điểm bắt đầu                         |
| due_at          | DateTime      | Không                | Deadline (DB-06: `due_at`)                |
| completed_at    | DateTime      | Không                | Thời gian hoàn thành                      |
| estimated_minutes | Integer     | Không                | Ước lượng số phút                         |
| actual_hours    | Decimal       | Không                | Phase sau                                 |
| sort_order      | Integer       | Không                | Thứ tự trong board (DB-06: `sort_order`)  |
| is_locked       | Boolean       | Có                   | Khóa sửa khi Done/Project closed (DB-06: `is_locked`), mặc định false |
| created_at      | DateTime      | Có                   |                                           |
| updated_at      | DateTime      | Có                   |                                           |
| deleted_at      | DateTime      | Không                | Soft delete                               |
| created_by      | UUID/Integer  | Có                   | User tạo                                  |
| updated_by      | UUID/Integer  | Không                | User cập nhật                             |

---

### 15.4 Bảng task_watchers

| Trường      | Kiểu dữ liệu | Bắt buộc | Ghi chú        |
| ----------- | ------------ | -------- | -------------- |
| id          | UUID/Integer | Có       | ID             |
| company_id  | UUID/Integer | Có       | Công ty (NOT NULL, RLS + FORCE) |
| task_id     | UUID/Integer | Có       | Task           |
| employee_id | UUID/Integer | Có       | Người theo dõi |
| added_by    | UUID/Integer | Không    | Người thêm     |
| created_at  | DateTime     | Có       |                |

---

### 15.5 Bảng task_comments

| Trường             | Kiểu dữ liệu | Bắt buộc | Ghi chú                     |
| ------------------ | ------------ | -------- | --------------------------- |
| id                 | UUID/Integer | Có       | ID comment                  |
| company_id         | UUID/Integer | Có       | Công ty (NOT NULL, RLS + FORCE) |
| task_id            | UUID/Integer | Có       | Task                        |
| parent_comment_id  | UUID/Integer | Không    | Reply nếu có                |
| content            | Text         | Có       | Nội dung                    |
| mentioned_user_ids | JSON         | Không    | Danh sách user được mention |
| created_by         | UUID/Integer | Có       | User tạo                    |
| updated_by         | UUID/Integer | Không    | User sửa                    |
| deleted_by         | UUID/Integer | Không    | User xóa                    |
| created_at         | DateTime     | Có       |                             |
| updated_at         | DateTime     | Có       |                             |
| deleted_at         | DateTime     | Không    | Soft delete                 |

---

### 15.6 Bảng task_files

| Trường      | Kiểu dữ liệu | Bắt buộc | Ghi chú          |
| ----------- | ------------ | -------- | ---------------- |
| id          | UUID/Integer | Có       | ID file          |
| company_id  | UUID/Integer | Có       | Công ty (NOT NULL, RLS + FORCE) |
| task_id     | UUID/Integer | Có       | Task             |
| file_name   | String       | Có       | Tên file         |
| file_url    | String       | Có       | URL file         |
| file_type   | String       | Không    | Loại file        |
| mime_type   | String       | Không    | MIME type        |
| file_size   | Integer      | Không    | Dung lượng       |
| uploaded_by | UUID/Integer | Có       | User upload      |
| uploaded_at | DateTime     | Có       | Thời gian upload |
| deleted_at  | DateTime     | Không    | Soft delete      |

---

### 15.7 Checklist — 2 bảng `task_checklists` + `task_checklist_items`

> **TK-2 (chuẩn = DB-06 §7 / API-06 / BE-08):** checklist KHÔNG phải 1 bảng phẳng. Mô hình chuẩn là **2 bảng**: `task_checklists` (nhóm checklist, ví dụ "Chuẩn bị", "Kiểm thử") và `task_checklist_items` (từng dòng tick được). Cả 2 bảng đều có `company_id` NOT NULL (RLS + FORCE).

#### Bảng `task_checklists` (nhóm checklist)

| Trường      | Kiểu dữ liệu | Bắt buộc | Ghi chú                          |
| ----------- | ------------ | -------- | -------------------------------- |
| id          | UUID/Integer | Có       | ID checklist                     |
| company_id  | UUID/Integer | Có       | Công ty (NOT NULL, RLS + FORCE)  |
| task_id     | UUID/Integer | Có       | Task                             |
| title       | String       | Có       | Tên nhóm checklist               |
| order_index | Integer      | Không    | Thứ tự nhóm                      |
| created_at  | DateTime     | Có       |                                  |
| updated_at  | DateTime     | Có       |                                  |

#### Bảng `task_checklist_items` (từng dòng checklist)

| Trường       | Kiểu dữ liệu | Bắt buộc | Ghi chú                          |
| ------------ | ------------ | -------- | -------------------------------- |
| id           | UUID/Integer | Có       | ID item                          |
| company_id   | UUID/Integer | Có       | Công ty (NOT NULL, RLS + FORCE)  |
| checklist_id | UUID/Integer | Có       | FK `task_checklists.id`          |
| title        | String       | Có       | Nội dung item                    |
| is_done      | Boolean      | Có       | Mặc định false                   |
| done_by      | UUID/Integer | Không    | User hoàn thành                  |
| done_at      | DateTime     | Không    | Thời gian hoàn thành             |
| order_index  | Integer      | Không    | Thứ tự item                      |
| created_at   | DateTime     | Có       |                                  |
| updated_at   | DateTime     | Có       |                                  |

---

### 15.8 Bảng task_activity_logs

| Trường      | Kiểu dữ liệu | Bắt buộc | Ghi chú                         |
| ----------- | ------------ | -------- | ------------------------------- |
| id          | UUID/Integer | Có       | ID log                          |
| company_id  | UUID/Integer | Có       | Công ty (NOT NULL, RLS + FORCE) |
| project_id  | UUID/Integer | Không    | Dự án                           |
| task_id     | UUID/Integer | Không    | Task                            |
| actor_id    | UUID/Integer | Có       | User thực hiện                  |
| action      | String       | Có       | TASK_CREATED, STATUS_CHANGED... |
| target_type | String       | Có       | Project/Task/Comment/File       |
| target_id   | UUID/Integer | Không    | ID đối tượng                    |
| old_value   | JSON         | Không    | Dữ liệu cũ                      |
| new_value   | JSON         | Không    | Dữ liệu mới                     |
| ip_address  | String       | Không    | IP                              |
| user_agent  | String       | Không    | Thiết bị                        |
| created_at  | DateTime     | Có       | Thời gian                       |

---

## 16. API sơ bộ

### 16.1 Project API

| Mã API       | Method | Endpoint                   | Mục đích            | Permission               |
| ------------ | ------ | -------------------------- | ------------------- | ------------------------ |
| TASK-API-001 | GET    | /api/v1/projects              | Lấy danh sách dự án | TASK.PROJECT.VIEW        |
| TASK-API-002 | GET    | /api/v1/projects/{id}         | Lấy chi tiết dự án  | TASK.PROJECT.VIEW        |
| TASK-API-003 | POST   | /api/v1/projects              | Tạo dự án           | TASK.PROJECT.CREATE      |
| TASK-API-004 | PUT    | /api/v1/projects/{id}         | Cập nhật dự án      | TASK.PROJECT.UPDATE      |
| TASK-API-005 | DELETE | /api/v1/projects/{id}         | Xóa mềm dự án       | TASK.PROJECT.DELETE      |
| TASK-API-006 | POST   | /api/v1/projects/{id}/close   | Đóng dự án          | TASK.PROJECT.CLOSE       |
| TASK-API-007 | POST   | /api/v1/projects/{id}/archive | Lưu trữ dự án       | TASK.PROJECT.ARCHIVE     |
| TASK-API-008 | GET    | /api/v1/projects/{id}/report  | Báo cáo dự án       | TASK.PROJECT.VIEW_REPORT |

---

### 16.2 Project Member API

| Mã API       | Method | Endpoint                               | Mục đích             | Permission                 |
| ------------ | ------ | -------------------------------------- | -------------------- | -------------------------- |
| TASK-API-101 | GET    | /api/v1/projects/{id}/members             | Danh sách thành viên | TASK.PROJECT.VIEW          |
| TASK-API-102 | POST   | /api/v1/projects/{id}/members             | Thêm thành viên      | TASK.PROJECT.MANAGE_MEMBER |
| TASK-API-103 | PUT    | /api/v1/projects/{id}/members/{member_id} | Cập nhật vai trò     | TASK.PROJECT.MANAGE_MEMBER |
| TASK-API-104 | DELETE | /api/v1/projects/{id}/members/{member_id} | Xóa thành viên       | TASK.PROJECT.MANAGE_MEMBER |

---

### 16.3 Task API

> **TK-4 (chuẩn = API-06 §10.4):** các hành động đổi trạng thái/assignee/priority/deadline dùng **verb tài nguyên `POST /api/v1/tasks/{id}/{action}`** (không dùng `PUT .../status` hay `PUT .../assignee`). Chuẩn hoá toàn bộ endpoint TASK về prefix `/api/v1` (DECISIONS-02). `POST` cho phép gửi kèm `Idempotency-Key` (API-06 §… idempotency cho `assign`/`change-status`).

| Mã API       | Method | Endpoint                              | Mục đích            | Permission              |
| ------------ | ------ | ------------------------------------- | ------------------- | ----------------------- |
| TASK-API-201 | GET    | /api/v1/tasks                         | Lấy danh sách task  | TASK.TASK.VIEW          |
| TASK-API-202 | GET    | /api/v1/tasks/{id}                     | Lấy chi tiết task   | TASK.TASK.VIEW          |
| TASK-API-203 | POST   | /api/v1/tasks                         | Tạo task            | TASK.TASK.CREATE        |
| TASK-API-204 | PUT    | /api/v1/tasks/{id}                     | Cập nhật task       | TASK.TASK.UPDATE        |
| TASK-API-205 | DELETE | /api/v1/tasks/{id}                     | Xóa mềm task        | TASK.TASK.DELETE        |
| TASK-API-206 | POST   | /api/v1/tasks/{id}/assign             | Giao/đổi assignee   | TASK.TASK.ASSIGN        |
| TASK-API-207 | POST   | /api/v1/tasks/{id}/change-status      | Đổi trạng thái      | TASK.TASK.UPDATE_STATUS |
| TASK-API-208 | POST   | /api/v1/tasks/{id}/change-priority    | Đổi độ ưu tiên      | TASK.TASK.UPDATE_PRIORITY |
| TASK-API-209 | POST   | /api/v1/tasks/{id}/change-deadline    | Đổi deadline        | TASK.TASK.UPDATE_DEADLINE |
| TASK-API-210 | GET    | /api/v1/tasks/my                       | Việc của tôi        | TASK.TASK.VIEW          |
| TASK-API-211 | GET    | /api/v1/tasks/overdue                  | Task quá hạn        | TASK.TASK.VIEW          |
| TASK-API-212 | GET    | /api/v1/projects/{id}/kanban           | Kanban board        | TASK.TASK.VIEW_KANBAN   |

---

### 16.4 Comment API

| Mã API       | Method | Endpoint                              | Mục đích     | Permission        |
| ------------ | ------ | ------------------------------------- | ------------ | ----------------- |
| TASK-API-301 | GET    | /api/v1/tasks/{id}/comments              | Lấy comment  | TASK.TASK.VIEW    |
| TASK-API-302 | POST   | /api/v1/tasks/{id}/comments              | Thêm comment | TASK.TASK.COMMENT |
| TASK-API-303 | PUT    | /api/v1/tasks/{id}/comments/{comment_id} | Sửa comment  | TASK.TASK.COMMENT |
| TASK-API-304 | DELETE | /api/v1/tasks/{id}/comments/{comment_id} | Xóa comment  | TASK.TASK.COMMENT |

---

### 16.5 File API

| Mã API       | Method | Endpoint                        | Mục đích      | Permission            |
| ------------ | ------ | ------------------------------- | ------------- | --------------------- |
| TASK-API-401 | GET    | /api/v1/tasks/{id}/files           | Lấy file task | TASK.TASK.VIEW        |
| TASK-API-402 | POST   | /api/v1/tasks/{id}/files           | Upload file   | TASK.TASK.FILE_UPLOAD |
| TASK-API-403 | DELETE | /api/v1/tasks/{id}/files/{file_id} | Xóa file      | TASK.TASK.FILE_DELETE |

---

### 16.6 Checklist API

> **TK-10 (chuẩn = API-06 §17):** cập nhật checklist dùng quyền **`TASK.TASK.UPDATE`** (KHÔNG phải `TASK.TASK.UPDATE_STATUS` — đó là quyền đổi trạng thái task, khác phạm vi). Sửa/tick checklist là một dạng cập nhật task, dùng verb `PATCH` cho item (API-06 §17.3).

| Mã API       | Method | Endpoint                                  | Mục đích           | Permission       |
| ------------ | ------ | ----------------------------------------- | ------------------ | ---------------- |
| TASK-API-501 | GET    | /api/v1/tasks/{id}/checklists                | Lấy checklist      | TASK.TASK.VIEW   |
| TASK-API-502 | POST   | /api/v1/tasks/{id}/checklists                | Thêm checklist     | TASK.TASK.UPDATE |
| TASK-API-503 | PATCH  | /api/v1/tasks/{id}/checklists/{checklist_id} | Cập nhật checklist | TASK.TASK.UPDATE |
| TASK-API-504 | DELETE | /api/v1/tasks/{id}/checklists/{checklist_id} | Xóa checklist      | TASK.TASK.UPDATE |

---

### 16.7 Activity Log API

| Mã API       | Method | Endpoint                         | Mục đích                        | Permission          |
| ------------ | ------ | -------------------------------- | ------------------------------- | ------------------- |
| TASK-API-601 | GET    | /api/v1/projects/{id}/activity-logs | Lấy lịch sử hoạt động của dự án | TASK.AUDIT_LOG.VIEW |
| TASK-API-602 | GET    | /api/v1/tasks/{id}/activity-logs    | Lấy lịch sử hoạt động của task  | TASK.AUDIT_LOG.VIEW |

---

## 17. Response chuẩn

### 17.1 Response thành công

```json
{
  "success": true,
  "data": {},
  "message": "Success"
}
```

### 17.2 Response lỗi

```json
{
  "success": false,
  "error": {
    "code": "TASK-ERR-001",
    "message": "Bạn không có quyền tạo dự án"
  }
}
```

### 17.3 Response phân trang

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

---

## 18. Quy tắc nghiệp vụ quan trọng

### 18.1 Quy tắc dự án

1. Mã dự án không được trùng trong cùng công ty.
2. Dự án phải có owner.
3. Owner phải là employee hợp lệ.
4. Không xóa cứng dự án trong MVP.
5. Dự án Archived không hiển thị mặc định.
6. Dự án Completed không nên cho tạo task mới, trừ khi reopen.
7. Dự án Cancelled không cho cập nhật task, trừ người có quyền đặc biệt.
8. Project private chỉ thành viên và người có quyền cao hơn mới xem được.
9. Không được xóa owner cuối cùng khỏi dự án.
10. Thay đổi trạng thái dự án phải ghi log.

### 18.2 Quy tắc task

1. Task phải có tiêu đề.
2. Task có thể thuộc project hoặc là task cá nhân nếu cấu hình cho phép.
3. Nếu task thuộc project, người tạo phải có quyền trong project.
4. Assignee phải là employee hợp lệ.
5. Task không được giao cho employee Resigned/Terminated.
6. Deadline không được nhỏ hơn start_date.
7. Task Done phải lưu completed_at.
8. Task Cancelled không tính vào tiến độ hoàn thành.
9. Task quá hạn được tính khi due_at đã qua và task chưa Done/Cancelled.
10. Xóa task là soft delete.
11. Cập nhật trạng thái phải theo workflow.
12. Mọi thay đổi quan trọng phải ghi activity log.

### 18.3 Quy tắc assignee

1. Mỗi task MVP nên có một assignee chính.
2. Assignee được cập nhật trạng thái task của mình.
3. Assignee không mặc định được đổi deadline nếu không có quyền.
4. Assignee không mặc định được đổi người phụ trách nếu không có quyền.
5. Nếu assignee nghỉ việc, Manager cần đổi assignee cho task active.
6. Khi đổi assignee, hệ thống gửi thông báo.

### 18.4 Quy tắc comment

1. Chỉ người xem được task mới comment được.
2. Comment không được rỗng.
3. Comment bị xóa là soft delete.
4. Mention người không có quyền xem task cần cảnh báo.
5. Comment mới gửi notification cho người liên quan.

### 18.5 Quy tắc file

1. File phải thuộc task hoặc project.
2. File upload cần giới hạn định dạng và dung lượng.
3. File nhạy cảm cần phân quyền riêng nếu có.
4. Xóa file là soft delete.
5. Upload/xóa file cần ghi log.

### 18.6 Quy tắc phân quyền

1. Backend luôn kiểm tra permission.
2. Frontend chỉ dùng permission để ẩn/hiện menu, button.
3. Không tin dữ liệu quyền từ frontend.
4. Mỗi API phải khai báo permission.
5. Mỗi màn hình phải khai báo permission.
6. Data scope phải áp dụng khi query danh sách.
7. Project role chỉ có hiệu lực trong phạm vi project.
8. Permission hệ thống vẫn là lớp kiểm soát cao nhất.

---

## 18a. Bảng mã lỗi (tổng hợp)

> **TK-3 — Bộ canonical (chuẩn) = API-06 §26 (slug).** Toàn dự án dùng MỘT hệ mã lỗi slug nhất quán (SPEC-01 §9.6), giống LEAVE/SPEC-05 §18. Hệ số `TASK-ERR-001..042` của bản SPEC cũ **không còn là chuẩn**; nó được giữ làm tham chiếu lịch sử và ánh xạ về slug ở §18a.1. Slug canonical gồm: `TASK-ERR-FORBIDDEN` (403), `TASK-ERR-PROJECT-NOT-FOUND` / `TASK-ERR-TASK-NOT-FOUND` / `TASK-ERR-COMMENT-NOT-FOUND` (404), `TASK-ERR-INVALID-STATUS` / `TASK-ERR-INVALID-PRIORITY` / `TASK-ERR-INVALID-DATE-RANGE` / `TASK-ERR-CHECKLIST-REQUIRED` / `TASK-ERR-ASSIGNEE-INVALID` / `TASK-ERR-PROJECT-MEMBER-INVALID` / `TASK-ERR-TASK-PERSONAL-DISABLED` (400), `TASK-ERR-DUPLICATE-MEMBER` / `TASK-ERR-DUPLICATE-WATCHER` / `TASK-ERR-IDEMPOTENCY-CONFLICT` / `TASK-ERR-WORKFLOW-INVALID` (409), `TASK-ERR-PROJECT-ARCHIVED` / `TASK-ERR-PROJECT-CANCELLED` / `TASK-ERR-TASK-CLOSED` (422), `TASK-ERR-FILE-TOO-LARGE` (413), `TASK-ERR-FILE-TYPE-NOT-ALLOWED` (415).
>
> ### 18a.1 Ánh xạ mã SPEC số (cũ) → canonical slug
>
> | SPEC cũ | Slug canonical |
> | --- | --- |
> | TASK-ERR-001 / 006 / 010 / 016 / 020 / 021 / 026 / 027 / 028 / 031 / 034 / 035 / 037 / 038 / 041 / 042 | `TASK-ERR-FORBIDDEN` |
> | TASK-ERR-007 / 026 (xem dự án) | `TASK-ERR-PROJECT-NOT-FOUND` |
> | TASK-ERR-008 (dự án đã xóa) | `TASK-ERR-PROJECT-NOT-FOUND` |
> | TASK-ERR-012 (project không hợp lệ) | `TASK-ERR-PROJECT-NOT-FOUND` |
> | TASK-ERR-029 / 030 (task không tồn tại/đã xóa) | `TASK-ERR-TASK-NOT-FOUND` |
> | TASK-ERR-002 / 011 (thiếu tên/tiêu đề) | `VALIDATION-ERR-001` |
> | TASK-ERR-003 (mã dự án trùng) | `TASK-ERR-DUPLICATE-MEMBER` (n/a) → mã trùng project dùng `VALIDATION-ERR-001` / business code project |
> | TASK-ERR-005 / 015 / 033 (ngày/deadline/estimate không hợp lệ) | `TASK-ERR-INVALID-DATE-RANGE` (ngày) / `VALIDATION-ERR-001` (estimate) |
> | TASK-ERR-013 / 014 / 032 (assignee không hợp lệ/không thuộc dự án/đã nghỉ) | `TASK-ERR-ASSIGNEE-INVALID` |
> | TASK-ERR-017 (chuyển trạng thái không hợp lệ) | `TASK-ERR-WORKFLOW-INVALID` |
> | TASK-ERR-018 (checklist chưa xong) | `TASK-ERR-CHECKLIST-REQUIRED` |
> | TASK-ERR-019 (task đã hủy/đóng) | `TASK-ERR-TASK-CLOSED` |
> | TASK-ERR-022 (thêm nhân viên không hoạt động) | `TASK-ERR-PROJECT-MEMBER-INVALID` |
> | TASK-ERR-023 (thêm thành viên trùng) | `TASK-ERR-DUPLICATE-MEMBER` |
> | TASK-ERR-036 (comment rỗng) | `VALIDATION-ERR-001` |
> | TASK-ERR-039 (file sai định dạng) | `TASK-ERR-FILE-TYPE-NOT-ALLOWED` |
> | TASK-ERR-040 (file quá dung lượng) | `TASK-ERR-FILE-TOO-LARGE` |

Bảng dưới là tham chiếu lịch sử (hệ số cũ). Các mã `TASK-ERR-001` đến `TASK-ERR-019` được gom từ các phần chức năng (§14.2, §14.4, §14.8, §14.11); các mã từ `TASK-ERR-020` trở đi bổ sung cho những trường hợp validate/nghiệp vụ trong §13, §14 và §18. **Ý nghĩa chuẩn lấy theo cột slug ở §18a.1.**

| Mã lỗi       | Trường hợp                               | Thông báo                                           |
| ------------ | ---------------------------------------- | --------------------------------------------------- |
| TASK-ERR-001 | Không có quyền tạo dự án                 | Bạn không có quyền tạo dự án                        |
| TASK-ERR-002 | Thiếu tên dự án                          | Vui lòng nhập tên dự án                             |
| TASK-ERR-003 | Mã dự án đã tồn tại                      | Mã dự án đã được sử dụng                            |
| TASK-ERR-004 | Owner không hợp lệ                       | Người phụ trách dự án không hợp lệ                  |
| TASK-ERR-005 | Ngày kết thúc không hợp lệ               | Ngày kết thúc không được nhỏ hơn ngày bắt đầu       |
| TASK-ERR-006 | Không có quyền đóng dự án                | Bạn không có quyền đóng dự án                       |
| TASK-ERR-007 | Dự án không tồn tại                      | Không tìm thấy dự án                                |
| TASK-ERR-008 | Dự án đã bị xóa                          | Dự án không còn hoạt động                           |
| TASK-ERR-009 | Còn task chưa hoàn thành                 | Dự án vẫn còn công việc chưa hoàn thành             |
| TASK-ERR-010 | Không có quyền tạo task                  | Bạn không có quyền tạo công việc                    |
| TASK-ERR-011 | Thiếu tiêu đề task                       | Vui lòng nhập tiêu đề công việc                     |
| TASK-ERR-012 | Project không hợp lệ                     | Dự án không tồn tại hoặc không hoạt động            |
| TASK-ERR-013 | Assignee không hợp lệ                    | Người phụ trách không hợp lệ                        |
| TASK-ERR-014 | Assignee không thuộc dự án               | Người phụ trách chưa thuộc dự án                    |
| TASK-ERR-015 | Deadline không hợp lệ                    | Deadline không hợp lệ                               |
| TASK-ERR-016 | Không có quyền cập nhật trạng thái       | Bạn không có quyền cập nhật trạng thái công việc    |
| TASK-ERR-017 | Chuyển trạng thái không hợp lệ           | Không thể chuyển sang trạng thái này                |
| TASK-ERR-018 | Checklist chưa hoàn thành                | Vui lòng hoàn thành checklist trước khi đóng task   |
| TASK-ERR-019 | Task đã bị hủy                           | Công việc đã bị hủy, không thể cập nhật             |
| TASK-ERR-020 | Không có quyền cập nhật dự án            | Bạn không có quyền cập nhật dự án                   |
| TASK-ERR-021 | Không có quyền quản lý thành viên dự án  | Bạn không có quyền quản lý thành viên dự án         |
| TASK-ERR-022 | Thêm nhân viên không hoạt động vào dự án | Chỉ nhân viên đang làm việc mới được thêm vào dự án |
| TASK-ERR-023 | Thêm thành viên trùng                    | Nhân viên đã là thành viên của dự án                |
| TASK-ERR-024 | Xóa owner cuối cùng của dự án            | Không thể xóa người phụ trách cuối cùng của dự án   |
| TASK-ERR-025 | Owner duy nhất tự hạ vai trò             | Không thể hạ vai trò khi bạn là owner duy nhất      |
| TASK-ERR-026 | Không có quyền xem dự án                 | Bạn không có quyền xem dự án này                    |
| TASK-ERR-027 | Không có quyền xem task                  | Bạn không có quyền xem công việc này                |
| TASK-ERR-028 | Không có quyền cập nhật task             | Bạn không có quyền cập nhật công việc               |
| TASK-ERR-029 | Task không tồn tại                       | Không tìm thấy công việc                            |
| TASK-ERR-030 | Task đã bị xóa                           | Công việc không còn tồn tại                         |
| TASK-ERR-031 | Không có quyền giao task                 | Bạn không có quyền giao công việc                   |
| TASK-ERR-032 | Assignee đã nghỉ việc                    | Không thể giao việc cho nhân viên đã nghỉ việc      |
| TASK-ERR-033 | Estimated hours không hợp lệ             | Số giờ ước lượng không được âm                      |
| TASK-ERR-034 | Không có quyền cập nhật deadline         | Bạn không có quyền cập nhật deadline                |
| TASK-ERR-035 | Không có quyền bình luận                 | Bạn không có quyền bình luận trong công việc này    |
| TASK-ERR-036 | Comment rỗng                             | Nội dung bình luận không được để trống              |
| TASK-ERR-037 | Không có quyền xóa comment               | Bạn không có quyền xóa bình luận này                |
| TASK-ERR-038 | Không có quyền upload file               | Bạn không có quyền tải file lên công việc này       |
| TASK-ERR-039 | File sai định dạng                       | Định dạng file không được hỗ trợ                    |
| TASK-ERR-040 | File quá dung lượng cho phép             | Dung lượng file vượt quá giới hạn cho phép          |
| TASK-ERR-041 | Không có quyền xóa file                  | Bạn không có quyền xóa file này                     |
| TASK-ERR-042 | Không có quyền xem lịch sử hoạt động     | Bạn không có quyền xem lịch sử hoạt động            |

---

## 19. Notification liên quan

> **TK-8 (chuẩn = SPEC-08 §15 / DB-06 §15.1):** TASK phát sự kiện sang NOTI bằng **`event_code` dạng chuỗi canonical** (string-code), KHÔNG dùng mã cục bộ `TASK-NOTI-00x`. Các mã `TASK-NOTI-00x` của bản SPEC cũ chỉ là tham chiếu lịch sử; hợp đồng phát/nhận sự kiện dùng cột `event_code` dưới đây. Bốn event nằm trong 9 mã chuẩn MVP (SPEC-01 §20.2) được gắn thêm `NOTI-EVENT-00x` để ánh xạ 1-1.
>
> _Out-of-scope lane này:_ `TASK_COMPLETED` chưa có trong registry DB-07/SPEC-08; nếu cần thông báo riêng khi task chuyển sang `Done`, hiện dùng `TASK_STATUS_CHANGED`. Việc bổ sung `TASK_COMPLETED` vào registry thuộc lane DB-07 (xem báo cáo).

| event_code (canonical) | NOTI-EVENT chuẩn | Sự kiện             | Người nhận                      | Nội dung                              |
| ---------------------- | ---------------- | ------------------- | ------------------------------- | ------------------------------------- |
| `PROJECT_MEMBER_ADDED` | —                | Được thêm vào dự án | Thành viên                      | Bạn đã được thêm vào dự án            |
| `PROJECT_MEMBER_REMOVED` | —              | Bị xóa khỏi dự án   | Thành viên                      | Bạn đã được xóa khỏi dự án            |
| `TASK_ASSIGNED`        | NOTI-EVENT-002   | Được giao task mới  | Assignee                        | Bạn có công việc mới                  |
| `TASK_ASSIGNEE_CHANGED` | —               | Task đổi assignee   | Assignee cũ/mới, Watcher        | Người phụ trách công việc đã thay đổi |
| `TASK_DUE_DATE_CHANGED` | —               | Task đổi deadline   | Assignee/Watcher                | Deadline công việc đã thay đổi        |
| `TASK_STATUS_CHANGED`  | —                | Task đổi trạng thái | Creator/Watcher                 | Trạng thái công việc đã thay đổi      |
| `TASK_COMMENT_CREATED` | NOTI-EVENT-003   | Comment mới         | Assignee/Watcher/Creator        | Có bình luận mới trong công việc      |
| `TASK_MENTIONED`       | —                | Được mention        | Người được mention              | Bạn được nhắc đến trong một bình luận |
| `TASK_DUE_SOON`        | NOTI-EVENT-004   | Task sắp đến hạn    | Assignee                        | Công việc sắp đến hạn                 |
| `TASK_OVERDUE`         | NOTI-EVENT-005   | Task quá hạn        | Assignee/Manager                | Công việc đã quá hạn                  |
| `PROJECT_CLOSED`       | —                | Project đóng        | Thành viên dự án                | Dự án đã được đóng                    |
| `PROJECT_CANCELLED`    | —                | Project bị hủy      | Thành viên dự án                | Dự án đã bị hủy                       |
| `PROJECT_ARCHIVED`     | —                | Project bị lưu trữ  | Thành viên dự án (nếu cần)      | Dự án đã được lưu trữ                 |

> Mention trong comment dùng `TASK_MENTIONED` (tách khỏi `TASK_COMMENT_CREATED`) đúng như SPEC-08 §15 và DB-06 §15.1.

---

## 20. Yêu cầu bảo mật

1. Người dùng chưa đăng nhập không được truy cập module TASK.
2. API phải kiểm tra token/session.
3. API phải kiểm tra permission.
4. API danh sách phải áp dụng data scope.
5. Project private không được lộ dữ liệu cho user ngoài project.
6. File đính kèm không được truy cập bằng URL nếu user không có quyền.
7. Không cho user tự nâng quyền trong project.
8. Không cho Employee sửa task không liên quan.
9. Không cho user xóa comment/file của người khác nếu không có quyền.
10. Audit log cần lưu các thao tác quan trọng.
11. Export task/project phải kiểm tra quyền.
12. Không xóa cứng dữ liệu project/task trong MVP.

---

## 21. Tiêu chí nghiệm thu tổng thể module TASK

Module TASK được xem là hoàn thành MVP khi:

1. Người có quyền tạo được dự án.
2. Người không có quyền không tạo được dự án.
3. Người có quyền xem được danh sách dự án đúng scope.
4. Project private không lộ cho user ngoài dự án.
5. Thêm/xóa/cập nhật thành viên dự án thành công.
6. Không thêm được employee inactive vào dự án.
7. Người có quyền tạo được task.
8. Task được giao cho assignee hợp lệ.
9. Assignee nhận được thông báo task mới.
10. Employee xem được task của mình trong Việc của tôi.
11. Manager xem được task của team/project theo scope.
12. Người không liên quan không xem được task private.
13. Cập nhật trạng thái task đúng workflow.
14. Task quá hạn được xác định đúng.
15. Kanban board hiển thị task theo trạng thái.
16. Kéo thả Kanban cập nhật trạng thái nếu có quyền.
17. Comment trong task hoạt động đúng.
18. File task upload/xóa theo quyền.
19. Checklist hoạt động đúng.
20. Báo cáo tiến độ dự án hiển thị số liệu cơ bản.
21. API chặn request không có token.
22. API chặn request thiếu quyền.
23. Activity log được ghi cho thao tác quan trọng.
24. Danh sách có tìm kiếm, lọc, phân trang.
25. Không còn lỗi nghiêm trọng ở luồng tạo/giao/cập nhật task.

---

## 22. Test case chính

| Mã test case | Tên test case                       | Kết quả mong muốn                |
| ------------ | ----------------------------------- | -------------------------------- |
| TASK-TC-001  | Manager tạo dự án hợp lệ            | Tạo thành công                   |
| TASK-TC-002  | Tạo dự án thiếu tên                 | Hiển thị lỗi                     |
| TASK-TC-003  | Tạo dự án mã trùng                  | Không cho tạo                    |
| TASK-TC-004  | User không có quyền tạo dự án       | Bị chặn                          |
| TASK-TC-005  | Thêm member active vào dự án        | Thêm thành công                  |
| TASK-TC-006  | Thêm member inactive                | Không cho thêm                   |
| TASK-TC-007  | Thêm trùng member                   | Không cho thêm                   |
| TASK-TC-008  | Xóa owner cuối cùng                 | Không cho xóa                    |
| TASK-TC-009  | Tạo task hợp lệ                     | Tạo thành công                   |
| TASK-TC-010  | Tạo task thiếu tiêu đề              | Hiển thị lỗi                     |
| TASK-TC-011  | Giao task cho employee active       | Giao thành công                  |
| TASK-TC-012  | Giao task cho employee đã nghỉ việc | Không cho giao                   |
| TASK-TC-013  | Giao task cho người ngoài project   | Cảnh báo hoặc chặn theo cấu hình |
| TASK-TC-014  | Assignee cập nhật In Progress       | Cập nhật thành công              |
| TASK-TC-015  | Chuyển trạng thái sai workflow      | Bị chặn                          |
| TASK-TC-016  | Checklist chưa xong nhưng đóng task | Bị chặn nếu cấu hình bắt buộc    |
| TASK-TC-017  | Employee xem Việc của tôi           | Hiển thị task liên quan          |
| TASK-TC-018  | Employee mở task không liên quan    | Bị chặn                          |
| TASK-TC-019  | Comment task hợp lệ                 | Comment được lưu                 |
| TASK-TC-020  | Comment rỗng                        | Hiển thị lỗi                     |
| TASK-TC-021  | Upload file hợp lệ                  | Upload thành công                |
| TASK-TC-022  | Upload file sai định dạng           | Bị chặn                          |
| TASK-TC-023  | Xóa file không có quyền             | Bị chặn                          |
| TASK-TC-024  | Task quá hạn                        | Hiển thị trong danh sách quá hạn |
| TASK-TC-025  | Kanban kéo task sang Done           | Cập nhật trạng thái              |
| TASK-TC-026  | User không có quyền kéo Kanban      | Không cho kéo                    |
| TASK-TC-027  | Đóng project còn task chưa xong     | Cảnh báo                         |
| TASK-TC-028  | Xóa mềm task                        | Task không hiển thị mặc định     |
| TASK-TC-029  | Xem báo cáo dự án                   | Hiển thị số liệu đúng            |
| TASK-TC-030  | Kiểm tra activity log               | Log được ghi                     |

---

## 23. Rủi ro và hướng xử lý

| Rủi ro                          | Mô tả                                   | Hướng xử lý                                      |
| ------------------------------- | --------------------------------------- | ------------------------------------------------ |
| Phân quyền task phức tạp        | Vừa có role hệ thống, vừa có role dự án | MVP dùng permission + project role đơn giản      |
| User thấy task không nên thấy   | Sai data scope hoặc project visibility  | Test kỹ scope Own/Team/Project/Company           |
| Task bị giao cho người đã nghỉ  | HR status không kiểm tra                | Luôn kiểm tra employment_status trước khi assign |
| Kanban cập nhật sai workflow    | Kéo thả tự do                           | Backend kiểm tra workflow                        |
| Project đóng khi task chưa xong | Dữ liệu tiến độ sai                     | Cảnh báo hoặc chặn theo cấu hình                 |
| Comment/file lộ dữ liệu         | URL file public hoặc task private       | Kiểm tra quyền khi tải file                      |
| Quá nhiều notification          | Gây nhiễu cho user                      | Cho cấu hình loại notification sau MVP           |
| Task quá hạn tính sai timezone  | Deadline lệch múi giờ                   | Lưu timezone rõ ràng, dùng server time           |
| Xóa nhầm task/project           | Mất dữ liệu                             | Dùng soft delete, có thể khôi phục phase sau     |
| Báo cáo chậm khi nhiều task     | Query nặng                              | Dùng index, cache hoặc bảng summary phase sau    |

---

## 24. Các điểm cần xác nhận thêm

Trước khi chốt bản final, cần xác nhận:

1. MVP có cho Employee tự tạo task cá nhân không?
2. Mỗi task chỉ có một assignee chính hay cho nhiều assignee?
3. Assignee có được tự chuyển task sang Done không, hay phải qua In Review?
4. Có bắt buộc checklist hoàn thành trước khi Done không?
5. Có cho tạo task ngoài project không?
6. Project visibility cần các mức nào: Private/Internal/Public?
7. Có cần tự sinh mã project/task không?
8. Có cần import task từ Excel không?
9. Có cần export task trong MVP không?
10. Có cần thông báo email hay chỉ in-app?
11. Có cần giới hạn file upload theo từng công ty không?
12. Có cần phân biệt Project Manager là role hệ thống hay chỉ là role trong dự án?
13. Task quá hạn tính theo ngày hay theo giờ?
14. Có cần hỗ trợ sub-task trong MVP không, hay checklist là đủ?
15. Có cần Dashboard task realtime không?

---

## 25. Kết luận

SPEC-06 là module lõi giúp hệ thống quản lý doanh nghiệp chuyển từ quản lý nhân sự, chấm công và nghỉ phép sang quản lý hiệu suất công việc hằng ngày.

Module TASK trong MVP cần tập trung vào các năng lực quan trọng nhất:

* Tạo và quản lý dự án.
* Thêm thành viên dự án.
* Tạo và giao task.
* Cập nhật trạng thái task.
* Xem việc của tôi.
* Kanban board cơ bản.
* Bình luận và file đính kèm.
* Theo dõi task quá hạn.
* Báo cáo tiến độ dự án cơ bản.
* Phân quyền chặt theo AUTH và dữ liệu HR.
* Ghi activity log đầy đủ.

Sau khi SPEC-06 được chốt, có thể triển khai tiếp:

1. SPEC-07: Dashboard.
2. SPEC-08: Thông báo hệ thống.
3. Các module Phase 2 như Tiền lương, Tuyển dụng hoặc mở rộng TASK nâng cao.
