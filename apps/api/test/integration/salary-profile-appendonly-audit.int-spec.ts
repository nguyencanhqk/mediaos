import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * G12-1 — audit_logs append-only (BẤT BIẾN #2) cho object_type='salary_profile'.
 *  - app role (mediaos_app) UPDATE/DELETE TRỰC TIẾP audit_logs (salary_profile) bị TỪ CHỐI
 *    (chỉ INSERT/SELECT — grant ở 0003). Mọi sửa lương để lại vết bất biến.
 *  - audit_logs CHECK CHẤP NHẬN object_type='salary_profile' (chống class-bug G4-7/G6-0:
 *    0090 superset PHẢI gồm 'salary_profile').
 */

describe.skipIf(!hasDb)("G12-1 audit_logs append-only for salary_profile", () => {
  const direct = directPool();
  const app = appPool();

  let A: SeededTenant;
  let auditRowId: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "sal-audit");
    // Seed an audit row of object_type='salary_profile' directly (superuser bypasses grants/RLS).
    const r = await direct.query(
      `INSERT INTO audit_logs (company_id, action, object_type)
       VALUES ($1, 'salary_profile_updated', 'salary_profile') RETURNING id`,
      [A.companyId],
    );
    auditRowId = r.rows[0].id as string;
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
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

  it("CHECK accepts object_type='salary_profile' (INSERT via app role succeeds)", async () => {
    const inserted = await asTenant(A.companyId, async (c) => {
      const r = await c.query(
        `INSERT INTO audit_logs (action, object_type)
         VALUES ('salary_profile_viewed', 'salary_profile') RETURNING id`,
      );
      return r.rows[0].id as string;
    });
    expect(inserted).toBeTruthy();
  });

  it("app role UPDATE on audit_logs (salary_profile) is DENIED (append-only)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(`UPDATE audit_logs SET action = 'tampered' WHERE id = $1`, [auditRowId]);
      }),
    ).rejects.toThrow();
  });

  it("app role DELETE on audit_logs (salary_profile) is DENIED (append-only)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(`DELETE FROM audit_logs WHERE id = $1`, [auditRowId]);
      }),
    ).rejects.toThrow();
  });
});
