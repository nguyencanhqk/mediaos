-- 0508_lms_access_permission — cổng SSO "Đào tạo (LMS)" do hệ PHÂN QUYỀN MediaOS quản lý.
-- Thêm 1 pair catalog access:lms (is_sensitive=false ⇒ getCapabilities expose cho FE gate card +
-- BE PermissionGuard), grant ALLOW/'Own' cho 4 role canonical (mặc định BẬT cho mọi nhân viên —
-- admin THU HỒI được per-role qua ma trận §13). LMS KHÔNG phải module nội bộ (SSO integration) →
-- KHÔNG thêm row `modules`. Hot-file UNION (§9.3), idempotent. Mẫu: 0495 (ME).

-- ─────────────── (A) Catalog 1 pair. ON CONFLICT(action,resource_type) DO NOTHING ───────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('access', 'lms', false)  -- LMS.ACCESS — mở hệ Đào tạo qua SSO (cổng nav, non-sensitive)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── (B) Grant scope 'Own' × 4 role canonical (§13 per-role). Mẫu DO-block 0495 ──────
--     resolve role THEO THUỘC TÍNH (name + company_id IS NULL + deleted_at IS NULL — KHÔNG hard-code id,
--     KHÔNG blanket INSERT...SELECT) → per-pair DELETE-wrong-scope → INSERT ON CONFLICT DO NOTHING.
--     UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ đổi scope = DELETE+INSERT. Idempotent.
DO $$
DECLARE
  roles_arr CONSTANT text[] := ARRAY['employee', 'manager', 'hr', 'company-admin'];
  r_name    text;
  v_role_id uuid;
  v_perm_id uuid;
  v_seeded  int := 0;
  v_del     int;
BEGIN
  SELECT id INTO v_perm_id FROM permissions WHERE action = 'access' AND resource_type = 'lms';
  IF v_perm_id IS NULL THEN
    RAISE EXCEPTION '[0508] permission access:lms không có trong catalog — bước (A) trượt';
  END IF;

  FOREACH r_name IN ARRAY roles_arr LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = r_name AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0508] role canonical % không tồn tại — seed 0005/0444 phải chạy trước', r_name;
    END IF;

    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> 'Own';

    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', 'Own')
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0508] LMS access grants: % INSERT mới (4 role @ Own)', v_seeded;
END;
$$;
--> statement-breakpoint

-- ─────────────── (C) Verify fail-LOUD (mẫu 0495): ĐÚNG 1 pair + ĐÚNG 4 grant Own ────────────────
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM permissions WHERE action = 'access' AND resource_type = 'lms';
  IF v_n <> 1 THEN RAISE EXCEPTION '[0508] verify: pair access:lms phải =1, thấy %', v_n; END IF;

  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    JOIN roles r       ON r.id = rp.role_id
   WHERE p.action = 'access' AND p.resource_type = 'lms'
     AND rp.effect = 'ALLOW' AND rp.data_scope = 'Own'
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND r.name IN ('employee', 'manager', 'hr', 'company-admin');
  IF v_n <> 4 THEN RAISE EXCEPTION '[0508] verify: phải 4 grant Own cho access:lms, thấy %', v_n; END IF;
END;
$$;
