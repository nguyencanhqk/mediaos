import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { ATTENDANCE_EXPORT_MAX_ROWS, type AttendanceExportQuery } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { DataScopeService } from "../permission/data-scope.service";
import { ATT_RESOURCES } from "./attendance-permissions.const";
import {
  AttendanceReadRepository,
  type AttendanceExportFilters,
} from "./attendance-read.repository";
import { toAttendanceRecordListItem } from "./attendance-read.mappers";
import { serializeAttendanceRecordsCsv } from "./attendance-export.csv";

type RequestUser = { id: string; companyId: string };

const ATTENDANCE = ATT_RESOURCES.ATTENDANCE;
const EXPORT = "export";

/** What the controller needs to stream the CSV back (headers + body + count for logging). */
export interface AttendanceExportResult {
  csv: string;
  filename: string;
  count: number;
}

/**
 * S3-ATT-EXPORT-1 (ATT.ATTENDANCE.EXPORT, API-04 CO-S4-006) — CSV export of scoped attendance records.
 *
 * AUTH: resolveAndAssert(export, attendance, isSensitive) is the GATE (403 when the caller has no export
 * grant; a wildcard *:* does NOT satisfy a sensitive pair). The resolved data_scope (Own/Team/Company/…)
 * is then translated to the SAME employee_profiles predicate the records lists use — an employee with an
 * Own-scoped grant exports only their own rows; Team exports the manager-tree; Company the whole tenant.
 *
 * BẤT BIẾN #1: the read runs inside withTenant(caller.companyId) (RLS+FORCE) and the scope predicate
 * carries company_id too. BẤT BIẾN #3: rows are mapped through toAttendanceRecordListItem, the same masked
 * projection the lists use — it carries NO location/gps/ip/device, so the CSV cannot leak them.
 *
 * CAP (no silent truncation): the repo is asked for cap+1 rows; if it returns more than the cap we throw
 * 422 BEFORE serialize (measure the count first). Otherwise we buffer-then-wrap: buffer the capped rows →
 * build the CSV string → write the append-only audit (actor + exact count + scope) → the withTenant tx
 * commits when the callback returns → the controller wraps the buffered CSV. NOT a DB cursor across the
 * tx (withTenant commits on return), so the audited count is always the exact number of exported rows.
 */
@Injectable()
export class AttendanceExportService {
  constructor(
    private readonly repo: AttendanceReadRepository,
    private readonly db: DatabaseService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
  ) {}

  async exportRecordsCsv(
    user: RequestUser,
    query: AttendanceExportQuery,
  ): Promise<AttendanceExportResult> {
    // GATE first (403 if no grant). Sensitive pair → wildcard *:* does not satisfy it.
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      EXPORT,
      ATTENDANCE,
      { isSensitive: true },
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
    const filters = this.toFilters(query);

    return this.db.withTenant(user.companyId, async (tx) => {
      // cap+1: detect over-cap without a second COUNT and without scanning past the bound.
      const rows = await this.repo.listScopedRecordsForExportTx(
        tx,
        user.companyId,
        scopeCond,
        filters,
        ATTENDANCE_EXPORT_MAX_ROWS + 1,
      );
      if (rows.length > ATTENDANCE_EXPORT_MAX_ROWS) {
        throw new UnprocessableEntityException(
          `Kết quả vượt quá ${ATTENDANCE_EXPORT_MAX_ROWS} dòng — vui lòng thu hẹp khoảng ngày và thử lại.`,
        );
      }

      const items = rows.map(toAttendanceRecordListItem);
      const csv = serializeAttendanceRecordsCsv(items);

      // Append-only audit INSIDE the tx (BẤT BIẾN #2) — actor + exact count + scope label. dataScope is
      // the resolved enum (Own/Team/Department/Company/System) — a nhãn, never the raw scope object.
      await this.audit.record(tx, {
        action: "AttendanceRecordsExported",
        objectType: "attendance_record",
        actorUserId: user.id,
        actorType: "User",
        resultStatus: "Success",
        dataScope: scope,
        after: {
          count: items.length,
          fromDate: query.fromDate ?? null,
          toDate: query.toDate ?? null,
          scope,
        },
      });

      return { csv, filename: this.buildFilename(), count: items.length };
    });
  }

  /** Map the validated query to the repo's filter-only shape (no sort/pagination — server owns those). */
  private toFilters(query: AttendanceExportQuery): AttendanceExportFilters {
    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      status: query.status,
      attendanceStatus: query.attendanceStatus,
      shiftId: query.shiftId,
      departmentId: query.departmentId,
      employeeId: query.employeeId,
    };
  }

  private buildFilename(): string {
    const stamp = new Date().toISOString().slice(0, 10);
    return `attendance-records-${stamp}.csv`;
  }
}
