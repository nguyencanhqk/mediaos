/**
 * CS-9 (🔴 CROWN-JEWEL) — 2FA fail-STRICTER qua TwoFactorEnforcementGuard THẬT + Postgres (policy DB).
 * DB cô lập (LANE_DB=mediaos_cs9).
 *
 * Chứng minh: global OFF + company `two_factor_enforced=true` ⇒ ÉP 2FA cho user công ty (DENY khi chưa
 * enroll) — tenant NÂNG chuẩn. company KHÔNG hạ được sàn global (đã phủ ở unit-spec 4-combo). BẤT BIẾN #1.
 */
import "reflect-metadata";

// Guard cache TWO_FACTOR_ENFORCEMENT_ENABLED lúc construct → set TRƯỚC import guard. global OFF cho file này.
process.env.TWO_FACTOR_ENFORCEMENT_ENABLED = "false";
process.env.SECURITY_POLICY_ENFORCEMENT_ENABLED = "true";

import { randomUUID } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { ReplayGuardService } from "../../src/auth/replay-guard.service";
import { TokenService } from "../../src/auth/token.service";
import { TotpService } from "../../src/auth/totp.service";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import { TwoFactorEnforcementGuard } from "../../src/auth/two-factor-enforcement.guard";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { ValkeyService } from "../../src/permission/valkey.service";
import { SecurityPolicyRepository } from "../../src/security-policy/security-policy.repository";
import { SecurityPolicyService } from "../../src/security-policy/security-policy.service";
import { SecurityPolicyEvaluator } from "../../src/security-policy/security-policy-evaluator";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

function httpCtx(user: { id: string; companyId: string }): ExecutionContext {
  return {
    getType: () => "http",
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe.skipIf(!hasDb)("CS-9 2FA fail-stricter (global OFF + company ON, guard + DB)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let plainUser: string; // user KHÔNG có role requires_two_factor
  let admin: string;
  const companyIds: string[] = [];

  let dbsvc: DatabaseService;
  let guard: TwoFactorEnforcementGuard;
  let policySvc: SecurityPolicyService;

  beforeAll(async () => {
    A = await seedCompany(direct, "cs92fa");
    companyIds.push(A.companyId);
    plainUser = await seedUser(direct, A.companyId, `plain-${randomUUID().slice(0, 8)}@cs92fa.local`);
    admin = await seedUser(direct, A.companyId, `adm-${randomUUID().slice(0, 8)}@cs92fa.local`);

    dbsvc = new DatabaseService();
    const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
    const replayGuard = new ReplayGuardService(new ValkeyService());
    const twoFactor = new TwoFactorService(
      dbsvc, secrets, new TotpService(), new TokenService(), new AuditService(), new LoginRateLimiter(), replayGuard,
    );
    policySvc = new SecurityPolicyService(
      dbsvc, new SecurityPolicyRepository(dbsvc), new SecurityPolicyEvaluator(), new AuditService(),
    );
    guard = new TwoFactorEnforcementGuard(new Reflector(), twoFactor, dbsvc, policySvc);
  });

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    delete process.env.TWO_FACTOR_ENFORCEMENT_ENABLED;
    delete process.env.SECURITY_POLICY_ENFORCEMENT_ENABLED;
  });

  it("company CHƯA bật → user thường KHÔNG bị ép (global OFF) → pass", async () => {
    // KHÔNG cấu hình policy cho A → getEffectiveTwoFactorRequired(false) = false.
    expect(await guard.canActivate(httpCtx({ id: plainUser, companyId: A.companyId }))).toBe(true);
  });

  it("company BẬT two_factor_enforced=true → user thường (chưa enroll) bị DENY (NÂNG chuẩn)", async () => {
    await policySvc.updatePolicy(A.companyId, { twoFactorEnforced: true }, admin);
    // Cache guard 30s — dùng companyId MỚI để tránh cache hit từ test trước (test trước companyId KHÁC? cùng A).
    // companyId giống nhau ⇒ phải vượt cache: tạo guard MỚI để đọc lại policy (cache theo instance).
    const freshTwoFactor = new TwoFactorService(
      dbsvc,
      new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider()),
      new TotpService(),
      new TokenService(),
      new AuditService(),
      new LoginRateLimiter(),
      new ReplayGuardService(new ValkeyService()),
    );
    const freshGuard = new TwoFactorEnforcementGuard(new Reflector(), freshTwoFactor, dbsvc, policySvc);
    await expect(
      freshGuard.canActivate(httpCtx({ id: plainUser, companyId: A.companyId })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
