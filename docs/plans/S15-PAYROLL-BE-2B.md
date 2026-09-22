# S15-PAYROLL-BE-2B — micro-plan vùng đỏ (nợ ghi nhận của BE-2)

> **WO:** trả 4 nợ của `S15-PAYROLL-BE-2` (`docs/plans/S15-PAYROLL-BE-2-review.md` LOW-1 · LOW-5 · INFO):
> N+1 `assertGraphsAfterEdit` · trần số hàng catalog · 6 CHECK chưa map · precision trung gian 50.
> **Nhánh:** `feat/s15-payroll-be-2b` · **base master:** `9e17ae51`. 🔴 crown (đụng máy tính lương) ⇒ FULL gate
> + plan-reviewer đối kháng. Nguồn sự thật: `docs/SPEC/SPEC-11 PAYROLL.md` §12.1 · §13.6 F · §21.1 (bảng ràng buộc).
>
> **KHÔNG migration** — cả 4 hạng mục đều xử lý được trong tầng service/repository/contracts/test; không đổi
> schema. Nếu lúc thi công phát hiện BẮT BUỘC phải ALTER (vd cần cột mới) ⇒ **DỪNG**, báo, không tự mở migration.

---

## 0. ĐO THẬT — số liệu chốt trước khi viết plan (lệnh + kết quả)

Tất cả số dưới đây đọc trực tiếp từ code/SPEC hiện tại (22/09/2026), không suy diễn.

| # | Số đo | Giá trị THẬT | Nguồn |
| - | --- | --- | --- |
| 1 | Vị trí N+1 | `apps/api/src/payroll/salary-components.service.ts:369-407` (`assertGraphsAfterEdit`), vòng lặp gọi `componentsTx` từng mẫu ở dòng **391-392** | Read trực tiếp |
| 2 | `componentsTx` | `payroll-templates.repository.ts:175-213` — SELECT theo `templateId` đơn, **không lọc `is_visible`** (đúng luật MF4/LOW-7 của BE-2, giữ nguyên) | Read |
| 3 | `templatesContainingTx` | `payroll-templates.repository.ts:248-271` — trả mẫu **CHƯA XOÁ** chứa 1 thành phần | Read |
| 4 | Khuôn trần có sẵn | `PAYROLL_EXPORT_MAX_ROWS = 10_000` tại `payroll-export.service.ts:19` — đúng khuôn cần theo (hằng ở service + so sánh `> MAX` + `payrollDetails("<kind>", {total,max})`) | Read + Grep |
| 5 | Số thành phần seed hiện tại | **19**, KHÔNG PHẢI 18 như giả định ban đầu | `payroll-master-data.seeder.ts:154-360` — `LUONG_CO_BAN·PHU_CAP·THUONG·NGHI_KHONG_LUONG·PHAT·TAM_UNG·TONG_THU_NHAP·BHXH_NV·BHYT_NV·BHTN_NV·DOAN_PHI·TONG_BH_NV·THU_NHAP_CHIU_THUE·TNCN·TONG_KHAU_TRU·BHXH_DN·BHYT_DN·BHTN_DN·KPCD` = 19 |
| 6 | `seedVersion` hiện tại | `"v4"` (không phải `"v2"` như plan BE-2 gốc ghi — đã bump qua BE-3/DB-1B/BE-4) | `payroll-master-data.seeder.ts:461` |
| 7 | Mã lỗi tự do kế tiếp | **`PAYROLL-ERR-034`** — bảng SPEC-11 §12.1 dùng hết 018..033; `grep "PAYROLL-ERR-0(3[4-9]"` toàn repo = 0 kết quả | Grep |
| 8 | Census mã lỗi hiện ghim | `payroll-error-code-census.unit-spec.ts:122` — `expect(all.size).toBe(33)` | Read |
| 9 | Census ràng buộc DB (QA-1, **đã tồn tại — KHÔNG dựng mới**) | `apps/api/test/foundation/payroll-constraint-map-census.unit-spec.ts` (299 dòng) — parse **chính bảng** `docs/SPEC/SPEC-11 PAYROLL.md:739-768`, neo cứng `EXPECTED_CONSTRAINT_NAME_COUNT = 17` · `EXPECTED_TRIGGER_NAME_COUNT = 3` · `EXPECTED_TAG_PAIR_COUNT = 15` · `EXPECTED_UNMAPPED_TAG_COUNT = 4`; int-spec cặp `test/integration/s15-payroll-qa1-constraints.int-spec.ts` | Read |
| 10 | Census kiến trúc formula (**đã tồn tại — THÊM VÀO, không tạo file thứ ba**) | `apps/api/test/foundation/payroll-formula-architecture-census.unit-spec.ts` (88 dòng) — cấm `eval/Function/RegExp/Number/parseFloat/parseInt/Math./JSON.parse` trong `src/payroll/formula/**` | Read |
| 11 | **6 CHECK thật sự "chưa map"** | Đối chiếu TOÀN BỘ CHECK trên 4 bảng catalog (mig `0570_s15payrolldb1_payroll_v2_ddl.sql`) với `mapPayrollPgError` (`payroll.errors.ts:503-739`) VÀ với bảng đóng SPEC-11 §21.1 (17 tên) — **6 CHECK KHÔNG xuất hiện ở CẢ HAI nơi**: xem §4.1 | Grep + Read chéo |
| 12 | Precision hiện tại | `Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP })` tại `formula.decimal.ts:17`; `SCALE_INTERMEDIATE = 10` (dòng 21) · `SCALE_MONEY = 2` (dòng 23). SPEC-11 §13.6 F **CHƯA** ghi con số `50` — chỉ code comment có | Read |
| 13 | `payroll-templates.repository.ts` | 291 dòng — dư chỗ cho method mới, không chạm trần 800 | wc |
| 14 | Đường dẫn SPEC thật | `docs/SPEC/SPEC-11 PAYROLL.md` (thư mục **`SPEC`** viết hoa, tên file có khoảng trắng); backlog `paths` ghi `docs/spec/SPEC-11*.md` (thường) — khớp trên Windows, cờ rủi ro nếu CI chạy hệ case-sensitive; **không sửa `paths` vì lý do này** (ngoài phạm vi), chỉ ghi chú | Glob |

