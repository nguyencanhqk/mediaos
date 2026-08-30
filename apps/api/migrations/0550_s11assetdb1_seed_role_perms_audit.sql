-- Migration 0550: S11-ASSET-DB-1 (🔴 RED, zone=red, crown) — SEED nghiệp vụ ASSET (DB-15 §9 bước B):
--   role hệ thống `asset-manager` + 11 cặp quyền + 28 grant per-(role,pair) theo ma trận §9d +
--   UNION-ADD 5 giá trị vào CHECK audit_logs.object_type. THUẦN DATA/DDL-CHECK — KHÔNG db:generate.
--
-- BỐI CẢNH (seed qua migrator owner-bypass — mirror 0506:6-11):
--   migrator chạy DATABASE_DIRECT_URL = role owner (rolbypassrls) ⇒ INSERT roles/permissions (global) +
--   role_permissions chạy TRỰC TIẾP. RLS chỉ chặn app role runtime.
--
-- QUYẾT ĐỊNH CHỐT (plan docs/plans/S11-ASSET-DB-1.md §1/§3):
--   D1 modules.ASSET ĐÃ TỒN TẠI từ 0435:297 (Extension, is_active=false). KHÔNG INSERT, KHÔNG BẬT — tiền lệ
--      0538 (CHAT): bật cờ khi chưa có endpoint = hứa suông (ui-promises-backend-never-reads); pin
--      migration-smoke EXTENSION_INACTIVE_MODULES giữ ASSET. Chỉ verify hàng tồn tại. Bật ở S11-ASSET-FE-1.
--   D2 role `asset-manager`: company_id NULL, is_system=true, requires_two_factor=false TƯỜNG MINH, id cố định
--      …0012 (…0011 = hr, …00f0 = platform-admin; tiền lệ 0019 hr-manager). KHÔNG canonical — không vào
--      DashCanonicalRole/NOTI_CANONICAL_ROLES/pin auth-seed-canonical-roles. Role CỘNG THÊM: không có cặp ME /
--      (read,dashboard) — user chỉ mang role này không mở được /me (pin EXACT-SET dash-seed2 giữ 12 role).
--   D3 11 cặp is_sensitive=false cả 11 (SPEC-13 §11 — trường tài chính che ở service theo scope, không cặp nhạy cảm).
--   D4 ma trận 28 hàng (§9d): employee 2 · manager 2 · hr 2 · company-admin 11 · asset-manager 11.
--   D5 audit CHECK: clone NGUYÊN khối 0545 (neo 2 tầng `object_type = ANY(…)`, fail-closed, NO-LOSS/NO-GAIN) —
--      KHÔNG clone 0506 bước 4 (parser chưa neo tầng-1 — audit-check-union-parse-anchor-trap). DB-15 §9B/SPEC-13
--      đã đính chính cùng PR. 5 giá trị: asset · asset_category · asset_assignment · asset_maintenance ·
--      asset_inventory (KHÔNG asset_inventory_item — gom dưới aggregate asset_inventory, object_id = inventory_id).
--
-- BẤT BIẾN / HOT-FILE:
--   #2 role_permissions UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ đổi scope = DELETE đúng bộ
--      scope SAI (per-pair, KHÔNG blanket) + INSERT ON CONFLICT DO NOTHING. CHECK audit: UNION ADD-only.
--      permissions/roles seed ON CONFLICT DO NOTHING. super-admin KHÔNG enumerate (bootstrap runtime).
--   • Mọi câu đếm role NEO `company_id IS NULL AND deleted_at IS NULL` (0506:215) — role tenant trùng tên
--     'hr'/'manager' không được thổi số.
--
-- BAND 0550 (lane S11-ASSET-DB-1). Journal: idx 217, when 1717587339000 (> 0549 idx 216 / 1717587338000).
--   AUDIT_OBJECT_TYPES (schema/audit.ts) sync 5 giá trị CÙNG commit.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) modules.ASSET: verify tồn tại, GIỮ is_active=false (mirror 0538:392-400) ───────────────
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM modules WHERE module_code = 'ASSET' AND deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0550] modules.ASSET khong ton tai (ky vong 1 hang tu mig 0435, dem duoc %)', v_n;
  END IF;
  -- KHÔNG assert is_active ở đây (xem ghi chú forward-compat ở khối verify (e) cuối file): 0556 bật cờ,
  -- và khối này bị CHẠY LẠI bởi ca idempotency H1.
  RAISE NOTICE '[0550] modules.ASSET ton tai (0550 KHONG bat co; S11-ASSET-FE-1/mig 0556 moi bat)';
