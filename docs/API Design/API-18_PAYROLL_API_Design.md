# API-18: PAYROLL API DESIGN (Tiền lương — Hồ sơ lương · Thưởng/phạt · Kỳ lương · Tính · Duyệt · Phiếu lương)

**MODULE PAYROLL - TIỀN LƯƠNG - API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>) · [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [API-11 ME](<API-11_ME_API_Design.md>) · [API-12 GOAL](<API-12_GOAL_API_Design.md>) · [API-13 CHAT](<API-13_CHAT_API_Design.md>) · [API-14 ASSET](<API-14_ASSET_API_Design.md>) · [API-15 ROOM](<API-15_ROOM_API_Design.md>) · [API-17 RECRUIT](<API-17_RECRUIT_API_Design.md>) · **API-18 PAYROLL**
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-11 PAYROLL](<../SPEC/SPEC-11 PAYROLL.md>) · [Thiết kế DB: DB-13](<../DB/DB-13 PAYROLL Database Design.md>) · [DB-09 §8.19 Index](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 Seed PAYROLL](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) · [Ma trận phân quyền §9g](<../permission-matrix-spec.md>) · [Chỉ mục tài liệu](<../README.md>)
>
> **Đánh số (PAY-DEC-001):** PAYROLL nhận **API-18** — **API-13 vốn dự định cho PAYROLL đã bị CHAT chiếm**, API-14/15 = ASSET/ROOM, **API-16 = «PERMISSION AUDIT REPORT»**, API-17 = RECRUIT. Không dồn số, không đè tài liệu sống.

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-18 |
| Tên tài liệu | PAYROLL API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Module | PAYROLL - Tiền lương |
| Phiên bản | **v2.0** (wave S15-PAYROLL-V2) — v1 giữ nguyên trong cùng file, phần v2 là **mục con thêm vào**, đánh dấu **«v2»** tại chỗ |
| Trạng thái | **Stub — Approved** (owner duyệt gói wave S13-PAYROLL 31/08/2026, cùng SPEC-11 §1). Khung endpoint đã chốt; DTO chi tiết bổ sung ở WO backend `S13-PAYROLL-BE-1`/`BE-2`. **v2: owner ký PAY-DEC-011..020 ngày 02/09/2026 (SPEC-11 §22.1)** — 50 route mới khoá ở §5b, DTO đầy đủ ở `S15-PAYROLL-BE-1..5` |
| Giai đoạn | Phase 2 «HR nâng cao» · v1 = wave S13-PAYROLL · **v2 = wave S15-PAYROLL-V2** — hậu go-live |
| Tài liệu nguồn | SPEC-11 PAYROLL (**v2.0**), API-01 Tổng quan, DB-13, DB-09/10, permission-matrix-spec §9g (+ **§9g.2** — 17 cặp v2) |
| Ngày tạo / cập nhật | 31/08/2026 / **11/09/2026** — `S15-PAYROLL-DOC-1` viết bản v2: §4.1b · §4.2 (**viết lại**) · §5b · §5.1b · §5.2 · §6.5 · §8 · §9 |

> **Trạng thái Stub:** khoá **tên file + danh sách endpoint + cặp quyền + nguyên tắc bắt buộc** để README/SPEC-11 §15 trỏ nhất quán. DTO/schema đầy đủ, ví dụ payload và OpenAPI bổ sung ở WO backend — đồng bộ `packages/contracts/src/payroll.ts` (**file đã tồn tại với DTO hướng cũ, phải VIẾT LẠI** — DB-13 §7 enum, kế hoạch ở §10).
>
> **Bản đồ «đọc mục nào cho v2»** — mọi mục v2 của tài liệu này là **mục con THÊM**, không ghi đè mục v1: §4.1b (nhóm API v2) · §5b (50 endpoint v2) · §5.1b (ràng buộc hiện thực v2) · §6.5b bảng **PAYROLL-ERR-018..033** (16 mã). Hai chỗ **thay thẳng**: **§4.2** (danh sách «không bao gồm» viết lại theo PARK-PAYROLL-002) và **§5.2** (thêm hàng trạng thái hiện thực).
>
> ⚠️ **SPEC-11 §1 liệt kê SÁU chỗ v2 THAY THẲNG v1** (đánh dấu 🔁 tại chỗ trong SPEC-11) — **đọc SPEC-11, đừng đọc câu v1 tương ứng**:
>
> | # | Mục SPEC-11 | v1 | **v2** |
> | --- | --- | --- | --- |
> | 1 | **§13.1** | FSM **7** trạng thái, `publish: Approved → Paid` | FSM **8** trạng thái, `publish: Approved → Published`, thêm `complete-batch: Published → Paid` + bảng RESET có `paid_by/at` |
> | 2 | **§13.2** | phiếu `Published` khi kỳ ∈ `{Paid, Locked}` | kỳ ∈ **`{Published, Paid, Locked}`** |
> | 3 | **§17** | `PAYSLIP_PUBLISHED` phát ở `Approved → Paid` | phát ở **`Approved → Published`** (mã · dedupe · người nhận KHÔNG đổi) |
> | 4 | **§3.5** | tiêu đề + câu «7 trạng thái» | «**8** trạng thái» + khối di trú `Paid → Published` |
> | 5 | **§15 hàng 014** | `Approved → Paid` | **`Approved → Published`** *(NOTI-EVENT-023 phát Ở ĐÂY)* |
> | 6 | **§15 hàng 031 · 032 · 033** | lọc kỳ `{Paid, Locked}`; ack đòi kỳ `Paid` | lọc **`{Published, Paid, Locked}`**; ack đòi kỳ **`Published`** |
>
> ⚠️ Hệ quả cho **chính tài liệu này**: các câu v1 còn lại ở **§2 mục 3** («FSM 7 trạng thái»), **§5 bảng/blockquote**, **§5.1 hàng «FSM kỳ»/«Own-scope phiếu lương»** và **§6.1** là **văn bản v1 giữ nguyên có chủ đích** — khi mâu thuẫn, **SPEC-11 §13.1/§13.2/§15 (hàng 🔁) là bản còn hiệu lực**. Tóm tắt ràng buộc hiện thực: **§5.1b**.
>
> ⚠️ **§3.3 của SPEC-11 (tiền tính ở SQL) KHÔNG nằm trong sáu chỗ trên** — nó bị **đảo MỘT PHẦN**, không bị thay: ranh giới chính xác TS↔SQL ở **SPEC-11 §3.9**, tóm tắt ở §5.1b.

---

## 2. Mục đích tài liệu

Mô tả thiết kế API cho module **PAYROLL** — hồ sơ lương versioned, thưởng/phạt theo kỳ, kỳ lương 7 trạng thái với four-eyes, máy tính lương snapshot-đóng-băng, phiếu lương append-only + «phiếu của tôi» (SPEC-11 §2). API-18 dùng làm cơ sở cho:

1. Backend triển khai controller/service/DTO dưới prefix `/api/v1/payroll-periods`, `/api/v1/salary-profiles`, `/api/v1/bonus-penalties`, `/api/v1/payslips`, `/api/v1/me/payslips`, `/api/v1/payroll/pickers`.
2. Frontend triển khai 6 màn `PAY-SCREEN-001..006` (`apps/app/src/routes/payroll/` + màn ME).
3. QA viết ma trận allow/deny per-pair (17 cặp), IDOR cross-employee, FSM 7 trạng thái, race double-generate **và `generate ‖ reopen`**, đối soát số cho khu vực PAYROLL.

---

## 3. Căn cứ thiết kế

1. **API-01** — prefix `/api/v1`, envelope/lỗi/pagination chuẩn, header `X-Request-Id`/`Idempotency-Key`, authentication + permission + data scope + business validation + audit.
2. **SPEC-11 PAYROLL** — nguồn sự thật nghiệp vụ: nguyên tắc (§3), permission **17 cặp** + **bản đồ thu hồi 19 cặp di sản** (§11), **17 mã lỗi** (§12), FSM + **bảng RESET vết duyệt** + máy tính lương + data scope (§13), API (§15), sự kiện (§17), audit/masking (§18), PAY-DEC-001..010 + tinh chỉnh sau plan-review (§22).
3. **DB-13** — **bản đồ reconcile 6 bảng di sản G12** (§5) + 1 bảng mới `payroll_period_lines`; append-only `payslips`/`payslip_items`/`payslip_acknowledgements`; chốt cuối UNIQUE + CHECK four-eyes.
4. **DB-09 §8.19** — index PAYROLL; **DB-10** — seed role `payroll-officer` (2FA) + thu hồi 16 cặp di sản + **17 cặp mới + 32 grant** + 4 event NOTI.
5. **permission-matrix-spec §9g** — ma trận data_scope per-(perm, role).
6. **API-04 ATT** — `attendance_periods` phải `locked` trước khi tính (điều kiện của `calculate`); `companies.working_days_json` + `public_holidays.is_paid_holiday` là nguồn mẫu số `work_days`. PAYROLL **không** dựng cổng khoá ngược và **không** viện dẫn `ATT-ERR-024` (SPEC-11 §3.5).
7. **API-05 LEAVE** — `leave_types.paid` tách phép có lương / không lương.
8. **API-03 HR** — danh tính hiển thị (không dùng `employee_profiles.base_salary` để tính — PAY-DEC-003).
9. **API-17 RECRUIT** — khuôn hiện thực gần nhất (guard 2 tầng theo bảng hằng route→pair, masking ở mapper, `@Idempotent()`, điểm chiếu danh tính duy nhất, hình dạng `details` mảng `ErrorDetail`).

---

## 4. Phạm vi API-18

### 4.1 Bao gồm trong v1

