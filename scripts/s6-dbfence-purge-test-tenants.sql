-- s6-dbfence-purge-test-tenants.sql — S6-SEC-DBFENCE-1 (KI-028) · BƯỚC PURGE
--
-- ⚠ CHẠY SAU KHI HÀNG RÀO ĐÃ ĐỨNG. Purge trước khi bịt nguồn rò là vô nghĩa: lần đóng 27/7 đã dọn
--   16 tenant và 2 ngày sau có 74. Hàng rào: apps/api/test/db-target.ts + apps/api/test/global-setup.ts.
--
-- LÀM GÌ. Hard-delete TOÀN BỘ dữ liệu của các company khớp mẫu tenant test
-- (`slug ~ '-[0-9a-f]{8}$'` = hậu tố randomUUID của `test/helpers/seed.ts::seedCompany`).
-- Đo trên PROD 2026-07-28: 74 company · 251 user (226 active) · 18 tài khoản vừa đăng nhập được vừa
-- giữ role TOÀN CỤC (5 platform-admin — có đường đọc chéo tenant) · 37 refresh token còn sống.
--
-- VÌ SAO DÙNG session_replication_role = replica. 155 FK trỏ `companies` (11 NO ACTION) và 38 FK trỏ
-- `users` (36 NO ACTION + 2 RESTRICT) ⇒ không tồn tại một thứ tự xoá đơn giản nào. Đã CHỨNG MINH bằng
-- đo (và kiểm lại NGAY TRONG transaction ở PHẦN 2): cây con tenant test **khép kín** — 0 dòng nằm
-- ngoài tập tham chiếu vào trong. Xoá trọn cây con khép kín không để lại tham chiếu treo, nên tắt
-- FK-trigger trong phạm vi transaction là an toàn, và PHẦN 6 quét lại toàn bộ FK để chứng minh.
-- `SET LOCAL` ⇒ tự khôi phục khi commit/rollback. Cần superuser (`mediaos`).
--
-- ⚠ ĐÍNH CHÍNH (FULL gate 2026-07-28, đo bằng `pg_trigger`): chế độ `replica` tắt **CẢ 17 trigger
--   user**, KHÔNG chỉ FK — gồm `trg_audit_logs_block_mutation`, `enforce_company_id_immutable`×8,
--   `enforce_attendance_period_lock`, `enforce_payroll_period_status`, `enforce_payslip_ack_status`,
--   `enforce_break_glass_grant_status`, `scrub_reset_token_plaintext`. Vô hại cho THAO TÁC NÀY vì chỉ
--   `audit_logs` có trigger bắn ON DELETE, và function đó vốn chỉ chặn `current_user='mediaos_app'`
--   (superuser đi qua được kể cả khi trigger bật). RLS KHÔNG bị ảnh hưởng (superuser bypass sẵn).
--   Verify hậu kiểm: 17/17 trigger `tgenabled='O'`, `session_replication_role='origin'`, diff
--   `--schema-only` trước/sau = rỗng. Ai tái sử dụng script phải đọc kỹ đoạn này.
--
-- ⚠ HAI GIỚI HẠN CÒN LẠI của bằng chứng (chưa vá, ghi để người sau biết):
--   1. PHẦN 6 chỉ quét FK ĐƠN CỘT (`array_length(conkey,1)=1`) ⇒ bỏ sót FK composite duy nhất
--      `tasks_parent_same_company_fk`. Lượt 2026-07-28 đã quét bù bằng tay: 0 dòng treo.
--   2. PHẦN 5 chỉ đếm lại **user** funtime. Nếu một dòng funtime trỏ tới một dòng của tenant test ở
--      bảng KHÁC (không phải companies/users), PHẦN 2 không bắt, PHẦN 4b sẽ xoá nó như mồ côi mà
--      PHẦN 5 không thấy. Muốn dùng lại: chụp `count(*)` mọi bảng có `company_id = funtime` TRƯỚC/SAU
--      và chốt bằng nhau.
--
-- ⚠ KHÔNG PHỦ MATERIALIZED VIEW. Không `DELETE` được trên matview; `mv_dashboard_output` và
--   `mv_dashboard_task_status` mang `company_id` nên GIỮ LẠI dòng của tenant đã xoá (đo 2026-07-28:
--   20 dòng ma, trong đó 2 company_id tồn dư từ đợt dọn 27/7). Sau purge PHẢI chạy bằng role OWNER:
--     REFRESH MATERIALIZED VIEW mv_dashboard_output;
--     REFRESH MATERIALIZED VIEW mv_dashboard_task_status;
--   `scripts/check-prod-test-tenants.mjs` nay đếm dòng ma này và ĐỎ nếu ≠ 0.
--
-- AN TOÀN:
--   • Một transaction duy nhất. Bất kỳ chốt nào trượt ⇒ RAISE EXCEPTION ⇒ ROLLBACK toàn bộ.
--   • `funtime` (46 user = 35 active + 11 locked) được chốt TRƯỚC và SAU; lệch 1 dòng ⇒ rollback.
--   • Chỉ chạm company khớp mẫu hex-8. `funtime` KHÔNG khớp.
--
-- CHẠY (BACKUP TRƯỚC — bắt buộc):
--   docker exec mediaos-postgres pg_dump -U mediaos -Fc mediaos > /c/tmp/mediaos-pre-purge.dump
--   docker exec -i mediaos-postgres psql -U mediaos -d mediaos -v ON_ERROR_STOP=1 \
--     -f - < scripts/s6-dbfence-purge-test-tenants.sql
--
-- KIỂM SAU:  node scripts/check-prod-test-tenants.mjs   → phải exit 0

