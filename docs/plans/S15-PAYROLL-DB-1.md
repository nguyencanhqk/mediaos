# S15-PAYROLL-DB-1 — micro-plan (vùng ĐỎ · FULL gate · Opus)

> **WO:** Schema + migration PAYROLL v2 track A+B. **Nguồn sự thật:** `docs/DB/DB-13` §12.1 · §12.2 · §12.4 · §13
> · §15.1 · §15.3 bước A/B · §15.4 · `docs/SPEC/SPEC-11` §8.2 · §11.3 · §12.1 · §13.6 E · §15.1 ·
> `docs/permission-matrix-spec.md` §9g.2 · vá plan-review DOC-1: `docs/plans/S15-PAYROLL-DOC-1-review.md`.
>
> **Khuôn code tái dùng:** mig `0564` (DDL payroll v1) · `0565` (seed quyền + UNION-ADD audit) · `0549`/`0559`
> (khối VERIFY fail-loud) · `apps/api/test/integration/s13-payroll-db1-invariants.int-spec.ts` (spec bất biến).

---

## 1. Ranh giới — làm gì và KHÔNG làm gì

**LÀM (track A + B):**

| # | Hạng mục | Nguồn |
| --- | --- | --- |
| 1 | ALTER `salary_profiles` — 5 cột + 5 CHECK | DB-13 §12.1 |
| 2 | ALTER `payroll_period_lines` — 3 cột + 2 CHECK | DB-13 §12.4 |
| 3 | TẠO **7 bảng** mới + RLS/FORCE/policy/GRANT/composite tenant-FK/`UNIQUE (company_id, id)` | DB-13 §13.1–§13.7 |
| 4 | EXPAND `allowances` jsonb → `salary_profile_items` (backfill fail-loud, **GIỮ** cột `allowances`) | DB-13 §12.2 |
| 5 | Seed **17 cặp quyền** (tất cả `is_sensitive=true`) + **31 grant** ⇒ tổng **63** | SPEC-11 §11.3 ghi chú 7 |
| 6 | UNION-ADD **10 giá trị** vào CHECK `audit_logs.object_type` ⇒ tổng **14** | DOC-1-review mục 3 |
| 7 | Seed master-data **company-scoped** (catalog thành phần · tỉ lệ luật định · 1 mẫu mặc định) | DB-13 §13.4 · §13.7 |
| 8 | Parity cùng commit: schema drizzle · contracts Zod · `rls-registry` + fixture · `cleanupTenants` · `PROTECTED_TABLES` · 2 allowlist backend | DB-13 §15.3 bước A |

**⛔ KHÔNG LÀM (thuộc `S15-PAYROLL-DB-2`):**

- **Mọi thứ chạm `payroll_periods`** — `template_id` · `paid_by` · `paid_at` · nới `status_check` 8 giá trị ·
  `UPDATE 'Paid' → 'Published'` · `published_pair_check` · `paid_pair_check`. DB-13 §12.3 chốt đây là **chuỗi 4
  bước NGUYÊN TỬ trong MỘT migration**; tách ra = `23514` giữa lane.
- **KHÔNG** đụng `payrollPeriodStatusEnum` của contracts (vẫn **7** giá trị) — nó phải đổi **cùng commit với
  bước (2) nới CHECK**, tức DB-2. Đổi sớm = Zod 8 / DB 7 = nhận `Published` rồi `23514`.
- 4 bảng track C (`payroll_advances` · `payroll_payment_batches` · `payroll_payment_lines` · `payroll_budgets`).
- NOTI-EVENT-024..027 (bước D) · widget DASH (`S15-PAYROLL-DASH-1`) · CONTRACT gỡ `allowances` (WO riêng, sau FE-1).

---

## 2. Bước 0 — SỐ ĐO

### 2.1 Đã đo (11/09/2026, phiên này)

| Đo gì | Kết quả | Hệ quả |
| --- | --- | --- |
| `_journal.json` `max(idx)` | **236** · tag `0569_s14recruitfilegrant1_candidate_file_perm` (237 entry) | migration mới = **`0570`** (idx 237) và **`0571`** (idx 238) |
| Thư mục permission | `apps/api/src/permission/` (**số ít**) — `apps/api/src/permissions/` **KHÔNG tồn tại** | WO `paths` sai → §3.2 |
| `SENSITIVE_CAPABILITY_ALLOWLIST` | `permission/permission.service.ts:43` | APPEND 17 cặp |
| `SENSITIVE_SCREEN_GATE_PAIRS` | `permission/permission.service.ts:250` — v1 có 13 cặp PAYROLL | APPEND 17 cặp ⇒ 30 |
| `cleanupTenants()` | `test/helpers/seed.ts:449`; payroll ở dòng 508–511 (`payroll_period_lines` → `payroll_periods` → `salary_profiles`) | chèn 7 bảng con→cha |
| `PROTECTED_TABLES` | `foundation/retention/retention.service.ts:45`, payroll ở dòng 73–75 | thêm 7 bảng |
| `rls-registry` | `test/integration/rls-registry.ts` — payroll ở dòng 1553–1690 | thêm 7 case |
| Module PAYROLL có seeder chưa | **KHÔNG** — `apps/api/src/payroll/` không có `*.seeder.ts` / `*seed.registrar.ts` | phải tạo mới → §3.1 |
| `MasterDataSeedRunner` phủ ai | `master-data-seed-runner.service.ts:211` — duyệt **mọi** `companies WHERE deleted_at IS NULL` × mọi seeder, lúc boot | seeder runtime phủ **cả công ty cũ lẫn mới** |
| Bảng payroll có GRANT DELETE | **0** (mig `0564` verify ép) | `payroll_template_components` là **ngoại lệ ĐẦU TIÊN** → §3.3 |

### 2.2 PHẢI đo lúc chạy (ghi số vào comment đầu migration)

```sql
-- (a) head thật tại thời điểm chạy — KHÔNG tin số ở §2.1 nếu nhánh đã rebase
--     node -e "const j=require('./apps/api/migrations/meta/_journal.json');console.log(Math.max(...j.entries.map(x=>x.idx)))"
-- (b) khối lượng backfill
SELECT count(*) AS profiles,
       coalesce(sum(jsonb_array_length(allowances)), 0) AS allowance_items
  FROM salary_profiles WHERE deleted_at IS NULL;
-- (c) GRANT THẬT (không suy từ migration cũ — grant-in-old-migration-is-not-current-state)
SELECT c.relname, a.grantee::regrole::text, a.privilege_type
  FROM pg_class c, aclexplode(c.relacl) a
 WHERE c.relname LIKE 'payroll%' OR c.relname LIKE 'salary%';
-- (d) giá trị hiện có trong CHECK audit_logs.object_type  (kỳ vọng 4 giá trị payroll)
-- (e) 17 cặp v1 ⋈ role_permissions  (kỳ vọng ĐÚNG 32 hàng grant)
-- (f) btree_gist đã cài chưa:  SELECT 1 FROM pg_extension WHERE extname='btree_gist';
-- (g) CHỈ ĐỂ BÀN GIAO DB-2 (KHÔNG dùng ở WO này):
SELECT count(*) FROM payroll_periods WHERE status = 'Paid';
```

