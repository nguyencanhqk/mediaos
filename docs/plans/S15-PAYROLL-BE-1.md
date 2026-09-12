# S15-PAYROLL-BE-1 — micro-plan (vùng ĐỎ · FULL gate · Opus)

> **WO:** BE track A — 8 route Nhân viên PAYROLL (036–043) + đổi payload hồ sơ lương v2 (020/021/022).
> **Nguồn sự thật:** `docs/SPEC/SPEC-11 PAYROLL.md` §3.12 · §8.2 · §11.3 · §12.1 · §13.5 · §15 · §15.1 · §18.1 ·
> `docs/API Design/API-18_PAYROLL_API_Design.md` §4.1b/§5b/§5.1b/§6.5b · `docs/DB/DB-13 PAYROLL Database Design.md`
> §12–§15 · `docs/permission-matrix-spec.md` §9g.2 · khuôn đã duyệt `docs/plans/S15-PAYROLL-DB-1.md` +
> `docs/plans/S15-PAYROLL-DB-1-review.md`.
>
> **🔴 TRẠNG THÁI PLAN-REVIEW:** vòng 1 (11/09/2026) = **BLOCK, 12 BLOCKER** kèm điều kiện tự-mở-cổng.
> **Bản này đã vá đủ 12/12** ⇒ PASS, **KHÔNG mở vòng 2** (CLAUDE.md §6 · memory
> `plan-review-rounds-inject-new-holes`). Mỗi mục vá mang nhãn **[B*n*]** tại chỗ; lệnh nghiệm thu gom ở §8.
> Ba BLOCKER CRITICAL là **bug thật đã xác minh trên code**, không phải rủi ro lý thuyết:
> **B1** (mirror `allowances` bơm tiền vào `gross` — `payroll-calc.repository.ts:253-258` cộng MỌI phần tử) ·
> **B2** (`createSalaryProfileSchema` thiếu `.strict()` ⇒ nuốt `allowances` im lặng) ·
> **B3** (`canRevealTaxCode` thiếu sàn scope ⇒ rò `taxCode` rộng hơn chính route sở hữu).
>
> **Số đo lúc viết plan (11/09/2026 — reviewer đo lại 13/13 ĐÚNG):** `PAYROLL_ROUTE_PAIRS` = 35 key
> (`payroll-route-pairs.const.ts:63-106`) · `PAYROLL_ERR_CODE` = 17 mã (`payroll.errors.ts:23-58`) ·
> `MIN_COVERED_COUNT` = 508 (`route-http-coverage.e2e-spec.ts:330`) ·
> `SENSITIVE_CAPABILITY_ALLOWLIST`/`SENSITIVE_SCREEN_GATE_PAIRS` = 30 mỗi bên, **17 cặp v2 ĐÃ APPEND bởi
> DB-1** (`permission.service.ts:242-258`, `:331-347`) · `AUDIT_OBJECT_TYPES` đủ 10 giá trị v2
> (`db/schema/audit.ts:192-203` + CHECK `0571:335-337`) · `common/db-error.ts` CHƯA có `23P01` (`:9-11`) ·
> `DataScopeService.resolveOrNull` CÓ SẴN (`data-scope.service.ts:101`) · `salary_components.name` tại
> `db/schema/payroll.ts:759` **[M8 — chốt, không còn là câu hỏi mở]** · schema v2 land ở
> `db/schema/payroll.ts:594-738` (mig `0570`/`0571`, PR #502).

---

## 1. Phạm vi ĐÓNG + phản-phạm-vi

**LÀM (đúng như `backlog.mjs` id `S15-PAYROLL-BE-1`):**

| # | Hạng mục | Route/vị trí |
| --- | --- | --- |
| 1 | 8 route track A mới, deny-path RED trước, guard 2 tầng | 036–043 |
| 2 | Đổi PAYLOAD (không route mới) của hồ sơ lương v2: `salaryType`/`pitPayer`/`insuranceSalary`/`probationSalary`/`payRatioPct` + `items[]` → `salary_profile_items` | 020/021/022 |
| 3 | `mapPayrollPgError` +2 nhánh DB mới (EXCLUDE `23P01`, UNIQUE `salary_profile_items_profile_component_uq`) | dùng chung ở 020/022/041/042 |
| 4 | Census 2 tầng + census mã lỗi + route-http-coverage: siết neo CÙNG COMMIT | file test nền |
| 5 | 🔻 Trả nợ DB-1 (B3/§12.2.a): mã `PC_nnn` di sản — đọc trả nguyên, ghi 422 018 | 020/022 |

**⛔ KHÔNG LÀM (thuộc BE-2/BE-4/BE-5, hoặc đã xong ở DB-1):**

- **KHÔNG đụng** `salary_components`/`payroll_templates`/`payroll_statutory_rates` CRUD, máy công thức, `preview` (044–058) — `S15-PAYROLL-BE-2`. *(Ngoại lệ ĐỌC-ONLY: BE-1 **SELECT** `salary_components` để validate + mirror `items[]` — §3.2. Không route, không ghi.)*
- **KHÔNG đụng** `payroll_advances`/`payment_batches`/`payroll_budgets`/import (059–077) — `BE-4`. **KHÔNG đụng** overview/report/PDF (078–085) — `BE-5`.
- **KHÔNG sửa** `SENSITIVE_CAPABILITY_ALLOWLIST`/`SENSITIVE_SCREEN_GATE_PAIRS` — DB-1 đã APPEND đủ 17 cặp.
- **KHÔNG viết migration mới** — `paths` không có `apps/api/migrations/**`; schema/GRANT/RLS đã có từ `0570`/`0571`. Cần một cột/CHECK không tồn tại ⇒ **CHẶN ĐỨNG**, dừng báo cáo, không tự thêm migration.
- **KHÔNG đổi** `openapi-modules.ts` — `apps/api/src/config/openapi-modules.ts:132` đã có cả `"payroll"` lẫn `"payroll-periods"`.
- **KHÔNG sửa** `identity-projection-verdicts.ts` / ratchet — xem **[B11]** ràng buộc hình dạng truy vấn để điều này đúng.
- **KHÔNG hoàn tất CONTRACT** cột `allowances` (gỡ cột) — vẫn EXPAND, dual-write tới WO sau.

---

## 2. Bản đồ 8 route

| # | Endpoint | Route key | Cặp quyền | Idem? | Audit (`object_type`/`object_id`/payload) | Mã lỗi |
| --- | --- | --- | --- | --- | --- | --- |
| 036 | `GET /payroll/employees` | `employeeList` | `('view','payroll-employee')` sensitive, Company | — | `payroll_employee` / **NULL** / `{filters, rowCount}` | — |
| 037 | `GET /payroll/employees/:userId` | `employeeDetail` | `('view','payroll-employee')` sensitive, Company | — | `payroll_employee` / `userId` / `{taxCodeRevealed:bool}` | 010 |
| 038 | `GET /payroll/employees/:userId/settings` | `employeeSettingsGet` | `('view','payroll-employee')` sensitive, Company | — | `payroll_employee_setting` / `userId` / `{}` | 010 |
| 039 | `PUT /payroll/employees/:userId/settings` | `employeeSettingsPut` | `('manage','payroll-employee')` sensitive, Company | ✅ | `payroll_employee_setting` / `userId` / `{changedFields}` **[M3]** — TÊN trường, KHÔNG giá trị, KHÔNG số TK | 010 |
| 040 | `GET /payroll/employees/:userId/dependents` | `employeeDependentList` | `('view','payroll-employee')` sensitive, Company | — | `payroll_dependent` / **`userId`** (ĐỌC — §18.1 B hàng 4 neo CHA) / `{rowCount}` | 010 |
| 041 | `POST /payroll/employees/:userId/dependents` | `employeeDependentCreate` | `('manage','payroll-employee')` sensitive, Company | ✅ | `payroll_dependent` / **`dependentId`** (GHI — **[B8]**) / `after:{userId}` | 010, **032** |
| 042 | `PATCH /payroll/dependents/:id` | `dependentUpdate` | `('manage','payroll-employee')` sensitive, Company | — | `payroll_dependent` / **`dependentId`** (GHI — **[B8]**) / `before/after:{userId, changedFields}` | 010, **032** |
| 043 | `GET /payroll-periods/:id/timesheet` | `periodTimesheet` (TÁI DÙNG pair `view-line`/`payroll-period`) | `('view-line','payroll-period')` sensitive, Company | — | `payroll_period` / `payrollPeriodId` / `{rowCount}` = **tổng hàng của KỲ**, không phải trang **[B5]** | 010 |

> **[B8] Vì sao GHI neo `dependentId`, ĐỌC neo `userId`:** §18.1 B chỉ phủ đường ĐỌC (và hàng 4 cố ý neo CHA
> để một lượt đọc cả danh sách có một vết). Đường GHI theo luật chung SPEC-11:740 — `object_id` là id của
> CHÍNH đối tượng. `payroll_dependents` là **nhiều hàng / 1 user**: neo `userId` cho GHI thì 3 lượt tạo + 1
> lượt xoá mềm để lại 4 hàng audit **giống hệt nhau**, không trả lời được "ai xoá NPT nào".

Hai route GHI hồ sơ lương (020/022) dùng thêm **422 `PAYROLL-ERR-018`** với `kind` MỚI — xem §3.

**Quyết định ĐÓNG bắt buộc:**

1. **Census 2 tầng + neo số** — §5 bước 1–2, danh sách neo đầy đủ ở **[B7]**.
2. **`canSeeMoney` / `MONEY_FREE_ROUTES`**: cả 8 route mới KHÔNG chở tiền theo DTO của chúng. 043 dùng LẠI
   cặp `view-line` — cặp mà set này ngầm coi là "chở tiền" ở route KHÁC (`periodLines`/`periodSummary`).
   **Chốt:** thêm **cả 8 key** vào `MONEY_FREE_ROUTES` (5→13), sửa docblock (`payroll-access.service.ts:32-44`)
   thành bất biến đúng: *"Set này mã hoá 'DTO của CHÍNH route này không có trường tiền nào', KHÔNG suy ngược
   được thành 'cặp gác route không chở tiền'. `periodTimesheet` là ví dụ ngược."*
   **Xác nhận không đổi hành vi runtime:** `canSeeMoney` chỉ được đọc ở `payroll.mapper.ts:50/68/115/143/188/228/299/342`,
   toàn bộ thuộc mapper 019–033; không mapper nào của 8 route mới đọc cờ này.
   **[M5] Docblock không phải cổng** ⇒ thêm ca **ĐẲNG THỨC** trong census:
   `expect([...MONEY_FREE_ROUTES].sort()).toEqual([…13 key literal…])` — cấm `toContain`.
3. **`taxCode` ở 037** — mâu thuẫn biểu kiến với JSDoc `payroll-access.service.ts:22-26` ("KHÔNG resolve thêm
   cặp phụ để biết caller có xem được TIỀN không"). **Giải quyết:**
   - JSDoc đó cấm cụ thể việc chèn cặp phụ **vào trong `resolveActor()`** để quyết định `canSeeMoney` cho một
     route chở-tiền (tránh dựng lại nhánh "mask-per-row" tiền mà SPEC cấm — §11.1 "Không có DTO nửa-mask",
     §14/§21 cấm cả viết test cho nhánh đó). `taxCode` **KHÔNG phải tiền**, và là PII thuộc không gian tài
     nguyên KHÁC (`salary-profile`) — đúng như §15.1 hàng 037 + §18.1 A đòi.
   - **Vá tường minh** — method MỚI, TÁCH KHỎI `resolveActor()`, trên `PayrollAccessService`:

     ```ts
     /** 037 — reveal `taxCode` cấp TRƯỜNG. SÀN Company BẮT BUỘC (xem dưới). */
     async canRevealTaxCode(user: PayrollRequestUser): Promise<boolean> {
       const scope = await this.dataScope.resolveOrNull(
         user.id, user.companyId, "view", "salary-profile", { isSensitive: true },
       );
       return PayrollAccessService.isCompany(scope);   // ⬅️ [B3] KHÔNG phải `scope !== null`
     }
     ```

   - 🔴 **[B3] SÀN scope Company là BẮT BUỘC, không phải tuỳ chọn.** `resolveOrNull`
     (`data-scope.service.ts:101-109`) **không ép sàn nào** — nó chỉ trả scope mạnh nhất. `salaryProfileDetail`
     khai `companyFloor=true` (`payroll-route-pairs.const.ts:86`) và SPEC-11 §13.5 chốt hồ sơ lương "mọi grant
     đều Company". Viết `!== null` ⇒ role có `view:salary-profile`@**Department** (fixture thật đã tồn tại:
     `s13-payroll-qa1-scope-floor.int-spec.ts`) bị **403 ở 019/021** nhưng **đọc được `taxCode` của BẤT KỲ ai
     qua 037** — rò PII rộng hơn chính route sở hữu dữ liệu.
   - Vế `isSensitive` thì AN TOÀN: `permission.decide.ts:251-258` tính `effectivelySensitive` và chỉ nhận
     grant EXACT non-wildcard ⇒ `*:*` **không** thoả. Lỗ chỉ ở sàn scope.
   - **Dùng `resolveOrNull`, KHÔNG `resolveAndAssert`** — đây là kiểm MỀM cấp TRƯỜNG; dùng nhầm biến "không
     được xem MST" thành **403 cả route 037**.
   - **Sửa JSDoc TẠI CHỖ** (`:22-26`): nối đoạn nói rõ ranh giới — cấm áp dụng CHO TIỀN bên trong
     `resolveActor`; field-reveal PII khác-tài-nguyên sống ở method riêng có tên tường minh + **có sàn scope
     riêng**, KHÔNG bao giờ gộp vào `canSeeMoney`.
4. **`bankAccountLast4`** — trường DẪN XUẤT tại mapper (`bankAccountNumber?.slice(-4) ?? null`), KHÔNG cột,
   KHÔNG bao giờ trả `bankAccountNumber` ở BẤT KỲ DTO nào của BE-1 (kể cả response 039). Mask = **VẮNG KHOÁ**,
   không phải `null` (memory `server-masking-needs-optional-fe-schema`).
5. **Audit ĐỌC atomic** cho 036/037/038/040/043 — cùng tx với lượt đọc ⇒ rollback thì 0 hàng audit.
6. **039 upsert 1 hàng/nhân sự** — `INSERT … ON CONFLICT (company_id, user_id) WHERE deleted_at IS NULL DO
   UPDATE SET …`, target khớp ĐÚNG vị từ partial unique `payroll_employee_settings_user_uq`
   (`db/schema/payroll.ts:672-674`). KHÔNG select-rồi-branch.
7. **042 KHÔNG lồng dưới `:userId`** — controller riêng `@Controller("payroll/dependents")`; `userId` resolve
   TỪ HÀNG đã fetch (`before.userId`), không từ path param.
8. **Envelope GHI 039/041/042 = `{id, warnings}`, 0 khoá PII.**
   **[M1] Căn cứ ĐÚNG là §3.12, KHÔNG phải §11.3 ghi chú 8.** Danh sách ĐÓNG 7 route của §11.3 là danh sách
   chống rò **TIỀN**; 041/042 không chở tiền nên chúng **không thuộc** danh sách đó và việc thu hẹp phản hồi
   **không phá** danh sách. Căn cứ thật: **§3.12 (`SPEC-11:172`)** — "NPT (họ tên · MST NPT) **chỉ với**
   `('view','payroll-employee')`" ⇒ trả PII cho caller chỉ có `manage` là vi phạm §3.12 TRỰC TIẾP.
   *(Invariant seed `manage⇒view` của §11.3 ghi chú 7 **không phủ** `payroll-employee` — §9 mục 6.)*
   039 giữ nguyên (đã nằm trong danh sách 7 route). Khai envelope vào `packages/contracts/src/payroll-employees.ts`
   **và** API-18 §5b/§6.5b cùng commit, kẻo "danh sách ĐÓNG" trôi.

---

## 3. Thay đổi `salary_profiles` — 020/021/022

### 3.1 Payload TRƯỚC/SAU

| | v1 (hiện tại) | v2 (BE-1) |
| --- | --- | --- |
| 020 create | `{userId, effectiveDate, baseSalary, allowances[], note?}` — **KHÔNG `.strict()`** (`payroll.ts:206-212`) | THÊM `salaryType?`·`pitPayer?`·`insuranceSalary?`·`probationSalary?`·`payRatioPct?` · **THAY** `allowances[]` → `items[]` · **THÊM `.strict()` [B2]** |
| 022 update | `{effectiveDate?, baseSalary?, allowances?, note?, delete?}` `.strict()` | THÊM 5 field (optional) · **THAY** `allowances?` → `items?` — CÓ MẶT ⇒ đặt lại TOÀN BỘ; **VẮNG ⇒ không chạm gì [B4]** |
| Response 019/021 | `{…, baseSalary?, allowances?, note, …}` | THÊM 5 field (mask theo `canSeeMoney`) + `items?: SalaryProfileItemDto[]` — **GIỮ** `allowances?` |

🔴 **[B2] `createSalaryProfileSchema` PHẢI thêm `.strict()` cùng commit.** Hiện nó không `.strict()` (chỉ
`updateSalaryProfileSchema:220-228` có) ⇒ Zod **strip** khoá lạ ⇒ client cũ gửi `allowances` nhận **201 với 0
phụ cấp** — mất tiền, không lỗi, đúng hình dạng `empty-success-is-the-fail-open-shape`. Sau khi `.strict()`:
gửi `allowances` ⇒ **400 `VALIDATION-ERR-001`**, người dùng biết ngay phải đổi sang `items[]`.

**[M2] DTO đọc** — `salaryProfileItemSchema = {id, componentCode, componentName, kind, amount?, isActive, note}`;
`amount` mask theo `canSeeMoney` (vắng khoá). `componentName`/`kind` lấy từ **CÙNG câu SELECT catalog** của
validate (§3.2), không đẻ câu thứ hai. **[M6]** Đặt `salaryProfileItem*Schema` ở
`packages/contracts/src/payroll-employees.ts` rồi re-export — `payroll.ts` đang **704** dòng, nhồi tiếp là
~780, sát trần 800 của CLAUDE.md §5.

Input: `salaryProfileItemInputSchema = {componentCode: string().min(1).max(32), amount: number().nonnegative(),
isActive: boolean().default(true), note: string().max(500).optional()}`. `items` default `[]` ở 020.

### 3.2 Luật dual-write / dual-read — CHỐT ĐÓNG

🔴 **[B1] Validate `componentCode` có BA điều kiện, không phải một.** Component phải:
(a) tồn tại trong `salary_components` company-scoped · (b) `deleted_at IS NULL` · (c) **`value_type = 'profile_item'`**.
Trượt (a)/(b) ⇒ **422 018 `kind='profile-item-unknown-component'`**; trượt (c) ⇒ **422 018
`kind='profile-item-wrong-type'`**.

> **Vì sao (c) là CRITICAL, không phải khắt khe thừa:** `payroll-calc.repository.ts:253-258` cộng **MỌI** phần
> tử `allowances[].amount` vào `allw.amt` → `gross`. Catalog seed có `kind='deduction'`
> (`payroll-master-data.seeder.ts:217-222` `NGHI_KHONG_LUONG`), `statutory_employee` (`:273` `DOAN_PHI`),
> `tax` (`:304` `TNCN`), 4 `aggregate` (`:228/:284/:294/:317`). Không có (c) thì
> `items:[{componentCode:"TNCN", amount:5000000}]` **qua validate**, được mirror, và nhân viên được **CỘNG**
> 5 triệu thay vì bị trừ thuế. Lọc theo `value_type` (không theo `kind`) vì `profile_item` là **đúng một** giá
> trị và nó chính là nghĩa "số do hồ sơ lương cấp".

🔴 **[B1] Mirror CHỈ item `is_active = true`.** Item `isActive:false` vẫn ghi xuống `salary_profile_items`
(giữ lịch sử) nhưng **KHÔNG** vào `allowances` ⇒ không vào `gross`. Thiếu vế này thì "tắt một phụ cấp" vẫn
trả tiền.

- **GHI THẮNG:** `items[]` từ client là nguồn THẬT, ghi thẳng vào `salary_profile_items`.
- **Validate TRƯỚC khi mở transaction ghi** — một câu `SELECT code, name, kind, value_type FROM
  salary_components WHERE company_id=? AND code = ANY(?) AND deleted_at IS NULL` (memory
  `drizzle-array-bind-sql-param`). `details[]` là **mảng `ErrorDetail{field,message,rule}`** nêu từng
  `componentCode` sai (memory `error-details-must-be-errordetail-array`). KHÔNG mở tx ghi khi có lỗi.
  - **🔻 Nợ DB-1 (§12.2.a):** mã `PC_nnn` do backfill 0570 sinh KHÔNG có trong `salary_components` ⇒ "lưu lại
    y nguyên" một hồ sơ di sản trả **422**, KHÔNG 200, KHÔNG 500, KHÔNG im lặng mất dòng. Ca test §6.
- **Mirror-write `allowances` jsonb** (CÙNG tx, SAU validate): với mỗi item **thoả (c) VÀ `isActive`**, ghi
  `{name: <salary_components.name>, amount}` — `name` lấy từ CHÍNH câu validate (`payroll.ts:759`).
- **022 "đặt lại toàn bộ"** trong MỘT tx: `UPDATE salary_profile_items SET deleted_at=now(), deleted_by=actor
  WHERE company_id=? AND salary_profile_id=? AND deleted_at IS NULL` rồi `INSERT` tập mới (an toàn với UNIQUE
  partial `WHERE deleted_at IS NULL`). `allowances` mirror = tập MỚI.
- 🔴 **[B4] `items === undefined` ở 022 ⇒ KHÔNG chạm `salary_profile_items` VÀ KHÔNG chạm cột `allowances`.**
  Viết `allowances: mirror(dto.items ?? [])` là **xoá sạch phụ cấp trong im lặng** khi client chỉ
  `PATCH {note:"x"}` — và kỳ sau trả lương thiếu. Đây là luật ĐÓNG, không phải chi tiết triển khai.
- **ĐỌC (019/021):** `items[]` = SELECT `salary_profile_items … deleted_at IS NULL` (nguồn CANONICAL, join
  catalog lấy `componentName`/`kind`). `allowances` = đọc THẲNG cột `salary_profiles.allowances`, **không**
  tính lại từ `items[]`.
- 🔴 **[B4] Tuyên bố tường minh về LỆCH hai nguồn:** `items[]` là nguồn canonical của v2. Hồ sơ **chưa qua
  đường ghi v2** có thể có `allowances` mà **0 `items`** (ví dụ fixture INSERT thẳng —
  `payroll-be2-lifecycle.int-spec.ts:345`), hoặc có `items` mã `PC_nnn` **cạnh** `allowances` gốc (hồ sơ di
  sản sau backfill). **Đường đọc trả NGUYÊN cả hai, KHÔNG hoà giải, KHÔNG suy diễn.** Hoà giải lúc đọc là đẻ
  nguồn sự thật thứ ba; hoà giải lúc ghi là sửa dữ liệu người dùng không yêu cầu.

### 3.3 `mapPayrollPgError` — nhánh mới

| Ràng buộc (TÊN thật) | SQLSTATE | ⇒ HTTP | Mã + `kind` |
| --- | --- | --- | --- |
| `salary_profile_items_profile_component_uq` | `23505` | 409 | `SALARY_EFFECTIVE_EXISTS` (014) `profile-item-duplicate` |
| `payroll_dependents_no_overlap_excl` | **`23P01`** (MỚI — thêm `PG_EXCLUSION_VIOLATION` vào `common/db-error.ts`, hiện chỉ 23505/23503/23514) | 409 | `DEPENDENT_OVERLAP` (032, MỚI) `dependent-overlap` |
| `payroll_employee_settings_bank_pair_check` | `23514` | — | `null` (Zod `.refine` lưới đầu ⇒ 400) |
| `salary_profile_items_amount_check` | `23514` | — | `null` (Zod `.nonnegative()` lưới đầu) |

🔴 **[B9] Mã 018 GIỮ, `kind` phải MỚI.** WO `done_when` #7 (`backlog.mjs:15917`) và DB-13 §12.2.a (`:584`) đều
chốt **mã 018** ⇒ mã thì **WO/DB-13 thắng**, không tranh cãi. Nhưng `kind` thì KHÔNG được mượn
`formula-unknown-ref`: §12.1 (`SPEC-11:690`) định nghĩa 018 là "**Công thức** không hợp lệ lúc LƯU", và `:709`
nói rõ mục đích chia mã là để FE biết mở **editor công thức** hay mở dòng lương. Ném `formula-unknown-ref` từ
`salary_profile_items.component_code` khiến FE mở editor công thức cho một lỗi hồ sơ lương.
⇒ **hai `kind` mới: `profile-item-unknown-component` · `profile-item-wrong-type`**, kèm **một dòng 🔁 vào
SPEC-11 §12.1 hàng 018 + API-18 §6.5b cùng commit**.

---

## 4. File TẠO / SỬA

### 4.1 TẠO mới

| File | Việc | Dòng |
| --- | --- | --- |
| `apps/api/src/payroll/payroll-employees.repository.ts` | 036 list (filter + pagination THẬT ở SQL — **[B11]** hình dạng bắt buộc dưới) + 037 existence | ~190 |
| `apps/api/src/payroll/payroll-employees.service.ts` | 036/037: access + repo + `canRevealTaxCode` + audit | ~140 |
| `apps/api/src/payroll/payroll-employees.mapper.ts` | DTO + spread có điều kiện cho `taxCode` (VẮNG KHOÁ) | ~70 |
| `apps/api/src/payroll/payroll-employee-settings.repository.ts` | 038 get + 039 upsert `ON CONFLICT` | ~110 |
| `apps/api/src/payroll/payroll-employee-settings.service.ts` | orchestration + audit `changedFields` + `mapPayrollPgError` | ~110 |
| `apps/api/src/payroll/payroll-dependents.repository.ts` | 040 list + 041 create + 042 update/soft-delete | ~160 |
| `apps/api/src/payroll/payroll-dependents.service.ts` | orchestration + audit + 404 sentinel + `23P01` | ~160 |
| `apps/api/src/payroll/payroll-employees.controllers.ts` | `PayrollEmployeesController` (036–041) + `PayrollDependentsController` (042) — **[M4]** 3 luật cấp-file dưới | ~180 |
| `packages/contracts/src/payroll-employees.ts` | schema list/detail/settings/dependents/timesheet + write-result + **[M6]** `salaryProfileItem*Schema` | ~260 |
| `apps/api/test/integration/payroll-be1-employees.int-spec.ts` | RED 036/037 deny/allow/taxCode/IDOR/soft-delete | ~270 |
| `apps/api/test/integration/payroll-be1-employee-settings.int-spec.ts` | RED 038/039 | ~200 |
| `apps/api/test/integration/payroll-be1-dependents.int-spec.ts` | RED 040/041/042 + audit object_id | ~270 |
| `apps/api/test/integration/payroll-be1-timesheet.int-spec.ts` | RED 043 + pagination | ~170 |
| `apps/api/test/integration/payroll-be1-legacy-items.int-spec.ts` | Nợ DB-1 + B1 + B4 + 014 duplicate | ~220 |

🔴 **[B11] Hình dạng ĐÓNG của `payroll-employees.repository.ts` — ba điều cấm, để bất biến điểm-chiếu và
ratchet `identity-projection` vẫn đúng mà KHÔNG phải sửa ratchet:**

1. **KHÔNG `.select()` cột danh tính** (`users.fullName`, `employee_code`) — tên vẫn lấy qua
   `PayrollPeopleRepository.namesByUserIdsTx` (bất biến `payroll-people.repository.ts:10-13`: không nơi nào
   khác trong `payroll/**` được select hai cột đó).
2. **KHÔNG raw `sql` chứa `full_name`** — `identity-projection-census.ts:383-384,452` đếm `sql` template chứa
   `full_name` vào `blindSpots().rawSqlIdentity`, và ratchet pin `toBeLessThanOrEqual`
   (`identity-projection-ratchet.unit-spec.ts:164-166`). Một hit mới = ĐỎ.
3. **Lọc/sắp bằng drizzle identifier**: `ilike(users.fullName, …)` / `ilike(employeeProfiles.employeeCode, …)`
   — kind = PREDICATE/ORDER, **không** vào `projectionPoints()`. Pagination `LIMIT/OFFSET` + `COUNT` thật ở SQL.

> **Vì sao "oracle-`q`" của picker KHÔNG áp dụng ở đây:** `pickPeopleTx` lọc `q` **SAU khi bọc cột**
> (`:111-113`) vì cặp của nó (`view:salary-profile`) có thể rơi vào scope hẹp ⇒ người không được xem tên vẫn
> dò được tên bằng cách thử `q`. Cặp 036 khai `companyFloor=true` ⇒ `resolveActor` đã 403 mọi scope hẹp hơn
> Company ⇒ `peopleVisibleCond` **luôn** `sql\`true\`` ⇒ không có oracle nào để rò. Ghi lý do tại chỗ trong file.

### 4.2 SỬA

| File | Việc | Bằng chứng |
| --- | --- | --- |
| `apps/api/src/payroll/payroll-route-pairs.const.ts` | +8 key (⇒43); `MONEY_FREE_ROUTES` +8 (5→13); **[B7]** docblock `:10` "35"→"43", `:16` "16 cặp có route"→18, `:18` "13 cặp"→15, neo `:117` 35→43 | `:62`,`:106`,`:117` |
| `apps/api/src/payroll/payroll-access.service.ts` | + `canRevealTaxCode()` **có sàn Company [B3]**; sửa JSDoc `:22-26` + docblock `MONEY_FREE_ROUTES` | `:22-44`,`:56-60` |
| `apps/api/src/payroll/payroll.errors.ts` | +2 `PAYROLL_ERR_CODE` (018, 032) + 2 `kind` mới **[B9]** + 2 nhánh map | `:23-58`,`:173-268` |
| `apps/api/src/common/db-error.ts` | + `PG_EXCLUSION_VIOLATION = "23P01"` | `:9-11` |
| `apps/api/src/payroll/payroll-people.repository.ts` | +3 cột qua **subquery TƯƠNG QUAN / `JOIN LATERAL … LIMIT 1`**, **KHÔNG JOIN thẳng [B6]** | `:37-38`,`:54-59` |
| `apps/api/src/payroll/payroll.types.ts` | mở rộng `PayrollPersonRef` | `:46-50` |
| `apps/api/src/payroll/payroll-periods.service.ts` | + `timesheet()` (043) **có pagination [B5]** | 312 dòng, +~75 |
| `apps/api/src/payroll/payroll.controllers.ts` | + `@Get(":id/timesheet")` TRƯỚC `:id` catch-all | 580 dòng, +~15 |
| `apps/api/src/payroll/payroll.module.ts` | +6 provider, +2 controller | `:50-90` |
| `apps/api/src/payroll/payroll.dto.ts` | +~10 DTO class | 57 dòng |
| `apps/api/src/payroll/salary-profiles.repository.ts` | `items[]` + validate 3 điều kiện **[B1]** + mirror có lọc + luật `undefined` **[B4]** | `:128-201` |
| `apps/api/src/payroll/salary-profiles.service.ts` | wire validate + dual-write + đọc `items[]` | toàn file |
| `apps/api/src/payroll/payroll.mapper.ts` | +5 field +`items[]` | `:44-72` |
| `packages/contracts/src/payroll.ts` | mở rộng 4 schema + **`.strict()` cho create [B2]** | `:178-238` |
| `packages/contracts/src/index.ts` | `export * from "./payroll-employees"` | `:126` |
| `apps/api/test/foundation/payroll-two-layer-guard-census.unit-spec.ts` | **[B7]** 6 neo — xem §5 bước 2 | — |
| `apps/api/test/foundation/payroll-error-code-census.unit-spec.ts` | `all.size` 17→19 | `:99-110` |
| `apps/api/test/foundation/route-http-coverage.e2e-spec.ts` | `MIN_COVERED_COUNT` 508→**516** | `:330` |
| `harness/backlog.mjs` | **[B10]** `permissions/**`→`permission/**` + THÊM `apps/api/src/common/db-error.ts` · `packages/contracts/src/index.ts` · `docs/SPEC/SPEC-11 PAYROLL.md`; `status` | ~`:15894-15902` |
| `docs/SPEC/SPEC-11 PAYROLL.md` | **[B9]** dòng 🔁 ở §12.1 hàng 018 | `:690` |
| `docs/API Design/API-18_PAYROLL_API_Design.md` | §4.2 dòng 343 (036–043 ❌→✅) + §5b/§6.5b envelope + `kind` mới | `:343` |

> **[B10]** `apps/api/src/permissions/` (số nhiều) **không tồn tại** (Glob = 0 file) — cùng bug DB-1 đã vá ở B5.
> `paths` hiện KHÔNG phủ `common/db-error.ts`, `contracts/src/index.ts`, `docs/SPEC/**` mà plan phải sửa
> ⇒ `guard-scope` cảnh báo và gate/scheduler đọc sai phạm vi (memory `wo-paths-drive-gate-and-scheduler`).

**[M4] Ba luật cấp-file cho controller MỚI** (`payroll.controllers.ts:59-64`): `@UseGuards(PermissionGuard)`
**từng route** (guard KHÔNG phải APP_GUARD ⇒ `@RequirePermission` một mình chỉ là trang trí) ·
`@UsePipes(ZodValidationPipe)` **cấp METHOD** (cấp class không validate gì) · `@Param("userId"/"id",
ParseUUIDPipe)` cho **từng** route — `param-uuid-ratchet.unit-spec.ts:67,190-197` đặt `UNPIPED_CEILING=1` và ca
(3) là **ĐẲNG THỨC**, không còn chỗ trống. `@Idempotent()` đúng **039 · 041**. Cặp đọc TỪ `PAYROLL_ROUTE_PAIRS`,
truyền `isSensitive` tường minh.

---

## 5. Thứ tự thi công + cổng tự kiểm

1. **Khai 8 key + 2 mã lỗi + 2 `kind` TRƯỚC khi viết route** — `payroll-route-pairs.const.ts` ·
   `payroll.errors.ts` · `common/db-error.ts`. Cổng: `pnpm --filter @mediaos/api typecheck`.
2. **Sửa census 2 tầng TRƯỚC khi code service (RED thật)** — **[B7] đủ 6 neo số**, đo tại
   `payroll-two-layer-guard-census.unit-spec.ts`:

   | Dòng | Neo hiện tại | ⇒ |
   | --- | --- | --- |
   | `:204` | `expect(payrollRoutes.length).toBe(35)` (neo BOOT) | **43** |
   | `:234` | `calls.length >= 36` | **>= 44** |
   | `:270` | `all.size` 35 | **43** |
   | `:283` | `used.size` 35 | **43** |
   | `:318` | sensitive 13 | **15** |
   | `:320` | `sensitive.size + notSensitive.size` 16 | **18** |

   Cộng: +8 `ROUTE_TO_KEY`, +2 `PAYROLL_CONTROLLERS`, +8 `SERVICE_SITE_TO_KEYS`, **[M5]** ca đẳng thức
   `MONEY_FREE_ROUTES`. **KHÔNG đụng `PAYROLL_PENDING_BE2`** (hợp=toàn bộ ∧ giao=∅ và `pending.size===0` vẫn
   đúng — cả 8 key lên dây trong CHÍNH WO này).
   Cổng: `pnpm --filter @mediaos/api test payroll-two-layer-guard-census` — **PHẢI ĐỎ** ngay bây giờ.
3. **Contracts trước backend** — `payroll-employees.ts` (mới) + mở rộng `payroll.ts` + **`.strict()` [B2]**.
   Cổng: `pnpm --filter @mediaos/contracts build` (dual ESM/CJS — memory `stale-contracts-dist-typecheck-false-red`).
4. **Repository → Service → Controller, TỪNG CỤM, RED trước mỗi cụm** — A (036/037) · B (038/039) ·
   C (040/041/042) · D (043). Cổng sau MỖI cụm: int-spec cụm đó xanh với `LANE_DB` đã export.
5. **020/021/022 payload v2** — `payroll-be1-legacy-items.int-spec.ts` RED (gồm B1/B4/nợ DB-1) → sửa
   `salary-profiles.*` + `payroll.mapper.ts`. Cổng hồi quy **đích danh [B2]**:
   `pnpm --filter @mediaos/api test payroll-be1-scope` — file `payroll-be1-scope.int-spec.ts:365` và `:504` là
   **nơi DUY NHẤT** gửi `allowances` qua HTTP tới 020 rồi assert lại; cộng 3 int-spec `payroll-be2-*` không đỏ thêm.
6. **Census mã lỗi + route-http-coverage** — `17→19`, `508→516`. Đăng ký module TRƯỚC khi bump (R7); chạy
   census xác nhận tổng route tăng **đúng +8** rồi mới sửa hằng.
7. **`harness/backlog.mjs`** (paths **[B10]** + status) + SPEC-11 §12.1 🔁 + API-18.
8. **Cổng toàn cục** — §8.

---

## 6. Ma trận test RED-trước

| Cụm | Ca DENY | Ca ALLOW đối chứng | File |
| --- | --- | --- | --- |
| 036/037 | thiếu `view:payroll-employee` ⇒ 403 · `*:*` KHÔNG thoả sensitive ⇒ 403 · scope hẹp hơn Company ⇒ 403 | officer/admin có cặp ⇒ **200** + đủ 5 trường | `payroll-be1-employees` |
| **037 taxCode [B3]** | có `view:payroll-employee`@Company + `view:salary-profile`@**Department** ⇒ **200** và `"taxCode" in dto === false` (KHÔNG 403 cả route) | cùng role ở `view:salary-profile`@**Company** ⇒ `taxCode` CÓ mặt + audit `taxCodeRevealed:true` | cùng file |
| 037 IDOR | `:userId` company KHÁC ⇒ **404** (010), KHÔNG 403 | cùng company ⇒ 200 | cùng file, cụm riêng |
| **036 soft-delete [B6]** | user có **1 hồ sơ Active + 1 hồ sơ soft-deleted** ⇒ trả **đúng 1 hàng**, `pagination.total` đếm **1** | user 1 hồ sơ ⇒ 1 hàng | cùng file |
| 036 "officer 0 cặp HR" | role CHỈ `view/manage:payroll-employee` ⇒ **VẪN 200** đủ org-unit/position/status | (ca allow trên) | cùng file |
| 038/039 | thiếu `manage` gọi PUT ⇒ 403 · thiếu `view` gọi GET ⇒ 403 | đủ cặp ⇒ 200; PUT trả envelope KHÔNG khoá `bankAccountNumber` | `payroll-be1-employee-settings` |
| 039 bank pair | có `bankAccountNumber`, thiếu `bankName`/`accountHolder` ⇒ 400 (Zod TRƯỚC DB) | đủ ba ⇒ 200; GET trả `bankAccountLast4` đúng 4 số, **vắng khoá** số đầy đủ | cùng file |
| 039 upsert | PUT 2 lần khác nội dung ⇒ `count(*)` vẫn **=1**, giá trị = lần 2 | — | cùng file |
| 040/041/042 | thiếu cặp ⇒ 403 · khác tenant ⇒ 404 | đủ cặp cùng tenant ⇒ 200/201 | `payroll-be1-dependents` |
| 041/042 overlap | 2 NPT cùng `full_name` chồng khoảng (kể cả `effective_to=NULL`) ⇒ **409 032**, KHÔNG 500 | 2 NPT **khác tên** chồng khoảng ⇒ 201/200 (EXCLUDE không chặn nhầm) | cùng file |
| **041/042 audit [B8]** | sau POST: `SELECT object_id FROM audit_logs WHERE object_type='payroll_dependent' AND action='create' ORDER BY created_at DESC LIMIT 1` **=== id NPT vừa tạo** | sau GET 040: hàng `action='read'` có `object_id === userId` | cùng file |
| 041/042 leak PII **[M1]** | role CHỈ `manage` (không `view`) ⇒ response KHÔNG chứa `fullName`/`dependentTaxCode` | role có CẢ HAI: GET 040 thấy đúng NPT vừa tạo | cùng file, cụm riêng |
| 043 | thiếu `view-line` ⇒ 403 · period khác tenant ⇒ 404 | đủ cặp ⇒ 200, `rows` KHỚP `computeInputsTx` (so trực tiếp, KHÔNG mock) | `payroll-be1-timesheet` |
| **043 pagination [B5]** | 3 NV có công + 1 NV 0 công → `per_page=2&page=2` ⇒ `data.length===2`, `pagination.total` = số đã chốt | ca riêng cho NV 0-công theo quyết định §2 | cùng file |
| 043 không-tiền | response KHÔNG có trường tiền nào dù `canSeeMoney=true` | — | cùng file |
| **B1 lọc loại** | `items:[{componentCode:"TNCN",…}]` ⇒ **422** · `{"NGHI_KHONG_LUONG"}` ⇒ **422** | `items:[{componentCode:"PHU_CAP",…}]` ⇒ **200** | `payroll-be1-legacy-items` |
| **B1 isActive** | item `isActive:false` ⇒ 200 **VÀ** `jsonb_array_length(allowances)` = **0** **VÀ** sau `calculate`, `payroll_period_lines.allowance_amount` = **0** | item `isActive:true` ⇒ `allowances` có 1 phần tử, `allowance_amount` > 0 | cùng file |
| **B4 items vắng** | seed hồ sơ 2 `items` + `allowances` 2 dòng → `PATCH {note:"x"}` ⇒ 200 **VÀ** `count(*) salary_profile_items … deleted_at IS NULL` = **2** **VÀ** `jsonb_array_length(allowances)` = **2** | `PATCH {items:[…1 dòng]}` ⇒ count = 1 | cùng file |
| **B2 strict** | `POST /salary-profiles {allowances:[…]}` ⇒ **400 `VALIDATION-ERR-001`** | `POST {items:[…]}` ⇒ **201** | cùng file + `payroll-be1-scope` |
| Nợ DB-1 | seed `salary_profile_items.component_code='PC_001'` → GET ⇒ **200**, `items[]` có `PC_001` kèm `note` → `PATCH` lưu y nguyên ⇒ **422 018 `profile-item-unknown-component`** | `PATCH` với mã catalog THẬT ⇒ 200 | cùng file |
| 014 duplicate | `items[]` 2 phần tử **cùng** `componentCode` ⇒ **409 014** `profile-item-duplicate` (từ 23505, KHÔNG 500) | 2 phần tử **khác** mã, **cả hai `profile_item`** ⇒ 200 | cùng file |

🔴 **[B12] Fixture PHẢI tự tạo ≥2 component hợp lệ.** Seeder chỉ có **đúng MỘT** `value_type='profile_item'`
là `PHU_CAP` (`payroll-master-data.seeder.ts:207-210`); cộng với B1, ca ALLOW "2 phần tử khác mã ⇒ 200" và
"`PATCH` với mã catalog THẬT" **không viết được** từ seed — và nếu viết bừa bằng một mã sai loại thì nó
**ghim chính lỗ B1 mở** (`tests-can-pin-a-hole-open`). ⇒ int-spec **INSERT thẳng 1–2 hàng `salary_components`
`value_type='profile_item'`** (BE-2 chưa có route tạo).
⚠️ **CẤM dùng mã dạng `PC_*` trong seed catalog của fixture**: `PC_001` **khớp**
`salary_components_code_shape_check` (`db/schema/payroll.ts:790`) nên seed nhầm làm ca "lưu lại y nguyên ⇒ 422"
xanh **RỖNG**. `PC_*` chỉ được xuất hiện ở khối seed `salary_profile_items` (di sản).

**Chống xanh-rỗng:** mọi cụm DENY có ca ALLOW đối chứng NGAY CẠNH (`deny-cases-vacuous-without-allow-case`);
mọi ca ALLOW assert **mã cụ thể** (200/201), cấm `.not.toBe(403)` (`allow-counter-case-not-403-lets-500-through`).
Ca deny phải có **đúng MỘT** cổng đang chặn — fixture cho ca "scope hẹp" PHẢI có cặp, chỉ khác `data_scope`
(`overdetermined-gate-makes-deny-spec-vacuous`).

---

## 7. Rủi ro + cách né

| # | Rủi ro | Né bằng | Memory |
| --- | --- | --- | --- |
| R1 | Census 2 tầng đỏ oan vì tên method lệch `SERVICE_SITE_TO_KEYS` | Đặt tên method CHÍNH XÁC theo §2 TRƯỚC khi viết service; census ĐỎ ở bước 2, xanh SAU | `two-layer-pair-census-must-be-per-route` |
| R2 | `canRevealTaxCode` lỡ dùng `resolveAndAssert` ⇒ 403 cả route | Ca §6 hàng "037 taxCode": thiếu scope **KHÔNG được 403** | §2 mục 3 |
| R3 | Ca overlap chỉ test POST, quên PATCH | §6 có dòng cho CẢ 041 lẫn 042 | `deny-cases-vacuous-without-allow-case` |
| R5 | `mapPayrollPgError` sót `23P01` vì hằng chưa tồn tại | Thêm hằng TRƯỚC khi viết nhánh; ca kích hoạt EXCLUDE THẬT ở DB (không mock) | `drizzle-wraps-pg-error-code-in-cause` |
| R6 | `.strict()` chặn nhầm `items` nếu quên mở rộng contract trước | Thêm field ở BƯỚC 3 (trước backend); giữ ca 400 cho khoá LẠ thật | — |
| R7 | Quên đăng ký controller ⇒ route không tồn tại runtime, bump sàn gây ĐỎ vĩnh viễn | Đăng ký module TRƯỚC; xác nhận tổng route **+8** rồi mới sửa hằng | `route-census-runtime-gate` |
| R8 | Mở rộng `namesByUserIdsTx` lỡ SELECT `users.email` | Chỉ lấy 3 cột `employee_profiles`/`org_units`/`positions`; chạm `users.email` ⇒ ratchet ĐỎ (đúng thiết kế) | `identity-projection-census.ts:32` |
| R9 | Catalog company-scoped chưa seed (seed RUNTIME, runner NUỐT throw) ⇒ `items[]` bị 422 oan | Không phải lỗi BE-1 (nợ khai ở done_when BE-2/BE-3); BE-1 fail **LOUD đúng mã** (422 018), không 500, không "thành công mà rỗng". Ca: company chưa seed + tạo hồ sơ KHÔNG `items[]` ⇒ vẫn 200 | `empty-success-is-the-fail-open-shape` |
| R10 | 022 validate ngoài tx ⇒ race vỡ UNIQUE | Validate + soft-delete + insert + mirror trong CÙNG `withTenant` tx | — |
| R11 | 036 phân trang in-memory ⇒ trang 2+ sai ở công ty lớn | 036 phân trang THẬT ở SQL; **KHÔNG** tái dùng `pickPeopleTx` (picker có trần) | `payroll-people.repository.ts:110-140` |
| **R12 [B5]** | 043 phân trang in-memory trên phép tính TOÀN CÔNG TY | Thừa nhận tường minh: `computeInputsTx` không `LIMIT` được (CTE `people` = `att ∪ lv`); cắt trang trong TS sau `sort` ổn định theo `userId`, `total` = tổng hàng; ghi câu NFR dựa vào trần 500 NV < 5s của §19. **Nếu vượt trần ⇒ WO riêng**, không tự viết aggregation thứ hai (WO cấm) | `nplus1-test-must-count-queries-not-builders` |
| **R13 [B5]** | Nhân sự **0 công 0 phép BIẾN MẤT** khỏi bảng công — CTE `people` = `att ∪ lv` (`payroll-inputs.repository.ts:192-194`) | Quyết định tường minh + ca test: **hiện hàng 0 ngày** (union thêm nhân sự còn sống qua `aliveUserIdsTx`) — bảng công thiếu người là người đó **không được trả lương** mà không ai thấy | `empty-success-is-the-fail-open-shape` |
| **R14 [B1]** | Mirror bơm tiền vào `gross` | 3 điều kiện validate + lọc `isActive` khi mirror; ca `TNCN` ⇒ 422 và ca `isActive:false` ⇒ `allowance_amount=0` | `ui-promises-backend-never-reads` (họ hàng) |

---

## 8. Cổng phải XANH trước khi mở PR

```bash
pnpm --filter @mediaos/contracts build && pnpm --filter @mediaos/contracts typecheck
pnpm --filter @mediaos/api typecheck
pnpm --filter @mediaos/api lint
bash scripts/lane-db-setup.sh s15be1 --reset
export LANE_DB=mediaos_s15be1
pnpm --filter @mediaos/api test payroll-two-layer-guard-census
pnpm --filter @mediaos/api test payroll-error-code-census
pnpm --filter @mediaos/api test route-http-coverage
pnpm --filter @mediaos/api test param-uuid-ratchet           # [M4]
pnpm --filter @mediaos/api test identity-projection-ratchet  # [B11]
pnpm --filter @mediaos/api test payroll-be1-scope            # [B2] hồi quy payload 020/022
pnpm --filter @mediaos/api test payroll-be1-employees
pnpm --filter @mediaos/api test payroll-be1-employee-settings
pnpm --filter @mediaos/api test payroll-be1-dependents
pnpm --filter @mediaos/api test payroll-be1-timesheet
pnpm --filter @mediaos/api test payroll-be1-legacy-items
bash harness/check.sh --lane-db=s15be1
```

**Nghiệm thu 12 BLOCKER (grep tái lập được):**

```bash
rg -n "profile-item-unknown-component|profile-item-wrong-type" apps/api/src/payroll/ docs/SPEC/ "docs/API Design/"   # B9 ≥3 hit
rg -n "isCompany" apps/api/src/payroll/payroll-access.service.ts                     # B3 — phải có trong thân canRevealTaxCode
rg -n "\.strict\(\)" packages/contracts/src/payroll.ts                               # B2 — phải khớp createSalaryProfileSchema
rg -n "full_name" apps/api/src/payroll/payroll-employees.repository.ts               # B11 = 0 hit
rg -n "deleted_at is null" apps/api/src/payroll/payroll-people.repository.ts         # B6 — có trong nhánh cột mới
rg -n "common/db-error.ts|contracts/src/index.ts|SPEC-11" harness/backlog.mjs        # B10 — trong khối S15-PAYROLL-BE-1
rg -n "INSERT INTO salary_components" apps/api/test/integration/payroll-be1-legacy-items.int-spec.ts  # B12 có hit
rg -n "PC_0" apps/api/test/integration/payroll-be1-legacy-items.int-spec.ts          # B12 — CHỈ ở khối seed salary_profile_items
git diff --stat apps/api/test/foundation/identity-projection-verdicts.ts             # B11 — RỖNG
```

- [ ] Coverage `apps/api/src/payroll/` **≥85%** trên `LANE_DB`.
- [ ] `bash harness/check.sh --all` xanh, KHÔNG banner "XANH KHÔNG ĐỦ BẰNG CHỨNG".
- [ ] FULL gate: `security-reviewer` + `database-reviewer` + `silent-failure-hunter`.
- [ ] Dán vào PR: census 2 tầng (43/43), census mã lỗi (19), route-http-coverage (`≥516`), log ca
      "lưu lại y nguyên ⇒ 422", log ca `TNCN ⇒ 422`, log ca `PATCH {note}` giữ nguyên 2 items.

---

## 9. Câu hỏi mở / giả định (KHÔNG giấu)

1. **037 "tab Thông tin chung" cần field HR nào ngoài 6 field đã ĐÓNG?** SPEC nói chung chung. **Giả định:**
   chỉ 6 trường (mã · họ tên · đơn vị · vị trí · trạng thái · `taxCode` có điều kiện) + timestamps.
2. **`employeeStatus` tập giá trị** — `employee_profiles.status` default `"active"` (`employees.ts:86`), chưa
   xác minh CHECK đầy đủ. **Phải đo lúc code.**
3. **`orgUnitId` filter của 036 — MỘT đơn vị hay CẢ CÂY con?** **Giả định:** khớp CHÍNH XÁC, không đệ quy.
   Muốn đệ quy ⇒ quyết định ký riêng.
4. **`hasSalaryProfile`** — giả định "có ≥1 phiên bản chưa xoá mềm", KHÔNG xét `effective_date` vs hôm nay.
5. **Cơ chế `PENDING` cho 14 mã lỗi tương lai** — đề xuất KHÔNG dựng; giữ luật "mã nào ném thì phải có test".
6. **Invariant seed `manage⇒view` cho `payroll-employee`** — mig `0571` KHÔNG áp (chỉ 4 tài nguyên khác).
   **[M1]** vá ở tầng ỨNG DỤNG theo §3.12, KHÔNG ở tầng SEED (ngoài `paths`, không migration mới). Muốn
   seed-time invariant thật ⇒ WO riêng chạm migration.
7. ⚠️ **`PC_nnn` là mã catalog HỢP LỆ về hình dạng** (`salary_components_code_shape_check` chỉ cấm tiền tố
   `SYS_`/`TL_`/`GT_` — `db/schema/payroll.ts:790`). Nếu ai đó seed `PC_001` vào `salary_components` thì ca
   "lưu lại y nguyên ⇒ 422" thành xanh-RỖNG. Đã chặn ở **[B12]**; ghi lại đây để WO sau không nới.
