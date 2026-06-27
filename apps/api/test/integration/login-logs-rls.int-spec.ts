import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * S2-AUTH-BE-1 — deny-path RLS cho login_logs (nullable-tenant, append-only, mig 0443). Bằng chứng ở tầng DB
 * (BẤT BIẾN #1) cho hai đường ghi mà recordLoginAttempt dùng:
 *   • in-tenant: withTenant(A) → company_id PHẢI = A (forge B hoặc NULL → từ chối).
 *   • pre-auth: bare app pool (KHÔNG GUC) → company_id NULL được phép (log brute-force không lộ user/tenant).
 * Và đọc: tenant A thấy row của A + row NULL (pre-auth) NHƯNG KHÔNG thấy row attributed của B.
 */
describe.skipIf(!hasDb)("S2-AUTH-BE-1 login_logs RLS (nullable-tenant)", () => {
  const direct = directPool();
  const app = appPool(2);
  let A: SeededTenant;
  let B: SeededTenant;

  beforeAll(async () => {
    A = await seedCompany(direct, "lglA");
    B = await seedCompany(direct, "lglB");
  });

  afterAll(async () => {
    // dọn row pre-auth NULL do test (c) tạo (company_id NULL → KHÔNG dính cleanupTenants theo company).
    await direct
      .query("DELETE FROM login_logs WHERE normalized_email IN ($1,$2)", [
        "preauth@lgl.test",
        "intenant@lgl.test",
      ])
      .catch(() => undefined);
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

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

  const INSERT = `INSERT INTO login_logs (company_id, email, normalized_email, login_status, failure_reason)
                  VALUES ($1, $2, $3, $4, $5)`;

  it("(a) withTenant(A): INSERT login_logs company_id=B → WITH CHECK từ chối (chống ghi chéo tenant)", async () => {
    await expect(
      inTenant(A.companyId, async (c) => {
        await c.query(INSERT, [B.companyId, "x@b.test", "x@b.test", "failed", "WrongPassword"]);
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("(b) withTenant(A): INSERT login_logs company_id=NULL → từ chối (KHÔNG ghi unattributed khi đang có tenant)", async () => {
    await expect(
      inTenant(A.companyId, async (c) => {
        await c.query(INSERT, [null, "x@a.test", "x@a.test", "failed", "WrongPassword"]);
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("(c) bare app pool (KHÔNG GUC): INSERT login_logs company_id=NULL → OK (pre-auth brute-force log)", async () => {
    const c = await app.connect();
    try {
      // KHÔNG set_config → current_setting('app.current_company_id') rỗng → nhánh NULL của WITH CHECK.
      const r = await c.query(`${INSERT} RETURNING id`, [
        null,
        "preauth@lgl.test",
        "preauth@lgl.test",
        "blocked",
        "TooManyAttempts",
      ]);
      expect(r.rows).toHaveLength(1);
    } finally {
      c.release();
    }
  });

  it("(d) withTenant(A): thấy row của A + row NULL (pre-auth) NHƯNG 0 row attributed của B", async () => {
    // seed 1 row attributed A, 1 row attributed B (qua direct/superuser — bỏ qua RLS để dựng fixture).
    await direct.query(INSERT, [
      A.companyId,
      "intenant@lgl.test",
      "intenant@lgl.test",
      "success",
      null,
    ]);
    await direct.query(INSERT, [
      B.companyId,
      "bsecret@lgl.test",
      "bsecret@lgl.test",
      "success",
      null,
    ]);

    const seen = await inTenant(A.companyId, async (c) => {
      const r = await c.query("SELECT normalized_email FROM login_logs");
      return r.rows.map((x) => x.normalized_email as string);
    });
    expect(seen).toContain("intenant@lgl.test"); // row của A
    expect(seen).toContain("preauth@lgl.test"); // row NULL pre-auth (USING cho phép NULL)
    expect(seen).not.toContain("bsecret@lgl.test"); // KHÔNG thấy row attributed của B
  });

  it("(e) append-only: app role KHÔNG UPDATE/DELETE được login_logs", async () => {
    await expect(
      inTenant(A.companyId, async (c) => {
        await c.query(
          "UPDATE login_logs SET login_status = 'success' WHERE normalized_email = $1",
          ["intenant@lgl.test"],
        );
      }),
    ).rejects.toThrow(/permission denied|denied/i);
    await expect(
      inTenant(A.companyId, async (c) => {
        await c.query("DELETE FROM login_logs WHERE normalized_email = $1", ["intenant@lgl.test"]);
      }),
    ).rejects.toThrow(/permission denied|denied/i);
  });
});
