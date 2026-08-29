# Micro-plan — `S11-ASSET-DB-1` (🔴 red · crown · FULL gate · lane migration NỐI TIẾP)

> **WO:** Schema + migration ASSET theo DB-15: 6 bảng mới (`asset_categories` · `assets` · `asset_assignments` · `asset_maintenances` · `asset_inventories` · `asset_inventory_items`) — RLS+FORCE, composite tenant FK, seed role/permission/audit/NOTI catalog.
> **Nguồn sự thật:** [DB-15 §4 · §6 · §7 · §9](<../DB/DB-15 ASSET Database Design.md>) · [SPEC-13 §11 · §13.5 · §17 · §18](<../SPEC/SPEC-13 ASSET.md>) · [ma trận §9d](<../permission-matrix-spec.md>) · [kế hoạch wave §7](S11-OFFICE-WAVE.md)
> **Nhánh:** `wo/s11-asset-db-1` → PR vào `master`. Vùng 🔴 ⇒ **người chốt merge**, KHÔNG nhãn auto-merge.
> **Lane DB:** `bash scripts/lane-db-setup.sh assetdb1` → `export LANE_DB=mediaos_assetdb1` (đã dựng 29/08, head 0548).
> **Rev 2** (29/08/2026) — sau `plan-reviewer` vòng 1 **REVISE**: 6 BLOCKING + 13 cảnh báo đã vá (xem §9). Ba điểm lệch DB-15 có chủ đích được reviewer xác nhận ĐÚNG. Dừng ở 1 vòng + vá (`red-zone-wo-cost-profile` · `plan-review-rounds-inject-new-holes`).

---

## 0. Hiện trạng ĐO THẬT (29/08/2026, không lấy từ tài liệu)

| Thứ | Giá trị đo được | Nguồn |
| --- | --- | --- |
| Head migration | **idx 215 · `0548_s10cleanworkflowcluster2_drop_workflow_approval_cluster` · when `1717587337000`** | `migrations/meta/_journal.json` |
| ⇒ WO này | **`0549`** (idx 216, when 1717587338000) · **`0550`** (idx 217, when …339000) · **`0551`** (idx 218, when …340000) — đúng bước A/B/C của DB-15 §9 | — |
| `modules.ASSET` | **ĐÃ TỒN TẠI** từ `0435:297` — `('ASSET','Tài sản','Extension', is_core=false, is_mvp=false, is_active=FALSE, sort_order=10)`; pin `migration-smoke.int-spec.ts:90-94` **`EXTENSION_INACTIVE_MODULES` gồm `ASSET`** (pin chỉ đọc `is_active`, không đọc `module_group`) | `0435` · `migration-smoke.int-spec.ts` |
| Role hệ thống có id cố định | `…0001` company-admin · `…0002` project-manager · `…0003` channel-manager · `…0004` script-writer · `…0009` hr-manager (+ guest DO NOTHING) · `…000a` finance-manager · `…0010` manager · `…0011` hr · `…00f0` platform-admin. **Trống: `…0012`** | `grep INSERT INTO roles migrations/` |
| Cột `roles` | `id · company_id · name · description · is_system · deleted_at` (0005) + `requires_two_factor` NOT NULL DEFAULT false (0120). Partial unique `roles_system_name_active_uq (name) WHERE company_id IS NULL AND deleted_at IS NULL` | `0005:11-23` · `0120:83` |
| `permissions` | `(id, action, resource_type, is_sensitive)` — UNIQUE `(action, resource_type)`; app chỉ SELECT | `0005:56-62` |
| CHECK audit | tên chính xác **`audit_logs_object_type_chk`**, dạng `object_type = ANY('{…}'::text[])`; parser **NEO 2 TẦNG** đã có ở `0545` (clone `0528`), fail-closed + NO-LOSS/NO-GAIN | `0545:44-95` |
| CHECK NOTI hiện hành | `chk_notification_events_module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT')` · `chk_notification_events_type IN (System,Account,HR,Attendance,Leave,Task,Project,Approval,Reminder,Warning,Error,Goal,Training,Chat)` · **`notifications` có 2 CHECK cùng tập + nhánh `IS NULL OR`** | `0538:642 · 655 · 683 · 698` |
| Pin NOTI catalog | `NOTI_EVENT_COUNT` **61** · `NOTI_ENABLED_EVENT_COUNT` **47** (literal, `noti-seed-catalog-permissions.int-spec.ts:94-95`) · tổng template global **47** (literal, `s5-noti-fix1-deeplink.int-spec.ts:168`) · mỗi event enabled PHẢI có đúng 1 template `IN_APP/vi-VN/Active/is_default` (`…:145-175`) | test int |
| `ON CONFLICT` NOTI | events: `ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL` · templates: `ON CONFLICT (template_code) WHERE company_id IS NULL AND deleted_at IS NULL` (bare ⇒ 42P10) | `0538:721 · 752` |
| `(company_id, id)` UNIQUE ở bảng đích | `users` **CÓ** (`users_company_id_id_uq`) · `employee_profiles` **CÓ** (`0535` FOREACH danh sách 63 bảng đích) — **verify lại fail-loud trong `0549` trước khi ADD composite FK** | `0535:658` |
| Composite FK → `users` (nullable) | khuôn `0538:315-334`: `FOREIGN KEY (company_id, col) REFERENCES users (company_id, id) ON DELETE SET NULL (col)` — bắt buộc liệt kê cột (SET NULL trần null luôn `company_id`) | `0538` · DB-15 §4.2 |
| Ratchet FK | sàn `FK_SINGLE_COL_PAIRS_FLOOR = 423` · `W4_FK_BLOCKED_FLOOR` · `PROVEN_WITH_CHECK_FLOOR` — **KHÔNG hạ, KHÔNG bump** ở WO này (composite FK không tính là "một cột"; `company_id → companies` không tính vì đích không có `company_id`). Assert (a) đếm **mọi** FK một-cột tenant→tenant kể cả nullable ⇒ 6 bảng mới **không được có FK một cột nào** ngoài `company_id → companies`. ⚠️ Census chỉ liệt kê FK **đang tồn tại** ⇒ cột "quên hẳn FK" không đỏ ở đâu — vì thế §2.3(3) là verify **DƯƠNG đúng-bằng** | `fk-tenant-verdicts.ts` · `fk-tenant-census.ts:128-207` · `xtenant-fk-ratchet.int-spec.ts:82` |
| Verify GRANT cấp cột — khuôn đã ship | `aclexplode(relacl/attacl)` **thay** `information_schema.column_privileges` (view trộn ACL cấp bảng vào cấp cột + lọc `pg_has_role(grantor)` ⇒ tập rỗng khi đổi owner) | `0540:137-139` · `0543:209-215` · `0542:184-190` |
| Lưới RLS | `rls-guards.int-spec.ts:52` liệt kê theo `pg_class` mọi object có `company_id` ⇒ 6 bảng mới **PHẢI** có case ở `rls-registry.ts` (không thì đỏ); `rls-coverage-assert` soi USING+WITH CHECK có GUC | test int |
| Teardown | `cleanupTenants()` (`test/helpers/seed.ts:449`) xoá tường minh từng bảng; asset rows xoá **trước** khối `DELETE FROM users` (`seed.ts:740`) | `seed.ts` |
| Hook band | `guard-migration-band` fail-open với nhánh `wo/*` (lane lạ) — không chặn `0549+` | `.claude/hooks/guard-migration-band.mjs:100` |
| Postgres local | `mediaos-postgres` healthy (Docker); lane `mediaos_assetdb1` đã chain-migrate tới 0548 | `docker ps` · `lane-db-setup.sh` |

