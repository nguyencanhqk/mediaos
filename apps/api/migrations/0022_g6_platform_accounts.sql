-- Migration 0022: G6-2 (🔴 CROWN-JEWEL) — platform_accounts (envelope encryption) + encryption_keys
-- + channel_accounts (M:N). RLS+FORCE TRƯỚC mọi insert (GX-4). ERD v2 §2.1: BỎ encrypted_password (ERD v1);
-- thay bằng ĐÚNG 8 cột envelope (đã verify byte-for-byte vs erd-v2.md §2.1).
-- ⚠️ Journal: 0022 tạo SAU 0023–0025 (G6-2 làm cuối) → when=1717500030000 (> max applied 25000) để drizzle
--    KHÔNG bỏ qua (migrate.ts dùng drizzle migrator chuẩn: áp entry có folderMillis > max-applied).

-- ===== platform_accounts (8 cột envelope + worker policy + column-grant rotation) =====
CREATE TABLE platform_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  platform_id        uuid NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,
  account_name       text,
  account_email      text,
  account_identifier text,
  recovery_email     text,   -- ⚠️ PII nhạy (recovery hint) — KHÔNG vào DTO role không quyền (xem §6b)
  recovery_phone     text,   -- ⚠️ PII nhạy — như trên
  two_factor_note    text,   -- ⚠️ hint nhạy — như trên
  owner_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  security_level     text,
  status             text NOT NULL DEFAULT 'active',
  -- 🔒 ENVELOPE columns (ERD v2 §2.1) — secret_ciphertext thay encrypted_password:
  secret_ciphertext  bytea NOT NULL,
  encrypted_dek      bytea NOT NULL,
  dek_key_version    int   NOT NULL,
  kms_key_id         text  NOT NULL,
  iv_nonce           bytea NOT NULL,
  auth_tag           bytea NOT NULL,
  enc_algo           text  NOT NULL DEFAULT 'AES-256-GCM',
  last_rotated_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
