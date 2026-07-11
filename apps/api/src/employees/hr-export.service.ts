import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import {
  HR_EMPLOYEE_EXPORT_MAX_ROWS,
  type HrEmployeeExportQuery,
  type HrEmployeeListItem,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { DataScopeService } from "../permission/data-scope.service";
import { PermissionService } from "../permission/permission.service";
import type { CanInput } from "../permission/permission.types";
import { HrReadRepository, type HrExportFilters, type HrListRow } from "./hr-read.repository";
import { serializeHrEmployeesCsv } from "./hr-export.csv";

type RequestUser = { id: string; companyId: string };

/** What the controller needs to stream the CSV back (headers + body + count for logging). */
export interface HrEmployeeExportResult {
  csv: string;
  filename: string;
  count: number;
}

/**
 * HR-PROFILE-UI-2 (HR.EMPLOYEE.EXPORT, SPEC-03 / API-10) — CSV export of the scoped employee directory.
 * Mirrors AttendanceExportService (S3-ATT-EXPORT-1); the auth/scope/cap/audit shape is identical.
 *
 * AUTH: resolveAndAssert(export, employee, {isSensitive:true}) is the GATE (403 when the caller has no
 * export grant; a wildcard *:* does NOT satisfy a sensitive pair). The resolved data_scope (Own/Team/
 * Company/…) is translated to the SAME employee_profiles predicate the list uses — an Own-scoped caller
 * exports only their own row; Company exports the whole tenant ("export ngoài scope không có row").
 *
 * BẤT BIẾN #1: the read runs inside withTenant(caller.companyId) (RLS+FORCE) and the scope predicate
 * carries company_id too. BẤT BIẾN #3: PII columns (gender/dateOfBirth/phone/contractType) are BLANKED
 * PER-ROW unless the caller holds view-sensitive:employee for that row (object-level gate, isSensitive →
 * wildcard cannot satisfy) — exactly like the list masking. baseSalary/salaryType are NOT export columns
 * (owner decision: avoid a per-row salary reveal via export → no audit-storm), so they never leave here.
 *
 * CAP (no silent truncation): the repo is asked for MAX+1 rows; more than the cap → 422 BEFORE serialize.
 * Otherwise we buffer-then-wrap: buffer the capped rows → per-row mask → build the CSV string → write the
 * append-only audit (actor + exact count + scope label) inside the caller's tx → withTenant commits when
 * the callback returns → the controller streams the buffered CSV bytes.
 */
@Injectable()
export class HrExportService {
  constructor(
    private readonly repo: HrReadRepository,
    private readonly db: DatabaseService,
    private readonly permission: PermissionService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
  ) {}

  async exportEmployeesCsv(
    user: RequestUser,
    query: HrEmployeeExportQuery,
  ): Promise<HrEmployeeExportResult> {
    // GATE first (403 if no export:employee grant). Sensitive pair → wildcard *:* does not satisfy it.
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "export",
      "employee",
      {
        isSensitive: true,
      },
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
    const filters = this.toFilters(query);

    return this.db.withTenant(user.companyId, async (tx) => {
      // MAX+1: detect over-cap without a second COUNT and without scanning past the bound.
      const rows = await this.repo.listScopedForExportTx(
        tx,
        user.companyId,
        scopeCond,
        filters,
        HR_EMPLOYEE_EXPORT_MAX_ROWS + 1,
      );
      if (rows.length > HR_EMPLOYEE_EXPORT_MAX_ROWS) {
        throw new UnprocessableEntityException(
          `Kết quả vượt quá ${HR_EMPLOYEE_EXPORT_MAX_ROWS} dòng — vui lòng thu hẹp bộ lọc và thử lại.`,
        );
      }

      // Per-row PII mask (KEEP per-row, mirror the list): view-sensitive:employee is called with the row
      // id so OBJECT-level grants (ADR-0010) resolve per employee and a single export can legitimately mix
      // revealed + masked rows. Collapsing to one decision would leak/hide PII across rows. PII reveal is
      // read-only (not salary-class) → NOT audited per-row (avoids an audit-storm on a large export).
      const items: HrEmployeeListItem[] = [];
      for (const row of rows) {
        const revealPii = await this.canViewSensitive(user, row.id);
        items.push(this.toExportItem(row, revealPii));
      }

      const csv = serializeHrEmployeesCsv(items);

      // Append-only audit INSIDE the tx (BẤT BIẾN #2) — actor + exact count + scope label. dataScope is the
      // resolved enum (Own/Team/Department/Company/System) — a nhãn, never the raw scope object.
      await this.audit.record(tx, {
        action: "EmployeesExported",
        objectType: "employee",
        actorUserId: user.id,
        actorType: "User",
        resultStatus: "Success",
        dataScope: scope,
        after: {
          count: items.length,
          scope,
          search: query.search ?? null,
          orgUnitId: query.orgUnitId ?? null,
          positionId: query.positionId ?? null,
          status: query.status ?? null,
        },
      });

      return { csv, filename: this.buildFilename(), count: items.length };
    });
  }

  /**
   * view-sensitive:employee gate for the PII columns. Sensitive catalog pair → wildcard grants do NOT
   * satisfy it (isSensitive:true). Per-row (resourceId = row id) so object-level grants resolve per employee.
   */
  private async canViewSensitive(user: RequestUser, targetId: string): Promise<boolean> {
    const input: CanInput = {
      userId: user.id,
      companyId: user.companyId,
      action: "view-sensitive",
      resourceType: "employee",
      resourceId: targetId,
      isSensitive: true,
    };
    const decision = await this.permission.can(input);
    return decision.allow;
  }

  /**
   * Project a raw row onto the masked HrEmployeeListItem the serializer consumes. PII cells are NULL unless
   * the per-row view-sensitive check passed. baseSalary is forced null — it is NOT an export column
   * (salary-class, excluded from HR_EMPLOYEE_EXPORT_COLUMNS), so it can never reach the CSV.
   */
  private toExportItem(row: HrListRow, revealPii: boolean): HrEmployeeListItem {
    return {
      id: row.id,
      userId: row.userId,
      employeeCode: row.employeeCode,
      fullName: row.fullName,
      email: row.email,
      orgUnitId: row.orgUnitId,
      orgUnitName: row.orgUnitName,
      positionId: row.positionId,
      positionName: row.positionName,
      workType: row.workType,
      employmentType: row.employmentType,
      status: row.status,
      avatarUrl: row.avatarUrl,
      startDate: row.startDate,
      officialDate: row.officialDate,
      workLocation: row.workLocation,
      // PII — blanked unless view-sensitive grants reveal (server-side mask, same gate as the list).
      gender: revealPii ? row.gender : null,
      dateOfBirth: revealPii ? row.dateOfBirth : null,
      phone: revealPii ? row.phone : null,
      contractType: revealPii ? row.contractType : null,
      // Salary-class — never an export column; forced null (owner decision, see class doc).
      baseSalary: null,
    };
  }

  /** Map the validated query to the repo's filter shape; resolve sort/order to a deterministic default. */
  private toFilters(query: HrEmployeeExportQuery): HrExportFilters {
    return {
      search: query.search,
      orgUnitId: query.orgUnitId,
      positionId: query.positionId,
      status: query.status,
      sort: query.sort ?? "fullName",
      order: query.order ?? "asc",
    };
  }

  private buildFilename(): string {
    const stamp = new Date().toISOString().slice(0, 10);
    return `employees-${stamp}.csv`;
  }
}
