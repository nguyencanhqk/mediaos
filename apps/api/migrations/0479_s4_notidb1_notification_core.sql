-- Migration 0479: S4-NOTI-DB-1 (🔴 RED, zone=red, crown) — NOTI Core (DB-07 §7.1–7.4).
--
-- MỤC TIÊU (plan docs/plans/S4-NOTI-DB-1.md — Option-A evolve-additive, mirror TASK 0478):
--   (A) BUILD 3 bảng MỚI DB-07 (bắt buộc MVP):
--       • notification_events    — DANH MỤC event. company_id NULLABLE (NULL = global; NOT NULL = company
--         override). RLS+FORCE + policy NULLABLE-TENANT (mẫu 0434 sequences/holidays: USING company_id=GUC
--         OR IS NULL / WITH CHECK company_id=GUC). GRANT app SELECT-only (write company-override → NOTI-BE-3).
--       • notification_templates — TEMPLATE nội dung theo event/kênh/ngôn ngữ. company_id NULLABLE (như trên).
--         FK event_id → notification_events. RLS+FORCE nullable-tenant. GRANT app SELECT-only.
--       • notification_delivery_logs — LOG gửi theo kênh. company_id NOT NULL. RLS+FORCE + policy literal-GUC
--         (mirror 0478:64-66). APPEND-ONLY (BẤT BIẾN #2): GRANT SELECT,INSERT app — KHÔNG UPDATE/DELETE.
--         Retry = INSERT hàng attempt_no MỚI (KHÔNG update in-place). GRANT SELECT worker.
--   (B) ALTER-ADD (additive, MỌI cột NULLABLE) trên notifications (mig 0010 media-era) theo DB-07 §7.3.
--       GIỮ NGUYÊN cột legacy user_id/type/ref_id/ref_type/body(NOT NULL)/is_read + policy
--       notifications_tenant_isolation + RLS+FORCE + grant SELECT,INSERT,UPDATE (đã có 0010 — KHÔNG đụng).
--       CHECK status enum tên MỚI cho phép NULL. KHÔNG backfill (legacy service còn dùng is_read/body —
--       cut-over sang cột mới = S4-NOTI-BE-1, OUT-OF-SCOPE WO này).
--
-- ⚠️ BẢN ĐỒ TÊN DB-07 → QUAN HỆ THẬT: employees(id) → employee_profiles(id). users/companies/notifications tồn tại.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 RLS+FORCE + POLICY TẠO TRƯỚC mọi INSERT/backfill. events/templates nullable-tenant (company NULL = global,
--      chỉ ĐỌC dạng dùng-chung, KHÔNG rò dữ liệu tenant khác — mọi row tenant-scoped vẫn lọc đúng company_id;
--      ghi global = seed/admin qua table-owner, KHÔNG qua app role). delivery_logs company_id NOT NULL DEFAULT
--      NULLIF(current_setting(...))::uuid. Policy tương thích set_config PgBouncer txn-mode.
--   #2 notification_delivery_logs APPEND-ONLY: GRANT SELECT,INSERT — KHÔNG UPDATE/DELETE. KHÔNG deleted_at
--      (append-only, không soft-delete). notifications KHÔNG append-only (mark-read/hidden/archived = UPDATE).
--   #5 UUID PK · timestamptz UTC-at-rest (ADR-0008) · soft-delete deleted_at/by (KHÔNG hard-delete).
--   • DDL thủ công (RLS/grant/CHECK/partial-index không biểu diễn được bằng Drizzle) — KHÔNG db:generate.
--   • payload KHÔNG chứa dữ liệu nhạy cảm (DB-07 §4.6) — ép ở tầng service (NOTI-BE), không ở DDL.
--
-- BAND 0479 (lane S4-NOTI-DB-1). Journal: idx 159, when 1717500790000 (> head 0478 idx 158 / 1717500785000).
--   Nối tiếp ĐƠN ĐIỆU sau 0478_s4_taskdb1_task_core.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── 1. notification_events (DB-07 §7.1 — danh mục event; company_id NULLABLE) ───────────────
CREATE TABLE IF NOT EXISTS notification_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULLABLE: NULL = global event (dùng chung), NOT NULL = company override. KHÔNG default current_setting
  -- (global cần ghi NULL tường minh qua đường system/owner; app role chỉ ghi row tenant qua WITH CHECK).
  company_id             uuid REFERENCES companies(id) ON DELETE CASCADE,
  module_code            varchar(50) NOT NULL,
  event_code             varchar(100) NOT NULL,
  event_name             varchar(255) NOT NULL,
  description            text,
  notification_type      varchar(50) NOT NULL,
  default_priority       varchar(50) NOT NULL DEFAULT 'Normal',
  default_channels       jsonb NOT NULL DEFAULT '["IN_APP"]'::jsonb,
  recipient_rule_config  jsonb,
  dedupe_strategy        varchar(50) NOT NULL DEFAULT 'None',
  dedupe_window_seconds  integer,
  throttle_config        jsonb,
  is_enabled             boolean NOT NULL DEFAULT true,
  is_system_event        boolean NOT NULL DEFAULT false,
  metadata               jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at             timestamptz,
  deleted_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_notification_events_module_code
    CHECK (module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM')),
  CONSTRAINT chk_notification_events_type
    CHECK (notification_type IN ('System','Account','HR','Attendance','Leave','Task','Project','Approval','Reminder','Warning','Error')),
  CONSTRAINT chk_notification_events_priority
    CHECK (default_priority IN ('Low','Normal','High','Urgent','Critical')),
  CONSTRAINT chk_notification_events_dedupe_strategy
    CHECK (dedupe_strategy IN ('None','DedupeKey','TimeWindow','EntityRecipient'))
);
-- ── RLS TRƯỚC mọi INSERT/backfill — nullable-tenant policy (mẫu 0434) ──
ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_events;
CREATE POLICY tenant_isolation ON notification_events
  USING (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR company_id IS NULL
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
  );
-- uq global (event_code) WHERE company_id IS NULL + uq company (company_id, event_code) WHERE NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_events_global_code_active
  ON notification_events (event_code)
  WHERE company_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_events_company_code_active
  ON notification_events (company_id, event_code)
  WHERE company_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notification_events_module
  ON notification_events (module_code, is_enabled) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notification_events_company_module
  ON notification_events (company_id, module_code, is_enabled) WHERE deleted_at IS NULL;
-- GRANT app SELECT-only (write company-override → NOTI-BE-3). worker SELECT.
GRANT SELECT ON notification_events TO mediaos_app;
GRANT SELECT ON notification_events TO mediaos_worker;

-- ─────────────── 2. notification_templates (DB-07 §7.2 — template theo event/kênh/locale; company_id NULLABLE) ──
CREATE TABLE IF NOT EXISTS notification_templates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid REFERENCES companies(id) ON DELETE CASCADE,
  event_id               uuid NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  template_code          varchar(100) NOT NULL,
  channel                varchar(50) NOT NULL DEFAULT 'IN_APP',
  locale                 varchar(20) NOT NULL DEFAULT 'vi-VN',
  title_template         varchar(255) NOT NULL,
  body_template          text NOT NULL,
  short_body_template    varchar(500),
  action_label_template  varchar(100),
  target_url_template    varchar(500),
  variables_schema       jsonb,
  sample_payload         jsonb,
  version                integer NOT NULL DEFAULT 1,
  status                 varchar(50) NOT NULL DEFAULT 'Draft',
  is_default             boolean NOT NULL DEFAULT false,
  effective_from         timestamptz,
  effective_to           timestamptz,
  metadata               jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at             timestamptz,
  deleted_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_notification_templates_channel
    CHECK (channel IN ('IN_APP','EMAIL','PUSH','REALTIME','INTEGRATION')),
  CONSTRAINT chk_notification_templates_status
    CHECK (status IN ('Draft','Active','Inactive','Archived')),
  CONSTRAINT chk_notification_templates_effective_range
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_templates;
CREATE POLICY tenant_isolation ON notification_templates
  USING (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR company_id IS NULL
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
  );
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_templates_global_code_active
  ON notification_templates (template_code)
  WHERE company_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_templates_company_code_active
  ON notification_templates (company_id, template_code)
  WHERE company_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notification_templates_event_channel_locale
  ON notification_templates (event_id, channel, locale, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notification_templates_company_event
  ON notification_templates (company_id, event_id, channel, locale, status) WHERE deleted_at IS NULL;
GRANT SELECT ON notification_templates TO mediaos_app;
GRANT SELECT ON notification_templates TO mediaos_worker;

-- ─────────────── 3. notification_delivery_logs (DB-07 §7.4 — APPEND-ONLY log gửi; company_id NOT NULL) ──────
-- APPEND-ONLY (BẤT BIẾN #2): KHÔNG deleted_at. Retry = INSERT hàng attempt_no MỚI. app GRANT SELECT,INSERT.
CREATE TABLE IF NOT EXISTS notification_delivery_logs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL
                         DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                         REFERENCES companies(id) ON DELETE CASCADE,
  notification_id      uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  recipient_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel              varchar(50) NOT NULL,
  provider             varchar(100),
  delivery_status      varchar(50) NOT NULL DEFAULT 'Pending',
  attempt_no           integer NOT NULL DEFAULT 1,
  max_attempts         integer NOT NULL DEFAULT 1,
  request_payload      jsonb,
  response_payload     jsonb,
  external_message_id  varchar(255),
  error_code           varchar(100),
  error_message        text,
  scheduled_at         timestamptz,
  sent_at              timestamptz,
  delivered_at         timestamptz,
  failed_at            timestamptz,
  next_retry_at        timestamptz,
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_notification_delivery_logs_channel
    CHECK (channel IN ('IN_APP','EMAIL','PUSH','REALTIME','INTEGRATION')),
  CONSTRAINT chk_notification_delivery_logs_status
    CHECK (delivery_status IN ('Pending','Sent','Delivered','Failed','Skipped','Cancelled')),
  CONSTRAINT chk_notification_delivery_logs_attempt
    CHECK (attempt_no >= 1 AND max_attempts >= attempt_no)
);
ALTER TABLE notification_delivery_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_delivery_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_delivery_logs;
CREATE POLICY tenant_isolation ON notification_delivery_logs
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_logs_notification
  ON notification_delivery_logs (notification_id, channel);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_logs_company_status_retry
  ON notification_delivery_logs (company_id, delivery_status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_logs_recipient_created
  ON notification_delivery_logs (company_id, recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_logs_channel_status
  ON notification_delivery_logs (company_id, channel, delivery_status, created_at DESC);
-- APPEND-ONLY (BẤT BIẾN #2): GRANT SELECT,INSERT — KHÔNG UPDATE/DELETE cho app role.
GRANT SELECT, INSERT ON notification_delivery_logs TO mediaos_app;
GRANT SELECT ON notification_delivery_logs TO mediaos_worker;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (B) ALTER-ADD additive trên notifications (mig 0010) — MỌI cột NULLABLE, GIỮ cột legacy + policy.
-- GIỮ: user_id(NOT NULL) · type(NOT NULL DEFAULT 'general') · body(NOT NULL) · is_read(NOT NULL) · ref_id/ref_type
-- + notifications_tenant_isolation + RLS+FORCE + grant SELECT/INSERT/UPDATE (KHÔNG đụng — đã land 0010).
-- Cột DB-07 §7.3 TitleCase MỚI (status/notification_type/priority) ≠ cột legacy lowercase (type). CHECK cho phép NULL.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES notification_events(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES notification_templates(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS module_code varchar(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_code varchar(100);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_type varchar(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority varchar(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS status varchar(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title varchar(255);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS short_body varchar(500);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS source_entity_type varchar(100);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS source_entity_id uuid;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS source_entity_code varchar(100);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_module varchar(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_type varchar(100);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_id uuid;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_url varchar(500);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key varchar(255);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS batch_key varchar(255);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS correlation_id varchar(100);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- CHECK enum tên MỚI (DB-07 §7.3) — CHỈ trên cột mới, NULL hợp lệ (legacy row cột mới NULL). DROP-then-ADD idempotent.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_status;
ALTER TABLE notifications ADD CONSTRAINT chk_notifications_status
  CHECK (status IS NULL OR status IN ('Unread','Read','Hidden','Archived','Deleted','Failed'));
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_module_code;
ALTER TABLE notifications ADD CONSTRAINT chk_notifications_module_code
  CHECK (module_code IS NULL OR module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM'));
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_notification_type;
ALTER TABLE notifications ADD CONSTRAINT chk_notifications_notification_type
  CHECK (notification_type IS NULL OR notification_type IN ('System','Account','HR','Attendance','Leave','Task','Project','Approval','Reminder','Warning','Error'));
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_priority;
ALTER TABLE notifications ADD CONSTRAINT chk_notifications_priority
  CHECK (priority IS NULL OR priority IN ('Low','Normal','High','Urgent','Critical'));

-- Partial index unread (đếm unread mới) + list index (inbox mới) + uq dedupe. GIỮ index legacy
-- notifications_user_unread_idx (user_id,is_read) + notifications_company_user_created_idx (countUnread cũ).
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (company_id, recipient_user_id)
  WHERE status = 'Unread';
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_list
  ON notifications (company_id, recipient_user_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_status_created
  ON notifications (company_id, recipient_user_id, status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_source_entity
  ON notifications (company_id, source_entity_type, source_entity_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_batch_key
  ON notifications (company_id, batch_key)
  WHERE batch_key IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe_active
  ON notifications (company_id, recipient_user_id, event_code, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND deleted_at IS NULL;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DROP TABLE IF EXISTS notification_delivery_logs CASCADE;
-- DROP TABLE IF EXISTS notification_templates CASCADE;
-- DROP TABLE IF EXISTS notification_events CASCADE;
-- ALTER TABLE notifications DROP COLUMN IF EXISTS recipient_user_id, DROP COLUMN IF EXISTS recipient_employee_id,
--   DROP COLUMN IF EXISTS event_id, DROP COLUMN IF EXISTS template_id, DROP COLUMN IF EXISTS module_code,
--   DROP COLUMN IF EXISTS event_code, DROP COLUMN IF EXISTS notification_type, DROP COLUMN IF EXISTS priority,
--   DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS title, DROP COLUMN IF EXISTS short_body,
--   DROP COLUMN IF EXISTS source_entity_type, DROP COLUMN IF EXISTS source_entity_id, DROP COLUMN IF EXISTS source_entity_code,
--   DROP COLUMN IF EXISTS target_module, DROP COLUMN IF EXISTS target_type, DROP COLUMN IF EXISTS target_id,
--   DROP COLUMN IF EXISTS target_url, DROP COLUMN IF EXISTS payload, DROP COLUMN IF EXISTS dedupe_key,
--   DROP COLUMN IF EXISTS batch_key, DROP COLUMN IF EXISTS correlation_id, DROP COLUMN IF EXISTS scheduled_at,
--   DROP COLUMN IF EXISTS sent_at, DROP COLUMN IF EXISTS read_at, DROP COLUMN IF EXISTS hidden_at,
--   DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS expires_at, DROP COLUMN IF EXISTS created_by,
--   DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS updated_by, DROP COLUMN IF EXISTS deleted_at,
--   DROP COLUMN IF EXISTS deleted_by;
