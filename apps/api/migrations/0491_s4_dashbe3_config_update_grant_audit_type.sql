-- Migration 0491: S4-DASH-BE-3 (🔴 zone=red, FULL gate — chạm GRANT + audit append-only + RLS) —
--   MỞ QUYỀN UPDATE cho app role trên dashboard_widget_configs + nạp object_type audit cho PATCH config.
--   KHÔNG DDL bảng mới, KHÔNG db:generate (GRANT + DO-block CHECK không biểu diễn được bằng Drizzle schema).
--
-- MỤC TIÊU (done_when, xem harness/backlog.mjs · docs/plans/S4-DASH-BE-3.md):
--   (1) GRANT UPDATE ON dashboard_widget_configs TO mediaos_app — PATCH /dashboard/configs/:id mutate cột
--       config (is_enabled/sort_order/layout/data_scope_override/refresh_seconds_override/config) +
--       updated_by/updated_at + soft-delete deleted_at. App hiện CHỈ có SELECT (0482:171) + INSERT (0484:158)
--       ⇒ THIẾU UPDATE = PATCH vỡ ở tầng DB ("permission denied for table"). Migration NỐI TIẾP này TRƯỚC
--       DashboardConfigController.
--   (2) DO-block UNION-ADD-only đưa 'dashboard_widget_config' vào CHECK audit_logs_object_type_chk (clone
--       superset MỚI NHẤT 0474/0468 — đọc def hiện hành từ pg_constraint rồi union thêm, idempotent, KHÔNG
--       rewrite CHECK cứng, KHÔNG drop giá trị cũ) → audit PATCH config INSERT object_type=
--       'dashboard_widget_config' action_group='CONFIG_UPDATE' permission_code='DASH.CONFIG.UPDATE' KHÔNG vỡ
--       audit_logs_object_type_chk (23514) trên Postgres thật.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #2 KHÔNG cấp DELETE cho mediaos_app (soft-delete/invalidation = UPDATE deleted_at — ngoài phạm vi WO
--      này KHÔNG hard-delete). KHÔNG cấp UPDATE/DELETE cho mediaos_worker (worker chỉ đọc config bật/tắt
--      để regen cache — GRANT SELECT 0482 giữ nguyên).
--   #2 CHECK audit_logs.object_type: UNION ADD-only, KHÔNG rewrite (audit append-only nguyên vẹn). DO-block
--      đọc CHECK hiện tại từ pg_constraint rồi union thêm 'dashboard_widget_config' → mọi giá trị cũ GIỮ
--      NGUYÊN. TUYỆT ĐỐI KHÔNG đụng GRANT/RLS/REVOKE/FORCE audit_logs (INSERT/SELECT-only cho mediaos_app
--      giữ nguyên, KHÔNG UPDATE/DELETE — append-only). WO này CHỈ mở rộng vị từ CHECK object_type.
--   #1 RLS + FORCE + policy literal-GUC (set_config('app.current_company_id',$1,true), PgBouncer
--      transaction-mode) của dashboard_widget_configs ĐÃ bật ở 0482 — TUYỆT ĐỐI KHÔNG đụng. Mở UPDATE
--      KHÔNG rò chéo company: RLS + FORCE vẫn ép company_id tầng DB trên mọi UPDATE.
--   Idempotent: GRANT UPDATE lặp = no-op; nếu 'dashboard_widget_config' đã có trong CHECK → skip (RAISE
--      NOTICE), KHÔNG lỗi.
--   KHÔNG seed permission: cặp view/update:dashboard-config ĐÃ seed + grant company-admin ở 0484
--      (DASH_PERMISSION_PAIRS/DASH_GRANT_MATRIX). WO này KHÔNG đụng permissions/role_permissions.
--
-- BAND 0491 (lane S4-DASH-BE-3 / L0-migration-grant-audit — RENUMBER sau va chạm 0490 với NOTI-SEED-2 #157).
--   Rebase wave lên master e8c5f83 rồi renumber: 0490→0491, journal idx 170→171. Nối tiếp head THẬT
--   0490_s4_notiseed2 idx:170 → 0491 idx:171 when:1717500850000 (> 0490_s4_notiseed2 idx 170 / 1717500845000,
--   bước ĐƠN ĐIỆU 5000ms như 0488/0489/0490). AUDIT_OBJECT_TYPES (schema/audit.ts) sync
--   'dashboard_widget_config' CÙNG commit (quy tắc 0020/0033/0474: TS const + SQL CHECK đổi cùng lúc).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────── (1) GRANT UPDATE app role trên dashboard_widget_configs (KHÔNG DELETE, KHÔNG worker) ───────────
-- 0482:171 app SELECT-only · 0484:158 += INSERT (seeder). PATCH config cần UPDATE (is_enabled/sort_order/
-- layout/data_scope_override/refresh_seconds_override/config + updated_by/updated_at + deleted_at soft-delete).
-- DELETE: KHÔNG BAO GIỜ (BẤT BIẾN #2 — không hard-delete; huỷ config = UPDATE deleted_at). worker: giữ SELECT.
GRANT UPDATE ON dashboard_widget_configs TO mediaos_app;

-- ─────────── (2) CHECK audit_logs.object_type += 'dashboard_widget_config' (UNION ADD-only, clone 0474) ───────────
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['dashboard_widget_config'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0490] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
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
    RAISE NOTICE '[0490] dashboard_widget_config da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0490] da them % vao CHECK object_type cua audit_logs', array_to_string(v_add, ', ');
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- REVOKE UPDATE ON dashboard_widget_configs FROM mediaos_app;  -- (chỉ khi rollback DASH-BE-3)
-- Re-stamp CHECK object_type bỏ 'dashboard_widget_config' (CHỈ khi không còn row audit_logs nào dùng;
-- BẤT BIẾN #2 không khuyến khích thu hẹp CHECK — append-only).
