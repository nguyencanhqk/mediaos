import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ATTACHMENT_ALLOWED_CONTENT_TYPES,
  ATTACHMENT_MAX_BYTES,
  type AttachmentDownloadUrlDto,
  type AttachmentDto,
  type AttachmentUploadIntentDto,
  type CreateAttachmentIntentRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import {
  ObjectStorageService,
  StorageNotConfiguredError,
  UnsupportedAttachmentError,
} from "../storage/object-storage.service";
import { buildAttachmentKey, InvalidStorageKeyError } from "../storage/storage-key";
import { TasksRepository } from "./tasks.repository";

interface RequestUser {
  id: string;
  companyId: string;
}

const ALLOWED_CONTENT_TYPES = new Set<string>(ATTACHMENT_ALLOWED_CONTENT_TYPES);

/**
 * TaskAttachmentsService — upload/list/download/delete file đính kèm THẬT cho Task Hub (B4).
 *
 * BẤT BIẾN:
 *  - company_id ở MỌI query qua withTenant (RLS hàng rào thật). FK task_id trỏ PK toàn cục → guard
 *    task thuộc tenant app-side TRƯỚC khi cấp presigned (mirror SEC-1 createHubTask).
 *  - storage key do SERVER sinh `{companyId}/tasks/{taskId}/{uuid}` — client KHÔNG truyền key/path.
 *  - allowlist content-type + MAX_BYTES validate ở BIÊN service (KHÔNG chỉ DTO) — defense-in-depth.
 *  - append-only metadata: INSERT qua app role; xoá = soft-delete deleted_at qua worker (RLS-scoped),
 *    KHÔNG hard-delete.
 *  - audit upload/delete trong CÙNG tx (audit fail → rollback).
 */
