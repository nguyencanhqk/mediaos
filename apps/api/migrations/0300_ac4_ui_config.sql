-- Migration 0300: AC-4 UI config (Admin Control Plane N3) — branding / navigation / i18n overrides per-tenant.
--
-- BAND 0300-0309 (lane ac4 — Admin Control Plane). Journal idx 99, when 1717500340000 (> high-water
--   1717500330000 của 0330_ac7) khi land — RECONCILE theo master max LÚC LAND, re-stamp mỗi rebase.
--
-- MỤC TIÊU (PRD §4 N3): TENANT self-service — company-admin cấu hình giao diện CÔNG TY MÌNH (companyId
--   từ JWT, KHÔNG cross-tenant operator). 3 nhóm cấu hình: branding (logo/màu), navigation (menu động —
--   ẩn item nếu module tắt qua FeatureFlagService), i18n overrides (đè chuỗi dịch per-tenant).
--
-- BẤT BIẾN:
--   #1 company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy USING+WITH CHECK (cả 3 bảng)
--      + index company_id. Mọi repo qua withTenant(companyId từ JWT).
--   #2 KHÔNG hard-delete: branding upsert idempotent 1-row/tenant; navigation/i18n dùng deleted_at (soft).
--      audit_logs giữ append-only (chỉ DO-block ADD-only object_type, KHÔNG nới UPDATE/DELETE grant).
--   #3 KHÔNG secret: chỉ metadata công khai (logo_url, màu, label, route, key/value i18n) ⇒ is_sensitive=FALSE.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- tenant_branding — 1 row / tenant (UNIQUE company_id). Upsert idempotent (BẤT BIẾN #2, không hard-delete).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE tenant_branding (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL
                    DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                    REFERENCES companies(id) ON DELETE CASCADE,
  logo_url        text,
  favicon_url     text,
  primary_color   text,
  secondary_color text,
  company_name    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_branding_company_uq UNIQUE (company_id)
);
--> statement-breakpoint
ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant_branding FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant_branding
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX tenant_branding_company_id_idx ON tenant_branding(company_id);
--> statement-breakpoint
-- Branding mutable (upsert 1-row): app SELECT/INSERT + UPDATE (idempotent set). KHÔNG DELETE (BẤT BIẾN #2).
GRANT SELECT, INSERT, UPDATE ON tenant_branding TO mediaos_app;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ui_navigation_config — item menu per-tenant. UNIQUE(company_id, key). module_key nullable (ẩn nếu
-- module tắt qua FeatureFlagService). is_visible=false ẩn cứng. deleted_at soft-delete (BẤT BIẾN #2).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE ui_navigation_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL
                  DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                  REFERENCES companies(id) ON DELETE CASCADE,
  key           text NOT NULL,
  label         text NOT NULL,
  route         text NOT NULL,
  icon          text,
  parent_key    text,
  display_order integer NOT NULL DEFAULT 0,
  -- module-key trỏ feature/module: item ẩn khỏi effective menu nếu module TẮT (FeatureFlagService).
  module_key    text,
  is_visible    boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT ui_navigation_company_key_uq UNIQUE (company_id, key)
);
--> statement-breakpoint
ALTER TABLE ui_navigation_config ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ui_navigation_config FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ui_navigation_config
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX ui_navigation_config_company_id_idx ON ui_navigation_config(company_id);
--> statement-breakpoint
-- Mutable cấu hình (upsert + soft-delete): app SELECT/INSERT/UPDATE. KHÔNG DELETE (BẤT BIẾN #2 — deleted_at).
GRANT SELECT, INSERT, UPDATE ON ui_navigation_config TO mediaos_app;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- i18n_overrides — đè chuỗi dịch per-tenant. UNIQUE(company_id, locale, namespace, key). deleted_at soft.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE i18n_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies(id) ON DELETE CASCADE,
  locale      text NOT NULL,
  namespace   text NOT NULL,
  key         text NOT NULL,
  value       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT i18n_overrides_company_lnk_uq UNIQUE (company_id, locale, namespace, key)
);
--> statement-breakpoint
ALTER TABLE i18n_overrides ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE i18n_overrides FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON i18n_overrides
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX i18n_overrides_company_id_idx ON i18n_overrides(company_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON i18n_overrides TO mediaos_app;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- audit_logs CHECK + 'tenant_branding','ui_navigation','i18n_override' (DO-block ADD-only, tiền lệ
-- 0099/0132/0140/0150/0200/0231/0310). HOT-FILE (TASKS §5.3): audit CHECK = UNION mọi lane. Đọc CẢ HAI
-- dạng (`IN (...)` VÀ `= ANY ('{...}'::text[])`). Chỉ thêm 3 type. Sync AUDIT_OBJECT_TYPES (schema/audit.ts)
-- CÙNG commit. KHÔNG drop+full-rewrite. Audit ghi cùng tx khi PUT branding/navigation/i18n (KHÔNG secret).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['tenant_branding', 'ui_navigation', 'i18n_override'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RETURN;
  END IF;

  v_def := pg_get_constraintdef(v_oid);
  IF position('ANY' IN upper(v_def)) > 0 THEN
    v_cur := substring(v_def FROM '\{[^}]*\}')::text[];
  ELSE
    SELECT array_agg(m[1]) INTO v_cur
      FROM (
        SELECT regexp_matches(v_def, '''([^'']+)''', 'g') AS m
      ) sub;
  END IF;

  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
END;
$$;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Permission seed: view/manage branding + manage ui-navigation + manage i18n-override (is_sensitive=FALSE
-- per PRD §5.y — logo/menu/i18n KHÔNG nhạy cảm). App role SELECT-only trên `permissions` (0005) ⇒ INSERT
-- qua migration. New perm KHÔNG tự vào role ⇒ GRANT TƯỜNG MINH role company-admin (00000001). Khai
-- is_sensitive ở CẢ seed (đây) LẪN @RequirePermission decorator (controller). ON CONFLICT DO NOTHING.
-- ⚠️ is_sensitive=FALSE ⇒ company-admin grant tường minh là ĐỦ (KHÔNG đòi per-object grant / re-auth).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view',   'branding',       false),
  ('manage', 'branding',       false),
  ('manage', 'ui-navigation',  false),
  ('manage', 'i18n-override',  false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (
    ('view',   'branding'),
    ('manage', 'branding'),
    ('manage', 'ui-navigation'),
    ('manage', 'i18n-override')
  )
ON CONFLICT DO NOTHING;

-- -------- Down (manual) --------
-- DELETE FROM role_permissions WHERE permission_id IN
--   (SELECT id FROM permissions WHERE (action,resource_type) IN
--     (('view','branding'),('manage','branding'),('manage','ui-navigation'),('manage','i18n-override')));
-- DELETE FROM permissions WHERE (action,resource_type) IN
--   (('view','branding'),('manage','branding'),('manage','ui-navigation'),('manage','i18n-override'));
-- DROP TABLE i18n_overrides; DROP TABLE ui_navigation_config; DROP TABLE tenant_branding;
