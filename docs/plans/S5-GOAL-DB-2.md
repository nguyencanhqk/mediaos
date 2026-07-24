# Plan — S5-GOAL-DB-2 (Đợt D: task_templates + task_template_items)

> 🔴 RED / crown (migration + permission + audit CHECK). Lane DB **tuần tự** — KHÔNG chạy song song lane
> migration khác. Nguồn sự thật: **DB-11 §6.3/§6.4/§8/§9** + **SPEC-10 §11** (`('manage','task-template')`).
> Đối chiếu bất biến CLAUDE.md §2 (#1 RLS FORCE · #2 append-only/soft-delete · #3 no-secret).

## §0. Quyết định chốt (đọc trước khi code)

- **D-num — SỐ MIGRATION:** head THẬT = idx **192 / `0525`** (`when=1717587314000`). Số 0508/0509 đã bị wave
  LMS chiếm. ⇒ WO này lấy **0526 + 0527 + 0528**. `when` +1000ms mỗi cái: 0526 `1717587315000` (idx 193),
  0527 `1717587316000` (idx 194), 0528 `1717587317000` (idx 195). **Kiểm lại `_journal.json` NGAY TRƯỚC KHI
  GHI** (bẫy `wo-paths-drive-gate-and-scheduler`).
- **D1 — TÁCH 3 migration** (plan-review REVISE #1: audit PHẢI đứng riêng để probe test đọc-cả-file mà KHÔNG
  chạm seed catalog global — mẫu 0509 là pure-audit nên probe được; gộp seed+audit thì probe chạy INSERT
  permissions/role_permissions THẬT mỗi vòng probe):
  - `0526_s5_goaldb2_task_templates.sql` — DDL: 2 bảng + RLS ENABLE+FORCE + policy literal-GUC + index + GRANT.
  - `0527_s5_goaldb2_seed_task_template_perm.sql` — seed cặp `('manage','task-template')` + grant per-pair
    (manager Department, company-admin Company) + verify fail-LOUD. **KHÔNG audit.**
  - `0528_s5_goaldb2_audit_task_template.sql` — **PURE audit**: UNION-ADD `'task_template'` vào
    `audit_logs.object_type` CHECK (mirror 0509, neo 2 tầng D4). Probe-testable (đọc cả file như 0509).
- **D2 — MA TRẬN GRANT** (SPEC-10 §11: "Trưởng đơn vị: department · BOD/Admin: all · Nhân viên: không"):
  chỉ **2 hàng** — `manager → Department`, `company-admin → Company`. `employee` KHÔNG, `hr` KHÔNG (hr không
  phải trưởng đơn vị/admin; goal của hr chỉ view Company). Không có cặp `access` riêng cho template — quản lý
  template nằm TRONG module GOAL (đã seed 0506), truy cập gated bởi màn GOAL-SCREEN-006.
- **D3 — is_sensitive = false** (SPEC-10 §11: "is_sensitive đề xuất false cho tất cả"). KHÔNG đụng allowlist
  sensitive FE, KHÔNG đụng pin `auth-seed-canonical-roles` (chỉ THÊM cặp mới, không flip cặp cũ).
- **D4 — AUDIT UNION-ADD NEO 2 TẦNG** (memory `audit-check-union-parse-anchor-trap`, WO này là "bản clone"
  mà PR #259 cảnh báo): DO-block phải **neo CẢ tầng-1 (`{…}`) LẪN tầng-2 (`ARRAY[…]`) vào vế `object_type =
  ANY (…)`** trước khi bắt mảng — KHÔNG quét nháy đơn/`{…}` trên cả constraintdef (sẽ hút giá trị từ vế phủ
  định của CHECK hợp thành hoặc từ `{…}` của cột khác đứng trước). Giữ nguyên fail-closed + NO-LOSS + NO-GAIN
  + `lock_timeout 5s` của mẫu 0509. **Int-spec BẮT BUỘC có ca "vế phủ định dạng BARE `{…}`"** — đây chính là
  lỗ tầng-1 mà test 0509 KHÔNG phủ (0509 chỉ test dạng ARRAY).
- **D5 — task_template_items.default_priority CHECK** theo task priority THẬT (DB-06 §8.5 =
  `workflow.ts:480`): `'urgent','high','medium','low','none'` (chữ thường). Nullable ⇒ `default_priority IS
  NULL OR default_priority IN (...)`.
- **D6 — worker grant:** app `SELECT,INSERT,UPDATE` (soft-delete = UPDATE, KHÔNG DELETE); worker `SELECT`
  (mirror task-core 0478 + goals 0504). KHÔNG bảng nào là append-only ⇒ cả 2 bảng có `deleted_at` + GRANT UPDATE.

## §1. Bảng (DB-11 §6.3/§6.4)

### task_templates
`id`, `company_id` (NOT NULL, DEFAULT literal-GUC, FK companies ON DELETE CASCADE), `name` varchar(255) NOT
NULL, `description` text, `department_id` uuid NULL FK org_units ON DELETE **SET NULL** (NULL = template dùng
chung công ty; SET NULL vì template không "thuộc về" phòng theo kiểu anchor-bắt-buộc như goals — xoá phòng thì
template thành dùng-chung, KHÔNG xoá template/vỡ CHECK), `is_active` boolean NOT NULL DEFAULT true, audit
(created_at/by, updated_at/by) + soft delete (deleted_at/by, FK users ON DELETE SET NULL).
- Index: `uq_task_templates_company_name` UNIQUE (company_id, name) WHERE deleted_at IS NULL;
  `idx_task_templates_company_dept` (company_id, department_id) WHERE deleted_at IS NULL.

### task_template_items
`id`, `company_id` (NOT NULL, DEFAULT literal-GUC, FK companies CASCADE), `template_id` uuid NOT NULL FK
task_templates ON DELETE **CASCADE** (item là con của template — xoá cứng template kéo item; thực tế soft-delete
ở service), `title` varchar(500) NOT NULL, `description` text, `default_priority` varchar(50) NULL (CHECK D5),
`estimate_hours` numeric(8,2) NULL, `checklist` jsonb NULL (mảng string, map vào task_checklists khi áp),
`sort_order` integer NOT NULL DEFAULT 0, audit + soft delete.
- Index: `idx_task_template_items_tpl` (company_id, template_id, sort_order) WHERE deleted_at IS NULL.
- CHECK: `chk_task_template_items_priority` = default_priority IS NULL OR IN (5 giá trị D5).

**RLS (cả 2 bảng, TRƯỚC mọi INSERT — bất biến #1):** ENABLE + FORCE + policy `tenant_isolation`
USING+WITH CHECK `company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid` (mẫu
0479/0504). `rls-coverage-assert` + `rls-guards` sẽ tự bắt nếu thiếu FORCE / thiếu registry.

## §2. Files (paths WO)

| File | Loại | Nội dung |
| --- | --- | --- |
| `apps/api/migrations/0526_s5_goaldb2_task_templates.sql` | NEW | DDL 2 bảng + RLS + index + GRANT |
| `apps/api/migrations/0527_s5_goaldb2_seed_task_template_perm.sql` | NEW | seed pair + grant + verify (KHÔNG audit) |
| `apps/api/migrations/0528_s5_goaldb2_audit_task_template.sql` | NEW | PURE audit UNION-ADD (mirror 0509, neo 2 tầng) |
| `apps/api/migrations/meta/_journal.json` | APPEND | 3 entry (idx 193/194/195, when +1000 mỗi cái) |
| `apps/api/src/db/schema/task-templates.ts` | NEW | Drizzle PARITY-only (KHÔNG db:generate) |
| `apps/api/src/db/schema/index.ts` | APPEND | `export * from "./task-templates"` + comment khối WO |
| `apps/api/src/db/schema/audit.ts` | APPEND | thêm `"task_template"` vào `AUDIT_OBJECT_TYPES` + nối `0528` vào comment danh sách mig (CÙNG COMMIT với 0528) |
| `apps/api/test/integration/rls-registry.ts` | APPEND | 2 case (task_templates, task_template_items) |
| `apps/api/test/integration/goal-db2-templates.int-spec.ts` | NEW | RED-trước: xem §3 |
| `harness/backlog.mjs` | EDIT | status S5-GOAL-DB-2 → done (DoD §8) |
| `docs/DB/DB-11 GOAL Database Design.md` | EDIT | §9 note "0510+" → 0526/0527/0528 thực tế (docs, non-block) |

## §3. Int-spec (RED-before-GREEN, gate `hasDb && LANE_DB`)

`goal-db2-templates.int-spec.ts` (mirror `goal-db-seed` + `lms-audit-object-types`):
1. **Cross-tenant deny** (RLS+FORCE): app GUC=A thấy template A, KHÔNG thấy B; app GUC=A INSERT company_id=B →
   `row-level security`; app ngoài context → 0 row. Cả 2 bảng.
2. **Soft-delete / grant:** app UPDATE (soft-delete) OK; app DELETE task_templates → `permission denied`
   (42501); DELETE task_template_items → denied.
3. **UNIQUE:** 2 template cùng (company, name) chưa xoá → `23505`; xoá mềm cái đầu rồi tạo lại cùng tên → OK
   (partial unique WHERE deleted_at IS NULL).
4. **CHECK priority:** item default_priority='bogus' → `23514`; ='high' → OK; =NULL → OK.
5. **Seed-assert:** cặp `('manage','task-template')` tồn tại is_sensitive=false; grant manager=Department,
   company-admin=Company; employee=NULL, hr=NULL (grantScope helper mirror goal-db-seed).
6. **Audit UNION-ADD:** `audit_logs` CHECK object_type ⊇ `'task_template'`; **NO-LOSS**: CHECK ⊇ toàn bộ
   `AUDIT_OBJECT_TYPES` + canary `'defect'` (chỉ có ở DB, chống rewrite-from-TS); app INSERT audit
   object_type='task_template' (company_id từ GUC) OK; object_type lạ vẫn `23514`.
7. **Audit DO-block idempotent + NEO 2 TẦNG (probe table đọc CẢ FILE `0528` rồi `replaceAll('audit_logs',
   probe)` — mẫu `lms-audit-object-types` ca 5; vì 0528 là PURE-audit nên chạy cả file trên probe KHÔNG chạm
   catalog global).** Các dạng constraintdef:
   - bare `'{a,b}'::text[]` → union đúng, chạy 2 lần không đổi;
   - `ARRAY['a'::text,…]` → union đúng;
   - **vế phủ định BARE đứng TRƯỚC allow-list** (lỗ tầng-1, 0509 KHÔNG phủ):
     `CHECK (object_type <> ALL('{ghost}'::text[]) AND object_type = ANY('{company,user}'::text[]))` →
     sau migration `'ghost'` KHÔNG lọt allow-list, `company/user` GIỮ NGUYÊN. ⚠ Dùng `object_type <> ALL(...)`
     (KHÔNG cột `other` — probe table chỉ có cột `object_type`, plan-review REVISE #2). Ca này ĐỎ trên tầng-1
     chưa-neo của 0509, XANH khi neo `object_type = ANY`. **Assert quyết định = trạng thái allow/deny SAU
     migration (bên ngoài), KHÔNG dựa NO-LOSS/NO-GAIN nội bộ** — chúng PASS-oan trên parse sai (memory).
   - **vế phủ định ARRAY đứng TRƯỚC** (lỗ tầng-2):
     `CHECK (object_type <> ALL(ARRAY['ghost'::text]) AND object_type = ANY(ARRAY['company'::text]))` →
     tương tự: `ghost` bị loại, `company` giữ.
   - fail-closed: 0 constraint match → THROW; 2 constraint match LIKE → THROW (giữ như 0509).
8. **_journal.json fs-integrity** (thuần fs, KHÔNG gate): idx liên tục · `when` tăng ngặt + duy nhất · mỗi tag
   có file .sql · tag 0526/0527 có mặt (mirror `lms-audit-object-types` ca 6).

RED evidence: migrate tới 0525 → bảng/pair/audit-value chưa có ⇒ suite ĐỎ. GREEN sau 0526+0527.

## §4. Thứ tự thực thi & verify

1. Ghi 2 file .sql + append `_journal.json` (idx/when đúng) + schema parity + audit const + rls-registry + int-spec.
2. `pnpm --filter @mediaos/api typecheck` + `pnpm --filter @mediaos/api lint` xanh.
3. **RED trước:** chạy int-spec trên DB migrate tới **0525** (chứng minh đỏ) — hoặc lưu log kỳ vọng.
4. `bash harness/check.sh --lane-db=goaldb2` (tự `lane-db-setup.sh` → migrate 0000→head → chạy int-spec THẬT).
   Cần Postgres; không có Docker → cảnh báo, verify tay bằng `migration-smoke` mô tả.
5. FULL gate DB: `database-reviewer` + `security-reviewer` + `rls-tenant-isolation-tester` +
   `silent-failure-hunter` PASS trước khi mở PR.

## §5. Rủi ro / bẫy (đối chiếu memory)

- `audit-check-union-parse-anchor-trap` — **cốt lõi WO này**. Neo 2 tầng (D4) + ca test vế-phủ-định-bare (§3.7).
- `migration-expand-contract-required` — KHÔNG áp: chỉ THÊM cặp/giá trị (append), không revoke grant đang enforce.
- `canonical-seed-pin-regression` — không flip is_sensitive nào ⇒ pin không đỏ. Đếm perm 7d/task-seed là
  before/after DELTA (không phải pin tuyệt đối) ⇒ thêm cặp mới an toàn (đã verify).
- `wo-paths-drive-gate-and-scheduler` — kiểm `_journal.json` NGAY trước khi ghi (tránh trùng 0526 với phiên khác).
- `src-green-is-not-integration-green` — int-spec đặt ở `test/integration/**` (đã trong paths).
- FK đơn cột KHÔNG ép cùng-tenant (finding GOAL-DB-1) — RLS + WITH CHECK ép company_id; service (TPL-1) resolve
  template_id dưới tenant scope. Ở tầng DB, FK company CASCADE + policy đủ cô lập.
