-- Migration 0549: S11-ASSET-DB-1 (🔴 RED, zone=red, crown) — ASSET Core (DB-15 §6.1–6.6, bước A §9).
--
-- MỤC TIÊU (plan docs/plans/S11-ASSET-DB-1.md §2): BUILD 6 bảng MỚI của module ASSET (SPEC-13):
--   • asset_categories      — loại tài sản (mutable, soft-delete). code_prefix vào mã TS-<PREFIX>-<seq>;
--                             unique (company_id, code_prefix) CỐ Ý KHÔNG partial (prefix không cấp lại — §6.7).
--   • assets                — hồ sơ tài sản, FSM 5 trạng thái ép ở service, DB chỉ CHECK tập giá trị (mutable,
--                             soft-delete có điều kiện ở service ASSET-ERR-015). KHÔNG cột holder_employee_id
--                             ("ai đang giữ" dẫn xuất từ lượt Active — DB-15 §4.5).
--   • asset_assignments     — SỔ cấp phát (không DELETE, UPDATE cấp cột). Chốt cuối "1 lượt Active / tài sản".
--   • asset_maintenances    — SỔ bảo trì (không DELETE, UPDATE cấp cột). Chốt cuối "1 lượt Open / tài sản".
--   • asset_inventories     — SỔ đợt kiểm kê (không DELETE, UPDATE cấp cột). Chốt cuối "1 đợt Open / company".
--   • asset_inventory_items — SỔ dòng kiểm kê (ảnh chụp lúc mở đợt; không DELETE, UPDATE cấp cột).
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 company_id NOT NULL + DEFAULT literal-GUC + RLS ENABLE + FORCE + policy tenant_isolation (USING + WITH
--      CHECK) TẠO TRƯỚC mọi INSERT — nguyên văn mẫu 0504/0479. MỌI FK chéo bảng nghiệp vụ là COMPOSITE tenant FK
--      (company_id, col) → parent (company_id, id) (khuôn 0535/0538) — KHÔNG có FK một-cột nào ngoài
--      company_id → companies (kiểm tra FK của Postgres KHÔNG áp RLS — KI-046). Verify (3) DƯƠNG đúng-bằng
--      26 composite FK: quên hẳn FK thì census/ratchet IM LẶNG (chỉ đếm FK đang tồn tại) — plan-reviewer B1.
--   #2 4 bảng sổ: GRANT SELECT, INSERT + UPDATE CẤP CỘT (allowlist §2.2 của plan) — KHÔNG GRANT UPDATE cấp bảng
--      (revoke-table-grant-wipes-column-grants), KHÔNG DELETE. 2 bảng mutable: SELECT/INSERT/UPDATE, KHÔNG DELETE
--      (soft delete = UPDATE). Verify bằng aclexplode(relacl/attacl) — KHÔNG information_schema (0540:137-139).
--      *_by trên 4 sổ = ON DELETE NO ACTION (KHÔNG SET NULL): RI action chạy ở tầng owner, bỏ qua allowlist cột
--      ⇒ SET NULL sẽ ghi đè assigned_by/opened_by/checked_by — đúng cột cố ý không grant (tiền lệ chat_calls).
--      Bảng mutable giữ SET NULL (col) (PHẢI liệt kê cột: SET NULL trần null luôn company_id — 0535:682).
--   #3 module không lưu secret; trường tài chính (purchase_price/supplier/cost) che ở service theo scope.
--   • FK nội bộ ON DELETE NO ACTION (kiểm cuối câu lệnh) — TUYỆT ĐỐI KHÔNG RESTRICT: cascade từ companies xoá
--     assets và asset_assignments theo thứ tự anh em bất định ⇒ RESTRICT nổ giữa chừng ⇒ cleanupTenants() chết,
--     đỏ hàng loạt afterAll (DB-15 §4.2). company_id → companies ON DELETE CASCADE (khuôn mọi bảng).
--   • DDL thủ công — KHÔNG db:generate (sẽ DROP schema media/finance đang park). schema/assets.ts là PARITY-only.
--   • KHÔNG seed sequence_counters: counter mã tài sản sinh CÙNG transaction với loại (S11-ASSET-BE-1, §6.7).
--
-- BAND 0549 (lane S11-ASSET-DB-1). Journal: idx 216, when 1717587338000 (> 0548 idx 215 / 1717587337000).
--   Cùng commit: schema/assets.ts + schema/index.ts · test/helpers/seed.ts cleanupTenants() (6 bảng con→cha,
--   TRƯỚC `DELETE FROM users`) · test/integration/rls-registry.ts (6 case).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (0) TIỀN KIỂM fail-loud ───────────────
DO $$
DECLARE
  t     text;
  v_n   int;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- SET NULL (col) trên FK composite cần PG >= 15 (đã dùng ở 0535/0538 trên chính cụm này).
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION '[0549] can PostgreSQL >= 15 cho ON DELETE SET NULL (col) — server_version_num = %',
      current_setting('server_version_num');
  END IF;

  -- Bảng ĐÍCH của composite FK phải có UNIQUE (company_id, id). KHÔNG tự tạo (bảng thuộc lane khác).
  FOREACH t IN ARRAY ARRAY['users', 'employee_profiles'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c
     WHERE c.conrelid = t::regclass AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['company_id', 'id']::text[];
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0549] % thieu UNIQUE (company_id, id) (dem duoc %) — chay truoc: '
                      'ALTER TABLE % ADD CONSTRAINT %_company_id_id_uq UNIQUE (company_id, id);', t, v_n, t, t;
    END IF;
  END LOOP;

  -- 6 bảng chưa được tồn tại (đụng tên = có lane khác dựng song song — DỪNG).
  FOREACH t IN ARRAY ARRAY['asset_categories', 'assets', 'asset_assignments', 'asset_maintenances',
                           'asset_inventories', 'asset_inventory_items'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      RAISE EXCEPTION '[0549] bang % DA TON TAI — dung ten voi lane khac, abort', t;
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint

-- ─────────────── 1. asset_categories (DB-15 §6.1 — mutable, soft-delete) ───────────────
CREATE TABLE asset_categories (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                        uuid NOT NULL
                                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                                      REFERENCES companies(id) ON DELETE CASCADE,
  code                              varchar(30) NOT NULL,
  name                              varchar(255) NOT NULL,
  code_prefix                       varchar(6) NOT NULL,
  description                       text,
  default_maintenance_interval_days integer,
  is_active                         boolean NOT NULL DEFAULT true,
  sort_order                        integer NOT NULL DEFAULT 0,
  metadata                          jsonb,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  created_by                        uuid,
  updated_at                        timestamptz NOT NULL DEFAULT now(),
  updated_by                        uuid,
  deleted_at                        timestamptz,
  deleted_by                        uuid,
  CONSTRAINT chk_asset_categories_prefix   CHECK (code_prefix ~ '^[A-Z0-9]{2,6}$'),
  CONSTRAINT chk_asset_categories_interval CHECK (default_maintenance_interval_days IS NULL OR default_maintenance_interval_days > 0),
  CONSTRAINT asset_categories_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE asset_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE asset_categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON asset_categories;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON asset_categories
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- *_by → users: bảng MUTABLE ⇒ SET NULL (col) (liệt kê cột, KHÔNG SET NULL trần).
ALTER TABLE asset_categories
  ADD CONSTRAINT asset_categories_created_by_tenant_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT asset_categories_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT asset_categories_deleted_by_tenant_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_asset_categories_company_code_active
  ON asset_categories (company_id, code) WHERE deleted_at IS NULL;
--> statement-breakpoint
-- CỐ Ý KHÔNG partial (DB-15 §6.1/§6.7): prefix đã dùng thì mã TS-<PREFIX>-0001 đã tồn tại trên tài sản
-- (kể cả Disposed) — cấp lại là đụng mã cũ. Dùng lại loại = KHÔI PHỤC loại đã xoá mềm, không tạo loại mới.
CREATE UNIQUE INDEX uq_asset_categories_company_prefix
  ON asset_categories (company_id, code_prefix);
--> statement-breakpoint
CREATE INDEX idx_asset_categories_company_active
  ON asset_categories (company_id, is_active, sort_order) WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON asset_categories TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON asset_categories TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 2. assets (DB-15 §6.2 — mutable, soft-delete có điều kiện) ───────────────
CREATE TABLE assets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL
                          DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                          REFERENCES companies(id) ON DELETE CASCADE,
  category_id           uuid NOT NULL,
  asset_code            varchar(50) NOT NULL,
  name                  varchar(255) NOT NULL,
  serial_number         varchar(120),
  brand                 varchar(120),
  model                 varchar(120),
  purchase_date         date,
  purchase_price        numeric(18, 2),
  supplier              varchar(255),
  warranty_end_date     date,
  location              varchar(255),
  condition_note        text,
  status                varchar(30) NOT NULL DEFAULT 'In Stock',
  status_reason         text,
  status_changed_at     timestamptz,
  status_changed_by     uuid,
  next_maintenance_due  date,
  description           text,
  metadata              jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  deleted_at            timestamptz,
  deleted_by            uuid,
  CONSTRAINT chk_assets_status   CHECK (status IN ('In Stock', 'Assigned', 'Under Maintenance', 'Disposed', 'Lost')),
  CONSTRAINT chk_assets_price    CHECK (purchase_price IS NULL OR purchase_price >= 0),
  CONSTRAINT chk_assets_warranty CHECK (warranty_end_date IS NULL OR purchase_date IS NULL OR warranty_end_date >= purchase_date),
  CONSTRAINT assets_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON assets;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON assets
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE assets
  ADD CONSTRAINT assets_category_tenant_fk FOREIGN KEY (company_id, category_id)
    REFERENCES asset_categories (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT assets_status_changed_by_tenant_fk FOREIGN KEY (company_id, status_changed_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (status_changed_by),
  ADD CONSTRAINT assets_created_by_tenant_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT assets_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT assets_deleted_by_tenant_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_assets_company_code_active
  ON assets (company_id, asset_code) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_assets_company_serial_active
  ON assets (company_id, serial_number) WHERE deleted_at IS NULL AND serial_number IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_assets_company_status_category
  ON assets (company_id, status, category_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_assets_company_maintenance_due
  ON assets (company_id, next_maintenance_due)
  WHERE deleted_at IS NULL AND next_maintenance_due IS NOT NULL AND status NOT IN ('Disposed', 'Lost');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON assets TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON assets TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 3. asset_assignments (DB-15 §6.3 — SỔ cấp phát, KHÔNG deleted_at) ───────────────
CREATE TABLE asset_assignments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL
                          DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                          REFERENCES companies(id) ON DELETE CASCADE,
  asset_id              uuid NOT NULL,
  employee_id           uuid NOT NULL,
  assigned_at           timestamptz NOT NULL DEFAULT now(),
  assigned_by           uuid,
  issue_condition       varchar(20),
  issue_note            text,
  expected_return_date  date,
  status                varchar(20) NOT NULL DEFAULT 'Active',
  returned_at           timestamptz,
  returned_by           uuid,
  return_condition      varchar(20),
  return_note           text,
  -- chừa cấp phát 2 bước (ASSET-DEC-002) — v1 luôn NULL: KHÔNG trong column-grant VÀ CHECK ack_v1 chặn cả lúc INSERT
  -- (column-grant chỉ chặn UPDATE; INSERT cấp bảng vẫn ghi được — security-reviewer M1). WO DEC-002 DROP CHECK này.
  acknowledged_at       timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  CONSTRAINT chk_asset_assignments_status CHECK (status IN ('Active', 'Returned')),
  CONSTRAINT chk_asset_assignments_issue  CHECK (issue_condition IS NULL OR issue_condition IN ('Good', 'Damaged')),
  CONSTRAINT chk_asset_assignments_return CHECK (return_condition IS NULL OR return_condition IN ('Good', 'Damaged', 'Lost')),
  -- Returned ⇒ phải có returned_at + return_condition; Active ⇒ cả hai NULL. "Thu hồi" = MỘT câu UPDATE đủ 3 cột.
  CONSTRAINT chk_asset_assignments_return_pair CHECK (
    (status = 'Active'   AND returned_at IS NULL     AND return_condition IS NULL) OR
    (status = 'Returned' AND returned_at IS NOT NULL AND return_condition IS NOT NULL)
  ),
  -- v1 (ASSET-DEC-002 = 1 bước): cột chỉ được mở khi có luồng xác nhận thật — DROP ở WO 2 bước, KHÔNG nới ở đây.
  CONSTRAINT chk_asset_assignments_ack_v1 CHECK (acknowledged_at IS NULL)
);
--> statement-breakpoint
ALTER TABLE asset_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE asset_assignments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON asset_assignments;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON asset_assignments
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- Sổ: *_by NO ACTION (không để RI action ghi đè cột ledger — xem header #2).
ALTER TABLE asset_assignments
  ADD CONSTRAINT asset_assignments_asset_tenant_fk FOREIGN KEY (company_id, asset_id)
    REFERENCES assets (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT asset_assignments_employee_tenant_fk FOREIGN KEY (company_id, employee_id)
    REFERENCES employee_profiles (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT asset_assignments_assigned_by_tenant_fk FOREIGN KEY (company_id, assigned_by)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT asset_assignments_returned_by_tenant_fk FOREIGN KEY (company_id, returned_by)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT asset_assignments_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
-- CHỐT CUỐI SPEC-13 §3.2: một tài sản một lượt đang sống.
CREATE UNIQUE INDEX uq_asset_assignments_active
  ON asset_assignments (company_id, asset_id) WHERE status = 'Active';
--> statement-breakpoint
CREATE INDEX idx_asset_assignments_asset_time
  ON asset_assignments (company_id, asset_id, assigned_at DESC);
--> statement-breakpoint
CREATE INDEX idx_asset_assignments_employee_active
  ON asset_assignments (company_id, employee_id) WHERE status = 'Active';
--> statement-breakpoint
CREATE INDEX idx_asset_assignments_employee_time
  ON asset_assignments (company_id, employee_id, assigned_at DESC);
--> statement-breakpoint
-- APPEND-ONLY-ish (bất biến #2): SELECT, INSERT + UPDATE CẤP CỘT — KHÔNG GRANT UPDATE cấp bảng, KHÔNG DELETE.
GRANT SELECT, INSERT ON asset_assignments TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (status, returned_at, returned_by, return_condition, return_note, updated_at, updated_by)
  ON asset_assignments TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON asset_assignments TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 4. asset_maintenances (DB-15 §6.4 — SỔ bảo trì) ───────────────
CREATE TABLE asset_maintenances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL
                   DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                   REFERENCES companies(id) ON DELETE CASCADE,
  asset_id       uuid NOT NULL,
  opened_at      timestamptz NOT NULL DEFAULT now(),
  opened_by      uuid,
  reason         text NOT NULL,
  vendor         varchar(255),
  status         varchar(20) NOT NULL DEFAULT 'Open',
  closed_at      timestamptz,
  closed_by      uuid,
  result_note    text,
  cost           numeric(18, 2),
  next_due_date  date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  CONSTRAINT chk_asset_maintenances_status CHECK (status IN ('Open', 'Closed')),
  CONSTRAINT chk_asset_maintenances_cost   CHECK (cost IS NULL OR cost >= 0),
  CONSTRAINT chk_asset_maintenances_close_pair CHECK (
    (status = 'Open' AND closed_at IS NULL) OR (status = 'Closed' AND closed_at IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE asset_maintenances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE asset_maintenances FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON asset_maintenances;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON asset_maintenances
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE asset_maintenances
  ADD CONSTRAINT asset_maintenances_asset_tenant_fk FOREIGN KEY (company_id, asset_id)
    REFERENCES assets (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT asset_maintenances_opened_by_tenant_fk FOREIGN KEY (company_id, opened_by)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT asset_maintenances_closed_by_tenant_fk FOREIGN KEY (company_id, closed_by)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT asset_maintenances_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
-- chốt cuối ASSET-ERR-004: một lượt Open / tài sản.
CREATE UNIQUE INDEX uq_asset_maintenances_open
  ON asset_maintenances (company_id, asset_id) WHERE status = 'Open';
--> statement-breakpoint
CREATE INDEX idx_asset_maintenances_asset_time
  ON asset_maintenances (company_id, asset_id, opened_at DESC);
--> statement-breakpoint
GRANT SELECT, INSERT ON asset_maintenances TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (status, closed_at, closed_by, result_note, cost, next_due_date, updated_at, updated_by)
  ON asset_maintenances TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON asset_maintenances TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 5. asset_inventories (DB-15 §6.5 — SỔ đợt kiểm kê) ───────────────
CREATE TABLE asset_inventories (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  name               varchar(255) NOT NULL,
  -- NULL = toàn bộ (MATCH SIMPLE: composite FK bỏ qua hàng NULL — đúng ý).
  category_id        uuid,
  status             varchar(20) NOT NULL DEFAULT 'Open',
  opened_at          timestamptz NOT NULL DEFAULT now(),
  opened_by          uuid,
  closed_at          timestamptz,
  closed_by          uuid,
  note               text,
  -- cache ghi MỘT LẦN lúc đóng (SPEC-13 §13.4); NULL khi còn Open.
  total_items        integer,
  found_count        integer,
  missing_count      integer,
  not_checked_count  integer,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid,
  CONSTRAINT chk_asset_inventories_status CHECK (status IN ('Open', 'Closed')),
  -- "Đóng đợt" = MỘT câu UPDATE ghi status + closed_at + 4 số tổng kết cùng lúc.
  CONSTRAINT chk_asset_inventories_close_pair CHECK (
    (status = 'Open'   AND closed_at IS NULL     AND total_items IS NULL     AND found_count IS NULL
                       AND missing_count IS NULL AND not_checked_count IS NULL) OR
    (status = 'Closed' AND closed_at IS NOT NULL AND total_items IS NOT NULL AND found_count IS NOT NULL
                       AND missing_count IS NOT NULL AND not_checked_count IS NOT NULL
                       AND total_items = found_count + missing_count + not_checked_count)
  ),
  CONSTRAINT asset_inventories_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE asset_inventories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE asset_inventories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON asset_inventories;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON asset_inventories
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE asset_inventories
  ADD CONSTRAINT asset_inventories_category_tenant_fk FOREIGN KEY (company_id, category_id)
    REFERENCES asset_categories (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT asset_inventories_opened_by_tenant_fk FOREIGN KEY (company_id, opened_by)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT asset_inventories_closed_by_tenant_fk FOREIGN KEY (company_id, closed_by)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT asset_inventories_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
-- chốt cuối ASSET-ERR-006: một đợt Open / company.
CREATE UNIQUE INDEX uq_asset_inventories_open
  ON asset_inventories (company_id) WHERE status = 'Open';
--> statement-breakpoint
CREATE INDEX idx_asset_inventories_company_time
  ON asset_inventories (company_id, opened_at DESC);
--> statement-breakpoint
GRANT SELECT, INSERT ON asset_inventories TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (status, closed_at, closed_by, note, total_items, found_count, missing_count, not_checked_count,
              updated_at, updated_by)
  ON asset_inventories TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON asset_inventories TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 6. asset_inventory_items (DB-15 §6.6 — SỔ dòng kiểm kê, ảnh chụp lúc mở) ───────────────
CREATE TABLE asset_inventory_items (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                   uuid NOT NULL
                                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                                 REFERENCES companies(id) ON DELETE CASCADE,
  inventory_id                 uuid NOT NULL,
  asset_id                     uuid NOT NULL,
  -- ảnh chụp assets.status lúc mở đợt — TẬP CON 3 giá trị (nguồn loại trừ Disposed/Lost; DB-15 §7).
  expected_status              varchar(30) NOT NULL,
  -- ảnh chụp người giữ lúc mở đợt. NO ACTION (KHÔNG SET NULL: composite SET NULL trần null luôn company_id;
  -- nhân viên là soft-delete nên ngoài teardown không bao giờ DELETE — DB-15 §6.6).
  expected_holder_employee_id  uuid,
  result                       varchar(20) NOT NULL DEFAULT 'Not Checked',
  checked_at                   timestamptz,
  checked_by                   uuid,
  note                         text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  updated_by                   uuid,
  CONSTRAINT chk_asset_inventory_items_result   CHECK (result IN ('Found', 'Missing', 'Not Checked')),
  CONSTRAINT chk_asset_inventory_items_expected CHECK (expected_status IN ('In Stock', 'Assigned', 'Under Maintenance')),
  CONSTRAINT chk_asset_inventory_items_check_pair CHECK (
    (result = 'Not Checked' AND checked_at IS NULL) OR (result <> 'Not Checked' AND checked_at IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE asset_inventory_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE asset_inventory_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON asset_inventory_items;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON asset_inventory_items
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE asset_inventory_items
  ADD CONSTRAINT asset_inventory_items_inventory_tenant_fk FOREIGN KEY (company_id, inventory_id)
    REFERENCES asset_inventories (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT asset_inventory_items_asset_tenant_fk FOREIGN KEY (company_id, asset_id)
    REFERENCES assets (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT asset_inventory_items_holder_tenant_fk FOREIGN KEY (company_id, expected_holder_employee_id)
    REFERENCES employee_profiles (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT asset_inventory_items_checked_by_tenant_fk FOREIGN KEY (company_id, checked_by)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT asset_inventory_items_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_asset_inventory_items_inventory_asset
  ON asset_inventory_items (company_id, inventory_id, asset_id);
--> statement-breakpoint
CREATE INDEX idx_asset_inventory_items_inventory_result
  ON asset_inventory_items (company_id, inventory_id, result);
--> statement-breakpoint
GRANT SELECT, INSERT ON asset_inventory_items TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (result, checked_at, checked_by, note, updated_at, updated_by)
  ON asset_inventory_items TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON asset_inventory_items TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (7) VERIFY fail-LOUD (RAISE EXCEPTION) — mọi assert có vế DƯƠNG đúng-bằng (plan §2.3, plan-reviewer B1–B3).
--     Migrator chạy 1 transaction ⇒ EXCEPTION = rollback sạch cả 6 bảng.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_tables   CONSTANT text[] := ARRAY['asset_categories', 'assets', 'asset_assignments', 'asset_maintenances',
                                      'asset_inventories', 'asset_inventory_items'];
  v_ledgers  CONSTANT text[] := ARRAY['asset_assignments', 'asset_maintenances', 'asset_inventories',
                                      'asset_inventory_items'];
  t          text;
  v_n        int;
  v_privs    text[];
  v_cols     text[];
  v_exp      text[];
  v_bad      text;
  v_pred     text;
  v_expected text;
  r          record;
BEGIN
  -- (1) RLS ENABLE + FORCE + policy tenant_isolation soi GUC ở CẢ USING lẫn WITH CHECK
  FOREACH t IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE oid = t::regclass AND relrowsecurity AND relforcerowsecurity
    ) THEN
      RAISE EXCEPTION '[0549] verify: % thieu ENABLE/FORCE ROW LEVEL SECURITY', t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
       WHERE polrelid = t::regclass AND polname = 'tenant_isolation'
         AND pg_get_expr(polqual, polrelid)      LIKE '%app.current_company_id%'
         AND pg_get_expr(polwithcheck, polrelid) LIKE '%app.current_company_id%'
    ) THEN
      RAISE EXCEPTION '[0549] verify: % thieu policy tenant_isolation USING+WITH CHECK theo GUC', t;
    END IF;
  END LOOP;

  -- (2) GRANT bằng aclexplode (KHÔNG information_schema — 0540:137-139)
  FOREACH t IN ARRAY v_tables LOOP
    -- (2a) app cấp bảng
    SELECT array_agg(x.privilege_type ORDER BY x.privilege_type) INTO v_privs
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
     WHERE c.oid = t::regclass AND x.grantee = 'mediaos_app'::regrole;
    v_exp := CASE WHEN t = ANY (v_ledgers) THEN ARRAY['INSERT', 'SELECT']
                  ELSE ARRAY['INSERT', 'SELECT', 'UPDATE'] END;
    IF v_privs IS DISTINCT FROM v_exp THEN
      RAISE EXCEPTION '[0549] verify: ACL cap bang cua mediaos_app tren % = % — ky vong % (bat bien #2)',
        t, v_privs, v_exp;
    END IF;

    -- (2b) app cấp cột UPDATE — so ĐÚNG BẰNG allowlist (thiếu HOẶC thừa đều đỏ)
    SELECT array_agg(a.attname::text ORDER BY a.attname) INTO v_cols
      FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
     WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND x.grantee = 'mediaos_app'::regrole AND x.privilege_type = 'UPDATE';
    v_exp := CASE t
      WHEN 'asset_assignments'     THEN ARRAY['return_condition', 'return_note', 'returned_at', 'returned_by',
                                             'status', 'updated_at', 'updated_by']
      WHEN 'asset_maintenances'    THEN ARRAY['closed_at', 'closed_by', 'cost', 'next_due_date', 'result_note',
                                             'status', 'updated_at', 'updated_by']
      WHEN 'asset_inventories'     THEN ARRAY['closed_at', 'closed_by', 'found_count', 'missing_count', 'note',
                                             'not_checked_count', 'status', 'total_items', 'updated_at',
                                             'updated_by']
      WHEN 'asset_inventory_items' THEN ARRAY['checked_at', 'checked_by', 'note', 'result', 'updated_at',
                                             'updated_by']
      ELSE NULL END;
    IF NOT (COALESCE(v_cols, ARRAY[]::text[]) @> COALESCE(v_exp, ARRAY[]::text[])
            AND COALESCE(v_exp, ARRAY[]::text[]) @> COALESCE(v_cols, ARRAY[]::text[])) THEN
      RAISE EXCEPTION '[0549] verify: column-UPDATE cua mediaos_app tren % = % — ky vong % (allowlist DB-15 §6)',
        t, v_cols, v_exp;
    END IF;

    -- (2c) app KHÔNG có ACL cấp cột nào khác UPDATE (INSERT/SELECT cột lẻ = lệch khuôn)
    SELECT count(*) INTO v_n
      FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
     WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND x.grantee = 'mediaos_app'::regrole AND x.privilege_type <> 'UPDATE';
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0549] verify: % co % column-ACL ngoai UPDATE cho mediaos_app — lech khuon', t, v_n;
    END IF;

    -- (2d) worker: đúng {SELECT} cấp bảng, 0 column-ACL
    SELECT array_agg(x.privilege_type ORDER BY x.privilege_type) INTO v_privs
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
     WHERE c.oid = t::regclass AND x.grantee = 'mediaos_worker'::regrole;
    IF v_privs IS DISTINCT FROM ARRAY['SELECT'] THEN
      RAISE EXCEPTION '[0549] verify: ACL cua mediaos_worker tren % = % — ky vong {SELECT}', t, v_privs;
    END IF;
    SELECT count(*) INTO v_n
      FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
     WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND x.grantee = 'mediaos_worker'::regrole;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0549] verify: mediaos_worker co % column-ACL tren % — ky vong 0', v_n, t;
    END IF;
  END LOOP;

  -- (3) COMPOSITE FK — DƯƠNG đúng-bằng 26 dòng (bảng, cột, đích, deltype, setcols). Thiếu/thừa ⇒ đỏ.
  --     Quên hẳn FK thì fk-tenant-census/xtenant-fk-ratchet IM LẶNG (chỉ đếm FK đang tồn tại) — nên phải
  --     kiểm DƯƠNG ở đây. conkey[1] ↔ confkey[1] (company_id), conkey[2] ↔ confkey[2] (col ↔ id).
  SELECT string_agg(format('%s.%s -> %s [%s|%s]', d.tbl, d.col, d.tgt, d.del, d.setcols), ' ; ') INTO v_bad
    FROM (
      WITH actual AS (
        SELECT c.conrelid::regclass::text AS tbl,
               (SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[2]) AS col,
               c.confrelid::regclass::text AS tgt,
               c.confdeltype::text AS del,
               COALESCE((SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
                          WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.confdelsetcols)), ARRAY[]::text[]) AS setcols
          FROM pg_constraint c
         WHERE c.contype = 'f'
           AND c.conrelid::regclass::text = ANY (v_tables)
           AND array_length(c.conkey, 1) = 2
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) = 'company_id'
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[1]) = 'company_id'
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[2]) = 'id'
      ), expected (tbl, col, tgt, del, setcols) AS (VALUES
        ('asset_categories',      'created_by',                  'users',             'n', ARRAY['created_by']),
        ('asset_categories',      'updated_by',                  'users',             'n', ARRAY['updated_by']),
        ('asset_categories',      'deleted_by',                  'users',             'n', ARRAY['deleted_by']),
        ('assets',                'category_id',                 'asset_categories',  'a', ARRAY[]::text[]),
        ('assets',                'status_changed_by',           'users',             'n', ARRAY['status_changed_by']),
        ('assets',                'created_by',                  'users',             'n', ARRAY['created_by']),
        ('assets',                'updated_by',                  'users',             'n', ARRAY['updated_by']),
        ('assets',                'deleted_by',                  'users',             'n', ARRAY['deleted_by']),
        ('asset_assignments',     'asset_id',                    'assets',            'a', ARRAY[]::text[]),
        ('asset_assignments',     'employee_id',                 'employee_profiles', 'a', ARRAY[]::text[]),
        ('asset_assignments',     'assigned_by',                 'users',             'a', ARRAY[]::text[]),
        ('asset_assignments',     'returned_by',                 'users',             'a', ARRAY[]::text[]),
        ('asset_assignments',     'updated_by',                  'users',             'a', ARRAY[]::text[]),
        ('asset_maintenances',    'asset_id',                    'assets',            'a', ARRAY[]::text[]),
        ('asset_maintenances',    'opened_by',                   'users',             'a', ARRAY[]::text[]),
        ('asset_maintenances',    'closed_by',                   'users',             'a', ARRAY[]::text[]),
        ('asset_maintenances',    'updated_by',                  'users',             'a', ARRAY[]::text[]),
        ('asset_inventories',     'category_id',                 'asset_categories',  'a', ARRAY[]::text[]),
        ('asset_inventories',     'opened_by',                   'users',             'a', ARRAY[]::text[]),
        ('asset_inventories',     'closed_by',                   'users',             'a', ARRAY[]::text[]),
        ('asset_inventories',     'updated_by',                  'users',             'a', ARRAY[]::text[]),
        ('asset_inventory_items', 'inventory_id',                'asset_inventories', 'a', ARRAY[]::text[]),
        ('asset_inventory_items', 'asset_id',                    'assets',            'a', ARRAY[]::text[]),
        ('asset_inventory_items', 'expected_holder_employee_id', 'employee_profiles', 'a', ARRAY[]::text[]),
        ('asset_inventory_items', 'checked_by',                  'users',             'a', ARRAY[]::text[]),
        ('asset_inventory_items', 'updated_by',                  'users',             'a', ARRAY[]::text[])
      )
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) d;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0549] verify: composite FK LECH so voi 26 dong ky vong (thieu/thua): %', v_bad;
  END IF;

  -- (3a') MỌI FK ≥ 2 cột trên 6 bảng phải = 26 — bộ lọc "đúng hình dạng (company_id,col)→(company_id,id)" ở trên
  --       sẽ RỚT FK lệch hình dạng khỏi cả hai vế EXCEPT (điểm mù security-reviewer L3); đếm thô bịt lại.
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY (v_tables) AND array_length(c.conkey, 1) >= 2;
  IF v_n <> 26 THEN
    RAISE EXCEPTION '[0549] verify: co % FK >= 2 cot tren 6 bang asset_*, ky vong dung 26 — co FK lech hinh dang', v_n;
  END IF;

  -- (3b) 0 FK một-cột từ 6 bảng tới bảng ≠ companies (đúng lớp lỗ KI-046)
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY (v_tables)
     AND array_length(c.conkey, 1) = 1 AND c.confrelid <> 'companies'::regclass;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0549] verify: con % FK MOT COT tu bang asset_* toi bang khac companies — phai composite', v_n;
  END IF;

  -- (4) UNIQUE (company_id, id) hậu kiểm trên 3 bảng ĐÍCH nội bộ
  FOREACH t IN ARRAY ARRAY['asset_categories', 'assets', 'asset_inventories'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c
     WHERE c.conrelid = t::regclass AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['company_id', 'id']::text[];
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0549] verify: % thieu UNIQUE (company_id, id) (dem duoc %)', t, v_n;
    END IF;
  END LOOP;

  -- (5) INDEX: predicate partial unique so ĐÚNG CHUỖI pg_get_expr (khong ILIKE '%WHERE%' — B3)
  FOR r IN SELECT * FROM (VALUES
      ('uq_asset_categories_company_code_active',  '(deleted_at IS NULL)'),
      ('uq_asset_categories_company_prefix',       NULL),
      ('uq_assets_company_code_active',            '(deleted_at IS NULL)'),
      ('uq_assets_company_serial_active',          '((deleted_at IS NULL) AND (serial_number IS NOT NULL))'),
      ('uq_asset_assignments_active',              '((status)::text = ''Active''::text)'),
      ('uq_asset_maintenances_open',               '((status)::text = ''Open''::text)'),
      ('uq_asset_inventories_open',                '((status)::text = ''Open''::text)'),
      ('uq_asset_inventory_items_inventory_asset', NULL)
    ) AS v(idx, pred)
  LOOP
    SELECT pg_get_expr(i.indpred, i.indrelid) INTO v_pred
      FROM pg_index i WHERE i.indexrelid = r.idx::regclass AND i.indisunique;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[0549] verify: index % khong ton tai hoac khong UNIQUE', r.idx;
    END IF;
    IF v_pred IS DISTINCT FROM r.pred THEN
      RAISE EXCEPTION '[0549] verify: predicate cua % = % — ky vong %', r.idx, COALESCE(v_pred, '<NULL>'),
        COALESCE(r.pred, '<NULL>');
    END IF;
  END LOOP;
  -- 9 index thường tồn tại theo tên
  FOREACH t IN ARRAY ARRAY['idx_asset_categories_company_active', 'idx_assets_company_status_category',
                           'idx_assets_company_maintenance_due', 'idx_asset_assignments_asset_time',
                           'idx_asset_assignments_employee_active', 'idx_asset_assignments_employee_time',
                           'idx_asset_maintenances_asset_time', 'idx_asset_inventories_company_time',
                           'idx_asset_inventory_items_inventory_result'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION '[0549] verify: index thuong % khong ton tai', t;
    END IF;
  END LOOP;

  RAISE NOTICE '[0549] verify PASS: 6 bang RLS+FORCE · ACL app/worker dung khuon · 26 composite FK · 8 unique + 9 index';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy). Thứ tự con → cha.
-- DROP TABLE IF EXISTS asset_inventory_items;
-- DROP TABLE IF EXISTS asset_inventories;
-- DROP TABLE IF EXISTS asset_maintenances;
-- DROP TABLE IF EXISTS asset_assignments;
-- DROP TABLE IF EXISTS assets;
-- DROP TABLE IF EXISTS asset_categories;
-- -- + gỡ 6 dòng cleanupTenants() + 6 case rls-registry + schema/assets.ts cùng lúc.
