import { Injectable } from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { leaveBalances, leaveTypes } from "../db/schema/hr";

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
}
