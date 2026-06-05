import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * G2-3 — deny-path RLS (USING + WITH CHECK + FORCE) trên users. Postgres thật (CI).
 * Đây là bằng chứng "không một query nào đọc/ghi được dữ liệu tenant khác" ở tầng DB (BẤT BIẾN #1).
 */
describe.skipIf(!hasDb)("G2-3 RLS companies/users", () => {
  const direct = directPool();
  const app = appPool(2);
  let A: SeededTenant;
  let B: SeededTenant;

  beforeAll(async () => {
    A = await seedCompany(direct, "A");
    B = await seedCompany(direct, "B");
    await seedUser(direct, A.companyId, "alice@a.test");
    await seedUser(direct, B.companyId, "bob@b.test");
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  /** Chạy fn trong 1 transaction có ngữ cảnh tenant; tự ROLLBACK (test không để lại rác). */
  async function inTenant<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      const out = await fn(c);
      await c.query("ROLLBACK");
      return out;
    } catch (err) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  it("ngoài withTenant (không ngữ cảnh): app đọc users → 0 row (deny-by-default)", async () => {
    const c = await app.connect();
    try {
      const r = await c.query("SELECT id FROM users");
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  it("withTenant(A): chỉ thấy user của A, KHÔNG thấy user của B", async () => {
    const emails = await inTenant(A.companyId, async (c) => {
      const r = await c.query("SELECT email FROM users");
      return r.rows.map((x) => x.email);
    });
    expect(emails).toContain("alice@a.test");
    expect(emails).not.toContain("bob@b.test");
  });

  it("withTenant(A): INSERT user company_id=B → bị WITH CHECK từ chối", async () => {
    await expect(
      inTenant(A.companyId, async (c) => {
        await c.query(
          "INSERT INTO users (company_id, email, password_hash) VALUES ($1, $2, $3)",
          [B.companyId, "evil@a.test", "x"],
        );
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("withTenant(A): UPDATE user A SET company_id=B → bị WITH CHECK từ chối", async () => {
    await expect(
      inTenant(A.companyId, async (c) => {
        await c.query("UPDATE users SET company_id = $1 WHERE email = $2", [
          B.companyId,
          "alice@a.test",
        ]);
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("withTenant(A): INSERT KHÔNG truyền company_id → DEFAULT = ngữ cảnh A (thuộc A)", async () => {
    const companyId = await inTenant(A.companyId, async (c) => {
      const r = await c.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING company_id",
        ["newbie@a.test", "x"],
      );
      return r.rows[0].company_id;
    });
    expect(companyId).toBe(A.companyId);
  });

  it("trùng email active cùng tenant → unique từ chối; sau soft-delete → cho phép lại", async () => {
    // alice@a.test đã tồn tại (active) ⇒ thêm trùng phải lỗi unique.
    await expect(
      inTenant(A.companyId, async (c) => {
        await c.query("INSERT INTO users (email, password_hash) VALUES ($1, $2)", [
          "alice@a.test",
          "x",
        ]);
      }),
    ).rejects.toThrow(/duplicate key|unique/i);

    // Soft-delete alice rồi thêm lại cùng email ⇒ partial-unique (WHERE deleted_at IS NULL) cho phép.
    const ok = await inTenant(A.companyId, async (c) => {
      await c.query("UPDATE users SET deleted_at = now() WHERE email = $1", ["alice@a.test"]);
      await c.query("INSERT INTO users (email, password_hash) VALUES ($1, $2)", [
        "alice@a.test",
        "x",
      ]);
      return true;
    });
    expect(ok).toBe(true);
  });
});
