import { ForbiddenException } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
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
 * S2-AUTH-BE-2 — data-scope resolver (RED-first). Crown-jewel: a wrong rule here = cross-scope/tenant leak.
 * Pins (plan-review): exact>wildcard, no scope-upgrade, sensitive mirrors can(), isEmployeeInScope tenant-guard,
 * Team = reports ∪ self, predicate always carries company_id, fail-closed null.
 */

class ScopeMockRepo implements IPermissionRepository {
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
  async getPermissionsByIds(): Promise<PermissionCatalogEntry[]> {
    return [];
  }
  async getAllPermissions(): Promise<PermissionCatalogEntry[]> {
    return [];
  }
}

function g(
  action: string,
  resourceType: string,
  dataScope: string,
  effect: "ALLOW" | "DENY" = "ALLOW",
  isSensitive = false,
): CompanyRoleGrantWithScope {
  return { action, resourceType, isSensitive, effect, dataScope, expiresAt: null };
}

/** Stub repo for the requester scope-context lookup (Department/Team). */
function stubRepo(
  orgUnitId: string | null,
  extra?: { managedUserIds?: string[]; headedOrgUnitIds?: string[] },
): DataScopeRepository {
  return {
    getRequesterScopeContext: async () => ({
      orgUnitId,
      managedUserIds: extra?.managedUserIds ?? [],
      headedOrgUnitIds: extra?.headedOrgUnitIds ?? [],
    }),
  } as unknown as DataScopeRepository;
}

const dialect = new PgDialect();
const render = (cond: SQL): string => dialect.sqlToQuery(cond).sql;

describe("PermissionService.resolveStrongestScope", () => {
  it("picks the strongest scope across multiple exact ALLOW grants", async () => {
    const svc = new PermissionService(
      new ScopeMockRepo().withScopeGrants([
        g("view", "employee", "Own"),
        g("view", "employee", "Department"),
      ]),
    );
    expect(await svc.resolveStrongestScope("u1", "co1", "view", "employee")).toBe("Department");
  });

  it("returns null when a DENY override matches (deny-overrides, even with ALLOW present)", async () => {
    const svc = new PermissionService(
      new ScopeMockRepo().withScopeGrants([
        g("view", "employee", "Company"),
        g("view", "employee", "Company", "DENY"),
      ]),
    );
    expect(await svc.resolveStrongestScope("u1", "co1", "view", "employee")).toBeNull();
  });

  it("EXACT grant takes precedence over a broader wildcard (no silent widening)", async () => {
    // line-manager: exact Team + an unrelated role's *:* Company → MUST stay Team, not widen to Company.
    const svc = new PermissionService(
      new ScopeMockRepo().withScopeGrants([g("view", "employee", "Team"), g("*", "*", "Company")]),
    );
    expect(await svc.resolveStrongestScope("u1", "co1", "view", "employee")).toBe("Team");
  });

  it("falls back to wildcard scope only when no exact ALLOW exists — and never upgrades it", async () => {
    // wildcard carries its own dataScope ('Company'); it is NOT promoted to System.
    const svc = new PermissionService(
      new ScopeMockRepo().withScopeGrants([g("*", "*", "Company")]),
    );
    expect(await svc.resolveStrongestScope("u1", "co1", "view", "employee")).toBe("Company");
  });

  it("sensitive pair: a wildcard-only ALLOW does NOT satisfy → null (mirrors can() sensitive gate)", async () => {
    const svc = new PermissionService(
      new ScopeMockRepo().withScopeGrants([g("*", "*", "Company")]),
    );
    expect(
      await svc.resolveStrongestScope("u1", "co1", "view", "salary", { isSensitive: true }),
    ).toBeNull();
  });

  it("sensitive pair: an exact ALLOW resolves its scope", async () => {
    const svc = new PermissionService(
      new ScopeMockRepo().withScopeGrants([g("view", "salary", "Company", "ALLOW", true)]),
    );
    expect(
      await svc.resolveStrongestScope("u1", "co1", "view", "salary", { isSensitive: true }),
    ).toBe("Company");
  });

  it("returns null when no grant matches", async () => {
    const svc = new PermissionService(
      new ScopeMockRepo().withScopeGrants([g("view", "task", "Own")]),
    );
    expect(await svc.resolveStrongestScope("u1", "co1", "view", "employee")).toBeNull();
  });

  it("fail-closed null on infrastructure error (NEVER a wide scope)", async () => {
    const svc = new PermissionService(new ScopeMockRepo().withFailure());
    await expect(svc.resolveStrongestScope("u1", "co1", "view", "employee")).resolves.toBeNull();
  });
});

