import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { leaveBalances, leaveRequests, leaveTypes } from "../db/schema/hr";
import { leaveRequestDays } from "../db/schema/leave";
import { orgUnits } from "../db/schema/org";
import { users } from "../db/schema/users";

/**
 * S3-LEAVE-BE-3 — persistence for the LEAVE APPROVAL workflow (approve / reject / management list).
 * Every method takes the caller's `tx` so the SERVICE owns withTenant (RLS + explicit company_id,
 * BẤT BIẾN #1). Complements LeaveRequestRepository (owns FOR-UPDATE re-read, approval + tx inserts,
 * pending bookkeeping) — this file adds ONLY the approval-specific reads/writes: owner scope target,
 * the race-safe Reserved→Used conversion, ATT-sync handoff mark, and the scoped management list.
 *
 * BẤT BIẾN #2: no UPDATE/DELETE on leave_balance_transactions / leave_request_approvals here (those
 * append-only writes live in LeaveRequestRepository.insert*). leave_request_days uses UPDATE only for
 * the sync-status handoff flag (NOT a delete).
 */
@Injectable()
export class LeaveApprovalRepository {
  // ─── owner scope target (for DataScopeService.isEmployeeInScope) ─────────────

  /**
   * Load the request owner's employee scope signals (user_id + org_unit + direct_manager) so the
   * approver's data_scope can be checked BEFORE any mutation. Prefer the request's employee_id link;
   * fall back to user_id for legacy rows without the new FK. Cross-tenant is invisible (RLS + company_id).
   */
  async findOwnerScopeTargetTx(
    companyId: string,
    owner: { employeeId: string | null; userId: string },
    tx: TenantTx,
  ): Promise<
    | {
        userId: string | null;
        companyId: string;
        orgUnitId: string | null;
        directManagerUserId: string | null;
      }
    | undefined
  > {
    const base = and(eq(employeeProfiles.companyId, companyId), isNull(employeeProfiles.deletedAt));
    const cond = owner.employeeId
      ? and(base, eq(employeeProfiles.id, owner.employeeId))
      : and(base, eq(employeeProfiles.userId, owner.userId));
    const [row] = await tx
      .select({
        userId: employeeProfiles.userId,
        companyId: employeeProfiles.companyId,
        orgUnitId: employeeProfiles.orgUnitId,
        directManagerUserId: employeeProfiles.directManagerId,
      })
      .from(employeeProfiles)
      .where(cond)
      .limit(1);
    return row;
  }

  // ─── Reserved → Used conversion (race-safe) ──────────────────────────────────