| Nhóm API | Mô tả |
| --- | --- |
| Payroll Periods | CRUD + FSM 7 trạng thái · gom đầu vào · cảnh báo dữ liệu thiếu · tính · đọc/điều chỉnh dòng · gửi duyệt · duyệt/từ chối (four-eyes) · sinh phiếu · phát hành · khoá · mở lại · export XLSX · summary (widget DASH) |
| Pickers | Danh bạ nhân sự **và** danh sách kỳ công — trường bó hẹp, gác bằng cặp PAYROLL (officer không có cặp HR/ATT/AUTH nào) |
| Salary Profiles | Danh sách/chi tiết (mask + **audit lượt đọc**) · tạo phiên bản mới theo `effective_date` · sửa · xoá mềm |
| Bonus / Penalties | Danh sách/chi tiết · tạo (lý do bắt buộc) · sửa khi `Pending` · duyệt/từ chối (chặn tự duyệt) |
| Payslips | Danh sách/chi tiết phiếu của người khác (**audit lượt đọc**) |
| Me / Payslips | «Phiếu lương của tôi» (Own) · breakdown · xác nhận |

### 4.1b **v2** — Bao gồm trong v2 (SPEC-11 §5.1b · §15.1 — wave S15-PAYROLL-V2)

**50 route mới `PAYROLL-API-036..085`**, chia theo **4 track** đúng như SPEC-11 §15.1 (mỗi track = một WO backend):

| Track | Nhóm API | Mã | WO | Mô tả |
| --- | --- | --- | --- | --- |
| **A** | **Payroll Employees** | 036–037 | `S15-PAYROLL-BE-1` | Danh sách + chi tiết nhân sự hưởng lương — **chiếu HR bó hẹp** qua `PayrollPeopleRepository` (PAY-DEC-016), mở rộng `PAYROLL-API-034`; `taxCode` **vắng khoá** nếu thiếu `('view','salary-profile')` |
| **A** | **Employee Settings** (BH · công đoàn · ngân hàng) | 038–039 | `S15-PAYROLL-BE-1` | Đọc/upsert 1 hàng/nhân sự; số tài khoản ra ngoài **chỉ dạng `bankAccountLast4`** |
| **A** | **Dependents** (người phụ thuộc) | 040–042 | `S15-PAYROLL-BE-1` | Đọc/tạo theo nhân sự + sửa/xoá mềm theo `dependent_id`; chồng lấp khoảng hiệu lực ⇒ 409 032 |
| **A** | **Timesheet kỳ** | 043 | `S15-PAYROLL-BE-1` | Bảng công tổng hợp kỳ (ĐỌC, nguồn ATT) — **tái dùng `computeInputsTx`**, không viết truy vấn thứ hai |
| **B** | **Salary Components** + kiểm công thức | 044–048 | `S15-PAYROLL-BE-2` | Catalog thành phần lương + công thức; `validate-formula` kiểm **tại chỗ, không ghi gì** |
| **B** | **Payroll Templates** + đặt thành phần + xem trước | 049–054 | `S15-PAYROLL-BE-2` | Mẫu bảng lương gắn vào kỳ; `PUT …/components` **đặt lại toàn bộ trong MỘT lượt**; `preview` chạy trên **dữ liệu giả do client gửi** |
| **B** | **Statutory Rates** | 055–058 | `S15-PAYROLL-BE-2` | Bảng tỉ lệ luật định versioned theo `effective_from` (7 bậc TNCN · trần · giảm trừ) |
| **C** | **Advances** (tạm ứng) + Own | 059–065 | `S15-PAYROLL-BE-4` | FSM `Pending → Approved/Rejected → Deducted`, four-eyes; `GET /me/payroll-advances` là đường Own |
| **C** | **Payment Batches** (đợt chi trả) | 066–072 | `S15-PAYROLL-BE-4` | Lập đợt từ kỳ `Published` · dòng chi · **tệp UNC** · **`complete` ⇒ kỳ `Paid`** |
| **C** | **Budgets** (ngân sách lương) | 073–075 | `S15-PAYROLL-BE-4` | Ngân sách năm × đơn vị + thực hiện; nguồn `PAYROLL-WIDGET-002` |
| **C** | **Import thu nhập/khấu trừ khác** | 076–077 | `S15-PAYROLL-BE-4` | Import XLSX → `bonus_penalties` trạng thái `Pending` + tệp mẫu sinh từ **chính khuôn mà 076 parse** |
| **D** | **Overview** (tổng quan module) | 078–079 | `S15-PAYROLL-BE-5` | 6 khối + 3 loại Lời nhắc của `PAY-SCREEN-015`; **KHÔNG cache** |
| **D** | **Reports** (7 báo cáo) | 080–082 | `S15-PAYROLL-BE-5` | Danh mục (metadata) · dữ liệu · export XLSX; **KHÔNG cache**, audit mỗi lượt |
| **D** | **PDF phiếu lương** | 083–085 | `S15-PAYROLL-BE-5` | Phiếu người khác · phiếu **của mình** (không cần cặp export) · **batch → signed-URL ZIP**; sinh từ snapshot `payslip_items`, **không tính lại** |

> Danh sách route đầy đủ + cặp quyền từng route: **§5b** (nguồn: SPEC-11 §15.1). Cặp quyền v2: SPEC-11 §11.3 (**17 cặp, tất cả `is_sensitive = true`**) + permission-matrix §9g.2. Màn hình tiêu thụ: SPEC-11 §9.1 (**`PAY-SCREEN-007..017`** — 11 màn; `017` «Tạm ứng của tôi» thuộc **module ME**, cùng khuôn `PAY-SCREEN-006`).

### 4.2 Không bao gồm (ngoài phạm vi — **PARK-PAYROLL-002**, SPEC-11 §5.2b)

> 🔁 **Mục này ĐÃ VIẾT LẠI ngày 11/09/2026.** Bản trước liệt kê PARK-PAYROLL-001 của v1. **v2 đã LẤY LẠI** ba mục khỏi danh sách đó — chúng **không còn** ngoài phạm vi: **engine BHXH/BHYT/BHTN/TNCN luỹ tiến** (PAY-DEC-014 → API-036..085 track B) · **PDF phiếu lương + export batch signed-URL** (PAY-DEC-019 → `PAYROLL-API-083/084/085`) · **report theo phòng ban + variance** dưới dạng **7 báo cáo** (PAY-DEC-018 → `PAYROLL-API-080..082`). Danh sách dưới đây là **PARK-PAYROLL-002 — danh sách ĐÓNG**, ghi để không ai tự thêm route ngoài §5b.

| Nguồn | Mục ngoài v2 | Vì sao |
| --- | --- | --- |
| PARK-001 còn lại | **Khiếu nại phiếu lương** (dispute/resolve) | v2 vẫn chỉ **xác nhận**; mở lại kéo theo dựng lại cột đã GỠ ở `payslip_acknowledgements` (DB-13 §5.6) |
| PARK-001 còn lại | **Multi-currency** · **chu kỳ trả ngoài tháng** (biweekly/weekly) · **loại lương giờ/khoán** | N=1 chạy một chu kỳ tháng, VND; mở ra là nhân đôi mọi công thức |
| PARK-001 còn lại | **Workflow duyệt nhiều cấp** | v2 giữ **một cấp four-eyes** (PAY-DEC-007) |
| PARK-001 còn lại | **Remote/work-trip rule** · **tệp đính kèm điều chỉnh** | chưa có nơi cấu hình rule ở ATT |
| Gạt mới (G6) | **Doanh số · KPI · Sản phẩm** làm đầu vào tính lương | **ngoài phạm vi SẢN PHẨM**, không phải hoãn — de-media-fy đã loại KPI/doanh thu theo kênh (CLAUDE.md §1) |
| Gạt mới (G10) | **Phân bổ lương** (cost center) | kế toán chi phí — finance OUT |
| Gạt mới | **Lịch gửi báo cáo định kỳ** | cần scheduler + kênh gửi; v2 chỉ xuất **theo yêu cầu** (082) |
| Gạt mới (G17) | **Trợ lý AI** · thư viện mẫu cloud · «lấy lại dữ liệu» từ AMIS · **đa pháp nhân** | Phase 5 / SaaS |
| Gạt mới | **Mẫu bảng lương theo từng nhân viên / theo vị trí** | v2 chỉ **toàn công ty hoặc theo `org_unit`** (PAY-DEC-013) |
| Gạt mới | **Lương tối thiểu vùng nhiều VÙNG (I–IV)** | công ty đơn-vùng: `payroll_statutory_rates` lưu **một** mức áp dụng (SPEC-11 §13.7) |

> Ngoài bảng trên, v2 **vẫn không** sửa/huỷ phiếu lương đã phát hành (xử lý bằng thưởng/phạt kỳ SAU) — `payslips`/`payslip_items` là sổ append-only (§7).
>
> ⚠️ **KHÔNG cấp cặp `('export','payslip-pdf')`** — PAY-DEC-019 đã ký đường khác: PDF hàng loạt (085) assert `('export','payroll')` **+** `('view-payslip','payslip')`; PDF phiếu của chính mình (084) chỉ cần `('view-own-payslip','payslip')`. Cấp cặp thứ 18 ở đây là **đảo một quyết định owner đã ký** (SPEC-11 §11.3 ghi chú 5).

---

## 5. Endpoint tổng hợp PAYROLL (SPEC-11 §15)

Prefix: `/api/v1`