describe("DataScopeService.buildEmployeeScopeCondition", () => {
  const ctx: ScopeContext = { userId: "u1", companyId: "co1", orgUnitId: "ou1" };
  let svc: DataScopeService;
  beforeEach(() => {
    svc = new DataScopeService(new PermissionService(new ScopeMockRepo()), stubRepo("ou1"));
  });

  it("Own → company_id AND user_id", () => {
    const sql = render(svc.buildEmployeeScopeCondition("Own", ctx));
    expect(sql).toContain('"company_id"');
    expect(sql).toContain('"user_id"');
  });

  it("Team → company_id AND (direct_manager_id OR user_id) [reports ∪ self]", () => {
    const sql = render(svc.buildEmployeeScopeCondition("Team", ctx));
    expect(sql).toContain('"direct_manager_id"');
    expect(sql).toContain('"user_id"');
    expect(sql.toLowerCase()).toContain(" or ");
  });

  it("Department → company_id AND org_unit_id", () => {
    const sql = render(svc.buildEmployeeScopeCondition("Department", ctx));
    expect(sql).toContain('"org_unit_id"');
  });

  it("Company/System → company_id only (no user/org/manager narrowing, never a bare no-op)", () => {
    for (const scope of ["Company", "System"] as const) {
      const sql = render(svc.buildEmployeeScopeCondition(scope, ctx));
      expect(sql).toContain('"company_id"');
      expect(sql).not.toContain('"user_id"');
      expect(sql).not.toContain('"org_unit_id"');
      expect(sql).not.toContain('"direct_manager_id"');
    }
  });

  it("Department without a resolved org_unit → false (fail-closed, 0 rows)", () => {
    const noOrg: ScopeContext = { userId: "u1", companyId: "co1", orgUnitId: null };
    expect(render(svc.buildEmployeeScopeCondition("Department", noOrg)).toLowerCase()).toContain(
      "false",
    );
  });

  it("null/unknown scope → false (0 rows, never leaks)", () => {
    expect(render(svc.buildEmployeeScopeCondition(null, ctx)).toLowerCase()).toContain("false");
  });
});

describe("DataScopeService.isEmployeeInScope", () => {
  const ctx: ScopeContext = { userId: "u1", companyId: "co1", orgUnitId: "ou1" };
  const svc = new DataScopeService(new PermissionService(new ScopeMockRepo()), stubRepo("ou1"));

  it("cross-tenant target → false for EVERY scope (defense-in-depth over RLS)", () => {
    const foreign = { userId: "u1", companyId: "OTHER", orgUnitId: "ou1" };
    for (const scope of ["Own", "Team", "Department", "Company", "System"] as const) {
      expect(svc.isEmployeeInScope(scope, ctx, foreign)).toBe(false);
    }
  });

  it("Own: only the requester's own row", () => {
    expect(svc.isEmployeeInScope("Own", ctx, { userId: "u1", companyId: "co1" })).toBe(true);
    expect(svc.isEmployeeInScope("Own", ctx, { userId: "u2", companyId: "co1" })).toBe(false);
  });

  it("Team: direct reports OR self", () => {
    expect(
      svc.isEmployeeInScope("Team", ctx, {
        userId: "u2",
        companyId: "co1",
        directManagerUserId: "u1",
      }),
    ).toBe(true);
    expect(svc.isEmployeeInScope("Team", ctx, { userId: "u1", companyId: "co1" })).toBe(true); // self
    expect(
      svc.isEmployeeInScope("Team", ctx, {
        userId: "u3",
        companyId: "co1",
        directManagerUserId: "uX",
      }),
    ).toBe(false);
  });

  it("Department: same org unit only", () => {
    expect(
      svc.isEmployeeInScope("Department", ctx, {
        userId: "u2",
        companyId: "co1",
        orgUnitId: "ou1",
      }),
    ).toBe(true);
    expect(
      svc.isEmployeeInScope("Department", ctx, {
        userId: "u2",
        companyId: "co1",
        orgUnitId: "ou2",
      }),
    ).toBe(false);
  });

  it("Company/System: any same-tenant target", () => {
    expect(svc.isEmployeeInScope("Company", ctx, { userId: "u9", companyId: "co1" })).toBe(true);
    expect(svc.isEmployeeInScope("System", ctx, { userId: "u9", companyId: "co1" })).toBe(true);
  });

  it("null scope → false", () => {
    expect(svc.isEmployeeInScope(null, ctx, { userId: "u1", companyId: "co1" })).toBe(false);
  });
});

