import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * payslips + payslip_items APPEND-ONLY TUYỆT ĐỐI (ADR-0005, BẤT BIẾN #2).
 *  - app role (mediaos_app) GRANT SELECT,INSERT ONLY → UPDATE/DELETE payslips/payslip_items bị TỪ CHỐI.
 *  - INSERT qua app role SUCCEEDS.
 *  - audit_logs CHECK CHẤP NHẬN object_type IN ('payroll_period','payslip','payslip_item')
 *    (chống class-bug: 0093 PHẢI là superset, không phải đè danh sách cũ).
 *
 * ⚠️ CA GHIM BẤT BIẾN #2 — S13-PAYROLL-DB-1 (mig 0564) CẬP NHẬT, KHÔNG XOÁ (tests-can-pin-a-hole-open).
 * Ba thay đổi bắt buộc của 0564 đối với file này:
 *   1. `entry_kind`/`replaces_payslip_id` đã GỠ (v1 không có đường adjustment/void — SPEC-11 §3.4, §22g);
 *   2. `input_snapshot_json` NOT NULL, KHÔNG DEFAULT, CHECK `<> '{}'` ⇒ MỌI INSERT payslips phải ghi tường minh;
 *   3. `payslips_period_user_uq` là UNIQUE THẲNG (thay partial `WHERE entry_kind='original'`) — chốt cuối
 *      chống SINH PHIẾU HAI LẦN (PAYROLL-ERR-006), có ca riêng bên dưới.
 * Mirror salary-profile-appendonly-audit.int-spec.
 */

describe.skipIf(!hasDb)("G12-2 payslip + payslip_item append-only", () => {
  const direct = directPool();
  const app = appPool();

  let A: SeededTenant;
  let userId: string;
  let userId2: string;
  let periodId: string;
  let payslipId: string;
  let payslipItemId: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "pslip-ao");
    userId = await seedUser(direct, A.companyId, `pslip-ao-${A.slug}@x.test`);
    // Distinct payee: ca INSERT-grant phải dùng (kỳ,user) KHÁC bản seed — `payslips_period_user_uq`
    // (unique THẲNG sau 0564) cho đúng MỘT phiếu / (company, kỳ, user).
    userId2 = await seedUser(direct, A.companyId, `pslip-ao2-${A.slug}@x.test`);
    // Seed via superuser (bypasses grants/RLS) — the rows the app role will try to mutate.
    const p = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status)
       VALUES ($1, '2026-04', 'Draft') RETURNING id`,
      [A.companyId],
    );
    periodId = p.rows[0].id as string;
    const ps = await direct.query(
      `INSERT INTO payslips
         (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, input_snapshot_json)
       VALUES ($1, $2, $3, 5000.00, 5000.00, 5000.00, $3, '{"workDays":22}'::jsonb) RETURNING id`,
      [A.companyId, periodId, userId],
    );
    payslipId = ps.rows[0].id as string;
    const pi = await direct.query(
      `INSERT INTO payslip_items (company_id, payslip_id, item_type, label, amount)
       VALUES ($1, $2, 'earning', 'Base', 5000.00) RETURNING id`,
      [A.companyId, payslipId],
    );
    payslipItemId = pi.rows[0].id as string;
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

  it("INSERT payslip via app role SUCCEEDS (GRANT SELECT,INSERT)", async () => {
    const inserted = await asTenant(A.companyId, async (c) => {
      const r = await c.query(
        `INSERT INTO payslips
           (payroll_period_id, user_id, base_salary, gross, net, created_by, input_snapshot_json)
         VALUES ($1, $2, 6000.00, 6000.00, 6000.00, $2, '{"workDays":22}'::jsonb) RETURNING id`,
        [periodId, userId2],
      );
      return r.rows[0].id as string;
    });
    expect(inserted).toBeTruthy();
  });

  it("INSERT payslip_item via app role SUCCEEDS", async () => {
    const inserted = await asTenant(A.companyId, async (c) => {
      const r = await c.query(
        `INSERT INTO payslip_items (payslip_id, item_type, label, amount)
         VALUES ($1, 'allowance', 'Lunch', 500.00) RETURNING id`,
        [payslipId],
      );
      return r.rows[0].id as string;
    });
    expect(inserted).toBeTruthy();
  });

  it("app role UPDATE on payslips is DENIED (append-only)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(`UPDATE payslips SET net = 1.00 WHERE id = $1`, [payslipId]);
      }),
    ).rejects.toThrow();
  });

  it("app role DELETE on payslips is DENIED (append-only)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(`DELETE FROM payslips WHERE id = $1`, [payslipId]);
      }),
    ).rejects.toThrow();
  });

  it("app role UPDATE on payslip_items is DENIED (append-only)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(`UPDATE payslip_items SET amount = 1.00 WHERE id = $1`, [payslipItemId]);
      }),
    ).rejects.toThrow();
  });

  it("app role DELETE on payslip_items is DENIED (append-only)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(`DELETE FROM payslip_items WHERE id = $1`, [payslipItemId]);
      }),
    ).rejects.toThrow();
  });

  it("payslips_period_user_uq chặn SINH PHIẾU HAI LẦN cho cùng (kỳ, người) — PAYROLL-ERR-006", async () => {
    // 0564 đổi partial `WHERE entry_kind='original'` → UNIQUE THẲNG. Phiếu là append-only nên không có đường
    // xoá để sinh lại ⇒ đây là chốt cuối chống trả lương hai lần. Service map 23505 → 409 (bóc mã từ `cause`).
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(
          `INSERT INTO payslips
             (payroll_period_id, user_id, base_salary, gross, net, created_by, input_snapshot_json)
           VALUES ($1, $2, 7000.00, 7000.00, 7000.00, $2, '{"workDays":22}'::jsonb)`,
          [periodId, userId],
        );
      }),
    ).rejects.toThrow(/payslips_period_user_uq|duplicate key/i);
  });

  it("payslips_snapshot_check chặn snapshot RỖNG — cột NOT NULL + không DEFAULT", async () => {
    // Cặp "NOT NULL + KHÔNG DEFAULT + CHECK <> '{}'" là có chủ đích: để DEFAULT '{}' thì mọi INSERT bỏ trống
    // cột đều 23514 và DEFAULT thành giá trị CHẾT. Ca này ghim vế CHECK.
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(
          `INSERT INTO payslips
             (payroll_period_id, user_id, base_salary, gross, net, created_by, input_snapshot_json)
           VALUES ($1, $2, 8000.00, 8000.00, 8000.00, $2, '{}'::jsonb)`,
          [periodId, userId2],
        );
      }),
    ).rejects.toThrow(/payslips_snapshot_check|check constraint/i);
  });

  it("audit_logs CHECK accepts payroll_period/payslip/payslip_item (0093 superset, not a shrink)", async () => {
    const ids = await asTenant(A.companyId, async (c) => {
      const out: string[] = [];
      for (const objType of ["payroll_period", "payslip", "payslip_item"]) {
        const r = await c.query(
          `INSERT INTO audit_logs (action, object_type) VALUES ('seed', $1) RETURNING id`,
          [objType],
        );
        out.push(r.rows[0].id as string);
      }
      return out;
    });
    expect(ids).toHaveLength(3);
  });
});