---

## 1. Việc KHÔNG làm (scope fence) — các điểm lệch chữ DB-15 có chủ đích (reviewer xác nhận)

- ❌ **Không `db:generate`** — SQL viết tay (mirror `0504` DDL + `0506` seed + `0538` NOTI + `0545` audit); drizzle-kit sẽ DROP schema media đang park. `schema/assets.ts` chỉ PARITY.
- ❌ **Không seed `sequence_counters`** (DB-15 §6.7): counter sinh cùng transaction với loại tài sản ở `S11-ASSET-BE-1`. WO này chỉ verify `sequence_counters` nhận `scope_type='Custom'` + `scope_reference_id` (CHECK `0434`). `done_when` của WO ("sequence_counters cấp mã tài sản") sửa lại cho khớp.
- ❌ **Không bật `modules.ASSET.is_active`** — lệch chữ DB-15 §9B/DB-10 §10.2 nhưng đúng tiền lệ `0538:384-402` (CHAT: bật khi chưa có endpoint = `ui-promises-backend-never-reads`) và pin smoke `EXTENSION_INACTIVE_MODULES` gồm `ASSET`. Chỉ **verify hàng tồn tại fail-loud**; giữ `module_group='Extension'` (đổi group là cosmetic, không thuộc WO nền dữ liệu). Đính chính DB-15 §9B + DB-10 §10.2 trong cùng PR. **Bàn giao máy-đọc-được:** thêm 1 dòng `done_when` vào `S11-ASSET-FE-1`: "bật `modules.ASSET.is_active=true` bằng migration UPDATE tường minh + gỡ `ASSET` khỏi `EXTENSION_INACTIVE_MODULES` (`migration-smoke.int-spec.ts:90-94`) CÙNG commit".
- ❌ **Không dùng parser `0506` bước 4 cho audit CHECK** — DB-15 §9B và SPEC-13 §16 (dòng ~418) đang ghi "clone 0506:152-158"; đó là bản chưa neo tầng-1 (`\{[^}]*\}` trên toàn constraintdef — `audit-check-union-parse-anchor-trap`). Dùng **`0545`** (neo 2 tầng, fail-closed, NO-LOSS/NO-GAIN). **Đính chính CẢ DB-15 §9B và SPEC-13** trong PR (S11-ROOM-DB-1 sẽ đọc câu đó); kiểm DB-16 §9 có câu tương tự thì sửa luôn.
- ❌ **`*_by` trên 4 bảng SỔ: `NO ACTION`, không `SET NULL (col)`** — RI action chạy ở tầng owner, bỏ qua allowlist cột ⇒ `DELETE FROM users` sẽ ghi đè `assigned_by`/`opened_by`/`checked_by` (đúng cột cố ý không grant) — tiền lệ `chat_calls` (`seed.ts:543-545`). `NO ACTION` hợp lệ với census (`coveringSetNullHasColumnList` chỉ soi khi `'n'`), teardown không hỏng vì asset rows xoá trước users. Ngoại lệ tường minh của DB-15 §6.3–6.6 ("SET NULL") — ghi vào DB-15 §4.2. Bảng mutable (`asset_categories`, `assets`) giữ `SET NULL (col)`.
- ❌ Không thêm `asset-manager` vào `DashCanonicalRole` / `NOTI_CANONICAL_ROLES` / pin `auth-seed-canonical-roles` / `NotiRoleSlug`; **không** grant `(read,dashboard)` hay cặp ME cho `asset-manager` (pin EXACT-SET 12 role ở `dash-seed2-manager-hr-grant.int-spec.ts:117-136`). Role này là role **cộng thêm** — user chỉ mang nó không mở được `/me`; ghi 1 dòng vào DB-15 §9B.
- ❌ Không thêm entry `notification-dedupe.const.ts` (catalog `dedupe_strategy='DedupeKey'` thắng `DEFAULT_DEDUPE` — `notification-dedupe.service.ts:52-60`; nhánh `DedupeKey` không dùng `windowSeconds` ⇒ once-ever đúng SPEC-13 §17). `recipient_rule_config` để NULL cho 3 event (bridge resolve bằng code).
- ❌ Không code module NestJS / route / `API_MODULE_TAGS` (BE-1). Không sửa `PERMISSION_CODE_TO_PAIR` FE (FE-1). Không gán role `asset-manager` cho user nào (gán qua màn quản trị role hiện có của AUTH — vận hành, ngoài WO; tới khi có người được gán, `ASSET_MAINTENANCE_DUE` phát 0 thông báo — chấp nhận, ghi ở SPEC-13 §17).
- ❌ Contracts: **chỉ enum** ở `packages/contracts/src/asset.ts`, không DTO (chưa có consumer; tránh drift với API-14).
- ❌ Không dùng parser DO-block `0474`/`0506` cho CHECK NOTI (dạng `IN (…)`) — guard `LIKE` + re-stamp superset tường minh (`0538`).
- ❌ Không `RESTRICT` ở FK nội bộ; không `SET NULL` trần trên FK composite.

