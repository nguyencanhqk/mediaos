/**
 * S3-ATT-BE-4 — DENY-PATH RED suite for AttendanceAdjustmentService (FULL gate). Pure unit tests —
 * repo/db/permission/dataScope/hrTasks/audit/outbox all mocked (no Postgres). Proves the guards BEFORE
 * the happy path is trusted on the real HTTP path (int-spec):
 *   - create-thay without a wider-than-Own create scope → 403
 *   - approve on a non-Pending request (double-approve / terminal) → 409
 *   - approve of a request that does not exist (or cross-tenant → repo returns none) → 404
 *   - approve out-of-(decision)-scope (manager ≠ team) → 403
 *   - period-locked create/approve → 409
 */

import { describe, expect, it, vi } from "vitest";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AttendanceAdjustmentService } from "./attendance-adjustment.service";

const COMPANY = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR = "11111111-1111-1111-1111-111111111111";
const OWN_EMP = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const OTHER_EMP = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const REQ = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const actor = { id: ACTOR, companyId: COMPANY };

function empScope(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    userId: id === OWN_EMP ? ACTOR : "99999999-9999-9999-9999-999999999999",
    companyId: COMPANY,
    orgUnitId: null,
    directManagerUserId: null,
    status: "active",
    ...over,
  };
}

function makeRepo(over: Record<string, unknown> = {}) {
  return {
    insertRequestTx: vi.fn().mockResolvedValue([{ id: REQ }]),
    updateRequestTx: vi.fn().mockResolvedValue([{ id: REQ }]),
    findRequestByIdForUpdateTx: vi.fn().mockResolvedValue([
      {
        id: REQ,
        status: "Pending",
        userId: ACTOR,
        employeeId: OWN_EMP,
        workDate: "2024-06-03",
        taskId: null,
      },
    ]),
    findDetailByIdTx: vi.fn().mockResolvedValue([{ id: REQ, userId: ACTOR }]),
    listTx: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    findEmployeeScopeByIdTx: vi.fn().mockResolvedValue(empScope(OTHER_EMP)),
    findEmployeeScopeByUserIdTx: vi.fn().mockResolvedValue(empScope(OWN_EMP)),
    insertItemsTx: vi.fn().mockResolvedValue([]),
    findItemsByRequestTx: vi.fn().mockResolvedValue([]),
    ...over,
  };
}

function makeAttendanceRepo(over: Record<string, unknown> = {}) {
  return {
    isPeriodLockedTx: vi.fn().mockResolvedValue(false),
    findRecordByUserDateTx: vi.fn().mockResolvedValue([]),
    findRecordByIdForUpdateTx: vi.fn().mockResolvedValue([]),
    insertRecordTx: vi.fn().mockResolvedValue([{ id: "rec-1" }]),
    updateRecordTx: vi.fn().mockResolvedValue([{ id: "rec-1" }]),
    insertAttendanceLogTx: vi.fn().mockResolvedValue([{ id: "log-1" }]),
    ...over,
  };
}

function makeDataScope(over: Record<string, unknown> = {}) {
  return {
    resolveAndAssert: vi.fn().mockResolvedValue("Company"),
    resolveContext: vi.fn().mockResolvedValue({ userId: ACTOR, companyId: COMPANY }),
    buildEmployeeScopeCondition: vi.fn().mockReturnValue({}),
    isEmployeeInScope: vi.fn().mockReturnValue(true),
    ...over,
  };
}

