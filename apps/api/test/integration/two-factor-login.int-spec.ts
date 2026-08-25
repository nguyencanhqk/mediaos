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
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";
import { makeSecurityPolicyService } from "../helpers/security-policy";

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
    const mockPermissions = {
      getCapabilities: async () => ({}),
      getAllowlistedSensitiveCapabilities: async () => ({}),
      getCapabilityScopes: async () => ({}),
    } as unknown as PermissionService;
    const replayGuard = new ReplayGuardService(new ValkeyService());
    const securityAlerts = new SecurityAlertService(dbsvc, new AuditService());
    const tf = new TwoFactorService(
      dbsvc,
      secrets,
      totp,
      new TokenService(),
      new AuditService(),
      new LoginRateLimiter(),
      replayGuard,
    );
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
      makeSecurityPolicyService(dbsvc),
      { getMyApps: async () => [] } as never,
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
    const res = await auth.login(
      { companySlug: A.slug, email: plainUserEmail, password: PASSWORD },
      meta,
    );
    expect(isChallenge(res)).toBe(false);
    expect((res as AuthTokens).accessToken).toBeTruthy();
  });

  it("user CÓ 2FA: login đúng mật khẩu → challenge (KHÔNG token)", async () => {
    const res = await auth.login(
      { companySlug: A.slug, email: userEmail, password: PASSWORD },
      meta,
    );
    expect(isChallenge(res)).toBe(true);
    expect((res as { challengeToken: string }).challengeToken).toBeTruthy();
  });

  it("DENY: login 2FA sai mật khẩu → 401 (không phát challenge)", async () => {
    await expect(
      auth.login({ companySlug: A.slug, email: userEmail, password: "wrong-pw" }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("completeTwoFactorLogin: challenge + mã TOTP đúng → tokens", async () => {
    const res = await auth.login(
      { companySlug: A.slug, email: userEmail, password: PASSWORD },
      meta,
    );
    if (!isChallenge(res)) throw new Error("mong đợi challenge");
    const tokens = await auth.completeTwoFactorLogin(
      res.challengeToken,
      totp.generate(enrolledSecret),
      meta,
    );
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toContain(`${A.companyId}.`);
  });

  it("DENY: completeTwoFactorLogin mã sai → 401", async () => {
    const res = await auth.login(
      { companySlug: A.slug, email: userEmail, password: PASSWORD },
      meta,
    );
    if (!isChallenge(res)) throw new Error("mong đợi challenge");
    await expect(
      auth.completeTwoFactorLogin(res.challengeToken, "000000", meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("DENY: completeTwoFactorLogin challengeToken rác → 401", async () => {
    await expect(
      auth.completeTwoFactorLogin("garbage.token.x", "123456", meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("/me.mustSetupTwoFactor: admin bị ép 2FA chưa enroll → true; user thường → false", async () => {
    const adminLogin = await auth.login(
      { companySlug: A.slug, email: adminEmail, password: PASSWORD },
      meta,
    );
    // admin chưa enroll 2FA → login ra tokens (chưa bật), nhưng /me báo phải setup.
    if (isChallenge(adminLogin)) throw new Error("admin chưa bật 2FA, không nên challenge");
    const adminMe = await auth.me(adminLogin.accessToken);
    expect(adminMe.mustSetupTwoFactor).toBe(true);

    const plainLogin = await auth.login(
      { companySlug: A.slug, email: plainUserEmail, password: PASSWORD },
      meta,
    );
    if (isChallenge(plainLogin)) throw new Error("plain user không 2FA");
    const plainMe = await auth.me(plainLogin.accessToken);
    expect(plainMe.mustSetupTwoFactor).toBe(false);
  });

  it("rate-limit 2FA: vượt ngưỡng mã sai → 429", async () => {
    const { auth: freshAuth } = make(); // rate-limiter sạch — không dính lỗi tích luỹ từ test khác
    // G16-1b: challengeToken là SINGLE-USE (jti) → MỖI lần thử phải login lại lấy challenge MỚI (đúng hành vi
    // client thực: re-login để retry). Reuse 1 token sẽ bị jti-replay chặn TRƯỚC rate-limit (xem test riêng).
    for (let i = 0; i < 5; i++) {
      const res = await freshAuth.login(
        { companySlug: A.slug, email: userEmail, password: PASSWORD },
        meta,
      );
      if (!isChallenge(res)) throw new Error("mong đợi challenge");
      await expect(
        freshAuth.completeTwoFactorLogin(res.challengeToken, "000000", meta),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const last = await freshAuth.login(
      { companySlug: A.slug, email: userEmail, password: PASSWORD },
      meta,
    );
    if (!isChallenge(last)) throw new Error("mong đợi challenge");
    await expect(
      freshAuth.completeTwoFactorLogin(last.challengeToken, "000000", meta),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("G16-1b jti single-use: replay CÙNG challengeToken (kể cả mã ĐÚNG) → 401 (rejected)", async () => {
    const { auth: freshAuth } = make();
    const res = await freshAuth.login(
      { companySlug: A.slug, email: userEmail, password: PASSWORD },
      meta,
    );
    if (!isChallenge(res)) throw new Error("mong đợi challenge");
    // Lần 1: mã đúng → tokens.
    const tokens = await freshAuth.completeTwoFactorLogin(
      res.challengeToken,
      totp.generate(enrolledSecret),
      meta,
    );
    expect(tokens.accessToken).toBeTruthy();
    // Lần 2: REPLAY cùng challengeToken (dù mã vẫn đúng trong cùng step) → 401 (jti đã tiêu thụ, single-use).
    await expect(
      freshAuth.completeTwoFactorLogin(res.challengeToken, totp.generate(enrolledSecret), meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // ── S10-SEC-LOGINLOG429-1 (KI-047 + KI-048) ───────────────────────────────────────────────────
  //
  // TRƯỚC WO NÀY: `completeTwoFactorLogin` ghi `login_logs` CHỈ khi thành công. Challenge hỏng ·
  // replay · 429 · MÃ SAI · công ty ngừng — cả năm nhánh ghi 0 dòng. Cộng với bước-1 nhánh cấp
  // challenge cũng không ghi ⇒ với tài khoản BẬT 2FA, AUTH-API-401 **chỉ chứa THÀNH CÔNG**: toàn bộ
  // chiến dịch dò mã 6 số vô hình với admin. Bốn ca dưới đây khoá lại điều đó.

  /** Đếm hàng `login_logs` của user hiện tại theo mã lý do — đọc bằng pool direct (bỏ qua RLS). */
  async function countLoginLogs(email: string, reason: string): Promise<number> {
    const { rows } = await direct.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM login_logs
        WHERE company_id = $1 AND normalized_email = $2 AND failure_reason = $3`,
      [A.companyId, email.toLowerCase(), reason],
    );
    return Number(rows[0]?.n ?? "0");
  }

  it("KI-047 · mã TOTP SAI ⇒ +1 hàng login_logs failed/TwoFactorInvalid CÓ company_id + user_id thật", async () => {
    const { auth: freshAuth } = make();
    const before = await countLoginLogs(userEmail, "TwoFactorInvalid");

    const res = await freshAuth.login(
      { companySlug: A.slug, email: userEmail, password: PASSWORD },
      meta,
    );
    if (!isChallenge(res)) throw new Error("mong đợi challenge");
    await expect(
      freshAuth.completeTwoFactorLogin(res.challengeToken, "000000", meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(await countLoginLogs(userEmail, "TwoFactorInvalid")).toBe(before + 1);

    // Hàng phải GẮN ĐÚNG CHỦ — nếu `user_id` NULL thì admin của tenant không lần được về tài khoản
    // nào đang bị dò; nếu `company_id` NULL thì sau mig 0532 KHÔNG tenant nào đọc được hàng đó.
    const { rows } = await direct.query<{ user_id: string | null; login_status: string }>(
      `SELECT user_id, login_status FROM login_logs
        WHERE company_id = $1 AND normalized_email = $2 AND failure_reason = 'TwoFactorInvalid'
        ORDER BY created_at DESC LIMIT 1`,
      [A.companyId, userEmail.toLowerCase()],
    );
    expect(rows[0]?.user_id).toBeTruthy();
    expect(rows[0]?.login_status).toBe("failed");
  });

  it("ĐỐI CHỨNG ALLOW · mã ĐÚNG ⇒ +1 hàng success và KHÔNG hàng TwoFactorInvalid thừa", async () => {
    // Không có vế này thì ca trên xanh RỖNG: một bản vá ghi hàng ở MỌI nhánh cũng làm nó xanh.
    const { auth: freshAuth } = make();
    const beforeBad = await countLoginLogs(userEmail, "TwoFactorInvalid");

    const res = await freshAuth.login(
      { companySlug: A.slug, email: userEmail, password: PASSWORD },
      meta,
    );
    if (!isChallenge(res)) throw new Error("mong đợi challenge");
    const tokens = await freshAuth.completeTwoFactorLogin(
      res.challengeToken,
      totp.generate(enrolledSecret),
      meta,
    );
    expect(tokens.accessToken).toBeTruthy();
    expect(await countLoginLogs(userEmail, "TwoFactorInvalid")).toBe(beforeBad);
  });

  it("KI-047 · REPLAY challengeToken ⇒ +1 hàng TwoFactorChallengeReplay; replay tiếp KHÔNG bồi thêm (gộp theo jti)", async () => {
    const { auth: freshAuth } = make();
    const before = await countLoginLogs(userEmail, "TwoFactorChallengeReplay");

    const res = await freshAuth.login(
      { companySlug: A.slug, email: userEmail, password: PASSWORD },
      meta,
    );
    if (!isChallenge(res)) throw new Error("mong đợi challenge");
    // Tiêu jti một lần cho hợp lệ.
    await freshAuth.completeTwoFactorLogin(res.challengeToken, totp.generate(enrolledSecret), meta);

    // Replay lần 1 ⇒ ghi 1 hàng: "token này đã bị dùng lại" là tín hiệu token bị đánh cắp/chia sẻ.
    await expect(
      freshAuth.completeTwoFactorLogin(res.challengeToken, totp.generate(enrolledSecret), meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await countLoginLogs(userEmail, "TwoFactorChallengeReplay")).toBe(before + 1);

    // Replay lần 2, 3 ⇒ KHÔNG bồi thêm. Replay không tốn argon2 nên ghi trần là bồi VÔ HẠN vào bảng
    // append-only; trần đúng là 1 hàng/token, và đó chính là toàn bộ hạt thông tin muốn có.
    for (let i = 0; i < 2; i++) {
      await expect(
        freshAuth.completeTwoFactorLogin(res.challengeToken, totp.generate(enrolledSecret), meta),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(await countLoginLogs(userEmail, "TwoFactorChallengeReplay")).toBe(before + 1);
  });

  it("KI-047+KI-048 · bucket 2FA đã khoá ⇒ ĐÚNG MỘT hàng blocked/TooManyAttempts cho cả cửa sổ", async () => {
    const { auth: freshAuth } = make();
    const before = await countLoginLogs(userEmail, "TooManyAttempts");

    // 5 lần mã sai dựng nên khoá (mỗi lần cần challenge MỚI vì jti single-use).
    for (let i = 0; i < 5; i++) {
      const r = await freshAuth.login(
        { companySlug: A.slug, email: userEmail, password: PASSWORD },
        meta,
      );
      if (!isChallenge(r)) throw new Error("mong đợi challenge");
      await expect(
        freshAuth.completeTwoFactorLogin(r.challengeToken, "000000", meta),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    // Ba lượt 429 liên tiếp trong CÙNG cửa sổ khoá.
    for (let i = 0; i < 3; i++) {
      const r = await freshAuth.login(
        { companySlug: A.slug, email: userEmail, password: PASSWORD },
        meta,
      );
      if (!isChallenge(r)) throw new Error("mong đợi challenge");
      await expect(
        freshAuth.completeTwoFactorLogin(r.challengeToken, "000000", meta),
      ).rejects.toBeInstanceOf(HttpException);
    }

    // GỘP: +1, không phải +3. Tốc độ sinh hàng ở nhánh đã-khoá do KẺ TẤN CÔNG điều khiển, mà
    // `login_logs` ∈ PROTECTED_TABLES (không bao giờ thu hồi) ⇒ ghi trần là để nó phình vô hạn và
    // chôn mọi tín hiệu khác. Gộp = KHÔNG GHI THÊM (không UPDATE — bảng bị REVOKE UPDATE/DELETE).
    expect(await countLoginLogs(userEmail, "TooManyAttempts")).toBe(before + 1);
  });
});
