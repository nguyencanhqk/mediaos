import { ForbiddenException } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { PermissionService } from "./permission.service";
import { DataScopeService, type ScopeContext } from "./data-scope.service";
import type { DataScopeRepository } from "./data-scope.repository";
import type {
  CompanyRoleGrant,
  CompanyRoleGrantWithScope,
  IPermissionRepository,
  ObjectGrant,
  PermissionCatalogEntry,
} from "./permission.types";

/**
 * S2-QA-1 (qaSensitiveCoverage) — branch/line top-up for the crown-jewel DataScopeService so the
 * sensitive area (auth/permission/employees) stays ≥80% statements+branches at the UNIT level, NOT only
 * when integration specs run under LANE_DB. Targets the gaps the unit suite left uncovered (verified via
 * `vitest --coverage`): resolveContext() org-unit packing (lines 71-73) and the exact>wildcard /
 * fail-closed-null edges of resolveStrongestScope. Pure-logic only — no DB, runs in the no-DB CI unit run.
 *
 * CONTRACT PINS re-asserted (so a regression here is caught without a Postgres): fail-closed null on
 * infrastructure error, exact-beats-wildcard with no silent widening, Department-without-org_unit → 0 rows,
 * cross-tenant target out of scope for EVERY scope.
 */

class CoverageMockRepo implements IPermissionRepository {
  private grants: CompanyRoleGrantWithScope[] = [];
  private fail = false;

  withScopeGrants(grants: CompanyRoleGrantWithScope[]): this {
    this.grants = grants;
    return this;
  }
  withFailure(): this {
    this.fail = true;
    return this;
  }
  async getCompanyRoleGrants(): Promise<CompanyRoleGrant[]> {
    return [];
  }
  async getCompanyRoleGrantsWithScope(): Promise<CompanyRoleGrantWithScope[]> {
    if (this.fail) throw new Error("DB connection failed (simulated)");
    return this.grants;
  }
  async getObjectGrants(): Promise<ObjectGrant[]> {
    return [];
  }
  // HR-PERF-1 — interface requirement (data-scope coverage tests don't use object grants).
  async getObjectGrantsBatch(): Promise<Map<string, ObjectGrant[]>> {
    return new Map();
  }
  async getPermissionsByIds(): Promise<PermissionCatalogEntry[]> {
    return [];
  }
  async getAllPermissions(): Promise<PermissionCatalogEntry[]> {
    return [];
  }
}

function grant(
  action: string,
  resourceType: string,
  dataScope: string,
  effect: "ALLOW" | "DENY" = "ALLOW",
  isSensitive = false,
): CompanyRoleGrantWithScope {
  return { action, resourceType, isSensitive, effect, dataScope, expiresAt: null };
}

/** Records the args passed to the scope-context lookup so we assert tenant+user are forwarded verbatim. */
function spyRepo(
  orgUnitId: string | null,
  extra?: { managedUserIds?: string[]; headedOrgUnitIds?: string[] },
): {
  repo: DataScopeRepository;
  calls: Array<{ userId: string; companyId: string }>;
} {
  const calls: Array<{ userId: string; companyId: string }> = [];
  const repo = {
    getRequesterScopeContext: async (userId: string, companyId: string) => {
      calls.push({ userId, companyId });
      return {
        orgUnitId,
        managedUserIds: extra?.managedUserIds ?? [],
        headedOrgUnitIds: extra?.headedOrgUnitIds ?? [],
      };
    },
  } as unknown as DataScopeRepository;
  return { repo, calls };
}

const dialect = new PgDialect();
const render = (cond: SQL): string => dialect.sqlToQuery(cond).sql;

describe("DataScopeService.resolveContext (coverage: org-unit packing)", () => {
  it("packs a resolved org_unit into the ScopeContext and forwards (userId, companyId) verbatim", async () => {
    const { repo, calls } = spyRepo("ou-42");
    const svc = new DataScopeService(new PermissionService(new CoverageMockRepo()), repo);

    const ctx = await svc.resolveContext("user-1", "co-1");

    expect(ctx).toEqual({
      userId: "user-1",
      companyId: "co-1",
      orgUnitId: "ou-42",
      managedUserIds: [],
      headedOrgUnitIds: [],
    });
    expect(calls).toEqual([{ userId: "user-1", companyId: "co-1" }]);
  });

  it("packs orgUnitId=null when the requester has no employee profile (admin/console account)", async () => {
    const { repo } = spyRepo(null);
    const svc = new DataScopeService(new PermissionService(new CoverageMockRepo()), repo);

    const ctx = await svc.resolveContext("admin-1", "co-1");

    // Department scope then fail-closes to 0 rows for this context (asserted below).
    expect(ctx.orgUnitId).toBeNull();
    expect(render(svc.buildEmployeeScopeCondition("Department", ctx)).toLowerCase()).toContain(
      "false",
    );
  });
});

describe("DataScopeService.resolveStrongestScope (coverage: precedence + fail-closed edges)", () => {
  const ctx: ScopeContext = { userId: "u1", companyId: "co1", orgUnitId: "ou1" };

  function svcWith(grants: CompanyRoleGrantWithScope[]): DataScopeService {
    return new DataScopeService(
      new PermissionService(new CoverageMockRepo().withScopeGrants(grants)),
      spyRepo("ou1").repo,
    );
  }

  it("exact ALLOW beats a wider wildcard ALLOW — no silent widening (Team stays Team)", async () => {
    const svc = svcWith([grant("view", "employee", "Team"), grant("*", "*", "System")]);
    await expect(svc.resolveAndAssert("u1", "co1", "view", "employee")).resolves.toBe("Team");
  });

  it("strongest among multiple exact ALLOW grants (Own + Company → Company)", async () => {
    const svc = svcWith([grant("view", "employee", "Own"), grant("view", "employee", "Company")]);
    await expect(svc.resolveAndAssert("u1", "co1", "view", "employee")).resolves.toBe("Company");
  });

  it("a malformed dataScope on an otherwise-matching grant is ignored (normalizeScope→null path → 403)", async () => {
    // Only an unrecognised scope string matches → no eligible normalized scope → null → resolveAndAssert 403.
    const svc = svcWith([grant("view", "employee", "Galaxy")]);
    await expect(svc.resolveAndAssert("u1", "co1", "view", "employee")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("infrastructure error → fail-closed null → resolveAndAssert 403 (NEVER a wide scope, NEVER ALLOW)", async () => {
    const svc = new DataScopeService(
      new PermissionService(new CoverageMockRepo().withFailure()),
      spyRepo("ou1").repo,
    );
    await expect(svc.resolveAndAssert("u1", "co1", "view", "employee")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("buildEmployeeScopeCondition for every scope always carries company_id (belt over RLS)", () => {
    for (const scope of ["Own", "Team", "Department", "Company", "System"] as const) {
      expect(render(svc().buildEmployeeScopeCondition(scope, ctx))).toContain('"company_id"');
    }
  });

  function svc(): DataScopeService {
    return svcWith([]);
  }
});
