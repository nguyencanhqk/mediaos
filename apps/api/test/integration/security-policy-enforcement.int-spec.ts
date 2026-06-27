/**
 * CS-9 (🔴 CROWN-JEWEL auth) — enforce chính sách IP/giờ ở login + refresh. AuthService THẬT + Postgres
 * (withTenant + RLS). DB cô lập (LANE_DB=mediaos_cs9).
 *
 * DENY-PATH RED: sai IP → 403 ACCESS_RESTRICTED; exempt user qua; ADMIN-ĐANG-SỬA không tự khoá (BẤT BIẾN
 * #4); kill-switch off ⇒ bypass hoàn toàn KHÔNG đọc DB (BẤT BIẾN #5); refresh cũng bị chặn (BẤT BIẾN #2).
 */
import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { AuthTokens, LoginResponse } from "@mediaos/contracts";
import { ACCESS_RESTRICTED_CODE } from "@mediaos/contracts";
import type { Pool } from "pg";
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
import { SecurityPolicyRepository } from "../../src/security-policy/security-policy.repository";
import { SecurityPolicyService } from "../../src/security-policy/security-policy.service";
import { SecurityPolicyEvaluator } from "../../src/security-policy/security-policy-evaluator";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!strong";

function expectTokens(r: LoginResponse): AuthTokens {
  if ("twoFactorRequired" in r) throw new Error("không mong đợi 2FA challenge");
  return r;
}

/** Dựng AuthService + SecurityPolicyService (chia sẻ cùng repo) — enforcement bật/tắt theo enforcement flag. */
function makeAuth(policyEnforcementEnabled: boolean) {
  process.env.SECURITY_POLICY_ENFORCEMENT_ENABLED = policyEnforcementEnabled ? "true" : "false";
  const dbsvc = new DatabaseService();
  const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
  const mockPermissions = { getCapabilities: async () => ({}), getCapabilityScopes: async () => ({}) } as unknown as PermissionService;
  const replayGuard = new ReplayGuardService(new ValkeyService());
  const securityAlerts = new SecurityAlertService(dbsvc, new AuditService());
  const tf = new TwoFactorService(
    dbsvc,
    secrets,
    new TotpService(),
    new TokenService(),
    new AuditService(),
    new LoginRateLimiter(),
    replayGuard,
  );
  // SecurityPolicyService đọc env lúc construct → dựng SAU khi set SECURITY_POLICY_ENFORCEMENT_ENABLED.
  const policyRepo = new SecurityPolicyRepository(dbsvc);
  const policySvc = new SecurityPolicyService(
    dbsvc,
    policyRepo,
    new SecurityPolicyEvaluator(),
    new AuditService(),
  );
  const auth = new AuthService(
    dbsvc,
    new PasswordService(),
    new TokenService(),
    new LoginRateLimiter(),
    new AuditService(),
    new OutboxService(),
    mockPermissions,
    secrets,
    tf,
    replayGuard,
    securityAlerts,
    policySvc,
    { getMyApps: async () => [] } as never,
  );
  return { auth, policySvc };
}

