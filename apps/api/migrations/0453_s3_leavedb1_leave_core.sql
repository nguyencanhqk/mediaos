-- Migration 0453: S3-LEAVE-DB-1 (🔴 RED, zone=red, crown) — LEAVE Core (DB-05 §7).
--
-- MỤC TIÊU (plan docs/plans/S3-LEAVE-DB-1.md — Option A evolve-additive, mirror 0452):
--   (A) BUILD 4 bảng MỚI DB-05: leave_policies · leave_balance_transactions · leave_request_days ·
--       leave_request_approvals. Mỗi bảng company-scoped: CREATE TABLE (company_id NOT NULL DEFAULT
--       current_setting + FK companies) → ENABLE + FORCE ROW LEVEL SECURITY → POLICY tenant_isolation
--       (USING+WITH CHECK literal GUC form, mirror 0452) → indexes DB-05 → GRANTs. KHÔNG seed.
--       leave_balance_transactions + leave_request_approvals = LEDGER APPEND-ONLY (BẤT BIẾN #2):
--       GRANT SELECT,INSERT app — KHÔNG UPDATE/DELETE, KHÔNG soft-delete (DB-05 §4.10 ledger đảo chiều).
--   (B) ALTER-ADD (additive, MỌI cột NULLABLE) trên 3 bảng media-era (mig 0062):
--       leave_types + leave_requests + leave_balances — thêm cột DB-05 §7.1/§7.5/§7.3, GIỮ cột cũ
--       (code/paid/status lowercase/user_id/total_days/used_days/remaining_days GENERATED). employee_id
--       (nullable) thêm BÊN CẠNH user_id cũ. KHÔNG re-add used_days/remaining_days; KHÔNG đụng generated
--       remaining_days + CHECK leave_bal_used_check (used<=total).
--   (C) status CHECK: DROP leave_req_status_check (lowercase-only) → ADD lại CÙNG TÊN = UNION
--       (lowercase ∪ TitleCase Draft/Pending/Approved/Rejected/Cancelled/Revoked theo SPEC-05/DB-05 §4.8).
--
-- ⚠️ BẢN ĐỒ TÊN DB-05 → QUAN HỆ THẬT (KHÔNG viết FK theo tên DB-05):
--   employees(id)   → employee_profiles(id)   (schema/employees.ts)  [KHÔNG có bảng `employees`]
--   departments(id) → org_units(id)           (schema/org.ts)        [KHÔNG có bảng `departments`]
--   job_levels · contract_types · positions · public_holidays · shifts · attendance_records · users ·
--   files · leave_types · leave_requests · leave_balances → TỒN TẠI, FK OK.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   • RLS+FORCE TRƯỚC mọi INSERT/backfill. company_id NOT NULL DEFAULT NULLIF(current_setting(...))::uuid.
--   • Ledger append-only (BẤT BIẾN #2): leave_balance_transactions + leave_request_approvals app role
--     CHỈ SELECT,INSERT — KHÔNG UPDATE/DELETE → thử ghi-đè bằng app role PHẢI fail.
--   • ALTER-ADD: MỌI cột NULLABLE (no NOT NULL) → không rewrite/fail trên row cũ. CHECK enum tên MỚI,
--     NULL-permitting. status CHECK = UNION (giữ giá trị legacy) — KHÔNG rewrite mất giá trị cũ.
--   • timestamptz UTC-at-rest (ADR-0008) · UUID PK · soft-delete deleted_at (bảng non-ledger).
--   • DDL thủ công (RLS/grant/CHECK không biểu diễn được bằng Drizzle) — KHÔNG db:generate.
--
-- BAND 0453 (lane S3-LEAVE-DB-1). Journal: idx 133, when 1717500660000 (> head 0452 idx 132 / 1717500655000).
--   Nối tiếp ĐƠN ĐIỆU sau 0452_s3_attdb1_att_core.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── 1. leave_policies (DB-05 §7.2 — chính sách nghỉ theo phạm vi) ───────────────
CREATE TABLE IF NOT EXISTS leave_policies (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid NOT NULL
                                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                                REFERENCES companies(id) ON DELETE CASCADE,
  leave_type_id               uuid NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  policy_code                 text NOT NULL,
  name                        text NOT NULL,
  description                 text,
  policy_scope                text NOT NULL,
  -- department_id → org_units(id); employee_id → employee_profiles(id) (DB-05 ghi departments/employees).
  department_id               uuid REFERENCES org_units(id) ON DELETE SET NULL,
  employee_id                 uuid REFERENCES employee_profiles(id) ON DELETE SET NULL,
  job_level_id                uuid REFERENCES job_levels(id) ON DELETE SET NULL,
  contract_type_id            uuid REFERENCES contract_types(id) ON DELETE SET NULL,
  yearly_quota_days           numeric(8, 2),
  yearly_quota_hours          numeric(8, 2),
  accrual_method              text NOT NULL DEFAULT 'None',
  accrual_day_of_month        integer,
  prorate_on_join_date        boolean NOT NULL DEFAULT false,
  include_weekends            boolean NOT NULL DEFAULT false,
  include_public_holidays     boolean NOT NULL DEFAULT false,
  reserve_balance_on_pending  boolean NOT NULL DEFAULT true,
  allow_negative_balance      boolean NOT NULL DEFAULT false,
  max_negative_days           numeric(8, 2),
  allow_cancel_after_approved boolean NOT NULL DEFAULT true,
  cancel_before_days          integer,
  requires_manager_approval   boolean NOT NULL DEFAULT true,
  requires_hr_approval        boolean NOT NULL DEFAULT false,
  effective_from              date NOT NULL,
  effective_to                date,
  priority                    integer NOT NULL DEFAULT 0,
  status                      text NOT NULL DEFAULT 'Active',
  policy_config               jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at                  timestamptz,
  deleted_by                  uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_leave_policies_scope
    CHECK (policy_scope IN ('Company','Department','Employee','JobLevel','ContractType')),
  CONSTRAINT chk_leave_policies_status CHECK (status IN ('Active','Inactive')),
  CONSTRAINT chk_leave_policies_accrual_method
    CHECK (accrual_method IN ('None','Monthly','Yearly','Manual','Prorated')),
  CONSTRAINT chk_leave_policies_effective_date
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT chk_leave_policies_target CHECK (
    (policy_scope = 'Company' AND department_id IS NULL AND employee_id IS NULL AND job_level_id IS NULL AND contract_type_id IS NULL)
    OR (policy_scope = 'Department' AND department_id IS NOT NULL AND employee_id IS NULL)
    OR (policy_scope = 'Employee' AND employee_id IS NOT NULL)
    OR (policy_scope = 'JobLevel' AND job_level_id IS NOT NULL)
    OR (policy_scope = 'ContractType' AND contract_type_id IS NOT NULL)
  )
);
ALTER TABLE leave_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON leave_policies;
CREATE POLICY tenant_isolation ON leave_policies
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_policies_company_code_active
  ON leave_policies (company_id, policy_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_policies_lookup
  ON leave_policies (company_id, leave_type_id, policy_scope, status, effective_from, effective_to)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_policies_department
  ON leave_policies (company_id, department_id, leave_type_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_policies_employee
  ON leave_policies (company_id, employee_id, leave_type_id, status) WHERE deleted_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON leave_policies TO mediaos_app;
GRANT SELECT ON leave_policies TO mediaos_worker;

-- ─────────────── 2. leave_balance_transactions (DB-05 §7.4 — LEDGER APPEND-ONLY) ───────────────
-- Ledger biến động số dư phép. KHÔNG soft-delete (DB-05 §4.10 — sai thì tạo transaction đảo chiều).
CREATE TABLE IF NOT EXISTS leave_balance_transactions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL
                         DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                         REFERENCES companies(id) ON DELETE CASCADE,
  leave_balance_id     uuid NOT NULL REFERENCES leave_balances(id) ON DELETE CASCADE,
  -- employee_id → employee_profiles(id).
  employee_id          uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  leave_type_id        uuid NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  leave_request_id     uuid REFERENCES leave_requests(id) ON DELETE SET NULL,
  transaction_type     text NOT NULL,
  transaction_date     date NOT NULL,
  amount_days          numeric(8, 2) NOT NULL DEFAULT 0,
  amount_hours         numeric(8, 2) NOT NULL DEFAULT 0,
  balance_before_days  numeric(8, 2),
  balance_after_days   numeric(8, 2),
  balance_before_hours numeric(8, 2),
  balance_after_hours  numeric(8, 2),
  reason               text,
  reference_type       text,
  reference_id         uuid,
  created_by_type      text NOT NULL DEFAULT 'User',
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_leave_balance_transactions_type CHECK (
    transaction_type IN (
      'OPENING','GRANT','ACCRUAL','RESERVE','RELEASE','USE','REFUND',
      'ADJUSTMENT','EXPIRE','CARRY_OVER','IMPORT','SYSTEM_RECALCULATE'
    )
  ),
  CONSTRAINT chk_leave_balance_transactions_created_by_type
    CHECK (created_by_type IN ('User','System','Job'))
);
ALTER TABLE leave_balance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balance_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON leave_balance_transactions;
CREATE POLICY tenant_isolation ON leave_balance_transactions
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS idx_leave_balance_tx_balance_date
  ON leave_balance_transactions (company_id, leave_balance_id, transaction_date, created_at);
CREATE INDEX IF NOT EXISTS idx_leave_balance_tx_employee_date
  ON leave_balance_transactions (company_id, employee_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_leave_balance_tx_request
  ON leave_balance_transactions (company_id, leave_request_id) WHERE leave_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leave_balance_tx_type_date
  ON leave_balance_transactions (company_id, transaction_type, transaction_date);
-- APPEND-ONLY (BẤT BIẾN #2): GRANT SELECT,INSERT — KHÔNG UPDATE/DELETE cho app role.
GRANT SELECT, INSERT ON leave_balance_transactions TO mediaos_app;
GRANT SELECT ON leave_balance_transactions TO mediaos_worker;

-- ─────────────── 3. leave_request_days (DB-05 §7.6 — chi tiết từng ngày nghỉ) ───────────────
CREATE TABLE IF NOT EXISTS leave_request_days (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                      uuid NOT NULL
                                    DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                                    REFERENCES companies(id) ON DELETE CASCADE,
  leave_request_id                uuid NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  -- employee_id → employee_profiles(id); denormalize để query nhanh.
  employee_id                     uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  leave_type_id                   uuid NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  work_date                       date NOT NULL,
  day_type                        text NOT NULL,
  half_day_session                text,
  start_time                      time,
  end_time                        time,
  leave_days                      numeric(8, 2) NOT NULL DEFAULT 0,
  leave_hours                     numeric(8, 2) NOT NULL DEFAULT 0,
  required_working_minutes_before integer,
  leave_minutes                   integer NOT NULL DEFAULT 0,
  required_working_minutes_after  integer,
  is_working_day                  boolean NOT NULL DEFAULT true,
  is_public_holiday               boolean NOT NULL DEFAULT false,
  public_holiday_id               uuid REFERENCES public_holidays(id) ON DELETE SET NULL,
  shift_id                        uuid REFERENCES shifts(id) ON DELETE SET NULL,
  attendance_record_id            uuid REFERENCES attendance_records(id) ON DELETE SET NULL,
  attendance_sync_status          text NOT NULL DEFAULT 'Not Required',
  attendance_synced_at            timestamptz,
  attendance_sync_error           text,
  status                          text NOT NULL DEFAULT 'Active',
  calculation_snapshot            jsonb,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  created_by                      uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  updated_by                      uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at                      timestamptz,
  deleted_by                      uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_leave_request_days_day_type
    CHECK (day_type IN ('Full Day','Half Day','Hourly','Non Working Day','Public Holiday')),
  CONSTRAINT chk_leave_request_days_half_session
    CHECK (half_day_session IS NULL OR half_day_session IN ('Morning','Afternoon')),
  CONSTRAINT chk_leave_request_days_status CHECK (status IN ('Active','Cancelled','Revoked')),
  CONSTRAINT chk_leave_request_days_sync_status
    CHECK (attendance_sync_status IN ('Not Required','Pending','Synced','Failed','Reverted','Pending Revert')),
  CONSTRAINT chk_leave_request_days_amount
    CHECK (leave_days >= 0 AND leave_hours >= 0 AND leave_minutes >= 0),
  CONSTRAINT chk_leave_request_days_hourly_time CHECK (
    day_type <> 'Hourly'
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  )
);
ALTER TABLE leave_request_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_request_days FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON leave_request_days;
CREATE POLICY tenant_isolation ON leave_request_days
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_request_days_request_date_session
  ON leave_request_days (company_id, leave_request_id, work_date, COALESCE(half_day_session, 'NONE'))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_request_days_employee_date
  ON leave_request_days (company_id, employee_id, work_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_request_days_calendar
  ON leave_request_days (company_id, work_date, status, leave_type_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_request_days_sync_status
  ON leave_request_days (company_id, attendance_sync_status, work_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_request_days_attendance_record
  ON leave_request_days (company_id, attendance_record_id) WHERE attendance_record_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON leave_request_days TO mediaos_app;
GRANT SELECT ON leave_request_days TO mediaos_worker;

-- ─────────────── 4. leave_request_approvals (DB-05 §7.7 — HISTORY APPEND-ONLY) ───────────────
-- Lịch sử submit/duyệt/từ chối/hủy/thu hồi. KHÔNG soft-delete (history append-only).
CREATE TABLE IF NOT EXISTS leave_request_approvals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL
                         DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                         REFERENCES companies(id) ON DELETE CASCADE,
  leave_request_id     uuid NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  approval_step        integer NOT NULL DEFAULT 1,
  approver_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  approver_employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL,
  approver_role_code   text,
  action               text NOT NULL,
  from_status          text,
  to_status            text,
  comment              text,
  rejection_reason     text,
  cancel_reason        text,
  acted_at             timestamptz NOT NULL DEFAULT now(),
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_leave_request_approvals_action
    CHECK (action IN ('SUBMIT','APPROVE','REJECT','CANCEL','REVOKE','COMMENT'))
);
ALTER TABLE leave_request_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_request_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON leave_request_approvals;
CREATE POLICY tenant_isolation ON leave_request_approvals
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS idx_leave_approvals_request
  ON leave_request_approvals (company_id, leave_request_id, acted_at);
CREATE INDEX IF NOT EXISTS idx_leave_approvals_approver
  ON leave_request_approvals (company_id, approver_user_id, acted_at) WHERE approver_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leave_approvals_action_date
  ON leave_request_approvals (company_id, action, acted_at);
-- APPEND-ONLY (BẤT BIẾN #2): GRANT SELECT,INSERT — KHÔNG UPDATE/DELETE cho app role.
GRANT SELECT, INSERT ON leave_request_approvals TO mediaos_app;
GRANT SELECT ON leave_request_approvals TO mediaos_worker;

-- ─────────────── 5. ALTER leave_types — ADD cột DB-05 §7.1 (additive, MỌI cột NULLABLE) ───────────────
-- GIỮ cột cũ (code/name/paid/annual_quota/status). balance_unit/allow_*/require_* = cấu hình loại nghỉ MỚI.
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS deduct_balance boolean;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS balance_unit text;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS allow_full_day boolean;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS allow_half_day boolean;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS allow_hourly boolean;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS allow_multiple_days boolean;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS require_reason boolean;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS require_attachment boolean;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS min_notice_days integer;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS max_days_per_request numeric(8, 2);
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS max_hours_per_request numeric(8, 2);
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS allow_negative_balance boolean;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS is_system_default boolean;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;
-- CHECK balance_unit (DB-05 §7.1) — tên MỚI, NULLABLE hợp lệ. KHÔNG đụng leave_types_status_check cũ.
ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS chk_leave_types_balance_unit;
ALTER TABLE leave_types ADD CONSTRAINT chk_leave_types_balance_unit
  CHECK (balance_unit IS NULL OR balance_unit IN ('Day','Hour'));
ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS chk_leave_types_request_limit;
ALTER TABLE leave_types ADD CONSTRAINT chk_leave_types_request_limit
  CHECK (
    (max_days_per_request IS NULL OR max_days_per_request > 0)
    AND (max_hours_per_request IS NULL OR max_hours_per_request > 0)
  );
CREATE INDEX IF NOT EXISTS idx_leave_types_company_sort
  ON leave_types (company_id, sort_order) WHERE deleted_at IS NULL;

-- ─────────────── 6. ALTER leave_requests — ADD cột DB-05 §7.5 (additive, MỌI cột NULLABLE) ───────────────
-- GIỮ cột cũ (user_id NOT NULL / leave_type_id / start/end_date / total_days / status lowercase / task_id /
-- approved_by / review_note). employee_id MỚI (nullable) BÊN CẠNH user_id. leave_policy_id → leave_policies (§1).
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS leave_request_code text;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES org_units(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS position_id uuid REFERENCES positions(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS direct_manager_employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS leave_policy_id uuid REFERENCES leave_policies(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS duration_type text;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS half_day_session text;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS start_time time;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS end_time time;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS total_hours numeric(8, 2);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS handover_note text;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS contact_during_leave text;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS current_approver_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS current_approver_employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS revoke_reason text;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS balance_effect_status text;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS attendance_sync_status text;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS calculation_snapshot jsonb;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approval_snapshot jsonb;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- (C) status CHECK = UNION (DB-05 §4.8). DROP tên cũ (lowercase-only) → ADD lại CÙNG TÊN với UNION
-- (lowercase legacy ∪ TitleCase SPEC-05) — giữ giá trị cũ chèn được + cho phép TitleCase mới. HOT-FILE: union.
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_req_status_check;
ALTER TABLE leave_requests ADD CONSTRAINT leave_req_status_check
  CHECK (status IN (
    'pending','approved','rejected','cancelled','draft','revoked',
    'Draft','Pending','Approved','Rejected','Cancelled','Revoked'
  ));
-- CHECK enum cột MỚI — tên MỚI, NULLABLE hợp lệ (cột chưa backfill).
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS chk_leave_requests_duration_type;
ALTER TABLE leave_requests ADD CONSTRAINT chk_leave_requests_duration_type
  CHECK (duration_type IS NULL OR duration_type IN ('FullDay','HalfDay','Hourly','MultipleDays'));
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS chk_leave_requests_half_day_session;
ALTER TABLE leave_requests ADD CONSTRAINT chk_leave_requests_half_day_session
  CHECK (half_day_session IS NULL OR half_day_session IN ('Morning','Afternoon'));
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS chk_leave_requests_balance_effect_status;
ALTER TABLE leave_requests ADD CONSTRAINT chk_leave_requests_balance_effect_status
  CHECK (balance_effect_status IS NULL OR balance_effect_status IN ('None','Reserved','Used','Released','Refunded'));
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS chk_leave_requests_attendance_sync_status;
ALTER TABLE leave_requests ADD CONSTRAINT chk_leave_requests_attendance_sync_status
  CHECK (attendance_sync_status IS NULL OR attendance_sync_status IN ('Not Required','Pending','Synced','Failed','Reverted','Pending Revert'));
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS chk_leave_requests_total_hours;
ALTER TABLE leave_requests ADD CONSTRAINT chk_leave_requests_total_hours
  CHECK (total_hours IS NULL OR total_hours >= 0);
-- Index DB-05 §7.5 dùng cột MỚI. uq leave_request_code partial (code legacy NULL ⇒ chưa enforce).
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_requests_company_code_active
  ON leave_requests (company_id, leave_request_code)
  WHERE deleted_at IS NULL AND leave_request_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_date
  ON leave_requests (company_id, employee_id, start_date, end_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_requests_pending_approver
  ON leave_requests (company_id, current_approver_user_id, status)
  WHERE deleted_at IS NULL AND status = 'Pending';
CREATE INDEX IF NOT EXISTS idx_leave_requests_department_date
  ON leave_requests (company_id, department_id, start_date, end_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_requests_type_status
  ON leave_requests (company_id, leave_type_id, status) WHERE deleted_at IS NULL;

-- ─────────────── 7. ALTER leave_balances — ADD cột DB-05 §7.3 (additive, MỌI cột NULLABLE) ───────────────
-- GIỮ cột cũ: user_id NOT NULL / leave_type_id / year / total_days / used_days / remaining_days GENERATED
-- ALWAYS AS (total_days - used_days) + CHECK leave_bal_used_check (used<=total). ⛔ KHÔNG re-add
-- used_days/remaining_days; ⛔ KHÔNG DROP/recreate generated column hay CHECK cũ. employee_id MỚI bên cạnh user_id.
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS balance_year integer;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS period_start date;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS period_end date;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS opening_days numeric(8, 2);
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS granted_days numeric(8, 2);
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS pending_days numeric(8, 2);
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS adjusted_days numeric(8, 2);
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS carried_over_days numeric(8, 2);
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS expired_days numeric(8, 2);
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS opening_hours numeric(8, 2);
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS granted_hours numeric(8, 2);
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS used_hours numeric(8, 2);
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS pending_hours numeric(8, 2);
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS adjusted_hours numeric(8, 2);
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS remaining_hours numeric(8, 2);
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS last_accrual_at timestamptz;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS last_calculated_at timestamptz;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;
-- CHECK status (DB-05 §7.3) — tên MỚI, NULLABLE hợp lệ. KHÔNG đụng leave_bal_used_check/total_check/year_check cũ.
ALTER TABLE leave_balances DROP CONSTRAINT IF EXISTS chk_leave_balances_status;
ALTER TABLE leave_balances ADD CONSTRAINT chk_leave_balances_status
  CHECK (status IS NULL OR status IN ('Active','Closed'));
-- Index DB-05 §7.3 dùng cột MỚI (deleted_at vừa thêm ở trên ⇒ partial hợp lệ).
CREATE INDEX IF NOT EXISTS idx_leave_balances_employee_year
  ON leave_balances (company_id, employee_id, balance_year) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leave_balances_type_year_new
  ON leave_balances (company_id, leave_type_id, balance_year) WHERE deleted_at IS NULL;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DROP TABLE IF EXISTS leave_request_approvals CASCADE;
-- DROP TABLE IF EXISTS leave_request_days CASCADE;
-- DROP TABLE IF EXISTS leave_balance_transactions CASCADE;
-- DROP TABLE IF EXISTS leave_policies CASCADE;
-- ALTER TABLE leave_types DROP COLUMN IF EXISTS balance_unit, ... (mọi cột add ở §5);
-- ALTER TABLE leave_requests DROP COLUMN IF EXISTS employee_id, ... (mọi cột add ở §6) + restore status CHECK lowercase;
-- ALTER TABLE leave_balances DROP COLUMN IF EXISTS employee_id, ... (mọi cột add ở §7);
