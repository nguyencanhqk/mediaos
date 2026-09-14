# S15-PAYROLL-BE-2 — micro-plan v2 (vùng ĐỎ · FULL gate · Opus)

> **WO:** BE track B — catalog thành phần lương (044–048) · mẫu bảng lương (049–054) · tỉ lệ luật định
> (055–058) + **máy công thức** (parser/evaluator `decimal.js`, đồ thị phụ thuộc, ngân sách node) + trả nợ DB-1.
> **Nguồn sự thật:** SPEC-11 §3.9 · §8.2 C1 · §11.3 · §12.1 · §13.4 · §13.6 A–I · §13.7 · §15.1 Track B · §18.1 ·
> §21.1 B · API-18 §5b/§5.1b/§6.5b · DB-13 §13.4–§13.7 · DECISIONS-14 §2 · khuôn `docs/plans/S15-PAYROLL-BE-1.md`.
>
> **🔴 TRẠNG THÁI PLAN-REVIEW:** vòng 1 (13/09/2026) = **BLOCK — 2 BLOCKER + 18 MUST-FIX**. Bản này vá đủ;
> **B1 tách sang WO mới `S15-PAYROLL-DB-1B`** (cần migration — ngoài `paths` của BE-2), B2 vá trong seeder.
> Cả hai BLOCKER đã **tự đo lại và XÁC NHẬN**. **KHÔNG mở vòng 2.** Bảng đầy đủ: `S15-PAYROLL-BE-2-review.md`.
>
> **Số đo (13/09/2026, master `879c84d0`):** `PAYROLL_ROUTE_PAIRS` = 43 · `PAYROLL_ERR_CODE` = 19 · `MIN_COVERED_COUNT`
> = 590 · `MONEY_FREE_ROUTES` = 13 · `seedVersion = "v1"` · `packages/contracts/src/payroll.ts` = 809 dòng (VƯỢT
> trần) · `decimal.js@10.6.0` có trong lockfile (bắc cầu) · 17 cặp v2 đã seed (`0571:37-42`) + đã append allowlist ·
> `AUDIT_OBJECT_TYPES` có `salary_component`/`payroll_template`/`payroll_statutory_rate` · FK composite
> `payroll_templates_org_unit_id_company_fk` · `payroll_template_components_{template,component}_id_company_fk`
> (`0570:552,607,609`) · trigger `salary_component_system_freeze` (`0570:416-445`, message tiền tố `salary_components:`)
> · trigger thưởng/phạt message tiền tố `bonus_penalty_freeze_guard:` (`0564:462,470`) · seeder chạy **mỗi lần boot**
> (`master-data-seed-bootstrap.service.ts:25-35`).

---

## 1. Phạm vi ĐÓNG · phản-phạm-vi · mâu thuẫn đã phát hiện

**LÀM:** 15 route 044–058 (SPEC-11 §15.1 Track B + API-18 §5b — tiêu đề backlog cũ ghi thiếu 055–058) · module
`src/payroll/formula/` · trả nợ DB-1 (SYS_* + seed `THUONG`/`PHAT`/`TAM_UNG` · mã reserved · assert tập mã seed ·
fail-closed ở đường đánh giá) · vá seeder B2 · census/ratchet siết cùng commit.

**⛔ KHÔNG LÀM:** tính lương theo mẫu · gross-up · snapshot `component_values_json` · kiểm vòng lúc TÍNH (BE-3) ·
tạm ứng/chi trả/ngân sách (BE-4) · **migration** (thiếu cột ⇒ DỪNG, báo) · **sửa công thức seed `LUONG_CO_BAN`**
(B1 ⇒ DB-1B) · sửa allowlist sensitive · `identity-projection-verdicts` (repository mới không đọc `users`/
`employee_profiles`; mẫu chỉ trả `orgUnitId`).

