# DECISIONS-01: SỔ QUYẾT ĐỊNH — CHỐT CÁC CÂU HỎI MỞ TRƯỚC TRIỂN KHAI

> **📚 Bộ tài liệu DECISIONS — Hệ thống Quản lý Doanh nghiệp**
> **DECISIONS-01 Chốt câu hỏi mở** · (DECISIONS-02+ sẽ bổ sung khi phát sinh quyết định mới)
>
> **Nguồn & liên quan:** [Chỉ mục: README](<../README.md>) · [Sản phẩm: PRD-00](<../PRD/PRD-00 Enterprise Management System .md>) · [Đặc tả: SPEC-01 Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) · [Backend: BACKEND-01](<../BACKEND/BACKEND-01_Backend_Architecture_Project_Setup.md>)

---

## 1. Thông tin tài liệu

| Trường        | Nội dung                                               |
| ------------- | ------------------------------------------------------ |
| Mã tài liệu   | DECISIONS-01                                           |
| Tên tài liệu  | Sổ Quyết định — Chốt các câu hỏi mở trước triển khai   |
| Tên dự án     | Hệ thống quản lý doanh nghiệp nội bộ                   |
| Tên sản phẩm  | Enterprise Management System                           |
| Phiên bản     | v1.0                                                   |
| Trạng thái    | 6 quyết định Block-code Đã chốt (23/06/2026); Block-1-module + linh hoạt còn Đề xuất |
| Giai đoạn     | Pre-Implementation Decision Lock                       |
| Ngày tạo      | 21/06/2026                                             |
| Ngày cập nhật | 23/06/2026                                             |
| Người viết    |                                                        |
| Người duyệt   | Cian (Product Owner)                                   |

---

## 2. Mục đích & cách dùng

### 2.1 Mục đích

SPEC-01 §29 liệt kê **15 câu hỏi mở** cần xác nhận trước khi viết spec module chi tiết và trước khi viết code. Một số câu trong số đó đã được **trả lời ngầm** bởi các quyết định kiến trúc chốt sau này (xem BACKEND-01 §4 và §7: PostgreSQL, UUID primary key, multi-tenant `company_id`, prefix `/api/v1`, RBAC + data scope, tách quyền dữ liệu nhạy cảm). Tài liệu này gom toàn bộ các câu hỏi đó thành một **sổ quyết định (decision log)** duy nhất, mỗi quyết định kèm khuyến nghị có lập luận và một ô để chủ doanh nghiệp / Product Owner duyệt.

Mục tiêu: **đóng băng phạm vi (lock scope)** trước khi lập trình, tránh tình trạng vừa code vừa đổi yêu cầu — vốn là nguyên nhân chính gây trễ tiến độ và nợ kỹ thuật (xem rủi ro "Scope quá lớn" tại SPEC-01 §27).

### 2.2 Cấu trúc cố định của mỗi quyết định

Mỗi quyết định (D-01 → D-15) được trình bày theo template thống nhất:

1. **Câu hỏi** — nguyên văn từ SPEC-01 §29.
2. **Bối cảnh & ảnh hưởng** — câu trả lời tác động tới DB / API / FE / permission nào.
3. **Các phương án** — 2–3 phương án kèm ưu/nhược.
4. **Khuyến nghị** — chọn 1 phương án, lập luận; ưu tiên giải pháp "MVP gọn nhưng thiết kế sẵn đường mở rộng".
5. **Ảnh hưởng nếu đổi sau** — chi phí thay đổi muộn (để cân nhắc mức độ rủi ro khi trì hoãn).
6. **Người quyết định / Trạng thái**.

### 2.3 Trạng thái & quy tắc khóa scope

Mỗi quyết định có một trong hai trạng thái:

| Trạng thái   | Ý nghĩa                                                                 |
| ------------ | ---------------------------------------------------------------------- |
| **Đề xuất**  | Đội thiết kế đã khuyến nghị, **đang chờ** Product Owner duyệt.         |
| **Đã chốt**  | Đã được người có thẩm quyền duyệt; trở thành ràng buộc bắt buộc.        |

Quy tắc: **chỉ khi TẤT CẢ quyết định có mức độ chặn "Block code" ở trạng thái "Đã chốt"** thì mới được phép khởi động lập trình các module liên quan. Các quyết định "Block 1 module" phải chốt trước khi bắt đầu module tương ứng. Các quyết định "Linh hoạt" có thể chốt song song trong lúc triển khai.

### 2.4 Thẩm quyền quyết định

| Vai trò                          | Thẩm quyền                                                                 |
| -------------------------------- | ------------------------------------------------------------------------- |
| **Product Owner / Chủ doanh nghiệp** | **Duyệt cuối** mọi quyết định nghiệp vụ và phạm vi. Chữ ký tại ô "Người quyết định". |
| Tech Lead / Kiến trúc sư         | Đề xuất khuyến nghị kỹ thuật; chốt các quyết định thuần kỹ thuật được PO ủy quyền. |
| HR / nghiệp vụ liên quan          | Cho ý kiến tư vấn về quy tắc nghiệp vụ (ngày phép, duyệt nghỉ, hồ sơ).     |

Khi tài liệu thiết kế khác mâu thuẫn với một quyết định **đã chốt** ở đây, áp dụng nguyên tắc nguồn sự thật của SPEC-01 §11.4 và sửa tài liệu lệch về đúng quyết định này.

---

## 3. Bảng tổng hợp trạng thái

> Mặc định mọi quyết định ở trạng thái **Đề xuất** (chờ duyệt). Mức độ chặn: **Block code** = phải chốt trước khi viết bất kỳ dòng code nền tảng nào · **Block 1 module** = phải chốt trước khi bắt đầu module đó · **Linh hoạt** = có thể quyết sau, ít rủi ro.

