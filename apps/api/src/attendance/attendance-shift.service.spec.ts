/**
 * S3-ATT-BE-3 — pure unit suite for AttendanceShiftService (repo/AttendanceService all mocked, no
 * Postgres). Real HTTP + real DB (guard 403, cross-tenant list) is proven in
 * attendance-shift.int.spec.ts; here we pin the SERVICE control-flow: not-found → 404, duplicate
 * business-key → 409 (not 500), and that getEffectiveShiftRule DELEGATES to
 * AttendanceService.resolveShiftAndRule (the shared S3-ATT-BE-1 resolve-effective implementation)
 * rather than re-deriving the priority order itself.
 *
 * S3-ATT-BE-3-FIX-AUDIT-WIRE: also pins the AuditService.record() WIRING at the 5 config-mutation
 * sites — correct object_type/action, written on the SAME tx as the mutation, before/after carrying
 * ONLY config fields (NO secret/PII — BẤT BIẾN #3), and NO audit when a mutation is short-circuited
 * (404). The DB CHECK for the new object_type values (mig 0457) is proven in att-core-tenant-deny.int-spec.ts.
 */

import { describe, expect, it, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { AttendanceShiftService } from "./attendance-shift.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const EMP_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const actor = { id: ACTOR_ID, companyId: COMPANY_ID };

function makeShiftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ssssssss-ssss-ssss-ssss-ssssssssssss",
    shiftCode: "OFFICE_8H",
    name: "Ca hanh chinh",
    description: null,
    shiftType: "Fixed",
    startTime: "08:00:00",
    endTime: "17:00:00",
    breakStartTime: null,
    breakEndTime: null,
    breakMinutes: 60,
    requiredWorkingMinutes: 480,
    flexibleCheckInFrom: null,
    flexibleCheckInTo: null,
    graceLateMinutes: 5,
    graceEarlyLeaveMinutes: 5,
    allowEarlyCheckIn: true,
    allowLateCheckOut: true,
    crossDay: false,
    workDays: [1, 2, 3, 4, 5],
    status: "Active",
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRuleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr",
    ruleCode: "OFFICE_RULE",
    name: "Rule",
    description: null,
    ruleScope: "Company",
    departmentId: null,
    employeeId: null,
    priority: 0,
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    requireCheckIn: true,
    requireCheckOut: true,
    allowWebCheckIn: true,
    allowMobileCheckIn: true,
    allowRemoteCheckIn: false,
    allowAdjustmentRequest: true,
    requireGps: false,
    requireNote: false,
    requirePhoto: false,
    allowHolidayAttendance: false,
    allowWeekendAttendance: false,
    autoAttendanceEnabled: false,
    autoCheckOutEnabled: false,
    autoAttendanceWorkingMinutes: null,
    status: "Active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Stable tx sentinel so audit-wiring tests can assert audit.record was called on the SAME tx. */
const TX_SENTINEL = { __txSentinel: true } as const;

function makeDb() {
  return {
    withTenant: vi
      .fn()
      .mockImplementation((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(TX_SENTINEL)),
  };
}

function build(
  overrides: {
    repo?: Record<string, unknown>;
    shiftRepo?: Record<string, unknown>;
    attendanceService?: Record<string, unknown>;
  } = {},
) {
  const db = makeDb();
  const repo = {
    resolveEmployeeByUserIdTx: vi.fn().mockResolvedValue({ id: EMP_ID, orgUnitId: null }),
    resolveEmployeeByIdTx: vi.fn().mockResolvedValue(null),
    ...overrides.repo,
  };
  const shiftRepo = {
    findShiftByIdTx: vi.fn().mockResolvedValue([makeShiftRow()]),
    updateShiftTx: vi.fn().mockResolvedValue([makeShiftRow({ name: "renamed" })]),
    insertShiftTx: vi.fn().mockResolvedValue([makeShiftRow()]),
    findRuleByIdTx: vi.fn().mockResolvedValue([makeRuleRow()]),
    updateRuleTx: vi.fn().mockResolvedValue([makeRuleRow({ name: "renamed" })]),
    insertRuleTx: vi.fn().mockResolvedValue([makeRuleRow()]),
    insertShiftAssignmentTx: vi.fn().mockResolvedValue([
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        shiftId: makeShiftRow().id,
        assignmentScope: "Company",
        departmentId: null,
        employeeId: null,
        effectiveFrom: "2024-01-01",
        effectiveTo: null,
        priority: 0,
        status: "Active",
        note: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
    ...overrides.shiftRepo,
  };
  const attendanceService = {
    resolveShiftAndRule: vi.fn().mockResolvedValue({
      shift: makeShiftRow(),
      rule: {
        id: makeRuleRow().id,
        ruleCode: makeRuleRow().ruleCode,
        requireCheckIn: true,
        requireCheckOut: true,
        blockWhenLeaveApproved: true,
      },
      tz: "Asia/Ho_Chi_Minh",
      workDate: "2024-06-03",
    }),
    ...overrides.attendanceService,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new AttendanceShiftService(
    db as never,
    repo as never,
    shiftRepo as never,
    attendanceService as never,
    audit as never,
  );
  return { service, repo, shiftRepo, attendanceService, audit };
}

// ─── shift CRUD ────────────────────────────────────────────────────────────────

describe("AttendanceShiftService — shift CRUD", () => {
  it("updateShift on unknown id → NotFoundException (no write attempted)", async () => {
    const { service, shiftRepo } = build({
      shiftRepo: { findShiftByIdTx: vi.fn().mockResolvedValue([]) },
    });
    await expect(service.updateShift(actor, "missing-id", { name: "x" })).rejects.toThrow(
      NotFoundException,
    );
    expect(shiftRepo.updateShiftTx).not.toHaveBeenCalled();
  });

  it("createShift duplicate shiftCode (23505) → ConflictException, not 500", async () => {
    const dupErr = Object.assign(new Error("duplicate"), { code: "23505" });
    const { service } = build({
      shiftRepo: { insertShiftTx: vi.fn().mockRejectedValue(dupErr) },
    });
    await expect(
      service.createShift(actor, {
        shiftCode: "OFFICE_8H",
        name: "x",
        shiftType: "Fixed",
        requiredWorkingMinutes: 480,
        breakMinutes: 0,
        graceLateMinutes: 0,
        graceEarlyLeaveMinutes: 0,
        allowEarlyCheckIn: true,
        allowLateCheckOut: true,
        crossDay: false,
        isDefault: false,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("createShift → returns the mapped ShiftDto", async () => {
    const { service } = build();
    const dto = await service.createShift(actor, {
      shiftCode: "OFFICE_8H",
      name: "x",
      shiftType: "Fixed",
      requiredWorkingMinutes: 480,
      breakMinutes: 0,
      graceLateMinutes: 0,
      graceEarlyLeaveMinutes: 0,
      allowEarlyCheckIn: true,
      allowLateCheckOut: true,
      crossDay: false,
      isDefault: false,
    });
    expect(dto.shiftCode).toBe("OFFICE_8H");
  });

  it("updateShift → returns the updated ShiftDto", async () => {
    const { service } = build();
    const dto = await service.updateShift(actor, makeShiftRow().id, { name: "renamed" });
    expect(dto.name).toBe("renamed");
  });
});

// ─── rule CRUD ─────────────────────────────────────────────────────────────────

describe("AttendanceShiftService — attendance_rule CRUD", () => {
  it("updateRule on unknown id → NotFoundException", async () => {
    const { service } = build({ shiftRepo: { findRuleByIdTx: vi.fn().mockResolvedValue([]) } });
    await expect(service.updateRule(actor, "missing-id", { name: "x" })).rejects.toThrow(
      NotFoundException,
    );
  });

  it("createRule → returns the mapped AttendanceRuleDto", async () => {
    const { service } = build();
    const dto = await service.createRule(actor, {
      ruleCode: "OFFICE_RULE",
      name: "x",
      ruleScope: "Company",
      priority: 0,
      effectiveFrom: "2024-01-01",
      requireCheckIn: true,
      requireCheckOut: true,
      allowWebCheckIn: true,
      allowMobileCheckIn: true,
      allowRemoteCheckIn: false,
      allowAdjustmentRequest: true,
      requireGps: false,
      requireNote: false,
      requirePhoto: false,
      allowHolidayAttendance: false,
      allowWeekendAttendance: false,
      autoAttendanceEnabled: false,
      autoCheckOutEnabled: false,
    });
    expect(dto.ruleCode).toBe("OFFICE_RULE");
  });
});

// ─── shift_assignment create ───────────────────────────────────────────────────

describe("AttendanceShiftService — shift_assignment create", () => {
  it("createShiftAssignment → returns the mapped ShiftAssignmentDto", async () => {
    const { service } = build();
    const dto = await service.createShiftAssignment(actor, {
      shiftId: makeShiftRow().id,
      assignmentScope: "Company",
      priority: 0,
      effectiveFrom: "2024-01-01",
    });
    expect(dto.shiftId).toBe(makeShiftRow().id);
  });
});

// ─── getEffectiveShiftRule — reuse of AttendanceService.resolveShiftAndRule (S3-ATT-BE-1) ────────

describe("AttendanceShiftService — getEffectiveShiftRule (shared resolve-effective)", () => {
  it("no employeeId → resolves the CALLER's own employee, delegates to AttendanceService.resolveShiftAndRule", async () => {
    const { service, repo, attendanceService } = build();
    const dto = await service.getEffectiveShiftRule(actor, {});
    expect(repo.resolveEmployeeByUserIdTx).toHaveBeenCalledWith(
      COMPANY_ID,
      ACTOR_ID,
      expect.anything(),
    );
    expect(attendanceService.resolveShiftAndRule).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      { id: EMP_ID, orgUnitId: null },
      expect.any(Date),
      undefined,
    );
    expect(dto.shift?.shiftCode).toBe("OFFICE_8H");
    expect(dto.rule?.ruleCode).toBe("OFFICE_RULE");
    expect(dto.employeeId).toBe(EMP_ID);
  });

  it("with employeeId → resolves that employee (server-side), forwards explicit workDate", async () => {
    const otherEmp = { id: "other-emp-id", orgUnitId: "dept-1" };
    const { service, repo, attendanceService } = build({
      repo: { resolveEmployeeByIdTx: vi.fn().mockResolvedValue(otherEmp) },
    });
    await service.getEffectiveShiftRule(actor, {
      employeeId: "other-emp-id",
      workDate: "2024-07-01",
    });
    expect(repo.resolveEmployeeByIdTx).toHaveBeenCalledWith(
      COMPANY_ID,
      "other-emp-id",
      expect.anything(),
    );
    expect(attendanceService.resolveShiftAndRule).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      otherEmp,
      expect.any(Date),
      "2024-07-01",
    );
  });

  it("unknown employeeId → NotFoundException (no cross-tenant existence leak)", async () => {
    const { service } = build({ repo: { resolveEmployeeByIdTx: vi.fn().mockResolvedValue(null) } });
    await expect(
      service.getEffectiveShiftRule(actor, { employeeId: "unknown-id" }),
    ).rejects.toThrow(NotFoundException);
  });
});

// ─── audit-in-tx wiring (S3-ATT-BE-3-FIX-AUDIT-WIRE) ─────────────────────────────

describe("AttendanceShiftService — audit-in-tx wiring", () => {
  // Keys that must NEVER surface in an audit snapshot (secret/PII sentinels — BẤT BIẾN #3).
  const FORBIDDEN_SNAPSHOT_KEYS = [
    "password",
    "passwordHash",
    "token",
    "secret",
    "secretRef",
    "identityNumber",
    "bankAccount",
    "salary",
    "createdAt",
    "updatedAt",
  ];

  function assertConfigOnly(...snapshots: unknown[]) {
    for (const snap of snapshots) {
      if (!snap || typeof snap !== "object") continue;
      for (const k of Object.keys(snap)) {
        expect(FORBIDDEN_SNAPSHOT_KEYS).not.toContain(k);
      }
    }
  }

  function entryOf(audit: { record: ReturnType<typeof vi.fn> }) {
    expect(audit.record).toHaveBeenCalledTimes(1);
    const [tx, entry] = audit.record.mock.calls[0];
    expect(tx).toBe(TX_SENTINEL); // audit written on the SAME withTenant tx as the mutation
    return entry as Record<string, unknown>;
  }

  it("createShift → ShiftCreated / object_type=shift, config-only after", async () => {
    const { service, audit } = build();
    await service.createShift(actor, {
      shiftCode: "OFFICE_8H",
      name: "x",
      shiftType: "Fixed",
      requiredWorkingMinutes: 480,
      breakMinutes: 0,
      graceLateMinutes: 0,
      graceEarlyLeaveMinutes: 0,
      allowEarlyCheckIn: true,
      allowLateCheckOut: true,
      crossDay: false,
      isDefault: false,
    });
    const e = entryOf(audit);
    expect(e.objectType).toBe("shift");
    expect(e.action).toBe("ShiftCreated");
    expect(e.actorUserId).toBe(ACTOR_ID);
    expect((e.after as Record<string, unknown>).shiftCode).toBe("OFFICE_8H");
    assertConfigOnly(e.after, e.newValues);
  });

  it("updateShift → ShiftUpdated with before+after config snapshots", async () => {
    const { service, audit } = build({
      shiftRepo: {
        findShiftByIdTx: vi.fn().mockResolvedValue([makeShiftRow({ name: "old" })]),
        updateShiftTx: vi.fn().mockResolvedValue([makeShiftRow({ name: "new" })]),
      },
    });
    await service.updateShift(actor, makeShiftRow().id, { name: "new" });
    const e = entryOf(audit);
    expect(e.objectType).toBe("shift");
    expect(e.action).toBe("ShiftUpdated");
    expect((e.before as Record<string, unknown>).name).toBe("old");
    expect((e.after as Record<string, unknown>).name).toBe("new");
    assertConfigOnly(e.before, e.after, e.oldValues, e.newValues);
  });

  it("createRule → RuleCreated / object_type=attendance_rule", async () => {
    const { service, audit } = build();
    await service.createRule(actor, {
      ruleCode: "OFFICE_RULE",
      name: "x",
      ruleScope: "Company",
      priority: 0,
      effectiveFrom: "2024-01-01",
      requireCheckIn: true,
      requireCheckOut: true,
      allowWebCheckIn: true,
      allowMobileCheckIn: true,
      allowRemoteCheckIn: false,
      allowAdjustmentRequest: true,
      requireGps: false,
      requireNote: false,
      requirePhoto: false,
      allowHolidayAttendance: false,
      allowWeekendAttendance: false,
      autoAttendanceEnabled: false,
      autoCheckOutEnabled: false,
    });
    const e = entryOf(audit);
    expect(e.objectType).toBe("attendance_rule");
    expect(e.action).toBe("RuleCreated");
    assertConfigOnly(e.after, e.newValues);
  });

  it("updateRule → RuleUpdated with before+after", async () => {
    const { service, audit } = build({
      shiftRepo: {
        findRuleByIdTx: vi.fn().mockResolvedValue([makeRuleRow({ name: "old" })]),
        updateRuleTx: vi.fn().mockResolvedValue([makeRuleRow({ name: "new" })]),
      },
    });
    await service.updateRule(actor, makeRuleRow().id, { name: "new" });
    const e = entryOf(audit);
    expect(e.objectType).toBe("attendance_rule");
    expect(e.action).toBe("RuleUpdated");
    expect((e.before as Record<string, unknown>).name).toBe("old");
    expect((e.after as Record<string, unknown>).name).toBe("new");
    assertConfigOnly(e.before, e.after, e.oldValues, e.newValues);
  });

  it("createShiftAssignment → ShiftAssignmentCreated / object_type=shift_assignment", async () => {
    const { service, audit } = build();
    await service.createShiftAssignment(actor, {
      shiftId: makeShiftRow().id,
      assignmentScope: "Company",
      priority: 0,
      effectiveFrom: "2024-01-01",
    });
    const e = entryOf(audit);
    expect(e.objectType).toBe("shift_assignment");
    expect(e.action).toBe("ShiftAssignmentCreated");
    assertConfigOnly(e.after, e.newValues);
  });

  it("updateShift on unknown id → NO audit written (fail-closed, no false trail)", async () => {
    const { service, audit } = build({
      shiftRepo: { findShiftByIdTx: vi.fn().mockResolvedValue([]) },
    });
    await expect(service.updateShift(actor, "missing", { name: "x" })).rejects.toThrow(
      NotFoundException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });
});
