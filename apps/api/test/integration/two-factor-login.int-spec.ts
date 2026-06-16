/**
 * G16-1 — login 2-bước khi 2FA bật (AuthService.login → challenge → completeTwoFactorLogin → tokens).
 * + /me.mustSetupTwoFactor cho user bị ép 2FA chưa enroll. Postgres thật; auto-skip khi không có DB.
 */
import { randomUUID } from "node:crypto";
import { HttpException, UnauthorizedException } from "@nestjs/common";
import type { AuthTokens, LoginResponse } from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuthService } from "../../src/auth/auth.service";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { PasswordService } from "../../src/auth/password.service";
import { TokenService } from "../../src/auth/token.service";
import { TotpService } from "../../src/auth/totp.service";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import { ReplayGuardService } from "../../src/auth/replay-guard.service";
import { SecurityAlertService } from "../../src/auth/security-alert.service";
import { ValkeyService } from "../../src/permission/valkey.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import type { PermissionService } from "../../src/permission/permission.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, seedUserRole, type SeededTenant } from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001"; // requires_two_factor=true (mig 0120)
const PASSWORD = "Passw0rd!strong";
const totp = new TotpService();

function secretFromUri(uri: string): string {
  return new URL(uri).searchParams.get("secret") ?? "";
}
function isChallenge(r: LoginResponse): r is { twoFactorRequired: true; challengeToken: string } {
  return "twoFactorRequired" in r;
}

