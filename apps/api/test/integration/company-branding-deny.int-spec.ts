/**
 * S5-BRAND-BE-1 — deny-path CROWN cho /api/v1/foundation/company/branding (logo + favicon).
 *
 * CHỨNG MINH (fail-closed, không rò):
 *   G  GET    /branding            → AUTHENTICATED-ONLY (S5-BRAND-FE-2): 0-grant → 200; không token → 401.
 *                                    (Trước là gate view:foundation-company — đổi vì cặp đó chỉ company-admin
 *                                    có ⇒ logo vỏ app + favicon động sẽ chết với mọi nhân viên khác.)
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
 * CẦN MinIO (docker compose): các ca HAPPY-PATH (H) ký URL thật. Bản ĐẦU của spec này cố ý "không cần
 * MinIO — mọi ca dừng trước bước ký URL", và chính vì thế nó XANH GIẢ trong khi tính năng chết hoàn toàn
 * (thiếu FileOwnerPermissionResolver ⇒ files.link 403 + GET luôn null). Bài học `reviewers-pass-real-bugs`:
 * deny-path một mình KHÔNG chứng minh được cổng phân quyền hoạt động — phải có ít nhất một đường đi trọn vẹn.
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

  const email = { noRole: "", viewOnly: "", admin: "", other: "", tenantB: "", fileOnly: "" };
  let tokenNoRole = "";
  let tokenTenantB = "";
  let tokenFileOnly = "";
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

    // Role CHỈ có *:foundation-file, 0 grant foundation-company — dùng để ĐO phạm vi thực sự nới ra
    // sau khi resolver READ bỏ cặp quyền (security-review vòng 2, MEDIUM).
    const roleFileOnly = await seedRole(direct, A.companyId, "brand-file-only");
    await grant(direct, roleFileOnly, "view", "foundation-file");
    await grant(direct, roleFileOnly, "download", "foundation-file");

    email.noRole = `norole@${A.slug}.test`;
    email.fileOnly = `fileonly@${A.slug}.test`;
    email.viewOnly = `viewonly@${A.slug}.test`;
    email.admin = `admin@${A.slug}.test`;
    email.other = `other@${A.slug}.test`;
    email.tenantB = `admin@${B.slug}.test`;

    await seedUser(direct, A.companyId, email.noRole, hash); // 0 grant — fail-closed
    const uViewOnly = await seedUser(direct, A.companyId, email.viewOnly, hash);
    const uAdmin = await seedUser(direct, A.companyId, email.admin, hash);
    const uOther = await seedUser(direct, A.companyId, email.other, hash);
    const uFileOnly = await seedUser(direct, A.companyId, email.fileOnly, hash);
    const uTenantB = await seedUser(direct, B.companyId, email.tenantB, hash);
    adminUserId = uAdmin;
    otherUserId = uOther;
    tenantBUserId = uTenantB;

    await seedUserRole(direct, uViewOnly, roleViewOnly, A.companyId);
    await seedUserRole(direct, uFileOnly, roleFileOnly, A.companyId);
    await seedUserRole(direct, uAdmin, roleAdmin, A.companyId);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = moduleRef.createNestApplication();
    nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    nest.useGlobalFilters(new AllExceptionsFilter());
    await nest.init();

    tokenNoRole = await login(nest, A.slug, email.noRole);
    tokenTenantB = await login(nest, B.slug, email.tenantB);
    tokenFileOnly = await login(nest, A.slug, email.fileOnly);
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

  // S5-BRAND-FE-2 (owner chốt) — GET ĐỔI TỪ gated SANG authenticated-only. Lý do: `view:foundation-company`
  // DB thật chỉ cấp company-admin ⇒ gate ở đây làm logo trên vỏ app + favicon động chỉ chạy cho ~1
  // người/công ty. Logo/favicon là tài sản thương hiệu công khai. MỌI đường GHI VẪN gate (test bên dưới).
  it("GET /branding — user 0 grant VẪN đọc được (authenticated-only, không cặp quyền)", async () => {
    const res = await api(nest).get("/foundation/company/branding").set(bearer(tokenNoRole));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Assert GIÁ TRỊ, không chỉ toHaveProperty: `toHaveProperty("logo")` xanh cả khi logo=null nên
    // không phân biệt được "đọc được" với "bị chặn rồi fail-soft" (security-review vòng 2).
    expect(res.body.data).toEqual({ logo: null, favicon: null });
  });

  it("GET /branding — KHÔNG token → 401 (vẫn phải đăng nhập)", async () => {
    const res = await api(nest).get("/foundation/company/branding");
    expect(res.status).toBe(401);
  });

  // GIỮ ca này nhưng ĐỔI Ý NGHĨA: sau khi GET thành authenticated-only, `tokenViewOnly` và `tokenNoRole`
  // đi CÙNG một đường ⇒ nó không còn chứng minh gì về cổng quyền. Giá trị còn lại: chốt rằng có thêm
  // cặp view cũng KHÔNG làm đổi kết quả (không có nhánh đặc biệt nào cho company-admin).
  it("GET /branding — có view:foundation-company cho kết quả GIỐNG HỆT user 0-grant", async () => {
    const withView = await api(nest).get("/foundation/company/branding").set(bearer(tokenViewOnly));
    const without = await api(nest).get("/foundation/company/branding").set(bearer(tokenNoRole));
    expect(withView.status).toBe(200);
    expect(withView.body.data).toEqual(without.body.data);
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

  // ── H — HAPPY-PATH (security-review BLOCK #1) ───────────────────────────────
  //
  // Đây là test DUY NHẤT bắt được lỗi thiếu FileOwnerPermissionResolver: bản đầu chỉ có deny-path nên
  // mọi ca dừng TRƯỚC bước link/ký URL ⇒ xanh giả trong khi tính năng chết hoàn toàn. Role ở đây CHỈ có
  // view/update:foundation-company (KHÔNG có bất kỳ quyền *:foundation-file nào) — đúng mô hình quyền WO
  // tuyên bố. Nếu resolver không đăng ký: `files.link` 403 (fail-closed deny-no-resolver) ⇒ test ĐỎ.

  it("PUT /logo rồi GET → 200 source='file' với role CHỈ có view+update:foundation-company", async () => {
    const fileId = await insertFile(direct, A.companyId, adminUserId);

    const put = await api(nest)
      .put("/foundation/company/branding/logo")
      .set(bearer(tokenAdmin))
      .send({ fileId });
    expect(put.status, `PUT logo: ${JSON.stringify(put.body)}`).toBe(200);
    expect(put.body.data).toMatchObject({ source: "file", fileId });

    const get = await api(nest).get("/foundation/company/branding").set(bearer(tokenAdmin));
    expect(get.status).toBe(200);
    expect(get.body.data.logo).toMatchObject({ source: "file", fileId });
    expect(typeof get.body.data.logo.url).toBe("string");

    // con trỏ ĐÃ ghi vào companies.logo_url (không phải chỉ có link)
    const row = await direct.query("SELECT logo_url FROM companies WHERE id = $1", [A.companyId]);
    expect(row.rows[0].logo_url).toBe(fileId);
  });

  it("user 0 grant cũng đọc được logo đã đặt (resolver READ = tenant-check, cho toàn công ty)", async () => {
    const fileId = await insertFile(direct, A.companyId, adminUserId);
    await api(nest)
      .put("/foundation/company/branding/logo")
      .set(bearer(tokenAdmin))
      .send({ fileId })
      .expect(200);

    const get = await api(nest).get("/foundation/company/branding").set(bearer(tokenNoRole));
    expect(get.status).toBe(200);
    expect(get.body.data.logo).toMatchObject({ source: "file", fileId });
  });

  it("DELETE /logo sau khi đặt → 204, GET trả logo:null, con trỏ được xoá", async () => {
    const fileId = await insertFile(direct, A.companyId, adminUserId);
    await api(nest)
      .put("/foundation/company/branding/logo")
      .set(bearer(tokenAdmin))
      .send({ fileId })
      .expect(200);

    await api(nest).delete("/foundation/company/branding/logo").set(bearer(tokenAdmin)).expect(204);

    const get = await api(nest).get("/foundation/company/branding").set(bearer(tokenAdmin));
    expect(get.body.data.logo).toBeNull();
    const row = await direct.query("SELECT logo_url FROM companies WHERE id = $1", [A.companyId]);
    expect(row.rows[0].logo_url).toBeNull();
  });

  // ── K — CROSS-TENANT trên mô hình quyền MỚI (security-review vòng 2, HIGH) ──
  //
  // Sau khi resolver READ bỏ cặp quyền, TOÀN BỘ ranh giới tenant của đường đọc nằm trên đúng một biểu
  // thức `input.entityId === input.companyId`. Trước đó spec này seed tenant B nhưng CHƯA BAO GIỜ login
  // bằng nó ⇒ không ca nào chứng minh wiring cấp `companyId` từ JWT. Hồi quy sẽ lọt mà 22/22 vẫn xanh.

  it("tenant B KHÔNG thấy logo của tenant A (ranh giới tenant của đường đọc mới)", async () => {
    const fileId = await insertFile(direct, A.companyId, adminUserId);
    await api(nest)
      .put("/foundation/company/branding/logo")
      .set(bearer(tokenAdmin))
      .send({ fileId })
      .expect(200);

    const res = await api(nest).get("/foundation/company/branding").set(bearer(tokenTenantB));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.logo, "logo tenant A KHÔNG được lộ sang tenant B").toBeNull();
  });

  it("tenant B KHÔNG presign được fileId branding của tenant A qua /files/:id/download-url", async () => {
    const fileId = await insertFile(direct, A.companyId, adminUserId);
    await api(nest)
      .put("/foundation/company/branding/logo")
      .set(bearer(tokenAdmin))
      .send({ fileId })
      .expect(200);

    const res = await api(nest)
      .get(`/foundation/files/${fileId}/download-url`)
      .set(bearer(tokenTenantB));
    expect([403, 404], `cross-tenant phải bị chặn, nhận ${res.status}`).toContain(res.status);
  });

  // ── L — ĐO phạm vi nới thực tế (security-review vòng 2, MEDIUM) ─────────────

  it("ĐO phạm vi nới: role chỉ có *:foundation-file giờ ĐỌC ĐƯỢC file branding (trước cần foundation-company)", async () => {
    // GHI NHẬN CÓ CHỦ ĐÍCH, không phải mong muốn. Trước khi resolver READ bỏ cặp quyền, role này bị
    // deny-resolver ở file branding; giờ `canRead` chỉ kiểm tenant nên nó đi qua. Hôm nay blast radius
    // = 0 vì DB thật chỉ SA + company-admin giữ `download:foundation-file`. Test này PIN điều đó lại:
    // nếu ai đó cấp cặp file cho role rộng hơn, họ sẽ thấy ca này và biết nó KÉO THEO quyền đọc branding.
    const fileId = await insertFile(direct, A.companyId, adminUserId);
    await api(nest)
      .put("/foundation/company/branding/logo")
      .set(bearer(tokenAdmin))
      .send({ fileId })
      .expect(200);

    const res = await api(nest)
      .get(`/foundation/files/${fileId}/download-url`)
      .set(bearer(tokenFileOnly));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("nới ở trên KHÔNG mở rộng sang tenant khác (cùng role, file branding của tenant B)", async () => {
    // Chốt rằng phạm vi nới bị chặn bởi ranh giới tenant, không phải chỉ bởi cặp quyền.
    const foreignFileId = await insertFile(direct, B.companyId, tenantBUserId);
    const res = await api(nest)
      .get(`/foundation/files/${foreignFileId}/download-url`)
      .set(bearer(tokenFileOnly));
    expect([403, 404], `cross-tenant phải bị chặn, nhận ${res.status}`).toContain(res.status);
  });

  it("file vừa có link branding VỪA có link module khác → 403 (chốt AND trên mọi link sống)", async () => {
    const fileId = await insertFile(direct, A.companyId, adminUserId);
    await api(nest)
      .put("/foundation/company/branding/logo")
      .set(bearer(tokenAdmin))
      .send({ fileId })
      .expect(200);

    // Gắn THÊM 1 link HR/contract cho cùng file. FilePolicy AND verdict trên MỌI link sống ⇒ resolver HR
    // deny sẽ THẮNG resolver branding allow. Nếu ai đó đổi AND thành OR, ca này đỏ.
    await direct.query(
      `INSERT INTO file_links (company_id, file_id, module_code, entity_type, entity_id, link_type,
         access_scope, is_primary, created_by)
       VALUES ($1,$2,'HR','contract',$3,'Contract','Company',false,$4)`,
      [A.companyId, fileId, A.companyId, adminUserId],
    );

    const res = await api(nest)
      .get(`/foundation/files/${fileId}/download-url`)
      .set(bearer(tokenFileOnly));
    expect(res.status, `AND-across-links phải deny, nhận ${res.status}`).toBe(403);

    // Và GET /branding degrade fail-soft về null (KHÔNG 500, KHÔNG rò).
    const branding = await api(nest)
      .get("/foundation/company/branding")
      .set(bearer(tokenNoRole));
    expect(branding.status).toBe(200);
    expect(branding.body.data.logo).toBeNull();
  });

  // ── I — con trỏ bị ĐẦU ĐỘC (security-review #5) ─────────────────────────────

  it("logo_url bị trỏ tay sang file KHÔNG có link branding → GET trả null (không ký, không rò)", async () => {
    // Mô phỏng đầu độc: file nhạy cảm trong tenant (vd bản scan), KHÔNG hề đi qua PUT /branding.
    const secretFileId = await insertFile(direct, A.companyId, otherUserId);
    await direct.query("UPDATE companies SET logo_url = $1 WHERE id = $2", [
      secretFileId,
      A.companyId,
    ]);

    const get = await api(nest).get("/foundation/company/branding").set(bearer(tokenViewOnly));
    expect(get.status).toBe(200);
    expect(get.body.data.logo, "file không có link branding sống KHÔNG được ký").toBeNull();
  });

  // ── J — công ty suspended KHÔNG được chạm file_links (security-review #3) ────

  it("công ty suspended → PUT 403 và KHÔNG tạo/gỡ link nào", async () => {
    const fileId = await insertFile(direct, A.companyId, adminUserId);
    const before = await direct.query(
      "SELECT count(*)::int AS n FROM file_links WHERE company_id = $1",
      [A.companyId],
    );
    await direct.query("UPDATE companies SET status = 'suspended' WHERE id = $1", [A.companyId]);
    try {
      const res = await api(nest)
        .put("/foundation/company/branding/logo")
        .set(bearer(tokenAdmin))
        .send({ fileId });
      expect(res.status, JSON.stringify(res.body)).toBe(403);

      const after = await direct.query(
        "SELECT count(*)::int AS n FROM file_links WHERE company_id = $1",
        [A.companyId],
      );
      expect(after.rows[0].n, "suspended KHÔNG được ghi nửa vời").toBe(before.rows[0].n);
    } finally {
      await direct.query("UPDATE companies SET status = 'active' WHERE id = $1", [A.companyId]);
    }
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
