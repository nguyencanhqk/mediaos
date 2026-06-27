-- Migration 0444: S2-AUTH-SEED-1 (🔴 RED, zone=red) — seed CANONICAL roles + per-pair data_scope.
--   Nguồn sự thật: docs/plans/S2-AUTH-SEED-1.md §13 PERMISSION MATRIX (IMPLEMENTATION-05 §13).
--   Hiện thực BẢNG §13 thành danh sách tường minh (role, action, resource_type, data_scope) — KHÔNG
--   phẳng theo role. Gỡ nợ S0-AUTH-DB-1 (scope per-grant) + seed 4 role canonical employee/manager/hr/
--   company-admin.
--
-- HOT-FILE §9.3 / BẤT BIẾN:
--   • THUẦN ADDITIVE: chỉ INSERT data (permissions/roles/role_permissions). KHÔNG DDL, KHÔNG đụng
--     RLS/FORCE/policy/grant của mig 0005 → BẤT BIẾN #1 GIỮ NGUYÊN. KHÔNG db:generate (DO-block thủ công).
--   • Catalog gaps: INSERT ON CONFLICT(action,resource_type) DO NOTHING — cặp đã có KHÔNG nhân đôi.
--   • Role MỚI: INSERT ON CONFLICT(name) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING
--     (khớp partial unique roles_system_name_active_uq). manager/hr = id ổn định mới; KHÔNG gộp
--     hr-manager(…009 media-era). TÁI DÙNG employee(…008)/company-admin(…001).
--   • role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ ON CONFLICT KHÔNG
--     sửa scope. Đổi scope cặp ĐÃ có = DELETE đúng (role_id,permission_id,effect) CÓ scope SAI + INSERT
--     lại scope §13. ⛔ KHÔNG blanket DELETE theo role_id (mất grant media/parked). App role KHÔNG có
--     UPDATE trên role_permissions (mig 0005) — đổi scope phải qua DELETE+INSERT (BẤT BIẾN #2).
--   • Idempotent đo BỘ BA (role_id, permission_id, data_scope): chạy lại = no-op (DELETE-wrong-scope
--     không khớp gì + INSERT trúng ON CONFLICT). COUNT mù với scope drift nên đo bộ-ba.
--   • OUT-OF-SCOPE (KHÔNG role-grant): reveal-secret:platform-account (ADR-0010 break-glass),
--     view-salary/update-salary:employee, finance/payroll. Super-admin = runtime (SuperAdminBootstrap),
--     KHÔNG seed system role company_id NULL ở migration (BẤT BIẾN #1).
--
-- BAND 0444 (lane S2-AUTH-SEED-1). Journal: idx 127, when 1717500620000 (> head 0443 idx 126 /
--   1717500610000). Nối tiếp ĐƠN ĐIỆU sau 0443_s2_authdb2_sessions_logs_security_events.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) Catalog permission gaps §13. ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION).
--     AUTH verb MỚI (view:me · view/lock:user · view:role · view:permission) KHÁC legacy read:user/
--     manage:user — đây là CẶP MỚI, KHÔNG alias. create:user đã có (0005). HR: view-sensitive:employee
--     (is_sensitive=true) + create/approve:profile-change-request + change-status/export:employee.
--     read:employee/read:position/read:department/create:department/create:employee... ĐÃ có (0005/0019)
--     → ON CONFLICT skip.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  -- AUTH
  ('view',           'me',                      false),
  ('view',           'user',                    false),
  ('lock',           'user',                    false),
  ('view',           'role',                    false),
  ('view',           'permission',              false),
  -- HR
  ('view-sensitive', 'employee',                true),
  ('change-status',  'employee',                false),
  ('export',         'employee',                false),
  ('create',         'profile-change-request',  false),
  ('approve',        'profile-change-request',  false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b) 2 system role MỚI: manager · hr (company_id NULL, is_system=true). id ổn định mới (…010/…011 —
--     KHÔNG đụng dải media …001..00a/…0f0 đã seed: company-admin..finance-manager/platform-admin).
--     ON CONFLICT khớp partial unique roles_system_name_active_uq (name WHERE company_id IS NULL AND
--     deleted_at IS NULL). KHÔNG gộp hr-manager(…009 media-era) vào hr.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO roles (id, company_id, name, description, is_system) VALUES
  ('00000000-0000-0000-0000-000000000010', NULL, 'manager',
   'Line manager: read team employees, approve team operations (data_scope Team/Department)', true),
  ('00000000-0000-0000-0000-000000000011', NULL, 'hr',
   'HR: company-wide employee management (non-salary), profile-change approval', true)