| ID    | Câu hỏi (rút gọn)                          | Khuyến nghị (rút gọn)                                              | Mức độ chặn      | Trạng thái | Người quyết định |
| ----- | ------------------------------------------ | ----------------------------------------------------------------- | ---------------- | ---------- | ---------------- |
| D-01  | Một công ty hay nhiều công ty?             | Single-company ở MVP, multi-tenant ready (`company_id`)           | Block code       | Đã chốt    | Cian             |
| D-02  | Hỗ trợ nhiều chi nhánh?                     | Chưa hỗ trợ ở MVP; thiết kế sẵn field `branch_id`                 | Block 1 module (HR) | Đề xuất | |
| D-03  | Phòng ban nhiều cấp?                        | Có — `parent_id` (cây phòng ban) ngay từ đầu                      | Block 1 module (HR) | Đề xuất | |
| D-04  | Duyệt nghỉ theo phòng ban hay quản lý TT?  | Theo quản lý trực tiếp là chính; HR scope Company                 | Block 1 module (LEAVE) | Đề xuất | |
| D-05  | Chấm công web / GPS / QR / Wi-Fi?          | MVP dùng WEB; thiết kế field `source` mở                         | Block 1 module (ATT) | Đề xuất | |
| D-06  | Lưu vị trí check-in?                        | Tùy chọn, chỉ lưu metadata khi cấu hình bật (cân nhắc NĐ13)      | Block 1 module (ATT) | Đề xuất | |
| D-07  | Ngày phép theo tháng / năm / thủ công?     | Theo năm + cộng dồn theo chính sách, cho điều chỉnh thủ công      | Block 1 module (LEAVE) | Đề xuất | |
| D-08  | Nhân viên tự cập nhật hồ sơ?               | Được **đề xuất** sửa; HR/Admin duyệt                             | Block 1 module (HR) | Đề xuất | |
| D-09  | HR có xem lương không?                      | KHÔNG mặc định; tách quyền `PAYROLL.SALARY.VIEW`                 | Block code       | Đã chốt    | Cian             |
| D-10  | Quản lý theo dự án hay task cá nhân?        | Cả hai; MVP mỗi task 1 assignee chính                            | Block 1 module (TASK) | Đề xuất | |
| D-11  | Có cần duyệt task hoàn thành?               | MVP KHÔNG bắt buộc; thiết kế status mở                          | Block 1 module (TASK) | Đề xuất | |
| D-12  | File lưu server nội bộ hay cloud?          | Object storage S3-compatible (MinIO self-host)                   | Block code       | Đã chốt    | Cian             |
| D-13  | Tiếng Việt / Anh / đa ngôn ngữ?           | Tiếng Việt trước, code **i18n-ready** ngay từ đầu               | Block code (FE)  | Đã chốt    | Cian             |
| D-14  | Phân quyền export riêng?                    | CÓ — quyền `….EXPORT` tách riêng                                | Block code       | Đã chốt    | Cian             |
| D-15  | Audit log cho thao tác xem nhạy cảm?       | CÓ — log hành động VIEW dữ liệu nhạy cảm                         | Block code       | Đã chốt    | Cian             |

---

## 4. Chi tiết các quyết định

### D-01 — Một công ty hay nhiều công ty?

- **Câu hỏi:** Doanh nghiệp có một công ty hay nhiều công ty trên cùng hệ thống?
- **Bối cảnh & ảnh hưởng:** Đây là quyết định **nền tảng** ảnh hưởng toàn bộ DB và mọi query. BACKEND-01 §4 đã chốt "hệ thống sẵn sàng multi-tenant bằng `company_id`" và mọi bảng tenant-specific phải filter `company_id` (§13.3). SPEC-01 §24 liệt kê "nhiều công ty trên cùng hệ thống" là yêu cầu mở rộng. Quyết định này xác định: ở MVP có **một** bản ghi company hay nhiều.
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. Single-company, không có `company_id` | Đơn giản nhất | Đổi sang đa công ty sau cực đắt: phải thêm cột vào mọi bảng + backfill + sửa mọi query |
  | B. **Single-company nhưng có `company_id` từ đầu (multi-tenant ready)** | Dùng 1 công ty ngay; sẵn sàng SaaS/đa công ty sau mà gần như không sửa schema | Thêm một cột + filter ở mỗi query (chi phí rất nhỏ vì làm sớm) |
  | C. Multi-company đầy đủ ở MVP (chuyển công ty, user thuộc nhiều công ty) | Sẵn sàng SaaS ngay | Phình scope MVP không cần thiết: cần company switcher, cross-company guard, seed nhiều tenant |
- **Khuyến nghị:** **Phương án B — "single-company, multi-tenant ready".** Vận hành MVP với đúng một công ty (một bản ghi `companies`), nhưng mọi bảng nghiệp vụ vẫn mang `company_id` và mọi repository nhận `companyId` từ auth context. Đây đúng tinh thần "MVP gọn nhưng thiết kế sẵn mở rộng" và đã được BACKEND-01 hiện thực hóa, nên về bản chất câu hỏi này **đã được trả lời ngầm bởi thiết kế** — tài liệu này chỉ chính thức hóa.
- **Ảnh hưởng nếu đổi sau:** Nếu chọn A rồi muốn lên đa công ty: rất đắt (ALTER mọi bảng, backfill `company_id`, viết lại toàn bộ query + guard). Nếu đã chọn B: gần như **0 chi phí schema**, chỉ cần bật luồng tạo/đổi company và cross-company guard.
- **Người quyết định / Trạng thái:** Đã chốt — Cian (PO), 23/06/2026

---

### D-02 — Có cần hỗ trợ nhiều chi nhánh không?

- **Câu hỏi:** Có cần hỗ trợ nhiều chi nhánh (branch) trong một công ty không?
- **Bối cảnh & ảnh hưởng:** Ảnh hưởng schema HR (DB-03): cần có thực thể `branch` và `employees.branch_id` hay không; ảnh hưởng data scope (báo cáo/bảng công theo chi nhánh) và bộ lọc danh sách. SPEC-01 §24 liệt kê "nhiều chi nhánh trong một công ty" là yêu cầu mở rộng, **không** nằm trong MVP.
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. **Chưa hỗ trợ ở MVP, thiết kế sẵn field `branch_id` (nullable)** | MVP gọn; thêm chi nhánh sau chỉ cần seed dữ liệu + bật UI lọc | Có một cột "ngủ" chưa dùng |
  | B. Hỗ trợ chi nhánh đầy đủ ngay MVP | Sẵn sàng doanh nghiệp đa chi nhánh | Tăng scope: CRUD chi nhánh, gán nhân viên, data scope theo chi nhánh, báo cáo theo chi nhánh |
  | C. Bỏ hoàn toàn khái niệm chi nhánh | Đơn giản tuyệt đối | Thêm sau phải migrate dữ liệu, gán lại nhân viên |
