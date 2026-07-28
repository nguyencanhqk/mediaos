import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * S2-AUTH-BE-1 — deny-path RLS cho login_logs (nullable-tenant, append-only, mig 0443)
 * ⟲ S6-SEC-LOGINLOG-1 / KI-042 (mig 0532): SIẾT vế ĐỌC.
 *
 * Bằng chứng ở tầng DB (BẤT BIẾN #1) cho hai đường ghi mà recordLoginAttempt dùng:
 *   • in-tenant: withTenant(A) → company_id PHẢI = A (forge B hoặc NULL → từ chối).
 *   • pre-auth: bare app pool (KHÔNG GUC) → company_id NULL được phép (log brute-force không lộ user/tenant).
 *
 * ĐỌC (đổi bởi 0532): tenant A CHỈ thấy row của A. KHÔNG thấy row attributed của B, và KHÔNG CÒN thấy
 * row `company_id IS NULL` — những row đó là telemetry pre-auth VÔ CHỦ mang email/IP của người lạ.
 * Case (d) của bản trước ĐÃ TỪNG assert `toContain("preauth@…")`, tức là ĐÓNG ĐINH lỗ hổng ở trạng thái
 * mở (memory `tests-can-pin-a-hole-open`); nay đảo lại thành deny.
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
      // CỐ Ý KHÔNG dùng RETURNING — xem case (c2): đó là hình dạng THẬT của đường ghi trong auth.service.
      const r = await c.query(INSERT, [
        null,
        "preauth@lgl.test",
        "preauth@lgl.test",
        "blocked",
        "TooManyAttempts",
      ]);
      expect(r.rowCount).toBe(1);
    } finally {
      c.release();
    }
  });

  it("(c2) 0532-BẪY: INSERT NULL kèm RETURNING BỊ TỪ CHỐI (Postgres áp policy SELECT lên RETURNING)", async () => {
    // Ghim hành vi đã ĐO, không phải suy đoán: sau khi USING hết cho NULL, mệnh đề RETURNING của
    // INSERT phải qua policy SELECT nên hàng NULL vừa ghi KHÔNG đọc lại được ⇒ cả câu lệnh ném.
    // recordLoginAttempt() KHÔNG dùng RETURNING nên đường ghi thật an toàn; nếu ai đó thêm
    // `.returning()` vào đó thì log pre-auth CHẾT TRONG IM LẶNG (lỗi bị nuốt vào nhánh best-effort
    // logger.error). Case này là cái chuông báo cho thay đổi đó.
    const c = await app.connect();
    try {
      await expect(
        c.query(`${INSERT} RETURNING id`, [
          null,
          "preauth-ret@lgl.test",
          "preauth-ret@lgl.test",
          "failed",
          "CompanyInactive",
        ]),
      ).rejects.toThrow(/row-level security|policy/i);
    } finally {
      c.release();
    }
  });

  it("(d) KI-042: withTenant(A) thấy row của A NHƯNG 0 row của B VÀ 0 row NULL-tenant", async () => {
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
    expect(seen).not.toContain("bsecret@lgl.test"); // KHÔNG thấy row attributed của B
    // ⟲ KI-042: trước 0532 đây là `toContain` — row pre-auth của người lạ (email + IP) đọc được từ
    // MỌI tenant. Nay phải vắng mặt.
    expect(seen).not.toContain("preauth@lgl.test");
  });

  it("(d2) KI-042: NGOÀI mọi ngữ cảnh tenant (không GUC) → app role đọc được 0 row", async () => {
    // Vế nặng hơn mô tả gốc của KI-042: trước 0532 KHÔNG cần đứng trong tenant nào cũng đọc được
    // toàn bộ row NULL-tenant, vì `OR company_id IS NULL` đúng vô điều kiện.
    const c = await app.connect();
    try {
      const r = await c.query("SELECT normalized_email FROM login_logs");
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  it("(d3) đường ghi pre-auth KHÔNG bị làm mù: row NULL vẫn vào được DB và superuser vẫn đọc được", async () => {
    // Siết ĐỌC không được biến thành mất dấu vết forensics: hàng vẫn phải tồn tại cho người vận hành.
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM login_logs WHERE normalized_email = $1 AND company_id IS NULL",
      ["preauth@lgl.test"],
    );
    expect(r.rows[0].n).toBeGreaterThan(0);
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
