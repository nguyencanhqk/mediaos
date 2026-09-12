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
| Phiên bản | **v2.0** (wave S15-PAYROLL-V2) — v1.0 giữ nguyên trong cùng file, phần v2 đánh dấu **«v2»** ở từng mục (PAY-DEC-011: không tách SPEC mới) |
| Trạng thái | **Approved** — owner duyệt nguyên gói hồ sơ wave S13-PAYROLL ngày **31/08/2026**, ký PAY-DEC-001..010 (§22); **v2: owner duyệt hồ sơ wave S15 ngày 02/09/2026, ký PAY-DEC-011..020 (§22.1)** |
| Giai đoạn | **Phase 2 «HR nâng cao»** · v1 = wave S13-PAYROLL · **v2 = wave S15-PAYROLL-V2** — hậu go-live |
| Ngày tạo | 31/08/2026 |
| Ngày cập nhật | **11/09/2026** — `S15-PAYROLL-DOC-1` viết bản v2: §3.9–§3.12 · §5.1b · §5.2b (PARK-PAYROLL-002) · §8.2 · §9 (PAY-SCREEN-007..017) · §10.2 · §10.1 (WIDGET-002/003) · §11.3 · §12.1 (ERR-018..033) · §13.1 (FSM **8** trạng thái) · §13.2 · §13.6–§13.8 · §15.1 (API-036..085) · §17.1 (NOTI-EVENT-024..027) · §18.1 · §19.1 · §21.1 · §23.2 · §24.1 |

> **Bản đồ «đọc mục nào cho v2»** — v1 và v2 sống chung một file; mọi mục v2 đều là **mục con thêm vào**, không ghi đè mục v1, trừ **SÁU** chỗ v2 **thay thẳng** nội dung v1 (đã đánh dấu 🔁 tại chỗ, vì giữ hai bản song song sẽ mâu thuẫn):
>
> | # | Mục | v1 | **v2** |
> | --- | --- | --- | --- |
> | 1 | **§13.1** | ma trận FSM **7** trạng thái, `publish: Approved → Paid` | ma trận **8** trạng thái, `publish: Approved → Published`, thêm `complete-batch: Published → Paid` + bảng RESET có `paid_by/at` |
> | 2 | **§13.2** | phiếu `Published` khi kỳ ∈ `{Paid, Locked}` | kỳ ∈ **`{Published, Paid, Locked}`** |
> | 3 | **§17** | `PAYSLIP_PUBLISHED` phát ở `Approved → Paid` | phát ở **`Approved → Published`** (mã · dedupe · người nhận KHÔNG đổi) |
> | 4 | **§3.5** | tiêu đề + câu «7 trạng thái» | «**8** trạng thái» + khối di trú `Paid → Published` |
> | 5 | **§15 hàng 014** | `Approved → Paid` | **`Approved → Published`** |
> | 6 | **§15 hàng 031 · 032 · 033** | lọc kỳ `{Paid, Locked}`; ack đòi kỳ `Paid` | lọc **`{Published, Paid, Locked}`**; ack đòi kỳ **`Published`** |
>
> Mọi mục còn lại: đọc v1 **rồi** đọc mục «v2» tương ứng. ⚠️ **§3.3 (tiền tính ở SQL) KHÔNG nằm trong danh sách này** — nó bị **đảo MỘT PHẦN**, không bị thay: ranh giới chính xác ở **§3.9**.
>
> ⚠️ **Số migration: `0570+`, KHÔNG phải `0569`.** PAY-DEC-011 (§22.1, viết 02/09/2026) ghi «mig `0569+`»; đo `apps/api/migrations/meta/_journal.json` ngày 11/09/2026 cho **`idx 236` / `0569_s14recruitfilegrant1_candidate_file_perm`** — `0569` **đã bị `S14-RECRUIT-FILEGRANT-1` lấy**. WO DB vẫn phải **đọc journal tại thời điểm chạy** và lấy `idx = max + 1` (`migration-not-in-journal-is-silently-skipped`); con số ở đây chỉ là mốc đo được lúc viết tài liệu.

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

> ⚠️ **v2 ĐẢO MỘT PHẦN mục này** (PAY-DEC-012): số học **từng thành phần** chuyển sang TS/`decimal.js`, còn **clamp `net`, CHECK và bất biến tổng ở lại SQL**. Ranh giới đầy đủ: **§3.9**. Mục 3.3 dưới đây mô tả **v1** và vẫn là nguồn đúng cho kỳ tính bằng công thức cố định (kỳ không gắn mẫu — chỉ tồn tại trong dữ liệu v1 đã có, xem §13.6 «đường tương thích»).

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

### 3.5 Kỳ lương có **8** trạng thái *(v1: 7)*, gắn khoá kỳ công ATT — PAY-DEC-005 · **PAY-DEC-017**

Kỳ **tháng** (`period_month` `YYYY-MM`), mốc cắt/ngày trả đọc từ `companies.payroll_config_json` (`cutoffDay` 25 / `payDay` 5 — đã sống ở màn Cài đặt). FSM hợp thức tại **SPEC-01 §17.15**; chuyển tiếp hợp lệ ở §13.1 — **service ép FSM, DB chỉ CHECK tập giá trị** (`check-cannot-enforce-fsm-transitions`).

> **v2 — PAY-DEC-017 tách `Published` khỏi `Paid` (7 → 8 trạng thái):** ở v1, `publish` đưa kỳ thẳng `Approved → Paid`, tức **`Paid` là tên gọi SAI của «đã phát hành phiếu»** — tiền chưa hề rời công ty. v2 tách đôi: **`Published`** = phiếu đã phát hành cho nhân viên (nghĩa CŨ của `Paid`), **`Paid`** = **đợt chi trả đã hoàn tất** (`PAYROLL-API-072`). Ma trận chuyển tiếp + bảng RESET: **§13.1 (bản v2 THAY bản v1)**.
>
> ⚠️ **Hệ quả di trú KHÔNG được bỏ sót — hàng `Paid` của v1 mang nghĩa `Published`:** migration v2 **phải backfill `status = 'Paid'` → `'Published'`** *trước* khi siết `payroll_periods_paid_pair_check` (cột `paid_by/at` của những hàng đó là NULL, đúng với `Published`). Bỏ backfill = mọi kỳ v1 tự nhận là «đã chi trả» mà không đợt chi trả nào tồn tại, và CHECK mới nổ `23514` trên chính lượt migrate. WO DB **ĐO số hàng trước** (PROD chưa chạy v1 ngày nào ⇒ kỳ vọng 0, nhưng DB dev/lane **có** hàng).
>
> ⚠️ **Và đường đọc của nhân viên đổi theo:** `GET /me/payslips` v1 lọc kỳ ∈ `{Paid, Locked}`. Sau khi tách, phiếu vừa phát hành nằm ở `Published` ⇒ **bộ lọc phải thành `{Published, Paid, Locked}`**. Quên vế này = **nhân viên mất sạch phiếu lương của mình** mà không route nào báo lỗi (trả mảng rỗng — đúng hình dạng fail-OPEN ngược: `empty-success-is-the-fail-open-shape`). Cùng lớp với §13.2.

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

### 3.9 **v2** — Ranh giới TS ↔ SQL sau PAY-DEC-012: số học lên TS, BẤT BIẾN ở lại SQL

PAY-DEC-012 **đảo một phần** §3.3 («tiền tính ở SQL»). Ranh giới mới **chốt ở đây**, WO BE không được tự nội suy — đây là chỗ dễ đọc sai nhất của cả wave:

| Việc | v1 | **v2** | Vì sao |
| --- | --- | --- | --- |
| Đọc đầu vào của cả kỳ (công · phép · thưởng/phạt · hồ sơ lương · NPT · tỉ lệ luật định) | SQL set-based | **SQL set-based, GIỮ NGUYÊN** | một câu lệnh cho cả kỳ; §19 vẫn cấm vòng lặp truy vấn per-người |
| Cộng/trừ/nhân/chia của **từng thành phần lương** | SQL | **TS, `decimal.js`** | công thức do người dùng định nghĩa (§13.6) — biên dịch sang SQL là viết compiler, chi phí ×3 và không audit được |
| Làm tròn từng thành phần | SQL `round(…, 2)` | **`decimal.js` `ROUND_HALF_UP`, scale 2** (§13.6) | cùng quy tắc nửa-lên, khác nơi thực thi |
| **Clamp `net ≥ 0`** | SQL `GREATEST(…, 0)` | **SQL `GREATEST(…, 0)` — KHÔNG đổi** | `clamp-must-be-sql-not-js`: clamp là **chốt cuối**, phải nằm cùng chỗ với CHECK. TS clamp rồi SQL không clamp = một bản vá TS sai là ghi số âm vào bảng |
| CHECK `≥ 0` · UNIQUE · `SUM(payslip_items.amount) = gross − deduction + adjustment` | SQL | **SQL — KHÔNG đổi** | bất biến dữ liệu không đi theo ngôn ngữ tính toán |
| Ghi dòng bảng lương | một câu `INSERT … ON CONFLICT` set-based | **một câu `INSERT … ON CONFLICT` set-based, giá trị đến từ TS** (bind mảng — `drizzle-array-bind-sql-param`) | vẫn một lượt ghi cho cả kỳ, không N câu UPDATE |

> ⚠️ **Câu dễ đọc sai:** «v2 tính ở TS» **KHÔNG** có nghĩa là «clamp ở JS được rồi». Ba thứ ở lại SQL — **clamp `net`**, **CHECK**, **bất biến tổng** — là chốt cuối, và WO QA có ca đâm thẳng: ghi thẳng một dòng `net < 0` qua repository phải bị DB từ chối, không phải bị TS chặn.
>
> ⚠️ **`Number` bị cấm trên mọi giá trị tiền trong TS** — `decimal.js` từ lúc đọc khỏi driver tới lúc bind trả lại. `numeric` của `pg` về JS là **chuỗi**; `parseFloat` một lần ở giữa là mất chính xác vĩnh viễn mà không ca nào đỏ nếu fixture toàn số tròn. QA có ca fixture cố ý lẻ (§21.1).

### 3.10 **v2** — Thành phần lương là DỮ LIỆU, không phải code

Khoản lương v1 nằm cứng trong câu SQL. v2 đưa chúng thành **catalog `salary_components`** (mã · loại · kiểu giá trị · công thức) và **mẫu bảng lương `payroll_templates`** gắn vào kỳ (PAY-DEC-013). Hệ quả bắt buộc:

- **Kỳ lương gắn ĐÚNG MỘT mẫu** lúc tạo; đổi mẫu chỉ khi kỳ ≤ `CollectingData` (⇒ **PAYROLL-ERR-023**).
- **Sửa công thức là sửa TIỀN của cả công ty** ⇒ cặp `('manage','salary-component')` và `('manage','payroll-template')` là **sensitive**, và **audit ghi diff công thức** (trước/sau), không chỉ ghi «đã sửa».
- **Số đã tính KHÔNG trôi theo công thức**: mỗi dòng bảng lương giữ `component_values_json` + **`template_fingerprint`** (băm tập công thức hiệu lực lúc tính). Sửa công thức sau đó không đổi số của kỳ đã tính; nhưng **tính lại** một kỳ `Calculated` **sẽ** lấy công thức mới — đúng ý, và màn chi tiết kỳ **phải** hiện băng «mẫu đã đổi kể từ lần tính gần nhất» khi fingerprint lệch (§14, §13.6).
- Thành phần **hệ thống** (seed) **không xoá được**, chỉ sửa công thức/ngưng dùng (⇒ **PAYROLL-ERR-024**) — gỡ một mã hệ thống là làm chết mọi công thức tham chiếu nó.

### 3.11 **v2** — Luật định là DỮ LIỆU CÓ HIỆU LỰC, hệ thống lưu và áp chứ không khẳng định đúng luật

Tỉ lệ BHXH/BHYT/BHTN/KPCĐ/đoàn phí, trần đóng, bậc thuế TNCN và mức giảm trừ **không hard-code** — sống ở `payroll_statutory_rates` versioned theo `effective_from` (PAY-DEC-014). Kỳ lương dùng **bản hiệu lực tại NGÀY CUỐI KỲ** (một mốc duy nhất cho cả kỳ; không nội suy giữa kỳ). Không có bản hiệu lực ⇒ **422 PAYROLL-ERR-022**, kỳ **không** đổi trạng thái.

> **Trách nhiệm số là của owner, không của hệ thống.** Seed dùng số owner xác nhận 02/09/2026 (§22.1 PAY-DEC-014). Tài liệu này, code và test **không** khẳng định các số đó đúng pháp luật tại thời điểm chạy — chúng khẳng định **hệ thống áp đúng số đang lưu**. Ca test ghim **số seed**, không ghim «đúng luật».

### 3.12 **v2** — PII mới của PAYROLL: tài khoản ngân hàng · người phụ thuộc · mã số thuế

v2 kéo vào ba loại dữ liệu cá nhân mới. Chúng là **PII cùng hạng `tax_code` của HR** (mask ở server + audit lượt xem), **KHÔNG phải secret hạng bất biến #3** (không envelope-encryption, không KMS) — ghi tường minh ở đây để lượt sau không «nâng cấp» lệch nhau:

| Dữ liệu | Ở đâu | Ra khỏi server thế nào |
| --- | --- | --- |
| Tài khoản ngân hàng | `payroll_employee_settings` (PAY-DEC-017 — **KHÔNG** đẩy vào `employee_profiles`) | **Mặc định chỉ 4 số cuối** trong mọi DTO. **Số đầy đủ CHỈ rời server qua tệp UNC** của đợt chi trả (`PAYROLL-API-071`), gác `('manage','payment-batch')` + audit bắt buộc |
| Người phụ thuộc (họ tên · quan hệ · MST NPT · khoảng hiệu lực) | `payroll_dependents` | cặp `('view','payroll-employee')`; audit lượt xem |
| `tax_code` của nhân sự | `employee_profiles` (HR — **không sao chép**) | chiếu qua `('view','salary-profile')` theo PAY-DEC-016, audit lượt xem; PAYROLL **đọc**, không sở hữu |

> ⚠️ **Không có cột `bank_*` nào ở `employee_profiles`** — đo 11/09/2026: `grep -i bank apps/api/src/db/schema/` = **0 hit**. Và comment tại `employees.ts:78` **cấm tường minh** nhồi trường cần lọc/tìm vào `personal_extra` jsonb. ⇒ cột ngân hàng **bắt buộc** là cột typed của bảng PAYROLL, đúng PAY-DEC-017.

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

### 5.1b **v2** — Trong v2 (wave S15-PAYROLL-V2 — PAY-DEC-011..020, story PL-11..24 ↔ IMP02-STORY-191..204)

| # | Hạng mục | Story | Track | WO |
| --- | --- | --- | --- | --- |
| 11 | **Vỏ UI dùng chung** (DEC-020): sidebar nhóm gập được · toolbar chuẩn · DataTable ghim/chọn cột + footer «Tổng số · Số dòng/trang · 1–N» · DetailPageHeader · StatusPill — ở `packages/ui`, **mọi module dùng chung** | *(hạ tầng, không có story nghiệp vụ)* | UI | `S15-UI-SHELL-1` |
| 12 | **Màn Nhân viên trong PAYROLL** (danh sách + chi tiết 5 tab) qua **chiếu HR bó hẹp**, không cấp cặp HR | PL-11 | A | DB-1 · BE-1 · FE-1 |
| 13 | **Hồ sơ lương v2**: `salary_type` NET/GROSS · đối tượng đóng TNCN · lương đóng BH · lương thử việc · tỉ lệ hưởng · **phụ cấp/khấu trừ có định mức** (`salary_profile_items` thay `allowances` jsonb) | PL-12 | A | DB-1 · BE-1 · FE-1 |
| 14 | **Thiết lập BH/công đoàn + tài khoản ngân hàng + người phụ thuộc** (bảng PAYROLL, mask + audit) | PL-13 | A | DB-1 · BE-1 · FE-1 |
| 15 | **Bảng công tổng hợp kỳ** (màn ĐỌC, nguồn ATT, xem trước khi tính) | PL-14 | A | BE-1 · FE-1 |
| 16 | **Catalog thành phần lương** (hệ thống seed + tự thêm) + **máy công thức** có kiểm cú pháp/vòng/giới hạn | PL-15 | B | DB-1 · BE-2 · FE-2 |
| 17 | **Mẫu bảng lương** (nhãn cột · công thức ghi đè · ẩn/hiện · thứ tự · xem trước) gắn vào kỳ | PL-16 | B | DB-1 · BE-2 · FE-2 |
| 18 | **Máy tính lương v2**: BHXH/BHYT/BHTN/KPCĐ/đoàn phí + trần · **TNCN luỹ tiến 7 bậc** + giảm trừ bản thân/NPT · **NET gross-up** · snapshot từng thành phần | PL-17 | B | BE-3 |
| 19 | **Bảng tỉ lệ luật định** versioned theo ngày hiệu lực | PL-18 | B | DB-1 · BE-2 · FE-2 |
| 20 | **Tạm ứng** có duyệt four-eyes, tự thành khoản khấu trừ ở kỳ chỉ định; «Tạm ứng của tôi» (Own) | PL-19 | C | DB-2 · BE-4 · FE-3 |
| 21 | **Đợt chi trả** (bank/cash · tệp UNC XLSX · hoàn tất ⇒ kỳ `Paid`) | PL-20 | C | DB-2 · BE-4 · FE-3 |
| 22 | **Ngân sách lương** năm/đơn vị + theo dõi thực hiện | PL-21 | C | DB-2 · BE-4 · FE-3 |
| 23 | **Import Excel thu nhập/khấu trừ khác** theo kỳ (khuôn import HR) | PL-22 | C | BE-4 · FE-3 |
| 24 | **Tổng quan `/payroll`** (6 khối + Lời nhắc) + **7 báo cáo** (lọc kỳ/đơn vị, XLSX) | PL-23 | D | BE-5 · FE-4 |
| 25 | **PDF phiếu lương** (server, font Việt nhúng, signed-URL; Own + batch) | PL-24 | D | BE-5 · FE-4 |
| 26 | Widget DASH **«ngân sách lương năm»** + **«tạm ứng chờ duyệt»** | *(dẫn xuất PL-21/PL-19)* | — | `S15-PAYROLL-DASH-1` |

**Con số cấp phát của v2 — ĐÓNG, đo ngày 11/09/2026** *(mọi số dưới đây là số ĐÚNG BẰNG, WO sau đối chiếu chứ không tự cấp thêm)*:

| Họ mã | v1 | **v2 cấp thêm** | Tổng sau v2 |
| --- | --- | --- | --- |
| Bảng dữ liệu | 7 | **+11 bảng mới · ALTER 3 bảng — DB-1 lấy 2 (§12.1 · §12.4), DB-2 lấy 1 (§12.3)** (§8.2) | **18** |
| Màn hình `PAY-SCREEN-` | 001..006 (6) | **007..017 (11)** | 17 |
| Route `PAYROLL-API-` | 001..035 (35) | **036..085 (50)** | **85** |
| Mã lỗi `PAYROLL-ERR-` | 001..017 (17) | **018..033 (16)** | 33 |
| Cặp quyền | 17 (13 sensitive) | **+17, TẤT CẢ sensitive** (§11.3) | **34 (30 sensitive)** |
| Sự kiện `NOTI-EVENT-` | 020..023 (4) | **024..027 (4)** | 8 |
| Widget DASH | `PAYROLL-WIDGET-001` | **002 · 003** | 3 |
| Trạng thái kỳ | 7 | **+1 (`Published`)** | **8** |

> ⚠️ **Ba con số trong hồ sơ wave S15 là ƯỚC LƯỢNG, KHÔNG phải cấp phát — bản này ĐÍNH CHÍNH:**
> (a) wave plan §5 và §8 ghi «**10** bảng mới» — đếm lại danh sách của chính nó ra **11** (`salary_profile_items` · `payroll_employee_settings` · `payroll_dependents` · `salary_components` · `payroll_templates` · `payroll_template_components` · `payroll_statutory_rates` · `payroll_advances` · `payroll_payment_batches` · `payroll_payment_lines` · `payroll_budgets`); DB-1 lấy 7, DB-2 lấy 4.
> (b) wave plan ghi «~**40** route mới» — bản đặc tả §15.1 liệt kê **50**, có mã từng route.
> (b2) wave plan ghi «`PAY-SCREEN-007..016`» (**10** màn) — bản này cấp **11** (007..017): «Tạm ứng của tôi» được **mã riêng `017`** thay vì biến thể `012b`, theo đúng tiền lệ v1 (màn ME «Phiếu lương của tôi» mang mã `006`, không phải `005b`).
> (c) WO seed gợi ý cặp `('export','payslip-pdf')` — **KHÔNG cấp**, vì **PAY-DEC-019 đã ký** «`('export','payroll')` cho batch, **Own** cho phiếu của mình». Cấp cặp mới ở đây là **đảo một quyết định owner đã ký** (§11.3 ghi lại lập luận này để lượt sau không mở lại).

### 5.2 Ngoài v1 (chừa thiết kế, KHÔNG làm đợt này) — **PARK-PAYROLL-001**

> **Cập nhật 02/09/2026 (wave S15-PAYROLL-V2, PAY-DEC-011..020 §22.1):** v2 **lấy lại** từ danh sách này engine BHXH/BHYT/BHTN/TNCN (DEC-014) · PDF phiếu lương (DEC-019) · report theo phòng ban + variance dưới dạng 7 báo cáo (DEC-018); phần còn lại (khiếu nại · multi-currency · chu kỳ ngoài tháng · duyệt nhiều cấp · attachment) chuyển sang **PARK-PAYROLL-002** cùng các mục gạt mới (Doanh số/KPI/Sản phẩm · Phân bổ lương · lịch gửi báo cáo · Trợ lý AI · đa pháp nhân · mẫu theo từng NV). Bảng «v2» của §5.1 do `S15-PAYROLL-DOC-1` viết.

- **Engine BHXH/BHYT/BHTN/TNCN luỹ tiến** (P2-PAY-05-002/003) — v1 chỉ khấu trừ nghỉ không lương · trễ/sớm · phạt · dòng tay.
- **PDF phiếu lương** (P2-PAY-07-003) · **export payslip batch / signed-URL** (P2-PAY-08-002) — v1 chỉ XLSX bảng lương tổng.
- **Variance report** (P2-PAY-08-004) · **report theo phòng ban** (P2-PAY-08-003).
- **Khiếu nại phiếu lương** (dispute/resolve) — v1 chỉ **xác nhận**; đường khiếu nại mở lại cùng gói này (§16, DB-13 §5.6).
- **Multi-currency** · **chu kỳ trả ngoài tháng** (biweekly/weekly) · **loại lương giờ/khoán**.
- **Workflow duyệt nhiều cấp** (v1 một cấp four-eyes) · **remote/work-trip rule** (P2-PAY-04-004).
- **Tài khoản ngân hàng + tệp đính kèm điều chỉnh** (P2-PAY-06-002 phần attachment).

### 5.2b **v2** — Ngoài v2 — **PARK-PAYROLL-002** (danh sách ĐÓNG, ghi để không ai tự thêm)

PARK-PAYROLL-002 gồm **hai nguồn**: (a) phần **còn lại** của PARK-PAYROLL-001 sau khi v2 lấy lại ba mục, và (b) các mục **gạt mới** khi khảo benchmark MISA AMIS (wave plan §2 — G6 · G10 · G17).

| Nguồn | Mục | Vì sao ngoài v2 |
| --- | --- | --- |
| PARK-001 còn lại | **Khiếu nại phiếu lương** (dispute/resolve) | v2 vẫn chỉ **xác nhận**; mở lại đường khiếu nại kéo theo dựng lại cột đã GỠ ở `payslip_acknowledgements` (DB-13 §5.6) |
| PARK-001 còn lại | **Multi-currency** · **chu kỳ trả ngoài tháng** (biweekly/weekly) · **loại lương giờ/khoán** | N=1 chạy một chu kỳ tháng, VND; mở ra là nhân đôi mọi công thức |
| PARK-001 còn lại | **Workflow duyệt nhiều cấp** | v2 giữ **một cấp four-eyes** (PAY-DEC-007) |
| PARK-001 còn lại | **Remote/work-trip rule** (P2-PAY-04-004) · **tệp đính kèm điều chỉnh** | chưa có nơi cấu hình rule ở ATT |
| **Gạt mới (G6)** | **Doanh số · KPI · Sản phẩm** làm đầu vào tính lương | **ngoài phạm vi SẢN PHẨM**, không phải hoãn: de-media-fy đã loại KPI/doanh thu theo kênh (CLAUDE.md §1). Đừng seed lại ở wave sau |
| **Gạt mới (G10)** | **Phân bổ lương** (cost center) | kế toán chi phí — finance OUT |
| **Gạt mới** | **Lịch gửi báo cáo định kỳ** | cần scheduler + kênh gửi; v2 chỉ xuất theo yêu cầu |
| **Gạt mới (G17)** | **Trợ lý AI** · **thư viện mẫu cloud** · **«lấy lại dữ liệu» từ AMIS** · **đa pháp nhân** | Phase 5 / SaaS |
| **Gạt mới** | **Mẫu bảng lương theo từng nhân viên / theo vị trí** | v2 chỉ **toàn công ty hoặc theo `org_unit`** (PAY-DEC-013); ma trận ưu tiên chưa có nhu cầu |
| **Gạt mới** | **Lương tối thiểu vùng nhiều VÙNG** (I–IV) | công ty đơn-vùng: `payroll_statutory_rates` lưu **một** mức áp dụng (§13.7). Đa vùng cần cột `region` + bản đồ `org_unit → vùng` |

> **v2 LẤY LẠI từ PARK-PAYROLL-001** (không còn park): engine BHXH/BHYT/BHTN/TNCN luỹ tiến (PAY-DEC-014) · PDF phiếu lương + export batch signed-URL (PAY-DEC-019) · report theo phòng ban + variance dưới dạng **7 báo cáo** (PAY-DEC-018). RELEASE-14 §5 được cập nhật cùng WO này.

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
| Trạng thái | `status` | 🔁 **v2: 8 giá trị** §17.15 *(v1: 7 — thêm `Published`)*; FSM §13.1 |
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

### 8.2 **v2** — ALTER 3 bảng (**DB-1 lấy 2 · DB-2 lấy 1**) + 11 bảng mới

Chi tiết cột/kiểu/CHECK/index/RLS: **DB-13 §12–§14**. Mọi bảng mới có `company_id` + **RLS ENABLE + FORCE** + **composite tenant FK** + soft delete (trừ bảng sổ), và **neo theo `user_id`** cho nhất quán với §8.1 (không mở lại nợ `employee_id`).

**A. Ba bảng ALTER — chia cho HAI WO, KHÔNG gộp**

| Bảng | WO | Cột THÊM | Ghi chú |
| --- | --- | --- | --- |
| `salary_profiles` | **DB-1** (§12.1) | `salary_type` · `pit_payer` · `insurance_salary` · `probation_salary` · `pay_ratio_pct` | `salary_type ∈ {GROSS, NET}` **default `GROSS`** (PAY-DEC-015 — cột MỚI, band `0091` bất khả xâm phạm) · `pit_payer ∈ {EMPLOYEE, COMPANY}` default `EMPLOYEE` (ai chịu TNCN — §13.7) · `insurance_salary numeric(18,2)` NULL = «dùng `base_salary`» · `probation_salary numeric(18,2)` NULL · `pay_ratio_pct numeric(5,2)` default `100.00`, CHECK `> 0 AND <= 100` |
| `payroll_periods` | 🔴 **DB-2** (§12.3) | `template_id` · `paid_by` · `paid_at` | mẫu bảng lương gắn vào kỳ (PAY-DEC-013) · vết chuyển `Published → Paid` (PAY-DEC-017). **CẢ BA cột + nới `status_check` + backfill `Paid → Published` + hai CHECK cặp là MỘT chuỗi 4 bước nguyên tử** (§12.3) ⇒ **KHÔNG tách cho DB-1**, kể cả `template_id`: tách bước (2) khỏi bước (3) là `23514` giữa lane migration |
| `payroll_period_lines` | **DB-1** (§12.4) | `component_values_json` · `template_fingerprint` · `gross_up_iterations` | snapshot giá trị **từng thành phần** (§13.6) · băm tập công thức hiệu lực lúc tính (§3.10) · số vòng gross-up, NULL nếu `salary_type = GROSS` |

