-- Migration 0330: AC-7 module-registry — catalog GLOBAL `system_modules` (lớp module trên feature-flag).
-- Gate: FULL (database-reviewer [no-RLS catalog/grant] + security-reviewer [sensitive perm/wildcard] +
--   silent-failure-hunter + santa).
--
-- BAND 0330-0339 (lane ac7 — Admin Control Plane). Journal idx 97, when 1717500320000 (> high-water
--   1717500310000 của 0110_g15) khi land — RECONCILE theo master max LÚC LAND, re-stamp mỗi rebase.
--
-- MỤC TIÊU: Model "module" = bundle feature-key + metadata hiển thị, trong CATALOG TOÀN CỤC mới
--   `system_modules` (mirror permissions/subscription_plans: no company_id ⇒ KHÔNG RLS, app SELECT-only).
--   KHÔNG store on/off thứ 3 (tenant_modules) — bật/tắt per-tenant = company_feature_flags (G16-3).
--
-- BẤT BIẾN: #1 — catalog global no-RLS (không company_id ⇒ tự loại rls-guards; KHÔNG vào rls-registry/
--   cleanupTenants). #2 — không hard-delete (is_active soft-disable). #3 — không secret (chỉ metadata
--   hiển thị; feature_keys/depends_on là key kỹ thuật, KHÔNG dữ liệu nhạy cảm).
-- Audit toggle TÁI DÙNG object_type 'company' (action mới operator.module_toggled) ⇒ KHÔNG đổi audit CHECK.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- CATALOG TOÀN CỤC — KHÔNG company_id, KHÔNG RLS (mirror `permissions` 0005). App role SELECT-only.
-- Ghi (INSERT/UPDATE/DELETE) CHỈ qua migration (catalog immutable lúc runtime trong scaffold AC-7).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE system_modules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL,
  name          text NOT NULL,
  description   text,
  icon          text,
  route         text,
  -- bundle feature-key (trỏ plan_entitlements kind=feature). Bật module = bật mọi key này.
  feature_keys  text[] NOT NULL DEFAULT '{}',
  -- module-key phụ thuộc (DAG). Bật module này yêu cầu các depends_on đã bật.
  depends_on    text[] NOT NULL DEFAULT '{}',
  display_order integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_modules_key_uq UNIQUE (key)
);
--> statement-breakpoint
GRANT SELECT ON system_modules TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON system_modules TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SEED: catalog module ban đầu. feature_keys trỏ entitlement-key có sẵn (0231): advanced_analytics,
-- custom_workflows. UUID cố định để test/clone tham chiếu. ON CONFLICT (key) DO NOTHING (idempotent).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO system_modules (id, key, name, description, icon, route, feature_keys, depends_on, display_order) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'analytics', 'Phân tích nâng cao',
   'Báo cáo & phân tích nâng cao', 'bar-chart', '/analytics',
   ARRAY['advanced_analytics'], ARRAY[]::text[], 0),
  ('00000000-0000-0000-0000-0000000000d2', 'custom-workflows', 'Quy trình tùy chỉnh',
   'Thiết kế quy trình tùy biến', 'workflow', '/workflows',
   ARRAY['custom_workflows'], ARRAY[]::text[], 1)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SEED: permissions cho module-registry (is_sensitive ép wildcard *:* KHÔNG kế thừa cổng manage).
-- App role SELECT-only trên `permissions` (0005) ⇒ INSERT qua migration. New perm KHÔNG tự vào role
-- (0005 chỉ grant perm tồn tại lúc đó) ⇒ GRANT TƯỜNG MINH role …f0 platform-admin (sensitive ⇒ explicit
-- non-wildcard ALLOW). Khai is_sensitive ở CẢ seed (đây) LẪN @RequirePermission decorator (controller).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('manage', 'module-toggle',  true),
  ('view',   'system-module',  false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-0000000000f0', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (
    ('manage', 'module-toggle'),
    ('view',   'system-module')
  )
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- (Audit object_type KHÔNG đổi ở 0330 — module toggle ở tầng operator TÁI DÙNG 'company',
--  action mới operator.module_toggled. Không DO-block audit-CHECK.)

-- -------- Down (manual) --------
-- DELETE FROM role_permissions WHERE permission_id IN
--   (SELECT id FROM permissions WHERE (action,resource_type) IN (('manage','module-toggle'),('view','system-module')));
-- DELETE FROM permissions WHERE (action,resource_type) IN (('manage','module-toggle'),('view','system-module'));
-- DROP TABLE system_modules;
