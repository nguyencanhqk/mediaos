-- Migration 0091: G12-1 — salary_profiles (hồ sơ lương) + RLS + FORCE + GRANT.
-- CROWN JEWEL. Lương là dữ liệu NHẠY CẢM (ADR-0010, BẤT BIẾN #3):
--   - company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy USING+WITH CHECK
--     ⇒ không đọc/ghi chéo tenant (BẤT BIẾN #1).
--   - Soft-delete deleted_at (KHÔNG hard-delete). GRANT cho mediaos_app CHỈ SELECT/INSERT/UPDATE —
--     KHÔNG DELETE. mediaos_worker CHỈ SELECT (feed payroll G12-2 read-only).
--   - Mọi sửa lương → audit_logs (object_type='salary_profile') ở tầng app trong cùng tx.
-- Tiền lệ RLS/grant: 0018 (employee_profiles), 0061 (attendance_records).

CREATE TABLE salary_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL
                    DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                    REFERENCES companies(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  salary_type     text NOT NULL DEFAULT 'monthly',
  pay_cycle       text NOT NULL DEFAULT 'monthly',
  effective_date  date NOT NULL,
  base_salary     numeric(18,2) NOT NULL,
  allowances      jsonb NOT NULL DEFAULT '[]'::jsonb,
  currency        text NOT NULL DEFAULT 'VND',
  status          text NOT NULL DEFAULT 'active',
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
--> statement-breakpoint
ALTER TABLE salary_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE salary_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON salary_profiles
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX salary_profiles_company_id_idx ON salary_profiles(company_id);
--> statement-breakpoint
CREATE INDEX salary_profiles_user_id_idx ON salary_profiles(company_id, user_id);
--> statement-breakpoint
-- 1 hồ sơ lương ACTIVE / (company, user) khi chưa xoá mềm (G12-1: 1 active profile/user).
CREATE UNIQUE INDEX salary_profiles_company_user_active_uq
  ON salary_profiles(company_id, user_id)
  WHERE deleted_at IS NULL AND status = 'active';
--> statement-breakpoint
ALTER TABLE salary_profiles
  ADD CONSTRAINT salary_profile_type_check       CHECK (salary_type IN ('monthly','hourly','project')),
  ADD CONSTRAINT salary_profile_pay_cycle_check  CHECK (pay_cycle IN ('monthly','biweekly','weekly')),
  ADD CONSTRAINT salary_profile_status_check     CHECK (status IN ('active','inactive')),
  ADD CONSTRAINT salary_profile_base_positive_check CHECK (base_salary > 0);
--> statement-breakpoint
-- GRANT: app role KHÔNG có DELETE (soft-delete only). worker CHỈ SELECT (read-only feed payroll).
GRANT SELECT, INSERT, UPDATE ON salary_profiles TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON salary_profiles TO mediaos_worker;
