-- Migration 0062: G11-2 — Leave: leave_types + leave_requests + leave_balances + RLS + GRANT.
-- Đơn nghỉ duyệt qua Task Hub (tasks.task_type='hr') — leave_requests.task_id trỏ sang,
-- KHÔNG bảng approval riêng. Trừ phép (used_days) chỉ xảy ra lúc DUYỆT, trong cùng tx, có audit.
-- remaining_days là GENERATED COLUMN — không thể lệch total/used (số liệu sạch feed payroll G12).

-- ─── leave_types (loại nghỉ) ──────────────────────────────────────────────────

CREATE TABLE leave_types (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  code         text NOT NULL,
  paid         boolean NOT NULL DEFAULT true,
  -- Hạn mức năm (ngày). NULL = không giới hạn (vd nghỉ không lương).
  annual_quota numeric(5,1),
  status       text NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
--> statement-breakpoint
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE leave_types FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON leave_types
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE UNIQUE INDEX leave_types_company_code_active_uq
  ON leave_types(company_id, code) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX leave_types_company_id_idx ON leave_types(company_id);
--> statement-breakpoint
ALTER TABLE leave_types
  ADD CONSTRAINT leave_types_status_check CHECK (status IN ('active','inactive')),
  ADD CONSTRAINT leave_types_quota_check  CHECK (annual_quota IS NULL OR annual_quota >= 0);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON leave_types TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON leave_types TO mediaos_worker;
--> statement-breakpoint

-- ─── leave_requests (đơn nghỉ → Task Hub) ─────────────────────────────────────

CREATE TABLE leave_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL
                  DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                  REFERENCES companies(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  total_days    numeric(5,1) NOT NULL,
  reason        text,
  status        text NOT NULL DEFAULT 'pending',
  task_id       uuid REFERENCES tasks(id) ON DELETE SET NULL,
  approved_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at   timestamptz,
  review_note   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
--> statement-breakpoint
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE leave_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON leave_requests
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX leave_requests_company_id_idx ON leave_requests(company_id);
--> statement-breakpoint
CREATE INDEX leave_requests_user_id_idx ON leave_requests(user_id);
--> statement-breakpoint
CREATE INDEX leave_requests_status_idx ON leave_requests(company_id, status);
--> statement-breakpoint
CREATE INDEX leave_requests_dates_idx ON leave_requests(company_id, start_date, end_date);
--> statement-breakpoint
ALTER TABLE leave_requests
  ADD CONSTRAINT leave_req_status_check CHECK (status IN ('pending','approved','rejected','cancelled')),
  ADD CONSTRAINT leave_req_dates_check  CHECK (start_date <= end_date),
  ADD CONSTRAINT leave_req_days_check   CHECK (total_days > 0);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON leave_requests TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON leave_requests TO mediaos_worker;
--> statement-breakpoint

-- ─── leave_balances (số phép — trừ lúc duyệt, audit mọi thay đổi) ─────────────

CREATE TABLE leave_balances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL
                   DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                   REFERENCES companies(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type_id  uuid NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year           int NOT NULL,
  total_days     numeric(5,1) NOT NULL DEFAULT 0,
  used_days      numeric(5,1) NOT NULL DEFAULT 0,
  remaining_days numeric(6,1) GENERATED ALWAYS AS (total_days - used_days) STORED,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE leave_balances FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON leave_balances
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE UNIQUE INDEX leave_balances_user_type_year_uq
  ON leave_balances(company_id, user_id, leave_type_id, year);
--> statement-breakpoint
CREATE INDEX leave_balances_company_id_idx ON leave_balances(company_id);
--> statement-breakpoint
CREATE INDEX leave_balances_user_id_idx ON leave_balances(user_id);
--> statement-breakpoint
ALTER TABLE leave_balances
  ADD CONSTRAINT leave_bal_year_check  CHECK (year >= 2000 AND year <= 2100),
  ADD CONSTRAINT leave_bal_total_check CHECK (total_days >= 0),
  -- Không cho trừ quá số phép — chốt cứng ở DB (backstop cho race 2 lần duyệt song song).
  ADD CONSTRAINT leave_bal_used_check  CHECK (used_days >= 0 AND used_days <= total_days);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON leave_balances TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON leave_balances TO mediaos_worker;
