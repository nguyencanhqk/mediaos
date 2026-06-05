# USER ROLE & PERMISSION MATRIX — MVP v1

## Media Company Operating System

---

## 1. Nguyên tắc phân quyền

Hệ thống không nên phân quyền đơn giản theo kiểu:

```text
Admin / Manager / Employee
```

Mà nên dùng mô hình:

```text
User + Role + Scope + Object + Action + Condition
```

Ví dụ:

```text
Nguyễn A có quyền duyệt video trong Project X, 
nhưng không có quyền xem doanh thu của kênh.
```

Hoặc:

```text
Trưởng phòng sản xuất được xem toàn bộ task của khối sản xuất,
nhưng không được xem bảng lương chi tiết nếu không có quyền HR/Finance.
```

---

## 2. Các loại hành động trong hệ thống

| Ký hiệu | Ý nghĩa                               |
| ------- | ------------------------------------- |
| `N`     | Không có quyền                        |
| `V`     | Xem                                   |
| `C`     | Tạo                                   |
| `E`     | Chỉnh sửa                             |
| `D`     | Xóa                                   |
| `M`     | Quản lý đầy đủ trong phạm vi được cấp |
| `A`     | Duyệt / phê duyệt                     |
| `R`     | Trả sửa / từ chối                     |
| `S`     | Xem dữ liệu nhạy cảm                  |
| `EX`    | Xuất báo cáo / export dữ liệu         |
| `CFG`   | Cấu hình hệ thống                     |

---

## 3. Các phạm vi quyền

| Scope       | Ý nghĩa                                                 |
| ----------- | ------------------------------------------------------- |
| `Own`       | Chỉ dữ liệu của bản thân                                |
| `Team`      | Dữ liệu trong team mình                                 |
| `Dept`      | Dữ liệu trong phòng ban/khối mình                       |
| `Project`   | Dữ liệu trong project được tham gia                     |
| `Channel`   | Dữ liệu của kênh được phân công                         |
| `Company`   | Dữ liệu toàn công ty                                    |
| `Sensitive` | Dữ liệu nhạy cảm: lương, tài khoản, mật khẩu, tài chính |
| `Custom`    | Phạm vi được cấu hình riêng                             |

---

## 4. Nhóm vai trò chính

### 4.1. Nhóm hệ thống

| Role             | Mô tả                                                              |
| ---------------- | ------------------------------------------------------------------ |
| `Super Admin`    | Chủ hệ thống cấp cao nhất, dùng cho vận hành kỹ thuật/SaaS sau này |
| `Company Owner`  | Chủ công ty hoặc người sở hữu workspace                            |
| `System Admin`   | Quản trị cấu hình hệ thống nội bộ                                  |
| `Security Admin` | Quản lý bảo mật, audit log, tài khoản nhạy cảm                     |

---

### 4.2. Nhóm lãnh đạo

| Role                        | Mô tả                                                           |
| --------------------------- | --------------------------------------------------------------- |
| `CEO / Board`               | Ban lãnh đạo, xem toàn cảnh công ty                             |
| `COO / Operations Director` | Quản lý vận hành tổng thể                                       |
| `CFO / Finance Director`    | Quản lý tài chính, chi phí, lợi nhuận                           |
| `Head of Production`        | Quản lý toàn bộ khối sản xuất                                   |
| `Head of SEO`               | Quản lý khối SEO và hiệu suất kênh                              |
| `Head of HR`                | Quản lý nhân sự, tuyển dụng, đào tạo, lương thưởng liên quan HR |

---

### 4.3. Nhóm quản lý

| Role                 | Mô tả                         |
| -------------------- | ----------------------------- |
| `Department Manager` | Trưởng phòng/trưởng khối      |
| `Team Leader`        | Trưởng team/ekip              |
| `Project Manager`    | Trưởng dự án                  |
| `Channel Manager`    | Người quản lý kênh            |
| `Production Manager` | Quản lý sản xuất              |
| `QA Manager`         | Quản lý kiểm duyệt chất lượng |
| `HR Manager`         | Quản lý nhân sự               |
| `Finance Manager`    | Quản lý tài chính/kế toán     |
| `Training Manager`   | Quản lý đào tạo               |
| `Equipment Manager`  | Quản lý thiết bị/tài sản      |

---

### 4.4. Nhóm nhân viên

| Role                 | Mô tả                     |
| -------------------- | ------------------------- |
| `Employee`           | Nhân viên thông thường    |
| `Script Writer`      | Biên kịch                 |
| `Researcher`         | Nghiên cứu nội dung       |
| `Editor`             | Dựng video                |
| `Designer`           | Thiết kế                  |
| `Thumbnail Designer` | Thiết kế thumbnail        |
| `Voice Staff`        | Voice/âm thanh            |
| `SEO Staff`          | SEO/title/description/tag |
| `Uploader`           | Upload/xuất bản           |
| `QA Reviewer`        | Kiểm duyệt nội dung       |
| `HR Staff`           | Nhân sự                   |
| `Accountant`         | Kế toán                   |
| `Admin Staff`        | Hành chính                |

