-- Migration 0509: S5-LMS-DB-1 (🔴 RED, zone=red, crown) — UNION-ADD 2 audit object_type cho wave S5-LMS:
--   'lms_sso'  ← BE-2 ghi khi mint link SSO (action sso_link_minted, objectId=jti UUID, KHÔNG log token)
--   'lms_sync' ← BE-1 ghi summary job/bridge đồng bộ tài khoản MediaOS→LMS (đếm, KHÔNG dump email)
-- THUẦN DDL-CHECK — mirror 0506/0491/0474. KHÔNG db:generate, KHÔNG bảng/cột/quyền/seed mới.
--
-- BẤT BIẾN / QUYẾT ĐỊNH (plan docs/plans/S5-LMS-DB-1.md §0):
--   #2 append-only: UNION ADD-only. Tập giá trị hiện tại đọc TỪ pg_constraint THẬT rồi CỘNG DỒN —
--      TUYỆT ĐỐI KHÔNG dựng lại CHECK từ snapshot TS/file. Lý do đo được: CHECK đang có 101 giá trị,
--      trong đó 'defect' CHỈ tồn tại ở DB (0086) và ĐÃ BỊ GỠ khỏi mảng TS AUDIT_OBJECT_TYPES
--      (audit.ts:159-160) ⇒ rewrite-from-TS sẽ xoá mất nó ⇒ audit cũ vỡ 23514.
--   D3b FAIL-CLOSED (khác mẫu 0506 — vá 2 đường fail-open im lặng của mẫu đó):
--      • không resolve được constraint  → RAISE EXCEPTION (0506 chỉ NOTICE + RETURN = im lặng bỏ qua)
--      • parse constraintdef ra NULL    → RAISE EXCEPTION (0506 để NULL trôi xuống `NOT (NULL @> …)`
--        = NULL ⇒ v_add NULL ⇒ báo "da co san — skip" TRONG KHI THỰC CHẤT PARSE HỎNG)
--      • pg_get_constraintdef LUÔN render '= ANY (...)' (không bao giờ 'IN (…)'), nên nhánh phân biệt
--        theo chữ 'ANY' của 0506 là dead code. Dạng thật cần xử là ARRAY['x'::text, …] (có thật trên
--        chính bảng này: chk_audit_logs_actor_type) — nó làm substring '{...}' trả NULL ⇒ phải fallback.
--   D3c NO-LOSS: assert union ⊇ tập cũ TRƯỚC khi swap, và đọc lại def SAU khi swap để verify fail-LOUD.
--      Migrator chạy toàn bộ trong 1 transaction (src/db/migrate.ts) ⇒ EXCEPTION = rollback sạch,
--      KHÔNG có cửa sổ nào CHECK bị mất giá trị.
--   D4 giữ DROP + ADD (validate ngay), KHÔNG NOT VALID: audit_logs = 4.699 dòng / 1.5 MB (đo 2026-07-22)
--      và union là SUPERSET ⇒ validate scan tức thời và chắc chắn pass.
--
-- BAND 0509 (lane S5-LMS-DB-1). Journal: idx 189, when 1717587311000 (> 0508 idx 188 / 1717587310000).
--   AUDIT_OBJECT_TYPES (src/db/schema/audit.ts) sync 'lms_sso'+'lms_sync' CÙNG COMMIT.
--   ⚠ S5-GOAL-DB-2 cũng UNION-ADD ('task_template') vào CHECK NÀY: hai migration GIAO HOÁN (mỗi cái đọc
--     def thật rồi cộng dồn) — chỉ SỐ FILE xung đột. WO nào chạy sau phải kiểm _journal lấy số kế.
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
  v_new     text[] := ARRAY['lms_sso', 'lms_sync'];
  v_add     text[];
  v_union   text[];
  v_after   text[];
  v_missing text[];
  v_extra   text[];
