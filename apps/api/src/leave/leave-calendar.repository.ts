import { Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, isNull, lte, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { leaveRequests, leaveTypes } from "../db/schema/hr";
import { users } from "../db/schema/users";

/** Statuses shown on the calendar — TitleCase (new FSM) ∪ lowercase (legacy rows), never Draft/Rejected/Cancelled. */
const CALENDAR_STATUSES = ["Pending", "Approved", "pending", "approved"] as const;

/**
 * S3-LEAVE-BE-5 (CO-S4-005) — persistence for GET /leave/calendar. INNER JOIN employee_profiles (owner) so
 * the caller's data-scope predicate (own/Team/Company via DataScopeService.buildEmployeeScopeCondition) can
 * be ANDed straight into the SELECT — mirrors LeaveApprovalRepository.listPendingScopedTx (proven S3-LEAVE-BE-3
 * pattern). The SERVICE owns withTenant (RLS + explicit company_id, BẤT BIẾN #1); this repo takes the tx.
 *
 * No N+1: ONE query returns every row (leaveRequests ⋈ employeeProfiles ⋈ leaveTypes, LEFT JOIN users for the
 * display name) — reason masking happens in the mapper (in-memory), not via a second read.
 */
@Injectable()
export class LeaveCalendarRepository {
  listScopedTx(
    companyId: string,
    scopeCond: SQL,
    range: { from: string; to: string },
    tx: TenantTx,
  ) {
    return tx
      .select({
        id: leaveRequests.id,
        userId: leaveRequests.userId,
        userFullName: users.fullName,
        employeeCode: employeeProfiles.employeeCode,
        leaveTypeId: leaveRequests.leaveTypeId,
        leaveTypeCode: leaveTypes.code,
        leaveTypeName: leaveTypes.name,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        totalDays: leaveRequests.totalDays,
        status: leaveRequests.status,
        reason: leaveRequests.reason,
      })
      .from(leaveRequests)
      .innerJoin(employeeProfiles, eq(leaveRequests.employeeId, employeeProfiles.id))
      .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .leftJoin(users, eq(leaveRequests.userId, users.id))
      .where(
        and(
          scopeCond,
          eq(leaveRequests.companyId, companyId),
          isNull(leaveRequests.deletedAt),
          inArray(leaveRequests.status, CALENDAR_STATUSES),
          // date-range overlap with [from, to] inclusive.
          lte(leaveRequests.startDate, range.to),
          gte(leaveRequests.endDate, range.from),
        ),
      )
      .orderBy(leaveRequests.startDate, users.fullName);
  }
}

export type CalendarRow = Awaited<ReturnType<LeaveCalendarRepository["listScopedTx"]>>[number];
