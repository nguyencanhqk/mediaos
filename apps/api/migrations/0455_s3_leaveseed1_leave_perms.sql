-- Migration 0455: S3-LEAVE-SEED-1 (🔴 RED, zone=red, crown) — seed LEAVE permission catalog + role→data_scope.
--   Nguồn sự thật: DB-05 §11 (permission seed LEAVE) + SPEC-05 + IMPLEMENTATION LEAVE permission matrix.
--   Hiện thực 30 cặp (action, resource_type) LEAVE + grant per-pair (role, action, resource, data_scope) cho
--   4 role canonical employee/manager/hr/company-admin. Mirror PROVEN pattern mig 0444 / 0454 (ATT-SEED-1).
--
-- HOT-FILE §9.3 / BẤT BIẾN:
--   • THUẦN ADDITIVE: chỉ INSERT data (permissions / role_permissions). KHÔNG DDL, KHÔNG đụng RLS/FORCE/
--     policy/grant của mig 0005/0453 → BẤT BIẾN #1 GIỮ NGUYÊN. KHÔNG db:generate (DO-block thủ công).
--   • Catalog gaps: INSERT ON CONFLICT(action,resource_type) DO NOTHING — cặp đã có KHÔNG nhân đôi.
--     Legacy mig 0063 ĐÃ có ('read','leave'),('create','leave'),('approve','leave'),('manage','leave')
--     is_sensitive=false. create/approve·leave trùng cặp WO ([F]=false) ⇒ ON CONFLICT giữ nguyên (KHỚP).
--     KHÔNG UPDATE is_sensitive, KHÔNG xoá read/manage·leave (cặp ngoài WO — để nguyên).
--   • resource_type LEAVE distinct ('leave-audit-log' ≠ generic 'audit-log' của mig 0005) → TRÁNH
--     over-grant audit toàn công ty. KHÔNG tái dùng cặp ('read'/'access-audit-log','audit-log').
--   • role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ ON CONFLICT KHÔNG sửa
--     scope. Đổi scope cặp ĐÃ có = DELETE đúng (role_id,permission_id,'ALLOW') có scope SAI + INSERT lại
--     scope đúng. ⛔ KHÔNG blanket DELETE theo role_id (mất grant khác). App role KHÔNG có UPDATE trên
--     role_permissions (mig 0005) — đổi scope phải DELETE+INSERT (BẤT BIẾN #2).
--     (Legacy 0063 đã grant create·leave cho employee/company-admin + approve·leave cho company-admin ở
--     scope cũ → per-pair re-scope đưa về đúng ma trận WO; KHÔNG đụng grant cặp ngoài WO.)
--   • Idempotent đo BỘ BA (role_id, permission_id, data_scope): chạy lại = no-op.
--   • LEAST-PRIVILEGE (owner): manager KHÔNG có grant leave-policy / leave-balance / leave-audit-log /
--     leave-file; KHÔNG cancel-any / revoke / export. Chỉ hr + company-admin quản trị + xem audit LEAVE.
--   • Role canonical employee/manager/hr/company-admin ĐÃ tồn tại (mig 0444) → KHÔNG tạo lại role.
--     Super-admin = runtime (SuperAdminBootstrap) — KHÔNG seed ở migration (BẤT BIẾN #1).
--
-- BAND 0455 (lane S3-LEAVE-SEED-1). Journal: idx 135, when 1717500670000 (> head 0454 idx 134 / 1717500665000).
--   Nối tiếp ĐƠN ĐIỆU sau 0454_s3_attseed1_att_perms.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) Catalog 30 cặp LEAVE. ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION).
--     is_sensitive: [F]=false (self-service nhân viên), [S]=true (quản trị/duyệt/audit/đọc chéo).
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  -- leave (11)
  ('view-own',         'leave',            false),
  ('view',             'leave',            true),
  ('create',           'leave',            false),
  ('submit',           'leave',            false),
  ('update-draft',     'leave',            false),
  ('cancel-own',       'leave',            false),
  ('approve',          'leave',            false),
  ('reject',           'leave',            true),
  ('cancel-any',       'leave',            true),
  ('revoke',           'leave',            true),
  ('export',           'leave',            true),
  -- leave-type (4)
  ('view',             'leave-type',       false),
  ('create',           'leave-type',       true),
  ('update',           'leave-type',       true),
  ('delete',           'leave-type',       true),
  -- leave-policy (4)
  ('view',             'leave-policy',     true),
  ('create',           'leave-policy',     true),
  ('update',           'leave-policy',     true),
  ('delete',           'leave-policy',     true),
  -- leave-balance (4)
  ('view-own',         'leave-balance',    false),
  ('view',             'leave-balance',    true),
  ('view-transaction', 'leave-balance',    true),
  ('adjust',           'leave-balance',    true),
  -- leave-calendar (3)
  ('view-own',         'leave-calendar',   false),
  ('view-team',        'leave-calendar',   true),
  ('view-company',     'leave-calendar',   true),
  -- leave-file (3)
  ('view',             'leave-file',       true),
  ('upload',           'leave-file',       true),
  ('delete',           'leave-file',       true),
  -- leave-audit-log (1)
  ('view',             'leave-audit-log',  true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b) Seed role_permissions THEO TỪNG CẶP (role, action, resource_type) = data_scope.
