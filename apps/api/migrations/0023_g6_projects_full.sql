-- Migration 0023: G6-3 — ALTER projects (full) + ALTER project_channels (role/status + GRANT UPDATE
-- + fix-forward project_channels_uq dẫn đầu company_id) + project_teams + project_members.
-- Bảng mới (project_teams/project_members) RLS+FORCE TRƯỚC mọi insert (GX-4). projects.status KHÔNG widen
-- (giữ 'active','paused','archived' từ 0007) → không cần backfill.

-- ===== ALTER projects (G4-2 slice → ERD full) =====
ALTER TABLE projects
  ADD COLUMN code               text,
  ADD COLUMN project_type       text,
  ADD COLUMN description        text,
  ADD COLUMN owner_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN project_manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN start_date         date,
  ADD COLUMN end_date           date,
  ADD COLUMN priority           text,
  ADD COLUMN budget             numeric(18,2);
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_type_check CHECK (
  project_type IS NULL OR project_type IN
    ('content_production','channel_operation','growth_campaign','recruitment',
     'training','finance','office_internal','equipment')
);
--> statement-breakpoint
ALTER TABLE projects ADD CONSTRAINT projects_priority_check CHECK (
  priority IS NULL OR priority IN ('low','medium','high','urgent')
);
--> statement-breakpoint
CREATE UNIQUE INDEX projects_company_code_active_uq
  ON projects (company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
--> statement-breakpoint
CREATE INDEX projects_company_status_idx ON projects (company_id, status);
--> statement-breakpoint

-- ===== ALTER project_channels (M:N) =====
-- ⚠️ project_channels mang cột mutable status/role_in_project → BẤT BIẾN #2c: PHẢI cấp UPDATE.
-- 0007 GRANT cũ = SELECT/INSERT/DELETE (no UPDATE). Thêm UPDATE để PATCH status/role được.
ALTER TABLE project_channels
  ADD COLUMN role_in_project text,
  ADD COLUMN status          text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE project_channels ADD CONSTRAINT project_channels_status_check
  CHECK (status IN ('active','inactive'));
--> statement-breakpoint
GRANT UPDATE ON project_channels TO mediaos_app;
--> statement-breakpoint
-- ⚠️ (fix-forward) 0007 project_channels_uq thiếu company_id → class bug. Sửa unique tại đây:
-- DROP unique cũ (project_channels_uq từ CREATE UNIQUE INDEX 0007) + tạo lại dẫn đầu company_id.
DROP INDEX IF EXISTS project_channels_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX project_channels_uq ON project_channels (company_id, project_id, channel_id);
--> statement-breakpoint

-- ===== project_teams (M:N project ↔ team) =====
CREATE TABLE project_teams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL
                    DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                    REFERENCES companies(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id         uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role_in_project text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE project_teams ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_teams FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_teams_app_tenant_iso ON project_teams
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX project_teams_company_id_idx ON project_teams (company_id);
--> statement-breakpoint
CREATE INDEX project_teams_project_id_idx ON project_teams (project_id);
--> statement-breakpoint
CREATE INDEX project_teams_team_id_idx ON project_teams (team_id);
--> statement-breakpoint
-- ⚠️ Composite UNIQUE dẫn đầu company_id (fix-forward, không mirror project_channels cũ).
CREATE UNIQUE INDEX project_teams_uq ON project_teams (company_id, project_id, team_id);
--> statement-breakpoint
-- project_teams: pure hard-DELETE link (role_in_project immutable; re-link để đổi) → KHÔNG cột status, KHÔNG UPDATE.
GRANT SELECT, INSERT, DELETE ON project_teams TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON project_teams TO mediaos_worker;
--> statement-breakpoint

-- ===== project_members (project ↔ user + role + workload — soft-delete) =====
CREATE TABLE project_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                     REFERENCES companies(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_project  text,
  permission_level text,
  workload_percent numeric(5,2),
  start_date       date,
  end_date         date,
  status           text NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
--> statement-breakpoint
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_members_app_tenant_iso ON project_members
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX project_members_company_id_idx ON project_members (company_id);
--> statement-breakpoint
CREATE INDEX project_members_project_id_idx ON project_members (project_id);
--> statement-breakpoint
CREATE INDEX project_members_user_id_idx ON project_members (user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX project_members_active_uq
  ON project_members (company_id, project_id, user_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE project_members ADD CONSTRAINT project_members_status_check
  CHECK (status IN ('active','inactive'));
--> statement-breakpoint
-- project_members có status mutable (active/inactive) + soft-delete → cần UPDATE.
GRANT SELECT, INSERT, UPDATE, DELETE ON project_members TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON project_members TO mediaos_worker;
