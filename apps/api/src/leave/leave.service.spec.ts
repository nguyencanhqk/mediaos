/**
 * G11-2 / S5-LEAVE-DEADCODE-1 — behaviour suite for LeaveService (đã thu hẹp).
 *
 * Khối đơn-nghỉ (createRequest/approveRequest/rejectRequest/cancelRequest) là CODE CHẾT đã bị XOÁ (không
 * route HTTP nào tới — đường sống đi LeaveRequestService/LeaveApprovalService/LeaveRevokeService). Các test
 * của khối đó cũng gỡ theo. Còn lại: guard scope/permission cho list surface (còn sống qua LeaveController).
 *
 *   - scope=all listing requires approve:leave; viewing another user's balance requires manage:leave
 *   - scope=me never leaks others (self-locked)
 *
 * Pure unit tests — repo/db/permission mocked (no Postgres).
 */

import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { LeaveService } from "./leave.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    findRequests: vi.fn().mockResolvedValue([]),
    findBalances: vi.fn().mockResolvedValue([]),
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

const makePermission = (allow: boolean) => ({
  can: vi
    .fn()
    .mockResolvedValue({ allow, reason: allow ? "allow" : "deny-default", auditRequired: false }),
});
const makeAudit = () => ({ record: vi.fn().mockResolvedValue(undefined) });

function build(repo: ReturnType<typeof makeRepo>, permissionAllow = true) {
  const service = new LeaveService(
    makeDb(repo) as never,
    repo as never,
    makePermission(permissionAllow) as never,
    makeAudit() as never,
  );
  return { service };
}

describe("LeaveService — scope + permission", () => {
  it("blocks listing all requests (scope=all) without approve permission", async () => {
    const repo = makeRepo();
    const { service } = build(repo, /* permissionAllow */ false);
    await expect(
      service.listRequests(actorArg(), { scope: "all", limit: 50, offset: 0 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("allows listing my own requests (scope=me) without elevated permission", async () => {
    const repo = makeRepo();
    const { service } = build(repo, false);
    await expect(
      service.listRequests(actorArg(), { scope: "me", limit: 50, offset: 0 }),
    ).resolves.toEqual([]);
    expect(repo.findRequests).toHaveBeenCalledWith(COMPANY_ID, {
      userId: ACTOR_ID,
      status: undefined,
      year: undefined,
      limit: 50,
      offset: 0,
    });
  });

  it("blocks viewing all balances (scope=all) without manage permission", async () => {
    const repo = makeRepo();
    const { service } = build(repo, false);
    await expect(service.listBalances(actorArg(), { scope: "all" })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("scopes balances to self (scope=me) without elevated permission, never leaking others", async () => {
    const repo = makeRepo();
    const { service } = build(repo, false);
    await expect(service.listBalances(actorArg(), { scope: "me" })).resolves.toEqual([]);
    expect(repo.findBalances).toHaveBeenCalledWith(COMPANY_ID, {
      userId: ACTOR_ID,
      year: undefined,
    });
  });
});

function actorArg() {
  return { id: ACTOR_ID, companyId: COMPANY_ID };
}