- **Khuyến nghị:** **Phương án A.** MVP không triển khai nghiệp vụ chi nhánh, nhưng để sẵn cột `branch_id` (nullable) trong bảng `employees` (và nơi cần báo cáo theo chi nhánh). Chi phí giữ chỗ một cột là không đáng kể, trong khi tránh được một migration đau đớn về sau. Phù hợp yêu cầu mở rộng SPEC-01 §24.
- **Ảnh hưởng nếu đổi sau:** Nếu không để sẵn field: phải ALTER bảng + backfill + gán lại nhân viên vào chi nhánh + thêm scope. Nếu đã để sẵn: chỉ cần thêm bảng `branches`, seed, và bật bộ lọc UI.
- **Người quyết định / Trạng thái:** Đề xuất

---

### D-03 — Cơ cấu phòng ban có nhiều cấp không?

- **Câu hỏi:** Cơ cấu phòng ban có nhiều cấp (cây phân cấp) không?
- **Bối cảnh & ảnh hưởng:** Ảnh hưởng trực tiếp DB-03 (bảng `departments`) và data scope `Department` (SPEC-01 §11.2). Nếu phòng ban phẳng, mỗi nhân viên chỉ thuộc một phòng ban không cha-con; nếu nhiều cấp, cần `parent_id` và logic duyệt cây khi resolve scope. SPEC-01 §24 liệt kê "nhiều phòng ban và cấp quản lý" là yêu cầu mở rộng.
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. Phòng ban phẳng (1 cấp) | Đơn giản | Doanh nghiệp thực tế thường có Khối → Phòng → Tổ; đổi sang cây sau khá đắt |
  | B. **Hỗ trợ nhiều cấp bằng `parent_id` ngay từ đầu** | Mô hình cây "self-referencing" rẻ khi làm sớm; MVP có thể chỉ dùng 1 cấp nhưng schema đã sẵn sàng | Resolve scope `Department` cần xử lý đệ quy/`WHERE department_id IN (subtree)` |
  | C. Cây phòng ban + ma trận (nhân viên thuộc nhiều phòng) | Linh hoạt tối đa | Quá phức tạp cho MVP, vi phạm giả định SPEC-01 §28 ("mỗi nhân viên thuộc một phòng ban chính") |
- **Khuyến nghị:** **Phương án B.** Thêm `departments.parent_id` (nullable) ngay từ DB-03. Đây là thay đổi **rẻ khi làm sớm** nhưng rất đắt nếu phải thêm sau (toàn bộ logic scope `Department` phải viết lại). MVP có thể khởi tạo cây phẳng 1 cấp, nhưng giữ đúng giả định SPEC-01 §28 "mỗi nhân viên thuộc một phòng ban chính". Truy vấn data scope `Department` dùng tập con cây.
- **Ảnh hưởng nếu đổi sau:** Thêm `parent_id` sau buộc viết lại toàn bộ resolver scope `Department`, sửa mọi báo cáo theo phòng ban, và rà soát lại quyền Manager. Làm sớm gần như miễn phí.
- **Người quyết định / Trạng thái:** Đề xuất

---

### D-04 — Manager duyệt nghỉ theo phòng ban hay theo quản lý trực tiếp?

- **Câu hỏi:** Manager duyệt đơn nghỉ theo phòng ban hay theo quản lý trực tiếp?
- **Bối cảnh & ảnh hưởng:** Quyết định cốt lõi của module LEAVE (SPEC-05) và data scope `Team` (SPEC-01 §11.2: "Team — dữ liệu của team/phòng ban mình quản lý"). BACKEND-01 §12.2 định nghĩa scope `Team` = nhân viên có `direct_manager_id = current_employee_id`. SPEC-01 §28 giả định "một nhân viên có thể có một quản lý trực tiếp" và "Manager chỉ quản lý nhân viên thuộc phạm vi được gán". Luồng duyệt nghỉ ở SPEC-01 §13.3: "Đơn được gửi đến Manager hoặc HR".
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. **Duyệt theo quản lý trực tiếp (`direct_manager_id`); HR có scope Company làm phương án dự phòng** | Khớp giả định SPEC-01 §28, khớp scope `Team` của BACKEND-01, đơn giản và rõ ràng người chịu trách nhiệm | Khi manager vắng/nghỉ cần cơ chế ủy quyền (đưa sang phase sau) |
  | B. Duyệt theo phòng ban (bất kỳ ai có quyền approve trong phòng) | Linh hoạt khi manager vắng | Mơ hồ trách nhiệm; cần định nghĩa "approver của phòng"; phức tạp hơn |
  | C. Workflow phê duyệt đa cấp cấu hình được | Mạnh nhất | Vượt scope MVP (SPEC-01 §24 xếp "nhiều workflow phê duyệt" vào mở rộng) |
- **Khuyến nghị:** **Phương án A — duyệt theo quản lý trực tiếp là chính, HR scope Company là kênh xử lý chung.** Đây là lựa chọn nhất quán với data scope `Team` đã chốt ở BACKEND-01 và giả định nhân sự ở SPEC-01 §28, đồng thời khớp PRD (đơn gửi tới Manager hoặc HR). Trường hợp nhân viên không có quản lý trực tiếp (ví dụ trưởng phòng) thì HR (scope Company) duyệt. Ủy quyền khi manager vắng đưa vào D-16+ / phase sau.
- **Ảnh hưởng nếu đổi sau:** Nếu sau này cần duyệt theo phòng ban hoặc đa cấp, phải mở rộng bảng cấu hình approver và resolver. Vì đã chốt scope `Team`/`Company` chuẩn, việc bổ sung là tăng thêm chứ không phá vỡ.
- **Người quyết định / Trạng thái:** Đề xuất

---

### D-05 — Chấm công MVP dùng web, GPS, QR hay Wi-Fi?

- **Câu hỏi:** Chấm công MVP dùng web, GPS, QR hay Wi-Fi?
- **Bối cảnh & ảnh hưởng:** Quyết định scope module ATT (SPEC-04). SPEC-01 §27 (bảng rủi ro) ghi rõ "Chấm công nhiều kiểu (GPS, QR, Wi-Fi, máy chấm công) → MVP chỉ làm check-in/check-out cơ bản"; §28 giả định "MVP chỉ hỗ trợ web app" và "chưa tích hợp máy chấm công vật lý". Ảnh hưởng schema ATT: cần một field `source`/`method` để phân loại nguồn chấm công.
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. **Chỉ WEB check-in/check-out; thêm field `source` (enum) để mở rộng** | Đúng scope MVP, đơn giản, nhanh; sẵn sàng thêm GPS/QR/Wi-Fi sau | Chưa chống gian lận chấm công hộ ở MVP |
  | B. Web + GPS ngay MVP | Chính xác vị trí | Cần xử lý quyền vị trí trình duyệt, độ chính xác, lưu toạ độ (kéo theo D-06 + NĐ13) |
  | C. Tích hợp máy chấm công / QR ngay | Chuyên nghiệp | Vượt xa scope MVP, cần thiết bị/SDK |