| # | Mâu thuẫn (đo được) | Quyết định (giả định TƯỜNG MINH) |
| --- | --- | --- |
| **M1** | SPEC-11 `:157` + `done_when` cũ cho sửa công thức/ngưng dùng thành phần HỆ THỐNG; trigger 0570 đóng băng `formula` · `is_active` · `kind` · `value_type` · `fixed_amount` · `pit_deductible` | **DB thắng.** 047 trên hàng `is_system`: chỉ `name`/`sortOrder`; trường khác ⇒ 409 024 `system-component-immutable` (tiền-kiểm). Tuỳ biến qua `payroll_template_components.formula_override`. Sửa SPEC-11 `:157` + §15.1 hàng 047 |
| **M2** | Trigger 0570 ném `23514` không tên ⇒ nhánh rỗng hiện map thành ERR-013 «thưởng/phạt» | Nhánh rỗng khớp **DƯƠNG** theo message của NODE mang `code`: `salary_components:` ⇒ 024 · `bonus_penalty_freeze_guard:` ⇒ 013 · còn lại ⇒ `null` (trigger tương lai không bị gắn nhầm 013) |
| **M3** | 3 mục `done_when` cần `payroll_periods.template_id` (DB-2) | Chuyển sang **BE-3** + BE-3 `depends_on` DB-2. BE-2 giữ ca CẤU TRÚC: route GHI track B không chạm `payroll_period_lines`/`payroll_periods` |
| **M4** | Hai census `readdirSync` không đệ quy — kind ném từ `formula/**` lọt cổng | Engine ném `FormulaError` với `kind ∈ FORMULA_ERROR_KINDS` (bảng đóng, suy mã từ kind); service đổi sang HTTP; **hai census quét ĐỆ QUY** + đọc `FORMULA_ERROR_KINDS`. Kind cấp service BẮT BUỘC là literal `payrollDetails("…")` tại chỗ ném |
| **M5 = B1** | Seed `LUONG_CO_BAN` trừ HAI LẦN ngày nghỉ không lương (SPEC-11 §13.4 quyết định owner 2026-09-01) và bị trigger khoá | **Tách WO `S15-PAYROLL-DB-1B`** (migration vá + hằng + assert (7) + ca đối chứng v1). BE-3 `depends_on` DB-1B. Fixture engine của BE-2 dùng công thức ĐÚNG |
| **M6 = B2** | Seeder chạy mỗi lần boot ⇒ hoàn tác chỉnh sửa 052/053, hồi sinh mẫu đã xoá mềm, 0 audit | Vá trong BE-2 — §7 |

---

## 2. Bản đồ 15 route

Mọi cặp `is_sensitive = true`, sàn scope Company, guard 2 tầng, `withTenant`. Envelope GHI = `{ id }`, 0 khoá tiền.

| Mã | Endpoint | Route key | Cặp | Idem | Audit GHI (payload **không số tiền**) | Mã lỗi |
| --- | --- | --- | --- | --- | --- | --- |
| 044 | `GET /payroll/salary-components` | `componentList` | view:salary-component | — | — | — |
| 045 | `POST /payroll/salary-components` | `componentCreate` | manage:salary-component | ✅ | `salary_component`/`id`/`after:{code,kind,valueType,formula,pitDeductible,isActive,hasFixedAmount}` | 018 · 019 · 024 |
| 048 | `POST …/validate-formula` **(khai TRƯỚC `:id`)** | `componentValidateFormula` | manage:salary-component | — | — | — (200 + `errors[]`) |
| 046 | `GET …/:id` | `componentDetail` | view:salary-component | — | — | 010 |
| 047 | `PATCH …/:id` | `componentUpdate` | manage:salary-component | — | `before/after:{formula}` + `changedFields` (§13.6 I) | 010 · 018 · 019 · 024 |
| 049 | `GET /payroll/templates` | `templateList` | view:payroll-template | — | — | — |
| 050 | `POST /payroll/templates` | `templateCreate` | manage:payroll-template | ✅ | `payroll_template`/`id`/`after:{code,scope,orgUnitId,isActive}` | 010 · 023 |
| 051 | `GET /payroll/templates/:id` | `templateDetail` | view:payroll-template | — | — | 010 |
| 052 | `PATCH /payroll/templates/:id` | `templateUpdate` | manage:payroll-template | — | `before/after` + `changedFields` | 010 · 018 · 023 |
| 053 | `PUT /payroll/templates/:id/components` | `templatePutComponents` | manage:payroll-template | — | `before/after:{components:[{code,formulaOverride,isVisible,sortOrder,columnLabel}]}` | 010 · 018 · 019 |
| 054 | `POST /payroll/templates/:id/preview` | `templatePreview` | manage:payroll-template | — | **KHÔNG** (§18.1 B) | 010 · 018 · 019 · 020 · 022 |
| 055 | `GET /payroll/statutory-rates` | `statutoryRateList` | view:statutory-rate | — | — | — |
| 056 | `POST /payroll/statutory-rates` | `statutoryRateCreate` | manage:statutory-rate | ✅ | `payroll_statutory_rate`/`id`/`after:{effectiveFrom}` | 022 · 033 |
| 057 | `GET /payroll/statutory-rates/:id` | `statutoryRateDetail` | view:statutory-rate | — | — | 010 |
| 058 | `PATCH /payroll/statutory-rates/:id` | `statutoryRateUpdate` | manage:statutory-rate | — | `before/after:{effectiveFrom}` + `changedFields` | 010 · 022 · 033 |

