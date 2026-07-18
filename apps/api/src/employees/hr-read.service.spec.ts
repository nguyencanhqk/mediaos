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
    // S5-HR-WORKINFO-1: directory-class names + reporting-line (contractTypeName masked in service).
    jobLevelName: "Senior",
    contractTypeName: "Chính thức",
    directManagerName: "Nguyen Van Manager",
    directManagerEmployeeId: "emp-manager-001",
    indirectManagerName: "Nguyen Van Director",
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
    // HR-IDENTITY-READ-1 (§14.18 CCCD) — raw here; the SERVICE reveals ONLY behind view-identity.
    identityNumber: "079123456789",
    identityIssueDate: "2020-01-15",
    identityIssuePlace: "Cục CSQLHC về TTXH",
    // HR-PROFILE-UI-1b (mig 0489, hybrid): directory + MST/blob nhân khẩu.
    officialDate: "2025-05-01",
    probationEndDate: "2025-04-30",
    workLocation: "Hà Nội",
    taxCode: "8888888888",
    personalExtra: { nationality: "Việt Nam", placeOfBirth: "Hải Phòng" },
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
    officialDate: "2025-05-01",
    workLocation: "Hà Nội",
    gender: "Male",
    dateOfBirth: "1997-10-02",
    phone: "0900000000",
    contractType: "permanent",
    baseSalary: "5000.00",
    // HR-IDENTITY-READ-1 — raw here; the SERVICE reveals per-row ONLY behind view-identity.
    identityNumber: "079123456789",
    identityIssueDate: "2020-01-15",
    identityIssuePlace: "Cục CSQLHC về TTXH",
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
    // S5-HR-WORKINFO-1: latest resignation reason (append-only status history) — null unless overridden.
    findLatestResignationReasonTx: vi.fn().mockResolvedValue(null),
    summaryScopedTx: vi.fn().mockResolvedValue(makeSummaryRows()),
    listDepartmentsTx: vi.fn().mockResolvedValue([]),
    listPositionsTx: vi.fn().mockResolvedValue([]),
    listJobLevelsTx: vi.fn().mockResolvedValue([]),
    listContractTypesTx: vi.fn().mockResolvedValue([]),
    getEmployeeCodeConfigTx: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

/**
 * Permission mock. `perms` = decision per action (applies to EVERY row). `permsByRow` = per-resourceId
 * override (resourceId → action → decision) to model object-level grants that differ per employee.
 * canBatch mirrors can() cell-for-cell (same resolver) — the service must get identical decisions
 * whether it calls can() (detail/me) or canBatch() (list).
 */
