/**
 * S5-BRAND-BE-1 — deny-path CROWN cho /api/v1/foundation/company/branding (logo + favicon).
 *
 * CHỨNG MINH (fail-closed, không rò):
 *   G  GET    /branding            → gate view:foundation-company: 0-grant → 403 (KHÔNG 200 rỗng).
 *   U  POST   /:kind/upload-url    → gate update:foundation-company: chỉ-view → 403 (least-privilege:
 *                                    xem ≠ sửa); MIME ngoài whitelist → 415; size vượt trần → 413.
 *   C  POST   /:kind/confirm       → IDOR: fileId của CÔNG TY KHÁC → 404 (RLS chặn, KHÔNG rò tồn tại);
 *                                    fileId của NGƯỜI KHÁC cùng công ty → 403.
 *   P  PUT    /:kind               → file chưa confirm (Pending) → 409; kind lạ → 400 (KHÔNG 500).
 *   F  GET    /branding fail-soft  → con trỏ logo trỏ file ĐÃ XOÁ → logo:null + HTTP 200 (read tải-trang
 *                                    KHÔNG được vỡ), KHÔNG 500.
 *
 * ANTI-VACUOUS-GREEN (bài học reviewers-pass-real-bugs): mỗi deny assert ĐÚNG status + envelope + mã lỗi,
 * KHÔNG chỉ `!=200`. Ca fail-soft assert 200 + logo===null (phân biệt với 403/500 cùng "không thấy ảnh").
 *
 * Gate CỨNG `hasDb && LANE_DB` (memory integration-test-lane-db-gate + ci-skips-most-integration-specs):
 * .env trỏ DB dev chung (hasDb=true) ⇒ CHỈ chạy trên DB cô lập lane; thiếu LANE_DB ⇒ SKIP (không xanh-giả).
 *   bash scripts/lane-db-setup.sh brand → export LANE_DB=mediaos_brand → npx vitest run <spec>
 *
 * KHÔNG cần MinIO: mọi ca ở đây dừng TRƯỚC bước ký URL (deny) hoặc đi nhánh fail-soft (presign lỗi → null).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { BRANDING_RULES } from "../../src/foundation/company/branding.constants";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!brand9";
const hasLaneDb = hasDb && !!process.env.LANE_DB;
const FORBIDDEN_CODE = "AUTH-ERR-FORBIDDEN";

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

async function permId(direct: Pool, action: string, resourceType: string): Promise<string> {
  const r = await direct.query(
    "SELECT id FROM permissions WHERE action = $1 AND resource_type = $2 LIMIT 1",
    [action, resourceType],
  );
  if (r.rows.length === 0) throw new Error(`permission missing: ${action}:${resourceType}`);
  return r.rows[0].id as string;
}

async function grant(direct: Pool, roleId: string, action: string, resourceType: string) {
  await seedRolePermission(
    direct,
    roleId,
    await permId(direct, action, resourceType),
    "ALLOW",
    "Company",
  );
}

/** Chèn 1 row `files` trực tiếp (bỏ qua flow presign — ta chỉ cần trạng thái để test guard). */
async function insertFile(
  direct: Pool,
  companyId: string,
  ownerId: string,
  opts: { mime?: string; uploadStatus?: string; deleted?: boolean } = {},
): Promise<string> {
  const fileId = randomUUID();
  await direct.query(
    `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
       storage_provider, storage_path, visibility, upload_status, scan_status, owner_user_id, uploaded_by,
       deleted_at)
     VALUES ($1,$2,'logo.png',$3,$4,10,'MinIO',$5,'Private',$6,'NotRequired',$7,$7,$8)`,
    [
      fileId,
      companyId,
      `${fileId}-logo.png`,
      opts.mime ?? "image/png",
      `${companyId}/files/${fileId}`,
      opts.uploadStatus ?? "Uploaded",
      ownerId,
      opts.deleted ? new Date() : null,
    ],
  );
  return fileId;
}

function expectForbidden(res: request.Response, ctx: string): void {
  expect(res.status, `${ctx} status`).toBe(403);
  expect(res.body?.success, `${ctx} success=false`).toBe(false);
  expect(res.body?.data, `${ctx} data=null`).toBeNull();
  expect(res.body?.error?.code, `${ctx} error.code`).toBe(FORBIDDEN_CODE);
}

const UPLOAD_BODY = {
  originalName: "logo.png",
  declaredMimeType: "image/png",
  sizeBytes: 1024,
};

