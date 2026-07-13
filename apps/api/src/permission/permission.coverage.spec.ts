import { beforeEach, describe, expect, it } from "vitest";
import { PermissionService } from "./permission.service";
import type {
  CompanyRoleGrant,
  CompanyRoleGrantWithScope,
  IPermissionRepository,
  ObjectGrant,
  PermissionCatalogEntry,
} from "./permission.types";

/**
 * S2-QA-1-FIX-B — statements/branches top-up for PermissionService so the crown-jewel sensitive area
 * (auth/permission) reaches ≥80% statements AND branches at the UNIT level (DoD §6, hard block) WITHOUT a
 * DB and WITHOUT lowering the threshold.
 *
 * Gap the prior round left (measured via `vitest --coverage`): permission.service.ts read 76.98% stmts
 * because `userGrantsPermissionIds()` (AC-5, lines ~387–431) and `listGrantableScopes()` (lines ~188–210)
 * were never exercised — every other mock returns `[]` from getPermissionsByIds/getAllPermissions, and the
 * getCapabilities() catch (lines ~245–251) had no failing repo. These are PURE company-tier logic (no
 * object/DB), so a no-DB unit spec deterministically covers them and keeps the per-file gate honest.
 *
 * Contract pins re-asserted (regression caught without Postgres):
 *   • PAT scope ⊆ user grant (fail-closed): wildcard does NOT satisfy a sensitive permission id.
 *   • deny-overrides-across-roles (wildcard-aware) removes a granted id.
 *   • infra error → [] / {} fail-safe for the catalog/hint paths (NOT a false ALLOW).
 */

class CatalogMockRepo implements IPermissionRepository {
  private companyGrants: CompanyRoleGrant[] = [];
  private catalog: PermissionCatalogEntry[] = [];
  private failCompany = false;
  private failCatalog = false;

  withCompanyGrants(grants: CompanyRoleGrant[]): this {
    this.companyGrants = grants;
    return this;
  }
  withCatalog(catalog: PermissionCatalogEntry[]): this {
    this.catalog = catalog;
    return this;
  }
  withCompanyFailure(): this {
    this.failCompany = true;
    return this;
  }
  withCatalogFailure(): this {
    this.failCatalog = true;
    return this;
  }

  async getCompanyRoleGrants(): Promise<CompanyRoleGrant[]> {
    if (this.failCompany) throw new Error("DB connection failed (simulated)");
    return this.companyGrants;
  }
  async getCompanyRoleGrantsWithScope(): Promise<CompanyRoleGrantWithScope[]> {
    return [];
  }
  async getObjectGrants(): Promise<ObjectGrant[]> {
    return [];
  }
  // HR-PERF-1 — interface requirement (not exercised by catalog coverage tests).
  async getObjectGrantsBatch(): Promise<Map<string, ObjectGrant[]>> {
    return new Map();
  }
  async getPermissionsByIds(permissionIds: string[]): Promise<PermissionCatalogEntry[]> {
    if (this.failCatalog) throw new Error("DB connection failed (simulated)");
    return this.catalog.filter((p) => permissionIds.includes(p.id));
  }
  async getAllPermissions(): Promise<PermissionCatalogEntry[]> {
    if (this.failCatalog) throw new Error("DB connection failed (simulated)");
    return this.catalog;
  }
}

const U = "user-cov-1";
const CO = "co-cov-1";
const PAST = new Date(Date.now() - 60_000);
const FUTURE = new Date(Date.now() + 3_600_000);

function rg(
  action: string,
  resourceType: string,
  effect: "ALLOW" | "DENY" = "ALLOW",
  opts: { isSensitive?: boolean; expiresAt?: Date | null } = {},
): CompanyRoleGrant {
  return {
    action,
    resourceType,
    isSensitive: opts.isSensitive ?? false,
    effect,
    expiresAt: opts.expiresAt ?? null,
  };
}

function cat(
  id: string,
  action: string,
  resourceType: string,
  isSensitive = false,
): PermissionCatalogEntry {
  return { id, action, resourceType, isSensitive };
}