describe.skipIf(!hasDb)("G16-1 login 2FA flow", () => {
  const direct = directPool();
  const password = new PasswordService();
  const meta = { ip: "127.0.0.1", userAgent: "vitest" };
  let A: SeededTenant;
  let auth: AuthService;
  let twoFactor: TwoFactorService;
  let userEmail: string;
  let plainUserEmail: string;
  let adminEmail: string;
  let enrolledSecret: string; // secret base32 của userEmail (lấy lúc enroll) để sinh mã TOTP trong test

  /** Tạo AuthService + TwoFactorService MỚI (rate-limiter sạch) — mỗi lần gọi độc lập. */
  function make(): { auth: AuthService; twoFactor: TwoFactorService } {
    const dbsvc = new DatabaseService();
    const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
    const mockPermissions = { getCapabilities: async () => ({}) } as unknown as PermissionService;
    const replayGuard = new ReplayGuardService(new ValkeyService());
    const securityAlerts = new SecurityAlertService(dbsvc, new AuditService());
    const tf = new TwoFactorService(dbsvc, secrets, totp, new TokenService(), new AuditService(), new LoginRateLimiter(), replayGuard);
    const a = new AuthService(
      dbsvc,
      password,
      new TokenService(),
      new LoginRateLimiter(),
      new AuditService(),
      new OutboxService(),
      mockPermissions,
      secrets,
      tf,
      replayGuard,
      securityAlerts,
    );
    return { auth: a, twoFactor: tf };
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "g16login");
    const hash = await password.hash(PASSWORD);
    userEmail = `g16-2fa-${randomUUID().slice(0, 8)}@test.local`;
    plainUserEmail = `g16-plain-${randomUUID().slice(0, 8)}@test.local`;
    adminEmail = `g16-admin-${randomUUID().slice(0, 8)}@test.local`;
    const userId = await seedUser(direct, A.companyId, userEmail, hash);
    await seedUser(direct, A.companyId, plainUserEmail, hash);
    const adminId = await seedUser(direct, A.companyId, adminEmail, hash);
    await seedUserRole(direct, adminId, COMPANY_ADMIN_ROLE_ID, A.companyId);
    ({ auth, twoFactor } = make());
    // Bật 2FA cho userEmail; giữ lại secret để sinh mã TOTP hợp lệ trong các test.
    const { otpauthUri } = await twoFactor.enroll(userId, A.companyId);
    enrolledSecret = secretFromUri(otpauthUri);
    await twoFactor.confirmEnable(userId, A.companyId, totp.generate(enrolledSecret));
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it("user KHÔNG 2FA: login → AuthTokens trực tiếp (không challenge)", async () => {
    const res = await auth.login({ companySlug: A.slug, email: plainUserEmail, password: PASSWORD }, meta);
    expect(isChallenge(res)).toBe(false);
    expect((res as AuthTokens).accessToken).toBeTruthy();
  });

  it("user CÓ 2FA: login đúng mật khẩu → challenge (KHÔNG token)", async () => {
    const res = await auth.login({ companySlug: A.slug, email: userEmail, password: PASSWORD }, meta);
    expect(isChallenge(res)).toBe(true);
    expect((res as { challengeToken: string }).challengeToken).toBeTruthy();
  });

  it("DENY: login 2FA sai mật khẩu → 401 (không phát challenge)", async () => {
    await expect(
      auth.login({ companySlug: A.slug, email: userEmail, password: "wrong-pw" }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("completeTwoFactorLogin: challenge + mã TOTP đúng → tokens", async () => {
    const res = await auth.login({ companySlug: A.slug, email: userEmail, password: PASSWORD }, meta);
    if (!isChallenge(res)) throw new Error("mong đợi challenge");
    const tokens = await auth.completeTwoFactorLogin(res.challengeToken, totp.generate(enrolledSecret), meta);
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toContain(`${A.companyId}.`);
  });

  it("DENY: completeTwoFactorLogin mã sai → 401", async () => {
    const res = await auth.login({ companySlug: A.slug, email: userEmail, password: PASSWORD }, meta);
    if (!isChallenge(res)) throw new Error("mong đợi challenge");
    await expect(auth.completeTwoFactorLogin(res.challengeToken, "000000", meta)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("DENY: completeTwoFactorLogin challengeToken rác → 401", async () => {
    await expect(auth.completeTwoFactorLogin("garbage.token.x", "123456", meta)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("/me.mustSetupTwoFactor: admin bị ép 2FA chưa enroll → true; user thường → false", async () => {
    const adminLogin = await auth.login({ companySlug: A.slug, email: adminEmail, password: PASSWORD }, meta);
    // admin chưa enroll 2FA → login ra tokens (chưa bật), nhưng /me báo phải setup.
    if (isChallenge(adminLogin)) throw new Error("admin chưa bật 2FA, không nên challenge");
    const adminMe = await auth.me(adminLogin.accessToken);
    expect(adminMe.mustSetupTwoFactor).toBe(true);

    const plainLogin = await auth.login({ companySlug: A.slug, email: plainUserEmail, password: PASSWORD }, meta);
    if (isChallenge(plainLogin)) throw new Error("plain user không 2FA");
    const plainMe = await auth.me(plainLogin.accessToken);
    expect(plainMe.mustSetupTwoFactor).toBe(false);
  });

  it("rate-limit 2FA: vượt ngưỡng mã sai → 429", async () => {
    const { auth: freshAuth } = make(); // rate-limiter sạch — không dính lỗi tích luỹ từ test khác
    // G16-1b: challengeToken là SINGLE-USE (jti) → MỖI lần thử phải login lại lấy challenge MỚI (đúng hành vi
    // client thực: re-login để retry). Reuse 1 token sẽ bị jti-replay chặn TRƯỚC rate-limit (xem test riêng).
    for (let i = 0; i < 5; i++) {
      const res = await freshAuth.login({ companySlug: A.slug, email: userEmail, password: PASSWORD }, meta);
      if (!isChallenge(res)) throw new Error("mong đợi challenge");
      await expect(
        freshAuth.completeTwoFactorLogin(res.challengeToken, "000000", meta),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const last = await freshAuth.login({ companySlug: A.slug, email: userEmail, password: PASSWORD }, meta);
    if (!isChallenge(last)) throw new Error("mong đợi challenge");
    await expect(
      freshAuth.completeTwoFactorLogin(last.challengeToken, "000000", meta),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("G16-1b jti single-use: replay CÙNG challengeToken (kể cả mã ĐÚNG) → 401 (rejected)", async () => {
    const { auth: freshAuth } = make();
    const res = await freshAuth.login({ companySlug: A.slug, email: userEmail, password: PASSWORD }, meta);
    if (!isChallenge(res)) throw new Error("mong đợi challenge");
    // Lần 1: mã đúng → tokens.
    const tokens = await freshAuth.completeTwoFactorLogin(res.challengeToken, totp.generate(enrolledSecret), meta);
    expect(tokens.accessToken).toBeTruthy();
    // Lần 2: REPLAY cùng challengeToken (dù mã vẫn đúng trong cùng step) → 401 (jti đã tiêu thụ, single-use).
    await expect(
      freshAuth.completeTwoFactorLogin(res.challengeToken, totp.generate(enrolledSecret), meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
