/**
 * S2-FND-BE-4 (fix-hr-contract-resolver) — HrContractFileResolver unit + registry-dispatch spec.
 *
 * RED-first allow/deny-path suite that closes the CRITICAL regression found in review: after H1
 * (link-aware, fail-closed file policy) a file linked to an HR contract via the REAL pair used by the
 * shipped feature — moduleCode='HR', entityType='contract' (see ContractService.linkFile / CONTRACT_ENTITY,
 * lowercase) — had NO registered resolver, so FilePolicyService.decideForLinkedFile returned
 * 'deny-no-resolver' → 403 on the already-shipped "Download contract" button (EmployeeContractsPage) for
 * EVERY user. These tests pin:
 *   1. Identity uses the REAL pair 'contract' (lowercase) — NEVER the fictitious 'EmployeeContract'.
 *   2. view/download mirror ContractService.getById READ scope (resolve data_scope view:contract →
 *      findScopeTargetTx inside withTenant → isEmployeeInScope; fail-closed on not-found/out-of-scope; a
 *      thrown no-grant propagates so the policy layer maps it to deny-error).
 *   3. link/delete/unlink mirror manage:contract (Company-only) via PermissionService.can.
 *   4. Registered in a real FilePolicyService, the ('HR','contract') pair DISPATCHES to the resolver
 *      (allow-resolver / deny-resolver / deny-error) and NO LONGER short-circuits to 'deny-no-resolver'
 *      nor escalates to the FOUNDATION.FILE.* fallback.
 */

import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { DataScope } from "@mediaos/contracts";
import type { DatabaseService } from "../db/db.service";
import type { DataScopeService } from "../permission/data-scope.service";
import type { PermissionService } from "../permission/permission.service";
import {
  FilePolicyService,
  type FilePermissionChecker,
} from "../foundation/files/file-policy.service";
import {
  FilePolicyAction,
  type FileLinkRef,
  type FilePermissionInput,
} from "../foundation/files/file-policy.types";
import type { ContractRepository, ContractScopeTarget } from "./contract.repository";
import { HrContractFileResolver } from "./hr-contract-file.resolver";

const CO = "co-1";
const USER = "user-1";
const CONTRACT_ID = "contract-1";

const baseInput = (overrides: Partial<FilePermissionInput> = {}): FilePermissionInput => ({
  companyId: CO,
  userId: USER,
  fileId: "file-1",
  moduleCode: "HR",
  entityType: "contract",
  entityId: CONTRACT_ID,
  action: FilePolicyAction.View,
  ...overrides,
});

function makeTarget(): ContractScopeTarget {
  return {
    userId: "emp-user-1",
    companyId: CO,
    orgUnitId: "org-1",
    directManagerUserId: "mgr-1",
  };
}

interface ResolverCfg {
  /** resolveAndAssert throws (no view:contract grant) → mirrors getById's 403 → policy deny-error. */
  scopeThrows?: boolean;
  /** the strongest resolved data_scope (default Company). */
  scope?: DataScope;
  /** findScopeTargetTx returns undefined (contract not found / cross-tenant RLS 0-row). */
  notFound?: boolean;
  /** isEmployeeInScope verdict (default true). */
  inScope?: boolean;
  /** PermissionService.can().allow for manage:contract (default true). */
  canManage?: boolean;
}

function buildResolver(cfg: ResolverCfg = {}) {
  const fakeTx = {} as never;
  const withTenant = vi.fn(async (_co: string, fn: (tx: never) => unknown) => fn(fakeTx));
  const resolveAndAssert = vi.fn(async (): Promise<DataScope> => {
    if (cfg.scopeThrows)
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope");
    return cfg.scope ?? "Company";
  });
  const resolveContext = vi.fn(async () => ({ userId: USER, companyId: CO }));
  const isEmployeeInScope = vi.fn(() => cfg.inScope ?? true);
  const findScopeTargetTx = vi.fn(async () => (cfg.notFound ? undefined : makeTarget()));
  const can = vi.fn(async () => ({
    allow: cfg.canManage ?? true,
    reason: "allow" as const,
    auditRequired: false,
  }));

  const resolver = new HrContractFileResolver(
    { withTenant } as unknown as DatabaseService,
    { resolveAndAssert, resolveContext, isEmployeeInScope } as unknown as DataScopeService,
    { can } as unknown as PermissionService,
    { findScopeTargetTx } as unknown as ContractRepository,
  );
  return {
    resolver,
    fns: {
      withTenant,
      resolveAndAssert,
      resolveContext,
      isEmployeeInScope,
      findScopeTargetTx,
      can,
    },
  };
}

