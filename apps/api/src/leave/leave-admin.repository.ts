import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { leaveBalances, leaveTypes } from "../db/schema/hr";
import { leaveBalanceTransactions, leavePolicies } from "../db/schema/leave";
import { users } from "../db/schema/users";

/**
 * S3-LEAVE-BE-4 — persistence for the LEAVE admin surface (type/policy CRUD + HR balance view/adjust
 * ledger). Every method takes the caller's `tx` so the SERVICE owns withTenant (RLS + explicit
 * company_id, BẤT BIẾN #1).
 *
 * BẤT BIẾN #2: leave_balance_transactions = INSERT ONLY (append-only ledger, mig 0453 GRANT
 * SELECT,INSERT). No update/delete method for it here.
 */
@Injectable()
export class LeaveAdminRepository {
  // ─── leave_types (admin CRUD — create/update/delete:leave-type) ──────────────

  createTypeTx(companyId: string, data: typeof leaveTypes.$inferInsert, tx: TenantTx) {
    return tx
      .insert(leaveTypes)
      .values({ ...data, companyId })
      .returning();
  }

  findTypeByIdTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(leaveTypes)
      .where(
        and(
          eq(leaveTypes.companyId, companyId),
          eq(leaveTypes.id, id),
          isNull(leaveTypes.deletedAt),
        ),
      )
      .limit(1);
  }

  updateTypeTx(
    companyId: string,
    id: string,
    data: Partial<typeof leaveTypes.$inferInsert>,
    tx: TenantTx,
  ) {
    return tx
      .update(leaveTypes)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(leaveTypes.companyId, companyId),
          eq(leaveTypes.id, id),
          isNull(leaveTypes.deletedAt),
        ),
      )
      .returning();
  }

  /** Soft-delete (deleted_at + deleted_by) — KHÔNG hard-delete (BẤT BIẾN #2). */
  softDeleteTypeTx(companyId: string, id: string, actorId: string, tx: TenantTx) {
    return tx
      .update(leaveTypes)
      .set({ deletedAt: new Date(), deletedBy: actorId, updatedAt: new Date() })
      .where(
        and(
          eq(leaveTypes.companyId, companyId),
          eq(leaveTypes.id, id),
          isNull(leaveTypes.deletedAt),
        ),
      )
      .returning();
  }

  // ─── leave_policies (admin CRUD — create/update/delete:leave-policy) ─────────

  listPoliciesTx(
    companyId: string,
    filters: { leaveTypeId?: string; policyScope?: string; status?: string },
    tx: TenantTx,
  ) {
    const conds = [eq(leavePolicies.companyId, companyId), isNull(leavePolicies.deletedAt)];
    if (filters.leaveTypeId) conds.push(eq(leavePolicies.leaveTypeId, filters.leaveTypeId));
    if (filters.policyScope) conds.push(eq(leavePolicies.policyScope, filters.policyScope));
    if (filters.status) conds.push(eq(leavePolicies.status, filters.status));
    return tx
      .select({
        id: leavePolicies.id,
        leaveTypeId: leavePolicies.leaveTypeId,
        leaveTypeCode: leaveTypes.code,
        leaveTypeName: leaveTypes.name,
        policyCode: leavePolicies.policyCode,
        name: leavePolicies.name,
        description: leavePolicies.description,
        policyScope: leavePolicies.policyScope,
        departmentId: leavePolicies.departmentId,
        employeeId: leavePolicies.employeeId,
        jobLevelId: leavePolicies.jobLevelId,
        contractTypeId: leavePolicies.contractTypeId,
        yearlyQuotaDays: leavePolicies.yearlyQuotaDays,
        yearlyQuotaHours: leavePolicies.yearlyQuotaHours,
        accrualMethod: leavePolicies.accrualMethod,
        reserveBalanceOnPending: leavePolicies.reserveBalanceOnPending,
        allowNegativeBalance: leavePolicies.allowNegativeBalance,
        maxNegativeDays: leavePolicies.maxNegativeDays,
        requiresManagerApproval: leavePolicies.requiresManagerApproval,
        requiresHrApproval: leavePolicies.requiresHrApproval,
        effectiveFrom: leavePolicies.effectiveFrom,
        effectiveTo: leavePolicies.effectiveTo,
        priority: leavePolicies.priority,
        status: leavePolicies.status,
      })
      .from(leavePolicies)
      .innerJoin(leaveTypes, eq(leavePolicies.leaveTypeId, leaveTypes.id))
      .where(and(...conds))
      .orderBy(desc(leavePolicies.priority), asc(leavePolicies.name));
  }

  findPolicyByIdTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(leavePolicies)
      .where(
        and(
          eq(leavePolicies.companyId, companyId),
          eq(leavePolicies.id, id),
          isNull(leavePolicies.deletedAt),
        ),
      )
      .limit(1);
  }

  /** leave_type must exist (not soft-deleted) — insert would otherwise 500 on the FK. Checked by service. */
  createPolicyTx(companyId: string, data: typeof leavePolicies.$inferInsert, tx: TenantTx) {
    return tx
      .insert(leavePolicies)
      .values({ ...data, companyId })
      .returning();
  }

  updatePolicyTx(
    companyId: string,
    id: string,
    data: Partial<typeof leavePolicies.$inferInsert>,
    tx: TenantTx,
  ) {
    return tx
      .update(leavePolicies)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(leavePolicies.companyId, companyId),
          eq(leavePolicies.id, id),
          isNull(leavePolicies.deletedAt),
        ),
      )
      .returning();
  }

  softDeletePolicyTx(companyId: string, id: string, actorId: string, tx: TenantTx) {
    return tx
      .update(leavePolicies)
      .set({ deletedAt: new Date(), deletedBy: actorId, updatedAt: new Date() })
      .where(
        and(
          eq(leavePolicies.companyId, companyId),
          eq(leavePolicies.id, id),
          isNull(leavePolicies.deletedAt),
        ),
      )
      .returning();
  }

  // ─── leave_balances (HR view — Company scope) ─────────────────────────────────

  listBalancesTx(
    companyId: string,
    filters: { id?: string; employeeId?: string; leaveTypeId?: string; year?: number },
    tx: TenantTx,
  ) {
    const conds = [eq(leaveBalances.companyId, companyId), isNull(leaveBalances.deletedAt)];
    if (filters.id) conds.push(eq(leaveBalances.id, filters.id));
    if (filters.employeeId) conds.push(eq(leaveBalances.employeeId, filters.employeeId));
    if (filters.leaveTypeId) conds.push(eq(leaveBalances.leaveTypeId, filters.leaveTypeId));
    if (filters.year) conds.push(eq(leaveBalances.year, filters.year));
    return tx
      .select({
        id: leaveBalances.id,
        employeeId: leaveBalances.employeeId,
        userId: leaveBalances.userId,
        userFullName: users.fullName,
        leaveTypeId: leaveBalances.leaveTypeId,
        leaveTypeCode: leaveTypes.code,
        leaveTypeName: leaveTypes.name,
        year: leaveBalances.year,
        totalDays: leaveBalances.totalDays,
        usedDays: leaveBalances.usedDays,
        pendingDays: leaveBalances.pendingDays,
        adjustedDays: leaveBalances.adjustedDays,
        remainingDays: leaveBalances.remainingDays,
        allowNegativeBalance: leaveTypes.allowNegativeBalance,
      })
      .from(leaveBalances)
      .innerJoin(users, eq(leaveBalances.userId, users.id))
      .innerJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
      .where(and(...conds))
      .orderBy(desc(leaveBalances.year), asc(users.fullName));
  }

  /** Plain existence check (no lock) — used by read-only endpoints (view-transaction). */
  findBalanceByIdTx(companyId: string, balanceId: string, tx: TenantTx) {
    return tx
      .select({ id: leaveBalances.id })
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.companyId, companyId),
          eq(leaveBalances.id, balanceId),
          isNull(leaveBalances.deletedAt),
        ),
      )
      .limit(1);
  }

  /** Row-lock (FOR UPDATE) — serializes concurrent adjusts on the SAME balance (chống race âm số dư). */
  findBalanceForUpdateTx(companyId: string, balanceId: string, tx: TenantTx) {
    return tx
      .select({
        id: leaveBalances.id,
        employeeId: leaveBalances.employeeId,
        userId: leaveBalances.userId,
        leaveTypeId: leaveBalances.leaveTypeId,
        year: leaveBalances.year,
        totalDays: leaveBalances.totalDays,
        usedDays: leaveBalances.usedDays,
        pendingDays: leaveBalances.pendingDays,
        adjustedDays: leaveBalances.adjustedDays,
      })
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.companyId, companyId),
          eq(leaveBalances.id, balanceId),
          isNull(leaveBalances.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
  }

  /** allow_negative_balance flag on the balance's leave_type (adjust guard). */
  findTypeAllowNegativeTx(companyId: string, leaveTypeId: string, tx: TenantTx) {
    return tx
      .select({ allowNegativeBalance: leaveTypes.allowNegativeBalance })
      .from(leaveTypes)
      .where(and(eq(leaveTypes.companyId, companyId), eq(leaveTypes.id, leaveTypeId)))
      .limit(1);
  }

  /**
   * Apply `amountDays` (can be negative) to total_days + adjusted_days atomically. WHERE guard blocks the
   * write when it would push (total_days + amountDays) below used_days+pending_days UNLESS `allowNegative`
   * is true — race-safe (2 concurrent adjusts can't both push the balance negative past the guard).
   */
  applyAdjustmentTx(
    companyId: string,
    balanceId: string,
    amountDays: string,
    allowNegative: boolean,
    tx: TenantTx,
  ) {
    const guard = allowNegative
      ? sql`true`
      : sql`(${leaveBalances.totalDays} + ${amountDays}::numeric) >= (COALESCE(${leaveBalances.usedDays},0) + COALESCE(${leaveBalances.pendingDays},0))`;
    return tx
      .update(leaveBalances)
      .set({
        totalDays: sql`${leaveBalances.totalDays} + ${amountDays}::numeric`,
        adjustedDays: sql`COALESCE(${leaveBalances.adjustedDays}, 0) + ${amountDays}::numeric`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leaveBalances.companyId, companyId),
          eq(leaveBalances.id, balanceId),
          isNull(leaveBalances.deletedAt),
          guard,
        ),
      )
      .returning();
  }

  insertBalanceTransactionTx(
    companyId: string,
    data: typeof leaveBalanceTransactions.$inferInsert,
    tx: TenantTx,
  ) {
    return tx
      .insert(leaveBalanceTransactions)
      .values({ ...data, companyId })
      .returning();
  }

  listBalanceTransactionsTx(companyId: string, leaveBalanceId: string, tx: TenantTx) {
    return tx
      .select()
      .from(leaveBalanceTransactions)
      .where(
        and(
          eq(leaveBalanceTransactions.companyId, companyId),
          eq(leaveBalanceTransactions.leaveBalanceId, leaveBalanceId),
        ),
      )
      .orderBy(desc(leaveBalanceTransactions.createdAt));
  }

  /** Resolve employee_profiles row (org scope info not needed here — Company-only admin surface). */
  findEmployeeByIdTx(companyId: string, employeeId: string, tx: TenantTx) {
    return tx
      .select({ id: employeeProfiles.id, userId: employeeProfiles.userId })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.id, employeeId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
  }
}
