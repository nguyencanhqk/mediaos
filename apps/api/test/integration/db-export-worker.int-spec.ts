/**
 * WAVE 3 C2 — DbExportWorker materialize (ADR-0020 §4, nối scaffold AC-9 P4). DB cô lập (mediaos_ac9exp).
 * Storage được STUB (putObject spy) — KHÔNG cần MinIO bucket; worker logic (claim/read/CSV/finalize/audit)
 * chạy trên Postgres thật.
 *
 *  (a) lifecycle queued→done: claim → đọc target tenant → CSV → putObject → status=done + object_key + row_count.
 *  (b) REDACT: CSV CHỈ cột allowlist (KHÔNG password_hash); body không chứa hash.
 *  (c) claim scope: chỉ 'queued' bị claim; job 'done' KHÔNG re-claim.
 *  (d) failure: table ngoài allowlist → status=failed + error set, putObject KHÔNG gọi, audit status=failed.
 *  (e) audit: MỖI job ghi 1 operator.db_export vào target tenant (metadata-only).
 *  (f) getJob: 'done' + object_key ⇒ DbExportJobService trả presigned downloadUrl (on-demand, ephemeral).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OperatorActionAuditService } from "../../src/platform/operator-action-audit.service";
import type { ObjectStorageService } from "../../src/storage/object-storage.service";
import { DbExportWorker } from "../../src/db-ops/db-export.worker";
import { DbExportJobService } from "../../src/db-ops/db-export-job.service";
import { DbExportJobRepository } from "../../src/db-ops/db-export-job.repository";
import { DbOpsGrantRepository } from "../../src/db-ops/db-ops-grant.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const createdJobs: string[] = [];

async function seedQueuedJob(
  direct: import("pg").Pool,
  requesterUserId: string,
  targetTenantId: string,
  tableName: string,
  filter: unknown = null,
): Promise<string> {
  const { rows } = await direct.query(
    `INSERT INTO db_export_jobs (requester_user_id, target_tenant_id, table_name, filter, status)
     VALUES ($1, $2, $3, $4, 'queued') RETURNING id`,
    [requesterUserId, targetTenantId, tableName, filter == null ? null : JSON.stringify(filter)],
  );
  const id = rows[0].id as string;
  createdJobs.push(id);
  return id;
}

describe.skipIf(!hasDb)("WAVE 3 C2 DbExportWorker materialize", () => {
  const direct = directPool();
  let A: SeededTenant;
  let operatorId: string;
  let worker: DbExportWorker;
  let service: DbExportJobService;
  let putObject: ReturnType<typeof vi.fn>;
  let createDownloadUrl: ReturnType<typeof vi.fn>;
  let storage: ObjectStorageService;

  beforeAll(async () => {
    A = await seedCompany(direct, "ac9expA");
    operatorId = await seedUser(direct, A.companyId, `op-${randomUUID().slice(0, 8)}@a.test`);
    await seedUser(direct, A.companyId, `ua-${randomUUID().slice(0, 8)}@a.test`);
    await seedUser(direct, A.companyId, `ub-${randomUUID().slice(0, 8)}@a.test`);
  });

  beforeEach(() => {
    putObject = vi.fn(async () => {});
    createDownloadUrl = vi.fn(async () => "https://minio.test/signed-get");
    storage = {
      putObject,
      isConfigured: () => true,
      createDownloadUrl,
    } as unknown as ObjectStorageService;
    const audit = new OperatorActionAuditService(new AuditService());
    worker = new DbExportWorker(new DatabaseService(), new DbExportJobRepository(), storage, audit);
    service = new DbExportJobService(
      new DatabaseService(),
      new DbExportJobRepository(),
      new DbOpsGrantRepository(),
      audit,
      storage,
    );
  });

  afterAll(async () => {
    if (createdJobs.length) {
      await direct.query("DELETE FROM db_export_jobs WHERE id = ANY($1::uuid[])", [createdJobs]);
    }
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  async function jobRow(id: string) {
    const { rows } = await direct.query("SELECT * FROM db_export_jobs WHERE id = $1", [id]);
    return rows[0];
  }

  it("(a) lifecycle queued→done: CSV uploaded, status/object_key/row_count set", async () => {
    const jobId = await seedQueuedJob(direct, operatorId, A.companyId, "users");
    const res = await worker.processBatch();
    expect(res.done).toBeGreaterThanOrEqual(1);

    const row = await jobRow(jobId);
    expect(row.status).toBe("done");
    expect(row.object_key).toBe(`${A.companyId}/db-exports/${jobId}`);
    expect(Number(row.row_count)).toBeGreaterThanOrEqual(3); // 3 users seeded ở A

    expect(putObject).toHaveBeenCalledTimes(1);
    const [key, body, contentType] = putObject.mock.calls[0];
    expect(key).toBe(`${A.companyId}/db-exports/${jobId}`);
    expect(contentType).toBe("text/csv");
    expect(String(body)).toContain("@a.test"); // có email seed
  });

  it("(b) REDACT: CSV header chỉ cột allowlist, KHÔNG password_hash", async () => {
    const jobId = await seedQueuedJob(direct, operatorId, A.companyId, "users");
    await worker.processBatch();
    const body = String(putObject.mock.calls[0][1]);
    const header = body.split("\r\n")[0];
    expect(header).toContain("email");
    expect(header).toContain("company_id");
    expect(header).not.toContain("password_hash");
    expect(body).not.toContain("password_hash");
  });

  it("(c) claim scope: job 'done' KHÔNG bị re-claim", async () => {
    const jobId = await seedQueuedJob(direct, operatorId, A.companyId, "users");
    await worker.processBatch(); // → done
    const res2 = await worker.processBatch(); // không còn 'queued' của job này
    // job đã done không xuất hiện lại
    const stillDone = await jobRow(jobId);
    expect(stillDone.status).toBe("done");
    // res2.claimed có thể là 0 (không còn job queued) — không re-process job done.
    expect(res2.claimed).toBe(0);
  });

  it("(d) failure: table ngoài allowlist → status=failed + error, putObject KHÔNG gọi", async () => {
    const jobId = await seedQueuedJob(direct, operatorId, A.companyId, "payslips");
    const res = await worker.processBatch();
    expect(res.failed).toBeGreaterThanOrEqual(1);
    const row = await jobRow(jobId);
    expect(row.status).toBe("failed");
    expect(row.error).toBeTruthy();
    expect(putObject).not.toHaveBeenCalled();
  });

  it("(e) audit: mỗi job 'done' ghi 1 operator.db_export vào target (metadata-only)", async () => {
    const before = await direct.query(
      "SELECT count(*)::int AS c FROM audit_logs WHERE action='operator.db_export' AND company_id=$1",
      [A.companyId],
    );
    const jobId = await seedQueuedJob(direct, operatorId, A.companyId, "users");
    await worker.processBatch();
    const after = await direct.query(
      `SELECT after FROM audit_logs WHERE action='operator.db_export' AND company_id=$1
       ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    const countNow = await direct.query(
      "SELECT count(*)::int AS c FROM audit_logs WHERE action='operator.db_export' AND company_id=$1",
      [A.companyId],
    );
    expect(countNow.rows[0].c).toBe((before.rows[0].c as number) + 1);
    const payload = after.rows[0].after as Record<string, unknown>;
    expect(payload.status).toBe("done");
    expect(payload.table).toBe("users");
    expect(JSON.stringify(payload)).not.toContain("password");
  });

  it("(f) getJob: 'done' job ⇒ presigned downloadUrl on-demand (ephemeral)", async () => {
    const jobId = await seedQueuedJob(direct, operatorId, A.companyId, "users");
    await worker.processBatch();
    const dto = await service.getJob({ id: operatorId, companyId: A.companyId }, jobId);
    expect(dto.status).toBe("done");
    expect(dto.downloadUrl).toBe("https://minio.test/signed-get");
    expect(createDownloadUrl).toHaveBeenCalledWith(`${A.companyId}/db-exports/${jobId}`, A.companyId);
  });
});
