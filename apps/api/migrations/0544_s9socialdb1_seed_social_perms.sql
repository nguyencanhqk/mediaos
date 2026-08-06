-- Migration 0544: S9-SOCIAL-DB-1 (🔴 RED, zone=red, crown) — SEED quyền cho app vệ tinh SOCIAL
--   (fbpost — đăng bài Facebook Page): 3 cặp + grant per-(role,pair) theo DECISIONS-08 §3
--   `SOCIAL-DEC-006`. THUẦN DATA — mirror 0527. KHÔNG db:generate. KHÔNG đụng audit (tách sang 0545).
--
-- BỐI CẢNH (seed qua migrator owner-bypass — mirror 0506/0527):
--   migrator chạy DATABASE_DIRECT_URL = role owner mediaos (rolbypassrls) ⇒ INSERT permissions (global) +
--   role_permissions (system role company_id NULL) chạy TRỰC TIẾP. RLS chỉ chặn app role runtime.
--
-- QUYẾT ĐỊNH CHỐT (DECISIONS-08 §3 SOCIAL-DEC-006):
--   Token Page là TÀI SẢN CÔNG TY, không phải công cụ cá nhân ⇒ KHÔNG cấp đại trà.
--     ('view',  'social-post')    → company-admin (Company). Xem bài đã đăng/đang hẹn giờ.
--     ('create','social-post')    → company-admin (Company). Soạn · hẹn giờ · đăng.
--     ('manage','social-account') → company-admin (Company). Kết nối/gỡ tài khoản FB, quản lý Page.
--   employee/manager/hr KHÔNG có cặp nào — least privilege. Khi công ty có role marketing riêng thì
--   grant thêm bằng migration SAU (append), KHÔNG nới ở đây.
--
--   ⚠️ VÌ SAO KHÔNG grant cho 'manager' như các wave khác: fbpost KHÔNG có khái niệm phòng ban —
--   nó chỉ có một danh sách Page dùng chung. `data_scope='Department'` vì thế VÔ NGHĨA ở đây: engine
--   sẽ cấp scope Department nhưng app vệ tinh không có gì để lọc theo, tức thực tế = Company. Cấp một
--   scope mà bên nhận không thi hành được là cấp quyền rộng hơn mình tưởng — nên chỉ cấp cho
--   company-admin, một scope duy nhất, không mơ hồ.
--
--   is_sensitive: ('manage','social-account') = TRUE — cặp này chi phối credential bên thứ ba (App
--   Secret + User Token + Page Token). FE phải gate bằng `useCanExact` chứ KHÔNG phải `useCan`
--   (memory sensitive-capability-allowlist-is-backend). Hai cặp còn lại = false.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§9):
--   #2 role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ đổi scope = DELETE
--      đúng bộ (role_id,permission_id,'ALLOW') scope SAI (per-pair, KHÔNG blanket/CROSS JOIN —
--      memory blanket-grant-migration-role-drift) + INSERT ON CONFLICT DO NOTHING.
--      permissions seed ON CONFLICT(action,resource_type) DO NOTHING.
--   • Idempotent: chạy lại KHÔNG nhân đôi, KHÔNG đổi count.
--   • resource_type dùng GẠCH-NỐI ('social-post') — KHÁC audit object_type dùng gạch-dưới
--     ('social_sso', migration 0545). Hai danh mục khác nhau, đừng đồng nhất.
--
-- BAND 0544 (lane S9-SOCIAL-DB-1). Journal: idx 211, when 1717587333000 (> 0543 idx 210 / 1717587332000).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) Catalog 3 cặp. ON CONFLICT DO NOTHING (hot-file: append, không rewrite) ──
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view',   'social-post',    false),  -- SOCIAL.POST.VIEW
  ('create', 'social-post',    false),  -- SOCIAL.POST.CREATE
  ('manage', 'social-account', true)    -- SOCIAL.ACCOUNT.MANAGE — chi phối credential bên thứ ba
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── (2) Grant per-(role,pair) — resolve role THEO THUỘC TÍNH, không hard-code id ──
DO $$
DECLARE
  social_grants CONSTANT text[][] := ARRAY[
    ['company-admin', 'view',   'social-post',    'Company'],
    ['company-admin', 'create', 'social-post',    'Company'],
    ['company-admin', 'manage', 'social-account', 'Company']
  ];
  g          text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY social_grants LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0544] role canonical % không tồn tại — seed 0005/0444 phải chạy trước', g[1];
    END IF;

    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0544] permission (%:%) không có trong catalog — bước (1) phải chạy trước', g[2], g[3];
    END IF;

    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> g[4];
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0544] social grants: % INSERT mới, % re-scope (company-admin = 3 hàng)',
    v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (3) VERIFY fail-LOUD (RAISE EXCEPTION — mirror 0527): 3 cặp tồn tại đúng is_sensitive · đúng 3 grant
