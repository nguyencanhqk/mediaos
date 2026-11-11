import { createHash } from "node:crypto";
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  type Logger,
} from "@nestjs/common";
import {
  FOUNDATION_FILE_ERROR_CODES,
  type ConfirmUploadInput,
  type ConfirmUploadResponse,
} from "@mediaos/contracts";
import type { DatabaseService } from "../../db/db.service";
import type { AuditService } from "../../events/audit.service";
import type { StorageAdapter } from "../../storage/storage-adapter.port";
import type { FileRecord } from "../../db/schema/files";
import type { FileAccessLogService } from "./file-access-log.service";
import {
  CONFIRM_FAILURE_ERROR_CODE,
  confirmContentTypeFailure,
  type ConfirmFailureReason,
} from "./file-content-guard";
import type { FileRepository } from "./file.repository";

/** Acting user resolved from the authenticated request (JwtAuthGuard + CompanyGuard). */
interface RequestUser {
  id: string;
  companyId: string;
}

/** Phụ thuộc của pha confirm — chính các thành phần FileService đã giữ (không DI mới). */
export interface FileConfirmDeps {
  db: DatabaseService;
  fileRepo: FileRepository;
  accessLog: FileAccessLogService;
  audit: AuditService;
  storage: StorageAdapter;
  logger: Logger;
}

/**
 * S2-FND-FILE-2 — pha 3 của upload E2E (confirm), tách khỏi files.service.ts (S16-SOCIAL-FILESVCSPLIT-1).
 * Không phải provider Nest: `FileService` dựng bản này từ cùng các phụ thuộc và uỷ quyền `confirmUpload`.
 */
export class FileConfirmFlow {
  constructor(private readonly deps: FileConfirmDeps) {}