---

### 4.5. Nhóm bên ngoài

| Role         | Mô tả                                       |
| ------------ | ------------------------------------------- |
| `Freelancer` | Cộng tác viên/freelancer                    |
| `Candidate`  | Ứng viên tuyển dụng                         |
| `Guest`      | Khách mời hoặc đối tác giới hạn             |
| `Auditor`    | Người xem báo cáo/kiểm tra, không chỉnh sửa |

---

## 5. Ma trận quyền tổng quan theo module

### 5.1. Chú thích

```text
N = Không có quyền
V = Xem
C = Tạo
E = Sửa
M = Quản lý
A = Duyệt
S = Dữ liệu nhạy cảm
EX = Xuất báo cáo
```

---

## 6. Matrix cấp cao

| Module            | Owner / Board | System Admin |           Dept Manager |         Team Leader |        Project Manager |        Channel Manager |        HR |       Finance |     Employee |   Freelancer |
| ----------------- | ------------: | -----------: | ---------------------: | ------------------: | ---------------------: | ---------------------: | --------: | ------------: | -----------: | -----------: |
| Dashboard công ty |          V/EX |            V |                 V-Dept |              V-Team |              V-Project |              V-Channel |      V-HR |     V-Finance |        V-Own |            N |
| Cấu trúc công ty  |             M |            M |                 V-Dept |              V-Team |              V-Project |              V-Channel |         V |             V |        V-Own |            N |
| Nhân sự           |           V/M |            M |                 V-Dept |              V-Team |              V-Project |              V-Channel |         M |     V-Limited |        V-Own |            N |
| Role & Permission |             M |            M |            N/V-Limited |                   N |                      N |                      N |         N |             N |            N |            N |
| Kênh              |           V/M |            M |                 V-Dept |              V-Team |              V-Project |              M-Channel |         N |     V-Finance |    V-Limited |            N |
| Tài khoản kênh    |         V-S/A |          M-S |                      N |                   N |              V-Limited |     V/E-S nếu được cấp |         N |             N |            N |            N |
| Project           |           V/M |            M |                 M-Dept |           V/ E-Team |              M-Project |           V/ E-Channel | V-Limited |     V-Finance |   V-Assigned |   V-Assigned |
| Video / Content   |           V/M |            M |                 M-Dept |              M-Team |              M-Project |              M-Channel |         N |     V-Finance | C/E-Assigned | C/E-Assigned |
| Workflow Template |           A/M |            M |                  C/E/A |    V/E nếu được cấp |                  C/E/A |       V/E nếu được cấp |    C/E-HR |   C/E-Finance |            N |            N |
| Workflow Instance |           V/M |            M |                 M-Dept |              M-Team |              M-Project |              M-Channel |      M-HR |     M-Finance |   V-Assigned |   V-Assigned |
| Task              |           V/M |            M |                 M-Dept |              M-Team |              M-Project |              M-Channel |      M-HR |     M-Finance |      C/E-Own |      C/E-Own |
| Duyệt sản phẩm    |             A |          CFG |                 A-Dept |              A-Team |              A-Project |              A-Channel |         N |             N |            N |            N |
| Trả sửa / Defect  |           V/M |            M |                 M-Dept |              M-Team |              M-Project |              M-Channel |         N |             N |   C-Assigned |   C-Assigned |
| Evaluation Form   |           A/M |            M |                  C/E/A |                 V/E |                  C/E/A |                    V/E |    C/E-HR |             N |            N |            N |
| KPI               |           V/M |            M |               V/A-Dept |              V-Team |              V-Project |              V-Channel |      M-HR |     V-Finance |        V-Own |            N |
| Chấm công         |             V |          CFG |                 V-Dept |              V-Team |              V-Project |                      N |         M |     V-Limited |      C/V-Own |            N |
| Nghỉ phép         |             V |          CFG |                 A-Dept | A-Team nếu được cấp |                      V |                      N |         M |     V-Limited |      C/V-Own |            N |
| Lương             |         V-S/A |          CFG | V-Limited nếu được cấp |                   N |                      N |                      N |    V/M-HR |           M-S |        V-Own |            N |
| Thưởng / Phạt     |           A/M |          CFG |               C/A-Dept |              C-Team |              C-Project |              C-Channel |      M-HR |     M-Finance |        V-Own |            N |
| Doanh thu         |           V/M |          CFG |    V-Dept nếu được cấp |                   N | V-Project nếu được cấp |            V/M-Channel |         N |             M |            N |            N |
| Chi phí           |           V/M |          CFG |    V-Dept nếu được cấp |                   N | V-Project nếu được cấp | V-Channel nếu được cấp |         N |             M |            N |            N |
| Đề xuất chi       |           A/M |          CFG |                 A-Dept |              C-Team |            C/A-Project |              C-Channel |      C-HR |           M/A |        C-Own |            N |
| Chat              |           V/M |            M |                 M-Dept |              M-Team |              M-Project |              M-Channel |      M-HR |     M-Finance |          C/V |  C/V-Limited |
| Notification      |           V/M |          CFG |                      V |                   V |                      V |                      V |         V |             V |            V |    V-Limited |
| Meeting           |           V/M |            M |                 M-Dept |              M-Team |              M-Project |              M-Channel |      M-HR |             V |          C/V |    V-Limited |
| Audit Log         |           V/M |            M |            N/V-Limited |                   N |                      N |                      N |         N | V-Finance Log |            N |            N |