> ⚠️ (b) trên **PROD kỳ vọng 0 hàng** (v1 chưa lên PROD — `S14-PROD-PAYROLLGRANT-1` còn treo), nhưng **lane/dev
> DB CÓ hàng**. Backfill phải chạy đúng ở cả hai. Ghi **cả hai số** vào comment migration.

---

## 3. BA điểm KHÁC tài liệu — phát hiện khi đo code (đọc kỹ trước khi review)

### 3.1 🔴 Seed company-scoped **KHÔNG được nằm trong migration** — DB-13 §15.3 bước B mô tả sai chỗ đặt

DB-13 §15.3 bước B giao cho migration `0571`: *«seed `salary_components` hệ thống · seed 1 bản
`payroll_statutory_rates` · seed 1 `payroll_templates` mặc định»*. **Ba bảng này đều `company_id NOT NULL`**
(§13.4/§13.5/§13.7) và repo **cấm** seed company-scoped ở migrate-time:

- `apps/api/migrations/0445_s2_hrseed1_hr_perms.sql:12` — *«company-scoped (company_id NOT NULL) + KHÔNG có
  company nào ở migrate-time (companies = tenant runtime…)»*;
- `apps/api/src/foundation/seed/master-data-seeder.types.ts:8` — *«clean DB có 0 company ⇒ migration KHÔNG
  seed được master-data theo company. Convention mig 0445/0008 **CẤM** seed company-scoped ở migrate-time»*.

Làm theo chữ của DB-13 thì trên DB sạch (CI) migration seed **0 hàng**, và khối VERIFY *«đúng 4 hàng
`value_type='engine'` · 3 hàng `pit_deductible`»* — **chốt DUY NHẤT chặn lỗi «đoàn phí giảm thuế»** — trở thành
**xanh RỖNG**. Đúng lớp lỗi `empty-success-is-the-fail-open-shape`.

**Quyết định:** tách bước B theo **phạm vi dữ liệu**, không theo «là seed hay không»:

| Dữ liệu | Phạm vi | Đặt ở đâu | Vì sao |
| --- | --- | --- | --- |
| 17 cặp `permissions` · 31 `role_permissions` | **TOÀN CỤC** (`permissions` không có `company_id`; grant gắn role **hệ thống** `company_id IS NULL`) | **migration `0571`** | đúng khuôn `0565`; verify fail-loud chạy thật |
| CHECK `audit_logs.object_type` | **TOÀN CỤC** (DDL) | **migration `0571`** | clone nguyên khối `0545`/`0565` bước (7) |
| `salary_components` · `payroll_statutory_rates` · `payroll_templates` | **company-scoped** | **`PayrollMasterDataSeeder` runtime (MỚI)** | convention `0445`; runner phủ mọi công ty cũ + mới lúc boot |

#### 3.1.a ⚠️ Chuyển sang seeder là **HẠ CẤP cổng** — phải bù bằng cổng khác, không được giả vờ tương đương

Migration verify là cổng **CỨNG** (migrate đỏ ⇒ deploy dừng). Seeder **KHÔNG** phải:
`master-data-seed-runner.service.ts:126–174` `runOne()` bọc **try/catch toàn phần** — seeder ném ⇒
`logger.error` + `markBatchFailed` + `return {ok:false}` rồi **chạy tiếp**; `master-data-seed-bootstrap.service.ts:13`
ghi thẳng *«reconcileAllCompanies() KHÔNG BAO GIỜ throw ⇒ seed lỗi KHÔNG sập boot (chỉ log)»*.
⇒ **Trong plan này KHÔNG có chỗ nào seeder "chặn boot"**; nó chỉ đánh batch `Failed` + log.

**BỐN đường một công ty tồn tại mà KHÔNG được seed** (đều đo được, phải biết trước khi tin vào seeder):

| # | Đường | Bằng chứng |
| --- | --- | --- |
| a | Boot ĐẦU TIÊN trên DB trắng: `MasterDataSeedBootstrapService` và `EnsureDefaultCompanyBootstrapService` cùng là provider của `SeedModule` (`:35`/`:38`), **thứ tự hook không đảm bảo** — runner có thể thấy 0 company | `seed.module.ts` · `ensure-default-company-bootstrap.service.ts:9–14` |
| b | `MASTER_DATA_SEED_ON_BOOT=false` (kill-switch vận hành) | `env.schema.ts:181` · `master-data-seed.config.ts:19` |
| c | `NODE_ENV=test` ⇒ bootstrap **no-op** ⇒ tenant fixture của int-spec không có catalog trừ khi spec tự gọi runner | `master-data-seed-bootstrap.service.ts:26–29` |
| d | Company tạo **sau** boot — không có call-site `reconcileCompany()` nào ngoài int-spec | grep toàn repo |

**Bù bằng cổng CỨNG ở đường TÍNH/ĐỌC — handoff BẮT BUỘC, ghi vào `backlog.mjs` CÙNG COMMIT:**

> `S15-PAYROLL-BE-2` và `S15-PAYROLL-BE-3` `done_when` += *«Catalog không đủ ⇒ **422**, CẤM trả 0: thiếu bản
> `payroll_statutory_rates` hiệu lực tại ngày cuối kỳ ⇒ `PAYROLL-ERR-022`; mã thành phần không phân giải được
> (kể cả 4 nút `engine` vắng mặt) ⇒ `PAYROLL-ERR-018`. Ca test: công ty CHƯA seed catalog ⇒ calculate trả 422,
> KHÔNG trả `net=0`.»*

Không có vế này thì catalog rỗng ⇒ `net = 0` hoặc `net = gross` **trong khi mọi bất biến SQL vẫn xanh** —
đúng lớp lỗi `empty-success-is-the-fail-open-shape` mà DOC-1 B9 vừa vá.

#### 3.1.b Verify chuyển chỗ — đo theo **TẬP MÃ**, không đếm số

Assert đếm (`count(value_type='engine') = 4`) vừa **mù** vừa **đỏ oan**: app role có `INSERT/UPDATE` trên
`salary_components`, và §15.1 chỉ chặn `value_type='engine'` từ client — `kind` và `pit_deductible` thì client
đặt được. Công ty thêm một khoản BH tự nguyện `pit_deductible=true` (hợp lệ nghiệp vụ) ⇒ assert `= 3` gãy ⇒
seeder `Failed` mỗi lượt boot ⇒ áp lực nới assert ⇒ **mất chốt «đoàn phí giảm thuế»**
(`invariant-count-must-filter-owned-rows`).

**Assert đúng — SET-EQUALITY theo mã, lọc `is_system = true AND deleted_at IS NULL`:**

1. `{TONG_THU_NHAP, TONG_BH_NV, THU_NHAP_CHIU_THUE, TONG_KHAU_TRU}` = **đúng bằng** tập `value_type='engine'`.
2. `{BHXH_NV, BHYT_NV, BHTN_NV}` = **đúng bằng** tập `kind='statutory_employee' AND pit_deductible`.
3. **Ca DƯƠNG tường minh**: `DOAN_PHI` **tồn tại** và `pit_deductible = false` — thiếu ca này thì «DOAN_PHI
   vắng mặt hoàn toàn» cũng xanh.
