-- Migration 0437: FOUNDATION-BE-2 — thêm 'sequence_counter' vào CHECK object_type của audit_logs.
--   Lý do: SequenceService.updateSequence (admin PATCH cấu hình counter) ghi audit với
--   object_type='sequence_counter'. AUDIT_OBJECT_TYPES (schema/audit.ts) đã sync giá trị này (merge be2);
--   migration này thêm vào CHECK DB để INSERT audit không vỡ ràng buộc trên Postgres thật.
--
-- HOT-FILE §9.3: DO-block UNION ADD-only (mẫu 0420/0190) — idempotent, KHÔNG rewrite cứng, KHÔNG đụng RLS/grant.
--   BẤT BIẾN #2 (audit append-only) GIỮ NGUYÊN: chỉ MỞ RỘNG tập giá trị object_type hợp lệ; KHÔNG cấp
--   UPDATE/DELETE cho app role. Không DROP TABLE, không backfill.
--
-- BAND 0437 (lane foundation-be / be2 salvage). Journal: idx 120, when 1717500550000 (> head 0436 idx 119 /
--   1717500540000). Nối tiếp ĐƠN ĐIỆU sau 0436_foundation_dbfix1_company_id_immutable.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['sequence_counter'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0437] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
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
    RAISE NOTICE '[0437] sequence_counter da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0437] da them sequence_counter vao CHECK object_type cua audit_logs';
END;
$$;

-- -------- Down (manual) --------
-- Re-stamp CHECK bỏ 'sequence_counter' (CHỈ khi không còn row audit_logs nào object_type='sequence_counter').
