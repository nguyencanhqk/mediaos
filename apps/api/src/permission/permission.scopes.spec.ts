import { describe, expect, it } from "vitest";
import { DATA_SCOPES } from "@mediaos/contracts";
import { ROLE_DATA_SCOPES } from "../db/schema";
import { PermissionService } from "./permission.service";
import type {
  CompanyRoleGrant,
  CompanyRoleGrantWithScope,
  IPermissionRepository,
  ObjectGrant,
  PermissionCatalogEntry,
} from "./permission.types";

/**
 * S2-AUTH-BE-1 — getCapabilityScopes + DATA_SCOPES↔ROLE_DATA_SCOPES sync (RED-first deny-path).
 * Scopes feed /auth/me bootstrap (BACKEND-03 §15.3 rule 6): union per ALLOW non-sensitive pair, deduped,
 * DENY-suppressed pairs excluded, infra-error → {}.
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

describe("DATA_SCOPES contract ↔ ROLE_DATA_SCOPES schema sync", () => {
  it("contract DATA_SCOPES equals apps/api ROLE_DATA_SCOPES (no drift)", () => {
    expect([...DATA_SCOPES]).toEqual([...ROLE_DATA_SCOPES]);
  });
});

describe("PermissionService.getCapabilityScopes", () => {
  it("unions data_scope across roles for the same ALLOW pair, deduped", async () => {
    const repo = new ScopeMockRepo().withScopeGrants([
      g("view", "employee", "Own"),
      g("view", "employee", "Department"),
      g("view", "employee", "Department"), // dup → collapses
    ]);
    const svc = new PermissionService(repo);

    const scopes = await svc.getCapabilityScopes("u1", "co1");

    expect(scopes["view:employee"]).toBeDefined();
    expect([...scopes["view:employee"]].sort()).toEqual(["Department", "Own"]);
  });

  it("excludes a pair entirely when a DENY override matches (not union'd)", async () => {
    const repo = new ScopeMockRepo().withScopeGrants([
      g("view", "employee", "Company"),
      g("view", "employee", "Company", "DENY"),
    ]);
    const svc = new PermissionService(repo);

    const scopes = await svc.getCapabilityScopes("u1", "co1");

    expect(scopes["view:employee"]).toBeUndefined();
  });

  it("omits sensitive grants (keyset mirrors getCapabilities)", async () => {
    const repo = new ScopeMockRepo().withScopeGrants([
      g("view", "salary", "Company", "ALLOW", true),
    ]);
    const svc = new PermissionService(repo);

    const scopes = await svc.getCapabilityScopes("u1", "co1");

    expect(scopes["view:salary"]).toBeUndefined();
  });

  it("returns {} on infrastructure error (fail-safe UI hint, never throws)", async () => {
    const repo = new ScopeMockRepo().withFailure();
    const svc = new PermissionService(repo);

    await expect(svc.getCapabilityScopes("u1", "co1")).resolves.toEqual({});
  });
});
