import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  AttendanceLogListResponse,
  AttendanceRecordDetail,
  AttendanceRecordListItem,
  AttendanceRecordListQuery,
  AttendanceRecordListResponse,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import { DataScopeService } from "../permission/data-scope.service";
import type { CanInput } from "../permission/permission.types";
import { ATT_RESOURCES } from "./attendance-permissions.const";
import {
  AttendanceReadRepository,
  type AttRecordListRow,
  type AttendanceListFilters,
} from "./attendance-read.repository";
import {
  toAttendanceLogListItem,
  toAttendanceRecordDetail,
  toAttendanceRecordListItem,
} from "./attendance-read.mappers";

type RequestUser = { id: string; companyId: string };

const ATTENDANCE = ATT_RESOURCES.ATTENDANCE;
const VIEW_TEAM = "view-team";
const VIEW_COMPANY = "view-company";
const VIEW_DETAIL = "view-detail";
const VIEW_SENSITIVE = "view-sensitive";

/**
 * S3-ATT-BE-2 — scoped attendance records read (SPEC-04 / API-10 §5.3). Five surfaces, one masking
 * layer, mirroring HrReadService EXACTLY:
 *   - listMyRecords    : view-own gate (controller) → SELF-LOCKED by user.id (NOT a scope query).
 *   - listTeamRecords  : resolveAndAssert view-team → Team scope FILTER (reports ∪ self ∪ EMR-managed).
 *   - listCompanyRecords: resolveAndAssert view-company → Company scope FILTER (whole tenant).
 *   - getRecordDetail  : resolveAndAssert view-detail → load → in-scope check → 404 if out (no leak).
 *   - getRecordLogs    : view-detail gate on the PARENT record → logs, sensitive fields masked.
 *
 * BẤT BIẾN #1: every read runs in withTenant(caller.companyId); the scope predicate carries company_id
 * too (belt-and-suspenders over RLS). BẤT BIẾN #3: location_json (records) + gps/ip/device (logs) are
 * masked SERVER-side unless the caller holds view-sensitive:attendance (a sensitive catalog pair → a
 * wildcard *:* grant does NOT reveal them). No own-record bypass. NO write → no audit (spec says the
 * sensitive-read audit is optional/config-gated; we do NOT add a mandatory audit here).
 *
 * AUTH CONTRACT (mirror DataScopeService): resolveAndAssert is the GATE (403 when no scope); the scope
 * is then translated to a row FILTER (list) or an in-memory membership test (detail) — a scope check is
 * never a substitute for the per-resource permission gate, and never the other way round.
 */
@Injectable()
export class AttendanceReadService {
  constructor(
    private readonly repo: AttendanceReadRepository,
    private readonly db: DatabaseService,
    private readonly permission: PermissionService,
    private readonly dataScope: DataScopeService,
  ) {}

  // ── Lists ───────────────────────────────────────────────────────────────────────

  /** Self-locked: view-own:attendance is the controller gate; rows pinned to the caller (not scope). */
  async listMyRecords(
    user: RequestUser,
    query: AttendanceRecordListQuery,
  ): Promise<AttendanceRecordListResponse> {
    return this.db.withTenant(user.companyId, async (tx) => {
      // allowTargetFilters=false: ignore departmentId/employeeId — the row set is already own-locked.
      const { rows, total } = await this.repo.listMyRecordsTx(
        tx,
        user.companyId,
        user.id,
        this.toFilters(query, false),
      );
      return this.toListResponse(rows, total, query);
    });
  }

  async listTeamRecords(
    user: RequestUser,
    query: AttendanceRecordListQuery,
  ): Promise<AttendanceRecordListResponse> {
    return this.listScoped(user, query, VIEW_TEAM);
  }

  async listCompanyRecords(
    user: RequestUser,
    query: AttendanceRecordListQuery,
  ): Promise<AttendanceRecordListResponse> {
    return this.listScoped(user, query, VIEW_COMPANY);
  }

  private async listScoped(
    user: RequestUser,
    query: AttendanceRecordListQuery,
    action: string,
  ): Promise<AttendanceRecordListResponse> {
    // GATE first (403 if no grant). isSensitive=true → the sensitive gate requires an exact ALLOW
    // (wildcard *:* does not satisfy it) — mirrors PermissionService.resolveStrongestScope.
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
    // SCOPE = filter: translate the resolved scope into a query predicate over employee_profiles.
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);

