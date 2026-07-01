-- Migration 0457: S3-ATT-BE-3 — thêm 'shift', 'attendance_rule', 'shift_assignment' vào
--   CHECK object_type của audit_logs.
--   Lý do: ATT shift/rule/assignment config governance — HR/Admin CRUD shift (AttendanceShiftService
--   .createShift/updateShift), attendance rule (createRule/updateRule) và shift assignment
--   (createShiftAssignment) ghi audit CREATE/CONFIG_UPDATE object_type='shift'/'attendance_rule'/
--   'shift_assignment' audit-in-tx app-tenant (old/new = snapshot cấu hình: name/code/start_time/
--   end_time/rule params/effective range/assignment target… KHÔNG secret/PII vào before/after —
--   BẤT BIẾN #3). Config shift/rule đổi cách tính công toàn công ty = 'hành động quan trọng'
--   (SPEC-01 §16.3 / DoD). AUDIT_OBJECT_TYPES (schema/audit.ts) sync 3 giá trị này CÙNG commit;
--   migration này thêm vào CHECK DB để INSERT audit KHÔNG vỡ ràng buộc
--   audit_logs_object_type_chk (23514) trên Postgres thật (mở đường cho L3 config audit-in-tx).
--
-- HOT-FILE §9.3: DO-block UNION ADD-only (clone 0456 mẫu 0446/0440/0439/0437/0420/0190) — idempotent,
--   KHÔNG rewrite cứng, KHÔNG đụng RLS/grant/policy/FORCE.
--   BẤT BIẾN #2 (audit append-only) GIỮ NGUYÊN: chỉ MỞ RỘNG tập giá trị object_type hợp lệ; KHÔNG cấp
--   UPDATE/DELETE cho app role. Không DROP TABLE, không backfill, KHÔNG seed.
--   Bảng attendance_shifts/attendance_rules/shift_assignments ĐÃ tạo ở 0452 (S3-ATT-DB-1) — KHÔNG tạo lại.
--
-- BAND 0457 (lane S3-ATT-BE-3 / L1-audit-objtype / db-migration). Journal: idx 137, when 1717500680000
--   (> head 0456 idx 136 / 1717500675000). NỐI TIẾP ĐƠN ĐIỆU sau head thực tế 0456_s2_fndbe3_retention_audit_object_type.
--   Drizzle migrator áp theo THỨ TỰ mảng journal (resolve file theo `tag`), KHÔNG theo số tiền tố file →
--   file 0457 áp SAU 0456 là đúng (CHECK object_type đã tồn tại từ migration cũ; đây chỉ mở rộng tập giá trị).
--   KHÔNG db:generate cho file này (DO-block thủ công không biểu diễn được bằng Drizzle schema).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['shift', 'attendance_rule', 'shift_assignment'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0457] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
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
    RAISE NOTICE '[0457] shift/attendance_rule/shift_assignment da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0457] da them % vao CHECK object_type cua audit_logs', array_to_string(v_add, ', ');
END;
$$;

-- -------- Down (manual) --------
-- Re-stamp CHECK bỏ 'shift'/'attendance_rule'/'shift_assignment' (CHỈ khi không còn row audit_logs nào dùng chúng).
