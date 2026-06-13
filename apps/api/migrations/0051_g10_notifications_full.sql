-- Migration 0051: G10-2 — Notification rules + preferences (tenant-iso + RLS/FORCE).
--
-- LANE: G10 band 0050–0059. Journal: idx=57, when=1717500113000.
-- Phụ thuộc: 0050 (chat realtime đã land), bảng companies/users từ 0002.
--
-- Bất biến:
--   • RLS + FORCE RLS TRƯỚC backfill company_id (CLAUDE.md §3).
--   • notification_rules là append-only (BẤT BIẾN #2) — app role chỉ INSERT/SELECT.
--   • notification_preferences cho phép UPDATE enabled (user tự tắt/bật) nhưng KHÔNG DELETE.
--   • audit_logs CHECK mở rộng bằng DO-block UNION (không DROP+ADD) — an toàn song song nhiều lane.

-- ─────────────────────────────────────────────────────────────────────────────
-- notification_rules — quy tắc phát notification company-wide
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE notification_rules (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                               REFERENCES companies (id) ON DELETE CASCADE,
  notification_type text       NOT NULL,
  enabled          boolean     NOT NULL DEFAULT true,
  config           jsonb       NOT NULL DEFAULT '{}',
  created_by       uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_rules_type_chk CHECK (notification_type IN (
    'task_assigned','task_submitted','approval_requested','approved',
    'revision_requested','mentioned','general',
    'chat_message','meeting_invited','meeting_action_assigned'
  ))
);
--> statement-breakpoint
CREATE INDEX notification_rules_company_idx   ON notification_rules (company_id);
--> statement-breakpoint
CREATE UNIQUE INDEX notification_rules_company_type_uq ON notification_rules (company_id, notification_type);
--> statement-breakpoint

-- RLS
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_rules_tenant ON notification_rules
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- Append-only: app role KHÔNG UPDATE/DELETE (BẤT BIẾN #2)
REVOKE UPDATE, DELETE ON notification_rules FROM mediaos_app;
--> statement-breakpoint
GRANT INSERT, SELECT ON notification_rules TO mediaos_app;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- notification_preferences — user-level opt-in/out (ghi đè rule company)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE notification_preferences (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                                REFERENCES companies (id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  notification_type text        NOT NULL,
  enabled           boolean     NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_type_chk CHECK (notification_type IN (
    'task_assigned','task_submitted','approval_requested','approved',
    'revision_requested','mentioned','general',
    'chat_message','meeting_invited','meeting_action_assigned'
  ))
);
--> statement-breakpoint
CREATE INDEX notification_preferences_user_idx ON notification_preferences (company_id, user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX notification_preferences_user_type_uq
  ON notification_preferences (company_id, user_id, notification_type);
--> statement-breakpoint

-- RLS
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_preferences_tenant ON notification_preferences
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- User tự UPDATE enabled (opt-in/opt-out) nhưng KHÔNG DELETE hàng của mình
REVOKE DELETE ON notification_preferences FROM mediaos_app;
--> statement-breakpoint
GRANT INSERT, SELECT, UPDATE (enabled, updated_at) ON notification_preferences TO mediaos_app;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_logs CHECK: 'notification' / 'notification_rule' / 'notification_preference'
-- ĐÃ CÓ SẴN trong union audit_object_types của master (các migration audit g8/g12).
-- KHÔNG rebuild CHECK ở đây: DROP+ADD động trước đây vừa làm HỎNG CHECK (nuốt cả
-- constraint def cũ thành 1 phần tử mảng) vừa vi phạm hot-file append-only (TASKS.md §5.3).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Permission seed (ON CONFLICT DO NOTHING — idempotent, không ghi đè)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('read',      'notification',            false),
  ('mark_read', 'notification',            false),
  ('write',     'notification_preference', false),
  ('read',      'notification_rule',       false),
  ('write',     'notification_rule',       false)
ON CONFLICT (action, resource_type) DO NOTHING;
