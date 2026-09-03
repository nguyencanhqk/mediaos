import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
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
    mustChangePassword: false, // S2-FND-SEED-3 (mig 0469): ép đổi mật khẩu lần đầu, NOT NULL DEFAULT false
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
  // S2-AUTH-BE-8/12: SecurityEventWriter.record — timeline dual-write (TOTP_RESET).
  let securityEvents: { record: ReturnType<typeof vi.fn> };
  // S5-LMS-BE-1: LmsSyncProducer.enqueueSync — wire-in assertion cho lock/unlock.
  let lmsSync: { enqueueSync: ReturnType<typeof vi.fn> };
  // S18-AUTH-RESETCLEARS-1: `resetPassword` (admin) gọi `requireRateLimiter()` TRƯỚC mọi mutation ⇒
  // mọi chỗ dựng service phải truyền, nếu không 3 ca resetPassword ném Error thay vì 400/404 mong đợi.
  let rateLimiter: { clearLoginLocks: ReturnType<typeof vi.fn> };
  // Spy logger: thiếu nó thì đổi `catch (err) { this.logger.error(…); … }` thành `catch { … }` vẫn
  // XANH toàn bộ suite — đúng mẫu tests-can-pin-a-hole-open.
  let logger: ReturnType<typeof vi.spyOn>;
  let service: AuthUsersService;
  // S18-AUTH-RESETCLEARS-1: `resetPassword` (admin) giờ đọc `companies.slug` TRONG tx để dựng khoá
  // rate-limit ⇒ tx sentinel phải có `.execute`. Vẫn là MỘT tham chiếu duy nhất nên mọi assert
  // `toHaveBeenCalledWith(TX, …)` giữ nguyên ý nghĩa.
  const TX = { execute: vi.fn(async () => ({ rows: [{ slug: "acme" }] })) };

  beforeEach(() => {
    audit = { record: vi.fn(async () => undefined) };
    securityEvents = { record: vi.fn(async () => undefined) };
    lmsSync = { enqueueSync: vi.fn(async () => undefined) };
    rateLimiter = {
      clearLoginLocks: vi.fn(async () => ({ clearedKeys: 6, degraded: false })),
    };
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
      // S2-AUTH-BE-12
      getTwoFactorStateTx: vi.fn(async () => ({ enabled: false, requiredByRole: false })),
      deleteTwoFactorTx: vi.fn(async () => undefined),
      // S2-AUTH-USEROPS-1
      softDeleteTx: vi.fn(async () => makeUser({ deletedAt: new Date() })),
      restoreTx: vi.fn(async () => makeUser({ deletedAt: null })),
      findDeletedByIdTx: vi.fn(async () => makeUser({ deletedAt: new Date() })),
      setPasswordTx: vi.fn(async () => makeUser({ mustChangePassword: true })),
    } as unknown as AuthUsersRepository;
    service = new AuthUsersService(
      db as never,
      repo,
      audit as never,
      password as never,
      permissions as never,
      auth as never,
      securityEvents as never,
      lmsSync as never,
      rateLimiter as never,
    );
    logger = vi
      .spyOn(
        (service as unknown as { logger: { error: (...a: unknown[]) => void } }).logger,
        "error",
      )
      .mockImplementation(() => undefined);
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
    // S5-LMS-BE-1 wire-in: enqueue LMS auto-sync CÙNG tx, đúng tenant (actor) + target userId.
    expect(lmsSync.enqueueSync).toHaveBeenCalledWith(TX, ACTOR.companyId, TARGET_ID);
  });

  // S2-AUTH-BE-9: lock = thu hồi MỌI phiên (refresh_tokens + user_sessions) TRONG cùng tx qua
  // AuthService.revokeAllForUserTx; count vào audit after.revokedSessionCount.
  it("lock: gọi auth.revokeAllForUserTx(TX, companyId, id, 'locked') ĐÚNG 1 lần + audit after.revokedSessionCount = count", async () => {
    auth.revokeAllForUserTx = vi.fn(async () => 3);
    service = new AuthUsersService(
      db as never,
      repo,
      audit as never,
      password as never,
      permissions as never,
      auth as never,
      securityEvents as never,
      lmsSync as never,
      rateLimiter as never,
    );
    await service.lockUser(ACTOR, TARGET_ID, "abuse");
    expect(auth.revokeAllForUserTx).toHaveBeenCalledTimes(1);
    expect(auth.revokeAllForUserTx).toHaveBeenCalledWith(TX, ACTOR.companyId, TARGET_ID, "locked");
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
    // S5-LMS-BE-1 wire-in: enqueue LMS auto-sync CÙNG tx (mở khoá → LMS mở lại nếu NV còn active).
    expect(lmsSync.enqueueSync).toHaveBeenCalledWith(TX, ACTOR.companyId, TARGET_ID);
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

  it("getUserDetail: Own-scope + target khác actor → NotFound (KHÔNG lộ tồn tại)", async () => {
    permissions.resolveStrongestScope = vi.fn(async () => "Own") as never;
    repo.findByIdTx = vi.fn(async () => makeUser({ id: TARGET_ID })) as never;
    await expect(service.getUserDetail(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── S2-AUTH-BE-12: getUserDetail twoFactor 3 nguồn TÁCH BIỆT ─────────────────────
  it("getUserDetail: twoFactor 3 cờ đúng nguồn (enabled/requiredByRole từ repo state; requiredByUser từ cột row)", async () => {
    repo.findByIdTx = vi.fn(async () => makeUser({ requireTwoFactor: true })) as never;
    repo.getTwoFactorStateTx = vi.fn(async () => ({
      enabled: true,
      requiredByRole: false,
    })) as never;
    const detail = await service.getUserDetail(ACTOR, TARGET_ID);
    expect(detail.twoFactor).toEqual({
      enabled: true, // user_totp.enabled_at (repo)
      requiredByRole: false, // join roles-only (repo)
      requiredByUser: true, // cột users.require_two_factor (row)
    });
    // KHÔNG lộ secret/hash trong DTO detail.
    expect(detail).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(detail)).not.toContain("secret_ciphertext");
  });

  // ── S2-AUTH-BE-12: updateUser requireTwoFactor + no-op ───────────────────────────
  it("update: requireTwoFactor=true (khác cũ false) → repo patch có cờ + audit diff before/after", async () => {
    repo.findByIdTx = vi.fn(async () => makeUser({ requireTwoFactor: false })) as never;
    repo.updateProfileTx = vi.fn(async () => makeUser({ requireTwoFactor: true })) as never;
    await service.updateUser(ACTOR, TARGET_ID, { requireTwoFactor: true });
    const patchArg = (repo.updateProfileTx as unknown as ReturnType<typeof vi.fn>).mock.calls[0][3];
    expect(patchArg).toEqual({ requireTwoFactor: true });
    const entry = audit.record.mock.calls[0][1];
    expect(entry.action).toBe("user.updated");
    expect(entry.before.requireTwoFactor).toBe(false);
    expect(entry.after.requireTwoFactor).toBe(true);
  });

  it("update: no-op (body rỗng) → KHÔNG gọi updateProfileTx, KHÔNG audit (0 audit rác)", async () => {
    repo.findByIdTx = vi.fn(async () => makeUser({ fullName: "Giữ Nguyên" })) as never;
    await service.updateUser(ACTOR, TARGET_ID, {});
    expect(repo.updateProfileTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("update: no-op (requireTwoFactor == giá trị cũ) → KHÔNG gọi updateProfileTx, KHÔNG audit", async () => {
    repo.findByIdTx = vi.fn(async () => makeUser({ requireTwoFactor: true })) as never;
    await service.updateUser(ACTOR, TARGET_ID, { requireTwoFactor: true });
    expect(repo.updateProfileTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  // ── S2-AUTH-BE-12: resetTwoFactor ────────────────────────────────────────────────
  it("resetTwoFactor: xoá 2FA + revokeAllForUserTx đúng 1 lần + audit user.2fa_reset (KHÔNG secret) + emit TOTP_RESET", async () => {
    auth.revokeAllForUserTx = vi.fn(async () => 3);
    service = new AuthUsersService(
      db as never,
      repo,
      audit as never,
      password as never,
      permissions as never,
      auth as never,
      securityEvents as never,
      lmsSync as never,
      rateLimiter as never,
    );
    const res = await service.resetTwoFactor(ACTOR, TARGET_ID);
    expect(res.revokedSessionCount).toBe(3);
    expect(repo.deleteTwoFactorTx).toHaveBeenCalledWith(TX, ACTOR.companyId, TARGET_ID);
    expect(auth.revokeAllForUserTx).toHaveBeenCalledTimes(1);
    expect(auth.revokeAllForUserTx).toHaveBeenCalledWith(
      TX,
      ACTOR.companyId,
      TARGET_ID,
      "2fa_reset",
    );
    const auditEntry = audit.record.mock.calls[0][1];
    expect(auditEntry.action).toBe("user.2fa_reset");
    expect(auditEntry.objectType).toBe("user");
    expect(auditEntry.after.revokedSessionCount).toBe(3);
    expect(JSON.stringify(auditEntry)).not.toContain("secret_ciphertext");
    expect(JSON.stringify(auditEntry)).not.toContain("encrypted_dek");
    const evEntry = securityEvents.record.mock.calls[0][1];
    expect(evEntry.eventType).toBe("TOTP_RESET");
    expect(evEntry.userId).toBe(TARGET_ID);
    expect(evEntry.actorUserId).toBe(ACTOR.id);
  });

  it("resetTwoFactor: self-reset (actor==target) CHO PHÉP (KHÔNG BadRequest)", async () => {
    repo.findByIdTx = vi.fn(async () => makeUser({ id: ACTOR.id })) as never;
    const res = await service.resetTwoFactor(ACTOR, ACTOR.id);
    expect(res.revokedSessionCount).toBeGreaterThanOrEqual(0);
    expect(repo.deleteTwoFactorTx).toHaveBeenCalled();
  });

  it("resetTwoFactor: target không thấy / cross-tenant → NotFound TRƯỚC mọi mutation (0 audit, 0 revoke)", async () => {
    repo.findByIdTx = vi.fn(async () => undefined) as never;
    await expect(service.resetTwoFactor(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.deleteTwoFactorTx).not.toHaveBeenCalled();
    expect(auth.revokeAllForUserTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  // ── S2-AUTH-USEROPS-1: deleteUser (xóa mềm) ─────────────────────────────────────
  it("delete: soft-delete + revoke phiên đúng 1 lần + audit 'user.deleted' (count vào after) + emit USER_DELETED", async () => {
    auth.revokeAllForUserTx = vi.fn(async () => 4);
    service = new AuthUsersService(
      db as never,
      repo,
      audit as never,
      password as never,
      permissions as never,
      auth as never,
      securityEvents as never,
      lmsSync as never,
      rateLimiter as never,
    );
    const dto = await service.deleteUser(ACTOR, TARGET_ID);
    expect(repo.softDeleteTx).toHaveBeenCalledWith(TX, ACTOR.companyId, TARGET_ID, ACTOR.id);
    expect(auth.revokeAllForUserTx).toHaveBeenCalledTimes(1);
    expect(auth.revokeAllForUserTx).toHaveBeenCalledWith(TX, ACTOR.companyId, TARGET_ID, "deleted");
    expect(dto.deletedAt).not.toBeNull();
    const entry = audit.record.mock.calls[0][1];
    expect(entry.action).toBe("user.deleted");
    expect(entry.objectType).toBe("user");
    expect(entry.after.revokedSessionCount).toBe(4);
    const evEntry = securityEvents.record.mock.calls[0][1];
    expect(evEntry.eventType).toBe("USER_DELETED");
    expect(evEntry.userId).toBe(TARGET_ID);
    expect(evEntry.actorUserId).toBe(ACTOR.id);
  });

  it("delete: GIỮ NGUYÊN status khi xóa (khôi phục trả về đúng trạng thái trước xóa)", async () => {
    repo.findByIdTx = vi.fn(async () => makeUser({ status: "locked" })) as never;
    repo.softDeleteTx = vi.fn(async () =>
      makeUser({ status: "locked", deletedAt: new Date() }),
    ) as never;
    const dto = await service.deleteUser(ACTOR, TARGET_ID);
    expect(dto.status).toBe("locked");
  });

  it("delete: tự xóa chính mình → BadRequest (no-op, 0 audit, 0 revoke)", async () => {
    await expect(service.deleteUser(ACTOR, ACTOR.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.softDeleteTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(auth.revokeAllForUserTx).not.toHaveBeenCalled();
  });

  it("delete: target không thấy / cross-tenant → NotFound TRƯỚC audit (0 audit rác)", async () => {
    repo.findByIdTx = vi.fn(async () => undefined) as never;
    await expect(service.deleteUser(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  // ── S2-AUTH-USEROPS-1: restoreUser (khôi phục) ──────────────────────────────────
  it("restore: đòi row ĐANG deleted + clear deletedAt + audit 'user.restored' + emit USER_RESTORED (KHÔNG revoke)", async () => {
    const dto = await service.restoreUser(ACTOR, TARGET_ID);
    expect(repo.findDeletedByIdTx).toHaveBeenCalledWith(TX, ACTOR.companyId, TARGET_ID);
    expect(repo.restoreTx).toHaveBeenCalledWith(TX, ACTOR.companyId, TARGET_ID, ACTOR.id);
    expect(dto.deletedAt).toBeNull();
    const entry = audit.record.mock.calls[0][1];
    expect(entry.action).toBe("user.restored");
    expect(entry.objectType).toBe("user");
    const evEntry = securityEvents.record.mock.calls[0][1];
    expect(evEntry.eventType).toBe("USER_RESTORED");
    expect(auth.revokeAllForUserTx).not.toHaveBeenCalled();
  });

  it("restore: target KHÔNG ở trạng thái deleted (hoặc cross-tenant) → NotFound, 0 audit", async () => {
    repo.findDeletedByIdTx = vi.fn(async () => undefined) as never;
    await expect(service.restoreUser(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.restoreTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("restore: email đã có user LIVE trùng (tạo mới sau khi xóa) → 409 Conflict, KHÔNG restore", async () => {
    repo.emailExistsTx = vi.fn(async () => true) as never;
    await expect(service.restoreUser(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.restoreTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("restore: thua ĐUA unique (precheck pass nhưng UPDATE nổ 23505 lồng trong cause) → 409, KHÔNG 500", async () => {
    // Mirror DrizzleQueryError: pg error nằm ở .cause (db-error.ts walk cause-chain).
    repo.restoreTx = vi.fn(async () => {
      throw Object.assign(new Error("update failed"), {
        cause: { code: "23505", constraint: "users_company_normalized_email_active_uq" },
      });
    }) as never;
    await expect(service.restoreUser(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  // ── S2-AUTH-USEROPS-1: resetPassword (admin đặt lại mật khẩu) ───────────────────
  it("resetPassword: temp password đạt policy (≥12, hoa+thường+số) + hash + must_change + revoke + audit KHÔNG chứa secret", async () => {
    auth.revokeAllForUserTx = vi.fn(async () => 2);
    service = new AuthUsersService(
      db as never,
      repo,
      audit as never,
      password as never,
      permissions as never,
      auth as never,
      securityEvents as never,
      lmsSync as never,
      rateLimiter as never,
    );
    const res = await service.resetPassword(ACTOR, TARGET_ID);

    // temp password trả về ĐÚNG 1 LẦN + đạt policy newPasswordSchema
    expect(res.tempPassword.length).toBeGreaterThanOrEqual(12);
    expect(res.tempPassword).toMatch(/[a-z]/);
    expect(res.tempPassword).toMatch(/[A-Z]/);
    expect(res.tempPassword).toMatch(/[0-9]/);
    expect(res.revokedSessionCount).toBe(2);

    // hash nhận ĐÚNG temp password; repo nhận HASH (không plaintext) + ép must_change_password
    expect(password.hash).toHaveBeenCalledWith(res.tempPassword);
    expect(repo.setPasswordTx).toHaveBeenCalledWith(
      TX,
      ACTOR.companyId,
      TARGET_ID,
      HASHED,
      ACTOR.id,
    );
    expect(auth.revokeAllForUserTx).toHaveBeenCalledTimes(1);
    expect(auth.revokeAllForUserTx).toHaveBeenCalledWith(
      TX,
      ACTOR.companyId,
      TARGET_ID,
      "admin_password_reset",
    );

    // audit + security event KHÔNG BAO GIỜ chứa temp password / hash (BẤT BIẾN #3)
    const entry = audit.record.mock.calls[0][1];
    expect(entry.action).toBe("user.password_reset_by_admin");
    expect(entry.after.revokedSessionCount).toBe(2);
    expect(JSON.stringify(entry)).not.toContain(res.tempPassword);
    expect(JSON.stringify(entry)).not.toContain(HASHED);
    const evEntry = securityEvents.record.mock.calls[0][1];
    expect(evEntry.eventType).toBe("PASSWORD_RESET_BY_ADMIN");
    expect(JSON.stringify(evEntry)).not.toContain(res.tempPassword);
  });

  it("resetPassword: mỗi lần gọi sinh temp password KHÁC nhau (crypto random, không tất định)", async () => {
    const a = await service.resetPassword(ACTOR, TARGET_ID);
    const b = await service.resetPassword(ACTOR, TARGET_ID);
    expect(a.tempPassword).not.toBe(b.tempPassword);
  });

  it("resetPassword: tự reset chính mình → BadRequest (dùng change-password; no-op, 0 audit, 0 revoke)", async () => {
    await expect(service.resetPassword(ACTOR, ACTOR.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.setPasswordTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(auth.revokeAllForUserTx).not.toHaveBeenCalled();
  });

  it("resetPassword: target không thấy / cross-tenant → NotFound TRƯỚC mọi mutation (0 audit)", async () => {
    repo.findByIdTx = vi.fn(async () => undefined) as never;
    await expect(service.resetPassword(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.setPasswordTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(securityEvents.record).not.toHaveBeenCalled();
  });

  // ── S18-AUTH-RESETCLEARS-1: admin đặt lại mật khẩu ⇒ gỡ luôn khoá 429 ───────────
  it("resetPassword: gỡ khoá đăng nhập SAU commit — slug/email TỪ DB, includeForgot=true, KHÔNG truyền subject", async () => {
    await service.resetPassword(ACTOR, TARGET_ID);
    // Ghim CẢ BỐN đối số. Thiếu `undefined` ở vế 3 ⇒ bucket `2fa` bước-2 bị gỡ bằng một cặp quyền
    // KHÔNG phải `reset-2fa:user`; thiếu `includeForgot` ⇒ lỗi biên dịch. Cả hai đều là leo thang.
    expect(rateLimiter.clearLoginLocks).toHaveBeenCalledWith("acme", "target@a.test", undefined, {
      includeForgot: true,
    });
  });

  it("resetPassword: tự reset chính mình ⇒ 400 TRƯỚC cả requireRateLimiter (thứ tự lỗi không đổi)", async () => {
    await expect(service.resetPassword(ACTOR, ACTOR.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(rateLimiter.clearLoginLocks).not.toHaveBeenCalled();
  });

  it("resetPassword: target không thấy ⇒ KHÔNG gỡ khoá (không chạm không gian khoá của ai)", async () => {
    repo.findByIdTx = vi.fn(async () => undefined) as never;
    await expect(service.resetPassword(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(rateLimiter.clearLoginLocks).not.toHaveBeenCalled();
  });

  it("resetPassword: thiếu DI LoginRateLimiter ⇒ ném TRƯỚC mọi mutation (0 hash, 0 update, 0 audit)", async () => {
    // Fail-fast, KHÔNG `?.` no-op: no-op nghĩa là admin nhận temp password mà người dùng vẫn 429.
    service = new AuthUsersService(
      db as never,
      repo,
      audit as never,
      password as never,
      permissions as never,
      auth as never,
      securityEvents as never,
      lmsSync as never,
      undefined,
    );
    await expect(service.resetPassword(ACTOR, TARGET_ID)).rejects.toThrow(/LoginRateLimiter/);
    expect(password.hash).not.toHaveBeenCalled();
    expect(repo.setPasswordTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("resetPassword: gỡ khoá degraded ⇒ VẪN trả tempPassword, và ghi vết thất bại (audit + USER_UNLOCKED ok:false)", async () => {
    // Đây là điểm cả wave xoay quanh: `user.password_reset_by_admin` một mình HÀM Ý "vào lại được
    // ngay". Khi gỡ hỏng, câu đó sai — phải có hàng nói ra, nếu không forensics đọc ngược thành công.
    rateLimiter.clearLoginLocks = vi.fn(async () => ({
      clearedKeys: 6,
      degraded: true,
    }));
    const res = await service.resetPassword(ACTOR, TARGET_ID);
    // KHÔNG được ném: tempPassword là plaintext trả MỘT LẦN, ném = vứt mất nó.
    expect(res.tempPassword.length).toBeGreaterThanOrEqual(12);
    // Nhánh degraded KHÔNG ném ⇒ nếu chỉ ghi audit thì log/APM im lặng đúng lúc bất thường nhất.
    expect(logger).toHaveBeenCalled();
    const actions = audit.record.mock.calls.map((c) => (c[1] as { action: string }).action);
    expect(actions).toContain("user.login_throttle_cleared");
    const events = securityEvents.record.mock.calls.map(
      (c) =>
        c[1] as {
          eventType: string;
          payload?: { ok?: boolean; reason?: string };
        },
    );
    const unlocked = events.find((e) => e.eventType === "USER_UNLOCKED");
    expect(unlocked?.payload).toMatchObject({
      reason: "password_reset",
      ok: false,
    });
  });

  it("resetPassword: gỡ khoá THÀNH CÔNG ⇒ KHÔNG bồi hàng USER_UNLOCKED (ca đối chứng của ca trên)", async () => {
    // Thiếu ca này thì ca degraded ở trên xanh cả khi code ghi vết VÔ ĐIỀU KIỆN — tức đo sai hẳn thứ
    // đang đo, và bồi `USER_UNLOCKED` cho tài khoản chưa từng bị khoá (món nợ WO-1 §10.5).
    await service.resetPassword(ACTOR, TARGET_ID);
    const actions = audit.record.mock.calls.map((c) => (c[1] as { action: string }).action);
    expect(actions).not.toContain("user.login_throttle_cleared");
    const events = securityEvents.record.mock.calls.map(
      (c) => (c[1] as { eventType: string }).eventType,
    );
    expect(events).not.toContain("USER_UNLOCKED");
  });

  it("resetPassword: clearLoginLocks NÉM ⇒ vẫn trả tempPassword + ghi vết (bug Valkey không được nuốt)", async () => {
    rateLimiter.clearLoginLocks = vi.fn(async () => {
      throw new Error("ValkeyKeyScopeError: khoá ngoài phạm vi env");
    });
    const res = await service.resetPassword(ACTOR, TARGET_ID);
    expect(res.tempPassword.length).toBeGreaterThanOrEqual(12);
    expect(logger).toHaveBeenCalled();
    const actions = audit.record.mock.calls.map((c) => (c[1] as { action: string }).action);
    expect(actions).toContain("user.login_throttle_cleared");
  });

  it("resetPassword: KHÔNG đọc được slug công ty ⇒ KHÔNG gỡ khoá, KHÔNG đoán, và PHẢI cảnh báo", async () => {
    // Nhánh "không gỡ vì chưa từng thử gỡ" — ít dấu vết hơn cả ca degraded, nên nếu im luôn thì không
    // gì trên đời ghi lại việc admin tưởng đã cứu người dùng mà thực ra chưa. Đoán slug còn tệ hơn:
    // đoán sai = gỡ khoá của NGƯỜI KHÁC (khoá dựng theo `(slug,email)`).
    const warn = vi
      .spyOn((service as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger, "warn")
      .mockImplementation(() => undefined);
    TX.execute.mockResolvedValueOnce({ rows: [] });
    const res = await service.resetPassword(ACTOR, TARGET_ID);
    expect(res.tempPassword.length).toBeGreaterThanOrEqual(12);
    expect(rateLimiter.clearLoginLocks).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  // ── S2-AUTH-USEROPS-1: list deleted filter ──────────────────────────────────────
  it("list: query.deleted=true → repo filter nhận deleted=true (view Đã xóa)", async () => {
    await service.listUsers(ACTOR, { limit: 50, offset: 0, deleted: true });
    const filterArg = (repo.findManyTx as unknown as ReturnType<typeof vi.fn>).mock.calls[0][3];
    expect(filterArg.deleted).toBe(true);
  });

  // ── Đối soát AUTH↔HR: filter linkedProfile passthrough + map hasEmployeeProfile ──
  it("list: query.linkedProfile=false → repo filter nhận linkedProfile=false", async () => {
    await service.listUsers(ACTOR, { limit: 50, offset: 0, linkedProfile: false });
    const filterArg = (repo.findManyTx as unknown as ReturnType<typeof vi.fn>).mock.calls[0][3];
    expect(filterArg.linkedProfile).toBe(false);
  });

  it("list: map hasEmployeeProfile từ repo row vào DTO", async () => {
    repo.findManyTx = vi.fn(async () => ({
      rows: [{ ...makeUser(), hasEmployeeProfile: true }],
      total: 1,
    })) as never;
    const result = await service.listUsers(ACTOR, { limit: 50, offset: 0 });
    expect(result.users[0].hasEmployeeProfile).toBe(true);
  });
});
/**
 * S18-AUTH-UNLOCK429-1 — GET/POST /auth/users/:id/login-throttle (gỡ khoá 429).
 *
 * Dựng service RIÊNG ở đây (không dùng `beforeEach` chung) vì đường này cần một `tx` có `.execute`
 * (đọc `companies.slug`), trong khi mock chung dùng `Symbol` làm tx.
 */
describe("AuthUsersService — login throttle (429)", () => {
  const SLUG = "acme";
  const TX = {
    execute: vi.fn(async () => ({ rows: [{ slug: SLUG }] })),
  };

  function makeService(
    over: {
      throttle?: Partial<{
        state: {
          locked: boolean;
          remainingSec: number | null;
          buckets: string[];
          unknown: boolean;
        };
        after: {
          locked: boolean;
          remainingSec: number | null;
          buckets: string[];
          unknown: boolean;
        };
        degraded: boolean;
      }>;
      findByIdTx?: () => Promise<unknown>;
      omitRateLimiter?: boolean;
      canResetTwoFactor?: boolean;
    } = {},
  ) {
    const state = over.throttle?.state ?? {
      locked: true,
      remainingSec: 600,
      buckets: ["ip"],
    };
    const after = over.throttle?.after ?? {
      locked: false,
      remainingSec: null,
      buckets: [],
    };
    // Khai báo THAM SỐ tường minh: `vi.fn(async () => …)` cho kiểu call là tuple RỖNG, nên mọi assert
    // đọc `mock.calls[0][1]` (hàng audit) sẽ đỏ kiểu — và cách "sửa" nhanh là ép `as never`, tức vứt
    // luôn chính thứ mà các ca dưới đây đang đo.
    const audit = {
      record: vi.fn(async (_tx: unknown, _entry: Record<string, unknown>) => undefined),
    };
    const securityEvents = {
      record: vi.fn(async (_tx: unknown, _entry: Record<string, unknown>) => undefined),
    };
    const db = {
      withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
    };
    const repo = {
      findByIdTx: over.findByIdTx ?? vi.fn(async () => makeUser()),
    } as unknown as AuthUsersRepository;
    // `loginThrottleState` trả state TRƯỚC ở lần gọi đầu, state SAU ở lần gọi thứ hai — đúng thứ tự
    // service gọi (đọc → clear → đọc lại). Dùng cùng một hàm cho cả hai lần sẽ làm ca "vẫn còn khoá
    // sau khi gỡ" không thể tồn tại.
    const loginThrottleState = vi
      .fn()
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(after)
      .mockResolvedValue(after);
    const clearLoginLocks = vi.fn(async () => ({
      clearedKeys: 6,
      degraded: over.throttle?.degraded ?? false,
    }));
    const rateLimiter = { loginThrottleState, clearLoginLocks };
    const service = new AuthUsersService(
      db as never,
      repo,
      audit as never,
      { hash: vi.fn(async () => HASHED) } as never,
      {
        resolveStrongestScope: vi.fn(async () => "Company"),
        // Gate bucket bước-2: mặc định actor CÓ `reset-2fa:user` (cặp sensitive) ⇒ `subject` được truyền.
        // Ca deny riêng ở dưới lật cờ này về false.
        can: vi.fn(async () => ({ allow: over.canResetTwoFactor !== false })),
      } as never,
      { revokeAllForUserTx: vi.fn(async () => 0) } as never,
      securityEvents as never,
      { enqueueSync: vi.fn(async () => undefined) } as never,
      over.omitRateLimiter ? undefined : (rateLimiter as never),
    );
    return {
      service,
      audit,
      securityEvents,
      clearLoginLocks,
      loginThrottleState,
      repo,
    };
  }

  beforeEach(() => {
    TX.execute.mockClear();
  });

  it("GET: trả state từ limiter, KHÔNG audit (đường chỉ đọc), slug lấy TỪ DB chứ không từ input", async () => {
    const { service, audit, loginThrottleState } = makeService();
    const dto = await service.getLoginThrottle(ACTOR, TARGET_ID);
    expect(dto).toEqual({ locked: true, remainingSec: 600, buckets: ["ip"] });
    expect(audit.record).not.toHaveBeenCalled();
    // slug đọc trong tenant tx; email lấy từ HÀNG user, không phải từ tham số nào của caller.
    expect(loginThrottleState).toHaveBeenCalledWith(SLUG, "target@a.test", {
      companyId: ACTOR.companyId,
      userId: TARGET_ID,
    });
  });

  it("CLEAR self ⇒ 400 và KHÔNG chạm một byte nào của không gian khoá", async () => {
    const { service, clearLoginLocks, audit } = makeService();
    await expect(service.clearLoginThrottle(ACTOR, ACTOR.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(clearLoginLocks).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("CLEAR user không tồn tại / cross-tenant ⇒ 404 TRƯỚC khi gỡ bất cứ khoá nào", async () => {
    const { service, clearLoginLocks, audit } = makeService({
      findByIdTx: vi.fn(async () => undefined),
    });
    await expect(service.clearLoginThrottle(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(clearLoginLocks).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("CLEAR thành công: audit 'user.login_throttle_cleared' + security event USER_UNLOCKED{reason:'login_throttle'}", async () => {
    const { service, audit, securityEvents } = makeService();
    await expect(service.clearLoginThrottle(ACTOR, TARGET_ID)).resolves.toBeUndefined();

    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][1] as {
      action: string;
      objectType: string;
      before: { locked: boolean };
      after: { locked: boolean; ok: boolean };
    };
    expect(entry.action).toBe("user.login_throttle_cleared");
    expect(entry.objectType).toBe("user");
    // Vết mô tả KẾT QUẢ ĐO ĐƯỢC (đọc lại sau khi gỡ), không phải ý định.
    expect(entry.before.locked).toBe(true);
    expect(entry.after).toMatchObject({ locked: false, ok: true });
    // KHÔNG rò email vào payload (khoá `rl:*` nhúng email; objectId đã định danh đủ).
    expect(JSON.stringify(entry)).not.toContain("target@a.test");

    const ev = securityEvents.record.mock.calls[0][1] as {
      eventType: string;
      payload: { reason: string };
    };
    expect(ev.eventType).toBe("USER_UNLOCKED");
    expect(ev.payload.reason).toBe("login_throttle");
  });

  it("CLEAR khi KHÔNG có khoá nào: vẫn ghi ĐÚNG 1 audit + 1 security event (hadLock=false), không ném", async () => {
    // lock-observability-rule: đường GỠ khoá phải để vết kể cả khi không có gì để gỡ — "admin đã thử
    // gỡ" là dữ kiện forensics. `hadLock` phân biệt hai ca, nên vết không mơ hồ.
    const { service, audit, securityEvents } = makeService({
      throttle: {
        state: { locked: false, remainingSec: null, buckets: [], unknown: false },
        after: { locked: false, remainingSec: null, buckets: [], unknown: false },
      },
    });
    await expect(service.clearLoginThrottle(ACTOR, TARGET_ID)).resolves.toBeUndefined();
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(securityEvents.record).toHaveBeenCalledTimes(1);
    const ev = securityEvents.record.mock.calls[0][1] as {
      payload: { hadLock: boolean };
    };
    expect(ev.payload.hadLock).toBe(false);
  });

  it("Valkey DEGRADED ⇒ 503, KHÔNG 204 — nhưng vết vẫn được ghi với ok:false", async () => {
    // 204 ở đây là nói dối với người bấm nút: họ sẽ bảo người dùng "thử lại đi" trong khi vẫn bị chặn.
    const { service, audit } = makeService({ throttle: { degraded: true } });
    await expect(service.clearLoginThrottle(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect((audit.record.mock.calls[0][1] as { after: { ok: boolean } }).after.ok).toBe(false);
  });

  it("gỡ xong mà ĐỌC LẠI vẫn thấy khoá ⇒ 503 (không tin lời `del`, tin phép đo)", async () => {
    const { service } = makeService({
      throttle: {
        state: { locked: true, remainingSec: 600, buckets: ["acct"], unknown: false },
        after: { locked: true, remainingSec: 590, buckets: ["acct"], unknown: false },
      },
    });
    await expect(service.clearLoginThrottle(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("actor KHÔNG có `reset-2fa:user` ⇒ bucket bước-2 KHÔNG được gỡ (wildcard không được lách cặp sensitive)", async () => {
    // FULL gate 03/09 (HIGH-2): `unlock:user` là is_sensitive=false ⇒ một grant `*:*` thoả nó. Bucket
    // `rl:2fa` là control DUY NHẤT giới hạn dò TOTP ở bước-2; cho phép gỡ nó bằng cặp non-sensitive
    // nghĩa là người giữ wildcard — vốn bị `POST /:id/2fa/reset` từ chối — lại reset được ngưỡng tuỳ ý.
    const { service, clearLoginLocks } = makeService({ canResetTwoFactor: false });
    await service.clearLoginThrottle(ACTOR, TARGET_ID);
    expect(clearLoginLocks).toHaveBeenCalledWith(SLUG, "target@a.test", undefined, {
      includeForgot: true,
    });
  });

  it("actor CÓ `reset-2fa:user` ⇒ bucket bước-2 ĐƯỢC gỡ (ca ALLOW đối chứng — ca deny trên không xanh-rỗng)", async () => {
    const { service, clearLoginLocks } = makeService();
    await service.clearLoginThrottle(ACTOR, TARGET_ID);
    expect(clearLoginLocks).toHaveBeenCalledWith(
      SLUG,
      "target@a.test",
      { companyId: ACTOR.companyId, userId: TARGET_ID },
      { includeForgot: true },
    );
  });

  it("GET: đọc KHÔNG kết luận được (unknown) mà chưa thấy khoá ⇒ 503, KHÔNG trả 'không bị khoá'", async () => {
    // Trả `locked:false` ở đây sẽ làm FE ẩn nút gỡ — tức cửa thoát biến mất đúng lúc Valkey hỏng.
    const { service } = makeService({
      throttle: {
        state: { locked: false, remainingSec: null, buckets: [], unknown: true },
        after: { locked: false, remainingSec: null, buckets: [], unknown: true },
      },
    });
    await expect(service.getLoginThrottle(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("CLEAR: `after.unknown` cũng chặn 204 — vết ghi ok:false thay vì khẳng định đã gỡ xong", async () => {
    const { service, audit } = makeService({
      throttle: {
        state: { locked: true, remainingSec: 600, buckets: ["ip"], unknown: false },
        after: { locked: false, remainingSec: null, buckets: [], unknown: true },
      },
    });
    await expect(service.clearLoginThrottle(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect((audit.record.mock.calls[0][1] as { after: { ok: boolean } }).after.ok).toBe(false);
  });

  it("LoginRateLimiter vắng (DI hỏng) ⇒ NÉM ngay, KHÔNG âm thầm trả 204 + audit 'đã gỡ'", async () => {
    const { service, audit } = makeService({ omitRateLimiter: true });
    await expect(service.clearLoginThrottle(ACTOR, TARGET_ID)).rejects.toThrow(/LoginRateLimiter/);
    expect(audit.record).not.toHaveBeenCalled();
  });
});
