-- Migration 0464: S3-ATT-BE-5 (🔴 RED, zone=red, crown) — Remote/Onsite-work request workflow API.
--
-- MỤC TIÊU (done_when đã CHỐT 2026-07-02 — owner override, xem harness/backlog.mjs):
--   (A) DO-block UNION-ADD-only đưa 'remote_work_request' vào CHECK audit_logs_object_type_chk
--       (clone 0451/0456/0457/0459/0460/0461/0462/0463 — idempotent, KHÔNG rewrite CHECK cứng, KHÔNG
--       cấp UPDATE/DELETE — BẤT BIẾN #2).
--   (B) ALTER-ADD remote_work_requests.watcher_user_ids jsonb NULLABLE (additive) — done_when STATE-MACHINE
--       yêu cầu người tạo chọn watcher_user_ids lúc submit (theo dõi/nhận NOTI); cột KHÔNG có ở DB-04 §7.8
--       gốc (0452 chỉ tạo shape base) → bổ sung tối thiểu ở lane BE này (Work Order cho phép ALTER-ADD nếu
--       skeleton thiếu cột workflow, KHÔNG cần lane db-migration riêng cho 1 cột jsonb nullable).
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   • CHECK audit_logs.object_type: UNION ADD-only, KHÔNG rewrite (audit append-only #2 nguyên vẹn).
--   • ALTER-ADD: cột NULLABLE (no NOT NULL) → không rewrite/fail trên row cũ (bảng remote_work_requests
--     rỗng ở band này — mig 0452 chưa từng ghi row nào — nhưng vẫn additive theo nguyên tắc chung).
--   • RLS+FORCE của remote_work_requests đã bật ở 0452 — KHÔNG đụng lại.
--
-- BAND 0464 (lane S3-ATT-BE-5). Journal head thật = 0463 (idx 143) — nối tiếp ĐƠN ĐIỆU.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── A. CHECK audit_logs.object_type += 'remote_work_request' (UNION ADD-only, clone 0451) ───────────────
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['remote_work_request'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0464] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
    RETURN;
  END IF;

  v_def := pg_get_constraintdef(v_oid);
  IF position('ANY' IN upper(v_def)) > 0 THEN
    v_cur := substring(v_def FROM '\{[^}]*\}')::text[];
  ELSE
    SELECT array_agg(m[1]) INTO v_cur
      FROM (
        SELECT regexp_matches(v_def, '''([^'']+)''', 'g') AS m
      ) sub;
  END IF;

  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) = 0 THEN
    RAISE NOTICE '[0464] remote_work_request da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0464] da them % vao CHECK object_type cua audit_logs', array_to_string(v_add, ', ');
END;
$$;

-- ─────────────── B. remote_work_requests += watcher_user_ids jsonb (additive, NULLABLE) ───────────────
ALTER TABLE remote_work_requests ADD COLUMN IF NOT EXISTS watcher_user_ids jsonb;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- ALTER TABLE remote_work_requests DROP COLUMN IF EXISTS watcher_user_ids;
-- Re-stamp CHECK object_type bỏ 'remote_work_request' (CHỈ khi không còn row audit_logs nào dùng).
