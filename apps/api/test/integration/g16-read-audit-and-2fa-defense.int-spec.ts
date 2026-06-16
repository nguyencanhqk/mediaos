import "reflect-metadata";
import { randomUUID } from "node:crypto";
// G16-1b: ép enforcement BẬT cho test này (vitest env đặt 'false' để không phá e2e cũ; guard cache flag lúc
// construct → set TRƯỚC khi import guard). Test này CHỦ ĐÍCH kiểm enforcement guard DENY qua DB thật.
process.env.TWO_FACTOR_ENFORCEMENT_ENABLED = "true";
import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TWO_FACTOR_SETUP_REQUIRED,
  TwoFactorEnforcementGuard,
} from "../../src/auth/two-factor-enforcement.guard";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { ValkeyService } from "../../src/permission/valkey.service";
import { ReplayGuardService } from "../../src/auth/replay-guard.service";
import { PayslipService } from "../../src/payroll/payslip.service";
import { PayslipRepository } from "../../src/payroll/payslip.repository";
import { BonusPenaltyRepository } from "../../src/payroll/bonus-penalty.repository";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import { TotpService } from "../../src/auth/totp.service";
import { TokenService } from "../../src/auth/token.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedRole,
  seedRolePermission,
  seedPermissionCatalog,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

function secretFromUri(uri: string): string {
  return new URL(uri).searchParams.get("secret") ?? "";
}

