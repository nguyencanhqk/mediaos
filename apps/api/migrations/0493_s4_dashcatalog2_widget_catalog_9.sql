-- Migration 0493: S4-DASH-CATALOG-2 (🔴 RED) — bù đủ catalog widget DASH: SEED 9 widget GLOBAL còn thiếu.
--   MIRROR khối (1) của 0484 (INSERT dashboard_widgets, company_id NULL). THUẦN ADDITIVE DATA.
--   KHÔNG DDL, KHÔNG db:generate, KHÔNG INSERT permissions, KHÔNG INSERT role_permissions. NỐI TIẾP 0492.
--
-- BAND 0493. Journal: idx 173, when 1717500860000 (> head 0492 idx 172 / 1717500855000).
--
-- ═══ NGUỒN SỰ THẬT — bảng LOCK 7 cột (docs/plans/S4-DASH-CATALOG-2.md §"LOCK — Bảng metadata 9 widget") ═══
--   const registry chống drift dùng chung : apps/api/src/dashboard/dashboard-widget-catalog.const.ts
--   required_permission_code (verbatim)   : docs/API Design/API-10 PERMISSION MATRIX.md:291-305
--   bảng widget→permission (§8.1, KHÔNG §8.5): docs/DB/DB-07 §8.1 (dòng ~1110-1129) [§8.5 = cache_invalidations]
--   default dashboard (config seeder)      : docs/DB/DB-07 §14.3 (dòng ~2151-2170)
--
-- ═══ SEED QUA MIGRATOR OWNER (không qua app role) — MIRROR 0484 header ═══
--   dashboard_widgets (0482) có company_id NULLABLE, RLS+FORCE bật, app role CHỈ GRANT SELECT (0482:104).
--   Row GLOBAL (company_id NULL) chỉ ghi được qua TABLE-OWNER: migrator chạy DATABASE_DIRECT_URL = role owner
--   mediaos (rolbypassrls=true) ⇒ INSERT company_id NULL chạy trực tiếp. WITH CHECK(company_id=GUC) của 0482
--   chỉ chặn app role, KHÔNG chặn owner-bypass. Mirror 0484:15-19.
--
-- ═══ OWNER CHỐT 2026-07-11 (Trim-MVP đợt 2) ═══
--   (a) SEED ĐÚNG 9 widget đã có read-service nguồn + gate-pair engine thật. TỔNG catalog = 7 (0484) + 9 = 16.
--   (b) DEFER 2 widget (KHÔNG seed row / gate-pair / default-config):
--       • TEAM_TASKS_TODAY — KHÔNG có resolver viewer→teamId sạch (resolveContext trả managedUserIds+org-units,
--         KHÔNG teamId; TasksService.listByTeam nhận teamId tường minh + chỉ tenant-guard). Owner defer.
--       • CONFIG_WARNINGS  — chưa có read-service warnings cấu hình hệ thống ⇒ seed sẽ luôn degraded.
--   (c) OPTION B (0484): KHÔNG seed cặp per-widget '*:dashboard-widget'. required_permission_code lưu chuỗi
--       SPEC verbatim; gate thật = cặp module nguồn (DASH_WIDGET_GATE_PAIR trong const registry).
--   (d) KHÔNG seed 'refresh:dashboard-cache' (SA-only, no-endpoint, vắng ở DB-07 §10.2 — quyền phantom).
--
-- ═══ GATE-PAIR (mọi cặp ĐÃ TỒN TẠI + ĐÃ GRANT — migration này KHÔNG đụng permissions/role_permissions) ═══
--   USER_SUMMARY      → view:user            perm 0444:39  (grant hr 0444:88 · CA 0444:89)
--   EMPLOYEE_SUMMARY  → read:employee        perm 0019:19
--   MODULE_STATUS     → view:foundation-module perm 0435:338 (is_sensitive=false)
--   SYSTEM_LOGS       → view:audit-log        perm 0340:31  (SENSITIVE · grant CA 0340:38-40)  ← CROWN
--   LEAVE_BALANCE     → view-own:leave-balance perm 0455:59 (grant 4 role 0455:136-139)
--   NEW_EMPLOYEES     → read:employee        perm 0019:19
--   CONTRACT_EXPIRING → view:contract        perm 0462:157 (grant hr/CA 0462:169-170)
--   LEAVE_CALENDAR    → view-team:leave-calendar perm 0455:65
--   ATTENDANCE_ALERTS → view-team:attendance perm 0454:36
--
-- ═══ BẤT BIẾN (CLAUDE.md §2/§3/§9) ═══
--   #1 tenant : widgets GLOBAL company_id NULL (owner-bypass). KHÔNG đụng RLS/FORCE/policy WITH CHECK của 0482.
--       Widget CHỈ ĐỌC (catalog) ⇒ KHÔNG backfill company_id ⇒ không thuộc luật "RLS-trước-backfill".
--       dashboard_widget_configs / dashboard_widget_cache vẫn RLS+FORCE cô lập tenant (0482) — KHÔNG đụng.
--   #2 append-only / no hard-delete: INSERT ... ON CONFLICT DO NOTHING. KHÔNG UPDATE, KHÔNG DELETE.
--       KHÔNG INSERT role_permissions (không re-scope grant). Chạy lại = 0 dòng đổi (idempotent).
--   #3 no secret/PII: seed data = catalog metadata (code/name/type), KHÔNG PII/secret.
--
--   Hot-file APPEND: file migration MỚI, KHÔNG sửa 0484. ON CONFLICT DO NOTHING ⇒ không rewrite row đã land.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────── (1) Catalog widget GLOBAL (company_id NULL) — 9 widget đợt 2 ───────────────────
-- ON CONFLICT arbiter = partial unique uq_dashboard_widgets_global_code_active (0482:93-95):
--   ON (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL  → predicate PHẢI lặp lại ở WHERE.
-- Cột + thứ tự MIRROR 0484:49-53. Giá trị transcribe verbatim từ bảng LOCK (docs/plans/S4-DASH-CATALOG-2.md).
INSERT INTO dashboard_widgets (
  company_id, widget_code, module_code, name, widget_type,
  required_permission_code, default_data_scope, data_source_key, component_key,
  is_system_widget, status, sort_order
) VALUES
  (NULL, 'USER_SUMMARY',      'AUTH',   'Tổng số user',           'Summary',  'DASH.WIDGET.VIEW_USER_SUMMARY',      'Company', 'user-summary',      'UserSummaryWidget',      true, 'Active', 10),
  (NULL, 'EMPLOYEE_SUMMARY',  'HR',     'Tổng số nhân viên',      'Summary',  'DASH.WIDGET.VIEW_EMPLOYEE_SUMMARY',  'Company', 'employee-summary',  'EmployeeSummaryWidget',  true, 'Active', 20),
  (NULL, 'MODULE_STATUS',     'SYSTEM', 'Module đang dùng',       'List',     'DASH.WIDGET.VIEW_MODULE_STATUS',     'Company', 'module-status',     'ModuleStatusWidget',     true, 'Active', 30),
  (NULL, 'SYSTEM_LOGS',       'SYSTEM', 'Log quan trọng gần đây', 'Summary',  'DASH.WIDGET.VIEW_SYSTEM_LOGS',       'Company', 'system-logs',       'SystemLogsWidget',       true, 'Active', 50),
  (NULL, 'LEAVE_BALANCE',     'LEAVE',  'Số ngày phép còn lại',   'Summary',  'DASH.WIDGET.VIEW_LEAVE_BALANCE',     'Own',     'leave-balance',     'LeaveBalanceWidget',     true, 'Active', 40),
  (NULL, 'NEW_EMPLOYEES',     'HR',     'Nhân sự mới',            'List',     'DASH.WIDGET.VIEW_NEW_EMPLOYEES',     'Company', 'new-employees',     'NewEmployeesWidget',     true, 'Active', 20),
  (NULL, 'CONTRACT_EXPIRING', 'HR',     'Hợp đồng sắp hết hạn',   'Alert',    'DASH.WIDGET.VIEW_CONTRACT_EXPIRING', 'Company', 'contract-expiring', 'ContractExpiringWidget', true, 'Active', 30),
  (NULL, 'LEAVE_CALENDAR',    'LEAVE',  'Lịch nghỉ team',         'Calendar', 'DASH.WIDGET.VIEW_LEAVE_CALENDAR',    'Team',    'leave-calendar',    'LeaveCalendarWidget',    true, 'Active', 40),
  (NULL, 'ATTENDANCE_ALERTS', 'ATT',    'Bất thường chấm công',   'Alert',    'DASH.WIDGET.VIEW_ATTENDANCE_ALERTS', 'Team',    'attendance-alerts', 'AttendanceAlertsWidget', true, 'Active', 50)
ON CONFLICT (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM dashboard_widgets WHERE company_id IS NULL AND widget_code IN
--   ('USER_SUMMARY','EMPLOYEE_SUMMARY','MODULE_STATUS','SYSTEM_LOGS','LEAVE_BALANCE','NEW_EMPLOYEES',
--    'CONTRACT_EXPIRING','LEAVE_CALENDAR','ATTENDANCE_ALERTS');
