import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ForbiddenException, HttpException, UnauthorizedException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PasswordService } from "../../src/auth/password.service";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { ValkeyService } from "../../src/permission/valkey.service";
import { PayslipService } from "../../src/payroll/payslip.service";
import { PayslipRepository } from "../../src/payroll/payslip.repository";
import { BonusPenaltyRepository } from "../../src/payroll/bonus-penalty.repository";
import { PayslipReauthService } from "../../src/payroll/payslip-reauth.service";
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

/**
 * G12-4 — RE-AUTH xem payslip (step-up). RED-first:
 *  - getOne KHÔNG có cửa sổ re-auth → Forbidden (deny-reauth-required) DÙ có view-payslip (HR).
 *  - getOne cửa sổ HẾT HẠN → Forbidden; cửa sổ HỢP LỆ → trả payslip.
 *  - REGRESSION: HR có view-payslip company-level (KHÔNG object-grant) vẫn QUA với cửa sổ hợp lệ
 *    (chứng minh objectGrantRequired:false — nếu thiếu sẽ deny-object-required chặn nhầm HR).
 *  - reauth: sai mật khẩu → Unauthorized; rate-limit → 429; đúng mật khẩu → cửa sổ.
 */
describe.skipIf(!hasDb)("G12-4 payslip view re-auth (step-up)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let hrUser: string; // có view-payslip company-level (KHÔNG object-grant)
  let noPermUser: string;
  let pwUser: string; // có passwordHash thật cho test reauth
  let payslipId: string;
  let payslipSvc: PayslipService;
  let reauthSvc: PayslipReauthService;

  const future = () => new Date(Date.now() + 5 * 60 * 1000);
  const past = () => new Date(Date.now() - 1000);

  beforeAll(async () => {
    A = await seedCompany(direct, "preauth");

    // HR: explicit (non-wildcard) view-payslip ALLOW — KHÔNG object-grant per-payslip.
    hrUser = await seedUser(direct, A.companyId, `pre-hr-${randomUUID().slice(0, 8)}@a.test`);
    const hrRole = await seedRole(direct, A.companyId, `pre-hr-${randomUUID().slice(0, 8)}`);
    const viewPerm = await seedPermissionCatalog(direct, "view-payslip", "payslip", true);
    await seedRolePermission(direct, hrRole, viewPerm, "ALLOW");
    await seedUserRole(direct, hrUser, hrRole, A.companyId);

    noPermUser = await seedUser(
      direct,
      A.companyId,
      `pre-noperm-${randomUUID().slice(0, 8)}@a.test`,
    );
    const emptyRole = await seedRole(direct, A.companyId, `pre-empty-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, noPermUser, emptyRole, A.companyId);

    const password = new PasswordService();
    const realHash = await password.hash("correct-horse-battery");
    pwUser = await seedUser(
      direct,
      A.companyId,
      `pre-pw-${randomUUID().slice(0, 8)}@a.test`,
      realHash,
    );

    const period = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status) VALUES ($1, '2026-06', 'draft') RETURNING id`,
      [A.companyId],
    );
    const emp = await seedUser(direct, A.companyId, `pre-emp-${randomUUID().slice(0, 8)}@a.test`);
    const ps = await direct.query(
      `INSERT INTO payslips
         (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, entry_kind)
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
    reauthSvc = new PayslipReauthService(db, new ValkeyService(), password, new LoginRateLimiter());
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it("getOne WITHOUT a re-auth window → Forbidden (deny-reauth-required), even for HR", async () => {
    await expect(
      payslipSvc.getOne({ id: hrUser, companyId: A.companyId }, payslipId, {
        reauthValidUntil: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("getOne with EXPIRED window → Forbidden", async () => {
    await expect(
      payslipSvc.getOne({ id: hrUser, companyId: A.companyId }, payslipId, {
        reauthValidUntil: past(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("getOne with VALID window → returns payslip (HR company-grant, NO object-grant: objectGrantRequired:false)", async () => {
    const row = await payslipSvc.getOne({ id: hrUser, companyId: A.companyId }, payslipId, {
      reauthValidUntil: future(),
    });
    expect(row.id).toBe(payslipId);
  });

  it("getOne: user WITHOUT view-payslip still denied even WITH a valid window", async () => {
    await expect(
      payslipSvc.getOne({ id: noPermUser, companyId: A.companyId }, payslipId, {
        reauthValidUntil: future(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("reauth: wrong password → Unauthorized", async () => {
    await expect(
      reauthSvc.reauth({ id: pwUser, companyId: A.companyId }, payslipId, { password: "wrong" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("reauth: correct password → mints a window", async () => {
    const { reauthValidUntil } = await reauthSvc.reauth(
      { id: pwUser, companyId: A.companyId },
      payslipId,
      { password: "correct-horse-battery" },
    );
    expect(reauthValidUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it("reauth: repeated wrong passwords eventually rate-limited (429)", async () => {
    // pwUser2 cô lập để không lẫn trạng thái limiter của test trên.
    const realHash = await new PasswordService().hash("pw2");
    const u = await seedUser(
      direct,
      A.companyId,
      `pre-pw2-${randomUUID().slice(0, 8)}@a.test`,
      realHash,
    );
    let got429 = false;
    for (let i = 0; i < 25 && !got429; i++) {
      try {
        await reauthSvc.reauth({ id: u, companyId: A.companyId }, payslipId, { password: "nope" });
      } catch (e) {
        if (e instanceof HttpException && e.getStatus() === 429) got429 = true;
        else if (!(e instanceof UnauthorizedException)) throw e;
      }
    }
    expect(got429).toBe(true);
  });
});
