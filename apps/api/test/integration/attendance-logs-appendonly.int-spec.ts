import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S3-ATT-DB-1 — APPEND-ONLY ledger ATT (BẤT BIẾN #2, mig 0452).
 *
 * 3 bảng append-only: attendance_logs · attendance_adjustment_items · remote_work_request_approvals.
 * app role (mediaos_app) GRANT SELECT,INSERT ONLY — KHÔNG UPDATE/DELETE → UPDATE/DELETE bằng app role
 * PHẢI BỊ TỪ CHỐI (permission denied). CLAUDE.md §2 THẮNG DB-04 §7.5 (logs có deleted_at parity nhưng app
 * KHÔNG sửa được). Mirror pattern: file-access-logs-appendonly.int-spec.ts.
 *
 * Gate: skipIf(!hasDb || !LANE_DB) — .env làm hasDb=true → chỉ gate !hasDb thì suite chạy DB dev chung khi
 * KHÔNG set LANE_DB ⇒ đỏ-giả (memory: integration-test-lane-db-gate). LANE_DB bắt buộc cho DB cô lập.
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("S3-ATT-DB-1 ATT ledger append-only (mediaos_app)", () => {
  const direct = directPool();
  const app = appPool();

  let A: SeededTenant;
  let userId: string;
  let employeeId: string;
  let logId: string;
  let requestId: string;
  let itemId: string;
  let remoteRequestId: string;
  let approvalId: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "att-ao");
    userId = await seedUser(direct, A.companyId, `att-ao-${A.slug}@x.test`);

    // employee_profiles (FK employee_id) via superuser (bypass RLS).
    const emp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
      [A.companyId, userId],
    );
    employeeId = emp.rows[0].id as string;

    // attendance_logs seed row (the row app role will try to mutate → expects denial).
    const l = await direct.query(
      `INSERT INTO attendance_logs
         (company_id, employee_id, work_date, log_type, source)
       VALUES ($1, $2, '2026-06-03', 'Check-in', 'WEB') RETURNING id`,
      [A.companyId, employeeId],
    );
    logId = l.rows[0].id as string;

    // attendance_adjustment_requests (FK parent for items) — note: old user_id NOT NULL kept.
    const req = await direct.query(
      `INSERT INTO attendance_adjustment_requests
         (company_id, user_id, employee_id, work_date, request_type, reason, status, requested_check_in_at)
       VALUES ($1, $2, $3, '2026-06-03', 'MISSING_CHECK_IN', 'ao-reason', 'pending', '2026-06-03T02:00:00Z')
       RETURNING id`,
      [A.companyId, userId, employeeId],
    );
    requestId = req.rows[0].id as string;

    const item = await direct.query(
      `INSERT INTO attendance_adjustment_items
         (company_id, request_id, field_name, new_value)
       VALUES ($1, $2, 'check_in_at', '"2026-06-03T01:00:00Z"'::jsonb) RETURNING id`,
      [A.companyId, requestId],
    );
    itemId = item.rows[0].id as string;

    // remote_work_requests (parent for approvals).
    const rwr = await direct.query(
      `INSERT INTO remote_work_requests
         (company_id, employee_id, request_type, start_date, end_date, reason, requested_by, status)
       VALUES ($1, $2, 'Remote', '2026-06-03', '2026-06-03', 'ao-remote', $3, 'Pending') RETURNING id`,
      [A.companyId, employeeId, userId],
    );
    remoteRequestId = rwr.rows[0].id as string;

    const appr = await direct.query(
      `INSERT INTO remote_work_request_approvals
         (company_id, remote_work_request_id, step_order, approver_user_id, action)
       VALUES ($1, $2, 1, $3, 'Submitted') RETURNING id`,
      [A.companyId, remoteRequestId, userId],
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

  // ── attendance_logs ───────────────────────────────────────────────────────
  describe("attendance_logs", () => {
    it("INSERT via app role SUCCEEDS (GRANT SELECT,INSERT)", async () => {
      const inserted = await asTenant(A.companyId, async (c) => {
        const r = await c.query(
          `INSERT INTO attendance_logs
             (employee_id, work_date, log_type, source)
           VALUES ($1, '2026-06-04', 'Check-out', 'WEB') RETURNING id`,
          [employeeId],
        );
        return r.rows[0].id as string;
      });
      expect(inserted).toBeTruthy();
    });

    it("app role UPDATE is DENIED (append-only — no UPDATE grant)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`UPDATE attendance_logs SET is_valid = false WHERE id = $1`, [logId]);
        }),
      ).rejects.toThrow(/permission denied/);
    });

    it("app role DELETE is DENIED (append-only — no DELETE grant)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`DELETE FROM attendance_logs WHERE id = $1`, [logId]);
        }),
      ).rejects.toThrow(/permission denied/);
    });
  });

  // ── attendance_adjustment_items ───────────────────────────────────────────
  describe("attendance_adjustment_items", () => {
    it("INSERT via app role SUCCEEDS (GRANT SELECT,INSERT)", async () => {
      const inserted = await asTenant(A.companyId, async (c) => {
        const r = await c.query(
          `INSERT INTO attendance_adjustment_items
             (request_id, field_name, new_value)
           VALUES ($1, 'note', '"app-inserted"'::jsonb) RETURNING id`,
          [requestId],
        );
        return r.rows[0].id as string;
      });
      expect(inserted).toBeTruthy();
    });

    it("app role UPDATE is DENIED (append-only)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`UPDATE attendance_adjustment_items SET is_applied = true WHERE id = $1`, [
            itemId,
          ]);
        }),
      ).rejects.toThrow(/permission denied/);
    });

    it("app role DELETE is DENIED (append-only)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`DELETE FROM attendance_adjustment_items WHERE id = $1`, [itemId]);
        }),
      ).rejects.toThrow(/permission denied/);
    });
  });

  // ── remote_work_request_approvals ─────────────────────────────────────────
  describe("remote_work_request_approvals", () => {
    it("INSERT via app role SUCCEEDS (GRANT SELECT,INSERT)", async () => {
      const inserted = await asTenant(A.companyId, async (c) => {
        const r = await c.query(
          `INSERT INTO remote_work_request_approvals
             (remote_work_request_id, step_order, approver_user_id, action)
           VALUES ($1, 2, $2, 'Approved') RETURNING id`,
          [remoteRequestId, userId],
        );
        return r.rows[0].id as string;
      });
      expect(inserted).toBeTruthy();
    });

    it("app role UPDATE is DENIED (append-only)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(
            `UPDATE remote_work_request_approvals SET action = 'Rejected' WHERE id = $1`,
            [approvalId],
          );
        }),
      ).rejects.toThrow(/permission denied/);
    });

    it("app role DELETE is DENIED (append-only)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`DELETE FROM remote_work_request_approvals WHERE id = $1`, [approvalId]);
        }),
      ).rejects.toThrow(/permission denied/);
    });
  });

  // Silence unused-var lint for randomUUID import parity with sibling specs.
  it("sanity: seeded ids are distinct", () => {
    expect(new Set([logId, itemId, approvalId, randomUUID()]).size).toBe(4);
  });
});
