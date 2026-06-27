import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../../db/db.service";
import { files, type FileRecord, type NewFileRecord } from "../../db/schema/files";

/**
 * S1-FND-FILE-1 — persistence cho `files` (DB-08 §8.6). MỌI method nhận `companyId` + `tx`: chạy BÊN
 * TRONG transaction `withTenant` của FileService (1 chốt tenant duy nhất, BẤT BIẾN #1). Lọc
 * `eq(company_id)` tường minh (defense-in-depth) DÙ RLS+FORCE (mig 0433) đã ép ở DB.
 *
 * BẤT BIẾN #2: KHÔNG hard-delete — `softDeleteTx` set `deleted_at`/`deleted_by` (app role có
 * column-UPDATE(deleted_at, deleted_by, upload_status), KHÔNG có DELETE row). KHÔNG trả storage_path ra
 * ngoài repo cho DTO; service map sang FileMetadataDto an toàn (storage_path KHÔNG bao giờ leak — #2.3).
 */
@Injectable()
export class FileRepository {
  /** files chưa soft-delete của tenant theo id. undefined nếu không tồn tại / cross-tenant (RLS) / đã xoá. */
  async findByIdTx(
    companyId: string,
    fileId: string,
    tx: TenantTx,
  ): Promise<FileRecord | undefined> {
    const [row] = await tx
      .select()
      .from(files)
      .where(and(eq(files.companyId, companyId), eq(files.id, fileId), isNull(files.deletedAt)))
      .limit(1);
    return row;
  }

  /**
   * Insert 1 row metadata. company_id KHÔNG truyền trong values — DB DEFAULT current_setting điền (an
   * toàn PgBouncer); nhưng vẫn set tường minh từ `data.companyId` để khớp tenant ngữ cảnh. Trả row vừa tạo.
   */
  async insertTx(data: NewFileRecord, tx: TenantTx): Promise<FileRecord> {
    const [row] = await tx.insert(files).values(data).returning();
    if (!row) {
      throw new Error("FileRepository.insertTx: insert returned no row");
    }
    return row;
  }

  /**
   * Liệt kê files chưa xoá của tenant (mới nhất trước), có thể lọc theo upload/scope. Pagination ép ở
   * service (limit/offset). RLS-scoped — chỉ thấy tenant hiện tại.
   */
  async listTx(
    companyId: string,
    opts: { limit: number; offset: number; visibility?: string },
    tx: TenantTx,
  ): Promise<FileRecord[]> {
    const conds = [eq(files.companyId, companyId), isNull(files.deletedAt)];
    if (opts.visibility) conds.push(eq(files.visibility, opts.visibility));
    return tx
      .select()
      .from(files)
      .where(and(...conds))
      .orderBy(desc(files.uploadedAt))
      .limit(opts.limit)
      .offset(opts.offset);
  }

  /** Đếm files chưa xoá của tenant (cho meta.total của list). */
  async countTx(companyId: string, opts: { visibility?: string }, tx: TenantTx): Promise<number> {
    const conds = [eq(files.companyId, companyId), isNull(files.deletedAt)];
    if (opts.visibility) conds.push(eq(files.visibility, opts.visibility));
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(files)
      .where(and(...conds));
    return row?.count ?? 0;
  }

  /**
   * Soft-delete (BẤT BIẾN #2): set deleted_at=now + deleted_by + upload_status='Deleted'. CHỈ update khi
   * row còn (deleted_at IS NULL) ⇒ idempotent (xoá lại không đổi gì). Trả số row ảnh hưởng (0 = không
   * tồn tại / cross-tenant / đã xoá → service ném NotFound, tránh oracle).
   */
  async softDeleteTx(
    companyId: string,
    fileId: string,
    deletedBy: string,
    tx: TenantTx,
  ): Promise<number> {
    const updated = await tx
      .update(files)
      .set({ deletedAt: new Date(), deletedBy, uploadStatus: "Deleted" })
      .where(and(eq(files.companyId, companyId), eq(files.id, fileId), isNull(files.deletedAt)))
      .returning({ id: files.id });
    return updated.length;
  }
}
