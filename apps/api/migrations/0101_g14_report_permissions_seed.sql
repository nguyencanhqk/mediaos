-- G14-2: Report permissions seed
-- Adds read:finance_report, read:employee_report, read:attendance_report permissions.
-- ON CONFLICT DO NOTHING = idempotent, safe to re-run.

DO $$
BEGIN
  -- ─── Insert permissions ───────────────────────────────────────────────────

  INSERT INTO permissions (action, resource_type, is_sensitive)
  VALUES
    ('read', 'finance_report',    false),
    ('read', 'employee_report',   false),
    ('read', 'attendance_report', false)
  ON CONFLICT (action, resource_type) DO NOTHING;

  -- ─── Grant to privileged roles ────────────────────────────────────────────

  -- finance_report → cfo, finance, leadership, admin
  INSERT INTO role_permissions (role_id, permission_id, effect)
  SELECT r.id, p.id, 'ALLOW'
  FROM roles r
  CROSS JOIN permissions p
  WHERE r.name IN ('cfo', 'finance', 'leadership', 'admin')
    AND p.action = 'read' AND p.resource_type = 'finance_report'
  ON CONFLICT DO NOTHING;

  -- employee_report → hr, leadership, admin, manager
  INSERT INTO role_permissions (role_id, permission_id, effect)
  SELECT r.id, p.id, 'ALLOW'
  FROM roles r
  CROSS JOIN permissions p
  WHERE r.name IN ('hr', 'leadership', 'admin', 'manager')
    AND p.action = 'read' AND p.resource_type = 'employee_report'
  ON CONFLICT DO NOTHING;

  -- attendance_report → hr, leadership, admin, manager
  INSERT INTO role_permissions (role_id, permission_id, effect)
  SELECT r.id, p.id, 'ALLOW'
  FROM roles r
  CROSS JOIN permissions p
  WHERE r.name IN ('hr', 'leadership', 'admin', 'manager')
    AND p.action = 'read' AND p.resource_type = 'attendance_report'
  ON CONFLICT DO NOTHING;
END $$;
