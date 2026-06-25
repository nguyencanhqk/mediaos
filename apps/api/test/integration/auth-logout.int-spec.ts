import { UnauthorizedException } from "@nestjs/common";
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
import { PermissionService } from "../../src/permission/permission.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { makeSecurityPolicyService } from "../helpers/security-policy";

// JWT_SECRET phải có TRƯỚC khi TokenService đọc env (constructor).
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

/**
 * S2-QA-1 — CROWN-JEWEL auth: nhánh CHƯA phủ ở TẦNG SERVICE cho logout() TERMINAL (FS-1a §7.4).
 *
 * `auth-session.int-spec.ts` đã phủ logout qua HTTP (cookie/body, CSRF, forced-logout idempotent). Đây phủ
 * mặt SERVICE còn thiếu: sau logout(refreshToken) thì refresh() bằng CHÍNH token đó VÀ bằng token kế-thừa
 * CÙNG FAMILY (đã xoay) đều = 401 (family bị thu hồi terminal) + có audit row action='auth.logout'
 * (after.scope='family'). Logout idempotent với token rác/đã chết (KHÔNG thu hồi family — chống forced-logout).
 *
 * Gate hasDb && LANE_DB (DB cô lập theo lane — KHÔNG chạm DB dev chung 'mediaos').
 * KHÔNG viết lại: refresh reuse-detection (auth.int-spec.ts), HTTP logout/CSRF (auth-session.int-spec.ts).
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("S2-QA-1 logout terminal family revoke (service)", () => {
  const direct = directPool();
  const password = new PasswordService();
  const meta = { ip: "127.0.0.1", userAgent: "vitest" };
  let A: SeededTenant;
  let userId: string;

  const EMAIL = "logout@a.test";
  const PASSWORD = "Passw0rd!strong";

  beforeAll(async () => {
    A = await seedCompany(direct, "logout");
    const hash = await password.hash(PASSWORD);
    userId = await seedUser(direct, A.companyId, EMAIL, hash);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  function newAuth(): AuthService {
    const dbsvc = new DatabaseService();
    const mockPermissions = {
      getCapabilities: async () => ({}),
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

  function expectTokens(r: LoginResponse): AuthTokens {
    if ("twoFactorRequired" in r) throw new Error("không mong đợi 2FA challenge trong test này");
    return r;
  }

  /** Đếm audit row auth.logout (after.scope='family') của user trong tenant — append-only, qua direct. */
  async function logoutAuditRows() {
    const res = await direct.query(
      `SELECT action, after FROM audit_logs
       WHERE company_id = $1 AND actor_user_id = $2 AND action = 'auth.logout'
       ORDER BY created_at DESC`,
      [A.companyId, userId],
    );
    return res.rows as Array<{ action: string; after: { scope?: string } | null }>;
  }

  it("logout(refreshToken) → refresh CHÍNH token đó sau đó = 401 (family thu hồi terminal) + audit auth.logout", async () => {
    const auth = newAuth();
    const tokens = expectTokens(
      await auth.login({ companySlug: A.slug, email: EMAIL, password: PASSWORD }, meta),
    );

    await auth.logout(tokens.refreshToken);

    // refresh bằng token vừa logout → 401 ĐỒNG NHẤT (token đã revoke trong family).
    await expect(auth.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);

    // Audit: có ÍT NHẤT 1 row auth.logout scope=family cho user này.
    const rows = await logoutAuditRows();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].after?.scope).toBe("family");
  });

  it("logout thu hồi CẢ HỌ: token kế-thừa family (đã xoay) cũng = 401 sau logout", async () => {
    const auth = newAuth();
    const tokens = expectTokens(
      await auth.login({ companySlug: A.slug, email: EMAIL, password: PASSWORD }, meta),
    );
    // Xoay A → B (cùng family). B còn sống, A revoked.
    const rotated = await auth.refresh(tokens.refreshToken);
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);

    // logout bằng token CÒN SỐNG (B) → thu hồi cả family.
    await auth.logout(rotated.refreshToken);

    // B (token logout) chết.
    await expect(auth.refresh(rotated.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    // A (đã xoay) reuse-detection cũng 401 (family đã thu hồi → không cấp lại được).
    await expect(auth.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("logout idempotent với token ĐÃ CHẾT (đã xoay/revoke) → KHÔNG thu hồi family sống (chống forced-logout)", async () => {
    const auth = newAuth();
    const tokens = expectTokens(
      await auth.login({ companySlug: A.slug, email: EMAIL, password: PASSWORD }, meta),
    );
    // A → B (A revoked). Kẻ tấn công giữ A (đã chết) gọi logout — KHÔNG được force-logout nạn nhân.
    const rotated = await auth.refresh(tokens.refreshToken);
    await expect(auth.logout(tokens.refreshToken)).resolves.toBeUndefined();
    // Token sống B VẪN refresh được (family chưa bị thu hồi bởi token chết).
    const chained = await auth.refresh(rotated.refreshToken);
    expect(chained.accessToken).toBeTruthy();
  });

  it("logout token RÁC (sai định dạng) → void êm, KHÔNG ném (idempotent)", async () => {
    const auth = newAuth();
    await expect(auth.logout("not-a-scoped-token")).resolves.toBeUndefined();
    await expect(auth.logout("")).resolves.toBeUndefined();
  });
});
