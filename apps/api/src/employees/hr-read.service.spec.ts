/**
 * S2-HR-BE-1 — HR read-core deny-path RED suite (FULL gate, BẤT BIẾN #1/#3).
 *
 * Covers (deny-first):
 *  - SCOPE filter: Own/Team/Department narrow the list via DataScopeService.buildEmployeeScopeCondition
 *    (the service passes the RESOLVED scope, never a hard-coded role check).
 *  - PERMISSION gate: no read:employee grant → resolveAndAssert throws BEFORE any repo read (403).
 *  - 2-TENANT deny: detail for a cross-tenant id → NotFound; isEmployeeInScope rejects every scope.
 *  - SENSITIVE masking: baseSalary null without view-salary; PII null without view-sensitive;
 *    wildcard *:* does NOT reveal (mirrors resolveStrongestScope §3 — handled by can()/scope resolver).
 *  - GET /hr/me/profile: only the caller's linked profile; no linked profile → 404.
 */

import { describe, expect, it, vi } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { HrReadService } from "./hr-read.service";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const EMP_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const EMP_USER_ID = "22222222-2222-2222-2222-222222222222";

const actorA = { id: ACTOR_ID, companyId: COMPANY_A };

type Decision = { allow: boolean; reason: string; auditRequired: boolean };
const ALLOW = (auditRequired = true): Decision => ({ allow: true, reason: "allow", auditRequired });
const DENY = (reason = "deny-sensitive"): Decision => ({
  allow: false,
  reason,
  auditRequired: true,
});

/** A scope predicate sentinel — the service must AND this into the list query untouched. */
const SCOPE_COND = Symbol("scope-cond");

function makeDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EMP_ID,
    companyId: COMPANY_A,
    userId: EMP_USER_ID,
    employeeCode: "E-001",
    fullName: "Nguyen Van A",
    email: "a@co.test",
    orgUnitId: null,
    orgUnitName: null,
    positionId: null,
    positionName: null,
    directManagerId: null,
    directManagerUserId: null,
    workType: "offline",
    employmentType: "full_time",
    startDate: null,
    endDate: null,
    status: "active",
    avatarUrl: "https://cdn.test/a.png",
    baseSalary: "5000.00",
    salaryType: "monthly",
    phone: "0900000000",
    contractType: "permanent",
    notes: "secret note",
    // HR-PROFILE-UI-1: personal-info PII (mig 0451) — masked behind view-sensitive like phone.
    gender: "Male",
    dateOfBirth: "1997-10-02",
    maritalStatus: "single",
    personalEmail: "a.personal@mail.test",
    currentAddress: "1 Đường A, Hà Nội",
    permanentAddress: "2 Đường B, Nghệ An",
    emergencyContactName: "Nguyen Thi B",
    emergencyContactPhone: "0911111111",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeListRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EMP_ID,
    userId: EMP_USER_ID,
    employeeCode: "E-001",
    fullName: "Nguyen Van A",
    email: "a@co.test",
    orgUnitId: null,
    orgUnitName: null,
    positionId: null,
    positionName: null,
    workType: "offline",
    employmentType: "full_time",
    status: "active",
    avatarUrl: "https://cdn.test/a.png",
    startDate: "2025-02-01",
    gender: "Male",
    dateOfBirth: "1997-10-02",
    phone: "0900000000",
    contractType: "permanent",
    baseSalary: "5000.00",
    ...overrides,
  };
}

/** HR-PROFILE-UI-1 — raw aggregate rows the repo returns for getEmployeesSummary. */
function makeSummaryRows(overrides: Record<string, unknown> = {}) {
  return {
    byStatus: [
      { status: "active", count: 34 },
      { status: "resigned", count: 11 },
    ],
    byEmploymentType: [
      { employmentType: "full_time", count: 33 },
      { employmentType: "probation", count: 1 },
    ],
    byGender: [
      { gender: "Male", count: 20 },
      { gender: "Female", count: 14 },
    ],
    ...overrides,
  };
}

const FAKE_TX = { __tx: true };

