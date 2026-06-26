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
import { PermissionService } from "../../src/permission/permission.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { makeSecurityPolicyService } from "../helpers/security-policy";

// JWT_SECRET phải có TRƯỚC khi TokenService đọc env (constructor).
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

/**
 * G2-6 — luồng auth end-to-end (login/refresh/me/forgot/reset). Postgres thật (CI).
 * Bao deny-path: sai mật khẩu/slug → 401 đồng nhất; rotation; single-use reset; brute-force 429.
 */
describe.skipIf(!hasDb)("G2-6 auth flow", () => {
  const direct = directPool();
  const password = new PasswordService();
  const meta = { ip: "127.0.0.1", userAgent: "vitest" };
  let A: SeededTenant;
  let auth: AuthService;

  const EMAIL = "user@a.test";
  const PASSWORD = "Passw0rd!strong";

  beforeAll(async () => {
    A = await seedCompany(direct, "auth");
    const hash = await password.hash(PASSWORD);
    await seedUser(direct, A.companyId, EMAIL, hash);
    // Mỗi test dựng AuthService mới để rate-limiter sạch.
    auth = newAuth();
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  function newAuth(): AuthService {
    const dbsvc = new DatabaseService();
    const mockPermissions = {
      getCapabilities: async () => ({}),
      getAllowlistedSensitiveCapabilities: async () => ({}),
      getCapabilityScopes: async () => ({}),
    } as unknown as PermissionService;
    const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
    const replayGuard = new ReplayGuardService(new ValkeyService());
    const securityAlerts = new SecurityAlertService(dbsvc, new AuditService());
    const twoFactor = new TwoFactorService(
      dbsvc,
      secrets,
      new TotpService(),
      new TokenService(),
      new AuditService(),
      new LoginRateLimiter(),
      replayGuard,
    );
    return new AuthService(
      dbsvc,
      password,
      new TokenService(),
      new LoginRateLimiter(),
      new AuditService(),
      new OutboxService(),
      mockPermissions,
      secrets,
      twoFactor,
      replayGuard,
      securityAlerts,
      makeSecurityPolicyService(dbsvc),
      { getMyApps: async () => [] } as never,
    );
  }

  /** Login user không bật 2FA → luôn trả AuthTokens; narrow union (challenge = lỗi test setup). */
  function expectTokens(r: LoginResponse): AuthTokens {
    if ("twoFactorRequired" in r) throw new Error("không mong đợi 2FA challenge trong test này");
    return r;
  }

  it("login đúng → trả token; /me trả user KHÔNG có password_hash", async () => {
    const tokens = expectTokens(
      await auth.login({ companySlug: A.slug, email: EMAIL, password: PASSWORD }, meta),
    );
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toContain(`${A.companyId}.`);

    const me = await auth.me(tokens.accessToken);
    expect(me.email).toBe(EMAIL);
    expect(JSON.stringify(me)).not.toContain("password");
    expect((me as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it("sai mật khẩu → 401 đồng nhất (không lộ user tồn tại)", async () => {
    await expect(
      auth.login({ companySlug: A.slug, email: EMAIL, password: "wrong" }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("companySlug sai → 401 đồng nhất (không lộ tenant tồn tại)", async () => {
    await expect(
      auth.login({ companySlug: "no-such-tenant", email: EMAIL, password: PASSWORD }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("/me không token → 401", async () => {
    await expect(auth.me("")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refresh rotation + REUSE-DETECTION: token mới dùng được; reuse token cũ = 401 + thu hồi cả family (FS-1a)", async () => {
    const fresh = newAuth();
    const tokens = expectTokens(
      await fresh.login({ companySlug: A.slug, email: EMAIL, password: PASSWORD }, meta),
    );
    const rotated = await fresh.refresh(tokens.refreshToken); // A → B (A revoked)
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
    // token MỚI (B) dùng được → C (chuỗi rotation hợp lệ tiếp tục, KẾ THỪA family).
    const chained = await fresh.refresh(rotated.refreshToken); // B → C
    expect(chained.accessToken).toBeTruthy();
    // REUSE-DETECTION (FS-1a §7.4): dùng lại token CŨ đã revoke (A) = replay → 401 ĐỒNG NHẤT.
    await expect(fresh.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    // ...và thu hồi CẢ HỌ token → token hợp lệ mới nhất (C) cũng chết (chống replay khi cookie bị lộ).
    await expect(fresh.refresh(chained.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("forgot-password không lộ email tồn tại (email lạ vẫn trả về êm)", async () => {
    const fresh = newAuth();
    await expect(
      fresh.forgotPassword({ companySlug: A.slug, email: "ghost@a.test" }, meta),
    ).resolves.toBeUndefined();
  });

  it("reset-password single-use: token dùng lần 2 → từ chối; mật khẩu mới đăng nhập được", async () => {
    const fresh = newAuth();
    await fresh.forgotPassword({ companySlug: A.slug, email: EMAIL }, meta);
    // Lấy reset token từ outbox payload (consumer mail sẽ dùng cái này).
    const ev = await direct.query(
      `SELECT payload FROM outbox_events
       WHERE company_id = $1 AND event_type = 'auth.password_reset_requested'
       ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    const payload = ev.rows[0].payload as { userId: string; resetTokenEnc: unknown };
    // Mail consumer JIT decrypt (G6-2f): payload mang envelope, không còn plaintext.
    const resetToken = await fresh.decryptResetToken(
      A.companyId,
      payload.resetTokenEnc,
      payload.userId,
    );
    expect(resetToken).toContain(`${A.companyId}.`);

    const NEW_PW = "BrandNewPw!2026";
    await expect(
      fresh.resetPassword({ token: resetToken, newPassword: NEW_PW }),
    ).resolves.toBeUndefined();
    // dùng lại token → từ chối
    await expect(
      fresh.resetPassword({ token: resetToken, newPassword: "another!Pw1" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // mật khẩu mới đăng nhập được
    const logged = expectTokens(
      await newAuth().login({ companySlug: A.slug, email: EMAIL, password: NEW_PW }, meta),
    );
    expect(logged.accessToken).toBeTruthy();
  });

  it("brute-force: quá số lần sai → 429 (TooManyRequests)", async () => {
    const fresh = newAuth();
    for (let i = 0; i < 5; i++) {
      await expect(
        fresh.login({ companySlug: A.slug, email: "brute@a.test", password: "x" }, meta),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    // lần kế tiếp bị khoá
    await expect(
      fresh.login({ companySlug: A.slug, email: "brute@a.test", password: "x" }, meta),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
