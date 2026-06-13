/**
 * G11-2 — Deny-path + behaviour suite for LeaveService.
 *
 * Pins the rules that keep leave honest before the happy path is trusted:
 *   - request day-count excludes weekends (via the schedule's working days)
 *   - approve deducts quota race-safely; insufficient balance ⇒ 409 and the request stays pending
 *   - approve/reject only when pending; cancel only by owner & only when pending
 *   - request created on an inactive / unknown leave type ⇒ rejected
 *   - approve/reject closes the Task Hub task; cancel soft-deletes it
 *   - scope=all listing requires approve:leave; viewing another user's balance requires manage:leave
 *
 * Pure unit tests — repo/db/permission/audit/outbox/hrTasks all mocked (no Postgres).
 */

import { describe, expect, it, vi } from "vitest";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { LeaveService } from "./leave.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";
const REQ_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const TYPE_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const TASK_ID = "tttttttt-tttt-tttt-tttt-tttttttttttt";
const actor = { id: ACTOR_ID, companyId: COMPANY_ID };

function makeType(overrides: Record<string, unknown> = {}) {
  return { id: TYPE_ID, name: "Phép năm", code: "annual", paid: true, status: "active", ...overrides };
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: REQ_ID,
    userId: ACTOR_ID,
    leaveTypeId: TYPE_ID,
    startDate: "2024-06-03",
    endDate: "2024-06-07",
    totalDays: "5",
    reason: "Nghỉ",
    status: "pending",
    taskId: TASK_ID,
    approvedBy: null,
    approvedAt: null,
    reviewNote: null,
    createdAt: new Date("2024-06-01T00:00:00Z"),
    ...overrides,
  };
}

function makeBalance(overrides: Record<string, unknown> = {}) {
  return {
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    userId: ACTOR_ID,
    leaveTypeId: TYPE_ID,
    year: 2024,
    totalDays: "12",
    usedDays: "5",
    remainingDays: "7",
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    findTypes: vi.fn().mockResolvedValue([]),
    findTypeByIdTx: vi.fn().mockResolvedValue([makeType()]),
    createTypeTx: vi.fn().mockResolvedValue([makeType()]),
    updateTypeTx: vi.fn().mockResolvedValue([makeType()]),
    findBalances: vi.fn().mockResolvedValue([]),
    upsertBalanceTx: vi.fn().mockResolvedValue([makeBalance()]),
    incrementUsedIfEnoughTx: vi.fn().mockResolvedValue([makeBalance({ usedDays: "10" })]),
    resolveWorkingDaysForUserTx: vi.fn().mockResolvedValue([1, 2, 3, 4, 5]),
    findRequestByIdTx: vi.fn().mockResolvedValue([makeRequest()]),
    findRequestByIdForUpdateTx: vi.fn().mockResolvedValue([makeRequest()]),
    findRequests: vi.fn().mockResolvedValue([]),
    insertRequestTx: vi.fn().mockResolvedValue([makeRequest()]),
    updateRequestTx: vi.fn().mockResolvedValue([makeRequest({ status: "approved" })]),
    findCalendar: vi.fn().mockResolvedValue([]),
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
  createApprovalTaskTx: vi.fn().mockResolvedValue({ id: TASK_ID }),
  closeTaskTx: vi.fn().mockResolvedValue(undefined),
  cancelTaskTx: vi.fn().mockResolvedValue(undefined),
});
const makeAudit = () => ({ record: vi.fn().mockResolvedValue(undefined) });
const makeOutbox = () => ({ enqueue: vi.fn().mockResolvedValue(undefined) });

function build(repo: ReturnType<typeof makeRepo>, permissionAllow = true) {
  const audit = makeAudit();
  const outbox = makeOutbox();
  const hrTasks = makeHrTasks();
  const service = new LeaveService(
    makeDb(repo) as never,
    repo as never,
    makePermission(permissionAllow) as never,
    hrTasks as never,
    audit as never,
    outbox as never,
  );
  return { service, audit, outbox, hrTasks };
}

