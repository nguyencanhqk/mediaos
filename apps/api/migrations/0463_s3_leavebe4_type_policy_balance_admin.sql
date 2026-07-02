-- Migration 0463: S3-LEAVE-BE-4 — LEAVE type/policy admin CRUD + HR balance view/adjust ledger.
--
-- MỤC TIÊU: KHÔNG có bảng/cột mới (leave_types/leave_policies/leave_balances/leave_balance_transactions đã
-- đầy đủ từ migration 0453 — RLS+FORCE+GRANT sẵn). Việc DUY NHẤT ở migration này là UNION-ADD 'leave_policy'
-- vào CHECK audit_logs.object_type (clone pattern 0462/0461/0460/0459/0456/0446/0440) để service mới ghi
-- audit CREATE/UPDATE/DELETE trên leave_policies KHÔNG vỡ CHECK trên Postgres thật. 'leave_type'/'leave_balance'
-- ĐÃ có trong CHECK từ G11 (audit.ts dòng 125/127) — KHÔNG cần thêm.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   • Append-only #2: DO-block CHỈ UNION-ADD (KHÔNG rewrite/xoá giá trị cũ trong CHECK).
--   • Permission catalog leave-type/leave-policy/leave-balance (view/create/update/delete + adjust) ĐÃ SEED
--     ở migration 0455 (leave-permissions.const.ts §11) — KHÔNG seed lại ở đây.
--
-- BAND 0463 (lane S3-LEAVE-BE-4). Journal: idx 143 (> head 0462 idx 142). Nối tiếp ĐƠN ĐIỆU.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── CHECK audit_logs.object_type += 'leave_policy' (UNION ADD-only, clone 0462) ───────────────
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['leave_policy'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0463] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
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
    RAISE NOTICE '[0463] leave_policy da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0463] da them % vao CHECK object_type cua audit_logs', array_to_string(v_add, ', ');
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- Re-stamp CHECK object_type bỏ 'leave_policy' (CHỈ khi không còn row audit_logs nào dùng nó).
