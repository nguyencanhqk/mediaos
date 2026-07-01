import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  fileAccessLogViewSchema,
  type FileAccessLogView,
  type ListFileAccessLogsQuery,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../../db/db.service";
import { fileAccessLogs } from "../../db/schema/files";

/**
 * S2-FND-BE-3 (L4-file-access-log-viewer) — READ side của `file_access_logs` (DB-08 §8.8, BACKEND-11).
 *
 * BẤT BIẾN:
 *  #1 — mọi đọc đi qua withTenant(companyId) (RLS+FORCE ép company_id ở DB — KHÔNG query trần).
 *  #2 — file_access_logs APPEND-ONLY: service này CHỈ đọc (list/count). KHÔNG có method mutate.
 *  #3 — WHITELIST an toàn: mapper `toFileAccessLogView` loại BỎ ip_address/user_agent/metadata (PII/dấu vết)
 *       + cột nội bộ (company_id/actor_employee_id/file_link_id). KHÔNG lộ secret ra DTO.
 *
 * List filter: fileId / actorUserId / action / from-to (created_at). Phân trang page-based (page/limit từ
 * DTO đã clamp). Sắp created_at DESC (log mới nhất trước) + id DESC làm tie-break ổn định (phân trang xác định).
 */

/** Kết quả list nội bộ (data đã mask + tổng để dựng pagination block ở controller). */
export interface FileAccessLogListResult {
  data: FileAccessLogView[];
  meta: { total: number; page: number; limit: number };
}

/**
 * Map 1 row RAW → view DTO WHITELIST (BẤT BIẾN #3). Nhận `Record<string, unknown>` (row bất kỳ — chủ đích
 * "chỉ đọc field an toàn, mặc kệ phần còn lại") rồi `fileAccessLogViewSchema.parse` (phòng thủ chiều sâu —
 * z.object().strip() loại mọi key lạ nếu lọt vào). KHÔNG bao giờ đọc ip_address/user_agent/metadata từ row
 * ⇒ chúng KHÔNG thể rò ra ngoài. createdAt Date → ISO string trên wire.
 */
export function toFileAccessLogView(row: Record<string, unknown>): FileAccessLogView {
  const created = row.createdAt;
  const createdAt = created instanceof Date ? created.toISOString() : String(created ?? "");
  return fileAccessLogViewSchema.parse({
    id: row.id,
    fileId: row.fileId,
    action: row.action,
    accessGranted: row.accessGranted,
    deniedReason: row.deniedReason ?? null,
    actorUserId: row.actorUserId ?? null,
    moduleCode: row.moduleCode ?? null,
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    permissionCode: row.permissionCode ?? null,
    requestId: row.requestId ?? null,
    createdAt,
  });
}

@Injectable()
export class FileAccessLogReadService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Liệt kê log truy cập file của tenant (masked + phân trang). withTenant + RLS ép company_id (BẤT BIẾN #1) —
   * KHÔNG thấy log tenant khác. eq(companyId) tường minh là phòng thủ chiều sâu TRÊN RLS.
   */
  async list(companyId: string, query: ListFileAccessLogsQuery): Promise<FileAccessLogListResult> {
    const where = this._buildWhere(companyId, query);
    const offset = (query.page - 1) * query.limit;

    return this.db.withTenant(companyId, async (tx) => {
      const rows = await tx
        .select()
        .from(fileAccessLogs)
        .where(where)
        .orderBy(desc(fileAccessLogs.createdAt), desc(fileAccessLogs.id))
        .limit(query.limit)
        .offset(offset);

      const total = await this._count(tx, where);
      return {
        data: rows.map((row) => toFileAccessLogView(row as Record<string, unknown>)),
        meta: { total, page: query.page, limit: query.limit },
      };
    });
  }

  /** Dựng mệnh đề WHERE (company_id BẮT BUỘC + filter tuỳ chọn). */
  private _buildWhere(companyId: string, query: ListFileAccessLogsQuery): SQL | undefined {
    const conds: SQL[] = [eq(fileAccessLogs.companyId, companyId)];
    if (query.fileId) conds.push(eq(fileAccessLogs.fileId, query.fileId));
    if (query.actorUserId) conds.push(eq(fileAccessLogs.actorUserId, query.actorUserId));
    if (query.action) conds.push(eq(fileAccessLogs.action, query.action));
    if (query.from) conds.push(gte(fileAccessLogs.createdAt, query.from));
    if (query.to) conds.push(lte(fileAccessLogs.createdAt, query.to));
    return and(...conds);
  }

  /** Đếm tổng bản ghi khớp filter (cho pagination.total). */
  private async _count(tx: TenantTx, where: SQL | undefined): Promise<number> {
    const rows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(fileAccessLogs)
      .where(where);
    const value = rows[0]?.count;
    return typeof value === "number" ? value : Number(value ?? 0);
  }
}
