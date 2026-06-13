import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * G12-1 — 2-tenant RLS isolation cho salary_profiles (CROWN JEWEL). Chạy trên Postgres thật.
 * Seed company A & B (direct/superuser). Qua app role (mediaos_app, KHÔNG bypass RLS) với
 * app.current_company_id = A:
 *   - SELECT salary_profiles trả 0 hàng của B.
 *   - INSERT với company_id = B bị RLS WITH CHECK chặn (lương không lọt chéo tenant).
 * (rls-registry harness G2-5 cũng đã thêm salary_profiles để chống xanh-giả toàn cục.)
 */

describe.skipIf(!hasDb)("G12-1 salary_profiles tenant isolation (RLS, 2-tenant)", () => {
  const direct = directPool();
  const app = appPool();

  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let userB: string;
  let profileB: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "sal-iso-a");
    B = await seedCompany(direct, "sal-iso-b");
    userA = await seedUser(direct, A.companyId, `sal-iso-a@x.test`);
    userB = await seedUser(direct, B.companyId, `sal-iso-b@x.test`);
    const rB = await direct.query(
      `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary)
       VALUES ($1, $2, '2026-01-01', 9999.00) RETURNING id`,
      [B.companyId, userB],
    );
    profileB = rB.rows[0].id as string;
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

  it("login A: SELECT salary_profiles returns 0 rows of B", async () => {
    const rows = await asTenant(A.companyId, async (c) => {
      const r = await c.query("SELECT id FROM salary_profiles");
      return r.rows;
    });
    expect(rows.find((row) => row.id === profileB)).toBeUndefined();
    expect(rows.length).toBe(0);
  });

  it("login A: cannot read B's profile by id (RLS USING filters it out)", async () => {
    const rows = await asTenant(A.companyId, async (c) => {
      const r = await c.query("SELECT id FROM salary_profiles WHERE id = $1", [profileB]);
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  it("login A: INSERT with company_id = B is blocked by RLS WITH CHECK", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        // Force the foreign tenant id explicitly — WITH CHECK must reject the row.
        await c.query(
          `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary)
           VALUES ($1, $2, '2026-01-01', 1.00)`,
          [B.companyId, userA],
        );
      }),
    ).rejects.toThrow();
  });

  it("login A: INSERT in own tenant (default company_id) succeeds and is visible only to A", async () => {
    const insertedId = await asTenant(A.companyId, async (c) => {
      const r = await c.query(
        `INSERT INTO salary_profiles (user_id, effective_date, base_salary)
         VALUES ($1, '2026-01-01', 1000.00) RETURNING id, company_id`,
        [userA],
      );
      return r.rows[0].id as string;
    });
    // Visible to A
    const seenByA = await asTenant(A.companyId, async (c) => {
      const r = await c.query("SELECT id FROM salary_profiles WHERE id = $1", [insertedId]);
      return r.rows.length;
    });
    expect(seenByA).toBe(1);
    // Invisible to B
    const seenByB = await asTenant(B.companyId, async (c) => {
      const r = await c.query("SELECT id FROM salary_profiles WHERE id = $1", [insertedId]);
      return r.rows.length;
    });
    expect(seenByB).toBe(0);
  });
});
