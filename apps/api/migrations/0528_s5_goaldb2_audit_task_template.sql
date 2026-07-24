-- Migration 0528: S5-GOAL-DB-2 (🔴 RED, zone=red, crown) — UNION-ADD 'task_template' vào CHECK
--   audit_logs.object_type. Ghi bởi GOAL-BE khi tạo/sửa/xoá template phân rã (đợt D — TPL-1).
--   THUẦN DDL-CHECK — mirror 0509 (pure-audit, probe-testable). KHÔNG db:generate, KHÔNG bảng/cột/quyền/seed.
--
-- BẤT BIẾN / QUYẾT ĐỊNH (plan docs/plans/S5-GOAL-DB-2.md §0 D4):
--   #2 append-only: UNION ADD-only. Đọc tập giá trị TỪ pg_constraint THẬT rồi CỘNG DỒN — TUYỆT ĐỐI KHÔNG
--      dựng lại CHECK từ snapshot TS/file (canary 'defect' chỉ có ở DB — 0086 — sẽ mất ⇒ audit cũ vỡ 23514).
--   D4 NEO 2 TẦNG (memory audit-check-union-parse-anchor-trap — WO này CHÍNH LÀ "bản clone" mà PR #259
--      cảnh báo): parse mảng phải NEO vào vế `object_type = ANY (…)`, KHÔNG quét `{…}`/`ARRAY[…]` trên CẢ
--      constraintdef. Lý do: CHECK hợp thành `other <> ALL('{ghost}') AND object_type = ANY('{company}')`
--      thì `{…}` ĐẦU TIÊN trong chuỗi là `{ghost}` của VẾ PHỦ ĐỊNH ⇒ tầng-1 chưa-neo của 0509 sẽ:
--      (1) MẤT company/user (dựng union từ {ghost}), (2) NUỐT 'ghost' đang bị cấm vào allow-list — và cả
--      NO-LOSS lẫn NO-GAIN đều PASS-OAN vì tính trên v_cur đã parse SAI. 0509 mới neo tầng-2 (ARRAY), CÒN HỞ
--      tầng-1 (bare). Ở đây neo CẢ HAI vào `object_type = ANY (`.
--   D3b FAIL-CLOSED (giữ như 0509): không resolve được constraint → THROW; parse ra NULL → THROW;
--      pg_get_constraintdef LUÔN render '= ANY (…)'.
--   D3c NO-LOSS + NO-GAIN: đọc lại def SAU swap, assert (cũ ∪ mới) ⊆ after ⊆ (cũ ∪ mới). Migrator 1 tx ⇒
--      EXCEPTION = rollback sạch, KHÔNG cửa sổ CHECK mất giá trị.
--   D4b lock_timeout 5s: ALTER lấy ACCESS EXCLUSIVE trên audit_logs — thà đỏ+chạy lại còn hơn treo đường ghi.
--
-- BAND 0528 (lane S5-GOAL-DB-2). Journal: idx 195, when 1717587317000 (> 0527 idx 194 / 1717587316000).
--   AUDIT_OBJECT_TYPES (src/db/schema/audit.ts) sync 'task_template' CÙNG COMMIT.
--   ⚠ 0509 cũng UNION-ADD ('lms_sso'/'lms_sync') vào CHECK NÀY — hai migration GIAO HOÁN (mỗi cái đọc def
--     thật rồi cộng dồn); chỉ SỐ FILE từng xung đột (đã tách: 0509 vs 0528).
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
  v_new     text[] := ARRAY['task_template'];
  v_add     text[];
  v_union   text[];
  v_after   text[];
  v_missing text[];
  v_extra   text[];
