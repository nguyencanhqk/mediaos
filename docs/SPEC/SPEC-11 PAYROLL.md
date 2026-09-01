# SPEC-11: PAYROLL — TIỀN LƯƠNG (HỒ SƠ LƯƠNG · THƯỞNG/PHẠT · KỲ LƯƠNG · TÍNH LƯƠNG · DUYỆT · PHIẾU LƯƠNG)

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · [SPEC-03 HR](<SPEC-03 HR.md>) · [SPEC-04 ATT](<SPEC-04 ATT.md>) · [SPEC-05 LEAVE](<SPEC-05 LEAVE.md>) · [SPEC-06 TASK](<SPEC-06 TASK.md>) · [SPEC-07 DASH](<SPEC-07 DASH.md>) · [SPEC-08 NOTI](<SPEC-08 NOTI.md>) · [SPEC-09 ME](<SPEC-09 ME.md>) · [SPEC-10 GOAL](<SPEC-10 GOAL.md>) · **SPEC-11 PAYROLL** · [SPEC-12 RECRUIT](<SPEC-12 RECRUIT.md>) · [SPEC-13 ASSET](<SPEC-13 ASSET.md>) · [SPEC-14 ROOM](<SPEC-14 ROOM.md>) · [SPEC-15 CHAT](<SPEC-15 CHAT.md>)
>
> **Liên quan:** [Chỉ mục tài liệu](<../README.md>) · [DB-13 PAYROLL Database Design](<../DB/DB-13 PAYROLL Database Design.md>) · [Thiết kế API: API-18 PAYROLL](<../API Design/API-18_PAYROLL_API_Design.md>) · [Ma trận phân quyền §9g](<../permission-matrix-spec.md>) · [HR nền: SPEC-03](<SPEC-03 HR.md>) · [ATT nền: SPEC-04](<SPEC-04 ATT.md>) · [LEAVE nền: SPEC-05](<SPEC-05 LEAVE.md>) · [NOTI nền: SPEC-08](<SPEC-08 NOTI.md>) · [Kế hoạch wave: S13-PAYROLL](<../plans/S13-PAYROLL-WAVE.md>)
>
> **Đánh số (PAY-DEC-001):** PAYROLL giữ đúng số **SPEC-11** đã khoá tại [SPEC-01 §7.2/§8](<SPEC-01 Tổng quan.md>). Tài liệu DB lấy **DB-13** (đúng chỗ IMPLEMENTATION-10 §13.2 giữ — ASSET/ROOM đã né sang DB-15/16, RECRUIT lấy DB-14). Tài liệu API lấy **API-18** vì **API-13 vốn dự định cho PAYROLL đã bị CHAT chiếm**, API-14/15 = ASSET/ROOM, API-16 = Permission Audit Report, API-17 = RECRUIT.

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | SPEC-11 |
| Tên tài liệu | PAYROLL - Tiền lương |
| Module code | PAYROLL |
| Tài liệu cha | SPEC-01: Tổng quan hệ thống (§12.8) |
| Module phụ thuộc trực tiếp | AUTH (RBAC per-pair + data scope), HR (`employee_profiles` · `users` · hồ sơ lương), ATT (`attendance_periods` khoá kỳ công + `attendance_records`), LEAVE (`leave_types.paid` · đơn nghỉ đã duyệt), FOUNDATION (audit · `@Idempotent()` · settings `payroll_config_json`) |
| Module liên quan | NOTI (gửi duyệt · duyệt/từ chối · phát hành phiếu lương), DASH (widget «chi phí lương kỳ»), ME (màn «Phiếu lương của tôi») |
| Phiên bản | v1.0 |
| Trạng thái | **Approved** — owner duyệt nguyên gói hồ sơ wave S13-PAYROLL ngày **31/08/2026**, ký PAY-DEC-001..010 (§22) |
| Giai đoạn | **Phase 2 «HR nâng cao» · wave S13-PAYROLL** — hậu go-live |
| Ngày tạo | 31/08/2026 |
| Ngày cập nhật | 31/08/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả module **PAYROLL — Tiền lương**: nơi công ty quản lý **hồ sơ lương của từng nhân sự** → **thưởng/phạt/khấu trừ nhập tay theo kỳ** → **kỳ lương tháng** → **gom đầu vào công/phép** → **tính bảng lương nháp** → **review + điều chỉnh + duyệt** → **phát hành phiếu lương cho nhân viên** → **khoá kỳ**.

PAYROLL trả lời các câu hỏi:

```text
Nhân sự A đang hưởng lương cơ bản + phụ cấp nào, từ ngày nào, đã đổi mấy lần?
Kỳ lương tháng 09/2026 đang ở bước nào, ai tính, ai duyệt, đã phát hành chưa?
Ai còn thiếu hồ sơ lương / thiếu bảng công nên chưa tính được?
Lương của người B kỳ này ra con số đó bằng cách nào — từng khoản cộng trừ là gì?
Kỳ này công ty chi bao nhiêu lương gross/net, cho bao nhiêu người?
Phiếu lương của tôi kỳ vừa rồi thế nào, tôi đã xác nhận chưa?
```

PAYROLL **không sở hữu** dữ liệu của module khác: nhân sự thuộc HR, ngày công thuộc ATT, ngày nghỉ thuộc LEAVE, tài khoản thuộc AUTH. PAYROLL chỉ sở hữu **hồ sơ lương · thưởng/phạt · kỳ lương · dòng lương nháp · phiếu lương + dòng phiếu · xác nhận phiếu**.

**PAYROLL là vùng crown-jewel ngay từ dòng code đầu** — lương là dữ liệu nhạy cảm nhất của hệ thống (SPEC-01 §11.3, RELEASE-14 §5). Mọi WO của track áp `CLAUDE.md` §6 FULL gate + deny-path test TRƯỚC.

---

## 3. Định nghĩa và nguyên tắc kiến trúc

### 3.1 PAYROLL là RECONCILE, không phải nền trắng — PAY-DEC-002

Khác RECRUIT/ASSET (nền sạch), tầng DB của PAYROLL **đã tồn tại thật** từ đợt G12 hướng cũ (migration `0091`–`0132`, band bất khả xâm phạm): 6 bảng `salary_profiles` · `payroll_periods` · `payslips` · `payslip_items` · `bonus_penalties` · `payslip_acknowledgements`, đủ RLS ENABLE+FORCE + policy tenant, `payslips`/`payslip_items` đã đúng khuôn append-only. Nhưng **0 route, 0 thư mục `apps/api/src/payroll/`, 0 dòng `app.module.ts`**.

Wave này **giữ khung, không drop-rebuild**: DB-13 viết chuẩn trước rồi đối chiếu từng bảng; lệch → ALTER bằng migration MỚI (`0564+`). Cột/CHECK không phù hợp thiết kế v1 (KPI · đa loại lương · đa chu kỳ trả · đa tiền tệ · chuỗi adjustment/void · khiếu nại) được **GỠ theo DB-13, không nối dây** — cột ghi-rồi-bỏ là nợ, không phải tính năng. Bản đồ reconcile từng bảng: **DB-13 §5**.

### 3.2 Hồ sơ lương versioned là nguồn DUY NHẤT cho tính lương — PAY-DEC-003

`salary_profiles` giữ **nhiều phiên bản theo `effective_date`** cho mỗi nhân sự; phiên bản **hiệu lực tại một ngày** = bản có `effective_date ≤ ngày đó` mới nhất. Máy tính lương chỉ đọc bảng này.

`employee_profiles.base_salary` (HR) **không tham gia tính lương** — nó giữ vai trò hiển thị trong hồ sơ nhân sự với masking hiện hành (`hr-read.service` reveal + audit atomic), và được ghi chú **deprecate ở Phase sau**. Hai nguồn số lương tồn tại song song là rủi ro đã nhận diện (§21, DB-13 §11) — v1 chốt bằng luật "chỉ `salary_profiles` chảy vào payslip", QA có ca đối chứng.

### 3.3 Tiền tính ở SQL, VND duy nhất, breakdown giải-thích-được — PAY-DEC-004

- **Công thức v1**: `gross = lương cơ bản pro-rate + phụ cấp + thưởng` · `khấu trừ = ngày nghỉ không lương + trễ/sớm (nếu bật rule ATT) + phạt + dòng điều chỉnh tay` · `net = GREATEST(gross − khấu trừ, 0)`.
- **KHÔNG engine BHXH/BHYT/BHTN/TNCN luỹ tiến** ở v1 → **PARK-PAYROLL-001** (RELEASE-14 §5).
- **VND duy nhất**, `numeric(18,2)`; **phép cộng/trừ, pro-rate, làm tròn và clamp làm ở SQL** — cấm số thực JS (`clamp-must-be-sql-not-js`). Fixture QA đối soát tay khớp **từng đồng**.
- Mọi con số trên phiếu lương giải thích được bằng **dòng chi tiết** (`payslip_items`): mỗi khoản một dòng có nhãn + số tiền + loại.

### 3.4 Snapshot ĐÓNG BĂNG lúc tính, phiếu lương bất biến sau phát hành — PAY-DEC-005/008

Bảng lương có **hai tầng dữ liệu tách bạch**:

```text
payroll_period_lines   — BẢNG LƯƠNG NHÁP (mutable trước Approved): tính lại, điều chỉnh dòng có lý do
payslips + payslip_items — PHIẾU LƯƠNG (append-only): sinh MỘT LẦN lúc generate, KHÔNG bao giờ sửa
```

Tách hai tầng là **bắt buộc kỹ thuật** để giữ đồng thời hai yêu cầu đã ký: `payslips` phải giữ khuôn append-only (PAY-DEC-002) **và** bảng lương phải tính lại được trước khi duyệt (PAY-DEC-005). Nếu dùng chính `payslips` làm bản nháp thì mỗi lần tính lại phải sửa/xoá hàng của một bảng chỉ-INSERT — phá bất biến #2.

Mỗi lần `calculate`, dòng nháp ghi kèm **`input_snapshot_json`** — ảnh chụp đầu vào (số công, phép có lương/không lương, phút trễ, id phiên bản hồ sơ lương, hệ số pro-rate). Từ đó con số **không trôi** khi ATT/LEAVE đổi sau lúc tính; muốn cập nhật phải `calculate` lại (chỉ được khi kỳ **chưa** `Approved`).

**Sai sót phát hiện SAU khi phát hành không sửa phiếu cũ** — xử lý bằng thưởng/phạt điều chỉnh ở **kỳ SAU** (truy lĩnh/truy thu), đúng thông lệ tiền lương. Vì vậy v1 **không có** chuỗi `adjustment`/`void` trên `payslips` (DB-13 §5.3).

### 3.5 Kỳ lương có 7 trạng thái, gắn khoá kỳ công ATT — PAY-DEC-005

Kỳ **tháng** (`period_month` `YYYY-MM`), mốc cắt/ngày trả đọc từ `companies.payroll_config_json` (`cutoffDay` 25 / `payDay` 5 — đã sống ở màn Cài đặt). FSM 7 trạng thái (P2-PAY-03-002) hợp thức tại **SPEC-01 §17.15**; chuyển tiếp hợp lệ ở §13.1 — **service ép FSM, DB chỉ CHECK tập giá trị** (`check-cannot-enforce-fsm-transitions`).

Ràng buộc cứng nối sang ATT — **và sự thật đo được 31/08/2026 về vế "khoá ngược"**:

1. **`calculate` đòi `attendance_periods` của tháng đó ở trạng thái `locked`** — không tính lương trên bảng công còn mở (PAYROLL-ERR-002).
2. PAY-DEC-005 chốt «kỳ lương `Locked` khoá luôn chỉnh công phía ATT». **Đo code thật: yêu cầu này ĐÃ ĐƯỢC THOẢ SẴN, PAYROLL không dựng cổng thứ hai.** Vì (a) `calculate` chỉ chạy khi kỳ công đã `locked`, và (b) `attendance_periods` **không có đường `locked → open`** — trigger `0064` chặn vĩnh viễn (`attendance-period-lock.int-spec.ts`), còn `attendance-adjustment.service.ts` từ chối mọi điều chỉnh trên kỳ đã khoá. ⇒ từ thời điểm tính lương trở đi, bảng công tháng đó **đã bất biến**; kỳ lương `Locked` không thêm được ràng buộc nào.
   - ⚠️ **Không viện dẫn `ATT-ERR-024`.** Mã đó **không tồn tại trong `apps/api/**`** (đường từ chối thật ném `ConflictException` không kèm mã), và hai tài liệu ATT đang mô tả nó khác nhau: [SPEC-04 §mã lỗi](<SPEC-04 ATT.md>) = «Kỳ công đã khóa» còn [API-04 §mã lỗi](<../API Design/API-04_ATT_API_Design.md>) = «Không xác định được người duyệt phù hợp». Đây là **nợ tài liệu của ATT**, ghi ở §23 mục 12 — PAYROLL **không** cấp mã mới và **không** sửa hợp đồng lỗi của module khác ở wave này.
   - **Hệ quả vận hành đã chấp nhận (rủi ro có thật):** vì kỳ công không mở lại được, sai sót **chấm công** phát hiện lúc review bảng lương **không sửa được ở nguồn**. Đường vá duy nhất trong v1 là **điều chỉnh dòng có lý do** (`PAYROLL-API-009`) hoặc **thưởng/phạt** ở kỳ này/kỳ sau — cả hai đều để lại vết. Nêu rõ ở §21 và trên màn PAY-SCREEN-002.

### 3.6 Duyệt một cấp, four-eyes — PAY-DEC-007

Người **tính/gửi duyệt** và người **duyệt** phải là hai người khác nhau: cặp `('approve','payroll-period')` gán **company-admin**, **KHÔNG** gán `payroll-officer`. Ràng buộc so sánh `submitted_by ≠ approved_by` ép ở **service** và có **CHECK chốt cuối ở DB** (DB-13 §5.2). Reject **bắt buộc comment**. Approve · reject · publish · lock · reopen đều ghi audit + phát NOTI.

### 3.7 Lương che ở SERVER, mọi lượt xem để lại vết — PAY-DEC-006

Quyền lương là **nhóm cặp độc lập**, KHÔNG mặc định cho HR (DECISIONS-01 Phương án B — Block-code). Người không giữ cặp lương **không nhận được số tiền từ server**, không phải "nhận rồi ẩn ở FE" (masking là việc của SERVER — client không nhận được thì không render được). Mọi đường đọc số lương của người khác (chi tiết phiếu, dòng bảng lương, export) ghi `audit_logs` theo khuôn **reveal + audit atomic** của HR (§18).

### 3.8 Không sao chép dữ liệu nguồn

Tên nhân sự/phòng ban/kỳ công luôn **JOIN** lúc đọc qua **một** điểm chiếu danh tính duy nhất (§18), không denormalize. Hai ảnh chụp có chủ đích là **`input_snapshot_json`** (đầu vào lúc tính) và **`payslips` + `payslip_items`** (bản phát hành) — vì cả hai phải cố định, không trôi theo hiện tại.

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

- Một nguồn sự thật về tiền lương: **ai hưởng bao nhiêu · kỳ nào đang ở đâu · con số ra bằng cách nào · ai duyệt**.
- Nhân viên tự xem phiếu lương của mình và xác nhận, không phải hỏi HR.
- Số lương chỉ tới đúng người có quyền, và mọi lượt xem/xuất đều có dấu vết.

### 4.2 Mục tiêu kỹ thuật

- Tái dùng tối đa nền đã có: RBAC per-pair + data_scope, `withTenant` + RLS, audit, outbox NOTI, `@Idempotent()`, khuôn reveal+audit của HR, `attendance_periods` của ATT.
- **Tiền tính ở SQL** (`numeric(18,2)`, làm tròn + clamp ở SQL), snapshot đóng băng, khoá theo kỳ chống trả hai lần.
- FSM ép ở **service**, chốt cuối ở **DB** (UNIQUE/partial unique/CHECK cặp); chuyển tiếp sai trả **4xx đúng mã `PAYROLL-ERR`**, không 500.
- Mọi `:id` là UUID ở biên; guard cặp quyền ở **hai tầng** (decorator route + service).

---

## 5. Phạm vi module

### 5.1 Trong v1 (wave S13-PAYROLL — SPEC-01 §12.8, IMP-10 §10.1 P0/P1)

| # | Hạng mục | Story (wave §4) |
| --- | --- | --- |
| 1 | **Hồ sơ lương versioned**: lương cơ bản + phụ cấp, `effective_date`, lịch sử, mask theo quyền | PL-01 |
| 2 | **Thưởng/phạt/khấu trừ nhập tay theo kỳ**: lý do bắt buộc, trạng thái duyệt, chống tự duyệt | PL-02 |
| 3 | **Kỳ lương tháng**: FSM 7 trạng thái + gắn kỳ công ATT + cảnh báo dữ liệu thiếu | PL-03 |
| 4 | **Gom đầu vào công/phép** per nhân sự (paid/unpaid), đối soát, tính lại trước duyệt | PL-04 |
| 5 | **Tính bảng lương nháp**: gross/khấu trừ/net ở SQL + snapshot đóng băng + breakdown | PL-05 |
| 6 | **Review + điều chỉnh dòng + duyệt four-eyes + lock/reopen** | PL-06 |
| 7 | **Phiếu lương phát hành** + «Phiếu lương của tôi» (Own) + xác nhận + NOTI | PL-07 |
| 8 | **Export XLSX** bảng lương tổng (quyền riêng + audit) | PL-08 |
| 9 | **Masking Phương án B + deny-path + audit lượt xem lương** | PL-09 |
| 10 | Widget DASH **«chi phí lương kỳ»** | PL-10 |

### 5.2 Ngoài v1 (chừa thiết kế, KHÔNG làm đợt này) — **PARK-PAYROLL-001**

