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
-- audit_logs CHECK — mở rộng bằng DO-block UNION (an toàn song song nhiều lane)
-- Audit types notification/notification_rule/notification_preference đã có trong
-- AUDIT_OBJECT_TYPES (audit.ts) và trong migration 0050 (chat_room/chat_message
-- cùng nhóm). Kiểm tra lại và đảm bảo 3 type mới vào CHECK.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  _cur  text;
  _vals text[];
  _new  text[] := ARRAY[
    'notification_rule',
    'notification_preference'
  ];
  _v    text;
  _sql  text;
BEGIN
  -- Đọc CHECK def hiện hành của audit_logs_object_type_chk
  SELECT pg_get_constraintdef(oid)
    INTO _cur
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass
     AND conname  = 'audit_logs_object_type_chk';

  IF _cur IS NULL THEN
    RETURN; -- constraint chưa tồn tại (môi trường fresh không có 0003) — bỏ qua
  END IF;

  -- Trích danh sách giá trị hiện tại từ def dạng: CHECK (object_type = ANY (ARRAY['a','b',...]))
  SELECT array_agg(trim(v, $q$'$q$)) INTO _vals
    FROM regexp_split_to_table(_cur, ',') AS v
   WHERE v LIKE $q$%'%$q$;

  -- UNION với _new (dedup)
  FOREACH _v IN ARRAY _new LOOP
    IF NOT (_v = ANY(_vals)) THEN
      _vals := array_append(_vals, _v);
    END IF;
  END LOOP;

  -- DROP + ADD với tập đầy đủ
  ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_object_type_chk;

  _sql := 'ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_object_type_chk CHECK (object_type = ANY (ARRAY['''
        || array_to_string(_vals, ''',''')
        || ''']::text[]))';
  EXECUTE _sql;
END $$;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Permission seed (ON CONFLICT DO NOTHING — idempotent, không ghi đè)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (name, description) VALUES
  ('notification:read',        'Đọc notification của chính mình'),
  ('notification:mark_read',   'Đánh dấu đã đọc notification'),
  ('notification_pref:write',  'Cập nhật notification preference của chính mình'),
  ('notification_rule:read',   'Đọc notification rule (admin)'),
  ('notification_rule:write',  'Tạo/sửa notification rule (admin)')
ON CONFLICT (name) DO NOTHING;
