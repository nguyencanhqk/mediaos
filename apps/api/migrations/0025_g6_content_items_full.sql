-- Migration 0025: G6-4b — ALTER content_items (content_type text → content_type_id FK + cols +
-- production_status) — DATA MIGRATION + CHECK reconcile. 🔴 breaking.
-- Thứ tự bắt buộc: ADD cols → seed content_types (NOT EXISTS) → backfill content_type_id →
-- GUARD NULL → production_status/priority CHECK + backfill → DROP CHECK + cột text content_type.

-- BƯỚC 1: thêm content_type_id + cột mới (chưa drop cột text 'content_type').
ALTER TABLE content_items
  ADD COLUMN content_type_id    uuid REFERENCES content_types(id) ON DELETE SET NULL,
  ADD COLUMN code               text,
  ADD COLUMN description        text,
  ADD COLUMN owner_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN main_channel_id    uuid REFERENCES channels(id) ON DELETE SET NULL,
  ADD COLUMN language           text,
  ADD COLUMN production_status  text,
  ADD COLUMN planned_publish_at timestamptz,
  ADD COLUMN published_at       timestamptz,
  ADD COLUMN final_url          text,
  ADD COLUMN thumbnail_url      text,
  ADD COLUMN script_url         text,
  ADD COLUMN video_file_url     text,
  ADD COLUMN priority           text;
--> statement-breakpoint
-- BƯỚC 2: seed content_types tối thiểu cho các code đang có ('video'/'short'/'reel') theo từng company.
-- ⚠️ content_types CHỈ có PARTIAL unique (content_types_company_code_active_uq WHERE deleted_at IS NULL
--   AND code IS NOT NULL). ON CONFLICT KHÔNG target được partial index (cần arbiter cụ thể) → dùng
--   NOT EXISTS guard (an toàn partial index, idempotent).
INSERT INTO content_types (company_id, name, code)
SELECT DISTINCT c.company_id, x.name, x.code
FROM content_items c
CROSS JOIN (VALUES ('Video dài','video_long'),('YouTube Short','youtube_short'),('Social Post','social_post'))
  AS x(name, code)
WHERE NOT EXISTS (
  SELECT 1 FROM content_types ct
  WHERE ct.company_id = c.company_id AND ct.code = x.code AND ct.deleted_at IS NULL
);
--> statement-breakpoint
-- BƯỚC 3: backfill content_type_id (join 1:1 per (company_id, code) — đảm bảo bởi partial unique).
UPDATE content_items ci SET content_type_id = ct.id
FROM content_types ct
WHERE ct.company_id = ci.company_id
  AND ct.deleted_at IS NULL
  AND ct.code = CASE ci.content_type
        WHEN 'video' THEN 'video_long'
        WHEN 'short' THEN 'youtube_short'
        WHEN 'reel'  THEN 'social_post' END;
--> statement-breakpoint
-- ⚠️ GUARD (executable): mọi content_items chưa soft-delete PHẢI có content_type_id.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM content_items WHERE content_type_id IS NULL AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'content_items.content_type_id backfill incomplete: % rows (unmapped content_type)',
      (SELECT count(*) FROM content_items WHERE content_type_id IS NULL AND deleted_at IS NULL);
  END IF;
END $$;
--> statement-breakpoint
-- BƯỚC 4: production_status (10-value, TÁCH khỏi 'status' workflow-lite). CHECK cho NULL OR in-set →
-- ADD trước backfill OK (rows hiện toàn NULL). Sau đó backfill từ status cũ.
ALTER TABLE content_items ADD CONSTRAINT content_items_production_status_check CHECK (
  production_status IS NULL OR production_status IN
    ('idea','planning','in_production','waiting_review','revision','approved',
     'scheduled','published','analyzed','cancelled')
);
--> statement-breakpoint
UPDATE content_items SET production_status = CASE status
  WHEN 'draft' THEN 'idea' WHEN 'in_production' THEN 'in_production'
  WHEN 'review' THEN 'waiting_review' WHEN 'approved' THEN 'approved'
  WHEN 'published' THEN 'published' ELSE 'idea' END
WHERE production_status IS NULL;
--> statement-breakpoint
ALTER TABLE content_items ADD CONSTRAINT content_items_priority_check
  CHECK (priority IS NULL OR priority IN ('low','medium','high','urgent'));
--> statement-breakpoint
-- BƯỚC 5: DROP cột text 'content_type' + CHECK cũ. Giữ 'status' cũ (workflow-lite).
-- ⚠️ Tên CHECK DB thật = 'content_items_content_type_check' (Postgres auto-name từ inline unnamed CHECK
--   0007) — verified live qua pg_constraint. KHÔNG phải 'content_items_type_check' (tên Drizzle cosmetic,
--   không nằm trong DB vì migration là raw SQL).
ALTER TABLE content_items DROP CONSTRAINT content_items_content_type_check;
--> statement-breakpoint
ALTER TABLE content_items DROP COLUMN content_type;
--> statement-breakpoint
CREATE UNIQUE INDEX content_items_company_code_active_uq
  ON content_items (company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
--> statement-breakpoint
CREATE INDEX content_items_content_type_id_idx ON content_items (content_type_id);
--> statement-breakpoint
CREATE INDEX content_items_main_channel_idx
  ON content_items (company_id, main_channel_id, production_status);
--> statement-breakpoint
CREATE INDEX content_items_project_status_idx
  ON content_items (company_id, project_id, status);