END;
$$;
--> statement-breakpoint

-- ─────────────── (2) Role hệ thống asset-manager (tiền lệ 0019 hr-manager; bare ON CONFLICT hợp lệ với partial unique) ─
INSERT INTO roles (id, company_id, name, description, is_system, requires_two_factor) VALUES
  ('00000000-0000-0000-0000-000000000012', NULL, 'asset-manager',
   'Asset Manager: quản lý tài sản toàn công ty — danh mục, cấp phát/thu hồi, bảo trì, kiểm kê, thanh lý (SPEC-01 §10.8)',
   true, false)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ─────────────── (3) Catalog 11 cặp quyền ASSET, is_sensitive=false (SPEC-13 §11 / permission-matrix §9d) ───────
--     Mã dotted ASSET.* chỉ ghi ở COMMENT — bảng permissions CHỈ có (action, resource_type, is_sensitive).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('access',  'asset',             false),  -- ASSET.ACCESS            cổng nav
  ('view',    'asset',             false),  -- ASSET.ASSET.VIEW        xem loại/tài sản/lịch sử/đợt/thống kê + /me/assets
  ('create',  'asset',             false),  -- ASSET.ASSET.CREATE
  ('update',  'asset',             false),  -- ASSET.ASSET.UPDATE      sửa mô tả (không đổi status/asset_code)
  ('delete',  'asset',             false),  -- ASSET.ASSET.DELETE      xoá mềm hồ sơ nhập nhầm
  ('assign',  'asset',             false),  -- ASSET.ASSIGNMENT.CREATE cấp phát
  ('revoke',  'asset',             false),  -- ASSET.ASSIGNMENT.REVOKE thu hồi
  ('dispose', 'asset',             false),  -- ASSET.ASSET.DISPOSE     thanh lý · mất · tìm thấy lại
  ('manage',  'asset-category',    false),  -- ASSET.CATEGORY.MANAGE
  ('manage',  'asset-maintenance', false),  -- ASSET.MAINTENANCE.MANAGE
  ('manage',  'asset-inventory',   false)   -- ASSET.INVENTORY.MANAGE
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── (4) Grant per-(role, pair) ma trận §9d = 28 hàng (mirror 0506 bước 3) ───────────────
DO $$
DECLARE
  asset_grants CONSTANT text[][] := ARRAY[
    -- employee: access + view @Own
    ['employee',      'access',  'asset',             'Own'],
    ['employee',      'view',    'asset',             'Own'],
    -- manager: access @Own + view @Department
    ['manager',       'access',  'asset',             'Own'],
    ['manager',       'view',    'asset',             'Department'],
    -- hr: access @Own + view @Company (chỉ đọc)
    ['hr',            'access',  'asset',             'Own'],
    ['hr',            'view',    'asset',             'Company'],
    -- company-admin: cả 11 (access @Own, còn lại @Company)
    ['company-admin', 'access',  'asset',             'Own'],
    ['company-admin', 'view',    'asset',             'Company'],
    ['company-admin', 'create',  'asset',             'Company'],
    ['company-admin', 'update',  'asset',             'Company'],
    ['company-admin', 'delete',  'asset',             'Company'],
    ['company-admin', 'assign',  'asset',             'Company'],
    ['company-admin', 'revoke',  'asset',             'Company'],
    ['company-admin', 'dispose', 'asset',             'Company'],
    ['company-admin', 'manage',  'asset-category',    'Company'],
    ['company-admin', 'manage',  'asset-maintenance', 'Company'],
    ['company-admin', 'manage',  'asset-inventory',   'Company'],
    -- asset-manager: cả 11 (như company-admin)
    ['asset-manager', 'access',  'asset',             'Own'],
    ['asset-manager', 'view',    'asset',             'Company'],
    ['asset-manager', 'create',  'asset',             'Company'],
    ['asset-manager', 'update',  'asset',             'Company'],
    ['asset-manager', 'delete',  'asset',             'Company'],
    ['asset-manager', 'assign',  'asset',             'Company'],
    ['asset-manager', 'revoke',  'asset',             'Company'],
    ['asset-manager', 'dispose', 'asset',             'Company'],
    ['asset-manager', 'manage',  'asset-category',    'Company'],
    ['asset-manager', 'manage',  'asset-maintenance', 'Company'],
    ['asset-manager', 'manage',  'asset-inventory',   'Company']
  ];
  g          text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY asset_grants LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0550] role he thong % khong ton tai — seed 0005/0444/(2) phai chay truoc', g[1];
    END IF;

    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0550] permission (%:%) khong co trong catalog — buoc (3) phai chay truoc', g[2], g[3];
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

  RAISE NOTICE '[0550] ASSET grants: % INSERT moi, % re-scope (5 role x ma tran §9d = 28 hang)', v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ─────────────── (5) CHECK audit_logs.object_type += 5 giá trị — CLONE NGUYÊN KHỐI 0545 (neo 2 tầng) ───────────────
