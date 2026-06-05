-- G3-1 permission engine schema: roles, permissions, role_permissions, user_roles, object_permissions.
-- ADR-0001 ERD section 7 plan G3-1.
-- RLS invariants:
--   roles: system roles (company_id IS NULL) readable by all tenants; not writable via app.
--   permissions: global catalog, SELECT-only for app (no INSERT/UPDATE/DELETE).
--   role_permissions/user_roles/object_permissions: tenant-isolated via JOIN or direct company_id.

-- -------- roles --------
-- company_id = NULL => system/global role (seeded by migration, not writable via app)
-- company_id = uuid => tenant-scoped role (CRUD by company-admin of that tenant)
CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid REFERENCES companies (id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  is_system    boolean NOT NULL DEFAULT false,
  deleted_at   timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX roles_company_name_active_uq ON roles (company_id, name) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX roles_system_name_active_uq ON roles (name) WHERE company_id IS NULL AND deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX roles_company_id_idx ON roles (company_id);
--> statement-breakpoint
CREATE INDEX roles_name_idx ON roles (name);
--> statement-breakpoint

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- USING: tenant sees own roles AND system roles (company_id IS NULL).
-- WITH CHECK: tenant can only write own roles (blocks writes to system roles via app).
CREATE POLICY roles_tenant_isolation ON roles
  USING (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR company_id IS NULL
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
  );
--> statement-breakpoint

-- App: full DML; WITH CHECK in policy blocks writes to system roles.
GRANT SELECT, INSERT, UPDATE, DELETE ON roles TO mediaos_app;
--> statement-breakpoint
-- Worker: read-only.
GRANT SELECT ON roles TO mediaos_worker;
--> statement-breakpoint

-- -------- permissions --------
-- Global catalog -- seeded by migration only. App cannot INSERT/UPDATE/DELETE.
CREATE TABLE permissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action         text NOT NULL,
  resource_type  text NOT NULL,
  is_sensitive   boolean NOT NULL DEFAULT false,
  CONSTRAINT permissions_action_resource_uq UNIQUE (action, resource_type)
);
--> statement-breakpoint

GRANT SELECT ON permissions TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON permissions TO mediaos_worker;
--> statement-breakpoint

-- -------- role_permissions --------
-- ALLOW and DENY can coexist for same (role, permission) -- deny-overrides logic in app layer.
-- No UPDATE: delete + insert to change effect.
CREATE TABLE role_permissions (
  role_id        uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_id  uuid NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  effect         text NOT NULL,
  CONSTRAINT role_permissions_effect_chk CHECK (effect IN ('ALLOW', 'DENY')),
  CONSTRAINT role_permissions_uq UNIQUE (role_id, permission_id, effect)
);
--> statement-breakpoint

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- RLS via JOIN to roles: tenant sees role_permissions for own roles + system roles.
-- WITH CHECK: can only write role_permissions for own tenant roles (system roles immutable).
CREATE POLICY role_permissions_tenant_isolation ON role_permissions
  USING (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_id
        AND (
          r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
          OR r.company_id IS NULL
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_id
        AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    )
  );
--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON role_permissions TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON role_permissions TO mediaos_worker;
--> statement-breakpoint

-- -------- user_roles --------
-- Assigns a role to a user within a company context. expires_at for temporary grants.
CREATE TABLE user_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  granted_by  uuid REFERENCES users (id),
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_uq UNIQUE (user_id, role_id, company_id)
);
--> statement-breakpoint
CREATE INDEX user_roles_user_company_idx ON user_roles (user_id, company_id);
--> statement-breakpoint
CREATE INDEX user_roles_role_idx ON user_roles (role_id);
--> statement-breakpoint

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY user_roles_tenant_isolation ON user_roles
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON user_roles TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON user_roles TO mediaos_worker;
--> statement-breakpoint

-- -------- object_permissions --------
-- Fine-grained overrides on specific objects. subject_type IN ('user', 'role'). effect IN ('ALLOW', 'DENY').
CREATE TABLE object_permissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  subject_type    text NOT NULL,
  subject_id      uuid NOT NULL,
  permission_id   uuid NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  object_type     text NOT NULL,
  object_id       uuid NOT NULL,
  effect          text NOT NULL,
  granted_by      uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT object_permissions_subject_type_chk CHECK (subject_type IN ('user', 'role')),
  CONSTRAINT object_permissions_effect_chk CHECK (effect IN ('ALLOW', 'DENY')),
  CONSTRAINT object_permissions_uq
    UNIQUE (company_id, subject_type, subject_id, permission_id, object_type, object_id)
);
--> statement-breakpoint
CREATE INDEX object_permissions_subject_idx ON object_permissions (company_id, subject_type, subject_id);
--> statement-breakpoint
CREATE INDEX object_permissions_object_idx ON object_permissions (company_id, object_type, object_id);
--> statement-breakpoint