function makePermission(
  perms: Record<string, Decision>,
  permsByRow?: Record<string, Record<string, Decision>>,
) {
  const decide = (action: string, resourceId?: string | null): Decision =>
    (resourceId != null ? permsByRow?.[resourceId]?.[action] : undefined) ??
    perms[action] ??
    DENY("deny-default");
  return {
    can: vi.fn((input: { action: string; resourceId?: string | null }) =>
      Promise.resolve(decide(input.action, input.resourceId)),
    ),
    canBatch: vi.fn(
      (
        _userId: string,
        _companyId: string,
        _resourceType: string,
        resourceIds: string[],
        actions: Array<{ action: string }>,
      ) => {
        const out = new Map<string, Map<string, Decision>>();
        for (const id of resourceIds) {
          const perAction = new Map<string, Decision>();
          for (const spec of actions) perAction.set(spec.action, decide(spec.action, id));
          out.set(id, perAction);
        }
        return Promise.resolve(out);
      },
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
    permsByRow?: Record<string, Record<string, Decision>>;
    repo?: ReturnType<typeof makeRepo>;
    dataScope?: ReturnType<typeof makeDataScope>;
  } = {},
) {
  const repo = opts.repo ?? makeRepo();
  const db = makeDb();
  const permission = makePermission(opts.perms ?? {}, opts.permsByRow);
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

// ─── HR-PERF-1: batched per-row salary reveal (object-ALLOW vs object-DENY on one page) ─────────────
describe("HrReadService.listHrEmployees — per-row salary via canBatch (HR-PERF-1)", () => {
  const query = { page: 1, pageSize: 20, sort: "fullName", order: "asc" } as never;

  it("mixed page: object-ALLOW row reveals baseSalary + audits; object-DENY row null + NO audit", async () => {
    const ROW_ALLOW = EMP_ID;
    const ROW_DENY = "f1f1f1f1-0000-0000-0000-000000000001";
    const repo = makeRepo({
      listScopedTx: vi.fn().mockResolvedValue({
        rows: [makeListRow(), makeListRow({ id: ROW_DENY })],
        total: 2,
      }),
    });
    const { svc, audit, permission } = makeService({
      repo,
      perms: { "view-sensitive": DENY() },
      // Per-row salary decision (object-level): ALLOW on the first row, object-DENY on the second.
      permsByRow: {
        [ROW_ALLOW]: { "view-salary": ALLOW() },
        [ROW_DENY]: { "view-salary": DENY("deny-explicit") },
      },
    });

    const res = await svc.listHrEmployees(actorA, query);

    expect(res.items).toHaveLength(2);
    // object-ALLOW row → baseSalary revealed.
    expect(res.items[0]!.baseSalary).toBe(5000);
    // object-DENY row → baseSalary masked.
    expect(res.items[1]!.baseSalary).toBeNull();
    // Reveal ⟹ audit atomic PER ROW: exactly one view-salary audit, for the revealed row, on the tx.
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({
        action: "view-salary",
        objectType: "employee",
        objectId: ROW_ALLOW,
      }),
    );
    // ONE batch for the whole page (not 2N can()).
    expect(permission.canBatch).toHaveBeenCalledTimes(1);
    expect(permission.can).not.toHaveBeenCalled();
  });

  it("ALLOW but auditRequired=false on a list row → salary MASKED, no audit (never reveal unaudited)", async () => {
    const { svc, audit } = makeService({
      perms: { "view-salary": ALLOW(false), "view-sensitive": DENY() },
    });
    const res = await svc.listHrEmployees(actorA, query);
    expect(res.items[0]!.baseSalary).toBeNull();
    expect(audit.record).not.toHaveBeenCalled();
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

  it("ALLOW view-sensitive → PII revealed per row (object-level batch check, HR-PERF-1)", async () => {
    const { svc, permission } = makeService({
      perms: { "view-salary": DENY(), "view-sensitive": ALLOW(false) },
    });

    const res = await svc.listHrEmployees(actorA, query);

    expect(res.items[0]!.gender).toBe("Male");
    expect(res.items[0]!.dateOfBirth).toBe("1997-10-02");
    expect(res.items[0]!.phone).toBe("0900000000");
    expect(res.items[0]!.contractType).toBe("permanent");
    // HR-PERF-1: the list path resolves per-row decisions via canBatch (NOT 2N can()). The batch
    // carries the page ids + both sensitive actions so OBJECT-level grants (ADR-0010) resolve per row.
    expect(permission.canBatch).toHaveBeenCalledWith(
      ACTOR_ID,
      COMPANY_A,
      "employee",
      [EMP_ID],
      expect.arrayContaining([
        expect.objectContaining({ action: "view-salary", isSensitive: true }),
        expect.objectContaining({ action: "view-sensitive", isSensitive: true }),
      ]),
    );
    // The list path must NOT loop per-row can() (regression guard: 2N → batch).
    expect(permission.can).not.toHaveBeenCalled();
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

  it("ALLOW view-sensitive → personal-info revealed BUT identity_* stays null (own sensitive gate)", async () => {
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
    // HR-IDENTITY-READ-1 (SPEC-03 §14.18): identity (CCCD) has its OWN gate (view-identity) — a
    // view-sensitive grant does NOT reveal it. Field is PRESENT (nullable) but masked → null.
    expect(res.identityNumber).toBeNull();
    expect(res.identityIssueDate).toBeNull();
    expect(res.identityIssuePlace).toBeNull();
  });

  // HR-PROFILE-UI-1b — hybrid (mig 0489): taxCode + personal_extra JSONB.
  it("DENY view-sensitive → taxCode null + personalExtra null NGUYÊN KHỐI; directory fields pass", async () => {
    const { svc } = makeService({
      perms: { "view-salary": DENY(), "view-sensitive": DENY() },
    });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.taxCode).toBeNull();
    expect(res.personalExtra).toBeNull();
    // Directory-class không gate.
    expect(res.officialDate).toBe("2025-05-01");
    expect(res.probationEndDate).toBe("2025-04-30");
    expect(res.workLocation).toBe("Hà Nội");
  });

  it("ALLOW view-sensitive → personalExtra revealed NHƯNG chiếu lên key allowlist (key lạ bị lọc)", async () => {
    const repo = makeRepo({
      findByIdTx: vi.fn().mockResolvedValue(
        makeDetailRow({
          personalExtra: {
            nationality: "Việt Nam",
            placeOfBirth: "Hải Phòng",
            // Key lạ trong DB (legacy/tay) — KHÔNG được lọt ra DTO (client Zod .strict()).
            secretNote: "must-not-leak",
          },
        }),
      ),
    });
    const { svc } = makeService({
      repo,
      perms: { "view-salary": DENY(), "view-sensitive": ALLOW(false) },
    });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.taxCode).toBe("8888888888");
    expect(res.personalExtra).toEqual({ nationality: "Việt Nam", placeOfBirth: "Hải Phòng" });
    expect(JSON.stringify(res.personalExtra)).not.toContain("must-not-leak");
  });

  it("personalExtra rỗng/null → null (không trả {} vô nghĩa)", async () => {
    const repo = makeRepo({
      findByIdTx: vi.fn().mockResolvedValue(makeDetailRow({ personalExtra: {} })),
    });
    const { svc } = makeService({
      repo,
      perms: { "view-salary": DENY(), "view-sensitive": ALLOW(false) },
    });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.personalExtra).toBeNull();
  });
});

// ─── S5-HR-WORKINFO-1: khối "Thông tin công việc" bổ sung (jobLevel/contractType/manager/nghỉ việc) ───

describe("HrReadService.getHrEmployee — S5-HR-WORKINFO-1 work-info additive fields", () => {
  it("directory-class (jobLevelName + reporting-line) passes REGARDLESS of view-sensitive (không gate)", async () => {
    const { svc } = makeService({
      perms: { "view-salary": DENY(), "view-sensitive": DENY(), "view-identity": DENY() },
    });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.jobLevelName).toBe("Senior");
    expect(res.directManagerName).toBe("Nguyen Van Manager");
    expect(res.directManagerEmployeeId).toBe("emp-manager-001");
    expect(res.indirectManagerName).toBe("Nguyen Van Director");
  });

  it("contractTypeName rides the view-sensitive gate: DENY → null (không lộ), ALLOW → tên chuẩn hoá", async () => {
    const denied = await makeService({
      perms: { "view-salary": DENY(), "view-sensitive": DENY() },
    }).svc.getHrEmployee(actorA, EMP_ID);
    expect(denied.contractTypeName).toBeNull();
    // Legacy contractType đi cùng gate → cũng null (KHÔNG đổi hành vi cũ).
    expect(denied.contractType).toBeNull();

    const allowed = await makeService({
      perms: { "view-salary": DENY(), "view-sensitive": ALLOW(false) },
    }).svc.getHrEmployee(actorA, EMP_ID);
    expect(allowed.contractTypeName).toBe("Chính thức");
    expect(allowed.contractType).toBe("permanent");
  });

  it("resignationReason: status active → KHÔNG query lịch sử trạng thái + null (không tốn query)", async () => {
    const repo = makeRepo();
    const { svc } = makeService({ repo, perms: { "view-sensitive": ALLOW(false) } });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.resignationReason).toBeNull();
    expect(repo.findLatestResignationReasonTx).not.toHaveBeenCalled();
  });

  it("resignationReason: resigned + view-sensitive → reason từ lịch sử trạng thái gần nhất", async () => {
    const repo = makeRepo({
      findByIdTx: vi.fn().mockResolvedValue(makeDetailRow({ status: "resigned" })),
      findLatestResignationReasonTx: vi.fn().mockResolvedValue("Chuyển công tác"),
    });
    const { svc } = makeService({ repo, perms: { "view-sensitive": ALLOW(false) } });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.resignationReason).toBe("Chuyển công tác");
    expect(repo.findLatestResignationReasonTx).toHaveBeenCalledWith(FAKE_TX, COMPANY_A, EMP_ID);
  });

  it("resignationReason: terminated NHƯNG thiếu view-sensitive → null + KHÔNG query (fail-closed, không rò lý do)", async () => {
    const repo = makeRepo({
      findByIdTx: vi.fn().mockResolvedValue(makeDetailRow({ status: "terminated" })),
      findLatestResignationReasonTx: vi.fn().mockResolvedValue("Vi phạm kỷ luật"),
    });
    const { svc } = makeService({ repo, perms: { "view-sensitive": DENY() } });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.resignationReason).toBeNull();
    expect(repo.findLatestResignationReasonTx).not.toHaveBeenCalled();
  });

  it("getMyProfile carries the same additive work-info fields (shared toDetail)", async () => {
    const { svc } = makeService({ perms: { "view-sensitive": ALLOW(false) } });
    const res = await svc.getMyProfile(actorA);
    expect(res.jobLevelName).toBe("Senior");
    expect(res.contractTypeName).toBe("Chính thức");
    expect(res.directManagerEmployeeId).toBe("emp-manager-001");
  });
});

