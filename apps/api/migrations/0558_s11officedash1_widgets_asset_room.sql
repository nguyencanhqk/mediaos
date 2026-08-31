-- Migration 0558: S11-OFFICE-DASH-1 — 2 widget DASH cho wave OFFICE (SPEC-13 §AS-10 · SPEC-14 §RM-08).
--
-- MỤC TIÊU: thêm 2 widget GLOBAL vào catalog `dashboard_widgets` (mig 0482) — mirror khuôn mig 0525
-- (S5-GOAL-DASH-1, widget GOAL_PROGRESS). THUẦN ADDITIVE — KHÔNG đụng row/cột/constraint nào khác.
--   • ASSET_SUMMARY — "Thống kê tài sản" (SPEC-13 §116 AS-10 · §244 ASSET-FUNC-014 · §407 ASSET-API-024):
--     đếm theo `status` × loại trong phạm vi data_scope người gọi, nguồn `AssetsService.summary()`.
--   • ROOM_TODAY   — "Lịch họp hôm nay" (SPEC-14 §121 RM-08 · §157): đọc lượt đặt CỦA CHÍNH người xem
--     trong ngày HÔM NAY theo múi giờ CÔNG TY (SPEC-14 §83 — KHÔNG theo múi giờ trình duyệt), nguồn
--     `RoomBookingsService.listMine()`.
--
-- HOT-FILE APPEND (CLAUDE.md §9.3): `chk_dashboard_widgets_module_code` là CHECK UNION — catalog CHƯA có
-- 'ASSET'/'ROOM' (0482 liệt 8 module MVP gốc; 0525 append 'GOAL'). ALTER = DROP + ADD CONSTRAINT với UNION
-- ĐÚNG: giữ nguyên 9 giá trị cũ + THÊM 2 — KHÔNG bớt giá trị nào (bẫy "CHECK union parse-anchor" đã cắn
-- trước đây, memory `audit-check-union-parse-anchor-trap`).
--
-- KHÔNG seed permission/role_permissions: widget gate bằng cặp NGUỒN ('view','asset') / ('view','room') ĐÃ
-- seed + grant ở mig 0550 (ASSET) và 0554 (ROOM) — Option B (`DASH_WIDGET_GATE_PAIR`, KHÔNG cặp per-widget
-- '*:dashboard-widget'). Migration này vì vậy THUẦN DATA + 1 ALTER CHECK.
--
-- CỔNG PHỤ CHO ASSET_SUMMARY (KHÔNG ở migration): 4 role canonical ĐỀU có ('view','asset') nhưng ở scope
-- KHÁC nhau (0550: employee@Own · manager@Department · hr/company-admin@Company · asset-manager@Company).
-- SPEC-13 §482 chốt "nhân viên thường KHÔNG thấy widget (không gọi API)" ⇒ sàn scope `Department` ép ở tầng
-- ứng dụng (`DASH_WIDGET_MIN_DATA_SCOPE`, gác CẢ registry metadata LẪN handler data). KHÔNG ép được bằng
-- CHECK/RLS vì scope là thuộc tính của GRANT, không phải của hàng catalog.
--
-- `dashboard_widget_configs` (default hiển thị per-company) KHÔNG seed ở migration (company_id NOT NULL,
-- company mặc định chỉ tồn tại SAU boot) — seed RUNTIME qua `DashboardConfigSeeder` đọc `DASH_DEFAULT_CONFIG`
-- (bump seedVersion v2→v3 ở code BE để force re-seed công ty đã tồn tại).
--
-- KHÔNG đụng `apps/api/src/db/schema/dashboard.ts` (CHECK ở đó vẫn liệt 8 module gốc — drift CỐ Ý từ 0525):
-- migration là nguồn DDL thật, sửa file schema sẽ đẻ diff `db:generate` giả. Ghi lại ở đây để không quên.
--
-- BAND 0558-0559 (lane officedash1). Journal: idx 225, when 1717587347000 (> head 0557 idx 224).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────── (1) CHECK union APPEND — thêm 'ASSET','ROOM' vào chk_dashboard_widgets_module_code ───────────
ALTER TABLE dashboard_widgets DROP CONSTRAINT IF EXISTS chk_dashboard_widgets_module_code;
ALTER TABLE dashboard_widgets ADD CONSTRAINT chk_dashboard_widgets_module_code
  CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','ASSET','ROOM'));
--> statement-breakpoint

-- ─────────── (2) Catalog widget GLOBAL (company_id NULL) — ASSET_SUMMARY + ROOM_TODAY ───────────
-- ON CONFLICT arbiter = partial unique uq_dashboard_widgets_global_code_active (0482):
--   ON (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL → predicate lặp lại ở WHERE.
--
-- `default_data_scope` lấy CẬN DƯỚI theo thói quen catalog (cột đơn-giá-trị; BE nới theo quyền lúc runtime):
--   ASSET_SUMMARY → 'Department' (sàn thật, employee@Own bị loại ở tầng ứng dụng);
--   ROOM_TODAY    → 'Own' (self-locked: chỉ lượt người xem tổ chức HOẶC tham dự).
INSERT INTO dashboard_widgets (
  company_id, widget_code, module_code, name, widget_type,
  required_permission_code, default_data_scope, data_source_key, component_key,
  is_system_widget, status, sort_order
) VALUES (
  NULL, 'ROOM_TODAY', 'ROOM', 'Lịch họp hôm nay', 'Calendar',
  'DASH.WIDGET.VIEW_ROOM_TODAY', 'Own', 'room-today', 'RoomTodayWidget',
  true, 'Active', 70
)
ON CONFLICT (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

INSERT INTO dashboard_widgets (
  company_id, widget_code, module_code, name, widget_type,
  required_permission_code, default_data_scope, data_source_key, component_key,
  is_system_widget, status, sort_order
) VALUES (
  NULL, 'ASSET_SUMMARY', 'ASSET', 'Thống kê tài sản', 'Summary',
  'DASH.WIDGET.VIEW_ASSET_SUMMARY', 'Department', 'asset-summary', 'AssetSummaryWidget',
  true, 'Active', 80
)
ON CONFLICT (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM dashboard_widget_configs WHERE widget_id IN (
--   SELECT id FROM dashboard_widgets WHERE company_id IS NULL AND widget_code IN ('ROOM_TODAY','ASSET_SUMMARY'));
-- DELETE FROM dashboard_widgets WHERE company_id IS NULL AND widget_code IN ('ROOM_TODAY','ASSET_SUMMARY');
-- ALTER TABLE dashboard_widgets DROP CONSTRAINT IF EXISTS chk_dashboard_widgets_module_code;
-- ALTER TABLE dashboard_widgets ADD CONSTRAINT chk_dashboard_widgets_module_code
--   CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL'));