4. `payroll_statutory_rates`: hàng seed tồn tại **với đúng số PAY-DEC-014** (ghim số, không ghim «có hàng»).

Idempotent: `ON CONFLICT DO NOTHING` theo `salary_components_company_code_uq` (partial `WHERE deleted_at IS NULL`).

> Đây là **đổi chỗ thực thi, không đổi nội dung seed**: mã · `kind` · `value_type` · `pit_deductible` · số
> DEC-014 giữ **đúng nguyên** bảng DB-13 §13.4 và §13.7. DB-13 §15.3 bước B sẽ được đính chính cùng commit
> (`docs/DB/**` nằm trong `paths`).

### 3.2 WO `paths` thiếu và sai — phải sửa cùng commit

`harness/backlog.mjs` DB-1 khai `"apps/api/src/permissions/**"` (**thư mục không tồn tại**) và **không** khai
`"apps/api/src/payroll/**"` — trong khi WO bắt buộc chạm `permission/permission.service.ts` (2 allowlist) và
`payroll/` (seeder + registrar + `payroll.module.ts`). `paths` lái hook `guard-scope` **và** bộ chọn reviewer
(`wo-paths-drive-gate-and-scheduler`) ⇒ để nguyên là sửa file ngoài phạm vi cả phiên.

**Sửa ĐỦ BA mục** (mục 3 là chỗ chính bản vá đầu tiên bỏ sót — đúng lỗi mà nó tuyên bố đang vá):

1. `apps/api/src/permissions/**` → `apps/api/src/permission/**`;
2. **thêm** `apps/api/src/payroll/**` (seeder · registrar · module);
3. **thêm** `apps/api/src/foundation/**` — `paths` hiện chỉ có `foundation/seed/**`, trong khi §7 bắt buộc sửa
   `foundation/retention/retention.service.ts` + `.spec.ts` (`PROTECTED_TABLES += 7`).

### 3.3 `payroll_template_components` phá ratchet «0 GRANT DELETE» — ngoại lệ phải khai TƯỜNG MINH

`s13-payroll-db1-invariants.int-spec.ts:266` chạy `it.each(PAYROLL_TABLES)` ép **mọi** bảng payroll có **0**
GRANT DELETE. `payroll_template_components` **có** DELETE (DB-13 §13.6 — `PUT …/components` đặt lại cả danh
sách trong một tx). Nếu chỉ «thêm bảng vào danh sách trừ» thì ratchet mất răng cho **mọi** bảng sau.

**Chốt:** spec mới `s15-payroll-db1-invariants.int-spec.ts` khai
`DELETE_ALLOWED = ['payroll_template_components']` và assert **hai chiều**:
(a) mọi bảng payroll **ngoài** tập đó có 0 DELETE; (b) `payroll_template_components` **CÓ** DELETE *(kẻo ai đó
thu hồi rồi route 053 vỡ trong im lặng)*; (c) `DELETE_ALLOWED` có **đúng 1 phần tử** — thêm phần tử thứ hai
phải sửa spec và đi qua review, không lặng lẽ trôi.

---

## 4. Migration `0570_s15payrolldb1_payroll_v2_ddl.sql` — thứ tự BẮT BUỘC

```
(1)  GUARD tiền đề: salary_profiles / payroll_period_lines tồn tại
     · UNIQUE (company_id,id) có ĐỦ trên 4 bảng ĐÍCH của composite FK: users · org_units · salary_profiles
       · (payroll_templates + salary_components tự tạo ở bước (5), không cần guard)
     · 5 cột §12.1 CHƯA tồn tại (fail-loud nếu đã có ⇒ migration đã chạy nửa vời)
     · jsonb_typeof(allowances) = 'array' cho MỌI hàng — hàng object/scalar làm jsonb_array_length() NÉM
       với thông điệp khó đọc giữa lane; bắt sớm, thông điệp riêng
(2)  CREATE EXTENSION IF NOT EXISTS btree_gist            ← TRƯỚC mọi EXCLUDE (§15.4)
(3)  ALTER salary_profiles      : 5 cột + 5 CHECK (§12.1)  ← insurance_salary/probation_salary để NULL
(4)  ALTER payroll_period_lines : 3 cột + 2 CHECK (§12.4)  ← component_values_json DEFAULT '{}', KHÔNG CHECK <> '{}'
(5)  TẠO 7 bảng — THỨ TỰ PHỤ THUỘC:
       salary_profile_items · payroll_employee_settings · payroll_dependents · salary_components
       · payroll_statutory_rates · payroll_templates · payroll_template_components (cuối — FK tới 2 bảng trên)
     MỖI bảng, ĐÚNG thứ tự:  CREATE TABLE → UNIQUE (company_id,id) → composite tenant-FK → index/CHECK
                              → ENABLE RLS → FORCE RLS → CREATE POLICY tenant_isolation → GRANT
(6)  BACKFILL allowances → salary_profile_items   ← SAU (5); RLS+FORCE đã bật TRƯỚC hàng đầu tiên (bất biến #1)
(7)  VERIFY fail-loud (khuôn 0549/0559/0564)
```

### 4.1 Điểm chết người trong từng bước

| Bước | Bẫy | Chốt |
| --- | --- | --- |
| (3) | `salary_type` **trùng tên** với `employee_profiles.salary_type` (CHECK `emp_salary_type_check`, nghĩa khác hẳn) | CHECK mới mang tiền tố bảng: `salary_profiles_salary_type_check`; comment schema nói thẳng hai chỗ |
| (3) | Cám dỗ backfill `insurance_salary := base_salary` | **ĐỂ NULL.** Fallback sống ở service, một chỗ (§12.1) |
| (5) | `payroll_dependents` EXCLUDE trộn `=` với `&&` | `btree_gist` ở bước (2) + verify extension tồn tại |
| (5) | EXCLUDE khoá theo `dependent_tax_code` (nullable) ⇒ ràng buộc **rỗng** | khoá theo `full_name` **NOT NULL** (§13.3) |
| (5) | `salary_components` 4 nút aggregate khai `fixed`/`0` ⇒ `net=0` im lặng | `value_type='engine'` + `salary_components_engine_kind_check` **hai chiều** `(value_type='engine') = (kind='aggregate')` |
| (5) | Mã hệ thống xoá mềm được ⇒ tạo lại ⇒ che nút engine (partial unique bỏ qua hàng `deleted_at`) | `chk salary_components_system_not_deletable  is_system=false OR deleted_at IS NULL` |
| (5) | `code_shape_check` quên escape `_` của `LIKE` | `code NOT LIKE 'SYS\_%'` (và `TL\_`, `GT\_`) — ca test `SYS_GROSS` phải bị chặn |
| (6) | Phần tử `allowances` sai khuôn bị **bỏ qua im lặng** = mất một khoản phụ cấp | backfill **fail-loud**; verify `sum(jsonb_array_length)` **đúng bằng** `count(*)` bảng mới |
| (6) | **`component_code` lấy từ đâu** — `allowances` chỉ có `{name, amount}`, không có mã | §4.1.a — quy tắc ĐÓNG |
| (5) | `payroll_employee_settings`/`salary_profile_items` lộ cho worker | **KHÔNG** GRANT `mediaos_worker`; verify `aclexplode` = 0 quyền |

