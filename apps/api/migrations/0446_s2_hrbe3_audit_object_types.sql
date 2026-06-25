-- Migration 0446: S2-HR-BE-3 — thêm 'job_level' (+ 'contract_type') vào
--   CHECK object_type của audit_logs.
--   Lý do: HR master-data CRUD (job_levels / contract_types) ghi audit create/update/delete với
--   object_type='job_level' / 'contract_type' (audit-in-tx app-tenant). AUDIT_OBJECT_TYPES
--   (schema/audit.ts) ĐÃ có hai giá trị này (round trước); migration này thêm vào CHECK DB để INSERT
--   audit KHÔNG vỡ ràng buộc audit_logs_object_type_chk (23514) trên Postgres thật. KHÔNG ghi
--   secret/PII vào before/after (BẤT BIẾN #3) — master-data chỉ name/code/active.
--
-- HOT-FILE §9.3: DO-block UNION ADD-only (clone 0440 mẫu 0439/0437/0420/0190) — idempotent, KHÔNG
--   rewrite cứng, KHÔNG đụng RLS/grant/policy/FORCE.
--   BẤT BIẾN #2 (audit append-only) GIỮ NGUYÊN: chỉ MỞ RỘNG tập giá trị object_type hợp lệ; KHÔNG cấp
--   UPDATE/DELETE cho app role. Không DROP TABLE, không backfill, KHÔNG seed.
--   Bảng job_levels/contract_types ĐÃ tạo ở 0442 (HR-Core reconcile) — KHÔNG tạo lại.
--
-- BAND 0446 (lane S2-HR-BE-3-FIX-AUDIT-MIG / db-migration). Journal: idx 130, when 1717500645000
--   (> head 0450 idx 129 / 1717500640000). NỐI TIẾP ĐƠN ĐIỆU sau head thực tế 0450_s2_authbe3_user_admin_perms.
--   ⚠️ Lưu ý drift: WO seed ghi "head idx 128/0445, mig 0446, idx 129"; thực tế feat/s2-wave2 đã land
--   0450 ở idx 129 trước lane này → idx 129/1717500640000 ĐÃ bị chiếm. Để giữ forward-only no-gap
--   (check.ts: entries[k].idx===k), entry này dùng idx 130 / when 1717500645000. Drizzle migrator áp
--   theo THỨ TỰ mảng journal (resolve file theo `tag`), KHÔNG theo số tiền tố file → file 0446 áp SAU
--   0450 là đúng (CHECK đã tồn tại từ migration cũ; đây chỉ mở rộng tập giá trị).
--   KHÔNG db:generate cho file này (DO-block thủ công không biểu diễn được bằng Drizzle schema).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['job_level', 'contract_type'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0446] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
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
    RAISE NOTICE '[0446] job_level/contract_type da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0446] da them % vao CHECK object_type cua audit_logs', array_to_string(v_add, ', ');
END;
$$;

-- -------- Down (manual) --------
-- Re-stamp CHECK bỏ 'job_level'/'contract_type' (CHỈ khi không còn row audit_logs nào dùng chúng).
