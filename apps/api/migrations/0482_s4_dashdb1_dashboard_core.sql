-- Migration 0482: S4-DASH-DB-1 (🔴 RED, zone=red, crown) — DASH Core (DB-07 §8.1/8.2/8.3).
--
-- MỤC TIÊU (plan docs/plans/S4-DASH-DB-1.md — Option-A build-new-additive, mirror NOTI 0479):
--   BUILD 3 bảng MỚI DB-07 §8 (bắt buộc MVP dashboard), KHÔNG đụng dashboard/report cũ:
--     • dashboard_widgets          — DANH MỤC widget. company_id NULLABLE (NULL = catalog global dùng chung;
--       NOT NULL = custom widget company phase sau). RLS+FORCE + policy NULLABLE-TENANT (mẫu 0479
--       notification_events: USING company_id=GUC OR IS NULL / WITH CHECK company_id=GUC). GRANT app SELECT-only
--       (write company-custom → S4-DASH-BE sau). worker SELECT.
--     • dashboard_widget_configs   — CẤU HÌNH hiển thị widget theo company/dashboard_type/role/user. company_id
--       NOT NULL DEFAULT GUC. FK widget_id → dashboard_widgets. RLS+FORCE + policy literal-GUC (mirror 0479
--       notification_delivery_logs). GRANT app SELECT-only (config-update endpoint = S4-DASH-BE sau). worker SELECT.
--     • dashboard_widget_cache     — CACHE dữ liệu widget đã tổng hợp. company_id NOT NULL DEFAULT GUC. FK
--       widget_id → dashboard_widgets. scope_reference_id POLYMORPHIC (employee/dept/project/company) — KHÔNG FK.
--       RLS+FORCE + policy literal-GUC. GRANT app SELECT,INSERT,UPDATE (runtime upsert cache + soft-delete
--       invalidation) + worker SELECT,INSERT,UPDATE (regen cache). KHÔNG DELETE (soft-delete = UPDATE deleted_at).
--
-- ⚠️ BẢN ĐỒ TÊN DB-07 → QUAN HỆ THẬT: companies(id) / users(id) / roles(id) tồn tại. dashboard_widget_cache.
--    scope_reference_id là uuid tự-do (employee_id/department_id/project_id/company_id tùy cache_scope) — KHÔNG
--    ràng FK (polymorphic) theo DB-07 §8.3.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 RLS+FORCE + POLICY TẠO TRƯỚC mọi INSERT/backfill. widgets nullable-tenant (company NULL = global,
--      chỉ ĐỌC dạng dùng-chung, KHÔNG rò dữ liệu tenant khác — mọi row tenant-scoped vẫn lọc đúng company_id;
--      ghi global = seed/admin qua table-owner, KHÔNG qua app role). configs/cache company_id NOT NULL DEFAULT
--      NULLIF(current_setting(...))::uuid, policy literal-GUC. Tương thích set_config PgBouncer txn-mode.
--   #2 KHÔNG hard-delete: 3 bảng có deleted_at/by (soft-delete). Cache app GRANT KHÔNG DELETE — invalidation =
--      UPDATE deleted_at. configs/widgets write = DASH-BE (app SELECT-only ở WO này).
--   #3 KHÔNG secret trong DDL. Cache CHỈ chứa dữ liệu ĐÃ MASK + TRONG-SCOPE của (user/role/scope) — bất biến
--      ÉP ở tầng service S4-DASH-BE §9.7 step6 (permission + scope check TRƯỚC khi cache/serve), KHÔNG ở DDL.
--      cache_key gồm: company + dashboard_type + widget_code + user/role/scope + filter chính (DB-07 §8.3 rule 3).
--   #5 UUID PK · timestamptz UTC-at-rest (ADR-0008) · soft-delete deleted_at/by (KHÔNG hard-delete).
--   • DDL thủ công (RLS/grant/CHECK/partial-index không biểu diễn được bằng Drizzle) — KHÔNG db:generate.
--   • Additive: KHÔNG DROP bảng/mv dashboard cũ (mv 0102/0103 mv_dashboard_*, dashboard/report/alerts service).
--
-- BAND 0482 (lane S4-DASH-DB-1). Journal: idx 162, when 1717500805000 (> head 0481 idx 161 / 1717500800000).
--   Nối tiếp ĐƠN ĐIỆU sau 0481_s4_notiseed1_event_template_perms.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── 1. dashboard_widgets (DB-07 §8.1 — danh mục widget; company_id NULLABLE) ───────────────
CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULLABLE: NULL = widget GLOBAL (catalog dùng chung), NOT NULL = custom widget company (phase sau). KHÔNG
  -- default current_setting (global ghi NULL tường minh qua đường system/owner; app role ghi row tenant qua WITH CHECK).
  company_id                uuid REFERENCES companies(id) ON DELETE CASCADE,
  widget_code               varchar(100) NOT NULL,
  module_code               varchar(50) NOT NULL,
  name                      varchar(255) NOT NULL,
  description               text,
  widget_type               varchar(50) NOT NULL,
  required_permission_code  varchar(150) NOT NULL,
  default_data_scope        varchar(50) NOT NULL,
  data_source_key           varchar(150) NOT NULL,
  component_key             varchar(150) NOT NULL,
  default_refresh_seconds   integer,
  is_cacheable              boolean NOT NULL DEFAULT true,
  default_width             integer,
  default_height            integer,
  default_config            jsonb,
  empty_state_config        jsonb,
  action_config             jsonb,
  status                    varchar(50) NOT NULL DEFAULT 'Active',
  is_system_widget          boolean NOT NULL DEFAULT false,
  sort_order                integer NOT NULL DEFAULT 0,
  metadata                  jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at                timestamptz,
  deleted_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_dashboard_widgets_module_code
    CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM')),
  CONSTRAINT chk_dashboard_widgets_type
    CHECK (widget_type IN ('Summary','List','Chart','Calendar','Action','Alert')),
  CONSTRAINT chk_dashboard_widgets_scope
    CHECK (default_data_scope IN ('Own','Team','Department','Project','Company','System')),
  CONSTRAINT chk_dashboard_widgets_status
    CHECK (status IN ('Active','Inactive','Deprecated'))
);
-- ── RLS TRƯỚC mọi INSERT/backfill — nullable-tenant policy (mẫu 0479 notification_events) ──
ALTER TABLE dashboard_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_widgets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dashboard_widgets;
CREATE POLICY tenant_isolation ON dashboard_widgets
  USING (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR company_id IS NULL
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
  );