### 4.1.a 🔴 Quy tắc ánh xạ `allowances[] → salary_profile_items` — CHỐT ĐÓNG (đính chính DB-13 §12.2)

DB-13 §12.2 nói «backfill từ `allowances`» nhưng **không chốt `component_code` lấy từ đâu**. Ba lối đều hỏng
nếu để implementer tự quyết giữa lane:

| Lối | Hỏng thế nào |
| --- | --- |
| `component_code := name` | `name` là chữ Việt có dấu/khoảng trắng ⇒ **không khớp hàng nào** của `salary_components` ⇒ thành phần `value_type='profile_item'` không phân giải được ⇒ sau CONTRACT **khoản phụ cấp biến mất khỏi `gross` mà không lỗi**; và `salary_components_code_shape_check` cấm chữ thường/khoảng trắng nên **không tạo lại được** qua catalog |
| Map hết về `PHU_CAP` | hồ sơ có ≥2 phụ cấp ⇒ đụng `salary_profile_items_profile_component_uq` ⇒ **`23505` giữa migration** |
| Sinh hàng catalog cho từng `name` | **BẤT KHẢ THI ở `0570`**: §3.1 đã đẩy `salary_components` sang seeder **RUNTIME** ⇒ lúc backfill chạy **catalog chưa tồn tại**. Đây là hệ quả trực tiếp của chính §3.1 |

**CHỐT — mã tất định, KHÔNG đụng không gian tên catalog:**

```sql
component_code := 'PC_' || lpad(ordinality::text, 3, '0')   -- PC_001, PC_002… theo thứ tự phần tử trong mảng
note           := <name gốc>                                -- KHÔNG mất thông tin người đọc
amount         := <amount gốc>                              -- CHECK >= 0
```

- Ordinal **theo từng hồ sơ** ⇒ thoả `..._profile_component_uq` kể cả khi hai phụ cấp **trùng tên** (lối
  `name` thì trùng tên = `23505`; lối này thì không) ⇒ **bỏ bước đo `GROUP BY … HAVING count(*)>1`**.
- `PC_` **không** nằm trong tiền tố cấm (`SYS_`/`TL_`/`GT_`) và **không** trùng mã seed nào ⇒ không che biến hệ thống.

**Nợ bàn giao — `S15-PAYROLL-BE-1` `done_when` += (ghi vào `backlog.mjs` cùng commit):**

> *«Hồ sơ lương DI SẢN có `salary_profile_items.component_code` dạng `PC_nnn` **ngoài catalog**
> `salary_components`. Chốt hành vi: đường **ĐỌC** trả nguyên (kèm `note`); đường **GHI** (`020`/`022`) kiểm mã
> tồn tại ⇒ mã ngoài catalog trả **422 `PAYROLL-ERR-018`** với thông điệp hướng người dùng chọn mã catalog
> thật. Ca test: đọc hồ sơ di sản 200 · lưu lại y nguyên ⇒ 422 (KHÔNG 500, KHÔNG im lặng mất dòng).»*

### 4.2 Khối VERIFY fail-loud `0570` — danh sách ĐÓNG

1. 7 bảng mới: `relrowsecurity AND relforcerowsecurity` = true **và** có policy `tenant_isolation`.
2. GRANT app: **0 `DELETE`** trên 6/7 bảng; `payroll_template_components` **CÓ** `DELETE` (§3.3).
3. `mediaos_worker`: **0** quyền trên `salary_profile_items` · `payroll_employee_settings` · `payroll_dependents`;
   **đối chứng DƯƠNG đích danh** (mirror `s13-…-invariants:302` B5): worker **VẪN CÒN** `SELECT` trên
   `payroll_periods` · `bonus_penalties` · `payslip_acknowledgements` — thu hồi quá tay phải ĐỎ.
4. Tập cột UPDATE so bằng **`aclexplode`**, không đọc `has_table_privilege` cấp bảng.
5. Số composite FK **đúng bằng** danh sách khai trong migration (khuôn `0564` dòng 786).
6. `btree_gist` tồn tại; `payroll_dependents_no_overlap_excl` tồn tại và là `EXCLUDE`.
7. 7 bảng đều có `UNIQUE (company_id, id)` **và** `company_id` là **`NOT NULL`** — nullable thì composite FK
   chỉ bịt một nửa và `xtenant-fk-ratchet.int-spec.ts:231–243` (lớp P `<= 24`) sẽ ĐỎ.
8. 5 cột §12.1 + 3 cột §12.4 tồn tại **đúng kiểu**; 7 CHECK mới tồn tại **đúng tên**.
9. Backfill — **đẳng thức TỪNG HỒ SƠ** (🔁 đổi khi triển khai, xem dưới).

   > 🔁 **KHÁC điều kiện tự-mở-cổng #6 — ghi lại để review thấy.** Bản vá hứa «so với LITERAL đã đo».
   > Khi viết migration thì thấy literal cứng **đỏ oan MỌI lane**: số hàng `salary_profiles` của một lane
   > là hàm của fixture đang chạy, không phải thuộc tính của bản vá — literal `= 5` sẽ chặn mọi lane khác.
   > **Thay bằng phép so MẠNH HƠN**: `count(items) = jsonb_array_length(allowances)` cho **TỪNG hồ sơ**.
   > Nó bắt cả lỗi bỏ sót **lẫn lỗi BÙ TRỪ** (hồ sơ A thiếu 1, hồ sơ B thừa 1 — tổng vẫn khớp) mà phép so
   > tổng không thấy. Vế mà reviewer thật sự muốn (chứng minh cổng KHÔNG rỗng) được trả bằng **lượt lane
   > CÓ dữ liệu v1** ở §10 — đó mới là bằng chứng, không phải con số trong file.
   > Tổng vẫn `RAISE NOTICE` để dán vào PR.
10. `salary_profiles.allowances` **VẪN CÒN** (expand, chưa contract) — mất cột = đã contract sớm.

---

## 5. Migration `0571_s15payrolldb1_seed_perms_audit.sql` — TOÀN CỤC (khuôn `0565`)

1. **17 cặp** `INSERT INTO permissions … ON CONFLICT (action, resource_type) DO NOTHING`, tất cả
   `is_sensitive = TRUE`.
   Danh sách (SPEC-11 §11.3): `view`/`manage` × `payroll-employee` · `salary-component` · `payroll-template` ·
   `statutory-rate` · `payroll-advance` · `payment-batch` · `payroll-budget` (14) + `approve:payroll-advance` +
   `view-own:payroll-advance` + `view:payroll-report` = **17**.
2. **Ép `is_sensitive`** cho cặp đã tồn tại (nếu có) bằng khối riêng — `DO NOTHING` **không** ghi lại cờ
   (bài học `0565` bước 4b · `canonical-seed-pin-regression`).
