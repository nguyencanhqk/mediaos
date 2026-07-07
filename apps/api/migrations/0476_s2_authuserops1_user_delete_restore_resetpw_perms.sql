-- Migration 0476: S2-AUTH-USEROPS-1 (🔴 RED, zone=red) — catalog/grant delete·restore·reset-password:user.
--
-- MỤC TIÊU (owner-request 2026-07-07 — quản lý người dùng nâng cao trên /system/users):
--   (a) Catalog pair MỚI is_sensitive=true (privileged, wildcard *:* KHÔNG thoả cổng):
--         ('restore','user')        — khôi phục tài khoản đã xóa mềm (POST /auth/users/:id/restore)
--         ('reset-password','user') — admin đặt lại mật khẩu (POST /auth/users/:id/password/reset,
--                                     temp password + must_change_password=true mig 0469)
--   (b) NÂNG ('delete','user') is_sensitive false→true. Pair này ĐÃ tồn tại từ mig 0005 (dòng 207,
--       is_sensitive=false) và ĐÃ grant company-admin qua bulk non-sensitive (0005) + backfill
--       data_scope='Company' (mig 0441) — KHÔNG phải pair mới (plan-review 2026-07-07 phát hiện
--       INSERT-only là no-op ngầm). Xóa tài khoản = can thiệp privileged ngang restore/reset-password
--       ⇒ đồng bộ sensitive cả bộ ba (anti-escalation: wildcard *:* không mở cổng).
--       An toàn: KHÔNG controller/FE nào đang enforce/hiển thị theo delete:user trước WO này
--       (đã grep apps/ — chỉ constant chưa dùng); grant EXACT của company-admin giữ nguyên hiệu lực.
--   (c) Grant company-admin (system role) × ALLOW × scope 'Company' cho restore/reset-password
--       (delete đã có grant từ 0005/0441 — loop ON CONFLICT DO NOTHING no-op, giữ cho DB dựng mới).
--
-- ĐI KÈM CODE (cùng WO): SENSITIVE_CAPABILITY_ALLOWLIST (permission.service.ts) APPEND
--   delete:user / restore:user / reset-password:user — thiếu allowlist ⇒ getCapabilities lọc mất,
--   useCanExact false với CẢ admin (bài học S2-AUTH-CAP-2). Enforcement KHÔNG đổi.
--
-- HOT-FILE §9.3 / BẤT BIẾN (mirror mig 0466):
--   • ADDITIVE + 1 UPDATE thu hẹp có chủ đích trên catalog (delete:user sensitive-hóa — KHÔNG nới quyền,
--     chỉ SIẾT: wildcard mất hiệu lực với pair này). KHÔNG đụng RLS/FORCE/policy/grant của bảng users
--     (RLS+FORCE từ mig 0002 GIỮ NGUYÊN). KHÔNG UPDATE/backfill dữ liệu users. KHÔNG ALTER users
--     (deleted_at/deleted_by/must_change_password ĐÃ có).
--   • Catalog: INSERT ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION).
--   • role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope → INSERT
--     ON CONFLICT(role_id,permission_id,effect) DO NOTHING. App role KHÔNG có UPDATE trên
--     role_permissions (mig 0005) → seed qua DO-block (BẤT BIẾN #2).
--   • KHÔNG db:generate — SQL tay theo convention 04xx. Fail-LOUD verify cuối file (mẫu 0466/0120).
--
-- BAND 0476 (WO S2-AUTH-USEROPS-1). Journal: idx 156, when 1717500775000 (> head 0475 idx 155 /
--   1717500770000). Nối tiếp ĐƠN ĐIỆU sau 0475_s2_fndjobs1_system_jobs.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) Catalog: 2 pair MỚI is_sensitive=true. ON CONFLICT DO NOTHING (KHÔNG đụng legacy delete-user:user
--     của surface ACCT-2 mig 0430 — pair khác tên, sống song song).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('restore', 'user', true),
  ('reset-password', 'user', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b) NÂNG delete:user (mig 0005, đang false) lên is_sensitive=true — idempotent (WHERE lọc sẵn).
--     KHÔNG nới quyền: sensitive-hóa chỉ SIẾT (wildcard *:* mất hiệu lực; grant EXACT giữ nguyên).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
UPDATE permissions SET is_sensitive = true
 WHERE action = 'delete' AND resource_type = 'user' AND is_sensitive = false;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (c) Grant 3 pair → company-admin (system role, company_id NULL) scope 'Company'. Resolve role THEO
--     THUỘC TÍNH (KHÔNG hard-code id). RAISE nếu role/perm NULL. Idempotent — delete:user thường
--     ĐÃ có grant từ 0005/0441 → DO NOTHING no-op.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_role_id uuid;
  v_perm_id uuid;
  v_pair    text[];
BEGIN
  SELECT id INTO v_role_id FROM roles
   WHERE name = 'company-admin' AND company_id IS NULL AND is_system = true AND deleted_at IS NULL;
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION '[0476] role company-admin (system, company_id NULL) không tồn tại — seed 0005 phải chạy trước';
  END IF;

  FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['delete', 'user'],
    ARRAY['restore', 'user'],
    ARRAY['reset-password', 'user']
  ]
  LOOP
    SELECT id INTO v_perm_id FROM permissions
     WHERE action = v_pair[1] AND resource_type = v_pair[2];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0476] permission (%:%) không có trong catalog — bước (a)/(b) phải chạy trước',
        v_pair[1], v_pair[2];
    END IF;

    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', 'Company')
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
  END LOOP;

  RAISE NOTICE '[0476] grant delete/restore/reset-password:user → company-admin (scope Company) seeded (idempotent)';
END $$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (d) Fail-LOUD (mẫu mig 0466/0120): RAISE nếu pair KHÔNG is_sensitive=true HOẶC grant company-admin
--     thiếu sau seed. Lưu ý: grant delete:user đến từ 0005 (bulk) + 0441 (backfill Company) — verify
--     ở đây khẳng định trạng thái CUỐI, không phân biệt nguồn.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pair text[];
BEGIN
  FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['delete', 'user'],
    ARRAY['restore', 'user'],
    ARRAY['reset-password', 'user']
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM permissions WHERE action = v_pair[1] AND resource_type = v_pair[2] AND is_sensitive = true
    ) THEN
      RAISE EXCEPTION '[0476] pair (%:%) is_sensitive=true KHÔNG tồn tại sau seed — bước (a)/(b) trượt.',
        v_pair[1], v_pair[2];
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM role_permissions rp
        JOIN roles r       ON r.id = rp.role_id
        JOIN permissions p ON p.id = rp.permission_id
       WHERE r.name = 'company-admin' AND r.company_id IS NULL AND r.is_system = true
         AND r.deleted_at IS NULL
         AND p.action = v_pair[1] AND p.resource_type = v_pair[2]
         AND rp.effect = 'ALLOW' AND rp.data_scope = 'Company'
    ) THEN
      RAISE EXCEPTION '[0476] grant company-admin × %:% × ALLOW × Company KHÔNG tồn tại sau seed — bước (c) trượt.',
        v_pair[1], v_pair[2];
    END IF;
  END LOOP;
END $$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- UPDATE permissions SET is_sensitive = false WHERE (action,resource_type)=('delete','user');
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id
--     AND r.name='company-admin' AND r.company_id IS NULL AND r.is_system=true
--     AND (p.action,p.resource_type) IN (('restore','user'),('reset-password','user'))
--     AND rp.effect='ALLOW';
-- DELETE FROM permissions WHERE (action,resource_type) IN
--   (('restore','user'),('reset-password','user'));
