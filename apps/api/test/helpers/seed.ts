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
export async function seedWorkflowDefinition(
  direct: Pool,
  companyId: string,
): Promise<string> {
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
    [1, "script",  "Viết kịch bản",        "script_writer",  "project_manager", "Viết kịch bản"],
    [2, "edit",    "Dựng video",            "video_editor",   "project_manager", "Dựng video"],
    [3, "qa",      "Kiểm tra chất lượng",  "qa_reviewer",    "project_manager", "QA nội dung"],
    [4, "upload",  "Upload lên kênh",       "uploader",       "project_manager", "Upload video"],
  ]) {
    await direct.query(
      `INSERT INTO workflow_definition_steps
         (company_id, workflow_definition_id, step_order, code, name, assignee_role_code, reviewer_role_code, default_task_title)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [companyId, definitionId, stepOrder, code2, name, assigneeRoleCode, reviewerRoleCode, defaultTaskTitle],
    );
  }

  for (const [fromState, event, toState, appliesToStepCode, writtenBy] of [
    ["not_started",    "start",            "in_progress",    null,     "service"],
    ["in_progress",    "submit",           "waiting_review", null,     "service"],
    ["waiting_review", "approve",          "approved",       null,     "consumer"],
    ["waiting_review", "request_revision", "revision",       null,     "consumer"],
    ["revision",       "start",            "in_progress",    null,     "service"],
    ["approved",       "open_next",        "in_progress",    null,     "consumer"],
    ["approved",       "complete_workflow","completed",      "upload", "consumer"],
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

/** Dọn dữ liệu test theo companyId — xoá theo THỨ TỰ phụ thuộc FK (con trước, companies sau cùng). */
export async function cleanupTenants(direct: Pool, companyIds: string[]): Promise<void> {
  if (companyIds.length === 0) return;
  const ids = [companyIds];

  // ── G4-6 Communication ───────────────────────────────────────────────────
  await direct.query("DELETE FROM chat_messages WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM chat_room_members WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM chat_rooms WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM notifications WHERE company_id = ANY($1::uuid[])", ids);

  // ── G4-5 Approval / Defect ───────────────────────────────────────────────
  await direct.query("DELETE FROM defects WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM approval_steps WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM approval_requests WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query(
    "DELETE FROM workflow_step_instance_locks WHERE company_id = ANY($1::uuid[])",
    ids,
  );

  // ── G4-4 Tasks & Comments ────────────────────────────────────────────────
  await direct.query("DELETE FROM task_comments WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM tasks WHERE company_id = ANY($1::uuid[])", ids);

  // ── G4-3 Workflow ─────────────────────────────────────────────────────────
  await direct.query("DELETE FROM workflow_steps WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM workflow_instances WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM step_transitions WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM workflow_definition_steps WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM workflow_definitions WHERE company_id = ANY($1::uuid[])", ids);

  // ── G4-2 Media ────────────────────────────────────────────────────────────
  await direct.query("DELETE FROM content_items WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM project_channels WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM projects WHERE company_id = ANY($1::uuid[])", ids);
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
  await direct.query("DELETE FROM dead_letter_events WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM outbox_events WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM audit_logs WHERE company_id = ANY($1::uuid[])", ids);
  // refresh_tokens tự tham chiếu (replaced_by) → gỡ liên kết trước khi xoá để tránh vướng FK.
  await direct.query(
    "UPDATE refresh_tokens SET replaced_by = NULL WHERE company_id = ANY($1::uuid[])",
    ids,
  );
  await direct.query("DELETE FROM refresh_tokens WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM password_reset_tokens WHERE company_id = ANY($1::uuid[])", ids);
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
  await direct.query("DELETE FROM users WHERE company_id = ANY($1::uuid[])", ids);
  await direct.query("DELETE FROM companies WHERE id = ANY($1::uuid[])", ids);
}
