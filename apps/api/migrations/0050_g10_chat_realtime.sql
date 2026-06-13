-- Migration 0050: G10-1 — Chat realtime (mở rộng chat_rooms/_members/_messages + audit object_type).
--
-- LANE RULE (feat/g10-comms): dải file 0050–0059, journal when ≥ 1717500060000 (+1000 mỗi entry),
--   idx nối tiếp đỉnh journal TẠI THỜI ĐIỂM PHÁT HÀNH (sau G9 land = 38 → G10 bắt đầu 39).
--   Entry _journal.json ĐĂNG KÝ SAU rebase master (CHECKPOINT A) để tránh va idx với G9 (0040, idx 38).
--
-- KHÔNG tạo bảng chat_members/messages MỚI (TASKS.md liệt kê tên khác) — 0010 đã tạo
--   chat_room_members/chat_messages cùng chức năng. G10 MỞ RỘNG bằng ALTER (DRY + giữ RLS registry).
--
-- Append-only (BẤT BIẾN #2): body/sender của chat_messages BẤT BIẾN. G10 chỉ cấp UPDATE 2 cột ghim
--   (pinned_at, pinned_by) qua COLUMN-LEVEL GRANT — app role KHÔNG sửa được cột khác.
--
-- ⚠️ MERGE NOTE (audit CHECK): mở rộng audit_logs_object_type_chk bằng DO-block UNION (đọc def hiện hành
--   → union type mới → rebuild). Vì các lane G7/G9/G11 chạy SONG SONG cùng DB dev, KHÔNG dùng full-list
--   DROP+ADD (sẽ xoá type lane khác đã thêm). Union ⇒ luôn SUPERSET, an toàn mọi thứ tự áp. G11 (0060)
--   chạy sau cũng phải UNION (không full-list). Đồng bộ AUDIT_OBJECT_TYPES (db/schema/audit.ts) CÙNG commit.

-- ─────────────────────────────────────────────────────────────────────────────
-- chat_rooms: mở room_type + auto-room (channel/org_unit) + direct DM dedup
-- ─────────────────────────────────────────────────────────────────────────────
-- Drop CHECK room_type cũ (0010 inline → tên auto, có thể khác) bằng cách quét theo def.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'chat_rooms'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%room_type%'
  LOOP
    EXECUTE format('ALTER TABLE chat_rooms DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE chat_rooms
  ADD CONSTRAINT chat_rooms_room_type_chk
  CHECK (room_type IN ('project', 'direct', 'group', 'channel', 'department'));
--> statement-breakpoint
ALTER TABLE chat_rooms
  ADD COLUMN channel_id  uuid REFERENCES channels (id)  ON DELETE SET NULL,
  ADD COLUMN org_unit_id uuid REFERENCES org_units (id) ON DELETE SET NULL,
  ADD COLUMN direct_key  text,
  ADD COLUMN created_by  uuid REFERENCES users (id)     ON DELETE SET NULL;
--> statement-breakpoint
-- 1 channel ↔ 1 room (auto-room idempotent — G10-2)
CREATE UNIQUE INDEX chat_rooms_channel_uq  ON chat_rooms (company_id, channel_id)
  WHERE channel_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX chat_rooms_org_unit_uq ON chat_rooms (company_id, org_unit_id)
  WHERE org_unit_id IS NOT NULL;
--> statement-breakpoint
-- direct_key = 2 userId sort asc join ':' → DM 1-1 idempotent (POST /chat/direct)
CREATE UNIQUE INDEX chat_rooms_direct_uq   ON chat_rooms (company_id, direct_key)
  WHERE direct_key IS NOT NULL;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- chat_room_members: role (member/admin) + last_read_at + GRANT UPDATE 2 cột
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE chat_room_members
  ADD COLUMN role         text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  ADD COLUMN last_read_at timestamptz;
--> statement-breakpoint
-- App role được UPDATE role + last_read_at (đổi quyền/đánh dấu đã đọc). Trước đây chỉ SELECT/INSERT/DELETE.
GRANT UPDATE (role, last_read_at) ON chat_room_members TO mediaos_app;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- chat_messages: file/mentions/pin/seq. Append-only body/sender — UPDATE chỉ 2 cột ghim.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE chat_messages
  ADD COLUMN message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'file')),
  ADD COLUMN file_url     text,
  ADD COLUMN file_name    text,
  ADD COLUMN mentions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN pinned_at    timestamptz,
  ADD COLUMN pinned_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN seq          bigint GENERATED ALWAYS AS IDENTITY;
--> statement-breakpoint
-- seq = thứ tự tổng ổn định trong room (ordering chắc chắn hơn created_at khi cùng mốc thời gian).
CREATE INDEX chat_messages_room_seq_idx ON chat_messages (room_id, seq);
--> statement-breakpoint
CREATE INDEX chat_messages_pinned_idx   ON chat_messages (room_id, pinned_at)
  WHERE pinned_at IS NOT NULL;
--> statement-breakpoint
-- COLUMN-LEVEL GRANT: app role chỉ UPDATE được pinned_at/pinned_by — KHÔNG body/sender (append-only #2).
-- (Table-level vẫn chỉ SELECT, INSERT từ 0010 — không cấp UPDATE table-level.)
GRANT UPDATE (pinned_at, pinned_by) ON chat_messages TO mediaos_app;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_logs.object_type CHECK — UNION (superset) các type G10, an toàn cross-lane.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  current_def   text;
  existing_types text[];
  new_types     text[] := ARRAY[
    'chat_room', 'chat_message', 'notification',
    'notification_rule', 'notification_preference',
    'meeting', 'meeting_room'
  ];
  all_types     text[];
  type_list     text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_def
  FROM pg_constraint
  WHERE conname = 'audit_logs_object_type_chk'
    AND conrelid = 'audit_logs'::regclass;

  IF current_def IS NULL THEN
    RAISE EXCEPTION 'audit_logs_object_type_chk không tồn tại — abort (không tự ý tạo mới để tránh nuốt mất type lane khác)';
  END IF;

  -- Trích mọi literal trong dấu nháy đơn từ def (hỗ trợ cả "IN (...)" lẫn "= ANY (ARRAY[...])").
  -- $re$...$re$ = dollar-quote lồng → KHÔNG phải double nháy đơn trong pattern.
  SELECT array_agg(matches[1]) INTO existing_types
  FROM regexp_matches(current_def, $re$'([^']+)'$re$, 'g') AS matches;

  all_types := ARRAY(SELECT DISTINCT unnest(existing_types || new_types) ORDER BY 1);

  SELECT string_agg(quote_literal(t), ', ') INTO type_list FROM unnest(all_types) AS t;

  EXECUTE 'ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_object_type_chk';
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_object_type_chk CHECK (object_type IN (%s))',
    type_list
  );
END $$;
