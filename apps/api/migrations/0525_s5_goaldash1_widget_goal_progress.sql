-- Migration 0525: S5-GOAL-DASH-1 — widget "Mục tiêu kỳ này" (SPEC-10 §7 + §13, SPEC-07 DASH).
--
-- MỤC TIÊU: thêm 1 widget GLOBAL mới (GOAL_PROGRESS) vào catalog dashboard_widgets (mig 0482), mirror
-- khối (1) của 0493 (INSERT dashboard_widgets, company_id NULL). THUẦN ADDITIVE — KHÔNG đụng row/cột cũ.
--
-- HOT-FILE APPEND (CLAUDE.md §9.3): `chk_dashboard_widgets_module_code` là CHECK UNION — module_code catalog
-- CHƯA có 'GOAL' (0482 chỉ liệt 8 module MVP gốc, GOAL land SAU ở 0504+). ALTER = DROP + ADD CONSTRAINT với
-- UNION đúng: giữ nguyên 8 giá trị cũ + THÊM 'GOAL' — KHÔNG bớt giá trị nào (tránh bẫy "CHECK union parse-anchor"
-- đã cắn trước đây, memory audit-check-union-parse-anchor-trap).
--
-- KHÔNG cần seed permission/role_permissions: widget gate bằng cặp NGUỒN ('view','goal') ĐÃ seed + grant đủ 4
-- role canonical ở migration 0506 (S5-GOAL-DB-1) — Option B (DASH_WIDGET_GATE_PAIR, KHÔNG cặp per-widget
-- '*:dashboard-widget'). Migration này vì vậy THUẦN DATA + 1 ALTER CHECK (không INSERT permissions/role_permissions).
--
-- dashboard_widget_configs (per-company default hiển thị) KHÔNG seed ở migration (company_id NOT NULL, company
-- mặc định chỉ tồn tại SAU boot) — seed RUNTIME qua DashboardConfigSeeder đọc DASH_DEFAULT_CONFIG const (bump
-- seedVersion v1→v2 ở code BE để force re-seed công ty đã tồn tại, mirror doc-block dashboard-config.seeder.ts).
--
-- BAND 0525-0529 (lane goaldash1). Journal: idx 192, when 1717587314000 (> head 0511 idx 191 / 1717587313000).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) CHECK union APPEND — thêm 'GOAL' vào chk_dashboard_widgets_module_code ───────────────
ALTER TABLE dashboard_widgets DROP CONSTRAINT IF EXISTS chk_dashboard_widgets_module_code;
ALTER TABLE dashboard_widgets ADD CONSTRAINT chk_dashboard_widgets_module_code
  CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL'));

-- ─────────────── (2) Catalog widget GLOBAL (company_id NULL) — GOAL_PROGRESS ───────────────
-- ON CONFLICT arbiter = partial unique uq_dashboard_widgets_global_code_active (0482):
--   ON (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL → predicate lặp lại ở WHERE.
INSERT INTO dashboard_widgets (
  company_id, widget_code, module_code, name, widget_type,
  required_permission_code, default_data_scope, data_source_key, component_key,
  is_system_widget, status, sort_order
) VALUES (
  NULL, 'GOAL_PROGRESS', 'GOAL', 'Mục tiêu kỳ này', 'Chart',
  'DASH.WIDGET.VIEW_GOAL_PROGRESS', 'Department', 'goal-progress', 'GoalProgressWidget',
  true, 'Active', 60
)
ON CONFLICT (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM dashboard_widgets WHERE company_id IS NULL AND widget_code = 'GOAL_PROGRESS';
-- ALTER TABLE dashboard_widgets DROP CONSTRAINT IF EXISTS chk_dashboard_widgets_module_code;
-- ALTER TABLE dashboard_widgets ADD CONSTRAINT chk_dashboard_widgets_module_code
--   CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM'));
