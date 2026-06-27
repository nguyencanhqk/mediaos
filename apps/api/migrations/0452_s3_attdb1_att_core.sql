-- Migration 0452: S3-ATT-DB-1 (🔴 RED, zone=red, crown) — ATT Core (DB-04 §7).
--
-- MỤC TIÊU (plan docs/plans/S3-ATT-DB-1.md Rev2 — PASSED; owner chốt Option A evolve-additive):
--   (A) BUILD 7 bảng MỚI DB-04: shifts · shift_assignments · attendance_rules · attendance_logs ·
--       attendance_adjustment_items · remote_work_requests · remote_work_request_approvals.
--       Mỗi bảng company-scoped: CREATE TABLE (company_id NOT NULL DEFAULT current_setting + FK companies)
--       → ENABLE + FORCE ROW LEVEL SECURITY → POLICY tenant_isolation (USING+WITH CHECK literal GUC form,
--       mirror 0451 dòng 67-69) → indexes → GRANTs. KHÔNG seed (seed = S3-ATT-SEED-1).
--   (B) ALTER-ADD (additive, MỌI cột NULLABLE) trên 2 bảng media-era reconcile:
--       attendance_records + attendance_adjustment_requests — thêm cột DB-04 §7.4/§7.6, GIỮ cột cũ
--       (user_id / status lowercase / work_schedule_id / task_id). Cột attendance_status TitleCase MỚI
--       ≠ status lowercase cũ; CHECK tên MỚI (chk_attendance_records_attendance_status).
--   (C) BACKFILL attendance_records.employee_id từ employee_profiles theo user_id (migrator=owner, bypass RLS).
--
-- ⚠️ BẢN ĐỒ TÊN DB-04 → QUAN HỆ THẬT (plan §1 — KHÔNG viết FK theo tên DB-04):
--   employees(id)   → employee_profiles(id)   (schema/employees.ts)  [KHÔNG có bảng `employees`]
--   departments(id) → org_units(id)           (schema/org.ts)        [KHÔNG có bảng `departments`]
--   positions(id) · users(id) · files(id) · tasks(id) → tồn tại, FK OK.
--   first_log_id / last_log_id / leave_request_id → UUID TRẦN (cycle records↔logs / optional, DB-04 DDL).
--   remote_work_request_id → remote_work_requests(id).
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   • RLS+FORCE TRƯỚC mọi INSERT/backfill. company_id NOT NULL DEFAULT NULLIF(current_setting(...))::uuid.
--   • attendance_logs APPEND-ONLY (BẤT BIẾN #2): GRANT SELECT,INSERT app — KHÔNG UPDATE/DELETE. CLAUDE.md §2
--     THẮNG DB-04 §7.5 (deleted_at/by giữ để parity nhưng app role KHÔNG sửa được). attendance_adjustment_items
--     + remote_work_request_approvals = ledger/append → cùng chính sách append-only (SELECT,INSERT).
--   • ALTER-ADD: MỌI cột NULLABLE (no NOT NULL) → không rewrite/fail trên row cũ. CHECK enum tên MỚI.
--   • timestamptz UTC-at-rest (ADR-0008) · UUID PK · soft-delete deleted_at (KHÔNG hard-delete).
--   • DDL thủ công (RLS/grant/CHECK không biểu diễn được bằng Drizzle) — KHÔNG db:generate.
--
-- BAND 0452 (lane S3-ATT-DB-1). Journal: idx 132, when 1717500655000 (> head 0451 idx 131 / 1717500650000).
--   Nối tiếp ĐƠN ĐIỆU sau 0451_s2_hrbe4_profile_change_requests.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── 1. shifts (DB-04 §7.1 — danh mục ca làm việc) ───────────────
CREATE TABLE IF NOT EXISTS shifts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL
                              DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                              REFERENCES companies(id) ON DELETE CASCADE,
  shift_code                text NOT NULL,
  name                      text NOT NULL,
  description               text,
  shift_type                text NOT NULL DEFAULT 'Fixed',
  start_time                time,
  end_time                  time,
  break_start_time          time,
  break_end_time            time,
  break_minutes             integer NOT NULL DEFAULT 0,
  required_working_minutes  integer NOT NULL,
  flexible_check_in_from     time,
  flexible_check_in_to       time,
  grace_late_minutes        integer NOT NULL DEFAULT 0,
  grace_early_leave_minutes integer NOT NULL DEFAULT 0,
  allow_early_check_in      boolean NOT NULL DEFAULT true,
  allow_late_check_out      boolean NOT NULL DEFAULT true,
  cross_day                 boolean NOT NULL DEFAULT false,
  work_days                 jsonb,
  status                    text NOT NULL DEFAULT 'Active',
  is_default                boolean NOT NULL DEFAULT false,
  metadata                  jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at                timestamptz,
  deleted_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_shifts_type   CHECK (shift_type IN ('Fixed','Flexible','Split','Night')),
  CONSTRAINT chk_shifts_status CHECK (status IN ('Active','Inactive')),
  CONSTRAINT chk_shifts_minutes CHECK (required_working_minutes > 0 AND break_minutes >= 0)
);
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shifts;
CREATE POLICY tenant_isolation ON shifts
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_company_code_active
  ON shifts (company_id, shift_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shifts_company_status
  ON shifts (company_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shifts_company_default
  ON shifts (company_id, is_default) WHERE deleted_at IS NULL AND status = 'Active';
GRANT SELECT, INSERT, UPDATE ON shifts TO mediaos_app;
GRANT SELECT ON shifts TO mediaos_worker;

-- ─────────────── 2. shift_assignments (DB-04 §7.2 — gán ca Company/Department/Employee) ───────────────
CREATE TABLE IF NOT EXISTS shift_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                     REFERENCES companies(id) ON DELETE CASCADE,
  shift_id         uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  assignment_scope text NOT NULL,
  -- department_id → org_units(id) (DB-04 ghi `departments`, KHÔNG tồn tại).
  department_id    uuid REFERENCES org_units(id) ON DELETE SET NULL,
  -- employee_id → employee_profiles(id) (DB-04 ghi `employees`, KHÔNG tồn tại).
  employee_id      uuid REFERENCES employee_profiles(id) ON DELETE SET NULL,
  effective_from   date NOT NULL,
  effective_to     date,
  priority         integer NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'Active',
  note             text,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at       timestamptz,
  deleted_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_shift_assignments_scope  CHECK (assignment_scope IN ('Company','Department','Employee')),
  CONSTRAINT chk_shift_assignments_status CHECK (status IN ('Active','Inactive')),
  CONSTRAINT chk_shift_assignments_date   CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT chk_shift_assignments_target CHECK (
    (assignment_scope = 'Company' AND department_id IS NULL AND employee_id IS NULL)
    OR (assignment_scope = 'Department' AND department_id IS NOT NULL AND employee_id IS NULL)
    OR (assignment_scope = 'Employee' AND employee_id IS NOT NULL)
  )
);
ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shift_assignments;
CREATE POLICY tenant_isolation ON shift_assignments
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_company_scope
  ON shift_assignments (company_id, assignment_scope, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shift_assignments_department_date
  ON shift_assignments (company_id, department_id, effective_from, effective_to) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shift_assignments_employee_date
  ON shift_assignments (company_id, employee_id, effective_from, effective_to) WHERE deleted_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON shift_assignments TO mediaos_app;
GRANT SELECT ON shift_assignments TO mediaos_worker;

-- ─────────────── 3. attendance_rules (DB-04 §7.3 — rule chấm công theo phạm vi) ───────────────
CREATE TABLE IF NOT EXISTS attendance_rules (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                      uuid NOT NULL
                                    DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                                    REFERENCES companies(id) ON DELETE CASCADE,
  rule_code                       text NOT NULL,
  name                            text NOT NULL,
  description                     text,
  rule_scope                      text NOT NULL,
  -- department_id → org_units(id); employee_id → employee_profiles(id).
  department_id                   uuid REFERENCES org_units(id) ON DELETE SET NULL,
  employee_id                     uuid REFERENCES employee_profiles(id) ON DELETE SET NULL,
  priority                        integer NOT NULL DEFAULT 0,
  effective_from                  date NOT NULL,
  effective_to                    date,
  require_check_in                boolean NOT NULL DEFAULT true,
  require_check_out               boolean NOT NULL DEFAULT true,
  allow_web_check_in              boolean NOT NULL DEFAULT true,
  allow_mobile_check_in           boolean NOT NULL DEFAULT true,
  allow_remote_check_in           boolean NOT NULL DEFAULT false,
  allow_adjustment_request        boolean NOT NULL DEFAULT true,
  require_gps                     boolean NOT NULL DEFAULT false,
  require_note                    boolean NOT NULL DEFAULT false,
  require_photo                   boolean NOT NULL DEFAULT false,
  allow_holiday_attendance        boolean NOT NULL DEFAULT false,
  allow_weekend_attendance        boolean NOT NULL DEFAULT false,
  auto_attendance_enabled         boolean NOT NULL DEFAULT false,
  auto_check_out_enabled          boolean NOT NULL DEFAULT false,
  auto_attendance_working_minutes integer,
  rule_config                     jsonb,
  status                          text NOT NULL DEFAULT 'Active',
  metadata                        jsonb,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  created_by                      uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  updated_by                      uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at                      timestamptz,
  deleted_by                      uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_attendance_rules_scope  CHECK (rule_scope IN ('System','Company','Department','Employee')),
  CONSTRAINT chk_attendance_rules_status CHECK (status IN ('Active','Inactive')),
  CONSTRAINT chk_attendance_rules_date   CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT chk_attendance_rules_target CHECK (
    (rule_scope IN ('System','Company') AND department_id IS NULL AND employee_id IS NULL)
    OR (rule_scope = 'Department' AND department_id IS NOT NULL AND employee_id IS NULL)
    OR (rule_scope = 'Employee' AND employee_id IS NOT NULL)
  )
);
ALTER TABLE attendance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance_rules;
CREATE POLICY tenant_isolation ON attendance_rules
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_rules_company_code_active
  ON attendance_rules (company_id, rule_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_rules_company_scope
  ON attendance_rules (company_id, rule_scope, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_rules_department_date
  ON attendance_rules (company_id, department_id, effective_from, effective_to) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_rules_employee_date
  ON attendance_rules (company_id, employee_id, effective_from, effective_to) WHERE deleted_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON attendance_rules TO mediaos_app;
GRANT SELECT ON attendance_rules TO mediaos_worker;

-- ─────────────── 4. remote_work_requests (DB-04 §7.8 — TẠO TRƯỚC ALTER attendance_records FK) ───────────────
CREATE TABLE IF NOT EXISTS remote_work_requests (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                   uuid NOT NULL
                                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                                 REFERENCES companies(id) ON DELETE CASCADE,
  request_code                 text,
  -- employee_id → employee_profiles(id).
  employee_id                  uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  request_type                 text NOT NULL,
  start_date                   date NOT NULL,
  end_date                     date NOT NULL,
  start_time                   time,
  end_time                     time,
  attendance_mode              text NOT NULL DEFAULT 'SELF_CHECK_IN',
  location_text                text,
  reason                       text NOT NULL,
  -- task_id/project_id = UUID TRẦN (FK logic phase sau, DB-04 §15.4).
  task_id                      uuid,
  project_id                   uuid,
  status                       text NOT NULL DEFAULT 'Pending',
  submitted_at                 timestamptz,
  requested_by                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_approver_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  current_approver_employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL,
  approved_by                  uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at                  timestamptz,
  rejected_by                  uuid REFERENCES users(id) ON DELETE SET NULL,
  rejected_at                  timestamptz,
  reject_reason                text,
  cancelled_at                 timestamptz,
  cancelled_by                 uuid REFERENCES users(id) ON DELETE SET NULL,
  attachment_file_id           uuid REFERENCES files(id) ON DELETE SET NULL,
  metadata                     jsonb,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  created_by                   uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  updated_by                   uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at                   timestamptz,
  deleted_by                   uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_remote_requests_type   CHECK (request_type IN ('Remote','BusinessTrip','Offsite')),
  CONSTRAINT chk_remote_requests_mode   CHECK (attendance_mode IN ('SELF_CHECK_IN','AUTO_ATTENDANCE','NO_ATTENDANCE')),
  CONSTRAINT chk_remote_requests_status CHECK (status IN ('Draft','Pending','Approved','Rejected','Cancelled')),
  CONSTRAINT chk_remote_requests_date   CHECK (end_date >= start_date)
);
ALTER TABLE remote_work_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_work_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON remote_work_requests;
CREATE POLICY tenant_isolation ON remote_work_requests
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_remote_requests_company_code_active
  ON remote_work_requests (company_id, request_code) WHERE deleted_at IS NULL AND request_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_remote_requests_employee_date
  ON remote_work_requests (company_id, employee_id, start_date, end_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_remote_requests_status_submitted
  ON remote_work_requests (company_id, status, submitted_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_remote_requests_approver
  ON remote_work_requests (company_id, current_approver_user_id, status) WHERE deleted_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON remote_work_requests TO mediaos_app;
GRANT SELECT ON remote_work_requests TO mediaos_worker;

-- ─────────────── 5. ALTER attendance_records — ADD cột DB-04 §7.4 (additive, MỌI cột NULLABLE) ───────────────
-- GIỮ cột cũ (user_id NOT NULL / status lowercase / work_schedule_id / *_method / location_json) → module
-- attendance/** + payroll KHÔNG vỡ. Cột attendance_status TitleCase MỚI ≠ status lowercase cũ.
-- FK: employee_id→employee_profiles · department_id→org_units · position_id→positions · shift_id→shifts ·
-- applied_rule_id→attendance_rules · remote_work_request_id→remote_work_requests. first/last_log_id +
-- leave_request_id = UUID TRẦN (KHÔNG FK — cycle records↔logs / optional). ADD COLUMN IF NOT EXISTS (idempotent).
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES org_units(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS position_id uuid REFERENCES positions(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS applied_rule_id uuid REFERENCES attendance_rules(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS first_log_id uuid;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS last_log_id uuid;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS required_working_minutes integer;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS working_minutes integer;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS break_minutes integer;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS missing_minutes integer;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS overtime_minutes integer;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS attendance_status text;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS check_in_status text;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS check_out_status text;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS attendance_source text;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS work_mode text;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS is_late boolean;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS is_early_leave boolean;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS is_missing_check_in boolean;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS is_missing_check_out boolean;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS is_adjusted boolean;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS is_auto boolean;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS leave_request_id uuid;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS remote_work_request_id uuid REFERENCES remote_work_requests(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS calculation_snapshot jsonb;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- CHECK attendance_status TitleCase (DB-04 §7.4) — tên MỚI, KHÔNG đụng attendance_status_check (status lowercase cũ).
-- NULLABLE hợp lệ (cột mới chưa backfill). DROP-then-ADD idempotent.
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS chk_attendance_records_attendance_status;
ALTER TABLE attendance_records ADD CONSTRAINT chk_attendance_records_attendance_status
  CHECK (attendance_status IS NULL OR attendance_status IN (
    'Not Checked-in','Checked-in','Checked-out','Present','Late','Early Leave','Missing Hours',
    'Missing Check-in','Missing Check-out','Absent','Leave','Remote Work','Auto Attendance',
    'Adjusted','Pending Adjustment','Invalid'
  ));
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS chk_attendance_records_attendance_source;
ALTER TABLE attendance_records ADD CONSTRAINT chk_attendance_records_attendance_source
  CHECK (attendance_source IS NULL OR attendance_source IN ('WEB','MOBILE','MANUAL','AUTO','REMOTE','DEVICE','IMPORT','API'));
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS chk_attendance_records_work_mode;
ALTER TABLE attendance_records ADD CONSTRAINT chk_attendance_records_work_mode
  CHECK (work_mode IS NULL OR work_mode IN ('Office','Remote','BusinessTrip','Auto','Leave'));
-- Minutes mới ≥ 0 (NULL hợp lệ). KHÔNG đụng attendance_minutes_check cũ (late/early lowercase).
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS chk_attendance_records_new_minutes;
ALTER TABLE attendance_records ADD CONSTRAINT chk_attendance_records_new_minutes
  CHECK (
    (required_working_minutes IS NULL OR required_working_minutes >= 0)
    AND (working_minutes IS NULL OR working_minutes >= 0)
    AND (break_minutes IS NULL OR break_minutes >= 0)
    AND (missing_minutes IS NULL OR missing_minutes >= 0)
    AND (overtime_minutes IS NULL OR overtime_minutes >= 0)
  );

-- UNIQUE chống trùng DB-04 §7.4 (forward-looking — employee_id phần lớn NULL sau backfill ⇒ CHƯA enforce do
-- NULL distinct trong unique index Postgres). Guard chống-trùng LIVE vẫn là attendance_records_company_user_date_uq
-- (user_id) cũ tới khi S3-ATT-BE chuyển writer sang employee_id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_records_employee_date_shift
  ON attendance_records (company_id, employee_id, work_date, shift_id)
  WHERE deleted_at IS NULL AND employee_id IS NOT NULL AND shift_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_records_employee_date_no_shift
  ON attendance_records (company_id, employee_id, work_date)
  WHERE deleted_at IS NULL AND employee_id IS NOT NULL AND shift_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_records_employee_date
  ON attendance_records (company_id, employee_id, work_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_records_company_date_status
  ON attendance_records (company_id, work_date, attendance_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_records_department_date
  ON attendance_records (company_id, department_id, work_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_records_remote_request
  ON attendance_records (remote_work_request_id) WHERE remote_work_request_id IS NOT NULL;

-- BACKFILL employee_id từ employee_profiles theo user_id (migrator=owner role → bypass RLS).
-- join 1:1 do employee_profiles_company_user_active_uq. employee_id còn NULL nếu user chưa link employee
-- = chấp nhận (tighten ở S3-ATT-BE decommission). Idempotent (chỉ set khi đang NULL).
UPDATE attendance_records ar
   SET employee_id = ep.id
  FROM employee_profiles ep
 WHERE ep.user_id = ar.user_id
   AND ep.company_id = ar.company_id
   AND ep.deleted_at IS NULL
   AND ar.employee_id IS NULL;

-- ─────────────── 6. attendance_logs (DB-04 §7.5 — APPEND-ONLY, log thô check-in/out) ───────────────
-- attendance_record_id REFERENCES attendance_records (records FK-less tới logs nên KHÔNG cycle).
CREATE TABLE IF NOT EXISTS attendance_logs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL
                         DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                         REFERENCES companies(id) ON DELETE CASCADE,
  attendance_record_id uuid REFERENCES attendance_records(id) ON DELETE SET NULL,
  -- employee_id → employee_profiles(id).
  employee_id          uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  user_id              uuid REFERENCES users(id) ON DELETE SET NULL,
  work_date            date NOT NULL,
  log_type             text NOT NULL,
  log_time             timestamptz NOT NULL DEFAULT now(),
  client_time          timestamptz,
  client_timezone      text,
  source               text NOT NULL,
  platform             text,
  device_id            text,
  device_name          text,
  ip_address           text,
  user_agent           text,
  gps_latitude         numeric(10, 7),
  gps_longitude        numeric(10, 7),
  gps_accuracy_meters  numeric(10, 2),
  location_label       text,
  is_valid             boolean NOT NULL DEFAULT true,
  invalid_reason       text,
  note                 text,
  photo_file_id        uuid REFERENCES files(id) ON DELETE SET NULL,
  raw_payload          jsonb,
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  -- deleted_at/by giữ parity DB-04 §7.5 nhưng app role KHÔNG UPDATE/DELETE được (append-only, BẤT BIẾN #2).
  deleted_at           timestamptz,
  deleted_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_attendance_logs_type
    CHECK (log_type IN ('Check-in','Check-out','Auto','Manual','Adjustment','Device','Import')),
  CONSTRAINT chk_attendance_logs_source
    CHECK (source IN ('WEB','MOBILE','MANUAL','AUTO','REMOTE','DEVICE','IMPORT','API'))
);
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance_logs;
CREATE POLICY tenant_isolation ON attendance_logs
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_record_time
  ON attendance_logs (attendance_record_id, log_time) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_logs_employee_time
  ON attendance_logs (company_id, employee_id, log_time DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_logs_company_work_date
  ON attendance_logs (company_id, work_date, source) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_logs_invalid
  ON attendance_logs (company_id, is_valid, log_time DESC) WHERE deleted_at IS NULL AND is_valid = false;
-- APPEND-ONLY (BẤT BIẾN #2): GRANT SELECT,INSERT — KHÔNG UPDATE/DELETE cho app role.
GRANT SELECT, INSERT ON attendance_logs TO mediaos_app;
GRANT SELECT ON attendance_logs TO mediaos_worker;

-- ─────────────── 7. ALTER attendance_adjustment_requests — ADD cột DB-04 §7.6 (additive, NULLABLE) ───────────────
-- GIỮ cột cũ (user_id NOT NULL / status lowercase / task_id / requested_check_*). employee_id→employee_profiles.
-- request_type CHECK tên MỚI, KHÔNG đụng att_adj_status_check cũ.
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS request_code text;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS request_type text;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS current_approver_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS current_approver_employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS attachment_file_id uuid REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- CHECK request_type (DB-04 §7.6) — tên MỚI, NULLABLE hợp lệ. KHÔNG đụng att_adj_status_check cũ.
ALTER TABLE attendance_adjustment_requests DROP CONSTRAINT IF EXISTS chk_att_adj_requests_request_type;
ALTER TABLE attendance_adjustment_requests ADD CONSTRAINT chk_att_adj_requests_request_type
  CHECK (request_type IS NULL OR request_type IN (
    'MISSING_CHECK_IN','MISSING_CHECK_OUT','UPDATE_CHECK_IN','UPDATE_CHECK_OUT',
    'EXPLAIN_LATE','EXPLAIN_EARLY_LEAVE','UPDATE_STATUS','REMOTE_CORRECTION','OTHER'
  ));
CREATE INDEX IF NOT EXISTS idx_att_adj_employee_status
  ON attendance_adjustment_requests (company_id, employee_id, status, work_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_att_adj_status_submitted
  ON attendance_adjustment_requests (company_id, status, submitted_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_att_adj_current_approver
  ON attendance_adjustment_requests (company_id, current_approver_user_id, status) WHERE deleted_at IS NULL;

-- ─────────────── 8. attendance_adjustment_items (DB-04 §7.7 — APPEND-ONLY ledger field-detail) ───────────────
CREATE TABLE IF NOT EXISTS attendance_adjustment_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL
                  DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                  REFERENCES companies(id) ON DELETE CASCADE,
  request_id    uuid NOT NULL REFERENCES attendance_adjustment_requests(id) ON DELETE CASCADE,
  field_name    text NOT NULL,
  old_value     jsonb,
  new_value     jsonb NOT NULL,
  applied_value jsonb,
  is_applied    boolean NOT NULL DEFAULT false,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL
);
ALTER TABLE attendance_adjustment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_adjustment_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance_adjustment_items;
CREATE POLICY tenant_isolation ON attendance_adjustment_items
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS idx_att_adj_items_request
  ON attendance_adjustment_items (request_id);
CREATE INDEX IF NOT EXISTS idx_att_adj_items_field
  ON attendance_adjustment_items (company_id, field_name);
-- APPEND-ONLY (ledger field-detail): GRANT SELECT,INSERT — KHÔNG UPDATE/DELETE app role.
GRANT SELECT, INSERT ON attendance_adjustment_items TO mediaos_app;
GRANT SELECT ON attendance_adjustment_items TO mediaos_worker;

-- ─────────────── 9. remote_work_request_approvals (DB-04 §7.9 — APPEND-ONLY lịch sử duyệt) ───────────────
CREATE TABLE IF NOT EXISTS remote_work_request_approvals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL
                           DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                           REFERENCES companies(id) ON DELETE CASCADE,
  remote_work_request_id uuid NOT NULL REFERENCES remote_work_requests(id) ON DELETE CASCADE,
  step_order             integer NOT NULL DEFAULT 1,
  approver_user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  approver_employee_id   uuid REFERENCES employee_profiles(id) ON DELETE SET NULL,
  action                 text NOT NULL,
  note                   text,
  acted_at               timestamptz NOT NULL DEFAULT now(),
  metadata               jsonb,
  CONSTRAINT chk_remote_approvals_action CHECK (action IN ('Submitted','Approved','Rejected','Cancelled'))
);
ALTER TABLE remote_work_request_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_work_request_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON remote_work_request_approvals;
CREATE POLICY tenant_isolation ON remote_work_request_approvals
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS idx_remote_approvals_request
  ON remote_work_request_approvals (remote_work_request_id, step_order, acted_at);
CREATE INDEX IF NOT EXISTS idx_remote_approvals_approver
  ON remote_work_request_approvals (company_id, approver_user_id, acted_at DESC);
-- APPEND-ONLY (lịch sử duyệt): GRANT SELECT,INSERT — KHÔNG UPDATE/DELETE app role.
GRANT SELECT, INSERT ON remote_work_request_approvals TO mediaos_app;
GRANT SELECT ON remote_work_request_approvals TO mediaos_worker;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DROP TABLE IF EXISTS remote_work_request_approvals CASCADE;
-- DROP TABLE IF EXISTS attendance_adjustment_items CASCADE;
-- DROP TABLE IF EXISTS attendance_logs CASCADE;
-- DROP TABLE IF EXISTS remote_work_requests CASCADE;
-- DROP TABLE IF EXISTS attendance_rules CASCADE;
-- DROP TABLE IF EXISTS shift_assignments CASCADE;
-- DROP TABLE IF EXISTS shifts CASCADE;
-- ALTER TABLE attendance_records DROP COLUMN IF EXISTS employee_id, ... (mọi cột add ở §5);
-- ALTER TABLE attendance_adjustment_requests DROP COLUMN IF EXISTS employee_id, ... (mọi cột add ở §7);
