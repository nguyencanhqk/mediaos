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
import { PermissionRepository } from "../../src/permission/permission.repository";
import type { ModuleCatalogService } from "../../src/foundation/module-catalog/module-catalog.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";
import { makeSecurityPolicyService } from "../helpers/security-policy";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

/**
 * S2-AUTH-BE-1 — RED-first: GET /auth/me bootstrap (roles/permissions/scopes/employee/modules) +
 * login_logs writes (success/failed/blocked + failure_reason) + failed_login_count. Postgres thật.
 * BẤT BIẾN #3: KHÔNG rò password_hash / base_salary / token.
 */
describe.skipIf(!hasDb)("S2-AUTH-BE-1 /auth/me bootstrap + login_logs", () => {
  const direct = directPool();
  const password = new PasswordService();
  const meta = { ip: "127.0.0.1", userAgent: "vitest" };
  let A: SeededTenant;
  let userId: string;
  let auth: AuthService;

  const EMAIL = "bootstrap@a.test";
  const PASSWORD = "Passw0rd!strong";
  const MODULES = [{ module_code: "DASH", name: "Dashboard" }];

  beforeAll(async () => {
    A = await seedCompany(direct, "mebootstrap");
    const hash = await password.hash(PASSWORD);
    userId = await seedUser(direct, A.companyId, EMAIL, hash);
    // role + 1 ALLOW non-sensitive permission với data_scope='Own' (cho roles[]/scopes[]).
    const roleId = await seedRole(direct, A.companyId, "employee-bootstrap");
    const permId = await seedPermissionCatalog(direct, "view", "employee", false);
    await seedRolePermission(direct, roleId, permId, "ALLOW", "Own");
    await seedUserRole(direct, userId, roleId, A.companyId);
    auth = newAuth();
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  function newAuth(): AuthService {
    const dbsvc = new DatabaseService();
    const permissions = new PermissionService(new PermissionRepository(dbsvc));
    const modules = {
      getMyApps: async () => MODULES,
    } as unknown as ModuleCatalogService;
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
      permissions,
      secrets,
      twoFactor,
      replayGuard,
      securityAlerts,
      makeSecurityPolicyService(dbsvc),
      modules,
    );
  }

  function expectTokens(r: LoginResponse): AuthTokens {
    if ("twoFactorRequired" in r) throw new Error("không mong đợi 2FA challenge");
    return r;
  }

  async function loginLogRows(status?: string) {
    const res = await direct.query(
      `SELECT login_status, failure_reason, user_id, normalized_email, company_id
       FROM login_logs WHERE normalized_email = $1 ${status ? "AND login_status = $2" : ""}
       ORDER BY created_at DESC`,
      status ? [EMAIL.toLowerCase(), status] : [EMAIL.toLowerCase()],
    );
    return res.rows as Array<{
      login_status: string;
      failure_reason: string | null;
      user_id: string | null;
      normalized_email: string;
      company_id: string | null;
    }>;
  }

  async function failedLoginCount(): Promise<number> {
    const res = await direct.query(`SELECT failed_login_count FROM users WHERE id = $1`, [userId]);
    return Number(res.rows[0].failed_login_count);
  }

  it("login đúng → login_logs success + reset failed_login_count = 0", async () => {
    const tokens = expectTokens(
      await auth.login({ companySlug: A.slug, email: EMAIL, password: PASSWORD }, meta),
    );
    expect(tokens.accessToken).toBeTruthy();

    const rows = await loginLogRows("success");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].company_id).toBe(A.companyId);
    expect(rows[0].user_id).toBe(userId);
    expect(await failedLoginCount()).toBe(0);
  });

  it("sai mật khẩu → login_logs failed (WrongPassword) + failed_login_count tăng; 401 đồng nhất", async () => {
    const before = await failedLoginCount();
    await expect(
      auth.login({ companySlug: A.slug, email: EMAIL, password: "wrong-pass" }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const rows = await loginLogRows("failed");
    expect(rows.some((r) => r.failure_reason === "WrongPassword")).toBe(true);
    expect(await failedLoginCount()).toBe(before + 1);
  });

  it("email không tồn tại → login_logs failed (UserNotFound), KHÔNG lộ user, company_id gắn tenant", async () => {
    await expect(
      auth.login({ companySlug: A.slug, email: "ghost@a.test", password: PASSWORD }, meta),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const res = await direct.query(
      `SELECT login_status, failure_reason FROM login_logs WHERE normalized_email = $1 ORDER BY created_at DESC LIMIT 1`,
      ["ghost@a.test"],
    );
    expect(res.rows[0]?.login_status).toBe("failed");
    expect(res.rows[0]?.failure_reason).toBe("UserNotFound");
  });

  it("/auth/me trả bootstrap: roles[], scopes[] (data_scope), capabilities, company, modules; employee=null", async () => {
    const tokens = expectTokens(
      await auth.login({ companySlug: A.slug, email: EMAIL, password: PASSWORD }, meta),
    );
    const me = await auth.me(tokens.accessToken);

    expect(me.email).toBe(EMAIL);
    // company
    expect(me.company?.id).toBe(A.companyId);
    // roles
    expect(me.roles?.some((r) => r.name === "employee-bootstrap")).toBe(true);
    // capabilities + scopes keyed identically
    expect(me.capabilities["view:employee"]).toBe(true);
    expect(me.scopes?.["view:employee"]).toEqual(["Own"]);
    // modules reuse getMyApps
    expect(me.modules).toEqual([{ code: "DASH", name: "Dashboard" }]);
    // employee mapping null (no employee_profiles row seeded)
    expect(me.employee ?? null).toBeNull();
  });

  it("/auth/me KHÔNG rò password_hash / base_salary / token", async () => {
    const tokens = expectTokens(
      await auth.login({ companySlug: A.slug, email: EMAIL, password: PASSWORD }, meta),
    );
    const me = await auth.me(tokens.accessToken);
    const blob = JSON.stringify(me);
    expect(blob).not.toContain("password");
    expect(blob).not.toContain("base_salary");
    expect(blob).not.toContain("baseSalary");
    expect((me as Record<string, unknown>).passwordHash).toBeUndefined();
  });
});
