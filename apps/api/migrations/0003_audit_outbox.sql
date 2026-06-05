-- G2-4 — audit_logs (append-only) + transactional outbox + idempotency + dead-letter.
-- ADR-0009 · CLAUDE §2 bất biến #2 (append-only) · plan G2-4.
-- Worker xử lý event của MỌI tenant ⇒ policy theo ROLE: mediaos_app cô lập theo tenant;
-- mediaos_worker thấy tất cả (USING true) để xử lý nền. mediaos_worker vẫn NOBYPASSRLS.

-- ── audit_logs (append-only; app chỉ INSERT/SELECT — KHÔNG UPDATE/DELETE) ──────────────────────
CREATE TABLE audit_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                   REFERENCES companies (id),
  actor_user_id  uuid REFERENCES users (id),
  action         text NOT NULL,
  object_type    text NOT NULL,
  object_id      uuid,
  before         jsonb,
  after          jsonb,
  ip             text,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_object_type_chk
    CHECK (object_type IN ('company', 'user', 'auth', 'outbox_event'))
);
--> statement-breakpoint
CREATE INDEX audit_logs_company_object_idx ON audit_logs (company_id, object_type, object_id);
--> statement-breakpoint
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_logs_tenant_iso ON audit_logs
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- Append-only: app KHÔNG có UPDATE/DELETE (bất biến #2 ép ở grant, không chỉ ở app code).
GRANT SELECT, INSERT ON audit_logs TO mediaos_app;
--> statement-breakpoint

-- ── outbox_events (ghi cùng tx nghiệp vụ; worker đọc qua directPool) ───────────────────────────
CREATE TABLE outbox_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                  REFERENCES companies (id),
  event_type    text NOT NULL,
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending',
  available_at  timestamptz NOT NULL DEFAULT now(),
  attempts      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz,
  CONSTRAINT outbox_status_chk CHECK (status IN ('pending', 'processing', 'done', 'failed'))
);
--> statement-breakpoint
CREATE INDEX outbox_events_claim_idx ON outbox_events (status, available_at);
--> statement-breakpoint
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- App: chỉ thấy/ghi event của tenant mình (đính event vào tx nghiệp vụ).
CREATE POLICY outbox_app_tenant_iso ON outbox_events
  TO mediaos_app
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- Worker: hạ tầng nền, thấy mọi tenant để xử lý; chỉ ĐỌC + cập nhật status (không tạo/đổi tenant).
CREATE POLICY outbox_worker_all ON outbox_events
  TO mediaos_worker
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON outbox_events TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON outbox_events TO mediaos_worker;
--> statement-breakpoint

-- ── processed_events (idempotency theo consumer) ──────────────────────────────────────────────
-- UNIQUE (consumer_name, event_id): mỗi consumer xử lý 1 event đúng 1 lần; NHIỀU consumer khác tên
-- cùng 1 event là HỢP LỆ (mỗi cái xử lý độc lập). Bảng hạ tầng worker — chỉ worker truy cập.
CREATE TABLE processed_events (
  consumer_name  text NOT NULL,
  event_id       uuid NOT NULL REFERENCES outbox_events (id),
  processed_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT processed_events_pk PRIMARY KEY (consumer_name, event_id)
);
--> statement-breakpoint
GRANT SELECT, INSERT ON processed_events TO mediaos_worker;
--> statement-breakpoint

-- ── dead_letter_events (event chết + alert khi chưa resolved) ──────────────────────────────────
CREATE TABLE dead_letter_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies (id),
  event_id      uuid NOT NULL REFERENCES outbox_events (id),
  consumer_name text NOT NULL,
  event_type    text NOT NULL,
  payload       jsonb NOT NULL,
  error         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  -- 1 dead-letter / (event, consumer): crash giữa insert↔markProcessed không tạo bản trùng (review G2).
  CONSTRAINT dead_letter_event_consumer_uq UNIQUE (event_id, consumer_name)
);
--> statement-breakpoint
CREATE INDEX dead_letter_unresolved_idx ON dead_letter_events (resolved_at) WHERE resolved_at IS NULL;
--> statement-breakpoint
ALTER TABLE dead_letter_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dead_letter_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- App (admin UI tenant sau này) chỉ xem dead-letter của tenant mình.
CREATE POLICY dead_letter_app_tenant_iso ON dead_letter_events
  FOR SELECT TO mediaos_app
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- Worker tạo/giải quyết dead-letter cho mọi tenant.
CREATE POLICY dead_letter_worker_all ON dead_letter_events
  TO mediaos_worker
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT ON dead_letter_events TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON dead_letter_events TO mediaos_worker;
