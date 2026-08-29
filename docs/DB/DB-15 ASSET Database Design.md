# DB-15: ASSET DATABASE DESIGN — QUẢN LÝ TÀI SẢN

> **Nguồn nghiệp vụ:** [SPEC-13 ASSET](<../SPEC/SPEC-13 ASSET.md>) · Quy ước chung: [DB-01](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) §3.2/§7.10/§19b · HR nền: [DB-03](<DB-03_HR Database Design.md>) (`employees`) · Foundation: [DB-08](<DB-08 Audit Files Settings Seeds Database Design.md>) (`sequence_counters` §8.9, `audit_logs`)
>
> **Liên quan:** [API-14 ASSET API Design](<../API Design/API-14_ASSET_API_Design.md>) · [DB-09 §8.16 index](<DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 seed ASSET](<DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) · [Ma trận phân quyền §9d](<../permission-matrix-spec.md>) · [Chỉ mục tài liệu](<../README.md>)
>
> **Đánh số:** DB-13/DB-14 đã được IMPLEMENTATION-10 §13.2 đặt trước cho PAYROLL/RECRUIT ⇒ ASSET lấy **DB-15**, ROOM lấy **DB-16** (OFFICE-DEC-001, owner ký 28/08/2026).

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DB-15 |
| Tên tài liệu | ASSET Database Design — Quản lý tài sản |
| Module | ASSET (SPEC-13) |
| Phiên bản | v1.0 — **Approved** cùng SPEC-13 (owner duyệt gói wave S11-OFFICE 28/08/2026) |
| Ngày tạo / cập nhật | 28/08/2026 / 28/08/2026 |
| Head migration lúc viết | idx 215 / `0548_s10cleanworkflowcluster2_drop_workflow_approval_cluster` ⇒ migration ASSET dự kiến **`0549+`** |
| Giai đoạn | Phase 3 · wave S11-OFFICE — hậu go-live |

> ⚠️ Số migration dưới đây là **dự kiến**. WO DB phải đọc `apps/api/migrations/meta/_journal.json` **tại thời điểm chạy** để lấy head thật (bẫy `wo-paths-drive-gate-and-scheduler`); lane migration là lane **nối tiếp** duy nhất — `S11-ROOM-DB-1` chỉ chạy sau khi `S11-ASSET-DB-1` merge.

---

## 2. Mục đích tài liệu

Đặc tả tầng dữ liệu cho module ASSET: danh mục loại, hồ sơ tài sản có FSM, ba sổ lịch sử (cấp phát · bảo trì · kiểm kê). Khác CHAT (DB-12 — ALTER bảng có sẵn), ASSET **tạo mới 6 bảng từ số không**: đo ngày 28/08/2026 không có bảng `assets` trần nào trong DB (chỉ `content_assets` của cụm media đã park). Quy tắc nghiệp vụ (mã lỗi, ma trận FSM, data scope) sống ở SPEC-13 — file này chỉ nói về dữ liệu.

---

## 3. Phạm vi thiết kế

### 3.1 Bảng MỚI

| Bảng | Vai trò | Ghi chú |
| --- | --- | --- |
| `asset_categories` | Loại tài sản + prefix mã | soft delete |
| `assets` | Hồ sơ tài sản, FSM 5 trạng thái | soft delete có điều kiện (ASSET-ERR-015) |
| `asset_assignments` | Lượt cấp phát ↔ nhân viên | **sổ**: không DELETE, UPDATE cấp cột |
| `asset_maintenances` | Lượt bảo trì | **sổ**: không DELETE, UPDATE cấp cột |
| `asset_inventories` | Đợt kiểm kê | **sổ**: không DELETE, UPDATE cấp cột |
| `asset_inventory_items` | Kết quả từng tài sản trong đợt (ảnh chụp lúc mở) | **sổ**: không DELETE, UPDATE cấp cột |

### 3.2 Bảng SỬA

_(không có)_ — không ALTER bảng nghiệp vụ nào. Chỉ **UNION-ADD** CHECK trên `audit_logs.object_type` và nới CHECK `module_code`/`notification_type` trên `notification_events` + `notifications` (§9).

### 3.3 Bảng dùng lại (không tạo mới)

`companies` · `users` (`*_by`) · `employees` (thiết kế DB-03 — **code thật là `employee_profiles`**, erd-current Phụ lục A2) · `departments`/`org_units` (data scope Department, đọc qua HR) · `roles`/`permissions`/`role_permissions` · `modules` · `audit_logs` · `sequence_counters` (mã tài sản) · `notification_events`/`notification_templates`/`notifications` · `system_jobs` (job nhắc bảo trì) · `files`/`file_links` (ảnh tài sản — tuỳ chọn, `entity_type='asset'`).

---

## 4. Nguyên tắc thiết kế

