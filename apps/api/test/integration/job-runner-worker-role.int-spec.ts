import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import { AuditMaskerService } from "../../src/events/audit-masker.service";
import { JobLockService } from "../../src/scheduler/job-lock.service";
import { JobRunLogger } from "../../src/scheduler/job-run-logger";
import { directPool, hasDb, workerPool } from "../helpers/integration-db";

/**
 * RED (BẤT BIẾN #1) — assertWorkerRoleSafe ĐIỀU-KIỆN-THẬT (KHÔNG mock): NODE_ENV=production + kết nối role
 * BYPASS RLS thật (directPool = superuser/owner mediaos) ⇒ JobLockService/JobRunLogger NÉM TRƯỚC mọi
 * INSERT/UPDATE (mẫu db-roles.int-spec.ts). Đối chứng: mediaos_worker (NOBYPASSRLS) KHÔNG ném + ghi được
 * run-row với company_id TƯỜNG MINH.
 *
 * Chạy trên Postgres THẬT (LANE_DB=mediaos_jobs). Role-safety chỉ kiểm chứng được với role thật — KHÔNG mock.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB
 * ⇒ đỏ-giả trên DB dev chung (mẫu temp-file-cleanup.int-spec.ts).
 */
const runDb = hasDb && Boolean(process.env.LANE_DB);

describe.skipIf(!runDb)(
  "JobRunner worker-role fail-closed (assertWorkerRoleSafe điều-kiện-thật)",
  () => {
    const direct = directPool();
    const worker = workerPool(2);
    const superDb = drizzle(direct, { schema });
    const workerDb = drizzle(worker, { schema });
    const origNodeEnv = process.env.NODE_ENV;

    let directPrivileged = false;

    beforeAll(async () => {
      const r = await direct.query(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
      );
      directPrivileged = Boolean(r.rows[0]?.rolsuper || r.rows[0]?.rolbypassrls);
      // ĐK-thật: mọi test dưới đây chạy như production để guard mode:'prod-only' NÉM (không chỉ warn).
      process.env.NODE_ENV = "production";
    });

    afterAll(async () => {
      process.env.NODE_ENV = origNodeEnv;
      await direct.end();
      await worker.end();
    });

    it("JobLockService.acquire qua role BYPASS RLS → NÉM, KHÔNG INSERT lock", async () => {
      const jobCode = `WROLE_LOCK_${randomUUID().slice(0, 8)}`;
      const locks = new JobLockService(superDb);

      if (directPrivileged) {
        await expect(locks.acquire(jobCode, "owner", 60_000)).rejects.toThrow(/BYPASS RLS/);
        // NÉM TRƯỚC INSERT: không có lock nào được ghi cho jobCode này.
        const { rows } = await direct.query("SELECT 1 FROM system_job_locks WHERE job_code = $1", [
          jobCode,
        ]);
        expect(rows).toHaveLength(0);
      } else {
        // Môi trường cấu hình direct role KHÔNG đặc quyền (hiếm) — guard đúng khi không ném sai.
        await expect(locks.acquire(jobCode, "owner", 60_000)).resolves.toBeTypeOf("boolean");
        await direct.query(
          "UPDATE system_job_locks SET locked_until = now() - interval '1 s' WHERE job_code = $1",
          [jobCode],
        );
      }
    });

    it("JobRunLogger.start qua role BYPASS RLS → NÉM, KHÔNG INSERT run-row", async () => {
      const jobCode = `WROLE_RUN_${randomUUID().slice(0, 8)}`;
      const runLog = new JobRunLogger(new AuditMaskerService(), superDb);

      if (directPrivileged) {
        await expect(
          runLog.start({ companyId: null, jobCode, triggeredBy: "System" }),
        ).rejects.toThrow(/BYPASS RLS/);
        const { rows } = await direct.query("SELECT 1 FROM system_job_runs WHERE job_code = $1", [
          jobCode,
        ]);
        expect(rows).toHaveLength(0);
      } else {
        const runId = await runLog.start({ companyId: null, jobCode, triggeredBy: "System" });
        expect(runId).toBeTypeOf("string");
        await direct.query("DELETE FROM system_job_runs WHERE job_code = $1", [jobCode]);
      }
    });

    it("đối chứng: mediaos_worker (NOBYPASSRLS) KHÔNG ném + ghi/finalize run-row (company_id tường minh)", async () => {
      const jobCode = `WROLE_OK_${randomUUID().slice(0, 8)}`;
      const runLog = new JobRunLogger(new AuditMaskerService(), workerDb);

      const runId = await runLog.start({ companyId: null, jobCode, triggeredBy: "System" });
      expect(runId).toBeTypeOf("string");

      await runLog.finish(runId, {
        status: "Failed",
        failed: 1,
        error: new Error("connect failed password=abc123"),
        metadata: { token: "leak", processed: 3 },
      });

      const { rows } = await direct.query(
        "SELECT status, company_id, error_message, metadata FROM system_job_runs WHERE id = $1",
        [runId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("Failed");
      expect(rows[0].company_id).toBeNull(); // global run, company_id tường minh = NULL
      // error_message đã SCRUB + metadata đã MASK (BẤT BIẾN #3) tại đường ghi thật.
      expect(String(rows[0].error_message)).not.toContain("abc123");
      expect((rows[0].metadata as Record<string, unknown>).token).toBe("***");
      expect((rows[0].metadata as Record<string, unknown>).processed).toBe(3);

      await direct.query("DELETE FROM system_job_runs WHERE job_code = $1", [jobCode]);
    });
  },
);
