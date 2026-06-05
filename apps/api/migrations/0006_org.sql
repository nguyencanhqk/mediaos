-- G4-1: org_units, teams, team_members — Org/Employee tối thiểu.
-- RLS invariant: company_id = current_setting('app.current_company_id')::uuid + FORCE ROW LEVEL SECURITY.
-- Soft-delete only (deleted_at) — bất biến #2.

-- -------- org_units --------
CREATE TABLE org_units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
              REFERENCES companies (id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES org_units (id) ON DELETE SET NULL,
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'department' CHECK (type IN ('department', 'division')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
--> statement-breakpoint

CREATE INDEX org_units_company_id_idx  ON org_units (company_id);
--> statement-breakpoint
CREATE INDEX org_units_parent_id_idx   ON org_units (parent_id);
--> statement-breakpoint
CREATE UNIQUE INDEX org_units_company_name_active_uq ON org_units (company_id, name) WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE org_units ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE org_units FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY org_units_tenant_isolation ON org_units
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON org_units TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON org_units TO mediaos_worker;
--> statement-breakpoint

-- -------- teams --------
CREATE TABLE teams (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
               REFERENCES companies (id) ON DELETE CASCADE,
  org_unit_id  uuid REFERENCES org_units (id) ON DELETE SET NULL,
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
--> statement-breakpoint

CREATE INDEX teams_company_id_idx  ON teams (company_id);
--> statement-breakpoint
CREATE INDEX teams_org_unit_id_idx ON teams (org_unit_id);
--> statement-breakpoint
CREATE UNIQUE INDEX teams_company_name_active_uq ON teams (company_id, name) WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE teams FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY teams_tenant_isolation ON teams
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON teams TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON teams TO mediaos_worker;
--> statement-breakpoint

-- -------- team_members --------
CREATE TABLE team_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
              REFERENCES companies (id) ON DELETE CASCADE,
  team_id     uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_name   text NOT NULL DEFAULT 'member',
  joined_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
--> statement-breakpoint

CREATE INDEX team_members_company_id_idx ON team_members (company_id);
--> statement-breakpoint
CREATE INDEX team_members_team_id_idx    ON team_members (team_id);
--> statement-breakpoint
CREATE INDEX team_members_user_id_idx    ON team_members (user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX team_members_team_user_active_uq ON team_members (team_id, user_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE team_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY team_members_tenant_isolation ON team_members
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON team_members TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON team_members TO mediaos_worker;