---

## 1. Phạm vi ĐÓNG · phản-phạm-vi

**LÀM:** đúng 4 hạng mục `done_when` của backlog — gộp truy vấn N+1, thêm trần 200 hàng catalog kèm mã lỗi mới,
map 6 CHECK còn thiếu (bổ sung bảng SPEC-11 §21.1 rồi map), khoá số học precision/scale bằng census + 1 ca đối
soát tay. Không migration.

**⛔ KHÔNG LÀM:** đổi hành vi đồ thị/mã lỗi/thứ tự hiện có của `assertGraphsAfterEdit` (chỉ đổi SỐ LƯỢT TRUY VẤN) ·
đổi precision/scale (owner chốt GIỮ 50) · sửa `salary_profile_items_amount_check` (phát hiện phụ §1 X3, bảng của
BE-1, ngoài `paths`) · thêm route mới · đổi `PAYROLL_ROUTE_PAIRS`/`MONEY_FREE_ROUTES` (0 route mới).

| # | Mâu thuẫn/giả định SAI so với code | Xử lý |
| - | --- | --- |
| **X1** | Giả định ban đầu "18 thành phần seed" — thực tế **19** (§0.5) | Toàn plan dùng 19; ca đối soát tay (§5) build trên 19 hàng thật |
| **X2** | "6 CHECK chưa map" tưởng nằm trong danh sách "cố ý 500" | Đối chiếu §0.11: cả 6 **vắng mặt khỏi bảng đóng SPEC-11 §21.1**; danh sách `UNMAPPED_BY_DESIGN` (4 mục) của census chỉ áp cho cặp `trigger:tag`, KHÔNG áp cho tên CHECK ⇒ việc thật là **bổ sung 6 hàng vào bảng SPEC-11 §21.1 TRƯỚC**, rồi mới map + viết ca |
| **X3** | Giả định "map = trả `null`" (như `salary_profile_items_amount_check`) là an toàn | **CẦN XÁC MINH LẠI TRƯỚC KHI THI CÔNG (xem §1.1).** Planner kết luận: `throw mapPayrollPgError(err) ?? err` với `null` ⇒ ném lại lỗi PG THÔ (không phải `HttpException`) ⇒ `AllExceptionsFilter` (`apps/api/src/common/filters/all-exceptions.filter.ts:138-145`) rơi nhánh "lỗi không xác định → 500", KHÔNG phải "400 hình thức" như comment `payroll.errors.ts:670` tự nhận |

### 1.1 X3 đã được CHỨNG MINH trong repo — KHÔNG cần vòng đo riêng

plan-reviewer (22/09/2026) chỉ ra bằng chứng thành văn, bỏ được bước đo lane DB dự kiến:
- `apps/api/src/main.ts:50` — `AllExceptionsFilter` là filter toàn cục DUY NHẤT cho HTTP;
- `apps/api/src/common/filters/all-exceptions.filter.ts:138-145` — nhánh "lỗi không xác định ⇒ 500";
- `IdempotencyInterceptor` chỉ `catchError` để release scope, KHÔNG đổi lỗi;
- `apps/api/test/integration/s15-payroll-qa1-constraints.int-spec.ts:283-289` + `:304` đã ghi thành văn
  «`mapPayrollPgError` trả `null` ⇒ … ⇒ **500 vô danh ở vùng đỏ**», ca A7 tên là «(trước vá: null ⇒ 500)».

⇒ **X3 ĐÚNG**: comment `payroll.errors.ts:669-670` («400 hình thức») SAI. §4.2 giữ hướng **map thật, không `null`**;
nợ `salary_profile_items_amount_check` ở §10 là nợ THẬT (WO riêng, ngoài `paths`).

---

## 2. Hạng mục 1 — N+1 `assertGraphsAfterEdit`

### 2.1 Vấn đề đo được

`salary-components.service.ts:391-406`:

```
for (const t of await this.templates.templatesContainingTx(tx, companyId, before.id)) {
  const rows = await this.templates.componentsTx(tx, companyId, t.id);   // 1 câu MỖI mẫu
  ...
  compileOrThrow(graph, true, { template: t.code });
}
```

Chạy dưới `payrollCatalogLockTx` (khoá advisory độc quyền cấp company) — N mẫu chứa thành phần ⇒ N câu SQL tuần tự
trong khi GIỮ khoá, thời gian giữ khoá tuyến tính theo N.

### 2.2 Sửa — method gộp MỚI, KHÔNG đổi chữ ký `componentsTx` (đang dùng chung ở 053/054)

**File `apps/api/src/payroll/payroll-templates.repository.ts`** — thêm method mới sau `componentsTx` (~dòng 213):

