import { Injectable } from "@nestjs/common";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../../db/db.service";
import { fileLinks, files } from "../../db/schema/files";

/**
 * S15-PAYROLL-BE-5B — persistence cho tệp do SERVER sinh (PDF/ZIP tạm). Tách khỏi `FileRepository` (hot-file
 * của luồng upload client) — chỉ thêm, không sửa đường cũ. Mọi câu có `company_id` tường minh + RLS.
 */

export interface ServerFileLinkTarget {
  moduleCode: string;
  entityType: string;
  entityId: string;
}

export interface NewServerFile {
  id: string;
  companyId: string;
  originalName: string;
  fileExtension: string;
  mimeType: string;
  storagePath: string;
  actorUserId: string;
  expiresAt: Date;
  metadata: Record<string, unknown>;
  link: ServerFileLinkTarget;
}

/** Hàng tệp server kèm link sở hữu — đủ cho lấy-hoặc-tạo, ký URL và consumer. */
export interface ServerFileRow {
  id: string;
  originalName: string;
  mimeType: string;
  storagePath: string;
  uploadStatus: string;
  scanStatus: string;
  uploadedBy: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
  link: ServerFileLinkTarget & { linkId: string };
}

const SERVER_FILE_PROVIDER = "MinIO";

@Injectable()
export class ServerFileRepository {
  /** Hàng `files` Pending + link sở hữu trong CÙNG tx — tệp server không bao giờ tồn tại mà không có link. */
  async insertReservedTx(tx: TenantTx, row: NewServerFile): Promise<{ createdAt: Date }> {
    const [created] = await tx
      .insert(files)
      .values({
        id: row.id,
        companyId: row.companyId,
        originalName: row.originalName,
        storedName: row.id,
        fileExtension: row.fileExtension,
        mimeType: row.mimeType,
        fileSizeBytes: 0,
        storageProvider: SERVER_FILE_PROVIDER,
        storagePath: row.storagePath,
        visibility: "Private",
        uploadStatus: "Pending",
        scanStatus: "NotRequired",
        ownerUserId: row.actorUserId,
        uploadedBy: row.actorUserId,
        isTemporary: true,
        expiresAt: row.expiresAt,
        metadata: row.metadata,
      })
      .returning({ createdAt: files.createdAt });
    await tx.insert(fileLinks).values({
      companyId: row.companyId,
      fileId: row.id,
      moduleCode: row.link.moduleCode,
      entityType: row.link.entityType,
      entityId: row.link.entityId,
      linkType: "Export",
      accessScope: "Owner",
      createdBy: row.actorUserId,
    });
    return { createdAt: created.createdAt };
  }

