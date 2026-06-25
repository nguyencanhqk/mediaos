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
 * S2-QA-1 — AUTH-FIX-1 (CROWN-JEWEL): user status KHÔNG-'active' (allow-list fail-closed) đăng nhập ĐÚNG
 * mật khẩu → CHẶN cấp token. Phủ nhánh chưa có ở các spec khác (chỉ phủ wrong-password/unknown/2FA).
 *
 * Nghiệm thu:
 *  - status != 'active' (suspended/invited/…) + mật khẩu ĐÚNG → UnauthorizedException (401 ĐỒNG NHẤT,
 *    y hệt sai-mật-khẩu — anti status-probing). KHÔNG cấp token (refresh_tokens 0 row mới).
 *  - login_logs có row login_status='blocked' + failure_reason='Inactive' (reason CHỈ ở DB row).
 *  - KHÔNG có chuỗi password / token / base_salary trong payload audit_logs hoặc login_logs (BẤT BIẾN #3).
 *  - active vẫn login bình thường (sanity — đảm bảo block do status, không phải lỗi seed).
 *
 * Gate hasDb && LANE_DB (DB cô lập). users.status CHECK = ('active','invited','suspended') (mig 0002) —
 * 'invited' cũng KHÔNG-active ⇒ cùng nhánh blocked (allow-list, KHÔNG deny-list).
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("S2-QA-1 blocked status login (allow-list fail-closed)", () => {
  const direct = directPool();
  const password = new PasswordService();
  const meta = { ip: "127.0.0.1", userAgent: "vitest" };
  let A: SeededTenant;

  const PASSWORD = "Passw0rd!strong";
  const SUSPENDED_EMAIL = "suspended@a.test";
  const INVITED_EMAIL = "invited@a.test";
  const ACTIVE_EMAIL = "active@a.test";
  let suspendedUserId: string;
  let invitedUserId: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "blocked");
    const hash = await password.hash(PASSWORD);
    // 3 user CÙNG tenant, KHÁC status (seed mật khẩu ĐÚNG cho cả 3 — chặn phải do status).
    suspendedUserId = await seedUser(direct, A.companyId, SUSPENDED_EMAIL, hash);
    invitedUserId = await seedUser(direct, A.companyId, INVITED_EMAIL, hash);
    await seedUser(direct, A.companyId, ACTIVE_EMAIL, hash);
    await direct.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [suspendedUserId]);
    await direct.query(`UPDATE users SET status = 'invited' WHERE id = $1`, [invitedUserId]);
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

  async function loginLogRows(email: string, status?: string) {
    const res = await direct.query(
      `SELECT login_status, failure_reason, user_id, company_id
       FROM login_logs WHERE normalized_email = $1 ${status ? "AND login_status = $2" : ""}
       ORDER BY created_at DESC`,
      status ? [email.toLowerCase(), status] : [email.toLowerCase()],
    );
    return res.rows as Array<{
      login_status: string;
      failure_reason: string | null;
      user_id: string | null;
      company_id: string | null;
    }>;
  }

  async function refreshTokenCount(userId: string): Promise<number> {
    const res = await direct.query(
      `SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1`,
      [userId],
    );
    return res.rows[0].n as number;
  }

  it("status='suspended' + mật khẩu ĐÚNG → 401 ĐỒNG NHẤT + KHÔNG cấp token", async () => {
    const auth = newAuth();
    const before = await refreshTokenCount(suspendedUserId);
    let raised: unknown;
    try {
      await auth.login({ companySlug: A.slug, email: SUSPENDED_EMAIL, password: PASSWORD }, meta);
    } catch (e) {
      raised = e;
    }
    expect(raised).toBeInstanceOf(UnauthorizedException);
    // 401 ĐỒNG NHẤT: body lỗi KHÔNG chứa lý do thật ('suspended'/'Inactive' — anti status-probing).
    const msg = (raised as UnauthorizedException).message;
    expect(msg).not.toContain("suspend");
    expect(msg).not.toContain("Inactive");
    expect(msg).not.toContain("active");
    // KHÔNG cấp refresh token (login bị chặn TRƯỚC issueTokens).
    expect(await refreshTokenCount(suspendedUserId)).toBe(before);
  });

  it("status='suspended' → login_logs row blocked + failure_reason='Inactive' (gắn đúng tenant + user)", async () => {
    const rows = await loginLogRows(SUSPENDED_EMAIL, "blocked");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].failure_reason).toBe("Inactive");
    expect(rows[0].company_id).toBe(A.companyId);
    expect(rows[0].user_id).toBe(suspendedUserId);
  });

  it("status='invited' (KHÔNG-active) + mật khẩu ĐÚNG → cũng 401 blocked/Inactive (allow-list, KHÔNG deny-list)", async () => {
    const auth = newAuth();
    const before = await refreshTokenCount(invitedUserId);
    await expect(
      auth.login({ companySlug: A.slug, email: INVITED_EMAIL, password: PASSWORD }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await refreshTokenCount(invitedUserId)).toBe(before);

    const rows = await loginLogRows(INVITED_EMAIL, "blocked");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].failure_reason).toBe("Inactive");
  });

  it("KHÔNG-secret-log: payload audit_logs + login_logs của nhánh blocked KHÔNG chứa password/token/base_salary", async () => {
    // audit: chỉ row của tenant này (after.reason='suspended' là cờ nội bộ, KHÔNG phải secret) — nhưng
    // TUYỆT ĐỐI không được lọt giá trị mật khẩu / refresh token / base_salary vào audit hoặc login_logs.
    const audit = await direct.query(
      `SELECT action, before, after FROM audit_logs
       WHERE company_id = $1 AND action = 'auth.login_blocked'`,
      [A.companyId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
    const auditBlob = JSON.stringify(audit.rows);
    expect(auditBlob).not.toContain(PASSWORD);
    expect(auditBlob).not.toContain("base_salary");
    expect(auditBlob).not.toContain("baseSalary");
    expect(auditBlob.toLowerCase()).not.toContain("password");
    expect(auditBlob.toLowerCase()).not.toContain("refreshtoken");

    const logs = await direct.query(
      `SELECT login_status, failure_reason, ip_address, user_agent FROM login_logs
       WHERE company_id = $1 AND login_status = 'blocked'`,
      [A.companyId],
    );
    const logsBlob = JSON.stringify(logs.rows);
    expect(logsBlob).not.toContain(PASSWORD);
    expect(logsBlob).not.toContain("base_salary");
    expect(logsBlob.toLowerCase()).not.toContain("password");
    expect(logsBlob.toLowerCase()).not.toContain("token");
  });

  it("sanity: cùng tenant, user status='active' + mật khẩu ĐÚNG → login THÀNH CÔNG (chặn do status, không do seed)", async () => {
    const auth = newAuth();
    const tokens = expectTokens(
      await auth.login({ companySlug: A.slug, email: ACTIVE_EMAIL, password: PASSWORD }, meta),
    );
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toContain(`${A.companyId}.`);
  });
});