describe("PermissionService.userGrantsPermissionIds (AC-5 — PAT scope ⊆ user grant, fail-closed)", () => {
  let repo: CatalogMockRepo;
  let svc: PermissionService;

  beforeEach(() => {
    repo = new CatalogMockRepo();
    svc = new PermissionService(repo);
  });

  it("empty id list → [] (short-circuit, no repo call)", async () => {
    await expect(svc.userGrantsPermissionIds(U, CO, [])).resolves.toEqual([]);
  });

  it("returns only ids the user effectively holds (ALLOW present, no DENY)", async () => {
    repo
      .withCatalog([
        cat("p-read", "read", "project"),
        cat("p-approve", "approve", "step"),
        cat("p-delete", "delete", "project"),
      ])
      .withCompanyGrants([rg("read", "project", "ALLOW"), rg("approve", "step", "ALLOW")]);
    const ids = await svc.userGrantsPermissionIds(U, CO, ["p-read", "p-approve", "p-delete"]);
    expect(ids.sort()).toEqual(["p-approve", "p-read"]);
  });

  it("wildcard *:* ALLOW satisfies a NON-sensitive permission id", async () => {
    repo.withCatalog([cat("p-read", "read", "project")]).withCompanyGrants([rg("*", "*", "ALLOW")]);
    await expect(svc.userGrantsPermissionIds(U, CO, ["p-read"])).resolves.toEqual(["p-read"]);
  });

  it("FAIL-CLOSED: wildcard *:* ALLOW does NOT satisfy a SENSITIVE permission id (mirror can())", async () => {
    repo
      .withCatalog([cat("p-salary", "view-salary", "payslip", true)])
      .withCompanyGrants([rg("*", "*", "ALLOW")]);
    await expect(svc.userGrantsPermissionIds(U, CO, ["p-salary"])).resolves.toEqual([]);
  });

  it("sensitive id IS satisfied by an exact non-wildcard sensitive ALLOW", async () => {
    repo
      .withCatalog([cat("p-salary", "view-salary", "payslip", true)])
      .withCompanyGrants([rg("view-salary", "payslip", "ALLOW", { isSensitive: true })]);
    await expect(svc.userGrantsPermissionIds(U, CO, ["p-salary"])).resolves.toEqual(["p-salary"]);
  });

  it("deny-overrides-across-roles (wildcard-aware) removes a granted id", async () => {
    repo
      .withCatalog([cat("p-read", "read", "project")])
      .withCompanyGrants([rg("read", "project", "ALLOW"), rg("*", "project", "DENY")]);
    await expect(svc.userGrantsPermissionIds(U, CO, ["p-read"])).resolves.toEqual([]);
  });

  it("expired ALLOW grant is ignored → id not held", async () => {
    repo
      .withCatalog([cat("p-read", "read", "project")])
      .withCompanyGrants([rg("read", "project", "ALLOW", { expiresAt: PAST })]);
    await expect(svc.userGrantsPermissionIds(U, CO, ["p-read"])).resolves.toEqual([]);
  });

  it("valid (future) ALLOW grant is honoured", async () => {
    repo
      .withCatalog([cat("p-read", "read", "project")])
      .withCompanyGrants([rg("read", "project", "ALLOW", { expiresAt: FUTURE })]);
    await expect(svc.userGrantsPermissionIds(U, CO, ["p-read"])).resolves.toEqual(["p-read"]);
  });

  it("unknown id (not in catalog) is silently dropped", async () => {
    repo
      .withCatalog([cat("p-read", "read", "project")])
      .withCompanyGrants([rg("read", "project", "ALLOW")]);
    const ids = await svc.userGrantsPermissionIds(U, CO, ["p-read", "p-ghost"]);
    expect(ids).toEqual(["p-read"]);
  });

  it("FAIL-CLOSED: catalog DB error → [] (caller refuses to grant a key it cannot validate)", async () => {
    repo.withCatalogFailure();
    await expect(svc.userGrantsPermissionIds(U, CO, ["p-read"])).resolves.toEqual([]);
  });

  it("FAIL-CLOSED: company-grant DB error → [] (no false grant on exception)", async () => {
    repo.withCatalog([cat("p-read", "read", "project")]).withCompanyFailure();
    await expect(svc.userGrantsPermissionIds(U, CO, ["p-read"])).resolves.toEqual([]);
  });
});

describe("PermissionService.listGrantableScopes (AC-5 — catalog ∩ real grant)", () => {
  let repo: CatalogMockRepo;
  let svc: PermissionService;

  beforeEach(() => {
    repo = new CatalogMockRepo();
    svc = new PermissionService(repo);
  });

  it("empty catalog → [] (short-circuit)", async () => {
    await expect(svc.listGrantableScopes(U, CO)).resolves.toEqual([]);
  });

  it("returns the catalog entries the user actually holds", async () => {
    repo
      .withCatalog([cat("p-read", "read", "project"), cat("p-approve", "approve", "step")])
      .withCompanyGrants([rg("read", "project", "ALLOW")]);
    const scopes = await svc.listGrantableScopes(U, CO);
    expect(scopes.map((s) => s.id)).toEqual(["p-read"]);
    expect(scopes[0]).toMatchObject({ action: "read", resourceType: "project" });
  });

  it("FAIL-SAFE: catalog DB error → [] (UI hint only; create re-checks scope ⊆ grant)", async () => {
    repo.withCatalogFailure();
    await expect(svc.listGrantableScopes(U, CO)).resolves.toEqual([]);
  });
});

describe("PermissionService.getCapabilities (catch — infra error → {} fail-safe)", () => {
  it("repo throws → returns empty map (UI hint never fails-closed like can())", async () => {
    const repo = new CatalogMockRepo().withCompanyFailure();
    const svc = new PermissionService(repo);
    await expect(svc.getCapabilities(U, CO)).resolves.toEqual({});
  });
});
