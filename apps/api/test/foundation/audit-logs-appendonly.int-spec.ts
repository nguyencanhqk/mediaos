import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * S0-FND-DB-1 — audit_logs APPEND-ONLY (BẤT BIẾN #2, mig 0003 grant + 0432 REVOKE harden).
 *
 * audit_logs = sổ cái nghiệp vụ. app role (mediaos_app) GRANT SELECT,INSERT ONLY —
 * REVOKE UPDATE,DELETE tường minh (mig 0432) → UPDATE/DELETE bằng app role PHẢI BỊ TỪ CHỐI
 * (permission denied). Đây là test done_when #3 còn thiếu (file_access_logs đã có test tương đương).
 *
 * Mirror pattern: file-access-logs-appendonly.int-spec.ts (FOUNDATION-DB-3).
 * object_type 'company' nằm trong CHECK object_type (union 0011…0437) — không vỡ CHECK.
 */

// [S1-QA-FND-1-FIX-A] Gate: hasDb (DATABASE_DIRECT_URL+URL) + LANE_DB (DB cô lập theo lane). Thiếu
// LANE_DB → SKIP để KHÔNG chạm DB dev chung 'mediaos' (.env làm hasDb=true → đỏ-giả/xanh-giả; memory:
// integration-test-lane-db-gate, CLAUDE.md §9.5). KHỚP canonical: file-access-logs-appendonly.int-spec.ts:19
// / file-security.int-spec.ts:52 / migration-smoke.int-spec.ts:106. Append-only = BẤT BIẾN #2.
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("S0-FND-DB-1 audit_logs append-only (mediaos_app)", () => {
  const direct = directPool();
  const app = appPool();

  let A: SeededTenant;
  let logId: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "aud-ao");

    // Seed via superuser (bypass RLS/grants) — hàng app role sẽ thử mutate (kỳ vọng bị từ chối).
    const l = await direct.query(
      `INSERT INTO audit_logs (company_id, action, object_type)
       VALUES ($1, 'seed', 'company')
       RETURNING id`,
      [A.companyId],
    );
    logId = l.rows[0].id as string;
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
    await app.end();
  });

  /** Run fn inside a transaction as app role with tenant context set. */
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

  it("INSERT audit_logs via app role SUCCEEDS (GRANT SELECT,INSERT)", async () => {
    const inserted = await asTenant(A.companyId, async (c) => {
      // company_id điền tự động qua DEFAULT current_setting('app.current_company_id').
      const r = await c.query(
        `INSERT INTO audit_logs (action, object_type)
         VALUES ('seed-insert', 'company')
         RETURNING id`,
      );
      return r.rows[0].id as string;
    });
    expect(inserted).toBeTruthy();
  });

  it("app role UPDATE on audit_logs is DENIED (append-only — REVOKE UPDATE)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(`UPDATE audit_logs SET action = 'tampered' WHERE id = $1`, [logId]);
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("app role DELETE on audit_logs is DENIED (append-only — REVOKE DELETE)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(`DELETE FROM audit_logs WHERE id = $1`, [logId]);
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
