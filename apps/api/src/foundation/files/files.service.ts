import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
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
import type { FileLink, FileRecord, NewFileLink, NewFileRecord } from "../../db/schema/files";
import { SettingService } from "../settings/setting.service";
import { FileAccessLogService } from "./file-access-log.service";
import {
  MALFORMED_EXTENSION_MESSAGE,
  registerContentRejection,
  resolveRegisterExtension,
} from "./file-content-guard";
import { FileConfirmFlow } from "./file-confirm-flow";
import { logFileDeny, type FileDenyLogEntry } from "./file-deny-log";
import {
  buildKeyOrThrow,
  loadUploadLimits,
  mimeRejected,
  newFileId,
  sanitizeFilename,
  signUploadOrReject,
} from "./file-upload-support";
import { fileDownloadStateDenyReason, type FileDownloadDenyReason } from "./file-download-state";
import { FileLinkRepository } from "./file-link.repository";
import { FilePolicyService } from "./file-policy.service";
import { FileRepository } from "./file.repository";
import { isExtensionConsistentWithMime } from "./mime-extension";
import { toFileMetadataDto, toLinkDto } from "./file-metadata.mapper";
import { decideFileAccess, type FileAccessContext } from "./file-access-decision";
import { readFileAccessContextTx, readLinkContextTx } from "./file-link-context";
import {
  assertRegisteredLinkTarget,
  fileForbidden,
  linkFileMissing,
  rethrowLinkInsertError,
  unlinkableFileError,
} from "./file-link-guard";
import {
  decideLinkerViewFromSnapshot,
  recheckLinkerSnapshotTx,
  type LinkerLogTarget,
  type LinkerRecheckOutcome,
  type LinkerViewOutcome,
} from "./file-linker-view";
import { FilePolicyAction, FOUNDATION_FILE_PERMISSION } from "./file-policy.types";
import {
  FOUNDATION_FILE_ENTITY,
  FOUNDATION_FILE_MODULE,
  filePolicyInput,
  fileSelfPolicyInput,
  toFileLinkRef,
  type FileDecisionActor,
} from "./file-view-decision";

