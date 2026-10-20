import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import {
  FOUNDATION_FILE_ERROR_CODES,
  type ConfirmUploadInput,
  type ConfirmUploadResponse,
  type DownloadUrlDto,
  type FileLinkDto,
  type FileMetadataDto,
  type LinkFileInput,
  type RegisterFileResponse,
  type UploadFileInput,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../../db/db.service";
import { AuditService } from "../../events/audit.service";
import { STORAGE_ADAPTER, type StorageAdapter } from "../../storage/storage-adapter.port";
import { buildFileKey, InvalidStorageKeyError } from "../../storage/file-storage-key";
import { UnsupportedAttachmentError } from "../../storage/object-storage.service";
import type { FileLink, FileRecord, NewFileLink, NewFileRecord } from "../../db/schema/files";
import { SettingService } from "../settings/setting.service";
import { FileAccessLogService } from "./file-access-log.service";
import {
  CONFIRM_FAILURE_ERROR_CODE,
  MALFORMED_EXTENSION_MESSAGE,
  confirmContentTypeFailure,
  describeSignRejection,
  registerContentRejection,
  resolveRegisterExtension,
  type ConfirmFailureReason,
} from "./file-content-guard";
import { fileDownloadStateDenyReason, type FileDownloadDenyReason } from "./file-download-state";
import { FileLinkRepository } from "./file-link.repository";
import { FilePolicyService } from "./file-policy.service";
import { FileRepository } from "./file.repository";
import { isExtensionConsistentWithMime } from "./mime-extension";
import { toFileMetadataDto, toLinkDto } from "./file-metadata.mapper";
import { decideFileAccess, decideLinkAccess, type FileAccessContext } from "./file-access-decision";
import {
  assertLinkableFile,
  assertRegisteredLinkTarget,
  assertSameLinkSnapshot,
  fileForbidden,
  linkFileMissing,
  rethrowLinkInsertError,
} from "./file-link-guard";
import { FilePolicyAction, FOUNDATION_FILE_PERMISSION } from "./file-policy.types";
import {
  FOUNDATION_FILE_ENTITY,
  FOUNDATION_FILE_MODULE,
  filePolicyInput,
  fileSelfPolicyInput,
  toFileLinkRef,
} from "./file-view-decision";

/** Acting user resolved from the authenticated request (JwtAuthGuard + CompanyGuard). */
interface RequestUser {
  id: string;
  companyId: string;
}

/** system_settings keys (precedence company > system > default via SettingService). */
const SETTING_MAX_UPLOAD_MB = "file.max_upload_size_mb";
const SETTING_ALLOWED_MIME = "file.allowed_mime_types";
const SETTING_BLOCKED_EXT = "file.blocked_extensions";
const BYTES_PER_MB = 1024 * 1024;
const DEFAULT_MAX_UPLOAD_MB = 25; // mirror setting-defaults.ts — only used if resolve returns non-number.

/**
 * TODO(S2-FND-JOBS-1) — TEMP_FILE_CLEANUP: file register ở trạng thái 'Pending' mà client KHÔNG bao giờ
 * PUT + confirm sẽ mồ côi (is_temporary/expires_at + index đã sẵn ở schema/files.ts). WO S2-FND-JOBS-1
 * (System Jobs khung) sở hữu job dọn dẹp (soft-delete + storage delete khi Pending quá TTL 'file.pending_
 * ttl_hours'). LANE NÀY KHÔNG tự chế job (tránh scheduler trùng) — chỉ để lại con trỏ. Không làm gì thêm ở đây.
 */

/**
 * S1-FND-FILE-1 — FileService (crown-jewel). Quản lý vòng đời metadata file: upload → getMetadata/list →
 * download → link/unlink → delete. MỌI data-access đi qua `db.withTenant(companyId)` (BẤT BIẾN #1, RLS+
 * FORCE ép ở DB là lớp cuối). FilePolicyService là CHỐT quyết định view/download/link/unlink/delete
 * (deny-by-default, fail-closed); upload gated bằng @RequirePermission('upload') ở controller.
 *
 * BẤT BIẾN:
 *  - #2.1 company_id mọi query qua withTenant; thiếu companyId/userId → FilePolicy deny-tenant (chặn
 *    TRƯỚC khi chạm storage/DB-write).
 *  - #2.2 file_access_logs APPEND-ONLY (FileAccessLogService); files/file_links SOFT-DELETE.
 *  - #2.3 KHÔNG trả storage_path/checksum/signed-url-dài-hạn ra DTO (toFileMetadataDto ở file-metadata.mapper.ts loại bỏ). KHÔNG tin
 *    MIME client mù quáng — validate `declaredMimeType` ∈ allowlist (system_settings) + server tự suy
 *    file_extension từ originalName ĐÃ sanitize; storage key SERVER-derive qua buildFileKey ({companyId}/
 *    files/{fileId}) — client KHÔNG cấp path (chống path-traversal).
 */
@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly fileRepo: FileRepository,
    private readonly linkRepo: FileLinkRepository,
    private readonly accessLog: FileAccessLogService,
    private readonly audit: AuditService,
    private readonly policy: FilePolicyService,
    private readonly settings: SettingService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  // ─── Upload ────────────────────────────────────────────────────────────────

  /**
   * S2-FND-FILE-2 — Đăng ký metadata (upload_status='Pending') + cấp PRESIGNED-PUT `uploadUrl` để client
   * PUT bytes trực tiếp lên storage (2-pha: register → PUT → confirm). Gate `upload:foundation-file` ép ở
   * controller (PermissionGuard). Validate Ở TẦNG SERVICE từ system_settings (KHÔNG tin Content-Type/tên
   * client): MIME ∈ allowlist · size ≤ trần · extension NGOÀI blocklist · extension↔MIME nhất quán (chống
   * spoof). Sai → 4xx + FOUNDATION-FILE-ERR-* + KHÔNG ghi row/không audit. Hợp lệ → sanitize tên chống
   * path-traversal → server suy extension + storage key qua buildFileKey → ghi files + audit 'file'/
   * FileUploaded + file_access_log Upload + presign PUT — CÙNG tx withTenant (presign lỗi ⇒ rollback nguyên
   * khối, không để row Pending mồ côi). Response KHÔNG chứa storage_path (BẤT BIẾN #2.3).
   * Thêm 2 lưới CỨNG không setting nào mở được (kiểu + đuôi — file-content-guard.ts); trần của tầng ký ⇒ 415/413.
   */
  async upload(user: RequestUser, input: UploadFileInput): Promise<RegisterFileResponse> {
    // 0. Kiểu bị từ chối CỨNG — xét TRƯỚC khi đọc cấu hình công ty (allowlist có mở cũng không qua).
    if (registerContentRejection(input.declaredMimeType, null) === "active-mime") {
      throw this.mimeRejected(input.declaredMimeType);
    }

    // 1. Validate MIME ∈ allowlist + size ≤ ceiling (TẦNG SERVICE, từ settings). Sai → 4xx, KHÔNG ghi.
    const { allowedMime, maxBytes, blockedExtensions } = await this.loadUploadLimits(
      user.companyId,
    );
    if (!allowedMime.has(input.declaredMimeType)) {
      // FOUNDATION-FILE-ERR-MIME: MIME ngoài allowlist (server không tin Content-Type client).
      throw this.mimeRejected(input.declaredMimeType);
    }
    if (input.sizeBytes > maxBytes) {
      // FOUNDATION-FILE-ERR-SIZE: vượt trần dung lượng.
      throw new PayloadTooLargeException({
        code: FOUNDATION_FILE_ERROR_CODES.SIZE,
        message: `${FOUNDATION_FILE_ERROR_CODES.SIZE}: file vượt giới hạn ${maxBytes} bytes.`,
      });
    }

    // 2. Sanitize originalName (chống path-traversal).
    const safeName = this.sanitizeFilename(input.originalName);

    // 2b. Đuôi của tên sẽ phát ra khi tải về: phải đúng dạng, rồi mới so MỌI dạng tên với setting
    //     file.blocked_extensions HỢP tập chặn CỨNG trong code (file-content-guard.ts). Reject TRƯỚC khi ghi.
    const { fileExtension, malformedExtension, blockedExtension } = resolveRegisterExtension(
      safeName,
      blockedExtensions,
    );
    if (malformedExtension) {
      throw new UnsupportedMediaTypeException({
        code: FOUNDATION_FILE_ERROR_CODES.EXTENSION,
        message: `${FOUNDATION_FILE_ERROR_CODES.EXTENSION}: ${MALFORMED_EXTENSION_MESSAGE}`,
      });
    }
    if (blockedExtension !== null) {
      throw new UnsupportedMediaTypeException({
        code: FOUNDATION_FILE_ERROR_CODES.BLOCKED,
        message: `${FOUNDATION_FILE_ERROR_CODES.BLOCKED}: phần mở rộng bị chặn: .${blockedExtension}`,
      });
    }

    // 2c. extension↔MIME nhất quán (chống MIME-spoof: report.pdf khai image/png, x.html khai application/pdf).
    if (!isExtensionConsistentWithMime(fileExtension, input.declaredMimeType)) {
      throw new UnsupportedMediaTypeException({
        code: FOUNDATION_FILE_ERROR_CODES.EXTENSION,
        message: `${FOUNDATION_FILE_ERROR_CODES.EXTENSION}: phần mở rộng không khớp MIME khai báo (${input.declaredMimeType}).`,
      });
    }

    // 3. Server-derive storage key {companyId}/files/{fileId} — client KHÔNG cấp path.
    const fileId = randomUUID();
    const storageKey = this.buildKeyOrThrow(user.companyId, fileId, safeName);

    const moduleCode = input.moduleCode ?? FOUNDATION_FILE_MODULE;
    const entityType = input.entityType ?? FOUNDATION_FILE_ENTITY;
    const entityId = input.entityId;

    return this.db.withTenant(user.companyId, async (tx) => {
      const newRow: NewFileRecord = {
        id: fileId,
        companyId: user.companyId,
        originalName: safeName,
        storedName: fileId,
        fileExtension,
        mimeType: input.declaredMimeType,
        fileSizeBytes: input.sizeBytes,
        storageProvider: "MinIO",
        storagePath: storageKey,
        visibility: input.visibility, // default Private (zod default)
        uploadStatus: "Pending",
        scanStatus: "NotRequired",
        ownerUserId: user.id,
        uploadedBy: user.id,
      };
      const created = await this.fileRepo.insertTx(newRow, tx);

      // Audit 'file' / FileUploaded — masker che storage_path nếu lọt vào after (BẤT BIẾN #2.3). after chỉ
      // chứa metadata không nhạy cảm; storage_path CỐ Ý KHÔNG đưa vào.
      await this.audit.record(tx, {
        action: "FileUploaded",
        objectType: "file",
        objectId: created.id,
        actorUserId: user.id,
        actorType: "User",
        moduleCode,
        entityType,
        entityId,
        resultStatus: "Success",
        dataScope: "Company",
        after: {
          originalName: created.originalName,
          mimeType: created.mimeType,
          fileSizeBytes: created.fileSizeBytes,
          visibility: created.visibility,
          uploadStatus: created.uploadStatus,
        },
      });

      await this.accessLog.record(tx, {
        fileId: created.id,
        action: "Upload",
        accessGranted: true,
        actorUserId: user.id,
        moduleCode,
        entityType,
        entityId,
        permissionCode: "FOUNDATION.FILE.UPLOAD",
      });

      // Presign PUT SAU khi ghi metadata (bên trong tx: presign lỗi ⇒ rollback insert/audit/log). Key
      // server-derived, adapter re-assert prefix tenant + clamp TTL; URL ephemeral (KHÔNG persist — #2.3).
      const signed = await this.signUploadOrReject(created);

      return {
        fileId: created.id,
        uploadStatus: created.uploadStatus as RegisterFileResponse["uploadStatus"],
        uploadUrl: signed.url,
        expiresAt: signed.expiresAt.toISOString(),
      };
    });
  }

  /** 415 FOUNDATION-FILE-ERR-MIME — chung cho lưới cứng, allowlist công ty và trần kiểu của tầng ký. */
  private mimeRejected(declaredMimeType: string): UnsupportedMediaTypeException {
    return new UnsupportedMediaTypeException({
      code: FOUNDATION_FILE_ERROR_CODES.MIME,
      message: `${FOUNDATION_FILE_ERROR_CODES.MIME}: MIME không được phép: ${declaredMimeType}`,
    });
  }

  /** Ký PUT cho hàng vừa ghi. Trần cứng của tầng ký ⇒ 415/413; lỗi khác ném lại nguyên. LUÔN ném ⇒ tx rollback hàng. */
  private async signUploadOrReject(row: FileRecord): ReturnType<StorageAdapter["signedUrl"]> {
    const { storagePath: key, mimeType: contentType, fileSizeBytes: sizeBytes } = row;
    try {
      return await this.storage.signedUrl({ key, contentType, sizeBytes });
    } catch (err) {
      if (!(err instanceof UnsupportedAttachmentError)) throw err;
      // 4xx dưới đây trùng thông điệp với allowlist công ty ⇒ để lại dấu vết riêng cho nguyên nhân này.
      this.logger.warn(describeSignRejection(row.companyId, contentType, err));
      if (err.kind === "content-type") throw this.mimeRejected(contentType);
      throw new PayloadTooLargeException({
        code: FOUNDATION_FILE_ERROR_CODES.SIZE,
        message: `${FOUNDATION_FILE_ERROR_CODES.SIZE}: kích thước file ngoài giới hạn của tầng lưu trữ.`,
      });
    }
  }

  // ─── Confirm (S2-FND-FILE-2) ───────────────────────────────────────────────────

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
    const row = await this.db.withTenant(user.companyId, (tx) =>
      this.fileRepo.findByIdTx(user.companyId, fileId, tx),
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
    const stat = await this.storage.stat({ key: row.storagePath, companyId: user.companyId });
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
      this.logger.warn(typeFailure.logLine);
      await this.failConfirm(user, row, typeFailure.reason);
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.CONFIRM_MISMATCH,
        message: `${FOUNDATION_FILE_ERROR_CODES.CONFIRM_MISMATCH}: ${typeFailure.message}`,
      });
    }

    // Đọc bytes + tính checksum server-side (KHÔNG tin client). NOT dùng cho download (chỉ checksum).
    const bytes = await this.storage.getBytes({ key: row.storagePath, companyId: user.companyId });
    const checksum = createHash("sha256").update(bytes).digest("hex");

    return this.db.withTenant(user.companyId, async (tx) => {
      const affected = await this.fileRepo.markUploadedTx(
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
      await this.audit.record(tx, {
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

      await this.accessLog.record(tx, {
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
    await this.db.withTenant(user.companyId, async (tx) => {
      const affected = await this.fileRepo.markFailedTx(user.companyId, row.id, reason, tx);
      if (affected === 0) return;
      await this.audit.record(tx, {
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
      await this.accessLog.record(tx, {
        fileId: row.id,
        action: "Upload",
        accessGranted: false,
        actorUserId: user.id,
        deniedReason: reason,
        permissionCode: "FOUNDATION.FILE.UPLOAD",
      });
    });
  }

  // ─── Read (metadata) ──────────────────────────────────────────────────

  /**
   * Trả FileMetadataDto (KHÔNG storage_path) cho 1 file. FilePolicy.canView TRƯỚC (deny → 403 + log
   * Preview access_granted=false). Row 0 (RLS/cross-tenant/không tồn tại) → 404 (tránh oracle).
   */
  async getMetadata(user: RequestUser, fileId: string): Promise<FileMetadataDto> {
    // Hàng + liên kết trong MỘT ảnh chụp, rồi vị từ XEM chung (file-access-decision.ts) ngoài tx.
    const { row, ctx } = await this.loadFileAccessContext(user, fileId);
    if (!row) throw new NotFoundException("File không tồn tại");
    const decision = await decideFileAccess(this.policy, user, row, ctx, FilePolicyAction.View);
    if (!decision.allow) {
      await this.logDeny(user, {
        fileId,
        action: "Preview",
        permissionCode: "FOUNDATION.FILE.VIEW",
        reason: decision.reason,
      });
      throw fileForbidden(decision.reason);
    }

    return toFileMetadataDto(row, ctx.live);
  }

  // ─── Download ─────────────────────────────────────────────────────────────────

  /**
   * Cấp URL tải có TTL NGẮN (signed-url). FilePolicy.canDownload TRƯỚC — DENY → 403 + log Download
   * access_granted=false (KHÔNG lộ binary/url). ALLOW → STORAGE_ADAPTER.get presign + log Download
   * access_granted=true. Storage chỉ presign (KHÔNG stream byte) ⇒ "download-qua-backend" = policy-gate
   * rồi trả signed-url TTL-ngắn (quyết định: tránh proxy byte qua API process, ép TTL ngắn ở adapter).
   */
  async getDownloadUrl(user: RequestUser, fileId: string): Promise<DownloadUrlDto> {
    // S2-FND-BE-4 (H1) link-aware + vế chủ tệp chưa từng gắn — cùng vị từ với GET /:id (file-access-decision.ts).
    const { row, ctx } = await this.loadFileAccessContext(user, fileId);
    if (!row) throw new NotFoundException("File không tồn tại");
    const action = FilePolicyAction.Download;
    const decision = await decideFileAccess(this.policy, user, row, ctx, action);
    if (!decision.allow) {
      await this.logDeny(user, {
        fileId,
        action: "Download",
        permissionCode: "FOUNDATION.FILE.DOWNLOAD",
        reason: decision.reason,
      });
      throw fileForbidden(decision.reason);
    }

    // S2-FND-BE-4 (H2): state-guard AFTER authz ALLOW (so we don't leak state to a user without access).
    // A file that is not fully Uploaded, or is Infected, must NEVER be presigned — write a deny access-log
    // BEFORE storage.get, then 409. (View metadata is intentionally NOT restricted — see getMetadata.)
    const stateDeny = this.downloadStateDenyReason(row);
    if (stateDeny) {
      await this.logDeny(user, {
        fileId,
        action: "Download",
        // Parametrized from the action map (single source of truth) — not a scattered literal.
        permissionCode: this.foundationPermissionCode(FilePolicyAction.Download),
        reason: stateDeny,
      });
      throw new ConflictException({
        code: FOUNDATION_FILE_ERROR_CODES.NOT_DOWNLOADABLE,
        message: `${FOUNDATION_FILE_ERROR_CODES.NOT_DOWNLOADABLE}: ${stateDeny}`,
      });
    }

    // Presign sau khi ALLOW + state-guard. Key đã thuộc tenant (server-derived); adapter re-assert prefix (#2.1).
    // Kiểu trả + tên tải xuống lấy từ HÀNG đã đăng ký (không từ object đang lưu) — tầng ký quyết định.
    const signed = await this.storage.get({
      key: row.storagePath,
      companyId: user.companyId,
      registeredMimeType: row.mimeType,
      fileName: row.originalName,
    });

    await this.db.withTenant(user.companyId, (tx) =>
      this.accessLog.record(tx, {
        fileId,
        action: "Download",
        accessGranted: true,
        actorUserId: user.id,
        permissionCode: "FOUNDATION.FILE.DOWNLOAD",
      }),
    );

    // S2-FND-FILE-2 — thống kê tải BEST-EFFORT: tăng download_count + last_accessed_at. Lỗi cập nhật counter
    // KHÔNG được làm hỏng luồng download (URL đã cấp + đã log). Nuốt-CÓ-LOG (warn), KHÔNG rethrow, KHÔNG catch rỗng.
    await this.bumpDownloadCount(user, fileId);

    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  /**
   * Tăng download_count + set last_accessed_at (best-effort). Chạy trong tx tenant RIÊNG (đã ngoài luồng
   * cấp-URL). Lỗi → log warn + nuốt (download vẫn thành công); KHÔNG catch rỗng (silent-failure-hunter).
   */
  private async bumpDownloadCount(user: RequestUser, fileId: string): Promise<void> {
    try {
      await this.db.withTenant(user.companyId, (tx) =>
        this.fileRepo.incrementDownloadCountTx(user.companyId, fileId, tx),
      );
    } catch (err) {
      this.logger.warn(
        `download_count bump failed for file ${fileId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ─── Link / Unlink ────────────────────────────────────────────────────────────

  /**
   * Gắn file vào entity nghiệp vụ. Mọi kiểm ở `preflightLink` (không ghi) chạy TRƯỚC, ngoài tx; tx ghi khoá hàng
   * tệp rồi đọc lại ảnh chụp liên kết (lệch ⇒ 409), tạo file_links + audit 'file_link'/FileLinked + log Link.
   *
   * LƯU Ý: entityId là tham chiếu POLYMORPHIC — KHÔNG validate entity tồn tại ở đây (không FK); resolver đích
   * (`canLink`) quyết định quyền trên thực thể. Cô lập tenant: company_id NOT NULL + RLS+FORCE (mig 0433).
   */
  async link(user: RequestUser, input: LinkFileInput): Promise<FileLinkDto> {
    const decided = await this.checkLink(user, input);

    return this.db.withTenant(user.companyId, async (tx) => {
      const file = await this.fileRepo.findByIdForUpdateTx(user.companyId, input.fileId, tx);
      if (!file) throw linkFileMissing();
      assertLinkableFile(file);
      assertSameLinkSnapshot(
        decided,
        await this.readLinkContextTx(user.companyId, input.fileId, tx),
      );

      const created = await this.insertLinkOrThrow(
        {
          companyId: user.companyId,
          fileId: input.fileId,
          moduleCode: input.moduleCode,
          entityType: input.entityType,
          entityId: input.entityId,
          linkType: input.linkType,
          accessScope: input.accessScope,
          isPrimary: input.isPrimary,
          purpose: input.purpose ?? null,
          createdBy: user.id,
        },
        tx,
      );

      await this.recordLinkedTx(tx, user, input, created);
      return toLinkDto(created);
    });
  }

  /** Audit 'file_link'/FileLinked + log Link của liên kết vừa tạo — trong tx ghi của `link()`. */
  private async recordLinkedTx(
    tx: TenantTx,
    user: RequestUser,
    input: LinkFileInput,
    created: FileLink,
  ): Promise<void> {
    const target = {
      moduleCode: input.moduleCode,
      entityType: input.entityType,
      entityId: input.entityId,
    };
    await this.audit.record(tx, {
      action: "FileLinked",
      objectType: "file_link",
      objectId: created.id,
      actorUserId: user.id,
      actorType: "User",
      ...target,
      resultStatus: "Success",
      dataScope: "Company",
      after: {
        fileId: created.fileId,
        linkType: created.linkType,
        accessScope: created.accessScope,
        isPrimary: created.isPrimary,
      },
    });
    await this.accessLog.record(tx, {
      fileId: input.fileId,
      action: "Link",
      accessGranted: true,
      actorUserId: user.id,
      fileLinkId: created.id,
      ...target,
      permissionCode: "FOUNDATION.FILE.LINK",
    });
  }

  /**
   * S19-SEC-FILELINKGATE-1 — mọi kiểm của `link()` mà KHÔNG ghi (ngoài dòng log từ chối). Module tự gỡ liên
   * kết cũ trước khi gắn (branding · ME avatar) gọi hàm này TRƯỚC khi gỡ, để lời gắn bị từ chối không làm
   * mất tài sản đang dùng. `link()` vẫn tự kiểm lại.
   */
  async preflightLink(user: RequestUser, input: LinkFileInput): Promise<void> {
    await this.checkLink(user, input);
  }

  /**
   * Thứ tự: (1) cặp đích đã đăng ký + chính tắc (400) → (2) `canLink` trên thực thể đích (403) → (3) hàng + liên
   * kết một ảnh chụp (tệp vắng 400) → (4) `decideLinkAccess`: XEM như GET /:id, vế dự phòng thêm TẢI —
   * NGOÀI tx (resolver tự mở `withTenant`) (403) → (5) trạng thái tệp (400), sau cổng xem như đường tải.
   * Trả ảnh chụp đã dùng để tx ghi so lại.
   */
  private async checkLink(user: RequestUser, input: LinkFileInput): Promise<FileAccessContext> {
    await assertRegisteredLinkTarget(this.policy, input, () =>
      this.logLinkDeny(user, input, "FOUNDATION.FILE.LINK", "deny-no-resolver"),
    );
    const target = await this.policy.canLink(
      filePolicyInput(user, { ...input, action: FilePolicyAction.Link }),
    );
    if (!target.allow) {
      await this.logLinkDeny(user, input, "FOUNDATION.FILE.LINK", target.reason);
      throw fileForbidden(target.reason);
    }

    const { row, ctx } = await this.loadFileAccessContext(user, input.fileId);
    if (!row) throw linkFileMissing();
    const view = await decideLinkAccess(this.policy, user, row, ctx);
    if (!view.allow) {
      await this.logLinkDeny(user, input, this.foundationPermissionCode(view.action), view.reason);
      throw fileForbidden(view.reason);
    }
    assertLinkableFile(row);
    return ctx;
  }

  private logLinkDeny(
    user: RequestUser,
    input: LinkFileInput,
    permissionCode: string,
    reason: string,
  ): Promise<void> {
    const { fileId, moduleCode, entityType, entityId } = input;
    return this.logDeny(user, {
      fileId,
      action: "Link",
      permissionCode,
      reason,
      moduleCode,
      entityType,
      entityId,
      unverifiedFileId: true,
    });
  }

  /**
   * Gỡ link (soft-delete file_links — row CÒN, BẤT BIẾN #2). FilePolicy.canUnlink TRƯỚC. audit
   * 'file_link'/FileUnlinked + log Unlink — cùng tx. Row 0 → 404.
   */
  async unlink(user: RequestUser, linkId: string): Promise<void> {
    const existing = await this.db.withTenant(user.companyId, (tx) =>
      this.linkRepo.findByIdTx(user.companyId, linkId, tx),
    );
    if (!existing) throw new NotFoundException("File link không tồn tại");

    const decision = await this.policy.canUnlink(
      filePolicyInput(user, {
        fileId: existing.fileId,
        moduleCode: existing.moduleCode,
        entityType: existing.entityType,
        entityId: existing.entityId,
        action: FilePolicyAction.Unlink,
      }),
    );
    if (!decision.allow) {
      await this.logDeny(user, {
        fileId: existing.fileId,
        action: "Unlink",
        permissionCode: "FOUNDATION.FILE.UNLINK",
        reason: decision.reason,
        moduleCode: existing.moduleCode,
        entityType: existing.entityType,
        entityId: existing.entityId,
        fileLinkId: linkId,
      });
      throw new ForbiddenException({
        code: FOUNDATION_FILE_ERROR_CODES.FORBIDDEN,
        message: `${FOUNDATION_FILE_ERROR_CODES.FORBIDDEN}: ${decision.reason}`,
      });
    }

    await this.db.withTenant(user.companyId, async (tx) => {
      const affected = await this.linkRepo.softDeleteTx(user.companyId, linkId, user.id, tx);
      if (affected === 0) throw new NotFoundException("File link không tồn tại");

      await this.audit.record(tx, {
        action: "FileUnlinked",
        objectType: "file_link",
        objectId: linkId,
        actorUserId: user.id,
        actorType: "User",
        moduleCode: existing.moduleCode,
        entityType: existing.entityType,
        entityId: existing.entityId,
        resultStatus: "Success",
        dataScope: "Company",
        before: {
          fileId: existing.fileId,
          linkType: existing.linkType,
          accessScope: existing.accessScope,
        },
      });

      await this.accessLog.record(tx, {
        fileId: existing.fileId,
        action: "Unlink",
        accessGranted: true,
        actorUserId: user.id,
        fileLinkId: linkId,
        moduleCode: existing.moduleCode,
        entityType: existing.entityType,
        entityId: existing.entityId,
        permissionCode: "FOUNDATION.FILE.UNLINK",
      });
    });
  }

  // ─── Delete ────────────────────────────────────────────────────────────────────

  /**
   * Soft-delete file (deleted_at/deleted_by + upload_status='Deleted' — BẤT BIẾN #2, KHÔNG hard-delete).
   * FilePolicy.canDelete TRƯỚC (deny → 403 + log Delete access_granted=false). audit 'file'/FileDeleted
   * + log Delete — cùng tx. Row 0 → 404.
   */
  async deleteFile(user: RequestUser, fileId: string): Promise<void> {
    const row = await this.db.withTenant(user.companyId, (tx) =>
      this.fileRepo.findByIdTx(user.companyId, fileId, tx),
    );
    if (!row) throw new NotFoundException("File không tồn tại");

    // S2-FND-BE-4 (H1): deleting a module-owned file is also link-aware (fail-closed no-resolver). A
    // module-owned file cannot be deleted through the foundation surface until its module registers a
    // resolver — orphaned-file cleanup is the owning module's responsibility (S2-FND-BE-5+).
    const { links, everLinked } = await this.loadLinkContext(user, fileId);
    const decision = await this.policy.decideForLinkedFile(
      fileSelfPolicyInput(user, fileId, FilePolicyAction.Delete),
      links.map((l) => toFileLinkRef(l)),
      FilePolicyAction.Delete,
      everLinked,
    );
    if (!decision.allow) {
      await this.logDeny(user, {
        fileId,
        action: "Delete",
        permissionCode: "FOUNDATION.FILE.DELETE",
        reason: decision.reason,
      });
      throw new ForbiddenException({
        code: FOUNDATION_FILE_ERROR_CODES.FORBIDDEN,
        message: `${FOUNDATION_FILE_ERROR_CODES.FORBIDDEN}: ${decision.reason}`,
      });
    }

    await this.db.withTenant(user.companyId, async (tx) => {
      const affected = await this.fileRepo.softDeleteTx(user.companyId, fileId, user.id, tx);
      if (affected === 0) throw new NotFoundException("File không tồn tại");

      await this.audit.record(tx, {
        action: "FileDeleted",
        objectType: "file",
        objectId: fileId,
        actorUserId: user.id,
        actorType: "User",
        resultStatus: "Success",
        dataScope: "Company",
        before: {
          originalName: row.originalName,
          mimeType: row.mimeType,
          visibility: row.visibility,
        },
      });

      await this.accessLog.record(tx, {
        fileId,
        action: "Delete",
        accessGranted: true,
        actorUserId: user.id,
        permissionCode: "FOUNDATION.FILE.DELETE",
      });
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────────

  /** Insert `file_links`; 23505 ⇒ 409 phân biệt theo constraint (`rethrowLinkInsertError`), lỗi khác ném nguyên. */
  private async insertLinkOrThrow(data: NewFileLink, tx: TenantTx): Promise<FileLink> {
    try {
      return await this.linkRepo.insertTx(data, tx);
    } catch (err) {
      rethrowLinkInsertError(err);
    }
  }

  /**
   * Sanitize originalName chống path-traversal: bỏ NUL + ASCII control chars, lấy basename (phần sau dấu
   * phân tách cuối '/' hoặc '\\'), từ chối tên rút gọn về '.'/'..'/rỗng. Trả tên an toàn để LƯU METADATA
   * (KHÔNG dùng cho key — key luôn server-derive bằng fileId UUID, không bao giờ chứa tên này → mọi mưu
   * đồ path-traversal qua originalName là vô hại với storage_path).
   */
  private sanitizeFilename(name: string): string {
    // Bỏ NUL + ASCII control chars (0x00–0x1F, 0x7F) theo char-code (KHÔNG dùng control-char regex literal).
    let noControl = "";
    for (const ch of name) {
      const code = ch.charCodeAt(0);
      if (code <= 0x1f || code === 0x7f) continue;
      noControl += ch;
    }
    // Lấy basename: phần sau dấu phân tách cuối cùng ('/' hoặc '\\').
    const base = noControl.split(/[/\\]/).pop() ?? "";
    const trimmed = base.trim();
    if (trimmed === "" || trimmed === "." || trimmed === "..") {
      throw new BadRequestException({
        code: FOUNDATION_FILE_ERROR_CODES.FILENAME,
        message: `${FOUNDATION_FILE_ERROR_CODES.FILENAME}: tên file không hợp lệ sau khi chuẩn hoá.`,
      });
    }
    return trimmed.slice(0, 500);
  }

  /** Build key server-side; InvalidStorageKeyError → 400 (không lộ chi tiết). */
  private buildKeyOrThrow(companyId: string, fileId: string, originalName: string): string {
    try {
      return buildFileKey({ companyId, fileId, originalName });
    } catch (err) {
      if (err instanceof InvalidStorageKeyError) {
        throw new BadRequestException({
          code: FOUNDATION_FILE_ERROR_CODES.KEY,
          message: `${FOUNDATION_FILE_ERROR_CODES.KEY}: không thể tạo storage key hợp lệ.`,
        });
      }
      throw err;
    }
  }

  /**
   * Đọc giới hạn upload từ system_settings (precedence company > system > default qua SettingService —
   * S1-FND-SETTING-1). Nếu resolve trả kiểu rác → fallback default size; allowlist FAIL-CLOSED (thiếu
   * allowlist ⇒ Set rỗng ⇒ mọi MIME bị từ chối, KHÔNG fail-open).
   */
  private async loadUploadLimits(companyId: string): Promise<{
    allowedMime: Set<string>;
    maxBytes: number;
    blockedExtensions: Set<string>;
  }> {
    const resolved = await this.settings.resolveMany(companyId, [
      SETTING_ALLOWED_MIME,
      SETTING_MAX_UPLOAD_MB,
      SETTING_BLOCKED_EXT,
    ]);
    const byKey = new Map(resolved.map((r) => [r.key, r.value]));

    const mimeValue = byKey.get(SETTING_ALLOWED_MIME);
    const allowedMime = new Set<string>(
      Array.isArray(mimeValue)
        ? (mimeValue as unknown[]).filter((v): v is string => typeof v === "string")
        : [],
    );

    const sizeValue = byKey.get(SETTING_MAX_UPLOAD_MB);
    const maxMb =
      typeof sizeValue === "number" && sizeValue > 0 ? sizeValue : DEFAULT_MAX_UPLOAD_MB;

    // blocked_extensions normalize về lowercase, không dấu chấm (khớp resolveRegisterExtension). Thiếu setting →
    // Set rỗng (không chặn theo extension; MIME-allowlist + extension↔MIME vẫn là hàng rào).
    const blockedValue = byKey.get(SETTING_BLOCKED_EXT);
    const blockedExtensions = new Set<string>(
      Array.isArray(blockedValue)
        ? (blockedValue as unknown[])
            .filter((v): v is string => typeof v === "string")
            .map((v) => v.replace(/^\./, "").toLowerCase())
        : [],
    );

    return { allowedMime, maxBytes: maxMb * BYTES_PER_MB, blockedExtensions };
  }

  /**
   * S7-FND-LINKFALLBACK-1 — nạp NGỮ CẢNH LINK cho một quyết định FilePolicy: link SỐNG + cờ "đã từng có
   * link module".
   *
   * Hai truy vấn trong CÙNG một `withTenant` (không phải hai lần mở tx): chúng phải nhìn CÙNG một ảnh
   * chụp. Tách ra hai tx thì có cửa sổ mà link cuối bị gỡ ở giữa ⇒ `links` rỗng nhưng `everLinked` đọc
   * trước khi gỡ trả `false` ⇒ rơi xuống fallback FOUNDATION.FILE.* đúng lúc vừa bị thu hồi.
   *
   * Gom về `readLinkContextTx` cho mọi đường (xem · tải · xoá · gắn, kể cả lần đọc lại trong tx ghi của gắn)
   * để không đường nào lỡ quên cờ — bất biến chốt ở method dùng chung, không rải theo route.
   */
  private async loadLinkContext(
    user: RequestUser,
    fileId: string,
  ): Promise<{ links: FileLink[]; everLinked: boolean }> {
    const { live, everLinked } = await this.db.withTenant(user.companyId, (tx) =>
      this.readLinkContextTx(user.companyId, fileId, tx),
    );
    return { links: live, everLinked };
  }

  /** Hàng tệp + ngữ cảnh liên kết trong MỘT `withTenant` (một ảnh chụp) — GET /:id · tải · gắn. */
  private async loadFileAccessContext(
    user: RequestUser,
    fileId: string,
  ): Promise<{ row: FileRecord | undefined; ctx: FileAccessContext }> {
    return this.db.withTenant(user.companyId, async (tx) => ({
      row: await this.fileRepo.findByIdTx(user.companyId, fileId, tx),
      ctx: await this.readLinkContextTx(user.companyId, fileId, tx),
    }));
  }

  private async readLinkContextTx(
    companyId: string,
    fileId: string,
    tx: TenantTx,
  ): Promise<FileAccessContext & { live: FileLink[] }> {
    return {
      live: await this.linkRepo.listByFileTx(companyId, fileId, tx),
      everLinked: await this.linkRepo.hasEverBeenLinkedTx(companyId, fileId, tx),
    };
  }

  /**
   * S2-FND-BE-4 (H2) — return the deny reason if a file must NOT be presigned for download, else null.
   *
   * S7-CHAT-BE-3: thân luật chuyển sang hàm thuần `fileDownloadStateDenyReason` (file-download-state.ts)
   * để CHAT ký đính kèm bằng ĐÚNG luật này thay vì chép sang một bản sao sẽ trôi. Method giữ lại nguyên
   * chữ ký + hành vi — đây là uỷ quyền, KHÔNG phải đổi hành vi.
   */
  private downloadStateDenyReason(row: FileRecord): FileDownloadDenyReason | null {
    return fileDownloadStateDenyReason(row);
  }

  /**
   * The MODULE.RESOURCE.ACTION permission code logged on a foundation-file access-log row for `action`,
   * derived from the FOUNDATION_FILE_PERMISSION action map (single source of truth) — e.g. Download →
   * "FOUNDATION.FILE.DOWNLOAD". Keeps the H2 state-guard deny-log parametrized, not a scattered literal
   * (CLAUDE.md §5; convention SPEC-01 §9).
   */
  private foundationPermissionCode(action: FilePolicyAction): string {
    return `FOUNDATION.FILE.${FOUNDATION_FILE_PERMISSION[action].action.toUpperCase()}`;
  }

  /** Ghi 1 dòng file_access_log DENY (access_granted=false + denied_reason) trong tx tenant RIÊNG. */
  private async logDeny(
    user: RequestUser,
    entry: {
      fileId: string;
      action: Parameters<FileAccessLogService["record"]>[1]["action"];
      permissionCode: string;
      reason: string;
      moduleCode?: string;
      entityType?: string;
      entityId?: string;
      fileLinkId?: string;
      /** `fileId` do client gửi, chưa nạp hàng: chỉ ghi khi hàng có trong tenant (FK của log kiểm vượt RLS). */
      unverifiedFileId?: boolean;
    },
  ): Promise<void> {
    await this.db.withTenant(user.companyId, async (tx) => {
      if (
        entry.unverifiedFileId &&
        !(await this.fileRepo.findByIdTx(user.companyId, entry.fileId, tx))
      ) {
        return;
      }
      await this.accessLog.record(tx, {
        fileId: entry.fileId,
        action: entry.action,
        accessGranted: false,
        actorUserId: user.id,
        deniedReason: entry.reason,
        permissionCode: entry.permissionCode,
        moduleCode: entry.moduleCode,
        entityType: entry.entityType,
        entityId: entry.entityId,
        fileLinkId: entry.fileLinkId,
      });
    });
  }
}
