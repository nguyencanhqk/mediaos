/**
 * S1-FND-FILE-1 (L3) — files / file_links tenant isolation (RLS+FORCE) + soft-delete contract (DB cô
 * lập, app role THẬT). Mirror file-access-logs-appendonly.int-spec.ts.
 *
 *   R1  RLS — app role của tenant B KHÔNG SELECT được file của tenant A (cô lập tenant, BẤT BIẾN #1).
 *   R2  files: app role UPDATE(deleted_at) ĐƯỢC (soft-delete) nhưng DELETE row BỊ TỪ CHỐI (BẤT BIẾN #2 —
 *       không hard-delete).
 *   R3  file_links: app role DELETE row BỊ TỪ CHỐI (unlink = soft-delete deleted_at, KHÔNG hard-delete).
 *
 * Gate: skipIf(!hasDb || !LANE_DB) — KHÔNG chạy trên DB dev chung (.env làm hasDb=true → đỏ-giả).
 */

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;

async function seedFile(
  direct: ReturnType<typeof directPool>,
  companyId: string,
  uploadedBy: string,
): Promise<string> {
  const fileId = randomUUID();
  await direct.query(
    `INSERT INTO files
       (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
        storage_provider, storage_path, visibility, upload_status, scan_status, uploaded_by)
     VALUES ($1, $2, 'iso.pdf', $3, 'application/pdf', 1024,
             'MinIO', $4, 'Private', 'Pending', 'NotRequired', $5)`,
    [fileId, companyId, fileId, `${companyId}/files/${fileId}`, uploadedBy],
  );
  return fileId;
}

describe.skipIf(!hasLaneDb)(
  "S1-FND-FILE-1 files/file_links RLS isolation + soft-delete (mediaos_app)",
  () => {
    const direct = directPool();
    const app = appPool();

    let A: SeededTenant;
    let B: SeededTenant;
    let userA: string;
    let fileA: string;
    let linkA: string;

    beforeAll(async () => {
      A = await seedCompany(direct, "iso-a");
      B = await seedCompany(direct, "iso-b");
      userA = await seedUser(direct, A.companyId, `iso-a-${A.slug}@x.test`);
      fileA = await seedFile(direct, A.companyId, userA);

      linkA = randomUUID();
      await direct.query(
        `INSERT INTO file_links
         (id, company_id, file_id, module_code, entity_type, entity_id, link_type, access_scope, created_by)
       VALUES ($1, $2, $3, 'HR', 'EmployeeContract', $4, 'Contract', 'Company', $5)`,
        [linkA, A.companyId, fileA, randomUUID(), userA],
      );
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      await app.end();
    });

    /** Run fn as app role with tenant context set (commit). */
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

    it("R1 — tenant B (app role) CANNOT SELECT tenant A's file (RLS isolation)", async () => {
      const rows = await asTenant(B.companyId, async (c) => {
        const r = await c.query(`SELECT id FROM files WHERE id = $1`, [fileA]);
        return r.rows;
      });
      expect(rows).toHaveLength(0); // RLS filters cross-tenant → 0 row (not an error, just invisible)
    });

    it("R1b — tenant A (app role) CAN SELECT its own file", async () => {
      const rows = await asTenant(A.companyId, async (c) => {
        const r = await c.query(`SELECT id FROM files WHERE id = $1`, [fileA]);
        return r.rows;
      });
      expect(rows).toHaveLength(1);
    });

    it("R2 — files: app role UPDATE(deleted_at) SUCCEEDS (soft-delete) but DELETE row is DENIED", async () => {
      // soft-delete allowed (column-UPDATE grant)
      await asTenant(A.companyId, async (c) => {
        await c.query(`UPDATE files SET deleted_at = now(), deleted_by = $2 WHERE id = $1`, [
          fileA,
          userA,
        ]);
      });

      // hard-delete denied (no DELETE grant — BẤT BIẾN #2)
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`DELETE FROM files WHERE id = $1`, [fileA]);
        }),
      ).rejects.toThrow(/permission denied/);
    });

    it("R3 — file_links: app role DELETE row is DENIED (unlink = soft-delete only)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(`DELETE FROM file_links WHERE id = $1`, [linkA]);
        }),
      ).rejects.toThrow(/permission denied/);
    });
  },
);