```http
GET    /api/v1/payroll-periods
POST   /api/v1/payroll-periods
GET    /api/v1/payroll-periods/summary
GET    /api/v1/payroll-periods/{payroll_period_id}
PATCH  /api/v1/payroll-periods/{payroll_period_id}
POST   /api/v1/payroll-periods/{payroll_period_id}/collect
GET    /api/v1/payroll-periods/{payroll_period_id}/readiness
POST   /api/v1/payroll-periods/{payroll_period_id}/calculate
GET    /api/v1/payroll-periods/{payroll_period_id}/lines
PATCH  /api/v1/payroll-periods/{payroll_period_id}/lines/{line_id}
POST   /api/v1/payroll-periods/{payroll_period_id}/submit
POST   /api/v1/payroll-periods/{payroll_period_id}/approve
POST   /api/v1/payroll-periods/{payroll_period_id}/reject
POST   /api/v1/payroll-periods/{payroll_period_id}/generate-payslips
POST   /api/v1/payroll-periods/{payroll_period_id}/publish
POST   /api/v1/payroll-periods/{payroll_period_id}/lock
POST   /api/v1/payroll-periods/{payroll_period_id}/reopen
GET    /api/v1/payroll-periods/{payroll_period_id}/export

GET    /api/v1/salary-profiles
POST   /api/v1/salary-profiles
GET    /api/v1/salary-profiles/{salary_profile_id}
PATCH  /api/v1/salary-profiles/{salary_profile_id}

GET    /api/v1/bonus-penalties
POST   /api/v1/bonus-penalties
GET    /api/v1/bonus-penalties/{bonus_penalty_id}
PATCH  /api/v1/bonus-penalties/{bonus_penalty_id}
POST   /api/v1/bonus-penalties/{bonus_penalty_id}/approve
POST   /api/v1/bonus-penalties/{bonus_penalty_id}/reject

GET    /api/v1/payslips
GET    /api/v1/payslips/{payslip_id}

GET    /api/v1/me/payslips
GET    /api/v1/me/payslips/{payslip_id}
POST   /api/v1/me/payslips/{payslip_id}/acknowledge

GET    /api/v1/payroll/pickers/people
GET    /api/v1/payroll/pickers/attendance-periods
```

> **35 mã PAYROLL-API = 35 route HTTP** (không mã nào gói 2 route). Route-census đếm route — WO BE regen census với 35, khai `API_MODULE_TAGS` cho `PAYROLL`.
>
> ⚠️ **Route-census KHÔNG phải cổng duy nhất.** `apps/api/test/foundation/route-http-coverage.e2e-spec.ts` đặt `MAX_UNCOVERED_TOTAL = 0` và `MIN_COVERED_COUNT` là **SÀN**; từ khoá `salary`/`payslip` xếp nhóm PAYROLL vào rủi ro cao ⇒ **mỗi route mới phải có file test chạm đúng literal path**, và phải **siết `MIN_COVERED_COUNT` cùng commit** với WO BE.
>
> ⚠️ **`GET /payroll-periods/summary` PHẢI khai TRƯỚC `GET /payroll-periods/{id}`** — nếu không, `summary` bị nuốt thành `:id` rồi trả 400 «không phải UUID» (bài học `goals/tree`). Ba route dưới `{id}` (`readiness`, `lines`, `export`) không có rủi ro này.
>
> Hai picker nằm dưới basePath `payroll/pickers` trong khi 33 route kia phẳng — controller riêng (`PayrollPickersController`) vẫn khai chung `API_MODULE_TAGS` nhóm `PAYROLL` để OpenAPI + route-census gom đúng module (khuôn `RecruitPickersController`). **Cả hai picker là BẮT BUỘC, không phải tiện nghi**: `payroll-officer` giữ **0 cặp ngoài PAYROLL** ⇒ không gọi được `GET /attendance/periods` (`('read','attendance')`) lẫn API-03 HR — thiếu picker thì `PAYROLL-API-002/004` và màn thưởng/phạt **không dùng được** (đúng lớp lỗi RECRUIT B4).

### 5b **v2** — Endpoint mới `PAYROLL-API-036..085` (SPEC-11 §15.1)

Prefix `/api/v1`. Bốn khối dưới đây theo đúng **4 track** của SPEC-11 §15.1; trong mỗi khối, route **TĨNH khai TRƯỚC** route `{id}` cùng cấp (xem cảnh báo bẫy thứ tự bên dưới).

**Track A — Nhân viên · hồ sơ lương v2 · bảng công** *(`S15-PAYROLL-BE-1`, mã 036–043)*

```http
GET    /api/v1/payroll/employees
GET    /api/v1/payroll/employees/{user_id}
GET    /api/v1/payroll/employees/{user_id}/settings
PUT    /api/v1/payroll/employees/{user_id}/settings
GET    /api/v1/payroll/employees/{user_id}/dependents
POST   /api/v1/payroll/employees/{user_id}/dependents
PATCH  /api/v1/payroll/dependents/{dependent_id}
GET    /api/v1/payroll-periods/{payroll_period_id}/timesheet
```

**Track B — Thành phần lương · mẫu bảng lương · tỉ lệ luật định** *(`S15-PAYROLL-BE-2`, mã 044–058)*

```http
GET    /api/v1/payroll/salary-components
POST   /api/v1/payroll/salary-components
POST   /api/v1/payroll/salary-components/validate-formula
GET    /api/v1/payroll/salary-components/{salary_component_id}
PATCH  /api/v1/payroll/salary-components/{salary_component_id}

GET    /api/v1/payroll/templates
POST   /api/v1/payroll/templates
GET    /api/v1/payroll/templates/{payroll_template_id}
PATCH  /api/v1/payroll/templates/{payroll_template_id}
PUT    /api/v1/payroll/templates/{payroll_template_id}/components
POST   /api/v1/payroll/templates/{payroll_template_id}/preview

GET    /api/v1/payroll/statutory-rates
POST   /api/v1/payroll/statutory-rates
GET    /api/v1/payroll/statutory-rates/{statutory_rate_id}
PATCH  /api/v1/payroll/statutory-rates/{statutory_rate_id}
```

**Track C — Tạm ứng · chi trả · ngân sách · import** *(`S15-PAYROLL-BE-4`, mã 059–077)*

```http
GET    /api/v1/payroll/advances
POST   /api/v1/payroll/advances
GET    /api/v1/payroll/advances/{payroll_advance_id}
PATCH  /api/v1/payroll/advances/{payroll_advance_id}
POST   /api/v1/payroll/advances/{payroll_advance_id}/approve
POST   /api/v1/payroll/advances/{payroll_advance_id}/reject
GET    /api/v1/me/payroll-advances

GET    /api/v1/payroll/payment-batches
POST   /api/v1/payroll/payment-batches
GET    /api/v1/payroll/payment-batches/{payment_batch_id}
PATCH  /api/v1/payroll/payment-batches/{payment_batch_id}
GET    /api/v1/payroll/payment-batches/{payment_batch_id}/lines
GET    /api/v1/payroll/payment-batches/{payment_batch_id}/export
POST   /api/v1/payroll/payment-batches/{payment_batch_id}/complete

GET    /api/v1/payroll/budgets
POST   /api/v1/payroll/budgets
PATCH  /api/v1/payroll/budgets/{payroll_budget_id}

POST   /api/v1/payroll-periods/{payroll_period_id}/import-adjustments
GET    /api/v1/payroll/imports/adjustments-template
```

**Track D — Tổng quan · báo cáo · PDF** *(`S15-PAYROLL-BE-5`, mã 078–085)*

```http
GET    /api/v1/payroll/overview
GET    /api/v1/payroll/overview/reminders
GET    /api/v1/payroll/reports
GET    /api/v1/payroll/reports/{report_code}
GET    /api/v1/payroll/reports/{report_code}/export
GET    /api/v1/payslips/{payslip_id}/pdf
GET    /api/v1/me/payslips/{payslip_id}/pdf
POST   /api/v1/payroll-periods/{payroll_period_id}/payslips/pdf-batch
```

> **50 mã v2 = 50 route HTTP** (không mã nào gói 2 route) ⇒ **tổng module sau v2 = 85 route** (`PAYROLL-API-001..085`). WO BE regen route-census với **85** và **siết `MIN_COVERED_COUNT` của `route-http-coverage.e2e-spec.ts` CÙNG COMMIT** với từng WO BE — cổng đó đặt `MAX_UNCOVERED_TOTAL = 0` và xếp từ khoá `salary`/`payslip` vào nhóm rủi ro cao ⇒ **mỗi route mới phải có file test chạm đúng literal path**. Bảng mã ↔ path ↔ cặp quyền ↔ audit/NOTI: **SPEC-11 §15.1** (nguồn sự thật, không nhân bản ở đây để tránh drift).
>
> ⚠️ **Bốn bẫy thứ tự khai route** *(cùng lớp `goals/tree` mà v1 đã vấp ở `summary`)* — route TĨNH phải khai **TRƯỚC** route `{id}` cùng cấp:
>
> 1. `GET /payroll/reports` (080) **TRƯỚC** `GET /payroll/reports/{report_code}` (081);
> 2. `POST /payroll/salary-components/validate-formula` (048) **TRƯỚC** `PATCH /payroll/salary-components/{salary_component_id}` (047);
> 3. `GET /payroll/imports/adjustments-template` (077) đứng dưới **prefix riêng** nên an toàn — giữ nguyên prefix, đừng gộp về `payroll/`;
> 4. `GET /payroll/employees/{user_id}/…` (037–041) phải nằm trong **controller có prefix `payroll/employees`** để không đụng `payroll/pickers` (`PAYROLL-API-034/035`).
>
> ⚠️ **`PATCH /payroll/dependents/{dependent_id}` (042) CỐ Ý KHÔNG lồng dưới `/payroll/employees/{user_id}`.** `dependentId` đã đủ định danh; lồng thêm `user_id` tạo **hai nguồn sự thật cho cùng một phép kiểm quyền** (URL nói người A, hàng DB nói người B). Service vẫn kiểm hàng thuộc company và **resolve `userId` TỪ HÀNG**, không từ URL.
>
> ⚠️ **MƯỜI MỘT route mới nhận `Idempotency-Key` do CLIENT sinh — danh sách ĐÓNG** (SPEC-11 §15.1): **039 · 041 · 045 · 050 · 056 · 060 · 067 · 072 · 074 · 076 · 085**. Khoá **không** suy từ payload (`idempotency-key-must-be-content-derived` — server tự suy khoá từ payload làm hai lượt khác nhau đụng nhau); chống trùng **nghiệp vụ** vẫn là việc của UNIQUE ở DB (§6.6). ⇒ `@Idempotent()` sau v2 phủ **11 route mới + 5 route v1** (002 · 007 · 013 · 020 · 024) = **16 route**.
>
> **Hai route Own của v2 thuộc app ME, không phải PAYROLL**: `GET /me/payroll-advances` (065) và `GET /me/payslips/{payslip_id}/pdf` (084) — cùng khuôn `/me/payslips*` của v1 (SPEC-11 §9.1 **`PAY-SCREEN-017`** «Tạm ứng của tôi» — mã riêng, không phải biến thể `012b`), **không** kéo `access:payroll` vào.

