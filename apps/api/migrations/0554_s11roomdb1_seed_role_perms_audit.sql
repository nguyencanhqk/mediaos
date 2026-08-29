-- Migration 0554: S11-ROOM-DB-1 (🔴 RED, zone=red, crown) — SEED nghiệp vụ ROOM (DB-16 §9 bước C, mirror 0550):
--   role hệ thống `office-admin` + 5 cặp quyền + 22 grant per-(role,pair) theo ma trận §9e +
--   UNION-ADD `room_booking` vào CHECK audit_logs.object_type. THUẦN DATA/DDL-CHECK — KHÔNG db:generate.
--
-- BỐI CẢNH (seed qua migrator owner-bypass — mirror 0506:6-11): migrator chạy DATABASE_DIRECT_URL = role owner
--   (rolbypassrls) ⇒ INSERT roles/permissions (global) + role_permissions chạy TRỰC TIẾP. RLS chỉ chặn app role runtime.
--
-- QUYẾT ĐỊNH CHỐT (plan docs/plans/S11-ROOM-DB-1.md §1/§4):
--   D1 modules.ROOM ĐÃ TỒN TẠI từ 0435:298 (Extension, is_active=false). KHÔNG INSERT, KHÔNG BẬT — tiền lệ 0538 (CHAT)
--      + 0550 (ASSET): bật cờ khi chưa có endpoint = hứa suông (ui-promises-backend-never-reads); pin migration-smoke
--      EXTENSION_INACTIVE_MODULES giữ ROOM. Chỉ verify hàng tồn tại. Bật ở S11-ROOM-FE-1 (DB-16 §9C đã đính chính).
--   D2 role `office-admin`: company_id NULL, is_system=true, requires_two_factor=false TƯỜNG MINH, id cố định …0013
--      (…0012 = asset-manager; tiền lệ 0019 hr-manager). KHÔNG canonical — không vào DashCanonicalRole /
--      NOTI_CANONICAL_ROLES / pin auth-seed-canonical-roles. Role CỘNG THÊM: không cặp ME / (read,dashboard).
--   D3 5 cặp is_sensitive=false cả 5 (SPEC-14 §11 — lịch phòng là dữ liệu dùng chung, không cặp nhạy cảm).
--   D4 ma trận 22 hàng (§9e): employee 4 · manager 4 · hr 4 (access@Own · view@Company · book@Own · cancel@Own) ·
--      company-admin 5 · office-admin 5 (access@Own, 4 cặp còn lại @Company). view@Company CHO MỌI ROLE (SPEC-14 §11).
--   D5 audit CHECK: clone NGUYÊN khối 0550 bước (5) (= 0545: neo 2 tầng `object_type = ANY(…)`, fail-closed,
--      NO-LOSS/NO-GAIN). v_new = room_booking + meeting_room (meeting_room ĐÃ có từ 0050 — union chỉ thêm phần thiếu;
--      verify (d) đòi CẢ HAI có mặt). 'meeting'/'meeting_note' GIỮ trong CHECK (append-only) dù TS gỡ.
--
-- BẤT BIẾN / HOT-FILE: role_permissions UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ đổi scope =
--   DELETE đúng bộ scope SAI (per-pair, KHÔNG blanket) + INSERT ON CONFLICT DO NOTHING. Mọi câu đếm role NEO
--   `company_id IS NULL AND deleted_at IS NULL` (0506:215). super-admin KHÔNG enumerate.
--
-- BAND 0554 (lane S11-ROOM-DB-1). Journal: idx 221, when 1717587343000 (> 0553 idx 220 / 1717587342000).
--   AUDIT_OBJECT_TYPES (schema/audit.ts) += 'room_booking' CÙNG commit.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) modules.ROOM: verify tồn tại, GIỮ is_active=false (mirror 0550 bước 1) ───────────────
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM modules WHERE module_code = 'ROOM' AND deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0554] modules.ROOM khong ton tai (ky vong 1 hang tu mig 0435, dem duoc %)', v_n;
  END IF;
  RAISE NOTICE '[0554] modules.ROOM ton tai, GIU is_active=false (chua co endpoint — S11-ROOM-FE-1 moi bat)';
END;
$$;
--> statement-breakpoint

