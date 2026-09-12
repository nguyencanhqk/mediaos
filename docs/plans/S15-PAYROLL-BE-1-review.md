# S15-PAYROLL-BE-1 — biên bản plan-review (vòng 1, DUY NHẤT)

**Ngày:** 11/09/2026 · **Plan:** `docs/plans/S15-PAYROLL-BE-1.md` · **Zone:** đỏ (crown-jewel), FULL gate + Opus.

**VERDICT vòng 1:** 🔴 **BLOCK — 12 BLOCKER** (3 CRITICAL · 9 HIGH) + 8 MEDIUM/LOW, **kèm điều kiện tự-mở-cổng**.
**Trạng thái sau khi vá:** ✅ **PASS — vá đủ 12/12 BLOCKER + 8/8 MEDIUM/LOW cùng phiên**, KHÔNG mở vòng 2
(CLAUDE.md §6 · memory `plan-review-rounds-inject-new-holes` · `red-zone-wo-cost-profile`).

> **Reviewer tự đo lại 13/13 số đo của plan ⇒ ĐÚNG HẾT.** BLOCKER không nằm ở số liệu mà ở **vùng plan không
> nhìn tới**: tương tác giữa `items[]` mới và **máy tính lương v1 ĐANG SỐNG**.

---

## 1. Ba BLOCKER CRITICAL — bug THẬT, đã xác minh trên code

| # | Vấn đề | Bằng chứng (tự đo lại, không tin lời reviewer) | Vá ở đâu |
| --- | --- | --- | --- |
| **B1** | **Mirror `allowances` bơm tiền vào `gross`.** Plan bản đầu validate `componentCode` chỉ kiểm *tồn tại + chưa xoá mềm* rồi mirror **MỌI** item sang cột `allowances`. Nhưng `allowances` là đầu vào tính lương v1: `items:[{componentCode:"TNCN", amount:5000000}]` qua validate ⇒ nhân viên được **CỘNG** 5 triệu thay vì bị **trừ** thuế. Item `isActive:false` cũng được trả tiền. | `apps/api/src/payroll/payroll-calc.repository.ts:253-258` cộng `sum((a->>'amount')::numeric)` của **mọi** phần tử `allowances` vào `gross`. Catalog seed có `kind` = `deduction`/`statutory_employee`/`tax`/`aggregate` (`payroll-master-data.seeder.ts:217,273,304,228`). | Plan §3.2 — validate **3 điều kiện** (thêm `value_type='profile_item'`), mirror **chỉ** item `isActive` |
| **B2** | **020 nuốt `allowances` trong im lặng.** Plan đổi `allowances[]` → `items[]` nhưng `createSalaryProfileSchema` **không `.strict()`** ⇒ Zod **strip** khoá lạ ⇒ client cũ gửi `allowances` nhận **201 với 0 phụ cấp**. Đúng hình dạng `empty-success-is-the-fail-open-shape`. | `packages/contracts/src/payroll.ts:206-212` — không `.strict()`; đối chứng `updateSalaryProfileSchema:220-228` **có**. | Plan §3.1 — thêm `.strict()` cùng commit; §5 bước 5 gọi đích danh `payroll-be1-scope.int-spec.ts:365,504` |
| **B3** | **`canRevealTaxCode` thiếu SÀN scope Company ⇒ rò PII rộng hơn route sở hữu.** Bản đầu dùng `resolveOrNull(...) !== null`. Role có `view:salary-profile`@**Department** bị **403 ở 019/021** nhưng **đọc được `taxCode` của bất kỳ ai qua 037**. | `apps/api/src/permission/data-scope.service.ts:101-109` không ép sàn nào; `payroll-route-pairs.const.ts:86` khai `companyFloor=true`; SPEC-11 §13.5 chốt hồ sơ lương "mọi grant đều Company". Fixture scope hẹp đã tồn tại: `s13-payroll-qa1-scope-floor.int-spec.ts`. | Plan §2 mục 3 — trả `isCompany(await resolveOrNull(...))` |

> **Vế `isSensitive` thì AN TOÀN** — `permission.decide.ts:251-258` chỉ nhận grant EXACT non-wildcard, `*:*`
> không thoả cổng sensitive. Lỗ B3 nằm ở **sàn scope**, không ở cổng sensitive.

---

## 2. Chín BLOCKER HIGH

