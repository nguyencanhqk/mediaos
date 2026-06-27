import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S3-LEAVE-DB-1 — APPEND-ONLY ledger LEAVE (BẤT BIẾN #2, mig 0453).
 *
 * 2 bảng append-only: leave_balance_transactions · leave_request_approvals.
 * app role (mediaos_app) GRANT SELECT,INSERT ONLY — KHÔNG UPDATE/DELETE → UPDATE/DELETE bằng app role
 * PHẢI BỊ TỪ CHỐI (permission denied). DB-05 §4.10 (ledger đảo chiều thay vì sửa) / §7.7 (history append-only).
 * Mirror pattern: attendance-logs-appendonly.int-spec.ts.
 *
 * Gate: skipIf(!(hasDb && LANE_DB)) — .env làm hasDb=true → chỉ gate !hasDb thì suite chạy DB dev chung khi
 * KHÔNG set LANE_DB ⇒ đỏ-giả (memory: integration-test-lane-db-gate). LANE_DB bắt buộc cho DB cô lập.
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("S3-LEAVE-DB-1 LEAVE ledger append-only (mediaos_app)", () => {
  const direct = directPool();
  const app = appPool();

  let A: SeededTenant;
  let userId: string;
  let employeeId: string;
  let leaveTypeId: string;
  let leaveBalanceId: string;
  let txId: string;
  let leaveRequestId: string;
  let approvalId: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "leave-ao");
    userId = await seedUser(direct, A.companyId, `leave-ao-${A.slug}@x.test`);

    const emp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
      [A.companyId, userId],
    );
    employeeId = emp.rows[0].id as string;

    const lt = await direct.query(
      `INSERT INTO leave_types (company_id, name, code) VALUES ($1, 'ao-lt', $2) RETURNING id`,
      [A.companyId, `ao-lt-${randomUUID().slice(0, 8)}`],
    );
    leaveTypeId = lt.rows[0].id as string;

    const lb = await direct.query(
      `INSERT INTO leave_balances (company_id, user_id, leave_type_id, year, total_days)
       VALUES ($1, $2, $3, 2026, 12) RETURNING id`,
      [A.companyId, userId, leaveTypeId],
    );
    leaveBalanceId = lb.rows[0].id as string;

    // leave_balance_transactions seed row (the row app role will try to mutate → expects denial).
    const tx = await direct.query(
      `INSERT INTO leave_balance_transactions
         (company_id, leave_balance_id, employee_id, leave_type_id, transaction_type, transaction_date, amount_days, created_by_type)
       VALUES ($1, $2, $3, $4, 'GRANT', '2026-01-01', 12, 'System') RETURNING id`,
      [A.companyId, leaveBalanceId, employeeId, leaveTypeId],
    );
    txId = tx.rows[0].id as string;

    const lr = await direct.query(
      `INSERT INTO leave_requests
         (company_id, user_id, leave_type_id, start_date, end_date, total_days, status)
       VALUES ($1, $2, $3, '2026-06-03', '2026-06-03', 1, 'Pending') RETURNING id`,
      [A.companyId, userId, leaveTypeId],
    );
    leaveRequestId = lr.rows[0].id as string;

    const appr = await direct.query(
      `INSERT INTO leave_request_approvals
         (company_id, leave_request_id, approval_step, approver_user_id, action)
       VALUES ($1, $2, 1, $3, 'SUBMIT') RETURNING id`,
      [A.companyId, leaveRequestId, userId],
    );
    approvalId = appr.rows[0].id as string;
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
    await app.end();
  });

  /** Run fn inside a transaction as app role with tenant context set. */
  async function asTenant<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      const r = await fn(c);
      await c.query("COMMIT");
      return r;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  // ── leave_balance_transactions ────────────────────────────────────────────
  describe("leave_balance_transactions", () => {
    it("INSERT via app role SUCCEEDS (GRANT SELECT,INSERT)", async () => {
      const inserted = await asTenant(A.companyId, async (c) => {
        const r = await c.query(
          `INSERT INTO leave_balance_transactions
             (leave_balance_id, employee_id, leave_type_id, transaction_type, transaction_date, amount_days, created_by_type)
           VALUES ($1, $2, $3, 'USE', '2026-06-03', -1, 'User') RETURNING id`,
          [leaveBalanceId, employeeId, leaveTypeId],
        );
        return r.rows[0].id as string;
      });
      expect(inserted).toBeTruthy();
    });

    it("app role UPDATE is DENIED (append-only — no UPDATE grant)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`UPDATE leave_balance_transactions SET amount_days = 0 WHERE id = $1`, [
            txId,
          ]);
        }),
      ).rejects.toThrow(/permission denied/);
    });

    it("app role DELETE is DENIED (append-only — no DELETE grant)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`DELETE FROM leave_balance_transactions WHERE id = $1`, [txId]);
        }),
      ).rejects.toThrow(/permission denied/);
    });
  });

  // ── leave_request_approvals ───────────────────────────────────────────────
  describe("leave_request_approvals", () => {
    it("INSERT via app role SUCCEEDS (GRANT SELECT,INSERT)", async () => {
      const inserted = await asTenant(A.companyId, async (c) => {
        const r = await c.query(
          `INSERT INTO leave_request_approvals
             (leave_request_id, approval_step, approver_user_id, action)
           VALUES ($1, 2, $2, 'APPROVE') RETURNING id`,
          [leaveRequestId, userId],
        );
        return r.rows[0].id as string;
      });
      expect(inserted).toBeTruthy();
    });

    it("app role UPDATE is DENIED (append-only)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`UPDATE leave_request_approvals SET action = 'REJECT' WHERE id = $1`, [
            approvalId,
          ]);
        }),
      ).rejects.toThrow(/permission denied/);
    });

    it("app role DELETE is DENIED (append-only)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`DELETE FROM leave_request_approvals WHERE id = $1`, [approvalId]);
        }),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("sanity: seeded ids are distinct", () => {
    expect(new Set([txId, approvalId, randomUUID()]).size).toBe(3);
  });
});
