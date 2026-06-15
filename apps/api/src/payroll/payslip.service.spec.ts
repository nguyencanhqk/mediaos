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
    listActiveSalaryProfilesTx: vi
      .fn()
      .mockResolvedValue([
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

// G12-3: PayslipService gọi BonusPenaltyRepository để gộp thưởng/phạt + consume.
function makeBonusRepo(overrides: Record<string, unknown> = {}) {
  return {
    aggregateApprovedForPeriodTx: vi.fn().mockResolvedValue([]),
    markConsumedTx: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function make(
  decision: Decision,
  repoOverrides: Record<string, unknown> = {},
  bonusOverrides: Record<string, unknown> = {},
) {
  const repo = makeRepo(repoOverrides);
  const bonusRepo = makeBonusRepo(bonusOverrides);
  const db = makeDb();
  const permission = { can: vi.fn().mockResolvedValue(decision) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const svc = new PayslipService(
    repo as never,
    bonusRepo as never,
    db as never,
    permission as never,
    audit as never,
  );
  return { svc, repo, bonusRepo, audit, permission };
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
    await expect(svc.runPayroll(actor, { payrollPeriodId: PERIOD_ID })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
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
    await expect(svc.runPayroll(actor, { payrollPeriodId: PERIOD_ID })).rejects.toBeInstanceOf(
      ConflictException,
    );
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
    await expect(svc.runPayroll(actor, { payrollPeriodId: PERIOD_ID })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe("PayslipService — snapshot audit-in-tx + bonus/penalty wiring", () => {
  it("(d) ALLOW + locked, NO approved bonus/penalty → audit 'payslip'; bonus/penalty null, KPI unset", async () => {
    const { svc, repo, audit, bonusRepo } = make(ALLOW);
    const result = await svc.runPayroll(actor, { payrollPeriodId: PERIOD_ID });
    expect(result.created).toBe(1);
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ objectType: "payslip", action: "payslip_created" }),
    );
    // KPI still a slot (G8-4) → undefined. No approved bonus/penalty → null, net unchanged, no consume.
    const insertArg = repo.insertPayslipTx.mock.calls[0][2] as Record<string, unknown>;
    expect(insertArg.kpiAmount).toBeUndefined();
    expect(insertArg.bonusAmount).toBeNull();
    expect(insertArg.penaltyAmount).toBeNull();
    expect(insertArg.net).toBe("5000.00");
    expect(bonusRepo.markConsumedTx).not.toHaveBeenCalled();
  });

  it("(f) approved bonus+penalty → bonus/penalty set, net = gross+bonus−penalty, items + consume", async () => {
    const { svc, repo, bonusRepo } = make(
      ALLOW,
      {},
      {
        aggregateApprovedForPeriodTx: vi.fn().mockResolvedValue([
          {
            id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            kind: "bonus",
            amount: "1000.00",
            reason: "Tết",
          },
          {
            id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
            kind: "penalty",
            amount: "300.00",
            reason: "Trễ",
          },
        ]),
      },
    );
    const result = await svc.runPayroll(actor, { payrollPeriodId: PERIOD_ID });
    expect(result.created).toBe(1);
    const insertArg = repo.insertPayslipTx.mock.calls[0][2] as Record<string, unknown>;
    expect(insertArg.bonusAmount).toBe("1000.00");
    expect(insertArg.penaltyAmount).toBe("300.00");
    expect(insertArg.net).toBe("5700.00"); // 5000 + 1000 − 300
    // bonus + penalty line items inserted (besides base earning).
    const itemTypes = repo.insertItemTx.mock.calls.map(
      (c) => (c[2] as { itemType: string }).itemType,
    );
    expect(itemTypes).toContain("bonus");
    expect(itemTypes).toContain("penalty");
    // consume: both ids bound to the period (chống trả 2 lần).
    expect(bonusRepo.markConsumedTx).toHaveBeenCalledWith(
      FAKE_TX,
      actor.companyId,
      ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "dddddddd-dddd-dddd-dddd-dddddddddddd"],
      PERIOD_ID,
    );
  });

  it("(f) penalty > gross → net clamped to 0 (no negative wage), penalty still itemized", async () => {
    const { svc, repo } = make(
      ALLOW,
      {},
      {
        aggregateApprovedForPeriodTx: vi
          .fn()
          .mockResolvedValue([
            {
              id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
              kind: "penalty",
              amount: "9000.00",
              reason: "Lớn",
            },
          ]),
      },
    );
    await svc.runPayroll(actor, { payrollPeriodId: PERIOD_ID });
    const insertArg = repo.insertPayslipTx.mock.calls[0][2] as Record<string, unknown>;
    expect(insertArg.net).toBe("0.00"); // max(0, 5000 − 9000)
    expect(insertArg.penaltyAmount).toBe("9000.00");
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
      listActiveSalaryProfilesTx: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('relation "payslips" does not exist'), { code: "42P01" }),
        ),
    });
    await expect(svc.runPayroll(actor, { payrollPeriodId: PERIOD_ID })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
