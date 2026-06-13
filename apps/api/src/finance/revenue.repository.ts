import { Injectable } from "@nestjs/common";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { revenueRecords } from "../db/schema";

/**
 * G13-1 — Repository sổ cái doanh thu APPEND-ONLY (BẤT BIẾN #2).
 *
 * KHÔNG có update()/delete() — app role chỉ GRANT SELECT,INSERT (migration 0070). "Sửa/xoá" = ghi
 * bản ghi mới (entry_kind adjustment|void + replaces_record_id). Mọi truy vấn nghiệp vụ đi qua
 * withTenant (RLS ép company_id ở DB). Write methods nhận `tx` để chạy CÙNG transaction với audit.
 */

/** Cột app được phép set khi INSERT (company_id lấy từ DB DEFAULT current_setting). */
export interface InsertRevenueData {
  platformId?: string | null;
  channelId?: string | null;
  projectId?: string | null;
  contentItemId?: string | null;
  amount: string; // numeric → string (Drizzle)
  currency: string;
  revenueDate: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  source: string;
  description?: string | null;
  attachmentUrl?: string | null;
  enteredBy: string;
  entryKind: "original" | "adjustment" | "void";
  replacesRecordId?: string | null;
}

export interface ListRevenueFilter {
  platformId?: string;
  channelId?: string;
  projectId?: string;
  contentItemId?: string;
  source?: string;
  from?: string;
  to?: string;
  /** true = trả cả bản ghi đã bị thay thế/void (xem lịch sử chain). Mặc định chỉ bản hiệu lực. */
  includeSuperseded?: boolean;
}

@Injectable()
export class RevenueRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Liệt kê revenue của tenant (RLS lọc company_id). Mặc định chỉ bản HIỆU LỰC:
   *   entry_kind != 'void' AND chưa bị bản ghi khác thay thế (replaces_record_id trỏ tới nó).
   */
  list(companyId: string, filter: ListRevenueFilter = {}) {
    return this.db.withTenant(companyId, async (tx) => {
      const conds = [eq(revenueRecords.companyId, companyId)];
      if (filter.platformId) conds.push(eq(revenueRecords.platformId, filter.platformId));
      if (filter.channelId) conds.push(eq(revenueRecords.channelId, filter.channelId));
      if (filter.projectId) conds.push(eq(revenueRecords.projectId, filter.projectId));
      if (filter.contentItemId) conds.push(eq(revenueRecords.contentItemId, filter.contentItemId));
      if (filter.source) conds.push(eq(revenueRecords.source, filter.source));
      if (filter.from) conds.push(gte(revenueRecords.revenueDate, filter.from));
      if (filter.to) conds.push(lte(revenueRecords.revenueDate, filter.to));

      if (!filter.includeSuperseded) {
        // hiệu lực: không phải void + KHÔNG có bản ghi nào thay thế nó.
        conds.push(sql`${revenueRecords.entryKind} <> 'void'`);
        conds.push(
          sql`NOT EXISTS (
            SELECT 1 FROM revenue_records r2
            WHERE r2.replaces_record_id = ${revenueRecords.id}
          )`,
        );
      }

      return tx
        .select()
        .from(revenueRecords)
        .where(and(...conds))
        .orderBy(revenueRecords.revenueDate);
    });
  }

  /** Bản ghi theo id trong CÙNG tx (guard thuộc tenant + hợp lệ trước khi adjust/void). null nếu không có. */
  async findByIdTx(tx: TenantTx, companyId: string, id: string) {
    const [row] = await tx
      .select()
      .from(revenueRecords)
      .where(and(eq(revenueRecords.companyId, companyId), eq(revenueRecords.id, id)))
      .limit(1);
    return row ?? null;
  }

  /** INSERT 1 bản ghi (CÙNG tx với audit). KHÔNG update/delete — append-only. */
  async insertTx(tx: TenantTx, data: InsertRevenueData) {
    const [row] = await tx
      .insert(revenueRecords)
      .values({
        platformId: data.platformId ?? null,
        channelId: data.channelId ?? null,
        projectId: data.projectId ?? null,
        contentItemId: data.contentItemId ?? null,
        amount: data.amount,
        currency: data.currency,
        revenueDate: data.revenueDate,
        periodStart: data.periodStart ?? null,
        periodEnd: data.periodEnd ?? null,
        source: data.source,
        description: data.description ?? null,
        attachmentUrl: data.attachmentUrl ?? null,
        enteredBy: data.enteredBy,
        entryKind: data.entryKind,
        replacesRecordId: data.replacesRecordId ?? null,
      })
      .returning();
    return row;
  }
}
