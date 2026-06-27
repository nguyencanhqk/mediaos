import { Injectable, NotFoundException } from "@nestjs/common";
import { DEFAULT_EMPLOYEE_CODE_NUMBER_LENGTH } from "@mediaos/contracts";
import type {
  HrContractTypeLookup,
  HrDepartmentLookup,
  HrEmployeeCodePreview,
  HrEmployeeDetail,
  HrEmployeeListItem,
  HrEmployeeListResponse,
  HrEmployeeListQuery,
  HrJobLevelLookup,
  HrMeProfile,
  HrPositionLookup,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import { DataScopeService } from "../permission/data-scope.service";
import type { CanInput } from "../permission/permission.types";
import { HrReadRepository, type HrDetailRow, type HrListRow } from "./hr-read.repository";

type RequestUser = { id: string; companyId: string };

/**
 * S2-HR-BE-1 — HR read core (SPEC-03 / API-10). Three surfaces, one masking layer:
 *   - listHrEmployees: gate (resolveAndAssert read:employee) → scope FILTER → per-row salary mask.
 *   - getHrEmployee: tenant read → in-scope check → field-level salary + PII mask.
 *   - getMyProfile: self lookup by userId (NOT scope) → same masking layer.
 * Lookups expose only non-sensitive reference data.
 *
 * BẤT BIẾN #1: every read runs in withTenant(caller.companyId); the scope predicate carries company_id
 * too (belt-and-suspenders over RLS). BẤT BIẾN #3: baseSalary + salaryType (view-salary) + PII phone/
 * notes/contractType (view-sensitive) are masked SERVER-side; a wildcard *:* grant does NOT reveal them
 * (both are sensitive catalog pairs → can() requires an exact ALLOW). Reveal ⟹ audit atomically:
 * the view-salary audit INSERT shares the caller's tenant tx, so a failed audit rolls back the read.
 */
@Injectable()
export class HrReadService {
  constructor(
    private readonly repo: HrReadRepository,
    private readonly db: DatabaseService,
    private readonly permission: PermissionService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
  ) {}

  // ── List ────────────────────────────────────────────────────────────────────────

  async listHrEmployees(
    user: RequestUser,
    query: HrEmployeeListQuery,
  ): Promise<HrEmployeeListResponse> {
    // GATE first (403 if no read:employee grant) — runs BEFORE any repo/DB read.
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "read",
      "employee",
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);
    // SCOPE = filter: translate the resolved scope into a query predicate (Own/Team/Department/…).
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);

    return this.db.withTenant(user.companyId, async (tx) => {
      const { rows, total } = await this.repo.listScopedTx(tx, user.companyId, scopeCond, {
        search: query.search,
        orgUnitId: query.orgUnitId,
        positionId: query.positionId,
        status: query.status,
        sort: query.sort,
        order: query.order,
        page: query.page,
        pageSize: query.pageSize,
      });

      // Per-row salary reveal — KEEP per-row, do NOT collapse to one decision/page: can('view-salary')
      // is called with resourceId so OBJECT-level grants (ADR-0010) resolve per employee, and a single
      // page can legitimately mix revealed + masked rows. Each revealed row audits atomically on the tx
      // (reveal ⟹ audit, per object). Collapsing to a resourceType-level check would leak or hide salary
      // across rows depending on object grants — a cross-record disclosure bug, not a perf win.
      const items: HrEmployeeListItem[] = [];
      for (const row of rows) {
        const revealSalary = await this.revealSalary(tx, user, row.id);
        items.push(this.toListItem(row, revealSalary));
      }

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
    });
  }

  // ── Detail ────────────────────────────────────────────────────────────────────────

  async getHrEmployee(user: RequestUser, id: string): Promise<HrEmployeeDetail> {
    const scope = await this.dataScope.resolveAndAssert(
      user.id,
      user.companyId,
      "read",
      "employee",
    );
    const ctx = await this.dataScope.resolveContext(user.id, user.companyId);

    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findByIdTx(tx, user.companyId, id);
      if (!row) throw new NotFoundException("Employee not found");

      // In-scope check (defense-in-depth: cross-tenant fails for EVERY scope). Out-of-scope reads
      // 404 — never leak that the row exists outside the caller's scope.
      const inScope = this.dataScope.isEmployeeInScope(scope, ctx, {
        userId: row.userId,
        companyId: row.companyId,
        orgUnitId: row.orgUnitId,
        directManagerUserId: row.directManagerUserId,
      });
      if (!inScope) throw new NotFoundException("Employee not found");

      const revealSalary = await this.revealSalary(tx, user, id);
      const revealPii = await this.canViewSensitive(user, id);
      return this.toDetail(row, revealSalary, revealPii);
    });
  }

  // ── Me / profile ────────────────────────────────────────────────────────────────

  async getMyProfile(user: RequestUser): Promise<HrMeProfile> {
    // Gate: the controller's @RequirePermission("read","employee") is the coarse access gate; THIS
    // self-by-userId lookup is the fine gate — it pins the row to the caller, so the route returns the
    // caller's OWN profile only. Self-only: locked to caller.id within the tenant — NOT a scope query
    // (a Company-scope read must not let /me/profile return someone else's row).
    return this.db.withTenant(user.companyId, async (tx) => {
      const row = await this.repo.findByUserIdTx(tx, user.companyId, user.id);
      if (!row) throw new NotFoundException("No employee profile linked to your account");

      // Own data still flows through the SAME masking layer (no bypass): the caller's grants decide.
      const revealSalary = await this.revealSalary(tx, user, row.id);
      const revealPii = await this.canViewSensitive(user, row.id);
      return this.toDetail(row, revealSalary, revealPii);
    });
  }

  // ── Lookups ───────────────────────────────────────────────────────────────────────

  async listDepartments(user: RequestUser): Promise<HrDepartmentLookup[]> {
    return this.db.withTenant(user.companyId, (tx) =>
      this.repo.listDepartmentsTx(tx, user.companyId),
    );
  }

  async listPositions(user: RequestUser): Promise<HrPositionLookup[]> {
    return this.db.withTenant(user.companyId, (tx) =>
      this.repo.listPositionsTx(tx, user.companyId),
    );
  }

  async listJobLevels(user: RequestUser): Promise<HrJobLevelLookup[]> {
    return this.db.withTenant(user.companyId, (tx) =>
      this.repo.listJobLevelsTx(tx, user.companyId),
    );
  }

  async listContractTypes(user: RequestUser): Promise<HrContractTypeLookup[]> {
    return this.db.withTenant(user.companyId, (tx) =>
      this.repo.listContractTypesTx(tx, user.companyId),
    );
  }

  async previewEmployeeCode(user: RequestUser): Promise<HrEmployeeCodePreview> {
    return this.db.withTenant(user.companyId, async (tx) => {
      const cfg = await this.repo.getEmployeeCodeConfigTx(tx, user.companyId);
      if (!cfg) {
        return {
          available: false,
          prefix: null,
          pattern: null,
          numberLength: DEFAULT_EMPLOYEE_CODE_NUMBER_LENGTH,
          sample: null,
        };
      }
      const padded = "1".padStart(cfg.numberLength, "0");
      const sample = `${cfg.prefix ?? ""}${padded}`;
      return {
        available: true,
        prefix: cfg.prefix,
        pattern: cfg.pattern,
        numberLength: cfg.numberLength,
        sample,
      };
    });
  }

  // ── Sensitive reveal helpers ────────────────────────────────────────────────────

  /**
   * Reveal base_salary AND write the view-salary audit atomically (mirrors EmployeesService.revealSalary).
   * isSensitive=true → a wildcard grant cannot satisfy it. We only reveal when allow && auditRequired,
   * and in that case record the view inside the caller's tx — a failed audit rolls back the read.
   */
  private async revealSalary(tx: TenantTx, user: RequestUser, targetId: string): Promise<boolean> {
    const input: CanInput = {
      userId: user.id,
      companyId: user.companyId,
      action: "view-salary",
      resourceType: "employee",
      resourceId: targetId,
      isSensitive: true,
    };
    const decision = await this.permission.can(input);
    const reveal = decision.allow && decision.auditRequired;
    if (reveal) {
      await this.audit.record(tx, {
        action: "view-salary",
        objectType: "employee",
        objectId: targetId,
        actorUserId: user.id,
      });
    }
    return reveal;
  }

  /**
   * view-sensitive:employee gate for PII (phone/notes/contractType). Sensitive catalog pair → wildcard
   * grants do NOT satisfy it. PII reveal is not separately audited (read-only, no salary-class trail).
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

  // ── Projection / masking ────────────────────────────────────────────────────────

  private toListItem(row: HrListRow, revealSalary: boolean): HrEmployeeListItem {
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
      baseSalary: revealSalary && row.baseSalary != null ? Number(row.baseSalary) : null,
    };
  }

  private toDetail(row: HrDetailRow, revealSalary: boolean, revealPii: boolean): HrEmployeeDetail {
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
      directManagerId: row.directManagerId,
      workType: row.workType,
      employmentType: row.employmentType,
      startDate: row.startDate,
      endDate: row.endDate,
      status: row.status,
      baseSalary: revealSalary && row.baseSalary != null ? Number(row.baseSalary) : null,
      // SENSITIVE (salary-class, S2-HR-MASK-1): salaryType is the compensation MODEL (monthly/hourly/
      // project). Owner chốt 2026-06-26 classes it under SPEC-03 §18.8 "dữ liệu lương" → gate WITH the
      // amount behind view-salary (fail-closed). No view-salary reveal ⟹ null, same as baseSalary.
      salaryType: revealSalary ? row.salaryType : null,
      // PII — masked unless view-sensitive grants reveal.
      phone: revealPii ? row.phone : null,
      contractType: revealPii ? row.contractType : null,
      notes: revealPii ? row.notes : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