- **Engine BHXH/BHYT/BHTN/TNCN luỹ tiến** (P2-PAY-05-002/003) — v1 chỉ khấu trừ nghỉ không lương · trễ/sớm · phạt · dòng tay.
- **PDF phiếu lương** (P2-PAY-07-003) · **export payslip batch / signed-URL** (P2-PAY-08-002) — v1 chỉ XLSX bảng lương tổng.
- **Variance report** (P2-PAY-08-004) · **report theo phòng ban** (P2-PAY-08-003).
- **Khiếu nại phiếu lương** (dispute/resolve) — v1 chỉ **xác nhận**; đường khiếu nại mở lại cùng gói này (§16, DB-13 §5.6).
- **Multi-currency** · **chu kỳ trả ngoài tháng** (biweekly/weekly) · **loại lương giờ/khoán**.
- **Workflow duyệt nhiều cấp** (v1 một cấp four-eyes) · **remote/work-trip rule** (P2-PAY-04-004).
- **Tài khoản ngân hàng + tệp đính kèm điều chỉnh** (P2-PAY-06-002 phần attachment).

### 5.3 Nền di sản — 6 bảng + 19 cặp quyền, KHÔNG phải nền trắng

Đo ngày 31/08/2026: **6 bảng** G12 tồn tại thật (§3.1) và **19 cặp quyền họ lương** nằm rải trong **5 migration** (`0005` · `0092` · `0097` · `0099` · `0132` · `0180`) — nhiều hơn con số hồ sơ duyệt ghi tay (0092/0097/0180). Bản đồ đầy đủ + hướng xử lý từng cặp: **§11.2**. Hàng `modules` PAYROLL **đã pre-seed inactive** từ mig `0435` (Extension, `sort_order` 8) — seed lại là NO-OP; chỉ bật `is_active` ở WO FE (khuôn `0556`/`0562`).

---

## 6. Nhóm người dùng

| Nhóm | Vai trò trong PAYROLL |
| --- | --- |
| **Payroll Officer** (SPEC-01 §10.6 — role hệ thống **mới** `payroll-officer`, PAY-DEC-009) | Toàn quyền vận hành lương: hồ sơ lương · thưởng/phạt · kỳ lương · tính · gửi duyệt · phát hành · khoá · mở lại · export, phạm vi **Company**. **KHÔNG có quyền duyệt bảng lương** (four-eyes). Role **bắt buộc 2FA** |
| Company Admin | Như Payroll Officer **cộng thêm** cặp duyệt/từ chối bảng lương — là người duyệt duy nhất ở v1 |
| HR / HR Manager | **0 cặp PAYROLL** (Phương án B). HR giữ nguyên `('view-salary','employee')` hiện hành trong hồ sơ nhân sự (khác domain, mask + audit của SPEC-03) — **grant lương di sản bị THU HỒI** (§11.2) |
| Manager (trưởng đơn vị) | **0 cặp PAYROLL** — v1 không có bảng lương theo phòng ban (Phase sau) |
| Nhân viên (employee) | Xem **phiếu lương của mình** (Own) + **xác nhận**; không thấy của ai khác, không thấy bảng lương kỳ |
| Super Admin | Nhận mọi cặp qua `SuperAdminBootstrapService` — **không** phải chủ thể để test (tautology) |

---

## 7. Mối liên kết với các module khác

| Module | PAYROLL đọc / gọi | Module kia đọc PAYROLL |
| --- | --- | --- |
| HR (SPEC-03) | `users`/`employee_profiles` (danh tính, mã nhân viên, đơn vị — qua điểm chiếu duy nhất §18); `employee_profiles.base_salary` **KHÔNG** dùng để tính (§3.2) | — |
| AUTH (SPEC-02) | RBAC per-pair + data_scope; `users` cho `*_by`; role `payroll-officer` **requires_two_factor = true** | — |
| ATT (SPEC-04) | `attendance_periods` (điều kiện `locked` trước khi tính — §3.5) · `attendance_records` (số công, phút trễ/sớm) · `companies.working_days_json` + `public_holidays.is_paid_holiday` (mẫu số `work_days` — §13.4) | — *(PAYROLL **không** dựng cổng khoá ngược: kỳ công đã bất biến từ lúc `locked`, §3.5)* |
| LEAVE (SPEC-05) | Đơn nghỉ đã duyệt + `leave_types.paid` để tách phép **có lương / không lương** | — |
| FOUNDATION | `audit_logs` (mọi mutation + mọi lượt xem lương) · `companies.payroll_config_json` (cutoffDay/payDay) · `@Idempotent()` | — |
| NOTI (SPEC-08) | Outbox bridge: `PAYROLL_PERIOD_SUBMITTED` · `PAYROLL_PERIOD_APPROVED` · `PAYROLL_PERIOD_REJECTED` · `PAYSLIP_PUBLISHED` (§17) | — |
| DASH (SPEC-07) | — | Widget «chi phí lương kỳ» đọc `GET /payroll-periods/summary` theo quyền (§15) |
| ME (SPEC-09) | — | Màn «Phiếu lương của tôi» đọc-lại `GET /me/payslips` (Own) |

---

## 8. Cấu trúc thông tin

Chi tiết cột/kiểu/constraint + **bản đồ reconcile từng bảng di sản**: [DB-13](<../DB/DB-13 PAYROLL Database Design.md>). Bảy bảng (6 reconcile + 1 mới), tất cả có `company_id` + RLS FORCE + composite tenant FK:

**Hồ sơ lương (`salary_profiles`)** — *reconcile*

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Neo | `user_id` | nhân sự hưởng lương (§8.1 — vì sao `user_id` chứ không `employee_id`) |
| Tiền | `base_salary`, `allowances` | `numeric(18,2)` · jsonb danh sách `{name, amount}`; **mask ở server** |
| Hiệu lực | `effective_date` | versioned — 1 phiên bản / (công ty, người, ngày hiệu lực) |
| Vòng đời | `note`, `deleted_at` | soft delete chuẩn §16.2 |
| **GỠ** | ~~`salary_type`~~ ~~`pay_cycle`~~ ~~`currency`~~ ~~`status`~~ | v1 chỉ lương tháng · VND · versioned thay cờ active (DB-13 §5.1) |

**Kỳ lương (`payroll_periods`)** — *reconcile*

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Kỳ | `period_month`, `pay_date` | `YYYY-MM`; ngày trả suy từ `payroll_config_json.payDay`, ghi cứng lúc tạo kỳ |
| Nguồn công | `attendance_period_id` | phải `locked` trước khi tính (PAYROLL-ERR-002) |
| Trạng thái | `status` | **7 giá trị** §17.15; FSM §13.1 |
| Vết | `created_by` · `calculated_by/at` · `submitted_by/at` · `approved_by/at` · `published_by/at` · `locked_by/at` · `reopen_reason` | four-eyes so `submitted_by` ≠ `approved_by` (CHECK chốt cuối) |
| **GỠ** | ~~`kpi_locked`~~ | KPI ngoài phạm vi sản phẩm (de-media-fy) |

**Dòng bảng lương nháp (`payroll_period_lines`)** — *bảng MỚI*

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Neo | `payroll_period_id`, `user_id`, `salary_profile_id` | 1 dòng / (kỳ, người) — UNIQUE |
| Đầu vào (đóng băng) | `work_days`, `present_days`, `paid_leave_days`, `unpaid_leave_days`, `late_minutes`, `input_snapshot_json` | ảnh chụp lúc `calculate` (§3.4) |
| Tiền | `base_amount`, `allowance_amount`, `bonus_amount`, `penalty_amount`, `deduction_amount`, `adjustment_amount`, `gross`, `net` | `numeric(18,2)`, tính ở SQL |
| Điều chỉnh | `adjustment_reason` | **bắt buộc khi `adjustment_amount <> 0`** (CHECK) |
| Vòng đời | `deleted_at` | tính lại = upsert + xoá mềm dòng không còn đủ điều kiện (không hard-delete) |

