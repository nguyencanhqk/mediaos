-- Migration 0320: AC-6 (🔴 CROWN-JEWEL) — Webhooks per-tenant (TENANT self-service).
--
-- BAND 0320-0329 (lane ac6). idx/when set lúc LAND (> master max). Re-stamp mỗi rebase.
--
-- MỤC TIÊU (PRD §4 N5b / §5): tenant tự đăng ký endpoint nhận webhook + subscribe event_type + xem log giao.
--   companyId LẤY TỪ JWT (KHÔNG :companyId operator, KHÔNG nhận từ body/param). HTTP fan-out = consumer MỚI
--   với SSRF guard (resolve-then-pin) — KHÔNG reuse outbox dispatcher.
--
-- BẤT BIẾN:
--   #1 company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy USING+WITH CHECK (3 bảng) +
--      index company_id. Mọi repo qua withTenant(actor.companyId).
--   #2 webhook_deliveries APPEND-ONLY: app SELECT/INSERT + UPDATE CHỈ cột vòng đời (status/attempts/
--      response_code/last_error/delivered_at) — KHÔNG DELETE. webhook_endpoints soft-delete (deleted_at).
--   #3 KHÔNG secret plaintext: HMAC secret reversible → 7 cột envelope (secret_ciphertext/encrypted_dek/
--      dek_key_version/kms_key_id/iv_nonce/auth_tag/enc_algo). AAD = companyId‖endpoint_id. CẤM cột plaintext.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- webhook_endpoints — URL nhận webhook + HMAC secret envelope. MUTABLE: app UPDATE description/active/
-- deleted_at (KHÔNG sửa secret/url qua app — secret frozen sau tạo, đổi url = tạo endpoint mới).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE webhook_endpoints (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  url                text NOT NULL,
  description        text,
  active             boolean NOT NULL DEFAULT true,
  -- 7 cột envelope HMAC secret (mirror platform_accounts 0022 / user_totp 0120).
  secret_ciphertext  bytea NOT NULL,
  encrypted_dek      bytea NOT NULL,
  dek_key_version    integer NOT NULL,
  kms_key_id         text NOT NULL,
  iv_nonce           bytea NOT NULL,
  auth_tag           bytea NOT NULL,
  enc_algo           text NOT NULL,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_endpoints_enc_algo_check CHECK (enc_algo IN ('AES-256-GCM')),
  CONSTRAINT webhook_endpoints_iv_nonce_len_check CHECK (octet_length(iv_nonce) = 12),
  CONSTRAINT webhook_endpoints_auth_tag_len_check CHECK (octet_length(auth_tag) = 16)
);
--> statement-breakpoint
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON webhook_endpoints
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX webhook_endpoints_company_id_idx ON webhook_endpoints(company_id);
--> statement-breakpoint
-- MUTABLE column-grant: app SELECT/INSERT + UPDATE CHỈ description/active/deleted_at (soft-delete) —
-- KHÔNG sửa secret/url (frozen) + KHÔNG DELETE (BẤT BIẾN #2).
GRANT SELECT, INSERT ON webhook_endpoints TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (description, active, deleted_at) ON webhook_endpoints TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON webhook_endpoints TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- webhook_event_subscriptions — endpoint ↔ event_type (JOIN, KHÔNG array). UNIQUE (company,endpoint,event).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE webhook_event_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies(id) ON DELETE CASCADE,
  endpoint_id  uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_event_subscriptions_uq UNIQUE (company_id, endpoint_id, event_type)
);
--> statement-breakpoint
ALTER TABLE webhook_event_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_event_subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON webhook_event_subscriptions
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX webhook_event_subscriptions_company_id_idx ON webhook_event_subscriptions(company_id);
--> statement-breakpoint
CREATE INDEX webhook_event_subscriptions_company_endpoint_idx
  ON webhook_event_subscriptions(company_id, endpoint_id);
