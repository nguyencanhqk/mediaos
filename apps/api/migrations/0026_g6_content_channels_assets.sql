-- Migration 0026: G6-4c — CREATE content_channels (đăng đa kênh) + content_assets (version chain).
-- Bảng mới có company_id → RLS+FORCE policy TRƯỚC mọi insert (CLAUDE §3). Composite UNIQUE dẫn đầu
-- company_id (bất biến #2b). content_assets one-current uq WHERE is_current AND deleted_at IS NULL.

CREATE TABLE content_channels (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  content_item_id    uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  channel_id         uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  -- platform_id: snapshot publish-time. ON DELETE RESTRICT (nhất quán channels/platform_accounts FK).
  platform_id        uuid REFERENCES platforms(id) ON DELETE RESTRICT,
  publish_status     text,
  publish_url        text,
  planned_publish_at timestamptz,
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE content_channels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE content_channels FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY content_channels_app_tenant_iso ON content_channels
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX content_channels_company_id_idx ON content_channels (company_id);
--> statement-breakpoint
CREATE INDEX content_channels_content_id_idx ON content_channels (content_item_id);
--> statement-breakpoint
CREATE INDEX content_channels_publish_idx ON content_channels (company_id, channel_id, publish_status);
--> statement-breakpoint
-- ⚠️ Composite UNIQUE dẫn đầu company_id (bất biến #2b).
CREATE UNIQUE INDEX content_channels_uq ON content_channels (company_id, content_item_id, channel_id);
--> statement-breakpoint
ALTER TABLE content_channels ADD CONSTRAINT content_channels_publish_status_check CHECK (
  publish_status IS NULL OR publish_status IN
    ('not_scheduled','scheduled','publishing','published','failed','removed')
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_channels TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON content_channels TO mediaos_worker;
--> statement-breakpoint

-- ===== content_assets + version chain (ERD v2 §11) =====
CREATE TABLE content_assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                     REFERENCES companies(id) ON DELETE CASCADE,
  content_item_id  uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  asset_type       text,
  name             text,
  file_url         text,
  external_url     text,
  version          int  NOT NULL DEFAULT 1,
  version_group_id uuid NOT NULL,   -- nhóm version; v1 PHẢI = id (anchor, ép ở service)
  parent_asset_id  uuid REFERENCES content_assets(id) ON DELETE SET NULL,
  is_current       boolean NOT NULL DEFAULT true,
  superseded_by    uuid REFERENCES content_assets(id) ON DELETE SET NULL,
  uploaded_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
--> statement-breakpoint
ALTER TABLE content_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE content_assets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY content_assets_app_tenant_iso ON content_assets
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX content_assets_company_id_idx ON content_assets (company_id);
--> statement-breakpoint
CREATE INDEX content_assets_content_id_idx ON content_assets (content_item_id);
--> statement-breakpoint
CREATE INDEX content_assets_version_group_idx ON content_assets (version_group_id);
--> statement-breakpoint
-- ⚠️ ĐÚNG 1 version current/group + LOẠI soft-deleted (ERD v2 §11.2). Thiếu 'AND deleted_at IS NULL' →
-- row soft-deleted còn is_current=true sẽ chiếm slot, chặn promote version mới. Service PHẢI flip
-- is_current=false khi soft-delete bản current (cùng tx).
CREATE UNIQUE INDEX content_assets_one_current_uq
  ON content_assets (company_id, version_group_id) WHERE is_current AND deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE content_assets ADD CONSTRAINT content_assets_type_check CHECK (
  asset_type IS NULL OR asset_type IN
    ('script','voice','raw_video','edited_video','thumbnail','seo_document','reference','final_output')
);
--> statement-breakpoint
ALTER TABLE content_assets ADD CONSTRAINT content_assets_status_check
  CHECK (status IN ('active','archived'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_assets TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON content_assets TO mediaos_worker;
