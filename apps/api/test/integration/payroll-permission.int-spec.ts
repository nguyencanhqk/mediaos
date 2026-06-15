import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PayslipService } from "../../src/payroll/payslip.service";
import { PayslipRepository } from "../../src/payroll/payslip.repository";
import { BonusPenaltyRepository } from "../../src/payroll/bonus-penalty.repository";
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
 * G12-2 — permission FAIL-CLOSED (RED-first). Lương/payslip NHẠY CẢM (BẤT BIẾN #3):
 *  (a) user KHÔNG có run-payroll → runPayroll throws Forbidden, 0 payslip ghi (đếm=0).
 *  (b) user KHÔNG có view-payslip → list/getOne payslip throws Forbidden (masked/denied).
 *  (c) sensitive KHÔNG kế thừa wildcard *:* (run-payroll/view-payslip is_sensitive=TRUE).
 * Permission engine THẬT (Postgres, 4 tầng G3) — KHÔNG mock.
 */
describe.skipIf(!hasDb)("G12-2 payroll permission deny-path (fail-closed)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let noPermUser: string;
  let wildcardUser: string;
  let periodId: string;
  let payslipSvc: PayslipService;

  async function countPayslips(companyId: string): Promise<number> {
    const r = await direct.query(`SELECT count(*)::int AS n FROM payslips WHERE company_id = $1`, [
      companyId,
    ]);
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "payperm");

    // (a) user with an empty role (no run-payroll / view-payslip).
    noPermUser = await seedUser(
      direct,
      A.companyId,
      `pp-noperm-${randomUUID().slice(0, 8)}@a.test`,
    );
    const emptyRole = await seedRole(direct, A.companyId, `pp-empty-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, noPermUser, emptyRole, A.companyId);

    // (c) user with wildcard *:* ALLOW but NO explicit sensitive grant → must NOT inherit.
    wildcardUser = await seedUser(
      direct,
      A.companyId,
      `pp-wild-${randomUUID().slice(0, 8)}@a.test`,
    );
    const wildcardRole = await seedRole(direct, A.companyId, `pp-wild-${randomUUID().slice(0, 8)}`);
    const wildcardPerm = await seedPermissionCatalog(direct, "*", "*", false);
    await seedRolePermission(direct, wildcardRole, wildcardPerm, "ALLOW");
    await seedUserRole(direct, wildcardUser, wildcardRole, A.companyId);

    const period = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status)
       VALUES ($1, '2026-05', 'draft') RETURNING id`,
      [A.companyId],
    );
    periodId = period.rows[0].id as string;

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
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it("(a) user without run-payroll → runPayroll throws Forbidden, 0 payslip written", async () => {
    const before = await countPayslips(A.companyId);
    await expect(
      payslipSvc.runPayroll(
        { id: noPermUser, companyId: A.companyId },
        { payrollPeriodId: periodId },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await countPayslips(A.companyId)).toBe(before);
  });

  it("(b) user without view-payslip → list/getOne throws Forbidden", async () => {
    await expect(
      payslipSvc.list({ id: noPermUser, companyId: A.companyId }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      payslipSvc.getOne({ id: noPermUser, companyId: A.companyId }, randomUUID()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("(c) wildcard *:* does NOT inherit sensitive run-payroll/view-payslip", async () => {
    await expect(
      payslipSvc.runPayroll(
        { id: wildcardUser, companyId: A.companyId },
        { payrollPeriodId: periodId },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      payslipSvc.list({ id: wildcardUser, companyId: A.companyId }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
