-- Migration 0462: S2-HR-BE-6 (🔴 RED, zone=red) — employee_contracts (hợp đồng lao động, carry-over
--   STORY-031). Tạo bảng employee_contracts + RLS+FORCE + policy tenant_isolation TRƯỚC backfill
--   (BẤT BIẾN #1), UNION-ADD 'employee_contract' vào CHECK object_type audit_logs (audit-in-tx), +
--   seed permission (view,contract)+(manage,contract) data_scope=Company cho hr/company-admin.
--
-- MỤC TIÊU (đối chiếu done_when S2-HR-BE-6):
--   (A) CREATE TABLE employee_contracts khớp DB-03 §7.7: company_id NOT NULL · UUID PK · soft-delete
--       (deleted_at/deleted_by) · audit cols (created_by/updated_by) · employee_id NOT NULL REFERENCES
--       employee_profiles(id) ON DELETE CASCADE (KHÔNG bảng 'employees' — không tồn tại, reconcile sang
--       employee_profiles) · contract_type_id NOT NULL REFERENCES contract_types(id) · file_id nullable
--       REFERENCES files(id) ON DELETE SET NULL. RLS ENABLE+FORCE + policy tenant_isolation TRƯỚC mọi
--       INSERT (BẤT BIẾN #1, template mig 0451/0442). CHECK status + date; index (employee_id,start_date),
--       (company_id,status,end_date) expiring.
--   (B) DO-block UNION-ADD-only đưa 'employee_contract' vào CHECK audit_logs_object_type_chk (clone 0459).
--       Trên DB thật MỌI audit INSERT create/update/link/delete KHÔNG còn vỡ CHECK. BẤT BIẾN #2
--       (append-only) GIỮ NGUYÊN: chỉ MỞ RỘNG tập giá trị object_type hợp lệ; KHÔNG cấp UPDATE/DELETE
--       cho app role. AUDIT_OBJECT_TYPES (schema/audit.ts) sync CÙNG commit.
--   (C) Seed permission catalog cặp (view,contract)+(manage,contract) ON CONFLICT DO NOTHING + grant
--       role_permissions cho hr + company-admin data_scope=Company (SCOPE CHỐT 2026-07-02: view:contract
--       CHỈ Company cho hr/company-admin — employee/manager KHÔNG có Own/Team). is_sensitive=false.
--
-- HOT-FILE §9.3 / BẤT BIẾN:
--   • Bảng MỚI: company_id NOT NULL + RLS ENABLE+FORCE + policy tenant_isolation (template 0451). RLS
--     TRƯỚC backfill — KHÔNG backfill, KHÔNG seed row ở migration này.
--   • CHECK audit object_type: DO-block UNION ADD-only idempotent (clone 0459) — KHÔNG rewrite CHECK cứng.
--   • Catalog: INSERT ON CONFLICT(action,resource_type) DO NOTHING — cặp mới, chạy lại no-op.
--   • role_permissions: UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒ per-pair DELETE
--     wrong-scope + INSERT target (mirror 0459). App role KHÔNG UPDATE role_permissions ⇒ đổi scope qua
--     DELETE+INSERT (BẤT BIẾN #2).
--   • timestamptz UTC-at-rest (ADR-0008) · UUID PK · soft-delete deleted_at (KHÔNG hard-delete).
--   • DO-block + DDL thủ công (RLS/grant/CHECK/seed không biểu diễn được bằng Drizzle schema) — KHÔNG db:generate.
--
-- BAND 0462 (lane S2-HR-BE-6 / db-migration). Journal: idx 142, when 1717500705000 (> head 0461 idx 141 /
--   1717500700000). NỐI TIẾP ĐƠN ĐIỆU forward-only/no-gap sau head thực tế 0461_s2_authbe7_session_selfservice
--   (verify _journal.json — KHÔNG tin tên file/STATUS). Drizzle migrator áp theo THỨ TỰ mảng journal
--   (resolve file theo `tag`). KHÔNG db:generate cho file này.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── A. employee_contracts (bảng chính — RLS+FORCE TRƯỚC mọi INSERT) ───────────────
CREATE TABLE IF NOT EXISTS employee_contracts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                     REFERENCES companies(id) ON DELETE CASCADE,
  -- Reconcile DB-03: FK 'employees.id' → employee_profiles(id) (bảng 'employees' KHÔNG tồn tại).
  employee_id      uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  contract_type_id uuid NOT NULL REFERENCES contract_types(id),
  -- Mã hợp đồng (DB-03 §7.7). NULLABLE: unique trong company khi có giá trị + chưa xoá.
  contract_code    text,
  title            text,
  start_date       date NOT NULL,
  end_date         date,
  signed_date      date,
  status           text NOT NULL DEFAULT 'Draft',
  is_primary       boolean NOT NULL DEFAULT false,
  -- File hợp đồng (DB-03 §7.7 file_id). Link chi tiết qua file_links (FileService entity 'contract');
  -- cột file_id giữ tham chiếu file chính. ON DELETE SET NULL: xoá file KHÔNG xoá hợp đồng.
  file_id          uuid REFERENCES files(id) ON DELETE SET NULL,
  note             text,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at       timestamptz,
  deleted_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_employee_contracts_status
    CHECK (status IN ('Draft','Active','Expired','Terminated','Cancelled')),
  CONSTRAINT chk_employee_contracts_date
    CHECK (end_date IS NULL OR end_date >= start_date)
);
ALTER TABLE employee_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_contracts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee_contracts;
CREATE POLICY tenant_isolation ON employee_contracts
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS employee_contracts_company_id_idx ON employee_contracts(company_id);
-- DB-03 §7.7: contract_code unique trong company khi có giá trị + chưa xoá.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_contracts_company_code_active
  ON employee_contracts(company_id, contract_code)
  WHERE contract_code IS NOT NULL AND deleted_at IS NULL;
-- ≤1 hợp đồng primary+Active/employee (DB-03 §7.7).
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_contracts_primary_active
  ON employee_contracts(employee_id)
  WHERE is_primary = true AND status = 'Active' AND deleted_at IS NULL;
-- index (employee_id, start_date) — list HĐ của nhân viên.
CREATE INDEX IF NOT EXISTS idx_employee_contracts_employee
  ON employee_contracts(employee_id, start_date DESC)
  WHERE deleted_at IS NULL;
-- index (company_id, status, end_date) — cảnh báo hết hạn (expiring soon).
CREATE INDEX IF NOT EXISTS idx_employee_contracts_expiring
  ON employee_contracts(company_id, status, end_date)
  WHERE deleted_at IS NULL AND end_date IS NOT NULL;
-- Bảng chính (HR tạo/sửa/xoá-mềm) → app role INSERT+UPDATE+SELECT. KHÔNG hard-delete (soft-delete).
GRANT SELECT, INSERT, UPDATE ON employee_contracts TO mediaos_app;
GRANT SELECT ON employee_contracts TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── B. CHECK audit_logs.object_type += 'employee_contract' (UNION ADD-only, clone 0459) ───────────────
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['employee_contract'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE NOTICE '[0462] khong tim thay CHECK object_type tren audit_logs — bo qua (idempotent)';
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
    RAISE NOTICE '[0462] employee_contract da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
  RAISE NOTICE '[0462] da them % vao CHECK object_type cua audit_logs', array_to_string(v_add, ', ');
END;
$$;
--> statement-breakpoint

-- ─────────────── C. Seed permission catalog (view,contract)+(manage,contract) ───────────────
-- ON CONFLICT(action,resource_type) DO NOTHING (hot-file UNION). is_sensitive=false (HR CRUD thường).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view',   'contract', false),
  ('manage', 'contract', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── D. Seed role_permissions THEO TỪNG CẶP (role, action, resource_type) = data_scope ───────────────
--   SCOPE CHỐT 2026-07-02: view:contract + manage:contract = hr · company-admin → Company. employee/manager
--   KHÔNG (deny-path → 403). SA = runtime System (KHÔNG ở đây). Per-pair DELETE-wrong-scope + INSERT (mirror 0459).
DO $$
DECLARE
  grants CONSTANT text[][] := ARRAY[
    -- HR.CONTRACT.VIEW
    ['hr',            'view',   'contract', 'Company'],
    ['company-admin', 'view',   'contract', 'Company'],
    -- HR.CONTRACT.MANAGE
    ['hr',            'manage', 'contract', 'Company'],
    ['company-admin', 'manage', 'contract', 'Company']
  ];
  g           text[];
  v_role_id   uuid;
  v_perm_id   uuid;
  v_seeded    int := 0;
  v_rescoped  int := 0;
  v_del       int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY grants LOOP
    -- resolve role (system role canonical: company_id NULL, không xoá mềm)
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0462] role canonical % không tồn tại — seed 0444/0005 phải chạy trước', g[1];
    END IF;

    -- resolve permission (catalog gap (C) phải đã chạy)
    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0462] permission (%:%) không có trong catalog — seed (C) phải chạy trước', g[2], g[3];
    END IF;

    -- DELETE đúng bộ (role_id, permission_id, 'ALLOW') có scope SAI (per-pair, KHÔNG blanket).
    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> g[4];
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    -- INSERT lại scope target. ON CONFLICT(role_id,permission_id,effect) DO NOTHING → idempotent.
    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0462] CONTRACT perms seed: % cặp INSERT mới, % cặp re-scope (DELETE wrong-scope+INSERT)',
    v_seeded, v_rescoped;
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id=r.id AND rp.permission_id=p.id
--     AND r.name IN ('hr','company-admin') AND r.company_id IS NULL
--     AND (p.action,p.resource_type) IN (('view','contract'),('manage','contract'));
-- DELETE FROM permissions WHERE (action,resource_type) IN (('view','contract'),('manage','contract'));
-- DROP TABLE IF EXISTS employee_contracts CASCADE;
-- Re-stamp CHECK object_type bỏ 'employee_contract' (CHỈ khi không còn row audit_logs nào dùng nó).