- **Khuyến nghị:** **Phương án A — MVP dùng WEB là chính, thiết kế cột `source` mở.** Bảng attendance có trường `source` (ví dụ enum `WEB`, dành sẵn `GPS`, `QR`, `WIFI`, `DEVICE`) để các kiểu chấm công khác thêm sau mà không đổi schema. Đúng tinh thần MVP gọn + mở rộng sẵn và nhất quán với rủi ro đã nêu ở SPEC-01 §27/§28.
- **Ảnh hưởng nếu đổi sau:** Có field `source` từ đầu thì thêm GPS/QR/Wi-Fi chỉ là thêm giá trị enum + luồng nhập liệu, không phá schema. Không có field này thì phải ALTER bảng attendance lịch sử.
- **Người quyết định / Trạng thái:** Đề xuất

---

### D-06 — Có cần lưu vị trí check-in không?

- **Câu hỏi:** Có cần lưu vị trí (toạ độ/IP/thiết bị) khi check-in không?
- **Bối cảnh & ảnh hưởng:** Phụ thuộc D-05. Ảnh hưởng schema ATT (cột `latitude`, `longitude`, `ip_address`, `device_info`) và **pháp lý dữ liệu cá nhân**: vị trí nhân viên là dữ liệu cá nhân nhạy cảm theo **Nghị định 13/2023/NĐ-CP (NĐ13)** về bảo vệ dữ liệu cá nhân — cần cơ sở pháp lý và sự đồng ý. BACKEND-01 §12.4 đã xếp "GPS/IP/device info" của ATT vào nhóm field nhạy cảm cần kiểm soát quyền.
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. **Tùy chọn: chỉ lưu metadata (IP/thiết bị/toạ độ) khi cấu hình công ty BẬT tính năng** | Mặc định an toàn pháp lý (không thu thập khi chưa cần); doanh nghiệp tự bật khi có cơ sở pháp lý | Cần một flag cấu hình + xử lý đồng ý |
  | B. Luôn lưu vị trí | Dữ liệu đầy đủ chống gian lận | Rủi ro NĐ13 nếu chưa có đồng ý; tăng dung lượng; nhạy cảm |
  | C. Không bao giờ lưu | Đơn giản, an toàn pháp lý tuyệt đối | Mất khả năng chống chấm công hộ sau này |
- **Khuyến nghị:** **Phương án A — lưu vị trí/metadata là TÙY CHỌN, mặc định TẮT, chỉ thu thập khi cấu hình bật và có cơ sở pháp lý.** Khi bật, các field này thuộc nhóm nhạy cảm (chỉ người có quyền xem, ghi audit log — liên kết D-15). Vấn đề tuân thủ NĐ13 (thông báo, đồng ý, thời hạn lưu, quyền của chủ thể dữ liệu) được xử lý chi tiết tại **COMPLIANCE-01** *(tài liệu song hành đang được tạo)*.
- **Ảnh hưởng nếu đổi sau:** Để sẵn cột nhưng mặc định tắt là rẻ. Nếu thu thập sai từ đầu (không có đồng ý) thì rủi ro pháp lý + phải xóa dữ liệu đã thu thập.
- **Người quyết định / Trạng thái:** Đề xuất

---

### D-07 — Ngày phép tính theo tháng, theo năm hay nhập thủ công?

- **Câu hỏi:** Số ngày phép tính theo tháng, theo năm hay nhập thủ công?
- **Bối cảnh & ảnh hưởng:** Cốt lõi của LEAVE (SPEC-05): cách tính `leave_balance`, cách reset đầu kỳ, cộng dồn (carry-over). BACKEND-01 §19.2 đã dự trù job "Leave accrual phase sau, balance reset phase sau". SPEC-01 §24 liệt kê "nhiều chính sách nghỉ phép" là mở rộng. Luật lao động Việt Nam quy định phép năm cơ bản 12 ngày/năm, cộng thêm theo thâm niên.
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. Theo năm cố định (cấp đủ quota đầu năm) | Đơn giản, khớp luật phép năm | Nhân viên mới vào giữa năm cần tính tỷ lệ |
  | B. Cộng dồn theo tháng (accrual) | Công bằng với người vào giữa năm | Phức tạp hơn, cần job tích lũy định kỳ |
  | C. **Theo năm + cộng dồn theo chính sách + cho điều chỉnh thủ công** | Linh hoạt: cấp quota năm, hỗ trợ tỷ lệ/cộng dồn theo `leave_policy`, HR điều chỉnh tay khi cần | Cần bảng chính sách + bút toán điều chỉnh balance có log |
- **Khuyến nghị:** **Phương án C.** Mặc định cấp phép **theo năm** với quota từ `leave_policy`, hỗ trợ **cộng dồn/tỷ lệ** theo chính sách công ty, và cho HR **điều chỉnh thủ công** (mọi điều chỉnh ghi bút toán `leave_balance_adjustment` có audit). Đây là mức linh hoạt tối thiểu để phản ánh luật VN mà không sa vào "nhiều công thức" của phase sau. Việc thực thi accrual tự động có thể bật ở job (BACKEND-01 §19.2).
- **Ảnh hưởng nếu đổi sau:** Nếu chốt cứng "theo năm, không điều chỉnh" rồi cần accrual/carry-over, phải thêm bảng chính sách + job + sửa logic balance. Thiết kế balance dạng "số dư + bút toán điều chỉnh" ngay từ đầu giúp mở rộng dễ.
- **Người quyết định / Trạng thái:** Đề xuất

---

### D-08 — Nhân viên có được tự cập nhật hồ sơ cá nhân không?