ALTER TABLE object_permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE object_permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY object_permissions_tenant_isolation ON object_permissions
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON object_permissions TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON object_permissions TO mediaos_worker;
--> statement-breakpoint

-- -------- Seed: permissions catalog (MVP-0) --------
-- app role has SELECT only; is_sensitive=true for privileged actions.
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('create', 'company', false),
  ('read', 'company', false),
  ('update', 'company', false),
  ('delete', 'company', false),
  ('manage', 'company', false),
  ('create', 'department', false),
  ('read', 'department', false),
  ('update', 'department', false),
  ('delete', 'department', false),
  ('manage', 'department', false),
  ('create', 'team', false),
  ('read', 'team', false),
  ('update', 'team', false),
  ('delete', 'team', false),
  ('manage', 'team', false),
  ('create', 'user', false),
  ('read', 'user', false),
  ('update', 'user', false),
  ('delete', 'user', false),
  ('assign', 'user', false),
  ('manage', 'user', false),
  ('delete-employee', 'user', true),
  ('create', 'role', false),
  ('read', 'role', false),
  ('update', 'role', false),
  ('delete', 'role', false),
  ('manage', 'role', false),
  ('change-role', 'role', true),
  ('create', 'channel', false),
  ('read', 'channel', false),
  ('update', 'channel', false),
  ('delete', 'channel', false),
  ('manage', 'channel', false),
  ('create', 'project', false),
  ('read', 'project', false),
  ('update', 'project', false),
  ('delete', 'project', false),
  ('assign', 'project', false),
  ('manage', 'project', false),
  ('delete-project', 'project', true),
  ('create', 'content', false),
  ('read', 'content', false),
  ('update', 'content', false),
  ('delete', 'content', false),
  ('submit', 'content', false),
  ('approve', 'content', false),
  ('comment', 'content', false),
  ('create', 'workflow-instance', false),
  ('read', 'workflow-instance', false),
  ('update', 'workflow-instance', false),
  ('delete', 'workflow-instance', false),
  ('manage', 'workflow-instance', false),
  ('create', 'step', false),
  ('read', 'step', false),
  ('update', 'step', false),
  ('delete', 'step', false),
  ('approve', 'step', false),
  ('return', 'step', false),
  ('manage', 'step', false),
  ('create', 'task', false),
  ('read', 'task', false),
  ('update', 'task', false),
  ('delete', 'task', false),
  ('submit', 'task', false),
  ('assign', 'task', false),
  ('manage', 'task', false),
  ('create', 'approval-request', false),
  ('read', 'approval-request', false),
  ('update', 'approval-request', false),
  ('delete', 'approval-request', false),
  ('approve', 'approval-request', false),
  ('return', 'approval-request', false),
  ('manage', 'approval-request', false),
  ('create', 'comment', false),
  ('read', 'comment', false),
  ('update', 'comment', false),
  ('delete', 'comment', false),
  ('comment', 'comment', false),
  ('create', 'notification', false),
  ('read', 'notification', false),
  ('update', 'notification', false),
  ('delete', 'notification', false),
  ('create', 'chat-group', false),
  ('read', 'chat-group', false),
  ('update', 'chat-group', false),
  ('delete', 'chat-group', false),
  ('manage', 'chat-group', false),
  ('create', 'platform-account', false),
  ('read', 'platform-account', false),
  ('update', 'platform-account', false),
  ('delete', 'platform-account', false),
  ('manage', 'platform-account', false),
  ('reveal-secret', 'platform-account', true),
  ('create', 'payslip', false),
  ('read', 'payslip', false),
  ('update', 'payslip', false),
  ('delete', 'payslip', false),
  ('view-salary', 'payslip', true),
  ('create', 'finance', false),
  ('read', 'finance', false),
  ('update', 'finance', false),
  ('delete', 'finance', false),
  ('view-finance', 'finance', true),
  ('read', 'audit-log', false),
  ('access-audit-log', 'audit-log', true);
--> statement-breakpoint

