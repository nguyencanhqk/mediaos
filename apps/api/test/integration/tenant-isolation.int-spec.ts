import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";
import { RLS_TABLES } from "./rls-registry";

/**
 * G2-5 — LƯỚI AN TOÀN CẢ DỰ ÁN: test 2-tenant đối kháng, data-driven theo rls-registry.
 * Với MỌI bảng RLS đã đăng ký: tenant A không bao giờ thấy hàng của B (và ngược lại); ngoài ngữ cảnh
 * thì 0 row. Chạy lại như regression sau mỗi phase. Postgres thật (CI) — KHÔNG mock (rủi ro ảo tưởng xanh).
 */
describe.skipIf(!hasDb)("G2-5 tenant isolation harness", () => {
  const direct = directPool();
  const app = appPool(2);
  let A: SeededTenant;
  let B: SeededTenant;
  /** id hàng seed cho mỗi bảng, theo tenant. */
  const rowsA = new Map<string, string>();
  const rowsB = new Map<string, string>();

  beforeAll(async () => {
    A = await seedCompany(direct, "isoA");
    B = await seedCompany(direct, "isoB");
    for (const tc of RLS_TABLES) {
      rowsA.set(tc.table, await tc.seedRow(direct, A));
      rowsB.set(tc.table, await tc.seedRow(direct, B));
    }
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  async function visibleIds(companyId: string, table: string): Promise<Set<string>> {
    const c: PoolClient = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      const r = await c.query(`SELECT id FROM ${table}`);
      await c.query("ROLLBACK");
      return new Set(r.rows.map((x) => x.id as string));
    } finally {
      c.release();
    }
  }

  async function idsNoContext(table: string): Promise<string[]> {
    const c: PoolClient = await app.connect();
    try {
      const r = await c.query(`SELECT id FROM ${table}`);
      return r.rows.map((x) => x.id as string);
    } finally {
      c.release();
    }
  }

  for (const tc of RLS_TABLES) {
    describe(tc.name, () => {
      it("ngoài ngữ cảnh tenant → 0 row", async () => {
        expect(await idsNoContext(tc.table)).toHaveLength(0);
      });

      it("withTenant(A) thấy hàng của A, KHÔNG thấy hàng của B", async () => {
        const seen = await visibleIds(A.companyId, tc.table);
        expect(seen.has(rowsA.get(tc.table)!)).toBe(true);
        expect(seen.has(rowsB.get(tc.table)!)).toBe(false);
      });

      it("withTenant(B) thấy hàng của B, KHÔNG thấy hàng của A", async () => {
        const seen = await visibleIds(B.companyId, tc.table);
        expect(seen.has(rowsB.get(tc.table)!)).toBe(true);
        expect(seen.has(rowsA.get(tc.table)!)).toBe(false);
      });
    });
  }
});