### 5.1 Bảng endpoint (stub — chi tiết DTO ở WO backend)

Bảng mã ↔ method/path ↔ cặp quyền ↔ audit/NOTI: xem **SPEC-11 §15** (nguồn sự thật, không nhân bản để tránh drift). Điểm buộc phải giữ khi hiện thực:

| Chủ đề | Ràng buộc |
| --- | --- |
| **Masking tiền** | Mọi trường tiền (`baseSalary`, `allowances`, `gross`, `net`, `deduction*`, `bonus*`, `penalty*`, `amount`) **chỉ có mặt** khi caller giữ cặp tương ứng — **vắng khoá**, không `null`, không `0`; FE schema `.optional()`. DTO danh sách kỳ (`view:payroll-period`, không nhạy cảm) **không chở số tiền nào, kể cả tổng** (SPEC-11 §18) |
| **Đọc dòng bảng lương** | `GET /payroll-periods/{id}/lines` · `summary` (018) · export (vế đọc) · widget DASH đều gác bằng **`('view-line','payroll-period')`** — **cặp ĐỌC thuần, TÁCH khỏi cặp ghi `calculate`**. Không dùng `('view','payroll-period')` (cố ý `is_sensitive=false`, không được chở tiền) và không dùng `calculate` (người chỉ có `approve` sẽ duyệt mù; ai thấy widget đều ghi được lương). `summary`/widget thêm **SÀN scope `Company`** |
| **Export** | assert **cả hai cặp** `('export','payroll')` **+** `('view-line','payroll-period')`; > 10.000 dòng ⇒ **422 PAYROLL-ERR-016**; audit một hàng, payload **không có số tiền** (SPEC-11 §18) |
| **Audit lượt ĐỌC** | **7 đường** đọc lương của người khác ghi `audit_logs` **trong cùng transaction** với lượt đọc (khuôn reveal+audit atomic của `hr-read.service`; rollback ⇒ 0 audit): `lines` · `summary` · `export` · `GET /payslips` · `GET /payslips/{id}` · `GET /salary-profiles` · `GET /salary-profiles/{id}`. **`/me/payslips*` KHÔNG ghi** — tự xem lương của mình không phải sự kiện an ninh |
| **FSM kỳ** | 7 trạng thái ép ở service qua **một hàm** `assertPeriodTransition` (SPEC-11 §13.1); vi phạm → **409 PAYROLL-ERR-001**. **MỌI hành động đổi trạng thái mở tx bắt đầu bằng `SELECT … FROM payroll_periods … FOR UPDATE`** — không chỉ `calculate`. `reopen`/`publish` đọc cờ **`payslips_generated_at`** trên chính hàng kỳ (KHÔNG đếm bảng `payslips`). Hai hành động chạy **tại chỗ**: `calculate` lại ở `Calculated`, `generate-payslips` ở `Approved`. `Locked` là terminal tuyệt đối |
| **Reset vết duyệt** | `reject` xoá `submitted_*`; **`reopen` xoá `calculated_*` + `submitted_*` + `approved_*`** (bảng RESET SPEC-11 §13.1). Không reset ⇒ `approve → reopen → cùng người submit lại` vi phạm CHECK four-eyes ⇒ `23514` = **500**. Service **phải map `23514`**: four-eyes → 409 **PAYROLL-ERR-005**, adjustment-check → 400 `VALIDATION-ERR-001` |
| **Four-eyes** | `('approve','payroll-period')` **không grant** cho `payroll-officer` (tầng quyền) **và** service so `submitted_by ≠ approved_by` ⇒ **409 PAYROLL-ERR-005** (tầng logic) **và** CHECK `payroll_periods_four_eyes_check` ở DB (chốt cuối). Ba tầng, không bỏ tầng nào. **`submit` kiểm trước có người duyệt hợp lệ khác actor** ⇒ **422 PAYROLL-ERR-017** — công ty một-người-duyệt không kẹt vĩnh viễn ở `Reviewing` |
| **Tiền tính ở SQL** | pro-rate · cộng/trừ · làm tròn · `GREATEST(gross − deduction, 0)` làm **trong câu lệnh SQL** set-based cho cả kỳ; **cấm số thực JS**, cấm vòng lặp per-người (`clamp-must-be-sql-not-js`) |
| **Snapshot đóng băng** | `calculate` ghi `input_snapshot_json`; `generate-payslips` copy đóng băng sang `payslips`. Đổi ATT/LEAVE/hồ sơ lương sau đó **không** làm đổi số đã tính |
| **Chốt cuối DB** | race `generate-payslips`/tạo kỳ/xác nhận/tạo phiên bản lương → bóc `23505` từ `error.cause` (drizzle bọc) → **006/008/015/014**, **không 500** |
| **Own-scope phiếu lương** | `/me/payslips*` lọc `payslips.user_id` = user của caller **và** kỳ ∈ `Paid`/`Locked` (§13.2 — phiếu `Generated` chưa phát hành thì nhân viên không thấy); phiếu người khác → **404 PAYROLL-ERR-010** (không 403); caller không có phiếu → danh sách **rỗng**, không lỗi |
| **Trạng thái phiếu là DẪN XUẤT** | `Generated`/`Published`/`Acknowledged` server tính trong DTO từ `payroll_periods.status` + sự tồn tại hàng ack — **không có cột**, không có CHECK (SPEC-11 §13.2) |
| **Idempotency** | `@Idempotent()` trên POST tạo (002/020/024) và hành động nặng (007 `calculate`, 013 `generate-payslips`); key **do client sinh** khi mở form / bấm nút; TTL 15′; replay + `Idempotency-Replayed: true`. Chống trùng **nghiệp vụ** là việc của UNIQUE ở DB |
| **Nối ATT** | `calculate` đòi `attendance_periods` của tháng đó `locked` ⇒ **409 PAYROLL-ERR-002**. **PAYROLL KHÔNG dựng cổng khoá ngược** — kỳ công đã bất biến từ lúc `locked` (trigger `0064` chặn `locked → open`), và **không viện dẫn `ATT-ERR-024`**: mã đó không tồn tại trong `apps/api/**` và SPEC-04 vs API-04 đang mô tả nó khác nhau (SPEC-11 §3.5, §23 mục 12) |
| **Picker** | `PAYROLL-API-034` (nhân sự) đi qua `PayrollPeopleRepository` — điểm chiếu danh tính DUY NHẤT, trường bó hẹp `{ userId, fullName, employeeCode?, orgUnitName? }` (SPEC-11 §18). `PAYROLL-API-035` (kỳ công) trả `{ id, periodMonth, status }`, gác `('manage','payroll-period')` |
| **Object-permission** | `view-own-payslip` / `acknowledge-own-payslip` khai **`objectGrantRequired = false`** tường minh (chốt của `0180`) — để mặc định thì nhân viên có company-grant vẫn **403 trên phiếu của chính mình** |
| **Tính lại giữ điều chỉnh tay** | `calculate` lại **UPSERT** dòng nháp và **GIỮ `adjustment_amount`/`adjustment_reason`**; dòng của nhân sự không còn đủ điều kiện thì xoá mềm. Xoá trắng là mất tiền người dùng nhập, im lặng (SPEC-11 §13.4) |
| **UUID biên** | mọi `{id}` qua pipe cấp method (không `@UsePipes` cấp class — `nestjs-zod-class-level-pipe-does-nothing`); ratchet param-uuid không tăng |
| **Hai tầng guard** | cặp quyền khai ở decorator route **và** service; census QA so **từng route theo MÃ cặp** ở cả hai tầng (bài học ASSET coverage 97.5% vẫn lọt) |
| **2FA** | role `payroll-officer` có `requires_two_factor = true` ⇒ mọi automation/script chạy bằng tài khoản mang role này **phải đi bước-2** (`prod-2fa-blocks-headless-automation`) |

### 5.1b **v2** — Ràng buộc buộc phải giữ khi hiện thực (v2)

Cùng khuôn §5.1: bảng dưới **không nhân bản rule nghiệp vụ**, chỉ khoá những điểm mà hiện thực dễ trượt và **trỏ về SPEC-11**.

