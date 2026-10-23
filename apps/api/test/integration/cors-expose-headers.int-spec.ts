/**
 * S1-FND-CORS-EXPOSE-1 — CORS của API phải cho trình duyệt đọc `Content-Disposition` của file tải về.
 *
 * Trình duyệt chỉ cho JS đọc response header cross-origin nếu nó nằm trong
 * `Access-Control-Expose-Headers`; thiếu ⇒ FE không thấy tên tệp server đặt và phải tự dựng tên dự
 * phòng. Spec này đo header đó trên một route xuất tệp THẬT của AppModule
 * (`GET /hr/employees/import/template`, `@Header("Content-Disposition", …)`), với app dựng qua
 * `applyMainPipeline` + ĐÚNG đối số `enableCors` của `main.ts` (`buildCorsOptions`).
 *
 * Kèm hai ca giữ biên: Origin ngoài danh sách KHÔNG nhận `Access-Control-Allow-Origin`, và Origin
 * trong danh sách vẫn nhận `Access-Control-Allow-Credentials: true` — WO cấm nới `origin`/`credentials`.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). Dữ liệu gieo theo công ty riêng, dọn ở afterAll.
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
import { buildCorsOptions } from "../../src/config/cors-options";
import { applyMainPipeline } from "../helpers/bootstrap-app";
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
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s1corsexp");

const ALLOWED = "http://app.cors-expose.test";
const FOREIGN = "http://evil.cors-expose.test";
const CORS_ORIGIN_RAW = `http://console.cors-expose.test, ${ALLOWED}`;
const TEMPLATE_ROUTE = "/hr/employees/import/template";

function exposedList(header: string | undefined): string[] {
  return (header ?? "").split(",").map((h) => h.trim().toLowerCase());
}

describe.skipIf(!hasLaneDb)(
  "S1-FND-CORS-EXPOSE-1 — CORS lộ Content-Disposition trên route xuất tệp",
  () => {
    let app: INestApplication;
    let direct: Pool;
    const companyIds: string[] = [];
    let token = "";

    const http = () => request(app.getHttpServer());

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = applyMainPipeline(moduleRef.createNestApplication());
      app.enableCors(buildCorsOptions(CORS_ORIGIN_RAW));
      await app.init();
      await app.listen(0);

      direct = directPool();
      const tenant = await seedCompany(direct, "s1corsexp");
      companyIds.push(tenant.companyId);

      const email = `hr-${randomUUID().slice(0, 8)}@s1corsexp.local`;
      const userId = await seedUser(
        direct,
        tenant.companyId,
        email,
        await new PasswordService().hash(LOGIN_PW),
      );
      const roleId = await seedRole(
        direct,
        tenant.companyId,
        `s1corsexp-${randomUUID().slice(0, 8)}`,
      );
      const permId = await seedPermissionCatalog(direct, "import", "employee", true);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      await seedUserRole(direct, userId, roleId, tenant.companyId);

      const login = await http()
        .post("/auth/login")
        .send({ companySlug: tenant.slug, email, password: LOGIN_PW });
      expect(login.status, `login: ${JSON.stringify(login.body)}`).toBe(200);
      token = login.body.data.accessToken as string;
    }, 180_000);

    afterAll(async () => {
      await app?.close();
      if (companyIds.length > 0) {
        await cleanupTenants(direct, companyIds);
      }
      await direct?.end();
    });

    it("Origin thuộc danh sách ⇒ Access-Control-Expose-Headers có Content-Disposition", async () => {
      const res = await http()
        .get(TEMPLATE_ROUTE)
        .set("Authorization", `Bearer ${token}`)
        .set("Origin", ALLOWED);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.headers["content-disposition"]).toContain("employee-import-template.csv");
      expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
      expect(exposedList(res.headers["access-control-expose-headers"])).toContain(
        "content-disposition",
      );
    });

    it("Origin NGOÀI danh sách ⇒ không có Access-Control-Allow-Origin (origin không bị nới)", async () => {
      const res = await http()
        .get(TEMPLATE_ROUTE)
        .set("Authorization", `Bearer ${token}`)
        .set("Origin", FOREIGN);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  },
);
