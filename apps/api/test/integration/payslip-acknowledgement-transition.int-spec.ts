import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * G12-4 — DB FSM trigger 0131 + CHECK cho payslip_acknowledgements (defense-in-depth). RED-first:
 *  - trigger chỉ cho disputed→resolved; chặn acknowledged→*, disputed→acknowledged, resolved→*.
 *  - CHECK: khiếu nại PHẢI có reason; resolved PHẢI có resolved_by + resolved_at.
 * Test ở tầng DB qua app role (RLS) — KHÔNG qua service.
 */
describe.skipIf(!hasDb)("G12-4 payslip_acknowledgements DB FSM trigger + CHECK", () => {
  const direct = directPool();
  const app = appPool();
  let A: SeededTenant;
  let emp: string;
  let payslipId: string;

  async function asApp<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
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

  /**
   * Seed 1 ack row trực tiếp với status cho trước. Trả về ack id. Mỗi lần dùng 1 user MỚI để khác khoá
   * unique (company,payslip,user) — các test độc lập trên cùng payslip.
   */
  async function seedAck(status: "acknowledged" | "disputed", reason?: string): Promise<string> {
    const u = await seedUser(direct, A.companyId, `packtr-u-${randomUUID().slice(0, 8)}@a.test`);
    const r = await direct.query(
      `INSERT INTO payslip_acknowledgements (company_id, payslip_id, user_id, status, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [A.companyId, payslipId, u, status, reason ?? null],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "packtr");
    emp = await seedUser(direct, A.companyId, `packtr-${randomUUID().slice(0, 8)}@a.test`);
    const period = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status) VALUES ($1, '2026-03', 'draft') RETURNING id`,
      [A.companyId],
    );
    const ps = await direct.query(
      `INSERT INTO payslips
         (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, entry_kind)
       VALUES ($1, $2, $3, 5000.00, 5000.00, 5000.00, $3, 'original') RETURNING id`,
      [A.companyId, period.rows[0].id, emp],
    );
    payslipId = ps.rows[0].id as string;
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
    await app.end();
  });

  it("trigger: acknowledged→disputed bị chặn", async () => {
    const id = await seedAck("acknowledged");
    await expect(
      asApp((c) =>
        c.query(`UPDATE payslip_acknowledgements SET status='disputed', reason='x' WHERE id=$1`, [
          id,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("trigger: disputed→acknowledged bị chặn", async () => {
    const id = await seedAck("disputed", "lý do");
    await expect(
      asApp((c) =>
        c.query(`UPDATE payslip_acknowledgements SET status='acknowledged' WHERE id=$1`, [id]),
      ),
    ).rejects.toThrow();
  });

  it("trigger: resolved→disputed bị chặn (resolved là terminal)", async () => {
    const id = await seedAck("disputed", "lý do");
    // Đưa về resolved hợp lệ trước (disputed→resolved), rồi thử rời resolved.
    await direct.query(
      `UPDATE payslip_acknowledgements SET status='resolved', resolved_by=$2, resolved_at=now() WHERE id=$1`,
      [id, emp],
    );
    await expect(
      asApp((c) =>
        c.query(`UPDATE payslip_acknowledgements SET status='disputed' WHERE id=$1`, [id]),
      ),
    ).rejects.toThrow();
  });

  it("trigger: disputed→resolved ĐƯỢC PHÉP (HR xử lý)", async () => {
    const id = await seedAck("disputed", "lý do");
    await expect(
      asApp((c) =>
        c.query(
          `UPDATE payslip_acknowledgements SET status='resolved', resolved_by=$2, resolved_at=now() WHERE id=$1`,
          [id, emp],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("CHECK: khiếu nại (disputed) KHÔNG có reason bị từ chối", async () => {
    await expect(
      asApp((c) =>
        c.query(
          `INSERT INTO payslip_acknowledgements (company_id, payslip_id, user_id, status)
           VALUES ($1, $2, $3, 'disputed')`,
          [A.companyId, payslipId, emp],
        ),
      ),
    ).rejects.toThrow();
  });

  it("CHECK: resolved KHÔNG có resolved_by/resolved_at bị từ chối", async () => {
    const id = await seedAck("disputed", "lý do");
    await expect(
      asApp((c) =>
        c.query(`UPDATE payslip_acknowledgements SET status='resolved' WHERE id=$1`, [id]),
      ),
    ).rejects.toThrow();
  });
});
