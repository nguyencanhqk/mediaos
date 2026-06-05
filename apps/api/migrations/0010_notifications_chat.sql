-- Migration 0010: notifications + chat (G4-6)
-- notifications: thông báo người dùng (append-only từ phía app — chỉ UPDATE is_read).
-- chat_rooms, chat_room_members, chat_messages: chat phòng/nhóm theo project.
-- chat_messages là append-only thật sự (app role chỉ INSERT — bất biến #2).
-- RLS + FORCE + grants trên mọi bảng.

-- ─────────────────────────────────────────────────────────────────────────────
-- notifications
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
              REFERENCES companies (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        text NOT NULL DEFAULT 'general',
  ref_id      uuid,
  ref_type    text,
  body        text NOT NULL,
  is_read     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX notifications_company_id_idx   ON notifications (company_id);
--> statement-breakpoint
CREATE INDEX notifications_user_id_idx      ON notifications (user_id);
--> statement-breakpoint
CREATE INDEX notifications_user_unread_idx  ON notifications (user_id, is_read);
--> statement-breakpoint
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_tenant_isolation ON notifications
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- App role có UPDATE (đánh is_read), KHÔNG DELETE (append-only).
GRANT SELECT, INSERT, UPDATE ON notifications TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON notifications TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- chat_rooms
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE chat_rooms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
              REFERENCES companies (id) ON DELETE CASCADE,
  ref_id      uuid REFERENCES projects (id) ON DELETE SET NULL,
  room_type   text NOT NULL DEFAULT 'project' CHECK (room_type IN ('project', 'direct')),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX chat_rooms_company_id_idx ON chat_rooms (company_id);
--> statement-breakpoint
CREATE INDEX chat_rooms_ref_id_idx     ON chat_rooms (ref_id);
--> statement-breakpoint
-- 1 project chỉ có 1 phòng chat project
CREATE UNIQUE INDEX chat_rooms_project_uq ON chat_rooms (company_id, ref_id)
  WHERE ref_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE chat_rooms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_rooms FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_rooms_tenant_isolation ON chat_rooms
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_rooms TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON chat_rooms TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- chat_room_members
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE chat_room_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
              REFERENCES companies (id) ON DELETE CASCADE,
  room_id     uuid NOT NULL REFERENCES chat_rooms (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX chat_room_members_room_id_idx  ON chat_room_members (room_id);
--> statement-breakpoint
CREATE INDEX chat_room_members_user_id_idx  ON chat_room_members (user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX chat_room_members_room_user_uq ON chat_room_members (room_id, user_id);
--> statement-breakpoint
ALTER TABLE chat_room_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_room_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_room_members_tenant_isolation ON chat_room_members
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON chat_room_members TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON chat_room_members TO mediaos_worker;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- chat_messages  (append-only — app role chỉ INSERT, không UPDATE/DELETE)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
              REFERENCES companies (id) ON DELETE CASCADE,
  room_id     uuid NOT NULL REFERENCES chat_rooms (id) ON DELETE CASCADE,
  sender_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX chat_messages_room_id_idx     ON chat_messages (room_id);
--> statement-breakpoint
CREATE INDEX chat_messages_company_id_idx  ON chat_messages (company_id);
--> statement-breakpoint
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY chat_messages_tenant_isolation ON chat_messages
  USING  (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- Append-only: không UPDATE/DELETE (bất biến #2 cho message history)
GRANT SELECT, INSERT ON chat_messages TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON chat_messages TO mediaos_worker;