- **Câu hỏi:** Nhân viên có được tự cập nhật hồ sơ cá nhân không?
- **Bối cảnh & ảnh hưởng:** Ảnh hưởng HR (SPEC-03) và permission. SPEC-01 §10.5 (Employee) nêu "cập nhật một số thông tin cá nhân **nếu được phép**"; §13.1 nêu "nhân viên cập nhật hồ sơ cá nhân nếu được phép"; §26.2 chỉ yêu cầu "Employee xem được hồ sơ cá nhân". BACKEND-01 §9.4 liệt kê "Profile change approval rule" như một policy. Hồ sơ nhân sự là dữ liệu nhạy cảm (SPEC-01 §11.3).
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. Employee sửa trực tiếp, lưu ngay | Nhanh, ít việc cho HR | Mất kiểm soát dữ liệu nhạy cảm; nhân viên có thể sửa field quan trọng (mã NV, chức vụ, lương) |
  | B. Employee chỉ xem, mọi sửa đổi do HR | Kiểm soát chặt | HR quá tải, nhân viên không tự sửa được số điện thoại/địa chỉ |
  | C. **Employee ĐỀ XUẤT thay đổi (một số field cho phép) → HR/Admin DUYỆT mới áp dụng** | Cân bằng: nhân viên chủ động, HR kiểm soát; có vết duyệt (audit) | Cần luồng "yêu cầu thay đổi hồ sơ" + trạng thái chờ duyệt |
- **Khuyến nghị:** **Phương án C — cơ chế đề xuất + duyệt.** Nhân viên được **đề xuất** sửa một tập field an toàn (liên hệ, địa chỉ, người liên hệ khẩn cấp...); thay đổi vào trạng thái "chờ duyệt", HR/Admin duyệt mới ghi chính thức. Các field nhạy cảm/định danh (mã NV, phòng ban, chức vụ, hợp đồng, lương) **không** cho nhân viên sửa. Khớp đúng "Profile change approval rule" của BACKEND-01 §9.4 và tinh thần SPEC-03/PRD. Mọi lần duyệt ghi audit log.
- **Ảnh hưởng nếu đổi sau:** Nếu khởi đầu cho sửa trực tiếp rồi muốn thêm duyệt, phải bổ sung bảng yêu cầu + trạng thái và rà soát lại dữ liệu đã bị sửa tự do. Làm theo C ngay tránh phải "thắt lại" về sau.
- **Người quyết định / Trạng thái:** Đề xuất

---

### D-09 — HR có được xem lương không hay chỉ Payroll được xem?

- **Câu hỏi:** HR có được xem lương không hay chỉ Payroll Officer được xem?
- **Bối cảnh & ảnh hưởng:** Đây là **quyết định bảo mật dữ liệu nhạy cảm** ảnh hưởng thiết kế RBAC tổng thể. SPEC-01 §11.3 nêu nguyên tắc "Dữ liệu lương phải được tách quyền riêng, **không mặc định cho HR** nếu doanh nghiệp yêu cầu kiểm soát chặt"; §10.2 (Admin) "không nhất thiết được xem dữ liệu lương nếu không được cấp quyền riêng". Lương thuộc Phase 2 (PAYROLL), nhưng **nguyên tắc tách quyền phải chốt ngay** vì nó định hình catalog permission (API-10) và cách thiết kế RBAC seed.
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. HR mặc định xem lương | Tiện cho HR kiêm payroll | Vi phạm nguyên tắc tách quyền dữ liệu nhạy cảm SPEC-01 §11.3; rủi ro rò rỉ |
  | B. **Lương tách quyền riêng `PAYROLL.SALARY.VIEW`, KHÔNG gán mặc định cho HR; ai cần thì cấp riêng** | Đúng nguyên tắc bảo mật; doanh nghiệp toàn quyền quyết ai xem lương; HR có thể được cấp thêm nếu muốn | Cần quản trị viên gán quyền chủ đích (đúng như mong muốn) |
- **Khuyến nghị:** **Phương án B — tách quyền lương riêng, không mặc định cho HR.** Định nghĩa permission `PAYROLL.SALARY.VIEW` (và các quyền lương khác) như một nhóm độc lập trong catalog (API-10), **không** đưa vào role HR seed mặc định. Doanh nghiệp tự gán cho người phụ trách (Payroll Officer, hoặc HR cụ thể được ủy quyền). Nhất quán tuyệt đối với SPEC-01 §11.3 và mô hình "không hard-code role" của BACKEND-01 §6.4. Đây là quyết định **Block code** vì định hình RBAC seed dùng cho mọi module.
- **Ảnh hưởng nếu đổi sau:** Nếu lỡ gán lương cho HR theo mặc định rồi gỡ ra, rủi ro là dữ liệu đã bị xem/rò rỉ trong thời gian đó. Tách quyền từ đầu là biện pháp phòng ngừa, gần như không tốn thêm chi phí code.
- **Người quyết định / Trạng thái:** Đã chốt — Cian (PO), 23/06/2026

---

### D-10 — Công việc quản lý theo dự án hay chỉ task cá nhân?

- **Câu hỏi:** Công việc quản lý theo dự án hay chỉ task cá nhân?
- **Bối cảnh & ảnh hưởng:** Định hình module TASK (SPEC-06) và DB-06. SPEC-01 §12.5 liệt kê đủ "Tạo dự án / Thêm thành viên dự án / Tạo task / Giao task / Kanban / Việc của tôi". SPEC-01 §10.10 định nghĩa vai trò cấp dự án (Project Owner/Member/Watcher) và §11.2 bổ sung scope `Project`. Câu hỏi: MVP có thực thể project hay chỉ danh sách task phẳng.
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. Chỉ task cá nhân (không project) | Đơn giản nhất | Không khớp SPEC-06 vốn đã có project, scope Project, Kanban theo dự án |
  | B. **Cả project lẫn task; MVP mỗi task có 1 assignee chính** | Khớp SPEC-06, hỗ trợ Kanban/scope Project; "1 assignee chính" giữ MVP gọn | Cần bảng project + thành viên + vai trò cấp dự án |
  | C. Project + task + đa người phụ trách + sub-task | Mạnh nhất | Vượt scope MVP (đa assignee, dependency) |
- **Khuyến nghị:** **Phương án B — quản lý theo cả project lẫn task, MVP mỗi task có một assignee chính.** Đúng như SPEC-06 đã thiết kế (project, thành viên dự án, vai trò cấp dự án, scope `Project`). Giới hạn "1 assignee chính/task" giữ MVP đơn giản nhưng vẫn cho phép watcher. Đa assignee/sub-task/dependency để dành phase sau.
- **Ảnh hưởng nếu đổi sau:** Vì SPEC-06 đã giả định có project, chọn A sẽ mâu thuẫn tài liệu và phải làm lại. Chọn B đúng thiết kế; mở rộng đa assignee sau chỉ là thêm bảng liên kết.
- **Người quyết định / Trạng thái:** Đề xuất

