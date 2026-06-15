/**
 * G12-2 deny/append-only RED suite for PayslipService (CROWN JEWEL — SNAPSHOT APPEND-ONLY, ADR-0005).
 *
 * (a) Append-only contract: service KHÔNG có update()/remove() (sửa = ghi mới ở repo).
 * (b) Permission DENY → runPayroll/list/getOne throw Forbidden, 0 audit, 0 insert.
 * (c) BR lock: runPayroll khi attendance period CHƯA locked → Conflict, 0 payslip.
 * (d) snapshot ALLOW + locked → audit 'payslip' object_type ghi cùng tx; KPI/bonus/penalty KHÔNG set.
 * (e) mapError: lỗi PG/infra → 500 generic, KHÔNG leak schema/constraint.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from "@nestjs/common";
import { PayslipService } from "./payslip.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const PERIOD_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const PROFILE_ID = "33333333-3333-3333-3333-333333333333";

const actor = { id: ACTOR_ID, companyId: COMPANY_ID };

type Decision = { allow: boolean; reason: string; auditRequired: boolean };
const ALLOW: Decision = { allow: true, reason: "allow", auditRequired: true };
const DENY: Decision = { allow: false, reason: "deny", auditRequired: true };

const FAKE_TX = { __tx: true };
function makeDb() {
  return {
    withTenant: vi.fn((_companyId: string, fn: (tx: unknown) => Promise<unknown>) => fn(FAKE_TX)),
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    findPeriodWithAttendanceLockTx: vi.fn().mockResolvedValue({
      id: PERIOD_ID,
      periodMonth: "2026-01",
      status: "draft",
      attendancePeriodStatus: "locked",
    }),
    listActiveSalaryProfilesTx: vi.fn().mockResolvedValue([
      { id: PROFILE_ID, userId: USER_ID, baseSalary: "5000.00", allowances: [], currency: "VND" },
    ]),
    countForPeriodUserTx: vi.fn().mockResolvedValue(0),
    aggregateAttendanceTx: vi.fn().mockResolvedValue({ presentDays: 22, lateMinutes: 0 }),
    insertPayslipTx: vi.fn().mockResolvedValue([{ id: "99999999-9999-9999-9999-999999999999" }]),
    insertItemTx: vi.fn().mockResolvedValue([{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }]),
    listTx: vi.fn().mockResolvedValue([]),
    findByIdTx: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function make(decision: Decision, repoOverrides: Record<string, unknown> = {}) {
  const repo = makeRepo(repoOverrides);
  const db = makeDb();
  const permission = { can: vi.fn().mockResolvedValue(decision) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const svc = new PayslipService(
    repo as never,
    db as never,
    permission as never,
    audit as never,
  );
  return { svc, repo, audit, permission };
}

describe("PayslipService — append-only contract", () => {
  it("(a) has NO update()/remove() method (append-only — sửa = ghi mới)", () => {
    const { svc } = make(ALLOW);
    expect((svc as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).remove).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).delete).toBeUndefined();
    expect(typeof svc.runPayroll).toBe("function");
  });
});

describe("PayslipService — permission deny (fail-closed)", () => {
  it("(b) runPayroll DENY → Forbidden, 0 insert, 0 audit", async () => {
    const { svc, repo, audit } = make(DENY);
    await expect(
      svc.runPayroll(actor, { payrollPeriodId: PERIOD_ID }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.insertPayslipTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("(b) list/getOne DENY → Forbidden", async () => {
    const { svc } = make(DENY);
    await expect(svc.list(actor, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.getOne(actor, PERIOD_ID)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("PayslipService — BR lock gate", () => {
  it("(c) attendance period NOT locked → Conflict, 0 payslip", async () => {
    const { svc, repo, audit } = make(ALLOW, {
      findPeriodWithAttendanceLockTx: vi.fn().mockResolvedValue({
        id: PERIOD_ID,
        periodMonth: "2026-01",
        status: "draft",
        attendancePeriodStatus: "open",
      }),
    });
    await expect(
      svc.runPayroll(actor, { payrollPeriodId: PERIOD_ID }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.insertPayslipTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("(c) no linked attendance period → Conflict (fail-closed, not fail-open)", async () => {
    const { svc } = make(ALLOW, {
      findPeriodWithAttendanceLockTx: vi.fn().mockResolvedValue({
        id: PERIOD_ID,
        periodMonth: "2026-01",
        status: "draft",
        attendancePeriodStatus: null,
      }),
    });
    await expect(
      svc.runPayroll(actor, { payrollPeriodId: PERIOD_ID }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("PayslipService — snapshot audit-in-tx + KPI slot null", () => {
  it("(d) ALLOW + locked → writes payslip audit 'payslip' object_type; KPI/bonus/penalty NOT set", async () => {
    const { svc, repo, audit } = make(ALLOW);
    const result = await svc.runPayroll(actor, { payrollPeriodId: PERIOD_ID });
    expect(result.created).toBe(1);
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ objectType: "payslip", action: "payslip_created" }),
    );
    // KPI/bonus/penalty are slots for G8-4 — insert payload must not set them.
    const insertArg = repo.insertPayslipTx.mock.calls[0][2] as Record<string, unknown>;
    expect(insertArg.kpiAmount).toBeUndefined();
    expect(insertArg.bonusAmount).toBeUndefined();
    expect(insertArg.penaltyAmount).toBeUndefined();
  });

  it("(d) idempotent — user already paid this period is skipped (count>0)", async () => {
    const { svc, repo, audit } = make(ALLOW, {
      countForPeriodUserTx: vi.fn().mockResolvedValue(1),
    });
    const result = await svc.runPayroll(actor, { payrollPeriodId: PERIOD_ID });
    expect(result.created).toBe(0);
    expect(repo.insertPayslipTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe("PayslipService — mapError no-leak", () => {
  it("(e) infra error → 500 generic (no schema/constraint leak)", async () => {
    const { svc } = make(ALLOW, {
      listActiveSalaryProfilesTx: vi.fn().mockRejectedValue(
        Object.assign(new Error('relation "payslips" does not exist'), { code: "42P01" }),
      ),
    });
    await expect(
      svc.runPayroll(actor, { payrollPeriodId: PERIOD_ID }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
