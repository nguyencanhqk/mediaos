/**
 * S2-FND-BE-4 (fix-blastradius-realpair-test) — File access hardening deny-path (integration, Postgres
 * THẬT, DB CÔ LẬP).
 *
 * Crown-jewel (file access). RED-first deny-path over the REAL guard-chain (JwtAuthGuard → CompanyGuard →
 * PermissionGuard) + REAL FilePolicy + REAL RLS + the REAL HrContractFileResolver (registered by
 * EmployeesModule.onModuleInit when AppModule boots — same singleton FilePolicyService as FilesModule).
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB
 * ⇒ đỏ-giả trên DB dev chung. Colocated dưới src/ với tên `.int.spec.ts` (khớp include glob
 * `src/**\/*.spec.ts` — KHÔNG dùng `.int-spec.ts` dưới src kẻo KHÔNG được gom ⇒ green-false).
 *
 * FIX-ROUND (blast-radius + real-pair): the previous revision seeded the file_link with the FICTITIOUS
 * pair (module='HR', entity='EmployeeContract', PascalCase) which no production code ever emits, and
 * asserted 403 for EVERY HR-linked file — masking that the shipped "Download contract" button was broken
 * by H1. This revision seeds the link through the REAL production path — ContractService.linkFile — so the
 * pair (module='HR', entity='contract', lowercase — CONTRACT_ENTITY) is produced by production code, and
 * asserts the SHIPPED feature is RESTORED (in-scope → 200), fail-closed for out-of-scope (deny-resolver),
 * and still fail-closed for a genuinely-unregistered module pair (deny-no-resolver).
 *
 * Phủ (guard-chain THẬT + access-log THẬT):
 *   (a1) RESTORED regression — file linked to a REAL contract (HrContractFileResolver registered) + an
 *        IN-SCOPE viewer (view:contract Own = the contract's own employee) → GET /:id/download-url → 200 {url}
 *        AND GET /:id → 200. Proves the shipped Download-contract feature works (NOT 403 deny-no-resolver).
 *   (a2) fail-closed OUT-OF-SCOPE — an authenticated viewer whose contract scope EXCLUDES this contract →
 *        GET /:id/download-url → 403 + file_access_logs Download access_granted=false denied_reason='deny-resolver'.
 *   (a3) fail-closed NO-RESOLVER — file linked to a GENUINELY-unregistered module pair (LEAVE/LeaveAttachment,
 *        no resolver at prod) + user CÓ download:foundation-file → GET /:id/download → 403 + deny-log
 *        denied_reason='deny-no-resolver' (KHÔNG rơi về fallback FOUNDATION.FILE.* dù grant có).
 *   (b)  H2 state-guard — file Uploaded+Infected VÀ biến thể upload_status='Pending' (0-link, authz ALLOW) →
 *        GET /:id/download-url + /:id/download → 409, body KHÔNG chứa url, deny-log denied_reason ∈
 *        {'infected','not-uploaded'} (storage KHÔNG được presign — không có url trong body).
 *   (b2) H1 multi-link most-restrictive — file có 2 link: 1 REAL contract (would-allow) + 1 genuinely-
 *        unregistered → 403 deny-no-resolver (một link thiếu resolver ép DENY bất kể link kia).
 *   (c)  Regression — file foundation-thuần 0-link Uploaded+Clean/NotRequired + download grant → GET
 *        /:id/download → 302 (Location signed-url) VÀ /:id/download-url → 200 {url}.
 *   (d)  view KHÔNG bị siết — metadata của file Pending/Infected (đã authz view) → GET /:id → 200.
 *   (e)  2-tenant/RLS — A KHÔNG truy cập file của B → 404 (metadata + download-url).
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
// The REAL production link path — proves the (module='HR', entity='contract') pair is emitted by
// production code, not a hand-typed literal (eliminates the 'EmployeeContract' drift trap).
import { ContractService } from "../../employees/contract.service";
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

/**
 * Gắn 1 file_link RAW cho một cặp (module,entity) GENUINELY-unregistered ở prod (vd LEAVE/LeaveAttachment
 * — chưa có resolver) → dùng để chứng minh fail-closed 'deny-no-resolver'. KHÔNG dùng cho cặp có call-site
 * production (contract link luôn qua ContractService.linkFile để tránh pair-drift).
 */
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

