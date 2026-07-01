/**
 * S3-ATT-BE-3 — pure unit suite for AttendanceShiftService (repo/AttendanceService all mocked, no
 * Postgres). Real HTTP + real DB (guard 403, cross-tenant list) is proven in
 * attendance-shift.int.spec.ts; here we pin the SERVICE control-flow: not-found → 404, duplicate
 * business-key → 409 (not 500), and that getEffectiveShiftRule DELEGATES to
 * AttendanceService.resolveShiftAndRule (the shared S3-ATT-BE-1 resolve-effective implementation)
 * rather than re-deriving the priority order itself.
 *
 * NO audit assertions here — see attendance-shift.service.ts class doc: audit_logs object_type CHECK
 * doesn't yet allow 'shift'/'attendance_rule'/'shift_assignment' (carry-over for lane db-migration).
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

function makeDb() {
  return {
    withTenant: vi
      .fn()
      .mockImplementation((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
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
  const service = new AttendanceShiftService(
    db as never,
    repo as never,
    shiftRepo as never,
    attendanceService as never,
  );
  return { service, repo, shiftRepo, attendanceService };
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
