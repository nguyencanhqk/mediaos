-- G7-1 (0032): Template config + DAG dependencies + checklist (template layer).
-- ALTER workflow_definitions (versioning D4) + workflow_definition_steps (node_key/canvas anchor).
-- CREATE workflow_step_dependencies (DAG edges — crown-jewel config) + checklists + checklist_items.
-- RLS + FORCE + policy tenant_isolation cho MỌI bảng mới. D7: publish video_standard_v0 + deps tuyến tính.
-- Thứ tự: ALTER defs → ALTER def_steps(+node_key backfill→NOT NULL) → deps → checklists → ALTER add default_checklist_id → D7 seed.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ALTER workflow_definitions — version/status/published_at/created_by (D4 versioning)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE workflow_definitions
  ADD COLUMN version      int  NOT NULL DEFAULT 1,
  ADD COLUMN status       text NOT NULL DEFAULT 'draft',
  ADD COLUMN published_at timestamptz,
  ADD COLUMN created_by   uuid REFERENCES users (id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE workflow_definitions
  ADD CONSTRAINT workflow_defs_status_check CHECK (status IN ('draft', 'published', 'archived'));
--> statement-breakpoint
-- uq (company, code) → (company, code, version): published version BẤT BIẾN, clone = version+1 (D4).
DROP INDEX workflow_defs_company_code_active_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX workflow_defs_company_code_version_active_uq
  ON workflow_definitions (company_id, code, version) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ALTER workflow_definition_steps — node_key (ổn định cho deps+canvas) + layout
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE workflow_definition_steps
  ADD COLUMN node_key   text,
  ADD COLUMN step_type  text NOT NULL DEFAULT 'task',
  ADD COLUMN position_x int,
  ADD COLUMN position_y int;
--> statement-breakpoint
-- Backfill node_key = code cho bước G4-3 cũ (code unique trong 1 definition ⇒ thoả uq mới).
UPDATE workflow_definition_steps SET node_key = code WHERE node_key IS NULL;
--> statement-breakpoint
ALTER TABLE workflow_definition_steps ALTER COLUMN node_key SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX wf_def_steps_def_node_key_uq
  ON workflow_definition_steps (workflow_definition_id, node_key);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. workflow_step_dependencies — cạnh DAG ở template (step B chờ step A)
--    DB chỉ chặn self-loop (A→A); acyclicity (A→B→A) ép ở app-layer DagValidator (G7-2a, DV1).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE workflow_step_dependencies (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                         REFERENCES companies (id) ON DELETE CASCADE,
  workflow_definition_id uuid NOT NULL REFERENCES workflow_definitions (id) ON DELETE CASCADE,
  from_step_id           uuid NOT NULL REFERENCES workflow_definition_steps (id) ON DELETE CASCADE,
  to_step_id             uuid NOT NULL REFERENCES workflow_definition_steps (id) ON DELETE CASCADE,
  dependency_type        text NOT NULL DEFAULT 'finish_to_start',
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_step_deps_no_self_loop CHECK (from_step_id <> to_step_id),
  CONSTRAINT wf_step_deps_type_check CHECK (
    dependency_type IN ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')
  )
);
--> statement-breakpoint
CREATE INDEX wf_step_deps_company_id_idx ON workflow_step_dependencies (company_id);
--> statement-breakpoint
CREATE INDEX wf_step_deps_def_id_idx ON workflow_step_dependencies (workflow_definition_id);
--> statement-breakpoint
-- DAG traversal: predecessors (by to_step_id) + successors (by from_step_id) + cascade delete.
CREATE INDEX wf_step_deps_from_step_id_idx ON workflow_step_dependencies (from_step_id);
--> statement-breakpoint
CREATE INDEX wf_step_deps_to_step_id_idx ON workflow_step_dependencies (to_step_id);
--> statement-breakpoint
CREATE UNIQUE INDEX wf_step_deps_edge_uq
  ON workflow_step_dependencies (workflow_definition_id, from_step_id, to_step_id);
--> statement-breakpoint
ALTER TABLE workflow_step_dependencies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workflow_step_dependencies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY wf_step_deps_tenant_isolation ON workflow_step_dependencies
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_step_dependencies TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON workflow_step_dependencies TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. checklists (template) + checklist_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE checklists (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                              REFERENCES companies (id) ON DELETE CASCADE,
  name                        text NOT NULL,
  workflow_definition_step_id uuid REFERENCES workflow_definition_steps (id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX checklists_company_id_idx ON checklists (company_id);
--> statement-breakpoint
CREATE INDEX checklists_def_step_id_idx ON checklists (workflow_definition_step_id);
--> statement-breakpoint
ALTER TABLE checklists ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE checklists FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY checklists_tenant_isolation ON checklists
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON checklists TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON checklists TO mediaos_worker;
--> statement-breakpoint
CREATE TABLE checklist_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
               REFERENCES companies (id) ON DELETE CASCADE,
  checklist_id uuid NOT NULL REFERENCES checklists (id) ON DELETE CASCADE,
  label        text NOT NULL,
  is_required  boolean NOT NULL DEFAULT true,
  sort_order   int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX checklist_items_company_id_idx ON checklist_items (company_id);
--> statement-breakpoint
CREATE INDEX checklist_items_checklist_id_idx ON checklist_items (checklist_id);
--> statement-breakpoint
ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE checklist_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY checklist_items_tenant_isolation ON checklist_items
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_items TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON checklist_items TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ALTER workflow_definition_steps ADD default_checklist_id (sau khi checklists tồn tại — tránh FK vòng)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE workflow_definition_steps
  ADD COLUMN default_checklist_id uuid REFERENCES checklists (id) ON DELETE SET NULL;
--> statement-breakpoint
-- FK index: checklist delete → SET NULL cần index để tránh scan def_steps.
CREATE INDEX wf_def_steps_default_checklist_id_idx
  ON workflow_definition_steps (default_checklist_id) WHERE default_checklist_id IS NOT NULL;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. D7 backfill — publish video_standard_v0 (mọi company) + deps tuyến tính script→edit→qa→upload.
--    Idempotent, an toàn 0-row. Migration chạy dưới owner (bypass RLS) — company_id propagate từ row hiện có.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE workflow_definitions
  SET status = 'published', published_at = now()
  WHERE code = 'video_standard_v0' AND status = 'draft' AND deleted_at IS NULL;
--> statement-breakpoint
INSERT INTO workflow_step_dependencies (company_id, workflow_definition_id, from_step_id, to_step_id)
SELECT s1.company_id, s1.workflow_definition_id, s1.id, s2.id
FROM workflow_definitions d
JOIN workflow_definition_steps s1
  ON s1.workflow_definition_id = d.id
JOIN workflow_definition_steps s2
  ON s2.workflow_definition_id = d.id AND s2.step_order = s1.step_order + 1
WHERE d.code = 'video_standard_v0' AND d.deleted_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
