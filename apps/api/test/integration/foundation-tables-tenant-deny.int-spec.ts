import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { enterAppRoleInTx, withRolledBackTx } from "../helpers/rolled-back-tx";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * FOUNDATION-DB deny-path test (RED before GREEN).
 *
 * Covers 3 deny dimensions for tables introduced in migrations 0431–0435:
 *
 * 1. STRICT NOT-NULL tables (company_id NOT NULL, mig 0431/0433):
 *    company_settings, files, file_links, file_access_logs
 *    a) withTenant(A): INSERT with company_id = B is rejected by RLS WITH CHECK.
 *    b) withTenant(A): cannot SELECT a B-seeded row (RLS USING filters it out).
 *
 * 2. NULLABLE-company_id tables (mig 0434/0435):
 *    sequence_counters, public_holidays, data_retention_policies, seed_batches, seed_items
 *    a) withTenant(A): INSERT with company_id = NULL is rejected by RLS WITH CHECK
 *       (app role cannot forge global rows — only system/owner can write NULL via bypass).
 *
 * 3. RE-HOME deny (FOUNDATION-DB-FIX-1, mig 0436):
 *    sequence_counters, public_holidays, data_retention_policies, seed_batches, seed_items, roles
 *    withTenant(A): UPDATE a GLOBAL row (company_id IS NULL) SET company_id = A is rejected by the
 *    BEFORE UPDATE trigger enforce_company_id_immutable() — tenant cannot re-home shared master-data.
 */

// ─── helpers ─────────────────────────────────────────────────────────────────

