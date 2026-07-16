import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../db/db.service";
import { fileLinks, type FileLink, type NewFileLink } from "../../db/schema/files";

/**
 * S1-FND-FILE-1 — persistence cho `file_links` (DB-08 §8.7). MỌI method nhận `companyId` + `tx`: chạy
 * BÊN TRONG transaction `withTenant` của FileService (BẤT BIẾN #1). RLS+FORCE (mig 0433) ép cô lập tenant
 * ở DB; lọc `eq(company_id)` tường minh = defense-in-depth.
 *
 * BẤT BIẾN #2: gỡ link = SOFT-DELETE (deleted_at/deleted_by) — row CÒN. KHÔNG hard-delete (app role có
 * column-UPDATE(deleted_at, deleted_by) trên file_links, KHÔNG có DELETE row).
 */
@Injectable()
export class FileLinkRepository {
  /** Insert 1 link (created_by). Trả row vừa tạo. company_id từ ngữ cảnh tenant (data.companyId tường minh). */
  async insertTx(data: NewFileLink, tx: TenantTx): Promise<FileLink> {
    const [row] = await tx.insert(fileLinks).values(data).returning();
    if (!row) {
      throw new Error("FileLinkRepository.insertTx: insert returned no row");
    }
    return row;
  }

  /** link chưa soft-delete của tenant theo id. undefined nếu không tồn tại / cross-tenant / đã gỡ. */
  async findByIdTx(companyId: string, linkId: string, tx: TenantTx): Promise<FileLink | undefined> {
    const [row] = await tx
      .select()
      .from(fileLinks)
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.id, linkId),
          isNull(fileLinks.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  /** Liệt kê link chưa gỡ của 1 file (cho FileMetadataDto.links eager-load). RLS-scoped. */
  async listByFileTx(companyId: string, fileId: string, tx: TenantTx): Promise<FileLink[]> {
    return tx
      .select()
      .from(fileLinks)
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.fileId, fileId),
          isNull(fileLinks.deletedAt),
        ),
      );
  }

  /**
   * S5-ME-BE-2 — liệt kê link chưa gỡ của 1 entity nghiệp vụ (chiều NGƯỢC với `listByFileTx`: "entity này
   * đang trỏ tới file nào" thay vì "file này trỏ tới entity nào"). Dùng để tìm avatar link CŨ trước khi
   * thay avatar mới (ME) — RLS-scoped, AND company_id tường minh (belt-and-suspenders).
   */
  async listActiveByEntityTx(
    companyId: string,
    moduleCode: string,
    entityType: string,
    entityId: string,
    tx: TenantTx,
  ): Promise<FileLink[]> {
    return tx
      .select()
      .from(fileLinks)
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.moduleCode, moduleCode),
          eq(fileLinks.entityType, entityType),
          eq(fileLinks.entityId, entityId),
          isNull(fileLinks.deletedAt),
        ),
      );
  }

  /**
   * Soft-delete (unlink, BẤT BIẾN #2): set deleted_at=now + deleted_by. CHỈ update khi link còn
   * (deleted_at IS NULL) ⇒ idempotent. Trả số row ảnh hưởng (0 = không tồn tại / cross-tenant / đã gỡ).
   */
  async softDeleteTx(
    companyId: string,
    linkId: string,
    deletedBy: string,
    tx: TenantTx,
  ): Promise<number> {
    const updated = await tx
      .update(fileLinks)
      .set({ deletedAt: new Date(), deletedBy })
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.id, linkId),
          isNull(fileLinks.deletedAt),
        ),
      )
      .returning({ id: fileLinks.id });
    return updated.length;
  }
}
