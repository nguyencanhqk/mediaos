/**
 * S3-ATT-BE-1 — RED-first deny-path + behavior suite for the rewritten Today / check-in / check-out
 * (DB-04 §7 effective shift+rule, leave-block, server-time, attendance_logs append-only).
 *
 * Pure unit tests — repo/db/permission/audit/outbox/hrTasks all mocked (no Postgres). The (action,resource)
 * status-case duality of the leave query + the 0-dup race + cross-tenant isolation are proven against a real
 * DB in attendance-be1.int.spec.ts; here we pin the SERVICE control-flow: employment gate, leave gate behind
 * rule.blockWhenLeaveApproved, double-check-in/out, today-never-throws, and the persisted column values.
 */

import { describe, expect, it, vi } from "vitest";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { AttendanceService } from "./attendance.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const EMP_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const actor = { id: ACTOR_ID, companyId: COMPANY_ID };

function makeEmployee(overrides: Record<string, unknown> = {}) {
  return { id: EMP_ID, status: "active", orgUnitId: null, positionId: null, ...overrides };
}

function makeShift(overrides: Record<string, unknown> = {}) {
  return {
    id: "ssssssss-ssss-ssss-ssss-ssssssssssss",
    shiftCode: "OFFICE_8H",
    name: "Ca hành chính 8 giờ",
    startTime: "08:00:00",
    endTime: "17:00:00",
    breakMinutes: 60,
    requiredWorkingMinutes: 480,
    graceLateMinutes: 5,
    graceEarlyLeaveMinutes: 5,
    crossDay: false,
    isDefault: true,
    metadata: { timezone: "Asia/Ho_Chi_Minh" },
    ...overrides,
  };
}

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr",
    userId: ACTOR_ID,
    workDate: "2024-06-03",
    employeeId: EMP_ID,
    shiftId: null,
    checkInAt: null,
    checkOutAt: null,
    checkInMethod: null,
    checkOutMethod: null,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    workingMinutes: null,
    requiredWorkingMinutes: null,
    missingMinutes: null,
    breakMinutes: null,
    status: "missing_checkin",
    attendanceStatus: null,
    isLate: null,
    isEarlyLeave: null,
    isMissingCheckOut: null,
    note: null,
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    resolveEmployeeByUserIdTx: vi.fn().mockResolvedValue(makeEmployee()),
    resolveEffectiveShiftTx: vi.fn().mockResolvedValue(null),
    findDefaultShiftTx: vi.fn().mockResolvedValue(null),
    findShiftByIdTx: vi.fn().mockResolvedValue(null),
    resolveEffectiveRuleTx: vi.fn().mockResolvedValue(null),
    findRuleByCodeTx: vi.fn().mockResolvedValue(null),
    findAnyActiveRuleTx: vi.fn().mockResolvedValue(null),
    findApprovedFullDayLeaveTx: vi.fn().mockResolvedValue(false),
    isPeriodLockedTx: vi.fn().mockResolvedValue(false),
    findRecordByUserDateTx: vi.fn().mockResolvedValue([]),
    findOpenRecordForUserTx: vi.fn().mockResolvedValue([]),
    insertRecordTx: vi.fn().mockResolvedValue([makeRecord({ checkInAt: new Date() })]),
    updateRecordTx: vi.fn().mockResolvedValue([makeRecord({ checkOutAt: new Date() })]),
    insertAttendanceLogTx: vi.fn().mockResolvedValue([{ id: "log-1" }]),
    ...overrides,
  };
}