---

### D-11 — Có cần duyệt task hoàn thành không?

- **Câu hỏi:** Có cần bước duyệt khi task được đánh dấu hoàn thành không?
- **Bối cảnh & ảnh hưởng:** Ảnh hưởng state machine của TASK (SPEC-01 §17.4: `Todo / In Progress / In Review / Done / Cancelled / Overdue`). Có sẵn trạng thái `In Review` — tức là **schema đã sẵn sàng** cho luồng duyệt, vấn đề là MVP có **bắt buộc** đi qua duyệt hay không. BACKEND-01 §9.4 liệt kê "Task state transition" là policy.
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. **MVP KHÔNG bắt buộc duyệt; assignee có thể chuyển thẳng sang `Done`; trạng thái `In Review` để sẵn (tùy chọn)** | Đơn giản, nhanh; vẫn cho phép dùng `In Review` thủ công nếu muốn | Không ép quy trình kiểm soát chất lượng |
  | B. Bắt buộc qua `In Review` → người có quyền duyệt mới `Done` | Kiểm soát chất lượng | Thêm bước, thêm quyền duyệt task, phức tạp cho MVP |
  | C. Cấu hình bật/tắt duyệt theo project | Linh hoạt | Vượt scope MVP |
- **Khuyến nghị:** **Phương án A — MVP KHÔNG bắt buộc duyệt task hoàn thành, nhưng thiết kế status mở.** Giữ đủ enum trạng thái (gồm `In Review`) như SPEC-01 §17.4 để không phá schema, nhưng MVP cho phép assignee chuyển task sang `Done` trực tiếp. Khi cần quy trình duyệt (phase sau), chỉ cần bật rule transition bắt buộc qua `In Review` — không đổi schema. Đúng tinh thần "giữ đơn giản, thiết kế status mở".
- **Ảnh hưởng nếu đổi sau:** Vì enum trạng thái đã đủ, thêm bước duyệt sau chỉ là thêm rule + permission `TASK.TASK.REVIEW`, không migrate dữ liệu. Rủi ro đổi sau thấp.
- **Người quyết định / Trạng thái:** Đề xuất

---

### D-12 — File upload lưu ở server nội bộ hay cloud storage?

- **Câu hỏi:** File upload lưu ở server nội bộ (filesystem) hay cloud/object storage?
- **Bối cảnh & ảnh hưởng:** Ảnh hưởng File service (BACKEND-01 §16.5, §20.6) và biến môi trường `FILE_STORAGE_DRIVER` (§23.1, hiện ví dụ là `local`). Ảnh hưởng khả năng scale (nhiều instance API không chia sẻ ổ đĩa cục bộ), backup, và bảo mật (file private mặc định, signed URL TTL ngắn). SPEC-01 §4.3 đặt mục tiêu kỹ thuật "tích hợp lưu trữ file" và khả năng SaaS.
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. Lưu trực tiếp filesystem server | Đơn giản local | Không scale ngang (multi-instance lệch file); backup khó; rủi ro mất khi container ephemeral |
  | B. **Object storage S3-compatible (MinIO self-host cho MVP, sẵn sàng AWS S3/cloud sau)** | Chuẩn ngành; scale ngang tốt; signed URL; tách storage khỏi compute; MinIO chạy được on-premise/Docker | Cần dựng MinIO + cấu hình bucket/policy |
  | C. Cloud công cộng (AWS S3/GCS) ngay | Vận hành nhẹ | Phụ thuộc nhà cung cấp + chi phí + cân nhắc dữ liệu ra nước ngoài (NĐ13/an ninh dữ liệu) |
- **Khuyến nghị:** **Phương án B — dùng object storage S3-compatible, triển khai MinIO self-host cho MVP.** Driver file dùng giao thức S3 (qua biến `FILE_STORAGE_DRIVER=s3`), MVP trỏ tới MinIO chạy bằng Docker (giữ dữ liệu trong nước/on-premise, hợp lý về pháp lý), về sau có thể đổi endpoint sang cloud mà **không sửa code** vì cùng API S3. Không lưu trực tiếp filesystem server. Khớp định hướng hạ tầng tại **DEVOPS-01** *(tài liệu song hành đang được tạo)*. File vẫn private mặc định + signed URL TTL ngắn (BACKEND-01 §20.6).
- **Ảnh hưởng nếu đổi sau:** Nếu lỡ lưu filesystem rồi muốn lên object storage, phải migrate toàn bộ file + đổi mọi đường dẫn lưu trong DB. Dùng abstraction S3 từ đầu thì đổi backend lưu trữ chỉ là đổi cấu hình.
- **Người quyết định / Trạng thái:** Đã chốt — Cian (PO), 23/06/2026

---

### D-13 — Hệ thống dùng tiếng Việt, tiếng Anh hay đa ngôn ngữ?

- **Câu hỏi:** Hệ thống dùng tiếng Việt, tiếng Anh hay đa ngôn ngữ?
- **Bối cảnh & ảnh hưởng:** Ảnh hưởng **toàn bộ frontend** (mọi chuỗi hiển thị) và một phần backend (thông điệp lỗi, template thông báo). BACKEND-01 §10.6 đã có header `locale`/`vi-VN` trong context và `/auth/me` trả `locale`. Đây là quyết định **chặn FE**: nếu khởi đầu hard-code chuỗi tiếng Việt rải rác trong code, việc tách ra để đa ngôn ngữ sau là **cực kỳ tốn kém** (phải quét toàn bộ UI).
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. Hard-code tiếng Việt trực tiếp trong UI | Nhanh nhất lúc đầu | Đổi sang đa ngôn ngữ sau phải bóc tách hàng nghìn chuỗi — rất đắt |
  | B. Đa ngôn ngữ đầy đủ (VI + EN) ngay MVP | Sẵn sàng quốc tế | Tăng việc dịch + bảo trì 2 bộ chuỗi khi MVP chưa cần |
  | C. **Tiếng Việt trước, NHƯNG code i18n-ready: mọi chuỗi qua key/dictionary, có hạ tầng locale ngay từ đầu** | Hiển thị tiếng Việt cho MVP; thêm tiếng Anh sau chỉ là thêm bộ dịch, không sửa component | Cần kỷ luật "không hard-code chuỗi" ngay từ commit đầu |