// ─── HR-IDENTITY-READ-1: identity (CCCD) reveal — own view-identity gate + audit ───

describe("HrReadService.getHrEmployee — identity reveal (view-identity, §14.18)", () => {
  it("DENY view-identity → identity_* null, NO view-identity audit (fail-closed)", async () => {
    const { svc, audit } = makeService({
      perms: { "view-salary": DENY(), "view-sensitive": DENY(), "view-identity": DENY() },
    });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.identityNumber).toBeNull();
    expect(res.identityIssueDate).toBeNull();
    expect(res.identityIssuePlace).toBeNull();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("default (no view-identity grant) → identity_* null (wildcard *:* does NOT reveal — isSensitive gate)", async () => {
    // Only a non-sensitive wildcard-style grant present (view-sensitive ALLOW); view-identity is NOT
    // granted → the reveal helper passes isSensitive:true, so a wildcard can never satisfy it.
    const { svc } = makeService({ perms: { "view-sensitive": ALLOW(false) } });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.identityNumber).toBeNull();
    expect(res.identityIssueDate).toBeNull();
    expect(res.identityIssuePlace).toBeNull();
  });

  it("ALLOW view-identity → identity_* revealed AND exactly one view-identity audit row on the tx", async () => {
    const { svc, audit } = makeService({
      perms: { "view-salary": DENY(), "view-identity": ALLOW() },
    });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.identityNumber).toBe("079123456789");
    expect(res.identityIssueDate).toBe("2020-01-15");
    expect(res.identityIssuePlace).toBe("Cục CSQLHC về TTXH");
    // Reveal ⟹ audit atomic: exactly one view-identity audit for THIS profile, on the tenant tx.
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({
        action: "view-identity",
        objectType: "employee",
        objectId: EMP_ID,
        actorUserId: ACTOR_ID,
      }),
    );
  });

  it("ALLOW but auditRequired=false → identity_* MASKED, no audit (never reveal unaudited)", async () => {
    const { svc, audit } = makeService({ perms: { "view-identity": ALLOW(false) } });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.identityNumber).toBeNull();
    expect(res.identityIssueDate).toBeNull();
    expect(res.identityIssuePlace).toBeNull();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("view-identity revealed independently of view-salary/view-sensitive (own gate)", async () => {
    // Identity granted, salary + PII denied → identity revealed, salary/PII masked.
    const { svc } = makeService({
      perms: { "view-salary": DENY(), "view-sensitive": DENY(), "view-identity": ALLOW() },
    });
    const res = await svc.getHrEmployee(actorA, EMP_ID);
    expect(res.identityNumber).toBe("079123456789");
    expect(res.baseSalary).toBeNull();
    expect(res.phone).toBeNull();
  });
});

