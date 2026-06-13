-- Migration 0073: G13-4 — expense_requests (mutable: S,I,U) + expense_approvals (log: S,I) +
--   ALTER cost_records ADD expense_request_id (lineage cost↔đề xuất chi).
-- Journal: wire khi land (xem MERGE NOTE 0070). Đề xuất chi duyệt QUA Task Hub (task_type='finance') —
-- KHÔNG bảng/luồng duyệt riêng (bất biến #4). expense_approvals CHỈ là log quyết định (append-only).

-- ═══ expense_requests — đề xuất chi (mutable status: GRANT SELECT,INSERT,UPDATE — không DELETE) ═══
CREATE TABLE expense_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL
                           DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                           REFERENCES companies(id) ON DELETE CASCADE,
  requested_by           uuid NOT NULL REFERENCES users(id),
  org_unit_id            uuid REFERENCES org_units(id) ON DELETE SET NULL,
  project_id             uuid REFERENCES projects(id) ON DELETE SET NULL,
  channel_id             uuid REFERENCES channels(id) ON DELETE SET NULL,
  title                  text NOT NULL,
  description            text,
  amount                 numeric(18,2) NOT NULL,
  currency               text NOT NULL DEFAULT 'VND',
  expense_type           text NOT NULL,
  needed_at              date,
  status                 text NOT NULL DEFAULT 'pending',
  current_approval_level integer NOT NULL DEFAULT 1,
  attachment_url         text,
  task_id                uuid REFERENCES tasks(id) ON DELETE SET NULL,
  cost_record_id         uuid REFERENCES cost_records(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_requests_status_check CHECK (status IN ('pending','approved','rejected','cancelled')),
  CONSTRAINT expense_requests_expense_type_check CHECK (expense_type IN
    ('salary','freelancer','software','equipment','ads','production','training','recruitment','operation','other'))
);
--> statement-breakpoint
ALTER TABLE expense_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE expense_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY expense_requests_app_tenant_iso ON expense_requests
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX expense_requests_company_status_idx    ON expense_requests (company_id, status);
--> statement-breakpoint
CREATE INDEX expense_requests_company_requester_idx ON expense_requests (company_id, requested_by);
--> statement-breakpoint
CREATE INDEX expense_requests_task_idx              ON expense_requests (task_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON expense_requests TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON expense_requests TO mediaos_worker;
--> statement-breakpoint

-- ═══ expense_approvals — log quyết định (append-only: GRANT SELECT,INSERT) ═══
CREATE TABLE expense_approvals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  expense_request_id uuid NOT NULL REFERENCES expense_requests(id) ON DELETE CASCADE,
  approval_level     integer NOT NULL DEFAULT 1,
  approver_user_id   uuid NOT NULL REFERENCES users(id),
  decision           text NOT NULL,
  comment            text,
  decided_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_approvals_decision_check CHECK (decision IN ('approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE expense_approvals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE expense_approvals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY expense_approvals_app_tenant_iso ON expense_approvals
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX expense_approvals_company_request_idx
  ON expense_approvals (company_id, expense_request_id);
--> statement-breakpoint
-- Chặn double-decision cùng cấp ở DB (race 2 approver duyệt cùng lúc).
CREATE UNIQUE INDEX expense_approvals_request_level_uq
  ON expense_approvals (expense_request_id, approval_level);
--> statement-breakpoint
GRANT SELECT, INSERT ON expense_approvals TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON expense_approvals TO mediaos_worker;
--> statement-breakpoint

-- ═══ ALTER cost_records ADD expense_request_id (lineage — cost sinh từ đề xuất chi đã duyệt) ═══
-- Đặt ở 0073 vì expense_requests vừa tạo xong. cost_records vẫn APPEND-ONLY (chỉ thêm cột nullable, không
-- cấp UPDATE). expense_request_id set NGAY khi INSERT cost lúc duyệt (không UPDATE bản ghi cũ).
ALTER TABLE cost_records
  ADD COLUMN expense_request_id uuid REFERENCES expense_requests(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX cost_records_expense_request_idx ON cost_records (expense_request_id);

-- Down: ALTER TABLE cost_records DROP COLUMN expense_request_id;
--       DROP TABLE expense_approvals; DROP TABLE expense_requests;