--> statement-breakpoint
-- Subscription: app SELECT/INSERT + DELETE (unsubscribe — không phải log nên cho xoá). KHÔNG UPDATE.
GRANT SELECT, INSERT, DELETE ON webhook_event_subscriptions TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON webhook_event_subscriptions TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- webhook_deliveries — log mỗi lần giao (APPEND-ONLY + UPDATE chỉ cột vòng đời). KHÔNG DELETE.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE webhook_deliveries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL
                   DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                   REFERENCES companies(id) ON DELETE CASCADE,
  endpoint_id    uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type     text NOT NULL,
  status         text NOT NULL DEFAULT 'pending',
  attempts       integer NOT NULL DEFAULT 0,
  response_code  integer,
  last_error     text,
  scheduled_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_deliveries_status_check CHECK (status IN ('pending','success','failed'))
);
--> statement-breakpoint
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON webhook_deliveries
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX webhook_deliveries_company_id_idx ON webhook_deliveries(company_id);
--> statement-breakpoint
CREATE INDEX webhook_deliveries_company_endpoint_idx ON webhook_deliveries(company_id, endpoint_id);
--> statement-breakpoint
-- APPEND-ONLY (BẤT BIẾN #2): app SELECT/INSERT + UPDATE CHỈ cột vòng đời. KHÔNG DELETE.
GRANT SELECT, INSERT ON webhook_deliveries TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (status, attempts, response_code, last_error, delivered_at) ON webhook_deliveries TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, UPDATE (status, attempts, response_code, last_error, delivered_at)
  ON webhook_deliveries TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- encryption_keys purpose CHECK +'webhook_secret'. encryption_keys GLOBAL no-RLS (mig 0022).
-- DO-block UNION robust: parse CẢ 2 dạng pg_get_constraintdef — IN-list literal VÀ = ANY(ARRAY[...]::text[]).
-- (0120 đặt CHECK dạng IN; PG render thành `= ANY (ARRAY['x'::text, ...])` — KHÔNG có braces `{}` nên
--  parse literal '...' bằng regexp cho CẢ HAI form là an toàn nhất.) Seed row 'webhook_secret' active để
--  encryptSecret không THROW lúc tạo endpoint.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['webhook_secret'];
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
  -- Parse mọi string-literal trong def ('...') — đúng cho cả IN ('a','b') lẫn = ANY (ARRAY['a'::text,...]).
  SELECT array_agg(m[1]) INTO v_cur
    FROM (
      SELECT regexp_matches(v_def, '''([^'']+)''', 'g') AS m
    ) sub;

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
-- Mirror 0028/0120: cùng kms_key_id 'local-dev-kek' vì LocalKekProvider dùng 1 file KEK cho mọi purpose.
-- ⚠️ Prod cutover phải override bằng provisioning Vault thật (gated — plan §6d).
INSERT INTO encryption_keys (key_version, kms_key_id, purpose, status)
VALUES (1, 'local-dev-kek', 'webhook_secret', 'active')
ON CONFLICT (purpose, key_version) DO NOTHING;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- audit_logs CHECK +'webhook_endpoint','webhook_delivery' (HOT-FILE §5.3 UNION DO-block, verbatim 0231/0310).
-- ADD-only, đọc CẢ HAI dạng (IN + = ANY('{...}')). Sync AUDIT_OBJECT_TYPES (schema/audit.ts) CÙNG commit.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['webhook_endpoint', 'webhook_delivery'];
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
-- Permission seed: manage:webhook (sensitive) + view:webhook (sensitive) + grant company-admin tường minh.
-- PRD §5.y: is_sensitive=TRUE khai ở CẢ seed lẫn decorator (chống *:* wildcard bypass cổng nhạy cảm).
-- KHÔNG requiresReauth (tenant self-service, không cross-tenant reveal). ON CONFLICT DO NOTHING (hot-file).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('manage', 'webhook', true),
  ('view',   'webhook', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (('manage', 'webhook'), ('view', 'webhook'))
ON CONFLICT DO NOTHING;

-- -------- Down (manual) --------
-- DROP TABLE webhook_deliveries, webhook_event_subscriptions, webhook_endpoints;
-- DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE resource_type='webhook');
-- DELETE FROM permissions WHERE resource_type = 'webhook';
-- DELETE FROM encryption_keys WHERE purpose = 'webhook_secret';
-- (audit/purpose CHECK: re-stamp without the new types — chỉ khi không row dùng chúng.)
