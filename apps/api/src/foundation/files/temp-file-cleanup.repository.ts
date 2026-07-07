import { Injectable } from "@nestjs/common";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { TenantTx } from "../../db/db.service";
import { files, type FileRecord } from "../../db/schema/files";

/**
 * S2-FND-JOBS-1 (jobs_tempfile · crown) — persistence cho TEMP_FILE_CLEANUP (DB-08 §8.6).
 *
 * MỌI method nhận `companyId` + `tx`: chạy BÊN TRONG transaction `withTenant` của TempFileCleanupJobHandler
 * (1 chốt tenant duy nhất, BẤT BIẾN #1). Lọc `eq(company_id)` tường minh (defense-in-depth) DÙ RLS+FORCE
 * (mig 0433) đã ép ở DB — bao gồm cả subquery NOT EXISTS file_links (RLS + company_id tường minh).
 *
 * BẤT BIẾN #2: KHÔNG hard-delete — `softDeleteBySystemTx` set `deleted_at`/`upload_status='Deleted'` với
 * `deleted_by = NULL` (hành động HỆ THỐNG, KHÔNG có user actor). App role có table-level UPDATE trên `files`
 * (mig 0433:117) ⇒ được phép ghi các cột này; KHÔNG có DELETE row.
 */
@Injectable()
export class TempFileCleanupRepository {
  /**
   * Liệt kê files ĐỦ ĐIỀU KIỆN cleanup của tenant. Eligibility:
   *   deleted_at IS NULL
   *   AND ( (is_temporary=true AND expires_at < now) OR (upload_status='Pending' AND created_at < pendingCutoff) )
   *   AND NOT EXISTS (file_links active WHERE file_id=files.id) — link-safety (file đang được tham chiếu thì GIỮ).
   *
   * `now` + `pendingCutoff` truyền TỪ handler (một mốc thời gian nhất quán cho cả vòng, dễ test). RLS-scoped —
   * chỉ thấy tenant hiện tại; subquery file_links cũng lọc company_id tường minh (defense-in-depth).
   */
  async findEligibleTx(
    companyId: string,
    pendingCutoff: Date,
    now: Date,
    tx: TenantTx,
  ): Promise<FileRecord[]> {
    return tx
      .select()
      .from(files)
      .where(
        and(
          eq(files.companyId, companyId),
          isNull(files.deletedAt),
          or(
            and(eq(files.isTemporary, true), isNotNull(files.expiresAt), lt(files.expiresAt, now)),
            and(eq(files.uploadStatus, "Pending"), lt(files.createdAt, pendingCutoff)),
          ),
          sql`NOT EXISTS (
            SELECT 1 FROM file_links fl
            WHERE fl.file_id = ${files.id}
              AND fl.company_id = ${companyId}
              AND fl.deleted_at IS NULL
          )`,
        ),
      );
  }

  /**
   * Soft-delete HỆ THỐNG (BẤT BIẾN #2): set deleted_at=now + upload_status='Deleted' + deleted_by=NULL (không
   * có user actor — cleanup nền). KHÁC `FileRepository.softDeleteTx` (yêu cầu deletedBy non-null). CHỈ update
   * khi row còn (deleted_at IS NULL) ⇒ idempotent + chống race (file bị xoá song song → 0 row → handler bỏ qua).
   * Trả số row ảnh hưởng.
   */
  async softDeleteBySystemTx(companyId: string, fileId: string, tx: TenantTx): Promise<number> {
    const updated = await tx
      .update(files)
      .set({ deletedAt: new Date(), deletedBy: null, uploadStatus: "Deleted" })
      .where(and(eq(files.companyId, companyId), eq(files.id, fileId), isNull(files.deletedAt)))
      .returning({ id: files.id });
    return updated.length;
  }
}