- **Khuyến nghị:** **Phương án C — tiếng Việt trước, code i18n-ready ngay từ đầu.** Ngôn ngữ mặc định và duy nhất ở MVP là **tiếng Việt (`vi-VN`)**, nhưng FE bắt buộc dùng cơ chế i18n (mọi chuỗi qua key, không nhúng cứng), và BE trả `locale` trong context (đã có). Nhấn mạnh: đây là **quyết định chặn FE** — phải chốt **trước khi viết dòng code FE đầu tiên**, vì đổi sau rất đắt. Thêm tiếng Anh sau chỉ là cung cấp file dịch.
- **Ảnh hưởng nếu đổi sau:** Nếu bỏ qua i18n từ đầu, chi phí "quốc tế hóa" về sau gần như viết lại tầng hiển thị. Làm i18n-ready ngay chỉ tốn chi phí thiết lập ban đầu nhỏ.
- **Người quyết định / Trạng thái:** Đã chốt — Cian (PO), 23/06/2026

---

### D-14 — Có cần phân quyền export dữ liệu riêng không?

- **Câu hỏi:** Có cần phân quyền export dữ liệu riêng (tách khỏi quyền xem) không?
- **Bối cảnh & ảnh hưởng:** Ảnh hưởng catalog permission (API-10) cho mọi module có export (HR, ATT, LEAVE, báo cáo). SPEC-01 §11.3 nêu rõ "Không cho xuất dữ liệu nhạy cảm nếu không có quyền export"; §10.3 (HR) "Xuất dữ liệu nhân sự **nếu có quyền**"; §27 (rủi ro dữ liệu nhạy cảm) "hạn chế export". BACKEND-01 §13.4 checklist "Export không bỏ qua tenant filter" và §10.7 "Export lớn dùng job riêng".
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. Ai xem được thì export được (không tách quyền) | Đơn giản | Vi phạm nguyên tắc SPEC-01 §11.3; người xem màn hình vẫn không nên tự ý mang dữ liệu ra ngoài |
  | B. **Quyền export tách riêng (`MODULE.RESOURCE.EXPORT`), độc lập với quyền VIEW** | Đúng nguyên tắc bảo mật; kiểm soát rò rỉ dữ liệu ra file; dễ audit ai export gì | Thêm một số permission code vào catalog |
- **Khuyến nghị:** **Phương án B — CÓ phân quyền export riêng.** Mỗi nguồn dữ liệu có thể export định nghĩa quyền `….EXPORT` riêng (ví dụ `HR.EMPLOYEE.EXPORT`, `ATT.TIMESHEET.EXPORT`), tách khỏi `….VIEW`. Việc export là hành động "mang dữ liệu ra ngoài hệ thống" nên phải kiểm soát chặt hơn xem trên màn hình, và **phải ghi audit log** (xem D-15, SPEC-01 §16.3 liệt kê "Xuất dữ liệu" là hành động cần log). Đây là quyết định **Block code** vì định hình catalog quyền chung.
- **Ảnh hưởng nếu đổi sau:** Nếu ban đầu gộp export vào view rồi tách ra, phải định nghĩa lại quyền + gán lại cho user + sửa guard ở mọi endpoint export. Tách từ đầu gần như miễn phí.
- **Người quyết định / Trạng thái:** Đã chốt — Cian (PO), 23/06/2026

---

### D-15 — Có cần audit log cho thao tác xem dữ liệu nhạy cảm không?

- **Câu hỏi:** Có cần ghi audit log cho thao tác **xem** (view) dữ liệu nhạy cảm không?
- **Bối cảnh & ảnh hưởng:** Ảnh hưởng audit service (BACKEND-01 §16.4) và bảng audit (DB-08). SPEC-01 §11.3 nguyên tắc 3: "Mọi thao tác **xem**, sửa, xuất dữ liệu nhạy cảm cần được ghi log"; §16.3 liệt kê "Xem dữ liệu nhạy cảm nếu cần" trong danh sách hành động cần log. NĐ13 cũng khuyến nghị nhật ký truy cập dữ liệu cá nhân. Lưu ý: log mọi lượt view sẽ sinh khối lượng lớn (SPEC-01 §23.2 ước tính thông báo tới 1 triệu bản ghi), nên cần khoanh vùng đúng "dữ liệu nhạy cảm".
- **Các phương án:**
  | Phương án | Ưu | Nhược |
  | --- | --- | --- |
  | A. Không log thao tác xem | Nhẹ hệ thống | Vi phạm SPEC-01 §11.3; không truy vết được ai đã xem CCCD/hợp đồng/lương |
  | B. Log MỌI thao tác xem mọi dữ liệu | Truy vết tối đa | Khối lượng log khổng lồ, gây chậm, tốn lưu trữ, nhiễu |
  | C. **Log thao tác XEM CHỈ với nhóm dữ liệu nhạy cảm (lương, CCCD/CMND, hợp đồng, file hồ sơ, vị trí check-in...)** | Đúng nguyên tắc bảo mật, khối lượng kiểm soát được, đủ để audit/tuân thủ | Cần đánh dấu rõ resource/field nào là "nhạy cảm" |
- **Khuyến nghị:** **Phương án C — CÓ audit log cho thao tác xem, giới hạn ở dữ liệu nhạy cảm.** Định nghĩa danh mục dữ liệu nhạy cảm theo SPEC-01 §11.3 (lương, tài khoản ngân hàng, CCCD/CMND, hợp đồng, hồ sơ kỷ luật/nghỉ việc, chấm công chi tiết, vị trí check-in nếu bật theo D-06, file nhạy cảm). Khi user xem các dữ liệu này, ghi audit (actor, target, time, IP) qua audit service (BACKEND-01 §16.4). Không log lượt xem dữ liệu thường để tránh phình log. Quyết định **Block code** vì định hình audit interceptor/decorator (`@AuditAction`) áp dụng toàn hệ thống. Chính sách lưu trữ/lưu giữ log (retention) xử lý tại **COMPLIANCE-01** *(song hành)*.
- **Ảnh hưởng nếu đổi sau:** Nếu không gắn audit view từ đầu, khi cần tuân thủ/điều tra sẽ thiếu dữ liệu lịch sử không thể tái tạo. Gắn interceptor audit ngay từ nền tảng là rẻ và đúng nguyên tắc.
- **Người quyết định / Trạng thái:** Đã chốt — Cian (PO), 23/06/2026