function makeDb() {
  return {
    withTenant: vi.fn((_companyId: string, fn: (tx: unknown) => Promise<unknown>) => fn(FAKE_TX)),
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listScopedTx: vi.fn().mockResolvedValue({ rows: [makeListRow()], total: 1 }),
    findByIdTx: vi.fn().mockResolvedValue(makeDetailRow()),
    findByUserIdTx: vi.fn().mockResolvedValue(makeDetailRow()),
    summaryScopedTx: vi.fn().mockResolvedValue(makeSummaryRows()),
    listDepartmentsTx: vi.fn().mockResolvedValue([]),
    listPositionsTx: vi.fn().mockResolvedValue([]),
    listJobLevelsTx: vi.fn().mockResolvedValue([]),
    listContractTypesTx: vi.fn().mockResolvedValue([]),
    getEmployeeCodeConfigTx: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makePermission(perms: Record<string, Decision>) {
  return {
    can: vi.fn((input: { action: string }) =>
      Promise.resolve(perms[input.action] ?? DENY("deny-default")),
    ),
  };
}

function makeDataScope(opts: {
  scope?: string | null;
  inScope?: boolean;
  throwOnAssert?: boolean;
}) {
  const resolveAndAssert = vi.fn(async () => {
    if (opts.throwOnAssert) {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope");
    }
    return opts.scope ?? "Company";
  });
  return {
    resolveAndAssert,
    resolveContext: vi.fn().mockResolvedValue({
      userId: ACTOR_ID,
      companyId: COMPANY_A,
      orgUnitId: null,
    }),
    buildEmployeeScopeCondition: vi.fn().mockReturnValue(SCOPE_COND),
    isEmployeeInScope: vi.fn().mockReturnValue(opts.inScope ?? true),
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeService(
  opts: {
    perms?: Record<string, Decision>;
    repo?: ReturnType<typeof makeRepo>;
    dataScope?: ReturnType<typeof makeDataScope>;
  } = {},
) {
  const repo = opts.repo ?? makeRepo();
  const db = makeDb();
  const permission = makePermission(opts.perms ?? {});
  const dataScope = opts.dataScope ?? makeDataScope({ scope: "Company", inScope: true });
  const audit = makeAudit();
  const svc = new HrReadService(
    repo as never,
    db as never,
    permission as never,
    dataScope as never,
    audit as never,
  );
  return { svc, repo, db, permission, dataScope, audit };
}

// ─── PERMISSION deny ─────────────────────────────────────────────────────────────

describe("HrReadService.listHrEmployees — permission gate", () => {
  it("DENY: no read:employee grant → resolveAndAssert throws 403 BEFORE any repo read", async () => {
    const repo = makeRepo();
    const dataScope = makeDataScope({ throwOnAssert: true });
    const { svc } = makeService({ repo, dataScope });

    await expect(
      svc.listHrEmployees(actorA, {
        page: 1,
        pageSize: 20,
        sort: "fullName",
        order: "asc",
      } as never),
    ).rejects.toThrow(ForbiddenException);
    expect(repo.listScopedTx).not.toHaveBeenCalled();
  });
});

// ─── SCOPE filter ────────────────────────────────────────────────────────────────

describe("HrReadService.listHrEmployees — scope is a filter, not a role check", () => {
  it("passes the RESOLVED scope into buildEmployeeScopeCondition and ANDs the predicate into the query", async () => {
    const repo = makeRepo();
    const dataScope = makeDataScope({ scope: "Own", inScope: true });
    const { svc } = makeService({ repo, dataScope, perms: { "view-salary": DENY() } });

    await svc.listHrEmployees(actorA, {
      page: 1,
      pageSize: 20,
      sort: "fullName",
      order: "asc",
    } as never);

    // resolved scope flows into the predicate builder (no hard-coded role string)
    expect(dataScope.resolveAndAssert).toHaveBeenCalledWith(
      ACTOR_ID,
      COMPANY_A,
      "read",
      "employee",
    );
    expect(dataScope.buildEmployeeScopeCondition).toHaveBeenCalledWith(
      "Own",
      expect.objectContaining({ userId: ACTOR_ID, companyId: COMPANY_A }),
    );
    // the predicate is handed to the repo untouched (Team/Dept/Own all funnel here)
    expect(repo.listScopedTx).toHaveBeenCalledWith(
      FAKE_TX,
      COMPANY_A,
      SCOPE_COND,
      expect.anything(),
    );
  });
});

// ─── SENSITIVE masking (list) ────────────────────────────────────────────────────

describe("HrReadService.listHrEmployees — salary masking", () => {
  it("DENY view-salary → every baseSalary null, NO audit", async () => {
    const repo = makeRepo({
      listScopedTx: vi
        .fn()
        .mockResolvedValue({ rows: [makeListRow(), makeListRow({ id: "f1" })], total: 2 }),
    });
    const { svc, audit } = makeService({ repo, perms: { "view-salary": DENY() } });

    const res = await svc.listHrEmployees(actorA, {
      page: 1,
      pageSize: 20,
      sort: "fullName",
      order: "asc",
    } as never);

    expect(res.items).toHaveLength(2);
    expect(res.items.every((r) => r.baseSalary === null)).toBe(true);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("returns a paginated envelope (meta.total / page / totalPages)", async () => {
    const repo = makeRepo({
      listScopedTx: vi.fn().mockResolvedValue({ rows: [makeListRow()], total: 5 }),
    });
    const { svc } = makeService({ repo, perms: { "view-salary": DENY() } });

    const res = await svc.listHrEmployees(actorA, {
      page: 1,
      pageSize: 2,
      sort: "fullName",
      order: "asc",
    } as never);

    expect(res.meta.total).toBe(5);
    expect(res.meta.page).toBe(1);
    expect(res.meta.pageSize).toBe(2);
    expect(res.meta.totalPages).toBe(3);
    expect(res.meta.hasNext).toBe(true);
    expect(res.meta.hasPrev).toBe(false);
  });
});

// ─── Detail: 2-tenant + scope + masking ──────────────────────────────────────────

describe("HrReadService.getHrEmployee — 2-tenant + scope + masking", () => {
  it("2-TENANT deny: cross-tenant target → NotFound, never returns the row", async () => {
    // Row belongs to company B; the actor is company A. isEmployeeInScope rejects every scope.
    const repo = makeRepo({
      findByIdTx: vi.fn().mockResolvedValue(makeDetailRow({ companyId: COMPANY_B })),
    });
    const dataScope = makeDataScope({ scope: "System", inScope: false });
    const { svc } = makeService({ repo, dataScope, perms: { "view-salary": ALLOW() } });

    await expect(svc.getHrEmployee(actorA, EMP_ID)).rejects.toThrow(NotFoundException);
  });

  it("out-of-scope (same tenant) → NotFound (does not leak existence)", async () => {
    const dataScope = makeDataScope({ scope: "Own", inScope: false });
    const { svc } = makeService({ dataScope, perms: { "view-salary": ALLOW() } });
    await expect(svc.getHrEmployee(actorA, EMP_ID)).rejects.toThrow(NotFoundException);
  });

  it("missing row → NotFound", async () => {
    const repo = makeRepo({ findByIdTx: vi.fn().mockResolvedValue(undefined) });
    const { svc } = makeService({ repo, perms: { "view-salary": ALLOW() } });
    await expect(svc.getHrEmployee(actorA, EMP_ID)).rejects.toThrow(NotFoundException);
  });

  it("DENY view-salary → baseSalary AND salaryType null, NO view-salary audit", async () => {
    const { svc, audit } = makeService({ perms: { "view-salary": DENY() } });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.baseSalary).toBeNull();
    // S2-HR-MASK-1: salaryType is salary-class — masked under the SAME view-salary gate as the amount.
    expect(res.salaryType).toBeNull();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("DENY view-sensitive → PII (phone/notes/contractType) null", async () => {
    const { svc } = makeService({
      perms: { "view-salary": DENY(), "view-sensitive": DENY() },
    });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.phone).toBeNull();
    expect(res.notes).toBeNull();
    expect(res.contractType).toBeNull();
  });

  it("ALLOW view-salary → baseSalary number, salaryType revealed AND exactly one view-salary audit row", async () => {
    const { svc, audit } = makeService({ perms: { "view-salary": ALLOW() } });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.baseSalary).toBe(5000);
    // S2-HR-MASK-1: salaryType revealed by the SAME view-salary grant as the amount.
    expect(res.salaryType).toBe("monthly");
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ action: "view-salary", objectType: "employee", objectId: EMP_ID }),
    );
  });

  it("ALLOW but auditRequired=false → salary + salaryType MASKED, no audit (never reveal unaudited)", async () => {
    const { svc, audit } = makeService({ perms: { "view-salary": ALLOW(false) } });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.baseSalary).toBeNull();
    expect(res.salaryType).toBeNull();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("ALLOW view-sensitive → PII revealed BUT salaryType stays null (follows view-salary, not view-sensitive)", async () => {
    const { svc } = makeService({
      perms: { "view-salary": DENY(), "view-sensitive": ALLOW(false) },
    });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.phone).toBe("0900000000");
    expect(res.notes).toBe("secret note");
    expect(res.contractType).toBe("permanent");
    // S2-HR-MASK-1: salaryType is gated by view-salary — a view-sensitive grant does NOT reveal it.
    expect(res.salaryType).toBeNull();
  });

  // S2-HR-BE-2: an unlinked employee (LEFT JOIN users → no row) still details, with null name/email.
  it("unlinked employee (userId/fullName/email NULL) → still returned, no crash", async () => {
    const repo = makeRepo({
      findByIdTx: vi
        .fn()
        .mockResolvedValue(makeDetailRow({ userId: null, fullName: null, email: null })),
    });
    const { svc } = makeService({ repo, perms: { "view-salary": DENY() } });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.userId).toBeNull();
    expect(res.fullName).toBeNull();
    expect(res.email).toBeNull();
    expect(res.id).toBe(EMP_ID);
  });
});

// ─── HR-PROFILE-UI-1: list PII masking (gender/dateOfBirth/phone/contractType) ─────

describe("HrReadService.listHrEmployees — PII masking (HR-PROFILE-UI-1)", () => {
  const query = { page: 1, pageSize: 20, sort: "fullName", order: "asc" } as never;

  it("DENY view-sensitive → gender/dateOfBirth/phone/contractType null on EVERY row; directory fields pass", async () => {
    const repo = makeRepo({
      listScopedTx: vi
        .fn()
        .mockResolvedValue({ rows: [makeListRow(), makeListRow({ id: "f1" })], total: 2 }),
    });
    const { svc } = makeService({
      repo,
      perms: { "view-salary": DENY(), "view-sensitive": DENY() },
    });

    const res = await svc.listHrEmployees(actorA, query);

    expect(res.items).toHaveLength(2);
    for (const item of res.items) {
      expect(item.gender).toBeNull();
      expect(item.dateOfBirth).toBeNull();
      expect(item.phone).toBeNull();
      expect(item.contractType).toBeNull();
      // Directory-class fields are NOT gated.
      expect(item.avatarUrl).toBe("https://cdn.test/a.png");
      expect(item.startDate).toBe("2025-02-01");
    }
  });

  it("ALLOW view-sensitive → PII revealed per row (object-level resourceId check)", async () => {
    const { svc, permission } = makeService({
      perms: { "view-salary": DENY(), "view-sensitive": ALLOW(false) },
    });

    const res = await svc.listHrEmployees(actorA, query);

    expect(res.items[0]!.gender).toBe("Male");
    expect(res.items[0]!.dateOfBirth).toBe("1997-10-02");
    expect(res.items[0]!.phone).toBe("0900000000");
    expect(res.items[0]!.contractType).toBe("permanent");
    // The check must carry the row id so OBJECT-level grants (ADR-0010) resolve per employee.
    expect(permission.can).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "view-sensitive",
        resourceType: "employee",
        resourceId: EMP_ID,
        isSensitive: true,
      }),
    );
  });
});