-- ─────────────── (2) Role hệ thống office-admin (tiền lệ 0019 hr-manager / 0550 asset-manager) ───────────────
INSERT INTO roles (id, company_id, name, description, is_system, requires_two_factor) VALUES
  ('00000000-0000-0000-0000-000000000013', NULL, 'office-admin',
   'Office Admin: quản trị phòng họp — CRUD phòng, kích hoạt/vô hiệu, đặt hộ, huỷ mọi lượt (SPEC-01 §10.9)',
   true, false)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ─────────────── (3) Catalog 5 cặp quyền ROOM, is_sensitive=false (SPEC-14 §11 / permission-matrix §9e) ───────────────
--     Mã dotted ROOM.* chỉ ghi ở COMMENT — bảng permissions CHỈ có (action, resource_type, is_sensitive).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('access', 'room',         false),  -- ROOM.ACCESS          cổng nav
  ('view',   'room',         false),  -- ROOM.ROOM.VIEW       phòng · lịch mọi phòng · phòng trống · chi tiết · thống kê · /me/room-bookings
  ('book',   'room',         false),  -- ROOM.BOOKING.CREATE  tạo lượt (Own = organizer là mình; Company = đặt hộ)
  ('cancel', 'room-booking', false),  -- ROOM.BOOKING.CANCEL  huỷ lượt (Own = lượt mình tổ chức; Company = mọi lượt)
  ('manage', 'room',         false)   -- ROOM.ROOM.MANAGE     CRUD phòng · kích hoạt/vô hiệu · xoá mềm
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── (4) Grant per-(role, pair) ma trận §9e = 22 hàng (mirror 0550 bước 4) ───────────────
DO $$
DECLARE
  room_grants CONSTANT text[][] := ARRAY[
    -- employee
    ['employee',      'access', 'room',         'Own'],
    ['employee',      'view',   'room',         'Company'],
    ['employee',      'book',   'room',         'Own'],
    ['employee',      'cancel', 'room-booking', 'Own'],
    -- manager
    ['manager',       'access', 'room',         'Own'],
    ['manager',       'view',   'room',         'Company'],
    ['manager',       'book',   'room',         'Own'],
    ['manager',       'cancel', 'room-booking', 'Own'],
    -- hr
    ['hr',            'access', 'room',         'Own'],
    ['hr',            'view',   'room',         'Company'],
    ['hr',            'book',   'room',         'Own'],
    ['hr',            'cancel', 'room-booking', 'Own'],
    -- company-admin: cả 5 (access @Own, còn lại @Company)
    ['company-admin', 'access', 'room',         'Own'],
    ['company-admin', 'view',   'room',         'Company'],
    ['company-admin', 'book',   'room',         'Company'],
    ['company-admin', 'cancel', 'room-booking', 'Company'],
    ['company-admin', 'manage', 'room',         'Company'],
    -- office-admin: cả 5 (như company-admin)
    ['office-admin',  'access', 'room',         'Own'],
    ['office-admin',  'view',   'room',         'Company'],
    ['office-admin',  'book',   'room',         'Company'],
    ['office-admin',  'cancel', 'room-booking', 'Company'],
    ['office-admin',  'manage', 'room',         'Company']
  ];
  g          text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY room_grants LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0554] role he thong % khong ton tai — seed 0005/0444/(2) phai chay truoc', g[1];
    END IF;

    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0554] permission (%:%) khong co trong catalog — buoc (3) phai chay truoc', g[2], g[3];
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

  RAISE NOTICE '[0554] ROOM grants: % INSERT moi, % re-scope (5 role x ma tran §9e = 22 hang)', v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ─────────────── (5) CHECK audit_logs.object_type += room_booking (+ meeting_room nếu thiếu) — CLONE NGUYÊN KHỐI 0550/0545 ───