---

## 2. Migration `0549` — DDL 6 bảng (bước A DB-15 §9)

Thứ tự trong file: **(0) tiền kiểm** → **(1) bảng cha trước** (`asset_categories` → `assets` → `asset_assignments` · `asset_maintenances` · `asset_inventories` → `asset_inventory_items`) → mỗi bảng: `CREATE TABLE` + CHECK inline → `ENABLE/FORCE RLS` + `DROP/CREATE POLICY tenant_isolation` (literal-GUC nguyên văn `0504`) → `UNIQUE (company_id, id)` ở bảng đích → composite FK → index → GRANT → **(2) VERIFY fail-loud** → `-- Down (manual)`.

### 2.0 Tiền kiểm (DO-block, `RAISE EXCEPTION`)

- `current_setting('server_version_num')::int >= 150000` (cần `SET NULL (col)`).
- UNIQUE `(company_id, id)` trên `users` và `employee_profiles` phải tồn tại (`pg_constraint contype='u'`, `conkey` = đúng 2 cột đó) — thiếu ⇒ THROW kèm câu `ALTER TABLE … ADD CONSTRAINT … UNIQUE (company_id, id)` gợi ý (không tự tạo).
- 6 bảng `asset_*` chưa tồn tại (`to_regclass IS NULL`) — có sẵn ⇒ THROW.
- `set_config('lock_timeout','5s',true)` — mirror `0545`.

### 2.1 DDL — cột đúng DB-15 §6.1–6.6 (không thêm/bớt cột)

| Bảng | Điểm chốt |
| --- | --- |
| `asset_categories` | `code varchar(30)` · `code_prefix varchar(6)` CHECK `~ '^[A-Z0-9]{2,6}$'` · `default_maintenance_interval_days` CHECK `> 0` · `is_active DEFAULT true` · `sort_order DEFAULT 0` · soft-delete. **`uq_asset_categories_company_prefix (company_id, code_prefix)` KHÔNG partial** (prefix không cấp lại — §6.7). `uq_asset_categories_company_code_active` partial `deleted_at IS NULL`. Index `idx_asset_categories_company_active (company_id, is_active, sort_order) WHERE deleted_at IS NULL`. 3 FK `created_by/updated_by/deleted_by` → `users` composite **SET NULL (col)**. `UNIQUE (company_id,id)`. |
| `assets` | `category_id NOT NULL` composite → `asset_categories NO ACTION` · `asset_code varchar(50)` · `serial_number varchar(120)` · `purchase_price numeric(18,2)` CHECK `≥0` · `warranty_end_date` CHECK `IS NULL OR purchase_date IS NULL OR ≥ purchase_date` · `status varchar(30) DEFAULT 'In Stock'` CHECK 5 giá trị · `status_changed_by` + `created_by/updated_by/deleted_by` → `users` composite **SET NULL (col)** · unique partial `uq_assets_company_code_active (company_id, asset_code) WHERE deleted_at IS NULL` · `uq_assets_company_serial_active (company_id, serial_number) WHERE deleted_at IS NULL AND serial_number IS NOT NULL` · index `idx_assets_company_status_category (company_id, status, category_id) WHERE deleted_at IS NULL` · `idx_assets_company_maintenance_due (company_id, next_maintenance_due) WHERE deleted_at IS NULL AND next_maintenance_due IS NOT NULL AND status NOT IN ('Disposed','Lost')`. `UNIQUE (company_id,id)`. **KHÔNG cột `holder_employee_id`** (§4.5). |
| `asset_assignments` (sổ) | `asset_id`/`employee_id` NOT NULL composite → `assets`/`employee_profiles` NO ACTION · `assigned_at DEFAULT now()` · `issue_condition` CHECK `IS NULL OR IN ('Good','Damaged')` · `return_condition` CHECK `IS NULL OR IN ('Good','Damaged','Lost')` · `status varchar(20) DEFAULT 'Active'` CHECK `('Active','Returned')` · **`chk_asset_assignments_return_pair`** nguyên văn §6.3 · `acknowledged_at` (v1 luôn NULL) · `assigned_by`/`returned_by`/`updated_by` → `users` composite **NO ACTION** (§1) · **`uq_asset_assignments_active (company_id, asset_id) WHERE status = 'Active'`** · index `idx_asset_assignments_asset_time (company_id, asset_id, assigned_at DESC)` · `idx_asset_assignments_employee_active (company_id, employee_id) WHERE status = 'Active'` · `idx_asset_assignments_employee_time (company_id, employee_id, assigned_at DESC)`. KHÔNG `deleted_at`. |
| `asset_maintenances` (sổ) | `reason text NOT NULL` · `status DEFAULT 'Open'` CHECK `('Open','Closed')` · `cost` CHECK `≥0` · **`chk_asset_maintenances_close_pair`** · `uq_asset_maintenances_open (company_id, asset_id) WHERE status = 'Open'` · `idx_asset_maintenances_asset_time (company_id, asset_id, opened_at DESC)` · `opened_by`/`closed_by`/`updated_by` composite **NO ACTION**. KHÔNG `deleted_at`. |
| `asset_inventories` (sổ) | `category_id` NULLABLE composite → `asset_categories` NO ACTION (NULL = toàn bộ; MATCH SIMPLE bỏ qua NULL — đúng ý) · `status DEFAULT 'Open'` · **`chk_asset_inventories_close_pair`** nguyên văn §6.5 · `uq_asset_inventories_open (company_id) WHERE status = 'Open'` · `idx_asset_inventories_company_time (company_id, opened_at DESC)` · `UNIQUE (company_id,id)` · `opened_by`/`closed_by`/`updated_by` composite **NO ACTION**. KHÔNG `deleted_at`. |
| `asset_inventory_items` (sổ) | `inventory_id`/`asset_id` NOT NULL composite NO ACTION · `expected_status varchar(30) NOT NULL` CHECK **3 giá trị** `('In Stock','Assigned','Under Maintenance')` · `expected_holder_employee_id` NULLABLE composite → `employee_profiles` **NO ACTION** (§6.6) · `result varchar(20) DEFAULT 'Not Checked'` CHECK 3 giá trị · **`chk_asset_inventory_items_check_pair`** · `checked_by`/`updated_by` composite **NO ACTION** · `uq_asset_inventory_items_inventory_asset (company_id, inventory_id, asset_id)` · `idx_asset_inventory_items_inventory_result (company_id, inventory_id, result)`. KHÔNG `deleted_at`. |

