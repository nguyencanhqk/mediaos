# Kế hoạch wave S15-PAYROLL-V2 — nâng cấp PAYROLL theo chuẩn phần mềm tiền lương thương mại

> **Trạng thái: OWNER ĐÃ DUYỆT 02/09/2026** («ok tôi duyệt» — nguyên gói hồ sơ `S15-PAYROLL-V2-WAVE-review.html`,
> 10/10 quyết định §3 chốt theo cột Đề xuất). Đã chép vào SPEC-11 §22.1 (PAY-DEC-011..020) và seed 15 WO §5
> vào `harness/backlog.mjs` cùng ngày.
>
> Tham chiếu benchmark: 8 ảnh chụp **MISA AMIS Tiền lương** owner cung cấp 02/09/2026 (Tổng quan · Thành phần
> lương · Mẫu bảng lương · Dữ liệu tính lương · Bảng lương · Báo cáo · Nhân viên · Chi tiết nhân viên).
> Benchmark là **mốc so sánh chức năng + bố cục**, KHÔNG sao chép nhận diện thương hiệu.

---

## 1. Điểm xuất phát — ĐO THẬT trên master `a4644898` (02/09/2026)

| Thứ đã có (wave S13, 9/9 WO merged #454–#462) | Số đo |
| --- | --- |
| Bảng | 7 (`salary_profiles` · `payroll_periods` · `payroll_period_lines` · `payslips` · `payslip_items` · `bonus_penalties` · `payslip_acknowledgements`) — RLS+FORCE, payslips append-only |
| Route | **35/35** (`payroll.controllers.ts`: 5 controller) · 17 cặp quyền §9g · 13 sensitive · 17 mã lỗi |
| Máy tính lương | công thức **CỐ ĐỊNH ở SQL**: `gross = base×prorate + phụ cấp + thưởng` · `khấu trừ = phạt + nghỉ không lương` · `net = GREATEST(gross − khấu trừ + adjustment, 0)` — **không BHXH/BHYT/BHTN/TNCN** (PARK-PAYROLL-001) |
| Hồ sơ lương | versioned `effective_date`: `base_salary` + `allowances jsonb [{name, amount}]` + `note` — v1 đã **GỠ** `salary_type`/`pay_cycle`/`currency`/`status` |
| FSM kỳ | 7 trạng thái; `publish` = `Approved → Paid` (**không có bước chi trả thật**), `lock` = `Paid → Locked` |
| FE | 6 màn `apps/app/src/routes/payroll/` (1 942 dòng) — sidebar phẳng 3 mục; `PageHeader` + `DataTable` + dialog shadcn chung; **không có trang tổng quan module** |
| DASH | 1 widget `PAYROLL_COST` (mig 0568) |
| PROD | **chưa chạy ngày nào** — lô mig 0564–0568 bị census 0565 chặn (WO `S14-PROD-PAYROLLGRANT-1` ready) |

**Nền có sẵn tái dùng được (không phải nền trắng):** `employee_profiles.tax_code` (PII, mask) · `companies.payroll_config_json {cutoffDay, payDay}` · `exceljs` (BE) · `packages/ui` có `tabs` · `sheet` · `donut-chart` · `stat-card` · `data-table` · khuôn import Excel HR (`S5-HR-IMPORT-BE-1/FE-1`) · khuôn job + NOTI (`system-jobs`) · khuôn widget DASH có sàn scope.
**Chưa có:** Recharts (stack chọn nhưng chưa cài) · thư viện PDF · cột tài khoản ngân hàng ở `employee_profiles` (chỉ nhắc trong comment mask, không có cột thật).

## 2. Bản đồ khoảng cách — MISA AMIS ↔ MediaOS v1

| # | Màn / năng lực MISA | v1 MediaOS | Khoảng cách | Xếp |
| --- | --- | --- | --- | --- |
| G1 | **Nhân viên** (danh sách + chi tiết 5 tab: Thông tin chung · Lịch sử lương · Bảo hiểm-Công đoàn · Thuế TNCN · Gia đình) | Chỉ có picker 034 + form hồ sơ lương 1 dòng phụ cấp | Thiếu màn nhân viên trong PAYROLL; hồ sơ lương thiếu **NET/GROSS · đối tượng đóng TNCN · lương đóng BH · lương thử việc · tỉ lệ hưởng · phụ cấp có định mức/trạng thái · khấu trừ cố định**; thiếu **BH-công đoàn** (tham gia, tỉ lệ NV/DN) và **người phụ thuộc** | **V2 — Track A** |
| G2 | **Thành phần lương** (catalog: mã · loại · tính chất · kiểu giá trị · công thức · nguồn) | Không có — khoản cứng trong SQL | Thiếu catalog + **máy công thức** | **V2 — Track B** |
| G3 | **Mẫu bảng lương** (cột hiển thị · công thức · ẩn/hiện · xem trước · mẫu rút gọn) | Không có — 1 khuôn cột cố định | Thiếu template gắn vào kỳ | **V2 — Track B** |
| G4 | **BHXH/BHYT/BHTN/KPCĐ/đoàn phí + TNCN luỹ tiến + giảm trừ gia cảnh** | PARK-PAYROLL-001 | Thiếu engine luật định + bảng tỉ lệ có hiệu lực | **V2 — Track B** |
| G5 | **Dữ liệu tính lương → Chấm công** (bảng công theo tháng, nguồn, khoá) | Đầu vào công gom ngầm lúc `calculate` (readiness panel) | Thiếu màn **xem bảng công tổng hợp per kỳ** trước khi tính | V2 — Track A (màn đọc) |
| G6 | Dữ liệu tính lương → **Doanh số · KPI · Sản phẩm** | — | **NGOÀI phạm vi sản phẩm** (de-media-fy: KPI/doanh thu theo kênh bị loại — CLAUDE.md §1) | ✖ |
| G7 | Dữ liệu tính lương → **Thu nhập khác · Khấu trừ khác** | `bonus_penalties` (thưởng/phạt, có duyệt) | Có nền; thiếu **import Excel** + phân loại theo thành phần | V2 — Track C |
| G8 | Tính lương → **Tạm ứng** | — | Thiếu | **V2 — Track C** |
| G9 | Tính lương → **Tổng hợp lương** (nhiều kỳ · theo đơn vị) | `summary` 1 kỳ | Thiếu tổng hợp đa kỳ | V2 — Track D (báo cáo) |
| G10 | Tính lương → **Phân bổ lương** (cost center) | — | Kế toán chi phí — **ngoài phạm vi** (finance OUT) | ✖ |
| G11 | Tính lương → **Ngân sách lương** + gauge | — | Thiếu | V2 — Track C |
| G12 | **Chi trả** (đợt chi · ngân hàng/tiền mặt · tệp UNC) | `publish` nhảy thẳng `Paid` | Thiếu bước chi trả thật + tài khoản ngân hàng | **V2 — Track C** |
| G13 | **Báo cáo** (8 báo cáo + lịch gửi định kỳ) | XLSX bảng lương 1 kỳ | Thiếu 7 báo cáo; lịch gửi định kỳ = Phase sau | **V2 — Track D** |
| G14 | **Tổng quan** (6 biểu đồ + Lời nhắc) | 1 widget DASH | Thiếu trang tổng quan module | **V2 — Track D** |
| G15 | **Phiếu lương PDF** | PARK | Thiếu | V2 — Track D |
| G16 | **Bố cục**: sidebar nhóm gập được · toolbar (tìm · trạng thái · đơn vị · lọc · chọn cột) · bảng ghim cột · footer «Tổng số · dòng/trang · 1–N» · header chi tiết «← · tiêu đề · Sửa · ⋯» · tab | shadcn chung, chưa có nhóm sidebar, chưa chọn cột, footer phân trang tối giản | Nâng `packages/ui` dùng CHUNG mọi module | **V2 — Track UI (làm TRƯỚC)** |
| G17 | Trợ lý AI · Thư viện mẫu cloud · «Lấy lại dữ liệu» từ AMIS · đa đơn vị pháp nhân | — | Phase 5 / SaaS — ngoài | ✖ |

## 3. Quyết định owner — ĐÃ KÝ 02/09/2026 — PAY-DEC-011..020 (chốt theo cột Đề xuất)

| Mã | Câu hỏi | Đề xuất | Hệ quả nếu chọn khác |
| --- | --- | --- | --- |
| **PAY-DEC-011** | Đánh số & phạm vi tài liệu | Wave `S15-PAYROLL-V2`; **SPEC-11 lên v2** (cùng file: §5.1 thêm bảng «v2», §22 thêm 011..020) · DB-13 v2 · API-18 v2 · §9g mở rộng; mig `0569+` (đo journal lúc chạy) · `PAY-SCREEN-007+` · `PAYROLL-API-036+` · `PAYROLL-ERR-018+` · `NOTI-EVENT-024+` (đo dải) · story `IMP02-STORY-191+` (EPIC-20 §8.21 tiếp) · Sprint 15 | Tách SPEC-16 riêng = nhân bản rule ⇒ drift |
| **PAY-DEC-012** | **Máy công thức đặt ở đâu** (đảo một phần PAY-DEC-004 «tính ở SQL») | **Engine biểu thức ở TS, số học `decimal.js`** (cấm float), đánh giá theo đồ thị phụ thuộc thành phần (topo-sort, cấm vòng), kết quả ghi `numeric(18,2)` + **snapshot `component_values_json` per dòng**; **SQL giữ bất biến** (`SUM(items) = net` · CHECK ≥ 0 · UNIQUE). Cú pháp: `+ − × ÷`, `( )`, so sánh, `IF(c,a,b)`, `MIN/MAX/ROUND/ABS`, tham chiếu `MÃ_THÀNH_PHẦN` — **KHÔNG** `eval`, **KHÔNG** gọi hàm tuỳ ý | Giữ SQL thuần = viết compiler công thức→SQL, chi phí ×3 và khó audit; giữ công thức cứng = không có G2/G3 |
| **PAY-DEC-013** | Mô hình catalog + mẫu | `salary_components` = **hệ thống (seed, không xoá, sửa được công thức) + tự thêm**; `payroll_templates` + `payroll_template_components` (nhãn cột · công thức ghi đè · ẩn/hiện · thứ tự); **kỳ lương gắn ĐÚNG MỘT mẫu lúc tạo** — đổi mẫu chỉ khi kỳ ≤ `CollectingData`; phạm vi mẫu v2 = **toàn công ty hoặc theo `org_unit`** (vị trí/nhân viên riêng = Phase sau) | Mẫu theo từng nhân viên ngay v2 = ma trận ưu tiên phức tạp, chưa có nhu cầu N=1 |
| **PAY-DEC-014** | **Engine luật định** BH + TNCN | Có: BHXH · BHYT · BHTN · KPCĐ (DN) · đoàn phí (NV) · **TNCN luỹ tiến 7 bậc** + giảm trừ bản thân/người phụ thuộc. **Tỉ lệ + trần + bậc thuế lưu ở bảng `payroll_statutory_rates` versioned theo `effective_from`**, seed giá trị hiện hành **do owner xác nhận** (đề xuất seed: NV 8 / 1,5 / 1 · DN 17,5 / 3 / 1 · KPCĐ 2 · đoàn phí 1 · giảm trừ 11 tr + 4,4 tr/NPT · trần BHXH/BHYT = 20× lương cơ sở, BHTN = 20× lương tối thiểu vùng). Hệ thống **lưu và áp**, không tự khẳng định đúng luật — owner chịu trách nhiệm số | Hard-code tỉ lệ = mỗi lần đổi luật là một migration vùng đỏ |
| **PAY-DEC-015** | **NET / GROSS** (v1 đã GỠ `salary_type`) | **Dựng lại `salary_type ∈ {GROSS, NET}`** trên `salary_profiles`; GROSS đầy đủ; **NET = gross-up lặp** (≤ 30 vòng, hội tụ ≤ 1 đ, ghi số vòng vào snapshot) | Bỏ NET = màn Lịch sử lương thiếu radio NET/GROSS như benchmark, nhưng giảm 1 WO đỏ. Owner chọn |
| **PAY-DEC-016** | Bề mặt «Nhân viên» trong PAYROLL vs Phương án B | Màn **Nhân viên (PAYROLL)** đọc **chiếu HR bó hẹp qua route PAYROLL** (`PAYROLL-API-036`, mở rộng 034), **không cấp cặp HR** cho `payroll-officer`; **`tax_code` được chiếu qua cặp `('view','salary-profile')`** (TNCN cần) — audit lượt xem; **người phụ thuộc + thiết lập BH/công đoàn là bảng PAYROLL** (`payroll_dependents` · `payroll_employee_settings`), không đẩy vào HR | Đưa NPT vào HR = mở lại đường HR↔PAYROLL vốn đã tách (PAY-DEC-006) |
| **PAY-DEC-017** | **Tạm ứng + Chi trả** | `payroll_advances` (FSM `Pending → Approved/Rejected → Deducted`, four-eyes như thưởng/phạt, **tự động thành khoản khấu trừ** ở kỳ chỉ định); **`payroll_payment_batches` + lines** (kỳ · phương thức bank/cash · trạng thái · tệp UNC XLSX theo mẫu); **FSM kỳ tách `publish` khỏi `Paid`**: `Approved → Published (phát hành phiếu) → Paid (đợt chi trả hoàn tất) → Locked` — **8 trạng thái** (SPEC-01 §17.15 sửa); **tài khoản ngân hàng** = cột mới ở `payroll_employee_settings` (mask, sensitive), KHÔNG ở HR. **Phân bổ lương (cost center) NGOÀI** | Giữ 7 trạng thái = «Paid» tiếp tục là tên gọi sai của «đã phát hành» |
| **PAY-DEC-018** | **Báo cáo + Tổng quan** | Trang **`/payroll` = Tổng quan module** (6 khối: phân bố mức lương · cơ cấu thu nhập · ngân sách gauge · chi phí theo thời gian · thu nhập BQ theo thời gian · thu nhập BQ theo đơn vị + **Lời nhắc**: phiếu chưa phát hành · NV chính thức chưa tham gia BH · lương đóng BH ngoài quy định). **7 báo cáo v2**: tổng hợp thu nhập NV · thống kê lương theo thời gian · cơ cấu thu nhập · chi phí lương theo đơn vị · lịch sử lương NV · tổng hợp chi trả · tình hình ngân sách (**«Công nợ» gộp vào tạm ứng**; **lịch gửi định kỳ = Phase sau**). Biểu đồ: **cài Recharts** (đã chốt stack DECISIONS, chưa cài). Mọi báo cáo gác cặp ĐỌC tiền + sàn scope Company + audit | Không cài Recharts = tự vẽ SVG 6 loại biểu đồ |
| **PAY-DEC-019** | **PDF phiếu lương** | **Có** — sinh server (`pdfmake`, font Việt nhúng), tải qua signed-URL file-service, cặp `('export','payroll')` cho batch + Own cho phiếu của mình; audit | Giữ PARK = khoảng cách nhìn thấy rõ nhất với benchmark |
| **PAY-DEC-020** | **Nâng vỏ UI dùng chung** | Làm **TRƯỚC** ở `packages/ui` + `apps/app` layout: sidebar **nhóm gập được** (`Dữ liệu tính lương ▸` · `Tính lương ▸`) · **toolbar chuẩn** (tìm · trạng thái · đơn vị · lọc · ⚙ chọn cột) · `DataTable` **ghim cột + chọn cột + footer «Tổng số · Số dòng/trang · 1–N»** · **header trang chi tiết** (← · tiêu đề · nút chính · ⋯) · pill trạng thái. Theme light/dark giữ; **UI-07 template cập nhật** để mọi module dùng chung (không riêng PAYROLL) | Làm riêng trong `routes/payroll` = nhân bản component, lệch với HR/ATT |

**NGOÀI phạm vi v2 (ghi để không ai tự thêm):** Doanh số · KPI · Sản phẩm (G6) · Phân bổ lương (G10) · lịch gửi báo cáo định kỳ · Trợ lý AI · thư viện mẫu cloud · đa pháp nhân · mẫu bảng lương theo từng nhân viên · duyệt nhiều cấp · multi-currency. → **PARK-PAYROLL-002**.

## 4. Story cấp wave (PL-11..PL-24 — bản đầy đủ viết ở EPIC-20 trong WO DOC)

| Story | Vai | Muốn | Track |
| --- | --- | --- | --- |
| PL-11 | Kế toán lương | Xem danh sách nhân viên hưởng lương + chi tiết 5 tab (chung · lịch sử lương · BH-công đoàn · TNCN · gia đình) | A |
| PL-12 | Kế toán lương | Hồ sơ lương phiên bản mới có NET/GROSS · đối tượng TNCN · lương BH · thử việc · tỉ lệ hưởng · phụ cấp/khấu trừ có định mức & trạng thái | A |
| PL-13 | Kế toán lương | Khai người phụ thuộc (hiệu lực từ/đến) + thiết lập BH/công đoàn/tài khoản ngân hàng | A |
| PL-14 | Kế toán lương | Xem bảng công tổng hợp của kỳ (nguồn ATT, khoá) TRƯỚC khi tính | A |
| PL-15 | Kế toán lương | Quản lý catalog thành phần lương (hệ thống + tự thêm) với công thức có kiểm tra cú pháp/vòng lặp | B |
| PL-16 | Kế toán lương | Tạo mẫu bảng lương (chọn thành phần · nhãn cột · ẩn/hiện · xem trước) và gắn vào kỳ | B |
| PL-17 | Hệ thống | Tính lương theo mẫu: BHXH/BHYT/BHTN/KPCĐ/đoàn phí · TNCN luỹ tiến · giảm trừ · NET gross-up — snapshot từng thành phần, phiếu lương giải thích được | B |
| PL-18 | Company Admin | Quản lý bảng tỉ lệ luật định theo ngày hiệu lực | B |
| PL-19 | Kế toán lương / Nhân viên | Tạm ứng có duyệt, tự khấu trừ vào kỳ chỉ định; NV thấy tạm ứng của mình | C |
| PL-20 | Kế toán lương | Lập đợt chi trả (bank/cash) · xuất tệp UNC · đánh dấu đã trả ⇒ kỳ `Paid` | C |
| PL-21 | Company Admin | Ngân sách lương năm theo đơn vị + theo dõi thực hiện | C |
| PL-22 | Kế toán lương | Nhập Excel thu nhập/khấu trừ khác theo kỳ (khuôn import HR) | C |
| PL-23 | Quản lý / Kế toán | Tổng quan module + 7 báo cáo (lọc kỳ/đơn vị, xuất XLSX) | D |
| PL-24 | Nhân viên | Tải phiếu lương PDF của mình; kế toán xuất PDF hàng loạt | D |

## 5. Phân rã Work Order (15 WO — ĐÃ SEED 02/09/2026 trong harness/backlog.mjs)

```text
S14-PROD-PAYROLLGRANT-1 (ĐANG READY — nên chạy trước để v1 lên PROD) ─┐
                                                                       ▼
duyệt ✅ → S15-PAYROLL-DOC-1 🟢* → S15-UI-SHELL-1 🟢 ─┬─ Track A: DB-1 🔴 → BE-1 🔴 → FE-1 🟡
                                                     ├─ Track B: (sau DB-1) BE-2 🔴 → BE-3 🔴 → FE-2 🟡
                                                     ├─ Track C: DB-2 🔴 (sau DB-1) → BE-4 🔴 → FE-3 🟡
                                                     └─ Track D: BE-5 🟡 (sau BE-3, BE-4) → FE-4 🟡
                                                                                            └→ S15-PAYROLL-QA-1 🟡 → S15-PAYROLL-DASH-1 🟢
```

| WO | Zone | Nội dung | depends_on |
| --- | --- | --- | --- |
| `S15-PAYROLL-DOC-1` | 🟢* | SPEC-11 v2 (§5.1 v2 · §8 bảng mới · §9 PAY-SCREEN-007..016 · §11 cặp mới · §12 ERR-018+ · §13.4 v2 máy công thức + luật định · §22 DEC-011..020) · DB-13 v2 (7 bảng mới) · API-18 v2 (~40 route mới) · §9g v2 · SPEC-01 §17.15 (8 trạng thái) · EPIC-20 PL-11..24 · UI-07 template · plan-reviewer PASS. *(*nhãn xanh nhưng chi phí vùng đỏ — `red-zone-wo-cost-profile`)* | — |
| `S15-UI-SHELL-1` | 🟢 | `packages/ui`: sidebar nhóm gập · toolbar chuẩn · DataTable ghim/chọn cột/footer · DetailPageHeader · StatusPill; áp cho 6 màn PAYROLL v1 làm mẫu; không đụng quyền | DOC-1 |
| `S15-PAYROLL-DB-1` | 🔴 | mig 0569+: `salary_profiles` + `salary_type`/`pit_payer`/`insurance_salary`/`probation_salary`/`pay_ratio_pct`; `salary_profile_items` (phụ cấp/khấu trừ có định mức, thay jsonb) · `payroll_employee_settings` (BH · công đoàn · bank — mask) · `payroll_dependents` · `salary_components` · `payroll_templates` + `_components` · `payroll_statutory_rates` · `payroll_period_lines.component_values_json` · `payroll_periods.template_id`; RLS+FORCE TRƯỚC backfill; seed catalog hệ thống + tỉ lệ luật định (owner xác nhận số) + cặp quyền mới; contracts Zod mirror | DOC-1 |
| `S15-PAYROLL-BE-1` | 🔴 | Route nhân viên (036 chiếu HR bó hẹp + tax_code có audit) · hồ sơ lương v2 · items · settings · dependents · bảng công tổng hợp kỳ (đọc, tái dùng `computeInputsTx`); deny-path RED trước | DB-1 |
| `S15-PAYROLL-BE-2` | 🔴 | Catalog thành phần + mẫu bảng lương: CRUD · **parser/evaluator công thức `decimal.js`** (grammar cố định, topo-sort, phát hiện vòng, giới hạn độ sâu) · validate khi lưu · xem trước mẫu với dữ liệu giả | DB-1, UI-SHELL-1 |
| `S15-PAYROLL-BE-3` | 🔴 | Máy tính lương v2: evaluate theo mẫu của kỳ · engine BH/KPCĐ/đoàn phí · TNCN luỹ tiến + giảm trừ NPT · NET gross-up · snapshot component_values · `payslip_items` theo thành phần · bất biến SQL giữ nguyên · fixture đối soát tay từng đồng (≥1 NV đủ mọi khoản, GROSS + NET) | BE-2 |
| `S15-PAYROLL-FE-1` | 🟡 | PAY-SCREEN-007 Nhân viên (list + detail 5 tab) · 008 Bảng công kỳ · form hồ sơ lương v2 | BE-1, UI-SHELL-1 |
| `S15-PAYROLL-FE-2` | 🟡 | PAY-SCREEN-009 Thành phần lương · 010 Mẫu bảng lương (list + detail + xem trước) · 011 Tỉ lệ luật định · chi tiết kỳ v2 (cột theo mẫu, breakdown theo thành phần) | BE-3, FE-1 |
| `S15-PAYROLL-DB-2` | 🔴 | mig: `payroll_advances` · `payroll_payment_batches` + `_lines` · `payroll_budgets` · FSM 8 trạng thái (`Published`) + RESET vết · NOTI-EVENT-024+ (tạm ứng duyệt/từ chối · đợt chi trả hoàn tất) cả HAI bảng catalog | DB-1 |
| `S15-PAYROLL-BE-4` | 🔴 | Tạm ứng FSM + tự khấu trừ · đợt chi trả + tệp UNC XLSX + `Paid` chỉ khi đợt hoàn tất · ngân sách · import Excel thu nhập/khấu trừ khác (khuôn HR import) · outbox NOTI | DB-2, BE-3 |
| `S15-PAYROLL-FE-3` | 🟡 | PAY-SCREEN-012 Tạm ứng · 013 Chi trả · 014 Ngân sách · import dialog · «Tạm ứng của tôi» (ME) | BE-4 |
| `S15-PAYROLL-BE-5` | 🟡 | 7 báo cáo (SQL set-based, phân trang, XLSX) · dữ liệu tổng quan + lời nhắc · PDF phiếu lương (`pdfmake`) + signed-URL · gác cặp ĐỌC tiền + sàn Company + audit | BE-3, BE-4 |
| `S15-PAYROLL-FE-4` | 🟡 | PAY-SCREEN-015 Tổng quan (`/payroll`, Recharts) · 016 Báo cáo (danh sách + màn xem) · nút PDF ở phiếu lương/ME | BE-5, FE-2, FE-3 |
| `S15-PAYROLL-QA-1` | 🟡 | Ma trận per-pair route mới · IDOR NPT/bank/advance cross-employee · công thức: fuzz parser + vòng lặp + độ sâu · đối soát số BH/TNCN/gross-up theo bảng tay · FSM 8 trạng thái · race · coverage payroll/ ≥85% trên LANE_DB | FE-4 |
| `S15-PAYROLL-DASH-1` | 🟢 | Widget DASH «ngân sách lương» + «tạm ứng chờ duyệt» (sàn scope, `useCanExact`) | QA-1 |

- **Track A ‖ B ‖ C chạy được song song sau DB-1** (DB-2 nối tiếp DB-1 — lane migration duy nhất). Vẫn **1 WO/phiên** theo vận hành v2; song song là để hàng đợi luôn có WO ready.
- Crown routing: DB-1/DB-2/BE-1..4 = 🔴 FULL gate + Opus; FE/QA/BE-5 = 🟡; UI-SHELL/DOC/DASH = 🟢.
- **Ước chi phí:** 6 WO đỏ × ~$136 + 7 WO vàng × ~$60 + 2 xanh × ~$30 ≈ **$1 300–1 600** (theo `red-zone-wo-cost-profile`; DOC-1 lần S13 tốn $504 vì 3 vòng review — lần này chốt điều kiện tự-mở-cổng từ vòng 2).

## 6. UI dự kiến (wireframe ở hồ sơ HTML §06)

Sidebar PAYROLL v2: **Tổng quan** · **Nhân viên** · **Thành phần lương** · **Mẫu bảng lương** · **Dữ liệu tính lương ▸** (Bảng công · Thu nhập/khấu trừ khác) · **Tính lương ▸** (Kỳ lương · Tạm ứng · Ngân sách) · **Chi trả** · **Báo cáo** · **Thiết lập ▸** (Tỉ lệ luật định). «Phiếu lương của tôi» + «Tạm ứng của tôi» ở sidebar ME.
Mọi màn: toolbar chuẩn · bảng ghim cột đầu · footer tổng số · pill trạng thái · header chi tiết `← · tiêu đề · Sửa · ⋯` · tab; số `tabular-nums`; mọi trường tiền `.optional()`.

## 7. Rủi ro & bẫy đã biết (viết sẵn vào done_when)

1. **Máy công thức = bề mặt tấn công mới**: grammar cố định, không `eval`/`Function`, giới hạn độ dài/độ sâu/số node, timeout evaluate, fuzz test; công thức chỉ người có `('manage','salary-component')` sửa — cặp **sensitive** (sửa công thức = sửa tiền của cả công ty) + audit diff.
2. `decimal.js` **duy nhất** cho số học ở TS; cấm `Number` trên tiền; kết quả ghi SQL `numeric(18,2)`; bất biến `SUM(items) = net` vẫn assert ở SQL trong tx.
3. Đổi mẫu/đổi công thức **KHÔNG** chạm kỳ đã `Calculated` trở lên — snapshot `component_values_json` là nguồn giải thích; test «sửa công thức sau khi tính không đổi số».
4. Tỉ lệ luật định versioned: kỳ dùng bản hiệu lực tại **ngày cuối kỳ**; seed số do owner xác nhận, có ca test ghim số seed.
5. FSM 7→8 trạng thái: sửa **SPEC-01 §17.15 TRƯỚC**, bảng RESET vết + `assertPeriodTransition` + parity FE (`payroll-fsm-parity.spec`) — đây là chỗ CHECK không ép được (`check-cannot-enforce-fsm-transitions`).
6. Bank account/NPT/tax_code = PII mới trong PAYROLL: mask server (vắng khoá), `.optional()` FE, audit lượt xem, allowlist capability BACKEND (`sensitive-capability-allowlist-is-backend`), IDOR cross-employee có cụm ca riêng.
7. `salary_type` dựng lại sau khi v1 GỠ: migration ADD COLUMN mới (band 0564 bất khả xâm phạm), default `GROSS`, backfill không cần.
8. Migration jsonb `allowances` → bảng `salary_profile_items`: **expand-contract** (`migration-expand-contract-required`), đo PROD trước (v1 chưa lên PROD ⇒ dự kiến 0 hàng).
9. Recharts + pdfmake là dep mới: `pnpm audit`, license (MIT cả hai), font Việt nhúng (`Be Vietnam Pro`/`Roboto`) — PDF không được rơi về font thiếu dấu.
10. Báo cáo cộng toàn công ty ⇒ **sàn scope Company** cả đường metadata lẫn data (`dash-widget-gate-needs-scope-floor`); cache hit bỏ audit (`widget-cache-hit-skips-audit-trail`) — báo cáo KHÔNG cache.
11. Nhân bản WO đỏ trong 1 phiên: tối đa **1 vòng plan-review** + điều kiện tự-mở-cổng (`plan-review-rounds-inject-new-holes`).
12. UI-SHELL đụng `packages/ui` dùng chung mọi module ⇒ chạy đủ test FE 3 app + screenshot regression các màn HR/ATT.

## 8. Definition of Done cấp wave

- Bộ tài liệu v2 đồng bộ (SPEC-11 · DB-13 · API-18 · §9g · SPEC-01 §17.15 · EPIC-20 · UI-07 · README §8 · erd-current · RELEASE PARK-PAYROLL-002); plan-reviewer PASS.
- DB: 10 bảng mới/ALTER với RLS+FORCE, composite tenant-FK, CHECK; seed catalog + tỉ lệ + cặp quyền.
- BE: engine công thức an toàn + luật định + gross-up có fixture đối soát tay; FSM 8 trạng thái; tạm ứng/chi trả/ngân sách; 7 báo cáo + PDF; mọi route guard 2 tầng + masking + audit + @Idempotent.
- FE: 10 màn mới (PAY-SCREEN-007..016) trên vỏ UI chung; ME thêm tạm ứng + PDF.
- QA ≥85% payroll/ trên LANE_DB; `docs/TESTABLE-FEATURES.md` cập nhật; 15 WO đóng dấu.