---

## 5. Quyết định bổ sung cần điền (D-16+)

Khu vực này dành cho các quyết định **chưa thuộc 15 câu hỏi SPEC-01 §29** nhưng cần chốt trước/khi triển khai. Đội dự án thêm dòng mới theo template ở §4. Một số quyết định hạ tầng/pháp lý được **chuyển sang tài liệu chuyên trách** và chỉ tham chiếu tại đây.

| ID    | Quyết định cần chốt                                  | Thuộc tài liệu xử lý          | Trạng thái | Ghi chú |
| ----- | ---------------------------------------------------- | ----------------------------- | ---------- | ------- |
| D-16  | RPO/RTO, backup & disaster recovery                  | **COMPLIANCE-01** *(song hành)* | Chờ        | Đã chuyển sang COMPLIANCE-01; DECISIONS chỉ tham chiếu |
| D-17  | Email provider (SMTP/SendGrid/SES...) cho NOTI email | **DEVOPS-01** *(song hành)*   | Chờ        | NOTI email "có thể triển khai sau" (SPEC-01 §20.1) |
| D-18  | Hosting trong nước hay ngoài nước (chủ quyền dữ liệu)| **DEVOPS-01** + **COMPLIANCE-01** | Chờ    | Liên quan NĐ13 & dữ liệu cá nhân |
| D-19  | Chính sách lưu giữ (retention) log & audit           | **COMPLIANCE-01**             | Chờ        | Liên kết D-15 |
| D-20  | Cơ chế ủy quyền duyệt khi manager vắng               | DECISIONS-02 (phase sau)      | Chờ        | Liên kết D-04 |
| D-21  | Quét virus file upload                               | **DEVOPS-01** / BACKEND-11    | Chờ        | BACKEND-01 §20.6 "có thể đưa phase sau" |
| D-22  | data_scope `'Project'`: widen CHECK hay dùng project-membership cho TASK | **DB-02 §4.7** | **Đã chốt 02/07/2026** | Cian chốt: GIỮ 5 bậc data_scope; TASK phân quyền dự án qua `project_members` ở service layer, KHÔNG thêm bậc engine-level (chi tiết + đường mở lại: DB-02 §4.7) |
| ...   | *(thêm khi phát sinh)*                               |                               |            |         |

> **Lưu ý:** **DEVOPS-01** (hạ tầng/triển khai) và **COMPLIANCE-01** (pháp lý/tuân thủ NĐ13, bảo vệ dữ liệu cá nhân, retention, RPO/RTO) là **hai tài liệu song hành đang được tạo**. Các quyết định hạ tầng và pháp lý được giữ ở đó để tránh trùng lặp; DECISIONS-01 chỉ giữ con trỏ tham chiếu.

---

## 6. Quy trình duyệt

1. **Soạn khuyến nghị** — Tech Lead/Kiến trúc sư điền §3 và §4 (mặc định trạng thái "Đề xuất").
2. **Rà soát nghiệp vụ** — HR và các bên nghiệp vụ liên quan cho ý kiến vào các quyết định nghiệp vụ (D-04, D-07, D-08).
3. **Duyệt cuối** — Product Owner / Chủ doanh nghiệp ký từng quyết định (ghi tên + ngày vào ô "Người quyết định"), đổi trạng thái sang **"Đã chốt"**.
4. **Khóa scope** — Khi toàn bộ quyết định **Block code** đã "Đã chốt", phát hành phiên bản tài liệu (cập nhật §1) và cho phép khởi động lập trình nền tảng.
5. **Đồng bộ tài liệu** — Nếu một quyết định "Đã chốt" mâu thuẫn với SPEC/DB/API/BE/FE, áp dụng SPEC-01 §11.4 và sửa tài liệu lệch.
6. **Thay đổi sau khi chốt** — Mọi thay đổi một quyết định đã "Đã chốt" phải tạo dòng mới trong §7 (changelog), nêu lý do và đánh giá lại "Ảnh hưởng nếu đổi sau".

---

## 7. Lịch sử thay đổi (Changelog)

| Phiên bản | Ngày       | Người thực hiện | Thay đổi                                                                 |
| --------- | ---------- | --------------- | ----------------------------------------------------------------------- |
| v1.0      | 21/06/2026 |                 | Tạo sổ quyết định; đưa 15 câu hỏi SPEC-01 §29 thành D-01→D-15; tất cả ở trạng thái "Đề xuất"; thêm khung D-16+ tham chiếu DEVOPS-01/COMPLIANCE-01. |
| v1.1      | 23/06/2026 | Cian            | Chốt 6 quyết định Block-code D-01/09/12/13/14/15 → "Đã chốt"; mở khóa lập trình nền tảng. |

---

## 8. Tài liệu liên quan

| Tài liệu | Vai trò trong quyết định |
| --- | --- |
| [README — Chỉ mục tài liệu](<../README.md>) | Bản đồ toàn bộ bộ tài liệu |
| [PRD-00 — Product Requirements](<../PRD/PRD-00 Enterprise Management System .md>) | Định hướng sản phẩm, vai trò người dùng (cơ sở cho D-04, D-08, D-09) |
| [SPEC-01 — Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) | Nguồn gốc 15 câu hỏi (§29); nguyên tắc phân quyền (§11), dữ liệu (§16), mở rộng (§24), rủi ro (§27), giả định (§28) |
| [BACKEND-01 — Kiến trúc Backend](<../BACKEND/BACKEND-01_Backend_Architecture_Project_Setup.md>) | Các quyết định kiến trúc đã chốt trả lời ngầm D-01, D-09, D-12, D-14, D-15 (§4, §7, §12, §13, §16) |
| DEVOPS-01 — Hạ tầng & Triển khai *(song hành, đang tạo)* | Xử lý D-17, D-18, D-21 (email, hosting, quét virus, object storage vận hành) |
| COMPLIANCE-01 — Tuân thủ & Bảo vệ dữ liệu *(song hành, đang tạo)* | Xử lý D-16, D-18, D-19 và NĐ13 (vị trí check-in D-06, audit view D-15, retention) |

---

> **Ghi chú khóa scope:** Tài liệu này chỉ đạt mục tiêu khi **mọi quyết định ở trạng thái "Đã chốt"**. Trước thời điểm đó, mọi code viết ra dựa trên quyết định "Đề xuất" đều mang rủi ro phải làm lại.
