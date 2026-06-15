-- Migration 0120: G16-1 — 2FA TOTP (AUTH-003). Hai bảng RLS (user_totp envelope-encrypted secret +
-- user_recovery_codes hash-at-rest) + cờ roles.requires_two_factor + seed encryption_keys purpose='totp_secret'.
-- BẤT BIẾN #3: secret TOTP KHÔNG plaintext — envelope columns (mirror platform_accounts 0022); recovery code
-- chỉ lưu SHA-256. RLS theo company_id + FORCE (mọi truy cập đi qua withTenant — login/enroll đều có ngữ cảnh).
-- ⚠️ Journal: idx 81 / when 1717500160000 (> max-applied 1717500150000 của 0140) để migrator KHÔNG skip.

-- ── user_totp (1 dòng/user; enabled_at NULL = đã enroll, chưa xác nhận) ─────────────────────────────
CREATE TABLE user_totp (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies (id),
  user_id            uuid NOT NULL REFERENCES users (id),
  secret_ciphertext  bytea NOT NULL,
  encrypted_dek      bytea NOT NULL,
  dek_key_version    int   NOT NULL,
  kms_key_id         text  NOT NULL,
  iv_nonce           bytea NOT NULL,
  auth_tag           bytea NOT NULL,
  enc_algo           text  NOT NULL DEFAULT 'AES-256-GCM',
  enabled_at         timestamptz,
  last_rotated_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX user_totp_user_uq ON user_totp (user_id);
--> statement-breakpoint
-- RLS policy lọc theo company_id mỗi row → index (company_id, user_id) (đồng nhất mọi bảng tenant peer).
CREATE INDEX user_totp_company_user_idx ON user_totp (company_id, user_id);
--> statement-breakpoint
ALTER TABLE user_totp ADD CONSTRAINT user_totp_enc_algo_check CHECK (enc_algo IN ('AES-256-GCM'));
--> statement-breakpoint
ALTER TABLE user_totp ADD CONSTRAINT user_totp_iv_nonce_len_check CHECK (octet_length(iv_nonce) = 12);
--> statement-breakpoint
ALTER TABLE user_totp ADD CONSTRAINT user_totp_auth_tag_len_check CHECK (octet_length(auth_tag) = 16);
--> statement-breakpoint
ALTER TABLE user_totp ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_totp FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_totp_tenant_iso ON user_totp
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- SELECT/INSERT (enroll) + UPDATE (xác nhận enabled_at) + DELETE (disable → xoá sạch secret).
GRANT SELECT, INSERT, UPDATE, DELETE ON user_totp TO mediaos_app;
--> statement-breakpoint
-- Worker re-wrap DEK khi xoay KEK (mirror platform_accounts 0022): column-grant để worker rotate được
-- mà KHÔNG đọc/ghi secret_ciphertext. Hoàn thiện vòng đời rotation cho secret TOTP (purpose='totp_secret').
GRANT UPDATE (encrypted_dek, kms_key_id, dek_key_version, last_rotated_at) ON user_totp TO mediaos_worker;
--> statement-breakpoint

-- ── user_recovery_codes (dùng 1 lần; used_at; hash-at-rest) ────────────────────────────────────────
CREATE TABLE user_recovery_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  code_hash   text NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Unique theo (company_id, code_hash) — KHÔNG global: tránh ràng buộc/oracle chéo tenant. Lookup vẫn theo
-- user_id + code_hash trong RLS (company_id) nên ngữ nghĩa "mã 1-lần/tenant" được giữ.
CREATE UNIQUE INDEX user_recovery_codes_hash_uq ON user_recovery_codes (company_id, code_hash);
--> statement-breakpoint
CREATE INDEX user_recovery_codes_user_idx ON user_recovery_codes (company_id, user_id);
--> statement-breakpoint
ALTER TABLE user_recovery_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_recovery_codes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_recovery_codes_tenant_iso ON user_recovery_codes
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- UPDATE để đánh dấu used_at; DELETE để regenerate/disable.
GRANT SELECT, INSERT, UPDATE, DELETE ON user_recovery_codes TO mediaos_app;
--> statement-breakpoint

-- ── roles.requires_two_factor — ép 2FA cho role nhạy cảm (AUTH-003) ─────────────────────────────────
ALTER TABLE roles ADD COLUMN requires_two_factor boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Seed: company-admin (system role privileged) BẮT BUỘC 2FA. Companies bật thêm cờ cho role tuỳ qua admin UI.
UPDATE roles SET requires_two_factor = true
  WHERE name = 'company-admin' AND is_system = true AND company_id IS NULL;
--> statement-breakpoint
-- Fail-LOUD nếu seed trượt (role bị đổi tên ở migration tương lai) → tránh âm thầm TẮT enforcement AUTH-003.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM roles
    WHERE name = 'company-admin' AND is_system = true AND company_id IS NULL AND requires_two_factor = true
  ) THEN
    RAISE EXCEPTION 'Migration 0120: seed requires_two_factor cho company-admin trượt (0 row) — kiểm tên role.';
  END IF;
END $$;
--> statement-breakpoint

-- ── Seed encryption_keys cho purpose='totp_secret' (encryption_keys GLOBAL — no RLS, migration 0022) ─
-- Mở rộng CHECK purpose (0022 chỉ cho 'platform_account','auth_reset_token') để nhận thêm 'totp_secret'.
ALTER TABLE encryption_keys DROP CONSTRAINT IF EXISTS encryption_keys_purpose_check;
--> statement-breakpoint
ALTER TABLE encryption_keys ADD CONSTRAINT encryption_keys_purpose_check
  CHECK (purpose IN ('platform_account','auth_reset_token','totp_secret'));
--> statement-breakpoint
-- Mirror 0028: cùng kms_key_id 'local-dev-kek' vì LocalKekProvider dùng 1 file KEK cho mọi purpose.
-- ⚠️ Prod cutover phải override bằng provisioning Vault thật (gated — plan §6d).
INSERT INTO encryption_keys (key_version, kms_key_id, purpose, status)
VALUES (1, 'local-dev-kek', 'totp_secret', 'active')
ON CONFLICT (purpose, key_version) DO NOTHING;
