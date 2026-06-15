import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PayslipService } from "../../src/payroll/payslip.service";
import { PayslipRepository } from "../../src/payroll/payslip.repository";
import { BonusPenaltyRepository } from "../../src/payroll/bonus-penalty.repository";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * G12-2 — BR khoá kỳ trước khi chạy lương + reuse trigger G11 0064 (KHÔNG viết lại).
 *  (a) runPayroll khi attendance period CHƯA locked (open / không gắn) → bị TỪ CHỐI (Conflict).
 *  (b) runPayroll khi attendance period LOCKED → tạo payslip snapshot (đếm > 0).
 *  (c) trigger 0064 (attendance_periods): locked→open bị chặn ở DB (reuse, không viết lại).
 * company-admin (…0001) có run-payroll (seed 0097).
 */
const ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";

describe.skipIf(!hasDb)("G12-2 payroll period-lock BR (reuse trigger 0064)", () => {
  const direct = directPool();
  const app = appPool();
  let A: SeededTenant;
  let adminA: string;
  let employee: string;
  let payslipSvc: PayslipService;

  async function countPayslips(periodId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM payslips WHERE payroll_period_id = $1`,
      [periodId],
    );
    return r.rows[0].n as number;
  }

  /** Seed attendance period (open/locked) + payroll period linked to it. */
  async function seedLinkedPeriod(month: string, attendanceStatus: "open" | "locked") {
    const ap = await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status)
       VALUES ($1, $2, $3) RETURNING id`,
      [A.companyId, month, attendanceStatus],
    );
    const pp = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status, attendance_period_id)
       VALUES ($1, $2, 'draft', $3) RETURNING id`,
      [A.companyId, month, ap.rows[0].id],
    );
    return {
      attendancePeriodId: ap.rows[0].id as string,
      payrollPeriodId: pp.rows[0].id as string,
    };
  }

  async function asApp<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      const out = await fn(c);
      await c.query("ROLLBACK");
      return out;
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "paylock");
    adminA = await seedUser(direct, A.companyId, `pl-admin-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, adminA, ADMIN_ROLE_ID, A.companyId);
    employee = await seedUser(direct, A.companyId, `pl-emp-${randomUUID().slice(0, 8)}@a.test`);
    // Active salary profile so runPayroll has something to snapshot.
    await direct.query(
      `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, status)
       VALUES ($1, $2, '2026-01-01', 5000.00, 'active')`,
      [A.companyId, employee],
    );

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
    await app.end();
  });

  it("(a) runPayroll with attendance period NOT locked → Conflict (BR fail-closed)", async () => {
    const { payrollPeriodId } = await seedLinkedPeriod("2026-07", "open");
    await expect(
      payslipSvc.runPayroll({ id: adminA, companyId: A.companyId }, { payrollPeriodId }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await countPayslips(payrollPeriodId)).toBe(0);
  });

  it("(b) runPayroll with attendance period LOCKED → snapshots a payslip", async () => {
    const { payrollPeriodId } = await seedLinkedPeriod("2026-08", "locked");
    const result = await payslipSvc.runPayroll(
      { id: adminA, companyId: A.companyId },
      { payrollPeriodId },
    );
    expect(result.created).toBeGreaterThan(0);
    expect(await countPayslips(payrollPeriodId)).toBeGreaterThan(0);
  });

  it("(c) trigger 0064: attendance_periods locked→open is blocked at DB (reuse, not rewritten)", async () => {
    const ap = await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status)
       VALUES ($1, '2026-09', 'locked') RETURNING id`,
      [A.companyId],
    );
    await expect(
      asApp(A.companyId, (c) =>
        c.query(`UPDATE attendance_periods SET status = 'open' WHERE id = $1`, [ap.rows[0].id]),
      ),
    ).rejects.toThrow();
  });
});
