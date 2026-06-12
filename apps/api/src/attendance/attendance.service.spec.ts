/**
 * G11-1 — Deny-path RED suite for AttendanceService (FULL gate — CLAUDE.md §6).
 *
 * Covers every guard before the happy path is trusted:
 *   - period lock blocks check-in / check-out / adjust / approve-adjust
 *   - no double check-in; no check-out before check-in; no double check-out
 *   - adjustment lifecycle: approve/reject only when pending; cancel only by owner & only when pending
 *   - period lock is idempotent-safe (re-lock → 409)
 *   - scope: viewing others / scope=all requires manage|approve permission
 *
 * Pure unit tests — repo/db/permission/audit/outbox/hrTasks all mocked (no Postgres).
 */

import { describe, expect, it, vi } from "vitest";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { AttendanceService } from "./attendance.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";
const REQ_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const actor = { id: ACTOR_ID, companyId: COMPANY_ID };

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr",
    userId: ACTOR_ID,
    workDate: "2024-06-03",
    workScheduleId: null,
    checkInAt: null,
    checkOutAt: null,
    checkInMethod: null,
    checkOutMethod: null,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    status: "missing_checkin",
    note: null,
    ...overrides,
  };
}

function makeAdjustment(overrides: Record<string, unknown> = {}) {
  return {
    id: REQ_ID,
    userId: ACTOR_ID,
    attendanceRecordId: null,
    workDate: "2024-06-03",
    requestedCheckInAt: new Date("2024-06-03T02:00:00Z"),
    requestedCheckOutAt: new Date("2024-06-03T11:00:00Z"),
    reason: "Quên chấm công",
    status: "pending",
    taskId: "tttttttt-tttt-tttt-tttt-tttttttttttt",
    approvedBy: null,
    approvedAt: null,
    reviewNote: null,
    createdAt: new Date("2024-06-03T12:00:00Z"),
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    resolveScheduleForUserTx: vi.fn().mockResolvedValue(null),
    findScheduleByIdTx: vi.fn().mockResolvedValue([null]),
    findSchedules: vi.fn().mockResolvedValue([]),
    createScheduleTx: vi.fn().mockResolvedValue([{ id: "sched", name: "Ca", isDefault: false, timezone: "Asia/Ho_Chi_Minh" }]),
    updateScheduleTx: vi.fn().mockResolvedValue([{ id: "sched" }]),
    isPeriodLockedTx: vi.fn().mockResolvedValue(false),
    findRecordByUserDateTx: vi.fn().mockResolvedValue([]),
    findRecordsByMonth: vi.fn().mockResolvedValue([]),
    insertRecordTx: vi.fn().mockResolvedValue([makeRecord({ checkInAt: new Date(), status: "present" })]),
    updateRecordTx: vi.fn().mockResolvedValue([makeRecord({ checkOutAt: new Date(), status: "present" })]),
    findAdjustmentByIdTx: vi.fn().mockResolvedValue([makeAdjustment()]),
    findAdjustments: vi.fn().mockResolvedValue([]),
    insertAdjustmentTx: vi.fn().mockResolvedValue([makeAdjustment()]),
    updateAdjustmentTx: vi.fn().mockResolvedValue([makeAdjustment({ status: "approved" })]),
    findPeriods: vi.fn().mockResolvedValue([]),
    findPeriodTx: vi.fn().mockResolvedValue([]),
    lockPeriodTx: vi.fn().mockResolvedValue([{ id: "p", periodMonth: "2024-06", status: "locked", lockedBy: ACTOR_ID, lockedAt: new Date() }]),
    ...overrides,
  };
}

