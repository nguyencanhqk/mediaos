/**
 * FOUNDATION-BE-5 — Deny-path / contract RED suite for FilePolicyService.
 *
 * Crown-jewel (fail-closed access decision). All tests written BEFORE implementation (RED).
 * Spec: BACKEND-04 §11.4 (resolver interface + registry) · BACKEND-11 §11.10 (dispatch by
 * module_code/entity_type, deny-by-default) · CLAUDE.md §2/§3 (company_id every branch, fail-closed).
 *
 * Cases (micro-plan redTests):
 *   1. deny-by-default — no resolver AND no FOUNDATION.FILE.* → every action DENY
 *   2. resolver-dispatch — registry picks the EXACT resolver for (module_code, entity_type)
 *   3. resolver-deny — matched resolver returns false → DENY (no fallback escalation)
 *   4. fallback-allow — no resolver but PermissionService.can() ALLOW → ALLOW (correct action map)
 *   5. fallback-deny — no resolver and can() deny → DENY
 *   6. fail-closed-on-throw — resolver throws OR can() throws → DENY + log, never false-ALLOW
 *   7. tenant-guard — missing companyId/userId → DENY
 *   8. duplicate-registration — two resolvers same (module,entity) → loud-fail throw
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FilePolicyService, type FilePermissionChecker } from "./file-policy.service";
import { FilePolicyAction, type FilePermissionInput } from "./file-policy.types";
import type { FileOwnerPermissionResolver } from "./resolvers/file-owner-permission-resolver";
import type { PermissionDecision } from "../../permission/permission.types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

type CanCall = { userId: string; companyId: string; action: string; resourceType: string };

function allowDecision(): PermissionDecision {
  return { allow: true, reason: "allow", auditRequired: false };
}

function denyDecision(reason: PermissionDecision["reason"] = "deny-default"): PermissionDecision {
  return { allow: false, reason, auditRequired: false };
}

/** Permission service mock — records calls so we can assert tenant scope + action mapping. */
function makePermissionMock(decision: PermissionDecision | (() => never)): {
  service: FilePermissionChecker;
  calls: CanCall[];
} {
  const calls: CanCall[] = [];
  const service: FilePermissionChecker = {
    can: vi.fn(async (input) => {
      calls.push({
        userId: input.userId,
        companyId: input.companyId,
        action: input.action,
        resourceType: input.resourceType,
      });
      if (typeof decision === "function") return decision();
      return decision;
    }),
  };
  return { service, calls };
}

/** Build a resolver that records which method was called and returns the configured verdict. */
function makeResolver(
  moduleCode: string,
  entityTypes: string[] | undefined,
  verdict: boolean | "throw",
): FileOwnerPermissionResolver & { calls: string[] } {
  const calls: string[] = [];
  const decide = async (): Promise<boolean> => {
    if (verdict === "throw") throw new Error("resolver boom");
    return verdict;
  };
  return {
    moduleCode,
    entityTypes,
    calls,
    canViewFile: vi.fn(async (i: FilePermissionInput) => {
      calls.push(`view:${i.entityType}`);
      return decide();
    }),
    canDownloadFile: vi.fn(async (i: FilePermissionInput) => {
      calls.push(`download:${i.entityType}`);
      return decide();
    }),
    canLinkFile: vi.fn(async (i: FilePermissionInput) => {
      calls.push(`link:${i.entityType}`);
      return decide();
    }),
    canDeleteFile: vi.fn(async (i: FilePermissionInput) => {
      calls.push(`delete:${i.entityType}`);
      return decide();
    }),
  };
}

const baseInput = (overrides: Partial<FilePermissionInput> = {}): FilePermissionInput => ({
  companyId: "co-1",
  userId: "user-1",
  fileId: "file-1",
  moduleCode: "HR",
  entityType: "EmployeeContract",
  entityId: "ent-1",
  action: FilePolicyAction.Download,
  ...overrides,
});

// ─── Suite ──────────────────────────────────────────────────────────────────