```ts
/**
 * Bản GỘP của `componentsTx` cho NHIỀU mẫu cùng lúc (S15-PAYROLL-BE-2B — trả nợ N+1 LOW-1).
 * CÙNG hình dạng cột/JOIN/ORDER với `componentsTx` — chỉ khác `where` dùng `inArray` thay `eq`.
 * KHÔNG lọc `is_visible` (giữ nguyên luật MF4 — caller tự quyết định lọc gì).
 */
async componentsForTemplatesTx(
  tx: TenantTx,
  companyId: string,
  templateIds: readonly string[],
): Promise<Map<string, TemplateComponentRow[]>> {
  if (templateIds.length === 0) return new Map();
  const rows = await tx
    .select({
      templateId: payrollTemplateComponents.templateId,
      // ...CÙNG BỘ CỘT với componentsTx (chép đúng, không thêm/bớt)
    })
    .from(payrollTemplateComponents)
    .innerJoin(salaryComponents, and(
      eq(salaryComponents.companyId, payrollTemplateComponents.companyId),
      eq(salaryComponents.id, payrollTemplateComponents.componentId),
    ))
    .where(and(
      eq(payrollTemplateComponents.companyId, companyId),
      inArray(payrollTemplateComponents.templateId, templateIds),
    ))
    .orderBy(
      asc(payrollTemplateComponents.templateId),
      asc(payrollTemplateComponents.sortOrder),
      asc(salaryComponents.code),
    );
  const byTemplate = new Map<string, TemplateComponentRow[]>();
  for (const { templateId, ...row } of rows) {
    const bucket = byTemplate.get(templateId) ?? [];
    bucket.push(row);
    byTemplate.set(templateId, bucket);
  }
  return byTemplate;
}
```

⚠️ **Luật bắt buộc khi chép bộ cột:** `componentsTx` là nguồn CHUẨN. Bộ cột/JOIN/thứ tự `orderBy` (trừ khoá
`templateId` thêm vào đầu) phải khớp ĐÚNG BẰNG — lệch một cột là đồ thị mẫu khác nhau giữa 047 và 053/054.

**File `apps/api/src/payroll/salary-components.service.ts:391-406`** — thay vòng lặp:

```ts
const affected = await this.templates.templatesContainingTx(tx, companyId, before.id);
if (affected.length > 0) {
  const rowsByTemplate = await this.templates.componentsForTemplatesTx(
    tx, companyId, affected.map((t) => t.id),
  );
  for (const t of affected) {
    const rows = rowsByTemplate.get(t.id) ?? [];
    const graph = rows.map((r) => /* GIỮ NGUYÊN logic map hiện có */ null as never);
    compileOrThrow(graph, true, { template: t.code });
  }
}
```

**Bất biến (khớp done_when):** thứ tự `template` trong `payrollDetails` khi đồ thị vỡ phải giữ nguyên — vòng `for`
vẫn lặp theo thứ tự `templatesContainingTx` trả về (`ORDER BY payroll_templates.code`), CHỈ đổi nguồn `rows`.

### 2.3 RED trước → GREEN

File mở rộng: `apps/api/test/integration/s15-payroll-be2-components.int-spec.ts` (đã tồn tại, có fixture PATCH 047).

- **RED (trước khi thêm method):** spy `componentsForTemplatesTx` — method CHƯA TỒN TẠI ⇒ không chạy được (đặc tả
  trước implementation).
- **GREEN sau khi sửa:**
  1. Dựng 3 mẫu (`T1,T2,T3`) đều chứa thành phần tuỳ biến `X` (đủ 4 nút aggregate mỗi mẫu).
  2. Spy `componentsTx` (đếm) + `componentsForTemplatesTx` (đếm + tham số `templateIds`), `mockClear()` TRƯỚC act.
  3. PATCH `formula` của `X` hợp lệ với cả 3 mẫu ⇒ **ALLOW 200**; `componentsForTemplatesTx` gọi **đúng 1 lần** với
     `templateIds` đủ 3 id; `componentsTx` **0 lần** trong request này.
  4. **DENY đối chứng cùng fixture:** sửa `X` làm vỡ đồ thị CHỈ ở `T2` ⇒ 422 với `details.template === T2.code` —
     chứng minh gộp truy vấn không lẫn dữ liệu giữa các mẫu (mỗi bucket đúng mẫu của nó).
  5. Ca **0 mẫu chứa thành phần** ⇒ `componentsForTemplatesTx` 0 lần (guard `length === 0`, không phát SQL thừa).

**Đột biến:** revert service về vòng `for` cũ (giữ method mới nhưng không dùng) ⇒ ca (3) đỏ; bỏ guard
`templateIds.length === 0` ⇒ ca (5) đỏ.

---

## 3. Hạng mục 2 — Trần catalog (owner chốt 22/09/2026: **200 hàng sống+active/công ty**)

### 3.1 Quyết định kỹ thuật

- **Trần:** 200 hàng `salary_components` có `deleted_at IS NULL AND is_active = true` — đúng predicate
  `SalaryComponentsRepository.listActiveTx` (`salary-components.repository.ts:82-86`) đã dùng.
  `create()` (045) ở nhánh `formula` đã gọi `listActiveTx`; đổi thành **luôn** gọi một lần ở đầu hàm, dùng
  `catalog.length` so trần và **tái dùng** `catalog` cho nhánh formula (không thêm query cho nhánh formula;
  thêm ĐÚNG MỘT query cho nhánh `fixed`/`profile_item`).
- **Hằng:** theo khuôn `PAYROLL_EXPORT_MAX_ROWS` — đặt ở **service**, không phải contracts (cap là luật
  server-side, không shape DTO nào phụ thuộc): `export const PAYROLL_CATALOG_COMPONENTS_MAX = 200;` ở đầu
  `salary-components.service.ts`.
- **Mã lỗi mới:** `PAYROLL-ERR-034`, **422** (cùng nhóm "quá tải" với 016/030/031, không phải 409 conflict).
  - `PAYROLL_ERR_CODE.CATALOG_COMPONENT_LIMIT = "PAYROLL-ERR-034"`
  - `PAYROLL_ERR.CATALOG_COMPONENT_LIMIT = (total, max) => "PAYROLL-ERR-034: đã có {total} thành phần lương đang
    dùng (trần {max}) — ngừng dùng hoặc xoá bớt thành phần cũ trước khi tạo mới."`
  - `kind`: **`"component-catalog-limit"`** (cùng họ `component-*`).
  - Ném ở `create()` **TRƯỚC** kiểm trùng mã/compile đồ thị (fail-fast rẻ nhất trước), kèm
    `payrollDetails("component-catalog-limit", { total, max })`.
