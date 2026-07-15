/**
 * G5-FIX deny-path RED suite for EmployeesService.
 *
 * F1 (🔴 crown-jewel — salary audit, BẤT BIẾN #3):
 *   - view-salary: deny → base_salary=null & NO audit; allow → number & 1 audit row per view
 *   - list: per-item mask; per allowed item → 1 audit row
 *   - update-salary: no permission → 403; allow → audit before/after
 *
 * F5 (EMR consistency), F6 (import hardening), F7 (login account), F8 (search)
 * are appended below as each step lands.
 */

import { describe, expect, it, vi } from "vitest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { EmployeesService } from "./employees.service";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const EMP_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const EMP_USER_ID = "22222222-2222-2222-2222-222222222222";
const EMP2_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const EMP2_USER_ID = "33333333-3333-3333-3333-333333333333";
const MANAGER_ID = "44444444-4444-4444-4444-444444444444";

const actor = { id: ACTOR_ID, companyId: COMPANY_ID };

type Decision = { allow: boolean; reason: string; auditRequired: boolean };
const ALLOW = (auditRequired = true): Decision => ({ allow: true, reason: "allow", auditRequired });
const DENY = (reason = "deny-sensitive"): Decision => ({
  allow: false,
  reason,
  auditRequired: true,
});

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EMP_ID,
    companyId: COMPANY_ID,
    userId: EMP_USER_ID,
    employeeCode: "E-001",
    orgUnitId: null,
    orgUnitName: null,
    positionId: null,
    positionName: null,
    directManagerId: null,
    workType: "offline",
    employmentType: "full_time",
    startDate: null,
    endDate: null,
    contractType: null,
    baseSalary: "5000.00",
    salaryType: "monthly",
    phone: null,
    avatarUrl: null,
    notes: null,
    status: "active",
    userFullName: "Nguyen Van A",
    userEmail: "a@co.test",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listEmployeesTx: vi.fn().mockResolvedValue([makeRow()]),
    findByIdTx: vi.fn().mockResolvedValue(makeRow()),
    createEmployeeTx: vi.fn().mockResolvedValue([makeRow()]),
    updateEmployeeTx: vi.fn().mockResolvedValue([makeRow()]),
    softDeleteEmployee: vi.fn().mockResolvedValue([makeRow()]),
    createUserTx: vi.fn().mockResolvedValue({
      id: EMP_USER_ID,
      email: "new@co.test",
      fullName: "New Hire",
      status: "active",
      lockedAt: null,
      lockedReason: null,
    }),
    softDeleteDirectManagerEmrTx: vi.fn().mockResolvedValue(undefined),
    insertDirectManagerEmrTx: vi.fn().mockResolvedValue(undefined),
    findLinkableUserTx: vi.fn().mockResolvedValue({ id: EMP_USER_ID }),
    findActiveByUserIdTx: vi.fn().mockResolvedValue(undefined),
    findUserByEmailTx: vi.fn().mockResolvedValue({ id: EMP_USER_ID }),
    findOrgUnitByNameTx: vi.fn().mockResolvedValue({ id: "org-1" }),
    findPositionByNameTx: vi.fn().mockResolvedValue({ id: "pos-1" }),
    bulkCreateEmployeesTx: vi.fn().mockResolvedValue([{ id: EMP_ID }]),
    ...overrides,
  };
}

const FAKE_TX = { __tx: true };

function makeDb() {
  return {
    withTenant: vi.fn((_companyId: string, fn: (tx: unknown) => Promise<unknown>) => fn(FAKE_TX)),
  };
}