- **`@Idempotent()` đúng 3 route: 045 · 050 · 056** (danh sách đóng API-18 §5b).
- **3 controller** trong `payroll-catalog.controllers.ts`; luật cấp-file như BE-1 (`@UseGuards` từng route ·
  `ParseUUIDPipe` · `@UsePipes(ZodValidationPipe)` cấp METHOD · cặp từ `PAYROLL_ROUTE_PAIRS`).
- **`MONEY_FREE_ROUTES` 13 → 23** (đẳng thức ở census): `componentCreate` · `componentUpdate` ·
  `componentValidateFormula` · `templateList` · `templateCreate` · `templateDetail` · `templateUpdate` ·
  `templatePutComponents` · `statutoryRateCreate` · `statutoryRateUpdate`. **051 DTO không có `fixedAmount`**.

---

## 3. Máy công thức — `apps/api/src/payroll/formula/` (đã thi công bước 1, 155 ca unit xanh)

`formula.vocabulary.ts` (nguồn duy nhất; `SYS_REFS` = `PAYROLL_SYS_REFS` của contracts) · `formula.limits.ts` ·
`formula.errors.ts` · `formula.decimal.ts` (`Decimal.clone({ precision: 50, rounding: ROUND_HALF_UP })`) ·
`formula.tokenizer.ts` · `formula.ast.ts` · `formula.parser.ts` · `formula.evaluator.ts` · `formula.statutory.ts` ·
`formula.graph.ts` · `formula.fingerprint.ts`.

### 3.1 Grammar — đúng §13.6 A + 4 chốt diễn giải (ghi vào SPEC-11 §13.6 A cùng commit)

1. `length > 500` ⇒ `formula-too-long` **trước** tokenize. Zod không cap.
2. Tokenizer: khoảng trắng `' ' \t \r \n`; ký tự ngoài bảng chữ cái grammar ⇒ `formula-syntax` + `pos` (UTF-16).
   `NUMBER` `\d{1,15}(\.\d{1,6})?`; REF ≤ 32 ký tự; `AND`/`OR` là từ khoá; tên hàm đứng một mình ⇒ syntax.
3. **Độ sâu** = `max(chiều cao AST — chuỗi + − và × ÷ gộp NODE N-NGÔI, mức lồng ngoặc/lời gọi hàm/dấu âm) ≤ 20`;
   node ≤ 200; ép NGAY lúc dựng node ⇒ ngoặc 10.000 cấp dừng ở cấp 20, không tràn stack; `A + B + … + Y` (25 số
   hạng) có độ sâu 2.