// A fallback checker that would ALLOW — proves a matched resolver short-circuits the FOUNDATION.FILE.*
// fallback (a broad download:foundation-file grant must NEVER read a module-owned contract file).
const allowAllChecker: FilePermissionChecker = {
  can: async () => ({ allow: true, reason: "allow", auditRequired: false }),
};

describe("HrContractFileResolver — identity (REAL pair, not fictitious)", () => {
  it("owns moduleCode='HR' and entityTypes=['contract'] (lowercase, matching ContractService.linkFile)", () => {
    const { resolver } = buildResolver();
    expect(resolver.moduleCode).toBe("HR");
    expect([...resolver.entityTypes]).toEqual(["contract"]);
    // Guard against the known drift trap: NEVER register under the fictitious PascalCase name.
    expect([...resolver.entityTypes]).not.toContain("EmployeeContract");
  });
});

describe("HrContractFileResolver — view/download mirror contract READ scope", () => {
  it("in-scope contract → canViewFile/canDownloadFile true (resolve view:contract, tenant-scoped)", async () => {
    const { resolver, fns } = buildResolver({ scope: "Own", inScope: true });

    await expect(resolver.canViewFile(baseInput())).resolves.toBe(true);
    await expect(resolver.canDownloadFile(baseInput())).resolves.toBe(true);

    // Mirrors getById exactly: strongest scope for the ('view','contract') pair.
    expect(fns.resolveAndAssert).toHaveBeenCalledWith(USER, CO, "view", "contract");
    // BẤT BIẾN #1 — the scope-target load runs inside withTenant(companyId).
    expect(fns.withTenant).toHaveBeenCalledWith(CO, expect.any(Function));
    expect(fns.findScopeTargetTx).toHaveBeenCalledWith(expect.anything(), CO, CONTRACT_ID);
  });

  it("out-of-scope contract → false (fail-closed; NOT a fallback-allow)", async () => {
    const { resolver, fns } = buildResolver({ scope: "Own", inScope: false });
    await expect(resolver.canDownloadFile(baseInput())).resolves.toBe(false);
    expect(fns.isEmployeeInScope).toHaveBeenCalledTimes(1);
  });

  it("contract not found / cross-tenant (0-row) → false without consulting isEmployeeInScope", async () => {
    const { resolver, fns } = buildResolver({ notFound: true });
    await expect(resolver.canViewFile(baseInput())).resolves.toBe(false);
    expect(fns.isEmployeeInScope).not.toHaveBeenCalled();
  });

  it("no view:contract grant → resolveAndAssert throws → propagates (policy maps to deny-error)", async () => {
    const { resolver, fns } = buildResolver({ scopeThrows: true });
    await expect(resolver.canDownloadFile(baseInput())).rejects.toBeInstanceOf(ForbiddenException);
    // Short-circuits BEFORE any DB read — no tenant tx opened, no scope-target loaded.
    expect(fns.withTenant).not.toHaveBeenCalled();
    expect(fns.findScopeTargetTx).not.toHaveBeenCalled();
  });
});

describe("HrContractFileResolver — link/delete/unlink mirror manage:contract (Company-only)", () => {
  it("manage granted → canLinkFile/canDeleteFile/canUnlinkFile true", async () => {
    const { resolver, fns } = buildResolver({ canManage: true });

    await expect(resolver.canLinkFile(baseInput())).resolves.toBe(true);
    await expect(resolver.canDeleteFile(baseInput())).resolves.toBe(true);
    await expect(resolver.canUnlinkFile(baseInput())).resolves.toBe(true);

    expect(fns.can).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        companyId: CO,
        action: "manage",
        resourceType: "contract",
      }),
    );
    // manage is a permission gate, NOT a data-scope read — must not touch the READ path.
    expect(fns.resolveAndAssert).not.toHaveBeenCalled();
    expect(fns.findScopeTargetTx).not.toHaveBeenCalled();
  });

  it("manage denied → canLinkFile/canDeleteFile/canUnlinkFile false", async () => {
    const { resolver } = buildResolver({ canManage: false });
    await expect(resolver.canLinkFile(baseInput())).resolves.toBe(false);
    await expect(resolver.canDeleteFile(baseInput())).resolves.toBe(false);
    await expect(resolver.canUnlinkFile(baseInput())).resolves.toBe(false);
  });
});