--   DO-block: với MỖI hàng, resolve role_id (name + company_id IS NULL) + permission_id (action,resource_type),
--   rồi DELETE đúng bộ (role_id, permission_id, 'ALLOW') có data_scope <> target (per-pair, KHÔNG blanket),
--   rồi INSERT (role_id, permission_id, 'ALLOW', target) ON CONFLICT(role_id,permission_id,effect) DO NOTHING.
--   Idempotent bộ-ba: lần 2 → DELETE-wrong-scope không khớp + INSERT trúng ON CONFLICT = no-op.
--   LEAST-PRIVILEGE: manager KHÔNG có hàng leave-policy/leave-balance/leave-audit-log/leave-file, KHÔNG
--   cancel-any/revoke/export·leave. 83 hàng.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- (role_name, action, resource_type, data_scope). "—" trong ma trận = KHÔNG có hàng.
  grants CONSTANT text[][] := ARRAY[
    -- LEAVE.VIEW_OWN (Own cho cả 4)
    ['employee',      'view-own',         'leave',           'Own'],
    ['manager',       'view-own',         'leave',           'Own'],
    ['hr',            'view-own',         'leave',           'Own'],
    ['company-admin', 'view-own',         'leave',           'Own'],
    -- LEAVE.CREATE (Own cho cả 4)
    ['employee',      'create',           'leave',           'Own'],
    ['manager',       'create',           'leave',           'Own'],
    ['hr',            'create',           'leave',           'Own'],
    ['company-admin', 'create',           'leave',           'Own'],
    -- LEAVE.SUBMIT (Own cho cả 4)
    ['employee',      'submit',           'leave',           'Own'],
    ['manager',       'submit',           'leave',           'Own'],
    ['hr',            'submit',           'leave',           'Own'],
    ['company-admin', 'submit',           'leave',           'Own'],
    -- LEAVE.UPDATE_DRAFT (Own cho cả 4)
    ['employee',      'update-draft',     'leave',           'Own'],
    ['manager',       'update-draft',     'leave',           'Own'],
    ['hr',            'update-draft',     'leave',           'Own'],
    ['company-admin', 'update-draft',     'leave',           'Own'],
    -- LEAVE.CANCEL_OWN (Own cho cả 4)
    ['employee',      'cancel-own',       'leave',           'Own'],
    ['manager',       'cancel-own',       'leave',           'Own'],
    ['hr',            'cancel-own',       'leave',           'Own'],
    ['company-admin', 'cancel-own',       'leave',           'Own'],
    -- LEAVE.VIEW (manager=Team, hr/company-admin=Company; employee KHÔNG)
    ['manager',       'view',             'leave',           'Team'],
    ['hr',            'view',             'leave',           'Company'],
    ['company-admin', 'view',             'leave',           'Company'],
    -- LEAVE.APPROVE (manager=Team, hr/company-admin=Company; employee KHÔNG)
    ['manager',       'approve',          'leave',           'Team'],
    ['hr',            'approve',          'leave',           'Company'],
    ['company-admin', 'approve',          'leave',           'Company'],
    -- LEAVE.REJECT (manager=Team, hr/company-admin=Company; employee KHÔNG)
    ['manager',       'reject',           'leave',           'Team'],
    ['hr',            'reject',           'leave',           'Company'],
    ['company-admin', 'reject',           'leave',           'Company'],
    -- LEAVE.CANCEL_ANY (hr/company-admin=Company; manager KHÔNG)
    ['hr',            'cancel-any',       'leave',           'Company'],
    ['company-admin', 'cancel-any',       'leave',           'Company'],
    -- LEAVE.REVOKE (hr/company-admin=Company; manager KHÔNG)
    ['hr',            'revoke',           'leave',           'Company'],
    ['company-admin', 'revoke',           'leave',           'Company'],
    -- LEAVE.EXPORT (hr/company-admin=Company; manager KHÔNG)
    ['hr',            'export',           'leave',           'Company'],
    ['company-admin', 'export',           'leave',           'Company'],
    -- LEAVE_BALANCE.VIEW_OWN (Own cho cả 4)
    ['employee',      'view-own',         'leave-balance',   'Own'],
    ['manager',       'view-own',         'leave-balance',   'Own'],
    ['hr',            'view-own',         'leave-balance',   'Own'],
    ['company-admin', 'view-own',         'leave-balance',   'Own'],
    -- LEAVE_BALANCE.VIEW (hr/company-admin=Company; manager KHÔNG)
    ['hr',            'view',             'leave-balance',   'Company'],
    ['company-admin', 'view',             'leave-balance',   'Company'],
    -- LEAVE_BALANCE.VIEW_TRANSACTION (hr/company-admin=Company; manager KHÔNG)
    ['hr',            'view-transaction', 'leave-balance',   'Company'],
    ['company-admin', 'view-transaction', 'leave-balance',   'Company'],
    -- LEAVE_BALANCE.ADJUST (hr/company-admin=Company; manager KHÔNG)
    ['hr',            'adjust',           'leave-balance',   'Company'],
    ['company-admin', 'adjust',           'leave-balance',   'Company'],
    -- LEAVE_CALENDAR.VIEW_OWN (Own cho cả 4)
    ['employee',      'view-own',         'leave-calendar',  'Own'],
    ['manager',       'view-own',         'leave-calendar',  'Own'],
    ['hr',            'view-own',         'leave-calendar',  'Own'],
    ['company-admin', 'view-own',         'leave-calendar',  'Own'],
    -- LEAVE_CALENDAR.VIEW_TEAM (manager/hr/company-admin=Team — CA chặn Team, KHÔNG Company)
    ['manager',       'view-team',        'leave-calendar',  'Team'],
    ['hr',            'view-team',        'leave-calendar',  'Team'],
    ['company-admin', 'view-team',        'leave-calendar',  'Team'],
    -- LEAVE_CALENDAR.VIEW_COMPANY (hr/company-admin=Company; manager KHÔNG)
    ['hr',            'view-company',     'leave-calendar',  'Company'],
    ['company-admin', 'view-company',     'leave-calendar',  'Company'],
    -- LEAVE_TYPE.VIEW (Company cho cả 4 — đọc danh mục loại nghỉ)
    ['employee',      'view',             'leave-type',      'Company'],
    ['manager',       'view',             'leave-type',      'Company'],
    ['hr',            'view',             'leave-type',      'Company'],
    ['company-admin', 'view',             'leave-type',      'Company'],
    -- LEAVE_TYPE.CREATE (hr/company-admin=Company)
    ['hr',            'create',           'leave-type',      'Company'],
    ['company-admin', 'create',           'leave-type',      'Company'],
    -- LEAVE_TYPE.UPDATE (hr/company-admin=Company)
    ['hr',            'update',           'leave-type',      'Company'],
    ['company-admin', 'update',           'leave-type',      'Company'],
    -- LEAVE_TYPE.DELETE (hr/company-admin=Company)
    ['hr',            'delete',           'leave-type',      'Company'],
    ['company-admin', 'delete',           'leave-type',      'Company'],
    -- LEAVE_POLICY.VIEW (hr/company-admin=Company; manager KHÔNG)
    ['hr',            'view',             'leave-policy',    'Company'],
    ['company-admin', 'view',             'leave-policy',    'Company'],
    -- LEAVE_POLICY.CREATE (hr/company-admin=Company)
    ['hr',            'create',           'leave-policy',    'Company'],
    ['company-admin', 'create',           'leave-policy',    'Company'],
    -- LEAVE_POLICY.UPDATE (hr/company-admin=Company)
    ['hr',            'update',           'leave-policy',    'Company'],
    ['company-admin', 'update',           'leave-policy',    'Company'],
    -- LEAVE_POLICY.DELETE (hr/company-admin=Company)
    ['hr',            'delete',           'leave-policy',    'Company'],
    ['company-admin', 'delete',           'leave-policy',    'Company'],
    -- LEAVE_FILE.VIEW (employee=Own, hr/company-admin=Company; manager KHÔNG)
    ['employee',      'view',             'leave-file',      'Own'],
    ['hr',            'view',             'leave-file',      'Company'],
    ['company-admin', 'view',             'leave-file',      'Company'],
    -- LEAVE_FILE.UPLOAD (employee=Own, hr/company-admin=Company; manager KHÔNG)
    ['employee',      'upload',           'leave-file',      'Own'],
    ['hr',            'upload',           'leave-file',      'Company'],
    ['company-admin', 'upload',           'leave-file',      'Company'],
    -- LEAVE_FILE.DELETE (employee=Own, hr/company-admin=Company; manager KHÔNG)
    ['employee',      'delete',           'leave-file',      'Own'],
    ['hr',            'delete',           'leave-file',      'Company'],
    ['company-admin', 'delete',           'leave-file',      'Company'],
    -- LEAVE_AUDIT_LOG.VIEW (hr/company-admin=Company; manager KHÔNG)
    ['hr',            'view',             'leave-audit-log', 'Company'],
    ['company-admin', 'view',             'leave-audit-log', 'Company']
  ];
  g           text[];
  v_role_id   uuid;
  v_perm_id   uuid;
  v_seeded    int := 0;
  v_rescoped  int := 0;
  v_del       int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY grants LOOP
    -- resolve role canonical (company_id NULL, không xoá mềm — mig 0444 đã tạo employee/manager/hr/company-admin)
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0455] role canonical % không tồn tại — mig 0444 phải chạy trước', g[1];
    END IF;

    -- resolve permission (catalog gap (a) phải đã chạy)
    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0455] permission (%:%) không có trong catalog — seed (a) phải chạy trước', g[2], g[3];
    END IF;

    -- DELETE đúng bộ (role_id, permission_id, 'ALLOW') có scope SAI (per-pair, KHÔNG blanket).
    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> g[4];
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    -- INSERT lại scope đúng. ON CONFLICT(role_id,permission_id,effect) DO NOTHING → idempotent.
    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0455] LEAVE seed: % cặp INSERT mới, % cặp re-scope (DELETE wrong-scope+INSERT)',
    v_seeded, v_rescoped;
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id
--     AND r.name IN ('employee','manager','hr','company-admin') AND r.company_id IS NULL
--     AND p.resource_type IN ('leave','leave-type','leave-policy','leave-balance','leave-calendar',
--                             'leave-file','leave-audit-log');
-- DELETE FROM permissions WHERE resource_type IN
--   ('leave-type','leave-policy','leave-balance','leave-calendar','leave-file','leave-audit-log');
-- -- NOTE: KHÔNG xoá permissions resource_type='leave' (cặp legacy 0063 read/create/approve/manage còn dùng).
