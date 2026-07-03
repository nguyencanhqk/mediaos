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

  // 9. canUnlink deny-by-default (Unlink is the ONLY new action — lock it fail-closed) ─────
  describe("canUnlink deny-by-default (additive Unlink action)", () => {
    it("(a) no resolver match AND no FOUNDATION.FILE.UNLINK → DENY (fallback), never ALLOW", async () => {
      // beforeEach service = FilePolicyService(denyDecision()). No resolver registered → fallback path.
      const decision = await service.canUnlink(
        baseInput({ moduleCode: "UNKNOWN", entityType: "Mystery" }),
      );
      expect(decision.allow).toBe(false);
      expect(decision.reason).toBe("deny-foundation");
      // fallback consulted the FOUNDATION.FILE.UNLINK permission (action='unlink', resourceType='foundation-file').
      expect(permission.calls).toHaveLength(1);
      expect(permission.calls[0].action).toBe("unlink");
      expect(permission.calls[0].resourceType).toBe("foundation-file");
    });

    it("(b) resolver MATCHES (module,entity) but does NOT implement canUnlinkFile → falls back to deny-by-default, never ALLOW", async () => {
      // makeResolver omits canUnlinkFile (optional method absent). A matched resolver MUST NOT cause a
      // false-ALLOW for Unlink — the policy falls through to FOUNDATION.FILE.UNLINK (here: deny).
      const hr = makeResolver("HR", ["EmployeeContract"], true); // would ALLOW link/view/etc if asked
      expect((hr as { canUnlinkFile?: unknown }).canUnlinkFile).toBeUndefined();
      service.registerResolver(hr);

      const decision = await service.canUnlink(
        baseInput({ moduleCode: "HR", entityType: "EmployeeContract" }),
      );
      expect(decision.allow).toBe(false);
      expect(decision.reason).toBe("deny-foundation");
      // resolver's OTHER methods were NOT invoked for the unlink decision (no canUnlinkFile to call).
      expect(hr.calls).toEqual([]);
      // fallback WAS consulted (resolver had no unlink verdict) and denied via FOUNDATION.FILE.UNLINK.
      expect(permission.calls).toHaveLength(1);
      expect(permission.calls[0].action).toBe("unlink");
    });

    it("(c) resolver THAT implements canUnlinkFile is final (ALLOW) — no fallback escalation", async () => {
      // Sanity that the optional-method path still works when present: implement canUnlinkFile=true with a
      // GRANTING fallback that must NOT be consulted (proves resolver verdict is final, like the others).
      const grant = makePermissionMock(allowDecision());
      service = new FilePolicyService(grant.service);
      const calls: string[] = [];
      const hr: FileOwnerPermissionResolver & { calls: string[] } = {
        moduleCode: "HR",
        entityTypes: ["EmployeeContract"],
        calls,
        canViewFile: vi.fn(async () => true),
        canDownloadFile: vi.fn(async () => true),
        canLinkFile: vi.fn(async () => true),
        canDeleteFile: vi.fn(async () => true),
        canUnlinkFile: vi.fn(async (i: FilePermissionInput) => {
          calls.push(`unlink:${i.entityType}`);
          return false; // resolver DENIES → final, no escalation to the granting fallback
        }),
      };
      service.registerResolver(hr);

      const decision = await service.canUnlink(
        baseInput({ moduleCode: "HR", entityType: "EmployeeContract" }),
      );
      expect(decision.allow).toBe(false); // resolver verdict is final
      expect(calls).toEqual(["unlink:EmployeeContract"]);
      expect(grant.calls).toHaveLength(0); // fallback NOT consulted (resolver matched + answered)
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

  // 10. H1 (S2-FND-BE-4) — hasResolver registry probe ─────────────────────────────
  // The service dispatches a LINKED file to its owning module's resolver. A link whose (module,entity)
  // has NO registered resolver must fail-closed (deny-no-resolver), NOT fall back to FOUNDATION.FILE.*
  // (which would let a broad file-download grant read an HR contract). hasResolver is the probe used by
  // decideForLinkedFile to detect that gap BEFORE any decision runs.
  describe("hasResolver (link-aware registry probe)", () => {
    it("true only for a registered (module,entity); false otherwise; normalizes case/whitespace", () => {
      service.registerResolver(makeResolver("HR", ["EmployeeContract"], true));
      expect(service.hasResolver("HR", "EmployeeContract")).toBe(true);
      expect(service.hasResolver("  hr ", "employeecontract")).toBe(true); // normalized like registration
      expect(service.hasResolver("HR", "SomethingElse")).toBe(false); // no module-wildcard registered
      expect(service.hasResolver("UNKNOWN", "Mystery")).toBe(false);
    });

    it("module-wildcard resolver → hasResolver true for ANY entity of that module", () => {
      service.registerResolver(makeResolver("TASK", undefined, true)); // entityTypes empty ⇒ wildcard
      expect(service.hasResolver("TASK", "AnyEntity")).toBe(true);
      expect(service.hasResolver("HR", "AnyEntity")).toBe(false);
    });
  });

  // 11. H1 (S2-FND-BE-4) — decideForLinkedFile (fail-closed link-aware dispatch, most-restrictive AND) ──
  describe("decideForLinkedFile (fail-closed link-aware dispatch)", () => {
    const foundationInput = () =>
      baseInput({ moduleCode: "FOUNDATION", entityType: "File", entityId: "file-1" });

    it("empty links → falls back to FOUNDATION.FILE.* (allow-foundation when granted)", async () => {
      const grant = makePermissionMock(allowDecision());
      service = new FilePolicyService(grant.service);
      const decision = await service.decideForLinkedFile(
        foundationInput(),
        [],
        FilePolicyAction.Download,
      );
      expect(decision.allow).toBe(true);
      expect(decision.reason).toBe("allow-foundation");
      expect(grant.calls[0].action).toBe("download");
      expect(grant.calls[0].resourceType).toBe("foundation-file");
    });

    it("empty links → deny-foundation when the fallback permission is not granted (behaviour unchanged)", async () => {
      // beforeEach: service uses denyDecision().
      const decision = await service.decideForLinkedFile(
        foundationInput(),
        [],
        FilePolicyAction.View,
      );
      expect(decision.allow).toBe(false);
      expect(decision.reason).toBe("deny-foundation");
    });

    it("≥1 link whose (module,entity) has NO registered resolver → deny-no-resolver, NEVER fallback", async () => {
      // A GRANTING fallback proves fail-closed: it must NOT be consulted for a linked file with a gap.
      const grant = makePermissionMock(allowDecision());
      service = new FilePolicyService(grant.service);
      service.registerResolver(makeResolver("HR", ["EmployeeContract"], true)); // only HR registered
      const links = [
        { moduleCode: "HR", entityType: "EmployeeContract", entityId: "e1" },
        { moduleCode: "LEAVE", entityType: "LeaveAttachment", entityId: "e2" }, // NO resolver
      ];
      const decision = await service.decideForLinkedFile(
        foundationInput(),
        links,
        FilePolicyAction.Download,
      );
      expect(decision.allow).toBe(false);
      expect(decision.reason).toBe("deny-no-resolver");
      expect(grant.calls).toHaveLength(0); // fallback never reached
    });

    it("all links have resolvers + ALL allow → allow-resolver (dispatches each link's own module/entity)", async () => {
      const hr = makeResolver("HR", ["EmployeeContract"], true);
      const leave = makeResolver("LEAVE", ["LeaveAttachment"], true);
      service.registerResolver(hr);
      service.registerResolver(leave);
      const links = [
        { moduleCode: "HR", entityType: "EmployeeContract", entityId: "e1" },
        { moduleCode: "LEAVE", entityType: "LeaveAttachment", entityId: "e2" },
      ];
      const decision = await service.decideForLinkedFile(
        foundationInput(),
        links,
        FilePolicyAction.Download,
      );
      expect(decision.allow).toBe(true);
      expect(decision.reason).toBe("allow-resolver");
      expect(hr.calls).toEqual(["download:EmployeeContract"]);
      expect(leave.calls).toEqual(["download:LeaveAttachment"]);
    });

    it("all links have resolvers but ONE denies → DENY (most-restrictive AND)", async () => {
      const hr = makeResolver("HR", ["EmployeeContract"], true);
      const leave = makeResolver("LEAVE", ["LeaveAttachment"], false); // denies
      service.registerResolver(hr);
      service.registerResolver(leave);
      const links = [
        { moduleCode: "HR", entityType: "EmployeeContract", entityId: "e1" },
        { moduleCode: "LEAVE", entityType: "LeaveAttachment", entityId: "e2" },
      ];
      const decision = await service.decideForLinkedFile(
        foundationInput(),
        links,
        FilePolicyAction.Download,
      );
      expect(decision.allow).toBe(false);
      expect(decision.reason).toBe("deny-resolver");
    });

    it("a registered resolver that THROWS → fail-closed DENY (deny-error), never a false-ALLOW", async () => {
      service.registerResolver(makeResolver("HR", ["EmployeeContract"], "throw"));
      const links = [{ moduleCode: "HR", entityType: "EmployeeContract", entityId: "e1" }];
      const decision = await service.decideForLinkedFile(
        foundationInput(),
        links,
        FilePolicyAction.Download,
      );
      expect(decision.allow).toBe(false);
      expect(decision.reason).toBe("deny-error");
    });

    it("missing tenant scope → deny-tenant (guard runs before resolver dispatch)", async () => {
      service.registerResolver(makeResolver("HR", ["EmployeeContract"], true));
      const links = [{ moduleCode: "HR", entityType: "EmployeeContract", entityId: "e1" }];
      const decision = await service.decideForLinkedFile(
        baseInput({ companyId: "", moduleCode: "FOUNDATION", entityType: "File" }),
        links,
        FilePolicyAction.Download,
      );
      expect(decision.allow).toBe(false);
      expect(decision.reason).toBe("deny-tenant");
    });
  });

  // 12. S2-FND-BE-4 (fix-blastradius-realpair-test) — the REAL production pair ('HR','contract') ─────
  // The ONLY production call-site of FileService.link is ContractService.linkFile, which emits the
  // lowercase pair (moduleCode='HR', entityType='contract'). These cases pin that the resolver
  // registered for that REAL pair dispatches (allow/deny-resolver), while the FICTITIOUS PascalCase
  // 'EmployeeContract' pair stays UNREGISTERED and fail-closes to deny-no-resolver — the exact drift
  // trap (memory: s1-fnd-module perm-pair drift) that masked the shipped Download-contract regression.
  describe("real production pair ('HR','contract') — drift-trap guard", () => {
    const foundationInput = () =>
      baseInput({ moduleCode: "FOUNDATION", entityType: "File", entityId: "file-1" });

    it("hasResolver: REAL 'contract' true (case/whitespace-insensitive); fictitious 'EmployeeContract' false", () => {
      service.registerResolver(makeResolver("HR", ["contract"], true));
      expect(service.hasResolver("HR", "contract")).toBe(true);
      expect(service.hasResolver("  hr ", "CONTRACT")).toBe(true); // normalized like registration
      // The PascalCase entity nobody registers remains unregistered → would deny-no-resolver.
      expect(service.hasResolver("HR", "EmployeeContract")).toBe(false);
    });

    it("registered 'contract' + in-scope resolver → allow-resolver (FOUNDATION.FILE.* fallback NOT reached)", async () => {
      // A GRANTING fallback proves the resolver verdict is final for the real pair.
      const grant = makePermissionMock(allowDecision());
      service = new FilePolicyService(grant.service);
      const hr = makeResolver("HR", ["contract"], true);
      service.registerResolver(hr);

      const decision = await service.decideForLinkedFile(
        foundationInput(),
        [{ moduleCode: "HR", entityType: "contract", entityId: "c1" }],
        FilePolicyAction.Download,
      );
      expect(decision).toEqual({ allow: true, reason: "allow-resolver" });
      expect(hr.calls).toEqual(["download:contract"]); // dispatched on the link's OWN lowercase entity
      expect(grant.calls).toHaveLength(0); // never escalated to the fallback
    });

    it("registered 'contract' + resolver denies → deny-resolver (out-of-scope, no fallback escalation)", async () => {
      const grant = makePermissionMock(allowDecision());
      service = new FilePolicyService(grant.service);
      service.registerResolver(makeResolver("HR", ["contract"], false));

      const decision = await service.decideForLinkedFile(
        foundationInput(),
        [{ moduleCode: "HR", entityType: "contract", entityId: "c1" }],
        FilePolicyAction.Download,
      );
      expect(decision).toEqual({ allow: false, reason: "deny-resolver" });
      expect(grant.calls).toHaveLength(0);
    });

    it("fictitious 'EmployeeContract' link (never registered) → deny-no-resolver (the masked regression)", async () => {
      // Only the REAL pair is registered; a link seeded with the drifted PascalCase name fails-closed.
      const grant = makePermissionMock(allowDecision());
      service = new FilePolicyService(grant.service);
      service.registerResolver(makeResolver("HR", ["contract"], true));

      const decision = await service.decideForLinkedFile(
        foundationInput(),
        [{ moduleCode: "HR", entityType: "EmployeeContract", entityId: "c1" }],
        FilePolicyAction.Download,
      );
      expect(decision).toEqual({ allow: false, reason: "deny-no-resolver" });
      expect(grant.calls).toHaveLength(0); // must NOT fall back to a broad file grant
    });
  });
});