| Chủ đề | Ràng buộc |
| --- | --- |
| **Ranh giới TS ↔ SQL** | PAY-DEC-012 chuyển **số học từng thành phần** lên TS (`decimal.js`, `ROUND_HALF_UP`, scale 2) — nhưng **BA thứ Ở LẠI SQL** (SPEC-11 §3.9): **clamp `net ≥ 0` (`GREATEST(…, 0)`)** · **mọi CHECK/UNIQUE** · **bất biến tổng** `SUM(payslip_items.amount) = gross − deduction + adjustment`. Đọc «v2 tính ở TS» thành «clamp ở JS được rồi» là mất chốt cuối mà **mọi ca test hiện có vẫn xanh**. `Number`/`parseFloat` **bị cấm** trên mọi giá trị tiền (`numeric` của `pg` về JS là **chuỗi** — vào thẳng `new Decimal(str)`). Ghi dòng vẫn **một câu `INSERT … ON CONFLICT` set-based**, bind mảng (`drizzle-array-bind-sql-param`) |
| **Máy công thức** | Grammar **ĐÓNG** (EBNF + 8 hàm, SPEC-11 §13.6 A) — hiện thực **đúng bằng**, không thêm hàm «cho tiện». **KHÔNG `eval`, KHÔNG `new Function`, không truy cập thuộc tính, không gọi hàm tuỳ ý** — parser recursive-descent tự viết → AST → evaluator đi trên AST. Đây là ràng buộc **kiến trúc** (một `Function(...)` ở đây là RCE trong vùng crown). Trần TĨNH lúc LƯU: 500 ký tự · sâu 20 · 200 node · 120 thành phần/mẫu (⇒ 018). Trần ĐỘNG lúc TÍNH: **25.000 lượt thăm node/dòng — NGÂN SÁCH TẤT ĐỊNH, KHÔNG timeout đồng hồ** (⇒ 020); timeout wall-clock giữ làm phòng thủ chiều sâu nhưng **không ca test nào assert nó** (`slow-probe-manufactures-timeout-red`). Kiểm vòng chạy ở **HAI thời điểm** (lưu **và** tính) và phủ **cả 4 nút tổng hợp** |
| **FSM 8 trạng thái** | SPEC-11 §13.1 (**bản v2 THAY bản v1**) ép qua **một hàm** `assertPeriodTransition`; vi phạm → **409 PAYROLL-ERR-001**. Hai đổi thay so với §5.1: (a) **`publish` đổi đích `Approved → Published`** (không còn `Approved → Paid`); (b) **`complete-batch` là đường DUY NHẤT vào `Paid`** — không có route riêng trên `payroll-periods`, đích đến là `POST /payroll/payment-batches/{payment_batch_id}/complete` (**072**, cặp `('manage','payment-batch')`), route đó **row-lock CẢ HAI hàng theo thứ tự kỳ TRƯỚC · đợt SAU** (thứ tự cố định là cách duy nhất chặn deadlock khi hai đợt cùng kỳ hoàn tất song song) rồi gọi **chính** `assertPeriodTransition` — **không** dựng hàm FSM thứ hai. `Published` **không mở lại được**; không đợt nào hoàn tất ⇒ **409 028**. Bảng RESET vết duyệt + 3 CHECK cặp (`status_check` 8 giá trị · `published_pair_check` thêm `Published` · `paid_pair_check` MỚI): SPEC-11 §13.1 |
| ⚠️ **Bộ lọc `/me/payslips` ĐỔI — bẫy im lặng nhất của wave** | `GET /me/payslips` (**031**) và `GET /me/payslips/{payslip_id}` (**032**) v1 lọc kỳ ∈ **`{Paid, Locked}`**; **v2 PHẢI lọc `{Published, Paid, Locked}`** (SPEC-11 §13.2). Giữ bộ lọc cũ = **nhân viên không thấy phiếu lương nào cho tới khi kế toán chi trả xong**, route trả **mảng rỗng 200** — không lỗi, không log (`empty-success-is-the-fail-open-shape`). **BA chỗ sửa CÙNG LƯỢT, không tách WO**: (a) bộ lọc 031/032 · (b) hàm dẫn xuất `Published` của DTO phiếu (§13.2) · (c) **PDF phiếu của mình `GET /me/payslips/{payslip_id}/pdf` (084) dùng CÙNG bộ lọc đó**. QA bắt buộc có ca kỳ ở **đúng `Published`** ⇒ nhân viên **thấy** · **xác nhận được** (033) · **tải PDF được** (084) — thiếu ca này thì cả ba chỗ cùng sai mà mọi ca hiện có vẫn xanh (chúng chạy trên kỳ `Paid`) |
| **NOTI-EVENT-023 đổi CHỖ PHÁT** | `PAYSLIP_PUBLISHED` giữ nguyên **mã · dedupe key · người nhận**, chỉ đổi chỗ gọi: v1 phát ở `Approved → Paid`; **v2 phát ở `publish` (`Approved → Published`, API-014)**, **KHÔNG** phát ở `complete-batch` (SPEC-11 §17.1). Bám theo tên trạng thái mà dời sang 072 = nhân viên chỉ được báo sau khi ngân hàng xong. QA ghim: `publish` ⇒ **có** outbox 023; `complete-batch` ⇒ **không** có 023 |
| **Masking tài khoản ngân hàng** | Khoá `bankAccountNumber` **không bao giờ** có mặt trong DTO — mặc định chỉ **`bankAccountLast4`** (**trường DẪN XUẤT do server tính, KHÔNG phải cột**). **Đường DUY NHẤT** để số đầy đủ rời server là **tệp UNC của `PAYROLL-API-071`**, gác `('manage','payment-batch')` + **audit bắt buộc** (payload audit = batch + số dòng, **không** số TK, **không** số tiền). `payroll_payment_lines.bank_account_snapshot` là cột thật (đóng băng lúc gửi ngân hàng) nhưng **vẫn mask khi đọc qua 070**. SPEC-11 §3.12 · §18.1 A |
| **`taxCode` vắng khoá** | `GET /payroll/employees/{user_id}` (**037**) chở `taxCode` **chỉ khi** caller giữ thêm `('view','salary-profile')` — thiếu thì **vắng khoá**, không `null`, không chuỗi rỗng; FE schema `.optional()` (`server-masking-needs-optional-fe-schema`). PAYROLL **đọc** `employee_profiles.tax_code`, **không sở hữu, không sao chép**. Họ tên/MST người phụ thuộc chỉ ra qua `('view','payroll-employee')` (040) |
| **Audit lượt ĐỌC — thêm 18 đường, tổng 25** | v1 có 7 (§5.1); v2 thêm **18** đường ghi `audit_logs` **trong cùng transaction** với lượt đọc (reveal + audit atomic; rollback ⇒ 0 audit): **036 · 037 · 038 · 040** (nhân sự + PII) · **043** (bảng công kỳ) · **059 · 061** (tạm ứng) · **066 · 068 · 070** (chi trả) · **073** (ngân sách) · **078 · 079 · 081** (tổng quan + báo cáo) · **071 · 082 · 083 · 085** (xuất tệp). **BỐN đường KHÔNG audit lượt đọc**: **065** (`/me/payroll-advances`) · **084** (PDF phiếu của mình) · **080** (danh mục báo cáo — metadata, không số liệu) · **054** (xem trước mẫu — dữ liệu giả do client gửi). Cùng luật `/me/payslips*` của v1: tự xem của mình không phải sự kiện an ninh, ghi thì đẻ nhiễu che mất lượt xem đáng ngờ thật. Bản đồ `object_type` audit **MỞ RỘNG 4 → 12** (danh sách vẫn ĐÓNG — SPEC-11 §12.1); `payroll_payment_lines`/`payroll_template_components`/`salary_profile_items` **KHÔNG** có `object_type` riêng, vết đi kèm đối tượng cha |
| **Báo cáo KHÔNG cache** | **078 · 079 · 081 KHÔNG cache** (PAY-DEC-018) — lý do **kỹ thuật**, không phải sở thích: **cache hit bỏ qua audit** (`widget-cache-hit-skips-audit-trail`) trong khi §18.1 B đòi audit **mỗi lượt**. Bật cache ở ba route này là **tự tay xoá vết** |
| **Sàn scope `Company` — HAI tầng** | **073** (ngân sách) · **078 · 079 · 081** (tổng quan/báo cáo) và hai widget mới `PAYROLL_BUDGET`/`PAYROLL_ADVANCE_PENDING` có **SÀN scope `Company`**: grant hẹp hơn **không được serve** (không phải «serve bản thu hẹp»). Ép ở **HAI tầng độc lập** — `DashboardWidgetRegistryService.filterByGatePair` (đường **METADATA** `/dashboard/me`) **và** handler dữ liệu (đường **DATA**); sàn đặt trong service PAYROLL **không** gác được đường metadata (`dash-widget-gate-needs-scope-floor`). Cặp gác cả hai widget là `is_sensitive = true` ⇒ FE dùng **`useCanExact`**, **không** `<PermissionGate>` (`sensitive-pair-widget-needs-usecanexact`) |
| **Engine luật định** | Tỉ lệ/trần/bậc thuế/giảm trừ **đọc từ `payroll_statutory_rates`**, bản hiệu lực **tại NGÀY CUỐI KỲ** — **không hard-code, không nội suy, không trộn hai bản trong một kỳ**; thiếu bản ⇒ **422 022**, kỳ **không** đổi trạng thái. Phần **doanh nghiệp** (`kind = 'statutory_employer'`: BHXH/BHYT/BHTN DN · KPCĐ) **phải tính và lưu** nhưng **KHÔNG vào `TONG_KHAU_TRU`, KHÔNG vào `gross`/`net`** — cộng nhầm làm lương nhân viên **tụt ~21,5%** mà mọi bất biến SQL vẫn xanh; chỉ **fixture đối soát tay** bắt được. Không tham gia BH/công đoàn ⇒ thành phần **bằng 0 nhưng VẪN ghi dòng** trong `component_values_json` (vắng mặt ≠ bằng 0). SPEC-11 §13.7 |
| **Gross-up NET** | Hồ sơ `salary_type = NET`: lặp điểm bất động, dừng khi sai số **≤ 1 đ**, trần **30 vòng**; **mỗi vòng chạy TOÀN BỘ đồ thị**; ngân sách node áp cho **TỔNG cả 30 vòng**, không phải mỗi vòng. Không hội tụ ⇒ **422 PAYROLL-ERR-021** và **TOÀN BỘ transaction rollback** — kỳ **không** đổi trạng thái, **không ghi dòng nào**, kể cả của người đã tính xong. `gross_up_iterations` ghi vào dòng lương (NULL khi `GROSS`). SPEC-11 §13.8 |
| **Mẫu bảng lương của kỳ** | Kỳ gắn **đúng một** mẫu; đổi mẫu chỉ khi kỳ ≤ `CollectingData` (⇒ **409 023**). **`calculate` trên kỳ chưa gắn mẫu ⇒ 409 023 `template-missing` — KHÔNG rơi ngầm về công thức cố định v1**: rơi ngầm nghĩa là cùng một nút «Tính» cho hai hệ số học khác nhau tuỳ dữ liệu cũ/mới. Kỳ v1 đã `≥ Calculated` **vẫn ĐỌC được nguyên vẹn** (dòng · phiếu · export · PDF); chỉ **tính lại** mới đòi mẫu. Dòng lương ghi `template_fingerprint` — màn chi tiết kỳ **phải** hiện băng «mẫu đã đổi kể từ lần tính gần nhất» khi fingerprint lệch. SPEC-11 §13.6 G/H |
| **`validate-formula` gác cặp GHI** | **048** không ghi gì nhưng vẫn gác `('manage','salary-component')` — nó **phơi ra chính bộ parser**; để cặp ĐỌC là mở bề mặt fuzz cho mọi người đọc được catalog. QA có **fuzz** trên parser (chuỗi ngẫu nhiên · ngoặc lồng sâu · số dài · unicode · null byte): **luôn 422 có mã, không bao giờ 500, không bao giờ treo** |
| **PDF sinh từ SNAPSHOT** | **083 · 084 · 085** sinh từ `payslip_items` đã đóng băng — **không tính lại**. **Font Việt phải NHÚNG** (`pdfmake` + `Be Vietnam Pro`/`Roboto`): rơi về font mặc định = phiếu lương **mất dấu tiếng Việt**, hỏng thầm lặng không lỗi nào báo; QA đối chiếu chuỗi có dấu trong PDF sinh ra. 085 chạy nền → **signed-URL ZIP**, > 2.000 phiếu ⇒ **422 031** |
| **Map lỗi DB MỚI → 409, không 500** | Ngoài `23505`/`23514` của v1, service v2 **phải bóc thêm** (mã nằm trong `error.cause` — `drizzle-wraps-pg-error-code-in-cause`): **`23P01` exclusion_violation** trên `payroll_dependents_no_overlap_excl` ⇒ **409 PAYROLL-ERR-032**; **`23505`** trên `payroll_payment_lines_batch_user_uq` ⇒ **409 027** `payee-already-in-batch`; **`23505`** trên `salary_components_code_uq` ⇒ **409 024** `component-code-exists`; **`23505`** trên UNIQUE `effective_from` của `payroll_statutory_rates` ⇒ **409 033** `rate-effective-date-exists` *(tên constraint chốt ở DB-13 §12–§14)*. Không map = **500 ở vùng đỏ** |
| **17 cặp sensitive — APPEND vào CẢ HAI danh sách backend** | 17 cặp v2 đều `is_sensitive = true` ⇒ **phải có mặt ở CẢ HAI** danh sách của BACKEND (`sensitive-capability-allowlist-is-backend`): **`SENSITIVE_CAPABILITY_ALLOWLIST`** (`permission.service.ts:43`, khối PAYROLL) **VÀ** **`SENSITIVE_SCREEN_GATE_PAIRS`** (`:246`, khối PAYROLL), khoá bởi `sensitive-screen-gate-allowlist.spec.ts` — **siết cùng commit**. Đo v1 = **13** mục mỗi bên ⇒ sau v2 = **30** mục mỗi bên. **APPEND vào cuối khối PAYROLL, KHÔNG rewrite khối** (hot-file, CLAUDE.md §9.3). Khai một bên quên bên kia = màn **ẩn với chính người được cấp quyền** (`capability-allowlist-hides-admin-screens`) |
| **Hai cặp KHÔNG gán `payroll-officer`** | `('manage','statutory-rate')` và `('manage','payroll-budget')` — officer **đọc** được cả hai (cần để tính và đối chiếu), chỉ **không ghi**. Ma trận seed v2 = **32 hàng `role_permissions` MỚI** (⇒ tổng 64) + **hai điều kiện verify tự-nhất-quán**: giữ `('manage','payroll-template')` ⇒ phải giữ `('view','salary-component')`; giữ `('approve','payroll-advance')` ⇒ phải giữ `('view','payroll-advance')` (chống **duyệt mù**). SPEC-11 §11.3 ghi chú 3 · 7 |
| **Four-eyes của tạm ứng** | `('approve','payroll-advance')` + service chặn **tự duyệt** (⇒ **409 025** `self-approval`) — cùng khuôn thưởng/phạt v1. Nút duyệt **ẩn với chính người tạo** ở FE thay vì hiện rồi 409 |
| **Import toàn-tệp-hoặc-không-dòng-nào** | **076** đổ vào `bonus_penalties` ở trạng thái **`Pending`** — **không tự duyệt**; sai khuôn cột / > **5.000 dòng** / có dòng không khớp nhân sự ⇒ **422 030** và **không import một phần**. Tệp mẫu **077 sinh từ chính khuôn mà 076 parse** — tệp mẫu tĩnh ở FE sẽ trôi khỏi parser |
| **NFR đổi hình** | Trần «500 nhân sự < 5s» **giữ nguyên**, nhưng điều cấm đổi: không còn cấm được «vòng lặp per-người» (evaluator **bắt buộc** chạy per-dòng) mà cấm **truy vấn per-người** — số **câu truy vấn** của một lượt `calculate` là **O(1) theo số nhân sự**. Ca QA **đếm CÂU SQL, không đếm builder** (`nplus1-test-must-count-queries-not-builders`). SPEC-11 §19.1 |
| **Dep mới** | `decimal.js` · Recharts · `pdfmake` — ADR ở **DECISIONS-14** (mở cùng wave); `pnpm audit` sạch, license MIT cả ba, và **cổng SCA của repo phải thấy chúng** (`sca-gate-blind-to-lms-and-fbpost`) |

