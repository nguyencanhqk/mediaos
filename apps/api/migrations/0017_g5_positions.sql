-- Migration 0017: G5-4a — tạo bảng positions + RLS + GRANT.
-- Gate: FULL (RLS 2-tenant isolation phải test sau migration).

CREATE TABLE positions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL
                    DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                    REFERENCES companies(id) ON DELETE CASCADE,
  org_unit_id     uuid REFERENCES org_units(id) ON DELETE SET NULL,
  name            text NOT NULL,
  code            text,
  level           int,
  description     text,
  default_role_id uuid REFERENCES roles(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
--> statement-breakpoint
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE positions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON positions
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX positions_company_id_idx ON positions(company_id);
--> statement-breakpoint
CREATE INDEX positions_org_unit_id_idx ON positions(org_unit_id);
--> statement-breakpoint
CREATE UNIQUE INDEX positions_company_name_active_uq
  ON positions(company_id, name) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX positions_company_code_active_uq
  ON positions(company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
--> statement-breakpoint
ALTER TABLE positions ADD CONSTRAINT positions_status_check
  CHECK (status IN ('active','inactive'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON positions TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON positions TO mediaos_worker;
