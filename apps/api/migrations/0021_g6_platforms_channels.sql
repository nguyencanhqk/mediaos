-- Migration 0021: G6-1 — platforms (catalog GLOBAL) + ALTER channels (full) + channel_members.
-- RLS+FORCE TRƯỚC backfill company_id (GX-4). Mọi widen-CHECK trên bảng có dữ liệu PHẢI guard/backfill TRƯỚC ADD.

-- ===== platforms: catalog dùng chung, KHÔNG company_id, KHÔNG RLS tenant (ERD v1 §6.1). =====
CREATE TABLE platforms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  code        text NOT NULL,
  type        text,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX platforms_code_uq ON platforms (code);
--> statement-breakpoint
ALTER TABLE platforms ADD CONSTRAINT platforms_code_check
  CHECK (code IN ('youtube','tiktok','facebook','instagram','podcast','website'));
--> statement-breakpoint
ALTER TABLE platforms ADD CONSTRAINT platforms_status_check
  CHECK (status IN ('active','inactive'));
--> statement-breakpoint
-- GLOBAL catalog: app role chỉ đọc; ghi do migration/seed. KHÔNG FORCE RLS (không có company_id).
GRANT SELECT ON platforms TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON platforms TO mediaos_worker;
--> statement-breakpoint
INSERT INTO platforms (name, code, type) VALUES
  ('YouTube','youtube','video'), ('TikTok','tiktok','short'),
  ('Facebook','facebook','social'), ('Instagram','instagram','social'),
  ('Podcast','podcast','audio'), ('Website','website','web')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- ===== ALTER channels (G4-2 slice → ERD full) =====
ALTER TABLE channels
  ADD COLUMN platform_id        uuid REFERENCES platforms(id) ON DELETE RESTRICT,
  ADD COLUMN code               text,
  ADD COLUMN url                text,
  ADD COLUMN language           text,
  ADD COLUMN target_country     text,
  ADD COLUMN niche              text,
  ADD COLUMN channel_manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN primary_team_id    uuid REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN health_status      text,
  ADD COLUMN health_score       numeric(5,2),
  ADD COLUMN health_note        text;
--> statement-breakpoint
-- Backfill platform_id từ cột text 'platform' hiện có (CHECK cũ 0007: youtube/tiktok/facebook/instagram).
UPDATE channels c SET platform_id = p.id FROM platforms p WHERE p.code = c.platform;
--> statement-breakpoint
-- GUARD executable: nếu còn row platform_id NULL (code lệch / chưa seed) → abort với context.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM channels WHERE platform_id IS NULL AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'channels.platform_id backfill incomplete: % rows have NULL platform_id',
      (SELECT count(*) FROM channels WHERE platform_id IS NULL AND deleted_at IS NULL);
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE channels ALTER COLUMN platform_id SET NOT NULL;
--> statement-breakpoint
-- Widen status enum. OLD CHECK (0007) = ('active','inactive'). 'inactive' KHÔNG thuộc tập mới!
-- Reconcile 'inactive' -> 'paused' (kênh tắt tạm) TRƯỚC khi ADD CONSTRAINT. Áp cho mọi row (kể cả soft-deleted).
ALTER TABLE channels DROP CONSTRAINT channels_status_check;
--> statement-breakpoint
UPDATE channels SET status = 'paused' WHERE status = 'inactive';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM channels
             WHERE status NOT IN ('active','testing','paused','stopped','archived')) THEN
    RAISE EXCEPTION 'channels.status has values outside new enum: %',
      (SELECT string_agg(DISTINCT status, ',') FROM channels
       WHERE status NOT IN ('active','testing','paused','stopped','archived'));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE channels ADD CONSTRAINT channels_status_check
  CHECK (status IN ('active','testing','paused','stopped','archived'));
--> statement-breakpoint
ALTER TABLE channels ADD CONSTRAINT channels_health_status_check
  CHECK (health_status IS NULL OR health_status IN
    ('healthy','watching','declining','risk','paused','stopped'));
--> statement-breakpoint
-- Legacy 'platform' text (0007 CHECK = 4 code) phải mirror platform_id; catalog mới có 6 (podcast/website).
-- Widen để 'platform' nhận đủ 6 code (fix-forward; cột text DROP ở 0029). Rollback podcast/website = lossy (đã ghi chú §12).
ALTER TABLE channels DROP CONSTRAINT channels_platform_check;
--> statement-breakpoint
ALTER TABLE channels ADD CONSTRAINT channels_platform_check
  CHECK (platform IN ('youtube','tiktok','facebook','instagram','podcast','website'));
--> statement-breakpoint
-- Giữ cột text 'platform' tạm cho rollback an toàn; DROP ở migration dọn sau (0029, ngoài G6).
-- Partial unique code: app PHẢI normalize '' -> NULL ở boundary (code='' KHÔNG bị skip bởi code IS NOT NULL).
CREATE UNIQUE INDEX channels_company_code_active_uq
  ON channels (company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
--> statement-breakpoint
CREATE INDEX channels_platform_id_idx ON channels (platform_id);
--> statement-breakpoint
CREATE INDEX channels_manager_idx ON channels (company_id, channel_manager_id);
--> statement-breakpoint
CREATE INDEX channels_company_status_idx ON channels (company_id, status);
--> statement-breakpoint

-- ===== channel_members (NEW) =====
CREATE TABLE channel_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                     REFERENCES companies(id) ON DELETE CASCADE,
  channel_id       uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_channel  text,
  permission_level text,
  joined_at        timestamptz,
  left_at          timestamptz,
  status           text NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
--> statement-breakpoint
ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE channel_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY channel_members_tenant_isolation ON channel_members
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX channel_members_company_id_idx ON channel_members (company_id);
--> statement-breakpoint
CREATE INDEX channel_members_channel_id_idx ON channel_members (channel_id);
--> statement-breakpoint
CREATE INDEX channel_members_user_id_idx ON channel_members (user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX channel_members_active_uq
  ON channel_members (company_id, channel_id, user_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE channel_members
  ADD CONSTRAINT channel_members_role_check CHECK (
    role_in_channel IS NULL OR role_in_channel IN
      ('channel_manager','seo','uploader','content_lead','production_lead','finance_viewer','qa')
  ),
  ADD CONSTRAINT channel_members_status_check CHECK (status IN ('active','inactive'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON channel_members TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON channel_members TO mediaos_worker;
