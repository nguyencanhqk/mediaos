-- Migration 0100: G14-1 — Seed permission catalog for dashboard read.
-- read:dashboard is non-sensitive; grants company-wide access to the aggregate endpoint.
-- Granular masking (task/attendance/leave visibility) is handled server-side in DashboardService
-- based on the caller's existing task/attendance/leave permissions — no new sensitive grants here.

INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('read', 'dashboard', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- All system roles get read:dashboard (masking is server-side per existing perms).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'ALLOW'
FROM roles r
CROSS JOIN permissions p
WHERE p.action = 'read'
  AND p.resource_type = 'dashboard'
  AND p.is_sensitive = false
ON CONFLICT DO NOTHING;
