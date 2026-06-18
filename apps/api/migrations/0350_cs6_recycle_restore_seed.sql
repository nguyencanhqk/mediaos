-- Migration 0350: CS-6 — Seed permission for restore:employee (sensitive) + grant to system-admin.
-- restore:employee requires explicit sensitive grant (wildcard *:* KHÔNG đủ — ADR-0010).

INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('restore', 'employee', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- Grant restore:employee to system-admin role (id: 00000000-0000-0000-0000-000000000001).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.action = 'restore' AND p.resource_type = 'employee'
ON CONFLICT DO NOTHING;
