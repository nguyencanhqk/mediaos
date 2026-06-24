import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S2-HR-DB-1 (🔴 RED) — reconcile HR-Core vs DB-03 (mig 0442, ADDITIVE).
 *
 * Đích (done_when):
 *   1. employee_profiles.user_id NỚI nullable (employee trước, account sau — DB-03 §7.2).
 *   2. 4 bảng mới (job_levels, contract_types, employee_status_histories, employee_code_configs)
 *      có company_id + RLS ENABLE+FORCE + policy → cross-tenant deny.
 *   3. employee_status_histories APPEND-ONLY: app role UPDATE/DELETE → DENIED (BẤT BIẾN #2).
 *   4. index §12.4 trên employee_profiles + cột FK job_level_id/contract_type_id.
 *
 * RED→GREEN: chạy trên DB CHƯA áp 0442 ⇒ ĐỎ (bảng/cột chưa có). Áp 0442 ⇒ XANH.
 * Gate hasDb && LANE_DB (CLAUDE.md §9.5). Mirror: role-permission-data-scope.int-spec.ts.
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;
const NEW_TABLES = [
  "job_levels",
  "contract_types",
  "employee_status_histories",
  "employee_code_configs",
];

describe.skipIf(!hasLaneDb)("S2-HR-DB-1 HR-Core reconcile (mig 0442)", () => {
  const direct = directPool();
  const app = appPool();

  let A: SeededTenant;
  let B: SeededTenant;

  beforeAll(async () => {
    A = await seedCompany(direct, "hrdb-a");
    B = await seedCompany(direct, "hrdb-b");
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
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

  it("employee_profiles.user_id NỚI nullable: insert employee KHÔNG user_id → OK", async () => {
    const col = await direct.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'employee_profiles' AND column_name = 'user_id'`,
    );
    expect(col.rows[0].is_nullable).toBe("YES");

    const ins = await direct.query(
      `INSERT INTO employee_profiles (company_id, employee_code) VALUES ($1, $2) RETURNING id, user_id`,
      [A.companyId, `NOUSER-${Date.now()}`],
    );
    expect(ins.rows[0].user_id).toBeNull();
  });

  it("cột FK master data job_level_id + contract_type_id tồn tại trên employee_profiles", async () => {
    const cols = await direct.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'employee_profiles' AND column_name IN ('job_level_id','contract_type_id')`,
    );
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual([
      "contract_type_id",
      "job_level_id",
    ]);
  });

  it("4 bảng HR-Core mới có RLS ENABLE+FORCE (BẤT BIẾN #1)", async () => {
    for (const tbl of NEW_TABLES) {
      const f = await direct.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
        [tbl],
      );
      expect(f.rows.length, `${tbl} phải tồn tại`).toBe(1);
      expect(f.rows[0].relrowsecurity, `${tbl} RLS`).toBe(true);
      expect(f.rows[0].relforcerowsecurity, `${tbl} FORCE`).toBe(true);
    }
  });

  it("index DB-03 §12.4 trên employee_profiles", async () => {
    const idx = await direct.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'employee_profiles'`,
    );
    const names = idx.rows.map((r) => r.indexname);
    for (const want of [
      "employee_profiles_company_status_idx",
      "employee_profiles_company_org_unit_idx",
      "employee_profiles_company_manager_idx",
      "employee_profiles_company_start_date_idx",
    ]) {
      expect(names, `thiếu index ${want}`).toContain(want);
    }
  });

  it("employee_status_histories APPEND-ONLY: app role UPDATE/DELETE → DENIED (BẤT BIẾN #2)", async () => {
    const u = await seedUser(direct, A.companyId, `esh-ao-${Date.now()}@x.test`);
    const emp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
      [A.companyId, u],
    );
    const row = await direct.query(
      `INSERT INTO employee_status_histories (company_id, employee_id, new_status)
       VALUES ($1, $2, 'active') RETURNING id`,
      [A.companyId, emp.rows[0].id],
    );
    const rowId = row.rows[0].id as string;

    await expect(
      asTenant(A.companyId, (c) =>
        c.query(`UPDATE employee_status_histories SET reason = 'x' WHERE id = $1`, [rowId]),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asTenant(A.companyId, (c) =>
        c.query(`DELETE FROM employee_status_histories WHERE id = $1`, [rowId]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cross-tenant deny: app role company A KHÔNG đọc job_levels của company B", async () => {
    await direct.query(`INSERT INTO job_levels (company_id, name) VALUES ($1, 'B-only-level')`, [
      B.companyId,
    ]);
    const seen = await asTenant(A.companyId, (c) =>
      c.query(`SELECT id FROM job_levels WHERE company_id = $1`, [B.companyId]),
    );
    expect(seen.rows.length).toBe(0);
  });
});
