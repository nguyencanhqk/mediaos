import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../../db/db.service";
import { companies, type Company } from "../../db/schema/companies";

/** Patch nội bộ — chỉ cột hồ sơ EDITABLE (service đã allow-list). KHÔNG gồm id/slug/status/company_id. */
export type CompanyUpdatePatch = Partial<
  Pick<
    typeof companies.$inferInsert,
    | "name"
    | "shortName"
    | "logoUrl"
    | "timezone"
    | "currency"
    | "language"
    | "taxCode"
    | "businessType"
    | "regNumber"
    | "regDate"
    | "regPlace"
    | "legalRepName"
    | "legalRepTitle"
    | "establishedDate"
    | "address"
    | "phone"
    | "fax"
    | "email"
    | "website"
  >
>;

/**
 * S1-FND-MODULE-1 — persistence cho `companies`.
 *
 * BẤT BIẾN #1: MỌI đọc/ghi qua db.withTenant (RLS FORCE keyed app.current_company_id ⇒ chỉ chạm ĐÚNG company
 * của tenant). WHERE id = companyId là phòng-thủ-chiều-sâu (RLS đã cô lập; vẫn ép tường minh để rõ ý + an toàn
 * nếu ai đó nới policy). KHÔNG hard-delete (BẤT BIẾN #2) — repo không có delete.
 */
@Injectable()
export class CompanyRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Company hiện tại của tenant (chưa soft-delete). Trả undefined nếu không thấy (service fail-closed). */
  async findCurrentTx(companyId: string, tx: TenantTx): Promise<Company | undefined> {
    const [row] = await tx
      .select()
      .from(companies)
      .where(and(eq(companies.id, companyId), isNull(companies.deletedAt)))
      .limit(1);
    return row;
  }

  /**
   * UPDATE hồ sơ company (allow-list patch). Set updated_at=now(). WHERE id=companyId + chưa soft-delete.
   * Trả undefined nếu 0 row (vd soft-delete chen ngang) → service fail-closed (KHÔNG NPE/500).
   */
  async updateTx(
    companyId: string,
    patch: CompanyUpdatePatch,
    tx: TenantTx,
  ): Promise<Company | undefined> {
    const [row] = await tx
      .update(companies)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(and(eq(companies.id, companyId), isNull(companies.deletedAt)))
      .returning();
    return row;
  }
}
