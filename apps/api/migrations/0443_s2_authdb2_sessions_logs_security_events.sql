-- Migration 0443: S2-AUTH-DB-2 (🔴 RED) — đối chiếu AUTH tables vs DB-02 §12.1 / IMPLEMENTATION-05 §12.1·§12.4.
--   ADDITIVE: ALTER users (+cột §12.1) + CREATE user_sessions/login_logs/user_security_events. KHÔNG drop/rename.
--   Nguồn: DB-02 §7.1/§7.6/§7.8/§7.9 · IMPLEMENTATION-05 §12.1/§12.4 · ISSUE-BOARD-01 §18.3 (AUTH-DB-001/002) · SPEC-02.
--
-- BẤT BIẾN:
--   • #1 (tenant isolation): mọi bảng MỚI company_id + RLS ENABLE+FORCE + policy tenant_isolation (current_setting
--     'app.current_company_id'). RLS+FORCE TRƯỚC mọi backfill (KHÔNG có backfill — bảng mới rỗng; users đã RLS từ 0002).
--   • #2 (append-only): login_logs + user_security_events = log → app role CHỈ GRANT SELECT,INSERT (KHÔNG UPDATE/DELETE).
--     user_sessions MUTABLE (revoke = UPDATE revoked_at) → app GRANT SELECT,INSERT,UPDATE (KHÔNG DELETE).
--   • #3 (no secret): refresh_token_hash = HASH (BE-1 hash trước khi ghi). metadata/payload = ngữ cảnh non-sensitive.
--
-- DEVIATIONS (ghi cho reviewer):
--   • login_logs.company_id NULLABLE (DB-02 §7.8): fail email-không-tồn-tại không resolve được company nhưng VẪN
--     phải ghi log (chống brute-force). → RLS nullable-tenant: USING own+NULL; WITH CHECK own HOẶC NULL khi KHÔNG có
--     ngữ cảnh (pre-auth). Vẫn refsGuc ⇒ qua rls-coverage-assert (b).
--   • login_status lowercase ('success'/'failed'/'blocked') theo chuẩn codebase (users/companies.status lowercase),
--     thay PascalCase DB-02. severity user_security_events lấy từ IMPLEMENTATION-05 §12.1 (DB-02 §7.9 không có).
--   • user_sessions.refresh_token_hash UNIQUE (DB-02 §7.6 = plain index): siết hơn, đồng bộ refresh_tokens_hash_uq.
--   • user_sessions cùng tồn tại refresh_tokens (KHÔNG drop): hợp nhất theo session strategy S2-OQ-001 ở S2-AUTH-BE-1.
--   • password_reset_tokens KHÔNG đụng — đã thoả §12.1 (token_hash/expires_at/used_at từ 0004).
--
-- BAND 0443 (lane S2-AUTH-DB-2). Journal idx 126, when 1717500610000 (> 0442 idx 125 / 1717500600000).
--   Nối ĐƠN ĐIỆU sau 0442_s2_hrdb1_hr_core_reconcile. KHÔNG db:generate (DDL thủ công — tránh drop bảng media-era).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── A. users — thêm cột §12.1 (RLS đã có từ 0002; KHÔNG backfill company_id) ───────────────
ALTER TABLE users
  -- normalized_email: GENERATED STORED từ email(citext) → không drift, app khỏi set; nền unique §12.4 + login lookup.
  ADD COLUMN IF NOT EXISTS normalized_email text GENERATED ALWAYS AS (lower(email::text)) STORED,
  ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_reason text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- audit FK self-ref (ON DELETE SET NULL — giữ hàng khi user bị xoá cứng trong test teardown). Idempotent qua pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_created_by_fkey') THEN
    ALTER TABLE users ADD CONSTRAINT users_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_updated_by_fkey') THEN
    ALTER TABLE users ADD CONSTRAINT users_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_deleted_by_fkey') THEN
    ALTER TABLE users ADD CONSTRAINT users_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- index §12.4: unique (company_id, normalized_email) — citext đã ép unique theo email; index này = spec-literal song song.
