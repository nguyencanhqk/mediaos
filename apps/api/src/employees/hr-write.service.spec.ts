/**
 * S2-HR-BE-2 — HR write-core deny-path RED suite (FULL gate, BẤT BIẾN #1/#2/#3).
 *
 * Covers (deny-first):
 *  - change-status FSM: no-op rejected (409), illegal transition rejected (422), valid writes history.
 *  - link-user: already-linked employee → 409; target missing → 404; user already active-linked → 409.
 *  - unlink-user: no link → 409; self-unlink → 403; success detaches + soft-deletes EMR + optional lock.
 *  - create: missing code counter → 422 (not 500); manual code blocked when override disabled.
 *  - BẤT BIẾN #3: NO audit payload (before/after) ever carries a salary/PII key.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { HrWriteService } from "./hr-write.service";
import { SequenceNotFoundError } from "../foundation/sequences/sequence.types";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const EMP_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const OTHER_USER = "22222222-2222-2222-2222-222222222222";

const actorA = { id: ACTOR_ID, companyId: COMPANY_A };
const FAKE_TX = { __tx: true };
/** The enum fields the contract defaults; supplied explicitly in unit tests that bypass the schema. */
const baseEnums = { workType: "offline", employmentType: "full_time", salaryType: "monthly" };