### 5.2 Trạng thái hiện thực (đối chiếu code)

| Mã | Trạng thái | Ghi chú |
| --- | --- | --- |
| PAYROLL-API-001..006 · 019..028 · 034..035 | ✅ **Đã hiện thực** | `S13-PAYROLL-BE-1` (#456) — nền: hồ sơ lương · thưởng/phạt · FSM kỳ · gom đầu vào công/phép |
| PAYROLL-API-007..018 · 029..033 | ✅ **Đã hiện thực** | `S13-PAYROLL-BE-2` — máy tính lương (set-based SQL) · duyệt four-eyes · phiếu lương + breakdown · export XLSX · NOTI 020–023. **35/35 route** đã lên dây; census 2 tầng phủ đủ (`PAYROLL_PENDING_BE2` rỗng) |
| **PAYROLL-API-036..085** | ❌ **Chưa hiện thực** | **v2 (wave S15-PAYROLL-V2)** — 50 route mới khoá ở **§5b**: track A `S15-PAYROLL-BE-1` (036–043) · track B `S15-PAYROLL-BE-2` (044–058) · track C `S15-PAYROLL-BE-4` (059–077) · track D `S15-PAYROLL-BE-5` (078–085). Phụ thuộc `S15-PAYROLL-DB-1`/`DB-2` (11 bảng mới · ALTER 3 bảng — DB-1 lấy 2, DB-2 lấy 1 · mig **`0570+`**). **Bốn đường v1 phải SỬA cùng wave, không phải route mới**: 014 (`publish` đổi đích `Approved → Published`) · 031/032 (bộ lọc Own `{Published, Paid, Locked}`) · 033 (`acknowledge` theo bộ lọc mới) — §5.1b |

> Lệch giữa thiết kế và code ⇒ **sửa code**, không sửa ngầm tài liệu (CLAUDE.md — docs/spec + docs/DB là chuẩn).

---

## 6. Chuẩn response, lỗi, pagination, idempotency (theo API-01)

### 6.1 Envelope thành công — chi tiết kỳ lương (caller CHỈ có `('view','payroll-period')`)

```json
{
  "success": true,
  "message": "Lấy dữ liệu thành công",
  "data": {
    "id": "…",
    "periodMonth": "2026-09",
    "payDate": "2026-10-05",
    "status": "Reviewing",
    "attendancePeriod": { "id": "…", "periodMonth": "2026-09", "status": "locked" },
    "headcount": 42,
    "trail": {
      "createdBy": { "id": "…", "fullName": "Nguyễn Văn A" },
      "calculatedAt": "2026-10-01T02:10:00+07:00",
      "submittedBy": { "id": "…", "fullName": "Nguyễn Văn A" },
      "submittedAt": "2026-10-01T02:12:00+07:00",
      "approvedBy": null, "approvedAt": null,
      "publishedAt": null, "lockedAt": null
    }
  },
  "meta": { "request_id": "req_…", "timestamp": "2026-10-01T09:00:00+07:00" }
}
```

> **Không có khoá tiền nào** trong DTO này — kể cả `totalGross`. Tổng đi qua `GET /payroll-periods/summary` (gác bằng cặp ĐỌC nhạy cảm **`('view-line','payroll-period')`**).
>
> Cùng nguyên tắc, **ba route GHI `collect` (005) · `calculate` (007) · `adjust-line` (009) cũng KHÔNG chở khoá tiền nào** — trả `{ id, status, affectedLines, warnings[] }`; FE tải số qua `GET …/lines`. Để chúng trả `gross`/`net` là mở đường đọc tiền cho role chỉ có `calculate` mà không `view-line` (SPEC-11 §11.1).

### 6.2 Envelope list + pagination

Chuẩn API-01 (`data[]` + `pagination { page, per_page, total, total_pages, has_next, has_prev }`) cho `GET /payroll-periods` · `/payroll-periods/{id}/lines` · `/salary-profiles` · `/bonus-penalties` · `/payslips` · `/me/payslips`.

### 6.3 Chi phí lương kỳ (`GET /payroll-periods/summary`) — nguồn widget DASH

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "periodMonth": "2026-09",
    "status": "Paid",
    "headcount": 42,
    "totalGross": 512400000,
    "totalNet": 486180000
  },
  "meta": { "request_id": "req_…", "timestamp": "…" }
}
```

> Cặp gác `('view-line','payroll-period')` **+ SÀN scope `Company`** (`DASH_WIDGET_MIN_DATA_SCOPE`) — payload CHỨA SỐ TIỀN và cộng toàn công ty, nên grant hẹp hơn `Company` **không được serve** (`dash-widget-gate-needs-scope-floor`).
>
> ⚠️ **ĐẢO QUYẾT ĐỊNH 01/09/2026 (S13-PAYROLL-BE-2), thay cho ghi chú «số tiền trả về dạng chuỗi» ở bản trước.** `totalGross`/`totalNet` là **`number`**, không phải chuỗi. Lý do: cả module (dòng bảng lương · phiếu lương · `payslip_items`) đã trả `number`; riêng `summary` trả chuỗi thì FE phải mang **hai** cách đọc tiền trong cùng một màn. Rủi ro mất chính xác không tồn tại ở thang này: tổng VND một kỳ (~10¹²) còn cách `Number.MAX_SAFE_INTEGER` (~9×10¹⁵) bốn bậc. Lúc đảo chưa có consumer nào parse chuỗi (`S13-PAYROLL-FE-1` còn `todo`).
>
> Công ty **chưa có kỳ lương nào** ⇒ **200** với `data: null`, KHÔNG 404: widget DASH phải phân biệt được «chưa có kỳ» với «không có quyền».

### 6.4 Cảnh báo dữ liệu thiếu (`GET /payroll-periods/{id}/readiness`)

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "eligibleCount": 40,
    "warnings": [
      { "userId": "…", "fullName": "Trần Thị B", "kind": "missing-salary-profile" },
      { "userId": "…", "fullName": "Lê Văn C",  "kind": "missing-attendance" }
    ]
  },
  "meta": { "request_id": "req_…", "timestamp": "…" }
}
```

