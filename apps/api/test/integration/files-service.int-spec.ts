/**
 * S1-FND-FILE-1 (L3) — FileService happy-path + append-only + soft-delete integration (DB cô lập, app
 * role + RLS THẬT). Drives the REAL FileService through `withTenant` against the lane DB.
 *
 *   I1  upload → ghi 1 row files (Private/Pending, company_id = tenant) + audit object_type='file'
 *       (FileUploaded) + file_access_logs action='Upload' access_granted=true — CÙNG tx.
 *   I2  link → file_links row (created_by) + audit object_type='file_link' (FileLinked) + log 'Link'.
 *   I3  unlink → file_links SOFT-DELETE (deleted_at set, row CÒN) + audit 'file_link' (FileUnlinked) +
 *       log 'Unlink'.
 *   I4  delete → files SOFT-DELETE (deleted_at set, upload_status='Deleted', row CÒN) + audit 'file'
 *       (FileDeleted) + log 'Delete'.
 *   I5  audit object_type 'file'/'file_link' KHÔNG vỡ CHECK audit_logs_object_type_chk (mig 0440).
 *
 * Gate: skipIf(!hasDb || !LANE_DB) — KHÔNG chạy trên DB dev chung (.env làm hasDb=true → đỏ-giả). Postgres
 * THẬT cô lập (mediaos_<lane>). Đọc-lại dùng DIRECT pool (superuser bypass RLS).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { AuditMaskerService } from "../../src/events/audit-masker.service";
import { FileAccessLogService } from "../../src/foundation/files/file-access-log.service";
import { FileLinkRepository } from "../../src/foundation/files/file-link.repository";
import { FileRepository } from "../../src/foundation/files/file.repository";
import { FileService } from "../../src/foundation/files/files.service";
import type { FilePolicyDecision } from "../../src/foundation/files/file-policy.types";
import type { SignedUrlResult, StorageAdapter } from "../../src/storage/storage-adapter.port";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;

/** Stub FilePolicy that always ALLOWs — policy deny-path is covered by the colocated unit spec. */
const allowPolicy = {
  canView: async (): Promise<FilePolicyDecision> => ({ allow: true, reason: "allow-foundation" }),
  canDownload: async (): Promise<FilePolicyDecision> => ({
    allow: true,
    reason: "allow-foundation",
  }),
  canLink: async (): Promise<FilePolicyDecision> => ({ allow: true, reason: "allow-foundation" }),
  canUnlink: async (): Promise<FilePolicyDecision> => ({ allow: true, reason: "allow-foundation" }),
  canDelete: async (): Promise<FilePolicyDecision> => ({ allow: true, reason: "allow-foundation" }),
};

/** Stub storage adapter — presign returns a fake short-lived URL (no real S3 in integration). */
const stubStorage: StorageAdapter = {
  put: async () => undefined,
  delete: async () => undefined,
  signedUrl: async (): Promise<SignedUrlResult> => ({ url: "https://x/y", expiresAt: new Date() }),
  get: async (): Promise<SignedUrlResult> => ({
    url: "https://signed.example/x",
    expiresAt: new Date(Date.now() + 300_000),
  }),
};

/** Stub SettingService — returns the file.* defaults (precedence resolution covered elsewhere). */
const stubSettings = {
  resolveMany: async (_companyId: string, keys: string[]) =>
    keys.map((key) => ({
      key,
      value:
        key === "file.allowed_mime_types"
          ? ["application/pdf", "image/png"]
          : key === "file.max_upload_size_mb"
            ? 25
            : undefined,
      scope: "default" as const,
      found: true,
    })),
};