- **047/048 KHÔNG đổi hành vi** (owner chốt chặn ở đường GHI 045): 048 không ghi; 047 không tạo hàng mới.
  **Điểm mù có ý thức:** 047 `{isActive:true}` kích hoạt lại hàng đã tắt cũng tăng số hàng sống+active và KHÔNG bị
  cap chặn — ghi ở §10, không tự mở rộng.
- **Seeder KHÔNG ảnh hưởng:** seeder ghi thẳng qua repository/SQL, không qua `create()` ⇒ 19 hàng seed không đụng trần.

### 3.2 Hệ quả FE — census `apps/app` (đã chốt: MỞ RỘNG `paths`)

**Đo thật:** `apps/app/src/routes/payroll/payroll-error-kind-census.spec.ts` đọc TRỰC TIẾP source
`apps/api/src/payroll/*.ts` bằng regex `payrollDetails\("([a-z0-9-]+)"` rồi assert `PAYROLL_ERROR_KINDS` (FE) ĐÚNG
BẰNG tập kind của BE (dòng 72-75). Thêm `payrollDetails("component-catalog-limit", …)` ở BE ⇒ census FE **đỏ ngay**,
không tránh được.

**Quyết định (coordinator chốt 22/09/2026):** mở rộng `paths` của WO thêm ĐÚNG hai file —
`apps/app/src/routes/payroll/payroll-errors.ts` (thêm 1 phần tử `PAYROLL_ERROR_KINDS`) và
`apps/app/src/i18n/locales/vi/payroll.ts` (1 khoá dịch). Lý do: phương án "ghi nợ FE, để CI đỏ tạm" vi phạm
`CLAUDE.md` §8 DoD ("không phá luồng chính"). Đây KHÔNG phải WO FE (0 UI mới, 2 dòng diff).
`harness/backlog.mjs` cập nhật `paths` + `notes` ghi ngoại lệ này **trước** khi commit đoạn FE.

### 3.3 RED trước → GREEN — mở rộng `s15-payroll-be2-components.int-spec.ts`

Fixture (chốt con số lúc thi công, bulk-insert raw SQL trong `beforeAll`, KHÔNG qua service):
- dựng đủ hàng filler để công ty có **đúng 199** hàng sống+active (19 seed + filler), trong đó có **một nhóm
  hàng xoá mềm + một nhóm `is_active=false`** để chứng minh chúng KHÔNG bị đếm dù tồn tại vật lý.
- **ALLOW (biên dưới):** POST 045 tạo hàng thứ **200** ⇒ **201 Created** (đúng khuôn `PAYROLL_EXPORT_MAX_ROWS`:
  chạm đúng trần vẫn qua).
- **DENY (biên trên):** POST 045 khi đã đúng 200 sống+active ⇒ **422 `PAYROLL-ERR-034`**, `details.total === 200`,
  `details.max === 200`, `kind === "component-catalog-limit"`.
- **Ca "không đếm nhầm":** tổng số hàng vật lý > 200 nhưng sống+active = 199 ⇒ tạo mới vẫn **201**.
- **048 hồi quy:** vẫn 200 dù công ty đã ở trần (048 không ghi ⇒ không ném 034).

**Đột biến:** bỏ điều kiện `catalog.length >= MAX` ⇒ ca DENY đỏ; đổi predicate đếm sang "mọi hàng sống bất kể
active" ⇒ ca "không đếm nhầm" đỏ.

---

## 4. Hạng mục 3 — 6 CHECK chưa map

### 4.1 Danh tính 6 CHECK (đối chiếu `mig 0570` × `mapPayrollPgError` × bảng SPEC-11 §21.1)

| # | Tên CHECK | Bảng | Định nghĩa | Zod mirror ĐÚNG BẰNG? |
| - | --- | --- | --- | --- |
| 1 | `salary_components_kind_check` | `salary_components` | `kind IN (7 giá trị)` | ✅ `salaryComponentKindEnum` (`payroll.ts:95`) |
| 2 | `salary_components_value_type_check` | `salary_components` | `value_type IN (4 giá trị)` | ✅ `salaryComponentValueTypeEnum` (`payroll.ts:107`) |
| 3 | `payroll_templates_scope_check` | `payroll_templates` | `scope IN ('company','org_unit')` | ✅ `payrollTemplateScopeEnum` (`payroll.ts:123`) |
| 4 | `payroll_statutory_rates_pct_range_check` | `payroll_statutory_rates` | 8 cột `BETWEEN 0 AND 100` | ✅ `PERCENT_INPUT` (`payroll-catalog.ts:73`) |
| 5 | `payroll_statutory_rates_amount_check` | `payroll_statutory_rates` | 3 cap `>0` + `base_wage>0` + `min_region_wage>0` + 2 deduction `>=0` | ✅ `POSITIVE_MONEY_INPUT`/`MONEY_INPUT` (`payroll-catalog.ts:350`) |
| 6 | `payroll_statutory_rates_brackets_check` | `payroll_statutory_rates` | `jsonb_array_length(pit_brackets) = 7` | ❌ **KHÔNG mirror** — Zod chỉ `.max(50)` (`payroll-catalog.ts:367`); "đúng 7" chỉ SERVICE ép (`assertBracketsContinuous` → `formula.statutory.ts:69`, 422 022 `statutory-rate-incomplete` reason `count`) |

Cả 6 **không route nào chạm được qua đường thường** (Zod/service chặn trước) — khớp mô tả gốc của
silent-failure-hunter. Cả 6 **vắng mặt** khỏi bảng đóng SPEC-11 §21.1 (17 tên).

### 4.2 Quyết định map — phụ thuộc kết quả phép đo §1.1

