-- Migration 0568: S13-PAYROLL-DASH-1 — widget DASH «chi phí lương kỳ» (SPEC-11 §10 PAYROLL-FUNC-014 ·
-- §10.1 PAYROLL-WIDGET-001 theo SPEC-01 §9.9 · PAY-DEC-010).
--
-- MỤC TIÊU: thêm 1 widget GLOBAL vào catalog `dashboard_widgets` — mirror khuôn mig 0558
-- (S11-OFFICE-DASH-1) và 0563 (S12-RECRUIT-DASH-1). THUẦN ADDITIVE — KHÔNG đụng row/cột/constraint nào khác.
--   • PAYROLL_COST — «Chi phí lương kỳ»: tổng gross/net + headcount + trạng thái của kỳ lương GẦN NHẤT,
--     nguồn `PayrollCalcService.summary()` = ĐÚNG công thức `GET /payroll-periods/summary`
--     (PAYROLL-API-018). SPEC-11 §10.1 ghi nguồn là `PayrollPeriodsService.summary` — tên service lệch,
--     route và công thức thì ĐÚNG: BE-2 đặt `summary()` ở `PayrollCalcService` (cùng nơi với
--     `latestSummaryTx` của repository calc). Đã đính chính SPEC-11 §10.1 trong CÙNG WO này.
--
-- HOT-FILE APPEND (CLAUDE.md §9.3): `chk_dashboard_widgets_module_code` là CHECK UNION — catalog CHƯA có
-- 'PAYROLL' (0482 liệt 8 module gốc; 0525 append 'GOAL'; 0558 append 'ASSET','ROOM'; 0563 append 'RECRUIT').
-- ALTER = DROP + ADD CONSTRAINT với UNION ĐÚNG: giữ nguyên 12 giá trị cũ + THÊM 1 — KHÔNG bớt giá trị nào
-- (bẫy `audit-check-union-parse-anchor-trap`).
--
-- KHÔNG seed permission/role_permissions: widget gate bằng cặp NGUỒN ('view-line','payroll-period') ĐÃ seed
-- + grant ở mig 0565 (is_sensitive=TRUE — cặp CHỞ TIỀN, SPEC-11 §22; grant payroll-officer/company-admin
-- @Company, permission-matrix §9g) — Option B (`DASH_WIDGET_GATE_PAIR`, KHÔNG cặp per-widget
-- '*:dashboard-widget'). Migration này THUẦN DATA + 1 ALTER CHECK.
--
-- VÌ SAO cặp ĐỌC `view-line` chứ KHÔNG phải `view:payroll-period` hay `calculate:payroll-period`
-- (SPEC-11 §10.1 + §22 mục 3 — đã chốt ở DOC-1, KHÔNG mở lại ở đây):
--   • `('view','payroll-period')` cố ý `is_sensitive=false` cho màn DANH SÁCH kỳ ⇒ **không được chở số
--     tiền, kể cả tổng** (SPEC-11 §334). Payload widget CÓ `totalGross`/`totalNet` ⇒ loại.
--   • `('calculate','payroll-period')` là cặp GHI ⇒ gác bằng nó thì "ai thấy widget đều ghi được lương".
--
-- CỔNG PHỤ (KHÔNG ở migration): SÀN scope `Company` ép ở tầng ứng dụng (`DASH_WIDGET_MIN_DATA_SCOPE`, gác
-- CẢ registry metadata LẪN handler data). Đây KHÔNG phải phòng xa: `PayrollCalcRepository.latestSummaryTx`
-- SUM toàn bộ `payroll_period_lines` của company (không co theo actor scope) ⇒ serve cho grant hẹp hơn
-- Company là rò TIỀN ngoài scope. Sàn thứ hai này trùng `companyFloor` mà `PayrollAccessService` đã ép ở
-- route 018 — hai tầng ĐỘC LẬP đọc hai hằng khác nhau, cố ý (đường METADATA /dashboard/me KHÔNG đi qua
-- PayrollAccessService nên không có sàn của nó). KHÔNG ép được bằng CHECK/RLS vì scope là thuộc tính của
-- GRANT, không phải của hàng catalog.
--
-- `dashboard_widget_configs` KHÔNG seed ở migration (company_id NOT NULL, company mặc định chỉ tồn tại SAU
-- boot) — seed RUNTIME qua `DashboardConfigSeeder` đọc `DASH_DEFAULT_CONFIG` (bump seedVersion v4→v5).
--
-- KHÔNG đụng `apps/api/src/db/schema/dashboard.ts` (CHECK ở đó vẫn liệt 8 module gốc — drift CỐ Ý từ 0525):
-- migration là nguồn DDL thật, sửa file schema sẽ đẻ diff `db:generate` giả.
--
-- Journal: idx 235, when 1717587357000 (> head 0567 idx 234).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────── (1) CHECK union APPEND — thêm 'PAYROLL' vào chk_dashboard_widgets_module_code ───────────
ALTER TABLE dashboard_widgets DROP CONSTRAINT IF EXISTS chk_dashboard_widgets_module_code;
ALTER TABLE dashboard_widgets ADD CONSTRAINT chk_dashboard_widgets_module_code
  CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','ASSET','ROOM','RECRUIT','PAYROLL'));
--> statement-breakpoint

-- ─────────── (2) Catalog widget GLOBAL (company_id NULL) — PAYROLL_COST ───────────
-- ON CONFLICT arbiter = partial unique uq_dashboard_widgets_global_code_active (0482):
--   ON (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL → predicate lặp lại ở WHERE.
-- `default_data_scope` = 'Company' — trùng SÀN thật (xem doc-block trên), không phải cận-dưới trang trí.
-- widget_type = 'Summary' (mấy con số tổng + trạng thái kỳ, KHÔNG phải chuỗi thời gian) — khớp CHECK
-- chk_dashboard_widgets_widget_type (0482).
INSERT INTO dashboard_widgets (
  company_id, widget_code, module_code, name, widget_type,
  required_permission_code, default_data_scope, data_source_key, component_key,
  is_system_widget, status, sort_order
) VALUES (
  NULL, 'PAYROLL_COST', 'PAYROLL', 'Chi phí lương kỳ', 'Summary',
  'DASH.WIDGET.VIEW_PAYROLL_COST', 'Company', 'payroll-cost', 'PayrollCostWidget',
  true, 'Active', 100
)
ON CONFLICT (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM dashboard_widget_configs WHERE widget_id IN (
--   SELECT id FROM dashboard_widgets WHERE company_id IS NULL AND widget_code = 'PAYROLL_COST');
-- DELETE FROM dashboard_widgets WHERE company_id IS NULL AND widget_code = 'PAYROLL_COST';
-- ALTER TABLE dashboard_widgets DROP CONSTRAINT IF EXISTS chk_dashboard_widgets_module_code;
-- ALTER TABLE dashboard_widgets ADD CONSTRAINT chk_dashboard_widgets_module_code
--   CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','ASSET','ROOM','RECRUIT'));
