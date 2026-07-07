/**
 * S2-FND-DB-2-B — FileService.link() re-link-conflict integration (Postgres THẬT, DB CÔ LẬP).
 *
 * Lane A (S2-FND-DB-2-A-mig, mig 0472) ép 2 UNIQUE constraint trên `file_links`:
 *   - `uq_file_links_entity_file_active` (6 cột — company_id, module_code, entity_type, entity_id,
 *     file_id, link_type — WHERE deleted_at IS NULL, MỚI 0472): 2 lần link ĐÚNG cùng file vào ĐÚNG
 *     entity+link_type → vi phạm.
 *   - `uq_file_links_primary_per_entity_type` (5 cột is_primary=true, mig 0433, GIỮ NGUYÊN): 2 file
 *     KHÁC nhau cùng đánh dấu primary cho cùng entity+link_type → vi phạm.
 *
 * Lane B (WO này) bọc `FileService.link()` bắt 23505 qua `isUniqueViolation()` + phân biệt bằng
 * `pgErrorField(err,'constraint')` → ConflictException với 2 MÃ KHÁC NHAU (KHÔNG gộp chung):
 *   FOUNDATION-FILE-ERR-DUP-LINK / FOUNDATION-FILE-ERR-DUP-PRIMARY.
 *
 * Phủ:
 *   (A) re-link ĐÚNG (entity, file_id, link_type) lần 2 → 409 FOUNDATION-FILE-ERR-DUP-LINK. Hành vi
 *       ĐỔI CÓ CHỦ ĐÍCH từ "thành công" (trước mig 0472) sang 409 — grep FE/service (S2-FND-DB-2-B lane
 *       report) xác nhận KHÔNG luồng nào phụ thuộc re-link idempotent-thành-công.
 *   (B) 2 file KHÁC nhau, cùng đánh dấu isPrimary=true cho cùng entity+link_type → file thứ 2 → 409
 *       FOUNDATION-FILE-ERR-DUP-PRIMARY (constraint 0433, KHÁC message với (A) — không gộp mã).
 *   (C) 2-tenant isolation (QA-05): business-key GIỐNG HỆT (module/entityType/entityId/linkType — thậm
 *       chí entityId TRÙNG UUID) ở tenant A và tenant B KHÔNG đụng uq — company_id nằm TRONG khoá 6-cột
 *       ⇒ cả 2 tenant link THÀNH CÔNG độc lập (không rò rỉ / không đụng constraint chéo tenant).
 *
 * Gate: hasDb (DATABASE_DIRECT_URL+URL) + LANE_DB (DB cô lập theo lane). Thiếu LANE_DB → SKIP (KHÔNG
 * chạm DB dev chung 'mediaos' — memory: integration-test-lane-db-gate, CLAUDE.md §9.5).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
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

/** Stub FilePolicy that always ALLOWs — policy deny-path is covered elsewhere (files.service.spec.ts). */
const allowPolicy = {
  canView: async (): Promise<FilePolicyDecision> => ({ allow: true, reason: "allow-foundation" }),
  canDownload: async (): Promise<FilePolicyDecision> => ({
    allow: true,
    reason: "allow-foundation",
  }),
  canLink: async (): Promise<FilePolicyDecision> => ({ allow: true, reason: "allow-foundation" }),
  canUnlink: async (): Promise<FilePolicyDecision> => ({ allow: true, reason: "allow-foundation" }),
  canDelete: async (): Promise<FilePolicyDecision> => ({ allow: true, reason: "allow-foundation" }),
  decideForLinkedFile: async (): Promise<FilePolicyDecision> => ({
    allow: true,
    reason: "allow-foundation",
  }),
};

