-- Migration 0097: G12-2 — Seed permissions catalog cho Payroll period + payslip.
-- ⚠️ Chạy SAU 0094/0095/0096. Tiền lệ: 0019/0027/0063/0092 (seed sau catalog, ON CONFLICT DO NOTHING).
--
-- BẤT BIẾN #3 / ADR-0005 — LƯƠNG/PAYSLIP NHẠY CẢM:
--   - run-payroll + view-payslip + read-payslip is_sensitive=TRUE ⇒ permission engine KHÔNG cho kế thừa
--     qua wildcard *:* (G3-2). Grant TAY CHỈ company-admin + hr-manager (sensitive không lan qua role generic).
--   - manage-payroll-period (tạo/khoá kỳ) = không nhạy cảm (quản trị kỳ, không lộ số lương).
--   - view-payslip = SLOT cho re-auth khi xem payslip (G12-4) — field reserved, KHÔNG implement re-auth flow.

INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('manage-payroll-period', 'payroll_period', false),
  ('run-payroll',          'payroll_period', true),
  ('view-payslip',         'payslip',        true),
  ('read-payslip',         'payslip',        true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- company-admin (00000001): toàn quyền payroll. Grant TAY (sensitive không kế thừa).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type IN ('payroll_period', 'payslip')
  AND p.action IN ('manage-payroll-period', 'run-payroll', 'view-payslip', 'read-payslip')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- hr-manager (00000009): toàn quyền payroll. Grant TAY.
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000009', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type IN ('payroll_period', 'payslip')
  AND p.action IN ('manage-payroll-period', 'run-payroll', 'view-payslip', 'read-payslip')
ON CONFLICT DO NOTHING;