**Phiếu lương (`payslips`)** + **dòng phiếu (`payslip_items`)** — *reconcile, append-only*

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Neo | `payroll_period_id`, `user_id`, `salary_profile_id` | **UNIQUE (công ty, kỳ, người)** — chốt cuối chống sinh hai lần |
| Tiền | `base_salary`, `total_allowances`, `bonus_amount`, `penalty_amount`, `deduction_amount`, **`adjustment_amount`**, `gross`, `net` | copy đóng băng từ dòng nháp lúc generate; **`adjustment_amount` CÓ DẤU**, nằm ngoài `gross`/`deduction` (§13.4) |
| Đầu vào | `work_days`, `present_days`, `paid_leave_days`, `unpaid_leave_days`, `late_minutes`, `input_snapshot_json` | |
| Dòng phiếu | `item_type`, `label`, `amount`, `sort_order` | breakdown giải-thích-được; `item_type` ∈ `earning`/`deduction`/`allowance`/`attendance`/`bonus`/`penalty`/**`adjustment`** (**7 giá trị**); **`amount` CÓ DẤU** ⇒ `SUM(amount) = gross − deduction_amount + adjustment_amount` |
| **GỠ** | ~~`entry_kind`~~ ~~`replaces_payslip_id`~~ ~~`kpi_amount`~~ ~~`currency`~~ | không chuỗi adjustment/void ở v1 (§3.4) · KPI ngoài phạm vi · VND hằng |

**Thưởng/phạt/khấu trừ (`bonus_penalties`)** — *reconcile*

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Nội dung | `user_id`, `kind` (`bonus`/`penalty`), `amount` (> 0), `period_month`, `reason` | `reason` **NOT NULL** — lý do bắt buộc |
| Duyệt | `status`, `decided_by`, `decided_at`, `decision_note` | §17.17; reject bắt buộc `decision_note`; tự duyệt bị chặn (PAYROLL-ERR-012) |
| Tiêu thụ | `payroll_period_id`, `consumed_at` | bind kỳ đã gộp — chống cộng hai lần (cặp NULL/NOT NULL) |
| **GỠ** | ~~`source`~~ ~~`reference_type`~~ ~~`task_id`~~ ~~`kpi_result_id`~~ ~~`currency`~~ | v1 chỉ nhập tay; tham chiếu KPI/TASK là di sản hướng cũ |

**Xác nhận phiếu (`payslip_acknowledgements`)** — *reconcile → sổ chỉ-INSERT*

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Neo | `payslip_id`, `user_id`, `created_at` | **1 hàng / phiếu / người** (unique có sẵn); hàng tồn tại = đã xác nhận |
| **GỠ** | ~~`status`~~ ~~`reason`~~ ~~`resolved_by/at`~~ ~~`resolution_note`~~ ~~`updated_at`~~ + trigger `0131` | khiếu nại ngoài v1 → PARK-PAYROLL-001; giữ cột không ai ghi là nợ |

### 8.1 Vì sao neo `user_id` chứ không `employee_id`

Sáu bảng di sản khoá theo `user_id`. Nguồn đầu vào của máy tính lương — `attendance_records` và `leave_requests` — **cũng đang khoá theo `user_id`** (drift đã ghi ở `erd-current` §A3, chưa reconcile toàn hệ). Đổi riêng PAYROLL sang `employee_id` trong khi ATT/LEAVE chưa đổi sẽ đẻ **join rỗng** cho nhân sự không có tài khoản (hồ sơ UNLINKED — có thật, sinh từ import Excel và từ convert RECRUIT).

⇒ v1 **giữ `user_id`**, ghi nhận là **nợ reconcile đi cùng đợt reconcile ATT/LEAVE** (`erd-current` §A3), không mở riêng ở wave này. Danh tính hiển thị (họ tên · mã nhân viên · đơn vị) lấy qua điểm chiếu duy nhất (§18) bằng cách JOIN `employee_profiles` theo liên kết user↔employee hiện hành.

---

## 9. Danh sách màn hình

| Mã | Màn hình | Ghi chú |
| --- | --- | --- |
| PAY-SCREEN-001 | Danh sách kỳ lương (`/payroll/periods`) | Bảng + lọc tháng/trạng thái; chip trạng thái 7 giá trị; nút «+ Kỳ lương»; **không hiện số tiền** (cặp `view:payroll-period` không nhạy cảm) |
| PAY-SCREEN-002 | Chi tiết kỳ lương (`/payroll/periods/:id`) | Bảng lương theo nhân sự (gross/khấu trừ/net) + **thanh hành động theo FSM** (gom · tính · gửi duyệt · duyệt/từ chối · phát hành · khoá · mở lại) + **hộp cảnh báo dữ liệu thiếu**; nút không hiện thay vì hiện rồi 409; ô tiền `tabular-nums`, mask per-row theo quyền |
| PAY-SCREEN-003 | Phiếu lương chi tiết (`/payroll/payslips/:id`) | Breakdown giải-thích-được: từng `payslip_item` + đầu vào công/phép; chỉ với cặp `view-payslip` |
| PAY-SCREEN-004 | Hồ sơ lương nhân sự (`/payroll/salary-profiles`) | Danh sách + **lịch sử phiên bản theo `effective_date`**; form tạo phiên bản mới (không sửa quá khứ đã bị kỳ đã tính tham chiếu — snapshot đóng băng nên an toàn); chọn người qua **`PAYROLL-API-034`** (role `payroll-officer` không có cặp HR) |
| PAY-SCREEN-005 | Thưởng/phạt/khấu trừ kỳ (`/payroll/bonus-penalties`) | Danh sách theo `period_month` + trạng thái; tạo/sửa khi `Pending`; duyệt/từ chối (nút ẩn với chính người tạo — four-eyes); badge «đã vào kỳ …» khi đã consume |
| PAY-SCREEN-006 | «Phiếu lương của tôi» (`/me/payslips`) | Own — danh sách kỳ đã phát hành + chi tiết breakdown + nút **Xác nhận**; deep-link từ NOTI `PAYSLIP_PUBLISHED` |

Mọi màn: `<PermissionGate>` + `useCan()`, trạng thái loading/error/empty (§14), i18n vi namespace `payroll`, nhãn trạng thái dùng constants chuẩn SPEC-01 §17.15–17.17, **mọi trường tiền khai `.optional()` trong FE schema** (server mask = vắng khoá — `server-masking-needs-optional-fe-schema`).

---

## 10. Chi tiết chức năng

| Mã | Chức năng | Mô tả ngắn |
| --- | --- | --- |
| PAYROLL-FUNC-001 | Quản lý hồ sơ lương versioned | tạo phiên bản mới theo `effective_date` (trùng ngày ⇒ PAYROLL-ERR-014), sửa/xoá mềm phiên bản; lịch sử đầy đủ; mask + audit lượt xem |
| PAYROLL-FUNC-002 | Thưởng/phạt/khấu trừ theo kỳ | tạo (lý do bắt buộc) · sửa khi `Pending` · duyệt/từ chối (§13.3); **tự duyệt bị chặn** (012); đã consume ⇒ khoá sửa (013) |
| PAYROLL-FUNC-003 | Tạo & cấu hình kỳ lương | tạo kỳ tháng (trùng tháng ⇒ 008), gắn `attendance_period_id`, ghi `pay_date` từ `payroll_config_json` |
| PAYROLL-FUNC-004 | Gom đầu vào công/phép | `Draft → CollectingData`: gom số công · phép có lương/không lương · phút trễ per nhân sự từ ATT/LEAVE |
| PAYROLL-FUNC-005 | Cảnh báo dữ liệu thiếu | danh sách nhân sự **thiếu hồ sơ lương hiệu lực** / **thiếu bản ghi công** — cảnh báo mềm, không chặn; 0 nhân sự đủ điều kiện ⇒ 422 (009) |
| PAYROLL-FUNC-006 | Tính bảng lương nháp | `CollectingData → Calculated` (hoặc tính lại tại `Calculated`): công thức §3.3 ở SQL, ghi `payroll_period_lines` + `input_snapshot_json`; đòi kỳ công `locked` (002); idempotency theo kỳ |
| PAYROLL-FUNC-007 | Điều chỉnh dòng lương | sửa `adjustment_amount` + **lý do bắt buộc** trên một dòng, chỉ khi kỳ `Calculated` (kỳ ≥ Approved ⇒ 003); audit từng lần |
| PAYROLL-FUNC-008 | Gửi duyệt / duyệt / từ chối | `Calculated → Reviewing → Approved` hoặc quay lại `Calculated`; **four-eyes** (005); reject bắt buộc comment; NOTI-EVENT-020/021/022 |
| PAYROLL-FUNC-009 | Sinh phiếu lương | tại `Approved`: copy dòng nháp → `payslips` + `payslip_items` (append-only); chốt cuối UNIQUE (kỳ, người) ⇒ race map 006, không 500 |
| PAYROLL-FUNC-010 | Phát hành phiếu lương | `Approved → Paid`: mở cho nhân viên + NOTI-EVENT-023 từng người; kỳ chưa sinh phiếu ⇒ 007 |
| PAYROLL-FUNC-011 | Khoá / mở lại kỳ | `Paid → Locked` (khoá luôn chỉnh công ATT tháng đó); mở lại về `CollectingData` **chỉ khi chưa sinh phiếu** (004), lý do bắt buộc + audit |
| PAYROLL-FUNC-012 | «Phiếu lương của tôi» + xác nhận | Own: danh sách + chi tiết breakdown; xác nhận ghi 1 hàng `payslip_acknowledgements`; phiếu chưa phát hành ⇒ 015 |
| PAYROLL-FUNC-013 | Export bảng lương XLSX | theo kỳ, cặp `('export','payroll')` **+** `('view-line','payroll-period')` (§18); **audit bắt buộc**; > 10.000 dòng ⇒ 422 (016) |
| PAYROLL-FUNC-014 | Chi phí lương kỳ | tổng gross/net + headcount + trạng thái kỳ gần nhất — nguồn widget DASH (`/payroll-periods/summary`) |

### 10.1 Mã widget dashboard (SPEC-01 §9.9)

| Mã | widget_code | Tên | Nguồn | Gate |
| --- | --- | --- | --- | --- |
| **PAYROLL-WIDGET-001** | `PAYROLL_COST` | Chi phí lương kỳ (slug `payroll-cost` — ship `S13-PAYROLL-DASH-1`) | PAYROLL-FUNC-014 / PAYROLL-API-018 (`PayrollPeriodsService.summary` — một công thức, một con số) | cặp **`('view-line','payroll-period')`** (nhạy cảm, **cặp ĐỌC thuần** — payload CHỨA SỐ TIỀN nên không dùng được `view:payroll-period`; và gác bằng cặp GHI `calculate` thì «ai thấy widget đều ghi được lương») **+ SÀN scope `Company`** (`DASH_WIDGET_MIN_DATA_SCOPE` — `summary` cộng toàn công ty nên grant hẹp hơn không được serve) |

---

## 11. Permission — **ĐÃ CHỐT cùng gói duyệt 31/08/2026**

### 11.1 Bộ cặp v1 (17 cặp)

Theo chuẩn per-pair `(action, resource)` + data_scope per-(permission, role). Module `PAYROLL` đứng riêng — **KHÔNG mặc định cho HR** (DECISIONS-01 Phương án B). Bảng dưới là **cặp engine thực thi**; mã dotted `PAYROLL.RESOURCE.ACTION` (SPEC-01 §9.5) chỉ là tên hiển thị. Đa-từ dùng **dash** theo quy ước engine (`payroll-period`, `salary-profile`, `bonus-penalty`).

| Cặp quyền | Mã hiển thị | `is_sensitive` | Ý nghĩa | Nhân viên | Manager · HR | Payroll Officer | Company Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `('access','payroll')` | `PAYROLL.ACCESS` | false | cổng nav menu Tiền lương | **Own** | — | Own | Own |
| `('view','payroll-period')` | `PAYROLL.PERIOD.VIEW` | false | xem danh sách/chi tiết kỳ — **không số tiền** | — | — | Company | Company |
| `('manage','payroll-period')` | `PAYROLL.PERIOD.MANAGE` | false | tạo kỳ · cấu hình · gắn kỳ công · **khoá kỳ** (cấu hình kỳ — PAY-DEC-006) | — | — | Company | Company |
| `('view-line','payroll-period')` | `PAYROLL.PERIOD.VIEW-LINE` | **true** | **đọc dòng bảng lương (CÓ SỐ TIỀN)** + tổng chi phí kỳ + vế đọc của export — **cặp ĐỌC thuần, tách khỏi cặp ghi** | — | — | Company | Company |
| `('calculate','payroll-period')` | `PAYROLL.PERIOD.CALCULATE` | **true** | gom đầu vào · tính · điều chỉnh dòng · gửi duyệt (**ghi**) | — | — | Company | Company |
| `('approve','payroll-period')` | `PAYROLL.PERIOD.APPROVE` | **true** | duyệt / từ chối bảng lương — **KHÔNG gán Payroll Officer** (four-eyes, PAY-DEC-007) | — | — | **—** | Company |
| `('publish','payroll-period')` | `PAYROLL.PERIOD.PUBLISH` | **true** | sinh phiếu lương + phát hành cho nhân viên | — | — | Company | Company |
| `('reopen','payroll-period')` | `PAYROLL.PERIOD.REOPEN` | **true** | mở lại kỳ (lý do bắt buộc + audit) | — | — | Company | Company |
| `('view','salary-profile')` | `PAYROLL.SALARY.VIEW` | **true** | xem hồ sơ lương + lịch sử phiên bản (+ danh bạ chọn người) | — | — | Company | Company |
| `('manage','salary-profile')` | `PAYROLL.SALARY.MANAGE` | **true** | tạo phiên bản mới · sửa · xoá mềm | — | — | Company | Company |
| `('view','bonus-penalty')` | `PAYROLL.BONUS.VIEW` | **true** | xem thưởng/phạt/khấu trừ theo kỳ | — | — | Company | Company |
| `('manage','bonus-penalty')` | `PAYROLL.BONUS.MANAGE` | **true** | tạo · sửa khi `Pending` · xoá mềm | — | — | Company | Company |
| `('approve','bonus-penalty')` | `PAYROLL.BONUS.APPROVE` | **true** | duyệt / từ chối (tự duyệt bị chặn ở service) | — | — | Company | Company |
| `('export','payroll')` | `PAYROLL.EXPORT` | **true** | export XLSX bảng lương (audit bắt buộc) | — | — | Company | Company |
| `('view-payslip','payslip')` *(di sản `0097` — GIỮ)* | `PAYROLL.PAYSLIP.VIEW` | **true** | xem phiếu lương của **người khác** | — | — | Company | Company |
| `('view-own-payslip','payslip')` *(di sản `0180` — GIỮ)* | `PAYROLL.PAYSLIP.VIEW-OWN` | **true** | xem phiếu lương **của mình** | **Own** | — | — | — |
| `('acknowledge-own-payslip','payslip')` *(di sản `0132` — GIỮ)* | `PAYROLL.PAYSLIP.ACK-OWN` | false | xác nhận phiếu lương của mình | **Own** | — | — | — |

Ghi chú bắt buộc:

- **Đúng 17 cặp; 13 cặp `is_sensitive = true`**, 4 cặp false (`access:payroll` cổng nav · `view:payroll-period` không số tiền · `manage:payroll-period` cấu hình kỳ · `acknowledge-own-payslip` không số tiền) — đúng PAY-DEC-006 «cặp payroll nhạy cảm trừ cấu hình kỳ». Chốt cùng seed, **không flip sau** (bẫy `canonical-seed-pin-regression`). 13 cặp sensitive **phải khai allowlist capability ở BACKEND** cùng WO BE — thiếu là màn quản trị biến mất với chính role được grant (`capability-allowlist-hides-admin-screens`).
- **Cặp ĐỌC tiền tách khỏi cặp GHI** (`view-line` ≠ `calculate`) — gộp làm một thì (a) không thể cấp quyền *đọc* bảng lương mà không cấp quyền *ghi*, (b) người chỉ có `approve` sẽ **duyệt mù** vì không đọc được dòng nào, (c) ai thấy widget DASH đều là người ghi được lương.
- **Hệ quả BẮT BUỘC của việc tách cặp — route GHI KHÔNG chở số tiền:** `collect` (005) · `calculate` (007) · `adjust-line` (009) trả **envelope không có khoá tiền nào** (chỉ `{ id, status, affectedLines, warnings[] }`); FE tải lại số qua `GET …/lines`. Nếu để route GHI trả `gross`/`net`/`adjustmentAmount` thì role có `calculate` mà không `view-line` **đọc được tiền qua cửa sau**, và §14/§21 lại cấm viết ca mask per-row nên **không cổng nào chạm tới đường rò đó**.
- **Hai điều kiện verify seed fail-loud** (migration, DB-13 §10 bước B): (1) mọi role giữ `('approve','payroll-period')` **phải** giữ `('view-line','payroll-period')`; (2) mọi role giữ `('calculate','payroll-period')` **phải** giữ `('view-line','payroll-period')`. ⚠️ Verify chỉ đúng **tại thời điểm migration** — `permission-admin` có thể gỡ `view-line` lúc runtime; rủi ro «duyệt mù» còn lại được chấp nhận tường minh, QA có ca đối chứng (§21).
- **Ba cặp họ `payslip` GIỮ NGUYÊN TÊN di sản** (kiểu action-carries-resource) thay vì đổi sang `(view, payslip)`: ràng buộc thật là **`view-own-payslip` đang có grant sống cho `employee` từ `0180`** mà PAY-DEC-006 yêu cầu giữ; hai cặp còn lại giữ cùng họ tên cho nhất quán. *(Đính chính phép đo: `permission-admin.int-spec.ts` có dùng `view-payslip` làm ví dụ object-permission nhưng **tự seed lại** cặp đó qua `seedPermissionCatalog(… ON CONFLICT DO NOTHING)` ⇒ spec đó **không** phải lý do bắt buộc giữ. Đừng dẫn nó như bằng chứng.)*
- **`('approve','payroll-period')` KHÔNG gán `payroll-officer`** — four-eyes là ràng buộc **quyền**, không chỉ là kiểm tra runtime; service kiểm thêm `submitted_by ≠ approved_by` (PAYROLL-ERR-005) và DB có CHECK chốt cuối (§13.1).
- **Số tiền không đi qua cặp không nhạy cảm:** `view:payroll-period` cố ý để `is_sensitive=false` cho màn danh sách kỳ nên **không được chở số tiền, kể cả tổng**; dòng bảng lương · `summary` · widget DASH đều gác bằng `('view-line','payroll-period')` (§10.1, §15).
- **Export đòi CẢ HAI cặp** `('export','payroll')` **VÀ** `('view-line','payroll-period')` — cổng export đứng một mình là đường đọc lương **rộng hơn** đường đọc từng hàng (bài học RECRUIT H5).
- **Role `payroll-officer` là role hệ thống MỚI** (PAY-DEC-009): `roles.company_id IS NULL` · `is_system = true` · **`requires_two_factor = TRUE`** (khác tiền lệ `asset-manager`/`office-admin`/`recruiter` = false — lương là crown, owner chấp nhận khi duyệt nguyên gói) · **KHÔNG canonical** — không vào `DashCanonicalRole`/`NOTI_CANONICAL_ROLES`/pin `auth-seed-canonical-roles`. Id cố định **`…0015`** (đo 31/08/2026: `…0012` asset-manager · `…0013` office-admin · `…0014` recruiter).
- **Ma trận seed = 32 hàng** `role_permissions`: `employee` **3** (`access`@Own · `view-own-payslip`@Own · `acknowledge-own-payslip`@Own) · `manager` **0** · `hr` **0** · `hr-manager` **0** · `payroll-officer` **14** (17 − `approve:payroll-period` − 2 cặp Own của nhân viên) · `company-admin` **15** (17 − 2 cặp Own của nhân viên). Migration verify fail-loud đúng số; `super-admin` không enumerate (nhận qua `SuperAdminBootstrapService`).
- **Không có DTO nửa-mask ở v1:** mọi route chở số tiền đều gác bằng đúng một cặp chở-tiền (`lines`/`summary`/`export` ← `view-line` · phiếu ← `view-payslip`/`view-own-payslip` · hồ sơ lương ← `view:salary-profile`). ⇒ **không tồn tại caller nhận DTO thiếu-khoá-tiền**, nên **KHÔNG dựng ca test cho nhánh «mask per-row»** (sẽ là ca xanh-rỗng). FE vẫn khai `.optional()` cho mọi trường tiền như phòng thủ chiều sâu.
- **Object-permission của họ `payslip`** (`0180` đã chốt): `view-own-payslip` và `acknowledge-own-payslip` phải khai **`objectGrantRequired = false`** tường minh ở service — ngược lại nhân viên có company-grant vẫn **403 trên phiếu của chính mình** (bẫy đã ghi trong chính `0180`). `view-payslip` giữ ngữ nghĩa object-permission override hiện hành.
- **`('access','payroll')`@Own cấp cho `employee` là CÓ CHỦ ĐÍCH, đừng gỡ:** nó là cổng nav/capability của khối «Phiếu lương của tôi» **trong app ME**, không phải thẻ app PAYROLL — thẻ đó gác `["access:payroll", "view:payroll-period"]` (§23 mục 11d) nên nhân viên **không** thấy app PAYROLL, đúng ý.
- Data scope ép ở **service layer** (pattern `buildReadScopeExists`), không phải RLS. Scope Own của phiếu lương = `payslips.user_id` = user của caller.

### 11.2 Bản đồ 19 cặp quyền DI SẢN — đo 31/08/2026

> ⚠️ Hồ sơ duyệt ghi tay chỉ nhắc `0092`/`0097`/`0180`. Đo bằng grep toàn bộ `apps/api/migrations/` cho thấy họ lương trải **5 migration / 19 cặp**. Hai lỗ thật (đo lại từng dòng 31/08/2026):
>
> 1. **`('approve-payroll-period','payroll_period')` và `('publish-payroll-period','payroll_period')` (`0132:70-71`) để `is_sensitive = false`** ⇒ **duyệt và phát hành lương kế thừa được qua wildcard `*:*`**.
> 2. **4 cặp `payslip` của `0005:282-285`** (`create`/`read`/`update`/`delete`, đều `is_sensitive=false`) dính **blanket-grant `WHERE p.is_sensitive = false` KHÔNG điều kiện** ở `0005:310-313` — **chỉ của `company-admin` (`…0001`)**. *(Đính chính phép đo: 7 role hệ thống thời media còn lại (`0005:317-433`) đều có thêm `AND (action, resource_type) IN (…)` liệt kê cụ thể và **không** chứa cặp `payslip` nào — đừng viết verify migration theo giả định «mọi role media đều dính».)* Trong bốn cặp đó, **`('update','payslip')` mâu thuẫn thẳng bất biến #2** (phiếu lương append-only).
>
> **GRANT trong migration cũ ≠ hiện trạng DB** (`grant-in-old-migration-is-not-current-state`): WO DB **phải ĐO bảng thật** (`permissions` ⋈ `role_permissions` ⋈ `roles`) trước khi viết lệnh thu hồi, không suy từ file migration.

| Cặp di sản | sensitive | Nguồn | Xử lý ở wave này |
| --- | --- | --- | --- |
| `('create','payslip')` | false | `0005` | **GỠ** — phiếu lương chỉ sinh qua `generate`, không có đường tạo tay |
| `('read','payslip')` | false | `0005` | **GỠ** — trùng `view-payslip`, lại không nhạy cảm |
| `('update','payslip')` | false | `0005` | **GỠ** — mâu thuẫn thẳng bất biến #2 (phiếu lương append-only) |
| `('delete','payslip')` | false | `0005` | **GỠ** — không hard-delete |
| `('view-salary','payslip')` | true | `0005` | **GỠ** — trùng `view-payslip` |
| `('view-salary-profile','salary_profile')` | true | `0092` | **GỠ** → thay bằng `('view','salary-profile')` |
| `('manage-salary-profile','salary_profile')` | true | `0092` | **GỠ** → thay bằng `('manage','salary-profile')` |
| `('manage-payroll-period','payroll_period')` | false | `0097` | **GỠ** → thay bằng `('manage','payroll-period')` |
| `('run-payroll','payroll_period')` | true | `0097` | **GỠ** → thay bằng `('calculate','payroll-period')` |
| `('read-payslip','payslip')` | true | `0097` | **GỠ** — trùng `view-payslip`, 0 tham chiếu code |
| `('manage-bonus-penalty','bonus_penalty')` | true | `0099` | **GỠ** → thay bằng `('manage','bonus-penalty')` |
| `('approve-bonus-penalty','bonus_penalty')` | true | `0099` | **GỠ** → thay bằng `('approve','bonus-penalty')` |
| `('view-bonus-penalty','bonus_penalty')` | true | `0099` | **GỠ** → thay bằng `('view','bonus-penalty')` |
| `('approve-payroll-period','payroll_period')` | **false ⚠️** | `0132` | **GỠ** → thay bằng `('approve','payroll-period')` **is_sensitive=true** (vá lỗ wildcard) |
| `('publish-payroll-period','payroll_period')` | **false ⚠️** | `0132` | **GỠ** → thay bằng `('publish','payroll-period')` **is_sensitive=true** (vá lỗ wildcard) |
| `('resolve-payslip-dispute','payslip')` | true | `0132` | **GỠ** — khiếu nại ngoài v1 (§5.2), mở lại cùng PARK-PAYROLL-001 |
| `('view-payslip','payslip')` | true | `0097` | **GIỮ** — vào §9g; **thu hồi grant `hr-manager`**, grant lại `payroll-officer` + `company-admin` @Company |
| `('view-own-payslip','payslip')` | true | `0180` | **GIỮ nguyên grant `employee`** (PAY-DEC-006) |
| `('acknowledge-own-payslip','payslip')` | false | `0132` | **GIỮ grant `employee`**; **thu hồi grant `company-admin` + `hr-manager`** (không ai xác nhận hộ) |

**Thu hồi (PAY-DEC-006) — BA bảng, không phải hai:** xoá **mọi** hàng `role_permissions` **và `object_permissions`** trỏ 16 cặp bị GỠ (không chỉ của `hr-manager` — blanket-grant không điều kiện của `0005` đã rải cho `company-admin`), rồi xoá 16 cặp khỏi `permissions`. ⚠️ `object_permissions.permission_id` là **`ON DELETE CASCADE`** (`0005:154`) ⇒ xoá cặp sẽ cascade âm thầm — phải **ĐO trước** rồi xoá tường minh, kẻo mất vết một lớp quyền. **Với 3 cặp GIỮ:** xoá grant `hr-manager` (`…0009`) trên `view-payslip` ở **cả `role_permissions` lẫn `object_permissions`** (cặp này *giữ ngữ nghĩa object-permission override* — thu hồi chỉ ở `role_permissions` là để lại đường đọc phiếu lương sống trong khi verify «hr-manager = 0 cặp» vẫn XANH); xoá grant `company-admin` + `hr-manager` trên `acknowledge-own-payslip`. Sau thu hồi, **`hr-manager` giữ đúng 0 cặp PAYROLL**. Cặp `('view-salary','employee')` (`0019`, domain HR) **KHÔNG đụng tới** — đó là masking hồ sơ nhân sự của SPEC-03, không phải quyền tiền lương. Tiền lệ xoá cặp mồ côi + grant: `0548` (27 cặp / 89 grant của cụm workflow).

---

## 12. Quy tắc nghiệp vụ và mã lỗi

`error.details` là **mảng** `ErrorDetail {field, message, rule}` (API-01; `details.kind` = phần tử `field:"kind"`). Vế "lỗi hình thức" (thiếu `reason`, `amount ≤ 0`, `period_month` sai định dạng, khoá lạ trong PATCH `.strict()`, `:id` không phải UUID) chặn ở Zod ⇒ **400 `VALIDATION-ERR-001`** — không chiếm mã dưới đây.

| Mã lỗi | HTTP | Quy tắc |
| --- | --- | --- |
| PAYROLL-ERR-001 | 409 | Chuyển **trạng thái kỳ lương** không hợp lệ theo FSM §13.1 (kể cả chuyển tới chính trạng thái hiện tại). Thông điệp nêu from/to |
| PAYROLL-ERR-002 | 409 | Tính lương khi **kỳ công ATT chưa `locked`** (`kind = attendance-not-locked`) hoặc kỳ lương **chưa gắn `attendance_period_id`** (`kind = attendance-period-missing`) |
| PAYROLL-ERR-003 | 409 | Tính lại / điều chỉnh dòng khi kỳ đã **≥ `Approved`** (`kind = period-frozen`) — snapshot đã đóng băng |
| PAYROLL-ERR-004 | 409 | **Mở lại kỳ bị chặn**: kỳ đã sinh phiếu lương (`kind = payslip-already-generated` — phiếu là bản ghi bất biến, không xoá được) · kỳ ở `Paid`/`Locked` (`kind = period-terminal`) |
| PAYROLL-ERR-005 | 409 | **Four-eyes**: người duyệt trùng người gửi duyệt (`kind = same-actor-approval`) — chốt cuối CHECK ở DB, race map 409 không 500 |
| PAYROLL-ERR-006 | 409 | Sinh phiếu lương lần hai cho cùng (kỳ, nhân sự) — chốt cuối `UNIQUE (company_id, payroll_period_id, user_id)`; hai request song song bóc `23505` từ `cause` → 006 |
| PAYROLL-ERR-007 | 409 | **Phát hành kỳ chưa sinh phiếu lương** (`kind = no-payslip`) |
| PAYROLL-ERR-008 | 409 | Tạo kỳ lương cho **tháng đã có kỳ** (`kind = period-month-exists`) — chốt cuối unique `(company_id, period_month) WHERE deleted_at IS NULL` |
| PAYROLL-ERR-009 | 422 | **Không có nhân sự nào đủ điều kiện tính** (`kind = no-eligible-employee`) — 0 người có hồ sơ lương hiệu lực trong kỳ. *(Thiếu dữ liệu của MỘT SỐ người là **cảnh báo mềm**, không phải lỗi — PAYROLL-FUNC-005)* |
| PAYROLL-ERR-010 | 404 | Sentinel not-found: kỳ / dòng / phiếu / hồ sơ lương / thưởng-phạt **không thuộc company**, đã xoá mềm, hoặc **ngoài data scope** (nhân viên mở phiếu của người khác) — **một phản hồi duy nhất** (chống dò sự tồn tại; không 403) |
| PAYROLL-ERR-011 | 409 | **Thưởng/phạt**: sửa hoặc quyết định hàng **không còn `Pending`** theo FSM §13.3 (`kind = not-pending`) |
| PAYROLL-ERR-012 | 409 | **Tự duyệt** thưởng/phạt do chính mình tạo (`kind = self-approval`) — segregation of duties |
| PAYROLL-ERR-013 | 409 | Sửa / xoá mềm thưởng-phạt **đã được gộp vào một kỳ lương** (`kind = already-consumed`) |
| PAYROLL-ERR-014 | 409 | **Hồ sơ lương**: đã có phiên bản cùng `effective_date` cho nhân sự đó (`kind = effective-date-exists`) — chốt cuối unique, race map 409 |
| PAYROLL-ERR-015 | 409 | Xác nhận phiếu lương **chưa phát hành** (`kind = payslip-not-published`) · xác nhận lần hai (`kind = already-acknowledged` — chốt cuối unique) |
| PAYROLL-ERR-016 | 422 | Export vượt trần **10.000 dòng** theo bộ lọc hiện hành (`kind = export-too-large`) — thu hẹp bộ lọc rồi xuất lại (§19) |
| PAYROLL-ERR-017 | 422 | **Không có người duyệt hợp lệ**: lúc `submit`, company không tồn tại user nào **khác actor** giữ cặp `('approve','payroll-period')` (`kind = no-eligible-approver`). Chặn ở đây thay vì để kỳ kẹt vĩnh viễn ở `Reviewing` — thông điệp hướng dẫn gán role `payroll-officer` cho người tính hoặc thêm company-admin thứ hai (§13.1) |

Quy tắc bổ sung (không cần mã riêng):

- **PAYROLL KHÔNG cấp mã lỗi cho đường chỉnh công của ATT** và không dựng cổng khoá ngược — bảng công tháng đó đã bất biến từ lúc `attendance_periods` `locked` (§3.5). Không viện dẫn `ATT-ERR-024` (mã không tồn tại trong code, và hai tài liệu ATT mô tả nó khác nhau — nợ của ATT, §23 mục 12).
- **Race chốt cuối ở DB → 409, không 500.** Ngoài `23505` (unique), service phải bóc **`23514` (check_violation)** từ `error.cause`: vi phạm `payroll_periods_four_eyes_check` ⇒ **409 PAYROLL-ERR-005**; vi phạm `payroll_period_lines_adjustment_check` ⇒ **400 `VALIDATION-ERR-001`**. Không map = 500 ở vùng đỏ.
- POST tạo (kỳ lương · hồ sơ lương · thưởng/phạt) và hành động nặng (`calculate` · `generate-payslips`) nhận header `Idempotency-Key` **do client sinh khi mở form / bấm nút** qua **`@Idempotent()` dùng chung** (khoá `company_id + user_id + method + path + key`, TTL 15′, replay phát lại envelope + `Idempotency-Replayed: true`) — server **không** tự suy khoá từ payload (`period-key-idempotency-needs-frozen-source`). Chống trùng **nghiệp vụ** (kỳ trùng tháng, phiếu sinh hai lần, xác nhận hai lần, phiên bản lương trùng ngày) là việc của UNIQUE ở DB, không phải idempotency.
- Mọi mutation quan trọng **và mọi lượt ĐỌC số lương của người khác** (chi tiết phiếu · dòng bảng lương · export) ghi `audit_logs`; **payload audit không chứa số tiền** (chỉ id + hành động + kỳ + số dòng).
- **Bản đồ `object_type` audit (danh sách ĐÓNG):** `payroll_period` (tạo/cấu hình kỳ · collect · calculate · **điều chỉnh dòng** · submit · approve/reject · generate · publish · lock · reopen · **export** · **đọc dòng bảng lương**; `object_id = payrollPeriodId`, payload kèm `lineId`/`userId` khi cần) · `salary_profile` (CRUD hồ sơ lương + **đọc**; `object_id = salaryProfileId`) · `bonus_penalty` (CRUD + quyết định; `object_id = bonusPenaltyId`) · `payslip` (**đọc phiếu của người khác** · xác nhận; `object_id = payslipId`). Ghi `object_type` ngoài bản đồ này = CHECK violation 500. **Bốn giá trị này đã có sẵn** trong CHECK `audit_logs.object_type` từ band G12 (`0090`/`0093`/`0099`) — WO DB **đo lại** rồi UNION-ADD **chỉ giá trị còn thiếu** (`audit-check-union-parse-anchor-trap`).
- Dùng lại nhóm lỗi chung API-01: `AUTH-ERR-UNAUTHENTICATED` 401 · `AUTH-ERR-FORBIDDEN` 403 (thiếu cặp) · `VALIDATION-ERR-001` 400 · mã idempotency `REQUEST-ERR-IDEMPOTENCY-*` 409.

---

## 13. Lõi nghiệp vụ

### 13.1 FSM kỳ lương (PAY-DEC-005 · SPEC-01 §17.15)

| Từ ↓ / Tới → | `Draft` | `CollectingData` | `Calculated` | `Reviewing` | `Approved` | `Paid` | `Locked` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **`Draft`** | — | collect ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **`CollectingData`** | ✗ | — *(collect lại tại chỗ ✓)* | calculate ✓ | ✗ | ✗ | ✗ | ✗ |
| **`Calculated`** | ✗ | **reopen ✓** | — *(calculate lại + điều chỉnh dòng tại chỗ ✓)* | submit ✓ | ✗ | ✗ | ✗ |
| **`Reviewing`** | ✗ | **reopen ✓** | reject ✓ (bắt buộc comment) | — | approve ✓ (four-eyes) | ✗ | ✗ |
| **`Approved`** | ✗ | **reopen ✓** *(chỉ khi CHƯA sinh phiếu — 004)* | ✗ | ✗ | — *(generate phiếu tại chỗ ✓)* | publish ✓ | ✗ |
| **`Paid`** | ✗ | ✗ | ✗ | ✗ | ✗ | — | lock ✓ |
| **`Locked`** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — |

- Mọi ô ✗ ⇒ **PAYROLL-ERR-001** (409). Service viết đúng **một hàm** `assertPeriodTransition(from, to, via)` — không controller nào tự kiểm.
- **MỌI hành động chạm trạng thái kỳ mở transaction và bắt đầu bằng `SELECT … FROM payroll_periods WHERE id = $1 FOR UPDATE`** — `collect` · `calculate` · `adjust-line` · `submit` · `approve` · `reject` · `generate-payslips` · `publish` · `lock` · `reopen`. Không chỉ `calculate`. Thiếu row-lock trên `generate-payslips`/`reopen` là đường vào trạng thái **không thoát được**: `reopen` đọc "0 phiếu" trong khi `generate` đang INSERT ⇒ kỳ về `CollectingData` nhưng đã có `payslips`; từ đó phiếu không mang trạng thái dẫn xuất nào (§13.2) và mọi lần `generate` sau đều **409 006** vĩnh viễn vì phiếu là append-only, không xoá được.
- **Cờ đã-sinh-phiếu đọc dưới row-lock:** `payroll_periods.payslips_generated_at/by` (DB-13 §6.3) là nguồn kiểm của `reopen`/`publish` — **không đếm bảng `payslips`** (đếm bảng khác không được row-lock bảo vệ).
- **Hai hành động chạy TẠI CHỖ, không đổi trạng thái**: `calculate` lại ở `Calculated` (ghi đè dòng nháp + snapshot mới) và `generate-payslips` ở `Approved`. Cả hai idempotent, chốt cuối ở DB.
- **`Locked` là terminal tuyệt đối** — không có đường ra. Bảng công tháng đó đã bất biến từ trước (§3.5); PAYROLL không dựng cổng thứ hai.
- **`reject`** đưa về `Calculated` (không về `CollectingData`) — người tính sửa dòng rồi gửi lại; **comment bắt buộc**, đi vào NOTI-EVENT-022.
- **`reopen`** cần cặp riêng `('reopen','payroll-period')` + **lý do bắt buộc** (ghi `reopen_reason`) + audit; bị chặn khi `payslips_generated_at IS NOT NULL` (**004** `payslip-already-generated`) vì `payslips` là bản ghi bất biến, không xoá được để tính lại.

**Bảng RESET vết duyệt theo chuyển tiếp — BẮT BUỘC, không để WO tự quyết:**

| Chuyển tiếp | Cột PHẢI xoá về NULL | Cột PHẢI ghi |
| --- | --- | --- |
| `collect` (`Draft → CollectingData`, hoặc tại chỗ) | `calculated_by/at` | — |
| `calculate` (`CollectingData → Calculated`, hoặc tại chỗ) | `submitted_by/at` | `calculated_by/at` |
| `submit` (`Calculated → Reviewing`) | — | `submitted_by/at` |
| `reject` (`Reviewing → Calculated`) | **`submitted_by/at`** | — *(comment vào audit + NOTI-022)* |
| `approve` (`Reviewing → Approved`) | — | `approved_by/at` |
| `generate-payslips` (tại `Approved`) | — | `payslips_generated_by/at` |
| `publish` (`Approved → Paid`) | — | `published_by/at` |
| `lock` (`Paid → Locked`) | — | `locked_by/at` |
| **`reopen`** (`{Calculated, Reviewing, Approved} → CollectingData`) | **`calculated_by/at` · `submitted_by/at` · `approved_by/at`** | `reopen_reason` (**GHI ĐÈ** — chỉ giữ lý do của lần mở lại gần nhất; lịch sử đầy đủ nằm ở `audit_logs`), `updated_by/at` |

> **Vì sao bảng này là BẮT BUỘC, không phải chi tiết thi công:** CHECK `payroll_periods_four_eyes_check` (`approved_by <> submitted_by`) sống ở DB. Nếu `reopen`/`reject` **không** xoá vết cũ thì kịch bản thật — admin A duyệt → `reopen` → tính lại → **A gửi duyệt** — vi phạm CHECK và trả **`23514`**, tức **500 ở vùng đỏ**. Xoá sai vế thì `payroll_periods_approved_pair_check` nổ. Cặp `published_*`/`locked_*` không bao giờ cần xoá vì `reopen` bị chặn từ `Paid`/`Locked`.

> **Đường thoát khi công ty chỉ có MỘT người duyệt (N=1 — có thật):** four-eyes ở tầng quyền + tầng service + CHECK DB khoá cả super-admin. Nếu company chỉ có một `company-admin` và **không** ai giữ `payroll-officer`, người đó tính + gửi duyệt rồi **không ai duyệt được**; `reopen` đưa về `CollectingData` nhưng **vòng lặp không thoát** — vẫn một người, submit lại vẫn không ai duyệt. ⇒ **`submit` kiểm TRƯỚC**: phải tồn tại ít nhất **một user khác actor** trong company là **người duyệt hợp lệ**; không có ⇒ **422 PAYROLL-ERR-017 `no-eligible-approver`** kèm hướng dẫn (gán `payroll-officer` cho người tính, hoặc thêm company-admin thứ hai). Fail-fast ở `submit` thay vì kẹt ở `Reviewing`.
>
> **Bộ giải «người duyệt hợp lệ» — MỘT định nghĩa dùng chung cho §13.1 và §17** (`PayrollApproverReader`, khuôn `asset-audience.reader.ts`): engine permission **không có tra ngược cặp → user**, nên giải bằng **JOIN SQL ở tầng ROLE**:
>
> ```sql
> user_roles ur ⋈ roles r ⋈ role_permissions rp ⋈ permissions p
> WHERE (p.action, p.resource_type) = ('approve','payroll-period') AND rp.effect = 'ALLOW'
>   AND ur.deleted_at IS NULL AND (ur.expires_at IS NULL OR ur.expires_at > now())
>   AND u.deleted_at IS NULL AND u.id <> :actorId
> ```
>
> Bộ giải này **bắt được cả role tuỳ biến** được cấp cặp `approve`, không chỉ `company-admin`. Không cần phủ bốn hình dạng wildcard vì `('approve','payroll-period')` là **`is_sensitive = true`** ⇒ wildcard `*:*` **không kế thừa được** nó. **Cố ý KHÔNG xét `object_permissions`**: bảng đó cấp quyền **theo từng đối tượng** (`object_id NOT NULL` — `0005:154-163`) nên không thể là nguồn quyền duyệt tổng quát; hệ quả duy nhất là một hàng `effect='DENY'` cấp-object có thể làm 017 cho qua rồi `approve` vẫn 403 — **kỳ không kẹt** vì §13.1 cho `reopen` từ `Reviewing`. **§17 (NOTI-EVENT-020) PHẢI dùng chính bộ giải này**, không tự tra role `company-admin` riêng — hai bộ giải lệch nhau đẻ đúng thất bại mà 017 sinh ra để chặn (017 cho qua nhưng không ai nhận thông báo).

### 13.2 Vòng đời phiếu lương (SPEC-01 §17.16) — trạng thái **DẪN XUẤT**

`payslips` **không có cột trạng thái**. Ba giá trị của §17.16 là **dẫn xuất** (cùng nguyên tắc `Overdue` của task, `Completed` của lượt đặt phòng), server tính trong DTO:

| Giá trị | Điều kiện dẫn xuất |
| --- | --- |
| `Generated` | có hàng `payslips` **và** kỳ ở `Approved` |
| `Published` | kỳ ở `Paid` hoặc `Locked` |
| `Acknowledged` | `Published` **và** có hàng `payslip_acknowledgements` của chính nhân sự đó |
| *(không nhánh nào khớp)* | **fail-closed**: DTO trả `status: null` + phiếu **không** lộ ra đường Own. Ca này chỉ xảy ra nếu kỳ tụt về `< Approved` khi đã có phiếu — trạng thái bất khả theo §13.1 (row-lock + cờ `payslips_generated_at`), nhưng **phải có nhánh mặc định**, không được `undefined` |

Lý do không lưu cột: phát hành là hành động **cấp kỳ** (một lần cho cả bảng lương), lưu cờ trên từng phiếu buộc phải UPDATE một bảng chỉ-INSERT — phá bất biến #2 vì một thông tin đã suy được từ `payroll_periods.status`. Nhân viên **không thấy** phiếu ở trạng thái `Generated` (`GET /me/payslips` lọc theo kỳ `Paid`/`Locked`).

### 13.3 FSM thưởng/phạt (SPEC-01 §17.17)

`Pending → Approved` · `Pending → Rejected`; hai đích là **terminal** (✗ ⇒ **PAYROLL-ERR-011**). Sửa nội dung/số tiền chỉ khi `Pending`; `Rejected` bắt buộc `decision_note`; **người quyết định ≠ người tạo** (⇒ **012**).

Chỉ hàng **`Approved` cùng `period_month`, chưa consume** mới được máy tính lương gộp vào; lúc gộp ghi `payroll_period_id` + `consumed_at` (**cặp NULL/NOT NULL** — CHECK) làm khoá chống cộng hai lần. Hàng đã consume **khoá sửa/xoá** (⇒ **013**); muốn đổi thì tạo hàng mới ở kỳ sau. Tính lại kỳ **chưa** `Approved` sẽ **nhả consume** của chính kỳ đó rồi gộp lại (cùng transaction) — không đụng hàng đã consume bởi kỳ khác.

### 13.4 Máy tính lương (PAYROLL-FUNC-006)

**Định nghĩa đầu vào — CHỐT ở đây, WO BE KHÔNG được tự phát minh:**

| Đại lượng | Nguồn | Công thức |
| --- | --- | --- |
| `work_days` (mẫu số pro-rate) | `companies.working_days_json` **khoá `->'days'`** + `public_holidays` | đếm ngày trong `period_month` có ISO-dow ∈ `working_days_json->'days'`, **trừ** ngày trong `public_holidays` thoả **đủ 4 vị từ** (xem dưới). Là **hằng chung cả kỳ**, không per-người |
| `present_days` **numeric(8,2)** | `attendance_records` + ngày nghỉ **có lương** đã duyệt (`leave_request_days`) | cộng theo NGÀY: mỗi ngày lấy `LEAST(GREATEST(công_ngày, phép_có_lương_ngày), 1)` — xem «Ngày nghỉ tính theo NỬA NGÀY» dưới |
| `paid_leave_days` / `unpaid_leave_days` **numeric(8,2)** | `leave_request_days` (đã vật chất hoá) ⋈ đơn đã duyệt ⋈ `leave_types.paid` | `SUM(leave_days)` của các ngày rơi vào `cal_work`, tách theo cờ `paid` |
| `late_minutes` | `attendance_records` | tổng phút trễ/về sớm trong kỳ |
| hệ số pro-rate | — | `LEAST(present_days / NULLIF(work_days, 0), 1)` — clamp trần 1 ở SQL |

**Vị từ SQL bắt buộc — viết đúng như sau, không nội suy:**

```sql
-- lịch làm việc: companies.working_days_json CÓ HÌNH DẠNG {"days":[1,2,3,4,5]} (mig 0015)
--   ⚠️ KHÁC work_schedules.working_days_json vốn là MẢNG TRẦN [1,2,3,4,5] (mig 0061) — đọc nhầm bảng
--      hoặc quên khoá 'days' ⇒ work_days = 0 ⇒ CẢ CÔNG TY rơi 422 PAYROLL-ERR-009.
jsonb_array_elements_text(c.working_days_json -> 'days')

-- ngày lễ trừ khỏi mẫu số — ĐỦ BỐN vị từ:
WHERE (h.company_id = $companyId OR h.company_id IS NULL)   -- ⚠️ hàng GLOBAL có company_id NULL (mig 0434);
                                                            --    lọc `= $companyId` là MẤT TOÀN BỘ lễ quốc gia
  AND h.status = 'Active'
  AND h.deleted_at IS NULL
  AND h.holiday_type <> 'WorkingDayOverride'                 -- loại này là ngày LÀM BÙ, trừ nó là trừ ngược
  AND h.is_paid_holiday = true
```

**Ngày nghỉ tính theo NỬA NGÀY — nguồn CHỐT ở đây (S13-PAYROLL-BE-1B, owner 2026-09-01):**

Số ngày nghỉ **KHÔNG phải số nguyên**. `leave_types` cho phép `HalfDay` (0.5 ngày) và `Hourly` (phân số bất kỳ) ⇒ ba đại lượng trên là `numeric(8,2)`, **không** `int`. Đếm `COUNT(DISTINCT ngày)` là làm tròn LÊN mọi buổi nghỉ thành nguyên ngày — sai thẳng vào tiền (mỗi buổi nghỉ không lương bị trừ trọn một ngày công).

| Nguồn | Phán quyết | Vì sao (**đo thật** 2026-09-01, đường ghi `LeaveRequestService.createDraft`) |
| --- | --- | --- |
| `leave_request_days` (Active, `deleted_at IS NULL`) | **THẮNG** | Mang số ngày **từng ngày** (`leave_days numeric(8,2)`: `0.50` cho nửa buổi, `0.38` cho 3 giờ) và có `is_working_day`. Ứng dụng ghi nó trong CÙNG transaction với đơn (`leave-request.service.ts:110`) ⇒ đơn nào do ứng dụng tạo cũng có. |
| `leave_requests.total_days` | **CHỈ đối soát** | (a) là con số của **cả đơn**: đơn 29/11→03/12 mang `5.0` trong khi kỳ tháng 11 chỉ được hưởng `2` — không quy kết được theo kỳ nếu không bung ngày; (b) `numeric(5,1)` làm tròn: đơn 3 giờ (0.375 ngày) bị lưu **`0.4`**. |

- **Khi một đơn đã duyệt KHÔNG có day-row Active nào** (dữ liệu di sản/nhập ngoài ứng dụng) ⇒ **rơi về** cách cũ: bung đơn trên `cal_work`, mỗi ngày `1.00`. Nguồn day-row **rỗng** ≠ **bằng 0**; đọc rỗng thành 0 là mất lặng lẽ một khoản tiền. Fallback ở **mức ĐƠN** (một đơn có day-rows thì day-rows quyết toàn bộ đơn đó) — KHÔNG trộn hai nguồn trong một đơn, kẻo đẻ ngày ma.
- **Một ngày vẫn chỉ đếm MỘT lần cho `present_days`**: dùng `GREATEST(công, phép có lương)` chứ không `SUM` — ngày vừa có bản ghi công vừa có phép nửa buổi có lương là **1**, không phải 1.5. Ngày **chỉ** có phép nửa buổi có lương là **0.5**. Trần `LEAST(…, 1)` chặn hai đơn nửa buổi cùng ngày đẩy một ngày vượt 1.
- **Hệ quả lên clamp:** `LEAST(present_days / NULLIF(work_days, 0), 1)` **giữ nguyên** — chỉ khác là tử số nay có thể lẻ (vd `20.5 / 22`). Clamp vẫn phải ở SQL.

```sql
-- ngày nghỉ: nguồn CHỐT là day-rows, giao với cal_work của PAYROLL
JOIN leave_request_days d ON d.leave_request_id = r.id
 AND d.deleted_at IS NULL AND d.status = 'Active'
JOIN cal_work cw ON cw.d = d.work_date
WHERE r.deleted_at IS NULL
  AND r.status = ANY (ARRAY['approved','Approved'])   -- ⚠️ CHECK union hoa/thường (mig 0453)
-- → SUM(d.leave_days) tách theo leave_types.paid
```

- **Quyết định tường minh — dùng lịch CẤP CÔNG TY (`companies.working_days_json`), không dùng `work_schedules`:** LEAVE đang đếm ngày nghỉ theo `work_schedules.working_days_json` (lịch cấp ca làm việc). Hai lịch khác nhau ⇒ tử số (`paid_leave_days` từ LEAVE) và mẫu số (`work_days` của PAYROLL) lệch nhau có hệ thống. v1 chấp nhận rủi ro này vì công ty đang chạy **một lịch duy nhất**; QA có **ca đối chứng** so `work_days` với số ngày LEAVE dùng, và rủi ro ghi ở §21. Nếu công ty có **hai `work_schedules` khác nhau** thì đây là **quyết định phải hỏi owner**, không phải chi tiết thi công.
- **Người vào/nghỉ việc giữa kỳ** không cần công thức riêng ở v1: `work_days` giữ nguyên là hằng của kỳ, còn `present_days` của họ tự nhiên thấp ⇒ pro-rate thấp đúng tỉ lệ. Quyết định này **tường minh** để WO BE không tự nội suy theo ngày vào/nghỉ.
- `work_days = 0` (kỳ toàn ngày nghỉ — bất thường) ⇒ `NULLIF` cho pro-rate `NULL` ⇒ service trả **422 PAYROLL-ERR-009** thay vì chia cho 0.
- **Cả năm đại lượng trên PHẢI có mặt trong `input_snapshot_json`** kèm nguồn (`workingDaysJson` đã dùng, danh sách ngày lễ đã trừ) — đó là thứ làm con số «giải thích được» sau nhiều tháng.

Thứ tự chạy trong **MỘT transaction** (mở bằng `SELECT … FROM payroll_periods … FOR UPDATE` — §13.1):

1. Kiểm cặp `('calculate','payroll-period')` + kỳ thuộc company (⇒ **010**).
2. Kiểm trạng thái: kỳ phải ở `CollectingData` hoặc `Calculated` (khác ⇒ **001**; ≥ `Approved` ⇒ **003**).
3. Kiểm `attendance_period_id` NOT NULL và kỳ công đó `locked` (⇒ **002**).
4. Nhả consume của **chính kỳ này** (`bonus_penalties` có `payroll_period_id = kỳ` → set NULL **cả cặp** `payroll_period_id`/`consumed_at`, kẻo vỡ `bonus_penalties_consumed_pair_check`). **KHÔNG đụng hàng đã consume bởi kỳ khác.**
5. Chọn tập nhân sự: có **hồ sơ lương hiệu lực** tại ngày cuối kỳ. Tập rỗng ⇒ **422 009**. Người thiếu hồ sơ lương / thiếu bản ghi công **không chặn** — vào danh sách cảnh báo (PAYROLL-FUNC-005).
6. **UPSERT** `payroll_period_lines` theo `(company_id, payroll_period_id, user_id)` bằng **một câu lệnh SQL set-based** (không vòng lặp per-người ở JS): pro-rate lương cơ bản, cộng phụ cấp, cộng thưởng `Approved` chưa consume, trừ phạt · ngày nghỉ không lương · trễ/sớm (nếu rule ATT bật), `net = GREATEST(gross − khấu trừ, 0)`; làm tròn `numeric(18,2)` **ở SQL**. Ghi `input_snapshot_json`.
   - **`adjustment_amount` CÓ DẤU** (dương = truy lĩnh/cộng thêm · âm = truy thu/trừ thêm) và **nằm NGOÀI `gross` lẫn `deduction_amount`** — vì `gross`/`deduction` đều bị CHECK `>= 0` nên gộp vào là không biểu diễn được khoản điều chỉnh âm/dương. Công thức đóng: **`net = GREATEST(gross − deduction_amount + adjustment_amount, 0)`** (ở SQL).
   - **`adjustment_amount` và `adjustment_reason` của dòng cũ được GIỮ NGUYÊN qua UPSERT** — đó là số người dùng nhập tay, tính lại **không được xoá âm thầm**. Dòng của nhân sự **không còn đủ điều kiện** thì **xoá mềm** (`deleted_at`), không hard-delete.
   - FE hiện băng cảnh báo «N dòng có điều chỉnh tay được giữ lại» sau mỗi lần tính lại (§14).
7. Bind consume cho các hàng thưởng/phạt vừa gộp; `status` kỳ → `Calculated`; ghi `calculated_by/at`, **xoá `submitted_by/at`** (§13.1 bảng RESET); **audit trước, enqueue outbox sau** (dedupeKey của §17 dùng `auditLogId` nên hàng audit phải có id trước khi enqueue trong cùng tx).

**Sinh phiếu lương** (`generate-payslips`, tại `Approved`, dưới row-lock):

1. Đọc cờ `payslips_generated_at` **trên chính hàng kỳ đang khoá**. Đã set ⇒ **no-op, trả 200** (idempotent — gọi lần hai không phải lỗi).
2. Copy từng dòng nháp còn sống → một hàng `payslips` (**bao gồm cột `adjustment_amount`** — DB-13 §6.5) + n hàng `payslip_items`, một dòng cho mỗi khoản có số tiền ≠ 0, kèm `sort_order`. **`payslip_items.amount` CÓ DẤU** (earning/allowance/bonus dương · deduction/attendance/penalty âm · `adjustment` theo dấu người nhập) ⇒ bất biến kiểm được: **`SUM(payslip_items.amount) = gross − deduction_amount + adjustment_amount`**, và `net = GREATEST(tổng đó, 0)`.
3. Ghi `payslips_generated_by/at` trên kỳ, **cùng transaction**.

Vi phạm `UNIQUE (company_id, payroll_period_id, user_id)` — chỉ xảy ra khi **hai node race qua được row-lock** — ⇒ bóc `23505` từ `cause`, map **409 006**, rollback toàn bộ.

### 13.5 Data scope

| Đối tượng | Own | Company |
| --- | --- | --- |
| Kỳ lương · dòng bảng lương · hồ sơ lương · thưởng/phạt | *(không dùng — mọi grant đều Company)* | toàn bộ |
| Phiếu lương | phiếu có `user_id` = user của caller (`view-own-payslip` · `acknowledge-own-payslip`) | toàn bộ (`view-payslip`) |
| Cổng nav `access:payroll` | Own cho mọi role | — |

Ngoài scope → **404 PAYROLL-ERR-010** (không 403). **Caller không có hồ sơ nhân sự / không có phiếu**: `GET /me/payslips` trả **rỗng** (fail-closed, không lỗi — chuẩn `/me/assets`). Có ca test riêng (§21).

---

## 14. Trạng thái UI bắt buộc

Mọi màn PAYROLL phải xử lý: **loading** (skeleton bảng) · **error** (thông điệp + thử lại) · **empty** («chưa có kỳ lương nào» / «chưa có phiếu lương nào») · **không có quyền** (ẩn bằng `<PermissionGate>`) · **hành động bị FSM chặn** (nút không hiện thay vì hiện rồi 409 — «Duyệt» ẩn với chính người gửi duyệt, «Mở lại» ẩn khi kỳ đã sinh phiếu) · **409 từ server** (race: thông điệp + tải lại, không mất form) · **cảnh báo dữ liệu thiếu** (hộp riêng, không chặn nút tính) · **băng cảnh báo sau khi tính lại** («N dòng có điều chỉnh tay được giữ lại» — §13.4) · **số tiền** dùng `tabular-nums` + định dạng VND.

> **Không có trạng thái «ô tiền bị che» ở v1.** Gating là **cấp route**, không phải cấp trường: người thiếu cặp chở-tiền không mở được màn/khối đó chứ không nhận DTO nửa-mask (§11.1). FE vẫn khai `.optional()` cho mọi trường tiền như phòng thủ chiều sâu, nhưng **không dựng UI 🔒 per-row và không viết test cho nhánh đó** — sẽ là ca xanh-rỗng.

---

## 15. Yêu cầu API cấp SPEC

Envelope/error/pagination theo API-01. Chi tiết: [API-18](<../API Design/API-18_PAYROLL_API_Design.md>). Mọi `:id` là **UUID** ở biên (pipe cấp method — `nestjs-zod-class-level-pipe-does-nothing`). Prefix `/api/v1`.

| Mã | Endpoint | Cặp quyền | Ghi chú |
| --- | --- | --- | --- |
| PAYROLL-API-001 | `GET /payroll-periods` | `('view','payroll-period')` | filter `status[]` · `periodMonth` · `from,to`; pagination; **không số tiền** |
| PAYROLL-API-002 | `POST /payroll-periods` | `('manage','payroll-period')` | `{ periodMonth, attendancePeriodId? }`; trùng tháng ⇒ 008; `Idempotency-Key`; audit |
| PAYROLL-API-003 | `GET /payroll-periods/:id` | `('view','payroll-period')` | chi tiết kỳ + vết duyệt + đếm nhân sự — **không số tiền** |
| PAYROLL-API-004 | `PATCH /payroll-periods/:id` | `('manage','payroll-period')` | gắn/đổi `attendancePeriodId` · `note`; chỉ khi `Draft`/`CollectingData` (khác ⇒ 001); **không** nhận `status`; audit |
| PAYROLL-API-005 | `POST /payroll-periods/:id/collect` | `('calculate','payroll-period')` | `Draft → CollectingData` (hoặc gom lại tại chỗ); audit |
| PAYROLL-API-006 | `GET /payroll-periods/:id/readiness` | `('calculate','payroll-period')` | cảnh báo dữ liệu thiếu: danh sách nhân sự thiếu hồ sơ lương / thiếu công (PAYROLL-FUNC-005) |
| PAYROLL-API-007 | `POST /payroll-periods/:id/calculate` | `('calculate','payroll-period')` | §13.4; kỳ công chưa `locked` ⇒ 002; kỳ ≥ `Approved` ⇒ 003; `Idempotency-Key`; audit |
| PAYROLL-API-008 | `GET /payroll-periods/:id/lines` | **`('view-line','payroll-period')`** | bảng lương nháp **CÓ SỐ TIỀN** — cặp ĐỌC nhạy cảm (§11.1), **ghi audit lượt đọc**; pagination. Người duyệt đọc được bảng lương bằng cặp này mà không cần cặp ghi |
| PAYROLL-API-009 | `PATCH /payroll-periods/:id/lines/:lineId` | `('calculate','payroll-period')` | `{ adjustmentAmount, adjustmentReason }` — lý do bắt buộc; chỉ khi kỳ `Calculated` (⇒ 003); audit |
| PAYROLL-API-010 | `POST /payroll-periods/:id/submit` | `('calculate','payroll-period')` | `Calculated → Reviewing`; ghi `submitted_by/at`; **kiểm có người duyệt hợp lệ khác actor** (⇒ 422 **017**); NOTI-EVENT-020; audit |
| PAYROLL-API-011 | `POST /payroll-periods/:id/approve` | `('approve','payroll-period')` | `Reviewing → Approved`; **four-eyes** (⇒ 005); NOTI-EVENT-021; audit |
| PAYROLL-API-012 | `POST /payroll-periods/:id/reject` | `('approve','payroll-period')` | `{ comment }` **bắt buộc**; `Reviewing → Calculated`; **xoá `submitted_by/at`** (§13.1); NOTI-EVENT-022; audit |
| PAYROLL-API-013 | `POST /payroll-periods/:id/generate-payslips` | `('publish','payroll-period')` | tại `Approved`, không đổi trạng thái; §13.4; ghi cờ `payslips_generated_by/at`; race ⇒ 006; `Idempotency-Key`; audit |
| PAYROLL-API-014 | `POST /payroll-periods/:id/publish` | `('publish','payroll-period')` | `Approved → Paid`; chưa sinh phiếu ⇒ 007; NOTI-EVENT-023 từng nhân sự; audit |
| PAYROLL-API-015 | `POST /payroll-periods/:id/lock` | `('manage','payroll-period')` | `Paid → Locked`; khoá đường chỉnh công ATT tháng đó; audit |
| PAYROLL-API-016 | `POST /payroll-periods/:id/reopen` | `('reopen','payroll-period')` | `{ reason }` **bắt buộc**; → `CollectingData`; `payslips_generated_at IS NOT NULL` ⇒ 004; **xoá `calculated_*`/`submitted_*`/`approved_*`** (§13.1 bảng RESET); audit |
| PAYROLL-API-017 | `GET /payroll-periods/:id/export` | `('export','payroll')` **+ `('view-line','payroll-period')`** (§18) | XLSX bảng lương kỳ; **audit bắt buộc**; > 10.000 dòng ⇒ 422 (016) |
| PAYROLL-API-018 | `GET /payroll-periods/summary` | **`('view-line','payroll-period')`** **+ SÀN scope Company** | tổng gross/net + headcount + trạng thái kỳ gần nhất — nguồn widget DASH; route khai **TRƯỚC** `/payroll-periods/:id` |
| PAYROLL-API-019 | `GET /salary-profiles` | `('view','salary-profile')` | filter `userId` · `effectiveOn`; pagination; **audit lượt đọc**; mask theo quyền |
| PAYROLL-API-020 | `POST /salary-profiles` | `('manage','salary-profile')` | `{ userId, effectiveDate, baseSalary, allowances[], note? }`; trùng ngày ⇒ 014; `Idempotency-Key`; audit |
| PAYROLL-API-021 | `GET /salary-profiles/:id` | `('view','salary-profile')` | chi tiết một phiên bản; **audit lượt đọc** |
| PAYROLL-API-022 | `PATCH /salary-profiles/:id` | `('manage','salary-profile')` | sửa số tiền/ghi chú/ngày hiệu lực · xoá mềm (`{ delete: true }`); **không** đụng phiếu đã phát hành (snapshot đóng băng); audit |
| PAYROLL-API-023 | `GET /bonus-penalties` | `('view','bonus-penalty')` | filter `periodMonth` · `status[]` · `kind` · `userId`; pagination |
| PAYROLL-API-024 | `POST /bonus-penalties` | `('manage','bonus-penalty')` | `{ userId, kind, amount, periodMonth, reason }` — `reason` bắt buộc; `Idempotency-Key`; audit |
| PAYROLL-API-025 | `GET /bonus-penalties/:id` | `('view','bonus-penalty')` | chi tiết |
| PAYROLL-API-026 | `PATCH /bonus-penalties/:id` | `('manage','bonus-penalty')` | sửa · xoá mềm — chỉ khi `Pending` (⇒ 011); đã consume ⇒ 013; audit |
| PAYROLL-API-027 | `POST /bonus-penalties/:id/approve` | `('approve','bonus-penalty')` | tự duyệt ⇒ 012; audit |
| PAYROLL-API-028 | `POST /bonus-penalties/:id/reject` | `('approve','bonus-penalty')` | `{ note }` **bắt buộc**; audit |
| PAYROLL-API-029 | `GET /payslips` | `('view-payslip','payslip')` | filter `payrollPeriodId` · `userId`; pagination; **audit lượt đọc** |
| PAYROLL-API-030 | `GET /payslips/:id` | `('view-payslip','payslip')` | phiếu + dòng chi tiết + trạng thái dẫn xuất (§13.2); **audit lượt đọc** |
| PAYROLL-API-031 | `GET /me/payslips` | `('view-own-payslip','payslip')` | Own — chỉ kỳ `Paid`/`Locked`; caller không có phiếu ⇒ danh sách rỗng |
| PAYROLL-API-032 | `GET /me/payslips/:id` | `('view-own-payslip','payslip')` | Own — breakdown giải-thích-được; phiếu người khác ⇒ **404** (010) |
| PAYROLL-API-033 | `POST /me/payslips/:id/acknowledge` | `('acknowledge-own-payslip','payslip')` | Own; kỳ chưa `Paid` ⇒ 015 `payslip-not-published`; lần hai ⇒ 015 `already-acknowledged` |
| PAYROLL-API-034 | `GET /payroll/pickers/people` | `('view','salary-profile')` | danh bạ chọn nhân sự: `?q=&limit=` → `{ userId, fullName, employeeCode? }` người còn sống trong company — qua **điểm chiếu danh tính duy nhất** (§18); role `payroll-officer` **không có cặp HR** nên KHÔNG dùng API-03 |
| PAYROLL-API-035 | `GET /payroll/pickers/attendance-periods` | `('manage','payroll-period')` | danh sách kỳ công để gắn vào kỳ lương: `?status=&limit=` → `{ id, periodMonth, status }` — **bắt buộc** vì `GET /attendance/periods` gác bằng `('read','attendance')` mà `payroll-officer` **không có cặp ATT nào** (§11.1 §9g: 0 cặp ngoài PAYROLL); thiếu route này thì `PAYROLL-API-002/004` không dùng được (đúng lớp lỗi RECRUIT B4). Trường bó hẹp, qua cùng repository chiếu |

> **35 mã = 35 route HTTP** (không mã nào gói 2 route). Route-census đếm route — WO BE regen với 35, khai `API_MODULE_TAGS` cho `PAYROLL`. Hai route tĩnh `summary` (018) và `readiness` (006 — dưới `:id` nên an toàn) khai đúng thứ tự: **`/payroll-periods/summary` phải đứng TRƯỚC `/payroll-periods/:id`** (bài học `goals/tree`).
>
> **Hai picker là bắt buộc, không phải tiện nghi** — `payroll-officer` giữ **0 cặp ngoài PAYROLL** (§9g), nên mọi lựa-chọn-tham-chiếu phải có đường riêng: `034` (nhân sự, gác `('view','salary-profile')`) và `035` (kỳ công, gác `('manage','payroll-period')`). §11.1 bảo đảm **mọi role giữ `('manage','bonus-penalty')` đều giữ `('view','salary-profile')`** — migration seed verify fail-loud, để màn thưởng/phạt không chết vì thiếu danh bạ.
>
> ⚠️ **Ratchet route-HTTP là cổng KHÁC route-census:** `apps/api/test/foundation/route-http-coverage.e2e-spec.ts` đặt `MAX_UNCOVERED_TOTAL = 0` và `MIN_COVERED_COUNT` là **SÀN**; từ khoá `salary`/`payslip` xếp nhóm PAYROLL vào rủi ro cao ⇒ **mọi route mới phải có file test chạm đúng literal path**, và phải **siết `MIN_COVERED_COUNT` cùng commit** với WO BE.

---

## 16. Dữ liệu và lưu trữ

Nguồn chuẩn: [DB-13](<../DB/DB-13 PAYROLL Database Design.md>). Tóm tắt:

- **6 bảng reconcile** (`salary_profiles` · `payroll_periods` · `payslips` · `payslip_items` · `bonus_penalties` · `payslip_acknowledgements`) + **1 bảng mới** `payroll_period_lines` — RLS + FORCE (di sản đã có, verify lại), composite tenant FK **bổ sung** cho band G12 (ra đời trước khuôn `0535`), soft delete ở `salary_profiles`/`payroll_periods`/`bonus_penalties`/`payroll_period_lines`.
- **3 bảng chỉ-INSERT**: `payslips` · `payslip_items` (giữ nguyên khuôn append-only di sản) và `payslip_acknowledgements` (**thu GRANT UPDATE** — sổ xác nhận, không sửa). Không bảng PAYROLL nào có DELETE cho app role.
- **Chốt cuối ở DB**: `UNIQUE (company_id, payroll_period_id, user_id)` trên `payslips` (sinh hai lần) · `UNIQUE (company_id, payroll_period_id, user_id) WHERE deleted_at IS NULL` trên `payroll_period_lines` (**partial** — tính lại xoá mềm dòng cũ, unique thẳng sẽ nổ `23505` ở lần tính thứ hai; mọi JOIN dòng nháp phải lọc `deleted_at IS NULL`, bẫy `partial-unique-index-makes-join-duplicate`) · `UNIQUE (company_id, user_id, effective_date) WHERE deleted_at IS NULL` trên `salary_profiles` · `UNIQUE (company_id, period_month) WHERE deleted_at IS NULL` trên `payroll_periods` · `UNIQUE (company_id, payslip_id, user_id)` trên xác nhận · **CHECK four-eyes** `approved_by <> submitted_by`.
- Seed đi kèm (**DB-13 §10**): giữ hàng module `PAYROLL` **inactive** (bật ở WO FE) · role `payroll-officer` (`…0015`, **2FA**) · **GỠ 16 cặp di sản + mọi grant ở CẢ BA bảng `permissions`/`role_permissions`/`object_permissions`** rồi seed **17 cặp mới + 32 grant §9g** · UNION-ADD **chỉ giá trị còn thiếu** vào CHECK `audit_logs.object_type` · catalog + template **4 event NOTI** §17 `dedupe_strategy='DedupeKey'` + nới CHECK `module_code`/`notification_type` trên **CẢ HAI bảng** `notification_events` và `notifications`.
- **Teardown test**: `payroll_period_lines` là bảng MỚI ⇒ thêm vào `cleanupTenants()` đúng thứ tự con→cha **cùng commit** với migration (`drop-table-must-clean-test-teardown`); 6 bảng di sản kiểm lại đã có mặt.
- Migration nối tiếp head **THẬT** lúc chạy (`_journal.json`; head lúc viết = idx 230 / `0563` ⇒ dự kiến `0564+`). **Band di sản `0091`–`0180` bất khả xâm phạm** — mọi thay đổi bằng migration MỚI.

---

## 17. Sự kiện và thông báo

| Event code | Mã chuẩn (SPEC-01 §20.2 · SPEC-08 §15.0) | Khi nào | Người nhận | Dedupe |
| --- | --- | --- | --- | --- |
| `PAYROLL_PERIOD_SUBMITTED` | NOTI-EVENT-020 | kỳ lương gửi duyệt (commit) | **người duyệt hợp lệ** theo `PayrollApproverReader` — CÙNG bộ giải với PAYROLL-ERR-017 (§13.1), `recipient.mode='UserIds'`, trừ actor. **KHÔNG tự tra role `company-admin` riêng** | `PAYROLL_PERIOD_SUBMITTED:{periodId}:{auditLogId}` — **mỗi LẦN gửi là một sự kiện** (reject → sửa → gửi lại phải báo lại; engine `DedupeKey` là once-ever, không có bucket thời gian) |
| `PAYROLL_PERIOD_APPROVED` | NOTI-EVENT-021 | kỳ được duyệt | `submitted_by` (người gửi duyệt), trừ actor | `PAYROLL_PERIOD_APPROVED:{periodId}:{auditLogId}` |
| `PAYROLL_PERIOD_REJECTED` | NOTI-EVENT-022 | kỳ bị từ chối | `submitted_by`, trừ actor | `PAYROLL_PERIOD_REJECTED:{periodId}:{auditLogId}` |
| `PAYSLIP_PUBLISHED` | NOTI-EVENT-023 | phát hành phiếu lương (`Approved → Paid`, commit) | **từng nhân sự có phiếu** trong kỳ (`payslips.user_id`), trừ actor | `PAYSLIP_PUBLISHED:{payslipId}` (một phiếu báo đúng một lần) |

- `notification_type = 'Payroll'`, `module_code = 'PAYROLL'`, `priority` Normal (020/021) · High (022/023), `isEnabled=true`, `isSystemEvent=false` cả 4 — **PAYROLL v1 không có system job** (mọi event đều event-driven; nhắc chốt kỳ = Phase sau nếu cần).
- **`dedupe_strategy = 'DedupeKey'`** ngay seed đầu cho cả 4 (mặc định `'None'` biến `dedupeKey` thành chuỗi trang trí — bài học `0479`/`0507`/`0538`).
- **Payload TUYỆT ĐỐI KHÔNG chứa số tiền** — chỉ `periodMonth` + tên kỳ + lý do từ chối (022) + liên kết (`/payroll/periods/:id` cho 020/021/022, `/me/payslips` cho 023). Đây là ràng buộc mạnh hơn các module khác: NOTI đi qua nhiều kênh và không có tầng masking riêng.
- Phát qua **OutboxNotificationBridge** (enqueue trong transaction; **audit ghi TRƯỚC, enqueue SAU** — dedupeKey dùng `auditLogId`). `registerSource()` fail-loud lúc boot ⇒ seed NOTI (**DB-13 §10 bước C**) phải merge **trước** khi WO BE đăng ký registrar.
- Đo dải mã chuẩn ngày 31/08/2026: SPEC-01 §20.2 dừng ở **NOTI-EVENT-019** (ASSET 010–012 · ROOM 013–015 · RECRUIT 016–019). PAYROLL cấp tiếp **020–023**; module sau lấy **024+** — **đo lại bằng grep `NOTI-EVENT-0` trước khi cấp**, không mặc định còn trống.

---

## 18. Audit và bảo mật

- **RLS + FORCE** theo `company_id` trên cả 7 bảng (6 bảng di sản đã có — **verify lại**, không giả định); mọi repository qua `withTenant`; composite tenant FK bổ sung cho band G12.
- **Sổ append-only**: `payslips` · `payslip_items` · `payslip_acknowledgements` — app role **không** UPDATE/DELETE (bất biến #2). Không bảng PAYROLL nào có DELETE cho app role. Danh sách bảng append-only ở `erd-current` §9 cập nhật khi build.
- **Che số lương ở server (PAY-DEC-006 / Phương án B):**
  - Trường tiền (`baseSalary`, `allowances`, `gross`, `net`, `deduction*`, `bonus*`, `penalty*`, `amount`) **chỉ có mặt** trong DTO khi caller giữ cặp tương ứng; ngược lại **vắng khoá** (không `null`, không `0`) — FE schema `.optional()`.
  - Danh sách kỳ lương (`view:payroll-period`, không nhạy cảm) **không chở số tiền nào** — kể cả tổng. Tổng đi qua `summary` (018) gác bằng cặp nhạy cảm `('view-line','payroll-period')`.
  - Export: assert **CẢ HAI cặp** `('export','payroll')` **VÀ** `('view-line','payroll-period')`; **audit** một hàng (`object_type='payroll_period'`, payload = kỳ + bộ lọc + số dòng, **không** kèm số tiền); quá 10.000 dòng ⇒ **422 (016)**.
  - **Audit lượt ĐỌC** (khuôn reveal + audit **atomic** của `hr-read.service` — ghi audit trong cùng transaction với lượt đọc, rollback ⇒ 0 audit): `GET /payroll-periods/:id/lines` · `GET /payroll-periods/summary` · `GET /payslips` · `GET /payslips/:id` · `GET /salary-profiles` · `GET /salary-profiles/:id` · `GET /payroll-periods/:id/export` — **7 đường**. **`GET /me/payslips*` KHÔNG ghi audit lượt đọc** — người xem lương của chính mình không phải sự kiện an ninh (và ghi thì đẻ nhiễu che mất lượt xem thật sự đáng ngờ).
  - **Object-permission (`0180` đã chốt):** `view-own-payslip` và `acknowledge-own-payslip` khai **`objectGrantRequired = false`** tường minh ở service — để mặc định thì nhân viên có company-grant vẫn **403 trên phiếu của chính mình**. `view-payslip` giữ ngữ nghĩa object-permission override hiện hành (`permission-admin` cho phép cấp/thu theo từng đối tượng).
- **Điểm chiếu danh tính DUY NHẤT** (khuôn ROOM `room-people.repository` / RECRUIT `recruit-people.repository`): mọi JOIN/picker sang HR/AUTH (tên nhân sự trên bảng lương, danh bạ `PAYROLL-API-034`) đi qua đúng **một** `PayrollPeopleRepository` — trường trả về giới hạn `{ userId, fullName, employeeCode?, orgUnitName? }`. Không service nào tự JOIN `users`/`employee_profiles` lấy thêm trường.
- **404 chứ không 403** cho đối tượng ngoài scope/tenant (PAYROLL-ERR-010); **403** chỉ khi thiếu cặp quyền.
- **13 cặp sensitive** khai **allowlist capability ở BACKEND** cùng WO BE (`capability-allowlist-hides-admin-screens`). Sau seed, `SuperAdminBootstrapService` phải giải được đúng 13 cặp sensitive mới (wildcard `*:*` không thoả cổng sensitive — tiền lệ `leave-audit.service`).
- **`mediaos_worker` không có system job nào đọc bảng lương ở v1** (đo 31/08/2026: 0 route, 0 handler) ⇒ **thu hồi `SELECT` của worker trên `salary_profiles`/`payroll_period_lines`/`payslips`/`payslip_items` NGAY Ở WO DB**, không đẩy sang BE (DB-13 §10 bước A). Quyền đọc trên bảng lương không nên trôi qua nhiều WO.
- **Role `payroll-officer` bắt buộc 2FA** (`requires_two_factor = true`) — người vận hành lương phải qua bước hai. Ghi nhận cho vận hành: script/automation chạy bằng tài khoản có role này **phải đi bước-2** (memory `prod-2fa-blocks-headless-automation`).
- Guard cặp quyền tồn tại ở **HAI tầng** (decorator route + service) — census QA so **TỪNG ROUTE theo MÃ cặp** ở cả hai tầng (bài học ASSET coverage 97.5% vẫn lọt mã lỗi 0 ca).

---

## 19. Non-functional requirements

- Tính lương cho 500 nhân sự < 5s (một câu lệnh SQL set-based per kỳ, **không vòng lặp per-người ở JS**); bảng lương 500 dòng lọc/phân trang < 300ms (index `(company_id, payroll_period_id)` — DB-13 §6).
- Chi tiết phiếu lương (phiếu + dòng + đầu vào) **một truy vấn** chính (không N+1); `summary` một `GROUP BY` trên `payroll_period_lines`/`payslips`.
- Export XLSX stream theo trang, chặn > 10.000 dòng/lần — **422 PAYROLL-ERR-016** gợi ý thu hẹp bộ lọc.
- **TZ & biên kỳ**: cắt kỳ tháng làm ở **BE** (UTC-at-rest; FE **không có** `companies.timezone` — `fe-has-no-company-timezone`); có ca test cuối tháng + pro-rate giữa kỳ (người vào/nghỉ giữa tháng).
- i18n: nhãn qua react-i18next namespace `payroll`; trạng thái hiển thị từ constants chuẩn SPEC-01 §17.15–17.17; số tiền định dạng VND + `tabular-nums`.

---

## 20. Tiêu chí nghiệm thu tổng quát

1. Tạo hồ sơ lương cho nhân sự A (hiệu lực 01/09) → tạo phiên bản thứ hai cùng ngày ⇒ **409 PAYROLL-ERR-014**; hiệu lực 01/10 ⇒ 200, lịch sử có 2 phiên bản.
2. Tạo kỳ lương 09/2026 → tạo lại cùng tháng ⇒ **409 008**. Gắn kỳ công 09/2026 đang `open` → `calculate` ⇒ **409 002 `attendance-not-locked`**; khoá kỳ công rồi tính lại ⇒ 200.
3. `readiness` liệt kê đúng nhân sự thiếu hồ sơ lương / thiếu công (cảnh báo mềm); công ty **không ai** có hồ sơ lương ⇒ `calculate` trả **422 009**.
4. Bảng lương tính ra khớp **từng đồng** với fixture tính tay (pro-rate 18/22 ngày công, 1 phụ cấp, 2 ngày nghỉ không lương, 1 thưởng `Approved`, 1 phạt) — đối chiếu cả `gross`, `deduction`, `net` và tổng các `payslip_items`.
5. Thưởng/phạt: tạo bởi officer X → X tự duyệt ⇒ **409 012**; admin duyệt ⇒ 200; sửa sau khi đã gộp vào kỳ ⇒ **409 013**; sửa hàng `Rejected` ⇒ **409 011**.
6. Officer X gửi duyệt → **X không thấy nút Duyệt** và gọi `approve` ⇒ **403** (không có cặp); admin duyệt ⇒ 200 + X nhận `PAYROLL_PERIOD_APPROVED`. Admin **tự gửi duyệt rồi tự duyệt** ⇒ **409 005 `same-actor-approval`**.
7. Sau `Approved`: `calculate` lại ⇒ **409 003**; điều chỉnh dòng ⇒ **409 003**; `reopen` khi **chưa** sinh phiếu ⇒ 200 (lý do vào audit); sinh phiếu rồi `reopen` ⇒ **409 004 `payslip-already-generated`**.
8. `generate-payslips` → mỗi nhân sự đúng **1** phiếu; gọi lần hai ⇒ 0 phiếu mới (idempotent); **hai request song song ⇒ đúng 1 thắng**, request kia **409 006**, không 500. `publish` khi chưa sinh ⇒ **409 007**.
9. `publish` → mỗi nhân sự nhận `PAYSLIP_PUBLISHED`; nhân viên B mở `/me/payslips` thấy phiếu của mình, mở `/me/payslips/{phiếu của C}` ⇒ **404 010**; xác nhận ⇒ 200, xác nhận lần hai ⇒ **409 015**. Trước khi publish, `/me/payslips` **rỗng** dù phiếu đã sinh (§13.2).
10. Chỉnh công tháng đó phía ATT bị từ chối **từ trước khi có kỳ lương** (kỳ công đã `locked` là điều kiện của `calculate`, và `locked → open` bị trigger `0064` chặn) — nghiệm thu là **kiểm chứng trạng thái đó vẫn đúng**, KHÔNG phải kiểm một cổng mới của PAYROLL (§3.5). `lock` kỳ lương ⇒ mọi chuyển tiếp từ `Locked` ⇒ **409 001**.
11. Deny-path: `hr-manager` gọi **mọi** route PAYROLL ⇒ **403** (sau thu hồi §11.2), **mỗi cặp có ca ALLOW đối chứng**; `employee` gọi `GET /payslips` ⇒ 403 nhưng `GET /me/payslips` ⇒ 200; `manager` ⇒ 403 toàn bộ. **Chủ thể = role dựng trong test, không SA**. Cross-tenant: mọi `:id` của company khác ⇒ **404** (int-spec `LANE_DB`).
12. Masking: `view:payroll-period` mở `GET /payroll-periods/:id` ⇒ DTO **không có khoá tiền nào**; cùng caller gọi `/lines` ⇒ **403**. `GET /payroll-periods/:id/lines` + `/payslips/:id` + `/salary-profiles` mỗi lượt ⇒ `audit_logs` **+1 hàng**, payload **không có số tiền**; `/me/payslips` ⇒ **+0 hàng audit**. Export thiếu một trong hai cặp ⇒ 403.
13. Widget «chi phí lương kỳ» hiện đúng tổng gross/net + headcount cho officer/admin; **employee/HR không thấy widget** (không gọi API); grant scope hẹp hơn `Company` ⇒ không được serve (sàn scope).
14. Sau seed: `hr-manager` giữ **0 cặp PAYROLL trên CẢ BA bảng** `permissions`/`role_permissions`/`object_permissions`; 16 cặp di sản đã GỠ có **0 hàng** ở cả ba bảng; `SuperAdminBootstrapService` giải đúng **13 cặp sensitive** mới; role `payroll-officer` có `requires_two_factor = true`; **mọi role giữ `approve:payroll-period` đều giữ `view-line:payroll-period`**.
15. **Reopen không đẻ 500:** admin A duyệt kỳ → `reopen` (lý do) → tính lại → **A gửi duyệt lại** ⇒ **200** (vết cũ đã bị xoá theo bảng RESET §13.1), admin B duyệt ⇒ 200. Không có `23514` lọt ra ngoài dạng 500.
16. **Không kẹt khi thiếu người duyệt:** company chỉ có một `company-admin` và không ai giữ `payroll-officer` → `submit` ⇒ **422 PAYROLL-ERR-017 `no-eligible-approver`** (kỳ vẫn ở `Calculated`, không kẹt ở `Reviewing`).
17. **Tính lại giữ điều chỉnh tay:** nhập `adjustmentAmount` + lý do cho 2 dòng → `calculate` lại ⇒ hai dòng **vẫn còn** khoản điều chỉnh và lý do, `gross`/`net` tính lại đã bao gồm; FE hiện băng «2 dòng có điều chỉnh tay được giữ lại».
18. **Người duyệt đọc được bảng lương:** caller chỉ có `approve` + `view-line` (không có `calculate`) mở `GET /payroll-periods/:id/lines` ⇒ **200**; gọi `POST …/calculate` ⇒ **403**. Ca đối chứng: caller chỉ có `calculate` gọi `approve` ⇒ **403**.
19. **Picker kỳ công:** `payroll-officer` gọi `GET /attendance/periods` ⇒ **403** (không có cặp ATT) nhưng `GET /payroll/pickers/attendance-periods` ⇒ **200** — chứng minh `PAYROLL-API-002/004` dùng được.

---

## 21. Test scenario cấp cao

| Nhóm | Scenario |
| --- | --- |
| Deny-path (RED trước) | thiếu từng cặp trong 17 cặp → 403 trên endpoint tương ứng, **mỗi cặp có ca ALLOW đối chứng** (deny không rỗng nghĩa — `deny-cases-vacuous-without-allow-case`); `hr-manager` 403 **toàn bộ** route (chốt thu hồi §11.2); cross-tenant mọi endpoint → 404; chủ thể = role dựng trong test |
| Four-eyes | officer thiếu cặp `approve` → 403; admin vừa submit vừa approve → 409 **005**; hai người khác nhau → 200; ca ALLOW đối chứng cho cả hai nhánh. **`reopen` rồi cùng-actor submit lại → 200** (bảng RESET §13.1 đã xoá vết) — nếu ra 500 thì `23514` chưa được map. **Company chỉ có 1 người duyệt → `submit` trả 422 017**, kỳ vẫn ở `Calculated` |
| FSM kỳ | mọi ô ✗ ở §13.1 → **409 001**; `reopen` sau generate → **004**; `calculate`/điều chỉnh sau `Approved` → **003**; `publish` trước generate → **007**; census mã lỗi **theo MÃ** — không mã nào 0 ca |
| Đối soát số | fixture tính tay khớp **từng đồng** (pro-rate · phụ cấp · phép có/không lương · trễ · thưởng · phạt · điều chỉnh tay **cả dấu âm lẫn dương**); ca `net` bị clamp về 0 khi khấu trừ > gross; ca làm tròn `.005`; **cấm số thực JS** — assert **`SUM(payslip_items.amount) = gross − deduction_amount + adjustment_amount`** và `net = GREATEST(tổng đó, 0)`. Thêm ca **`work_days`**: lịch công ty `{"days":[1..5]}` + 1 ngày lễ `is_paid_holiday` + 1 hàng `WorkingDayOverride` + 1 lễ GLOBAL (`company_id IS NULL`) ⇒ mẫu số đúng con số tính tay (bốn vị từ §13.4) |
| Rò tiền qua route GHI | `collect`/`calculate`/`adjust-line` trả envelope **KHÔNG có khoá tiền nào**; role có `calculate` mà không `view-line` gọi `GET …/lines` ⇒ **403** và không đọc được số qua bất kỳ route ghi nào (§11.1) |
| Lịch LEAVE ≠ lịch PAYROLL | ca đối chứng: số ngày LEAVE đếm (theo `work_schedules`) khớp mẫu số `work_days` (theo `companies`) trong cấu hình một-lịch hiện hành; lệch ⇒ đỏ và là tín hiệu phải hỏi owner (§13.4) |
| Đóng băng snapshot | đổi `attendance_records`/`leave_requests`/hồ sơ lương **sau** khi tính → dòng nháp và phiếu **không đổi**; `calculate` lại (kỳ chưa Approved) mới cập nhật. **`adjustment_amount`/`adjustment_reason` SỐNG SÓT qua `calculate` lại** (§13.4) — ca này bắt buộc, mất im lặng là mất tiền người dùng nhập |
| Race | 2 `calculate` song song → 1 thắng (row lock), dòng không nhân đôi; 2 `generate-payslips` song song → đúng 1 bộ phiếu, request kia **409 006**; **`generate-payslips` ‖ `reopen` song song → KHÔNG bao giờ ra kỳ `CollectingData` mà đã có `payslips`** (row-lock + cờ `payslips_generated_at`); 2 `acknowledge` song song → 1 hàng (**409 015**); 2 tạo kỳ cùng tháng → **409 008** — đều bóc `23505`/`23514` từ `cause`, **không 500** |
| Khoá theo kỳ | thưởng/phạt đã consume không được gộp lần hai vào kỳ khác; tính lại kỳ chưa Approved **nhả rồi gộp lại đúng tập**; hàng consume bởi kỳ KHÁC không bị đụng |
| Masking | `view:payroll-period` không nhận khoá tiền nào (kể cả tổng); `view-line` nhận đủ; `/me/payslips` chỉ phiếu của mình; ca đối chứng ALLOW cho từng luật. **KHÔNG viết ca «DTO nửa-mask»** — không tồn tại caller như vậy (§11.1), ca đó sẽ xanh-rỗng |
| Audit lượt đọc | **7 đường** đọc lương ở §18 mỗi lượt +1 hàng `audit_logs` **trong cùng tx** (rollback ⇒ 0 hàng); `/me/payslips` +0 hàng; payload audit **không có số tiền** |
| Own-scope payslip | nhân viên thấy đúng phiếu của mình (allow **và** deny); cross-employee **cùng company** → 404 (**biên IDOR cứng nhất — cụm int-spec riêng**); caller không có phiếu → danh sách rỗng, không lỗi |
| Idempotent | POST tạo + `calculate` + `generate-payslips` lặp cùng `Idempotency-Key` (15′) → 1 kết quả + replay envelope + `Idempotency-Replayed: true`; `IN_PROGRESS`/`KEY_REUSED`/`INVALID_KEY` như chuẩn chung |
| Append-only | app role UPDATE/DELETE `payslips`/`payslip_items`/`payslip_acknowledgements` bị từ chối ở **DB**; không bảng nào có DELETE |
| Tenant | `rls-tenant-isolation-tester` xanh cho cả 7 bảng trên `LANE_DB`; composite tenant FK bổ sung không làm `fk-tenant-census`/`xtenant-fk-ratchet` đỏ |
| NOTI | 4 event seed đúng catalog (`DedupeKey`); CHECK nới **cả hai bảng**; payload **không có số tiền** (ca assert tường minh); 020 gửi lại được sau reject→submit lần hai (khoá theo LẦN gửi); 023 gửi đúng từng `payslips.user_id` |
| Nối ATT | `calculate` khi kỳ công `open` → **409 002**; sau khi khoá kỳ công → 200 (ca ALLOW đối chứng). **KHÔNG viết ca «kỳ lương Locked chặn chỉnh công»** — kỳ công đã bất biến từ trước nên ca DENY đó xanh-rỗng và không dựng được ca ALLOW đối chứng (§3.5, bẫy `deny-cases-vacuous-without-allow-case`) |
| Validate | Zod mirror CHECK DB **hai chiều đúng bằng** (7 trạng thái kỳ · 3 trạng thái thưởng/phạt · **7** `item_type` — gồm `adjustment` · `period_month`); trần Zod ≠ trần service không đẻ mã chết |
| Thu hồi di sản | 16 cặp GỠ có 0 hàng ở **cả ba** bảng `permissions`/`role_permissions`/**`object_permissions`**; `hr-manager` không còn hàng `object_permissions` nào trên `view-payslip`; `view-payslip`/`view-own-payslip`/`acknowledge-own-payslip` còn đúng grant §9g; **`permission-admin.int-spec.ts` vẫn xanh**; **nhân viên mở phiếu CỦA MÌNH ra 200, không 403** (chốt `objectGrantRequired=false` — §18) |
| Test di sản phải sửa | **6 file** ở DB-13 §10.1 (`bonus-penalty-transition` · `payslip-acknowledgement-transition` · `payslip-appendonly` · `rls-registry` fixture · **`pgbouncer-tenant-isolation`** · `demo-seed-full.mjs`) phải **được sửa, KHÔNG được xoá** — `payslip-appendonly.int-spec.ts` là ca ghim bất biến #2 |

---

## 22. Quyết định nghiệp vụ — **OWNER ĐÃ KÝ 31/08/2026**

> Owner duyệt nguyên gói hồ sơ [`docs/plans/S13-PAYROLL-WAVE-review.html`](<../plans/S13-PAYROLL-WAVE-review.html>) («ok tôi duyệt») ⇒ 10 mã dưới đây chốt **đúng cột «Đề xuất»** của [wave plan §3](<../plans/S13-PAYROLL-WAVE.md>). Bảng này là bản chép kết luận; không hỏi lại.

| Mã | Câu hỏi | Kết quả owner chốt | Trạng thái |
| --- | --- | --- | --- |
| PAY-DEC-001 | Đánh số khi API-13 đã bị CHAT chiếm | **SPEC-11 · DB-13** (đúng chỗ IMP-10 §13.2 giữ) · **API-18** · permission-matrix **§9g** · IMPLEMENTATION-02 **EPIC-20 (§8.21)**, IMP02-STORY-181..190, Sprint 13 · trạng thái SPEC-01 **§17.15–17.17** · **NOTI-EVENT-020..023** (đã đo lại dải — §17) · migration `0564+` (đo `_journal.json` lúc chạy) | ✅ chốt |
| PAY-DEC-002 | Số phận 6 bảng di sản G12 | **RECONCILE — giữ khung, không drop-rebuild.** DB-13 viết chuẩn rồi đối chiếu; lệch → ALTER bằng migration MỚI (đo dữ liệu PROD trước); giữ khuôn append-only `payslips`; cột/CHECK không phù hợp → **GỠ theo DB-13, không nối dây**; `erd-current` chuyển payroll **rời §A5** — §3.1, DB-13 §5 | ✅ chốt |
| PAY-DEC-003 | Nguồn sự thật lương cơ bản | **`salary_profiles` versioned là nguồn DUY NHẤT cho tính lương.** `employee_profiles.base_salary` không tham gia — giữ vai trò hiển thị HR (masking hiện hành), ghi chú deprecate Phase sau — §3.2 | ✅ chốt |
| PAY-DEC-004 | Phạm vi công thức v1 | `gross` = base pro-rate + phụ cấp + thưởng; khấu trừ = nghỉ không lương + trễ/sớm (nếu bật rule ATT) + phạt + dòng tay. **KHÔNG engine BHXH/BHYT/TNCN** → PARK-PAYROLL-001. **VND duy nhất**, `numeric(18,2)`, tính + làm tròn **ở SQL**. Breakdown giải-thích-được — §3.3, §13.4 | ✅ chốt |
| PAY-DEC-005 | Kỳ lương & FSM & khoá công | Kỳ **tháng** (`payroll_config_json` cutoffDay/payDay). FSM **7 trạng thái** (P2-PAY-03-002): `Draft → CollectingData → Calculated → Reviewing → Approved → Paid → Locked` (§17.15). `Calculated` đòi `attendance_periods` **locked**; snapshot **ĐÓNG BĂNG** lúc tính; tính lại chỉ khi chưa `Approved`; `reopen` = quyền riêng + lý do + audit; `Locked` khoá luôn chỉnh công phía ATT — §3.4, §3.5, §13.1 | ✅ chốt |
| PAY-DEC-006 | Ai thấy lương ai + grant di sản | Chốt theo **DECISIONS-01 Phương án B**: cặp PAYROLL nhóm độc lập, KHÔNG mặc định cho HR. `payroll-officer` + `company-admin` đủ bộ; **`hr-manager` THU HỒI toàn bộ grant payroll di sản** bằng migration mới — giữ `('view-salary','employee')` hiện hành (khác domain); `employee` giữ `view-own-payslip` (`0180`). Cặp payroll `is_sensitive=true` **trừ cấu hình kỳ** — §11 | ✅ chốt |
| PAY-DEC-007 | Duyệt bảng lương | **1 cấp**, `('approve','payroll-period')` gán **company-admin**, **KHÔNG** gán `payroll-officer` — **four-eyes** người tính/người duyệt. Reject bắt buộc comment; approve/reject/lock/reopen đều audit + NOTI — §3.6, §13.1 | ✅ chốt |
| PAY-DEC-008 | Payslip & xuất file | Generate khi **`Approved`** → **phát hành** + NOTI từng nhân sự; nhân viên xem **Own** in-app + xác nhận qua `payslip_acknowledgements` (tái dùng). Export **XLSX** bảng lương tổng, cặp `('export','payroll')` RIÊNG + audit (chốt luôn câu #14/#15 §29 SPEC-01: **CÓ**). **PDF = Phase sau** — §13.2, §15 | ✅ chốt |
| PAY-DEC-009 | Role seed & 2FA | Role hệ thống **`payroll-officer`** (`…0015`): `company_id NULL` · `is_system=true` · **KHÔNG canonical** · **`requires_two_factor = TRUE`** (khác tiền lệ `recruiter`=false — lương là crown, owner chấp nhận khi duyệt nguyên gói) — §11.1 | ✅ chốt |
| PAY-DEC-010 | Widget DASH (P2-PAY-10 không có story) | v1 đúng **1 widget «chi phí lương kỳ»** (`PAYROLL-WIDGET-001`): tổng gross/net + headcount + trạng thái kỳ gần nhất; catalog BE + **SÀN scope Company** + chỉ role có cặp payroll; wire slug FE + test. Variance/report = Phase sau — §10.1 | ✅ chốt |

> **Tinh chỉnh thi công trong phạm vi đã duyệt (ghi để minh bạch, KHÔNG phải DEC mới):**
>
> (a) **Tách `payroll_period_lines` khỏi `payslips`** — bảng MỚI duy nhất của wave. Bắt buộc kỹ thuật để giữ **đồng thời** PAY-DEC-002 («giữ khuôn append-only `payslips`») và PAY-DEC-005 («tính lại trước khi duyệt»): dùng chính `payslips` làm bản nháp thì mỗi lần tính lại phải sửa/xoá hàng của bảng chỉ-INSERT (§3.4).
>
> (b) **Trạng thái phiếu lương §17.16 là giá trị DẪN XUẤT, không lưu cột** — phát hành là hành động cấp kỳ; lưu cờ trên từng phiếu buộc UPDATE bảng append-only cho một thông tin đã suy được từ `payroll_periods.status` (§13.2). Cùng nguyên tắc `Overdue` (task) / `Completed` (đặt phòng).
>
> (c) **Bề mặt quyền di sản rộng hơn hồ sơ duyệt ghi tay** — 19 cặp / 5 migration, không phải 6 cặp / 2 migration; trong đó `approve-payroll-period` và `publish-payroll-period` (`0132`) để `is_sensitive=false` nên **ăn theo wildcard `*:*`**, và 4 cặp `payslip` của `0005` đã bị blanket-grant. Thu hồi mở rộng ra **toàn bộ** 19 cặp theo bản đồ §11.2 — vẫn đúng tinh thần PAY-DEC-006 («thu hồi grant lương di sản»), rộng hơn về phạm vi vì phép đo rộng hơn.
>
> (d) **Ba cặp họ `payslip` giữ NGUYÊN TÊN di sản** (`view-payslip` · `view-own-payslip` · `acknowledge-own-payslip`) thay vì đổi sang bộ `(action, resource)` sạch — vì `0180` đang có grant sống cho `employee` mà PAY-DEC-006 yêu cầu giữ, và `view-payslip` là fixture của `permission-admin.int-spec.ts` (§11.1).
>
> (e) **`('acknowledge-own-payslip','payslip')` dùng lại cặp di sản `0132`** thay vì đẻ cặp `('acknowledge','payslip')` mới — cùng lý do (d), và grant `employee` đã có sẵn.
>
> (f) **Khiếu nại phiếu lương (dispute/resolve) KHÔNG vào v1** — hồ sơ duyệt chỉ ghi «ack». Cột `status`/`reason`/`resolved_*` của `payslip_acknowledgements` bị GỠ theo PAY-DEC-002 (giữ lại = cột ghi-rồi-bỏ), đường khiếu nại mở lại cùng **PARK-PAYROLL-001** (§5.2).
>
> (g) **Không có chuỗi `adjustment`/`void` trên `payslips` ở v1** — sai sót sau phát hành xử lý bằng thưởng/phạt ở **kỳ sau** (thông lệ truy lĩnh/truy thu). Hệ quả: partial unique `WHERE entry_kind='original'` trở thành **UNIQUE thẳng** `(company_id, payroll_period_id, user_id)` (§3.4, DB-13 §5.3).
>
> (h) **Neo `user_id`, KHÔNG đổi sang `employee_id`** — nguồn công/phép đang khoá theo `user_id` (`erd-current` §A3); đổi riêng PAYROLL đẻ join rỗng cho nhân sự không có tài khoản. Ghi nhận là nợ reconcile đi cùng đợt ATT/LEAVE (§8.1).
>
> (i) **Route picker `PAYROLL-API-034`** — bắt buộc để màn hình chạy được vì role `payroll-officer` không có cặp HR/AUTH nào (bài học RECRUIT B4); trường trả về bó hẹp.
>
> (j) **SPEC-01 §31 (không phải §30) là chỗ thiếu hai dòng `HR → PAYROLL` / `LEAVE → PAYROLL`** — wave plan ghi «§30», nhưng §30 là *mẫu liên kết*, §31 mới là *ma trận liên kết module*. Vá ở §31 (§23 mục 1).
>
> **Bổ sung sau vòng `plan-reviewer` đối kháng #1 (31/08/2026) — 6 BLOCKER đã vá:**
>
> (k) **Tách cặp ĐỌC `('view-line','payroll-period')` khỏi cặp GHI `('calculate',…)`** (17 cặp thay vì 16) — gộp làm một thì người chỉ có `approve` **duyệt mù**, và không thể cấp quyền đọc bảng lương mà không cấp quyền ghi (§11.1).
>
> (l) **Bảng RESET vết duyệt theo chuyển tiếp là BẮT BUỘC** (§13.1) — không có nó, kịch bản `approve → reopen → cùng người submit lại` vi phạm CHECK four-eyes ⇒ **`23514` = 500 ở vùng đỏ**. Kèm **PAYROLL-ERR-017** để công ty một-người-duyệt không kẹt vĩnh viễn ở `Reviewing`.
>
> (m) **Row-lock trên MỌI hành động đổi trạng thái kỳ** + cờ `payslips_generated_at/by` trên `payroll_periods` (§13.1) — chỉ khoá ở `calculate` thì `generate-payslips ‖ reopen` đẩy kỳ vào trạng thái không thoát được (phiếu append-only + UNIQUE thẳng ⇒ 409 vĩnh viễn).
>
> (n) **`work_days` được chốt nguồn tường minh** (`companies.working_days_json` + `public_holidays.is_paid_holiday` — §13.4) — trước đó tài liệu bỏ ngỏ, WO BE-2 sẽ phải tự phát minh quy tắc tính tiền. Và **tính lại GIỮ `adjustment_*`** thay vì xoá trắng số người dùng nhập tay.
>
> **Sửa sau khi FULL gate của `S13-PAYROLL-BE-1` phát hiện (01/09/2026, owner chốt cùng ngày):**
>
> (p) **Ngày nghỉ là số THẬP PHÂN, nguồn chốt là `leave_request_days`** (§13.4) — §13.4 bản đầu chốt nguồn ở mức NGÀY («đơn nghỉ đã duyệt ⋈ `leave_types.paid`»), nên `PayrollInputsRepository` bung đơn theo dải `start_date..end_date` rồi `COUNT(DISTINCT ngày)` ⇒ **mọi đơn nghỉ nửa buổi thành nguyên ngày**. Đo thật: `total_days` là `numeric(5,1)` (đơn 3 giờ = 0.375 ngày bị lưu `0.4`) và là con số của **cả đơn**, không quy kết được cho kỳ khi đơn bắc qua biên tháng ⇒ `leave_request_days` (`numeric(8,2)`, có `is_working_day`, ghi cùng tx với đơn) là nguồn. Kèm luật fallback cho đơn không có day-row và luật `GREATEST` cho `present_days`. BE-1 chưa chở tiền nên chưa gây thiệt hại; phải xong **trước** BE-2 vì BE-2 nối `unpaid_leave_days` vào khấu trừ.

> (o) **Vế «kỳ lương `Locked` khoá chỉnh công ATT» của PAY-DEC-005 đã được thoả sẵn**, PAYROLL không dựng cổng thứ hai và **không viện dẫn `ATT-ERR-024`** (mã không tồn tại trong code; SPEC-04 và API-04 đang mô tả nó khác nhau) — §3.5. Đây là **thu hẹp phần hiện thực**, không thu hẹp phạm vi đã duyệt: kết quả nghiệp vụ owner yêu cầu vẫn đúng.
>
> Điều kiện mở WO code của track PAYROLL: 10 quyết định chốt (✅) · §1 = `Approved` (✅) · `plan-reviewer` đối kháng **PASS** trên SPEC-11 + DB-13 (làm ở cuối `S13-PAYROLL-DOC-1`, trước khi mở `S13-PAYROLL-DB-1`).

---

## 23. Tác động đến bộ tài liệu hiện tại (WO S13-PAYROLL-DOC-1)

1. **SPEC-01**: §7.2/§8 trỏ PAYROLL → SPEC-11; §10.6 bổ sung tính chất role (`…0015`, 2FA, không canonical, không duyệt bảng lương); §12.8 liên kết + thu hẹp phạm vi v1 (bỏ PDF); **§17.15–17.17** hợp thức 3 bộ trạng thái + ghi chú §17.7; §20.2 cấp NOTI-EVENT-020..023; **§31 bổ sung `HR → PAYROLL` và `LEAVE → PAYROLL`** (§22j); thanh điều hướng các file SPEC thêm SPEC-11.
2. **SPEC-08**: §15.0 ánh xạ thêm 020–023; §15.10 PAYROLL events.
3. **docs/README.md** §2/§3/§4/§8: thêm SPEC-11 · DB-13 · API-18 và hàng module PAYROLL.
4. **docs/permission-matrix-spec.md**: **§9g PAYROLL** — 17 cặp + scope per-(perm, role) + role `payroll-officer` + **bản đồ thu hồi 19 cặp di sản**.
5. **DB-01** §3.2 + nhóm bảng §7.13 · **DB-09** §8.19 index PAYROLL · **DB-10** §10 seed module + §12.12 permission + §15 event.
6. Tạo **DB-13** và **API-18** (stub endpoint khoá theo §15).
7. **docs/erd-current.md**: cụm payroll **RỜI §A5** («hướng cũ cần dọn») → **§A4** («thiết kế có, code chưa build đủ») với ghi chú reconcile.
8. **RELEASE-14 §5**: PAYROLL có bộ tài liệu, wave `S13-PAYROLL` + ghi **PARK-PAYROLL-001** (engine BHXH/BHYT/TNCN · PDF payslip · variance report · khiếu nại phiếu lương · export batch).
9. **IMPLEMENTATION-02** §8.21 **EPIC-20 PAYROLL** (IMP02-STORY-181..190) + §9 Sprint 13; **IMPLEMENTATION-10** §13.2 ghi chú DB-13 đã viết (API lấy API-18).
10. **harness**: `lib/stories.mjs` (`EPIC_MODULE[20]`, `sprintOfStory` S13, map story→WO) · `dashboard/server.mjs` (`MODULE_SPEC` PAYROLL — đặt **trước** HR/AUTH/ATT vì tiêu đề WO chứa "employee"/"permission"/"chấm công") · `backlog.mjs` (DOC-1 đóng).
11. **Nợ để lại cho WO sau**:
    - (a) `S13-PAYROLL-DB-1` — toàn bộ DB-13 §10 (+ cập nhật danh sách bảng append-only ở `erd-current` §9 khi build) · **sửa 6 file test/fixture/seed di sản** (DB-13 **§10.1** — sửa, KHÔNG xoá) · thêm `payslip_acknowledgements` + `payroll_period_lines` vào `RetentionService.PROTECTED_TABLES` (bảng không có DELETE ⇒ retention sẽ ăn `42501` uncaught làm hỏng cả lượt cleanup) · **thu hồi `SELECT` của `mediaos_worker`** trên 4 bảng lương · **đo lại `FK_SINGLE_COL_PAIRS_FLOOR`** (`apps/api/test/foundation/fk-tenant-verdicts.ts`) — chỉ hạ sàn đúng bằng số FK biến mất theo cột bị GỠ, có đo hai lane giải thích.
    - (b) `S13-PAYROLL-BE-1` — khai **allowlist capability BACKEND** cho **13** cặp sensitive · `PayrollPeopleRepository` (§18) · **`objectGrantRequired = false`** tường minh cho `view-own-payslip`/`acknowledge-own-payslip` (§18) · hai picker `PAYROLL-API-034/035`.
    - (c) `S13-PAYROLL-BE-2` — máy tính lương SQL + four-eyes + generate/publish + outbox 4 event · **siết `MIN_COVERED_COUNT` của `route-http-coverage.e2e-spec.ts`** cùng commit (cổng KHÁC route-census; `MAX_UNCOVERED_TOTAL = 0`, từ khoá `salary`/`payslip` là nhóm rủi ro cao).
    - (d) `S13-PAYROLL-FE-1` — thẻ app PAYROLL trong `packages/web-core/src/lib/registry.ts` khai **`requiredPermissions` bằng CẶP ENGINE LITERAL** `["access:payroll", "view:payroll-period"]` (đúng tiền lệ đang sống của ASSET/ROOM/RECRUIT — **KHÔNG** đi qua `PERMISSION_CODE_TO_PAIR`, bảng đó dành cho họ `access:me/goal/chat`); gỡ pin «nhóm payroll rỗng» ở `nav.spec.ts` cùng commit; bật `modules.PAYROLL`.
    - (e) `S13-PAYROLL-DASH-1` — **toàn bộ seed widget** «chi phí lương kỳ» (catalog BE + sàn scope `DASH_WIDGET_MIN_DATA_SCOPE` + slug FE, khuôn mig `0558`/`0563`) — cố ý **KHÔNG** nằm trong DB-13 §10.
    - (f) `packages/contracts/src/payroll.ts` — file đã tồn tại với DTO hướng cũ, **viết lại mirror DB-13 hai chiều đúng bằng** ở `S13-PAYROLL-DB-1` (export prefix `payroll*`).
12. **Nợ tài liệu của ATT (KHÔNG thuộc wave này, ghi để không quên):** `ATT-ERR-024` đang mang **hai nghĩa khác nhau** — [SPEC-04 §mã lỗi](<SPEC-04 ATT.md>) «Kỳ công đã khóa» vs [API-04 §mã lỗi](<../API Design/API-04_ATT_API_Design.md>) «Không xác định được người duyệt phù hợp» — và **không mã nào được phát ra trong `apps/api/**`** (đường từ chối kỳ công đã khoá ném `ConflictException` trần). Cần một WO của ATT chốt lại một nghĩa và gắn mã vào response. PAYROLL **không** dựa vào mã này (§3.5).

---

## 24. Definition of Done cho SPEC-11

- [x] Owner ký PAY-DEC-001..010 (31/08/2026) → §1 = **Approved**
- [x] DB-13 + API-18 + permission-matrix §9g đồng bộ, không mâu thuẫn SPEC-11
- [x] SPEC-01 §17.15–17.17 hợp thức 3 bộ trạng thái; §20.2/SPEC-08 §15.0 cấp NOTI-EVENT-020..023 sau khi **đo** (dải dừng ở 019)
- [x] Bản đồ reconcile 6 bảng di sản (DB-13 §5) + bản đồ 19 cặp quyền di sản (§11.2) đo bằng grep, không suy đoán
- [~] `plan-reviewer` đối kháng trên SPEC-11 + DB-13 — **ĐÃ CHẠY 2 VÒNG, CHƯA CÓ VERDICT PASS**:
  - **Vòng 1 (31/08/2026) — BLOCK, 6 BLOCKER**: reset vết duyệt/four-eyes 500 · 5 file test di sản · `ATT-ERR-024` là mã chết · thiếu picker kỳ công · `work_days` bỏ ngỏ · row-lock chỉ có ở `calculate`. **Đã vá toàn bộ** + H1–H8 + M1–M7 + LOW (§22 k/l/m/n/o).
  - **Vòng 2 (31/08/2026) — BLOCK, 10 mục**: `object_permissions` bỏ sót khỏi kế hoạch thu hồi · file test thứ 6 (`pgbouncer-tenant-isolation`) · CHECK snapshot mâu thuẫn DEFAULT · 7 chỗ số lệch · 2 chỗ gate drift · rò tiền qua route GHI · `work_days` thiếu 4 vị từ SQL · `adjustment_amount` không có đích ở `payslips` · bộ giải «người duyệt hợp lệ» mâu thuẫn §17 · 5 mâu thuẫn trong `backlog.mjs`. **Đã vá toàn bộ.**
  - **Vòng 3 (31/08/2026) — BLOCK, ĐÚNG MỘT CỤM**: giá trị `item_type = adjustment` (thêm ở vòng 2) chưa lan từ DB-13 §5.4/§6.6 sang **DB-13 §7 enum** (nguồn của `packages/contracts/src/payroll.ts` — Zod 6 vs CHECK 7 = mã chết) và sang **SPEC-11 §8/§21**; cộng 3 chuỗi đếm file/§10.1 và 1 câu về `object_permissions`. Reviewer khai **điều kiện tự-mở-cổng**: vá đủ 7 chuỗi đó thì coi như PASS, không cần vòng 4.
  - **✅ Đã vá đủ 7 chuỗi (31/08/2026)** — DB-13 §7 enum 7 giá trị + dấu của `amount` · DB-13 §10 A/§11 «6 file» · DB-13 §10.1 liệt kê đủ 5 điểm `INSERT INTO payslips` · SPEC-11 §8 hai bảng (`adjustment_amount` + `item_type` 7 giá trị) · §21 «7 `item_type`» + «6 file» · §13.1 câu `object_permissions` · §11.1 lý do giữ `access:payroll`@Own cho `employee`. ⇒ **Cổng `S13-PAYROLL-DB-1` MỞ** theo điều kiện reviewer đã khai.
- [ ] Mọi WO code của track PAYROLL lấy SPEC-11 + DB-13 làm nguồn sự thật; lệch → sửa code, không sửa ngầm spec

---

## 25. Kết luận

PAYROLL là mảnh cuối của Phase 2 và là vùng **crown-jewel đặc nhất** của hệ thống. Khác mọi module gần đây, nó **không phải nền trắng**: 6 bảng và 19 cặp quyền của hướng cũ đã nằm sẵn trong DB, trong đó có hai cặp *duyệt* và *phát hành* lương để `is_sensitive=false` — nghĩa là đang ăn theo wildcard. Phần lớn giá trị của wave này nằm ở chỗ **đo đúng hiện trạng rồi thu hồi**, không chỉ ở chỗ viết thêm code.

Bốn lựa chọn cứng giữ v1 gọn mà không mất bất biến: **tách bảng lương nháp khỏi phiếu lương phát hành** (append-only còn nguyên, vẫn tính lại được), **tiền tính ở SQL với snapshot đóng băng** (con số không trôi), **four-eyes là ràng buộc QUYỀN chứ không chỉ là kiểm tra runtime** (officer không có cặp duyệt), và **mọi lượt đọc lương của người khác đều để lại vết** (trừ lượt tự xem của chính chủ). Phần thật sự mới chỉ là 1 bảng, 17 cặp quyền, 35 mã API, 17 mã lỗi, 4 sự kiện và 6 màn hình — mọi thứ còn lại là reconcile nền đã có.