DO $$
DECLARE
  v_oid     oid;
  v_con     text;
  v_def     text;
  v_raw     text;
  v_matched boolean := false;
  v_cnt     int;
  v_cur     text[];
  v_new     text[] := ARRAY['room_booking', 'meeting_room'];
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
      RAISE EXCEPTION '[0554] khong xac dinh duoc CHECK object_type tren audit_logs (so match = %) — DUNG fail-closed', v_cnt;
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
    RAISE EXCEPTION '[0554] khong parse duoc allow-list cua object_type = ANY(...) cho % : % — DUNG fail-closed', v_con, v_def;
  END IF;

  -- ── (3) Chỉ thêm phần còn THIẾU (idempotent) ──
  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) IS NULL THEN
    RAISE NOTICE '[0554] room_booking + meeting_room da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  -- ── (4) Union + assert SUPERSET trước khi swap (bất biến #2) ──
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  IF NOT (v_union @> v_cur) THEN
    RAISE EXCEPTION '[0554] union danh mat gia tri cu — DUNG (bat bien #2 append-only)';
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
    RAISE EXCEPTION '[0554] verify NO-LOSS that bai — CHECK thieu: %', array_to_string(v_missing, ', ');
  END IF;

  -- ── (5b) VERIFY NO-GAIN: CHECK mới KHÔNG PHÌNH ngoài (cũ ∪ mới) ──
  SELECT array_agg(t) INTO v_extra
    FROM unnest(COALESCE(v_after, ARRAY[]::text[])) AS t
   WHERE NOT ((v_cur || v_new) @> ARRAY[t]);

  IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 THEN
    RAISE EXCEPTION '[0554] verify NO-GAIN that bai — CHECK phinh them: %', array_to_string(v_extra, ', ');
  END IF;

  RAISE NOTICE '[0554] da them % vao CHECK object_type cua audit_logs (tong % gia tri)',
    array_to_string(v_add, ', '), array_length(v_after, 1);
END;
$$;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (6) VERIFY fail-LOUD (mirror 0550 bước 6): mọi câu đếm role NEO company_id IS NULL AND deleted_at IS NULL.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_n  int;
  v    text;
  rw   record;