\set ON_ERROR_STOP on
\pset pager off
\timing on

BEGIN;

-- ── PHẦN 1: xác định tập + chốt an toàn TRƯỚC ────────────────────────────────────────────────
CREATE TEMP TABLE _test_co ON COMMIT DROP AS
  SELECT id, slug FROM companies WHERE slug ~ '-[0-9a-f]{8}$';
CREATE TEMP TABLE _test_user ON COMMIT DROP AS
  SELECT u.id FROM users u WHERE u.company_id IN (SELECT id FROM _test_co);
CREATE TEMP TABLE _funtime_truoc ON COMMIT DROP AS
  SELECT count(*) FILTER (WHERE u.status = 'active')                AS active,
         count(*) FILTER (WHERE u.status = 'locked')                AS locked,
         count(*)                                                   AS tong
    FROM users u JOIN companies c ON c.id = u.company_id WHERE c.slug = 'funtime';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _test_co WHERE slug = 'funtime';
  IF n > 0 THEN
    RAISE EXCEPTION 'DỪNG: funtime lọt vào tập tenant test — kiểm lại mẫu slug';
  END IF;
  SELECT tong INTO n FROM _funtime_truoc;
  IF n <> 46 THEN
    RAISE EXCEPTION 'DỪNG: funtime có % user, kỳ vọng 46 (baseline 2026-07-28) — dừng để người xem lại', n;
  END IF;
END $$;

\echo '=== TRƯỚC ==='
SELECT (SELECT count(*) FROM _test_co)                                       AS company_test,
       (SELECT count(*) FROM _test_user)                                     AS user_test,
       (SELECT count(*) FROM users u WHERE u.id IN (SELECT id FROM _test_user)
          AND u.deleted_at IS NULL AND u.status = 'active')                  AS user_test_active,
       (SELECT count(DISTINCT ur.user_id) FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id IN (SELECT id FROM _test_user)
           AND ur.deleted_at IS NULL AND r.company_id IS NULL)               AS user_role_toan_cuc,
       (SELECT count(*) FROM refresh_tokens rt WHERE rt.user_id IN (SELECT id FROM _test_user)
           AND rt.revoked_at IS NULL AND rt.expires_at > now())              AS token_con_song,
       (SELECT tong FROM _funtime_truoc)                                     AS funtime_user;

