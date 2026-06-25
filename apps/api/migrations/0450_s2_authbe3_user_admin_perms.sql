-- Migration 0450: S2-AUTH-BE-3 (🔴 RED, zone=red) — user admin API perms + status 'locked'.
--
-- MỤC TIÊU (gỡ drift permission-pair — bài học s1-fnd): /auth/users + /auth/roles + /auth/permissions
--   gate trên CẶP CANONICAL §13. Seed 0444 đã có: view/create/lock:user, view:role, view:permission
--   (grant company-admin scope Company) + ('update','user') ĐÃ trong catalog (0005) nhưng CHƯA grant.
--   THIẾU: (a) catalog 'unlock:user' (chưa có ở đâu); (b) grant update:user + unlock:user cho
--   company-admin → nếu quên, PATCH /auth/users/:id + unlock 403 (happy-path miss).
--
-- HOT-FILE §9.3 / BẤT BIẾN:
--   • THUẦN ADDITIVE data + 1 CHECK widen. KHÔNG đụng RLS/FORCE/policy/grant của mig 0005 (BẤT BIẾN #1).
--     KHÔNG db:generate (DO-block + ALTER thủ công).
--   • Catalog gap: INSERT ON CONFLICT(action,resource_type) DO NOTHING — cặp đã có KHÔNG nhân đôi.
--   • users_status_chk (mig 0002 = active|invited|suspended): DROP+ADD thêm 'locked' — GIỮ NGUYÊN giá
--     trị cũ, KHÔNG touch dữ liệu (no UPDATE rows). lock = status='locked' chặn login qua allow-list
--     status==='active' (AuthService AUTH-FIX-1) sẵn có.
--   • role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ đổi scope = DELETE
--     wrong-scope + INSERT (per-pair, mirror 0444). Idempotent đo BỘ BA (role_id,permission_id,scope).
--     App role KHÔNG có UPDATE trên role_permissions (mig 0005) → DELETE+INSERT (BẤT BIẾN #2).
--
-- BAND 0450 (lane S2-AUTH-BE-3). Journal: idx 129, when 1717500640000 (> head 0445 idx 128 /
--   1717500630000). Nối tiếp ĐƠN ĐIỆU sau 0445_s2_hrseed1_hr_perms.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) Catalog gap: 'unlock:user' (đối ngẫu lock:user). is_sensitive=false (§13 — lock/unlock không
--     nhạy cảm). ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION). create/update/view/
--     lock:user + view:role/permission ĐÃ có (0005/0444) → KHÔNG cần re-INSERT.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('unlock', 'user', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b) Widen users_status_chk thêm 'locked'. DROP+ADD (Postgres không ALTER CHECK in-place). GIỮ NGUYÊN
--     active/invited/suspended (KHÔNG xoá giá trị cũ); KHÔNG UPDATE rows. IF EXISTS để idempotent re-run.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_chk;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_status_chk
  CHECK (status IN ('active', 'invited', 'suspended', 'locked'));
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (c) Grant update:user + unlock:user → company-admin (role 0001) scope 'Company' (mirror §13 / 0444).
--     Per-pair DELETE wrong-scope + INSERT ON CONFLICT. Idempotent bộ-ba. view/create/lock:user +
--     view:role/permission ĐÃ grant ở 0444 (scope Company) → KHÔNG re-seed (chỉ 2 pair còn thiếu).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  grants CONSTANT text[][] := ARRAY[
    ['00000000-0000-0000-0000-000000000001', 'update', 'user', 'Company'],
    ['00000000-0000-0000-0000-000000000001', 'unlock', 'user', 'Company']
  ];
  g          text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY grants LOOP
    v_role_id := g[1]::uuid;
    -- role company-admin (id ổn định 0001) phải tồn tại (seed 0005). KHÔNG thì lỗi tường minh.
    PERFORM 1 FROM roles WHERE id = v_role_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[0450] role company-admin (%) không tồn tại — seed 0005 phải chạy trước', v_role_id;
    END IF;

    SELECT id INTO v_perm_id FROM permissions WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0450] permission (%:%) không có trong catalog — seed (a)/0005 phải chạy trước', g[2], g[3];
    END IF;

    -- DELETE đúng bộ (role,permission,'ALLOW') có scope SAI (per-pair, KHÔNG blanket → idempotent).
    DELETE FROM role_permissions
     WHERE role_id = v_role_id AND permission_id = v_perm_id AND effect = 'ALLOW' AND data_scope <> g[4];
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0450] grant update/unlock:user→company-admin: % INSERT mới, % re-scope', v_seeded, v_rescoped;
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DELETE FROM role_permissions rp USING permissions p
--   WHERE rp.permission_id=p.id AND rp.role_id='00000000-0000-0000-0000-000000000001'
--     AND (p.action,p.resource_type) IN (('update','user'),('unlock','user'));
-- DELETE FROM permissions WHERE (action,resource_type)=('unlock','user');
-- ALTER TABLE users DROP CONSTRAINT users_status_chk;
-- ALTER TABLE users ADD CONSTRAINT users_status_chk CHECK (status IN ('active','invited','suspended'));
