-- G4-2: channels, projects, project_channels, content_items — Media tối thiểu.
-- RLS + FORCE + soft-delete trên tất cả bảng.

-- -------- channels --------
CREATE TABLE channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
              REFERENCES companies (id) ON DELETE CASCADE,
  name        text NOT NULL,
  platform    text NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'facebook', 'instagram')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
--> statement-breakpoint
CREATE INDEX channels_company_id_idx ON channels (company_id);
--> statement-breakpoint
CREATE UNIQUE INDEX channels_company_name_active_uq ON channels (company_id, name) WHERE deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE channels FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY channels_tenant_isolation ON channels
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON channels TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON channels TO mediaos_worker;
--> statement-breakpoint

-- -------- projects --------
CREATE TABLE projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
               REFERENCES companies (id) ON DELETE CASCADE,
  org_unit_id  uuid REFERENCES org_units (id) ON DELETE SET NULL,
  name         text NOT NULL,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
--> statement-breakpoint
CREATE INDEX projects_company_id_idx  ON projects (company_id);
--> statement-breakpoint
CREATE INDEX projects_org_unit_id_idx ON projects (org_unit_id);
--> statement-breakpoint
CREATE UNIQUE INDEX projects_company_name_active_uq ON projects (company_id, name) WHERE deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY projects_tenant_isolation ON projects
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON projects TO mediaos_worker;
--> statement-breakpoint

-- -------- project_channels --------
CREATE TABLE project_channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
              REFERENCES companies (id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  channel_id  uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX project_channels_project_id_idx ON project_channels (project_id);
--> statement-breakpoint
CREATE INDEX project_channels_channel_id_idx ON project_channels (channel_id);
--> statement-breakpoint
CREATE UNIQUE INDEX project_channels_uq ON project_channels (project_id, channel_id);
--> statement-breakpoint
ALTER TABLE project_channels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_channels FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_channels_tenant_isolation ON project_channels
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON project_channels TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON project_channels TO mediaos_worker;
--> statement-breakpoint

-- -------- content_items --------
CREATE TABLE content_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
               REFERENCES companies (id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title        text NOT NULL,
  content_type text NOT NULL DEFAULT 'video' CHECK (content_type IN ('video', 'short', 'reel')),
  status       text NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'in_production', 'review', 'approved', 'published')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
--> statement-breakpoint
CREATE INDEX content_items_company_id_idx  ON content_items (company_id);
--> statement-breakpoint
CREATE INDEX content_items_project_id_idx  ON content_items (project_id);
--> statement-breakpoint
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE content_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY content_items_tenant_isolation ON content_items
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_items TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON content_items TO mediaos_worker;