3. **31 grant**: `employee` +1 (`view-own:payroll-advance` @**Own**) · `payroll-officer` +14 (17 − `manage:statutory-rate`
   − `manage:payroll-budget` − `view-own:payroll-advance`) · `company-admin` +16 (17 − `view-own:payroll-advance`) ·
   `manager`/`hr`/`hr-manager` **+0**. Cộng: 1+14+16 = **31**; 32+31 = **63**.
4. **UNION-ADD 10 giá trị** `audit_logs.object_type` — clone **nguyên khối** `0565` bước (7): neo 2 tầng,
   fail-closed, NO-LOSS/NO-GAIN (`audit-check-union-parse-anchor-trap`).
   `AUDIT_OBJECT_TYPES` (`db/schema/audit.ts`) đồng bộ **cùng commit**.

   **Literal ĐÓNG — 10 tên (SPEC-11 §12.1 ghi chú 4):**
   `payroll_employee` · `payroll_employee_setting` · `payroll_dependent` · `salary_component` ·
   `payroll_template` · `payroll_statutory_rate` · `payroll_advance` · `payroll_payment_batch` ·
   `payroll_budget` · `payroll_report`.

   > ⚠️ **BẤT ĐỐI XỨNG cố ý giữa hai không gian tên** — resource quyền là `statutory-rate`/`payment-batch`
   > nhưng `object_type` là `payroll_statutory_rate`/`payroll_payment_batch`. Đúng chỗ trôi tên ⇒ CHECK
   > violation = **500 trên đường ĐỌC**. Chép literal, đừng suy từ tên cặp quyền.
   >
   > ⚠️ `payroll_employee` và `payroll_report` **KHÔNG ứng với bảng nào** (chiếu HR bó hẹp · báo cáo là phép
   > đọc số liệu). Thiếu chúng ⇒ 6/18 đường audit-đọc của §18.1 B trả 500.
   >
   > ⚠️ **CÓ CHỦ ĐÍCH: cấp cả 3 giá trị của track C** (`payroll_advance` · `payroll_payment_batch` ·
   > `payroll_budget`) ngay ở DB-1 dù bảng thuộc DB-2 — một lượt UNION-ADD, tránh chạm parse-anchor lần hai.
   > **Đây KHÔNG phải cấp thừa**; reviewer sau đừng gỡ.
   >
   > ⚠️ `payroll_payment_lines` · `payroll_template_components` · `salary_profile_items` **KHÔNG** có
   > `object_type` riêng — vết đi kèm đối tượng cha.

### 5.1 VERIFY fail-loud `0571` — danh sách ĐÓNG

- Catalog PAYROLL = **34** cặp, **30** sensitive, **4** không sensitive (đúng 4 cặp cũ §11.1).
  **«PAYROLL» phải định nghĩa bằng LITERAL `resource_type IN (…)`, KHÔNG bằng `LIKE 'payroll%'`** — lọc
  `LIKE` bỏ sót `salary-profile` · `bonus-penalty` · `payslip` · `salary-component` · `statutory-rate` ·
  `payment-batch` ⇒ số ra khác 34 ⇒ áp lực «sửa hằng cho qua». Tiền lệ đúng: `s13-…-invariants:587`.
  **13 resource_type:** `payroll` · `payroll-period` · `salary-profile` · `bonus-penalty` · `payslip`
  *(5 của v1)* + `payroll-employee` · `salary-component` · `payroll-template` · `statutory-rate` ·
  `payroll-advance` · `payment-batch` · `payroll-budget` · `payroll-report` *(8 mới)*.
- Grant PAYROLL = **đúng 63** hàng (SET-EQUALITY, in ra hiện trạng khi lệch).
- `hr` · `hr-manager` · `manager` = **0** cặp PAYROLL trên **cả** `role_permissions` **và** `object_permissions`.
- `payroll-officer` **KHÔNG** giữ `manage:statutory-rate` và `manage:payroll-budget`.
- 🔴 mọi role giữ `manage:X` đều giữ `view:X` cho **bốn** tài nguyên: `payroll-advance` · `payment-batch` ·
  `payroll-budget` · `salary-component`.
- mọi role giữ `manage:payroll-template` đều giữ `view:salary-component`.
- mọi role giữ `approve:payroll-advance` đều giữ `view:payroll-advance`.
- Census wildcard phủ **BỐN** hình dạng `('*','*')` · `('act','*')` · `('*','res')` · grant qua role wildcard
  (`permission-grant-census-must-cover-four-wildcard-shapes`), kèm **ca đối chứng dương** để bộ lọc fixture
  không làm câu census mù với role THẬT (khuôn `0565`/D6b).
- `object_permissions` = **0** hàng trỏ 17 cặp mới ngay sau seed.

---

## 6. Seeder runtime MỚI — `PayrollMasterDataSeeder`

**File:** `apps/api/src/payroll/payroll-master-data.seeder.ts` + `payroll-seed.registrar.ts`
(mirror `attendance/att-master-data.seeder.ts` + `att-seed.registrar.ts`), đăng ký trong `payroll.module.ts`
(khối **additive**, hot-file — CLAUDE.md §9.3).

`seedKey = "payroll.master-data"` · `seedVersion = "v1"`. Trong tenant tx do runner cấp (RLS+FORCE ép
`company_id` ở DB):

1. **`salary_components`** — bảng seed DB-13 §13.4 nguyên văn: 4 `aggregate`/`engine`
   (`TONG_THU_NHAP` · `TONG_BH_NV` · `THU_NHAP_CHIU_THUE` · `TONG_KHAU_TRU`) · `BHXH_NV`/`BHYT_NV`/`BHTN_NV`
   (`pit_deductible = true`) · `DOAN_PHI` (**`false`**) · `BHXH_DN`/`BHYT_DN`/`BHTN_DN`/`KPCD` · `TNCN` ·
   nền `LUONG_CO_BAN`/`PHU_CAP`/`THUONG`/`PHAT`/`NGHI_KHONG_LUONG`/`TAM_UNG`. Tất cả `is_system = true`.
2. **`payroll_statutory_rates`** — 1 hàng, số PAY-DEC-014, `note` = «owner xác nhận 02/09/2026»:
   NV `8/1.5/1` · DN `17.5/3/1` · KPCĐ `2` · đoàn phí `1` · giảm trừ bản thân `11.000.000` · mỗi NPT
   `4.400.000` · trần lưu **THÀNH TIỀN** · `pit_brackets` **7 bậc**, bậc cuối `upTo = null`.
3. **`payroll_templates`** — 1 mẫu mặc định, **KHÔNG** gắn vào kỳ nào — **CỘNG
   `payroll_template_components` của mẫu đó**.
   🔴 Mẫu **0 thành phần** là mẫu không tái tạo gì: BE-2 «xem trước mẫu» và BE-3 «tính theo mẫu» chạy trên nó
   ra **bảng 0 cột / 0 giá trị mà không lỗi** — lại đúng hình dạng `empty-success-is-the-fail-open-shape`.
   **Nội dung:** một hàng `payroll_template_components` cho **MỖI** thành phần `is_system` vừa seed ở mục 1
   (`sort_order` theo thứ tự phiếu lương; `is_visible = false` cho `kind='statutory_employer'` — chi phí DN
   không phải cột của phiếu NV; `column_label` = NULL ⇒ dùng `salary_components.name`).