4. **Arity ĐÓNG:** `IF`=3 · `MIN`/`MAX` ≥2 · `ABS`/`CEIL`/`FLOOR`/`TNCN_LUY_TIEN`/`BH_TRAN_*` = 1 · `ROUND(x[, n])`,
   `n` literal nguyên ∈ `[-6, 6]` ⇒ sai `formula-arity`; hàm ngoài danh sách ⇒ `formula-unknown-function`.

### 3.2 Evaluator — §13.6 C/F

Trung gian cắt scale 10 sau mỗi `+ − × ÷` · `÷0` ⇒ 020 `division-by-zero` · so sánh/AND/OR ⇒ 1/0, `IF`/`AND`/`OR`
đánh giá mọi tham số · `TNCN_LUY_TIEN` luỹ tiến từng phần · `BH_TRAN_X(x) = MIN(x, cap_X)` · làm tròn scale 2 MỘT
lần khi ghi vào map · `|v| > 9999999999999999.99` ⇒ 020 `numeric-overflow`.

**Ngân sách** = lượt thăm node, `Budget(perPass 25.000, perLine 775.000)`, không đồng hồ. **MF1 — nói thẳng:** mẫu
HỢP LỆ lớn nhất (116 thành phần × 200 node + 4 aggregate) ≈ 24.484 < 25.000 và gross-up tối đa 31 lượt ⇒ **ca âm
KHÔNG đạt được bằng mẫu hợp lệ** — đó là trần phòng thủ chiều sâu. Ca âm dựng bằng `Budget` trần nhỏ; **ca dương
BẮT BUỘC** chạy mẫu 116×200 + 4 aggregate THẬT qua `compileGraph`/`evaluatePass` × 31 lượt ⇒ không 422. Sửa
SPEC-11 §21.1-9 cho khớp (ca «31 lượt ⇒ vượt» là bất khả thi).

### 3.3 Đồ thị + 4 nút aggregate — khớp từng chữ §13.6 E / §13.7 E

Cạnh ngầm dựng từ `kind` của thành phần **CÓ MẶT trong mẫu** (MF4: `is_visible` KHÔNG ảnh hưởng — ẩn cột vẫn cộng;
service không lọc `is_visible` khi dựng đồ thị): `TONG_THU_NHAP ← {earning, tax_exempt}` · `TONG_BH_NV ←
{statutory_employee ∧ pitDeductible}` · `THU_NHAP_CHIU_THUE ← {TONG_THU_NHAP, TONG_BH_NV, tax_exempt}` ·
`TONG_KHAU_TRU ← {deduction, statutory_employee, tax}` (vế `tax` là cạnh bảo thủ; giá trị chỉ cộng khi
`pitPayer = EMPLOYEE`). Kahn + DFS trích chu trình đầy đủ ⇒ 019. Mẫu thiếu 4 nút ⇒ 018
`template-missing-engine-nodes`. **MF5:** kiểm vòng ngữ cảnh CATALOG (045/047/048) dựng cạnh ngầm trên TOÀN catalog
⇒ có thể báo vòng mà một mẫu cụ thể không có — **bảo thủ có chủ ý** (vòng đó là thật với mẫu mặc định).

### 3.4 Fingerprint — §13.6 G, hai tầng

`formulaSetFingerprint` (051 trả) băm `{code, kind, valueType, formula hiệu lực, fixedAmount chuẩn hoá 2 chữ số,
pitDeductible, isVisible, sortOrder}` sắp theo `(sortOrder, code)`; `lineFingerprint(setFp, statutoryRateId)` cho BE-3.

---

## 4. Luật nghiệp vụ theo nhóm route

**Khoá:** 045 · 047 · 050 · 052 · 053 **và seeder** gọi `payrollCatalogLockTx` (`pg_advisory_xact_lock(hashtext
('payroll-catalog:'||company))`) TRƯỚC `FOR UPDATE` hàng — thứ tự nhất quán, không deadlock.

**Thành phần (044–048):**
- 045: Zod loại `kind='aggregate'`/`valueType='engine'` (400). Service: tiền tố `SYS_`/`TL_`/`GT_` · **17 mã hệ
  thống** (14 + `THUONG`/`PHAT`/`TAM_UNG`) · 11 tên hàm · `AND`/`OR` ⇒ 409 024 `component-code-reserved`. Trùng mã
  sống ⇒ 23505 ⇒ 024 `component-code-exists`. Công thức: parse + resolve (catalog active, chưa xoá) + vòng catalog.