describe("LeaveService — create request", () => {
  it("counts only working days (Mon–Fri week = 5) and creates a Task Hub task", async () => {
    const repo = makeRepo();
    const { service, hrTasks, audit, outbox } = build(repo);
    const out = await service.createRequest(actor, {
      leaveTypeId: TYPE_ID,
      startDate: "2024-06-03",
      endDate: "2024-06-09", // Mon→Sun, weekend excluded ⇒ 5
    });
    expect(hrTasks.createApprovalTaskTx).toHaveBeenCalledTimes(1);
    expect(repo.insertRequestTx).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ totalDays: "5", status: "pending", taskId: TASK_ID }),
      repo,
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ status: "pending" }); // a freshly created request is pending until approved
  });

  it("rejects a request for an unknown leave type", async () => {
    const repo = makeRepo({ findTypeByIdTx: vi.fn().mockResolvedValue([]) });
    const { service, hrTasks } = build(repo);
    await expect(
      service.createRequest(actor, { leaveTypeId: TYPE_ID, startDate: "2024-06-03", endDate: "2024-06-07" }),
    ).rejects.toThrow(NotFoundException);
    expect(hrTasks.createApprovalTaskTx).not.toHaveBeenCalled();
  });

  it("rejects a request for an inactive leave type", async () => {
    const repo = makeRepo({ findTypeByIdTx: vi.fn().mockResolvedValue([makeType({ status: "inactive" })]) });
    const { service } = build(repo);
    await expect(
      service.createRequest(actor, { leaveTypeId: TYPE_ID, startDate: "2024-06-03", endDate: "2024-06-07" }),
    ).rejects.toThrow(ConflictException);
  });

  it("rejects a range that contains no working day (weekend only)", async () => {
    const repo = makeRepo();
    const { service, hrTasks } = build(repo);
    await expect(
      service.createRequest(actor, { leaveTypeId: TYPE_ID, startDate: "2024-06-08", endDate: "2024-06-09" }),
    ).rejects.toThrow(ConflictException);
    expect(hrTasks.createApprovalTaskTx).not.toHaveBeenCalled();
  });
});

describe("LeaveService — approve / deduct quota", () => {
  it("deducts the quota race-safely and closes the task on approve", async () => {
    const repo = makeRepo();
    const { service, hrTasks, audit, outbox } = build(repo);
    const out = await service.approveRequest(actor, REQ_ID, "ok");
    expect(repo.incrementUsedIfEnoughTx).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ userId: ACTOR_ID, leaveTypeId: TYPE_ID, year: 2024, delta: "5" }),
      repo,
    );
    // F1: the request is re-read under FOR UPDATE inside the tx (not the pre-tx unlocked read).
    expect(repo.findRequestByIdForUpdateTx).toHaveBeenCalledWith(COMPANY_ID, REQ_ID, repo);
    expect(hrTasks.closeTaskTx).toHaveBeenCalledWith(repo, COMPANY_ID, TASK_ID, "approved");
    expect(audit.record).toHaveBeenCalledTimes(2); // LeaveApproved + LeaveBalanceDeducted
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ status: "approved" });
  });

  it("blocks approval (409) when remaining balance is insufficient and leaves the request pending", async () => {
    const repo = makeRepo({ incrementUsedIfEnoughTx: vi.fn().mockResolvedValue([]) });
    const { service, hrTasks } = build(repo);
    await expect(service.approveRequest(actor, REQ_ID)).rejects.toThrow(ConflictException);
    expect(repo.updateRequestTx).not.toHaveBeenCalled();
    expect(hrTasks.closeTaskTx).not.toHaveBeenCalled();
  });

  it("blocks approving a request that is not pending", async () => {
    const repo = makeRepo({
      findRequestByIdForUpdateTx: vi.fn().mockResolvedValue([makeRequest({ status: "approved" })]),
    });
    const { service } = build(repo);
    await expect(service.approveRequest(actor, REQ_ID)).rejects.toThrow(ConflictException);
  });

  it("404 when approving a missing request", async () => {
    const repo = makeRepo({ findRequestByIdForUpdateTx: vi.fn().mockResolvedValue([]) });
    const { service } = build(repo);
    await expect(service.approveRequest(actor, REQ_ID)).rejects.toThrow(NotFoundException);
  });
});

