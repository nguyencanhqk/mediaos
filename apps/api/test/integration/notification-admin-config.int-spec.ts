/**
 * S4-NOTI-BE-3 — Notification ADMIN config READ-ONLY (GET /notifications/events · GET
 * /notifications/templates/{id} · GET /notifications/delivery-logs) trên Nest app + Postgres THẬT.
 *
 * ⚠️ PHẠM VI: file này CHỈ phủ 3 route GET (READ, BE-3). WRITE (PATCH /events/{id} · PATCH /templates/{id},
 * BE-4 — GRANT INSERT,UPDATE mở ở mig 0487) được phủ RIÊNG ở notification-admin-write.int-spec.ts.
 *
 * Phủ (RED-trước → GREEN):
 *   (a) employee (role 0008, KHÔNG có view:notification-config/-template/-delivery-log) → CẢ 3 route 403.
 *   (b) company-admin (role 0001, grant Company seed mig 0481) → GET /notifications/events 200, chứa
 *       event global TASK_ASSIGNED (is_enabled=true, company_id=null).
 *   (c) company-admin → GET /notifications/templates/{id} 200 đúng template global TASK_ASSIGNED (channel
 *       IN_APP, locale vi-VN); id lạ → 404 NOTI-ERR-TEMPLATE-NOT-FOUND.
 *   (d) company-admin → GET /notifications/delivery-logs 200, thấy log company MÌNH; KHÔNG thấy log company
 *       khác (cross-tenant, BẤT BIẾN #1) dù cùng gọi 1 token.
 *
 * Gate CỨNG hasDb && LANE_DB (memory integration-test-lane-db-gate).
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
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001";
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008";

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: LOGIN_PW });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

describe.skipIf(!runDb)(
  "S4-NOTI-BE-3 GET /notifications/events · /templates/:id · /delivery-logs (admin config read-only)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    let adminToken: string;
    let employeeToken: string;
    let adminBToken: string;
    const companyIds: string[] = [];

    let globalTaskAssignedTemplateId: string;
    let logIdA: string;
    let logIdB: string;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();
      const pw = await new PasswordService().hash(LOGIN_PW);

      A = await seedCompany(direct, "notiadmA");
      companyIds.push(A.companyId);
      B = await seedCompany(direct, "notiadmB");
      companyIds.push(B.companyId);

      const adminEmail = `ca-${randomUUID()}@a.test`;
      const admin = await seedUser(direct, A.companyId, adminEmail, pw);
      await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

      const empEmail = `emp-${randomUUID()}@a.test`;
      const emp = await seedUser(direct, A.companyId, empEmail, pw);
      await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

      const adminBEmail = `ca-${randomUUID()}@b.test`;
      const adminB = await seedUser(direct, B.companyId, adminBEmail, pw);
      await seedUserRole(direct, adminB, COMPANY_ADMIN_ROLE, B.companyId);

      const tplRes = await direct.query<{ id: string }>(
        `SELECT id FROM notification_templates
          WHERE template_code = 'TASK_ASSIGNED__IN_APP__vi-VN' AND company_id IS NULL LIMIT 1`,
      );
      const tplRow = tplRes.rows[0];
      if (!tplRow)
        throw new Error("Seed global template TASK_ASSIGNED__IN_APP__vi-VN không tồn tại");
      globalTaskAssignedTemplateId = tplRow.id;

      // Plant 1 notification + 1 delivery_log cho MỖI company (cross-tenant chứng minh isolation).
      const notifA = await direct.query<{ id: string }>(
        `INSERT INTO notifications (company_id, user_id, body) VALUES ($1, $2, $3) RETURNING id`,
        [A.companyId, admin, "test notification A"],
      );
      const notifARow = notifA.rows[0];
      if (!notifARow) throw new Error("insert notifA rỗng");
      const logA = await direct.query<{ id: string }>(
        `INSERT INTO notification_delivery_logs
           (company_id, notification_id, recipient_user_id, channel, delivery_status)
         VALUES ($1, $2, $3, 'IN_APP', 'Sent') RETURNING id`,
        [A.companyId, notifARow.id, admin],
      );
      const logARow = logA.rows[0];
      if (!logARow) throw new Error("insert logA rỗng");
      logIdA = logARow.id;

      const notifB = await direct.query<{ id: string }>(
        `INSERT INTO notifications (company_id, user_id, body) VALUES ($1, $2, $3) RETURNING id`,
        [B.companyId, adminB, "test notification B"],
      );
      const notifBRow = notifB.rows[0];
      if (!notifBRow) throw new Error("insert notifB rỗng");
      const logB = await direct.query<{ id: string }>(
        `INSERT INTO notification_delivery_logs
           (company_id, notification_id, recipient_user_id, channel, delivery_status)
         VALUES ($1, $2, $3, 'IN_APP', 'Sent') RETURNING id`,
        [B.companyId, notifBRow.id, adminB],
      );
      const logBRow = logB.rows[0];
      if (!logBRow) throw new Error("insert logB rỗng");
      logIdB = logBRow.id;

      adminToken = await login(app, A.slug, adminEmail);
      employeeToken = await login(app, A.slug, empEmail);
      adminBToken = await login(app, B.slug, adminBEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    it("(a) employee → 403 trên CẢ 3 route (deny-path, sensitive gate)", async () => {
      const events = await api(app)
        .get("/notifications/events")
        .set("Authorization", `Bearer ${employeeToken}`);
      expect(events.status).toBe(403);

      const template = await api(app)
        .get(`/notifications/templates/${globalTaskAssignedTemplateId}`)
        .set("Authorization", `Bearer ${employeeToken}`);
      expect(template.status).toBe(403);

      const logs = await api(app)
        .get("/notifications/delivery-logs")
        .set("Authorization", `Bearer ${employeeToken}`);
      expect(logs.status).toBe(403);
    });

    it("(b) company-admin → GET /notifications/events 200, chứa event global TASK_ASSIGNED enabled", async () => {
      const res = await api(app)
        .get("/notifications/events")
        .query({ per_page: 100 })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data as Array<{
        event_code: string;
        is_enabled: boolean;
        company_id: string | null;
      }>;
      const taskAssigned = items.find((e) => e.event_code === "TASK_ASSIGNED");
      expect(taskAssigned, "thiếu event global TASK_ASSIGNED trong danh sách").toBeTruthy();
      expect(taskAssigned?.is_enabled).toBe(true);
      expect(taskAssigned?.company_id).toBeNull();
      expect(res.body.pagination).toBeTruthy();
    });

    it("(b2) company-admin → filter module_code=TASK chỉ trả event module TASK", async () => {
      const res = await api(app)
        .get("/notifications/events")
        .query({ module_code: "TASK", per_page: 100 })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const items = res.body.data as Array<{ module_code: string }>;
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) expect(item.module_code).toBe("TASK");
    });

    it("(c) company-admin → GET /notifications/templates/{id} 200 đúng template global TASK_ASSIGNED", async () => {
      const res = await api(app)
        .get(`/notifications/templates/${globalTaskAssignedTemplateId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.template_code).toBe("TASK_ASSIGNED__IN_APP__vi-VN");
      expect(res.body.data.channel).toBe("IN_APP");
      expect(res.body.data.company_id).toBeNull();
    });

    it("(c2) company-admin → id lạ (không tồn tại) → 404 NOTI-ERR-TEMPLATE-NOT-FOUND", async () => {
      const res = await api(app)
        .get(`/notifications/templates/${randomUUID()}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error?.code ?? res.body.code).toBe("NOTI-ERR-TEMPLATE-NOT-FOUND");
    });

    it("(d) company-admin → GET /notifications/delivery-logs 200, thấy log CỦA MÌNH", async () => {
      const res = await api(app)
        .get("/notifications/delivery-logs")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toContain(logIdA);
      expect(ids).not.toContain(logIdB);
    });

    it("(d2) cross-tenant: admin công ty B → thấy log CỦA B, KHÔNG thấy log của A", async () => {
      const res = await api(app)
        .get("/notifications/delivery-logs")
        .set("Authorization", `Bearer ${adminBToken}`);
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toContain(logIdB);
      expect(ids).not.toContain(logIdA);
    });
  },
);
