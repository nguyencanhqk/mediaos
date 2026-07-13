# SPEC-05: NGHỈ PHÉP

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · [SPEC-03 HR](<SPEC-03 HR.md>) · [SPEC-04 ATT](<SPEC-04 ATT.md>) · **SPEC-05 LEAVE** · [SPEC-06 TASK](<SPEC-06 TASK.md>) · [SPEC-07 DASH](<SPEC-07 DASH.md>) · [SPEC-08 NOTI](<SPEC-08 NOTI.md>) · [SPEC-09 ME](<SPEC-09 ME.md>)
>
> **Liên quan:** [Thiết kế DB: DB-05 LEAVE](<../DB/DB-05 LEAVE Database Design.md>) · [Sản phẩm: PRD-00 §9.4](<../PRD/PRD-00 Enterprise Management System .md>) · [Thiết kế API: API-05 LEAVE](<../API Design/API-05_LEAVE_API_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường                     | Nội dung                    |
| -------------------------- | --------------------------- |
| Mã tài liệu                | SPEC-05                     |
| Tên tài liệu               | Nghỉ phép                   |
| Module code                | LEAVE                       |
| Tài liệu cha               | SPEC-01: Tổng quan hệ thống |
| Module phụ thuộc trực tiếp | AUTH, HR, ATT, NOTI, DASH   |
| Phiên bản                  | v1.0                        |
| Trạng thái                 | Draft                       |
| Giai đoạn                  | MVP Version 1.0             |
| Người viết                 |                             |
| Người duyệt                |                             |
| Ngày tạo                   |                             |
| Ngày cập nhật              |                             |

> **Drift reconciliation 22/06 (theo SPEC-DRIFT-MATRIX §4).** Tài liệu này đã được vá theo cụm LEAVE (LV-1…LV-11). Nguyên tắc: chuẩn = **DB-05 / API-05 / BACKEND-07**; SPEC-05 (bản cũ) lệch và đã được sửa theo. Các điểm cần lane khác đồng bộ (FE-10, BACKEND-07, API-10, QA) được ghi rõ trong từng mục liên quan (đặc biệt: bộ mã lỗi canonical §18, NOTI event §19.1.1, công thức số dư §15.4, mô hình permission §9.2).

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết module **Nghỉ phép** trong hệ thống quản lý doanh nghiệp nội bộ.

Module `LEAVE` chịu trách nhiệm quản lý toàn bộ nghiệp vụ liên quan đến:

* Cấu hình loại nghỉ phép.
* Cấu hình chính sách nghỉ phép.
* Quản lý số ngày phép của nhân viên.
* Nhân viên tạo đơn nghỉ phép.
* Nhân viên xem đơn nghỉ phép của chính mình.
* Manager/HR duyệt hoặc từ chối đơn nghỉ phép.
* Hủy đơn nghỉ phép.
* Theo dõi lịch nghỉ của cá nhân, team, phòng ban và toàn công ty.
* Đồng bộ dữ liệu nghỉ phép sang module chấm công.
* Cung cấp dữ liệu nghỉ phép cho dashboard, thông báo và bảng lương sau này.

Module này là một module lõi trong MVP vì ảnh hưởng trực tiếp đến chấm công, quản lý nhân sự, dashboard quản lý và tính lương ở các phase sau.

---

## 3. Mối liên kết với các SPEC khác

### 3.1 Liên kết với [SPEC-01](<SPEC-01 Tổng quan.md>)

Theo SPEC-01, module này có mã:

```text
LEAVE
```

Module `LEAVE` nằm trong MVP Version 1.0 và có nhiệm vụ quản lý:

```text
Tạo đơn nghỉ phép
Chọn loại nghỉ
Tính số ngày nghỉ
Duyệt đơn nghỉ phép
Từ chối đơn nghỉ phép
Hủy đơn nghỉ phép
Theo dõi số ngày phép còn lại
Lịch nghỉ của team
Lịch nghỉ toàn công ty
```

---

### 3.2 Liên kết với [SPEC-02](<SPEC-02 AUTH.md>): AUTH

Module `LEAVE` phụ thuộc vào `AUTH` để:

* Xác định người dùng đang đăng nhập.
* Kiểm tra quyền tạo đơn nghỉ.
* Kiểm tra quyền xem đơn nghỉ.
* Kiểm tra quyền duyệt/từ chối/hủy đơn nghỉ.
* Áp dụng data scope: Own, Team, Department, Company, System.
* Ghi nhận actor khi tạo, duyệt, từ chối hoặc hủy đơn nghỉ.
* Hiển thị menu/màn hình nghỉ phép theo quyền.

Ví dụ:

```text
Employee chỉ được xem và tạo đơn nghỉ của chính mình.
Manager chỉ được duyệt đơn của nhân viên thuộc team.
HR có thể xem và xử lý đơn nghỉ toàn công ty nếu được cấp quyền.
```

---

### 3.3 Liên kết với [SPEC-03](<SPEC-03 HR.md>): HR

Module `LEAVE` phụ thuộc vào `HR` để:

* Lấy thông tin nhân viên.
* Lấy phòng ban của nhân viên.
* Lấy chức vụ/cấp bậc nếu chính sách nghỉ phụ thuộc vào nhóm nhân sự.
* Lấy ngày vào làm để tính ngày phép.
* Lấy trạng thái nhân viên để kiểm tra có được tạo đơn nghỉ không.
* Lấy quản lý trực tiếp để xác định người duyệt.
* Lấy dữ liệu nhân sự phục vụ lịch nghỉ team/phòng ban/công ty.

Ví dụ:

```text
Employee A thuộc phòng Kỹ thuật
Direct Manager là Nguyễn Văn B
Khi Employee A gửi đơn nghỉ, hệ thống gửi đơn đến Nguyễn Văn B duyệt.
```

---

### 3.4 Liên kết với [SPEC-04](<SPEC-04 ATT.md>): ATT

Module `LEAVE` liên kết chặt với module `ATT` vì đơn nghỉ phép ảnh hưởng trực tiếp đến chấm công.

Khi đơn nghỉ được duyệt:

* Nếu nghỉ cả ngày, hệ thống cập nhật trạng thái ngày công là `Leave`.
* Nếu nghỉ buổi sáng, hệ thống chỉ tính công buổi chiều nếu nhân viên có chấm công hợp lệ.
* Nếu nghỉ buổi chiều, hệ thống không tính check-out buổi trưa là về sớm.
* Nếu nghỉ theo giờ, hệ thống trừ khoảng thời gian nghỉ khỏi tổng thời gian làm việc yêu cầu.
* Nếu nhân viên đã có đơn nghỉ cả ngày được duyệt, module ATT phải chặn check-in/check-out.
* Nếu đơn nghỉ bị hủy hoặc thu hồi sau khi đã duyệt, module ATT cần tính lại ngày công tương ứng.

---

### 3.5 Liên kết với [SPEC-08](<SPEC-08 NOTI.md>): NOTI

Module `LEAVE` dùng `NOTI` để gửi thông báo khi:

* Employee gửi đơn nghỉ mới.
* Manager/HR có đơn cần duyệt.
* Đơn nghỉ được duyệt.
* Đơn nghỉ bị từ chối.
* Đơn nghỉ bị hủy.
* Đơn nghỉ sắp tới ngày bắt đầu.
* Số ngày phép còn lại thấp.
* Chính sách nghỉ phép hoặc số ngày phép được điều chỉnh.

---

### 3.6 Liên kết với [SPEC-07](<SPEC-07 DASH.md>): DASH

Module `LEAVE` cung cấp dữ liệu cho dashboard:

* Employee xem số ngày phép còn lại.
* Employee xem đơn nghỉ gần nhất.
* Manager xem đơn chờ duyệt.
* Manager xem lịch nghỉ của team.
* HR xem số đơn nghỉ chờ xử lý.
* HR xem lịch nghỉ toàn công ty.
* Admin/HR xem thống kê nghỉ phép theo tháng/năm.

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

Module `LEAVE` cần giúp doanh nghiệp:

1. Số hóa toàn bộ quy trình xin nghỉ phép.
2. Giảm trao đổi thủ công qua tin nhắn, email hoặc giấy tờ.
3. Cho phép nhân viên chủ động tạo và theo dõi đơn nghỉ.
4. Cho phép quản lý duyệt nghỉ đúng phạm vi nhân sự mình quản lý.
5. Cho phép HR kiểm soát toàn bộ lịch nghỉ và số ngày phép.
6. Tự động tính số ngày nghỉ dựa trên ngày làm việc, ca làm và ngày lễ.
7. Quản lý số ngày phép còn lại của từng nhân viên.
8. Tránh trường hợp nhân viên nghỉ vượt số phép nếu không được cho phép.
9. Đồng bộ nghỉ phép sang bảng công.
10. Cung cấp dữ liệu đầu vào cho tính lương ở phase sau.

---

### 4.2 Mục tiêu kỹ thuật

Module `LEAVE` cần đảm bảo:

1. Mỗi đơn nghỉ có mã định danh riêng.
2. Mỗi đơn nghỉ gắn với một employee.
3. Có trạng thái rõ ràng: Draft, Pending, Approved, Rejected, Cancelled.
4. Có kiểm tra quyền ở cả frontend và backend.
5. Có kiểm tra data scope theo role.
6. Có audit log cho mọi thao tác quan trọng.
7. Có thể cấu hình nhiều loại nghỉ.
8. Có thể cấu hình chính sách nghỉ theo công ty, phòng ban hoặc nhóm nhân viên.
9. Có thể tính số ngày nghỉ chính xác theo ngày làm việc, ngày lễ, cuối tuần, ca làm.
10. Có khả năng mở rộng cho nhiều cấp duyệt.
11. Có khả năng mở rộng cho mobile app.
12. Có khả năng tích hợp với payroll ở phase sau.

---

## 5. Phạm vi module

### 5.1 Bao gồm trong MVP

| Mã chức năng   | Tên chức năng                    | Độ ưu tiên |
| -------------- | -------------------------------- | ---------- |
| LEAVE-FUNC-001 | Xem số ngày phép còn lại của tôi | Rất cao    |
| LEAVE-FUNC-002 | Tạo đơn nghỉ phép                | Rất cao    |
| LEAVE-FUNC-003 | Lưu nháp đơn nghỉ phép           | Trung bình |
| LEAVE-FUNC-004 | Gửi đơn nghỉ phép                | Rất cao    |
| LEAVE-FUNC-005 | Xem danh sách đơn nghỉ của tôi   | Rất cao    |
| LEAVE-FUNC-006 | Xem chi tiết đơn nghỉ            | Rất cao    |
| LEAVE-FUNC-007 | Hủy đơn nghỉ của chính mình      | Cao        |
| LEAVE-FUNC-008 | Xem danh sách đơn chờ duyệt      | Rất cao    |
| LEAVE-FUNC-009 | Duyệt đơn nghỉ phép              | Rất cao    |
| LEAVE-FUNC-010 | Từ chối đơn nghỉ phép            | Rất cao    |
| LEAVE-FUNC-011 | Xem lịch nghỉ của tôi            | Cao        |
| LEAVE-FUNC-012 | Xem lịch nghỉ của team           | Cao        |
| LEAVE-FUNC-013 | Xem lịch nghỉ toàn công ty       | Cao        |
| LEAVE-FUNC-014 | Quản lý loại nghỉ phép           | Cao        |
| LEAVE-FUNC-015 | Quản lý chính sách ngày phép     | Cao        |
| LEAVE-FUNC-016 | Quản lý số dư phép nhân viên     | Cao        |
| LEAVE-FUNC-017 | Điều chỉnh số dư phép            | Cao        |
| LEAVE-FUNC-018 | Đồng bộ nghỉ phép sang chấm công | Rất cao    |
| LEAVE-FUNC-019 | Gửi thông báo nghỉ phép          | Cao        |
| LEAVE-FUNC-020 | Xem lịch sử xử lý đơn nghỉ       | Cao        |
| LEAVE-FUNC-021 | Xuất dữ liệu nghỉ phép           | Trung bình |

---

### 5.2 Chưa bao gồm trong MVP nhưng cần thiết kế mở rộng

| Chức năng                                                | Giai đoạn |
| -------------------------------------------------------- | --------- |
| Quy trình duyệt nhiều cấp nâng cao                       | Phase sau |
| Chính sách phép phức tạp theo thâm niên                  | Phase sau |
| Tự động cộng phép hằng tháng                             | Phase sau |
| Tự động reset phép đầu năm                               | Phase sau |
| Chuyển phép tồn sang năm sau                             | Phase sau |
| Mua/bán ngày phép                                        | Phase sau |
| Nghỉ bù theo overtime                                    | Phase sau |
| Nghỉ thai sản/phép đặc biệt có workflow riêng            | Phase sau |
| Import số dư phép từ Excel                               | Phase sau |
| Đồng bộ lịch nghỉ với Google Calendar/Microsoft Calendar | Phase sau |
| Mobile push notification                                 | Phase sau |
| AI gợi ý người thay thế khi nghỉ                         | Phase sau |

---

## 6. Nhóm người dùng liên quan

| Vai trò         | Mô tả trong module LEAVE                                           |
| --------------- | ------------------------------------------------------------------ |
| Super Admin     | Toàn quyền với dữ liệu nghỉ phép toàn hệ thống                     |
| Admin công ty   | Quản trị dữ liệu nghỉ phép trong công ty nếu được cấp quyền        |
| HR              | Quản lý loại nghỉ, chính sách nghỉ, số dư phép và toàn bộ đơn nghỉ |
| Manager         | Duyệt hoặc từ chối đơn nghỉ của nhân viên thuộc phạm vi quản lý    |
| Employee        | Tạo đơn nghỉ, xem đơn nghỉ, xem số ngày phép còn lại               |
| Payroll Officer | Xem dữ liệu nghỉ phục vụ tính lương ở phase sau                    |

---

## 7. Khái niệm chính trong module

### 7.1 Leave Request

`Leave Request` là đơn nghỉ phép do nhân viên tạo trên hệ thống.

Một đơn nghỉ gồm:

* Người xin nghỉ.
* Loại nghỉ.
* Thời gian nghỉ.
* Số ngày/giờ nghỉ được tính.
* Lý do nghỉ.
* File đính kèm nếu có.
* Người duyệt.
* Trạng thái xử lý.
* Lịch sử xử lý.

---

### 7.2 Leave Type

`Leave Type` là loại nghỉ phép.

Ví dụ:

| Mã loại nghỉ       | Tên loại nghỉ    | Có trừ phép không            |
| ------------------ | ---------------- | ---------------------------- |
| ANNUAL_LEAVE       | Nghỉ phép năm    | Có                           |
| UNPAID_LEAVE       | Nghỉ không lương | Không hoặc tùy chính sách    |
| SICK_LEAVE         | Nghỉ ốm          | Có hoặc không tùy chính sách |
| MATERNITY_LEAVE    | Nghỉ thai sản    | Không tính như phép năm      |
| MARRIAGE_LEAVE     | Nghỉ kết hôn     | Không hoặc theo chính sách   |
| BEREAVEMENT_LEAVE  | Nghỉ tang        | Không hoặc theo chính sách   |
| COMPENSATORY_LEAVE | Nghỉ bù          | Trừ quỹ nghỉ bù              |
| OTHER              | Khác             | Tùy cấu hình                 |

---

### 7.3 Leave Balance

`Leave Balance` là số ngày phép còn lại của nhân viên.

Ví dụ:

```text
Phép năm được cấp: 12 ngày
Đã dùng: 3 ngày
Đang chờ duyệt: 1 ngày
Còn lại khả dụng: 8 ngày
```

Leave Balance có thể gồm:

* Số ngày được cấp.
* Số ngày đã dùng.
* Số ngày đang chờ duyệt.
* Số ngày được điều chỉnh cộng/trừ.
* Số ngày chuyển từ năm trước.
* Số ngày hết hạn.
* Số ngày còn lại.

---

### 7.4 Leave Policy

`Leave Policy` là chính sách nghỉ phép áp dụng cho công ty, phòng ban hoặc nhóm nhân viên.

Ví dụ:

```text
Nhân viên chính thức được 12 ngày phép/năm.
Nhân viên thử việc chưa được dùng phép năm.
Nhân viên vào giữa năm được tính phép theo tỷ lệ tháng làm việc.
Phép còn lại cuối năm được chuyển tối đa 5 ngày sang năm sau.
```

---

### 7.5 Approval Flow

`Approval Flow` là quy trình duyệt đơn nghỉ.

MVP đề xuất hỗ trợ quy trình cơ bản:

```text
Employee gửi đơn
→ Direct Manager duyệt/từ chối
→ Nếu cần, HR có thể xem và can thiệp theo quyền
```

Có thể cấu hình mở rộng:

```text
Employee gửi đơn
→ Manager duyệt
→ HR xác nhận
→ Đơn được Approved
```

---

### 7.6 Leave Calendar

`Leave Calendar` là lịch hiển thị các ngày nghỉ đã được duyệt hoặc đang chờ duyệt.

Lịch nghỉ có thể xem theo:

* Cá nhân.
* Team.
* Phòng ban.
* Toàn công ty.

---

### 7.7 Leave Duration

`Leave Duration` là đơn vị thời gian nghỉ.

MVP cần hỗ trợ:

| Loại thời lượng    | Mô tả           |
| ------------------ | --------------- |
| Full Day           | Nghỉ cả ngày    |
| Half Day Morning   | Nghỉ buổi sáng  |
| Half Day Afternoon | Nghỉ buổi chiều |
| Hourly             | Nghỉ theo giờ   |
| Multiple Days      | Nghỉ nhiều ngày |

---

## 8. Trạng thái đơn nghỉ phép

| Trạng thái | Mã        | Ý nghĩa                                                             |
| ---------- | --------- | ------------------------------------------------------------------- |
| Nháp       | Draft     | Đơn được lưu nhưng chưa gửi duyệt                                   |
| Chờ duyệt  | Pending   | Đơn đã gửi, đang chờ xử lý                                          |
| Đã duyệt   | Approved  | Đơn đã được duyệt                                                   |
| Từ chối    | Rejected  | Đơn bị từ chối                                                      |
| Đã hủy     | Cancelled | Đơn bị hủy bởi người tạo hoặc người có quyền                        |
| Đã thu hồi | Revoked   | Đơn đã duyệt nhưng bị thu hồi bởi HR/Admin (trạng thái MVP chính thức — API/DB/BE đã hiện thực đầy đủ, transition `Approved → Revoked`, xem §10/API-05 §10.2) |

---

## 9. Quyền trong module LEAVE

### 9.1 Quy ước mã quyền

Cấu trúc:

```text
LEAVE.RESOURCE.ACTION
```

Ví dụ:

```text
LEAVE.REQUEST.CREATE
LEAVE.REQUEST.APPROVE
LEAVE.BALANCE.VIEW
```

---

### 9.2 Danh sách quyền LEAVE trong MVP

> **Drift reconciliation 22/06 (theo SPEC-DRIFT-MATRIX §4 — LV-4, LV-5).**
>
> **Chuẩn permission = API-05 §6.3.** Bảng dưới đã hợp nhất các quyền API/BE dùng nhưng SPEC bản cũ thiếu (`SUBMIT`, `REVOKE`, `FILE.*`, `BALANCE.TRANSACTION_VIEW`, `POLICY.CREATE/DELETE`, `TYPE.CREATE/DELETE`) — LV-4.
>
> **LV-5 — mô hình VIEW chốt 1 cách (gộp `VIEW` + data_scope):**
>
> * **Đơn nghỉ (`LEAVE.REQUEST.*`)**: dùng MỘT quyền `LEAVE.REQUEST.VIEW` + `data_scope` (Own/Team/Department/Company) — KHÔNG dùng các biến thể tách lẻ `LEAVE.REQUEST.VIEW_TEAM/VIEW_DEPARTMENT/VIEW_COMPANY` nữa. `LEAVE.REQUEST.VIEW_OWN` giữ riêng cho quyền "chỉ đơn của chính mình" (data_scope Own, cấp mặc định cho Employee). Mọi tham chiếu cũ `VIEW_COMPANY` trong tài liệu này được đọc là `LEAVE.REQUEST.VIEW` + data_scope Company.
> * **Lịch nghỉ (`LEAVE.CALENDAR.*`)**: GIỮ tách lẻ `VIEW_OWN/VIEW_TEAM/VIEW_COMPANY` vì calendar là 3 màn hình/route khác nhau (SCREEN-007/008/009) với hành vi hiển thị khác nhau; đây là quyết định có chủ đích, KHÔNG phải drift.
> * **Cần đồng bộ:** FE-10 + API-10 permission matrix phải bỏ `LEAVE.REQUEST.VIEW_TEAM/DEPARTMENT/COMPANY` tách lẻ, dùng `LEAVE.REQUEST.VIEW` + scope; DB-05 §8.1 seed bổ sung các quyền LV-4 còn thiếu (`ON CONFLICT DO NOTHING`).

| Mã quyền                         | Mô tả                                    |
| -------------------------------- | ---------------------------------------- |
| LEAVE.REQUEST.CREATE             | Tạo/lưu nháp đơn nghỉ của chính mình     |
| LEAVE.REQUEST.SUBMIT             | Gửi đơn nghỉ của chính mình              |
| LEAVE.REQUEST.VIEW_OWN           | Xem đơn nghỉ của chính mình              |
| LEAVE.REQUEST.VIEW               | Xem đơn nghỉ theo phạm vi được cấp (scope) |
| LEAVE.REQUEST.UPDATE_DRAFT       | Sửa đơn nháp của chính mình              |
| LEAVE.REQUEST.CANCEL_OWN         | Hủy đơn của chính mình khi còn được phép |
| LEAVE.REQUEST.APPROVE            | Duyệt đơn nghỉ phép                      |
| LEAVE.REQUEST.REJECT             | Từ chối đơn nghỉ phép                    |
| LEAVE.REQUEST.CANCEL_ANY         | Hủy đơn nghỉ của người khác nếu có quyền |
| LEAVE.REQUEST.REVOKE             | Thu hồi đơn đã duyệt theo phạm vi được cấp |
| LEAVE.REQUEST.EXPORT             | Xuất dữ liệu đơn nghỉ                    |
| LEAVE.TYPE.VIEW                  | Xem loại nghỉ phép                       |
| LEAVE.TYPE.CREATE                | Tạo loại nghỉ phép                       |
| LEAVE.TYPE.UPDATE                | Cập nhật loại nghỉ phép                  |
| LEAVE.TYPE.DELETE                | Vô hiệu hóa/xóa mềm loại nghỉ phép       |
| LEAVE.POLICY.VIEW                | Xem chính sách nghỉ phép                 |
| LEAVE.POLICY.CREATE              | Tạo chính sách nghỉ phép                 |
| LEAVE.POLICY.UPDATE              | Cập nhật chính sách nghỉ phép            |
| LEAVE.POLICY.DELETE              | Xóa mềm chính sách nghỉ phép             |
| LEAVE.BALANCE.VIEW_OWN           | Xem số dư phép của chính mình            |
| LEAVE.BALANCE.VIEW               | Xem số dư phép của nhân viên             |
| LEAVE.BALANCE.ADJUST             | Điều chỉnh số dư phép                    |
| LEAVE.BALANCE.TRANSACTION_VIEW   | Xem lịch sử giao dịch số dư phép         |
| LEAVE.FILE.VIEW                  | Xem file chứng minh trong đơn nghỉ       |
| LEAVE.FILE.UPLOAD                | Upload/link file chứng minh              |
| LEAVE.FILE.DELETE                | Xóa/unlink file chứng minh               |
| LEAVE.CALENDAR.VIEW_OWN          | Xem lịch nghỉ của tôi                    |
| LEAVE.CALENDAR.VIEW_TEAM         | Xem lịch nghỉ team                       |
| LEAVE.CALENDAR.VIEW_COMPANY      | Xem lịch nghỉ toàn công ty               |
| LEAVE.AUDIT_LOG.VIEW             | Xem lịch sử xử lý nghỉ phép              |

---

## 10. Ma trận phân quyền MVP

| Chức năng                 | Super Admin | Admin công ty   | HR              | Manager                  | Employee |
| ------------------------- | ----------- | --------------- | --------------- | ------------------------ | -------- |
| Tạo đơn nghỉ của mình     | Có          | Có              | Có              | Có                       | Có       |
| Xem đơn nghỉ của mình     | Có          | Có              | Có              | Có                       | Có       |
| Xem đơn nghỉ team         | Có          | Có nếu được cấp | Có nếu được cấp | Có                       | Không    |
| Xem đơn nghỉ toàn công ty | Có          | Có nếu được cấp | Có              | Không mặc định           | Không    |
| Duyệt đơn nghỉ            | Có          | Có nếu được cấp | Có nếu được cấp | Có với team              | Không    |
| Từ chối đơn nghỉ          | Có          | Có nếu được cấp | Có nếu được cấp | Có với team              | Không    |
| Hủy đơn của chính mình    | Có          | Có              | Có              | Có                       | Có       |
| Hủy đơn người khác        | Có          | Có nếu được cấp | Có nếu được cấp | Không mặc định           | Không    |
| Quản lý loại nghỉ         | Có          | Có nếu được cấp | Có nếu được cấp | Không                    | Không    |
| Quản lý chính sách phép   | Có          | Có nếu được cấp | Có nếu được cấp | Không                    | Không    |
| Xem số dư phép cá nhân    | Có          | Có              | Có              | Có                       | Có       |
| Xem số dư phép nhân viên  | Có          | Có nếu được cấp | Có              | Có với team nếu được cấp | Không    |
| Điều chỉnh số dư phép     | Có          | Có nếu được cấp | Có nếu được cấp | Không                    | Không    |
| Xem lịch nghỉ team        | Có          | Có nếu được cấp | Có nếu được cấp | Có                       | Không    |
| Xem lịch nghỉ công ty     | Có          | Có nếu được cấp | Có              | Không mặc định           | Không    |
| Xuất dữ liệu nghỉ phép    | Có          | Có nếu được cấp | Có nếu được cấp | Không mặc định           | Không    |

---

## 11. Danh sách màn hình

| Mã màn hình      | Tên màn hình                  | Người dùng truy cập                    |
| ---------------- | ----------------------------- | -------------------------------------- |
| LEAVE-SCREEN-001 | Tổng quan nghỉ phép của tôi   | Employee, Manager, HR, Admin           |
| LEAVE-SCREEN-002 | Tạo đơn nghỉ phép             | Employee, Manager, HR, Admin           |
| LEAVE-SCREEN-003 | Đơn nghỉ của tôi              | Employee, Manager, HR, Admin           |
| LEAVE-SCREEN-004 | Chi tiết đơn nghỉ phép        | Chủ đơn, Manager, HR, Admin theo quyền |
| LEAVE-SCREEN-005 | Đơn chờ tôi duyệt             | Manager, HR, Admin                     |
| LEAVE-SCREEN-006 | Tất cả đơn nghỉ phép          | HR, Admin                              |
| LEAVE-SCREEN-007 | Lịch nghỉ của tôi             | Employee                               |
| LEAVE-SCREEN-008 | Lịch nghỉ team                | Manager, HR                            |
| LEAVE-SCREEN-009 | Lịch nghỉ toàn công ty        | HR, Admin                              |
| LEAVE-SCREEN-010 | Quản lý loại nghỉ phép        | HR, Admin                              |
| LEAVE-SCREEN-011 | Cấu hình chính sách nghỉ phép | HR, Admin                              |
| LEAVE-SCREEN-012 | Số dư phép nhân viên          | HR, Admin                              |
| LEAVE-SCREEN-013 | Điều chỉnh số dư phép         | HR, Admin                              |
| LEAVE-SCREEN-014 | Lịch sử xử lý đơn nghỉ        | HR, Admin có quyền                     |

---

## 12. Luồng nghiệp vụ tổng quan

### 12.1 Luồng nhân viên tạo đơn nghỉ phép

```text
Employee đăng nhập
→ Vào menu Nghỉ phép
→ Chọn Tạo đơn nghỉ
→ Chọn loại nghỉ
→ Chọn thời gian nghỉ
→ Nhập lý do
→ Upload file nếu cần
→ Hệ thống tính số ngày/giờ nghỉ
→ Hệ thống kiểm tra số dư phép
→ Employee bấm Gửi đơn
→ Hệ thống tạo đơn trạng thái Pending
→ Hệ thống xác định người duyệt
→ Hệ thống gửi thông báo cho người duyệt
```

---

### 12.2 Luồng duyệt đơn nghỉ phép

```text
Manager/HR đăng nhập
→ Vào Đơn chờ duyệt
→ Mở chi tiết đơn nghỉ
→ Xem thông tin nhân viên
→ Xem loại nghỉ, thời gian nghỉ, số ngày nghỉ, lý do
→ Kiểm tra lịch nghỉ team nếu cần
→ Bấm Duyệt
→ Hệ thống cập nhật trạng thái Approved
→ Hệ thống trừ/cập nhật số dư phép nếu loại nghỉ có trừ phép
→ Hệ thống đồng bộ sang bảng công
→ Hệ thống gửi thông báo cho Employee
```

---

### 12.3 Luồng từ chối đơn nghỉ phép

```text
Manager/HR mở đơn Pending
→ Bấm Từ chối
→ Nhập lý do từ chối
→ Hệ thống chuyển trạng thái sang Rejected
→ Hệ thống không trừ số dư phép
→ Hệ thống gửi thông báo cho Employee
→ Hệ thống ghi audit log
```

---

### 12.4 Luồng hủy đơn nghỉ của Employee

```text
Employee vào Đơn nghỉ của tôi
→ Chọn đơn muốn hủy
→ Hệ thống kiểm tra trạng thái đơn
→ Nếu đơn Draft hoặc Pending, cho phép hủy
→ Nếu đơn Approved, áp dụng rule hủy sau duyệt
→ Employee nhập lý do hủy nếu cần
→ Hệ thống chuyển trạng thái Cancelled
→ Nếu đơn đã Approved, hệ thống hoàn lại số dư phép và đồng bộ lại bảng công nếu cấu hình cho phép
→ Hệ thống gửi thông báo cho người duyệt/HR nếu cần
```

---

### 12.5 Luồng HR điều chỉnh số dư phép

```text
HR vào màn hình Số dư phép nhân viên
→ Chọn nhân viên
→ Chọn loại phép
→ Bấm Điều chỉnh
→ Nhập số ngày cộng/trừ
→ Nhập lý do điều chỉnh
→ Bấm Lưu
→ Hệ thống cập nhật leave balance
→ Hệ thống tạo balance transaction
→ Hệ thống ghi audit log
```

---

### 12.6 Luồng đồng bộ nghỉ phép sang chấm công

```text
Đơn nghỉ được Approved
→ Hệ thống xác định ngày nghỉ
→ Hệ thống xác định nghỉ cả ngày/nửa ngày/theo giờ
→ Hệ thống tạo hoặc cập nhật attendance record
→ Nếu nghỉ cả ngày, trạng thái công là Leave
→ Nếu nghỉ nửa ngày/theo giờ, hệ thống cập nhật required working minutes tương ứng
→ Module ATT dùng dữ liệu này để chặn hoặc tính công hợp lệ
```

---

## 13. Chi tiết màn hình

### 13.1 LEAVE-SCREEN-001: Tổng quan nghỉ phép của tôi

#### Mục đích

Cho phép nhân viên xem nhanh tình trạng nghỉ phép của chính mình.

#### Người dùng truy cập

* Employee
* Manager
* HR
* Admin
* Super Admin

#### Thành phần giao diện

* Số ngày phép năm được cấp.
* Số ngày đã dùng.
* Số ngày đang chờ duyệt.
* Số ngày còn lại khả dụng.
* Đơn nghỉ gần nhất.
* Nút Tạo đơn nghỉ.
* Link xem Đơn nghỉ của tôi.
* Link xem Lịch nghỉ của tôi.
* Cảnh báo nếu sắp hết phép.
* Cảnh báo nếu có đơn Pending.

#### Card dữ liệu đề xuất

| Card         | Mô tả                                 |
| ------------ | ------------------------------------- |
| Phép còn lại | Số ngày có thể sử dụng                |
| Đã dùng      | Tổng số ngày đã nghỉ được duyệt       |
| Chờ duyệt    | Tổng số ngày trong đơn Pending        |
| Sắp nghỉ     | Đơn Approved gần nhất trong tương lai |

---

### 13.2 LEAVE-SCREEN-002: Tạo đơn nghỉ phép

#### Mục đích

Cho phép nhân viên tạo đơn nghỉ phép.

#### Thành phần form

| Trường           | Kiểu dữ liệu | Bắt buộc               | Ghi chú                  |
| ---------------- | ------------ | ---------------------- | ------------------------ |
| leave_type_id    | Select       | Có                     | Loại nghỉ                |
| duration_type    | Select       | Có                     | Full Day/Half Day/Hourly |
| start_date       | Date         | Có                     | Ngày bắt đầu             |
| end_date         | Date         | Có                     | Ngày kết thúc            |
| start_time       | Time         | Có nếu nghỉ theo giờ   | Giờ bắt đầu              |
| end_time         | Time         | Có nếu nghỉ theo giờ   | Giờ kết thúc             |
| half_day_session | Select       | Có nếu nghỉ nửa ngày   | Morning/Afternoon        |
| calculated_days  | Number       | Tự tính                | Số ngày nghỉ             |
| reason           | Text         | Có/Không tùy cấu hình  | Lý do nghỉ               |
| handover_note    | Text         | Không                  | Ghi chú bàn giao         |
| attachments      | File         | Không/Có tùy loại nghỉ | File chứng minh          |

#### Validate

| Trường hợp                                     | Xử lý                            |
| ---------------------------------------------- | -------------------------------- |
| Chưa chọn loại nghỉ                            | Báo lỗi                          |
| Ngày kết thúc nhỏ hơn ngày bắt đầu             | Báo lỗi                          |
| Nghỉ theo giờ nhưng thiếu giờ bắt đầu/kết thúc | Báo lỗi                          |
| Giờ kết thúc nhỏ hơn giờ bắt đầu               | Báo lỗi                          |
| Số ngày nghỉ bằng 0                            | Báo lỗi hoặc cảnh báo            |
| Nghỉ vượt số dư phép                           | Chặn hoặc cảnh báo theo cấu hình |
| Trùng đơn nghỉ đã có                           | Chặn                             |
| Nhân viên không ở trạng thái làm việc          | Chặn                             |
| Loại nghỉ yêu cầu file nhưng chưa upload       | Chặn                             |
| Ngày nghỉ nằm trong quá khứ                    | Chặn hoặc cho phép theo cấu hình |

#### Nút chức năng

| Nút            | Mô tả                          |
| -------------- | ------------------------------ |
| Lưu nháp       | Lưu trạng thái Draft           |
| Gửi đơn        | Gửi duyệt, chuyển sang Pending |
| Hủy            | Quay lại màn hình trước        |
| Xem số dư phép | Mở nhanh thông tin balance     |

---

### 13.3 LEAVE-SCREEN-003: Đơn nghỉ của tôi

#### Mục đích

Cho phép nhân viên xem toàn bộ đơn nghỉ của chính mình.

#### Bộ lọc

| Bộ lọc         | Mô tả                                     |
| -------------- | ----------------------------------------- |
| Từ khóa        | Tìm theo mã đơn/lý do                     |
| Loại nghỉ      | Annual/Sick/Unpaid/...                    |
| Trạng thái     | Draft/Pending/Approved/Rejected/Cancelled |
| Thời gian nghỉ | Từ ngày - đến ngày                        |
| Ngày tạo       | Từ ngày - đến ngày                        |

#### Cột hiển thị

| Cột            | Mô tả                 |
| -------------- | --------------------- |
| Mã đơn         | leave_request_code    |
| Loại nghỉ      | leave_type_name       |
| Thời gian nghỉ | start_date - end_date |
| Số ngày        | calculated_days       |
| Trạng thái     | status                |
| Người duyệt    | approver              |
| Ngày gửi       | submitted_at          |
| Hành động      | Xem/Sửa nháp/Hủy      |

---

### 13.4 LEAVE-SCREEN-004: Chi tiết đơn nghỉ phép

#### Mục đích

Hiển thị đầy đủ thông tin của một đơn nghỉ phép.

#### Nội dung hiển thị

* Mã đơn.
* Trạng thái đơn.
* Người tạo đơn.
* Phòng ban.
* Quản lý trực tiếp.
* Loại nghỉ.
* Thời gian nghỉ.
* Số ngày/giờ nghỉ được tính.
* Lý do nghỉ.
* Ghi chú bàn giao.
* File đính kèm.
* Người duyệt.
* Lịch sử xử lý.
* Lịch sử thay đổi trạng thái.
* Thông tin số dư phép tại thời điểm gửi đơn.

#### Hành động theo trạng thái

| Trạng thái | Employee                      | Manager/HR               |
| ---------- | ----------------------------- | ------------------------ |
| Draft      | Sửa/Gửi/Xóa nháp              | Không xử lý              |
| Pending    | Xem/Hủy nếu được phép         | Duyệt/Từ chối            |
| Approved   | Xem/Hủy nếu cấu hình cho phép | Hủy/Thu hồi nếu có quyền |
| Rejected   | Xem                           | Xem                      |
| Cancelled  | Xem                           | Xem                      |

---

### 13.5 LEAVE-SCREEN-005: Đơn chờ tôi duyệt

#### Mục đích

Cho phép Manager/HR xem các đơn đang chờ mình xử lý.

#### Người dùng truy cập

* Manager.
* HR.
* Admin có quyền.
* Super Admin.

#### Bộ lọc

| Bộ lọc         | Mô tả                               |
| -------------- | ----------------------------------- |
| Từ khóa        | Tên nhân viên, mã nhân viên, mã đơn |
| Phòng ban      | Lọc theo phòng ban                  |
| Loại nghỉ      | Lọc theo loại nghỉ                  |
| Thời gian nghỉ | Từ ngày - đến ngày                  |
| Ngày gửi       | Từ ngày - đến ngày                  |

#### Cột hiển thị

| Cột            | Mô tả                 |
| -------------- | --------------------- |
| Mã đơn         | leave_request_code    |
| Nhân viên      | employee_name         |
| Mã nhân viên   | employee_code         |
| Phòng ban      | department_name       |
| Loại nghỉ      | leave_type_name       |
| Thời gian nghỉ | start_date - end_date |
| Số ngày        | calculated_days       |
| Ngày gửi       | submitted_at          |
| Hành động      | Xem/Duyệt/Từ chối     |

---

### 13.6 LEAVE-SCREEN-006: Tất cả đơn nghỉ phép

#### Mục đích

Cho phép HR/Admin quản lý toàn bộ đơn nghỉ phép trong phạm vi quyền.

#### Bộ lọc

| Bộ lọc      | Mô tả                                     |
| ----------- | ----------------------------------------- |
| Từ khóa     | Tên nhân viên, mã nhân viên, mã đơn       |
| Trạng thái  | Draft/Pending/Approved/Rejected/Cancelled |
| Loại nghỉ   | Annual/Sick/Unpaid/...                    |
| Phòng ban   | Lọc theo phòng ban                        |
| Người duyệt | Lọc theo approver                         |
| Ngày nghỉ   | Từ ngày - đến ngày                        |
| Ngày gửi    | Từ ngày - đến ngày                        |
| Ngày xử lý  | Từ ngày - đến ngày                        |

#### Hành động

| Hành động     | Permission                            |
| ------------- | ------------------------------------- |
| Xem danh sách | LEAVE.REQUEST.VIEW (data_scope Company) |
| Xem chi tiết  | LEAVE.REQUEST.VIEW (data_scope Company) |
| Duyệt         | LEAVE.REQUEST.APPROVE                 |
| Từ chối       | LEAVE.REQUEST.REJECT                  |
| Hủy           | LEAVE.REQUEST.CANCEL_ANY              |
| Xuất file     | LEAVE.REQUEST.EXPORT                  |

---

### 13.7 LEAVE-SCREEN-007/008/009: Lịch nghỉ

#### Mục đích

Hiển thị lịch nghỉ dạng calendar để dễ theo dõi.

#### Chế độ xem

| Chế độ | Mô tả              |
| ------ | ------------------ |
| Month  | Xem theo tháng     |
| Week   | Xem theo tuần      |
| Day    | Xem theo ngày      |
| List   | Xem dạng danh sách |

#### Loại lịch

| Màn hình               | Dữ liệu                      |
| ---------------------- | ---------------------------- |
| Lịch nghỉ của tôi      | Đơn của chính mình           |
| Lịch nghỉ team         | Nhân viên thuộc team         |
| Lịch nghỉ toàn công ty | Toàn bộ nhân viên theo quyền |

#### Quy tắc hiển thị

* Chỉ hiển thị đơn Approved mặc định.
* Có thể bật hiển thị Pending nếu người dùng có quyền.
* Employee không xem lịch nghỉ chi tiết của toàn công ty nếu không được cấp quyền.
* Có thể ẩn lý do nghỉ nếu công ty coi là thông tin riêng tư.
* Lịch nghỉ cần phân biệt loại nghỉ bằng màu hoặc nhãn.

---

### 13.8 LEAVE-SCREEN-010: Quản lý loại nghỉ phép

#### Mục đích

Cho phép HR/Admin cấu hình danh mục loại nghỉ.

#### Trường dữ liệu

| Trường               | Kiểu dữ liệu    | Bắt buộc | Ghi chú                     |
| -------------------- | --------------- | -------- | --------------------------- |
| leave_type_code      | String          | Có       | Unique                      |
| leave_type_name      | String          | Có       | Tên loại nghỉ               |
| description          | Text            | Không    | Mô tả                       |
| is_paid              | Boolean         | Có       | Có hưởng lương không        |
| deduct_balance       | Boolean         | Có       | Có trừ số dư phép không     |
| require_attachment   | Boolean         | Có       | Có bắt buộc file không      |
| require_reason       | Boolean         | Có       | Có bắt buộc lý do không     |
| allow_half_day       | Boolean         | Có       | Cho nghỉ nửa ngày           |
| allow_hourly         | Boolean         | Có       | Cho nghỉ theo giờ           |
| min_notice_days      | Integer         | Không    | Số ngày báo trước tối thiểu |
| max_days_per_request | Decimal         | Không    | Số ngày tối đa mỗi đơn      |
| status               | Active/Inactive | Có       | Trạng thái                  |

#### Quy tắc

* `leave_type_code` không được trùng.
* Không xóa cứng loại nghỉ đã phát sinh đơn.
* Loại nghỉ inactive không được chọn khi tạo đơn mới.
* Nếu `require_attachment = true`, đơn phải có file đính kèm.
* Nếu `deduct_balance = true`, hệ thống kiểm tra và trừ leave balance.

---

### 13.9 LEAVE-SCREEN-011: Cấu hình chính sách nghỉ phép

#### Mục đích

Cho phép HR/Admin cấu hình chính sách nghỉ phép.

#### Cấu hình cần hỗ trợ trong MVP

| Trường                  | Kiểu dữ liệu    | Mô tả                                 |
| ----------------------- | --------------- | ------------------------------------- |
| policy_name             | String          | Tên chính sách                        |
| apply_scope             | Select          | Company/Department/Employee Group     |
| annual_leave_days       | Decimal         | Số ngày phép năm                      |
| accrual_method          | Select          | Yearly/Monthly/Manual                 |
| allow_negative_balance  | Boolean         | Cho nghỉ âm phép không                |
| max_negative_days       | Decimal         | Số ngày âm phép tối đa                |
| allow_carry_forward     | Boolean         | Có chuyển phép sang năm sau không     |
| max_carry_forward_days  | Decimal         | Số ngày chuyển tối đa                 |
| carry_forward_expiry    | Date/Month      | Hạn dùng phép chuyển                  |
| probation_can_use_leave | Boolean         | Thử việc có được dùng phép không      |
| include_weekend         | Boolean         | Có tính cuối tuần vào ngày nghỉ không |
| include_holiday         | Boolean         | Có tính ngày lễ vào ngày nghỉ không   |
| approval_flow_type      | Select          | Manager Only/Manager + HR             |
| status                  | Active/Inactive | Trạng thái                            |

#### Quy tắc ưu tiên chính sách

```text
Chính sách riêng nhân viên
→ Chính sách phòng ban
→ Chính sách công ty
→ Chính sách mặc định hệ thống
```

---

### 13.10 LEAVE-SCREEN-012: Số dư phép nhân viên

#### Mục đích

Cho phép HR/Admin xem số dư phép của nhân viên.

#### Bộ lọc

| Bộ lọc               | Mô tả                     |
| -------------------- | ------------------------- |
| Năm                  | Năm phép                  |
| Phòng ban            | Lọc theo phòng ban        |
| Nhân viên            | Tìm theo tên/mã nhân viên |
| Loại phép            | Annual/Compensatory/...   |
| Trạng thái nhân viên | Active/Resigned/...       |

#### Cột hiển thị

| Cột                 | Mô tả                    |
| ------------------- | ------------------------ |
| Nhân viên           | employee_name            |
| Mã nhân viên        | employee_code            |
| Phòng ban           | department_name          |
| Loại phép           | leave_type               |
| Năm                 | balance_year             |
| Được cấp            | total_granted            |
| Chuyển từ năm trước | carried_forward          |
| Đã dùng             | used                     |
| Chờ duyệt           | pending                  |
| Điều chỉnh          | adjusted                 |
| Còn lại             | remaining                |
| Hành động           | Xem giao dịch/Điều chỉnh |

---

### 13.11 LEAVE-SCREEN-013: Điều chỉnh số dư phép

#### Mục đích

Cho phép HR/Admin cộng hoặc trừ số ngày phép thủ công.

#### Trường dữ liệu

| Trường          | Kiểu dữ liệu | Bắt buộc | Ghi chú                |
| --------------- | ------------ | -------- | ---------------------- |
| employee_id     | Select       | Có       | Nhân viên              |
| leave_type_id   | Select       | Có       | Loại phép              |
| balance_year    | Number       | Có       | Năm phép               |
| adjustment_type | Select       | Có       | Add/Subtract/Set       |
| adjustment_days | Decimal      | Có       | Số ngày điều chỉnh     |
| reason          | Text         | Có       | Lý do                  |
| effective_date  | Date         | Có       | Ngày hiệu lực          |
| attachment      | File         | Không    | File chứng minh nếu có |

#### Quy tắc

* Điều chỉnh phải ghi balance transaction.
* Điều chỉnh phải ghi audit log.
* Không cho số dư âm nếu policy không cho phép.
* Chỉ người có quyền `LEAVE.BALANCE.ADJUST` mới được thao tác.

---

## 14. Chi tiết chức năng

### 14.1 LEAVE-FUNC-001: Xem số ngày phép còn lại của tôi

#### Mục tiêu

Cho phép Employee xem số ngày phép còn lại của chính mình.

#### Người dùng

* Employee
* Manager
* HR
* Admin
* Super Admin

#### Điều kiện trước

* User đã đăng nhập.
* User có liên kết với employee.
* User có quyền `LEAVE.BALANCE.VIEW_OWN`.

#### Dữ liệu hiển thị

| Trường         | Mô tả                  |
| -------------- | ---------------------- |
| leave_type     | Loại phép              |
| year           | Năm                    |
| total_granted  | Tổng phép được cấp     |
| used_days      | Số ngày đã dùng        |
| pending_days   | Số ngày đang chờ duyệt |
| adjusted_days  | Số ngày điều chỉnh     |
| remaining_days | Số ngày còn lại        |
| expiry_date    | Ngày hết hạn nếu có    |

#### Tiêu chí nghiệm thu

* Employee xem được số ngày phép của chính mình.
* Employee không xem được số ngày phép của người khác.
* Số ngày còn lại phải tính đúng theo đơn Approved và Pending.
* Nếu không có dữ liệu balance, hệ thống hiển thị trạng thái phù hợp.

---

### 14.2 LEAVE-FUNC-002: Tạo đơn nghỉ phép

#### Mục tiêu

Cho phép Employee tạo đơn nghỉ phép mới.

#### Điều kiện trước

* User đã đăng nhập.
* User có liên kết employee.
* Employee đang ở trạng thái được phép tạo đơn.
* User có quyền `LEAVE.REQUEST.CREATE`.

#### Luồng chính

1. Employee vào màn hình Tạo đơn nghỉ.
2. Chọn loại nghỉ.
3. Chọn thời lượng nghỉ.
4. Chọn ngày/giờ nghỉ.
5. Nhập lý do.
6. Upload file nếu cần.
7. Hệ thống tính số ngày nghỉ.
8. Hệ thống kiểm tra số dư phép.
9. Employee gửi đơn.
10. Hệ thống tạo leave request trạng thái Pending.
11. Hệ thống xác định approver.
12. Hệ thống gửi thông báo.

#### Tiêu chí nghiệm thu

* Employee tạo được đơn với dữ liệu hợp lệ.
* Hệ thống tự tính số ngày nghỉ.
* Hệ thống chặn nếu đơn trùng thời gian với đơn khác.
* Hệ thống chặn hoặc cảnh báo nếu vượt số dư phép theo chính sách.
* Đơn sau khi gửi có trạng thái Pending.

---

### 14.3 LEAVE-FUNC-003: Lưu nháp đơn nghỉ phép

#### Mục tiêu

Cho phép Employee lưu đơn ở trạng thái Draft trước khi gửi duyệt.

#### Quy tắc

* Đơn Draft chưa gửi cho người duyệt.
* Đơn Draft chưa trừ số dư phép.
* Employee có thể sửa hoặc xóa Draft.
* Draft có thể có thời hạn tự động xóa nếu cấu hình.

#### Tiêu chí nghiệm thu

* Lưu nháp thành công.
* Draft hiển thị trong danh sách đơn của tôi.
* Draft không xuất hiện ở danh sách chờ duyệt.
* Draft không ảnh hưởng leave balance.

---

### 14.4 LEAVE-FUNC-004: Gửi đơn nghỉ phép

#### Mục tiêu

Chuyển đơn Draft hoặc đơn mới sang trạng thái Pending.

#### Luồng chính

```text
Employee bấm Gửi đơn
→ Hệ thống validate dữ liệu
→ Hệ thống kiểm tra số dư phép
→ Hệ thống kiểm tra trùng thời gian
→ Hệ thống xác định approver
→ Hệ thống chuyển trạng thái Pending
→ Hệ thống ghi submitted_at
→ Hệ thống gửi notification
```

#### Tiêu chí nghiệm thu

* Gửi đơn thành công khi hợp lệ.
* Đơn chuyển sang Pending.
* Người duyệt nhận thông báo.
* Đơn Pending được tính vào pending_days nếu loại nghỉ trừ phép.

---

### 14.5 LEAVE-FUNC-005: Xem danh sách đơn nghỉ của tôi

#### Mục tiêu

Cho phép Employee xem toàn bộ đơn nghỉ của chính mình.

#### Tiêu chí nghiệm thu

* Employee xem được danh sách đơn của mình.
* Có bộ lọc trạng thái, loại nghỉ, thời gian.
* Employee không xem được đơn của người khác.
* Danh sách có phân trang.

---

### 14.6 LEAVE-FUNC-006: Xem chi tiết đơn nghỉ

#### Mục tiêu

Cho phép người dùng xem chi tiết đơn nghỉ theo quyền.

#### Quy tắc

* Employee chỉ xem đơn của chính mình.
* Manager xem đơn của nhân viên thuộc team.
* HR xem đơn trong phạm vi quyền.
* Dữ liệu lý do nghỉ và file đính kèm có thể ẩn nếu không có quyền.

#### Tiêu chí nghiệm thu

* Người có quyền xem được chi tiết đơn.
* Người không có quyền bị chặn.
* Lịch sử xử lý hiển thị đúng.

---

### 14.7 LEAVE-FUNC-007: Hủy đơn nghỉ của chính mình

#### Mục tiêu

Cho phép Employee hủy đơn nghỉ của mình theo rule.

#### Quy tắc hủy

| Trạng thái | Cho phép hủy | Ghi chú                        |
| ---------- | ------------ | ------------------------------ |
| Draft      | Có           | Xóa hoặc chuyển Cancelled      |
| Pending    | Có           | Thông báo cho người duyệt      |
| Approved   | Tùy cấu hình | Có thể cần HR/Manager xác nhận |
| Rejected   | Không cần    | Đã kết thúc                    |
| Cancelled  | Không        | Đã hủy                         |

#### Tiêu chí nghiệm thu

* Employee hủy được đơn Draft/Pending.
* Đơn chuyển sang Cancelled.
* Nếu đơn Approved bị hủy, hệ thống hoàn số dư phép nếu cấu hình cho phép.
* Nếu đơn đã đồng bộ bảng công, hệ thống cập nhật lại bảng công.

---

### 14.8 LEAVE-FUNC-008: Xem danh sách đơn chờ duyệt

#### Mục tiêu

Cho phép Manager/HR xem các đơn Pending cần xử lý.

#### Quy tắc

* Manager chỉ thấy đơn của nhân viên thuộc team/scope.
* HR có thể thấy đơn toàn công ty nếu có quyền.
* Super Admin thấy toàn bộ.

#### Tiêu chí nghiệm thu

* Manager thấy đúng đơn cần duyệt.
* Không thấy đơn ngoài scope.
* Có bộ lọc và phân trang.
* Có hành động Duyệt/Từ chối trên đơn Pending.

---

### 14.9 LEAVE-FUNC-009: Duyệt đơn nghỉ phép

#### Mục tiêu

Cho phép Manager/HR duyệt đơn nghỉ phép.

#### Luồng chính

```text
Người duyệt mở đơn Pending
→ Kiểm tra thông tin đơn
→ Bấm Duyệt
→ Hệ thống kiểm tra quyền
→ Hệ thống kiểm tra trạng thái đơn
→ Hệ thống kiểm tra số dư phép lần cuối
→ Hệ thống chuyển trạng thái Approved
→ Hệ thống ghi approved_by, approved_at
→ Hệ thống cập nhật leave balance
→ Hệ thống đồng bộ attendance
→ Hệ thống gửi notification cho Employee
→ Hệ thống ghi audit log
```

#### Quy tắc

* Chỉ đơn Pending mới được duyệt.
* Không duyệt nếu đã bị hủy hoặc xử lý.
* Không duyệt nếu số dư phép không đủ, trừ khi chính sách cho phép âm phép.
* **MUST (BẮT BUỘC, hard-rule):** người duyệt KHÔNG được là chính người tạo/người xin nghỉ của đơn. Backend phải chặn self-approval ở tầng service (không chỉ ẩn nút ở frontend); vi phạm trả `LEAVE-ERR-APPROVER-INVALID` (HTTP 422). Quy tắc này khớp BACKEND-07 §22.3 và là crown-jewel của workflow phê duyệt.
* Duyệt xong không được sửa nội dung đơn, chỉ có thể hủy/thu hồi theo quyền.

#### Tiêu chí nghiệm thu

* Duyệt thành công đơn Pending hợp lệ.
* Đơn chuyển sang Approved.
* Leave balance cập nhật đúng.
* Attendance record được cập nhật đúng.
* Employee nhận thông báo.
* Audit log ghi đầy đủ.

---

### 14.10 LEAVE-FUNC-010: Từ chối đơn nghỉ phép

#### Mục tiêu

Cho phép Manager/HR từ chối đơn nghỉ.

#### Luồng chính

```text
Người duyệt mở đơn Pending
→ Bấm Từ chối
→ Nhập lý do từ chối
→ Hệ thống kiểm tra quyền
→ Hệ thống chuyển trạng thái Rejected
→ Hệ thống ghi rejected_by, rejected_at, rejection_reason
→ Hệ thống gửi notification cho Employee
→ Hệ thống ghi audit log
```

#### Quy tắc

* Từ chối bắt buộc nhập lý do.
* Đơn Rejected không trừ số dư phép.
* Đơn Rejected không đồng bộ sang chấm công.
* Đơn Rejected không được duyệt lại, trừ khi có chức năng mở lại ở phase sau.

#### Tiêu chí nghiệm thu

* Từ chối thành công đơn Pending.
* Bắt buộc nhập lý do.
* Employee nhận thông báo.
* Leave balance không thay đổi.
* Audit log ghi đầy đủ.

---

### 14.11 LEAVE-FUNC-011: Xem lịch nghỉ của tôi

#### Mục tiêu

Cho phép Employee xem lịch nghỉ của chính mình dưới dạng calendar.

#### Người dùng

* Employee
* Manager
* HR
* Admin
* Super Admin

#### Điều kiện trước

* User đã đăng nhập.
* User có liên kết với employee.
* User có quyền `LEAVE.CALENDAR.VIEW_OWN`.

#### Quy tắc

* Chỉ hiển thị đơn nghỉ của chính user.
* Mặc định hiển thị đơn Approved, có thể bật xem đơn Pending.
* Hỗ trợ chế độ xem Month/Week/Day/List.
* Phân biệt loại nghỉ bằng màu hoặc nhãn.
* Có thể ẩn lý do nghỉ nếu công ty coi là thông tin riêng tư.

#### Tiêu chí nghiệm thu

* Employee xem được lịch nghỉ của chính mình.
* Employee không xem được lịch nghỉ của người khác.
* Lịch hiển thị đúng đơn Approved trong khoảng thời gian được chọn.
* Đổi chế độ xem hoạt động đúng.

---

### 14.12 LEAVE-FUNC-012: Xem lịch nghỉ của team

#### Mục tiêu

Cho phép Manager/HR xem lịch nghỉ của nhân viên thuộc team/scope quản lý.

#### Người dùng

* Manager
* HR
* Admin
* Super Admin

#### Điều kiện trước

* User đã đăng nhập.
* User có quyền `LEAVE.CALENDAR.VIEW_TEAM`.

#### Quy tắc

* Manager chỉ thấy nhân viên thuộc team/scope của mình.
* HR thấy team theo phạm vi quyền được cấp.
* Mặc định hiển thị đơn Approved, có thể bật xem đơn Pending nếu có quyền.
* Có thể lọc theo phòng ban, nhân viên, loại nghỉ, trạng thái.
* Phân biệt loại nghỉ bằng màu hoặc nhãn.

#### Tiêu chí nghiệm thu

* Manager xem được lịch nghỉ của team.
* Không hiển thị nhân viên ngoài scope.
* Lịch hiển thị đúng đơn Approved.
* Bộ lọc hoạt động đúng.

---

### 14.13 LEAVE-FUNC-013: Xem lịch nghỉ toàn công ty

#### Mục tiêu

Cho phép HR/Admin xem lịch nghỉ của toàn bộ nhân viên trong phạm vi quyền.

#### Người dùng

* HR
* Admin
* Super Admin

#### Điều kiện trước

* User đã đăng nhập.
* User có quyền `LEAVE.CALENDAR.VIEW_COMPANY`.

#### Quy tắc

* Hiển thị toàn bộ nhân viên theo data scope Company.
* Mặc định hiển thị đơn Approved, có thể bật xem đơn Pending nếu có quyền.
* Có thể lọc theo phòng ban, nhân viên, loại nghỉ, trạng thái.
* Employee không được truy cập màn hình này.
* Phân biệt loại nghỉ bằng màu hoặc nhãn.

#### Tiêu chí nghiệm thu

* HR xem được lịch nghỉ toàn công ty.
* Dữ liệu tuân thủ data scope.
* Lịch hiển thị đúng đơn Approved.
* Bộ lọc theo phòng ban/nhân viên/loại nghỉ/trạng thái hoạt động đúng.

---

### 14.14 LEAVE-FUNC-014: Quản lý loại nghỉ phép

#### Mục tiêu

Cho phép HR/Admin cấu hình loại nghỉ phép.

#### Tiêu chí nghiệm thu

* Tạo được loại nghỉ mới.
* Không tạo được mã loại nghỉ trùng.
* Cập nhật được loại nghỉ.
* Không xóa cứng loại nghỉ đã có đơn phát sinh.
* Loại nghỉ inactive không xuất hiện khi tạo đơn mới.

---

### 14.15 LEAVE-FUNC-015: Quản lý chính sách ngày phép

#### Mục tiêu

Cho phép HR/Admin cấu hình chính sách nghỉ phép.

#### Tiêu chí nghiệm thu

* Tạo/cập nhật được chính sách nghỉ phép.
* Chính sách áp dụng đúng theo scope.
* Chính sách nhân viên ưu tiên hơn phòng ban.
* Chính sách phòng ban ưu tiên hơn công ty.
* Thay đổi chính sách không làm sai dữ liệu đơn đã phát sinh.
* Thao tác cập nhật chính sách được ghi audit log.

---

### 14.16 LEAVE-FUNC-016: Quản lý số dư phép nhân viên

#### Mục tiêu

Cho phép HR/Admin xem và quản lý leave balance của nhân viên.

#### Tiêu chí nghiệm thu

* HR xem được số dư phép theo năm.
* Có thể lọc theo phòng ban/nhân viên/loại phép.
* Số dư phản ánh đúng đơn Approved và Pending.
* Dữ liệu tuân thủ data scope.

---

### 14.17 LEAVE-FUNC-017: Điều chỉnh số dư phép

#### Mục tiêu

Cho phép HR/Admin cộng/trừ/set lại số dư phép.

#### Quy tắc

* Bắt buộc nhập lý do.
* Mỗi lần điều chỉnh tạo một transaction.
* Không cho điều chỉnh nếu không có quyền.
* Không làm số dư âm nếu policy không cho phép.

#### Tiêu chí nghiệm thu

* Điều chỉnh thành công khi hợp lệ.
* Transaction được ghi nhận.
* Leave balance cập nhật đúng.
* Audit log ghi đầy đủ.

---

### 14.18 LEAVE-FUNC-018: Đồng bộ nghỉ phép sang chấm công

#### Mục tiêu

Đảm bảo đơn nghỉ Approved ảnh hưởng chính xác đến bảng công.

#### Quy tắc đồng bộ

| Loại nghỉ              | Tác động đến ATT                                                     |
| ---------------------- | -------------------------------------------------------------------- |
| Nghỉ cả ngày           | Attendance status = Leave                                            |
| Nghỉ buổi sáng         | Chặn/tính nghỉ buổi sáng, cho phép công buổi chiều                   |
| Nghỉ buổi chiều        | Cho phép công buổi sáng, không tính về sớm nếu check-out trước chiều |
| Nghỉ theo giờ          | Giảm required working minutes theo số giờ nghỉ                       |
| Đơn Pending            | Không cập nhật attendance, chỉ có thể cảnh báo                       |
| Đơn Rejected/Cancelled | Không tính vào attendance                                            |

#### Tiêu chí nghiệm thu

* Đơn Approved cập nhật đúng bảng công.
* Check-in bị chặn nếu nghỉ cả ngày.
* Nghỉ nửa ngày không bị tính sai đi muộn/về sớm.
* Hủy đơn Approved cập nhật lại bảng công nếu cấu hình cho phép.
* Dữ liệu đồng bộ có thể truy vết.

---

### 14.19 LEAVE-FUNC-019: Gửi thông báo nghỉ phép

#### Mục tiêu

Tự động gửi thông báo qua module `NOTI` khi có sự kiện nghỉ phép, theo danh sách sự kiện tại §19.

#### Người dùng

* Hệ thống (tự động).
* Người nhận: Employee, Manager/Approver, HR theo từng sự kiện.

#### Điều kiện trước

* Module `NOTI` sẵn sàng.
* Sự kiện nghỉ phép phát sinh (gửi đơn, duyệt, từ chối, hủy, sắp tới ngày nghỉ, số dư phép thấp, điều chỉnh số dư).

#### Quy tắc

* Sự kiện và người nhận tuân theo bảng tại §19.1.
* Nội dung thông báo theo mẫu tại §19.2.
* Mỗi sự kiện chỉ gửi đúng người nhận theo data scope.
* Gửi đơn nghỉ → thông báo cho Manager/Approver.
* Đơn được duyệt/bị từ chối → thông báo cho Employee.
* Employee hủy đơn Pending → thông báo cho Manager/Approver.
* HR hủy/thu hồi đơn Approved → thông báo cho Employee và Manager.
* Số ngày phép thấp và điều chỉnh số dư → thông báo cho Employee.

#### Tiêu chí nghiệm thu

* Đúng sự kiện kích hoạt đúng thông báo theo §19.1.
* Đúng người nhận theo từng sự kiện.
* Nội dung thông báo đúng mẫu tại §19.2.
* Thông báo không gửi sai phạm vi người dùng.

---

### 14.20 LEAVE-FUNC-020: Xem lịch sử xử lý đơn nghỉ

#### Mục tiêu

Cho phép HR/Admin xem lịch sử xử lý (audit log) của đơn nghỉ và các thao tác nghỉ phép, theo danh sách hành động tại §20.

#### Người dùng

* HR
* Admin
* Super Admin

#### Điều kiện trước

* User đã đăng nhập.
* User có quyền `LEAVE.AUDIT_LOG.VIEW`.

#### Dữ liệu hiển thị

| Trường      | Mô tả                  |
| ----------- | ---------------------- |
| actor_id    | Người thực hiện        |
| action      | Hành động (theo §20.1) |
| target_type | Loại đối tượng         |
| target_id   | ID đối tượng           |
| old_value   | Dữ liệu trước          |
| new_value   | Dữ liệu sau            |
| created_at  | Thời gian thao tác     |

#### Quy tắc

* Hành động được ghi log theo danh sách tại §20.1.
* Thông tin log lưu theo §20.2.
* Chỉ người có quyền `LEAVE.AUDIT_LOG.VIEW` mới xem được.
* Log là dữ liệu chỉ đọc, không cho sửa/xóa.
* Dữ liệu log tuân thủ data scope.

#### Tiêu chí nghiệm thu

* Mọi thao tác tạo/gửi/duyệt/từ chối/hủy đơn và điều chỉnh số dư đều có log.
* Người có quyền xem được lịch sử xử lý đơn.
* Người không có quyền bị chặn.
* Log hiển thị đúng actor, action, thời gian và thay đổi dữ liệu.

---

### 14.21 LEAVE-FUNC-021: Xuất dữ liệu nghỉ phép

#### Mục tiêu

Cho phép HR/Admin xuất dữ liệu đơn nghỉ phép theo bộ lọc.

#### Người dùng

* HR
* Admin
* Super Admin

#### Điều kiện trước

* User đã đăng nhập.
* User có quyền `LEAVE.REQUEST.EXPORT`.

#### Quy tắc

* Cho phép xuất theo bộ lọc trạng thái, loại nghỉ, phòng ban, thời gian nghỉ, ngày gửi, ngày xử lý.
* Dữ liệu xuất chỉ trong phạm vi data scope của người dùng.
* Thao tác xuất phải ghi audit log (`LEAVE_EXPORT`).
* File nhạy cảm/thông tin riêng tư xử lý theo quy tắc phân quyền.

#### Tiêu chí nghiệm thu

* Người có quyền `LEAVE.REQUEST.EXPORT` xuất được dữ liệu.
* Người không có quyền bị chặn.
* Dữ liệu xuất khớp với bộ lọc đã chọn.
* Dữ liệu không vượt quá data scope.
* Thao tác xuất được ghi audit log.

---

## 15. Quy tắc nghiệp vụ chi tiết

### 15.1 Quy tắc nhân viên được tạo đơn nghỉ

Nhân viên được tạo đơn nghỉ nếu:

* Có tài khoản đăng nhập hợp lệ.
* Tài khoản liên kết với employee.
* Employee đang ở trạng thái cho phép nghỉ.
* Có quyền `LEAVE.REQUEST.CREATE`.
* Loại nghỉ đang Active.
* Không có đơn nghỉ trùng thời gian.
* Không vi phạm chính sách nghỉ.

Trạng thái nhân viên:

| Trạng thái nhân viên  | Cho phép tạo đơn nghỉ      |
| --------------------- | -------------------------- |
| Probation             | Theo chính sách            |
| Official              | Có                         |
| Temporarily Suspended | Không hoặc theo chính sách |
| Resigned              | Không                      |
| Terminated            | Không                      |

---

### 15.2 Quy tắc tính số ngày nghỉ

Hệ thống cần tính số ngày nghỉ dựa trên:

* Ngày bắt đầu.
* Ngày kết thúc.
* Loại thời lượng: full day, half day, hourly.
* Lịch làm việc.
* Ngày nghỉ cuối tuần.
* Ngày lễ.
* Ca làm của nhân viên.
* Chính sách có tính ngày nghỉ lễ/cuối tuần không.

Ví dụ:

```text
Nhân viên nghỉ từ thứ Hai đến thứ Tư
Không có ngày lễ
Mỗi ngày là ngày làm việc
→ calculated_days = 3
```

Ví dụ có cuối tuần:

```text
Nghỉ từ thứ Sáu đến thứ Hai
Thứ Bảy, Chủ Nhật là ngày nghỉ
Policy không tính cuối tuần
→ calculated_days = 2
```

Ví dụ nghỉ nửa ngày:

```text
Nghỉ buổi sáng thứ Hai
→ calculated_days = 0.5
```

Ví dụ nghỉ theo giờ:

```text
Nghỉ từ 09:00 đến 11:00
Ca làm 8 giờ/ngày
→ calculated_days = 0.25 nếu quy đổi 8 giờ = 1 ngày
```

---

### 15.3 Quy tắc kiểm tra trùng đơn nghỉ

Hệ thống không cho tạo đơn nếu khoảng nghỉ trùng với:

* Đơn Pending.
* Đơn Approved.
* Đơn đang trong workflow xử lý.
* Đơn Draft có thể không cần chặn, nhưng cần cảnh báo.

Không tính trùng với:

* Đơn Rejected.
* Đơn Cancelled.

---

### 15.4 Quy tắc kiểm tra số dư phép

Nếu loại nghỉ có `deduct_balance = true`, hệ thống cần kiểm tra:

```text
available_days = total_granted + carried_forward + adjusted_days - used_days - pending_days
```

Khi gửi đơn:

```text
Nếu calculated_days > available_days
→ Chặn hoặc cảnh báo theo policy
```

Nếu policy cho nghỉ âm phép:

```text
calculated_days <= available_days + max_negative_days
```

---

### 15.5 Quy tắc cập nhật số dư phép

Khi đơn chuyển sang Approved:

* `used_days` tăng.
* `remaining_days` giảm.
* Nếu trước đó đơn Pending đã được tính vào pending_days, pending_days giảm.

Khi đơn Pending bị Rejected:

* `pending_days` giảm nếu đã giữ chỗ số dư.

Khi đơn Pending bị Cancelled:

* `pending_days` giảm nếu đã giữ chỗ số dư.

Khi đơn Approved bị Cancelled/Revoked:

* `used_days` giảm.
* `remaining_days` tăng.
* Cần cập nhật lại attendance nếu đã đồng bộ.

---

### 15.6 Quy tắc người duyệt

MVP đề xuất:

```text
Approver mặc định = direct_manager_id của employee
```

Nếu employee không có direct manager:

```text
Approver = HR mặc định hoặc nhóm HR có quyền duyệt
```

Nếu người tạo đơn là Manager:

```text
Approver = manager cấp trên nếu có
Hoặc HR/Admin theo cấu hình
```

Nếu người tạo đơn là HR:

```text
Approver = direct manager hoặc Admin công ty theo cấu hình
```

---

### 15.7 Quy tắc duyệt đơn

* Chỉ người có quyền mới được duyệt.
* Manager chỉ duyệt đơn trong scope Team.
* HR duyệt đơn theo scope Company nếu có quyền.
* Không duyệt đơn đã bị xử lý.
* Không duyệt đơn có dữ liệu không hợp lệ.
* Khi duyệt phải kiểm tra lại balance để tránh race condition.
* Duyệt thành công phải ghi audit log.

---

### 15.8 Quy tắc từ chối đơn

* Chỉ đơn Pending mới được từ chối.
* Bắt buộc nhập lý do.
* Từ chối không trừ phép.
* Từ chối phải gửi thông báo cho người tạo.
* Từ chối phải ghi audit log.

---

### 15.9 Quy tắc file đính kèm

Một số loại nghỉ có thể yêu cầu file:

| Loại nghỉ     | File gợi ý                               |
| ------------- | ---------------------------------------- |
| Nghỉ ốm       | Giấy khám bệnh                           |
| Nghỉ thai sản | Giấy xác nhận                            |
| Nghỉ tang     | Giấy tờ liên quan nếu công ty yêu cầu    |
| Nghỉ kết hôn  | Giấy đăng ký kết hôn nếu công ty yêu cầu |

Quy tắc upload:

* Giới hạn định dạng file.
* Giới hạn dung lượng.
* File nhạy cảm chỉ người có quyền mới xem.
* Xóa file nên là xóa mềm.
* Upload/xóa file phải ghi audit log nếu cấu hình.

---

## 16. Dữ liệu cần lưu

### 16.1 Bảng leave_types

| Trường               | Kiểu dữ liệu | Bắt buộc | Ghi chú                 |
| -------------------- | ------------ | -------- | ----------------------- |
| id                   | UUID/Integer | Có       | ID loại nghỉ            |
| leave_type_code      | String       | Có       | Unique                  |
| leave_type_name      | String       | Có       | Tên loại nghỉ           |
| description          | Text         | Không    | Mô tả                   |
| is_paid              | Boolean      | Có       | Có hưởng lương không    |
| deduct_balance       | Boolean      | Có       | Có trừ phép không       |
| require_attachment   | Boolean      | Có       | Có bắt buộc file không  |
| require_reason       | Boolean      | Có       | Có bắt buộc lý do không |
| allow_half_day       | Boolean      | Có       | Cho nghỉ nửa ngày       |
| allow_hourly         | Boolean      | Có       | Cho nghỉ theo giờ       |
| min_notice_days      | Integer      | Không    | Số ngày báo trước       |
| max_days_per_request | Decimal      | Không    | Số ngày tối đa mỗi đơn  |
| status               | String       | Có       | Active/Inactive         |
| created_at           | DateTime     | Có       |                         |
| updated_at           | DateTime     | Có       |                         |
| created_by           | UUID/Integer | Không    |                         |
| updated_by           | UUID/Integer | Không    |                         |

---

### 16.2 Bảng leave_policies

| Trường                    | Kiểu dữ liệu | Bắt buộc             | Ghi chú                     |
| ------------------------- | ------------ | -------------------- | --------------------------- |
| id                        | UUID/Integer | Có                   | ID chính sách               |
| policy_name               | String       | Có                   | Tên chính sách              |
| company_id                | UUID/Integer | Có nếu multi-company | Công ty                     |
| apply_scope               | String       | Có                   | Company/Department/Employee |
| department_id             | UUID/Integer | Không                | Nếu áp dụng phòng ban       |
| employee_id               | UUID/Integer | Không                | Nếu áp dụng cá nhân         |
| annual_leave_days         | Decimal      | Có                   | Số ngày phép năm            |
| accrual_method            | String       | Có                   | Yearly/Monthly/Manual       |
| allow_negative_balance    | Boolean      | Có                   | Cho âm phép không           |
| max_negative_days         | Decimal      | Không                | Số ngày âm tối đa           |
| allow_carry_forward       | Boolean      | Có                   | Cho chuyển phép không       |
| max_carry_forward_days    | Decimal      | Không                | Số ngày chuyển tối đa       |
| carry_forward_expiry_date | Date         | Không                | Hạn dùng phép chuyển        |
| probation_can_use_leave   | Boolean      | Có                   | Thử việc có dùng phép không |
| include_weekend           | Boolean      | Có                   | Có tính cuối tuần không     |
| include_holiday           | Boolean      | Có                   | Có tính ngày lễ không       |
| approval_flow_type        | String       | Có                   | Manager Only/Manager + HR   |
| status                    | String       | Có                   | Active/Inactive             |
| created_at                | DateTime     | Có                   |                             |
| updated_at                | DateTime     | Có                   |                             |

---

### 16.3 Bảng leave_balances

| Trường          | Kiểu dữ liệu | Bắt buộc | Ghi chú               |
| --------------- | ------------ | -------- | --------------------- |
| id              | UUID/Integer | Có       | ID balance            |
| employee_id     | UUID/Integer | Có       | Nhân viên             |
| leave_type_id   | UUID/Integer | Có       | Loại phép             |
| balance_year    | Integer      | Có       | Năm                   |
| total_granted   | Decimal      | Có       | Tổng phép cấp         |
| carried_forward | Decimal      | Có       | Phép chuyển năm trước |
| used_days       | Decimal      | Có       | Đã dùng               |
| pending_days    | Decimal      | Có       | Đang chờ duyệt        |
| adjusted_days   | Decimal      | Có       | Điều chỉnh            |
| expired_days    | Decimal      | Có       | Đã hết hạn            |
| remaining_days  | Decimal      | Có       | Còn lại               |
| status          | String       | Có       | Active/Closed         |
| created_at      | DateTime     | Có       |                       |
| updated_at      | DateTime     | Có       |                       |

---

### 16.4 Bảng leave_requests

| Trường           | Kiểu dữ liệu | Bắt buộc | Ghi chú                                   |
| ---------------- | ------------ | -------- | ----------------------------------------- |
| id               | UUID/Integer | Có       | ID đơn                                    |
| request_code     | String       | Có       | Mã đơn                                    |
| employee_id      | UUID/Integer | Có       | Người nghỉ                                |
| requested_by     | UUID/Integer | Có       | User tạo đơn                              |
| leave_type_id    | UUID/Integer | Có       | Loại nghỉ                                 |
| duration_type    | String       | Có       | Full Day/Half Day/Hourly                  |
| start_date       | Date         | Có       | Ngày bắt đầu                              |
| end_date         | Date         | Có       | Ngày kết thúc                             |
| start_time       | Time         | Không    | Nếu nghỉ theo giờ                         |
| end_time         | Time         | Không    | Nếu nghỉ theo giờ                         |
| half_day_session | String       | Không    | Morning/Afternoon                         |
| calculated_days  | Decimal      | Có       | Số ngày nghỉ                              |
| calculated_hours | Decimal      | Không    | Số giờ nghỉ                               |
| reason           | Text         | Không    | Lý do                                     |
| handover_note    | Text         | Không    | Ghi chú bàn giao                          |
| status           | String       | Có       | Draft/Pending/Approved/Rejected/Cancelled |
| approver_id      | UUID/Integer | Không    | Người duyệt chính                         |
| submitted_at     | DateTime     | Không    | Thời gian gửi                             |
| approved_by      | UUID/Integer | Không    | Người duyệt                               |
| approved_at      | DateTime     | Không    | Thời gian duyệt                           |
| rejected_by      | UUID/Integer | Không    | Người từ chối                             |
| rejected_at      | DateTime     | Không    | Thời gian từ chối                         |
| rejection_reason | Text         | Không    | Lý do từ chối                             |
| cancelled_by     | UUID/Integer | Không    | Người hủy                                 |
| cancelled_at     | DateTime     | Không    | Thời gian hủy                             |
| cancel_reason    | Text         | Không    | Lý do hủy                                 |
| created_at       | DateTime     | Có       |                                           |
| updated_at       | DateTime     | Có       |                                           |
| created_by       | UUID/Integer | Không    |                                           |
| updated_by       | UUID/Integer | Không    |                                           |

---

### 16.5 Bảng leave_request_approvals

| Trường           | Kiểu dữ liệu | Bắt buộc | Ghi chú                           |
| ---------------- | ------------ | -------- | --------------------------------- |
| id               | UUID/Integer | Có       | ID approval                       |
| leave_request_id | UUID/Integer | Có       | Đơn nghỉ                          |
| approver_id      | UUID/Integer | Có       | Người duyệt                       |
| approval_level   | Integer      | Có       | Cấp duyệt                         |
| status           | String       | Có       | Pending/Approved/Rejected/Skipped |
| comment          | Text         | Không    | Ghi chú xử lý                     |
| acted_at         | DateTime     | Không    | Thời gian xử lý                   |
| created_at       | DateTime     | Có       |                                   |
| updated_at       | DateTime     | Có       |                                   |

---

### 16.6 File đính kèm đơn nghỉ — dùng file service chung (KHÔNG có bảng `leave_request_files`)

> **LV-9 (chuẩn = DB-05 §13.1):** module LEAVE **không** có bảng `leave_request_files` riêng. File chứng minh được lưu ở bảng `files` chung (Foundation) và liên kết với đơn nghỉ qua bảng link chung `file_links` (`entity_type = 'leave_request'`, `entity_id = leave_request_id`). LEAVE không nhúng metadata file (`file_url`/`mime_type`/`file_size`) — chỉ tham chiếu `file_id`. Quản lý file đi qua Leave File API (API-05 §12.9): link/unlink + signed URL ngắn hạn sau khi kiểm tra permission (`LEAVE.FILE.VIEW/UPLOAD/DELETE`) và data scope. Không trả storage path thật cho client.

---

### 16.7 Bảng leave_balance_transactions

| Trường           | Kiểu dữ liệu | Bắt buộc | Ghi chú                                              |
| ---------------- | ------------ | -------- | ---------------------------------------------------- |
| id               | UUID/Integer | Có       | ID transaction                                       |
| leave_balance_id | UUID/Integer | Có       | Balance liên quan                                    |
| employee_id      | UUID/Integer | Có       | Nhân viên                                            |
| leave_type_id    | UUID/Integer | Có       | Loại phép                                            |
| transaction_type | String       | Có       | UPPER_SNAKE (chuẩn DB-05 §7.4, 12 giá trị): OPENING/GRANT/ACCRUAL/RESERVE/RELEASE/USE/REFUND/ADJUSTMENT/EXPIRE/CARRY_OVER/IMPORT/SYSTEM_RECALCULATE |
| days             | Decimal      | Có       | Số ngày                                              |
| source_type      | String       | Có       | LeaveRequest/Manual/System                           |
| source_id        | UUID/Integer | Không    | ID nguồn                                             |
| reason           | Text         | Không    | Lý do                                                |
| created_by       | UUID/Integer | Không    | Người tạo                                            |
| created_at       | DateTime     | Có       |                                                      |

---

## 17. API chi tiết

> **Chuẩn API:** Mọi endpoint dưới đây tuân theo chuẩn response/error/pagination tại [SPEC-01](<SPEC-01 Tổng quan.md>) §19 — bao response `{success, data, message}`, lỗi `{success: false, error: {code, message}}`, phân trang đầy đủ `{page, limit, total, total_pages}`.
>
> **LV-11 — Path canonical = API-05 §5/§12.** Tất cả endpoint LEAVE dùng prefix `/api/v1/leave/...`. Bảng dưới đây giữ lại làm tham chiếu chức năng nhưng **base path cũ không còn là chuẩn**; ánh xạ:
> base `/api/v1/leave/requests` → `/api/v1/leave/requests` · danh sách của tôi → `/api/v1/leave/me/requests` · `/api/v1/leave/me/...` → `/api/v1/leave/me/...` · `/api/v1/leave/calendar` → `/api/v1/leave/calendar` · `/api/leave-types` → `/api/v1/leave/types` · `/api/leave-policies` → `/api/v1/leave/policies` · `/api/leave-balances` → `/api/v1/leave/balances`. Verb/endpoint chi tiết (submit/approve/reject/cancel/revoke…) lấy theo API-05 §12.

### 17.1 API lấy tổng quan nghỉ phép của tôi

| Trường     | Nội dung                                              |
| ---------- | ----------------------------------------------------- |
| Mã API     | LEAVE-API-001                                         |
| Method     | GET                                                   |
| Endpoint   | /api/v1/leave/me/overview                             |
| Permission | LEAVE.BALANCE.VIEW_OWN                                |
| Mục đích   | Lấy số dư phép và đơn nghỉ gần nhất của user hiện tại |

---

### 17.2 API lấy số dư phép của tôi

| Trường     | Nội dung                  |
| ---------- | ------------------------- |
| Mã API     | LEAVE-API-002             |
| Method     | GET                       |
| Endpoint   | /api/v1/leave/me/balances |
| Permission | LEAVE.BALANCE.VIEW_OWN    |
| Mục đích   | Xem leave balance cá nhân |

Query params:

```text
year
leave_type_id
```

---

### 17.3 API tạo đơn nghỉ

| Trường     | Nội dung             |
| ---------- | -------------------- |
| Mã API     | LEAVE-API-003        |
| Method     | POST                 |
| Endpoint   | /api/v1/leave/requests |
| Permission | LEAVE.REQUEST.CREATE |
| Mục đích   | Tạo đơn nghỉ mới     |

Request mẫu:

```json
{
  "leave_type_id": "lt_annual",
  "duration_type": "FULL_DAY",
  "start_date": "2026-07-01",
  "end_date": "2026-07-02",
  "reason": "Nghỉ việc cá nhân",
  "handover_note": "Đã bàn giao task cho Nguyễn Văn B"
}
```

---

### 17.4 API lưu nháp đơn nghỉ

| Trường     | Nội dung                        |
| ---------- | ------------------------------- |
| Mã API     | LEAVE-API-004                   |
| Method     | POST                            |
| Endpoint   | /api/v1/leave/requests (submit_now=false) |
| Permission | LEAVE.REQUEST.CREATE            |
| Mục đích   | Lưu đơn nghỉ ở trạng thái Draft |

---

### 17.5 API gửi đơn nghỉ

| Trường     | Nội dung                        |
| ---------- | ------------------------------- |
| Mã API     | LEAVE-API-005                   |
| Method     | POST                            |
| Endpoint   | /api/v1/leave/requests/{id}/submit |
| Permission | LEAVE.REQUEST.CREATE            |
| Mục đích   | Gửi đơn Draft sang Pending      |

---

### 17.6 API danh sách đơn nghỉ của tôi

| Trường     | Nội dung                                 |
| ---------- | ---------------------------------------- |
| Mã API     | LEAVE-API-006                            |
| Method     | GET                                      |
| Endpoint   | /api/v1/leave/me/requests                   |
| Permission | LEAVE.REQUEST.VIEW_OWN                   |
| Mục đích   | Xem danh sách đơn nghỉ của user hiện tại |

Query params:

```text
status
leave_type_id
from_date
to_date
page
limit
```

---

### 17.7 API xem chi tiết đơn nghỉ

| Trường     | Nội dung                                     |
| ---------- | -------------------------------------------- |
| Mã API     | LEAVE-API-007                                |
| Method     | GET                                          |
| Endpoint   | /api/v1/leave/requests/{id}                   |
| Permission | LEAVE.REQUEST.VIEW_OWN hoặc quyền theo scope |
| Mục đích   | Xem chi tiết đơn nghỉ                        |

---

### 17.8 API hủy đơn nghỉ của tôi

| Trường     | Nội dung                        |
| ---------- | ------------------------------- |
| Mã API     | LEAVE-API-008                   |
| Method     | POST                            |
| Endpoint   | /api/v1/leave/requests/{id}/cancel |
| Permission | LEAVE.REQUEST.CANCEL_OWN        |
| Mục đích   | Hủy đơn nghỉ của chính mình     |

Request mẫu:

```json
{
  "cancel_reason": "Không cần nghỉ nữa"
}
```

---

### 17.9 API danh sách đơn chờ duyệt

| Trường     | Nội dung                                        |
| ---------- | ----------------------------------------------- |
| Mã API     | LEAVE-API-009                                   |
| Method     | GET                                             |
| Endpoint   | /api/v1/leave/requests/pending-approvals        |
| Permission | LEAVE.REQUEST.APPROVE hoặc LEAVE.REQUEST.REJECT |
| Mục đích   | Lấy danh sách đơn chờ người dùng hiện tại duyệt |

---

### 17.10 API duyệt đơn nghỉ

| Trường     | Nội dung                         |
| ---------- | -------------------------------- |
| Mã API     | LEAVE-API-010                    |
| Method     | POST                             |
| Endpoint   | /api/v1/leave/requests/{id}/approve |
| Permission | LEAVE.REQUEST.APPROVE            |
| Mục đích   | Duyệt đơn nghỉ                   |

Request mẫu:

```json
{
  "comment": "Đồng ý"
}
```

---

### 17.11 API từ chối đơn nghỉ

| Trường     | Nội dung                        |
| ---------- | ------------------------------- |
| Mã API     | LEAVE-API-011                   |
| Method     | POST                            |
| Endpoint   | /api/v1/leave/requests/{id}/reject |
| Permission | LEAVE.REQUEST.REJECT            |
| Mục đích   | Từ chối đơn nghỉ                |

Request mẫu:

```json
{
  "rejection_reason": "Thời gian này team đang thiếu người trực dự án"
}
```

---

### 17.12 API danh sách tất cả đơn nghỉ

| Trường     | Nội dung                                         |
| ---------- | ------------------------------------------------ |
| Mã API     | LEAVE-API-012                                    |
| Method     | GET                                              |
| Endpoint   | /api/v1/leave/requests                              |
| Permission | LEAVE.REQUEST.VIEW (data_scope theo quyền được cấp) |
| Mục đích   | HR/Admin xem danh sách đơn nghỉ                  |

---

### 17.13 API lịch nghỉ

| Trường     | Nội dung                             |
| ---------- | ------------------------------------ |
| Mã API     | LEAVE-API-013                        |
| Method     | GET                                  |
| Endpoint   | /api/v1/leave/calendar                 |
| Permission | LEAVE.CALENDAR.VIEW_OWN/TEAM/COMPANY |
| Mục đích   | Lấy dữ liệu lịch nghỉ                |

Query params:

```text
scope
department_id
employee_id
from_date
to_date
status
```

---

### 17.14 API quản lý loại nghỉ

| Mã API        | Method | Endpoint              | Mục đích              | Permission        |
| ------------- | ------ | --------------------- | --------------------- | ----------------- |
| LEAVE-API-014 | GET    | /api/leave-types      | Danh sách loại nghỉ   | LEAVE.TYPE.VIEW   |
| LEAVE-API-015 | POST   | /api/leave-types      | Tạo loại nghỉ         | LEAVE.TYPE.CREATE |
| LEAVE-API-016 | PUT    | /api/leave-types/{id} | Cập nhật loại nghỉ    | LEAVE.TYPE.UPDATE |
| LEAVE-API-017 | DELETE | /api/leave-types/{id} | Vô hiệu hóa loại nghỉ | LEAVE.TYPE.DELETE |

---

### 17.15 API quản lý chính sách nghỉ

| Mã API        | Method | Endpoint                 | Mục đích             | Permission          |
| ------------- | ------ | ------------------------ | -------------------- | ------------------- |
| LEAVE-API-018 | GET    | /api/leave-policies      | Danh sách chính sách | LEAVE.POLICY.VIEW   |
| LEAVE-API-019 | POST   | /api/leave-policies      | Tạo chính sách       | LEAVE.POLICY.UPDATE |
| LEAVE-API-020 | PUT    | /api/leave-policies/{id} | Cập nhật chính sách  | LEAVE.POLICY.UPDATE |

---

### 17.16 API quản lý số dư phép

| Mã API        | Method | Endpoint                              | Mục đích               | Permission           |
| ------------- | ------ | ------------------------------------- | ---------------------- | -------------------- |
| LEAVE-API-021 | GET    | /api/leave-balances                   | Danh sách số dư phép   | LEAVE.BALANCE.VIEW   |
| LEAVE-API-022 | GET    | /api/leave-balances/{employee_id}     | Số dư phép nhân viên   | LEAVE.BALANCE.VIEW   |
| LEAVE-API-023 | POST   | /api/leave-balances/adjust            | Điều chỉnh số dư phép  | LEAVE.BALANCE.ADJUST |
| LEAVE-API-024 | GET    | /api/leave-balances/{id}/transactions | Lịch sử giao dịch phép | LEAVE.BALANCE.VIEW   |

---

### 17.17 API xuất dữ liệu nghỉ phép

| Trường     | Nội dung                           |
| ---------- | ---------------------------------- |
| Mã API     | LEAVE-API-025                      |
| Method     | GET                                |
| Endpoint   | /api/v1/leave/requests/export         |
| Permission | LEAVE.REQUEST.EXPORT               |
| Mục đích   | Xuất dữ liệu nghỉ phép theo bộ lọc |

---

## 18. Error code

> **Bộ canonical (chuẩn) = API-05 §24 (slug).** Toàn dự án dùng MỘT hệ mã lỗi slug nhất quán (SPEC-01 §9.6). Hệ số `LEAVE-ERR-001..035` của bản SPEC cũ và hệ số của BACKEND-07 §17 (`LEAVE-ERR-001..022`) **không còn là chuẩn**; chúng được ánh xạ về slug ở §18.2. Đặc biệt: mã `-016` từng bị gán SAI nghĩa "không có người duyệt" ở SPEC/FE-10, nhưng BACKEND-07 §17 dùng `LEAVE-ERR-016` = "state transition không hợp lệ". Để bỏ xung đột, **không dùng số -016 nữa**: "không có người duyệt" → `LEAVE-ERR-APPROVER-NOT-FOUND`; "chuyển trạng thái không hợp lệ" → `LEAVE-ERR-INVALID-TRANSITION`.

### 18.1 Bảng mã lỗi canonical (slug)

| Error code | HTTP | Trường hợp / Ý nghĩa |
| --- | ---: | --- |
| `AUTH-ERR-UNAUTHENTICATED` | 401 | Chưa đăng nhập |
| `AUTH-ERR-FORBIDDEN` | 403 | Không có quyền hoặc ngoài data scope |
| `LEAVE-ERR-EMPLOYEE-NOT-LINKED` | 400 | Tài khoản chưa liên kết hồ sơ nhân viên |
| `LEAVE-ERR-REQUEST-NOT-FOUND` | 404 | Không tìm thấy đơn nghỉ hoặc không thuộc scope |
| `LEAVE-ERR-INVALID-STATE` | 409 | Trạng thái đơn không cho phép thao tác (vd đơn đã xử lý) |
| `LEAVE-ERR-INVALID-TRANSITION` | 409 | Chuyển trạng thái không hợp lệ (state machine §8) |
| `LEAVE-ERR-REQUEST-OVERLAP` | 409 | Trùng thời gian với đơn nghỉ khác |
| `LEAVE-ERR-BALANCE-NOT-FOUND` | 422 | Không tìm thấy số dư phép |
| `LEAVE-ERR-BALANCE-NOT-ENOUGH` | 422 | Không đủ số dư phép |
| `LEAVE-ERR-NEGATIVE-BALANCE-NOT-ALLOWED` | 422 | Vượt giới hạn âm phép / không cho phép âm phép |
| `LEAVE-ERR-LEAVE-TYPE-INACTIVE` | 422 | Loại nghỉ không tồn tại/không active |
| `LEAVE-ERR-LEAVE-TYPE-NOT-ALLOWED` | 422 | Loại nghỉ không áp dụng cho employee |
| `LEAVE-ERR-DURATION-NOT-ALLOWED` | 422 | Duration type không được loại nghỉ/policy cho phép |
| `LEAVE-ERR-REASON-REQUIRED` | 400 | Thiếu lý do nghỉ bắt buộc |
| `LEAVE-ERR-ATTACHMENT-REQUIRED` | 400 | Thiếu file chứng minh bắt buộc |
| `LEAVE-ERR-APPROVER-NOT-FOUND` | 422 | Không xác định được người duyệt phù hợp |
| `LEAVE-ERR-APPROVER-INVALID` | 422 | Người duyệt không hợp lệ (gồm **chặn tự duyệt self-approval**, §14.9) |
| `LEAVE-ERR-EMPLOYEE-NOT-ELIGIBLE` | 422 | Nhân viên không đủ điều kiện xin nghỉ (vd Resigned/Terminated) |
| `LEAVE-ERR-REJECT-REASON-REQUIRED` | 400 | Thiếu lý do từ chối |
| `LEAVE-ERR-ADJUST-INVALID` | 422 | Số ngày điều chỉnh không hợp lệ |
| `LEAVE-ERR-ADJUST-REASON-REQUIRED` | 400 | Thiếu lý do điều chỉnh số dư |
| `LEAVE-ERR-LEAVE-TYPE-CODE-DUPLICATE` | 409 | Mã loại nghỉ đã tồn tại |
| `LEAVE-ERR-LEAVE-TYPE-IN-USE` | 409 | Loại nghỉ đã phát sinh đơn, chỉ vô hiệu hóa |
| `LEAVE-ERR-POLICY-NOT-FOUND` | 422 | Không tìm thấy chính sách áp dụng |
| `LEAVE-ERR-POLICY-CONFLICT` | 409 | Cấu hình chính sách trùng/không hợp lệ |
| `LEAVE-ERR-PERIOD-LOCKED` | 422 | Kỳ công/kỳ phép đã khóa |
| `LEAVE-ERR-FILE-NOT-ALLOWED` | 422 | File đính kèm không hợp lệ |
| `LEAVE-ERR-SYNC-ATT-FAILED` | 500/202 | Đồng bộ ATT lỗi, cần retry |
| `LEAVE-ERR-MAX-DAYS-EXCEEDED` | 422 | Vượt số ngày tối đa mỗi đơn |

### 18.2 Ánh xạ mã SPEC số (cũ) → canonical slug

> Dùng để tra cứu test case/tham chiếu cũ. Các phần khác của tài liệu (vd §23 test case) còn nhắc mã số là tham chiếu lịch sử; ý nghĩa chuẩn lấy theo cột slug.

| SPEC cũ | Slug canonical |
| --- | --- |
| LEAVE-ERR-001 | `AUTH-ERR-UNAUTHENTICATED` |
| LEAVE-ERR-002 | `LEAVE-ERR-EMPLOYEE-NOT-LINKED` |
| LEAVE-ERR-003 / 018 / 021 / 022 / 025 | `AUTH-ERR-FORBIDDEN` |
| LEAVE-ERR-004 / 005 | `LEAVE-ERR-LEAVE-TYPE-INACTIVE` |
| LEAVE-ERR-006 / 007 / 008 / 011 / 012 | `VALIDATION-ERR-001` (validate ngày/thời lượng) |
| LEAVE-ERR-009 | `LEAVE-ERR-REASON-REQUIRED` |
| LEAVE-ERR-010 / 034 | `LEAVE-ERR-ATTACHMENT-REQUIRED` / `LEAVE-ERR-FILE-NOT-ALLOWED` |
| LEAVE-ERR-013 | `LEAVE-ERR-BALANCE-NOT-ENOUGH` |
| LEAVE-ERR-014 | `LEAVE-ERR-NEGATIVE-BALANCE-NOT-ALLOWED` |
| LEAVE-ERR-015 | `LEAVE-ERR-REQUEST-OVERLAP` |
| **LEAVE-ERR-016 (nghĩa "không có người duyệt" — SAI, bỏ)** | `LEAVE-ERR-APPROVER-NOT-FOUND` |
| **LEAVE-ERR-016 (nghĩa BE "state transition")** | `LEAVE-ERR-INVALID-TRANSITION` |
| LEAVE-ERR-017 | `LEAVE-ERR-REQUEST-NOT-FOUND` |
| LEAVE-ERR-019 / 020 / 023 | `LEAVE-ERR-INVALID-STATE` |
| LEAVE-ERR-024 | `LEAVE-ERR-REJECT-REASON-REQUIRED` |
| LEAVE-ERR-026 | `LEAVE-ERR-LEAVE-TYPE-CODE-DUPLICATE` |
| LEAVE-ERR-027 | `LEAVE-ERR-LEAVE-TYPE-IN-USE` |
| LEAVE-ERR-028 | `LEAVE-ERR-POLICY-CONFLICT` |
| LEAVE-ERR-029 | `LEAVE-ERR-BALANCE-NOT-FOUND` |
| LEAVE-ERR-030 | `LEAVE-ERR-ADJUST-INVALID` |
| LEAVE-ERR-031 | `LEAVE-ERR-ADJUST-REASON-REQUIRED` |
| LEAVE-ERR-032 | `LEAVE-ERR-SYNC-ATT-FAILED` |
| LEAVE-ERR-033 | `LEAVE-ERR-EMPLOYEE-NOT-ELIGIBLE` |
| LEAVE-ERR-035 | `LEAVE-ERR-MAX-DAYS-EXCEEDED` |

### 18.3 Bảng map FE ↔ BE ↔ API (LV-1 / LV-2)

> **Drift reconciliation 22/06 (theo SPEC-DRIFT-MATRIX §4 — LV-1, LV-2).** Trước đây tồn tại 3 hệ mã lỗi rời rạc: số ở SPEC (`LEAVE-ERR-001..035`), slug ở API-05, và số-khác-nghĩa ở BACKEND-07 §17 (`LEAVE-ERR-001..022`). Bộ **canonical duy nhất = slug** (cột giữa). Bảng dưới ánh xạ slug ↔ hằng FE (FE-10) ↔ hằng/throw BE (BACKEND-07) ↔ phát ra ở API (API-05) để mọi tầng dùng CÙNG một định danh khi render/log/test. FE-10 và BACKEND-07 **phải đổi** các hằng nội bộ về đúng slug canonical này (xem LV-2 bên dưới).
>
> **LV-2 — gỡ xung đột `LEAVE-ERR-016` (nghĩa TRÁI NGƯỢC giữa FE và BE):** mã số `-016` từng mang 2 nghĩa đối nghịch — FE-10 hiểu là "không tìm được người duyệt", BACKEND-07 hiểu là "chuyển trạng thái không hợp lệ". **Bỏ hẳn số `-016`**, tách thành 2 slug riêng, mỗi slug đúng MỘT nghĩa:
>
> * "không xác định được người duyệt" → **`LEAVE-ERR-APPROVER-NOT-FOUND`** (422)
> * "chuyển trạng thái không hợp lệ" (state machine §8) → **`LEAVE-ERR-INVALID-TRANSITION`** (409)
> * (phân biệt thêm) "tự duyệt / người duyệt không hợp lệ" → **`LEAVE-ERR-APPROVER-INVALID`** (422, §14.9 hard-rule)
>
> **Cần đồng bộ ở lane khác:** FE-10 đổi hằng error key `LEAVE-ERR-016` (đang map "no approver") → `LEAVE-ERR-APPROVER-NOT-FOUND`; BACKEND-07 §17 đổi `LEAVE-ERR-016` (state) → `LEAVE-ERR-INVALID-TRANSITION` và dùng `LEAVE-ERR-INVALID-STATE` cho "đơn đã xử lý". Sau đồng bộ, KHÔNG còn mã số trong code/UX — chỉ slug.

| Slug canonical (chuẩn) | HTTP | FE-10 (i18n key / hằng) | BACKEND-07 (throw / hằng) | API-05 (endpoint phát chính) |
| --- | ---: | --- | --- | --- |
| `AUTH-ERR-UNAUTHENTICATED` | 401 | `auth.unauthenticated` | guard `JwtAuthGuard` | mọi endpoint |
| `AUTH-ERR-FORBIDDEN` | 403 | `auth.forbidden` | `PermissionGuard` / scope check | mọi endpoint nhạy cảm |
| `LEAVE-ERR-EMPLOYEE-NOT-LINKED` | 400 | `leave.employeeNotLinked` | `LeaveRequestService.assertEmployee` | POST `/leave/requests` |
| `LEAVE-ERR-REQUEST-NOT-FOUND` | 404 | `leave.requestNotFound` | repo `findOrThrow` | GET/POST `/leave/requests/{id}/*` |
| `LEAVE-ERR-INVALID-STATE` | 409 | `leave.invalidState` | FSM guard "đơn đã xử lý" | submit/approve/reject/cancel |
| `LEAVE-ERR-INVALID-TRANSITION` | 409 | `leave.invalidTransition` | FSM guard transition (was `-016` BE) | approve/reject/cancel/revoke |
| `LEAVE-ERR-REQUEST-OVERLAP` | 409 | `leave.requestOverlap` | overlap check | POST `/leave/requests`, submit |
| `LEAVE-ERR-BALANCE-NOT-FOUND` | 422 | `leave.balanceNotFound` | `BalanceService` | submit/approve, balances |
| `LEAVE-ERR-BALANCE-NOT-ENOUGH` | 422 | `leave.balanceNotEnough` | `BalanceService.assertEnough` | submit/approve |
| `LEAVE-ERR-NEGATIVE-BALANCE-NOT-ALLOWED` | 422 | `leave.negativeNotAllowed` | policy check | submit/approve |
| `LEAVE-ERR-LEAVE-TYPE-INACTIVE` | 422 | `leave.typeInactive` | `LeaveTypeService` | POST `/leave/requests` |
| `LEAVE-ERR-LEAVE-TYPE-NOT-ALLOWED` | 422 | `leave.typeNotAllowed` | policy/eligibility check | POST `/leave/requests` |
| `LEAVE-ERR-DURATION-NOT-ALLOWED` | 422 | `leave.durationNotAllowed` | type/policy guard | POST `/leave/requests` |
| `LEAVE-ERR-REASON-REQUIRED` | 400 | `leave.reasonRequired` | DTO / service guard | POST/submit |
| `LEAVE-ERR-ATTACHMENT-REQUIRED` | 400 | `leave.attachmentRequired` | type guard | submit |
| `LEAVE-ERR-APPROVER-NOT-FOUND` | 422 | `leave.approverNotFound` (was `-016` FE) | `ApproverResolver` | submit |
| `LEAVE-ERR-APPROVER-INVALID` | 422 | `leave.approverInvalid` | self-approval hard-rule (§14.9, BE-07 §22.3) | POST `/leave/requests/{id}/approve` |
| `LEAVE-ERR-EMPLOYEE-NOT-ELIGIBLE` | 422 | `leave.employeeNotEligible` | eligibility (Resigned/Terminated) | POST `/leave/requests` |
| `LEAVE-ERR-REJECT-REASON-REQUIRED` | 400 | `leave.rejectReasonRequired` | reject guard | POST `/leave/requests/{id}/reject` |
| `LEAVE-ERR-ADJUST-INVALID` | 422 | `leave.adjustInvalid` | `BalanceAdjustService` | POST `/leave/balances/adjust` |
| `LEAVE-ERR-ADJUST-REASON-REQUIRED` | 400 | `leave.adjustReasonRequired` | adjust guard | POST `/leave/balances/adjust` |
| `LEAVE-ERR-LEAVE-TYPE-CODE-DUPLICATE` | 409 | `leave.typeCodeDuplicate` | unique check | POST `/leave/types` |
| `LEAVE-ERR-LEAVE-TYPE-IN-USE` | 409 | `leave.typeInUse` | delete guard | DELETE `/leave/types/{id}` |
| `LEAVE-ERR-POLICY-NOT-FOUND` | 422 | `leave.policyNotFound` | `PolicyResolver` | submit/approve |
| `LEAVE-ERR-POLICY-CONFLICT` | 409 | `leave.policyConflict` | policy validation | POST/PUT `/leave/policies` |
| `LEAVE-ERR-PERIOD-LOCKED` | 422 | `leave.periodLocked` | period-lock guard | approve/cancel/revoke/adjust |
| `LEAVE-ERR-FILE-NOT-ALLOWED` | 422 | `leave.fileNotAllowed` | file validation | `/leave/requests/{id}/files` |
| `LEAVE-ERR-SYNC-ATT-FAILED` | 500/202 | `leave.syncAttFailed` | ATT sync handler | (async, approve/cancel/revoke) |
| `LEAVE-ERR-MAX-DAYS-EXCEEDED` | 422 | `leave.maxDaysExceeded` | type/policy guard | submit |

---

## 19. Notification

### 19.1 Sự kiện cần gửi thông báo

> **Drift reconciliation 22/06 (theo SPEC-DRIFT-MATRIX §4 — LV-7).** Cột "Event code canonical" gắn mỗi sự kiện văn xuôi với MỘT mã trong registry §19.1.1. Hai dòng đánh dấu `(không có event MVP)` KHÔNG phát NOTI event ở MVP — xem chú thích LV-7 ở §19.1.1.

| Sự kiện                     | Người nhận                | Event code canonical (§19.1.1) |
| --------------------------- | ------------------------- | ------------------------------ |
| Employee gửi đơn nghỉ       | Manager/Approver          | `LEAVE_REQUEST_SUBMITTED`      |
| Đơn nghỉ được duyệt         | Employee                  | `LEAVE_REQUEST_APPROVED`       |
| Đơn nghỉ bị từ chối         | Employee                  | `LEAVE_REQUEST_REJECTED`       |
| Employee hủy đơn Pending    | Manager/Approver          | `LEAVE_REQUEST_CANCELLED`      |
| HR hủy/thu hồi đơn Approved | Employee, Manager         | `LEAVE_REQUEST_CANCELLED` (hủy) / `LEAVE_REQUEST_REVOKED` (thu hồi) |
| Điều chỉnh số dư phép       | Employee                  | `LEAVE_BALANCE_ADJUSTED`       |
| Đồng bộ chấm công lỗi       | Admin/alert               | `LEAVE_SYNC_TO_ATT_FAILED`     |
| Sắp tới ngày nghỉ           | Employee, Manager nếu cần | (không có event MVP)           |
| Số ngày phép thấp           | Employee                  | (không có event MVP)           |

---

### 19.1.1 Mã sự kiện chuẩn (event registry)

Mã event LEAVE dùng `UPPER_SNAKE`, prefix `LEAVE_`, khớp registry chuẩn NOTI tại [SPEC-08 §15](<SPEC-08 NOTI.md>). Module phát event và catalog NOTI (SPEC-08) dùng đúng các code sau:

| Event code                | Khi nào phát                        | Consumer            |
| ------------------------- | ----------------------------------- | ------------------- |
| `LEAVE_REQUEST_SUBMITTED` | Employee gửi đơn                    | NOTI, DASH          |
| `LEAVE_REQUEST_APPROVED`  | Manager/HR duyệt đơn                | ATT, NOTI, DASH     |
| `LEAVE_REQUEST_REJECTED`  | Manager/HR từ chối đơn              | NOTI, DASH          |
| `LEAVE_REQUEST_CANCELLED` | Employee/HR hủy đơn                 | ATT, NOTI, DASH     |
| `LEAVE_REQUEST_REVOKED`   | HR/Admin thu hồi đơn đã duyệt       | ATT, NOTI, DASH     |
| `LEAVE_BALANCE_ADJUSTED`  | HR/Admin điều chỉnh số dư           | NOTI, DASH          |
| `LEAVE_SYNC_TO_ATT_FAILED`| Đồng bộ sang chấm công lỗi          | NOTI/Admin alert    |

> `LEAVE_REQUEST_REVOKED` là **event thật**: revoke là transition riêng so với cancel, ATT tiếp tục consume để revert/tính lại bảng công. Bỏ các tên lệch `LEAVE_ATT_SYNC_FAILED` / `LEAVE_SYNCED_TO_ATTENDANCE`.

---

### 19.2 Nội dung thông báo gợi ý

#### Gửi đơn nghỉ

```text
Nguyễn Văn A đã gửi đơn nghỉ phép từ 01/07/2026 đến 02/07/2026 và đang chờ bạn duyệt.
```

#### Đơn được duyệt

```text
Đơn nghỉ phép của bạn từ 01/07/2026 đến 02/07/2026 đã được duyệt.
```

#### Đơn bị từ chối

```text
Đơn nghỉ phép của bạn đã bị từ chối. Lý do: Thời gian này team đang thiếu người.
```

---

## 20. Audit log

### 20.1 Hành động cần ghi log

| Action                     | Mô tả                    |
| -------------------------- | ------------------------ |
| LEAVE_REQUEST_CREATED      | Tạo đơn nghỉ             |
| LEAVE_REQUEST_DRAFTED      | Lưu nháp đơn nghỉ        |
| LEAVE_REQUEST_SUBMITTED    | Gửi đơn nghỉ             |
| LEAVE_REQUEST_UPDATED      | Cập nhật đơn nháp        |
| LEAVE_REQUEST_CANCELLED    | Hủy đơn nghỉ             |
| LEAVE_REQUEST_APPROVED     | Duyệt đơn nghỉ           |
| LEAVE_REQUEST_REJECTED     | Từ chối đơn nghỉ         |
| LEAVE_REQUEST_REVOKED      | Thu hồi đơn đã duyệt     |
| LEAVE_TYPE_CREATED         | Tạo loại nghỉ            |
| LEAVE_TYPE_UPDATED         | Cập nhật loại nghỉ       |
| LEAVE_TYPE_DISABLED        | Vô hiệu hóa loại nghỉ    |
| LEAVE_POLICY_UPDATED       | Cập nhật chính sách nghỉ |
| LEAVE_BALANCE_ADJUSTED     | Điều chỉnh số dư phép    |
| LEAVE_BALANCE_GRANTED      | Cấp ngày phép            |
| LEAVE_SYNC_TO_ATT_FAILED   | Đồng bộ sang chấm công lỗi |
| LEAVE_EXPORT               | Xuất dữ liệu nghỉ phép   |

---

### 20.2 Thông tin log cần lưu

| Trường      | Mô tả                                           |
| ----------- | ----------------------------------------------- |
| actor_id    | Người thực hiện                                 |
| action      | Hành động                                       |
| module      | LEAVE                                           |
| target_type | LeaveRequest/LeaveType/LeavePolicy/LeaveBalance |
| target_id   | ID đối tượng                                    |
| old_value   | Dữ liệu trước                                   |
| new_value   | Dữ liệu sau                                     |
| ip_address  | IP                                              |
| user_agent  | Thiết bị/trình duyệt                            |
| created_at  | Thời gian thao tác                              |

---

## 21. Tiêu chí nghiệm thu tổng thể

### 21.1 Nghiệp vụ tạo đơn

* Employee tạo được đơn nghỉ hợp lệ.
* Hệ thống tự tính số ngày nghỉ.
* Hệ thống kiểm tra số dư phép.
* Hệ thống kiểm tra trùng thời gian nghỉ.
* Đơn gửi thành công có trạng thái Pending.
* Người duyệt nhận thông báo.

---

### 21.2 Nghiệp vụ duyệt/từ chối

* Manager duyệt được đơn của nhân viên thuộc team.
* Manager không duyệt được đơn ngoài team.
* HR duyệt được đơn theo phạm vi quyền.
* Từ chối bắt buộc nhập lý do.
* Đơn đã xử lý không thể xử lý lại.
* Employee nhận thông báo kết quả.

---

### 21.3 Số dư phép

* Số dư phép hiển thị đúng.
* Đơn Pending được tính vào pending_days nếu cấu hình giữ chỗ số dư.
* Đơn Approved làm giảm remaining_days.
* Đơn Rejected/Cancelled không làm giảm số dư.
* Điều chỉnh số dư tạo transaction.
* Không cho số dư âm nếu policy không cho phép.

---

### 21.4 Đồng bộ chấm công

* Đơn nghỉ cả ngày Approved cập nhật attendance status là Leave.
* Đơn nghỉ cả ngày Approved chặn check-in/check-out.
* Nghỉ nửa ngày không bị tính sai đi muộn/về sớm.
* Nghỉ theo giờ làm giảm số giờ làm việc yêu cầu.
* Hủy đơn Approved cập nhật lại attendance nếu cấu hình cho phép.

---

### 21.5 Phân quyền

* Employee chỉ xem được đơn của chính mình.
* Manager chỉ xem và xử lý đơn trong scope.
* HR xem dữ liệu theo quyền Company.
* Người không có quyền bị chặn ở cả frontend và backend.
* API trả lỗi 403 nếu thiếu quyền.

---

### 21.6 Lịch nghỉ

* Employee xem được lịch nghỉ của mình.
* Manager xem được lịch nghỉ team.
* HR xem được lịch nghỉ toàn công ty.
* Lịch nghỉ hiển thị đúng đơn Approved.
* Có thể lọc theo phòng ban, nhân viên, loại nghỉ, trạng thái.

---

### 21.7 Log và bảo mật

* Tạo/gửi/duyệt/từ chối/hủy đơn đều ghi audit log.
* Điều chỉnh balance ghi audit log.
* Xuất dữ liệu nghỉ phép ghi audit log.
* File đính kèm được phân quyền xem/tải.
* Dữ liệu không vượt quá data scope.

---

## 22. Gợi ý thứ tự triển khai MVP

### Giai đoạn 1: Nền tảng dữ liệu

1. Tạo bảng `leave_types`.
2. Tạo bảng `leave_policies`.
3. Tạo bảng `leave_balances`.
4. Tạo bảng `leave_requests`.
5. Tạo bảng `leave_request_approvals`.
6. Tạo bảng `leave_balance_transactions`.

---

### Giai đoạn 2: Employee flow

1. Xem tổng quan nghỉ phép của tôi.
2. Xem số dư phép của tôi.
3. Tạo đơn nghỉ.
4. Lưu nháp.
5. Gửi đơn.
6. Xem đơn của tôi.
7. Hủy đơn.

---

### Giai đoạn 3: Approval flow

1. Danh sách đơn chờ duyệt.
2. Chi tiết đơn nghỉ.
3. Duyệt đơn.
4. Từ chối đơn.
5. Notification kết quả.

---

### Giai đoạn 4: HR management

1. Quản lý loại nghỉ.
2. Cấu hình chính sách nghỉ.
3. Xem tất cả đơn nghỉ.
4. Quản lý số dư phép.
5. Điều chỉnh số dư phép.
6. Xuất dữ liệu nghỉ phép.

---

### Giai đoạn 5: Tích hợp

1. Đồng bộ với ATT.
2. Hiển thị trên DASH.
3. Gửi NOTI.
4. Chuẩn bị dữ liệu cho PAYROLL phase sau.

---

## 23. Test case

> Các test case dưới đây được suy ra từ tiêu chí nghiệm thu tổng thể (§21) và tiêu chí nghiệm thu theo từng chức năng (§14). Mã test case theo quy ước `LEAVE-TC-XXX`.

| Mã           | Trường hợp kiểm thử                      | Bước thực hiện                                                                                     | Kết quả mong muốn                                                                                               |
| ------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| LEAVE-TC-001 | Lưu nháp đơn nghỉ                        | Mở màn Tạo đơn nghỉ → nhập dữ liệu hợp lệ → bấm Lưu nháp                                           | Đơn lưu trạng thái Draft, hiển thị trong Đơn của tôi, không vào danh sách chờ duyệt, không ảnh hưởng số dư phép |
| LEAVE-TC-002 | Tạo và gửi đơn nghỉ hợp lệ               | Nhập loại nghỉ, thời gian, lý do hợp lệ → bấm Gửi đơn                                              | Đơn chuyển trạng thái Pending, ghi submitted_at, hệ thống tự tính calculated_days                               |
| LEAVE-TC-003 | Tự động tính số ngày nghỉ                | Tạo đơn nghỉ nhiều ngày có cuối tuần/ngày lễ theo chính sách                                       | calculated_days tính đúng theo lịch làm việc, cuối tuần, ngày lễ và loại thời lượng                             |
| LEAVE-TC-004 | Gửi đơn thiếu trường bắt buộc            | Bỏ trống loại nghỉ hoặc ngày bắt đầu/kết thúc → bấm Gửi đơn                                        | Hệ thống chặn và báo lỗi tương ứng (LEAVE-ERR-004/006/007/008)                                                  |
| LEAVE-TC-005 | Kiểm tra số dư phép khi gửi đơn          | Gửi đơn loại nghỉ trừ phép với calculated_days vượt số ngày phép còn lại, policy không cho âm phép | Hệ thống chặn, báo lỗi LEAVE-ERR-013                                                                            |
| LEAVE-TC-006 | Cho nghỉ âm phép trong giới hạn          | Gửi đơn vượt số dư nhưng trong max_negative_days, policy cho phép âm phép                          | Đơn được chấp nhận; nếu vượt giới hạn âm thì báo lỗi LEAVE-ERR-014                                              |
| LEAVE-TC-007 | Kiểm tra trùng thời gian nghỉ            | Tạo đơn có khoảng nghỉ trùng đơn Pending/Approved đã có                                            | Hệ thống chặn, báo lỗi LEAVE-ERR-015                                                                            |
| LEAVE-TC-008 | Chặn tạo đơn khi nhân viên không hợp lệ  | Tạo đơn với nhân viên ở trạng thái Resigned/Terminated                                             | Hệ thống chặn, báo lỗi LEAVE-ERR-033                                                                            |
| LEAVE-TC-009 | Manager duyệt đơn trong team             | Manager mở đơn Pending của nhân viên thuộc team → bấm Duyệt                                        | Đơn chuyển Approved, ghi approved_by/approved_at, Employee nhận thông báo, ghi audit log                        |
| LEAVE-TC-010 | Manager không duyệt được đơn ngoài team  | Manager truy cập/duyệt đơn của nhân viên ngoài scope                                               | Bị chặn ở frontend và backend, API trả 403, báo lỗi LEAVE-ERR-021                                               |
| LEAVE-TC-011 | Từ chối đơn bắt buộc nhập lý do          | Người duyệt mở đơn Pending → bấm Từ chối → bỏ trống lý do                                          | Hệ thống chặn, báo lỗi LEAVE-ERR-024; khi nhập lý do thì đơn chuyển Rejected, gửi thông báo                     |
| LEAVE-TC-012 | Không xử lý lại đơn đã xử lý             | Mở đơn đã Approved/Rejected/Cancelled → bấm Duyệt hoặc Từ chối                                     | Hệ thống chặn, báo lỗi LEAVE-ERR-023                                                                            |
| LEAVE-TC-013 | Employee hủy đơn Draft/Pending           | Employee mở đơn Draft hoặc Pending của mình → bấm Hủy                                              | Đơn chuyển Cancelled, pending_days được giải phóng nếu đã giữ chỗ                                               |
| LEAVE-TC-014 | Hủy đơn không hợp lệ theo trạng thái     | Employee bấm hủy đơn Rejected/Cancelled                                                            | Hệ thống chặn, báo lỗi LEAVE-ERR-020                                                                            |
| LEAVE-TC-015 | Thu hồi/hủy đơn Approved hoàn số dư phép | HR/Manager hủy hoặc thu hồi đơn Approved (loại nghỉ trừ phép) theo cấu hình                        | used_days giảm, remaining_days tăng, attendance được cập nhật lại                                               |
| LEAVE-TC-016 | Cập nhật số dư phép khi duyệt            | Duyệt đơn Pending loại nghỉ trừ phép                                                               | used_days tăng, pending_days giảm, remaining_days giảm đúng calculated_days                                     |
| LEAVE-TC-017 | Đơn Rejected/Cancelled không trừ số dư   | Từ chối hoặc hủy đơn Pending loại nghỉ trừ phép                                                    | Số dư phép không bị trừ, pending_days được giải phóng                                                           |
| LEAVE-TC-018 | Điều chỉnh số dư phép tạo transaction    | HR mở Điều chỉnh số dư → nhập số ngày, lý do hợp lệ → Lưu                                          | Leave balance cập nhật, tạo balance transaction, ghi audit log                                                  |
| LEAVE-TC-019 | Điều chỉnh số dư thiếu lý do             | HR điều chỉnh số dư nhưng bỏ trống lý do                                                           | Hệ thống chặn, báo lỗi LEAVE-ERR-031                                                                            |
| LEAVE-TC-020 | Đồng bộ nghỉ cả ngày sang chấm công      | Duyệt đơn nghỉ cả ngày → kiểm tra bảng công ngày nghỉ                                              | Attendance status = Leave, ATT chặn check-in/check-out ngày đó                                                  |
| LEAVE-TC-021 | Đồng bộ nghỉ nửa ngày/theo giờ           | Duyệt đơn nghỉ nửa ngày hoặc theo giờ → kiểm tra bảng công                                         | Required working minutes giảm tương ứng, không bị tính sai đi muộn/về sớm                                       |
| LEAVE-TC-022 | Kiểm tra phạm vi quyền xem đơn           | Employee xem đơn của người khác; người không có quyền gọi API chi tiết đơn                         | Bị chặn, API trả 403, báo lỗi LEAVE-ERR-018; Employee chỉ thấy đơn của mình                                     |
| LEAVE-TC-023 | Lịch nghỉ của tôi                        | Employee mở Lịch nghỉ của tôi, đổi chế độ Month/Week/Day/List                                      | Hiển thị đúng đơn Approved của chính mình, không thấy đơn người khác                                            |
| LEAVE-TC-024 | Lịch nghỉ team và toàn công ty           | Manager mở Lịch nghỉ team; HR mở Lịch nghỉ toàn công ty, lọc theo phòng ban/loại nghỉ/trạng thái   | Hiển thị đúng phạm vi scope, bộ lọc hoạt động, Employee không truy cập được lịch công ty                        |
| LEAVE-TC-025 | Xuất dữ liệu nghỉ phép                   | HR có quyền EXPORT chọn bộ lọc → bấm Xuất; user không có quyền thử xuất                            | File xuất khớp bộ lọc và trong data scope, ghi audit log LEAVE_EXPORT; user thiếu quyền bị chặn                 |
| LEAVE-TC-026 | **Deny-path: chặn tự duyệt (self-approval)** | Người dùng vừa là người tạo/người xin nghỉ của đơn Pending tự bấm Duyệt (kể cả khi có quyền `LEAVE.REQUEST.APPROVE`) | Backend chặn ở tầng service (hard-rule §14.9), API trả 422 `LEAVE-ERR-APPROVER-INVALID`; không đổi trạng thái đơn, không trừ số dư. Test này là RED deny-path bắt buộc viết trước (khớp BACKEND-07 §22.3) |
