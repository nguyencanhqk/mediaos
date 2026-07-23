# SPEC-03: QUẢN LÝ NHÂN SỰ

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · **SPEC-03 HR** · [SPEC-04 ATT](<SPEC-04 ATT.md>) · [SPEC-05 LEAVE](<SPEC-05 LEAVE.md>) · [SPEC-06 TASK](<SPEC-06 TASK.md>) · [SPEC-07 DASH](<SPEC-07 DASH.md>) · [SPEC-08 NOTI](<SPEC-08 NOTI.md>) · [SPEC-09 ME](<SPEC-09 ME.md>) · [SPEC-10 GOAL](<SPEC-10 GOAL.md>)
>
> **Liên quan:** [Thiết kế DB: DB-03 HR](<../DB/DB-03_HR Database Design.md>) · [Sản phẩm: PRD-00 §9.2](<../PRD/PRD-00 Enterprise Management System .md>) · [Thiết kế API: API-03 HR](<../API Design/API-03_HR_API_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường                     | Nội dung                    |
| -------------------------- | --------------------------- |
| Mã tài liệu                | SPEC-03                     |
| Tên tài liệu               | Quản lý nhân sự             |
| Module code                | HR                          |
| Tài liệu cha               | SPEC-01: Tổng quan hệ thống |
| Module phụ thuộc trực tiếp | AUTH                        |
| Phiên bản                  | v1.0                        |
| Trạng thái                 | Draft - Merged              |
| Giai đoạn                  | MVP Version 1.0             |
| Người viết                 |                             |
| Người duyệt                |                             |
| Ngày tạo                   |                             |
| Ngày cập nhật              | 20/06/2026                  |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết module **Quản lý nhân sự** trong hệ thống quản lý doanh nghiệp nội bộ.

Module HR chịu trách nhiệm quản lý toàn bộ dữ liệu nhân sự cốt lõi của doanh nghiệp, bao gồm:

* Hồ sơ nhân viên
* Thông tin cá nhân
* Thông tin công việc
* Phòng ban
* Chức vụ
* Cấp bậc
* Quản lý trực tiếp
* Hợp đồng lao động
* Trạng thái làm việc
* Tài liệu/hồ sơ đính kèm
* Lịch sử thay đổi hồ sơ
* Liên kết tài khoản đăng nhập với module AUTH

Module này là một trong các module nền tảng của MVP. Các module khác như Chấm công, Nghỉ phép, Công việc, Tiền lương, Tuyển dụng, Tài sản, Phòng họp, Chat và Thông báo đều cần dữ liệu nhân sự làm nguồn dữ liệu chính.

---

## 3. Mối liên kết với SPEC-01 và SPEC-02

### 3.1 Liên kết với [SPEC-01](<SPEC-01 Tổng quan.md>)

Theo SPEC-01, module này có mã:

```text
HR
```

Tài liệu này triển khai chi tiết phần:

```text
SPEC-01 → Mục 12.2 HR — Quản lý nhân sự
```

### 3.2 Liên kết với [SPEC-02](<SPEC-02 AUTH.md>)

Module HR phụ thuộc vào module AUTH để:

* Liên kết hồ sơ nhân viên với tài khoản đăng nhập.
* Xác định người dùng đang thao tác là ai.
* Kiểm tra người dùng có quyền xem, tạo, sửa, vô hiệu hóa nhân viên hay không.
* Kiểm soát phạm vi dữ liệu theo quyền: Own, Team, Department, Company, System.
* Ghi audit log theo user thực hiện thao tác.

Ví dụ liên kết:

```text
Employee record: Nguyễn Văn A
User account: nguyenvana@company.com
Role: Employee
Data scope: Own
```

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

Module HR cần giúp doanh nghiệp:

1. Quản lý tập trung toàn bộ hồ sơ nhân viên.
2. Chuẩn hóa dữ liệu nhân sự giữa các phòng ban.
3. Theo dõi quá trình làm việc của nhân viên từ lúc vào công ty đến khi nghỉ việc.
4. Quản lý phòng ban, chức vụ và cơ cấu tổ chức.
5. Quản lý thông tin hợp đồng lao động.
6. Quản lý trạng thái nhân viên: thử việc, chính thức, tạm nghỉ, đã nghỉ việc.
7. Hỗ trợ HR tìm kiếm, lọc, xuất dữ liệu nhân sự.
8. Cung cấp dữ liệu nhân viên cho các module khác như chấm công, nghỉ phép, công việc và lương.
9. Đảm bảo dữ liệu nhân sự nhạy cảm chỉ người có quyền mới được xem.
10. Ghi nhận lịch sử thay đổi hồ sơ để phục vụ kiểm tra và truy vết.

### 4.2 Mục tiêu kỹ thuật

Module HR cần đảm bảo:

1. Dữ liệu nhân viên có định danh duy nhất.
2. Có thể liên kết một hồ sơ nhân viên với một tài khoản đăng nhập.
3. Có kiểm tra trùng email, mã nhân viên và số giấy tờ tùy thân nếu cấu hình.
4. Có phân quyền theo vai trò và phạm vi dữ liệu.
5. Có cơ chế xóa mềm, không xóa vĩnh viễn dữ liệu nhân sự quan trọng.
6. Có audit log cho thao tác tạo, sửa, đổi trạng thái, cập nhật hợp đồng, upload/xóa file.
7. Có khả năng mở rộng cho nhiều chi nhánh, nhiều cấp phòng ban và nhiều loại hợp đồng.
8. API danh sách cần có tìm kiếm, lọc, phân trang, sắp xếp.
9. Dữ liệu nhạy cảm không được trả về nếu người dùng không có quyền.
10. Có khả năng mở rộng sang onboarding, offboarding, đánh giá nhân sự, khen thưởng/kỷ luật ở giai đoạn sau.

---

### 4.3 Quyết định nghiệp vụ đã chốt

Trong bản SPEC-03 hợp nhất, module HR chốt thêm 2 quyết định nghiệp vụ quan trọng cho MVP:

1. **Employee Self-Service có kiểm duyệt**: Employee được phép gửi yêu cầu cập nhật một số thông tin cá nhân trong màn hình **Hồ sơ của tôi**, nhưng dữ liệu không được cập nhật trực tiếp vào hồ sơ chính. Hệ thống tạo yêu cầu cập nhật hồ sơ cá nhân và chỉ áp dụng thay đổi sau khi HR/Admin/Super Admin duyệt.
2. **Mã nhân viên tự sinh theo cấu hình**: `employee_code` mặc định do hệ thống sinh tự động theo rule cấu hình. Chỉ người có quyền đặc biệt và khi cấu hình cho phép mới được sửa mã thủ công.

Luồng tổng quát yêu cầu cập nhật hồ sơ cá nhân:

```text
Employee chỉnh sửa thông tin cá nhân
→ Hệ thống tạo yêu cầu cập nhật hồ sơ
→ HR/Admin nhận thông báo
→ HR/Admin xem dữ liệu cũ và dữ liệu mới
→ HR/Admin duyệt hoặc từ chối
→ Nếu duyệt, dữ liệu mới được cập nhật vào hồ sơ nhân viên
→ Nếu từ chối, hồ sơ giữ nguyên
→ Employee nhận thông báo kết quả
```

Ví dụ format mã nhân viên có thể cấu hình:

```text
EMP0001
EMP0002
HR0001
DEV0001
2026-EMP-0001
FMC-HR-0001
```

---

## 5. Phạm vi module

### 5.1 Bao gồm trong MVP

Module HR trong MVP v1.0 bao gồm:

| Mã chức năng | Tên chức năng                                   | Độ ưu tiên |
| ------------ | ----------------------------------------------- | ---------- |
| HR-FUNC-001  | Xem danh sách nhân viên                         | Rất cao    |
| HR-FUNC-002  | Tìm kiếm và lọc nhân viên                       | Rất cao    |
| HR-FUNC-003  | Xem chi tiết hồ sơ nhân viên                    | Rất cao    |
| HR-FUNC-004  | Thêm nhân viên mới                              | Rất cao    |
| HR-FUNC-005  | Cập nhật hồ sơ nhân viên                        | Rất cao    |
| HR-FUNC-006  | Đổi trạng thái nhân viên                        | Cao        |
| HR-FUNC-007  | Quản lý phòng ban                               | Rất cao    |
| HR-FUNC-008  | Quản lý chức vụ                                 | Rất cao    |
| HR-FUNC-009  | Quản lý thông tin hợp đồng                      | Cao        |
| HR-FUNC-010  | Upload và quản lý file hồ sơ                    | Trung bình |
| HR-FUNC-011  | Liên kết nhân viên với tài khoản đăng nhập      | Cao        |
| HR-FUNC-012  | Xem lịch sử thay đổi hồ sơ                      | Cao        |
| HR-FUNC-013  | Xuất danh sách nhân viên                        | Trung bình |
| HR-FUNC-014  | Xem hồ sơ cá nhân của chính mình                | Rất cao    |
| HR-FUNC-015  | Quản lý cấp bậc / level cơ bản                  | Trung bình |
| HR-FUNC-016  | Quản lý loại hợp đồng cơ bản                    | Trung bình |
| HR-FUNC-017  | Quản lý người quản lý trực tiếp                 | Cao        |
| HR-FUNC-018  | Employee gửi yêu cầu cập nhật hồ sơ cá nhân     | Cao        |
| HR-FUNC-019  | HR duyệt/từ chối yêu cầu cập nhật hồ sơ cá nhân | Cao        |
| HR-FUNC-020  | Quản lý danh sách yêu cầu cập nhật hồ sơ        | Cao        |
| HR-FUNC-021  | Cấu hình quy tắc sinh mã nhân viên              | Cao        |
| HR-FUNC-022  | Xem trước mã nhân viên tiếp theo                | Trung bình |
| HR-FUNC-023  | Khóa/mở quyền sửa mã nhân viên thủ công         | Trung bình |

---

### 5.2 Chưa bao gồm trong MVP

Các chức năng sau chưa bắt buộc trong MVP, nhưng cần thiết kế để mở rộng:

| Chức năng                                 | Giai đoạn đề xuất |
| ----------------------------------------- | ----------------- |
| Quy trình onboarding nhân viên mới        | Phase sau         |
| Quy trình offboarding nhân viên nghỉ việc | Phase sau         |
| Khen thưởng/kỷ luật                       | Phase sau         |
| Đánh giá hiệu suất nhân viên              | Phase sau         |
| Lộ trình thăng tiến                       | Phase sau         |
| Quản lý bảo hiểm                          | Phase sau         |
| Quản lý thuế TNCN chi tiết                | Phase sau         |
| Quản lý người phụ thuộc                   | Phase sau         |
| Quản lý đào tạo nội bộ                    | Phase sau         |
| Sơ đồ tổ chức trực quan nâng cao          | Phase sau         |
| Import nhân viên hàng loạt từ Excel       | Phase sau         |
| Đồng bộ danh bạ với Google/Microsoft      | Phase sau         |
| E-sign hợp đồng                           | Phase sau         |
| Quản lý nhiều chi nhánh nâng cao          | Phase sau         |

---

## 6. Định nghĩa khái niệm trong module

### 6.1 Employee

`Employee` là hồ sơ nhân sự của một cá nhân làm việc trong doanh nghiệp.

Một Employee có thể:

* Có mã nhân viên.
* Có thông tin cá nhân.
* Có thông tin công việc.
* Thuộc một phòng ban chính.
* Có một chức vụ chính.
* Có một quản lý trực tiếp.
* Có một hoặc nhiều hợp đồng.
* Có trạng thái làm việc.
* Có thể liên kết với một User trong module AUTH.

---

### 6.2 Department

`Department` là phòng ban hoặc đơn vị tổ chức trong công ty.

Ví dụ:

* Ban Giám đốc
* Phòng Nhân sự
* Phòng Kế toán
* Phòng Kinh doanh
* Phòng Marketing
* Phòng Kỹ thuật
* Phòng Sản xuất

Một Department có thể:

* Có phòng ban cha.
* Có nhiều phòng ban con.
* Có một trưởng phòng.
* Có nhiều nhân viên.

---

### 6.3 Position

`Position` là chức vụ hoặc vị trí công việc của nhân viên.

Ví dụ:

* Nhân viên HR
* HR Manager
* Developer
* Project Manager
* Accountant
* Sales Executive
* Marketing Executive

Một Position có thể thuộc nhiều phòng ban khác nhau.

---

### 6.4 Job Level

`Job Level` là cấp bậc nhân sự.

Ví dụ:

* Intern
* Fresher
* Junior
* Middle
* Senior
* Lead
* Manager
* Director

Trong MVP, Job Level có thể là dữ liệu tùy chọn.

---

### 6.5 Employment Status

`Employment Status` là trạng thái làm việc của nhân viên.

Trạng thái đề xuất:

| Mã trạng thái         | Tên trạng thái  | Ý nghĩa                                                       |
| --------------------- | --------------- | ------------------------------------------------------------- |
| Probation             | Thử việc        | Nhân viên đang trong giai đoạn thử việc                       |
| Official              | Chính thức      | Nhân viên chính thức                                          |
| Temporarily Suspended | Tạm nghỉ        | Nhân viên tạm nghỉ hoặc tạm hoãn làm việc                     |
| Resigned              | Đã nghỉ việc    | Nhân viên đã nghỉ theo quy trình                              |
| Terminated            | Chấm dứt        | Nhân viên bị chấm dứt hợp đồng                                |
| Onboarding            | Đang onboarding | Nhân viên mới chưa hoàn tất onboarding, có thể triển khai sau |

---

### 6.6 Contract

`Contract` là hợp đồng lao động hoặc thỏa thuận làm việc giữa nhân viên và công ty.

Một Employee có thể có nhiều hợp đồng theo thời gian, nhưng tại một thời điểm thường có một hợp đồng hiệu lực chính.

---

### 6.7 Direct Manager

`Direct Manager` là người quản lý trực tiếp của nhân viên.

Dữ liệu này dùng cho:

* Phê duyệt nghỉ phép
* Xem nhân viên trong team
* Quản lý task
* Dashboard Manager
* Phân quyền theo scope Team

---

### 6.8 Employee File

`Employee File` là tài liệu đính kèm trong hồ sơ nhân viên.

Ví dụ:

* CV
* CCCD/CMND
* Hợp đồng lao động
* Bằng cấp
* Chứng chỉ
* Quyết định bổ nhiệm
* Quyết định nghỉ việc
* File khác

---

## 7. Nhóm người dùng liên quan

| Vai trò         | Mô tả trong module HR                                           |
| --------------- | --------------------------------------------------------------- |
| Super Admin     | Có toàn quyền với dữ liệu nhân sự toàn hệ thống                 |
| Admin công ty   | Có quyền quản trị dữ liệu nhân sự theo công ty nếu được cấp     |
| HR              | Người dùng chính của module HR                                  |
| Manager         | Xem nhân sự thuộc team/phòng ban mình quản lý                   |
| Employee        | Xem hồ sơ cá nhân của chính mình                                |
| Payroll Officer | Xem dữ liệu nhân sự phục vụ tính lương nếu được cấp quyền       |
| Recruiter       | Có thể tạo hồ sơ nhân viên từ ứng viên trúng tuyển ở Phase sau  |
| Asset Manager   | Xem thông tin nhân viên để cấp phát tài sản ở Phase sau         |
| Office Admin    | Xem thông tin nhân viên để quản lý phòng họp/hành chính nếu cần |

---

## 8. Quyền trong module HR

### 8.1 Quy ước mã quyền

Cấu trúc:

```text
HR.RESOURCE.ACTION
```

Ví dụ:

```text
HR.EMPLOYEE.VIEW
HR.EMPLOYEE.CREATE
HR.EMPLOYEE.UPDATE
HR.EMPLOYEE.EXPORT
```

---

### 8.2 Danh sách quyền HR trong MVP

| Mã quyền                             | Mô tả                                                |
| ------------------------------------ | ---------------------------------------------------- |
| HR.EMPLOYEE.VIEW                     | Xem danh sách và hồ sơ nhân viên                     |
| HR.EMPLOYEE.VIEW_SENSITIVE           | Xem dữ liệu nhạy cảm trong hồ sơ nhân viên           |
| HR.EMPLOYEE.CREATE                   | Tạo hồ sơ nhân viên                                  |
| HR.EMPLOYEE.UPDATE                   | Cập nhật hồ sơ nhân viên                             |
| HR.EMPLOYEE.CHANGE_STATUS            | Đổi trạng thái nhân viên                             |
| HR.EMPLOYEE.DELETE                   | Xóa mềm/vô hiệu hóa hồ sơ nhân viên                  |
| HR.EMPLOYEE.EXPORT                   | Xuất danh sách nhân viên                             |
| HR.EMPLOYEE.IMPORT                   | Import danh sách nhân viên, sau MVP                  |
| HR.EMPLOYEE.FILE_VIEW                | Xem file hồ sơ nhân viên                             |
| HR.EMPLOYEE.FILE_UPLOAD              | Upload file hồ sơ nhân viên                          |
| HR.EMPLOYEE.FILE_DELETE              | Xóa file hồ sơ nhân viên                             |
| HR.DEPARTMENT.VIEW                   | Xem phòng ban                                        |
| HR.DEPARTMENT.CREATE                 | Tạo phòng ban                                        |
| HR.DEPARTMENT.UPDATE                 | Cập nhật phòng ban                                   |
| HR.DEPARTMENT.DELETE                 | Xóa mềm/vô hiệu hóa phòng ban                        |
| HR.POSITION.VIEW                     | Xem chức vụ                                          |
| HR.POSITION.CREATE                   | Tạo chức vụ                                          |
| HR.POSITION.UPDATE                   | Cập nhật chức vụ                                     |
| HR.POSITION.DELETE                   | Xóa mềm/vô hiệu hóa chức vụ                          |
| HR.CONTRACT.VIEW                     | Xem hợp đồng                                         |
| HR.CONTRACT.CREATE                   | Tạo hợp đồng                                         |
| HR.CONTRACT.UPDATE                   | Cập nhật hợp đồng                                    |
| HR.CONTRACT.DELETE                   | Xóa mềm/vô hiệu hóa hợp đồng                         |
| HR.AUDIT_LOG.VIEW                    | Xem lịch sử thay đổi hồ sơ nhân viên                 |
| HR.ORG_CHART.VIEW                    | Xem sơ đồ tổ chức cơ bản                             |
| HR.MASTER_DATA.MANAGE                | Quản lý dữ liệu danh mục HR                          |
| HR.PROFILE_CHANGE_REQUEST.CREATE     | Employee được gửi yêu cầu cập nhật hồ sơ cá nhân     |
| HR.PROFILE_CHANGE_REQUEST.VIEW_OWN   | Employee xem yêu cầu cập nhật hồ sơ của chính mình   |
| HR.PROFILE_CHANGE_REQUEST.VIEW       | HR/Admin xem danh sách yêu cầu cập nhật hồ sơ        |
| HR.PROFILE_CHANGE_REQUEST.APPROVE    | HR/Admin duyệt yêu cầu cập nhật hồ sơ                |
| HR.PROFILE_CHANGE_REQUEST.REJECT     | HR/Admin từ chối yêu cầu cập nhật hồ sơ              |
| HR.PROFILE_CHANGE_REQUEST.CANCEL_OWN | Employee hủy yêu cầu khi còn Pending                 |
| HR.EMPLOYEE_CODE_CONFIG.VIEW         | Xem cấu hình mã nhân viên                            |
| HR.EMPLOYEE_CODE_CONFIG.UPDATE       | Cập nhật cấu hình mã nhân viên                       |
| HR.EMPLOYEE_CODE.PREVIEW             | Xem trước mã nhân viên tiếp theo                     |
| HR.EMPLOYEE_CODE.MANUAL_OVERRIDE     | Được sửa mã nhân viên thủ công nếu cấu hình cho phép |

---

### 8.3 Phân quyền theo data scope

| Scope      | Ý nghĩa trong HR                                                        |
| ---------- | ----------------------------------------------------------------------- |
| Own        | Chỉ xem hồ sơ của chính mình                                            |
| Team       | Xem nhân viên có direct_manager_id là mình hoặc thuộc team mình quản lý |
| Department | Xem nhân viên thuộc phòng ban mình quản lý                              |
| Company    | Xem toàn bộ nhân viên trong công ty                                     |
| System     | Xem toàn bộ nhân viên trên toàn hệ thống, dùng cho Super Admin          |

Ví dụ:

```text
Employee có HR.EMPLOYEE.VIEW với scope Own.
Manager có HR.EMPLOYEE.VIEW với scope Team.
HR có HR.EMPLOYEE.VIEW với scope Company.
Super Admin có HR.EMPLOYEE.VIEW với scope System.
```

---

## 9. Ma trận phân quyền MVP cho module HR

| Chức năng                         | Super Admin | Admin công ty   | HR              | Manager                     | Employee                               |
| --------------------------------- | ----------- | --------------- | --------------- | --------------------------- | -------------------------------------- |
| Xem danh sách nhân viên           | Có          | Có nếu được cấp | Có              | Có giới hạn Team/Department | Không                                  |
| Xem hồ sơ cá nhân                 | Có          | Có              | Có              | Có giới hạn                 | Chỉ Own                                |
| Xem dữ liệu nhạy cảm              | Có          | Có nếu được cấp | Có nếu được cấp | Không mặc định              | Không                                  |
| Thêm nhân viên                    | Có          | Có nếu được cấp | Có              | Không                       | Không                                  |
| Cập nhật hồ sơ nhân viên          | Có          | Có nếu được cấp | Có              | Có giới hạn nếu được cấp    | Chỉ một số trường cá nhân nếu cho phép |
| Đổi trạng thái nhân viên          | Có          | Có nếu được cấp | Có              | Không                       | Không                                  |
| Xóa mềm nhân viên                 | Có          | Có nếu được cấp | Có nếu được cấp | Không                       | Không                                  |
| Quản lý phòng ban                 | Có          | Có              | Có nếu được cấp | Không                       | Không                                  |
| Quản lý chức vụ                   | Có          | Có              | Có nếu được cấp | Không                       | Không                                  |
| Quản lý hợp đồng                  | Có          | Có nếu được cấp | Có              | Không                       | Không                                  |
| Upload file hồ sơ                 | Có          | Có nếu được cấp | Có              | Không mặc định              | Không                                  |
| Xem file hồ sơ                    | Có          | Có nếu được cấp | Có              | Không mặc định              | Không                                  |
| Xuất danh sách nhân viên          | Có          | Có nếu được cấp | Có nếu được cấp | Không mặc định              | Không                                  |
| Xem lịch sử thay đổi              | Có          | Có nếu được cấp | Có nếu được cấp | Không                       | Không                                  |
| Gửi yêu cầu sửa hồ sơ cá nhân     | Có          | Có              | Có              | Có                          | Có                                     |
| Xem yêu cầu của chính mình        | Có          | Có              | Có              | Có                          | Có                                     |
| Xem tất cả yêu cầu cập nhật hồ sơ | Có          | Có nếu được cấp | Có              | Không mặc định              | Không                                  |
| Duyệt yêu cầu cập nhật hồ sơ      | Có          | Có nếu được cấp | Có              | Không mặc định              | Không                                  |
| Từ chối yêu cầu cập nhật hồ sơ    | Có          | Có nếu được cấp | Có              | Không mặc định              | Không                                  |
| Hủy yêu cầu của chính mình        | Có          | Có              | Có              | Có                          | Có                                     |
| Cấu hình mã nhân viên             | Có          | Có nếu được cấp | Có nếu được cấp | Không                       | Không                                  |
| Xem trước mã nhân viên tiếp theo  | Có          | Có nếu được cấp | Có nếu được cấp | Không                       | Không                                  |
| Sửa mã nhân viên thủ công         | Có          | Có nếu được cấp | Có nếu được cấp | Không                       | Không                                  |

---

## 10. Danh sách chức năng chi tiết

| Mã chức năng | Tên chức năng                                   | Mô tả ngắn                                                 |
| ------------ | ----------------------------------------------- | ---------------------------------------------------------- |
| HR-FUNC-001  | Xem danh sách nhân viên                         | Hiển thị danh sách nhân viên theo quyền                    |
| HR-FUNC-002  | Tìm kiếm và lọc nhân viên                       | Tìm nhân viên theo từ khóa, phòng ban, chức vụ, trạng thái |
| HR-FUNC-003  | Xem chi tiết hồ sơ nhân viên                    | Xem toàn bộ thông tin hồ sơ theo quyền                     |
| HR-FUNC-004  | Thêm nhân viên mới                              | Tạo hồ sơ nhân viên mới                                    |
| HR-FUNC-005  | Cập nhật hồ sơ nhân viên                        | Sửa thông tin nhân viên                                    |
| HR-FUNC-006  | Đổi trạng thái nhân viên                        | Chuyển thử việc, chính thức, tạm nghỉ, đã nghỉ             |
| HR-FUNC-007  | Quản lý phòng ban                               | Tạo, sửa, xóa mềm phòng ban                                |
| HR-FUNC-008  | Quản lý chức vụ                                 | Tạo, sửa, xóa mềm chức vụ                                  |
| HR-FUNC-009  | Quản lý hợp đồng                                | Tạo, sửa, theo dõi hợp đồng lao động                       |
| HR-FUNC-010  | Upload và quản lý file hồ sơ                    | Lưu tài liệu nhân sự                                       |
| HR-FUNC-011  | Liên kết nhân viên với tài khoản đăng nhập      | Kết nối Employee với User                                  |
| HR-FUNC-012  | Xem lịch sử thay đổi hồ sơ                      | Audit log hồ sơ nhân viên                                  |
| HR-FUNC-013  | Xuất danh sách nhân viên                        | Export Excel/CSV                                           |
| HR-FUNC-014  | Xem hồ sơ cá nhân                               | Employee xem hồ sơ của mình                                |
| HR-FUNC-015  | Quản lý cấp bậc                                 | Tạo và gán cấp bậc nhân sự                                 |
| HR-FUNC-016  | Quản lý loại hợp đồng                           | Tạo danh mục loại hợp đồng                                 |
| HR-FUNC-017  | Quản lý người quản lý trực tiếp                 | Gán direct manager cho nhân viên                           |
| HR-FUNC-018  | Employee gửi yêu cầu cập nhật hồ sơ cá nhân     | Nhân viên gửi đề xuất sửa thông tin cá nhân, chờ duyệt     |
| HR-FUNC-019  | HR duyệt/từ chối yêu cầu cập nhật hồ sơ cá nhân | HR/Admin xử lý yêu cầu cập nhật hồ sơ                      |
| HR-FUNC-020  | Quản lý danh sách yêu cầu cập nhật hồ sơ        | Xem, lọc, theo dõi trạng thái yêu cầu cập nhật hồ sơ       |
| HR-FUNC-021  | Cấu hình quy tắc sinh mã nhân viên              | Thiết lập prefix, số thứ tự, reset rule và pattern mã      |
| HR-FUNC-022  | Xem trước mã nhân viên tiếp theo                | Preview mã sẽ sinh trước khi tạo nhân viên                 |
| HR-FUNC-023  | Khóa/mở quyền sửa mã nhân viên thủ công         | Kiểm soát việc override mã nhân viên sau khi tạo           |

---

## 11. Luồng nghiệp vụ tổng quan

### 11.1 Luồng tạo nhân viên mới

```text
HR/Admin đăng nhập
→ Vào menu Nhân sự
→ Chọn Thêm nhân viên
→ Nhập thông tin cá nhân
→ Nhập thông tin công việc
→ Chọn phòng ban
→ Chọn chức vụ
→ Chọn quản lý trực tiếp nếu có
→ Nhập thông tin hợp đồng nếu có
→ Chọn có tạo tài khoản đăng nhập hay không
→ Bấm Lưu
→ Hệ thống kiểm tra dữ liệu
→ Hệ thống tạo hồ sơ nhân viên
→ Nếu chọn tạo tài khoản, hệ thống gọi module AUTH tạo user
→ Hệ thống ghi audit log
→ Nhân viên xuất hiện trong danh sách
```

Module liên quan:

* HR
* AUTH
* NOTI

---

### 11.2 Luồng cập nhật hồ sơ nhân viên

```text
HR/Admin vào danh sách nhân viên
→ Chọn nhân viên cần cập nhật
→ Vào trang chi tiết hồ sơ
→ Bấm Chỉnh sửa
→ Cập nhật thông tin
→ Bấm Lưu
→ Hệ thống kiểm tra quyền
→ Hệ thống kiểm tra dữ liệu
→ Hệ thống lưu thay đổi
→ Hệ thống ghi lịch sử thay đổi
→ Hiển thị thông báo thành công
```

---

### 11.3 Luồng nhân viên xem hồ sơ cá nhân

```text
Employee đăng nhập
→ Vào menu Hồ sơ của tôi
→ Hệ thống lấy employee_id liên kết với user hiện tại
→ Hệ thống hiển thị thông tin cá nhân được phép xem
→ Nếu được cấu hình, nhân viên có thể cập nhật một số trường
```

---

### 11.4 Luồng đổi trạng thái nhân viên sang chính thức

```text
HR mở hồ sơ nhân viên thử việc
→ Chọn Đổi trạng thái
→ Chọn trạng thái Official
→ Nhập ngày hiệu lực
→ Nhập ghi chú nếu cần
→ Bấm Xác nhận
→ Hệ thống cập nhật trạng thái nhân viên
→ Hệ thống ghi log
→ Dashboard HR có thể cập nhật số liệu nhân viên chính thức
```

---

### 11.5 Luồng nhân viên nghỉ việc

```text
HR mở hồ sơ nhân viên
→ Chọn Đổi trạng thái
→ Chọn Resigned hoặc Terminated
→ Nhập ngày nghỉ việc
→ Nhập lý do nghỉ việc
→ Chọn có khóa tài khoản đăng nhập hay không
→ Hệ thống cập nhật trạng thái nhân viên
→ Nếu chọn khóa tài khoản, hệ thống gọi AUTH khóa user
→ Hệ thống ghi audit log
→ Nhân viên không còn được tính là đang làm việc
```

Module liên quan:

* HR
* AUTH
* ATT
* LEAVE
* TASK
* ASSET, sau MVP
* PAYROLL, sau MVP

---

### 11.6 Luồng quản lý phòng ban

```text
HR/Admin vào Cài đặt nhân sự
→ Chọn Phòng ban
→ Tạo phòng ban mới hoặc sửa phòng ban hiện có
→ Chọn phòng ban cha nếu có
→ Chọn trưởng phòng nếu có
→ Lưu dữ liệu
→ Hệ thống cập nhật danh mục phòng ban
→ Danh sách nhân viên có thể dùng phòng ban này
```

---

### 11.7 Luồng quản lý hợp đồng

```text
HR mở hồ sơ nhân viên
→ Vào tab Hợp đồng
→ Bấm Thêm hợp đồng
→ Chọn loại hợp đồng
→ Nhập ngày bắt đầu, ngày kết thúc
→ Nhập file hợp đồng nếu có
→ Chọn trạng thái hợp đồng
→ Lưu
→ Hệ thống ghi nhận hợp đồng
→ Nếu hợp đồng sắp hết hạn, hệ thống có thể tạo cảnh báo cho HR
```

---

### 11.8 Luồng Employee gửi yêu cầu cập nhật hồ sơ cá nhân

```text
Employee đăng nhập
→ Vào Hồ sơ của tôi
→ Bấm Chỉnh sửa thông tin
→ Hệ thống hiển thị các trường được phép đề xuất sửa
→ Employee thay đổi thông tin
→ Employee bấm Gửi yêu cầu
→ Hệ thống so sánh dữ liệu cũ và dữ liệu mới
→ Hệ thống tạo profile_change_request trạng thái Pending
→ HR/Admin nhận thông báo
→ Employee theo dõi yêu cầu trong màn hình Yêu cầu cập nhật hồ sơ của tôi
```

Module liên quan:

* HR
* AUTH
* NOTI

---

### 11.9 Luồng HR duyệt/từ chối yêu cầu cập nhật hồ sơ cá nhân

```text
HR/Admin vào danh sách yêu cầu cập nhật hồ sơ
→ Chọn yêu cầu trạng thái Pending
→ Xem thông tin Employee
→ Xem bảng so sánh dữ liệu cũ và dữ liệu mới
→ Xem lý do và file đính kèm nếu có
→ Chọn Duyệt hoặc Từ chối
→ Nếu duyệt, hệ thống cập nhật dữ liệu mới vào hồ sơ nhân viên
→ Nếu từ chối, hệ thống giữ nguyên hồ sơ chính và yêu cầu nhập lý do
→ Hệ thống ghi audit log
→ Employee nhận thông báo kết quả
```

---

### 11.10 Luồng sinh mã nhân viên khi thêm nhân viên

```text
HR/Admin mở màn hình Thêm nhân viên
→ Hệ thống đọc employee_code_config đang active
→ Hệ thống xác định pattern và sequence key phù hợp
→ Hệ thống preview mã nhân viên tiếp theo
→ HR/Admin nhập thông tin nhân viên
→ Khi bấm Lưu, hệ thống khóa sequence và sinh mã chính thức
→ Hệ thống kiểm tra mã unique
→ Hệ thống tạo hồ sơ nhân viên với employee_code đã sinh
→ Hệ thống tăng sequence sau khi tạo thành công
```

---

## 12. Danh sách màn hình

| Mã màn hình   | Tên màn hình                       | Người dùng truy cập                         |
| ------------- | ---------------------------------- | ------------------------------------------- |
| HR-SCREEN-001 | Danh sách nhân viên                | HR, Admin, Manager theo quyền               |
| HR-SCREEN-002 | Thêm nhân viên                     | HR, Admin                                   |
| HR-SCREEN-003 | Chi tiết hồ sơ nhân viên           | HR, Admin, Manager theo scope, Employee Own |
| HR-SCREEN-004 | Chỉnh sửa hồ sơ nhân viên          | HR, Admin                                   |
| HR-SCREEN-005 | Hồ sơ của tôi                      | Tất cả Employee                             |
| HR-SCREEN-006 | Danh sách phòng ban                | HR, Admin                                   |
| HR-SCREEN-007 | Tạo/chỉnh sửa phòng ban            | HR, Admin                                   |
| HR-SCREEN-008 | Danh sách chức vụ                  | HR, Admin                                   |
| HR-SCREEN-009 | Tạo/chỉnh sửa chức vụ              | HR, Admin                                   |
| HR-SCREEN-010 | Tab hợp đồng nhân viên             | HR, Admin                                   |
| HR-SCREEN-011 | Tab tài liệu hồ sơ                 | HR, Admin                                   |
| HR-SCREEN-012 | Tab lịch sử thay đổi               | HR, Admin có quyền                          |
| HR-SCREEN-013 | Sơ đồ tổ chức cơ bản               | HR, Admin, Manager                          |
| HR-SCREEN-014 | Danh mục cấp bậc                   | HR, Admin                                   |
| HR-SCREEN-015 | Danh mục loại hợp đồng             | HR, Admin                                   |
| HR-SCREEN-016 | Yêu cầu cập nhật hồ sơ của tôi     | Employee                                    |
| HR-SCREEN-017 | Tạo yêu cầu cập nhật hồ sơ cá nhân | Employee                                    |
| HR-SCREEN-018 | Danh sách yêu cầu cập nhật hồ sơ   | HR, Admin                                   |
| HR-SCREEN-019 | Chi tiết yêu cầu cập nhật hồ sơ    | HR, Admin, Employee chủ sở hữu              |
| HR-SCREEN-020 | Cấu hình mã nhân viên              | HR/Admin có quyền                           |

---

## 13. Chi tiết màn hình

### 13.1 HR-SCREEN-001: Danh sách nhân viên

#### Mục đích

Hiển thị danh sách nhân viên theo quyền và phạm vi dữ liệu của người dùng.

#### Người dùng truy cập

* Super Admin
* Admin công ty
* HR
* Manager theo scope Team/Department

#### Thành phần giao diện

* Tiêu đề: Nhân sự
* Nút Thêm nhân viên
* Ô tìm kiếm
* Bộ lọc phòng ban
* Bộ lọc chức vụ
* Bộ lọc cấp bậc
* Bộ lọc trạng thái nhân viên
* Bộ lọc loại hợp đồng
* Bộ lọc ngày vào làm
* Bộ lọc quản lý trực tiếp
* Nút Xuất file
* Bảng danh sách nhân viên
* Phân trang
* Menu hành động từng dòng

#### Bộ lọc

| Bộ lọc            | Mô tả                                                            |
| ----------------- | ---------------------------------------------------------------- |
| Từ khóa           | Tìm theo mã nhân viên, họ tên, email, số điện thoại              |
| Phòng ban         | Lọc theo department_id                                           |
| Chức vụ           | Lọc theo position_id                                             |
| Cấp bậc           | Lọc theo job_level_id                                            |
| Trạng thái        | Probation, Official, Temporarily Suspended, Resigned, Terminated |
| Loại hợp đồng     | Thử việc, xác định thời hạn, không xác định thời hạn             |
| Ngày vào làm      | Từ ngày - đến ngày                                               |
| Quản lý trực tiếp | Lọc theo direct_manager_id                                       |

#### Cột hiển thị

| Cột               | Mô tả                    |
| ----------------- | ------------------------ |
| Avatar            | Ảnh đại diện             |
| Mã nhân viên      | employee_code            |
| Họ tên            | full_name                |
| Email công ty     | company_email            |
| Số điện thoại     | phone                    |
| Phòng ban         | name          |
| Chức vụ           | name            |
| Quản lý trực tiếp | manager_name             |
| Ngày vào làm      | joined_date              |
| Trạng thái        | employment_status        |
| Hành động         | Xem, sửa, đổi trạng thái |

#### Hành động trên màn hình

| Hành động      | Permission                |
| -------------- | ------------------------- |
| Xem danh sách  | HR.EMPLOYEE.VIEW          |
| Thêm nhân viên | HR.EMPLOYEE.CREATE        |
| Xem chi tiết   | HR.EMPLOYEE.VIEW          |
| Sửa nhân viên  | HR.EMPLOYEE.UPDATE        |
| Đổi trạng thái | HR.EMPLOYEE.CHANGE_STATUS |
| Xuất file      | HR.EMPLOYEE.EXPORT        |

#### Quy tắc hiển thị

* Employee không truy cập màn hình danh sách toàn bộ nhân viên.
* Manager chỉ thấy nhân viên thuộc scope được cấp.
* HR thấy toàn công ty nếu có scope Company.
* Dữ liệu nhạy cảm không hiển thị ở danh sách mặc định.
* Nhân viên đã nghỉ việc vẫn có thể hiển thị nếu chọn bộ lọc trạng thái.

---

### 13.2 HR-SCREEN-002: Thêm nhân viên

#### Mục đích

Cho phép HR/Admin tạo hồ sơ nhân viên mới.

#### Người dùng truy cập

* Super Admin
* Admin công ty
* HR
* Người có quyền `HR.EMPLOYEE.CREATE`

#### Nhóm thông tin trong form

1. Thông tin cơ bản
2. Thông tin liên hệ
3. Thông tin công việc
4. Thông tin hợp đồng
5. Thông tin tài khoản đăng nhập
6. File hồ sơ nếu có

---

#### Nhóm 1: Thông tin cơ bản

| Trường                  | Kiểu dữ liệu | Bắt buộc              | Ghi chú                                                                                       |
| ----------------------- | ------------ | --------------------- | --------------------------------------------------------------------------------------------- |
| employee_code           | String       | Hệ thống tự sinh      | Mã nhân viên preview/tự sinh theo cấu hình; chỉ người có quyền override mới được sửa thủ công |
| full_name               | String       | Có                    | Họ tên đầy đủ                                                                                 |
| avatar                  | File/Image   | Không                 | Ảnh đại diện; lưu `avatar_file_id`, API trả `avatar: { file_id, download_url }`               |
| date_of_birth           | Date         | Không                 | Ngày sinh                                                                                     |
| gender                  | Select       | Không                 | Male/Female/Other                                                                             |
| nationality             | String       | Không                 | Quốc tịch                                                                                     |
| identity_number         | String       | Không/Có tùy cấu hình | CCCD/CMND/Hộ chiếu                                                                            |
| identity_issue_date     | Date         | Không                 | Ngày cấp                                                                                      |
| identity_issue_place    | String       | Không                 | Nơi cấp                                                                                       |
| marital_status          | Select       | Không                 | Độc thân/Đã kết hôn/Khác                                                                      |

---

#### Quy tắc mã nhân viên trên form thêm nhân viên

* Mặc định HR/Admin không cần nhập `employee_code`; hệ thống tự sinh theo cấu hình đang active.
* Form cần hiển thị mã preview để HR/Admin biết mã dự kiến trước khi lưu.
* Mã preview chỉ là mã dự kiến; mã chính thức được chốt khi lưu thành công để tránh trùng sequence khi nhiều người tạo đồng thời.
* Nếu `allow_manual_override = true` và người thao tác có quyền `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE`, hệ thống cho phép sửa mã thủ công.
* Nếu `lock_after_created = true`, sau khi tạo hồ sơ, mã nhân viên không được sửa trừ khi có quyền đặc biệt và cấu hình cho phép.

---

#### Nhóm 2: Thông tin liên hệ

| Trường                  | Kiểu dữ liệu | Bắt buộc        | Ghi chú                |
| ----------------------- | ------------ | --------------- | ---------------------- |
| personal_email          | String       | Không           | Email cá nhân          |
| company_email           | String       | Có nếu tạo user | Email công ty          |
| phone                   | String       | Không           | Số điện thoại          |
| emergency_contact_name  | String       | Không           | Người liên hệ khẩn cấp |
| emergency_contact_phone | String       | Không           | SĐT liên hệ khẩn cấp   |
| current_address         | Text         | Không           | Địa chỉ hiện tại       |
| permanent_address       | Text         | Không           | Địa chỉ thường trú     |

---

#### Nhóm 3: Thông tin công việc

| Trường               | Kiểu dữ liệu | Bắt buộc | Ghi chú                               |
| -------------------- | ------------ | -------- | ------------------------------------- |
| department_id        | Select       | Có       | Phòng ban                             |
| position_id          | Select       | Có       | Chức vụ                               |
| job_level_id         | Select       | Không    | Cấp bậc                               |
| direct_manager_id    | Select       | Không    | Quản lý trực tiếp                     |
| joined_date          | Date         | Có       | Ngày vào làm                          |
| probation_start_date | Date         | Không    | Ngày bắt đầu thử việc                 |
| probation_end_date   | Date         | Không    | Ngày kết thúc thử việc                |
| employment_status    | Select       | Có       | Mặc định Probation hoặc Official      |
| work_location        | String       | Không    | Địa điểm làm việc                     |
| employee_type        | Select       | Không    | Full-time/Part-time/Contractor/Intern |
| note                 | Text         | Không    | Ghi chú                               |

---

#### Nhóm 4: Thông tin hợp đồng

| Trường              | Kiểu dữ liệu | Bắt buộc | Ghi chú                         |
| ------------------- | ------------ | -------- | ------------------------------- |
| contract_type_id    | Select       | Không    | Loại hợp đồng                   |
| contract_number     | String       | Không    | Số hợp đồng                     |
| contract_start_date | Date         | Không    | Ngày bắt đầu                    |
| contract_end_date   | Date         | Không    | Ngày kết thúc                   |
| contract_status     | Select       | Không    | Draft/Active/Expired/Terminated/Cancelled |
| contract_file       | File         | Không    | File hợp đồng                   |

---

#### Nhóm 5: Thông tin tài khoản đăng nhập

| Trường              | Kiểu dữ liệu | Bắt buộc        | Ghi chú                          |
| ------------------- | ------------ | --------------- | -------------------------------- |
| create_user_account | Boolean      | Không           | Có tạo tài khoản đăng nhập không |
| login_email         | String       | Có nếu tạo user | Mặc định lấy company_email       |
| default_role        | Select       | Có nếu tạo user | Mặc định Employee                |
| send_activation     | Boolean      | Không           | Gửi link kích hoạt nếu có        |
| temporary_password  | String       | Không           | Tùy cấu hình                     |

#### Quy tắc tạo user

* Nếu `create_user_account = true`, hệ thống gọi module AUTH tạo user.
* User được liên kết với `employee_id`.
* Role mặc định là `Employee`, trừ khi HR/Admin chọn role khác.
* Email đăng nhập không được trùng trong bảng users.
* Một employee chỉ liên kết với một user chính.

---

#### Nút chức năng

| Nút             | Mô tả                        |
| --------------- | ---------------------------- |
| Lưu             | Lưu hồ sơ nhân viên          |
| Lưu và tạo tiếp | Lưu nhân viên và reset form  |
| Hủy             | Quay lại danh sách           |
| Upload file     | Upload tài liệu hồ sơ nếu có |

#### Validate

| Trường             | Rule                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| employee_code      | Hệ thống tự sinh và phải unique; nếu nhập thủ công cần quyền `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` và cấu hình cho phép |
| full_name          | Bắt buộc                                                                                                             |
| company_email      | Đúng định dạng email nếu nhập                                                                                        |
| personal_email     | Đúng định dạng email nếu nhập                                                                                        |
| phone              | Đúng định dạng số điện thoại nếu cấu hình                                                                            |
| department_id      | Bắt buộc                                                                                                             |
| position_id        | Bắt buộc                                                                                                             |
| joined_date        | Bắt buộc                                                                                                             |
| contract_end_date  | Không được nhỏ hơn contract_start_date                                                                               |
| probation_end_date | Không được nhỏ hơn probation_start_date                                                                              |
| direct_manager_id  | Không được là chính nhân viên đó                                                                                     |

---

### 13.3 HR-SCREEN-003: Chi tiết hồ sơ nhân viên

#### Mục đích

Hiển thị đầy đủ thông tin nhân viên theo quyền truy cập.

#### Người dùng truy cập

* HR
* Admin
* Super Admin
* Manager theo scope
* Employee xem hồ sơ của chính mình

#### Cấu trúc màn hình

Màn hình chi tiết nhân viên gồm các tab:

| Tab               | Nội dung                                          |
| ----------------- | ------------------------------------------------- |
| Tổng quan         | Thông tin nhanh về nhân viên                      |
| Thông tin cá nhân | Ngày sinh, giới tính, liên hệ, địa chỉ            |
| Công việc         | Phòng ban, chức vụ, quản lý, trạng thái           |
| Hợp đồng          | Danh sách hợp đồng                                |
| Tài liệu          | File hồ sơ                                        |
| Tài khoản         | User liên kết từ AUTH                             |
| Lịch sử thay đổi  | Audit log                                         |
| Liên kết module   | Chấm công, nghỉ phép, task, sau này lương/tài sản |

#### Thông tin tổng quan hiển thị

| Trường              | Mô tả             |
| ------------------- | ----------------- |
| Avatar              | Ảnh nhân viên     |
| Họ tên              | full_name         |
| Mã nhân viên        | employee_code     |
| Chức vụ             | position          |
| Phòng ban           | department        |
| Trạng thái          | employment_status |
| Email công ty       | company_email     |
| Số điện thoại       | phone             |
| Ngày vào làm        | joined_date       |
| Quản lý trực tiếp   | direct_manager    |
| Tài khoản đăng nhập | Có/Không          |

#### Quy tắc hiển thị dữ liệu nhạy cảm

Các trường sau chỉ hiển thị nếu có quyền `HR.EMPLOYEE.VIEW_SENSITIVE`:

* CCCD/CMND/Hộ chiếu
* Ngày cấp/nơi cấp
* Địa chỉ thường trú
* Tài khoản ngân hàng nếu có ở giai đoạn sau
* File giấy tờ cá nhân
* Hợp đồng lao động nếu công ty coi là nhạy cảm
* Dữ liệu lương nếu tích hợp sau này

---

### 13.4 HR-SCREEN-004: Chỉnh sửa hồ sơ nhân viên

#### Mục đích

Cho phép HR/Admin cập nhật thông tin nhân viên.

#### Quy tắc

* Mọi thay đổi quan trọng phải ghi audit log.
* Không cho sửa `employee_code` nếu hệ thống đã khóa mã nhân viên.
* Không cho sửa thông tin tài khoản đăng nhập trực tiếp trong HR nếu thuộc phạm vi AUTH, trừ thao tác liên kết user.
* Không cho cập nhật trạng thái nhân viên bằng cách sửa trực tiếp field nếu cần quy trình riêng, nên dùng chức năng Đổi trạng thái.
* Employee không cập nhật trực tiếp hồ sơ chính; Employee chỉ được gửi yêu cầu cập nhật một số trường cá nhân nếu được cấu hình, và thay đổi chỉ có hiệu lực sau khi HR/Admin/Super Admin duyệt.

#### Các trường Employee có thể gửi yêu cầu cập nhật

| Nhóm thông tin | Trường                  | Cho phép Employee gửi yêu cầu sửa |
| -------------- | ----------------------- | --------------------------------- |
| Cá nhân        | avatar (avatar_file_id) | Có                                |
| Cá nhân        | date_of_birth           | Có, nếu cấu hình cho phép         |
| Cá nhân        | gender                  | Có                                |
| Cá nhân        | marital_status          | Có                                |
| Liên hệ        | personal_email          | Có                                |
| Liên hệ        | phone                   | Có                                |
| Liên hệ        | current_address         | Có                                |
| Liên hệ        | permanent_address       | Có                                |
| Khẩn cấp       | emergency_contact_name  | Có                                |
| Khẩn cấp       | emergency_contact_phone | Có                                |
| Giấy tờ        | identity_number         | Có, nhưng cần duyệt nghiêm ngặt   |
| Giấy tờ        | identity_issue_date     | Có                                |
| Giấy tờ        | identity_issue_place    | Có                                |
| Công việc      | department_id           | Không                             |
| Công việc      | position_id             | Không                             |
| Công việc      | job_level_id            | Không                             |
| Công việc      | direct_manager_id       | Không                             |
| Công việc      | employment_status       | Không                             |
| Hợp đồng       | contract                | Không                             |
| Tài khoản      | role/user permission    | Không                             |

---

### 13.5 HR-SCREEN-005: Hồ sơ của tôi

#### Mục đích

Cho phép nhân viên xem hồ sơ cá nhân của chính mình.

#### Người dùng truy cập

* Tất cả user có liên kết employee

#### Dữ liệu hiển thị

| Nhóm           | Nội dung                                  |
| -------------- | ----------------------------------------- |
| Cá nhân        | Họ tên, ngày sinh, giới tính, avatar      |
| Liên hệ        | Email, số điện thoại, địa chỉ             |
| Công việc      | Mã nhân viên, phòng ban, chức vụ, quản lý |
| Hợp đồng       | Chỉ hiển thị nếu công ty cho phép         |
| Tài khoản      | Email đăng nhập, vai trò                  |
| Liên kết nhanh | Bảng công, đơn nghỉ, task của tôi         |

#### Quy tắc

* User chỉ xem được hồ sơ của chính mình.
* Nếu user chưa liên kết employee, hiển thị thông báo: “Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên.”
* Các trường nhạy cảm có thể bị ẩn tùy cấu hình.
* Khi Employee bấm chỉnh sửa hồ sơ, hệ thống điều hướng sang luồng tạo yêu cầu cập nhật hồ sơ cá nhân, không lưu trực tiếp vào bảng `employees`.

---

### 13.6 HR-SCREEN-006: Danh sách phòng ban

#### Mục đích

Quản lý cơ cấu phòng ban của doanh nghiệp.

#### Thành phần giao diện

* Nút Thêm phòng ban
* Ô tìm kiếm phòng ban
* Bộ lọc trạng thái
* Bảng phòng ban
* Tree view phòng ban nếu hỗ trợ phòng ban cha/con
* Hành động: Xem, sửa, vô hiệu hóa

#### Cột hiển thị

| Cột           | Mô tả             |
| ------------- | ----------------- |
| Tên phòng ban | name   |
| Mã phòng ban  | department_code   |
| Phòng ban cha | parent_department |
| Trưởng phòng  | manager           |
| Số nhân viên  | employee_count    |
| Trạng thái    | Active/Inactive   |
| Hành động     | Sửa/Vô hiệu hóa   |

---

### 13.7 HR-SCREEN-007: Tạo/chỉnh sửa phòng ban

#### Trường dữ liệu

| Trường               | Kiểu dữ liệu | Bắt buộc | Ghi chú         |
| -------------------- | ------------ | -------- | --------------- |
| department_code      | String       | Có       | Unique          |
| name                 | String       | Có       | Tên phòng ban   |
| parent_id            | Select       | Không    | Phòng ban cha   |
| manager_employee_id  | Select       | Không    | Trưởng phòng    |
| description          | Text         | Không    | Mô tả           |
| status               | Select       | Có       | Active/Inactive |

#### Quy tắc

* `department_code` không được trùng.
* Không được chọn chính phòng ban đó làm phòng ban cha.
* Không được tạo vòng lặp phòng ban cha/con.
* Không được xóa phòng ban đang có nhân viên active, chỉ được inactive nếu còn nhân viên.
* Trưởng phòng phải là nhân viên đang active hoặc official/probation tùy cấu hình.

---

### 13.8 HR-SCREEN-008: Danh sách chức vụ

#### Mục đích

Quản lý danh mục chức vụ.

#### Cột hiển thị

| Cột              | Mô tả           |
| ---------------- | --------------- |
| Tên chức vụ      | name   |
| Mã chức vụ       | position_code   |
| Cấp bậc mặc định | default_level   |
| Mô tả            | description     |
| Số nhân viên     | employee_count  |
| Trạng thái       | Active/Inactive |
| Hành động        | Sửa/Vô hiệu hóa |

---

### 13.9 HR-SCREEN-009: Tạo/chỉnh sửa chức vụ

#### Trường dữ liệu

| Trường           | Kiểu dữ liệu | Bắt buộc | Ghi chú          |
| ---------------- | ------------ | -------- | ---------------- |
| position_code    | String       | Có       | Unique           |
| name    | String       | Có       | Tên chức vụ      |
| job_level_id     | Select       | Không    | Cấp bậc mặc định |
| description      | Text         | Không    | Mô tả            |
| status           | Select       | Có       | Active/Inactive  |

#### Quy tắc

* `position_code` không được trùng.
* Không xóa cứng chức vụ đang được gán cho nhân viên.
* Chức vụ inactive không được chọn khi tạo nhân viên mới.

---

### 13.10 HR-SCREEN-010: Tab hợp đồng nhân viên

#### Mục đích

Quản lý hợp đồng của từng nhân viên.

#### Cột danh sách hợp đồng

| Cột           | Mô tả                           |
| ------------- | ------------------------------- |
| Số hợp đồng   | contract_number                 |
| Loại hợp đồng | contract_type                   |
| Ngày bắt đầu  | start_date                      |
| Ngày kết thúc | end_date                        |
| Trạng thái    | Draft/Active/Expired/Terminated |
| File          | Có/Không                        |
| Hành động     | Xem/Sửa/Tải file/Vô hiệu hóa    |

#### Quy tắc

* Một nhân viên có thể có nhiều hợp đồng.
* Tại một thời điểm nên chỉ có một hợp đồng Active chính.
* Nếu có hợp đồng Active mới trùng thời gian hợp đồng Active cũ, hệ thống cần cảnh báo.
* Hợp đồng hết hạn có thể chuyển trạng thái Expired tự động hoặc thủ công.
* Hợp đồng sắp hết hạn có thể gửi notification cho HR.

---

### 13.11 HR-SCREEN-011: Tab tài liệu hồ sơ

#### Mục đích

Lưu trữ tài liệu liên quan đến nhân viên.

#### Loại tài liệu gợi ý

| Mã loại     | Tên loại tài liệu  |
| ----------- | ------------------ |
| CV          | CV / Resume        |
| ID_CARD     | CCCD/CMND/Hộ chiếu |
| CONTRACT    | Hợp đồng           |
| DEGREE      | Bằng cấp           |
| CERTIFICATE | Chứng chỉ          |
| DECISION    | Quyết định         |
| RESIGNATION | Hồ sơ nghỉ việc    |
| OTHER       | Khác               |

#### Cột hiển thị

| Cột           | Mô tả       |
| ------------- | ----------- |
| Tên file      | file_name   |
| Loại tài liệu | file_type   |
| Người upload  | uploaded_by |
| Ngày upload   | uploaded_at |
| Dung lượng    | file_size   |
| Ghi chú       | note        |
| Hành động     | Xem/Tải/Xóa |

#### Quy tắc

* File nhạy cảm chỉ người có quyền mới xem/tải.
* File upload cần giới hạn định dạng và dung lượng.
* Xóa file nên là xóa mềm.
* Upload/xóa/tải file nhạy cảm cần ghi audit log nếu cấu hình.

---

### 13.12 HR-SCREEN-012: Tab lịch sử thay đổi

#### Mục đích

Hiển thị lịch sử thay đổi hồ sơ nhân viên.

#### Người dùng truy cập

* Super Admin
* Admin có quyền
* HR có quyền
* Người có quyền `HR.AUDIT_LOG.VIEW`

#### Cột hiển thị

| Cột             | Mô tả      |
| --------------- | ---------- |
| Thời gian       | created_at |
| Người thực hiện | actor      |
| Hành động       | action     |
| Trường thay đổi | field_name |
| Giá trị cũ      | old_value  |
| Giá trị mới     | new_value  |
| IP/Thiết bị     | Nếu có     |

#### Hành động cần ghi log

* Tạo nhân viên
* Cập nhật hồ sơ
* Đổi phòng ban
* Đổi chức vụ
* Đổi quản lý trực tiếp
* Đổi trạng thái nhân viên
* Thêm/sửa/xóa hợp đồng
* Upload/xóa file hồ sơ
* Liên kết/hủy liên kết user
* Xuất dữ liệu nhân viên

---

### 13.12a HR-SCREEN-013: Sơ đồ tổ chức cơ bản

#### Mục đích

Hiển thị sơ đồ tổ chức cơ bản của doanh nghiệp dưới dạng cây phòng ban và quan hệ quản lý trực tiếp, giúp HR/Admin/Manager nắm nhanh cơ cấu.

#### Người dùng truy cập

* Super Admin
* Admin công ty
* HR
* Manager theo scope Team/Department
* Người có quyền `HR.ORG_CHART.VIEW`

#### Thành phần giao diện

* Tiêu đề: Sơ đồ tổ chức
* Chế độ xem cây phòng ban (department tree)
* Chế độ xem cây quản lý trực tiếp (reporting line)
* Bộ lọc phòng ban gốc
* Ô tìm kiếm nhân viên/phòng ban
* Nút thu gọn/mở rộng toàn bộ
* Node hiển thị thông tin tóm tắt
* Nút điều hướng sang chi tiết phòng ban hoặc hồ sơ nhân viên

#### Thông tin hiển thị trên node

| Trường            | Mô tả                          |
| ----------------- | ------------------------------ |
| Phòng ban         | name (departments)             |
| Trưởng phòng      | manager_employee_id của departments |
| Số nhân viên      | employee_count theo department |
| Họ tên nhân viên  | full_name (employees)          |
| Chức vụ           | name                  |
| Quản lý trực tiếp | direct_manager_id (employees)  |
| Avatar            | avatar_file_id → avatar { file_id, download_url } |

#### Hành động trên màn hình

| Hành động              | Permission         |
| ---------------------- | ------------------ |
| Xem sơ đồ tổ chức      | HR.ORG_CHART.VIEW  |
| Xem chi tiết phòng ban | HR.DEPARTMENT.VIEW |
| Xem hồ sơ nhân viên    | HR.EMPLOYEE.VIEW   |

#### Quy tắc hiển thị

* Cây phòng ban dựng theo `parent_id` trong bảng `departments`.
* Cây quản lý trực tiếp dựng theo `direct_manager_id` trong bảng `employees`.
* Chỉ hiển thị phòng ban/nhân viên trong phạm vi data scope của người dùng.
* Manager chỉ thấy nhánh tổ chức thuộc scope Team/Department được cấp.
* Không tạo vòng lặp; nếu dữ liệu có vòng lặp quản lý, hiển thị cảnh báo (tham chiếu HR-ERR-016).
* Dữ liệu nhạy cảm của nhân viên không hiển thị trên node, chỉ thông tin cơ bản.
* Phòng ban/nhân viên inactive hoặc đã xóa mềm (`deleted_at`) không hiển thị mặc định.

---

### 13.12b HR-SCREEN-014: Danh mục cấp bậc

#### Mục đích

Quản lý danh mục cấp bậc / level nhân sự (bảng `job_levels`) để dùng khi tạo và cập nhật hồ sơ nhân viên.

#### Người dùng truy cập

* Super Admin
* Admin công ty
* HR
* Người có quyền `HR.MASTER_DATA.MANAGE`

#### Thành phần giao diện

* Nút Thêm cấp bậc
* Ô tìm kiếm cấp bậc
* Bộ lọc trạng thái
* Bảng danh mục cấp bậc
* Hành động: Xem, sửa, vô hiệu hóa

#### Cột hiển thị

| Cột          | Mô tả           |
| ------------ | --------------- |
| Tên cấp bậc  | name      |
| Mã cấp bậc   | level_code      |
| Thứ tự       | order_index     |
| Mô tả        | description     |
| Số nhân viên | employee_count  |
| Trạng thái   | Active/Inactive |
| Hành động    | Sửa/Vô hiệu hóa |

#### Trường dữ liệu khi tạo/chỉnh sửa

| Trường      | Kiểu dữ liệu | Bắt buộc | Ghi chú         |
| ----------- | ------------ | -------- | --------------- |
| level_code  | String       | Có       | Unique          |
| name  | String       | Có       | Tên cấp bậc     |
| order_index | Integer      | Không    | Thứ tự hiển thị |
| description | Text         | Không    | Mô tả           |
| status      | Select       | Có       | Active/Inactive |

#### Hành động trên màn hình

| Hành động    | Permission            |
| ------------ | --------------------- |
| Xem danh mục | HR.MASTER_DATA.MANAGE |
| Thêm cấp bậc | HR.MASTER_DATA.MANAGE |
| Sửa cấp bậc  | HR.MASTER_DATA.MANAGE |
| Vô hiệu hóa  | HR.MASTER_DATA.MANAGE |

#### Quy tắc

* `level_code` không được trùng (báo lỗi HR-ERR-048 nếu trùng).
* Cấp bậc inactive không xuất hiện trong dropdown tạo/cập nhật nhân viên mới.
* Không xóa cứng cấp bậc đang được gán cho nhân viên; chỉ vô hiệu hóa.
* Nhân viên cũ vẫn giữ `job_level_id` cũ nếu cấp bậc bị inactive.
* Tham chiếu bảng dữ liệu §15.4 `job_levels`.

---

### 13.12c HR-SCREEN-015: Danh mục loại hợp đồng

#### Mục đích

Quản lý danh mục loại hợp đồng (bảng `contract_types`) để dùng khi tạo và cập nhật hợp đồng nhân viên.

#### Người dùng truy cập

* Super Admin
* Admin công ty
* HR
* Người có quyền `HR.MASTER_DATA.MANAGE`

#### Thành phần giao diện

* Nút Thêm loại hợp đồng
* Ô tìm kiếm loại hợp đồng
* Bộ lọc trạng thái
* Bảng danh mục loại hợp đồng
* Hành động: Xem, sửa, vô hiệu hóa

#### Cột hiển thị

| Cột               | Mô tả                   |
| ----------------- | ----------------------- |
| Tên loại hợp đồng | contract_type_name      |
| Mã loại hợp đồng  | contract_type_code      |
| Thời hạn mặc định | default_duration_months |
| Mô tả             | description             |
| Trạng thái        | Active/Inactive         |
| Hành động         | Sửa/Vô hiệu hóa         |

#### Trường dữ liệu khi tạo/chỉnh sửa

| Trường                  | Kiểu dữ liệu | Bắt buộc | Ghi chú           |
| ----------------------- | ------------ | -------- | ----------------- |
| contract_type_code      | String       | Có       | Unique            |
| contract_type_name      | String       | Có       | Tên loại hợp đồng |
| default_duration_months | Integer      | Không    | Số tháng mặc định |
| description             | Text         | Không    | Mô tả             |
| status                  | Select       | Có       | Active/Inactive   |

#### Hành động trên màn hình

| Hành động          | Permission            |
| ------------------ | --------------------- |
| Xem danh mục       | HR.MASTER_DATA.MANAGE |
| Thêm loại hợp đồng | HR.MASTER_DATA.MANAGE |
| Sửa loại hợp đồng  | HR.MASTER_DATA.MANAGE |
| Vô hiệu hóa        | HR.MASTER_DATA.MANAGE |

#### Quy tắc

* `contract_type_code` không được trùng (báo lỗi HR-ERR-049 nếu trùng).
* Loại hợp đồng inactive không được chọn cho hợp đồng mới (tham chiếu HR-SCREEN-010 và HR-FUNC-009/016).
* Không xóa cứng loại hợp đồng đang được gán cho hợp đồng; chỉ vô hiệu hóa.
* `default_duration_months` có thể dùng để gợi ý `end_date` khi tạo hợp đồng.
* Tham chiếu bảng dữ liệu §15.5 `contract_types`.

---

### 13.13 HR-SCREEN-016: Yêu cầu cập nhật hồ sơ của tôi

#### Mục đích

Cho phép Employee xem các yêu cầu cập nhật hồ sơ cá nhân do chính mình tạo.

#### Người dùng truy cập

* Employee có quyền `HR.PROFILE_CHANGE_REQUEST.VIEW_OWN`
* User phải liên kết với một `employee_id`

#### Thành phần giao diện

* Danh sách yêu cầu cập nhật hồ sơ.
* Bộ lọc trạng thái: Draft, Pending, Approved, Rejected, Cancelled.
* Cột ngày gửi yêu cầu.
* Cột nhóm thông tin thay đổi.
* Cột trạng thái.
* Cột người xử lý và ngày xử lý nếu có.
* Nút xem chi tiết.
* Nút hủy yêu cầu nếu trạng thái còn Pending.

---

### 13.14 HR-SCREEN-017: Tạo yêu cầu cập nhật hồ sơ cá nhân

#### Mục đích

Cho phép Employee đề xuất cập nhật các trường cá nhân được cấu hình cho phép.

#### Thành phần giao diện

* Form thông tin cá nhân được phép đề xuất sửa.
* Khu vực hiển thị dữ liệu hiện tại.
* Khu vực nhập dữ liệu mới.
* Ô nhập lý do cập nhật.
* Upload file chứng minh nếu cần.
* Nút Gửi yêu cầu.
* Nút Hủy.

#### Quy tắc hiển thị

* Không hiển thị trường công việc, hợp đồng, phân quyền, phòng ban, chức vụ và trạng thái làm việc để Employee tự sửa.
* Trường giấy tờ cá nhân như CCCD/CMND có thể yêu cầu file chứng minh và duyệt nghiêm ngặt.
* Nếu không có thay đổi dữ liệu, hệ thống không cho gửi yêu cầu.
* Nếu đang có yêu cầu Pending cho cùng nhóm trường, hệ thống có thể chặn tạo yêu cầu mới theo cấu hình.

---

### 13.15 HR-SCREEN-018: Danh sách yêu cầu cập nhật hồ sơ

#### Mục đích

Cho phép HR/Admin xem và xử lý các yêu cầu cập nhật hồ sơ cá nhân do Employee gửi.

#### Người dùng truy cập

* Super Admin
* Admin công ty có quyền
* HR có quyền `HR.PROFILE_CHANGE_REQUEST.VIEW`

#### Bộ lọc

| Bộ lọc          | Mô tả                                       |
| --------------- | ------------------------------------------- |
| Từ khóa         | Tìm theo mã nhân viên, tên nhân viên, email |
| Phòng ban       | Lọc theo department_id                      |
| Trạng thái      | Draft/Pending/Approved/Rejected/Cancelled   |
| Người tạo       | Employee gửi yêu cầu                        |
| Người xử lý     | HR/Admin đã duyệt/từ chối                   |
| Thời gian tạo   | Từ ngày - đến ngày                          |
| Thời gian xử lý | Từ ngày - đến ngày                          |

#### Cột hiển thị

| Cột             | Mô tả                               |
| --------------- | ----------------------------------- |
| Mã yêu cầu      | request_code hoặc id rút gọn        |
| Nhân viên       | Mã nhân viên + họ tên               |
| Phòng ban       | Phòng ban hiện tại                  |
| Trường thay đổi | Danh sách field thay đổi            |
| Trạng thái      | Pending/Approved/Rejected/Cancelled |
| Ngày gửi        | created_at                          |
| Người xử lý     | approver/reviewer                   |
| Ngày xử lý      | reviewed_at                         |
| Hành động       | Xem, duyệt, từ chối                 |

---

### 13.16 HR-SCREEN-019: Chi tiết yêu cầu cập nhật hồ sơ

#### Mục đích

Hiển thị chi tiết yêu cầu cập nhật hồ sơ, bao gồm dữ liệu cũ, dữ liệu mới, lý do, file đính kèm và lịch sử xử lý.

#### Thành phần giao diện

* Thông tin nhân viên gửi yêu cầu.
* Bảng so sánh giá trị cũ và giá trị mới.
* Lý do cập nhật.
* File đính kèm.
* Cảnh báo xung đột nếu dữ liệu gốc đã thay đổi sau khi yêu cầu được tạo.
* Lịch sử xử lý.
* Nút Duyệt.
* Nút Từ chối.
* Modal nhập lý do từ chối.

#### Quy tắc

* Employee chỉ xem được yêu cầu của chính mình.
* HR/Admin xem được theo quyền và scope.
* Chỉ yêu cầu Pending mới được duyệt/từ chối.
* Từ chối bắt buộc nhập lý do.
* Sau khi đã Approved/Rejected/Cancelled, yêu cầu không được chỉnh sửa.

---

### 13.17 HR-SCREEN-020: Cấu hình mã nhân viên

#### Mục đích

Cho phép HR/Admin có quyền cấu hình quy tắc sinh mã nhân viên.

#### Cấu hình cần hỗ trợ

| Cấu hình              | Mô tả                                             |
| --------------------- | ------------------------------------------------- |
| auto_generate_enabled | Bật/tắt tự sinh mã nhân viên                      |
| prefix                | Tiền tố mã, ví dụ EMP                             |
| use_department_code   | Có dùng mã phòng ban trong mã nhân viên không     |
| use_year              | Có dùng năm không                                 |
| use_month             | Có dùng tháng không                               |
| separator             | Ký tự phân tách, ví dụ `-`                        |
| padding_length        | Độ dài số thứ tự, ví dụ 4 tạo ra 0001             |
| start_number          | Số bắt đầu                                        |
| reset_policy            | Never/Yearly/Monthly/Daily                         |
| allow_manual_override | Có cho sửa mã thủ công không                      |
| lock_after_created    | Có khóa mã sau khi tạo không                      |
| pattern               | Pattern động nếu cần, ví dụ `{YYYY}-{DEPT}-{SEQ}` |
| status                | Active/Inactive                                   |

#### Hành động trên màn hình

| Hành động                 | Permission                     |
| ------------------------- | ------------------------------ |
| Xem cấu hình              | HR.EMPLOYEE_CODE_CONFIG.VIEW   |
| Cập nhật cấu hình         | HR.EMPLOYEE_CODE_CONFIG.UPDATE |
| Xem trước mã tiếp theo    | HR.EMPLOYEE_CODE.PREVIEW       |
| Bật/tắt override thủ công | HR.EMPLOYEE_CODE_CONFIG.UPDATE |

---

## 14. Chi tiết chức năng

### 14.1 HR-FUNC-001: Xem danh sách nhân viên

#### Mục tiêu

Cho phép người dùng có quyền xem danh sách nhân viên theo phạm vi dữ liệu được cấp.

#### Người dùng

* Super Admin
* Admin công ty
* HR
* Manager theo scope
* Người có quyền `HR.EMPLOYEE.VIEW`

#### Điều kiện trước

* Người dùng đã đăng nhập.
* Người dùng có quyền `HR.EMPLOYEE.VIEW`.
* Hệ thống xác định được data scope của người dùng.

#### Luồng chính

1. Người dùng vào menu Nhân sự.
2. Hệ thống kiểm tra quyền `HR.EMPLOYEE.VIEW`.
3. Hệ thống xác định data scope.
4. Hệ thống lấy danh sách nhân viên phù hợp.
5. Hệ thống hiển thị bảng danh sách.
6. Người dùng có thể tìm kiếm, lọc, phân trang.

#### Kết quả thành công

* Danh sách nhân viên được hiển thị đúng theo quyền.
* Không hiển thị dữ liệu vượt quá scope.

#### Tiêu chí nghiệm thu

* HR xem được toàn bộ nhân viên nếu có scope Company.
* Manager chỉ xem được nhân viên thuộc team/scope.
* Employee không vào được danh sách toàn công ty.
* Danh sách có phân trang.
* Dữ liệu nhạy cảm không hiển thị nếu không có quyền.

---

### 14.2 HR-FUNC-002: Tìm kiếm và lọc nhân viên

#### Mục tiêu

Cho phép người dùng tìm kiếm và lọc danh sách nhân viên nhanh chóng.

#### Điều kiện trước

* Người dùng có quyền xem danh sách nhân viên.

#### Tìm kiếm theo từ khóa

Từ khóa có thể áp dụng cho:

* Mã nhân viên
* Họ tên
* Email công ty
* Email cá nhân
* Số điện thoại
* Chức vụ
* Phòng ban

#### Bộ lọc

* Phòng ban
* Chức vụ
* Cấp bậc
* Trạng thái
* Loại hợp đồng
* Ngày vào làm
* Quản lý trực tiếp
* Địa điểm làm việc

#### Tiêu chí nghiệm thu

* Tìm kiếm đúng theo keyword.
* Lọc theo phòng ban đúng.
* Lọc theo trạng thái đúng.
* Kết hợp nhiều bộ lọc vẫn trả dữ liệu đúng.
* Kết quả vẫn tuân thủ data scope.

---

### 14.3 HR-FUNC-003: Xem chi tiết hồ sơ nhân viên

#### Mục tiêu

Cho phép người dùng xem chi tiết hồ sơ nhân viên theo quyền.

#### Người dùng

* HR
* Admin
* Super Admin
* Manager theo scope
* Employee xem chính mình

#### Luồng chính

1. Người dùng mở danh sách nhân viên hoặc hồ sơ của tôi.
2. Chọn một nhân viên.
3. Hệ thống kiểm tra quyền xem.
4. Hệ thống kiểm tra scope.
5. Hệ thống kiểm tra quyền xem dữ liệu nhạy cảm.
6. Hệ thống hiển thị hồ sơ nhân viên.

#### Quy tắc

* Nếu không có quyền xem nhân viên này, trả lỗi 403.
* Nếu có quyền xem nhưng không có quyền sensitive, ẩn trường nhạy cảm.
* Employee chỉ xem hồ sơ của chính mình.
* Manager chỉ xem nhân viên trong team/scope.

#### Tiêu chí nghiệm thu

* HR xem được chi tiết nhân viên.
* Employee chỉ xem được hồ sơ chính mình.
* Manager không xem được nhân viên ngoài scope.
* Trường nhạy cảm được ẩn nếu thiếu quyền.

---

### 14.4 HR-FUNC-004: Thêm nhân viên mới

#### Mục tiêu

Cho phép HR/Admin tạo hồ sơ nhân viên mới.

#### Người dùng

* Super Admin
* Admin công ty
* HR
* Người có quyền `HR.EMPLOYEE.CREATE`

#### Điều kiện trước

* Có dữ liệu phòng ban.
* Có dữ liệu chức vụ.
* Người dùng có quyền tạo nhân viên.

#### Luồng chính

1. Người dùng vào màn hình Nhân sự.
2. Bấm Thêm nhân viên.
3. Hệ thống hiển thị form.
4. Người dùng nhập thông tin bắt buộc, không cần nhập mã nhân viên mặc định.
5. Người dùng chọn phòng ban, chức vụ, trạng thái.
6. Hệ thống preview mã nhân viên dự kiến theo cấu hình.
7. Người dùng chọn tạo tài khoản đăng nhập nếu cần.
8. Người dùng bấm Lưu.
9. Hệ thống validate dữ liệu, sinh mã nhân viên chính thức và kiểm tra unique.
10. Hệ thống tạo hồ sơ nhân viên.
11. Nếu tạo user, hệ thống gọi module AUTH.
12. Hệ thống ghi audit log.
13. Hệ thống hiển thị thông báo thành công.

#### Dữ liệu bắt buộc tối thiểu

* full_name
* department_id
* position_id
* joined_date
* employment_status

`employee_code` do hệ thống tự sinh theo cấu hình. Chỉ nhập thủ công nếu có quyền `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` và cấu hình cho phép.

Nếu tạo tài khoản:

* company_email hoặc login_email
* default_role

#### Trường hợp lỗi

| Mã lỗi     | Trường hợp                        | Thông báo                                                       |
| ---------- | --------------------------------- | --------------------------------------------------------------- |
| HR-ERR-001 | Không sinh được mã nhân viên      | Hệ thống chưa thể sinh mã nhân viên, vui lòng kiểm tra cấu hình |
| HR-ERR-002 | Mã nhân viên đã tồn tại           | Mã nhân viên đã được sử dụng                                    |
| HR-ERR-003 | Thiếu họ tên                      | Vui lòng nhập họ tên nhân viên                                  |
| HR-ERR-004 | Thiếu phòng ban                   | Vui lòng chọn phòng ban                                         |
| HR-ERR-005 | Thiếu chức vụ                     | Vui lòng chọn chức vụ                                           |
| HR-ERR-006 | Thiếu ngày vào làm                | Vui lòng chọn ngày vào làm                                      |
| HR-ERR-007 | Email không đúng định dạng        | Email không đúng định dạng                                      |
| HR-ERR-008 | Email công ty đã tồn tại          | Email công ty đã được sử dụng                                   |
| HR-ERR-009 | Phòng ban không hợp lệ            | Phòng ban không tồn tại hoặc đã bị vô hiệu hóa                  |
| HR-ERR-010 | Chức vụ không hợp lệ              | Chức vụ không tồn tại hoặc đã bị vô hiệu hóa                    |
| HR-ERR-011 | Không có quyền tạo nhân viên      | Bạn không có quyền tạo nhân viên                                |
| HR-ERR-012 | Không thể tạo tài khoản đăng nhập | Tạo nhân viên thành công nhưng tạo tài khoản thất bại           |

#### Tiêu chí nghiệm thu

* HR tạo nhân viên thành công với dữ liệu hợp lệ.
* Không tạo được nếu thiếu trường bắt buộc.
* Không tạo được nếu mã nhân viên trùng.
* Không tạo được nếu email đăng nhập trùng.
* Nhân viên mới xuất hiện trong danh sách.
* Hệ thống ghi audit log.
* Nếu chọn tạo user, user được tạo trong AUTH và liên kết đúng employee_id.

---

### 14.5 HR-FUNC-005: Cập nhật hồ sơ nhân viên

#### Mục tiêu

Cho phép người có quyền cập nhật thông tin nhân viên.

#### Người dùng

* Super Admin
* Admin
* HR
* Manager nếu được cấp quyền giới hạn
* Employee nếu được phép cập nhật trường cá nhân

#### Luồng chính

1. Người dùng mở hồ sơ nhân viên.
2. Bấm Chỉnh sửa.
3. Hệ thống kiểm tra quyền.
4. Người dùng sửa thông tin.
5. Bấm Lưu.
6. Hệ thống validate dữ liệu.
7. Hệ thống lưu thay đổi.
8. Hệ thống ghi audit log.
9. Hiển thị thông báo thành công.

#### Quy tắc

* Không được cập nhật email trùng.
* Không được chọn phòng ban/chức vụ inactive.
* Không được chọn direct manager là chính nhân viên đó.
* Không được tạo vòng lặp quản lý trực tiếp.
* Các trường nhạy cảm chỉ người có quyền mới sửa được.
* Nếu thay đổi phòng ban/chức vụ/quản lý, cần ghi log rõ ràng.

#### Tiêu chí nghiệm thu

* Người có quyền cập nhật được hồ sơ.
* Người không có quyền bị chặn.
* Thay đổi hiển thị đúng sau khi lưu.
* Lịch sử thay đổi ghi đúng field cũ và mới.
* Không làm mất liên kết user nếu không có thao tác thay đổi user.

---

### 14.6 HR-FUNC-006: Đổi trạng thái nhân viên

#### Mục tiêu

Cho phép HR/Admin thay đổi trạng thái làm việc của nhân viên.

#### Trạng thái hỗ trợ

* Probation
* Official
* Temporarily Suspended
* Resigned
* Terminated

#### Luồng chính

1. HR mở hồ sơ nhân viên.
2. Bấm Đổi trạng thái.
3. Chọn trạng thái mới.
4. Nhập ngày hiệu lực.
5. Nhập lý do/ghi chú nếu cần.
6. Nếu trạng thái là Resigned/Terminated, nhập ngày nghỉ việc.
7. Chọn có khóa tài khoản đăng nhập không.
8. Bấm Xác nhận.
9. Hệ thống cập nhật trạng thái.
10. Nếu chọn khóa tài khoản, hệ thống gọi AUTH khóa user.
11. Hệ thống ghi audit log.

#### Quy tắc

* Không cho nhân viên đã Resigned/Terminated chấm công mới.
* Không cho nhân viên đã Resigned/Terminated tạo đơn nghỉ mới.
* Task đang giao cho nhân viên nghỉ việc cần được xử lý ở module TASK.
* Tài sản đang cấp phát cho nhân viên nghỉ việc sẽ xử lý ở module ASSET sau MVP.
* Lương chốt cuối kỳ xử lý ở module PAYROLL sau MVP.

#### Tiêu chí nghiệm thu

* HR đổi trạng thái thành công.
* Trạng thái mới hiển thị trong danh sách.
* Nhân viên nghỉ việc không còn active trong các module liên quan nếu module đó áp dụng filter.
* Nếu chọn khóa user, tài khoản bị khóa trong AUTH.
* Audit log ghi rõ trạng thái cũ và mới.

---

### 14.7 HR-FUNC-007: Quản lý phòng ban

#### Mục tiêu

Cho phép HR/Admin quản lý danh mục phòng ban.

#### Chức năng con

* Xem danh sách phòng ban
* Tạo phòng ban
* Cập nhật phòng ban
* Vô hiệu hóa phòng ban
* Chọn phòng ban cha
* Gán trưởng phòng

#### Quy tắc

* department_code unique.
* Không xóa cứng phòng ban.
* Phòng ban có nhân viên active không được xóa/vô hiệu hóa nếu chưa chuyển nhân viên đi hoặc có cảnh báo.
* Không tạo vòng lặp phòng ban cha/con.
* Trưởng phòng phải là employee active.

#### Tiêu chí nghiệm thu

* Tạo phòng ban thành công.
* Không tạo được mã phòng ban trùng.
* Cập nhật được trưởng phòng.
* Không tạo được cấu trúc cha/con vòng lặp.
* Phòng ban inactive không xuất hiện trong dropdown tạo nhân viên mới.

---

### 14.8 HR-FUNC-008: Quản lý chức vụ

#### Mục tiêu

Cho phép HR/Admin quản lý danh mục chức vụ.

#### Chức năng con

* Xem danh sách chức vụ
* Tạo chức vụ
* Cập nhật chức vụ
* Vô hiệu hóa chức vụ

#### Quy tắc

* position_code unique.
* Không xóa cứng chức vụ đã gán cho nhân viên.
* Chức vụ inactive không được chọn khi tạo/cập nhật nhân viên mới.

#### Tiêu chí nghiệm thu

* Tạo chức vụ thành công.
* Không tạo được mã chức vụ trùng.
* Sửa chức vụ thành công.
* Vô hiệu hóa chức vụ không làm mất dữ liệu nhân viên cũ.

---

### 14.9 HR-FUNC-009: Quản lý thông tin hợp đồng

#### Mục tiêu

Quản lý hợp đồng của nhân viên.

#### Người dùng

* HR
* Admin
* Người có quyền `HR.CONTRACT.*`

#### Chức năng con

* Xem danh sách hợp đồng của nhân viên
* Thêm hợp đồng
* Cập nhật hợp đồng
* Upload file hợp đồng
* Vô hiệu hóa/xóa mềm hợp đồng
* Cảnh báo hợp đồng sắp hết hạn

#### Dữ liệu hợp đồng

| Trường           | Bắt buộc | Ghi chú                                     |
| ---------------- | -------- | ------------------------------------------- |
| employee_id      | Có       | Nhân viên                                   |
| contract_number  | Không    | Số hợp đồng                                 |
| contract_type_id | Có       | Loại hợp đồng                               |
| start_date       | Có       | Ngày bắt đầu                                |
| end_date         | Không    | Có thể trống với HĐ không xác định thời hạn |
| status           | Có       | Draft/Active/Expired/Terminated             |
| file_id          | Không    | File hợp đồng                               |
| note             | Không    | Ghi chú                                     |

#### Quy tắc

* `end_date` không được nhỏ hơn `start_date`.
* Một nhân viên không nên có nhiều hợp đồng Active trùng thời gian.
* Hợp đồng gần hết hạn có thể tạo notification cho HR trước số ngày cấu hình.
* Không cho Employee tự sửa hợp đồng.

#### Tiêu chí nghiệm thu

* HR thêm hợp đồng thành công.
* Hợp đồng hiển thị trong hồ sơ nhân viên.
* Hệ thống cảnh báo nếu hợp đồng trùng thời gian.
* File hợp đồng upload thành công nếu đúng định dạng.
* Audit log ghi nhận thao tác hợp đồng.

---

### 14.10 HR-FUNC-010: Upload và quản lý file hồ sơ

#### Mục tiêu

Cho phép HR/Admin lưu file hồ sơ nhân viên.

#### Người dùng

* HR
* Admin
* Người có quyền `HR.EMPLOYEE.FILE_UPLOAD`

#### Quy tắc upload

* Chỉ cho phép định dạng được cấu hình.
* Có giới hạn dung lượng file.
* File cần gắn với employee_id.
* File cần có loại tài liệu.
* File nhạy cảm cần phân quyền xem/tải.
* Xóa file là xóa mềm.

#### Định dạng file đề xuất

* PDF
* DOC/DOCX
* XLS/XLSX
* JPG/JPEG
* PNG

#### Tiêu chí nghiệm thu

* Upload file thành công.
* File xuất hiện trong tab tài liệu.
* Người không có quyền không xem/tải được.
* Xóa file không làm mất dữ liệu vật lý ngay nếu dùng soft delete.
* Audit log ghi nhận upload/xóa file.

---

### 14.11 HR-FUNC-011: Liên kết nhân viên với tài khoản đăng nhập

#### Mục tiêu

Liên kết hồ sơ Employee với User trong module AUTH.

#### Trường hợp sử dụng

* Tạo nhân viên và tạo user cùng lúc.
* Nhân viên đã có hồ sơ, sau đó tạo user.
* User đã có sẵn, sau đó liên kết với employee.
* Hủy liên kết user với employee nếu cần.

#### Quy tắc

* Một employee chỉ liên kết với một user chính.
* Một user chỉ liên kết với một employee chính.
* User liên kết phải thuộc cùng công ty/tenant nếu có multi-tenant.
* Khi nhân viên nghỉ việc, HR có thể khóa user.
* Không cho liên kết user đang bị deleted.

#### Tiêu chí nghiệm thu

* HR liên kết user với employee thành công.
* Không liên kết được nếu employee đã có user.
* Không liên kết được nếu user đã liên kết employee khác.
* Employee có user có thể đăng nhập và xem hồ sơ cá nhân.
* Audit log ghi nhận liên kết/hủy liên kết.

---

### 14.12 HR-FUNC-012: Xem lịch sử thay đổi hồ sơ

#### Mục tiêu

Cho phép người có quyền xem lịch sử thay đổi dữ liệu nhân sự.

#### Dữ liệu cần ghi

* Người thực hiện
* Thời gian
* Hành động
* Field thay đổi
* Giá trị cũ
* Giá trị mới
* Module
* IP/user agent nếu có

#### Tiêu chí nghiệm thu

* Cập nhật hồ sơ có log.
* Đổi trạng thái có log.
* Thêm/sửa hợp đồng có log.
* Upload/xóa file có log.
* Chỉ người có quyền mới xem được log.

---

### 14.13 HR-FUNC-013: Xuất danh sách nhân viên

#### Mục tiêu

Cho phép HR/Admin xuất danh sách nhân viên theo bộ lọc hiện tại.

#### Định dạng xuất

* Excel
* CSV

PDF có thể để phase sau.

#### Quy tắc

* Chỉ người có quyền `HR.EMPLOYEE.EXPORT` mới xuất được.
* Dữ liệu xuất phải tuân thủ data scope.
* Dữ liệu nhạy cảm chỉ xuất nếu có quyền `HR.EMPLOYEE.VIEW_SENSITIVE` hoặc quyền export sensitive riêng nếu bổ sung.
* Thao tác export cần ghi audit log.

#### Tiêu chí nghiệm thu

* Export đúng bộ lọc hiện tại.
* Người không có quyền không thấy nút export.
* Người không có quyền gọi API export bị chặn.
* File export không chứa dữ liệu vượt quyền.

---

### 14.14 HR-FUNC-014: Xem hồ sơ cá nhân

#### Mục tiêu

Cho phép nhân viên xem hồ sơ cá nhân của chính mình.

#### Người dùng

* Employee
* Tất cả user đã liên kết employee

#### Quy tắc

* Chỉ xem hồ sơ của chính mình.
* Có thể cập nhật một số trường cá nhân nếu cấu hình.
* Không được tự sửa phòng ban, chức vụ, lương, hợp đồng, trạng thái.

#### Tiêu chí nghiệm thu

* Employee mở được Hồ sơ của tôi.
* Employee không mở được hồ sơ của người khác bằng URL trực tiếp.
* Dữ liệu hiển thị đúng employee liên kết user hiện tại.

---

### 14.15 HR-FUNC-015: Quản lý cấp bậc

#### Mục tiêu

Cho phép HR/Admin quản lý danh mục cấp bậc nhân sự.

#### Dữ liệu

| Trường      | Bắt buộc | Ghi chú         |
| ----------- | -------- | --------------- |
| level_code  | Có       | Unique          |
| name  | Có       | Tên cấp bậc     |
| order_index | Không    | Thứ tự hiển thị |
| description | Không    | Mô tả           |
| status      | Có       | Active/Inactive |

#### Tiêu chí nghiệm thu

* Tạo được cấp bậc.
* Không tạo trùng level_code.
* Cấp bậc inactive không xuất hiện trong dropdown tạo nhân viên mới.
* Nhân viên cũ vẫn giữ dữ liệu level cũ nếu level bị inactive.

---

### 14.16 HR-FUNC-016: Quản lý loại hợp đồng

#### Mục tiêu

Cho phép HR/Admin quản lý danh mục loại hợp đồng.

#### Loại hợp đồng gợi ý

* Thử việc
* Xác định thời hạn
* Không xác định thời hạn
* Thời vụ
* Cộng tác viên
* Thực tập
* Dịch vụ/tư vấn

#### Dữ liệu

| Trường                  | Bắt buộc | Ghi chú           |
| ----------------------- | -------- | ----------------- |
| contract_type_code      | Có       | Unique            |
| contract_type_name      | Có       | Tên loại hợp đồng |
| default_duration_months | Không    | Số tháng mặc định |
| description             | Không    | Mô tả             |
| status                  | Có       | Active/Inactive   |

#### Tiêu chí nghiệm thu

* Tạo được loại hợp đồng.
* Không tạo trùng code.
* Loại hợp đồng inactive không được chọn cho hợp đồng mới.

---

### 14.17 HR-FUNC-017: Quản lý người quản lý trực tiếp

#### Mục tiêu

Gán direct manager cho nhân viên để phục vụ duyệt nghỉ, quản lý team và phân quyền scope.

#### Quy tắc

* direct_manager_id phải là employee active.
* Nhân viên không thể là quản lý trực tiếp của chính mình.
* Không tạo vòng lặp quản lý.
* Khi manager nghỉ việc, HR cần cập nhật lại nhân viên dưới quyền.
* Manager có thể xem nhân viên mà mình quản lý nếu có quyền scope Team.

#### Tiêu chí nghiệm thu

* Gán manager thành công.
* Không gán chính nhân viên làm manager của mình.
* Không tạo vòng lặp A quản lý B, B quản lý A.
* Dashboard Manager lấy đúng danh sách nhân viên team.

---

### 14.18 HR-FUNC-018: Employee gửi yêu cầu cập nhật hồ sơ cá nhân

#### Mục tiêu

Cho phép Employee tự đề xuất cập nhật một số thông tin cá nhân trong hồ sơ của mình. Thay đổi chỉ có hiệu lực sau khi được HR/Admin/Super Admin duyệt.

#### Người dùng

* Employee
* Manager
* HR
* Admin công ty
* Super Admin

Điều kiện: user phải liên kết với một `employee_id`.

#### Dữ liệu được phép đề xuất cập nhật

| Nhóm thông tin | Trường                                                                     | Cho phép Employee gửi yêu cầu sửa |
| -------------- | -------------------------------------------------------------------------- | --------------------------------- |
| Cá nhân        | avatar (avatar_file_id), date_of_birth, gender, marital_status              | Có theo cấu hình                  |
| Liên hệ        | personal_email, phone, current_address, permanent_address                  | Có                                |
| Khẩn cấp       | emergency_contact_name, emergency_contact_phone                            | Có                                |
| Giấy tờ        | identity_number, identity_issue_date, identity_issue_place                  | Có, cần duyệt nghiêm ngặt         |
| Công việc      | department_id, position_id, job_level_id, direct_manager_id, employment_status | Không                          |
| Hợp đồng       | contract                                                                   | Không                             |
| Tài khoản      | role/user permission                                                       | Không                             |

#### Luồng chính

```text
Employee đăng nhập
→ Vào Hồ sơ của tôi
→ Bấm Chỉnh sửa thông tin
→ Hệ thống hiển thị form các trường được phép đề xuất sửa
→ Employee thay đổi thông tin
→ Employee bấm Gửi yêu cầu
→ Hệ thống so sánh dữ liệu cũ và dữ liệu mới
→ Hệ thống tạo profile_change_request ở trạng thái Pending
→ HR/Admin nhận thông báo
→ Employee thấy yêu cầu trong danh sách Yêu cầu của tôi
```

#### Quy tắc nghiệp vụ

1. Employee không được cập nhật trực tiếp vào bảng `employees`.
2. Mọi thay đổi từ Employee phải tạo yêu cầu duyệt.
3. Yêu cầu có trạng thái mặc định là `Pending`.
4. Khi yêu cầu đang `Pending`, Employee có thể hủy nếu có quyền.
5. Employee không thể tạo yêu cầu mới nếu đang có yêu cầu `Pending` cho cùng một nhóm trường, trừ khi hệ thống cho phép nhiều yêu cầu song song.
6. Hệ thống cần lưu cả dữ liệu cũ và dữ liệu mới.
7. HR/Admin phải nhìn thấy rõ trường nào thay đổi.
8. Nếu HR duyệt, hệ thống mới cập nhật dữ liệu vào hồ sơ chính.
9. Nếu HR từ chối, dữ liệu hồ sơ chính giữ nguyên.
10. Mọi thao tác tạo/duyệt/từ chối/hủy phải ghi audit log.

#### Trạng thái yêu cầu

| Trạng thái | Ý nghĩa                             |
| ---------- | ----------------------------------- |
| Draft      | Bản nháp, nếu hỗ trợ lưu nháp       |
| Pending    | Đã gửi, chờ duyệt                   |
| Approved   | Đã được duyệt                       |
| Rejected   | Đã bị từ chối                       |
| Cancelled  | Employee tự hủy khi chưa được xử lý |

#### Kết quả thành công

* Yêu cầu cập nhật hồ sơ được tạo.
* Trạng thái yêu cầu là Pending.
* Hồ sơ chính chưa bị thay đổi.
* HR/Admin nhận notification.
* Employee nhận thông báo gửi yêu cầu thành công.

#### Tiêu chí nghiệm thu

* Employee gửi được yêu cầu cập nhật hồ sơ với trường hợp lệ.
* Hồ sơ chính chưa thay đổi trước khi HR duyệt.
* HR/Admin thấy yêu cầu trong danh sách chờ duyệt.
* Yêu cầu lưu đúng giá trị cũ và mới.
* Employee không gửi được yêu cầu sửa phòng ban/chức vụ/trạng thái.
* Yêu cầu được ghi audit log.

---

### 14.19 HR-FUNC-019: HR duyệt/từ chối yêu cầu cập nhật hồ sơ cá nhân

#### Mục tiêu

Cho phép HR/Admin/Super Admin xem xét và quyết định duyệt hoặc từ chối yêu cầu cập nhật hồ sơ cá nhân do Employee gửi.

#### Người dùng

* Super Admin
* Admin công ty có quyền
* HR có quyền `HR.PROFILE_CHANGE_REQUEST.APPROVE`
* HR có quyền `HR.PROFILE_CHANGE_REQUEST.REJECT`

#### Luồng duyệt

```text
HR/Admin vào danh sách yêu cầu cập nhật hồ sơ
→ Chọn yêu cầu trạng thái Pending
→ Xem thông tin Employee
→ Xem bảng so sánh dữ liệu cũ và dữ liệu mới
→ Xem lý do và file đính kèm nếu có
→ Bấm Duyệt
→ Hệ thống cập nhật dữ liệu mới vào hồ sơ nhân viên
→ Hệ thống chuyển yêu cầu sang Approved
→ Hệ thống ghi audit log
→ Employee nhận thông báo yêu cầu đã được duyệt
```

#### Luồng từ chối

```text
HR/Admin mở yêu cầu Pending
→ Xem nội dung thay đổi
→ Bấm Từ chối
→ Nhập lý do từ chối
→ Hệ thống chuyển yêu cầu sang Rejected
→ Hệ thống không thay đổi hồ sơ chính
→ Hệ thống ghi audit log
→ Employee nhận thông báo yêu cầu bị từ chối
```

#### Quy tắc nghiệp vụ

1. Chỉ yêu cầu `Pending` mới được duyệt hoặc từ chối.
2. Khi duyệt, hệ thống phải cập nhật chính xác các trường trong `new_values`.
3. Nếu dữ liệu hồ sơ đã bị HR sửa trong lúc yêu cầu đang chờ duyệt, hệ thống cần cảnh báo có thay đổi mới.
4. Người duyệt không nên là chính người tạo yêu cầu nếu người tạo cũng là HR, trừ khi hệ thống cho phép.
5. Từ chối yêu cầu bắt buộc nhập lý do.
6. Duyệt/từ chối phải ghi audit log.
7. Sau khi duyệt/từ chối, yêu cầu không được chỉnh sửa.

#### Xử lý xung đột dữ liệu

Nếu dữ liệu gốc đã thay đổi kể từ khi yêu cầu được tạo, hệ thống cảnh báo cho HR/Admin. HR/Admin có thể:

* Vẫn duyệt và ghi đè bằng giá trị mới từ Employee.
* Từ chối yêu cầu.
* Yêu cầu Employee gửi lại.

#### Tiêu chí nghiệm thu

* HR/Admin duyệt được yêu cầu Pending.
* Hồ sơ chính được cập nhật đúng dữ liệu mới sau khi duyệt.
* HR/Admin từ chối được yêu cầu Pending và bắt buộc nhập lý do.
* Employee nhận được thông báo kết quả.
* Không thể xử lý lại yêu cầu đã Approved/Rejected/Cancelled.
* Hệ thống ghi audit log đầy đủ.

---

### 14.20 HR-FUNC-020: Quản lý danh sách yêu cầu cập nhật hồ sơ

#### Mục tiêu

Cho phép HR/Admin quản lý tập trung danh sách yêu cầu cập nhật hồ sơ cá nhân, lọc theo trạng thái và theo dõi lịch sử xử lý.

#### Chức năng con

* Xem danh sách yêu cầu.
* Tìm kiếm theo nhân viên.
* Lọc theo trạng thái.
* Lọc theo phòng ban.
* Lọc theo ngày tạo/ngày xử lý.
* Mở chi tiết yêu cầu.
* Điều hướng sang hồ sơ nhân viên.

#### Tiêu chí nghiệm thu

* HR/Admin xem được danh sách yêu cầu theo quyền.
* Employee không xem được danh sách toàn công ty.
* Bộ lọc hoạt động đúng.
* Danh sách hiển thị đúng trạng thái và người xử lý.
* Có thể mở chi tiết yêu cầu từ danh sách.

---

### 14.21 HR-FUNC-021: Cấu hình quy tắc sinh mã nhân viên

#### Mục tiêu

Cho phép Admin/HR có quyền cấu hình cách hệ thống sinh mã nhân viên tự động.

#### Cấu hình cần hỗ trợ

| Cấu hình              | Mô tả                           |
| --------------------- | ------------------------------- |
| prefix                | Tiền tố mã                      |
| padding_length        | Độ dài số thứ tự                |
| start_number          | Số bắt đầu                      |
| use_department_code   | Có dùng mã phòng ban không      |
| use_year              | Có dùng năm không               |
| use_month             | Có dùng tháng không             |
| separator             | Ký tự phân tách                 |
| reset_policy            | Never/Yearly/Monthly/Daily      |
| allow_manual_override | Cho phép sửa mã thủ công        |
| lock_after_created    | Khóa mã sau khi tạo             |
| pattern               | Pattern động nếu cần            |

#### Pattern đề xuất

| Pattern                   | Kết quả ví dụ   |
| ------------------------- | --------------- |
| `{PREFIX}{SEQ}`           | EMP0001         |
| `{DEPT}{SEQ}`             | HR0001          |
| `{YYYY}-{PREFIX}-{SEQ}`   | 2026-EMP-0001   |
| `{PREFIX}-{DEPT}-{SEQ}`   | FMC-HR-0001     |
| `{YYYY}{MM}-{DEPT}-{SEQ}` | 202606-DEV-0001 |

#### Quy tắc nghiệp vụ

1. Hệ thống phải đảm bảo mã nhân viên sinh ra là duy nhất trong phạm vi công ty.
2. Nếu đổi cấu hình, mã nhân viên cũ không bị thay đổi.
3. Nếu reset theo năm/tháng/phòng ban, sequence key phải được tính đúng.
4. Nếu `allow_manual_override = false`, không ai được nhập mã thủ công trừ Super Admin theo cấu hình đặc biệt.
5. Nếu `lock_after_created = true`, mã bị khóa sau khi tạo.
6. Mọi thay đổi cấu hình phải ghi audit log.

#### Tiêu chí nghiệm thu

* HR/Admin có quyền cập nhật được cấu hình mã nhân viên.
* Người không có quyền không thấy hoặc không lưu được cấu hình.
* Cấu hình sai bị chặn.
* Hệ thống sinh mã đúng pattern.
* Đổi cấu hình không làm thay đổi mã nhân viên đã tạo.

---

### 14.22 HR-FUNC-022: Xem trước mã nhân viên tiếp theo

#### Mục tiêu

Cho phép người có quyền xem trước mã nhân viên tiếp theo dự kiến được sinh theo cấu hình hiện tại.

#### Luồng chính

```text
HR/Admin mở màn hình Thêm nhân viên hoặc Cấu hình mã nhân viên
→ Hệ thống đọc cấu hình mã đang active
→ Hệ thống xác định context như phòng ban, năm, tháng nếu có
→ Hệ thống tính sequence tiếp theo
→ Hệ thống hiển thị mã dự kiến
```

#### Quy tắc

* Mã preview không làm tăng sequence.
* Mã preview có thể thay đổi nếu người khác tạo nhân viên trước.
* Khi lưu chính thức, hệ thống phải sinh lại hoặc khóa sequence để đảm bảo unique.
* Nếu thiếu dữ liệu context như phòng ban, hệ thống hiển thị placeholder hoặc yêu cầu chọn phòng ban trước.

#### Tiêu chí nghiệm thu

* Preview hiển thị đúng theo cấu hình.
* Preview không làm tăng sequence.
* Khi tạo nhân viên chính thức, mã vẫn unique dù có nhiều người tạo đồng thời.

---

### 14.23 HR-FUNC-023: Khóa/mở quyền sửa mã nhân viên thủ công

#### Mục tiêu

Kiểm soát việc người dùng có được sửa mã nhân viên thủ công hay không.

#### Quy tắc

1. Hệ thống mặc định không cho nhập/sửa mã nhân viên thủ công.
2. Chỉ người có quyền `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` mới có thể sửa mã nếu cấu hình cho phép.
3. Nếu cấu hình `lock_after_created = true`, mã nhân viên bị khóa sau khi hồ sơ được tạo.
4. Nếu cần sửa mã đã khóa, phải có quyền đặc biệt và thao tác phải ghi audit log.
5. Mã thủ công vẫn phải unique và đúng format nếu có cấu hình kiểm tra format.

#### Tiêu chí nghiệm thu

* Người không có quyền không sửa được mã nhân viên.
* Người có quyền chỉ sửa được khi cấu hình cho phép.
* Mã sửa thủ công không được trùng.
* Mọi thao tác override được ghi audit log.

---

## 15. Dữ liệu cần lưu

### 15.1 Bảng employees

| Trường                  | Kiểu dữ liệu | Bắt buộc | Ghi chú                                |
| ----------------------- | ------------ | -------- | -------------------------------------- |
| id                      | UUID/Integer | Có       | ID nhân viên                           |
| employee_code           | String       | Có       | Unique, hệ thống tự sinh theo cấu hình |
| user_id                 | UUID/Integer | Không    | Liên kết users.id                      |
| full_name               | String       | Có       | Họ tên                                 |
| avatar_file_id          | UUID         | Không    | FK files.id; API trả `avatar: { file_id, download_url }` |
| date_of_birth           | Date         | Không    | Ngày sinh                              |
| gender                  | String       | Không    | Male/Female/Other                      |
| nationality             | String       | Không    | Quốc tịch                              |
| identity_number         | String       | Không    | CCCD/CMND/Hộ chiếu                     |
| identity_issue_date     | Date         | Không    | Ngày cấp                               |
| identity_issue_place    | String       | Không    | Nơi cấp                                |
| marital_status          | String       | Không    | Tình trạng hôn nhân                    |
| personal_email          | String       | Không    | Email cá nhân                          |
| company_email           | String       | Không    | Email công ty                          |
| phone                   | String       | Không    | Số điện thoại                          |
| current_address         | Text         | Không    | Địa chỉ hiện tại                       |
| permanent_address       | Text         | Không    | Địa chỉ thường trú                     |
| emergency_contact_name  | String       | Không    | Người liên hệ khẩn cấp                 |
| emergency_contact_phone | String       | Không    | SĐT khẩn cấp                           |
| department_id           | UUID/Integer | Có       | Phòng ban                              |
| position_id             | UUID/Integer | Có       | Chức vụ                                |
| job_level_id            | UUID/Integer | Không    | Cấp bậc                                |
| direct_manager_id       | UUID/Integer | Không    | Quản lý trực tiếp                      |
| joined_date             | Date         | Có       | Ngày vào làm                           |
| probation_start_date    | Date         | Không    | Bắt đầu thử việc                       |
| probation_end_date      | Date         | Không    | Kết thúc thử việc                      |
| official_date           | Date         | Không    | Ngày chính thức                        |
| resigned_date           | Date         | Không    | Ngày nghỉ việc                         |
| resignation_reason      | Text         | Không    | Lý do nghỉ                             |
| employment_status       | String       | Có       | Probation/Official/...                 |
| employee_type           | String       | Không    | Full-time/Part-time/...                |
| work_location           | String       | Không    | Địa điểm làm việc                      |
| note                    | Text         | Không    | Ghi chú                                |
| created_at              | DateTime     | Có       | Thời gian tạo                          |
| updated_at              | DateTime     | Có       | Thời gian cập nhật                     |
| deleted_at              | DateTime     | Không    | Xóa mềm                                |
| created_by              | UUID/Integer | Không    | Người tạo                              |
| updated_by              | UUID/Integer | Không    | Người cập nhật                         |

---

### 15.2 Bảng departments

| Trường               | Kiểu dữ liệu | Bắt buộc | Ghi chú                             |
| -------------------- | ------------ | -------- | ----------------------------------- |
| id                   | UUID/Integer | Có       | ID phòng ban                        |
| department_code      | String       | Có       | Unique                              |
| name                 | String       | Có       | Tên phòng ban                       |
| parent_id            | UUID/Integer | Không    | Phòng ban cha                       |
| manager_employee_id  | UUID/Integer | Không    | Trưởng phòng, liên kết employees.id |
| description          | Text         | Không    | Mô tả                               |
| status               | String       | Có       | Active/Inactive                     |
| created_at           | DateTime     | Có       |                                     |
| updated_at           | DateTime     | Có       |                                     |
| deleted_at           | DateTime     | Không    | Xóa mềm                             |
| created_by           | UUID/Integer | Không    |                                     |
| updated_by           | UUID/Integer | Không    |                                     |

---

### 15.3 Bảng positions

| Trường           | Kiểu dữ liệu | Bắt buộc | Ghi chú          |
| ---------------- | ------------ | -------- | ---------------- |
| id               | UUID/Integer | Có       | ID chức vụ       |
| position_code    | String       | Có       | Unique           |
| name    | String       | Có       | Tên chức vụ      |
| job_level_id     | UUID/Integer | Không    | Cấp bậc mặc định |
| description      | Text         | Không    | Mô tả            |
| status           | String       | Có       | Active/Inactive  |
| created_at       | DateTime     | Có       |                  |
| updated_at       | DateTime     | Có       |                  |
| deleted_at       | DateTime     | Không    | Xóa mềm          |

---

### 15.4 Bảng job_levels

| Trường      | Kiểu dữ liệu | Bắt buộc | Ghi chú         |
| ----------- | ------------ | -------- | --------------- |
| id          | UUID/Integer | Có       | ID cấp bậc      |
| level_code  | String       | Có       | Unique          |
| name  | String       | Có       | Tên cấp bậc     |
| order_index | Integer      | Không    | Thứ tự          |
| description | Text         | Không    | Mô tả           |
| status      | String       | Có       | Active/Inactive |
| created_at  | DateTime     | Có       |                 |
| updated_at  | DateTime     | Có       |                 |

---

### 15.5 Bảng contract_types

| Trường                  | Kiểu dữ liệu | Bắt buộc | Ghi chú           |
| ----------------------- | ------------ | -------- | ----------------- |
| id                      | UUID/Integer | Có       | ID loại hợp đồng  |
| contract_type_code      | String       | Có       | Unique            |
| contract_type_name      | String       | Có       | Tên loại hợp đồng |
| default_duration_months | Integer      | Không    | Thời hạn mặc định |
| description             | Text         | Không    | Mô tả             |
| status                  | String       | Có       | Active/Inactive   |
| created_at              | DateTime     | Có       |                   |
| updated_at              | DateTime     | Có       |                   |

---

### 15.6 Bảng employee_contracts

| Trường           | Kiểu dữ liệu | Bắt buộc | Ghi chú                         |
| ---------------- | ------------ | -------- | ------------------------------- |
| id               | UUID/Integer | Có       | ID hợp đồng                     |
| employee_id      | UUID/Integer | Có       | Nhân viên                       |
| contract_type_id | UUID/Integer | Có       | Loại hợp đồng                   |
| contract_number  | String       | Không    | Số hợp đồng                     |
| start_date       | Date         | Có       | Ngày bắt đầu                    |
| end_date         | Date         | Không    | Ngày kết thúc                   |
| signed_date      | Date         | Không    | Ngày ký                         |
| status           | String       | Có       | Draft/Active/Expired/Terminated |
| file_id          | UUID/Integer | Không    | File hợp đồng                   |
| note             | Text         | Không    | Ghi chú                         |
| created_at       | DateTime     | Có       |                                 |
| updated_at       | DateTime     | Có       |                                 |
| deleted_at       | DateTime     | Không    | Xóa mềm                         |
| created_by       | UUID/Integer | Không    |                                 |
| updated_by       | UUID/Integer | Không    |                                 |

---

### 15.7 Bảng employee_files

> Drift reconciliation 22/06 (theo SPEC-DRIFT-MATRIX §2, HR-4): KHÔNG nhúng metadata file (`file_url/mime_type/file_size`) vào bảng HR. Dùng **FK `file_id` → bảng `files` chung** của Foundation; metadata vật lý (tên/MIME/dung lượng/đường dẫn) sống ở `files`. Bảng `employee_files` chỉ giữ liên kết HR-specific + phân loại + cờ nhạy cảm (khớp DB-03 §7.8).

| Trường         | Kiểu dữ liệu | Bắt buộc | Ghi chú                                                       |
| -------------- | ------------ | -------- | ------------------------------------------------------------ |
| id             | UUID/Integer | Có       | ID liên kết file hồ sơ                                       |
| employee_id    | UUID/Integer | Có       | Nhân viên                                                    |
| file_id        | UUID         | Có       | FK `files.id` (metadata vật lý: tên/MIME/dung lượng/đường dẫn ở `files`) |
| file_category  | String       | Có       | CV/IDENTITY/CONTRACT/CERTIFICATE/DECISION/OTHER (CHECK)       |
| is_sensitive   | Boolean      | Có       | File nhạy cảm hay không (gate `HR.EMPLOYEE.VIEW_SENSITIVE`)   |
| note           | Text         | Không    | Ghi chú                                                      |
| uploaded_by    | UUID/Integer | Có       | Người upload                                                 |
| uploaded_at    | DateTime     | Có       | Ngày upload                                                  |
| deleted_at     | DateTime     | Không    | Xóa mềm                                                      |

---

### 15.8 Bảng employee_status_histories

| Trường         | Kiểu dữ liệu | Bắt buộc | Ghi chú        |
| -------------- | ------------ | -------- | -------------- |
| id             | UUID/Integer | Có       | ID             |
| employee_id    | UUID/Integer | Có       | Nhân viên      |
| old_status     | String       | Không    | Trạng thái cũ  |
| new_status     | String       | Có       | Trạng thái mới |
| effective_date | Date         | Có       | Ngày hiệu lực  |
| reason         | Text         | Không    | Lý do          |
| changed_by     | UUID/Integer | Có       | Người đổi      |
| changed_at     | DateTime     | Có       | Thời gian đổi  |

---

### 15.9 Audit HR — dùng `audit_logs` chung (KHÔNG có bảng riêng)

HR **không tạo bảng audit riêng** (`employee_change_logs` đã loại bỏ). Mọi thao tác quan trọng (tạo/sửa/đổi trạng thái nhân viên, liên kết/hủy liên kết user, hợp đồng, file hồ sơ, duyệt/từ chối yêu cầu cập nhật hồ sơ, cấu hình/override mã nhân viên, export) ghi vào bảng **`audit_logs` dùng chung** của Foundation (append-only — REVOKE UPDATE/DELETE + trigger, xem [DB-08](<../DB/DB-08 Audit Files Settings Seeds Database Design.md>) và BẤT BIẾN #2).

Các `object_type` của HR (`Employee`, `Department`, `Position`, `JobLevel`, `ContractType`, `EmployeeContract`, `EmployeeFile`, `ProfileChangeRequest`, `EmployeeCodeConfig`) được bổ sung vào CHECK `object_types` của `audit_logs` (union additive, không tạo bảng mới). Dữ liệu log lưu: `actor_id`, `employee_id`, `action`, `field_name`, `old_value`, `new_value`, `ip_address`, `user_agent`, `created_at`.

---

### 15.10 Bảng profile_change_requests

| Trường           | Kiểu dữ liệu | Bắt buộc | Ghi chú                                   |
| ---------------- | ------------ | -------- | ----------------------------------------- |
| id               | UUID/Integer | Có       | ID yêu cầu                                |
| request_code     | String       | Có       | Mã yêu cầu                                |
| employee_id      | UUID/Integer | Có       | Nhân viên gửi yêu cầu                     |
| requested_by     | UUID/Integer | Có       | User tạo yêu cầu                          |
| status           | String       | Có       | Draft/Pending/Approved/Rejected/Cancelled |
| old_values       | JSON         | Có       | Dữ liệu cũ                                |
| new_values       | JSON         | Có       | Dữ liệu mới                               |
| changed_fields   | JSON         | Có       | Danh sách field thay đổi                  |
| reason           | Text         | Không    | Lý do cập nhật                            |
| rejection_reason | Text         | Không    | Lý do từ chối                             |
| reviewed_by      | UUID/Integer | Không    | Người duyệt/từ chối                       |
| reviewed_at      | DateTime     | Không    | Thời gian xử lý                           |
| submitted_at     | DateTime     | Có       | Thời gian gửi                             |
| cancelled_at     | DateTime     | Không    | Thời gian hủy                             |
| created_at       | DateTime     | Có       | Thời gian tạo                             |
| updated_at       | DateTime     | Có       | Thời gian cập nhật                        |

---

### 15.11 Bảng profile_change_request_files

> Drift reconciliation 22/06 (theo SPEC-DRIFT-MATRIX §2, HR-1 + HR-4): đổi tên bảng từ `employee_profile_change_request_files` → `profile_change_request_files` (cùng family với `profile_change_requests`); bỏ metadata file nhúng (`file_url/file_type/mime_type/file_size`), dùng **FK `file_id` → `files` chung**. (Diff từng-field của yêu cầu lưu ở `profile_change_request_items` — DB-03 §7.10.)

| Trường      | Kiểu dữ liệu | Bắt buộc | Ghi chú                                                  |
| ----------- | ------------ | -------- | -------------------------------------------------------- |
| id          | UUID/Integer | Có       | ID                                                       |
| request_id  | UUID/Integer | Có       | FK `profile_change_requests.id`                          |
| file_id     | UUID         | Có       | FK `files.id` (metadata vật lý ở `files`)                |
| is_sensitive| Boolean      | Có       | File chứng minh nhạy cảm (vd CCCD)                       |
| uploaded_by | UUID/Integer | Có       | Người upload                                             |
| uploaded_at | DateTime     | Có       | Thời gian upload                                         |

---

### 15.12 Bảng employee_code_configs

| Trường                | Kiểu dữ liệu | Bắt buộc             | Ghi chú                         |
| --------------------- | ------------ | -------------------- | ------------------------------- |
| id                    | UUID/Integer | Có                   | ID cấu hình                     |
| company_id            | UUID/Integer | Có nếu multi-company | Công ty                         |
| auto_generate_enabled | Boolean      | Có                   | Bật/tắt tự sinh                 |
| prefix                | String       | Không                | Tiền tố                         |
| use_department_code   | Boolean      | Có                   | Dùng mã phòng ban               |
| use_year              | Boolean      | Có                   | Dùng năm                        |
| use_month             | Boolean      | Có                   | Dùng tháng                      |
| separator             | String       | Không                | Ký tự phân tách                 |
| padding_length        | Integer      | Có                   | Độ dài số                       |
| start_number          | Integer      | Có                   | Số bắt đầu                      |
| next_number           | Integer      | Có                   | Số tiếp theo                    |
| reset_policy            | String       | Có                   | Never/Yearly/Monthly/Daily      |
| allow_manual_override | Boolean      | Có                   | Cho sửa thủ công                |
| lock_after_created    | Boolean      | Có                   | Khóa mã sau khi tạo             |
| pattern               | String       | Không                | Pattern nếu dùng format động    |
| status                | String       | Có                   | Active/Inactive                 |
| created_at            | DateTime     | Có                   |                                 |
| updated_at            | DateTime     | Có                   |                                 |
| updated_by            | UUID/Integer | Không                | Người cập nhật                  |

---

### 15.13 Bảng sequence_counters

Dùng để kiểm soát số thứ tự theo từng phạm vi reset.

| Trường              | Kiểu dữ liệu | Bắt buộc | Ghi chú                                    |
| ------------------- | ------------ | -------- | ------------------------------------------ |
| id                  | UUID/Integer | Có       | ID                                         |
| config_id           | UUID/Integer | Có       | Liên kết cấu hình                          |
| sequence_key        | String       | Có       | Ví dụ: GLOBAL, 2026, 2026-06, HR, DEV-2026 |
| current_number      | Integer      | Có       | Số hiện tại                                |
| next_number         | Integer      | Có       | Số tiếp theo                               |
| last_generated_code | String       | Không    | Mã gần nhất                                |
| created_at          | DateTime     | Có       |                                            |
| updated_at          | DateTime     | Có       |                                            |

---

## 16. API sơ bộ

> Drift reconciliation 22/06 (theo SPEC-DRIFT-MATRIX §2, HR-5): mọi endpoint HR dùng prefix `/api/v1/hr/...` (KHÔNG còn `/api/employees`, `/api/positions`, `/api/contracts`, `/api/job-levels`, `/api/profile-change-requests`, `/api/employee-code-config` rời). **Nguồn sự thật về mã API + endpoint đầy đủ là [API-03](<../API Design/API-03_HR_API_Design.md>)**; bảng §16 dưới đây là sơ bộ và đã được chỉnh path theo API-03. Khi API-03 và §16 lệch số/đường dẫn, lấy API-03 làm chuẩn (vd: contract-types ở API-03 = HR-API-601..605, employee files = HR-API-801..802, employee-code-config = HR-API-901..902).

### 16.1 Employee API

| Mã API     | Method | Endpoint                          | Mục đích                        | Permission                            |
| ---------- | ------ | --------------------------------- | ------------------------------- | ------------------------------------- |
| HR-API-001 | GET    | /api/v1/hr/employees                    | Lấy danh sách nhân viên         | HR.EMPLOYEE.VIEW                      |
| HR-API-002 | GET    | /api/v1/hr/employees/{id}               | Lấy chi tiết nhân viên          | HR.EMPLOYEE.VIEW                      |
| HR-API-003 | POST   | /api/v1/hr/employees                    | Tạo nhân viên                   | HR.EMPLOYEE.CREATE                    |
| HR-API-004 | PUT    | /api/v1/hr/employees/{id}               | Cập nhật nhân viên              | HR.EMPLOYEE.UPDATE                    |
| HR-API-005 | POST   | /api/v1/hr/employees/{id}/change-status | Đổi trạng thái                  | HR.EMPLOYEE.CHANGE_STATUS             |
| HR-API-006 | DELETE | /api/v1/hr/employees/{id}               | Xóa mềm nhân viên               | HR.EMPLOYEE.DELETE                    |
| HR-API-007 | GET    | /api/v1/hr/employees/me                 | Lấy hồ sơ cá nhân               | Authenticated                         |
| HR-API-008 | PUT    | /api/v1/hr/employees/me                 | Cập nhật hồ sơ cá nhân giới hạn | HR.EMPLOYEE.UPDATE_OWN nếu có         |
| HR-API-009 | POST   | /api/v1/hr/employees/{id}/link-user     | Liên kết user                   | HR.EMPLOYEE.UPDATE + AUTH.USER.UPDATE |
| HR-API-010 | POST   | /api/v1/hr/employees/{id}/unlink-user   | Hủy liên kết user               | HR.EMPLOYEE.UPDATE + AUTH.USER.UPDATE |
| HR-API-011 | GET    | /api/v1/hr/employees/export             | Xuất danh sách nhân viên        | HR.EMPLOYEE.EXPORT                    |

---

### 16.2 Department API

| Mã API     | Method | Endpoint              | Mục đích                      | Permission           |
| ---------- | ------ | --------------------- | ----------------------------- | -------------------- |
| HR-API-101 | GET    | /api/v1/hr/departments      | Lấy danh sách phòng ban       | HR.DEPARTMENT.VIEW   |
| HR-API-102 | GET    | /api/v1/hr/departments/tree | Lấy cây phòng ban             | HR.DEPARTMENT.VIEW   |
| HR-API-103 | GET    | /api/v1/hr/departments/{id} | Lấy chi tiết phòng ban        | HR.DEPARTMENT.VIEW   |
| HR-API-104 | POST   | /api/v1/hr/departments      | Tạo phòng ban                 | HR.DEPARTMENT.CREATE |
| HR-API-105 | PUT    | /api/v1/hr/departments/{id} | Cập nhật phòng ban            | HR.DEPARTMENT.UPDATE |
| HR-API-106 | DELETE | /api/v1/hr/departments/{id} | Xóa mềm/vô hiệu hóa phòng ban | HR.DEPARTMENT.DELETE |

---

### 16.3 Position API

| Mã API     | Method | Endpoint            | Mục đích                    | Permission         |
| ---------- | ------ | ------------------- | --------------------------- | ------------------ |
| HR-API-201 | GET    | /api/v1/hr/positions      | Lấy danh sách chức vụ       | HR.POSITION.VIEW   |
| HR-API-202 | GET    | /api/v1/hr/positions/{id} | Lấy chi tiết chức vụ        | HR.POSITION.VIEW   |
| HR-API-203 | POST   | /api/v1/hr/positions      | Tạo chức vụ                 | HR.POSITION.CREATE |
| HR-API-204 | PUT    | /api/v1/hr/positions/{id} | Cập nhật chức vụ            | HR.POSITION.UPDATE |
| HR-API-205 | DELETE | /api/v1/hr/positions/{id} | Xóa mềm/vô hiệu hóa chức vụ | HR.POSITION.DELETE |

---

### 16.4 Contract API

| Mã API     | Method | Endpoint                      | Mục đích                   | Permission         |
| ---------- | ------ | ----------------------------- | -------------------------- | ------------------ |
| HR-API-301 | GET    | /api/v1/hr/employees/{id}/contracts | Lấy hợp đồng của nhân viên | HR.CONTRACT.VIEW   |
| HR-API-302 | POST   | /api/v1/hr/employees/{id}/contracts | Tạo hợp đồng               | HR.CONTRACT.CREATE |
| HR-API-303 | PUT    | /api/v1/hr/contracts/{contract_id}  | Cập nhật hợp đồng          | HR.CONTRACT.UPDATE |
| HR-API-304 | DELETE | /api/v1/hr/contracts/{contract_id}  | Xóa mềm hợp đồng           | HR.CONTRACT.DELETE |
| HR-API-305 | GET    | /api/v1/hr/contracts/expiring       | Lấy hợp đồng sắp hết hạn   | HR.CONTRACT.VIEW   |

---

### 16.5 Employee File API

| Mã API     | Method | Endpoint                               | Mục đích          | Permission              |
| ---------- | ------ | -------------------------------------- | ----------------- | ----------------------- |
| HR-API-401 | GET    | /api/v1/hr/employees/{id}/files              | Lấy file hồ sơ    | HR.EMPLOYEE.FILE_VIEW   |
| HR-API-402 | POST   | /api/v1/hr/employees/{id}/files              | Upload file hồ sơ | HR.EMPLOYEE.FILE_UPLOAD |
| HR-API-403 | GET    | /api/v1/hr/employee-files/{file_id}/download | Tải file          | HR.EMPLOYEE.FILE_VIEW   |
| HR-API-404 | DELETE | /api/v1/hr/employee-files/{file_id}          | Xóa file          | HR.EMPLOYEE.FILE_DELETE |

---

### 16.6 Master Data API

> Drift reconciliation 22/06 (theo SPEC-DRIFT-MATRIX §2, HR-7): danh mục master data (job_levels, contract_types) dùng **MỘT family quyền nhất quán** — đọc = `HR.MASTER_DATA.VIEW`, ghi = `HR.MASTER_DATA.MANAGE`. KHÔNG trộn `HR.CONTRACT.VIEW` cho việc đọc danh mục loại hợp đồng (`HR.CONTRACT.*` chỉ dành cho hợp đồng của nhân viên ở §16.4). `HR.EMPLOYEE.VIEW` vẫn được chấp nhận khi chỉ cần đọc dropdown trong luồng tạo/sửa nhân viên.

| Mã API     | Method | Endpoint                       | Mục đích          | Permission                               |
| ---------- | ------ | ------------------------------ | ----------------- | ---------------------------------------- |
| HR-API-501 | GET    | /api/v1/hr/job-levels          | Lấy cấp bậc       | HR.MASTER_DATA.VIEW hoặc HR.EMPLOYEE.VIEW |
| HR-API-502 | POST   | /api/v1/hr/job-levels          | Tạo cấp bậc       | HR.MASTER_DATA.MANAGE                    |
| HR-API-503 | PUT    | /api/v1/hr/job-levels/{id}     | Sửa cấp bậc       | HR.MASTER_DATA.MANAGE                    |
| HR-API-504 | GET    | /api/v1/hr/contract-types      | Lấy loại hợp đồng | HR.MASTER_DATA.VIEW hoặc HR.EMPLOYEE.VIEW |
| HR-API-505 | POST   | /api/v1/hr/contract-types      | Tạo loại hợp đồng | HR.MASTER_DATA.MANAGE                    |
| HR-API-506 | PUT    | /api/v1/hr/contract-types/{id} | Sửa loại hợp đồng | HR.MASTER_DATA.MANAGE                    |

---

### 16.7 API yêu cầu cập nhật hồ sơ

| Mã API     | Method | Endpoint                                  | Mục đích                      | Permission                           |
| ---------- | ------ | ----------------------------------------- | ----------------------------- | ------------------------------------ |
| HR-API-601 | GET    | /api/profile-change-requests/me           | Employee xem yêu cầu của mình | HR.PROFILE_CHANGE_REQUEST.VIEW_OWN   |
| HR-API-602 | POST   | /api/profile-change-requests              | Employee tạo yêu cầu cập nhật | HR.PROFILE_CHANGE_REQUEST.CREATE     |
| HR-API-603 | DELETE | /api/profile-change-requests/{id}/cancel  | Employee hủy yêu cầu          | HR.PROFILE_CHANGE_REQUEST.CANCEL_OWN |
| HR-API-604 | GET    | /api/profile-change-requests              | HR xem danh sách yêu cầu      | HR.PROFILE_CHANGE_REQUEST.VIEW       |
| HR-API-605 | GET    | /api/profile-change-requests/{id}         | Xem chi tiết yêu cầu          | Theo quyền                           |
| HR-API-606 | POST   | /api/profile-change-requests/{id}/approve | Duyệt yêu cầu                 | HR.PROFILE_CHANGE_REQUEST.APPROVE    |
| HR-API-607 | POST   | /api/profile-change-requests/{id}/reject  | Từ chối yêu cầu               | HR.PROFILE_CHANGE_REQUEST.REJECT     |

---

### 16.8 API cấu hình mã nhân viên

| Mã API     | Method | Endpoint                          | Mục đích                       | Permission                     |
| ---------- | ------ | --------------------------------- | ------------------------------ | ------------------------------ |
| HR-API-701 | GET    | /api/employee-code-config         | Lấy cấu hình mã nhân viên      | HR.EMPLOYEE_CODE_CONFIG.VIEW   |
| HR-API-702 | PUT    | /api/employee-code-config         | Cập nhật cấu hình mã nhân viên | HR.EMPLOYEE_CODE_CONFIG.UPDATE |
| HR-API-703 | POST   | /api/v1/hr/employee-code/preview  | Xem trước mã tiếp theo         | HR.EMPLOYEE_CODE.PREVIEW       |
| HR-API-704 | POST   | /api/employee-code/generate       | Sinh mã nhân viên mới          | HR.EMPLOYEE.CREATE             |
| HR-API-705 | GET    | /api/employee-code/check          | Kiểm tra mã có tồn tại không   | HR.EMPLOYEE.CREATE             |

---

## 17. Request/Response mẫu

### 17.1 POST /api/v1/hr/employees

#### Request mẫu

```json
{
  "full_name": "Nguyễn Văn A",
  "date_of_birth": "1998-05-12",
  "gender": "Male",
  "company_email": "nguyenvana@company.com",
  "personal_email": "vana@gmail.com",
  "phone": "0900000000",
  "department_id": "dep_001",
  "position_id": "pos_001",
  "job_level_id": "level_001",
  "direct_manager_id": "emp_010",
  "joined_date": "2026-07-01",
  "employment_status": "Probation",
  "employee_type": "Full-time",
  "create_user_account": true,
  "default_role": "EMPLOYEE"
}
```

#### Response thành công

```json
{
  "success": true,
  "data": {
    "id": "emp_001",
    "employee_code": "EMP0001",
    "full_name": "Nguyễn Văn A",
    "company_email": "nguyenvana@company.com",
    "department_id": "dep_001",
    "position_id": "pos_001",
    "employment_status": "Probation",
    "user_id": "user_001"
  },
  "message": "Tạo nhân viên thành công"
}
```

---

### 17.2 Response lỗi mã nhân viên trùng hoặc sinh mã thất bại

```json
{
  "success": false,
  "error": {
    "code": "HR-ERR-002",
    "message": "Mã nhân viên đã được sử dụng"
  }
}
```

---

### 17.3 GET /api/v1/hr/employees response mẫu

```json
{
  "success": true,
  "data": [
    {
      "id": "emp_001",
      "employee_code": "EMP001",
      "full_name": "Nguyễn Văn A",
      "avatar": null,
      "company_email": "nguyenvana@company.com",
      "phone": "0900000000",
      "department": {
        "id": "dep_001",
        "name": "Phòng Kỹ thuật"
      },
      "position": {
        "id": "pos_001",
        "name": "Developer"
      },
      "direct_manager": {
        "id": "emp_010",
        "name": "Trần Văn B"
      },
      "joined_date": "2026-07-01",
      "employment_status": "Probation"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "total_pages": 1
  }
}
```

---

### 17.4 POST /api/profile-change-requests

#### Request mẫu

```json
{
  "changed_fields": ["phone", "current_address"],
  "old_values": {
    "phone": "0900000000",
    "current_address": "Địa chỉ cũ"
  },
  "new_values": {
    "phone": "0911111111",
    "current_address": "Địa chỉ mới"
  },
  "reason": "Cập nhật thông tin liên hệ mới",
  "attachments": []
}
```

#### Response thành công

```json
{
  "success": true,
  "message": "Yêu cầu cập nhật hồ sơ đã được gửi",
  "data": {
    "id": "profile-change-request-id",
    "status": "Pending"
  }
}
```

---

### 17.5 POST /api/v1/hr/employee-code/preview

#### Response thành công

```json
{
  "success": true,
  "data": {
    "preview_code": "EMP0008",
    "pattern": "{PREFIX}{SEQ}",
    "sequence_key": "GLOBAL",
    "note": "Mã này chỉ là dự kiến và có thể thay đổi khi lưu chính thức."
  }
}
```

---

## 18. Quy tắc nghiệp vụ quan trọng

### 18.1 Quy tắc mã nhân viên

1. `employee_code` là duy nhất trong phạm vi công ty.
2. Mặc định hệ thống tự sinh `employee_code` theo cấu hình đang active.
3. Người dùng không nhập thủ công mã nhân viên trong luồng tạo nhân viên thông thường.
4. Hệ thống cần hỗ trợ cấu hình prefix, độ dài số thứ tự, số bắt đầu, mã phòng ban, năm/tháng, ký tự phân tách, quy tắc reset sequence và pattern động.
5. Mã preview trên UI chỉ là mã dự kiến; mã chính thức được sinh/khóa khi lưu nhân viên thành công.
6. Chỉ người có quyền `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` mới được sửa mã thủ công, và chỉ khi cấu hình `allow_manual_override = true`.
7. Nếu `lock_after_created = true`, mã nhân viên không được sửa sau khi tạo, trừ trường hợp đặc biệt có quyền override và audit log đầy đủ.
8. Khi đổi cấu hình mã, hệ thống không thay đổi mã nhân viên đã tồn tại.
9. Sequence phải đảm bảo an toàn khi nhiều người tạo nhân viên đồng thời.

Ví dụ format:

```text
EMP0001
HR0001
DEV0001
2026-EMP-0001
FMC-HR-0001
```

---

### 18.2 Quy tắc email

1. `company_email` không nên trùng giữa các nhân viên active.
2. Nếu dùng `company_email` làm login email, email này cũng không được trùng trong bảng users.
3. `personal_email` có thể không unique, nhưng nên cảnh báo nếu trùng.
4. Email phải đúng định dạng.

---

### 18.3 Quy tắc trạng thái nhân viên

1. Nhân viên `Probation` và `Official` được xem là đang làm việc.
2. Nhân viên `Resigned` và `Terminated` không được chấm công mới.
3. Nhân viên `Resigned` và `Terminated` không được tạo đơn nghỉ mới.
4. Nhân viên `Temporarily Suspended` có thể bị hạn chế chấm công tùy cấu hình.
5. Khi đổi trạng thái sang `Resigned` hoặc `Terminated`, cần nhập ngày hiệu lực.
6. Khi nghỉ việc, hệ thống nên hỏi có khóa tài khoản đăng nhập không.

---

### 18.4 Quy tắc phòng ban

1. Một nhân viên thuộc một phòng ban chính trong MVP.
2. Phòng ban có thể có phòng ban cha.
3. Không tạo vòng lặp phòng ban.
4. Phòng ban inactive không dùng cho nhân viên mới.
5. Không xóa cứng phòng ban có dữ liệu liên quan.

---

### 18.5 Quy tắc chức vụ

1. Một nhân viên có một chức vụ chính trong MVP.
2. Chức vụ inactive không dùng cho nhân viên mới.
3. Không xóa cứng chức vụ có nhân viên liên kết.

---

### 18.6 Quy tắc quản lý trực tiếp

1. Direct manager phải là nhân viên active.
2. Không cho nhân viên tự quản lý chính mình.
3. Không tạo vòng lặp quản lý.
4. Direct manager có thể dùng để xác định người duyệt nghỉ phép.
5. Direct manager có thể dùng để xác định team scope.

---

### 18.7 Quy tắc hợp đồng

1. Một nhân viên có thể có nhiều hợp đồng.
2. Một hợp đồng thuộc một loại hợp đồng.
3. Ngày kết thúc không được nhỏ hơn ngày bắt đầu.
4. Hợp đồng active mới không nên trùng thời gian với hợp đồng active cũ.
5. Hợp đồng có thể có file đính kèm.
6. Hợp đồng sắp hết hạn cần hỗ trợ cảnh báo cho HR.

---

### 18.8 Quy tắc dữ liệu nhạy cảm

Dữ liệu nhạy cảm gồm:

* CCCD/CMND/Hộ chiếu
* Địa chỉ thường trú
* File giấy tờ tùy thân
* Hợp đồng
* Dữ liệu lương nếu sau này tích hợp
* Ghi chú nhạy cảm nếu có
* Thông tin nghỉ việc
* Tài khoản ngân hàng nếu bổ sung

Nguyên tắc:

1. Chỉ người có quyền `HR.EMPLOYEE.VIEW_SENSITIVE` mới xem.
2. Chỉ người có quyền tương ứng mới export.
3. API không được trả dữ liệu nhạy cảm nếu không đủ quyền.
4. Thao tác xem/tải file nhạy cảm nên ghi audit log nếu cần.

---

## 19. Notification liên quan

| Mã sự kiện  | Sự kiện                               | Người nhận                 | Nội dung                                         |
| ----------- | ------------------------------------- | -------------------------- | ------------------------------------------------ |
| HR-NOTI-001 | Nhân viên mới được tạo                | HR/Admin liên quan         | Nhân viên mới đã được tạo                        |
| HR-NOTI-002 | Hồ sơ cá nhân được cập nhật           | Nhân viên/HR tùy cấu hình  | Hồ sơ nhân viên đã được cập nhật                 |
| HR-NOTI-003 | Tài khoản được liên kết với nhân viên | Nhân viên                  | Hồ sơ nhân viên đã được liên kết với tài khoản   |
| HR-NOTI-004 | Hợp đồng sắp hết hạn                  | HR                         | Hợp đồng của nhân viên sắp hết hạn               |
| HR-NOTI-005 | Trạng thái nhân viên thay đổi         | HR/Admin/Manager liên quan | Trạng thái nhân viên đã được thay đổi            |
| HR-NOTI-006 | Nhân viên được chuyển phòng ban       | Manager cũ/mới nếu cần     | Nhân viên đã được chuyển phòng ban               |
| HR-NOTI-007 | Nhân viên được gán quản lý mới        | Manager mới                | Bạn được gán làm quản lý trực tiếp của nhân viên |
| HR-NOTI-008 | Employee gửi yêu cầu cập nhật hồ sơ   | HR/Admin                   | Có yêu cầu cập nhật hồ sơ cá nhân cần xử lý      |
| HR-NOTI-009 | Yêu cầu cập nhật hồ sơ được duyệt     | Employee                   | Yêu cầu cập nhật hồ sơ của bạn đã được duyệt     |
| HR-NOTI-010 | Yêu cầu cập nhật hồ sơ bị từ chối     | Employee                   | Yêu cầu cập nhật hồ sơ của bạn đã bị từ chối     |
| HR-NOTI-011 | Employee hủy yêu cầu cập nhật hồ sơ   | HR/Admin nếu cần           | Yêu cầu cập nhật hồ sơ đã bị hủy                 |
| HR-NOTI-012 | Cấu hình mã nhân viên thay đổi        | Admin/HR liên quan         | Cấu hình mã nhân viên đã được cập nhật           |

Trong MVP, notification có thể triển khai tối thiểu cho:

* Nhân viên mới được tạo
* Tài khoản được liên kết
* Hợp đồng sắp hết hạn
* Trạng thái nhân viên thay đổi
* Employee gửi yêu cầu cập nhật hồ sơ cá nhân
* Yêu cầu cập nhật hồ sơ được duyệt/từ chối

---

## 20. Audit log

### 20.1 Hành động cần ghi log

| Action                           | Mô tả                                |
| -------------------------------- | ------------------------------------ |
| EMPLOYEE_CREATED                 | Tạo nhân viên                        |
| EMPLOYEE_UPDATED                 | Cập nhật nhân viên                   |
| EMPLOYEE_STATUS_CHANGED          | Đổi trạng thái nhân viên             |
| EMPLOYEE_DELETED                 | Xóa mềm nhân viên                    |
| EMPLOYEE_USER_LINKED             | Liên kết user                        |
| EMPLOYEE_USER_UNLINKED           | Hủy liên kết user                    |
| DEPARTMENT_CREATED               | Tạo phòng ban                        |
| DEPARTMENT_UPDATED               | Cập nhật phòng ban                   |
| DEPARTMENT_DELETED               | Xóa mềm phòng ban                    |
| POSITION_CREATED                 | Tạo chức vụ                          |
| POSITION_UPDATED                 | Cập nhật chức vụ                     |
| POSITION_DELETED                 | Xóa mềm chức vụ                      |
| CONTRACT_CREATED                 | Tạo hợp đồng                         |
| CONTRACT_UPDATED                 | Cập nhật hợp đồng                    |
| CONTRACT_DELETED                 | Xóa mềm hợp đồng                     |
| EMPLOYEE_FILE_UPLOADED           | Upload file hồ sơ                    |
| EMPLOYEE_FILE_DELETED            | Xóa file hồ sơ                       |
| EMPLOYEE_EXPORTED                | Xuất danh sách nhân viên             |
| PROFILE_CHANGE_REQUEST_CREATED   | Employee tạo yêu cầu cập nhật hồ sơ  |
| PROFILE_CHANGE_REQUEST_APPROVED  | HR duyệt yêu cầu cập nhật hồ sơ      |
| PROFILE_CHANGE_REQUEST_REJECTED  | HR từ chối yêu cầu cập nhật hồ sơ    |
| PROFILE_CHANGE_REQUEST_CANCELLED | Employee hủy yêu cầu cập nhật hồ sơ  |
| EMPLOYEE_CODE_CONFIG_UPDATED     | Cập nhật cấu hình mã nhân viên       |
| EMPLOYEE_CODE_GENERATED          | Hệ thống sinh mã nhân viên           |
| EMPLOYEE_CODE_MANUAL_OVERRIDDEN  | Người dùng sửa mã nhân viên thủ công |

---

### 20.2 Dữ liệu log cần lưu

| Trường      | Mô tả                                      |
| ----------- | ------------------------------------------ |
| actor_id    | User thực hiện                             |
| module_code | HR                                         |
| action      | Hành động                                  |
| target_type | Employee/Department/Position/Contract/File |
| target_id   | ID dữ liệu bị tác động                     |
| old_value   | Dữ liệu trước                              |
| new_value   | Dữ liệu sau                                |
| ip_address  | IP                                         |
| user_agent  | Thiết bị/trình duyệt                       |
| created_at  | Thời gian                                  |

---

## 21. Error code

| Mã lỗi     | Trường hợp                      | Thông báo                                                       |
| ---------- | ------------------------------- | --------------------------------------------------------------- |
| HR-ERR-001 | Không sinh được mã nhân viên    | Hệ thống chưa thể sinh mã nhân viên, vui lòng kiểm tra cấu hình |
| HR-ERR-002 | Mã nhân viên đã tồn tại         | Mã nhân viên đã được sử dụng                                    |
| HR-ERR-003 | Thiếu họ tên                    | Vui lòng nhập họ tên nhân viên                                  |
| HR-ERR-004 | Thiếu phòng ban                 | Vui lòng chọn phòng ban                                         |
| HR-ERR-005 | Thiếu chức vụ                   | Vui lòng chọn chức vụ                                           |
| HR-ERR-006 | Thiếu ngày vào làm              | Vui lòng chọn ngày vào làm                                      |
| HR-ERR-007 | Email không đúng định dạng      | Email không đúng định dạng                                      |
| HR-ERR-008 | Email đã tồn tại                | Email đã được sử dụng                                           |
| HR-ERR-009 | Phòng ban không hợp lệ          | Phòng ban không tồn tại hoặc đã bị vô hiệu hóa                  |
| HR-ERR-010 | Chức vụ không hợp lệ            | Chức vụ không tồn tại hoặc đã bị vô hiệu hóa                    |
| HR-ERR-011 | Không có quyền                  | Bạn không có quyền thực hiện thao tác này                       |
| HR-ERR-012 | Tạo user thất bại               | Không thể tạo tài khoản đăng nhập cho nhân viên                 |
| HR-ERR-013 | Nhân viên không tồn tại         | Không tìm thấy nhân viên                                        |
| HR-ERR-014 | Direct manager không hợp lệ     | Quản lý trực tiếp không hợp lệ                                  |
| HR-ERR-015 | Không thể tự quản lý chính mình | Nhân viên không thể là quản lý trực tiếp của chính mình         |
| HR-ERR-016 | Vòng lặp quản lý                | Cấu trúc quản lý trực tiếp không hợp lệ                         |
| HR-ERR-017 | Mã phòng ban trùng              | Mã phòng ban đã được sử dụng                                    |
| HR-ERR-018 | Phòng ban đang có nhân viên     | Không thể xóa phòng ban đang có nhân viên                       |
| HR-ERR-019 | Mã chức vụ trùng                | Mã chức vụ đã được sử dụng                                      |
| HR-ERR-020 | Chức vụ đang có nhân viên       | Không thể xóa chức vụ đang có nhân viên                         |
| HR-ERR-021 | Ngày hợp đồng không hợp lệ      | Ngày kết thúc hợp đồng không được nhỏ hơn ngày bắt đầu          |
| HR-ERR-022 | Hợp đồng bị trùng thời gian     | Nhân viên đã có hợp đồng trong khoảng thời gian này             |
| HR-ERR-023 | File không hợp lệ               | Định dạng file không được hỗ trợ                                |
| HR-ERR-024 | File quá dung lượng             | File vượt quá dung lượng cho phép                               |
| HR-ERR-025 | Không có quyền xem file         | Bạn không có quyền xem file này                                 |
| HR-ERR-026 | Không thể export                | Bạn không có quyền xuất dữ liệu                                 |
| HR-ERR-027 | Employee đã liên kết user       | Nhân viên này đã được liên kết với tài khoản khác               |
| HR-ERR-028 | User đã liên kết employee       | Tài khoản này đã được liên kết với nhân viên khác               |
| HR-ERR-029 | Trạng thái không hợp lệ         | Trạng thái nhân viên không hợp lệ                               |
| HR-ERR-030 | Thiếu ngày hiệu lực             | Vui lòng nhập ngày hiệu lực                                     |
| HR-ERR-031 | Không có employee liên kết      | Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên        |
| HR-ERR-032 | Trường không được phép cập nhật | Bạn không được phép yêu cầu cập nhật trường này                 |
| HR-ERR-033 | Không có thay đổi dữ liệu       | Không có thông tin nào được thay đổi                            |
| HR-ERR-034 | Đang có yêu cầu chờ duyệt       | Bạn đang có yêu cầu cập nhật hồ sơ chờ xử lý                    |
| HR-ERR-035 | File chứng minh không hợp lệ    | File đính kèm không hợp lệ                                      |
| HR-ERR-036 | Yêu cầu không tồn tại           | Không tìm thấy yêu cầu cập nhật hồ sơ                           |
| HR-ERR-037 | Yêu cầu không còn Pending       | Yêu cầu này đã được xử lý                                       |
| HR-ERR-038 | Không có quyền duyệt            | Bạn không có quyền duyệt yêu cầu này                            |
| HR-ERR-039 | Thiếu lý do từ chối             | Vui lòng nhập lý do từ chối                                     |
| HR-ERR-040 | Dữ liệu hồ sơ đã thay đổi       | Dữ liệu gốc đã thay đổi kể từ khi yêu cầu được tạo              |
| HR-ERR-041 | Cấu hình mã không hợp lệ        | Cấu hình mã nhân viên không hợp lệ                              |
| HR-ERR-042 | Prefix không hợp lệ             | Tiền tố mã nhân viên không hợp lệ                               |
| HR-ERR-043 | Độ dài số không hợp lệ          | Độ dài số thứ tự không hợp lệ                                   |
| HR-ERR-044 | Mã sinh ra bị trùng             | Mã nhân viên sinh ra đã tồn tại                                 |
| HR-ERR-045 | Không có quyền sửa mã thủ công  | Bạn không có quyền sửa mã nhân viên thủ công                    |
| HR-ERR-046 | Mã nhân viên đã bị khóa         | Mã nhân viên không được phép chỉnh sửa sau khi tạo              |
| HR-ERR-047 | Không thể sinh mã nhân viên     | Hệ thống không thể sinh mã nhân viên mới                        |
| HR-ERR-048 | Trùng mã cấp bậc                | Mã cấp bậc (level_code) đã tồn tại                              |
| HR-ERR-049 | Trùng mã loại hợp đồng          | Mã loại hợp đồng (contract_type_code) đã tồn tại                |

---

## 22. Tích hợp với các module khác

### 22.1 Tích hợp với AUTH

HR cần AUTH để:

* Tạo tài khoản đăng nhập cho nhân viên.
* Liên kết employee với user.
* Kiểm tra role và permission.
* Khóa user khi nhân viên nghỉ việc nếu HR chọn.
* Lấy thông tin user hiện tại.

---

### 22.2 Tích hợp với ATT — Chấm công

ATT sử dụng HR để:

* Xác định nhân viên nào được phép chấm công.
* Lấy phòng ban, chức vụ, quản lý.
* Lọc bảng công theo phòng ban.
* Không cho nhân viên nghỉ việc chấm công.

---

### 22.3 Tích hợp với LEAVE — Nghỉ phép

LEAVE sử dụng HR để:

* Xác định người tạo đơn nghỉ.
* Xác định direct manager để duyệt đơn.
* Lọc đơn nghỉ theo phòng ban/team.
* Kiểm tra trạng thái nhân viên.

---

### 22.4 Tích hợp với TASK — Công việc & dự án

TASK sử dụng HR để:

* Gán task cho nhân viên.
* Thêm thành viên dự án.
* Xem task theo team.
* Cảnh báo khi nhân viên nghỉ việc vẫn còn task chưa hoàn thành.

---

### 22.5 Tích hợp với DASH — Dashboard

DASH sử dụng HR để:

* Hiển thị tổng số nhân viên.
* Hiển thị nhân viên mới trong tháng.
* Hiển thị hợp đồng sắp hết hạn.
* Hiển thị nhân viên nghỉ việc.
* Hiển thị dashboard Manager theo team.

---

### 22.6 Tích hợp với NOTI — Thông báo

HR dùng NOTI để gửi:

* Thông báo tạo tài khoản.
* Thông báo hợp đồng sắp hết hạn.
* Thông báo thay đổi trạng thái.
* Thông báo thay đổi quản lý trực tiếp.
* Thông báo Employee gửi yêu cầu cập nhật hồ sơ cá nhân.
* Thông báo yêu cầu cập nhật hồ sơ được duyệt hoặc bị từ chối.
* Thông báo cấu hình mã nhân viên được cập nhật nếu cần.

---

### 22.7 Tích hợp với PAYROLL sau MVP

PAYROLL sử dụng HR để:

* Lấy thông tin nhân viên.
* Lấy phòng ban/chức vụ.
* Lấy thông tin lương cơ bản nếu bổ sung.
* Lấy tài khoản ngân hàng nếu bổ sung.
* Xác định nhân viên active trong kỳ lương.

---

### 22.8 Tích hợp với RECRUIT sau MVP

RECRUIT sử dụng HR để:

* Chuyển ứng viên trúng tuyển thành nhân viên.
* Tạo hồ sơ nhân viên từ thông tin ứng viên.
* Tạo tài khoản đăng nhập khi nhận việc.

---

### 22.9 Tích hợp với ASSET sau MVP

ASSET sử dụng HR để:

* Cấp phát tài sản cho nhân viên.
* Thu hồi tài sản khi nhân viên nghỉ việc.
* Lọc tài sản theo phòng ban/người sử dụng.

---

## 23. Yêu cầu bảo mật

1. Chỉ người có quyền mới truy cập module HR.
2. Backend phải kiểm tra quyền và data scope cho mọi API.
3. Dữ liệu nhạy cảm phải được ẩn nếu thiếu quyền.
4. Không trả dữ liệu nhạy cảm trong API danh sách mặc định.
5. File hồ sơ cần kiểm tra quyền trước khi tải.
6. Export dữ liệu phải kiểm tra quyền riêng.
7. Không xóa cứng hồ sơ nhân viên trong MVP.
8. Mọi thao tác quan trọng phải ghi audit log.
9. Không cho user tự thay đổi phòng ban/chức vụ/trạng thái.
10. Không cho cập nhật direct manager tạo vòng lặp.
11. Không cho nhân viên nghỉ việc tiếp tục dùng chức năng cần trạng thái active nếu module liên quan yêu cầu.
12. Dữ liệu cá nhân cần được xử lý cẩn thận, hạn chế hiển thị dư thừa.
13. Employee không được tự cập nhật trực tiếp dữ liệu hồ sơ chính; mọi thay đổi cá nhân phải đi qua luồng yêu cầu và phê duyệt.
14. Thao tác sửa mã nhân viên thủ công phải kiểm tra quyền riêng và ghi audit log.

---

## 24. Yêu cầu hiệu năng

Trong MVP, module HR cần hoạt động tốt với quy mô:

| Loại dữ liệu | Quy mô dự kiến  |
| ------------ | --------------- |
| Nhân viên    | 50 - 1.000      |
| Phòng ban    | 5 - 200         |
| Chức vụ      | 10 - 500        |
| Hợp đồng     | 50 - 5.000      |
| File hồ sơ   | 100 - 20.000    |
| Log thay đổi | 1.000 - 500.000 |

Yêu cầu:

1. Danh sách nhân viên cần phân trang.
2. Tìm kiếm/lọc không tải toàn bộ dữ liệu về frontend.
3. API danh sách không trả dữ liệu file/hợp đồng chi tiết.
4. Dashboard chỉ lấy dữ liệu tổng hợp cần thiết.
5. File upload cần giới hạn dung lượng.
6. Các trường thường lọc như department_id, position_id, status, joined_date nên có index.

---

## 25. Yêu cầu UI/UX

1. Form thêm nhân viên nên chia theo nhóm thông tin hoặc step.
2. Các trường bắt buộc cần đánh dấu rõ.
3. Lỗi validate cần hiển thị ngay dưới field.
4. Danh sách nhân viên cần có avatar, trạng thái, phòng ban, chức vụ rõ ràng.
5. Trạng thái nhân viên nên hiển thị bằng badge.
6. Hồ sơ nhân viên nên dùng tab để tránh quá dài.
7. Dữ liệu nhạy cảm nên có biểu tượng khóa hoặc ẩn/mask nếu không có quyền.
8. Thao tác đổi trạng thái/xóa/vô hiệu hóa cần modal xác nhận.
9. Nếu nhân viên đã liên kết user, cần hiển thị trạng thái tài khoản.
10. Nếu hợp đồng sắp hết hạn, cần badge cảnh báo.

---

## 26. Tiêu chí nghiệm thu tổng thể module HR

Module HR được xem là hoàn thành MVP khi:

1. HR xem được danh sách nhân viên.
2. Danh sách nhân viên có tìm kiếm, lọc, phân trang.
3. HR tạo được nhân viên mới.
4. Hệ thống không cho tạo trùng mã nhân viên.
5. Hệ thống không cho tạo trùng email công ty nếu cấu hình unique.
6. HR xem được chi tiết hồ sơ nhân viên.
7. Employee xem được hồ sơ cá nhân của chính mình.
8. Employee không xem được hồ sơ người khác.
9. HR cập nhật được hồ sơ nhân viên.
10. Hệ thống ghi log khi cập nhật hồ sơ.
11. HR đổi được trạng thái nhân viên.
12. Nhân viên nghỉ việc không còn được xem như active.
13. HR quản lý được phòng ban.
14. HR quản lý được chức vụ.
15. HR quản lý được hợp đồng cơ bản.
16. HR upload được file hồ sơ.
17. Người không có quyền không xem được file nhạy cảm.
18. HR liên kết được employee với user.
19. Dữ liệu HR được module ATT/LEAVE/TASK dùng làm nguồn nhân viên.
20. API module HR kiểm tra quyền backend đầy đủ.
21. Không còn lỗi nghiêm trọng ở luồng tạo/sửa/xem nhân viên.
22. Employee gửi được yêu cầu cập nhật hồ sơ cá nhân và hồ sơ chính không đổi trước khi được duyệt.
23. HR/Admin duyệt hoặc từ chối được yêu cầu cập nhật hồ sơ cá nhân, hệ thống ghi audit log và gửi notification.
24. Mã nhân viên được tự sinh theo cấu hình và đảm bảo unique.
25. Người không có quyền không được sửa mã nhân viên thủ công.

---

## 27. Test case chính

| Mã test case | Tên test case                               | Kết quả mong muốn                      |
| ------------ | ------------------------------------------- | -------------------------------------- |
| HR-TC-001    | HR xem danh sách nhân viên                  | Hiển thị danh sách đúng quyền          |
| HR-TC-002    | Employee vào danh sách nhân viên            | Bị chặn hoặc không thấy menu           |
| HR-TC-003    | Manager xem nhân viên team                  | Chỉ thấy nhân viên trong scope         |
| HR-TC-004    | HR tìm kiếm theo tên                        | Trả kết quả đúng                       |
| HR-TC-005    | HR lọc theo phòng ban                       | Trả nhân viên thuộc phòng ban          |
| HR-TC-006    | HR tạo nhân viên hợp lệ                     | Tạo thành công                         |
| HR-TC-007    | Tạo nhân viên khi cấu hình sinh mã lỗi      | Hiển thị lỗi cấu hình mã               |
| HR-TC-008    | Tạo nhân viên khi mã sinh ra bị trùng       | Không cho tạo và báo lỗi               |
| HR-TC-009    | Tạo nhân viên thiếu phòng ban               | Hiển thị lỗi                           |
| HR-TC-010    | Tạo nhân viên với phòng ban inactive        | Không cho tạo                          |
| HR-TC-011    | Tạo nhân viên và tạo user                   | Employee và user được liên kết         |
| HR-TC-012    | Tạo user với email trùng                    | Không cho tạo user                     |
| HR-TC-013    | HR xem chi tiết nhân viên                   | Hiển thị đầy đủ theo quyền             |
| HR-TC-014    | Employee xem hồ sơ chính mình               | Hiển thị đúng hồ sơ                    |
| HR-TC-015    | Employee truy cập hồ sơ người khác bằng URL | Bị chặn                                |
| HR-TC-016    | HR cập nhật thông tin nhân viên             | Cập nhật thành công                    |
| HR-TC-017    | Cập nhật email trùng                        | Không cho lưu                          |
| HR-TC-018    | Gán direct manager là chính nhân viên       | Không cho lưu                          |
| HR-TC-019    | Gán direct manager tạo vòng lặp             | Không cho lưu                          |
| HR-TC-020    | HR đổi trạng thái sang Official             | Trạng thái cập nhật                    |
| HR-TC-021    | HR đổi trạng thái sang Resigned             | Nhân viên chuyển đã nghỉ               |
| HR-TC-022    | Đổi trạng thái nghỉ việc và khóa user       | User bị khóa trong AUTH                |
| HR-TC-023    | Tạo phòng ban hợp lệ                        | Tạo thành công                         |
| HR-TC-024    | Tạo phòng ban trùng code                    | Không cho tạo                          |
| HR-TC-025    | Tạo vòng lặp phòng ban                      | Không cho lưu                          |
| HR-TC-026    | Xóa phòng ban đang có nhân viên             | Bị chặn hoặc cảnh báo                  |
| HR-TC-027    | Tạo chức vụ hợp lệ                          | Tạo thành công                         |
| HR-TC-028    | Tạo chức vụ trùng code                      | Không cho tạo                          |
| HR-TC-029    | Thêm hợp đồng hợp lệ                        | Hợp đồng được tạo                      |
| HR-TC-030    | Hợp đồng end_date nhỏ hơn start_date        | Không cho lưu                          |
| HR-TC-031    | Hợp đồng trùng thời gian active             | Hiển thị cảnh báo                      |
| HR-TC-032    | Upload file hợp lệ                          | Upload thành công                      |
| HR-TC-033    | Upload file sai định dạng                   | Không cho upload                       |
| HR-TC-034    | User không có quyền tải file nhạy cảm       | Bị chặn                                |
| HR-TC-035    | HR export danh sách nhân viên               | File export đúng dữ liệu               |
| HR-TC-036    | User không có quyền export                  | Không thấy nút/export API bị chặn      |
| HR-TC-037    | Kiểm tra audit log khi tạo nhân viên        | Log được ghi                           |
| HR-TC-038    | Kiểm tra audit log khi sửa phòng ban        | Log được ghi                           |
| HR-TC-039    | Kiểm tra dữ liệu sensitive không trả về     | API ẩn dữ liệu nếu thiếu quyền         |
| HR-TC-040    | Phân trang danh sách nhân viên              | Trả đúng page/limit                    |
| HR-TC-041    | Employee gửi yêu cầu sửa số điện thoại      | Yêu cầu được tạo, hồ sơ chính chưa đổi |
| HR-TC-042    | Employee gửi yêu cầu sửa phòng ban          | Bị chặn                                |
| HR-TC-043    | Employee gửi yêu cầu không có thay đổi      | Bị chặn                                |
| HR-TC-044    | HR xem danh sách yêu cầu Pending            | Hiển thị đúng yêu cầu                  |
| HR-TC-045    | HR duyệt yêu cầu cập nhật hồ sơ             | Hồ sơ chính được cập nhật              |
| HR-TC-046    | HR từ chối yêu cầu cập nhật hồ sơ           | Hồ sơ chính không thay đổi             |
| HR-TC-047    | Employee hủy yêu cầu Pending                | Yêu cầu chuyển Cancelled               |
| HR-TC-048    | Duyệt lại yêu cầu đã Approved               | Bị chặn                                |
| HR-TC-049    | Employee xem yêu cầu của người khác         | Bị chặn                                |
| HR-TC-050    | Admin cấu hình mã EMP0001                   | Lưu cấu hình thành công                |
| HR-TC-051    | Tạo nhân viên mới tự sinh mã                | Mã tự sinh đúng format                 |
| HR-TC-052    | Xem trước mã nhân viên tiếp theo            | Hiển thị đúng mã dự kiến               |
| HR-TC-053    | Tạo nhiều nhân viên không trùng mã          | Mã sinh ra unique                      |
| HR-TC-054    | HR sửa mã thủ công khi không có quyền       | Bị chặn                                |
| HR-TC-055    | Đổi cấu hình mã nhân viên                   | Không ảnh hưởng mã nhân viên cũ        |
| HR-TC-056    | Mã nhân viên bị khóa sau khi tạo            | Không cho sửa mã                       |

---

## 28. Rủi ro và hướng xử lý

| Rủi ro                                         | Mô tả                                                    | Hướng xử lý                                                       |
| ---------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| Dữ liệu nhân sự quá nhiều trường               | Form phức tạp, khó dùng                                  | Chia form theo nhóm/tab/step                                      |
| Phân quyền dữ liệu nhạy cảm sai                | Người không có quyền thấy thông tin cá nhân              | Tách quyền VIEW_SENSITIVE, test kỹ API                            |
| Trùng dữ liệu nhân viên                        | Trùng mã/email/CCCD                                      | Validate unique theo cấu hình                                     |
| Cấu trúc phòng ban phức tạp                    | Nhiều cấp cha/con gây vòng lặp                           | Validate không tạo vòng lặp                                       |
| Direct manager tạo vòng lặp                    | Sai cây quản lý                                          | Validate quan hệ quản lý                                          |
| Nhân viên nghỉ việc vẫn có quyền dùng hệ thống | Rủi ro bảo mật                                           | Khi nghỉ việc hỏi khóa user, module khác kiểm tra status          |
| Xóa nhầm dữ liệu nhân sự                       | Mất dữ liệu quan trọng                                   | Chỉ xóa mềm, ghi audit log                                        |
| Export dữ liệu nhạy cảm                        | Rò rỉ thông tin                                          | Kiểm tra quyền export, ghi log                                    |
| File hồ sơ bị truy cập trái phép               | Rò rỉ hợp đồng/giấy tờ                                   | API download kiểm tra quyền, URL không public lâu dài             |
| Tạo user khi tạo employee thất bại             | Dữ liệu không đồng bộ                                    | Dùng transaction hoặc cơ chế rollback/ghi cảnh báo                |
| Employee tự sửa hồ sơ làm sai dữ liệu chính    | Dữ liệu cá nhân bị ghi đè không kiểm soát                | Chỉ tạo yêu cầu Pending, HR/Admin duyệt mới cập nhật hồ sơ chính  |
| Sinh mã nhân viên bị trùng khi tạo đồng thời   | Nhiều HR tạo nhân viên cùng lúc có thể lấy cùng sequence | Khóa sequence/transaction khi sinh mã chính thức                  |
| Sửa mã nhân viên thủ công gây mất chuẩn mã     | Người dùng override sai format                           | Kiểm tra quyền riêng, cấu hình allow_manual_override và audit log |

---

## 29. Các điểm cần xác nhận thêm

Trước khi chốt bản final, cần xác nhận:

1. Format mã nhân viên mặc định cho công ty là gì nếu chưa cấu hình?
2. Có cho HR override mã nhân viên thủ công trong MVP hay chỉ Super Admin/Admin công ty?
3. Công ty có nhiều chi nhánh không?
4. Một nhân viên có thể thuộc nhiều phòng ban không, hay chỉ một phòng ban chính trong MVP?
5. Manager duyệt nghỉ theo direct manager hay theo trưởng phòng ban?
6. Các trường giấy tờ cá nhân như CCCD/CMND có bắt buộc file chứng minh khi Employee gửi yêu cầu cập nhật không?
7. Dữ liệu CCCD/CMND có bắt buộc trong MVP không?
8. Có cần quản lý tài khoản ngân hàng ở module HR không, hay để Payroll?
9. HR có được xem hợp đồng không mặc định?
10. Có cần export dữ liệu nhân viên trong MVP không?
11. Có cần import Excel nhân viên trong MVP không?
12. File hồ sơ lưu ở server nội bộ hay cloud storage?
13. Dung lượng file tối đa là bao nhiêu?
14. Hợp đồng sắp hết hạn cảnh báo trước bao nhiêu ngày?
15. Khi nhân viên nghỉ việc, có tự động khóa tài khoản không hay HR chọn?
16. Có cần lưu lịch sử phòng ban/chức vụ theo thời gian không?
17. Có cần quản lý chi nhánh/văn phòng làm việc trong MVP không?
18. Có cần phân biệt nhân viên chính thức, cộng tác viên, thực tập sinh không?
19. Có cần mask dữ liệu nhạy cảm trên UI không?
20. Có cần ghi log khi chỉ xem/tải file nhạy cảm không?

---

## 30. Đề xuất phạm vi MVP thực tế cho HR

Để tránh module HR quá lớn ở bản đầu tiên, MVP nên chốt các phần bắt buộc sau:

### Bắt buộc làm

1. Danh sách nhân viên
2. Thêm/sửa nhân viên
3. Chi tiết hồ sơ nhân viên
4. Hồ sơ của tôi
5. Phòng ban
6. Chức vụ
7. Trạng thái nhân viên
8. Liên kết user với employee
9. Direct manager
10. Audit log cơ bản
11. Employee gửi yêu cầu cập nhật hồ sơ cá nhân
12. HR/Admin duyệt/từ chối yêu cầu cập nhật hồ sơ
13. Tự sinh mã nhân viên theo cấu hình cơ bản

### Nên làm nếu đủ thời gian

1. Hợp đồng cơ bản
2. File hồ sơ
3. Export Excel
4. Cấp bậc
5. Loại hợp đồng
6. Cảnh báo hợp đồng sắp hết hạn
7. Xem trước mã nhân viên tiếp theo
8. Khóa/mở quyền sửa mã nhân viên thủ công

### Để phase sau

1. Import Excel
2. Onboarding/offboarding workflow
3. Khen thưởng/kỷ luật
4. Đánh giá hiệu suất
5. Bảo hiểm
6. Thuế
7. E-sign
8. Sơ đồ tổ chức nâng cao

---

## 31. Kết luận

SPEC-03 là tài liệu chi tiết cho module Quản lý nhân sự, một trong các module lõi nhất của hệ thống.

Module HR đóng vai trò là nguồn dữ liệu trung tâm cho:

* AUTH: liên kết tài khoản
* ATT: chấm công
* LEAVE: nghỉ phép
* TASK: giao việc
* DASH: dashboard
* NOTI: thông báo
* PAYROLL: tiền lương sau MVP
* RECRUIT: tuyển dụng sau MVP
* ASSET: tài sản sau MVP
* ROOM: phòng họp sau MVP

Bản SPEC-03 hợp nhất đã bổ sung 2 năng lực quan trọng:

1. **Employee Self-Service có kiểm duyệt**: Nhân viên chủ động đề xuất cập nhật thông tin cá nhân, nhưng dữ liệu chỉ có hiệu lực sau khi HR/Admin duyệt.
2. **Employee Code Configuration**: Mã nhân viên được sinh tự động theo cấu hình, giúp kiểm soát chuẩn mã và giảm lỗi nhập liệu.

Sau khi SPEC-03 được chốt, có thể tiếp tục triển khai:

1. SPEC-04: Chấm công
2. SPEC-05: Nghỉ phép
3. SPEC-06: Công việc & dự án
4. SPEC-07: Dashboard
5. SPEC-08: Thông báo hệ thống
