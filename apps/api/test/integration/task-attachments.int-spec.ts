import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * B4 — task_attachments RLS 2-tenant deny + APPEND-ONLY grant assert (Postgres thật, DB cô lập).
 *
 *  - Cross-tenant: login A KHÔNG thấy attachment của B (RLS 0 row) — list/getOne.
 *  - APPEND-ONLY (BẤT BIẾN #2): app role GRANT SELECT,INSERT + UPDATE(deleted_at) column-only.
 *    INSERT SUCCEEDS. UPDATE cột NỘI DUNG (file_name) bị TỪ CHỐI (column-grant không phủ). DELETE bị
 *    TỪ CHỐI (hard-delete cấm). UPDATE(deleted_at) SUCCEEDS = soft-delete đường app withTenant.
 *  - audit_logs CHECK CHẤP NHẬN object_type 'task_attachment' (0190 superset, không phải shrink).
 */

describe.skipIf(!hasDb)("B4 task_attachments RLS + append-only", () => {
  const direct = directPool();
  const app = appPool();

  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let userB: string;
  let taskA: string;
  let taskB: string;
  let attachA: string;
  let attachA2: string;
  let attachB: string;

  async function seedTask(companyId: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round)
       VALUES ($1, 'office', 'b4-task', 'not_started', 'initial', 0) RETURNING id`,
      [companyId],
    );
    return r.rows[0].id as string;
  }

  async function seedAttachment(
    companyId: string,
    taskId: string,
    userId: string,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO task_attachments
         (company_id, task_id, uploaded_by, storage_key, file_name, content_type, size_bytes)
       VALUES ($1, $2, $3, $4, 'f.pdf', 'application/pdf', 100) RETURNING id`,
      [companyId, taskId, userId, `${companyId}/tasks/${taskId}/${randomUUID()}`],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "b4-a");
    B = await seedCompany(direct, "b4-b");
    userA = await seedUser(direct, A.companyId, `b4a-${A.slug}@x.test`);
    userB = await seedUser(direct, B.companyId, `b4b-${B.slug}@x.test`);
    taskA = await seedTask(A.companyId);
    taskB = await seedTask(B.companyId);
    attachA = await seedAttachment(A.companyId, taskA, userA);
    attachA2 = await seedAttachment(A.companyId, taskA, userA);
    attachB = await seedAttachment(B.companyId, taskB, userB);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  async function asTenant<T>(
    pool: import("pg").Pool,
    companyId: string,
    fn: (c: import("pg").PoolClient) => Promise<T>,
  ): Promise<T> {
    const c = await pool.connect();
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

  it("tenant A cannot see tenant B's attachment (RLS list → 0 row)", async () => {
    const rows = await asTenant(app, A.companyId, async (c) => {
      const r = await c.query(`SELECT id FROM task_attachments WHERE task_id = $1`, [taskB]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("tenant A cannot getOne tenant B's attachment by id (RLS → 0 row)", async () => {
    const rows = await asTenant(app, A.companyId, async (c) => {
      const r = await c.query(`SELECT id FROM task_attachments WHERE id = $1`, [attachB]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("tenant A sees its own attachment", async () => {
    const rows = await asTenant(app, A.companyId, async (c) => {
      const r = await c.query(`SELECT id FROM task_attachments WHERE id = $1`, [attachA]);
      return r.rows;
    });
    expect(rows).toHaveLength(1);
  });

  it("INSERT via app role SUCCEEDS (GRANT SELECT,INSERT)", async () => {
    const inserted = await asTenant(app, A.companyId, async (c) => {
      const r = await c.query(
        `INSERT INTO task_attachments
           (task_id, uploaded_by, storage_key, file_name, content_type, size_bytes)
         VALUES ($1, $2, $3, 'g.pdf', 'application/pdf', 200) RETURNING id`,
        [taskA, userA, `${A.companyId}/tasks/${taskA}/${randomUUID()}`],
      );
      return r.rows[0].id as string;
    });
    expect(inserted).toBeTruthy();
  });

  it("app role UPDATE of a CONTENT column (file_name) is DENIED (append-only content)", async () => {
    await expect(
      asTenant(app, A.companyId, async (c) => {
        await c.query(`UPDATE task_attachments SET file_name = 'x' WHERE id = $1`, [attachA]);
      }),
    ).rejects.toThrow();
  });

  it("app role UPDATE of storage_key is DENIED (content immutable, no key rewrite)", async () => {
    await expect(
      asTenant(app, A.companyId, async (c) => {
        await c.query(`UPDATE task_attachments SET storage_key = 'evil/key' WHERE id = $1`, [
          attachA,
        ]);
      }),
    ).rejects.toThrow();
  });

  it("app role DELETE on task_attachments is DENIED (append-only, no hard-delete)", async () => {
    await expect(
      asTenant(app, A.companyId, async (c) => {
        await c.query(`DELETE FROM task_attachments WHERE id = $1`, [attachA]);
      }),
    ).rejects.toThrow();
  });

  it("app role soft-delete UPDATE(deleted_at) SUCCEEDS (column-grant, RLS-scoped)", async () => {
    const ok = await asTenant(app, A.companyId, async (c) => {
      const r = await c.query(
        `UPDATE task_attachments SET deleted_at = now() WHERE id = $1 RETURNING id`,
        [attachA],
      );
      return r.rowCount;
    });
    expect(ok).toBe(1);
  });

  it("app role soft-delete + audit_logs INSERT SUCCEED in the SAME tx (service path)", async () => {
    // Mirrors TaskAttachmentsService.softDelete: app role must do BOTH the deleted_at UPDATE and the
    // audit INSERT on the same connection/tx (regression guard for the worker-no-audit-grant bug).
    const auditId = await asTenant(app, A.companyId, async (c) => {
      await c.query(`UPDATE task_attachments SET deleted_at = now() WHERE id = $1`, [attachA2]);
      const r = await c.query(
        `INSERT INTO audit_logs (action, object_type, object_id)
         VALUES ('TaskAttachmentDeleted', 'task_attachment', $1) RETURNING id`,
        [attachA2],
      );
      return r.rows[0].id as string;
    });
    expect(auditId).toBeTruthy();
  });

  it("audit_logs CHECK accepts object_type 'task_attachment' (0190 superset, not a shrink)", async () => {
    const id = await asTenant(app, A.companyId, async (c) => {
      const r = await c.query(
        `INSERT INTO audit_logs (action, object_type) VALUES ('seed', 'task_attachment') RETURNING id`,
      );
      return r.rows[0].id as string;
    });
    expect(id).toBeTruthy();
  });
});