---

## 7. Quyền chi tiết theo nhóm dữ liệu nhạy cảm

### 7.1. Tài khoản kênh và mật khẩu

Dữ liệu này bao gồm:

* Gmail chính
* Gmail phụ
* Google Account
* YouTube Account
* TikTok Account
* Facebook Page
* AdSense
* Google Analytics
* Email recovery
* Số điện thoại recovery
* 2FA
* Mật khẩu
* Ghi chú bảo mật

### Ma trận quyền tài khoản kênh

| Role            | Xem tên tài khoản | Xem thông tin đăng nhập |               Chỉnh sửa |   Chuyển quyền |        Xem log truy cập |
| --------------- | ----------------: | ----------------------: | ----------------------: | -------------: | ----------------------: |
| Company Owner   |                Có |                      Có |                      Có |             Có |                      Có |
| CEO / Board     |                Có |         Có nếu được cấp |          Không mặc định | Không mặc định |                      Có |
| System Admin    |                Có |         Có nếu được cấp |                      Có |             Có |                      Có |
| Security Admin  |                Có |                      Có |                      Có |             Có |                      Có |
| Channel Manager |                Có |         Có nếu được cấp | Có trong kênh phụ trách | Không mặc định | Có trong kênh phụ trách |
| Project Manager |       Có giới hạn |          Không mặc định |                   Không |          Không |                   Không |
| Team Leader     |       Có giới hạn |                   Không |                   Không |          Không |                   Không |
| Employee        |             Không |                   Không |                   Không |          Không |                   Không |
| Freelancer      |             Không |                   Không |                   Không |          Không |                   Không |

Nguyên tắc bắt buộc:

```text
Mọi lần xem mật khẩu hoặc thông tin đăng nhập phải ghi Audit Log.
```

---

### 7.2. Lương, thưởng, phạt

| Role               | Xem lương bản thân |  Xem lương team | Xem lương phòng ban | Xem toàn công ty | Tạo bảng lương |             Duyệt bảng lương |
| ------------------ | -----------------: | --------------: | ------------------: | ---------------: | -------------: | ---------------------------: |
| Employee           |                 Có |           Không |               Không |            Không |          Không |                        Không |
| Team Leader        |                 Có |  Không mặc định |               Không |            Không |          Không |                        Không |
| Department Manager |                 Có | Có nếu được cấp |     Có nếu được cấp |            Không |        Đề xuất | Duyệt cấp phòng nếu được cấp |
| HR Manager         |                 Có |              Có |                  Có |  Có nếu được cấp |             Có |             Đề xuất/Duyệt HR |
| Accountant         |                 Có | Có nếu được cấp |     Có nếu được cấp |  Có nếu được cấp |             Có |     Không hoặc duyệt kế toán |
| Finance Manager    |                 Có |              Có |                  Có |               Có |             Có |                           Có |
| CFO                |                 Có |              Có |                  Có |               Có |             Có |                           Có |
| CEO / Owner        |                 Có |              Có |                  Có |               Có |             Có |                           Có |

Nguyên tắc:

```text
Không ai được xem lương người khác chỉ vì là trưởng team, 
trừ khi được cấp quyền HR/Finance rõ ràng.
```

---

### 7.3. Doanh thu, chi phí, lợi nhuận