  /**
   * POST /foundation/files/:id/confirm — pha 3 của upload E2E. Gate `upload:foundation-file` ép ở controller.
   * CHỈ file 'Pending' trong tenant (RLS + WHERE company_id + upload_status='Pending'). Verify object THẬT ở
   * storage: tồn tại + ContentLength == size khai báo + kiểu đang LƯU khớp MIME đã đăng ký; checksum_sha256 tính
   * server-side từ bytes (KHÔNG tin client). Khớp → 'Uploaded' + persist checksum. Absent → 'Failed'+lý do → 422
   * CONFIRM_ABSENT. Size/kiểu lệch → 'Failed'+lý do → 409 CONFIRM_MISMATCH (KHÔNG persist checksum). Đã 'Uploaded'
   * → idempotent 200. Non-Pending khác (Failed/Deleted) → 409 NOT_PENDING. Audit ghi CÙNG tx withTenant (#1/#2).
   */
  async confirmUpload(
    user: RequestUser,
    fileId: string,
    _input: ConfirmUploadInput,
  ): Promise<ConfirmUploadResponse> {
    const { db, fileRepo, accessLog, audit, storage, logger } = this.deps;
    const row = await db.withTenant(user.companyId, (tx) =>
      fileRepo.findByIdTx(user.companyId, fileId, tx),
    );
    if (!row) throw new NotFoundException("File không tồn tại");
    // Tệp TẠM hệ thống sinh tự chốt qua ServerFileService (S15-PAYROLL-BE-5B); chỉ CHỦ tệp xác nhận (S19-SEC-
    // FILEMETAGATE-1; wrapper module kiểm chủ trước). Cả hai ⇒ 404 như tệp vắng: không lộ tồn tại/cỡ, không đổi trạng thái.
    if (row.isTemporary || row.ownerUserId !== user.id)
      throw new NotFoundException("File không tồn tại");

    // Idempotent: đã Uploaded → trả trạng thái hiện tại (confirm gọi lại vô hại). Non-Pending khác → 409.
    if (row.uploadStatus === "Uploaded") {
      return { fileId: row.id, uploadStatus: "Uploaded", sizeBytes: row.fileSizeBytes };
    }
    if (row.uploadStatus !== "Pending") {
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.NOT_PENDING,
        message: `${FOUNDATION_FILE_ERROR_CODES.NOT_PENDING}: file không ở trạng thái Pending (hiện: ${row.uploadStatus}).`,
      });
    }

    // Verify object THẬT ở storage (HEAD) — không throw khi absent (adapter trả exists=false).
    const stat = await storage.stat({ key: row.storagePath, companyId: user.companyId });
    if (!stat.exists) {
      await this.failConfirm(user, row, "object-absent");
      throw new UnprocessableEntityException({
        code: FOUNDATION_FILE_ERROR_CODES.CONFIRM_ABSENT,
        message: `${FOUNDATION_FILE_ERROR_CODES.CONFIRM_ABSENT}: object chưa tồn tại ở storage (client chưa PUT?).`,
      });
    }
    if (stat.sizeBytes !== row.fileSizeBytes) {
      await this.failConfirm(user, row, "size-mismatch");
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.CONFIRM_MISMATCH,
        message: `${FOUNDATION_FILE_ERROR_CODES.CONFIRM_MISMATCH}: size storage (${stat.sizeBytes}) khác khai báo (${row.fileSizeBytes}).`,
      });
    }
    // Kiểu storage đang LƯU phải khớp kiểu đã đăng ký; lệch HOẶC storage không trả kiểu ⇒ Failed (fail-closed),
    // mỗi trường hợp một lý do riêng + một dòng warn (không mang khoá object).
    const typeFailure = confirmContentTypeFailure(row, stat.contentType);
    if (typeFailure !== null) {
      logger.warn(typeFailure.logLine);
      await this.failConfirm(user, row, typeFailure.reason);
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.CONFIRM_MISMATCH,
        message: `${FOUNDATION_FILE_ERROR_CODES.CONFIRM_MISMATCH}: ${typeFailure.message}`,
      });
    }

    // Đọc bytes + tính checksum server-side (KHÔNG tin client). NOT dùng cho download (chỉ checksum).
    const bytes = await storage.getBytes({ key: row.storagePath, companyId: user.companyId });
    const checksum = createHash("sha256").update(bytes).digest("hex");

    return db.withTenant(user.companyId, async (tx) => {
      const affected = await fileRepo.markUploadedTx(
        user.companyId,
        fileId,
        { checksumSha256: checksum, sizeBytes: row.fileSizeBytes },
        tx,
      );
      // Race: một request khác đã đổi trạng thái giữa chừng → coi như không còn Pending → 409 (không audit).
      if (affected === 0) {
        throw new ConflictException({
          code: FOUNDATION_FILE_ERROR_CODES.NOT_PENDING,
          message: `${FOUNDATION_FILE_ERROR_CODES.NOT_PENDING}: file không còn ở trạng thái Pending.`,
        });
      }

      // Audit 'file'/FileUploadConfirmed — CÙNG tx (BẤT BIẾN #2). checksum KHÔNG đưa vào after (masker che
      // + tránh lộ; after chỉ metadata trạng thái). storage_path CỐ Ý không đưa vào.
      await audit.record(tx, {
        action: "FileUploadConfirmed",
        objectType: "file",
        objectId: fileId,
        actorUserId: user.id,
        actorType: "User",
        resultStatus: "Success",
        dataScope: "Company",
        before: { uploadStatus: row.uploadStatus },
        after: { uploadStatus: "Uploaded", fileSizeBytes: row.fileSizeBytes },
      });

      await accessLog.record(tx, {
        fileId,
        action: "Upload",
        accessGranted: true,
        actorUserId: user.id,
        permissionCode: "FOUNDATION.FILE.UPLOAD",
      });

      return { fileId, uploadStatus: "Uploaded", sizeBytes: row.fileSizeBytes };
    });
  }

  /**
   * Ghi confirm THẤT BẠI: Pending → Failed + lý do (KHÔNG persist checksum) + audit CÙNG tx. Row đã đổi
   * trạng thái (affected=0) → bỏ qua audit (không ghi trạng thái sai). Mã lỗi tra theo lý do (bảng đủ khoá).
   */
  private async failConfirm(
    user: RequestUser,
    row: FileRecord,
    reason: ConfirmFailureReason,
  ): Promise<void> {
    const { db, fileRepo, accessLog, audit } = this.deps;
    await db.withTenant(user.companyId, async (tx) => {
      const affected = await fileRepo.markFailedTx(user.companyId, row.id, reason, tx);
      if (affected === 0) return;
      await audit.record(tx, {
        action: "FileUploadFailed",
        objectType: "file",
        objectId: row.id,
        actorUserId: user.id,
        actorType: "User",
        resultStatus: "Failure",
        dataScope: "Company",
        before: { uploadStatus: row.uploadStatus },
        after: { uploadStatus: "Failed" },
        errorCode: CONFIRM_FAILURE_ERROR_CODE[reason],
      });
      await accessLog.record(tx, {
        fileId: row.id,
        action: "Upload",
        accessGranted: false,
        actorUserId: user.id,
        deniedReason: reason,
        permissionCode: "FOUNDATION.FILE.UPLOAD",
      });
    });
  }
}
