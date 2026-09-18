-- Migration 0576: S15-PAYROLL-DASH-1 — 2 widget DASH của PAYROLL v2 (SPEC-11 §10.1b:
-- PAYROLL-WIDGET-002 · PAYROLL-WIDGET-003, theo SPEC-01 §9.9).
--
-- MỤC TIÊU: thêm 2 hàng GLOBAL vào catalog `dashboard_widgets` — mirror mig 0568 (S13-PAYROLL-DASH-1).
-- THUẦN ADDITIVE, THUẦN DATA — KHÔNG ALTER, KHÔNG đụng hàng/cột/constraint nào khác.
--   • PAYROLL_BUDGET — «Ngân sách lương năm»: kế hoạch · thực hiện · chênh lệch · tỉ lệ dùng của NĂM
--     HIỆN TẠI. Nguồn `PayrollBudgetsService.yearTotals()` → `PayrollBudgetsRepository.yearTotalsTx`
--     = ĐÚNG con số mà khối ngân sách của Tổng quan (PAYROLL-API-078) và hàng tổng của báo cáo
--     `budget-status` dùng (S15-PAYROLL-BE-5). MỘT công thức — KHÔNG cộng lại ở tầng widget.
--   • PAYROLL_ADVANCE_PENDING — «Tạm ứng chờ duyệt»: ĐẾM (`total`) của `PAYROLL-API-059` với
--     `status=Pending`. KHÔNG tên người, KHÔNG số tiền (SPEC-11 §10.1b).
--
-- KHÔNG ALTER `chk_dashboard_widgets_module_code`: 'PAYROLL' đã vào union ở mig 0568 (bẫy
-- `audit-check-union-parse-anchor-trap` — đụng lại CHECK mà không cần là rủi ro thừa).
--
-- KHÔNG seed permission/role_permissions: widget gate bằng cặp NGUỒN, Option B
-- (`DASH_WIDGET_GATE_PAIR`) — cả hai cặp ĐÃ seed + grant ở mig 0571:
--   • PAYROLL_BUDGET          → ('view','payroll-budget')  is_sensitive=TRUE, grant payroll-officer +
--                               company-admin @Company (0571:98,114) — ĐÚNG cặp của route nguồn 073
--                               (`PAYROLL_ROUTE_PAIRS.budgetList`), theo luật «gate màn-hình khớp gate
--                               đường-tải»: widget chở TIỀN ngân sách nên phải là cặp đọc-tiền của
--                               chính nguồn đó, không mượn cặp của kỳ lương (`view-line:payroll-period`
--                               gác route 018 — dữ liệu KHÁC).
--   • PAYROLL_ADVANCE_PENDING → ('view','payroll-advance') is_sensitive=TRUE, grant payroll-officer +
--                               company-admin @Company (0571:93,109) — cặp của route nguồn 059.
--                               KHÔNG dùng ('approve','payroll-advance'): 0571 §4.7 đã ép
--                               approve ⇒ view (chống DUYỆT MÙ) nên `view` là tập RỘNG HƠN và vẫn đúng
--                               luật gate-đọc; gác bằng cặp DUYỆT sẽ giấu con số khỏi người chỉ được
--                               xem, trong khi payload là phép ĐẾM không chở tiền.
--
-- CỔNG PHỤ (KHÔNG ở migration): SÀN scope `Company` cho CẢ HAI, ép ở HAI tầng ứng dụng độc lập
-- (`DASH_WIDGET_MIN_DATA_SCOPE` đọc bởi `DashboardWidgetRegistryService.filterByGatePair` cho đường
-- METADATA và bởi `DashboardWidgetPayrollHandlers` cho đường DATA). Bắt buộc, không phải phòng xa:
-- `yearTotalsTx` và `countTx` đều cộng/đếm TOÀN company, không co theo scope của actor. KHÔNG ép được
-- bằng CHECK/RLS vì scope là thuộc tính của GRANT, không phải của hàng catalog.
--
-- `dashboard_widget_configs` KHÔNG seed ở migration (company_id NOT NULL, công ty chỉ tồn tại SAU boot)
-- — seed RUNTIME qua `DashboardConfigSeeder` đọc `DASH_DEFAULT_CONFIG` (bump seedVersion v5→v6).
--
-- KHÔNG đụng `apps/api/src/db/schema/dashboard.ts` (drift CỐ Ý từ 0525 — migration là nguồn DDL thật).
--
-- Journal: idx 243, when 1717587365000 (> head 0575 idx 242).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────── Catalog widget GLOBAL (company_id NULL) ───────────
-- ON CONFLICT arbiter = partial unique uq_dashboard_widgets_global_code_active (0482):
--   ON (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL → predicate lặp lại ở WHERE.
-- `default_data_scope` = 'Company' — trùng SÀN thật, không phải cận-dưới trang trí.
-- widget_type = 'Summary' (mấy con số tổng) — khớp CHECK chk_dashboard_widgets_widget_type (0482:74).
INSERT INTO dashboard_widgets (
  company_id, widget_code, module_code, name, widget_type,
  required_permission_code, default_data_scope, data_source_key, component_key,
  is_system_widget, status, sort_order
) VALUES
  (NULL, 'PAYROLL_BUDGET', 'PAYROLL', 'Ngân sách lương năm', 'Summary',
   'DASH.WIDGET.VIEW_PAYROLL_BUDGET', 'Company', 'payroll-budget', 'PayrollBudgetWidget',
   true, 'Active', 110),
  (NULL, 'PAYROLL_ADVANCE_PENDING', 'PAYROLL', 'Tạm ứng chờ duyệt', 'Summary',
   'DASH.WIDGET.VIEW_PAYROLL_ADVANCE_PENDING', 'Company', 'payroll-advance-pending',
   'PayrollAdvancePendingWidget',
   true, 'Active', 120)
ON CONFLICT (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

-- ─────────── VERIFY — catalog phải có đủ 2 hàng SỐNG (fail LOUD nếu ON CONFLICT nuốt vì hàng cũ lệch) ───────────
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM dashboard_widgets
   WHERE company_id IS NULL AND deleted_at IS NULL
     AND widget_code IN ('PAYROLL_BUDGET','PAYROLL_ADVANCE_PENDING')
     AND module_code = 'PAYROLL' AND status = 'Active';
  IF v_n <> 2 THEN
    RAISE EXCEPTION '[0576] verify: catalog co % hang PAYROLL widget v2 song, ky vong 2', v_n;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM dashboard_widget_configs WHERE widget_id IN (
--   SELECT id FROM dashboard_widgets WHERE company_id IS NULL
--    AND widget_code IN ('PAYROLL_BUDGET','PAYROLL_ADVANCE_PENDING'));
-- DELETE FROM dashboard_widgets WHERE company_id IS NULL
--   AND widget_code IN ('PAYROLL_BUDGET','PAYROLL_ADVANCE_PENDING');