- 047: `is_system` ⇒ chỉ `name`/`sortOrder` (M1). Hàng tự thêm: `code` bất biến; cặp `valueType` kiểm trên hàng SAU
  MERGE ⇒ 422 018 `component-value-pair`; `{isActive:false}`/`{delete:true}` khi còn **mẫu CHƯA XOÁ** tham chiếu ⇒
  409 024 `component-in-use` (`details: templates`). Đổi `formula` · `kind` · `valueType` · **`pitDeductible`** (MF3)
  ⇒ kiểm vòng catalog + MỌI mẫu chưa xoá chứa nó, REF mới phải có trong từng mẫu (không để mẫu hỏng âm thầm).
- 048: luôn 200 `{valid, errors[{code,kind,message,pos?,ref?,func?,cycle?}], refs, depth, nodes}`; `componentCode`
  tuỳ chọn ⇒ kiểm vòng như thể thành phần đó mang công thức này.
- 046: + `usedByTemplates` (chỉ mẫu chưa xoá — MF15).

**Mẫu (049–054):**
- 050/052: 050 Zod mirror cặp `scope`↔`orgUnitId`; 052 kiểm sau merge ⇒ 018 `template-scope-pair`; org unit tiền-kiểm
  tồn tại + **chưa xoá mềm** (FK composite không chặn hàng đã xoá — MF15) ⇒ 404 010; FK 23503 là lưới cuối ⇒ 404.
  Trùng `code` ⇒ 23505 ⇒ **409 023 `template-code-exists`** (kind mới). 052 `{delete:true}` ⇒ xoá mềm (kiểm «mẫu
  đang gắn kỳ» ⇒ BE-4, cột chưa có).
- 053 (`FOR UPDATE` mẫu): Zod `max(1000)`; service `>120` ⇒ `template-too-many-components` · trùng ⇒
  `template-component-duplicate` · `componentId` không thuộc catalog active ⇒ `template-component-unknown` · override
  trên `engine`/`profile_item` ⇒ `formula-override-not-allowed` · thiếu 4 aggregate ⇒ `template-missing-engine-nodes`
  · parse + resolve (mẫu) + vòng trên trạng thái SAU. Ghi: DELETE hết rồi INSERT mảng.
- 054: body `{inputs: Record<SYS_*, decimalString>, profileItems (≤120 khoá), pitPayer, statutory}`. **0 lượt đọc dữ
  liệu thật** ngoài mẫu + catalog; KHÔNG đọc `payroll_statutory_rates`. `SYS_*` vắng ⇒ 0 (CHỈ preview) — **FE PHẢI
  gửi `SYS_WORK_DAYS`**, vắng ⇒ 422 020 `division-by-zero` với mẫu mặc định (MF6, có ca). `statutory` hỏng bậc ⇒ 022.
  Trả `{columns, values: Record<code, decimalString>, formulaSetFingerprint, nodesVisited}`.

**Tỉ lệ luật định (055–058):**
- Zod mirror CHECK (pct 0..100 bước 0,01 · cap/base/min > 0 · deduction ≥ 0); `pitBrackets` chỉ hình dạng, `max(50)`.
  Service `assertBracketsContinuous` ⇒ 022 `statutory-rate-incomplete` (`reason`: count · not-increasing ·
  open-not-last · last-not-open · rate-range · shape).
- 056 trùng `effective_from` ⇒ 23505 ⇒ 033 `rate-effective-date-exists`.
- 058 (`FOR UPDATE`) — **«đã có kỳ dùng» (MF13, định nghĩa CHỐT):** R in-use ⇔ ∃ `payroll_periods` chưa xoá,
  `status ∉ {Draft, CollectingData}`, `lastDay(period_month) ≥ R.effective_from` — **KHÔNG** có vế «không có bản R2
  xen giữa» (vế đó lách được bằng POST một R2 rồi PATCH R). PATCH đổi `effectiveFrom` ⇒ kiểm với `min(cũ, mới)`.
  In-use ⇒ 409 033 `rate-in-use`. 055/057 trả `inUse` (một câu set-based).

