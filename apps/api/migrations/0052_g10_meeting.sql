-- Migration 0052: G10-4 — Meeting rooms + meetings (đặt/sửa/huỷ lịch họp, double-booking guard, RLS/FORCE).
--
-- LANE: G10 band 0050–0059. Journal: idx=62, when=1717500125000 (> max 1717500124000 idx=61).
-- Phụ thuộc: 0051 (notification đã land), bảng companies/users từ 0002.
--
-- Bất biến (CLAUDE.md §2):
--   1. company_id MỌI bảng — RLS + FORCE trước backfill.
--   2. soft-delete: deleted_at (KHÔNG hard-delete meetings).
--   3. audit_logs CHECK mở rộng bằng DO-block UNION (không DROP+ADD — only ADD new types).
--   4. 'meeting' + 'meeting_room' ĐÃ có trong union (mig 0050) — DO-block guard chỉ ADD nếu thiếu.
-- Double-booking guard: EXCLUDE USING gist (meeting_room_id WITH =, tstzrange WITH &&) — overlap protection.
-- Hot-file rule (TASKS §5.3): audit union = DO-block idempotent, permission seed ON CONFLICT DO NOTHING.

-- ─────────────────────────────────────────────────────────────────────────────
-- btree_gist: cần cho EXCLUDE USING gist kết hợp uuid = và tstzrange &&.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- meeting_rooms — phòng họp vật lý hoặc ảo trong công ty
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE meeting_rooms (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL
                            DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                            REFERENCES companies (id) ON DELETE CASCADE,
  name          text        NOT NULL,
  location      text,
  capacity      int,
  is_virtual    boolean     NOT NULL DEFAULT false,
  metadata      jsonb       NOT NULL DEFAULT '{}',
  created_by    uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
--> statement-breakpoint

CREATE INDEX meeting_rooms_company_idx ON meeting_rooms (company_id);
--> statement-breakpoint
-- Partial index on active rooms (deleted_at IS NULL) — cho query phổ biến.
CREATE INDEX meeting_rooms_active_idx  ON meeting_rooms (company_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- RLS TRƯỚC backfill (CLAUDE.md §3)
ALTER TABLE meeting_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_rooms FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY meeting_rooms_tenant ON meeting_rooms
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON meeting_rooms TO mediaos_app;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- meetings — cuộc họp (đặt lịch, sửa, huỷ bằng soft-delete)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE meetings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL
                              DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                              REFERENCES companies (id) ON DELETE CASCADE,
  meeting_room_id uuid        REFERENCES meeting_rooms (id) ON DELETE SET NULL,
  title           text        NOT NULL,
  description     text,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  organizer_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status          text        NOT NULL DEFAULT 'scheduled'
                              CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  agenda          jsonb       NOT NULL DEFAULT '[]',
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT meetings_time_order CHECK (ends_at > starts_at)
);
--> statement-breakpoint

CREATE INDEX meetings_company_idx    ON meetings (company_id);
--> statement-breakpoint
CREATE INDEX meetings_organizer_idx  ON meetings (company_id, organizer_id);
--> statement-breakpoint
CREATE INDEX meetings_starts_at_idx  ON meetings (company_id, starts_at);
--> statement-breakpoint
-- Support index for double-booking query (room + active + time range).
CREATE INDEX meetings_room_time_idx  ON meetings (meeting_room_id, starts_at, ends_at)
  WHERE deleted_at IS NULL AND status != 'cancelled';
--> statement-breakpoint

-- Double-booking guard — EXCLUDE constraint (NOT a unique index).
-- EXCLUDE USING gist: meeting_room_id WITH = (same room) + tstzrange overlap WITH &&.
-- [starts_at, ends_at): end-exclusive → 10:00–11:00 and 11:00–12:00 do NOT conflict.
-- Predicate: only active, non-cancelled meetings (partial — consistent with application logic).
ALTER TABLE meetings ADD CONSTRAINT meetings_no_room_overlap_excl
  EXCLUDE USING gist (
    meeting_room_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (meeting_room_id IS NOT NULL AND deleted_at IS NULL AND status != 'cancelled');
--> statement-breakpoint

-- RLS TRƯỚC backfill
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY meetings_tenant ON meetings
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON meetings TO mediaos_app;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- meeting_attendees — danh sách người tham dự (tenant-scoped)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE meeting_attendees (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL
                          DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                          REFERENCES companies (id) ON DELETE CASCADE,
  meeting_id  uuid        NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rsvp        text        NOT NULL DEFAULT 'pending'
                          CHECK (rsvp IN ('pending', 'accepted', 'declined')),
  joined_at   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX meeting_attendees_meeting_idx ON meeting_attendees (meeting_id);
--> statement-breakpoint
CREATE INDEX meeting_attendees_user_idx    ON meeting_attendees (company_id, user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX meeting_attendees_uq   ON meeting_attendees (meeting_id, user_id);
--> statement-breakpoint

ALTER TABLE meeting_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_attendees FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY meeting_attendees_tenant ON meeting_attendees
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_attendees TO mediaos_app;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger cho meetings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION meetings_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER meetings_updated_at_trg
  BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION meetings_set_updated_at();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_logs CHECK — ADD-only idempotent DO-block (không DROP+ADD, an toàn song song).
-- 'meeting' + 'meeting_room' ĐÃ có trong union từ mig 0050.
-- Pattern: đọc constraint def thật, tính UNION với new types, DROP+ADD ONLY khi thiếu.
-- Nếu tất cả types đã có → không làm gì (idempotent, không gián đoạn).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['meeting', 'meeting_room'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RETURN;  -- constraint không tồn tại, skip
  END IF;

  -- Đọc danh sách types hiện tại từ định nghĩa constraint thật
  v_def := pg_get_constraintdef(v_oid);
  SELECT array_agg(m[1]) INTO v_cur
    FROM (
      SELECT regexp_matches(v_def, '''([^'']+)''', 'g') AS m
    ) sub;

  -- Tính phần cần thêm (types trong v_new mà chưa có trong v_cur)
  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  -- Nếu tất cả types đã có → idempotent, không làm gì
  IF v_add IS NULL OR array_length(v_add, 1) = 0 THEN
    RETURN;
  END IF;

  -- Tính UNION đầy đủ
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  -- DROP + ADD với union đầy đủ (safe vì chỉ ADD types, không bao giờ XÓA type cũ)
  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
END;
$$;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Permission seed — meeting.* (ON CONFLICT DO NOTHING = idempotent, hot-file safe)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive)
VALUES
  ('view',   'meeting',      false),
  ('create', 'meeting',      false),
  ('update', 'meeting',      false),
  ('cancel', 'meeting',      false),
  ('view',   'meeting_room', false),
  ('manage', 'meeting_room', false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint
