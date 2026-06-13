-- Migration 0082: G8-1 — seed permission catalog (approve/reject approval-request) + grant company-admin.
--
-- BAND 0080s (lane G8). HOT-FILE rule (TASKS §5.3): permission seed = INSERT … ON CONFLICT DO NOTHING
--   (idempotent, additive — running twice = 1 row). Never rewrite existing catalog rows.
-- ⚠️ SPELLING HYPHEN ('approval-request') — MUST be byte-identical to @RequirePermission in
--   approval-inbox.controller.ts. Seed underscore = grant.resource_type drift in PermissionService.can()
--   → permanent 403 (residual d342, G7). Hyphen everywhere.
-- ⚠️ Non-sensitive (approve/reject of an approval-request are NOT secret/payroll) → is_sensitive=false.
--   can() reads role_permissions/object_permissions, NOT the catalog → must grant explicitly here so
--   company-admin can use the endpoints immediately (mirror 0019/0027/0036).

-- 1. Catalog — 2 permissions.
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('approve', 'approval-request', false),
  ('reject',  'approval-request', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- 2. Grant both to company-admin (001). ON CONFLICT DO NOTHING bare (arbiter = role_permissions_uq
--    UNIQUE(role_id, permission_id, effect); effect always 'ALLOW' here → bare = idempotent).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (
  ('approve', 'approval-request'),
  ('reject',  'approval-request')
)
ON CONFLICT DO NOTHING;