4. **Assert sau seed — KHÔNG «chặn boot»** (§3.1.a: runner nuốt throw; ném ⇒ batch `Failed` + log):
   a. SET-EQUALITY `{TONG_THU_NHAP, TONG_BH_NV, THU_NHAP_CHIU_THUE, TONG_KHAU_TRU}` = tập `value_type='engine'`
      (lọc `is_system AND deleted_at IS NULL`);
   b. SET-EQUALITY `{BHXH_NV, BHYT_NV, BHTN_NV}` = tập `kind='statutory_employee' AND pit_deductible`;
   c. **ca DƯƠNG**: `DOAN_PHI` tồn tại **và** `pit_deductible = false`;
   d. `payroll_statutory_rates` có hàng seed với **đúng số PAY-DEC-014**;
   e. **SET-EQUALITY không magic number**: `count(payroll_template_components của mẫu mặc định)` =
      `count(salary_components WHERE is_system AND deleted_at IS NULL)`, **và mọi `component_id` trỏ hàng
      `is_system`**. Hai tập seeded so với nhau ⇒ thêm/bớt thành phần hệ thống không làm assert trôi.

> ⚠️ **`seedVersion` + `ON CONFLICT DO NOTHING` = drift im lặng.** Sửa nội dung một hàng seed (ví dụ lật
> `pit_deductible`) mà **không bump `seedVersion`** thì `DO NOTHING` **không cập nhật hàng cũ** — công ty cũ
> giữ giá trị sai vĩnh viễn, chỉ assert ở mục 4 phát hiện. **LUẬT: đổi nội dung seed ⇒ bump `seedVersion`**,
> ghi ngay trong docblock của seeder.