  /**
   * Atomically convert a reservation to real usage on ONE balance row: used_days += delta AND
   * pending_days -= delta, guarded by `used_days + delta <= total_days` in the WHERE. Returns the
   * updated row, or undefined when the guard fails (would exceed quota) — so two concurrent approvals
   * can NEVER both deduct (the row lock + WHERE guard serialize + reject the loser). delta = decimal string.
   */
  async convertReserveToUseByBalanceIdTx(
    companyId: string,
    data: { balanceId: string; delta: string },
    tx: TenantTx,
  ): Promise<typeof leaveBalances.$inferSelect | undefined> {
    const [row] = await tx
      .update(leaveBalances)
      .set({
        usedDays: sql`${leaveBalances.usedDays} + ${data.delta}::numeric`,
        pendingDays: sql`COALESCE(${leaveBalances.pendingDays}, 0) - ${data.delta}::numeric`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leaveBalances.companyId, companyId),
          eq(leaveBalances.id, data.balanceId),
          sql`${leaveBalances.usedDays} + ${data.delta}::numeric <= ${leaveBalances.totalDays}`,
        ),
      )
      .returning();
    return row;
  }

  /**
   * S3-INT-1 — race-safe REFUND: used_days -= delta on ONE balance row, guarded by
   * `used_days - delta >= 0` in the WHERE so a concurrent/duplicate refund can NEVER drive used_days
   * negative (returns undefined when the guard fails — caller treats as "already refunded / nothing to
   * refund", part of the idempotency contract for Cancel/Revoke of an Approved+Used request).
   */
  async refundUsedByBalanceIdTx(
    companyId: string,
    data: { balanceId: string; delta: string },
    tx: TenantTx,
  ): Promise<typeof leaveBalances.$inferSelect | undefined> {
    const [row] = await tx
      .update(leaveBalances)
      .set({
        usedDays: sql`${leaveBalances.usedDays} - ${data.delta}::numeric`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leaveBalances.companyId, companyId),
          eq(leaveBalances.id, data.balanceId),
          sql`${leaveBalances.usedDays} - ${data.delta}::numeric >= 0`,
        ),
      )
      .returning();
    return row;
  }

  // ─── ATT-sync handoff mark (S3-INT-1 consumes) ───────────────────────────────

  /**
   * Mark every ACTIVE working-day row of an approved request as attendance_sync_status='Pending' so the
   * ATT-sync worker (S3-INT-1) picks them up. Non-working days (weekend/holiday) stay 'Not Required'.
   * UPDATE of a flag column only — NOT a delete (day-rows soft-delete lives elsewhere).
   */
  markDaysSyncPendingTx(companyId: string, requestId: string, actorId: string, tx: TenantTx) {
    return tx
      .update(leaveRequestDays)
      .set({ attendanceSyncStatus: "Pending", updatedBy: actorId, updatedAt: new Date() })
      .where(
        and(
          eq(leaveRequestDays.companyId, companyId),
          eq(leaveRequestDays.leaveRequestId, requestId),
          eq(leaveRequestDays.status, "Active"),
          eq(leaveRequestDays.isWorkingDay, true),
          isNull(leaveRequestDays.deletedAt),
        ),
      );
  }

  // ─── management list (scoped: manager=Team / hr=Company via buildEmployeeScopeCondition) ─────

  /**
   * Scoped management list: leave_requests INNER JOIN employee_profiles (owner) with the caller's
   * data-scope predicate ANDed in — so a manager sees only their Team's requests, HR the whole company.
   * Requester enrichment (fullName/department) via LEFT JOIN users/org_units. Filters: status (default
   * 'Pending'), leaveTypeId, employeeId, [fromDate,toDate] on start_date.
   */
  listPendingScopedTx(
    companyId: string,
    scopeCond: SQL,
    filters: PendingListFilters,
    tx: TenantTx,
  ) {
    return tx
      .select({
        id: leaveRequests.id,
        leaveTypeId: leaveRequests.leaveTypeId,
        leaveTypeCode: leaveTypes.code,
        leaveTypeName: leaveTypes.name,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        durationType: leaveRequests.durationType,
        totalDays: leaveRequests.totalDays,
        totalHours: leaveRequests.totalHours,
        status: leaveRequests.status,
        reason: leaveRequests.reason,
        balanceEffectStatus: leaveRequests.balanceEffectStatus,
        submittedAt: leaveRequests.submittedAt,
        createdAt: leaveRequests.createdAt,
        approvedBy: leaveRequests.approvedBy,
        approvedAt: leaveRequests.approvedAt,
        rejectedBy: leaveRequests.rejectedBy,
        rejectedAt: leaveRequests.rejectedAt,
        rejectionReason: leaveRequests.rejectionReason,
        requesterUserId: leaveRequests.userId,
        requesterEmployeeCode: employeeProfiles.employeeCode,
        requesterFullName: users.fullName,
        requesterDepartment: orgUnits.name,
      })
      .from(leaveRequests)
      .innerJoin(employeeProfiles, eq(leaveRequests.employeeId, employeeProfiles.id))
      .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .leftJoin(users, eq(leaveRequests.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .where(and(scopeCond, ...pendingConds(companyId, filters)))
      .orderBy(desc(leaveRequests.submittedAt), desc(leaveRequests.createdAt))
      .limit(filters.limit)
      .offset(filters.offset);
  }

  async countPendingScopedTx(
    companyId: string,
    scopeCond: SQL,
    filters: PendingListFilters,
    tx: TenantTx,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(leaveRequests)
      .innerJoin(employeeProfiles, eq(leaveRequests.employeeId, employeeProfiles.id))
      .where(and(scopeCond, ...pendingConds(companyId, filters)));
    return row?.n ?? 0;
  }
}

export interface PendingListFilters {
  status: string;
  leaveTypeId?: string;
  employeeId?: string;
  /** org_units.id — narrows to owners in that department (employee_profiles.org_unit_id). */
  departmentId?: string;
  fromDate?: string;
  toDate?: string;
  limit: number;
  offset: number;
}

/**
 * Shared WHERE conds for the scoped list + count (DRY — list/count must agree exactly). ANDed AFTER the
 * caller's scopeCond, so departmentId can only ever NARROW within the granted data-scope (never widen it):
 * a manager filtering by a department outside their Team still sees nothing (scopeCond wins). Both the list
 * and count queries INNER JOIN employee_profiles, so filtering on its org_unit_id is valid for both.
 */
function pendingConds(companyId: string, filters: PendingListFilters) {
  const conds = [
    eq(leaveRequests.companyId, companyId),
    isNull(leaveRequests.deletedAt),
    eq(leaveRequests.status, filters.status),
  ];
  if (filters.leaveTypeId) conds.push(eq(leaveRequests.leaveTypeId, filters.leaveTypeId));
  if (filters.employeeId) conds.push(eq(leaveRequests.employeeId, filters.employeeId));
  if (filters.departmentId) conds.push(eq(employeeProfiles.orgUnitId, filters.departmentId));
  if (filters.fromDate) conds.push(gte(leaveRequests.startDate, filters.fromDate));
  if (filters.toDate) conds.push(lte(leaveRequests.startDate, filters.toDate));
  return conds;
}