BEGIN
  -- ── (0) Fail fast thay vì xếp hàng sau lock (mẫu 0509) ──
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
      RAISE EXCEPTION '[0528] khong xac dinh duoc CHECK object_type tren audit_logs (so match = %) — DUNG fail-closed', v_cnt;
    END IF;

    SELECT oid, conname INTO v_oid, v_con
      FROM pg_constraint
     WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
       AND conname LIKE '%object_type%';
  END IF;

  v_def := pg_get_constraintdef(v_oid);

  -- ── (2) Parse 2 tầng, CẢ HAI NEO vào `object_type = ANY (…)` (D4 — khác 0509 vốn chỉ neo tầng-2) ──
  --   Tầng 1 (bare '{a,b}'::text[]): bắt `{…}` NGAY SAU `object_type = ANY ('`. Vế phủ định `other <> ALL
  --     ('{ghost}')` đứng trước KHÔNG khớp (thiếu `= ANY`), nên `{ghost}` KHÔNG bị hút.
  --   Tầng 2 (ARRAY['a'::text,…]): bắt `ARRAY[…]` NGAY SAU `object_type = ANY (`.
  --   `substring(x FROM pat)` trả nhóm bắt () ĐẦU TIÊN; các `\(`/`\[` là ký tự literal (không phải nhóm).
  v_raw := substring(v_def FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*''(\{[^}]*\})''');
  IF v_raw IS NOT NULL THEN
    v_cur := v_raw::text[];
    v_matched := true;
  ELSE
    v_raw := substring(v_def FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*(ARRAY\[[^]]*\])');
    IF v_raw IS NOT NULL THEN
      SELECT array_agg(m[1]) INTO v_cur
        FROM (
          SELECT regexp_matches(v_raw, '''([^'']+)''', 'g') AS m
        ) sub;
      v_matched := v_cur IS NOT NULL;
    END IF;
  END IF;

  IF NOT v_matched OR v_cur IS NULL THEN
    RAISE EXCEPTION '[0528] khong parse duoc allow-list cua object_type = ANY(...) cho % : % — DUNG fail-closed', v_con, v_def;
  END IF;

  -- ── (3) Chỉ thêm phần còn THIẾU (idempotent) ──
  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) IS NULL THEN
    RAISE NOTICE '[0528] task_template da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  -- ── (4) Union + assert SUPERSET trước khi swap (bất biến #2) ──
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  IF NOT (v_union @> v_cur) THEN
    RAISE EXCEPTION '[0528] union danh mat gia tri cu — DUNG (bat bien #2 append-only)';
  END IF;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );

  -- ── (5) VERIFY fail-LOUD: đọc lại def THẬT (neo `object_type = ANY`), phải chứa ĐỦ (cũ ∪ mới) ──
  SELECT substring(pg_get_constraintdef(oid) FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*''(\{[^}]*\})''')::text[]
    INTO v_after
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c' AND conname = v_con;

  SELECT array_agg(t) INTO v_missing
    FROM unnest(v_cur || v_new) AS t
   WHERE v_after IS NULL OR NOT (v_after @> ARRAY[t]);

  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION '[0528] verify NO-LOSS that bai — CHECK thieu: %', array_to_string(v_missing, ', ');
  END IF;

  -- ── (5b) VERIFY NO-GAIN: CHECK mới KHÔNG PHÌNH ngoài (cũ ∪ mới) — chặn parse-nhầm nuốt thêm giá trị ──
  SELECT array_agg(t) INTO v_extra
    FROM unnest(COALESCE(v_after, ARRAY[]::text[])) AS t
   WHERE NOT ((v_cur || v_new) @> ARRAY[t]);

  IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 THEN
    RAISE EXCEPTION '[0528] verify NO-GAIN that bai — CHECK phinh them: %', array_to_string(v_extra, ', ');
  END IF;

  RAISE NOTICE '[0528] da them % vao CHECK object_type cua audit_logs (tong % gia tri)',
    array_to_string(v_add, ', '), array_length(v_after, 1);
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- KHÔNG có down: gỡ giá trị khỏi CHECK sẽ làm mọi hàng audit_logs đã ghi object_type='task_template' vỡ
-- constraint (bất biến #2 append-only). Rollback = revert code GOAL-BE (TPL-1).