describe("HrContractFileResolver — FilePolicyService registry dispatch (the fix)", () => {
  const link: FileLinkRef = { moduleCode: "HR", entityType: "contract", entityId: CONTRACT_ID };

  it("BEFORE registration: a real HR-contract-linked file → deny-no-resolver (the regression)", async () => {
    const policy = new FilePolicyService(allowAllChecker);
    const decision = await policy.decideForLinkedFile(
      baseInput({ action: FilePolicyAction.Download }),
      [link],
      FilePolicyAction.Download,
    );
    // This is exactly the 403 the shipped download button hit before this WO.
    expect(decision).toEqual({ allow: false, reason: "deny-no-resolver" });
  });

  it("AFTER registration + in-scope → allow-resolver; FOUNDATION.FILE.* fallback NOT reached", async () => {
    const policy = new FilePolicyService(allowAllChecker);
    const { resolver, fns } = buildResolver({ scope: "Own", inScope: true });
    policy.registerResolver(resolver);

    const decision = await policy.decideForLinkedFile(
      baseInput(),
      [link],
      FilePolicyAction.Download,
    );

    expect(decision).toEqual({ allow: true, reason: "allow-resolver" });
    // The resolver actually ran the READ-scope path (not the allow-all fallback → would be allow-foundation).
    expect(fns.resolveAndAssert).toHaveBeenCalledWith(USER, CO, "view", "contract");
  });

  it("AFTER registration + out-of-scope → deny-resolver (no escalation to allow-foundation)", async () => {
    const policy = new FilePolicyService(allowAllChecker);
    const { resolver } = buildResolver({ scope: "Own", inScope: false });
    policy.registerResolver(resolver);

    const decision = await policy.decideForLinkedFile(
      baseInput(),
      [link],
      FilePolicyAction.Download,
    );
    expect(decision).toEqual({ allow: false, reason: "deny-resolver" });
  });

  it("AFTER registration + no view grant (resolver throws) → deny-error (fail-closed)", async () => {
    const policy = new FilePolicyService(allowAllChecker);
    const { resolver } = buildResolver({ scopeThrows: true });
    policy.registerResolver(resolver);

    const decision = await policy.decideForLinkedFile(
      baseInput(),
      [link],
      FilePolicyAction.Download,
    );
    expect(decision).toEqual({ allow: false, reason: "deny-error" });
  });

  it("hasResolver: REAL ('HR','contract') true; fictitious ('HR','EmployeeContract') false", () => {
    const policy = new FilePolicyService(allowAllChecker);
    const { resolver } = buildResolver();
    policy.registerResolver(resolver);
    expect(policy.hasResolver("HR", "contract")).toBe(true);
    // Case/whitespace-insensitive: 'CONTRACT' still matches the real pair.
    expect(policy.hasResolver(" hr ", "CONTRACT")).toBe(true);
    // The fictitious PascalCase entity remains unregistered (would still deny-no-resolver).
    expect(policy.hasResolver("HR", "EmployeeContract")).toBe(false);
  });

  it("manage-mirroring dispatch: Delete/Link/Unlink route through manage:contract verdict", async () => {
    const policy = new FilePolicyService(allowAllChecker);
    const { resolver, fns } = buildResolver({ canManage: false });
    policy.registerResolver(resolver);

    const del = await policy.decideForLinkedFile(baseInput(), [link], FilePolicyAction.Delete);
    expect(del).toEqual({ allow: false, reason: "deny-resolver" });
    expect(fns.can).toHaveBeenCalledWith(
      expect.objectContaining({ action: "manage", resourceType: "contract" }),
    );
  });
});
