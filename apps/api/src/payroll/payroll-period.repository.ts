import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { payrollPeriods, payslips } from "../db/schema";

const COLUMNS = {
  id: payrollPeriods.id,
  companyId: payrollPeriods.companyId,
  periodMonth: payrollPeriods.periodMonth,
  status: payrollPeriods.status,
  attendancePeriodId: payrollPeriods.attendancePeriodId,
  kpiLocked: payrollPeriods.kpiLocked,
  createdBy: payrollPeriods.createdBy,
  approvedBy: payrollPeriods.approvedBy,
  approvedAt: payrollPeriods.approvedAt,
  publishedBy: payrollPeriods.publishedBy,
  publishedAt: payrollPeriods.publishedAt,
  createdAt: payrollPeriods.createdAt,
  updatedAt: payrollPeriods.updatedAt,
} as const;

export interface PayrollPeriodListFilters {
  status?: string;
}

export interface PayrollPeriodInsertData {
  periodMonth: string;
  attendancePeriodId?: string | null;
  createdBy: string;
}

/**
 * PayrollPeriodRepository — MỌI method qua db.withTenant (RLS) + eq(companyId) + isNull(deletedAt).
 * *Tx để service ghép audit trong CÙNG transaction (atomic). KHÔNG raw query, KHÔNG pool direct (BẤT BIẾN #1).
 * Period MUTABLE (vòng duyệt draft→approved→published, G12-4) → có update/soft-delete; trigger DB 0130
 * chỉ cho draft→approved→published, chặn lùi + chặn xoá mềm kỳ non-draft.
 *
 * approve/publish dùng WHERE status='<expected>' (compare-and-set): kỳ đã đổi trạng thái giữa đọc & ghi
 * (đua) ⇒ 0 hàng returning ⇒ service ném 409 (mirror bonus-penalty "no longer draft").
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
        createdBy: data.createdBy,
      })
      .returning(COLUMNS);
  }

  /**
   * Distinct created_by của payslips trong kỳ (= TẬP người chạy lương kỳ này). Dùng cho SoD:
   * người DUYỆT không được nằm trong tập này. Rỗng = kỳ chưa có payslip (service chặn approve kỳ rỗng).
   */
  async listPayslipCreatorsTx(
    tx: TenantTx,
    companyId: string,
    periodId: string,
  ): Promise<string[]> {
    const rows = await tx
      .selectDistinct({ createdBy: payslips.createdBy })
      .from(payslips)
      .where(and(eq(payslips.companyId, companyId), eq(payslips.payrollPeriodId, periodId)));
    return rows.map((r) => r.createdBy);
  }

  /** Approve (draft→approved). Compare-and-set status='draft'. */
  approveTx(tx: TenantTx, companyId: string, id: string, approvedBy: string) {
    const now = new Date();
    return tx
      .update(payrollPeriods)
      .set({ status: "approved", approvedBy, approvedAt: now, updatedAt: now })
      .where(
        and(
          eq(payrollPeriods.companyId, companyId),
          eq(payrollPeriods.id, id),
          eq(payrollPeriods.status, "draft"),
          isNull(payrollPeriods.deletedAt),
        ),
      )
      .returning(COLUMNS);
  }

  /** Publish (approved→published). Compare-and-set status='approved'. */
  publishTx(tx: TenantTx, companyId: string, id: string, publishedBy: string) {
    const now = new Date();
    return tx
      .update(payrollPeriods)
      .set({ status: "published", publishedBy, publishedAt: now, updatedAt: now })
      .where(
        and(
          eq(payrollPeriods.companyId, companyId),
          eq(payrollPeriods.id, id),
          eq(payrollPeriods.status, "approved"),
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
