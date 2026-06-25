import { ForbiddenException, Injectable } from "@nestjs/common";
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";
import { employeeProfiles } from "../db/schema";
import { PermissionService } from "./permission.service";
import { DataScopeRepository } from "./data-scope.repository";

/** The acting user's scope context. orgUnitId is needed only for Department scope (lazy-loaded). */
export interface ScopeContext {
  userId: string;
  companyId: string;
  orgUnitId?: string | null;
}

/** A candidate employee row whose in-scope membership we test (single-resource path). */
export interface EmployeeScopeTarget {
  userId: string;
  companyId: string;
  orgUnitId?: string | null;
  /** employee_profiles.direct_manager_id (a users.id) — for Team membership. */
  directManagerUserId?: string | null;
}

/**
 * S2-AUTH-BE-2 — DataScopeService: the shared final-authorization layer that translates a granted
 * data_scope (Own/Team/Department/Company/System) into a query condition, reusable by every module
 * (HR-BE-1 first; ATT/LEAVE/TASK later) WITHOUT hard-coding roles. BACKEND-03 §18/§26.4.
 *
 * Two surfaces:
 *   - buildEmployeeScopeCondition(): a Drizzle predicate ANDed into a list SELECT (filter at the DB).
 *   - isEmployeeInScope(): an in-memory membership check for a single already-loaded resource.
 *
 * AUTHORIZATION CONTRACT (plan-review #3a): isEmployeeInScope is a SCOPE FILTER, NOT a permission gate.
 * A consumer MUST first pass PermissionService.can()/resolveAndAssert (object-tier DENY + sensitive gate
 * live in can()) and only then use these to bound the rows/resource by data_scope.
 */
@Injectable()
export class DataScopeService {
  constructor(
    private readonly permission: PermissionService,
    private readonly repo: DataScopeRepository,
  ) {}

  /**
   * Gate: resolve the user's strongest granted scope for (action,resourceType); 403 when none.
   * Returns the scope so the consumer can build the list filter. Does NOT accept a requested scope —
   * "wider than grant" is enforced by NARROWING the rows (via buildEmployeeScopeCondition), not a 403.
   */
  async resolveAndAssert(
    userId: string,
    companyId: string,
    action: string,
    resourceType: string,
    opts?: { isSensitive?: boolean },
  ): Promise<DataScope> {
    const scope = await this.permission.resolveStrongestScope(
      userId,
      companyId,
      action,
      resourceType,
      opts,
    );
    if (scope == null) {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope");
    }
    return scope;
  }

  /** Resolve the acting user's full scope context (adds org_unit for Department scope). */
  async resolveContext(userId: string, companyId: string): Promise<ScopeContext> {
    const orgUnitId = await this.repo.getRequesterOrgUnitId(userId, companyId);
    return { userId, companyId, orgUnitId };
  }

  /**
   * Build the employee-list predicate for `scope`. ALWAYS carries company_id (belt-and-suspenders over RLS;
   * never a bare no-op that could match-all if RLS were bypassed — plan-review #9). Unknown/null scope and
   * Department-without-org_unit fail closed to `false` (0 rows).
   */
  buildEmployeeScopeCondition(scope: DataScope | null, ctx: ScopeContext): SQL {
    const tenant = eq(employeeProfiles.companyId, ctx.companyId);
    const falsey = sql`false`;
    switch (scope) {
      // N=1 single-tenant MVP: System stays bounded to the current tenant (cross-system out of scope).
      case "System":
      case "Company":
        return tenant;
      case "Department":
        if (!ctx.orgUnitId) return falsey;
        return and(tenant, eq(employeeProfiles.orgUnitId, ctx.orgUnitId)) ?? falsey;
      case "Team":
        // reports ∪ self: a line-manager sees their direct reports and their own row.
        return (
          and(
            tenant,
            or(
              eq(employeeProfiles.directManagerId, ctx.userId),
              eq(employeeProfiles.userId, ctx.userId),
            ),
          ) ?? falsey
        );
      case "Own":
        return and(tenant, eq(employeeProfiles.userId, ctx.userId)) ?? falsey;
      default:
        return falsey;
    }
  }

  /**
   * In-memory membership test for a single employee target. Defense-in-depth: a cross-tenant target is
   * out of scope for EVERY scope including Company/System (plan-review #4) — never trust an in-memory
   * object to be tenant-correct just because RLS guards the DB.
   */
  isEmployeeInScope(
    scope: DataScope | null,
    ctx: ScopeContext,
    target: EmployeeScopeTarget,
  ): boolean {
    if (target.companyId !== ctx.companyId) return false;
    switch (scope) {
      case "System":
      case "Company":
        return true;
      case "Department":
        return ctx.orgUnitId != null && target.orgUnitId === ctx.orgUnitId;
      case "Team":
        return target.directManagerUserId === ctx.userId || target.userId === ctx.userId;
      case "Own":
        return target.userId === ctx.userId;
      default:
        return false;
    }
  }
}
