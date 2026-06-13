-- Migration 0087: G8-2 — seed permission catalog (create/view defect) + grant company-admin.
--
-- BAND 0080s (lane G8). idx=63, when=1717500126000.
-- HOT-FILE rule (TASKS §5.3): ON CONFLICT DO NOTHING — idempotent, additive.
-- defect permissions are non-sensitive (not payroll/secret/finance).

-- 1. Catalog — 2 permissions.
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('create', 'defect', false),
  ('view',   'defect', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- 2. Grant both to company-admin (001).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (
  ('create', 'defect'),
  ('view',   'defect')
)
ON CONFLICT DO NOTHING;