---

## 5. Mã lỗi & `kind` — bảng ĐÓNG (sync SPEC-11 §12.1 + API-18 §6.5b cùng commit)

| Mã | Key mới | `kind` BE-2 ném |
| --- | --- | --- |
| 018 (422) | *(có sẵn `FORMULA_INVALID`)* | `formula-syntax` · `formula-unknown-ref` · `formula-unknown-function` · `formula-arity` · `formula-too-long` · `formula-too-deep` · `formula-too-many-nodes` · `template-missing-engine-nodes` · `formula-override-not-allowed` · `template-too-many-components` · `template-component-unknown` · `template-component-duplicate` · `component-value-pair` · `template-scope-pair` |
| 019 (422) | `FORMULA_CYCLE` | `formula-cycle` |
| 020 (422) | `FORMULA_EVAL` | `formula-budget-exceeded` · `division-by-zero` · `numeric-overflow` |
| 022 (422) | `STATUTORY_RATE_INVALID` | `statutory-rate-incomplete` |
| 023 (409) | `TEMPLATE_CONFLICT` | `template-code-exists` |
| 024 (409) | `COMPONENT_CONFLICT` | `system-component-immutable` · `component-in-use` · `component-code-exists` · `component-code-reserved` |
| 033 (409) | `STATUTORY_RATE_CONFLICT` | `rate-effective-date-exists` · `rate-in-use` |

**`mapPayrollPgError` thêm (theo TÊN):** 23505 `salary_components_company_code_uq` ⇒ 024 exists · 23505
`payroll_templates_company_code_uq` ⇒ 023 · 23505 `payroll_statutory_rates_company_effective_uq` ⇒ 033 · 23514
`salary_components_code_shape_check` ⇒ 024 reserved (MF10) · 23514 `salary_components_system_not_deletable` ⇒ 024
immutable · 23514 `salary_components_value_pair_check`/`engine_kind_check` ⇒ 018 `component-value-pair` (sửa bảng SPEC
— trả `null` là 500) · 23514 `payroll_templates_scope_pair_check` ⇒ 018 · 23514 RỖNG ⇒ M2 · 23503
`payroll_templates_org_unit_id_company_fk` ⇒ 404 · 23503 `payroll_template_components_component_id_company_fk` ⇒ 018
`template-component-unknown`. Thông điệp không bao giờ chứa số tiền.

---

## 6. Contracts — `packages/contracts/src/payroll-catalog.ts` (đã thi công, 14 ca xanh)

`payroll.ts` không thêm dòng nào; file mới import ngược enum + `payrollPageQuery`. Luật chống mã chết: không cap
`formula` · không ép 7 bậc · không cấm tiền tố ở `code` · `components.max(1000)` ≠ 120. `PAYROLL_SYS_REFS` là nguồn
`SYS_*`. Query boolean idempotent (không `z.coerce.boolean`). Preview: `inputs` khoá theo enum 15 `SYS_*`, giá trị
chuỗi thập phân; `profileItems` ≤ 120 khoá.

---

## 7. Seeder — trả nợ DB-1 + vá B2 (đã thi công qua script một lần ghi)

1. **SYS_* +3** (`SYS_BONUS_AMOUNT` · `SYS_PENALTY_AMOUNT` · `SYS_ADVANCE_AMOUNT`) + seed `THUONG` (earning, 30) ·
   `PHAT` (deduction, 60) · `TAM_UNG` (deduction, 70) với công thức là CHÍNH biến đó; `seedVersion v1 → v2`
   (bump để batch/track ghi đúng lượt đổi nội dung — seeder chạy mỗi boot bất kể version).
