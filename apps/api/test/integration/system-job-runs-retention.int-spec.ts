import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/db/index";
import * as schema from "../../src/db/schema";
import { SystemJobRunsRetentionJobHandler } from "../../src/foundation/retention/system-job-runs-retention.job-handler";
import { directPool, hasDb, workerPool } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * S5-SYS-CLEAN-1 — retention CÓ NGƯỠNG cho system_job_runs (🔴 RED trước GREEN, crown primitive XOÁ).
 *
 * Kiểm chứng trên Postgres THẬT (LANE_DB) — chạy END-TO-END qua `handler.run()` với `workerDb` = role
 * mediaos_worker (NOBYPASSRLS): worker chỉ có EXECUTE trên FUNCTION purge_system_job_runs (SECURITY DEFINER,
 * mig 0511), KHÔNG có DELETE bảng ⇒ đây là ĐÚNG đường prod. Unit spec (fake dbw) không chứng minh được
 * predicate SQL nào; mọi bằng chứng an toàn (giữ Failed/Partial/Running, sàn LMS ≥90d, giữ row global,
 * cô lập chéo tenant, EXECUTE chỉ worker) nằm Ở ĐÂY.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Nghiệm thu: `bash harness/check.sh
 * --all` / `REQUIRE_LANE_DB=1` (biến skip-vượt-ngưỡng thành ĐỎ — điều kiện MERGE, CLAUDE §9 vùng đỏ).
 */

const runDb = hasDb && Boolean(process.env.LANE_DB);
const DAY_MS = 24 * 3_600_000;
const RETENTION_ENV = "SYSTEM_JOB_RUNS_RETENTION_ENABLED";
// job_code cho row GLOBAL (company_id NULL) — không có FK company ⇒ dọn tường minh (không CASCADE theo company).
const GLOBAL_JOB_CODE = `SYSCLEAN_TEST_GLOBAL_${randomUUID().slice(0, 8)}`;

/** Seed 1 run-row qua DIRECT (superuser) với started_at TƯỜNG MINH (tuổi = daysAgo). company_id NULL = global. */
async function seedRun(
  direct: Pool,
  opts: { companyId: string | null; jobCode: string; status: string; daysAgo: number },
): Promise<string> {
  const startedAt = new Date(Date.now() - opts.daysAgo * DAY_MS).toISOString();
  const r = await direct.query(
    `INSERT INTO system_job_runs (company_id, job_code, status, triggered_by, started_at, created_at)
     VALUES ($1, $2, $3, 'Scheduler', $4::timestamptz, $4::timestamptz) RETURNING id`,
    [opts.companyId, opts.jobCode, opts.status, startedAt],
  );
  return r.rows[0].id as string;
}

/** true nếu run-row còn tồn tại. */
async function exists(direct: Pool, id: string): Promise<boolean> {
  const r = await direct.query(`SELECT 1 FROM system_job_runs WHERE id = $1`, [id]);
  return r.rowCount === 1;
}