  /** Pending → Uploaded. Guard `upload_status='Pending'` ⇒ lượt chạy chồng/muộn nhận 0 hàng. */
  async markStoredTx(
    tx: TenantTx,
    companyId: string,
    fileId: string,
    data: { sizeBytes: number; checksumSha256: string },
  ): Promise<number> {
    const updated = await tx
      .update(files)
      .set({
        uploadStatus: "Uploaded",
        fileSizeBytes: data.sizeBytes,
        checksumSha256: data.checksumSha256,
        contentHash: data.checksumSha256,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(this.pendingRow(companyId, fileId))
      .returning({ id: files.id });
    return updated.length;
  }

  /** Pending → Failed, GỘP `failure` vào metadata (giữ vân tay/số phiếu đã có). */
  async markFailedTx(
    tx: TenantTx,
    companyId: string,
    fileId: string,
    failure: string,
  ): Promise<number> {
    const updated = await tx
      .update(files)
      .set({
        uploadStatus: "Failed",
        metadata: sql`coalesce(${files.metadata}, '{}'::jsonb) || jsonb_build_object('failure', ${failure}::text)`,
        updatedAt: new Date(),
      })
      .where(this.pendingRow(companyId, fileId))
      .returning({ id: files.id });
    return updated.length;
  }

  /**
   * Tệp tạm SỐNG mới nhất gắn với `target`, do `uploadedBy` tạo, còn hạn tới SAU `aliveAfter`.
   * Không lọc trạng thái — người gọi quyết theo `uploadStatus`.
   */
  async findLatestLiveTx(
    tx: TenantTx,
    companyId: string,
    target: ServerFileLinkTarget,
    uploadedBy: string,
    aliveAfter: Date,
  ): Promise<ServerFileRow | null> {
    const rows = await this.selectRows(tx)
      .where(
        and(
          eq(files.companyId, companyId),
          isNull(files.deletedAt),
          eq(files.isTemporary, true),
          gt(files.expiresAt, aliveAfter),
          eq(files.uploadedBy, uploadedBy),
          eq(fileLinks.moduleCode, target.moduleCode),
          eq(fileLinks.entityType, target.entityType),
          eq(fileLinks.entityId, target.entityId),
        ),
      )
      .orderBy(desc(files.createdAt), desc(files.id))
      .limit(1);
    return rows[0] ? toRow(rows[0]) : null;
  }

  /** Một tệp tạm sống theo id + module sở hữu (consumer). */
  async findByIdTx(
    tx: TenantTx,
    companyId: string,
    fileId: string,
    moduleCode: string,
  ): Promise<ServerFileRow | null> {
    const rows = await this.selectRows(tx)
      .where(
        and(
          eq(files.companyId, companyId),
          eq(files.id, fileId),
          isNull(files.deletedAt),
          eq(files.isTemporary, true),
          eq(fileLinks.moduleCode, moduleCode),
        ),
      )
      .limit(1);
    return rows[0] ? toRow(rows[0]) : null;
  }

  private selectRows(tx: TenantTx) {
    return tx
      .select({
        id: files.id,
        originalName: files.originalName,
        mimeType: files.mimeType,
        storagePath: files.storagePath,
        uploadStatus: files.uploadStatus,
        scanStatus: files.scanStatus,
        uploadedBy: files.uploadedBy,
        metadata: files.metadata,
        createdAt: files.createdAt,
        expiresAt: files.expiresAt,
        linkId: fileLinks.id,
        moduleCode: fileLinks.moduleCode,
        entityType: fileLinks.entityType,
        entityId: fileLinks.entityId,
      })
      .from(files)
      .innerJoin(
        fileLinks,
        and(
          eq(fileLinks.fileId, files.id),
          eq(fileLinks.companyId, files.companyId),
          isNull(fileLinks.deletedAt),
          eq(fileLinks.linkType, "Export"),
        ),
      );
  }

  private pendingRow(companyId: string, fileId: string) {
    return and(
      eq(files.companyId, companyId),
      eq(files.id, fileId),
      isNull(files.deletedAt),
      eq(files.uploadStatus, "Pending"),
    );
  }
}

type SelectedRow = {
  id: string;
  originalName: string;
  mimeType: string;
  storagePath: string;
  uploadStatus: string;
  scanStatus: string;
  uploadedBy: string;
  metadata: unknown;
  createdAt: Date;
  expiresAt: Date | null;
  linkId: string;
  moduleCode: string;
  entityType: string;
  entityId: string;
};

function toRow(r: SelectedRow): ServerFileRow {
  if (r.expiresAt === null) {
    // Hàng tệp tạm luôn có hạn (insertReservedTx); null = hàng không do luồng này tạo ⇒ không coi là sống.
    throw new Error(`server-file ${r.id}: tệp tạm thiếu expires_at`);
  }
  return {
    id: r.id,
    originalName: r.originalName,
    mimeType: r.mimeType,
    storagePath: r.storagePath,
    uploadStatus: r.uploadStatus,
    scanStatus: r.scanStatus,
    uploadedBy: r.uploadedBy,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    link: {
      linkId: r.linkId,
      moduleCode: r.moduleCode,
      entityType: r.entityType,
      entityId: r.entityId,
    },
  };
}
