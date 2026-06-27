-- Migration 0420: PM-1 — Nền tảng app quản lý dự án kiểu Plane (apps/projects).
-- Gate: FULL (security-reviewer [RLS/permission] + database-reviewer + silent-failure-hunter).
--
-- BAND 0420-0429 (lane projects-pm — band MỚI, sau 0410_cs10). Hook guard-migration-band fail-open trên
-- branch feat/projects-pm-app (không khớp gN/acN) → số 0420 hợp lệ.
-- Journal: idx 112, when 1717500470000 (> high-water 1717500460000 = 0410_cs10_user_invites).
--
-- MỤC TIÊU (Phase 1 — coi `task`=work item, `project`=project, mở rộng ADDITIVE, GIỮ compat FSM studio):
--   • project_states: trạng thái tùy biến theo project (5 nhóm Plane), thay thế DẦN tasks.status (giữ song song).
--   • labels + task_labels: nhãn màu (M:N) cho work item.
--   • tasks +cột: state_id (FK project_states), priority, description, sequence (displayId), start_date.
--   • projects +cột: identifier (mã prefix), last_task_sequence (bộ đếm sequence/project — cấp ATOMIC FOR UPDATE).
--   • permission: resource_type mới `project_state` + `label`; seed role guest (read-only).
--   • backfill: seed 5 state mặc định cho MỌI project hiện có + map tasks.state_id từ status legacy + sequence.
--
-- BẤT BIẾN: #1 company_id NOT NULL + RLS ENABLE/FORCE + policy tenant_isolation USING+WITH CHECK trên MỌI
--   bảng mới. #2 soft-delete (deleted_at), KHÔNG hard-delete (project_states/labels); task_labels là link M:N
--   thuần (hard-DELETE khi gỡ nhãn — tiền lệ project_teams). #4 tasks là hub DUY NHẤT — KHÔNG bảng issue riêng.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 1) projects: +identifier (mã prefix Plane) +last_task_sequence (bộ đếm sequence per-project)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS identifier         text,
  ADD COLUMN IF NOT EXISTS last_task_sequence integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- identifier unique theo company (case-insensitive), chỉ trên project chưa xoá + có identifier.