2. **B2:** `seedComponents` trả tập mã VỪA chèn (`RETURNING`); `seedDefaultTemplate` không tạo lại nếu có BẤT KỲ
   hàng `MAU_MAC_DINH` (kể cả xoá mềm); link TẤT CẢ khi mẫu vừa được tạo, còn lại CHỈ link mã vừa chèn; seeder lấy
   `payrollCatalogLockTx`.
3. **Assert (5)** = mẫu mặc định (nếu còn sống) chứa đủ 4 nút aggregate · **assert (6)** = tập mã `is_system` sống
   ĐÚNG BẰNG hằng TS. (Assert (7) công thức == hằng ⇒ DB-1B.)
4. Từ vựng: `SYS_REFS`/`STATUTORY_REFS`/`FORMULA_FUNCS`/4 nút engine đọc từ `formula.vocabulary.ts` (một nguồn);
   `PAYROLL_FORMULA_VOCABULARY` giữ export cho E11.

---

## 8. Census · ratchet · ngưỡng — siết CÙNG COMMIT

| Cổng | Trước → Sau |
| --- | --- |
| `PAYROLL_ROUTE_PAIRS` / `ROUTE_TO_KEY` / `used.size` | 43 → **58** |
| `PAYROLL_CONTROLLERS` | 8 → **11** |
| `SERVICE_SITE_TO_KEYS` | + 15 site |
| Census 2 tầng + mã lỗi | **quét đệ quy** + đọc `FORMULA_ERROR_KINDS` |
| `PAYROLL_ERR_CODE` | 19 → **25** |
| `MONEY_FREE_ROUTES` | 13 → **23** |
| Cờ sensitive (census (8)) | 15 → **21** cặp sensitive / 18 → **24** cặp có route |
| `MIN_COVERED_COUNT` | 590 → **đo lại thật** |
| `payroll-formula-architecture-census.unit-spec.ts` (MỚI, đã xanh) | 0 `eval(`/`Function(`/`new RegExp`/`Number(`/`parseFloat(`/`parseInt(`/`Math.`/`JSON.parse` trong `formula/**` (bỏ `*.spec.ts`) |
| `vitest.config.ts` | khoá threshold TỪNG FILE `src/payroll/formula/*.ts` ≥ 95% |

---

## 9. Test — RED trước rồi GREEN

**Unit (đã xanh 155 ca):** grammar + `pos` · biên 500/501 · 19/20 ngoặc · 200/201 node · arity · số lẻ · 11 hàm ·
÷0 · overflow · ngân sách (per-pass biên thật · per-line đếm) · 4 vế (a)–(d) · vòng + chu trình · fingerprint · fuzz
1.800 chuỗi. **Còn phải thêm (MF1/B1):** ca dương 116×200 + 4 aggregate × 31 lượt qua đồ thị THẬT · ca 18/2/22 với
công thức `LUONG_CO_BAN` đúng.

**Int (LANE_DB — `s15-payroll-be2-{components,templates,statutory-rates,seed}.int-spec.ts`):** mỗi route: DENY
không cặp · DENY `view` gọi `manage` · DENY grant `Department` · **ALLOW song sinh `=== 200/201`** · `:id` khác tenant
⇒ 404 010. Cộng:
- 048 view-only ⇒ 403 · 501 ký tự ⇒ **422 018 `formula-too-long`, KHÔNG 400**;
- shadowing 3 nhánh §21.1 B8 (reserved · exists · xoá mềm hàng hệ thống bằng SQL thẳng ⇒ 23514);
- M1 PATCH formula hàng hệ thống ⇒ 024 · **M2 bắn trigger THẬT qua repository (bỏ tiền-kiểm) ⇒ 024, không 013** (MF9);
- component-in-use (mẫu xoá mềm KHÔNG tính) · 047 đổi công thức/`pitDeductible` làm vỡ mẫu ⇒ 018/019;
- 053 đủ 5 kind + vòng trạng-thái-SAU · ẩn cột vẫn cộng (MF4);
- 054: fail-closed mẫu thiếu aggregate ghi thẳng DB ⇒ **kind** `template-missing-engine-nodes` · vắng `SYS_WORK_DAYS`
  ⇒ 020 `division-by-zero` · **0 hàng audit + ca ALLOW song sinh** (050 cùng ca ra đúng 1 hàng — MF16);
