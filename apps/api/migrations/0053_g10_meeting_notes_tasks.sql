-- Migration 0053: G10-4 — Meeting notes (biên bản) + meeting_tasks (link sang Task Hub G9).
--
-- LANE: G10 band 0050–0059. Journal: idx=65, when=1717500128000 (> max 1717500127000 idx=64).
-- Phụ thuộc: 0052 (meetings đã land), 0040 (tasks G9-1 mở CHECK task_type → 'meeting_action').
--
-- Bất biến (CLAUDE.md §2):
--   1. company_id MỌI bảng — RLS + FORCE trước backfill.
--   2. meeting_notes UPDATE được nhưng KHÔNG hard-delete (app role không có DELETE grant).
--      meeting_tasks chỉ INSERT/SELECT/DELETE (link table — unlink được, không UPDATE).
--   3. audit_logs CHECK mở rộng bằng DO-block UNION (chỉ ADD 'meeting_note', không DROP type khác).
-- BẤT BIẾN #4 (Task Hub hợp nhất): action-item sau họp KHÔNG có bảng task riêng — sống ở `tasks`
--   (task_type='meeting_action'); meeting_tasks CHỈ liên kết meeting_id ↔ task_id (unique cặp).

-- ─────────────────────────────────────────────────────────────────────────────
-- meeting_notes — biên bản cuộc họp (sửa được, không xoá)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE meeting_notes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL
                              DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                              REFERENCES companies (id) ON DELETE CASCADE,
  meeting_id      uuid        NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  author_user_id  uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body            text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX meeting_notes_meeting_idx ON meeting_notes (meeting_id);
--> statement-breakpoint
CREATE INDEX meeting_notes_company_idx ON meeting_notes (company_id);
--> statement-breakpoint

-- RLS TRƯỚC backfill (CLAUDE.md §3)
ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY meeting_notes_tenant ON meeting_notes
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- KHÔNG cấp DELETE (bất biến #2: biên bản sửa được, không xoá cứng).
GRANT SELECT, INSERT, UPDATE ON meeting_notes TO mediaos_app;
--> statement-breakpoint

-- updated_at trigger (tái dùng function meetings_set_updated_at đã tạo ở 0052).
CREATE TRIGGER meeting_notes_updated_at_trg
  BEFORE UPDATE ON meeting_notes
  FOR EACH ROW EXECUTE FUNCTION meetings_set_updated_at();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- meeting_tasks — LINK meeting ↔ task (action-item sau họp trong Task Hub G9)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE meeting_tasks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL
                          DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                          REFERENCES companies (id) ON DELETE CASCADE,
  meeting_id  uuid        NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  task_id     uuid        NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX meeting_tasks_meeting_idx ON meeting_tasks (meeting_id);
--> statement-breakpoint
CREATE INDEX meeting_tasks_company_idx ON meeting_tasks (company_id);
--> statement-breakpoint
-- Idempotent link: một task chỉ gắn một lần vào một meeting.
CREATE UNIQUE INDEX meeting_tasks_uq ON meeting_tasks (meeting_id, task_id);
--> statement-breakpoint

ALTER TABLE meeting_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY meeting_tasks_tenant ON meeting_tasks
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON meeting_tasks TO mediaos_app;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_logs CHECK — ADD-only idempotent DO-block (chỉ thêm 'meeting_note', an toàn song song).
-- Pattern y hệt 0052: đọc constraint def thật, UNION với type mới, DROP+ADD CHỈ khi thiếu.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['meeting_note'];
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
  SELECT array_agg(m[1]) INTO v_cur
    FROM (
      SELECT regexp_matches(v_def, '''([^'']+)''', 'g') AS m
    ) sub;

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
--> statement-breakpoint