| # | Vấn đề | Vá |
| --- | --- | --- |
| **B4** | 022 không khai hành vi khi `items` **VẮNG** ⇒ `allowances: mirror(dto.items ?? [])` xoá sạch phụ cấp khi client chỉ `PATCH {note}`. Thêm: hai nguồn LỆCH ở hồ sơ v1/di sản mà plan không tuyên bố | §3.2 — luật ĐÓNG "`items === undefined` ⇒ KHÔNG chạm gì"; tuyên bố tường minh **KHÔNG hoà giải** hai nguồn |
| **B5** | 043 **thiếu pagination** (SPEC-11:1225 ghi thẳng "pagination"); `computeInputsTx` là phép tính TOÀN CÔNG TY không `LIMIT` được; nhân sự **0 công 0 phép BIẾN MẤT** (CTE `people` = `att ∪ lv`, `payroll-inputs.repository.ts:192-194`) | §2 + §4 + R12/R13 — cắt trang trong TS sau sort ổn định, `total` = tổng hàng, union nhân sự còn sống để hiện hàng 0 ngày, `rowCount` audit = tổng kỳ |
| **B6** | Mở rộng `namesByUserIdsTx` bằng **JOIN** ⇒ NHÂN BẢN HÀNG: unique `employee_profiles` là **partial** `WHERE deleted_at IS NULL` (`employees.ts:98-100`) ⇒ user có nhiều hồ sơ đã xoá mềm. Code hiện hành **cố ý** dùng subquery tương quan (`payroll-people.repository.ts:37-38`) | §4.2 + R8 — subquery tương quan / `JOIN LATERAL … LIMIT 1`; ca test user 1 Active + 1 soft-deleted ⇒ đúng 1 hàng |
| **B7** | Census 2 tầng: plan bỏ sót **2 neo số** (`:204` neo BOOT `toBe(35)`, `:320` `sensitive+notSensitive` `toBe(16)`) ⇒ bước "xác nhận neo siết đúng hướng" không kiểm chứng được | §5 bước 2 — bảng đủ **6 neo** kèm dòng + 4 docblock của const |
| **B8** | Audit GHI 041/042 neo `object_id = userId` ⇒ 3 lượt tạo + 1 lượt xoá để lại 4 hàng audit **giống hệt nhau**, không truy được NPT nào | §2 — GHI neo `dependentId` (luật chung SPEC-11:740), ĐỌC 040 **giữ** `userId` (§18.1 B hàng 4 neo CHA) |
| **B9** | Mã 018 dùng `kind='formula-unknown-ref'` ⇒ FE mở **editor công thức** cho lỗi hồ sơ lương (§12.1:709 nói rõ mục đích chia mã). *Mã 018 thì WO/DB-13 thắng, không tranh cãi* | §3.3 — giữ code 018, **hai `kind` mới** `profile-item-unknown-component`/`profile-item-wrong-type` + dòng 🔁 vào SPEC-11 §12.1 + API-18 §6.5b |
| **B10** | WO `paths` không phủ `common/db-error.ts`, `contracts/src/index.ts`, `docs/SPEC/**` mà plan phải sửa ⇒ `guard-scope` cảnh báo, gate/scheduler đọc sai phạm vi | §4.2 — thêm 3 mục vào `paths` cùng lượt sửa `permissions/**`→`permission/**` |
| **B11** | 036 `q`-filter chưa chọn thiết kế ⇒ đụng bất biến điểm-chiếu danh tính + pin `rawSqlIdentity` của ratchet; plan tuyên bố "KHÔNG sửa ratchet" mà chưa ràng buộc điều kiện để tuyên bố đó đúng | §4.1 — 3 điều CẤM (không project cột danh tính · không raw `sql` chứa `full_name` · lọc bằng drizzle identifier); ghi lý do oracle-`q` không áp dụng (`companyFloor` ⇒ `peopleVisibleCond` luôn `true`) |
| **B12** | Ca ALLOW đối chứng **không tồn tại được**: seeder chỉ có **đúng MỘT** `value_type='profile_item'` (`PHU_CAP`, `payroll-master-data.seeder.ts:207-210`). Viết bừa bằng mã sai loại sẽ **ghim chính lỗ B1 mở** | §6 — fixture INSERT thẳng 1–2 hàng `salary_components` `profile_item`; **CẤM** `PC_*` trong seed catalog (nó khớp `code_shape_check` ⇒ làm ca "422" xanh RỖNG) |

---

## 3. MEDIUM / LOW đã vá

| # | Nội dung |
| --- | --- |
| M1 | R4 (envelope tối giản 041/042) **CHẤP NHẬN** nhưng căn cứ plan viết SAI: §11.3 ghi chú 8 là danh sách chống rò **TIỀN**, 041/042 không chở tiền nên không thuộc và không phá danh sách. Căn cứ đúng = **§3.12** ("NPT chỉ với `view:payroll-employee`") |
| M2 | Pin `SalaryProfileItemDto` = `{id, componentCode, componentName, kind, amount?, isActive, note}`; `componentName`/`kind` lấy từ CÙNG câu SELECT catalog của validate |
| M3 | Audit GHI 039 dùng `changedFields` (tiền lệ `salary-profiles.service.ts:175`), không `{}` (cái đó là của lượt ĐỌC 038) |
| M4 | Nhắc lại 3 luật cấp-file cho controller MỚI; `param-uuid-ratchet` `UNPIPED_CEILING=1` là **ĐẲNG THỨC** |
| M5 | `MONEY_FREE_ROUTES` 5→13 cần ca **đẳng thức** trong census (docblock không phải cổng). *Xác nhận không đổi hành vi runtime: `canSeeMoney` chỉ đọc ở `payroll.mapper.ts` 8 điểm, đều thuộc mapper 019–033* |
| M6 | `contracts/payroll.ts` = 704 dòng, +mở rộng ⇒ ~780, sát trần 800 ⇒ đặt `salaryProfileItem*Schema` ở `payroll-employees.ts` |
| M7/M8 | `PC_nnn` khớp `code_shape_check` (đã gói vào B12) · `salary_components.name` = `db/schema/payroll.ts:759` (gỡ khỏi câu hỏi mở) |

---

## 4. Những chỗ plan làm ĐÚNG — reviewer xác nhận, đừng "sửa" mất

- **`MIN_COVERED_COUNT` 508→516 ĐÚNG CHIỀU, ĐÚNG SỐ** — cơ chế đếm là *route được phủ bởi test chạm literal
  path* (`route-http-coverage.e2e-spec.ts:274-282`), `MAX_UNCOVERED_TOTAL=0` (`:324`) buộc covered == total.
- **`resolveOrNull` CÓ ép cổng sensitive** (`permission.decide.ts:251-258`) — `*:*` không thoả.
- **`@Idempotent()` trên PUT 039 chạy được** — `idempotency.interceptor.ts:145` trả 200 cho non-POST.
- **`AUDIT_OBJECT_TYPES` + CHECK DB đã sẵn sàng** (`audit.ts:192-203` + `0571:335-337`) — không phải chặn đứng.
- **`openapi-modules.ts:132`** đã có cả `"payroll"` lẫn `"payroll-periods"` — không phải sửa.
- **`route-verdicts.ts` không cần dòng mới** — cả 8 route đều có `@RequirePermission`.
- **`PAYROLL_PENDING_BE2` KHÔNG đụng** — hợp=toàn bộ ∧ giao=∅ và `pending.size===0` vẫn đúng.
- 042 không lồng dưới `:userId` + resolve `userId` **từ HÀNG** · 039 upsert khớp **đúng vị từ partial** ·
  `bankAccountLast4` là trường DẪN XUẤT, mask = **vắng khoá** · audit đọc **atomic** · census RED **trước** code ·
  R11 cấm tái dùng `pickPeopleTx` · sửa `paths` `permissions`→`permission` (xác nhận thư mục số nhiều **không
  tồn tại**) · §9 khai giả định thay vì đoán.

---

## 5. Cổng tự-mở — nghiệm thu

Reviewer chốt: **không cần vòng plan-review thứ hai** khi 12 điều kiện tự-mở-cổng xanh bằng đúng lệnh đã ghi,
cộng 3 lệnh bổ sung. Toàn bộ đã gom vào **plan §8** (khối `bash` + 9 lệnh `rg`/`git diff` nghiệm thu BLOCKER).
Ba lệnh bổ sung reviewer yêu cầu — đã có trong §8:

```bash
pnpm --filter @mediaos/api test param-uuid-ratchet
pnpm --filter @mediaos/api test identity-projection-ratchet
pnpm --filter @mediaos/api test payroll-be1-scope
```

---

## 6. Bài học rút ra (đã ghi vào memory)

1. **Cột mirror của expand-contract KHÔNG chỉ là bản sao — nó là ĐẦU VÀO của máy tính đang chạy.** Kiểm tính
   hợp lệ của nguồn mới (`items[]`) phải phủ **mọi ràng buộc ngầm của cột đích** (`allowances` chỉ được chứa
   khoản CỘNG vào gross), không chỉ ràng buộc của bảng mới.
2. **Schema Zod thiếu `.strict()` biến một lượt đổi payload thành lượt mất dữ liệu im lặng.** Khi THAY một
   khoá payload, `.strict()` là phần bắt buộc của lượt thay, không phải tuỳ chọn phong cách.
3. **Kiểm quyền cấp TRƯỜNG cũng cần SÀN SCOPE như kiểm cấp ROUTE.** `resolveOrNull(...) !== null` bỏ qua sàn
   mà route tương ứng đang ép ⇒ trường đi qua cửa hẹp hơn cửa chính.
