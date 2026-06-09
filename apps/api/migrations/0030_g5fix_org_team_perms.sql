-- Migration 0030: G5-FIX F2 — Seed permission catalog cho Org unit + Team guards.
-- Gate: FULL (security-reviewer + database-reviewer). Bổ sung quyền cho OrgController (org.controller.ts)
-- vốn KHÔNG có @RequirePermission ở G5 → mọi user đăng nhập tạo/sửa/xoá phòng ban/team, đổi leader
-- (vi phạm ORG-002/003 + bất biến "API nhạy cảm check permission" — CLAUDE §5).
--
-- ⚠️ resource_type 'org_unit' ĐỒNG BỘ với:
--      • bảng org_units (db/schema/org.ts)
--      • audit_logs_object_type_chk ('org_unit','team' — migration 0014)
--    (catalog 0005 chỉ có resource 'department' legacy — KHÔNG dùng cho guard G5.)
--    'team' permissions ĐÃ có ở 0005:199-203 → ON CONFLICT bảo vệ; ở đây chỉ bảo đảm self-contained + grants.
-- ⚠️ is_sensitive=false: quản trị cơ cấu tổ chức là CRUD thường, KHÔNG sensitive
--    (khác view-salary/reveal-secret → không cần explicit non-wildcard ALLOW / re-auth).
-- ⚠️ Journal: idx 31 / when 1717500034000 (> max-applied 1717500033000) → migrator KHÔNG skip.

-- 1. Seed org_unit permissions (catalog mới — 0005 chỉ có 'department', không có 'org_unit').
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('create', 'org_unit', false),
  ('read',   'org_unit', false),
  ('update', 'org_unit', false),
  ('delete', 'org_unit', false),
  ('manage', 'org_unit', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- 2. team permissions đã tồn tại (0005:199-203); INSERT idempotent để migration tự đủ (self-contained).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('create', 'team', false),
  ('read',   'team', false),
  ('update', 'team', false),
  ('delete', 'team', false),
  ('manage', 'team', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- 3. Grant org_unit + team (non-sensitive) cho company-admin (…001).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type IN ('org_unit', 'team')
  AND p.is_sensitive = false
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 4. Grant org_unit + team (non-sensitive) cho hr-manager (…009, seed ở 0019) —
--    HR quản trị cơ cấu tổ chức/đội nhóm (PRD: ORG-002/003 thuộc HR & Admin).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000009', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type IN ('org_unit', 'team')
  AND p.is_sensitive = false
ON CONFLICT DO NOTHING;

-- -------- Down (manual — migrator node-postgres không chạy down tự động) --------
-- DELETE FROM role_permissions
--   WHERE role_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000009')
--     AND permission_id IN (SELECT id FROM permissions WHERE resource_type = 'org_unit');
-- DELETE FROM permissions WHERE resource_type = 'org_unit';
-- (team permissions thuộc 0005 — KHÔNG xoá ở down của 0030; grant team cho …001/…009 có thể xoá thủ công nếu cần.)