DO $$
DECLARE
  v_oid     oid;
  v_con     text;
  v_def     text;
  v_raw     text;
  v_matched boolean := false;
  v_cnt     int;
  v_cur     text[];
  v_new     text[] := ARRAY['asset', 'asset_category', 'asset_assignment', 'asset_maintenance', 'asset_inventory'];
  v_add     text[];
  v_union   text[];
  v_after   text[];
  v_missing text[];
  v_extra   text[];
BEGIN
  -- ── (0) Fail fast thay vì xếp hàng sau lock ──
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── (1) Resolve CHECK: ưu tiên TÊN CHÍNH XÁC; fallback LIKE nhưng fail-closed khi số match ≠ 1 ──
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname = 'audit_logs_object_type_chk';

  IF v_oid IS NULL THEN
    SELECT count(*) INTO v_cnt
      FROM pg_constraint
     WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
       AND conname LIKE '%object_type%';

    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '[0550] khong xac dinh duoc CHECK object_type tren audit_logs (so match = %) — DUNG fail-closed', v_cnt;
    END IF;

    SELECT oid, conname INTO v_oid, v_con
      FROM pg_constraint
     WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
       AND conname LIKE '%object_type%';
  END IF;

  v_def := pg_get_constraintdef(v_oid);

  -- ── (2) Parse 2 tầng, CẢ HAI NEO vào `object_type = ANY (…)` ──
  v_raw := substring(v_def FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*''(\{[^}]*\})''');
  IF v_raw IS NOT NULL THEN
    v_cur := v_raw::text[];
    v_matched := true;
  ELSE
    v_raw := substring(v_def FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*(ARRAY\[[^]]*\])');
    IF v_raw IS NOT NULL THEN
      SELECT array_agg(m[1]) INTO v_cur
        FROM regexp_matches(v_raw, '''([^'']+)''', 'g') AS m;
      v_matched := v_cur IS NOT NULL;
    END IF;
  END IF;

  IF NOT v_matched OR v_cur IS NULL OR array_length(v_cur, 1) IS NULL THEN
    RAISE EXCEPTION '[0550] khong parse duoc allow-list cua object_type = ANY(...) cho % : % — DUNG fail-closed', v_con, v_def;
  END IF;

  -- ── (3) Chỉ thêm phần còn THIẾU (idempotent) ──
  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) IS NULL THEN
    RAISE NOTICE '[0550] 5 gia tri asset* da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  -- ── (4) Union + assert SUPERSET trước khi swap (bất biến #2) ──
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  IF NOT (v_union @> v_cur) THEN
    RAISE EXCEPTION '[0550] union danh mat gia tri cu — DUNG (bat bien #2 append-only)';
  END IF;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );

  -- ── (5) VERIFY NO-LOSS fail-LOUD: đọc lại def THẬT (neo `object_type = ANY`) ──
  SELECT substring(pg_get_constraintdef(oid) FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*''(\{[^}]*\})''')::text[]
    INTO v_after
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c' AND conname = v_con;

  SELECT array_agg(t) INTO v_missing
    FROM unnest(v_cur || v_new) AS t
   WHERE v_after IS NULL OR NOT (v_after @> ARRAY[t]);

  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION '[0550] verify NO-LOSS that bai — CHECK thieu: %', array_to_string(v_missing, ', ');
  END IF;

  -- ── (5b) VERIFY NO-GAIN: CHECK mới KHÔNG PHÌNH ngoài (cũ ∪ mới) ──
  SELECT array_agg(t) INTO v_extra
    FROM unnest(COALESCE(v_after, ARRAY[]::text[])) AS t
   WHERE NOT ((v_cur || v_new) @> ARRAY[t]);

  IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 THEN
    RAISE EXCEPTION '[0550] verify NO-GAIN that bai — CHECK phinh them: %', array_to_string(v_extra, ', ');
  END IF;

  RAISE NOTICE '[0550] da them % vao CHECK object_type cua audit_logs (tong % gia tri)',
    array_to_string(v_add, ', '), array_length(v_after, 1);