-- ── PHẦN 2: kiểm lại KHÉP KÍN ngay trong transaction (điều kiện tiên quyết) ───────────────────
DO $$
DECLARE r record; n bigint; tong bigint := 0; ket text := '';
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS bang, a.attname AS cot,
           c.confrelid::regclass::text AS bang_dich
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid IN ('companies'::regclass, 'users'::regclass)
       AND EXISTS (SELECT 1 FROM pg_attribute ca
                    WHERE ca.attrelid = c.conrelid AND ca.attname = 'company_id' AND ca.attnum > 0)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s t WHERE t.%I IS NOT NULL AND t.%I IN (SELECT id FROM %s)
         AND (t.company_id IS NULL OR t.company_id NOT IN (SELECT id FROM _test_co))',
      r.bang, r.cot, r.cot,
      CASE WHEN r.bang_dich = 'companies' THEN '_test_co' ELSE '_test_user' END) INTO n;
    IF n > 0 THEN
      tong := tong + n;
      ket := ket || format(E'\n  %s.%s -> %s : %s dòng', r.bang, r.cot, r.bang_dich, n);
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.conrelid::regclass::text AS bang, a.attname AS cot,
           c.confrelid::regclass::text AS bang_dich
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid IN ('companies'::regclass, 'users'::regclass)
       AND NOT EXISTS (SELECT 1 FROM pg_attribute ca
                        WHERE ca.attrelid = c.conrelid AND ca.attname = 'company_id' AND ca.attnum > 0)
  LOOP
    EXECUTE format('SELECT count(*) FROM %s t WHERE t.%I IS NOT NULL AND t.%I IN (SELECT id FROM %s)',
      r.bang, r.cot, r.cot,
      CASE WHEN r.bang_dich = 'companies' THEN '_test_co' ELSE '_test_user' END) INTO n;
    IF n > 0 THEN
      tong := tong + n;
      ket := ket || format(E'\n  %s.%s -> %s : %s dòng (bảng không có company_id)', r.bang, r.cot, r.bang_dich, n);
    END IF;
  END LOOP;

  IF tong > 0 THEN
    RAISE EXCEPTION 'DỪNG: cây con tenant test KHÔNG khép kín (% dòng ngoài trỏ vào trong):%', tong, ket;
  END IF;
  RAISE NOTICE 'khép kín OK — 0 dòng ngoài tập tham chiếu vào trong';
END $$;