1. **RLS + FORCE theo `company_id`** trên cả 6 bảng, policy literal-GUC mẫu `0479`; tạo policy **trước** mọi INSERT (bất biến #1); đăng ký `rls-registry`.
2. **Composite tenant FK** `(company_id, x_id) REFERENCES t (company_id, id)` cho **mọi** FK chéo bảng nghiệp vụ (mẫu `0535`; bảng đích phải có `UNIQUE (company_id, id)` — `employees`/`employee_profiles` đã có từ `0535`). **FK về `users` (`*_by`, nullable) CŨNG composite**: `(company_id, col) REFERENCES users (company_id, id) ON DELETE SET NULL (col)` — khuôn `0538:315-334` (CHAT: "6 cột FK mới, KHÔNG cái nào được để một cột"). Lý do (phát hiện ở review ROOM 29/08/2026, áp ngược cho ASSET): `fk-tenant-census.ts` đếm **mọi** FK một-cột giữa hai bảng có `company_id` (không lọc nullable) ⇒ FK đơn cột mới làm `xtenant-fk-ratchet` assert (a) ĐỎ và lớp T **không được ký waiver**; bản chất là lỗ KI-046 (FK bỏ qua RLS — `assigned_by` trỏ được user tenant khác). Mọi dòng "FK `users.id` SET NULL" trong §6 đọc theo luật này; sàn `FK_SINGLE_COL_PAIRS_FLOOR = 423` **không hạ**.
   - **`company_id` của cả 6 bảng: `REFERENCES companies (id) ON DELETE CASCADE`** (khuôn mọi bảng hiện có, ví dụ `sequences.ts:38`) — teardown test `DELETE FROM companies` phải dọn được.
   - **Composite FK nội bộ: `ON DELETE NO ACTION` (mặc định), TUYỆT ĐỐI KHÔNG `RESTRICT`.** `RESTRICT` kiểm **ngay** khi hàng cha bị xoá; `NO ACTION` kiểm ở **cuối câu lệnh**. Cascade từ `companies` xoá `assets` và `asset_assignments` là hai nhánh anh em thứ tự bất định — với `RESTRICT`, nhánh `assets` chạy trước là nổ FK dù hàng con cũng sắp bị xoá trong cùng câu lệnh ⇒ `cleanupTenants()` chết ⇒ đỏ hàng loạt `afterAll`. Census `0535` (hành vi sao chép từ FK cũ) gần như toàn `CASCADE`/`SET NULL (col)`/`NO ACTION`. Cần `SET NULL` một cột trên FK composite ⇒ dùng dạng `SET NULL (col)` như `0535:682` (`act := CASE WHEN r.on_del = 'SET NULL' THEN format('SET NULL (%I)', r.col) …`).
3. **Sổ không xoá**: 4 bảng lịch sử — app role `GRANT SELECT, INSERT` + `UPDATE` **cấp cột** (chỉ cột "đóng"/"kết quả"); **không** `DELETE` (bất biến #2, cùng họ `chat_messages` column-level).
4. **FSM ép ở service, DB chỉ CHECK tập giá trị** + **partial unique** làm chốt cuối cho "một lượt đang sống" (CHECK không ép được chuyển tiếp).
5. **"Ai đang giữ" là dẫn xuất** từ lượt `Active` — không cột `holder_employee_id` trên `assets` (cột ghi-rồi-bỏ = gỡ, không nối dây).
6. **Hợp đồng Zod mirror CHECK hai chiều, đúng bằng** (`packages/contracts/src/asset.ts`) — không chặt hơn, không lỏng hơn.
7. UUID PK `gen_random_uuid()`, timestamp UTC (`timestamptz`), soft delete `deleted_at` chỉ ở `asset_categories`/`assets` — theo DB-01.

---

## 5. ERD cấp module

```text
asset_categories 1─n assets
assets           1─n asset_assignments   (n─1 employees: employee_id)      partial unique: 1 Active / asset
assets           1─n asset_maintenances                                     partial unique: 1 Open / asset
asset_categories 0..1─n asset_inventories (category_id NULL = toàn bộ)     partial unique: 1 Open / company
asset_inventories 1─n asset_inventory_items n─1 assets                      unique (inventory_id, asset_id)
sequence_counters (scope Custom, scope_reference_id = asset_categories.id)  → sinh assets.asset_code
```

---

## 6. Chi tiết bảng

### 6.1 Bảng `asset_categories`

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id`, RLS |
| `code` | VARCHAR(30) | Có | mã loại, unique theo company (partial) |
| `name` | VARCHAR(255) | Có | |
| `code_prefix` | VARCHAR(6) | Có | `^[A-Z0-9]{2,6}$`; vào mã `TS-<code_prefix>-<seq>`; **khoá** sau mã đầu tiên (service, ASSET-ERR-010); **unique trên MỌI hàng kể cả đã xoá mềm** — prefix không bao giờ cấp lại (§6.7) |
| `description` | TEXT | Không | |
| `default_maintenance_interval_days` | INTEGER | Không | CHECK > 0; gợi ý `next_due_date` |
| `is_active` | BOOLEAN | Có | default true |
| `sort_order` | INTEGER | Có | default 0 |
| `metadata` | JSONB | Không | |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | chuẩn chung, soft delete |

```sql
ALTER TABLE asset_categories ADD CONSTRAINT chk_asset_categories_prefix CHECK (code_prefix ~ '^[A-Z0-9]{2,6}$');
ALTER TABLE asset_categories ADD CONSTRAINT chk_asset_categories_interval CHECK (default_maintenance_interval_days IS NULL OR default_maintenance_interval_days > 0);
CREATE UNIQUE INDEX uq_asset_categories_company_code_active   ON asset_categories (company_id, code)        WHERE deleted_at IS NULL;
-- CỐ Ý KHÔNG partial: prefix đã dùng thì mã TS-<PREFIX>-0001 đã tồn tại trên tài sản (kể cả Disposed) — cấp lại là đụng mã cũ
CREATE UNIQUE INDEX uq_asset_categories_company_prefix ON asset_categories (company_id, code_prefix);
CREATE INDEX idx_asset_categories_company_active ON asset_categories (company_id, is_active, sort_order) WHERE deleted_at IS NULL;
ALTER TABLE asset_categories ADD CONSTRAINT asset_categories_company_id_id_uq UNIQUE (company_id, id);
```

### 6.2 Bảng `assets`

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id`, RLS |
| `category_id` | UUID | Có | composite FK → `asset_categories (company_id, id)` |
| `asset_code` | VARCHAR(50) | Có | qua `sequence_counters` (§6.7); unique theo company; **bất biến** |
| `name` | VARCHAR(255) | Có | |
| `serial_number` | VARCHAR(120) | Không | unique theo company khi NOT NULL (partial) |
| `brand` | VARCHAR(120) | Không | |
| `model` | VARCHAR(120) | Không | |
| `purchase_date` | DATE | Không | ≤ ngày hiện tại — kiểm ở service (ASSET-ERR-014) |
| `purchase_price` | NUMERIC(18,2) | Không | **tài chính** — chỉ trả ở scope **Company**; vắng khoá ở Own **và** Department (SPEC-13 §18); CHECK ≥ 0 |
| `supplier` | VARCHAR(255) | Không | **tài chính** — chỉ trả ở scope Company; vắng khoá ở Own **và** Department |
| `warranty_end_date` | DATE | Không | CHECK ≥ `purchase_date` khi cả hai NOT NULL |
| `location` | VARCHAR(255) | Không | nơi để khi không ai giữ |
| `condition_note` | TEXT | Không | tình trạng hiện tại (ghi khi thu hồi `Damaged`) |
| `status` | VARCHAR(30) | Có | `In Stock` / `Assigned` / `Under Maintenance` / `Disposed` / `Lost`, default `In Stock` (SPEC-01 §17.8) |
| `status_reason` | TEXT | Không | lý do Disposed/Lost/tìm thấy lại (bắt buộc ở service — ASSET-ERR-009) |
| `status_changed_at` | TIMESTAMPTZ | Không | |
| `status_changed_by` | UUID | Không | FK `users.id` SET NULL |
| `next_maintenance_due` | DATE | Không | job nhắc (SPEC-13 §17) |
| `description` | TEXT | Không | |
| `metadata` | JSONB | Không | |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | chuẩn chung, soft delete có điều kiện |

```sql
ALTER TABLE assets ADD CONSTRAINT chk_assets_status CHECK (status IN ('In Stock','Assigned','Under Maintenance','Disposed','Lost'));
ALTER TABLE assets ADD CONSTRAINT chk_assets_price   CHECK (purchase_price IS NULL OR purchase_price >= 0);
ALTER TABLE assets ADD CONSTRAINT chk_assets_warranty CHECK (warranty_end_date IS NULL OR purchase_date IS NULL OR warranty_end_date >= purchase_date);
ALTER TABLE assets ADD CONSTRAINT assets_company_id_id_uq UNIQUE (company_id, id);
ALTER TABLE assets ADD CONSTRAINT assets_category_tenant_fk FOREIGN KEY (company_id, category_id) REFERENCES asset_categories (company_id, id) ON DELETE NO ACTION;

CREATE UNIQUE INDEX uq_assets_company_code_active   ON assets (company_id, asset_code)    WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_assets_company_serial_active ON assets (company_id, serial_number) WHERE deleted_at IS NULL AND serial_number IS NOT NULL;
CREATE INDEX idx_assets_company_status_category ON assets (company_id, status, category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_assets_company_maintenance_due ON assets (company_id, next_maintenance_due) WHERE deleted_at IS NULL AND next_maintenance_due IS NOT NULL AND status NOT IN ('Disposed','Lost');
```

> Tìm theo mã/tên/serial (`q`) ở v1 dùng `ILIKE` trên 3 cột với index trên; quy mô ≤ 10k tài sản không cần trigram/tsvector (chừa `pg_trgm` cho sau nếu đo thấy chậm).

### 6.3 Bảng `asset_assignments` — sổ cấp phát

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | RLS |
| `asset_id` | UUID | Có | composite FK → `assets (company_id, id)` |
| `employee_id` | UUID | Có | composite FK → `employees (company_id, id)` (code: `employee_profiles`) |
| `assigned_at` | TIMESTAMPTZ | Có | default now() |
| `assigned_by` | UUID | Không | FK `users.id` SET NULL (NOT NULL ở service; NULL chỉ khi user bị xoá cứng) |
| `issue_condition` | VARCHAR(20) | Không | `Good` / `Damaged` — tình trạng lúc giao |
| `issue_note` | TEXT | Không | |
| `expected_return_date` | DATE | Không | ≥ ngày giao — kiểm ở service |
| `status` | VARCHAR(20) | Có | `Active` / `Returned`, default `Active` (SPEC-01 §17.9) |
| `returned_at` | TIMESTAMPTZ | Không | |
| `returned_by` | UUID | Không | FK `users.id` SET NULL |
| `return_condition` | VARCHAR(20) | Không | `Good` / `Damaged` / `Lost` |
| `return_note` | TEXT | Không | |
| `acknowledged_at` | TIMESTAMPTZ | Không | **chừa** cấp phát 2 bước (ASSET-DEC-002) — v1 luôn NULL |
| `created_at` `updated_at/by` | | | |

```sql
ALTER TABLE asset_assignments ADD CONSTRAINT chk_asset_assignments_status CHECK (status IN ('Active','Returned'));
ALTER TABLE asset_assignments ADD CONSTRAINT chk_asset_assignments_issue  CHECK (issue_condition IS NULL OR issue_condition IN ('Good','Damaged'));
ALTER TABLE asset_assignments ADD CONSTRAINT chk_asset_assignments_return CHECK (return_condition IS NULL OR return_condition IN ('Good','Damaged','Lost'));
-- Returned ⇒ phải có returned_at + return_condition; Active ⇒ cả hai NULL (mirror hai chiều ở Zod)
ALTER TABLE asset_assignments ADD CONSTRAINT chk_asset_assignments_return_pair CHECK (
  (status = 'Active'   AND returned_at IS NULL     AND return_condition IS NULL) OR
  (status = 'Returned' AND returned_at IS NOT NULL AND return_condition IS NOT NULL)
);
ALTER TABLE asset_assignments ADD CONSTRAINT asset_assignments_asset_tenant_fk    FOREIGN KEY (company_id, asset_id)    REFERENCES assets (company_id, id) ON DELETE NO ACTION;
ALTER TABLE asset_assignments ADD CONSTRAINT asset_assignments_employee_tenant_fk FOREIGN KEY (company_id, employee_id) REFERENCES employee_profiles (company_id, id) ON DELETE NO ACTION;

-- CHỐT CUỐI SPEC-13 §3.2: một tài sản một lượt đang sống
CREATE UNIQUE INDEX uq_asset_assignments_active ON asset_assignments (company_id, asset_id) WHERE status = 'Active';
CREATE INDEX idx_asset_assignments_asset_time      ON asset_assignments (company_id, asset_id, assigned_at DESC);
CREATE INDEX idx_asset_assignments_employee_active ON asset_assignments (company_id, employee_id) WHERE status = 'Active';
CREATE INDEX idx_asset_assignments_employee_time   ON asset_assignments (company_id, employee_id, assigned_at DESC);
```

GRANT app role: `SELECT, INSERT` + `UPDATE (status, returned_at, returned_by, return_condition, return_note, updated_at, updated_by)`. **Không** `DELETE`. ⚠️ `chk_asset_assignments_return_pair` buộc "thu hồi" là **một câu UPDATE** đặt `status` + `returned_at` + `return_condition` cùng lúc — tách hai câu là nổ CHECK giữa chừng. `acknowledged_at` **không** nằm trong grant ở v1 (ASSET-DEC-002: luôn NULL, không có đường ghi — đặc quyền thừa trên bảng sổ; Phase 2 mở cấp phát 2 bước mới grant thêm cột).

### 6.4 Bảng `asset_maintenances` — sổ bảo trì

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | RLS |
| `asset_id` | UUID | Có | composite FK → `assets` |
| `opened_at` | TIMESTAMPTZ | Có | default now() |
| `opened_by` | UUID | Không | FK `users.id` SET NULL |
| `reason` | TEXT | Có | |
| `vendor` | VARCHAR(255) | Không | |
| `status` | VARCHAR(20) | Có | `Open` / `Closed`, default `Open` |
| `closed_at` | TIMESTAMPTZ | Không | |
| `closed_by` | UUID | Không | FK `users.id` SET NULL |
| `result_note` | TEXT | Không | |
| `cost` | NUMERIC(18,2) | Không | **tài chính** — chỉ trả ở scope Company; vắng khoá ở Own **và** Department (SPEC-13 §18); CHECK ≥ 0 |
| `next_due_date` | DATE | Không | ghi sang `assets.next_maintenance_due` khi đóng |
| `created_at` `updated_at/by` | | | |

```sql
ALTER TABLE asset_maintenances ADD CONSTRAINT chk_asset_maintenances_status CHECK (status IN ('Open','Closed'));
ALTER TABLE asset_maintenances ADD CONSTRAINT chk_asset_maintenances_cost   CHECK (cost IS NULL OR cost >= 0);
ALTER TABLE asset_maintenances ADD CONSTRAINT chk_asset_maintenances_close_pair CHECK (
  (status = 'Open'   AND closed_at IS NULL) OR (status = 'Closed' AND closed_at IS NOT NULL)
);
ALTER TABLE asset_maintenances ADD CONSTRAINT asset_maintenances_asset_tenant_fk FOREIGN KEY (company_id, asset_id) REFERENCES assets (company_id, id) ON DELETE NO ACTION;
CREATE UNIQUE INDEX uq_asset_maintenances_open ON asset_maintenances (company_id, asset_id) WHERE status = 'Open';  -- chốt cuối ASSET-ERR-004
CREATE INDEX idx_asset_maintenances_asset_time ON asset_maintenances (company_id, asset_id, opened_at DESC);
```

GRANT app role: `SELECT, INSERT` + `UPDATE (status, closed_at, closed_by, result_note, cost, next_due_date, updated_at, updated_by)`. **Không** `DELETE`.

### 6.5 Bảng `asset_inventories` — đợt kiểm kê

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | RLS |
| `name` | VARCHAR(255) | Có | ví dụ "Kiểm kê Q3/2026" |
| `category_id` | UUID | Không | composite FK → `asset_categories`; NULL = toàn bộ |
| `status` | VARCHAR(20) | Có | `Open` / `Closed`, default `Open` |
| `opened_at` / `opened_by` | TIMESTAMPTZ / UUID | Có / Không | `opened_by` FK `users.id` SET NULL |
| `closed_at` / `closed_by` | TIMESTAMPTZ / UUID | Không | |
| `note` | TEXT | Không | |
| `total_items` `found_count` `missing_count` `not_checked_count` | INTEGER | Không | **cache ghi một lần lúc đóng** (SPEC-13 §13.4); NULL khi còn Open |
| `created_at` `updated_at/by` | | | |

```sql
ALTER TABLE asset_inventories ADD CONSTRAINT chk_asset_inventories_status CHECK (status IN ('Open','Closed'));
ALTER TABLE asset_inventories ADD CONSTRAINT chk_asset_inventories_close_pair CHECK (
  (status = 'Open'   AND closed_at IS NULL     AND total_items IS NULL     AND found_count IS NULL     AND missing_count IS NULL     AND not_checked_count IS NULL) OR
  (status = 'Closed' AND closed_at IS NOT NULL AND total_items IS NOT NULL AND found_count IS NOT NULL AND missing_count IS NOT NULL AND not_checked_count IS NOT NULL
   AND total_items = found_count + missing_count + not_checked_count)
);
ALTER TABLE asset_inventories ADD CONSTRAINT asset_inventories_company_id_id_uq UNIQUE (company_id, id);
ALTER TABLE asset_inventories ADD CONSTRAINT asset_inventories_category_tenant_fk FOREIGN KEY (company_id, category_id) REFERENCES asset_categories (company_id, id) ON DELETE NO ACTION;
CREATE UNIQUE INDEX uq_asset_inventories_open ON asset_inventories (company_id) WHERE status = 'Open';  -- chốt cuối ASSET-ERR-006
CREATE INDEX idx_asset_inventories_company_time ON asset_inventories (company_id, opened_at DESC);
```

GRANT app role: `SELECT, INSERT` + `UPDATE (status, closed_at, closed_by, note, total_items, found_count, missing_count, not_checked_count, updated_at, updated_by)`. **Không** `DELETE`. ⚠️ `chk_asset_inventories_close_pair` buộc "đóng đợt" là **một câu UPDATE** ghi `status` + `closed_at` + 4 số tổng kết cùng lúc (tính bằng `GROUP BY` trong cùng câu/CTE) — tách câu là nổ CHECK giữa chừng.

### 6.6 Bảng `asset_inventory_items` — dòng kiểm kê

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | RLS |
| `inventory_id` | UUID | Có | composite FK → `asset_inventories` |
| `asset_id` | UUID | Có | composite FK → `assets` |
| `expected_status` | VARCHAR(30) | Có | **ảnh chụp** `assets.status` lúc mở đợt |
| `expected_holder_employee_id` | UUID | Không | **ảnh chụp** người giữ lúc mở đợt (composite FK → `employees`, `NO ACTION` — xem ghi chú) |
| `result` | VARCHAR(20) | Có | `Found` / `Missing` / `Not Checked`, default `Not Checked` |
| `checked_at` / `checked_by` | TIMESTAMPTZ / UUID | Không | |
| `note` | TEXT | Không | |
| `created_at` `updated_at/by` | | | |

```sql
ALTER TABLE asset_inventory_items ADD CONSTRAINT chk_asset_inventory_items_result CHECK (result IN ('Found','Missing','Not Checked'));
ALTER TABLE asset_inventory_items ADD CONSTRAINT chk_asset_inventory_items_expected CHECK (expected_status IN ('In Stock','Assigned','Under Maintenance'));
ALTER TABLE asset_inventory_items ADD CONSTRAINT chk_asset_inventory_items_check_pair CHECK (
  (result = 'Not Checked' AND checked_at IS NULL) OR (result <> 'Not Checked' AND checked_at IS NOT NULL)
);
ALTER TABLE asset_inventory_items ADD CONSTRAINT asset_inventory_items_inventory_tenant_fk FOREIGN KEY (company_id, inventory_id) REFERENCES asset_inventories (company_id, id) ON DELETE NO ACTION;
ALTER TABLE asset_inventory_items ADD CONSTRAINT asset_inventory_items_asset_tenant_fk     FOREIGN KEY (company_id, asset_id)     REFERENCES assets (company_id, id) ON DELETE NO ACTION;
ALTER TABLE asset_inventory_items ADD CONSTRAINT asset_inventory_items_holder_tenant_fk    FOREIGN KEY (company_id, expected_holder_employee_id) REFERENCES employee_profiles (company_id, id) ON DELETE NO ACTION;
CREATE UNIQUE INDEX uq_asset_inventory_items_inventory_asset ON asset_inventory_items (company_id, inventory_id, asset_id);
CREATE INDEX idx_asset_inventory_items_inventory_result ON asset_inventory_items (company_id, inventory_id, result);
```

GRANT app role: `SELECT, INSERT` + `UPDATE (result, checked_at, checked_by, note, updated_at, updated_by)`. **Không** `DELETE`.

> ⚠️ **Vì sao FK `expected_holder_employee_id` là `NO ACTION` chứ không `SET NULL` trần:** `ON DELETE SET NULL` trên FK **composite** `(company_id, expected_holder_employee_id)` sẽ SET NULL **cả hai cột** khi hàng cha bị xoá ⇒ `company_id` NOT NULL nổ. Postgres 15+ cho phép `ON DELETE SET NULL (expected_holder_employee_id)` (liệt kê cột — đúng khuôn `0535:682`), nhưng nhân viên là soft delete — thực tế không bao giờ DELETE hàng ngoài teardown test — nên dùng **`NO ACTION`** như mọi FK nội bộ (§4.2; **không** `RESTRICT` vì kiểm ngay sẽ nổ khi cascade từ `companies`). Ghi ở đây để người thi công không chọn `SET NULL` trần.

### 6.7 Counter mã tài sản — dùng `sequence_counters`, KHÔNG bảng mới (ASSET-DEC-004)

| Cột counter | Giá trị |
| --- | --- |
| `company_id` | company của loại |
| `module_code` | `ASSET` |
| `sequence_key` | `asset_code` |
| `scope_type` | `Custom` |
| `scope_reference_id` | `asset_categories.id` |
| `prefix` | `'TS-' \|\| code_prefix \|\| '-'` |
| `padding_length` | 4 |
| `reset_policy` | `Never` |

- Tạo **cùng transaction** với `asset_categories` (service `AssetCategoriesService.create`), unique partial của `sequence_counters` là chốt cuối. Sinh mã qua `SequenceService` (`SELECT … FOR UPDATE`). Thiếu counter ⇒ `SequenceNotFoundError` fail-loud.
- **Không seed** counter ở migration (chưa có loại nào); nếu về sau nhập loại bằng seed/import, seed **phải** kèm counter (bug `QA2-CRIT-002` của `task_code`).
- **Prefix không cấp lại** (`uq_asset_categories_company_prefix` không partial, §6.1): xoá mềm loại rồi tạo loại mới cùng prefix ⇒ **409 ASSET-ERR-010 `prefix-taken`** ở service (bắt unique `23505` từ `cause`, không 500). Counter của loại đã xoá mềm **giữ nguyên** (không xoá, `sequence_counters` không có DELETE); muốn dùng lại prefix ⇒ **khôi phục** loại cũ (`deleted_at = NULL`, `is_active = true`) và tiếp tục đếm — không bao giờ có hai counter cùng prefix trong một company.

---

## 7. Enum chuẩn (đồng bộ `packages/contracts/src/asset.ts` — mirror CHECK HAI CHIỀU, ĐÚNG BẰNG)

| Nhóm | Giá trị | CHECK |
| --- | --- | --- |
| asset status (SPEC-01 §17.8) | `In Stock` · `Assigned` · `Under Maintenance` · `Disposed` · `Lost` | `chk_assets_status` |
| assignment status (SPEC-01 §17.9) | `Active` · `Returned` | `chk_asset_assignments_status` |
| issue_condition | `Good` · `Damaged` | `chk_asset_assignments_issue` |
| return_condition | `Good` · `Damaged` · `Lost` | `chk_asset_assignments_return` |
| maintenance status | `Open` · `Closed` | `chk_asset_maintenances_status` |
| inventory status | `Open` · `Closed` | `chk_asset_inventories_status` |
| inventory item result | `Found` · `Missing` · `Not Checked` | `chk_asset_inventory_items_result` |
| inventory item `expected_status` | `In Stock` · `Assigned` · `Under Maintenance` — **TẬP CON 3 giá trị**, KHÔNG tái dùng enum asset status 5 giá trị (snapshot loại trừ `Disposed`/`Lost` từ nguồn) | `chk_asset_inventory_items_expected` |
| dispose kind (API) | `Disposed` · `Lost` | (chỉ Zod — đích của FSM) |

---

## 8. Index theo use case

| Use case | Index dùng |
| --- | --- |
| Danh sách tài sản lọc trạng thái/loại (`ASSET-API-005`) | `idx_assets_company_status_category` |
| Lọc theo người giữ (`holderEmployeeId`) + màn offboarding | `idx_asset_assignments_employee_active` |
| «Tài sản của tôi» (`/me/assets`, kèm lịch sử) | `idx_asset_assignments_employee_time` |
| Người giữ hiện tại của 1 tài sản / lịch sử cấp phát | `uq_asset_assignments_active` · `idx_asset_assignments_asset_time` |
| Lịch sử bảo trì · lượt Open | `idx_asset_maintenances_asset_time` · `uq_asset_maintenances_open` |
| Job nhắc bảo trì | `idx_assets_company_maintenance_due` |
| Dòng kiểm kê theo `result` | `idx_asset_inventory_items_inventory_result` |
| Tìm theo mã / serial | `uq_assets_company_code_active` · `uq_assets_company_serial_active` |
| Thống kê widget (`/assets/summary`) | `idx_assets_company_status_category` (`GROUP BY status, category_id`) |

> Cô lập tenant ép ở RLS + FORCE; mọi index dẫn đầu bằng `company_id`. Data scope (SPEC-13 §13.6) ép bằng **`EXISTS` cho cả ba scope** (`buildReadScopeExists`), **không JOIN** `asset_assignments` vào truy vấn danh sách — Own bám theo _mọi_ lượt (Active + Returned) của tôi, một người có thể giữ cùng tài sản nhiều lượt ⇒ JOIN nhân bản hàng, hỏng `total`/phân trang (`partial-unique-index-makes-join-duplicate`). Department = `EXISTS` trên lượt Active JOIN `employees` theo đơn vị — đi qua `idx_asset_assignments_employee_active`.

---

## 9. Seed & kế hoạch migration (`0549+` dự kiến, lane DB nối tiếp)

| Bước | Nội dung | Ràng buộc thứ tự |
| --- | --- | --- |
| **A** (`0549`) | Tạo 6 bảng (`company_id … ON DELETE CASCADE`; composite FK nội bộ `NO ACTION`, §4.2) + `UNIQUE (company_id, id)` ở bảng đích + CHECK + index §6 · **ENABLE/FORCE RLS + policy literal-GUC cả 6 bảng** · GRANT: `asset_categories`/`assets` = `SELECT, INSERT, UPDATE` (không DELETE — soft delete); 4 bảng sổ = `SELECT, INSERT` + UPDATE **cấp cột** §6.3–6.6 (**không** phát `GRANT UPDATE ON <table>` rồi mới grant cột; nhớ `REVOKE` cấp bảng về sau **xoá sạch** column-grant — `revoke-table-grant-wipes-column-grants`) · đăng ký `rls-registry` · **VERIFY fail-loud (`RAISE EXCEPTION`, khuôn `0506` bước 6)**: 6 bảng `relrowsecurity AND relforcerowsecurity` + có policy; app role **0 quyền DELETE** trên 4 sổ; tập cột UPDATE của app role trên 4 sổ **đúng bằng** allowlist §6.3–6.6 (so `information_schema.column_privileges`) · **cùng commit**: thêm 6 bảng vào `apps/api/test/helpers/seed.ts` `cleanupTenants()` theo thứ tự con→cha (`asset_inventory_items` → `asset_inventories` → `asset_maintenances` → `asset_assignments` → `assets` → `asset_categories`) | RLS TRƯỚC mọi INSERT (bất biến #1); `fk-tenant-census` không được đỏ; drizzle schema `apps/api/src/db/schema/assets.ts` parity (RLS/grant/partial-index chỉ ở SQL). Thiếu `cleanupTenants` = đỏ hàng loạt `afterAll` (`drop-table-must-clean-test-teardown`) |
| **B** (`0550`) | Seed module `ASSET` (`module_group='Operation'` — giá trị **đã có** của ATT/LEAVE, `is_core=false`, `is_mvp=false`, `is_active=true`, `ON CONFLICT (module_code) WHERE deleted_at IS NULL DO NOTHING`) · seed role hệ thống **`asset-manager`** (`company_id NULL`, `is_system=true`, **`requires_two_factor=false` khai tường minh** — không để mặc định ngầm, `company-admin` là `true` từ `0120`; id cố định mới, `ON CONFLICT DO NOTHING` — tiền lệ `0019` `hr-manager`) · **11 cặp** permission SPEC-13 §11 `is_sensitive=false` `ON CONFLICT (action, resource_type) DO NOTHING` · grant per-(role, pair) theo ma trận **§9d** (resolve role theo `name + company_id IS NULL + deleted_at IS NULL`, DELETE-wrong-scope + INSERT ON CONFLICT, verify fail-loud đếm đúng **28** hàng — mirror `0506`) · **UNION-ADD** 5 giá trị vào CHECK `audit_logs.object_type` — **clone nguyên bước (4) của `0506:152-158`** (`position('ANY' IN upper(v_def))` + `substring(v_def FROM '\{[^}]*\}')::text[]`, rồi verify regex biên `~ '[,{'']asset['',}]'` cho **từng** giá trị như `0506:265`) — KHÔNG tự viết parser mới (`audit-check-union-parse-anchor-trap`) + `AUDIT_OBJECT_TYPES` cùng commit. **Không** có `asset_inventory_item`: đánh dấu dòng audit dưới aggregate `asset_inventory` (`object_id = inventory_id`) | `super-admin` KHÔNG enumerate (nhận qua bootstrap). `asset-manager` **không** vào danh sách canonical (`DashCanonicalRole`/`NOTI_CANONICAL_ROLES`/pin `auth-seed-canonical-roles` giữ 4 role) |
| **C** (`0551`) | Seed NOTI: 3 event `ASSET_ASSIGNED` · `ASSET_REVOKED` · `ASSET_MAINTENANCE_DUE` vào `notification-event-catalog.const.ts` (`module:'ASSET'`, `type:'Asset'`, `isEnabled:true`) + `notification_events` với **`dedupe_strategy = 'DedupeKey'`, `dedupe_window_seconds = NULL`** cho cả 3 (mặc định `0479` là `'None'` ⇒ `computeKey` trả NULL ⇒ partial unique `uq_notifications_dedupe_active` coi mọi NULL là distinct ⇒ tầng dedupe **biến mất**, job nhắc bảo trì nhân đôi mỗi ngày; sửa sau = migration thứ hai — `0538:707`) · INSERT dùng đúng `ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING` (bare ON CONFLICT nổ `42P10` — `0538:721`) · **catalog thắng `DEFAULT_DEDUPE`** ⇒ không thêm entry vào `notification-dedupe.const.ts` · template · **nới CHECK trên CẢ HAI bảng**: `notification_events` (`module_code += 'ASSET'`, `notification_type += 'Asset'`) **VÀ** `notifications` (cùng hai CHECK, **giữ nhánh `IS NULL OR`**) — cách **guard LIKE + re-stamp superset tường minh** của `0507`/`0529`/`0538`, **không** dùng parser DO-block mẫu `0474` cho CHECK dạng `= ANY(ARRAY[…])` | PHẢI xong TRƯỚC khi `S11-ASSET-BE-1` đăng ký registrar outbox (`registerSource()` fail-loud lúc boot). Quên vế `notifications` = lỗi đã ship `0507` |

Giá trị superset hiện hành để re-stamp (đo tại `0538`, xác minh lại lúc chạy):

```text
module_code       : 'AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT'  (+ 'ASSET')
notification_type : … 'Goal','Training','Chat' …                                                 (+ 'Asset')
```

Ma trận grant §9d (bước B) — **28 hàng**: `employee` 2 (`access`@Own, `view`@Own) · `manager` 2 (`access`@Own, `view`@Department) · `hr` 2 (`access`@Own, `view`@Company) · `company-admin` 11 (`access`@Own, 10 cặp còn lại @Company) · `asset-manager` 11 (như company-admin). Sai một hàng verify phải ĐỎ.

Số migration là **dự kiến** — nối tiếp head THẬT tại thời điểm chạy WO.

---

## 10. Đối chiếu bất biến

| Bất biến | Áp dụng trong DB-15 |
| --- | --- |
| #1 `company_id` + RLS FORCE | cả 6 bảng, policy trước INSERT, composite tenant FK mọi FK chéo, `withTenant` ở repo; data scope Own/Department ép ở service |
| #2 append-only / soft delete | 4 bảng sổ **không DELETE**, UPDATE cấp cột (bổ sung danh sách ledger ở erd-current §9); `asset_categories`/`assets` soft delete, `assets` xoá mềm chỉ khi chưa có lịch sử (ASSET-ERR-015) |
| #3 không secret | module không lưu secret; trường tài chính chỉ trả ở scope Company (che ở Own **và** Department, và **luôn** che ở `/me/assets`); payload NOTI/audit không có số tiền |

---

## 11. Rủi ro dữ liệu đã nhận diện

| Rủi ro | Vì sao nguy hiểm | Chốt chặn |
| --- | --- | --- |
| Hai cấp phát song song lọt qua service | hai người "đang giữ" cùng một vật — sổ sai, biên bản sai | `uq_asset_assignments_active`; int-spec 2 request song song; map lỗi unique → 409 (bóc mã PG từ `cause`) |
| Lưu "trạng thái trước bảo trì" thành cột | cột ghi-rồi-bỏ, lệch với lượt cấp phát thật | không có cột; dẫn xuất từ lượt Active (SPEC-13 §13.1) |
| Composite FK `SET NULL` xoá luôn `company_id` | INSERT/UPDATE nổ NOT NULL khi hàng cha bị xoá | §6.6: dùng `NO ACTION` (hoặc `SET NULL (col)` PG15+ theo `0535:682`) |
| Composite FK `RESTRICT` | kiểm ngay ⇒ cascade từ `companies` nổ theo thứ tự anh em bất định ⇒ `cleanupTenants()` chết, đỏ hàng loạt `afterAll` | §4.2: `NO ACTION` mọi FK nội bộ; `company_id` `CASCADE`; 6 bảng vào `cleanupTenants()` cùng commit |
| `dedupe_strategy` để `'None'` | `dedupeKey` thành chuỗi trang trí, job nhắc nhân đôi thông báo mỗi ngày | §9C: `'DedupeKey'` ngay trong seed đầu |
| Loại tài sản tạo lại cùng prefix | counter mới đếm từ 0, đụng mã tài sản `Disposed` cũ ⇒ 500 | §6.1 prefix unique không partial + §6.7 khôi phục loại thay vì tạo mới |
| `code_prefix` đổi sau khi đã sinh mã | mã cũ/mới lệch họ, QR dán rồi không tra được | khoá ở service (ASSET-ERR-010) + counter giữ `prefix` riêng |
| Quên nới CHECK `notifications` | mọi notification ASSET vỡ khi INSERT | bước C làm cả hai bảng trong cùng migration, verify fail-loud |
| Thêm `asset-manager` vào enumerate canonical | pin `auth-seed-canonical-roles` + `DashCanonicalRole` đỏ / grant lạc | §9 bước B ghi rõ **không** canonical |
| Seed loại tài sản sau này không kèm counter | `SequenceNotFoundError` ngay tài sản đầu tiên | §6.7 luật "loại đi cùng counter", int-spec ca thiếu counter |
| Đóng đợt kiểm kê tự chuyển `Missing → Lost` | một lần đếm sai xoá sổ tài sản trong im lặng | SPEC-13 §13.4: không tự chuyển; Asset Manager xác nhận từng cái |