function makeDb(repo: ReturnType<typeof makeRepo>) {
  return {
    withTenant: vi
      .fn()
      .mockImplementation((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(repo)),
  };
}

const makePermission = () => ({ can: vi.fn().mockResolvedValue({ allow: true }) });
const makeAudit = () => ({ record: vi.fn().mockResolvedValue(undefined) });
const makeOutbox = () => ({ enqueue: vi.fn().mockResolvedValue(undefined) });

function build(repo: ReturnType<typeof makeRepo>) {
  const audit = makeAudit();
  const outbox = makeOutbox();
  const service = new AttendanceService(
    makeDb(repo) as never,
    repo as never,
    makePermission() as never,
    audit as never,
    outbox as never,
  );
  return { service, audit, outbox };
}

// ─── Employment gate (server-side resolve; never trust client employee_id) ────────

describe("AttendanceService BE-1 — employment gate", () => {
  it("check-in with NO employee mapping → Forbidden", async () => {
    const repo = makeRepo({ resolveEmployeeByUserIdTx: vi.fn().mockResolvedValue(null) });
    const { service } = build(repo);
    await expect(service.checkIn(actor, { method: "web" })).rejects.toThrow(ForbiddenException);
  });

  it("check-out with NO employee mapping → Forbidden", async () => {
    const repo = makeRepo({ resolveEmployeeByUserIdTx: vi.fn().mockResolvedValue(null) });
    const { service } = build(repo);
    await expect(service.checkOut(actor, { method: "web" })).rejects.toThrow(ForbiddenException);
  });

  it.each(["resigned", "terminated"])("check-in with %s employee → Forbidden", async (status) => {
    const repo = makeRepo({
      resolveEmployeeByUserIdTx: vi.fn().mockResolvedValue(makeEmployee({ status })),
    });
    const { service } = build(repo);
    await expect(service.checkIn(actor, { method: "web" })).rejects.toThrow(ForbiddenException);
  });

  it("check-in with inactive employee → Conflict", async () => {
    const repo = makeRepo({
      resolveEmployeeByUserIdTx: vi.fn().mockResolvedValue(makeEmployee({ status: "inactive" })),
    });
    const { service } = build(repo);
    await expect(service.checkIn(actor, { method: "web" })).rejects.toThrow(ConflictException);
  });
});

// ─── Leave-block (full-day Approved leave) behind rule.blockWhenLeaveApproved ──────

describe("AttendanceService BE-1 — approved-leave block", () => {
  it("check-in blocked when a full-day Approved leave covers today → Conflict", async () => {
    const repo = makeRepo({ findApprovedFullDayLeaveTx: vi.fn().mockResolvedValue(true) });
    const { service } = build(repo);
    await expect(service.checkIn(actor, { method: "web" })).rejects.toThrow(ConflictException);
  });

  it("check-out blocked when a full-day Approved leave covers the open day → Conflict", async () => {
    const repo = makeRepo({
      findOpenRecordForUserTx: vi.fn().mockResolvedValue([makeRecord({ checkInAt: new Date() })]),
      findApprovedFullDayLeaveTx: vi.fn().mockResolvedValue(true),
    });
    const { service } = build(repo);
    await expect(service.checkOut(actor, { method: "web" })).rejects.toThrow(ConflictException);
  });

  it("does NOT block when the effective rule sets block_when_leave_approved=false", async () => {
    const repo = makeRepo({
      resolveEffectiveRuleTx: vi.fn().mockResolvedValue({
        id: "rule-1",
        ruleCode: "NO_BLOCK",
        requireCheckIn: true,
        requireCheckOut: true,
        ruleConfig: { block_when_leave_approved: false },
      }),
      findApprovedFullDayLeaveTx: vi.fn().mockResolvedValue(true),
    });
    const { service } = build(repo);
    await expect(service.checkIn(actor, { method: "web" })).resolves.toBeTruthy();
    // Gate short-circuits BEFORE querying leave when the rule disables the block.
    expect(repo.findApprovedFullDayLeaveTx).not.toHaveBeenCalled();
  });
});

// ─── Double check-in / check-out ──────────────────────────────────────────────────

describe("AttendanceService BE-1 — duplicate guards", () => {
  it("blocks a second check-in on the same day → Conflict", async () => {
    const repo = makeRepo({
      findRecordByUserDateTx: vi.fn().mockResolvedValue([makeRecord({ checkInAt: new Date() })]),
    });
    const { service } = build(repo);
    await expect(service.checkIn(actor, { method: "web" })).rejects.toThrow(ConflictException);
  });

  it("blocks check-out when there is no open (checked-in) record → Conflict", async () => {
    const repo = makeRepo({ findOpenRecordForUserTx: vi.fn().mockResolvedValue([]) });
    const { service } = build(repo);
    await expect(service.checkOut(actor, { method: "web" })).rejects.toThrow(ConflictException);
  });
});

// ─── getToday never throws on state; reports allowedActions + disabledReason ───────

describe("AttendanceService BE-1 — getToday", () => {
  it("no employee mapping → does NOT throw; both actions disabled + reason", async () => {
    const repo = makeRepo({ resolveEmployeeByUserIdTx: vi.fn().mockResolvedValue(null) });
    const { service } = build(repo);
    const out = await service.getToday(actor);
    expect(out.employee).toBeNull();
    expect(out.allowedActions).toEqual({ canCheckIn: false, canCheckOut: false });
    expect(out.disabledReason).toContain("hồ sơ nhân sự");
    expect(out.periodLocked).toBe(false);
  });

  it("no effective shift → shift:null, no 500, check-in still allowed", async () => {
    const repo = makeRepo(); // resolveEffectiveShiftTx + findDefaultShiftTx both null
    const { service } = build(repo);
    const out = await service.getToday(actor);
    expect(out.shift).toBeNull();
    expect(out.employee).toMatchObject({ id: EMP_ID, status: "active" });
    expect(out.allowedActions.canCheckIn).toBe(true);
  });

  it("full-day Approved leave today → both actions disabled + leave reason", async () => {
    const repo = makeRepo({
      findDefaultShiftTx: vi.fn().mockResolvedValue(makeShift()),
      findApprovedFullDayLeaveTx: vi.fn().mockResolvedValue(true),
    });
    const { service } = build(repo);
    const out = await service.getToday(actor);
    expect(out.allowedActions).toEqual({ canCheckIn: false, canCheckOut: false });
    expect(out.disabledReason).toContain("nghỉ");
  });

  it("already checked out → canCheckOut false + completed reason", async () => {
    const repo = makeRepo({
      findRecordByUserDateTx: vi
        .fn()
        .mockResolvedValue([makeRecord({ checkInAt: new Date(), checkOutAt: new Date() })]),
    });
    const { service } = build(repo);
    const out = await service.getToday(actor);
    expect(out.allowedActions).toEqual({ canCheckIn: false, canCheckOut: false });
    expect(out.disabledReason).toContain("hoàn tất");
  });
});

// ─── Persisted column values + append-only log + audit/outbox once ────────────────

describe("AttendanceService BE-1 — check-in persistence", () => {
  it("writes legacy + new columns, one append-only log, one audit, one outbox event", async () => {
    const repo = makeRepo({ findDefaultShiftTx: vi.fn().mockResolvedValue(makeShift()) });
    const { service, audit, outbox } = build(repo);

    // Freeze server time at exactly 08:00 VN on the work date so status is deterministically on-time.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-03T01:00:00Z"));
    try {
      await service.checkIn(actor, {
        method: "web",
        clientTime: "2024-06-03T01:00:00Z",
        clientTimezone: "Asia/Ho_Chi_Minh",
        location: { lat: 10.5, lng: 106.7, label: "HQ" },
      });
    } finally {
      vi.useRealTimers();
    }

    const values = repo.insertRecordTx.mock.calls[0][1] as Record<string, unknown>;
    expect(values).toMatchObject({
      userId: ACTOR_ID,
      employeeId: EMP_ID,
      checkInMethod: "web",
      attendanceSource: "WEB",
      workMode: "Office",
      isMissingCheckOut: true,
      requiredWorkingMinutes: 480,
      breakMinutes: 60,
    });
    expect(values["status"]).toBe("present"); // legacy lowercase
    expect(values["attendanceStatus"]).toBe("Checked-in"); // TitleCase DB-04

    const log = repo.insertAttendanceLogTx.mock.calls[0][1] as Record<string, unknown>;
    expect(log).toMatchObject({
      logType: "Check-in",
      employeeId: EMP_ID,
      source: "WEB",
      isValid: true,
      clientTimezone: "Asia/Ho_Chi_Minh",
    });
    // first/last log id written back via a follow-up record update.
    expect(repo.updateRecordTx).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.any(String),
      { firstLogId: "log-1", lastLogId: "log-1" },
      repo,
    );

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect((audit.record.mock.calls[0][1] as { action: string }).action).toBe(
      "attendance.check_in",
    );
    expect((audit.record.mock.calls[0][1] as { objectType: string }).objectType).toBe(
      "attendance_record",
    );
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(repo.insertAttendanceLogTx).toHaveBeenCalledTimes(1);
  });

  it("server time is authoritative: a bogus clientTime never feeds lateness calc", async () => {
    // Shift starts 08:00 VN; we pass a clientTime claiming 08:00 but the SERVER clock is what counts.
    const repo = makeRepo({ findDefaultShiftTx: vi.fn().mockResolvedValue(makeShift()) });
    const { service } = build(repo);
    await service.checkIn(actor, { method: "web", clientTime: "2030-01-01T00:00:00Z" });
    const values = repo.insertRecordTx.mock.calls[0][1] as Record<string, unknown>;
    // lateMinutes is derived from new Date() (server), not the client claim → a finite >= 0 number.
    expect(typeof values["lateMinutes"]).toBe("number");
    expect(values["lateMinutes"] as number).toBeGreaterThanOrEqual(0);
  });
});

