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

/**
 * `projectId` TUỲ CHỌN (S19-OPS-TASKFILEURL-1 L1b, ca J-11 phạm vi theo dự án). Bỏ trống ⇒ `project_id`
 * NULL — đúng hành vi cũ (cột nullable, không default).
 */
export async function seedTask(
  direct: Pool,
  companyId: string,
  assigneeEmployeeId: string | null,
  projectId: string | null = null,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO tasks (company_id, task_type, title, task_status, main_assignee_employee_id, project_id)
     VALUES ($1, 'office', 't5-task', 'Todo', $2, $3) RETURNING id`,
    [companyId, assigneeEmployeeId, projectId],
  );
  return r.rows[0].id as string;
}

/** Seed a `files` row (Uploaded by default). storage_path = {companyId}/files/{fileId} (tenant prefix). */
export async function seedFile(
  direct: Pool,
  companyId: string,
  uploadedBy: string,
  opts?: { scanStatus?: string; uploadStatus?: string; ownerUserId?: string },
): Promise<string> {
  const fileId = randomUUID();
  const storagePath = `${companyId}/files/${fileId}`;
  await direct.query(
    `INSERT INTO files
       (id, company_id, original_name, stored_name, mime_type, file_size_bytes, storage_provider,
        storage_path, upload_status, scan_status, uploaded_by, owner_user_id)
     VALUES ($1, $2, 'attach.pdf', $3, 'application/pdf', 4096, 'MinIO', $4, $5, $6, $7, $8)`,
    [
      fileId,
      companyId,
      fileId,
      storagePath,
      opts?.uploadStatus ?? "Uploaded",
      opts?.scanStatus ?? "Clean",
      uploadedBy,
      opts?.ownerUserId ?? null,
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

/**
 * Dự án + MỘT thành viên `Active` (S19-OPS-TASKFILEURL-1 L1b, ca J-11). Nhánh phạm vi theo dự án của
 * `buildReadScopeExists` (mode `read`) cho mọi thành viên `Active` đọc task của dự án — kể cả `Viewer`.
 * Đổi `member_status` sau đó bằng UPDATE thẳng trên `memberId` để đo vế từ chối.
 */
export async function seedProjectMember(
  direct: Pool,
  companyId: string,
  member: { userId: string; employeeId: string; role?: "Owner" | "Manager" | "Member" | "Viewer" },
): Promise<{ projectId: string; memberId: string }> {
  const p = await direct.query(
    `INSERT INTO projects (company_id, name, project_status) VALUES ($1, 'tfu-proj', 'Active') RETURNING id`,
    [companyId],
  );
  const projectId = p.rows[0].id as string;
  const m = await direct.query(
    `INSERT INTO project_members (company_id, project_id, user_id, employee_id, project_role, member_status)
     VALUES ($1, $2, $3, $4, $5, 'Active') RETURNING id`,
    [companyId, projectId, member.userId, member.employeeId, member.role ?? "Viewer"],
  );
  return { projectId, memberId: m.rows[0].id as string };
}
