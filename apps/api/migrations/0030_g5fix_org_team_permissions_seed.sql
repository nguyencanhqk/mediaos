-- Migration 0030: G5-FIX F2 (ORG-002/003) — Seed `manage` permission cho org_unit + team.
--
-- ⚠️ Vá lỗ hổng: OrgController mutations (create/update/delete org_unit + team, leader, member) bị fail-closed
--    sau PermissionGuard với @RequirePermission('manage', <resource>), NHƯNG catalog chưa từng có 2 quyền này
--    → mọi mutation bị deny-default 403 KỂ CẢ company-admin/hr-manager hợp lệ. File này seed + grant chúng.
-- ⚠️ Convention: action = bare verb 'manage' + resource_type riêng (khớp 0005/0019/0027), KHÔNG dùng action
--    ghép kiểu 'manage-org-unit'. permissions.can() khớp theo cặp (action, resource_type).
-- ⚠️ Non-sensitive (is_sensitive=false): cấu trúc tổ chức là dữ liệu nội bộ, RLS đã cô lập theo tenant.

-- Catalog: manage org_unit + manage team (non-sensitive).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('manage', 'org_unit', false),
  ('manage', 'team',     false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- Grant cho company-admin (…001): quản trị toàn bộ cơ cấu tổ chức.
-- (Grant 0005 của company-admin là snapshot 1 lần theo is_sensitive=false → quyền thêm sau KHÔNG tự cấp;
--  phải grant explicit ở đây, đúng như 0019 đã làm cho employee/position.)
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.action = 'manage'
  AND p.resource_type IN ('org_unit', 'team')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Grant cho hr-manager (…009): HR quản lý phòng/khối + team/nhân sự.
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000009', p.id, 'ALLOW'
FROM permissions p
WHERE p.action = 'manage'
  AND p.resource_type IN ('org_unit', 'team')
ON CONFLICT DO NOTHING;