    return this.db.withTenant(user.companyId, async (tx) => {
      const { rows, total } = await this.repo.listScopedRecordsTx(
        tx,
        user.companyId,
        scopeCond,
        this.toFilters(query, true),
      );
      return this.toListResponse(rows, total, query);
    });
  }

  // ── Detail + logs ────────────────────────────────────────────────────────────────
  // Both: resolveAndAssert(view-detail) GATE → resolveContext → withTenant load → in-scope (404 if
  // out, never leak existence) → page-uniform view-sensitive reveal → mask.

  async getRecordDetail(user: RequestUser, id: string): Promise<AttendanceRecordDetail> {
    const { scope, ctx } = await this.gateDetail(user);

    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findRecordDetailTx(tx, user.companyId, id);
      if (!row || !this.isInScope(scope, ctx, row)) {
        throw new NotFoundException("Attendance record not found");
      }
      const revealSensitive = await this.canViewSensitive(user, id);
      return toAttendanceRecordDetail(row, revealSensitive);
    });
  }

  async getRecordLogs(user: RequestUser, id: string): Promise<AttendanceLogListResponse> {
    const { scope, ctx } = await this.gateDetail(user);

    return this.db.withTenant(user.companyId, async (tx) => {
      // Scope is checked on the PARENT record (same view-detail gate), THEN the logs are read.
      const row = await this.repo.findRecordDetailTx(tx, user.companyId, id);
      if (!row || !this.isInScope(scope, ctx, row)) {
        throw new NotFoundException("Attendance record not found");
      }
      const revealSensitive = await this.canViewSensitive(user, id);
      const logs = await this.repo.findLogsByRecordTx(tx, user.companyId, id);
      return { items: logs.map((log) => toAttendanceLogListItem(log, revealSensitive)) };
    });
  }

  /** view-detail GATE (403 if no grant) + fresh scope context — shared by detail and logs. */
  private async gateDetail(user: RequestUser): Promise<{
    scope: Awaited<ReturnType<DataScopeService["resolveAndAssert"]>>;
    ctx: Awaited<ReturnType<DataScopeService["resolveContext"]>>;
  }> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      VIEW_DETAIL,
      ATTENDANCE,
      { isSensitive: true },
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    return { scope, ctx };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────────

  private isInScope(
    scope: Parameters<DataScopeService["isEmployeeInScope"]>[0],
    ctx: Parameters<DataScopeService["isEmployeeInScope"]>[1],
    row: {
      userId: string;
      companyId: string;
      orgUnitId: string | null;
      directManagerUserId: string | null;
    },
  ): boolean {
    return this.dataScope.isEmployeeInScope(scope, ctx, {
      userId: row.userId,
      companyId: row.companyId,
      orgUnitId: row.orgUnitId,
      directManagerUserId: row.directManagerUserId,
    });
  }

  /**
   * view-sensitive:attendance reveal — page-uniform (one decision per request). Mirrors
   * HrReadService.canViewSensitive: a sensitive catalog pair → wildcard grants do NOT satisfy it.
   * No audit on reveal (spec: sensitive-read audit is optional/config-gated, not mandatory here).
   */
  private async canViewSensitive(user: RequestUser, resourceId: string): Promise<boolean> {
    const input: CanInput = {
      userId: user.id,
      companyId: user.companyId,
      action: VIEW_SENSITIVE,
      resourceType: ATTENDANCE,
      resourceId,
      isSensitive: true,
    };
    const decision = await this.permission.can(input);
    return decision.allow;
  }

  private toFilters(
    query: AttendanceRecordListQuery,
    allowTargetFilters: boolean,
  ): AttendanceListFilters {
    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      status: query.status,
      attendanceStatus: query.attendanceStatus,
      shiftId: query.shiftId,
      // departmentId/employeeId are management filters — ignored for the self-locked my-records list.
      departmentId: allowTargetFilters ? query.departmentId : undefined,
      employeeId: allowTargetFilters ? query.employeeId : undefined,
      sort: query.sort,
      order: query.order,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private toListResponse(
    rows: AttRecordListRow[],
    total: number,
    query: AttendanceRecordListQuery,
  ): AttendanceRecordListResponse {
    const items: AttendanceRecordListItem[] = rows.map(toAttendanceRecordListItem);
    const totalPages = query.pageSize > 0 ? Math.ceil(total / query.pageSize) : 0;
    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages,
        hasNext: query.page < totalPages,
        hasPrev: query.page > 1,
      },
    };
  }
}
