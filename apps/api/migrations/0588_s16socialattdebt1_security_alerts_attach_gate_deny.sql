-- S16-SOCIAL-ATTDEBT-1 (C-5) — UNION-ADD `attach_gate_deny` vào CHECK `security_alerts.alert_type`.
--
-- Vì sao cần một loại MỚI thay vì mượn `repeated_cross_scope_deny` (owner ký S-3): chữ «repeated»
-- hàm ý NGƯỠNG, còn cổng gắn tệp phát tín hiệu theo TỪNG lượt deny. Mượn = ghi một lời khai SAI vào
-- một bảng **append-only** (sửa không được — đó là cả điểm của bảng), và làm nhiễu mọi câu đếm đang
-- dựa vào loại đó.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 🔴 VÁ FULL GATE (database-reviewer MEDIUM-1, 24/09/2026) — ĐỌC TẬP GIÁ TRỊ TỪ `pg_constraint`
--    THẬT RỒI CỘNG DỒN. Bản đầu của file này `DROP IF EXISTS` + `ADD` với 4 giá trị **gõ tay** lấy
--    từ *file nguồn* 0122. Repo đã chuẩn hoá khuôn NGƯỢC LẠI cho đúng lớp việc này
--    (0509 · 0528 · 0545 · 0579 · 0583) vì dựng lại CHECK từ snapshot TS/file làm MẤT mọi giá trị
--    chỉ tồn tại ở DB. Hai kịch bản hỏng trên môi trường đã biết là trôi (dev-online/PROD lệch 3
--    chiều):
--      (1) MẤT TRONG IM LẶNG — env có một giá trị thêm ngoài luồng ⇒ DROP gỡ sạch, ADD literal dựng
--          lại thiếu ⇒ đường `emit()` của loại bị mất ném 23514, mà `SecurityAlertService.emit()`
--          **NUỐT lỗi và trả `false`** ⇒ tín hiệu an ninh biến mất, chỉ còn một dòng `logger.error`.
--      (2) CHẶN CẢ DEPLOY — env đó đã có HÀNG mang giá trị ngoài luồng ⇒ `ADD CONSTRAINT` (validate
--          toàn bảng) ném 23514 ⇒ migrator drizzle chạy MỌI migration pending trong MỘT transaction
--          ⇒ rollback toàn band, `db:migrate` đỏ vĩnh viễn tới khi có người vào tay.
--    Khuôn dưới đây là clone NGUYÊN KHỐI của 0583 (chính nó clone 0579 ← 0545), đổi bảng/cột/giá trị.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
--
-- BẤT BIẾN / QUYẾT ĐỊNH (CLAUDE.md §2):
--   #2 append-only: UNION ADD-only. KHÔNG dựng lại CHECK từ snapshot TS/file.
--   NEO 2 TẦNG (audit-check-union-parse-anchor-trap): parse phải NEO vào vế `alert_type = ANY (…)`,
--      KHÔNG quét `{…}`/`ARRAY[…]` trên CẢ constraintdef. Tầng 1 = literal `'{…}'` (dạng pg in ra
--      SAU khi chính file này ADD bằng `%L::text[]`); tầng 2 = fallback `ARRAY[…]` (dạng pg in ra
--      cho CHECK gốc 0122, vốn viết `alert_type IN (…)` và được chuẩn hoá thành `= ANY (ARRAY[…])`).
--      BỎ tầng 2 ⇒ fail-closed OAN ngay lần chạy đầu trên mọi DB chưa áp file này.
--   FAIL-CLOSED: không resolve được constraint → THROW; parse ra NULL → THROW.
--   NO-LOSS + NO-GAIN + SỐ HỌC: đọc lại def SAU swap và assert cả ba. Migrator 1 tx ⇒ EXCEPTION =
--      rollback sạch, KHÔNG có cửa sổ nào mà CHECK thiếu giá trị.
--   lock_timeout 5s (vá FULL gate MEDIUM-2): `ALTER TABLE` lấy ACCESS EXCLUSIVE trên `security_alerts`.
--      Thà đỏ + chạy lại còn hơn xếp hàng vô hạn sau một transaction dài và kéo theo mọi lệnh ghi
--      alert đến sau. `set_config(…, true)` là transaction-local ⇒ hết lượt migrator là hết hiệu lực.
--
-- ⚠️ HAI nơi phải đổi CÙNG lượt: DDL dưới đây **và** hằng TS `SECURITY_ALERT_TYPES`
--    (`src/db/schema/security-alerts.ts`). Quên hằng ⇒ TS đỏ (tốt). Quên DDL **hoặc quên dòng trong
--    `meta/_journal.json`** ⇒ migration bị BỎ QUA trong im lặng ⇒ INSERT vỡ CHECK lúc chạy ⇒
--    `emit()` NUỐT lỗi ⇒ alert biến mất mà chỉ còn một dòng log. Lưới duy nhất thấy được ca đó là
--    int-spec H7 (assert HÀNG được ghi) + H11 (`pg_indexes`).
--
-- KHÔNG đụng RLS/FORCE/policy/grant của bảng (mig 0122 giữ nguyên: app role chỉ SELECT + INSERT).
-- BAND 0588 (lane S16-SOCIAL-ATTDEBT-1). Journal: idx 255, when 1717587377000 (> 0587 idx 254).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_oid     oid;
  v_con     text;
  v_def     text;
  v_raw     text;
  v_matched boolean := false;
  v_cnt     int;
  v_cur     text[];
  v_new     text[] := ARRAY['attach_gate_deny'];
  v_add     text[];
  v_union   text[];
  v_after   text[];
  v_missing text[];
  v_extra   text[];
