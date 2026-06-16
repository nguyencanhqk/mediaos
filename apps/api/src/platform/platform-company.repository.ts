import { Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { companies } from "../db/schema";

export interface ListCompaniesFilter {
  status?: string;
  search?: string;
  limit: number;
  offset: number;
}

/**
 * PlatformCompanyRepository (G16-3) — data-access `companies` ở tầng platform.
 * - list/count chạy trong withPlatformContext (RLS escape-hatch `app.platform_admin='on'` cho thấy chéo tenant).
 * - get/insert/update chạy trong withTenant(targetId) (policy `id = current` khớp khi current = target).
 */
@Injectable()
export class PlatformCompanyRepository {
  private listWhere(filter: ListCompaniesFilter) {
    const conds = [isNull(companies.deletedAt)];
    if (filter.status) conds.push(eq(companies.status, filter.status));
    if (filter.search) {
      const like = `%${filter.search}%`;
      const m = or(ilike(companies.name, like), ilike(companies.slug, like));
      if (m) conds.push(m);
    }
    return and(...conds);
  }

  async listAll(
    tx: TenantTx,
    filter: ListCompaniesFilter,
  ): Promise<(typeof companies.$inferSelect)[]> {
    return tx
      .select()
      .from(companies)
      .where(this.listWhere(filter))
      .orderBy(desc(companies.createdAt))
      .limit(filter.limit)
      .offset(filter.offset);
  }

  async countAll(tx: TenantTx, filter: ListCompaniesFilter): Promise<number> {
    const [row] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(companies)
      .where(this.listWhere(filter));
    return row?.value ?? 0;
  }

  async findById(
    tx: TenantTx,
    id: string,
  ): Promise<typeof companies.$inferSelect | undefined> {
    const [row] = await tx
      .select()
      .from(companies)
      .where(and(eq(companies.id, id), isNull(companies.deletedAt)))
      .limit(1);
    return row;
  }

  async insertCompany(
    tx: TenantTx,
    data: {
      id: string;
      name: string;
      slug: string;
      status: string;
      timezone?: string;
      currency?: string;
      language?: string;
    },
  ): Promise<typeof companies.$inferSelect> {
    const [row] = await tx
      .insert(companies)
      .values({
        id: data.id,
        name: data.name,
        slug: data.slug,
        status: data.status,
        ...(data.timezone ? { timezone: data.timezone } : {}),
        ...(data.currency ? { currency: data.currency } : {}),
        ...(data.language ? { language: data.language } : {}),
      })
      .returning();
    if (!row) throw new Error("insertCompany returned no row");
    return row;
  }

  async updateStatus(tx: TenantTx, id: string, status: string): Promise<void> {
    await tx
      .update(companies)
      .set({ status, updatedAt: new Date() })
      .where(eq(companies.id, id));
  }

  async updateFields(
    tx: TenantTx,
    id: string,
    fields: {
      name?: string;
      timezone?: string;
      currency?: string;
      language?: string;
      logoUrl?: string | null;
    },
  ): Promise<void> {
    await tx
      .update(companies)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(companies.id, id));
  }
}