- 056 hình dạng bậc hỏng ⇒ 022 kèm `reason` (gồm `rate-range` · `not-increasing` — MF12);
- 058: in-use (kỳ `Calculated` ghi thẳng SQL) · **chèn R2 rồi PATCH R ⇒ 409 033** (MF13) · đối chứng kỳ `Draft` ⇒ 200;
- ràng buộc THẬT (MF17): 23505 mẫu ⇒ 023 · 23505 tỉ lệ ⇒ 033 · 23503 org unit ⇒ 404 · 23503 `component_id` ⇒ 018;
- audit 047 có chuỗi công thức cũ/mới, **không** `fixedAmount`; envelope GHI 0 khoá tiền;
- M3: route GHI không chạm `payroll_period_lines` (fixture ≥ 1 kỳ + 1 dòng — MF16).

**Seed (`s15-payroll-db1-seed.int-spec.ts` + ca mới):** E13 lật (3 mã có mặt, công thức dùng `SYS_*`) · B2: 053 gỡ
`KPCD` → `reconcileCompany` → vẫn vắng · 052 xoá mềm → không hồi sinh · xoá cứng 3 hàng mới bằng superuser → chạy lại
→ được chèn + link · assert (6) nhánh «thừa» bằng INSERT thêm một hàng `is_system` (DELETE bị FK chặn — MF16).

---

## 10. Doc + backlog (cùng commit)

- SPEC-11: §13.6 A (4 chốt + arity + độ sâu) · §13.6 D (+3 `SYS_*`) · §13.6 E (có mặt = bật) · §13.6 G (hai tầng) ·
  `:157` + §15.1 hàng 047 (M1) · hàng 054 (khuôn body, FE gửi `SYS_WORK_DAYS`) · hàng 058 (in-use) · §12.1 kind mới ·
  §21.1-9 (ca âm ngân sách).
- API-18 §5.2 hàng 044–058 · §6.5b kind. DB-13 §13.4 hàng «CHƯA seed» → «seed ở BE-2 (`v2`)» + ghi chú B1 ⇒ DB-1B.
- `harness/backlog.mjs`: BE-2 (title 044–058 · paths · gỡ 3 mục M3 · thêm B2) · **WO mới `S15-PAYROLL-DB-1B`** ·
  BE-3 (`depends_on` + DB-2 + DB-1B; nhận M3 + kiểm vòng lúc tính + khoá shared/`FOR SHARE`) · BE-4 (`template-in-use`).

---

## 11. Thứ tự thi công & cổng

1. ✅ `formula/` + unit/fuzz · 2. ✅ contracts + spec · 3. ✅ seeder (B2 + nợ) · 4. errors + route-pairs + census
(RED) · 5. repositories/services/controllers + int-spec deny-path RED trước · 6. doc/backlog · 7. `check.sh --quick`
trong vòng; đóng `bash harness/check.sh --all --lane-db=s15be2` · 8. **FULL gate TUẦN TỰ (MF18):**
`security-reviewer` → `database-reviewer` → `silent-failure-hunter`; logic aggregate cần hai reviewer độc lập cùng
PASS (santa) · 9. PR **chờ người chốt**.

## 12. Điểm mù CÓ Ý THỨC

- POST 056 một bản rơi vào kỳ đã tính đổi «bản áp dụng» khi tính lại — SPEC không cấm; snapshot bảo vệ tiền đã tính;
  tín hiệu: `lineFingerprint` lệch trên kỳ ≥ Approved.
- Kiểm vòng lúc lưu an toàn nhờ advisory lock chỉ trên đường API/seeder; ghi thẳng DB ⇒ BE-3 kiểm lúc tính.
- `profileItems` vắng ⇒ 0 đúng nghĩa; `SYS_*` vắng ⇒ 0 CHỈ ở preview (BE-3 phải ném).