// ─── HR-PROFILE-UI-1: detail personal-info masking ─────────────────────────────────

describe("HrReadService.getHrEmployee — personal-info PII masking (HR-PROFILE-UI-1)", () => {
  it("DENY view-sensitive → ALL personal-info fields null (fail-closed)", async () => {
    const { svc } = makeService({
      perms: { "view-salary": DENY(), "view-sensitive": DENY() },
    });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.gender).toBeNull();
    expect(res.dateOfBirth).toBeNull();
    expect(res.maritalStatus).toBeNull();
    expect(res.personalEmail).toBeNull();
    expect(res.currentAddress).toBeNull();
    expect(res.permanentAddress).toBeNull();
    expect(res.emergencyContactName).toBeNull();
    expect(res.emergencyContactPhone).toBeNull();
    // avatarUrl is directory-class — not gated.
    expect(res.avatarUrl).toBe("https://cdn.test/a.png");
  });

  it("ALLOW view-sensitive → personal-info revealed (identity_* is NEVER in the DTO)", async () => {
    const { svc } = makeService({
      perms: { "view-salary": DENY(), "view-sensitive": ALLOW(false) },
    });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.gender).toBe("Male");
    expect(res.dateOfBirth).toBe("1997-10-02");
    expect(res.maritalStatus).toBe("single");
    expect(res.personalEmail).toBe("a.personal@mail.test");
    expect(res.currentAddress).toBe("1 Đường A, Hà Nội");
    expect(res.emergencyContactName).toBe("Nguyen Thi B");
    // SPEC-03 §14.18: identity (CCCD) must not leak through this read surface at all.
    expect(res).not.toHaveProperty("identityNumber");
    expect(res).not.toHaveProperty("identityIssueDate");
    expect(res).not.toHaveProperty("identityIssuePlace");
  });
});