CREATE UNIQUE INDEX IF NOT EXISTS users_company_normalized_email_active_uq
  ON users (company_id, normalized_email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS users_company_status_idx ON users (company_id, status);

-- ─────────────── B. user_sessions (MUTABLE — revoke=UPDATE; GRANT SELECT,INSERT,UPDATE) ───────────────
CREATE TABLE IF NOT EXISTS user_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id),
  refresh_token_hash text NOT NULL,
  access_token_jti   text,
  ip_address         text,
  user_agent         text,
  device_id          text,
  device_name        text,
  platform           text,
  last_used_at       timestamptz,
  expired_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoked_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_sessions;
CREATE POLICY tenant_isolation ON user_sessions
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_token_hash_uq ON user_sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS user_sessions_user_active_idx ON user_sessions(user_id, expired_at, revoked_at);
CREATE INDEX IF NOT EXISTS user_sessions_company_created_idx ON user_sessions(company_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON user_sessions TO mediaos_app;
GRANT SELECT ON user_sessions TO mediaos_worker;

-- ─────────────── C. login_logs (APPEND-ONLY; company_id NULLABLE; nullable-tenant RLS) ───────────────
CREATE TABLE IF NOT EXISTS login_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULLABLE: fail pre-auth (email không tồn tại) không có tenant. DEFAULT = ngữ cảnh hiện tại nếu có.
  company_id       uuid
                     DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                     REFERENCES companies(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  email            text NOT NULL,
  normalized_email text NOT NULL,
  login_status     text NOT NULL,
  failure_reason   text,
  ip_address       text,
  user_agent       text,
  platform         text,
  session_id       uuid REFERENCES user_sessions(id) ON DELETE SET NULL,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT login_logs_status_check CHECK (login_status IN ('success', 'failed', 'blocked'))
);
ALTER TABLE login_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON login_logs;
-- nullable-tenant (mẫu public_holidays 0434): USING tenant đọc row mình + row unattributed (NULL).
-- WITH CHECK: ghi row tenant mình; ghi NULL-company CHỈ khi KHÔNG có ngữ cảnh (pre-auth) — chặn ghi NULL khi đang trong tenant.
CREATE POLICY tenant_isolation ON login_logs
  USING (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR company_id IS NULL
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR (
      company_id IS NULL
      AND NULLIF(current_setting('app.current_company_id', true), '') IS NULL
    )
  );
CREATE INDEX IF NOT EXISTS login_logs_company_created_idx ON login_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS login_logs_email_created_idx ON login_logs(normalized_email, created_at DESC);
CREATE INDEX IF NOT EXISTS login_logs_user_created_idx ON login_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS login_logs_ip_created_idx ON login_logs(ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS login_logs_company_status_idx ON login_logs(company_id, login_status);
-- Append-only: app CHỈ SELECT,INSERT (BẤT BIẾN #2 — log không sửa/xoá).
GRANT SELECT, INSERT ON login_logs TO mediaos_app;
GRANT SELECT ON login_logs TO mediaos_worker;

-- ─────────────── D. user_security_events (APPEND-ONLY; company_id NOT NULL) ───────────────
CREATE TABLE IF NOT EXISTS user_security_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL
                  DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                  REFERENCES companies(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  event_type    text NOT NULL,
  severity      text NOT NULL DEFAULT 'info',
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ip_address    text,
  user_agent    text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_security_events_severity_check CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical'))
);
ALTER TABLE user_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_security_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_security_events;
CREATE POLICY tenant_isolation ON user_security_events
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
CREATE INDEX IF NOT EXISTS user_security_events_company_user_idx ON user_security_events(company_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_security_events_company_type_idx ON user_security_events(company_id, event_type);
-- Append-only: app CHỈ SELECT,INSERT.
GRANT SELECT, INSERT ON user_security_events TO mediaos_app;
GRANT SELECT ON user_security_events TO mediaos_worker;

-- Rollback tham khảo (KHÔNG tự chạy):
-- DROP TABLE IF EXISTS user_security_events, login_logs, user_sessions CASCADE;
-- ALTER TABLE users DROP COLUMN IF EXISTS normalized_email, DROP COLUMN IF EXISTS failed_login_count,
--   DROP COLUMN IF EXISTS locked_at, DROP COLUMN IF EXISTS locked_reason,
--   DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS updated_by, DROP COLUMN IF EXISTS deleted_by;