Tên constraint composite: `<bảng>_<cột>_tenant_fk` theo DB-15 §6 (census so theo **cột**, không theo tên; `suggestedFix()` sinh `_company_fk` chỉ là gợi ý — KHÔNG đổi tên vì int-spec neo `err.constraint`). `company_id` cả 6 bảng: `NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid REFERENCES companies(id) ON DELETE CASCADE`.

**Danh sách 26 composite FK (verify đúng-bằng ở §2.3(3)):** `asset_categories` 3 (`created_by · updated_by · deleted_by` → users, n) · `assets` 5 (`category_id` → asset_categories a · `status_changed_by · created_by · updated_by · deleted_by` → users n) · `asset_assignments` 5 (`asset_id` → assets a · `employee_id` → employee_profiles a · `assigned_by · returned_by · updated_by` → users a) · `asset_maintenances` 4 (`asset_id` a · `opened_by · closed_by · updated_by` a) · `asset_inventories` 4 (`category_id` a · `opened_by · closed_by · updated_by` a) · `asset_inventory_items` 5 (`inventory_id` a · `asset_id` a · `expected_holder_employee_id` a · `checked_by · updated_by` a).

### 2.2 GRANT (bất biến #2 — ép ở DB, không ở service)

| Bảng | `mediaos_app` | `mediaos_worker` |
| --- | --- | --- |
| `asset_categories` · `assets` | `SELECT, INSERT, UPDATE` (soft delete = UPDATE) — **không DELETE** | `SELECT` |
| `asset_assignments` | `SELECT, INSERT` + `UPDATE (status, returned_at, returned_by, return_condition, return_note, updated_at, updated_by)` — **không `acknowledged_at`**, không DELETE | `SELECT` |
| `asset_maintenances` | `SELECT, INSERT` + `UPDATE (status, closed_at, closed_by, result_note, cost, next_due_date, updated_at, updated_by)` | `SELECT` |
| `asset_inventories` | `SELECT, INSERT` + `UPDATE (status, closed_at, closed_by, note, total_items, found_count, missing_count, not_checked_count, updated_at, updated_by)` | `SELECT` |
| `asset_inventory_items` | `SELECT, INSERT` + `UPDATE (result, checked_at, checked_by, note, updated_at, updated_by)` | `SELECT` |

**Tuyệt đối không** phát `GRANT UPDATE ON <sổ>` cấp bảng rồi grant cột (`revoke-table-grant-wipes-column-grants`). `assets.next_maintenance_due` do service ghi khi đóng bảo trì — nằm trong `GRANT UPDATE ON assets` cấp bảng. Mở đợt kiểm kê = `INSERT … SELECT` vào `asset_inventory_items` (chỉ cần INSERT). Worker `SELECT` đủ cho job nhắc bảo trì (đọc + enqueue outbox).

### 2.3 VERIFY fail-loud cuối `0549` (một DO-block, `RAISE EXCEPTION`, mọi assert có vế DƯƠNG đúng-bằng)

1. **RLS:** 6 bảng `relrowsecurity AND relforcerowsecurity`; policy `tenant_isolation` có `polqual` **và** `polwithcheck` chứa `app.current_company_id`.
2. **GRANT bằng `aclexplode` (khuôn `0540`):** (a) `aclexplode(c.relacl)` cho `mediaos_app`: `asset_categories`/`assets` = đúng tập `{SELECT,INSERT,UPDATE}`; 4 sổ = đúng tập `{SELECT,INSERT}` (0 UPDATE/DELETE cấp bảng); (b) `aclexplode(a.attacl)` (`pg_attribute` neo `nspname='public'`) cho `mediaos_app` privilege `UPDATE`: `array_agg(attname ORDER BY attname COLLATE "C")` **`IS DISTINCT FROM`** allowlist §2.2 ⇒ THROW (thiếu hoặc thừa); 2 bảng mutable: 0 column-ACL; (c) `mediaos_worker`: đúng tập `{SELECT}` trên cả 6, 0 column-ACL.
3. **Composite FK DƯƠNG đúng-bằng:** đọc `pg_constraint` (`contype='f'`, `array_length(conkey,1)=2`, cột = `{company_id, <col>}`, `confkey` = `(company_id,id)` của bảng đích, `confdeltype` ∈ `{'a','n'}`, khi `'n'` thì `confdelsetcols` khác rỗng và = `{<col>}`) ⇒ tập `(bảng, cột, đích, deltype)` **= đúng 26 dòng** §2.1; thiếu/thừa ⇒ THROW. Kèm: 0 FK một-cột từ 6 bảng tới bảng ≠ `companies`.
4. **UNIQUE `(company_id,id)`** tồn tại trên `asset_categories`, `assets`, `asset_inventories` (hậu kiểm, không chỉ tiền kiểm users/employee_profiles).
5. **Index bằng `pg_get_expr(indpred, indrelid)` đúng chuỗi:** `uq_asset_assignments_active` = `(status)::text = 'Active'::text` · `uq_asset_maintenances_open` / `uq_asset_inventories_open` = `'Open'` · `uq_assets_company_code_active` = `deleted_at IS NULL` · `uq_assets_company_serial_active` = `(deleted_at IS NULL) AND (serial_number IS NOT NULL)` · `uq_asset_categories_company_code_active` = `deleted_at IS NULL`; **`uq_asset_categories_company_prefix` `indpred IS NULL`** và `indisunique`; 8 index thường tồn tại theo tên (`pg_indexes`). Chuỗi kỳ vọng chép từ `pg_get_expr` thật trên lane (ghi vào comment migration).

