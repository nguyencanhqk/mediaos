import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService, type TenantTx } from "../../db/db.service";
import { buildFileKey } from "../../storage/file-storage-key";
import {
  DEFAULT_PRESIGN_TTL_SEC,
  STORAGE_ADAPTER,
  type StorageAdapter,
} from "../../storage/storage-adapter.port";
import { FileAccessLogService } from "./file-access-log.service";
import { fileDownloadStateDenyReason } from "./file-download-state";
import {
  ServerFileRepository,
  type ServerFileLinkTarget,
  type ServerFileRow,
} from "./server-file.repository";

/**
 * S15-PAYROLL-BE-5B — tệp do SERVER sinh (PDF/ZIP), lưu TẠM, giao qua signed-URL TTL ngắn.
 *
 * Vòng đời (plan BE-5B E-4/E-5, owner O-3):
 *   1. `reserveTx`  — hàng `files` Pending (`is_temporary`, `expires_at`) + link `Export` trong tx của người gọi.
 *   2. `store`      — PUT object NGOÀI tx, rồi tx ngắn Pending → Uploaded (size + sha256 tính từ chính bytes).
 *   3. `issueUrlTx` — guard trạng thái (như `FileService.getDownloadUrl`) + presign + `file_access_logs`.
 *   Hỏng giữa 1 và 2 ⇒ hàng còn Pending/Failed ⇒ `TEMP_FILE_CLEANUP` xoá cả object lẫn hàng khi hết hạn
 *   (không bao giờ có object không hàng).
 *
 * Route file chung (`/foundation/files/*`) KHÔNG giao được tệp này: module sở hữu phải đăng ký resolver
 * cho `moduleCode` của link và resolver đó quyết (PAYROLL từ chối mọi thao tác).
 */

export const SERVER_FILE_MIME = {
  pdf: "application/pdf",
  zip: "application/zip",
} as const;
export type ServerFileKind = keyof typeof SERVER_FILE_MIME;

export interface ReserveServerFileInput {
  companyId: string;
  actorUserId: string;
  /** Tên hiển thị — KHÔNG chứa tên/mã người (danh sách metadata chung thấy được). */
  originalName: string;
  kind: ServerFileKind;
  ttlSec: number;
  link: ServerFileLinkTarget;
  metadata?: Record<string, unknown>;
}

export interface ReservedServerFile {
  fileId: string;
  storageKey: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface IssuedServerFileUrl {
  url: string;
  expiresAt: Date;
}

/** Trần TTL chữ ký của adapter (`s3-storage.adapter.ts` MAX_PRESIGN_TTL_SEC) — mốc «còn sống» không vượt được. */
const MAX_PRESIGN_TTL_SEC = 3600;

export class ServerFileNotDownloadableError extends Error {
  constructor(
    readonly fileId: string,
    readonly reason: string,
  ) {
    super(`server-file ${fileId} không tải được: ${reason}`);
    this.name = "ServerFileNotDownloadableError";
  }
}

@Injectable()
export class ServerFileService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ServerFileRepository,
    private readonly accessLog: FileAccessLogService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async reserveTx(tx: TenantTx, input: ReserveServerFileInput): Promise<ReservedServerFile> {
    const fileId = randomUUID();
    const storageKey = buildFileKey({ companyId: input.companyId, fileId });
    const expiresAt = new Date(Date.now() + input.ttlSec * 1000);
    const { createdAt } = await this.repo.insertReservedTx(tx, {
      id: fileId,
      companyId: input.companyId,
      originalName: input.originalName,
      fileExtension: input.kind,
      mimeType: SERVER_FILE_MIME[input.kind],
      storagePath: storageKey,
      actorUserId: input.actorUserId,
      expiresAt,
      metadata: input.metadata ?? {},
      link: input.link,
    });
    await this.accessLog.record(tx, {
      fileId,
      action: "Upload",
      accessGranted: true,
      actorUserId: input.actorUserId,
      moduleCode: input.link.moduleCode,
      entityType: input.link.entityType,
      entityId: input.link.entityId,
    });
    return { fileId, storageKey, createdAt, expiresAt };
  }

  /**
   * PUT bytes rồi đánh dấu Uploaded. Trả `false` khi hàng không còn Pending (lượt khác đã chốt/đánh hỏng) —
   * object vừa ghi vẫn thuộc đúng hàng đó nên job dọn sẽ xoá theo hạn.
   */
  async store(
    companyId: string,
    reserved: Pick<ReservedServerFile, "fileId" | "storageKey">,
    kind: ServerFileKind,
    bytes: Uint8Array,
  ): Promise<boolean> {
    await this.storage.put({
      key: reserved.storageKey,
      companyId,
      body: bytes,
      contentType: SERVER_FILE_MIME[kind],
    });
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    const updated = await this.db.withTenant(companyId, (tx) =>
      this.repo.markStoredTx(tx, companyId, reserved.fileId, {
        sizeBytes: bytes.byteLength,
        checksumSha256,
      }),
    );
    return updated === 1;
  }

  markFailedTx(tx: TenantTx, companyId: string, fileId: string, failure: string): Promise<number> {
    return this.repo.markFailedTx(tx, companyId, fileId, failure);
  }

  /**
   * Tệp tạm mới nhất của (`target`, `uploadedBy`) mà hạn tệp còn dài hơn một chữ ký URL — URL cấp ra không
   * bao giờ sống lâu hơn object (plan §0b «URL»).
   */
  findLatestLiveTx(
    tx: TenantTx,
    companyId: string,
    target: ServerFileLinkTarget,
    uploadedBy: string,
  ): Promise<ServerFileRow | null> {
    const aliveAfter = new Date(Date.now() + ServerFileService.presignTtlSec() * 1000);
    return this.repo.findLatestLiveTx(tx, companyId, target, uploadedBy, aliveAfter);
  }

  /** TTL chữ ký hiệu lực — cùng nguồn env + trần với adapter. */
  static presignTtlSec(): number {
    const env = Number.parseInt(process.env.S3_PRESIGN_TTL_SEC ?? "", 10);
    const ttl = Number.isFinite(env) && env > 0 ? env : DEFAULT_PRESIGN_TTL_SEC;
    return Math.min(ttl, MAX_PRESIGN_TTL_SEC);
  }

  findByIdTx(
    tx: TenantTx,
    companyId: string,
    fileId: string,
    moduleCode: string,
  ): Promise<ServerFileRow | null> {
    return this.repo.findByIdTx(tx, companyId, fileId, moduleCode);
  }

  /** Ký URL tải (TTL env) cho tệp đã Uploaded + ghi `GenerateSignedUrl`. Không log URL. */
  async issueUrlTx(
    tx: TenantTx,
    companyId: string,
    actorUserId: string,
    file: ServerFileRow,
  ): Promise<IssuedServerFileUrl> {
    const deny = fileDownloadStateDenyReason(file);
    if (deny !== null) throw new ServerFileNotDownloadableError(file.id, deny);
    const signed = await this.storage.get({ key: file.storagePath, companyId });
    await this.accessLog.record(tx, {
      fileId: file.id,
      action: "GenerateSignedUrl",
      accessGranted: true,
      actorUserId,
      fileLinkId: file.link.linkId,
      moduleCode: file.link.moduleCode,
      entityType: file.link.entityType,
      entityId: file.link.entityId,
    });
    return { url: signed.url, expiresAt: signed.expiresAt };
  }
}
