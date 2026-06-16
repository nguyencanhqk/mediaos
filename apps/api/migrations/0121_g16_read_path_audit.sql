-- Migration 0121: G16-1b — read-path audit + security_alerts object type (ADD-only DO-block).
--
-- BAND 0120-0129 (lane G16). Hook guard-migration-band g16 = [[120,129]]; 0120 đã dùng → 0121/0122 tiếp.
-- Journal: idx 85 / when 1717500210000 (> max-applied 1717500200000 của 0150 — migrator KHÔNG skip).
-- ⚠️ Số FILE (0121) ĐỘC LẬP với journal `when` (1717500210000): khoá apply là `when`, không phải tên file.
--
-- Mục đích G16-1b:
--   (1) READ-PATH AUDIT — ghi 1 audit_logs row cho mỗi lần ĐỌC dữ liệu nhạy cảm (payslip/salary,
--       channel-health). Tái dùng object_type sẵn có: payslip 'payslip', channel-health 'channel',
--       secret reveal đã audit 'platform_account' (PlatformAccountsService.revealSecret). Action là text
--       TỰ DO (audit_logs.action KHÔNG có CHECK) nên KHÔNG cần migration cho action mới — chỉ ghi who/when/scope.
--   (2) security_alerts (0122) ghi audit khi phát alert → cần object_type 'security_alert' trong CHECK.
--
-- HOT-FILE (TASKS §5.3): audit CHECK = UNION mọi lane. DO-block ADD-only (tiền lệ 0099/0132/0140/0150/0170):
--   KHÔNG drop re-stamp full-list ⇒ an toàn song song, KHÔNG bao giờ rớt type lane khác. Đọc CẢ HAI dạng
--   constraint: `IN ('a','b')` VÀ `= ANY ('{a,b}'::text[])` (output các DO-block trước). Chỉ thêm
--   'security_alert'. Sync AUDIT_OBJECT_TYPES (schema/audit.ts) CÙNG commit.

DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['security_alert'];
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
