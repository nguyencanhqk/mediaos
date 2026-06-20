-- Migration 0430: ACCT-2 (🔴 sensitive) — quyền quản trị user: suspend + soft-delete.
--
-- BAND 0430-0439 (lane acct2). idx/when set lúc LAND (> master max idx 112 / when 1717500470000).
-- Re-stamp mỗi rebase.
--
-- MỤC TIÊU: admin CRUD user (apps/api/src/users/admin-users.*) cần 2 quyền NHẠY CẢM:
--   - suspend:user      — tạm khoá / mở khoá tài khoản (suspend + reactivate).
--   - delete-user:user  — xoá-mềm tài khoản (set deleted_at, KHÔNG hard-delete — BẤT BIẾN #2).
--
-- BẤT BIẾN / lý do is_sensitive=TRUE:
--   #3 (gián tiếp) — cổng nhạy cảm: permission engine KHÔNG cho kế thừa qua wildcard '*:*' (G3-2). Khai
--      is_sensitive=TRUE ở CẢ seed (đây) LẪN @RequirePermission(isSensitive:true) ở controller → user có
--      '*:*' (vd super-role lỏng) vẫn KHÔNG suspend/xoá được nếu thiếu ALLOW tường minh (mẫu CS-10/G13).
--   manage:user (đã seed 0005, is_sensitive=FALSE) đủ cho list/get/update (không nhạy cảm).
--
-- KHÔNG đụng:
--   - users_status_chk (mig 0002 đã có 'active'/'suspended') → status hợp lệ sẵn, KHÔNG ALTER.
--   - audit_logs object_type CHECK ('user' đã có sẵn từ 0003) → KHÔNG sửa.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Permission seed: suspend:user + delete-user:user (is_sensitive=TRUE). ON CONFLICT DO NOTHING (hot-file).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('suspend', 'user', true),
  ('delete-user', 'user', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Grant company-admin (role 0001) tường minh (non-wildcard ALLOW) → qua được sensitive-gate của can().
-- 0005 seed company-admin = MỌI non-sensitive qua "WHERE is_sensitive=false" → KHÔNG phủ 2 quyền này.
-- ON CONFLICT DO NOTHING (idempotent / hot-file).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (('suspend', 'user'), ('delete-user', 'user'))
ON CONFLICT DO NOTHING;

-- -------- Down (manual) --------
-- DELETE FROM role_permissions WHERE permission_id IN
--   (SELECT id FROM permissions WHERE resource_type='user' AND action IN ('suspend','delete-user'));
-- DELETE FROM permissions WHERE resource_type='user' AND action IN ('suspend','delete-user');
