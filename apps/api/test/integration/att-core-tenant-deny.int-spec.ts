import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S3-ATT-DB-1 — ATT Core deny-path (RED before GREEN, mig 0452).
 *
 * 1. RLS cross-tenant deny trên 7 bảng MỚI: withTenant(A) KHÔNG thấy hàng B + INSERT company_id=B bị
 *    WITH CHECK chặn. (rls-tenant-isolation pattern.)
 * 2. UNIQUE anti-dup attendance_records: employee_id NON-NULL → 2 record cùng (company,employee,date,shift)
 *    vi phạm; biến thể shift_id NULL. (Guard LIVE hiện vẫn là user_id-uq cũ — index mới forward-looking.)
 * 3. Backfill assert: KHÔNG còn row có user_id mà employee_profiles tồn tại nhưng employee_id vẫn NULL.
 *
 * Gate: hasDb && LANE_DB — .env làm hasDb=true → thiếu LANE_DB thì chạy DB dev chung ⇒ đỏ-giả
 * (memory: integration-test-lane-db-gate). LANE_DB bắt buộc cho DB cô lập mediaos_<lane>.
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

async function asTenant<T>(
  app: Pool,
  companyId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
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

/** Seed full FK-chain for B's rows on each of the 7 new tables (direct/superuser, bypass RLS). */
async function seedAttRowsForTenant(
  direct: Pool,
  companyId: string,
  userId: string,
  employeeId: string,
): Promise<Record<string, string>> {
  const shift = await direct.query(
    `INSERT INTO shifts (company_id, shift_code, name, required_working_minutes)
     VALUES ($1, $2, 'Ca test', 480) RETURNING id`,
    [companyId, `SH-${randomUUID().slice(0, 8)}`],
  );
  const shiftId = shift.rows[0].id as string;

  const assignment = await direct.query(
    `INSERT INTO shift_assignments
       (company_id, shift_id, assignment_scope, employee_id, effective_from)
     VALUES ($1, $2, 'Employee', $3, '2026-06-01') RETURNING id`,
    [companyId, shiftId, employeeId],
  );

  const rule = await direct.query(
    `INSERT INTO attendance_rules
       (company_id, rule_code, name, rule_scope, effective_from)
     VALUES ($1, $2, 'Rule test', 'Company', '2026-06-01') RETURNING id`,
    [companyId, `RU-${randomUUID().slice(0, 8)}`],
  );

  const log = await direct.query(
    `INSERT INTO attendance_logs
       (company_id, employee_id, work_date, log_type, source)
     VALUES ($1, $2, '2026-06-03', 'Check-in', 'WEB') RETURNING id`,
    [companyId, employeeId],
  );

  const req = await direct.query(
    `INSERT INTO attendance_adjustment_requests
       (company_id, user_id, employee_id, work_date, request_type, reason, status, requested_check_in_at)
     VALUES ($1, $2, $3, '2026-06-03', 'MISSING_CHECK_IN', 'reason', 'pending', '2026-06-03T02:00:00Z')
     RETURNING id`,
    [companyId, userId, employeeId],
  );
  const requestId = req.rows[0].id as string;

  const item = await direct.query(
    `INSERT INTO attendance_adjustment_items
       (company_id, request_id, field_name, new_value)
     VALUES ($1, $2, 'check_in_at', '"2026-06-03T01:00:00Z"'::jsonb) RETURNING id`,
    [companyId, requestId],
  );

  const rwr = await direct.query(
    `INSERT INTO remote_work_requests
       (company_id, employee_id, request_type, start_date, end_date, reason, requested_by, status)
     VALUES ($1, $2, 'Remote', '2026-06-03', '2026-06-03', 'remote', $3, 'Pending') RETURNING id`,
    [companyId, employeeId, userId],
  );
  const remoteRequestId = rwr.rows[0].id as string;

  const appr = await direct.query(
    `INSERT INTO remote_work_request_approvals
       (company_id, remote_work_request_id, step_order, approver_user_id, action)
     VALUES ($1, $2, 1, $3, 'Submitted') RETURNING id`,
    [companyId, remoteRequestId, userId],
  );

  return {
    shifts: shiftId,
    shift_assignments: assignment.rows[0].id as string,
    attendance_rules: rule.rows[0].id as string,
    attendance_logs: log.rows[0].id as string,
    attendance_adjustment_items: item.rows[0].id as string,
    remote_work_requests: remoteRequestId,
    remote_work_request_approvals: appr.rows[0].id as string,
  };
}

describe.skipIf(!hasLaneDb)("S3-ATT-DB-1 ATT Core deny-path + anti-dup + backfill", () => {
  const direct = directPool();
  const app = appPool(2);

  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let userB: string;
  let empA: string;
  let empB: string;
  let bRows: Record<string, string>;

  beforeAll(async () => {
    A = await seedCompany(direct, "att-deny-a");
    B = await seedCompany(direct, "att-deny-b");
    userA = await seedUser(direct, A.companyId, `att-a-${A.slug}@x.test`);
    userB = await seedUser(direct, B.companyId, `att-b-${B.slug}@x.test`);

    empA = (
      await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
        [A.companyId, userA],
      )
    ).rows[0].id as string;
    empB = (
      await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
        [B.companyId, userB],
      )
    ).rows[0].id as string;

    bRows = await seedAttRowsForTenant(direct, B.companyId, userB, empB);
  });

  afterAll(async () => {
    // Clean ATT-new tables before cleanupTenants (which doesn't know about them).
    for (const companyId of [A.companyId, B.companyId]) {
      await direct.query("DELETE FROM remote_work_request_approvals WHERE company_id = $1", [
        companyId,
      ]);
      await direct.query("DELETE FROM remote_work_requests WHERE company_id = $1", [companyId]);
      await direct.query("DELETE FROM attendance_adjustment_items WHERE company_id = $1", [
        companyId,
      ]);
      await direct.query("DELETE FROM attendance_logs WHERE company_id = $1", [companyId]);
      await direct.query("DELETE FROM shift_assignments WHERE company_id = $1", [companyId]);
      await direct.query("DELETE FROM attendance_rules WHERE company_id = $1", [companyId]);
      await direct.query("DELETE FROM shifts WHERE company_id = $1", [companyId]);
    }
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  // ── 1. RLS cross-tenant deny on 7 new tables ──────────────────────────────
  const NEW_TABLES = [
    "shifts",
    "shift_assignments",
    "attendance_rules",
    "attendance_logs",
    "attendance_adjustment_items",
    "remote_work_requests",
    "remote_work_request_approvals",
  ] as const;

  for (const table of NEW_TABLES) {
    describe(`${table} (RLS cross-tenant)`, () => {
      it(`withTenant(A): cannot SELECT B's ${table} row (RLS USING)`, async () => {
        const rows = await asTenant(app, A.companyId, async (c) => {
          const r = await c.query(`SELECT id FROM ${table} WHERE id = $1`, [bRows[table]]);
          return r.rows;
        });
        expect(rows).toHaveLength(0);
      });
    });
  }

  it("withTenant(A): INSERT shifts with company_id = B is rejected by RLS WITH CHECK", async () => {
    await expect(
      asTenant(app, A.companyId, async (c) => {
        await c.query(
          `INSERT INTO shifts (company_id, shift_code, name, required_working_minutes)
           VALUES ($1, $2, 'forge', 480)`,
          [B.companyId, `forge-${randomUUID().slice(0, 8)}`],
        );
      }),
    ).rejects.toThrow();
  });

  it("withTenant(A): INSERT attendance_logs with company_id = B is rejected by RLS WITH CHECK", async () => {
    await expect(
      asTenant(app, A.companyId, async (c) => {
        await c.query(
          `INSERT INTO attendance_logs (company_id, employee_id, work_date, log_type, source)
           VALUES ($1, $2, '2026-06-03', 'Check-in', 'WEB')`,
          [B.companyId, empB],
        );
      }),
    ).rejects.toThrow();
  });

  // ── 2. UNIQUE anti-dup (employee_id NON-NULL) ─────────────────────────────
  describe("attendance_records anti-dup (employee_id NOT NULL — forward-looking unique)", () => {
    it("2 records same (company, employee, date, shift) with shift_id NOT NULL → unique violation", async () => {
      const shift = await direct.query(
        `INSERT INTO shifts (company_id, shift_code, name, required_working_minutes)
         VALUES ($1, $2, 'dup-shift', 480) RETURNING id`,
        [A.companyId, `DUP-${randomUUID().slice(0, 8)}`],
      );
      const shiftId = shift.rows[0].id as string;
      const dupUser = await seedUser(direct, A.companyId, `dup-${randomUUID().slice(0, 8)}@x.test`);

      await direct.query(
        `INSERT INTO attendance_records (company_id, user_id, employee_id, work_date, shift_id, status)
         VALUES ($1, $2, $3, '2026-07-01', $4, 'present')`,
        [A.companyId, dupUser, empA, shiftId],
      );
      // Second insert: same employee/date/shift → violates uq_attendance_records_employee_date_shift.
      const dupUser2 = await seedUser(
        direct,
        A.companyId,
        `dup2-${randomUUID().slice(0, 8)}@x.test`,
      );
      await expect(
        direct.query(
          `INSERT INTO attendance_records (company_id, user_id, employee_id, work_date, shift_id, status)
           VALUES ($1, $2, $3, '2026-07-01', $4, 'present')`,
          [A.companyId, dupUser2, empA, shiftId],
        ),
      ).rejects.toThrow(/uq_attendance_records_employee_date_shift|duplicate key/);
    });

    it("2 records same (company, employee, date) with shift_id NULL → unique violation", async () => {
      const dupUser = await seedUser(
        direct,
        A.companyId,
        `dupn-${randomUUID().slice(0, 8)}@x.test`,
      );
      await direct.query(
        `INSERT INTO attendance_records (company_id, user_id, employee_id, work_date, status)
         VALUES ($1, $2, $3, '2026-07-02', 'present')`,
        [A.companyId, dupUser, empA],
      );
      const dupUser2 = await seedUser(
        direct,
        A.companyId,
        `dupn2-${randomUUID().slice(0, 8)}@x.test`,
      );
      await expect(
        direct.query(
          `INSERT INTO attendance_records (company_id, user_id, employee_id, work_date, status)
           VALUES ($1, $2, $3, '2026-07-02', 'present')`,
          [A.companyId, dupUser2, empA],
        ),
      ).rejects.toThrow(/uq_attendance_records_employee_date_no_shift|duplicate key/);
    });
  });

  // ── 3. Backfill assert ────────────────────────────────────────────────────
  describe("backfill attendance_records.employee_id from employee_profiles", () => {
    it("a record seeded for a user WITH an employee_profile has employee_id backfilled (re-run idempotent)", async () => {
      // Seed a fresh attendance_records row WITHOUT employee_id (legacy media-era shape: user_id only).
      const bfUser = await seedUser(direct, A.companyId, `bf-${randomUUID().slice(0, 8)}@x.test`);
      const bfEmp = (
        await direct.query(
          `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
          [A.companyId, bfUser],
        )
      ).rows[0].id as string;
      await direct.query(
        `INSERT INTO attendance_records (company_id, user_id, work_date, status)
         VALUES ($1, $2, '2026-08-01', 'present')`,
        [A.companyId, bfUser],
      );

      // Run the SAME backfill statement as mig 0452 §5 (idempotent — sets only where employee_id IS NULL).
      await direct.query(
        `UPDATE attendance_records ar
            SET employee_id = ep.id
           FROM employee_profiles ep
          WHERE ep.user_id = ar.user_id
            AND ep.company_id = ar.company_id
            AND ep.deleted_at IS NULL
            AND ar.employee_id IS NULL`,
      );

      const { rows } = await direct.query(
        `SELECT employee_id FROM attendance_records WHERE company_id = $1 AND user_id = $2`,
        [A.companyId, bfUser],
      );
      expect(rows[0].employee_id).toBe(bfEmp);
    });

    it("NO row where employee_profiles exists for user_id but employee_id stayed NULL (post-backfill invariant)", async () => {
      const { rows } = await direct.query(
        `SELECT ar.id
           FROM attendance_records ar
           JOIN employee_profiles ep
             ON ep.user_id = ar.user_id
            AND ep.company_id = ar.company_id
            AND ep.deleted_at IS NULL
          WHERE ar.company_id = $1
            AND ar.employee_id IS NULL
            AND ar.deleted_at IS NULL`,
        [A.companyId],
      );
      expect(rows).toHaveLength(0);
    });
  });
});