> ⚠️ **Trùng TÊN, khác NGHĨA — `salary_type`:** `employee_profiles.salary_type` **đã tồn tại** (`employees.ts:59`, CHECK `emp_salary_type_check` ∈ `monthly`/`hourly`/`project`) và **KHÔNG liên quan** tới `salary_profiles.salary_type` ∈ `GROSS`/`NET` mà v2 dựng. Hai cột khác bảng, khác tập giá trị, khác CHECK. Đặt tên khác đi (`gross_net_mode`) thì lệch benchmark và lệch PAY-DEC-015 đã ký; ⇒ **giữ tên, ghi cảnh báo ở đây + ở DB-13 §12.1 + trong comment schema**, và tên CHECK phải là **`salary_profiles_salary_type_check`** (có tiền tố bảng) để không ai grep nhầm.
>
> ⚠️ **`allowances` jsonb → `salary_profile_items` đi theo EXPAND-CONTRACT** (`migration-expand-contract-required`): DB-1 **THÊM** bảng mới + backfill, **GIỮ** cột `allowances` đọc-được; contract (gỡ cột) là WO **sau**, không cùng lượt. PROD chưa chạy v1 ngày nào ⇒ **đo số hàng trước**, kỳ vọng 0 trên PROD nhưng **≠ 0 trên lane/dev**.

**B. Mười một bảng mới**

| # | Bảng | Vai trò | Neo / khoá | WO |
| --- | --- | --- | --- | --- |
| 1 | `salary_profile_items` | Phụ cấp / khấu trừ **có định mức** của một phiên bản hồ sơ lương | `salary_profile_id` + `component_code`; UNIQUE `(company_id, salary_profile_id, component_code)` | DB-1 |
| 2 | `payroll_employee_settings` | Thiết lập BH · công đoàn · **tài khoản ngân hàng** của một nhân sự | **1 hàng / (company, user)** — UNIQUE | DB-1 |
| 3 | `payroll_dependents` | Người phụ thuộc giảm trừ TNCN | `user_id` + khoảng `[effective_from, effective_to]`; **cấm chồng lấp cùng NPT** (⇒ **ERR-032**) | DB-1 |
| 4 | `salary_components` | **Catalog thành phần lương** — hệ thống (seed) + tự thêm | `code` UNIQUE `(company_id, code)`; `is_system` | DB-1 |
| 5 | `payroll_templates` | **Mẫu bảng lương** (toàn công ty hoặc theo `org_unit`) | `(company_id, code)` UNIQUE | DB-1 |
| 6 | `payroll_template_components` | Thành phần trong một mẫu: nhãn cột · **công thức ghi đè** · ẩn/hiện · thứ tự | UNIQUE `(company_id, template_id, component_id)` | DB-1 |
| 7 | `payroll_statutory_rates` | **Tỉ lệ / trần / bậc thuế luật định** versioned theo `effective_from` | UNIQUE `(company_id, effective_from)` | DB-1 |
| 8 | `payroll_advances` | **Tạm ứng** — FSM `Pending → Approved/Rejected → Deducted` | `user_id` + `deduct_period_month`; bind `payroll_period_id`/`consumed_at` khi đã khấu trừ | DB-2 |
| 9 | `payroll_payment_batches` | **Đợt chi trả** của một kỳ (bank/cash) | `payroll_period_id`; trạng thái `Draft → Ready → Completed` | DB-2 |
| 10 | `payroll_payment_lines` | Dòng chi trả per nhân sự trong một đợt | UNIQUE `(company_id, batch_id, user_id)` | DB-2 |
| 11 | `payroll_budgets` | **Ngân sách lương** năm × đơn vị | UNIQUE `(company_id, fiscal_year, org_unit_id)` | DB-2 |

**C. Ba ràng buộc cấu trúc bắt buộc, KHÔNG để WO tự quyết**

1. **`salary_components.code` là KHÔNG GIAN TÊN DÙNG CHUNG với biến hệ thống của máy công thức.** Mã người dùng đặt **cấm tiền tố `SYS_`/`TL_`/`GT_`** (`salary_components_code_shape_check`) và **cấm trùng** mọi mã hệ thống đã seed (`salary_components_company_code_uq` + verify migration). Thiếu ràng buộc này, một thành phần tên `SYS_GROSS` **che** biến hệ thống trong mọi công thức — đúng lớp lỗi shadowing, không CHECK nào bắt (§13.6).
   - ⚠️ **Hai chốt trên KHÔNG đủ cho bốn nút `aggregate`** (`TONG_THU_NHAP` · `TONG_BH_NV` · `THU_NHAP_CHIU_THUE` · `TONG_KHAU_TRU`): chúng **không mang tiền tố nào** nên `code_shape_check` bỏ qua, và `company_code_uq` là **partial `WHERE deleted_at IS NULL`** nên **một lượt xoá mềm hàng seed là mở đường tạo lại mã đó với công thức tuỳ ý**. ⇒ chốt thứ ba, ở DB: **`salary_components_system_not_deletable`** (`is_system = false OR deleted_at IS NULL` — DB-13 §13.4). «Hàng hệ thống không xoá» ép ở service là **một quy ước**, không phải bất biến.
2. **`payroll_advances` dùng CẶP `(payroll_period_id, consumed_at)` NULL/NOT NULL** làm khoá chống khấu trừ hai lần — **cùng khuôn `bonus_penalties`** (§13.3), kèm CHECK cặp. Sao chép khuôn đã có thay vì phát minh cờ mới là có chủ đích: cùng một lớp lỗi thì cùng một chốt cuối.
3. **`payroll_payment_lines` KHÔNG lưu lại số tiền của phiếu** — nó tham chiếu `payslip_id` và đọc số từ đó. Lưu bản sao là đẻ nguồn sự thật thứ hai cho **cùng một khoản tiền**, và khi lệch thì không ai biết bên nào đúng. Số tài khoản ngân hàng thì **CÓ** đóng băng vào dòng chi trả (`bank_account_snapshot`) — vì nhân sự đổi tài khoản sau ngày chi thì tệp UNC đã gửi ngân hàng phải giải thích được bằng số **lúc gửi**.

---

## 9. Danh sách màn hình

| Mã | Màn hình | Ghi chú |
| --- | --- | --- |
| PAY-SCREEN-001 | Danh sách kỳ lương (`/payroll/periods`) | Bảng + lọc tháng/trạng thái; chip trạng thái 🔁 **8 giá trị (v2)** *(v1: 7)*; nút «+ Kỳ lương»; **không hiện số tiền** (cặp `view:payroll-period` không nhạy cảm) |
| PAY-SCREEN-002 | Chi tiết kỳ lương (`/payroll/periods/:id`) | Bảng lương theo nhân sự (gross/khấu trừ/net) + **thanh hành động theo FSM** (gom · tính · gửi duyệt · duyệt/từ chối · phát hành · khoá · mở lại) + **hộp cảnh báo dữ liệu thiếu**; nút không hiện thay vì hiện rồi 409; ô tiền `tabular-nums`, mask per-row theo quyền |
| PAY-SCREEN-003 | Phiếu lương chi tiết (`/payroll/payslips/:id`) | Breakdown giải-thích-được: từng `payslip_item` + đầu vào công/phép; chỉ với cặp `view-payslip` |
| PAY-SCREEN-004 | Hồ sơ lương nhân sự (`/payroll/salary-profiles`) | Danh sách + **lịch sử phiên bản theo `effective_date`**; form tạo phiên bản mới (không sửa quá khứ đã bị kỳ đã tính tham chiếu — snapshot đóng băng nên an toàn); chọn người qua **`PAYROLL-API-034`** (role `payroll-officer` không có cặp HR) |
| PAY-SCREEN-005 | Thưởng/phạt/khấu trừ kỳ (`/payroll/bonus-penalties`) | Danh sách theo `period_month` + trạng thái; tạo/sửa khi `Pending`; duyệt/từ chối (nút ẩn với chính người tạo — four-eyes); badge «đã vào kỳ …» khi đã consume |
| PAY-SCREEN-006 | «Phiếu lương của tôi» (`/me/payslips`) | Own — danh sách kỳ đã phát hành + chi tiết breakdown + nút **Xác nhận**; deep-link từ NOTI `PAYSLIP_PUBLISHED` |

Mọi màn: `<PermissionGate>` + `useCan()`, trạng thái loading/error/empty (§14), i18n vi namespace `payroll`, nhãn trạng thái dùng constants chuẩn SPEC-01 §17.15–17.17, **mọi trường tiền khai `.optional()` trong FE schema** (server mask = vắng khoá — `server-masking-needs-optional-fe-schema`).

> ⚠️ **PAY-SCREEN-006 sống trong app ME, không phải PAYROLL** — đo 11/09/2026: route `/me/payslips`, `moduleCode` **`ME`**, gác `access:me` + `view-own-payslip:payslip` (`sidebar-registry`, pin ở `payroll-wiring.spec.ts`). v2 thêm **PAY-SCREEN-017 «Tạm ứng của tôi»** cùng khuôn đó — nó cũng thuộc ME, **không** kéo `access:payroll` vào.

### 9.1 **v2** — PAY-SCREEN-007..017

| Mã | Màn hình | Cặp gác (§11.3) | Ghi chú |
| --- | --- | --- | --- |
| PAY-SCREEN-007 | **Nhân viên** (`/payroll/employees`, chi tiết `/payroll/employees/:userId`) | danh sách + tab «Thông tin chung» ← `('view','payroll-employee')` | Chi tiết **5 tab** (PAY-DEC-016): **Thông tin chung** (chiếu HR bó hẹp) · **Lịch sử lương** ← `('view','salary-profile')` · **Bảo hiểm–Công đoàn** ← `('view','payroll-employee')` (**số TK chỉ 4 số cuối**) · **Thuế TNCN** ← **CẢ HAI** `('view','salary-profile')` *(cho `tax_code`)* **VÀ** `('view','payroll-employee')` *(cho NPT)* · **Gia đình** (người phụ thuộc) ← `('view','payroll-employee')`. Tab thiếu cặp thì **ẩn tab**, không render tab rỗng |
| PAY-SCREEN-008 | **Bảng công kỳ** (`/payroll/periods/:id/timesheet`) | `('view-line','payroll-period')` | Bảng công tổng hợp per nhân sự của kỳ (công · phép có/không lương · phút trễ), **nguồn ATT, chỉ ĐỌC**; hiện trạng khoá kỳ công. **Không số tiền** |
| PAY-SCREEN-009 | **Thành phần lương** (`/payroll/salary-components`) | đọc ← `('view','salary-component')` · ghi ← `('manage','salary-component')` | Catalog + **editor công thức** có kiểm cú pháp/vòng **tại chỗ** (API-048); thành phần hệ thống hiện huy hiệu «hệ thống», nút Xoá **ẩn** |
| PAY-SCREEN-010 | **Mẫu bảng lương** (`/payroll/templates`, chi tiết `/payroll/templates/:id`) | đọc ← `('view','payroll-template')` · ghi ← `('manage','payroll-template')` | Danh sách + chi tiết (thành phần · nhãn cột · công thức ghi đè · ẩn/hiện · thứ tự kéo-thả) + **Xem trước** với dữ liệu giả (API-054) |
| PAY-SCREEN-011 | **Tỉ lệ luật định** (`/payroll/settings/statutory-rates`) | đọc ← `('view','statutory-rate')` · ghi ← `('manage','statutory-rate')` | Danh sách bản theo `effective_from` + form (tỉ lệ NV/DN · trần · 7 bậc TNCN · giảm trừ). Băng cảnh báo **«hệ thống lưu và áp số này, không khẳng định đúng luật»** (§3.11) |
| PAY-SCREEN-012 | **Tạm ứng** (`/payroll/advances`) | đọc ← `('view','payroll-advance')` · ghi ← `('manage','payroll-advance')` · duyệt ← `('approve','payroll-advance')` | Danh sách + form + duyệt/từ chối; nút duyệt **ẩn với chính người tạo** (four-eyes); badge «đã khấu trừ vào kỳ …» |
| PAY-SCREEN-013 | **Chi trả** (`/payroll/payment-batches`, chi tiết `/payroll/payment-batches/:id`) | đọc ← `('view','payment-batch')` · ghi/xuất/hoàn tất ← `('manage','payment-batch')` | Đợt chi · dòng chi trả · **xuất tệp UNC** · **Hoàn tất** ⇒ kỳ `Paid`. Nút Hoàn tất **ẩn** khi kỳ chưa `Published` hoặc còn dòng chưa chi (thay vì hiện rồi 409) |
| PAY-SCREEN-014 | **Ngân sách lương** (`/payroll/budgets`) | đọc ← `('view','payroll-budget')` · ghi ← `('manage','payroll-budget')` | Ngân sách năm × đơn vị + cột thực hiện/chênh lệch |
| PAY-SCREEN-015 | **Tổng quan** (`/payroll`) | `('view','payroll-report')` **+ SÀN scope `Company`** | 6 khối biểu đồ (Recharts) + **Lời nhắc** 3 loại (phiếu chưa phát hành · NV chính thức chưa tham gia BH · lương đóng BH ngoài quy định). **Là trang gốc `/payroll`** — người không có cặp này vào `/payroll` được **chuyển hướng** tới màn đầu tiên họ mở được, không thấy trang trắng |
| PAY-SCREEN-016 | **Báo cáo** (`/payroll/reports`, xem `/payroll/reports/:reportCode`) | `('view','payroll-report')` **+ SÀN scope `Company`**; xuất XLSX thêm `('export','payroll')` | Danh mục 7 báo cáo (**lọc theo quyền** — báo cáo không mở được thì **không liệt kê**) + màn xem có lọc kỳ/đơn vị + nút xuất |
| PAY-SCREEN-017 | **«Tạm ứng của tôi»** (`/me/payroll-advances`) — **module ME**, không phải PAYROLL | `('view-own','payroll-advance')` | Own; **cùng khuôn PAY-SCREEN-006**. Cấp **mã riêng** thay vì biến thể `012b` vì v1 đã có tiền lệ: «Phiếu lương của tôi» mang mã `006` chứ không phải `005b`. ⚠️ Lệch hồ sơ wave S15 (ghi «PAY-SCREEN-007..016») — **đính chính có chủ đích**, xem §5.1b |

**Sidebar PAYROLL v2** (DEC-020 — nhóm gập được): **Tổng quan** · **Nhân viên** · **Thành phần lương** · **Mẫu bảng lương** · **Dữ liệu tính lương ▸** (Bảng công · Thu nhập/khấu trừ khác) · **Tính lương ▸** (Kỳ lương · Tạm ứng · Ngân sách) · **Chi trả** · **Báo cáo** · **Thiết lập ▸** (Tỉ lệ luật định). Sidebar **ME** thêm «Phiếu lương của tôi» *(đã có)* + «Tạm ứng của tôi» *(mới)*.

> ⚠️ **Mọi mục sidebar gác bằng `useCan()` trên ĐÚNG cặp của màn đó, và nhóm cha ẩn khi mọi con đều ẩn** — nhóm gập được chứa 0 mục hiển thị là một mũi tên bấm vào không có gì, đúng lớp lỗi `capability-allowlist-hides-admin-screens` nhìn từ phía ngược lại.
>
> ⚠️ **17 cặp mới đều `is_sensitive = true` ⇒ PHẢI khai vào CẢ HAI danh sách ở BACKEND** (`sensitive-capability-allowlist-is-backend`): `SENSITIVE_CAPABILITY_ALLOWLIST` (`permission.service.ts:43`, khối PAYROLL `205–226`) **VÀ** `SENSITIVE_SCREEN_GATE_PAIRS` (`:246`, khối PAYROLL `283–297`, khoá bởi `sensitive-screen-gate-allowlist.spec.ts`). Đo 11/09/2026: v1 khai **13** cặp ở cả hai chỗ. Khai một bên quên bên kia = màn **ẩn với chính người được cấp quyền**.

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
| PAYROLL-FUNC-010 | Phát hành phiếu lương | 🔁 **v2: `Approved → Published`** *(v1: `Approved → Paid`)*: mở cho nhân viên + NOTI-EVENT-023 từng người; kỳ chưa sinh phiếu ⇒ 007 |
| PAYROLL-FUNC-011 | Khoá / mở lại kỳ | `Paid → Locked` (khoá luôn chỉnh công ATT tháng đó); mở lại về `CollectingData` **chỉ khi chưa sinh phiếu** (004), lý do bắt buộc + audit |
| PAYROLL-FUNC-012 | «Phiếu lương của tôi» + xác nhận | Own: danh sách + chi tiết breakdown; xác nhận ghi 1 hàng `payslip_acknowledgements`; phiếu chưa phát hành ⇒ 015 |
| PAYROLL-FUNC-013 | Export bảng lương XLSX | theo kỳ, cặp `('export','payroll')` **+** `('view-line','payroll-period')` (§18); **audit bắt buộc**; > 10.000 dòng ⇒ 422 (016) |
| PAYROLL-FUNC-014 | Chi phí lương kỳ | tổng gross/net + headcount + trạng thái kỳ gần nhất — nguồn widget DASH (`/payroll-periods/summary`) |

### 10.1 Mã widget dashboard (SPEC-01 §9.9)

| Mã | widget_code | Tên | Nguồn | Gate |
| --- | --- | --- | --- | --- |
| **PAYROLL-WIDGET-001** | `PAYROLL_COST` | Chi phí lương kỳ (slug `payroll-cost`, mig `0568` — **ĐÃ SHIP** `S13-PAYROLL-DASH-1`) | PAYROLL-FUNC-014 / PAYROLL-API-018 (`PayrollCalcService.summary` — một công thức, một con số) | cặp **`('view-line','payroll-period')`** (nhạy cảm, **cặp ĐỌC thuần** — payload CHỨA SỐ TIỀN nên không dùng được `view:payroll-period`; và gác bằng cặp GHI `calculate` thì «ai thấy widget đều ghi được lương») **+ SÀN scope `Company`** (`DASH_WIDGET_MIN_DATA_SCOPE` — `summary` cộng toàn công ty nên grant hẹp hơn không được serve) |

Ba điều chốt thêm khi triển khai (`S13-PAYROLL-DASH-1`):

- **Nguồn là `PayrollCalcService.summary`**, không phải `PayrollPeriodsService` — BE-2 đặt `summary()` cạnh `PayrollCalcRepository.latestSummaryTx`. Bảng trên đã đính chính; route và công thức không đổi.
- **Sàn scope `Company` ép ở HAI tầng độc lập** — `DashboardWidgetRegistryService.filterByGatePair` (đường METADATA `/dashboard/me`) và `DashboardWidgetPayrollHandlers.gatePayrollCost` (đường DATA). `companyFloor` mà `PayrollAccessService` ép ở route 018 **không** gác được đường metadata (đường đó không gọi service PAYROLL), nên hai tầng này là bắt buộc, không phải thừa.
- **Audit lượt xem widget chỉ có trên cache MISS.** Cache của widget là company-shared, TTL 300s ⇒ lượt xem thứ hai trong TTL không chạy `fetch` nên không đẻ hàng `audit_logs`. Chấp nhận được: §20.12 chỉ đòi +1 hàng/lượt cho `/lines` · `/payslips/:id` · `/salary-profiles`, widget không nằm trong đó. Nếu về sau cần vết per-view, chỗ sửa là `gateAndResolve` (chạy mọi lần serve), không phải `fetch`.

#### 10.1b **v2** — hai widget mới (`S15-PAYROLL-DASH-1`)

| Mã | widget_code | Tên | Nguồn | Gate |
| --- | --- | --- | --- | --- |
| **PAYROLL-WIDGET-002** | `PAYROLL_BUDGET` | Ngân sách lương năm (kế hoạch · thực hiện · chênh lệch; slug `payroll-budget`) | PAYROLL-FUNC-026 / `PAYROLL-API-073` | cặp **`('view','payroll-budget')`** + **SÀN scope `Company`** |
| **PAYROLL-WIDGET-003** | `PAYROLL_ADVANCE_PENDING` | Tạm ứng chờ duyệt (ĐẾM; slug `payroll-advance-pending`) | PAYROLL-FUNC-024 / `PAYROLL-API-059` (`status=Pending`, chỉ `total`) | cặp **`('view','payroll-advance')`** + **SÀN scope `Company`** |

- **Cả hai sàn scope `Company` ép ở HAI tầng độc lập** — `DashboardWidgetRegistryService.filterByGatePair` (đường METADATA) **và** handler dữ liệu (đường DATA). Sàn ở service PAYROLL **không** gác được đường metadata (`dash-widget-gate-needs-scope-floor`).
- **Cả hai cặp gác là `is_sensitive = true`** ⇒ FE dùng **`useCanExact`**, **không** `<PermissionGate>` (`sensitive-pair-widget-needs-usecanexact`), và slug phải khớp bản đồ slug FE (`fe-widget-slug-map-is-unchecked-runtime-gate`).
- **WIDGET-003 chỉ trả `total`** — không tên người, không số tiền. Đếm là dữ liệu ít nhạy cảm nhất thoả được yêu cầu «biết có việc cần duyệt».
- ⚠️ **Cache hit bỏ qua audit** vẫn đúng như WIDGET-001 (`widget-cache-hit-skips-audit-trail`) — chấp nhận cùng lý do, §20.12 không đòi vết per-view cho widget.

### 10.2 **v2** — chức năng PAYROLL-FUNC-015..030

| Mã | Chức năng | Mô tả ngắn |
| --- | --- | --- |
| PAYROLL-FUNC-015 | Danh sách + chi tiết **Nhân viên PAYROLL** | chiếu HR **bó hẹp** qua route PAYROLL (PAY-DEC-016); `tax_code` chỉ khi có `('view','salary-profile')` + audit lượt xem |
| PAYROLL-FUNC-016 | **Thiết lập BH · công đoàn · tài khoản ngân hàng** | 1 hàng/nhân sự; số TK **mask 4 số cuối** ở mọi DTO (§3.12) |
| PAYROLL-FUNC-017 | **Người phụ thuộc** giảm trừ TNCN | khoảng hiệu lực; **cấm chồng lấp** cùng một NPT (⇒ 032) |
| PAYROLL-FUNC-018 | **Hồ sơ lương v2** | NET/GROSS · đối tượng TNCN · lương BH · lương thử việc · tỉ lệ hưởng · phụ cấp/khấu trừ **có định mức** (`salary_profile_items`) |
| PAYROLL-FUNC-019 | **Bảng công tổng hợp kỳ** (ĐỌC) | tái dùng `computeInputsTx` của v1 — **cùng một bộ số** mà `calculate` sẽ dùng, không viết truy vấn thứ hai (hai bộ số lệch nhau là lớp lỗi đã ghi ở §13.1) |
| PAYROLL-FUNC-020 | **Catalog thành phần lương** + kiểm công thức | CRUD; parse + kiểm cú pháp · tham chiếu · vòng · giới hạn khi LƯU (⇒ 018/019) |
| PAYROLL-FUNC-021 | **Mẫu bảng lương** + xem trước | CRUD + đặt lại danh sách thành phần; **xem trước với dữ liệu giả**, không chạm dữ liệu thật |
| PAYROLL-FUNC-022 | **Tỉ lệ luật định** versioned | CRUD theo `effective_from`; kỳ dùng bản hiệu lực **tại ngày cuối kỳ** (⇒ 022 nếu thiếu) |
| PAYROLL-FUNC-023 | **Máy tính lương v2** | evaluate theo mẫu của kỳ + engine BH/KPCĐ/đoàn phí + TNCN 7 bậc + giảm trừ NPT + **NET gross-up**; snapshot `component_values_json` (§13.6–§13.8) |
| PAYROLL-FUNC-024 | **Tạm ứng** | FSM `Pending → Approved/Rejected → Deducted`, four-eyes; tự thành khoản khấu trừ ở kỳ chỉ định |
| PAYROLL-FUNC-025 | **Đợt chi trả** + tệp UNC | lập từ kỳ `Published`; bank/cash; XLSX theo mẫu (**số TK đầy đủ** — đường DUY NHẤT); **hoàn tất ⇒ kỳ `Paid`** |
| PAYROLL-FUNC-026 | **Ngân sách lương** năm/đơn vị | kế hoạch vs thực hiện; nguồn widget 002 |
| PAYROLL-FUNC-027 | **Import Excel** thu nhập/khấu trừ khác | khuôn import HR; đổ vào `bonus_penalties` ở trạng thái `Pending` — **không tự duyệt** |
| PAYROLL-FUNC-028 | **Tổng quan module** + Lời nhắc | 6 khối + 3 loại lời nhắc; **KHÔNG cache** |
| PAYROLL-FUNC-029 | **7 báo cáo** | SQL set-based, phân trang, XLSX; sàn scope Company + audit mỗi lượt; **KHÔNG cache** |
| PAYROLL-FUNC-030 | **PDF phiếu lương** | sinh server từ **snapshot `payslip_items`** (không tính lại); font Việt nhúng; signed-URL; Own + batch |

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

### 11.3 **v2** — 17 cặp MỚI (tất cả `is_sensitive = true`)