/** Seed 1 employee_profile (owner của contract) — RAW (direct, bypass RLS). user_id = scope owner. */
async function seedEmployeeProfile(
  direct: Pool,
  companyId: string,
  userId: string,
): Promise<string> {
  const id = randomUUID();
  await direct.query(
    `INSERT INTO employee_profiles (id, company_id, user_id, status) VALUES ($1, $2, $3, 'active')`,
    [id, companyId, userId],
  );
  return id;
}

/** Seed 1 contract_type — RAW. */
async function seedContractType(direct: Pool, companyId: string): Promise<string> {
  const id = randomUUID();
  await direct.query(
    `INSERT INTO contract_types (id, company_id, name, requires_end_date) VALUES ($1, $2, $3, false)`,
    [id, companyId, `ct-${randomUUID().slice(0, 6)}`],
  );
  return id;
}

/** Seed 1 employee_contract (Active) — RAW. entity_id của file_link SẼ là contractId (production pattern). */
async function seedContract(
  direct: Pool,
  companyId: string,
  employeeId: string,
  contractTypeId: string,
): Promise<string> {
  const id = randomUUID();
  await direct.query(
    `INSERT INTO employee_contracts
       (id, company_id, employee_id, contract_type_id, start_date, status)
     VALUES ($1, $2, $3, $4, CURRENT_DATE, 'Active')`,
    [id, companyId, employeeId, contractTypeId],
  );
  return id;
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
  "S2-FND-BE-4 file access hardening (H1 real-pair resolver + H2 state-guard)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    let inScopeToken: string; // user A — contract's own employee (view:contract Own) + view/download:foundation-file
    let outScopeToken: string; // user A — view:contract Own but NOT the contract owner → out-of-scope
    let downloaderToken: string; // user A — role CHỈ view+download:foundation-file (foundation-owned + no-resolver cases)

    // Files (tenant A)
    let fileContract: string; // Uploaded/Clean + REAL HR/contract link → a1 allow / a2 deny-resolver
    let fileUnregistered: string; // Uploaded/Clean + LEAVE/LeaveAttachment link (no resolver) → a3 deny-no-resolver
    let fileMultiLink: string; // Uploaded/Clean + REAL HR/contract link + LEAVE link (no resolver) → b2 deny-no-resolver
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
      // app.init() fires EmployeesModule.onModuleInit → registers HrContractFileResolver for ('HR','contract').
      await app.init();
      direct = directPool();

      A = await seedCompany(direct, "fha");
      B = await seedCompany(direct, "fhb");
      companyIds.push(A.companyId, B.companyId);
      const pw = await new PasswordService().hash(LOGIN_PW);

      // Permission catalog (global): file fallback grants + contract read/manage pairs.
      const viewFilePerm = await seedPermissionCatalog(direct, "view", "foundation-file", false);
      const downloadFilePerm = await seedPermissionCatalog(
        direct,
        "download",
        "foundation-file",
        false,
      );
      const viewContractPerm = await seedPermissionCatalog(direct, "view", "contract", false);
      const manageContractPerm = await seedPermissionCatalog(direct, "manage", "contract", false);

      // Role: foundation download-only (fallback SẼ allow foundation-owned files; NO contract grant).
      const downloaderRole = await seedRole(
        direct,
        A.companyId,
        `file-downloader-${randomUUID().slice(0, 6)}`,
      );
      await seedRolePermission(direct, downloaderRole, viewFilePerm, "ALLOW", "Company");
      await seedRolePermission(direct, downloaderRole, downloadFilePerm, "ALLOW", "Company");

      // Role: in-scope contract viewer — foundation file grants + view:contract@Own (Own = own employee row).
      const inScopeRole = await seedRole(
        direct,
        A.companyId,
        `contract-inscope-${randomUUID().slice(0, 6)}`,
      );
      await seedRolePermission(direct, inScopeRole, viewFilePerm, "ALLOW", "Company");
      await seedRolePermission(direct, inScopeRole, downloadFilePerm, "ALLOW", "Company");
      await seedRolePermission(direct, inScopeRole, viewContractPerm, "ALLOW", "Own");

      // Role: contract admin — manage:contract@Company (used ONLY to drive ContractService.linkFile).
      const adminRole = await seedRole(
        direct,
        A.companyId,
        `contract-admin-${randomUUID().slice(0, 6)}`,
      );
      await seedRolePermission(direct, adminRole, manageContractPerm, "ALLOW", "Company");

      // Users (tenant A).
      const downloaderEmail = `dl-${randomUUID().slice(0, 8)}@a.test`;
      const downloaderId = await seedUser(direct, A.companyId, downloaderEmail, pw);
      await seedUserRole(direct, downloaderId, downloaderRole, A.companyId);

      // In-scope viewer = the contract's OWN employee (Own scope includes their own contract).
      const inScopeEmail = `in-${randomUUID().slice(0, 8)}@a.test`;
      const inScopeUserId = await seedUser(direct, A.companyId, inScopeEmail, pw);
      await seedUserRole(direct, inScopeUserId, inScopeRole, A.companyId);

      // Out-of-scope viewer = a DIFFERENT user with view:contract@Own — never the contract owner.
      const outScopeEmail = `out-${randomUUID().slice(0, 8)}@a.test`;
      const outScopeUserId = await seedUser(direct, A.companyId, outScopeEmail, pw);
      await seedUserRole(direct, outScopeUserId, inScopeRole, A.companyId);

      const adminEmail = `adm-${randomUUID().slice(0, 8)}@a.test`;
      const adminUserId = await seedUser(direct, A.companyId, adminEmail, pw);
      await seedUserRole(direct, adminUserId, adminRole, A.companyId);

      // Contracts owned BY the in-scope viewer (Own scope → in-scope for them, out-of-scope for others).
      // Two distinct contracts because file_links enforces ONE primary link per (entity_type,entity_id)
      // (uq_file_links_primary_per_entity_type) — fileContract and fileMultiLink each need their own.
      const employeeId = await seedEmployeeProfile(direct, A.companyId, inScopeUserId);
      const contractTypeId = await seedContractType(direct, A.companyId);
      const contractId = await seedContract(direct, A.companyId, employeeId, contractTypeId);
      const contract2Id = await seedContract(direct, A.companyId, employeeId, contractTypeId);

      // Tenant B: a user (uploader) + a file (cross-tenant target).
      const emailB = `up-${randomUUID().slice(0, 8)}@b.test`;
      const uidB = await seedUser(direct, B.companyId, emailB, pw);

      // Files (tenant A) — foundation-owned raw seeds.
      fileContract = await seedFileRow(direct, A.companyId, downloaderId, {
        uploadStatus: "Uploaded",
        scanStatus: "Clean",
      });
      fileMultiLink = await seedFileRow(direct, A.companyId, downloaderId, {
        uploadStatus: "Uploaded",
        scanStatus: "Clean",
      });
      fileUnregistered = await seedFileRow(direct, A.companyId, downloaderId, {
        uploadStatus: "Uploaded",
        scanStatus: "Clean",
      });
      fileInfected = await seedFileRow(direct, A.companyId, downloaderId, {
        uploadStatus: "Uploaded",
        scanStatus: "Infected",
      });
      filePending = await seedFileRow(direct, A.companyId, downloaderId, {
        uploadStatus: "Pending",
        scanStatus: "NotRequired",
      });
      fileClean = await seedFileRow(direct, A.companyId, downloaderId, {
        uploadStatus: "Uploaded",
        scanStatus: "Clean",
      });
      fileNotRequired = await seedFileRow(direct, A.companyId, downloaderId, {
        uploadStatus: "Uploaded",
        scanStatus: "NotRequired",
      });

      // REAL production link: emit (module='HR', entity='contract') through ContractService.linkFile — the
      // exact call the shipped "Download contract" button relies on. No hand-typed pair.
      const contractService = app.get(ContractService, { strict: false });
      const adminUser = { id: adminUserId, companyId: A.companyId };
      await contractService.linkFile(adminUser, contractId, fileContract);
      await contractService.linkFile(adminUser, contract2Id, fileMultiLink);
      // The genuinely-unregistered link on the multi-link file (LEAVE has no resolver at prod).
      await seedFileLinkRow(direct, A.companyId, fileMultiLink, downloaderId, {
        moduleCode: "LEAVE",
        entityType: "LeaveAttachment",
      });
      // A file linked ONLY to a genuinely-unregistered module pair → proves deny-no-resolver fail-closed.
      await seedFileLinkRow(direct, A.companyId, fileUnregistered, downloaderId, {
        moduleCode: "LEAVE",
        entityType: "LeaveAttachment",
      });

      // File (tenant B)
      fileB = await seedFileRow(direct, B.companyId, uidB, {
        uploadStatus: "Uploaded",
        scanStatus: "Clean",
      });

      downloaderToken = await login(app, A.slug, downloaderEmail);
      inScopeToken = await login(app, A.slug, inScopeEmail);
      outScopeToken = await login(app, A.slug, outScopeEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    // ── (a1) RESTORED regression — real contract link + in-scope viewer → 200 (NOT 403) ─────
    it("(a1) real HR/contract-linked file + in-scope viewer → GET /:id/download-url → 200 {url} (shipped Download RESTORED)", async () => {
      const res = await api(app)
        .get(`/foundation/files/${fileContract}/download-url`)
        .set(...bearer(inScopeToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.url).toMatch(/^https?:\/\//);
      expect(res.body.data.expiresAt).toBeDefined();

      const logs = await accessLogs(direct, fileContract);
      expect(logs.some((l) => l.action === "Download" && l.access_granted === true)).toBe(true);
    });

    it("(a1) real HR/contract-linked file + in-scope viewer → GET /:id metadata → 200 (view is link-aware, resolver allows)", async () => {
      const res = await api(app)
        .get(`/foundation/files/${fileContract}`)
        .set(...bearer(inScopeToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.id).toBe(fileContract);
      expect(res.body.data).not.toHaveProperty("storagePath");
    });

    // ── (a2) fail-closed OUT-OF-SCOPE → 403 deny-resolver + deny-log ──────────────────────
    it("(a2) real HR/contract-linked file + out-of-scope viewer → GET /:id/download-url → 403 + deny-log deny-resolver", async () => {
      const res = await api(app)
        .get(`/foundation/files/${fileContract}/download-url`)
        .set(...bearer(outScopeToken));
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).not.toMatch(/https?:\/\//); // no signed URL leaked

      const logs = await accessLogs(direct, fileContract);
      const deny = logs.find((l) => l.action === "Download" && l.access_granted === false);
      expect(deny, "expected a denied Download access-log row").toBeDefined();
      expect(deny!.denied_reason).toBe("deny-resolver");
    });

    // ── (a3) fail-closed NO-RESOLVER → 403 deny-no-resolver + deny-log ────────────────────
    it("(a3) genuinely-unregistered link (LEAVE/LeaveAttachment) + download grant → GET /:id/download → 403 + deny-log deny-no-resolver", async () => {
      const res = await api(app)
        .get(`/foundation/files/${fileUnregistered}/download`)
        .redirects(0)
        .set(...bearer(downloaderToken));
      expect(res.status, JSON.stringify(res.body)).toBe(403);

      const logs = await accessLogs(direct, fileUnregistered);
      const deny = logs.find((l) => l.action === "Download" && l.access_granted === false);
      expect(deny, "expected a denied Download access-log row").toBeDefined();
      expect(deny!.denied_reason).toBe("deny-no-resolver");
      // Proof the FOUNDATION.FILE.* fallback was NOT reached: no granted Download row for this file.
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

    // ── (b2) H1 multi-link — REAL contract (would-allow) + 1 unregistered → 403 deny-no-resolver ──
    it("(b2) multi-link file (REAL contract link + 1 unregistered link) + in-scope viewer → GET /:id/download-url → 403 deny-no-resolver", async () => {
      const res = await api(app)
        .get(`/foundation/files/${fileMultiLink}/download-url`)
        .set(...bearer(inScopeToken));
      // In-scope for the contract link, yet the unregistered LEAVE link forces most-restrictive DENY.
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
