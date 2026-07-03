import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUsersService } from "./admin-users.service";
import type { AdminUsersRepository } from "./admin-users.repository";
import type { User } from "../db/schema";

/**
 * ACCT-2 AdminUsersService — unit (mock repo + audit + withTenant). Crown-jewel checks:
 *  - suspend/softDelete/update ghi audit_logs (action 'user.suspended'/'user.reactivated'/'user.deleted'/
 *    'user.updated', objectType 'user') TRONG cùng tx (append-only).
 *  - softDelete chỉ set deleted_at + status, KHÔNG xoá vật lý (gọi softDeleteTx, KHÔNG tx.delete).
 *  - suspend đặt status='suspended'; reactivate đòi status hiện='suspended'.
 *  - self-guard: actor KHÔNG tự suspend/softDelete chính mình → BadRequest (no-op, không audit).
 *  - target không thấy / đã deleted → NotFound (no-op an toàn, KHÔNG audit rác).
 *  - DTO map KHÔNG passwordHash (BẤT BIẾN #3).
 */

const ACTOR = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
};
const TARGET_ID = "33333333-3333-3333-3333-333333333333";

function makeUser(over: Partial<User> = {}): User {
  return {
    id: TARGET_ID,
    companyId: ACTOR.companyId,
    email: "target@a.test",
    normalizedEmail: "target@a.test",
    passwordHash: "$argon2-secret-NEVER-IN-DTO",
    fullName: "Mục Tiêu",
    status: "active",
    failedLoginCount: 0,
    lockedAt: null,
    lockedReason: null,
    createdAt: new Date("2026-06-19T00:00:00.000Z"),
    updatedAt: new Date("2026-06-19T00:00:00.000Z"),
    deletedAt: null,
    lastLoginAt: null,
    createdBy: null,
    updatedBy: null,
    deletedBy: null,
    requireTwoFactor: false, // S2-AUTH-DB-4 (mig 0466): cờ ép 2FA per-user, NOT NULL DEFAULT false
    ...over,
  };
}