| Cặp quyền | Mã hiển thị | Ý nghĩa | Nhân viên | Manager · HR | Payroll Officer | Company Admin |
| --- | --- | --- | --- | --- | --- | --- |
| `('view','payroll-employee')` | `PAYROLL.EMPLOYEE.VIEW` | đọc thiết lập BH/công đoàn/**TK ngân hàng (4 số cuối)** + người phụ thuộc + chiếu HR bó hẹp | — | — | Company | Company |
| `('manage','payroll-employee')` | `PAYROLL.EMPLOYEE.MANAGE` | ghi hai bảng đó | — | — | Company | Company |
| `('view','salary-component')` | `PAYROLL.COMPONENT.VIEW` | đọc catalog thành phần lương **+ công thức** | — | — | Company | Company |
| `('manage','salary-component')` | `PAYROLL.COMPONENT.MANAGE` | tạo/sửa thành phần **+ sửa công thức** | — | — | Company | Company |
| `('view','payroll-template')` | `PAYROLL.TEMPLATE.VIEW` | đọc mẫu bảng lương + công thức ghi đè | — | — | Company | Company |
| `('manage','payroll-template')` | `PAYROLL.TEMPLATE.MANAGE` | tạo/sửa mẫu · đặt thành phần · xem trước | — | — | Company | Company |
| `('view','statutory-rate')` | `PAYROLL.STATUTORY.VIEW` | đọc bảng tỉ lệ luật định | — | — | Company | Company |
| `('manage','statutory-rate')` | `PAYROLL.STATUTORY.MANAGE` | tạo/sửa bản tỉ lệ theo ngày hiệu lực | — | — | **—** | Company |
| `('view','payroll-advance')` | `PAYROLL.ADVANCE.VIEW` | đọc tạm ứng của mọi người | — | — | Company | Company |
| `('manage','payroll-advance')` | `PAYROLL.ADVANCE.MANAGE` | tạo · sửa khi `Pending` · xoá mềm | — | — | Company | Company |
| `('approve','payroll-advance')` | `PAYROLL.ADVANCE.APPROVE` | duyệt / từ chối (tự duyệt bị chặn) | — | — | Company | Company |
| `('view-own','payroll-advance')` | `PAYROLL.ADVANCE.VIEW-OWN` | «Tạm ứng của tôi» | **Own** | — | — | — |
| `('view','payment-batch')` | `PAYROLL.BATCH.VIEW` | đọc đợt chi trả + dòng chi | — | — | Company | Company |
| `('manage','payment-batch')` | `PAYROLL.BATCH.MANAGE` | lập đợt · sửa dòng · **hoàn tất đợt** (⇒ kỳ `Paid` khi PHỦ ĐỦ — §13.1). ⚠️ **KHÔNG đủ để xuất tệp UNC**: `071` assert **BA cặp** `manage:payment-batch` + `export:payroll` + `view-payslip:payslip` (§15.1) | — | — | Company | Company |
| `('view','payroll-budget')` | `PAYROLL.BUDGET.VIEW` | đọc ngân sách lương + thực hiện | — | — | Company | Company |
| `('manage','payroll-budget')` | `PAYROLL.BUDGET.MANAGE` | lập/sửa ngân sách năm × đơn vị | — | — | **—** | Company |
| `('view','payroll-report')` | `PAYROLL.REPORT.VIEW` | Tổng quan module + 7 báo cáo | — | — | Company | Company |

**Bảy ghi chú BẮT BUỘC của v2:**

1. **TẤT CẢ 17 cặp là `is_sensitive = true` — có chủ đích, kể cả `view:statutory-rate`.** Tỉ lệ luật định là hằng pháp luật công khai, nhưng nó **chở số tiền** (trần đóng = 20× lương cơ sở, ngưỡng 7 bậc thuế, mức giảm trừ). Quy tắc của module là «số tiền không đi qua cặp không nhạy cảm» (§11.1); phân biệt «tiền công khai» với «tiền của công ty» là một lập luận phải làm lại ở mỗi lượt review, còn fail-closed thì không. ⇒ **tổng sau v2: 34 cặp, 30 sensitive, 4 không sensitive** (đúng 4 cặp cũ của §11.1).
2. **Hệ quả trực tiếp: 30 cặp phải nằm trong CẢ HAI danh sách backend.** `SENSITIVE_CAPABILITY_ALLOWLIST` (`permission.service.ts:43`) và `SENSITIVE_SCREEN_GATE_PAIRS` (`:246`) — **APPEND, không rewrite** (hot-file, CLAUDE.md §9.3). Đo v1 = 13 mục mỗi bên ⇒ sau v2 = **30 mục mỗi bên**, và `sensitive-screen-gate-allowlist.spec.ts` phải siết **cùng commit**.
3. **Hai cặp KHÔNG gán `payroll-officer`** — `('manage','statutory-rate')` và `('manage','payroll-budget')`. Lý do khác nhau và cả hai đều **không phải four-eyes**: tỉ lệ luật định đổi là đổi tiền của **mọi kỳ tương lai** cho **mọi người** (quyết định cấp công ty, không phải thao tác vận hành); ngân sách là cam kết tài chính của BOD. Officer **đọc** được cả hai (cần để tính và để đối chiếu), chỉ không ghi.
4. **`('manage','payment-batch')` LÀ một cặp đổi được trạng thái kỳ** (`Published → Paid`, API-072) — ghi tường minh vì nó **không** hiện ra trong tên cặp. Chấp nhận được vì: kỳ phải **đã** `Published` (cần `('publish','payroll-period')` của người khác hoặc lượt trước), `Paid` **không** mở thêm quyền nào, và `reopen` vốn đã bị chặn từ khi sinh phiếu. **Không** cấp `('complete','payment-batch')` riêng — cặp thứ 18 cho một nút bấm là chi phí không đổi lấy được gì.
5. **KHÔNG cấp `('export','payslip-pdf')`.** PAY-DEC-019 đã ký «`('export','payroll')` cho batch, **Own** cho phiếu của mình». Vì vậy: PDF hàng loạt (API-085) assert **`('export','payroll')` + `('view-payslip','payslip')`** — đúng luật «export đòi CẢ HAI cặp» của §11.1, chỉ khác là vế đọc ở đây là **phiếu** chứ không phải **dòng bảng lương**; PDF phiếu của chính mình (API-084) chỉ cần `('view-own-payslip','payslip')`, **không** cần cặp export.
6. **Cặp Own của v2 dùng dạng SẠCH `('view-own','payroll-advance')`**, không bắt chước dạng action-carries-resource `view-own-payslip`. Ba cặp họ `payslip` giữ tên cũ **chỉ vì** chúng có grant di sản đang sống (§11.1); cặp mới không có ràng buộc đó, và nhân bản một quy ước đặt tên xấu chỉ để «cho giống» là nợ.
7. **Ma trận seed v2 = 31 hàng `role_permissions` MỚI** (cộng vào 32 hàng của v1 ⇒ **63**): `employee` **+1** (`view-own:payroll-advance`@Own) · `manager` **+0** · `hr` **+0** · `hr-manager` **+0** · `payroll-officer` **+14** (17 − `manage:statutory-rate` − `manage:payroll-budget` − `view-own:payroll-advance`) · `company-admin` **+16** (17 − `view-own:payroll-advance`). **Phép cộng: 1 + 0 + 0 + 0 + 14 + 16 = 31; 32 + 31 = 63.** Migration **verify fail-loud ĐÚNG số**, và verify thêm hai điều kiện tự-nhất-quán mới:
   - mọi role giữ `('manage','payroll-template')` **phải** giữ `('view','salary-component')` — mẫu tham chiếu mã thành phần, không đọc được catalog thì editor mẫu là ô trống;
   - mọi role giữ `('approve','payroll-advance')` **phải** giữ `('view','payroll-advance')` — kẻo **duyệt mù**, đúng lớp lỗi mà §11.1 đã chặn cho `approve:payroll-period`.
   - ⚠️ Như §11.1 đã ghi: verify chỉ đúng **tại thời điểm migration**; `permission-admin` gỡ được lúc runtime. QA có ca đối chứng (§21.1).
8. 🔴 **LUẬT «ROUTE GHI KHÔNG CHỞ SỐ TIỀN» ÁP NGUYÊN CHO v2 — sáu cặp mới tách view/manage thì sáu lần luật này phải được ép.** §11.1 đã dựng luật cho v1 (`collect`/`calculate`/`adjust-line` trả envelope **0 khoá tiền**); v2 đẻ thêm sáu cặp `view`/`manage` mà **vế `manage` chở tiền trong payload**, nên thiếu luật là role chỉ giữ `manage:*` **đọc được tiền qua cửa sau** và **không cổng nào chạm tới** (§14/§21 cấm ca mask per-row).

   **Bảy route GHI phải trả `PayrollWriteResultDto` — 0 khoá tiền, danh sách ĐÓNG:**

   | Mã | Route | Cặp GHI | Tiền nằm ở đâu (cần cặp ĐỌC) |
   | --- | --- | --- | --- |
   | 039 | `PUT /payroll/employees/:userId/settings` | `manage:payroll-employee` | 038 (`view:payroll-employee`) |
   | 060 | `POST /payroll/advances` | `manage:payroll-advance` | 059 / 061 (`view:payroll-advance`) |
   | 062 | `PATCH /payroll/advances/:id` | `manage:payroll-advance` | 061 (`view:payroll-advance`) |
   | 067 | `POST /payroll/payment-batches` | `manage:payment-batch` | 066 / 068 (`view:payment-batch`) |
   | 069 | `PATCH /payroll/payment-batches/:id` | `manage:payment-batch` | 068 / 070 (`view:payment-batch`) |
   | 074 | `POST /payroll/budgets` | `manage:payroll-budget` | 073 (`view:payroll-budget`) |
   | 075 | `PATCH /payroll/budgets/:id` | `manage:payroll-budget` | 073 (`view:payroll-budget`) |

   Envelope = `{ id, status?, affectedRows?, warnings[] }` — **không** `amount`, **không** `plannedAmount`, **không** `totalNet`, **không** `bankAccount*`. FE tải lại qua route ĐỌC. *(072 `complete` trả `{ periodStatus, unpaidPayees }` — `unpaidPayees` là **số người**, không phải tiền.)*

   **Điều kiện tự-nhất-quán đi kèm (verify ở migration, DB-13 §15.3 bước B):** **mọi role giữ `manage:X` đều phải giữ `view:X`** cho `payroll-advance` · `payment-batch` · `payroll-budget` · `salary-component`. Không phải vì tiện dụng: nếu một role có `manage` mà không có `view`, nó **không có đường hợp lệ nào để đọc lại số nó vừa ghi**, và đó chính là áp lực làm WO sau nhét số tiền vào envelope GHI «cho đỡ phải gọi hai lần». Đóng đường đó ở tầng dữ liệu rẻ hơn đóng ở tầng ý chí.

---

## 12. Quy tắc nghiệp vụ và mã lỗi

`error.details` là **mảng** `ErrorDetail {field, message, rule}` (API-01; `details.kind` = phần tử `field:"kind"`). Vế "lỗi hình thức" (thiếu `reason`, `amount ≤ 0`, `period_month` sai định dạng, khoá lạ trong PATCH `.strict()`, `:id` không phải UUID) chặn ở Zod ⇒ **400 `VALIDATION-ERR-001`** — không chiếm mã dưới đây.

| Mã lỗi | HTTP | Quy tắc |
| --- | --- | --- |
| PAYROLL-ERR-001 | 409 | Chuyển **trạng thái kỳ lương** không hợp lệ theo FSM §13.1 (kể cả chuyển tới chính trạng thái hiện tại). Thông điệp nêu from/to |
| PAYROLL-ERR-002 | 409 | Tính lương khi **kỳ công ATT chưa `locked`** (`kind = attendance-not-locked`) hoặc kỳ lương **chưa gắn `attendance_period_id`** (`kind = attendance-period-missing`) |
| PAYROLL-ERR-003 | 409 | Tính lại / điều chỉnh dòng khi kỳ đã **≥ `Approved`** (`kind = period-frozen`) — snapshot đã đóng băng |
| PAYROLL-ERR-004 | 409 | **Mở lại kỳ bị chặn**: kỳ đã sinh phiếu lương (`kind = payslip-already-generated` — phiếu là bản ghi bất biến, không xoá được) · kỳ ở 🔁 **v2: `Published`/`Paid`/`Locked`** *(v1: `Paid`/`Locked`)* (`kind = period-terminal`) — `Published` vào danh sách vì nó **bắt buộc đã sinh phiếu** (§13.1) |
| PAYROLL-ERR-005 | 409 | **Four-eyes**: người duyệt trùng người gửi duyệt (`kind = same-actor-approval`) — chốt cuối CHECK ở DB, race map 409 không 500 |
| PAYROLL-ERR-006 | 409 | Sinh phiếu lương lần hai cho cùng (kỳ, nhân sự) — chốt cuối `UNIQUE (company_id, payroll_period_id, user_id)`; hai request song song bóc `23505` từ `cause` → 006 |
| PAYROLL-ERR-007 | 409 | **Phát hành kỳ chưa sinh phiếu lương** (`kind = no-payslip`) |
| PAYROLL-ERR-008 | 409 | Tạo kỳ lương cho **tháng đã có kỳ** (`kind = period-month-exists`) — chốt cuối unique `(company_id, period_month) WHERE deleted_at IS NULL` |
| PAYROLL-ERR-009 | 422 | **Không có nhân sự nào đủ điều kiện tính** (`kind = no-eligible-employee`) — 0 người có hồ sơ lương hiệu lực trong kỳ. *(Thiếu dữ liệu của MỘT SỐ người là **cảnh báo mềm**, không phải lỗi — PAYROLL-FUNC-005)* |
| PAYROLL-ERR-010 | 404 | Sentinel not-found: kỳ / dòng / phiếu / hồ sơ lương / thưởng-phạt **không thuộc company**, đã xoá mềm, hoặc **ngoài data scope** (nhân viên mở phiếu của người khác) — **một phản hồi duy nhất** (chống dò sự tồn tại; không 403) |
| PAYROLL-ERR-011 | 409 | **Thưởng/phạt**: sửa hoặc quyết định hàng **không còn `Pending`** theo FSM §13.3 (`kind = not-pending`) |
| PAYROLL-ERR-012 | 409 | **Tự duyệt** thưởng/phạt do chính mình tạo (`kind = self-approval`) — segregation of duties |
| PAYROLL-ERR-013 | 409 | Sửa / xoá mềm thưởng-phạt **đã được gộp vào một kỳ lương** (`kind = already-consumed`) |
| PAYROLL-ERR-014 | 409 | **Hồ sơ lương**: đã có phiên bản cùng `effective_date` cho nhân sự đó (`kind = effective-date-exists`) — chốt cuối unique, race map 409 · 🔁 **v2 thêm `kind = profile-item-duplicate`**: hai dòng `items[]` cùng `component_code` trong một phiên bản (chốt cuối `salary_profile_items_profile_component_uq`, `23505` ⇒ 409). **Cấp `kind` mới thay vì mã mới** — cùng đối tượng nghiệp vụ, và một unique không có `kind` là **500 trá hình** |
| PAYROLL-ERR-015 | 409 | Xác nhận phiếu lương **chưa phát hành** (`kind = payslip-not-published`) · xác nhận lần hai (`kind = already-acknowledged` — chốt cuối unique) |
| PAYROLL-ERR-016 | 422 | Export vượt trần **10.000 dòng** theo bộ lọc hiện hành (`kind = export-too-large`) — thu hẹp bộ lọc rồi xuất lại (§19) |
| PAYROLL-ERR-017 | 422 | **Không có người duyệt hợp lệ**: lúc `submit`, company không tồn tại user nào **khác actor** giữ cặp `('approve','payroll-period')` (`kind = no-eligible-approver`). Chặn ở đây thay vì để kỳ kẹt vĩnh viễn ở `Reviewing` — thông điệp hướng dẫn gán role `payroll-officer` cho người tính hoặc thêm company-admin thứ hai (§13.1) |

### 12.1 **v2** — PAYROLL-ERR-018..033

| Mã lỗi | HTTP | Quy tắc |
| --- | --- | --- |
| PAYROLL-ERR-018 | 422 | **Công thức không hợp lệ** lúc LƯU: `kind = formula-syntax` (sai cú pháp) · `formula-unknown-ref` (tham chiếu mã thành phần/biến hệ thống không tồn tại) · `formula-unknown-function` (hàm ngoài danh sách đóng §13.6) · `formula-too-long` · `formula-too-deep` · `formula-too-many-nodes`. `details[]` nêu **vị trí ký tự** và token gây lỗi. 🔁 **v2 `S15-PAYROLL-BE-1` cấp thêm BA `kind` cho `salary_profile_items` — mã GIỮ NGUYÊN 018, `kind` RIÊNG**: `profile-item-unknown-component` (mã ngoài catalog — đây là đường trả 🔻 nợ DB-1 cho hồ sơ di sản mang mã `PC_nnn`) · `profile-item-wrong-type` (mã CÓ trong catalog nhưng `value_type <> 'profile_item'` — **chốt chặn TIỀN**: `salary_profiles.allowances` là đầu vào tính lương v1 và mọi phần tử của nó được CỘNG vào `gross`, nên nhận một thành phần `tax`/`deduction` ở đây là cộng tiền thuế cho nhân viên) · `bank-pair-incomplete` (`payroll_employee_settings`: có số TK mà thiếu tên ngân hàng/chủ TK **sau khi MERGE** — 039 là upsert từng phần nên CHECK ở DB soi hàng sau merge, Zod chỉ soi payload). **KHÔNG mượn `formula-unknown-ref`**: §12.1 chia mã theo THỜI ĐIỂM và mục đích là để FE biết mở **editor công thức** hay mở **hồ sơ lương** |
| PAYROLL-ERR-019 | 422 | **Vòng phụ thuộc** giữa các thành phần lương (`kind = formula-cycle`); thông điệp nêu **chu trình đầy đủ** theo mã (`A → B → C → A`), không chỉ nói «có vòng» |
| PAYROLL-ERR-020 | 422 | **Vượt ngân sách đánh giá** lúc TÍNH (`kind = formula-budget-exceeded`) · **chia cho 0** (`kind = division-by-zero`) · **tràn số** (`kind = numeric-overflow`, vượt `numeric(18,2)`). Kỳ **không** đổi trạng thái |
| PAYROLL-ERR-021 | 422 | **Gross-up NET không hội tụ** sau 30 vòng (`kind = grossup-not-converged`); `details[]` nêu `userId` + sai số còn lại. **Kỳ giữ nguyên trạng thái, KHÔNG ghi dòng nào** (toàn bộ tx rollback) |
| PAYROLL-ERR-022 | 422 | **Thiếu bản tỉ lệ luật định hiệu lực** tại ngày cuối kỳ (`kind = statutory-rate-missing`) · bản hiệu lực **thiếu bậc thuế/trần bắt buộc** (`kind = statutory-rate-incomplete`) |
| PAYROLL-ERR-023 | 409 | **Mẫu bảng lương của kỳ**: đổi mẫu khi kỳ **> `CollectingData`** (`kind = template-locked`) · `calculate` khi kỳ **chưa gắn mẫu** (`kind = template-missing`) · mẫu đã **ngưng dùng** (`kind = template-inactive`) |
| PAYROLL-ERR-024 | 409 | **Thành phần lương**: xoá thành phần **hệ thống** (`kind = system-component-immutable`) · xoá/ngưng thành phần **đang được mẫu tham chiếu** (`kind = component-in-use`, `details[]` liệt kê mẫu) · trùng `code` (`kind = component-code-exists` — chốt cuối UNIQUE) · `code` **đụng không gian tên hệ thống** (`kind = component-code-reserved`, tiền tố `SYS_` hoặc trùng mã seed — §8.2 C1) |
| PAYROLL-ERR-025 | 409 | **Tạm ứng** FSM: sửa/quyết định hàng không còn `Pending` (`kind = advance-not-pending`) · đã khấu trừ (`kind = advance-already-deducted`) · **tự duyệt** (`kind = self-approval`) |
| PAYROLL-ERR-026 | 409 | Gắn tạm ứng vào **kỳ đã ≥ `Calculated`** (`kind = advance-period-frozen`) — khoản khấu trừ phải có mặt **trước** khi tính, thêm sau là số đã chốt không khớp phiếu |
| PAYROLL-ERR-027 | 409 | **Đợt chi trả**: lập đợt từ kỳ **chưa `Published`** (`kind = period-not-published`) · hoàn tất khi còn dòng chưa chi (`kind = batch-incomplete`) · hoàn tất lần hai (`kind = batch-already-completed`) · **một PHIẾU LƯƠNG đã nằm ở đợt khác** (`kind = payee-already-in-batch` — chốt cuối **`payroll_payment_lines_payslip_uq`**, phạm vi **toàn công ty**, KHÔNG phải `batch_user_uq`) |
| PAYROLL-ERR-028 | 409 | **Hoàn tất một đợt chi trả RỖNG** — `POST …/complete` (072) trên đợt có **0 dòng còn hiệu lực** (`kind = batch-empty`; đợt lập rỗng, hoặc mọi dòng đã xoá mềm lúc `Draft`). Đợt **không** chuyển `Completed`, kỳ **không** chuyển `Paid`. Đây là đường đi tắt bỏ qua bước chi trả thật mà PAY-DEC-017 sinh ra để chặn: một đợt rỗng «hoàn tất» là **một lượt chi trả không tồn tại được ghi là đã chi**. ⚠️ Đây là **đường phát DUY NHẤT** của 028 — bản nháp gán 028 cho «kỳ sang `Paid` mà không đợt nào hoàn tất», một điều kiện **không route nào đạt tới được** sau khi 072 là cửa duy nhất ⇒ mã chết |
| PAYROLL-ERR-029 | 409 | **Ngân sách lương** trùng `(năm, đơn vị)` (`kind = budget-exists`) — chốt cuối UNIQUE, race map 409 |
| PAYROLL-ERR-030 | 422 | **Import thu nhập/khấu trừ khác**: sai khuôn cột (`kind = import-invalid`) · vượt trần **5.000 dòng** (`kind = import-too-large`) · có dòng không khớp nhân sự (`kind = import-unknown-user`). **Toàn tệp hoặc không dòng nào** — không import một phần |
| PAYROLL-ERR-031 | 422 | **Báo cáo / PDF vượt trần**: báo cáo quá **50.000 dòng** theo bộ lọc (`kind = report-too-large`) · PDF hàng loạt quá **2.000 phiếu** (`kind = pdf-batch-too-large`) |
| PAYROLL-ERR-032 | 409 | **Người phụ thuộc**: hai bản ghi **chồng lấp khoảng hiệu lực** cho cùng một NPT (`kind = dependent-overlap`) — chốt cuối `EXCLUDE USING gist` ở DB, race map 409 không 500 |
| PAYROLL-ERR-033 | 409 | **Bản tỉ lệ luật định — xung đột**: trùng `effective_from` (`kind = rate-effective-date-exists` — chốt cuối UNIQUE, race map 409) · sửa bản **đã có kỳ lương dùng** (`kind = rate-in-use`; đổi số của bản đã áp là đổi tiền của kỳ đã tính ⇒ phải **tạo bản mới**, không sửa tại chỗ) |

**Bốn quy tắc bổ sung của v2:**

- **Ba mã 018/019/020 chia theo THỜI ĐIỂM, không theo nội dung.** 018/019 phát lúc **LƯU** thành phần/mẫu (người dùng sửa được ngay, `details[]` chỉ vào ký tự); **020 phát lúc TÍNH** (công thức đã qua kiểm mà vẫn vỡ trên dữ liệu thật — chia cho 0 vì một đầu vào bằng 0, tràn số vì lương bất thường). Gộp làm một mã thì FE không biết nên mở editor công thức hay mở dòng lương.
- **Trần đánh giá là NGÂN SÁCH TẤT ĐỊNH, không phải timeout đồng hồ** (§13.6): `formula-budget-exceeded` đếm **lượt thăm node**, nên ca test tái lập được 100%. Timeout đồng hồ ở tầng kỳ vẫn giữ làm phòng thủ chiều sâu nhưng **KHÔNG** là cổng có ca test đo — đồng hồ làm ca đỏ ngẫu nhiên (`slow-probe-manufactures-timeout-red`).
- **Vi phạm ràng buộc DB → 409/422 đúng mã, KHÔNG 500 — bản đồ ĐÓNG dưới đây.** `mapPayrollPgError` khớp theo **TÊN ràng buộc**, lấy từ `error.cause` (`drizzle-wraps-pg-error-code-in-cause` — driver `pg` bọc mã vào `cause`, đọc `error.code` ở lớp ngoài luôn `undefined`). **Tên không có trong bảng = 500 ở vùng đỏ**, nên bảng này phải khớp **đúng bằng** với tên ràng buộc thật của DB-13 §12–§14:

| Ràng buộc (TÊN thật) | SQLSTATE | ⇒ HTTP | Mã + `kind` |
| --- | --- | --- | --- |
| `payroll_payment_lines_payslip_uq` | `23505` | 409 | **027** `payee-already-in-batch` — ⚠️ **KHÔNG phải `..._batch_user_uq`**: hai đợt khác nhau của cùng kỳ **không** vi phạm `batch_user_uq` (khác `batch_id`), nên map nhầm tên để đường **chống trả lương hai lần** trả **500** thay vì 409 |
| `payroll_payment_lines_batch_user_uq` | `23505` | 409 | **027** `payee-already-in-batch` *(vẫn map — chặn trùng trong CÙNG đợt)* |
| `payroll_dependents_no_overlap_excl` | **`23P01`** exclusion_violation | 409 | **032** `dependent-overlap` |
| `salary_components_company_code_uq` | `23505` | 409 | **024** `component-code-exists` |
| `salary_components_code_shape_check` | `23514` | 409 | **024** `component-code-reserved` — mã đụng tiền tố `SYS_`/`TL_`/`GT_`. **Thiếu hàng này thì ca §21.1 số 8 trả 500**, không phải 409 |
| `salary_components_system_not_deletable` | `23514` | 409 | **024** `system-component-immutable` — xoá mềm hàng seed |
| `salary_components_value_pair_check` · `salary_components_engine_kind_check` | `23514` | 400 | `VALIDATION-ERR-001` *(lỗi hình thức, Zod lẽ ra chặn trước — hàng này là lưới cuối)* |
| `salary_profile_items_profile_component_uq` | `23505` | 409 | **014** `profile-item-duplicate` |
| `payroll_statutory_rates_company_effective_uq` | `23505` | 409 | **033** `rate-effective-date-exists` |
| `payroll_budgets_year_unit_uq` | `23505` | 409 | **029** `budget-exists` |
| `payroll_templates_company_code_uq` | `23505` | 409 | **023** `template-code-exists` |
| `payroll_periods_four_eyes_check` *(v1)* | `23514` | 409 | **005** `same-actor-approval` |
| `payroll_period_lines_adjustment_check` *(v1)* | `23514` | 400 | `VALIDATION-ERR-001` |

**QA census bắt buộc**: mỗi TÊN ở cột 1 phải xuất hiện trong `mapPayrollPgError`, và mỗi hàng phải có **≥ 1 ca test kích hoạt ràng buộc THẬT ở DB** (không mock) — ràng buộc có mà không map là 500; map mà không ca là `coverage-high-but-error-code-untested`.

- **Bản đồ `object_type` audit MỞ RỘNG — danh sách vẫn ĐÓNG.** v1 có **4** giá trị (`payroll_period` · `salary_profile` · `bonus_penalty` · `payslip`); v2 thêm **10**: `payroll_employee` · `payroll_employee_setting` · `payroll_dependent` · `salary_component` · `payroll_template` · `payroll_statutory_rate` · `payroll_advance` · `payroll_payment_batch` · `payroll_budget` · `payroll_report` ⇒ **tổng 14**. **`payroll_payment_lines` và `payroll_template_components` KHÔNG có `object_type` riêng** — vết của chúng đi kèm đối tượng cha (`payroll_payment_batch` / `payroll_template`), vì sửa một dòng con luôn là sửa cấu hình của cha. `salary_profile_items` cũng vậy (đi kèm `salary_profile`). WO DB **UNION-ADD chỉ giá trị CÒN THIẾU** vào CHECK `audit_logs.object_type` (`audit-check-union-parse-anchor-trap` — neo 2 tầng, NO-LOSS/NO-GAIN) + `AUDIT_OBJECT_TYPES` cùng commit.
  - ⚠️ **Hai giá trị dễ bị bỏ sót vì chúng KHÔNG ứng với một bảng nào**: `payroll_report` (078 · 079 · 081 · 082 — báo cáo là **phép đọc số liệu**, không phải một hàng) và `payroll_employee` (036 · 037 — **chiếu HR bó hẹp**, dữ liệu nằm ở bảng HR). Thiếu chúng thì **6 trong 18** đường audit-đọc của §18.1 B ghi `object_type` ngoài bản đồ ⇒ **CHECK violation = 500 ngay trên đường đọc**. Bản đồ route → `object_type` + `object_id` đủ 18 đường: **§18.1 B**.

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

> 🔁 **BẢN v2 THAY BẢN v1** (PAY-DEC-017 — 7 → **8** trạng thái). Bản v1 có 7 cột và `publish` đưa `Approved → Paid`; bản dưới đây là bản **duy nhất còn hiệu lực**. Khác biệt đúng hai chỗ: thêm cột/hàng **`Published`**, và **`publish` đổi đích** từ `Paid` sang `Published`; mọi ô khác giữ nguyên.

| Từ ↓ / Tới → | `Draft` | `CollectingData` | `Calculated` | `Reviewing` | `Approved` | `Published` | `Paid` | `Locked` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`Draft`** | — | collect ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **`CollectingData`** | ✗ | — *(collect lại tại chỗ ✓)* | calculate ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **`Calculated`** | ✗ | **reopen ✓** | — *(calculate lại + điều chỉnh dòng tại chỗ ✓)* | submit ✓ | ✗ | ✗ | ✗ | ✗ |
| **`Reviewing`** | ✗ | **reopen ✓** | reject ✓ (bắt buộc comment) | — | approve ✓ (four-eyes) | ✗ | ✗ | ✗ |
| **`Approved`** | ✗ | **reopen ✓** *(chỉ khi CHƯA sinh phiếu — 004)* | ✗ | ✗ | — *(generate phiếu tại chỗ ✓)* | **publish ✓** *(chưa sinh phiếu ⇒ 007)* | ✗ | ✗ |
| **`Published`** | ✗ | ✗ | ✗ | ✗ | ✗ | — *(lập/sửa/**hoàn tất** đợt chi trả tại chỗ ✓ — xem luật PHỦ dưới)* | **complete-batch ✓** *(chỉ khi lượt hoàn tất đó làm **PHỦ ĐỦ** kỳ)* | ✗ |
| **`Paid`** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — | lock ✓ |
| **`Locked`** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — |

- Mọi ô ✗ ⇒ **PAYROLL-ERR-001** (409). Service viết đúng **một hàm** `assertPeriodTransition(from, to, via)` — không controller nào tự kiểm.
- **MỌI hành động chạm trạng thái kỳ mở transaction và bắt đầu bằng `SELECT … FROM payroll_periods WHERE id = $1 FOR UPDATE`** — `collect` · `calculate` · `adjust-line` · `submit` · `approve` · `reject` · `generate-payslips` · `publish` · `lock` · `reopen`. Không chỉ `calculate`. Thiếu row-lock trên `generate-payslips`/`reopen` là đường vào trạng thái **không thoát được**: `reopen` đọc "0 phiếu" trong khi `generate` đang INSERT ⇒ kỳ về `CollectingData` nhưng đã có `payslips`; từ đó phiếu không mang trạng thái dẫn xuất nào (§13.2) và mọi lần `generate` sau đều **409 006** vĩnh viễn vì phiếu là append-only, không xoá được.
- **Cờ đã-sinh-phiếu đọc dưới row-lock:** `payroll_periods.payslips_generated_at/by` (DB-13 §6.3) là nguồn kiểm của `reopen`/`publish` — **không đếm bảng `payslips`** (đếm bảng khác không được row-lock bảo vệ).
- **Hai hành động chạy TẠI CHỖ, không đổi trạng thái**: `calculate` lại ở `Calculated` (ghi đè dòng nháp + snapshot mới) và `generate-payslips` ở `Approved`. Cả hai idempotent, chốt cuối ở DB.
- **`Locked` là terminal tuyệt đối** — không có đường ra. Bảng công tháng đó đã bất biến từ trước (§3.5); PAYROLL không dựng cổng thứ hai.
- **v2 — `complete-batch` là chuyển tiếp DUY NHẤT vào `Paid`**, và nó **không có route riêng trên `payroll-periods`**: đích đến là `POST /payroll/payment-batches/:id/complete` (`PAYROLL-API-072`, cặp `('manage','payment-batch')`). Route đó mở tx, **row-lock CẢ HAI hàng** — đợt chi trả **và** kỳ lương — theo thứ tự **kỳ TRƯỚC, đợt SAU** (thứ tự cố định là cách duy nhất chặn deadlock khi hai đợt của cùng một kỳ hoàn tất song song), rồi gọi chính `assertPeriodTransition('Published', 'Paid', 'complete-batch')`. **Không** có hàm FSM thứ hai cho đợt chi trả chạm trạng thái kỳ.

> 🔴 **v2 — LUẬT PHỦ: một kỳ có NHIỀU đợt chi trả, và `Paid` là trạng thái của KỲ, không phải của đợt.** Mô hình cho phép nhiều đợt (bank + cash, hoặc chia đợt theo đơn vị) — `payroll_payment_lines_payslip_uq` chặn một phiếu nằm ở hai đợt, chứ **không** chặn kỳ có hai đợt. Vì vậy `complete` **KHÔNG** đẩy kỳ sang `Paid` một cách vô điều kiện:
>
> ```text
> PHỦ ĐỦ(kỳ) := mọi hàng payslips của kỳ đều có ĐÚNG MỘT payroll_payment_lines
>               (deleted_at IS NULL) thuộc một đợt status='Completed'
>
> 072 complete(đợt B), trong MỘT tx, dưới row-lock kỳ TRƯỚC · đợt SAU:
>   (0) đợt B còn 0 dòng còn hiệu lực            ⇒ 409 ERR-028 batch-empty  (KHÔNG hoàn tất)
>   (1) đợt B còn dòng chưa chi                  ⇒ 409 ERR-027 batch-incomplete
>   (2) đợt B đã Completed                       ⇒ 409 ERR-027 batch-already-completed
>   (3) đặt B.status = 'Completed'
>   (4) PHỦ ĐỦ(kỳ) = false ⇒ kỳ GIỮ 'Published'; trả 200 { periodStatus:'Published', unpaidPayees: n }
>       PHỦ ĐỦ(kỳ) = true  ⇒ assertPeriodTransition('Published','Paid','complete-batch') + ghi paid_by/at
>                            + phát NOTI-EVENT-027; trả 200 { periodStatus:'Paid', unpaidPayees: 0 }
> ```
>
> **Vì sao phải viết ra:** bản nháp cho `complete` đẩy kỳ sang `Paid` ngay ở đợt ĐẦU TIÊN. Khi đó đợt thứ hai của cùng kỳ **không bao giờ hoàn tất được** — `assertPeriodTransition('Paid','Paid')` ⇒ **409 ERR-001 vĩnh viễn** — và những người nằm trong đợt thứ hai **không bao giờ được đánh dấu đã chi**. Đó là **ngõ cụt dữ liệu**, không phải lỗi hiển thị; và `POST /payment-batches` chặn ở `('period-not-published')` nên cũng không lập lại đợt mới được. Bước (4) là chốt duy nhất.
>
> **Race hai đợt cuối hoàn tất song song là TẤT ĐỊNH nhờ row-lock kỳ**: bên vào trước thấy `PHỦ ĐỦ = false` (dòng của bên kia chưa commit) ⇒ kỳ giữ `Published`; bên vào sau thấy `true` ⇒ kỳ `Paid`. **Không** có 409, **không** deadlock, và đúng **một** hàng outbox 027.

- **v2 — `Published` KHÔNG mở lại được.** `reopen` chỉ hợp lệ từ `{Calculated, Reviewing, Approved}`, và ở `Approved` đã bị cờ `payslips_generated_at` chặn (004). Vì `Published` **bắt buộc** đã sinh phiếu, không tồn tại đường nào từ `Published` về sau — bảng trên ghi ✗ toàn hàng là **hệ quả**, không phải lựa chọn thêm.
- **v2 — hai trạng thái cuối KHÔNG chặn lẫn nhau về phiếu lương:** nhân viên thấy phiếu từ **`Published`** trở đi (§13.2). Đừng suy «`Paid` mới cho xem» từ tên trạng thái — tiền về tài khoản và quyền xem phiếu là hai việc khác nhau, và giữ phiếu kín tới khi ngân hàng xong là đúng thứ mà PAY-DEC-017 muốn **bỏ**.
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
| `publish` (**v2:** `Approved → Published`) | — | `published_by/at` |
| **`complete-batch`** (**v2:** `Published → Paid`) | — | **`paid_by/at`** |
| `lock` (`Paid → Locked`) | — | `locked_by/at` |
| **`reopen`** (`{Calculated, Reviewing, Approved} → CollectingData`) | **`calculated_by/at` · `submitted_by/at` · `approved_by/at`** | `reopen_reason` (**GHI ĐÈ** — chỉ giữ lý do của lần mở lại gần nhất; lịch sử đầy đủ nằm ở `audit_logs`), `updated_by/at` |

> **Vì sao bảng này là BẮT BUỘC, không phải chi tiết thi công:** CHECK `payroll_periods_four_eyes_check` (`approved_by <> submitted_by`) sống ở DB. Nếu `reopen`/`reject` **không** xoá vết cũ thì kịch bản thật — admin A duyệt → `reopen` → tính lại → **A gửi duyệt** — vi phạm CHECK và trả **`23514`**, tức **500 ở vùng đỏ**. Xoá sai vế thì `payroll_periods_approved_pair_check` nổ. Cặp `published_*`/**`paid_*`**/`locked_*` không bao giờ cần xoá vì `reopen` bị chặn từ `Approved`-đã-sinh-phiếu trở đi (§13.1) — **và đó chính là lý do ba cặp này an toàn khi ĐƯỢC ĐƯA VÀO CHECK cặp**, xem dưới.

