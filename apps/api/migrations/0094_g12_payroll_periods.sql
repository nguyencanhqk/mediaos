-- Migration 0094: G12-2 — payroll_periods (kỳ lương, mutable draft→locked) + RLS + FORCE + GRANT.
--
-- BAND 0093-0099 (lane G12-period). Tiền lệ RLS/grant: 0061 (attendance_periods), 0091 (salary_profiles).
-- ADR-0005: kỳ lương là MUTABLE (draft→locked) — KHÁC payslips (append-only). Soft-delete deleted_at.
--   - company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy USING+WITH CHECK (BẤT BIẾN #1).
--   - GRANT cho mediaos_app: SELECT,INSERT,UPDATE (NO DELETE — soft-delete). worker SELECT (read-only).
--   - attendance_period_id: BR — khoá kỳ công/KPI trước khi chạy lương (service đọc attendance_periods.status='locked').
--   - kpi_locked: SLOT cho G8-4 (KPI khoá trước khi vào lương) — KHÔNG implement logic lượt này.
--   - Trigger HẸP payroll_period_lock_guard: chặn ĐÚNG locked→draft (immutability cho kỳ đã khoá),
--     KHÔNG đụng trigger G11 0064 (attendance_periods). Mọi transition hợp lệ khác không bị ảnh hưởng.

CREATE TABLE payroll_periods (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL
                          DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                          REFERENCES companies(id) ON DELETE CASCADE,
  period_month          text NOT NULL,
  status                text NOT NULL DEFAULT 'draft',
  attendance_period_id  uuid REFERENCES attendance_periods(id) ON DELETE SET NULL,
  kpi_locked            boolean NOT NULL DEFAULT false,
  locked_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  locked_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
--> statement-breakpoint
ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_periods FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payroll_periods
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX payroll_periods_company_id_idx ON payroll_periods(company_id);
--> statement-breakpoint
-- 1 kỳ lương / (company, period_month) khi chưa xoá mềm.
CREATE UNIQUE INDEX payroll_periods_company_month_uq
  ON payroll_periods(company_id, period_month) WHERE deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE payroll_periods
  ADD CONSTRAINT payroll_periods_month_check  CHECK (period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT payroll_periods_status_check CHECK (status IN ('draft','locked'));
--> statement-breakpoint
-- mutable: app role có UPDATE (draft→locked) nhưng KHÔNG DELETE (soft-delete). worker chỉ đọc.
GRANT SELECT, INSERT, UPDATE ON payroll_periods TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON payroll_periods TO mediaos_worker;
--> statement-breakpoint

-- ─── Trigger HẸP: immutability cho kỳ lương ĐÃ KHOÁ (chặn ĐÚNG locked→draft) ───
-- Mở rộng BẤT BIẾN §2.2 (immutability cho kỳ đã khoá): sau khi phát hành lương (status='locked'),
-- cấm mở lại ngầm về draft. PHẠM VI HẸP — chỉ chặn locked→draft; INSERT + draft→locked + đổi field khác
-- trên kỳ locked KHÔNG bị ảnh hưởng. KHÔNG thay RLS (lớp phụ, fire sau khi RLS cho UPDATE chạm đúng hàng).
-- Thông điệp chỉ chứa period_month + id (không dữ liệu nhạy cảm). KHÔNG đụng trigger G11 0064.
CREATE OR REPLACE FUNCTION enforce_payroll_period_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'locked' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION
      'payroll_period_lock: kỳ lương % (id=%) đã khoá, cấm mở lại (locked→draft)',
      OLD.period_month, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payroll_period_lock_guard
  BEFORE UPDATE ON payroll_periods
  FOR EACH ROW
  EXECUTE FUNCTION enforce_payroll_period_lock();
