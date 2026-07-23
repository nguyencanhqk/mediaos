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
import {
  SequenceInactiveError,
  SequenceNotFoundError,
} from "../foundation/sequences/sequence.types";

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
  // HR-PROFILE-UI-1b — PATCH nhận PII nhưng payload audit không được chứa key PII nào (tên field
  // chỉ được phép nằm trong diffSummary/changedFields).
  "gender",
  "dateOfBirth",
  "maritalStatus",
  "currentAddress",
  "permanentAddress",
  "emergencyContactName",
  "emergencyContactPhone",
  "taxCode",
  "personalExtra",
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
    // S2-FND-SEED-2 (ensure-on-miss): undefined ⇒ genuinely unconfigured tenant — allocateEmployeeCode
    // must NOT fabricate EMP/4 defaults (see the dedicated describe block below for the config-exists path).
    findEmployeeCodeConfigTx: vi.fn().mockResolvedValue(undefined),
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
  // S4-INT-5 (STORY-098) — outbox producer for the activation/welcome event.
  const outbox = { enqueue: vi.fn().mockResolvedValue("evt-id") };
  // S5-LMS-BE-1 — LMS auto-sync producer (wire-in assertion: changeStatus phải gọi enqueueSync).
  const lmsSync = { enqueueSync: vi.fn().mockResolvedValue(undefined) };
  const svc = new HrWriteService(
    repo as never,
    db as never,
    audit as never,
    sequence as never,
    password as never,
    securityPolicy as never,
    dataScope as never,
    permissions as never,
    outbox as never,
    lmsSync as never,
  );
  return { svc, repo, db, audit, sequence, dataScope, permissions, outbox, lmsSync };
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
    const { svc, repo, audit, lmsSync } = makeService();
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
    // S5-LMS-BE-1 wire-in: enqueue LMS auto-sync trong CÙNG tx, đúng tenant + userId của employee.
    expect(lmsSync.enqueueSync).toHaveBeenCalledWith(FAKE_TX, COMPANY_A, OTHER_USER);
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
  it("422 (not 500) when no code counter AND no employee_code_config exists — no hard-coded EMP/4 fallback", async () => {
    const sequence = {
      nextCode: vi.fn().mockRejectedValue(new SequenceNotFoundError("EMPLOYEE_CODE")),
      ensureCounterTx: vi.fn(),
    };
    const { svc, repo } = makeService({ sequence });
    await expect(svc.createEmployee(actorA, { userId: OTHER_USER } as never)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.createTx).not.toHaveBeenCalled();
    // repo.findEmployeeCodeConfigTx (default mock) resolves undefined ⇒ ensure-on-miss must bail out
    // WITHOUT ever calling ensureCounterTx (CẤM fabricate EMP/4 when there is no real config row).
    expect(sequence.ensureCounterTx).not.toHaveBeenCalled();
  });

  it("422 (not 500) when the counter exists but is Inactive — never auto re-enabled, no ensure attempt", async () => {
    const sequence = {
      nextCode: vi.fn().mockRejectedValue(new SequenceInactiveError("EMPLOYEE_CODE")),
      ensureCounterTx: vi.fn(),
    };
    const { svc } = makeService({ sequence });
    await expect(svc.createEmployee(actorA, { userId: OTHER_USER } as never)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(sequence.ensureCounterTx).not.toHaveBeenCalled();
  });

  it("ensure-on-miss: reads employee_code_config, provisions the counter, retries nextCode ONCE", async () => {
    const nextCode = vi
      .fn()
      .mockRejectedValueOnce(new SequenceNotFoundError("EMPLOYEE_CODE"))
      .mockResolvedValueOnce({ sequenceKey: "EMPLOYEE_CODE", value: 1, code: "EMP0001" });
    const ensureCounterTx = vi.fn().mockResolvedValue(undefined);
    const sequence = { nextCode, ensureCounterTx };
    const repo = makeRepo({
      findEmployeeCodeConfigTx: vi
        .fn()
        .mockResolvedValue({ prefix: "EMP", numberLength: 4, status: "active" }),
    });
    const { svc } = makeService({ repo, sequence });

    const result = await svc.createEmployee(actorA, { userId: OTHER_USER } as never);

    expect(ensureCounterTx).toHaveBeenCalledOnce();
    const [tx, companyId, key, defaults] = ensureCounterTx.mock.calls[0];
    expect(tx).toBe(FAKE_TX);
    expect(companyId).toBe(COMPANY_A);
    expect(key).toEqual({ sequenceKey: "EMPLOYEE_CODE" });
    expect(defaults).toMatchObject({
      moduleCode: "HR",
      prefix: "EMP",
      paddingLength: 4,
      status: "Active",
    });
    expect(nextCode).toHaveBeenCalledTimes(2);
    expect(result.employeeCode).toBe("EMP0001");
  });

  it("ensure-on-miss retry STILL fails (race/edge) → maps to 422, never 500", async () => {
    const nextCode = vi.fn().mockRejectedValue(new SequenceNotFoundError("EMPLOYEE_CODE"));
    const ensureCounterTx = vi.fn().mockResolvedValue(undefined);
    const sequence = { nextCode, ensureCounterTx };
    const repo = makeRepo({
      findEmployeeCodeConfigTx: vi
        .fn()
        .mockResolvedValue({ prefix: "EMP", numberLength: 4, status: "active" }),
    });
    const { svc } = makeService({ repo, sequence });

    await expect(svc.createEmployee(actorA, { userId: OTHER_USER } as never)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(ensureCounterTx).toHaveBeenCalledOnce();
    expect(nextCode).toHaveBeenCalledTimes(2); // original + exactly 1 retry, no loop
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
    const outbox = { enqueue: vi.fn().mockResolvedValue("evt-id") };
    const svc = new HrWriteService(
      repo as never,
      db as never,
      audit as never,
      sequence as never,
      password as never,
      securityPolicy as never,
      dataScope as never,
      permissions as never,
      outbox as never,
      { enqueueSync: vi.fn().mockResolvedValue(undefined) } as never,
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

  it("provision arm DENY (no create:user) → 403 with ZERO side effects (no code, no rows, no audit, no outbox)", async () => {
    const { svc, repo, audit, sequence, permissions, outbox } = makeService();
    permissions.can.mockResolvedValue({ allow: false, reason: "deny-default" });

    await expect(svc.createEmployee(actorA, provisionDto as never)).rejects.toThrow(
      ForbiddenException,
    );
    // Gated BEFORE any write or sequence allocation.
    expect((sequence as { nextCode: ReturnType<typeof vi.fn> }).nextCode).not.toHaveBeenCalled();
    expect(repo.createUserTx).not.toHaveBeenCalled();
    expect(repo.createTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    // No account minted ⇒ no activation/welcome event (deny leaves the outbox untouched).
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  // ── S4-INT-5 (STORY-098) — activation/welcome producer ────────────────────────────
  it("provision arm: enqueues EXACTLY ONE 'auth.user_created' event in-tx for the NEW user (recipient=payload.userId)", async () => {
    const { svc, outbox } = makeService();
    await svc.createEmployee(actorA, provisionDto as never);

    // Exactly one activation event, in the SAME tx as the HR/AUTH audit (both commit or both roll back).
    const authCalls = outbox.enqueue.mock.calls.filter(
      (c) => (c[1] as { eventType: string }).eventType === "auth.user_created",
    );
    expect(authCalls).toHaveLength(1);
    const [tx, event] = authCalls[0] as [
      unknown,
      { eventType: string; payload: Record<string, unknown> },
    ];
    expect(tx).toBe(FAKE_TX);
    // eventCode VERBATIM (SPEC-08 §15 NOTI-EVENT-001 → recipient 'User mới'); recipient = the minted user.
    expect(event.payload).toMatchObject({
      eventCode: "AUTH_USER_CREATED",
      userId: OTHER_USER, // createUserTx mock returns id=OTHER_USER
      employeeId: EMP_ID,
    });
    // The new user is ALWAYS ≠ the HR actor; omit actorUserId so actor-exclusion can never drop the welcome.
    expect(event.payload).not.toHaveProperty("actorUserId");
  });

  it("link-existing arm: does NOT require create:user and writes NO user.created audit NOR activation event", async () => {
    const { svc, repo, audit, permissions, outbox } = makeService();
    await svc.createEmployee(actorA, { userId: OTHER_USER, ...baseEnums } as never);

    expect(permissions.can).not.toHaveBeenCalled();
    expect(repo.createUserTx).not.toHaveBeenCalled();
    const auditedActions = audit.record.mock.calls.map((c) => (c[1] as { action: string }).action);
    expect(auditedActions).toContain("create");
    expect(auditedActions).not.toContain("user.created");
    // Linking an EXISTING account mints no user ⇒ no 'account created' welcome (STORY-098).
    const authCalls = outbox.enqueue.mock.calls.filter(
      (c) => (c[1] as { eventType: string }).eventType === "auth.user_created",
    );
    expect(authCalls).toHaveLength(0);
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

// ─── HR-PROFILE-UI-1b: PATCH personal/PII fields (gate + audit-mask) ─────────────────

describe("HrWriteService.updateEmployee — personal/PII fields (HR-PROFILE-UI-1b)", () => {
  it("DENY: PII field in body without view-sensitive:employee → 403 BEFORE any write/audit", async () => {
    const repo = makeRepo();
    const { svc, permissions, audit } = makeService({ repo });
    permissions.can = vi.fn().mockResolvedValue({ allow: false, reason: "deny-sensitive" });

    await expect(svc.updateEmployee(actorA, EMP_ID, { gender: "Male" } as never)).rejects.toThrow(
      ForbiddenException,
    );
    expect(repo.updateTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    // Gate = view-sensitive per-row (resourceId, isSensitive) — wildcard *:* không mở.
    expect(permissions.can).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "view-sensitive",
        resourceType: "employee",
        resourceId: EMP_ID,
        isSensitive: true,
      }),
    );
  });

  it("directory-only PATCH (officialDate/workLocation) does NOT invoke the view-sensitive gate", async () => {
    const { svc, permissions } = makeService();
    await svc.updateEmployee(actorA, EMP_ID, {
      officialDate: "2026-01-01",
      workLocation: "Hà Nội",
    } as never);
    expect(permissions.can).not.toHaveBeenCalled();
  });

  it("ALLOW: PII PATCH writes; changedFields carries NAMES; audit payload has NO PII key/value", async () => {
    const repo = makeRepo({
      findStructuralByIdTx: vi.fn().mockResolvedValue({
        status: "active",
        orgUnitId: null,
        gender: null,
        phone: "0900000000",
        personalExtra: null,
      }),
    });
    const { svc, audit } = makeService({ repo });

    const res = await svc.updateEmployee(actorA, EMP_ID, {
      gender: "Male",
      phone: "0911222333",
      personalExtra: { nationality: "Việt Nam" },
    } as never);

    expect(res.changedFields).toEqual(expect.arrayContaining(["gender", "phone", "personalExtra"]));
    // Tên field chỉ nằm trong diffSummary; before/after không chứa key PII (BẤT BIẾN #3).
    assertNoSensitiveAuditKeys(audit);
    const entry = audit.record.mock.calls[0]![1] as { diffSummary?: string };
    expect(entry.diffSummary).toContain("gender");
    expect(entry.diffSummary).toContain("personalExtra");
    // Giá trị PII không được xuất hiện Ở BẤT KỲ ĐÂU trong payload audit.
    const serialized = JSON.stringify(audit.record.mock.calls);
    expect(serialized).not.toContain("0911222333");
    expect(serialized).not.toContain("Việt Nam");
  });

  it("personalExtra {} normalizes to null (full-replace clear)", async () => {
    const repo = makeRepo({
      findStructuralByIdTx: vi
        .fn()
        .mockResolvedValue({ status: "active", personalExtra: { nationality: "VN" } }),
    });
    const { svc } = makeService({ repo });
    await svc.updateEmployee(actorA, EMP_ID, { personalExtra: {} } as never);
    expect(repo.updateTx).toHaveBeenCalledWith(
      FAKE_TX,
      COMPANY_A,
      EMP_ID,
      expect.objectContaining({ personalExtra: null }),
    );
  });

  it("no-op PII value (same as before) → empty changedFields, NO audit row", async () => {
    const repo = makeRepo({
      findStructuralByIdTx: vi.fn().mockResolvedValue({ status: "active", gender: "Male" }),
    });
    const { svc, audit } = makeService({ repo });
    const res = await svc.updateEmployee(actorA, EMP_ID, { gender: "Male" } as never);
    expect(res.changedFields).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
  });
});