> **v2 — ba CHECK cặp phải đổi/thêm CÙNG LƯỢT với `paid_by/at`, không tách WO:**
>
> | CHECK | v1 | **v2** |
> | --- | --- | --- |
> | `payroll_periods_status_check` | 7 giá trị | **8 giá trị** (thêm `Published`) |
> | `payroll_periods_published_pair_check` | `status NOT IN ('Paid','Locked') OR (published_* NOT NULL AND approved_* NOT NULL)` | **`status NOT IN ('Published','Paid','Locked') OR (…)`** — thêm `Published` vào vế trái, nếu không thì kỳ vừa phát hành **không bị ràng buộc nào** |
> | `payroll_periods_paid_pair_check` | *(không có)* | **MỚI**: `status NOT IN ('Paid','Locked') OR (paid_by IS NOT NULL AND paid_at IS NOT NULL)` |
>
> ⚠️ **Thứ tự migration BẮT BUỘC**, làm sai là `23514` ngay trên lượt migrate: (1) `ADD COLUMN paid_by/paid_at` (NULL) → (2) **nới** `status_check` lên 8 giá trị → (3) **UPDATE `status = 'Published'` WHERE `status = 'Paid'`** (di trú nghĩa cũ — §3.5) → (4) **rồi mới** siết `published_pair_check` và thêm `paid_pair_check`. Đảo bước (3) và (4) = mọi hàng `Paid` di sản vi phạm `paid_pair_check` vì `paid_by` còn NULL. WO DB **ĐO `count(*) WHERE status='Paid'` trước** và ghi số đo vào migration.
>
> ⚠️ **`Locked` nằm trong vế trái của CẢ BA CHECK** — kỳ đã khoá vẫn phải có đủ vết `approved`/`published`/`paid`. Bỏ `Locked` khỏi một vế nào là mở đường ghi thẳng `Locked` không vết (`nullable-escape-clause-makes-check-vacuous`).

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
| `Published` | 🔁 **v2 THAY v1** — kỳ ở **`Published`**, `Paid` **hoặc** `Locked` *(v1: chỉ `Paid`/`Locked`)* |
| `Acknowledged` | `Published` **và** có hàng `payslip_acknowledgements` của chính nhân sự đó |
| *(không nhánh nào khớp)* | **fail-closed**: DTO trả `status: null` + phiếu **không** lộ ra đường Own. Ca này chỉ xảy ra nếu kỳ tụt về `< Approved` khi đã có phiếu — trạng thái bất khả theo §13.1 (row-lock + cờ `payslips_generated_at`), nhưng **phải có nhánh mặc định**, không được `undefined` |

Lý do không lưu cột: phát hành là hành động **cấp kỳ** (một lần cho cả bảng lương), lưu cờ trên từng phiếu buộc phải UPDATE một bảng chỉ-INSERT — phá bất biến #2 vì một thông tin đã suy được từ `payroll_periods.status`. Nhân viên **không thấy** phiếu ở trạng thái `Generated`.

> 🔁 **v2 — bộ lọc Own đổi theo, ĐÂY LÀ CHỖ DỄ QUÊN NHẤT CỦA CẢ WAVE:** `GET /me/payslips` (031) và `GET /me/payslips/:id` (032) v1 lọc kỳ ∈ **`{Paid, Locked}`**; v2 phải lọc **`{Published, Paid, Locked}`**. Sau khi `publish` đổi đích, phiếu vừa phát hành nằm ở `Published` — giữ bộ lọc cũ nghĩa là **nhân viên không thấy phiếu lương nào cho tới khi kế toán chi trả xong**, và route trả **mảng rỗng 200**, không lỗi, không log. Đó đúng là hình dạng fail-OPEN ngược (`empty-success-is-the-fail-open-shape`).
>
> **Ba chỗ phải sửa CÙNG LƯỢT với FSM, không tách WO:** (a) bộ lọc của 031/032 · (b) hàm dẫn xuất `Published` ở bảng trên · (c) **PDF phiếu của mình** (API-084) dùng cùng bộ lọc đó. QA bắt buộc có ca: kỳ ở **đúng `Published`** ⇒ nhân viên **thấy** phiếu, **xác nhận được** (033), **tải PDF được** (084). Thiếu ca này thì cả ba chỗ cùng sai mà mọi ca hiện có vẫn xanh — chúng chạy trên kỳ `Paid`.

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
| hệ số pro-rate | — | `LEAST((present_days + unpaid_leave_days) / NULLIF(work_days, 0), 1)` — clamp trần 1 ở SQL. **Tử số CỘNG `unpaid_leave_days`** — xem «Nghỉ KHÔNG lương» dưới |

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
- **Hệ quả lên clamp:** clamp `LEAST(…, 1)` **giữ nguyên** và vẫn phải ở SQL — chỉ khác là tử số nay có thể lẻ (vd `20.5 / 22`).

**Nghỉ KHÔNG lương — tử số pro-rate CỘNG `unpaid_leave_days` (QUYẾT ĐỊNH OWNER 2026-09-01, S13-PAYROLL-BE-2):**

`present_days` **đã loại** ngày nghỉ không lương (nó chỉ gộp bản ghi công ∪ phép **có lương**). Vì thế pro-rate theo `present_days` **rồi lại** trừ `unpaid_leave_days × đơn giá ngày` là **trừ HAI LẦN**: mỗi người mỗi kỳ mất `base_salary × unpaid / work_days`, im lặng, không CHECK nào bắt.

Chốt: **tử số = `present_days + unpaid_leave_days`**, và **giữ** vế khấu trừ nghỉ không lương. Hai phương án (bỏ vế khấu trừ / cộng vào tử số) cho **cùng một `net`**, nhưng phương án này để phiếu lương hiện dòng «nghỉ không lương −N ngày: −X đ» (`payslip_items.item_type = 'attendance'`) — đúng PAY-DEC-004 «breakdown giải-thích-được»; bỏ vế khấu trừ thì nhân viên chỉ thấy lương cơ bản đã bị cắt mà không dòng nào giải thích.

```text
work = 22   present = 18   unpaid = 2   base_salary = 22.000.000
prorate      = LEAST((18 + 2) / 22, 1) = 20/22
base_amount  = round(22.000.000 × 20/22, 2)  = 20.000.000
dailyRate    = 22.000.000 / 22               =  1.000.000
unpaidDeduct = round(2 × 1.000.000, 2)       =  2.000.000
→ phần base đóng góp vào net                  = 18.000.000
```

⚠️ Phương án này **chỉ đúng khi ba đại lượng ngày mang ngữ nghĩa thập phân nửa ngày** (đã chốt ở khối trên): với ngữ nghĩa nguyên-ngày, một ngày nửa-làm/nửa-nghỉ-không-lương cho `present = 1` **và** `unpaid = 1` ⇒ tử số vượt mẫu số (trần `LEAST(…,1)` che mất, số vẫn sai).

**Trễ/về sớm — v1 KHÔNG trừ tiền (QUYẾT ĐỊNH OWNER 2026-09-01):** văn bản cũ viết "trễ/sớm (**nếu bật rule** ATT)", nhưng `companies.payroll_config_json` (mig `0015`) chỉ có `{cutoffDay, payDay}` — **không tồn tại rule nào để bật**, nên câu đó để ngỏ cho người code tự phát minh đơn giá phút. `late_minutes` vẫn ghi vào dòng lương + `input_snapshot_json` để giải thích, nhưng **`deduction_amount` KHÔNG cộng vế trễ**. Đảo quyết định này là việc của WO sau, kèm nơi cấu hình rule.

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
6. **UPSERT** `payroll_period_lines` theo `(company_id, payroll_period_id, user_id)` bằng **một câu lệnh SQL set-based** (không vòng lặp per-người ở JS): pro-rate lương cơ bản, cộng phụ cấp, cộng thưởng `Approved` chưa consume, trừ phạt · ngày nghỉ không lương (**KHÔNG trừ vế trễ/sớm ở v1** — xem quyết định owner ở trên), `net = GREATEST(gross − khấu trừ, 0)`; làm tròn `numeric(18,2)` **ở SQL**. Ghi `input_snapshot_json`.
   - **`adjustment_amount` CÓ DẤU** (dương = truy lĩnh/cộng thêm · âm = truy thu/trừ thêm) và **nằm NGOÀI `gross` lẫn `deduction_amount`** — vì `gross`/`deduction` đều bị CHECK `>= 0` nên gộp vào là không biểu diễn được khoản điều chỉnh âm/dương. Công thức đóng: **`net = GREATEST(gross − deduction_amount + adjustment_amount, 0)`** (ở SQL).
   - **`adjustment_amount` và `adjustment_reason` của dòng cũ được GIỮ NGUYÊN qua UPSERT** — đó là số người dùng nhập tay, tính lại **không được xoá âm thầm**. Dòng của nhân sự **không còn đủ điều kiện** thì **xoá mềm** (`deleted_at`), không hard-delete.
   - FE hiện băng cảnh báo «N dòng có điều chỉnh tay được giữ lại» sau mỗi lần tính lại (§14).
7. Bind consume cho các hàng thưởng/phạt vừa gộp; `status` kỳ → `Calculated`; ghi `calculated_by/at`, **xoá `submitted_by/at`** (§13.1 bảng RESET); audit + enqueue outbox trong **cùng transaction**. ⚠️ dedupeKey của §17 **KHÔNG dùng `auditLogId`** — `AuditService.record` trả `void` (đo 2026-09-01), khoá là **content-derived** từ `RETURNING` của chính câu UPDATE trạng thái (xem §17).

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

> **v2 — scope của bảy bề mặt mới:** `payroll-employee` · `salary-component` · `payroll-template` · `statutory-rate` · `payroll-advance` · `payment-batch` · `payroll-budget` **đều chỉ có scope `Company`** (không Department, không Team) — chúng là **cấu hình và dòng tiền cấp công ty**, chia nhỏ theo đơn vị đẻ ra câu hỏi «mẫu của phòng A dùng thành phần của phòng B thì sao» mà v2 không có nhu cầu. Ngoại lệ duy nhất: **`('view-own','payroll-advance')` = Own** (`payroll_advances.user_id` = user của caller). **Báo cáo có SÀN scope `Company`** (§10.1b) — grant hẹp hơn **không được serve**, không phải «serve bản thu hẹp».

### 13.6 **v2** — Máy công thức thành phần lương (PAY-DEC-012 · PAYROLL-FUNC-020/023)

**Đây là bề mặt tấn công MỚI lớn nhất của wave.** Grammar dưới đây là **danh sách ĐÓNG**; WO BE-2 hiện thực đúng bằng, không thêm hàm «cho tiện».

**A. Grammar (EBNF, cố định)**

```ebnf
expr    := orExpr
orExpr  := andExpr  ( "OR"  andExpr )*
andExpr := cmpExpr  ( "AND" cmpExpr )*
cmpExpr := addExpr  ( ( "=" | "<>" | "<" | "<=" | ">" | ">=" ) addExpr )?
addExpr := mulExpr  ( ( "+" | "-" ) mulExpr )*
mulExpr := unary    ( ( "*" | "/" ) unary )*
unary   := "-" unary | primary
primary := NUMBER | REF | FUNC "(" expr ( "," expr )* ")" | "(" expr ")"

NUMBER  := \d{1,15}(\.\d{1,6})?          -- thập phân, KHÔNG mũ, KHÔNG dấu phân cách nghìn
REF     := [A-Z][A-Z0-9_]{0,31}          -- mã thành phần HOẶC biến hệ thống (SYS_*) HOẶC hằng luật định (TL_*/GT_*)
FUNC    := IF | MIN | MAX | ROUND | ABS | CEIL | FLOOR
         | TNCN_LUY_TIEN | BH_TRAN_BHXH | BH_TRAN_BHYT | BH_TRAN_BHTN
```

- **KHÔNG có chuỗi ký tự trong grammar** — cố ý. Hàm luật định tách theo TÊN (`BH_TRAN_BHXH(x)`) thay vì nhận tham số chuỗi (`BH_TRAN('BHXH', x)`), nên không có lexer chuỗi, không có escape, không có injection qua literal.
- **KHÔNG `eval`, KHÔNG `new Function`, KHÔNG truy cập thuộc tính, KHÔNG gọi hàm tuỳ ý.** Parser tự viết (recursive-descent) → AST → evaluator đi trên AST. Đây là ràng buộc **kiến trúc**, không phải khuyến nghị: một `Function(...)` ở đây là RCE trong vùng crown.
- `IF(cond, a, b)` đánh giá **cả hai nhánh** (không short-circuit) — đơn giản hoá evaluator và làm ngân sách node tất định; không có tác dụng phụ nên không đổi kết quả.
- `/` với mẫu 0 ⇒ **PAYROLL-ERR-020** `division-by-zero`, **không** trả 0, **không** trả `Infinity`.

**B. Giới hạn TĨNH — ép lúc LƯU (⇒ PAYROLL-ERR-018)**

| Giới hạn | Trần | Vì sao con số này |
| --- | --- | --- |
| Độ dài chuỗi công thức | **500 ký tự** | đủ cho công thức lương thực tế dài nhất trong benchmark (~180 ký tự), gấp ~2,7 lần |
| Độ sâu AST | **20** | chặn đệ quy ngoặc làm tràn stack parser trước khi tới evaluator |
| Số node AST | **200** | trần trên chi phí một công thức |
| Số thành phần trong một mẫu | **120** | trần trên kích thước đồ thị |

> 🔴 **Zod KHÔNG được cap `length(formula)`** — bốn trần trên do **parser** ép, trả **422 ERR-018** với `kind` + vị trí ký tự. Nếu Zod đặt `.max(500)` thì chuỗi 501 ký tự chết ở pipe với **400 `VALIDATION-ERR-001`** và `formula-too-long` thành **mã chết** (`equal-caps-at-zod-and-service-make-dead-error-code`); FE cũng mất vị trí ký tự để tô đỏ trong editor. CHECK `salary_components_formula_len_check` (≤ 500) là **lưới cuối ở DB**, không phải cổng đầu. ⇒ **ba trần cùng con số 500 là CỐ Ý**, nhưng **thứ tự bắt buộc**: parser (422 018) → service → DB (23514). WO BE-2 có ca ghim: chuỗi 501 ký tự ⇒ **422 018 `formula-too-long`**, KHÔNG phải 400.

**C. Ngân sách ĐỘNG — ép lúc TÍNH (⇒ PAYROLL-ERR-020 `formula-budget-exceeded`)**

**Ngân sách là SỐ LƯỢT THĂM NODE, không phải đồng hồ**, và có **HAI trần — không gộp làm một**:

| Trần | Con số | Suy ra từ đâu |
| --- | --- | --- |
| **Mỗi LƯỢT chạy đồ thị** (`BUDGET_PER_PASS`) | **25.000 lượt thăm node** | 120 thành phần × 200 node = 24.000, cộng biên |
| **Tổng một DÒNG lương** (`BUDGET_PER_LINE`) | **775.000 lượt thăm node** | `25.000 × 31` = **30 vòng gross-up + 1 lượt cuối** (§13.8). Kiểm tự-nhất-quán: `120 × 200 × 30 = 720.000 ≤ 775.000` ✓ |

Hồ sơ `GROSS` chạy **đúng 1 lượt** ⇒ chạm trần 25.000 là đã vượt. Hồ sơ `NET` chạy **tối đa 31 lượt**, mỗi lượt vẫn bị 25.000 chặn, và **tổng** bị 775.000 chặn. Vượt trần nào cũng ⇒ **422 ERR-020** `formula-budget-exceeded`, `details[]` nêu trần nào vỡ và ở vòng thứ mấy. Đếm tất định ⇒ ca test tái lập 100%.

> 🔴 **Vì sao KHÔNG dùng một trần 25.000 chung cho cả 30 vòng** *(bản nháp viết thế)*: 25.000 chỉ đủ **đúng một** lượt chạy mẫu đầy 120×200. Dùng chung nghĩa là mọi hồ sơ `salary_type = 'NET'` **vượt trần từ vòng thứ hai** ⇒ 422 ERR-020 ⇒ **PAY-DEC-015 (owner đã ký) không chạy được một lần nào**, và ca đối soát tay NET của §21.1 ca 1 **không thể xanh**. Một trần bất khả thi về toán học không phải ràng buộc an ninh — nó là tính năng bị tắt.

> ⚠️ **Cố ý KHÔNG dùng timeout đồng hồ làm cổng.** Ca test đo đồng hồ đỏ theo tải máy CI, và một phép thử làm chậm hệ thống tự sinh «đỏ vì timeout» cho phép đo kế tiếp (`slow-probe-manufactures-timeout-red`). Timeout wall-clock **vẫn đặt** ở tầng kỳ (phòng thủ chiều sâu, log cảnh báo) nhưng **không có ca test nào assert nó**, và nó **không** là điều kiện của `done_when`.

**D. Không gian tên REF — ba họ, ĐÓNG**

| Họ | Nguồn giá trị | Ghi/đọc |
| --- | --- | --- |
| `SYS_*` | **đầu vào đóng băng** của dòng lương (§13.4 v1 vẫn là nguồn): `SYS_BASE_SALARY` · `SYS_INSURANCE_SALARY` · `SYS_PROBATION_SALARY` · `SYS_PAY_RATIO` · `SYS_WORK_DAYS` · `SYS_PRESENT_DAYS` · `SYS_PAID_LEAVE_DAYS` · `SYS_UNPAID_LEAVE_DAYS` · `SYS_LATE_MINUTES` · `SYS_PRORATE` · `SYS_DEPENDENTS` · `SYS_DAILY_RATE` | **chỉ đọc**, không thành phần nào được đặt tên trùng (§8.2 C1) |
| `TL_*` · `GT_*` | **hằng luật định** hiệu lực tại ngày cuối kỳ: `TL_BHXH_NV` · `TL_BHYT_NV` · `TL_BHTN_NV` · `TL_BHXH_DN` · `TL_BHYT_DN` · `TL_BHTN_DN` · `TL_KPCD` · `TL_DOAN_PHI` · `GT_BAN_THAN` · `GT_NPT` | chỉ đọc; thiếu bản hiệu lực ⇒ **422 ERR-022** |
| *(còn lại)* | **mã thành phần** trong mẫu của kỳ | giá trị do chính đồ thị sinh ra |

**E. Đồ thị phụ thuộc + bốn nút TỔNG HỢP do engine tính**

Tham chiếu giữa các thành phần tạo một **DAG**; evaluator **topo-sort** rồi đi một lượt. Bốn mã dưới đây là **thành phần hệ thống đặc biệt** — giá trị **do engine cộng**, không có công thức người dùng sửa được:

Bốn hàng này khai **`value_type = 'engine'`** (§13.4 · DB-13 §13.4) — **KHÔNG** `fixed`/`fixed_amount = 0`.

| Mã | Engine tính bằng | Phụ thuộc |
| --- | --- | --- |
| `TONG_THU_NHAP` | 🔁 **`Σ giá trị mọi thành phần kind ∈ {earning, tax_exempt} đang bật trong mẫu`** | mọi node `earning` + `tax_exempt` |
| `TONG_BH_NV` | 🔁 **`Σ giá trị mọi thành phần kind = 'statutory_employee' CÓ pit_deductible = true`** | các node `statutory_employee` được trừ thuế |
| `THU_NHAP_CHIU_THUE` | `MAX(TONG_THU_NHAP − TONG_BH_NV − GT_BAN_THAN − GT_NPT × SYS_DEPENDENTS − Σ thành phần kind='tax_exempt', 0)` | trên + `tax_exempt` |
| `TONG_KHAU_TRU` | 🔁 **`Σ {deduction, statutory_employee} + (Σ kind='tax' CHỈ KHI salary_profiles.pit_payer = 'EMPLOYEE')`** | các node tương ứng + `pit_payer` của hồ sơ |