describe.skipIf(!hasLaneDb)("S5-BRAND-BE-1 branding deny-path (logo · favicon)", () => {
  const direct = directPool();
  const app = appPool();
  let nest: INestApplication;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  const email = { noRole: "", viewOnly: "", admin: "", other: "", tenantB: "" };
  let tokenNoRole = "";
  let tokenViewOnly = "";
  let tokenAdmin = "";
  let adminUserId = "";
  let otherUserId = "";
  let tenantBUserId = "";

  beforeAll(async () => {
    const hash = await hashedPw();
    A = await seedCompany(direct, "brandA");
    B = await seedCompany(direct, "brandB");
    companyIds.push(A.companyId, B.companyId);

    // view-only: có view:foundation-company nhưng KHÔNG update ⇒ least-privilege (xem ≠ sửa).
    const roleViewOnly = await seedRole(direct, A.companyId, "brand-view-only");
    await grant(direct, roleViewOnly, "view", "foundation-company");

    // admin: view + update ⇒ chạy được toàn flow.
    const roleAdmin = await seedRole(direct, A.companyId, "brand-admin");
    await grant(direct, roleAdmin, "view", "foundation-company");
    await grant(direct, roleAdmin, "update", "foundation-company");

    email.noRole = `norole@${A.slug}.test`;
    email.viewOnly = `viewonly@${A.slug}.test`;
    email.admin = `admin@${A.slug}.test`;
    email.other = `other@${A.slug}.test`;
    email.tenantB = `admin@${B.slug}.test`;

    await seedUser(direct, A.companyId, email.noRole, hash); // 0 grant — fail-closed
    const uViewOnly = await seedUser(direct, A.companyId, email.viewOnly, hash);
    const uAdmin = await seedUser(direct, A.companyId, email.admin, hash);
    const uOther = await seedUser(direct, A.companyId, email.other, hash);
    const uTenantB = await seedUser(direct, B.companyId, email.tenantB, hash);
    adminUserId = uAdmin;
    otherUserId = uOther;
    tenantBUserId = uTenantB;

    await seedUserRole(direct, uViewOnly, roleViewOnly, A.companyId);
    await seedUserRole(direct, uAdmin, roleAdmin, A.companyId);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = moduleRef.createNestApplication();
    nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    nest.useGlobalFilters(new AllExceptionsFilter());
    await nest.init();

    tokenNoRole = await login(nest, A.slug, email.noRole);
    tokenViewOnly = await login(nest, A.slug, email.viewOnly);
    tokenAdmin = await login(nest, A.slug, email.admin);
  });

  afterAll(async () => {
    await nest?.close();
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.end();
  });

  // ── G — READ gate ───────────────────────────────────────────────────────────

  it("GET /branding — 0 grant → 403 fail-closed (KHÔNG 200 rỗng)", async () => {
    const res = await api(nest).get("/foundation/company/branding").set(bearer(tokenNoRole));
    expectForbidden(res, "GET branding no-role");
  });

  it("GET /branding — có view:foundation-company → 200 {logo:null, favicon:null} khi chưa đặt", async () => {
    const res = await api(nest).get("/foundation/company/branding").set(bearer(tokenViewOnly));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ logo: null, favicon: null });
  });

  // ── U — WRITE gate (least-privilege) ────────────────────────────────────────

  it.each(["logo", "favicon"])(
    "POST /%s/upload-url — chỉ có view (thiếu update) → 403 (xem ≠ sửa)",
    async (kind) => {
      const res = await api(nest)
        .post(`/foundation/company/branding/${kind}/upload-url`)
        .set(bearer(tokenViewOnly))
        .send(UPLOAD_BODY);
      expectForbidden(res, `upload-url ${kind} view-only`);
    },
  );

  it.each(["logo", "favicon"])("DELETE /%s — chỉ có view → 403", async (kind) => {
    const res = await api(nest)
      .delete(`/foundation/company/branding/${kind}`)
      .set(bearer(tokenViewOnly));
    expectForbidden(res, `delete ${kind} view-only`);
  });

  // ── U — validate MIME / size theo kind ──────────────────────────────────────

  it("POST /logo/upload-url — MIME ngoài whitelist (application/pdf) → 415", async () => {
    const res = await api(nest)
      .post("/foundation/company/branding/logo/upload-url")
      .set(bearer(tokenAdmin))
      .send({ ...UPLOAD_BODY, originalName: "x.pdf", declaredMimeType: "application/pdf" });
    expect(res.status).toBe(415);
    expect(res.body?.error?.code).toBe("FOUNDATION-FILE-ERR-MIME");
  });

  it("POST /logo/upload-url — SVG bị từ chối (chống stored-XSS) → 415", async () => {
    const res = await api(nest)
      .post("/foundation/company/branding/logo/upload-url")
      .set(bearer(tokenAdmin))
      .send({ ...UPLOAD_BODY, originalName: "x.svg", declaredMimeType: "image/svg+xml" });
    expect(res.status).toBe(415);
  });

  it("POST /favicon/upload-url — vượt trần 512KB → 413", async () => {
    const res = await api(nest)
      .post("/foundation/company/branding/favicon/upload-url")
      .set(bearer(tokenAdmin))
      .send({
        originalName: "fav.png",
        declaredMimeType: "image/png",
        sizeBytes: BRANDING_RULES.favicon.maxBytes + 1,
      });
    expect(res.status).toBe(413);
    expect(res.body?.error?.code).toBe("FOUNDATION-FILE-ERR-SIZE");
  });

  // ── C/P — IDOR + state ──────────────────────────────────────────────────────

  it("PUT /logo — fileId của CÔNG TY KHÁC → 404 (RLS chặn, KHÔNG rò tồn tại)", async () => {
    const foreignFileId = await insertFile(direct, B.companyId, tenantBUserId);
    const res = await api(nest)
      .put("/foundation/company/branding/logo")
      .set(bearer(tokenAdmin))
      .send({ fileId: foreignFileId });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  it("PUT /logo — fileId của NGƯỜI KHÁC cùng công ty → 403 (IDOR)", async () => {
    const othersFileId = await insertFile(direct, A.companyId, otherUserId);
    const res = await api(nest)
      .put("/foundation/company/branding/logo")
      .set(bearer(tokenAdmin))
      .send({ fileId: othersFileId });
    expectForbidden(res, "PUT logo file người khác");
  });

  it("PUT /logo — file chưa confirm (Pending) → 409", async () => {
    const pendingId = await insertFile(direct, A.companyId, adminUserId, {
      uploadStatus: "Pending",
    });
    const res = await api(nest)
      .put("/foundation/company/branding/logo")
      .set(bearer(tokenAdmin))
      .send({ fileId: pendingId });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
  });

  it("PUT /logo — file có MIME không phải ảnh → 415 (MIME THẬT trên row, không tin client)", async () => {
    const pdfId = await insertFile(direct, A.companyId, adminUserId, { mime: "application/pdf" });
    const res = await api(nest)
      .put("/foundation/company/branding/logo")
      .set(bearer(tokenAdmin))
      .send({ fileId: pdfId });
    expect(res.status).toBe(415);
  });

  it("PUT /:kind — kind lạ → 400 (KHÔNG 500 do index BRANDING_RULES undefined)", async () => {
    const anyFileId = await insertFile(direct, A.companyId, adminUserId);
    const res = await api(nest)
      .put("/foundation/company/branding/banner")
      .set(bearer(tokenAdmin))
      .send({ fileId: anyFileId });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  // ── F — fail-soft đường đọc ─────────────────────────────────────────────────

  it("GET /branding — con trỏ logo trỏ file ĐÃ XOÁ → 200 + logo:null (KHÔNG 500, trang không vỡ)", async () => {
    const deadFileId = await insertFile(direct, A.companyId, adminUserId, { deleted: true });
    await direct.query("UPDATE companies SET logo_url = $1 WHERE id = $2", [
      deadFileId,
      A.companyId,
    ]);

    const res = await api(nest).get("/foundation/company/branding").set(bearer(tokenAdmin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.logo).toBeNull();
  });

  it("GET /branding — logo_url là URL cũ nhập tay → source='external', KHÔNG presign (tương thích ngược)", async () => {
    await direct.query("UPDATE companies SET logo_url = $1 WHERE id = $2", [
      "https://cdn.cu/logo.png",
      A.companyId,
    ]);

    const res = await api(nest).get("/foundation/company/branding").set(bearer(tokenAdmin));
    expect(res.status).toBe(200);
    expect(res.body.data.logo).toEqual({
      source: "external",
      fileId: null,
      url: "https://cdn.cu/logo.png",
      expiresAt: null,
    });
  });
});
