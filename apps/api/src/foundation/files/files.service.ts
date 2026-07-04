import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type {
  DownloadUrlDto,
  FileLinkDto,
  FileMetadataDto,
  LinkFileInput,
  ListFilesQuery,
  UploadFileInput,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../../db/db.service";
import { isUniqueViolation, pgErrorField } from "../../common/db-error";
import { FOUNDATION_FILE_ERROR_CODES } from "../../common/errors/error-codes";
import { AuditService } from "../../events/audit.service";
import { STORAGE_ADAPTER, type StorageAdapter } from "../../storage/storage-adapter.port";
import { buildFileKey, InvalidStorageKeyError } from "../../storage/file-storage-key";
import type { FileLink, FileRecord, NewFileLink, NewFileRecord } from "../../db/schema/files";
import { SettingService } from "../settings/setting.service";
import { FileAccessLogService } from "./file-access-log.service";
import { FileLinkRepository } from "./file-link.repository";
import { FilePolicyService } from "./file-policy.service";
import { FileRepository } from "./file.repository";
import {
  FilePolicyAction,
  FOUNDATION_FILE_PERMISSION,
  type FileLinkRef,
  type FilePermissionInput,
} from "./file-policy.types";

/** Acting user resolved from the authenticated request (JwtAuthGuard + CompanyGuard). */
interface RequestUser {
  id: string;
  companyId: string;
}

/** system_settings keys (precedence company > system > default via SettingService). */
const SETTING_MAX_UPLOAD_MB = "file.max_upload_size_mb";
const SETTING_ALLOWED_MIME = "file.allowed_mime_types";
const BYTES_PER_MB = 1024 * 1024;
const DEFAULT_MAX_UPLOAD_MB = 25; // mirror setting-defaults.ts — only used if resolve returns non-number.

/** Module/entity used when an upload is not linked to any business entity (foundation-owned file). */
const FOUNDATION_MODULE = "FOUNDATION";
const FOUNDATION_ENTITY = "File";

/**
 * Tên 2 constraint UNIQUE trên `file_links` mà `link()` phải PHÂN BIỆT khi bắt 23505 (S2-FND-DB-2-B) —
 * KHÔNG gộp chung 1 mã lỗi cho 2 nguyên nhân khác nhau:
 *  - `uq_file_links_entity_file_active` (6 cột: company_id, module_code, entity_type, entity_id, file_id,
 *    link_type — WHERE deleted_at IS NULL, mig 0472): file NÀY đã gắn vào ĐÚNG entity + link_type này rồi.
 *  - `uq_file_links_primary_per_entity_type` (5 cột is_primary=true, mig 0433): entity này ĐÃ có 1 file
 *    KHÁC primary cho cùng link_type — không thể có 2 primary song song.
 */
const UQ_FILE_LINKS_ENTITY_FILE_ACTIVE = "uq_file_links_entity_file_active";
const UQ_FILE_LINKS_PRIMARY_PER_ENTITY_TYPE = "uq_file_links_primary_per_entity_type";

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
 *  - #2.3 KHÔNG trả storage_path/checksum/signed-url-dài-hạn ra DTO (toMetadataDto loại bỏ). KHÔNG tin
 *    MIME client mù quáng — validate `declaredMimeType` ∈ allowlist (system_settings) + server tự suy
 *    file_extension từ originalName ĐÃ sanitize; storage key SERVER-derive qua buildFileKey ({companyId}/
 *    files/{fileId}) — client KHÔNG cấp path (chống path-traversal).
 */
@Injectable()
export class FileService {
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
   * Đăng ký metadata file (visibility=Private default, upload_status=Pending). Gate `upload:foundation-
   * file` đã ép ở controller (PermissionGuard). Validate size/MIME ở TẦNG SERVICE từ system_settings
   * (KHÔNG tin Content-Type client để VƯỢT allowlist) → sanitize originalName chống path-traversal →
   * server suy file_extension + storage key qua buildFileKey. Ghi files + audit 'file'/FileUploaded +
   * file_access_log Upload — CÙNG tx withTenant (rollback nguyên khối nếu audit/log lỗi).
   */
  async upload(user: RequestUser, input: UploadFileInput): Promise<FileMetadataDto> {
    // 1. Validate MIME ∈ allowlist + size ≤ ceiling (TẦNG SERVICE, từ settings). Sai → 4xx, KHÔNG ghi.
    const { allowedMime, maxBytes } = await this.loadUploadLimits(user.companyId);
    if (!allowedMime.has(input.declaredMimeType)) {
      // FOUNDATION-FILE-ERR-MIME: MIME ngoài allowlist (server không tin Content-Type client).
      throw new UnsupportedMediaTypeException(
        `FOUNDATION-FILE-ERR-MIME: MIME không được phép: ${input.declaredMimeType}`,
      );
    }
    if (input.sizeBytes > maxBytes) {
      // FOUNDATION-FILE-ERR-SIZE: vượt trần dung lượng.
      throw new PayloadTooLargeException(
        `FOUNDATION-FILE-ERR-SIZE: file vượt giới hạn ${maxBytes} bytes.`,
      );
    }

    // 2. Sanitize originalName (chống path-traversal) + suy extension server-side.
    const safeName = this.sanitizeFilename(input.originalName);
    const fileExtension = this.deriveExtension(safeName);

    // 3. Server-derive storage key {companyId}/files/{fileId} — client KHÔNG cấp path.
    const fileId = randomUUID();
    const storageKey = this.buildKeyOrThrow(user.companyId, fileId, safeName);

    const moduleCode = input.moduleCode ?? FOUNDATION_MODULE;
    const entityType = input.entityType ?? FOUNDATION_ENTITY;
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

      return this.toMetadataDto(created, []);
    });
  }

  // ─── Read (metadata / list) ──────────────────────────────────────────────────

  /**
   * Trả FileMetadataDto (KHÔNG storage_path) cho 1 file. FilePolicy.canView TRƯỚC (deny → 403 + log
   * Preview access_granted=false). Row 0 (RLS/cross-tenant/không tồn tại) → 404 (tránh oracle).
   */
  async getMetadata(user: RequestUser, fileId: string): Promise<FileMetadataDto> {
    const row = await this.db.withTenant(user.companyId, (tx) =>
      this.fileRepo.findByIdTx(user.companyId, fileId, tx),
    );
    if (!row) throw new NotFoundException("File không tồn tại");

    // S2-FND-BE-4 (H1): load links BEFORE the decision — a module-owned file must be authorized by its
    // owning module's resolver (link-aware), not the FOUNDATION.FILE.* fallback (deny-no-resolver otherwise).
    const links = await this.db.withTenant(user.companyId, (tx) =>
      this.linkRepo.listByFileTx(user.companyId, fileId, tx),
    );
    const decision = await this.policy.decideForLinkedFile(
      this.policyInputForFile(user, fileId, FilePolicyAction.View),
      links.map((l) => this.toLinkRef(l)),
      FilePolicyAction.View,
    );
    if (!decision.allow) {
      await this.logDeny(user, {
        fileId,
        action: "Preview",
        permissionCode: "FOUNDATION.FILE.VIEW",
        reason: decision.reason,
      });
      throw new ForbiddenException(`FOUNDATION-FILE-ERR-FORBIDDEN: ${decision.reason}`);
    }

    return this.toMetadataDto(row, links);
  }

  /**
   * Liệt kê metadata file của tenant (pagination). Gate `view:foundation-file` ép ở controller (list
   * cấp tenant — RLS là hàng rào thật). Trả {data, meta}. KHÔNG storage_path.
   */
  async list(
    user: RequestUser,
    query: ListFilesQuery,
  ): Promise<{ data: FileMetadataDto[]; meta: { total: number; page: number; limit: number } }> {
    const offset = (query.page - 1) * query.limit;
    return this.db.withTenant(user.companyId, async (tx) => {
      const [rows, total] = await Promise.all([
        this.fileRepo.listTx(
          user.companyId,
          { limit: query.limit, offset, visibility: query.visibility },
          tx,
        ),
        this.fileRepo.countTx(user.companyId, { visibility: query.visibility }, tx),
      ]);
      return {
        data: rows.map((r) => this.toMetadataDto(r, [])),
        meta: { total, page: query.page, limit: query.limit },
      };
    });
  }

  // ─── Download ─────────────────────────────────────────────────────────────────

  /**
   * Cấp URL tải có TTL NGẮN (signed-url). FilePolicy.canDownload TRƯỚC — DENY → 403 + log Download
   * access_granted=false (KHÔNG lộ binary/url). ALLOW → STORAGE_ADAPTER.get presign + log Download
   * access_granted=true. Storage chỉ presign (KHÔNG stream byte) ⇒ "download-qua-backend" = policy-gate
   * rồi trả signed-url TTL-ngắn (quyết định: tránh proxy byte qua API process, ép TTL ngắn ở adapter).
   */
  async getDownloadUrl(user: RequestUser, fileId: string): Promise<DownloadUrlDto> {
    const row = await this.db.withTenant(user.companyId, (tx) =>
      this.fileRepo.findByIdTx(user.companyId, fileId, tx),
    );
    if (!row) throw new NotFoundException("File không tồn tại");

    // S2-FND-BE-4 (H1): link-aware authorization — a module-owned file with no registered resolver is
    // fail-closed (deny-no-resolver); foundation-owned (0-link) keeps the FOUNDATION.FILE.* fallback.
    const links = await this.db.withTenant(user.companyId, (tx) =>
      this.linkRepo.listByFileTx(user.companyId, fileId, tx),
    );
    const decision = await this.policy.decideForLinkedFile(
      this.policyInputForFile(user, fileId, FilePolicyAction.Download),
      links.map((l) => this.toLinkRef(l)),
      FilePolicyAction.Download,
    );
    if (!decision.allow) {
      await this.logDeny(user, {
        fileId,
        action: "Download",
        permissionCode: "FOUNDATION.FILE.DOWNLOAD",
        reason: decision.reason,
      });
      throw new ForbiddenException(`FOUNDATION-FILE-ERR-FORBIDDEN: ${decision.reason}`);
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
      throw new ConflictException(`FOUNDATION-FILE-ERR-NOT-DOWNLOADABLE: ${stateDeny}`);
    }

    // Presign sau khi ALLOW + state-guard. Key đã thuộc tenant (server-derived); adapter re-assert prefix (#2.1).
    const signed = await this.storage.get({ key: row.storagePath, companyId: user.companyId });

    await this.db.withTenant(user.companyId, (tx) =>
      this.accessLog.record(tx, {
        fileId,
        action: "Download",
        accessGranted: true,
        actorUserId: user.id,
        permissionCode: "FOUNDATION.FILE.DOWNLOAD",
      }),
    );

    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  // ─── Link / Unlink ────────────────────────────────────────────────────────────

  /**
   * Gắn file vào entity nghiệp vụ. FilePolicy.canLink TRƯỚC. Validate FILE thuộc tenant (RLS lọc
   * cross-company → 0 row ⇒ reject 4xx) + file.scan_status != 'Infected' → vi phạm thì reject (4xx).
   * Tạo file_links (created_by) + audit 'file_link'/FileLinked + log Link — cùng tx.
   *
   * LƯU Ý: entityId là tham chiếu POLYMORPHIC (module_code/entity_type/entity_id) — WO này KHÔNG validate
   * entity tồn tại/thuộc tenant ở đây (không có FK tới bảng entity). Cô lập tenant của file_links đã được
   * ép bởi company_id NOT NULL + RLS+FORCE (mig 0433). Validate entity-existence để WO module-owner sau.
   */
  async link(user: RequestUser, input: LinkFileInput): Promise<FileLinkDto> {
    const decision = await this.policy.canLink(
      this.policyInput(user, {
        fileId: input.fileId,
        moduleCode: input.moduleCode,
        entityType: input.entityType,
        entityId: input.entityId,
        action: FilePolicyAction.Link,
      }),
    );
    if (!decision.allow) {
      await this.logDeny(user, {
        fileId: input.fileId,
        action: "Link",
        permissionCode: "FOUNDATION.FILE.LINK",
        reason: decision.reason,
        moduleCode: input.moduleCode,
        entityType: input.entityType,
        entityId: input.entityId,
      });
      throw new ForbiddenException(`FOUNDATION-FILE-ERR-FORBIDDEN: ${decision.reason}`);
    }

    return this.db.withTenant(user.companyId, async (tx) => {
      // File phải thuộc tenant (RLS lọc cross-company → 0 row) + chưa xoá.
      const file = await this.fileRepo.findByIdTx(user.companyId, input.fileId, tx);
      if (!file) {
        // FOUNDATION-FILE-ERR-LINK: file không thuộc tenant / không tồn tại (cross-company → RLS 0 row).
        throw new BadRequestException(
          "FOUNDATION-FILE-ERR-LINK: file không thuộc công ty hiện tại hoặc không tồn tại.",
        );
      }
      // Không cho link file nhiễm mã độc (QA-06).
      if (file.scanStatus === "Infected") {
        throw new BadRequestException(
          "FOUNDATION-FILE-ERR-INFECTED: không thể link file đang ở trạng thái Infected.",
        );
      }

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

      await this.audit.record(tx, {
        action: "FileLinked",
        objectType: "file_link",
        objectId: created.id,
        actorUserId: user.id,
        actorType: "User",
        moduleCode: input.moduleCode,
        entityType: input.entityType,
        entityId: input.entityId,
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
        moduleCode: input.moduleCode,
        entityType: input.entityType,
        entityId: input.entityId,
        permissionCode: "FOUNDATION.FILE.LINK",
      });

      return this.toLinkDto(created);
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
      this.policyInput(user, {
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
      throw new ForbiddenException(`FOUNDATION-FILE-ERR-FORBIDDEN: ${decision.reason}`);
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
    const links = await this.db.withTenant(user.companyId, (tx) =>
      this.linkRepo.listByFileTx(user.companyId, fileId, tx),
    );
    const decision = await this.policy.decideForLinkedFile(
      this.policyInputForFile(user, fileId, FilePolicyAction.Delete),
      links.map((l) => this.toLinkRef(l)),
      FilePolicyAction.Delete,
    );
    if (!decision.allow) {
      await this.logDeny(user, {
        fileId,
        action: "Delete",
        permissionCode: "FOUNDATION.FILE.DELETE",
        reason: decision.reason,
      });
      throw new ForbiddenException(`FOUNDATION-FILE-ERR-FORBIDDEN: ${decision.reason}`);
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

  /**
   * Insert `file_links` bọc bắt 23505 (unique-violation) — PHÂN BIỆT theo TÊN constraint
   * (`pgErrorField(err,'constraint')`), KHÔNG gộp chung 1 mã lỗi cho 2 nguyên nhân khác nhau
   * (S2-FND-DB-2-B):
   *  - `uq_file_links_entity_file_active` (6 cột, mig 0472) → 409 FOUNDATION-FILE-ERR-DUP-LINK (file NÀY
   *    đã gắn vào ĐÚNG entity + link_type này, còn active).
   *  - `uq_file_links_primary_per_entity_type` (5 cột is_primary, mig 0433) → 409
   *    FOUNDATION-FILE-ERR-DUP-PRIMARY (entity đã có 1 file KHÁC làm primary cho cùng link_type).
   * Vi phạm 23505 với constraint KHÁC (không nhận diện được) hoặc lỗi khác 23505 → rethrow nguyên vẹn
   * (KHÔNG nuốt lỗi — silent-failure-hunter).
   */
  private async insertLinkOrThrow(data: NewFileLink, tx: TenantTx): Promise<FileLink> {
    try {
      return await this.linkRepo.insertTx(data, tx);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const constraint = pgErrorField(err, "constraint");
        if (constraint === UQ_FILE_LINKS_ENTITY_FILE_ACTIVE) {
          throw new ConflictException(
            `${FOUNDATION_FILE_ERROR_CODES.DUP_LINK}: file đã được gắn vào entity này với cùng link_type (chưa gỡ).`,
          );
        }
        if (constraint === UQ_FILE_LINKS_PRIMARY_PER_ENTITY_TYPE) {
          throw new ConflictException(
            `${FOUNDATION_FILE_ERROR_CODES.DUP_PRIMARY}: entity này đã có 1 file khác làm primary cho cùng link_type.`,
          );
        }
      }
      throw err;
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
      throw new BadRequestException(
        "FOUNDATION-FILE-ERR-FILENAME: tên file không hợp lệ sau khi chuẩn hoá.",
      );
    }
    return trimmed.slice(0, 500);
  }

  /** Suy phần mở rộng từ tên ĐÃ sanitize (server-side). null nếu không có '.'. Cắt 50 ký tự (cột). */
  private deriveExtension(safeName: string): string | null {
    const dot = safeName.lastIndexOf(".");
    if (dot <= 0 || dot === safeName.length - 1) return null;
    return safeName
      .slice(dot + 1)
      .toLowerCase()
      .slice(0, 50);
  }

  /** Build key server-side; InvalidStorageKeyError → 400 (không lộ chi tiết). */
  private buildKeyOrThrow(companyId: string, fileId: string, originalName: string): string {
    try {
      return buildFileKey({ companyId, fileId, originalName });
    } catch (err) {
      if (err instanceof InvalidStorageKeyError) {
        throw new BadRequestException("FOUNDATION-FILE-ERR-KEY: không thể tạo storage key hợp lệ.");
      }
      throw err;
    }
  }

  /**
   * Đọc giới hạn upload từ system_settings (precedence company > system > default qua SettingService —
   * S1-FND-SETTING-1). Nếu resolve trả kiểu rác → fallback default size; allowlist FAIL-CLOSED (thiếu
   * allowlist ⇒ Set rỗng ⇒ mọi MIME bị từ chối, KHÔNG fail-open).
   */
  private async loadUploadLimits(
    companyId: string,
  ): Promise<{ allowedMime: Set<string>; maxBytes: number }> {
    const resolved = await this.settings.resolveMany(companyId, [
      SETTING_ALLOWED_MIME,
      SETTING_MAX_UPLOAD_MB,
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

    return { allowedMime, maxBytes: maxMb * BYTES_PER_MB };
  }

  /**
   * Dựng FilePermissionInput cho thao tác trên 1 file foundation-owned (module=FOUNDATION, entity=File,
   * entityId=fileId) — fallback FOUNDATION.FILE.* khi không có resolver module.
   */
  private policyInputForFile(
    user: RequestUser,
    fileId: string,
    action: FilePolicyAction,
  ): FilePermissionInput {
    return this.policyInput(user, {
      fileId,
      moduleCode: FOUNDATION_MODULE,
      entityType: FOUNDATION_ENTITY,
      entityId: fileId,
      action,
    });
  }

  /** Dựng FilePermissionInput tường minh (đủ kiểu, không cast) cho dispatch resolver/fallback. */
  private policyInput(
    user: RequestUser,
    parts: {
      fileId: string;
      moduleCode: string;
      entityType: string;
      entityId: string;
      action: FilePolicyAction;
    },
  ): FilePermissionInput {
    return {
      companyId: user.companyId,
      userId: user.id,
      fileId: parts.fileId,
      moduleCode: parts.moduleCode,
      entityType: parts.entityType,
      entityId: parts.entityId,
      action: parts.action,
    };
  }

  /**
   * S2-FND-BE-4 (H1) — map a `file_links` row to the minimal FileLinkRef the policy layer dispatches on.
   * Only the dispatch key + entity instance travel to the policy (no storage_path / secret — #2.3).
   */
  private toLinkRef(link: FileLink): FileLinkRef {
    return {
      moduleCode: link.moduleCode,
      entityType: link.entityType,
      entityId: link.entityId,
    };
  }

  /**
   * S2-FND-BE-4 (H2) — return the deny reason if a file must NOT be presigned for download, else null.
   * Infected takes precedence (security-relevant) over not-uploaded. AV is not yet wired ⇒ the default
   * scan_status is 'NotRequired' — only 'Infected' blocks; Pending/Failed/Clean/NotRequired stay
   * downloadable (chỉ Infected chặn). upload_status MUST be 'Uploaded' (Pending/Failed/Deleted ⇒ not-uploaded).
   */
  private downloadStateDenyReason(row: FileRecord): "infected" | "not-uploaded" | null {
    if (row.scanStatus === "Infected") return "infected";
    if (row.uploadStatus !== "Uploaded") return "not-uploaded";
    return null;
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
    },
  ): Promise<void> {
    await this.db.withTenant(user.companyId, (tx) =>
      this.accessLog.record(tx, {
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
      }),
    );
  }

  /** Map files row → FileMetadataDto an toàn (BẤT BIẾN #2.3 — KHÔNG storage_path/checksum/storedName). */
  private toMetadataDto(row: FileRecord, links: FileLink[]): FileMetadataDto {
    return {
      id: row.id,
      originalName: row.originalName,
      mimeType: row.mimeType,
      fileExtension: row.fileExtension ?? null,
      sizeBytes: row.fileSizeBytes,
      visibility: row.visibility as FileMetadataDto["visibility"],
      uploadStatus: row.uploadStatus as FileMetadataDto["uploadStatus"],
      scanStatus: row.scanStatus as FileMetadataDto["scanStatus"],
      uploadedAt: row.uploadedAt.toISOString(),
      downloadCount: row.downloadCount,
      ownerUserId: row.ownerUserId ?? null,
      isTemporary: row.isTemporary,
      links: links.map((l) => ({
        id: l.id,
        moduleCode: l.moduleCode,
        entityType: l.entityType,
        entityId: l.entityId,
        linkType: l.linkType as FileLinkDto["linkType"],
        accessScope: l.accessScope as FileLinkDto["accessScope"],
        isPrimary: l.isPrimary,
      })),
    };
  }

  /** Map file_links row → FileLinkDto an toàn. */
  private toLinkDto(row: FileLink): FileLinkDto {
    return {
      id: row.id,
      fileId: row.fileId,
      moduleCode: row.moduleCode,
      entityType: row.entityType,
      entityId: row.entityId,
      linkType: row.linkType as FileLinkDto["linkType"],
      accessScope: row.accessScope as FileLinkDto["accessScope"],
      isPrimary: row.isPrimary,
      purpose: row.purpose ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