BEGIN
  -- (a) đúng 5 cặp, cả 5 is_sensitive=false
  SELECT count(*) INTO v_n FROM permissions
   WHERE (action, resource_type) IN (
     ('access','room'), ('view','room'), ('book','room'), ('cancel','room-booking'), ('manage','room'))
     AND is_sensitive = false;
  IF v_n <> 5 THEN
    RAISE EXCEPTION '[0554] verify: catalog co % cap room is_sensitive=false, ky vong 5 — buoc (3) truot', v_n;
  END IF;

  -- (b1) tổng 22 grant ALLOW của 5 role hệ thống trên 5 cặp (over/under đều đỏ)
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name IN ('employee', 'manager', 'hr', 'company-admin', 'office-admin')
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW'
     AND p.resource_type IN ('room', 'room-booking');
  IF v_n <> 22 THEN
    RAISE EXCEPTION '[0554] verify: % grant room cho 5 role he thong, ky vong 22 — over/under-grant (drift?)', v_n;
  END IF;

  -- (b2) employee/manager/hr KHÔNG có cặp manage
  SELECT count(*) INTO v_n
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name IN ('employee', 'manager', 'hr')
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND rp.effect = 'ALLOW'
     AND p.resource_type IN ('room', 'room-booking')
     AND p.action = 'manage';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0554] verify: employee/manager/hr CO % cap manage:room — vo ma tran §9e', v_n;
  END IF;

  -- (b3) từng (role, action, resource, scope) — 22 tổ hợp, mỗi tổ hợp ĐÚNG 1 hàng
  FOR rw IN SELECT * FROM (VALUES
      ('employee',      'access', 'room',         'Own'),
      ('employee',      'view',   'room',         'Company'),
      ('employee',      'book',   'room',         'Own'),
      ('employee',      'cancel', 'room-booking', 'Own'),
      ('manager',       'access', 'room',         'Own'),
      ('manager',       'view',   'room',         'Company'),
      ('manager',       'book',   'room',         'Own'),
      ('manager',       'cancel', 'room-booking', 'Own'),
      ('hr',            'access', 'room',         'Own'),
      ('hr',            'view',   'room',         'Company'),
      ('hr',            'book',   'room',         'Own'),
      ('hr',            'cancel', 'room-booking', 'Own'),
      ('company-admin', 'access', 'room',         'Own'),
      ('company-admin', 'view',   'room',         'Company'),
      ('company-admin', 'book',   'room',         'Company'),
      ('company-admin', 'cancel', 'room-booking', 'Company'),
      ('company-admin', 'manage', 'room',         'Company'),
      ('office-admin',  'access', 'room',         'Own'),
      ('office-admin',  'view',   'room',         'Company'),
      ('office-admin',  'book',   'room',         'Company'),
      ('office-admin',  'cancel', 'room-booking', 'Company'),
      ('office-admin',  'manage', 'room',         'Company')
    ) AS v(role, act, res, scope)
  LOOP
    SELECT count(*) INTO v_n
      FROM role_permissions rp
      JOIN roles r2      ON r2.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r2.name = rw.role AND r2.company_id IS NULL AND r2.deleted_at IS NULL
       AND rp.effect = 'ALLOW' AND rp.data_scope = rw.scope
       AND p.action = rw.act AND p.resource_type = rw.res;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0554] verify: % %:% @% = % hang, ky vong 1', rw.role, rw.act, rw.res, rw.scope, v_n;
    END IF;
  END LOOP;

  -- (b4) company-admin VÀ office-admin: đúng 5 hàng, 4 cặp ngoài access = Company
  FOREACH v IN ARRAY ARRAY['company-admin', 'office-admin'] LOOP
    SELECT count(*) INTO v_n
      FROM role_permissions rp
      JOIN roles r2      ON r2.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r2.name = v AND r2.company_id IS NULL AND r2.deleted_at IS NULL
       AND rp.effect = 'ALLOW' AND rp.data_scope = 'Company'
       AND p.resource_type IN ('room', 'room-booking')
       AND p.action <> 'access';
    IF v_n <> 4 THEN
      RAISE EXCEPTION '[0554] verify: % co % cap @Company (ngoai access), ky vong 4', v, v_n;
    END IF;
  END LOOP;

  -- (c) role office-admin đúng 3 thuộc tính (ON CONFLICT DO NOTHING không sửa hàng sẵn có sai)
  SELECT count(*) INTO v_n
    FROM roles
   WHERE name = 'office-admin' AND company_id IS NULL AND deleted_at IS NULL
     AND id = '00000000-0000-0000-0000-000000000013'
     AND is_system = true AND requires_two_factor = false;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0554] verify: role office-admin (id …0013, is_system, requires_two_factor=false) = % hang, ky vong 1', v_n;
  END IF;

  -- (d) CHECK audit chứa room_booking VÀ meeting_room — regex biên [, { '] v [' , }] từng giá trị (0506:265)
  FOREACH v IN ARRAY ARRAY['room_booking', 'meeting_room'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
         AND conname LIKE '%object_type%'
         AND pg_get_constraintdef(oid) ~ ('[,{'']' || v || '['',}]')
    ) THEN
      RAISE EXCEPTION '[0554] verify: CHECK audit_logs.object_type CHUA chua ''%'' — buoc (5) truot', v;
    END IF;
  END LOOP;

  -- (e) module ROOM tồn tại và VẪN inactive (D1 — pin migration-smoke)
  IF NOT EXISTS (
    SELECT 1 FROM modules WHERE module_code = 'ROOM' AND deleted_at IS NULL AND is_active = false
  ) THEN
    RAISE EXCEPTION '[0554] verify: modules.ROOM phai ton tai va is_active=false (bat o S11-ROOM-FE-1)';
  END IF;

  -- (f) super-admin KHÔNG được enumerate ở tầng migration
  SELECT count(*) INTO v_n FROM roles WHERE name = 'super-admin' AND company_id IS NULL AND deleted_at IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0554] verify: super-admin xuat hien trong roles he thong (% hang) — phai la runtime company-scoped', v_n;
  END IF;

  -- (g) chốt 0553 không bị "seed lại": 0 cặp di sản meeting/meeting_room
  SELECT count(*) INTO v_n FROM permissions WHERE resource_type IN ('meeting', 'meeting_room');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0554] verify: con % cap quyen meeting/meeting_room di san (0553 phai xoa)', v_n;
  END IF;

  RAISE NOTICE '[0554] verify PASS: 5 perm room + 22 grant §9e + role office-admin + audit CHECK room_booking/meeting_room + module ROOM inactive';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM role_permissions rp USING permissions p
--   WHERE rp.permission_id = p.id AND p.resource_type IN ('room', 'room-booking');
-- DELETE FROM permissions WHERE resource_type IN ('room', 'room-booking');
-- DELETE FROM roles WHERE id = '00000000-0000-0000-0000-000000000013' AND company_id IS NULL;
-- -- CHECK audit_logs.object_type: KHÔNG có down (append-only #2 — gỡ giá trị làm vỡ hàng audit đã ghi).
