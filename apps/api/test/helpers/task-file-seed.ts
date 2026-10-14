import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { seedPermissionCatalog, seedRole, seedRolePermission, seedUserRole } from "./seed";

/**
 * Fixture dùng chung cho int-spec tệp đính kèm TASK (`/tasks/:taskId/files`).
 *
 * Dời NGUYÊN VĂN từ `test/integration/task-files-access.int-spec.ts` (S19-OPS-TASKFILEURL-1, lát L1a) để
 * int-spec `download-url` dùng lại mà không chép thân hàm. Chỉ đổi chỗ khai báo: thân hàm giữ nguyên.
 * Gieo bằng SQL thẳng qua `directPool` (superuser, đi vòng RLS) — đúng khuôn của spec gốc.
 */

export type Pair = [action: string, resourceType: string];

const SENSITIVE = new Set(["delete", "export", "view", "view-report"]);

/** Grant a fresh company-scoped role carrying `pairs` to `userId` at `scope`. */
export async function grant(
  direct: Pool,
  companyId: string,
  userId: string,
  pairs: Pair[],
  scope: "Own" | "Team" | "Department" | "Company" | "System" = "Company",
): Promise<void> {
  const roleId = await seedRole(direct, companyId, `qa-taskfile-${scope}-${userId.slice(0, 8)}`);
  for (const [action, resourceType] of pairs) {
    const permId = await seedPermissionCatalog(direct, action, resourceType, SENSITIVE.has(action));
    await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
  }
  await seedUserRole(direct, userId, roleId, companyId);
}

export async function seedEmployee(
  direct: Pool,
  companyId: string,
  userId: string | null,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
    [companyId, userId],
  );
  return r.rows[0].id as string;
}

export async function seedTask(
  direct: Pool,
  companyId: string,
  assigneeEmployeeId: string | null,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO tasks (company_id, task_type, title, task_status, main_assignee_employee_id)
     VALUES ($1, 'office', 't5-task', 'Todo', $2) RETURNING id`,
    [companyId, assigneeEmployeeId],
  );
  return r.rows[0].id as string;
}

/** Seed a `files` row (Uploaded by default). storage_path = {companyId}/files/{fileId} (tenant prefix). */
export async function seedFile(
  direct: Pool,
  companyId: string,
  uploadedBy: string,
  opts?: { scanStatus?: string; uploadStatus?: string },
): Promise<string> {
  const fileId = randomUUID();
  const storagePath = `${companyId}/files/${fileId}`;
  await direct.query(
    `INSERT INTO files
       (id, company_id, original_name, stored_name, mime_type, file_size_bytes, storage_provider,
        storage_path, upload_status, scan_status, uploaded_by)
     VALUES ($1, $2, 'attach.pdf', $3, 'application/pdf', 4096, 'MinIO', $4, $5, $6, $7)`,
    [
      fileId,
      companyId,
      fileId,
      storagePath,
      opts?.uploadStatus ?? "Uploaded",
      opts?.scanStatus ?? "Clean",
      uploadedBy,
    ],
  );
  return fileId;
}

/** Seed a file_links row (module TASK / entity task). Returns linkId. */
export async function seedTaskLink(
  direct: Pool,
  companyId: string,
  fileId: string,
  taskId: string,
  createdBy: string,
  category: string | null = null,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO file_links
       (company_id, file_id, module_code, entity_type, entity_id, link_type, access_scope, is_primary,
        purpose, created_by)
     VALUES ($1, $2, 'TASK', 'task', $3, 'Attachment', 'Company', false, $4, $5) RETURNING id`,
    [companyId, fileId, taskId, category, createdBy],
  );
  return r.rows[0].id as string;
}
