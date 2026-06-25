-- Migration 0451: S2-HR-BE-4 (🔴 RED, zone=red) — profile_change_requests + history + employee
--   profile fields. FIX-DB cho vòng skeleton S2-HR-BE-4 (commit 6378920) đã định nghĩa
--   profileChangeRequests trong Drizzle NHƯNG KHÔNG sinh migration ⇒ Đội 3 BLOCK BẤT BIẾN #1.
--
-- MỤC TIÊU (đối chiếu fail-points Đội 3):
--   (A) CREATE TABLE profile_change_requests + RLS ENABLE+FORCE + policy tenant_isolation + GRANT
--       app/worker (template mig 0442 job_levels). BẤT BIẾN #1: cô lập tenant ép Ở TẦNG DB, KHÔNG dựa
--       WHERE company_id trong repository. RLS+FORCE TRƯỚC mọi INSERT. Thêm cột request_code NULLABLE
--       (SPEC-03 §15.10 / DB-03 §7.9 — "Mã yêu cầu nếu cần", không bắt buộc ở DB; additive no-backfill).
--   (B) DO-block UNION-ADD-only đưa 'profile_change_request' vào CHECK audit_logs_object_type_chk
--       (clone mig 0440). Trên DB thật MỌI audit INSERT create/approve/reject/cancel KHÔNG còn vỡ CHECK.
--       BẤT BIẾN #2 (append-only) GIỮ NGUYÊN: chỉ MỞ RỘNG tập object_type hợp lệ; KHÔNG cấp UPDATE/DELETE.
--   (C) CREATE TABLE employee_profile_change_histories — APPEND-ONLY (BẤT BIẾN #2, mirror
--       employee_status_histories mig 0442): app role CHỈ SELECT,INSERT — KHÔNG UPDATE/DELETE.
--       Lưu vết áp dụng từng field khi yêu cầu được Approved (done_when #2 "áp vào employee có history").
--   (D) ALTER employee_profiles ADD 11 cột thiếu NULLABLE additive (SPEC-03 §15.1) để approve áp được
--       trọn bộ field cho phép (done_when #1) — KHÔNG bị FIELD_COLUMN_MAP bỏ âm thầm 10/13 field.
--
-- HOT-FILE §9.3 / BẤT BIẾN:
--   • Bảng MỚI: company_id NOT NULL + RLS ENABLE+FORCE + policy tenant_isolation (template 0442). RLS
--     TRƯỚC backfill — KHÔNG backfill, KHÔNG seed ở migration này.
--   • CHECK audit object_type: DO-block UNION ADD-only idempotent (clone 0440) — KHÔNG rewrite CHECK cứng.
--   • ALTER employee_profiles: ADD COLUMN IF NOT EXISTS nullable — additive, KHÔNG drop cột cũ
--     (phone/avatar_url/notes GIỮ NGUYÊN), KHÔNG backfill.
--   • timestamptz UTC-at-rest (ADR-0008) · UUID PK · soft-delete deleted_at trên bảng chính (KHÔNG hard-delete).
--   • DO-block + DDL thủ công (RLS/grant/CHECK không biểu diễn được bằng Drizzle schema) — KHÔNG db:generate.
--
-- BAND 0451 (lane S2-HR-BE-4-FIX-DB). Journal: idx 130, when 1717500650000 (> head 0450 idx 129 /
--   1717500640000). Nối tiếp ĐƠN ĐIỆU sau 0450_s2_authbe3_user_admin_perms. KHÔNG dùng 0446 (dưới head
--   0450 ⇒ migrator đơn điệu theo `when` SẼ SKIP — bug CLAUDE.md §9.2). schema/employees.ts + audit.ts đã
--   chú thích "mig 0451" → số này khớp.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── A. profile_change_requests (bảng chính — RLS+FORCE TRƯỚC mọi INSERT) ───────────────
CREATE TABLE IF NOT EXISTS profile_change_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                     REFERENCES companies(id) ON DELETE CASCADE,
  -- Mã yêu cầu (SPEC-03 §15.10 / DB-03 §7.9). NULLABLE: additive, no-backfill; "id rút gọn" làm fallback
  -- khi NULL (SPEC-03 §15.4). Unique trong company khi có giá trị + chưa xoá.
  request_code     text,
  employee_id      uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  requested_by     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'Pending',
  -- Snapshot field→value (đã mask identity_number/bank_account ở tầng app — BẤT BIẾN #3).
  old_values       jsonb NOT NULL,
  new_values       jsonb NOT NULL,
  changed_fields   jsonb NOT NULL,
  reason           text,
  rejection_reason text,
  reviewed_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  cancelled_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pcr_status_check
    CHECK (status IN ('Draft','Pending','Approved','Rejected','Cancelled')),
  -- Rejected bắt buộc có lý do (đối chiếu deny-path: thiếu reason khi từ chối → vỡ CHECK).
  CONSTRAINT pcr_rejection_reason_check
    CHECK (status <> 'Rejected' OR rejection_reason IS NOT NULL)
);
ALTER TABLE profile_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_change_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON profile_change_requests;
CREATE POLICY tenant_isolation ON profile_change_requests
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS pcr_company_id_idx ON profile_change_requests(company_id);
CREATE INDEX IF NOT EXISTS pcr_employee_id_idx ON profile_change_requests(employee_id);
CREATE INDEX IF NOT EXISTS pcr_status_idx ON profile_change_requests(company_id, status);
CREATE INDEX IF NOT EXISTS pcr_requested_by_idx ON profile_change_requests(requested_by);
-- request_code unique trong company khi có giá trị (DB-03 §7.9 uq_profile_change_requests_company_code_active;
-- bảng không có deleted_at → chỉ lọc request_code IS NOT NULL).
CREATE UNIQUE INDEX IF NOT EXISTS pcr_company_request_code_uq
  ON profile_change_requests(company_id, request_code) WHERE request_code IS NOT NULL;
-- Bảng chính (employee gửi / HR duyệt / hủy) → app role có INSERT+UPDATE+SELECT (status FSM tiến).
GRANT SELECT, INSERT, UPDATE ON profile_change_requests TO mediaos_app;
GRANT SELECT ON profile_change_requests TO mediaos_worker;

-- ─────────────── B. CHECK audit_logs.object_type += 'profile_change_request' (UNION ADD-only, clone 0440) ───────────────
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['profile_change_request'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0451] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
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
    RAISE NOTICE '[0451] profile_change_request da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0451] da them % vao CHECK object_type cua audit_logs', array_to_string(v_add, ', ');
END;
$$;

-- ─────────────── C. employee_profile_change_histories (APPEND-ONLY — BẤT BIẾN #2, mirror esh 0442) ───────────────
CREATE TABLE IF NOT EXISTS employee_profile_change_histories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  -- Yêu cầu nguồn (NULL nếu HR sửa trực tiếp ngoài luồng self-service).
  request_id   uuid REFERENCES profile_change_requests(id) ON DELETE SET NULL,
  field_name   text NOT NULL,
  -- Giá trị cũ/mới đã áp (mask field nhạy cảm ở tầng app — BẤT BIẾN #3; identity_number KHÔNG ghi plaintext).
  old_value    jsonb,
  new_value    jsonb,
  is_sensitive boolean NOT NULL DEFAULT false,
  changed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE employee_profile_change_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_profile_change_histories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee_profile_change_histories;
CREATE POLICY tenant_isolation ON employee_profile_change_histories
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS epch_company_employee_idx
  ON employee_profile_change_histories(company_id, employee_id);
CREATE INDEX IF NOT EXISTS epch_request_idx
  ON employee_profile_change_histories(request_id);
-- Append-only: KHÔNG GRANT UPDATE/DELETE cho app role (BẤT BIẾN #2 — log áp-dụng không sửa).
GRANT SELECT, INSERT ON employee_profile_change_histories TO mediaos_app;
GRANT SELECT ON employee_profile_change_histories TO mediaos_worker;

-- ─────────────── D. employee_profiles += 11 cột self-service NULLABLE (SPEC-03 §15.1, additive) ───────────────
-- Approve áp được trọn bộ field cho phép (done_when #1). KHÔNG backfill, KHÔNG drop cột cũ.
-- identity_* = field nhạy cảm (SPEC-03 §14.18 "cần duyệt nghiêm ngặt") — gate quyền cao + mask ở tầng app.
DO $$
BEGIN
  ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS date_of_birth date;
  ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS gender text;
  ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS marital_status text;
  ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS personal_email text;
  ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS current_address text;
  ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS permanent_address text;
  ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS emergency_contact_name text;
  ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS emergency_contact_phone text;
  ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS identity_number text;
  ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS identity_issue_date date;
  ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS identity_issue_place text;
END;
$$;
-- CHECK gender (nullable hợp lệ; giá trị theo SPEC-03 §15.1 Male/Female/Other).
ALTER TABLE employee_profiles DROP CONSTRAINT IF EXISTS emp_gender_check;
ALTER TABLE employee_profiles ADD CONSTRAINT emp_gender_check
  CHECK (gender IS NULL OR gender IN ('Male','Female','Other'));

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DROP TABLE IF EXISTS employee_profile_change_histories CASCADE;
-- DROP TABLE IF EXISTS profile_change_requests CASCADE;
-- ALTER TABLE employee_profiles
--   DROP CONSTRAINT IF EXISTS emp_gender_check,
--   DROP COLUMN IF EXISTS date_of_birth, DROP COLUMN IF EXISTS gender,
--   DROP COLUMN IF EXISTS marital_status, DROP COLUMN IF EXISTS personal_email,
--   DROP COLUMN IF EXISTS current_address, DROP COLUMN IF EXISTS permanent_address,
--   DROP COLUMN IF EXISTS emergency_contact_name, DROP COLUMN IF EXISTS emergency_contact_phone,
--   DROP COLUMN IF EXISTS identity_number, DROP COLUMN IF EXISTS identity_issue_date,
--   DROP COLUMN IF EXISTS identity_issue_place;
-- Re-stamp CHECK object_type bỏ 'profile_change_request' (CHỈ khi không còn row audit_logs nào dùng).
