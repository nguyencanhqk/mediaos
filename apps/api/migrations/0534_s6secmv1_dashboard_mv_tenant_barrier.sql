-- S6-SEC-MV-1 · KI-041 — DỰNG RANH GIỚI TENANT THẬT CHO 2 MATVIEW DASHBOARD (BẤT BIẾN #1)
--
-- LỖ HỔNG. PostgreSQL **KHÔNG hỗ trợ RLS trên materialized view**. `mv_dashboard_task_status` và
-- `mv_dashboard_output` đều MANG cột `company_id` nhưng nằm NGOÀI phép đo 153/153 bảng RLS, nên ranh
-- giới tenant DUY NHẤT của chúng là dòng `WHERE company_id = $1` viết tay trong
-- `mv-dashboard.service.ts` — tức là **kỷ luật của dev**, đúng thứ mà BẤT BIẾN #1 nói KHÔNG được dựa vào.
--
-- ĐÃ ĐO (lane DB, 2026-07-29) — không phải suy đoán từ migration:
--   role `mediaos_app`  → SELECT count(*), count(DISTINCT company_id) FROM mv_dashboard_task_status
--                         (KHÔNG mệnh đề lọc) ⇒ **56 hàng / 38 tenant**.
--   role `mediaos_worker` → y hệt.
--   ACL trước migration: {mediaos=arwdDxtm/mediaos, mediaos_app=r/mediaos, mediaos_worker=r/mediaos}
-- Một câu SELECT quên vế `company_id` (hoặc một endpoint mới đọc thẳng MV) là rò chéo tenant ngay,
-- và KHÔNG tầng nào bên dưới chặn lại.
--
-- CÁCH VÁ (chốt với owner 2026-07-29 — "wrapper view + REVOKE"):
--   1. REVOKE SELECT trực tiếp trên CẢ HAI matview khỏi `mediaos_app` + `mediaos_worker`.
--   2. Thay bằng view `security_barrier` tự lọc theo `current_setting('app.current_company_id')` —
--      cùng biến mà `withTenant()` đã set (`set_config(..., true)` = transaction-local).
--   3. App đọc qua view. Từ nay quên vế lọc KHÔNG còn rò được: view tự lọc, và mất quyền đọc thẳng MV.
--
-- VÌ SAO `security_barrier`: không có nó, planner được phép đẩy hàm/toán tử do người dùng cung cấp
-- xuống DƯỚI vế lọc tenant (leaky view) ⇒ một `WHERE leaky_fn(email)` chi phí thấp có thể quan sát
-- hàng của tenant khác TRƯỚC khi bị loại. `security_barrier` cấm đúng phép đẩy đó.
--
-- VÌ SAO `current_setting(..., true)` (missing_ok = TRUE): ngoài `withTenant` biến KHÔNG tồn tại.
--   • `true`  ⇒ trả NULL ⇒ `company_id = NULL` ⇒ **0 hàng (fail-closed)**.
--   • `false` ⇒ NÉM lỗi 42704 ⇒ mọi câu ngoài ngữ cảnh tenant thành 500 khó chẩn.
-- Chọn fail-closed-im-lặng ở TẦNG DB vì tầng service đã có vế `company_id` tường minh làm đai thứ hai
-- (giữ nguyên, KHÔNG gỡ — phòng thủ theo lớp).
--
-- ⚠️ KHÔNG DROP `mv_dashboard_output` dù nó là họ media-era đang park: CLAUDE.md §1 chốt "không xóa ở
-- đợt này", và `docs/DB/` KHÔNG có dòng nào xác nhận park (đã grep 2026-07-29) nên điều kiện DROP của
-- WO không thoả. Nó bị REVOKE + bọc y như cái kia. Đính chính tiền đề WO: nó KHÔNG "0 consumer" —
-- `GET /dashboard/mv-stats` (gate `read:dashboard`) trả CẢ hai nửa; chỉ là chưa màn hình nào gọi.

-- ── 1. Gỡ quyền đọc THẲNG matview ───────────────────────────────────────────────────────────────
REVOKE SELECT ON mv_dashboard_task_status FROM mediaos_app;
REVOKE SELECT ON mv_dashboard_output      FROM mediaos_app;
REVOKE SELECT ON mv_dashboard_task_status FROM mediaos_worker;
REVOKE SELECT ON mv_dashboard_output      FROM mediaos_worker;

-- ── 2. View chắn tenant ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_dashboard_task_status
  WITH (security_barrier = true) AS
  SELECT company_id, status, task_count
    FROM mv_dashboard_task_status
   WHERE company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid;

CREATE OR REPLACE VIEW v_dashboard_output
  WITH (security_barrier = true) AS
  SELECT company_id, status, project_id, department_id, channel_id, month, task_count
    FROM mv_dashboard_output
   WHERE company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid;

-- `NULLIF(..., '')`: `set_config` với chuỗi rỗng trả '' chứ không NULL; ép '' → NULL để `''::uuid`
-- không ném 22P02 (invalid input syntax for uuid) và vẫn fail-closed 0 hàng.

GRANT SELECT ON v_dashboard_task_status TO mediaos_app;
GRANT SELECT ON v_dashboard_output      TO mediaos_app;

-- ── 3. Đường REFRESH — sửa nợ kiến trúc G14 (done_when #5) ──────────────────────────────────────
--
-- TIỀN ĐỀ ĐÃ ĐO, KHÔNG PHẢI PHỎNG ĐOÁN: `REFRESH MATERIALIZED VIEW` đòi quyền chủ sở hữu, nhưng
-- `DashboardRefreshService.refreshDb` ưu tiên `workerDb` (`mediaos_worker`). Đo trên lane 2026-07-29:
--   mediaos_worker → REFRESH ⇒ "permission denied for materialized view mv_dashboard_task_status"
--   mediaos (owner) → REFRESH ⇒ OK
-- ⇒ đường refresh runtime CHẾT từ G14 ở MỌI env có DATABASE_WORKER_URL (PROD CÓ) ⇒ hai matview đứng
-- yên vô thời hạn, dashboard phục vụ dòng ma. (Đo thêm: một lần REFRESH bằng owner làm 56→54 hàng,
-- 38→37 tenant — bằng chứng dữ liệu đã CŨ thật.)
--
-- ⚠️ CẤM "sửa nhanh" bằng `ALTER MATERIALIZED VIEW ... OWNER TO mediaos_worker`: worker KHÔNG có
-- BYPASSRLS mà `tasks` thì FORCE RLS ⇒ REFRESH chạy dưới quyền worker sẽ cho MV **RỖNG LẶNG LẼ** —
-- mất sạch số liệu dashboard mà không ai biết. Đổi chủ sở hữu là cái bẫy, không phải cái vá.
--
-- CÁCH VÁ: hàm SECURITY DEFINER thuộc sở hữu `mediaos` (role migrator, CÓ BYPASSRLS) — thân hàm chạy
-- bằng quyền chủ sở hữu nên vừa đủ quyền REFRESH vừa nhìn đủ hàng. Worker chỉ được EXECUTE.
CREATE OR REPLACE FUNCTION refresh_dashboard_mvs()
  RETURNS timestamptz
  LANGUAGE plpgsql
  SECURITY DEFINER
  -- Chốt search_path: bắt buộc với SECURITY DEFINER, nếu không caller đặt search_path riêng có thể
  -- trỏ `mv_dashboard_*` sang object của họ và khiến thân hàm chạy dưới quyền `mediaos`.
  SET search_path = public, pg_temp
AS $$
DECLARE
  populated boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM mv_dashboard_task_status) INTO populated;

  IF populated THEN
    -- CONCURRENTLY được phép trong hàm (đã thử nghiệm trên lane 2026-07-29 — KHÔNG bị chặn như
    -- REINDEX/VACUUM). Chỉ áp cho task_status: unique index của nó là CỘT TRẦN (mig 0502).
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_task_status;
  ELSE
    -- MV rỗng ⇒ CONCURRENTLY không dùng được cho lần populate đầu.
    REFRESH MATERIALIZED VIEW mv_dashboard_task_status;
  END IF;

  -- `mv_dashboard_output` KHÔNG BAO GIỜ concurrently được: unique index của nó là BIỂU THỨC COALESCE
  -- (mig 0102) mà Postgres đòi cột trần ⇒ luôn REFRESH thường (khoá đọc ngắn; họ media parked).
  REFRESH MATERIALIZED VIEW mv_dashboard_output;

  RETURN now();
END;
$$;

-- Hàm SECURITY DEFINER mặc định EXECUTE cho PUBLIC — thu hồi rồi cấp đích danh.
REVOKE ALL ON FUNCTION refresh_dashboard_mvs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_dashboard_mvs() TO mediaos_worker;

COMMENT ON FUNCTION refresh_dashboard_mvs() IS
  'S6-SEC-MV-1: refresh 2 matview dashboard bằng quyền owner (mediaos, có BYPASSRLS). Worker chỉ EXECUTE — KHÔNG đổi owner MV sang worker: thiếu BYPASSRLS ⇒ MV rỗng lặng lẽ.';
COMMENT ON VIEW v_dashboard_task_status IS
  'S6-SEC-MV-1: cửa đọc DUY NHẤT của mv_dashboard_task_status cho app role. security_barrier + lọc app.current_company_id (fail-closed 0 hàng ngoài withTenant).';
COMMENT ON VIEW v_dashboard_output IS
  'S6-SEC-MV-1: cửa đọc DUY NHẤT của mv_dashboard_output cho app role. security_barrier + lọc app.current_company_id (fail-closed 0 hàng ngoài withTenant).';
