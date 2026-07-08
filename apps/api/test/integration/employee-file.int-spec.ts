/**
 * S2-HR-EMPFILE-1 — Employee File (hồ sơ đính kèm nhân viên) integration (CROWN-JEWEL: permission +
 * data-scope IDOR + tenant isolation + scan_status guard + soft-delete + append-only access log). Real
 * NestJS app (AppModule) + supertest → full guard chain (JwtAuthGuard → CompanyGuard → 2FA →
 * PermissionGuard → EmployeeFileController → EmployeeFileService → FileService/EmployeeFileResolver) with
 * the REAL permission engine. No mocks. Routes: /hr/employees/:id/files (API-03 HR-API-801..805).
 *
 * done_when (RED-first):
 *   QA-05 deny: user KHÔNG có file-view/file-upload/file-delete:employee (manager/employee/noPerm) →
 *     GET/POST/DELETE → 403 (PermissionGuard fail-closed).
 *   IDOR cross-tenant: file/employee của công ty B → user công ty A → GET list/metadata/download/DELETE →
 *     404 (RLS 0-row + isEmployeeInScope false; KHÔNG lộ tồn tại).
 *   IDOR cross-employee: fileId link vào employee X, gọi qua /hr/employees/{Y}/files/{fileId} → 404.
 *   scan_status: scanStatus∈{Pending,Infected} → GET :fileId/download → 409 NOT_DOWNLOADABLE, KHÔNG URL;
 *     scanStatus∈{Clean,NotRequired} → 302 + Location URL.
 *   soft-delete: DELETE :fileId → GET list KHÔNG còn file; files row CÒN (deleted_at set) — no hard-delete.
 *   append-only: DELETE/Download ghi file_access_logs; app role UPDATE/DELETE trên file_access_logs bị chặn.
 *   happy hr Company: POST link fileId đã upload+confirm → 201 + audit 'file_link'/FileLinked; GET list thấy;
 *     GET download (Clean) → 302 URL; DELETE → 204 + rời list.
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): .env trỏ DATABASE_URL vào DB dev chung
 * (hasDb=true) → chạy CHỈ trên lane DB cô lập, else false-red.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { appPool, directPool, hasDb, withClient } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!test99";
const hasLaneDb = hasDb && !!process.env.LANE_DB;

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const FILE_VIEW: Array<[string, string]> = [["file-view", "employee"]];
const FILE_ALL: Array<[string, string]> = [
  ["file-view", "employee"],
  ["file-upload", "employee"],
  ["file-delete", "employee"],
];

/** Grant a fresh company-scoped role carrying the given file-* pairs to `userId` at `scope`. */
async function grant(
  direct: Pool,
  companyId: string,
  userId: string,
  pairs: Array<[string, string]>,
  scope: "Own" | "Team" | "Department" | "Company" | "System" = "Company",
): Promise<void> {
  const roleId = await seedRole(
    direct,
    companyId,
    `qa-empfile-${scope.toLowerCase()}-${userId.slice(0, 8)}`,
  );
  for (const [action, resourceType] of pairs) {
    const permId = await seedPermissionCatalog(direct, action, resourceType, false);
    await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
  }
  await seedUserRole(direct, userId, roleId, companyId);
}

async function seedEmployeeProfile(direct: Pool, companyId: string): Promise<string> {
  const u = await seedUser(direct, companyId, `emp-${randomUUID().slice(0, 8)}@x.test`);
  const r = await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
    [companyId, u],
  );
  return r.rows[0].id as string;
}

/** Seed a `files` row (Uploaded by default). storage_path = {companyId}/files/{fileId} (tenant prefix). */
async function seedFile(
  direct: Pool,
  companyId: string,
  uploadedBy: string,
  opts?: { scanStatus?: string; uploadStatus?: string },
): Promise<string> {
  const fileId = randomUUID();
  const storagePath = `${companyId}/files/${fileId}`;
  await direct.query(
    `INSERT INTO files
       (id, company_id, original_name, stored_name, mime_type, file_size_bytes, storage_provider,
        storage_path, upload_status, scan_status, uploaded_by)
     VALUES ($1, $2, 'ho-so.pdf', $3, 'application/pdf', 2048, 'MinIO', $4, $5, $6, $7)`,
    [
      fileId,
      companyId,
      fileId,
      storagePath,
      opts?.uploadStatus ?? "Uploaded",
      opts?.scanStatus ?? "Clean",
      uploadedBy,
    ],
  );
  return fileId;
}

