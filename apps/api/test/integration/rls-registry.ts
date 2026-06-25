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

async function seedContentItem(
  direct: Pool,
  companyId: string,
  projectId: string,
): Promise<string> {
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

async function seedWebhookEndpoint(direct: Pool, companyId: string): Promise<string> {
  // RLS isolation test only — envelope values là DUMMY. iv_nonce/auth_tag PHẢI đúng độ dài (12B/16B) để
  // qua octet_length CHECK; secret_ciphertext/encrypted_dek tuỳ ý. Crypto thật ở webhooks-secret int-spec.
  const r = await direct.query(
    `INSERT INTO webhook_endpoints
       (company_id, url, secret_ciphertext, encrypted_dek, dek_key_version, kms_key_id, iv_nonce, auth_tag, enc_algo)
     VALUES ($1, 'https://hooks.example.com/rls',
             decode('00','hex'), decode('00','hex'), 1, 'local-dev-kek',
             decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), 'AES-256-GCM')
     RETURNING id`,
    [companyId],
  );
  return r.rows[0].id as string;
}

async function seedMailConfig(direct: Pool, companyId: string): Promise<string> {
  // CS-8 RLS isolation test only — envelope SMTP password là DUMMY (iv 12B / tag 16B đúng octet_length CHECK);
  // crypto thật ở mail-config-envelope int-spec. host/port/username/from_email NOT NULL.
  const r = await direct.query(
    `INSERT INTO company_mail_configs
       (company_id, scope, host, port, username, from_email,
        secret_ciphertext, encrypted_dek, dek_key_version, kms_key_id, iv_nonce, auth_tag, enc_algo)
     VALUES ($1, 'default', 'smtp.example.com', 587, 'rls@x.test', 'from@x.test',
             decode('00','hex'), decode('00','hex'), 1, 'local-dev-kek',
             decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), 'AES-256-GCM')
     RETURNING id`,
    [companyId],
  );
  return r.rows[0].id as string;
}

async function seedSecurityPolicy(direct: Pool, companyId: string): Promise<string> {
  // CS-9 RLS isolation test only — 1 hàng/công ty (UNIQUE company_id); mọi cờ/allowlist dùng default.
  const r = await direct.query(
    `INSERT INTO company_security_policies (company_id) VALUES ($1) RETURNING id`,
    [companyId],
  );
  return r.rows[0].id as string;
}

async function seedUserInvite(direct: Pool, companyId: string): Promise<string> {
  // CS-10 RLS isolation test only — token_hash DUMMY (không token thật); status pending; expires_at +72h.
  const r = await direct.query(
    `INSERT INTO user_invites (company_id, email, full_name, token_hash, status, expires_at, invited_by)
     VALUES ($1, 'rls-invite@x.test', 'RLS Invite', 'deadbeef', 'pending', now() + interval '72 hours', $1)
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
): Promise<{
  userId: string;
  projectId: string;
  contentItemId: string;
  instanceId: string;
  stepId: string;
}> {
  const userId = await seedUser(
    direct,
    t.companyId,
    `rls-chain-${randomUUID().slice(0, 8)}@x.test`,
  );
  const projectId = await seedProject(direct, t.companyId);
  const contentItemId = await seedContentItem(direct, t.companyId, projectId);
  const definitionId = await seedWorkflowDefinition(direct, t.companyId);
  const instanceId = await seedWorkflowInstance(
    direct,
    t.companyId,
    definitionId,
    contentItemId,
    userId,
  );
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
    seedRow: (direct, t) => seedUser(direct, t.companyId, `iso-${randomUUID().slice(0, 8)}@x.test`),
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
    name: "dead_letter_alerts",
    table: "dead_letter_alerts",
    // G2-4 alerting (mig 0170) — append-only, company_id NOT NULL + RLS+FORCE. Seed direct (worker-written
    // fact). KHÔNG skipNoContext (mọi hàng tenant-scoped, không hàng global).
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO dead_letter_alerts (company_id, window_start, dead_letter_count, threshold)
         VALUES ($1, date_trunc('hour', now()), 9, 5) RETURNING id`,
        [t.companyId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "security_alerts",
    table: "security_alerts",
    // G16-1b security alerting (mig 0122) — append-only, company_id NOT NULL + RLS+FORCE. Seed direct.
    // KHÔNG skipNoContext (mọi hàng tenant-scoped, không hàng global).
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO security_alerts (company_id, alert_type, severity, subject)
         VALUES ($1, 'repeated_reauth_failure', 'high', 'rls-subject') RETURNING id`,
        [t.companyId],
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
  {
    name: "user_totp",
    table: "user_totp",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `totp-${randomUUID().slice(0, 8)}@x.test`);
      // Envelope cols là placeholder thoả CHECK (iv 12B, tag 16B) — harness chỉ kiểm RLS, không crypto thật.
      const r = await direct.query(
        `INSERT INTO user_totp (company_id, user_id, secret_ciphertext, encrypted_dek, dek_key_version, kms_key_id, iv_nonce, auth_tag)
         VALUES ($1, $2, $3, $4, 1, 'local-dev-kek', $5, $6) RETURNING id`,
        [t.companyId, u, Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(12), Buffer.alloc(16)],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "user_recovery_codes",
    table: "user_recovery_codes",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `rec-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO user_recovery_codes (company_id, user_id, code_hash)
         VALUES ($1, $2, $3) RETURNING id`,
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

  // ── S2-HR-DB-1 (mig 0442) HR-Core master/lifecycle ──────────────────────────
  // company_id NOT NULL + RLS+FORCE → PHẢI ở harness. KHÔNG skipNoContext (mọi hàng tenant-scoped).
  {
    name: "job_levels",
    table: "job_levels",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO job_levels (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `rls-jl-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "contract_types",
    table: "contract_types",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO contract_types (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `rls-ct-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "employee_code_configs",
    table: "employee_code_configs",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO employee_code_configs (company_id, prefix) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `JL${randomUUID().slice(0, 4)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "employee_status_histories",
    table: "employee_status_histories",
    // Append-only (app role chỉ SELECT,INSERT) — harness mutate-deny dùng direct (superuser) để seed; OK.
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `esh-${randomUUID().slice(0, 8)}@x.test`);
      const emp = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
        [t.companyId, u],
      );
      const r = await direct.query(
        `INSERT INTO employee_status_histories (company_id, employee_id, new_status)
         VALUES ($1, $2, 'active') RETURNING id`,
        [t.companyId, emp.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },
  {
    // S2-HR-BE-4 (mig 0451): bảng chính self-service. company_id NOT NULL + RLS+FORCE → PHẢI ở harness.
    // KHÔNG skipNoContext (mọi hàng tenant-scoped). old/new_values/changed_fields NOT NULL jsonb.
    name: "profile_change_requests",
    table: "profile_change_requests",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `pcr-${randomUUID().slice(0, 8)}@x.test`);
      const emp = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
        [t.companyId, u],
      );
      const r = await direct.query(
        `INSERT INTO profile_change_requests
           (company_id, employee_id, requested_by, status, old_values, new_values, changed_fields)
         VALUES ($1, $2, $3, 'Pending', '{}'::jsonb, '{"phone":"1"}'::jsonb, '["phone"]'::jsonb)
         RETURNING id`,
        [t.companyId, emp.rows[0].id, u],
      );
      return r.rows[0].id as string;
    },
  },
  {
    // S2-HR-BE-4 (mig 0451): log áp-dụng APPEND-ONLY (app role chỉ SELECT,INSERT). harness mutate-deny
    // dùng direct (superuser) để seed. company_id NOT NULL + RLS+FORCE → PHẢI ở harness. KHÔNG skipNoContext.
    name: "employee_profile_change_histories",
    table: "employee_profile_change_histories",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `epch-${randomUUID().slice(0, 8)}@x.test`);
      const emp = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
        [t.companyId, u],
      );
      const r = await direct.query(
        `INSERT INTO employee_profile_change_histories
           (company_id, employee_id, field_name, old_value, new_value)
         VALUES ($1, $2, 'phone', '"old"'::jsonb, '"new"'::jsonb) RETURNING id`,
        [t.companyId, emp.rows[0].id],
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
  // ── B4 Task attachments (mig 0190 — real file upload metadata) ───────────────
  // company_id + RLS+FORCE → PHẢI ở harness (rls-guards "không bảng nào company_id thiếu case").
  // Bảng con của tasks (FK task_id) → seed task office trước. KHÔNG skipNoContext (mọi hàng tenant-scoped).
  {
    name: "task_attachments",
    table: "task_attachments",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `ta-${randomUUID().slice(0, 8)}@x.test`);
      const taskRes = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round)
         VALUES ($1, 'office', 'rls-task-for-attachment', 'not_started', 'initial', 0) RETURNING id`,
        [t.companyId],
      );
      const taskId = taskRes.rows[0].id as string;
      const r = await direct.query(
        `INSERT INTO task_attachments
           (company_id, task_id, uploaded_by, storage_key, file_name, content_type, size_bytes)
         VALUES ($1, $2, $3, $4, 'rls.pdf', 'application/pdf', 100) RETURNING id`,
        [t.companyId, taskId, u, `${t.companyId}/tasks/${taskId}/${randomUUID()}`],
      );
      return r.rows[0].id as string;
    },
  },

  // ── PM-1 apps/projects (project_states / labels / task_labels — mig 0420) ─────
  // company_id + RLS+FORCE → PHẢI ở harness (rls-guards "không bảng nào company_id thiếu case").
  // project_states/labels: soft-delete. task_labels: link M:N hard-DELETE. KHÔNG skipNoContext (tenant-scoped).
  {
    name: "project_states",
    table: "project_states",
    seedRow: async (direct, t) => {
      const projectId = await seedProject(direct, t.companyId);
      const r = await direct.query(
        `INSERT INTO project_states (company_id, project_id, name, state_group, color, sort_order)
         VALUES ($1, $2, 'rls-state', 'unstarted', '#64748b', 0) RETURNING id`,
        [t.companyId, projectId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "labels",
    table: "labels",
    seedRow: async (direct, t) => {
      const projectId = await seedProject(direct, t.companyId);
      const r = await direct.query(
        `INSERT INTO labels (company_id, project_id, name, color)
         VALUES ($1, $2, $3, '#6366f1') RETURNING id`,
        [t.companyId, projectId, `rls-label-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "task_labels",
    table: "task_labels",
    seedRow: async (direct, t) => {
      const projectId = await seedProject(direct, t.companyId);
      const taskRes = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round, project_id)
         VALUES ($1, 'office', 'rls-task-for-label', 'not_started', 'initial', 0, $2) RETURNING id`,
        [t.companyId, projectId],
      );
      const labelRes = await direct.query(
        `INSERT INTO labels (company_id, project_id, name, color)
         VALUES ($1, $2, $3, '#6366f1') RETURNING id`,
        [t.companyId, projectId, `rls-tl-label-${randomUUID().slice(0, 8)}`],
      );
      const r = await direct.query(
        `INSERT INTO task_labels (company_id, task_id, label_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [t.companyId, taskRes.rows[0].id, labelRes.rows[0].id],
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

  // ── G8-1 Approval rules (multi-level — migration 0080) ───────────────────────
  {
    name: "approval_rules",
    table: "approval_rules",
    seedRow: async (direct, t) => {
      const { stepId, userId } = await seedWorkflowChain(direct, t);
      const r = await direct.query(
        `INSERT INTO approval_rules (company_id, workflow_step_id, level, approver_user_id)
         VALUES ($1, $2, 1, $3) RETURNING id`,
        [t.companyId, stepId, userId],
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
  // ── G10 Notification — rules + preferences (mig 0051) ────────────────────────
  // company_id + RLS+FORCE → PHẢI ở harness (rls-guards "không bảng nào company_id thiếu case").
  {
    name: "notification_rules",
    table: "notification_rules",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO notification_rules (company_id, notification_type, enabled)
         VALUES ($1, 'general', true) RETURNING id`,
        [t.companyId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "notification_preferences",
    table: "notification_preferences",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `npref-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO notification_preferences (company_id, user_id, notification_type, enabled)
         VALUES ($1, $2, 'general', true) RETURNING id`,
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

  // ── G11 HR — Attendance (mig 0061) ───────────────────────────────────────────
  // Chống XANH-GIẢ (rủi ro #1): 6 bảng HR có company_id ⇒ rls-guards.int-spec sẽ ĐỎ
  // ("bảng có company_id chưa đăng ký harness") nếu thiếu — và tenant-isolation bỏ sót cô lập chéo
  // tenant. KHÔNG skipNoContext (mọi hàng đều tenant-scoped, company_id NOT NULL, không hàng global).
  {
    name: "work_schedules",
    table: "work_schedules",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO work_schedules (company_id, name, start_time, end_time)
         VALUES ($1, $2, '09:00', '18:00') RETURNING id`,
        [t.companyId, `rls-sched-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "attendance_records",
    table: "attendance_records",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `att-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO attendance_records (company_id, user_id, work_date, status)
         VALUES ($1, $2, '2024-06-03', 'missing_checkin') RETURNING id`,
        [t.companyId, u],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "attendance_adjustment_requests",
    table: "attendance_adjustment_requests",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `adj-${randomUUID().slice(0, 8)}@x.test`);
      // task_type='hr' INSERT vào CHUNG bảng tasks (BẤT BIẾN #4) — KHÔNG bảng task riêng.
      const taskRes = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round)
         VALUES ($1, 'hr', 'rls-adj-task', 'not_started', 'initial', 0) RETURNING id`,
        [t.companyId],
      );
      const r = await direct.query(
        `INSERT INTO attendance_adjustment_requests
           (company_id, user_id, work_date, requested_check_in_at, reason, status, task_id)
         VALUES ($1, $2, '2024-06-03', '2024-06-03T02:00:00Z', 'rls-reason', 'pending', $3) RETURNING id`,
        [t.companyId, u, taskRes.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "attendance_periods",
    table: "attendance_periods",
    // KHÔNG có deleted_at (append/update-only). period_month phải khớp CHECK '^\d{4}-(0[1-9]|1[0-2])$'.
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO attendance_periods (company_id, period_month, status)
         VALUES ($1, '2024-06', 'open') RETURNING id`,
        [t.companyId],
      );
      return r.rows[0].id as string;
    },
  },

  // ── G11 HR — Leave (mig 0062) ────────────────────────────────────────────────
  {
    name: "leave_types",
    table: "leave_types",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO leave_types (company_id, name, code)
         VALUES ($1, 'rls-lt', $2) RETURNING id`,
        [t.companyId, `rls-lt-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "leave_requests",
    table: "leave_requests",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `lr-${randomUUID().slice(0, 8)}@x.test`);
      const ltRes = await direct.query(
        `INSERT INTO leave_types (company_id, name, code)
         VALUES ($1, 'rls-lr-lt', $2) RETURNING id`,
        [t.companyId, `rls-lr-lt-${randomUUID().slice(0, 8)}`],
      );
      const r = await direct.query(
        `INSERT INTO leave_requests
           (company_id, user_id, leave_type_id, start_date, end_date, total_days, status)
         VALUES ($1, $2, $3, '2024-06-03', '2024-06-03', 1, 'pending') RETURNING id`,
        [t.companyId, u, ltRes.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "leave_balances",
    table: "leave_balances",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `lb-${randomUUID().slice(0, 8)}@x.test`);
      const ltRes = await direct.query(
        `INSERT INTO leave_types (company_id, name, code)
         VALUES ($1, 'rls-lb-lt', $2) RETURNING id`,
        [t.companyId, `rls-lb-lt-${randomUUID().slice(0, 8)}`],
      );
      const r = await direct.query(
        `INSERT INTO leave_balances (company_id, user_id, leave_type_id, year, total_days)
         VALUES ($1, $2, $3, 2024, 12) RETURNING id`,
        [t.companyId, u, ltRes.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },
  // ── G12 Payroll — Salary Profile (mig 0091, 🔒 crown-jewel, lương nhạy cảm) ──────
  // Chống XANH-GIẢ: salary_profiles có company_id ⇒ rls-guards.int-spec sẽ ĐỎ nếu thiếu đăng ký.
  // KHÔNG skipNoContext (mọi hàng tenant-scoped, company_id NOT NULL, không hàng global).
  {
    name: "salary_profiles",
    table: "salary_profiles",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `sal-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary)
         VALUES ($1, $2, '2026-01-01', 5000.00) RETURNING id`,
        [t.companyId, u],
      );
      return r.rows[0].id as string;
    },
  },
  // ── G12-2 Payroll — period (mutable) + payslip/payslip_item (append-only snapshot, mig 0094–0096) ──
  // Mỗi bảng có company_id + RLS+FORCE → PHẢI ở harness (rls-guards "không bảng nào company_id thiếu case").
  {
    name: "payroll_periods",
    table: "payroll_periods",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO payroll_periods (company_id, period_month, status)
         VALUES ($1, '2026-01', 'draft') RETURNING id`,
        [t.companyId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "payslips",
    table: "payslips",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `pslip-${randomUUID().slice(0, 8)}@x.test`);
      const periodRes = await direct.query(
        `INSERT INTO payroll_periods (company_id, period_month, status)
         VALUES ($1, '2026-02', 'draft') RETURNING id`,
        [t.companyId],
      );
      const r = await direct.query(
        `INSERT INTO payslips
           (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, entry_kind)
         VALUES ($1, $2, $3, 5000.00, 5000.00, 5000.00, $3, 'original') RETURNING id`,
        [t.companyId, periodRes.rows[0].id, u],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "payslip_items",
    table: "payslip_items",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `pitem-${randomUUID().slice(0, 8)}@x.test`);
      const periodRes = await direct.query(
        `INSERT INTO payroll_periods (company_id, period_month, status)
         VALUES ($1, '2026-03', 'draft') RETURNING id`,
        [t.companyId],
      );
      const psRes = await direct.query(
        `INSERT INTO payslips
           (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, entry_kind)
         VALUES ($1, $2, $3, 5000.00, 5000.00, 5000.00, $3, 'original') RETURNING id`,
        [t.companyId, periodRes.rows[0].id, u],
      );
      const r = await direct.query(
        `INSERT INTO payslip_items (company_id, payslip_id, item_type, label, amount)
         VALUES ($1, $2, 'earning', 'Base', 5000.00) RETURNING id`,
        [t.companyId, psRes.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },
  // ── G12-3 Bonus/Penalty (mutable draft→approved/rejected, mig 0098) ──
  {
    name: "bonus_penalties",
    table: "bonus_penalties",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `bp-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO bonus_penalties
           (company_id, user_id, kind, amount, period_month, status, created_by)
         VALUES ($1, $2, 'bonus', 100.00, '2026-01', 'draft', $2) RETURNING id`,
        [t.companyId, u],
      );
      return r.rows[0].id as string;
    },
  },
  // ── G12-4 Payslip acknowledgements (nhân viên xác nhận/khiếu nại, mig 0131) ──
  {
    name: "payslip_acknowledgements",
    table: "payslip_acknowledgements",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `pack-${randomUUID().slice(0, 8)}@x.test`);
      // RLS isolation chỉ cần 1 hàng ack tồn tại — kỳ 'draft' (tránh published_pair CHECK của 0130).
      const period = await direct.query(
        `INSERT INTO payroll_periods (company_id, period_month, status)
         VALUES ($1, '2026-04', 'draft') RETURNING id`,
        [t.companyId],
      );
      const ps = await direct.query(
        `INSERT INTO payslips
           (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, entry_kind)
         VALUES ($1, $2, $3, 5000.00, 5000.00, 5000.00, $3, 'original') RETURNING id`,
        [t.companyId, period.rows[0].id, u],
      );
      const r = await direct.query(
        `INSERT INTO payslip_acknowledgements (company_id, payslip_id, user_id, status)
         VALUES ($1, $2, $3, 'acknowledged') RETURNING id`,
        [t.companyId, ps.rows[0].id, u],
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

  // ── G8-3 Evaluation (template + criteria + results + scores — migration 0083) ──
  // Mỗi bảng có company_id + RLS+FORCE → PHẢI ở harness (rls-guards "không bảng nào company_id thiếu case").
  {
    name: "evaluation_templates",
    table: "evaluation_templates",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO evaluation_templates (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `rls-eval-tpl-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "evaluation_criteria",
    table: "evaluation_criteria",
    seedRow: async (direct, t) => {
      const tplRes = await direct.query(
        `INSERT INTO evaluation_templates (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `rls-eval-crit-tpl-${randomUUID().slice(0, 8)}`],
      );
      const r = await direct.query(
        `INSERT INTO evaluation_criteria (company_id, template_id, name, weight, min_score, max_score)
         VALUES ($1, $2, 'rls-crit', 100, 0, 10) RETURNING id`,
        [t.companyId, tplRes.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "evaluation_results",
    table: "evaluation_results",
    seedRow: async (direct, t) => {
      const { stepId, userId } = await seedWorkflowChain(direct, t);
      const tplRes = await direct.query(
        `INSERT INTO evaluation_templates (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `rls-eval-res-tpl-${randomUUID().slice(0, 8)}`],
      );
      const r = await direct.query(
        `INSERT INTO evaluation_results
           (company_id, template_id, workflow_step_id, evaluator_user_id, total_score)
         VALUES ($1, $2, $3, $4, 80.00) RETURNING id`,
        [t.companyId, tplRes.rows[0].id, stepId, userId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "evaluation_scores",
    table: "evaluation_scores",
    seedRow: async (direct, t) => {
      const { stepId, userId } = await seedWorkflowChain(direct, t);
      const tplRes = await direct.query(
        `INSERT INTO evaluation_templates (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `rls-eval-score-tpl-${randomUUID().slice(0, 8)}`],
      );
      const critRes = await direct.query(
        `INSERT INTO evaluation_criteria (company_id, template_id, name, weight, min_score, max_score)
         VALUES ($1, $2, 'rls-score-crit', 100, 0, 10) RETURNING id`,
        [t.companyId, tplRes.rows[0].id],
      );
      const resRes = await direct.query(
        `INSERT INTO evaluation_results
           (company_id, template_id, workflow_step_id, evaluator_user_id, total_score)
         VALUES ($1, $2, $3, $4, 80.00) RETURNING id`,
        [t.companyId, tplRes.rows[0].id, stepId, userId],
      );
      const r = await direct.query(
        `INSERT INTO evaluation_scores (company_id, result_id, criteria_id, score)
         VALUES ($1, $2, $3, 8.00) RETURNING id`,
        [t.companyId, resRes.rows[0].id, critRes.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },

  // ── G8-4 KPI (kpi_definitions mutable + kpi_results SNAPSHOT APPEND-ONLY — migration 0088) ──
  // Mỗi bảng có company_id + RLS+FORCE → PHẢI ở harness (rls-guards "không bảng nào company_id thiếu case").
  // KHÔNG skipNoContext (mọi hàng tenant-scoped, company_id NOT NULL, không hàng global).
  {
    name: "kpi_definitions",
    table: "kpi_definitions",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO kpi_definitions (company_id, name, weights)
         VALUES ($1, $2, $3::jsonb) RETURNING id`,
        [
          t.companyId,
          `rls-kpi-def-${randomUUID().slice(0, 8)}`,
          JSON.stringify({
            tasksDone: 20,
            onTimeRate: 20,
            evaluationScore: 20,
            defectScore: 20,
            firstPassApprovalRate: 20,
          }),
        ],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "kpi_results",
    table: "kpi_results",
    seedRow: async (direct, t) => {
      const u = await seedUser(
        direct,
        t.companyId,
        `rls-kpi-subj-${randomUUID().slice(0, 8)}@x.test`,
      );
      const defRes = await direct.query(
        `INSERT INTO kpi_definitions (company_id, name, weights)
         VALUES ($1, $2, $3::jsonb) RETURNING id`,
        [
          t.companyId,
          `rls-kpi-res-def-${randomUUID().slice(0, 8)}`,
          JSON.stringify({
            tasksDone: 20,
            onTimeRate: 20,
            evaluationScore: 20,
            defectScore: 20,
            firstPassApprovalRate: 20,
          }),
        ],
      );
      const r = await direct.query(
        `INSERT INTO kpi_results
           (company_id, definition_id, subject_user_id, period_start, period_end,
            tasks_done, on_time_rate, evaluation_score, defect_score, first_pass_approval_rate,
            total_score, computed_by)
         VALUES ($1, $2, $3, '2026-05-01', '2026-06-01', 100, 100, 80, 100, 75, 91, $3) RETURNING id`,
        [t.companyId, defRes.rows[0].id, u],
      );
      return r.rows[0].id as string;
    },
  },

  // ── G10-4 Meeting (meeting_rooms / meetings / meeting_attendees — mig 0052) ──
  {
    name: "meeting_rooms",
    table: "meeting_rooms",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO meeting_rooms (company_id, name) VALUES ($1, $2) RETURNING id`,
        [t.companyId, `rls-room-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "meetings",
    table: "meetings",
    seedRow: async (direct, t) => {
      const userId = await seedUser(
        direct,
        t.companyId,
        `mtg-org-${randomUUID().slice(0, 8)}@x.test`,
      );
      const r = await direct.query(
        `INSERT INTO meetings (company_id, title, starts_at, ends_at, organizer_id)
         VALUES ($1, $2, now() + interval '1 hour', now() + interval '2 hours', $3) RETURNING id`,
        [t.companyId, `rls-mtg-${randomUUID().slice(0, 8)}`, userId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "meeting_attendees",
    table: "meeting_attendees",
    seedRow: async (direct, t) => {
      const userId = await seedUser(
        direct,
        t.companyId,
        `mtg-att-${randomUUID().slice(0, 8)}@x.test`,
      );
      const mtgRes = await direct.query(
        `INSERT INTO meetings (company_id, title, starts_at, ends_at, organizer_id)
         VALUES ($1, $2, now() + interval '1 hour', now() + interval '2 hours', $3) RETURNING id`,
        [t.companyId, `rls-att-mtg-${randomUUID().slice(0, 8)}`, userId],
      );
      const r = await direct.query(
        `INSERT INTO meeting_attendees (company_id, meeting_id, user_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [t.companyId, mtgRes.rows[0].id, userId],
      );
      return r.rows[0].id as string;
    },
  },

  // ── G10-4 Meeting notes + tasks link (meeting_notes / meeting_tasks — mig 0053) ──
  {
    name: "meeting_notes",
    table: "meeting_notes",
    seedRow: async (direct, t) => {
      const userId = await seedUser(
        direct,
        t.companyId,
        `mtg-note-${randomUUID().slice(0, 8)}@x.test`,
      );
      const mtgRes = await direct.query(
        `INSERT INTO meetings (company_id, title, starts_at, ends_at, organizer_id)
         VALUES ($1, $2, now() + interval '1 hour', now() + interval '2 hours', $3) RETURNING id`,
        [t.companyId, `rls-note-mtg-${randomUUID().slice(0, 8)}`, userId],
      );
      const r = await direct.query(
        `INSERT INTO meeting_notes (company_id, meeting_id, author_user_id, body)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [t.companyId, mtgRes.rows[0].id, userId, "rls biên bản"],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "meeting_tasks",
    table: "meeting_tasks",
    seedRow: async (direct, t) => {
      const userId = await seedUser(
        direct,
        t.companyId,
        `mtg-mt-${randomUUID().slice(0, 8)}@x.test`,
      );
      const mtgRes = await direct.query(
        `INSERT INTO meetings (company_id, title, starts_at, ends_at, organizer_id)
         VALUES ($1, $2, now() + interval '1 hour', now() + interval '2 hours', $3) RETURNING id`,
        [t.companyId, `rls-mt-mtg-${randomUUID().slice(0, 8)}`, userId],
      );
      const taskRes = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round)
         VALUES ($1, 'meeting_action', $2, 'not_started', 'initial', 0) RETURNING id`,
        [t.companyId, `rls-mt-task-${randomUUID().slice(0, 8)}`],
      );
      const r = await direct.query(
        `INSERT INTO meeting_tasks (company_id, meeting_id, task_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [t.companyId, mtgRes.rows[0].id, taskRes.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },

  // ── G6-2 PR-B Break-glass (grant MUTABLE + approvals APPEND-ONLY — mig 0200) ──
  // company_id + RLS+FORCE → PHẢI ở harness (rls-guards "không bảng nào company_id thiếu case").
  // KHÔNG skipNoContext (mọi hàng tenant-scoped, company_id NOT NULL, không hàng global).
  {
    name: "break_glass_grants",
    table: "break_glass_grants",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `bgg-${randomUUID().slice(0, 8)}@x.test`);
      const accountId = await seedPlatformAccount(direct, t.companyId);
      const r = await direct.query(
        `INSERT INTO break_glass_grants
           (company_id, platform_account_id, requester_user_id, reason, expires_at)
         VALUES ($1, $2, $3, 'rls-break-glass', now() + interval '1 hour') RETURNING id`,
        [t.companyId, accountId, u],
      );
      return r.rows[0].id as string;
    },
  },
  // ── G16-3 SaaS prep (per-company subscription/feature/usage + dashboard configs) ──────────────
  {
    name: "company_subscriptions",
    table: "company_subscriptions",
    seedRow: async (direct, t) => {
      // Gói 'free' seed sẵn ở mig 0231 (UUID cố định).
      const r = await direct.query(
        `INSERT INTO company_subscriptions (company_id, plan_id, status)
         VALUES ($1, '00000000-0000-0000-0000-0000000000a1', 'active') RETURNING id`,
        [t.companyId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "break_glass_approvals",
    table: "break_glass_approvals",
    seedRow: async (direct, t) => {
      const requester = await seedUser(
        direct,
        t.companyId,
        `bga-req-${randomUUID().slice(0, 8)}@x.test`,
      );
      const approver = await seedUser(
        direct,
        t.companyId,
        `bga-apr-${randomUUID().slice(0, 8)}@x.test`,
      );
      const accountId = await seedPlatformAccount(direct, t.companyId);
      const grantRes = await direct.query(
        `INSERT INTO break_glass_grants
           (company_id, platform_account_id, requester_user_id, reason, expires_at)
         VALUES ($1, $2, $3, 'rls-bga-grant', now() + interval '1 hour') RETURNING id`,
        [t.companyId, accountId, requester],
      );
      const r = await direct.query(
        `INSERT INTO break_glass_approvals
           (company_id, grant_id, approver_user_id, requester_user_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [t.companyId, grantRes.rows[0].id, approver, requester],
      );
      return r.rows[0].id as string;
    },
  },
  // ── G16-3 SaaS prep (per-company subscription/feature/usage + dashboard configs) ──────────────
  {
    name: "company_feature_flags",
    table: "company_feature_flags",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO company_feature_flags (company_id, feature_key, enabled)
         VALUES ($1, $2, true) RETURNING id`,
        [t.companyId, `rls-feat-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "company_usage_limits",
    table: "company_usage_limits",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO company_usage_limits (company_id, metric_key, limit_value)
         VALUES ($1, $2, 100) RETURNING id`,
        [t.companyId, `rls-metric-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "company_usage_counters",
    table: "company_usage_counters",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO company_usage_counters (company_id, metric_key, period, used_count)
         VALUES ($1, $2, 'lifetime', 1) RETURNING id`,
        [t.companyId, `rls-metric-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "dashboard_configs",
    table: "dashboard_configs",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO dashboard_configs (company_id, role_code, layout_json)
         VALUES ($1, $2, '{"widgets":[]}'::jsonb) RETURNING id`,
        [t.companyId, `rls-role-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },

  // ── G15-2 Device tokens (push notification registration — mig 0110) ──────────
  // company_id + RLS+FORCE → PHẢI ở harness. Soft-delete (deleted_at) — KHÔNG hard DELETE.
  // KHÔNG skipNoContext (mọi hàng tenant-scoped, company_id NOT NULL, không hàng global).
  {
    name: "device_tokens",
    table: "device_tokens",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `dt-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO device_tokens (company_id, user_id, token, platform)
         VALUES ($1, $2, $3, 'android') RETURNING id`,
        [t.companyId, u, `rls-token-${randomUUID()}`],
      );
      return r.rows[0].id as string;
    },
  },

  // ── AC-5 API keys / PAT (api_keys MUTABLE + api_key_usages APPEND-ONLY — mig 0310) ──────────
  // company_id + RLS+FORCE → PHẢI ở harness (rls-guards "không bảng nào company_id thiếu case").
  // KHÔNG skipNoContext (mọi hàng tenant-scoped, company_id NOT NULL, không hàng global).
  {
    name: "api_keys",
    table: "api_keys",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `ak-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO api_keys (company_id, user_id, name, token_prefix, token_hash, scope_permission_ids)
         VALUES ($1, $2, 'rls-key', $3, $4, ARRAY[]::uuid[]) RETURNING id`,
        [t.companyId, u, `mok_${randomUUID().slice(0, 4)}`, randomUUID().replace(/-/g, "")],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "api_key_usages",
    table: "api_key_usages",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `aku-${randomUUID().slice(0, 8)}@x.test`);
      const keyRes = await direct.query(
        `INSERT INTO api_keys (company_id, user_id, name, token_prefix, token_hash, scope_permission_ids)
         VALUES ($1, $2, 'rls-key-usage', $3, $4, ARRAY[]::uuid[]) RETURNING id`,
        [t.companyId, u, `mok_${randomUUID().slice(0, 4)}`, randomUUID().replace(/-/g, "")],
      );
      const r = await direct.query(
        `INSERT INTO api_key_usages (company_id, api_key_id, route, ip)
         VALUES ($1, $2, '/tasks/board', '127.0.0.1') RETURNING id`,
        [t.companyId, keyRes.rows[0].id],
      );
      return r.rows[0].id as string;
    },
  },

  // ── AC-4 UI config (tenant_branding / ui_navigation_config / i18n_overrides — mig 0300) ──────
  // company_id + RLS+FORCE → PHẢI ở harness (rls-guards "không bảng nào company_id thiếu case").
  // 3 bảng độc lập (chỉ FK → companies) — KHÔNG skipNoContext (mọi hàng tenant-scoped, không hàng global).
  {
    name: "tenant_branding",
    table: "tenant_branding",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO tenant_branding (company_id, primary_color, company_name)
         VALUES ($1, '#112233', 'rls-brand') RETURNING id`,
        [t.companyId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "ui_navigation_config",
    table: "ui_navigation_config",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO ui_navigation_config (company_id, key, label, route, display_order, is_visible)
         VALUES ($1, $2, 'rls-nav', '/x', 0, true) RETURNING id`,
        [t.companyId, `rls-nav-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "i18n_overrides",
    table: "i18n_overrides",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO i18n_overrides (company_id, locale, namespace, key, value)
         VALUES ($1, 'vi', 'common', $2, 'rls-val') RETURNING id`,
        [t.companyId, `rls-key-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },

  // ── AC-6 Webhooks (endpoint MUTABLE + subscription + deliveries APPEND-ONLY — mig 0320) ──────
  // company_id + RLS+FORCE → PHẢI ở harness (rls-guards "không bảng nào company_id thiếu case").
  // Envelope cols là DUMMY (iv 12B, tag 16B đúng octet_length CHECK) — crypto thật ở int-spec riêng.
  // KHÔNG skipNoContext (mọi hàng tenant-scoped, company_id NOT NULL, không hàng global).
  {
    name: "webhook_endpoints",
    table: "webhook_endpoints",
    seedRow: async (direct, t) => seedWebhookEndpoint(direct, t.companyId),
  },
  {
    name: "webhook_event_subscriptions",
    table: "webhook_event_subscriptions",
    seedRow: async (direct, t) => {
      const endpointId = await seedWebhookEndpoint(direct, t.companyId);
      const r = await direct.query(
        `INSERT INTO webhook_event_subscriptions (company_id, endpoint_id, event_type)
         VALUES ($1, $2, 'task.created') RETURNING id`,
        [t.companyId, endpointId],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "webhook_deliveries",
    table: "webhook_deliveries",
    seedRow: async (direct, t) => {
      const endpointId = await seedWebhookEndpoint(direct, t.companyId);
      const r = await direct.query(
        `INSERT INTO webhook_deliveries (company_id, endpoint_id, event_type, status)
         VALUES ($1, $2, 'task.created', 'pending') RETURNING id`,
        [t.companyId, endpointId],
      );
      return r.rows[0].id as string;
    },
  },

  // ── CS-8 Cấu hình mail server (company_mail_configs — SMTP password envelope, mig 0380) ───────
  // company_id + RLS+FORCE → PHẢI ở harness. Envelope DUMMY (iv 12B / tag 16B). KHÔNG skipNoContext.
  {
    name: "company_mail_configs",
    table: "company_mail_configs",
    seedRow: async (direct, t) => seedMailConfig(direct, t.companyId),
  },

  // ── CS-9 Bảo mật nâng cao (company_security_policies — 1 hàng/công ty, mig 0390) ──────────────
  // company_id + RLS+FORCE → PHẢI ở harness. UNIQUE(company_id). KHÔNG skipNoContext.
  {
    name: "company_security_policies",
    table: "company_security_policies",
    seedRow: async (direct, t) => seedSecurityPolicy(direct, t.companyId),
  },

  // ── CS-10 Đối tượng: Mời/Duyệt/Kích hoạt user (user_invites — token_hash/password_hash, mig 0410) ──
  // company_id + RLS+FORCE → PHẢI ở harness. token_hash/password_hash KHÔNG secret thật (hash). KHÔNG skipNoContext.
  {
    name: "user_invites",
    table: "user_invites",
    seedRow: async (direct, t) => seedUserInvite(direct, t.companyId),
  },

  // ── FOUNDATION-DB-1 (mig 0431) — company_settings ───────────────────────────
  // company_id NOT NULL DEFAULT current_setting + RLS+FORCE. Mutable (KHÔNG append-only). Soft-delete.
  // KHÔNG skipNoContext (mọi hàng tenant-scoped, không hàng global). value_type CHECK IN (...).
  {
    name: "company_settings",
    table: "company_settings",
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO company_settings
           (company_id, setting_key, setting_value, value_type, category)
         VALUES ($1, $2, '"rls-test"'::jsonb, 'String', 'General')
         RETURNING id`,
        [t.companyId, `rls-cs-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },

  // ── FOUNDATION-DB-3 (mig 0433) — files ──────────────────────────────────────
  // company_id NOT NULL DEFAULT current_setting + RLS+FORCE. Mutable (soft-delete). KHÔNG append-only.
  // Requires: uploaded_by FK → users (NOT NULL). storage_provider CHECK IN (...).
  // upload_status CHECK IN (...). visibility CHECK IN (...). file_size_bytes ≥ 0.
  {
    name: "files",
    table: "files",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `rls-files-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO files
           (company_id, original_name, stored_name, mime_type, file_size_bytes,
            storage_provider, storage_path, visibility, upload_status, scan_status, uploaded_by)
         VALUES ($1, 'rls-test.pdf', $2, 'application/pdf', 1024,
                 'MinIO', $3, 'Private', 'Uploaded', 'NotRequired', $4)
         RETURNING id`,
        [
          t.companyId,
          `rls-stored-${randomUUID().slice(0, 8)}.pdf`,
          `rls/${t.companyId}/${randomUUID()}/test.pdf`,
          u,
        ],
      );
      return r.rows[0].id as string;
    },
  },

  // ── FOUNDATION-DB-3 (mig 0433) — file_links ─────────────────────────────────
  // company_id NOT NULL DEFAULT current_setting + RLS+FORCE. Polymorphic (module_code/entity_type/entity_id).
  // Requires: file_id FK → files (NOT NULL); created_by FK → users (NOT NULL).
  // link_type CHECK IN (...); access_scope CHECK IN (...).
  {
    name: "file_links",
    table: "file_links",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `rls-fl-${randomUUID().slice(0, 8)}@x.test`);
      // Seed a files row first (FK file_id NOT NULL → files)
      const fileRes = await direct.query(
        `INSERT INTO files
           (company_id, original_name, stored_name, mime_type, file_size_bytes,
            storage_provider, storage_path, visibility, upload_status, scan_status, uploaded_by)
         VALUES ($1, 'rls-fl.pdf', $2, 'application/pdf', 512,
                 'MinIO', $3, 'Private', 'Uploaded', 'NotRequired', $4)
         RETURNING id`,
        [
          t.companyId,
          `rls-fl-stored-${randomUUID().slice(0, 8)}.pdf`,
          `rls/${t.companyId}/${randomUUID()}/fl.pdf`,
          u,
        ],
      );
      const fileId = fileRes.rows[0].id as string;
      const r = await direct.query(
        `INSERT INTO file_links
           (company_id, file_id, module_code, entity_type, entity_id, link_type,
            access_scope, created_by)
         VALUES ($1, $2, 'TASK', 'task', $3, 'Attachment', 'Company', $4)
         RETURNING id`,
        [t.companyId, fileId, randomUUID(), u],
      );
      return r.rows[0].id as string;
    },
  },

  // ── FOUNDATION-DB-3 (mig 0433) — file_access_logs ───────────────────────────
  // company_id NOT NULL DEFAULT current_setting + RLS+FORCE. APPEND-ONLY: REVOKE UPDATE,DELETE.
  // Requires: file_id FK → files (NOT NULL). action CHECK IN (...). access_granted NOT NULL.
  // KHÔNG skipNoContext (mọi hàng tenant-scoped). skipNoContext=false (mặc định).
  {
    name: "file_access_logs",
    table: "file_access_logs",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `rls-fal-${randomUUID().slice(0, 8)}@x.test`);
      // Seed a files row first (FK file_id NOT NULL → files)
      const fileRes = await direct.query(
        `INSERT INTO files
           (company_id, original_name, stored_name, mime_type, file_size_bytes,
            storage_provider, storage_path, visibility, upload_status, scan_status, uploaded_by)
         VALUES ($1, 'rls-fal.pdf', $2, 'application/pdf', 256,
                 'MinIO', $3, 'Private', 'Uploaded', 'NotRequired', $4)
         RETURNING id`,
        [
          t.companyId,
          `rls-fal-stored-${randomUUID().slice(0, 8)}.pdf`,
          `rls/${t.companyId}/${randomUUID()}/fal.pdf`,
          u,
        ],
      );
      const fileId = fileRes.rows[0].id as string;
      const r = await direct.query(
        `INSERT INTO file_access_logs
           (company_id, file_id, actor_user_id, action, access_granted)
         VALUES ($1, $2, $3, 'Download', true)
         RETURNING id`,
        [t.companyId, fileId, u],
      );
      return r.rows[0].id as string;
    },
  },

  // ── FOUNDATION-DB-4 (mig 0434) — sequence_counters ──────────────────────────
  // company_id NULLABLE: global rows (company_id IS NULL) visible without tenant context by design.
  // skipNoContext: true (like `roles`). Still seed a tenant-scoped row (company_id NOT NULL) to test
  // cross-tenant isolation of tenant rows. WITH CHECK: app role cannot write NULL company_id.
  // scope_type CHECK IN (...). reset_policy CHECK IN (...). status CHECK IN (...).
  {
    name: "sequence_counters (tenant-scoped only)",
    table: "sequence_counters",
    skipNoContext: true,
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO sequence_counters
           (company_id, module_code, sequence_key, scope_type, reset_policy, status)
         VALUES ($1, 'HR', $2, 'Company', 'Never', 'Active')
         RETURNING id`,
        [t.companyId, `rls-seq-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },

  // ── FOUNDATION-DB-4 (mig 0434) — public_holidays ────────────────────────────
  // company_id NULLABLE: global holiday rows (company_id IS NULL) visible without tenant context.
  // skipNoContext: true (same pattern as sequence_counters). Still seed a tenant-scoped row.
  // holiday_code + holiday_date + holiday_type CHECK IN (...). status CHECK IN (...).
  // uq: (company_id, holiday_date, holiday_code) WHERE company_id IS NOT NULL AND deleted_at IS NULL.
  {
    name: "public_holidays (tenant-scoped only)",
    table: "public_holidays",
    skipNoContext: true,
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO public_holidays
           (company_id, holiday_code, name, holiday_date, holiday_type, status)
         VALUES ($1, $2, 'RLS Test Holiday', '2099-01-01', 'CompanyHoliday', 'Active')
         RETURNING id`,
        [t.companyId, `rls-hol-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },

  // ── FOUNDATION-DB-5 (mig 0435) — data_retention_policies ────────────────────
  // company_id NULLABLE (NULL = global default, NOT NULL = company override) + RLS+FORCE nullable-tenant.
  // skipNoContext: true (global rows company_id IS NULL visible to all tenants by design).
  // cleanup_action CHECK IN (...). retention_days ≥ 0.
  // uq: (COALESCE(company_id, nil-uuid), module_code, entity_type) WHERE deleted_at IS NULL AND is_enabled.
  // Seed is_enabled=false to avoid uq conflict across concurrent test runs.
  {
    name: "data_retention_policies (tenant-scoped only)",
    table: "data_retention_policies",
    skipNoContext: true,
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO data_retention_policies
           (company_id, module_code, entity_type, retention_days, cleanup_action, is_enabled)
         VALUES ($1, 'FOUNDATION', $2, 365, 'None', false)
         RETURNING id`,
        [t.companyId, `rls-drp-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },

  // ── FOUNDATION-DB-5 (mig 0435) — seed_batches ───────────────────────────────
  // company_id NULLABLE (NULL = global seed, NOT NULL = company-scoped). RLS+FORCE nullable-tenant.
  // skipNoContext: true (global seed rows visible to all tenants by design).
  // status CHECK IN (...). uq: (COALESCE(company_id, nil-uuid), seed_key, seed_version).
  {
    name: "seed_batches (tenant-scoped only)",
    table: "seed_batches",
    skipNoContext: true,
    seedRow: async (direct, t) => {
      const r = await direct.query(
        `INSERT INTO seed_batches
           (company_id, seed_key, seed_version, status)
         VALUES ($1, $2, '1.0.0', 'Pending')
         RETURNING id`,
        [t.companyId, `rls-sb-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },

  // ── FOUNDATION-DB-5 (mig 0435) — seed_items ─────────────────────────────────
  // company_id NULLABLE (NULL = global). RLS+FORCE nullable-tenant.
  // skipNoContext: true (global seed items visible by design).
  // Requires: seed_batch_id FK → seed_batches (NOT NULL, ON DELETE CASCADE).
  // operation CHECK IN (...). status CHECK IN (...).
  // uq: (seed_batch_id, target_table, target_key).
  {
    name: "seed_items (tenant-scoped only)",
    table: "seed_items",
    skipNoContext: true,
    seedRow: async (direct, t) => {
      // Seed a seed_batches row first (FK seed_batch_id NOT NULL → seed_batches)
      const batchRes = await direct.query(
        `INSERT INTO seed_batches
           (company_id, seed_key, seed_version, status)
         VALUES ($1, $2, '1.0.0', 'Pending')
         RETURNING id`,
        [t.companyId, `rls-si-sb-${randomUUID().slice(0, 8)}`],
      );
      const batchId = batchRes.rows[0].id as string;
      const r = await direct.query(
        `INSERT INTO seed_items
           (seed_batch_id, company_id, target_table, target_key, operation, status)
         VALUES ($1, $2, 'companies', $3, 'Upsert', 'Pending')
         RETURNING id`,
        [batchId, t.companyId, `rls-si-key-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    },
  },

  // ── S2-AUTH-DB-2 — AUTH sessions/logs (mig 0443) ─────────────────────────────
  // Mỗi bảng có company_id + RLS+FORCE → PHẢI ở harness (rls-guards "không bảng nào company_id thiếu case").
  // login_logs/user_security_events APPEND-ONLY; user_sessions MUTABLE. KHÔNG skipNoContext (seedRow gắn tenant).
  {
    name: "user_sessions",
    table: "user_sessions",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `usess-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO user_sessions (company_id, user_id, refresh_token_hash, expired_at)
         VALUES ($1, $2, $3, now() + interval '7 days') RETURNING id`,
        [t.companyId, u, randomUUID()],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "login_logs",
    table: "login_logs",
    // company_id NULLABLE: hàng pre-auth (email không tồn tại) có company_id IS NULL → HIỂN THỊ với mọi tenant
    // qua USING (company_id = GUC OR company_id IS NULL) — GIỐNG roles/seed_items có hàng global. Vì vậy
    // skipNoContext: test 'no context → 0 row' KHÔNG đúng cho bảng nullable-tenant (sẽ đỏ khi có hàng NULL).
    // Cô lập chéo tenant + WITH CHECK forge-deny vẫn được harness phủ; hành vi nullable-tenant đã verify ở
    // auth-appendonly + rls-tenant-isolation (FULL gate). Mẫu: roles/role_permissions/seed_items.
    skipNoContext: true,
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `llog-${randomUUID().slice(0, 8)}@x.test`);
      const email = `llog-${randomUUID().slice(0, 8)}@x.test`;
      const r = await direct.query(
        `INSERT INTO login_logs (company_id, user_id, email, normalized_email, login_status)
         VALUES ($1, $2, $3, lower($3), 'success') RETURNING id`,
        [t.companyId, u, email],
      );
      return r.rows[0].id as string;
    },
  },
  {
    name: "user_security_events",
    table: "user_security_events",
    seedRow: async (direct, t) => {
      const u = await seedUser(direct, t.companyId, `usec-${randomUUID().slice(0, 8)}@x.test`);
      const r = await direct.query(
        `INSERT INTO user_security_events (company_id, user_id, event_type, severity)
         VALUES ($1, $2, 'PASSWORD_CHANGED', 'info') RETURNING id`,
        [t.companyId, u],
      );
      return r.rows[0].id as string;
    },
  },
];
