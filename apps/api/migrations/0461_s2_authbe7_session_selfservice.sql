-- Migration 0461: S2-AUTH-BE-7 — Session self-service (GET /auth/sessions + revoke/revoke-others).
--
-- CHECK object_type audit_logs UNION-ADD 'user_session' (clone mẫu 0460/0459/0458/0457/0456/0446/0440).
--   Lý do: AuthService.revokeSession/revokeOtherSessions ghi audit SessionRevoked object_type=
--   'user_session' objectId=session.id (single) hoặc objectId=userId (scope='others', bulk). after CHỈ
--   {scope,count?} — KHÔNG refresh_token_hash/access_token_jti/ip/user_agent thô (BẤT BIẾN #3).
--   AUDIT_OBJECT_TYPES (schema/audit.ts) sync giá trị này CÙNG commit; migration này thêm vào CHECK DB
--   để INSERT audit KHÔNG vỡ ràng buộc audit_logs_object_type_chk (23514) trên Postgres thật.
--
-- KHÔNG có DDL bảng mới: `user_sessions` (RLS+FORCE, dual-write) ĐÃ tồn tại đủ shape (device_name/
--   platform/ip_address/user_agent/last_used_at/created_at/expired_at/access_token_jti) từ mig 0443
--   (S2-AUTH-DB-2) — reconcile done_when xác nhận KHÔNG cần cột mới cho list. BE-1 deferred dual-write
--   hoàn tất Ở TẦNG APP (AuthService.issueTokens, KHÔNG cần schema change) trong cùng lane BE-7.
--
-- HOT-FILE §9.3: DO-block UNION ADD-only (idempotent, KHÔNG rewrite cứng, KHÔNG đụng RLS/grant/policy/
--   FORCE của mig 0443). BẤT BIẾN #2 (audit append-only) GIỮ NGUYÊN: chỉ MỞ RỘNG tập giá trị object_type
--   hợp lệ; KHÔNG cấp UPDATE/DELETE cho app role trên audit_logs. Không DROP TABLE, không backfill.
--
-- BAND 0461 (lane S2-AUTH-BE-7). Journal: idx 141, when 1717500700000 (head thực tế 0460 idx 140 khi
--   soạn — xem apps/api/migrations/meta/_journal.json). NỐI TIẾP ĐƠN ĐIỆU sau head thực tế
--   0460_s2_authbe6_role_write_assign_permission. KHÔNG db:generate cho file này (DO-block thủ công
--   không biểu diễn được bằng Drizzle schema thuần).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['user_session'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0461] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
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
    RAISE NOTICE '[0461] user_session da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0461] da them % vao CHECK object_type cua audit_logs', array_to_string(v_add, ', ');
END;
$$;

-- -------- Down (manual) --------
-- Re-stamp CHECK bỏ 'user_session' (CHỈ khi không còn row audit_logs nào dùng nó).