> Cảnh báo là **mềm** — không chặn `calculate` (PAYROLL-FUNC-005). Chỉ khi `eligibleCount = 0` thì `calculate` trả **422 PAYROLL-ERR-009**.

### 6.5 Envelope lỗi + mã lỗi

Namespace `PAYROLL-ERR-001..017` — định nghĩa đầy đủ ở SPEC-11 §12. `error.details` là **mảng** `ErrorDetail {field, message, rule}`; `details.kind` = phần tử `field:"kind"`. Vế hình thức (thiếu `reason`, `amount ≤ 0`, `periodMonth` sai định dạng, khoá lạ `.strict()`, `{id}` không UUID) chặn ở Zod ⇒ **400 `VALIDATION-ERR-001`**.

Ánh xạ HTTP:

| HTTP | Dùng cho |
| --- | --- |
| `400` | Body/param sai định dạng (`VALIDATION-ERR-001`) |
| `403` | Thiếu cặp quyền (`AUTH-ERR-FORBIDDEN`) — gồm cả officer gọi `approve` và `hr-manager` gọi mọi route PAYROLL sau thu hồi |
| `404` | PAYROLL-ERR-010 (sentinel not-found / ngoài scope — **một phản hồi duy nhất**, không 403) |
| `409` | PAYROLL-ERR-001..008 · 011 · 012 · 013 · 014 · 015 · mã idempotency chung `REQUEST-ERR-IDEMPOTENCY-*` |
| `422` | PAYROLL-ERR-009 (không có nhân sự đủ điều kiện) · 016 (export vượt trần 10.000 dòng) · **017 (không có người duyệt hợp lệ — chặn ở `submit`)** |

```json
{
  "success": false,
  "message": "Người duyệt phải khác người gửi duyệt",
  "error": {
    "code": "PAYROLL-ERR-005",
    "type": "ConflictException",
    "details": [
      { "field": "kind", "message": "same-actor-approval", "rule": "payroll-four-eyes" },
      { "field": "submittedBy", "message": "…", "rule": "payroll-four-eyes" }
    ]
  },
  "meta": { "request_id": "req_…", "timestamp": "…" }
}
```

> Thông điệp lỗi **không bao giờ chứa số tiền** — kể cả trong `details`.

#### 6.5b **v2** — `PAYROLL-ERR-018..033` (16 mã mới, SPEC-11 §12.1)

Namespace sau v2: **`PAYROLL-ERR-001..033`** (17 mã v1 + 16 mã v2). Định nghĩa đầy đủ ở **SPEC-11 §12.1** — bảng dưới chỉ khoá **HTTP + `kind`** để backend/FE/QA khớp hợp đồng lỗi.

| Mã | HTTP | `kind` | Dùng cho |
| --- | --- | --- | --- |
| PAYROLL-ERR-018 | `422` | `formula-syntax` · `formula-unknown-ref` · `formula-unknown-function` · `formula-too-long` · `formula-too-deep` · `formula-too-many-nodes` | **Công thức không hợp lệ lúc LƯU** (045 · 047 · 048 · 053); `details[]` nêu **vị trí ký tự** và token gây lỗi |
| PAYROLL-ERR-019 | `422` | `formula-cycle` | **Vòng phụ thuộc** giữa các thành phần; thông điệp nêu **chu trình đầy đủ** theo mã (`A → B → C → A`), không chỉ nói «có vòng» |
| PAYROLL-ERR-020 | `422` | `formula-budget-exceeded` · `division-by-zero` · `numeric-overflow` | **Vỡ lúc TÍNH** (007 sau v2): vượt ngân sách node · chia cho 0 · tràn `numeric(18,2)`. Kỳ **không** đổi trạng thái |
| PAYROLL-ERR-021 | `422` | `grossup-not-converged` | **Gross-up NET không hội tụ** sau 30 vòng; `details[]` nêu `userId` + sai số còn lại. **Rollback TOÀN BỘ tx — không ghi dòng nào** |
| PAYROLL-ERR-022 | `422` | `statutory-rate-missing` · `statutory-rate-incomplete` | Thiếu **bản tỉ lệ luật định hiệu lực** tại ngày cuối kỳ (007) · bản thiếu bậc thuế/trần bắt buộc, **7 bậc không liên tục** (khoảng hở/chồng) lúc lưu (056) |
| PAYROLL-ERR-023 | `409` | `template-locked` · `template-missing` · `template-inactive` | **Mẫu bảng lương của kỳ**: đổi mẫu khi kỳ > `CollectingData` · `calculate` khi kỳ chưa gắn mẫu · mẫu đã ngưng dùng |
| PAYROLL-ERR-024 | `409` | `system-component-immutable` · `component-in-use` · `component-code-exists` · `component-code-reserved` | **Thành phần lương**: xoá thành phần hệ thống · xoá/ngưng thành phần đang được mẫu tham chiếu (`details[]` liệt kê mẫu) · trùng `code` (chốt cuối UNIQUE) · `code` đụng không gian tên hệ thống (tiền tố `SYS_`/trùng mã seed) |
| PAYROLL-ERR-025 | `409` | `advance-not-pending` · `advance-already-deducted` · `self-approval` | **Tạm ứng** FSM (062 · 063 · 064) |
| PAYROLL-ERR-026 | `409` | `advance-period-frozen` | Gắn tạm ứng vào **kỳ đã ≥ `Calculated`** (060) — khoản khấu trừ phải có mặt **trước** khi tính |
| PAYROLL-ERR-027 | `409` | `period-not-published` · `batch-incomplete` · `batch-already-completed` · `payee-already-in-batch` | **Đợt chi trả** (067 · 069 · 072); `payee-already-in-batch` là chốt cuối UNIQUE, race map 409 |
| PAYROLL-ERR-028 | `409` | `no-completed-batch` | Đưa kỳ sang `Paid` khi **không có đợt chi trả nào hoàn tất** — chặn đường đi tắt bỏ qua bước chi trả thật (PAY-DEC-017) |
| PAYROLL-ERR-029 | `409` | `budget-exists` | **Ngân sách lương** trùng `(năm, đơn vị)` (074) — chốt cuối UNIQUE, race map 409 |
| PAYROLL-ERR-030 | `422` | `import-invalid` · `import-too-large` · `import-unknown-user` | **Import thu nhập/khấu trừ khác** (076): sai khuôn cột · > **5.000 dòng** · dòng không khớp nhân sự. **Toàn tệp hoặc không dòng nào** |
| PAYROLL-ERR-031 | `422` | `report-too-large` · `pdf-batch-too-large` | **Vượt trần**: báo cáo > **50.000 dòng** (081/082) · PDF hàng loạt > **2.000 phiếu** (085) |
| PAYROLL-ERR-032 | `409` | `dependent-overlap` | **Người phụ thuộc** chồng lấp khoảng hiệu lực cho cùng một NPT (041 · 042) — chốt cuối `EXCLUDE USING gist`, race map 409 **không 500** |
| PAYROLL-ERR-033 | `409` | `rate-effective-date-exists` · `rate-in-use` | **Bản tỉ lệ luật định — xung đột**: trùng `effective_from` (056 — chốt cuối UNIQUE, race map 409) · sửa bản **đã có kỳ lương dùng** (058) ⇒ phải **tạo bản mới**, không sửa tại chỗ (đổi số của bản đã áp là đổi tiền của kỳ đã tính) |

**Ánh xạ HTTP bổ sung (v2)** — cộng vào bảng §6.5:

| HTTP | Dùng thêm cho |
| --- | --- |
| `409` | PAYROLL-ERR-023 · 024 · 025 · 026 · 027 · 028 · 029 · **032** · **033** |
| `422` | PAYROLL-ERR-018 · 019 · 020 · 021 · 022 · 030 · 031 |

> **Ba mã 018/019/020 chia theo THỜI ĐIỂM, không theo nội dung** — 018/019 phát lúc **LƯU** (người dùng sửa được ngay, `details[]` chỉ vào ký tự); **020 phát lúc TÍNH** (công thức đã qua kiểm mà vẫn vỡ trên dữ liệu thật). Gộp làm một mã thì FE không biết nên mở **editor công thức** hay mở **dòng lương**.
>
> **Trần đánh giá là NGÂN SÁCH TẤT ĐỊNH (lượt thăm node), KHÔNG phải timeout đồng hồ** ⇒ ca test tái lập 100%. Timeout wall-clock giữ làm phòng thủ chiều sâu nhưng **không** là cổng có ca test đo (`slow-probe-manufactures-timeout-red`).
>
> **Vi phạm CHECK/UNIQUE/EXCLUDE mới → 409 đúng mã, KHÔNG 500** — bóc từ `error.cause` (§5.1b «Map lỗi DB MỚI»): `23P01` ⇒ **032** · `23505` trên `payroll_payment_lines_batch_user_uq` ⇒ **027** · `23505` trên `salary_components_code_uq` ⇒ **024**.
>
> **Hai bề mặt của bảng tỉ lệ luật định tách theo HTTP, đừng gộp:** **422 022** = *nội dung bản sai* (thiếu bậc/trần, 7 bậc không liên tục) — người dùng sửa được ngay trong form; **409 033** = *xung đột với dữ liệu đã có* (trùng `effective_from`, hoặc bản đã được một kỳ dùng ⇒ tạo bản mới). Cùng lớp phân tách «lúc LƯU vs lúc TÍNH» của 018/019 ↔ 020.
>
> Vế **hình thức** (thiếu `reason`/`note`, `amount ≤ 0`, `effectiveFrom`/`periodMonth` sai định dạng, khoá lạ `.strict()`, `{id}` không UUID) vẫn chặn ở Zod ⇒ **400 `VALIDATION-ERR-001`**, không chiếm mã PAYROLL. Thông điệp lỗi **không bao giờ chứa số tiền** — áp cho cả 16 mã mới.