| CHECK | Map → | HTTP | Vì sao |
| --- | --- | --- | --- |
| 1,2,3,4,5 (exact-mirror) | `payrollBadRequest(c)` — **400 `VALIDATION-ERR-001`**, khuôn `payroll_payment_lines_bank_pair_check` (`payroll.errors.ts:627-634`) | 400 | Tới được đây = payload lách Zod (bug/đường ghi nội bộ) ⇒ phải hiện 400 đọc được. **KHÔNG dùng `return null`** nếu §1.1 xác nhận `null` ⇒ 500 |
| 6 `brackets_check` | **Tái dùng kind có sẵn**: `payrollUnprocessable("STATUTORY_RATE_INVALID", …, payrollDetails("statutory-rate-incomplete", { reason: "count" }))` | 422 | Lưới cuối phải ném CÙNG mã/kind với tiền-kiểm service (khuôn `value_pair_check`→018, `four_eyes_check`→005). **Không thêm kind mới** ⇒ không đụng census FE |

**Vì sao hạng mục này KHÔNG thêm kind FE:** `payrollBadRequest()` không gọi `payrollDetails(kind)` (chỉ đặt
`{field:"constraint", message, rule:"payroll"}`) ⇒ regex census FE không thấy gì mới; nhánh thứ 6 tái dùng kind đã
tồn tại trong tập BE.

### 4.3 Thứ tự việc — SPEC trước, map sau

1. **`docs/SPEC/SPEC-11 PAYROLL.md`** — thêm 6 hàng vào bảng ràng buộc (khối 739-768), đặt cạnh hàng cùng bảng:
   5 hàng `23514 → 400 VALIDATION-ERR-001 (lưới cuối — Zod đã mirror ĐÚNG BẰNG)` và 1 hàng
   `payroll_statutory_rates_brackets_check | 23514 | 422 | **022** statutory-rate-incomplete reason count`.
   Thêm 1 dòng chú thích dưới bảng: sáu hàng là nợ ghi nhận từ BE-2 (WO này), cả sáu không route nào chạm qua
   đường thường.
2. **`payroll.errors.ts`** — 6 nhánh mới trong khối `PG_CHECK_VIOLATION` (~sau dòng 716, TRƯỚC nhánh `c === ""`).
3. **`payroll-constraint-map-census.unit-spec.ts`** — parser đọc thẳng bảng SPEC nên bump
   `EXPECTED_CONSTRAINT_NAME_COUNT: 17 → 23` + sửa comment đếm tay (dòng 131-134).
   `EXPECTED_TRIGGER_NAME_COUNT`/`EXPECTED_TAG_PAIR_COUNT` KHÔNG đổi (6 hàng mới đều là CHECK).
4. **`s15-payroll-qa1-constraints.int-spec.ts`** — 6 ca kích hoạt CHECK THẬT bằng raw SQL (bypass Zod/service hoàn
   toàn), bắt lỗi, gọi `mapPayrollPgError(err)` thật, assert HTTP + `code`/`kind` đúng bảng §4.2.
   **ALLOW đối chứng bắt buộc cho CHECK #6:** tạo bản tỉ lệ ĐÚNG 7 bậc qua đường 056 ⇒ 201 (có thể trỏ ca ALLOW
   đã tồn tại ở `s15-payroll-be2-statutory-rates.int-spec.ts`).

**Đột biến:** xoá 1 trong 6 nhánh `if` ⇒ census tĩnh đỏ (luật 1: `mapperSrc.includes(name)`); giữ tên trong comment
không cứu được vì census `stripComments` trước khi quét. Ca int-spec cũng đỏ độc lập (mapper trả `null` ⇒ status
không còn 400/422).

---

## 5. Hạng mục 4 — Precision trung gian 50 (owner chốt: **GIỮ NGUYÊN**)

**(a) Ghim hằng — THÊM `describe` vào `payroll-formula-architecture-census.unit-spec.ts`** (không tạo file thứ ba):

```ts
expect(D.precision).toBe(50);
expect(D.rounding).toBe(Decimal.ROUND_HALF_UP);
expect(SCALE_INTERMEDIATE).toBe(10);
expect(SCALE_MONEY).toBe(2);
```

Đọc thuộc tính RUNTIME của `D` (đã `Decimal.clone`) — mạnh hơn quét text: đổi số trong `formula.decimal.ts` là đỏ
ngay, không phụ thuộc cú pháp/comment.

**(b) SPEC** — `docs/SPEC/SPEC-11 PAYROLL.md` §13.6 F (sau dòng ~1115) ghi rõ precision 50 là LỰA CHỌN CÓ CHỦ Ý
(owner chốt 22/09/2026): `numeric(18,2)` cần 18 chữ số + scale trung gian 10 = 28; biên 22 chữ số cho tích hai giá
trị cỡ lương trước khi cắt scale 10. Trần thấp hơn = đổi hành vi làm tròn ở phép nhân trung gian; cao hơn = không
lợi ích đo được. Ghim bằng census (a).

**(c) Ca đối soát tay** — file mới `apps/api/src/payroll/formula/formula.decimal-reconciliation.spec.ts`.
⚠️ **Phép đo bắt buộc trước khi viết:** planner viện dẫn oracle `docs/QA/evidence/S15-PAYROLL-QA-1-doi-soat.py` —
**phải xác minh file này tồn tại**. Nếu KHÔNG có, dựng oracle bằng bảng tính tay ghi thẳng trong spec (từng bước
số VND, có chú thích nguồn quy tắc TNCN 7 bậc), KHÔNG lấy số do chính engine sinh ra (oracle tự-xác-nhận = ca rỗng).
Nội dung: 19 thành phần seed thật + TNCN luỹ tiến, gọi `compileGraph`/`evaluatePass`, assert từng cột
(`TONG_THU_NHAP` · `TONG_BH_NV` · `THU_NHAP_CHIU_THUE` · `TNCN` · `TONG_KHAU_TRU` · thực lĩnh) ĐÚNG BẰNG oracle.
Đây là ca REGRESSION (chứng minh §2 và §4 không vô tình đụng số học).

