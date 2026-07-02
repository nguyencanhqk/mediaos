/**
 * S2-FND-BE-4 (filehardening) — File access hardening deny-path (integration, Postgres THẬT, DB CÔ LẬP).
 *
 * Crown-jewel (file access). RED-first deny-path over the REAL guard-chain (JwtAuthGuard → CompanyGuard →
 * PermissionGuard) + REAL FilePolicy + REAL RLS. Gate cứng `hasDb && LANE_DB` (memory
 * integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB ⇒ đỏ-giả trên DB dev chung.
 * Colocated dưới src/ với tên `.int.spec.ts` (khớp include glob `src/**\/*.spec.ts` — KHÔNG dùng
 * `.int-spec.ts` dưới src kẻo KHÔNG được gom ⇒ green-false).
 *
 * Phủ (5 nhánh + access-log THẬT):
 *   (a)  H1 fail-closed no-resolver — file linked to HR/EmployeeContract (KHÔNG resolver ở prod) + user CÓ
 *        download:foundation-file → GET /:id/download → 403 + file_access_logs Download access_granted=false
 *        denied_reason='deny-no-resolver' (KHÔNG rơi về fallback FOUNDATION.FILE.* dù grant có).
 *   (b)  H2 state-guard — file Uploaded+Infected VÀ biến thể upload_status='Pending' (0-link, authz ALLOW) →
 *        GET /:id/download-url + /:id/download → 409, body KHÔNG chứa url, deny-log denied_reason ∈
 *        {'infected','not-uploaded'} (storage KHÔNG được presign — không có url trong body).
 *   (b2) H1 multi-link — file có 2 link, ≥1 thiếu resolver → 403 deny-no-resolver (most-restrictive).
 *   (c)  Regression — file foundation-thuần 0-link Uploaded+Clean/NotRequired + download grant → GET
 *        /:id/download → 302 (Location signed-url) VÀ /:id/download-url → 200 {url}.
 *   (d)  view KHÔNG bị siết — metadata của file Pending/Infected (đã authz view) → GET /:id → 200.
 *   (e)  2-tenant/RLS — A KHÔNG truy cập file của B → 404 (metadata + download-url).
 *
 * PIN theo CẶP SEED THẬT: role tùy biến chỉ grant (view, 'foundation-file') + (download, 'foundation-file')
 * (mig 0435, is_sensitive=false) → chứng minh fallback SẼ allow, nhưng link-no-resolver vẫn DENY (H1).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { AllExceptionsFilter } from "../../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../auth/password.service";
import { directPool, hasDb } from "../../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../../test/helpers/seed";

const LOGIN_PW = "Passw0rd!test99";

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane (KHÔNG phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

function bearer(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: LOGIN_PW });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

/**
 * Chèn 1 file RAW (direct pool, bypass RLS) với upload/scan_status tường minh + storage_path TRONG prefix
 * tenant ({companyId}/files/{id}) để presign qua assertKeyInTenant khi test regression 302/200. Trả về id.
 */
async function seedFileRow(
  direct: Pool,
  companyId: string,
  uploadedBy: string,
  opts: { uploadStatus?: string; scanStatus?: string } = {},
): Promise<string> {
  const id = randomUUID();
  const name = `f-${randomUUID().slice(0, 8)}.pdf`;
  await direct.query(
    `INSERT INTO files
       (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
        storage_provider, storage_path, visibility, upload_status, scan_status, uploaded_by)
     VALUES ($1, $2, $3, $3, 'application/pdf', 1024, 'MinIO', $4, 'Private', $5, $6, $7)`,
    [
      id,
      companyId,
      name,
      `${companyId}/files/${id}`,
      opts.uploadStatus ?? "Uploaded",
      opts.scanStatus ?? "NotRequired",
      uploadedBy,
    ],
  );
  return id;
}

/** Gắn 1 file_link RAW (module/entity KHÔNG resolver ở prod → dùng để chứng minh fail-closed). */
async function seedFileLinkRow(
  direct: Pool,
  companyId: string,
  fileId: string,
  createdBy: string,
  opts: { moduleCode: string; entityType: string },
): Promise<void> {
  await direct.query(
    `INSERT INTO file_links
       (company_id, file_id, module_code, entity_type, entity_id, link_type, access_scope, created_by)
     VALUES ($1, $2, $3, $4, $5, 'Attachment', 'Company', $6)`,
    [companyId, fileId, opts.moduleCode, opts.entityType, randomUUID(), createdBy],
  );
}

/** Đọc file_access_logs của 1 file (append-only) để assert dòng deny/allow THẬT. */
async function accessLogs(
  direct: Pool,
  fileId: string,
): Promise<Array<{ action: string; access_granted: boolean; denied_reason: string | null }>> {
  const r = await direct.query(
    `SELECT action, access_granted, denied_reason
       FROM file_access_logs WHERE file_id = $1 ORDER BY created_at`,
    [fileId],
  );
  return r.rows as Array<{
    action: string;
    access_granted: boolean;
    denied_reason: string | null;
  }>;
}

