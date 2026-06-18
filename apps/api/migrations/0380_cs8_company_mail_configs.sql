-- Migration 0380: CS-8 (🔴 CROWN-JEWEL) — Cấu hình mail server SMTP per-tenant (TENANT self-service).
--
-- BAND 0380-0389 (lane cs8). idx/when set lúc LAND (> master max). Re-stamp mỗi rebase.
--
-- MỤC TIÊU (CONSOLE-SYSTEM-UPGRADE §6 CS-8): mỗi công ty (tenant) tự cấu hình SMTP server riêng
--   (mặc định + theo app), password lưu MÃ HOÁ envelope (purpose 'smtp_password'). companyId LẤY TỪ JWT
--   (KHÔNG nhận từ body/param). Test connection = handshake `verify()` (KHÔNG gửi mail thật).
--
-- BẤT BIẾN (plan §4):
--   #1 company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy USING+WITH CHECK + index
--      company_id. Mọi repo qua withTenant(actor.companyId). UNIQUE(company_id, scope).
--   #2 KHÔNG secret plaintext: SMTP password reversible → 7 cột envelope (secret_ciphertext/encrypted_dek/
--      dek_key_version/kms_key_id/iv_nonce/auth_tag/enc_algo). AAD = companyId‖id. CẤM cột plaintext.
--   #3 Re-encrypt = DELETE+INSERT cả hàng (app-gen id mới = recordId mới, AAD bind). app GRANT SELECT/INSERT/
--      DELETE + UPDATE CHỈ cột non-secret (host/port/username/secure/from_name/from_email/updated_at) — KHÔNG
--      UPDATE cột envelope (frozen sau ghi; đổi password = re-INSERT cả hàng, xem repo upsertMailConfig).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- company_mail_configs — cấu hình SMTP + password envelope. 1 config / (company, scope).
-- MUTABLE: app UPDATE host/port/username/secure/from_name/from_email/updated_at (sửa non-secret KHÔNG
-- đổi password). Đổi password = DELETE hàng + INSERT lại (envelope frozen, recordId=id bind AAD).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE company_mail_configs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  scope              text NOT NULL DEFAULT 'default',
  host               text NOT NULL,
  port               integer NOT NULL,
  username           text NOT NULL,
  secure             boolean NOT NULL DEFAULT true,
  from_name          text,
  from_email         text NOT NULL,
  -- 7 cột envelope SMTP password (mirror webhook_endpoints 0320 / platform_accounts 0022 / user_totp 0120).
  secret_ciphertext  bytea NOT NULL,
  encrypted_dek      bytea NOT NULL,
  dek_key_version    integer NOT NULL,
  kms_key_id         text NOT NULL,
  iv_nonce           bytea NOT NULL,
  auth_tag           bytea NOT NULL,
  enc_algo           text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_mail_configs_scope_check
    CHECK (scope = 'default' OR scope ~ '^app:[a-z0-9_-]{1,40}$'),
  CONSTRAINT company_mail_configs_port_check CHECK (port BETWEEN 1 AND 65535),
  CONSTRAINT company_mail_configs_enc_algo_check CHECK (enc_algo IN ('AES-256-GCM')),
  CONSTRAINT company_mail_configs_iv_nonce_len_check CHECK (octet_length(iv_nonce) = 12),
  CONSTRAINT company_mail_configs_auth_tag_len_check CHECK (octet_length(auth_tag) = 16),
  CONSTRAINT company_mail_configs_company_scope_uq UNIQUE (company_id, scope)
);
--> statement-breakpoint
ALTER TABLE company_mail_configs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_mail_configs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON company_mail_configs
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX company_mail_configs_company_id_idx ON company_mail_configs(company_id);
--> statement-breakpoint
-- MUTABLE column-grant (BẤT BIẾN #3): app SELECT/INSERT/DELETE + UPDATE CHỈ cột non-secret —
-- KHÔNG UPDATE cột envelope (secret frozen). DELETE cho phép re-INSERT cả hàng khi đổi password.
GRANT SELECT, INSERT, DELETE ON company_mail_configs TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (host, port, username, secure, from_name, from_email, updated_at)
  ON company_mail_configs TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON company_mail_configs TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- encryption_keys purpose CHECK +'smtp_password'. encryption_keys GLOBAL no-RLS (mig 0022).
-- DO-block UNION robust: parse CẢ 2 dạng pg_get_constraintdef — IN ('a','b') literal VÀ
-- = ANY ('{a,b}'::text[]) array-literal. ⚠️ KHÁC 0320:144-192 (chỉ parse IN-literal): các mig trước
-- (0320) ĐÃ chuyển CHECK này sang dạng `= ANY('{...}'::text[])` qua format(%L) → nếu parse từng literal
-- '...' thì regex bắt CẢ chuỗi braces '{...}' là 1 phần tử → CHECK hỏng (constraint violated). Dùng nhánh
-- ANY (parse '\{...\}'::text[]) như DO-block audit (0320:226-233) để xử lý đúng cả 2 form. Seed row
-- 'smtp_password' active để encryptSecret KHÔNG THROW lúc lưu (LocalKekProvider.currentKey THROW nếu thiếu).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['smtp_password'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'encryption_keys'::regclass AND contype = 'c'
     AND conname LIKE '%purpose%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RETURN;
  END IF;

  v_def := pg_get_constraintdef(v_oid);
  IF position('ANY' IN upper(v_def)) > 0 THEN
    -- Dạng `= ANY ('{a,b,c}'::text[])` — array-literal duy nhất giữa braces.
    v_cur := substring(v_def FROM '\{[^}]*\}')::text[];
  ELSE
    -- Dạng `IN ('a','b')` — bắt từng string-literal.
    SELECT array_agg(m[1]) INTO v_cur
      FROM (
        SELECT regexp_matches(v_def, '''([^'']+)''', 'g') AS m
      ) sub;
  END IF;

  IF v_cur IS NULL THEN
    v_cur := ARRAY[]::text[];
  END IF;

  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE encryption_keys DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE encryption_keys ADD CONSTRAINT %I CHECK (purpose = ANY(%L::text[]))',
    v_con, v_union
  );
END;
$$;
--> statement-breakpoint
-- Mirror 0028/0120/0320: cùng kms_key_id 'local-dev-kek' vì LocalKekProvider dùng 1 file KEK cho mọi purpose.
-- ⚠️ Prod cutover phải override bằng provisioning Vault thật (gated — plan §6/§8).
INSERT INTO encryption_keys (key_version, kms_key_id, purpose, status)
VALUES (1, 'local-dev-kek', 'smtp_password', 'active')
ON CONFLICT (purpose, key_version) DO NOTHING;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- audit_logs CHECK +'mail_config' (HOT-FILE §5.3 UNION DO-block, verbatim 0320:205-252).
-- ADD-only, đọc CẢ HAI dạng (IN + = ANY('{...}')). Sync AUDIT_OBJECT_TYPES (schema/audit.ts) CÙNG commit.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['mail_config'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RETURN;
  END IF;

  v_def := pg_get_constraintdef(v_oid);
  IF position('ANY' IN upper(v_def)) > 0 THEN
    v_cur := substring(v_def FROM '\{[^}]*\}')::text[];
  ELSE
    SELECT array_agg(m[1]) INTO v_cur
      FROM (
        SELECT regexp_matches(v_def, '''([^'']+)''', 'g') AS m
      ) sub;
  END IF;

  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
END;
$$;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Permission seed: configure-mail:company (sensitive) + grant system-admin role tường minh.
-- §5.y: is_sensitive=TRUE khai ở CẢ seed lẫn decorator (chống *:* wildcard bypass cổng nhạy cảm).
-- KHÔNG requiresReauth (tenant self-service secret — mirror webhook AC-6). ON CONFLICT DO NOTHING (hot-file).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('configure-mail', 'company', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (('configure-mail', 'company'))
ON CONFLICT DO NOTHING;

-- -------- Down (manual) --------
-- DROP TABLE company_mail_configs;
-- DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE action='configure-mail' AND resource_type='company');
-- DELETE FROM permissions WHERE action = 'configure-mail' AND resource_type = 'company';
-- DELETE FROM encryption_keys WHERE purpose = 'smtp_password';
-- (audit/purpose CHECK: re-stamp without the new types — chỉ khi không row dùng chúng.)
