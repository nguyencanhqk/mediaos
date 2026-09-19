-- Migration 0579: S16-SOCIAL-DB-1 (🔴 RED, zone=red, crown) — UNION-ADD 'feed_post', 'feed_comment',
--   'feed_group', 'feed_report' vào CHECK audit_logs.object_type. THUẦN DDL-CHECK — clone NGUYÊN KHỐI
--   0545 (bản đã NEO 2 TẦNG). KHÔNG db:generate, KHÔNG bảng/cột/quyền/seed.
--
-- VÌ SAO TÁCH KHỎI 0578: `ALTER TABLE audit_logs` lấy ACCESS EXCLUSIVE trên bảng audit của cả hệ.
--   Tách để một lock-timeout KHÔNG rollback luôn transaction seed quyền đã thành công (nguyên lý 0545).
--
-- VÌ SAO BỐN GIÁ TRỊ (DB-17 §3.2):
--   'feed_post'    — ẩn/xoá/ghim bài của người khác (manage:feed-post · manage:feed-news).
--   'feed_comment' — ẩn/xoá bình luận của người khác.
--   'feed_report'  — xử lý báo cáo vi phạm (resolved/dismissed) = quyết định kỷ luật nội dung.
--   'feed_group'   — FRONT-LOAD CÓ CHỦ Ý cho Track B. Giá trị của CHECK là CHUỖI, độc lập hoàn toàn
--                    với sự tồn tại của bảng `feed_groups`. Thêm ngay ở đây để DB-2 KHÔNG phải đụng
--                    lại hot-file audit lần hai (mỗi lần đụng là một lần ACCESS EXCLUSIVE + một lần
--                    rủi ro parse). Quyết định của DB-17 §3.2, giữ nguyên.
--
-- ⚠️ `file_links` KHÔNG có gì để UNION-ADD (plan §0.1 — đo trên DB thật 19/09/2026):
--   cột thật tên `entity_type` (KHÔNG phải `object_type`), và `file_links` chỉ có 2 CHECK
--   (`chk_file_links_link_type`, `chk_file_links_access_scope`) — KHÔNG CHECK nào trên `entity_type`,
--   cột tự do không allow-list (0433:159-164, schema/files.ts:116). Gắn file vào bài/bình luận chỉ cần
--   ghi module_code='SOCIAL', entity_type='feed_post'|'feed_comment', link_type='Attachment' (giá trị
--   ĐÃ CÓ trong CHECK) — hoàn toàn ở tầng SERVICE (BE-1). ⇒ 0 dòng DDL cho file_links ở DB-1.
--
-- BẤT BIẾN / QUYẾT ĐỊNH (CLAUDE.md §2):
--   #2 append-only: UNION ADD-only. Đọc tập giá trị TỪ pg_constraint THẬT rồi CỘNG DỒN — TUYỆT ĐỐI
--      KHÔNG dựng lại CHECK từ snapshot TS/file (canary 'defect' chỉ có ở DB — 0086 — sẽ mất ⇒ audit
--      cũ vỡ 23514).
--   NEO 2 TẦNG (audit-check-union-parse-anchor-trap): parse phải NEO vào vế `object_type = ANY (…)`,
--      KHÔNG quét `{…}`/`ARRAY[…]` trên CẢ constraintdef — nếu không thì vế phủ định đứng trước bị hút
--      nhầm và cả NO-LOSS lẫn NO-GAIN đều PASS-OAN vì tính trên tập đã parse SAI.
--   FAIL-CLOSED: không resolve được constraint → THROW; parse ra NULL → THROW.
--   NO-LOSS + NO-GAIN: đọc lại def SAU swap, assert (cũ ∪ mới) ⊆ after ⊆ (cũ ∪ mới). Migrator 1 tx ⇒
--      EXCEPTION = rollback sạch, KHÔNG cửa sổ CHECK mất giá trị.
--   lock_timeout 5s: thà đỏ + chạy lại còn hơn treo đường ghi audit của cả hệ.
--
-- MỐC ĐO (plan §0.0, đo trên `mediaos` PG 17.10 ngày 19/09/2026): CHECK đang có **127** giá trị, chưa
--   có `feed_*` nào ⇒ sau migration phải đúng **131**. Hai con số này được RAISE NOTICE ra log migrate
--   và được ghim thành ASSERT trong `s16-social-db1-invariants.int-spec.ts` (ratchet — lane nào thêm
--   object_type mới thì sửa số ở đó một cách CÓ CHỦ Ý).
--   ⚠️ CỐ Ý KHÔNG hard-code 127/131 làm điều kiện RAISE trong migration này: một lane khác merge trước
--   sẽ làm con số dịch và migration đỏ ở MỌI lần migrate, chặn cả hệ vì một hằng số văn bản. Lưới thật
--   là phép SỐ HỌC đúng-bằng ở (5c) — |after| = |cũ| + |thêm| — cộng NO-LOSS + NO-GAIN theo TẬP.
--
-- BAND 0579 (lane S16-SOCIAL-DB-1). Journal: idx 246, when 1717587368000 (> 0578 idx 245 / 1717587367000).
--   AUDIT_OBJECT_TYPES (src/db/schema/audit.ts) sync 4 giá trị CÙNG COMMIT.
--   ⚠ 0509/0528/0545 cũng UNION-ADD vào CHECK NÀY — cả bốn GIAO HOÁN (mỗi cái đọc def thật rồi cộng dồn).
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
  v_new     text[] := ARRAY['feed_post', 'feed_comment', 'feed_group', 'feed_report'];
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
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname = 'audit_logs_object_type_chk';

  IF v_oid IS NULL THEN
    SELECT count(*) INTO v_cnt
      FROM pg_constraint
     WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
       AND conname LIKE '%object_type%';

    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '[0579] khong xac dinh duoc CHECK object_type tren audit_logs (so match = %) — DUNG fail-closed', v_cnt;
    END IF;

    SELECT oid, conname INTO v_oid, v_con
      FROM pg_constraint
     WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
       AND conname LIKE '%object_type%';
  END IF;

  v_def := pg_get_constraintdef(v_oid);

  -- ── (2) Parse 2 tầng, CẢ HAI NEO vào `object_type = ANY (…)` ──
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
    RAISE EXCEPTION '[0579] khong parse duoc allow-list cua object_type = ANY(...) cho % : % — DUNG fail-closed', v_con, v_def;
  END IF;

  RAISE NOTICE '[0579] CHECK object_type hien co % gia tri truoc UNION-ADD (moc do plan §0.0 = 127)',
    array_length(v_cur, 1);

  -- ── (3) Chỉ thêm phần còn THIẾU (idempotent) ──
  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) IS NULL THEN
    RAISE NOTICE '[0579] 4 gia tri feed_* da co trong CHECK — idempotent skip (tong % gia tri)',
      array_length(v_cur, 1);
    RETURN;
  END IF;

  -- ── (4) Union + assert SUPERSET trước khi swap (bất biến #2) ──
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  IF NOT (v_union @> v_cur) THEN
    RAISE EXCEPTION '[0579] union danh mat gia tri cu — DUNG (bat bien #2 append-only)';
  END IF;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );

  -- ── (5) VERIFY NO-LOSS fail-LOUD: đọc lại def THẬT (neo `object_type = ANY`) ──
  SELECT substring(pg_get_constraintdef(oid) FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*''(\{[^}]*\})''')::text[]
    INTO v_after
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c' AND conname = v_con;

  SELECT array_agg(t) INTO v_missing
    FROM unnest(v_cur || v_new) AS t
   WHERE v_after IS NULL OR NOT (v_after @> ARRAY[t]);

  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION '[0579] verify NO-LOSS that bai — CHECK thieu: %', array_to_string(v_missing, ', ');
  END IF;

  -- ── (5b) VERIFY NO-GAIN: CHECK mới KHÔNG PHÌNH ngoài (cũ ∪ mới) ──
  SELECT array_agg(t) INTO v_extra
    FROM unnest(COALESCE(v_after, ARRAY[]::text[])) AS t
   WHERE NOT ((v_cur || v_new) @> ARRAY[t]);

  IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 THEN
    RAISE EXCEPTION '[0579] verify NO-GAIN that bai — CHECK phinh them: %', array_to_string(v_extra, ', ');
  END IF;

  -- ── (5c) VERIFY SỐ HỌC đúng-bằng: |after| = |cũ| + |thêm|. Bịt lỗ mà (5)/(5b) theo TẬP bỏ sót —
  --        nếu def cũ có giá trị TRÙNG LẶP thì cả hai assert tập vẫn PASS trong khi tập đã bị co lại.
  IF array_length(v_after, 1) <> array_length(v_cur, 1) + array_length(v_add, 1) THEN
    RAISE EXCEPTION '[0579] verify SO HOC that bai — |after| = %, ky vong % (= |cu| % + |them| %)',
      array_length(v_after, 1), array_length(v_cur, 1) + array_length(v_add, 1),
      array_length(v_cur, 1), array_length(v_add, 1);
  END IF;

  RAISE NOTICE '[0579] da them % vao CHECK object_type cua audit_logs (% -> % gia tri; moc plan §0.0 = 127 -> 131)',
    array_to_string(v_add, ', '), array_length(v_cur, 1), array_length(v_after, 1);
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- KHÔNG có down: gỡ giá trị khỏi CHECK sẽ làm mọi hàng audit_logs đã ghi object_type='feed_post' /
-- 'feed_comment' / 'feed_group' / 'feed_report' vỡ constraint (bất biến #2 append-only).
-- Rollback = revert code S16-SOCIAL-BE-1.
