import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { bonusPenalties, defects, kpiResults, tasks, users } from "../db/schema";
import type { BonusReferenceType } from "@mediaos/contracts";

/** Trần bảo vệ list (tránh quét không giới hạn). Pagination đầy đủ = G12-4 nếu cần. */
const LIST_CAP = 500;

const BONUS_PENALTY_COLUMNS = {
  id: bonusPenalties.id,
  companyId: bonusPenalties.companyId,
  userId: bonusPenalties.userId,
  kind: bonusPenalties.kind,
  amount: bonusPenalties.amount,
  currency: bonusPenalties.currency,
  periodMonth: bonusPenalties.periodMonth,
  reason: bonusPenalties.reason,
  source: bonusPenalties.source,
  referenceType: bonusPenalties.referenceType,
  taskId: bonusPenalties.taskId,
  defectId: bonusPenalties.defectId,
  kpiResultId: bonusPenalties.kpiResultId,
  status: bonusPenalties.status,
  approvedBy: bonusPenalties.approvedBy,
  approvedAt: bonusPenalties.approvedAt,
  payrollPeriodId: bonusPenalties.payrollPeriodId,
  consumedAt: bonusPenalties.consumedAt,
  createdBy: bonusPenalties.createdBy,
  createdAt: bonusPenalties.createdAt,
  updatedAt: bonusPenalties.updatedAt,
} as const;

export interface BonusPenaltyListFilters {
  userId?: string;
  status?: string;
  periodMonth?: string;
  kind?: string;
}

export interface BonusPenaltyInsertData {
  userId: string;
  kind: string;
  amount: string;
  currency: string;
  periodMonth: string;
  reason: string | null;
  source: string;
  referenceType: string | null;
  taskId: string | null;
  defectId: string | null;
  kpiResultId: string | null;
  createdBy: string;
}

/** Một khoản approved chưa consume — feed cho payslip snapshot. */
export interface ApprovedBonusPenaltyRow {
  id: string;
  kind: string;
  amount: string;
  reason: string | null;
}

/**
 * BonusPenaltyRepository — MUTABLE draft→approved/rejected. MỌI query qua tx (RLS) + eq(companyId).
 * FSM ép cả ở WHERE (status='draft' guard) lẫn trigger DB (0098) — belt & suspenders.
 * Reference existence check (cùng tenant) tách riêng vì FK KHÔNG ép cùng-tenant.
 */
@Injectable()
export class BonusPenaltyRepository {
  createTx(tx: TenantTx, companyId: string, data: BonusPenaltyInsertData) {
    return tx
      .insert(bonusPenalties)
      .values({
        companyId,
        userId: data.userId,
        kind: data.kind,
        amount: data.amount,
        currency: data.currency,
        periodMonth: data.periodMonth,
        reason: data.reason,
        source: data.source,
        referenceType: data.referenceType,
        taskId: data.taskId,
        defectId: data.defectId,
        kpiResultId: data.kpiResultId,
        createdBy: data.createdBy,
      })
      .returning(BONUS_PENALTY_COLUMNS);
  }

  async listTx(tx: TenantTx, companyId: string, filters: BonusPenaltyListFilters) {
    const conditions = [eq(bonusPenalties.companyId, companyId), isNull(bonusPenalties.deletedAt)];
    if (filters.userId) conditions.push(eq(bonusPenalties.userId, filters.userId));
    if (filters.status) conditions.push(eq(bonusPenalties.status, filters.status));
    if (filters.periodMonth) conditions.push(eq(bonusPenalties.periodMonth, filters.periodMonth));
    if (filters.kind) conditions.push(eq(bonusPenalties.kind, filters.kind));
    return await tx
      .select(BONUS_PENALTY_COLUMNS)
      .from(bonusPenalties)
      .where(and(...(conditions as [(typeof conditions)[0], ...typeof conditions])))
      .orderBy(desc(bonusPenalties.createdAt))
      .limit(LIST_CAP);
  }

