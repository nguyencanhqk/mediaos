import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import type { AuthTokens, LoginResponse } from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuthService } from "../../src/auth/auth.service";
import { UsersService } from "../../src/users/users.service";
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
 * Module 2a — self-service tài khoản. Postgres thật (CI). Deny-path TRƯỚC (crown-jewel §6):
 *   changePassword — re-auth bằng mật khẩu hiện tại; sai → 401; mật khẩu mới TRÙNG cũ → 400; thành công
 *   thu hồi MỌI refresh token (mọi phiên chết). updateOwnProfile — chỉ sửa hồ sơ CỦA MÌNH + audit.
 */
describe.skipIf(!hasDb)("Module 2a self-service account", () => {
  const direct = directPool();
  const password = new PasswordService();
  const meta = { ip: "127.0.0.1", userAgent: "vitest" };
  let A: SeededTenant;
  let userId: string;

  const EMAIL = "acct@a.test";
  const PASSWORD = "Passw0rd!strong";

  beforeAll(async () => {
    A = await seedCompany(direct, "acct");
    const hash = await password.hash(PASSWORD);
    userId = await seedUser(direct, A.companyId, EMAIL, hash);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  /** AuthService thật với deps thật + PermissionService mock (mỗi test instance riêng → rate-limiter sạch). */
  function newAuth(): AuthService {
    const dbsvc = new DatabaseService();
    const mockPermissions = { getCapabilities: async () => ({}) } as unknown as PermissionService;
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
    );
  }

  const usersSvc = new UsersService(new DatabaseService(), new AuditService());

  function expectTokens(r: LoginResponse): AuthTokens {
    if ("twoFactorRequired" in r) throw new Error("không mong đợi 2FA challenge trong test này");
    return r;
  }

  it("changePassword: sai mật khẩu hiện tại → 401 (re-auth fail, không đổi)", async () => {
    await expect(
      newAuth().changePassword({ id: userId, companyId: A.companyId }, "wrong-current", "BrandNewPw!1"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("changePassword: mật khẩu mới TRÙNG mật khẩu cũ → 400", async () => {
    await expect(
      newAuth().changePassword({ id: userId, companyId: A.companyId }, PASSWORD, PASSWORD),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("changePassword thành công → đăng nhập bằng mật khẩu MỚI; refresh token CŨ bị thu hồi (mọi phiên chết)", async () => {
    const auth = newAuth();
    // có 1 phiên đang sống (refresh token)
    const tokens = expectTokens(
      await auth.login({ companySlug: A.slug, email: EMAIL, password: PASSWORD }, meta),
    );

    const NEW_PW = "Even-Newer-Pw!2026";
    await expect(
      auth.changePassword({ id: userId, companyId: A.companyId }, PASSWORD, NEW_PW),
    ).resolves.toBeUndefined();

    // phiên cũ chết: refresh token CŨ (đã revoke) → 401 đồng nhất
    await expect(auth.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);

    // mật khẩu MỚI đăng nhập được
    const relog = expectTokens(
      await newAuth().login({ companySlug: A.slug, email: EMAIL, password: NEW_PW }, meta),
    );
    expect(relog.accessToken).toBeTruthy();

    // mật khẩu CŨ KHÔNG còn đăng nhập được
    await expect(
      newAuth().login({ companySlug: A.slug, email: EMAIL, password: PASSWORD }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("updateOwnProfile: đổi full_name của CHÍNH user + ghi audit", async () => {
    await usersSvc.updateOwnProfile({ id: userId, companyId: A.companyId }, "Tên Mới");
    const r = await direct.query("SELECT full_name FROM users WHERE id = $1", [userId]);
    expect(r.rows[0].full_name).toBe("Tên Mới");
    const a = await direct.query(
      "SELECT 1 FROM audit_logs WHERE company_id=$1 AND action='user.profile_updated' AND object_id=$2 LIMIT 1",
      [A.companyId, userId],
    );
    expect(a.rowCount).toBe(1);
  });
});