describe("LeaveService — reject / cancel", () => {
  it("blocks rejecting a request that is not pending", async () => {
    const repo = makeRepo({
      findRequestByIdForUpdateTx: vi.fn().mockResolvedValue([makeRequest({ status: "cancelled" })]),
    });
    const { service } = build(repo);
    await expect(service.rejectRequest(actor, REQ_ID)).rejects.toThrow(ConflictException);
  });

  it("closes the task as completed on reject (no quota touched)", async () => {
    const repo = makeRepo({ updateRequestTx: vi.fn().mockResolvedValue([makeRequest({ status: "rejected" })]) });
    const { service, hrTasks } = build(repo);
    await service.rejectRequest(actor, REQ_ID, "thiếu chứng từ");
    expect(hrTasks.closeTaskTx).toHaveBeenCalledWith(repo, COMPANY_ID, TASK_ID, "completed");
    expect(repo.incrementUsedIfEnoughTx).not.toHaveBeenCalled();
  });

  it("blocks cancelling someone else's request", async () => {
    const repo = makeRepo({ findRequestByIdTx: vi.fn().mockResolvedValue([makeRequest({ userId: OTHER_ID })]) });
    const { service } = build(repo);
    await expect(service.cancelRequest(actor, REQ_ID)).rejects.toThrow(ForbiddenException);
  });

  it("blocks cancelling a request that is not pending", async () => {
    const repo = makeRepo({ findRequestByIdTx: vi.fn().mockResolvedValue([makeRequest({ status: "approved" })]) });
    const { service } = build(repo);
    await expect(service.cancelRequest(actor, REQ_ID)).rejects.toThrow(ConflictException);
  });

  it("soft-deletes the Task Hub task on owner cancel", async () => {
    const repo = makeRepo({ updateRequestTx: vi.fn().mockResolvedValue([makeRequest({ status: "cancelled" })]) });
    const { service, hrTasks } = build(repo);
    await service.cancelRequest(actor, REQ_ID);
    expect(hrTasks.cancelTaskTx).toHaveBeenCalledWith(repo, COMPANY_ID, TASK_ID);
  });
});

describe("LeaveService — scope + permission", () => {
  it("blocks listing all requests (scope=all) without approve permission", async () => {
    const repo = makeRepo();
    const { service } = build(repo, /* permissionAllow */ false);
    await expect(service.listRequests(actor, { scope: "all" })).rejects.toThrow(ForbiddenException);
  });

  it("allows listing my own requests (scope=me) without elevated permission", async () => {
    const repo = makeRepo();
    const { service } = build(repo, false);
    await expect(service.listRequests(actor, { scope: "me" })).resolves.toEqual([]);
    expect(repo.findRequests).toHaveBeenCalledWith(COMPANY_ID, {
      userId: ACTOR_ID,
      status: undefined,
      year: undefined,
    });
  });

  it("blocks viewing all balances (scope=all) without manage permission", async () => {
    const repo = makeRepo();
    const { service } = build(repo, false);
    await expect(service.listBalances(actor, { scope: "all" })).rejects.toThrow(ForbiddenException);
  });

  it("scopes balances to self (scope=me) without elevated permission, never leaking others", async () => {
    const repo = makeRepo();
    const { service } = build(repo, false);
    await expect(service.listBalances(actor, { scope: "me" })).resolves.toEqual([]);
    expect(repo.findBalances).toHaveBeenCalledWith(COMPANY_ID, { userId: ACTOR_ID, year: undefined });
  });
});