/**
 * S2-INT-2 — Team reads the EMR multi-manager set; Department reads own unit ∪ headed units. The
 * managed/headed sets are pre-resolved into ctx (resolveContext), so both the list predicate and the
 * in-memory check consume the SAME data → list and detail agree exactly. Deny-path RED: a manager sees
 * NOTHING outside their tree; cross-tenant still denies even for a managed/headed target.
 */
describe("S2-INT-2 Team/Department over employee_manager_relations + org-unit head", () => {
  const dialect2 = new PgDialect();
  const render2 = (cond: SQL): string => dialect2.sqlToQuery(cond).sql;

  describe("buildEmployeeScopeCondition", () => {
    const svc = new DataScopeService(new PermissionService(new ScopeMockRepo()), stubRepo("ou1"));

    it("Team with EMR-managed users → adds a user_id membership term (reports ∪ self ∪ managed)", () => {
      const ctx: ScopeContext = {
        userId: "u1",
        companyId: "co1",
        managedUserIds: ["m1", "m2"],
      };
      const q = dialect2.sqlToQuery(svc.buildEmployeeScopeCondition("Team", ctx));
      // direct_manager_id = u1 OR user_id = u1 OR user_id IN (m1, m2) → the managed ids are bound params.
      expect(q.sql).toContain('"direct_manager_id"');
      expect(q.sql.toLowerCase()).toContain(" in ");
      expect(q.params).toEqual(expect.arrayContaining(["m1", "m2"]));
    });

    it("Team WITHOUT managed users → still reports ∪ self only (no empty IN, never match-all)", () => {
      const ctx: ScopeContext = { userId: "u1", companyId: "co1", managedUserIds: [] };
      const sql = render2(svc.buildEmployeeScopeCondition("Team", ctx)).toLowerCase();
      expect(sql).toContain('"direct_manager_id"');
      expect(sql).not.toContain(" in ("); // no inArray term emitted for an empty managed set
    });

    it("Department over own unit ∪ headed units → org_unit_id membership carries both", () => {
      const ctx: ScopeContext = {
        userId: "u1",
        companyId: "co1",
        orgUnitId: "ouOwn",
        headedOrgUnitIds: ["ouHead"],
      };
      const q = dialect2.sqlToQuery(svc.buildEmployeeScopeCondition("Department", ctx));
      expect(q.sql).toContain('"org_unit_id"');
      expect(q.params).toEqual(expect.arrayContaining(["ouOwn", "ouHead"]));
    });

    it("Department with neither own nor headed unit → false (fail-closed, 0 rows)", () => {
      const ctx: ScopeContext = {
        userId: "u1",
        companyId: "co1",
        orgUnitId: null,
        headedOrgUnitIds: [],
      };
      expect(render2(svc.buildEmployeeScopeCondition("Department", ctx)).toLowerCase()).toContain(
        "false",
      );
    });

    it("Department for a head with no own profile → headed units only (head still sees their unit)", () => {
      const ctx: ScopeContext = {
        userId: "u1",
        companyId: "co1",
        orgUnitId: null,
        headedOrgUnitIds: ["ouHead"],
      };
      const q = dialect2.sqlToQuery(svc.buildEmployeeScopeCondition("Department", ctx));
      expect(q.sql).toContain('"org_unit_id"');
      expect(q.params).toEqual(expect.arrayContaining(["ouHead"]));
    });
  });

  describe("isEmployeeInScope (list/detail parity)", () => {
    const svc = new DataScopeService(new PermissionService(new ScopeMockRepo()), stubRepo("ou1"));

    it("Team: an EMR-managed employee (NOT a direct report) is IN scope", () => {
      const ctx: ScopeContext = { userId: "mgr", companyId: "co1", managedUserIds: ["emp"] };
      expect(
        svc.isEmployeeInScope("Team", ctx, {
          userId: "emp",
          companyId: "co1",
          directManagerUserId: "someoneElse", // not the direct manager — managed only via EMR
        }),
      ).toBe(true);
    });

    it("Team DENY: an employee neither managed, nor a direct report, nor self → OUT of scope", () => {
      const ctx: ScopeContext = { userId: "mgr", companyId: "co1", managedUserIds: ["emp"] };
      expect(
        svc.isEmployeeInScope("Team", ctx, {
          userId: "stranger",
          companyId: "co1",
          directManagerUserId: "otherMgr",
        }),
      ).toBe(false);
    });

    it("Department: an employee in a HEADED unit (head's own profile elsewhere) is IN scope", () => {
      const ctx: ScopeContext = {
        userId: "head",
        companyId: "co1",
        orgUnitId: "ouHeadHome",
        headedOrgUnitIds: ["ouHeaded"],
      };
      expect(
        svc.isEmployeeInScope("Department", ctx, {
          userId: "emp",
          companyId: "co1",
          orgUnitId: "ouHeaded",
        }),
      ).toBe(true);
    });

    it("Department DENY: an employee outside both own and headed units → OUT of scope", () => {
      const ctx: ScopeContext = {
        userId: "head",
        companyId: "co1",
        orgUnitId: "ouHome",
        headedOrgUnitIds: ["ouHeaded"],
      };
      expect(
        svc.isEmployeeInScope("Department", ctx, {
          userId: "emp",
          companyId: "co1",
          orgUnitId: "ouFar",
        }),
      ).toBe(false);
    });

    it("cross-tenant DENY: a managed/headed target in ANOTHER company is still OUT for Team & Department", () => {
      const ctx: ScopeContext = {
        userId: "mgr",
        companyId: "co1",
        managedUserIds: ["emp"],
        headedOrgUnitIds: ["ouHeaded"],
      };
      expect(svc.isEmployeeInScope("Team", ctx, { userId: "emp", companyId: "OTHER" })).toBe(false);
      expect(
        svc.isEmployeeInScope("Department", ctx, {
          userId: "emp",
          companyId: "OTHER",
          orgUnitId: "ouHeaded",
        }),
      ).toBe(false);
    });
  });

  describe("resolveContext (fresh read, no stale cache)", () => {
    it("packs managedUserIds + headedOrgUnitIds from the repo into the context", async () => {
      const svc = new DataScopeService(
        new PermissionService(new ScopeMockRepo()),
        stubRepo("ouOwn", { managedUserIds: ["e1", "e2"], headedOrgUnitIds: ["ouH"] }),
      );
      const ctx = await svc.resolveContext("u1", "co1");
      expect(ctx).toEqual({
        userId: "u1",
        companyId: "co1",
        orgUnitId: "ouOwn",
        managedUserIds: ["e1", "e2"],
        headedOrgUnitIds: ["ouH"],
      });
    });

    it("re-reads the repo every call (a direct_manager/EMR change is reflected, not cached)", async () => {
      let managed = ["e1"];
      const repo = {
        getRequesterScopeContext: async () => ({
          orgUnitId: null,
          managedUserIds: managed,
          headedOrgUnitIds: [],
        }),
      } as unknown as DataScopeRepository;
      const svc = new DataScopeService(new PermissionService(new ScopeMockRepo()), repo);

      expect((await svc.resolveContext("u1", "co1")).managedUserIds).toEqual(["e1"]);
      managed = ["e1", "e2"]; // manager gains a new report between requests
      expect((await svc.resolveContext("u1", "co1")).managedUserIds).toEqual(["e1", "e2"]);
    });
  });
});

describe("DataScopeService.resolveAndAssert", () => {
  it("throws ForbiddenException when the user has no grant for the pair (403 gate)", async () => {
    const svc = new DataScopeService(
      new PermissionService(new ScopeMockRepo().withScopeGrants([])),
      stubRepo(null),
    );
    await expect(svc.resolveAndAssert("u1", "co1", "view", "employee")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("returns the granted scope when permitted", async () => {
    const svc = new DataScopeService(
      new PermissionService(new ScopeMockRepo().withScopeGrants([g("view", "employee", "Own")])),
      stubRepo(null),
    );
    await expect(svc.resolveAndAssert("u1", "co1", "view", "employee")).resolves.toBe("Own");
  });
});