describe.skipIf(!hasDb)("CS-9 login/refresh enforcement (IP/giờ)", () => {
  const direct = directPool();
  const password = new PasswordService();
  let A: SeededTenant;
  let userId: string;
  let adminId: string;
  let email: string;
  let adminEmail: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    A = await seedCompany(direct, "cs9enf");
    companyIds.push(A.companyId);
    const hash = await password.hash(PASSWORD);
    email = `u-${randomUUID().slice(0, 8)}@cs9enf.local`;
    adminEmail = `admin-${randomUUID().slice(0, 8)}@cs9enf.local`;
    userId = await seedUser(direct, A.companyId, email, hash);
    adminId = await seedUser(direct, A.companyId, adminEmail, hash);
  });

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    delete process.env.SECURITY_POLICY_ENFORCEMENT_ENABLED;
  });

  /** Đặt IP allowlist chỉ cho phép 10.0.0.0/8 (qua admin — admin tự được exempt). */
  async function setIpRestriction(svc: SecurityPolicyService) {
    await svc.updatePolicy(
      A.companyId,
      { ipRestrictionEnabled: true, allowlistCidrs: ["10.0.0.0/8"] },
      adminId,
    );
  }

  it("login từ IP NGOÀI allowlist → 403 ACCESS_RESTRICTED", async () => {
    const { auth, policySvc } = makeAuth(true);
    await setIpRestriction(policySvc);
    try {
      await auth.login({ companySlug: A.slug, email, password: PASSWORD }, { ip: "203.0.113.9" });
      throw new Error("đáng lẽ bị chặn");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const resp = (err as HttpException).getResponse() as { code?: string };
      expect((err as HttpException).getStatus()).toBe(403);
      expect(resp.code).toBe(ACCESS_RESTRICTED_CODE);
    }
  });

  it("login từ IP TRONG allowlist → thành công", async () => {
    const { auth, policySvc } = makeAuth(true);
    await setIpRestriction(policySvc);
    const r = await auth.login(
      { companySlug: A.slug, email, password: PASSWORD },
      { ip: "10.1.2.3" },
    );
    expect(expectTokens(r).accessToken).toBeTruthy();
  });

  it("EXEMPT user qua được dù sai IP", async () => {
    const { auth, policySvc } = makeAuth(true);
    // thêm `userId` thường vào exempt-list (admin gọi PATCH).
    await policySvc.updatePolicy(
      A.companyId,
      { ipRestrictionEnabled: true, allowlistCidrs: ["10.0.0.0/8"], exemptUserIds: [userId] },
      adminId,
    );
    const r = await auth.login(
      { companySlug: A.slug, email, password: PASSWORD },
      { ip: "203.0.113.9" },
    );
    expect(expectTokens(r).accessToken).toBeTruthy();
  });

  it("ADMIN-ĐANG-SỬA chính sách KHÔNG tự khoá (auto-exempt — BẤT BIẾN #4)", async () => {
    const { auth, policySvc } = makeAuth(true);
    // Admin set allowlist KHÔNG chứa IP của chính mình; service tự thêm admin vào exempt → admin vẫn login được.
    await policySvc.updatePolicy(
      A.companyId,
      { ipRestrictionEnabled: true, allowlistCidrs: ["10.0.0.0/8"], exemptUserIds: [] },
      adminId,
    );
    const r = await auth.login(
      { companySlug: A.slug, email: adminEmail, password: PASSWORD },
      { ip: "203.0.113.9" },
    );
    expect(expectTokens(r).accessToken).toBeTruthy();
  });

  it("KILL-SWITCH off (SECURITY_POLICY_ENFORCEMENT_ENABLED=false) ⇒ bypass hoàn toàn", async () => {
    const { auth, policySvc } = makeAuth(true);
    await setIpRestriction(policySvc); // bật restriction trong DB
    // dựng lại auth với enforcement TẮT → bỏ qua dù DB có cấu hình chặn.
    const off = makeAuth(false);
    const r = await off.auth.login(
      { companySlug: A.slug, email, password: PASSWORD },
      { ip: "203.0.113.9" },
    );
    expect(expectTokens(r).accessToken).toBeTruthy();
  });

  it("REFRESH từ IP NGOÀI allowlist → 403 ACCESS_RESTRICTED (BẤT BIẾN #2 — check tại điểm cấp token)", async () => {
    // 1) login từ IP hợp lệ để lấy refresh token.
    const ok = makeAuth(true);
    await ok.policySvc.updatePolicy(
      A.companyId,
      { ipRestrictionEnabled: false, allowlistCidrs: [] },
      adminId,
    );
    const tokens = expectTokens(
      await ok.auth.login({ companySlug: A.slug, email, password: PASSWORD }, { ip: "10.1.2.3" }),
    );
    // 2) bật IP-restriction, rồi refresh từ IP ngoài → chặn.
    await ok.policySvc.updatePolicy(
      A.companyId,
      { ipRestrictionEnabled: true, allowlistCidrs: ["10.0.0.0/8"] },
      adminId,
    );
    try {
      await ok.auth.refresh(tokens.refreshToken, { ip: "203.0.113.9" });
      throw new Error("đáng lẽ refresh bị chặn");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(403);
      const resp = (err as HttpException).getResponse() as { code?: string };
      expect(resp.code).toBe(ACCESS_RESTRICTED_CODE);
    }
  });

  it("REFRESH từ IP TRONG allowlist → xoay token thành công", async () => {
    const ok = makeAuth(true);
    await ok.policySvc.updatePolicy(
      A.companyId,
      { ipRestrictionEnabled: false, allowlistCidrs: [] },
      adminId,
    );
    const tokens = expectTokens(
      await ok.auth.login({ companySlug: A.slug, email, password: PASSWORD }, { ip: "10.1.2.3" }),
    );
    await ok.policySvc.updatePolicy(
      A.companyId,
      { ipRestrictionEnabled: true, allowlistCidrs: ["10.0.0.0/8"] },
      adminId,
    );
    const refreshed = await ok.auth.refresh(tokens.refreshToken, { ip: "10.9.9.9" });
    expect(refreshed.accessToken).toBeTruthy();
  });
});