/** Seed a file_links row (module HR / entity employee_profile). Returns linkId. */
async function seedFileLink(
  direct: Pool,
  companyId: string,
  fileId: string,
  employeeId: string,
  createdBy: string,
  category: string | null = null,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO file_links
       (company_id, file_id, module_code, entity_type, entity_id, link_type, access_scope, is_primary,
        purpose, created_by)
     VALUES ($1, $2, 'HR', 'employee_profile', $3, 'Document', 'Company', false, $4, $5) RETURNING id`,
    [companyId, fileId, employeeId, category, createdBy],
  );
  return r.rows[0].id as string;
}

async function rawFile(
  direct: Pool,
  fileId: string,
): Promise<{ uploadStatus: string; deletedAt: Date | null } | undefined> {
  const r = await direct.query(
    `SELECT upload_status AS "uploadStatus", deleted_at AS "deletedAt" FROM files WHERE id = $1`,
    [fileId],
  );
  return r.rows[0];
}

async function countAccessLogs(direct: Pool, fileId: string, action: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM file_access_logs WHERE file_id = $1 AND action = $2`,
    [fileId, action],
  );
  return r.rows[0].n as number;
}

describe.skipIf(!hasLaneDb)("S2-HR-EMPFILE-1 employee files (HTTP, real permission engine)", () => {
  const direct = directPool();
  const app = appPool();
  let nest: INestApplication;

  let A: SeededTenant;
  let B: SeededTenant;
  let hrEmail = "";
  let hrUserId = "";
  let managerEmail = ""; // file-view @ Company but NO upload/delete → 403 on POST/DELETE
  let noPermEmail = ""; // no grant at all → 403 everywhere
  let empA = ""; // employee_profile in A (target for HR happy-path)
  let empA2 = ""; // second employee_profile in A (cross-employee IDOR target)
  let empB = ""; // employee_profile in B (cross-tenant IDOR target)

  let cleanFileA = ""; // file in A linked to empA, scan Clean — download OK
  let cleanLinkA = "";
  let pendingFileA = ""; // file in A linked to empA, scan Pending — download 409
  let infectedFileA = ""; // file in A linked to empA, scan Infected — download 409
  let unlinkedCleanFileA = ""; // file in A (Uploaded/Clean) NOT yet linked — for POST link happy-path
  let fileB = ""; // file in B linked to empB — cross-tenant
  let bUserId = "";

  beforeAll(async () => {
    const hash = await hashedPw();
    A = await seedCompany(direct, "empfileA");
    B = await seedCompany(direct, "empfileB");

    hrEmail = `hr@${A.slug}.test`;
    hrUserId = await seedUser(direct, A.companyId, hrEmail, hash);
    await grant(direct, A.companyId, hrUserId, FILE_ALL, "Company");

    managerEmail = `mgr@${A.slug}.test`;
    const mgrUserId = await seedUser(direct, A.companyId, managerEmail, hash);
    await grant(direct, A.companyId, mgrUserId, FILE_VIEW, "Company"); // view only, no upload/delete

    noPermEmail = `noperm@${A.slug}.test`;
    await seedUser(direct, A.companyId, noPermEmail, hash);

    empA = await seedEmployeeProfile(direct, A.companyId);
    empA2 = await seedEmployeeProfile(direct, A.companyId);

    cleanFileA = await seedFile(direct, A.companyId, hrUserId, { scanStatus: "Clean" });
    cleanLinkA = await seedFileLink(direct, A.companyId, cleanFileA, empA, hrUserId, "CCCD");

    pendingFileA = await seedFile(direct, A.companyId, hrUserId, { scanStatus: "Pending" });
    await seedFileLink(direct, A.companyId, pendingFileA, empA, hrUserId);

    infectedFileA = await seedFile(direct, A.companyId, hrUserId, { scanStatus: "Infected" });
    await seedFileLink(direct, A.companyId, infectedFileA, empA, hrUserId);

    unlinkedCleanFileA = await seedFile(direct, A.companyId, hrUserId, { scanStatus: "Clean" });

    empB = await seedEmployeeProfile(direct, B.companyId);
    bUserId = await seedUser(direct, B.companyId, `bhr@${B.slug}.test`, hash);
    fileB = await seedFile(direct, B.companyId, bUserId, { scanStatus: "Clean" });
    await seedFileLink(direct, B.companyId, fileB, empB, bUserId, "B-SECRET-CATEGORY");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = moduleRef.createNestApplication();
    nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    nest.useGlobalFilters(new AllExceptionsFilter());
    await nest.init();
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
    if (nest) await nest.close();
  });

  // ── QA-05 deny-path (PermissionGuard fail-closed) ──────────────────────────────────────────────

  it("deny: noPerm (no file-* grant) → GET/POST/DELETE → 403", async () => {
    const token = await login(nest, A.slug, noPermEmail);
    const list = await api(nest).get(`/hr/employees/${empA}/files`).set(bearer(token));
    expect(list.status).toBe(403);
    const post = await api(nest)
      .post(`/hr/employees/${empA}/files`)
      .set(bearer(token))
      .send({ fileId: unlinkedCleanFileA });
    expect(post.status).toBe(403);
    const del = await api(nest)
      .delete(`/hr/employees/${empA}/files/${cleanFileA}`)
      .set(bearer(token));
    expect(del.status).toBe(403);
  });

  it("deny: manager (file-view only, NO file-upload/file-delete) → POST/DELETE → 403; GET → 200", async () => {
    const token = await login(nest, A.slug, managerEmail);
    const post = await api(nest)
      .post(`/hr/employees/${empA}/files`)
      .set(bearer(token))
      .send({ fileId: unlinkedCleanFileA });
    expect(post.status).toBe(403);
    const del = await api(nest)
      .delete(`/hr/employees/${empA}/files/${cleanFileA}`)
      .set(bearer(token));
    expect(del.status).toBe(403);
    const list = await api(nest).get(`/hr/employees/${empA}/files`).set(bearer(token));
    expect(list.status).toBe(200);
  });

  // ── IDOR cross-tenant (404, no leak) ───────────────────────────────────────────────────────────

  it("IDOR cross-tenant: hr(A) on employee(B) list/metadata/download/DELETE → 404 (no leak)", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const list = await api(nest).get(`/hr/employees/${empB}/files`).set(bearer(token));
    expect(list.status).toBe(404);
    const meta = await api(nest).get(`/hr/employees/${empB}/files/${fileB}`).set(bearer(token));
    expect(meta.status).toBe(404);
    const dl = await api(nest)
      .get(`/hr/employees/${empB}/files/${fileB}/download`)
      .set(bearer(token));
    expect(dl.status).toBe(404);
    const del = await api(nest).delete(`/hr/employees/${empB}/files/${fileB}`).set(bearer(token));
    expect(del.status).toBe(404);
  });

  // ── IDOR cross-employee (file not owned by :id → 404) ──────────────────────────────────────────

  it("IDOR cross-employee: fileId of empA queried under empA2 → 404 (metadata/download/DELETE)", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const meta = await api(nest)
      .get(`/hr/employees/${empA2}/files/${cleanFileA}`)
      .set(bearer(token));
    expect(meta.status).toBe(404);
    const dl = await api(nest)
      .get(`/hr/employees/${empA2}/files/${cleanFileA}/download`)
      .set(bearer(token));
    expect(dl.status).toBe(404);
    const del = await api(nest)
      .delete(`/hr/employees/${empA2}/files/${cleanFileA}`)
      .set(bearer(token));
    expect(del.status).toBe(404);
  });

  // ── scan_status guard (409 unless Clean/NotRequired) ───────────────────────────────────────────

  it("scan Pending → download → 409 NOT_DOWNLOADABLE (no URL)", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest)
      .get(`/hr/employees/${empA}/files/${pendingFileA}/download`)
      .set(bearer(token));
    expect(res.status).toBe(409);
    expect(res.headers.location).toBeUndefined();
    expect(JSON.stringify(res.body)).toContain("NOT-DOWNLOADABLE");
  });

  it("scan Infected → download → 409 NOT_DOWNLOADABLE (no URL)", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest)
      .get(`/hr/employees/${empA}/files/${infectedFileA}/download`)
      .set(bearer(token));
    expect(res.status).toBe(409);
    expect(res.headers.location).toBeUndefined();
  });

  it("scan Clean → download → 302 + Location URL (short-lived signed url)", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest)
      .get(`/hr/employees/${empA}/files/${cleanFileA}/download`)
      .set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(302);
    expect(typeof res.headers.location).toBe("string");
    expect(res.headers.location).not.toContain("storage_path");
    // access log Download row written (grant).
    expect(await countAccessLogs(direct, cleanFileA, "Download")).toBeGreaterThanOrEqual(1);
  });

  // ── happy-path list / metadata / link ──────────────────────────────────────────────────────────

  it("hr list → 200, sees empA's linked file (linkId+category), NOT storage internals", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest).get(`/hr/employees/${empA}/files`).set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const files = res.body.data as Array<Record<string, unknown>>;
    const found = files.find((f) => f.fileId === cleanFileA);
    expect(found, "clean file must be in the list").toBeDefined();
    expect(found?.linkId).toBe(cleanLinkA);
    expect(found?.category).toBe("CCCD");
    const blob = JSON.stringify(found).toLowerCase();
    expect(blob).not.toContain("storage_path");
    expect(blob).not.toContain("storagepath");
    expect(blob).not.toContain("checksum");
    expect(blob).not.toContain("stored_name");
  });

  it("hr metadata GET :fileId (own employee) → 200; scanStatus/uploadStatus surfaced", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest).get(`/hr/employees/${empA}/files/${cleanFileA}`).set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.fileId).toBe(cleanFileA);
    expect(res.body.data.scanStatus).toBe("Clean");
    expect(res.body.data.uploadStatus).toBe("Uploaded");
  });

  it("hr POST link (fileId đã upload+confirm) → 201 + audit 'file_link'/FileLinked; then in list", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest)
      .post(`/hr/employees/${empA}/files`)
      .set(bearer(token))
      .send({ fileId: unlinkedCleanFileA, category: "BangCap" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.fileId).toBe(unlinkedCleanFileA);
    expect(res.body.data.category).toBe("BangCap");

    const auditRow = await direct.query(
      `SELECT action, object_type FROM audit_logs
        WHERE company_id = $1 AND object_type = 'file_link' AND action = 'FileLinked'
        ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    expect(auditRow.rows.length).toBe(1);

    const list = await api(nest).get(`/hr/employees/${empA}/files`).set(bearer(token));
    const ids = (list.body.data as Array<{ fileId: string }>).map((f) => f.fileId);
    expect(ids).toContain(unlinkedCleanFileA);
  });

  // ── soft-delete (BẤT BIẾN #2) + append-only access log (QA-06) ─────────────────────────────────

  it("hr DELETE :fileId → 204 SOFT-delete (file row stays, deleted_at set) + leaves list", async () => {
    const token = await login(nest, A.slug, hrEmail);
    // link a fresh file to delete (so we don't disturb the download fixtures).
    const victim = await seedFile(direct, A.companyId, hrUserId, { scanStatus: "Clean" });
    await seedFileLink(direct, A.companyId, victim, empA, hrUserId);

    const del = await api(nest).delete(`/hr/employees/${empA}/files/${victim}`).set(bearer(token));
    expect(del.status, JSON.stringify(del.body)).toBe(204);

    // SOFT-delete: file row still present with deleted_at set (no hard-delete).
    const raw = await rawFile(direct, victim);
    expect(raw).toBeDefined();
    expect(raw?.deletedAt).not.toBeNull();
    // access log Delete row written.
    expect(await countAccessLogs(direct, victim, "Delete")).toBeGreaterThanOrEqual(1);

    // gone from list (files.deleted_at filtered).
    const list = await api(nest).get(`/hr/employees/${empA}/files`).set(bearer(token));
    const ids = (list.body.data as Array<{ fileId: string }>).map((f) => f.fileId);
    expect(ids).not.toContain(victim);
  });

  it("append-only (QA-06): mediaos_app UPDATE/DELETE of a file_access_logs row is DENIED", async () => {
    const row = await direct.query(
      `SELECT id FROM file_access_logs WHERE company_id = $1 LIMIT 1`,
      [A.companyId],
    );
    const logId = row.rows[0].id as string;
    await withClient(app, async (c) => {
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
      await expect(
        c.query(`UPDATE file_access_logs SET action = 'TAMPER' WHERE id = $1`, [logId]),
      ).rejects.toThrow(/permission denied/);
      await expect(c.query(`DELETE FROM file_access_logs WHERE id = $1`, [logId])).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});
