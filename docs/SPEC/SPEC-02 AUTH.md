# SPEC-02: TÀI KHOẢN, ĐĂNG NHẬP & PHÂN QUYỀN

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · **SPEC-02 AUTH** · [SPEC-03 HR](<SPEC-03 HR.md>) · [SPEC-04 ATT](<SPEC-04 ATT.md>) · [SPEC-05 LEAVE](<SPEC-05 LEAVE.md>) · [SPEC-06 TASK](<SPEC-06 TASK.md>) · [SPEC-07 DASH](<SPEC-07 DASH.md>) · [SPEC-08 NOTI](<SPEC-08 NOTI.md>) · [SPEC-09 ME](<SPEC-09 ME.md>)
>
> **Liên quan:** [Thiết kế DB: DB-02 AUTH/RBAC](<../DB/DB-02 AUTH RBAC Database Design.md>) · [Sản phẩm: PRD-00 §9.1](<../PRD/PRD-00 Enterprise Management System .md>) · [Thiết kế API: API-02 AUTH](<../API Design/API-02 AUTH API Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường        | Nội dung                          |
| ------------- | --------------------------------- |
| Mã tài liệu   | SPEC-02                           |
| Tên tài liệu  | Tài khoản, đăng nhập & phân quyền |
| Module code   | AUTH                              |
| Tài liệu cha  | SPEC-01: Tổng quan hệ thống       |
| Phiên bản     | v1.0                              |
| Trạng thái    | Draft                             |
| Giai đoạn     | MVP Version 1.0                   |
| Người viết    |                                   |
| Người duyệt   |                                   |
| Ngày tạo      |                                   |
| Ngày cập nhật |                                   |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết module **Tài khoản, đăng nhập & phân quyền** của hệ thống quản lý doanh nghiệp.

Module này chịu trách nhiệm xử lý các nghiệp vụ liên quan đến:

* Đăng nhập
* Đăng xuất
* Quản lý phiên đăng nhập
* Quản lý tài khoản người dùng
* Quản lý vai trò
* Quản lý quyền
* Gán vai trò cho người dùng
* Kiểm soát quyền truy cập menu, màn hình, chức năng, API và dữ liệu
* Khóa/mở tài khoản
* Đổi mật khẩu
* Quên mật khẩu
* Liên kết tài khoản với hồ sơ nhân viên

Module `AUTH` là module nền tảng. Tất cả module khác đều cần dựa vào `AUTH` để xác định người dùng là ai, có vai trò gì, được phép thao tác gì và được xem phạm vi dữ liệu nào.

---

## 3. Mối liên kết với [SPEC-01](<SPEC-01 Tổng quan.md>)

Theo SPEC-01, module này có mã là:

```text
AUTH
```

Tài liệu này triển khai chi tiết mục:

```text
SPEC-01 → Mục 12.1 AUTH — Tài khoản, đăng nhập & phân quyền
```

Các module phụ thuộc vào AUTH:

| Module  | Mối liên kết                                                     |
| ------- | ---------------------------------------------------------------- |
| HR      | Tài khoản người dùng có thể liên kết với hồ sơ nhân viên         |
| ATT     | Chỉ nhân viên đã đăng nhập mới được chấm công                    |
| LEAVE   | Người dùng đăng nhập mới được tạo và duyệt đơn nghỉ              |
| TASK    | Người dùng đăng nhập mới được tạo task, nhận task, cập nhật task |
| DASH    | Dashboard hiển thị theo vai trò và quyền                         |
| NOTI    | Thông báo gửi theo user_id                                       |
| PAYROLL | Dữ liệu lương cần phân quyền riêng                               |
| RECRUIT | Recruiter cần quyền riêng                                        |
| ASSET   | Asset Manager cần quyền riêng                                    |
| ROOM    | Office Admin cần quyền riêng                                     |

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

Module AUTH cần giúp doanh nghiệp:

1. Quản lý tài khoản truy cập hệ thống.
2. Đảm bảo chỉ người dùng hợp lệ mới được đăng nhập.
3. Đảm bảo mỗi người dùng chỉ thấy đúng chức năng theo vai trò.
4. Đảm bảo mỗi người dùng chỉ thao tác được đúng quyền được cấp.
5. Đảm bảo dữ liệu nhạy cảm không bị truy cập trái phép.
6. Cho phép Admin cấu hình vai trò, quyền và tài khoản.
7. Liên kết tài khoản đăng nhập với hồ sơ nhân viên trong module HR.
8. Cho phép hệ thống mở rộng thêm quyền mới khi có module mới.

### 4.2 Mục tiêu kỹ thuật

Module AUTH cần đảm bảo:

1. Xác thực người dùng an toàn.
2. Mật khẩu không lưu plain text.
3. Backend luôn kiểm tra quyền, không chỉ kiểm tra ở frontend.
4. Token/session có thời hạn.
5. Tài khoản bị khóa không thể đăng nhập.
6. API cần kiểm tra quyền trước khi xử lý.
7. Hệ thống có thể hỗ trợ nhiều vai trò cho một người dùng.
8. Hệ thống có thể hỗ trợ phạm vi dữ liệu: Own, Team, Department, Project, Company, System (6 scope chuẩn; `Project` chỉ dùng cho TASK — xem §7.5).
9. Các hành động quan trọng được ghi audit log.
10. Có thể mở rộng sang SSO, OAuth, Google Workspace hoặc Microsoft 365 trong tương lai.

---

## 5. Phạm vi module

### 5.1 Bao gồm trong MVP

Module AUTH trong MVP v1.0 bao gồm:

| Mã chức năng  | Tên chức năng                            | Độ ưu tiên |
| ------------- | ---------------------------------------- | ---------- |
| AUTH-FUNC-001 | Đăng nhập                                | Rất cao    |
| AUTH-FUNC-002 | Đăng xuất                                | Rất cao    |
| AUTH-FUNC-003 | Quên mật khẩu                            | Cao        |
| AUTH-FUNC-004 | Đặt lại mật khẩu                         | Cao        |
| AUTH-FUNC-005 | Đổi mật khẩu                             | Cao        |
| AUTH-FUNC-006 | Xem hồ sơ tài khoản cá nhân              | Cao        |
| AUTH-FUNC-007 | Quản lý danh sách người dùng             | Rất cao    |
| AUTH-FUNC-008 | Tạo tài khoản người dùng                 | Rất cao    |
| AUTH-FUNC-009 | Cập nhật tài khoản người dùng            | Cao        |
| AUTH-FUNC-010 | Khóa tài khoản                           | Cao        |
| AUTH-FUNC-011 | Mở khóa tài khoản                        | Cao        |
| AUTH-FUNC-012 | Quản lý vai trò                          | Rất cao    |
| AUTH-FUNC-013 | Quản lý quyền                            | Rất cao    |
| AUTH-FUNC-014 | Gán vai trò cho người dùng               | Rất cao    |
| AUTH-FUNC-015 | Kiểm tra quyền truy cập menu/màn hình    | Rất cao    |
| AUTH-FUNC-016 | Kiểm tra quyền truy cập API              | Rất cao    |
| AUTH-FUNC-017 | Ghi log đăng nhập và thao tác quan trọng | Cao        |

---

### 5.2 Chưa bao gồm trong MVP

Các chức năng sau chưa bắt buộc trong MVP, nhưng cần thiết kế để mở rộng:

| Chức năng                     | Giai đoạn |
| ----------------------------- | --------- |
| Đăng nhập bằng Google         | Phase sau |
| Đăng nhập bằng Microsoft      | Phase sau |
| SSO doanh nghiệp              | Phase sau |
| Xác thực hai lớp 2FA          | Phase sau |
| Quản lý thiết bị đăng nhập    | Phase sau |
| Giới hạn IP đăng nhập         | Phase sau |
| Quản lý nhiều tenant/công ty  | Phase sau |
| Chính sách mật khẩu nâng cao  | Phase sau |
| Cảnh báo đăng nhập bất thường | Phase sau |

---

## 6. Nhóm người dùng liên quan

| Vai trò         | Mô tả                                                          |
| --------------- | -------------------------------------------------------------- |
| Super Admin     | Toàn quyền toàn hệ thống                                       |
| Admin công ty   | Quản lý user, role, permission trong công ty                   |
| HR              | Có thể tạo tài khoản khi tạo nhân viên nếu được cấp quyền      |
| Manager         | Sử dụng tài khoản để quản lý team, duyệt đơn, giao việc        |
| Employee        | Sử dụng tài khoản để đăng nhập, chấm công, xin nghỉ, nhận task |
| Payroll Officer | Vai trò sau MVP, truy cập dữ liệu lương                        |
| Recruiter       | Vai trò sau MVP, truy cập tuyển dụng                           |
| Asset Manager   | Vai trò sau MVP, truy cập tài sản                              |
| Office Admin    | Vai trò sau MVP, truy cập phòng họp/hành chính                 |

---

## 7. Khái niệm chính trong module

### 7.1 User

`User` là tài khoản đăng nhập vào hệ thống.

Một user có thể:

* Có email đăng nhập
* Có mật khẩu
* Có trạng thái tài khoản
* Có một hoặc nhiều vai trò
* Có thể liên kết với một hồ sơ nhân viên
* Có thể bị khóa hoặc mở khóa
* Có thể có lịch sử đăng nhập

---

### 7.2 Employee

`Employee` là hồ sơ nhân viên trong module HR.

Một employee có thể được liên kết với một user để đăng nhập hệ thống.

Ví dụ:

```text
Employee: Nguyễn Văn A
User: nguyenvana@company.com
```

Không phải mọi employee đều bắt buộc có user trong MVP, nhưng nếu nhân viên cần đăng nhập để chấm công, xin nghỉ, nhận task thì cần có user.

---

### 7.3 Role

`Role` là vai trò người dùng trong hệ thống.

Ví dụ:

* Super Admin
* Admin công ty
* HR
* Manager
* Employee
* Payroll Officer
* Recruiter
* Asset Manager
* Office Admin

Một user có thể có nhiều role.

Ví dụ:

```text
Nguyễn Văn B có thể vừa là Employee vừa là Manager.
Trần Thị C có thể vừa là HR vừa là Payroll Officer.
```

---

### 7.4 Permission

`Permission` là quyền cụ thể cho phép người dùng thực hiện một hành động.

Ví dụ:

```text
HR.EMPLOYEE.VIEW
HR.EMPLOYEE.CREATE
HR.EMPLOYEE.UPDATE
LEAVE.REQUEST.APPROVE
TASK.PROJECT.CREATE
```

Role sẽ được gán nhiều permission.

User nhận quyền thông qua role.

---

### 7.5 Data Scope

`Data Scope` là phạm vi dữ liệu mà người dùng được truy cập.

Các phạm vi dữ liệu (6 scope chuẩn, khớp DB-02 §4.7 và BACKEND-03):

| Scope      | Ý nghĩa                                              |
| ---------- | --------------------------------------------------- |
| Own        | Chỉ dữ liệu của chính mình                          |
| Team       | Dữ liệu của team mình quản lý                       |
| Department | Dữ liệu thuộc phòng ban                             |
| Project    | Dữ liệu thuộc dự án liên quan — **chỉ dùng cho TASK** |
| Company    | Dữ liệu toàn công ty                                |
| System     | Dữ liệu toàn hệ thống                               |

> **Ghi chú `Project`:** `Project` là scope thứ 6, chỉ áp dụng cho module TASK (theo project membership), không nằm trong chuỗi tuyến tính `Own ⊂ Team ⊂ Department ⊂ Company ⊂ System`. Danh sách scope chuẩn gồm **6 giá trị** để nhất quán với DB-02 (`role_permissions.data_scope` CHECK 6 giá trị) và BACKEND-03 §4.9. Các module ngoài TASK trong MVP chỉ dùng 5 scope tuyến tính.

Ví dụ:

* Employee có quyền `ATT.ATTENDANCE.VIEW` với scope `Own`.
* Manager có quyền `ATT.ATTENDANCE.VIEW` với scope `Team`.
* HR có quyền `ATT.ATTENDANCE.VIEW` với scope `Company`.
* Project Manager có quyền `TASK.TASK.VIEW` với scope `Project`.

---

## 8. Quy ước mã quyền

Cấu trúc mã quyền:

```text
MODULE.RESOURCE.ACTION
```

Ví dụ:

```text
AUTH.USER.VIEW
AUTH.USER.CREATE
AUTH.USER.UPDATE
AUTH.USER.LOCK
AUTH.ROLE.VIEW
AUTH.ROLE.CREATE
AUTH.ROLE.UPDATE
AUTH.PERMISSION.VIEW
AUTH.PERMISSION.ASSIGN
```

### 8.1 Danh sách quyền AUTH trong MVP

| Mã quyền               | Mô tả                            |
| ---------------------- | -------------------------------- |
| AUTH.LOGIN.ACCESS      | Được phép đăng nhập              |
| AUTH.PROFILE.VIEW      | Xem hồ sơ tài khoản cá nhân      |
| AUTH.PROFILE.UPDATE    | Cập nhật hồ sơ tài khoản cá nhân |
| AUTH.PASSWORD.CHANGE   | Đổi mật khẩu cá nhân             |
| AUTH.USER.VIEW         | Xem danh sách user               |
| AUTH.USER.CREATE       | Tạo user                         |
| AUTH.USER.UPDATE       | Cập nhật user                    |
| AUTH.USER.LOCK         | Khóa user                        |
| AUTH.USER.UNLOCK       | Mở khóa user                     |
| AUTH.USER.DELETE       | Xóa mềm user (soft-delete; KHÔNG hard-delete — xem AU-11) |
| AUTH.USER.ASSIGN_ROLE  | Gán role cho user                |
| AUTH.ROLE.VIEW         | Xem danh sách role               |
| AUTH.ROLE.CREATE       | Tạo role                         |
| AUTH.ROLE.UPDATE       | Cập nhật role                    |
| AUTH.ROLE.DELETE       | Xóa/vô hiệu hóa role             |
| AUTH.PERMISSION.VIEW   | Xem danh sách permission         |
| AUTH.PERMISSION.ASSIGN | Gán permission cho role          |
| AUTH.AUDIT_LOG.VIEW    | Xem log liên quan AUTH           |

> **Non-guard (AU-9):** `AUTH.LOGIN.ACCESS`, `AUTH.PROFILE.VIEW`, `AUTH.PROFILE.UPDATE` là **nhãn mô tả**, KHÔNG phải permission guard — đăng nhập và màn hồ sơ cá nhân gate bằng `Authenticated` (đã đăng nhập), không kiểm permission code. Vì vậy số quyền AUTH **thực-guard = 14** (khớp [API-10 PERMISSION MATRIX](<../API Design/API-10 PERMISSION MATRIX.md>)); bảng trên liệt kê 17 mã (gồm 3 nhãn non-guard + `AUTH.USER.DELETE` theo AU-11) để tham chiếu đầy đủ.

> **Ranh giới audit `AUTH.AUDIT_LOG.VIEW` vs `FOUNDATION.AUDIT_LOG.VIEW` (AU-3):** hệ thống ghi mọi log vào bảng `audit_logs` **chung** (Foundation), nhưng quyền đọc tách theo phạm vi:
> - `AUTH.AUDIT_LOG.VIEW` — audit thuộc **AUTH-domain / security** (đăng nhập thành công-thất bại, logout, đổi/đặt lại mật khẩu, khóa-mở user, tạo-sửa user, gán role/permission). Đây là quyền dùng cho màn hình **AUTH-SCREEN-014 (Nhật ký hoạt động AUTH)** và ma trận §19 ("Xem audit log AUTH").
> - `FOUNDATION.AUDIT_LOG.VIEW` / `FOUNDATION.AUDIT_LOG.EXPORT` — audit **cross-module / toàn hệ thống** (truy vết entity bất kỳ qua endpoint `audit-logs` của Foundation, không giới hạn module AUTH).
>
> Quy ước này khớp [API-10 §5.1/§5.8](<../API Design/API-10 PERMISSION MATRIX.md>), [BACKEND-11 §8.1](<../BACKEND/BACKEND-11_File_Audit_Settings_System_Jobs.md>) và seed [DB-02 §9.1](<../DB/DB-02 AUTH RBAC Database Design.md>). KHÔNG trộn hai mã trong cùng một guard.

<!-- sửa theo DRIFT AU-11: thêm `AUTH.USER.DELETE` (quyền nhạy cảm). Backend đã có admin xóa-mềm user (`delete-user:user`, is_sensitive=true, mig 0430); thao tác chỉ set `deleted_at`/`status`, KHÔNG hard-delete (BẤT BIẾN #2). -->
<!-- sửa theo DRIFT AU-9: đánh dấu AUTH.LOGIN.ACCESS / AUTH.PROFILE.VIEW / AUTH.PROFILE.UPDATE là non-guard (gate bằng Authenticated), khớp API-10 §Audit. -->

---

## 9. Vai trò mặc định trong MVP

### 9.1 Super Admin

Quyền:

* Có toàn bộ quyền hệ thống.
* Có thể tạo, sửa, khóa user.
* Có thể tạo, sửa role.
* Có thể gán permission.
* Có thể xem audit log.
* Có thể truy cập tất cả module.

Data scope mặc định:

```text
System
```

---

### 9.2 Admin công ty

Quyền:

* Quản lý user trong công ty.
* Gán role cho user trong công ty.
* Cấu hình vai trò cơ bản.
* Xem dashboard quản trị.
* Không mặc định được xem dữ liệu lương nếu không có quyền riêng.

Data scope mặc định:

```text
Company
```

---

### 9.3 HR

Quyền:

* Xem hồ sơ nhân viên.
* Tạo/cập nhật nhân viên.
* Có thể tạo tài khoản cho nhân viên nếu được cấp quyền.
* Quản lý phòng ban, chức vụ.
* Xem bảng công, nghỉ phép theo quyền.
* Không mặc định có quyền chỉnh role hệ thống.

Data scope mặc định:

```text
Company
```

---

### 9.4 Manager

Quyền:

* Xem nhân viên thuộc team.
* Xem bảng công team.
* Duyệt đơn nghỉ team.
* Tạo/giao task nếu được cấp quyền.
* Không được quản lý user, role, permission.

Data scope mặc định:

```text
Team
```

---

### 9.5 Employee

Quyền:

* Đăng nhập hệ thống.
* Xem hồ sơ cá nhân.
* Đổi mật khẩu.
* Chấm công.
* Tạo đơn nghỉ phép.
* Xem task được giao.
* Cập nhật task được giao nếu có quyền.

Data scope mặc định:

```text
Own
```

---

## 10. Trạng thái tài khoản

<!-- sửa theo DRIFT AU-5: casing trạng thái user chuẩn = PascalCase (khớp DB-02 §7.1 CHECK / API-02). Thêm `Suspended` để doc hóa trạng thái code đang dùng (`suspended` lowercase). -->

| Trạng thái     | Mã                 | Ý nghĩa                                                                      |
| -------------- | ------------------ | ---------------------------------------------------------------------------- |
| Chờ kích hoạt  | Pending Activation | Tài khoản đã được tạo nhưng người dùng chưa kích hoạt hoặc chưa đặt mật khẩu |
| Đang hoạt động | Active             | Tài khoản có thể đăng nhập                                                   |
| Tạm ngưng (mềm) | Suspended         | Tài khoản bị tạm ngưng bởi Admin; không thể đăng nhập. Lỗi `AUTH-ERR-USER-SUSPENDED` |
| Ngừng hoạt động | Inactive          | Tài khoản không hoạt động, không thể đăng nhập                               |
| Bị khóa        | Locked             | Tài khoản bị khóa bởi Admin hoặc do vi phạm điều kiện bảo mật                |
| Đã xóa mềm     | Deleted            | **Sentinel soft-delete** (đi kèm `deleted_at`), KHÔNG phải trạng thái định tuyến |

> **Casing chuẩn (AU-5):** Trạng thái dùng **PascalCase** (`Pending Activation`/`Active`/`Suspended`/`Inactive`/`Locked`/`Deleted`), khớp `users.status` CHECK ở DB-02 §7.1 và API-02. Code AUTH hiện lưu giá trị lowercase (`active`/`suspended`) trong nhánh legacy (migration `0430`) — coi là **biến thể casing của cùng trạng thái**: `suspended` (code) ↔ `Suspended` (doc). Khi đồng bộ DB-02 CHECK, ánh xạ này phải nhất quán; chỉ một casing được phép ở mỗi tầng.
>
> **Ghi chú `Suspended` vs `Inactive`:** `Suspended` là tạm ngưng có chủ đích bởi Admin (có thể khôi phục/reactivate); `Inactive` là ngừng hoạt động chung. Cả hai đều chặn login. Nếu doanh nghiệp không cần phân biệt, có thể gộp `Suspended` về `Inactive` ở pass sau — xem báo cáo AU-5.
>
> **Ghi chú `Deleted`:** `Deleted` là sentinel đánh dấu xóa mềm, không phải một state có màn hình/route riêng. User `Deleted` không hiển thị ở danh sách mặc định và không thể đăng nhập. Tương tự, company `Deleted` không cho login.
>
> **Company `Suspended`:** Ở phía tài khoản, công ty `Suspended` được xử lý y hệt công ty `Inactive` — backend trả cùng lỗi 403 `AUTH-ERR-COMPANY-INACTIVE`, không có luồng riêng cho `Suspended`.

---

## 11. Danh sách màn hình

| Mã màn hình     | Tên màn hình               | Người dùng truy cập                    |
| --------------- | -------------------------- | -------------------------------------- |
| AUTH-SCREEN-001 | Màn hình đăng nhập         | Tất cả người dùng                      |
| AUTH-SCREEN-002 | Màn hình quên mật khẩu     | Tất cả người dùng                      |
| AUTH-SCREEN-003 | Màn hình đặt lại mật khẩu  | Tất cả người dùng có link/token hợp lệ |
| AUTH-SCREEN-004 | Màn hình đổi mật khẩu      | Người dùng đã đăng nhập                |
| AUTH-SCREEN-005 | Hồ sơ tài khoản cá nhân    | Người dùng đã đăng nhập                |
| AUTH-SCREEN-006 | Danh sách người dùng       | Admin, Super Admin                     |
| AUTH-SCREEN-007 | Tạo người dùng             | Admin, Super Admin, HR nếu có quyền    |
| AUTH-SCREEN-008 | Chi tiết người dùng        | Admin, Super Admin                     |
| AUTH-SCREEN-009 | Chỉnh sửa người dùng       | Admin, Super Admin                     |
| AUTH-SCREEN-010 | Danh sách vai trò          | Admin, Super Admin                     |
| AUTH-SCREEN-011 | Tạo/chỉnh sửa vai trò      | Admin, Super Admin                     |
| AUTH-SCREEN-012 | Gán quyền cho vai trò      | Admin, Super Admin                     |
| AUTH-SCREEN-013 | Gán vai trò cho người dùng | Admin, Super Admin                     |
| AUTH-SCREEN-014 | Nhật ký hoạt động AUTH     | Super Admin, Admin có quyền            |

---

## 12. Luồng nghiệp vụ tổng quan

### 12.1 Luồng đăng nhập

```text
Người dùng truy cập màn hình đăng nhập
→ Nhập email và mật khẩu
→ Hệ thống kiểm tra email có tồn tại không
→ Hệ thống kiểm tra trạng thái tài khoản
→ Hệ thống kiểm tra mật khẩu
→ Nếu hợp lệ, hệ thống tạo phiên đăng nhập/token
→ Hệ thống lấy danh sách role và permission
→ Hệ thống điều hướng người dùng vào dashboard phù hợp
```

---

### 12.2 Luồng tạo tài khoản cho nhân viên

```text
HR/Admin tạo hồ sơ nhân viên trong module HR
→ Chọn tạo tài khoản đăng nhập
→ Hệ thống tạo user liên kết với employee
→ Hệ thống gán role mặc định Employee
→ Hệ thống gửi thông báo/email kích hoạt tài khoản nếu có cấu hình
→ Nhân viên đặt mật khẩu
→ Tài khoản chuyển sang trạng thái Active
```

---

### 12.3 Luồng gán vai trò

```text
Admin vào danh sách user
→ Chọn một user
→ Chọn chức năng gán vai trò
→ Hệ thống hiển thị danh sách role
→ Admin chọn role cần gán
→ Hệ thống lưu role cho user
→ Hệ thống cập nhật quyền truy cập của user
→ Hệ thống ghi audit log
```

---

### 12.4 Luồng kiểm tra quyền khi truy cập chức năng

```text
User gửi yêu cầu truy cập màn hình/API
→ Hệ thống xác định user_id từ token/session
→ Hệ thống lấy role của user
→ Hệ thống lấy permission từ role
→ Hệ thống kiểm tra permission cần thiết
→ Hệ thống kiểm tra data scope nếu có
→ Nếu hợp lệ, cho phép truy cập
→ Nếu không hợp lệ, trả lỗi không có quyền
```

---

## 13. Chi tiết chức năng

### 13.1 AUTH-FUNC-001: Đăng nhập

#### Mục tiêu

Cho phép người dùng đăng nhập vào hệ thống bằng email và mật khẩu.

#### Người dùng

* Super Admin
* Admin công ty
* HR
* Manager
* Employee
* Các vai trò khác nếu có tài khoản

#### Điều kiện trước

* Người dùng đã có tài khoản.
* Tài khoản đang ở trạng thái Active.
* Người dùng nhập đúng email và mật khẩu.

#### Luồng chính

1. Người dùng truy cập màn hình đăng nhập.
2. Người dùng nhập email.
3. Người dùng nhập mật khẩu.
4. Người dùng bấm nút Đăng nhập.
5. Hệ thống kiểm tra định dạng email.
6. Hệ thống kiểm tra tài khoản có tồn tại không.
7. Hệ thống kiểm tra trạng thái tài khoản.
8. Hệ thống kiểm tra mật khẩu.
9. Hệ thống tạo phiên đăng nhập/token.
10. Hệ thống lấy thông tin user, role, permission.
11. Hệ thống điều hướng người dùng vào dashboard.

#### Dữ liệu nhập

| Trường   | Bắt buộc | Kiểu dữ liệu | Ghi chú                   |
| -------- | -------- | ------------ | ------------------------- |
| email    | Có       | String       | Định dạng email           |
| password | Có       | String       | Không hiển thị plain text |

#### Trường hợp lỗi

<!-- sửa theo DRIFT AU-4: hệ mã lỗi chuẩn = SLUG (khớp API-02 §14). Bảng ánh xạ số→slug ở §20. -->

| Mã lỗi (slug)                | Trường hợp               | Thông báo                      |
| ---------------------------- | ------------------------ | ------------------------------ |
| AUTH-ERR-INVALID-CREDENTIALS | Email hoặc mật khẩu sai  | Email hoặc mật khẩu không đúng |
| AUTH-ERR-USER-LOCKED         | Tài khoản bị khóa        | Tài khoản của bạn đã bị khóa   |
| AUTH-ERR-USER-INACTIVE       | Tài khoản chưa kích hoạt | Tài khoản chưa được kích hoạt  |
| AUTH-ERR-EMAIL-REQUIRED      | Thiếu email              | Vui lòng nhập email            |
| AUTH-ERR-PASSWORD-REQUIRED   | Thiếu mật khẩu           | Vui lòng nhập mật khẩu         |
| AUTH-ERR-INVALID-EMAIL-FORMAT | Sai định dạng email     | Email không đúng định dạng     |

#### Kết quả thành công

* Người dùng đăng nhập thành công.
* Hệ thống tạo phiên đăng nhập/token.
* Hệ thống ghi log đăng nhập.
* Người dùng được chuyển đến dashboard phù hợp.

#### Tiêu chí nghiệm thu

* Người dùng nhập đúng thông tin thì đăng nhập thành công.
* Người dùng nhập sai thông tin thì không đăng nhập được.
* Tài khoản bị khóa không đăng nhập được.
* Tài khoản chưa kích hoạt không đăng nhập được.
* Sau đăng nhập, người dùng chỉ thấy menu đúng quyền.
* Hệ thống ghi log đăng nhập thành công/thất bại.

---

### 13.2 AUTH-FUNC-002: Đăng xuất

#### Mục tiêu

Cho phép người dùng kết thúc phiên đăng nhập.

#### Người dùng

Tất cả người dùng đã đăng nhập.

#### Luồng chính

1. Người dùng bấm vào menu tài khoản.
2. Người dùng chọn Đăng xuất.
3. Hệ thống hiển thị xác nhận nếu cần.
4. Người dùng xác nhận.
5. Hệ thống xóa token/session ở client.
6. Hệ thống vô hiệu hóa phiên đăng nhập nếu có lưu server-side session.
7. Hệ thống chuyển về màn hình đăng nhập.

#### Kết quả thành công

* Người dùng không còn truy cập được màn hình yêu cầu đăng nhập.
* Token/session cũ không còn hợp lệ.
* Người dùng được đưa về màn hình đăng nhập.

#### Tiêu chí nghiệm thu

* Người dùng đăng xuất thành công.
* Sau khi đăng xuất, refresh trang không vào lại được hệ thống.
* Người dùng cần đăng nhập lại để tiếp tục sử dụng.

---

### 13.3 AUTH-FUNC-003: Quên mật khẩu

#### Mục tiêu

Cho phép người dùng yêu cầu đặt lại mật khẩu khi quên mật khẩu.

#### Người dùng

Người dùng chưa đăng nhập.

#### Luồng chính

1. Người dùng vào màn hình đăng nhập.
2. Người dùng chọn Quên mật khẩu.
3. Hệ thống hiển thị form nhập email.
4. Người dùng nhập email.
5. Người dùng bấm Gửi yêu cầu.
6. Hệ thống kiểm tra email.
7. Nếu email tồn tại và tài khoản hợp lệ, hệ thống tạo token đặt lại mật khẩu.
8. Hệ thống gửi link đặt lại mật khẩu qua email hoặc thông báo theo cấu hình.
9. Hệ thống hiển thị thông báo đã gửi hướng dẫn.

#### Quy tắc bảo mật

* Không nên thông báo rõ email có tồn tại hay không để tránh dò tài khoản.
* Token đặt lại mật khẩu cần có thời hạn.
* Token chỉ được dùng một lần.
* Token hết hạn không được sử dụng.

#### Thông báo gợi ý

```text
Nếu email tồn tại trong hệ thống, chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu.
```

#### Tiêu chí nghiệm thu

* Người dùng nhập email hợp lệ có thể gửi yêu cầu.
* Hệ thống tạo token reset password.
* Token hết hạn không sử dụng được.
* Token đã dùng không sử dụng lại được.
* Hệ thống không tiết lộ email có tồn tại hay không.

---

### 13.4 AUTH-FUNC-004: Đặt lại mật khẩu

#### Mục tiêu

Cho phép người dùng tạo mật khẩu mới thông qua token đặt lại mật khẩu hợp lệ.

#### Người dùng

Người dùng có link/token reset password hợp lệ.

#### Luồng chính

1. Người dùng mở link đặt lại mật khẩu.
2. Hệ thống kiểm tra token.
3. Nếu token hợp lệ, hệ thống hiển thị form đặt mật khẩu mới.
4. Người dùng nhập mật khẩu mới.
5. Người dùng nhập xác nhận mật khẩu.
6. Người dùng bấm Lưu mật khẩu.
7. Hệ thống kiểm tra điều kiện mật khẩu.
8. Hệ thống cập nhật mật khẩu mới.
9. Hệ thống vô hiệu hóa token.
10. Hệ thống chuyển người dùng về màn hình đăng nhập.

#### Dữ liệu nhập

| Trường           | Bắt buộc | Kiểu dữ liệu |
| ---------------- | -------- | ------------ |
| new_password     | Có       | String       |
| confirm_password | Có       | String       |

#### Trường hợp lỗi

| Mã lỗi (slug)                      | Trường hợp                   | Thông báo                             |
| ---------------------------------- | ---------------------------- | ------------------------------------- |
| AUTH-ERR-RESET-TOKEN-INVALID       | Token không hợp lệ           | Link đặt lại mật khẩu không hợp lệ    |
| AUTH-ERR-RESET-TOKEN-EXPIRED       | Token hết hạn                | Link đặt lại mật khẩu đã hết hạn      |
| AUTH-ERR-PASSWORD-CONFIRM-MISMATCH | Mật khẩu xác nhận không khớp | Mật khẩu xác nhận không khớp          |
| AUTH-ERR-PASSWORD-POLICY           | Mật khẩu không đạt yêu cầu   | Mật khẩu chưa đáp ứng yêu cầu bảo mật |

#### Tiêu chí nghiệm thu

* Token hợp lệ cho phép đặt lại mật khẩu.
* Token hết hạn bị từ chối.
* Hai mật khẩu không khớp thì không cho lưu.
* Sau khi đặt lại mật khẩu, người dùng đăng nhập được bằng mật khẩu mới.
* Mật khẩu cũ không còn đăng nhập được.

---

### 13.5 AUTH-FUNC-005: Đổi mật khẩu

#### Mục tiêu

Cho phép người dùng đã đăng nhập đổi mật khẩu cá nhân.

#### Người dùng

Tất cả người dùng đã đăng nhập.

#### Luồng chính

1. Người dùng vào menu tài khoản.
2. Chọn Đổi mật khẩu.
3. Hệ thống hiển thị form đổi mật khẩu.
4. Người dùng nhập mật khẩu hiện tại.
5. Người dùng nhập mật khẩu mới.
6. Người dùng nhập xác nhận mật khẩu mới.
7. Người dùng bấm Lưu.
8. Hệ thống kiểm tra mật khẩu hiện tại.
9. Hệ thống kiểm tra mật khẩu mới.
10. Hệ thống cập nhật mật khẩu.
11. Hệ thống hiển thị thông báo thành công.

#### Dữ liệu nhập

| Trường           | Bắt buộc | Ghi chú               |
| ---------------- | -------- | --------------------- |
| current_password | Có       | Mật khẩu hiện tại     |
| new_password     | Có       | Mật khẩu mới          |
| confirm_password | Có       | Xác nhận mật khẩu mới |

#### Tiêu chí nghiệm thu

* Người dùng đổi mật khẩu thành công nếu nhập đúng mật khẩu hiện tại.
* Nhập sai mật khẩu hiện tại thì không đổi được.
* Mật khẩu xác nhận không khớp thì không đổi được.
* Sau khi đổi, người dùng đăng nhập được bằng mật khẩu mới.

---

### 13.6 AUTH-FUNC-006: Xem hồ sơ tài khoản cá nhân

#### Mục tiêu

Cho phép người dùng xem thông tin tài khoản cá nhân.

#### Người dùng

Tất cả người dùng đã đăng nhập.

#### Thông tin hiển thị

| Trường                 | Mô tả                     |
| ---------------------- | ------------------------- |
| Avatar                 | Ảnh đại diện nếu có       |
| Họ tên                 | Lấy từ user hoặc employee |
| Email                  | Email đăng nhập           |
| Vai trò                | Danh sách vai trò         |
| Phòng ban              | Nếu liên kết employee     |
| Chức vụ                | Nếu liên kết employee     |
| Trạng thái tài khoản   | Active/Locked/Inactive    |
| Lần đăng nhập gần nhất | Nếu có lưu                |

#### Tiêu chí nghiệm thu

* Người dùng xem được thông tin tài khoản của mình.
* Người dùng không xem được hồ sơ tài khoản người khác nếu không có quyền.
* Thông tin vai trò hiển thị đúng.

---

### 13.7 AUTH-FUNC-007: Quản lý danh sách người dùng

#### Mục tiêu

Cho phép Admin/Super Admin xem, tìm kiếm và lọc danh sách tài khoản người dùng.

#### Người dùng

* Super Admin
* Admin công ty
* Người có quyền `AUTH.USER.VIEW`

#### Bộ lọc

| Bộ lọc     | Mô tả                             |
| ---------- | --------------------------------- |
| Từ khóa    | Tìm theo tên, email               |
| Vai trò    | Lọc theo role                     |
| Trạng thái | Active, Locked, Inactive, Pending |
| Phòng ban  | Nếu user liên kết employee        |
| Ngày tạo   | Lọc theo khoảng thời gian         |

#### Cột hiển thị

| Cột                    | Mô tả                             |
| ---------------------- | --------------------------------- |
| Họ tên                 | Tên user/employee                 |
| Email                  | Email đăng nhập                   |
| Vai trò                | Role được gán                     |
| Phòng ban              | Nếu có                            |
| Trạng thái             | Trạng thái tài khoản              |
| Lần đăng nhập gần nhất | Nếu có                            |
| Ngày tạo               | Thời gian tạo user                |
| Hành động              | Xem, sửa, khóa, mở khóa, gán role |

#### Tiêu chí nghiệm thu

* Admin xem được danh sách user trong phạm vi quyền.
* Có thể tìm kiếm theo tên/email.
* Có thể lọc theo trạng thái.
* Có phân trang.
* User không có quyền không truy cập được màn hình.

---

### 13.8 AUTH-FUNC-008: Tạo tài khoản người dùng

#### Mục tiêu

Cho phép người có quyền tạo tài khoản đăng nhập mới.

#### Người dùng

* Super Admin
* Admin công ty
* HR nếu được cấp quyền `AUTH.USER.CREATE`

#### Luồng chính

1. Người dùng vào màn hình danh sách user.
2. Bấm Tạo người dùng.
3. Hệ thống hiển thị form tạo user.
4. Người dùng nhập thông tin.
5. Người dùng chọn vai trò.
6. Người dùng liên kết employee nếu có.
7. Người dùng bấm Lưu.
8. Hệ thống kiểm tra dữ liệu.
9. Hệ thống tạo user.
10. Hệ thống gửi thông báo/email kích hoạt nếu có cấu hình.
11. Hệ thống ghi audit log.

#### Dữ liệu nhập

| Trường             | Bắt buộc | Ghi chú                                 |
| ------------------ | -------- | --------------------------------------- |
| full_name          | Có       | Họ tên người dùng                       |
| email              | Có       | Không được trùng                        |
| phone              | Không    | Số điện thoại                           |
| employee_id        | Không    | Liên kết hồ sơ nhân viên                |
| roles              | Có       | Ít nhất một role                        |
| status             | Có       | Mặc định Pending Activation hoặc Active |
| temporary_password | Có/Không | Tùy cấu hình tạo mật khẩu               |

#### Quy tắc

* Email đăng nhập không được trùng.
* Một employee chỉ nên liên kết với một user chính.
* User mới cần có ít nhất một role.
* Nếu không chọn role, hệ thống có thể mặc định role Employee khi liên kết employee.
* Nếu tạo tài khoản từ hồ sơ nhân viên, email có thể lấy từ email công ty của nhân viên.

#### Trường hợp lỗi

| Mã lỗi (slug)             | Trường hợp               | Thông báo                                         |
| ------------------------- | ------------------------ | ------------------------------------------------- |
| AUTH-ERR-EMAIL-EXISTS     | Email đã tồn tại         | Email này đã được sử dụng                         |
| AUTH-ERR-ROLE-REQUIRED    | Chưa chọn role           | Vui lòng chọn ít nhất một vai trò                 |
| AUTH-ERR-EMPLOYEE-LINKED  | Employee đã có tài khoản | Nhân viên này đã được liên kết với tài khoản khác |
| AUTH-ERR-FORBIDDEN        | Không có quyền tạo user  | Bạn không có quyền tạo tài khoản                  |

#### Tiêu chí nghiệm thu

* Admin tạo được user khi dữ liệu hợp lệ.
* Không tạo được user nếu email trùng.
* Không tạo được user nếu thiếu role.
* User mới xuất hiện trong danh sách.
* Hệ thống ghi log tạo user.

---

### 13.9 AUTH-FUNC-009: Cập nhật tài khoản người dùng

#### Mục tiêu

Cho phép Admin cập nhật thông tin tài khoản người dùng.

#### Người dùng

* Super Admin
* Admin công ty
* Người có quyền `AUTH.USER.UPDATE`

#### Thông tin có thể cập nhật

| Trường            | Cho phép sửa                              |
| ----------------- | ----------------------------------------- |
| Họ tên            | Có                                        |
| Số điện thoại     | Có                                        |
| Avatar            | Có                                        |
| Liên kết employee | Có, nếu có quyền                          |
| Vai trò           | Qua chức năng gán role                    |
| Trạng thái        | Qua chức năng khóa/mở khóa                |
| Email             | Có thể cho phép hoặc hạn chế tùy cấu hình |

#### Quy tắc

* Không cho user thường chỉnh role của chính mình.
* Không cho Admin hạ quyền Super Admin nếu không có quyền cao nhất.
* Không cho cập nhật email trùng.
* Cập nhật thông tin quan trọng phải ghi log.

#### Tiêu chí nghiệm thu

* Người có quyền cập nhật được user.
* Người không có quyền không cập nhật được.
* Email trùng không được lưu.
* Thay đổi được ghi audit log.

---

### 13.10 AUTH-FUNC-010: Khóa tài khoản

#### Mục tiêu

Cho phép Admin khóa tài khoản để người dùng không thể đăng nhập.

#### Người dùng

* Super Admin
* Admin công ty
* Người có quyền `AUTH.USER.LOCK`

#### Luồng chính

1. Admin vào danh sách user.
2. Chọn user cần khóa.
3. Bấm Khóa tài khoản.
4. Hệ thống hiển thị modal xác nhận.
5. Admin nhập lý do khóa nếu cần.
6. Admin xác nhận.
7. Hệ thống chuyển trạng thái tài khoản sang Locked.
8. Hệ thống vô hiệu hóa phiên đăng nhập hiện tại nếu có.
9. Hệ thống ghi audit log.

#### Quy tắc

* Tài khoản Locked không được đăng nhập.
* Nếu user đang đăng nhập, hệ thống có thể buộc đăng xuất.
* Không cho Admin tự khóa tài khoản của chính mình nếu là admin cuối cùng.
* Không cho Admin thường khóa Super Admin nếu không có quyền.

#### Tiêu chí nghiệm thu

* User bị khóa không đăng nhập được.
* Trạng thái user chuyển sang Locked.
* Hệ thống ghi log người khóa, thời gian khóa, lý do khóa.

---

### 13.11 AUTH-FUNC-011: Mở khóa tài khoản

#### Mục tiêu

Cho phép Admin mở khóa tài khoản đã bị khóa.

#### Người dùng

* Super Admin
* Admin công ty
* Người có quyền `AUTH.USER.UNLOCK`

#### Luồng chính

1. Admin vào danh sách user.
2. Lọc tài khoản Locked.
3. Chọn user cần mở khóa.
4. Bấm Mở khóa.
5. Hệ thống hiển thị xác nhận.
6. Admin xác nhận.
7. Hệ thống chuyển trạng thái tài khoản sang Active.
8. Hệ thống ghi audit log.

#### Tiêu chí nghiệm thu

* Tài khoản Locked có thể được mở khóa.
* Sau khi mở khóa, user đăng nhập lại được.
* Hệ thống ghi log mở khóa.

---

### 13.12 AUTH-FUNC-012: Quản lý vai trò

#### Mục tiêu

Cho phép Admin tạo, xem, cập nhật và vô hiệu hóa vai trò trong hệ thống.

#### Người dùng

* Super Admin
* Admin công ty
* Người có quyền `AUTH.ROLE.VIEW`, `AUTH.ROLE.CREATE`, `AUTH.ROLE.UPDATE`, `AUTH.ROLE.DELETE`

#### Thông tin role

| Trường      | Bắt buộc | Mô tả                        |
| ----------- | -------- | ---------------------------- |
| role_name   | Có       | Tên vai trò                  |
| role_code   | Có       | Mã vai trò                   |
| description | Không    | Mô tả vai trò                |
| status      | Có       | Active/Inactive              |
| permissions | Không    | Danh sách quyền gán cho role |
| data_scope  | Có       | Phạm vi dữ liệu mặc định     |

#### Role mặc định

Các role hệ thống nên có sẵn:

```text
SUPER_ADMIN
COMPANY_ADMIN
HR
MANAGER
EMPLOYEE
```

#### Quy tắc

* Role mặc định không nên xóa vĩnh viễn.
* Role đang được gán cho user không được xóa cứng.
* Có thể vô hiệu hóa role nếu không còn sử dụng.
* role_code không được trùng.
* Chỉ người có quyền mới được tạo/sửa role.

#### Tiêu chí nghiệm thu

* Admin xem được danh sách role.
* Admin tạo được role mới.
* Không tạo được role_code trùng.
* Admin gán permission cho role được.
* Role bị inactive không nên gán mới cho user.

---

### 13.13 AUTH-FUNC-013: Quản lý quyền

#### Mục tiêu

Cho phép hệ thống quản lý danh sách quyền dùng cho phân quyền.

#### Người dùng

* Super Admin
* Admin có quyền `AUTH.PERMISSION.VIEW`
* Người có quyền `AUTH.PERMISSION.ASSIGN`

#### Quy tắc

* Permission thường được định nghĩa bởi hệ thống/dev, không nên để Admin tự tạo tùy ý trong MVP.
* Admin có thể xem permission và gán permission cho role.
* Permission được nhóm theo module.
* Khi module mới được thêm, permission mới sẽ được bổ sung.

#### Cấu trúc permission

| Trường          | Mô tả            |
| --------------- | ---------------- |
| permission_code | Mã quyền         |
| permission_name | Tên quyền        |
| module          | Module liên quan |
| resource        | Đối tượng        |
| action          | Hành động        |
| description     | Mô tả            |
| status          | Active/Inactive  |

#### Tiêu chí nghiệm thu

* Admin xem được danh sách permission theo module.
* Admin gán được permission cho role nếu có quyền.
* User nhận quyền thông qua role được gán.

---

### 13.14 AUTH-FUNC-014: Gán vai trò cho người dùng

#### Mục tiêu

Cho phép Admin gán một hoặc nhiều vai trò cho user.

#### Người dùng

* Super Admin
* Admin công ty
* Người có quyền `AUTH.USER.ASSIGN_ROLE`

#### Luồng chính

1. Admin vào chi tiết user.
2. Chọn tab Vai trò.
3. Hệ thống hiển thị role hiện tại.
4. Admin chọn thêm hoặc bỏ role.
5. Admin bấm Lưu.
6. Hệ thống kiểm tra quyền của Admin.
7. Hệ thống cập nhật role cho user.
8. Hệ thống ghi audit log.

#### Quy tắc

* Một user có thể có nhiều role.
* User cần có ít nhất một role để sử dụng hệ thống.
* Không cho Admin thường gán role Super Admin nếu không có quyền.
* Không cho Admin tự nâng quyền chính mình nếu không có quyền đặc biệt.
* Thay đổi role có hiệu lực ở lần tải lại quyền tiếp theo hoặc đăng nhập lại.

#### Tiêu chí nghiệm thu

* Admin gán role thành công cho user.
* User nhận đúng quyền từ role.
* User mất quyền khi role bị gỡ.
* Hệ thống ghi log thay đổi role.

---

### 13.15 AUTH-FUNC-015: Kiểm tra quyền truy cập menu/màn hình

#### Mục tiêu

Đảm bảo người dùng chỉ nhìn thấy menu và màn hình phù hợp với quyền của mình.

#### Luồng xử lý

1. Người dùng đăng nhập.
2. Frontend lấy danh sách quyền của user.
3. Hệ thống hiển thị menu theo quyền.
4. Nếu user truy cập trực tiếp URL không có quyền, hệ thống chặn.
5. Backend vẫn kiểm tra quyền khi gọi API.

#### Quy tắc

* Ẩn menu không thay thế cho bảo mật backend.
* Mỗi menu/màn hình cần khai báo permission yêu cầu.
* User không có quyền thì không hiển thị menu.
* Nếu truy cập URL trái quyền, hiển thị trang 403 hoặc thông báo không có quyền.

#### Ví dụ

| Màn hình       | Permission yêu cầu    |
| -------------- | --------------------- |
| Danh sách user | AUTH.USER.VIEW        |
| Tạo user       | AUTH.USER.CREATE      |
| Danh sách role | AUTH.ROLE.VIEW        |
| Gán role       | AUTH.USER.ASSIGN_ROLE |

#### Tiêu chí nghiệm thu

* Employee không thấy menu quản lý user.
* Manager không thấy menu role/permission.
* Admin thấy menu quản lý user nếu có quyền.
* Truy cập URL trái quyền bị chặn.

---

### 13.16 AUTH-FUNC-016: Kiểm tra quyền truy cập API

#### Mục tiêu

Đảm bảo mọi API nội bộ đều được kiểm tra xác thực và phân quyền.

#### Luồng xử lý

1. Client gửi request kèm token/session.
2. Backend xác thực token/session.
3. Backend xác định user.
4. Backend kiểm tra permission yêu cầu.
5. Backend kiểm tra data scope nếu API truy cập dữ liệu.
6. Nếu hợp lệ, API xử lý request.
7. Nếu không hợp lệ, API trả lỗi.

#### Response lỗi gợi ý

```json
{
  "success": false,
  "error": {
    "code": "AUTH-ERR-FORBIDDEN",
    "message": "Bạn không có quyền thực hiện thao tác này"
  }
}
```

#### Mã lỗi xác thực & phân quyền

| Mã lỗi (slug)            | Trường hợp              | Thông báo                                 |
| ------------------------ | ----------------------- | ----------------------------------------- |
| AUTH-ERR-UNAUTHENTICATED | Chưa đăng nhập          | Bạn cần đăng nhập để tiếp tục             |
| AUTH-ERR-TOKEN-EXPIRED   | Phiên đăng nhập hết hạn | Phiên đăng nhập đã hết hạn, đăng nhập lại |
| AUTH-ERR-FORBIDDEN       | Không có quyền truy cập | Bạn không có quyền thực hiện thao tác này |

#### Tiêu chí nghiệm thu

* API không có token trả lỗi chưa đăng nhập.
* API có token hết hạn trả lỗi phiên đăng nhập hết hạn.
* API không đủ quyền trả lỗi không có quyền.
* API đủ quyền xử lý thành công.
* Data scope được áp dụng đúng.

---

### 13.17 AUTH-FUNC-017: Ghi log đăng nhập và thao tác quan trọng

#### Mục tiêu

Ghi lại lịch sử thao tác quan trọng trong module AUTH để phục vụ kiểm tra và bảo mật.

#### Hành động cần ghi log

| Hành động                | Mô tả                     |
| ------------------------ | ------------------------- |
| LOGIN_SUCCESS            | Đăng nhập thành công      |
| LOGIN_FAILED             | Đăng nhập thất bại        |
| LOGOUT                   | Đăng xuất                 |
| USER_CREATED             | Tạo user                  |
| USER_UPDATED             | Cập nhật user             |
| USER_LOCKED              | Khóa user                 |
| USER_UNLOCKED            | Mở khóa user              |
| ROLE_CREATED             | Tạo role                  |
| ROLE_UPDATED             | Cập nhật role             |
| ROLE_ASSIGNED            | Gán role cho user         |
| PERMISSION_ASSIGNED      | Gán permission cho role   |
| PASSWORD_CHANGED         | Đổi mật khẩu              |
| PASSWORD_RESET_REQUESTED | Yêu cầu đặt lại mật khẩu  |
| PASSWORD_RESET_COMPLETED | Hoàn tất đặt lại mật khẩu |

#### Thông tin log cần lưu

| Trường      | Mô tả                    |
| ----------- | ------------------------ |
| id          | ID log                   |
| actor_id    | Người thực hiện          |
| action      | Hành động                |
| module      | AUTH                     |
| target_type | User/Role/Permission     |
| target_id   | ID đối tượng bị tác động |
| old_value   | Dữ liệu cũ nếu có        |
| new_value   | Dữ liệu mới nếu có       |
| ip_address  | IP người dùng            |
| user_agent  | Thiết bị/trình duyệt     |
| created_at  | Thời gian thao tác       |

#### Tiêu chí nghiệm thu

* Đăng nhập thành công/thất bại được ghi log.
* Tạo/sửa/khóa user được ghi log.
* Gán role/permission được ghi log.
* Log hiển thị đúng cho người có quyền.

---

## 14. Chi tiết màn hình

### 14.1 AUTH-SCREEN-001: Màn hình đăng nhập

#### Mục đích

Cho phép người dùng đăng nhập vào hệ thống.

#### Thành phần giao diện

* Logo hệ thống
* Tên hệ thống
* Ô nhập email
* Ô nhập mật khẩu
* Nút hiển thị/ẩn mật khẩu
* Checkbox Ghi nhớ đăng nhập nếu cần
* Nút Đăng nhập
* Link Quên mật khẩu
* Thông báo lỗi
* Loading state khi đăng nhập

#### Validate

| Trường   | Rule                           |
| -------- | ------------------------------ |
| Email    | Bắt buộc, đúng định dạng email |
| Mật khẩu | Bắt buộc                       |

#### Điều hướng

| Trường hợp           | Điều hướng                               |
| -------------------- | ---------------------------------------- |
| Đăng nhập thành công | Dashboard phù hợp                        |
| Quên mật khẩu        | AUTH-SCREEN-002                          |
| Sai thông tin        | Ở lại màn hình đăng nhập và hiển thị lỗi |

---

### 14.2 AUTH-SCREEN-002: Màn hình quên mật khẩu

#### Mục đích

Cho phép người dùng chưa đăng nhập gửi yêu cầu đặt lại mật khẩu khi quên mật khẩu.

#### Thành phần giao diện

* Logo hệ thống
* Tiêu đề: Quên mật khẩu
* Mô tả hướng dẫn ngắn
* Ô nhập email
* Nút Gửi yêu cầu
* Link Quay lại đăng nhập
* Thông báo đã gửi hướng dẫn
* Loading state khi gửi yêu cầu

#### Validate

| Trường | Rule                           |
| ------ | ------------------------------ |
| Email  | Bắt buộc, đúng định dạng email |

#### Điều hướng

| Trường hợp             | Điều hướng                          |
| ---------------------- | ----------------------------------- |
| Gửi yêu cầu thành công | Hiển thị thông báo đã gửi hướng dẫn |
| Quay lại đăng nhập     | AUTH-SCREEN-001                     |
| Sai định dạng email    | Ở lại màn hình và hiển thị lỗi      |

---

### 14.3 AUTH-SCREEN-003: Màn hình đặt lại mật khẩu

#### Mục đích

Cho phép người dùng có link/token hợp lệ tạo mật khẩu mới.

#### Thành phần giao diện

* Logo hệ thống
* Tiêu đề: Đặt lại mật khẩu
* Ô nhập mật khẩu mới
* Ô nhập xác nhận mật khẩu mới
* Nút hiển thị/ẩn mật khẩu
* Nút Lưu mật khẩu
* Thông báo lỗi token không hợp lệ/hết hạn
* Loading state khi lưu

#### Validate

| Trường           | Rule                            |
| ---------------- | ------------------------------- |
| new_password     | Bắt buộc, đạt yêu cầu bảo mật   |
| confirm_password | Bắt buộc, khớp với new_password |

#### Trường hợp lỗi

| Mã lỗi (slug)                      | Trường hợp                   | Thông báo                             |
| ---------------------------------- | ---------------------------- | ------------------------------------- |
| AUTH-ERR-RESET-TOKEN-INVALID       | Token không hợp lệ           | Link đặt lại mật khẩu không hợp lệ    |
| AUTH-ERR-RESET-TOKEN-EXPIRED       | Token hết hạn                | Link đặt lại mật khẩu đã hết hạn      |
| AUTH-ERR-PASSWORD-CONFIRM-MISMATCH | Mật khẩu xác nhận không khớp | Mật khẩu xác nhận không khớp          |
| AUTH-ERR-PASSWORD-POLICY           | Mật khẩu không đạt yêu cầu   | Mật khẩu chưa đáp ứng yêu cầu bảo mật |

#### Điều hướng

| Trường hợp                  | Điều hướng                          |
| --------------------------- | ----------------------------------- |
| Đặt lại mật khẩu thành công | AUTH-SCREEN-001                     |
| Token không hợp lệ/hết hạn  | Hiển thị lỗi, gợi ý gửi lại yêu cầu |

---

### 14.4 AUTH-SCREEN-004: Màn hình đổi mật khẩu

#### Mục đích

Cho phép người dùng đã đăng nhập đổi mật khẩu cá nhân.

#### Thành phần giao diện

* Tiêu đề: Đổi mật khẩu
* Ô nhập mật khẩu hiện tại
* Ô nhập mật khẩu mới
* Ô nhập xác nhận mật khẩu mới
* Nút hiển thị/ẩn mật khẩu
* Nút Lưu
* Nút Hủy
* Thông báo lỗi và thành công

#### Validate

| Trường           | Rule                            |
| ---------------- | ------------------------------- |
| current_password | Bắt buộc                        |
| new_password     | Bắt buộc, đạt yêu cầu bảo mật   |
| confirm_password | Bắt buộc, khớp với new_password |

#### Hành động

| Hành động    | Permission           |
| ------------ | -------------------- |
| Đổi mật khẩu | AUTH.PASSWORD.CHANGE |

#### Điều hướng

| Trường hợp              | Điều hướng                       |
| ----------------------- | -------------------------------- |
| Đổi mật khẩu thành công | Hiển thị thông báo thành công    |
| Sai mật khẩu hiện tại   | Ở lại màn hình và hiển thị lỗi   |
| Hủy                     | Quay lại hồ sơ tài khoản cá nhân |

---

### 14.5 AUTH-SCREEN-005: Hồ sơ tài khoản cá nhân

#### Mục đích

Cho phép người dùng đã đăng nhập xem và cập nhật thông tin tài khoản cá nhân.

#### Thành phần giao diện

* Avatar và nút đổi ảnh đại diện
* Họ tên
* Email đăng nhập
* Số điện thoại
* Danh sách vai trò
* Phòng ban, chức vụ nếu liên kết employee
* Trạng thái tài khoản
* Lần đăng nhập gần nhất
* Nút Đổi mật khẩu
* Nút Lưu thay đổi

#### Trường hiển thị

| Trường                 | Cho phép sửa | Mô tả                     |
| ---------------------- | ------------ | ------------------------- |
| Avatar                 | Có           | Ảnh đại diện              |
| Họ tên                 | Không        | Lấy từ user hoặc employee |
| Email                  | Không        | Email đăng nhập           |
| Số điện thoại          | Có           | Số điện thoại cá nhân     |
| Vai trò                | Không        | Danh sách vai trò         |
| Phòng ban              | Không        | Nếu liên kết employee     |
| Chức vụ                | Không        | Nếu liên kết employee     |
| Trạng thái tài khoản   | Không        | Active/Locked/Inactive    |
| Lần đăng nhập gần nhất | Không        | Nếu có lưu                |

#### Hành động

| Hành động         | Permission           |
| ----------------- | -------------------- |
| Xem hồ sơ cá nhân | AUTH.PROFILE.VIEW    |
| Cập nhật hồ sơ    | AUTH.PROFILE.UPDATE  |
| Đổi mật khẩu      | AUTH.PASSWORD.CHANGE |

#### Điều hướng

| Trường hợp   | Điều hướng      |
| ------------ | --------------- |
| Đổi mật khẩu | AUTH-SCREEN-004 |

---

### 14.6 AUTH-SCREEN-006: Danh sách người dùng

#### Mục đích

Cho phép Admin quản lý danh sách tài khoản.

#### Thành phần giao diện

* Tiêu đề: Người dùng
* Nút Tạo người dùng
* Ô tìm kiếm
* Bộ lọc vai trò
* Bộ lọc trạng thái
* Bộ lọc phòng ban
* Bảng danh sách user
* Phân trang
* Menu hành động từng dòng

#### Cột dữ liệu

| Cột                    | Mô tả                 |
| ---------------------- | --------------------- |
| Họ tên                 | Tên user              |
| Email                  | Email đăng nhập       |
| Vai trò                | Danh sách role        |
| Phòng ban              | Nếu có employee       |
| Trạng thái             | Active/Locked/Pending |
| Lần đăng nhập gần nhất | Thời gian             |
| Ngày tạo               | Thời gian tạo         |
| Hành động              | Xem/Sửa/Khóa/Gán role |

#### Hành động

| Hành động     | Permission            |
| ------------- | --------------------- |
| Xem danh sách | AUTH.USER.VIEW        |
| Tạo user      | AUTH.USER.CREATE      |
| Sửa user      | AUTH.USER.UPDATE      |
| Khóa user     | AUTH.USER.LOCK        |
| Mở khóa user  | AUTH.USER.UNLOCK      |
| Gán role      | AUTH.USER.ASSIGN_ROLE |

---

### 14.7 AUTH-SCREEN-007: Tạo người dùng

#### Mục đích

Cho phép người có quyền tạo tài khoản đăng nhập mới.

#### Thành phần giao diện

* Tiêu đề: Tạo người dùng
* Ô nhập họ tên
* Ô nhập email
* Ô nhập số điện thoại
* Chọn liên kết hồ sơ nhân viên
* Chọn vai trò (nhiều vai trò)
* Chọn trạng thái khởi tạo
* Tùy chọn mật khẩu tạm thời/gửi link kích hoạt
* Nút Lưu
* Nút Hủy
* Thông báo lỗi

#### Trường hiển thị

| Trường             | Bắt buộc | Ghi chú                                 |
| ------------------ | -------- | --------------------------------------- |
| full_name          | Có       | Họ tên người dùng                       |
| email              | Có       | Không được trùng                        |
| phone              | Không    | Số điện thoại                           |
| employee_id        | Không    | Liên kết hồ sơ nhân viên                |
| roles              | Có       | Ít nhất một vai trò                     |
| status             | Có       | Mặc định Pending Activation hoặc Active |
| temporary_password | Có/Không | Tùy cấu hình tạo mật khẩu               |

#### Validate

| Trường    | Rule                                  |
| --------- | ------------------------------------- |
| full_name | Bắt buộc                              |
| email     | Bắt buộc, đúng định dạng, không trùng |
| roles     | Bắt buộc, ít nhất một vai trò         |

#### Trường hợp lỗi

| Mã lỗi (slug)             | Trường hợp               | Thông báo                                         |
| ------------------------- | ------------------------ | ------------------------------------------------- |
| AUTH-ERR-EMAIL-EXISTS     | Email đã tồn tại         | Email này đã được sử dụng                         |
| AUTH-ERR-ROLE-REQUIRED    | Chưa chọn role           | Vui lòng chọn ít nhất một vai trò                 |
| AUTH-ERR-EMPLOYEE-LINKED  | Employee đã có tài khoản | Nhân viên này đã được liên kết với tài khoản khác |
| AUTH-ERR-FORBIDDEN        | Không có quyền tạo user  | Bạn không có quyền tạo tài khoản                  |

#### Hành động

| Hành động | Permission       |
| --------- | ---------------- |
| Tạo user  | AUTH.USER.CREATE |

#### Điều hướng

| Trường hợp           | Điều hướng                     |
| -------------------- | ------------------------------ |
| Tạo thành công       | AUTH-SCREEN-006                |
| Hủy                  | AUTH-SCREEN-006                |
| Dữ liệu không hợp lệ | Ở lại màn hình và hiển thị lỗi |

---

### 14.8 AUTH-SCREEN-008: Chi tiết người dùng

#### Mục đích

Cho phép Admin xem thông tin chi tiết của một tài khoản người dùng.

#### Thành phần giao diện

* Tiêu đề: Chi tiết người dùng
* Khối thông tin cơ bản
* Khối vai trò được gán
* Khối trạng thái tài khoản
* Khối thông tin liên kết employee
* Lịch sử đăng nhập gần nhất nếu có
* Nút Chỉnh sửa
* Nút Khóa/Mở khóa
* Nút Gán vai trò

#### Trường hiển thị

| Trường                 | Mô tả                          |
| ---------------------- | ------------------------------ |
| Họ tên                 | Tên user                       |
| Email                  | Email đăng nhập                |
| Số điện thoại          | Nếu có                         |
| Vai trò                | Danh sách vai trò              |
| Phòng ban              | Nếu liên kết employee          |
| Chức vụ                | Nếu liên kết employee          |
| Trạng thái             | Active/Locked/Inactive/Pending |
| Lần đăng nhập gần nhất | Nếu có lưu                     |
| Ngày tạo               | Thời gian tạo user             |

#### Hành động

| Hành động    | Permission            |
| ------------ | --------------------- |
| Xem chi tiết | AUTH.USER.VIEW        |
| Chỉnh sửa    | AUTH.USER.UPDATE      |
| Khóa user    | AUTH.USER.LOCK        |
| Mở khóa user | AUTH.USER.UNLOCK      |
| Gán vai trò  | AUTH.USER.ASSIGN_ROLE |

#### Điều hướng

| Trường hợp     | Điều hướng      |
| -------------- | --------------- |
| Chỉnh sửa user | AUTH-SCREEN-009 |
| Gán vai trò    | AUTH-SCREEN-013 |
| Quay lại       | AUTH-SCREEN-006 |

---

### 14.9 AUTH-SCREEN-009: Chỉnh sửa người dùng

#### Mục đích

Cho phép Admin cập nhật thông tin tài khoản người dùng.

#### Thành phần giao diện

* Tiêu đề: Chỉnh sửa người dùng
* Ô nhập họ tên
* Ô nhập số điện thoại
* Ô đổi avatar
* Chọn liên kết hồ sơ nhân viên
* Email (có thể chỉ đọc tùy cấu hình)
* Nút Lưu
* Nút Hủy
* Thông báo lỗi

#### Trường hiển thị

| Trường            | Cho phép sửa                              |
| ----------------- | ----------------------------------------- |
| Họ tên            | Có                                        |
| Số điện thoại     | Có                                        |
| Avatar            | Có                                        |
| Liên kết employee | Có, nếu có quyền                          |
| Vai trò           | Qua AUTH-SCREEN-013                       |
| Trạng thái        | Qua chức năng khóa/mở khóa                |
| Email             | Có thể cho phép hoặc hạn chế tùy cấu hình |

#### Validate

| Trường    | Rule                                    |
| --------- | --------------------------------------- |
| full_name | Bắt buộc                                |
| email     | Đúng định dạng, không trùng nếu cho sửa |

#### Trường hợp lỗi

| Mã lỗi (slug)         | Trường hợp                   | Thông báo                             |
| --------------------- | ---------------------------- | ------------------------------------- |
| AUTH-ERR-EMAIL-EXISTS | Email đã tồn tại             | Email này đã được sử dụng             |
| AUTH-ERR-FORBIDDEN    | Không có quyền cập nhật user | Bạn không có quyền cập nhật tài khoản |

#### Hành động

| Hành động     | Permission       |
| ------------- | ---------------- |
| Cập nhật user | AUTH.USER.UPDATE |

#### Điều hướng

| Trường hợp           | Điều hướng                     |
| -------------------- | ------------------------------ |
| Cập nhật thành công  | AUTH-SCREEN-008                |
| Hủy                  | AUTH-SCREEN-008                |
| Dữ liệu không hợp lệ | Ở lại màn hình và hiển thị lỗi |

---

### 14.10 AUTH-SCREEN-010: Danh sách vai trò

#### Mục đích

Cho phép Admin xem và quản lý các vai trò hệ thống.

#### Thành phần giao diện

* Tiêu đề: Vai trò
* Nút Tạo vai trò
* Tìm kiếm role
* Bảng role
* Trạng thái role
* Số lượng user đang dùng role
* Hành động sửa/gán quyền/vô hiệu hóa

#### Cột dữ liệu

| Cột                 | Mô tả                      |
| ------------------- | -------------------------- |
| Tên vai trò         | Ví dụ: HR                  |
| Mã vai trò          | Ví dụ: HR                  |
| Mô tả               | Mô tả quyền hạn            |
| Data scope mặc định | Own/Team/Department/Project/Company/System (6 scope chuẩn — xem §7.5; `Project` chỉ TASK) |
| Số user             | Số user đang được gán role |
| Trạng thái          | Active/Inactive            |
| Hành động           | Sửa/Gán quyền/Vô hiệu hóa  |

---

### 14.11 AUTH-SCREEN-011: Tạo/chỉnh sửa vai trò

#### Mục đích

Cho phép Admin tạo mới hoặc chỉnh sửa thông tin một vai trò.

#### Thành phần giao diện

* Tiêu đề: Tạo/Chỉnh sửa vai trò
* Ô nhập tên vai trò
* Ô nhập mã vai trò
* Ô nhập mô tả
* Chọn data scope mặc định
* Chọn trạng thái Active/Inactive
* Nút Lưu
* Nút Hủy
* Thông báo lỗi

#### Trường hiển thị

| Trường      | Bắt buộc | Mô tả                    |
| ----------- | -------- | ------------------------ |
| role_name   | Có       | Tên vai trò              |
| role_code   | Có       | Mã vai trò, không trùng  |
| description | Không    | Mô tả vai trò            |
| data_scope  | Có       | Phạm vi dữ liệu mặc định |
| status      | Có       | Active/Inactive          |

#### Validate

| Trường    | Rule                       |
| --------- | -------------------------- |
| role_name | Bắt buộc                   |
| role_code | Bắt buộc, không được trùng |

#### Hành động

| Hành động        | Permission       |
| ---------------- | ---------------- |
| Tạo vai trò      | AUTH.ROLE.CREATE |
| Cập nhật vai trò | AUTH.ROLE.UPDATE |

#### Điều hướng

| Trường hợp            | Điều hướng                     |
| --------------------- | ------------------------------ |
| Lưu thành công        | AUTH-SCREEN-010                |
| Gán quyền cho vai trò | AUTH-SCREEN-012                |
| Hủy                   | AUTH-SCREEN-010                |
| role_code bị trùng    | Ở lại màn hình và hiển thị lỗi |

---

### 14.12 AUTH-SCREEN-012: Gán quyền cho vai trò

#### Mục đích

Cho phép Admin gán hoặc gỡ các quyền (permission) cho một vai trò.

#### Thành phần giao diện

* Tiêu đề: Gán quyền cho vai trò
* Tên vai trò đang chỉnh
* Ô tìm kiếm quyền
* Bộ lọc theo module
* Danh sách quyền dạng cây/nhóm theo module
* Checkbox chọn quyền
* Nút Lưu
* Nút Hủy

#### Cột dữ liệu

| Cột             | Mô tả              |
| --------------- | ------------------ |
| Chọn            | Checkbox gán quyền |
| Module          | Module của quyền   |
| permission_code | Mã quyền           |
| permission_name | Tên quyền          |
| Mô tả           | Mô tả quyền        |

#### Hành động

| Hành động      | Permission             |
| -------------- | ---------------------- |
| Xem permission | AUTH.PERMISSION.VIEW   |
| Gán permission | AUTH.PERMISSION.ASSIGN |

#### Điều hướng

| Trường hợp     | Điều hướng      |
| -------------- | --------------- |
| Lưu thành công | AUTH-SCREEN-010 |
| Hủy            | AUTH-SCREEN-010 |

---

### 14.13 AUTH-SCREEN-013: Gán vai trò cho người dùng

#### Mục đích

Cho phép Admin gán một hoặc nhiều vai trò cho một tài khoản người dùng.

#### Thành phần giao diện

* Tiêu đề: Gán vai trò
* Thông tin user đang chỉnh
* Danh sách vai trò hiện tại
* Ô tìm kiếm vai trò
* Danh sách vai trò có thể gán
* Checkbox chọn vai trò
* Nút Lưu
* Nút Hủy

#### Cột dữ liệu

| Cột         | Mô tả                    |
| ----------- | ------------------------ |
| Chọn        | Checkbox gán vai trò     |
| Tên vai trò | Tên role                 |
| Mã vai trò  | role_code                |
| Data scope  | Phạm vi dữ liệu mặc định |
| Trạng thái  | Active/Inactive          |

#### Hành động

| Hành động   | Permission            |
| ----------- | --------------------- |
| Gán vai trò | AUTH.USER.ASSIGN_ROLE |

#### Điều hướng

| Trường hợp     | Điều hướng      |
| -------------- | --------------- |
| Lưu thành công | AUTH-SCREEN-008 |
| Hủy            | AUTH-SCREEN-008 |

---

### 14.14 AUTH-SCREEN-014: Nhật ký hoạt động AUTH

#### Mục đích

Cho phép người có quyền xem nhật ký (audit log) các thao tác quan trọng trong module AUTH.

#### Thành phần giao diện

* Tiêu đề: Nhật ký hoạt động
* Ô tìm kiếm
* Bộ lọc theo hành động
* Bộ lọc theo người thực hiện
* Bộ lọc theo khoảng thời gian
* Bảng nhật ký
* Phân trang
* Nút xem chi tiết bản ghi

#### Cột dữ liệu

| Cột             | Mô tả                          |
| --------------- | ------------------------------ |
| Thời gian       | created_at                     |
| Người thực hiện | actor_id                       |
| Hành động       | LOGIN_SUCCESS, USER_CREATED... |
| Đối tượng       | target_type/target_id          |
| IP              | ip_address                     |
| Thiết bị        | user_agent                     |

#### Hành động

| Hành động   | Permission          |
| ----------- | ------------------- |
| Xem nhật ký | AUTH.AUDIT_LOG.VIEW |

#### Điều hướng

| Trường hợp       | Điều hướng                        |
| ---------------- | --------------------------------- |
| Xem chi tiết log | Mở modal chi tiết bản ghi         |
| Không có quyền   | Hiển thị thông báo (AUTH-ERR-FORBIDDEN) |

---

## 15. Dữ liệu cần lưu

### 15.1 Bảng users

| Trường        | Kiểu dữ liệu | Bắt buộc | Ghi chú                        |
| ------------- | ------------ | -------- | ------------------------------ |
| id            | UUID/Integer | Có       | ID user                        |
| employee_id   | UUID/Integer | Không    | Liên kết employee              |
| full_name     | String       | Có       | Họ tên                         |
| email         | String       | Có       | Unique                         |
| phone         | String       | Không    | Số điện thoại                  |
| password_hash | String       | Có       | Mật khẩu đã mã hóa             |
| avatar_url    | String       | Không    | Ảnh đại diện                   |
| status        | String       | Có       | Active/Locked/Inactive/Pending |
| last_login_at | DateTime     | Không    | Lần đăng nhập gần nhất         |
| created_at    | DateTime     | Có       | Thời gian tạo                  |
| updated_at    | DateTime     | Có       | Thời gian cập nhật             |
| deleted_at    | DateTime     | Không    | Xóa mềm                        |
| created_by    | ID           | Không    | Người tạo                      |
| updated_by    | ID           | Không    | Người cập nhật                 |

---

### 15.2 Bảng roles

| Trường             | Kiểu dữ liệu | Bắt buộc | Ghi chú                            |
| ------------------ | ------------ | -------- | ---------------------------------- |
| id                 | UUID/Integer | Có       | ID role                            |
| role_code          | String       | Có       | Unique                             |
| role_name          | String       | Có       | Tên role                           |
| description        | Text         | Không    | Mô tả                              |
| default_data_scope | String       | Có       | Own/Team/Department/Project/Company/System (6 scope chuẩn — xem §7.5) |
| is_system_role     | Boolean      | Có       | Role mặc định hệ thống             |
| status             | String       | Có       | Active/Inactive                    |
| created_at         | DateTime     | Có       |                                    |
| updated_at         | DateTime     | Có       |                                    |
| deleted_at         | DateTime     | Không    |                                    |

---

### 15.3 Bảng permissions

| Trường          | Kiểu dữ liệu | Bắt buộc | Ghi chú                   |
| --------------- | ------------ | -------- | ------------------------- |
| id              | UUID/Integer | Có       | ID permission             |
| permission_code | String       | Có       | Unique                    |
| permission_name | String       | Có       | Tên quyền                 |
| module_code     | String       | Có       | AUTH/HR/ATT/...           |
| resource        | String       | Có       | USER/ROLE/PERMISSION      |
| action          | String       | Có       | VIEW/CREATE/UPDATE/DELETE |
| description     | Text         | Không    | Mô tả                     |
| status          | String       | Có       | Active/Inactive           |

---

### 15.4 Bảng user_roles

| Trường      | Kiểu dữ liệu | Bắt buộc | Ghi chú       |
| ----------- | ------------ | -------- | ------------- |
| id          | UUID/Integer | Có       |               |
| user_id     | ID           | Có       | User          |
| role_id     | ID           | Có       | Role          |
| assigned_by | ID           | Không    | Người gán     |
| assigned_at | DateTime     | Có       | Thời gian gán |

---

### 15.5 Bảng role_permissions

| Trường        | Kiểu dữ liệu | Bắt buộc | Ghi chú                |
| ------------- | ------------ | -------- | ---------------------- |
| id            | UUID/Integer | Có       |                        |
| role_id       | ID           | Có       | Role                   |
| permission_id | ID           | Có       | Permission             |
| data_scope    | String       | Không    | Override scope nếu cần |
| assigned_by   | ID           | Không    | Người gán              |
| assigned_at   | DateTime     | Có       | Thời gian gán          |

---

### 15.6 Bảng password_reset_tokens

| Trường     | Kiểu dữ liệu | Bắt buộc | Ghi chú                               |
| ---------- | ------------ | -------- | ------------------------------------- |
| id         | UUID/Integer | Có       |                                       |
| user_id    | ID           | Có       | User                                  |
| token_hash | String       | Có       | Không lưu token plain text nếu có thể |
| expired_at | DateTime     | Có       | Thời gian hết hạn                     |
| used_at    | DateTime     | Không    | Thời gian đã sử dụng                  |
| created_at | DateTime     | Có       |                                       |

---

### 15.7 Bảng audit_logs

| Trường      | Kiểu dữ liệu | Bắt buộc | Ghi chú                        |
| ----------- | ------------ | -------- | ------------------------------ |
| id          | UUID/Integer | Có       | ID log                         |
| actor_id    | ID           | Không    | Người thao tác                 |
| action      | String       | Có       | LOGIN_SUCCESS, USER_CREATED... |
| module_code | String       | Có       | AUTH                           |
| target_type | String       | Không    | User/Role/Permission           |
| target_id   | ID           | Không    | ID đối tượng                   |
| old_value   | JSON         | Không    | Dữ liệu trước                  |
| new_value   | JSON         | Không    | Dữ liệu sau                    |
| ip_address  | String       | Không    | IP                             |
| user_agent  | String       | Không    | Trình duyệt/thiết bị           |
| created_at  | DateTime     | Có       | Thời gian                      |

---

## 16. API sơ bộ

> **Drift reconciliation 22/06 (theo SPEC-DRIFT-MATRIX §1, AU-10):** prefix chuẩn = **`/api/v1/...`** và toàn bộ user/role/permission **gộp dưới `/auth`** (khớp [API-02](<../API Design/API-02 AUTH API Design.md>)). Các path cũ `/api/auth/...`, `/api/users`, `/api/roles` (thiếu `/v1`, tách rời) **không còn dùng**. API-02 còn bổ sung `refresh`, `logout-all`, `me/sessions` (self-service, gate `Authenticated`) — chi tiết & TTL token xem [API-01 §3.5](<../API Design/API-01 TỔNG QUAN.md>) và §21 bên dưới.

### 16.1 Authentication API

| Mã API       | Method | Endpoint                     | Mục đích                    | Permission           |
| ------------ | ------ | ---------------------------- | --------------------------- | -------------------- |
| AUTH-API-001 | POST   | /api/v1/auth/login           | Đăng nhập                   | Public               |
| AUTH-API-002 | POST   | /api/v1/auth/logout          | Đăng xuất                   | Authenticated        |
| AUTH-API-003 | POST   | /api/v1/auth/forgot-password | Quên mật khẩu               | Public               |
| AUTH-API-004 | POST   | /api/v1/auth/reset-password  | Đặt lại mật khẩu            | Public with token    |
| AUTH-API-005 | POST   | /api/v1/auth/change-password | Đổi mật khẩu                | AUTH.PASSWORD.CHANGE |
| AUTH-API-006 | GET    | /api/v1/auth/me              | Lấy thông tin user hiện tại | Authenticated        |
| AUTH-API-007 | GET    | /api/v1/auth/me/permissions  | Lấy quyền user hiện tại     | Authenticated        |
| AUTH-API-008 | POST   | /api/v1/auth/refresh         | Làm mới access token        | Public with refresh token |
| AUTH-API-009 | POST   | /api/v1/auth/logout-all      | Đăng xuất mọi phiên         | Authenticated        |
| AUTH-API-010 | GET    | /api/v1/auth/me/sessions     | Liệt kê phiên của chính mình | Authenticated       |

---

### 16.2 User API

| Mã API       | Method | Endpoint                       | Mục đích           | Permission            |
| ------------ | ------ | ------------------------------ | ------------------ | --------------------- |
| AUTH-API-101 | GET    | /api/v1/auth/users             | Lấy danh sách user | AUTH.USER.VIEW        |
| AUTH-API-102 | GET    | /api/v1/auth/users/{id}        | Lấy chi tiết user  | AUTH.USER.VIEW        |
| AUTH-API-103 | POST   | /api/v1/auth/users             | Tạo user           | AUTH.USER.CREATE      |
| AUTH-API-104 | PUT    | /api/v1/auth/users/{id}        | Cập nhật user      | AUTH.USER.UPDATE      |
| AUTH-API-105 | POST   | /api/v1/auth/users/{id}/lock   | Khóa user          | AUTH.USER.LOCK        |
| AUTH-API-106 | POST   | /api/v1/auth/users/{id}/unlock | Mở khóa user       | AUTH.USER.UNLOCK      |
| AUTH-API-107 | PUT    | /api/v1/auth/users/{id}/roles  | Gán role cho user  | AUTH.USER.ASSIGN_ROLE |
| AUTH-API-108 | DELETE | /api/v1/auth/users/{id}        | Xóa mềm user (soft-delete) | AUTH.USER.DELETE |

> **AU-11:** `DELETE /api/v1/auth/users/{id}` chỉ thực hiện **xóa mềm** (set `deleted_at`/`status=Deleted`), KHÔNG hard-delete (BẤT BIẾN #2). Quyền `AUTH.USER.DELETE` (is_sensitive) — xem §8.1.

---

### 16.3 Role & Permission API

| Mã API       | Method | Endpoint                            | Mục đích                 | Permission             |
| ------------ | ------ | ----------------------------------- | ------------------------ | ---------------------- |
| AUTH-API-201 | GET    | /api/v1/auth/roles                  | Lấy danh sách role       | AUTH.ROLE.VIEW         |
| AUTH-API-202 | GET    | /api/v1/auth/roles/{id}             | Lấy chi tiết role        | AUTH.ROLE.VIEW         |
| AUTH-API-203 | POST   | /api/v1/auth/roles                  | Tạo role                 | AUTH.ROLE.CREATE       |
| AUTH-API-204 | PUT    | /api/v1/auth/roles/{id}             | Cập nhật role            | AUTH.ROLE.UPDATE       |
| AUTH-API-205 | DELETE | /api/v1/auth/roles/{id}             | Vô hiệu hóa role         | AUTH.ROLE.DELETE       |
| AUTH-API-206 | PUT    | /api/v1/auth/roles/{id}/permissions | Gán quyền cho role       | AUTH.PERMISSION.ASSIGN |
| AUTH-API-207 | GET    | /api/v1/auth/permissions            | Lấy danh sách permission | AUTH.PERMISSION.VIEW   |

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
    "code": "AUTH-ERR-INVALID-CREDENTIALS",
    "message": "Email hoặc mật khẩu không đúng"
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

### 18.1 Quy tắc tài khoản

1. Email user không được trùng.
2. Một user có thể có nhiều role.
3. Một employee chỉ nên liên kết với một user chính.
4. User phải có ít nhất một role để sử dụng hệ thống.
5. User bị Locked không thể đăng nhập.
6. User bị Inactive không thể đăng nhập.
7. User bị Deleted không hiển thị trong danh sách mặc định.
8. Không xóa cứng user trong MVP, chỉ xóa mềm hoặc khóa.
9. Không cho Admin tự xóa hoặc tự khóa chính mình nếu không có user admin khác.
10. Không cho user thường tự chỉnh role của mình.

---

### 18.2 Quy tắc mật khẩu

Trong MVP, mật khẩu nên có rule tối thiểu:

* Tối thiểu 8 ký tự.
* Nên có chữ và số.
* Không lưu mật khẩu dạng plain text — hash bằng **`argon2id`** (tham số ở §21.1, AU-6).
* Khi reset password, token phải có thời hạn.
* Token reset password chỉ dùng một lần.

Có thể mở rộng sau:

* Bắt buộc chữ hoa, chữ thường, số, ký tự đặc biệt.
* Không cho dùng lại mật khẩu cũ.
* Hết hạn mật khẩu sau một khoảng thời gian.
* Khóa tài khoản sau nhiều lần đăng nhập sai.

---

### 18.3 Quy tắc role

1. Role mặc định không được xóa cứng.
2. Role đang được gán cho user không được xóa cứng.
3. Role inactive không nên gán mới cho user.
4. role_code là duy nhất.
5. Một role có thể có nhiều permission.
6. Một permission có thể thuộc nhiều role.
7. Role có thể có data scope mặc định.

---

### 18.4 Quy tắc phân quyền

1. Backend luôn kiểm tra quyền trước khi xử lý API.
2. Frontend chỉ dùng quyền để ẩn/hiện menu và button.
3. Không được tin tưởng dữ liệu quyền chỉ từ frontend.
4. Mỗi API cần khai báo permission yêu cầu.
5. Mỗi màn hình cần khai báo permission yêu cầu.
6. Với dữ liệu theo phạm vi, cần kiểm tra data scope.
7. Quyền lương, dữ liệu cá nhân nhạy cảm, export dữ liệu cần tách riêng.

---

## 19. Ma trận phân quyền MVP cho module AUTH

| Chức năng            | Super Admin | Admin công ty   | HR                       | Manager | Employee |
| -------------------- | ----------- | --------------- | ------------------------ | ------- | -------- |
| Đăng nhập            | Có          | Có              | Có                       | Có      | Có       |
| Đăng xuất            | Có          | Có              | Có                       | Có      | Có       |
| Đổi mật khẩu cá nhân | Có          | Có              | Có                       | Có      | Có       |
| Xem hồ sơ cá nhân    | Có          | Có              | Có                       | Có      | Có       |
| Xem danh sách user   | Có          | Có              | Không mặc định           | Không   | Không    |
| Tạo user             | Có          | Có              | Có nếu được cấp          | Không   | Không    |
| Cập nhật user        | Có          | Có              | Có giới hạn nếu được cấp | Không   | Không    |
| Khóa user            | Có          | Có              | Không mặc định           | Không   | Không    |
| Mở khóa user         | Có          | Có              | Không mặc định           | Không   | Không    |
| Xem role             | Có          | Có              | Không                    | Không   | Không    |
| Tạo role             | Có          | Có giới hạn     | Không                    | Không   | Không    |
| Cập nhật role        | Có          | Có giới hạn     | Không                    | Không   | Không    |
| Gán role cho user    | Có          | Có              | Không mặc định           | Không   | Không    |
| Xem permission       | Có          | Có              | Không                    | Không   | Không    |
| Gán permission       | Có          | Có giới hạn     | Không                    | Không   | Không    |
| Xem audit log AUTH   | Có          | Có nếu được cấp | Không                    | Không   | Không    |

---

## 20. Notification liên quan

| Mã sự kiện    | Sự kiện                | Người nhận | Nội dung                          |
| ------------- | ---------------------- | ---------- | --------------------------------- |
| AUTH-NOTI-001 | Tài khoản được tạo     | User mới   | Tài khoản của bạn đã được tạo     |
| AUTH-NOTI-002 | Mật khẩu được đổi      | User       | Mật khẩu của bạn đã được thay đổi |
| AUTH-NOTI-003 | Tài khoản bị khóa      | User/Admin | Tài khoản đã bị khóa              |
| AUTH-NOTI-004 | Tài khoản được mở khóa | User       | Tài khoản của bạn đã được mở khóa |
| AUTH-NOTI-005 | Vai trò được thay đổi  | User       | Vai trò của bạn đã được cập nhật  |

Trong MVP, các notification này có thể chỉ ghi nhận dạng in-app hoặc audit log. Email notification có thể triển khai sau.

---

## 20a. Hệ mã lỗi AUTH (canonical = slug)

> <!-- sửa theo DRIFT AU-4 --> Hệ mã lỗi AUTH **chuẩn = slug** (`AUTH-ERR-<SLUG>`), khớp [API-02 §14](<../API Design/API-02 AUTH API Design.md>) và backend. Bộ mã số cũ `AUTH-ERR-001..017` **không còn dùng** — các bảng lỗi ở trên đã chuyển sang slug. Mã `AUTH-ERR-403` (còn sót ở vài response mẫu trong API-02/API-10) **bị bỏ**, dùng `AUTH-ERR-FORBIDDEN` (HTTP 403) thay thế.

### 20a.1 Bảng mã lỗi canonical

| HTTP | Code (slug)                        | Thông báo                                        |
| ---: | ---------------------------------- | ------------------------------------------------ |
|  400 | AUTH-ERR-EMAIL-REQUIRED            | Vui lòng nhập email                              |
|  400 | AUTH-ERR-PASSWORD-REQUIRED         | Vui lòng nhập mật khẩu                           |
|  400 | AUTH-ERR-INVALID-EMAIL-FORMAT      | Email không đúng định dạng                       |
|  400 | AUTH-ERR-PASSWORD-CONFIRM-MISMATCH | Mật khẩu xác nhận không khớp                     |
|  400 | AUTH-ERR-PASSWORD-POLICY           | Mật khẩu chưa đáp ứng yêu cầu bảo mật            |
|  401 | AUTH-ERR-INVALID-CREDENTIALS       | Email hoặc mật khẩu không đúng                   |
|  401 | AUTH-ERR-UNAUTHENTICATED           | Bạn cần đăng nhập để tiếp tục                    |
|  401 | AUTH-ERR-TOKEN-EXPIRED             | Phiên đăng nhập đã hết hạn                       |
|  401 | AUTH-ERR-REFRESH-TOKEN-INVALID     | Refresh token không hợp lệ                       |
|  401 | AUTH-ERR-RESET-TOKEN-INVALID       | Link đặt lại mật khẩu không hợp lệ               |
|  401 | AUTH-ERR-RESET-TOKEN-EXPIRED       | Link đặt lại mật khẩu đã hết hạn                 |
|  403 | AUTH-ERR-FORBIDDEN                 | Bạn không có quyền thực hiện thao tác này        |
|  403 | AUTH-ERR-USER-LOCKED               | Tài khoản của bạn đã bị khóa                     |
|  403 | AUTH-ERR-USER-INACTIVE             | Tài khoản không hoạt động                        |
|  403 | AUTH-ERR-USER-SUSPENDED            | Tài khoản đang bị tạm ngưng (xem §10)            |
|  403 | AUTH-ERR-COMPANY-INACTIVE          | Công ty không hoạt động                          |
|  403 | AUTH-ERR-SCOPE-DENIED              | Dữ liệu không thuộc phạm vi được phép            |
|  404 | AUTH-ERR-USER-NOT-FOUND            | Không tìm thấy user                              |
|  404 | AUTH-ERR-ROLE-NOT-FOUND            | Không tìm thấy role                              |
|  404 | AUTH-ERR-PERMISSION-NOT-FOUND      | Không tìm thấy permission                        |
|  409 | AUTH-ERR-EMAIL-EXISTS              | Email đã tồn tại                                 |
|  409 | AUTH-ERR-ROLE-CODE-EXISTS          | Mã role đã tồn tại                               |
|  409 | AUTH-ERR-ROLE-IN-USE               | Role đang được sử dụng                           |
|  429 | AUTH-ERR-TOO-MANY-ATTEMPTS         | Bạn thao tác quá nhiều lần, vui lòng thử lại sau |

> Hai slug `AUTH-ERR-ROLE-REQUIRED` (chưa chọn role khi tạo user) và `AUTH-ERR-EMPLOYEE-LINKED` (employee đã liên kết tài khoản) dùng trong §13.8/§14.7 hiện **chưa có** trong API-02 §14 — cần bổ sung vào API-02 ở pass API (đề xuất HTTP 400 / 409 tương ứng).

### 20a.2 Ánh xạ mã số cũ → slug

| Mã số cũ (bỏ) | Slug canonical                     |
| ------------- | ---------------------------------- |
| AUTH-ERR-001  | AUTH-ERR-INVALID-CREDENTIALS       |
| AUTH-ERR-002  | AUTH-ERR-USER-LOCKED               |
| AUTH-ERR-003  | AUTH-ERR-USER-INACTIVE             |
| AUTH-ERR-004  | AUTH-ERR-EMAIL-REQUIRED            |
| AUTH-ERR-005  | AUTH-ERR-PASSWORD-REQUIRED         |
| AUTH-ERR-006  | AUTH-ERR-INVALID-EMAIL-FORMAT      |
| AUTH-ERR-007  | AUTH-ERR-RESET-TOKEN-INVALID       |
| AUTH-ERR-008  | AUTH-ERR-RESET-TOKEN-EXPIRED       |
| AUTH-ERR-009  | AUTH-ERR-PASSWORD-CONFIRM-MISMATCH |
| AUTH-ERR-010  | AUTH-ERR-PASSWORD-POLICY           |
| AUTH-ERR-011  | AUTH-ERR-EMAIL-EXISTS              |
| AUTH-ERR-012  | AUTH-ERR-ROLE-REQUIRED             |
| AUTH-ERR-013  | AUTH-ERR-EMPLOYEE-LINKED           |
| AUTH-ERR-014  | AUTH-ERR-FORBIDDEN                 |
| AUTH-ERR-015  | AUTH-ERR-UNAUTHENTICATED           |
| AUTH-ERR-016  | AUTH-ERR-TOKEN-EXPIRED             |
| AUTH-ERR-017  | AUTH-ERR-FORBIDDEN                 |
| AUTH-ERR-403  | AUTH-ERR-FORBIDDEN                 |

---

## 21. Yêu cầu bảo mật

> **Drift reconciliation 22/06 (theo SPEC-DRIFT-MATRIX §1, AU-6/AU-7/AU-8):** chốt thuật toán hash, TTL token và rotation/reuse-detection thành **giá trị cứng, bắt buộc MVP** (crown-jewel) thay cho mô tả mở "thuật toán an toàn"/"có thời hạn".

1. **Mật khẩu hash bằng `argon2id` (AU-6).** Tham số tối thiểu MVP (theo khuyến nghị OWASP Password Storage Cheat Sheet): `memoryCost ≥ 19 MiB` (19456 KiB), `timeCost (iterations) ≥ 2`, `parallelism = 1`, salt ngẫu nhiên ≥ 16 byte/user. KHÔNG dùng MD5/SHA thường, KHÔNG tự triển khai thuật toán hash. Có thể thêm `pepper` ở application secret nếu cần. (`bcrypt` chỉ là phương án rút lui nếu môi trường không hỗ trợ argon2id — chuẩn chính là `argon2id`; cần đồng bộ tham số trong `BACKEND-03 §11.1` và `DB-02 §16.3`.)
2. Không trả `password_hash` về frontend.
3. **Token có thời hạn cứng (AU-7):** access token **15 phút**, refresh token **7 ngày** (nguồn chuẩn duy nhất = [API-01 §3.5](<../API Design/API-01 TỔNG QUAN.md>); các doc khác trỏ về, không lặp lại giá trị khác). Access token là JWT ngắn hạn; refresh token lưu **hash** ở `user_sessions` (DB-02), không lưu plaintext.
4. **Refresh-token rotation + reuse-detection là BẮT BUỘC MVP (AU-8, crown-jewel):** mỗi lần `refresh`, refresh token cũ bị thu hồi và cấp token mới (rotation). Nếu một refresh token đã thu hồi/đã dùng lại được trình lại (reuse), backend phải coi là dấu hiệu đánh cắp và **thu hồi toàn bộ token family** của user đó, trả `AUTH-ERR-REFRESH-TOKEN-INVALID`. Chi tiết token family/lưu trữ thuộc [API-02](<../API Design/API-02 AUTH API Design.md>) / [DB-02](<../DB/DB-02 AUTH RBAC Database Design.md>).
5. API cần kiểm tra quyền ở backend.
6. Token reset password cần hết hạn và chỉ dùng một lần.
7. Không tiết lộ email có tồn tại hay không ở màn hình quên mật khẩu.
8. Tài khoản `Locked`/`Suspended`/`Inactive`/`Deleted` không được đăng nhập (xem §10).
9. Các thao tác quản trị user/role/permission phải ghi audit log.
10. Không cho user tự nâng quyền.
11. Không cho Admin thường chỉnh Super Admin nếu không có quyền đặc biệt.
12. Dữ liệu permission không nên bị sửa trực tiếp bởi người dùng thường.

---

## 22. Tiêu chí nghiệm thu tổng thể module AUTH

Module AUTH được xem là hoàn thành MVP khi:

1. Người dùng đăng nhập thành công bằng email/mật khẩu hợp lệ.
2. Người dùng đăng xuất được.
3. Người dùng đổi mật khẩu được.
4. Người dùng gửi yêu cầu quên mật khẩu được.
5. Người dùng đặt lại mật khẩu bằng token hợp lệ được.
6. Admin tạo được user.
7. Admin cập nhật được user.
8. Admin khóa/mở khóa được user.
9. Admin tạo và cập nhật role được.
10. Admin gán permission cho role được.
11. Admin gán role cho user được.
12. User chỉ thấy menu đúng quyền.
13. API chặn request không có token.
14. API chặn request không đủ quyền.
15. User bị khóa không thể đăng nhập.
16. Tất cả thao tác quan trọng có audit log.
17. Danh sách user có tìm kiếm, lọc, phân trang.
18. Danh sách role có tìm kiếm, lọc, phân trang.
19. Không còn lỗi nghiêm trọng ở luồng đăng nhập và phân quyền.

---

## 23. Test case chính

| Mã test case | Tên test case                            | Kết quả mong muốn         |
| ------------ | ---------------------------------------- | ------------------------- |
| AUTH-TC-001  | Đăng nhập đúng email/mật khẩu            | Đăng nhập thành công      |
| AUTH-TC-002  | Đăng nhập sai mật khẩu                   | Hiển thị lỗi              |
| AUTH-TC-003  | Đăng nhập tài khoản bị khóa              | Không cho đăng nhập       |
| AUTH-TC-004  | Đăng xuất                                | Token/session bị xóa      |
| AUTH-TC-005  | Quên mật khẩu với email hợp lệ           | Gửi hướng dẫn reset       |
| AUTH-TC-006  | Reset password với token hợp lệ          | Đổi mật khẩu thành công   |
| AUTH-TC-007  | Reset password với token hết hạn         | Hiển thị lỗi              |
| AUTH-TC-008  | Đổi mật khẩu đúng current password       | Đổi thành công            |
| AUTH-TC-009  | Đổi mật khẩu sai current password        | Không cho đổi             |
| AUTH-TC-010  | Admin tạo user hợp lệ                    | User được tạo             |
| AUTH-TC-011  | Admin tạo user email trùng               | Không cho tạo             |
| AUTH-TC-012  | Admin khóa user                          | User không đăng nhập được |
| AUTH-TC-013  | Admin mở khóa user                       | User đăng nhập lại được   |
| AUTH-TC-014  | Admin tạo role mới                       | Role được tạo             |
| AUTH-TC-015  | Admin tạo role_code trùng                | Không cho tạo             |
| AUTH-TC-016  | Admin gán role cho user                  | User nhận quyền mới       |
| AUTH-TC-017  | User không có quyền vào màn quản lý user | Bị chặn                   |
| AUTH-TC-018  | API không token                          | Trả lỗi chưa đăng nhập    |
| AUTH-TC-019  | API thiếu quyền                          | Trả lỗi không có quyền    |
| AUTH-TC-020  | Kiểm tra audit log khi tạo user          | Log được ghi              |

---

## 24. Rủi ro và hướng xử lý

| Rủi ro                      | Mô tả                            | Hướng xử lý                                |
| --------------------------- | -------------------------------- | ------------------------------------------ |
| Phân quyền quá phức tạp     | Nhiều vai trò, nhiều module      | MVP chỉ dùng RBAC + data scope cơ bản      |
| Admin tự khóa chính mình    | Có thể làm mất quyền quản trị    | Chặn tự khóa nếu là admin cuối             |
| User tự nâng quyền          | Lỗ hổng nghiêm trọng             | Backend kiểm tra quyền chặt                |
| Token bị lộ                 | Rủi ro bảo mật                   | Token có thời hạn, logout, HTTPS           |
| Permission sai              | User thấy dữ liệu không nên thấy | Test ma trận quyền kỹ                      |
| Role mặc định bị sửa sai    | Gây lỗi toàn hệ thống            | Bảo vệ role hệ thống, ghi log              |
| Email reset bị lộ thông tin | Dò tài khoản                     | Không thông báo email có tồn tại hay không |

---

## 25. Các điểm cần xác nhận thêm

Trước khi chốt bản final, cần xác nhận:

1. MVP có cần gửi email thật cho quên mật khẩu không, hay chỉ tạo token nội bộ?
2. User mới tạo sẽ nhận mật khẩu tạm thời hay link kích hoạt?
3. Có cho HR tạo user không, hay chỉ Admin được tạo?
4. Có cho một user nhiều role không? Đề xuất: Có.
5. Có cho một employee nhiều user không? Đề xuất: Không.
6. Có cần xác thực hai lớp trong MVP không? Đề xuất: Chưa.
7. Có cần đăng nhập bằng Google trong MVP không? Đề xuất: Chưa.
8. Có cần giới hạn số lần đăng nhập sai không? Đề xuất: Có thể để Phase sau.
9. Có cần lưu lịch sử thiết bị đăng nhập không? Đề xuất: Phase sau.
10. Có cần user tự cập nhật avatar/số điện thoại không? Đề xuất: Có, nếu không ảnh hưởng dữ liệu HR chính thức.

---

## 26. Kết luận

SPEC-02 là module nền tảng của hệ thống. Toàn bộ các module sau đều phụ thuộc vào module này để xác định:

* Người dùng là ai
* Người dùng có vai trò gì
* Người dùng có quyền gì
* Người dùng được truy cập phạm vi dữ liệu nào
* Người dùng có được thực hiện hành động hay không

Sau khi SPEC-02 được chốt, có thể triển khai tiếp:

1. SPEC-03: Quản lý nhân sự
2. SPEC-04: Chấm công
3. SPEC-05: Nghỉ phép
4. SPEC-06: Công việc & dự án
5. SPEC-07: Dashboard
6. SPEC-08: Thông báo hệ thống
