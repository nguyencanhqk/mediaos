-- Migration 0095: G12-2 — payslips (SNAPSHOT APPEND-ONLY, ADR-0005, BẤT BIẾN #2) + RLS + FORCE + GRANT.
--
-- BAND 0093-0099 (lane G12-period). Mirror 0070 revenue_records GRANT pattern (append-only ledger).
-- LƯƠNG NHẠY CẢM (BẤT BIẾN #3) + BẤT BIẾN #2 (append-only snapshot):
--   - GRANT cho mediaos_app: SELECT,INSERT ONLY (KHÔNG UPDATE/DELETE). worker SELECT (read-only).
--   - "Sửa/huỷ" = ghi bản ghi MỚI: entry_kind adjustment|void + replaces_payslip_id (chain).
--     KHÔNG cột updated_at/deleted_at (append-only — trạng thái suy ra từ chain).
--   - company_id NOT NULL DEFAULT + RLS ENABLE/FORCE + policy USING+WITH CHECK (BẤT BIẾN #1).
--   - Snapshot fields (base_salary/total_allowances/gross/net/work_days/...) = giá trị BẤT BIẾN tại
--     thời điểm chạy lương (đọc từ salary_profiles + aggregate attendance G11) — không tham chiếu sống.
--   - kpi_amount/bonus_amount/penalty_amount NULLABLE = SLOT cho lane A G8-4 (KPI/thưởng/phạt) — service
--     KHÔNG compute lượt này (để null).

CREATE TABLE payslips (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL
                        DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                        REFERENCES companies(id) ON DELETE CASCADE,
  payroll_period_id   uuid NOT NULL REFERENCES payroll_periods(id),
  user_id             uuid NOT NULL REFERENCES users(id),
  salary_profile_id   uuid REFERENCES salary_profiles(id),
  -- Snapshot tiền lương (BẤT BIẾN tại thời điểm chạy).
  base_salary         numeric(18,2) NOT NULL,
  total_allowances    numeric(18,2) NOT NULL DEFAULT 0,
  gross               numeric(18,2) NOT NULL,
  net                 numeric(18,2) NOT NULL,
  currency            text NOT NULL DEFAULT 'VND',
  -- Aggregate công (đọc từ attendance G11 read-only tại thời điểm chạy).
  work_days           numeric(8,2) NOT NULL DEFAULT 0,
  present_days        numeric(8,2) NOT NULL DEFAULT 0,
  late_minutes        integer NOT NULL DEFAULT 0,
  -- SLOT cho G8-4 KPI/thưởng/phạt (NULLABLE — KHÔNG implement logic lượt này).
  kpi_amount          numeric(18,2),
  bonus_amount        numeric(18,2),
  penalty_amount      numeric(18,2),
  -- Append-only chain (sửa = ghi mới).
  entry_kind          text NOT NULL DEFAULT 'original',
  replaces_payslip_id uuid REFERENCES payslips(id),
  created_by          uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payslips_entry_kind_check CHECK (entry_kind IN ('original','adjustment','void')),
  -- original ⟺ replaces NULL; adjustment/void ⟺ replaces NOT NULL.
  CONSTRAINT payslips_chain_check CHECK (
    (entry_kind = 'original' AND replaces_payslip_id IS NULL)
    OR (entry_kind IN ('adjustment','void') AND replaces_payslip_id IS NOT NULL)
  ),
  CONSTRAINT payslips_amounts_check CHECK (base_salary >= 0 AND total_allowances >= 0 AND gross >= 0)
);
--> statement-breakpoint
ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payslips FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payslips
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX payslips_company_period_user_idx ON payslips(company_id, payroll_period_id, user_id);
--> statement-breakpoint
CREATE INDEX payslips_company_user_idx ON payslips(company_id, user_id);
--> statement-breakpoint
-- Mỗi payslip chỉ bị thay thế ĐÚNG 1 lần (chặn race double-adjust ở DB).
CREATE UNIQUE INDEX payslips_replaces_uq
  ON payslips(replaces_payslip_id) WHERE replaces_payslip_id IS NOT NULL;
--> statement-breakpoint
-- APPEND-ONLY: app role chỉ SELECT + INSERT. KHÔNG UPDATE/DELETE (BẤT BIẾN #2). worker chỉ đọc.
GRANT SELECT, INSERT ON payslips TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON payslips TO mediaos_worker;
