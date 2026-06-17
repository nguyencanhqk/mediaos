-- Migration 0110: G15-2 — device_tokens (RLS + FORCE, tenant-scoped, soft-delete).
-- BAND 0110-0119 (lane G15). Journal: idx 96 / when 1717500310000.
-- INVARIANTS: company_id NOT NULL + RLS ENABLE/FORCE (cross-tenant isolation).
-- App role: SELECT, INSERT, UPDATE (soft-delete sets deleted_at) — NO hard DELETE.

CREATE TABLE device_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
               REFERENCES companies (id),
  user_id      uuid NOT NULL REFERENCES users (id),
  token        text NOT NULL,
  platform     text NOT NULL DEFAULT 'android',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CONSTRAINT device_tokens_platform_check CHECK (platform IN ('ios', 'android', 'web')),
  CONSTRAINT device_tokens_token_unique UNIQUE (token)
);
--> statement-breakpoint
CREATE INDEX device_tokens_company_user_idx ON device_tokens (company_id, user_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE device_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY device_tokens_tenant_iso ON device_tokens
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON device_tokens TO mediaos_app;