### 2.4 Cùng commit với `0549`

- `apps/api/src/db/schema/assets.ts` (parity Drizzle, mẫu `goals.ts`) + `schema/index.ts` khối additive `export * from "./assets"`.
- `apps/api/test/helpers/seed.ts` `cleanupTenants()`: 6 dòng theo thứ tự `asset_inventory_items → asset_inventories → asset_maintenances → asset_assignments → assets → asset_categories`, đặt **ngay trước** khối `DELETE FROM chat_call_participants` (trước `users`/`employee_profiles`).
- `apps/api/test/integration/rls-registry.ts`: 6 case (FK chain qua `direct`). `asset_inventories` seed hàng **`Closed`** (kèm `closed_at` + 4 số thoả `close_pair`) để không đụng `uq_asset_inventories_open` khi harness gọi `seedRow` 2 lần/tenant. Không `skipNoContext`.

---

## 3. Migration `0550` — seed role · 11 cặp · 28 grant · audit CHECK (bước B)

1. **Tiền kiểm module**: `count(*) FROM modules WHERE module_code='ASSET' AND deleted_at IS NULL` = 1 ⇒ else THROW; `RAISE NOTICE` giữ `is_active=false` (mirror `0538:392-400`). Không INSERT/UPDATE.
2. **Role `asset-manager`**: `INSERT INTO roles (id, company_id, name, description, is_system, requires_two_factor) VALUES ('00000000-0000-0000-0000-000000000012', NULL, 'asset-manager', 'Asset Manager: quản lý tài sản toàn công ty (SPEC-01 §10.8)', true, false) ON CONFLICT DO NOTHING` (bare DO NOTHING hợp lệ với partial unique — `0019`).
3. **11 cặp** `INSERT INTO permissions (action, resource_type, is_sensitive) … ON CONFLICT (action, resource_type) DO NOTHING`, `is_sensitive=false` cả 11.
4. **Grant per-(role, pair)** — clone khối DO `0506` bước (3) (resolve role theo `name + company_id IS NULL + deleted_at IS NULL`, THROW nếu thiếu; per-pair `DELETE … data_scope <> g[4]` rồi `INSERT … ON CONFLICT (role_id, permission_id, effect) DO NOTHING`). **28 hàng**: `employee` access@Own · view@Own; `manager` access@Own · view@Department; `hr` access@Own · view@Company; `company-admin` access@Own + 10 cặp @Company; `asset-manager` access@Own + 10 cặp @Company.
5. **UNION-ADD audit** 5 giá trị `'asset' · 'asset_category' · 'asset_assignment' · 'asset_maintenance' · 'asset_inventory'` — **clone nguyên khối `0545`** (§1). `AUDIT_OBJECT_TYPES` thêm 5 giá trị cùng commit. Không `asset_inventory_item`.
6. **VERIFY fail-loud** (mọi câu đếm role **neo `r.company_id IS NULL AND r.deleted_at IS NULL`** — `0506:215-216`, tránh role tenant trùng tên thổi số):
   (a) đúng 11 cặp, cả 11 `is_sensitive=false`;
   (b1) tổng grant ALLOW của 5 role trên 11 cặp = **28**;
   (b2) `employee`/`manager`/`hr` **0** cặp ngoài access/view;
   (b3) `employee` view=Own · `manager` view=Department · `hr` view=Company · cả 5 role access=Own;
   (b4) `asset-manager` đúng 11 hàng: access=Own, 10 còn lại=Company;
   (b5) **`company-admin` đúng 11 hàng: access=Own, 10 còn lại=Company**;
   (c) role `asset-manager`: đúng 1 hàng `company_id IS NULL AND deleted_at IS NULL`, **`id = …0012`, `is_system=true`, `requires_two_factor=false`** (ON CONFLICT DO NOTHING không sửa hàng sẵn có sai thuộc tính);
   (d) CHECK audit chứa cả 5 giá trị (regex biên `~ '[,{'']<v>['',}]'` từng giá trị — `0506:265`) **và** NO-LOSS đã assert trong khối 0545-clone;
   (e) module ASSET tồn tại, `is_active=false`;
   (f) `super-admin` KHÔNG có hàng trong `roles WHERE company_id IS NULL`.