> `ctx.track()` payload chỉ master/config — **không** PII/secret (bất biến #3). `pit_brackets` là ngưỡng thuế
> công khai, được phép vào payload track.

---

## 7. Parity CÙNG COMMIT (thiếu bất kỳ dòng nào = cổng mù)

| File | Việc | Vì sao bắt buộc cùng commit |
| --- | --- | --- |
| `apps/api/src/db/schema/payroll.ts` | 7 bảng mới + 8 cột mới, **đúng tên CHECK/index** | drizzle parity; lệch ⇒ `db:generate` đẻ migration ma |
| `packages/contracts/src/payroll.ts` | `salaryTypeEnum` · `pitPayerEnum` · `salaryComponentKindEnum`(7) · `salaryComponentValueTypeEnum`(**4**, có `engine`) · `payrollTemplateScopeEnum` · `dependentRelationshipEnum`. **KHÔNG** đụng `payrollPeriodStatusEnum` | mirror CHECK **hai chiều ĐÚNG BẰNG** (`contract-must-mirror-db-check-both-directions`) |
| `packages/contracts/src/index.ts` | export các enum mới | barrel |
| `test/integration/rls-registry.ts` | **7 case mới** + fixture | `rls-guards.int-spec` lấy danh sách bảng cần kiểm **từ registry** ⇒ bảng không đăng ký thì **nhánh kiểm cô lập không chạy cho nó**. *(Có đai thứ hai: `rls-guards.int-spec.ts:52–72` assert «bảng có `company_id` chưa đăng ký» ⇒ quên đăng ký vẫn ĐỎ. Nên câu «im lặng bỏ qua» là **quá lời** — nhưng việc phải làm thì không đổi.)* |
| `apps/api/src/db/schema/audit.ts` | `AUDIT_OBJECT_TYPES` += 10 literal (§5.4) | §5.4 đòi đồng bộ; thiếu ⇒ hằng TS lệch CHECK DB |
| `test/helpers/seed.ts` `cleanupTenants()` | 7 bảng, **con→cha**, chèn ĐÚNG CHỖ — xem §7.1 | thiếu ⇒ đỏ hàng loạt `afterAll` (`drop-table-must-clean-test-teardown`) |
| `foundation/retention/retention.service.ts` | `PROTECTED_TABLES` += **6** (🔁 không phải 7 — xem dưới) | retention hard-delete bảng không có GRANT DELETE ⇒ `42501` uncaught, hỏng cả lượt cleanup |
| `permission/permission.service.ts` | APPEND 17 cặp vào **CẢ HAI** `SENSITIVE_CAPABILITY_ALLOWLIST` và `SENSITIVE_SCREEN_GATE_PAIRS` ⇒ 30 mỗi bên | cặp sensitive gác màn mà thiếu allowlist ⇒ màn **biến mất** với đúng vai được cấp quyền (lớp lỗi đã lặp 8+ lần) |
| `harness/backlog.mjs` | sửa `paths` (§3.2) + `done_when` phản ánh §3.1 | `paths` lái guard-scope + reviewer |
| `docs/DB/DB-13` §15.3 bước B | đính chính chỗ đặt seed company-scoped (§3.1) | doc là nguồn sự thật của WO sau |
| `docs/erd-current.md` | 7 bảng mới + append-only/RLS | §9 đối chiếu |

> 🔁 **`PROTECTED_TABLES` nhận 6, KHÔNG phải 7 — `payroll_template_components` CỐ Ý VẮNG.** Tiêu chí của tập
> đó, ghi ngay trong docblock của nó, là «bảng KHÔNG có `GRANT DELETE` ⇒ retention phát lệnh sẽ ăn `42501`
> uncaught». Bảng này **CÓ** DELETE (ngoại lệ §3.3) nên tiêu chí không áp; nhét nó vào sẽ làm hỏng chính tiêu
> chí đang giữ tập đó đọc được. DB-13 §13.6 nói đúng điều này. Lý do vắng mặt đã ghi thành comment ngay tại
> chỗ, để lượt sau không đọc thành bỏ sót.

### 7.1 `cleanupTenants()` — thứ tự ĐÍCH DANH (câu «trước `DELETE FROM users`» KHÔNG đủ)

Khối PAYROLL hiện có ở `test/helpers/seed.ts:508–511` theo thứ tự
`payroll_period_lines` → `payroll_periods` → `salary_profiles`. Một khối 7 dòng thêm **sau** khối đó vẫn thoả
câu chữ «trước `DELETE FROM users`» nhưng **vỡ `23503` hàng loạt**, vì `salary_profile_items` trỏ
`salary_profiles (NO ACTION)` mà `salary_profiles` đã bị xoá ở dòng 511.

**Chèn ĐÚNG hai chỗ:**

```text
… payroll_period_lines
   payroll_dependents                 ← mới (chỉ trỏ users)
   payroll_employee_settings          ← mới (chỉ trỏ users)
   salary_profile_items               ← mới, PHẢI TRƯỚC dòng salary_profiles đang có
   payroll_periods
   salary_profiles                    ← dòng CŨ, giữ nguyên vị trí
   payroll_template_components        ← mới, PHẢI TRƯỚC payroll_templates VÀ salary_components
   payroll_templates                  ← mới
   salary_components                  ← mới
   payroll_statutory_rates            ← mới (độc lập)
… DELETE FROM users
```

---

## 8. Test — RED TRƯỚC

**File mới `apps/api/test/integration/s15-payroll-db1-invariants.int-spec.ts`** (khuôn `s13-…-invariants`):

| Nhóm | Ca | Ghi chú chống xanh-RỖNG |
| --- | --- | --- |
| A. RLS | A1 7 bảng RLS+FORCE+policy · A2 **đối chứng DƯƠNG** INSERT đúng tenant đi qua · A3 ghi chéo tenant bị chặn | thiếu A2 ⇒ A1/A3 xanh vì bảng rỗng |
| B. GRANT | B1 6/7 bảng **0 DELETE** · B2 `payroll_template_components` **CÓ** DELETE · B3 `DELETE_ALLOWED` đúng **1** phần tử · B4 worker 0 quyền trên 3 bảng PII · B5 **đối chứng DƯƠNG** worker còn SELECT chỗ cũ | §3.3 |
| C. CHECK | C1 `value_type='fixed'` + `kind='aggregate'` bị chặn (**hai chiều**) · C2 `engine` + `kind<>'aggregate'` bị chặn · C3 **đối chứng DƯƠNG** `engine`+`aggregate` đi qua · C4 xoá mềm hàng `is_system` bị chặn · C5 `SYS_GROSS`/`TL_X`/`GT_X` bị chặn (3 ca) · C6 **đối chứng DƯƠNG** mã thường đi qua · C7 NPT chồng khoảng ⇒ **`23P01`** (không phải `23505`) · C8 **đối chứng DƯƠNG** hai NPT khác tên chồng khoảng đi qua · C9 `pay_ratio_pct` 0 và 101 bị chặn · C10 `gross_up_iterations` 31 bị chặn · C11 `template_fingerprint` sai regex bị chặn | C5 là chốt DUY NHẤT chặn «che biến hệ thống»; C7 ghim **mã SQLSTATE**, không ghim message |
| D. Seed quyền | D1 grant = **63** SET-EQUALITY · D2 hr/hr-manager/manager = 0 trên **cả hai** bảng · D3 `is_sensitive` = **30** đúng bằng · D4 `manage:X ⇒ view:X` cho **4** tài nguyên · D5 census **4** hình dạng wildcard + **đối chứng dương** · D6 `object_permissions` = 0 | |
| E. Seed master-data | xem §8.1 — **phải chạy qua `runner.reconcileCompany()`**, không gọi thẳng `seeder.seed()` | §3.1.a |
| F. Backfill | F1 hồ sơ có 2 `allowances` ⇒ 2 hàng `salary_profile_items` mã `PC_001`/`PC_002`, `amount` khớp, `note` = `name` gốc · F2 cột `allowances` **vẫn còn** · F3 phần tử sai khuôn ⇒ migration **ĐỎ** (xem §8.2) | F1 ghim §4.1.a |
| G. Chống migration nửa vời | G1 `_journal.json` có `0570`+`0571` · G2 `scripts/check-migration-no-drop.sh` xanh | `migration-not-in-journal-is-silently-skipped` |

### 8.1 Nhóm E — đường THẬT, và ca ÂM phải assert `ok === false`

`runner.runOne()` **nuốt mọi throw** (§3.1.a) ⇒ `await expect(...).rejects` **KHÔNG BAO GIỜ ĐỎ**. Ca ÂM viết
bằng `.rejects` là **ca xanh-rỗng kiểu mới**, đúng thứ WO này đang đi vá.

| Ca | Nội dung | Chốt |
| --- | --- | --- |
| E1 | Công ty MỚI → `runner.reconcileCompany()` → SET-EQUALITY 4 mã `engine` | tiền lệ `dash-seed-catalog-permissions.int-spec.ts:294`; `backlog.mjs:2259` ghi thẳng «KHÔNG gọi `seeder.seed()` trực tiếp → tránh false-green» |
| E2 | SET-EQUALITY 3 mã `pit_deductible` **+ ca DƯƠNG** `DOAN_PHI` tồn tại và `= false` | thiếu ca dương ⇒ «DOAN_PHI vắng mặt» cũng xanh |
| E3 | Chạy `reconcileCompany()` **hai lần** ⇒ không nhân bản (`ON CONFLICT DO NOTHING`) | |
| E4 | **ca ÂM**: lật `DOAN_PHI.pit_deductible = true` rồi chạy lại ⇒ assert `outcome.ok === **false**` | **KHÔNG** dùng `.rejects` |
| E5 | Ghim **số PAY-DEC-014**: `personal_deduction = 11.000.000` · `dependent_deduction = 4.400.000` · NV `8/1.5/1` · DN `17.5/3/1` · KPCĐ `2` · đoàn phí `1` · `pit_brackets` **7 phần tử**, phần tử cuối `upTo = null` | `backlog.mjs` `done_when` đòi «có test ghim số seed» |
| E6 | Mẫu mặc định: SET-EQUALITY `count(template_components)` = `count(salary_components WHERE is_system)`, mọi `component_id` trỏ hàng `is_system` | §6 mục 4e |

### 8.2 F3 — cơ chế nghiệm thu «backfill fail-loud», chọn (iii)

Backfill là **SQL trong migration**, chạy đúng một lần — **không có «hàm backfill»** để test gọi lại. Ba lối:

| Lối | Phán quyết |
| --- | --- |
| (i) migration tạo `FUNCTION` PL/pgSQL **ở lại DB** | ❌ đẻ **bề mặt mới ở vùng đỏ** (owner · `GRANT EXECUTE` · `search_path`) cho một việc dùng một lần |
| (ii) chép SQL sang test | ❌ test **ghim bản sao của chính nó**, không chứng minh gì về migration — lối implementer sẽ chọn nếu plan im |
| **(iii) lượt lane có gieo dữ liệu hỏng** | ✅ **CHỌN** |

**Thủ tục (iii):** lane DB riêng → áp migration tới `0569` → `INSERT` một `salary_profiles` có
`allowances = '[{"name":"X"}]'::jsonb` (thiếu `amount`) → áp `0570` → **phải ĐỎ** với `RAISE` của bước (6) →
**dán nguyên văn thông điệp `RAISE` vào PR**. Không có log này thì chốt «fail-loud khi phần tử sai khuôn»
(bản vá DOC-1 §12.2) là **lời hứa chưa ai chạy** (`known-issue-workaround-may-never-have-run`).

**Chạy thật:** `bash scripts/lane-db-setup.sh s15db1` → `export LANE_DB=mediaos_s15db1` →
`bash harness/check.sh --lane-db=s15db1`. **Không** set `LANE_DB` = int-spec bị SKIP ⇒ «XANH KHÔNG ĐỦ BẰNG
CHỨNG» (CLAUDE.md §9.5). Trước PR: `bash harness/check.sh --all`.

**6 file test di sản + `demo-seed-full.mjs`** đọc/ghi cột cũ phải sửa cùng commit (DB-13 §10.1) — **đo lại**
danh sách lúc chạy, không tin con số «6».

---

## 9. Rủi ro tồn đọng (không chặn, ghi để review nhìn thấy)

| # | Rủi ro | Vì sao chấp nhận ở WO này |
| --- | --- | --- |
| R1 | `allowances` còn sống song song `salary_profile_items` (dual-write ở BE-1) | EXPAND-CONTRACT bắt buộc; CONTRACT là WO riêng **sau** khi đo 0 đường đọc |
| R2 | `pit_brackets` liên tục (không hở/chồng) **không** ép được ở DB | CHECK chỉ ép hình dạng; liên tục kiểm ở service + 6 ca hỏng — thuộc **BE-3** |
| R3 | `component_code` là TEXT, không FK sang `salary_components.code` | có chủ đích (§13.1): hồ sơ lương đóng băng theo `effective_date`; service kiểm khi GHI ⇒ ERR-018 — thuộc **BE-1** |
| R4 | `pay_ratio_pct` **không** áp lên căn cứ đóng BH — DB không ép được | ca test ở **BE-3** là chốt duy nhất (§12.1) |
| R5 | Verify quyền chỉ đúng **tại thời điểm migration** (`permission-admin` gỡ được lúc runtime) | ca đối chứng thuộc **QA-1** (§11.3 ghi chú 7) |
| R6 | Migration chạy bằng role `mediaos` (**SUPERUSER/BYPASSRLS**, `.env.example:33`) ⇒ khối VERIFY của `0570` **KHÔNG chứng minh policy đúng** — nó chỉ chứng minh policy **tồn tại** | chứng minh policy THẬT nằm ở int-spec nhóm A, chạy bằng `mediaos_app`. Đừng đọc «VERIFY xanh» thành «cô lập tenant đã chứng minh» |
| R7 | Seeder chạy runtime ⇒ bốn đường §3.1.a có thể bỏ sót một công ty | bù bằng cổng 422 ở BE-2/BE-3 (§3.1.a), **không** bằng niềm tin vào boot |

---

## 10. Definition of Done

### 10.0 BẰNG CHỨNG ĐÃ CHẠY (11/09/2026)

**Migration `0570`+`0571` áp sạch trên lane MỚI TINH** (`mediaos_s15db1`, chain `0000→latest`). Đo trên DB:
7 bảng `RLS+FORCE` · 7 policy · `btree_gist` ✓ · `EXCLUDE` ✓ · **26 composite FK** · catalog **34 cặp /
30 sensitive** · **63 grant** · **14 `object_type`** PAYROLL · `payroll_template_components` CÓ `DELETE` ·
6 bảng kia **0** `DELETE` · `mediaos_worker` **0 quyền** trên cả 7.

**Lượt lane CÓ dữ liệu v1** (`mediaos_s15bf` — migrate tới `0569`, gieo 4 hồ sơ, rồi áp `0570`):

| | profiles (sống) | allowance items (sống) | allowance items (tất cả) |
| --- | --- | --- | --- |
| **TRƯỚC** | 3 | 5 | 6 |
| **SAU** | 3 | — | — |
| `salary_profile_items` tạo ra | | **5** | trong đó **5/5** đúng khuôn `PC_nnn` |

Hồ sơ xoá mềm (1 mục) **cố ý không backfill** ⇒ `6 − 5 = 1` khớp. Hai phụ cấp **TRÙNG TÊN** của cùng một hồ sơ
thành `PC_001` + `PC_002` (`note` giữ tên gốc) — **đây chính là ca mà lối `component_code := name` sẽ chết
`23505` giữa lane**, nên §4.1.a không phải lo xa.

**Lượt gieo dữ liệu HỎNG** (`mediaos_s15bad`, §8.2 lối iii) — `0570` **ĐỎ** đúng như thiết kế:

```text
[0570] backfill DUNG: salary_profiles.allowances co phan tu SAI KHUON (thieu name/amount hoac
amount khong parse duoc): profile=66666666-6666-6666-6666-666666666666 idx=1 elem={"name": "Thiếu amount"}
```

**Ca đối chứng RLS (đúng cổng)**: `ALTER TABLE salary_components NO FORCE ROW LEVEL SECURITY` ⇒
`rls-guards.int-spec` **ĐỎ** đích danh *«salary_components thiếu FORCE RLS»* ⇒ nhánh registry-driven THẬT SỰ
phủ 7 bảng mới (không phải chỉ đai «bảng chưa đăng ký»). Đã khôi phục.

**Cổng dự án**: `bash harness/check.sh --lane-db=s15db1` ⇒ **XANH**, 675/675 file test API + mọi workspace,
`secret-literals` · `lint` · `typecheck` · `migration-no-drop` · `tooling-tests` đều xanh, **không** banner
«XANH KHÔNG ĐỦ BẰNG CHỨNG».

**Bàn giao DB-2**: trên lane sạch `count(*) FROM payroll_periods WHERE status='Paid'` = **0** (v1 chưa lên
PROD). DB-2 phải ĐO LẠI trên môi trường đích trước khi chạy bước (3) của §12.3.

### 10.1 Checklist

- [ ] `0570` + `0571` áp sạch trên lane DB **MỚI TINH** **và** trên lane đã có dữ liệu v1 — **dán số backfill
      trước/sau vào PR** (lượt lane-sạch là tautology, §4.2 #9; bằng chứng chỉ tồn tại ở lượt có dữ liệu).
- [ ] **Dán nguyên văn thông điệp `RAISE`** của lượt gieo dữ liệu hỏng (§8.2 lối iii) vào PR.
- [ ] `scripts/check-migration-no-drop.sh` xanh; `_journal.json` có cả hai tag.
- [ ] `s15-payroll-db1-invariants.int-spec.ts` xanh trên `LANE_DB`, **có đủ ca đối chứng dương/âm** ở mọi nhóm.
- [ ] `rls-guards.int-spec` xanh **và** ca đối chứng **ĐÚNG CỔNG**: đổi `FORCE`/policy của MỘT bảng mới ⇒ spec
      phải ĐỎ. ⚠️ **KHÔNG** dùng ca «gỡ bảng khỏi `rls-registry`» — `rls-guards.int-spec.ts:52–72` đã có assert
      đóng «bảng có `company_id` chưa đăng ký», nên ca đó đỏ **vì assert khác**, không chứng minh nhánh
      registry-driven có chạy.
- [ ] `pnpm typecheck` + `pnpm build` + `pnpm lint` xanh toàn workspace.
- [ ] `bash harness/check.sh --all` xanh, **không** banner «XANH KHÔNG ĐỦ BẰNG CHỨNG».
- [ ] FULL gate: `security-reviewer` + `silent-failure-hunter` — verdict PASS (chạy **tuần tự**, không song song).
- [ ] `docs/DB/DB-13` §15.3 bước B đính chính; `docs/erd-current.md` cập nhật; `harness/backlog.mjs` `paths` sửa.
- [ ] Số đo `count(*) FROM payroll_periods WHERE status='Paid'` ghi vào comment `0570` để **DB-2** dùng.
