-- Migration 0009: submission fields on workflow_steps + task_comments table
-- G4-4: My Tasks + submit work (link) + comment thread

-- ─── submission fields on workflow_steps ──────────────────────────────────────
ALTER TABLE workflow_steps
  ADD COLUMN IF NOT EXISTS submission_url  TEXT,
  ADD COLUMN IF NOT EXISTS submission_note TEXT;

-- ─── task_comments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL DEFAULT current_setting('app.current_company_id')::uuid
              REFERENCES companies(id) ON DELETE CASCADE,
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_comments_task_id_idx    ON task_comments (task_id);
CREATE INDEX IF NOT EXISTS task_comments_company_id_idx ON task_comments (company_id);

-- RLS: same pattern as all business tables
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments FORCE ROW LEVEL SECURITY;

CREATE POLICY task_comments_tenant_isolation ON task_comments
  USING (company_id = current_setting('app.current_company_id')::uuid);