describe.skipIf(!hasLaneDb)(
  "S1-FND-FILE-1 FileService integration (app role + RLS + append-only)",
  () => {
    const db = new DatabaseService();
    const audit = new AuditService(new AuditMaskerService());
    const service = new FileService(
      db,
      new FileRepository(),
      new FileLinkRepository(),
      new FileAccessLogService(),
      audit,
      allowPolicy as never,
      stubSettings as never,
      stubStorage,
    );

    let direct: Pool;
    let A: SeededTenant;
    let userId: string;
    const companyIds: string[] = [];

    beforeAll(async () => {
      direct = directPool();
      A = await seedCompany(direct, "filesvc");
      companyIds.push(A.companyId);
      userId = await seedUser(direct, A.companyId, `filesvc-${A.slug}@x.test`);
    });

    afterAll(async () => {
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    const actor = () => ({ id: userId, companyId: A.companyId });

    async function countLogs(fileId: string, action: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM file_access_logs WHERE file_id = $1 AND action = $2 AND access_granted = true`,
        [fileId, action],
      );
      return r.rows[0].n as number;
    }

    async function countAudit(
      objectId: string,
      action: string,
      objectType: string,
    ): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs WHERE object_id = $1 AND action = $2 AND object_type = $3`,
        [objectId, action, objectType],
      );
      return r.rows[0].n as number;
    }

    it("I1 — upload writes files(Private/Pending) + audit 'file'/FileUploaded + access-log Upload (same tx)", async () => {
      const dto = await service.upload(actor(), {
        originalName: "report.pdf",
        declaredMimeType: "application/pdf",
        sizeBytes: 2048,
        visibility: "Private",
      });

      const row = await direct.query(`SELECT * FROM files WHERE id = $1`, [dto.id]);
      expect(row.rows[0].visibility).toBe("Private");
      expect(row.rows[0].upload_status).toBe("Pending");
      expect(row.rows[0].company_id).toBe(A.companyId);
      expect(row.rows[0].storage_path).toBe(`${A.companyId}/files/${dto.id}`);

      expect(await countLogs(dto.id, "Upload")).toBe(1);
      expect(await countAudit(dto.id, "FileUploaded", "file")).toBe(1);
    });

    it("I2/I3 — link then unlink: file_links inserted then SOFT-deleted (row kept); audit + logs written", async () => {
      const file = await service.upload(actor(), {
        originalName: "contract.pdf",
        declaredMimeType: "application/pdf",
        sizeBytes: 1024,
        visibility: "Private",
      });
      const entityId = randomUUID();

      const link = await service.link(actor(), {
        fileId: file.id,
        moduleCode: "HR",
        entityType: "EmployeeContract",
        entityId,
        linkType: "Contract",
        accessScope: "Company",
        isPrimary: false,
      });

      expect(await countLogs(file.id, "Link")).toBe(1);
      expect(await countAudit(link.id, "FileLinked", "file_link")).toBe(1);

      await service.unlink(actor(), link.id);

      // Soft-delete: row STILL present, deleted_at set (BẤT BIẾN #2 — không hard-delete).
      const linkRow = await direct.query(`SELECT * FROM file_links WHERE id = $1`, [link.id]);
      expect(linkRow.rowCount).toBe(1);
      expect(linkRow.rows[0].deleted_at).not.toBeNull();
      expect(linkRow.rows[0].deleted_by).toBe(userId);

      expect(await countLogs(file.id, "Unlink")).toBe(1);
      expect(await countAudit(link.id, "FileUnlinked", "file_link")).toBe(1);
    });

    it("I4 — delete soft-deletes file (row kept, upload_status='Deleted') + audit 'file'/FileDeleted + log", async () => {
      const file = await service.upload(actor(), {
        originalName: "old.png",
        declaredMimeType: "image/png",
        sizeBytes: 512,
        visibility: "Private",
      });

      await service.deleteFile(actor(), file.id);

      const row = await direct.query(`SELECT * FROM files WHERE id = $1`, [file.id]);
      expect(row.rowCount).toBe(1); // row kept (soft-delete)
      expect(row.rows[0].deleted_at).not.toBeNull();
      expect(row.rows[0].deleted_by).toBe(userId);
      expect(row.rows[0].upload_status).toBe("Deleted");

      expect(await countLogs(file.id, "Delete")).toBe(1);
      expect(await countAudit(file.id, "FileDeleted", "file")).toBe(1);
    });

    it("I5 — download (policy ALLOW) returns short-TTL url + logs Download access_granted=true", async () => {
      const file = await service.upload(actor(), {
        originalName: "view.png",
        declaredMimeType: "image/png",
        sizeBytes: 256,
        visibility: "Private",
      });

      const dl = await service.getDownloadUrl(actor(), file.id);
      expect(dl.url).toMatch(/^https:\/\//);
      expect(typeof dl.expiresAt).toBe("string");
      expect(dl).not.toHaveProperty("storagePath");

      expect(await countLogs(file.id, "Download")).toBe(1);
    });
  },
);
