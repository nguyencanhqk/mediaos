-- G2-6 — bảng token auth: refresh (rotation + hash-at-rest) + password reset (single-use + expiry).
-- plan G2-6 · BẤT BIẾN #3 (không lưu token plaintext). Token là chuỗi entropy cao ⇒ hash SHA-256 at-rest
-- là đủ (argon2id chỉ dành cho MẬT KHẨU entropy thấp). RLS theo company_id + FORCE.

-- ── refresh_tokens (rotation: token cũ revoked + trỏ replaced_by token mới) ────────────────────
CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies (id),
  user_id      uuid NOT NULL REFERENCES users (id),
  token_hash   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  replaced_by  uuid REFERENCES refresh_tokens (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX refresh_tokens_hash_uq ON refresh_tokens (token_hash);
--> statement-breakpoint
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (company_id, user_id);
--> statement-breakpoint
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY refresh_tokens_tenant_iso ON refresh_tokens
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- UPDATE để revoke/rotate; KHÔNG DELETE (giữ vết chuỗi rotation).
GRANT SELECT, INSERT, UPDATE ON refresh_tokens TO mediaos_app;
--> statement-breakpoint

-- ── password_reset_tokens (single-use: used_at; + expires_at) ──────────────────────────────────
CREATE TABLE password_reset_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies (id),
  user_id      uuid NOT NULL REFERENCES users (id),
  token_hash   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX password_reset_tokens_hash_uq ON password_reset_tokens (token_hash);
--> statement-breakpoint
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (company_id, user_id);
--> statement-breakpoint
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY password_reset_tokens_tenant_iso ON password_reset_tokens
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON password_reset_tokens TO mediaos_app;
