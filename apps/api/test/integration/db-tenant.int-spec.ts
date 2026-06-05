import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { appPool, hasDb, withClient } from "../helpers/integration-db";

/**
 * G2-2 — kiểm chứng cơ chế nền của tenant isolation: `set_config(..., true)` LOCAL.
 * Đây là dòng phòng thủ chống rò chéo tenant qua connection tái dùng (PgBouncer transaction-mode,
 * ADR-0003). Chạy Postgres thật (CI). pool max=1 để ép tái dùng cùng connection.
 */
describe.skipIf(!hasDb)("G2-2 withTenant / set_config LOCAL", () => {
  const pool = appPool(1);
  afterAll(async () => {
    await pool.end();
  });

  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";

  it("GUC set LOCAL chỉ sống trong transaction; sau COMMIT tự reset", async () => {
    await withClient(pool, async (c) => {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [A]);
      const inTx = await c.query("SELECT current_setting('app.current_company_id', true) AS v");
      expect(inTx.rows[0].v).toBe(A);
      await c.query("COMMIT");

      const afterTx = await c.query("SELECT current_setting('app.current_company_id', true) AS v");
      // null hoặc rỗng = GUC đã reset (không sống ở session level).
      expect(afterTx.rows[0].v === null || afterTx.rows[0].v === "").toBe(true);
    });
  });

  it("connection tái dùng: tx B KHÔNG thấy GUC của tx A (chống rò chéo tenant)", async () => {
    await withClient(pool, async (c) => {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [A]);
      await c.query("COMMIT");

      // Cùng physical connection, tx kế tiếp cho tenant B.
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [B]);
      const inB = await c.query("SELECT current_setting('app.current_company_id', true) AS v");
      expect(inB.rows[0].v).toBe(B);
      expect(inB.rows[0].v).not.toBe(A);
      await c.query("COMMIT");
    });
  });

  it("ngoài mọi withTenant (no tx), app.current_company_id chưa được đặt", async () => {
    await withClient(pool, async (c) => {
      const r = await c.query("SELECT current_setting('app.current_company_id', true) AS v");
      expect(r.rows[0].v === null || r.rows[0].v === "").toBe(true);
    });
  });

  it("withTenant đặt đúng app.current_company_id bên trong callback", async () => {
    const service = new DatabaseService();
    const id = "33333333-3333-3333-3333-333333333333";
    const got = await service.withTenant(id, async (tx) => {
      const r = await tx.execute(
        sql`select current_setting('app.current_company_id', true) as v`,
      );
      return (r.rows[0] as { v: string }).v;
    });
    expect(got).toBe(id);
  });

  it("lỗi trong callback → rollback (lỗi được ném ra ngoài, không nuốt)", async () => {
    const service = new DatabaseService();
    const id = "44444444-4444-4444-4444-444444444444";
    await expect(
      service.withTenant(id, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