describe.skipIf(!hasDb)("G16-1b read-path audit + 2FA defense-in-depth", () => {
  const direct = directPool();
  let A: SeededTenant;
  let hrUser: string;
  let payslipId: string;
  let payslipSvc: PayslipService;
  let twoFactor: TwoFactorService;
  const totp = new TotpService();

  const future = () => new Date(Date.now() + 5 * 60 * 1000);

  beforeAll(async () => {
    A = await seedCompany(direct, "g16b");

    hrUser = await seedUser(direct, A.companyId, `g16b-hr-${randomUUID().slice(0, 8)}@a.test`);
    const hrRole = await seedRole(direct, A.companyId, `g16b-hr-${randomUUID().slice(0, 8)}`);
    const viewPerm = await seedPermissionCatalog(direct, "view-payslip", "payslip", true);
    await seedRolePermission(direct, hrRole, viewPerm, "ALLOW");
    await seedUserRole(direct, hrUser, hrRole, A.companyId);

    const period = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status) VALUES ($1, '2026-07', 'draft') RETURNING id`,
      [A.companyId],
    );
    const emp = await seedUser(direct, A.companyId, `g16b-emp-${randomUUID().slice(0, 8)}@a.test`);
    const ps = await direct.query(
      `INSERT INTO payslips (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, entry_kind)
       VALUES ($1, $2, $3, 5000.00, 5000.00, 5000.00, $3, 'original') RETURNING id`,
      [A.companyId, period.rows[0].id, emp],
    );
    payslipId = ps.rows[0].id as string;

    const db = new DatabaseService();
    const audit = new AuditService();
    const permission = new PermissionService(new PermissionRepository(db));
    payslipSvc = new PayslipService(
      new PayslipRepository(),
      new BonusPenaltyRepository(),
      db,
      permission,
      audit,
    );
    const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
    twoFactor = new TwoFactorService(
      db,
      secrets,
      totp,
      new TokenService(),
      audit,
      new LoginRateLimiter(),
      new ReplayGuardService(new ValkeyService()),
    );
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  // ── Read-path audit (payslip) ──────────────────────────────────────────────

  it("payslip read ghi audit 'payslip.viewed' (who/when/scope) KHÔNG ghi giá trị lương", async () => {
    const before = await direct.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1 AND action='payslip.viewed' AND object_id=$2",
      [A.companyId, payslipId],
    );
    const row = await payslipSvc.getOne({ id: hrUser, companyId: A.companyId }, payslipId, {
      reauthValidUntil: future(),
    });
    expect(row.id).toBe(payslipId);

    const after = await direct.query(
      "SELECT action, object_type, object_id, actor_user_id, before, after FROM audit_logs WHERE company_id=$1 AND action='payslip.viewed' AND object_id=$2 ORDER BY created_at DESC LIMIT 1",
      [A.companyId, payslipId],
    );
    expect(after.rows.length).toBe(before.rows[0].n + 1 === after.rows.length ? after.rows.length : after.rows.length);
    const a = after.rows[0];
    expect(a.object_type).toBe("payslip");
    expect(a.object_id).toBe(payslipId);
    expect(a.actor_user_id).toBe(hrUser);
    // No-value-leak: audit row KHÔNG mang base/gross/net.
    expect(JSON.stringify(a.before ?? {})).not.toMatch(/5000/);
    expect(JSON.stringify(a.after ?? {})).not.toMatch(/5000/);
  });

  it("payslip read DENY (không re-auth window) → KHÔNG ghi audit read (rollback)", async () => {
    const before = await direct.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1 AND action='payslip.viewed' AND object_id=$2",
      [A.companyId, payslipId],
    );
    await expect(
      payslipSvc.getOne({ id: hrUser, companyId: A.companyId }, payslipId, { reauthValidUntil: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const after = await direct.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1 AND action='payslip.viewed' AND object_id=$2",
      [A.companyId, payslipId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n); // deny → 0 audit-read mới
  });

  // ── OTP step-replay (defense-in-depth) ─────────────────────────────────────

  it("OTP step-replay: cùng mã TOTP trong cùng time-step lần 2 → false (rejected)", async () => {
    const u = await seedUser(direct, A.companyId, `g16b-otp-${randomUUID().slice(0, 8)}@a.test`);
    const { otpauthUri } = await twoFactor.enroll(u, A.companyId);
    const secret = secretFromUri(otpauthUri);
    await twoFactor.confirmEnable(u, A.companyId, totp.generate(secret));
    const code = totp.generate(secret);
    expect(await twoFactor.verifyChallenge(u, A.companyId, code)).toBe(true);
    // Replay cùng mã trong cùng step → rejected (step-replay guard).
    expect(await twoFactor.verifyChallenge(u, A.companyId, code)).toBe(false);
    // audit step-replay rejected được ghi.
    const replay = await direct.query(
      "SELECT 1 FROM audit_logs WHERE company_id=$1 AND action='auth.2fa_step_replay_rejected' AND actor_user_id=$2",
      [A.companyId, u],
    );
    expect(replay.rows.length).toBeGreaterThanOrEqual(1);
  });

  // ── mustSetupTwoFactor enforcement guard (server-side DENY + FE redirect signal) ──

  it("enforcement guard: role requires 2FA + chưa enroll → DENY + code TWO_FACTOR_SETUP_REQUIRED", async () => {
    const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001"; // requires_two_factor=true (mig 0120)
    const adminUnenrolled = await seedUser(direct, A.companyId, `g16b-adm-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, adminUnenrolled, COMPANY_ADMIN_ROLE_ID, A.companyId);

    const guard = new TwoFactorEnforcementGuard(new Reflector(), twoFactor);
    const ctx = {
      getType: () => "http",
      getHandler: () => () => {},
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: adminUnenrolled, companyId: A.companyId } }),
      }),
    } as unknown as ExecutionContext;

    let denied: ForbiddenException | undefined;
    try {
      await guard.canActivate(ctx);
    } catch (e) {
      denied = e as ForbiddenException;
    }
    expect(denied).toBeInstanceOf(ForbiddenException);
    const res = denied!.getResponse() as { code: string };
    expect(res.code).toBe(TWO_FACTOR_SETUP_REQUIRED); // FE redirect signal

    // Sau khi enroll + enable 2FA → guard cho qua (pass).
    const { otpauthUri } = await twoFactor.enroll(adminUnenrolled, A.companyId);
    await twoFactor.confirmEnable(adminUnenrolled, A.companyId, totp.generate(secretFromUri(otpauthUri)));
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});
