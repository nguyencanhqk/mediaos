import { randomUUID } from "node:crypto";
import { BadRequestException, HttpException, UnauthorizedException } from "@nestjs/common";
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
import type { PermissionService } from "../../src/permission/permission.service";
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
 * S2-QA-1-FIX-B — CROWN-JEWEL auth: nhánh self-service CHƯA phủ ở TẦNG SERVICE mà reviewer nêu tên:
 * changePassword() (~L481) + disableTwoFactor() (~L449). Cùng với auth.int-spec.ts (login/refresh/forgot/
 * reset/decryptResetToken), two-factor-login.int-spec.ts (completeTwoFactorLogin / 2FA-challenge),
 * auth-logout/auth-blocked-status (logout terminal + lockout/recordLoginAttempt), suite này kéo
 * auth.service.ts ≥80% statements+branches (DoD §6) DƯỚI LANE_DB — KHÔNG hạ ngưỡng, KHÔNG né gate.
 *
 * KHÔNG viết lại các case đã có (login/refresh/forgot/reset/2FA/logout/blocked) — chỉ phủ MẶT còn thiếu:
 *   • changePassword: re-auth đúng → đổi hash + THU HỒI mọi refresh token sống (mirror resetPassword) + audit;
 *     sai mật khẩu hiện tại → 401, KHÔNG đổi; mật khẩu mới == cũ → 400; rate-limit per-user → 429;
 *     KHÔNG bao giờ lộ plaintext/hash trong audit (BẤT BIẾN #3).
 *   • disableTwoFactor: re-auth đúng → gỡ 2FA; sai mật khẩu → 401; rate-limit → 429.
 *
 * Gate hasDb && LANE_DB (DB cô lập theo lane — KHÔNG chạm DB dev chung 'mediaos').
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)(
  "S2-QA-1 auth self-service coverage (changePassword + disableTwoFactor)",
  () => {
    const direct = directPool();
    const password = new PasswordService();
    const totp = new TotpService();
    const meta = { ip: "127.0.0.1", userAgent: "vitest" };
    let A: SeededTenant;

    const PASSWORD = "Passw0rd!strong";

    beforeAll(async () => {
      A = await seedCompany(direct, "authcov");
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
        totp,
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

    /** Seed 1 user mới (email duy nhất) trong tenant A; trả {id,email}. */
    async function freshUser(label: string): Promise<{ id: string; email: string }> {
      const email = `${label}-${randomUUID().slice(0, 8)}@authcov.test`;
      const hash = await password.hash(PASSWORD);
      const id = await seedUser(direct, A.companyId, email, hash);
      return { id, email };
    }

    // ── changePassword ────────────────────────────────────────────────────────

    it("changePassword: re-auth đúng → đổi hash + thu hồi mọi refresh sống + audit (KHÔNG lộ secret)", async () => {
      const auth = newAuth();
      const u = await freshUser("chpw-ok");
      // 2 phiên sống (2 family) — đổi pass phải thu hồi CẢ HAI.
      const s1 = expectTokens(
        await auth.login({ companySlug: A.slug, email: u.email, password: PASSWORD }, meta),
      );
      const s2 = expectTokens(
        await auth.login({ companySlug: A.slug, email: u.email, password: PASSWORD }, meta),
      );

      const NEW_PW = "ChangedPw!2026";
      await expect(
        auth.changePassword({ id: u.id, companyId: A.companyId }, PASSWORD, NEW_PW),
      ).resolves.toBeUndefined();

      // Cả hai refresh token cũ chết (đổi pass = đăng xuất mọi phiên).
      await expect(auth.refresh(s1.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(auth.refresh(s2.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
      // Mật khẩu MỚI đăng nhập được; mật khẩu cũ thì không.
      const relog = expectTokens(
        await newAuth().login({ companySlug: A.slug, email: u.email, password: NEW_PW }, meta),
      );
      expect(relog.accessToken).toBeTruthy();
      await expect(
        newAuth().login({ companySlug: A.slug, email: u.email, password: PASSWORD }, meta),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // Audit password_changed tồn tại; payload KHÔNG chứa plaintext/hash (BẤT BIẾN #3).
      const res = await direct.query(
        `SELECT action, before, after FROM audit_logs
       WHERE company_id = $1 AND actor_user_id = $2 AND action = 'auth.password_changed'`,
        [A.companyId, u.id],
      );
      expect(res.rows.length).toBeGreaterThanOrEqual(1);
      const dump = JSON.stringify(res.rows);
      expect(dump).not.toContain(NEW_PW);
      expect(dump).not.toContain(PASSWORD);
    });

    it("changePassword: sai mật khẩu HIỆN TẠI → 401, KHÔNG đổi (mật khẩu cũ vẫn đăng nhập được)", async () => {
      const auth = newAuth();
      const u = await freshUser("chpw-bad");
      await expect(
        auth.changePassword({ id: u.id, companyId: A.companyId }, "wrong-current", "Whatever!2026"),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      // Không đổi: mật khẩu cũ vẫn login được.
      const tokens = expectTokens(
        await newAuth().login({ companySlug: A.slug, email: u.email, password: PASSWORD }, meta),
      );
      expect(tokens.accessToken).toBeTruthy();
    });

    it("changePassword: mật khẩu mới == mật khẩu cũ → 400 (chặn no-op, không chạm DB)", async () => {
      const auth = newAuth();
      const u = await freshUser("chpw-same");
      await expect(
        auth.changePassword({ id: u.id, companyId: A.companyId }, PASSWORD, PASSWORD),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("changePassword: rate-limit per-user → 429 sau nhiều lần sai liên tiếp", async () => {
      const auth = newAuth(); // rate-limiter sạch cho user này
      const u = await freshUser("chpw-rl");
      for (let i = 0; i < 5; i++) {
        await expect(
          auth.changePassword({ id: u.id, companyId: A.companyId }, "still-wrong", "NewPw!2026x"),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }
      await expect(
        auth.changePassword({ id: u.id, companyId: A.companyId }, "still-wrong", "NewPw!2026x"),
      ).rejects.toBeInstanceOf(HttpException);
    });

    // ── disableTwoFactor ────────────────────────────────────────────────────────

    it("disableTwoFactor: re-auth đúng → gỡ 2FA (login sau KHÔNG còn challenge)", async () => {
      const auth = newAuth();
      const u = await freshUser("2fa-off");
      // Bật 2FA cho user.
      const dbsvc = new DatabaseService();
      const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
      const twoFactor = new TwoFactorService(
        dbsvc,
        secrets,
        totp,
        new TokenService(),
        new AuditService(),
        new LoginRateLimiter(),
        new ReplayGuardService(new ValkeyService()),
      );
      const { otpauthUri } = await twoFactor.enroll(u.id, A.companyId);
      const secret = new URL(otpauthUri).searchParams.get("secret") ?? "";
      await twoFactor.confirmEnable(u.id, A.companyId, totp.generate(secret));

      // login giờ phải ra challenge (2FA bật).
      const challenge = await auth.login(
        { companySlug: A.slug, email: u.email, password: PASSWORD },
        meta,
      );
      expect("twoFactorRequired" in challenge).toBe(true);

      // disable bằng re-auth mật khẩu đúng → gỡ 2FA.
      await expect(
        auth.disableTwoFactor({ id: u.id, companyId: A.companyId }, PASSWORD),
      ).resolves.toBeUndefined();

      // login giờ ra tokens trực tiếp (2FA đã gỡ).
      const after = expectTokens(
        await newAuth().login({ companySlug: A.slug, email: u.email, password: PASSWORD }, meta),
      );
      expect(after.accessToken).toBeTruthy();
    });

    it("disableTwoFactor: sai mật khẩu → 401 (không gỡ 2FA)", async () => {
      const auth = newAuth();
      const u = await freshUser("2fa-baddpw");
      await expect(
        auth.disableTwoFactor({ id: u.id, companyId: A.companyId }, "wrong-pw"),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("disableTwoFactor: rate-limit per-user → 429 sau nhiều lần sai", async () => {
      const auth = newAuth();
      const u = await freshUser("2fa-rl");
      for (let i = 0; i < 5; i++) {
        await expect(
          auth.disableTwoFactor({ id: u.id, companyId: A.companyId }, "wrong-pw"),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }
      await expect(
        auth.disableTwoFactor({ id: u.id, companyId: A.companyId }, "wrong-pw"),
      ).rejects.toBeInstanceOf(HttpException);
    });
  },
);