| Role                   |                    Doanh thu kênh |              Chi phí kênh |  Lợi nhuận kênh | Chi phí nhân sự | Báo cáo tài chính tổng |
| ---------------------- | --------------------------------: | ------------------------: | --------------: | --------------: | ---------------------: |
| Owner / CEO            |                                Có |                        Có |              Có |              Có |                     Có |
| CFO / Finance Director |                                Có |                        Có |              Có |              Có |                     Có |
| Finance Manager        |                                Có |                        Có |              Có |              Có |                     Có |
| Accountant             |                     Có theo quyền |             Có theo quyền |   Có theo quyền |   Có theo quyền |          Có theo quyền |
| Channel Manager        |                 Có kênh phụ trách |           Có nếu được cấp | Có nếu được cấp |           Không |                  Không |
| Project Manager        | Có project phụ trách nếu được cấp |   Có project nếu được cấp | Có nếu được cấp |           Không |                  Không |
| Department Manager     |         Có phòng ban nếu được cấp | Có phòng ban nếu được cấp | Có nếu được cấp |  Không mặc định |                  Không |
| Employee               |                             Không |                     Không |           Không |           Không |                  Không |
| Freelancer             |                             Không |                     Không |           Không |           Không |                  Không |

---

## 8. Permission Matrix theo module chính

---

## 8.1. Organization & Employee

| Hành động         |   Owner |    System Admin |      HR Manager |      Dept Manager | Team Leader |         Employee |
| ----------------- | ------: | --------------: | --------------: | ----------------: | ----------: | ---------------: |
| Xem sơ đồ tổ chức | Company |         Company |         Company |              Dept |        Team |          Limited |
| Tạo phòng ban     |      Có |              Có |  Không mặc định |             Không |       Không |            Không |
| Sửa phòng ban     |      Có |              Có |  Không mặc định | Dept nếu được cấp |       Không |            Không |
| Tạo team          |      Có |              Có | Có nếu được cấp |     Có trong Dept |       Không |            Không |
| Thêm nhân sự      |      Có |              Có |              Có |           Đề xuất |       Không |            Không |
| Sửa hồ sơ nhân sự |      Có |              Có |              Có |           Limited |       Không |      Own limited |
| Xem hồ sơ nhân sự | Company |         Company |         Company |              Dept |        Team |              Own |
| Xem hợp đồng      |      Có | Có nếu được cấp |              Có |    Không mặc định |       Không | Own nếu được cấp |

---

## 8.2. Channel Management

| Hành động               |   Owner |    System Admin | Channel Manager |                Project Manager |           Dept Manager | Employee |
| ----------------------- | ------: | --------------: | --------------: | -----------------------------: | ---------------------: | -------: |
| Tạo kênh                |      Có |              Có | Có nếu được cấp |                          Không |         Không mặc định |    Không |
| Sửa thông tin kênh      |      Có |              Có |  Kênh phụ trách | Project liên quan nếu được cấp |      Dept nếu được cấp |    Không |
| Xem kênh                | Company |         Company |  Kênh phụ trách |              Project liên quan | Dept/Team nếu được cấp |  Limited |
| Xem doanh thu kênh      |      Có | Có nếu được cấp | Có nếu được cấp |                Có nếu được cấp |        Có nếu được cấp |    Không |
| Xem chi phí kênh        |      Có | Có nếu được cấp | Có nếu được cấp |                Có nếu được cấp |        Có nếu được cấp |    Không |
| Xem tài khoản kênh      |      Có | Có nếu được cấp | Có nếu được cấp |                 Không mặc định |                  Không |    Không |
| Cập nhật Channel Health |      Có |              Có |              Có |                Có nếu được cấp |                  Không |    Không |

---

## 8.3. Project & Content

| Hành động             |      Owner |    Dept Manager |   Project Manager |       Team Leader |   Channel Manager |       Employee | Freelancer |
| --------------------- | ---------: | --------------: | ----------------: | ----------------: | ----------------: | -------------: | ---------: |
| Tạo project           |         Có |              Có |   Có nếu được cấp |    Không mặc định |   Có nếu được cấp |          Không |      Không |
| Sửa project           |         Có |            Dept | Project phụ trách |    Không mặc định | Channel liên quan |          Không |      Không |
| Thêm kênh vào project |         Có | Có nếu được cấp |                Có |             Không |   Có nếu được cấp |          Không |      Không |
| Thêm video/content    |         Có | Có nếu được cấp |                Có |   Có nếu được cấp |   Có nếu được cấp | Không mặc định |      Không |
| Gán team/ekip         |         Có |              Có |                Có |           Đề xuất |           Đề xuất |          Không |      Không |
| Gán nhân sự           |         Có |              Có |                Có |     Có trong team |           Đề xuất |          Không |      Không |
| Xem project           |    Company |            Dept |           Project | Team nếu tham gia | Channel liên quan |       Assigned |   Assigned |
| Xem file nội dung     | Theo quyền |      Theo quyền |           Project |              Team |           Channel |       Assigned |   Assigned |

---

## 8.4. Workflow