> 🔴 **Ba định nghĩa trên vừa được SỬA CẤU TRÚC — bản nháp sai theo ba cách khác nhau, và cả ba đều lọt qua mọi bất biến SQL.** Ghi nguyên do ở đây vì **fixture đối soát tay của §21.1 ca 1 sẽ được dựng theo chính bảng này**: dựng theo bản sai thì ca test **ghim lỗi thành hành vi đúng**, và §3.11 («owner chịu trách nhiệm CON SỐ») **không che** cho sai cấu trúc.
>
> 1. **`tax_exempt` bị trừ mà không bao giờ được TRẢ.** Bản nháp cho `TONG_THU_NHAP` chỉ cộng `earning`, trong khi `THU_NHAP_CHIU_THUE` lại trừ `Σ tax_exempt`. Khoản miễn thuế (tiền ăn ca, xăng xe…) là **tiền nhân viên NHẬN** — nó phải vào `TONG_THU_NHAP` (⇒ vào `net`) rồi mới bị trừ khỏi **thu nhập TÍNH THUẾ**. Bản nháp làm nó chỉ giảm thuế mà không vào lương ⇒ nhân viên **mất đúng khoản đó**, và `net ≥ 0` vẫn xanh.
> 2. **Đoàn phí bị trừ khỏi thu nhập tính thuế.** `TL_DOAN_PHI` là `kind = 'statutory_employee'` (§13.7 D — NV chịu), nên `Σ statutory_employee` kéo nó vào `TONG_BH_NV`, tức **trừ khỏi thu nhập tính thuế**. Chỉ **bảo hiểm bắt buộc** mới được trừ. ⇒ tách bằng cờ dữ liệu **`salary_components.pit_deductible`** (DB-13 §13.4), **không** hard-code mã `DOAN_PHI` vào engine: hard-code thì khoản NV-chịu-không-được-trừ-thuế tiếp theo lại sai y hệt.
> 3. **`pit_payer = 'COMPANY'` không diễn đạt được.** §13.7 E đã ký «DN chịu thuế thì thuế **không** vào `TONG_KHAU_TRU`», nhưng bản nháp cộng thẳng `kind = 'tax'`. ⇒ vế `tax` có **điều kiện** trên `pit_payer` của chính hồ sơ lương đang tính.
>
> **`pit_deductible` chỉ có nghĩa với `kind = 'statutory_employee'`**; seed: `BHXH_NV` · `BHYT_NV` · `BHTN_NV` = `true`, `DOAN_PHI` = `false`. Ba công thức trên phải khớp **từng chữ** với §13.7 C/D/E — lệch một vế là lệch tiền của mọi người.

- **`THUC_LINH` (net) KHÔNG phải node của đồ thị** — nó là `GREATEST(TONG_THU_NHAP − TONG_KHAU_TRU + adjustment_amount, 0)` và **tính ở SQL** lúc ghi dòng (§3.9). Đưa nó vào đồ thị là đưa clamp vào TS.
- **Cycle detection phủ CẢ nút tổng hợp**: một thành phần `kind='earning'` tham chiếu `TONG_THU_NHAP` là **vòng** (nó nằm trong chính tổng đó) ⇒ **422 ERR-019** với chu trình đầy đủ. Đây là lý do bốn nút trên phải là **node thật của đồ thị**, không phải biến tính sẵn ngoài lề — tính sẵn ngoài lề thì vòng này **không ai bắt** và kết quả phụ thuộc thứ tự chạy.
- **Kiểm vòng chạy ở HAI thời điểm**: lúc **lưu** mẫu/thành phần (⇒ 019, người dùng sửa được ngay) **và** lúc **tính** (⇒ 019, phòng khi mẫu bị sửa bởi lượt khác giữa chừng). Chỉ kiểm lúc lưu là không đủ — hai người sửa hai thành phần song song, mỗi bản riêng lẻ không vòng nhưng hợp lại thì có.

**F. Số học**

- **`decimal.js` duy nhất**, `ROUND_HALF_UP`. Phép trung gian giữ **scale 10**; **giá trị mỗi thành phần làm tròn về scale 2 NGAY khi ghi vào `component_values_json`** — làm tròn một lần, ở một chỗ, xác định được.
- `numeric` từ driver `pg` về JS là **chuỗi**: đọc thẳng vào `new Decimal(str)`, **cấm `Number`/`parseFloat` ở giữa**. QA có fixture cố ý lẻ (`1.005`, `0.385`, lương `19.999.999,99`) — fixture toàn số tròn làm ca này xanh-rỗng.
- Tràn `numeric(18,2)` ⇒ **422 ERR-020** `numeric-overflow`, bắt **trước** khi bind xuống SQL.

**G. Xác định lại được — `template_fingerprint`**

Mỗi dòng lương ghi `template_fingerprint` = băm SHA-256 của **tập công thức hiệu lực** (mã thành phần + công thức sau ghi đè + cờ bật/tắt + thứ tự, sắp xếp tất định) **cộng** `statutory_rate_id` đã dùng. Dùng để:

1. Màn chi tiết kỳ hiện băng **«mẫu đã đổi kể từ lần tính gần nhất»** khi fingerprint của dòng ≠ fingerprint hiện tại của mẫu (§3.10, §14) — nếu không, công thức bị sửa rồi tính lại làm số nhảy mà **không ai biết vì sao**.
2. QA ghim ca **«sửa công thức sau khi tính KHÔNG đổi số của kỳ đã tính»** bằng cách so `component_values_json`, không phải so lại phép tính.

**H. Đường tương thích với kỳ v1 (bắt buộc, đừng bỏ)**

Kỳ lương tạo **trước** v2 không có `template_id`. Hai quy tắc:

- **`calculate` trên kỳ chưa gắn mẫu ⇒ 409 ERR-023 `template-missing`** — **không** rơi ngầm về công thức cố định v1. Rơi ngầm nghĩa là cùng một nút «Tính» cho ra hai hệ số học khác nhau tuỳ dữ liệu cũ/mới, và không màn nào nói cho người dùng biết.
- **Kỳ v1 đã ở `≥ Calculated` vẫn ĐỌC được nguyên vẹn** (dòng, phiếu, export, PDF) — chúng có `payslip_items`, không cần công thức. Chỉ **tính lại** mới đòi mẫu.
- Migration seed **một mẫu mặc định** tái tạo đúng công thức v1 (`base_amount` · `allowance_amount` · `bonus_amount` · `penalty_amount` · `deduction_amount`) để kế toán gắn vào kỳ cũ nếu cần tính lại — **seed mẫu, KHÔNG tự gắn vào kỳ nào**.

**I. Audit**

Mọi lượt ghi `salary_components` / `payroll_template_components` ghi audit **kèm diff công thức** (`{ before, after }` dạng chuỗi công thức, **không** phải «đã sửa»). Đây là bề mặt mà một ký tự đổi tiền của cả công ty; audit không có nội dung cũ thì không điều tra được.

### 13.7 **v2** — Engine luật định: BHXH/BHYT/BHTN · KPCĐ · đoàn phí · TNCN (PAY-DEC-014)

**A. Nguồn số — `payroll_statutory_rates`, bản hiệu lực tại NGÀY CUỐI KỲ**

Một bản = một hàng, versioned theo `effective_from`. Kỳ `2026-09` dùng bản có `effective_from ≤ 2026-09-30` mới nhất. **Không nội suy, không trộn hai bản trong một kỳ** — luật đổi giữa tháng thì kỳ đó dùng bản cuối kỳ, và đó là một **quyết định đã chốt**, không phải chỗ WO tự nghĩ.

**B. Căn cứ đóng bảo hiểm**

```text
luong_dong_bh = COALESCE(salary_profiles.insurance_salary, salary_profiles.base_salary)
can_cu_BHXH   = MIN(luong_dong_bh, TRAN_BHXH)   -- TRAN_BHXH = 20 × LUONG_CO_SO
can_cu_BHYT   = MIN(luong_dong_bh, TRAN_BHYT)   -- TRAN_BHYT = 20 × LUONG_CO_SO
can_cu_BHTN   = MIN(luong_dong_bh, TRAN_BHTN)   -- TRAN_BHTN = 20 × LUONG_TOI_THIEU_VUNG
```

- Ba trần **lưu thành ba giá trị riêng** trong bản tỉ lệ (không lưu «20×» rồi nhân lúc chạy) — hệ số và mức nền đổi độc lập nhau theo từng đợt sửa luật; lưu tích số là đúng thứ hệ thống thật sự áp.
- **`payroll_employee_settings` quyết định CÓ đóng hay KHÔNG** (`joins_social_insurance` · `joins_union`). Không tham gia ⇒ thành phần tương ứng **bằng 0**, **vẫn ghi dòng `component_values_json` giá trị 0** — dòng vắng mặt và dòng bằng 0 là hai nghĩa khác nhau khi đối chiếu về sau.
- **Nhân sự thử việc**: căn cứ = `probation_salary` nếu có; `pay_ratio_pct` áp lên **lương**, **KHÔNG** áp lên căn cứ đóng BH (hai đại lượng khác nhau; nhân nhầm là sai thẳng vào số nộp bảo hiểm).

**C. Phần doanh nghiệp**

`TL_BHXH_DN` · `TL_BHYT_DN` · `TL_BHTN_DN` · `TL_KPCD` (KPCĐ, DN chịu) — **không trừ vào lương nhân viên**, nhưng **phải tính và lưu** vì chúng là **chi phí lương** của báo cáo «chi phí lương theo đơn vị» và của widget ngân sách. Thành phần `kind = 'statutory_employer'`: vào `component_values_json`, **KHÔNG** vào `TONG_KHAU_TRU`, **KHÔNG** vào `gross`/`net`. *(Khớp §13.6 E: `TONG_KHAU_TRU` chỉ cộng `{deduction, statutory_employee}` + vế `tax` có điều kiện — `statutory_employer` không có mặt ở vế nào.)*

> ⚠️ Đây là chỗ dễ sai nhất của engine luật định: cộng nhầm phần DN vào `TONG_KHAU_TRU` làm **lương nhân viên tụt ~21,5%** mà mọi bất biến SQL vẫn xanh (tổng vẫn khớp, `net ≥ 0` vẫn đúng). Chỉ **fixture đối soát tay** bắt được (§21.1).

**D. Đoàn phí công đoàn** — `TL_DOAN_PHI` trên `can_cu_BHXH`, **NV chịu** (`kind = 'statutory_employee'`), chỉ khi `joins_union = true`.

> 🔴 **Đoàn phí NV chịu, nhưng KHÔNG được trừ khỏi thu nhập tính thuế.** Seed hàng `DOAN_PHI` với **`pit_deductible = false`**; chỉ `BHXH_NV`/`BHYT_NV`/`BHTN_NV` mang `true`. Vì vậy `TONG_BH_NV` (§13.6 E) là `Σ kind='statutory_employee' CÓ pit_deductible = true` — **không** phải `Σ statutory_employee`. Đoàn phí vẫn vào `TONG_KHAU_TRU` (NV trả thật). Gộp nó vào `TONG_BH_NV` là **giảm thuế sai luật** cho mọi đoàn viên, và **không CHECK nào bắt** vì `net` vẫn ≥ 0, tổng vẫn khớp.

**E. TNCN luỹ tiến 7 bậc**

```text
-- KHỚP TỪNG CHỮ với §13.6 E. Ba vế in đậm ở đó lặp lại nguyên văn tại đây:
TONG_THU_NHAP      = Σ kind ∈ {earning, tax_exempt} đang bật trong mẫu
TONG_BH_NV         = Σ kind = 'statutory_employee' CÓ pit_deductible = true      -- đoàn phí KHÔNG vào
thu_nhap_tinh_thue = MAX(TONG_THU_NHAP − TONG_BH_NV − GT_BAN_THAN − GT_NPT × SYS_DEPENDENTS − Σ(tax_exempt), 0)
thue               = TNCN_LUY_TIEN(thu_nhap_tinh_thue)   -- 7 bậc lưu trong bản tỉ lệ, mỗi bậc {den_muc, thue_suat}
TONG_KHAU_TRU      = Σ {deduction, statutory_employee}
                   + (thue  CHỈ KHI salary_profiles.pit_payer = 'EMPLOYEE')      -- COMPANY ⇒ không cộng
```

> **`tax_exempt` xuất hiện ở HAI vế và đó là đúng, không phải trùng lặp**: cộng vào `TONG_THU_NHAP` (nhân viên **nhận** khoản đó ⇒ vào `net`), rồi trừ ra khỏi **thu nhập TÍNH THUẾ** (khoản đó **miễn thuế**). Bỏ vế cộng đi — như bản nháp — là lấy mất của nhân viên đúng khoản miễn thuế, `net` vẫn ≥ 0 và tổng vẫn khớp.

- **`SYS_DEPENDENTS` = số NPT có khoảng hiệu lực GIAO với kỳ** — **tính đủ tháng** nếu có giao dù chỉ một ngày. Đây là một **diễn giải pháp lý**, không phải chi tiết kỹ thuật: ghi ở đây để nó được **owner nhìn thấy** và để WO BE không tự chọn cách khác (tỉ lệ theo ngày). Cùng hạng trách nhiệm với §3.11.
- **`pit_payer = COMPANY`**: thuế vẫn tính đủ và vẫn ghi `component_values_json`, nhưng **KHÔNG vào `TONG_KHAU_TRU`** — doanh nghiệp chịu. Khi đó khoản thuế là **chi phí DN** như mục C. *(Lưu ý: ở đúng nghĩa nghiệp vụ, «DN nộp thuế thay» còn kéo theo bài toán quy đổi thu nhập; v2 **không** làm phần quy đổi đó — nó thuộc cùng họ với gross-up và chỉ áp cho `salary_type = NET` (§13.8). Ghi tường minh để không ai suy ra rằng `pit_payer = COMPANY` tự động bật gross-up.)*
- **Bậc thuế đọc từ dữ liệu, KHÔNG hard-code**; bản tỉ lệ thiếu bậc hoặc bậc không liên tục (khoảng hở/chồng) ⇒ **422 ERR-022** `statutory-rate-incomplete`, kiểm **lúc lưu bản tỉ lệ** *và* lúc tính.

### 13.8 **v2** — NET gross-up (PAY-DEC-015)

Hồ sơ `salary_type = NET`: con số thoả thuận là **thực lĩnh**, không phải lương cơ bản.

**BIẾN LẶP LÀ `SYS_BASE_SALARY`, KHÔNG PHẢI «gross» — chốt ở đây vì đây là chỗ dễ hiểu sai nhất của cả §13.8.** Đồ thị công thức (§13.6) **không nhận `gross` làm đầu vào**: `gross` (`TONG_THU_NHAP`) là **kết quả** do engine cộng từ các thành phần `earning`, mà các thành phần đó lại đọc `SYS_BASE_SALARY`. Vì vậy không tồn tại hàm `net(gross)` để lặp; thứ lặp được là **giá trị `SYS_BASE_SALARY` bơm vào đồ thị**.

- **Ngữ nghĩa cột:** với `salary_type = 'NET'`, `salary_profiles.base_salary` **giữ số NET mục tiêu** (thoả thuận), **không** phải lương cơ bản để tính. Ghi tường minh vì cùng một cột mang hai nghĩa theo `salary_type` — WO BE **không được** suy ra nghĩa từ tên cột.
- Ký hiệu: `b` = giá trị `SYS_BASE_SALARY` thử; `F(b)` = chạy **toàn bộ** đồ thị với `SYS_BASE_SALARY := b` rồi trả `THUC_LINH`; `N` = NET mục tiêu.

```text
b₀      = N                                   -- điểm xuất phát: lương cơ bản ≥ NET luôn đúng, nên b₀ = N là chặn dưới
b_{k+1} = b_k + (N − F(b_k))
dừng khi |N − F(b_k)| ≤ 1 đ                   (hội tụ)
trần    30 vòng                               (không hội tụ ⇒ 422 ERR-021)
```

- **`b` ghi vào `payroll_period_lines.base_amount`** (sau pro-rate) như hồ sơ GROSS; `component_values_json` ghi **cả `b` đã hội tụ lẫn `N` mục tiêu**, để phiếu lương giải thích được «vì sao lương cơ bản là con số lẻ này».
- **Hồ sơ NET vẫn chịu pro-rate/`pay_ratio_pct` bình thường** — gross-up chạy **trên `SYS_BASE_SALARY` TRƯỚC pro-rate**, rồi pro-rate áp lên `b` đã hội tụ. Đảo thứ tự (gross-up sau pro-rate) cho ra «đi làm nửa tháng vẫn lĩnh đủ NET thoả thuận» — sai nghiệp vụ, và **không CHECK nào bắt được**.

- **Mỗi vòng chạy TOÀN BỘ đồ thị công thức** (BH → giảm trừ → TNCN → khấu trừ), không chỉ công thức thuế — vì thành phần do người dùng định nghĩa có thể phụ thuộc GROSS theo cách bất kỳ.
- **Hai trần node của §13.6 C áp ĐỒNG THỜI**: mỗi lượt chạy đồ thị ≤ **25.000** (giống hệt hồ sơ GROSS — không nới cho NET), và **tổng cả dòng** ≤ **775.000** (`25.000 × 31` = 30 vòng + lượt cuối). Chỉ có trần-mỗi-lượt thì một hồ sơ NET ngốn 31 lần chi phí mà vẫn «trong hạn»; chỉ có trần-tổng-25.000 thì **không hồ sơ NET nào tính được** (§13.6 C).
- **`gross_up_iterations` ghi vào dòng lương** (NULL khi `salary_type = GROSS`) — để phiếu lương giải thích được vì sao gross ra con số lẻ đó.
- **Không hội tụ ⇒ 422 ERR-021 và TOÀN BỘ transaction rollback** — kỳ **không** đổi trạng thái, **không** ghi dòng nào, kể cả dòng của những người đã tính xong. Ghi một phần rồi báo lỗi là để lại bảng lương nửa vời mà trạng thái kỳ nói là chưa tính.
- **Hàm `net(g)` không đơn điệu là có thật** (công thức người dùng có `IF`), nên lặp điểm bất động có thể dao động. Trần 30 vòng + ERR-021 là **hành vi đã chốt**, không phải «tạm thời»: hệ thống **từ chối** thay vì trả một con số không giải thích được. QA có ca dựng công thức dao động cố ý.
- **Ca đối soát tay bắt buộc** (§21.1): ít nhất **một** nhân sự GROSS đủ mọi khoản và **một** nhân sự NET đủ mọi khoản, khớp **từng đồng** với bảng tính tay đính kèm WO.

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
| PAYROLL-API-014 | `POST /payroll-periods/:id/publish` | `('publish','payroll-period')` | 🔁 **v2 đổi ĐÍCH: `Approved → Published`** *(v1: `Approved → Paid`)*; chưa sinh phiếu ⇒ 007; **NOTI-EVENT-023 phát Ở ĐÂY** từng nhân sự (§17.1); audit |
| PAYROLL-API-015 | `POST /payroll-periods/:id/lock` | `('manage','payroll-period')` | `Paid → Locked`; khoá đường chỉnh công ATT tháng đó; audit |
| PAYROLL-API-016 | `POST /payroll-periods/:id/reopen` | `('reopen','payroll-period')` | `{ reason }` **bắt buộc**; → `CollectingData`; `payslips_generated_at IS NOT NULL` ⇒ 004; **xoá `calculated_*`/`submitted_*`/`approved_*`** (§13.1 bảng RESET); audit |
| PAYROLL-API-017 | `GET /payroll-periods/:id/export` | `('export','payroll')` **+ `('view-line','payroll-period')`** (§18) | XLSX bảng lương kỳ; **audit bắt buộc**; > 10.000 dòng ⇒ 422 (016) |
| PAYROLL-API-018 | `GET /payroll-periods/summary` | **`('view-line','payroll-period')`** **+ SÀN scope Company** | tổng gross/net + headcount + trạng thái kỳ gần nhất — nguồn widget DASH; route khai **TRƯỚC** `/payroll-periods/:id` |
| PAYROLL-API-019 | `GET /salary-profiles` | `('view','salary-profile')` | filter `userId` · `effectiveOn`; pagination; **audit lượt đọc**; mask theo quyền |
| PAYROLL-API-020 | `POST /salary-profiles` | `('manage','salary-profile')` | 🔁 **v2 đổi PAYLOAD, KHÔNG cấp route mới**: `{ userId, effectiveDate, baseSalary, salaryType?, pitPayer?, insuranceSalary?, probationSalary?, payRatioPct?, items[], note? }` — **`items[]`** ghi xuống **`salary_profile_items`** *(v1: `allowances[]` → cột `allowances` jsonb)*. **Dual-write cả hai nguồn tới khi CONTRACT** (DB-13 §12.2); trùng `component_code` trong cùng hồ sơ ⇒ **409 014** `kind = profile-item-duplicate`; trùng ngày ⇒ 014 `effective-date-exists`; `Idempotency-Key`; audit |
| PAYROLL-API-021 | `GET /salary-profiles/:id` | `('view','salary-profile')` | chi tiết một phiên bản; **audit lượt đọc** |
| PAYROLL-API-022 | `PATCH /salary-profiles/:id` | `('manage','salary-profile')` | sửa số tiền/ghi chú/ngày hiệu lực · xoá mềm (`{ delete: true }`); 🔁 **v2 nhận thêm `items[]` — ĐẶT LẠI TOÀN BỘ** danh sách **`salary_profile_items`** của phiên bản đó trong MỘT transaction (cùng khuôn 053), **không** sửa từng dòng rời; trùng `component_code` ⇒ **409 014** `profile-item-duplicate`; **không** đụng phiếu đã phát hành (snapshot đóng băng); audit |
| PAYROLL-API-023 | `GET /bonus-penalties` | `('view','bonus-penalty')` | filter `periodMonth` · `status[]` · `kind` · `userId`; pagination |
| PAYROLL-API-024 | `POST /bonus-penalties` | `('manage','bonus-penalty')` | `{ userId, kind, amount, periodMonth, reason }` — `reason` bắt buộc; `Idempotency-Key`; audit |
| PAYROLL-API-025 | `GET /bonus-penalties/:id` | `('view','bonus-penalty')` | chi tiết |
| PAYROLL-API-026 | `PATCH /bonus-penalties/:id` | `('manage','bonus-penalty')` | sửa · xoá mềm — chỉ khi `Pending` (⇒ 011); đã consume ⇒ 013; audit |
| PAYROLL-API-027 | `POST /bonus-penalties/:id/approve` | `('approve','bonus-penalty')` | tự duyệt ⇒ 012; audit |
| PAYROLL-API-028 | `POST /bonus-penalties/:id/reject` | `('approve','bonus-penalty')` | `{ note }` **bắt buộc**; audit |
| PAYROLL-API-029 | `GET /payslips` | `('view-payslip','payslip')` | filter `payrollPeriodId` · `userId`; pagination; **audit lượt đọc** |
| PAYROLL-API-030 | `GET /payslips/:id` | `('view-payslip','payslip')` | phiếu + dòng chi tiết + trạng thái dẫn xuất (§13.2); **audit lượt đọc** |
| PAYROLL-API-031 | `GET /me/payslips` | `('view-own-payslip','payslip')` | Own — 🔁 **v2: kỳ ∈ `{Published, Paid, Locked}`** *(v1: chỉ `Paid`/`Locked`)*; caller không có phiếu ⇒ danh sách rỗng |
| PAYROLL-API-032 | `GET /me/payslips/:id` | `('view-own-payslip','payslip')` | Own — breakdown giải-thích-được; 🔁 **cùng bộ lọc kỳ với 031**; phiếu người khác ⇒ **404** (010) |
| PAYROLL-API-033 | `POST /me/payslips/:id/acknowledge` | `('acknowledge-own-payslip','payslip')` | Own; 🔁 **v2: kỳ chưa `Published`** ⇒ 015 `payslip-not-published` *(v1: chưa `Paid`)*; lần hai ⇒ 015 `already-acknowledged` |
| PAYROLL-API-034 | `GET /payroll/pickers/people` | `('view','salary-profile')` | danh bạ chọn nhân sự: `?q=&limit=` → `{ userId, fullName, employeeCode? }` người còn sống trong company — qua **điểm chiếu danh tính duy nhất** (§18); role `payroll-officer` **không có cặp HR** nên KHÔNG dùng API-03 |
| PAYROLL-API-035 | `GET /payroll/pickers/attendance-periods` | `('manage','payroll-period')` | danh sách kỳ công để gắn vào kỳ lương: `?status=&limit=` → `{ id, periodMonth, status }` — **bắt buộc** vì `GET /attendance/periods` gác bằng `('read','attendance')` mà `payroll-officer` **không có cặp ATT nào** (§11.1 §9g: 0 cặp ngoài PAYROLL); thiếu route này thì `PAYROLL-API-002/004` không dùng được (đúng lớp lỗi RECRUIT B4). Trường bó hẹp, qua cùng repository chiếu |

> **35 mã = 35 route HTTP** (không mã nào gói 2 route). Route-census đếm route — WO BE regen với 35, khai `API_MODULE_TAGS` cho `PAYROLL`. Hai route tĩnh `summary` (018) và `readiness` (006 — dưới `:id` nên an toàn) khai đúng thứ tự: **`/payroll-periods/summary` phải đứng TRƯỚC `/payroll-periods/:id`** (bài học `goals/tree`).
>
> **Hai picker là bắt buộc, không phải tiện nghi** — `payroll-officer` giữ **0 cặp ngoài PAYROLL** (§9g), nên mọi lựa-chọn-tham-chiếu phải có đường riêng: `034` (nhân sự, gác `('view','salary-profile')`) và `035` (kỳ công, gác `('manage','payroll-period')`). §11.1 bảo đảm **mọi role giữ `('manage','bonus-penalty')` đều giữ `('view','salary-profile')`** — migration seed verify fail-loud, để màn thưởng/phạt không chết vì thiếu danh bạ.
>
> ⚠️ **Ratchet route-HTTP là cổng KHÁC route-census:** `apps/api/test/foundation/route-http-coverage.e2e-spec.ts` đặt `MAX_UNCOVERED_TOTAL = 0` và `MIN_COVERED_COUNT` là **SÀN**; từ khoá `salary`/`payslip` xếp nhóm PAYROLL vào rủi ro cao ⇒ **mọi route mới phải có file test chạm đúng literal path**, và phải **siết `MIN_COVERED_COUNT` cùng commit** với WO BE.

---

### 15.1 **v2** — PAYROLL-API-036..085 (50 route mới)

**Track A — Nhân viên · hồ sơ lương v2 · bảng công** *(WO BE-1)*

| Mã | Endpoint | Cặp quyền | Ghi chú |
| --- | --- | --- | --- |
| 036 | `GET /payroll/employees` | `('view','payroll-employee')` | danh sách nhân sự hưởng lương — **chiếu HR bó hẹp qua `PayrollPeopleRepository`** (PAY-DEC-016), mở rộng 034; filter `q` · `orgUnitId` · `hasSalaryProfile`; **audit lượt đọc** |
| 037 | `GET /payroll/employees/:userId` | `('view','payroll-employee')` | tab «Thông tin chung»; **`taxCode` CHỈ có mặt khi caller thêm `('view','salary-profile')`** — vắng khoá nếu không (§18.1); audit |
| 038 | `GET /payroll/employees/:userId/settings` | `('view','payroll-employee')` | BH · công đoàn · **`bankAccountLast4`** (không bao giờ số đầy đủ); audit |
| 039 | `PUT /payroll/employees/:userId/settings` | `('manage','payroll-employee')` | upsert 1 hàng/nhân sự; `Idempotency-Key`; audit **không kèm số TK** |
| 040 | `GET /payroll/employees/:userId/dependents` | `('view','payroll-employee')` | người phụ thuộc + khoảng hiệu lực; audit |
| 041 | `POST /payroll/employees/:userId/dependents` | `('manage','payroll-employee')` | chồng lấp ⇒ **409 032**; `Idempotency-Key`; audit |
| 042 | `PATCH /payroll/dependents/:id` | `('manage','payroll-employee')` | sửa · xoá mềm (`{ delete: true }`); chồng lấp ⇒ **409 032**; audit |
| 043 | `GET /payroll-periods/:id/timesheet` | `('view-line','payroll-period')` | bảng công tổng hợp kỳ — **tái dùng `computeInputsTx`**, không viết truy vấn thứ hai; pagination; **không số tiền**; audit |

