import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { leaveBalances, leaveTypes } from "../db/schema/hr";
import { leaveBalanceTransactions } from "../db/schema/leave";

/**
 * S3-LEAVE-BE-1 — read-only persistence for the richer LEAVE views (types catalog + own balances).
 * Every method takes the caller's `tx` so the SERVICE owns withTenant (RLS + explicit company_id).
 * No writes here (BE-1 is read/preview-only).
 */
@Injectable()
export class LeaveReadRepository {
  /** Active leave types (status='active' AND not soft-deleted), ordered by sortOrder then name. */
  findActiveTypesTx(companyId: string, tx: TenantTx) {
    return tx
      .select()
      .from(leaveTypes)
      .where(
        and(
          eq(leaveTypes.companyId, companyId),
          eq(leaveTypes.status, "active"),
          isNull(leaveTypes.deletedAt),
        ),
      )
      .orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name));
  }

  /**
   * Balances for ONE user (own), joined to leave_types for code/name/unit. Pinned to user_id (the
   * controller's view-own gate is the authz; the row filter keeps it self-only — never a scope query).
   */
  findOwnBalancesTx(companyId: string, userId: string, tx: TenantTx) {
    return tx
      .select({
        id: leaveBalances.id,
        leaveTypeId: leaveBalances.leaveTypeId,
        leaveTypeCode: leaveTypes.code,
        leaveTypeName: leaveTypes.name,
        balanceUnit: leaveTypes.balanceUnit,
        year: leaveBalances.year,
        openingDays: leaveBalances.openingDays,
        usedDays: leaveBalances.usedDays,
        pendingDays: leaveBalances.pendingDays,
        adjustedDays: leaveBalances.adjustedDays,
        remainingDays: leaveBalances.remainingDays,
        totalDays: leaveBalances.totalDays,
      })
      .from(leaveBalances)
      .innerJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
      .where(and(eq(leaveBalances.companyId, companyId), eq(leaveBalances.userId, userId)))
      .orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name));
  }

  /**
   * S3-LEAVE-BE-6 — OWN balance transactions (API-05 §13.2 GET /leave/me/balance-transactions,
   * view-own:leave-balance, Own). Self-locked via leave_balances.user_id (mirrors findOwnBalancesTx) —
   * NOT a scope query, NEVER cross-employee. periodYear filters on the OWNING balance's year (leave_
   * balances.year), leaveTypeId filters the ledger row itself.
   */
  findOwnBalanceTransactionsTx(
    companyId: string,
    userId: string,
    filters: { periodYear?: number; leaveTypeId?: string },
    page: number,
    pageSize: number,
    tx: TenantTx,
  ) {
    const where = this.buildOwnTxWhere(companyId, userId, filters);
    return tx
      .select({
        id: leaveBalanceTransactions.id,
        transactionType: leaveBalanceTransactions.transactionType,
        transactionDate: leaveBalanceTransactions.transactionDate,
        amountDays: leaveBalanceTransactions.amountDays,
        balanceBeforeDays: leaveBalanceTransactions.balanceBeforeDays,
        balanceAfterDays: leaveBalanceTransactions.balanceAfterDays,
        reason: leaveBalanceTransactions.reason,
        createdByType: leaveBalanceTransactions.createdByType,
        createdBy: leaveBalanceTransactions.createdBy,
        createdAt: leaveBalanceTransactions.createdAt,
      })
      .from(leaveBalanceTransactions)
      .innerJoin(leaveBalances, eq(leaveBalanceTransactions.leaveBalanceId, leaveBalances.id))
      .where(where)
      .orderBy(
        desc(leaveBalanceTransactions.transactionDate),
        desc(leaveBalanceTransactions.createdAt),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  }

  /** Total row count for the SAME filter as findOwnBalanceTransactionsTx (pagination meta). */
  async countOwnBalanceTransactionsTx(
    companyId: string,
    userId: string,
    filters: { periodYear?: number; leaveTypeId?: string },
    tx: TenantTx,
  ): Promise<number> {
    const where = this.buildOwnTxWhere(companyId, userId, filters);
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(leaveBalanceTransactions)
      .innerJoin(leaveBalances, eq(leaveBalanceTransactions.leaveBalanceId, leaveBalances.id))
      .where(where);
    return row?.n ?? 0;
  }

  private buildOwnTxWhere(
    companyId: string,
    userId: string,
    filters: { periodYear?: number; leaveTypeId?: string },
  ): SQL {
    const conds: SQL[] = [
      eq(leaveBalanceTransactions.companyId, companyId),
      eq(leaveBalances.userId, userId),
    ];
    if (filters.periodYear) conds.push(eq(leaveBalances.year, filters.periodYear));
    if (filters.leaveTypeId)
      conds.push(eq(leaveBalanceTransactions.leaveTypeId, filters.leaveTypeId));
    return and(...conds)!;
  }
}
