import { Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles, leaveRequestDays, leaveRequests, orgUnits, users } from "../db/schema";

/**
 * S3-LEAVE-BE-6 (CO-S4-006) — read-only repository for the per-employee LEAVE report aggregate.
 *
 * Sources leave_request_days (day-granular, status='Active') INNER JOIN leave_requests (status='Approved'
 * only — Pending/Draft/Rejected/Cancelled/Revoked KHÔNG tính) ∩ [fromDate, toDateExclusive) trên work_date.
 * Day-granular > cả đơn's total_days khi đơn cắt ngang biên kỳ lọc (chỉ đếm phần trong kỳ). leave_request_days
 * .employee_id FK THẲNG → employee_profiles(id) (KHÔNG qua user_id) — mirrors LeaveCalendarRepository join.
 *
 * ONE aggregate query (SUM/COUNT DISTINCT GROUP BY employee) — số câu SQL KHÔNG tăng theo số ngày nghỉ,
 * chỉ theo số nhân viên trên trang (bounded pageSize). Câu COUNT(DISTINCT employee) thứ 2 cho tổng trang.
 * Chạy trong tx của caller (withTenant → RLS+FORCE, BẤT BIẾN #1) + AND company_id tường minh (defense-in-
 * depth qua RLS). SELECT-only.
 */

const APPROVED_STATUSES = ["Approved", "approved"] as const;

export interface LeaveReportFilters {
  fromDate: string;
  /** Exclusive upper bound (half-open [fromDate, toDate)). */
  toDateExclusive: string;
  leaveTypeId?: string;
  departmentId?: string;
}

export interface LeaveReportRow {
  employeeId: string;
  /** employee_profiles.user_id là NULLABLE (nhân viên chưa liên kết tài khoản). */
  userId: string | null;
  employeeCode: string | null;
  fullName: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  totalRequests: number;
  totalLeaveDays: number;
}

@Injectable()
export class LeaveReportRepository {
  private readonly requestJoin: SQL = and(
    eq(leaveRequests.id, leaveRequestDays.leaveRequestId),
    eq(leaveRequests.companyId, leaveRequestDays.companyId),
  )!;

  private readonly employeeJoin: SQL = and(
    eq(employeeProfiles.id, leaveRequestDays.employeeId),
    eq(employeeProfiles.companyId, leaveRequestDays.companyId),
    isNull(employeeProfiles.deletedAt),
  )!;

  /**
   * Per-employee aggregate page. `scopeCond` = DataScopeService predicate over employee_profiles
   * (hiện tại chỉ Company thoả mãn — export:leave chỉ granted Company scope, mig 0455; hàm vẫn generic
   * để tự mở rộng nếu 1 seed sau này cấp thêm Team/Department).
   */
  async listReportTx(
    tx: TenantTx,
    companyId: string,
    scopeCond: SQL,
    filters: LeaveReportFilters,
    page: number,
    pageSize: number,
  ): Promise<{ rows: LeaveReportRow[]; total: number }> {
    const where = this.buildWhere(companyId, scopeCond, filters);
    const offset = (page - 1) * pageSize;

    const rows = await tx
      .select({
        employeeId: employeeProfiles.id,
        userId: employeeProfiles.userId,
        employeeCode: employeeProfiles.employeeCode,
        fullName: users.fullName,
        orgUnitId: employeeProfiles.orgUnitId,
        orgUnitName: orgUnits.name,
        totalRequests: sql<number>`count(distinct ${leaveRequestDays.leaveRequestId})::int`,
        totalLeaveDays: sql<number>`coalesce(sum(${leaveRequestDays.leaveDays}), 0)::numeric`,
      })
      .from(leaveRequestDays)
      .innerJoin(leaveRequests, this.requestJoin)
      .innerJoin(employeeProfiles, this.employeeJoin)
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .where(where)
      .groupBy(
        employeeProfiles.id,
        employeeProfiles.userId,
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
      .from(leaveRequestDays)
      .innerJoin(leaveRequests, this.requestJoin)
      .innerJoin(employeeProfiles, this.employeeJoin)
      .where(where);

    return {
      rows: rows.map((r) => ({ ...r, totalLeaveDays: Number(r.totalLeaveDays) })),
      total: Number(count),
    };
  }

  private buildWhere(companyId: string, scopeCond: SQL, filters: LeaveReportFilters): SQL {
    const conditions: SQL[] = [
      eq(leaveRequestDays.companyId, companyId),
      isNull(leaveRequestDays.deletedAt),
      eq(leaveRequestDays.status, "Active"),
      inArray(leaveRequests.status, [...APPROVED_STATUSES]),
      scopeCond,
      gte(leaveRequestDays.workDate, filters.fromDate),
      lt(leaveRequestDays.workDate, filters.toDateExclusive),
    ];
    if (filters.leaveTypeId) conditions.push(eq(leaveRequestDays.leaveTypeId, filters.leaveTypeId));
    if (filters.departmentId) conditions.push(eq(employeeProfiles.orgUnitId, filters.departmentId));
    return and(...conditions)!;
  }
}
