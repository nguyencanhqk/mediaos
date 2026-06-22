import { Injectable } from "@nestjs/common";
import { and, asc, eq, gte, isNotNull, isNull, lt } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../../db/db.service";
import { publicHolidays } from "../../db/schema/holidays";

/**
 * FOUNDATION-BE-6 — persistence cho public_holidays. company_id NULLABLE: tenant ĐỌC holiday CỦA MÌNH +
 * GLOBAL (company_id IS NULL) — RLS policy (mig 0434) lo cô lập chéo tenant. CHÚ Ý: các đường ĐỌC KHÔNG
 * filter `eq(companyId)` để giữ luôn hàng global; chỉ đường GHI/SỬA/XOÁ mới khoá `eq(companyId)` (chỉ
 * đụng hàng của tenant — app role KHÔNG ghi được global do WITH CHECK; re-home chặn bởi trigger mig 0436).
 */
@Injectable()
export class HolidaysRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Holiday Active, chưa soft-delete trong [from, toExclusive). Trả CẢ company + global (RLS lọc tenant).
   * `companyOnly` → chỉ hàng riêng công ty (bỏ global). Batch 1 query cho cả khoảng (KHÔNG N+1).
   */
  findInRange(
    companyId: string,
    opts: { from: string; toExclusive: string; companyOnly?: boolean },
  ) {
    return this.db.withTenant(companyId, (tx) => {
      const conds = [
        eq(publicHolidays.status, "Active"),
        isNull(publicHolidays.deletedAt),
        gte(publicHolidays.holidayDate, opts.from),
        lt(publicHolidays.holidayDate, opts.toExclusive),
      ];
      if (opts.companyOnly) conds.push(isNotNull(publicHolidays.companyId));
      return tx
        .select()
        .from(publicHolidays)
        .where(and(...conds))
        .orderBy(asc(publicHolidays.holidayDate), asc(publicHolidays.holidayCode));
    });
  }

  /** Một holiday CỦA TENANT theo id (KHÔNG match hàng global — sửa/xoá chỉ trên hàng công ty mình). */
  findOwnByIdTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(publicHolidays)
      .where(
        and(
          eq(publicHolidays.companyId, companyId),
          eq(publicHolidays.id, id),
          isNull(publicHolidays.deletedAt),
        ),
      )
      .limit(1);
  }

  insertTx(companyId: string, data: typeof publicHolidays.$inferInsert, tx: TenantTx) {
    return tx
      .insert(publicHolidays)
      .values({ ...data, companyId })
      .returning();
  }

  updateOwnTx(
    companyId: string,
    id: string,
    data: Partial<typeof publicHolidays.$inferInsert>,
    tx: TenantTx,
  ) {
    return tx
      .update(publicHolidays)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(publicHolidays.companyId, companyId),
          eq(publicHolidays.id, id),
          isNull(publicHolidays.deletedAt),
        ),
      )
      .returning();
  }

  /** Soft-delete (BẤT BIẾN #2 — KHÔNG hard-delete holiday đã dùng tính công/phép, DB-08 §8.10 rule 5). */
  softDeleteOwnTx(companyId: string, id: string, deletedBy: string, tx: TenantTx) {
    return tx
      .update(publicHolidays)
      .set({ deletedAt: new Date(), deletedBy, updatedAt: new Date() })
      .where(
        and(
          eq(publicHolidays.companyId, companyId),
          eq(publicHolidays.id, id),
          isNull(publicHolidays.deletedAt),
        ),
      )
      .returning();
  }
}
