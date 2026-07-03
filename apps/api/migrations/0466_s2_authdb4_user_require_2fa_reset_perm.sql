-- Migration 0466: S2-AUTH-DB-4 (🔴 RED, zone=red) — cột users.require_two_factor + catalog/grant reset-2fa:user.
--
-- MỤC TIÊU:
--   (a) users.require_two_factor boolean NOT NULL DEFAULT false — cờ ép 2FA PER-USER (bổ sung cho
--       roles.requires_two_factor ở mig 0120 = ép theo ROLE). KHÔNG backfill (mọi user mặc định false).
--   (b) Catalog pair CANONICAL §13: ('reset-2fa','user', is_sensitive=true) — admin reset/gỡ 2FA của user
--       khác (thao tác privileged). Nền cho object-grant + guard 403 ở WO backend gắn endpoint sau.
--   (c) Grant company-admin (system role 0001) × reset-2fa:user × ALLOW × scope 'Company'.
--
-- HOT-FILE §9.3 / BẤT BIẾN:
--   • THUẦN ADDITIVE. KHÔNG đụng RLS/FORCE/policy/grant/RLS của bảng users (BẤT BIẾN #1 — users đã có
--     RLS+FORCE từ mig 0002, GIỮ NGUYÊN). KHÔNG câu UPDATE/backfill nào trên users.
--   • Catalog: INSERT ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION — pair đã có KHÔNG nhân đôi).
--   • role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope (memory §13) → INSERT
--     ON CONFLICT(role_id,permission_id,effect) DO NOTHING. Pair MỚI ⇒ không có grant cũ để re-scope.
--     App role KHÔNG có UPDATE trên role_permissions (mig 0005) → seed qua DO-block (BẤT BIẾN #2).
--   • KHÔNG db:generate — viết SQL tay (DO-block + ALTER thủ công) theo convention 04xx.
--   • Fail-LOUD: RAISE EXCEPTION nếu pair HOẶC grant không tồn tại sau seed (mẫu mig 0120 dòng 90-98) →
--     tránh âm thầm trượt seed khi role bị đổi tên ở migration tương lai.
--
-- BAND 0466 (lane S2-AUTH-DB-4). Journal: idx 146, when 1717500725000 (> head 0465 idx 145 /
--   1717500720000). Nối tiếp ĐƠN ĐIỆU sau 0465_s2_hrbe6_contract_scope_fix.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) users.require_two_factor — cờ ép 2FA PER-USER. NOT NULL DEFAULT false ⇒ mọi user hiện có nhận
--     false qua DEFAULT (KHÔNG câu UPDATE riêng). KHÔNG đụng RLS/FORCE/policy/grant users (BẤT BIẾN #1).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN require_two_factor boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b) Catalog gap: 'reset-2fa':'user' (is_sensitive=true — privileged, ép object-grant tương lai).
--     ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('reset-2fa', 'user', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (c) Grant reset-2fa:user → company-admin (system role, company_id NULL) scope 'Company'. Resolve role
--     THEO THUỘC TÍNH (name + company_id IS NULL + is_system + deleted_at IS NULL) — KHÔNG hard-code id.
--     RAISE nếu role/perm NULL. INSERT ON CONFLICT(role_id,permission_id,effect) DO NOTHING (idempotent).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_role_id uuid;
  v_perm_id uuid;
BEGIN
  SELECT id INTO v_role_id FROM roles
   WHERE name = 'company-admin' AND company_id IS NULL AND is_system = true AND deleted_at IS NULL;
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION '[0466] role company-admin (system, company_id NULL) không tồn tại — seed 0005 phải chạy trước';
  END IF;

  SELECT id INTO v_perm_id FROM permissions
   WHERE action = 'reset-2fa' AND resource_type = 'user';
  IF v_perm_id IS NULL THEN
    RAISE EXCEPTION '[0466] permission (reset-2fa:user) không có trong catalog — bước (b) phải chạy trước';
  END IF;

  INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
  VALUES (v_role_id, v_perm_id, 'ALLOW', 'Company')
  ON CONFLICT (role_id, permission_id, effect) DO NOTHING;

  RAISE NOTICE '[0466] grant reset-2fa:user → company-admin (scope Company) seeded (idempotent)';
END $$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (d) Fail-LOUD (mẫu mig 0120 dòng 90-98): RAISE nếu pair HOẶC grant company-admin không tồn tại sau
--     seed — tránh âm thầm trượt catalog/grant (vd role bị đổi tên ở migration tương lai).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM permissions WHERE action = 'reset-2fa' AND resource_type = 'user'
  ) THEN
    RAISE EXCEPTION '[0466] pair (reset-2fa:user) KHÔNG tồn tại sau seed — bước (b) trượt.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM role_permissions rp
      JOIN roles r       ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r.name = 'company-admin' AND r.company_id IS NULL AND r.is_system = true
       AND r.deleted_at IS NULL
       AND p.action = 'reset-2fa' AND p.resource_type = 'user'
       AND rp.effect = 'ALLOW' AND rp.data_scope = 'Company'
  ) THEN
    RAISE EXCEPTION '[0466] grant company-admin × reset-2fa:user × ALLOW × Company KHÔNG tồn tại sau seed — bước (c) trượt.';
  END IF;
END $$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id
--     AND r.name='company-admin' AND r.company_id IS NULL AND r.is_system=true
--     AND (p.action,p.resource_type)=('reset-2fa','user') AND rp.effect='ALLOW';
-- DELETE FROM permissions WHERE (action,resource_type)=('reset-2fa','user');
-- ALTER TABLE users DROP COLUMN IF EXISTS require_two_factor;
