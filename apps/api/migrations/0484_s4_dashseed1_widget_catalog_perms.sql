-- Migration 0484: S4-DASH-SEED-1 (🔴 RED) — SEED catalog widget DASH (7 widget in-sprint) + catalog quyền
--   DASH (7 cặp) + role grants + GRANT INSERT trên dashboard_widget_configs.
--   THUẦN ADDITIVE DATA + 1 GRANT — KHÔNG DDL, KHÔNG db:generate. NỐI TIẾP 0483 (S4-NOTI-BE-1).
--
-- BAND 0484. Journal: idx 164, when 1717500815000 (> head 0483 idx 163 / 1717500810000).
--
-- ═══ NGUỒN SỰ THẬT (mọi con số neo file:dòng — docs/plans/S4-DASH-SEED-1.md §1) ═══
--   • grant per-role           → docs/API Design/API-10 PERMISSION MATRIX.md:283-312
--   • required_permission_code → docs/DB/DB-07 §8.5 (dòng 1109-1123)
--   • default dashboard        → docs/DB/DB-07 §14.3 (dòng 2147+)  [seed CONFIG = code seeder, không ở đây]
--   • tập widget in-sprint     → docs/IMPLEMENTATION/IMPLEMENTATION-07 §11.3 (dòng 739-745)
--   • mô hình gate widget      → docs/permission-matrix-spec.md §7 (dòng 144)
--   Mốc chống drift dùng chung: apps/api/src/dashboard/dashboard-widget-catalog.const.ts
--
-- ═══ SEED QUA MIGRATOR OWNER (không qua app role) ═══
--   dashboard_widgets (0482) có company_id NULLABLE, RLS+FORCE bật, app role CHỈ GRANT SELECT (0482:104).
--   Row GLOBAL (company_id NULL) chỉ ghi được qua TABLE-OWNER: migrator chạy DATABASE_DIRECT_URL = role
--   owner mediaos (rolbypassrls=true) ⇒ INSERT company_id NULL chạy trực tiếp. WITH CHECK(company_id=GUC)
--   của 0482 chỉ chặn app role, KHÔNG chặn owner-bypass. Mirror 0481.
--
-- ═══ OWNER CHỐT 2026-07-10 ═══
--   (a) TRIM MVP: seed ĐÚNG 7 widget in-sprint. DB-07 §14.3 còn xếp LEAVE_BALANCE / TEAM_TASKS_TODAY /
--       LEAVE_CALENDAR / ATTENDANCE_ALERTS / NEW_EMPLOYEES / CONTRACT_EXPIRING / USER_SUMMARY /
--       EMPLOYEE_SUMMARY / MODULE_STATUS / CONFIG_WARNINGS / SYSTEM_LOGS — chưa có data source ⇒ KHÔNG seed.
--       DRIFT đã ghi vào DB-07 §14.3. (DB-07 tự mâu thuẫn: §8.5 chỉ liệt 12 widget, §14.3 dùng 5 widget
--       Admin KHÔNG có required_permission_code ở §8.5 — chúng chỉ có code ở API-10.)
--   (b) OPTION B: KHÔNG seed cặp per-widget '*:dashboard-widget'. required_permission_code lưu chuỗi SPEC
--       verbatim; gate thật = cặp module nguồn (DASH_WIDGET_GATE_PAIR trong const registry).
--   (c) KHÔNG seed 'refresh:dashboard-cache' (DASH.CACHE.REFRESH): API-10:313 cấp cho SA DUY NHẤT mà ta
--       không enumerate super-admin ⇒ không có role nào để grant; nó cũng "không có endpoint" và vắng mặt
--       ở DB-07 §10.2. Seed bây giờ = quyền phantom không deny-path.
--
-- ═══ BẤT BIẾN (CLAUDE.md §2/§3/§9) ═══
--   #1 tenant : widgets GLOBAL company_id NULL (owner-bypass). KHÔNG đụng RLS/FORCE/policy của 0482.
--   #2 no hard-delete: GRANT trên dashboard_widget_configs CHỈ 'INSERT' — KHÔNG DELETE, KHÔNG UPDATE.
--       Bảng anh em dashboard_widget_cache (0482:231-232) cố ý no-DELETE với comment "KHÔNG DELETE (BẤT BIẾN
--       #2 soft-delete)"; configs cũng có deleted_at (0482:133). Rút config default về sau = soft-delete
--       UPDATE deleted_at, thuộc S4-DASH-BE. DELETE trên role_permissions ở khối (3) là RE-SCOPE per-pair
--       lúc migrate-time (owner role), KHÔNG phải app runtime — mirror 0480/0481/0444.
--   #3 no secret: seed data = catalog/permission, không PII/secret.
--
--   Hot-file APPEND: permissions + role_permissions dùng ON CONFLICT DO NOTHING, KHÔNG rewrite.
--   Chạy lại: khối (1)(2) DO NOTHING; khối (3) DELETE-scope-sai 0 dòng + INSERT ON CONFLICT ⇒ KHÔNG drift.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────── (1) Catalog widget GLOBAL (company_id NULL) ───────────────────
-- ON CONFLICT arbiter = partial unique uq_dashboard_widgets_global_code_active (0482:93-95):
--   ON (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL  → predicate PHẢI lặp lại ở WHERE.
INSERT INTO dashboard_widgets (
  company_id, widget_code, module_code, name, widget_type,
  required_permission_code, default_data_scope, data_source_key, component_key,
  is_system_widget, status, sort_order
) VALUES
  (NULL, 'ATTENDANCE_TODAY', 'ATT',   'Chấm công hôm nay',         'Summary', 'DASH.WIDGET.VIEW_ATTENDANCE_TODAY', 'Own',     'attendance-today', 'AttendanceTodayWidget', true, 'Active', 10),
  (NULL, 'MY_TASKS',         'TASK',  'Task của tôi',              'List',    'DASH.WIDGET.VIEW_MY_TASKS',         'Own',     'my-tasks',         'MyTasksWidget',         true, 'Active', 20),
  (NULL, 'TASK_ALERTS',      'TASK',  'Task sắp đến hạn/quá hạn',  'Alert',   'DASH.WIDGET.VIEW_TASK_ALERTS',      'Own',     'task-alerts',      'TaskAlertsWidget',      true, 'Active', 30),
  (NULL, 'NOTIFICATIONS',    'NOTI',  'Thông báo mới',             'List',    'DASH.WIDGET.VIEW_NOTIFICATIONS',    'Own',     'notifications',    'NotificationsWidget',   true, 'Active', 50),
  (NULL, 'PENDING_LEAVE',    'LEAVE', 'Đơn nghỉ chờ duyệt',        'List',    'DASH.WIDGET.VIEW_PENDING_LEAVE',    'Team',    'pending-leave',    'PendingLeaveWidget',    true, 'Active', 60),
  (NULL, 'PROJECT_PROGRESS', 'TASK',  'Tiến độ dự án',             'Chart',   'DASH.WIDGET.VIEW_PROJECT_PROGRESS', 'Project', 'project-progress', 'ProjectProgressWidget', true, 'Active', 70),
  (NULL, 'HR_OVERVIEW',      'HR',    'Tổng quan nhân sự',         'Summary', 'DASH.WIDGET.VIEW_HR_OVERVIEW',      'Company', 'hr-overview',      'HrOverviewWidget',      true, 'Active', 80)
ON CONFLICT (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────────────── (2) Catalog quyền DASH — 7 cặp mới ───────────────────
-- KHÔNG đụng ('read','dashboard') của mig 0100. KHÔNG seed '*:dashboard-widget' (Option B).
-- KHÔNG seed ('refresh','dashboard-cache') — xem header (c).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view-employee', 'dashboard',           false),  -- DASH.DASHBOARD.VIEW_EMPLOYEE  API-10:284
  ('view-manager',  'dashboard',           true),   -- DASH.DASHBOARD.VIEW_MANAGER   API-10:285
  ('view-hr',       'dashboard',           true),   -- DASH.DASHBOARD.VIEW_HR        API-10:286
  ('view-admin',    'dashboard',           true),   -- DASH.DASHBOARD.VIEW_ADMIN     API-10:287
  ('view',          'dashboard-config',    true),   -- DASH.CONFIG.VIEW              API-10:310
  ('update',        'dashboard-config',    true),   -- DASH.CONFIG.UPDATE            API-10:311
  ('view',          'dashboard-audit-log', true)    -- DASH.AUDIT_LOG.VIEW           API-10:312
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────────── (3) Role grants (API-10:283-312) ───────────────────
-- super-admin KHÔNG enumerate: roles company_id IS NULL không có row 'super-admin' (grant runtime qua
-- SuperAdminBootstrap) ⇒ liệt kê nó sẽ RAISE. Mirror 0481:35-36.
--
-- data_scope: API-10 cột Scope = 'per-widget' cho 4 cặp dashboard-type ⇒ giá trị KHÔNG mang ngữ nghĩa lọc
-- (data scope thật do cặp module nguồn ép — permission-matrix-spec §7). Chọn 'Own' = least-privilege: nếu
-- DASH-BE lỡ dùng data_scope của cặp này thì nó CHẶN CHẶT HƠN, không nới ngầm. config/audit → 'Company'
-- (API-10:310-312).
DO $$
DECLARE
  -- {role, action, resource_type, data_scope}
  dash_grants CONSTANT text[][] := ARRAY[
    -- API-10:284 — EMP, MGR, HR, CA, SA
    ['employee',      'view-employee', 'dashboard',           'Own'],
    ['manager',       'view-employee', 'dashboard',           'Own'],
    ['hr',            'view-employee', 'dashboard',           'Own'],
    ['company-admin', 'view-employee', 'dashboard',           'Own'],
    -- API-10:285 — MGR, HR(✓), CA, SA   ← 'hr' CÓ (plan v3 bỏ sót)
    ['manager',       'view-manager',  'dashboard',           'Own'],
    ['hr',            'view-manager',  'dashboard',           'Own'],
    ['company-admin', 'view-manager',  'dashboard',           'Own'],
    -- API-10:286 — HR, CA(✓), SA
    ['hr',            'view-hr',       'dashboard',           'Own'],
    ['company-admin', 'view-hr',       'dashboard',           'Own'],
    -- API-10:287 — CA, SA
    ['company-admin', 'view-admin',    'dashboard',           'Own'],
    -- API-10:310-312 — CA, SA
    ['company-admin', 'view',          'dashboard-config',    'Company'],
    ['company-admin', 'update',        'dashboard-config',    'Company'],
    ['company-admin', 'view',          'dashboard-audit-log', 'Company']
  ];
  g          text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY dash_grants LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0484] role canonical % không tồn tại — seed 0005/0444 phải chạy trước', g[1];
    END IF;

    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0484] permission (%:%) không có trong catalog — khối (2) phải chạy trước', g[2], g[3];
    END IF;

    -- DELETE đúng bộ (role_id, permission_id, 'ALLOW') có scope SAI — per-pair, KHÔNG blanket theo role_id.
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

  RAISE NOTICE '[0484] DASH grant: % INSERT mới, % re-scope', v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ─────────────────── (4) GRANT INSERT cho app role trên dashboard_widget_configs ───────────────────
-- 0482:171 để app SELECT-only. DashboardConfigSeeder chạy trong tenant tx do MasterDataSeedRunner cấp
-- (role mediaos_app) nên cần INSERT, nếu không sẽ "permission denied for table".
-- CHỈ INSERT: seeder chỉ làm INSERT ... WHERE NOT EXISTS (master-data-seeder.types.ts:15 "Seeder CHỈ làm
-- INSERT"). UPDATE để dành S4-DASH-BE (soft-delete qua deleted_at). DELETE: KHÔNG BAO GIỜ (BẤT BIẾN #2).
-- RLS + FORCE của 0482 vẫn cô lập theo tenant ⇒ mở INSERT không rò chéo company.
GRANT INSERT ON dashboard_widget_configs TO mediaos_app;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- REVOKE INSERT ON dashboard_widget_configs FROM mediaos_app;
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id AND r.company_id IS NULL
--     AND (p.resource_type IN ('dashboard-config','dashboard-audit-log')
--          OR (p.resource_type='dashboard' AND p.action LIKE 'view-%'));
-- DELETE FROM permissions WHERE resource_type IN ('dashboard-config','dashboard-audit-log')
--    OR (resource_type='dashboard' AND action LIKE 'view-%');
-- DELETE FROM dashboard_widgets WHERE company_id IS NULL AND widget_code IN
--   ('ATTENDANCE_TODAY','MY_TASKS','TASK_ALERTS','NOTIFICATIONS','PENDING_LEAVE','PROJECT_PROGRESS','HR_OVERVIEW');
