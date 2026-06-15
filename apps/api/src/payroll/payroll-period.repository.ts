import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { payrollPeriods } from "../db/schema";

const COLUMNS = {
  id: payrollPeriods.id,
  companyId: payrollPeriods.companyId,
  periodMonth: payrollPeriods.periodMonth,
  status: payrollPeriods.status,
  attendancePeriodId: payrollPeriods.attendancePeriodId,
  kpiLocked: payrollPeriods.kpiLocked,
  lockedBy: payrollPeriods.lockedBy,
  lockedAt: payrollPeriods.lockedAt,
  createdAt: payrollPeriods.createdAt,
  updatedAt: payrollPeriods.updatedAt,
} as const;

export interface PayrollPeriodListFilters {
  status?: string;
}

export interface PayrollPeriodInsertData {
  periodMonth: string;
  attendancePeriodId?: string | null;
}

/**
 * PayrollPeriodRepository — MỌI method qua db.withTenant (RLS) + eq(companyId) + isNull(deletedAt).
 * *Tx để service ghép audit trong CÙNG transaction (atomic). KHÔNG raw query, KHÔNG pool direct (BẤT BIẾN #1).
 * Period MUTABLE (draft→locked) → có update/soft-delete; trigger DB 0094 chặn locked→draft.
 */
@Injectable()
export class PayrollPeriodRepository {
  async listTx(tx: TenantTx, companyId: string, filters: PayrollPeriodListFilters) {
    const conditions = [eq(payrollPeriods.companyId, companyId), isNull(payrollPeriods.deletedAt)];
    if (filters.status) conditions.push(eq(payrollPeriods.status, filters.status));
    return await tx
      .select(COLUMNS)
      .from(payrollPeriods)
      .where(and(...(conditions as [(typeof conditions)[0], ...typeof conditions])))
      .orderBy(payrollPeriods.periodMonth);
  }

  async findByIdTx(tx: TenantTx, companyId: string, id: string) {
    const [row] = await tx
      .select(COLUMNS)
      .from(payrollPeriods)
      .where(
        and(
          eq(payrollPeriods.companyId, companyId),
          eq(payrollPeriods.id, id),
          isNull(payrollPeriods.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  createTx(tx: TenantTx, companyId: string, data: PayrollPeriodInsertData) {
    return tx
      .insert(payrollPeriods)
      .values({
        companyId,
        periodMonth: data.periodMonth,
        attendancePeriodId: data.attendancePeriodId ?? null,
      })
      .returning(COLUMNS);
  }

  /** Lock a period (draft→locked). lockedBy/lockedAt set; status flips. */
  lockTx(tx: TenantTx, companyId: string, id: string, lockedBy: string) {
    return tx
      .update(payrollPeriods)
      .set({ status: "locked", lockedBy, lockedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(payrollPeriods.companyId, companyId),
          eq(payrollPeriods.id, id),
          isNull(payrollPeriods.deletedAt),
        ),
      )
      .returning(COLUMNS);
  }

  softDeleteTx(tx: TenantTx, companyId: string, id: string) {
    return tx
      .update(payrollPeriods)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(payrollPeriods.companyId, companyId),
          eq(payrollPeriods.id, id),
          isNull(payrollPeriods.deletedAt),
        ),
      )
      .returning({ id: payrollPeriods.id });
  }
}
