import { Injectable } from "@nestjs/common";
import { and, count, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import type { DashboardSummaryDto } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { tasks } from "../db/schema/workflow";
import { attendanceRecords, leaveRequests } from "../db/schema/hr";

interface RequestUser {
  id: string;
  companyId: string;
}

interface PermissionSet {
  canReadTask: boolean;
  canReadAttendance: boolean;
  canReadLeave: boolean;
  /** True for HR/manager/leadership roles — sees company-wide attendance. */
  isPrivilegedAttendance: boolean;
}

/**
 * DashboardService — read-only aggregate queries for G14-1 dashboard cards.
 * All queries go through withTenant (RLS enforced). Server returns ONLY what the
 * caller's permission set allows — FE renders what it receives, no client-side masking.
 * No hard-delete guards needed here (all data is soft-deleted; filters add isNull(deletedAt)).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  async getSummary(actor: RequestUser, perms: PermissionSet): Promise<DashboardSummaryDto> {
    const [taskSummary, attendanceSummary, leaveSummary] = await Promise.all([
      this.getTaskSummary(actor, perms),
      this.getAttendanceSummary(actor, perms),
      this.getLeaveSummary(actor, perms),
    ]);

    return {
      tasks: taskSummary,
      attendance: attendanceSummary,
      leave: leaveSummary,
      asOf: new Date().toISOString(),
    };
  }

  // ─── Task aggregate ──────────────────────────────────────────────────────────

  private async getTaskSummary(
    actor: RequestUser,
    perms: PermissionSet,
  ): Promise<DashboardSummaryDto["tasks"]> {
    const { companyId, id: userId } = actor;

    // Employees without read:task see only their own tasks.
    const baseFilter = perms.canReadTask
      ? and(eq(tasks.companyId, companyId), isNull(tasks.deletedAt))
      : and(
          eq(tasks.companyId, companyId),
          eq(tasks.assigneeUserId, userId),
          isNull(tasks.deletedAt),
        );

    const rows = await this.db.withTenant(companyId, (tx) =>
      tx
        .select({ status: tasks.status, cnt: count() })
        .from(tasks)
        .where(baseFilter)
        .groupBy(tasks.status),
    );

    const now = new Date();
    const overdueRows = await this.db.withTenant(companyId, (tx) =>
      tx
        .select({ cnt: count() })
        .from(tasks)
        .where(
          and(
            baseFilter,
            lt(tasks.dueDate, now),
            sql`${tasks.status} NOT IN ('completed','approved')`,
          ),
        ),
    );

    const byStatus = rows.map((r) => ({ status: r.status, count: Number(r.cnt) }));

    const get = (s: string) => byStatus.find((r) => r.status === s)?.count ?? 0;

    return {
      total: byStatus.reduce((acc, r) => acc + r.count, 0),
      notStarted: get("not_started"),
      inProgress: get("in_progress"),
      waitingReview: get("waiting_review"),
      completed: get("completed") + get("approved"),
      overdue: Number(overdueRows[0]?.cnt ?? 0),
      byStatus: perms.canReadTask ? byStatus : undefined,
    };
  }

  // ─── Attendance aggregate ─────────────────────────────────────────────────────

  private async getAttendanceSummary(
    actor: RequestUser,
    perms: PermissionSet,
  ): Promise<DashboardSummaryDto["attendance"]> {
    if (!perms.canReadAttendance) {
      return {
        todayPresent: null,
        todayAbsent: null,
        todayLate: null,
        monthAttendanceDays: null,
        monthAbsentDays: null,
        monthLateDays: null,
      };
    }

    const { companyId, id: userId } = actor;
    const today = new Date().toISOString().slice(0, 10);
    const monthPrefix = today.slice(0, 7); // 'YYYY-MM'

    // Privileged (HR/manager/leadership) see company-wide; otherwise only own records.
    const userFilter = perms.isPrivilegedAttendance
      ? eq(attendanceRecords.companyId, companyId)
      : and(eq(attendanceRecords.companyId, companyId), eq(attendanceRecords.userId, userId));

    const [todayRows, monthRows] = await Promise.all([
      this.db.withTenant(companyId, (tx) =>
        tx
          .select({ status: attendanceRecords.status, cnt: count() })
          .from(attendanceRecords)
          .where(
            and(userFilter, eq(attendanceRecords.workDate, today), isNull(attendanceRecords.deletedAt)),
          )
          .groupBy(attendanceRecords.status),
      ),
      this.db.withTenant(companyId, (tx) =>
        tx
          .select({ status: attendanceRecords.status, cnt: count() })
          .from(attendanceRecords)
          .where(
            and(
              userFilter,
              gte(attendanceRecords.workDate, monthPrefix + "-01"),
              lte(attendanceRecords.workDate, today),
              isNull(attendanceRecords.deletedAt),
            ),
          )
          .groupBy(attendanceRecords.status),
      ),
    ]);

    const todayGet = (s: string) =>
      Number(todayRows.find((r) => r.status === s)?.cnt ?? 0);
    const monthGet = (s: string) =>
      Number(monthRows.find((r) => r.status === s)?.cnt ?? 0);

    return {
      todayPresent:
        todayGet("present") + todayGet("late") + todayGet("early_leave") + todayGet("approved_adjustment"),
      todayAbsent: todayGet("absent"),
      todayLate: todayGet("late"),
      monthAttendanceDays:
        monthGet("present") + monthGet("late") + monthGet("early_leave") + monthGet("approved_adjustment"),
      monthAbsentDays: monthGet("absent"),
      monthLateDays: monthGet("late"),
    };
  }

  // ─── Leave aggregate ──────────────────────────────────────────────────────────

  private async getLeaveSummary(
    actor: RequestUser,
    perms: PermissionSet,
  ): Promise<DashboardSummaryDto["leave"]> {
    if (!perms.canReadLeave) {
      return { pendingRequests: null, approvedThisMonth: null, myAnnualBalanceDays: null };
    }

    const { companyId, id: userId } = actor;
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + "-01";

    const leaveFilter = perms.isPrivilegedAttendance
      ? and(eq(leaveRequests.companyId, companyId), isNull(leaveRequests.deletedAt))
      : and(
          eq(leaveRequests.companyId, companyId),
          eq(leaveRequests.userId, userId),
          isNull(leaveRequests.deletedAt),
        );

    const [pendingRows, approvedRows] = await Promise.all([
      this.db.withTenant(companyId, (tx) =>
        tx
          .select({ cnt: count() })
          .from(leaveRequests)
          .where(and(leaveFilter, eq(leaveRequests.status, "pending"))),
      ),
      this.db.withTenant(companyId, (tx) =>
        tx
          .select({ cnt: count() })
          .from(leaveRequests)
          .where(
            and(
              leaveFilter,
              eq(leaveRequests.status, "approved"),
              gte(leaveRequests.startDate, monthStart),
            ),
          ),
      ),
    ]);

    return {
      pendingRequests: Number(pendingRows[0]?.cnt ?? 0),
      approvedThisMonth: Number(approvedRows[0]?.cnt ?? 0),
      // Leave balance comes from a separate endpoint (G12) — not yet merged; null for now.
      myAnnualBalanceDays: null,
    };
  }
}
