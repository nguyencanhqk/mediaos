import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

/**
 * Seed tiện ích cho integration test. Dùng kết nối DIRECT (superuser, bypass RLS) để dựng dữ liệu
 * 2 tenant — KHÔNG phản ánh đường app; chỉ để tạo lưới test cho deny-path RLS.
 */

export interface SeededTenant {
  companyId: string;
  slug: string;
}

/** Tạo 1 company với slug ngẫu nhiên (tránh đụng giữa các lần chạy CI). */
export async function seedCompany(direct: Pool, label = "t"): Promise<SeededTenant> {
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const res = await direct.query(
    "INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id",
    [`Company ${slug}`, slug],
  );
  return { companyId: res.rows[0].id as string, slug };
}

/** Tạo 1 user thuộc company (set company_id tường minh qua superuser). Trả về user id. */
export async function seedUser(
  direct: Pool,
  companyId: string,
  email: string,
  passwordHash = "seed-not-a-real-hash",
): Promise<string> {
  const res = await direct.query(
    "INSERT INTO users (company_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id",
    [companyId, email, passwordHash],
  );
  return res.rows[0].id as string;
}

/**
 * Seed workflow definition MVP-0 cho một company.
 * Dùng trực tiếp trong integration / E2E test (không qua API).
 * Idempotent: ON CONFLICT DO NOTHING; trả về definitionId.
 */