-- ── PHẦN 2b: BASELINE tham chiếu treo phải = 0 ────────────────────────────────────────────────
-- Bắt buộc phải có TRƯỚC khi quét-mồ-côi ở PHẦN 5: nhờ baseline = 0 mà mọi dòng bị quét-mồ-côi xoá
-- CHẮC CHẮN là do chính purge này tạo ra, không phải rác/hỏng có sẵn bị dọn nhầm.
DO $$
DECLARE r record; n bigint; tong bigint := 0;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS bang, a.attname AS cot,
           c.confrelid::regclass::text AS bang_dich, fa.attname AS cot_dich
      FROM pg_constraint c
      JOIN unnest(c.conkey)  WITH ORDINALITY AS k(attnum, ord)  ON true
      JOIN unnest(c.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
      JOIN pg_attribute a  ON a.attrelid  = c.conrelid  AND a.attnum  = k.attnum
      JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = fk.attnum
     WHERE c.contype = 'f' AND array_length(c.conkey,1) = 1
  LOOP
    EXECUTE format('SELECT count(*) FROM %s t WHERE t.%I IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM %s d WHERE d.%I = t.%I)',
                   r.bang, r.cot, r.bang_dich, r.cot_dich, r.cot) INTO n;
    tong := tong + n;
  END LOOP;
  IF tong <> 0 THEN
    RAISE EXCEPTION 'DỪNG: DB đã có % tham chiếu treo TRƯỚC purge — xử lý riêng, không dọn lẫn ở đây', tong;
  END IF;
  RAISE NOTICE 'baseline tham chiếu treo = 0';
END $$;

-- ── PHẦN 3: xoá mọi dòng thuộc tenant test, theo cột company_id ───────────────────────────────
SET LOCAL session_replication_role = replica;   -- tắt FK-trigger TRONG transaction này (superuser)

DO $$
DECLARE r record; n bigint; tong bigint := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS bang
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'company_id' AND a.attnum > 0
     WHERE c.relkind = 'r' AND ns.nspname = 'public' AND c.relname <> 'companies'
     ORDER BY c.relname
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE company_id IN (SELECT id FROM _test_co)', r.bang);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      tong := tong + n;
      RAISE NOTICE '  % : % dòng', rpad(r.bang, 42), n;
    END IF;
  END LOOP;
  RAISE NOTICE 'tổng dòng đã xoá theo company_id: %', tong;
END $$;

-- Bảng KHÔNG có company_id nhưng trỏ tới user test (đo được = 0 nhưng vẫn quét cho chắc).
DO $$
DECLARE r record; n bigint; tong bigint := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT c.conrelid::regclass::text AS bang, a.attname AS cot
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid IN ('companies'::regclass, 'users'::regclass)
       AND NOT EXISTS (SELECT 1 FROM pg_attribute ca
                        WHERE ca.attrelid = c.conrelid AND ca.attname = 'company_id' AND ca.attnum > 0)
  LOOP
    EXECUTE format(
      'DELETE FROM %s t WHERE t.%I IN (SELECT id FROM _test_user UNION ALL SELECT id FROM _test_co)',
      r.bang, r.cot);
    GET DIAGNOSTICS n = ROW_COUNT;
    tong := tong + n;
  END LOOP;
  RAISE NOTICE 'dòng xoá ở bảng không có company_id: %', tong;
END $$;

-- ── PHẦN 4: xoá chính companies ───────────────────────────────────────────────────────────────
DELETE FROM companies WHERE id IN (SELECT id FROM _test_co);

-- ── PHẦN 4b: QUÉT MỒ CÔI tới điểm bất động ────────────────────────────────────────────────────
-- Vì sao cần: 10 cột FK nằm ở bảng KHÔNG có `company_id` nhưng trỏ tới bảng CÓ `company_id`
-- (`role_permissions.role_id -> roles`, `processed_events.event_id -> outbox_events`, và 8 cột
-- `*_user_id -> users` của các bảng control-plane). Vòng xoá theo `company_id` ở PHẦN 3 KHÔNG với tới
-- chúng ⇒ xoá xong sẽ còn tham chiếu treo. Bản dry-run đầu tiên đã trượt đúng ở đây: 13 dòng
-- `role_permissions` trỏ tới role của tenant test — và PHẦN 6 bắt được, rollback.
--
-- An toàn vì PHẦN 2b đã chốt baseline treo = 0: mọi dòng bị xoá ở đây LÀ mồ côi do chính purge tạo ra.
-- Lặp tới điểm bất động để bắt cả mồ côi bậc hai (A trỏ B, B vừa thành mồ côi).
DO $$
DECLARE r record; n bigint; vong int := 0; xoa_vong bigint; tong bigint := 0;
BEGIN
  LOOP
    vong := vong + 1;
    xoa_vong := 0;
    FOR r IN
      SELECT c.conrelid::regclass::text AS bang, a.attname AS cot,
             c.confrelid::regclass::text AS bang_dich, fa.attname AS cot_dich
        FROM pg_constraint c
        JOIN unnest(c.conkey)  WITH ORDINALITY AS k(attnum, ord)  ON true
        JOIN unnest(c.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
        JOIN pg_attribute a  ON a.attrelid  = c.conrelid  AND a.attnum  = k.attnum
        JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = fk.attnum
       WHERE c.contype = 'f' AND array_length(c.conkey,1) = 1
    LOOP
      EXECUTE format('DELETE FROM %s t WHERE t.%I IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM %s d WHERE d.%I = t.%I)',
                     r.bang, r.cot, r.bang_dich, r.cot_dich, r.cot);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN
        xoa_vong := xoa_vong + n;
        RAISE NOTICE '  [mồ côi v%] %.% -> % : % dòng', vong, r.bang, r.cot, r.bang_dich, n;
      END IF;
    END LOOP;
    tong := tong + xoa_vong;
    EXIT WHEN xoa_vong = 0;
    IF vong >= 10 THEN
      RAISE EXCEPTION 'DỪNG: quét mồ côi không hội tụ sau % vòng', vong;
    END IF;
  END LOOP;
  RAISE NOTICE 'quét mồ côi xong sau % vòng — % dòng', vong, tong;
END $$;

-- ── PHẦN 5: chốt SAU — sai một ly là ROLLBACK ─────────────────────────────────────────────────
DO $$
DECLARE co int; usr int; ft_tong int; ft_active int; ft_locked int;
BEGIN
  SELECT count(*) INTO co FROM companies WHERE slug ~ '-[0-9a-f]{8}$';
  IF co <> 0 THEN RAISE EXCEPTION 'DỪNG: còn % company khớp mẫu tenant test', co; END IF;

  SELECT count(*) INTO usr FROM users u WHERE u.id IN (SELECT id FROM _test_user);
  IF usr <> 0 THEN RAISE EXCEPTION 'DỪNG: còn % user tenant test', usr; END IF;

  SELECT count(*), count(*) FILTER (WHERE u.status = 'active'), count(*) FILTER (WHERE u.status = 'locked')
    INTO ft_tong, ft_active, ft_locked
    FROM users u JOIN companies c ON c.id = u.company_id WHERE c.slug = 'funtime';
  IF ft_tong <> 46 OR ft_active <> 35 OR ft_locked <> 11 THEN
    RAISE EXCEPTION 'DỪNG: funtime bị chạm — % user (% active, % locked), kỳ vọng 46 (35/11)',
      ft_tong, ft_active, ft_locked;
  END IF;
  RAISE NOTICE 'chốt SAU OK — 0 tenant test, funtime nguyên vẹn 46 (35 active / 11 locked)';
END $$;

-- ── PHẦN 6: quét THAM CHIẾU TREO trên MỌI FK (bằng chứng toàn vẹn sau khi tắt FK-trigger) ──────
DO $$
DECLARE r record; n bigint; tong bigint := 0; ket text := '';
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass::text AS bang, a.attname AS cot,
           c.confrelid::regclass::text AS bang_dich, fa.attname AS cot_dich
      FROM pg_constraint c
      JOIN unnest(c.conkey)  WITH ORDINALITY AS k(attnum, ord)  ON true
      JOIN unnest(c.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
      JOIN pg_attribute a  ON a.attrelid  = c.conrelid  AND a.attnum  = k.attnum
      JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = fk.attnum
     WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s t WHERE t.%I IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM %s d WHERE d.%I = t.%I)',
      r.bang, r.cot, r.bang_dich, r.cot_dich, r.cot) INTO n;
    IF n > 0 THEN
      tong := tong + n;
      ket := ket || format(E'\n  %s (%s.%s -> %s.%s): %s dòng treo',
                            r.conname, r.bang, r.cot, r.bang_dich, r.cot_dich, n);
    END IF;
  END LOOP;
  IF tong > 0 THEN
    RAISE EXCEPTION 'DỪNG: purge để lại % THAM CHIẾU TREO:%', tong, ket;
  END IF;
  RAISE NOTICE 'toàn vẹn FK OK — 0 tham chiếu treo trên toàn bộ schema';
END $$;

\echo '=== SAU ==='
SELECT (SELECT count(*) FROM companies)                                      AS company_tong,
       (SELECT count(*) FROM companies WHERE slug ~ '-[0-9a-f]{8}$')         AS company_test,
       (SELECT count(*) FROM users u JOIN companies c ON c.id = u.company_id
         WHERE c.slug = 'funtime')                                           AS funtime_user,
       (SELECT count(*) FROM users u JOIN companies c ON c.id = u.company_id
         WHERE c.slug = 'funtime' AND u.status = 'active')                   AS funtime_active,
       (SELECT count(*) FROM users u JOIN companies c ON c.id = u.company_id
         WHERE c.slug = 'funtime' AND u.status = 'locked')                   AS funtime_locked;

COMMIT;
