import { Injectable } from "@nestjs/common";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { costRecords } from "../db/schema";

/**
 * G13-2 — Repository sổ cái chi phí APPEND-ONLY (BẤT BIẾN #2). Mirror revenue.repository.ts.
 *
 * KHÔNG có update()/delete() — app role chỉ GRANT SELECT,INSERT (migration 0071). "Sửa/xoá" = ghi
 * bản ghi mới (entry_kind adjustment|void + replaces_record_id). Mọi truy vấn nghiệp vụ đi qua
 * withTenant (RLS ép company_id ở DB). Write methods nhận `tx` để chạy CÙNG transaction với audit.
 */

/** Cột app được phép set khi INSERT (company_id lấy từ DB DEFAULT current_setting). */
export interface InsertCostData {
  costType: string;
  amount: string; // numeric → string (Drizzle)
  currency: string;
  costDate: string;
  orgUnitId?: string | null;
  teamId?: string | null;
  projectId?: string | null;
  channelId?: string | null;
  contentItemId?: string | null;
  userId?: string | null;
  vendorName?: string | null;
  description?: string | null;
  attachmentUrl?: string | null;
  enteredBy: string;
  entryKind: "original" | "adjustment" | "void";
  replacesRecordId?: string | null;
  expenseRequestId?: string | null;
}

/** Default pagination khi service không truyền (an toàn unbounded-query ở mọi caller). */
const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

export interface ListCostFilter {
  costType?: string;
  channelId?: string;
  projectId?: string;
  contentItemId?: string;
  orgUnitId?: string;
  teamId?: string;
  from?: string;
  to?: string;
  /** true = trả cả bản ghi đã bị thay thế/void (xem lịch sử chain). Mặc định chỉ bản hiệu lực. */
  includeSuperseded?: boolean;
  /** Pagination: limit [1..100] default 50 (Zod đã clamp ở controller). Repo guard default lần cuối. */
  limit?: number;
  offset?: number;
}

@Injectable()
export class CostRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Liệt kê cost của tenant (RLS lọc company_id). Mặc định chỉ bản HIỆU LỰC:
   *   entry_kind != 'void' AND chưa bị bản ghi khác thay thế (replaces_record_id trỏ tới nó).
   */
  list(companyId: string, filter: ListCostFilter = {}) {
    return this.db.withTenant(companyId, async (tx) => {
      const conds = [eq(costRecords.companyId, companyId)];
      if (filter.costType) conds.push(eq(costRecords.costType, filter.costType));
      if (filter.channelId) conds.push(eq(costRecords.channelId, filter.channelId));
      if (filter.projectId) conds.push(eq(costRecords.projectId, filter.projectId));
      if (filter.contentItemId) conds.push(eq(costRecords.contentItemId, filter.contentItemId));
      if (filter.orgUnitId) conds.push(eq(costRecords.orgUnitId, filter.orgUnitId));
      if (filter.teamId) conds.push(eq(costRecords.teamId, filter.teamId));
      if (filter.from) conds.push(gte(costRecords.costDate, filter.from));
      if (filter.to) conds.push(lte(costRecords.costDate, filter.to));

      if (!filter.includeSuperseded) {
        // hiệu lực: không phải void + KHÔNG có bản ghi nào thay thế nó.
        conds.push(sql`${costRecords.entryKind} <> 'void'`);
        conds.push(
          sql`NOT EXISTS (
            SELECT 1 FROM cost_records r2
            WHERE r2.replaces_record_id = ${costRecords.id}
          )`,
        );
      }

      // orderBy (costDate, id) = thứ tự tất định cho phân trang (costDate trùng → id tie-break).
      return tx
        .select()
        .from(costRecords)
        .where(and(...conds))
        .orderBy(costRecords.costDate, costRecords.id)
        .limit(filter.limit ?? DEFAULT_LIMIT)
        .offset(filter.offset ?? DEFAULT_OFFSET);
    });
  }

  /** Bản ghi theo id trong CÙNG tx (guard thuộc tenant + hợp lệ trước khi adjust/void). null nếu không có. */
  async findByIdTx(tx: TenantTx, companyId: string, id: string) {
    const [row] = await tx
      .select()
      .from(costRecords)
      .where(and(eq(costRecords.companyId, companyId), eq(costRecords.id, id)))
      .limit(1);
    return row ?? null;
  }

  /** INSERT 1 bản ghi (CÙNG tx với audit). KHÔNG update/delete — append-only. */
  async insertTx(tx: TenantTx, data: InsertCostData) {
    const [row] = await tx
      .insert(costRecords)
      .values({
        costType: data.costType,
        amount: data.amount,
        currency: data.currency,
        costDate: data.costDate,
        orgUnitId: data.orgUnitId ?? null,
        teamId: data.teamId ?? null,
        projectId: data.projectId ?? null,
        channelId: data.channelId ?? null,
        contentItemId: data.contentItemId ?? null,
        userId: data.userId ?? null,
        vendorName: data.vendorName ?? null,
        description: data.description ?? null,
        attachmentUrl: data.attachmentUrl ?? null,
        enteredBy: data.enteredBy,
        entryKind: data.entryKind,
        replacesRecordId: data.replacesRecordId ?? null,
        expenseRequestId: data.expenseRequestId ?? null,
      })
      .returning();
    return row;
  }
}