describe.skipIf(!runDb)(
  "S5-SYS-CLEAN-1 system_job_runs retention (function + handler on real PG)",
  () => {
    const direct = directPool();
    const worker = workerPool(2);
    // Database (drizzle) trên pool worker → handler chạy AS mediaos_worker (đường prod thật).
    const wdb = drizzle(worker, { schema }) as unknown as Database;
    const handler = new SystemJobRunsRetentionJobHandler(wdb);

    const seededCompanies: string[] = [];
    let savedEnv: string | undefined;

    beforeAll(() => {
      savedEnv = process.env[RETENTION_ENV];
      delete process.env[RETENTION_ENV]; // mặc định XOÁ THẬT
    });

    afterAll(async () => {
      // Row tenant-scoped: CASCADE khi xoá company (FK ON DELETE CASCADE). Row GLOBAL (NULL): dọn tường minh.
      await direct.query(`DELETE FROM system_job_runs WHERE job_code = $1`, [GLOBAL_JOB_CODE]);
      if (seededCompanies.length) await cleanupTenants(direct, seededCompanies);
      if (savedEnv === undefined) delete process.env[RETENTION_ENV];
      else process.env[RETENTION_ENV] = savedEnv;
      await direct.end();
      await worker.end();
    });

    afterEach(() => {
      delete process.env[RETENTION_ENV]; // reset về mặc-định-xoá-thật sau test dry-run
    });

    async function newTenant(label: string): Promise<SeededTenant> {
      const t = await seedCompany(direct, label);
      seededCompanies.push(t.companyId);
      return t;
    }

    it("GIỮ Failed/Partial/Running vĩnh viễn + XOÁ Success theo ngưỡng (default 30d, LMS sàn 90d end-to-end)", async () => {
      const t = await newTenant("sysclean-mix");
      const other = `SYSCLEAN_TEST_OTHER_${randomUUID().slice(0, 8)}`;

      // GIỮ VĨNH VIỄN (non-success terminal) — 2 năm tuổi.
      const failed = await seedRun(direct, {
        companyId: t.companyId,
        jobCode: other,
        status: "Failed",
        daysAgo: 730,
      });
      const partial = await seedRun(direct, {
        companyId: t.companyId,
        jobCode: other,
        status: "Partial",
        daysAgo: 730,
      });
      const running = await seedRun(direct, {
        companyId: t.companyId,
        jobCode: other,
        status: "Running",
        daysAgo: 730,
      });
      // Non-LMS Success: 40d XOÁ (>30), 20d GIỮ (<30).
      const old40 = await seedRun(direct, {
        companyId: t.companyId,
        jobCode: other,
        status: "Success",
        daysAgo: 40,
      });
      const new20 = await seedRun(direct, {
        companyId: t.companyId,
        jobCode: other,
        status: "Success",
        daysAgo: 20,
      });
      // LMS Success: 100d XOÁ (>90), 50d GIỮ (sàn ≥90 — nếu lỡ dùng 30 thì 50d đã bị xoá).
      const lms100 = await seedRun(direct, {
        companyId: t.companyId,
        jobCode: "LMS_USER_SYNC",
        status: "Success",
        daysAgo: 100,
      });
      const lms50 = await seedRun(direct, {
        companyId: t.companyId,
        jobCode: "LMS_USER_SYNC",
        status: "Success",
        daysAgo: 50,
      });

      const res = await handler.run({ companyId: t.companyId });

      // Non-success terminal: GIỮ.
      expect(await exists(direct, failed)).toBe(true);
      expect(await exists(direct, partial)).toBe(true);
      expect(await exists(direct, running)).toBe(true);
      // Success theo ngưỡng.
      expect(await exists(direct, old40)).toBe(false); // >30d → xoá
      expect(await exists(direct, new20)).toBe(true); // <30d → giữ
      expect(await exists(direct, lms100)).toBe(false); // LMS >90d → xoá
      expect(await exists(direct, lms50)).toBe(true); // LMS <90d → GIỮ (sàn end-to-end)

      expect(res.metadata).toMatchObject({ dryRun: false });
      expect((res.metadata as { deleted: number }).deleted).toBe(2); // old40 + lms100
    });

    it("GIỮ VĨNH VIỄN row global (company_id IS NULL) + metadata globalRowsKept", async () => {
      const t = await newTenant("sysclean-global");
      const globalOld = await seedRun(direct, {
        companyId: null,
        jobCode: GLOBAL_JOB_CODE,
        status: "Success",
        daysAgo: 730,
      });

      const res = await handler.run({ companyId: t.companyId });

      expect(await exists(direct, globalOld)).toBe(true); // global 2 năm tuổi vẫn GIỮ (predicate tenant-scoped)
      expect((res.metadata as { globalRowsKept: number }).globalRowsKept).toBeGreaterThanOrEqual(1);
    });

    it("cô lập chéo tenant: purge(A) XOÁ row cũ của A NHƯNG KHÔNG đụng row Success cũ của tenant B", async () => {
      const a = await newTenant("sysclean-a");
      const b = await newTenant("sysclean-b");
      const code = `SYSCLEAN_TEST_XT_${randomUUID().slice(0, 8)}`;
      // Cùng test chứng minh CẢ HAI nửa: xoá đúng cái phải xoá (A) + KHÔNG đụng cái không được đụng (B).
      const aOld = await seedRun(direct, {
        companyId: a.companyId,
        jobCode: code,
        status: "Success",
        daysAgo: 730,
      });
      const bOld = await seedRun(direct, {
        companyId: b.companyId,
        jobCode: code,
        status: "Success",
        daysAgo: 730,
      });

      await handler.run({ companyId: a.companyId });

      expect(await exists(direct, aOld)).toBe(false); // row A cũ → XOÁ
      expect(await exists(direct, bOld)).toBe(true); // row B còn nguyên (DELETE pin company_id = A)
    });

    it("kill-switch OFF (env=false): dry-run — KHÔNG xoá dù eligible>0", async () => {
      const t = await newTenant("sysclean-dry");
      const code = `SYSCLEAN_TEST_DRY_${randomUUID().slice(0, 8)}`;
      const old = await seedRun(direct, {
        companyId: t.companyId,
        jobCode: code,
        status: "Success",
        daysAgo: 100,
      });

      process.env[RETENTION_ENV] = "false";
      const res = await handler.run({ companyId: t.companyId });

      expect(await exists(direct, old)).toBe(true); // dry-run KHÔNG xoá
      expect(res.metadata).toMatchObject({ dryRun: true, deleted: 0 });
      expect((res.metadata as { eligible: number }).eligible).toBeGreaterThanOrEqual(1);
    });

    // ── Grant/permission: primitive XOÁ không nới bề mặt (BẤT BIẾN #2) ──────────────
    it("KHÔNG cấp DELETE bảng system_job_runs cho app/worker (chỉ SECURITY DEFINER function xoá được)", async () => {
      const g = await direct.query(
        `SELECT grantee, privilege_type FROM information_schema.role_table_grants
       WHERE table_name = 'system_job_runs' AND grantee IN ('mediaos_app','mediaos_worker')`,
      );
      const rows = g.rows as { grantee: string; privilege_type: string }[];
      expect(
        rows.filter((r) => r.grantee === "mediaos_app").map((r) => r.privilege_type),
      ).not.toContain("DELETE");
      expect(
        rows.filter((r) => r.grantee === "mediaos_worker").map((r) => r.privilege_type),
      ).not.toContain("DELETE");
    });

    it("EXECUTE trên purge_system_job_runs = CHỈ mediaos_worker (KHÔNG app, KHÔNG PUBLIC)", async () => {
      const g = await direct.query(
        `SELECT p.oid,
              has_function_privilege('mediaos_worker', p.oid, 'EXECUTE') AS worker,
              has_function_privilege('mediaos_app',    p.oid, 'EXECUTE') AS app,
              has_function_privilege('public',         p.oid, 'EXECUTE') AS pub
       FROM pg_proc p WHERE p.proname = 'purge_system_job_runs'`,
      );
      expect(g.rowCount).toBe(1);
      const row = g.rows[0] as { worker: boolean; app: boolean; pub: boolean };
      expect(row.worker).toBe(true);
      expect(row.app).toBe(false);
      expect(row.pub).toBe(false);
    });
  },
);