export async function seedWorkflowDefinition(direct: Pool, companyId: string): Promise<string> {
  const code = `video_standard_v0`;

  const res = await direct.query(
    `INSERT INTO workflow_definitions
       (company_id, code, name, applies_to, max_approval_level, allow_parallel_steps)
     VALUES ($1, $2, 'Video chuẩn MVP-0', 'content_item', 1, false)
     ON CONFLICT DO NOTHING RETURNING id`,
    [companyId, code],
  );

  let definitionId: string;
  if (res.rows.length > 0) {
    definitionId = res.rows[0].id as string;
  } else {
    const existing = await direct.query(
      `SELECT id FROM workflow_definitions WHERE company_id = $1 AND code = $2 AND deleted_at IS NULL`,
      [companyId, code],
    );
    definitionId = existing.rows[0].id as string;
  }

  for (const [stepOrder, code2, name, assigneeRoleCode, reviewerRoleCode, defaultTaskTitle] of [
    [1, "script", "Viết kịch bản", "script_writer", "project_manager", "Viết kịch bản"],
    [2, "edit", "Dựng video", "video_editor", "project_manager", "Dựng video"],
    [3, "qa", "Kiểm tra chất lượng", "qa_reviewer", "project_manager", "QA nội dung"],
    [4, "upload", "Upload lên kênh", "uploader", "project_manager", "Upload video"],
  ]) {
    // node_key NOT NULL since 0032 (G7-1a). Seed it = step code (unique per definition → satisfies
    // the (def, node_key) unique index). Keeps the G4-3 lifecycle e2e green against the G7 schema.
    await direct.query(
      `INSERT INTO workflow_definition_steps
         (company_id, workflow_definition_id, step_order, code, name, assignee_role_code, reviewer_role_code, default_task_title, node_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING`,
      [
        companyId,
        definitionId,
        stepOrder,
        code2,
        name,
        assigneeRoleCode,
        reviewerRoleCode,
        defaultTaskTitle,
        code2,
      ],
    );
  }

  for (const [fromState, event, toState, appliesToStepCode, writtenBy] of [
    ["not_started", "start", "in_progress", null, "service"],
    ["in_progress", "submit", "waiting_review", null, "service"],
    ["waiting_review", "approve", "approved", null, "consumer"],
    ["waiting_review", "request_revision", "revision", null, "consumer"],
    ["revision", "start", "in_progress", null, "service"],
    ["approved", "open_next", "in_progress", null, "consumer"],
    ["approved", "complete_workflow", "completed", "upload", "consumer"],
  ]) {
    await direct.query(
      `INSERT INTO step_transitions
         (company_id, workflow_definition_id, from_state, event, to_state, applies_to_step_code, written_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [companyId, definitionId, fromState, event, toState, appliesToStepCode, writtenBy],
    );
  }

  return definitionId;
}

// ─── G6-2b seed helpers ────────────────────────────────────────────────────────

/**
 * Seed 1 role cho company. Trả về roleId.
 * is_system=false, không xung đột với system roles (company_id IS NULL).
 */
export async function seedRole(direct: Pool, companyId: string, name: string): Promise<string> {
  const res = await direct.query(
    `INSERT INTO roles (company_id, name, is_system)
     VALUES ($1, $2, false)
     ON CONFLICT DO NOTHING RETURNING id`,
    [companyId, name],
  );
  if (res.rows.length > 0) return res.rows[0].id as string;
  // Row already existed — fetch it
  const existing = await direct.query(
    `SELECT id FROM roles WHERE company_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1`,
    [companyId, name],
  );
  return existing.rows[0].id as string;
}

/**
 * Seed 1 permission trong catalog (upsert by action+resource_type).
 * Trả về permissionId.
 */
export async function seedPermissionCatalog(
  direct: Pool,
  action: string,
  resourceType: string,
  isSensitive: boolean,
): Promise<string> {
  // Upsert — permissions is a global catalog (no company_id)
  const res = await direct.query(
    `INSERT INTO permissions (action, resource_type, is_sensitive)
     VALUES ($1, $2, $3)
     ON CONFLICT (action, resource_type) DO UPDATE SET is_sensitive = EXCLUDED.is_sensitive
     RETURNING id`,
    [action, resourceType, isSensitive],
  );
  return res.rows[0].id as string;
}

/**
 * Seed 1 role_permission (role → permission với effect ALLOW/DENY).
 * ON CONFLICT DO NOTHING để idempotent khi gọi nhiều lần.
 */
export async function seedRolePermission(
  direct: Pool,
  roleId: string,
  permissionId: string,
  effect: "ALLOW" | "DENY",
): Promise<void> {
  await direct.query(
    `INSERT INTO role_permissions (role_id, permission_id, effect)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [roleId, permissionId, effect],
  );
}

/**
 * Seed user_role — gắn user vào role trong company.
 * Trả về user_role id.
 */
export async function seedUserRole(
  direct: Pool,
  userId: string,
  roleId: string,
  companyId: string,
): Promise<string> {
  const res = await direct.query(
    `INSERT INTO user_roles (user_id, role_id, company_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING id`,
    [userId, roleId, companyId],
  );
  if (res.rows.length > 0) return res.rows[0].id as string;
  const existing = await direct.query(
    `SELECT id FROM user_roles WHERE user_id = $1 AND role_id = $2 AND company_id = $3 LIMIT 1`,
    [userId, roleId, companyId],
  );
  return existing.rows[0].id as string;
}

/**
 * Seed 1 object_permission cho user trên một resource instance cụ thể.
 * Trả về object_permission id.
 * subject_type = 'user'; effect = 'ALLOW' | 'DENY'.
 */
export async function seedObjectGrant(
  direct: Pool,
  companyId: string,
  userId: string,
  resourceType: string,
  resourceId: string,
  action: string,
  effect: "ALLOW" | "DENY",
): Promise<string> {
  // Tìm permissionId từ catalog
  const permRes = await direct.query(
    `SELECT id FROM permissions WHERE action = $1 AND resource_type = $2 LIMIT 1`,
    [action, resourceType],
  );
  if (permRes.rows.length === 0) {
    throw new Error(
      `Permission catalog entry not found: action=${action} resourceType=${resourceType}. Call seedPermissionCatalog first.`,
    );
  }
  const permissionId = permRes.rows[0].id as string;

  const res = await direct.query(
    `INSERT INTO object_permissions
       (company_id, subject_type, subject_id, permission_id, object_type, object_id, effect)
     VALUES ($1, 'user', $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING RETURNING id`,
    [companyId, userId, permissionId, resourceType, resourceId, effect],
  );
  if (res.rows.length > 0) return res.rows[0].id as string;
  const existing = await direct.query(
    `SELECT id FROM object_permissions
     WHERE company_id=$1 AND subject_type='user' AND subject_id=$2
       AND permission_id=$3 AND object_type=$4 AND object_id=$5 AND effect=$6 LIMIT 1`,
    [companyId, userId, permissionId, resourceType, resourceId, effect],
  );
  return existing.rows[0].id as string;
}

/**
 * Seed 1 platform_account với DUMMY envelope (không phải crypto thật).
 * iv_nonce=12B / auth_tag=16B để pass octet_length CHECK constraints.
 * Trả về account id.
 * opts.id: nếu cung cấp → dùng làm PK (app-gen UUID trước INSERT — CARRY-FORWARD 🔴 AAD bind).
 */
export async function seedPlatformAccount(
  direct: Pool,
  companyId: string,
  opts?: {
    id?: string;
    secret_ciphertext?: Buffer;
    encrypted_dek?: Buffer;
    dek_key_version?: number;
    kms_key_id?: string;
  },
): Promise<string> {
  const id = opts?.id ?? randomUUID();
  const res = await direct.query(
    `INSERT INTO platform_accounts
       (id, company_id, platform_id,
        secret_ciphertext, encrypted_dek, dek_key_version, kms_key_id,
        iv_nonce, auth_tag, enc_algo)
     VALUES (
       $1, $2, (SELECT id FROM platforms WHERE code = 'youtube'),
       $3, $4, $5, $6,
       decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), 'AES-256-GCM'
     )
     RETURNING id`,
    [
      id,
      companyId,
      opts?.secret_ciphertext ?? Buffer.from("\x00"),
      opts?.encrypted_dek ?? Buffer.from("\x00"),
      opts?.dek_key_version ?? 1,
      opts?.kms_key_id ?? "local-dev-kek",
    ],
  );
  return res.rows[0].id as string;
}

/**
 * Seed 1 break_glass_grant TRỰC TIẾP (direct pool, bypass RLS) với timestamp tường minh — dùng cho các
 * deny-path mà service KHÔNG tạo được (vd grant HẾT HẠN: expires_at quá khứ + created_at xa hơn để qua
 * CHECK ttl). status='active' phải kèm activatedAt (active_pair CHECK). Trả về grant id.
 */
export async function seedBreakGlassGrant(
  direct: Pool,
  opts: {
    companyId: string;
    platformAccountId: string;
    requesterUserId: string;
    status?: "pending" | "active" | "revoked";
    requiredApprovals?: number;
    reason?: string;
    expiresAt?: string;
    createdAt?: string;
    activatedAt?: string;
  },
): Promise<string> {
  const res = await direct.query(
    `INSERT INTO break_glass_grants
       (company_id, platform_account_id, requester_user_id, reason, required_approvals, status,
        expires_at, created_at, activated_at)
     VALUES ($1, $2, $3, $4, $5, $6,
        COALESCE($7::timestamptz, now() + interval '1 hour'),
        COALESCE($8::timestamptz, now()),
        $9::timestamptz)
     RETURNING id`,
    [
      opts.companyId,
      opts.platformAccountId,
      opts.requesterUserId,
      opts.reason ?? "seed break-glass",
      opts.requiredApprovals ?? 2,
      opts.status ?? "pending",
      opts.expiresAt ?? null,
      opts.createdAt ?? null,
      opts.activatedAt ?? null,
    ],
  );
  return res.rows[0].id as string;
}

/**
 * Seed 1 user_totp ĐÃ BẬT (enabled_at set) cho user — để qua TwoFactorEnforcementGuard (G16-1b) trong các
 * e2e mà user giữ role `requires_two_factor` (vd company-admin) nhưng test KHÔNG xoay quanh luồng 2FA.
 * Envelope là placeholder thoả octet_length CHECK (iv 12B / tag 16B) — KHÔNG crypto thật (test không decrypt).
 */
export async function seedTwoFactorEnabled(
  direct: Pool,
  companyId: string,
  userId: string,
): Promise<void> {
  await direct.query(
    `INSERT INTO user_totp
       (company_id, user_id, secret_ciphertext, encrypted_dek, dek_key_version, kms_key_id, iv_nonce, auth_tag, enabled_at)
     VALUES ($1, $2, $3, $4, 1, 'local-dev-kek', $5, $6, now())
     ON CONFLICT (user_id) DO UPDATE SET enabled_at = now()`,
    [companyId, userId, Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(12), Buffer.alloc(16)],
  );
}

/** Dọn dữ liệu test theo companyId — xoá theo THỨ TỰ phụ thuộc FK (con trước, companies sau cùng). */
export async function cleanupTenants(direct: Pool, companyIds: string[]): Promise<void> {
  if (companyIds.length === 0) return;
  const ids = [companyIds];

  // ── FOUNDATION-DB-3 (mig 0433) — files / file_links / file_access_logs ─────
  // file_access_logs.file_id → files (CASCADE); file_links.file_id → files (CASCADE).
  // files.uploaded_by → users (RESTRICT) → xoá TRƯỚC users (phải ở đầu hàm).
  // Thứ tự: file_access_logs → file_links → files (con → cha).
  await direct.query("DELETE FROM file_access_logs WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM file_links WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM files WHERE company_id = ANY($1::uuid[])", ids);

  // ── FOUNDATION-DB-5 (mig 0435) — seed_items → seed_batches ─────────────────
  // seed_items.seed_batch_id → seed_batches (ON DELETE CASCADE) → xoá items TRƯỚC batches.
  await direct.query("DELETE FROM seed_items WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM seed_batches WHERE company_id = ANY($1::uuid[])", ids);

  // ── FOUNDATION-DB-5 (mig 0435) — data_retention_policies ───────────────────
  // company_id NULLABLE (CASCADE companies) — xoá tenant rows (company_id = ANY(...)) only.
  await direct.query("DELETE FROM data_retention_policies WHERE company_id = ANY($1::uuid[])", ids);

  // ── FOUNDATION-DB-4 (mig 0434) — sequence_counters / public_holidays ────────
  // company_id NULLABLE (CASCADE companies) — xoá tenant rows only.
  await direct.query("DELETE FROM sequence_counters WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM public_holidays WHERE company_id = ANY($1::uuid[])", ids);

  // ── FOUNDATION-DB-1 (mig 0431) — company_settings ───────────────────────────
  // company_id NOT NULL (CASCADE companies) — xoá tường minh TRƯỚC companies.
  await direct.query("DELETE FROM company_settings WHERE company_id = ANY($1::uuid[])", ids);

  // ── G6-2 PR-B Break-glass ───────────────────────────────────────────────────
  // break_glass_approvals.grant_id → break_glass_grants (CASCADE) → xoá approvals TRƯỚC grants.
  // break_glass_grants.platform_account_id → platform_accounts (CASCADE) + requester/revoked_by → users
  // (NO ACTION) → PHẢI xoá grants TRƯỚC users + platform_accounts. Xoá ở ĐẦU hàm (bảng mới nhất, phụ thuộc nhất).
  await direct.query("DELETE FROM break_glass_approvals WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM break_glass_grants WHERE company_id = ANY($1::uuid[])", ids);

  // ── G12-3 Bonus/Penalty ─────────────────────────────────────────────────────
  // bonus_penalties.task_id/defect_id/kpi_result_id ON DELETE RESTRICT + user_id/created_by (NO ACTION)
  // → PHẢI xoá TRƯỚC tasks/defects/kpi_results/users. payroll_period_id ON DELETE SET NULL (an toàn).
  await direct.query("DELETE FROM bonus_penalties WHERE company_id = ANY($1::uuid[])", ids);

  // ── G12-2/G12-4 Payroll (period + payslip snapshot + ack, append-only) ──────
  // payslip_acknowledgements.payslip_id REFERENCES payslips(id) (NO ACTION) → xoá TRƯỚC payslips.
  // payslip_items → payslips (FK CASCADE on payslip_id, but delete explicitly for clarity);
  // payslips → payroll_periods/users/salary_profiles (no cascade) → xoá TRƯỚC users/salary_profiles.
  // payroll_periods.attendance_period_id ON DELETE SET NULL → an toàn xoá trước attendance_periods.
  await direct.query(
    "DELETE FROM payslip_acknowledgements WHERE company_id = ANY($1::uuid[])",
    ids,
  );
  await direct.query("DELETE FROM payslip_items WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM payslips WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM payroll_periods WHERE company_id = ANY($1::uuid[])", ids);

  // ── G13 Finance ────────────────────────────────────────────────────────────
  // Xoá TRƯỚC projects/channels/content_items/org_units/teams/users (FK target). Thứ tự nội bộ:
  // cost_allocations → cost_records (FK); expense_approvals → expense_requests; revenue_records;
  // profit_snapshots. (cost_records.expense_request_id ON DELETE SET NULL → không chặn xoá expense.)
  await direct.query("DELETE FROM cost_allocations WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM expense_approvals WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM cost_records WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM expense_requests WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM revenue_records WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM profit_snapshots WHERE company_id = ANY($1::uuid[])", ids);

  // ── AC-5 API keys / PAT (usages APPEND-ONLY → api_keys MUTABLE) ───────────────
  // api_key_usages.api_key_id → api_keys (CASCADE) → xoá usages TRƯỚC keys.
  // api_keys.user_id → users (NO ACTION) → xoá keys TRƯỚC users.
  await direct.query("DELETE FROM api_key_usages WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM api_keys WHERE company_id = ANY($1::uuid[])", ids);

  // ── AC-4 UI config (branding / navigation / i18n) — 3 bảng độc lập (chỉ FK → companies) ───────
  // Xoá TRƯỚC companies (FK → companies CASCADE), không phụ thuộc lẫn nhau (thứ tự tự do).
  await direct.query("DELETE FROM tenant_branding WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM ui_navigation_config WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM i18n_overrides WHERE company_id = ANY($1::uuid[])", ids);

  // ── AC-6 Webhooks — thứ tự FK con→cha: deliveries → subscriptions → endpoints ─────────────────
  // deliveries/subscriptions.endpoint_id → webhook_endpoints (CASCADE) → xoá con TRƯỚC endpoints.
  await direct.query("DELETE FROM webhook_deliveries WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query(
    "DELETE FROM webhook_event_subscriptions WHERE company_id = ANY($1::uuid[])",
    ids,
  );
  await direct.query("DELETE FROM webhook_endpoints WHERE company_id = ANY($1::uuid[])", ids);

  // ── G15-2 Device tokens (push registration, soft-delete, FK → users) ──────────
  // device_tokens.user_id → users (NO ACTION) → xoá TRƯỚC users.
  await direct.query("DELETE FROM device_tokens WHERE company_id = ANY($1::uuid[])", ids);

  // ── G4-6 Communication ───────────────────────────────────────────────────
  await direct.query("DELETE FROM chat_messages WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM chat_room_members WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM chat_rooms WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM notifications WHERE company_id = ANY($1::uuid[])", ids);

  // ── G11 HR (Attendance + Leave) ──────────────────────────────────────────
  // adjustment_requests/leave_requests có FK → tasks → xoá TRƯỚC tasks. attendance_records
  // FK ← adjustment_requests (attendance_record_id) → xoá requests trước records.
  await direct.query(
    "DELETE FROM attendance_adjustment_requests WHERE company_id = ANY($1::uuid[])",
    ids,
  );
  await direct.query("DELETE FROM attendance_records WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM attendance_periods WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM leave_requests WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM leave_balances WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM leave_types WHERE company_id = ANY($1::uuid[])", ids);
  // work_schedules: employee_profiles.work_schedule_id FK (ON DELETE SET NULL) — an toàn xoá sau.
  await direct.query("DELETE FROM work_schedules WHERE company_id = ANY($1::uuid[])", ids);

  // ── G8-4 KPI ─────────────────────────────────────────────────────────────
  // kpi_results.computed_by/confirmed_by/subject_user_id → users (NO ACTION) → xoá TRƯỚC users.
  // kpi_results.definition_id → kpi_definitions (CASCADE) → xoá results trước definitions.
  await direct.query("DELETE FROM kpi_results WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM kpi_definitions WHERE company_id = ANY($1::uuid[])", ids);

  // ── G4-5 Approval / Defect ───────────────────────────────────────────────
  await direct.query("DELETE FROM defects WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM approval_steps WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM approval_requests WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query(
    "DELETE FROM workflow_step_instance_locks WHERE company_id = ANY($1::uuid[])",
    ids,
  );

  // ── B4 Task attachments ──────────────────────────────────────────────────
  // task_attachments.task_id REFERENCES tasks(id) (ON DELETE CASCADE) — xoá TRƯỚC tasks cho rõ ràng
  // (uploaded_by → users ON DELETE SET NULL, không chặn). Trước task_comments/tasks/users.
  await direct.query("DELETE FROM task_attachments WHERE company_id = ANY($1::uuid[])", ids);

  // ── PM-1 apps/projects (mig 0420) ─────────────────────────────────────────
  // task_labels.task_id/label_id → tasks/labels (CASCADE) → xoá TRƯỚC tasks/labels.
  // tasks.state_id → project_states (ON DELETE SET NULL) → an toàn; xoá task_labels + project_states
  // TRƯỚC tasks/projects/labels cho rõ ràng. labels.project_id → projects (CASCADE) → trước projects.
  await direct.query("DELETE FROM task_labels WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM labels WHERE company_id = ANY($1::uuid[])", ids);

  // ── G4-4 Tasks & Comments ────────────────────────────────────────────────
  await direct.query("DELETE FROM task_comments WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM tasks WHERE company_id = ANY($1::uuid[])", ids);
  // project_states.project_id → projects (CASCADE); tasks.state_id đã NULL hoặc tasks đã xoá → xoá sau tasks,
  // trước projects (FK projects CASCADE phủ, xoá tường minh cho thứ tự rõ ràng + tránh phụ thuộc CASCADE).
  await direct.query("DELETE FROM project_states WHERE company_id = ANY($1::uuid[])", ids);

  // ── G4-3 Workflow ─────────────────────────────────────────────────────────
  // G7-3: instance checklist tick-state (FK → workflow_steps + checklist_items) — xoá trước workflow_steps.
  await direct.query(
    "DELETE FROM workflow_step_checklist_states WHERE company_id = ANY($1::uuid[])",
    ids,
  );
  await direct.query("DELETE FROM workflow_steps WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM workflow_instances WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM step_transitions WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query(
    "DELETE FROM workflow_definition_steps WHERE company_id = ANY($1::uuid[])",
    ids,
  );
  await direct.query("DELETE FROM workflow_definitions WHERE company_id = ANY($1::uuid[])", ids);

  // ── G4-2 Media ────────────────────────────────────────────────────────────
  await direct.query("DELETE FROM content_items WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM project_channels WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM projects WHERE company_id = ANY($1::uuid[])", ids);
  // G6-2 Platform Accounts: channel_accounts (FK) before platform_accounts, both before channels
  await direct.query("DELETE FROM channel_accounts WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM platform_accounts WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM channels WHERE company_id = ANY($1::uuid[])", ids);

  // ── G4-1 Org ──────────────────────────────────────────────────────────────
  await direct.query("DELETE FROM team_members WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM teams WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM org_units WHERE company_id = ANY($1::uuid[])", ids);

  // ── G2/G3 Auth & Permission ───────────────────────────────────────────────
  // processed_events tham chiếu outbox_events; dead_letter tham chiếu cả hai → xoá trước outbox.
  await direct.query(
    `DELETE FROM processed_events WHERE event_id IN
       (SELECT id FROM outbox_events WHERE company_id = ANY($1::uuid[]))`,
    ids,
  );
  // G2-4 alerting: xoá dead_letter_events TRƯỚC dead_letter_alerts — gỡ "trigger" để monitor chạy song
  // song (scan toàn tenant) KHÔNG re-insert alert sau khi đã xoá (chống đua teardown trên DB dùng chung).
  // dead_letter_alerts chỉ tham chiếu companies → xoá ngay trước companies (ở cuối hàm) cũng được; xoá ở
  // đây sau khi events đã sạch là an toàn.
  await direct.query("DELETE FROM dead_letter_events WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM dead_letter_alerts WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM outbox_events WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM audit_logs WHERE company_id = ANY($1::uuid[])", ids);
  // refresh_tokens tự tham chiếu (replaced_by) → gỡ liên kết trước khi xoá để tránh vướng FK.
  await direct.query(
    "UPDATE refresh_tokens SET replaced_by = NULL WHERE company_id = ANY($1::uuid[])",
    ids,
  );
  await direct.query("DELETE FROM refresh_tokens WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM password_reset_tokens WHERE company_id = ANY($1::uuid[])", ids);
  // G16-1 2FA: user_totp + user_recovery_codes FK → users → xoá TRƯỚC users.
  await direct.query("DELETE FROM user_totp WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM user_recovery_codes WHERE company_id = ANY($1::uuid[])", ids);
  // G16-1b security_alerts: subject_user_id FK → users (NO ACTION) → xoá TRƯỚC users. company_id → companies.
  await direct.query("DELETE FROM security_alerts WHERE company_id = ANY($1::uuid[])", ids);
  // S2-AUTH-DB-2: user_sessions/login_logs/user_security_events FK → users (NO ACTION) → xoá TRƯỚC users.
  //   login_logs.session_id FK → user_sessions → xoá login_logs TRƯỚC user_sessions.
  await direct.query("DELETE FROM login_logs WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM user_security_events WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM user_sessions WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM object_permissions WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM user_roles WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query(
    "DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = ANY($1::uuid[]))",
    ids,
  );
  await direct.query(
    "DELETE FROM roles WHERE company_id = ANY($1::uuid[]) AND is_system = false",
    ids,
  );
  // G16-3 SaaS prep: per-company subscription/feature/usage + dashboard configs (company_id → companies
  // ON DELETE CASCADE; FK plan_id → subscription_plans catalog không xoá). Xoá tường minh trước companies.
  await direct.query("DELETE FROM company_usage_counters WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM company_usage_limits WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM company_feature_flags WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM company_subscriptions WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM dashboard_configs WHERE company_id = ANY($1::uuid[])", ids);
  // CS-10 user_invites: company_id → companies CASCADE (created_user_id/invited_by là uuid thường, KHÔNG FK
  // tới users) → xoá tường minh TRƯỚC users cho rõ ràng (CASCADE companies cũng phủ).
  await direct.query("DELETE FROM user_invites WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM users WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM companies WHERE id = ANY($1::uuid[])", ids);
}