--     canonical · đều scope Company · employee/manager/hr KHÔNG có gì. Idempotent: chạy lại PASS.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_n int;
BEGIN
  -- (a) 3 cặp tồn tại
  SELECT COUNT(*) INTO v_n
    FROM permissions
   WHERE (action, resource_type) IN
         (('view','social-post'), ('create','social-post'), ('manage','social-account'));
  IF v_n <> 3 THEN
    RAISE EXCEPTION '[0544] verify: kỳ vọng 3 cặp social trong catalog, có % — bước (1) trượt', v_n;
  END IF;

  -- (b) ('manage','social-account') PHẢI is_sensitive=true — FE gate bằng useCanExact dựa vào cờ này.
  --     Nếu cờ sai thì màn quản lý tài khoản Facebook lọt qua cổng thường (memory
  --     capability-allowlist-hides-admin-screens: super-admin có `*:*` nên test bằng SA KHÔNG tái hiện được).
  SELECT COUNT(*) INTO v_n
    FROM permissions
   WHERE action = 'manage' AND resource_type = 'social-account' AND is_sensitive = true;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0544] verify: (manage:social-account) phải is_sensitive=true — đang KHÔNG phải';
  END IF;

  -- (c) hai cặp post KHÔNG sensitive (tránh gate quá tay làm ẩn màn soạn bài của chính người được cấp)
  SELECT COUNT(*) INTO v_n
    FROM permissions
   WHERE resource_type = 'social-post' AND is_sensitive = true;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0544] verify: cặp social-post KHÔNG được is_sensitive (đang có % cặp bật cờ)', v_n;
  END IF;

  -- (d) tổng ĐÚNG 3 grant ALLOW trên 4 role canonical (chống over/under-grant)
  SELECT COUNT(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name IN ('employee', 'manager', 'hr', 'company-admin')
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW'
     AND p.resource_type IN ('social-post', 'social-account');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '[0544] verify: % grant social cho 4 role canonical, kỳ vọng 3 — over/under-grant', v_n;
  END IF;

  -- (e) cả 3 đều thuộc company-admin và đều scope Company
  SELECT COUNT(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name = 'company-admin' AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW' AND rp.data_scope = 'Company'
     AND p.resource_type IN ('social-post', 'social-account');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '[0544] verify: company-admin có % grant social scope=Company, kỳ vọng 3', v_n;
  END IF;

  -- (f) employee/manager/hr KHÔNG có gì (SOCIAL-DEC-006 — không cấp đại trà)
  SELECT COUNT(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name IN ('employee', 'manager', 'hr')
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW'
     AND p.resource_type IN ('social-post', 'social-account');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0544] verify: employee/manager/hr CÓ % grant social — vỡ SOCIAL-DEC-006', v_n;
  END IF;

  RAISE NOTICE '[0544] verify PASS: 3 cặp social + 3 grant company-admin (Company), role khác = 0';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM role_permissions rp USING permissions p
--   WHERE rp.permission_id = p.id AND p.resource_type IN ('social-post', 'social-account');
-- DELETE FROM permissions WHERE resource_type IN ('social-post', 'social-account');
