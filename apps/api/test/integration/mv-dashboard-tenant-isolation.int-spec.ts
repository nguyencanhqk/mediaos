import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { directPool, hasDb } from "../helpers/integration-db";
import { seedCompany } from "../helpers/seed";
import { MvDashboardService } from "../../src/dashboard/mv-dashboard.service";
import { DatabaseService } from "../../src/db/db.service";
import * as schema from "../../src/db/schema";
import { Pool } from "pg";

/**
 * G14-5 — MV tenant-leak integration test.
 *
 * Seeds 2 tenants (A & B) with tasks, refreshes mv_dashboard_output,
 * then calls MvDashboardService.getOutputStats(A) and asserts ZERO rows from tenant B.
 *
 * ⟲ S6-SEC-MV-1 (2026-07-29, mig 0534): the parameterized `WHERE company_id` is no longer the SOLE
 * boundary — the service now reads the `security_barrier` views `v_dashboard_*`, which filter on
 * `current_setting('app.current_company_id')`. This test still earns its keep: it is the one that
 * exercises the SERVICE (not raw SQL), so it proves the two belts agree instead of fighting.
 *
 * Runs only when DATABASE_DIRECT_URL + DATABASE_URL are set (Postgres required).
 */
describe.skipIf(!hasDb)("G14-5 MV dashboard tenant isolation", () => {
  let pool: Pool;
  let service: MvDashboardService;
  let companyA: string;
  let companyB: string;

  beforeAll(async () => {
    pool = directPool();

    // Seed 2 tenants
    const tenantA = await seedCompany(pool, "mvA");
    const tenantB = await seedCompany(pool, "mvB");
    companyA = tenantA.companyId;
    companyB = tenantB.companyId;

    // Seed at least 1 task per tenant so MV will have rows for each
    await pool.query(
      `INSERT INTO tasks (company_id, title, status, created_at)
       VALUES ($1, 'Task for A', 'completed', NOW()),
              ($1, 'Task for A 2', 'in_progress', NOW())`,
      [companyA],
    );
    await pool.query(
      `INSERT INTO tasks (company_id, title, status, created_at)
       VALUES ($1, 'Task for B', 'completed', NOW())`,
      [companyB],
    );

    // Refresh the MV as owner/superuser (direct connection)
    await pool.query("REFRESH MATERIALIZED VIEW mv_dashboard_output");
    await pool.query("REFRESH MATERIALIZED VIEW mv_dashboard_task_status");

    // Build MvDashboardService backed by direct pool (bypass PgBouncer in test)
    const db = drizzle(pool, { schema });

    // DatabaseService stub — MUST set `app.current_company_id` like the real `withTenant()` does.
    //
    // ⚠️ S6-SEC-MV-1: the previous stub was `(_companyId, fn) => fn(db)` — it dropped the tenant GUC
    // because back then nothing read it (the MV was queried directly and only the explicit
    // `WHERE company_id` mattered). Since mig 0534 the service reads `v_dashboard_*`, whose filter IS
    // that GUC, so the old stub made every query return 0 rows and the suite went red. A stub that
    // silently omits the mechanism under test is the bug — not the barrier. Set it for real, inside a
    // transaction so `set_config(..., true)` is scoped exactly as in production.
    const dbService = {
      withTenant: async (companyId: string, fn: (tx: typeof db) => Promise<unknown>) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
          const scoped = drizzle(client, { schema });
          const out = await fn(scoped as unknown as typeof db);
          await client.query("COMMIT");
          return out;
        } catch (err) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw err;
        } finally {
          client.release();
        }
      },
    } as unknown as DatabaseService;

    service = new MvDashboardService(dbService);
  });

  afterAll(async () => {
    // Clean up — delete tasks then companies (cascade handles MV data on next refresh)
    await pool.query("DELETE FROM tasks WHERE company_id = ANY($1)", [[companyA, companyB]]);
    await pool.query("DELETE FROM companies WHERE id = ANY($1)", [[companyA, companyB]]);
    await pool.end();
  });

  it("getOutputStats for tenant A returns only rows for tenant A (non-empty)", async () => {
    const rows = await service.getOutputStats(companyA);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("getOutputStats for tenant A returns zero rows belonging to tenant B (no cross-tenant MV leak)", async () => {
    // The MV stores all tenants. The only gate is WHERE company_id = $param.
    // If parameterization is broken (sql.raw interpolation), B's rows would appear here.
    const rowsA = await service.getOutputStats(companyA);
    const rowsB = await service.getOutputStats(companyB);

    // Sanity: B also has data in MV
    expect(rowsB.length).toBeGreaterThan(0);

    // Key assertion: A query must not return any B metrics.
    // We verify by checking task counts: A has 2 tasks, B has 1.
    const totalA = rowsA.reduce((sum, r) => sum + r.taskCount, 0);
    const totalB = rowsB.reduce((sum, r) => sum + r.taskCount, 0);

    // If cross-tenant leak exists, totalA would include B's count (= 3 instead of 2)
    expect(totalA).toBe(2); // only A's tasks
    expect(totalB).toBe(1); // only B's tasks
  });

  it("getTaskStatusStats for tenant A has no data from tenant B", async () => {
    const statsA = await service.getTaskStatusStats(companyA);
    const statsB = await service.getTaskStatusStats(companyB);

    // A has 2 tasks (1 completed + 1 in_progress), B has 1 (completed)
    const totalA = statsA.reduce((sum, r) => sum + r.taskCount, 0);
    const totalB = statsB.reduce((sum, r) => sum + r.taskCount, 0);

    expect(totalA).toBe(2);
    expect(totalB).toBe(1);
  });
});
