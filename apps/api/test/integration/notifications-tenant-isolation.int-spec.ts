import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * G10 — 2-tenant RLS isolation cho notification_rules. Chạy trên Postgres thật.
 * Seed company A & B (direct/superuser). Qua app role (mediaos_app, KHÔNG bypass RLS)
 * với app.current_company_id = A:
 *   - SELECT notification_rules trả 0 hàng của B.
 *   - INSERT notification_rule với company_id = B bị RLS chặn (dùng type khác để loại
 *     trừ va chạm UNIQUE — nếu RLS vắng thì INSERT sẽ THÀNH CÔNG và test đỏ đúng).
 *   - app role KHÔNG có quyền UPDATE/DELETE notification_rules (REVOKE — append-only).
 */
describe.skipIf(!hasDb)("G10 notification_rules tenant isolation (RLS, 2-tenant)", () => {
  const direct = directPool();
  const app = appPool();

  let A: SeededTenant;
  let B: SeededTenant;
  let ruleB: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "notif-iso-a");
    B = await seedCompany(direct, "notif-iso-b");
    await seedUser(direct, B.companyId, "notif-iso-b@x.test");
    const r = await direct.query(
      `INSERT INTO notification_rules (company_id, notification_type, enabled)
       VALUES ($1, 'general', true) RETURNING id`,
      [B.companyId],
    );
    ruleB = r.rows[0].id as string;
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  async function asTenant<T>(
    companyId: string,
    fn: (c: import("pg").PoolClient) => Promise<T>,
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

  it("login A: SELECT notification_rules returns 0 rows of B", async () => {
    const rows = await asTenant(A.companyId, async (c) => {
      const r = await c.query("SELECT id FROM notification_rules");
      return r.rows as Array<{ id: string }>;
    });
    expect(rows.find((row) => row.id === ruleB)).toBeUndefined();
    expect(rows.length).toBe(0);
  });

  it("login A: INSERT notification_rule with company_id=B is blocked by RLS", async () => {
    await expect(
      asTenant(A.companyId, (c) =>
        c.query(
          `INSERT INTO notification_rules (company_id, notification_type, enabled)
           VALUES ($1, 'task_assigned', true)`,
          [B.companyId],
        ),
      ),
    ).rejects.toThrow();
  });

  it("app role cannot UPDATE notification_rules (REVOKE — append-only)", async () => {
    await expect(
      asTenant(B.companyId, (c) =>
        c.query("UPDATE notification_rules SET enabled = false WHERE id = $1", [ruleB]),
      ),
    ).rejects.toThrow();
  });

  it("app role cannot DELETE notification_rules (REVOKE — append-only)", async () => {
    await expect(
      asTenant(B.companyId, (c) =>
        c.query("DELETE FROM notification_rules WHERE id = $1", [ruleB]),
      ),
    ).rejects.toThrow();
  });
});
