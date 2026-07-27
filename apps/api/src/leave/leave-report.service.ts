import { Injectable } from "@nestjs/common";
import type { LeaveReportQuery, LeaveReportResponse } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { DataScopeService } from "../permission/data-scope.service";
import { LEAVE_RESOURCES } from "./leave-permissions.const";
import { LeaveReportRepository, type LeaveReportRow } from "./leave-report.repository";

type RequestUser = { id: string; companyId: string };

const LEAVE = LEAVE_RESOURCES.LEAVE;

/**
 * S3-LEAVE-BE-6 (CO-S4-006) — GET /leave/reports scoped aggregate. Mirrors AttendanceReportService's
 * GATE→scope→filter contract EXACTLY: resolveAndAssert('export','leave') is the 403 gate (hr/company-admin
 * @Company only per mig 0455 — KHÔNG manager, LEAST-PRIVILEGE owner decision); resolveContext resolves the
 * manager-tree (unused today at Company scope nhưng generic — tự mở rộng nếu seed sau này thêm Team);
 * buildEmployeeScopeCondition translates the granted scope into a query predicate.
 */
@Injectable()
export class LeaveReportService {
  constructor(
    private readonly repo: LeaveReportRepository,
    private readonly db: DatabaseService,
    private readonly dataScope: DataScopeService,
    // S6-SEC-1 · KI-033: optional-với-default để int-spec dựng service bằng tay (3 arg) KHÔNG vỡ —
    // cùng khuôn với RoleAdminService.permissionCatalog. DI luôn truyền instance thật.
    private readonly audit: AuditService = new AuditService(),
  ) {}

  async getReport(user: RequestUser, query: LeaveReportQuery): Promise<LeaveReportResponse> {
    // GATE first (403 if no grant) — isSensitive:true mirrors export:leave (mig 0455, sensitive=true).
    const scope = await this.dataScope.resolveAndAssert(user.id, user.companyId, "export", LEAVE, {
      isSensitive: true,
    });
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);

    // Half-open [fromDate, toDate) — toDate in the query is INCLUSIVE (spec/DTO), exclusive bound = day after.
    const toDateExclusive = nextDay(query.toDate);

    return this.db.withTenant(user.companyId, async (tx) => {
      const { rows, total } = await this.repo.listReportTx(
        tx,
        user.companyId,
        scopeCond,
        {
          fromDate: query.fromDate,
          toDateExclusive,
          leaveTypeId: query.leaveTypeId,
          departmentId: query.departmentId,
        },
        query.page,
        query.pageSize,
      );
      const totalPages = query.pageSize > 0 ? Math.ceil(total / query.pageSize) : 0;

      // S6-SEC-1 · KI-033 — audit append-only TRONG CÙNG tx (BẤT BIẾN #2), khuôn y hệt
      // AttendanceExportService/HrExportService. Route này gate bằng `export:leave` (nhạy cảm) và đọc
      // tổng hợp nghỉ phép của TOÀN công ty; trước đây không để lại vết nào để hậu kiểm ai đã kéo.
      // Payload chỉ mang SỐ ĐO + nhãn scope — tuyệt đối không tên/email/mã nhân viên (BẤT BIẾN #3).
      await this.audit.record(tx, {
        action: "LeaveReportViewed",
        objectType: "leave_request",
        actorUserId: user.id,
        actorType: "User",
        resultStatus: "Success",
        dataScope: scope,
        // `count` = số hàng TRANG này, `total` = tổng khớp bộ lọc. Ghi cả hai: chỉ có count thì một
        // lượt kéo 5.000 hàng phân trang 20 sẽ để lại vết "count: 20" — vô nghĩa khi hậu kiểm.
        after: { count: rows.length, total, fromDate: query.fromDate, toDate: query.toDate, scope },
      });

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

function toReportRow(row: LeaveReportRow) {
  return {
    employeeId: row.employeeId,
    userId: row.userId,
    employeeCode: row.employeeCode,
    fullName: row.fullName,
    orgUnitId: row.orgUnitId,
    orgUnitName: row.orgUnitName,
    totalRequests: row.totalRequests,
    totalLeaveDays: row.totalLeaveDays,
  };
}

/** 'YYYY-MM-DD' → the next calendar day (UTC-safe: no local-timezone drift, ADR-0008). */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
