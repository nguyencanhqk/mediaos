import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PayslipService } from "../../src/payroll/payslip.service";
import { PayslipRepository } from "../../src/payroll/payslip.repository";
import { BonusPenaltyService } from "../../src/payroll/bonus-penalty.service";
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
 * G12-3 — LÕI TÍNH TIỀN (santa anchor). Gộp thưởng/phạt APPROVED vào payslip + consume chống trả 2 lần.
 *  (a) bonus 1000 + penalty 300, base 5000 → gross 5000, bonus 1000, penalty 300, net 5700;
 *      2 item bonus/penalty; 2 khoản → consumed (payroll_period_id set).
 *  (b) penalty 9000 > gross 5000 → net CLAMP 0, penalty vẫn ghi item đầy đủ.
 *  (c) chỉ APPROVED được gộp — draft/rejected KHÔNG ảnh hưởng, KHÔNG consume.
 *  (d) khác period_month → KHÔNG gộp.
 *  (e) approve qua SERVICE (creator≠approver) ghi audit 'bonus_penalty' cùng tx.
 * company-admin (…0001) có run-payroll + bonus perms (seed 0097/0099).
 */
const ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";

describe.skipIf(!hasDb)("G12-3 bonus/penalty → payroll aggregation (money correctness)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let admin: string;
  let approver: string;
  let payslipSvc: PayslipService;
  let bonusSvc: BonusPenaltyService;

  /** Seed employee + active salary profile (base) + attendance LOCKED period + payroll period linked. */
  async function seedScenario(
    month: string,
    base = 5000,
  ): Promise<{ employee: string; periodId: string }> {
    const employee = await seedUser(
      direct,
      A.companyId,
      `bpa-emp-${randomUUID().slice(0, 8)}@a.test`,
    );
    await direct.query(
      `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, status)
       VALUES ($1, $2, '2026-01-01', $3, 'active')`,
      [A.companyId, employee, base.toFixed(2)],
    );
    const ap = await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status)
       VALUES ($1, $2, 'locked') RETURNING id`,
      [A.companyId, month],
    );
    const pp = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status, attendance_period_id)
       VALUES ($1, $2, 'draft', $3) RETURNING id`,
      [A.companyId, month, ap.rows[0].id],
    );
    return { employee, periodId: pp.rows[0].id as string };
  }

  async function seedBP(
    employee: string,
    kind: "bonus" | "penalty",
    amount: number,
    month: string,
    status: "draft" | "approved" | "rejected" = "approved",
  ): Promise<string> {
    const approved = status === "approved";
    const r = await direct.query(
      `INSERT INTO bonus_penalties
         (company_id, user_id, kind, amount, period_month, status, created_by, approved_by, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $2, $7, $8) RETURNING id`,
      [
        A.companyId,
        employee,
        kind,
        amount.toFixed(2),
        month,
        status,
        approved ? approver : null,
        approved ? new Date().toISOString() : null,
      ],
    );
    return r.rows[0].id as string;
  }

  async function payslipOf(periodId: string, userId: string) {
    const r = await direct.query(
      `SELECT base_salary::float8 AS base, gross::float8 AS gross, net::float8 AS net,
              bonus_amount::float8 AS bonus, penalty_amount::float8 AS penalty
       FROM payslips WHERE payroll_period_id = $1 AND user_id = $2 LIMIT 1`,
      [periodId, userId],
    );
    return r.rows[0];
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "bpagg");
    admin = await seedUser(direct, A.companyId, `bpa-admin-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, admin, ADMIN_ROLE_ID, A.companyId);
    approver = await seedUser(direct, A.companyId, `bpa-apr-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, approver, ADMIN_ROLE_ID, A.companyId);

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
    bonusSvc = new BonusPenaltyService(new BonusPenaltyRepository(), db, permission, audit);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it("(a) approved bonus+penalty → net = gross+bonus−penalty; items + consume", async () => {
    const { employee, periodId } = await seedScenario("2026-05");
    const bonusId = await seedBP(employee, "bonus", 1000, "2026-05");
    const penaltyId = await seedBP(employee, "penalty", 300, "2026-05");

    const res = await payslipSvc.runPayroll(
      { id: admin, companyId: A.companyId },
      { payrollPeriodId: periodId },
    );
    expect(res.created).toBe(1);

    const ps = await payslipOf(periodId, employee);
    expect(ps.gross).toBe(5000);
    expect(ps.bonus).toBe(1000);
    expect(ps.penalty).toBe(300);
    expect(ps.net).toBe(5700);

    const items = await direct.query(
      `SELECT item_type FROM payslip_items pi
         JOIN payslips p ON p.id = pi.payslip_id
        WHERE p.payroll_period_id = $1 AND p.user_id = $2`,
      [periodId, employee],
    );
    const types = items.rows.map((x) => x.item_type as string);
    expect(types).toContain("bonus");
    expect(types).toContain("penalty");

    const consumed = await direct.query(
      `SELECT payroll_period_id FROM bonus_penalties WHERE id = ANY($1::uuid[])`,
      [[bonusId, penaltyId]],
    );
    expect(consumed.rows.every((r) => r.payroll_period_id === periodId)).toBe(true);
  });

  it("(b) penalty > gross → net clamped to 0; penalty still itemized", async () => {
    const { employee, periodId } = await seedScenario("2026-06");
    await seedBP(employee, "penalty", 9000, "2026-06");

    await payslipSvc.runPayroll(
      { id: admin, companyId: A.companyId },
      { payrollPeriodId: periodId },
    );
    const ps = await payslipOf(periodId, employee);
    expect(ps.gross).toBe(5000);
    expect(ps.penalty).toBe(9000);
    expect(ps.net).toBe(0); // max(0, 5000 − 9000)
  });

  it("(c) only approved aggregated — draft + rejected do not affect net or consume", async () => {
    const { employee, periodId } = await seedScenario("2026-07");
    const draftId = await seedBP(employee, "bonus", 1000, "2026-07", "draft");
    const rejectedId = await seedBP(employee, "bonus", 2000, "2026-07", "rejected");

    await payslipSvc.runPayroll(
      { id: admin, companyId: A.companyId },
      { payrollPeriodId: periodId },
    );
    const ps = await payslipOf(periodId, employee);
    expect(ps.net).toBe(5000); // no approved bonus/penalty
    expect(ps.bonus).toBeNull();

    const untouched = await direct.query(
      `SELECT payroll_period_id FROM bonus_penalties WHERE id = ANY($1::uuid[])`,
      [[draftId, rejectedId]],
    );
    expect(untouched.rows.every((r) => r.payroll_period_id === null)).toBe(true);
  });

  it("(d) approved bonus in a different period_month is NOT aggregated", async () => {
    const { employee, periodId } = await seedScenario("2026-08");
    await seedBP(employee, "bonus", 1000, "2026-09"); // different month

    await payslipSvc.runPayroll(
      { id: admin, companyId: A.companyId },
      { payrollPeriodId: periodId },
    );
    const ps = await payslipOf(periodId, employee);
    expect(ps.net).toBe(5000);
    expect(ps.bonus).toBeNull();
  });

  it("(e) approve via service (creator≠approver) writes audit 'bonus_penalty' in tx", async () => {
    const { employee } = await seedScenario("2026-10");
    const created = await bonusSvc.create(
      { id: admin, companyId: A.companyId },
      { userId: employee, kind: "bonus", amount: 750, periodMonth: "2026-10", source: "manual" },
    );
    const approved = await bonusSvc.approve({ id: approver, companyId: A.companyId }, created.id);
    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe(approver);

    const audit = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs
        WHERE company_id = $1 AND object_type = 'bonus_penalty'
          AND object_id = $2 AND action = 'bonus_penalty_approved'`,
      [A.companyId, created.id],
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
  });
});
