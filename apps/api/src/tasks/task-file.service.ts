import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  FOUNDATION_FILE_ERROR_CODES,
  type DownloadUrlDto,
  type ListTaskFilesQuery,
  type TaskFileDto,
} from "@mediaos/contracts";
import type { SQL } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import { FileService } from "../foundation/files/files.service";
import { TaskCoreRepository } from "./task-core.repository";
import {
  TASK_ENTITY,
  TASK_MODULE,
  TaskFileRepository,
  type TaskFileRow,
} from "./task-file.repository";
import { TaskActivityService } from "./task-activity.service";

interface RequestUser {
  id: string;
  companyId: string;
}

/** resourceType + actions for task-file data_scope (matches seed mig 0485). */
const TASK_RESOURCE = "task";
const ACTION_READ = "read";
const ACTION_UPLOAD = "file-upload";
const ACTION_DELETE = "file-delete";

const ERR_TASK_NOT_FOUND = "TASK-ERR-TASK-NOT-FOUND: không tìm thấy công việc.";
const ERR_FILE_NOT_FOUND = "TASK-ERR-FILE-NOT-FOUND: không tìm thấy tệp đính kèm.";

/**
 * scan_status values that MAY be downloaded. STRICTER than FileService's own state-guard (which only blocks
 * Infected + not-Uploaded): a task attachment must be Clean or NotRequired — Pending/Failed/Infected all 409
 * BEFORE a signed URL is minted (defense against serving unscanned content).
 */
const DOWNLOADABLE_SCAN = new Set(["Clean", "NotRequired"]);

/**
 * S4-TASK-BE-5 — Task File service (đính kèm công việc). Reuses the S2-HR-EMPFILE-1 pattern; NO task_files
 * table — the polymorphic file_links (module_code='TASK', entity_type='task') is the canonical surface.
 * Crown-jewel touch points:
 *  - BẤT BIẾN #1: every read/write runs in withTenant(user.companyId); the repo ANDs company_id; RLS+FORCE
 *    is the final wall. cross-tenant task/file ⇒ RLS 0-row ⇒ 404 (no leak).
 *  - IDOR: assertScope resolves the data_scope for the (action,'task') pair and isTaskInScopeTx the target
 *    task (assignee-in-scope OR active project-member); findLinkedFileTx proves the file belongs to THIS
 *    task (cross-task → 404). Out-of-scope / not-found ⇒ 404 (never 403-after-200, never oracle).
 *  - BẤT BIẾN #2: no own audit object_type — FileService owns file_link/file soft-delete + FileLinked/
 *    FileDeleted audit (append-only) + Link/Download/Delete access-log, all in its own tenant tx. This
 *    service additionally appends TASK_FILE_UPLOADED/TASK_FILE_DELETED to task_activity_logs (append-only).
 *  - Scan-guard: download only for Clean/NotRequired (409 otherwise) BEFORE FileService.getDownloadUrl.
 *
 * The controller's @RequirePermission('read'|'file-upload'|'file-delete','task') is the COARSE gate (403
 * when no grant at all). This service adds the FINE data_scope narrowing + per-task in-scope check.
 */
