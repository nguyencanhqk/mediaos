-- G7-3 (0034): Instance đa-target (content_item XOR project) + pin definition_version (D4) +
-- workflow_steps.node_key (advisory map về template step) + workflow_step_checklist_states (instance tick).
-- RLS + FORCE + policy tenant_isolation cho bảng mới. CHECK byte-identical với db/schema/workflow.ts.
-- Thứ tự: ALTER instances (cols → index → swap target CHECK qua guard → project active uq) →
--         ALTER steps (+node_key, backfill) → CREATE checklist_states (+RLS).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ALTER workflow_instances — đa-target (content_item XOR project) + pin version (D4)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE workflow_instances
  ADD COLUMN project_id         uuid REFERENCES projects (id) ON DELETE CASCADE,
  ADD COLUMN definition_version int NOT NULL DEFAULT 1;
--> statement-breakpoint
-- FK index (project delete → cascade instance: tránh seq scan).
CREATE INDEX wf_instances_project_id_idx ON workflow_instances (project_id);
--> statement-breakpoint
-- Swap single-target CHECK → đúng-một. DROP theo TÊN THẬT wf_instances_target_check (bẫy handoff §4.3).
ALTER TABLE workflow_instances DROP CONSTRAINT wf_instances_target_check;
--> statement-breakpoint
-- Guard TRƯỚC ADD: chặn data bẩn. Instance G4-3 cũ (content set, project NULL) → (1)+(0)=1 ✓ thoả.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM workflow_instances
    WHERE (content_item_id IS NOT NULL)::int + (project_id IS NOT NULL)::int <> 1
  ) THEN
    RAISE EXCEPTION 'wf_instances target-check guard: % row(s) violate exactly-one (content_item XOR project)',
      (SELECT count(*) FROM workflow_instances
       WHERE (content_item_id IS NOT NULL)::int + (project_id IS NOT NULL)::int <> 1);
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE workflow_instances
  ADD CONSTRAINT wf_instances_target_check
  CHECK ((content_item_id IS NOT NULL)::int + (project_id IS NOT NULL)::int = 1);
--> statement-breakpoint
-- 1 project → 1 active workflow tại một thời điểm (song song uq content_item active hiện có).
CREATE UNIQUE INDEX wf_instances_project_active_uq
  ON workflow_instances (project_id) WHERE status = 'active' AND project_id IS NOT NULL;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ALTER workflow_steps — node_key (map về template step để tra deps theo definition_version)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE workflow_steps ADD COLUMN node_key text;
--> statement-breakpoint
-- Backfill row G4-3 cũ: node_key = step_code (align template node_key=code từ 0032). Nullable — 3b set tường minh.
UPDATE workflow_steps SET node_key = step_code WHERE node_key IS NULL;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. workflow_step_checklist_states — tick checklist ở instance (append-friendly).
--    Có row = đã tick; bỏ tick = DELETE. uq (step, item) → mỗi item tick tối đa 1 lần/step.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE workflow_step_checklist_states (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                    REFERENCES companies (id) ON DELETE CASCADE,
  workflow_step_id  uuid NOT NULL REFERENCES workflow_steps (id) ON DELETE CASCADE,
  checklist_item_id uuid NOT NULL REFERENCES checklist_items (id) ON DELETE CASCADE,
  checked_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  checked_at        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX wf_step_checklist_states_company_id_idx ON workflow_step_checklist_states (company_id);
--> statement-breakpoint
CREATE INDEX wf_step_checklist_states_step_id_idx ON workflow_step_checklist_states (workflow_step_id);
--> statement-breakpoint
CREATE UNIQUE INDEX wf_step_checklist_states_step_item_uq
  ON workflow_step_checklist_states (workflow_step_id, checklist_item_id);
--> statement-breakpoint
-- FK supporting index: checklist_item delete → cascade scan tránh seq scan (db-reviewer #6).
CREATE INDEX wf_step_checklist_states_item_id_idx
  ON workflow_step_checklist_states (checklist_item_id);
--> statement-breakpoint
ALTER TABLE workflow_step_checklist_states ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workflow_step_checklist_states FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY wf_step_checklist_states_tenant_isolation ON workflow_step_checklist_states
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_step_checklist_states TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON workflow_step_checklist_states TO mediaos_worker;
--> statement-breakpoint
