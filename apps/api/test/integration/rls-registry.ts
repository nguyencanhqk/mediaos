import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { seedUser, type SeededTenant } from "../helpers/seed";

/**
 * SỔ ĐĂNG KÝ bảng có RLS — nguồn cho harness tenant-isolation (G2-5).
 *
 * LUẬT (plan G2-5 / CLAUDE §2 bất biến #1): MỖI bảng nghiệp vụ mới có company_id PHẢI thêm 1 case
 * ở đây. KHÔNG skip. Harness sẽ tự kiểm: không ngữ cảnh ⇒ 0 row; withTenant(A) không thấy hàng của B.
 *
 * GHI CHÚ roles: system roles (company_id IS NULL) ĐỌC được bởi mọi tenant (USING policy cho phép).
 * Harness chỉ seed TENANT role (company_id NOT NULL) để kiểm tra cô lập chéo tenant.
 * Test riêng cần xác minh system roles hiển thị cho mọi tenant — ngoài phạm vi harness này.
 */
export interface RlsTableCase {
  /** Tên hiển thị + tên bảng thật. */
  name: string;
  table: string;
  /**
   * Tên cột dùng để identify hàng trong `SELECT`. Mặc định `"id"`.
   * Junction table không có surrogate key cần ghi rõ cột thay thế (vd: `"role_id"`).
   */
  idColumn?: string;
  /**
   * Bỏ qua test "ngoài ngữ cảnh tenant → 0 row" nếu bảng có hàng global (system rows).
   * Dùng cho `roles` và `role_permissions` có system roles (company_id IS NULL) luôn hiển thị.
   */
  skipNoContext?: boolean;
  /** Seed 1 hàng thuộc tenant `t`, trả về id của hàng (để khẳng định không lọt sang tenant khác). */
  seedRow(direct: Pool, t: SeededTenant): Promise<string>;
}

// ─── Helpers dùng chung cho các bảng có FK chain dài ──────────────────────────

async function seedProject(direct: Pool, companyId: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO projects (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [companyId, `rls-prj-${randomUUID().slice(0, 8)}`],
  );
  return r.rows[0].id as string;
}

async function seedContentItem(direct: Pool, companyId: string, projectId: string): Promise<string> {
  // 0025 đã DROP cột text `content_type` → content_type_id (FK, nullable) mặc định NULL.
  const r = await direct.query(
    `INSERT INTO content_items (company_id, project_id, title, status)
     VALUES ($1, $2, 'rls-ci', 'draft') RETURNING id`,
    [companyId, projectId],
  );
  return r.rows[0].id as string;
}

async function seedPlatformAccount(direct: Pool, companyId: string): Promise<string> {
  // RLS isolation test only — giá trị envelope là DUMMY, KHÔNG phải crypto thật. iv_nonce/auth_tag PHẢI đúng
  // độ dài (12B/16B) để qua octet_length CHECK; secret_ciphertext/encrypted_dek tuỳ ý. Crypto test riêng ở 2c/2e.
  const r = await direct.query(
    `INSERT INTO platform_accounts
       (company_id, platform_id, secret_ciphertext, encrypted_dek, dek_key_version, kms_key_id, iv_nonce, auth_tag)
     VALUES ($1, (SELECT id FROM platforms WHERE code = 'youtube'),
             decode('00','hex'), decode('00','hex'), 1, 'local-dev-kek',
             decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'))
     RETURNING id`,
    [companyId],
  );
  return r.rows[0].id as string;
}

async function seedWorkflowDefinition(direct: Pool, companyId: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO workflow_definitions (company_id, code, name, applies_to, max_approval_level, allow_parallel_steps)
     VALUES ($1, $2, 'RLS Def', 'content_item', 1, false) RETURNING id`,
    [companyId, `rls-def-${randomUUID().slice(0, 8)}`],
  );
  return r.rows[0].id as string;
}

async function seedWorkflowInstance(
  direct: Pool,
  companyId: string,
  definitionId: string,
  contentItemId: string,
  userId: string,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO workflow_instances
       (company_id, workflow_definition_id, content_item_id, created_by, current_step_order, status)
     VALUES ($1, $2, $3, $4, 1, 'active') RETURNING id`,
    [companyId, definitionId, contentItemId, userId],
  );
  return r.rows[0].id as string;
}