ON CONFLICT (name) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (c)+(d) Seed role_permissions THEO TỪNG CẶP (role, action, resource_type) = data_scope §13.
--   DO-block: với MỖI hàng §13, resolve role_id + permission_id (qua tên + (action,resource_type)),
--   rồi (d) DELETE đúng bộ (role_id, permission_id, 'ALLOW') có data_scope <> target §13 (per-pair, KHÔNG
--   blanket), rồi (c) INSERT (role_id, permission_id, 'ALLOW', target) ON CONFLICT(role_id,permission_id,
--   effect) DO NOTHING. Toàn bộ chạy trong transaction migration (drizzle migrator bọc mỗi file 1 txn).
--   Idempotent bộ-ba: lần 2 → DELETE-wrong-scope không khớp + INSERT trúng ON CONFLICT = no-op.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- BẢNG §13 → (role_name, action, resource_type, data_scope). "-" trong §13 = KHÔNG có hàng.
  --   view:me & create:profile-change-request = Own cho CẢ 4 role (KHÔNG Company).
  --   read:employee manager=Team; read:department manager=Department, còn lại Company.
  --   view-sensitive:employee: employee=Own, hr=Company, company-admin=Company (manager KHÔNG).
  --   delete:employee: chỉ company-admin (hr KHÔNG mặc định). Super-admin = runtime (KHÔNG ở đây).
  grants CONSTANT text[][] := ARRAY[
    -- AUTH.ME.VIEW
    ['employee',      'view',           'me',                     'Own'],
    ['manager',       'view',           'me',                     'Own'],
    ['hr',            'view',           'me',                     'Own'],
    ['company-admin', 'view',           'me',                     'Own'],
    -- AUTH.USER.VIEW
    ['hr',            'view',           'user',                   'Company'],
    ['company-admin', 'view',           'user',                   'Company'],
    -- AUTH.USER.CREATE
    ['company-admin', 'create',         'user',                   'Company'],
    -- AUTH.USER.LOCK
    ['company-admin', 'lock',           'user',                   'Company'],
    -- AUTH.ROLE.VIEW
    ['company-admin', 'view',           'role',                   'Company'],
    -- AUTH.PERMISSION.VIEW
    ['company-admin', 'view',           'permission',             'Company'],
    -- HR.EMPLOYEE.VIEW
    ['employee',      'read',           'employee',               'Own'],
    ['manager',       'read',           'employee',               'Team'],
    ['hr',            'read',           'employee',               'Company'],
    ['company-admin', 'read',           'employee',               'Company'],
    -- HR.EMPLOYEE.VIEW_SENSITIVE (is_sensitive)
    ['employee',      'view-sensitive', 'employee',               'Own'],
    ['hr',            'view-sensitive', 'employee',               'Company'],
    ['company-admin', 'view-sensitive', 'employee',               'Company'],
    -- HR.EMPLOYEE.CREATE
    ['hr',            'create',         'employee',               'Company'],
    ['company-admin', 'create',         'employee',               'Company'],
    -- HR.EMPLOYEE.UPDATE
    ['hr',            'update',         'employee',               'Company'],
    ['company-admin', 'update',         'employee',               'Company'],
    -- HR.EMPLOYEE.CHANGE_STATUS
    ['hr',            'change-status',  'employee',               'Company'],
    ['company-admin', 'change-status',  'employee',               'Company'],
    -- HR.EMPLOYEE.DELETE (hr KHÔNG; chỉ company-admin)
    ['company-admin', 'delete',         'employee',               'Company'],
    -- HR.EMPLOYEE.EXPORT
    ['hr',            'export',         'employee',               'Company'],
    ['company-admin', 'export',         'employee',               'Company'],
    -- HR.DEPARTMENT.VIEW
    ['employee',      'read',           'department',             'Company'],
    ['manager',       'read',           'department',             'Department'],
    ['hr',            'read',           'department',             'Company'],
    ['company-admin', 'read',           'department',             'Company'],
    -- HR.DEPARTMENT.CREATE
    ['hr',            'create',         'department',             'Company'],
    ['company-admin', 'create',         'department',             'Company'],
    -- HR.POSITION.VIEW
    ['employee',      'read',           'position',               'Company'],
    ['manager',       'read',           'position',               'Company'],
    ['hr',            'read',           'position',               'Company'],
    ['company-admin', 'read',           'position',               'Company'],
    -- HR.PROFILE_CHANGE_REQUEST.CREATE (Own cho CẢ 4 role)
    ['employee',      'create',         'profile-change-request', 'Own'],
    ['manager',       'create',         'profile-change-request', 'Own'],
    ['hr',            'create',         'profile-change-request', 'Own'],
    ['company-admin', 'create',         'profile-change-request', 'Own'],
    -- HR.PROFILE_CHANGE_REQUEST.APPROVE
    ['hr',            'approve',        'profile-change-request', 'Company'],
    ['company-admin', 'approve',        'profile-change-request', 'Company']
  ];
  g           text[];
  v_role_id   uuid;
  v_perm_id   uuid;
  v_seeded    int := 0;
  v_rescoped  int := 0;
  v_del       int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY grants LOOP
    -- resolve role (system role canonical: company_id NULL, không xoá mềm)
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0444] role canonical % không tồn tại — seed (b) phải chạy trước', g[1];
    END IF;

    -- resolve permission (catalog gap (a) phải đã chạy)
    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0444] permission (%:%) không có trong catalog — seed (a) phải chạy trước', g[2], g[3];
    END IF;

    -- (d) DELETE đúng bộ (role_id, permission_id, 'ALLOW') có scope SAI (per-pair, KHÔNG blanket).
    --     Chỉ xoá khi data_scope KHÁC target §13 → giữ idempotent + KHÔNG đụng cặp khác/role khác.
    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> g[4];
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    -- (c) INSERT lại scope §13. ON CONFLICT(role_id,permission_id,effect) DO NOTHING → idempotent.
    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0444] §13 seed: % cặp INSERT mới, % cặp re-scope (DELETE wrong-scope+INSERT)',
    v_seeded, v_rescoped;
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id
--     AND r.name IN ('employee','manager','hr','company-admin') AND r.company_id IS NULL
--     AND (p.action,p.resource_type) IN (
--       ('view','me'),('view','user'),('lock','user'),('view','role'),('view','permission'),
--       ('view-sensitive','employee'),('change-status','employee'),('export','employee'),
--       ('read','employee'),('read','department'),('read','position'),('create','department'),
--       ('create','profile-change-request'),('approve','profile-change-request'));
-- DELETE FROM roles WHERE id IN
--   ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011');
-- DELETE FROM permissions WHERE (action,resource_type) IN
--   (('view','me'),('view','user'),('lock','user'),('view','role'),('view','permission'),
--    ('view-sensitive','employee'),('change-status','employee'),('export','employee'),
--    ('create','profile-change-request'),('approve','profile-change-request'));
