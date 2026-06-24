-- Migration 0442: S2-HR-DB-1 (🔴 RED) — reconcile HR-Core vs DB-03 (ADDITIVE, owner-chốt 2026-06-24).
--   Giữ model media-era (employee_profiles/org_units/positions). Nới xung đột spec + thêm bảng thiếu.
--   Nguồn: DB-03 · IMPLEMENTATION-05 §12.2/§12.4 · ISSUE-BOARD-01 §18.5 (HR-DB-001/002/003).
--
-- BẤT BIẾN:
--   • #1 (tenant isolation): mọi bảng MỚI có company_id NOT NULL + RLS ENABLE+FORCE + policy tenant_isolation
--     (template mig 0017 positions). RLS+FORCE TRƯỚC bất kỳ backfill/seed.
--   • #2 (append-only): employee_status_histories = log vòng đời → app role CHỈ SELECT,INSERT (KHÔNG UPDATE/DELETE).
--   • Additive: nới user_id nullable (widening an toàn) + thêm bảng/cột/index. KHÔNG drop cột cũ (contract_type/base_salary).
--
-- BAND 0442 (lane S2-HR-DB-1). Journal idx 125, when 1717500600000 (> 0441 idx 124 / 1717500590000).
--   Nối ĐƠN ĐIỆU sau 0441_s2_authdb1_role_perm_data_scope. KHÔNG db:generate (DDL thủ công).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── A. Nới employee_profiles.user_id → nullable (SPEC DB-03 §7.2) ───────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'employee_profiles' AND column_name = 'user_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE employee_profiles ALTER COLUMN user_id DROP NOT NULL;
    RAISE NOTICE '[0442] employee_profiles.user_id → NULLABLE (employee tồn tại trước khi gán account)';
  ELSE
    RAISE NOTICE '[0442] employee_profiles.user_id đã nullable — idempotent skip';
  END IF;
END;
$$;

-- ─────────────── B1. job_levels (master data) ───────────────
CREATE TABLE IF NOT EXISTS job_levels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies(id) ON DELETE CASCADE,
  code        text,
  name        text NOT NULL,
  rank_order  integer,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT job_levels_status_check CHECK (status IN ('active','inactive'))
);
ALTER TABLE job_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_levels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON job_levels;
CREATE POLICY tenant_isolation ON job_levels
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS job_levels_company_id_idx ON job_levels(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS job_levels_company_name_active_uq
  ON job_levels(company_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS job_levels_company_code_active_uq
  ON job_levels(company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON job_levels TO mediaos_app;
GRANT SELECT ON job_levels TO mediaos_worker;

-- ─────────────── B2. contract_types (master data) ───────────────
CREATE TABLE IF NOT EXISTS contract_types (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  code              text,
  name              text NOT NULL,
  requires_end_date boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT contract_types_status_check CHECK (status IN ('active','inactive'))
);
ALTER TABLE contract_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON contract_types;
CREATE POLICY tenant_isolation ON contract_types
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS contract_types_company_id_idx ON contract_types(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS contract_types_company_name_active_uq
  ON contract_types(company_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contract_types_company_code_active_uq
  ON contract_types(company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON contract_types TO mediaos_app;
GRANT SELECT ON contract_types TO mediaos_worker;

-- ─────────────── B3. employee_status_histories (lifecycle log — APPEND-ONLY BẤT BIẾN #2) ───────────────
CREATE TABLE IF NOT EXISTS employee_status_histories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  old_status  text,
  new_status  text NOT NULL,
  reason      text,
  changed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE employee_status_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_status_histories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee_status_histories;
CREATE POLICY tenant_isolation ON employee_status_histories
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS esh_company_employee_idx ON employee_status_histories(company_id, employee_id);
-- Append-only: KHÔNG GRANT UPDATE/DELETE cho app role (BẤT BIẾN #2 — log không sửa).
GRANT SELECT, INSERT ON employee_status_histories TO mediaos_app;
GRANT SELECT ON employee_status_histories TO mediaos_worker;

-- ─────────────── B4. employee_code_configs (config sinh mã — numbering qua sequence_counters) ───────────────
CREATE TABLE IF NOT EXISTS employee_code_configs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL
                          DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                          REFERENCES companies(id) ON DELETE CASCADE,
  prefix                text,
  pattern               text,
  number_length         integer NOT NULL DEFAULT 4,
  allow_manual_override boolean NOT NULL DEFAULT true,
  status                text NOT NULL DEFAULT 'active',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CONSTRAINT employee_code_configs_status_check CHECK (status IN ('active','inactive'))
);
ALTER TABLE employee_code_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_code_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee_code_configs;
CREATE POLICY tenant_isolation ON employee_code_configs
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
-- 1 config active / company (đổi cấu hình = update hàng hiện có hoặc soft-delete + insert).
CREATE UNIQUE INDEX IF NOT EXISTS employee_code_configs_company_active_uq
  ON employee_code_configs(company_id) WHERE deleted_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON employee_code_configs TO mediaos_app;
GRANT SELECT ON employee_code_configs TO mediaos_worker;

-- ─────────────── C. FK nullable trên employee_profiles → job_levels / contract_types ───────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'employee_profiles' AND column_name = 'job_level_id'
  ) THEN
    ALTER TABLE employee_profiles
      ADD COLUMN job_level_id uuid REFERENCES job_levels(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'employee_profiles' AND column_name = 'contract_type_id'
  ) THEN
    ALTER TABLE employee_profiles
      ADD COLUMN contract_type_id uuid REFERENCES contract_types(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- ─────────────── D. Index DB-03 §12.4 còn thiếu trên employee_profiles ───────────────
CREATE INDEX IF NOT EXISTS employee_profiles_company_status_idx
  ON employee_profiles(company_id, status);
CREATE INDEX IF NOT EXISTS employee_profiles_company_org_unit_idx
  ON employee_profiles(company_id, org_unit_id);
CREATE INDEX IF NOT EXISTS employee_profiles_company_manager_idx
  ON employee_profiles(company_id, direct_manager_id);
CREATE INDEX IF NOT EXISTS employee_profiles_company_start_date_idx
  ON employee_profiles(company_id, start_date);

-- -------- Down (manual) --------
-- DROP TABLE IF EXISTS employee_code_configs, employee_status_histories, contract_types, job_levels CASCADE;
-- ALTER TABLE employee_profiles DROP COLUMN IF EXISTS job_level_id, DROP COLUMN IF EXISTS contract_type_id;
-- (user_id NOT NULL không tự khôi phục — cần backfill trước.)