CREATE UNIQUE INDEX IF NOT EXISTS projects_company_identifier_active_uq
  ON projects (company_id, upper(identifier))
  WHERE deleted_at IS NULL AND identifier IS NOT NULL;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 2) project_states — trạng thái tùy biến theo project (5 nhóm Plane). Soft-delete + reorder + recolor.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE project_states (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  state_group text NOT NULL,
  color       text NOT NULL DEFAULT '#64748b',
  is_default  boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE project_states ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_states FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON project_states
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE project_states
  ADD CONSTRAINT project_states_group_check
  CHECK (state_group IN ('backlog', 'unstarted', 'started', 'completed', 'cancelled'));
--> statement-breakpoint
CREATE INDEX project_states_company_id_idx ON project_states(company_id);
--> statement-breakpoint
CREATE INDEX project_states_company_project_idx ON project_states(company_id, project_id);
--> statement-breakpoint
CREATE UNIQUE INDEX project_states_project_name_active_uq
  ON project_states (company_id, project_id, name)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
-- Mutable (rename/recolor/reorder) + soft-delete → app role SELECT,INSERT,UPDATE (KHÔNG hard-DELETE).
GRANT SELECT, INSERT, UPDATE ON project_states TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON project_states TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 3) labels — nhãn màu theo project. Soft-delete + rename/recolor.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE labels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#6366f1',
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE labels FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON labels
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX labels_company_id_idx ON labels(company_id);
--> statement-breakpoint
CREATE INDEX labels_company_project_idx ON labels(company_id, project_id);
--> statement-breakpoint
CREATE UNIQUE INDEX labels_project_name_active_uq
  ON labels (company_id, project_id, name)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON labels TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON labels TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 4) task_labels — gán nhãn cho work item (M:N). Link thuần: hard-DELETE khi gỡ (tiền lệ project_teams).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE task_labels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies(id) ON DELETE CASCADE,
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id    uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE task_labels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE task_labels FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON task_labels
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX task_labels_task_id_idx ON task_labels(task_id);
--> statement-breakpoint
CREATE INDEX task_labels_label_id_idx ON task_labels(label_id);
--> statement-breakpoint
CREATE UNIQUE INDEX task_labels_uq ON task_labels (company_id, task_id, label_id);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON task_labels TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON task_labels TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 5) tasks — +cột work item kiểu Plane (ADDITIVE; GIỮ status/task_type CHECK cũ chạy cho FSM studio).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS priority    text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS state_id    uuid REFERENCES project_states(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sequence    integer,
  ADD COLUMN IF NOT EXISTS start_date  timestamptz;
--> statement-breakpoint
ALTER TABLE tasks
  ADD CONSTRAINT tasks_priority_check CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none'));
--> statement-breakpoint
CREATE INDEX tasks_company_priority_active_idx
  ON tasks (company_id, priority)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX tasks_company_state_active_idx
  ON tasks (company_id, state_id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX tasks_project_sequence_idx
  ON tasks (company_id, project_id, sequence)
  WHERE deleted_at IS NULL AND project_id IS NOT NULL;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 6) Permission seed — resource_type mới `project_state` + `label` (is_sensitive=false) + role guest.
--    company-admin (...001) + project-manager (...002) nhận đủ; employee (...008) read; guest (...009) read.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('create', 'project_state', false),
  ('read',   'project_state', false),
  ('update', 'project_state', false),
  ('delete', 'project_state', false),
  ('create', 'label', false),
  ('read',   'label', false),
  ('update', 'label', false),
  ('delete', 'label', false)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Seed role guest (system role, company_id NULL) — read-only + comment. UUID ...009 (nối tiếp 001..008).
INSERT INTO roles (id, company_id, name, description, is_system) VALUES
  ('00000000-0000-0000-0000-000000000009', NULL, 'guest', 'Guest: read-only project access + comment', true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- company-admin: đủ 8 quyền mới (seed 0005 WHERE is_sensitive=false đã chạy MỘT LẦN, không tự bắt quyền mới).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.is_sensitive = false
  AND p.resource_type IN ('project_state', 'label')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- project-manager: đủ 8 quyền mới (giữ invariant system-role KHÔNG nhận quyền is_sensitive).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000002', p.id, 'ALLOW'
FROM permissions p
WHERE p.is_sensitive = false
  AND p.resource_type IN ('project_state', 'label')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- employee: read project_state + label (xem board/nhãn; không quản trị).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000008', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (('read', 'project_state'), ('read', 'label'))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- guest: read task/project/state/label + comment (read-only collaborator).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000009', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (
  ('read', 'task'), ('read', 'project'), ('read', 'project_state'), ('read', 'label'), ('comment', 'comment')
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 7) Backfill — mọi project hiện có nhận 5 state mặc định; map tasks.state_id từ status legacy; +sequence.
--    (Migrator chạy role privileged BYPASSRLS → INSERT/UPDATE tenant rows hợp lệ; company_id tường minh.)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO project_states (company_id, project_id, name, state_group, color, is_default, sort_order)
SELECT p.company_id, p.id, s.name, s.grp, s.color, s.is_default, s.sort_order
FROM projects p
CROSS JOIN (VALUES
  ('Backlog',     'backlog',   '#94a3b8', false, 0),
  ('Todo',        'unstarted', '#64748b', true,  1),
  ('In Progress', 'started',   '#3b82f6', false, 2),
  ('Done',        'completed', '#22c55e', false, 3),
  ('Cancelled',   'cancelled', '#ef4444', false, 4)
) AS s(name, grp, color, is_default, sort_order)
WHERE p.deleted_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Map state_id cho task có project (status legacy → state name mặc định). Task không project_id → để NULL.
UPDATE tasks t
SET state_id = ps.id
FROM project_states ps
WHERE ps.company_id = t.company_id
  AND ps.project_id = t.project_id
  AND ps.name = CASE t.status
        WHEN 'not_started'    THEN 'Todo'
        WHEN 'in_progress'    THEN 'In Progress'
        WHEN 'waiting_review' THEN 'In Progress'
        WHEN 'revision'       THEN 'In Progress'
        WHEN 'approved'       THEN 'Done'
        WHEN 'completed'      THEN 'Done'
        ELSE 'Todo'
      END
  AND t.project_id IS NOT NULL
  AND t.deleted_at IS NULL
  AND t.state_id IS NULL;
--> statement-breakpoint
-- Backfill sequence per-project (theo created_at) + đồng bộ projects.last_task_sequence.
WITH seq AS (
  SELECT id, row_number() OVER (PARTITION BY company_id, project_id ORDER BY created_at, id) AS rn
  FROM tasks
  WHERE project_id IS NOT NULL AND deleted_at IS NULL
)
UPDATE tasks t SET sequence = seq.rn
FROM seq
WHERE seq.id = t.id AND t.sequence IS NULL;
--> statement-breakpoint
UPDATE projects p
SET last_task_sequence = COALESCE(
  (SELECT MAX(t.sequence) FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL), 0
)
WHERE p.deleted_at IS NULL;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 8) audit_logs CHECK +'project_state','label' (HOT-FILE §5.3: DO-block UNION ADD-only — mẫu 0190).
--    Sync AUDIT_OBJECT_TYPES (schema/audit.ts) CÙNG commit.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['project_state', 'label'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RETURN;
  END IF;

  v_def := pg_get_constraintdef(v_oid);
  IF position('ANY' IN upper(v_def)) > 0 THEN
    v_cur := substring(v_def FROM '\{[^}]*\}')::text[];
  ELSE
    SELECT array_agg(m[1]) INTO v_cur
      FROM (
        SELECT regexp_matches(v_def, '''([^'']+)''', 'g') AS m
      ) sub;
  END IF;

  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
END;
$$;

-- -------- Down (manual) --------
-- DROP TABLE IF EXISTS task_labels;  DROP TABLE IF EXISTS labels;
-- ALTER TABLE tasks DROP COLUMN IF EXISTS state_id;  (rồi) DROP TABLE IF EXISTS project_states;
-- ALTER TABLE tasks DROP COLUMN IF EXISTS priority, DROP COLUMN IF EXISTS description,
--   DROP COLUMN IF EXISTS sequence, DROP COLUMN IF EXISTS start_date;
-- ALTER TABLE projects DROP COLUMN IF EXISTS identifier, DROP COLUMN IF EXISTS last_task_sequence;
-- (permissions/role_permissions/audit CHECK: re-stamp only if no row references the new values.)
