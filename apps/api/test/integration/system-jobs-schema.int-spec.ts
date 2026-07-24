import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb, workerPool } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S2-FND-JOBS-1 — system_job_runs / system_job_locks structure + RLS + grant (🔴 RED trước GREEN).
 *
 * Kiểm chứng trên Postgres THẬT (LANE_DB=mediaos_jobs) — RLS worker-bypass + append/no-DELETE grant KHÔNG
 * mock được (CLAUDE.md §9.5). Bao 5 chiều nghiệm thu jobs_db:
 *
 *  1. App-role 2-tenant isolation: set app.current_company_id=A ⇒ SELECT thấy run-row A + run-row GLOBAL
 *     (company_id IS NULL), NHƯNG 0 row của tenant B. (Test RIÊNG, tách khỏi worker-bypass.)
 *  2. Worker-bypass: mediaos_worker (workerDb) thấy/ghi run-row MỌI tenant (policy USING(true)/WITH CHECK
 *     (true)); ghi company_id tường minh cho A và B đều thành công + đọc lại được.
 *  3. Cấu trúc DB: CHECK status + triggered_by chặn giá trị sai; system_job_runs RLS ENABLE+FORCE;
 *     system_job_locks KHÔNG RLS; grant no-DELETE cho MỌI role (query role_table_grants).
 *
 * company_id NULLABLE + KHÔNG DEFAULT (khác audit_logs) ⇒ worker ghi company_id tường minh; run-row global
 * = NULL. App SELECT-only (không INSERT/UPDATE grant) — read-only view nhật ký job liên quan tenant mình.
 */