describe.skipIf(!runDb)(
  "S2-FND-BE-4 file access hardening (H1 fail-closed + H2 state-guard)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    let downloaderToken: string; // user A — role CHỈ view+download:foundation-file

    // Files (tenant A)
    let fileHrLinked: string; // Uploaded/Clean + 1 HR link (no resolver) → H1 deny
    let fileMultiLink: string; // Uploaded/Clean + 2 links (≥1 no resolver) → H1 deny
    let fileInfected: string; // Uploaded/Infected, 0-link → H2 deny 'infected'
    let filePending: string; // Pending/NotRequired, 0-link → H2 deny 'not-uploaded'
    let fileClean: string; // Uploaded/Clean, 0-link → regression 302/200
    let fileNotRequired: string; // Uploaded/NotRequired, 0-link → regression 200
    // File (tenant B) — cross-tenant target
    let fileB: string;

    const companyIds: string[] = [];

    beforeAll(async () => {
      // Object storage (presign is offline HMAC) — set defaults so the regression 302/200 path can sign a
      // URL even without a running MinIO. `??=` respects an already-configured shell env.
      process.env.S3_ENDPOINT ??= "http://localhost:9000";
      process.env.S3_ACCESS_KEY ??= "mediaos";
      process.env.S3_SECRET_KEY ??= "changeme_dev_only";
      process.env.S3_BUCKET ??= "mediaos-assets";
      process.env.S3_FORCE_PATH_STYLE ??= "true";

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();

      A = await seedCompany(direct, "fha");
      B = await seedCompany(direct, "fhb");
      companyIds.push(A.companyId, B.companyId);
      const pw = await new PasswordService().hash(LOGIN_PW);

      // Custom role: CHỈ view + download foundation-file (fallback SẼ allow foundation-owned files).
      const viewPerm = await seedPermissionCatalog(direct, "view", "foundation-file", false);
      const downloadPerm = await seedPermissionCatalog(
        direct,
        "download",
        "foundation-file",
        false,
      );
      const roleId = await seedRole(
        direct,
        A.companyId,
        `file-downloader-${randomUUID().slice(0, 6)}`,
      );
      await seedRolePermission(direct, roleId, viewPerm, "ALLOW", "Company");
      await seedRolePermission(direct, roleId, downloadPerm, "ALLOW", "Company");

      const email = `dl-${randomUUID().slice(0, 8)}@a.test`;
      const uid = await seedUser(direct, A.companyId, email, pw);
      await seedUserRole(direct, uid, roleId, A.companyId);

      // Tenant B: a user (uploader) + a file (cross-tenant target).
      const emailB = `up-${randomUUID().slice(0, 8)}@b.test`;
      const uidB = await seedUser(direct, B.companyId, emailB, pw);

      // Files (tenant A)
      fileHrLinked = await seedFileRow(direct, A.companyId, uid, {
        uploadStatus: "Uploaded",
        scanStatus: "Clean",
      });
      await seedFileLinkRow(direct, A.companyId, fileHrLinked, uid, {
        moduleCode: "HR",
        entityType: "EmployeeContract",
      });

      fileMultiLink = await seedFileRow(direct, A.companyId, uid, {
        uploadStatus: "Uploaded",
        scanStatus: "Clean",
      });
      await seedFileLinkRow(direct, A.companyId, fileMultiLink, uid, {
        moduleCode: "HR",
        entityType: "EmployeeContract",
      });
      await seedFileLinkRow(direct, A.companyId, fileMultiLink, uid, {
        moduleCode: "LEAVE",
        entityType: "LeaveAttachment",
      });

      fileInfected = await seedFileRow(direct, A.companyId, uid, {
        uploadStatus: "Uploaded",
        scanStatus: "Infected",
      });
      filePending = await seedFileRow(direct, A.companyId, uid, {
        uploadStatus: "Pending",
        scanStatus: "NotRequired",
      });
      fileClean = await seedFileRow(direct, A.companyId, uid, {
        uploadStatus: "Uploaded",
        scanStatus: "Clean",
      });
      fileNotRequired = await seedFileRow(direct, A.companyId, uid, {
        uploadStatus: "Uploaded",
        scanStatus: "NotRequired",
      });

      // File (tenant B)
      fileB = await seedFileRow(direct, B.companyId, uidB, {
        uploadStatus: "Uploaded",
        scanStatus: "Clean",
      });

      downloaderToken = await login(app, A.slug, email);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    // ── (a) H1 fail-closed no-resolver → 403 + deny-log 'deny-no-resolver' ─────────────
    it("(a) HR-linked file (no resolver) + download grant → GET /:id/download → 403 + deny-log deny-no-resolver", async () => {
      const res = await api(app)
        .get(`/foundation/files/${fileHrLinked}/download`)
        .set(...bearer(downloaderToken));
      expect(res.status, JSON.stringify(res.body)).toBe(403);

      const logs = await accessLogs(direct, fileHrLinked);
      const deny = logs.find((l) => l.action === "Download" && l.access_granted === false);
      expect(deny, "expected a denied Download access-log row").toBeDefined();
      expect(deny!.denied_reason).toBe("deny-no-resolver");
      // Proof the FOUNDATION.FILE.* fallback was NOT reached: no granted Download row exists for this file.
      expect(logs.some((l) => l.action === "Download" && l.access_granted === true)).toBe(false);
    });

    // ── (b) H2 state-guard → 409, no url, deny-log 'infected' / 'not-uploaded' ─────────
    it("(b) Infected file (0-link, authz ALLOW) → GET /:id/download-url → 409, no url, deny-log 'infected'", async () => {
      const res = await api(app)
        .get(`/foundation/files/${fileInfected}/download-url`)
        .set(...bearer(downloaderToken));
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.data ?? null).toBeNull();
      expect(JSON.stringify(res.body)).not.toMatch(/https?:\/\//); // no signed URL leaked

      const logs = await accessLogs(direct, fileInfected);
      const deny = logs.find((l) => l.action === "Download" && l.access_granted === false);
      expect(deny!.denied_reason).toBe("infected");
    });

    it("(b) Pending file (0-link, authz ALLOW) → GET /:id/download → 409, deny-log 'not-uploaded'", async () => {
      const res = await api(app)
        .get(`/foundation/files/${filePending}/download`)
        .redirects(0)
        .set(...bearer(downloaderToken));
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.headers.location ?? null).toBeNull(); // no redirect to a signed URL

      const logs = await accessLogs(direct, filePending);
      const deny = logs.find((l) => l.action === "Download" && l.access_granted === false);
      expect(deny!.denied_reason).toBe("not-uploaded");
    });

    // ── (b2) H1 multi-link — 1 of 2 links missing resolver → 403 deny-no-resolver ──────
    it("(b2) multi-link file (≥1 link no resolver) → GET /:id/download-url → 403 deny-no-resolver", async () => {
      const res = await api(app)
        .get(`/foundation/files/${fileMultiLink}/download-url`)
        .set(...bearer(downloaderToken));
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      const logs = await accessLogs(direct, fileMultiLink);
      const deny = logs.find((l) => l.action === "Download" && l.access_granted === false);
      expect(deny!.denied_reason).toBe("deny-no-resolver");
    });

    // ── (c) Regression — foundation-owned 0-link Uploaded+Clean/NotRequired still downloads ─────
    it("(c) foundation-owned 0-link Uploaded+Clean → GET /:id/download → 302 (Location signed-url) + granted log", async () => {
      const res = await api(app)
        .get(`/foundation/files/${fileClean}/download`)
        .redirects(0)
        .set(...bearer(downloaderToken));
      expect(res.status, JSON.stringify(res.body)).toBe(302);
      expect(res.headers.location).toMatch(/^https?:\/\//);

      const logs = await accessLogs(direct, fileClean);
      expect(logs.some((l) => l.action === "Download" && l.access_granted === true)).toBe(true);
    });

    it("(c) foundation-owned 0-link Uploaded+NotRequired → GET /:id/download-url → 200 {url}", async () => {
      const res = await api(app)
        .get(`/foundation/files/${fileNotRequired}/download-url`)
        .set(...bearer(downloaderToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.url).toMatch(/^https?:\/\//);
      expect(res.body.data.expiresAt).toBeDefined();
    });

    // ── (d) view NOT restricted — metadata of Pending/Infected file (authz) → 200 ──────
    it("(d) metadata of an Infected file (authz view) → GET /:id → 200 (only content blocked, not metadata)", async () => {
      const res = await api(app)
        .get(`/foundation/files/${fileInfected}`)
        .set(...bearer(downloaderToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.id).toBe(fileInfected);
      expect(res.body.data.scanStatus).toBe("Infected");
      expect(res.body.data).not.toHaveProperty("storagePath");
    });

    it("(d) metadata of a Pending file (authz view) → GET /:id → 200", async () => {
      const res = await api(app)
        .get(`/foundation/files/${filePending}`)
        .set(...bearer(downloaderToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.uploadStatus).toBe("Pending");
    });

    // ── (e) 2-tenant/RLS — A cannot access B's file → 404 ──────────────────────────────
    it("(e) tenant A cannot read tenant B's file metadata → GET /:id → 404", async () => {
      const res = await api(app)
        .get(`/foundation/files/${fileB}`)
        .set(...bearer(downloaderToken));
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("(e) tenant A cannot download tenant B's file → GET /:id/download-url → 404", async () => {
      const res = await api(app)
        .get(`/foundation/files/${fileB}/download-url`)
        .set(...bearer(downloaderToken));
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });
  },
);
