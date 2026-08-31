# Kế hoạch wave S13-PAYROLL — Phase 2 «HR nâng cao»: PAYROLL (tiền lương)

> Seed 2026-08-31. Trạng thái: **ĐÃ DUYỆT 2026-08-31** — owner duyệt nguyên gói hồ sơ
> **`docs/plans/S13-PAYROLL-WAVE-review.html`** (kèm wireframe UI) và ký 10/10 quyết định §3 theo
> cột «Đề xuất» («ok tôi duyệt»). `S13-PAYROLL-DOC-1` seed thẳng ở trạng thái `todo` (duyệt trước
> khi seed); 6 WO sau xích `depends_on` nối tiếp. Nguồn phạm vi: SPEC-01 §12.8 · §10.6 (Payroll
> Officer) · §29 câu #9/#14/#15 · IMPLEMENTATION-10 §10.1 (P2-PAY-01..10) + §13.2 (giữ chỗ DB-13)
> · DECISIONS-01 (Phương án B — quyền lương tách riêng, Block-code).
>
> Đây là **mảnh cuối của Phase 2** (RECRUIT đã đóng cùng ngày — PR #452). Wave kế tiếp sau
> PAYROLL: Phase 5 (MOBILE · AI · INTEGRATION) hoặc nợ vận hành (KI-050 backup · KI-056 2FA SA ·
> KI-016 tách dist) — chốt ở buổi seed sau.

---

## 1. Điểm xuất phát — ĐO THẬT ngày 31/08/2026

- **PAYROLL KHÔNG phải chỗ trống — RECONCILE-FIRST:** tầng DB đã build **6 bảng từ đợt G12**
  (media-era, mig `0091–0131`): `salary_profiles` · `payroll_periods` · `payslips` ·
  `payslip_items` · `bonus_penalties` · `payslip_acknowledgements`. Tất cả đủ RLS ENABLE+FORCE +
  policy tenant; `payslips`/`payslip_items` append-only đúng khuôn (GRANT app SELECT+INSERT).
  Nhưng **0 route, 0 thư mục `apps/api/src/payroll/`**, 0 dòng app.module. `erd-current.md` §A5
  xếp cả cụm «hướng cũ cần dọn» — wave này nâng nó lên «khớp thiết kế».
- **Permission di sản mâu thuẫn quyết định đã chốt:** `0092` (view/manage-salary-profile) +
  `0097` (manage-payroll-period · run-payroll · view-payslip · read-payslip) grant TAY
  **company-admin + hr-manager**; `0180` seed `view-own-payslip` cho employee. DECISIONS-01
  **Phương án B** (Block-code) nói quyền lương KHÔNG mặc định cho HR; role canonical `hr` mô tả
  «non-salary». ⇒ PAY-DEC-006: thu hồi grant hr-manager.
- **Điểm nối đã sống:** masking lương HR chạy thật (`hr-read.service` reveal `base_salary` +
  audit atomic) · `attendance_periods` (open/locked, `payroll_periods.attendance_period_id` đã
  FK) · `leave_types.paid` + loại UNPAID seed sẵn · `companies.payroll_config_json`
  (cutoffDay 25 / payDay 5) đọc/ghi ở Settings. **KHÔNG có bảng tổng hợp công kỳ** — nguồn công
  là raw `attendance_records`.
- **Hàng `modules` PAYROLL pre-seed inactive** từ mig `0435` (Extension, sort 8) — seed lại là
  NO-OP; chỉ bật `is_active` ở WO FE (khuôn 0556/0562).
- **Đánh số:** SPEC-11 giữ chỗ sẵn (SPEC-01 §7.2) · DB-13 giữ chỗ sẵn (IMP-10 §13.2 —
  ASSET/ROOM đã né sang DB-15/16) · **API-13 vốn định cho PAYROLL đã bị CHAT chiếm**, 14..17 đã
  dùng ⇒ nhận **API-18**. → PAY-DEC-001.
- **Dải mã trống đo được:** migration head `0563` (journal idx 230) ⇒ nhận `0564+` (idx = max+1,
  KHÔNG suy từ tên file — quy ước ghi trong 0180) · NOTI-EVENT dừng **019** ⇒ nhận **020+** ·
  permission-matrix dừng **§9f** ⇒ nhận **§9g** · IMPLEMENTATION-02 dừng EPIC-19/STORY-180/
  Sprint 12 ⇒ nhận **EPIC-20 (§8.21) · STORY-181+ · Sprint 13** · SPEC-01 §17 dừng **§17.14** ⇒
  nhận **§17.15–17.17** · ID role hệ thống trống `…0015`.
- **Lỗ tài liệu phát hiện khi đo** (WO DOC vá): SPEC-01 §30 thiếu dòng `HR → PAYROLL` và
  `LEAVE → PAYROLL`; IMP-10 có epic P2-PAY-10 trong bảng overview nhưng KHÔNG có story chi tiết.

## 2. Phạm vi wave

| Phạm vi v1 (SPEC-01 §12.8 · IMP-10 §10.1, P0/P1 theo DEC) | NGOÀI phạm vi v1 |
| --- | --- |
| Hồ sơ lương versioned (base + phụ cấp, effective date, mask) · thưởng/phạt/khấu trừ nhập tay theo kỳ có trạng thái duyệt · kỳ lương tháng FSM 7 trạng thái + gắn khoá kỳ công ATT · tổng hợp đầu vào công/phép (paid/unpaid) + cảnh báo thiếu · tính bảng lương nháp (gross/khấu trừ/net, SQL numeric, snapshot đóng băng, breakdown giải-thích-được) · review + điều chỉnh + duyệt 1 cấp four-eyes + lock/reopen · payslip phát hành + Own view + ack + NOTI · export XLSX (quyền riêng + audit) · masking Phương án B + audit lượt xem · widget DASH «chi phí lương kỳ» | Engine BHXH/BHYT/BHTN/TNCN luỹ tiến · PDF payslip · variance report + report theo phòng ban · multi-currency · workflow duyệt nhiều cấp · signed-URL batch export (**tất cả → PARK-PAYROLL-001**, RELEASE-14 §5) |

Vai trò: seed role hệ thống **`payroll-officer`** (`…0015`, SPEC-01 §10.6, KHÔNG canonical,
**requires_two_factor=true** — PAY-DEC-009); người duyệt = company-admin (four-eyes).

## 3. Quyết định owner — ĐÃ KÝ 2026-08-31

> Owner duyệt nguyên gói («ok tôi duyệt») ⇒ **10/10 mã dưới đây chốt ĐÚNG cột «Đề xuất»** của hồ
> sơ HTML. WO DOC chỉ chép kết luận vào bảng quyết định SPEC-11, không hỏi lại.

| Mã | Câu hỏi | Đề xuất — **đã chốt** |
| --- | --- | --- |
| PAY-DEC-001 | Đánh số khi API-13 đã bị CHAT chiếm | **SPEC-11 · DB-13** (đúng chỗ giữ) · **API-18** · §9g · EPIC-20 (§8.21), STORY-181+, Sprint 13 · §17.15–17.17 · NOTI-EVENT-020..023 · mig 0564+ (đo lại dải trước khi ghi) |
| PAY-DEC-002 | Số phận 6 bảng di sản G12 | **RECONCILE — giữ khung, không drop-rebuild.** DB-13 viết chuẩn rồi đối chiếu; lệch → ALTER bằng migration MỚI (đo dữ liệu PROD trước — dự kiến 0 hàng); giữ khuôn append-only payslips; cột/CHECK không phù hợp → GỠ theo DB-13, không nối dây; erd-current chuyển payroll rời §A5 |
| PAY-DEC-003 | Nguồn sự thật lương cơ bản | **`salary_profiles` versioned là nguồn DUY NHẤT cho tính lương.** `employee_profiles.base_salary` không tham gia — giữ vai trò hiển thị HR (masking hiện hành), ghi chú deprecate Phase sau |
| PAY-DEC-004 | Phạm vi công thức v1 | gross = base pro-rate + phụ cấp + thưởng − phạt; khấu trừ = không lương + trễ/sớm (nếu bật rule ATT) + dòng tay (%/số). **KHÔNG engine BHXH/BHYT/TNCN** → PARK-PAYROLL-001. **VND duy nhất**, numeric(18,2), tính + làm tròn **ở SQL**. Breakdown giải-thích-được |
| PAY-DEC-005 | Kỳ lương & FSM & khoá công | Kỳ **tháng** (payroll_config_json cutoffDay/payDay). FSM **7 trạng thái** P2-PAY-03-002: Draft → CollectingData → Calculated → Reviewing → Approved → Paid → Locked (§17.15). Calculated đòi `attendance_periods` **locked**; snapshot ĐÓNG BĂNG lúc tính; recalc chỉ khi chưa Approved; reopen = quyền riêng + lý do + audit; Locked khoá luôn chỉnh công phía ATT |
| PAY-DEC-006 | Ai thấy lương ai (câu #9 §29) + grant di sản | Chốt theo **DECISIONS-01 Phương án B**: cặp PAYROLL nhóm độc lập, KHÔNG mặc định cho HR. payroll-officer + company-admin đủ bộ; **hr-manager THU HỒI toàn bộ grant payroll di sản (0092/0097)** bằng migration mới — giữ `view-salary:employee` hiện hành (khác domain); employee giữ `view-own-payslip` (0180). Cặp payroll is_sensitive=true trừ cấu hình kỳ |
| PAY-DEC-007 | Duyệt bảng lương | **1 cấp**, `('approve','payroll_period')` gán **company-admin**, KHÔNG gán payroll-officer — **four-eyes** người tính/người duyệt. Reject bắt buộc comment; approve/reject/lock/reopen đều audit + NOTI |
| PAY-DEC-008 | Payslip & xuất file | Generate khi **Approved** → **Published** + NOTI từng NV; employee xem **Own** in-app + xác nhận qua `payslip_acknowledgements` (tái dùng). Export **XLSX** bảng lương tổng, cặp `('export','payroll')` RIÊNG + audit (chốt luôn câu #14/#15 §29: CÓ). **PDF = Phase sau** |
| PAY-DEC-009 | Role seed & 2FA | Role hệ thống **`payroll-officer`** (`…0015`): company_id NULL · is_system=true · KHÔNG canonical · **requires_two_factor=TRUE** (khác tiền lệ recruiter=false — lương là crown, owner đã chấp nhận khi duyệt nguyên gói) |
| PAY-DEC-010 | Widget DASH (P2-PAY-10 không có story) | v1 đúng **1 widget «chi phí lương kỳ»** (PAYROLL-WIDGET-001): tổng gross/net + headcount + trạng thái kỳ gần nhất; catalog BE + **SÀN scope Company** + chỉ role có cặp payroll; wire slug FE + test. Variance/report = Phase sau |

## 4. Story cấp wave (bản nghiệp vụ đầy đủ viết ở EPIC-20 trong WO DOC)

PL-01 hồ sơ lương versioned (base + phụ cấp, effective date, mask) · PL-02 thưởng/phạt/khấu trừ
tay theo kỳ (lý do, trạng thái duyệt) · PL-03 kỳ lương FSM 7 trạng thái + khoá kỳ công + cảnh
báo thiếu · PL-04 tổng hợp đầu vào công/phép per NV (paid/unpaid, đối soát, recalc trước duyệt)
· PL-05 tính bảng lương nháp (gross/khấu-trừ/net + snapshot đóng băng + breakdown) · PL-06
review + điều chỉnh + duyệt four-eyes + lock/reopen · PL-07 payslip phát hành + Own view + ack +
NOTI · PL-08 export XLSX + audit · PL-09 masking + deny-path + audit lượt xem lương (P0) · PL-10
widget DASH «chi phí lương kỳ».

## 5. Phân rã Work Order (7 WO — seed trong harness/backlog.mjs)

```text
duyệt ✅ → S13-PAYROLL-DOC-1 → S13-PAYROLL-DB-1 🔴 → S13-PAYROLL-BE-1 🔴 → S13-PAYROLL-BE-2 🔴 → S13-PAYROLL-FE-1 → S13-PAYROLL-QA-1 🟡 → S13-PAYROLL-DASH-1
```

- Một module ⇒ track nối tiếp, DB-1 là lane migration duy nhất (nối head thật lúc merge, dự kiến
  0564+). **BE tách đôi** — khác RECRUIT: BE-1 = nền (profile · bonus/penalty · FSM kỳ · đầu
  vào), BE-2 = máy tính lương + duyệt + phát hành (cụm crown đặc quánh, gộp một WO vượt khẩu độ
  một phiên vùng đỏ ~$136/WO).
- DOC → DB có chốt: **plan-reviewer đối kháng PASS** trên SPEC-11 + DB-13 trước khi mở WO DB
  (khuôn wave CHAT/OFFICE/RECRUIT).
- Crown routing: DB-1/BE-1/BE-2 = 🔴 FULL gate + Opus (payroll/payslip khai báo crown sẵn trong
  CLAUDE.md §6); DOC/FE/DASH = 🟢 LIGHT; QA = 🟡. Coverage payroll/ ≥85%.

## 6. UI dự kiến (wireframe chi tiết ở hồ sơ HTML duyệt)

`apps/app/src/routes/payroll/` + màn ME — PAY-SCREEN-001 danh sách kỳ lương · 002 chi tiết kỳ
(bảng lương + FSM actions + cảnh báo thiếu, mask per-row) · 003 phiếu lương breakdown
giải-thích-được · 004 hồ sơ lương NV (versioned + lịch sử) · 005 thưởng/phạt/khấu trừ kỳ · 006
«Phiếu lương của tôi» (ME, Own + ack, deep-link NOTI). Mọi màn: `<PermissionGate>` + `useCan()`,
loading/error/empty, i18n vi, trạng thái constants §17.15–17.17, số tabular-nums, FE schema
`.optional()` mọi trường tiền.

## 7. Rủi ro & bẫy đã biết (14 mục, chi tiết ở hồ sơ HTML §08)

1. Band di sản 0091–0180 bất khả xâm phạm — mọi thay đổi bằng migration MỚI 0564+; journal
   idx = max+1.
2. ĐO trước khi ALTER: SELECT count 6 bảng + pg_catalog grant hiện trạng (GRANT migration cũ ≠
   hiện trạng).
3. REVOKE bảng xoá column-GRANT; khuôn append-only payslips giữ nguyên SELECT+INSERT.
4. Khoá theo KỲ cần nguồn ĐÓNG BĂNG — idempotency key content-derived; recalc sau Approved chặn
   bằng FSM + test.
5. Tiền tính ở SQL (numeric 18,2 + làm tròn + clamp) — cấm float JS; fixture đối soát tay khớp
   từng đồng.
6. Composite tenant-FK: band G12 ra đời trước khuôn 0535 — rà + bổ sung.
7. Zod mirror CHECK theo HIỆN TRẠNG DB (bonus_penalties_reference_check đã bị 0548 sửa) hai
   chiều đúng bằng; trần Zod ≠ trần service.
8. Masking server ⇒ FE `.optional()` mọi trường tiền; cặp is_sensitive khai allowlist capability
   BACKEND.
9. CHECK không ép được FSM — 7 trạng thái ép ở service + ma trận chuyển sai; Locked khoá luôn
   chỉnh công phía ATT (ATT-ERR-024).
10. NOTI CHECK cả hai bảng + baseline guard forward-compatible; modules PAYROLL pre-seed
    inactive — bật CHỈ ở WO FE, guard không assert module khác.
11. Guard cặp 2 tầng — census QA so TỪNG ROUTE theo MÃ; route-census regen có chủ đích; `:id` =
    UUID.
12. Own-scope payslip = biên IDOR cứng nhất: cross-employee CÙNG company có cụm int-spec riêng;
    audit lượt XEM theo khuôn reveal+audit atomic HR.
13. TZ & biên kỳ: cắt kỳ tháng ở BE (UTC-at-rest, FE không có companies.timezone); test cuối
    tháng + pro-rate giữa kỳ.
14. LANE_DB như CI; deny có ca ALLOW đối chứng; fixture giả-secret ghép chuỗi (gitleaks).

## 8. Definition of Done cấp wave

- Bộ tài liệu đủ: SPEC-11 (Approved) · DB-13 (kèm bản đồ reconcile) · API-18 ·
  permission-matrix §9g; SPEC-01 (§12.8/§17.15–17.17/§20.2/§30 vá 2 dòng thiếu)/README/
  DB-01·09·10/erd-current (payroll rời §A5)/RELEASE-14 (PARK-PAYROLL-001)/IMPLEMENTATION-02
  (EPIC-20) đồng bộ.
- Schema + migration: reconcile 6 bảng theo DB-13 (đo PROD trước) · composite tenant-FK · CHECK
  FSM · thu hồi grant di sản hr-manager · seed role payroll-officer (…0015, 2FA) + §9g + NOTI
  catalog 2 bảng.
- BE: guard per-pair 2 tầng + FSM 7 trạng thái + masking Phương án B + audit lượt xem + máy tính
  lương SQL snapshot đóng băng + four-eyes + payslip bất biến sau Published + export audit +
  outbox NOTI 020..023 + @Idempotent.
- FE: đủ 6 màn §6 + màn ME + bật module; QA: ma trận per-pair + IDOR cross-employee + FSM + race
  + đối soát số + census mã lỗi trên LANE_DB, coverage payroll/ ≥85%.
- DASH: widget «chi phí lương kỳ» + sàn scope + slug FE có test.
- `docs/TESTABLE-FEATURES.md` cập nhật; backlog/ledger đóng dấu đủ 7 WO.