| Hành động                    |   Owner | System Admin |        Dept Manager |                    Project Manager |    Team Leader | Employee |
| ---------------------------- | ------: | -----------: | ------------------: | ---------------------------------: | -------------: | -------: |
| Tạo workflow template        |      Có |           Có |                  Có |                    Có nếu được cấp | Không mặc định |    Không |
| Sửa workflow template        |      Có |           Có | Workflow thuộc Dept | Workflow tạo bởi mình nếu được cấp |          Không |    Không |
| Kích hoạt workflow           |      Có |           Có |                  Có |                    Có nếu được cấp |          Không |    Không |
| Áp dụng workflow vào project |      Có |           Có |                  Có |                                 Có | Không mặc định |    Không |
| Chỉnh step đang chạy         |      Có |           Có |     Có nếu được cấp |                   Có trong project | Không mặc định |    Không |
| Xem workflow                 | Company |      Company |                Dept |                            Project |           Team | Assigned |

---

## 8.5. Task

| Hành động    |         Owner |    Dept Manager | Project Manager |       Team Leader |           Employee |         Freelancer |
| ------------ | ------------: | --------------: | --------------: | ----------------: | -----------------: | -----------------: |
| Tạo task     |            Có |            Dept |         Project |              Team |    Có nếu được cấp |     Không mặc định |
| Giao task    |            Có |            Dept |         Project |              Team |              Không |              Không |
| Sửa task     |            Có |            Dept |         Project |              Team | Own nếu chưa duyệt | Own nếu chưa duyệt |
| Đổi deadline |            Có |            Dept |         Project | Team nếu được cấp |            Đề xuất |            Đề xuất |
| Nộp sản phẩm | Không áp dụng |   Không áp dụng |   Không áp dụng |     Không áp dụng |                 Có |                 Có |
| Comment      |            Có |              Có |              Có |                Có |      Có trong task |      Có trong task |
| Xem task     |       Company |            Dept |         Project |              Team |           Assigned |           Assigned |
| Xóa task     |            Có | Có nếu được cấp | Có nếu được cấp |    Không mặc định |              Không |              Không |

---

## 8.6. Approval & Revision

| Hành động       | Owner |    Dept Manager | Project Manager |     Team Leader |     QA Reviewer |        Employee |
| --------------- | ----: | --------------: | --------------: | --------------: | --------------: | --------------: |
| Duyệt cấp 1     |    Có | Có nếu được cấp | Có nếu được cấp |              Có | Có nếu được cấp |           Không |
| Duyệt cấp 2     |    Có |              Có |              Có |  Không mặc định |  Không mặc định |           Không |
| Duyệt cấp 3     |    Có | Có nếu được cấp |  Không mặc định |           Không |           Không |           Không |
| Trả sửa         |    Có |              Có |              Có |              Có |              Có |           Không |
| Tạo lỗi loại 1  |    Có |              Có |              Có |              Có |              Có | Có nếu được cấp |
| Tạo lỗi loại 2  |    Có |              Có |              Có | Có nếu được cấp |              Có |  Không mặc định |
| Gắn lỗi vào KPI |    Có |              Có | Có nếu được cấp |         Đề xuất |         Đề xuất |           Không |
| Hủy lỗi         |    Có | Có nếu được cấp | Có nếu được cấp |           Không |           Không |           Không |

---

## 8.7. KPI & Evaluation

| Hành động                    |   Owner |      HR Manager |    Dept Manager | Project Manager |    Team Leader | Employee |
| ---------------------------- | ------: | --------------: | --------------: | --------------: | -------------: | -------: |
| Tạo form đánh giá            |      Có |              Có |              Có | Có nếu được cấp | Không mặc định |    Không |
| Chấm điểm sản phẩm           |      Có |  Không mặc định |              Có |              Có |             Có |    Không |
| Xem KPI cá nhân              | Company |         Company |            Dept |         Project |           Team |      Own |
| Sửa KPI                      |      Có | Có nếu được cấp | Có nếu được cấp | Có nếu được cấp | Không mặc định |    Không |
| Khóa KPI tháng               |      Có |              Có | Có nếu được cấp |           Không |          Không |    Không |
| Liên kết KPI với thưởng/phạt |      Có |              Có |         Đề xuất |         Đề xuất |        Đề xuất |    Không |

---

## 8.8. HR, Attendance & Leave