// asTenant: mở tx qua mediaos_app + set GUC app.current_company_id (mẫu foundation-tables-tenant-deny).
async function asTenant<T>(
  app: Pool,
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

// Ghi 1 run-row qua WORKER (đường ghi thật của JobRunLogger). company_id tường minh (NULL = global).
async function insertRunAsWorker(
  worker: Pool,
  opts: {
    companyId: string | null;
    jobCode: string;
    status?: string;
    triggeredBy?: string;
  },
): Promise<string> {
  const r = await worker.query(
    `INSERT INTO system_job_runs (company_id, job_code, status, triggered_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.companyId, opts.jobCode, opts.status ?? "Running", opts.triggeredBy ?? "Scheduler"],
  );
  return r.rows[0].id as string;
}

// Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env làm hasDb=true → thiếu
// LANE_DB ⇒ đỏ-giả trên DB dev chung (mẫu temp-file-cleanup.int-spec.ts).
const runDb = hasDb && Boolean(process.env.LANE_DB);

describe.skipIf(!runDb)("S2-FND-JOBS-1 system_job_runs/locks — RLS + grant + structure", () => {
  const direct = directPool();
  const app = appPool(2);
  const worker = workerPool(2);

  let A: SeededTenant;
  let B: SeededTenant;
  const jobCode = `TEMP_FILE_CLEANUP_TEST_${randomUUID().slice(0, 8)}`;

  // run-row ids seeded via worker: A-tenant, B-tenant, GLOBAL (NULL).
  let runA: string;
  let runB: string;
  let runGlobal: string;
  const lockCode = `LOCK_TEST_${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    A = await seedCompany(direct, "jobs-a");
    B = await seedCompany(direct, "jobs-b");
    await seedUser(direct, A.companyId, `jobs-a-${randomUUID().slice(0, 6)}@x.test`);
    await seedUser(direct, B.companyId, `jobs-b-${randomUUID().slice(0, 6)}@x.test`);

    // Seed run-rows via WORKER (real write-path). A + B tenant + GLOBAL(NULL).
    runA = await insertRunAsWorker(worker, { companyId: A.companyId, jobCode });
    runB = await insertRunAsWorker(worker, { companyId: B.companyId, jobCode });
    runGlobal = await insertRunAsWorker(worker, { companyId: null, jobCode });
  });

  afterAll(async () => {
    // system_job_runs/system_job_locks KHÔNG nằm trong cleanupTenants (lane paths không chạm seed.ts).
    // FK company_id ON DELETE CASCADE + triggered_by_user_id SET NULL, nhưng dọn tường minh cho chắc trước
    // khi cleanupTenants xoá companies/users (company_id NO-DEFAULT global row NULL phải xoá theo job_code).
    await direct.query(`DELETE FROM system_job_runs WHERE job_code = $1`, [jobCode]);
    await direct.query(`DELETE FROM system_job_locks WHERE job_code = $1`, [lockCode]);
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
    await worker.end();
  });

  // ── 1. App-role 2-tenant isolation (RIÊNG, tách worker-bypass) ─────────────────
  describe("app-role 2-tenant isolation (system_job_runs_tenant_iso)", () => {
    it("set A: SELECT thấy run-row A + run-row GLOBAL(NULL), KHÔNG thấy run-row B", async () => {
      const rows = await asTenant(app, A.companyId, async (c) => {
        const r = await c.query(
          `SELECT id, company_id FROM system_job_runs WHERE job_code = $1 ORDER BY started_at`,
          [jobCode],
        );
        return r.rows as { id: string; company_id: string | null }[];
      });
      const ids = rows.map((x) => x.id);
      // Thấy A + GLOBAL.
      expect(ids).toContain(runA);
      expect(ids).toContain(runGlobal);
      // KHÔNG thấy B (RLS USING lọc tenant khác).
      expect(ids).not.toContain(runB);
      // Mọi row thấy được: company_id = A HOẶC NULL (không rò tenant khác).
      for (const row of rows) {
        expect(row.company_id === A.companyId || row.company_id === null).toBe(true);
      }
    });

    it("set B: đối xứng — thấy run-row B + GLOBAL, KHÔNG thấy run-row A", async () => {
      const ids = await asTenant(app, B.companyId, async (c) => {
        const r = await c.query(`SELECT id FROM system_job_runs WHERE job_code = $1`, [jobCode]);
        return (r.rows as { id: string }[]).map((x) => x.id);
      });
      expect(ids).toContain(runB);
      expect(ids).toContain(runGlobal);
      expect(ids).not.toContain(runA);
    });

    it("app KHÔNG có INSERT grant trên system_job_runs (ghi run-row bị chặn — chỉ worker ghi)", async () => {
      await expect(
        asTenant(app, A.companyId, async (c) => {
          await c.query(
            `INSERT INTO system_job_runs (company_id, job_code, status, triggered_by)
             VALUES ($1, $2, 'Running', 'Scheduler')`,
            [A.companyId, jobCode],
          );
        }),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  // ── 2. Worker-bypass (system_job_runs_worker_all USING(true)/WITH CHECK(true)) ──
  describe("worker-bypass (mediaos_worker thấy/ghi mọi tenant)", () => {
    it("worker thấy run-row của CẢ A, B và GLOBAL", async () => {
      const r = await worker.query(`SELECT id FROM system_job_runs WHERE job_code = $1`, [jobCode]);
      const ids = (r.rows as { id: string }[]).map((x) => x.id);
      expect(ids).toContain(runA);
      expect(ids).toContain(runB);
      expect(ids).toContain(runGlobal);
    });

    it("worker ghi company_id tường minh cho A và B đều thành công (WITH CHECK(true))", async () => {
      const idA = await insertRunAsWorker(worker, {
        companyId: A.companyId,
        jobCode,
        status: "Success",
      });
      const idB = await insertRunAsWorker(worker, {
        companyId: B.companyId,
        jobCode,
        status: "Success",
      });
      // Đọc lại qua worker — cả 2 tồn tại với company_id đúng.
      const check = await worker.query(
        `SELECT id, company_id FROM system_job_runs WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[idA, idB]],
      );
      const byId = new Map(
        (check.rows as { id: string; company_id: string }[]).map((x) => [x.id, x.company_id]),
      );
      expect(byId.get(idA)).toBe(A.companyId);
      expect(byId.get(idB)).toBe(B.companyId);
    });

    it("worker UPDATE Running→terminal (append-mostly, KHÔNG DELETE)", async () => {
      const id = await insertRunAsWorker(worker, {
        companyId: A.companyId,
        jobCode,
        status: "Running",
      });
      await worker.query(
        `UPDATE system_job_runs SET status = 'Success', finished_at = now() WHERE id = $1`,
        [id],
      );
      const r = await worker.query(`SELECT status FROM system_job_runs WHERE id = $1`, [id]);
      expect(r.rows[0].status).toBe("Success");
    });
  });

  // ── 3. Cấu trúc DB: CHECK · RLS · grant no-DELETE ──────────────────────────────
  describe("cấu trúc DB (CHECK / RLS / grant)", () => {
    it("CHECK chk_system_job_runs_status chặn status sai", async () => {
      await expect(
        worker.query(
          `INSERT INTO system_job_runs (company_id, job_code, status, triggered_by)
           VALUES ($1, $2, 'Bogus', 'Scheduler')`,
          [A.companyId, jobCode],
        ),
      ).rejects.toThrow(/chk_system_job_runs_status|violates check/i);
    });

    it("CHECK chk_system_job_runs_triggered_by chặn triggered_by sai", async () => {
      await expect(
        worker.query(
          `INSERT INTO system_job_runs (company_id, job_code, status, triggered_by)
           VALUES ($1, $2, 'Running', 'Robot')`,
          [A.companyId, jobCode],
        ),
      ).rejects.toThrow(/chk_system_job_runs_triggered_by|violates check/i);
    });

    it("system_job_runs RLS ENABLE + FORCE (BẤT BIẾN #1)", async () => {
      const f = await direct.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'system_job_runs'`,
      );
      expect(f.rows).toHaveLength(1);
      expect(f.rows[0].relrowsecurity).toBe(true);
      expect(f.rows[0].relforcerowsecurity).toBe(true);
    });

    it("system_job_runs có 2 policy per-role: tenant_iso (app) + worker_all (worker)", async () => {
      const p = await direct.query(
        `SELECT polname, roles.rolname AS role
           FROM pg_policy pol
           JOIN pg_class c ON c.oid = pol.polrelid
           JOIN LATERAL unnest(pol.polroles) AS r(oid) ON true
           JOIN pg_roles roles ON roles.oid = r.oid
          WHERE c.relname = 'system_job_runs'`,
      );
      const map = new Map(
        (p.rows as { polname: string; role: string }[]).map((x) => [x.polname, x.role]),
      );
      expect(map.get("system_job_runs_tenant_iso")).toBe("mediaos_app");
      expect(map.get("system_job_runs_worker_all")).toBe("mediaos_worker");
    });

    it("system_job_locks KHÔNG RLS (hạ tầng worker, mẫu processed_events)", async () => {
      const f = await direct.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'system_job_locks'`,
      );
      expect(f.rows).toHaveLength(1);
      expect(f.rows[0].relrowsecurity).toBe(false);
      expect(f.rows[0].relforcerowsecurity).toBe(false);
    });

    it("system_job_locks KHÔNG có cột company_id", async () => {
      const cols = await direct.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'system_job_locks' AND column_name = 'company_id'`,
      );
      expect(cols.rows).toHaveLength(0);
    });

    // LƯU Ý (S5-SYS-CLEAN-1): "KHÔNG DELETE role nào" ở đây = KHÔNG có DELETE trên BẢNG cho role runtime.
    // Từ mig 0511, XOÁ có kiểm soát tồn tại QUA FUNCTION `purge_system_job_runs` (SECURITY DEFINER, EXECUTE
    // chỉ mediaos_worker) — retention CÓ NGƯỠNG. Function grant KHÔNG xuất hiện trong role_table_grants nên
    // assert dưới vẫn đúng; đừng hiểu tên test là "không thể xoá row nào". (EXECUTE-only-worker verify ở
    // system-job-runs-retention.int-spec.ts.)
    it("grant system_job_runs: app = SELECT-only; worker = SELECT/INSERT/UPDATE; KHÔNG DELETE role nào", async () => {
      const g = await direct.query(
        `SELECT grantee, privilege_type FROM information_schema.role_table_grants
          WHERE table_name = 'system_job_runs' AND grantee IN ('mediaos_app', 'mediaos_worker')`,
      );
      const rows = g.rows as { grantee: string; privilege_type: string }[];
      const appPrivs = rows.filter((r) => r.grantee === "mediaos_app").map((r) => r.privilege_type);
      const workerPrivs = rows
        .filter((r) => r.grantee === "mediaos_worker")
        .map((r) => r.privilege_type);

      // App: SELECT-only.
      expect(appPrivs).toContain("SELECT");
      expect(appPrivs).not.toContain("INSERT");
      expect(appPrivs).not.toContain("UPDATE");
      expect(appPrivs).not.toContain("DELETE");
      // Worker: SELECT/INSERT/UPDATE, KHÔNG DELETE.
      expect(workerPrivs).toContain("SELECT");
      expect(workerPrivs).toContain("INSERT");
      expect(workerPrivs).toContain("UPDATE");
      expect(workerPrivs).not.toContain("DELETE");
    });

    it("grant system_job_locks: worker = SELECT/INSERT/UPDATE; app KHÔNG grant; KHÔNG DELETE role nào", async () => {
      const g = await direct.query(
        `SELECT grantee, privilege_type FROM information_schema.role_table_grants
          WHERE table_name = 'system_job_locks' AND grantee IN ('mediaos_app', 'mediaos_worker')`,
      );
      const rows = g.rows as { grantee: string; privilege_type: string }[];
      const appPrivs = rows.filter((r) => r.grantee === "mediaos_app").map((r) => r.privilege_type);
      const workerPrivs = rows
        .filter((r) => r.grantee === "mediaos_worker")
        .map((r) => r.privilege_type);

      // App KHÔNG chạm bảng lock (worker-infra thuần).
      expect(appPrivs).toHaveLength(0);
      // Worker: SELECT/INSERT/UPDATE, KHÔNG DELETE.
      expect(workerPrivs).toContain("SELECT");
      expect(workerPrivs).toContain("INSERT");
      expect(workerPrivs).toContain("UPDATE");
      expect(workerPrivs).not.toContain("DELETE");
    });

    it("KHÔNG có DELETE grant trên cả 2 bảng cho role APP-FACING nào (release lock = UPDATE)", async () => {
      // Owner (mediaos superuser) giữ mọi quyền ngầm trên bảng của nó — đó là role DDL/migration/seed,
      // KHÔNG phải role runtime app-facing. BẤT BIẾN #2 chặn DELETE cho MỌI role GRANTABLE (app/worker).
      const g = await direct.query(
        `SELECT grantee, table_name FROM information_schema.role_table_grants
          WHERE table_name IN ('system_job_runs', 'system_job_locks')
            AND privilege_type = 'DELETE'
            AND grantee IN ('mediaos_app', 'mediaos_worker')`,
      );
      expect(g.rows).toHaveLength(0);
    });

    it("worker acquire lock (INSERT) + release qua UPDATE locked_until quá khứ (KHÔNG DELETE)", async () => {
      await worker.query(
        `INSERT INTO system_job_locks (job_code, locked_by, locked_until)
         VALUES ($1, 'worker-1', now() + interval '5 minutes')`,
        [lockCode],
      );
      // Release = UPDATE locked_until về quá khứ (row VẪN tồn tại — không hard-delete).
      await worker.query(
        `UPDATE system_job_locks SET locked_until = now() - interval '1 minute' WHERE job_code = $1`,
        [lockCode],
      );
      const r = await worker.query(
        `SELECT locked_until < now() AS expired FROM system_job_locks WHERE job_code = $1`,
        [lockCode],
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].expired).toBe(true);
    });
  });
});