7. `-- Down (manual)`: xoá 28 grant + 11 cặp + role `…0012`; audit CHECK **không có down** (append-only #2).

---

## 4. Migration `0551` — NOTI 3 event + template + nới CHECK (bước C)

1. **Baseline guard** (mirror `0538:611-627`): 4 CHECK phải đang chứa `'CHAT'`/`'Chat'` — thiếu ⇒ THROW.
2. **Nới CHECK trên CẢ HAI bảng**, guard `LIKE '%''ASSET''%'` / `'%''Asset''%'` rồi DROP + ADD re-stamp superset tường minh: `notification_events` (`module_code += 'ASSET'`, `notification_type += 'Asset'`); `notifications` (cùng hai, **giữ `IS NULL OR`**).
3. **3 event** (`company_id NULL`, `module_code='ASSET'`, `notification_type='Asset'`, `default_channels '["IN_APP"]'`, `is_enabled=true`, `is_system_event=false`, **`dedupe_strategy='DedupeKey'`, `dedupe_window_seconds=NULL`**, `recipient_rule_config` NULL): `ASSET_ASSIGNED` 'Tài sản được cấp phát' Normal · `ASSET_REVOKED` 'Tài sản bị thu hồi' Normal · `ASSET_MAINTENANCE_DUE` 'Tài sản sắp đến hạn bảo trì' **High**. `ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING`.
4. **3 template** GLOBAL `IN_APP/vi-VN/Active/is_default` (`template_code = <EVENT>__IN_APP__vi-VN`), payload chỉ mã + tên tài sản + tên người + link nội bộ (SPEC-13 §17), **cả 3 có `variables_schema`**:
   - `ASSET_ASSIGNED`: title `Bạn được cấp tài sản {asset_code}` · body `{actor_name} đã cấp phát {asset_name} ({asset_code}) cho bạn.` · short `Được cấp {asset_code}` · url `/me/assets` · vars `{"actor_name":"string","asset_name":"string","asset_code":"string"}`
   - `ASSET_REVOKED`: title `Tài sản {asset_code} đã được thu hồi` · body `{actor_name} đã thu hồi {asset_name} ({asset_code}).` · short `Thu hồi {asset_code}` · url `/me/assets` · vars như trên
   - `ASSET_MAINTENANCE_DUE`: title `{asset_code} sắp đến hạn bảo trì` · body `{asset_name} ({asset_code}) đến hạn bảo trì ngày {due_date}.` · short `Bảo trì {asset_code} ngày {due_date}` · url `/assets/{asset_id}` · vars `{"asset_name":"string","asset_code":"string","due_date":"string","asset_id":"uuid"}`
   `ON CONFLICT (template_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING`.
5. **VERIFY fail-loud** bằng catalog (migrator 1 tx — không "thử INSERT"): 4 constraint đích danh chứa `'ASSET'`/`'Asset'`; 3 event global `is_enabled` + `dedupe_strategy='DedupeKey'`; 3 template có `target_url_template NOT NULL` + `variables_schema NOT NULL`.
6. **Cùng commit**: `notification-event-catalog.const.ts` — `NotiModuleCode` += `"ASSET"`, `NotiType` += `"Asset"`, 3 entry, comment count **64 / 50**; `packages/contracts/src/notification.ts` `notificationTypeEnumSchema` += `"Asset"`; `schema/noti.ts` parity 2 CHECK; **bump pin**: `noti-seed-catalog-permissions.int-spec.ts:94-95` → `64`/`50`, `s5-noti-fix1-deeplink.int-spec.ts:168` → `50` (+ chuỗi `+ 0551 (3 ASSET)`).
7. `-- Down (manual)`: xoá 3 template + 3 event; CHECK NOTI không thu hẹp.

---

## 5. Hợp đồng Zod — `packages/contracts/src/asset.ts` (DB-15 §7, mirror CHECK HAI CHIỀU, ĐÚNG BẰNG)

Chỉ **enum + type**: `assetLifecycleStatusSchema` (5 — tên `assetStatusSchema` đã bị `media.ts` (park) chiếm ở barrel) · `assetAssignmentStatusSchema` (2) · `assetIssueConditionSchema` (2) · `assetReturnConditionSchema` (3) · `assetMaintenanceStatusSchema` (2) · `assetInventoryStatusSchema` (2) · `assetInventoryItemResultSchema` (3) · `assetInventoryExpectedStatusSchema` (**3**, tập con) · `assetDisposeKindSchema` (`Disposed`/`Lost`) · `ASSET_CODE_PREFIX_RE = /^[A-Z0-9]{2,6}$/`. Barrel `index.ts`: `export * from "./asset"`. Unit spec `asset.spec.ts`: mỗi enum `.options` **bằng đúng** mảng literal chép từ migration (pin hai chiều, literal cố ý).

---

## 6. Test-first (RED trước khi viết migration) — `apps/api/test/integration/s11-asset-db1-invariants.int-spec.ts`

Gate `hasDb` (không gate `LANE_DB` — chạy thật trên CI, mirror `s7-chat-db1-invariants`). Mọi ca ÂM assert `err.code` + `err.constraint` **đích danh** + có ĐỐI CHỨNG DƯƠNG cùng constraint.

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| A1 | app role `DELETE` trên 4 sổ | `42501` ×4; đối chứng: `INSERT` vào sổ thành công |
| A2 | app role `UPDATE` cột ngoài allowlist (`asset_assignments.asset_id`, `.acknowledged_at`; `asset_maintenances.reason`; `asset_inventories.name`; `asset_inventory_items.expected_status`) | `42501`; đối chứng: UPDATE cột trong allowlist OK |
| A3 | app role `DELETE` trên `asset_categories`/`assets` | `42501`; soft-delete qua UPDATE `deleted_at` OK |
| A4 | `mediaos_worker` INSERT/UPDATE/DELETE trên 6 bảng | `42501`; đối chứng SELECT OK |
| B1 | tenant A INSERT `asset_assignments` với `employee_id` của B | `23503` `asset_assignments_employee_tenant_fk`; đối chứng cùng tenant OK |
| B2 | tenant A INSERT `assets` với `category_id` của B | `23503` `assets_category_tenant_fk` |
| B3 | tenant A `assigned_by` = user của B | `23503` `asset_assignments_assigned_by_tenant_fk` |
| B4 | tenant A INSERT `asset_inventory_items` với `asset_id` của B / `expected_holder_employee_id` của B | `23503` đúng tên FK |
| C1 | 2 lượt `Active` cùng asset | `23505` `uq_asset_assignments_active`; **dương**: UPDATE lượt 1 → Returned (1 câu đủ 3 cột) rồi lượt 2 OK |
| C2 | 2 lượt bảo trì `Open` cùng asset · 2 đợt kiểm kê `Open` cùng company | `23505` đúng tên; **dương**: đóng bằng 1 câu UPDATE đủ cột theo `close_pair` rồi mở lượt/đợt thứ hai OK |
| C3 | prefix cấp lại sau soft-delete loại | `23505` `uq_asset_categories_company_prefix`; đối chứng `code` cấp lại sau soft-delete OK (partial) |
| C4 | trùng `asset_code` live ⇒ `23505 uq_assets_company_code_active`; trùng `serial_number` live ⇒ `23505 uq_assets_company_serial_active`; **hai asset `serial_number NULL` ⇒ OK**; soft-delete rồi tạo lại cùng `asset_code` ⇒ OK | đúng |
| D1 | `Returned` thiếu `returned_at` / `Active` có `return_condition` | `23514` `chk_asset_assignments_return_pair` |
| D2 | `Closed` đợt mà `total ≠ found+missing+not_checked` / thiếu 1 số ⇒ `23514 chk_asset_inventories_close_pair`; **dương**: đóng với 4 số đúng ⇒ OK | đúng |
| D3 | `expected_status='Disposed'` · `code_prefix='ab'` · `purchase_price=-1` · `warranty < purchase` · `result='Found'` mà `checked_at NULL` ⇒ `23514` đúng tên; **biên: `warranty_end_date = purchase_date` ⇒ OK** | đúng |
| E1 | không GUC ⇒ `SELECT` 1 bảng = 0 hàng (smoke pin registry có mặt; lưới đầy đủ ở `tenant-isolation`) | 0 |
| F1 | 28 grant đúng ma trận §9d (đọc `role_permissions` JOIN, neo `company_id IS NULL`) · `employee` KHÔNG có `assign:asset` · `company-admin` 10 cặp Company · `asset-manager` `is_system`, `requires_two_factor=false`, không nằm trong `DashCanonicalRole`/`NotiRoleSlug` (assert `not.toContain`) | đúng |
| F2 | CHECK audit chứa 5 giá trị **và** canary chắc chắn còn `'employee'`, `'user'` (NO-LOSS) | true |
| G1 | INSERT `notifications` với `module_code='ASSET', notification_type='Asset'` dưới app role (rollback) ⇒ OK; đối chứng `module_code='XXX'` ⇒ `23514 chk_notifications_module_code`, `notification_type='Xxx'` ⇒ `23514 chk_notifications_notification_type` | đúng |
| G2 | 3 event global `dedupe_strategy='DedupeKey'`; 3 template có `target_url_template` + `variables_schema` | đúng |
| H1 | **Idempotency (bằng chứng DUY NHẤT — `db:migrate` lần 2 không thực thi gì vì migrator bỏ qua migration đã áp):** chạy lại khối seed `0550`/`0551` (copy câu INSERT + DO) ⇒ count `permissions`/`role_permissions`/`notification_events`/`notification_templates`/`roles` **không đổi**, không exception | đúng |

Thêm 6 case `rls-registry.ts` (lưới `tenant-isolation` + `rls-guards` tự phủ RLS; **W4 của tenant-isolation KHÔNG sinh ca cho ASSET** vì chỉ lấy FK một-cột — không ghi "W4 phủ ASSET" vào done_when). `rls-tenant-isolation-tester` agent chạy sau khi xanh.

---

## 7. Thứ tự thi công & lệnh verify

1. RED: viết int-spec §6 + `asset.spec.ts` + 6 case registry + `cleanupTenants` → chạy trên lane `mediaos_assetdb1` ⇒ đỏ vì thiếu bảng.
2. `0549` → journal idx 216 → `pnpm --filter @mediaos/api db:migrate` (lane) ⇒ A–E xanh.
3. `0550` (idx 217) ⇒ F xanh · `0551` (idx 218) ⇒ G xanh + pin NOTI bump.
4. Code parity: `schema/assets.ts` · `index.ts` · `audit.ts` · `noti.ts` · catalog const · contracts (`asset.ts` + `notification.ts` + `index.ts`).
5. Docs: `docs/erd-current.md` (A4 → A1: 6 bảng đã build; §9 danh sách sổ không DELETE/UPDATE cấp cột thêm 4 bảng); đính chính **DB-15** (§4.2 `*_by` sổ = NO ACTION · §9A `aclexplode` · §9B `is_active` giữ false + clone `0545` + role cộng thêm) · **DB-10 §10.2** · **SPEC-13 §16** ("clone 0506") · kiểm **DB-16 §9** câu tương tự.
6. `harness/backlog.mjs`: `paths` WO += `harness/backlog.mjs` · `docs/SPEC/SPEC-13*.md` · `docs/plans/S11-ASSET-DB-1.md`; sửa `done_when` (counter không seed; W4); `S11-ASSET-FE-1` += done_when bật `is_active` + gỡ pin smoke cùng commit; `S11-ASSET-BE-1` += done_when "INSERT…SELECT mở đợt lọc `Disposed`/`Lost` — 23514 `chk_asset_inventory_items_expected` phải map ra mã ASSET-ERR, không 500".
7. Verify: `export LANE_DB=mediaos_assetdb1` → chạy đích danh: `s11-asset-db1-invariants` · `tenant-isolation` · `rls-guards` · `rls-coverage-assert` · `xtenant-fk-ratchet` · `catalog-fk-tenant-guard` · `noti-seed-catalog-permissions` · `s5-noti-fix1-deeplink` · `migration-smoke` · `auth-seed-canonical-roles` · `role-system-immutable` · `dash-seed2-manager-hr-grant` · `goal-db-seed` · `s7-chat-db1-invariants` → rồi `bash harness/check.sh --all` với `LANE_DB`.
8. FULL gate: `security-reviewer` + `database-reviewer` + `silent-failure-hunter` trên diff; `rls-tenant-isolation-tester` trên lane. Vá CRITICAL/HIGH. PR → người chốt.

---

## 8. Rủi ro còn lại & cách chặn

| Rủi ro | Chặn |
| --- | --- |
| `SET NULL (col)` cần PG ≥ 15 | Tiền kiểm `server_version_num >= 150000`. |
| Migrator 1 tx: verify "thử INSERT" không rollback được | Chỉ verify bằng catalog; hành vi thật đo ở int-spec §6. |
| `SELECT INTO` nhiều hàng lấy hàng tuỳ ý | Mọi resolve constraint đếm `count(*) = 1` trước. |
| Quên hẳn FK ⇒ census/ratchet im lặng | §2.3(3) verify DƯƠNG đúng-bằng 26 dòng. |
| Pin smoke `ASSET` inactive vs DB-15 §9B | §1: giữ false, đính chính doc, bàn giao máy-đọc-được ở FE-1. |
| `asset-manager` lọt enumerate canonical / grant dashboard | F1 + grep `'asset-manager'` trong `src/` = 0 chỗ ngoài migration/doc; không grant `(read,dashboard)`. |
| Journal `when` đơn điệu | 1717587338000 / …339000 / …340000. |
| `cleanupTenants` thiếu ⇒ đỏ hàng loạt | §2.4 cùng commit; `tenant-isolation` afterAll gọi cleanup. |

---

## 9. Nhật ký plan-review (vòng 1 → Rev 2)

| # | BLOCKING | Vá ở |
| --- | --- | --- |
| 1 | verify "0 FK một cột" xanh-rỗng khi quên hẳn FK | §2.3(3) verify DƯƠNG đúng-bằng 26 composite FK |
| 2 | `information_schema.column_privileges` sai tầng | §2.3(2) `aclexplode(relacl/attacl)`; đính chính DB-15 §9A |
| 3 | `ILIKE '%WHERE%'` không chứng minh predicate; 2 partial unique `assets` không có ca hành vi | §2.3(5) `pg_get_expr(indpred)` đúng chuỗi; §6 C4 |
| 4 | C2/D2/D3 thiếu đối chứng dương / ca biên | §6 C2, D2, D3 |
| 5 | không kiểm scope `company-admin`; câu đếm chưa neo `company_id IS NULL` | §3.6 (b5) + neo mọi câu |
| 6 | "clone 0506" còn ở DB-15 §9B + SPEC-13; `docs/SPEC/**` ngoài `paths` | §1, §7.5, §7.6 |

Cảnh báo đã nhận: `db:migrate` lần 2 là phép đo rỗng (H1 là bằng chứng) · tên FK `_tenant_fk` giữ theo DB-15 (không phải "khớp suggestedFix") · `*_by` sổ = NO ACTION · verify role đủ 3 thuộc tính · A4 worker · canary `'employee'`/`'user'` · `ASSET_REVOKED` có `variables_schema` · registry `asset_inventories` seed Closed · không ghi W4 vào done_when · Down blocks · `paths`/`done_when` backlog · bàn giao `is_active` máy-đọc-được · role cộng thêm ghi DB-15 · 8 index thường + 3 UNIQUE hậu kiểm · floors không đổi · lý do `module_group` sửa lại.

---

## 10. Kết quả thi công (29/08/2026)

| Mục | Kết quả |
| --- | --- |
| Migration | `0549` (DDL 6 bảng, 26 composite FK, GRANT cấp cột, verify aclexplode/pg_constraint/pg_get_expr) · `0550` (role `asset-manager` …0012, 11 cặp, 28 grant, audit CHECK clone `0545`) · `0551` (4 CHECK NOTI, 3 event DedupeKey, 3 template) — journal idx 216–218, áp sạch trên lane `mediaos_assetdb1`, verify fail-loud PASS |
| Lỗi bắt được lúc migrate (đều rollback sạch nhờ migrator 1 tx) | (1) `DECLARE r record` **che alias bảng `r`** trong `JOIN roles r` ⇒ `instantiate_empty_record_variable` — đổi biến thành `rw`; (2) `RAISE EXCEPTION` có tham số mà không có `%` ⇒ `check_raise_parameters` (chỉ nổ lúc PL/pgSQL parse khi chạy) |
| Test | `s11-asset-db1-invariants` **21/21** · 14 file cổng foundation (tenant-isolation 1055 · rls-guards · rls-coverage-assert · xtenant-fk-ratchet · catalog-fk-tenant-guard · noti-seed-catalog 173 · s5-noti-fix1-deeplink · migration-smoke 63 · auth-seed-canonical-roles 71 · role-system-immutable · dash-seed2 · goal-db-seed 56 · s7-chat-db1 56 · noti-seed2-be3) **1538 pass / 16 skip có sẵn** · contracts `asset.spec` + `index.spec` 19/19 |
| Contracts | `assetStatusSchema` **đụng barrel** với `media.ts` (park) ⇒ đổi thành `assetLifecycleStatusSchema`/`AssetLifecycleStatusDto` |
| Docs đính chính | DB-15 §4.2 (`*_by` sổ = NO ACTION) · §9A (`aclexplode`, verify FK dương, predicate index) · §9B (`modules.ASSET` giữ inactive; clone `0545`; role cộng thêm) · DB-10 §10.2 · SPEC-13 §16 · DB-16 §9C (clone `0550`/`0545`) · erd-current §9 + A1/A4 |
| Backlog | `paths`/`done_when` DB-1 sửa khớp; `S11-ASSET-FE-1` += bật `is_active` + gỡ pin smoke cùng commit; `S11-ASSET-BE-1` += lọc Disposed/Lost khi mở đợt + counter cùng tx + UPDATE 1 câu |
