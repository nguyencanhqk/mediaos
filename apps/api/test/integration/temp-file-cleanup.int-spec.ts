import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { TempFileCleanupJobHandler } from "../../src/foundation/files/temp-file-cleanup.job-handler";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S2-FND-JOBS-1 (jobs_tempfile · crown) — TEMP_FILE_CLEANUP link-safety + system soft-delete (🔴 RED-trước).
 *
 * Postgres THẬT (LANE_DB=mediaos_jobs) — eligibility (NOT EXISTS file_links active), soft-delete BY SYSTEM
 * (deleted_by=NULL — BẤT BIẾN #2 KHÔNG hard-delete), file_access_logs Delete (append-only #2) + audit
 * actorType='System' actorUserId=null KHÔNG mock được (RLS + grant + CHECK). Gate cứng `hasDb && LANE_DB`
 * (memory integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB ⇒ đỏ-giả trên DB dev chung.
 *
 * Phủ:
 *  (1) temp-expired + có file_link ACTIVE → KHÔNG xóa (deleted_at IS NULL).
 *  (2) temp-expired + KHÔNG link → xóa: deleted_by=NULL, upload_status='Deleted', file_access_logs Delete
 *      accessGranted=true actor_user_id NULL, audit FileDeleted object_type='file' actor_type='System'
 *      actor_user_id NULL result_status='Success'.
 *  (3) Pending quá file.pending_ttl_hours (default 24h) → xóa.
 *  (4) controls KHÔNG xóa: temp-expired-nhưng-relinked (link đã re-active), temp expires_at TƯƠNG LAI,
 *      Pending còn mới, file thường Uploaded.
 *  (5) 2-tenant: chạy handler cho A → file eligible của B KHÔNG bị đụng (RLS + company_id tường minh).
 */

const runDb = hasDb && Boolean(process.env.LANE_DB);

/** Seed 1 file RAW (direct, bypass RLS) với created_at/expires_at/is_temporary/upload_status tường minh. */
async function seedFile(
  direct: Pool,
  companyId: string,
  uploadedBy: string,
  opts: {
    isTemporary?: boolean;
    expiresAt?: Date | null;
    uploadStatus?: string;
    createdAt?: Date;
  },
): Promise<string> {
  const id = randomUUID();
  const name = `f-${randomUUID().slice(0, 8)}.pdf`;
  await direct.query(
    `INSERT INTO files
       (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
        storage_provider, storage_path, visibility, upload_status, scan_status,
        is_temporary, expires_at, uploaded_by, created_at, updated_at)
     VALUES ($1, $2, $3, $3, 'application/pdf', 1024, 'MinIO', $4, 'Private', $5, 'NotRequired',
             $6, $7, $8, $9, $9)`,
    [
      id,
      companyId,
      name,
      `${companyId}/files/${id}`,
      opts.uploadStatus ?? "Uploaded",
      opts.isTemporary ?? false,
      opts.expiresAt ?? null,
      uploadedBy,
      opts.createdAt ?? new Date(),
    ],
  );
  return id;
}

/** Gắn 1 file_link ACTIVE RAW (deleted_at IS NULL) → chặn cleanup (link-safety). */
async function seedActiveLink(
  direct: Pool,
  companyId: string,
  fileId: string,
  createdBy: string,
): Promise<void> {
  await direct.query(
    `INSERT INTO file_links
       (company_id, file_id, module_code, entity_type, entity_id, link_type, access_scope, created_by)
     VALUES ($1, $2, 'HR', 'contract', $3, 'Attachment', 'Company', $4)`,
    [companyId, fileId, randomUUID(), createdBy],
  );
}

async function fileRow(
  direct: Pool,
  fileId: string,
): Promise<{ deleted_at: Date | null; deleted_by: string | null; upload_status: string } | null> {
  const r = await direct.query(
    `SELECT deleted_at, deleted_by, upload_status FROM files WHERE id = $1`,
    [fileId],
  );
  return (
    (r.rows[0] as { deleted_at: Date | null; deleted_by: string | null; upload_status: string }) ??
    null
  );
}

async function accessLogs(
  direct: Pool,
  fileId: string,
): Promise<Array<{ action: string; access_granted: boolean; actor_user_id: string | null }>> {
  const r = await direct.query(
    `SELECT action, access_granted, actor_user_id FROM file_access_logs WHERE file_id = $1`,
    [fileId],
  );
  return r.rows as Array<{ action: string; access_granted: boolean; actor_user_id: string | null }>;
}

async function auditRows(
  direct: Pool,
  fileId: string,
): Promise<
  Array<{
    action: string;
    actor_type: string | null;
    actor_user_id: string | null;
    result_status: string | null;
  }>
> {
  const r = await direct.query(
    `SELECT action, actor_type, actor_user_id, result_status
       FROM audit_logs WHERE object_type = 'file' AND object_id = $1`,
    [fileId],
  );
  return r.rows as Array<{
    action: string;
    actor_type: string | null;
    actor_user_id: string | null;
    result_status: string | null;
  }>;
}

describe.skipIf(!runDb)(
  "S2-FND-JOBS-1 TEMP_FILE_CLEANUP — link-safety + system soft-delete",
  () => {
    let app: INestApplication;
    let handler: TempFileCleanupJobHandler;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;

    const PAST = new Date(Date.now() - 60 * 60_000); // 1h ago
    const FUTURE = new Date(Date.now() + 24 * 3_600_000); // +24h
    const OLD_CREATED = new Date(Date.now() - 48 * 3_600_000); // 48h ago (> default ttl 24h)

    // Tenant A files.
    let fTempLinked: string; // temp-expired + active link → KHÔNG xóa
    let fTempUnlinked: string; // temp-expired + no link → xóa
    let fPendingOld: string; // Pending quá 24h → xóa
    let fTempFuture: string; // temp expires_at tương lai → KHÔNG xóa
    let fPendingRecent: string; // Pending còn mới → KHÔNG xóa
    let fNormal: string; // Uploaded thường (not temporary) → KHÔNG xóa
    // Tenant B file (cross-tenant safety).
    let fB: string;

    const companyIds: string[] = [];

    beforeAll(async () => {
      process.env.S3_ENDPOINT ??= "http://localhost:9000";
      process.env.S3_ACCESS_KEY ??= "mediaos";
      process.env.S3_SECRET_KEY ??= "changeme_dev_only";
      process.env.S3_BUCKET ??= "mediaos-assets";
      process.env.S3_FORCE_PATH_STYLE ??= "true";

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      handler = app.get(TempFileCleanupJobHandler, { strict: false });
      direct = directPool();

      A = await seedCompany(direct, "tfa");
      B = await seedCompany(direct, "tfb");
      companyIds.push(A.companyId, B.companyId);

      const upA = await seedUser(direct, A.companyId, `tf-a-${randomUUID().slice(0, 6)}@x.test`);
      const upB = await seedUser(direct, B.companyId, `tf-b-${randomUUID().slice(0, 6)}@x.test`);

      fTempLinked = await seedFile(direct, A.companyId, upA, {
        isTemporary: true,
        expiresAt: PAST,
        uploadStatus: "Uploaded",
      });
      await seedActiveLink(direct, A.companyId, fTempLinked, upA);

      fTempUnlinked = await seedFile(direct, A.companyId, upA, {
        isTemporary: true,
        expiresAt: PAST,
        uploadStatus: "Uploaded",
      });
      fPendingOld = await seedFile(direct, A.companyId, upA, {
        isTemporary: false,
        uploadStatus: "Pending",
        createdAt: OLD_CREATED,
      });
      fTempFuture = await seedFile(direct, A.companyId, upA, {
        isTemporary: true,
        expiresAt: FUTURE,
        uploadStatus: "Uploaded",
      });
      fPendingRecent = await seedFile(direct, A.companyId, upA, {
        isTemporary: false,
        uploadStatus: "Pending",
        createdAt: new Date(),
      });
      fNormal = await seedFile(direct, A.companyId, upA, {
        isTemporary: false,
        uploadStatus: "Uploaded",
      });

      fB = await seedFile(direct, B.companyId, upB, {
        isTemporary: true,
        expiresAt: PAST,
        uploadStatus: "Uploaded",
      });

      // Chạy cleanup CHỈ cho tenant A (per-tenant enumerate — JobRunner sẽ gọi cho từng tenant).
      await handler.run({ companyId: A.companyId });
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    it("(1) temp-expired + có file_link ACTIVE → KHÔNG xóa (deleted_at IS NULL)", async () => {
      const row = await fileRow(direct, fTempLinked);
      expect(row?.deleted_at).toBeNull();
      expect(row?.upload_status).toBe("Uploaded");
      // KHÔNG có access-log Delete cho file được giữ.
      const logs = await accessLogs(direct, fTempLinked);
      expect(logs.some((l) => l.action === "Delete")).toBe(false);
    });

    it("(2) temp-expired + KHÔNG link → xóa BY SYSTEM: deleted_by=NULL, upload_status='Deleted'", async () => {
      const row = await fileRow(direct, fTempUnlinked);
      expect(row?.deleted_at).not.toBeNull();
      expect(row?.deleted_by).toBeNull(); // BẤT BIẾN: soft-delete hệ thống — actor null (KHÔNG hard-delete)
      expect(row?.upload_status).toBe("Deleted");
    });

    it("(2) file_access_logs Delete accessGranted=true actor_user_id NULL (append-only System actor)", async () => {
      const logs = await accessLogs(direct, fTempUnlinked);
      const del = logs.find((l) => l.action === "Delete");
      expect(del, "expected a Delete access-log row").toBeDefined();
      expect(del!.access_granted).toBe(true);
      expect(del!.actor_user_id).toBeNull();
    });

    it("(2) audit FileDeleted object_type='file' actor_type='System' actor_user_id NULL result_status='Success'", async () => {
      const rows = await auditRows(direct, fTempUnlinked);
      const del = rows.find((r) => r.action === "FileDeleted");
      expect(del, "expected a FileDeleted audit row").toBeDefined();
      expect(del!.actor_type).toBe("System");
      expect(del!.actor_user_id).toBeNull();
      expect(del!.result_status).toBe("Success");
    });

    it("(3) Pending quá file.pending_ttl_hours (default 24h) → xóa BY SYSTEM", async () => {
      const row = await fileRow(direct, fPendingOld);
      expect(row?.deleted_at).not.toBeNull();
      expect(row?.deleted_by).toBeNull();
      expect(row?.upload_status).toBe("Deleted");
    });

    it("(4) temp expires_at TƯƠNG LAI → KHÔNG xóa", async () => {
      const row = await fileRow(direct, fTempFuture);
      expect(row?.deleted_at).toBeNull();
    });

    it("(4) Pending còn mới (chưa quá TTL) → KHÔNG xóa", async () => {
      const row = await fileRow(direct, fPendingRecent);
      expect(row?.deleted_at).toBeNull();
      expect(row?.upload_status).toBe("Pending");
    });

    it("(4) file thường Uploaded (not temporary) → KHÔNG xóa", async () => {
      const row = await fileRow(direct, fNormal);
      expect(row?.deleted_at).toBeNull();
    });

    it("(5) 2-tenant — chạy handler cho A KHÔNG đụng file eligible của B", async () => {
      const row = await fileRow(direct, fB);
      expect(row?.deleted_at).toBeNull();
    });
  },
);
