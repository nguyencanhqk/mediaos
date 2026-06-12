-- Migration 0031: G5-FIX F4 — Đảm bảo permission 'manage.position' tồn tại + được grant.
-- Gate: FULL (security-reviewer). positions.service.ts gác việc gán default_role_id bằng action
-- 'manage.position' (resource 'position'). Trước fix, createPosition set default_role_id KHÔNG gác →
-- bypass leo thang quyền (gán role mặc định cho chức vụ mà không có manage.position).
--
-- ⚠️ 'manage.position'/'position' ĐÃ seed ở 0019:12 và đã grant cho company-admin + hr-manager
--    (0019:43-48 grant mọi position non-sensitive cho …001; 0019:69-75 cho …009). File này IDEMPOTENT:
--    bảo đảm self-contained + grant đúng 2 role được phép gán default role. ON CONFLICT DO NOTHING.
-- ⚠️ Dùng action 'manage.position' (DẤU CHẤM) — khớp permissions.catalog 0019 + positions.service.ts.
--    KHÔNG tạo biến thể 'manage-position' (gạch ngang) → sẽ là permission rời, không role nào có → luôn 403.
-- ⚠️ is_sensitive=false: gán default role là RBAC admin, không thuộc lớp re-auth (reveal-secret).
-- ⚠️ Journal: idx 32 / when 1717500035000 (> 1717500034000) → migrator KHÔNG skip.

-- 1. Ensure manage.position tồn tại (idempotent — đã có ở 0019:12).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('manage.position', 'position', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- 2. Grant manage.position cho company-admin (…001).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.action = 'manage.position' AND p.resource_type = 'position'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 3. Grant manage.position cho hr-manager (…009).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000009', p.id, 'ALLOW'
FROM permissions p
WHERE p.action = 'manage.position' AND p.resource_type = 'position'
ON CONFLICT DO NOTHING;

-- -------- Down (manual) --------
-- DELETE FROM role_permissions
--   WHERE permission_id = (SELECT id FROM permissions WHERE action='manage.position' AND resource_type='position')
--     AND role_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000009');
-- (KHÔNG xoá permission 'manage.position' — thuộc 0019.)