BEGIN
  -- ── (0) Fail fast thay vì xếp hàng sau lock ──
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── (1) Resolve CHECK: ưu tiên TÊN CHÍNH XÁC; fallback LIKE nhưng fail-closed khi số match ≠ 1 ──
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'security_alerts'::regclass AND contype = 'c'
     AND conname = 'security_alerts_type_check';

  IF v_oid IS NULL THEN
    SELECT count(*) INTO v_cnt
      FROM pg_constraint
     WHERE conrelid = 'security_alerts'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%alert_type%';

    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '[0588] khong xac dinh duoc CHECK alert_type tren security_alerts (so match = %) — DUNG fail-closed', v_cnt;
    END IF;

    SELECT oid, conname INTO v_oid, v_con
      FROM pg_constraint
     WHERE conrelid = 'security_alerts'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%alert_type%';
  END IF;

  v_def := pg_get_constraintdef(v_oid);

  -- ── (2) Parse 2 tầng, CẢ HAI NEO vào `alert_type = ANY (…)` ──
  v_raw := substring(v_def FROM 'alert_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*''(\{[^}]*\})''');
  IF v_raw IS NOT NULL THEN
    v_cur := v_raw::text[];
    v_matched := true;
  ELSE
    v_raw := substring(v_def FROM 'alert_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*(ARRAY\[[^]]*\])');
    IF v_raw IS NOT NULL THEN
      SELECT array_agg(m[1]) INTO v_cur
        FROM (
          SELECT regexp_matches(v_raw, '''([^'']+)''', 'g') AS m
        ) sub;
      v_matched := v_cur IS NOT NULL;
    END IF;
  END IF;

  IF NOT v_matched OR v_cur IS NULL THEN
    RAISE EXCEPTION '[0588] khong parse duoc allow-list cua alert_type = ANY(...) cho % : % — DUNG fail-closed', v_con, v_def;
  END IF;

  RAISE NOTICE '[0588] CHECK alert_type hien co % gia tri truoc UNION-ADD (moc do mig 0122 = 3)',
    array_length(v_cur, 1);

  -- ── (3) Chỉ thêm phần còn THIẾU (idempotent) ──
  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) IS NULL THEN
    RAISE NOTICE '[0588] attach_gate_deny da co trong CHECK — idempotent skip (tong % gia tri)',
      array_length(v_cur, 1);
    RETURN;
  END IF;

  -- ── (4) Union + assert SUPERSET trước khi swap (bất biến #2) ──
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  IF NOT (v_union @> v_cur) THEN
    RAISE EXCEPTION '[0588] union danh mat gia tri cu — DUNG (bat bien #2 append-only)';
  END IF;

  EXECUTE format('ALTER TABLE security_alerts DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE security_alerts ADD CONSTRAINT %I CHECK (alert_type = ANY(%L::text[]))',
    v_con, v_union
  );

  -- ── (5) VERIFY NO-LOSS fail-LOUD: đọc lại def THẬT (neo `alert_type = ANY`) ──
  SELECT substring(pg_get_constraintdef(oid) FROM 'alert_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*''(\{[^}]*\})''')::text[]
    INTO v_after
    FROM pg_constraint
   WHERE conrelid = 'security_alerts'::regclass AND contype = 'c' AND conname = v_con;

  SELECT array_agg(t) INTO v_missing
    FROM unnest(v_cur || v_new) AS t
   WHERE v_after IS NULL OR NOT (v_after @> ARRAY[t]);

  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION '[0588] verify NO-LOSS that bai — CHECK thieu: %', array_to_string(v_missing, ', ');
  END IF;

  -- ── (5b) VERIFY NO-GAIN: CHECK mới KHÔNG PHÌNH ngoài (cũ ∪ mới) ──
  SELECT array_agg(t) INTO v_extra
    FROM unnest(COALESCE(v_after, ARRAY[]::text[])) AS t
   WHERE NOT ((v_cur || v_new) @> ARRAY[t]);

  IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 THEN
    RAISE EXCEPTION '[0588] verify NO-GAIN that bai — CHECK phinh them: %', array_to_string(v_extra, ', ');
  END IF;

  -- ── (5c) VERIFY SỐ HỌC đúng-bằng: |after| = |cũ| + |thêm|. Bịt lỗ mà (5)/(5b) theo TẬP bỏ sót —
  --        nếu def cũ có giá trị TRÙNG LẶP thì cả hai assert tập vẫn PASS trong khi tập đã bị co lại.
  IF array_length(v_after, 1) <> array_length(v_cur, 1) + array_length(v_add, 1) THEN
    RAISE EXCEPTION '[0588] verify SO HOC that bai — |after| = %, ky vong % (= |cu| % + |them| %)',
      array_length(v_after, 1), array_length(v_cur, 1) + array_length(v_add, 1),
      array_length(v_cur, 1), array_length(v_add, 1);
  END IF;

  RAISE NOTICE '[0588] da them % vao CHECK alert_type cua security_alerts (% -> % gia tri)',
    array_to_string(v_add, ', '), array_length(v_cur, 1), array_length(v_after, 1);
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- KHÔNG có down: gỡ giá trị khỏi CHECK sẽ làm mọi hàng `security_alerts` đã ghi
-- alert_type='attach_gate_deny' vỡ constraint (bất biến #2 append-only).
-- Rollback = revert code S16-SOCIAL-ATTDEBT-1.
