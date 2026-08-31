-- Migration 0563: S12-RECRUIT-DASH-1 — widget DASH «phễu tuyển dụng» (SPEC-12 §5.1 RC-10 · §10
-- RECRUIT-FUNC-013 · RECRUIT-WIDGET-001 theo SPEC-01 §9.9).
--
-- MỤC TIÊU: thêm 1 widget GLOBAL vào catalog `dashboard_widgets` — mirror khuôn mig 0558
-- (S11-OFFICE-DASH-1). THUẦN ADDITIVE — KHÔNG đụng row/cột/constraint nào khác.
--   • RECRUIT_FUNNEL — «Phễu tuyển dụng»: đếm ứng viên theo stage + số vị trí đang `Open`, nguồn
--     `CandidatesService.summary()` = ĐÚNG công thức `GET /candidates/summary` (RECRUIT-API-009).
--
-- HOT-FILE APPEND (CLAUDE.md §9.3): `chk_dashboard_widgets_module_code` là CHECK UNION — catalog CHƯA có
-- 'RECRUIT' (0482 liệt 8 module gốc; 0525 append 'GOAL'; 0558 append 'ASSET','ROOM'). ALTER = DROP + ADD
-- CONSTRAINT với UNION ĐÚNG: giữ nguyên 11 giá trị cũ + THÊM 1 — KHÔNG bớt giá trị nào (bẫy
-- `audit-check-union-parse-anchor-trap`).
--
-- KHÔNG seed permission/role_permissions: widget gate bằng cặp NGUỒN ('view','candidate') ĐÃ seed + grant ở
-- mig 0560 (is_sensitive=true; grant hr/company-admin/recruiter @Company — permission-matrix §9f) — Option B
-- (`DASH_WIDGET_GATE_PAIR`, KHÔNG cặp per-widget '*:dashboard-widget'). Migration này THUẦN DATA + 1 ALTER CHECK.
--
-- CỔNG PHỤ (KHÔNG ở migration): SÀN scope `Company` ép ở tầng ứng dụng (`DASH_WIDGET_MIN_DATA_SCOPE`, gác
-- CẢ registry metadata LẪN handler data). Khác ASSET_SUMMARY (sàn 'Department' vì summary() actor-scoped),
-- sàn ở đây PHẢI bằng đúng bề rộng phép đếm: `summaryTx` đếm TOÀN company (không co theo actor scope) ⇒
-- serve cho grant hẹp hơn Company là rò số liệu ngoài scope. Hôm nay mọi grant `view:candidate` đều
-- @Company nên sàn không loại ai — nó gác grant HẸP HƠN xuất hiện về sau. KHÔNG ép được bằng CHECK/RLS vì
-- scope là thuộc tính của GRANT, không phải của hàng catalog.
--
-- `dashboard_widget_configs` KHÔNG seed ở migration (company_id NOT NULL, company mặc định chỉ tồn tại SAU
-- boot) — seed RUNTIME qua `DashboardConfigSeeder` đọc `DASH_DEFAULT_CONFIG` (bump seedVersion v3→v4).
--
-- KHÔNG đụng `apps/api/src/db/schema/dashboard.ts` (CHECK ở đó vẫn liệt 8 module gốc — drift CỐ Ý từ 0525):
-- migration là nguồn DDL thật, sửa file schema sẽ đẻ diff `db:generate` giả.
--
-- Journal: idx 230, when 1717587352000 (> head 0562 idx 229).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────── (1) CHECK union APPEND — thêm 'RECRUIT' vào chk_dashboard_widgets_module_code ───────────
ALTER TABLE dashboard_widgets DROP CONSTRAINT IF EXISTS chk_dashboard_widgets_module_code;
ALTER TABLE dashboard_widgets ADD CONSTRAINT chk_dashboard_widgets_module_code
  CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','ASSET','ROOM','RECRUIT'));
--> statement-breakpoint

-- ─────────── (2) Catalog widget GLOBAL (company_id NULL) — RECRUIT_FUNNEL ───────────
-- ON CONFLICT arbiter = partial unique uq_dashboard_widgets_global_code_active (0482):
--   ON (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL → predicate lặp lại ở WHERE.
-- `default_data_scope` = 'Company' — trùng SÀN thật (xem doc-block trên), không phải cận-dưới trang trí.
INSERT INTO dashboard_widgets (
  company_id, widget_code, module_code, name, widget_type,
  required_permission_code, default_data_scope, data_source_key, component_key,
  is_system_widget, status, sort_order
) VALUES (
  NULL, 'RECRUIT_FUNNEL', 'RECRUIT', 'Phễu tuyển dụng', 'Chart',
  'DASH.WIDGET.VIEW_RECRUIT_FUNNEL', 'Company', 'recruit-funnel', 'RecruitFunnelWidget',
  true, 'Active', 90
)
ON CONFLICT (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM dashboard_widget_configs WHERE widget_id IN (
--   SELECT id FROM dashboard_widgets WHERE company_id IS NULL AND widget_code = 'RECRUIT_FUNNEL');
-- DELETE FROM dashboard_widgets WHERE company_id IS NULL AND widget_code = 'RECRUIT_FUNNEL';
-- ALTER TABLE dashboard_widgets DROP CONSTRAINT IF EXISTS chk_dashboard_widgets_module_code;
-- ALTER TABLE dashboard_widgets ADD CONSTRAINT chk_dashboard_widgets_module_code
--   CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','ASSET','ROOM'));
