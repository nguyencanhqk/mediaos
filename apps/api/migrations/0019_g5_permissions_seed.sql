-- Migration 0019: G5-5a-bis — Seed permissions catalog cho G5 modules.
-- ⚠️ PHẢI chạy SAU 0018 (employee_profiles) và TRƯỚC code salary mask (G5-5b).
-- Gate: FULL — view-salary/update-salary là sensitive; test: wildcard grant KHÔNG đủ.

-- Thêm permissions cho position
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('create',        'position', false),
  ('read',          'position', false),
  ('update',        'position', false),
  ('delete',        'position', false),
  ('manage',        'position', false),
  ('manage.position', 'position', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- Thêm permissions cho employee
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('create',         'employee', false),
  ('read',           'employee', false),
  ('update',         'employee', false),
  ('delete',         'employee', false),
  ('manage',         'employee', false),
  ('import',         'employee', false),
  ('view-salary',    'employee', true),
  ('update-salary',  'employee', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- Thêm permissions cho company settings
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('configure-company', 'company', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- Thêm system role hr-manager (company_id = NULL, is_system = true)
INSERT INTO roles (id, company_id, name, description, is_system) VALUES
  ('00000000-0000-0000-0000-000000000009', NULL, 'hr-manager',
   'HR manager: full employee management + view-salary (sensitive)', true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Grant non-sensitive employee + position permissions to company-admin
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type IN ('position', 'employee')
  AND p.is_sensitive = false
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Grant configure-company to company-admin
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.action = 'configure-company' AND p.resource_type = 'company'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Grant non-sensitive employee + position READ to project-manager
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000002', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type IN ('position', 'employee')
  AND p.action = 'read'
  AND p.is_sensitive = false
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Grant ALL employee + position permissions (non-sensitive) to hr-manager
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000009', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type IN ('position', 'employee')
  AND p.is_sensitive = false
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Grant view-salary + update-salary (SENSITIVE) explicitly to hr-manager
-- Wildcard grants KHÔNG đủ — phải grant explicit IS_SENSITIVE=true permissions (ADR-0010).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000009', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type = 'employee'
  AND p.action IN ('view-salary', 'update-salary')
  AND p.is_sensitive = true
ON CONFLICT DO NOTHING;
