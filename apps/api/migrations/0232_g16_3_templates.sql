-- Migration 0232: G16-3 SaaS prep — TEMPLATE clone (workspace_templates + dashboard_configs).
-- Gate: FULL (database-reviewer + security-reviewer + silent-failure-hunter + santa [clone logic crown]).
--
-- BAND 0230-0239 (lane g16 SaaS prep). Journal idx 93, when 1717500280000 khi land (RECONCILE master max).
--
-- DONE-CRITERION: "clone template được cho công ty khác." workspace_templates = CATALOG TOÀN CỤC (no RLS),
-- blueprint_json self-contained (roles + workflows + dashboards). TemplateCloneService đọc rồi GHI
-- per-company rows trong 1 tx withTenant(targetCompanyId): roles + role_permissions + workflow_definitions
-- (+steps +transitions) + dashboard_configs. Idempotent + atomic. Audit dưới object_type 'company'.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- workspace_templates — CATALOG TOÀN CỤC (no company_id, no RLS — mirror permissions/plans). SELECT-only.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE workspace_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL,
  name           text NOT NULL,
  description    text,
  blueprint_json jsonb NOT NULL,
  is_system      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT workspace_templates_code_uq UNIQUE (code)
);
--> statement-breakpoint
GRANT SELECT ON workspace_templates TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON workspace_templates TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- dashboard_configs — PER-COMPANY (company_id NOT NULL + FORCE RLS). Mỗi role 1 dashboard.
-- Config mutable ⇒ app role SELECT/INSERT/UPDATE; KHÔNG DELETE (soft-delete deleted_at).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE dashboard_configs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies (id) ON DELETE CASCADE,
  role_code    text NOT NULL,
  layout_json  jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
--> statement-breakpoint
-- 1 dashboard active/role/công ty (partial unique trên non-deleted).
CREATE UNIQUE INDEX dashboard_configs_company_role_active_uq
  ON dashboard_configs (company_id, role_code) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX dashboard_configs_company_idx ON dashboard_configs (company_id);
--> statement-breakpoint
ALTER TABLE dashboard_configs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dashboard_configs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON dashboard_configs
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON dashboard_configs TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON dashboard_configs TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- SEED: starter template (is_system). Blueprint self-contained — roles (+permission keys ⊆ catalog 0005),
-- workflow content_pipeline (3 step + 7 FSM transition), dashboards per-role. KHÔNG dấu nháy đơn trong JSON.
-- requiresEvaluation=false (tránh FK evaluation_template — giới hạn có chủ đích, doc ở ADR-0017).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO workspace_templates (id, code, name, description, is_system, blueprint_json) VALUES
('00000000-0000-0000-0000-0000000000b1', 'starter', 'Starter Workspace',
 'Bộ mẫu khởi tạo: roles + content pipeline workflow + dashboards', true,
 '{
   "version": 1,
   "roles": [
     {"code": "workspace-manager", "name": "Workspace Manager", "requiresTwoFactor": false,
      "permissions": [
        {"action": "read", "resourceType": "project"},
        {"action": "create", "resourceType": "project"},
        {"action": "update", "resourceType": "project"},
        {"action": "manage", "resourceType": "task"},
        {"action": "read", "resourceType": "user"},
        {"action": "read", "resourceType": "content"},
        {"action": "approve", "resourceType": "approval-request"},
        {"action": "return", "resourceType": "approval-request"}
      ]},
     {"code": "content-creator", "name": "Content Creator", "requiresTwoFactor": false,
      "permissions": [
        {"action": "read", "resourceType": "content"},
        {"action": "create", "resourceType": "content"},
        {"action": "update", "resourceType": "content"},
        {"action": "read", "resourceType": "task"},
        {"action": "submit", "resourceType": "task"},
        {"action": "comment", "resourceType": "comment"}
      ]},
     {"code": "content-reviewer", "name": "Content Reviewer", "requiresTwoFactor": false,
      "permissions": [
        {"action": "read", "resourceType": "content"},
        {"action": "update", "resourceType": "content"},
        {"action": "approve", "resourceType": "step"},
        {"action": "return", "resourceType": "step"},
        {"action": "read", "resourceType": "task"},
        {"action": "comment", "resourceType": "comment"}
      ]},
     {"code": "content-uploader", "name": "Content Uploader", "requiresTwoFactor": false,
      "permissions": [
        {"action": "read", "resourceType": "content"},
        {"action": "read", "resourceType": "task"},
        {"action": "submit", "resourceType": "task"},
        {"action": "comment", "resourceType": "comment"}
      ]}
   ],
   "workflows": [
     {"code": "content_pipeline", "name": "Content Pipeline", "appliesTo": "content_item",
      "maxApprovalLevel": 1, "allowParallelSteps": false,
      "steps": [
        {"stepOrder": 1, "code": "create", "name": "Create", "assigneeRoleCode": "content-creator",
         "reviewerRoleCode": "workspace-manager", "defaultTaskTitle": "Tao noi dung", "nodeKey": "create",
         "stepType": "task", "isRequired": true},
        {"stepOrder": 2, "code": "review", "name": "Review", "assigneeRoleCode": "content-reviewer",
         "reviewerRoleCode": "workspace-manager", "defaultTaskTitle": "Duyet noi dung", "nodeKey": "review",
         "stepType": "task", "isRequired": true},
        {"stepOrder": 3, "code": "upload", "name": "Upload", "assigneeRoleCode": "content-uploader",
         "reviewerRoleCode": "workspace-manager", "defaultTaskTitle": "Dang noi dung", "nodeKey": "upload",
         "stepType": "task", "isRequired": true}
      ],
      "transitions": [
        {"fromState": "not_started", "event": "start", "toState": "in_progress"},
        {"fromState": "in_progress", "event": "submit", "toState": "waiting_review"},
        {"fromState": "waiting_review", "event": "approve", "toState": "approved"},
        {"fromState": "waiting_review", "event": "request_revision", "toState": "revision"},
        {"fromState": "revision", "event": "submit", "toState": "waiting_review"},
        {"fromState": "approved", "event": "open_next", "toState": "in_progress"},
        {"fromState": "approved", "event": "complete_workflow", "toState": "approved"}
      ]}
   ],
   "dashboards": [
     {"roleCode": "workspace-manager", "layout": {"widgets": ["tasks_overview", "team_output", "pending_approvals"]}},
     {"roleCode": "content-creator", "layout": {"widgets": ["my_tasks", "my_content"]}},
     {"roleCode": "content-reviewer", "layout": {"widgets": ["pending_reviews", "my_tasks"]}},
     {"roleCode": "content-uploader", "layout": {"widgets": ["my_tasks"]}}
   ]
 }'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- -------- Down (manual) --------
-- DROP TABLE dashboard_configs; DROP TABLE workspace_templates;