describe("AdminUsersService", () => {
  let repo: AdminUsersRepository;
  let audit: { record: ReturnType<typeof vi.fn> };
  let db: { withTenant: ReturnType<typeof vi.fn> };
  // S2-AUTH-BE-9: AuthService.revokeAllForUserTx — thu hồi phiên trong CÙNG tx của suspend. Trả count.
  let auth: { revokeAllForUserTx: ReturnType<typeof vi.fn> };
  let service: AdminUsersService;
  const TX = Symbol("tx");

  beforeEach(() => {
    audit = { record: vi.fn(async () => undefined) };
    db = {
      // chạy callback với tx giả — service phải gọi repo *Tx + audit TRONG callback (cùng tx).
      withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn(TX),
      ),
    };
    auth = { revokeAllForUserTx: vi.fn(async () => 2) };
    repo = {
      findManyTx: vi.fn(async () => ({ rows: [makeUser()], total: 1 })),
      findByIdTx: vi.fn(async () => makeUser()),
      updateProfileTx: vi.fn(async () => makeUser({ fullName: "Tên Mới" })),
      setStatusTx: vi.fn(async (_tx, _cid, _id, status: string) => makeUser({ status })),
      softDeleteTx: vi.fn(async () => makeUser({ status: "suspended", deletedAt: new Date() })),
    } as unknown as AdminUsersRepository;
    service = new AdminUsersService(db as never, repo, audit as never, auth as never);
  });

  // ── list / get — DTO không secret ─────────────────────────────────────────

  it("listUsers: trả {users,total}; DTO KHÔNG passwordHash", async () => {
    const res = await service.listUsers(ACTOR.companyId, { limit: 50, offset: 0 });
    expect(res.total).toBe(1);
    expect(res.users[0]).not.toHaveProperty("passwordHash");
    expect(res.users[0]).not.toHaveProperty("password_hash");
  });

  it("getUser: target không thấy → NotFound", async () => {
    (repo.findByIdTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await expect(service.getUser(ACTOR.companyId, TARGET_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // ── update ────────────────────────────────────────────────────────────────

  it("updateUser: ghi audit 'user.updated' objectType 'user' trong cùng tx", async () => {
    await service.updateUser(ACTOR, TARGET_ID, { fullName: "Tên Mới" });
    expect(audit.record).toHaveBeenCalledTimes(1);
    const [tx, entry] = audit.record.mock.calls[0];
    expect(tx).toBe(TX); // cùng tx với mutation
    expect(entry.action).toBe("user.updated");
    expect(entry.objectType).toBe("user");
    expect(entry.objectId).toBe(TARGET_ID);
    expect(entry.actorUserId).toBe(ACTOR.id);
  });

  it("updateUser: target không thấy → NotFound, KHÔNG audit", async () => {
    (repo.updateProfileTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await expect(service.updateUser(ACTOR, TARGET_ID, { fullName: "x" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  // ── suspend / reactivate ───────────────────────────────────────────────────

  it("suspendUser: set status='suspended' + audit 'user.suspended'", async () => {
    await service.suspendUser(ACTOR, TARGET_ID, "vi phạm");
    const call = (repo.setStatusTx as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[3]).toBe("suspended");
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][1].action).toBe("user.suspended");
    expect(audit.record.mock.calls[0][1].objectType).toBe("user");
  });

  // S2-AUTH-BE-9: suspend = thu hồi MỌI phiên TRONG cùng tx qua AuthService.revokeAllForUserTx; count →
  // audit after.revokedSessionCount (đối xứng lock).
  it("suspendUser: gọi auth.revokeAllForUserTx(TX, id, 'suspended') ĐÚNG 1 lần + audit after.revokedSessionCount = count", async () => {
    auth.revokeAllForUserTx = vi.fn(async () => 4);
    service = new AdminUsersService(db as never, repo, audit as never, auth as never);
    await service.suspendUser(ACTOR, TARGET_ID, "vi phạm");
    expect(auth.revokeAllForUserTx).toHaveBeenCalledTimes(1);
    expect(auth.revokeAllForUserTx).toHaveBeenCalledWith(TX, TARGET_ID, "suspended");
    const entry = audit.record.mock.calls[0][1];
    expect(entry.after.revokedSessionCount).toBe(4);
  });

  it("suspendUser: self → BadRequest (no-op, KHÔNG chạm DB/audit/revoke)", async () => {
    await expect(service.suspendUser(ACTOR, ACTOR.id, "self")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.setStatusTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(auth.revokeAllForUserTx).not.toHaveBeenCalled();
  });

  it("reactivateUser: chỉ hợp lệ khi status hiện='suspended' → set 'active' + audit 'user.reactivated'", async () => {
    (repo.findByIdTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeUser({ status: "suspended" }),
    );
    await service.reactivateUser(ACTOR, TARGET_ID);
    expect((repo.setStatusTx as ReturnType<typeof vi.fn>).mock.calls[0][3]).toBe("active");
    expect(audit.record.mock.calls[0][1].action).toBe("user.reactivated");
    // NO-RESTORE: reactivate KHÔNG re-issue/khôi phục phiên cũ — chỉ đổi status. User phải đăng nhập lại.
    expect(auth.revokeAllForUserTx).not.toHaveBeenCalled();
  });

  it("reactivateUser: status hiện KHÔNG suspended → BadRequest, KHÔNG audit", async () => {
    (repo.findByIdTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeUser({ status: "active" }),
    );
    await expect(service.reactivateUser(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  // ── soft-delete — KHÔNG hard-delete ────────────────────────────────────────

  it("softDeleteUser: gọi softDeleteTx (set deleted_at+status), KHÔNG hard-delete; audit 'user.deleted'", async () => {
    await service.softDeleteUser(ACTOR, TARGET_ID);
    expect(repo.softDeleteTx).toHaveBeenCalledTimes(1);
    // repo KHÔNG có method xoá vật lý nào được gọi
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][1].action).toBe("user.deleted");
    expect(audit.record.mock.calls[0][1].objectType).toBe("user");
  });

  it("softDeleteUser: self → BadRequest (no-op)", async () => {
    await expect(service.softDeleteUser(ACTOR, ACTOR.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.softDeleteTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("softDeleteUser: target không thấy / đã deleted → NotFound, KHÔNG audit", async () => {
    (repo.softDeleteTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await expect(service.softDeleteUser(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });
});
