/**
 * S5-TASK-NAV-TREE-1 (đợt B) — Integration (Postgres THẬT, DB CÔ LẬP): filter `departmentId` trên
 * GET /projects (TASK-API-001). Sidebar cây phòng ban deep-link /tasks/projects?departmentId=X —
 * filter mới PHẢI lọc đúng trong-tenant và KHÔNG thành kênh dò cross-tenant.
 *
 * Phủ:
 *   F1 không filter        → thấy đủ 3 project công ty A (PA1 deptX · PA2 deptY · PA3 không phòng ban),
 *                            KHÔNG thấy PB1 của công ty B (baseline cô lập tenant).
 *   F2 departmentId=deptX  → CHỈ PA1.
 *   F3 departmentId=deptY  → CHỈ PA2 (project không phòng ban KHÔNG lọt vào).
 *   F4 departmentId=deptZ (uuid THẬT của công ty B) → [] — probe cross-tenant không rò (RLS +
 *                            company_id AND departmentId; không 404/500 lộ tồn tại).
 *   F5 departmentId không phải uuid → 400 (Zod DTO chặn ở biên).
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated src/tasks →
 * vitest include src/**\/*.spec.ts.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../auth/password.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../test/helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!test99";

describe.skipIf(!runDb)(
  "S5-TASK-NAV-TREE-1 — GET /projects?departmentId (lọc + cô lập tenant)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let readerA = "";
    let deptX = "";
    let deptY = "";
    let deptZ = "";
    let PA1 = "";
    let PA2 = "";
    let PA3 = "";

    async function seedOrgUnit(companyId: string, name: string): Promise<string> {
      const r = await direct.query(
        "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
        [companyId, name],
      );
      return r.rows[0].id as string;
    }

    async function plantProject(
      companyId: string,
      name: string,
      departmentId: string | null,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO projects (company_id, name, project_code, department_id, project_status)
       VALUES ($1,$2,$3,$4,'Active') RETURNING id`,
        [companyId, name, `NAV1-${name}`, departmentId],
      );
      return r.rows[0].id as string;
    }

    async function login(slug: string, email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    function get(token: string, url: string) {
      return request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`);
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);

      A = await seedCompany(direct, "navtreeA");
      B = await seedCompany(direct, "navtreeB");
      companyIds.push(A.companyId, B.companyId);

      deptX = await seedOrgUnit(A.companyId, "Phòng Kỹ thuật");
      deptY = await seedOrgUnit(A.companyId, "Phòng Marketing");
      deptZ = await seedOrgUnit(B.companyId, "Phòng B-Z");

      readerA = await seedUser(direct, A.companyId, `reader@${A.slug}.test`, hash);
      const roleId = await seedRole(direct, A.companyId, `navtree-reader-${A.slug}`);
      const permId = await seedPermissionCatalog(direct, "read", "project", false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      await seedUserRole(direct, readerA, roleId, A.companyId);

      PA1 = await plantProject(A.companyId, "PA1", deptX);
      PA2 = await plantProject(A.companyId, "PA2", deptY);
      PA3 = await plantProject(A.companyId, "PA3", null);
      await plantProject(B.companyId, "PB1", deptZ);
    });

    afterAll(async () => {
      if (direct) await cleanupTenants(direct, companyIds);
      if (app) await app.close();
    });

    it("F1 — không filter: thấy đủ 3 project công ty A, KHÔNG thấy project công ty B", async () => {
      const token = await login(A.slug, `reader@${A.slug}.test`);
      const res = await get(token, "/projects");
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toEqual(expect.arrayContaining([PA1, PA2, PA3]));
      expect(ids).toHaveLength(3);
    });

    it("F2 — departmentId=deptX: CHỈ project thuộc phòng đó", async () => {
      const token = await login(A.slug, `reader@${A.slug}.test`);
      const res = await get(token, `/projects?departmentId=${deptX}`);
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toEqual([PA1]);
    });

    it("F3 — departmentId=deptY: project không phòng ban KHÔNG lọt vào", async () => {
      const token = await login(A.slug, `reader@${A.slug}.test`);
      const res = await get(token, `/projects?departmentId=${deptY}`);
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toEqual([PA2]);
    });

    it("F4 — departmentId của công ty KHÁC (uuid thật): trả [] — không rò cross-tenant", async () => {
      const token = await login(A.slug, `reader@${A.slug}.test`);
      const res = await get(token, `/projects?departmentId=${deptZ}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("F5 — departmentId không phải uuid: 400 tại biên validate", async () => {
      const token = await login(A.slug, `reader@${A.slug}.test`);
      const res = await get(token, "/projects?departmentId=not-a-uuid");
      expect(res.status).toBe(400);
    });
  },
);