**Đột biến:** đổi 1 hệ số đầu vào mà giữ nguyên oracle ⇒ ca đỏ (assert so số thật, không tự nhận true).

---

## 6. Bảng mã lỗi — cập nhật (1 mã mới)

| Mã | HTTP | `kind` |
| --- | --- | --- |
| **PAYROLL-ERR-034** (mới) | 422 | `component-catalog-limit` |

`payroll-error-code-census.unit-spec.ts:122` — `toBe(33)` → **`toBe(34)`**.

---

## 7. Census/ratchet — Trước → Sau

| Cổng | Trước | Sau |
| --- | --- | --- |
| `PAYROLL_ERR_CODE` (tổng mã) | 33 | **34** |
| `payroll-constraint-map-census` `EXPECTED_CONSTRAINT_NAME_COUNT` | 17 | **23** |
| `payroll-formula-architecture-census` | 3 `describe` | **+1** (ghim precision/scale) |
| `PAYROLL_ROUTE_PAIRS` / `MONEY_FREE_ROUTES` | không đổi | không đổi (0 route mới) |
| `apps/app` `payroll-error-kind-census.spec.ts` | N kind | **+1** (`component-catalog-limit`) |
| SPEC-11 §21.1 bảng ràng buộc | 17 tên | **23 tên** |

---

## 8. Thứ tự thi công & cổng

0. **Phép đo §1.1** (X3: `null` ⇒ 500 hay 400) + xác minh oracle §5(c) tồn tại. Kết quả có thể sửa §4.2.
1. **SPEC trước code:** `docs/SPEC/SPEC-11 PAYROLL.md` §21.1 (6 hàng CHECK) + §13.6 F (ghi chú precision).
2. Repository: `componentsForTemplatesTx` (RED spy → GREEN).
3. Service: `assertGraphsAfterEdit` dùng method mới; cap 200 ở `create()`.
4. `payroll.errors.ts`: mã 034 + 6 nhánh map CHECK.
5. Census: error-code 33→34, constraint-map 17→23, formula-architecture +1 describe.
6. Test: mở rộng `s15-payroll-be2-components.int-spec.ts` (§2.3 + §3.3), `s15-payroll-qa1-constraints.int-spec.ts`
   (§4.3), file mới `formula.decimal-reconciliation.spec.ts` (§5c).
7. FE (đã chốt §3.2): `payroll-errors.ts` + `i18n/locales/vi/payroll.ts`; cập nhật `paths` backlog trước.
8. `harness/backlog.mjs`: `done_when`/`notes` + trỏ plan này.
9. Verify lane DB `mediaos_be2b` (đã chain-migrate): một lời gọi shell duy nhất, trích 3 mật khẩu từ `.env` bằng
   `sed -n "s/^\s*KEY=//p"`, KHÔNG `source .env`.
10. `bash harness/check.sh --all --lane-db=be2b`.
11. **FULL gate:** `security-reviewer` + `database-reviewer` + `silent-failure-hunter` (§6 CLAUDE.md).
12. PR — người chốt.

---

## 9. Rủi ro hồi quy với BE-3/BE-4/BE-5 (đường tính lương đã ship)

- **BE-3** đọc catalog qua repository riêng (`payroll-calc.repository.ts`), KHÔNG gọi `assertGraphsAfterEdit`/
  `componentsTx` ⇒ hạng mục 1 không chạm đường tính lương thật.
- **BE-3/BE-4** dùng `mapPayrollPgError` cho CHECK của họ; 6 nhánh mới đặt SAU nhánh cũ và TRƯỚC `c === ""`; mỗi
  `if` độc lập theo `c.includes(name)`, không tên nào trùng giữa track ⇒ không "cướp" match.
- **BE-5** dùng `PAYROLL_EXPORT_MAX_ROWS` riêng — hai trần độc lập.
- **Seeder** (chạy mỗi boot) không qua `create()` ⇒ không bị cap; `check.sh` sẽ bắt nếu vỡ.

---

## 10. Điểm mù CÓ Ý THỨC

- **047 `{isActive:true}` vượt trần 200** — owner chốt chặn ở 045; khe hở có ý thức, không tự mở rộng.
- **`salary_profile_items_amount_check` (BE-1, ngoài `paths`)** — nếu §1.1 xác nhận X3: comment nói "400 hình thức"
  nhưng hành vi thật là 500. Không sửa ở WO này (khác bảng/track); mở WO nợ riêng.
- **Case-mismatch `docs/spec/` (backlog) vs `docs/SPEC/` (thật)** — chạy được trên Windows, rủi ro nếu CI đổi sang
  hệ case-sensitive; không sửa ở WO này.

---

## 11. Testing Strategy

- **Unit:** `payroll-formula-architecture-census` (+ghim precision/scale) · `formula.decimal-reconciliation.spec.ts`
  (mới) · `payroll-error-code-census` (33→34) · `payroll-constraint-map-census` (17→23).
- **Integration (LANE_DB=mediaos_be2b):** `s15-payroll-be2-components.int-spec.ts` (N+1 spy ALLOW/DENY + cap
  ALLOW-200/DENY-201/không-đếm-nhầm) · `s15-payroll-qa1-constraints.int-spec.ts` (6 ca CHECK thật + 1 ALLOW đối chứng).
- **E2E:** không cần — 0 đổi luồng người dùng.

## Success Criteria

