import { Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { attendanceRecords, employeeProfiles, orgUnits, users } from "../db/schema";

/**
 * S3-ATT-BE-6 (CO-S4-006) — read-only repository for the per-employee attendance report aggregate.
 *
 * BUCKETS (fixed, mirrors attendance.logic.ts checkOutTitleStatus + attendance-leave-sync.logic.ts
 * fullDayLeaveStatus vocabulary — DB-04 §7.4 TitleCase attendance_status):
 *   present = 'Present' | 'Checked-in' | 'Early Leave' (worked the day, possibly left early)
 *   late    = 'Late'
 *   missing = 'Missing Hours' | 'Not Checked-in'
 *   leave   = 'Leave' (S3-INT-1 LEAVE→ATT sync)
 *
 * ONE aggregate query (COUNT ... FILTER (WHERE ...) GROUP BY employee) for the totals — the number of
 * SQL statements issued does NOT grow with the number of attendance_records matched (no N+1), only with
 * the number of DISTINCT employees on the page (bounded by pageSize). A second COUNT(DISTINCT employee)
 * query supplies the page total. Runs inside the caller's tenant tx (withTenant → RLS+FORCE, BẤT BIẾN #1)
 * and ANDs an explicit company_id (defense-in-depth over RLS). SELECT-only.
 */

const PRESENT_STATUSES = ["Present", "Checked-in", "Early Leave"] as const;
const MISSING_STATUSES = ["Missing Hours", "Not Checked-in"] as const;

export interface AttReportFilters {
  fromDate: string;
  /** Exclusive upper bound (half-open [fromDate, toDate)). */
  toDateExclusive: string;
  departmentId?: string;
}

export interface AttReportRow {
  employeeId: string;
  userId: string;
  employeeCode: string | null;
  fullName: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  totalDays: number;
  presentDays: number;
  lateDays: number;
  missingDays: number;
  leaveDays: number;
}

@Injectable()
export class AttendanceReportRepository {
  private readonly employeeJoin: SQL = and(
    eq(employeeProfiles.userId, attendanceRecords.userId),
    eq(employeeProfiles.companyId, attendanceRecords.companyId),
    isNull(employeeProfiles.deletedAt),
  )!;

  /**
   * Per-employee aggregate page. `scopeCond` = DataScopeService predicate over employee_profiles
   * (Team/Company — the report gate never grants Own/Department/System per S3-ATT-BE-6 done_when).
   * Paginates over DISTINCT employees (page/pageSize already validated by the DTO).
   */
  async listReportTx(
    tx: TenantTx,
    companyId: string,
    scopeCond: SQL,
    filters: AttReportFilters,
    page: number,
    pageSize: number,
  ): Promise<{ rows: AttReportRow[]; total: number }> {
    const where = this.buildWhere(companyId, scopeCond, filters);
    const offset = (page - 1) * pageSize;

    const rows = await tx
      .select({
        employeeId: employeeProfiles.id,
        userId: attendanceRecords.userId,
        employeeCode: employeeProfiles.employeeCode,
        fullName: users.fullName,
        orgUnitId: employeeProfiles.orgUnitId,
        orgUnitName: orgUnits.name,
        totalDays: sql<number>`count(*)::int`,
        presentDays: sql<number>`count(*) filter (where ${inArray(
          attendanceRecords.attendanceStatus,
          [...PRESENT_STATUSES],
        )})::int`,
        lateDays: sql<number>`count(*) filter (where ${eq(
          attendanceRecords.attendanceStatus,
          "Late",
        )})::int`,
        missingDays: sql<number>`count(*) filter (where ${inArray(
          attendanceRecords.attendanceStatus,
          [...MISSING_STATUSES],
        )})::int`,
        leaveDays: sql<number>`count(*) filter (where ${eq(
          attendanceRecords.attendanceStatus,
          "Leave",
        )})::int`,
      })
      .from(attendanceRecords)
      .innerJoin(employeeProfiles, this.employeeJoin)
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .where(where)
      .groupBy(
        employeeProfiles.id,
        attendanceRecords.userId,
        employeeProfiles.employeeCode,
        users.fullName,
        employeeProfiles.orgUnitId,
        orgUnits.name,
      )
      .orderBy(employeeProfiles.employeeCode, employeeProfiles.id)
      .limit(pageSize)
      .offset(offset);

    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(distinct ${employeeProfiles.id})::int` })
      .from(attendanceRecords)
      .innerJoin(employeeProfiles, this.employeeJoin)
      .where(where);

    return { rows: rows as AttReportRow[], total: Number(count) };
  }

  private buildWhere(companyId: string, scopeCond: SQL, filters: AttReportFilters): SQL {
    const conditions: SQL[] = [
      eq(attendanceRecords.companyId, companyId),
      isNull(attendanceRecords.deletedAt),
      scopeCond,
      gte(attendanceRecords.workDate, filters.fromDate),
      lt(attendanceRecords.workDate, filters.toDateExclusive),
    ];
    if (filters.departmentId) conditions.push(eq(employeeProfiles.orgUnitId, filters.departmentId));
    return and(...conditions)!;
  }
}