-- -------- Seed: system roles (company_id = NULL, is_system = true) --------
INSERT INTO roles (id, company_id, name, description, is_system) VALUES
  ('00000000-0000-0000-0000-000000000001', NULL, 'company-admin', 'Full non-sensitive management of the company', true),
  ('00000000-0000-0000-0000-000000000002', NULL, 'project-manager', 'Manage projects, content pipeline, and team assignments', true),
  ('00000000-0000-0000-0000-000000000003', NULL, 'channel-manager', 'Manage channels, upload pipeline, and content review', true),
  ('00000000-0000-0000-0000-000000000004', NULL, 'script-writer', 'Write and submit scripts for assigned projects', true),
  ('00000000-0000-0000-0000-000000000005', NULL, 'editor', 'Edit and submit content for assigned projects', true),
  ('00000000-0000-0000-0000-000000000006', NULL, 'qa-reviewer', 'Review, approve, or return content at QA/edit steps', true),
  ('00000000-0000-0000-0000-000000000007', NULL, 'uploader', 'Upload and submit content for assigned projects', true),
  ('00000000-0000-0000-0000-000000000008', NULL, 'employee', 'Basic employee: read own tasks, submit and comment', true);
--> statement-breakpoint

-- Seed: role_permissions for company-admin (all non-sensitive, ALLOW)
-- Sensitive permissions NOT seeded for any system role -- must be granted explicitly per-user.
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.is_sensitive = false;
--> statement-breakpoint

-- Seed: role_permissions for project-manager
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000002', p.id, 'ALLOW'
FROM permissions p
WHERE p.is_sensitive = false
  AND (p.action, p.resource_type) IN (
    ('create', 'project'),
    ('read', 'project'),
    ('update', 'project'),
    ('create', 'content'),
    ('read', 'content'),
    ('update', 'content'),
    ('delete', 'content'),
    ('assign', 'project'),
    ('approve', 'approval-request'),
    ('return', 'approval-request'),
    ('approve', 'step'),
    ('return', 'step'),
    ('create', 'task'),
    ('read', 'task'),
    ('update', 'task'),
    ('delete', 'task'),
    ('assign', 'task'),
    ('manage', 'task'),
    ('comment', 'comment'),
    ('read', 'user')
  );
--> statement-breakpoint

-- Seed: role_permissions for channel-manager
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000003', p.id, 'ALLOW'
FROM permissions p
WHERE p.is_sensitive = false
  AND (p.action, p.resource_type) IN (
    ('create', 'channel'),
    ('read', 'channel'),
    ('update', 'channel'),
    ('read', 'content'),
    ('update', 'content'),
    ('delete', 'content'),
    ('approve', 'step'),
    ('return', 'step'),
    ('create', 'task'),
    ('read', 'task'),
    ('update', 'task'),
    ('delete', 'task'),
    ('assign', 'task'),
    ('manage', 'task'),
    ('comment', 'comment')
  );
--> statement-breakpoint

-- Seed: role_permissions for script-writer
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000004', p.id, 'ALLOW'
FROM permissions p
WHERE p.is_sensitive = false
  AND (p.action, p.resource_type) IN (
    ('read', 'project'),
    ('read', 'content'),
    ('submit', 'task'),
    ('comment', 'comment')
  );
--> statement-breakpoint

-- Seed: role_permissions for editor
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000005', p.id, 'ALLOW'
FROM permissions p
WHERE p.is_sensitive = false
  AND (p.action, p.resource_type) IN (
    ('read', 'project'),
    ('read', 'content'),
    ('submit', 'task'),
    ('comment', 'comment')
  );
--> statement-breakpoint

-- Seed: role_permissions for qa-reviewer
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000006', p.id, 'ALLOW'
FROM permissions p
WHERE p.is_sensitive = false
  AND (p.action, p.resource_type) IN (
    ('read', 'project'),
    ('read', 'content'),
    ('submit', 'task'),
    ('comment', 'comment'),
    ('approve', 'step'),
    ('return', 'step')
  );
--> statement-breakpoint

-- Seed: role_permissions for uploader
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000007', p.id, 'ALLOW'
FROM permissions p
WHERE p.is_sensitive = false
  AND (p.action, p.resource_type) IN (
    ('read', 'project'),
    ('read', 'content'),
    ('submit', 'task'),
    ('comment', 'comment')
  );
--> statement-breakpoint

-- Seed: role_permissions for employee
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000008', p.id, 'ALLOW'
FROM permissions p
WHERE p.is_sensitive = false
  AND (p.action, p.resource_type) IN (
    ('read', 'task'),
    ('submit', 'task'),
    ('comment', 'comment'),
    ('read', 'notification')
  );
--> statement-breakpoint

-- -------- Down --------
-- Reverse migration in dependency order (children before parents).
-- DROP TABLE object_permissions;
-- DROP TABLE user_roles;
-- DROP TABLE role_permissions;
-- DROP TABLE permissions;
-- DROP TABLE roles;