| Hành động            |   Owner | HR Manager |        HR Staff |      Dept Manager |       Team Leader | Employee |
| -------------------- | ------: | ---------: | --------------: | ----------------: | ----------------: | -------: |
| Xem chấm công        | Company |    Company |         Company |              Dept |              Team |      Own |
| Chỉnh chấm công      |      Có |         Có | Có nếu được cấp |             Không |             Không |    Không |
| Tạo đơn bổ sung công |      Có |         Có |              Có |   Có cho bản thân |   Có cho bản thân |      Own |
| Duyệt bổ sung công   |      Có |         Có | Có nếu được cấp | Dept nếu được cấp | Team nếu được cấp |    Không |
| Tạo đơn nghỉ phép    | Own/All |    Own/All |             Own |               Own |               Own |      Own |
| Duyệt nghỉ phép      |      Có |         Có | Có nếu được cấp |              Dept | Team nếu được cấp |    Không |
| Xem ngày phép        | Company |    Company |         Company | Dept nếu được cấp | Team nếu được cấp |      Own |

---

## 8.9. Payroll, Bonus & Penalty

| Hành động                   |         Owner |           CFO | Finance Manager |      Accountant |      HR Manager |   Dept Manager | Employee |
| --------------------------- | ------------: | ------------: | --------------: | --------------: | --------------: | -------------: | -------: |
| Xem bảng lương cá nhân      |            Có |            Có |              Có |              Có |              Có |             Có |      Own |
| Xem bảng lương toàn công ty |            Có |            Có |              Có | Có nếu được cấp | Có nếu được cấp | Không mặc định |    Không |
| Tạo bảng lương              |            Có |            Có |              Có |              Có | Có nếu được cấp |          Không |    Không |
| Sửa bảng lương              |            Có |            Có |              Có | Có nếu được cấp | Có nếu được cấp |          Không |    Không |
| Duyệt bảng lương            |            Có |            Có | Có nếu được cấp |  Không mặc định |  Không mặc định |          Không |    Không |
| Tạo thưởng                  |            Có |            Có |              Có | Có nếu được cấp | Có nếu được cấp |        Đề xuất |    Không |
| Tạo phạt                    |            Có |            Có |              Có | Có nếu được cấp | Có nếu được cấp |        Đề xuất |    Không |
| Xác nhận bảng lương         | Không áp dụng | Không áp dụng |   Không áp dụng |   Không áp dụng |   Không áp dụng |  Không áp dụng |       Có |
| Khiếu nại bảng lương        | Không áp dụng | Không áp dụng |   Không áp dụng |   Không áp dụng |   Không áp dụng |  Không áp dụng |       Có |

---

## 8.10. Finance

| Hành động              | Owner | CFO | Finance Manager |      Accountant |    Dept Manager | Project Manager | Channel Manager |        Employee |
| ---------------------- | ----: | --: | --------------: | --------------: | --------------: | --------------: | --------------: | --------------: |
| Nhập doanh thu         |    Có |  Có |              Có |              Có |  Không mặc định |  Không mặc định | Có nếu được cấp |           Không |
| Nhập chi phí           |    Có |  Có |              Có |              Có | Có nếu được cấp | Có nếu được cấp | Có nếu được cấp |           Không |
| Xem lợi nhuận          |    Có |  Có |              Có | Có nếu được cấp | Có nếu được cấp | Có nếu được cấp | Có nếu được cấp |           Không |
| Tạo đề xuất chi        |    Có |  Có |              Có |              Có |              Có |              Có |              Có | Có nếu được cấp |
| Duyệt chi cấp 1        |    Có |  Có |              Có |  Không mặc định |              Có | Có nếu được cấp | Có nếu được cấp |           Không |
| Duyệt chi cấp 2        |    Có |  Có |              Có | Có nếu được cấp |  Không mặc định |  Không mặc định |  Không mặc định |           Không |
| Duyệt chi cấp 3        |    Có |  Có |  Không mặc định |           Không |           Không |           Không |           Không |           Không |
| Xuất báo cáo tài chính |    Có |  Có |              Có | Có nếu được cấp |  Không mặc định |  Không mặc định |  Không mặc định |           Không |

---

## 8.11. Chat & Notification

| Hành động                  | Owner |    System Admin |                Manager |                  Employee |                Freelancer |
| -------------------------- | ----: | --------------: | ---------------------: | ------------------------: | ------------------------: |
| Chat 1-1                   |    Có |              Có |                     Có |                        Có |           Có nếu được cấp |
| Tạo group thủ công         |    Có |              Có |                     Có |           Có nếu được cấp |                     Không |
| Group tự động theo project |    Có |              Có |                     Có | Tự được thêm nếu tham gia | Tự được thêm nếu tham gia |
| Group tự động theo kênh    |    Có |              Có |       Có nếu liên quan |          Có nếu liên quan |            Không mặc định |
| Xóa tin nhắn người khác    |    Có | Có nếu được cấp |         Không mặc định |                     Không |                     Không |
| Ghim tin                   |    Có |              Có | Có trong group quản lý |            Không mặc định |                     Không |
| Tắt thông báo cấp 1        | Không |           Không |                  Không |                     Không |                     Không |
| Tắt thông báo cấp 2        |    Có |              Có |                     Có |               Có một phần |               Có một phần |
| Tắt thông báo cấp 3        |    Có |              Có |                     Có |                        Có |                        Có |