- [ ] `assertGraphsAfterEdit` phát đúng 1 câu SQL cho N mẫu (N ≥ 2); mẫu báo lỗi và thứ tự giữ nguyên
- [ ] Tạo thành phần thứ 201 ⇒ 422 `PAYROLL-ERR-034 component-catalog-limit`; thứ 200 vẫn tạo được; hàng xoá
      mềm/inactive không bị đếm
- [ ] 6 CHECK có mặt trong SPEC-11 §21.1 + map thật + ca kích hoạt CHECK thật (không mock mapper)
- [ ] Precision/scale ghim bằng census runtime-property; SPEC-11 §13.6 F ghi rõ "GIỮ 50, có chủ đích"; ca đối soát
      tay khớp oracle tuyệt đối (oracle KHÔNG do engine sinh)
- [ ] `check.sh --all --lane-db=be2b` xanh (gồm `apps/app` sau khi thêm kind FE)
- [ ] FULL gate (security → database → silent-failure) PASS hoặc mọi finding đã vá trong cùng vòng

---

## 12. Đính chính sau plan-reviewer (REVISE → điều kiện thi công) — 22/09/2026

> Vòng đối kháng trả **REVISE** với 6 mục chặn. Mục này là **hợp đồng thi công**: khi §12 mâu thuẫn với §0-§11
> thì **§12 THẮNG**. Mỗi mục ghi: phát hiện · bằng chứng · cách vá đã chốt.

### B1 (CRITICAL) — mã 034 làm DRIFT bảng mã ĐÓNG của SPEC/API

Bảng mã PAYROLL là bảng ĐÓNG, khai ở 4 chỗ ngoài §21.1: `docs/SPEC/SPEC-11 PAYROLL.md:241` (ô đếm
`018..033 (16)` / tổng `33`) · `:693` (tiêu đề §12.1 «PAYROLL-ERR-018..033») · `:714` («danh sách vẫn ĐÓNG») ·
`docs/API Design/API-18_PAYROLL_API_Design.md:30, 467, 541` («16 mã mới»).

**Vá:** cùng commit phải sửa ĐỦ: (a) thêm hàng `PAYROLL-ERR-034 | 422 | component-catalog-limit` vào bảng §12.1;
(b) sửa tiêu đề §12.1 → `018..034` và ô đếm dòng 241 → `018..034 (17)` / tổng `34`; (c) 3 con số ở API-18.
**`paths` backlog mở thêm `docs/API Design/API-18*.md`.**

### B2 (CRITICAL) — trần 200 chặn nhầm một chiều, để hở chiều kia

`createSalaryComponentSchema.isActive: z.boolean().default(true)` (`packages/contracts/src/payroll-catalog.ts:120`)
⇒ 045 tạo được hàng `isActive:false`. Plan gốc ném 034 theo `catalog.length >= 200` **bất kể** `dto.isActive`:
(1) chặn nhầm hàng inactive (không làm phình tập compile) kèm thông điệp sai bản chất; (2) đường «tạo N hàng
inactive → 047 bật từng hàng» biến trần thành trang trí.

**Vá (phương án (a) của reviewer — GIỮ đúng ngữ nghĩa owner chốt «sống+active»):**
- **045** áp trần **CHỈ KHI** `dto.isActive !== false`. Tạo hàng inactive khi đã ở trần ⇒ **ALLOW** (có ca).
- **047** áp trần khi **bật lại** hàng đang tắt (`dto.isActive === true && before.isActive === false`) ⇒ tại trần
  thì **DENY 422 034** (có ca). Hàng `isSystem` luôn active nên không đi qua nhánh này.
- Đếm bằng method MỚI `SalaryComponentsRepository.countActiveTx(tx, companyId)` — `SELECT count(*)` với **ĐÚNG
  predicate của `listActiveTx`** (`live(companyId) AND is_active = true`, `salary-components.repository.ts:82-88`).
  Rẻ hơn tải catalog và không đổi hành vi nhánh `formula` (vẫn dùng `listActiveTx` như cũ).
- ⚠️ Vị trí gọi: **ngay SAU `await payrollCatalogLockTx(tx, companyId)`**, TRƯỚC mọi nhánh — luật của
  `payroll-catalog-lock-census` (mọi `DB_TOUCH` phải đứng sau lock).
- §10 bỏ dòng «047 là điểm mù có ý thức» — lỗ này nay ĐÃ bịt.

### B3 (HIGH) — một «đột biến» của §2.3 không có răng

Plan gốc viết «bỏ guard `templateIds.length === 0` (repository) ⇒ ca (5) đỏ». SAI: lời gọi bị chặn bởi guard ở
**SERVICE** (`if (affected.length > 0)`), nên gỡ guard repository thì ca (5) vẫn XANH.

**Vá:** đột biến của ca (5) = **bỏ guard `affected.length > 0` ở service**. Guard repository có đột biến RIÊNG:
ca unit gọi thẳng `componentsForTemplatesTx(tx, c, [])` ⇒ trả `Map` rỗng và **không phát SQL**.

### B4 (HIGH) — method gộp vô hình với census khoá catalog

`apps/api/test/foundation/payroll-catalog-lock-census.unit-spec.ts:22-35` liệt kê `DB_TOUCH` bằng **chuỗi cứng**;
`".componentsForTemplatesTx("` KHÔNG chứa `".componentsTx("` như substring ⇒ census không coi đó là chạm DB.

**Vá:** thêm `".componentsForTemplatesTx("` **và** `".countActiveTx("` vào `DB_TOUCH` cùng commit; ghi vào bảng §7.

### B5 (HIGH) — §9 viện dẫn SAI về đường tính lương

`componentsTx` **CÓ** nằm trên đường tính lương: `apps/api/src/payroll/payroll-template-binding.ts:76`
(`assertUsableTemplateTx` — đường `calculate`/002/004) và `apps/api/src/payroll/payroll-master-data.integrity.ts:168`.