/** Keys that must NEVER appear in an audit before/after payload (BẤT BIẾN #3). */
const FORBIDDEN_AUDIT_KEYS = [
  "baseSalary",
  "base_salary",
  "phone",
  "notes",
  "identityNumber",
  "identity_number",
  "bankAccount",
  "personalEmail",
];

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    findForUpdateTx: vi.fn().mockResolvedValue({
      id: EMP_ID,
      companyId: COMPANY_A,
      userId: OTHER_USER,
      status: "active",
    }),
    findStructuralByIdTx: vi.fn().mockResolvedValue({ status: "active", orgUnitId: null }),
    getActiveEmployeeCodeConfigTx: vi.fn().mockResolvedValue(null),
    createTx: vi.fn().mockResolvedValue({ id: EMP_ID, employeeCode: "EMP0001" }),
    updateTx: vi.fn().mockResolvedValue({ id: EMP_ID }),
    setStatusTx: vi.fn().mockResolvedValue(undefined),
    setUserIdTx: vi.fn().mockResolvedValue(undefined),
    insertStatusHistoryTx: vi.fn().mockResolvedValue(undefined),
    findActiveByUserIdTx: vi.fn().mockResolvedValue(undefined),
    findLinkableUserTx: vi.fn().mockResolvedValue({ id: OTHER_USER }),
    createUserTx: vi.fn().mockResolvedValue({
      id: OTHER_USER,
      email: "provisioned@a.test",
      fullName: "Provisioned User",
      status: "active",
      lockedAt: null,
      lockedReason: null,
      createdAt: new Date(),
    }),
    lockUserTx: vi.fn().mockResolvedValue(undefined),
    orgUnitActiveTx: vi.fn().mockResolvedValue(true),
    positionActiveTx: vi.fn().mockResolvedValue(true),
    jobLevelActiveTx: vi.fn().mockResolvedValue(true),
    contractTypeActiveTx: vi.fn().mockResolvedValue(true),
    softDeleteDirectManagerEmrTx: vi.fn().mockResolvedValue(undefined),
    insertDirectManagerEmrTx: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeService(opts: { repo?: ReturnType<typeof makeRepo>; sequence?: unknown } = {}) {
  const repo = opts.repo ?? makeRepo();
  const db = {
    withTenant: vi.fn((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(FAKE_TX)),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const sequence = opts.sequence ?? {
    nextCode: vi
      .fn()
      .mockResolvedValue({ sequenceKey: "EMPLOYEE_CODE", value: 1, code: "EMP0001" }),
  };
  const password = { hash: vi.fn().mockResolvedValue("hashed") };
  const securityPolicy = { assertEmailDomainAllowedTx: vi.fn().mockResolvedValue(true) };
  // Default: Company scope → assertWriteScope passes. Tests can override to assert fail-closed.
  const dataScope = { resolveAndAssert: vi.fn().mockResolvedValue("Company") };
  // S2-INT-1 create:user gate. Default allow → the provision arm passes; tests override to assert deny.
  const permissions = { can: vi.fn().mockResolvedValue({ allow: true, reason: "allow" }) };
  const svc = new HrWriteService(
    repo as never,
    db as never,
    audit as never,
    sequence as never,
    password as never,
    securityPolicy as never,
    dataScope as never,
    permissions as never,
  );
  return { svc, repo, db, audit, sequence, dataScope, permissions };
}

function assertNoSensitiveAuditKeys(audit: { record: ReturnType<typeof vi.fn> }) {
  for (const call of audit.record.mock.calls) {
    const entry = call[1] as { before?: unknown; after?: unknown };
    for (const payload of [entry.before, entry.after]) {
      if (payload && typeof payload === "object") {
        for (const key of Object.keys(payload as Record<string, unknown>)) {
          expect(FORBIDDEN_AUDIT_KEYS).not.toContain(key);
        }
      }
    }
  }
}

// ─── change-status FSM ─────────────────────────────────────────────────────────────

describe("HrWriteService.changeStatus — FSM", () => {
  it("404 when the employee does not exist (no audit, no history)", async () => {
    const repo = makeRepo({ findForUpdateTx: vi.fn().mockResolvedValue(undefined) });
    const { svc, audit } = makeService({ repo });
    await expect(
      svc.changeStatus(actorA, EMP_ID, { newStatus: "resigned", lockUser: false }),
    ).rejects.toThrow(NotFoundException);
    expect(repo.insertStatusHistoryTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("409 on no-op (same status)", async () => {
    const { svc, repo } = makeService();
    await expect(
      svc.changeStatus(actorA, EMP_ID, { newStatus: "active", lockUser: false }),
    ).rejects.toThrow(ConflictException);
    expect(repo.setStatusTx).not.toHaveBeenCalled();
  });

  it("422 on illegal transition (terminated is terminal)", async () => {
    const repo = makeRepo({
      findForUpdateTx: vi.fn().mockResolvedValue({
        id: EMP_ID,
        companyId: COMPANY_A,
        userId: OTHER_USER,
        status: "terminated",
      }),
    });
    const { svc } = makeService({ repo });
    await expect(
      svc.changeStatus(actorA, EMP_ID, { newStatus: "active", lockUser: false }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it("valid active→resigned: writes one history row + audit; lockUser locks the account", async () => {
    const { svc, repo, audit } = makeService();
    const res = await svc.changeStatus(actorA, EMP_ID, {
      newStatus: "resigned",
      reason: "left",
      lockUser: true,
    });
    expect(res).toEqual({ id: EMP_ID, status: "resigned" });
    expect(repo.setStatusTx).toHaveBeenCalledWith(FAKE_TX, COMPANY_A, EMP_ID, "resigned");
    expect(repo.insertStatusHistoryTx).toHaveBeenCalledWith(
      FAKE_TX,
      COMPANY_A,
      expect.objectContaining({ oldStatus: "active", newStatus: "resigned", changedBy: ACTOR_ID }),
    );
    expect(repo.lockUserTx).toHaveBeenCalledWith(FAKE_TX, COMPANY_A, OTHER_USER, "left");
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ action: "change-status", objectType: "employee" }),
    );
    assertNoSensitiveAuditKeys(audit);
  });

  it("does NOT lock the account for a non-terminal transition (active→inactive) even if lockUser=true", async () => {
    const { svc, repo } = makeService();
    await svc.changeStatus(actorA, EMP_ID, { newStatus: "inactive", lockUser: true });
    expect(repo.lockUserTx).not.toHaveBeenCalled();
  });
});

// ─── link-user ──────────────────────────────────────────────────────────────────────

describe("HrWriteService.linkUser", () => {
  it("409 when the employee already has a linked user", async () => {
    const { svc } = makeService(); // default findForUpdateTx returns userId=OTHER_USER
    await expect(svc.linkUser(actorA, EMP_ID, { userId: OTHER_USER })).rejects.toThrow(
      ConflictException,
    );
  });

  it("404 when the target user is not found in the company", async () => {
    const repo = makeRepo({
      findForUpdateTx: vi
        .fn()
        .mockResolvedValue({ id: EMP_ID, companyId: COMPANY_A, userId: null, status: "active" }),
      findLinkableUserTx: vi.fn().mockResolvedValue(undefined),
    });
    const { svc } = makeService({ repo });
    await expect(svc.linkUser(actorA, EMP_ID, { userId: OTHER_USER })).rejects.toThrow(
      NotFoundException,
    );
  });

  it("409 when the user is already active-linked to another employee", async () => {
    const repo = makeRepo({
      findForUpdateTx: vi
        .fn()
        .mockResolvedValue({ id: EMP_ID, companyId: COMPANY_A, userId: null, status: "active" }),
      findActiveByUserIdTx: vi.fn().mockResolvedValue({ id: "other-emp" }),
    });
    const { svc, repo: r } = makeService({ repo });
    await expect(svc.linkUser(actorA, EMP_ID, { userId: OTHER_USER })).rejects.toThrow(
      ConflictException,
    );
    expect(r.setUserIdTx).not.toHaveBeenCalled();
  });

  it("links the user + audits when all checks pass", async () => {
    const repo = makeRepo({
      findForUpdateTx: vi
        .fn()
        .mockResolvedValue({ id: EMP_ID, companyId: COMPANY_A, userId: null, status: "active" }),
    });
    const { svc, repo: r, audit } = makeService({ repo });
    const res = await svc.linkUser(actorA, EMP_ID, { userId: OTHER_USER });
    expect(res).toEqual({ id: EMP_ID, userId: OTHER_USER });
    expect(r.setUserIdTx).toHaveBeenCalledWith(FAKE_TX, COMPANY_A, EMP_ID, OTHER_USER);
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ action: "link-user", objectType: "employee" }),
    );
  });
});

// ─── unlink-user ────────────────────────────────────────────────────────────────────

describe("HrWriteService.unlinkUser", () => {
  it("409 when the employee has no linked user", async () => {
    const repo = makeRepo({
      findForUpdateTx: vi
        .fn()
        .mockResolvedValue({ id: EMP_ID, companyId: COMPANY_A, userId: null, status: "active" }),
    });
    const { svc } = makeService({ repo });
    await expect(svc.unlinkUser(actorA, EMP_ID, { lockUser: false })).rejects.toThrow(
      ConflictException,
    );
  });

  it("403 when a user tries to unlink their OWN account", async () => {
    const repo = makeRepo({
      findForUpdateTx: vi.fn().mockResolvedValue({
        id: EMP_ID,
        companyId: COMPANY_A,
        userId: ACTOR_ID,
        status: "active",
      }),
    });
    const { svc, repo: r } = makeService({ repo });
    await expect(svc.unlinkUser(actorA, EMP_ID, { lockUser: false })).rejects.toThrow(
      ForbiddenException,
    );
    expect(r.setUserIdTx).not.toHaveBeenCalled();
  });

  it("detaches the user, soft-deletes EMR, and locks the account when lockUser=true", async () => {
    const { svc, repo } = makeService(); // userId=OTHER_USER (not the actor)
    const res = await svc.unlinkUser(actorA, EMP_ID, { lockUser: true, reason: "left" });
    expect(res).toEqual({ id: EMP_ID, userId: null });
    expect(repo.setUserIdTx).toHaveBeenCalledWith(FAKE_TX, COMPANY_A, EMP_ID, null);
    expect(repo.softDeleteDirectManagerEmrTx).toHaveBeenCalledWith(FAKE_TX, COMPANY_A, OTHER_USER);
    expect(repo.lockUserTx).toHaveBeenCalledWith(FAKE_TX, COMPANY_A, OTHER_USER, "left");
  });
});

// ─── create ──────────────────────────────────────────────────────────────────────────

describe("HrWriteService.createEmployee", () => {
  it("422 (not 500) when no code counter is provisioned and no code is supplied", async () => {
    const sequence = {
      nextCode: vi.fn().mockRejectedValue(new SequenceNotFoundError("EMPLOYEE_CODE")),
    };
    const { svc, repo } = makeService({ sequence });
    await expect(svc.createEmployee(actorA, { userId: OTHER_USER } as never)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.createTx).not.toHaveBeenCalled();
  });

  it("403 when a manual code is supplied but the active config forbids manual override", async () => {
    const repo = makeRepo({
      getActiveEmployeeCodeConfigTx: vi.fn().mockResolvedValue({ allowManualOverride: false }),
    });
    const { svc } = makeService({ repo });
    await expect(
      svc.createEmployee(actorA, { userId: OTHER_USER, employeeCode: "X-1" } as never),
    ).rejects.toThrow(ForbiddenException);
  });

  it("403 (fail-closed) when the caller's write scope is below Company (latent-IDOR guard)", async () => {
    const dataScope = { resolveAndAssert: vi.fn().mockResolvedValue("Team") };
    const repo = makeRepo();
    const db = {
      withTenant: vi.fn((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(FAKE_TX)),
    };
    const audit = { record: vi.fn() };
    const sequence = { nextCode: vi.fn() };
    const password = { hash: vi.fn() };
    const securityPolicy = { assertEmailDomainAllowedTx: vi.fn() };
    const permissions = { can: vi.fn().mockResolvedValue({ allow: true, reason: "allow" }) };
    const svc = new HrWriteService(
      repo as never,
      db as never,
      audit as never,
      sequence as never,
      password as never,
      securityPolicy as never,
      dataScope as never,
      permissions as never,
    );
    await expect(svc.createEmployee(actorA, { userId: OTHER_USER } as never)).rejects.toThrow(
      ForbiddenException,
    );
    expect(repo.createTx).not.toHaveBeenCalled();
  });

  it("422 (not 500) when jobLevelId is not an active in-tenant record (FK→422)", async () => {
    const repo = makeRepo({ jobLevelActiveTx: vi.fn().mockResolvedValue(false) });
    const { svc } = makeService({ repo });
    await expect(
      svc.createEmployee(actorA, {
        userId: OTHER_USER,
        jobLevelId: "99999999-9999-9999-9999-999999999999",
      } as never),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(repo.createTx).not.toHaveBeenCalled();
  });

  it("422 (not 500) when contractTypeId is not an active in-tenant record (FK→422)", async () => {
    const repo = makeRepo({ contractTypeActiveTx: vi.fn().mockResolvedValue(false) });
    const { svc } = makeService({ repo });
    await expect(
      svc.createEmployee(actorA, {
        userId: OTHER_USER,
        contractTypeId: "99999999-9999-9999-9999-999999999999",
      } as never),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(repo.createTx).not.toHaveBeenCalled();
  });

  it("creates with an auto-generated code and audits 'create' WITHOUT any salary/PII key", async () => {
    const { svc, repo, audit, sequence } = makeService();
    const res = await svc.createEmployee(actorA, {
      userId: OTHER_USER,
      workType: "offline",
      employmentType: "full_time",
      salaryType: "monthly",
    } as never);
    expect((sequence as { nextCode: ReturnType<typeof vi.fn> }).nextCode).toHaveBeenCalled();
    expect(repo.createTx).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ action: "create", objectType: "employee", before: null }),
    );
    expect(res.employeeCode).toBe("EMP0001");
    assertNoSensitiveAuditKeys(audit);
  });
});

// ─── S2-INT-1 — employee↔user provisioning integration ────────────────────────────────

describe("HrWriteService.createEmployee — S2-INT-1 user provisioning", () => {
  const provisionDto = {
    email: "new.hire@a.test",
    fullName: "New Hire",
    workType: "offline",
    employmentType: "full_time",
    salaryType: "monthly",
  };

  it("provision arm: requires create:user, mints the account, audits BOTH user.created + employee create", async () => {
    const { svc, repo, audit, permissions } = makeService();
    const res = await svc.createEmployee(actorA, provisionDto as never);

    // create:user was checked for the provision arm.
    expect(permissions.can).toHaveBeenCalledWith(
      expect.objectContaining({ action: "create", resourceType: "user", companyId: COMPANY_A }),
    );
    // account minted with the actor recorded as creator.
    expect(repo.createUserTx).toHaveBeenCalledWith(
      FAKE_TX,
      COMPANY_A,
      expect.objectContaining({ email: provisionDto.email, createdBy: ACTOR_ID }),
    );
    // BOTH sides audited, in the same tx.
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ action: "user.created", objectType: "user", objectId: OTHER_USER }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ action: "create", objectType: "employee" }),
    );
    expect(res).toEqual({ id: EMP_ID, employeeCode: "EMP0001", userId: OTHER_USER });
    // BẤT BIẾN #3: the user.created snapshot must never carry password_hash / secrets.
    for (const call of audit.record.mock.calls) {
      const entry = call[1] as { after?: Record<string, unknown> };
      if (entry.after && typeof entry.after === "object") {
        expect(Object.keys(entry.after)).not.toContain("passwordHash");
        expect(Object.keys(entry.after)).not.toContain("password_hash");
        expect(Object.keys(entry.after)).not.toContain("normalizedEmail");
      }
    }
  });

  it("provision arm DENY (no create:user) → 403 with ZERO side effects (no code, no rows, no audit)", async () => {
    const { svc, repo, audit, sequence, permissions } = makeService();
    permissions.can.mockResolvedValue({ allow: false, reason: "deny-default" });

    await expect(svc.createEmployee(actorA, provisionDto as never)).rejects.toThrow(
      ForbiddenException,
    );
    // Gated BEFORE any write or sequence allocation.
    expect((sequence as { nextCode: ReturnType<typeof vi.fn> }).nextCode).not.toHaveBeenCalled();
    expect(repo.createUserTx).not.toHaveBeenCalled();
    expect(repo.createTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("link-existing arm: does NOT require create:user and writes NO user.created audit", async () => {
    const { svc, repo, audit, permissions } = makeService();
    await svc.createEmployee(actorA, { userId: OTHER_USER, ...baseEnums } as never);

    expect(permissions.can).not.toHaveBeenCalled();
    expect(repo.createUserTx).not.toHaveBeenCalled();
    const auditedActions = audit.record.mock.calls.map((c) => (c[1] as { action: string }).action);
    expect(auditedActions).toContain("create");
    expect(auditedActions).not.toContain("user.created");
  });

  it("link-existing arm: 409 when the target user is already linked to another active employee", async () => {
    const repo = makeRepo({ findActiveByUserIdTx: vi.fn().mockResolvedValue({ id: "other-emp" }) });
    const { svc, repo: r } = makeService({ repo });
    await expect(
      svc.createEmployee(actorA, { userId: OTHER_USER, ...baseEnums } as never),
    ).rejects.toThrow(ConflictException);
    expect(r.createTx).not.toHaveBeenCalled();
  });
});

// ─── update (reference validation parity with create) ──────────────────────────────────

describe("HrWriteService.updateEmployee — reference validation", () => {
  it("422 (not 500) when patching jobLevelId to an inactive in-tenant record", async () => {
    const repo = makeRepo({ jobLevelActiveTx: vi.fn().mockResolvedValue(false) });
    const { svc } = makeService({ repo });
    await expect(
      svc.updateEmployee(actorA, EMP_ID, {
        jobLevelId: "99999999-9999-9999-9999-999999999999",
      } as never),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(repo.updateTx).not.toHaveBeenCalled();
  });

  it("422 (not 500) when patching contractTypeId to an inactive in-tenant record", async () => {
    const repo = makeRepo({ contractTypeActiveTx: vi.fn().mockResolvedValue(false) });
    const { svc } = makeService({ repo });
    await expect(
      svc.updateEmployee(actorA, EMP_ID, {
        contractTypeId: "99999999-9999-9999-9999-999999999999",
      } as never),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(repo.updateTx).not.toHaveBeenCalled();
  });
});
