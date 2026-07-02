import { Injectable } from "@nestjs/common";
import type { AttendanceReportQuery, AttendanceReportResponse } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import { ATT_RESOURCES } from "./attendance-permissions.const";
import { AttendanceReportRepository, type AttReportRow } from "./attendance-report.repository";

type RequestUser = { id: string; companyId: string };

const ATTENDANCE = ATT_RESOURCES.ATTENDANCE;

/**
 * S3-ATT-BE-6 (CO-S4-006) — GET /attendance/reports scoped aggregate. Mirrors AttendanceReadService's
 * listScoped GATE→scope→filter contract EXACTLY: resolveAndAssert(action) is the 403 gate (never a
 * requested-scope input from the client); resolveContext resolves the manager-tree (S2-INT-2);
 * buildEmployeeScopeCondition translates the granted scope into a query predicate — Team is NEVER
 * "every employee in the company", only the caller's reports ∪ self ∪ EMR-managed set.
 *
 * The controller wires this action-by-permission-pair (view-team / view-company), same as
 * AttendanceReadService.listTeamRecords/listCompanyRecords — there is no "requested scope" parameter,
 * the grant alone decides how wide the report is.
 */
@Injectable()
export class AttendanceReportService {
  constructor(
    private readonly repo: AttendanceReportRepository,
    private readonly db: DatabaseService,
    private readonly dataScope: DataScopeService,
  ) {}

  async getReport(
    user: RequestUser,
    action: "view-team" | "view-company",
    query: AttendanceReportQuery,
  ): Promise<AttendanceReportResponse> {
    // GATE first (403 if no grant) — isSensitive:true mirrors the records-read pairs (mig 0454).
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      action,
      ATTENDANCE,
      {
        isSensitive: true,
      },
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);

    // Half-open [fromDate, toDate) over work_date — toDate in the query is INCLUSIVE (spec/DTO), so the
    // exclusive upper bound is the day after.
    const toDateExclusive = nextDay(query.toDate);

    return this.db.withTenant(user.companyId, async (tx) => {
      const { rows, total } = await this.repo.listReportTx(
        tx,
        user.companyId,
        scopeCond,
        { fromDate: query.fromDate, toDateExclusive, departmentId: query.departmentId },
        query.page,
        query.pageSize,
      );
      const totalPages = query.pageSize > 0 ? Math.ceil(total / query.pageSize) : 0;
      return {
        fromDate: query.fromDate,
        toDate: query.toDate,
        items: rows.map(toReportRow),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages,
          hasNext: query.page < totalPages,
          hasPrev: query.page > 1,
        },
      };
    });
  }
}

function toReportRow(row: AttReportRow) {
  return {
    employeeId: row.employeeId,
    userId: row.userId,
    employeeCode: row.employeeCode,
    fullName: row.fullName,
    orgUnitId: row.orgUnitId,
    orgUnitName: row.orgUnitName,
    totalDays: row.totalDays,
    presentDays: row.presentDays,
    lateDays: row.lateDays,
    missingDays: row.missingDays,
    leaveDays: row.leaveDays,
  };
}

/** 'YYYY-MM-DD' → the next calendar day (UTC-safe: no local-timezone drift, ADR-0008). */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
