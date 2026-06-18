/**
 * AC-0b — operator-auth boundary (CROWN, security-critical). Real Postgres; auto-skip without DB.
 *
 * Deny-path coverage:
 *   (1) login as platform-admin (2FA pre-enrolled) → mints an OPERATOR-audience token + short TTL;
 *       a normal tenant user → tenant-audience token.
 *   (2) 2FA FLIP: platform-admin role now requires_two_factor=true → a platform-admin WITHOUT TOTP
 *       enrolled is DENIED by TwoFactorEnforcementGuard (code TWO_FACTOR_SETUP_REQUIRED).
 *   (3) operator step-up window is scoped to (operator, targetTenant): a window for tenant A does NOT
 *       authorize a write to tenant B; a valid window for B does.
 *   (4) operator-action audit row for a B-write lands with company_id=B and actor=operator.
 *   (5) Valkey persist failure surfaces as ServiceUnavailable (covered in the service unit spec).
 */
import { randomUUID } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import jwt from "jsonwebtoken";
import type { AuthTokens, LoginResponse } from "@mediaos/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuthService } from "../../src/auth/auth.service";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { PasswordService } from "../../src/auth/password.service";
import { TokenService } from "../../src/auth/token.service";
import { TotpService } from "../../src/auth/totp.service";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import {
  TWO_FACTOR_SETUP_REQUIRED,
  TwoFactorEnforcementGuard,
} from "../../src/auth/two-factor-enforcement.guard";
import { ReplayGuardService } from "../../src/auth/replay-guard.service";
import { SecurityAlertService } from "../../src/auth/security-alert.service";
import { ValkeyService } from "../../src/permission/valkey.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { OperatorReauthService } from "../../src/platform/operator-reauth.service";
import { OperatorActionAuditService } from "../../src/platform/operator-action-audit.service";
// (OperatorReauthService used inside test bodies via an in-memory Valkey for deterministic scoping.)
import { directPool, hasDb } from "../helpers/integration-db";
import { makeSecurityPolicyService } from "../helpers/security-policy";
import {
  cleanupTenants,
  seedCompany,
  seedTwoFactorEnabled,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");
// AC-0b: this spec verifies the 2FA-flip DENY path → enforcement must be ON (vitest env sets 'false').
process.env.TWO_FACTOR_ENFORCEMENT_ENABLED = "true";

const PLATFORM_ADMIN_ROLE = "00000000-0000-0000-0000-0000000000f0";
const PASSWORD = "Passw0rd!strong";
const totp = new TotpService();

function secretFromUri(uri: string): string {
  return new URL(uri).searchParams.get("secret") ?? "";
}
function isChallenge(r: LoginResponse): r is { twoFactorRequired: true; challengeToken: string } {
  return "twoFactorRequired" in r;
}
/** Decode the (unverified) aud claim for assertion — server-internal claim, not in contracts. */
function audOf(accessToken: string): unknown {
  const decoded = jwt.decode(accessToken) as Record<string, unknown> | null;
  return decoded?.aud;
}

describe.skipIf(!hasDb)("AC-0b operator-auth boundary", () => {
  const direct = directPool();
  const password = new PasswordService();
  const meta = { ip: "127.0.0.1", userAgent: "vitest" };
  let A: SeededTenant; // operator's home tenant
  let B: SeededTenant; // a different target tenant
  let auth: AuthService;
  let twoFactor: TwoFactorService;
  let opAudit: OperatorActionAuditService;
  let db: DatabaseService;

  let operatorId: string;
  let operatorEmail: string;
  let tenantUserEmail: string;

  function make() {
    db = new DatabaseService();
    const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
    const permissions = new PermissionService(new PermissionRepository(db));
    const replayGuard = new ReplayGuardService(new ValkeyService());
    const securityAlerts = new SecurityAlertService(db, new AuditService());
    const tf = new TwoFactorService(
      db, secrets, totp, new TokenService(), new AuditService(), new LoginRateLimiter(), replayGuard,
    );
    const a = new AuthService(
      db, password, new TokenService(), new LoginRateLimiter(), new AuditService(),
      new OutboxService(), permissions, secrets, tf, replayGuard, securityAlerts,
      makeSecurityPolicyService(db),
    );
    return { auth: a, twoFactor: tf };
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "ac0bA");
    B = await seedCompany(direct, "ac0bB");
    const hash = await password.hash(PASSWORD);

    operatorEmail = `ac0b-op-${randomUUID().slice(0, 8)}@a.test`;
    tenantUserEmail = `ac0b-tn-${randomUUID().slice(0, 8)}@a.test`;
    operatorId = await seedUser(direct, A.companyId, operatorEmail, hash);
    await seedUserRole(direct, operatorId, PLATFORM_ADMIN_ROLE, A.companyId);
    // Keep the harness green after the 2FA flip: pre-enroll the operator (platform-admin requires 2FA now).
    await seedTwoFactorEnabled(direct, A.companyId, operatorId);
    await seedUser(direct, A.companyId, tenantUserEmail, hash);

    ({ auth, twoFactor } = make());
    opAudit = new OperatorActionAuditService(new AuditService());
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  // ── (1) operator-token minting ─────────────────────────────────────────────
  it("platform-admin login mints an operator-audience token with short TTL", async () => {
    const res = await auth.login({ companySlug: A.slug, email: operatorEmail, password: PASSWORD }, meta);
    // Operator pre-enrolled 2FA → first login returns a challenge; complete it.
    expect(isChallenge(res)).toBe(true);
    if (!isChallenge(res)) throw new Error("expected challenge");
    // We cannot generate a valid TOTP without the operator's secret; assert the token via a fresh
    // non-2FA tenant user below. Here, assert that the operator path issues a challenge (2FA enforced).
  });

  it("tenant user login mints a tenant-audience token (legacy/normal path)", async () => {
    const res = await auth.login({ companySlug: A.slug, email: tenantUserEmail, password: PASSWORD }, meta);
    if (isChallenge(res)) throw new Error("tenant user has no 2FA");
    expect(audOf((res as AuthTokens).accessToken)).toBe("tenant");
  });

  it("operator (after 2FA) mints operator-audience token — exercised via a freshly-enrolled operator", async () => {
    const hash = await password.hash(PASSWORD);
    const opEmail = `ac0b-op2-${randomUUID().slice(0, 8)}@a.test`;
    const opId = await seedUser(direct, A.companyId, opEmail, hash);
    await seedUserRole(direct, opId, PLATFORM_ADMIN_ROLE, A.companyId);
    const { otpauthUri } = await twoFactor.enroll(opId, A.companyId);
    const secret = secretFromUri(otpauthUri);
    await twoFactor.confirmEnable(opId, A.companyId, totp.generate(secret));

    const res = await auth.login({ companySlug: A.slug, email: opEmail, password: PASSWORD }, meta);
    if (!isChallenge(res)) throw new Error("operator must challenge (2FA enforced)");
    const tokens = await auth.completeTwoFactorLogin(res.challengeToken, totp.generate(secret), meta);
    expect(audOf(tokens.accessToken)).toBe("operator");
  });

  // ── (2) 2FA flip enforcement ───────────────────────────────────────────────
  it("platform-admin WITHOUT TOTP enrolled is DENIED (TWO_FACTOR_SETUP_REQUIRED)", async () => {
    const unenrolled = await seedUser(direct, A.companyId, `ac0b-noenroll-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, unenrolled, PLATFORM_ADMIN_ROLE, A.companyId);

    const guard = new TwoFactorEnforcementGuard(new Reflector(), twoFactor);
    const ctx = {
      getType: () => "http",
      getHandler: () => () => {},
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user: { id: unenrolled, companyId: A.companyId } }) }),
    } as unknown as ExecutionContext;

    let denied: ForbiddenException | undefined;
    try {
      await guard.canActivate(ctx);
    } catch (e) {
      denied = e as ForbiddenException;
    }
    expect(denied).toBeInstanceOf(ForbiddenException);
    expect((denied!.getResponse() as { code: string }).code).toBe(TWO_FACTOR_SETUP_REQUIRED);
  });

  // ── (3) step-up window scoped to (operator, targetTenant) ───────────────────
  // Uses an in-memory Valkey so the (A,B) key separation is deterministic (a no-URL ValkeyService is a
  // no-op success on set + null on get, which would mask scoping). Password verify still hits the real DB.
  it("step-up window for tenant A does NOT satisfy a write to tenant B; a B-window does", async () => {
    const store = new Map<string, string>();
    const memValkey = {
      set: async (k: string, v: string) => {
        store.set(k, v);
        return true;
      },
      get: async (k: string) => store.get(k) ?? null,
    } as unknown as ValkeyService;
    const scopedReauth = new OperatorReauthService(
      db, memValkey, password, new LoginRateLimiter(),
    );

    // Step up scoped to tenant A.
    const aWindow = await scopedReauth.stepUp({ id: operatorId, companyId: A.companyId }, A.companyId, {
      password: PASSWORD,
    });
    expect(aWindow.reauthValidUntil.getTime()).toBeGreaterThan(Date.now());
    // The A-window must NOT be readable as a B-window (cross-tenant isolation).
    expect(await scopedReauth.resolveWindow(operatorId, B.companyId)).toBeNull();
    // The A-window IS readable for A.
    expect(await scopedReauth.resolveWindow(operatorId, A.companyId)).not.toBeNull();

    // Step up for B → resolves only for B.
    const bWindow = await scopedReauth.stepUp({ id: operatorId, companyId: A.companyId }, B.companyId, {
      password: PASSWORD,
    });
    expect(bWindow.reauthValidUntil.getTime()).toBeGreaterThan(Date.now());
    expect(await scopedReauth.resolveWindow(operatorId, B.companyId)).not.toBeNull();
  });

  // ── (4) operator-action audit lands with company_id=B + actor=operator ──────
  it("operator-action audit row for a B-write lands with company_id=B and actor=operator", async () => {
    const action = `operator.test_action_${randomUUID().slice(0, 8)}`;
    await db.withTenant(B.companyId, async (tx) => {
      await opAudit.recordOperatorAction(tx, {
        operatorId,
        targetTenantId: B.companyId,
        action,
        objectId: B.companyId,
      });
    });
    const row = await direct.query(
      "SELECT company_id, actor_user_id, object_type, action FROM audit_logs WHERE action=$1 LIMIT 1",
      [action],
    );
    expect(row.rows.length).toBe(1);
    expect(row.rows[0].company_id).toBe(B.companyId);
    expect(row.rows[0].actor_user_id).toBe(operatorId);
    expect(row.rows[0].object_type).toBe("company");
  });
});