function makeDb(repo: ReturnType<typeof makeRepo>) {
  return {
    withTenant: vi.fn().mockImplementation((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(repo)),
  };
}

const makePermission = (allow: boolean) => ({
  can: vi.fn().mockResolvedValue({ allow, reason: allow ? "allow" : "deny-default", auditRequired: false }),
});
const makeHrTasks = () => ({
  createApprovalTaskTx: vi.fn().mockResolvedValue({ id: "task-1" }),
  closeTaskTx: vi.fn().mockResolvedValue(undefined),
  cancelTaskTx: vi.fn().mockResolvedValue(undefined),
});
const makeAudit = () => ({ record: vi.fn().mockResolvedValue(undefined) });
const makeOutbox = () => ({ enqueue: vi.fn().mockResolvedValue(undefined) });

function build(repo: ReturnType<typeof makeRepo>, permissionAllow = true) {
  const audit = makeAudit();
  const outbox = makeOutbox();
  const hrTasks = makeHrTasks();
  const service = new AttendanceService(
    makeDb(repo) as never,
    repo as never,
    makePermission(permissionAllow) as never,
    hrTasks as never,
    audit as never,
    outbox as never,
  );
  return { service, audit, outbox, hrTasks };
}

describe("AttendanceService — check-in/out guards", () => {
  it("blocks check-in when the period is locked", async () => {
    const repo = makeRepo({ isPeriodLockedTx: vi.fn().mockResolvedValue(true) });
    const { service } = build(repo);
    await expect(service.checkIn(actor, { method: "web" })).rejects.toThrow(ConflictException);
  });

  it("blocks a second check-in on the same day", async () => {
    const repo = makeRepo({
      findRecordByUserDateTx: vi.fn().mockResolvedValue([makeRecord({ checkInAt: new Date() })]),
    });
    const { service } = build(repo);
    await expect(service.checkIn(actor, { method: "web" })).rejects.toThrow(ConflictException);
  });

  it("allows the happy-path check-in and writes audit + outbox", async () => {
    const repo = makeRepo();
    const { service, audit, outbox } = build(repo);
    const out = await service.checkIn(actor, { method: "web" });
    expect(out).toMatchObject({ status: "present" });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it("blocks check-out when there was no check-in", async () => {
    const repo = makeRepo({ findRecordByUserDateTx: vi.fn().mockResolvedValue([]) });
    const { service } = build(repo);
    await expect(service.checkOut(actor, { method: "web" })).rejects.toThrow(ConflictException);
  });

  it("blocks a second check-out on the same day", async () => {
    const repo = makeRepo({
      findRecordByUserDateTx: vi
        .fn()
        .mockResolvedValue([makeRecord({ checkInAt: new Date(), checkOutAt: new Date() })]),
    });
    const { service } = build(repo);
    await expect(service.checkOut(actor, { method: "web" })).rejects.toThrow(ConflictException);
  });

  it("blocks check-out when the period is locked", async () => {
    const repo = makeRepo({
      isPeriodLockedTx: vi.fn().mockResolvedValue(true),
      findRecordByUserDateTx: vi.fn().mockResolvedValue([makeRecord({ checkInAt: new Date() })]),
    });
    const { service } = build(repo);
    await expect(service.checkOut(actor, { method: "web" })).rejects.toThrow(ConflictException);
  });
});

describe("AttendanceService — adjustment lifecycle", () => {
  it("blocks creating an adjustment for a locked period", async () => {
    const repo = makeRepo({ isPeriodLockedTx: vi.fn().mockResolvedValue(true) });
    const { service, hrTasks } = build(repo);
    await expect(
      service.createAdjustment(actor, { workDate: "2024-06-03", requestedCheckInAt: "2024-06-03T02:00:00Z", reason: "x" }),
    ).rejects.toThrow(ConflictException);
    expect(hrTasks.createApprovalTaskTx).not.toHaveBeenCalled();
  });

  it("blocks approving an adjustment that is not pending", async () => {
    const repo = makeRepo({
      findAdjustmentByIdTx: vi.fn().mockResolvedValue([makeAdjustment({ status: "approved" })]),
    });
    const { service } = build(repo);
    await expect(service.approveAdjustment(actor, REQ_ID)).rejects.toThrow(ConflictException);
  });

  it("blocks approving an adjustment when the period is locked", async () => {
    const repo = makeRepo({ isPeriodLockedTx: vi.fn().mockResolvedValue(true) });
    const { service } = build(repo);
    await expect(service.approveAdjustment(actor, REQ_ID)).rejects.toThrow(ConflictException);
  });

  it("blocks rejecting an adjustment that is not pending", async () => {
    const repo = makeRepo({
      findAdjustmentByIdTx: vi.fn().mockResolvedValue([makeAdjustment({ status: "cancelled" })]),
    });
    const { service } = build(repo);
    await expect(service.rejectAdjustment(actor, REQ_ID)).rejects.toThrow(ConflictException);
  });

  it("blocks cancelling someone else's adjustment", async () => {
    const repo = makeRepo({
      findAdjustmentByIdTx: vi.fn().mockResolvedValue([makeAdjustment({ userId: OTHER_ID })]),
    });
    const { service } = build(repo);
    await expect(service.cancelAdjustment(actor, REQ_ID)).rejects.toThrow(ForbiddenException);
  });

  it("blocks cancelling an adjustment that is not pending", async () => {
    const repo = makeRepo({
      findAdjustmentByIdTx: vi.fn().mockResolvedValue([makeAdjustment({ status: "approved" })]),
    });
    const { service } = build(repo);
    await expect(service.cancelAdjustment(actor, REQ_ID)).rejects.toThrow(ConflictException);
  });
});

describe("AttendanceService — period lock + scope", () => {
  it("blocks re-locking an already-locked period", async () => {
    const repo = makeRepo({ findPeriodTx: vi.fn().mockResolvedValue([{ status: "locked" }]) });
    const { service } = build(repo);
    await expect(service.lockPeriod(actor, "2024-06")).rejects.toThrow(ConflictException);
  });

  it("blocks viewing another user's monthly attendance without manage permission", async () => {
    const repo = makeRepo();
    const { service } = build(repo, /* permissionAllow */ false);
    await expect(
      service.listMonthly(actor, { month: "2024-06", userId: OTHER_ID }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("blocks listing all adjustments (scope=all) without approve permission", async () => {
    const repo = makeRepo();
    const { service } = build(repo, false);
    await expect(service.listAdjustments(actor, { scope: "all" })).rejects.toThrow(ForbiddenException);
  });

  it("allows listing my own adjustments (scope=me) without elevated permission", async () => {
    const repo = makeRepo();
    const { service } = build(repo, false);
    await expect(service.listAdjustments(actor, { scope: "me" })).resolves.toEqual([]);
    expect(repo.findAdjustments).toHaveBeenCalledWith(COMPANY_ID, { userId: ACTOR_ID, status: undefined });
  });
});