async function asTenant<T>(
  app: import("pg").Pool,
  companyId: string,
  fn: (c: PoolClient) => Promise<T>,
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

// S18-QA-NOTIGLOBALLEAK-1 (gate F-2/DB-1): `.env` làm hasDb=true ⇒ thiếu LANE_DB thì `seedCompany` ở
// beforeAll commit lên DB mặc định. CI đặt LANE_DB=mediaos ⇒ vẫn chạy ở CI.
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)(
  "FOUNDATION-DB deny-path — cross-tenant INSERT blocked + foreign row invisible",
  () => {
    const direct = directPool();
    const app = appPool(2);

    let A: SeededTenant;
    let B: SeededTenant;
    let userA: string;
    let userB: string;

    // IDs of rows seeded for B — to confirm A cannot SELECT them.
    let bCompanySettingsId: string;
    let bFileId: string;
    let bFileLinkId: string;
    let bFileAccessLogId: string;

    beforeAll(async () => {
      A = await seedCompany(direct, "fnd-deny-a");
      B = await seedCompany(direct, "fnd-deny-b");
      userA = await seedUser(direct, A.companyId, `fnd-a@x.test`);
      userB = await seedUser(direct, B.companyId, `fnd-b@x.test`);

      // Seed company_settings row for B (direct/superuser, bypass RLS).
      const csB = await direct.query(
        `INSERT INTO company_settings
           (company_id, setting_key, setting_value, value_type, category)
         VALUES ($1, $2, '"deny-test"'::jsonb, 'String', 'General')
         RETURNING id`,
        [B.companyId, `deny-cs-b-${randomUUID().slice(0, 8)}`],
      );
      bCompanySettingsId = csB.rows[0].id as string;

      // Seed files row for B.
      const fB = await direct.query(
        `INSERT INTO files
           (company_id, original_name, stored_name, mime_type, file_size_bytes,
            storage_provider, storage_path, visibility, upload_status, scan_status, uploaded_by)
         VALUES ($1, 'deny-b.pdf', $2, 'application/pdf', 100,
                 'MinIO', $3, 'Private', 'Uploaded', 'NotRequired', $4)
         RETURNING id`,
        [
          B.companyId,
          `deny-b-stored-${randomUUID().slice(0, 8)}.pdf`,
          `deny/${B.companyId}/${randomUUID()}/b.pdf`,
          userB,
        ],
      );
      bFileId = fB.rows[0].id as string;

      // Seed file_links row for B (FK file_id → bFileId, created_by → userB).
      const flB = await direct.query(
        `INSERT INTO file_links
           (company_id, file_id, module_code, entity_type, entity_id, link_type,
            access_scope, created_by)
         VALUES ($1, $2, 'TASK', 'task', $3, 'Attachment', 'Company', $4)
         RETURNING id`,
        [B.companyId, bFileId, randomUUID(), userB],
      );
      bFileLinkId = flB.rows[0].id as string;

      // Seed file_access_logs row for B (FK file_id → bFileId).
      const falB = await direct.query(
        `INSERT INTO file_access_logs
           (company_id, file_id, actor_user_id, action, access_granted)
         VALUES ($1, $2, $3, 'Preview', true)
         RETURNING id`,
        [B.companyId, bFileId, userB],
      );
      bFileAccessLogId = falB.rows[0].id as string;

      // GLOBAL rows (company_id IS NULL) are NOT seeded here — see rehomeInTx (S18-QA-NOTIGLOBALLEAK-1).
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      await app.end();
    });

    type RehomeTable =
      | "sequence_counters"
      | "public_holidays"
      | "data_retention_policies"
      | "seed_batches"
      | "seed_items"
      | "roles";

    const insertId = async (c: PoolClient, sql: string, params: unknown[]): Promise<string> =>
      (await c.query(sql, params)).rows[0].id as string;

    /** GLOBAL rows (company_id IS NULL) — superuser only (app role cannot write NULL, see section 2). */
    const GLOBAL_SEEDS: Record<RehomeTable, (c: PoolClient, sfx: string) => Promise<string>> = {
      sequence_counters: (c, sfx) =>
        insertId(
          c,
          `INSERT INTO sequence_counters
             (company_id, module_code, sequence_key, scope_type, reset_policy, status)
           VALUES (NULL, 'SYSTEM', $1, 'System', 'Never', 'Active') RETURNING id`,
          [`reh-seq-${sfx}`],
        ),
      public_holidays: (c, sfx) =>
        insertId(
          c,
          `INSERT INTO public_holidays
             (company_id, holiday_code, name, holiday_date, holiday_type, status)
           VALUES (NULL, $1, 'Re-home Global Holiday', '2099-01-01', 'PublicHoliday', 'Active') RETURNING id`,
          [`reh-hol-${sfx}`],
        ),
      data_retention_policies: (c, sfx) =>
        insertId(
          c,
          `INSERT INTO data_retention_policies
             (company_id, module_code, entity_type, retention_days, cleanup_action, is_enabled)
           VALUES (NULL, 'FOUNDATION', $1, 365, 'None', false) RETURNING id`,
          [`reh-drp-${sfx}`],
        ),
      seed_batches: (c, sfx) =>
        insertId(
          c,
          `INSERT INTO seed_batches
             (company_id, seed_key, seed_version, status)
           VALUES (NULL, $1, '1.0.0', 'Pending') RETURNING id`,
          [`reh-sb-${sfx}`],
        ),
      seed_items: async (c, sfx) =>
        insertId(
          c,
          `INSERT INTO seed_items
             (seed_batch_id, company_id, target_table, target_key, operation, status)
           VALUES ($1, NULL, 'companies', $2, 'Upsert', 'Pending') RETURNING id`,
          [await GLOBAL_SEEDS.seed_batches(c, sfx), `reh-si-${sfx}`],
        ),
      roles: (c, sfx) =>
        insertId(
          c,
          `INSERT INTO roles (company_id, name, is_system)
           VALUES (NULL, $1, true) RETURNING id`,
          [`reh-sysrole-${sfx}`],
        ),
    };

    /**
     * S18-QA-NOTIGLOBALLEAK-1 — the GLOBAL row lives in ONE transaction only: seed as superuser ⇒ drop to
     * the app role + tenant A GUC ⇒ UPDATE company_id NULL→A (mig 0436 trigger must reject) ⇒ ROLLBACK.
     * Nothing is ever committed, so a crashed run leaves no GLOBAL row behind (the old spec seeded in
     * beforeAll and cleaned only in afterAll). The UPDATE error is rethrown for the caller to assert.
     */
    async function rehomeInTx(table: RehomeTable): Promise<void> {
      const sfx = randomUUID().slice(0, 8);
      await withRolledBackTx(direct, `fnd-deny re-home ${table}`, async (c) => {
        const id = await GLOBAL_SEEDS[table](c, sfx);
        await enterAppRoleInTx(c, A.companyId);
        await c.query(`UPDATE ${table} SET company_id = $1 WHERE id = $2`, [A.companyId, id]);
      });
    }

    // ── 1a. company_settings: cross-tenant INSERT rejected ───────────────────
    describe("company_settings (NOT NULL company_id)", () => {
      it("withTenant(A): INSERT with company_id = B is rejected by RLS WITH CHECK", async () => {
        await expect(
          asTenant(app, A.companyId, async (c) => {
            await c.query(
              `INSERT INTO company_settings
                 (company_id, setting_key, setting_value, value_type, category)
               VALUES ($1, $2, '"x"'::jsonb, 'String', 'General')`,
              [B.companyId, `deny-forge-${randomUUID().slice(0, 8)}`],
            );
          }),
        ).rejects.toThrow();
      });

      it("withTenant(A): cannot SELECT B's company_settings row (RLS USING)", async () => {
        const rows = await asTenant(app, A.companyId, async (c) => {
          const r = await c.query("SELECT id FROM company_settings WHERE id = $1", [
            bCompanySettingsId,
          ]);
          return r.rows;
        });
        expect(rows).toHaveLength(0);
      });
    });

    // ── 1b. files: cross-tenant INSERT rejected ───────────────────────────────
    describe("files (NOT NULL company_id)", () => {
      it("withTenant(A): INSERT with company_id = B is rejected by RLS WITH CHECK", async () => {
        await expect(
          asTenant(app, A.companyId, async (c) => {
            await c.query(
              `INSERT INTO files
                 (company_id, original_name, stored_name, mime_type, file_size_bytes,
                  storage_provider, storage_path, visibility, upload_status, scan_status, uploaded_by)
               VALUES ($1, 'forge.pdf', $2, 'application/pdf', 1,
                       'MinIO', $3, 'Private', 'Pending', 'NotRequired', $4)`,
              [
                B.companyId,
                `forge-${randomUUID().slice(0, 8)}.pdf`,
                `forge/${B.companyId}/${randomUUID()}/f.pdf`,
                userA,
              ],
            );
          }),
        ).rejects.toThrow();
      });

      it("withTenant(A): cannot SELECT B's files row (RLS USING)", async () => {
        const rows = await asTenant(app, A.companyId, async (c) => {
          const r = await c.query("SELECT id FROM files WHERE id = $1", [bFileId]);
          return r.rows;
        });
        expect(rows).toHaveLength(0);
      });
    });

    // ── 1c. file_links: cross-tenant INSERT rejected ──────────────────────────
    describe("file_links (NOT NULL company_id)", () => {
      it("withTenant(A): INSERT with company_id = B is rejected by RLS WITH CHECK", async () => {
        await expect(
          asTenant(app, A.companyId, async (c) => {
            await c.query(
              `INSERT INTO file_links
                 (company_id, file_id, module_code, entity_type, entity_id,
                  link_type, access_scope, created_by)
               VALUES ($1, $2, 'HR', 'employee', $3, 'Document', 'Company', $4)`,
              [B.companyId, bFileId, randomUUID(), userA],
            );
          }),
        ).rejects.toThrow();
      });

      it("withTenant(A): cannot SELECT B's file_links row (RLS USING)", async () => {
        const rows = await asTenant(app, A.companyId, async (c) => {
          const r = await c.query("SELECT id FROM file_links WHERE id = $1", [bFileLinkId]);
          return r.rows;
        });
        expect(rows).toHaveLength(0);
      });
    });

    // ── 1d. file_access_logs: cross-tenant INSERT rejected ───────────────────
    describe("file_access_logs (NOT NULL company_id, append-only)", () => {
      it("withTenant(A): INSERT with company_id = B is rejected by RLS WITH CHECK", async () => {
        await expect(
          asTenant(app, A.companyId, async (c) => {
            await c.query(
              `INSERT INTO file_access_logs
                 (company_id, file_id, action, access_granted)
               VALUES ($1, $2, 'Upload', false)`,
              [B.companyId, bFileId],
            );
          }),
        ).rejects.toThrow();
      });

      it("withTenant(A): cannot SELECT B's file_access_logs row (RLS USING)", async () => {
        const rows = await asTenant(app, A.companyId, async (c) => {
          const r = await c.query("SELECT id FROM file_access_logs WHERE id = $1", [
            bFileAccessLogId,
          ]);
          return r.rows;
        });
        expect(rows).toHaveLength(0);
      });
    });

    // ── 2. NULLABLE company_id tables: forge-global (NULL) INSERT rejected ────
    // WITH CHECK on these tables: company_id = current_setting (non-null uuid only).
    // Inserting NULL is blocked because NULL != any uuid → WITH CHECK fails.

    describe("sequence_counters (nullable company_id — forge-global deny)", () => {
      it("withTenant(A): INSERT with company_id = NULL is rejected (cannot forge global rows)", async () => {
        await expect(
          asTenant(app, A.companyId, async (c) => {
            await c.query(
              `INSERT INTO sequence_counters
                 (company_id, module_code, sequence_key, scope_type, reset_policy, status)
               VALUES (NULL, 'HR', $1, 'Company', 'Never', 'Active')`,
              [`forge-global-${randomUUID().slice(0, 8)}`],
            );
          }),
        ).rejects.toThrow();
      });

      it("withTenant(A): UPDATE global row company_id NULL→A is rejected (re-home blocked, mig 0436)", async () => {
        await expect(rehomeInTx("sequence_counters")).rejects.toThrow(/company_id is immutable/i);
      });
    });

    describe("public_holidays (nullable company_id — forge-global deny)", () => {
      it("withTenant(A): INSERT with company_id = NULL is rejected (cannot forge global holiday)", async () => {
        await expect(
          asTenant(app, A.companyId, async (c) => {
            await c.query(
              `INSERT INTO public_holidays
                 (company_id, holiday_code, name, holiday_date, holiday_type, status)
               VALUES (NULL, $1, 'Forge Global', '2099-12-31', 'PublicHoliday', 'Active')`,
              [`forge-global-hol-${randomUUID().slice(0, 8)}`],
            );
          }),
        ).rejects.toThrow();
      });

      it("withTenant(A): UPDATE global row company_id NULL→A is rejected (re-home blocked, mig 0436)", async () => {
        await expect(rehomeInTx("public_holidays")).rejects.toThrow(/company_id is immutable/i);
      });
    });

    describe("data_retention_policies (nullable company_id — forge-global deny)", () => {
      it("withTenant(A): INSERT with company_id = NULL is rejected (cannot forge global policy)", async () => {
        await expect(
          asTenant(app, A.companyId, async (c) => {
            await c.query(
              `INSERT INTO data_retention_policies
                 (company_id, module_code, entity_type, retention_days, cleanup_action)
               VALUES (NULL, 'FOUNDATION', $1, 90, 'None')`,
              [`forge-global-drp-${randomUUID().slice(0, 8)}`],
            );
          }),
        ).rejects.toThrow();
      });

      it("withTenant(A): UPDATE global row company_id NULL→A is rejected (re-home blocked, mig 0436)", async () => {
        await expect(rehomeInTx("data_retention_policies")).rejects.toThrow(
          /company_id is immutable/i,
        );
      });
    });

    describe("seed_batches (nullable company_id — forge-global deny)", () => {
      it("withTenant(A): INSERT with company_id = NULL is rejected (cannot forge global seed batch)", async () => {
        await expect(
          asTenant(app, A.companyId, async (c) => {
            await c.query(
              `INSERT INTO seed_batches
                 (company_id, seed_key, seed_version, status)
               VALUES (NULL, $1, '1.0.0', 'Pending')`,
              [`forge-global-sb-${randomUUID().slice(0, 8)}`],
            );
          }),
        ).rejects.toThrow();
      });

      it("withTenant(A): UPDATE global row company_id NULL→A is rejected (re-home blocked, mig 0436)", async () => {
        await expect(rehomeInTx("seed_batches")).rejects.toThrow(/company_id is immutable/i);
      });
    });

    describe("seed_items (nullable company_id — forge-global deny)", () => {
      it("withTenant(A): INSERT with company_id = NULL is rejected (cannot forge global seed item)", async () => {
        // First seed a real batch for A to satisfy the FK (seed_batch_id NOT NULL).
        const batchA = await direct.query(
          `INSERT INTO seed_batches
             (company_id, seed_key, seed_version, status)
           VALUES ($1, $2, '1.0.0', 'Pending')
           RETURNING id`,
          [A.companyId, `deny-si-sb-${randomUUID().slice(0, 8)}`],
        );
        const batchId = batchA.rows[0].id as string;

        await expect(
          asTenant(app, A.companyId, async (c) => {
            await c.query(
              `INSERT INTO seed_items
                 (seed_batch_id, company_id, target_table, target_key, operation, status)
               VALUES ($1, NULL, 'companies', $2, 'Upsert', 'Pending')`,
              [batchId, `forge-global-si-${randomUUID().slice(0, 8)}`],
            );
          }),
        ).rejects.toThrow();
      });

      it("withTenant(A): UPDATE global row company_id NULL→A is rejected (re-home blocked, mig 0436)", async () => {
        await expect(rehomeInTx("seed_items")).rejects.toThrow(/company_id is immutable/i);
      });
    });

    // ── 3. roles (0005 precedent — same nullable-tenant re-home defect, mig 0436 trigger) ─────
    // System role (company_id IS NULL) must not be re-homed into a tenant by the app role.
    describe("roles (nullable company_id — system-role re-home deny)", () => {
      it("withTenant(A): UPDATE system role company_id NULL→A is rejected (re-home blocked, mig 0436)", async () => {
        await expect(rehomeInTx("roles")).rejects.toThrow(/company_id is immutable/i);
      });
    });
  },
);
