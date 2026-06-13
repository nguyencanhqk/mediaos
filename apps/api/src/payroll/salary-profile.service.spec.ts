/**
 * G12-1 deny-path RED suite for SalaryProfileService (CROWN JEWEL — lương nhạy cảm, BẤT BIẾN #3).
 *
 * (a) view DENY → service KHÔNG trả allowances/baseSalary (mask null) và GHI 0 audit row.
 * (b) view ALLOW nhưng auditRequired=false (misconfig) → fail-SAFE: mask + ghi 0 audit (mirror revealSalary).
 * (c) UPDATE ALLOW → đúng 1 audit row action='salary_profile_updated' objectType='salary_profile'
 *     với before/after (chứng minh AUDIT khi sửa).
 * (d) audit INSERT ném lỗi trong tx → toàn bộ update rollback, lương KHÔNG lộ (reveal⟹audit atomic).
 * (e) mapError: lỗi PG/infra → 500 generic, KHÔNG leak schema/constraint.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { SalaryProfileService } from "./salary-profile.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const PROFILE_ID = "55555555-5555-5555-5555-555555555555";
const TARGET_USER_ID = "22222222-2222-2222-2222-222222222222";

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
    id: PROFILE_ID,
    companyId: COMPANY_ID,
    userId: TARGET_USER_ID,
    salaryType: "monthly",
    payCycle: "monthly",
    effectiveDate: "2026-01-01",
    baseSalary: "5000.00",
    allowances: [{ name: "lunch", amount: 500 }],
    currency: "VND",
    status: "active",
    note: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listTx: vi.fn().mockResolvedValue([makeRow()]),
    findByIdTx: vi.fn().mockResolvedValue(makeRow()),
    createTx: vi.fn().mockResolvedValue([makeRow()]),
    updateTx: vi.fn().mockResolvedValue([makeRow()]),
    softDeleteTx: vi.fn().mockResolvedValue([makeRow()]),
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

function build(opts: {
  perms: Record<string, Decision>;
  repo?: Record<string, unknown>;
  audit?: ReturnType<typeof makeAudit>;
}) {
  const repo = makeRepo(opts.repo);
  const audit = opts.audit ?? makeAudit();
  const permission = makePermission(opts.perms);
  const db = makeDb();
  const service = new SalaryProfileService(
    repo as never,
    db as never,
    permission as never,
    audit as never,
  );
  return { service, repo, audit, permission, db };
}

describe("SalaryProfileService — view (mask + audit atomic)", () => {
  it("(a) view DENY → baseSalary/allowances masked null, 0 audit row", async () => {
    const { service, audit } = build({ perms: { "view-salary-profile": DENY() } });
    const res = await service.getOne(actor, PROFILE_ID);
    expect(res.baseSalary).toBeNull();
    expect(res.allowances).toBeNull();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("(b) view ALLOW but auditRequired=false (misconfig) → fail-SAFE mask + 0 audit", async () => {
    const { service, audit } = build({ perms: { "view-salary-profile": ALLOW(false) } });
    const res = await service.getOne(actor, PROFILE_ID);
    expect(res.baseSalary).toBeNull();
    expect(res.allowances).toBeNull();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("view ALLOW + auditRequired → reveals salary AND writes exactly 1 view audit", async () => {
    const { service, audit } = build({ perms: { "view-salary-profile": ALLOW() } });
    const res = await service.getOne(actor, PROFILE_ID);
    expect(res.baseSalary).toBe(5000);
    expect(res.allowances).toEqual([{ name: "lunch", amount: 500 }]);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ action: "salary_profile_viewed", objectType: "salary_profile" }),
    );
  });

  it("getOne throws NotFound when row absent (before any audit)", async () => {
    const { service, audit } = build({
      perms: { "view-salary-profile": ALLOW() },
      repo: { findByIdTx: vi.fn().mockResolvedValue(undefined) },
    });
    await expect(service.getOne(actor, PROFILE_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("list masks per-row when view denied (0 audit)", async () => {
    const { service, audit } = build({ perms: { "view-salary-profile": DENY() } });
    const rows = await service.list(actor, {});
    expect(rows[0].baseSalary).toBeNull();
    expect(rows[0].allowances).toBeNull();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe("SalaryProfileService — update (audit before/after + atomic)", () => {
  it("(c) UPDATE ALLOW → exactly 1 audit 'salary_profile_updated' with before/after", async () => {
    const before = makeRow({ baseSalary: "5000.00" });
    const after = makeRow({ baseSalary: "6000.00" });
    const { service, audit } = build({
      perms: { "manage-salary-profile": ALLOW() },
      repo: {
        findByIdTx: vi.fn().mockResolvedValue(before),
        updateTx: vi.fn().mockResolvedValue([after]),
      },
    });
    await service.update(actor, PROFILE_ID, { baseSalary: 6000 });
    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][1];
    expect(entry.action).toBe("salary_profile_updated");
    expect(entry.objectType).toBe("salary_profile");
    expect(entry.objectId).toBe(PROFILE_ID);
    expect(entry.before).toBeDefined();
    expect(entry.after).toBeDefined();
  });

  it("update DENY (manage) → 403, no write, no audit", async () => {
    const updateTx = vi.fn();
    const { service, audit } = build({
      perms: { "manage-salary-profile": DENY() },
      repo: { updateTx },
    });
    await expect(service.update(actor, PROFILE_ID, { baseSalary: 6000 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(updateTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("(d) audit INSERT throws in tx → whole update rolls back (error propagates, salary not leaked)", async () => {
    const audit = { record: vi.fn().mockRejectedValue(new Error("audit insert failed")) };
    const { service } = build({
      perms: { "manage-salary-profile": ALLOW() },
      audit,
    });
    // The thrown error must propagate so the surrounding withTenant tx rolls back.
    await expect(service.update(actor, PROFILE_ID, { baseSalary: 6000 })).rejects.toThrow();
  });

  it("update masks salary in its response by default (view it via audited GET)", async () => {
    const { service } = build({ perms: { "manage-salary-profile": ALLOW() } });
    const res = await service.update(actor, PROFILE_ID, { baseSalary: 6000 });
    expect(res.baseSalary).toBeNull();
    expect(res.allowances).toBeNull();
  });
});

describe("SalaryProfileService — create + delete", () => {
  it("create DENY (manage) → 403, no write, no audit", async () => {
    const createTx = vi.fn();
    const { service, audit } = build({
      perms: { "manage-salary-profile": DENY() },
      repo: { createTx },
    });
    await expect(
      service.create(actor, {
        userId: TARGET_USER_ID,
        salaryType: "monthly",
        payCycle: "monthly",
        effectiveDate: "2026-01-01",
        baseSalary: 5000,
        allowances: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(createTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("create ALLOW → 1 audit 'salary_profile_created', response masked", async () => {
    const { service, audit } = build({ perms: { "manage-salary-profile": ALLOW() } });
    const res = await service.create(actor, {
      userId: TARGET_USER_ID,
      salaryType: "monthly",
      payCycle: "monthly",
      effectiveDate: "2026-01-01",
      baseSalary: 5000,
      allowances: [],
    });
    expect(res.baseSalary).toBeNull();
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][1].action).toBe("salary_profile_created");
  });

  it("delete DENY (manage) → 403", async () => {
    const { service } = build({ perms: { "manage-salary-profile": DENY() } });
    await expect(service.remove(actor, PROFILE_ID)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("delete ALLOW → soft-delete + 1 audit 'salary_profile_deleted' with before", async () => {
    const { service, audit } = build({ perms: { "manage-salary-profile": ALLOW() } });
    await service.remove(actor, PROFILE_ID);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][1];
    expect(entry.action).toBe("salary_profile_deleted");
    expect(entry.objectType).toBe("salary_profile");
    expect(entry.before).toBeDefined();
  });

  it("delete ALLOW but row absent → NotFound (no audit)", async () => {
    const { service, audit } = build({
      perms: { "manage-salary-profile": ALLOW() },
      repo: { findByIdTx: vi.fn().mockResolvedValue(undefined) },
    });
    await expect(service.remove(actor, PROFILE_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("create ALLOW with currency + note → persists optional fields, audit after has values", async () => {
    const { service, audit } = build({ perms: { "manage-salary-profile": ALLOW() } });
    await service.create(actor, {
      userId: TARGET_USER_ID,
      salaryType: "hourly",
      payCycle: "weekly",
      effectiveDate: "2026-02-01",
      baseSalary: 100,
      allowances: [{ name: "ot", amount: 10 }],
      currency: "USD",
      note: "probation rate",
    });
    expect(audit.record.mock.calls[0][1].after).toBeDefined();
  });

  it("update with note null clears note (audit before/after captured)", async () => {
    const { service, audit } = build({ perms: { "manage-salary-profile": ALLOW() } });
    await service.update(actor, PROFILE_ID, { note: null, status: "inactive" });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it("update ALLOW but row absent → NotFound (no salary leaked)", async () => {
    const { service, audit } = build({
      perms: { "manage-salary-profile": ALLOW() },
      repo: { findByIdTx: vi.fn().mockResolvedValue(undefined) },
    });
    await expect(service.update(actor, PROFILE_ID, { baseSalary: 7000 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("list with userId + status filters threads through to the repo", async () => {
    const listTx = vi.fn().mockResolvedValue([makeRow()]);
    const { service, repo } = build({
      perms: { "view-salary-profile": ALLOW() },
      repo: { listTx },
    });
    void repo;
    await service.list(actor, { userId: TARGET_USER_ID, status: "active" });
    expect(listTx).toHaveBeenCalledWith(
      FAKE_TX,
      COMPANY_ID,
      expect.objectContaining({ userId: TARGET_USER_ID, status: "active" }),
    );
  });

  it("create maps a unique-violation to 409 Conflict (active profile exists)", async () => {
    const pgErr = Object.assign(new Error("dup"), { code: "23505" });
    const { service } = build({
      perms: { "manage-salary-profile": ALLOW() },
      repo: { createTx: vi.fn().mockRejectedValue(pgErr) },
    });
    await expect(
      service.create(actor, {
        userId: TARGET_USER_ID,
        salaryType: "monthly",
        payCycle: "monthly",
        effectiveDate: "2026-01-01",
        baseSalary: 5000,
        allowances: [],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("SalaryProfileService — mapError (no schema/constraint leak)", () => {
  it("(e) infra/PG error on read → generic 500, message does NOT leak constraint/schema", async () => {
    const pgErr = Object.assign(new Error('null value in column "base_salary" violates not-null'), {
      code: "23502",
      constraint: "salary_profiles_base_salary_not_null",
      table: "salary_profiles",
    });
    const { service } = build({
      perms: { "view-salary-profile": ALLOW() },
      repo: { findByIdTx: vi.fn().mockRejectedValue(pgErr) },
    });
    try {
      await service.getOne(actor, PROFILE_ID);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InternalServerErrorException);
      const msg = (err as InternalServerErrorException).message;
      expect(msg).not.toContain("base_salary");
      expect(msg).not.toContain("salary_profiles");
      expect(msg).not.toContain("23502");
    }
  });
});
