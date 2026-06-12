-- Migration 0036: G7-4c — seed catalog quyền workflow-template / workflow-instance + grant company-admin.
--
-- ⚠️ SPELLING HYPHEN (`workflow-template`, `workflow-instance`) — PHẢI khớp byte-identical với
--    @RequirePermission trong workflow-templates.controller.ts. Seed underscore = grant.resource_type
--    lệch requested resource_type ở PermissionService.can() → mãi 403 (residual §10 d342).
-- ⚠️ Catalog vs grant TÁCH: can() đọc role_permissions/object_permissions, KHÔNG tra catalog. Seed
--    catalog 1 mình KHÔNG mở khoá endpoint. 0005 grant company-admin (SELECT is_sensitive=false) chạy
--    MỘT LẦN ở idx 5 → KHÔNG hồi tố catalog row thêm sau → phải grant TAY ở đây.
-- ⚠️ KHÔNG bảng mới, KHÔNG đổi RLS/policy. permissions = catalog toàn cục (không company_id). Tất cả
--    non-sensitive (workflow-template/instance không phải secret/payroll) → wildcard hợp lệ, nhưng grant
--    explicit per-permission để admin dùng được ngay (mirror 0019/0027).

-- 1. Catalog — 5 quyền (read:workflow-template seed cho FE/tương lai; GET list/detail hiện dựa RLS).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('create',  'workflow-template', false),
  ('update',  'workflow-template', false),
  ('publish', 'workflow-template', false),
  ('read',    'workflow-template', false),
  ('apply',   'workflow-instance', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- 2. Grant cả 5 cho company-admin (001) — "Full non-sensitive management of the company" (0005:298).
--    KHÔNG grant project-manager (cấp sau qua grant-catalog runtime). KHÔNG seed manage:workflow-instance
--    (§4 d107 liệt kê nhưng không route nào dùng — YAGNI).
--    ON CONFLICT DO NOTHING bare (khớp 0005/0019/0027/0030/0031): arbiter là role_permissions_uq
--    UNIQUE(role_id, permission_id, effect). Đặt target (role_id, permission_id) sẽ ERROR "no matching
--    constraint" vì uq gồm cả effect; effect luôn 'ALLOW' ở đây → bare = idempotent đúng.
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (
  ('create',  'workflow-template'),
  ('update',  'workflow-template'),
  ('publish', 'workflow-template'),
  ('read',    'workflow-template'),
  ('apply',   'workflow-instance')
)
ON CONFLICT DO NOTHING;