---

## 9. Quy tắc duyệt theo vai trò

### 9.1. Duyệt sản phẩm nội dung

| Loại nội dung    | Cấp 1            | Cấp 2           | Cấp 3                   |
| ---------------- | ---------------- | --------------- | ----------------------- |
| Video thường     | Team Leader / QA | Project Manager | Không bắt buộc          |
| Video quan trọng | Team Leader / QA | Project Manager | Dept Manager / Board    |
| Video kênh lớn   | QA / Team Leader | Channel Manager | Board nếu cấu hình      |
| Thumbnail        | Team Leader / QA | Channel Manager | Không bắt buộc          |
| Script           | Script Leader    | Project Manager | Dept Manager nếu cần    |
| SEO metadata     | SEO Leader       | Channel Manager | Không bắt buộc          |
| Upload/xuất bản  | Uploader Lead    | Channel Manager | Project Manager nếu cần |

---

### 9.2. Duyệt tài chính

| Loại đề xuất      | Cấp 1                    | Cấp 2           | Cấp 3                    |
| ----------------- | ------------------------ | --------------- | ------------------------ |
| Chi phí nhỏ       | Trưởng team/trưởng dự án | Kế toán         | Không bắt buộc           |
| Chi phí phòng ban | Trưởng phòng             | Kế toán         | CFO                      |
| Chi phí lớn       | Trưởng phòng             | CFO             | CEO/Owner                |
| Chi phí kênh      | Channel Manager          | Finance Manager | CFO nếu vượt hạn mức     |
| Chi phí project   | Project Manager          | Finance Manager | CFO/CEO nếu vượt hạn mức |

---

### 9.3. Duyệt HR

| Quy trình         | Cấp 1                        | Cấp 2           | Cấp 3              |
| ----------------- | ---------------------------- | --------------- | ------------------ |
| Nghỉ phép thường  | Team Leader                  | Dept Manager    | HR nếu cần         |
| Nghỉ dài ngày     | Dept Manager                 | HR Manager      | Board nếu cần      |
| Chấm công bổ sung | Team Leader                  | HR Staff        | HR Manager nếu cần |
| Thưởng/phạt       | Team/Project Manager đề xuất | Dept Manager/HR | Board/Finance      |
| Tăng lương        | Dept Manager                 | HR/CFO          | CEO/Owner          |
| Kỷ luật           | Dept Manager                 | HR Manager      | Board              |

---

## 10. Quy tắc ưu tiên quyền

Khi một người có nhiều role, hệ thống xử lý theo thứ tự:

```text
1. Quyền bị cấm rõ ràng có ưu tiên cao nhất.
2. Quyền nhạy cảm phải được cấp riêng, không tự kế thừa.
3. Quyền theo project chỉ áp dụng trong project đó.
4. Quyền theo kênh chỉ áp dụng trong kênh đó.
5. Quyền theo phòng ban không tự động cho phép xem lương/tài khoản/tài chính nhạy cảm.
6. Quyền cao hơn có thể bao phủ quyền thấp hơn nếu cùng phạm vi.
7. Mọi quyền đặc biệt phải có audit log.
```

Ví dụ:

```text
Một người là Project Manager nhưng không có quyền Finance,
thì vẫn không được xem lợi nhuận nếu chưa được cấp thêm quyền tài chính.
```

Ví dụ khác:

```text
Một người là Team Leader nhưng không được xem mật khẩu tài khoản kênh,
trừ khi được cấp quyền Sensitive Account Access.
```

---

## 11. Quyền đặc biệt cần tách riêng

Các quyền sau không nên gắn mặc định vào role thông thường. Phải cấp riêng.

```text
View Salary
Edit Salary
Approve Payroll
View Channel Password
Edit Platform Account
View Company Profit
Export Finance Report
Delete Project
Delete Employee
Change Role Permission
Access Audit Log
Override Approval
Unlock Workflow Step
Close Serious Defect
```

---

## 12. Role mẫu cho từng vị trí thực tế

### 12.1. Trưởng dự án

Nên có role:

```text
Project Manager
+ Approval Level 1/2 trong project
+ Task Manager trong project
+ View Project Finance nếu được cấp
+ View Project KPI
```

Không mặc định có quyền:

```text
Xem lương
Xem mật khẩu kênh
Xem lợi nhuận toàn công ty
Sửa phân quyền
```

---

### 12.2. Quản lý kênh

Nên có role:

