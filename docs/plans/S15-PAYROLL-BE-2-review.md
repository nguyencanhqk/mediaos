# S15-PAYROLL-BE-2 — plan-review vòng 1 (13/09/2026) · kết quả vá

> **Verdict reviewer:** BLOCK — 2 BLOCKER + 18 MUST-FIX, **không tự mở cổng** vì B1 cần migration mà plan loại.
> **Quyết định sau vá:** cổng MỞ, **KHÔNG chạy vòng 2** (memory `plan-review-rounds-inject-new-holes`). Lý do:
> B1 được **tách khỏi WO** sang `S15-PAYROLL-DB-1B` (WO có migration) nên điều kiện «muốn sửa phải có migration
> mà plan loại» không còn nằm trong BE-2; B2 + 18 must-fix đều vá bằng chữ/ca test/sửa seeder trong `paths`.
> Cả hai BLOCKER được **tự đo lại** trước khi chấp nhận (không tin reviewer mù quáng) — bằng chứng ghi tại chỗ.

---

## BLOCKER

| # | Phát hiện | Tự đo lại | Xử lý |
| --- | --- | --- | --- |
| **B1** | Công thức seed `LUONG_CO_BAN = SYS_BASE_SALARY × SYS_PAY_RATIO/100 × SYS_PRESENT_DAYS / SYS_WORK_DAYS` + `NGHI_KHONG_LUONG` trừ thêm `× SYS_UNPAID_LEAVE_DAYS / SYS_WORK_DAYS` ⇒ **trừ HAI LẦN** ngày nghỉ không lương (và thiếu clamp `LEAST(…,1)`). Hàng `is_system` bị trigger 0570 đóng băng ⇒ seeder và tenant đều không sửa được | ✅ **XÁC NHẬN.** SPEC-11 §13.4 «Nghỉ KHÔNG lương» (QUYẾT ĐỊNH OWNER 2026-09-01): tử số = `present + unpaid`, GIỮ vế khấu trừ; `payroll-calc.repository.ts:74-85` hiện thực đúng như vậy. Fixture 18/2/22, lương 22tr: v1 `base_amount = 20.000.000`, seed v2 cho `18.000.000` rồi trừ tiếp 2.000.000 | **TÁCH WO `S15-PAYROLL-DB-1B`** (🔴, migration): sửa hằng seeder + DB-13 §13.4 + migration vá hàng đã seed (`DISABLE/ENABLE TRIGGER salary_component_system_freeze` trong CÙNG file, `WHERE is_system AND code='LUONG_CO_BAN' AND formula = <chuỗi cũ chính xác>`, verify fail-loud) + assert (7) `formula` hàng hệ thống == hằng TS + ca đối chứng v1 ↔ `MAU_MAC_DINH` (18/2/22 · 23/0/22 · số lẻ). `S15-PAYROLL-BE-3` thêm `depends_on` DB-1B. **BE-2 KHÔNG chạm công thức seed**; fixture engine (`formula.graph.spec.ts`) dùng công thức ĐÚNG + ca 18/2/22 để không ghim lỗi thành hành vi đúng |
| **B2** | Seeder chạy **mỗi lần boot**, `ON CONFLICT DO NOTHING` chèn lại link cho MỌI mã hệ thống vào `MAU_MAC_DINH` và tạo lại mẫu đã xoá mềm ⇒ chỉnh sửa 052/053 bị hoàn tác âm thầm, 0 audit | ✅ **XÁC NHẬN.** `master-data-seed-bootstrap.service.ts:25-35` gọi `reconcileAllCompanies()` mỗi lần boot; `runOne` luôn gọi `seeder.seed()` | **VÁ TRONG BE-2** (seeder nằm trong `paths`): (a) `seedComponents` trả tập mã **vừa chèn** (`INSERT … ON CONFLICT DO NOTHING RETURNING code`); (b) `seedDefaultTemplate` KHÔNG tạo mẫu nếu đã có BẤT KỲ hàng `MAU_MAC_DINH` nào (kể cả xoá mềm); link tất cả khi mẫu vừa được tạo trong lượt này, còn lại CHỈ link mã vừa chèn; (c) seeder lấy cùng advisory lock `payroll-catalog:<company>` với route ghi; (d) assert (5) đổi thành «mẫu mặc định (nếu còn sống) chứa đủ 4 nút aggregate». Ca int: 053 gỡ `KPCD` → `reconcileCompany` → vẫn vắng · 052 xoá mềm → runner → không hồi sinh · 3 mã mới vẫn được link cho công ty cũ (xoá cứng 3 hàng bằng superuser rồi chạy lại) |

