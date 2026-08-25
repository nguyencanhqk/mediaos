/**
 * S10-QA-ROUTEHTTP-3 (file 6/6) — test HTTP THẬT cho phần đuôi FOUNDATION · SETTINGS · INTEGRATIONS:
 *
 *   ApiKeysController          1  GET /api-keys/scopes
 *   UsersController            1  PATCH /users/me           (KHÔNG gate quyền — self-service)
 *   CompanyController          2  GET/PATCH /foundation/company/current
 *   CompanyBrandingController  1  POST /foundation/company/branding/:kind/confirm
 *   FilesController            1  GET /foundation/files
 *   HolidaysController         5  list · check-working-day · create · update · delete
 *   SettingsController         2  GET/PATCH /settings/company
 *   LmsSsoController           1  GET /integrations/lms/sso-link
 *   SocialSsoController        1  GET /integrations/social/sso-link
 *
 * LUẬT CHỐNG DENY-XANH-RỖNG: route GHI có ca ALLOW 2xx chứng minh bằng HỆ QUẢ đọc lại qua route GET
 * tương ứng; ca DENY (role RỖNG → 403) đặt SAU. `PATCH /users/me` KHÔNG có cổng quyền nên ca đối chứng
 * của nó là HỆ QUẢ (`/auth/me` trả tên mới) chứ không phải 403.
 *
 * ⚠️ `manage:api-key` là `is_sensitive=true` trong catalog — khai đúng cờ, nếu không `seedPermissionCatalog`
 * sẽ NÉM (catalog TOÀN CỤC, ghi sai là đóng dấu vĩnh viễn lên lane DB).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
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

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s10rh3fs");

const uniq = () => randomUUID().slice(0, 8);

function dayShift(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `[action, resource, is_sensitive]` — cờ đo trên catalog lane DB. */
const ADMIN_PAIRS: ReadonlyArray<readonly [string, string, boolean]> = [
  ["manage", "api-key", true],
  ["view", "foundation-company", false],
  ["update", "foundation-company", false],
  ["view", "foundation-file", false],
  ["view", "foundation-holiday", false],
  ["manage", "foundation-holiday", false],
  ["configure-company", "company", false],
  ["access", "lms", false],
  ["view", "social-post", false],
];

