import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S3-LEAVE-DB-1 — POSITIVE RLS write + union status CHECK + cột DB-05 mới (mig 0453).
 *
 * Chứng minh trên DB KHÔNG rỗng dưới RLS (app role + set_config app.current_company_id):
 *   1. INSERT leave_requests status='Pending' (TitleCase SPEC-05) + cột DB-05 mới (duration_type/
 *      balance_effect_status/attendance_sync_status/employee_id/leave_request_code…) → THÀNH CÔNG.
 *   2. INSERT status='pending' (lowercase legacy) → THÀNH CÔNG (union CHECK không vỡ dữ liệu cũ).
 *   3. INSERT status='bogus' → BỊ TỪ CHỐI (union CHECK vẫn enforce, không allow-all).
 *
 * Gate: skipIf(!(hasDb && LANE_DB)) — DB cô lập bắt buộc (memory: integration-test-lane-db-gate).
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("S3-LEAVE-DB-1 leave_requests RLS positive + status union", () => {
  const direct = directPool();
  const app = appPool();

  let A: SeededTenant;
  let userId: string;
  let employeeId: string;
  let leaveTypeId: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "leave-pos");
    userId = await seedUser(direct, A.companyId, `leave-pos-${A.slug}@x.test`);
    const emp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
      [A.companyId, userId],
    );
    employeeId = emp.rows[0].id as string;
    const lt = await direct.query(
      `INSERT INTO leave_types (company_id, name, code) VALUES ($1, 'pos-lt', $2) RETURNING id`,
      [A.companyId, `pos-lt-${randomUUID().slice(0, 8)}`],
    );
    leaveTypeId = lt.rows[0].id as string;
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
    await app.end();
  });

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

  it("app role INSERT status='Pending' (TitleCase) + cột DB-05 mới SUCCEEDS under RLS", async () => {
    const inserted = await asTenant(A.companyId, async (c) => {
      const r = await c.query(
        `INSERT INTO leave_requests
           (user_id, employee_id, leave_type_id, leave_request_code, start_date, end_date,
            total_days, duration_type, status, balance_effect_status, attendance_sync_status)
         VALUES ($1, $2, $3, $4, '2026-07-01', '2026-07-01', 1, 'FullDay', 'Pending', 'Reserved', 'Pending')
         RETURNING id, company_id`,
        [userId, employeeId, leaveTypeId, `LR-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0] as { id: string; company_id: string };
    });
    expect(inserted.id).toBeTruthy();
    // company_id mặc định = app.current_company_id (DEFAULT NULLIF(current_setting…)).
    expect(inserted.company_id).toBe(A.companyId);
  });

  it("app role INSERT status='pending' (lowercase legacy) SUCCEEDS (union không vỡ)", async () => {
    const inserted = await asTenant(A.companyId, async (c) => {
      const r = await c.query(
        `INSERT INTO leave_requests
           (user_id, leave_type_id, start_date, end_date, total_days, status)
         VALUES ($1, $2, '2026-07-02', '2026-07-02', 1, 'pending') RETURNING id`,
        [userId, leaveTypeId],
      );
      return r.rows[0].id as string;
    });
    expect(inserted).toBeTruthy();
  });

  it("app role INSERT status='bogus' is REJECTED (union CHECK still enforces)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(
          `INSERT INTO leave_requests
             (user_id, leave_type_id, start_date, end_date, total_days, status)
           VALUES ($1, $2, '2026-07-03', '2026-07-03', 1, 'bogus')`,
          [userId, leaveTypeId],
        );
      }),
    ).rejects.toThrow(/leave_req_status_check|violates check constraint/);
  });
});