describe("HrReadService.getMyProfile — identity reveal (self, view-identity)", () => {
  it("self WITHOUT view-identity → identity_* null even on own profile (no self-bypass)", async () => {
    const { svc, audit } = makeService({ perms: { "view-sensitive": ALLOW(false) } });
    const res = await svc.getMyProfile(actorA);
    expect(res.identityNumber).toBeNull();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("self WITH view-identity → identity_* revealed + one view-identity audit for own profileId", async () => {
    const { svc, audit } = makeService({ perms: { "view-identity": ALLOW() } });
    const res = await svc.getMyProfile(actorA);
    expect(res.identityNumber).toBe("079123456789");
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({
        action: "view-identity",
        objectType: "employee",
        objectId: EMP_ID,
      }),
    );
  });
});

describe("HrReadService.listHrEmployees — identity reveal per-row (view-identity, HR-PERF-1 batch)", () => {
  const query = { page: 1, pageSize: 20, sort: "fullName", order: "asc" } as never;

  it("DENY view-identity → identity_* null on EVERY row, no audit", async () => {
    const repo = makeRepo({
      listScopedTx: vi
        .fn()
        .mockResolvedValue({ rows: [makeListRow(), makeListRow({ id: "f1" })], total: 2 }),
    });
    const { svc, audit } = makeService({
      repo,
      perms: { "view-salary": DENY(), "view-sensitive": DENY(), "view-identity": DENY() },
    });
    const res = await svc.listHrEmployees(actorA, query);
    expect(res.items).toHaveLength(2);
    for (const item of res.items) {
      expect(item.identityNumber).toBeNull();
      expect(item.identityIssueDate).toBeNull();
      expect(item.identityIssuePlace).toBeNull();
    }
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("canBatch carries {action:'view-identity',isSensitive:true}; object-ALLOW row reveals + audits per row", async () => {
    const ROW_ALLOW = EMP_ID;
    const ROW_DENY = "f1f1f1f1-0000-0000-0000-000000000001";
    const repo = makeRepo({
      listScopedTx: vi
        .fn()
        .mockResolvedValue({ rows: [makeListRow(), makeListRow({ id: ROW_DENY })], total: 2 }),
    });
    const { svc, audit, permission } = makeService({
      repo,
      perms: { "view-salary": DENY(), "view-sensitive": DENY() },
      permsByRow: {
        [ROW_ALLOW]: { "view-identity": ALLOW() },
        [ROW_DENY]: { "view-identity": DENY("deny-explicit") },
      },
    });

    const res = await svc.listHrEmployees(actorA, query);

    expect(res.items[0]!.identityNumber).toBe("079123456789");
    expect(res.items[1]!.identityNumber).toBeNull();
    // Reveal ⟹ audit atomic PER ROW: exactly one view-identity audit for the revealed row.
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({
        action: "view-identity",
        objectType: "employee",
        objectId: ROW_ALLOW,
      }),
    );
    // The batch spec carries all three sensitive actions (view-salary + view-sensitive + view-identity).
    expect(permission.canBatch).toHaveBeenCalledWith(
      ACTOR_ID,
      COMPANY_A,
      "employee",
      [ROW_ALLOW, ROW_DENY],
      expect.arrayContaining([
        expect.objectContaining({ action: "view-identity", isSensitive: true }),
      ]),
    );
    expect(permission.can).not.toHaveBeenCalled();
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
