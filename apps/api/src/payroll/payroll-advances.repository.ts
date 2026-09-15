import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PayrollAdvanceStatus } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { payrollAdvances, type PayrollAdvance } from "../db/schema/payroll-disbursement";

export interface PayrollAdvanceListFilter {
  userId?: string;
  status?: PayrollAdvanceStatus[];
  deductPeriodMonth?: string;
}

/**
 * S15-PAYROLL-BE-4 — `payroll_advances` (DB-13 §14.1 · mig 0572), khuôn `BonusPenaltiesRepository`.
 *
 * FSM `Pending → Approved | Rejected`, `Approved → Deducted` (máy tính lương bind — BE-3), `Deducted → Approved` (nhả khi
 * tính lại). Route ở đây CHỈ chạm `Pending → Approved/Rejected` + sửa/xoá mềm khi `Pending`; bind/nhả là việc của
 * `PayrollCalcRepository` (KHÔNG viết lại — plan §3.2).
 *
 * ⚠️ Trigger `payroll_advance_freeze_guard` ném `23514` KHÔNG tên constraint, message `<trigger>:<tag>:` ⇒ service
 * tiền-kiểm 025/026 dưới `FOR UPDATE`; trigger chỉ còn là chốt cuối cho RACE (map theo TAG ở `mapPayrollPgError`).
 * BẤT BIẾN #1: mọi câu bind `company_id` tường minh; #2: xoá = `deleted_at`.
 */
@Injectable()
export class PayrollAdvancesRepository {
  private static scope(companyId: string) {
    return and(eq(payrollAdvances.companyId, companyId), isNull(payrollAdvances.deletedAt));
  }

  private static filterCond(companyId: string, f: PayrollAdvanceListFilter) {
    const conds = [PayrollAdvancesRepository.scope(companyId)];
    if (f.userId) conds.push(eq(payrollAdvances.userId, f.userId));
    if (f.status?.length) conds.push(inArray(payrollAdvances.status, f.status));
    if (f.deductPeriodMonth) conds.push(eq(payrollAdvances.deductPeriodMonth, f.deductPeriodMonth));
    return and(...conds);
  }

  async listTx(
    tx: TenantTx,
    companyId: string,
    f: PayrollAdvanceListFilter,
    limit: number,
    offset: number,
  ): Promise<PayrollAdvance[]> {
    return tx
      .select()
      .from(payrollAdvances)
      .where(PayrollAdvancesRepository.filterCond(companyId, f))
      .orderBy(desc(payrollAdvances.deductPeriodMonth), desc(payrollAdvances.id))
      .limit(limit)
      .offset(offset);
  }

  async countTx(tx: TenantTx, companyId: string, f: PayrollAdvanceListFilter): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(payrollAdvances)
      .where(PayrollAdvancesRepository.filterCond(companyId, f));
    return Number(row?.n ?? 0);
  }

  async findTx(tx: TenantTx, companyId: string, id: string): Promise<PayrollAdvance | null> {
    const [row] = await tx
      .select()
      .from(payrollAdvances)
      .where(and(PayrollAdvancesRepository.scope(companyId), eq(payrollAdvances.id, id)))
      .limit(1);
    return row ?? null;
  }

  /** Khoá hàng TRƯỚC khi sửa/quyết định — 025 (`status`/`payroll_period_id`) và B2 (`user_id`) đọc DƯỚI lock. */
  async lockForUpdateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<PayrollAdvance | null> {
    const [row] = await tx
      .select()
      .from(payrollAdvances)
      .where(and(PayrollAdvancesRepository.scope(companyId), eq(payrollAdvances.id, id)))
      .limit(1)
      .for("update");
    return row ?? null;
  }

  /**
   * Trạng thái kỳ lương ĐÍCH (`period_month = deduct_period_month`, sống) — `null` khi tháng chưa có kỳ. SELECT thường,
   * KHÔNG khoá: race với `calculate` tệ nhất là khoản không được nhặt lượt này (cảnh báo `unconsumed-advances`), không sai tiền.
   */
  async targetPeriodStatusTx(
    tx: TenantTx,
    companyId: string,
    deductPeriodMonth: string,
  ): Promise<string | null> {
    const res = await tx.execute<{ status: string }>(sql`
      select status
        from payroll_periods
       where company_id = ${companyId}::uuid
         and period_month = ${deductPeriodMonth}
         and deleted_at is null
       limit 1
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return (list as { status: string }[])[0]?.status ?? null;
  }

  /** 060 — `created_by = actor` (từ JWT, KHÔNG từ body — trigger `insert-shape` còn ép NOT NULL). */
  async createTx(
    tx: TenantTx,
    companyId: string,
    input: { userId: string; amount: number; deductPeriodMonth: string; reason: string },
    actorUserId: string,
  ): Promise<PayrollAdvance> {
    const [row] = await tx
      .insert(payrollAdvances)
      .values({
        companyId,
        userId: input.userId,
        // numeric(18,2) — CHUỖI, không để float JS đi vào cột tiền.
        amount: input.amount.toFixed(2),
        deductPeriodMonth: input.deductPeriodMonth,
        reason: input.reason,
        status: "Pending",
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();
    return row;
  }

  /** 062 — sửa nội dung CHỈ khi `Pending` chưa bind (service đã tiền-kiểm dưới lock). KHÔNG chạm status/decided_*. */
  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: { amount?: number; deductPeriodMonth?: string; reason?: string },
    actorUserId: string,
  ): Promise<PayrollAdvance | null> {
    const set: Record<string, unknown> = { updatedBy: actorUserId, updatedAt: new Date() };
    if (patch.amount !== undefined) set["amount"] = patch.amount.toFixed(2);
    if (patch.deductPeriodMonth !== undefined) set["deductPeriodMonth"] = patch.deductPeriodMonth;
    if (patch.reason !== undefined) set["reason"] = patch.reason;
    const [row] = await tx
      .update(payrollAdvances)
      .set(set)
      .where(and(PayrollAdvancesRepository.scope(companyId), eq(payrollAdvances.id, id)))
      .returning();
    return row ?? null;
  }

  /** 063/064 — CHỈ status + decided_by/decided_at + decision_note (nhánh (D) của trigger chặn vừa quyết định vừa sửa tiền). */
  async decideTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    status: "Approved" | "Rejected",
    decisionNote: string | null,
    actorUserId: string,
  ): Promise<PayrollAdvance | null> {
    const [row] = await tx
      .update(payrollAdvances)
      .set({
        status,
        decidedBy: actorUserId,
        decidedAt: new Date(),
        decisionNote,
        updatedBy: actorUserId,
        updatedAt: new Date(),
      })
      .where(and(PayrollAdvancesRepository.scope(companyId), eq(payrollAdvances.id, id)))
      .returning();
    return row ?? null;
  }

  /** Xoá MỀM — không có GRANT DELETE cho app role. */
  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    actorUserId: string,
  ): Promise<PayrollAdvance | null> {
    const [row] = await tx
      .update(payrollAdvances)
      .set({ deletedAt: new Date(), deletedBy: actorUserId, updatedBy: actorUserId })
      .where(and(PayrollAdvancesRepository.scope(companyId), eq(payrollAdvances.id, id)))
      .returning();
    return row ?? null;
  }
}