describe("FilePolicyService", () => {
  let permission: ReturnType<typeof makePermissionMock>;
  let service: FilePolicyService;

  beforeEach(() => {
    permission = makePermissionMock(denyDecision());
    service = new FilePolicyService(permission.service);
  });

  // 1. deny-by-default ──────────────────────────────────────────────────────
  describe("deny-by-default (fail-closed)", () => {
    it("denies every action when no resolver matches AND user has no FOUNDATION.FILE.*", async () => {
      const input = baseInput({ moduleCode: "UNKNOWN", entityType: "Mystery" });

      expect((await service.canView(input)).allow).toBe(false);
      expect((await service.canDownload(input)).allow).toBe(false);
      expect((await service.canLink(input)).allow).toBe(false);
      expect((await service.canDelete(input)).allow).toBe(false);
    });
  });

  // 2. resolver-dispatch ──────────────────────────────────────────────────────
  describe("resolver dispatch by (module_code, entity_type)", () => {
    it("picks the exact resolver for the matching (module, entity); wrong resolver is NOT called", async () => {
      const hrContract = makeResolver("HR", ["EmployeeContract"], true);
      const leaveAttach = makeResolver("LEAVE", ["LeaveAttachment"], true);
      service.registerResolver(hrContract);
      service.registerResolver(leaveAttach);

      const decision = await service.canDownload(
        baseInput({ moduleCode: "HR", entityType: "EmployeeContract" }),
      );

      expect(decision.allow).toBe(true);
      expect(hrContract.calls).toEqual(["download:EmployeeContract"]);
      expect(leaveAttach.calls).toEqual([]); // wrong module/entity never invoked
      expect(permission.calls).toHaveLength(0); // fallback NOT used when a resolver matched
    });

    it("normalizes case/whitespace so registration and lookup agree", async () => {
      const hr = makeResolver("hr", ["employeecontract"], true);
      service.registerResolver(hr);

      const decision = await service.canDownload(
        baseInput({ moduleCode: "  HR ", entityType: "EmployeeContract" }),
      );

      expect(decision.allow).toBe(true);
      expect(hr.calls).toEqual(["download:EmployeeContract"]);
    });
  });

  // 3. resolver-deny (no escalation) ──────────────────────────────────────────
  describe("resolver deny is final", () => {
    it("returns DENY when matched resolver returns false — does NOT fall through to FOUNDATION.FILE.*", async () => {
      const hr = makeResolver("HR", ["EmployeeContract"], false);
      // permission would ALLOW if consulted — proves no escalation path
      const grant = makePermissionMock(allowDecision());
      service = new FilePolicyService(grant.service);
      service.registerResolver(hr);

      const decision = await service.canDownload(
        baseInput({ moduleCode: "HR", entityType: "EmployeeContract" }),
      );

      expect(decision.allow).toBe(false);
      expect(grant.calls).toHaveLength(0); // fallback must NOT run
    });
  });

  // 4. fallback-allow ─────────────────────────────────────────────────────────
  describe("fallback to FOUNDATION.FILE.* when no resolver registered", () => {
    it("allows when PermissionService.can() ALLOWs and maps each action to the right permission", async () => {
      const grant = makePermissionMock(allowDecision());
      service = new FilePolicyService(grant.service);
      const input = baseInput({ moduleCode: "UNKNOWN", entityType: "Mystery" });

      expect((await service.canView(input)).allow).toBe(true);
      expect((await service.canDownload(input)).allow).toBe(true);
      expect((await service.canLink(input)).allow).toBe(true);
      expect((await service.canDelete(input)).allow).toBe(true);

      const actions = grant.calls.map((c) => c.action);
      expect(actions).toEqual(["view", "download", "link", "delete"]);
      expect(grant.calls.every((c) => c.resourceType === "foundation-file")).toBe(true);
    });
  });

  // 5. fallback-deny ──────────────────────────────────────────────────────────
  describe("fallback denies when can() does not allow", () => {
    it("denies on deny-default", async () => {
      const grant = makePermissionMock(denyDecision("deny-default"));
      service = new FilePolicyService(grant.service);
      expect(
        (await service.canDownload(baseInput({ moduleCode: "X", entityType: "Y" }))).allow,
      ).toBe(false);
    });

    it("denies on deny-sensitive", async () => {
      const grant = makePermissionMock(denyDecision("deny-sensitive"));
      service = new FilePolicyService(grant.service);
      expect((await service.canView(baseInput({ moduleCode: "X", entityType: "Y" }))).allow).toBe(
        false,
      );
    });
  });

  // 6. fail-closed-on-throw ───────────────────────────────────────────────────
  describe("fail-closed on exception", () => {
    it("denies when the matched resolver throws", async () => {
      const hr = makeResolver("HR", ["EmployeeContract"], "throw");
      service.registerResolver(hr);
      const decision = await service.canDownload(
        baseInput({ moduleCode: "HR", entityType: "EmployeeContract" }),
      );
      expect(decision.allow).toBe(false);
    });

    it("denies when PermissionService.can() throws", async () => {
      const grant = makePermissionMock(() => {
        throw new Error("db down");
      });
      service = new FilePolicyService(grant.service);
      const decision = await service.canDownload(baseInput({ moduleCode: "X", entityType: "Y" }));
      expect(decision.allow).toBe(false);
    });
  });

  // 7. tenant-guard ───────────────────────────────────────────────────────────
  describe("tenant guard", () => {
    it("denies when companyId is missing", async () => {
      const grant = makePermissionMock(allowDecision());
      service = new FilePolicyService(grant.service);
      const decision = await service.canDownload(
        baseInput({ companyId: "", moduleCode: "X", entityType: "Y" }),
      );
      expect(decision.allow).toBe(false);
      expect(grant.calls).toHaveLength(0); // never reached the permission / resolver layer
    });

    it("denies when userId is missing", async () => {
      const grant = makePermissionMock(allowDecision());
      service = new FilePolicyService(grant.service);
      const decision = await service.canDownload(
        baseInput({ userId: "", moduleCode: "X", entityType: "Y" }),
      );
      expect(decision.allow).toBe(false);
      expect(grant.calls).toHaveLength(0);
    });

    it("forwards companyId on every fallback can() call (no cross-tenant leak)", async () => {
      const grant = makePermissionMock(allowDecision());
      service = new FilePolicyService(grant.service);
      await service.canDownload(
        baseInput({ companyId: "co-42", moduleCode: "X", entityType: "Y" }),
      );
      expect(grant.calls.every((c) => c.companyId === "co-42")).toBe(true);
    });
  });

  // 8. duplicate-registration ─────────────────────────────────────────────────
  describe("duplicate registration loud-fail", () => {
    it("throws when two resolvers register the same (module_code, entity_type)", () => {
      const a = makeResolver("HR", ["EmployeeContract"], true);
      const b = makeResolver("HR", ["EmployeeContract"], false);
      service.registerResolver(a);
      expect(() => service.registerResolver(b)).toThrow();
    });

    it("throws on duplicate even with different case/whitespace (normalized key)", () => {
      const a = makeResolver("HR", ["EmployeeContract"], true);
      const b = makeResolver(" hr ", ["employeecontract"], true);
      service.registerResolver(a);
      expect(() => service.registerResolver(b)).toThrow();
    });
  });
});