/** Stub storage adapter — link() never touches storage; kept only to satisfy the constructor. */
const stubStorage: StorageAdapter = {
  put: async () => undefined,
  delete: async () => undefined,
  signedUrl: async (): Promise<SignedUrlResult> => ({ url: "https://x/y", expiresAt: new Date() }),
  get: async (): Promise<SignedUrlResult> => ({
    url: "https://signed.example/x",
    expiresAt: new Date(Date.now() + 300_000),
  }),
  // S2-FND-FILE-2 (storage-port): confirm-upload flow only — unused by this suite (link() never
  // touches storage). Kept minimal so the stub still satisfies StorageAdapter.
  stat: async () => ({ exists: true, sizeBytes: 0 }),
  getBytes: async () => new Uint8Array(),
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

function makeService(): FileService {
  const db = new DatabaseService();
  const audit = new AuditService(new AuditMaskerService());
  return new FileService(
    db,
    new FileRepository(),
    new FileLinkRepository(),
    new FileAccessLogService(),
    audit,
    allowPolicy as never,
    stubSettings as never,
    stubStorage,
  );
}

describe.skipIf(!hasLaneDb)(
  "S2-FND-DB-2-B FileService.link() unique-violation → distinct 409 error codes",
  () => {
    const service = makeService();
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    let userA: string;
    let userB: string;
    const companyIds: string[] = [];

    beforeAll(async () => {
      direct = directPool();
      A = await seedCompany(direct, "fndlinkA");
      B = await seedCompany(direct, "fndlinkB");
      companyIds.push(A.companyId, B.companyId);
      userA = await seedUser(direct, A.companyId, `fndlink-${A.slug}@x.test`);
      userB = await seedUser(direct, B.companyId, `fndlink-${B.slug}@x.test`);
    });

    afterAll(async () => {
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    async function uploadFile(companyId: string, userId: string, name: string) {
      // S2-FND-FILE-2: upload() (register) now returns {fileId, uploadStatus, uploadUrl, expiresAt}. This
      // helper adapts to `{ id }` so the existing DUP-link callers (which only need the file id) stay intact.
      const res = await service.upload(
        { id: userId, companyId },
        {
          originalName: name,
          declaredMimeType: "application/pdf",
          sizeBytes: 512,
          visibility: "Private",
        },
      );
      return { id: res.fileId };
    }

    it("(A) re-link ĐÚNG cùng (entity, file_id, link_type) lần 2 → 409 FOUNDATION-FILE-ERR-DUP-LINK", async () => {
      const file = await uploadFile(A.companyId, userA, "dup-link.pdf");
      const entityId = randomUUID();
      const linkInput = {
        fileId: file.id,
        moduleCode: "HR",
        entityType: "EmployeeContract",
        entityId,
        linkType: "Attachment" as const,
        accessScope: "Company" as const,
        isPrimary: false,
      };

      // 1st link → succeeds.
      const first = await service.link({ id: userA, companyId: A.companyId }, linkInput);
      expect(first.fileId).toBe(file.id);

      // 2nd link — IDENTICAL business key (same file, same entity, same link_type) — CHANGED behavior
      // (pre-0472 would have silently succeeded again; post-0472+lane-B → controlled 409 DUP-LINK).
      let caught: unknown;
      try {
        await service.link({ id: userA, companyId: A.companyId }, linkInput);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as ConflictException).getStatus()).toBe(409);
      expect((caught as Error).message).toContain("FOUNDATION-FILE-ERR-DUP-LINK");
    });

    it("(B) 2 file KHÁC nhau cùng isPrimary=true cho cùng entity+link_type → file thứ 2 → 409 FOUNDATION-FILE-ERR-DUP-PRIMARY", async () => {
      const fileOne = await uploadFile(A.companyId, userA, "primary-1.pdf");
      const fileTwo = await uploadFile(A.companyId, userA, "primary-2.pdf");
      const entityId = randomUUID();
      const baseInput = {
        moduleCode: "HR",
        entityType: "EmployeeContract",
        entityId,
        linkType: "Contract" as const,
        accessScope: "Company" as const,
        isPrimary: true,
      };

      const first = await service.link(
        { id: userA, companyId: A.companyId },
        { ...baseInput, fileId: fileOne.id },
      );
      expect(first.isPrimary).toBe(true);

      // fileTwo differs from fileOne → does NOT collide with uq_file_links_entity_file_active (6-col
      // key includes file_id) — it collides with uq_file_links_primary_per_entity_type (5-col,
      // is_primary=true) instead ⇒ MUST be the DUP-PRIMARY code, NOT DUP-LINK.
      let caught: unknown;
      try {
        await service.link(
          { id: userA, companyId: A.companyId },
          { ...baseInput, fileId: fileTwo.id },
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as ConflictException).getStatus()).toBe(409);
      expect((caught as Error).message).toContain("FOUNDATION-FILE-ERR-DUP-PRIMARY");
      expect((caught as Error).message).not.toContain("FOUNDATION-FILE-ERR-DUP-LINK");
    });

    it("(C) 2-tenant isolation — business-key GIỐNG HỆT (kể cả entityId trùng UUID) ở A và B KHÔNG đụng uq", async () => {
      const sharedEntityId = randomUUID();
      const fileA = await uploadFile(A.companyId, userA, "tenant-a.pdf");
      const fileB = await uploadFile(B.companyId, userB, "tenant-b.pdf");

      const inputFor = (fileId: string) => ({
        fileId,
        moduleCode: "HR",
        entityType: "EmployeeContract",
        entityId: sharedEntityId,
        linkType: "Attachment" as const,
        accessScope: "Company" as const,
        isPrimary: false,
      });

      // Both succeed independently — company_id is part of the 6-col uq key, so an identical
      // (module_code, entity_type, entity_id, link_type) tuple across 2 different tenants never collides,
      // even though entity_id is a literal UUID match (cross-tenant isolation, BẤT BIẾN #1).
      const linkA = await service.link({ id: userA, companyId: A.companyId }, inputFor(fileA.id));
      const linkB = await service.link({ id: userB, companyId: B.companyId }, inputFor(fileB.id));

      expect(linkA.entityId).toBe(sharedEntityId);
      expect(linkB.entityId).toBe(sharedEntityId);
      expect(linkA.id).not.toBe(linkB.id);
    });
  },
);