### 6.6 Idempotency

`POST /payroll-periods` · `POST /salary-profiles` · `POST /bonus-penalties` · `POST /payroll-periods/{id}/calculate` · `POST /payroll-periods/{id}/generate-payslips` gắn `@Idempotent()` (interceptor dùng chung, BACKEND-12 §14.1): key **client sinh khi mở form / bấm nút**, khoá scope `company_id + user_id + method + path + key`, TTL 15′ (`IDEMPOTENCY_TTL_SEC = 900`), header không bắt buộc ở interceptor (back-compat), replay phát lại envelope nguyên trạng + `Idempotency-Replayed: true`. FE PAYROLL **luôn** gửi header.

Chống trùng **nghiệp vụ** là việc của UNIQUE ở DB, không phải idempotency: kỳ trùng tháng (`payroll_periods_company_month_uq` → 008) · phiếu sinh hai lần (`payslips_period_user_uq` → 006) · phiên bản lương trùng ngày (`salary_profiles_company_user_effective_uq` → 014) · xác nhận hai lần (`payslip_acknowledgements_payslip_user_uq` → 015). **Server KHÔNG tự suy khoá idempotency từ payload** (`period-key-idempotency-needs-frozen-source`).

---

## 7. Dữ liệu PAYROLL (SPEC-11 §16, DB-13)

- PAYROLL **không tạo lại**: `users`, `employee_profiles`, `attendance_periods`/`attendance_records`, `leave_requests`/`leave_types`, `companies.payroll_config_json`, `audit_logs`, `notification_*`.
- Bảng canonical do PAYROLL sở hữu: `salary_profiles` · `payroll_periods` · **`payroll_period_lines` (MỚI)** · `payslips` · `payslip_items` · `bonus_penalties` · `payslip_acknowledgements`. RLS+FORCE mọi bảng; **`payslips`/`payslip_items`/`payslip_acknowledgements` append-only**; không bảng nào có DELETE cho app role. Chi tiết cột + **bản đồ reconcile 6 bảng di sản**: DB-13 §5/§6; index: DB-09 §8.19; seed + thu hồi quyền: DB-10.

> **v2 (SPEC-11 §5.1b · §8.2, DB-13 §12–§14):** v2 thêm **11 bảng mới** + **ALTER 3 bảng** (**DB-1 lấy 2**: `salary_profiles` · `payroll_period_lines`; **DB-2 lấy 1**: `payroll_periods` — cùng chuỗi 4 bước `Paid → Published`) ⇒ **tổng 18 bảng** PAYROLL. Bảng mới (DB-1: `salary_profile_items` · `payroll_employee_settings` · `payroll_dependents` · `salary_components` · `payroll_templates` · `payroll_template_components` · `payroll_statutory_rates`; DB-2: `payroll_advances` · `payroll_payment_batches` · `payroll_payment_lines` · `payroll_budgets`) — **RLS + FORCE + composite tenant FK cho cả 11**, policy tạo **TRƯỚC** mọi INSERT; **không bảng mới nào có `GRANT DELETE`**; `mediaos_worker` **vẫn KHÔNG được `SELECT`** trên `salary_profile_items` · `payroll_advances` · `payroll_payment_lines`. Chi tiết cột/enum/index/seed: **DB-13 §12–§14**; migration **`0570+`** (đọc journal lúc chạy, lấy `idx = max + 1`).

---

## 8. Trạng thái tài liệu & việc còn nợ

| Hạng mục | Trạng thái |
| --- | --- |
| Tên file + prefix + danh sách endpoint §5 + cặp quyền | ✅ Khoá ở stub này |
| Nguyên tắc bắt buộc (FSM/four-eyes/chốt-cuối/masking/audit-lượt-đọc/idempotency) | ✅ Ghi rõ (§5.1) |
| Cross-link SPEC-11 / DB-13 / DB-09 / DB-10 / §9g / API-01 / API-04 | ✅ |
| DTO request/response chi tiết + **viết lại** `packages/contracts/src/payroll.ts` | ⏳ `S13-PAYROLL-DB-1` (enum/mirror CHECK) → `BE-1`/`BE-2` (DTO đầy đủ) |
| Đối chiếu endpoint đã ship vs thiết kế (§5.2) | ⏳ cập nhật khi `S13-PAYROLL-BE-2` đóng |
| OpenAPI/Swagger nhóm PAYROLL (`API_MODULE_TAGS`) | ⏳ `S13-PAYROLL-BE-1` |
| Flip Stub → Approved | ✅ owner duyệt gói wave 31/08/2026 (đồng bộ SPEC-11 §1 + DB-13 §1) |
| **v2 — 50 endpoint `036..085` + nhóm API 4 track + ràng buộc hiện thực** | ✅ Khoá ở **§4.1b · §5b · §5.1b** (`S15-PAYROLL-DOC-1`, 11/09/2026) |
| **v2 — «không bao gồm» viết lại theo PARK-PAYROLL-002** | ✅ **§4.2** (v2 đã lấy lại engine BH/TNCN · PDF + export batch · report phòng ban/variance) |
| **v2 — 16 mã lỗi `PAYROLL-ERR-018..033`** | ✅ **§6.5b** (HTTP + `kind` khớp SPEC-11 §12.1; **033** = xung đột bản tỉ lệ luật định, 409) |
| **v2 — DTO/schema + `packages/contracts/src/payroll.ts` mirror HAI CHIỀU** (`payrollPeriodStatusEnum` **7 → 8**) | ⏳ `S15-PAYROLL-DB-1` (enum/CHECK) → `BE-1..5` (DTO đầy đủ) |
| **v2 — OpenAPI nhóm PAYROLL mở rộng 85 route + route-census 85** | ⏳ `S15-PAYROLL-BE-1..5`; **siết `MIN_COVERED_COUNT` cùng commit mỗi WO** |
| **v2 — APPEND 17 cặp vào CẢ HAI danh sách** `SENSITIVE_CAPABILITY_ALLOWLIST` + `SENSITIVE_SCREEN_GATE_PAIRS` (13 → **30** mỗi bên) | ⏳ `S15-PAYROLL-BE-1..5` (§5.1b) |
| **v2 — SỬA 4 đường v1** (014 đích `Published` · 031/032/033 bộ lọc `{Published, Paid, Locked}` + 084 dùng cùng bộ lọc) | ⏳ `S15-PAYROLL-BE-4`/`BE-5` — **bẫy im lặng nhất của wave** (§5.1b) |
| **v2 — map `23P01`/`23505` mới → 409 đúng mã** (032 · 027 · 024) | ⏳ `S15-PAYROLL-BE-1..4` |
| **v2 — ADR `DECISIONS-14`** (`decimal.js` · Recharts · `pdfmake`) | ⏳ WO doc của wave S15 (SPEC-11 §23.2 mục 12) |

---

## 9. Liên quan

- **Đặc tả nghiệp vụ (nguồn sự thật):** [SPEC-11 PAYROLL](<../SPEC/SPEC-11 PAYROLL.md>) — §11 permission (+ §11.2 bản đồ 19 cặp di sản), §12 mã lỗi, §13 FSM/máy tính lương/scope, §15 API, §17 sự kiện, §18 audit/masking, §22 quyết định.
  - **v2 (wave S15-PAYROLL-V2, PAY-DEC-011..020):** **§15.1** bảng 50 route `036..085` (**nguồn của §5b**) · **§5.1b** con số ĐÓNG (11 bảng · **11 màn** · 50 route · **16 mã lỗi** · 17 cặp · 4 event · 2 widget · 8 trạng thái) · **§5.2b** PARK-PAYROLL-002 (**nguồn của §4.2**) · **§3.9** ranh giới TS↔SQL · §3.10–§3.12 thành phần-là-dữ-liệu / luật-định-là-dữ-liệu / PII mới · **§9.1** `PAY-SCREEN-007..017` · §10.1b hai widget mới · §10.2 `PAYROLL-FUNC-015..030` · **§11.3** 17 cặp mới · **§12.1** mã lỗi **018..033** (**nguồn của §6.5b**) · **§13.1 FSM 8 trạng thái (THAY v1)** · **§13.2 bộ lọc Own (THAY v1)** · **§15 hàng 014 · 031 · 032 · 033 (🔁 đã sửa TẠI CHỖ)** · §13.6 máy công thức · §13.7 engine luật định · §13.8 gross-up · **§17.1** NOTI-EVENT-024..027 (+ 023 đổi điều kiện phát) · §18.1 audit & masking v2 · §19.1 NFR · §21.1 test scenario · §23.2 tác động tài liệu.
- **Chuẩn API:** [API-01 Tổng quan](<API-01 TỔNG QUAN.md>).
- **Thiết kế DB:** [DB-13 PAYROLL Database Design](<../DB/DB-13 PAYROLL Database Design.md>) (§5 bản đồ reconcile · **§12–§14 bản v2**: ALTER 3 bảng (2 ở DB-1 · 1 ở DB-2) · 11 bảng mới · enum v2 · RLS/GRANT · migration `0570+` · seed catalog/tỉ lệ/mẫu mặc định) · [DB-09 §8.19](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 seed PAYROLL](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>).
- **Phân quyền:** [Ma trận phân quyền §9g](<../permission-matrix-spec.md>) (+ **§9g.2** — 17 cặp v2, ma trận seed **+32 hàng ⇒ 64**, hai điều kiện verify mới).
- **Module nối:** [API-04 ATT](<API-04_ATT_API_Design.md>) (kỳ công `locked` là điều kiện của `calculate`) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) (`leave_types.paid`) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-11 ME](<API-11_ME_API_Design.md>).
- **Chỉ mục:** [README §4](<../README.md>).
