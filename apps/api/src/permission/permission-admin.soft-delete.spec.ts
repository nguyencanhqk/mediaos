/**
 * S2-AUTH-DB-3 (Lane B) — RED-before-GREEN cho SOFT-DELETE wiring của PermissionAdminService.
 *
 * Bối cảnh (mig 0471): revoke/reassign role KHÔNG còn hard-delete — `deleteUserRole` chuyển sang UPDATE
 * set deleted_at/deleted_by và nhận thêm `actorUserId`. Suite này chốt phần WIRING (mockable) — actor.id
 * được truyền vào deleteUserRole ở CẢ 2 caller, audit/securityEvents/outbox giữ nguyên trong-tx:
 *   - revokeRole (QA-05): gỡ role → deleteUserRole(actor.id) + audit RoleRevoked + ROLE_REMOVED + emit.
 *   - assignRole nhánh reassign đổi-expiry (:110): deleteUserRole(actor.id) trước insert.
 *   - assignRole re-grant CÙNG null-expiry SAU soft-delete (round-3 #9): reader findUserRole đã lọc
 *     tombstone → trả undefined → service KHÔNG rơi vào no-op-giả → insert row mới + audit RoleAssigned.
 *
 * RED: `deleteUserRole` mock được gọi với 5 tham số (thêm actor.id) — trước GREEN chữ ký repo là 4 tham số
 *   nên assertion "gọi kèm actor.id" fail (arg thứ 5 undefined). Sau GREEN pass.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionAdminService } from "./permission-admin.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const TARGET = "33333333-3333-3333-3333-333333333333";
const ROLE = "44444444-4444-4444-4444-444444444444";
const UR_ACTIVE = "55555555-5555-5555-5555-555555555555";

type FakeTx = { __tx: true };
const FAKE_TX: FakeTx = { __tx: true };

function build() {
  const repo = {
    findAssignableRole: vi.fn().mockResolvedValue({ id: ROLE }),
    findUserInTenant: vi.fn().mockResolvedValue({ id: TARGET }),
    findUserRole: vi.fn(),
    insertUserRole: vi.fn(),
    deleteUserRole: vi.fn().mockResolvedValue(UR_ACTIVE),
    findUserIdsWithRole: vi.fn().mockResolvedValue([]),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const outbox = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const securityEvents = { record: vi.fn().mockResolvedValue(undefined) };
  const permissionService = {
    can: vi.fn().mockResolvedValue({ allow: true, reason: "allow", auditRequired: false }),
  };
  const db = {
    // withTenant chỉ chuyển tiếp callback với 1 tx giả (không chạm DB).
    withTenant: vi.fn(async (_companyId: string, fn: (tx: FakeTx) => Promise<unknown>) =>
      fn(FAKE_TX),
    ),
  };
  const service = new PermissionAdminService(
    db as never,
    permissionService as never,
    audit as never,
    outbox as never,
    repo as never,
    securityEvents as never,
  );
  return { service, repo, audit, outbox, securityEvents, permissionService, db };
}

const actor = { id: ACTOR, companyId: COMPANY };

describe("PermissionAdminService soft-delete wiring (S2-AUTH-DB-3)", () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it("(1) revokeRole → deleteUserRole nhận actor.id (soft-delete actor) + audit RoleRevoked + ROLE_REMOVED + emit", async () => {
    ctx.repo.findUserRole.mockResolvedValue({
      id: UR_ACTIVE,
      roleId: ROLE,
      grantedBy: "granter",
      expiresAt: null,
      deletedAt: null,
    });

    await ctx.service.revokeRole(actor, TARGET, ROLE);

    // KEY: caller revoke truyền actor.id (tham số thứ 5) → deleted_by = actor.
    expect(ctx.repo.deleteUserRole).toHaveBeenCalledWith(FAKE_TX, COMPANY, TARGET, ROLE, ACTOR);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ action: "RoleRevoked", actorUserId: ACTOR, objectId: UR_ACTIVE }),
    );
    expect(ctx.securityEvents.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ eventType: "ROLE_REMOVED", userId: TARGET, actorUserId: ACTOR }),
    );
    expect(ctx.outbox.enqueue).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({
        eventType: "permission.changed",
        payload: { userId: TARGET, companyId: COMPANY },
      }),
    );
  });

  it("(2) revokeRole → 404 khi user KHÔNG có role active (findUserRole lọc tombstone → undefined) — KHÔNG soft-delete", async () => {
    ctx.repo.findUserRole.mockResolvedValue(undefined);
    await expect(ctx.service.revokeRole(actor, TARGET, ROLE)).rejects.toMatchObject({
      status: 404,
    });
    expect(ctx.repo.deleteUserRole).not.toHaveBeenCalled();
  });

  it("(3) assignRole nhánh reassign (đổi expiry) → deleteUserRole nhận actor.id trước insert + audit RoleReassigned", async () => {
    const oldExpiry = new Date("2030-01-01T00:00:00Z");
    ctx.repo.findUserRole.mockResolvedValue({
      id: UR_ACTIVE,
      roleId: ROLE,
      grantedBy: "granter",
      expiresAt: oldExpiry,
      deletedAt: null,
    });
    ctx.repo.insertUserRole.mockResolvedValue({ id: "new-ur", roleId: ROLE });

    // dto expiry KHÁC (null) → sameExpiry=false → nhánh reassign.
    await ctx.service.assignRole(actor, TARGET, { roleId: ROLE, expiresAt: null } as never);

    expect(ctx.repo.deleteUserRole).toHaveBeenCalledWith(FAKE_TX, COMPANY, TARGET, ROLE, ACTOR);
    expect(ctx.repo.insertUserRole).toHaveBeenCalledTimes(1);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ action: "RoleReassigned", actorUserId: ACTOR }),
    );
  });

  it("(4) assignRole re-grant CÙNG null-expiry SAU soft-delete (round-3 #9) → KHÔNG no-op-giả: insert + RoleAssigned", async () => {
    // Reader ĐÃ lọc tombstone ⇒ findUserRole trả undefined dù DB còn hàng deleted.
    ctx.repo.findUserRole.mockResolvedValue(undefined);
    ctx.repo.insertUserRole.mockResolvedValue({ id: "fresh-ur", roleId: ROLE });

    await ctx.service.assignRole(actor, TARGET, { roleId: ROLE, expiresAt: null } as never);

    // KHÔNG rơi vào no-op (không có existing) → KHÔNG gọi deleteUserRole nhưng PHẢI insert + audit assign.
    expect(ctx.repo.deleteUserRole).not.toHaveBeenCalled();
    expect(ctx.repo.insertUserRole).toHaveBeenCalledTimes(1);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ action: "RoleAssigned", actorUserId: ACTOR }),
    );
    expect(ctx.outbox.enqueue).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ eventType: "permission.changed" }),
    );
  });

  it("(5) assignRole no-op THẬT (đã có active + CÙNG expiry) → KHÔNG delete/insert/audit", async () => {
    ctx.repo.findUserRole.mockResolvedValue({
      id: UR_ACTIVE,
      roleId: ROLE,
      grantedBy: "granter",
      expiresAt: null,
      deletedAt: null,
    });

    await ctx.service.assignRole(actor, TARGET, { roleId: ROLE, expiresAt: null } as never);

    expect(ctx.repo.deleteUserRole).not.toHaveBeenCalled();
    expect(ctx.repo.insertUserRole).not.toHaveBeenCalled();
    expect(ctx.audit.record).not.toHaveBeenCalled();
  });
});
