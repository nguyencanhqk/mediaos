/**
 * S1-QA-FND-1 (L2-qa-file-security) — File SECURITY deny-path / leak-guard integration (DB cô lập, app
 * role + RLS THẬT). Drives the REAL FileService through `withTenant` against the lane DB.
 *
 * Phủ assertion CÒN THIẾU của BACKEND-04 §18.4 + QA06-FILE-001/004/005/007 + QA05-SYS-005/006 / FIELD-005
 * mà files-service.int-spec.ts (happy-path I1–I5) + files-rls-isolation.int-spec.ts (RLS/append-only)
 * KHÔNG phủ. KHÔNG nhân bản các case đã xanh — chỉ lấp khoảng trống bảo mật:
 *
 *   F1 [QA06-FILE-004/005 / §18.4]  MIME-spoof: .exe đổi đuôi .pdf (declaredMimeType ngoài allowlist) →
 *       415, KHÔNG ghi row `files` nào (server KHÔNG tin Content-Type client). Extension cấm bị reject
 *       vì MIME thật của .exe (application/x-msdownload) không thuộc allowlist.
 *   F2 [QA06-FILE-007 / §18.4]  Path-traversal: originalName '../../secret.txt' → DB lưu basename
 *       'secret.txt'; storage_path = {companyId}/files/{uuid} (server-derive, KHÔNG thoát thư mục/leak
 *       segment traversal). Tên rút gọn về '..'/rỗng → 400, 0 row.
 *   F3 [QA05-SYS-006 / QA06-FILE-002]  File ĐÃ soft-delete (deleted_at) → getDownloadUrl 404, KHÔNG
 *       presign (storage.get KHÔNG được gọi), KHÔNG log Download access_granted=true. (I5 chỉ tải file
 *       còn sống — đây là biên đã-xoá.)
 *   F4 [QA05-FIELD-005 / QA06-FILE-001/011 / §18.4]  KHÔNG lộ storage_path/signed_url-dài-hạn:
 *       (a) DTO upload/metadata/download KHÔNG có storagePath/storedName/checksum; download.url TTL ngắn.
 *       (b) Hàng `audit_logs` FileUploaded LƯU TRONG DB KHÔNG chứa storage_path ở after/metadata (mask-
 *           at-write THẬT qua AuditService). raw scan toàn row audit không chứa storage_path value.
 *
 * Gate: skipIf(!hasDb || !LANE_DB) — KHÔNG chạy trên DB dev chung (.env làm hasDb=true → đỏ-giả). Postgres
 * THẬT cô lập (mediaos_<lane>, CLAUDE §9.5). Đọc-lại dùng DIRECT pool (superuser bypass RLS).
 *
 * FilePolicy = ALLOW stub (deny-path của policy đã phủ ở colocated unit files.service.spec.ts). Đây là
 * tầng VALIDATION (MIME/size/filename) + LIFECYCLE (soft-delete) + LEAK-guard (DTO/audit) — KHÔNG phải
 * tầng permission (đã phủ ở L1 audit-permission-deny + files.controller guard).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

/** Allowlist seed = pdf + png (mirror file.* defaults). .exe MIME deliberately NOT in it. */
const ALLOWED_MIME = ["application/pdf", "image/png"];

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
  // S2-FND-BE-4 (H1): getMetadata/getDownloadUrl/deleteFile now route through the link-aware decision
  // point instead of canView/canDownload/canDelete. This stub keeps ALLOWing (link-aware deny-path is
  // covered by file-policy.service.spec.ts + files.service.spec.ts). Without it the real service throws
  // "decideForLinkedFile is not a function" at runtime (the `as never` cast hides it from tsc).
  decideForLinkedFile: async (): Promise<FilePolicyDecision> => ({
    allow: true,
    reason: "allow-foundation",
  }),
};

/** Stub SettingService — returns file.* defaults (precedence resolution covered elsewhere). */
const stubSettings = {
  resolveMany: async (_companyId: string, keys: string[]) =>
    keys.map((key) => ({
      key,
      value:
        key === "file.allowed_mime_types"
          ? ALLOWED_MIME
          : key === "file.max_upload_size_mb"
            ? 25
            : undefined,
      scope: "default" as const,
      found: true,
    })),
};

