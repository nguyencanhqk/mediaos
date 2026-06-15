-- Migration 0089: G8-4 — seed permission catalog (manage:kpi-definition + read:kpi + confirm:kpi) + grant admin.
--
-- BAND 0080s (lane G8). HOT-FILE rule (TASKS §5.3): permission seed = INSERT … ON CONFLICT DO NOTHING
--   (idempotent, additive — running twice = 1 row). Never rewrite existing catalog rows.
-- ⚠️ SPELLING HYPHEN ('kpi-definition') — MUST be byte-identical to @RequirePermission in kpi.controller.ts.
--   Seed underscore = grant.resource_type drift in PermissionService.can() → permanent 403 (residual d342, G7).
-- ⚠️ BR-007: confirm:kpi đặt is_sensitive=false (mirror score:evaluation 0085 — quản trị KPI không phải
--   secret/payroll; quyền vẫn ép bằng grant tường minh). manage/read/confirm đều non-sensitive.
-- can() reads role_permissions/object_permissions, NOT the catalog → grant explicitly so company-admin
--   can use the endpoints immediately (mirror 0019/0027/0036/0082/0085).

-- 1. Catalog — 3 permissions.
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('manage',  'kpi-definition', false),
  ('read',    'kpi',           false),
  ('confirm', 'kpi',           false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- 2. Grant all three to company-admin (001). ON CONFLICT DO NOTHING bare (arbiter = role_permissions_uq).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (
  ('manage',  'kpi-definition'),
  ('read',    'kpi'),
  ('confirm', 'kpi')
)
ON CONFLICT DO NOTHING;
