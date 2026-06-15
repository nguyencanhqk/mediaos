import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * G2-4 alerting — RLS tenant isolation cho dead_letter_alerts. Đẩy 1 alert cho tenant A ⇒
 * withTenant(B) đọc dead_letter_alerts trả 0 row của A (RLS+FORCE). Ngoài ngữ cảnh tenant (mediaos_app,
 * không set company_id) ⇒ 0 row. Mirror outbox/dead_letter: app SELECT tenant-scoped; worker xuyên tenant.
 */
describe.skipIf(!hasDb)("G2-4 dead_letter_alerts tenant isolation (RLS+FORCE)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;

  beforeAll(async () => {
    A = await seedCompany(direct, "dla-iso-a");
    B = await seedCompany(direct, "dla-iso-b");
    // Seed 1 alert cho A qua direct (superuser) — append-only fact.
    await direct.query(
      `INSERT INTO dead_letter_alerts (company_id, window_start, dead_letter_count, threshold)
       VALUES ($1, date_trunc('hour', now()), 9, 5)`,
      [A.companyId],
    );
  });
  afterAll(async () => {
    await direct.query("DELETE FROM dead_letter_alerts WHERE company_id = ANY($1::uuid[])", [
      [A.companyId, B.companyId],
    ]);
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  it("withTenant(B) đọc dead_letter_alerts ⇒ 0 row của A (cô lập chéo tenant)", async () => {
    const app = appPool(1);
    try {
      const c = await app.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [B.companyId]);
        const r = await c.query(
          "SELECT count(*)::int AS n FROM dead_letter_alerts WHERE company_id = $1",
          [A.companyId],
        );
        expect(r.rows[0].n).toBe(0);
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
    } finally {
      await app.end();
    }
  });

  it("ngoài ngữ cảnh tenant (mediaos_app, không set company_id) ⇒ 0 row", async () => {
    const app = appPool(1);
    try {
      const c = await app.connect();
      try {
        await c.query("BEGIN");
        // KHÔNG set app.current_company_id → NULLIF(...,'')::uuid = NULL → policy không khớp hàng nào.
        const r = await c.query("SELECT count(*)::int AS n FROM dead_letter_alerts");
        expect(r.rows[0].n).toBe(0);
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
    } finally {
      await app.end();
    }
  });

  it("withTenant(A) ĐỌC ĐƯỢC alert của A (policy không quá chặt)", async () => {
    const app = appPool(1);
    try {
      const c = await app.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
        const r = await c.query(
          "SELECT count(*)::int AS n FROM dead_letter_alerts WHERE company_id = $1",
          [A.companyId],
        );
        expect(r.rows[0].n).toBeGreaterThanOrEqual(1);
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
    } finally {
      await app.end();
    }
  });

  it("app role KHÔNG INSERT/UPDATE/DELETE được dead_letter_alerts (append-only, chỉ worker ghi)", async () => {
    const app = appPool(1);
    try {
      const c = await app.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
        await expect(
          c.query(
            `INSERT INTO dead_letter_alerts (company_id, window_start, dead_letter_count, threshold)
             VALUES ($1, date_trunc('hour', now()), 1, 5)`,
            [A.companyId],
          ),
        ).rejects.toThrow(/permission denied/i);
        await c.query("ROLLBACK");

        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
        await expect(c.query("UPDATE dead_letter_alerts SET dead_letter_count = 0")).rejects.toThrow(
          /permission denied/i,
        );
        await c.query("ROLLBACK");

        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
        await expect(c.query("DELETE FROM dead_letter_alerts")).rejects.toThrow(
          /permission denied/i,
        );
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
    } finally {
      await app.end();
    }
  });
});
