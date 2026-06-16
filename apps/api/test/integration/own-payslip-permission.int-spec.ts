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
 * B1 — own-payslip LIST (nhân viên xem phiếu CỦA MÌNH), money-FREE-by-default. RED-first.
 * Permission engine THẬT (Postgres, 4 tầng G3) — KHÔNG mock. Mirror payroll-permission.int-spec.ts.
 *
 *  (a) employee có 'view-own-payslip' → listOwn 200, CHỈ trả payslip userId=self, mỗi row money-FREE
 *      (Object.keys KHÔNG chứa baseSalary/totalAllowances/gross/net/kpiAmount/bonusAmount/
 *       penaltyAmount/currency) — BẤT BIẾN #3a.
 *  (b) employee KHÔNG có 'view-own-payslip' → listOwn throws Forbidden (fail-closed).
 *  (c) employee KHÔNG bao giờ thấy payslip người khác — 2 user cùng tenant, listOwn(U1) chỉ trả của U1
 *      (ownership ép ở SERVICE, KHÔNG nới quyền admin view-payslip).
 */
const MONEY_KEYS = [
  "baseSalary",
  "totalAllowances",
  "gross",
  "net",
  "currency",
  "kpiAmount",
  "bonusAmount",
  "penaltyAmount",
] as const;

async function insertPayslip(
  direct: import("pg").Pool,
  companyId: string,
  periodId: string,
  userId: string,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO payslips
       (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, entry_kind)
     VALUES ($1, $2, $3, 7000.00, 7000.00, 7000.00, $3, 'original') RETURNING id`,
    [companyId, periodId, userId],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!hasDb)("B1 own-payslip list (money-free, ownership-scoped)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let empUser: string; // có view-own-payslip
  let otherUser: string; // cùng tenant, payslip riêng
  let noPermUser: string;
  let empPayslipId: string;
  let otherPayslipId: string;
  let payslipSvc: PayslipService;

  beforeAll(async () => {
    A = await seedCompany(direct, "ownperm");

    const ownPerm = await seedPermissionCatalog(direct, "view-own-payslip", "payslip", true);

    // employee: explicit (non-wildcard) view-own-payslip ALLOW (company-level, NO object-grant).
    empUser = await seedUser(direct, A.companyId, `op-emp-${randomUUID().slice(0, 8)}@a.test`);
    const empRole = await seedRole(direct, A.companyId, `op-emp-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, empRole, ownPerm, "ALLOW");
    await seedUserRole(direct, empUser, empRole, A.companyId);

    // otherUser: ALSO has view-own-payslip (so list path is reachable) but its own payslip.
    otherUser = await seedUser(direct, A.companyId, `op-other-${randomUUID().slice(0, 8)}@a.test`);
    const otherRole = await seedRole(direct, A.companyId, `op-other-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, otherRole, ownPerm, "ALLOW");
    await seedUserRole(direct, otherUser, otherRole, A.companyId);

    noPermUser = await seedUser(
      direct,
      A.companyId,
      `op-noperm-${randomUUID().slice(0, 8)}@a.test`,
    );
    const emptyRole = await seedRole(direct, A.companyId, `op-empty-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, noPermUser, emptyRole, A.companyId);

    const period = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status)
       VALUES ($1, '2026-05', 'draft') RETURNING id`,
      [A.companyId],
    );
    const periodId = period.rows[0].id as string;
    empPayslipId = await insertPayslip(direct, A.companyId, periodId, empUser);
    otherPayslipId = await insertPayslip(direct, A.companyId, periodId, otherUser);

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

  it("(a) employee with view-own-payslip → listOwn returns only OWN payslips, money-FREE", async () => {
    const rows = await payslipSvc.listOwn({ id: empUser, companyId: A.companyId });
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(empPayslipId);
    expect(rows[0]!.userId).toBe(empUser);
    // BẤT BIẾN #3a: NO monetary field present on the row keys.
    for (const row of rows) {
      const keys = Object.keys(row);
      for (const moneyKey of MONEY_KEYS) {
        expect(keys).not.toContain(moneyKey);
      }
    }
  });

  it("(b) employee WITHOUT view-own-payslip → listOwn throws Forbidden", async () => {
    await expect(
      payslipSvc.listOwn({ id: noPermUser, companyId: A.companyId }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("(c) employee never sees another user's payslip — listOwn is ownership-scoped", async () => {
    const u1 = await payslipSvc.listOwn({ id: empUser, companyId: A.companyId });
    expect(u1.map((r) => r.id)).toEqual([empPayslipId]);
    expect(u1.map((r) => r.id)).not.toContain(otherPayslipId);

    const u2 = await payslipSvc.listOwn({ id: otherUser, companyId: A.companyId });
    expect(u2.map((r) => r.id)).toEqual([otherPayslipId]);
    expect(u2.map((r) => r.id)).not.toContain(empPayslipId);
  });
});
