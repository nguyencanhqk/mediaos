-- Migration 0080: G8-1 (APR-001/002) — approval_rules: multi-level approval config for a workflow step.
--
-- BAND 0080s (lane G8) — guard-migration-band ENFORCES this number range for feat/g8-approval.
-- approval_requests + approval_steps ALREADY exist (0008): current_level/max_level there are the SOURCE
-- OF TRUTH (ADR-0016). This table only describes WHO approves at each level (level → approver_user_id).
--
-- GX-4 / CLAUDE §3: RLS policy + FORCE created BEFORE any row exists → no cross-tenant leak window.
-- company_id NOT NULL DEFAULT app.current_company_id + USING + WITH CHECK (BẤT BIẾN #1).

CREATE TABLE approval_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                     REFERENCES companies (id) ON DELETE CASCADE,
  workflow_step_id uuid NOT NULL REFERENCES workflow_steps (id) ON DELETE CASCADE,
  level            int  NOT NULL CHECK (level >= 1),
  approver_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX approval_rules_company_id_idx  ON approval_rules (company_id);
--> statement-breakpoint
CREATE INDEX approval_rules_step_level_idx  ON approval_rules (workflow_step_id, level);
--> statement-breakpoint
-- One approver row per (step, level) — a level cannot have two configured approvers (tenant-scoped).
CREATE UNIQUE INDEX approval_rules_step_level_uq ON approval_rules (company_id, workflow_step_id, level);
--> statement-breakpoint
ALTER TABLE approval_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE approval_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY approval_rules_tenant_isolation ON approval_rules
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON approval_rules TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON approval_rules TO mediaos_worker;
