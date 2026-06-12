-- Migration 0037: G3-FIX (re-review 2026-06-09) — Seed `grant-object-permission` permission (phòng bẫy F2).
-- (Renumber: G7-merge reconcile — đặt SAU 0036_g7 vì master đã chiếm 0031; nội dung độc lập, idempotent ON CONFLICT.)
--
-- ⚠️ Vá phòng ngừa (docs/reviews/g3-gates.md §4.1): plan G3-4c yêu cầu guard cho object-permission mutation
--    `@RequirePermission('grant-object-permission', 'permission', { isSensitive: true })` — chỉ company-admin+
--    được SET object-level permission (chống privilege-escalation). Guard đã có test (permission.g3-4.spec.ts ca 14)
--    NHƯNG permission này CHƯA từng vào catalog → khi endpoint `PATCH /permissions/object` được thêm (G5/G7),
--    company-admin sẽ bị deny-default 403 OAN — đúng lỗ hổng F2 đã xảy ra ở G4 (org/team). Seed trước để tránh.
-- ⚠️ is_sensitive = TRUE: quản lý phân quyền là hành động nhạy cảm — KHÔNG kế thừa qua wildcard `*:*` (kể cả
--    super-admin), phải có ALLOW tường minh. Khớp matrix-spec §5 (permission-management = sensitive) + permMeta
--    của ca test 14. Vì requiresReauth=false → can() chỉ cần company-level explicit ALLOW (không cần object-grant).
-- ⚠️ Convention: action = 'grant-object-permission', resource_type = 'permission' (khớp decorator + spec).

-- Catalog: grant-object-permission:permission (sensitive).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('grant-object-permission', 'permission', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- Grant explicit cho company-admin (…001): chỉ company-admin được SET object-level permission.
-- (Grant 0005 của company-admin chỉ snapshot is_sensitive=false → quyền sensitive KHÔNG tự cấp; phải explicit ở đây.
--  Đây là ALLOW tường minh (non-wildcard) nên qua được sensitive-gate của can().)
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.action = 'grant-object-permission'
  AND p.resource_type = 'permission'
ON CONFLICT DO NOTHING;