## MUST-FIX

| # | Nội dung | Xử lý |
| --- | --- | --- |
| MF1 | Ca âm ngân sách **không đạt được** bằng mẫu hợp lệ (mẫu lớn nhất ≈ 24.484 < 25.000; per-line chỉ nổ ở lượt 32) | Ghi rõ ở plan §3.2 + SPEC-11 §21.1-9: ca âm dựng bằng `Budget` trần nhỏ hoặc mẫu vượt trần tĩnh ghi thẳng DB; **ca dương** chạy mẫu 116×200 + 4 aggregate THẬT qua `compileGraph`/`evaluatePass` × 31 lượt |
| MF2 | Định nghĩa độ sâu chưa ở SPEC | SPEC-11 §13.6 A: `max(chiều cao AST — chuỗi + và × gộp n-ngôi, mức lồng ngoặc/hàm/dấu âm)` |
| MF3 | 047 phải kiểm vòng lại khi đổi `pitDeductible` | Thêm vào luật 047 + ca test |
| MF4 | «Đang bật trong mẫu» = «có mặt trong mẫu» | Ghi SPEC-11 §13.6 E; service KHÔNG lọc `is_visible` khi dựng đồ thị (ca test: ẩn cột vẫn cộng) |
| MF5 | Kiểm vòng ngữ cảnh catalog dựng cạnh ngầm trên toàn catalog ⇒ bảo thủ | Ghi «bảo thủ có chủ ý» ở plan §4 |
| MF6 | 054: `profileItems` không trần; `SYS_*` vắng ⇒ 0 làm mẫu mặc định luôn 422 chia 0; ca fail-closed phải assert `kind` | Contracts `profileItems` ≤ 120 khoá; ghi rõ FE PHẢI gửi `SYS_WORK_DAYS` (ca test: vắng ⇒ 422 020 `division-by-zero`); ca fail-closed assert `template-missing-engine-nodes` |
| MF7 | Plan ghi precision 40, code 50 | Sửa plan = 50 |
| MF8 | Byte NUL thật trong fuzz spec | ✅ Đã thay bằng escape `\u0000` (2 chỗ) |
| MF9 | Nhánh 23514 không tên phải khớp DƯƠNG cả hai tiền tố | `bonus_penalty_freeze_guard:` (0564:462,470 — đo lại ✅) ⇒ 013 · `salary_components:` ⇒ 024 · còn lại ⇒ `null`. Ca int bắn trigger THẬT qua repository (bỏ tiền-kiểm) ⇒ 024 |
| MF10 | Thiếu map `salary_components_code_shape_check` ⇒ 024 `component-code-reserved`; map `value_pair` ⇒ 018 lệch bảng SPEC | Thêm nhánh map; sửa bảng SPEC-11 §12.1 cùng commit |
| MF11 | Kind cấp service không nằm trong `FORMULA_ERROR_KINDS` | Luật: kind cấp service PHẢI là literal `payrollDetails("…")` tại chỗ ném (không helper nhận kind biến) — census regex bắt được |
| MF12 | Equal-caps: Zod `code` chỉ mirror hình dạng; `pitBrackets` phần tử lỏng | ✅ Đã đúng trong contracts; thêm ca int cho `rate-range` · `not-increasing` |
| MF13 | 058 «đã có kỳ dùng» lách được bằng POST một bản R2 xen giữa | Vị từ mới: R in-use ⇔ ∃ kỳ chưa xoá, `status ∉ {Draft, CollectingData}`, `lastDay(period_month) ≥ R.effective_from` (bỏ vế «không có R2 xen giữa»). PATCH đổi `effectiveFrom` ⇒ kiểm với `min(cũ, mới)`. Ca: chèn R2 rồi PATCH R ⇒ 409 033 |
| MF14 | Payload audit chở tiền (`fixedAmount`, trần, giảm trừ) trái SPEC-11 §18 | Audit ghi `changedFields` (TÊN trường) + chuỗi công thức cũ/mới (§13.6 I); không giá trị tiền |
| MF15 | `component-in-use`/`usedByTemplates` phải bỏ mẫu xoá mềm; org unit tiền-kiểm chưa xoá; 051 không có `fixedAmount` | Ghi luật + ca test |
| MF16 | Ca xanh-rỗng: M3 cần ≥1 kỳ + 1 dòng; 054 «0 audit» cần ca ALLOW song sinh; assert (6) bằng `DELETE` bất khả thi | Sửa đúng như đề xuất; assert (6) test bằng INSERT thêm một hàng `is_system` (nhánh «thừa») |
| MF17 | Thiếu ca kích hoạt ràng buộc THẬT | 23505 `payroll_templates_company_code_uq` ⇒ 023 · 23505 `payroll_statutory_rates_company_effective_uq` ⇒ 033 · 23503 FK org unit ⇒ 404 (qua repository) · 23503 FK `component_id` ⇒ 018 (qua repository) |
| MF18 | Bỏ `database-reviewer` trái CLAUDE.md §6 | FULL gate đủ ba reviewer, chạy **TUẦN TỰ**: `security-reviewer` → `database-reviewer` → `silent-failure-hunter`; `santa-method` = hai reviewer độc lập phải cùng PASS trên logic aggregate |

