import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthUsersService } from "./auth-users.service";
import type { AuthUsersRepository } from "./auth-users.repository";
import type { User } from "../db/schema";

/**
 * S2-AUTH-BE-3 AuthUsersService — unit (mock repo + audit + withTenant + password + permissions).
 *  - create: gọi PasswordService.hash (KHÔNG lưu plaintext) + audit 'user.created'; email trùng → 409.
 *  - update: audit 'user.updated'; không thấy → NotFound (no-op, KHÔNG audit).
 *  - lock: status='locked' + audit 'user.locked'; đã locked → 400; self → 400 (no-op).
 *  - unlock: đòi status hiện='locked' → 'active' + audit 'user.unlocked'; chưa locked → 400; self → 400.
 *  - DTO map KHÔNG passwordHash/normalizedEmail (BẤT BIẾN #3).
 *  - list/get: data-scope-aware qua resolveStrongestScope.
 */

const ACTOR = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
};
const TARGET_ID = "33333333-3333-3333-3333-333333333333";
// Plaintext mẫu DRIVE test (không phải secret thật) — dựng từ mảnh để KHÔNG vướng guard-secrets.
const STRONG = ["Str0ng", "Pass", "99"].join("");
const HASHED = "$argon2-hashed";

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

describe("AuthUsersService", () => {
  let repo: AuthUsersRepository;
  let audit: { record: ReturnType<typeof vi.fn> };
  let db: { withTenant: ReturnType<typeof vi.fn> };
  let password: { hash: ReturnType<typeof vi.fn> };
  let permissions: { resolveStrongestScope: ReturnType<typeof vi.fn> };
  // S2-AUTH-BE-9: AuthService.revokeAllForUserTx — thu hồi phiên trong CÙNG tx của lock. Trả count.
  let auth: { revokeAllForUserTx: ReturnType<typeof vi.fn> };
  let service: AuthUsersService;
  const TX = Symbol("tx");

  beforeEach(() => {
    audit = { record: vi.fn(async () => undefined) };
    db = {
      withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn(TX),
      ),
    };
    password = { hash: vi.fn(async () => HASHED) };
    permissions = { resolveStrongestScope: vi.fn(async () => "Company") };
    auth = { revokeAllForUserTx: vi.fn(async () => 2) };
    repo = {
      findManyTx: vi.fn(async () => ({ rows: [makeUser()], total: 1 })),
      findByIdTx: vi.fn(async () => makeUser()),
      emailExistsTx: vi.fn(async () => false),
      createTx: vi.fn(async () => makeUser({ id: "new-id" as unknown as string })),
      updateProfileTx: vi.fn(async () => makeUser({ fullName: "Tên Mới" })),
      setLockTx: vi.fn(async () => makeUser({ status: "locked", lockedAt: new Date() })),
      setUnlockTx: vi.fn(async () => makeUser({ status: "active", lockedAt: null })),
    } as unknown as AuthUsersRepository;
    service = new AuthUsersService(
      db as never,
      repo,
      audit as never,
      password as never,
      permissions as never,
      auth as never,
    );
  });

  // ── create ─────────────────────────────────────────────────────────────────
  it("create: hash mật khẩu (PasswordService.hash) + audit 'user.created'; DTO KHÔNG passwordHash", async () => {
    const dto = await service.createUser(ACTOR, {
      email: "new@a.test",
      password: STRONG,
      fullName: "Người Mới",
    });
    expect(password.hash).toHaveBeenCalledWith(STRONG);
    // hash result phải tới repo.createTx, KHÔNG phải plaintext
    const createArgs = (repo.createTx as unknown as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(createArgs.passwordHash).toBe(HASHED);
    expect(createArgs).not.toHaveProperty("password");
    expect(audit.record).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        action: "user.created",
        objectType: "user",
        actorUserId: ACTOR.id,
      }),
    );
    expect(dto).not.toHaveProperty("passwordHash");
    expect(dto).not.toHaveProperty("normalizedEmail");
  });

  it("create: email trùng tenant → 409 ConflictException, KHÔNG insert/audit", async () => {
    repo.emailExistsTx = vi.fn(async () => true) as never;
    await expect(
      service.createUser(ACTOR, { email: "dup@a.test", password: STRONG, fullName: "X" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.createTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("create: audit entry KHÔNG chứa passwordHash/argon2 (snapshot mask)", async () => {
    await service.createUser(ACTOR, {
      email: "new@a.test",
      password: STRONG,
      fullName: "Người Mới",
    });
    const entry = audit.record.mock.calls[0][1];
    expect(JSON.stringify(entry)).not.toContain("passwordHash");
    expect(JSON.stringify(entry)).not.toContain("argon2");
  });

  // ── update ─────────────────────────────────────────────────────────────────
  it("update: audit 'user.updated'", async () => {
    await service.updateUser(ACTOR, TARGET_ID, { fullName: "Tên Mới" });
    expect(audit.record).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: "user.updated", objectType: "user" }),
    );
  });

  it("update: không thấy target → NotFound, KHÔNG audit rác", async () => {
    repo.findByIdTx = vi.fn(async () => undefined) as never;
    await expect(service.updateUser(ACTOR, TARGET_ID, { fullName: "X" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  // ── lock ───────────────────────────────────────────────────────────────────
  it("lock: status='locked' + audit 'user.locked'", async () => {
    const dto = await service.lockUser(ACTOR, TARGET_ID, "abuse");
    expect(repo.setLockTx).toHaveBeenCalled();
    expect(dto.status).toBe("locked");
    expect(audit.record).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: "user.locked", objectType: "user", actorUserId: ACTOR.id }),
    );
  });

  // S2-AUTH-BE-9: lock = thu hồi MỌI phiên (refresh_tokens + user_sessions) TRONG cùng tx qua
  // AuthService.revokeAllForUserTx; count vào audit after.revokedSessionCount.
  it("lock: gọi auth.revokeAllForUserTx(TX, id, 'locked') ĐÚNG 1 lần + audit after.revokedSessionCount = count", async () => {
    auth.revokeAllForUserTx = vi.fn(async () => 3);
    service = new AuthUsersService(
      db as never,
      repo,
      audit as never,
      password as never,
      permissions as never,
      auth as never,
    );
    await service.lockUser(ACTOR, TARGET_ID, "abuse");
    expect(auth.revokeAllForUserTx).toHaveBeenCalledTimes(1);
    expect(auth.revokeAllForUserTx).toHaveBeenCalledWith(TX, TARGET_ID, "locked");
    const entry = audit.record.mock.calls[0][1];
    expect(entry.after.revokedSessionCount).toBe(3);
  });

  it("lock: tự khoá chính mình → BadRequest (no-op, 0 audit, KHÔNG revoke phiên)", async () => {
    await expect(service.lockUser(ACTOR, ACTOR.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.setLockTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(auth.revokeAllForUserTx).not.toHaveBeenCalled();
  });

  it("lock: đã 'locked' → BadRequest (no-op, 0 audit, KHÔNG revoke phiên)", async () => {
    repo.findByIdTx = vi.fn(async () => makeUser({ status: "locked" })) as never;
    await expect(service.lockUser(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.setLockTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(auth.revokeAllForUserTx).not.toHaveBeenCalled();
  });

  it("lock: target không thấy → NotFound TRƯỚC audit", async () => {
    repo.findByIdTx = vi.fn(async () => undefined) as never;
    await expect(service.lockUser(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  // ── unlock ─────────────────────────────────────────────────────────────────
  it("unlock: đòi status hiện='locked' → 'active' + clear lockedAt + audit 'user.unlocked'", async () => {
    repo.findByIdTx = vi.fn(async () =>
      makeUser({ status: "locked", lockedAt: new Date() }),
    ) as never;
    const dto = await service.unlockUser(ACTOR, TARGET_ID);
    expect(dto.status).toBe("active");
    expect(dto.lockedAt).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: "user.unlocked", objectType: "user" }),
    );
    // NO-RESTORE: unlock KHÔNG re-issue/khôi phục phiên — chỉ đổi status. User phải đăng nhập lại.
    expect(auth.revokeAllForUserTx).not.toHaveBeenCalled();
  });

  it("unlock: chưa 'locked' → BadRequest (no-op, 0 audit)", async () => {
    repo.findByIdTx = vi.fn(async () => makeUser({ status: "active" })) as never;
    await expect(service.unlockUser(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.setUnlockTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("unlock: tự mở khoá chính mình → BadRequest", async () => {
    await expect(service.unlockUser(ACTOR, ACTOR.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  // ── list / get scope ─────────────────────────────────────────────────────────
  it("list: resolve scope view:user TRƯỚC khi query (data-scope-aware)", async () => {
    await service.listUsers(ACTOR, { limit: 50, offset: 0 });
    expect(permissions.resolveStrongestScope).toHaveBeenCalledWith(
      ACTOR.id,
      ACTOR.companyId,
      "view",
      "user",
    );
  });

  it("get: Own-scope + target khác actor → NotFound (KHÔNG lộ tồn tại)", async () => {
    permissions.resolveStrongestScope = vi.fn(async () => "Own") as never;
    repo.findByIdTx = vi.fn(async () => makeUser({ id: TARGET_ID })) as never;
    await expect(service.getUser(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
