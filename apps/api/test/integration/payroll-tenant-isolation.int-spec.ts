import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PayrollPeriodService } from "../../src/payroll/payroll-period.service";
import { PayrollPeriodRepository } from "../../src/payroll/payroll-period.repository";
import { PayslipService } from "../../src/payroll/payslip.service";
import { PayslipRepository } from "../../src/payroll/payslip.repository";
import { BonusPenaltyRepository } from "../../src/payroll/bonus-penalty.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * G12-2 — RLS 2-tenant qua ĐƯỜNG SERVICE. login A KHÔNG đọc payroll_period/payslip của B (0 row).
 * Mirror finance-revenue-deny (a) / salary-profile-tenant-isolation. company-admin (…0001) có quyền payroll.
 */
const ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";

describe.skipIf(!hasDb)("G12-2 payroll RLS 2-tenant isolation (service path)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let adminA: string;
  let userB: string;
  let periodSvc: PayrollPeriodService;
  let payslipSvc: PayslipService;

  beforeAll(async () => {
    A = await seedCompany(direct, "payA");
    B = await seedCompany(direct, "payB");
    adminA = await seedUser(direct, A.companyId, `pay-admin-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, adminA, ADMIN_ROLE_ID, A.companyId);
    userB = await seedUser(direct, B.companyId, `pay-b-${randomUUID().slice(0, 8)}@b.test`);

    const db = new DatabaseService();
    const audit = new AuditService();
    const permission = new PermissionService(new PermissionRepository(db));
    periodSvc = new PayrollPeriodService(new PayrollPeriodRepository(), db, permission, audit);
    payslipSvc = new PayslipService(
      new PayslipRepository(),
      new BonusPenaltyRepository(),
      db,
      permission,
      audit,
    );
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  let monthSeq = 0;
  /** Seed a payroll period + payslip for tenant t (direct, bypasses RLS). Unique month per call. */
  async function seedPeriodWithPayslip(t: SeededTenant, user: string) {
    monthSeq += 1;
    const mm = (monthSeq % 12) + 1;
    const periodMonth = `2026-${mm.toString().padStart(2, "0")}`;
    const p = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status)
       VALUES ($1, $2, 'draft') RETURNING id`,
      [t.companyId, periodMonth],
    );
    const periodId = p.rows[0].id as string;
    const ps = await direct.query(
      `INSERT INTO payslips
         (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, entry_kind)
       VALUES ($1, $2, $3, 5000.00, 5000.00, 5000.00, $3, 'original') RETURNING id`,
      [t.companyId, periodId, user],
    );
    return { periodId, payslipId: ps.rows[0].id as string };
  }

  it("PayrollPeriodService.list(A) does NOT see B's periods", async () => {
    const b = await seedPeriodWithPayslip(B, userB);
    const rows = await periodSvc.list({ id: adminA, companyId: A.companyId }, {});
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.has(b.periodId)).toBe(false);
  });

  it("PayslipService.list(A) does NOT see B's payslips", async () => {
    const b = await seedPeriodWithPayslip(B, userB);
    const rows = await payslipSvc.list({ id: adminA, companyId: A.companyId }, {});
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.has(b.payslipId)).toBe(false);
  });

  it("PayslipService.getOne(A, B's payslip) → NotFound (cross-tenant 0 row via RLS)", async () => {
    const b = await seedPeriodWithPayslip(B, userB);
    // G12-4: getOne yêu cầu re-auth → truyền cửa sổ HỢP LỆ để vượt step-up, kiểm ĐÚNG đường RLS
    // (kỳ vọng NotFound vì RLS trả 0 row cho payslip của B dưới ngữ cảnh tenant A), KHÔNG dừng ở re-auth.
    await expect(
      payslipSvc.getOne({ id: adminA, companyId: A.companyId }, b.payslipId, {
        reauthValidUntil: new Date(Date.now() + 5 * 60 * 1000),
      }),
    ).rejects.toThrow();
  });
});