@Injectable()
export class TaskAttachmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TasksRepository,
    private readonly storage: ObjectStorageService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Tạo upload-intent: gate (create:task HOẶC owner/assignee task) → validate type/size → sinh key
   * server-side → INSERT metadata + audit trong tx withTenant → presigned PUT URL (ephemeral).
   *
   * `hasCreatePermission` do controller (PermissionGuard) quyết; service OR thêm owner/assignee để
   * người được giao việc (0-quyền-global) vẫn đính kèm được — nhánh OR test cả 2.
   */
  async createUploadIntent(
    user: RequestUser,
    taskId: string,
    dto: CreateAttachmentIntentRequest,
    hasCreatePermission: boolean,
  ): Promise<AttachmentUploadIntentDto> {
    // SF: validate type/size ở biên service (defense-in-depth, KHÔNG tin DTO một mình).
    this.assertContentTypeAndSize(dto.contentType, dto.sizeBytes);

    if (!this.storage.isConfigured()) {
      // fail-CLOSED (KHÔNG fail-open): storage chưa cấu hình → 503, KHÔNG ghi metadata mồ côi.
      throw new ServiceUnavailableException("Object storage chưa sẵn sàng cho file đính kèm.");
    }

    const attachmentId = randomUUID();
    const storageKey = this.buildKeyOrThrow(user.companyId, taskId, attachmentId);

    const attachment = await this.db.withTenant(user.companyId, async (tx) => {
      // SEC-1: task phải thuộc tenant + owner/assignee check (OR với permission). Guard TRƯỚC insert.
      const [task] = await this.repo.findRawByIdTx(tx, user.companyId, taskId);
      if (!task) throw new NotFoundException(`Task not found: ${taskId}`);

      const isAssignee = await this.repo.isTaskAssigneeTx(tx, user.companyId, taskId, user.id);
      if (!hasCreatePermission && !isAssignee) {
        throw new ForbiddenException("Không có quyền đính kèm file vào task này.");
      }

      const [created] = await this.repo.createAttachment(
        user.companyId,
        {
          taskId,
          uploadedBy: user.id,
          storageKey,
          fileName: dto.fileName,
          contentType: dto.contentType,
          sizeBytes: dto.sizeBytes,
        },
        tx,
      );
      if (!created) throw new InternalServerErrorException("Failed to create attachment");

      await this.audit.record(tx, {
        action: "TaskAttachmentUploaded",
        objectType: "task_attachment",
        objectId: created.id,
        actorUserId: user.id,
        // KHÔNG ghi storage_key/secret (BẤT BIẾN #3) — chỉ metadata không nhạy cảm.
        after: {
          taskId,
          fileName: dto.fileName,
          contentType: dto.contentType,
          sizeBytes: dto.sizeBytes,
        },
      });

      return this.toDto(created);
    });

    // Presigned PUT — ephemeral, KHÔNG persist (BẤT BIẾN #3). Sinh SAU commit metadata.
    const uploadUrl = await this.createUploadUrlOrThrow(storageKey, dto.contentType, dto.sizeBytes);
    return { attachment, uploadUrl };
  }

  /** Liệt kê attachment chưa xoá của 1 task (RLS scope). Guard task thuộc tenant trước. */
  async listByTask(user: RequestUser, taskId: string): Promise<AttachmentDto[]> {
    await this.assertTaskInTenant(user.companyId, taskId);
    const rows = await this.repo.listAttachmentsByTask(user.companyId, taskId);
    return rows.map((r) => this.toDto(r));
  }

  /**
   * Presigned GET cho 1 attachment thuộc tenant hiện tại. Metadata 0 row (RLS / cross-tenant / không
   * tồn tại) → 404 KHÔNG phân biệt (tránh oracle). Key re-assert thuộc tenant trước khi ký URL.
   */
  async getDownloadUrl(
    user: RequestUser,
    taskId: string,
    attachmentId: string,
  ): Promise<AttachmentDownloadUrlDto> {
    if (!this.storage.isConfigured()) {
      throw new ServiceUnavailableException("Object storage chưa sẵn sàng cho file đính kèm.");
    }
    const [row] = await this.db.withTenant(user.companyId, (tx) =>
      this.repo.findAttachmentByIdTx(tx, user.companyId, taskId, attachmentId),
    );
    if (!row) throw new NotFoundException("Attachment not found");

    try {
      const downloadUrl = await this.storage.createDownloadUrl(row.storageKey, user.companyId);
      return { downloadUrl };
    } catch (err) {
      if (err instanceof InvalidStorageKeyError) {
        // Key của hàng metadata bất thường (không thuộc tenant prefix) → KHÔNG ký URL, 404 (không lộ).
        throw new NotFoundException("Attachment not found");
      }
      throw err;
    }
  }

  /**
   * Soft-delete (set deleted_at) + audit TaskAttachmentDeleted trong CÙNG tx withTenant (app role).
   * App role có column-grant UPDATE(deleted_at) (chỉ cột này) + INSERT audit_logs → soft-delete và
   * audit cùng commit/rollback (audit fail → rollback, KHÔNG xoá nửa vời). Nội dung vẫn bất biến (app
   * KHÔNG có UPDATE cột nội dung). 0 row (RLS/cross-tenant/không tồn tại/đã xoá) → 404 (tránh oracle).
   */
  async softDelete(user: RequestUser, taskId: string, attachmentId: string): Promise<void> {
    await this.db.withTenant(user.companyId, async (tx) => {
      const updated = await this.repo.softDeleteAttachment(
        user.companyId,
        taskId,
        attachmentId,
        tx,
      );
      if (updated.length === 0) {
        throw new NotFoundException("Attachment not found");
      }

      await this.audit.record(tx, {
        action: "TaskAttachmentDeleted",
        objectType: "task_attachment",
        objectId: attachmentId,
        actorUserId: user.id,
        before: { taskId },
      });
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private assertContentTypeAndSize(contentType: string, sizeBytes: number): void {
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestException(`Content-type không được phép: ${contentType}`);
    }
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      throw new BadRequestException("Kích thước file không hợp lệ.");
    }
    if (sizeBytes > ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException(`File vượt giới hạn ${ATTACHMENT_MAX_BYTES} bytes.`);
    }
  }

  private buildKeyOrThrow(companyId: string, taskId: string, attachmentId: string): string {
    try {
      return buildAttachmentKey(companyId, taskId, attachmentId);
    } catch (err) {
      if (err instanceof InvalidStorageKeyError) {
        throw new BadRequestException("Không thể tạo storage key hợp lệ.");
      }
      throw err;
    }
  }

  private async createUploadUrlOrThrow(
    key: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<string> {
    try {
      return await this.storage.createUploadUrl(key, contentType, sizeBytes);
    } catch (err) {
      if (err instanceof StorageNotConfiguredError) {
        throw new ServiceUnavailableException("Object storage chưa sẵn sàng cho file đính kèm.");
      }
      if (err instanceof UnsupportedAttachmentError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  private async assertTaskInTenant(companyId: string, taskId: string): Promise<void> {
    const [task] = await this.db.withTenant(companyId, (tx) =>
      this.repo.findRawByIdTx(tx, companyId, taskId),
    );
    if (!task) throw new NotFoundException(`Task not found: ${taskId}`);
  }

  private toDto(row: {
    id: string;
    taskId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    uploadedBy: string | null;
    createdAt: Date;
  }): AttachmentDto {
    return {
      id: row.id,
      taskId: row.taskId,
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      uploadedBy: row.uploadedBy,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
