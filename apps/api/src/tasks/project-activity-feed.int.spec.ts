/**
 * S5-TASK-WORKSPACE-1 (đợt D1) — Integration (Postgres THẬT, DB CÔ LẬP): GET /projects/:id/activity
 * (TASK-API-601, tab "Hoạt động" workspace dự án). Feed dự án gộp sự kiện project-level (task_id NULL)
 * + task con, gate `view:task-audit-log` SENSITIVE — deny-path phải 403 THẬT, cross-tenant không rò.
 *
 * Phủ:
 *   A1 thiếu view:task-audit-log (chỉ read:project) → 403 (PermissionGuard, TASK-ERR-042).
 *   A2 có quyền → 200: đủ 2 dòng của PA (project-level + task con) THEO THỨ TỰ desc created_at,
 *      KHÔNG lẫn dòng của project PA2 cùng tenant, KHÔNG lẫn dòng công ty B.
 *   A3 projectId của công ty B (uuid THẬT) → 404 — không lộ tồn tại cross-tenant.
 *   A4 projectId không tồn tại → 404.
 *   A5 limit=1 → chỉ dòng mới nhất (clamp/pagination đường limit).
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated src/tasks →
 * vitest include src/**\/*.spec.ts. app.close() TRƯỚC cleanupTenants (chống FK 23503 outbox-flake).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
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
  "S5-TASK-WORKSPACE-1 — GET /projects/:id/activity (TASK-API-601, deny-path + cô lập tenant)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let PA = "";
    let PA2 = "";
    let PB = "";
    let logProjectLevel = "";
    let logTaskLevel = "";

    async function plantProject(companyId: string, name: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO projects (company_id, name, project_code, project_status)
         VALUES ($1,$2,$3,'Active') RETURNING id`,
        [companyId, name, `WS1-${name}`],
      );
      return r.rows[0].id as string;
    }

    async function plantTask(companyId: string, title: string): Promise<string> {
      const r = await direct.query(
        "INSERT INTO tasks (company_id, title) VALUES ($1,$2) RETURNING id",
        [companyId, title],
      );
      return r.rows[0].id as string;
    }

    async function plantActivity(
      companyId: string,
      projectId: string,
      taskId: string | null,
      action: string,
      createdAt: string,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO task_activity_logs (company_id, project_id, task_id, action, target_type, message, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          companyId,
          projectId,
          taskId,
          action,
          taskId ? "Task" : "Project",
          `msg-${action}`,
          createdAt,
        ],
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

      A = await seedCompany(direct, "wsactA");
      B = await seedCompany(direct, "wsactB");
      companyIds.push(A.companyId, B.companyId);

      // Viewer CÓ view:task-audit-log (SENSITIVE) — mirror seed 0485 hr/company-admin @Company.
      const viewerA = await seedUser(direct, A.companyId, `viewer@${A.slug}.test`, hash);
      const viewerRole = await seedRole(direct, A.companyId, `wsact-viewer-${A.slug}`);
      const auditPerm = await seedPermissionCatalog(direct, "view", "task-audit-log", true);
      await seedRolePermission(direct, viewerRole, auditPerm, "ALLOW", "Company");
      await seedUserRole(direct, viewerA, viewerRole, A.companyId);

      // Reader CHỈ có read:project (không có cặp audit-log) — deny-path A1.
      const readerA = await seedUser(direct, A.companyId, `reader@${A.slug}.test`, hash);
      const readerRole = await seedRole(direct, A.companyId, `wsact-reader-${A.slug}`);
      const readPerm = await seedPermissionCatalog(direct, "read", "project", false);
      await seedRolePermission(direct, readerRole, readPerm, "ALLOW", "Company");
      await seedUserRole(direct, readerA, readerRole, A.companyId);

      PA = await plantProject(A.companyId, "PA");
      PA2 = await plantProject(A.companyId, "PA2");
      PB = await plantProject(B.companyId, "PB");
      const taskA = await plantTask(A.companyId, "Task trong PA");

      // created_at cài tay để thứ tự desc xác định (task-level MỚI hơn project-level).
      logProjectLevel = await plantActivity(
        A.companyId,
        PA,
        null,
        "PROJECT_CREATED",
        "2026-07-01T08:00:00.000Z",
      );
      logTaskLevel = await plantActivity(
        A.companyId,
        PA,
        taskA,
        "TASK_CREATED",
        "2026-07-02T08:00:00.000Z",
      );
      // Nhiễu: cùng tenant khác project + tenant B — KHÔNG được lọt vào feed của PA.
      await plantActivity(A.companyId, PA2, null, "PROJECT_CREATED", "2026-07-03T08:00:00.000Z");
      await plantActivity(B.companyId, PB, null, "PROJECT_CREATED", "2026-07-03T08:00:00.000Z");
    });

    // app.close() TRƯỚC cleanupTenants — outbox worker còn sống có thể ghi audit_logs giữa các câu
    // DELETE của cleanup ⇒ FK 23503 flake (bẫy đã fix lane 6 đợt A, không lặp lại).
    afterAll(async () => {
      if (app) await app.close();
      if (direct) await cleanupTenants(direct, companyIds);
    });

    it("A1 — thiếu view:task-audit-log: 403 (deny-path, không rò dữ liệu ledger)", async () => {
      const token = await login(A.slug, `reader@${A.slug}.test`);
      const res = await get(token, `/projects/${PA}/activity`);
      expect(res.status).toBe(403);
    });

    it("A2 — có quyền: đủ 2 dòng PA (project-level + task con) desc, không lẫn PA2/công ty B", async () => {
      const token = await login(A.slug, `viewer@${A.slug}.test`);
      const res = await get(token, `/projects/${PA}/activity`);
      expect(res.status).toBe(200);
      const rows = res.body.data as Array<{ id: string; taskId: string | null; action: string }>;
      expect(rows.map((r) => r.id)).toEqual([logTaskLevel, logProjectLevel]);
      expect(rows[0].taskId).not.toBeNull();
      expect(rows[1].taskId).toBeNull();
    });

    it("A3 — projectId công ty B (uuid thật): 404 — không lộ tồn tại cross-tenant", async () => {
      const token = await login(A.slug, `viewer@${A.slug}.test`);
      const res = await get(token, `/projects/${PB}/activity`);
      expect(res.status).toBe(404);
    });

    it("A4 — projectId không tồn tại: 404", async () => {
      const token = await login(A.slug, `viewer@${A.slug}.test`);
      const res = await get(token, `/projects/${randomUUID()}/activity`);
      expect(res.status).toBe(404);
    });

    it("A5 — limit=1: chỉ dòng mới nhất (đường pagination)", async () => {
      const token = await login(A.slug, `viewer@${A.slug}.test`);
      const res = await get(token, `/projects/${PA}/activity?limit=1`);
      expect(res.status).toBe(200);
      const rows = res.body.data as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toEqual([logTaskLevel]);
    });
  },
);
