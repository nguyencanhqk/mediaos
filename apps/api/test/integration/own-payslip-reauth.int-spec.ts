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
 * B1 — own-payslip getOWN (full tiền CHỈ sau re-auth) + ownership + cross-tenant. RED-first.
 * Permission engine THẬT (Postgres, 4 tầng G3). Mirror payslip-reauth + tenant-iso.
 *
 *  (d) employee getOwn OWN khi THIẾU cửa sổ re-auth (reauthValidUntil=null) → Forbidden.
 *  (e) employee getOwn OWN khi cửa sổ HẾT HẠN → Forbidden.
 *  (f) employee getOwn OWN sau re-auth HỢP LỆ → trả full payslip CỦA MÌNH.
 *  (g) employee getOwn payslip NGƯỜI KHÁC kể cả có cửa sổ re-auth → Forbidden
 *      (ownership check ĐỘC LẬP / TRƯỚC decision — KHÔNG lộ số).
 *  (cross-tenant) employee tenant A getOwn id của tenant B → Forbidden/NotFound (RLS + eq(companyId)).
 */
describe.skipIf(!hasDb)("B1 own-payslip getOwn (re-auth gated, ownership, cross-tenant)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let empUser: string; // tenant A, có view-own-payslip
  let otherUser: string; // tenant A, payslip riêng
  let empUserB: string; // tenant B, có view-own-payslip
  let ownPayslipId: string; // empUser's payslip (tenant A)
  let otherPayslipId: string; // otherUser's payslip (tenant A)
  let payslipIdB: string; // payslip in tenant B
  let payslipSvc: PayslipService;

  const future = () => new Date(Date.now() + 5 * 60 * 1000);
  const past = () => new Date(Date.now() - 1000);

  async function seedOwnEmployee(tenant: SeededTenant, label: string): Promise<string> {
    const user = await seedUser(
      direct,
      tenant.companyId,
      `${label}-${randomUUID().slice(0, 8)}@a.test`,
    );
    const role = await seedRole(direct, tenant.companyId, `${label}-${randomUUID().slice(0, 8)}`);
    const perm = await seedPermissionCatalog(direct, "view-own-payslip", "payslip", true);
    await seedRolePermission(direct, role, perm, "ALLOW");
    await seedUserRole(direct, user, role, tenant.companyId);
    return user;
  }

  async function insertPayslip(
    companyId: string,
    periodId: string,
    userId: string,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO payslips
         (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, entry_kind)
       VALUES ($1, $2, $3, 9000.00, 9000.00, 9000.00, $3, 'original') RETURNING id`,
      [companyId, periodId, userId],
    );
    return r.rows[0].id as string;
  }

  async function seedPeriod(companyId: string): Promise<string> {
    const p = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status)
       VALUES ($1, '2026-06', 'draft') RETURNING id`,
      [companyId],
    );
    return p.rows[0].id as string;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "ownra");
    B = await seedCompany(direct, "ownrb");

    empUser = await seedOwnEmployee(A, "ra-emp");
    otherUser = await seedOwnEmployee(A, "ra-other");
    empUserB = await seedOwnEmployee(B, "rb-emp");

    const periodA = await seedPeriod(A.companyId);
    ownPayslipId = await insertPayslip(A.companyId, periodA, empUser);
    otherPayslipId = await insertPayslip(A.companyId, periodA, otherUser);

    const periodB = await seedPeriod(B.companyId);
    payslipIdB = await insertPayslip(B.companyId, periodB, empUserB);

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
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  it("(d) getOwn OWN WITHOUT a re-auth window → Forbidden", async () => {
    await expect(
      payslipSvc.getOwn({ id: empUser, companyId: A.companyId }, ownPayslipId, {
        reauthValidUntil: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("(e) getOwn OWN with EXPIRED window → Forbidden", async () => {
    await expect(
      payslipSvc.getOwn({ id: empUser, companyId: A.companyId }, ownPayslipId, {
        reauthValidUntil: past(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("(f) getOwn OWN with VALID window → returns full OWN payslip (objectGrantRequired:false)", async () => {
    const row = await payslipSvc.getOwn({ id: empUser, companyId: A.companyId }, ownPayslipId, {
      reauthValidUntil: future(),
    });
    expect(row.id).toBe(ownPayslipId);
    expect(row.userId).toBe(empUser);
    // full payslip → money IS present here (only after re-auth).
    expect(typeof row.net).toBe("string");
  });

  it("(g) getOwn ANOTHER user's payslip even WITH valid window → Forbidden (ownership independent)", async () => {
    await expect(
      payslipSvc.getOwn({ id: empUser, companyId: A.companyId }, otherPayslipId, {
        reauthValidUntil: future(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("(cross-tenant) employee in A getOwn a tenant B payslip id → Forbidden/NotFound (RLS, no leak)", async () => {
    await expect(
      payslipSvc.getOwn({ id: empUser, companyId: A.companyId }, payslipIdB, {
        reauthValidUntil: future(),
      }),
    ).rejects.toThrow();
  });

  it("(cross-tenant list) employee in A listOwn never includes tenant B rows", async () => {
    const rows = await payslipSvc.listOwn({ id: empUser, companyId: A.companyId });
    expect(rows.map((r) => r.id)).not.toContain(payslipIdB);
  });
});
