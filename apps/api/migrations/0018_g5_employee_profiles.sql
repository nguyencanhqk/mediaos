-- Migration 0018: G5-5a — tạo employee_profiles + employee_manager_relations + RLS + GRANT.
-- Gate: FULL (salary field nhạy cảm + RLS 2-tenant isolation).
-- Lưu ý: direct_manager_id là shortcut FK; employee_manager_relations dùng cho đa quản lý/scope.
-- Service phải giữ nhất quán: nếu set direct_manager_id → upsert EMR relation_type='direct_manager'.

CREATE TABLE employee_profiles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_code     text,
  org_unit_id       uuid REFERENCES org_units(id) ON DELETE SET NULL,
  position_id       uuid REFERENCES positions(id) ON DELETE SET NULL,
  direct_manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  work_type         text NOT NULL DEFAULT 'offline',
  employment_type   text NOT NULL DEFAULT 'full_time',
  start_date        date,
  end_date          date,
  contract_type     text,
  base_salary       numeric(18, 2),
  salary_type       text NOT NULL DEFAULT 'monthly',
  phone             text,
  avatar_url        text,
  notes             text,
  status            text NOT NULL DEFAULT 'active',
  schema_version    int  NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
--> statement-breakpoint
ALTER TABLE employee_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON employee_profiles
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE UNIQUE INDEX employee_profiles_company_user_active_uq
  ON employee_profiles(company_id, user_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX employee_profiles_company_code_active_uq
  ON employee_profiles(company_id, employee_code) WHERE deleted_at IS NULL AND employee_code IS NOT NULL;
--> statement-breakpoint
CREATE INDEX employee_profiles_company_id_idx ON employee_profiles(company_id);
--> statement-breakpoint
CREATE INDEX employee_profiles_user_id_idx ON employee_profiles(user_id);
--> statement-breakpoint
ALTER TABLE employee_profiles
  ADD CONSTRAINT emp_work_type_check      CHECK (work_type IN ('offline','remote','hybrid')),
  ADD CONSTRAINT emp_employment_type_check CHECK (
    employment_type IN ('full_time','part_time','freelancer','intern','probation')
  ),
  ADD CONSTRAINT emp_salary_type_check    CHECK (salary_type IN ('monthly','hourly','project')),
  ADD CONSTRAINT emp_status_check         CHECK (status IN ('active','inactive','resigned','terminated'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON employee_profiles TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON employee_profiles TO mediaos_worker;
--> statement-breakpoint

CREATE TABLE employee_manager_relations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  employee_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manager_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relation_type     text NOT NULL,
  scope_type        text,
  scope_id          uuid,
  start_date        date,
  end_date          date,
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
--> statement-breakpoint
ALTER TABLE employee_manager_relations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_manager_relations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON employee_manager_relations
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX emr_company_id_idx ON employee_manager_relations(company_id);
--> statement-breakpoint
CREATE INDEX emr_employee_user_id_idx ON employee_manager_relations(employee_user_id);
--> statement-breakpoint
CREATE INDEX emr_manager_user_id_idx ON employee_manager_relations(manager_user_id);
--> statement-breakpoint
ALTER TABLE employee_manager_relations
  ADD CONSTRAINT emr_relation_type_check CHECK (
    relation_type IN ('direct_manager','project_manager','professional_manager','temporary_manager')
  ),
  ADD CONSTRAINT emr_scope_type_check CHECK (
    scope_type IS NULL OR scope_type IN ('company','org_unit','project','team')
  ),
  ADD CONSTRAINT emr_status_check CHECK (status IN ('active','inactive')),
  ADD CONSTRAINT emr_no_self_manage CHECK (employee_user_id <> manager_user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX emr_active_relation_uq
  ON employee_manager_relations (
    company_id, employee_user_id, manager_user_id, relation_type,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000')
  )
  WHERE deleted_at IS NULL AND status = 'active';
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON employee_manager_relations TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON employee_manager_relations TO mediaos_worker;