-- uq global (widget_code) WHERE company_id IS NULL + uq company (company_id, widget_code) WHERE NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboard_widgets_global_code_active
  ON dashboard_widgets (widget_code)
  WHERE company_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboard_widgets_company_code_active
  ON dashboard_widgets (company_id, widget_code)
  WHERE company_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_module_status
  ON dashboard_widgets (module_code, status, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_permission
  ON dashboard_widgets (required_permission_code) WHERE deleted_at IS NULL;
-- GRANT app SELECT-only (write company-custom → S4-DASH-BE). worker SELECT (regen cache đọc catalog).
GRANT SELECT ON dashboard_widgets TO mediaos_app;
GRANT SELECT ON dashboard_widgets TO mediaos_worker;
COMMENT ON TABLE dashboard_widgets IS
  'DB-07 §8.1 danh mục widget dashboard. company_id NULLABLE (NULL=global catalog). App SELECT-only; write=DASH-BE.';

-- ─────────────── 2. dashboard_widget_configs (DB-07 §8.2 — cấu hình hiển thị; company_id NOT NULL) ──────
CREATE TABLE IF NOT EXISTS dashboard_widget_configs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL
                              DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                              REFERENCES companies(id) ON DELETE CASCADE,
  widget_id                 uuid NOT NULL REFERENCES dashboard_widgets(id) ON DELETE CASCADE,
  dashboard_type            varchar(50) NOT NULL,
  role_id                   uuid REFERENCES roles(id) ON DELETE CASCADE,
  user_id                   uuid REFERENCES users(id) ON DELETE CASCADE,
  config_scope              varchar(50) NOT NULL,
  is_enabled                boolean NOT NULL DEFAULT true,
  sort_order                integer NOT NULL DEFAULT 0,
  layout_x                  integer,
  layout_y                  integer,
  layout_width              integer,
  layout_height             integer,
  data_scope_override       varchar(50),
  refresh_seconds_override  integer,
  config                    jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at                timestamptz,
  deleted_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_dashboard_widget_configs_dashboard_type
    CHECK (dashboard_type IN ('Employee','Manager','HR','Admin','System','Project')),
  CONSTRAINT chk_dashboard_widget_configs_scope
    CHECK (config_scope IN ('Company','Role','User')),
  CONSTRAINT chk_dashboard_widget_configs_data_scope_override
    CHECK (
      data_scope_override IS NULL
      OR data_scope_override IN ('Own','Team','Department','Project','Company','System')
    ),
  -- Company ⇒ role/user NULL; Role ⇒ role NOT NULL, user NULL; User ⇒ user NOT NULL (DB-07 §8.2).
  CONSTRAINT chk_dashboard_widget_configs_role_user_scope
    CHECK (
      (config_scope = 'Company' AND role_id IS NULL AND user_id IS NULL)
      OR (config_scope = 'Role' AND role_id IS NOT NULL AND user_id IS NULL)
      OR (config_scope = 'User' AND user_id IS NOT NULL)
    )
);
-- literal-GUC policy (mirror 0479 notification_delivery_logs) — USING = WITH CHECK = GUC.
ALTER TABLE dashboard_widget_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_widget_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dashboard_widget_configs;
CREATE POLICY tenant_isolation ON dashboard_widget_configs
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS idx_dashboard_widget_configs_company_dashboard
  ON dashboard_widget_configs (company_id, dashboard_type, is_enabled, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dashboard_widget_configs_role
  ON dashboard_widget_configs (company_id, role_id, dashboard_type, is_enabled)
  WHERE role_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dashboard_widget_configs_user
  ON dashboard_widget_configs (company_id, user_id, dashboard_type, is_enabled)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dashboard_widget_configs_widget
  ON dashboard_widget_configs (company_id, widget_id) WHERE deleted_at IS NULL;
-- GRANT app SELECT-only. Config-update endpoint (create/update/soft-delete config) = S4-DASH-BE sau
-- (mọi cập nhật config ghi audit — DB-07 §8.2 rule 5). worker SELECT (regen cache đọc config bật/tắt).
GRANT SELECT ON dashboard_widget_configs TO mediaos_app;
GRANT SELECT ON dashboard_widget_configs TO mediaos_worker;
COMMENT ON TABLE dashboard_widget_configs IS
  'DB-07 §8.2 cấu hình hiển thị widget theo company/dashboard_type/role/user. App SELECT-only; write+audit=DASH-BE.';

-- ─────────────── 3. dashboard_widget_cache (DB-07 §8.3 — cache widget đã tổng hợp; company_id NOT NULL) ──
CREATE TABLE IF NOT EXISTS dashboard_widget_cache (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL
                         DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                         REFERENCES companies(id) ON DELETE CASCADE,
  widget_id            uuid NOT NULL REFERENCES dashboard_widgets(id) ON DELETE CASCADE,
  dashboard_type       varchar(50) NOT NULL,
  user_id              uuid REFERENCES users(id) ON DELETE CASCADE,
  role_id              uuid REFERENCES roles(id) ON DELETE CASCADE,
  cache_scope          varchar(50) NOT NULL,
  -- POLYMORPHIC (employee_id/department_id/project_id/company_id tùy cache_scope) — KHÔNG FK (DB-07 §8.3).
  scope_reference_id   uuid,
  cache_key            varchar(255) NOT NULL,
  data                 jsonb NOT NULL,
  data_hash            varchar(255),
  status               varchar(50) NOT NULL DEFAULT 'Fresh',
  generated_at         timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  last_accessed_at     timestamptz,
  error_message        text,
  source_version       varchar(100),
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  deleted_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_dashboard_widget_cache_dashboard_type
    CHECK (dashboard_type IN ('Employee','Manager','HR','Admin','System','Project')),
  CONSTRAINT chk_dashboard_widget_cache_scope
    CHECK (cache_scope IN ('Own','Team','Department','Project','Company','System')),
  CONSTRAINT chk_dashboard_widget_cache_status
    CHECK (status IN ('Fresh','Stale','Expired','Error')),
  CONSTRAINT chk_dashboard_widget_cache_time
    CHECK (expires_at >= generated_at)
);
-- literal-GUC policy (mirror 0479 notification_delivery_logs) — USING = WITH CHECK = GUC.
ALTER TABLE dashboard_widget_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_widget_cache FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dashboard_widget_cache;
CREATE POLICY tenant_isolation ON dashboard_widget_cache
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboard_widget_cache_key_active
  ON dashboard_widget_cache (company_id, cache_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dashboard_widget_cache_lookup
  ON dashboard_widget_cache (company_id, widget_id, dashboard_type, cache_scope, scope_reference_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dashboard_widget_cache_user
  ON dashboard_widget_cache (company_id, user_id, widget_id)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dashboard_widget_cache_expires
  ON dashboard_widget_cache (company_id, status, expires_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dashboard_widget_cache_scope_ref
  ON dashboard_widget_cache (company_id, cache_scope, scope_reference_id) WHERE deleted_at IS NULL;
-- GRANT app SELECT,INSERT,UPDATE (runtime upsert cache + soft-delete invalidation via UPDATE deleted_at) —
-- KHÔNG DELETE (BẤT BIẾN #2 soft-delete). worker SELECT,INSERT,UPDATE (regen cache job). KHÔNG DELETE.
GRANT SELECT, INSERT, UPDATE ON dashboard_widget_cache TO mediaos_app;
GRANT SELECT, INSERT, UPDATE ON dashboard_widget_cache TO mediaos_worker;
-- BẤT BIẾN cache (ÉP ở service S4-DASH-BE §9.7 step6, KHÔNG ở DDL):
--   1. Cache CHỈ chứa dữ liệu ĐÃ MASK + TRONG-SCOPE của (user/role/scope) — permission + scope check TRƯỚC
--      khi generate/serve cache (DB-07 §8.3 rule 2). KHÔNG lưu dữ liệu nhạy cảm ngoài scope / chưa mask.
--   2. cache_key = company + dashboard_type + widget_code + user/role/scope + filter chính (DB-07 §8.3 rule 3).
--   3. Chỉ cache widget có dashboard_widgets.is_cacheable = true (DB-07 §8.3 rule 1).
COMMENT ON TABLE dashboard_widget_cache IS
  'DB-07 §8.3 cache widget đã tổng hợp. company_id NOT NULL. App SELECT,INSERT,UPDATE (no DELETE=soft-delete). Cache CHỈ chứa data đã mask+trong-scope (ép DASH-BE §9.7); cache_key gồm company+dashboard_type+widget_code+user/scope.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DROP TABLE IF EXISTS dashboard_widget_cache CASCADE;
-- DROP TABLE IF EXISTS dashboard_widget_configs CASCADE;
-- DROP TABLE IF EXISTS dashboard_widgets CASCADE;
