-- Migration 0454: S3-ATT-SEED-1 (🔴 RED, zone=red, crown) — seed ATT permission catalog + role→data_scope.
--   Nguồn sự thật: DB-04 §11.1/§11.3 + §12 (permission seed ATT) + IMPLEMENTATION ATT permission matrix.
--   Hiện thực 33 cặp (action, resource_type) ATT + grant per-pair (role, action, resource, data_scope) cho
--   4 role canonical employee/manager/hr/company-admin. Mirror PROVEN pattern mig 0444 (S2-AUTH-SEED-1).
--
-- HOT-FILE §9.3 / BẤT BIẾN:
--   • THUẦN ADDITIVE: chỉ INSERT data (permissions / role_permissions). KHÔNG DDL, KHÔNG đụng RLS/FORCE/
--     policy/grant của mig 0005/0452 → BẤT BIẾN #1 GIỮ NGUYÊN. KHÔNG db:generate (DO-block thủ công).
--   • Catalog gaps: INSERT ON CONFLICT(action,resource_type) DO NOTHING — cặp đã có KHÔNG nhân đôi.
--   • resource_type ATT distinct ('attendance-audit-log' ≠ generic 'audit-log' của mig 0005) → TRÁNH
--     over-grant audit toàn công ty. KHÔNG tái dùng cặp ('read'/'access-audit-log','audit-log').
--   • role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ ON CONFLICT KHÔNG sửa
--     scope. Đổi scope cặp ĐÃ có = DELETE đúng (role_id,permission_id,'ALLOW') có scope SAI + INSERT lại
--     scope đúng. ⛔ KHÔNG blanket DELETE theo role_id (mất grant khác). App role KHÔNG có UPDATE trên
--     role_permissions (mig 0005) — đổi scope phải DELETE+INSERT (BẤT BIẾN #2).
--   • Idempotent đo BỘ BA (role_id, permission_id, data_scope): chạy lại = no-op.
--   • LEAST-PRIVILEGE (owner ①): manager KHÔNG có grant shift / shift-assignment / attendance-rule /
--     attendance-audit-log. Chỉ hr + company-admin quản trị cấu hình + xem audit ATT.
--   • Role canonical employee/manager/hr/company-admin ĐÃ tồn tại (mig 0444) → KHÔNG tạo lại role.
--     Super-admin = runtime (SuperAdminBootstrap) — KHÔNG seed ở migration (BẤT BIẾN #1).
--
-- BAND 0454 (lane S3-ATT-SEED-1). Journal: idx 134, when 1717500665000 (> head 0453 idx 133 / 1717500660000).
--   Nối tiếp ĐƠN ĐIỆU sau 0453_s3_leavedb1_leave_core.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) Catalog 33 cặp ATT §12. ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION).
--     is_sensitive theo DB-04 §12 (authoritative) cho cặp được liệt kê; cặp KHÔNG có ở §12
--     (view-sensitive·attendance, recalculate·attendance, cancel-own·remote-request) theo default WO.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  -- attendance (10)
  ('check-in',       'attendance',           false),
  ('check-out',      'attendance',           false),
  ('view-own',       'attendance',           true),
  ('view-team',      'attendance',           true),
  ('view-company',   'attendance',           true),
  ('view-detail',    'attendance',           true),
  ('view-sensitive', 'attendance',           true),
  ('adjust-direct',  'attendance',           true),
  ('recalculate',    'attendance',           true),
  ('export',         'attendance',           true),
  -- adjustment (7)
  ('create-own',     'adjustment',           false),
  ('view-own',       'adjustment',           true),
  ('view-team',      'adjustment',           true),
  ('view-company',   'adjustment',           true),
  ('approve',        'adjustment',           true),
  ('reject',         'adjustment',           true),
  ('cancel-own',     'adjustment',           false),
  -- remote-request (7)
  ('create-own',     'remote-request',       false),
  ('view-own',       'remote-request',       true),
  ('view-team',      'remote-request',       true),
  ('view-company',   'remote-request',       true),
  ('approve',        'remote-request',       true),
  ('reject',         'remote-request',       true),
  ('cancel-own',     'remote-request',       false),
  -- shift (4)
  ('view',           'shift',                false),
  ('create',         'shift',                true),
  ('update',         'shift',                true),
  ('delete',         'shift',                true),
  -- shift-assignment (2)
  ('view',           'shift-assignment',     true),
  ('update',         'shift-assignment',     true),
  -- attendance-rule (2)
  ('view',           'attendance-rule',      true),
  ('config',         'attendance-rule',      true),
  -- attendance-audit-log (1)
  ('view',           'attendance-audit-log', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- (b) Seed role_permissions THEO TỪNG CẶP (role, action, resource_type) = data_scope.
--   DO-block: với MỖI hàng, resolve role_id (name + company_id IS NULL) + permission_id (action,resource_type),
--   rồi DELETE đúng bộ (role_id, permission_id, 'ALLOW') có data_scope <> target (per-pair, KHÔNG blanket),
--   rồi INSERT (role_id, permission_id, 'ALLOW', target) ON CONFLICT(role_id,permission_id,effect) DO NOTHING.
--   Idempotent bộ-ba: lần 2 → DELETE-wrong-scope không khớp + INSERT trúng ON CONFLICT = no-op.
--   LEAST-PRIVILEGE: manager KHÔNG có hàng shift/shift-assignment/attendance-rule/attendance-audit-log.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- (role_name, action, resource_type, data_scope). "-" trong ma trận = KHÔNG có hàng.
  grants CONSTANT text[][] := ARRAY[
    -- ATTENDANCE.CHECK_IN (Own cho cả 4)
    ['employee',      'check-in',       'attendance',           'Own'],
    ['manager',       'check-in',       'attendance',           'Own'],
    ['hr',            'check-in',       'attendance',           'Own'],
    ['company-admin', 'check-in',       'attendance',           'Own'],
    -- ATTENDANCE.CHECK_OUT (Own cho cả 4)
    ['employee',      'check-out',      'attendance',           'Own'],
    ['manager',       'check-out',      'attendance',           'Own'],
    ['hr',            'check-out',      'attendance',           'Own'],
    ['company-admin', 'check-out',      'attendance',           'Own'],
    -- ATTENDANCE.VIEW_OWN (Own cho cả 4)
    ['employee',      'view-own',       'attendance',           'Own'],
    ['manager',       'view-own',       'attendance',           'Own'],
    ['hr',            'view-own',       'attendance',           'Own'],
    ['company-admin', 'view-own',       'attendance',           'Own'],
    -- ATTENDANCE.VIEW_TEAM (manager=Team, hr=Team, company-admin=Team — API-10 §5.3 max=Team)
    ['manager',       'view-team',      'attendance',           'Team'],
    ['hr',            'view-team',      'attendance',           'Team'],
    ['company-admin', 'view-team',      'attendance',           'Team'],
    -- ATTENDANCE.VIEW_COMPANY (hr/company-admin=Company)
    ['hr',            'view-company',   'attendance',           'Company'],
    ['company-admin', 'view-company',   'attendance',           'Company'],
    -- ATTENDANCE.VIEW_DETAIL (employee=Own, manager=Team, hr=Company, company-admin=Company)
    ['employee',      'view-detail',    'attendance',           'Own'],
    ['manager',       'view-detail',    'attendance',           'Team'],
    ['hr',            'view-detail',    'attendance',           'Company'],
    ['company-admin', 'view-detail',    'attendance',           'Company'],
    -- ATTENDANCE.VIEW_SENSITIVE (hr/company-admin=Company; manager/employee KHÔNG)
    ['hr',            'view-sensitive', 'attendance',           'Company'],
    ['company-admin', 'view-sensitive', 'attendance',           'Company'],
    -- ATTENDANCE.ADJUST_DIRECT (hr/company-admin=Company)
    ['hr',            'adjust-direct',  'attendance',           'Company'],
    ['company-admin', 'adjust-direct',  'attendance',           'Company'],
    -- ATTENDANCE.RECALCULATE (hr/company-admin=Company)
    ['hr',            'recalculate',    'attendance',           'Company'],
    ['company-admin', 'recalculate',    'attendance',           'Company'],
    -- ATTENDANCE.EXPORT (hr/company-admin=Company)
    ['hr',            'export',         'attendance',           'Company'],
    ['company-admin', 'export',         'attendance',           'Company'],
    -- ADJUSTMENT.CREATE_OWN (Own cho cả 4)
    ['employee',      'create-own',     'adjustment',           'Own'],
    ['manager',       'create-own',     'adjustment',           'Own'],
    ['hr',            'create-own',     'adjustment',           'Own'],
    ['company-admin', 'create-own',     'adjustment',           'Own'],
    -- ADJUSTMENT.VIEW_OWN (Own cho cả 4)
    ['employee',      'view-own',       'adjustment',           'Own'],
    ['manager',       'view-own',       'adjustment',           'Own'],
    ['hr',            'view-own',       'adjustment',           'Own'],
    ['company-admin', 'view-own',       'adjustment',           'Own'],
    -- ADJUSTMENT.VIEW_TEAM (manager=Team, hr=Team, company-admin=Team — API-10 §5.3 max=Team)
    ['manager',       'view-team',      'adjustment',           'Team'],
    ['hr',            'view-team',      'adjustment',           'Team'],
    ['company-admin', 'view-team',      'adjustment',           'Team'],
    -- ADJUSTMENT.VIEW_COMPANY (hr/company-admin=Company)
    ['hr',            'view-company',   'adjustment',           'Company'],
    ['company-admin', 'view-company',   'adjustment',           'Company'],
    -- ADJUSTMENT.APPROVE (manager=Team, hr=Company, company-admin=Company)
    ['manager',       'approve',        'adjustment',           'Team'],
    ['hr',            'approve',        'adjustment',           'Company'],
    ['company-admin', 'approve',        'adjustment',           'Company'],
    -- ADJUSTMENT.REJECT (manager=Team, hr=Company, company-admin=Company)
    ['manager',       'reject',         'adjustment',           'Team'],
    ['hr',            'reject',         'adjustment',           'Company'],
    ['company-admin', 'reject',         'adjustment',           'Company'],
    -- ADJUSTMENT.CANCEL_OWN (Own cho cả 4)
    ['employee',      'cancel-own',     'adjustment',           'Own'],
    ['manager',       'cancel-own',     'adjustment',           'Own'],
    ['hr',            'cancel-own',     'adjustment',           'Own'],
    ['company-admin', 'cancel-own',     'adjustment',           'Own'],
    -- REMOTE_REQUEST.CREATE_OWN (Own cho cả 4)
    ['employee',      'create-own',     'remote-request',       'Own'],
    ['manager',       'create-own',     'remote-request',       'Own'],
    ['hr',            'create-own',     'remote-request',       'Own'],
    ['company-admin', 'create-own',     'remote-request',       'Own'],
    -- REMOTE_REQUEST.VIEW_OWN (Own cho cả 4)
    ['employee',      'view-own',       'remote-request',       'Own'],
    ['manager',       'view-own',       'remote-request',       'Own'],
    ['hr',            'view-own',       'remote-request',       'Own'],
    ['company-admin', 'view-own',       'remote-request',       'Own'],
    -- REMOTE_REQUEST.VIEW_TEAM (manager=Team, hr=Team, company-admin=Team — API-10 §5.3 max=Team)
    ['manager',       'view-team',      'remote-request',       'Team'],
    ['hr',            'view-team',      'remote-request',       'Team'],
    ['company-admin', 'view-team',      'remote-request',       'Team'],
    -- REMOTE_REQUEST.VIEW_COMPANY (hr/company-admin=Company)
    ['hr',            'view-company',   'remote-request',       'Company'],
    ['company-admin', 'view-company',   'remote-request',       'Company'],
    -- REMOTE_REQUEST.APPROVE (manager=Team, hr=Company, company-admin=Company)
    ['manager',       'approve',        'remote-request',       'Team'],
    ['hr',            'approve',        'remote-request',       'Company'],
    ['company-admin', 'approve',        'remote-request',       'Company'],
    -- REMOTE_REQUEST.REJECT (manager=Team, hr=Company, company-admin=Company)
    ['manager',       'reject',         'remote-request',       'Team'],
    ['hr',            'reject',         'remote-request',       'Company'],
    ['company-admin', 'reject',         'remote-request',       'Company'],
    -- REMOTE_REQUEST.CANCEL_OWN (Own cho cả 4)
    ['employee',      'cancel-own',     'remote-request',       'Own'],
    ['manager',       'cancel-own',     'remote-request',       'Own'],
    ['hr',            'cancel-own',     'remote-request',       'Own'],
    ['company-admin', 'cancel-own',     'remote-request',       'Own'],
    -- SHIFT.VIEW (hr/company-admin=Company — manager KHÔNG)
    ['hr',            'view',           'shift',                'Company'],
    ['company-admin', 'view',           'shift',                'Company'],
    -- SHIFT.CREATE (hr/company-admin=Company)
    ['hr',            'create',         'shift',                'Company'],
    ['company-admin', 'create',         'shift',                'Company'],
    -- SHIFT.UPDATE (hr/company-admin=Company)
    ['hr',            'update',         'shift',                'Company'],
    ['company-admin', 'update',         'shift',                'Company'],
    -- SHIFT.DELETE (hr/company-admin=Company)
    ['hr',            'delete',         'shift',                'Company'],
    ['company-admin', 'delete',         'shift',                'Company'],
    -- SHIFT_ASSIGNMENT.VIEW (hr/company-admin=Company — manager KHÔNG)
    ['hr',            'view',           'shift-assignment',     'Company'],
    ['company-admin', 'view',           'shift-assignment',     'Company'],
    -- SHIFT_ASSIGNMENT.UPDATE (hr/company-admin=Company)
    ['hr',            'update',         'shift-assignment',     'Company'],
    ['company-admin', 'update',         'shift-assignment',     'Company'],
    -- RULE.VIEW (hr/company-admin=Company — manager KHÔNG)
    ['hr',            'view',           'attendance-rule',      'Company'],
    ['company-admin', 'view',           'attendance-rule',      'Company'],
    -- RULE.CONFIG (hr/company-admin=Company)
    ['hr',            'config',         'attendance-rule',      'Company'],
    ['company-admin', 'config',         'attendance-rule',      'Company'],
    -- AUDIT_LOG.VIEW (hr/company-admin=Company — manager KHÔNG)
    ['hr',            'view',           'attendance-audit-log', 'Company'],
    ['company-admin', 'view',           'attendance-audit-log', 'Company']
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
      RAISE EXCEPTION '[0454] role canonical % không tồn tại — mig 0444 phải chạy trước', g[1];
    END IF;

    -- resolve permission (catalog gap (a) phải đã chạy)
    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0454] permission (%:%) không có trong catalog — seed (a) phải chạy trước', g[2], g[3];
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

  RAISE NOTICE '[0454] ATT seed: % cặp INSERT mới, % cặp re-scope (DELETE wrong-scope+INSERT)',
    v_seeded, v_rescoped;
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id
--     AND r.name IN ('employee','manager','hr','company-admin') AND r.company_id IS NULL
--     AND p.resource_type IN ('attendance','adjustment','remote-request','shift','shift-assignment',
--                             'attendance-rule','attendance-audit-log');
-- DELETE FROM permissions WHERE resource_type IN
--   ('attendance','adjustment','remote-request','shift','shift-assignment','attendance-rule','attendance-audit-log');