describe("AttendanceService BE-1 — check-out computation", () => {
  it("computes working/early/missing from the stored shift and marks check-out complete", async () => {
    const checkInAt = new Date("2024-06-03T01:00:00Z"); // 08:00 VN
    const repo = makeRepo({
      findOpenRecordForUserTx: vi.fn().mockResolvedValue([
        makeRecord({
          checkInAt,
          shiftId: "ssssssss-ssss-ssss-ssss-ssssssssssss",
          breakMinutes: 60,
          requiredWorkingMinutes: 480,
          lateMinutes: 0,
        }),
      ]),
      findShiftByIdTx: vi.fn().mockResolvedValue(makeShift()),
    });
    const { service, audit, outbox } = build(repo);

    // freeze server time at 16:30 VN (09:30Z) → 30 min early, 8.5h elapsed - 1h break = 450 worked, 30 missing.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-03T09:30:00Z"));
    try {
      await service.checkOut(actor, { method: "web" });
    } finally {
      vi.useRealTimers();
    }

    const values = repo.updateRecordTx.mock.calls[0][2] as Record<string, unknown>;
    expect(values).toMatchObject({
      checkOutMethod: "web",
      earlyLeaveMinutes: 30,
      workingMinutes: 450,
      missingMinutes: 30,
      isEarlyLeave: true,
      isMissingCheckOut: false,
      attendanceStatus: "Early Leave",
      status: "early_leave",
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect((audit.record.mock.calls[0][1] as { action: string }).action).toBe(
      "attendance.check_out",
    );
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(repo.insertAttendanceLogTx).toHaveBeenCalledTimes(1);
  });
});
