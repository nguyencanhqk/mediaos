-- Migration 0474: S2-FND-BE-8 (🔴 RED, zone=red, crown — audit) — Module CONFIG audit wiring.
--
-- MỤC TIÊU (done_when, xem harness/backlog.mjs):
--   DO-block UNION-ADD-only đưa 'module' vào CHECK audit_logs_object_type_chk (clone superset MỚI NHẤT
--   0468/0464/0463/0462/0461/0460/0459/0456/0451/0446/0440 — idempotent, KHÔNG rewrite CHECK cứng, KHÔNG
--   cấp UPDATE/DELETE, KHÔNG drop giá trị cũ — BẤT BIẾN #2). ModuleService.toggleModule (lane
--   FND-BE-8 be-module-toggle) ghi audit object_type='module' action_group='CONFIG_UPDATE'
--   permission_code='FOUNDATION.MODULE.UPDATE' audit-in-tx app-tenant khi PATCH /foundation/modules/:code
--   → cần 'module' có trong CHECK TRƯỚC, nếu không INSERT audit vỡ audit_logs_object_type_chk (23514)
--   trên Postgres thật. Lane MIGRATION NỐI TIẾP này chạy TRƯỚC be-module-toggle.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #2 CHECK audit_logs.object_type: UNION ADD-only, KHÔNG rewrite (audit append-only nguyên vẹn). DO-block
--      đọc CHECK hiện tại từ pg_constraint rồi union thêm 'module' → mọi giá trị cũ GIỮ NGUYÊN.
--   • TUYỆT ĐỐI KHÔNG đụng GRANT/RLS/REVOKE/FORCE audit_logs (INSERT/SELECT-only cho mediaos_app giữ nguyên,
--      KHÔNG UPDATE/DELETE — append-only). WO này CHỈ mở rộng vị từ CHECK object_type.
--   • Idempotent: nếu 'module' đã có trong CHECK → skip (RAISE NOTICE), KHÔNG lỗi.
--   • VERIFY-ONLY (KHÔNG thêm lại): 'system_setting' ĐÃ vào CHECK ở 0439 (v_new=['company_setting',
--      'system_setting']); 'retention_policy' ĐÃ vào ở 0456. Lane be-system-settings + be-retention chạy
--      SONG SONG không phụ thuộc 0474 (object_type của chúng đã có sẵn trong CHECK).
--
-- BAND 0474 (lane S2-FND-BE-8 / mig-audit-module). Journal: idx 154, when 1717500765000 (> head 0473 idx
--   153 / 1717500760000). Nối tiếp ĐƠN ĐIỆU sau 0473_s2_fndseed3_single_active_company_guard.
--   AUDIT_OBJECT_TYPES (schema/audit.ts) sync 'module' CÙNG commit. KHÔNG db:generate (DO-block thủ công
--   không biểu diễn được bằng Drizzle schema).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────── CHECK audit_logs.object_type += 'module' (UNION ADD-only, clone 0468) ───────────
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['module'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0474] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
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
    RAISE NOTICE '[0474] module da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0474] da them % vao CHECK object_type cua audit_logs', array_to_string(v_add, ', ');
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- Re-stamp CHECK object_type bỏ 'module' (CHỈ khi không còn row audit_logs nào dùng; BẤT BIẾN #2 không
-- khuyến khích thu hẹp CHECK — append-only).