## Điểm reviewer xác nhận ĐÚNG — không «sửa»

`FormulaError` suy mã từ kind qua bảng đóng · `compileGraph` fail-closed (unknown-ref, thiếu 4 nút engine) · kiểm
độ dài trước tokenize · Zod không cap bằng service (formula · 120 · 7 bậc) · `Decimal.clone` · làm tròn một lần ·
hai trần ngân sách không đồng hồ · 048/054 gác cặp GHI · 054 không đọc `payroll_statutory_rates` · `@Idempotent`
đúng 3 route · envelope GHI `{id}` · kiểm cặp `value_type` sau merge · chuyển M3 sang BE-3 kèm `depends_on` DB-2 ·
bốn công thức aggregate khớp từng chữ §13.6 E/§13.7 E.

## FULL gate (sau code) — tuần tự

### 1. `security-reviewer` — PASS (0 CRITICAL · 0 HIGH · 3 MEDIUM · 4 LOW)

| # | Phát hiện | Xử lý |
| --- | --- | --- |
| MEDIUM-1 | `findCycle` đệ quy không trần ⇒ tràn stack ⇒ 500 | Đã là vòng lặp đường-đi (viết lại trong lượt coverage, reviewer đọc bản cũ); probe chuỗi 20.000 ⇒ `formula-cycle` |
| MEDIUM-2 | 047 bỏ parse khi hàng đang/sẽ ngưng dùng ⇒ chuỗi > 500 ký tự rơi xuống CHECK ⇒ 500; chuỗi sai cú pháp lưu thẳng | Luôn compile hàng `valueType=formula`; ngưng dùng ⇒ compile thêm phần catalog còn lại. Map `salary_components_formula_len_check` + `payroll_template_components_formula_len_check` ⇒ 422 018. Ca int H1 |
| MEDIUM-3 | 047 `{delete:true}` bỏ kiểm đồ thị mà `{isActive:false}` có làm ⇒ REF treo âm thầm | Compile catalog trừ hàng bị xoá TRƯỚC `softDeleteTx`. Ca int H2 (song sinh `isActive:false`) |
| LOW-4 | 045 trùng mã đang dùng + công thức tham chiếu ⇒ 422 019 chu trình rỗng | Tiền-kiểm ⇒ 409 024 `component-code-exists`. Ca int H3 |
| LOW-5 | 054 trả `values` của thành phần `fixed` = `fixedAmount` catalog cho người thiếu `view:salary-component` (role tuỳ biến) | **Rủi ro chấp nhận** ghi ở SPEC-11 §18.1 — **owner xác nhận 14/09/2026** (muốn đóng = 054 đòi thêm cặp view) |
| LOW-6 | Seeder assert (5) ném MỖI LẦN BOOT khi người dùng xoá mềm rồi tạo lại `MAU_MAC_DINH` (050 tạo mẫu rỗng) | Seeder chỉ xét hàng `created_by IS NULL` (do seeder tạo). Ca int S7 |
| LOW-7 | `componentsTx` không lọc `salary_components.deleted_at` | Preview fail-closed thêm vế `componentDeletedAt`. Ca int templates D6 |

`check.sh --all` cùng lượt đỏ 2 census THẬT (không phải flake): artifact `S6-SEC-ROUTEMAP-1-route-census.json` (605 route / 109 controller — sinh lại) và `s13-payroll-qa1-scope-floor` neo 43 key (⇒ 58 key, +15 route track B có A/B đối chứng thật, +1 ca Department).

### 2. `database-reviewer` — BLOCK (1 HIGH) ⇒ vá ⇒ hết chặn