function build(
  opts: {
    repo?: Record<string, unknown>;
    attendanceRepo?: Record<string, unknown>;
    dataScope?: Record<string, unknown>;
    strongestScope?: string | null;
  } = {},
) {
  const repo = makeRepo(opts.repo);
  const attendanceRepo = makeAttendanceRepo(opts.attendanceRepo);
  const dataScope = makeDataScope(opts.dataScope);
  const permission = {
    resolveStrongestScope: vi.fn().mockResolvedValue(opts.strongestScope ?? "Company"),
  };
  const hrTasks = {
    createApprovalTaskTx: vi.fn().mockResolvedValue({ id: "task-1" }),
    closeTaskTx: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const outbox = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const db = {
    withTenant: vi
      .fn()
      .mockImplementation((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
  const service = new AttendanceAdjustmentService(
    db as never,
    repo as never,
    attendanceRepo as never,
    permission as never,
    dataScope as never,
    hrTasks as never,
    audit as never,
    outbox as never,
  );
  return { service, repo, attendanceRepo, dataScope, permission, hrTasks, audit, outbox };
}

const CREATE_DTO = {
  workDate: "2024-06-03",
  requestType: "OTHER" as const,
  reason: "Quên chấm công",
};

describe("AttendanceAdjustmentService — create deny-paths", () => {
  it("blocks create-thay when the actor has only Own create scope → 403", async () => {
    const { service } = build({ strongestScope: "Own" });
    await expect(
      service.createRequest(actor, { ...CREATE_DTO, targetEmployeeId: OTHER_EMP }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("blocks create-thay when the target is out of the create scope → 403", async () => {
    const { service } = build({
      strongestScope: "Team",
      dataScope: { isEmployeeInScope: vi.fn().mockReturnValue(false) },
    });
    await expect(
      service.createRequest(actor, { ...CREATE_DTO, targetEmployeeId: OTHER_EMP }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("blocks create for a locked period → 409", async () => {
    const { service } = build({
      attendanceRepo: { isPeriodLockedTx: vi.fn().mockResolvedValue(true) },
    });
    await expect(service.createRequest(actor, CREATE_DTO)).rejects.toThrow(ConflictException);
  });

  it("maps a unique-pending violation to 409", async () => {
    const { service } = build({
      repo: { insertRequestTx: vi.fn().mockRejectedValue({ code: "23505" }) },
    });
    await expect(service.createRequest(actor, CREATE_DTO)).rejects.toThrow(ConflictException);
  });
});

describe("AttendanceAdjustmentService — approve deny-paths", () => {
  it("blocks approving a non-existent (or cross-tenant) request → 404", async () => {
    const { service } = build({
      repo: { findRequestByIdForUpdateTx: vi.fn().mockResolvedValue([]) },
    });
    await expect(service.approve(actor, REQ, {})).rejects.toThrow(NotFoundException);
  });

  it("blocks double-approve of a terminal (Approved) request → 409", async () => {
    const { service } = build({
      repo: {
        findRequestByIdForUpdateTx: vi.fn().mockResolvedValue([
          {
            id: REQ,
            status: "Approved",
            userId: ACTOR,
            employeeId: OWN_EMP,
            workDate: "2024-06-03",
          },
        ]),
      },
    });
    await expect(service.approve(actor, REQ, {})).rejects.toThrow(ConflictException);
  });

  it("blocks approving a request whose employee is out of the decision scope → 403", async () => {
    const { service } = build({
      dataScope: {
        resolveAndAssert: vi.fn().mockResolvedValue("Team"),
        isEmployeeInScope: vi.fn().mockReturnValue(false),
      },
    });
    await expect(service.approve(actor, REQ, {})).rejects.toThrow(ForbiddenException);
  });

  it("blocks approving into a locked period → 409", async () => {
    const { service } = build({
      attendanceRepo: { isPeriodLockedTx: vi.fn().mockResolvedValue(true) },
    });
    await expect(service.approve(actor, REQ, {})).rejects.toThrow(ConflictException);
  });
});

describe("AttendanceAdjustmentService — self-approval hard-rule (SPEC-04 §15.10 quy tắc 6)", () => {
  // A Pending request whose creator IS the acting approver (requested_by === actor.id).
  const selfPending = [
    {
      id: REQ,
      status: "Pending",
      userId: ACTOR,
      requestedBy: ACTOR,
      employeeId: OWN_EMP,
      workDate: "2024-06-03",
      taskId: null,
    },
  ];

  it("blocks the requester APPROVING their own request → 403 ATT-ERR-SELF-APPROVAL (even with covering scope)", async () => {
    // dataScope is permissive (Company + isEmployeeInScope true) → proves data-scope can NOT substitute.
    const { service, dataScope } = build({
      repo: { findRequestByIdForUpdateTx: vi.fn().mockResolvedValue(selfPending) },
    });
    await expect(service.approve(actor, REQ, {})).rejects.toThrow(ForbiddenException);
    await expect(service.approve(actor, REQ, {})).rejects.toThrow(/ATT-ERR-SELF-APPROVAL/);
    // Hard-rule fires BEFORE assertScope → the decision-scope resolver must not even be consulted.
    expect(dataScope.resolveAndAssert).not.toHaveBeenCalled();
  });

  it("blocks the requester REJECTING their own request → 403 ATT-ERR-SELF-APPROVAL", async () => {
    const { service, dataScope } = build({
      repo: { findRequestByIdForUpdateTx: vi.fn().mockResolvedValue(selfPending) },
    });
    await expect(service.reject(actor, REQ, { reason: "x" })).rejects.toThrow(
      /ATT-ERR-SELF-APPROVAL/,
    );
    expect(dataScope.resolveAndAssert).not.toHaveBeenCalled();
  });

  it("terminal-state guard STILL precedes the self-rule (self-request already Approved → 409, not 403)", async () => {
    const { service } = build({
      repo: {
        findRequestByIdForUpdateTx: vi
          .fn()
          .mockResolvedValue([{ ...selfPending[0], status: "Approved" }]),
      },
    });
    await expect(service.approve(actor, REQ, {})).rejects.toThrow(ConflictException);
  });

  it("a DIFFERENT approver (requested_by ≠ actor) is NOT blocked by the self-rule (falls through to scope)", async () => {
    // requestedBy is a different user → self-rule passes; scope denies → 403 from assertScope instead.
    const { service, dataScope } = build({
      repo: {
        findRequestByIdForUpdateTx: vi
          .fn()
          .mockResolvedValue([
            { ...selfPending[0], requestedBy: "77777777-7777-7777-7777-777777777777" },
          ]),
      },
      dataScope: {
        resolveAndAssert: vi.fn().mockResolvedValue("Team"),
        isEmployeeInScope: vi.fn().mockReturnValue(false),
      },
    });
    await expect(service.approve(actor, REQ, {})).rejects.toThrow(ForbiddenException);
    // Proof it reached the scope check (not short-circuited by the self-rule).
    expect(dataScope.resolveAndAssert).toHaveBeenCalled();
  });
});

describe("AttendanceAdjustmentService — reject + direct deny-paths", () => {
  it("blocks rejecting a terminal request → 409", async () => {
    const { service } = build({
      repo: {
        findRequestByIdForUpdateTx: vi.fn().mockResolvedValue([
          {
            id: REQ,
            status: "Rejected",
            userId: ACTOR,
            employeeId: OWN_EMP,
            workDate: "2024-06-03",
          },
        ]),
      },
    });
    await expect(service.reject(actor, REQ, { reason: "no" })).rejects.toThrow(ConflictException);
  });

  it("blocks adjust-direct on a non-existent record → 404", async () => {
    const { service } = build({
      attendanceRepo: { findRecordByIdForUpdateTx: vi.fn().mockResolvedValue([]) },
    });
    await expect(
      service.adjustDirect(actor, "rec-x", {
        recordId: "rec-x",
        items: [{ fieldName: "note", newValue: "x" }],
        reason: "fix",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("blocks adjust-direct into a locked period → 409 (checked BEFORE the adjust-direct scope gate)", async () => {
    const { service, dataScope } = build({
      attendanceRepo: {
        findRecordByIdForUpdateTx: vi
          .fn()
          .mockResolvedValue([
            { id: "rec-1", userId: ACTOR, employeeId: OWN_EMP, workDate: "2024-06-03" },
          ]),
        isPeriodLockedTx: vi.fn().mockResolvedValue(true),
      },
    });
    await expect(
      service.adjustDirect(actor, "rec-1", {
        recordId: "rec-1",
        items: [{ fieldName: "note", newValue: "x" }],
        reason: "fix",
      }),
    ).rejects.toThrow(ConflictException);
    // The lock guard short-circuits before the scope check is even consulted.
    expect(dataScope.resolveAndAssert).not.toHaveBeenCalled();
  });
});
