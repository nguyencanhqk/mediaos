-- Migration 0510: S5-SYS-CLEAN-1 (🔴 RED, zone=red, crown — primitive XOÁ + FUNCTION grant) —
-- Retention CÓ NGƯỠNG cho system_job_runs.
--
-- Gate: FULL (security-reviewer [SECURITY DEFINER cross-tenant primitive + REVOKE PUBLIC + grant] +
--             database-reviewer + silent-failure-hunter + santa-method).
--
-- BỐI CẢNH (docs/plans/S5-SYS-CLEAN-1.md):
--   system_job_runs phình mỗi nhịp scheduler (đo PROD 2026-07-24: 48.022 dòng/19 MB, 100% Success). BE-4
--   (#262) viện dẫn bảng này làm "bằng chứng job đã chạy" thay cho audit_logs ⇒ dọn PHẢI CÓ NGƯỠNG:
--     • giữ ≥90 ngày cho LMS_USER_SYNC (hợp đồng BE-4 §3D)
--     • giữ ≥7 ngày cho mọi job_code khác (owner chốt 30 ngày; 7 = sàn cứng chống caller lỗi)
--     • GIỮ VĨNH VIỄN mọi row Failed/Partial/Running (chỉ xoá Success/Skipped)
--     • GIỮ VĨNH VIỄN row company_id IS NULL (predicate tenant-scoped ⇒ NULL không khớp)
--
-- BẤT BIẾN (CLAUDE.md §2):
--   #2 KHÔNG hard-delete tuỳ tiện. system_job_runs = nhật ký chạy (append-mostly, mig 0475). KHÔNG role
--      runtime nào có DELETE trên BẢNG (app SELECT / worker SELECT+INSERT+UPDATE) và WO này KHÔNG cấp thêm.
--      XOÁ có kiểm soát chỉ đi qua 1 FUNCTION SECURITY DEFINER (owner = migrate-role superuser BYPASSRLS),
--      REVOKE ALL FROM PUBLIC + GRANT EXECUTE CHỈ cho mediaos_worker (tiền lệ resolve_api_key_by_hash 0310).
--      ⇒ assert "KHÔNG DELETE role nào" ở system-jobs-schema.int-spec vẫn XANH (EXECUTE-function KHÔNG
--        xuất hiện trong information_schema.role_table_grants).
--   #1 Cô lập tenant: DELETE LUÔN có company_id = p_company_id (bind) ⇒ không rò/không xoá chéo tenant;
--      row global (company_id IS NULL) không bao giờ khớp.
--   #3 KHÔNG secret. Function chỉ nhận uuid + int + boolean; không đọc/ghi PII.
--
-- BAND 0510 (lane sysclean). Journal: idx 190, when 1717587312000 (> head 0509 idx 189 / 1717587311000).
--   Nối tiếp ĐƠN ĐIỆU. KHÔNG db:generate — FUNCTION/SECURITY DEFINER không biểu diễn được bằng drizzle
--   (parity thủ công, giống RLS/policy ở 0475). Drizzle schema system-jobs.ts KHÔNG đổi.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- purge_system_job_runs — XOÁ có ngưỡng, tenant-scoped, allowlist status. SECURITY DEFINER: chạy với quyền
-- OWNER (migrate-role superuser, BYPASSRLS) nên DELETE ăn qua FORCE-RLS + có quyền DELETE bảng; caller
-- (mediaos_worker, NOBYPASSRLS) chỉ cần EXECUTE. SET search_path CỐ ĐỊNH (chống search_path injection).
--
-- Tham số:
--   p_company_id   — tenant cần dọn (bind; global NULL không bao giờ khớp ⇒ giữ vĩnh viễn).
--   p_default_days — ngưỡng ngày cho job_code khác (caller truyền 30; SÀN CỨNG ≥7 bên trong).
--   p_lms_days     — ngưỡng ngày cho LMS_USER_SYNC (caller truyền 90; SÀN CỨNG ≥90 — hợp đồng BE-4 §3D).
--   p_batch_size   — trần xoá 1 lượt (chống lock lớn); TRẦN CỨNG 100000.
--   p_dry_run      — true = ĐẾM eligible (kill-switch OFF), KHÔNG xoá.
-- Trả: số row đã xoá (hoặc số eligible khi dry-run).
CREATE FUNCTION purge_system_job_runs(
  p_company_id   uuid,
  p_default_days integer,
  p_lms_days     integer,
  p_batch_size   integer,
  p_dry_run      boolean
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n            integer;
  v_default_days integer;
  v_lms_days     integer;
BEGIN
  -- Guard tham số: chặn truyền rác. Batch có TRẦN CỨNG (không cho xoá vô biên 1 lượt).
  IF p_company_id IS NULL OR p_default_days <= 0 OR p_lms_days <= 0
     OR p_batch_size <= 0 OR p_batch_size > 100000 THEN
    RAISE EXCEPTION 'purge_system_job_runs: tham so khong hop le';
  END IF;

  -- SÀN CỨNG ép Ở PRIMITIVE (không tin caller): dù input nhỏ hơn, LMS_USER_SYNC KHÔNG BAO GIỜ bị xoá <90
  -- ngày (bảo vệ "bằng chứng job chạy" của BE-4 §3D); job khác KHÔNG BAO GIỜ <7 ngày. GREATEST = fail-safe
  -- theo hướng GIỮ (clamp LÊN phía an toàn, không ném) ⇒ một caller lỗi chỉ xoá ÍT hơn, không nhiều hơn.
  v_lms_days     := GREATEST(p_lms_days, 90);
  v_default_days := GREATEST(p_default_days, 7);

  IF p_dry_run THEN
    -- Đếm eligible (không mutate). CÙNG predicate với nhánh xoá ⇒ count == số-sẽ-xoá (không lệch dry/real).
    SELECT count(*) INTO v_n
    FROM system_job_runs
    WHERE company_id = p_company_id                       -- global (NULL) KHÔNG khớp ⇒ GIỮ VĨNH VIỄN
      AND status IN ('Success', 'Skipped')                -- Failed/Partial/Running GIỮ VĨNH VIỄN
      AND started_at < now() - make_interval(days =>
            CASE WHEN job_code = 'LMS_USER_SYNC' THEN v_lms_days ELSE v_default_days END);
    RETURN v_n;
  END IF;

  -- Xoá 1 lô (LIMIT + FOR UPDATE SKIP LOCKED: không giẫm INSERT/UPDATE run-row worker đang chạy; loop-lại
  -- ở nhịp sau nếu còn). ORDER BY started_at: dọn row cũ nhất trước.
  WITH victim AS (
    SELECT id FROM system_job_runs
    WHERE company_id = p_company_id
      AND status IN ('Success', 'Skipped')
      AND started_at < now() - make_interval(days =>
            CASE WHEN job_code = 'LMS_USER_SYNC' THEN v_lms_days ELSE v_default_days END)
    ORDER BY started_at
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM system_job_runs s USING victim WHERE s.id = victim.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
--> statement-breakpoint
-- Chặn PUBLIC execute (mọi role đều có EXECUTE mặc định trên function SECURITY DEFINER — PHẢI REVOKE trước).
-- Chỉ mediaos_worker (job nền) gọi được ⇒ app role KHÔNG chạm được primitive xoá (dù gián tiếp). Mirror 0310.
REVOKE ALL ON FUNCTION purge_system_job_runs(uuid, integer, integer, integer, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION purge_system_job_runs(uuid, integer, integer, integer, boolean) TO mediaos_worker;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DROP FUNCTION IF EXISTS purge_system_job_runs(uuid, integer, integer, integer, boolean);
