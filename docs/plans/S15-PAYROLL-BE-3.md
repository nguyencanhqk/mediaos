# S15-PAYROLL-BE-3 — Máy tính lương v2 (evaluate theo mẫu · luật định · TNCN · gross-up NET · snapshot · phiếu theo thành phần)

> 🔴 Vùng đỏ — tiền + migration + trigger. **Opus** code + review. **FULL gate TUẦN TỰ**: security-reviewer → silent-failure-hunter
> (→ database-reviewer CHỈ trên `0575` + câu UPSERT, prompt hẹp). Plan-review đối kháng **một vòng** trước khi code
> (memory `red-zone-wo-cost-profile` · `plan-review-rounds-inject-new-holes`).
> Nhánh `feat/s15-payroll-be-3` cắt từ master `19780581` (sau #509). Lane `mediaos_be3` đã dựng (242 migration, head `0574`).

## 0. Quyết định owner (15/09/2026, phiên này — AskUserQuestion)

| # | Câu hỏi | Chốt |
| --- | --- | --- |
| O-1 | Kỳ CHƯA gắn mẫu bấm «Tính» | **409 023 `template-missing` theo SPEC-11 §13.6 H + API-18 §326** — KHÔNG giữ đường v1. Backlog BE-3 done_when #1 («kỳ không template ⇒ đường v1») là SAI, sửa cùng commit. Gỡ câu UPSERT công thức v1; 9 file int-spec v1 chuyển sang seed catalog + gắn `MAU_MAC_DINH` |
| O-2 | NV không tham gia BH / không là đoàn viên | **Zero TỈ LỆ theo dòng**: `joins_social_insurance = false` ⇒ `TL_BHXH_NV · TL_BHYT_NV · TL_BHTN_NV · TL_BHXH_DN · TL_BHYT_DN · TL_BHTN_DN · TL_KPCD := 0`; `joins_union = false` ⇒ `TL_DOAN_PHI := 0`. Không đổi seed, không hard-code mã thành phần. Không có hàng settings ⇒ cả hai `false` (default DB) |
| O-3 | `payslip_items` của dòng v2 | **MỌI thành phần góp vào net** (earning/tax_exempt `+` · deduction/statutory_employee `−` · tax `−` chỉ khi `pit_payer = EMPLOYEE`); bỏ `aggregate` + `statutory_employer`; `is_visible` chỉ vào `meta`. Sinh từ SNAPSHOT lúc tính, không từ mẫu hiện tại |
| O-4 | Đầu vào trong vòng gross-up NET | **Lặp trên «công đủ»**: `SYS_PRESENT_DAYS = SYS_WORK_DAYS`, nghỉ = 0, trễ = 0, `SYS_PRORATE = 1`, `SYS_PAY_RATIO = 100`, thưởng/phạt/tạm ứng = 0, GIỮ phụ cấp hồ sơ + NPT + tham gia BH thật; hội tụ `TONG_THU_NHAP − TONG_KHAU_TRU` (trước điều chỉnh tay) về `N`. Lượt cuối chạy đầu vào THẬT với `b*`. `insurance_salary` NULL ⇒ căn cứ BH = `b` (không phải `N`) |
| O-5 | 🔴 **Lỗi thuế mới phát hiện ở phiên này** (xem §3.4) | **`NGHI_KHONG_LUONG` đổi thành `kind = earning`, công thức ÂM** qua migration `0575` (khuôn 0574) + `seedVersion v4`. Engine KHÔNG đổi |

## 0b. Vá plan-review vòng 1 (15/09) — ĐỌC TRƯỚC, ĐÈ lên §4–§7

Verdict vòng 1 = **BLOCK** kèm 3 điều kiện tự-mở-cổng (B1 · B2 · M1). Đã vá đủ ⇒ **PASS, KHÔNG mở vòng 2**. Mục M/m vá cùng.

| ID | Vá | Đè lên |
| --- | --- | --- |
| **B1** mẫu thiếu thành phần mang đầu vào ⇒ khoản bị gắn/đánh dấu đã dùng mà không vào lương (bỏ `TAM_UNG` ⇒ tạm ứng `Deducted` nhưng không trừ; bỏ `THUONG` ⇒ thưởng consume mà không trả; bỏ `NGHI_KHONG_LUONG` ⇒ nghỉ không lương vẫn được trả vì tử số `LUONG_CO_BAN` đã cộng unpaid) | **Cổng ĐỘ PHỦ ĐẦU VÀO** `assertTemplateInputCoverage(rows)`: mẫu PHẢI chứa đủ 4 hàng hệ thống `THUONG · PHAT · TAM_UNG · NGHI_KHONG_LUONG` (`isSystem`, sống, active) với `formula_override IS NULL`; nội dung hàng do cổng drift §4.8 bảo đảm. Chạy ở 002/004 (lúc gắn) **và** calc bước 8. Vi phạm ⇒ **422 018 kind MỚI `template-input-missing`** `{components: "TAM_UNG,…"}`. Hằng `PAYROLL_TEMPLATE_REQUIRED_INPUT_CODES` export từ seeder (một nguồn). Ca int cho TỪNG mã (bỏ link · ghi đè) + đột biến (l) «bỏ cổng» | §4.2 · §4.3 bước 8 · §4.11 · §6.2 · §6.4 |
| **B2** ca «lỗi ⇒ không đổi gì» xanh-RỖNG (kỳ `CollectingData` chưa gắn gì) | Thêm nhóm ca **tính lại từ `Calculated` rồi gây lỗi** (021 · 018 drift · 018 `template-input-missing` · 022 missing): trạng thái trước có dòng + `template_fingerprint` + thưởng đã gắn + tạm ứng `Deducted`; sau lỗi assert dòng (từng cột tiền + fingerprint) · `bonus_penalties.payroll_period_id/consumed_at` · `payroll_advances.status='Deducted'` + cặp **y nguyên**, kỳ vẫn `Calculated` | §6.2 |
| **M1** thứ tự khoá ngược quy ước `payroll-catalog.lock.ts:16` («advisory TRƯỚC, `FOR UPDATE` hàng SAU») ⇒ 40P01 khi BE-4 cho 052 kiểm `template-in-use` trên `payroll_periods` dưới khoá độc quyền | **ĐẢO thứ tự**, không chỉ ghi luật: calc + 004 (khi có `templateId`) + 002 (khi có `templateId`) lấy `pg_advisory_xact_lock_shared` **NGAY ĐẦU tx, TRƯỚC `lockForUpdateTx`**. Khi đó writer độc quyền đọc/khoá `payroll_periods` sau khoá advisory cũng không tạo chu trình. Census khoá ghim «shared lock đứng TRƯỚC `lockForUpdateTx`» ở 3 method. Ghi thêm vào done_when BE-4: 052 kiểm `template-in-use` KHÔNG `FOR SHARE/UPDATE payroll_periods` (thừa an toàn) | §4.2 · §4.3 bước 2/6 · R6 |
| M2 | NV-N dùng `insurance_salary` NULL dưới trần (đã vậy ở evidence) và so **`b*` + `iterations`** với bảng Python ⇒ đột biến «fallback = N trong I(b)» đỏ | §6.1 #2/#6 |
| M3 | Int-case điều chỉnh tay khi tính lại, CẢ hai nhánh: (i) `adjust-line −X` trên dòng sống rồi tính lại ⇒ `DO UPDATE` giữ adj, `net = GREATEST(gross−ded+adj,0)` đúng từng xu, gồm ca kẹp âm ⇒ 0; (ii) NV rời điều kiện (xoá mềm dòng có adj) rồi quay lại ⇒ nhánh hồi sinh mang adj | §6.2 · §6.4 (j) |
| m1 | SPEC §13.8 «b₀ = N là chặn dưới» SAI khi F giữ phụ cấp hồ sơ (N 5tr, `PHU_CAP` 6tr ⇒ b₁ < 0 ⇒ 021 cả kỳ). Sửa câu SPEC; ca unit ghim `non-positive-base`; ghi nợ «cảnh báo sớm ở route hồ sơ lương» (không làm ở BE-3) | §4.5 · SPEC |
| m2 | Chốt MỘT đường ném: hàm thuần (`formula/formula.line.ts`) ném **`FormulaError`** — thêm `grossup-not-converged → PAYROLL-ERR-021` và `negative-total → PAYROLL-ERR-020` vào `FORMULA_ERROR_KINDS`, `FormulaErrorDetails.iterations`; `FORMULA_CODE_TO_KEY` + key `GROSSUP_NOT_CONVERGED`; service `formulaErrorToHttp(err, {userId})`. Census BE đọc bảng đó (đã có). Kind CẤP SERVICE (023 · 018 `system-component-drift`/`template-input-missing` · 022 `statutory-rate-missing`) vẫn là literal `payrollDetails` ⇒ census FE | §4.5 · §4.6 · §4.11 · §5 |
| m3 | `calculate` trả `warnings[]` (chuỗi, KHÔNG tiền): `unconsumed-bonus-penalties:<n>` · `unconsumed-advances:<n>` = khoản `Approved` cùng tháng chưa gắn sau lượt tính (của người không đủ điều kiện) — một câu đếm O(1) | §4.3 bước 16 |
| m4 | Số file int-spec v1 gọi `/calculate` = **8** (không phải 9) | §0 O-1 |
| m5 | Trước khi viết 0575: grep MỌI fixture `bonus_penalties` (`bonus-penalty-transition:136,248,319,344,370` · lifecycle · db1b · rls-registry) đo cặp `created_by`/`decided_by`, liệt kê vào §11 | §7 |

**File engine đổi chỗ (m2):** `apps/api/src/payroll/formula/formula.line.ts` (+ `.spec.ts`) thay `payroll-line-engine.ts` — nằm dưới `formula/` để census kiến trúc (cấm `Number(`/`Math.`/…) và trần coverage 95%/file tự phủ. Ngày công đi vào dạng CHUỖI (service đổi `n.toFixed(2)` ngoài `formula/`). Snapshot JSON dựng ở `payroll-line-snapshot.ts` (tầng service).

## 1. Ranh giới

**TRONG phạm vi**

1. Migration `0575`: (a) vá hàng hệ thống `NGHI_KHONG_LUONG` → `earning` + công thức âm (O-5); (b) CHECK `bonus_penalties_four_eyes_check` (nợ security DB-1B MEDIUM). Mirror drizzle + map lỗi.
2. Gắn mẫu vào kỳ: `templateId` ở payload **002** + **004**; validate lúc GẮN (tồn tại · active · scope · đồ thị biên dịch `requireEngineNodes`); đổi mẫu khi kỳ `> CollectingData` ⇒ 409 023 `template-locked`. `templateId` vào DTO kỳ.
3. `calculate` (007) v2: cổng fail-closed (023 · 022 · 018 · 019 · 020 · 021) + đọc đầu vào set-based O(1) + evaluate TS theo mẫu + participation (O-2) + gross-up (O-4) + snapshot `component_values_json` + `template_fingerprint` + `gross_up_iterations` + ghi set-based + clamp `net` Ở SQL.
4. Tạm ứng: nhả / khoá tập / gắn (`status = 'Deducted'` cùng câu) — CHECK `payroll_advances_consume_status_check` BẮT BUỘC (§3.5).
5. Cổng CỨNG lúc TÍNH cho nội dung hàng `is_system` (nợ security DB-1B LOW) — so với hằng seeder ⇒ 422 018 `system-component-drift`.
6. Sinh phiếu (013) cho dòng v2 từ snapshot (O-3); nhánh v1 (dòng `component_values_json = '{}'`) GIỮ NGUYÊN để kỳ v1 đã `Approved` vẫn sinh được phiếu.
7. DTO dòng (008) thêm khoá additive `components[]` (sau `canSeeMoney`) · `templateFingerprint` · `statutoryRateId` · `grossUpIterations`.
8. 058 (`PATCH statutory-rates`) lấy khoá catalog ĐỘC QUYỀN trước kiểm `rate-in-use` (§3.7).
9. Mã/kind mới + FE census kind + i18n vi; SPEC-11 · DB-13 · API-18 cập nhật cùng commit.
10. Fixture đối soát TAY (GROSS đủ khoản + NET) — bảng tính độc lập ở `docs/QA/evidence/S15-PAYROLL-BE-3-DOI-SOAT.md`, int-spec so TỪNG ĐỒNG.
11. Chuyển 9 file int-spec v1 sang v2; viết lại `s13-payroll-qa1-arithmetic` theo v2.

**NGOÀI phạm vi** (đừng làm): route tạm ứng/đợt chi/ngân sách + map TAG trigger tạm ứng (BE-4) · băng «mẫu đã đổi» ở FE (FE-2 — BE-3 chỉ phơi dữ liệu) · export 017 cột theo thành phần (BE-5) · luật «nghỉ không lương ≥ 14 ngày ⇒ không đóng BH» (chưa có trong SPEC — §9 R3) · quy đổi thu nhập khi `pit_payer = COMPANY` (§13.7 E ghi ngoài v2) · CONTRACT cột `allowances` · `template-in-use` khi xoá/ngưng mẫu (BE-4 theo SPEC §12.1).

## 2. Số đo đã có (15/09, đọc code thật)

| Điểm | Bằng chứng |
| --- | --- |
| Đường tính v1 hiện là SQL cứng | `payroll-calc.repository.ts:124-254` `upsertLinesTx` (công thức base/allowance/deduction trong câu INSERT) ; `payroll-calc.service.ts:74-212` |
| Chưa có đường gắn mẫu | `packages/contracts/src/payroll.ts:402-423` create/update KHÔNG có `templateId`; `payroll-periods.service.ts:76-170` |
| Cột có sẵn | `payroll_periods.template_id` (`schema/payroll.ts`, mig 0572) · `payroll_period_lines.component_values_json/template_fingerprint/gross_up_iterations` (mig 0570, CHECK `grossup ∈ [0,30]`, fingerprint `^[0-9a-f]{64}$`) |
| Máy công thức BE-2 dùng lại được | `formula.graph.ts` `compileGraph` · `evaluatePass(graph, PassInputs, Budget)` (gọi `beginPass` mỗi lượt) · `Budget` hai trần 25.000/775.000 · `formula.statutory.ts` `toStatutoryValues` (kiểm bậc lần nữa) · `formula.fingerprint.ts` `formulaSetFingerprint` + `lineFingerprint(setFp, statutoryRateId)` · preview 054 `payroll-templates.service.ts:321-380` (khuôn fail-closed thành phần ngưng/xoá + hiệu tập hợp profile item) |
| Seed | `payroll-master-data.seeder.ts:155-370` — 19 hàng; `NGHI_KHONG_LUONG` `:192-197` kind `deduction` công thức `SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_UNPAID_LEAVE_DAYS / SYS_WORK_DAYS`; bậc TNCN `:418-426` (5tr 5% … >80tr 35%); rate `effective_from 2024-07-01`; `seedVersion = "v3"` `:437`; export `PAYROLL_SYSTEM_COMPONENTS` `:375` |
| Assert (7) chỉ log | `payroll-master-data.integrity.ts:196-225` `assertSystemRowContent` ném `Error` trong seeder — runner NUỐT |
| Catalog lock | `payroll-catalog.lock.ts` `payrollCatalogLockTx` (exclusive) ; census `test/foundation/payroll-catalog-lock-census.unit-spec.ts` ghim 045·047·050·052·053·seeder — **058 KHÔNG có** (`statutory-rates.service.ts:125-153`: `findTx forUpdate` → `inUseAtTx` → `updateTx`) |
| Trigger tạm ứng | `0572:650-760` (E) cho `Approved → Deducted` và `Deducted → Approved` chỉ khi nhả CẢ cặp; (F) FOR SHARE kỳ ∈ {CollectingData, Calculated}; CHECK `payroll_advances_consume_status_check` = `payroll_period_id IS NULL OR status = 'Deducted'` (`schema/payroll-disbursement.ts`) |
| Four-eyes thưởng/phạt | chỉ `decided_pair_check`; fixture TỰ DUYỆT thật: `payroll-be2-lifecycle.int-spec.ts:651,698` (`decided_by = created_by = adminId`) |
| Test v1 phụ thuộc calculate | đo 15/09: `payroll-be2-lifecycle` 26 lời gọi/6 assert tiền · `s13-payroll-qa1-arithmetic` 1/27 · `fsm-race` 7 · `payroll-be2-permission` 3 · `s13-payroll-db1-invariants` 2 · `idor-tenant` 2 · `scope-floor` 2 · `noti-audit` 1. **Không spec nào seed catalog** (`reconcileCompany` = 0 trong 8 file) |
| Seed catalog trong test | `MasterDataSeedRunner.reconcileCompany(companyId)` đã dùng ở `dashboard-payroll-cost.int-spec.ts:227` |
| PROD chưa chạy v1 | `S14-PROD-PAYROLLGRANT-1` `status: "todo"` (backlog) |
| Census mã lỗi | `payroll-error-code-census.unit-spec.ts` — key `PAYROLL_ERR_CODE` + mọi literal `payrollDetails("…")` phải có ca; FE `apps/app/src/routes/payroll/payroll-error-kind-census.spec.ts` — tập kind FE == BE (đọc `src/payroll/*.ts` phẳng, 3 hình dạng) + khoá i18n |
| Phiếu v1 | `payroll-payslips.repository.ts:124-186` bản đồ 7 item từ cột v1 ; bất biến `findItemSumMismatchesTx` ném trong tx (`payroll-payslips.service.ts:103-110`) |

## 3. Điểm KHÁC WO / tài liệu — đọc trước khi review

### 3.1 Backlog done_when #1 mâu thuẫn SPEC ⇒ theo SPEC (O-1)
`harness/backlog.mjs` BE-3 «kỳ KHÔNG template ⇒ đường v1 giữ nguyên (không hồi quy 375 ca cũ)» ≠ SPEC-11 §13.6 H + API-18 §326 «409 023 `template-missing` — KHÔNG rơi ngầm». Owner chốt SPEC. Sửa done_when cùng commit.

### 3.2 «payslip_items theo thành phần VISIBLE» vỡ bất biến ⇒ mọi thành phần góp net (O-3)
Thành phần ẩn vẫn cộng vào 4 nút (§13.6 E, chốt BE-2 MF4) ⇒ chỉ sinh item cho visible thì `SUM(items) ≠ gross − deduction + adjustment` ⇒ `findItemSumMismatchesTx` ném ⇒ 500 ở `generate`. Sửa done_when.

### 3.3 SPEC không nói «tham gia BH» hiện thực thế nào (O-2) · KPCĐ gắn theo BH
§13.7 B: «không tham gia ⇒ thành phần tương ứng = 0» nhưng công thức seed không đọc cờ nào (seeder `:150` đẩy việc cho engine). Chốt O-2. **KPCĐ gắn cờ BH** (không gắn cờ công đoàn): KPCĐ tính trên quỹ lương đóng BH; ghi rõ ở §13.7 C.

### 3.4 🔴 LỖI THUẾ — tính TNCN trên tiền nghỉ không lương (O-5)
`LUONG_CO_BAN` (DB-1B) cộng `SYS_UNPAID_LEAVE_DAYS` vào tử số; `NGHI_KHONG_LUONG` trừ lại với `kind = deduction`; `THU_NHAP_CHIU_THUE = MAX(TONG_THU_NHAP − TONG_BH_NV − GT_BAN_THAN − GT_NPT×NPT − Σtax_exempt, 0)` (§13.6 E, `formula.graph.ts:engineValue`) **không trừ `deduction`** ⇒ thu nhập tính thuế gồm cả tiền không nhận.
Ca A1 (`payroll-be2-lifecycle` docblock): base 22tr · 22 công · present 18 · unpaid 2 · phụ cấp 1tr · không BH · 0 NPT:
- hiện tại: TONG_THU_NHAP 21.000.000 ⇒ chịu thuế 10.000.000 ⇒ TNCN **750.000** ⇒ net 18.250.000
- đúng: thu nhập thật 19.000.000 ⇒ chịu thuế 8.000.000 ⇒ TNCN **550.000** ⇒ net 18.450.000 (thu thừa 200.000/tháng, mọi bất biến SQL xanh).

Vá O-5: `NGHI_KHONG_LUONG` → `earning`, công thức `-(SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_UNPAID_LEAVE_DAYS / SYS_WORK_DAYS)`. Làm tròn: `toMoney` dùng `ROUND_HALF_UP` của decimal.js = **đối xứng quanh 0** ⇒ `|giá trị mới| = giá trị cũ` từng xu ⇒ số đo 51.584 ca của DB-1B vẫn đúng (kiểm lại bằng ca unit so `abs`). Phiếu vẫn có dòng «Nghỉ không lương −X» (O1 v1 giữ nguyên ý nghĩa giải thích), `TONG_THU_NHAP` = thu nhập thật.

### 3.5 Gắn tạm ứng BẮT BUỘC `status = 'Deducted'` cùng câu — backlog BE-4 ghi sai thời điểm
BE-4 done_when «Deducted khi kỳ Approved» mâu thuẫn CHECK `payroll_advances_consume_status_check` (`payroll_period_id IS NULL OR status = 'Deducted'`) ⇒ bind mà giữ `Approved` = 23514. DB thắng: bind ⇒ `Deducted`, nhả ⇒ `Approved` + NULL cả cặp (trigger (E) chỉ cho đúng hình dạng này). BE-3 làm bind/nhả (máy tính lương là chủ đường này); sửa done_when BE-4 cùng commit. Không map TAG trigger tạm ứng ở BE-3 (chưa route nào ghi tạm ứng ⇒ race không tới được; BE-4 thêm route thì map — ghi vào done_when BE-4).

### 3.6 `details` của 021 KHÔNG mang «sai số còn lại»
SPEC-11 §12.1 hàng 021 ghi «details[] nêu userId + sai số còn lại» — sai số là SỐ TIỀN, trong khi 007 là route GHI gác bởi `('calculate','payroll-period')` (không phải cặp đọc tiền) và API-18 §485 cấm tiền trong `details` của lỗi máy công thức. ⇒ `details = { userId, iterations, reason }`; sửa §12.1.

### 3.7 058 đua với `calculate` — FOR SHARE một mình KHÔNG đủ
058 kiểm `inUseAtTx` (kỳ `∉ {Draft, CollectingData}`) rồi `UPDATE`. Không khoá catalog: 058 kiểm (kỳ còn `CollectingData` ⇒ không in-use) → `calculate` đọc rate `FOR SHARE` → 058 `UPDATE` CHỜ → `calculate` commit `Calculated` → 058 ghi đè số của bản vừa được dùng. ⇒ 058 lấy `payrollCatalogLockTx` (ĐỘC QUYỀN) TRƯỚC `findTx`; `calculate` lấy `pg_advisory_xact_lock_shared` cùng khoá ⇒ 058 chạy sau thấy `Calculated` ⇒ 409 033 `rate-in-use`.

### 3.8 Mã item di sản `PC_nnn` sẽ 422 ở v2
Hồ sơ mang item `PC_nnn` (backfill 0570 / helper `writeSalaryProfileWithItems`) ngoài mọi mẫu ⇒ hiệu tập hợp ⇒ 422 018 `profile-item-unknown-component` (đúng ý nợ MEDIUM-2). Fixture v1 có `allowances` khác rỗng (lifecycle subject «Ăn trưa 1tr») phải chuyển sang item `PHU_CAP`.

### 3.9 NPT đếm theo NGƯỜI, không theo HÀNG
`EXCLUDE` khoá `(company, user, full_name)` ⇒ một NPT có thể có hai hàng KHÔNG chồng cùng giao tháng (hết 10/09, lại từ 20/09) ⇒ `count(*)` đếm 2. Dùng `count(DISTINCT full_name)`.

### 3.10 Mẫu `scope = 'org_unit'` gắn vào kỳ — ngữ nghĩa chưa định nghĩa ⇒ fail-closed
Kỳ có ĐÚNG MỘT mẫu và tính cho CẢ công ty; áp mẫu của một đơn vị cho mọi người là sai tiền im lặng. ⇒ 002/004 từ chối mẫu `org_unit` ⇒ 409 023 kind MỚI `template-scope-unsupported` cho tới WO định nghĩa nhiều mẫu/kỳ.

### 3.11 `probation_salary` — thứ tự ưu tiên căn cứ BH
§13.7 B «Nhân sự thử việc: căn cứ = `probation_salary` nếu có». Chốt đọc: `SYS_INSURANCE_SALARY = COALESCE(probation_salary, insurance_salary, SYS_BASE_SALARY)`. Không tự suy thêm (không đọc ngày thử việc từ HR).

## 4. Thiết kế

### 4.1 Migration `0575_s15payrollbe3_nghi_earning_bp_four_eyes.sql` (journal idx 242, `when` 1717587364000)

Khuôn `0574` (một khối DO nguyên tử, `lock_timeout 5s`, assert `rolsuper OR rolbypassrls`):

0. **Preflight fail-loud**: trigger `salary_component_system_freeze` có mặt + bật (`O`) · `count(payroll_period_lines WHERE template_fingerprint IS NOT NULL) = 0` (BE-3 chưa từng ghi — đổi nghĩa lịch sử phải owner chốt) · `NGHI_KHONG_LUONG` hệ thống mang chuỗi/kind THỨ BA (≠ cũ, ≠ mới) ⇒ RAISE · `payroll_template_components.formula_override IS NOT NULL` trên component `NGHI_KHONG_LUONG` hệ thống ⇒ **RAISE** (ghi đè dương + kind `earning` = CỘNG tiền) · `bonus_penalties` `status='Approved' AND decided_by = created_by` ⇒ RAISE kèm số hàng.
1. Vá: đếm `v_before` (kind `deduction` + chuỗi cũ CHÍNH XÁC) → `IF v_before > 0`: `DISABLE TRIGGER` → `UPDATE … SET kind='earning', formula=v_new WHERE is_system AND code='NGHI_KHONG_LUONG' AND kind='deduction' AND formula=v_old` → `ENABLE TRIGGER` → `v_n = v_before` hoặc RAISE; `ELSE v_n := 0` (bài học L-2 DB-1B).
2. `ALTER TABLE bonus_penalties ADD CONSTRAINT bonus_penalties_four_eyes_check CHECK (status <> 'Approved' OR decided_by IS DISTINCT FROM created_by)` (validated — preflight đã chứng minh 0 vi phạm). Tên có tiền tố bảng; `IS DISTINCT FROM` để `decided_by` NULL (FK SET NULL khi xoá user) không nổ.
3. Verify: 0 hàng hệ thống `NGHI_KHONG_LUONG` khác `(earning, v_new)` · trigger bật lại · `pg_get_constraintdef` khớp chuỗi.

Drizzle: `schema/payroll.ts` thêm `check("bonus_penalties_four_eyes_check", …)`. Seeder: hằng `NGHI_KHONG_LUONG` → `earning` + chuỗi mới, `seedVersion = "v4"`. `mapPayrollPgError`: `bonus_penalties_four_eyes_check` ⇒ 409 **012** kind `self-approval` (literal có sẵn của 027 — đo lúc thi công).

### 4.2 Gắn mẫu vào kỳ — 002 · 004

- Contracts: `createPayrollPeriodSchema.templateId?: uuid` · `updatePayrollPeriodSchema.templateId?: uuid` (KHÔNG `.nullable()` — không đường gỡ, cùng lý do `attendancePeriodId`); `payrollPeriodSchema.templateId: uuid | null`.
- Service `assertBindableTemplateTx(tx, companyId, templateId)` (dùng chung 002/004), chạy SAU `lockForUpdateTx` kỳ (004) và SAU `pg_advisory_xact_lock_shared('payroll-catalog:'+company)`:
  1. `templatesRepo.findTx` (live) — không có ⇒ **404 010** sentinel (không oracle tenant khác).
  2. `!isActive` ⇒ 409 023 `template-inactive` · `scope <> 'company'` ⇒ 409 023 `template-scope-unsupported`.
  3. `componentsTx` → thành phần ngưng/xoá mềm ⇒ 422 018 `template-component-unknown` (khuôn 054) → `compileOrThrow(rows, requireEngineNodes=true)` ⇒ 018/019.
- 004 thứ tự: `lockForUpdateTx` → nếu `dto.templateId !== undefined` và kỳ `∉ {Draft, CollectingData}` ⇒ **409 023 `template-locked`** (TRƯỚC nhánh 001 chung, kẻo 023 thành mã chết) → nhánh 001 cũ cho payload còn lại → validate → ghi.
- Audit `create`/`update`: `after.templateId` (id, không tiền).

### 4.3 `calculate` (007) — thứ tự trong MỘT transaction

```text
 1  resolveActor('periodCalculate')                                    (ngoài tx — deny 0 side-effect, giữ nguyên)
 2  lockForUpdateTx(period)                  ⇒ 404 010
 3  FROZEN ⇒ 409 003 · FSM ⇒ 409 001                                   (giữ nguyên thứ tự hiện tại)
 4  attendance gắn + locked ⇒ 409 002                                  (giữ nguyên)
 5  period.templateId NULL ⇒ 409 023 template-missing
 6  pg_advisory_xact_lock_shared('payroll-catalog:'+company)            (sau khoá kỳ — cùng thứ tự với 004)
 7  template live? (xoá mềm ⇒ 409 023 template-missing, details.reason='template-deleted') · !isActive ⇒ 409 023 template-inactive
    · scope ≠ company ⇒ 409 023 template-scope-unsupported
 8  componentsTx(+isSystem) → ngưng/xoá ⇒ 422 018 template-component-unknown
    → drift hàng is_system (§4.8) ⇒ 422 018 system-component-drift
    → compileGraph(requireEngineNodes)  ⇒ 422 018 / 019   (kiểm vòng LẦN HAI lúc tính)
 9  statutory effectiveAtTx(lastDay) FOR SHARE ⇒ không có: 422 022 statutory-rate-missing
    → toStatutoryValues (assertBracketsContinuous) ⇒ 422 022 statutory-rate-incomplete
10  releaseConsumedTx(bonus) · releaseAdvancesTx            [bọc mapPayrollPgError]   (R6 DB-1B: SAU khoá kỳ)
11  đọc song song: alive · effectiveProfilesV2 · computeInputsTx · itemsByProfile · settingsByUser · dependentsByUser
    → eligible rỗng ⇒ 422 009 · workDays ≤ 0 ⇒ 422 009                (giữ nguyên)
12  hiệu tập hợp item hồ sơ ↔ profile_item của mẫu ⇒ 422 018 profile-item-unknown-component {userId, componentCodes}
13  lockPickedBonusPenaltiesTx (+amount) · lockPickedAdvancesTx      FOR UPDATE
14  evaluate TS từng dòng (§4.4–4.5) — FormulaError ⇒ formulaErrorToHttp(+userId) · 021 · 020 negative-total
15  upsertLinesV2Tx (một câu)  [mapPayrollPgError] · softDeleteStaleLinesTx · bindConsumedTx · bindAdvancesTx [map]
16  applyTransitionTx(calculate) · countLiveLinesTx · audit (KHÔNG tiền)
```

Số câu SQL O(1) theo số nhân sự (§19.1): khoá kỳ · attendance · lock shared · template · components · system rows (gộp vào components, không câu riêng) · rate · 2 release · 6 đọc · 2 pick · 1 upsert · 1 soft delete · 2 bind · transition · count · audit. **Cấm** truy vấn trong vòng lặp per-dòng — census tĩnh ở §6.3.

Audit `after`: `{ status, lineCount, consumedBonusPenalties, deductedAdvances, templateId, statutoryRateId, netLines }` — không số tiền.

### 4.4 Đầu vào `SYS_*` của MỘT dòng (lượt THẬT)

| Biến | Giá trị | Ghi chú |
| --- | --- | --- |
| `SYS_BASE_SALARY` | GROSS: `base_salary` · NET: `b*` | chuỗi numeric ⇒ `new D(str)` |
| `SYS_INSURANCE_SALARY` | `COALESCE(probation_salary, insurance_salary, SYS_BASE_SALARY)` | §3.11; NET ⇒ `b` (O-4) |
| `SYS_PROBATION_SALARY` | `probation_salary ?? 0` | |
| `SYS_PAY_RATIO` | `pay_ratio_pct` | |
| `SYS_WORK_DAYS` · `SYS_PRESENT_DAYS` · `SYS_PAID_LEAVE_DAYS` · `SYS_UNPAID_LEAVE_DAYS` · `SYS_LATE_MINUTES` | `computeInputsTx` (người không có công ⇒ 0 như v1) | `PayrollUserInputs` là `number` từ 2-chữ-số-thập-phân ⇒ `new D(n.toFixed(2))` (khứ hồi double của chuỗi 2 chữ số là chính xác); `late_minutes` nguyên |
| `SYS_PRORATE` | `intermediate(MIN((present + unpaid) / work, 1))` | định nghĩa §13.4 v1 |
| `SYS_DAILY_RATE` | `intermediate(SYS_BASE_SALARY / work)` | §13.4 v1 `dailyRate` |
| `SYS_DEPENDENTS` | `count(DISTINCT full_name)` NPT giao `[01, cuối tháng]` | §3.9 |
| `SYS_BONUS_AMOUNT` · `SYS_PENALTY_AMOUNT` | Σ tập đã khoá bước 13 theo `kind` | decimal |
| `SYS_ADVANCE_AMOUNT` | Σ tạm ứng đã khoá bước 13 | decimal |

`profileItems[code]` = `amount` item `is_active` + `deleted_at IS NULL` của hồ sơ hiệu lực (code thuộc mẫu — bước 12 đã chặn mã lạ). Thành phần `profile_item` không có item ⇒ 0 (định nghĩa BE-2).

**Statutory theo dòng (O-2)**: sao `StatutoryValues` của kỳ, thay `refs` theo cờ; `caps` · `pitBrackets` · `GT_*` giữ nguyên. Hàm thuần `participationStatutory(base, {socialInsurance, union})` — bất biến: không đột biến object dùng chung (mỗi dòng một object mới).

### 4.5 Gross-up NET (O-4) — hàm thuần `grossUp()`

```text
N  = base_salary (hồ sơ NET — cột mang NET mục tiêu, §13.8)
I(b) = đầu vào «công đủ»: BASE=b · INSURANCE=COALESCE(probation, insurance, b) · PAY_RATIO=100 · PRESENT=WORK · PAID=0 · UNPAID=0
       · LATE=0 · PRORATE=1 · DAILY_RATE=b/WORK · BONUS=PENALTY=ADVANCE=0 · DEPENDENTS/profileItems/participation/pitPayer THẬT
F(b) = v[TONG_THU_NHAP] − v[TONG_KHAU_TRU]    (v = evaluatePass(graph, I(b), budget), KHÔNG clamp, KHÔNG adjustment)
b₀ = N
for k in 1..30:  f = F(b_{k-1});  d = N − f
                 if |d| ≤ 1 ⇒ b* = b_{k-1}, iterations = k, DỪNG
                 b_k = b_{k-1} + d ;  b_k ≤ 0 ⇒ 422 021 {userId, iterations:k, reason:'non-positive-base'}
hết 30 ⇒ 422 021 {userId, iterations:30, reason:'not-converged'}
lượt cuối: evaluatePass(graph, THẬT với BASE=b*, INSURANCE fallback b*)   — pass thứ ≤ 31 trên CÙNG Budget
```

`b` luôn scale 2 (N scale 2, `d` là hiệu hai giá trị scale 2). Một `Budget` cho cả dòng ⇒ hai trần đồng thời. `F` tăng từng khúc với độ dốc ∈ (0, 1] trên mẫu mặc định ⇒ lặp co; mẫu tuỳ biến có `IF` có thể dao động ⇒ 021 là hành vi đã chốt (§13.8).

### 4.6 Snapshot + map cột

`component_values_json` (camelCase, mọi tiền là CHUỖI scale 2):

```jsonc
{ "engine": "v2", "templateId": "…", "templateCode": "MAU_MAC_DINH", "formulaSetFingerprint": "…",
  "statutoryRateId": "…", "statutoryEffectiveFrom": "2024-07-01",
  "salaryType": "GROSS|NET", "pitPayer": "EMPLOYEE|COMPANY",
  "participation": { "socialInsurance": false, "union": false },
  "dependents": 2,
  "rates": { "TL_BHXH_NV": "8.00", …, "GT_NPT": "4400000.00" },      // SAU zero theo cờ
  "caps": { "BHXH": "…", "BHYT": "…", "BHTN": "…" }, "pitBrackets": [ { "upTo": "5000000", "rate": "5" }, … ],
  "sys": { "SYS_BASE_SALARY": "…", … },                                // lượt THẬT
  "grossUp": null | { "targetNet": "…", "base": "…", "iterations": 17 },
  "components": [ { "code", "label", "kind", "valueType", "isVisible", "sortOrder", "pitDeductible", "value" } ] }
```

| Cột dòng | v2 | Vì sao |
| --- | --- | --- |
| `gross` | `v[TONG_THU_NHAP]` | |
| `deduction_amount` | `v[TONG_KHAU_TRU]` | |
| `net` | `GREATEST(round(gross − deduction + adjustment, 2), 0)` **Ở SQL** | §3.9 SPEC — clamp không lên TS |
| `base_amount` | `toMoney(SYS_BASE_SALARY × SYS_PRORATE)` (lượt thật) | §13.8 «b ghi vào base_amount sau pro-rate»; **thông tin**, không phải nguồn của gross |
| `allowance_amount` | Σ `profileItems` | thông tin |
| `bonus_amount` · `penalty_amount` | `SYS_BONUS_AMOUNT` · `SYS_PENALTY_AMOUNT` | thông tin |
| `template_fingerprint` | `lineFingerprint(formulaSetFingerprint, statutoryRateId)` | §13.6 G |
| `gross_up_iterations` | NET: `iterations` (1..30) · GROSS: NULL | CHECK 0..30 |
| `input_snapshot_json` | meta §13.4 + `inputs` như v1 | CHECK `<> '{}'` |

Cổng trước bind: `gross < 0` hoặc `deduction < 0` ⇒ **422 020 kind MỚI `negative-total`** `{userId, component}` (CHECK `amounts_check` là lưới cuối — không để 23514 thành 500). `exceedsNumeric18_2` đã có trong `evaluatePass`.

### 4.7 Ghi dòng — `upsertLinesV2Tx` (thay `upsertLinesTx` v1)

Một câu `INSERT … SELECT FROM jsonb_to_recordset($lines::jsonb) … ON CONFLICT (company_id, payroll_period_id, user_id) WHERE deleted_at IS NULL DO UPDATE`. Giá trị tiền đi vào dạng **chuỗi JSON** khai `numeric` trong recordset (ép kiểu từ text — không qua số thực JSON). Giữ nguyên 3 luật cấp file của v1: L2 set-based · L3 `ON CONFLICT … WHERE deleted_at IS NULL` · hồi sinh `adjustment_*` từ hàng xoá mềm (`LEFT JOIN LATERAL old`) · `DO UPDATE` giữ `adjustment_*` hàng sống · `net` hai nhánh cùng công thức SQL. `salary_profile_id` từ TS (hồ sơ hiệu lực đọc ở bước 11 — không LATERAL lần hai). Xoá hẳn phần công thức v1 (`base`/`allw`/`ded` LATERAL) — O-1.

### 4.8 Cổng drift hàng hệ thống

Tách từ `payroll-master-data.integrity.ts` một hàm THUẦN `systemRowDrift(rows, expected): string[]` (không ném); seeder assert (7) giữ hành vi ném trên nó. Calc: với mọi hàng của mẫu có `isSystem` và `code ∈ PAYROLL_SYSTEM_COMPONENTS` so `kind · valueType · catalogFormula · pitDeductible` ⇒ lệch ⇒ 422 018 `system-component-drift` `{components: "CODE1,CODE2"}` (không tiền, không chuỗi công thức). `formula_override` của MẪU là tuỳ biến hợp lệ — KHÔNG so. `componentsTx` thêm cột `isSystem` (additive).

### 4.9 Thưởng/phạt + tạm ứng

- Bonus: giữ `releaseConsumedTx` · `lockPickedBonusPenaltiesTx` (thêm `amount` chuỗi) · `bindConsumedTx`.
- Tạm ứng (`payroll-calc.repository.ts`, cùng khuôn):
  - `releaseAdvancesTx`: `UPDATE payroll_advances SET status='Approved', payroll_period_id=NULL, consumed_at=NULL WHERE company_id=$c AND payroll_period_id=$p AND status='Deducted'`.
  - `lockPickedAdvancesTx`: `status='Approved' AND deduct_period_month=$m AND payroll_period_id IS NULL AND deleted_at IS NULL AND user_id = ANY(eligible) ORDER BY id FOR UPDATE`.
  - `bindAdvancesTx`: `SET status='Deducted', payroll_period_id=$p, consumed_at=now() WHERE company_id AND id = ANY(ids)`.
- Tạm ứng của người KHÔNG đủ điều kiện: không khoá, không bind (khuôn B4 bonus).

### 4.10 Sinh phiếu (013)

`insertItemsForPeriodTx` hai CTE nguồn loại trừ nhau theo `pl.component_values_json ? 'components'`:
- **v1** (không có khoá): bản đồ 7 dòng HIỆN TẠI, không đổi.
- **v2**: `jsonb_array_elements(pl.component_values_json->'components') WITH ORDINALITY` ⇒ `earning`/`tax_exempt` ⇒ `item_type` `earning`/`allowance`, `amount = +value` · `deduction`/`statutory_employee` ⇒ `deduction`, `−value` · `tax` ⇒ `deduction`, `−value` CHỈ khi `component_values_json->>'pitPayer' = 'EMPLOYEE'` · khác ⇒ bỏ; chỉ `value <> 0`; `label` · `sort_order = ord*10`; `meta = {componentCode, kind, isVisible}`; cộng dòng `adjustment` (sort 1.000.000) như v1.
- `findItemSumMismatchesTx` giữ nguyên — nay là chốt của CẢ hai nhánh.

### 4.11 Mã / kind mới

| Mã | HTTP | kind | Nơi ném |
| --- | --- | --- | --- |
| 023 | 409 | `template-missing` · `template-inactive` · `template-locked` · **`template-scope-unsupported`** | calc · 002/004 |
| 018 | 422 | **`system-component-drift`** · `profile-item-unknown-component` (tái dùng, thêm `userId`) · `template-component-unknown` (tái dùng) | calc · 002/004 |
| 020 | 422 | **`negative-total`** | calc |
| **021** | 422 | `grossup-not-converged` — key MỚI `PAYROLL_ERR_CODE.GROSSUP_NOT_CONVERGED` | calc |
| 022 | 422 | **`statutory-rate-missing`** | calc |
| 012 | 409 | `self-approval` từ CHECK `bonus_penalties_four_eyes_check` | map pg |

Mọi kind là literal `payrollDetails("…")` tại chỗ ném (census). FE: `PAYROLL_ERROR_KINDS` + i18n vi cho 7 kind mới (4 kind 023 + `system-component-drift` + `negative-total` + `grossup-not-converged` + `statutory-rate-missing` — đo tập thực tế bằng census lúc thi công). SPEC-11 §12.1 · API-18 bảng lỗi cùng commit.

### 4.12 DTO dòng (008) — additive

`payrollPeriodLineSchema` thêm `.optional()`: `components: Array<{code,label,kind,isVisible,sortOrder,value:number}>` · `grossUpIterations: number|null` — **CHỈ khi `actor.canSeeMoney`** (vắng khoá, không null) · `templateFingerprint: string|null` · `statutoryRateId: string|null` (không tiền, luôn có). `value` qua `num()` như cột tiền hiện có.

## 5. File

| File | Việc | Dòng ước |
| --- | --- | --- |
| `apps/api/migrations/0575_s15payrollbe3_nghi_earning_bp_four_eyes.sql` + `meta/_journal.json` | §4.1 | ~200 |
| `apps/api/src/db/schema/payroll.ts` | CHECK four-eyes | +5 |
| `apps/api/src/payroll/payroll-line-engine.ts` **MỚI** | thuần TS: `buildSysInputs` · `normalizedGrossUpInputs` · `participationStatutory` · `grossUp` · `evaluateLine` · `snapshotOf` · map cột | ≤ 400 |
| `apps/api/src/payroll/payroll-line-engine.spec.ts` **MỚI** | unit RED §6.1 | |
| `apps/api/src/payroll/payroll-calc-inputs.repository.ts` **MỚI** | `effectiveProfilesV2Tx` · `itemsByProfileTx` · `settingsByUserTx` · `dependentsByUserTx` · `statutoryEffectiveAtTx` (FOR SHARE) | ≤ 300 |
| `apps/api/src/payroll/payroll-calc.service.ts` | §4.3 điều phối — tách `payroll-calc-gates.ts` nếu > 400 | ~400 |
| `apps/api/src/payroll/payroll-calc.repository.ts` | `upsertLinesV2Tx` thay v1 · bonus `amount` · 3 hàm tạm ứng | ~480 |
| `apps/api/src/payroll/payroll-catalog.lock.ts` | `payrollCatalogSharedLockTx` | +10 |
| `apps/api/src/payroll/payroll-periods.service.ts` + `.repository.ts` | §4.2 | +80 |
| `apps/api/src/payroll/payroll-template-binding.ts` **MỚI** | `assertBindableTemplateTx` dùng chung 002/004/calc bước 7–8 | ≤ 150 |
| `apps/api/src/payroll/payroll-templates.repository.ts` | `componentsTx` + `isSystem` | +2 |
| `apps/api/src/payroll/payroll-master-data.integrity.ts` · `.seeder.ts` | `systemRowDrift` thuần · hằng NGHI v4 | ±30 |
| `apps/api/src/payroll/statutory-rates.service.ts` | 058 khoá catalog | +2 |
| `apps/api/src/payroll/payroll-payslips.repository.ts` | §4.10 | +50 |
| `apps/api/src/payroll/payroll.errors.ts` · `payroll.mapper.ts` | §4.11 · §4.12 · map four-eyes | +60 |
| `packages/contracts/src/payroll.ts` | templateId ×3 · line DTO | +25 |
| `apps/app/src/routes/payroll/payroll-errors.ts` · `apps/app/src/i18n/locales/vi/payroll*` | kind + nhãn | +20 |
| `test/foundation/payroll-catalog-lock-census.unit-spec.ts` | + 058 exclusive · calc/002/004 shared | |
| `docs/SPEC/SPEC-11 PAYROLL.md` · `docs/DB/DB-13…` · `docs/API Design/API-18…` | §0 O-1..O-5 · §3.6 · §3.10 · §3.11 · kind | |
| `docs/QA/evidence/S15-PAYROLL-BE-3-DOI-SOAT.md` **MỚI** | bảng tính tay | |
| `harness/backlog.mjs` | paths + done_when BE-3/BE-4 | |

## 6. RED-first

### 6.1 Unit (không DB) — `payroll-line-engine.spec.ts`, đồ thị THẬT từ `PAYROLL_SYSTEM_COMPONENTS` (hằng v4) + bản tỉ lệ seed

Số kỳ vọng lấy từ bảng tính ĐỘC LẬP (script Python `decimal` ở scratchpad, dán vào evidence) — KHÔNG sinh từ engine.

1. **GROSS đủ khoản** (NV-G): base lẻ `19.999.999,99` · work 22 · present 19,5 · unpaid 1,5 · PHU_CAP `1.005.000` · thưởng `2.385.000` · phạt `300.000` · tạm ứng `1.000.000` · BH + công đoàn · lương BH `15.000.000` · 2 NPT · EMPLOYEE ⇒ assert TỪNG thành phần + 4 nút + net-trước-clamp, thuế rơi bậc ≥ 3.
2. **NET đủ khoản** (NV-N): N `25.000.000` · BH · 1 NPT · present 20 / unpaid 2 · thưởng ⇒ `b*`, `iterations`, lượt cuối từng thành phần; `F(b*)` trong ±1 đ; net thật < N đúng bằng phần nghỉ + thưởng/phạt đã tính.
3. §21.1 ca 2 — bốn vế ĐỘC LẬP: (a) đổi tỉ lệ DN ⇒ net không đổi; (b) `tax_exempt` có trong TONG_THU_NHAP và bị trừ khỏi chịu thuế (thêm thành phần tax_exempt vào đồ thị test); (c) bật/tắt `joins_union` ⇒ `THU_NHAP_CHIU_THUE` không đổi, net đổi đúng `DOAN_PHI`; (d) `pit_payer` COMPANY ⇒ TONG_KHAU_TRU giảm đúng TNCN, TNCN vẫn trong components.
4. O-2: `joins_social_insurance=false` ⇒ 7 thành phần BH/KPCĐ = `0.00` VẪN có mặt; `true` ⇒ khác 0.
5. O-4: NET nửa tháng (present 11/22) ⇒ `b*` BẰNG ca công đủ (gross-up độc lập công) và net thật ≈ nửa — đột biến «lặp trên đầu vào thật» làm ca này đỏ.
6. O-4: `insurance_salary` NULL, NET ⇒ `SYS_INSURANCE_SALARY = b*` (≠ N).
7. Gross-up dao động (mẫu test có `IF(SYS_BASE_SALARY > X, …)` đảo chiều) ⇒ `grossup-not-converged`, `iterations = 30`; `b ≤ 0` ⇒ `non-positive-base`.
8. §3.4: `NGHI_KHONG_LUONG` âm ⇒ ca A1 TNCN `550.000`; lưới làm tròn: `|v4| == v3` trên ≥ 500 ca biên `.xx5`.
9. `negative-total`: mẫu test có earning âm vượt ⇒ lỗi trước khi ra cột.
10. Budget: một `Budget`/dòng, NET 31 lượt không vượt 775.000 trên mẫu mặc định; trần nhỏ ⇒ `formula-budget-exceeded` `pass` đúng.
11. `participationStatutory` không đột biến object gốc (freeze + so sánh).
12. `SYS_DEPENDENTS` truyền vào `GT_NPT × n`.

### 6.2 Integration (`LANE_DB=mediaos_be3`) — file mới `s15-payroll-be3-calculate.int-spec.ts` · `s15-payroll-be3-binding.int-spec.ts` · `s15-payroll-be3-migration.int-spec.ts`

- **Binding**: 002/004 ALLOW gắn `MAU_MAC_DINH` (`=== 201/200`, DTO có `templateId`) · 404 mẫu tenant khác · 409 `template-inactive` · 409 `template-scope-unsupported` · 422 018 mẫu thiếu nút · 004 ở `Calculated` ⇒ 409 `template-locked` (KHÔNG 001) · 004 không `templateId` ở `Calculated` ⇒ vẫn 001.
- **Cổng calc** (mỗi ca: kỳ GIỮ `CollectingData`, `count(lines)=0`, consume không đổi): 023 `template-missing` · xoá mềm mẫu ⇒ 023 · ngưng mẫu ⇒ 023 inactive · xoá bản tỉ lệ ⇒ 022 `statutory-rate-missing` · bậc hỏng ghi thẳng DB ⇒ 022 incomplete · xoá link nút engine thẳng DB ⇒ 018 · vòng ghi thẳng `formula_override` ⇒ 019 · sửa `kind` hàng hệ thống (tắt trigger trong fixture) ⇒ 018 `system-component-drift` · item `PC_001` ⇒ 018 `profile-item-unknown-component` · 021 (mẫu dao động) ⇒ **0 dòng** · công ty CHƯA seed catalog + mẫu tự tạo gắn thẳng DB ⇒ 422 018 (không 200 net=0).
- **Đối soát tay**: NV-G + NV-N qua ĐƯỜNG THẬT (công/phép/thưởng/phạt/tạm ứng/NPT/settings gieo DB) ⇒ `components[].value`, `gross`, `deduction_amount`, `net`, `gross_up_iterations`, `template_fingerprint` so CHUỖI với evidence. Kèm biên: NPT hết hạn giữa kỳ (vẫn đếm) · NPT hai hàng không chồng cùng tháng (đếm 1) · hai bản tỉ lệ `effective_from` khác nhau (kỳ dùng bản ≤ cuối kỳ) · lương BH vượt trần.
- **Sửa công thức SAU Calculated**: đọc lại ⇒ `component_values_json` y nguyên; tính lại ⇒ số + fingerprint đổi.
- **Tạm ứng**: bind ⇒ `Deducted` + cặp; tính lại ⇒ không nhân đôi, vẫn `Deducted`; nhân sự không đủ điều kiện ⇒ không bind.
- **058 race**: giữ tx calc mở (khoá shared) ⇒ 058 chờ; commit ⇒ 058 409 033.
- **Phiếu v2**: generate ⇒ `SUM(items) = gross − deduction + adjustment` · `meta.componentCode` · COMPANY ⇒ không item thuế · ẩn cột ⇒ item vẫn có, `meta.isVisible=false` · không item `statutory_employer`/`aggregate`.
- **Migration 0575**: hàng hệ thống `NGHI_KHONG_LUONG` = `(earning, v_new)` mọi công ty · trigger bật · INSERT/UPDATE `Approved` tự duyệt ⇒ 23514 đúng TÊN · qua API 027 tự duyệt vẫn 409 012 · replay khối DO trong `BEGIN … ROLLBACK` cả nhánh IF lẫn ELSE.
- **Masking 008**: role `view-line` thiếu tiền (nếu có) ⇒ vắng `components`; đủ ⇒ có.

### 6.3 Census tĩnh

- Khoá catalog: 058 exclusive trước DB touch; calc/002/004 shared sau `lockForUpdateTx`.
- «Không truy vấn trong vòng lặp dòng»: `payroll-line-engine.ts` KHÔNG import `drizzle-orm`/`db.service` (thuần) — ca unit đọc import.
- `payroll-formula-architecture-census` phủ thêm `payroll-line-engine.ts` (cấm `Number(`/`parseFloat` trên tiền — ngoại lệ ghi rõ cho `toFixed(2)` của ngày công).

### 6.4 Đột biến (mỗi cái chỉ làm đỏ ca của nó, revert sau)

(a) bỏ zero theo tham gia BH · (b) gross-up trên đầu vào thật · (c) insurance fallback N · (d) `count(*)` NPT · (e) bỏ cổng drift · (f) item gồm `statutory_employer` · (g) tax item bất kể pitPayer · (h) 058 bỏ khoá · (i) `NGHI_KHONG_LUONG` giữ `deduction` (ca A1 TNCN 750.000) · (j) clamp net ở TS rồi bỏ SQL (ca ghi thẳng `net < 0` repo ⇒ DB từ chối) · (k) template-locked kiểm SAU nhánh 001.

## 7. Chuyển test v1

| File | Việc |
| --- | --- |
| `payroll-be2-lifecycle` | `beforeAll` `reconcileCompany(A)`; `newPeriodCollecting` gắn `MAU_MAC_DINH` qua 004; subject allowances → item `PHU_CAP 1.000.000` (allowances `[]`); A1 viết lại theo v2 (TONG_THU_NHAP 19.000.000 · TNCN 550.000 · net 18.450.000 — đối chiếu evidence); C1/C2 `created_by` = officer (four-eyes CHECK) |
| `noti-audit` · `permission` · `idor-tenant` · `scope-floor` | seed catalog + gắn mẫu ở chỗ tạo kỳ; không assert tiền |
| `fsm-race` · `s13-payroll-db1-invariants` | INSERT kỳ thẳng ⇒ thêm `template_id` (subquery `MAU_MAC_DINH`) |
| `s13-payroll-qa1-arithmetic` | v2 + `pit_payer='COMPANY'` để TNCN không vào net (cô lập phép pro-rate/sàn/làm tròn — ghi rõ docblock); kỳ vọng tính lại bằng số học chính xác; ca hoà nửa xu theo v2 (lệch v1 0,01 là ĐÚNG) |
| `s15-payroll-db1b-invariants:130-149` | oracle `NGHI_KHONG_LUONG` so `abs` |
| `payroll-be1-legacy-items:104` · `formula.graph.spec.ts:51` | đo lúc thi công (fixture catalog cục bộ) |
| `bonus-penalty-transition` | ca mới four-eyes (INSERT/UPDATE tự duyệt ⇒ tên CHECK) |

## 8. Cổng & bằng chứng

`pnpm --filter @mediaos/contracts build` → typecheck/lint api + app → unit payroll + formula → `bash harness/check.sh --lane-db=be3` (KHÔNG banner) → coverage `src/payroll/` ≥ 85%, `formula/` ≥ 95% → FE `payroll-error-kind-census` + `payroll-wiring` → route census KHÔNG đổi (0 route mới) → migrate-from-empty head `0575` → đột biến §6.4 → reviewer tuần tự. Dán số đo vào §11.

## 9. Rủi ro

| # | Rủi ro | Xử lý |
| --- | --- | --- |
| R1 | Seeder build CŨ (≤ BE-2) chạy sau `0575` seed công ty MỚI bằng `NGHI deduction` | cổng drift §4.8 ⇒ 422 018 (không tính sai im lặng); deploy BE + migrate cùng lượt |
| R2 | Kỳ v1 `Calculated` trên lane/dev bấm tính lại ⇒ 023 | đúng O-1; PROD 0 kỳ v1 |
| R3 | Luật «nghỉ không lương ≥ 14 ngày/tháng ⇒ không đóng BH» chưa có | ngoài SPEC — ghi nợ cho owner (§3.11 SPEC: owner chịu trách nhiệm số) |
| R4 | `SYS_INSURANCE_SALARY` đọc `probation_salary` trước `insurance_salary` | chốt đọc §3.11 ở SPEC §13.7 B; ca test ghim |
| R5 | Gross-up mẫu tuỳ biến không đơn điệu | 021 + 0 dòng (đã chốt §13.8) |
| R6 | Thứ tự khoá: kỳ FOR UPDATE → advisory shared → rate FOR SHARE → bonus/advance FOR UPDATE | writer độc quyền (045–053, 058, seeder) không chạm `payroll_periods` ⇒ không chu trình; census khoá ghim |
| R7 | Payload `jsonb_to_recordset` 500 dòng × snapshot ~3KB ≈ 1,5MB | trong trần `pg` param; đo thời gian ca 500 dòng ở QA-1 |
| R8 | FE hiện chưa có picker mẫu (FE-2) ⇒ UI tính lương 409 023 tới FE-2 | chấp nhận — wave chưa lên PROD; 004 gắn được qua API |
| R9 | Rollback artifact BE qua mốc `0575` | BE cũ không đọc catalog ⇒ an toàn; BE cũ seed công ty mới ⇒ R1 |

## 10. Chi phí & reviewer

Ước tính (khuôn BE-2 ~$2,2k): code + test ~$500–800 · check.sh + đột biến ~$150 · plan-review 1 vòng ~$80 · 3 reviewer tuần tự ~$250–350 ⇒ **~$1,0–1,4k**. Reviewer: security (bề mặt 002/004/007/013 + 0575) → silent-failure (fail-open tiền: 0 âm thầm, clamp, drift) → database (0575 + UPSERT, prompt hẹp). Chỉ hỏi thứ không tự đo được.

## 11. Bằng chứng

_(điền khi thi công)_