BEGIN
  -- ── (0) Fail fast thay vì xếp hàng sau lock: ALTER dưới lấy ACCESS EXCLUSIVE trên audit_logs; nếu
  --        có phiên đang giữ lock yếu (report dài) thì MỌI INSERT audit (= mọi request ghi) sẽ kẹt sau
  --        ALTER. 5s: thà migration đỏ và chạy lại còn hơn treo đường ghi của cả hệ.
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── (1) Resolve CHECK: ưu tiên TÊN CHÍNH XÁC; fallback LIKE nhưng fail-closed khi số match ≠ 1 ──
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname = 'audit_logs_object_type_chk';

  IF v_oid IS NULL THEN
    SELECT count(*) INTO v_cnt
      FROM pg_constraint
     WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
       AND conname LIKE '%object_type%';

    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '[0509] khong xac dinh duoc CHECK object_type tren audit_logs (so match = %) — DUNG fail-closed', v_cnt;
    END IF;

    SELECT oid, conname INTO v_oid, v_con
      FROM pg_constraint
     WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
       AND conname LIKE '%object_type%';
  END IF;

  v_def := pg_get_constraintdef(v_oid);

  -- ── (2) Parse 2 tầng: (a) dạng bare '{a,b}'::text[] → (b) fallback ARRAY['a'::text,…] ──
  --   • Dùng cờ v_matched, KHÔNG suy ra "parse hỏng" từ array_length: CHECK rỗng hợp lệ ('{}'::text[])
  --     cũng cho array_length NULL ⇒ suy diễn kiểu đó sẽ nhầm "rỗng" thành "hỏng" rồi rơi xuống tầng 2.
  --   • Tầng 2 NEO vào đúng đoạn 'ARRAY[…]' (danh sách CHO PHÉP), KHÔNG quét cả constraintdef: CHECK
  --     hợp thành kiểu `… = ANY (ARRAY[…]) AND object_type <> 'x'` sẽ bị quét-cả-chuỗi hút luôn 'x' từ
  --     VẾ PHỦ ĐỊNH ⇒ giá trị đang bị CẤM tường minh lại được đưa vào danh sách cho phép.
  v_raw := substring(v_def FROM '\{[^}]*\}');
  IF v_raw IS NOT NULL THEN
    v_cur := v_raw::text[];
    v_matched := true;
  ELSE
    v_raw := substring(v_def FROM 'ARRAY\[[^]]*\]');
    IF v_raw IS NOT NULL THEN
      SELECT array_agg(m[1]) INTO v_cur
        FROM (
          SELECT regexp_matches(v_raw, '''([^'']+)''', 'g') AS m
        ) sub;
      v_matched := v_cur IS NOT NULL;
    END IF;
  END IF;

  IF NOT v_matched OR v_cur IS NULL THEN
    RAISE EXCEPTION '[0509] khong parse duoc constraintdef cua % : % — DUNG fail-closed', v_con, v_def;
  END IF;

  -- ── (3) Chỉ thêm phần còn THIẾU (idempotent) ──
  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) IS NULL THEN
    RAISE NOTICE '[0509] lms_sso/lms_sync da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  -- ── (4) Union + assert SUPERSET trước khi swap (bất biến #2) ──
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  -- (chốt chặn NULL-element: v_union sinh từ chính v_cur nên superset là hiển nhiên — lưới thật nằm
  --  ở verify (5) đọc lại def SAU khi swap.)
  IF NOT (v_union @> v_cur) THEN
    RAISE EXCEPTION '[0509] union danh mat gia tri cu — DUNG (bat bien #2 append-only)';
  END IF;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );

  -- ── (5) VERIFY fail-LOUD: đọc lại def THẬT, phải chứa ĐỦ (tập cũ ∪ 2 giá trị mới) ──
  SELECT substring(pg_get_constraintdef(oid) FROM '\{[^}]*\}')::text[] INTO v_after
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c' AND conname = v_con;

  SELECT array_agg(t) INTO v_missing
    FROM unnest(v_cur || v_new) AS t
   WHERE v_after IS NULL OR NOT (v_after @> ARRAY[t]);

  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION '[0509] verify NO-LOSS that bai — CHECK thieu: %', array_to_string(v_missing, ', ');
  END IF;

  -- ── (5b) VERIFY NO-GAIN: CHECK mới KHÔNG được PHÌNH ngoài (tập cũ ∪ 2 giá trị mới). Đối xứng với
  --        (5): no-loss chặn mất giá trị, no-gain chặn parse-nhầm nuốt thêm giá trị (vd hút từ vế phủ
  --        định của CHECK hợp thành) — nới CHECK âm thầm cũng là lỗi an ninh, không chỉ lỗi dữ liệu.
  SELECT array_agg(t) INTO v_extra
    FROM unnest(COALESCE(v_after, ARRAY[]::text[])) AS t
   WHERE NOT ((v_cur || v_new) @> ARRAY[t]);

  IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 THEN
    RAISE EXCEPTION '[0509] verify NO-GAIN that bai — CHECK phinh them: %', array_to_string(v_extra, ', ');
  END IF;

  RAISE NOTICE '[0509] da them % vao CHECK object_type cua audit_logs (tong % gia tri)',
    array_to_string(v_add, ', '), array_length(v_after, 1);
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- KHÔNG có down: gỡ giá trị khỏi CHECK sẽ làm mọi hàng audit_logs đã ghi với object_type đó vỡ
-- constraint (bất biến #2 append-only — audit KHÔNG sửa/xoá được). Rollback = revert code BE-1/BE-2.