--> statement-breakpoint
ALTER TABLE platform_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- App policy: scope TO mediaos_app (KHÔNG để áp luôn cho worker).
CREATE POLICY platform_accounts_app_tenant_iso ON platform_accounts
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- ⚠️ Worker policy (BẤT BIẾN #4): rotation job chạy direct pool KHÔNG set app.current_company_id.
-- Không có policy này, worker thấy 0 row → rotation (RED 13) im lặng fail. Mirror outbox_worker_all (0003).
CREATE POLICY platform_accounts_worker_all ON platform_accounts
  TO mediaos_worker
  USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE INDEX platform_accounts_company_id_idx ON platform_accounts (company_id);
--> statement-breakpoint
CREATE INDEX platform_accounts_platform_id_idx ON platform_accounts (platform_id);
--> statement-breakpoint
CREATE INDEX platform_accounts_owner_idx ON platform_accounts (company_id, owner_user_id);
--> statement-breakpoint
ALTER TABLE platform_accounts ADD CONSTRAINT platform_accounts_enc_algo_check
  CHECK (enc_algo IN ('AES-256-GCM'));
--> statement-breakpoint
ALTER TABLE platform_accounts ADD CONSTRAINT platform_accounts_status_check
  CHECK (status IN ('active','inactive','suspended'));
--> statement-breakpoint
-- ⚠️ Defense-in-depth (FULL-gate 2a, sec-L3): chặn IV/tag cắt cụt ngay tầng DB (AES-256-GCM: IV 12B, tag 16B).
ALTER TABLE platform_accounts ADD CONSTRAINT platform_accounts_iv_nonce_len_check
  CHECK (octet_length(iv_nonce) = 12);
--> statement-breakpoint
ALTER TABLE platform_accounts ADD CONSTRAINT platform_accounts_auth_tag_len_check
  CHECK (octet_length(auth_tag) = 16);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_accounts TO mediaos_app;
--> statement-breakpoint
-- ⚠️ Worker rotation cần UPDATE 4 cột wrap (KHÔNG được chạm secret_ciphertext/business cols).
-- Column-level grant: worker re-wrap được mà không thể đọc-ghi secret_ciphertext.
GRANT SELECT ON platform_accounts TO mediaos_worker;
--> statement-breakpoint
GRANT UPDATE (encrypted_dek, kms_key_id, dek_key_version, last_rotated_at)
  ON platform_accounts TO mediaos_worker;
--> statement-breakpoint

-- ===== encryption_keys: GLOBAL key registry (KHÔNG RLS tenant) =====
-- Bảo mật (đã review): kms_key_id = đường dẫn key trong Vault (Vault key path), KHÔNG phải key material.
-- KHÔNG chứa dữ liệu per-tenant. Để RLS-free OK; worker là writer duy nhất (rotation).
CREATE TABLE encryption_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_version int  NOT NULL,
  kms_key_id  text NOT NULL,   -- Vault transit key PATH, không phải key material
  purpose     text NOT NULL,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  retired_at  timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX encryption_keys_purpose_version_uq ON encryption_keys (purpose, key_version);
--> statement-breakpoint
ALTER TABLE encryption_keys ADD CONSTRAINT encryption_keys_purpose_check
  CHECK (purpose IN ('platform_account','auth_reset_token'));
--> statement-breakpoint
ALTER TABLE encryption_keys ADD CONSTRAINT encryption_keys_status_check
  CHECK (status IN ('active','retiring','revoked'));
--> statement-breakpoint
-- Registry hạ tầng: app đọc để chọn key version; ghi/rotation do worker/migration.
GRANT SELECT ON encryption_keys TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON encryption_keys TO mediaos_worker;
--> statement-breakpoint
INSERT INTO encryption_keys (key_version, kms_key_id, purpose, status)
VALUES (1, 'local-dev-kek', 'platform_account', 'active')
ON CONFLICT (purpose, key_version) DO NOTHING;
--> statement-breakpoint

-- ===== channel_accounts: M:N channel ↔ platform_account (hard DELETE) =====
-- Quyết định (A) link M:N thuần: KHÔNG cột status; relation_type immutable (set lúc INSERT, re-link để đổi).
CREATE TABLE channel_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL
                        DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                        REFERENCES companies(id) ON DELETE CASCADE,
  channel_id          uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  platform_account_id uuid NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
  relation_type       text NOT NULL DEFAULT 'main_google_account',  -- NOT NULL → NULL-safe unique
  created_at          timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE channel_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE channel_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY channel_accounts_app_tenant_iso ON channel_accounts
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- ⚠️ company_id index (BẮT BUỘC cho RLS scan).
CREATE INDEX channel_accounts_company_id_idx ON channel_accounts (company_id);
--> statement-breakpoint
CREATE INDEX channel_accounts_channel_id_idx ON channel_accounts (channel_id);
--> statement-breakpoint
CREATE INDEX channel_accounts_account_id_idx ON channel_accounts (platform_account_id);
--> statement-breakpoint
-- ⚠️ Composite UNIQUE PHẢI dẫn đầu company_id + NULL-safe (relation_type NOT NULL ở trên).
CREATE UNIQUE INDEX channel_accounts_uq
  ON channel_accounts (company_id, channel_id, platform_account_id, relation_type);
--> statement-breakpoint
ALTER TABLE channel_accounts ADD CONSTRAINT channel_accounts_relation_check CHECK (
  relation_type IN
    ('main_google_account','recovery_email','adsense','analytics',
     'youtube_channel_account','tiktok_account','facebook_page')
);
--> statement-breakpoint
-- Link M:N thuần → hard DELETE: KHÔNG cấp UPDATE (không còn cột mutable).
-- KHÔNG grant cho mediaos_worker: rotation chỉ chạm platform_accounts; channel_accounts KHÔNG có worker
-- policy (FORCE RLS) nên grant sẽ là dead → bỏ tránh hiểu nhầm (FULL-gate 2a finding db-M2/sec-M4).
GRANT SELECT, INSERT, DELETE ON channel_accounts TO mediaos_app;
