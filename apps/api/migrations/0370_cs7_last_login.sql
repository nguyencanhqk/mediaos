-- Migration 0370: CS-7 Tình hình sử dụng — last_login_at + view-usage:company permission.
-- Gate: LIGHT (typescript-reviewer + quality-gate). Additive nullable column — zero downtime.
--
-- BAND 0370-0379 (lane cs7). Journal: idx 106, when 1717500410000 (> high-water 400000 = 0347_ac9_export_worker).
--
-- MỤC TIÊU:
--   1. Thêm users.last_login_at timestamptz NULL (additive nullable, KHÔNG rewrite existing rows).
--   2. GRANT UPDATE (last_login_at) ON users TO mediaos_app — chỉ cột này, tối thiểu privilege.
--   3. Seed permission view:usage (resource_type='company', is_sensitive=FALSE — không nhạy cảm).
--   4. Grant view:usage company → system-admin role (00000000-0000-0000-0000-000000000001 = company-admin).
--
-- BẤT BIẾN: #1 company_id + RLS trên mọi query usage (withTenant); #2 không hard-delete; #3 không secret.
-- last_login_at là stats tốt nhất — KHÔNG fail đăng nhập nếu write lỗi (auth.service ghi best-effort + log).
-- RLS: users đã có policy *_tenant_iso (mig 0002) — UPDATE mediaos_app qua withTenant ÉP company_id đúng.

-- ── 1. Thêm cột last_login_at vào users ──────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
--> statement-breakpoint

-- ── 2. Mở rộng UPDATE grant tối thiểu — CHỈ cột last_login_at (KHÔNG toàn bảng) ─────────────────
GRANT UPDATE (last_login_at) ON users TO mediaos_app;
--> statement-breakpoint

-- ── 3. Seed permission view:usage (is_sensitive=FALSE — không wildcard-chặn, không yêu cầu step-up) ──
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view', 'usage', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ── 4. Grant view:usage → system-admin (company-admin, id …0001) ────────────────────────────────
-- Không grant toàn bộ (KHÔNG wildcard *:*). Tường minh theo resource_type.
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) = ('view', 'usage')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- -------- Down (manual) --------
-- DELETE FROM role_permissions WHERE permission_id IN
--   (SELECT id FROM permissions WHERE (action, resource_type) = ('view', 'usage'));
-- DELETE FROM permissions WHERE (action, resource_type) = ('view', 'usage');
-- REVOKE UPDATE (last_login_at) ON users FROM mediaos_app;
-- ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;