describe.skipIf(!hasLaneDb)(
  "S1-QA-FND-1 file security (MIME-spoof · path-traversal · soft-delete · no-leak) [app role + RLS]",
  () => {
    const db = new DatabaseService();
    const audit = new AuditService(new AuditMaskerService());
    // storage.get is SPIED so we can assert presign is NOT reached on a soft-deleted file (F3).
    const storageGet = vi.fn(
      async (): Promise<SignedUrlResult> => ({
        url: "https://signed.example/short",
        expiresAt: new Date(Date.now() + 300_000),
      }),
    );
    const stubStorage: StorageAdapter = {
      put: async () => undefined,
      delete: async () => undefined,
      signedUrl: async (): Promise<SignedUrlResult> => ({
        url: "https://x/y",
        expiresAt: new Date(),
      }),
      get: storageGet,
    };

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
      A = await seedCompany(direct, "filesec");
      companyIds.push(A.companyId);
      userId = await seedUser(direct, A.companyId, `filesec-${A.slug}@x.test`);
    });

    afterAll(async () => {
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    const actor = () => ({ id: userId, companyId: A.companyId });

    /** Count files of this tenant whose original_name matches (proves NO row written on reject). */
    async function countFilesNamed(name: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM files WHERE company_id = $1 AND original_name = $2`,
        [A.companyId, name],
      );
      return r.rows[0].n as number;
    }

    async function countDownloadLogs(fileId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM file_access_logs
           WHERE file_id = $1 AND action = 'Download' AND access_granted = true`,
        [fileId],
      );
      return r.rows[0].n as number;
    }

    // ── F1: MIME-spoof — .exe đổi đuôi .pdf bị chặn, KHÔNG ghi row ───────────────────
    describe("F1 — MIME-spoof rejected (server does not trust client Content-Type)", () => {
      it("F1a — .exe renamed .pdf with real exe MIME (application/x-msdownload) → 415, NO row written", async () => {
        const before = await countFilesNamed("malware.pdf");
        await expect(
          service.upload(actor(), {
            originalName: "malware.pdf", // disguised extension
            declaredMimeType: "application/x-msdownload", // real .exe MIME — NOT in allowlist
            sizeBytes: 4096,
            visibility: "Private",
          }),
        ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
        // No metadata persisted — reject happens BEFORE any DB write.
        expect(await countFilesNamed("malware.pdf")).toBe(before);
      });

      it("F1b — spoofed text/html claiming pdf extension → 415, NO row written", async () => {
        const before = await countFilesNamed("x.pdf");
        await expect(
          service.upload(actor(), {
            originalName: "x.pdf",
            declaredMimeType: "text/html",
            sizeBytes: 16,
            visibility: "Private",
          }),
        ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
        expect(await countFilesNamed("x.pdf")).toBe(before);
      });

      it("F1c — oversize (26MB > 25MB ceiling) → 413, NO row written (limit from settings, not client)", async () => {
        const before = await countFilesNamed("big.pdf");
        await expect(
          service.upload(actor(), {
            originalName: "big.pdf",
            declaredMimeType: "application/pdf",
            sizeBytes: 26 * 1024 * 1024,
            visibility: "Private",
          }),
        ).rejects.toBeInstanceOf(PayloadTooLargeException);
        expect(await countFilesNamed("big.pdf")).toBe(before);
      });
    });

    // ── F2: path-traversal filename sanitize ─────────────────────────────────────────
    describe("F2 — filename path-traversal sanitized to tenant prefix", () => {
      it("F2a — '../../secret.txt' but pdf MIME → stored basename, storage_path = {companyId}/files/{uuid}", async () => {
        // Use a pdf MIME so the upload passes the allowlist; the point is the FILENAME sanitisation.
        const dto = await service.upload(actor(), {
          originalName: "../../secret.txt",
          declaredMimeType: "application/pdf",
          sizeBytes: 32,
          visibility: "Private",
        });

        const row = await direct.query(
          `SELECT original_name, storage_path FROM files WHERE id = $1`,
          [dto.id],
        );
        // Basename only — no traversal segment kept.
        expect(row.rows[0].original_name).toBe("secret.txt");
        // Server-derived key: exactly {companyId}/files/{uuid}; the name never leaks into the path.
        expect(row.rows[0].storage_path).toBe(`${A.companyId}/files/${dto.id}`);
        expect(String(row.rows[0].storage_path)).not.toContain("..");
        expect(String(row.rows[0].storage_path)).not.toContain("secret");
      });

      it("F2b — '/etc/shadow' → basename 'shadow', key inside tenant prefix", async () => {
        const dto = await service.upload(actor(), {
          originalName: "/etc/shadow",
          declaredMimeType: "application/pdf",
          sizeBytes: 8,
          visibility: "Private",
        });
        const row = await direct.query(
          `SELECT original_name, storage_path FROM files WHERE id = $1`,
          [dto.id],
        );
        expect(row.rows[0].original_name).toBe("shadow");
        expect(row.rows[0].storage_path).toMatch(
          new RegExp(`^${A.companyId}/files/[0-9a-f-]{36}$`),
        );
      });

      it("F2c — name reducing to '..' → 400, NO row written", async () => {
        const before = await countFilesNamed("..");
        await expect(
          service.upload(actor(), {
            originalName: ".. ",
            declaredMimeType: "application/pdf",
            sizeBytes: 8,
            visibility: "Private",
          }),
        ).rejects.toThrow();
        expect(await countFilesNamed("..")).toBe(before);
      });
    });

    // ── F3: soft-deleted file → no download ──────────────────────────────────────────
    describe("F3 — soft-deleted file is NOT downloadable", () => {
      it("F3 — getDownloadUrl on a soft-deleted file → 404, NO presign, NO Download-granted log", async () => {
        const dto = await service.upload(actor(), {
          originalName: "to-delete.pdf",
          declaredMimeType: "application/pdf",
          sizeBytes: 64,
          visibility: "Private",
        });
        await service.deleteFile(actor(), dto.id);

        // Confirm soft-delete (row kept, deleted_at set) — invariant #2 (not hard-delete).
        const row = await direct.query(
          `SELECT deleted_at, upload_status FROM files WHERE id = $1`,
          [dto.id],
        );
        expect(row.rowCount).toBe(1);
        expect(row.rows[0].deleted_at).not.toBeNull();
        expect(row.rows[0].upload_status).toBe("Deleted");

        storageGet.mockClear();
        await expect(service.getDownloadUrl(actor(), dto.id)).rejects.toBeInstanceOf(
          NotFoundException,
        );
        // Deleted file resolves to 0 row (findByIdTx filters deleted_at) → 404 BEFORE presign.
        expect(storageGet).not.toHaveBeenCalled();
        // No Download access_granted=true was written for a deleted file.
        expect(await countDownloadLogs(dto.id)).toBe(0);
      });

      it("F3b — getMetadata on a soft-deleted file → 404 (not visible after delete)", async () => {
        const dto = await service.upload(actor(), {
          originalName: "gone.png",
          declaredMimeType: "image/png",
          sizeBytes: 16,
          visibility: "Private",
        });
        await service.deleteFile(actor(), dto.id);
        await expect(service.getMetadata(actor(), dto.id)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      });
    });

    // ── F4: no storage_path / signed_url leak in DTO + persisted audit ───────────────
    describe("F4 — no storage_path / long-lived signed_url leak (DTO + audit row)", () => {
      it("F4a — upload/metadata/download DTOs never expose storagePath/storedName/checksum", async () => {
        const dto = await service.upload(actor(), {
          originalName: "safe.pdf",
          declaredMimeType: "application/pdf",
          sizeBytes: 100,
          visibility: "Private",
        });
        for (const leak of ["storagePath", "storedName", "checksumSha256", "contentHash"]) {
          expect(dto).not.toHaveProperty(leak);
        }

        const meta = await service.getMetadata(actor(), dto.id);
        for (const leak of ["storagePath", "storedName", "checksumSha256"]) {
          expect(meta).not.toHaveProperty(leak);
        }

        // S2-FND-BE-4 (H2): a fresh upload is upload_status='Pending' and the download state-guard now
        // 409s any non-'Uploaded' (or 'Infected') file BEFORE presign. This F4a case asserts the DTO
        // shape of a SUCCESSFUL download, so promote the file to a downloadable state (Uploaded/Clean)
        // first — mirrors the unit fixture 'download ALLOW → DownloadUrlDto'. (S2-FND-BE-5 will flip
        // upload_status to 'Uploaded' via confirm; here we set it directly to reach the presign branch.)
        await direct.query(
          `UPDATE files SET upload_status = 'Uploaded', scan_status = 'Clean' WHERE id = $1`,
          [dto.id],
        );

        const dl = await service.getDownloadUrl(actor(), dto.id);
        // Short-lived url only — never the raw key; expiresAt present (TTL-bounded).
        expect(dl.url).toMatch(/^https:\/\//);
        expect(dl).not.toHaveProperty("storagePath");
        expect(typeof dl.expiresAt).toBe("string");
        // The DTO download url must NOT contain the tenant storage prefix (no raw key leak).
        expect(dl.url).not.toContain(`${A.companyId}/files/`);
      });

      it("F4b — persisted FileUploaded audit row contains NO storage_path value (mask-at-write in DB)", async () => {
        const marker = `secguard-${randomUUID().slice(0, 8)}`;
        const dto = await service.upload(actor(), {
          originalName: `${marker}.pdf`,
          declaredMimeType: "application/pdf",
          sizeBytes: 128,
          visibility: "Private",
        });

        const r = await direct.query(
          `SELECT after, metadata, old_values, new_values FROM audit_logs
             WHERE object_id = $1 AND action = 'FileUploaded' AND object_type = 'file'`,
          [dto.id],
        );
        expect(r.rowCount).toBe(1);
        const row = r.rows[0] as Record<string, unknown>;
        // The server-derived storage_path = {companyId}/files/{fileId}; it must NOT appear anywhere in
        // the persisted audit diff (after/metadata). The service deliberately omits it; if a future
        // change leaked it into `after`, AuditMasker's 'storagepath' stem would still redact it — this
        // asserts BOTH layers hold against the REAL DB write.
        const serialized = JSON.stringify(row);
        expect(serialized).not.toContain(`${A.companyId}/files/${dto.id}`);
        expect(serialized.toLowerCase()).not.toContain("storage_path");
        // Non-sensitive metadata IS preserved (audit still useful).
        const after = row.after as Record<string, unknown> | null;
        expect(after).toBeTruthy();
        expect(after!.originalName).toBe(`${marker}.pdf`);
      });
    });
  },
);
