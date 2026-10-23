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
import { sentinelCatalog } from "../../test/helpers/permission-catalog-fixture";

/**
 * S2-AUTH-BE-1 — getCapabilityScopes + DATA_SCOPES↔ROLE_DATA_SCOPES sync (RED-first deny-path).
 * Scopes feed /auth/me bootstrap (BACKEND-03 §15.3 rule 6): union per ALLOW non-sensitive pair, deduped,
 * DENY-suppressed pairs excluded, infra-error → {}.
 */

class ScopeMockRepo implements IPermissionRepository {
  private grants: CompanyRoleGrantWithScope[] = [];
  private fail = false;
  private catalog: PermissionCatalogEntry[] = sentinelCatalog();

  withScopeGrants(grants: CompanyRoleGrantWithScope[]): this {
    this.grants = grants;
    return this;
  }
  withFailure(): this {
    this.fail = true;
    return this;
  }
  withCatalog(rows: PermissionCatalogEntry[]): this {
    this.catalog = rows;
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
  // HR-PERF-1 — interface requirement (not exercised by scope tests).
  async getObjectGrantsBatch(): Promise<Map<string, ObjectGrant[]>> {
    return new Map();
  }
  async getPermissionsByIds(): Promise<PermissionCatalogEntry[]> {
    return [];
  }
  // ADR DECISIONS-12 D9 — catalog RỖNG là trạng thái SUY BIẾN (hạ tầng hỏng), không phải
  // "không có cặp nhạy cảm nào". Spec này không đo sensitivity, nên nó trả một catalog KHÔNG
  // RỖNG mà mọi cặp nó kiểm đều VẮNG ⇒ `false` theo D3 = y hệt hành vi trước D9.
  async getAllPermissions(): Promise<PermissionCatalogEntry[]> {
    return this.catalog.map((r) => ({ ...r }));
  }
}

/** S14-SEC-CAPWILDCARD-1 §9.4 — cặp sensitive + hàng wildcard view:* cho hai ca đảo nghĩa. */
const SALARY_SENSITIVE_ROW: PermissionCatalogEntry = {
  id: "00000000-0000-4000-8000-0000000005a1",
  action: "view",
  resourceType: "salary",
  isSensitive: true,
};
const VIEW_STAR_ROW: PermissionCatalogEntry = {
  id: "00000000-0000-4000-8000-0000000005a2",
  action: "view",
  resourceType: "*",
  isSensitive: false,
};

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

  // S14-SEC-CAPWILDCARD-1 (plan §9.4) — ca cũ «omits sensitive grants» ĐẢO NGHĨA dưới DECISIONS-13 §4 và
  // từng xanh-RỖNG (view:salary vắng vì catalog stub không có cặp đó). Tách hai ca, catalog có view:salary
  // cờ `true` để vế sensitive thật sự được đo. Keyset vẫn mirror getCapabilities.
  it("sensitive + grant EXACT ⇒ scopes CÓ cặp (keyset mirrors getCapabilities)", async () => {
    const repo = new ScopeMockRepo()
      .withScopeGrants([g("view", "salary", "Company", "ALLOW", true)])
      .withCatalog([SALARY_SENSITIVE_ROW, VIEW_STAR_ROW]);
    const svc = new PermissionService(repo);

    expect(await svc.getCapabilityScopes("u1", "co1")).toEqual({ "view:salary": ["Company"] });
  });

  it("sensitive + CHỈ wildcard ⇒ scopes VẮNG cặp", async () => {
    const repo = new ScopeMockRepo()
      .withScopeGrants([g("view", "*", "Company")])
      .withCatalog([SALARY_SENSITIVE_ROW, VIEW_STAR_ROW]);
    const svc = new PermissionService(repo);

    expect(await svc.getCapabilityScopes("u1", "co1")).toEqual({});
  });

  it("returns {} on infrastructure error (fail-safe UI hint, never throws)", async () => {
    const repo = new ScopeMockRepo().withFailure();
    const svc = new PermissionService(repo);

    await expect(svc.getCapabilityScopes("u1", "co1")).resolves.toEqual({});
  });
});