| # | Phát hiện | Xử lý |
| --- | --- | --- |
| **HIGH-1** | Seeder chèn lại bản tỉ lệ seed MỖI LẦN BOOT sau khi 058 đổi `effectiveFrom` (arbiter chỉ nhìn ngày) ⇒ số seed đè chỉnh sửa của người dùng cho mọi kỳ về sau, 0 audit — cùng lớp B2 | Seeder chỉ chèn khi công ty CHƯA có bản nào (kể cả xoá mềm), ngược lại track `Skip`; assert (4) = «≥ 1 bản sống», bỏ ghim ngày. Ca int S8 |
| LOW-1 | N+1 `assertGraphsAfterEdit` (1 câu `componentsTx` mỗi mẫu chứa thành phần) dưới khoá | **Nợ ghi nhận** — số mẫu chứa một thành phần nhỏ; gộp một câu khi BE-3 đụng lại đường này |
| LOW-2 | Vế FK `(company_id, component_id)` của `payroll_template_components` không có index | Cần migration ⇒ **done_when của `S15-PAYROLL-DB-1B`** |
| LOW-3 | Không test nào ghim advisory lock — gỡ khoá mọi ca vẫn xanh | Census tĩnh `test/foundation/payroll-catalog-lock-census.unit-spec.ts`: khoá TRƯỚC lần chạm DB đầu tiên ở 045/047/050/052/053 + seeder; method ghi mới vắng khỏi bảng ⇒ đỏ; tự kiểm chống xanh-rỗng |
| LOW-4 | Heuristic `created_by IS NULL` lỗ khi user bị XOÁ CỨNG (`ON DELETE SET NULL`) | **Chấp nhận** — app không bao giờ xoá cứng users; chỉ purge/teardown |
| LOW-5 | Catalog không trần số hàng (045/047/048 tải + compile toàn bộ) | **Nợ ghi nhận** — chỉ role manage; trần cần mã lỗi mới + SPEC, không nhét vào BE-2 |
| INFO | Khoá chỉ đúng dưới READ COMMITTED · 056 lùi ngày vào kỳ Calculated · mẫu gắn đơn vị xoá mềm sau đó · tạo lại mã sau xoá mềm | Ghi chú READ COMMITTED ở `payroll-catalog.lock.ts`; phần còn lại là việc BE-3/BE-4 (snapshot kỳ ≥ Approved, xử lý đơn vị xoá mềm) |

### 3. `silent-failure-hunter` — PASS (0 CRITICAL/HIGH · 2 MEDIUM · 2 LOW · 2 INFO)

| # | Phát hiện | Xử lý |
| --- | --- | --- |
| MEDIUM-1 | `valuePairOk` thiếu nhánh `engine` ⇒ đổi TÊN/thứ tự 4 nút `TONG_*` ra 422 `component-value-pair` dù trigger cho phép | Thêm nhánh mirror CHECK 0570. Ca int H4 |
| MEDIUM-2 | Preview: khoá `profileItems` lạ âm thầm = 0 | 054 từ chối khoá không khớp thành phần `profile_item` của mẫu ⇒ 422 018 `profile-item-unknown-component` (ca D7); vế lúc TÍNH ⇒ done_when BE-3 |
| LOW-1 | Seeder gắn mã mới vào mẫu không compile đồ thị | done_when `S15-PAYROLL-DB-1B` (WO bump seedVersion kế tiếp) |
| LOW-2 | Nhãn `Skip` gộp hai trạng thái | Tách `soft-deleted-by-user` / `user-owned-live-template` |
| INFO | 6 CHECK chưa map (không route nào tới được) · precision trung gian 50 không trần | Nợ ghi nhận |

### Sau gate

- Census FE `apps/app` (cùng khuôn BE-1): `payroll-wiring.spec.ts` 43 → 58 cặp route, 18 → 24 cặp distinct, 15 → 21 cặp sensitive; `PAYROLL_ERROR_KINDS` +14 kind track B kèm bản dịch vi.
- `s15-payroll-db1-invariants` E2 đỏ ở `check.sh --all` lượt 2 = tenant `pay2life-*` của `payroll-be2-lifecycle.int-spec.ts` (spec v1, chèn `allowances` bằng SQL, dọn ở `afterAll`) bị chunk crash hạ tầng bỏ lại trên lane — KHÔNG do BE-2. Dọn 4 tenant trên lane, chạy lại E2 xanh 62/62.
