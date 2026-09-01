import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * PAYROLL — `payslip_acknowledgements` là **SỔ CHỈ-INSERT** (bất biến #2), ép ở tầng DB.
 *
 * ⚠️ S13-PAYROLL-DB-1 — file này ĐƯỢC VIẾT LẠI, KHÔNG XOÁ. `0564` thu bảng về đúng khuôn append-only:
 * GỠ `status`/`reason`/`resolved_by`/`resolved_at`/`resolution_note`/`updated_at` + 3 CHECK, DROP trigger
 * `payslip_ack_status_guard`, và **REVOKE UPDATE khỏi mediaos_app**. Đường khiếu nại (`disputed`/`resolved`)
 * NGOÀI phạm vi v1 (SPEC-11 §5.2, §22f) — giữ 5 cột không route nào ghi là cột ghi-rồi-bỏ
 * (`write-only-column-means-delete-not-wire-up`); mở lại cùng PARK-PAYROLL-001.
 *
 * Bộ ca cũ (FSM disputed→resolved + CHECK reason/resolved-pair) vì vậy KHÔNG CÒN ĐỐI TƯỢNG. Thay bằng ca ghim
 * đúng bất biến mới:
 *   1. INSERT qua app role ĐI QUA (nếu không, mọi ca DENY dưới là xanh-RỖNG);
 *   2. UPDATE / DELETE qua app role bị **DB từ chối** (GRANT chỉ còn SELECT+INSERT);
 *   3. unique `(company, payslip, user)` chặn xác nhận lần hai — chốt cuối PAYROLL-ERR-015;
 *   4. bảng KHÔNG còn cột trạng thái — "hàng tồn tại = đã xác nhận".
 *
 * Test ở tầng DB qua app role (RLS) — KHÔNG qua service.
 */
describe.skipIf(!hasDb)("PAYROLL payslip_acknowledgements — sổ chỉ-INSERT (DB enforcement)", () => {
  const direct = directPool();
  const app = appPool();
  let A: SeededTenant;
  let emp: string;
  let payslipId: string;

  async function asApp<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
      const out = await fn(c);
      await c.query("ROLLBACK");
      return out;
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      c.release();
    }
  }

  /** Seed 1 hàng ack qua direct (superuser — bỏ qua GRANT/RLS) để có đối tượng cho ca UPDATE/DELETE. */
  async function seedAck(userId: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO payslip_acknowledgements (company_id, payslip_id, user_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [A.companyId, payslipId, userId],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "packtr");
    emp = await seedUser(direct, A.companyId, `packtr-emp-${randomUUID().slice(0, 8)}@a.test`);
    const p = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status)
       VALUES ($1, '2026-08', 'Draft') RETURNING id`,
      [A.companyId],
    );
    const ps = await direct.query(
      `INSERT INTO payslips
         (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, input_snapshot_json)
       VALUES ($1, $2, $3, 5000.00, 5000.00, 5000.00, $3, '{"workDays":22}'::jsonb) RETURNING id`,
      [A.companyId, p.rows[0].id, emp],
    );
    payslipId = ps.rows[0].id as string;
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
    await app.end();
  });

  it("ALLOW: INSERT ack qua app role đi qua (GRANT SELECT, INSERT)", async () => {
    // Ca ALLOW này là điều kiện để hai ca DENY bên dưới có nghĩa: nếu app role mất luôn INSERT thì
    // «UPDATE bị từ chối» vẫn xanh mà tính năng đã chết.
    const u = await seedUser(direct, A.companyId, `packtr-ok-${randomUUID().slice(0, 8)}@a.test`);
    const id = await asApp(async (c) => {
      const r = await c.query(
        `INSERT INTO payslip_acknowledgements (payslip_id, user_id) VALUES ($1, $2) RETURNING id`,
        [payslipId, u],
      );
      return r.rows[0].id as string;
    });
    expect(id).toBeTruthy();
  });

  it("DENY: UPDATE qua app role bị DB từ chối — 0564 REVOKE UPDATE (bất biến #2)", async () => {
    const u = await seedUser(direct, A.companyId, `packtr-up-${randomUUID().slice(0, 8)}@a.test`);
    const ackId = await seedAck(u);
    await expect(
      asApp(async (c) => {
        await c.query(`UPDATE payslip_acknowledgements SET created_at = now() WHERE id = $1`, [
          ackId,
        ]);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("DENY: DELETE qua app role bị DB từ chối — không bảng PAYROLL nào có GRANT DELETE", async () => {
    const u = await seedUser(direct, A.companyId, `packtr-del-${randomUUID().slice(0, 8)}@a.test`);
    const ackId = await seedAck(u);
    await expect(
      asApp(async (c) => {
        await c.query(`DELETE FROM payslip_acknowledgements WHERE id = $1`, [ackId]);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("DENY: xác nhận LẦN HAI cùng (phiếu, người) — unique là chốt cuối PAYROLL-ERR-015", async () => {
    const u = await seedUser(direct, A.companyId, `packtr-dup-${randomUUID().slice(0, 8)}@a.test`);
    await seedAck(u);
    await expect(
      asApp(async (c) => {
        await c.query(
          `INSERT INTO payslip_acknowledgements (payslip_id, user_id) VALUES ($1, $2)`,
          [payslipId, u],
        );
      }),
    ).rejects.toThrow(/payslip_acknowledgements_payslip_user_uq|duplicate key/i);
  });

  it("bảng KHÔNG còn cột trạng thái/khiếu nại — «hàng tồn tại = đã xác nhận»", async () => {
    const { rows } = await direct.query<{ attname: string }>(
      `SELECT a.attname FROM pg_attribute a
        WHERE a.attrelid = 'payslip_acknowledgements'::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
    );
    const cols = rows.map((r) => r.attname).sort();
    expect(cols).toEqual(["company_id", "created_at", "id", "payslip_id", "user_id"]);
  });

  it("trigger di sản payslip_ack_status_guard đã biến mất (nó đọc cột vừa bị GỠ)", async () => {
    const { rows } = await direct.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND c.relname = 'payslip_acknowledgements'`,
    );
    expect(rows[0].n).toBe("0");
  });
});