function makePermission(perms: Record<string, Decision>) {
  return {
    can: vi.fn((input: { action: string }) =>
      Promise.resolve(perms[input.action] ?? DENY("deny-default")),
    ),
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makePassword() {
  return { hash: vi.fn().mockResolvedValue("argon2-hash") };
}

/** CS-9 SecurityPolicyService fake — mặc định cho qua (email-domain allow); ghi đè khi test reject. */
function makeSecurityPolicy(domainAllowed = true) {
  return { assertEmailDomainAllowedTx: vi.fn().mockResolvedValue(domainAllowed) };
}

/** A scope predicate sentinel — the service must AND this into the list query untouched. */
const SCOPE_COND = Symbol("scope-cond");

/**
 * S2-HR-EMP-LEGACY-LOCK-1: DataScopeService fake. Default = Company scope + inScope:true so existing
 * (non-scope) tests keep passing; deny-path tests flip throwOnAssert / inScope.
 */
function makeDataScope(
  opts: { scope?: string | null; inScope?: boolean; throwOnAssert?: boolean } = {},
) {
  return {
    resolveAndAssert: vi.fn(async () => {
      if (opts.throwOnAssert) {
        throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope");
      }
      return opts.scope ?? "Company";
    }),
    resolveContext: vi
      .fn()
      .mockResolvedValue({ userId: ACTOR_ID, companyId: COMPANY_ID, orgUnitId: null }),
    buildEmployeeScopeCondition: vi.fn().mockReturnValue(SCOPE_COND),
    isEmployeeInScope: vi.fn().mockReturnValue(opts.inScope ?? true),
  };
}

function makeService(
  opts: {
    perms?: Record<string, Decision>;
    repo?: ReturnType<typeof makeRepo>;
    securityPolicy?: ReturnType<typeof makeSecurityPolicy>;
    dataScope?: ReturnType<typeof makeDataScope>;
  } = {},
) {
  const repo = opts.repo ?? makeRepo();
  const db = makeDb();
  const permission = makePermission(opts.perms ?? {});
  const audit = makeAudit();
  const password = makePassword();
  const securityPolicy = opts.securityPolicy ?? makeSecurityPolicy();
  const dataScope = opts.dataScope ?? makeDataScope();
  const svc = new EmployeesService(
    repo as never,
    db as never,
    permission as never,
    audit as never,
    password as never,
    securityPolicy as never,
    dataScope as never,
  );
  return { svc, repo, db, permission, audit, password, securityPolicy, dataScope };
}

// ─── F1: Salary audit (crown-jewel) ─────────────────────────────────────────────

describe("EmployeesService — F1 salary mask + audit", () => {
  describe("getEmployee (view-salary)", () => {
    it("DENY: employee viewing another → base_salary=null, NO audit row", async () => {
      const { svc, audit } = makeService({ perms: { "view-salary": DENY() } });
      const res = await svc.getEmployee(actor, EMP_ID);
      expect(res.baseSalary).toBeNull();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("DENY: team_leader without view_sensitive → base_salary=null", async () => {
      const { svc, audit } = makeService({ perms: { "view-salary": DENY("deny-scope") } });
      const res = await svc.getEmployee(actor, EMP_ID);
      expect(res.baseSalary).toBeNull();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("ALLOW: HR_manager → base_salary=number AND exactly 1 view-salary audit row", async () => {
      const { svc, audit } = makeService({ perms: { "view-salary": ALLOW() } });
      const res = await svc.getEmployee(actor, EMP_ID);
      expect(res.baseSalary).toBe(5000);
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        FAKE_TX,
        expect.objectContaining({
          action: "view-salary",
          objectType: "employee",
          objectId: EMP_ID,
          actorUserId: ACTOR_ID,
        }),
      );
    });

    it("ALLOW but auditRequired=false → salary MASKED, no audit (never reveal without auditing)", async () => {
      const { svc, audit } = makeService({ perms: { "view-salary": ALLOW(false) } });
      const res = await svc.getEmployee(actor, EMP_ID);
      expect(res.baseSalary).toBeNull();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("throws NotFound when row missing (no audit)", async () => {
      const repo = makeRepo({ findByIdTx: vi.fn().mockResolvedValue(undefined) });
      const { svc, audit } = makeService({ perms: { "view-salary": ALLOW() }, repo });
      await expect(svc.getEmployee(actor, EMP_ID)).rejects.toThrow(NotFoundException);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  // ── S2-HR-EMP-LEGACY-LOCK-1: data-scope (IDOR) + salaryType/PII masking on legacy GET /employees/:id ──
  describe("getEmployee — data-scope + sensitive masking (legacy lock)", () => {
    it("DENY no read:employee scope → resolveAndAssert throws 403 BEFORE any repo read", async () => {
      const repo = makeRepo();
      const dataScope = makeDataScope({ throwOnAssert: true });
      const { svc } = makeService({ repo, dataScope, perms: { "view-salary": ALLOW() } });
      await expect(svc.getEmployee(actor, EMP_ID)).rejects.toThrow(ForbiddenException);
      expect(repo.findByIdTx).not.toHaveBeenCalled();
    });

    it("out-of-scope (same tenant) → NotFound, never returns the row (no existence leak)", async () => {
      const dataScope = makeDataScope({ scope: "Own", inScope: false });
      const { svc } = makeService({ dataScope, perms: { "view-salary": ALLOW() } });
      await expect(svc.getEmployee(actor, EMP_ID)).rejects.toThrow(NotFoundException);
    });

    it("2-TENANT deny: cross-tenant row → NotFound (isEmployeeInScope rejects every scope)", async () => {
      const repo = makeRepo({
        findByIdTx: vi
          .fn()
          .mockResolvedValue(makeRow({ companyId: "dddddddd-dddd-dddd-dddd-dddddddddddd" })),
      });
      const dataScope = makeDataScope({ scope: "System", inScope: false });
      const { svc } = makeService({ repo, dataScope, perms: { "view-salary": ALLOW() } });
      await expect(svc.getEmployee(actor, EMP_ID)).rejects.toThrow(NotFoundException);
    });

    it("DENY view-salary → salaryType (and baseSalary) null", async () => {
      const repo = makeRepo({
        findByIdTx: vi.fn().mockResolvedValue(makeRow({ salaryType: "hourly" })),
      });
      const { svc } = makeService({ repo, perms: { "view-salary": DENY() } });
      const res = await svc.getEmployee(actor, EMP_ID);
      expect(res.baseSalary).toBeNull();
      expect(res.salaryType).toBeNull();
    });

    it("ALLOW view-salary → salaryType revealed alongside baseSalary", async () => {
      const repo = makeRepo({
        findByIdTx: vi.fn().mockResolvedValue(makeRow({ salaryType: "hourly" })),
      });
      const { svc } = makeService({ repo, perms: { "view-salary": ALLOW() } });
      const res = await svc.getEmployee(actor, EMP_ID);
      expect(res.baseSalary).toBe(5000);
      expect(res.salaryType).toBe("hourly");
    });

    it("DENY view-sensitive → PII (phone/contractType/notes) null", async () => {
      const repo = makeRepo({
        findByIdTx: vi
          .fn()
          .mockResolvedValue(
            makeRow({ phone: "0900000000", contractType: "permanent", notes: "secret" }),
          ),
      });
      const { svc } = makeService({
        repo,
        perms: { "view-salary": DENY(), "view-sensitive": DENY() },
      });
      const res = await svc.getEmployee(actor, EMP_ID);
      expect(res.phone).toBeNull();
      expect(res.contractType).toBeNull();
      expect(res.notes).toBeNull();
    });

    it("ALLOW view-sensitive → PII revealed BUT salaryType stays null (PII gate ≠ salary gate)", async () => {
      const repo = makeRepo({
        findByIdTx: vi.fn().mockResolvedValue(
          makeRow({
            phone: "0900000000",
            contractType: "permanent",
            notes: "secret",
            salaryType: "monthly",
          }),
        ),
      });
      const { svc } = makeService({
        repo,
        perms: { "view-salary": DENY(), "view-sensitive": ALLOW(false) },
      });
      const res = await svc.getEmployee(actor, EMP_ID);
      expect(res.phone).toBe("0900000000");
      expect(res.contractType).toBe("permanent");
      expect(res.notes).toBe("secret");
      expect(res.salaryType).toBeNull();
    });
  });

  describe("listEmployees — data-scope filter (legacy lock)", () => {
    it("passes the resolved scope predicate into the repo query (Own/Team/Dept funnel here)", async () => {
      const repo = makeRepo({ listEmployeesTx: vi.fn().mockResolvedValue([]) });
      const dataScope = makeDataScope({ scope: "Own" });
      const { svc } = makeService({ repo, dataScope, perms: { "view-salary": DENY() } });
      await svc.listEmployees(actor, {});
      expect(dataScope.buildEmployeeScopeCondition).toHaveBeenCalledWith(
        "Own",
        expect.objectContaining({ userId: ACTOR_ID, companyId: COMPANY_ID }),
      );
      expect(repo.listEmployeesTx).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY_ID,
        expect.anything(),
        SCOPE_COND,
      );
    });

    it("DENY no read:employee scope → 403 BEFORE any repo read", async () => {
      const repo = makeRepo();
      const dataScope = makeDataScope({ throwOnAssert: true });
      const { svc } = makeService({ repo, dataScope });
      await expect(svc.listEmployees(actor, {})).rejects.toThrow(ForbiddenException);
      expect(repo.listEmployeesTx).not.toHaveBeenCalled();
    });
  });

  describe("listEmployees (per-item mask + audit)", () => {
    it("DENY: normal user → every base_salary=null, NO audit", async () => {
      const repo = makeRepo({
        listEmployeesTx: vi
          .fn()
          .mockResolvedValue([makeRow(), makeRow({ id: EMP2_ID, userId: EMP2_USER_ID })]),
      });
      const { svc, audit } = makeService({ perms: { "view-salary": DENY() }, repo });
      const res = await svc.listEmployees(actor, {});
      expect(res).toHaveLength(2);
      expect(res.every((r) => r.baseSalary === null)).toBe(true);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("ALLOW: HR_manager → numbers AND 1 audit row per viewed item", async () => {
      const repo = makeRepo({
        listEmployeesTx: vi
          .fn()
          .mockResolvedValue([makeRow(), makeRow({ id: EMP2_ID, userId: EMP2_USER_ID })]),
      });
      const { svc, audit } = makeService({ perms: { "view-salary": ALLOW() }, repo });
      const res = await svc.listEmployees(actor, {});
      expect(res.map((r) => r.baseSalary)).toEqual([5000, 5000]);
      expect(audit.record).toHaveBeenCalledTimes(2);
    });
  });

  describe("updateEmployee (update-salary)", () => {
    it("DENY: PATCH base_salary without update-salary → 403, no write", async () => {
      const repo = makeRepo();
      const { svc } = makeService({ perms: { "update-salary": DENY() }, repo });
      await expect(svc.updateEmployee(actor, EMP_ID, { baseSalary: 9000 })).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.updateEmployeeTx).not.toHaveBeenCalled();
    });

    it("ALLOW: PATCH base_salary → update-salary audit with before/after", async () => {
      const repo = makeRepo({
        findByIdTx: vi.fn().mockResolvedValue(makeRow({ baseSalary: "5000.00" })),
        updateEmployeeTx: vi.fn().mockResolvedValue([makeRow({ baseSalary: "9000.00" })]),
      });
      const { svc, audit } = makeService({
        perms: { "update-salary": ALLOW(), "view-salary": ALLOW() },
        repo,
      });
      await svc.updateEmployee(actor, EMP_ID, { baseSalary: 9000 });
      expect(audit.record).toHaveBeenCalledWith(
        FAKE_TX,
        expect.objectContaining({
          action: "update-salary",
          objectType: "employee",
          objectId: EMP_ID,
          before: { base_salary: 5000 },
          after: { base_salary: 9000 },
        }),
      );
    });

    it("non-salary PATCH does not require update-salary permission", async () => {
      const repo = makeRepo();
      const { svc } = makeService({ perms: {}, repo });
      await expect(svc.updateEmployee(actor, EMP_ID, { phone: "0900" })).resolves.toBeDefined();
      expect(repo.updateEmployeeTx).toHaveBeenCalledTimes(1);
    });
  });

  describe("createEmployee (set-salary)", () => {
    it("DENY: create with base_salary without update-salary → 403, no salary audit", async () => {
      const repo = makeRepo();
      const { svc, audit } = makeService({ perms: { "update-salary": DENY() }, repo });
      await expect(
        svc.createEmployee(actor, {
          userId: EMP_USER_ID,
          baseSalary: 9000,
          workType: "offline",
          employmentType: "full_time",
          salaryType: "monthly",
        } as never),
      ).rejects.toThrow(ForbiddenException);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("ALLOW: create with base_salary → update-salary audit (before null / after value)", async () => {
      const repo = makeRepo();
      const { svc, audit } = makeService({ perms: { "update-salary": ALLOW() }, repo });
      await svc.createEmployee(actor, {
        userId: EMP_USER_ID,
        baseSalary: 9000,
        workType: "offline",
        employmentType: "full_time",
        salaryType: "monthly",
      } as never);
      expect(audit.record).toHaveBeenCalledWith(
        FAKE_TX,
        expect.objectContaining({
          action: "update-salary",
          objectType: "employee",
          objectId: EMP_ID,
          before: { base_salary: null },
          after: { base_salary: 9000 },
        }),
      );
    });

    it("create WITHOUT base_salary does not require update-salary permission", async () => {
      const repo = makeRepo();
      const { svc, audit } = makeService({ perms: {}, repo });
      await expect(
        svc.createEmployee(actor, {
          userId: EMP_USER_ID,
          workType: "offline",
          employmentType: "full_time",
          salaryType: "monthly",
        } as never),
      ).resolves.toBeDefined();
      expect(audit.record).not.toHaveBeenCalled();
      expect(repo.createEmployeeTx).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── F5: EMR direct_manager consistency ─────────────────────────────────────────

describe("EmployeesService — F5 EMR sync", () => {
  it("create with directManagerId → soft-delete prior + insert EMR row", async () => {
    const repo = makeRepo({
      createEmployeeTx: vi.fn().mockResolvedValue([makeRow({ userId: EMP_USER_ID })]),
    });
    const { svc } = makeService({ repo });
    await svc.createEmployee(actor, {
      userId: EMP_USER_ID,
      directManagerId: MANAGER_ID,
      workType: "offline",
      employmentType: "full_time",
      salaryType: "monthly",
    } as never);
    expect(repo.softDeleteDirectManagerEmrTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      EMP_USER_ID,
    );
    expect(repo.insertDirectManagerEmrTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      EMP_USER_ID,
      MANAGER_ID,
    );
  });

  it("create without directManagerId → no EMR write", async () => {
    const repo = makeRepo();
    const { svc } = makeService({ repo });
    await svc.createEmployee(actor, {
      userId: EMP_USER_ID,
      workType: "offline",
      employmentType: "full_time",
      salaryType: "monthly",
    } as never);
    expect(repo.softDeleteDirectManagerEmrTx).not.toHaveBeenCalled();
    expect(repo.insertDirectManagerEmrTx).not.toHaveBeenCalled();
  });

  it("update set directManagerId → soft-delete + insert", async () => {
    const repo = makeRepo({
      updateEmployeeTx: vi.fn().mockResolvedValue([makeRow({ userId: EMP_USER_ID })]),
    });
    const { svc } = makeService({ repo });
    await svc.updateEmployee(actor, EMP_ID, { directManagerId: MANAGER_ID });
    expect(repo.softDeleteDirectManagerEmrTx).toHaveBeenCalledTimes(1);
    expect(repo.insertDirectManagerEmrTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      EMP_USER_ID,
      MANAGER_ID,
    );
  });

  it("update clear directManagerId=null → soft-delete only (EMR removed)", async () => {
    const repo = makeRepo({
      updateEmployeeTx: vi.fn().mockResolvedValue([makeRow({ userId: EMP_USER_ID })]),
    });
    const { svc } = makeService({ repo });
    await svc.updateEmployee(actor, EMP_ID, { directManagerId: null });
    expect(repo.softDeleteDirectManagerEmrTx).toHaveBeenCalledTimes(1);
    expect(repo.insertDirectManagerEmrTx).not.toHaveBeenCalled();
  });

  it("update untouched directManagerId (undefined) → no EMR write", async () => {
    const repo = makeRepo({
      updateEmployeeTx: vi.fn().mockResolvedValue([makeRow({ userId: EMP_USER_ID })]),
    });
    const { svc } = makeService({ repo });
    await svc.updateEmployee(actor, EMP_ID, { phone: "0900" });
    expect(repo.softDeleteDirectManagerEmrTx).not.toHaveBeenCalled();
  });

  it("rejects an employee managing themselves", async () => {
    const repo = makeRepo({
      updateEmployeeTx: vi.fn().mockResolvedValue([makeRow({ userId: EMP_USER_ID })]),
    });
    const { svc } = makeService({ repo });
    await expect(
      svc.updateEmployee(actor, EMP_ID, { directManagerId: EMP_USER_ID }),
    ).rejects.toThrow(BadRequestException);
  });
});

// ─── F6 legacy CSV import (parseImportPreview/confirmImport) REMOVED ─────────────
// S5-HR-IMPORT-BE-1 / FIX-BE-LEGACY-REMOVE: the media-era Valkey-staged CSV import was ripped out of
// EmployeesService (route + service + DTO). Bulk import now lives ONLY in HrEmployeeImportService via
// POST /hr/employees/import (SequenceService codes + per-row audit + session audit). Its coverage is
// hr-employee-import.service.spec.ts (unit) + hr-employee-import.int-spec.ts (HTTP, real engine).

// ─── F7: create login account when no userId supplied ───────────────────────────

describe("EmployeesService — F7 login-account creation", () => {
  it("creates a users row when userId is omitted (EMP-001)", async () => {
    const repo = makeRepo({
      createUserTx: vi.fn().mockResolvedValue({ id: EMP_USER_ID }),
      createEmployeeTx: vi.fn().mockResolvedValue([makeRow({ userId: EMP_USER_ID })]),
    });
    const { svc, password } = makeService({ repo, perms: { create: ALLOW() } });
    const res = await svc.createEmployee(actor, {
      email: "new@co.test",
      fullName: "New Hire",
      workType: "offline",
      employmentType: "full_time",
      salaryType: "monthly",
    } as never);
    expect(password.hash).toHaveBeenCalledTimes(1);
    expect(repo.createUserTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      expect.objectContaining({
        email: "new@co.test",
        fullName: "New Hire",
        passwordHash: "argon2-hash",
      }),
    );
    expect(repo.createEmployeeTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      expect.objectContaining({ userId: EMP_USER_ID }),
    );
    expect(res).toBeDefined();
  });

  it("rejects create with neither userId nor email+fullName", async () => {
    const { svc } = makeService();
    await expect(
      svc.createEmployee(actor, {
        workType: "offline",
        employmentType: "full_time",
        salaryType: "monthly",
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it("reuses an existing userId without creating an account", async () => {
    const repo = makeRepo();
    const { svc, password } = makeService({ repo });
    await svc.createEmployee(actor, {
      userId: EMP_USER_ID,
      workType: "offline",
      employmentType: "full_time",
      salaryType: "monthly",
    } as never);
    expect(repo.createUserTx).not.toHaveBeenCalled();
    expect(password.hash).not.toHaveBeenCalled();
  });

  // ─── CS-9: email-domain policy at account creation (BẤT BIẾN #6) ───────────────
  it("CS-9: REJECT tạo tài khoản khi email NGOÀI domain allowlist (403/400) — KHÔNG createUserTx", async () => {
    const repo = makeRepo({ createUserTx: vi.fn() });
    const securityPolicy = makeSecurityPolicy(false); // policy chặn domain
    // Grant create:user so this isolates the domain-policy reject (not the create:user gate).
    const { svc, password } = makeService({ repo, securityPolicy, perms: { create: ALLOW() } });
    await expect(
      svc.createEmployee(actor, {
        email: "outsider@evil.test",
        fullName: "Outsider",
        workType: "offline",
        employmentType: "full_time",
        salaryType: "monthly",
      } as never),
    ).rejects.toThrow(BadRequestException);
    // fail-closed: KHÔNG hash mật khẩu, KHÔNG tạo user row.
    expect(password.hash).not.toHaveBeenCalled();
    expect(repo.createUserTx).not.toHaveBeenCalled();
  });

  it("CS-9: email TRONG domain allowlist → tạo tài khoản bình thường", async () => {
    const repo = makeRepo({
      createUserTx: vi.fn().mockResolvedValue({ id: EMP_USER_ID }),
      createEmployeeTx: vi.fn().mockResolvedValue([makeRow({ userId: EMP_USER_ID })]),
    });
    const securityPolicy = makeSecurityPolicy(true);
    const { svc } = makeService({ repo, securityPolicy, perms: { create: ALLOW() } });
    await svc.createEmployee(actor, {
      email: "alice@company.com",
      fullName: "Alice",
      workType: "offline",
      employmentType: "full_time",
      salaryType: "monthly",
    } as never);
    expect(securityPolicy.assertEmailDomainAllowedTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      "alice@company.com",
    );
    expect(repo.createUserTx).toHaveBeenCalledTimes(1);
  });

  // ─── S2-INT-1: provisioning an account requires create:user; the act is audited ───────────────
  it("S2-INT-1 DENY: provisioning without create:user → 403 + 0 writes (no hash, no user, no audit)", async () => {
    const repo = makeRepo({ createUserTx: vi.fn() });
    const { svc, password, audit } = makeService({ repo, perms: {} }); // no create:user grant
    await expect(
      svc.createEmployee(actor, {
        email: "minted@co.test",
        fullName: "Minted",
        workType: "offline",
        employmentType: "full_time",
        salaryType: "monthly",
      } as never),
    ).rejects.toThrow(ForbiddenException);
    // Gated BEFORE the tx → nothing hashed, no user, no employee, no audit.
    expect(password.hash).not.toHaveBeenCalled();
    expect(repo.createUserTx).not.toHaveBeenCalled();
    expect(repo.createEmployeeTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("S2-INT-1: provisioning with create:user writes a user.created audit (no password in snapshot)", async () => {
    const repo = makeRepo({
      createEmployeeTx: vi.fn().mockResolvedValue([makeRow({ userId: EMP_USER_ID })]),
    });
    const { svc, audit } = makeService({ repo, perms: { create: ALLOW() } });
    await svc.createEmployee(actor, {
      email: "new@co.test",
      fullName: "New Hire",
      workType: "offline",
      employmentType: "full_time",
      salaryType: "monthly",
    } as never);
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({
        action: "user.created",
        objectType: "user",
        objectId: EMP_USER_ID,
        actorUserId: ACTOR_ID,
      }),
    );
    for (const call of audit.record.mock.calls) {
      const entry = call[1] as { after?: Record<string, unknown> };
      if (entry.after && typeof entry.after === "object") {
        expect(Object.keys(entry.after)).not.toContain("passwordHash");
        expect(Object.keys(entry.after)).not.toContain("password_hash");
      }
    }
  });

  it("S2-INT-1: linking a cross-tenant userId → 404 (in-tenant validation, never FK-links across tenants)", async () => {
    const repo = makeRepo({ findLinkableUserTx: vi.fn().mockResolvedValue(undefined) });
    const { svc } = makeService({ repo });
    await expect(
      svc.createEmployee(actor, {
        userId: EMP_USER_ID,
        workType: "offline",
        employmentType: "full_time",
        salaryType: "monthly",
      } as never),
    ).rejects.toThrow(NotFoundException);
    expect(repo.createEmployeeTx).not.toHaveBeenCalled();
  });

  it("S2-INT-1: linking a userId already on an active employee → 409", async () => {
    const repo = makeRepo({ findActiveByUserIdTx: vi.fn().mockResolvedValue({ id: EMP2_ID }) });
    const { svc } = makeService({ repo });
    await expect(
      svc.createEmployee(actor, {
        userId: EMP_USER_ID,
        workType: "offline",
        employmentType: "full_time",
        salaryType: "monthly",
      } as never),
    ).rejects.toThrow(ConflictException);
    expect(repo.createEmployeeTx).not.toHaveBeenCalled();
  });

  it("S2-INT-1: linking an existing userId does NOT require create:user and writes no user.created audit", async () => {
    const repo = makeRepo();
    const { svc, permission, audit } = makeService({ repo, perms: {} });
    await svc.createEmployee(actor, {
      userId: EMP_USER_ID,
      workType: "offline",
      employmentType: "full_time",
      salaryType: "monthly",
    } as never);
    // create:user was never consulted (link arm) and no account-creation audit was written.
    for (const call of permission.can.mock.calls) {
      expect((call[0] as { action: string }).action).not.toBe("create");
    }
    const actions = audit.record.mock.calls.map((c) => (c[1] as { action: string }).action);
    expect(actions).not.toContain("user.created");
  });

  it("CS-9: dùng userId có sẵn → KHÔNG check email-domain (chỉ áp khi TẠO tài khoản)", async () => {
    const securityPolicy = makeSecurityPolicy(false); // dù chặn, không nên gọi vì có userId
    const { svc } = makeService({ securityPolicy });
    await svc.createEmployee(actor, {
      userId: EMP_USER_ID,
      workType: "offline",
      employmentType: "full_time",
      salaryType: "monthly",
    } as never);
    expect(securityPolicy.assertEmailDomainAllowedTx).not.toHaveBeenCalled();
  });
});

// ─── F8: search filter ───────────────────────────────────────────────────────────

describe("EmployeesService — F8 search filter", () => {
  it("forwards the search term to the repository", async () => {
    const repo = makeRepo({ listEmployeesTx: vi.fn().mockResolvedValue([]) });
    const { svc } = makeService({ repo });
    await svc.listEmployees(actor, { search: "alice" });
    expect(repo.listEmployeesTx).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      expect.objectContaining({ search: "alice" }),
      // S2-HR-EMP-LEGACY-LOCK-1: scope predicate now threaded as the 4th arg.
      expect.anything(),
    );
  });
});
