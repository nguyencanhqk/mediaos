-- Migration 0150: G6-2 PR-A — audit_logs CHECK +'encryption_key' (ADD-only DO-block).
--
-- BAND 0150-0159 (lane g6kms — KMS provisioning + rotation version-preserving). idx 83, when 1717500200000
--   (> max hiện tại 1717500170000). Hook guard-migration-band cho g6kms = [[150,159]].
--
-- HOT-FILE (TASKS §5.3): audit CHECK = UNION mọi lane. DO-block ADD-only (tiền lệ 0099/0132/0140) — KHÔNG
--   drop re-stamp full-list ⇒ an toàn song song, KHÔNG bao giờ rớt type lane khác (user_role/payslip/
--   bonus_penalty/finance…). Đọc CẢ HAI dạng constraint: `IN ('a','b')` VÀ `= ANY ('{a,b}'::text[])`
--   (output của các DO-block trước). Chỉ thêm 'encryption_key'. Sync AUDIT_OBJECT_TYPES (schema/audit.ts)
--   CÙNG commit.
--
-- 'encryption_key' = object_type cho audit provisioning/rotation key version (SecretProvisioningService
--   provisionKeyVersion + SecretRotationService reWrap ghi cùng tx). KHÔNG ghi key material vào before/after
--   (chỉ kms_key_id = Vault path + version) — BẤT BIẾN #3.
--
-- KHÔNG nới grant UPDATE/DELETE audit_logs/encryption_keys: append-only (BẤT BIẾN #2). encryption_keys đã có
--   GRANT SELECT(app) + SELECT/INSERT/UPDATE(worker) ở 0022 — provisioning INSERT version mới + UPDATE status
--   cũ qua worker dùng đúng grant cũ, KHÔNG cần grant mới.

DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['encryption_key'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RETURN;
  END IF;

  v_def := pg_get_constraintdef(v_oid);
  IF position('ANY' IN upper(v_def)) > 0 THEN
    -- Dạng `= ANY ('{a,b,c}'::text[])` → cast literal mảng về text[] (đúng từng phần tử).
    v_cur := substring(v_def FROM '\{[^}]*\}')::text[];
  ELSE
    -- Dạng `IN ('a','b','c')` → tóm từng giá trị trong nháy đơn.
    SELECT array_agg(m[1]) INTO v_cur
      FROM (
        SELECT regexp_matches(v_def, '''([^'']+)''', 'g') AS m
      ) sub;
  END IF;

  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
END;
$$;
