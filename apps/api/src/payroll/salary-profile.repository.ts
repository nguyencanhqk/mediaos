import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { salaryProfiles } from "../db/schema";

/** Columns returned by the list projection (includes sensitive baseSalary/allowances — service masks). */
const LIST_COLUMNS = {
  id: salaryProfiles.id,
  userId: salaryProfiles.userId,
  salaryType: salaryProfiles.salaryType,
  payCycle: salaryProfiles.payCycle,
  effectiveDate: salaryProfiles.effectiveDate,
  baseSalary: salaryProfiles.baseSalary,
  allowances: salaryProfiles.allowances,
  status: salaryProfiles.status,
} as const;

/** Columns returned by the detail projection. */
const DETAIL_COLUMNS = {
  id: salaryProfiles.id,
  companyId: salaryProfiles.companyId,
  userId: salaryProfiles.userId,
  salaryType: salaryProfiles.salaryType,
  payCycle: salaryProfiles.payCycle,
  effectiveDate: salaryProfiles.effectiveDate,
  baseSalary: salaryProfiles.baseSalary,
  allowances: salaryProfiles.allowances,
  currency: salaryProfiles.currency,
  status: salaryProfiles.status,
  note: salaryProfiles.note,
  createdAt: salaryProfiles.createdAt,
  updatedAt: salaryProfiles.updatedAt,
} as const;

export interface SalaryProfileListFilters {
  userId?: string;
  status?: string;
}

export interface SalaryProfileInsertData {
  userId: string;
  salaryType: string;
  payCycle: string;
  effectiveDate: string;
  baseSalary: string;
  allowances: unknown;
  currency?: string;
  note?: string | null;
}

export type SalaryProfileUpdateData = Partial<{
  salaryType: string;
  payCycle: string;
  effectiveDate: string;
  baseSalary: string;
  allowances: unknown;
  currency: string;
  status: string;
  note: string | null;
}>;

/**
 * SalaryProfileRepository — MỌI method qua db.withTenant (RLS) + eq(companyId) + isNull(deletedAt).
 * Insert/update/soft-delete dạng *Tx để service ghép audit trong CÙNG transaction (reveal⟹audit atomic).
 * KHÔNG raw query, KHÔNG pool direct (BẤT BIẾN #1).
 */
@Injectable()
export class SalaryProfileRepository {
  constructor(private readonly db: DatabaseService) {}

  async listTx(tx: TenantTx, companyId: string, filters: SalaryProfileListFilters) {
    const conditions = [eq(salaryProfiles.companyId, companyId), isNull(salaryProfiles.deletedAt)];
    if (filters.userId) conditions.push(eq(salaryProfiles.userId, filters.userId));
    if (filters.status) conditions.push(eq(salaryProfiles.status, filters.status));

    return await tx
      .select(LIST_COLUMNS)
      .from(salaryProfiles)
      .where(and(...(conditions as [(typeof conditions)[0], ...typeof conditions])))
      .orderBy(salaryProfiles.effectiveDate);
  }

  async findByIdTx(tx: TenantTx, companyId: string, id: string) {
    const [row] = await tx
      .select(DETAIL_COLUMNS)
      .from(salaryProfiles)
      .where(
        and(
          eq(salaryProfiles.companyId, companyId),
          eq(salaryProfiles.id, id),
          isNull(salaryProfiles.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  createTx(tx: TenantTx, companyId: string, data: SalaryProfileInsertData) {
    return tx
      .insert(salaryProfiles)
      .values({ companyId, ...data })
      .returning(DETAIL_COLUMNS);
  }

  updateTx(tx: TenantTx, companyId: string, id: string, data: SalaryProfileUpdateData) {
    return tx
      .update(salaryProfiles)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(salaryProfiles.companyId, companyId),
          eq(salaryProfiles.id, id),
          isNull(salaryProfiles.deletedAt),
        ),
      )
      .returning(DETAIL_COLUMNS);
  }

  softDeleteTx(tx: TenantTx, companyId: string, id: string) {
    return tx
      .update(salaryProfiles)
      .set({ deletedAt: new Date(), status: "inactive", updatedAt: new Date() })
      .where(
        and(
          eq(salaryProfiles.companyId, companyId),
          eq(salaryProfiles.id, id),
          isNull(salaryProfiles.deletedAt),
        ),
      )
      .returning({ id: salaryProfiles.id });
  }
}