**Track B — thành phần lương · mẫu · tỉ lệ luật định** *(WO BE-2)*

| Mã | Endpoint | Cặp quyền | Ghi chú |
| --- | --- | --- | --- |
| 044 | `GET /payroll/salary-components` | `('view','salary-component')` | filter `kind` · `isSystem` · `isActive`; pagination |
| 045 | `POST /payroll/salary-components` | `('manage','salary-component')` | kiểm cú pháp/vòng/giới hạn khi lưu (⇒ 018/019); `code` reserved ⇒ **409 024**; `Idempotency-Key`; audit **kèm công thức** |
| 046 | `GET /payroll/salary-components/:id` | `('view','salary-component')` | chi tiết + danh sách mẫu đang tham chiếu |
| 047 | `PATCH /payroll/salary-components/:id` | `('manage','salary-component')` | sửa công thức/ngưng dùng; hệ thống ⇒ **không** xoá được (409 024); audit **kèm diff công thức** (§13.6 I) |
| 048 | `POST /payroll/salary-components/validate-formula` | `('manage','salary-component')` | **kiểm tại chỗ, KHÔNG ghi gì** — trả `{ valid, errors[], refs[], depth, nodes }`; nguồn cho editor FE. Vẫn gác cặp GHI vì nó phơi ra chính bộ parser |
| 049 | `GET /payroll/templates` | `('view','payroll-template')` | filter `scope` (`company`/`org_unit`) · `isActive`; pagination |
| 050 | `POST /payroll/templates` | `('manage','payroll-template')` | `Idempotency-Key`; audit |
| 051 | `GET /payroll/templates/:id` | `('view','payroll-template')` | chi tiết + thành phần + **`fingerprint` hiện tại** (§13.6 G) |
| 052 | `PATCH /payroll/templates/:id` | `('manage','payroll-template')` | sửa · ngưng dùng · xoá mềm; audit |
| 053 | `PUT /payroll/templates/:id/components` | `('manage','payroll-template')` | **đặt lại toàn bộ** danh sách (nhãn · công thức ghi đè · ẩn/hiện · thứ tự) trong MỘT lượt — sửa từng dòng rời làm đồ thị **tạm thời có vòng** giữa chừng; kiểm vòng trên **trạng thái sau** (⇒ 019); audit kèm diff |
| 054 | `POST /payroll/templates/:id/preview` | `('manage','payroll-template')` | **xem trước với dữ liệu GIẢ do client gửi** — không chạm dữ liệu thật, **không ghi**, không audit-đọc (không có dữ liệu thật nào bị lộ) |
| 055 | `GET /payroll/statutory-rates` | `('view','statutory-rate')` | danh sách bản theo `effective_from` desc |
| 056 | `POST /payroll/statutory-rates` | `('manage','statutory-rate')` | kiểm **7 bậc liên tục, không hở/chồng** (⇒ **422 022** `statutory-rate-incomplete`); trùng `effective_from` ⇒ **409 033** `rate-effective-date-exists`; `Idempotency-Key`; audit |
| 057 | `GET /payroll/statutory-rates/:id` | `('view','statutory-rate')` | chi tiết một bản |
| 058 | `PATCH /payroll/statutory-rates/:id` | `('manage','statutory-rate')` | sửa bản **chưa có kỳ nào dùng**; đã có kỳ dùng ⇒ **409 033** `rate-in-use` (tạo bản mới thay vì sửa tại chỗ); audit |

**Track C — tạm ứng · chi trả · ngân sách · import** *(WO BE-4)*

| Mã | Endpoint | Cặp quyền | Ghi chú |
| --- | --- | --- | --- |
| 059 | `GET /payroll/advances` | `('view','payroll-advance')` | filter `status[]` · `userId` · `deductPeriodMonth`; pagination; **audit lượt đọc** |
| 060 | `POST /payroll/advances` | `('manage','payroll-advance')` | `{ userId, amount, deductPeriodMonth, reason }` — `reason` bắt buộc; kỳ đích ≥ `Calculated` ⇒ **409 026**; `Idempotency-Key`; audit |
| 061 | `GET /payroll/advances/:id` | `('view','payroll-advance')` | chi tiết; audit |
| 062 | `PATCH /payroll/advances/:id` | `('manage','payroll-advance')` | sửa · xoá mềm — chỉ khi `Pending` (⇒ 025); đã khấu trừ ⇒ 025; audit |
| 063 | `POST /payroll/advances/:id/approve` | `('approve','payroll-advance')` | tự duyệt ⇒ **409 025** `self-approval`; NOTI-EVENT-025; audit |
| 064 | `POST /payroll/advances/:id/reject` | `('approve','payroll-advance')` | `{ note }` **bắt buộc**; NOTI-EVENT-026; audit |
| 065 | `GET /me/payroll-advances` | `('view-own','payroll-advance')` | Own; caller không có tạm ứng ⇒ **rỗng**, không lỗi; **KHÔNG ghi audit lượt đọc** (tự xem của mình — cùng luật `/me/payslips`) |
| 066 | `GET /payroll/payment-batches` | `('view','payment-batch')` | filter `payrollPeriodId` · `status[]` · `method`; pagination; audit |
| 067 | `POST /payroll/payment-batches` | `('manage','payment-batch')` | kỳ chưa `Published` ⇒ **409 027**; `Idempotency-Key`; audit |
| 068 | `GET /payroll/payment-batches/:id` | `('view','payment-batch')` | chi tiết + tổng; audit |
| 069 | `PATCH /payroll/payment-batches/:id` | `('manage','payment-batch')` | sửa · thêm/bớt dòng — chỉ khi `Draft`/`Ready`; nhân sự đã ở đợt khác của cùng kỳ ⇒ **409 027**; audit |
| 070 | `GET /payroll/payment-batches/:id/lines` | `('view','payment-batch')` | dòng chi trả — **`bankAccountLast4`**, không số đầy đủ; pagination; audit |
| 071 | `GET /payroll/payment-batches/:id/export` | 🔴 **BA CẶP, assert CẢ BA**: `('manage','payment-batch')` **+ `('export','payroll')` + `('view-payslip','payslip')`** | **tệp UNC XLSX — đường DUY NHẤT số tài khoản ĐẦY ĐỦ rời server** (§3.12), và tệp mang **net từng người**; **audit BẮT BUỘC** (payload = batch + số dòng, **không** số TK, **không** số tiền); > 10.000 dòng ⇒ 422 016. Ba cặp vì: **`export:payroll`** là luật «export đòi CẢ HAI cặp» của §11.1 (017 · 082 · 085 đều tuân), **`view-payslip:payslip`** là vế ĐỌC số tiền (tệp lấy net từ `payslip_id`), **`manage:payment-batch`** là vế đợt chi. Gác bằng **đúng một cặp GHI** — như bản nháp — cho một role chỉ có `manage:payment-batch` tải được **payload nhạy cảm nhất toàn hệ thống** mà không cần cặp đọc nào (bài học RECRUIT H5) |
| 072 | `POST /payroll/payment-batches/:id/complete` | `('manage','payment-batch')` | **row-lock kỳ TRƯỚC, đợt SAU** (§13.1); đợt **0 dòng còn hiệu lực** ⇒ **409 028** `batch-empty`; còn dòng chưa chi ⇒ **409 027**; hoàn tất lần hai ⇒ 409 027. 🔴 **Kỳ sang `Paid` CHỈ khi lượt này làm PHỦ ĐỦ kỳ** (§13.1 luật PHỦ) — chưa phủ đủ ⇒ **200**, đợt `Completed`, kỳ **giữ `Published`**, body `{ periodStatus, unpaidPayees }`; phủ đủ ⇒ `Published → Paid` + ghi `paid_by/at` + **NOTI-EVENT-027**; `Idempotency-Key`; audit |
| 073 | `GET /payroll/budgets` | `('view','payroll-budget')` | filter `fiscalYear` · `orgUnitId`; kèm **thực hiện** (cộng từ kỳ đã `Published`+); nguồn widget 002; **SÀN scope `Company`**; audit |
| 074 | `POST /payroll/budgets` | `('manage','payroll-budget')` | trùng `(năm, đơn vị)` ⇒ **409 029**; `Idempotency-Key`; audit |
| 075 | `PATCH /payroll/budgets/:id` | `('manage','payroll-budget')` | sửa · xoá mềm; audit |
| 076 | `POST /payroll-periods/:id/import-adjustments` | `('manage','bonus-penalty')` | import XLSX thu nhập/khấu trừ khác (khuôn HR import) → `bonus_penalties` **trạng thái `Pending`** (không tự duyệt); **toàn tệp hoặc không dòng nào** (⇒ 422 030); `Idempotency-Key`; audit |
| 077 | `GET /payroll/imports/adjustments-template` | `('manage','bonus-penalty')` | tải **tệp mẫu XLSX** sinh từ chính khuôn mà 076 parse — tệp mẫu tĩnh ở FE sẽ trôi khỏi parser |

**Track D — tổng quan · báo cáo · PDF** *(WO BE-5)*

| Mã | Endpoint | Cặp quyền | Ghi chú |
| --- | --- | --- | --- |
| 078 | `GET /payroll/overview` | `('view','payroll-report')` **+ SÀN scope `Company`** | 6 khối của PAY-SCREEN-015; **KHÔNG cache**; audit mỗi lượt |
| 079 | `GET /payroll/overview/reminders` | `('view','payroll-report')` **+ SÀN `Company`** | 3 loại lời nhắc; **KHÔNG cache**; audit |
| 080 | `GET /payroll/reports` | `('view','payroll-report')` | **danh mục 7 báo cáo (metadata)** — mã · tên · tham số; **không số liệu** nên không audit-đọc |
| 081 | `GET /payroll/reports/:reportCode` | `('view','payroll-report')` **+ SÀN `Company`** | dữ liệu báo cáo, SQL set-based, pagination; > 50.000 dòng ⇒ **422 031**; **KHÔNG cache**; **audit mỗi lượt** kèm `reportCode` + bộ lọc, **không** số tiền |
| 082 | `GET /payroll/reports/:reportCode/export` | `('view','payroll-report')` **+ `('export','payroll')`** | XLSX; **audit bắt buộc** |
| 083 | `GET /payslips/:id/pdf` | `('view-payslip','payslip')` **+ `('export','payroll')`** | PDF phiếu **của người khác** — sinh từ snapshot `payslip_items`, **không tính lại**; signed-URL; audit |
| 084 | `GET /me/payslips/:id/pdf` | `('view-own-payslip','payslip')` | Own — **KHÔNG cần cặp export** (PAY-DEC-019); **dùng CÙNG bộ lọc kỳ `{Published, Paid, Locked}` với 031/032** (§13.2); phiếu người khác ⇒ **404 010** |
| 085 | `POST /payroll-periods/:id/payslips/pdf-batch` | `('export','payroll')` **+ `('view-payslip','payslip')`** | sinh PDF hàng loạt → signed-URL tệp ZIP; > 2.000 phiếu ⇒ **422 031**; `Idempotency-Key`; **audit bắt buộc** |

> 🔴 **`salary_profile_items` KHÔNG được cấp route riêng — có chủ đích.** Bảng mới duy nhất của v2 không có mã `PAYROLL-API-*` nào: nó là **bảng con của `salary_profiles`**, nên bề mặt ghi/đọc của nó đi qua **020 · 021 · 022** (payload `items[]`, xem hàng 🔁 ở §15 — `022` đặt lại **toàn bộ** danh sách trong một tx, cùng khuôn 053). Cấp thêm `086/087` là **phá con số 50 đã ĐÓNG** của §5.1b để đổi lấy đúng một bảng CRUD lồng; đổi ngầm payload 020/022 mà **không đánh dấu** thì WO BE-1 phải tự đoán — cả hai lối đều sai, nên bản này chọn lối thứ ba: **giữ 50 route, đánh dấu 🔁 tại chỗ**. Unique của bảng có mã lỗi riêng: **409 `PAYROLL-ERR-014` `kind = profile-item-duplicate`** (§12.1 · §12 hàng 014).
>
> **50 mã = 50 route HTTP** (không mã nào gói 2 route) ⇒ **tổng module sau v2 = 85 route**. WO BE regen route-census với 85 và **siết `MIN_COVERED_COUNT` của `route-http-coverage.e2e-spec.ts` CÙNG COMMIT** với từng WO BE — cổng đó có `MAX_UNCOVERED_TOTAL = 0` và xếp `salary`/`payslip` vào nhóm rủi ro cao, nên **mỗi route mới phải có file test chạm đúng literal path**.
>
> ⚠️ **Bốn bẫy thứ tự khai route** *(cùng lớp `goals/tree` mà v1 đã vấp ở `summary`)* — route TĨNH phải khai **TRƯỚC** route `:id` cùng cấp:
> `GET /payroll/reports` (080) **trước** `GET /payroll/reports/:reportCode` (081) · `POST /payroll/salary-components/validate-formula` (048) **trước** `PATCH /payroll/salary-components/:id` (047) · `GET /payroll/imports/adjustments-template` (077) đứng dưới prefix riêng nên an toàn · và **`GET /payroll/employees/:userId/...` (037–041) phải nằm trong controller có prefix `payroll/employees`** để không đụng `payroll/pickers`.
>
> ⚠️ **`PATCH /payroll/dependents/:id` (042) KHÔNG nằm dưới `/payroll/employees/:userId`** — có chủ đích: `dependentId` đã đủ định danh, và lồng thêm `userId` tạo **hai nguồn sự thật cho cùng một phép kiểm quyền** (URL nói người A, hàng DB nói người B). Service vẫn kiểm hàng thuộc company + resolve `userId` **từ hàng**, không từ URL.
>
> ⚠️ **MƯỜI MỘT route mới nhận `Idempotency-Key` do CLIENT sinh** — danh sách ĐÓNG, đối chiếu với cột «Ghi chú» của bảng trên: **039 · 041 · 045 · 050 · 056 · 060 · 067 · 072 · 074 · 076 · 085**. Khoá **không** suy từ payload (`idempotency-key-must-be-content-derived` đọc ngược lại chính là bẫy — server tự suy khoá từ payload làm hai lượt khác nhau đụng nhau). Chống trùng **nghiệp vụ** vẫn là việc của UNIQUE ở DB.

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
| `PAYROLL_PERIOD_SUBMITTED` | NOTI-EVENT-020 | kỳ lương gửi duyệt (commit) | **người duyệt hợp lệ** theo `PayrollApproverReader` — CÙNG bộ giải với PAYROLL-ERR-017 (§13.1), `recipient.mode='UserIds'`, trừ actor. **KHÔNG tự tra role `company-admin` riêng** | `{periodId}:{submittedAtIso}` — **mỗi LẦN gửi là một sự kiện** (reject → sửa → gửi lại phải báo lại; engine `DedupeKey` là once-ever, không có bucket thời gian) |
| `PAYROLL_PERIOD_APPROVED` | NOTI-EVENT-021 | kỳ được duyệt | `submitted_by` (người gửi duyệt), trừ actor | `{periodId}:{approvedAtIso}` |
| `PAYROLL_PERIOD_REJECTED` | NOTI-EVENT-022 | kỳ bị từ chối | `submitted_by`, trừ actor | `{periodId}:{updatedAtIso}` — `reject` KHÔNG có cột `rejected_at` |
| `PAYSLIP_PUBLISHED` | NOTI-EVENT-023 | phát hành phiếu lương (🔁 **v2: `Approved → Published`** *(v1: `Approved → Paid`)*, commit) | **từng nhân sự có phiếu** trong kỳ (`payslips.user_id`), trừ actor | `{payslipId}` (một phiếu báo đúng một lần) |

- `notification_type = 'Payroll'`, `module_code = 'PAYROLL'`, `priority` Normal (020/021) · High (022/023), `isEnabled=true`, `isSystemEvent=false` cả 4 — **PAYROLL v1 không có system job** (mọi event đều event-driven; nhắc chốt kỳ = Phase sau nếu cần).
- **`dedupe_strategy = 'DedupeKey'`** ngay seed đầu cho cả 4 (mặc định `'None'` biến `dedupeKey` thành chuỗi trang trí — bài học `0479`/`0507`/`0538`).
- **Payload TUYỆT ĐỐI KHÔNG chứa số tiền** — chỉ `periodMonth` + tên kỳ + lý do từ chối (022) + liên kết (`/payroll/periods/:id` cho 020/021/022, `/me/payslips` cho 023). Đây là ràng buộc mạnh hơn các module khác: NOTI đi qua nhiều kênh và không có tầng masking riêng.
- **Khoá dedupe là CONTENT-DERIVED, KHÔNG dùng `auditLogId`** (đính chính 2026-09-01, S13-PAYROLL-BE-2): `AuditService.record` trả **`void`**, không có id để ghép — bản trước của bảng này (và comment trong mig `0566`) viết `{auditLogId}` khi chưa đo tầng audit. Nửa sau của khoá lấy từ **`RETURNING` của chính câu UPDATE đổi trạng thái**, nên tính chất «mỗi LẦN gửi là một sự kiện» vẫn giữ nguyên.
- **Cột «Dedupe» ở trên là phần do PRODUCER sinh.** Engine tự ghép tiền tố: `NotificationDedupeService.computeKey` trả `${eventCode}:${dedupeKey}` — registrar **không** được tự thêm `eventCode`, kẻo khoá lưu xuống mang tiền tố đôi.
- Phát qua **OutboxNotificationBridge**, enqueue trong CÙNG transaction nghiệp vụ. `registerSource()` fail-loud lúc boot ⇒ seed NOTI (**DB-13 §10 bước C**) phải merge **trước** khi WO BE đăng ký registrar.
- **Người nhận đi THEO PAYLOAD outbox, không resolve lại lúc giao**: `PayrollApproverReader` chạy ở `submit` (cùng lượt với cổng `PAYROLL-ERR-017`) và nhét danh sách vào payload. Đọc lại DB lúc giao là dựng **bộ giải thứ hai** — hai bộ giải lệch nhau đẻ đúng thất bại mà 017 sinh ra để chặn.
- Đo dải mã chuẩn ngày 31/08/2026: SPEC-01 §20.2 dừng ở **NOTI-EVENT-019** (ASSET 010–012 · ROOM 013–015 · RECRUIT 016–019). PAYROLL cấp tiếp **020–023**; module sau lấy **024+** — **đo lại bằng grep `NOTI-EVENT-0` trước khi cấp**, không mặc định còn trống.

---

### 17.1 **v2** — NOTI-EVENT-024..027

> **Đo dải ngày 11/09/2026:** SPEC-01 §20.2 và SPEC-08 §15.0 dừng ở **NOTI-EVENT-023** (chính PAYROLL v1 giữ 020–023). ⇒ v2 cấp **024–027**; module sau lấy **028+**, **đo lại bằng grep trước khi cấp**.

| Event code | Mã chuẩn | Khi nào | Người nhận | Dedupe (phần PRODUCER sinh) |
| --- | --- | --- | --- | --- |
| `PAYROLL_ADVANCE_SUBMITTED` | **NOTI-EVENT-024** | tạo tạm ứng (`Pending`, commit) | **người duyệt hợp lệ** của tạm ứng, trừ actor — bộ giải riêng theo cặp `('approve','payroll-advance')`, **cùng KHUÔN `PayrollApproverReader`** | `{advanceId}:{createdAtIso}` |
| `PAYROLL_ADVANCE_APPROVED` | **NOTI-EVENT-025** | tạm ứng được duyệt | **nhân sự thụ hưởng** (`payroll_advances.user_id`) **+ người tạo**, trừ actor | `{advanceId}:{decidedAtIso}` |
| `PAYROLL_ADVANCE_REJECTED` | **NOTI-EVENT-026** | tạm ứng bị từ chối | như trên, trừ actor | `{advanceId}:{decidedAtIso}` |
| `PAYROLL_PAYMENT_BATCH_COMPLETED` | **NOTI-EVENT-027** | 🔁 **chỉ ở lượt hoàn tất làm kỳ CHUYỂN sang `Paid`** (luật PHỦ §13.1, commit) — hoàn tất đợt giữa chừng (kỳ vẫn `Published`) **KHÔNG** phát | người giữ `('view','payment-batch')` trong company, trừ actor | `{periodId}` — **một KỲ báo đúng một lần** *(dùng `{batchId}` thì kỳ nhiều đợt đẻ nhiều thông báo «đã chi trả» cho cùng một kỳ)* |

- `notification_type = 'Payroll'`, `module_code = 'PAYROLL'` — **CHECK của hai giá trị này đã được `0566` nới cho cả hai bảng** (`notification_events` **và** `notifications`); v2 **không cần nới lại**, WO DB **ĐO rồi NO-OP có chủ đích** kèm `RAISE NOTICE` thay vì viết ALTER rỗng.
- **`dedupe_strategy = 'DedupeKey'` ngay seed đầu** cho cả 4 (mặc định `'None'` biến `dedupeKey` thành chuỗi trang trí). `isSystemEvent = false` cả 4 — **v2 vẫn KHÔNG có system job**. `priority`: 024 Normal · 025/026 **High** (ảnh hưởng trực tiếp tiền của một cá nhân) · 027 Normal.
- **Payload TUYỆT ĐỐI KHÔNG chứa số tiền** — kể cả số tạm ứng. 025/026 gửi tới **chính nhân sự thụ hưởng**, nên số tiền *của họ* nghe có vẻ vô hại; nhưng NOTI đi qua nhiều kênh (email/push) và **không có tầng masking riêng**, nên luật là ĐÓNG: chỉ `{ advanceId, deductPeriodMonth, reason?/note?, link }`. Nhân viên bấm vào xem số ở `/me/payroll-advances`.
- **Người nhận đi THEO PAYLOAD outbox**, resolve **một lần** lúc ghi, không resolve lại lúc giao (cùng luật §17 v1 — hai bộ giải lệch nhau đẻ đúng lỗi mà cổng sinh ra để chặn).
- **`PAYSLIP_PUBLISHED` (023) đổi ĐIỀU KIỆN PHÁT, giữ nguyên mã và dedupe**: v1 phát ở `Approved → Paid`; **v2 phát ở `Approved → Published`** (`publish`, API-014). Nếu bám theo tên trạng thái mà dời sang `complete-batch` thì nhân viên **chỉ được báo sau khi ngân hàng xong** — trái đúng ý PAY-DEC-017. Đây là **thay đổi hành vi im lặng nhất của wave**: mã, dedupe key, người nhận đều không đổi, chỉ chỗ gọi đổi. QA có ca ghim: `publish` ⇒ **có** outbox 023; `complete-batch` ⇒ **không** có 023.

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

### 18.1 **v2** — bổ sung audit & bảo mật

**A. Masking — ba lớp mới**

| Trường | Mặc định trong DTO | Đường DUY NHẤT ra bản đầy đủ |
| --- | --- | --- |
| `bankAccountNumber` | **`bankAccountLast4`** (4 số cuối) — khoá `bankAccountNumber` **không bao giờ** có mặt | **tệp UNC** của `PAYROLL-API-071`, gác `('manage','payment-batch')` + audit |
| `taxCode` (chiếu từ HR) | **vắng khoá** nếu caller thiếu `('view','salary-profile')` | 037 / tab «Thuế TNCN», audit lượt xem |
| NPT (họ tên · MST NPT) | chỉ với `('view','payroll-employee')` | 040, audit lượt xem |

> ⚠️ **`bankAccountLast4` là trường DẪN XUẤT do server tính, KHÔNG phải cột.** Lưu thêm một cột 4-số-cuối là nhân đôi nguồn sự thật cho cùng một dữ liệu và mở đường cho hai bên lệch nhau. Riêng `payroll_payment_lines.bank_account_snapshot` **là cột thật** — nó đóng băng số **lúc gửi ngân hàng** (§8.2 C3), và cột đó cũng **mask khi đọc qua 070**.

**B. Audit lượt ĐỌC — v1 có 7 đường, v2 thêm 18 ⇒ tổng 25**

**Mỗi đường phải khai `object_type` + `object_id` TẠI ĐÂY, không để WO tự chọn** — `object_type` ngoài bản đồ ĐÓNG của §12.1 là **CHECK violation ⇒ 500 ngay trên đường đọc**, và `audit_logs.object_id` là **cột `uuid` NULLABLE** (`audit.ts:36`) nên mọi định danh **không phải UUID** (ví dụ `reportCode`) **bắt buộc** đi vào payload, không đi vào `object_id`.

| # | Mã | Route | `object_type` | `object_id` | Payload bắt buộc *(không bao giờ có số tiền)* |
| --- | --- | --- | --- | --- | --- |
| 1 | `036` | `GET /payroll/employees` | `payroll_employee` | **NULL** *(đọc DANH SÁCH)* | `{ filters, rowCount }` |
| 2 | `037` | `GET /payroll/employees/:userId` | `payroll_employee` | `userId` | `{ taxCodeRevealed: bool }` |
| 3 | `038` | `GET /payroll/employees/:userId/settings` | `payroll_employee_setting` | `userId` *(1 hàng/nhân sự; hàng có thể CHƯA tồn tại ⇒ neo theo `userId`, không theo `id`)* | `{}` — **không** số TK |
| 4 | `040` | `GET /payroll/employees/:userId/dependents` | `payroll_dependent` | `userId` *(neo CHA — đọc cả danh sách NPT của một người)* | `{ rowCount }` |
| 5 | `043` | `GET /payroll-periods/:id/timesheet` | `payroll_period` | `payrollPeriodId` | `{ rowCount }` |
| 6 | `059` | `GET /payroll/advances` | `payroll_advance` | **NULL** | `{ filters, rowCount }` |
| 7 | `061` | `GET /payroll/advances/:id` | `payroll_advance` | `advanceId` | `{}` |
| 8 | `066` | `GET /payroll/payment-batches` | `payroll_payment_batch` | **NULL** | `{ filters, rowCount }` |
| 9 | `068` | `GET /payroll/payment-batches/:id` | `payroll_payment_batch` | `batchId` | `{}` |
| 10 | `070` | `GET /payroll/payment-batches/:id/lines` | `payroll_payment_batch` *(dòng chi **không** có `object_type` riêng)* | `batchId` | `{ rowCount }` |
| 11 | `071` | `GET /payroll/payment-batches/:id/export` | `payroll_payment_batch` | `batchId` | `{ rowCount, format:'xlsx' }` — **không** số TK |
| 12 | `073` | `GET /payroll/budgets` | `payroll_budget` | **NULL** | `{ fiscalYear, orgUnitId?, rowCount }` |
| 13 | `078` | `GET /payroll/overview` | `payroll_report` | **NULL** | `{ reportCode:'overview' }` |
| 14 | `079` | `GET /payroll/overview/reminders` | `payroll_report` | **NULL** | `{ reportCode:'overview.reminders' }` |
| 15 | `081` | `GET /payroll/reports/:reportCode` | `payroll_report` | **NULL** *(`reportCode` KHÔNG phải UUID)* | `{ reportCode, filters, rowCount }` |
| 16 | `082` | `GET /payroll/reports/:reportCode/export` | `payroll_report` | **NULL** | `{ reportCode, filters, rowCount, format:'xlsx' }` |
| 17 | `083` | `GET /payslips/:id/pdf` | `payslip` | `payslipId` | `{ format:'pdf' }` |
| 18 | `085` | `POST /payroll-periods/:id/payslips/pdf-batch` | `payroll_period` | `payrollPeriodId` | `{ payslipCount, format:'zip' }` |