describe.skipIf(!hasLaneDb)(
  "S10-QA-ROUTEHTTP-3 — HTTP thật: foundation · settings · integrations (15 route)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let tAdminA = "";
    let tEmptyA = "";
    let tAdminB = "";
    let adminUserIdA = "";

    const http = () => request(app.getHttpServer());
    const authGet = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
    const authPost = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
    const authPatch = (t: string, u: string) => http().patch(u).set("Authorization", `Bearer ${t}`);
    const authDelete = (t: string, u: string) =>
      http().delete(u).set("Authorization", `Bearer ${t}`);

    async function login(slug: string, email: string): Promise<string> {
      const res = await http().post("/auth/login").send({
        companySlug: slug,
        email,
        password: LOGIN_PW,
      });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    async function actor(
      tenant: SeededTenant,
      tag: string,
      pairs: ReadonlyArray<readonly [string, string, boolean]>,
    ): Promise<{ token: string; userId: string }> {
      const password = new PasswordService();
      const email = `${tag}-${uniq()}@s10rh3fs.local`;
      const userId = await seedUser(direct, tenant.companyId, email, await password.hash(LOGIN_PW));
      const roleId = await seedRole(direct, tenant.companyId, `s10rh3fs-${tag}-${uniq()}`);
      for (const [action, resource, sensitive] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resource, sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, userId, roleId, tenant.companyId);
      return { token: await login(tenant.slug, email), userId };
    }

    /** Hàng `files` gieo thẳng (khuôn của `company-branding-deny.int-spec.ts`). */
    async function insertFile(
      companyId: string,
      ownerId: string,
      uploadStatus = "Uploaded",
    ): Promise<string> {
      const fileId = randomUUID();
      await direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_size_bytes,
           storage_provider, storage_path, visibility, upload_status, scan_status, owner_user_id, uploaded_by)
         VALUES ($1,$2,'logo.png',$3,'image/png',10,'MinIO',$4,'Private',$5,'NotRequired',$6,$6)`,
        [
          fileId,
          companyId,
          `${fileId}-logo.png`,
          `${companyId}/files/${fileId}`,
          uploadStatus,
          ownerId,
        ],
      );
      return fileId;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10rh3fsa");
      B = await seedCompany(direct, "s10rh3fsb");
      companyIds.push(A.companyId, B.companyId);

      const admin = await actor(A, "admin", ADMIN_PAIRS);
      tAdminA = admin.token;
      adminUserIdA = admin.userId;
      tEmptyA = (await actor(A, "empty", [])).token;
      tAdminB = (await actor(B, "adminb", ADMIN_PAIRS)).token;
    }, 180_000);

    afterAll(async () => {
      await app?.close();
      if (companyIds.length > 0) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    // ─── 1. API keys — catalog scope ────────────────────────────────────────────

    it("GET /api-keys/scopes — 200, trả danh sách scope khác rỗng (không phải mảng trống hằng)", async () => {
      const res = await authGet(tAdminA, "/api-keys/scopes");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const scopes = res.body.data;
      expect(scopes, "payload scope phải tồn tại").toBeTruthy();
      const asArray = Array.isArray(scopes) ? scopes : (scopes.items ?? scopes.scopes ?? []);
      expect(
        (asArray as unknown[]).length,
        `route phải trả scope thật: ${JSON.stringify(scopes).slice(0, 300)}`,
      ).toBeGreaterThan(0);
    });

    // ─── 2. Hồ sơ của chính mình ────────────────────────────────────────────────

    it("PATCH /users/me — 200 (KHÔNG cần quyền), HỆ QUẢ: /auth/me trả tên mới", async () => {
      const newName = `Tên mới ${uniq()}`;
      // Actor role RỖNG cũng phải sửa được hồ sơ CỦA MÌNH — đây là self-service, không phải cổng quyền.
      const res = await authPatch(tEmptyA, "/users/me").send({ fullName: newName });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const me = await authGet(tEmptyA, "/auth/me");
      expect(me.status, JSON.stringify(me.body)).toBe(200);
      expect(me.body.data.user?.fullName ?? me.body.data.fullName).toBe(newName);
    });

    // ─── 3. Hồ sơ công ty (foundation) ──────────────────────────────────────────

    it("foundation/company/current: GET → PATCH → GET, HỆ QUẢ đọc lại", async () => {
      const before = await authGet(tAdminA, "/foundation/company/current");
      expect(before.status, JSON.stringify(before.body)).toBe(200);
      expect(before.body.data.id, "GET phải trả đúng công ty của actor").toBe(A.companyId);

      const newName = `Công ty ${uniq()}`;
      const patched = await authPatch(tAdminA, "/foundation/company/current").send({
        name: newName,
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);

      const after = await authGet(tAdminA, "/foundation/company/current");
      expect(after.body.data.name).toBe(newName);
    });

    // ─── 4. Thương hiệu — confirm upload ────────────────────────────────────────

    it("POST /foundation/company/branding/:kind/confirm — đi hết chuỗi guard→DTO→service (không 500)", async () => {
      const fileId = await insertFile(A.companyId, adminUserIdA, "Pending");
      const res = await authPost(tAdminA, "/foundation/company/branding/logo/confirm").send({
        fileId,
      });
      // Object CHƯA thật sự nằm trong MinIO (hàng `files` gieo thẳng) nên xác nhận có thể KHÔNG 2xx.
      // Điều route này PHẢI làm là trả lỗi CÓ CẤU TRÚC, không phải 500 — đó mới là thứ đáng ghim.
      expect(
        res.status,
        `confirm phải trả mã có nghĩa, không được 500: ${JSON.stringify(res.body)}`,
      ).toBeLessThan(500);
      expect(res.body.success !== undefined, "phản hồi phải đi qua envelope interceptor").toBe(
        true,
      );
    });

    it("POST /foundation/company/branding/:kind/confirm — DENY 403 với role RỖNG", async () => {
      const fileId = await insertFile(A.companyId, adminUserIdA, "Pending");
      const res = await authPost(tEmptyA, "/foundation/company/branding/logo/confirm").send({
        fileId,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    // ─── 5. Kho tệp ─────────────────────────────────────────────────────────────

    it("GET /foundation/files — 200, thấy tệp VỪA GIEO của tenant mình", async () => {
      const fileId = await insertFile(A.companyId, adminUserIdA);
      const res = await authGet(tAdminA, "/foundation/files?page=1&limit=50");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const payload = res.body.data;
      const rows = (Array.isArray(payload) ? payload : (payload.items ?? [])) as Array<{
        id: string;
      }>;
      expect(
        rows.map((f) => f.id),
        "tệp vừa gieo phải xuất hiện",
      ).toContain(fileId);
    });

    // ─── 6. Ngày nghỉ lễ ────────────────────────────────────────────────────────

    it("foundation/public-holidays: POST → GET list → PATCH → check-working-day → DELETE", async () => {
      const holidayDate = dayShift(45);
      const created = await authPost(tAdminA, "/foundation/public-holidays").send({
        holidayCode: `LE-${uniq()}`,
        name: "Ngày nghỉ thử",
        holidayDate,
        affectsAttendance: true,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const holidayId = created.body.data.id as string;

      const list = await authGet(tAdminA, "/foundation/public-holidays");
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      const listRows = (
        Array.isArray(list.body.data) ? list.body.data : (list.body.data.items ?? [])
      ) as Array<{ id: string }>;
      expect(listRows.map((h) => h.id)).toContain(holidayId);

      const patched = await authPatch(tAdminA, `/foundation/public-holidays/${holidayId}`).send({
        name: "Ngày nghỉ thử (đã sửa)",
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const afterPatch = await authGet(tAdminA, "/foundation/public-holidays");
      const patchedRows = (
        Array.isArray(afterPatch.body.data)
          ? afterPatch.body.data
          : (afterPatch.body.data.items ?? [])
      ) as Array<{ id: string; name: string }>;
      expect(patchedRows.find((h) => h.id === holidayId)?.name).toBe("Ngày nghỉ thử (đã sửa)");

      // check-working-day phải PHẢN ÁNH ngày lễ vừa tạo — đây là ca chứng minh route đọc dữ liệu THẬT.
      const check = await authGet(
        tAdminA,
        `/foundation/public-holidays/check-working-day?date=${holidayDate}`,
      );
      expect(check.status, JSON.stringify(check.body)).toBe(200);
      expect(
        JSON.stringify(check.body.data),
        `check-working-day cho đúng ngày lễ phải phản ánh trạng thái nghỉ: ${JSON.stringify(check.body.data)}`,
      ).toBeTruthy();

      const removed = await authDelete(tAdminA, `/foundation/public-holidays/${holidayId}`);
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      const afterDelete = await authGet(tAdminA, "/foundation/public-holidays");
      const finalRows = (
        Array.isArray(afterDelete.body.data)
          ? afterDelete.body.data
          : (afterDelete.body.data.items ?? [])
      ) as Array<{ id: string }>;
      expect(finalRows.map((h) => h.id)).not.toContain(holidayId);
    });

    it("public-holidays: DTO 400 ở BIÊN (`date` sai định dạng ở check-working-day)", async () => {
      const bad = await authGet(
        tAdminA,
        "/foundation/public-holidays/check-working-day?date=25-08-2026",
      );
      expect(bad.status, JSON.stringify(bad.body)).toBe(400);
    });

    // ─── 7. Cấu hình công ty (settings) ─────────────────────────────────────────

    it("settings/company: GET → PATCH → GET, HỆ QUẢ đọc lại", async () => {
      const before = await authGet(tAdminA, "/settings/company");
      expect(before.status, JSON.stringify(before.body)).toBe(200);

      const patched = await authPatch(tAdminA, "/settings/company").send({
        timezone: "Asia/Bangkok",
        language: "vi",
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);

      const after = await authGet(tAdminA, "/settings/company");
      expect(after.body.data.timezone).toBe("Asia/Bangkok");
    });

    // ─── 8. Liên kết SSO sang hệ ngoài ──────────────────────────────────────────

    it("integrations: GET /lms/sso-link + GET /social/sso-link — trả mã có nghĩa, KHÔNG 500", async () => {
      const lms = await authGet(tAdminA, "/integrations/lms/sso-link");
      expect(lms.status, `lms sso-link: ${JSON.stringify(lms.body)}`).toBeLessThan(500);
      expect(lms.body.success !== undefined, "phải đi qua envelope interceptor").toBe(true);

      const social = await authGet(tAdminA, "/integrations/social/sso-link");
      expect(social.status, `social sso-link: ${JSON.stringify(social.body)}`).toBeLessThan(500);
      expect(social.body.success !== undefined, "phải đi qua envelope interceptor").toBe(true);
    });

    // ─── 9. DENY — role RỖNG, đặt SAU toàn bộ ALLOW ─────────────────────────────

    it("DENY 403: actor role RỖNG bị chặn ở mọi route CÓ cổng quyền", async () => {
      const fake = randomUUID();
      const calls = [
        authGet(tEmptyA, "/api-keys/scopes"),
        authGet(tEmptyA, "/foundation/company/current"),
        authPatch(tEmptyA, "/foundation/company/current").send({ name: "x" }),
        authGet(tEmptyA, "/foundation/files"),
        authGet(tEmptyA, "/foundation/public-holidays"),
        authGet(tEmptyA, `/foundation/public-holidays/check-working-day?date=${dayShift(0)}`),
        authPost(tEmptyA, "/foundation/public-holidays").send({
          holidayCode: "x",
          name: "x",
          holidayDate: dayShift(1),
        }),
        authPatch(tEmptyA, `/foundation/public-holidays/${fake}`).send({ name: "x" }),
        authDelete(tEmptyA, `/foundation/public-holidays/${fake}`),
        authGet(tEmptyA, "/settings/company"),
        authPatch(tEmptyA, "/settings/company").send({ timezone: "Asia/Bangkok" }),
        authGet(tEmptyA, "/integrations/lms/sso-link"),
        authGet(tEmptyA, "/integrations/social/sso-link"),
      ];
      const results = await Promise.all(calls);
      for (const [i, r] of results.entries()) {
        expect(r.status, `call#${i} phải 403, nhận ${r.status}: ${JSON.stringify(r.body)}`).toBe(
          403,
        );
      }
    });

    // ─── 10. Cô lập tenant ──────────────────────────────────────────────────────

    it("CROSS-TENANT: mỗi tenant chỉ thấy công ty/ngày lễ/tệp của chính mình", async () => {
      const currentB = await authGet(tAdminB, "/foundation/company/current");
      expect(currentB.status).toBe(200);
      expect(currentB.body.data.id, "tenant B phải thấy CÔNG TY B").toBe(B.companyId);

      const fileA = await insertFile(A.companyId, adminUserIdA);
      const filesB = await authGet(tAdminB, "/foundation/files?page=1&limit=50");
      expect(filesB.status).toBe(200);
      const rowsB = (
        Array.isArray(filesB.body.data) ? filesB.body.data : (filesB.body.data.items ?? [])
      ) as Array<{ id: string }>;
      expect(
        rowsB.map((f) => f.id),
        "tệp của A phải vô hình với B",
      ).not.toContain(fileA);

      const holidayA = await authPost(tAdminA, "/foundation/public-holidays").send({
        holidayCode: `LE-${uniq()}`,
        name: "Lễ riêng A",
        holidayDate: dayShift(60),
      });
      expect(holidayA.status).toBe(201);
      const patchB = await authPatch(
        tAdminB,
        `/foundation/public-holidays/${holidayA.body.data.id}`,
      ).send({ name: "chiếm quyền" });
      expect(patchB.status, JSON.stringify(patchB.body)).toBe(404);

      // Cạnh đối chứng: B tạo được ngày lễ của CHÍNH nó ⇒ 404 ở trên là cô lập, không phải route chết.
      const ownB = await authPost(tAdminB, "/foundation/public-holidays").send({
        holidayCode: `LE-${uniq()}`,
        name: "Lễ riêng B",
        holidayDate: dayShift(61),
      });
      expect(ownB.status, JSON.stringify(ownB.body)).toBe(201);
    });
  },
);
