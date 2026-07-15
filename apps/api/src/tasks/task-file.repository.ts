import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { sql, type SQL } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { fileLinks, files } from "../db/schema";

/**
 * S4-TASK-BE-5 — read-only persistence for TASK files (đính kèm công việc). The FILE lifecycle
 * (upload/soft-delete) is owned by Foundation FileService (files/file_links); this repo only READS the
 * polymorphic join (module_code='TASK', entity_type='task', entity_id=taskId) so the task surface can list a
 * task's attachments and resolve one file for metadata/download/scan-guard. It ALSO answers the "is this task
 * in the actor's read scope?" predicate (isTaskInScopeTx) used by the resolver + service IDOR guard.
 *
 * Mirrors employee-file.repository EXACTLY (safe join fields only — NO storage_path/checksum). Every method
 * runs INSIDE the caller's tenant tx (withTenant → RLS+FORCE); each WHERE also ANDs company_id
 * (defense-in-depth, BẤT BIẾN #1). Soft-deleted rows are excluded (BẤT BIẾN #2): a link whose
 * file_links.deleted_at OR files.deleted_at is set never appears — proves DELETE removed it without hard-delete.
 */

/** module_code / entity_type MUST match what TaskFileService passes to FileService.link. */
export const TASK_MODULE = "TASK";
export const TASK_ENTITY = "task";

/** A joined file_links⋈files row surfaced to the service (safe fields only — no storage_path/checksum). */
export interface TaskFileRow {
  linkId: string;
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: string;
  uploadStatus: string;
  uploadedAt: Date;
  category: string | null;
}

const FILE_COLUMNS = {
  linkId: fileLinks.id,
  fileId: files.id,
  originalName: files.originalName,
  mimeType: files.mimeType,
  sizeBytes: files.fileSizeBytes,
  scanStatus: files.scanStatus,
  uploadStatus: files.uploadStatus,
  uploadedAt: files.uploadedAt,
  category: fileLinks.purpose,
} as const;

@Injectable()
export class TaskFileRepository {
  /**
   * List a task's linked files (soft-delete filtered on BOTH file_links and files), newest first.
   * `category` (optional) filters on file_links.purpose. RLS + explicit company_id keep it tenant-bound.
   */
  async listLinkedFilesByTaskTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    category?: string,
  ): Promise<TaskFileRow[]> {
    const conds = [
      eq(fileLinks.companyId, companyId),
      eq(fileLinks.moduleCode, TASK_MODULE),
      eq(fileLinks.entityType, TASK_ENTITY),
      eq(fileLinks.entityId, taskId),
      isNull(fileLinks.deletedAt),
      isNull(files.deletedAt),
    ];
    if (category) conds.push(eq(fileLinks.purpose, category));

    const rows = await tx
      .select(FILE_COLUMNS)
      .from(fileLinks)
      .innerJoin(files, eq(fileLinks.fileId, files.id))
      .where(and(...conds))
      .orderBy(desc(files.uploadedAt));
    return rows as TaskFileRow[];
  }

  /**
   * Resolve ONE file that is BOTH linked to `taskId` AND still live (link + file not soft-deleted).
   * Returns undefined when the file is not linked to THIS task (cross-task IDOR) or cross-tenant (RLS 0-row)
   * — the service maps that to 404 (no oracle). Carries scanStatus/uploadStatus for the download scan-guard.
   */
  async findLinkedFileTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    fileId: string,
  ): Promise<TaskFileRow | undefined> {
    const [row] = await tx
      .select(FILE_COLUMNS)
      .from(fileLinks)
      .innerJoin(files, eq(fileLinks.fileId, files.id))
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.moduleCode, TASK_MODULE),
          eq(fileLinks.entityType, TASK_ENTITY),
          eq(fileLinks.entityId, taskId),
          eq(fileLinks.fileId, fileId),
          isNull(fileLinks.deletedAt),
          isNull(files.deletedAt),
        ),
      )
      .limit(1);
    return row as TaskFileRow | undefined;
  }

  /**
   * S5-TASK-BE-6 — attachment count GROUPED by `entity_id` (taskId) for EVERY task in `taskIds` (1 query,
   * NO N+1 — Kanban board). Filters BOTH `file_links.deletedAt` AND `files.deletedAt` (mirror
   * listLinkedFilesByTaskTx) so a soft-deleted link or a soft-deleted file never inflates the count. Empty
   * `taskIds` ⇒ empty Map (skip the round-trip for a project with 0 tasks).
   */
  async countByTaskIdsTx(
    tx: TenantTx,
    companyId: string,
    taskIds: string[],
  ): Promise<Map<string, number>> {
    if (taskIds.length === 0) return new Map();
    const rows = await tx
      .select({ taskId: fileLinks.entityId, n: sql<number>`count(*)::int` })
      .from(fileLinks)
      .innerJoin(files, eq(fileLinks.fileId, files.id))
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.moduleCode, TASK_MODULE),
          eq(fileLinks.entityType, TASK_ENTITY),
          inArray(fileLinks.entityId, taskIds),
          isNull(fileLinks.deletedAt),
          isNull(files.deletedAt),
        ),
      )
      .groupBy(fileLinks.entityId);
    return new Map(rows.map((r) => [r.taskId, Number(r.n)]));
  }

  /**
   * TRUE iff a live task `taskId` exists in this tenant AND (when `scopeExists` is provided) matches the
   * actor's read-scope predicate (assignee-in-scope OR active project-member — built by
   * TaskCoreRepository.buildReadScopeExists). Company/System scope ⇒ caller passes no `scopeExists` ⇒ any
   * live in-tenant task matches. Not found / cross-tenant RLS 0-row / out-of-scope ⇒ false ⇒ fail-closed
   * (404 in the service, deny in the resolver). Correlate outer alias `tk` (matches buildReadScopeExists).
   */
  async isTaskInScopeTx(
    tx: TenantTx,
    companyId: string,
    taskId: string,
    scopeExists?: SQL,
  ): Promise<boolean> {
    const conds: SQL[] = [
      sql`tk.id = ${taskId}`,
      sql`tk.company_id = ${companyId}`,
      sql`tk.deleted_at is null`,
    ];
    if (scopeExists) conds.push(scopeExists);
    const where = sql.join(conds, sql` and `);
    const res = await tx.execute(sql`select 1 from tasks tk where ${where} limit 1`);
    return res.rows.length > 0;
  }
}
