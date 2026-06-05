-- G4-3: Workflow FSM — workflow_definitions, workflow_definition_steps, step_transitions,
--        workflow_instances, workflow_steps, tasks, approval_requests, approval_steps,
--        defects, workflow_step_instance_locks.
-- RLS + FORCE + grants trên mọi bảng. Seed MVP-0 workflow definition sau khi bảng sẵn sàng.

-- ─────────────────────────────────────────────────────────────────────────────
-- workflow_definitions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE workflow_definitions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies (id) ON DELETE CASCADE,
  code                text NOT NULL,
  name                text NOT NULL,
  applies_to          text NOT NULL DEFAULT 'content_item',
  max_approval_level  int  NOT NULL DEFAULT 1,
  allow_parallel_steps boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
--> statement-breakpoint
CREATE INDEX workflow_defs_company_id_idx ON workflow_definitions (company_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workflow_defs_company_code_active_uq ON workflow_definitions (company_id, code)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE workflow_definitions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workflow_definitions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workflow_defs_tenant_isolation ON workflow_definitions
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_definitions TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON workflow_definitions TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- workflow_definition_steps
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE workflow_definition_steps (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                          REFERENCES companies (id) ON DELETE CASCADE,
  workflow_definition_id  uuid NOT NULL REFERENCES workflow_definitions (id) ON DELETE CASCADE,
  step_order              int  NOT NULL,
  code                    text NOT NULL,
  name                    text NOT NULL,
  assignee_role_code      text,
  reviewer_role_code      text,
  is_required             boolean NOT NULL DEFAULT true,
  default_task_title      text NOT NULL
);
--> statement-breakpoint
CREATE INDEX wf_def_steps_def_id_idx ON workflow_definition_steps (workflow_definition_id);
--> statement-breakpoint
CREATE UNIQUE INDEX wf_def_steps_def_order_uq ON workflow_definition_steps (workflow_definition_id, step_order);
--> statement-breakpoint
ALTER TABLE workflow_definition_steps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workflow_definition_steps FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY wf_def_steps_tenant_isolation ON workflow_definition_steps
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_definition_steps TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON workflow_definition_steps TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- step_transitions (FSM engine — data-driven, seeded below)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE step_transitions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                          REFERENCES companies (id) ON DELETE CASCADE,
  workflow_definition_id  uuid NOT NULL REFERENCES workflow_definitions (id) ON DELETE CASCADE,
  from_state              text NOT NULL,
  event                   text NOT NULL,
  to_state                text NOT NULL,
  applies_to_step_code    text,
  written_by              text NOT NULL DEFAULT 'service'
);
--> statement-breakpoint
CREATE INDEX step_transitions_def_id_idx ON step_transitions (workflow_definition_id);
--> statement-breakpoint
CREATE UNIQUE INDEX step_transitions_def_from_event_uq
  ON step_transitions (workflow_definition_id, from_state, event);