async function seedWorkflowStep(
  direct: Pool,
  companyId: string,
  instanceId: string,
  stepOrder = 1,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO workflow_steps
       (company_id, workflow_instance_id, step_order, step_code, step_name, status)
     VALUES ($1, $2, $3, 'script', 'Viết kịch bản', 'not_started') RETURNING id`,
    [companyId, instanceId, stepOrder],
  );
  return r.rows[0].id as string;
}

/** Seed toàn bộ chuỗi FK nhỏ nhất cần cho workflow_step trở lên. */
async function seedWorkflowChain(
  direct: Pool,
  t: SeededTenant,
): Promise<{ userId: string; projectId: string; contentItemId: string; instanceId: string; stepId: string }> {
  const userId = await seedUser(direct, t.companyId, `rls-chain-${randomUUID().slice(0, 8)}@x.test`);
  const projectId = await seedProject(direct, t.companyId);
  const contentItemId = await seedContentItem(direct, t.companyId, projectId);
  const definitionId = await seedWorkflowDefinition(direct, t.companyId);
  const instanceId = await seedWorkflowInstance(direct, t.companyId, definitionId, contentItemId, userId);
  const stepId = await seedWorkflowStep(direct, t.companyId, instanceId);
  return { userId, projectId, contentItemId, instanceId, stepId };
}

// ─── Bảng đăng ký ──────────────────────────────────────────────────────────────

export const RLS_TABLES: RlsTableCase[] = [
  // ── G2 Base ────────────────────────────────────────────────────────────────
  {
    name: "companies",
    table: "companies",
    seedRow: async (_direct, t) => t.companyId,
  },
  {
    name: "users",
    table: "users",
    seedRow: (direct, t) =>
      seedUser(direct, t.companyId, `iso-${randomUUID().slice(0, 8)}@x.test`),
  },
  {
    name: "audit_logs",
    table: "audit_logs",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        "INSERT INTO audit_logs (company_id, action, object_type) VALUES ($1, 'seed', 'company') RETURNING id",
        [t.companyId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "outbox_events",
    table: "outbox_events",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        "INSERT INTO outbox_events (company_id, event_type, payload) VALUES ($1, 'seed.event', '{}'::jsonb) RETURNING id",
        [t.companyId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "dead_letter_events",
    table: "dead_letter_events",
    seedRow: async (direct, t) => {
      const ev = await direct.query(
        "INSERT INTO outbox_events (company_id, event_type, payload) VALUES ($1, 'seed.dl', '{}'::jsonb) RETURNING id",
        [t.companyId],
      );
      const r = await direct.query(
        `INSERT INTO dead_letter_events (company_id, event_id, consumer_name, event_type, payload, error)
         VALUES ($1, $2, 'seed-consumer', 'seed.dl', '{}'::jsonb, 'seed') RETURNING id`,
        [t.companyId, ev.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "refresh_tokens",
    table: "refresh_tokens",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `rt-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO refresh_tokens (company_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '30 days') RETURNING id`,
        [t.companyId, u, randomUUID()],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "password_reset_tokens",
    table: "password_reset_tokens",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `prt-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO password_reset_tokens (company_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour') RETURNING id`,
        [t.companyId, u, randomUUID()],
      );
      return r.rows[0].id as string;
    },
  },
  // processed_events: bảng hạ tầng worker (không RLS, app không có grant) → KHÔNG đưa vào harness app-path.
  // permissions: global catalog (không RLS, không company_id) → KHÔNG đưa vào harness tenant-isolation.
  {
    name: "roles (tenant-scoped only)",
    table: "roles",
    skipNoContext: true, // system roles (company_id IS NULL) are visible without tenant context by design
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO roles (company_id, name, is_system)
         VALUES ($1, $2, false) RETURNING id`,
        [t.companyId, `seed-role-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "role_permissions",
    table: "role_permissions",
    idColumn: "role_id",
    skipNoContext: true, // system role_permissions (for system roles) visible without context by design
    seedRow: async (direct, t) => {
      const roleRes = await direct.query(
        `INSERT INTO roles (company_id, name, is_system)
         VALUES ($1, $2, false) RETURNING id`,
        [t.companyId, `rp-seed-role-${randomUUID().slice(0, 8)}`],
      );
      const roleId = roleRes.rows[0].id as string;
      const permRes = await direct.query(
        `SELECT id FROM permissions WHERE action = 'read' AND resource_type = 'company' LIMIT 1`,
      );
      const permId = permRes.rows[0].id as string;
      await direct.query(
        `INSERT INTO role_permissions (role_id, permission_id, effect) VALUES ($1, $2, 'ALLOW')`,
        [roleId, permId],
      );
      return roleId;
    },
  },
  {
    name: "user_roles",
    table: "user_roles",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `ur-${randomUUID().slice(0, 8)}@x.test`);
      const roleRes = await direct.query(
        `SELECT id FROM roles WHERE name = 'employee' AND company_id IS NULL LIMIT 1`,
      );
      const roleId = roleRes.rows[0].id as string;
      const r = await direct.query(
        `INSERT INTO user_roles (user_id, role_id, company_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [u, roleId, t.companyId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "object_permissions",
    table: "object_permissions",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `op-${randomUUID().slice(0, 8)}@x.test`);
      const permRes = await direct.query(
        `SELECT id FROM permissions WHERE action = 'read' AND resource_type = 'project' LIMIT 1`,
      );
      const permId = permRes.rows[0].id as string;
      const r = await direct.query(
        `INSERT INTO object_permissions
           (company_id, subject_type, subject_id, permission_id, object_type, object_id, effect)
         VALUES ($1, 'user', $2, $3, 'project', $4, 'ALLOW') RETURNING id`,
        [t.companyId, u, permId, randomUUID()],
      );
      return r.rows[0].id as string;
    },
  },

  // ── G4-1 Org ────────────────────────────────────────────────────────────────
  {
    name: "org_units",
    table: "org_units",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO org_units (company_id, name, type) VALUES ($1, $2, 'department') RETURNING id`,
        [t.companyId, `rls-dept-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "teams",
    table: "teams",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO teams (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `rls-team-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "team_members",
    table: "team_members",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `tm-${randomUUID().slice(0, 8)}@x.test`);
      const teamRes = await direct.query(
        `INSERT INTO teams (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `rls-tm-team-${randomUUID().slice(0, 8)}`],
      );
      const r = await direct.query(
        `INSERT INTO team_members (company_id, team_id, user_id, role_name)
         VALUES ($1, $2, $3, 'member') RETURNING id`,
        [t.companyId, teamRes.rows[0].id, u],
      );
      return r.rows[0].id as string;
    },
  },

  // ── G5 Positions & Employees ─────────────────────────────────────────────────
  {
    name: "positions",
    table: "positions",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO positions (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `rls-pos-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "employee_profiles",
    table: "employee_profiles",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `emp-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
        [t.companyId, u],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "employee_manager_relations",
    table: "employee_manager_relations",
    seedRow: async (direct, t) => {
      const emp = await seedUser(direct, t.companyId, `emr-emp-${randomUUID().slice(0, 8)}@x.test`);
      const mgr = await seedUser(direct, t.companyId, `emr-mgr-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO employee_manager_relations
           (company_id, employee_user_id, manager_user_id, relation_type)
         VALUES ($1, $2, $3, 'direct_manager') RETURNING id`,
        [t.companyId, emp, mgr],
      );
      return r.rows[0].id as string;
    },
  },

  // ── G4-2 Media ──────────────────────────────────────────────────────────────
  {
    name: "channels",
    table: "channels",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO channels (company_id, name, platform, platform_id, status)
         VALUES ($1, $2, 'youtube', (SELECT id FROM platforms WHERE code = 'youtube'), 'active') RETURNING id`,
        [t.companyId, `rls-ch-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "channel_members",
    table: "channel_members",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `chm-${randomUUID().slice(0, 8)}@x.test`);
      const chRes = await direct.query(
        `INSERT INTO channels (company_id, name, platform, platform_id, status)
         VALUES ($1, $2, 'youtube', (SELECT id FROM platforms WHERE code = 'youtube'), 'active') RETURNING id`,
        [t.companyId, `rls-chm-ch-${randomUUID().slice(0, 8)}`],
      );
      const r = await direct.query(
        `INSERT INTO channel_members (company_id, channel_id, user_id, role_in_channel, status)
         VALUES ($1, $2, $3, 'channel_manager', 'active') RETURNING id`,
        [t.companyId, chRes.rows[0].id, u],
      );
      return r.rows[0].id as string;
    },
  },
  // ── G6-2 Platform Accounts (🔒 crown-jewel) ─────────────────────────────────
  // encryption_keys KHÔNG ở đây: registry GLOBAL (không company_id, không RLS) — như `permissions`.
  {
    name: "platform_accounts",
    table: "platform_accounts",
    seedRow: async (direct, t) => seedPlatformAccount(direct, t.companyId),
  },
  {
    name: "channel_accounts",
    table: "channel_accounts",
    seedRow: async (direct, t) => {
      const chRes = await direct.query(
        `INSERT INTO channels (company_id, name, platform, platform_id, status)
         VALUES ($1, $2, 'youtube', (SELECT id FROM platforms WHERE code = 'youtube'), 'active') RETURNING id`,
        [t.companyId, `rls-ca-ch-${randomUUID().slice(0, 8)}`],
      );
      const accountId = await seedPlatformAccount(direct, t.companyId);
      const r = await direct.query(
        `INSERT INTO channel_accounts (company_id, channel_id, platform_account_id, relation_type)
         VALUES ($1, $2, $3, 'main_google_account') RETURNING id`,
        [t.companyId, chRes.rows[0].id, accountId],
      );
      return r.rows[0].id as string;
    },
  },

  {
    name: "projects",
    table: "projects",
    seedRow: async (direct, t) => seedProject(direct, t.companyId),
  },
  {
    name: "project_channels",
    table: "project_channels",
    seedRow: async (direct, t) => {
      const projectId = await seedProject(direct, t.companyId);
      const chRes = await direct.query(
        `INSERT INTO channels (company_id, name, platform, platform_id, status)
         VALUES ($1, $2, 'youtube', (SELECT id FROM platforms WHERE code = 'youtube'), 'active') RETURNING id`,
        [t.companyId, `rls-pch-${randomUUID().slice(0, 8)}`],
      );
      const r = await direct.query(
        `INSERT INTO project_channels (company_id, project_id, channel_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [t.companyId, projectId, chRes.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "project_teams",
    table: "project_teams",
    seedRow: async (direct, t) => {
      const projectId = await seedProject(direct, t.companyId);
      const teamRes = await direct.query(
        `INSERT INTO teams (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `rls-pt-team-${randomUUID().slice(0, 8)}`],
      );
      const r = await direct.query(
        `INSERT INTO project_teams (company_id, project_id, team_id, role_in_project)
         VALUES ($1, $2, $3, 'production') RETURNING id`,
        [t.companyId, projectId, teamRes.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "project_members",
    table: "project_members",
    seedRow: async (direct, t) => {
      const projectId = await seedProject(direct, t.companyId);
      const u = await seedUser(direct, t.companyId, `pm-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO project_members (company_id, project_id, user_id, role_in_project, status)
         VALUES ($1, $2, $3, 'member', 'active') RETURNING id`,
        [t.companyId, projectId, u],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "content_items",
    table: "content_items",
    seedRow: async (direct, t) => {
      const projectId = await seedProject(direct, t.companyId);
      return seedContentItem(direct, t.companyId, projectId);
    },
  },
  {
    name: "content_types",
    table: "content_types",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO content_types (company_id, name, code) VALUES ($1, $2, $3) RETURNING id`,
        [t.companyId, `rls-ct-${randomUUID().slice(0, 8)}`, `rls-ct-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "content_channels",
    table: "content_channels",
    seedRow: async (direct, t) => {
      const projectId = await seedProject(direct, t.companyId);
      const contentItemId = await seedContentItem(direct, t.companyId, projectId);
      const chRes = await direct.query(
        `INSERT INTO channels (company_id, name, platform, platform_id, status)
         VALUES ($1, $2, 'youtube', (SELECT id FROM platforms WHERE code = 'youtube'), 'active') RETURNING id`,
        [t.companyId, `rls-cc-ch-${randomUUID().slice(0, 8)}`],
      );
      const r = await direct.query(
        `INSERT INTO content_channels (company_id, content_item_id, channel_id, publish_status)
         VALUES ($1, $2, $3, 'not_scheduled') RETURNING id`,
        [t.companyId, contentItemId, chRes.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "content_assets",
    table: "content_assets",
    seedRow: async (direct, t) => {
      const projectId = await seedProject(direct, t.companyId);
      const contentItemId = await seedContentItem(direct, t.companyId, projectId);
      const r = await direct.query(
        `INSERT INTO content_assets (company_id, content_item_id, asset_type, name, version, version_group_id)
         VALUES ($1, $2, 'script', 'rls-asset', 1, $3) RETURNING id`,
        [t.companyId, contentItemId, randomUUID()],
      );
      return r.rows[0].id as string;
    },
  },

  // ── G4-3 Workflow ────────────────────────────────────────────────────────────
  {
    name: "workflow_definitions",
    table: "workflow_definitions",
    seedRow: (direct, t) => seedWorkflowDefinition(direct, t.companyId),
  },
  {
    name: "workflow_definition_steps",
    table: "workflow_definition_steps",
    seedRow: async (direct, t) => {
      const defId = await seedWorkflowDefinition(direct, t.companyId);
      const r = await direct.query(
        `INSERT INTO workflow_definition_steps
           (company_id, workflow_definition_id, step_order, code, name, node_key, default_task_title)
         VALUES ($1, $2, 1, 'script', 'Viết kịch bản', 'script', 'Viết kịch bản') RETURNING id`,
        [t.companyId, defId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "step_transitions",
    table: "step_transitions",
    seedRow: async (direct, t) => {
      const defId = await seedWorkflowDefinition(direct, t.companyId);
      const r = await direct.query(
        `INSERT INTO step_transitions
           (company_id, workflow_definition_id, from_state, event, to_state, written_by)
         VALUES ($1, $2, 'not_started', 'start', 'in_progress', 'service') RETURNING id`,
        [t.companyId, defId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "workflow_instances",
    table: "workflow_instances",
    seedRow: async (direct, t) => {
      const { instanceId } = await seedWorkflowChain(direct, t);
      return instanceId;
    },
  },
  {
    name: "workflow_steps",
    table: "workflow_steps",
    seedRow: async (direct, t) => {
      const { stepId } = await seedWorkflowChain(direct, t);
      return stepId;
    },
  },

  // ── G7 Workflow Builder (template DAG + checklist) ───────────────────────────
  {
    name: "workflow_step_dependencies",
    table: "workflow_step_dependencies",
    seedRow: async (direct, t) => {
      const defId = await seedWorkflowDefinition(direct, t.companyId);
      const s1 = await direct.query(
        `INSERT INTO workflow_definition_steps
           (company_id, workflow_definition_id, step_order, code, name, node_key, default_task_title)
         VALUES ($1, $2, 1, 'script', 'Viết kịch bản', 'script', 'Viết kịch bản') RETURNING id`,
        [t.companyId, defId],
      );
      const s2 = await direct.query(
        `INSERT INTO workflow_definition_steps
           (company_id, workflow_definition_id, step_order, code, name, node_key, default_task_title)
         VALUES ($1, $2, 2, 'edit', 'Dựng video', 'edit', 'Dựng video') RETURNING id`,
        [t.companyId, defId],
      );
      const r = await direct.query(
        `INSERT INTO workflow_step_dependencies
           (company_id, workflow_definition_id, from_step_id, to_step_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [t.companyId, defId, s1.rows[0].id, s2.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "checklists",
    table: "checklists",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO checklists (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `rls-checklist-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "checklist_items",
    table: "checklist_items",
    seedRow: async (direct, t) => {
      const clRes = await direct.query(
        `INSERT INTO checklists (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `rls-cl-${randomUUID().slice(0, 8)}`],
      );
      const r = await direct.query(
        `INSERT INTO checklist_items (company_id, checklist_id, label, is_required, sort_order)
         VALUES ($1, $2, 'rls-item', true, 0) RETURNING id`,
        [t.companyId, clRes.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "workflow_step_checklist_states",
    table: "workflow_step_checklist_states",
    seedRow: async (direct, t) => {
      const { stepId } = await seedWorkflowChain(direct, t);
      const clRes = await direct.query(
        `INSERT INTO checklists (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `rls-wscs-cl-${randomUUID().slice(0, 8)}`],
      );
      const itemRes = await direct.query(
        `INSERT INTO checklist_items (company_id, checklist_id, label) VALUES ($1, $2, 'rls-wscs-item') RETURNING id`,
        [t.companyId, clRes.rows[0].id],
      );
      const r = await direct.query(
        `INSERT INTO workflow_step_checklist_states (company_id, workflow_step_id, checklist_item_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [t.companyId, stepId, itemRes.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },

  // ── G4-4 Tasks & Comments ───────────────────────────────────────────────────
  {
    name: "tasks",
    table: "tasks",
    // tasks có thể tồn tại không cần workflow_step (task_type=office, workflow_step_id nullable)
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round)
         VALUES ($1, 'office', 'rls-task', 'not_started', 'initial', 0) RETURNING id`,
        [t.companyId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "task_comments",
    table: "task_comments",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `tc-${randomUUID().slice(0, 8)}@x.test`);
      const taskRes = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round)
         VALUES ($1, 'office', 'rls-task-for-comment', 'not_started', 'initial', 0) RETURNING id`,
        [t.companyId],
      );
      const r = await direct.query(
        `INSERT INTO task_comments (company_id, task_id, user_id, body)
         VALUES ($1, $2, $3, 'rls-comment') RETURNING id`,
        [t.companyId, taskRes.rows[0].id, u],
      );
      return r.rows[0].id as string;
    },
  },

  // ── G4-5 Approval / Defect ───────────────────────────────────────────────────
  {
    name: "approval_requests",
    table: "approval_requests",
    seedRow: async (direct, t) => {
      const { stepId, userId } = await seedWorkflowChain(direct, t);
      const r = await direct.query(
        `INSERT INTO approval_requests
           (company_id, workflow_step_id, requested_by, status, current_level, max_level)
         VALUES ($1, $2, $3, 'pending', 1, 1) RETURNING id`,
        [t.companyId, stepId, userId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "approval_steps",
    table: "approval_steps",
    seedRow: async (direct, t) => {
      const { stepId, userId } = await seedWorkflowChain(direct, t);
      const reqRes = await direct.query(
        `INSERT INTO approval_requests
           (company_id, workflow_step_id, requested_by, status, current_level, max_level)
         VALUES ($1, $2, $3, 'approved', 1, 1) RETURNING id`,
        [t.companyId, stepId, userId],
      );
      const r = await direct.query(
        `INSERT INTO approval_steps
           (company_id, approval_request_id, level, approver_user_id, decision)
         VALUES ($1, $2, 1, $3, 'approved') RETURNING id`,
        [t.companyId, reqRes.rows[0].id, userId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "defects",
    table: "defects",
    seedRow: async (direct, t) => {
      const { stepId } = await seedWorkflowChain(direct, t);
      const r = await direct.query(
        `INSERT INTO defects (company_id, workflow_step_id, description)
         VALUES ($1, $2, 'rls-defect') RETURNING id`,
        [t.companyId, stepId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "workflow_step_instance_locks",
    table: "workflow_step_instance_locks",
    seedRow: async (direct, t) => {
      const { instanceId } = await seedWorkflowChain(direct, t);
      // Cần 2 steps (locked + caused_by); step đầu đã có từ seedWorkflowChain
      const step2Res = await direct.query(
        `INSERT INTO workflow_steps
           (company_id, workflow_instance_id, step_order, step_code, step_name, status)
         VALUES ($1, $2, 2, 'edit', 'Dựng video', 'not_started') RETURNING id`,
        [t.companyId, instanceId],
      );
      const lockedStepId = step2Res.rows[0].id as string;
      // step_order=1 từ seedWorkflowChain
      const step1Res = await direct.query(
        `SELECT id FROM workflow_steps WHERE workflow_instance_id = $1 AND step_order = 1`,
        [instanceId],
      );
      const causedByStepId = step1Res.rows[0].id as string;
      const r = await direct.query(
        `INSERT INTO workflow_step_instance_locks
           (company_id, locked_step_id, caused_by_step_id, lock_reason)
         VALUES ($1, $2, $3, 'downstream_blocked_by_revision') RETURNING id`,
        [t.companyId, lockedStepId, causedByStepId],
      );
      return r.rows[0].id as string;
    },
  },

  // ── G4-6 Communication ────────────────────────────────────────────────────────
  {
    name: "notifications",
    table: "notifications",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `noti-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO notifications (company_id, user_id, type, body)
         VALUES ($1, $2, 'general', 'rls-noti') RETURNING id`,
        [t.companyId, u],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "chat_rooms",
    table: "chat_rooms",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO chat_rooms (company_id, room_type, name)
         VALUES ($1, 'direct', $2) RETURNING id`,
        [t.companyId, `rls-room-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "chat_room_members",
    table: "chat_room_members",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `crm-${randomUUID().slice(0, 8)}@x.test`);
      const roomRes = await direct.query(
        `INSERT INTO chat_rooms (company_id, room_type, name)
         VALUES ($1, 'direct', $2) RETURNING id`,
        [t.companyId, `rls-room-m-${randomUUID().slice(0, 8)}`],
      );
      const r = await direct.query(
        `INSERT INTO chat_room_members (company_id, room_id, user_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [t.companyId, roomRes.rows[0].id, u],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "chat_messages",
    table: "chat_messages",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `cm-${randomUUID().slice(0, 8)}@x.test`);
      const roomRes = await direct.query(
        `INSERT INTO chat_rooms (company_id, room_type, name)
         VALUES ($1, 'direct', $2) RETURNING id`,
        [t.companyId, `rls-room-msg-${randomUUID().slice(0, 8)}`],
      );
      const r = await direct.query(
        `INSERT INTO chat_messages (company_id, room_id, sender_id, body)
         VALUES ($1, $2, $3, 'rls-msg') RETURNING id`,
        [t.companyId, roomRes.rows[0].id, u],
      );
      return r.rows[0].id as string;
    },
  },

  // ── G13 Finance (Revenue/Cost/Profit/Expense) — APPEND-ONLY ledgers + mutable allocation/request ──
  // Mỗi bảng có company_id + RLS+FORCE → PHẢI ở harness (rls-guards "không bảng nào company_id thiếu case").
  {
    name: "revenue_records",
    table: "revenue_records",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `rev-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO revenue_records
           (company_id, amount, currency, revenue_date, source, entered_by, entry_kind)
         VALUES ($1, 1000.00, 'VND', current_date, 'manual', $2, 'original') RETURNING id`,
        [t.companyId, u],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "cost_records",
    table: "cost_records",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `cost-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO cost_records
           (company_id, cost_type, amount, currency, cost_date, entered_by, entry_kind)
         VALUES ($1, 'other', 500.00, 'VND', current_date, $2, 'original') RETURNING id`,
        [t.companyId, u],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "cost_allocations",
    table: "cost_allocations",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `alloc-${randomUUID().slice(0, 8)}@x.test`);
      const costRes = await direct.query(
        `INSERT INTO cost_records
           (company_id, cost_type, amount, currency, cost_date, entered_by, entry_kind)
         VALUES ($1, 'other', 500.00, 'VND', current_date, $2, 'original') RETURNING id`,
        [t.companyId, u],
      );
      const projectId = await seedProject(direct, t.companyId);
      const r = await direct.query(
        `INSERT INTO cost_allocations
           (company_id, cost_record_id, allocation_run_id, allocation_target_type,
            allocation_target_id, allocation_method, allocated_amount)
         VALUES ($1, $2, $3, 'project', $4, 'equal_split', 500.00) RETURNING id`,
        [t.companyId, costRes.rows[0].id, randomUUID(), projectId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "profit_snapshots",
    table: "profit_snapshots",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `pf-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO profit_snapshots
           (company_id, target_type, target_id, period_start, period_end,
            total_revenue, total_direct_cost, total_allocated_cost, total_cost, profit, created_by)
         VALUES ($1, 'company', NULL, current_date, current_date,
                 1000.00, 400.00, 100.00, 500.00, 500.00, $2) RETURNING id`,
        [t.companyId, u],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "expense_requests",
    table: "expense_requests",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `exp-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO expense_requests
           (company_id, requested_by, title, amount, currency, expense_type, status)
         VALUES ($1, $2, 'rls-expense', 250.00, 'VND', 'other', 'pending') RETURNING id`,
        [t.companyId, u],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "expense_approvals",
    table: "expense_approvals",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `expa-${randomUUID().slice(0, 8)}@x.test`);
      const reqRes = await direct.query(
        `INSERT INTO expense_requests
           (company_id, requested_by, title, amount, currency, expense_type, status)
         VALUES ($1, $2, 'rls-expense-for-approval', 250.00, 'VND', 'other', 'approved') RETURNING id`,
        [t.companyId, u],
      );
      const r = await direct.query(
        `INSERT INTO expense_approvals
           (company_id, expense_request_id, approval_level, approver_user_id, decision)
         VALUES ($1, $2, 1, $3, 'approved') RETURNING id`,
        [t.companyId, reqRes.rows[0].id, u],
      );
      return r.rows[0].id as string;
    },
  },
];
