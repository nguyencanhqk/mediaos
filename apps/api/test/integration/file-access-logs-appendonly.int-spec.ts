import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * FOUNDATION-DB-3 — file_access_logs APPEND-ONLY (BẤT BIẾN #2, mig 0433).
 *
 * file_access_logs = log truy cập file. app role (mediaos_app) GRANT SELECT,INSERT ONLY —
 * REVOKE UPDATE,DELETE tường minh → UPDATE/DELETE bằng app role PHẢI BỊ TỪ CHỐI (permission denied).
 *
 * Mirror pattern: payslip-appendonly.int-spec.ts (G12-2).
 *
 * Gate: skipIf(!hasDb || !LANE_DB) — KHỚP files-rls-isolation.int-spec.ts. `.env` làm hasDb=true → nếu
 * chỉ gate !hasDb thì suite chạy trên DB dev chung khi KHÔNG set LANE_DB ⇒ đỏ-giả (memory:
 * integration-test-lane-db-gate). LANE_DB bắt buộc để chạy trên DB cô lập mediaos_<lane>.
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("FOUNDATION-DB-3 file_access_logs append-only (mediaos_app)", () => {
  const direct = directPool();
  const app = appPool();

  let A: SeededTenant;
  let userId: string;
  let fileId: string;
  let logId: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "fal-ao");
    userId = await seedUser(direct, A.companyId, `fal-ao-${A.slug}@x.test`);

    // Seed a files row (FK file_id NOT NULL → files) via superuser (bypass RLS/grants).
    const f = await direct.query(
      `INSERT INTO files
         (company_id, original_name, stored_name, mime_type, file_size_bytes,
          storage_provider, storage_path, visibility, upload_status, scan_status, uploaded_by)
       VALUES ($1, 'ao-test.pdf', $2, 'application/pdf', 2048,
               'MinIO', $3, 'Private', 'Uploaded', 'NotRequired', $4)
       RETURNING id`,
      [
        A.companyId,
        `ao-stored-${randomUUID().slice(0, 8)}.pdf`,
        `ao/${A.companyId}/${randomUUID()}/test.pdf`,
        userId,
      ],
    );
    fileId = f.rows[0].id as string;

    // Seed via superuser — the row the app role will try to mutate (expects denial).
    const l = await direct.query(
      `INSERT INTO file_access_logs
         (company_id, file_id, actor_user_id, action, access_granted)
       VALUES ($1, $2, $3, 'Download', true)
       RETURNING id`,
      [A.companyId, fileId, userId],
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

  it("INSERT file_access_log via app role SUCCEEDS (GRANT SELECT,INSERT)", async () => {
    const inserted = await asTenant(A.companyId, async (c) => {
      const r = await c.query(
        `INSERT INTO file_access_logs
           (file_id, actor_user_id, action, access_granted)
         VALUES ($1, $2, 'Preview', true)
         RETURNING id`,
        [fileId, userId],
      );
      return r.rows[0].id as string;
    });
    expect(inserted).toBeTruthy();
  });

  it("app role UPDATE on file_access_logs is DENIED (append-only — REVOKE UPDATE)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(`UPDATE file_access_logs SET action = 'Upload' WHERE id = $1`, [logId]);
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("app role DELETE on file_access_logs is DENIED (append-only — REVOKE DELETE)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(`DELETE FROM file_access_logs WHERE id = $1`, [logId]);
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