> **Hai `object_type` MỚI của bảng này là lý do §12.1 cấp 10 giá trị chứ không phải 8**: `payroll_employee` (hàng 1–2) và `payroll_report` (hàng 13–16). Cả hai **không ứng với bảng nào** — đó chính là lý do chúng bị bỏ sót ở bản nháp: người viết đi từ danh sách BẢNG, còn audit đi từ danh sách ĐƯỜNG ĐỌC. QA có census: **mọi mã trong bảng này phải có đúng một `object_type` thuộc danh sách ĐÓNG §12.1**, so theo MÃ route, không theo tên hàm.

**KHÔNG audit lượt đọc**: `065` (`/me/payroll-advances`) · `084` (PDF phiếu của mình) · `080` (danh mục báo cáo — metadata, không số liệu) · `054` (xem trước mẫu — dữ liệu giả do client gửi). Cùng một luật với `/me/payslips*` của v1: **tự xem của mình không phải sự kiện an ninh**, và ghi thì đẻ nhiễu che mất lượt xem đáng ngờ thật.

Khuôn vẫn là **reveal + audit ATOMIC** (cùng transaction với lượt đọc; rollback ⇒ 0 audit).

**C. Allowlist capability — HAI danh sách, APPEND**

30 cặp sensitive sau v2 phải có mặt ở **cả hai**: `SENSITIVE_CAPABILITY_ALLOWLIST` (`permission.service.ts:43`) **và** `SENSITIVE_SCREEN_GATE_PAIRS` (`:246`). Đo v1 = 13 mục mỗi bên. Khai **APPEND vào cuối khối PAYROLL**, không rewrite khối (hot-file). `sensitive-screen-gate-allowlist.spec.ts` siết cùng commit.

**D. Bề mặt mới cần nói thẳng**

- **Máy công thức là RCE-adjacent.** Không `eval`/`new Function`/truy cập thuộc tính; parser tự viết; danh sách hàm ĐÓNG (§13.6 A). QA có **fuzz** trên parser (chuỗi ngẫu nhiên · ngoặc lồng sâu · số dài · unicode · null byte) với yêu cầu: **luôn 422 có mã, không bao giờ 500, không bao giờ treo**.
- **`POST /payroll/salary-components/validate-formula` (048) gác cặp GHI dù không ghi gì** — nó phơi ra chính parser; để cặp đọc là mở bề mặt fuzz cho mọi người đọc được catalog.
- **Báo cáo KHÔNG cache** (PAY-DEC-018) — vừa vì số liệu tiền phải tươi, vừa vì **cache hit bỏ qua audit** (`widget-cache-hit-skips-audit-trail`) mà §18.1 B đòi audit **mỗi lượt**. Đây là lý do kỹ thuật, không phải sở thích: bật cache là tự tay xoá vết.
- **`mediaos_worker` vẫn KHÔNG được `SELECT`** trên bảng lương mới có số tiền per-người: `salary_profile_items` · `payroll_advances` · `payroll_payment_lines`. v2 **không** thêm system job nào. Thu hồi/không-cấp ngay ở WO DB, không đẩy sang BE (cùng luật §18 v1).
- **RLS + FORCE + composite tenant FK cho cả 11 bảng mới**, policy tạo **TRƯỚC** mọi INSERT; đăng ký `rls-registry`. Bảng nào có `payroll_period_id` hoặc `user_id` đều cần **composite** `(company_id, x_id)` (`new-fk-column-needs-composite-tenant-fk`).
- **`GRANT DELETE`: 10/11 bảng mới KHÔNG có — ĐÚNG MỘT ngoại lệ có chủ đích là `payroll_template_components`** (DB-13 §13.6). Lý do: `PUT /payroll/templates/:id/components` (API-053) **đặt lại toàn bộ** danh sách trong một transaction, và bảng đó là **cấu hình thuần** — 0 dữ liệu tiền, 0 giá trị lịch sử (lịch sử nằm ở `component_values_json` + `template_fingerprint` của dòng lương đã tính, và ở `audit_logs` với diff công thức). Làm bằng soft delete thì mỗi lần sắp xếp lại cột tích luỹ hàng chết vô hạn. ⚠️ Ngoại lệ này **làm ratchet GRANT đỏ** ⇒ WO DB cập nhật pin **cùng commit**, kèm comment trỏ về DB-13 §13.6 — và **KHÔNG được nới thành tiền lệ cho bảng khác**.
- **`payroll_payment_lines` KHÔNG nằm trong ngoại lệ đó** — nó chở dòng tiền nên dùng **soft delete**, và sau khi đợt `Completed` thì **trigger hẹp** đóng băng `payslip_id` · `bank_account_snapshot` · `paid_at` · **`deleted_at`** (khoá cả `deleted_at` là bắt buộc: thiếu vế đó thì vẫn xoá mềm được một người khỏi bảng chi trả **sau khi đã chi**). Không thu hồi UPDATE toàn bảng — còn phải sửa dòng lúc `Draft`.

---

## 19. Non-functional requirements

- Tính lương cho 500 nhân sự < 5s (một câu lệnh SQL set-based per kỳ, **không vòng lặp per-người ở JS**); bảng lương 500 dòng lọc/phân trang < 300ms (index `(company_id, payroll_period_id)` — DB-13 §6).
- Chi tiết phiếu lương (phiếu + dòng + đầu vào) **một truy vấn** chính (không N+1); `summary` một `GROUP BY` trên `payroll_period_lines`/`payslips`.
- Export XLSX stream theo trang, chặn > 10.000 dòng/lần — **422 PAYROLL-ERR-016** gợi ý thu hẹp bộ lọc.
- **TZ & biên kỳ**: cắt kỳ tháng làm ở **BE** (UTC-at-rest; FE **không có** `companies.timezone` — `fe-has-no-company-timezone`); có ca test cuối tháng + pro-rate giữa kỳ (người vào/nghỉ giữa tháng).
- i18n: nhãn qua react-i18next namespace `payroll`; trạng thái hiển thị từ constants chuẩn SPEC-01 §17.15–17.17; số tiền định dạng VND + `tabular-nums`.

### 19.1 **v2** — NFR đổi theo PAY-DEC-012

> **Ngân sách «500 nhân sự < 5s» GIỮ NGUYÊN, nhưng cấu thành đổi.** v1: một câu SQL làm tất. v2: **đọc** vẫn set-based một lượt, **tính** chạy trong TS. Vì vậy điều cấm cũng đổi hình: không còn cấm được «vòng lặp per-người» (evaluator **bắt buộc** chạy per-dòng), mà cấm **truy vấn** per-người.

| Ràng buộc | Trần | Ghi chú |
| --- | --- | --- |
| Số **câu truy vấn** của một lượt `calculate` | **O(1) theo số nhân sự** | đọc đầu vào 1 lượt · đọc mẫu+thành phần 1 lượt · đọc tỉ lệ 1 lượt · đọc NPT 1 lượt · **ghi 1 lượt** (`INSERT … ON CONFLICT` bind mảng). Ca QA **đếm CÂU SQL**, không đếm builder (`nplus1-test-must-count-queries-not-builders`) |
| Đánh giá công thức | **≤ 2ms/dòng** (p95) với mẫu 120 thành phần | 500 dòng ⇒ < 1s; cộng I/O vẫn trong trần 5s |
| Gross-up | ≤ **30 vòng**/dòng; mỗi vòng ≤ **25.000** node (`BUDGET_PER_PASS`), **tổng cả dòng ≤ 775.000** node (`BUDGET_PER_LINE` = 25.000 × 31) — §13.6 C · §13.8 | hai trần **đồng thời**: trần-mỗi-lượt giữ chi phí một vòng bằng hồ sơ GROSS, trần-tổng chặn hồ sơ NET ngốn 31 lần mà vẫn «trong hạn». **KHÔNG** dùng một trần 25.000 chung cho cả 30 vòng — con số đó làm hồ sơ NET **bất khả thi về toán học** |
| Báo cáo (081) | < 2s cho 12 kỳ × 500 nhân sự; > 50.000 dòng ⇒ 422 031 | SQL set-based; **KHÔNG cache** (§18.1 D) |
| PDF một phiếu (083/084) | < 1,5s | sinh từ snapshot, không tính lại |
| PDF hàng loạt (085) | chạy nền, trả signed-URL; ≤ 2.000 phiếu | > trần ⇒ 422 031 |