--> statement-breakpoint
ALTER TABLE step_transitions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE step_transitions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY step_transitions_tenant_isolation ON step_transitions
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON step_transitions TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON step_transitions TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- workflow_instances
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE workflow_instances (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                          REFERENCES companies (id) ON DELETE CASCADE,
  workflow_definition_id  uuid NOT NULL REFERENCES workflow_definitions (id),
  content_item_id         uuid REFERENCES content_items (id) ON DELETE CASCADE,
  current_step_order      int  NOT NULL DEFAULT 1,
  status                  text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'completed', 'cancelled')),
  created_by              uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_instances_target_check CHECK (content_item_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX wf_instances_company_id_idx     ON workflow_instances (company_id);
--> statement-breakpoint
CREATE INDEX wf_instances_content_item_id_idx ON workflow_instances (content_item_id);
--> statement-breakpoint
CREATE UNIQUE INDEX wf_instances_content_item_active_uq ON workflow_instances (content_item_id)
  WHERE status = 'active' AND content_item_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE workflow_instances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workflow_instances FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY wf_instances_tenant_isolation ON workflow_instances
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON workflow_instances TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON workflow_instances TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- workflow_steps (projection — ADR-0016)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE workflow_steps (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                        REFERENCES companies (id) ON DELETE CASCADE,
  workflow_instance_id  uuid NOT NULL REFERENCES workflow_instances (id) ON DELETE CASCADE,
  step_order            int  NOT NULL,
  step_code             text NOT NULL,
  step_name             text NOT NULL,
  status                text NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started','in_progress','waiting_review','approved','revision','blocked')),
  assignee_user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewer_user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  started_at            timestamptz,
  submitted_at          timestamptz,
  approved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX wf_steps_instance_id_idx ON workflow_steps (workflow_instance_id);
--> statement-breakpoint
CREATE INDEX wf_steps_company_id_idx  ON workflow_steps (company_id);
--> statement-breakpoint
CREATE UNIQUE INDEX wf_steps_instance_order_uq ON workflow_steps (workflow_instance_id, step_order);
--> statement-breakpoint
ALTER TABLE workflow_steps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workflow_steps FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY wf_steps_tenant_isolation ON workflow_steps
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON workflow_steps TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON workflow_steps TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- tasks (unified hub — BẤT BIẾN #4)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                    REFERENCES companies (id) ON DELETE CASCADE,
  task_type         text NOT NULL DEFAULT 'workflow_step'
                    CHECK (task_type IN ('workflow_step','office','meeting_action','hr','finance')),
  workflow_step_id  uuid REFERENCES workflow_steps (id) ON DELETE SET NULL,
  content_item_id   uuid REFERENCES content_items (id) ON DELETE SET NULL,
  title             text NOT NULL,
  assignee_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'not_started'
                    CHECK (status IN ('not_started','in_progress','waiting_review','revision','approved','completed')),
  origin            text NOT NULL DEFAULT 'initial' CHECK (origin IN ('initial','revision')),
  revision_round    int  NOT NULL DEFAULT 0,
  due_date          timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX tasks_company_id_idx       ON tasks (company_id);
--> statement-breakpoint
CREATE INDEX tasks_assignee_user_id_idx ON tasks (assignee_user_id);
--> statement-breakpoint
CREATE INDEX tasks_workflow_step_id_idx ON tasks (workflow_step_id);
--> statement-breakpoint
-- dedup_key: chống sinh trùng khi replay outbox (§5.3 spike)
CREATE UNIQUE INDEX tasks_dedup_key_uq ON tasks (company_id, workflow_step_id, revision_round)
  WHERE workflow_step_id IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tasks_tenant_isolation ON tasks
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON tasks TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- approval_requests (source of truth — ADR-0016)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE approval_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                    REFERENCES companies (id) ON DELETE CASCADE,
  workflow_step_id  uuid NOT NULL REFERENCES workflow_steps (id) ON DELETE CASCADE,
  requested_by      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assignee_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','revision_requested')),
  current_level     int  NOT NULL DEFAULT 1,
  max_level         int  NOT NULL DEFAULT 1,
  decided_at        timestamptz,
  comment           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX approval_reqs_step_id_idx    ON approval_requests (workflow_step_id);
--> statement-breakpoint
CREATE INDEX approval_reqs_company_id_idx ON approval_requests (company_id);
--> statement-breakpoint
CREATE UNIQUE INDEX approval_reqs_step_pending_uq ON approval_requests (workflow_step_id)
  WHERE status = 'pending';
--> statement-breakpoint
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE approval_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY approval_reqs_tenant_isolation ON approval_requests
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON approval_requests TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON approval_requests TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- approval_steps (append-only — 1 decision per level)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE approval_steps (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies (id) ON DELETE CASCADE,
  approval_request_id uuid NOT NULL REFERENCES approval_requests (id) ON DELETE CASCADE,
  level               int  NOT NULL DEFAULT 1,
  approver_user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  decision            text NOT NULL CHECK (decision IN ('approved','revision_requested')),
  decided_at          timestamptz NOT NULL DEFAULT now(),
  comment             text
);
--> statement-breakpoint
CREATE INDEX approval_steps_request_id_idx ON approval_steps (approval_request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX approval_steps_request_level_uq ON approval_steps (approval_request_id, level);
--> statement-breakpoint
ALTER TABLE approval_steps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE approval_steps FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY approval_steps_tenant_isolation ON approval_steps
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- append-only: mediaos_app chỉ INSERT + SELECT (không UPDATE/DELETE — bất biến #2)
GRANT SELECT, INSERT ON approval_steps TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON approval_steps TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- defects (append-only — consumer sinh khi revision)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE defects (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                            REFERENCES companies (id) ON DELETE CASCADE,
  workflow_step_id          uuid NOT NULL REFERENCES workflow_steps (id) ON DELETE CASCADE,
  responsible_user_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  caused_by_approval_step_id uuid REFERENCES approval_steps (id) ON DELETE SET NULL,
  description               text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX defects_step_id_idx    ON defects (workflow_step_id);
--> statement-breakpoint
CREATE INDEX defects_company_id_idx ON defects (company_id);
--> statement-breakpoint
ALTER TABLE defects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE defects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY defects_tenant_isolation ON defects
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- append-only: không UPDATE/DELETE (bất biến #2)
GRANT SELECT, INSERT ON defects TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON defects TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- workflow_step_instance_locks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE workflow_step_instance_locks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                   REFERENCES companies (id) ON DELETE CASCADE,
  locked_step_id   uuid NOT NULL REFERENCES workflow_steps (id) ON DELETE CASCADE,
  caused_by_step_id uuid NOT NULL REFERENCES workflow_steps (id) ON DELETE CASCADE,
  lock_reason      text NOT NULL DEFAULT 'downstream_blocked_by_revision',
  created_at       timestamptz NOT NULL DEFAULT now(),
  released_at      timestamptz
);
--> statement-breakpoint
CREATE INDEX wf_step_locks_locked_step_id_idx ON workflow_step_instance_locks (locked_step_id);
--> statement-breakpoint
CREATE INDEX wf_step_locks_caused_by_idx      ON workflow_step_instance_locks (caused_by_step_id);
--> statement-breakpoint
ALTER TABLE workflow_step_instance_locks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workflow_step_instance_locks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY wf_step_locks_tenant_isolation ON workflow_step_instance_locks
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON workflow_step_instance_locks TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON workflow_step_instance_locks TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed MVP-0 workflow definition (Video chuẩn 4 bước)
-- Dùng seed company riêng để tránh RLS khi chạy migration (migration chạy dưới postgres/owner).
-- Seed dưới role owner TRƯỚC khi RLS active cho mediaos_app.
-- ─────────────────────────────────────────────────────────────────────────────

-- Seed function chạy một lần: chèn definition + steps + transitions cho MỖI company.
-- Được gọi thủ công sau khi tạo công ty đầu tiên (hoặc trong seed-company script).
-- Migration chỉ tạo bảng — không seed data (vì RLS cần company_id cụ thể).
-- Xem: scripts/seed-workflow-definition.sql
