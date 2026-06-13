-- Migration 0092: G12-1 — Seed permissions catalog cho Payroll salary profile.
-- ⚠️ Chạy SAU 0091. Tiền lệ: 0019/0027/0063 (seed sau catalog).
--
-- BẤT BIẾN #3 / ADR-0010 — LƯƠNG NHẠY CẢM:
--   - is_sensitive=TRUE ⇒ permission engine KHÔNG cho kế thừa qua wildcard *:* (G3-2).
--   - Grant TAY CHỈ company-admin + hr-manager. KHÔNG seed cho wildcard, KHÔNG cho role thường
--     (project-manager / employee…) — sensitive không tự lan qua role generic.
--   - view-salary-profile  = xem lương (mask off).  manage-salary-profile = tạo/sửa/xoá-mềm lương.

INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view-salary-profile',   'salary_profile', true),
  ('manage-salary-profile', 'salary_profile', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- company-admin (00000001): toàn quyền lương (xem + quản lý). Grant TAY (sensitive không kế thừa).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type = 'salary_profile' AND p.is_sensitive = true
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- hr-manager (00000009): toàn quyền lương (xem + quản lý). Grant TAY.
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000009', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type = 'salary_profile' AND p.is_sensitive = true
ON CONFLICT DO NOTHING;