**Vá §9 bullet 1:** «`componentsTx` CÓ nằm trên đường tính lương (2 vị trí trên) ⇒ **CẤM sửa chữ ký/bộ cột/orderBy
của nó**; WO này chỉ THÊM method mới. Vì `componentsTx` không đổi, đường tính lương không đổi hành vi.»

### B6 (HIGH) — thiếu ca ép method gộp ĐỒNG NHẤT với `componentsTx`

Typecheck bắt được cột THIẾU (`TemplateComponentRow` 15 trường, `payroll-templates.repository.ts:28-46`) nhưng
KHÔNG bắt hoán vị hai cột cùng kiểu (`pitDeductible` ↔ `componentActive`, cả hai `boolean`) — 3 ca của §2.3 vẫn xanh.

**Vá:** thêm ca int oracle: với MỖI mẫu `t`, `expect(rowsByTemplate.get(t.id)).toEqual(await repo.componentsTx(tx, c, t.id))`
(deep-equal, GIỮ thứ tự). Đây là đột biến-killer cho mọi lệch cột/JOIN/`orderBy`.

### Cảnh báo đã chấp nhận (vá kèm, không tranh luận)

| # | Nội dung | Hành động |
| - | --- | --- |
| M1 | Parser census đếm **mọi** token backtick ở cột 1 (`payroll-constraint-map-census.unit-spec.ts:110-122`, chỉ lọc token toàn số) | **Luật cứng:** cột 1 của 6 hàng mới chứa ĐÚNG MỘT backtick = tên ràng buộc; mọi chú giải (mig/bảng) đặt ở cột 4 |
| M2 | Tiền lệ QA-1 từng ĐẢO một map 400 → 422 (`SPEC-11:754`) ⇒ 5 hàng 400 của ta dễ bị «đính chính» nhầm sau này | Thêm 1 dòng chú thích dưới bảng §21.1: 5 CHECK này có **tiền-kiểm là Zod ⇒ 400 `VALIDATION-ERR-001`**, nên lưới DB cho CÙNG phản hồi = 400 (khác nhóm «tiền-kiểm ở service ⇒ 422») |
| M3 | CHECK #6 có **2 vế**: `jsonb_typeof(pit_brackets) = 'array' AND jsonb_array_length(...) = 7` (`migrations/0570…:491-492`) | Sửa mô tả §4.1; map 422 `reason:"count"` vẫn phủ cả hai vế (`assertBracketsContinuous` cũng ném `count` cho `!Array.isArray`) |
| M4 | Thiếu ca cách-ly 2 tenant cho trần | Fixture đã có `B.companyId` (`s15-payroll-be2-components.int-spec.ts:146`) ⇒ ca ALLOW: A ở trần 200, **B vẫn tạo được** (bất biến #1) |
| M5 | FE có **HAI** bảng phải sửa, không phải một | `apps/app/src/routes/payroll/payroll-errors.ts`: mảng `PAYROLL_ERROR_KINDS` (25-101) **và** map `KIND_TO_I18N_KEY` (~113-127) — census có ca «không kind nào 0 khoá i18n» (dòng 77-91) |
| M6 | Mức bằng chứng của 6 ca CHECK | `s15-payroll-qa1-constraints.int-spec.ts` KHÔNG boot Nest (`directPool`, gọi `mapPayrollPgError` như hàm thuần) ⇒ 6 ca chứng minh **mapper**, không phải HTTP end-to-end. Theo tiền lệ ca A7, mức này là **ĐỦ** — ghi rõ để gate không đòi ca HTTP |
| M7 | 045 có `@Idempotent()` (`payroll-catalog.controllers.ts:79`) | Ghi 1 dòng: 422 không bị cache (interceptor `catchError` → release scope) |
| M8 | Thứ tự ném cap TRƯỚC kiểm trùng mã đổi mã lỗi cho request vừa-trùng-vừa-quá-trần (409 024 → 422 034) | Giữ thứ tự (cap là điều kiện rẻ nhất + đứng ngay sau lock), ghi là **lựa chọn có chủ ý**; đã kiểm: không ca hiện có nào dựng 200 hàng ⇒ không gãy test cũ |
| M9 | Số đo lệch nhẹ ở §0 | `payroll-templates.repository.ts` = **307** dòng (không phải 291); `payroll-formula-architecture-census` = **1 `describe` / 3 `it`** (không phải 3 `describe`) |
| M10 | `done_when` #2 của backlog ghi «6 CHECK → mã lỗi theo TAG» | Sai chữ: sáu cái này là CHECK **CÓ TÊN** (map theo tên). Sửa câu chữ khi cập nhật backlog |
| M11 | `paths` ghi `docs/spec/` còn đường thật là `docs/SPEC/` | Sửa luôn case trong `paths` (0 rủi ro, gỡ cờ CI case-sensitive) |
| M12 | Rollback | Không feature-flag; 4 hạng mục thuần service/test ⇒ revert commit là đủ |

### Đã reviewer XÁC NHẬN ĐÚNG (không đổi)

Danh tính 6 CHECK (13 CHECK trên 4 bảng catalog − 7 đã map = đúng 6) · `PAYROLL-ERR-034` trống ·
422 đúng nhóm (cùng họ 016/030/031, không phải 409) · bump `EXPECTED_CONSTRAINT_NAME_COUNT` 17→23 ·
oracle `S15-PAYROLL-QA-1-doi-soat.py` độc lập thật (`fractions.Fraction`, KHÔNG import engine TS) ·
`orderBy` thêm `templateId` không đổi thứ tự trong bucket · không có nguy cơ deadlock 40P01 ·
FE là BẮT BUỘC, không có đường vòng · file đối soát colocated ở `src/payroll/formula/` KHÔNG trip luật cấm
`Number(`/`Math.` (census loại `*.spec.ts`, `payroll-formula-architecture-census.unit-spec.ts:39`).