/** Acting user resolved from the authenticated request (JwtAuthGuard + CompanyGuard). */
interface RequestUser {
  id: string;
  companyId: string;
}

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
  private readonly confirmFlow: FileConfirmFlow;

  constructor(
    private readonly db: DatabaseService,
    private readonly fileRepo: FileRepository,
    private readonly linkRepo: FileLinkRepository,
    private readonly accessLog: FileAccessLogService,
    private readonly audit: AuditService,
    private readonly policy: FilePolicyService,
    private readonly settings: SettingService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {
    this.confirmFlow = new FileConfirmFlow({
      db,
      fileRepo,
      accessLog,
      audit,
      storage,
      logger: this.logger,
    });
  }

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
      throw mimeRejected(input.declaredMimeType);
    }

    // 1. Validate MIME ∈ allowlist + size ≤ ceiling (TẦNG SERVICE, từ settings). Sai → 4xx, KHÔNG ghi.
    const { allowedMime, maxBytes, blockedExtensions } = await loadUploadLimits(
      this.settings,
      user.companyId,
    );
    if (!allowedMime.has(input.declaredMimeType)) {
      // FOUNDATION-FILE-ERR-MIME: MIME ngoài allowlist (server không tin Content-Type client).
      throw mimeRejected(input.declaredMimeType);
    }
    if (input.sizeBytes > maxBytes) {
      // FOUNDATION-FILE-ERR-SIZE: vượt trần dung lượng.
      throw new PayloadTooLargeException({
        code: FOUNDATION_FILE_ERROR_CODES.SIZE,
        message: `${FOUNDATION_FILE_ERROR_CODES.SIZE}: file vượt giới hạn ${maxBytes} bytes.`,
      });
    }

    // 2. Sanitize originalName (chống path-traversal).
    const safeName = sanitizeFilename(input.originalName);

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
    const fileId = newFileId();
    const storageKey = buildKeyOrThrow(user.companyId, fileId, safeName);

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
      const signed = await signUploadOrReject(this.storage, this.logger, created);

      return {
        fileId: created.id,
        uploadStatus: created.uploadStatus as RegisterFileResponse["uploadStatus"],
        uploadUrl: signed.url,
        expiresAt: signed.expiresAt.toISOString(),
      };
    });
  }

  // ─── Confirm (S2-FND-FILE-2) ───────────────────────────────────────────────────

  /** POST /foundation/files/:id/confirm — pha 3 của upload E2E; thân ở `file-confirm-flow.ts`. */
  confirmUpload(
    user: RequestUser,
    fileId: string,
    input: ConfirmUploadInput,
  ): Promise<ConfirmUploadResponse> {
    return this.confirmFlow.confirmUpload(user, fileId, input);
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
      const checked = await this.recheckLinkerViewTx(user.companyId, input.fileId, decided, tx);
      if (checked.kind === "missing") throw linkFileMissing();
      if (checked.kind === "unlinkable") throw unlinkableFileError(checked.row);

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
   * S19-SEC-FILELINKPATHS-1 — MỘT nguồn quyết định «người gắn xem được tệp» (cùng vị từ với GET /:id) cho mọi
   * đường tạo liên kết. Chỉ đọc, NGOÀI mọi tx ghi; trả giá trị để route giữ mã lỗi (`file-linker-view.ts`).
   */
  async decideLinkerView(actor: FileDecisionActor, fileId: string): Promise<LinkerViewOutcome> {
    const { row, ctx } = await this.loadFileAccessContext(actor, fileId);
    return decideLinkerViewFromSnapshot(this.policy, actor, row, ctx);
  }

  /** `decideLinkerView` + dòng log từ chối `Link` CHỈ khi `forbidden` (như biên gắn lõi). */
  async preflightLinkerView(
    actor: FileDecisionActor,
    fileId: string,
    logTarget: LinkerLogTarget,
  ): Promise<LinkerViewOutcome> {
    const outcome = await this.decideLinkerView(actor, fileId);
    if (outcome.kind === "forbidden") {
      const code = this.foundationPermissionCode(outcome.action);
      await this.logLinkDeny(actor, fileId, logTarget, code, outcome.reason);
    }
    return outcome;
  }

  /** Pha trong tx ghi của người gọi: khoá hàng tệp, trạng thái gắn được, so lại ảnh chụp (lệch ⇒ 409). */
  recheckLinkerViewTx(
    companyId: string,
    fileId: string,
    decided: FileAccessContext,
    tx: TenantTx,
  ): Promise<LinkerRecheckOutcome> {
    return recheckLinkerSnapshotTx(this.fileRepo, this.linkRepo, companyId, fileId, decided, tx);
  }

  /**
   * (1) cặp đích đã đăng ký + chính tắc (400) → (2) `canLink` trên thực thể đích (403) → (3)–(5) `preflightLinkerView`
   * (tệp vắng 400 · không xem được 403 · không gắn được 400). Trả ảnh chụp đã dùng để tx ghi so lại.
   */
  private async checkLink(user: RequestUser, input: LinkFileInput): Promise<FileAccessContext> {
    await assertRegisteredLinkTarget(this.policy, input, () =>
      this.logLinkDeny(user, input.fileId, input, "FOUNDATION.FILE.LINK", "deny-no-resolver"),
    );
    const target = await this.policy.canLink(
      filePolicyInput(user, { ...input, action: FilePolicyAction.Link }),
    );
    if (!target.allow) {
      await this.logLinkDeny(user, input.fileId, input, "FOUNDATION.FILE.LINK", target.reason);
      throw fileForbidden(target.reason);
    }

    const outcome = await this.preflightLinkerView(user, input.fileId, input);
    if (outcome.kind === "missing") throw linkFileMissing();
    if (outcome.kind === "forbidden") throw fileForbidden(outcome.reason);
    if (outcome.kind === "unlinkable") throw unlinkableFileError(outcome.row);
    return outcome.ctx;
  }

  private logLinkDeny(
    user: FileDecisionActor,
    fileId: string,
    { moduleCode, entityType, entityId }: LinkerLogTarget,
    permissionCode: string,
    reason: string,
  ): Promise<void> {
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

  private async loadLinkContext(
    user: RequestUser,
    fileId: string,
  ): Promise<{ links: FileLink[]; everLinked: boolean }> {
    const { live, everLinked } = await this.db.withTenant(user.companyId, (tx) =>
      readLinkContextTx(this.linkRepo, user.companyId, fileId, tx),
    );
    return { links: live, everLinked };
  }

  /** Ngữ cảnh liên kết (+ hàng tệp) trong MỘT `withTenant` = một ảnh chụp (`file-link-context.ts`). */
  private async loadFileAccessContext(actor: FileDecisionActor, fileId: string) {
    return this.db.withTenant(actor.companyId, (tx) =>
      readFileAccessContextTx(this.fileRepo, this.linkRepo, actor.companyId, fileId, tx),
    );
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

  /** Mã quyền MODULE.RESOURCE.ACTION của dòng access-log cho `action` — suy từ FOUNDATION_FILE_PERMISSION. */
  private foundationPermissionCode(action: FilePolicyAction): string {
    return `FOUNDATION.FILE.${FOUNDATION_FILE_PERMISSION[action].action.toUpperCase()}`;
  }

  /** Ghi 1 dòng file_access_log DENY (access_granted=false + denied_reason) trong tx tenant RIÊNG. */
  private logDeny(user: FileDecisionActor, entry: FileDenyLogEntry): Promise<void> {
    return logFileDeny(
      { db: this.db, fileRepo: this.fileRepo, accessLog: this.accessLog },
      user,
      entry,
    );
  }
}
