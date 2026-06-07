-- Migration 0024: G6-4a — CREATE content_types (NEW, RLS+FORCE).
-- ⚠️ default_workflow_template_id / default_evaluation_template_id = uuid TRẦN, KHÔNG FK:
--   workflow_templates + evaluation_templates KHÔNG TỒN TẠI ở M2 (template-concept land G7-1; eval G8).
--   FK defer sang G7/G8 (lúc đó ADD CONSTRAINT ... REFERENCES). Trỏ FK bây giờ → migration fail
--   'relation "workflow_templates" does not exist'.
-- Bảng mới có company_id → RLS+FORCE policy TRƯỚC mọi insert (CLAUDE §3 — cửa sổ rò chéo tenant).
CREATE TABLE content_types (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                     uuid NOT NULL
                                   DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                                   REFERENCES companies(id) ON DELETE CASCADE,
  name                           text NOT NULL,
  code                           text,
  description                    text,
  -- FK to workflow_templates/evaluation_templates DEFERRED to G7/G8 (chưa có bảng ở M2):
  default_workflow_template_id   uuid,   -- NO REFERENCES (defer G7)
  default_evaluation_template_id uuid,   -- NO REFERENCES (defer G8)
  target_platform                text,
  standard_duration              int,
  status                         text NOT NULL DEFAULT 'active',
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  deleted_at                     timestamptz
);
--> statement-breakpoint
ALTER TABLE content_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE content_types FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY content_types_app_tenant_iso ON content_types
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX content_types_company_id_idx ON content_types (company_id);
--> statement-breakpoint
CREATE UNIQUE INDEX content_types_company_name_active_uq
  ON content_types (company_id, name) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX content_types_company_code_active_uq
  ON content_types (company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
--> statement-breakpoint
ALTER TABLE content_types ADD CONSTRAINT content_types_status_check
  CHECK (status IN ('active','inactive'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON content_types TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON content_types TO mediaos_worker;