  async findByIdTx(tx: TenantTx, companyId: string, id: string) {
    const [row] = await tx
      .select(BONUS_PENALTY_COLUMNS)
      .from(bonusPenalties)
      .where(
        and(
          eq(bonusPenalties.companyId, companyId),
          eq(bonusPenalties.id, id),
          isNull(bonusPenalties.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  /** Duyệt — CHỈ khi đang draft (FSM). Trả về hàng đã cập nhật (rỗng nếu không khớp draft). */
  approveTx(tx: TenantTx, companyId: string, id: string, approvedBy: string) {
    return tx
      .update(bonusPenalties)
      .set({ status: "approved", approvedBy, approvedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(bonusPenalties.companyId, companyId),
          eq(bonusPenalties.id, id),
          eq(bonusPenalties.status, "draft"),
          isNull(bonusPenalties.deletedAt),
        ),
      )
      .returning(BONUS_PENALTY_COLUMNS);
  }

  /** Từ chối — CHỈ khi đang draft. reason ghi đè nếu có (lưu vết lý do từ chối). */
  rejectTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    approvedBy: string,
    reason: string | undefined,
  ) {
    return tx
      .update(bonusPenalties)
      .set({
        status: "rejected",
        approvedBy,
        approvedAt: sql`now()`,
        updatedAt: sql`now()`,
        ...(reason !== undefined ? { reason } : {}),
      })
      .where(
        and(
          eq(bonusPenalties.companyId, companyId),
          eq(bonusPenalties.id, id),
          eq(bonusPenalties.status, "draft"),
          isNull(bonusPenalties.deletedAt),
        ),
      )
      .returning(BONUS_PENALTY_COLUMNS);
  }

  /** Xoá mềm — CHỈ khi đang draft (đã duyệt/từ chối = bất biến). */
  softDeleteTx(tx: TenantTx, companyId: string, id: string) {
    return tx
      .update(bonusPenalties)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(bonusPenalties.companyId, companyId),
          eq(bonusPenalties.id, id),
          eq(bonusPenalties.status, "draft"),
          isNull(bonusPenalties.deletedAt),
        ),
      )
      .returning({ id: bonusPenalties.id });
  }

  /**
   * user_id (người nhận thưởng/phạt) có thuộc CÙNG tenant không? FK users(id) KHÔNG ép cùng-tenant
   * (RLS scope hàng bonus về tenant người tạo, nhưng payee có thể là user tenant khác) → check tay.
   */
  async userBelongsToCompanyTx(tx: TenantTx, companyId: string, userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.id, userId)))
      .limit(1);
    return Boolean(row);
  }

  /**
   * Referent (task/defect/kpi_result) có tồn tại trong CÙNG tenant không? FK KHÔNG ép cùng-tenant
   * (referent có thể thuộc tenant khác) → check tay TRƯỚC khi insert. Trả về true nếu hợp lệ.
   */
  async referenceExistsTx(
    tx: TenantTx,
    companyId: string,
    refType: BonusReferenceType,
    refId: string,
  ): Promise<boolean> {
    if (refType === "task") {
      const [row] = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.companyId, companyId), eq(tasks.id, refId)))
        .limit(1);
      return Boolean(row);
    }
    if (refType === "defect") {
      const [row] = await tx
        .select({ id: defects.id })
        .from(defects)
        .where(and(eq(defects.companyId, companyId), eq(defects.id, refId)))
        .limit(1);
      return Boolean(row);
    }
    const [row] = await tx
      .select({ id: kpiResults.id })
      .from(kpiResults)
      .where(and(eq(kpiResults.companyId, companyId), eq(kpiResults.id, refId)))
      .limit(1);
    return Boolean(row);
  }

  /**
   * Gộp các khoản APPROVED, đúng period_month, CHƯA consume (payroll_period_id IS NULL) cho 1 user.
   * Feed read cho payslip snapshot (runPayroll). Cùng tenant qua tx.
   */
  async aggregateApprovedForPeriodTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    periodMonth: string,
  ): Promise<ApprovedBonusPenaltyRow[]> {
    // FOR UPDATE: khoá bi quan các hàng sẽ consume → runPayroll song song cùng kỳ bị tuần tự hoá ở đây
    // (txn thứ 2 chờ txn 1 commit rồi đọc lại payroll_period_id đã set ⇒ không gộp lại) — chống trả 2 lần.
    return await tx
      .select({
        id: bonusPenalties.id,
        kind: bonusPenalties.kind,
        amount: bonusPenalties.amount,
        reason: bonusPenalties.reason,
      })
      .from(bonusPenalties)
      .where(
        and(
          eq(bonusPenalties.companyId, companyId),
          eq(bonusPenalties.userId, userId),
          eq(bonusPenalties.periodMonth, periodMonth),
          eq(bonusPenalties.status, "approved"),
          isNull(bonusPenalties.deletedAt),
          isNull(bonusPenalties.payrollPeriodId),
        ),
      )
      .for("update");
  }

  /**
   * Đánh dấu đã consume (bind kỳ lương) — chống trả 2 lần. CHỈ hàng chưa consume (payroll_period_id IS NULL).
   * Trigger 0098 cho phép NULL→set ngay cả trên hàng approved (đây là bind hệ thống, không sửa tiền).
   */
  markConsumedTx(tx: TenantTx, companyId: string, ids: string[], payrollPeriodId: string) {
    return tx
      .update(bonusPenalties)
      .set({ payrollPeriodId, consumedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(bonusPenalties.companyId, companyId),
          inArray(bonusPenalties.id, ids),
          eq(bonusPenalties.status, "approved"), // CHỈ consume hàng approved (lớp 2 sau aggregate + DB CHECK)
          isNull(bonusPenalties.payrollPeriodId),
        ),
      )
      .returning({ id: bonusPenalties.id });
  }
}
