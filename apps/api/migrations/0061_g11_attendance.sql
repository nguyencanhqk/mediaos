-- Migration 0061: G11-1 — Attendance: work_schedules + attendance_records +
-- attendance_adjustment_requests + attendance_periods (khoá kỳ công) + RLS + GRANT.
-- ADR-0008: mọi mốc thời gian là timestamptz (UTC-at-rest). start_time/end_time của ca là
-- wall-clock time LẶP LẠI theo timezone của ca (KHÔNG phải instant) → kiểu `time` + cột timezone.
-- work_date = ngày LOCAL theo timezone của ca, suy từ instant check-in ở tầng app (date-fns + @date-fns/tz).
-- Đơn bổ sung công duyệt qua Task Hub (tasks.task_type='hr') — adjustment_requests.task_id trỏ sang,
-- KHÔNG có bảng approval riêng (BẤT BIẾN Task Hub hợp nhất).

-- ─── work_schedules (ca làm) ──────────────────────────────────────────────────

CREATE TABLE work_schedules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  name              text NOT NULL,
  work_type         text NOT NULL DEFAULT 'fixed',
  start_time        time NOT NULL,
  end_time          time NOT NULL,
  -- Ngày làm việc ISO (1=Thứ 2 … 7=Chủ nhật). Mặc định T2–T6.
  working_days_json jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
  timezone          text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  grace_minutes     int  NOT NULL DEFAULT 0,
  is_default        boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
--> statement-breakpoint
ALTER TABLE work_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE work_schedules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON work_schedules
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX work_schedules_company_id_idx ON work_schedules(company_id);
--> statement-breakpoint
-- 1 ca mặc định active / công ty
CREATE UNIQUE INDEX work_schedules_company_default_uq
  ON work_schedules(company_id) WHERE is_default AND deleted_at IS NULL AND status = 'active';
--> statement-breakpoint
ALTER TABLE work_schedules
  ADD CONSTRAINT work_schedules_work_type_check CHECK (work_type IN ('fixed','shift','flexible')),
  ADD CONSTRAINT work_schedules_status_check    CHECK (status IN ('active','inactive')),
  ADD CONSTRAINT work_schedules_grace_check     CHECK (grace_minutes >= 0 AND grace_minutes <= 240);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON work_schedules TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON work_schedules TO mediaos_worker;
--> statement-breakpoint

-- Gán ca cho nhân sự: cột shortcut trên employee_profiles (NULL = dùng ca mặc định công ty).
ALTER TABLE employee_profiles
  ADD COLUMN work_schedule_id uuid REFERENCES work_schedules(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX employee_profiles_work_schedule_id_idx ON employee_profiles(work_schedule_id);
--> statement-breakpoint

-- ─── attendance_records (bản ghi công — feed payroll G12, sửa phải audit) ─────

CREATE TABLE attendance_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL
                        DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                        REFERENCES companies(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date           date NOT NULL,
  work_schedule_id    uuid REFERENCES work_schedules(id) ON DELETE SET NULL,
  check_in_at         timestamptz,
  check_out_at        timestamptz,
  check_in_method     text,
  check_out_method    text,
  location_json       jsonb,
  late_minutes        int NOT NULL DEFAULT 0,
  early_leave_minutes int NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'missing_checkin',
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
--> statement-breakpoint
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON attendance_records
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- 1 bản ghi công / người / ngày (backstop chống double check-in race)
CREATE UNIQUE INDEX attendance_records_company_user_date_uq
  ON attendance_records(company_id, user_id, work_date) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX attendance_records_company_id_idx ON attendance_records(company_id);
--> statement-breakpoint
CREATE INDEX attendance_records_user_id_idx ON attendance_records(user_id);
--> statement-breakpoint
CREATE INDEX attendance_records_work_date_idx ON attendance_records(company_id, work_date);
--> statement-breakpoint
ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_status_check CHECK (status IN (
    'present','late','early_leave','absent','missing_checkin','pending_adjustment','approved_adjustment'
  )),
  ADD CONSTRAINT attendance_in_method_check  CHECK (
    check_in_method  IS NULL OR check_in_method  IN ('web','mobile','manual','adjustment')
  ),
  ADD CONSTRAINT attendance_out_method_check CHECK (
    check_out_method IS NULL OR check_out_method IN ('web','mobile','manual','adjustment')
  ),
  ADD CONSTRAINT attendance_minutes_check CHECK (late_minutes >= 0 AND early_leave_minutes >= 0),
  ADD CONSTRAINT attendance_out_after_in_check CHECK (
    check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at
  );
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON attendance_records TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON attendance_records TO mediaos_worker;
--> statement-breakpoint

-- ─── attendance_adjustment_requests (đơn bổ sung công → duyệt qua Task Hub) ───

CREATE TABLE attendance_adjustment_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL
                           DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                           REFERENCES companies(id) ON DELETE CASCADE,
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL khi quên check-in cả ngày (chưa có bản ghi) — record được tạo lúc DUYỆT.
  attendance_record_id   uuid REFERENCES attendance_records(id) ON DELETE SET NULL,
  work_date              date NOT NULL,
  requested_check_in_at  timestamptz,
  requested_check_out_at timestamptz,
  reason                 text NOT NULL,
  status                 text NOT NULL DEFAULT 'pending',
  task_id                uuid REFERENCES tasks(id) ON DELETE SET NULL,
  approved_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at            timestamptz,
  review_note            text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);
--> statement-breakpoint
ALTER TABLE attendance_adjustment_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_adjustment_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON attendance_adjustment_requests
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- 1 đơn pending / người / ngày
CREATE UNIQUE INDEX att_adj_requests_pending_uq
  ON attendance_adjustment_requests(company_id, user_id, work_date)
  WHERE status = 'pending' AND deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX att_adj_requests_company_id_idx ON attendance_adjustment_requests(company_id);
--> statement-breakpoint
CREATE INDEX att_adj_requests_user_id_idx ON attendance_adjustment_requests(user_id);
--> statement-breakpoint
CREATE INDEX att_adj_requests_status_idx ON attendance_adjustment_requests(company_id, status);
--> statement-breakpoint
ALTER TABLE attendance_adjustment_requests
  ADD CONSTRAINT att_adj_status_check CHECK (status IN ('pending','approved','rejected','cancelled')),
  ADD CONSTRAINT att_adj_has_request_check CHECK (
    requested_check_in_at IS NOT NULL OR requested_check_out_at IS NOT NULL
  ),
  ADD CONSTRAINT att_adj_out_after_in_check CHECK (
    requested_check_out_at IS NULL OR requested_check_in_at IS NULL
    OR requested_check_out_at >= requested_check_in_at
  );
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON attendance_adjustment_requests TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON attendance_adjustment_requests TO mediaos_worker;
--> statement-breakpoint

-- ─── attendance_periods (khoá kỳ công — chốt số liệu trước khi feed payroll G12) ─

CREATE TABLE attendance_periods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  status       text NOT NULL DEFAULT 'open',
  locked_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  locked_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE attendance_periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_periods FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON attendance_periods
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE UNIQUE INDEX attendance_periods_company_month_uq
  ON attendance_periods(company_id, period_month);
--> statement-breakpoint
ALTER TABLE attendance_periods
  ADD CONSTRAINT att_periods_month_check  CHECK (period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT att_periods_status_check CHECK (status IN ('open','locked'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON attendance_periods TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON attendance_periods TO mediaos_worker;