END;
$$;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (6) VERIFY fail-LOUD (mirror 0506 bước 6 + plan-reviewer B5): mọi câu đếm role NEO company_id IS NULL.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_n  int;
  v    text;
  rw   record;
BEGIN
  -- (a) đúng 11 cặp, cả 11 is_sensitive=false
  SELECT count(*) INTO v_n FROM permissions
   WHERE (action, resource_type) IN (
     ('access','asset'), ('view','asset'), ('create','asset'), ('update','asset'), ('delete','asset'),
     ('assign','asset'), ('revoke','asset'), ('dispose','asset'),
     ('manage','asset-category'), ('manage','asset-maintenance'), ('manage','asset-inventory'))
     AND is_sensitive = false;
  IF v_n <> 11 THEN
    RAISE EXCEPTION '[0550] verify: catalog co % cap asset is_sensitive=false, ky vong 11 — buoc (3) truot', v_n;
  END IF;

  -- (b1) tổng 28 grant ALLOW của 5 role hệ thống trên 11 cặp (over/under đều đỏ)
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name IN ('employee', 'manager', 'hr', 'company-admin', 'asset-manager')
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW'
     AND p.resource_type IN ('asset', 'asset-category', 'asset-maintenance', 'asset-inventory');
  IF v_n <> 28 THEN
    RAISE EXCEPTION '[0550] verify: % grant asset cho 5 role he thong, ky vong 28 — over/under-grant (drift?)', v_n;
  END IF;

  -- (b2) employee/manager/hr KHÔNG có cặp ngoài access/view
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name IN ('employee', 'manager', 'hr')
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW'
     AND p.resource_type IN ('asset', 'asset-category', 'asset-maintenance', 'asset-inventory')
     AND p.action NOT IN ('access', 'view');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0550] verify: employee/manager/hr CO % cap GHI asset — vo ma tran §9d', v_n;
  END IF;

  -- (b3) scope cặp đọc từng role + access=Own cho cả 5
  FOR rw IN SELECT * FROM (VALUES
      ('employee', 'view', 'Own'), ('manager', 'view', 'Department'), ('hr', 'view', 'Company'),
      ('company-admin', 'view', 'Company'), ('asset-manager', 'view', 'Company'),
      ('employee', 'access', 'Own'), ('manager', 'access', 'Own'), ('hr', 'access', 'Own'),
      ('company-admin', 'access', 'Own'), ('asset-manager', 'access', 'Own')
    ) AS v(role, act, scope)
  LOOP
    SELECT count(*) INTO v_n
      FROM role_permissions rp
      JOIN roles r2      ON r2.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r2.name = rw.role AND r2.company_id IS NULL AND r2.deleted_at IS NULL
       AND rp.effect = 'ALLOW' AND rp.data_scope = rw.scope
       AND p.action = rw.act AND p.resource_type = 'asset';
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0550] verify: % %:asset @% = % hang, ky vong 1', rw.role, rw.act, rw.scope, v_n;
    END IF;
  END LOOP;

  -- (b4)+(b5) company-admin VÀ asset-manager: đúng 11 hàng, 10 cặp ngoài access = Company
  FOREACH v IN ARRAY ARRAY['company-admin', 'asset-manager'] LOOP
    SELECT count(*) INTO v_n
      FROM role_permissions rp
      JOIN roles r2      ON r2.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r2.name = v AND r2.company_id IS NULL AND r2.deleted_at IS NULL
       AND rp.effect = 'ALLOW' AND rp.data_scope = 'Company'
       AND p.resource_type IN ('asset', 'asset-category', 'asset-maintenance', 'asset-inventory')
       AND p.action <> 'access';
    IF v_n <> 10 THEN
      RAISE EXCEPTION '[0550] verify: % co % cap @Company (ngoai access), ky vong 10', v, v_n;
    END IF;
  END LOOP;

  -- (c) role asset-manager đúng 3 thuộc tính (ON CONFLICT DO NOTHING không sửa hàng sẵn có sai)
  SELECT count(*) INTO v_n
    FROM roles
   WHERE name = 'asset-manager' AND company_id IS NULL AND deleted_at IS NULL
     AND id = '00000000-0000-0000-0000-000000000012'
     AND is_system = true AND requires_two_factor = false;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0550] verify: role asset-manager (id …0012, is_system, requires_two_factor=false) = % hang, ky vong 1', v_n;
  END IF;

  -- (d) CHECK audit chứa cả 5 giá trị — regex biên [, { '] v [' , }] từng giá trị (0506:265)
  FOREACH v IN ARRAY ARRAY['asset', 'asset_category', 'asset_assignment', 'asset_maintenance', 'asset_inventory'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
         AND conname LIKE '%object_type%'
         AND pg_get_constraintdef(oid) ~ ('[,{'']' || v || '['',}]')
    ) THEN
      RAISE EXCEPTION '[0550] verify: CHECK audit_logs.object_type CHUA chua ''%'' — buoc (5) truot', v;
    END IF;
  END LOOP;

  -- (e) module ASSET TỒN TẠI (D1). CỐ Ý **KHÔNG** ép `is_active = false`.
  --
  -- S11-ASSET-FE-1 (30/08/2026) — vá forward-compat. Bản đầu của guard này khẳng định `is_active = false`,
  -- tức đóng đinh đúng một trạng thái mà CHÍNH NÓ ghi trong thông điệp là 'bat o S11-ASSET-FE-1' sẽ đổi.
  -- Hệ quả: mig 0556 bật cờ lên true ⇒ ca H1 của `s11-asset-db1-invariants.int-spec.ts` (chạy lại NGUYÊN
  -- file 0550 để chứng minh idempotency) ném P0001 và CI đỏ, dù 0550 không hề sai.
  --
  -- Đây là họ lỗi đã ghi: guard baseline phải FORWARD-COMPATIBLE (memory
  -- `noti-check-baseline-guard-must-be-forward-compatible`) — verify cái migration này TỰ CHỊU TRÁCH NHIỆM
  -- (hàng modules.ASSET có tồn tại để các bước sau bám vào), KHÔNG verify một trạng thái mà WO sau được
  -- quyền đổi. Hợp đồng 'ASSET phải inactive cho tới khi có màn' vẫn được canh, nhưng ở ĐÚNG chỗ có thể
  -- cập nhật cùng lúc: pin `EXTENSION_INACTIVE_MODULES` của migration-smoke.int-spec.ts.
  IF NOT EXISTS (
    SELECT 1 FROM modules WHERE module_code = 'ASSET' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION '[0550] verify: modules.ASSET phai ton tai (ky vong 1 hang tu mig 0435)';
  END IF;

  -- (f) super-admin KHÔNG được enumerate ở tầng migration
  SELECT count(*) INTO v_n FROM roles WHERE name = 'super-admin' AND company_id IS NULL AND deleted_at IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0550] verify: super-admin xuat hien trong roles he thong (% hang) — phai la runtime company-scoped', v_n;
  END IF;

  RAISE NOTICE '[0550] verify PASS: 11 perm asset + 28 grant §9d + role asset-manager + audit CHECK 5 gia tri + module ASSET ton tai';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM role_permissions rp USING permissions p
--   WHERE rp.permission_id = p.id
--     AND p.resource_type IN ('asset', 'asset-category', 'asset-maintenance', 'asset-inventory');
-- DELETE FROM permissions WHERE resource_type IN ('asset', 'asset-category', 'asset-maintenance', 'asset-inventory');
-- DELETE FROM roles WHERE id = '00000000-0000-0000-0000-000000000012' AND company_id IS NULL;
-- -- CHECK audit_logs.object_type: KHÔNG có down (append-only #2 — gỡ giá trị làm vỡ hàng audit đã ghi).
