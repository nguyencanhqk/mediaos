import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * G12-3 — FSM duyệt + đóng băng tiền sau duyệt + CHECK, ép Ở TẦNG DB (trigger 0098 + CHECK constraints).
 * Đây là lớp 2 (sau service) cho lõi tính tiền — phải ĐỎ nếu trigger/CHECK biến mất.
 *  (1) draft→approved hợp lệ; (2) approved→draft / approved→rejected / rejected→approved bị chặn (trigger);
 *  (3) đóng băng: sửa amount/kind/user/period/reference trên hàng approved bị chặn;
 *  (4) amount > 0 (CHECK); (5) reference đúng-một-hoặc-không (CHECK);
 *  (6) consume re-bind sang kỳ khác bị chặn (trigger).
 * Chạy UPDATE/INSERT qua app role (mediaos_app) trong ngữ cảnh tenant; seed qua direct (superuser).
 */
describe.skipIf(!hasDb)("G12-3 bonus/penalty FSM + freeze + CHECK (DB enforcement)", () => {
  const direct = directPool();
  const app = appPool();
  let A: SeededTenant;
  let emp: string;
  let approver: string;
  let periodId: string;
  let period2Id: string;

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

  /** Seed 1 bonus_penalty qua direct (INSERT không có trigger — trigger chỉ BEFORE UPDATE). */
  async function seedBonus(opts: {
    status?: string;
    approved?: boolean;
    payrollPeriodId?: string;
  }): Promise<string> {
    const approved = opts.approved || opts.status === "approved";
    const r = await direct.query(
      `INSERT INTO bonus_penalties
         (company_id, user_id, kind, amount, period_month, status, created_by,
          approved_by, approved_at, payroll_period_id, consumed_at)
       VALUES ($1, $2, 'bonus', 500.00, '2026-05', $3, $2,
               $4, $5, $6, $7)
       RETURNING id`,
      [
        A.companyId,
        emp,
        opts.status ?? "draft",
        approved ? approver : null,
        approved ? new Date().toISOString() : null,
        opts.payrollPeriodId ?? null,
        opts.payrollPeriodId ? new Date().toISOString() : null,
      ],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "bptrans");
    emp = await seedUser(direct, A.companyId, `bpt-emp-${randomUUID().slice(0, 8)}@a.test`);
    approver = await seedUser(direct, A.companyId, `bpt-apr-${randomUUID().slice(0, 8)}@a.test`);
    const p1 = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status)
       VALUES ($1, '2026-05', 'draft') RETURNING id`,
      [A.companyId],
    );
    periodId = p1.rows[0].id as string;
    const p2 = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status)
       VALUES ($1, '2026-06', 'draft') RETURNING id`,
      [A.companyId],
    );
    period2Id = p2.rows[0].id as string;
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await app.end();
    await direct.end();
  });

  it("(1) draft→approved is allowed (sets approver pair)", async () => {
    const id = await seedBonus({ status: "draft" });
    await expect(
      asApp(A.companyId, (c) =>
        c.query(
          `UPDATE bonus_penalties SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1`,
          [id, approver],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("(2) approved→draft / approved→rejected / rejected→approved blocked by trigger", async () => {
    const appr = await seedBonus({ status: "approved" });
    await expect(
      asApp(A.companyId, (c) =>
        c.query(`UPDATE bonus_penalties SET status='draft' WHERE id=$1`, [appr]),
      ),
    ).rejects.toThrow();
    await expect(
      asApp(A.companyId, (c) =>
        c.query(`UPDATE bonus_penalties SET status='rejected' WHERE id=$1`, [appr]),
      ),
    ).rejects.toThrow();
    const rej = await seedBonus({ status: "rejected" });
    await expect(
      asApp(A.companyId, (c) =>
        c.query(
          `UPDATE bonus_penalties SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1`,
          [rej, approver],
        ),
      ),
    ).rejects.toThrow();
  });

  it("(3) freeze: editing amount/kind/user/period/reference on approved row blocked by trigger", async () => {
    const appr = await seedBonus({ status: "approved" });
    await expect(
      asApp(A.companyId, (c) =>
        c.query(`UPDATE bonus_penalties SET amount=9999.00 WHERE id=$1`, [appr]),
      ),
    ).rejects.toThrow();
    await expect(
      asApp(A.companyId, (c) =>
        c.query(`UPDATE bonus_penalties SET kind='penalty' WHERE id=$1`, [appr]),
      ),
    ).rejects.toThrow();
    await expect(
      asApp(A.companyId, (c) =>
        c.query(`UPDATE bonus_penalties SET period_month='2026-07' WHERE id=$1`, [appr]),
      ),
    ).rejects.toThrow();
  });

  it("(4) amount must be > 0 (CHECK)", async () => {
    await expect(
      asApp(A.companyId, (c) =>
        c.query(
          `INSERT INTO bonus_penalties (company_id, user_id, kind, amount, period_month, status, created_by)
           VALUES ($1, $2, 'bonus', 0, '2026-05', 'draft', $2)`,
          [A.companyId, emp],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asApp(A.companyId, (c) =>
        c.query(
          `INSERT INTO bonus_penalties (company_id, user_id, kind, amount, period_month, status, created_by)
           VALUES ($1, $2, 'penalty', -5, '2026-05', 'draft', $2)`,
          [A.companyId, emp],
        ),
      ),
    ).rejects.toThrow();
  });

  it("(5) reference must be exactly-one-or-none matching reference_type (CHECK)", async () => {
    const taskId = (
      await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round)
         VALUES ($1, 'meeting_action', 'bpt', 'not_started', 'initial', 0) RETURNING id`,
        [A.companyId],
      )
    ).rows[0].id as string;
    // reference_type='task' but task_id NULL → reject.
    await expect(
      asApp(A.companyId, (c) =>
        c.query(
          `INSERT INTO bonus_penalties (company_id, user_id, kind, amount, period_month, status, created_by, reference_type)
           VALUES ($1, $2, 'bonus', 100, '2026-05', 'draft', $2, 'task')`,
          [A.companyId, emp],
        ),
      ),
    ).rejects.toThrow();
    // reference_type NULL but task_id set → reject.
    await expect(
      asApp(A.companyId, (c) =>
        c.query(
          `INSERT INTO bonus_penalties (company_id, user_id, kind, amount, period_month, status, created_by, task_id)
           VALUES ($1, $2, 'bonus', 100, '2026-05', 'draft', $2, $3)`,
          [A.companyId, emp, taskId],
        ),
      ),
    ).rejects.toThrow();
    // reference_type='task' + matching task_id → OK.
    await expect(
      asApp(A.companyId, (c) =>
        c.query(
          `INSERT INTO bonus_penalties (company_id, user_id, kind, amount, period_month, status, created_by, reference_type, task_id)
           VALUES ($1, $2, 'bonus', 100, '2026-05', 'draft', $2, 'task', $3)`,
          [A.companyId, emp, taskId],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("(6) consume re-bind to a different period blocked by trigger", async () => {
    const consumed = await seedBonus({ status: "approved", payrollPeriodId: periodId });
    await expect(
      asApp(A.companyId, (c) =>
        c.query(`UPDATE bonus_penalties SET payroll_period_id=$2 WHERE id=$1`, [
          consumed,
          period2Id,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("(7) freeze currency + block soft-delete after approval (trigger)", async () => {
    const appr = await seedBonus({ status: "approved" });
    await expect(
      asApp(A.companyId, (c) =>
        c.query(`UPDATE bonus_penalties SET currency='USD' WHERE id=$1`, [appr]),
      ),
    ).rejects.toThrow();
    await expect(
      asApp(A.companyId, (c) =>
        c.query(`UPDATE bonus_penalties SET deleted_at=now() WHERE id=$1`, [appr]),
      ),
    ).rejects.toThrow();
  });

  it("(8) cannot consume a draft/rejected row (consume_approved CHECK)", async () => {
    const draftId = await seedBonus({ status: "draft" });
    await expect(
      asApp(A.companyId, (c) =>
        c.query(`UPDATE bonus_penalties SET payroll_period_id=$2, consumed_at=now() WHERE id=$1`, [
          draftId,
          periodId,
        ]),
      ),
    ).rejects.toThrow();
  });
});