@Injectable()
export class TaskFileService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TaskFileRepository,
    private readonly coreRepo: TaskCoreRepository,
    private readonly dataScope: DataScopeService,
    private readonly files: FileService,
    private readonly activity: TaskActivityService,
  ) {}

  // ── List ────────────────────────────────────────────────────────────────────

  async list(user: RequestUser, taskId: string, query: ListTaskFilesQuery): Promise<TaskFileDto[]> {
    await this.assertScope(user, taskId, ACTION_READ);
    return this.db.withTenant(user.companyId, async (tx) => {
      const rows = await this.repo.listLinkedFilesByTaskTx(
        tx,
        user.companyId,
        taskId,
        query.category,
      );
      return rows.map((r) => this.toDto(r));
    });
  }

  // ── Metadata (single) ─────────────────────────────────────────────────────────

  async getMetadata(user: RequestUser, taskId: string, fileId: string): Promise<TaskFileDto> {
    await this.assertScope(user, taskId, ACTION_READ);
    const row = await this.loadLinkedFileOr404(user, taskId, fileId);
    return this.toDto(row);
  }

  // ── Download (signed URL, TTL-ngắn) ─────────────────────────────────────────────

  async getDownloadUrl(user: RequestUser, taskId: string, fileId: string): Promise<DownloadUrlDto> {
    await this.assertScope(user, taskId, ACTION_READ);
    const row = await this.loadLinkedFileOr404(user, taskId, fileId);

    // STRICT scan-guard BEFORE FileService: only Clean/NotRequired may be presigned (409 otherwise).
    if (!DOWNLOADABLE_SCAN.has(row.scanStatus)) {
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.NOT_DOWNLOADABLE,
        message: `${FOUNDATION_FILE_ERROR_CODES.NOT_DOWNLOADABLE}: file chưa quét sạch (scan_status=${row.scanStatus}).`,
      });
    }

    // FileService re-checks authorization (resolver) + upload-state-guard + writes the Download access-log.
    return this.files.getDownloadUrl(user, fileId);
  }

  // ── Link (attach an already uploaded+confirmed file) ────────────────────────────

  async link(
    user: RequestUser,
    taskId: string,
    fileId: string,
    category?: string,
  ): Promise<TaskFileDto> {
    await this.assertScope(user, taskId, ACTION_UPLOAD);

    // FileService.link: resolver gate (canLinkFile) + validate file tenant/scan + insert file_links +
    // audit FileLinked (object_type 'file_link') + access-log Link — all in its own tenant tx.
    await this.files.link(user, {
      fileId,
      moduleCode: TASK_MODULE,
      entityType: TASK_ENTITY,
      entityId: taskId,
      linkType: "Attachment",
      accessScope: "Company",
      isPrimary: false,
      purpose: category,
    });

    await this.recordActivity(
      user,
      taskId,
      fileId,
      "TASK_FILE_UPLOADED",
      "Đính kèm tệp vào công việc",
    );

    const row = await this.loadLinkedFileOr404(user, taskId, fileId);
    return this.toDto(row);
  }

  // ── Delete (soft) ────────────────────────────────────────────────────────────

  async delete(user: RequestUser, taskId: string, fileId: string): Promise<void> {
    await this.assertScope(user, taskId, ACTION_DELETE);
    // Prove the file belongs to THIS task (cross-task → 404) before FileService soft-deletes it.
    await this.loadLinkedFileOr404(user, taskId, fileId);

    // FileService.deleteFile: resolver gate (canDeleteFile) + soft-delete files (deleted_at) + audit
    // FileDeleted (object_type 'file') + access-log Delete. Removes it from the list (files.deleted_at).
    await this.files.deleteFile(user, fileId);

    await this.recordActivity(
      user,
      taskId,
      fileId,
      "TASK_FILE_DELETED",
      "Gỡ tệp đính kèm khỏi công việc",
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * FINE data_scope narrowing over the target task. resolveAndAssert throws Forbidden only when the caller
   * has NO grant (already gated by PermissionGuard on the route, so normally passes). Then check task-in-scope
   * inside the tenant tx — out-of-scope / cross-tenant (RLS 0-row) / not-found ⇒ 404 (never 403-after-200,
   * never leak existence).
   */
  private async assertScope(user: RequestUser, taskId: string, action: string): Promise<void> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      action,
      TASK_RESOURCE,
    );
    const inScope = await this.db.withTenant(user.companyId, async (tx) => {
      let scopeExists: SQL | undefined;
      if (scope !== "Company" && scope !== "System") {
        const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
        const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
        const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(
          tx,
          user.companyId,
          user.id,
        );
        scopeExists = this.coreRepo.buildReadScopeExists(
          user.companyId,
          scopeCond,
          actorEmp?.id ?? null,
          user.id,
        );
      }
      return this.repo.isTaskInScopeTx(tx, user.companyId, taskId, scopeExists);
    });
    if (!inScope) throw new NotFoundException(ERR_TASK_NOT_FOUND);
  }

  /** Load the one file linked to `taskId` (soft-delete filtered) or 404 (cross-task/gone/leak). */
  private async loadLinkedFileOr404(
    user: RequestUser,
    taskId: string,
    fileId: string,
  ): Promise<TaskFileRow> {
    const row = await this.db.withTenant(user.companyId, (tx) =>
      this.repo.findLinkedFileTx(tx, user.companyId, taskId, fileId),
    );
    if (!row) throw new NotFoundException(ERR_FILE_NOT_FOUND);
    return row;
  }

  /**
   * Append a TASK_FILE_* row (target_type 'File') to task_activity_logs (BẤT BIẾN #2 append-only). Runs in
   * its own withTenant tx AFTER the FileService operation committed — the activity feed is not a ledger
   * invariant, so a separate tx is acceptable (still tenant-scoped + append-only).
   */
  private async recordActivity(
    user: RequestUser,
    taskId: string,
    fileId: string,
    action: "TASK_FILE_UPLOADED" | "TASK_FILE_DELETED",
    message: string,
  ): Promise<void> {
    await this.db.withTenant(user.companyId, async (tx: TenantTx) => {
      const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(tx, user.companyId, user.id);
      // S5-TASK-WORKSPACE-1: projectId PHẢI đi kèm (mirror TASK_WATCHER_*) — feed dự án TASK-API-601
      // lọc theo project_id; thiếu là sự kiện file biến mất khỏi tab Hoạt động của workspace.
      const raw = await this.coreRepo.findRawByIdTx(tx, user.companyId, taskId);
      await this.activity.record(tx, {
        action,
        targetType: "File",
        targetId: fileId,
        taskId,
        projectId: raw?.projectId ?? null,
        actorUserId: user.id,
        actorEmployeeId: actorEmp?.id ?? null,
        message,
      });
    });
  }

  private toDto(row: TaskFileRow): TaskFileDto {
    return {
      linkId: row.linkId,
      fileId: row.fileId,
      originalName: row.originalName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      scanStatus: row.scanStatus as TaskFileDto["scanStatus"],
      uploadStatus: row.uploadStatus as TaskFileDto["uploadStatus"],
      uploadedAt: row.uploadedAt.toISOString(),
      category: row.category,
    };
  }
}