```text
Channel Manager
+ Manage Channel Info
+ View Channel Project
+ View Channel Content
+ Approve Upload
+ View Channel Analytics
+ View Channel Revenue nếu được cấp
```

Không mặc định có quyền:

```text
Xem toàn bộ tài chính công ty
Xem lương nhân sự
Xem mật khẩu nếu chưa cấp quyền nhạy cảm
```

---

### 12.3. Trưởng phòng

Nên có role:

```text
Department Manager
+ Manage Department Staff
+ View Department Projects
+ Approve Department Workflow
+ View Department KPI
+ Propose Bonus/Penalty
```

Không mặc định có quyền:

```text
Xem bảng lương chi tiết
Xem mật khẩu tài khoản kênh
Xem lợi nhuận toàn công ty
```

---

### 12.4. Nhân viên sản xuất

Nên có role:

```text
Employee / Production Staff
+ View assigned task
+ Submit work
+ Comment in assigned project
+ View own KPI
+ View own salary
+ Check-in / check-out
+ Request leave
```

Không có quyền:

```text
Xem task không liên quan
Xem tài chính
Xem tài khoản kênh
Duyệt sản phẩm nếu không được cấp thêm
```

---

### 12.5. Freelancer

Nên có role:

```text
Freelancer
+ View assigned task only
+ Submit assigned work
+ Comment in assigned task/project
+ Access limited files
```

Không có quyền:

```text
Xem nhân sự nội bộ
Xem dashboard
Xem tài chính
Xem lương
Xem tài khoản
Xem project khác
Xem chat công ty
```

---

## 13. Permission Group nên tạo sẵn trong hệ thống

Thay vì gán từng quyền lẻ, nên tạo các Permission Group.

### Nhóm quyền sản xuất

```text
Production Viewer
Production Staff
Production Leader
Production Manager
Production Approver
Production Admin
```

### Nhóm quyền kênh

```text
Channel Viewer
Channel Operator
Channel Manager
Channel Finance Viewer
Channel Account Viewer
Channel Admin
```

### Nhóm quyền tài chính

```text
Finance Viewer
Finance Editor
Finance Approver
Payroll Viewer
Payroll Editor
Payroll Approver
```

### Nhóm quyền HR

```text
HR Viewer
HR Staff
HR Manager
Attendance Manager
Leave Approver
Performance Manager
```

### Nhóm quyền hệ thống

```text
System Viewer
System Configurator
Permission Admin
Security Admin
Audit Viewer
```

---

## 14. Audit Log bắt buộc

Các hành động sau bắt buộc ghi log:

```text
Đăng nhập thất bại nhiều lần
Đổi mật khẩu
Xem mật khẩu kênh
Sửa tài khoản kênh
Thay đổi phân quyền
Tạo/xóa nhân sự
Sửa bảng lương
Duyệt bảng lương
Nhập/sửa doanh thu
Nhập/sửa chi phí
Xóa project
Xóa video
Duyệt/trả sửa sản phẩm
Đóng lỗi nghiêm trọng
Thay đổi workflow
Xuất báo cáo tài chính
```

Audit log cần lưu:

```text
Ai thực hiện
Thời gian
Hành động
Đối tượng bị tác động
Dữ liệu trước khi sửa
Dữ liệu sau khi sửa
IP / thiết bị nếu có
Lý do nếu là hành động nhạy cảm
```

---

## 15. Thiết kế quyền cho MVP v1

Trong MVP v1, nên triển khai trước 10 role cốt lõi:

```text
1. Company Owner
2. System Admin
3. Board / Executive
4. Department Manager
5. Team Leader
6. Project Manager
7. Channel Manager
8. HR Manager / HR Staff
9. Finance Manager / Accountant
10. Employee / Freelancer
```

Các role chuyên môn như Editor, Script Writer, Designer, SEO Staff có thể là `Job Position`, không nhất thiết là role phân quyền riêng ngay từ đầu.

Ví dụ:

```text
Role phân quyền: Employee
Position chuyên môn: Editor
```

Sau này nếu cần quyền rất khác nhau thì mới tách thêm role chuyên môn.

---

## 16. Kết luận

MVP v1 nên dùng mô hình phân quyền kết hợp:

```text
RBAC: phân quyền theo role
+ Scope Permission: giới hạn theo phòng ban, team, project, kênh
+ Object Permission: cấp quyền cho từng object cụ thể
+ Sensitive Permission: tách riêng dữ liệu nhạy cảm
+ Audit Log: ghi lại mọi hành động quan trọng
```

Mục tiêu là đảm bảo:

```text
Đúng người
Đúng quyền
Đúng phạm vi
Đúng dữ liệu
Đúng trách nhiệm
Có lịch sử kiểm tra
```