// ─── HR-PROFILE-UI-1: summary (overview strip aggregates) ──────────────────────────

describe("HrReadService.getEmployeesSummary — scope + gender aggregate gate", () => {
  it("DENY: no read:employee grant → 403 BEFORE any repo read", async () => {
    const repo = makeRepo();
    const dataScope = makeDataScope({ throwOnAssert: true });
    const { svc } = makeService({ repo, dataScope });

    await expect(svc.getEmployeesSummary(actorA)).rejects.toThrow(ForbiddenException);
    expect(repo.summaryScopedTx).not.toHaveBeenCalled();
  });

  it("aggregates run over the RESOLVED scope predicate (never company-wide for an Own caller)", async () => {
    const repo = makeRepo();
    const dataScope = makeDataScope({ scope: "Own", inScope: true });
    const { svc } = makeService({
      repo,
      dataScope,
      perms: { "view-sensitive": DENY() },
    });

    await svc.getEmployeesSummary(actorA);

    expect(dataScope.buildEmployeeScopeCondition).toHaveBeenCalledWith(
      "Own",
      expect.objectContaining({ userId: ACTOR_ID, companyId: COMPANY_A }),
    );
    expect(repo.summaryScopedTx).toHaveBeenCalledWith(FAKE_TX, COMPANY_A, SCOPE_COND);
  });

  it("DENY view-sensitive → byGender NULL (gender aggregate is PII, fail-closed)", async () => {
    const { svc } = makeService({ perms: { "view-sensitive": DENY() } });
    const res = await svc.getEmployeesSummary(actorA);
    expect(res.byGender).toBeNull();
    // Directory-class aggregates still flow.
    expect(res.total).toBe(45);
    expect(res.byStatus).toEqual({ active: 34, resigned: 11 });
    expect(res.byEmploymentType).toEqual({ full_time: 33, probation: 1 });
  });

  it("ALLOW view-sensitive → byGender aggregated; NULL gender bucketed as 'unknown'", async () => {
    const repo = makeRepo({
      summaryScopedTx: vi.fn().mockResolvedValue(
        makeSummaryRows({
          byGender: [
            { gender: "Male", count: 20 },
            { gender: "Female", count: 14 },
            { gender: null, count: 3 },
          ],
        }),
      ),
    });
    const { svc } = makeService({ repo, perms: { "view-sensitive": ALLOW(false) } });
    const res = await svc.getEmployeesSummary(actorA);
    expect(res.byGender).toEqual({ Male: 20, Female: 14, unknown: 3 });
  });
});

// ─── me/profile self-only ────────────────────────────────────────────────────────

describe("HrReadService.getMyProfile — self only", () => {
  it("returns ONLY the profile linked to the caller (looked up by userId, not scope)", async () => {
    const repo = makeRepo();
    const { svc } = makeService({
      repo,
      perms: { "view-salary": DENY(), "view-sensitive": ALLOW(false) },
    });

    const res = await svc.getMyProfile(actorA);

    expect(repo.findByUserIdTx).toHaveBeenCalledWith(FAKE_TX, COMPANY_A, ACTOR_ID);
    expect(res.userId).toBe(EMP_USER_ID);
  });

  it("no linked profile → NotFound (never falls back to another row)", async () => {
    const repo = makeRepo({ findByUserIdTx: vi.fn().mockResolvedValue(undefined) });
    const { svc } = makeService({ repo });
    await expect(svc.getMyProfile(actorA)).rejects.toThrow(NotFoundException);
  });
});
