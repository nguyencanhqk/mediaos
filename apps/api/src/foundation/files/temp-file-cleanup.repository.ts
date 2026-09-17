import { Injectable } from "@nestjs/common";
import { and, eq, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../../db/db.service";
import { fileLinks, files, type FileRecord } from "../../db/schema/files";

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
   * Liệt kê files ĐỦ ĐIỀU KIỆN cleanup của tenant (vị từ ở `eligibleWhere`).
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
      .where(eligibleWhere(companyId, pendingCutoff, now));
  }

  /**
   * S15-PAYROLL-BE-5B (plan §8.2 #1 — TOCTOU) — kiểm lại ĐÚNG vị từ liệt kê cho MỘT tệp, ngay trước khi handler
   * xoá object. Giữa lúc liệt kê và lúc xoá, tệp có thể đã được gắn link / xác nhận upload / xoá song song ⇒
   * không còn đủ điều kiện thì KHÔNG được xoá object của nó.
   */
  async isStillEligibleTx(
    companyId: string,
    fileId: string,
    pendingCutoff: Date,
    now: Date,
    tx: TenantTx,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eligibleWhere(companyId, pendingCutoff, now)))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Soft-delete HỆ THỐNG (BẤT BIẾN #2): set deleted_at=now + upload_status='Deleted' + deleted_by=NULL (không
   * có user actor — cleanup nền). KHÁC `FileRepository.softDeleteTx` (yêu cầu deletedBy non-null). CHỈ update
   * khi row CÒN đủ điều kiện (cùng vị từ `eligibleWhere`, gồm `deleted_at IS NULL`) ⇒ idempotent + chống race
   * (file bị xoá / gắn link / xác nhận song song → 0 row → handler bỏ qua). Trả số row ảnh hưởng.
   */
  async softDeleteBySystemTx(
    companyId: string,
    fileId: string,
    pendingCutoff: Date,
    now: Date,
    tx: TenantTx,
  ): Promise<number> {
    const updated = await tx
      .update(files)
      .set({ deletedAt: new Date(), deletedBy: null, uploadStatus: "Deleted" })
      .where(and(eq(files.id, fileId), eligibleWhere(companyId, pendingCutoff, now)))
      .returning({ id: files.id });
    return updated.length;
  }

  /**
   * S15-PAYROLL-BE-5B — gỡ (xoá mềm, hệ thống) các link `Export` còn sống của tệp vừa dọn, để không còn link
   * trỏ vào hàng đã xoá. `deleted_by` NULL (không có user actor). Trả số link đã gỡ.
   */
  async softDeleteExportLinksBySystemTx(
    companyId: string,
    fileId: string,
    tx: TenantTx,
  ): Promise<number> {
    const updated = await tx
      .update(fileLinks)
      .set({ deletedAt: new Date(), deletedBy: null })
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.fileId, fileId),
          eq(fileLinks.linkType, "Export"),
          isNull(fileLinks.deletedAt),
        ),
      )
      .returning({ id: fileLinks.id });
    return updated.length;
  }
}

/**
 * Vị từ đủ-điều-kiện dọn — MỘT nguồn cho liệt kê, kiểm lại trước khi xoá object, và câu xoá mềm (plan BE-5B
 * §8.2 #1). Eligibility:
 *   company_id = companyId AND deleted_at IS NULL
 *   AND ( (is_temporary AND expires_at < now) OR (upload_status='Pending' AND created_at < pendingCutoff) )
 *   AND NOT EXISTS (file_links active WHERE file_id=files.id) — link-safety (file đang được tham chiếu thì GIỮ).
 *
 * S15-PAYROLL-BE-5B (plan §0b B4): với tệp TẠM, link `link_type=Export` KHÔNG tính là tham chiếu — đó là link sở
 * hữu của tệp xuất do server sinh (PDF/ZIP phiếu lương), luôn có mặt để resolver của module chặn route file chung.
 * Link loại khác (Attachment/Contract/…) vẫn GIỮ tệp như cũ. Subquery viết chữ `files.*` (bảng ngoài không alias)
 * để SQL đọc được và đúng ở cả SELECT lẫn UPDATE, không phụ thuộc cách drizzle render cột nhúng.
 */
function eligibleWhere(companyId: string, pendingCutoff: Date, now: Date): SQL {
  const cond = and(
    eq(files.companyId, companyId),
    isNull(files.deletedAt),
    or(
      and(eq(files.isTemporary, true), isNotNull(files.expiresAt), lt(files.expiresAt, now)),
      and(eq(files.uploadStatus, "Pending"), lt(files.createdAt, pendingCutoff)),
    ),
    sql`NOT EXISTS (
      SELECT 1 FROM file_links fl
      WHERE fl.file_id = files.id
        AND fl.company_id = ${companyId}
        AND fl.deleted_at IS NULL
        AND NOT (files.is_temporary AND fl.link_type = 'Export')
    )`,
  );
  if (!cond) throw new Error("eligibleWhere: điều kiện rỗng");
  return cond;
}
