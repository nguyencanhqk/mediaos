-- Migration 0440: S1-FND-FILE-1 (🔴 RED) — thêm 'file' (+ 'file_link') vào
--   CHECK object_type của audit_logs.
--   Lý do: FileService Upload/Delete ghi audit object_type='file' (FileUploaded / FileDeleted soft-delete),
--   Link/Unlink ghi object_type='file_link' (FileLinked / FileUnlinked) — đều audit-in-tx app-tenant.
--   AUDIT_OBJECT_TYPES (schema/audit.ts) sync hai giá trị này CÙNG commit; migration này thêm vào CHECK DB để
--   INSERT audit không vỡ ràng buộc audit_logs_object_type_chk trên Postgres thật. Masker che storage_path/
--   signed_url — KHÔNG ghi storage key/secret/URL ký vào before/after (BẤT BIẾN #3).
--
-- HOT-FILE §9.3: DO-block UNION ADD-only (clone 0439 mẫu 0437/0420/0190) — idempotent, KHÔNG rewrite cứng,
--   KHÔNG đụng RLS/grant/policy/FORCE.
--   BẤT BIẾN #2 (audit append-only) GIỮ NGUYÊN: chỉ MỞ RỘNG tập giá trị object_type hợp lệ; KHÔNG cấp
--   UPDATE/DELETE cho app role. Không DROP TABLE, không backfill, KHÔNG seed.
--   Bảng files/file_links/file_access_logs ĐÃ tạo ở 0433 — KHÔNG tạo lại.
--
-- BAND 0440 (lane S1-FND-FILE-1 / foundation-db). Journal: idx 123, when 1717500580000
--   (> head 0439 idx 122 / 1717500570000). Nối tiếp ĐƠN ĐIỆU sau head 0439_setting1_audit_object_type.
--   KHÔNG db:generate cho file này (DO-block thủ công không biểu diễn được bằng Drizzle schema).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['file', 'file_link'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0440] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
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
    RAISE NOTICE '[0440] file/file_link da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0440] da them % vao CHECK object_type cua audit_logs', array_to_string(v_add, ', ');
END;
$$;

-- -------- Down (manual) --------
-- Re-stamp CHECK bỏ 'file'/'file_link' (CHỈ khi không còn row audit_logs nào dùng chúng).
