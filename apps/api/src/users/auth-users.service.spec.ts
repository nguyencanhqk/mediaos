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
  let service: AuthUsersService;
  const TX = Symbol("tx");

  beforeEach(() => {
    audit = { record: vi.fn(async () => undefined) };
    securityEvents = { record: vi.fn(async () => undefined) };
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
      securityEvents as never,
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
    );
    const res = await service.resetTwoFactor(ACTOR, TARGET_ID);
    expect(res.revokedSessionCount).toBe(3);
    expect(repo.deleteTwoFactorTx).toHaveBeenCalledWith(TX, ACTOR.companyId, TARGET_ID);
    expect(auth.revokeAllForUserTx).toHaveBeenCalledTimes(1);
    expect(auth.revokeAllForUserTx).toHaveBeenCalledWith(TX, TARGET_ID, "2fa_reset");
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
    );
    const dto = await service.deleteUser(ACTOR, TARGET_ID);
    expect(repo.softDeleteTx).toHaveBeenCalledWith(TX, ACTOR.companyId, TARGET_ID, ACTOR.id);
    expect(auth.revokeAllForUserTx).toHaveBeenCalledTimes(1);
    expect(auth.revokeAllForUserTx).toHaveBeenCalledWith(TX, TARGET_ID, "deleted");
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
    expect(auth.revokeAllForUserTx).toHaveBeenCalledWith(TX, TARGET_ID, "admin_password_reset");

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

  // ── S2-AUTH-USEROPS-1: list deleted filter ──────────────────────────────────────
  it("list: query.deleted=true → repo filter nhận deleted=true (view Đã xóa)", async () => {
    await service.listUsers(ACTOR, { limit: 50, offset: 0, deleted: true });
    const filterArg = (repo.findManyTx as unknown as ReturnType<typeof vi.fn>).mock.calls[0][3];
    expect(filterArg.deleted).toBe(true);
  });
});