- **Font Việt phải NHÚNG vào PDF** (`pdfmake` + `Be Vietnam Pro`/`Roboto`): rơi về font mặc định là phiếu lương **mất dấu tiếng Việt** — hỏng thầm lặng, không lỗi nào báo. QA có ca đối chiếu chuỗi có dấu trong PDF sinh ra.
- **Recharts + pdfmake + decimal.js là dep MỚI** ⇒ `pnpm audit` phải sạch, license MIT cả ba. **Cổng SCA của repo phải thấy chúng** — `sca-gate-blind-to-lms-and-fbpost` là bài học về dep nằm ngoài tầm quét.
- ⚠️ **Không ADR nào đang nói về ba thư viện này** — đo 11/09/2026: `grep -i "recharts|pdfmake|decimal"` trên `docs/DECISIONS/` = **0 hit**, trong khi wave plan S15 §3 (PAY-DEC-018) viết «đã chốt stack DECISIONS» cho Recharts. Câu đó **dẫn nguồn sai**. Xử lý ở §23.2: **mở `DECISIONS-14`** ghi ba lựa chọn này, và **sửa câu dẫn sai** trong wave plan — chứ không để một quyết định stack sống duy nhất trong một hồ sơ wave.

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
| Validate | Zod mirror CHECK DB **hai chiều đúng bằng** (🔁 **v2: 8** trạng thái kỳ *(v1: 7)* · 3 trạng thái thưởng/phạt · **7** `item_type` — gồm `adjustment` · `period_month`); trần Zod ≠ trần service không đẻ mã chết |
| Thu hồi di sản | 16 cặp GỠ có 0 hàng ở **cả ba** bảng `permissions`/`role_permissions`/**`object_permissions`**; `hr-manager` không còn hàng `object_permissions` nào trên `view-payslip`; `view-payslip`/`view-own-payslip`/`acknowledge-own-payslip` còn đúng grant §9g; **`permission-admin.int-spec.ts` vẫn xanh**; **nhân viên mở phiếu CỦA MÌNH ra 200, không 403** (chốt `objectGrantRequired=false` — §18) |
| Test di sản phải sửa | **6 file** ở DB-13 §10.1 (`bonus-penalty-transition` · `payslip-acknowledgement-transition` · `payslip-appendonly` · `rls-registry` fixture · **`pgbouncer-tenant-isolation`** · `demo-seed-full.mjs`) phải **được sửa, KHÔNG được xoá** — `payslip-appendonly.int-spec.ts` là ca ghim bất biến #2 |

---

### 21.1 **v2** — test scenario bắt buộc (nguồn cho `S15-PAYROLL-QA-1`)

**A. Đối soát SỐ — không có ca nào thay được**

1. **Fixture đối soát tay, khớp TỪNG ĐỒNG**: ≥ 1 nhân sự **GROSS** đủ mọi khoản (lương cơ bản · phụ cấp định mức · thưởng · phạt · nghỉ không lương · BHXH/BHYT/BHTN · KPCĐ · đoàn phí · TNCN với 2 NPT · điều chỉnh tay) và ≥ 1 nhân sự **NET** đủ mọi khoản. Bảng tính tay đính kèm WO; lệch 1 đồng là ĐỎ.
2. **Bốn nút tổng hợp — ca ghim RIÊNG cho từng vế đã sửa ở §13.6 E** *(fixture của ca 1 dựng theo bảng đó, nên bốn vế này phải có ca ĐỘC LẬP, không dựa vào «tổng khớp»)*:
   - (a) **phần DN không vào lương NV**: `TONG_KHAU_TRU` **không** chứa `statutory_employer`; `net` **không đổi** khi tỉ lệ DN đổi (§13.7 C);
   - (b) 🔴 **`tax_exempt` ĐƯỢC TRẢ**: fixture có một khoản miễn thuế; assert nó **có mặt trong `TONG_THU_NHAP`** ⇒ vào `net`, **và** bị trừ khỏi `thu_nhap_tinh_thue`. Ca âm: bỏ nó khỏi `TONG_THU_NHAP` ⇒ `net` tụt đúng bằng khoản đó mà `net ≥ 0` vẫn xanh;
   - (c) 🔴 **đoàn phí KHÔNG giảm thuế**: fixture có đoàn viên; assert `DOAN_PHI` **có** trong `TONG_KHAU_TRU` nhưng **KHÔNG** trong `TONG_BH_NV`; bật/tắt `joins_union` ⇒ `thu_nhap_tinh_thue` **không đổi**, chỉ `net` đổi;
   - (d) 🔴 **`pit_payer = 'COMPANY'`**: cùng fixture, đổi mỗi `pit_payer` ⇒ `TONG_KHAU_TRU` **giảm đúng bằng** khoản thuế, `net` **tăng đúng bằng** khoản thuế, và thuế **vẫn** có mặt trong `component_values_json`.
3. **Số lẻ thật**: fixture cố ý dùng lương/tỉ lệ cho ra số lẻ (`1.005`, `0.385`, `19.999.999,99`) — fixture toàn số tròn làm ca «cấm `Number`» xanh-rỗng (§13.6 F).
4. **Tỉ lệ luật định versioned**: hai bản `effective_from` khác nhau ⇒ kỳ 09 dùng bản ≤ 30/09; ca ÂM: xoá bản hiệu lực ⇒ **422 022**, kỳ **không** đổi trạng thái.

**B. Máy công thức — bề mặt tấn công**

5. **Fuzz parser**: chuỗi ngẫu nhiên · ngoặc lồng 10.000 cấp · số 500 chữ số · unicode · **byte NUL thật** · chuỗi giống JS (`constructor`, `__proto__`, `process.exit()`). Yêu cầu: **luôn 4xx có mã, không 500, không treo, không tràn stack**.
6. **Vòng**: trực tiếp (`A → A`) · gián tiếp (`A → B → C → A`) · **qua nút tổng hợp** (`earning` tham chiếu `TONG_THU_NHAP`) ⇒ **422 019** với chu trình đầy đủ.
7. **Vòng sinh ra do GHI SONG SONG**: hai lượt sửa hai thành phần, mỗi bản riêng không vòng, hợp lại thì có ⇒ lượt `calculate` phải bắt (§13.6 E — kiểm ở **cả hai** thời điểm).
8. **Shadowing — BA nhánh, thiếu nhánh nào là lỗ đó mở**: (a) đặt `code = 'SYS_GROSS'`/`TL_X`/`GT_X` ⇒ **409 024** `component-code-reserved` (`code_shape_check`); (b) đặt `code` trùng mã seed đang sống ⇒ **409 024** `component-code-exists` (`company_code_uq`); (c) 🔴 **nhánh XOÁ MỀM**: `UPDATE salary_components SET deleted_at = now() WHERE code = 'TONG_KHAU_TRU'` **ghi thẳng qua repository** ⇒ phải bị `salary_components_system_not_deletable` chặn ở **DB** (`23514`), rồi thử tạo lại `TONG_KHAU_TRU` với công thức tuỳ ý ⇒ **409 024**. Thiếu (c) thì bốn nút `aggregate` **che được bằng đúng hai câu SQL** — `code_shape_check` không đỡ (chúng không mang tiền tố nào) và `company_code_uq` là partial `WHERE deleted_at IS NULL`.
9. **Hai trần ngân sách node, ca RIÊNG cho từng trần** (§13.6 C): (a) hồ sơ **GROSS**, mẫu 120 thành phần × 200 node ⇒ vượt **25.000/lượt** ⇒ **422 020**; (b) hồ sơ **NET**, mỗi lượt trong hạn nhưng 31 lượt ⇒ vượt **775.000/dòng** ⇒ **422 020**, `details[]` nêu **vòng thứ mấy**. Cả hai **tái lập 100%** (không đo đồng hồ). 🔴 **Ca đối chứng bắt buộc — trần KHÔNG được bất khả thi**: một hồ sơ `NET` với mẫu **thực tế** (~20 thành phần) hội tụ trong ≤ 30 vòng phải **XANH**, không 422. Thiếu ca này thì một trần quá chặt biến PAY-DEC-015 thành tính năng tắt mà mọi ca âm vẫn xanh.
10. **Gross-up dao động**: công thức `IF` cố ý làm `net(g)` không đơn điệu ⇒ **422 021** sau 30 vòng, **0 dòng được ghi** (kiểm `count(payroll_period_lines) = 0` sau lỗi).
11. **Sửa công thức sau khi tính KHÔNG đổi số**: tính kỳ → sửa công thức → **đọc lại** dòng ⇒ `component_values_json` y nguyên; **tính lại** ⇒ số đổi **và** `template_fingerprint` đổi.

**C. FSM 8 trạng thái + di trú**

12. **Ma trận đầy đủ 8×8**: mọi ô ✗ ⇒ **409 001**; đặc biệt `Published → CollectingData` (reopen) ⇒ 409, `Approved → Paid` (đi tắt) ⇒ 409, `Published → Locked` (bỏ qua `Paid`) ⇒ 409.
13. 🔴 **Ca CHỐNG HỒI QUY lớn nhất của wave — phiếu lương ở `Published`**: kỳ ở **đúng `Published`** ⇒ nhân viên `GET /me/payslips` **thấy** phiếu · `GET /me/payslips/:id` 200 · `POST …/acknowledge` 200 · `GET /me/payslips/:id/pdf` 200. Ca hiện có của v1 chạy trên kỳ `Paid` nên **vẫn xanh** khi cả bốn đường cùng sai (§13.2).
14. **Di trú `Paid` → `Published`**: DB có hàng v1 `status='Paid'`, `paid_by IS NULL` ⇒ sau migrate, hàng đó ở `Published` và **không** vi phạm CHECK nào; ca ÂM: chạy migrate với thứ tự đảo (siết CHECK trước backfill) ⇒ phải **đỏ**, không âm thầm qua.
15. 🔴 **Luật PHỦ — kỳ NHIỀU ĐỢT không được vào ngõ cụt** (§13.1). Dựng kỳ `Published` có **10 phiếu**, chia **hai đợt** 6 + 4:
    - hoàn tất đợt #1 ⇒ **200**, đợt `Completed`, kỳ **vẫn `Published`**, body `unpaidPayees = 4` — **KHÔNG** 409, **KHÔNG** `Paid`, **KHÔNG** outbox 027;
    - hoàn tất đợt #2 ⇒ **200**, kỳ `Paid` + `paid_by/at` NOT NULL + **đúng 1** hàng outbox 027;
    - ⚠️ **ca ÂM chống hồi quy**: assert đợt #2 **KHÔNG** trả 409. Bản nháp cho kỳ sang `Paid` ngay ở đợt #1, khiến đợt #2 ăn `assertPeriodTransition('Paid','Paid')` ⇒ 409 001 **vĩnh viễn**, và 4 người kia **không bao giờ được ghi là đã chi** — ca cũ ghim chính lỗ đó thành hành vi đúng;
    - hoàn tất đợt **RỖNG** (0 dòng còn hiệu lực) ⇒ **409 028** `batch-empty`, đợt **không** thành `Completed` *(đường phát duy nhất của 028 — thiếu ca này 028 là mã chết)*;
    - còn dòng chưa chi ⇒ **409 027**; hoàn tất hai lần ⇒ **409 027**;
    - gọi thẳng bất kỳ route kỳ nào để set `Paid` ⇒ route không tồn tại;
    - **race** hai đợt cuối hoàn tất song song ⇒ **cả hai 200**, đúng **một** bên đẩy kỳ sang `Paid`, đúng **một** hàng outbox 027 (không 500, không deadlock — kiểm thứ tự row-lock kỳ TRƯỚC · đợt SAU, §13.1).
16. **`PAYSLIP_PUBLISHED` phát ở `publish`, KHÔNG ở `complete-batch`**: đếm hàng outbox sau từng bước.

**D. Quyền · IDOR · masking**

17. **Ma trận allow/deny per-pair TỪNG route mới (50 route × các role)** ở **CẢ HAI tầng** (decorator + service) — census so **theo MÃ cặp**, không theo tên hàm (`two-layer-pair-census-must-be-per-route`). Bao gồm `hr` · `hr-manager` · `manager` ⇒ **403 trên toàn bộ 50 route** (0 cặp PAYROLL).
18. **Mọi ca DENY phải có ca ALLOW song sinh** — thiếu thì deny-spec xanh-RỖNG (`deny-cases-vacuous-without-allow-case`), và ca ALLOW assert **`=== 200`**, không `.not.toBe(403)` (`allow-counter-case-not-403-lets-500-through`).
19. **IDOR cross-employee**: nhân viên B đọc tạm ứng của A qua `/me/payroll-advances` ⇒ **không có trong danh sách**; đọc thẳng `061` ⇒ 403 (thiếu cặp); PDF phiếu của A qua `084` ⇒ **404 010**. **Cross-tenant** trên cả 11 bảng mới.
20. **Mask số tài khoản**: `038` · `070` trả `bankAccountLast4`, **không** khoá `bankAccountNumber` — assert **vắng khoá**, không assert `null`. Chỉ `071` (tệp UNC) chứa số đầy đủ **và** đẻ đúng 1 hàng audit. 🔴 **Ba ca DENY của `071` — thiếu MỘT cặp là 403**: role có `manage:payment-batch` nhưng thiếu `export:payroll` ⇒ **403**; thiếu `view-payslip:payslip` ⇒ **403**; có cả ba ⇒ **200 và tệp có số TK đầy đủ** (ca ALLOW song sinh, assert `=== 200`). Ca đầu là ca chống hồi quy quan trọng nhất của nhóm này: bản nháp gác `071` bằng **đúng một cặp GHI**, cho một role chỉ giữ `manage:payment-batch` tải được **payload nhạy cảm nhất toàn hệ thống**.
21. **`taxCode` vắng khoá** ở `037` khi caller chỉ có `('view','payroll-employee')`; **có mặt** khi thêm `('view','salary-profile')` — hai ca đối xứng.
22. **Sàn scope Company** của `078`/`079`/`081`/`073` và widget 002/003 ép ở **HAI tầng** (metadata + data): grant scope `Department` ⇒ **không serve**, kể cả đường metadata.
23. **Allowlist capability**: sau seed, `/auth/me` của `payroll-officer` và `company-admin` trả **đủ 30 cặp sensitive**; gỡ một cặp khỏi **một** trong hai danh sách ⇒ ca đỏ (ghim cả hai, không chỉ một).
24. **Đối chứng «duyệt mù»**: gỡ `('view','payroll-advance')` khỏi role giữ `('approve','payroll-advance')` lúc runtime ⇒ ca ghi nhận rủi ro còn lại (verify migration chỉ đúng lúc migrate — §11.3 ghi chú 7).
25. 🔴 **Rò tiền qua route GHI (v2)** — luật §11.3 ghi chú 8, **nhóm ca riêng, không gộp vào ma trận 17**. Với role chỉ giữ **`manage:X` mà KHÔNG giữ `view:X`** (dựng bằng cách gỡ cặp `view` lúc runtime):
    - gọi **cả bảy** route GHI `039 · 060 · 062 · 067 · 069 · 074 · 075` ⇒ response **200** nhưng body **KHÔNG chứa khoá tiền nào** — assert theo **danh sách khoá cấm** (`amount` · `plannedAmount` · `totalNet` · `gross` · `net` · `bankAccountNumber` · `bankAccountLast4`), **vắng khoá**, không phải `null`;
    - cùng role gọi route ĐỌC tương ứng (`038 · 059 · 061 · 066 · 068 · 070 · 073`) ⇒ **403** — tức **không đường nào** đọc được tiền;
    - ca ALLOW song sinh: role có **cả hai** cặp ⇒ route ĐỌC trả **200 CÓ** số tiền (thiếu vế này thì cả nhóm xanh-RỖNG — `deny-cases-vacuous-without-allow-case`);
    - `072` trả `{ periodStatus, unpaidPayees }` ⇒ assert `unpaidPayees` là **số người**, và **không** có khoá tiền nào.

    Không có nhóm ca này, sáu cặp `view`/`manage` mới của v2 mất đúng cái luật mà v1 đã dựng cho `calculate`/`adjust-line`, và **không cổng nào chạm tới đường rò** (§14/§21 cấm ca mask per-row).

**E. Dữ liệu · di trú · nghiệp vụ**

26. **NPT chồng lấp** ⇒ **409 032** từ `EXCLUDE` ở DB (không phải chỉ từ service): ghi thẳng qua repository cũng phải bị chặn.
27. **Expand-contract `allowances` → `salary_profile_items`**: sau DB-1, **cả hai** nguồn đọc được và **khớp nhau**; ca ghim cột `allowances` **chưa** bị gỡ. Đường GHI: `POST /salary-profiles` (020) với `items[]` ⇒ ghi **cả hai** nguồn; `PATCH` (022) với `items[]` ⇒ **đặt lại toàn bộ** trong một tx; hai dòng cùng `component_code` ⇒ **409 014** `profile-item-duplicate`.
28. **Import 076**: tệp có 1 dòng sai ⇒ **422 030**, **0 hàng** được ghi (toàn tệp hoặc không gì); dòng import vào `Pending`, **không** tự duyệt.
29. **Tạm ứng khấu trừ đúng một lần**: duyệt → tính kỳ → `consumed_at` set; tính lại cùng kỳ ⇒ nhả rồi gộp lại, **không** nhân đôi; kỳ khác **không** đụng hàng đã consume.
30. **Coverage `apps/api/src/payroll/` ≥ 85%** trên **LANE_DB** (`bash harness/check.sh --all --lane-db=s15payroll`), và **hai census theo MÃ**: (a) cả **33** mã `PAYROLL-ERR-*` có ≥ 1 ca (`coverage-high-but-error-code-untested`) — gồm **028** (`batch-empty`, ca 15) và mọi `kind` mới của 014/024/027; (b) mỗi **TÊN ràng buộc** trong bảng `constraint → SQLSTATE → mã` của §12.1 có ≥ 1 ca **kích hoạt ràng buộc THẬT ở DB**, không mock.

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

### 22.1 Wave S15-PAYROLL-V2 — **OWNER ĐÃ KÝ 02/09/2026** (PAY-DEC-011..020)

> 📌 **Bảng dưới đây là bản CHÉP NGUYÊN VĂN quyết định owner đã ký ngày 02/09/2026 — KHÔNG sửa chữ trong bảng.** Bốn con số trong đó đã lỗi thời sau phép đo ngày 11/09/2026 của `S15-PAYROLL-DOC-1`; bản đúng nằm ở **§5.1b** (bảng «con số cấp phát ĐÓNG») và **§1**:
>
> | PAY-DEC-011 ghi | Đo lại 11/09/2026 | Vì sao |
> | --- | --- | --- |
> | mig **`0569+`** | **`0570+`** | `0569` đã bị `S14-RECRUIT-FILEGRANT-1` lấy (journal `idx 236`) |
> | «10 bảng mới» *(wave plan §5/§8)* | **11** | đếm lại chính danh sách của nó |
> | «~40 route» *(wave plan §5)* | **50** | §15.1 liệt kê từng mã |
> | `PAY-SCREEN-007..016` | **007..017** | «Tạm ứng của tôi» lấy mã riêng theo tiền lệ v1 (§9.1) |
>
> Quyết định **nghiệp vụ** của owner (10 mã) **không đổi** — chỉ các con số cấp phát kỹ thuật được đo lại, đúng như chính PAY-DEC-011 đã dặn «(đo journal lúc chạy)» / «(đo dải)».

> Owner duyệt nguyên gói hồ sơ [`docs/plans/S15-PAYROLL-V2-WAVE-review.html`](<../plans/S15-PAYROLL-V2-WAVE-review.html>) («ok tôi duyệt») ⇒ 10 mã dưới đây chốt **đúng cột «Đề xuất»** của [wave plan S15 §3](<../plans/S15-PAYROLL-V2-WAVE.md>). Bảng này là bản chép kết luận; nội dung chi tiết (bảng mới · màn hình · route · mã lỗi · §13.4 v2) do WO `S15-PAYROLL-DOC-1` viết vào các mục tương ứng của tài liệu này. Benchmark: 8 màn MISA AMIS Tiền lương (02/09/2026) — bản đồ 17 khoảng cách ở wave plan §2.

| Mã | Câu hỏi | Kết quả owner chốt | Trạng thái |
| --- | --- | --- | --- |
| PAY-DEC-011 | Đánh số & phạm vi tài liệu v2 | **SPEC-11 lên v2 trong cùng file** (§5.1 thêm bảng «v2», §22.1 này) · DB-13 v2 · API-18 v2 · §9g mở rộng · mig `0569+` (đo journal lúc chạy) · `PAY-SCREEN-007+` · `PAYROLL-API-036+` · `PAYROLL-ERR-018+` · `NOTI-EVENT-024+` (đo dải) · `IMP02-STORY-191+` · Sprint 15 — không tách SPEC mới | ✅ chốt |
| PAY-DEC-012 | Máy công thức đặt ở đâu (đảo **một phần** PAY-DEC-004 «tính ở SQL») | **Engine biểu thức ở TS, số học `decimal.js`** (cấm float), đánh giá theo đồ thị phụ thuộc thành phần (topo-sort, cấm vòng), kết quả ghi `numeric(18,2)` + **snapshot `component_values_json` per dòng**; **SQL giữ bất biến** (`SUM(items) = gross − deduction + adjustment`, CHECK ≥ 0, UNIQUE). Grammar cố định: `+ − × ÷ ( )`, so sánh, `IF/MIN/MAX/ROUND/ABS`, tham chiếu `MÃ_THÀNH_PHẦN`, hàm luật định đặt tên — KHÔNG `eval`, KHÔNG hàm tuỳ ý, giới hạn độ dài/độ sâu/số node/timeout | ✅ chốt |
| PAY-DEC-013 | Mô hình catalog + mẫu bảng lương | `salary_components` = **hệ thống (seed, không xoá, sửa được công thức) + tự thêm**; `payroll_templates` + `payroll_template_components` (nhãn cột · công thức ghi đè · ẩn/hiện · thứ tự); **kỳ gắn ĐÚNG MỘT mẫu lúc tạo**, đổi mẫu chỉ khi kỳ ≤ `CollectingData`; phạm vi mẫu v2 = **toàn công ty hoặc theo `org_unit`** (theo vị trí/nhân viên = Phase sau) | ✅ chốt |
| PAY-DEC-014 | Engine luật định BH + TNCN (lấy lại từ PARK-PAYROLL-001) | Có: BHXH · BHYT · BHTN · KPCĐ (DN) · đoàn phí (NV) · **TNCN luỹ tiến 7 bậc** + giảm trừ bản thân/người phụ thuộc. **Tỉ lệ + trần + bậc thuế lưu ở `payroll_statutory_rates` versioned theo `effective_from`** (kỳ dùng bản hiệu lực tại ngày cuối kỳ). Seed do **owner xác nhận số**: NV 8 / 1,5 / 1 · DN 17,5 / 3 / 1 · KPCĐ 2 · đoàn phí 1 · giảm trừ 11 tr + 4,4 tr/NPT · trần BHXH/BHYT = 20× lương cơ sở · BHTN = 20× lương tối thiểu vùng. Hệ thống **lưu và áp**, không tự khẳng định đúng luật; KHÔNG hard-code tỉ lệ trong code | ✅ chốt |
| PAY-DEC-015 | NET / GROSS (v1 đã GỠ `salary_type`) | **Dựng lại `salary_type ∈ {GROSS, NET}`** trên `salary_profiles` bằng cột MỚI (band 0564 bất khả xâm phạm), default `GROSS`; **NET = gross-up lặp** ≤ 30 vòng, hội tụ ≤ 1 đ, số vòng ghi vào snapshot; không hội tụ ⇒ 422, kỳ không đổi trạng thái | ✅ chốt |
| PAY-DEC-016 | Màn «Nhân viên» trong PAYROLL vs Phương án B | Màn Nhân viên đọc **chiếu HR bó hẹp qua route PAYROLL** (`PAYROLL-API-036`, mở rộng picker 034), **không cấp cặp HR** cho `payroll-officer`; **`tax_code` chiếu qua `('view','salary-profile')`** (TNCN cần) + audit lượt xem; **người phụ thuộc + thiết lập BH/công đoàn + tài khoản ngân hàng là bảng PAYROLL** (`payroll_dependents` · `payroll_employee_settings`), không đẩy vào HR | ✅ chốt |
| PAY-DEC-017 | Tạm ứng · Chi trả · FSM kỳ | `payroll_advances` (`Pending → Approved/Rejected → Deducted`, four-eyes, **tự thành khoản khấu trừ** ở kỳ chỉ định); `payroll_payment_batches` + lines (kỳ · bank/cash · trạng thái · tệp UNC XLSX); **FSM kỳ 8 trạng thái**: `Draft → CollectingData → Calculated → Reviewing → Approved → Published → Paid → Locked` — `Published` = đã phát hành phiếu (nghĩa cũ của `Paid`), `Paid` chỉ khi đợt chi trả hoàn tất (SPEC-01 §17.15 sửa ở DOC-1); tài khoản ngân hàng = cột `payroll_employee_settings` (mask, sensitive). **Phân bổ lương (cost center) NGOÀI** | ✅ chốt |
| PAY-DEC-018 | Báo cáo + Tổng quan | `/payroll` = **Tổng quan module** (phân bố mức lương · cơ cấu thu nhập · ngân sách gauge · chi phí theo thời gian · thu nhập BQ theo thời gian · thu nhập BQ theo đơn vị + **Lời nhắc**: phiếu chưa phát hành · NV chính thức chưa tham gia BH · lương BH ngoài quy định). **7 báo cáo**: tổng hợp thu nhập NV · thống kê lương theo thời gian · cơ cấu thu nhập · chi phí lương theo đơn vị · lịch sử lương NV · tổng hợp chi trả · tình hình ngân sách («Công nợ» gộp vào tạm ứng; lịch gửi định kỳ = Phase sau). **Cài Recharts**. Mọi báo cáo gác cặp ĐỌC tiền + sàn scope Company + audit mỗi lượt, **không cache** | ✅ chốt |
| PAY-DEC-019 | PDF phiếu lương (lấy lại từ PARK-PAYROLL-001) | **Có** — sinh server (`pdfmake`, font Việt nhúng), tải qua signed-URL file-service; `('export','payroll')` cho batch, Own cho phiếu của mình; audit; nội dung = snapshot `payslip_items`, không tính lại | ✅ chốt |
| PAY-DEC-020 | Nâng vỏ UI dùng chung — làm TRƯỚC | WO `S15-UI-SHELL-1` ở `packages/ui` + layout `apps/app`: sidebar **nhóm gập được** · **toolbar chuẩn** (tìm · trạng thái · đơn vị · lọc · ⚙ chọn cột) · `DataTable` **ghim cột + chọn cột + footer «Tổng số · Số dòng/trang · 1–N»** · **header trang chi tiết** (← · tiêu đề · nút chính · ⋯) · pill trạng thái; UI-07 cập nhật để mọi module dùng chung; theme light/dark giữ | ✅ chốt |

> **NGOÀI phạm vi v2 → PARK-PAYROLL-002** (ghi để không ai tự thêm): Doanh số · KPI · Sản phẩm (de-media-fy — CLAUDE.md §1) · Phân bổ lương (cost center) · lịch gửi báo cáo định kỳ · Trợ lý AI · thư viện mẫu cloud · đa pháp nhân · mẫu bảng lương theo từng nhân viên · duyệt nhiều cấp · multi-currency.
>
> **Tiên quyết vận hành (không phải phụ thuộc kỹ thuật):** PAYROLL v1 chưa chạy ngày nào trên PROD (lô mig 0564–0568 bị census 0565 chặn) — chạy `S14-PROD-PAYROLLGRANT-1` trước để kế toán dùng thật v1 một kỳ.
>
> Điều kiện mở WO code của track v2: 10 quyết định chốt (✅) · `plan-reviewer` đối kháng **PASS** trên SPEC-11 v2 + DB-13 v2 (cuối `S15-PAYROLL-DOC-1`, trước khi mở `S15-PAYROLL-DB-1`). Phân rã 15 WO: wave plan §5.

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

### 23.2 **v2** — tác động tài liệu của wave S15 (WO `S15-PAYROLL-DOC-1`)

| # | Tài liệu | Việc | Đã đo |
| --- | --- | --- | --- |
| 1 | **SPEC-11** (file này) | §1 · §3.3/§3.5 chú v2 · §3.9–§3.12 · §5.1b · §5.2b · §8.2 · §9.1 · §10.1b · §10.2 · §11.3 · §12.1 · **§13.1 (FSM 8 — THAY)** · **§13.2 (THAY)** · §13.6–§13.8 · §15.1 · **§17.1 (+ 023 đổi điều kiện phát — THAY)** · §18.1 · §19.1 · §21.1 · §23.2 · §24.1 | — |
| 2 | **SPEC-01** | **§17.15 → 8 trạng thái** (khuôn `\`\`\`text` + một blockquote, dòng 1496–1508) · **§17.16** sửa điều kiện `Published` (dòng 1510–1518) · **§12.8** sửa câu «FSM 7 trạng thái» + phạm vi v2 + bỏ «PDF = Phase sau» (dòng 803–833, câu phạm vi ở 825) · **§20.2** cấp NOTI-EVENT-024..027 (bảng dòng 1689–1719) · **§10.6** ghi `payroll-officer` **không** giữ `manage:statutory-rate`/`manage:payroll-budget` (dòng 450–465) · bảng liên-module dòng 2107 thêm WIDGET-002/003 | dòng đo 11/09/2026 |
| 3 | **SPEC-08** | **§15.0** thêm 4 hàng 024–027 (bảng dòng 1229–1253, blockquote dải ở 1255 đổi «028+») · **§15.10** thêm 4 event + ghi chú «CHECK hai bảng đã nới ở `0566`, v2 NO-OP» (dòng 1399–1411) | dòng đo 11/09/2026 |
| 4 | **DB-13** | **§12–§14 mới**: **ALTER 3 bảng — 2 ở DB-1 (§12.1 + §12.4) · 1 ở DB-2 (§12.3)** · 11 bảng đích · enum v2 · index · RLS/GRANT · kế hoạch migration `0570+` (DB-1) và lô DB-2 · seed catalog + tỉ lệ + mẫu mặc định · **§7 enum mirror contracts HAI CHIỀU** (`payrollPeriodStatusEnum` **7 → 8**) | — |
| 5 | **API-18** | **§4.1b** nhóm API v2 · **§5b** danh sách 50 endpoint · **§5.1b** ràng buộc hiện thực v2 · **§4.2** viết lại theo PARK-PAYROLL-002 · **§5.2** đánh dấu 036–085 «chưa hiện thực» | — |
| 6 | **permission-matrix** | **§9g MỞ RỘNG tại chỗ** (PAY-DEC-011 — **KHÔNG** tạo §9h; §9g là tiểu mục cuối, dòng 585–623, §9g.1 ở 625–657): thêm **§9g.2** bảng 17 cặp v2 + ma trận seed **+31 hàng ⇒ 63** + hai điều kiện verify mới | dòng đo 11/09/2026 |
| 7 | **IMPLEMENTATION-02** | **§8.21 EPIC-20** thêm **IMP02-STORY-191..204** (PL-11..24) theo khuôn 6 cột (dòng 815–826) · **§9** thêm hàng **Sprint 15** (bảng dòng 849–861, Sprint 13 là hàng cuối — **không có Sprint 14**) + nối câu vào blockquote dòng 847 · **sửa dòng tổng 188** («190 story / 1339 point») | dòng đo 11/09/2026 |
| 8 | **UI-07** | v1.1: §6.2 cây component thêm `SidebarNavGroup` **gập được** + `ColumnPicker` + `DetailPageHeader` · §9.2/§9.5 nhóm gập per-group · §9.4 union `moduleCode` **thêm `PAYROLL`** · §10.4 toolbar thêm «⚙ chọn cột» + «đơn vị» · §12.3/§12.4 DataTable **ghim cột · chọn cột · footer «Tổng số · Số dòng/trang · 1–N»** · §13 tách `DetailPageHeader` · §26.1 đổi đường dẫn sang **`packages/ui`** · §21 thêm **§21.8 workspace PAYROLL** · changelog dòng 28–32 (bảng chỉ có tiêu đề + đúng 1 hàng v1.0) | dòng đo 11/09/2026 |
| 9 | **docs/README.md** | ⚠️ **bảng ghép cặp nằm ở §9, KHÔNG phải §8** (WO seed ghi nhầm «README §8»; §8 là mục QA). Cập nhật **hàng PAYROLL dòng 229** (7 cột) + dòng 42/68/94 (chỉ mục SPEC-11/DB-13/API-18) | dòng đo 11/09/2026 |
| 10 | **erd-current.md** | §9 danh sách append-only + câu «7 bảng PAYROLL» ở dòng 391 ⇒ **18 bảng**; dòng 432 thêm cụm PAYROLL v2 vào danh sách composite tenant FK; §A4 cập nhật trạng thái cụm payroll | dòng đo 11/09/2026 |
| 11 | **RELEASE-14** | **§5 hàng PAYROLL (dòng 100)**: PARK-PAYROLL-001 **thu hẹp** (v2 lấy lại BH/TNCN · PDF · report) + ghi **PARK-PAYROLL-002** (§5.2b) | dòng đo 11/09/2026 |
| 12 | **DECISIONS-14 (MỚI)** | ADR ba thư viện: **`decimal.js`** (số học tiền ở TS) · **Recharts** (biểu đồ) · **`pdfmake`** (PDF font Việt nhúng) — **hiện 0 ADR nào nhắc tới chúng**, trong khi wave plan S15 §3 viết «đã chốt stack DECISIONS» cho Recharts ⇒ **câu đó dẫn nguồn sai, sửa luôn trong wave plan** | grep 11/09/2026 = 0 hit |
| 13 | **harness** | `lib/stories.mjs`: `sprintOfStory` thêm `if (inR(191, 204)) return "S15";` **TRƯỚC** `return "?"` (hiện 191+ rơi vào `"?"`). ⚠️ **Cảnh báo đo được**: sprint của EPIC lấy `stories[0]` ⇒ EPIC-20 vẫn hiện **S13** dù chứa cả 191–204 — chấp nhận, ghi chú tại chỗ. `dashboard/server.mjs` `MODULE_SPEC`: **KHÔNG cần sửa** — đã ĐO 11/09/2026, `specFor` khớp trên `` `${id} ${title} ${paths.join(' ')}` `` nên mọi WO `S15-PAYROLL-*` khớp qua id, và **`S15-UI-SHELL-1` cũng khớp** vì `paths` của nó đã chứa `apps/app/src/routes/payroll/**` *(cảnh báo ngược lại trong bản nháp là do chỉ đo id+title, bỏ sót vế `paths` — đã bác bằng phép chạy thật)* | dòng đo 11/09/2026 |
| 14 | **backlog.mjs** | đóng `S15-PAYROLL-DOC-1`; cập nhật `src`/`done_when` của 14 WO còn lại theo số ĐÚNG BẰNG của §5.1b (11 bảng · 50 route · 16 mã lỗi · 17 cặp · 4 event · mig **`0570+`**) | — |

**Nợ để lại cho WO sau của wave S15** *(ghi ở đây để không trôi)*:

- (a) `S15-PAYROLL-DB-1` — **ĐÚNG 2 ALTER (§12.1 `salary_profiles` + §12.4 `payroll_period_lines`)** + 7 bảng (track A/B); **RLS+FORCE TRƯỚC backfill**; `cleanupTenants()` thêm 7 bảng **đúng thứ tự con→cha**; `RetentionService.PROTECTED_TABLES` thêm 7 bảng; **đăng ký `rls-registry` + fixture 7 bảng CÙNG COMMIT**; seed catalog thành phần + **mẫu mặc định tái tạo công thức v1** + bản tỉ lệ luật định (số PAY-DEC-014, ghi rõ «owner xác nhận 02/09»); UNION-ADD **10** giá trị `audit_logs.object_type` (§12.1 ghi chú 4). ⛔ **KHÔNG chạm `payroll_periods`** — không `template_id`, không `paid_by/at`, không nới `status_check`, **không** backfill `Paid → Published`, **không** mirror `payrollPeriodStatusEnum` 7 → 8.
- (b) `S15-PAYROLL-DB-2` — **ALTER thứ ba: §12.3 `payroll_periods` ĐỦ 4 BƯỚC theo đúng thứ tự** (`template_id` · `paid_by/at` → nới `status_check` 8 giá trị → **UPDATE `Paid` → `Published`** → rồi mới siết `published_pair_check` + thêm `paid_pair_check`) — bốn bước là **MỘT chuỗi nguyên tử, một migration, một WO**: tách bước (2) khỏi bước (3) là `UPDATE` vi phạm CHECK 7-giá-trị ⇒ **`23514` giữa lane migration**. Cùng WO: 4 bảng (track C) + contracts `payroll.ts` mirror **hai chiều** (`payrollPeriodStatusEnum` 7 → **8**) **cùng commit với bước (2)** + composite FK `payroll_periods.template_id → payroll_templates` (phải **sau** bước A của DB-1) + NOTI-EVENT-024..027 ở **cả hai** bảng catalog + đăng ký `rls-registry` cho 4 bảng.
- (c) `S15-PAYROLL-BE-1..5` — **APPEND 17 cặp vào CẢ HAI danh sách** `SENSITIVE_CAPABILITY_ALLOWLIST` + `SENSITIVE_SCREEN_GATE_PAIRS`; siết `MIN_COVERED_COUNT` route-http **mỗi WO**; map `23P01`/`23505` mới → 409 đúng mã.
- (d) `S15-PAYROLL-FE-1..4` — `.optional()` mọi trường tiền **và** `bankAccountLast4`/`taxCode` (server mask = vắng khoá); `useCanExact` cho widget cặp sensitive; sidebar nhóm gập ẩn khi 0 con hiển thị.
- (e) **Nợ NGOÀI wave (không tự làm)**: gỡ cột `allowances` của `salary_profiles` (vế **contract** của expand-contract) — WO riêng sau khi DB-1 chạy thật và đo 0 đường đọc còn lại.

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

### 24.1 **v2** — Definition of Done cho `S15-PAYROLL-DOC-1`

- [x] Owner ký PAY-DEC-011..020 (02/09/2026) → §22.1
- [x] **Đo trước khi cấp phát** (11/09/2026), không suy đoán: `NOTI-EVENT` dừng ở 023 ⇒ v2 lấy **024–027** · journal `idx 236 / 0569` ⇒ migration **`0570+`** (PAY-DEC-011 ghi «0569» đã **lỗi thời**, đính chính ở §1) · `IMP02-STORY` max **190** ⇒ v2 lấy **191–204** · `PAY-SCREEN` max **006**, `PAYROLL-API` max **035**, `PAYROLL-ERR` max **017**, `PAYROLL-WIDGET` max **001**
- [x] **Số cấp phát ĐÓNG và tự-nhất-quán** giữa §5.1b ↔ §8.2 ↔ §9.1 ↔ §11.3 ↔ §12.1 ↔ §15.1 ↔ §17.1: **11 bảng · 11 màn · 50 route · 16 mã lỗi · 17 cặp · 4 event · 2 widget · 8 trạng thái · 11 route Idempotency**
- [x] **Bốn số của hồ sơ wave được ĐÍNH CHÍNH tại chỗ** (§5.1b): «10 bảng» → **11** · «~40 route» → **50** · «PAY-SCREEN-007..016» → **007..017 (11 màn)** · cặp `export:payslip-pdf` → **không cấp** (PAY-DEC-019 đã ký đường khác)
- [x] Sáu chỗ v2 **THAY** v1 lập **bảng** ở §1 (§13.1 · §13.2 · §17 · §3.5 · §15 hàng 014 · §15 hàng 031/032/033), **và dấu 🔁 TẠI CHỖ đã đủ**: plan-reviewer vòng 1 (B2) đo ra **8 chuỗi** còn ghi «7 trạng thái / 7 giá trị / `Approved → Paid`» chưa đánh dấu — **đã vá cả 8** (11/09): SPEC-11 §8 bảng cấu trúc (`status` 8 giá trị) · §9.1 PAY-SCREEN-001 (chip 8 giá trị) · §10 PAYROLL-FUNC-010 (`Approved → Published`) · §12 PAYROLL-ERR-004 (`period-terminal` gồm `Published`) · §17 bảng event (`PAYSLIP_PUBLISHED` phát ở `Approved → Published`) · §21 hàng Validate (8 trạng thái kỳ) · DB-13 §2 + §6.3 tiêu đề/cột `status` + khối CHECK (ba dòng chỉ về §12.3). Chuỗi «7 trạng thái» còn lại **chỉ** ở §1 bảng đối chiếu · §22 PAY-DEC-005 · §5.1 — cả ba đều gắn nhãn «v1» có chủ đích
- [x] **Tự-kiểm chéo §12.1 ↔ §15.1**: mọi mã lỗi §15.1 viện dẫn đều tồn tại ở §12.1 với **đúng HTTP và đúng `kind`** — vòng kiểm này phát hiện route 056/058 đang gán «409, kind của 022» trong khi 022 là **422** ⇒ đã cấp **PAYROLL-ERR-033** (409) cho xung đột bản tỉ lệ, thay vì bẻ cong một mã sẵn có
- [x] Ranh giới TS↔SQL của PAY-DEC-012 chốt **thành bảng** (§3.9), kèm câu chặn cách đọc sai «clamp ở JS được rồi»
- [x] Grammar máy công thức là **danh sách ĐÓNG** có EBNF + giới hạn tĩnh + **ngân sách node tất định** (không timeout đồng hồ làm cổng)
- [x] Hai bẫy di trú im lặng nhất được viết thành **ca test bắt buộc**: `Paid → Published` backfill (§13.1) và bộ lọc `/me/payslips` (§13.2, ca 13 của §21.1)
- [x] ✅ **`plan-reviewer` đối kháng — VÒNG 1 = BLOCK, 14 BLOCKER (11/09/2026) → ĐÃ VÁ ĐỦ 14/14 cùng ngày ⇒ PASS theo ĐIỀU KIỆN TỰ-MỞ-CỔNG reviewer đã khai, KHÔNG mở vòng 2.** Báo cáo + checklist kiểm-được-bằng-grep + trạng thái từng mục: **[`docs/plans/S15-PAYROLL-DOC-1-review.md`](<../plans/S15-PAYROLL-DOC-1-review.md>)** §2.
  - Bốn cái nặng nhất và cách vá: **B6** ngân sách node — tách **HAI trần** `25.000/lượt` + `775.000/dòng` (§13.6 C · §13.8 · §19.1), hồ sơ NET chạy được, kèm **ca đối chứng** hồ sơ NET thực tế phải XANH · **B7** ba định nghĩa nút tổng hợp sửa **cấu trúc** (§13.6 E ↔ §13.7 C/D/E khớp từng chữ): `TONG_THU_NHAP` gồm `tax_exempt`, `TONG_BH_NV` lọc theo cột mới **`pit_deductible`** (đoàn phí ra), `TONG_KHAU_TRU` cộng `tax` **chỉ khi** `pit_payer='EMPLOYEE'` · **B5** chốt **LUẬT PHỦ** (§13.1): kỳ nhiều đợt, `Paid` chỉ khi phủ đủ; `ERR-028` đổi nghĩa sang `batch-empty` — **có đường phát thật**; ca §21.1 số 15 viết lại kèm **ca ÂM** đợt #2 không được 409 · **B9** 4 nút `aggregate` khai **`value_type='engine'`** (giá trị thứ tư) thay `fixed_amount=0`, cộng CHECK hai chiều `(value_type='engine') = (kind='aggregate')`.
  - Reviewer **đếm lại độc lập 10 danh sách con số ⇒ KHỚP**; 3 chỗ lệch đã sửa: B1 (ownership §12.3 → DB-2, DB-1 còn **2 ALTER**) · H7 · H8.
  - Hai chỗ **mở rộng** kéo theo từ các mục trên: `audit_logs.object_type` **+10 ⇒ 14** (thêm `payroll_employee` · `payroll_report` — §12.1 · §18.1 B có bản đồ route → `object_type`/`object_id` đủ 18 đường), và §21.1 nhóm D thêm ca **25** «Rò tiền qua route GHI (v2)» ⇒ nhóm E đánh số lại **26–30**.
- [x] ✅ **CỔNG `S15-PAYROLL-DB-1` ĐÃ MỞ** (11/09/2026) — 14/14 mục của §2 file review đã vá và kiểm bằng grep. WO kế tiếp theo track: `S15-UI-SHELL-1` (không phụ thuộc DB) và `S15-PAYROLL-DB-1`.
- [ ] DB-13 v2 · API-18 v2 · §9g.2 · SPEC-01 · SPEC-08 · EPIC-20 · UI-07 · README · erd-current · RELEASE-14 · DECISIONS-14 · harness đồng bộ (§23.2)

---

## 25. Kết luận

PAYROLL là mảnh cuối của Phase 2 và là vùng **crown-jewel đặc nhất** của hệ thống. Khác mọi module gần đây, nó **không phải nền trắng**: 6 bảng và 19 cặp quyền của hướng cũ đã nằm sẵn trong DB, trong đó có hai cặp *duyệt* và *phát hành* lương để `is_sensitive=false` — nghĩa là đang ăn theo wildcard. Phần lớn giá trị của wave này nằm ở chỗ **đo đúng hiện trạng rồi thu hồi**, không chỉ ở chỗ viết thêm code.

Bốn lựa chọn cứng giữ v1 gọn mà không mất bất biến: **tách bảng lương nháp khỏi phiếu lương phát hành** (append-only còn nguyên, vẫn tính lại được), **tiền tính ở SQL với snapshot đóng băng** (con số không trôi), **four-eyes là ràng buộc QUYỀN chứ không chỉ là kiểm tra runtime** (officer không có cặp duyệt), và **mọi lượt đọc lương của người khác đều để lại vết** (trừ lượt tự xem của chính chủ). Phần thật sự mới chỉ là 1 bảng, 17 cặp quyền, 35 mã API, 17 mã lỗi, 4 sự kiện và 6 màn hình — mọi thứ còn lại là reconcile nền đã có.

### 25.1 **v2** — kết luận wave S15

v2 đổi PAYROLL từ **một máy tính lương cố định** thành **một máy tính lương lập trình được**, và đổi `Paid` từ **một cái tên sai** thành **một sự kiện có thật**. Hai thay đổi đó kéo theo 11 bảng, 50 route và 17 cặp quyền, nhưng rủi ro của wave **không nằm ở khối lượng** — nó nằm ở ba chỗ nhỏ:

1. **Ranh giới TS ↔ SQL** (§3.9). PAY-DEC-012 chuyển số học lên TS; nếu ai đó đọc thành «clamp cũng lên TS», hệ thống mất chốt cuối của `net ≥ 0` mà mọi ca test hiện có vẫn xanh.
2. **`Published` là trạng thái MỚI nằm GIỮA hai trạng thái cũ** (§13.1–§13.2). Bốn đường đọc của nhân viên và một lượt backfill đều bám vào ranh giới cũ. Sai bất kỳ chỗ nào cho ra **200 với danh sách rỗng** — không lỗi, không log, không ai biết cho tới khi có người hỏi phiếu lương của tôi đâu.
3. **Máy công thức là bề mặt tấn công mới nhất trong vùng crown**. Grammar đóng, không `eval`, ngân sách tất định — cả ba là ràng buộc kiến trúc, không phải khuyến nghị.

Phần còn lại — catalog, mẫu, tạm ứng, chi trả, ngân sách, báo cáo, PDF — là công việc lớn nhưng **đã có khuôn** trong chính hệ thống này (four-eyes của thưởng/phạt · import của HR · signed-URL của file-service · sàn scope của widget DASH). Chỗ đáng dành sự thận trọng là ba mục trên, không phải ở chỗ đếm bảng.
