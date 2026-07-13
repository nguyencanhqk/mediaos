/**
 * S4-NOTI-BE-5 — Notification ADMIN template LIST (GET /notifications/templates, NOTI-API-303 mở lại scope
 * gốc — mở đường FE NOTI-SCREEN-006) trên Nest app + Postgres THẬT. Mirror listCatalog của events
 * (notification-admin-config.int-spec.ts). KHÔNG migration (GRANT SELECT notification_templates mở 0479/
 * 0481/0482); KHÔNG đụng permission.service/allowlist (cặp view:notification-template đã seed 0481 + đã ở
 * SENSITIVE_CAPABILITY_ALLOWLIST).
 *
 * Phủ (RED-trước → GREEN):
 *   (a) employee (role 0008, KHÔNG có view:notification-template) → 403 (deny-path, sensitive gate).
 *   (a2) hr (role …011, chỉ own-scope notification 4b — KHÔNG có view:notification-template) → 403.
 *   (b) company-admin (role 0001, grant Company seed mig 0481) → 200, chứa template GLOBAL TASK_ASSIGNED
 *       (company_id=null, is_company_override=false, channel IN_APP, locale vi-VN); phân trang top-level.
 *   (c) filter event_code=TASK_ASSIGNED → CHỈ template TASK_ASSIGNED; filter channel/locale khớp.
 *   (d) override THẮNG global: PATCH template GLOBAL (tạo override A) → GET list → hàng TASK_ASSIGNED trở
 *       thành override (company_id=A, is_company_override=true, title mới), ĐÚNG 1 hàng cho template_code
 *       (KHÔNG lộ CẢ global + override — merge "override thắng global").
 *   (e) cross-tenant: admin B → GET list thấy TASK_ASSIGNED GLOBAL (company_id=null), KHÔNG thấy override A
 *       (BẤT BIẾN #1 — RLS + filter companyId defense-in-depth).
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
const HR_ROLE = "00000000-0000-0000-0000-000000000011";
const TASK_ASSIGNED_TEMPLATE_CODE = "TASK_ASSIGNED__IN_APP__vi-VN";

interface TemplateItem {
  id: string;
  company_id: string | null;
  is_company_override: boolean;
  event_id: string;
  template_code: string;
  channel: string;
  locale: string;
  title_template: string;
}

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
  "S4-NOTI-BE-5 GET /notifications/templates (admin template list, override ∪ global)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    let adminToken: string;
    let employeeToken: string;
    let hrToken: string;
    let adminBToken: string;
    const companyIds: string[] = [];

    let globalTaskAssignedTemplateId: string;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();
      const pw = await new PasswordService().hash(LOGIN_PW);

      A = await seedCompany(direct, "notitplA");
      companyIds.push(A.companyId);
      B = await seedCompany(direct, "notitplB");
      companyIds.push(B.companyId);

      const adminEmail = `ca-${randomUUID()}@a.test`;
      const admin = await seedUser(direct, A.companyId, adminEmail, pw);
      await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

      const empEmail = `emp-${randomUUID()}@a.test`;
      const emp = await seedUser(direct, A.companyId, empEmail, pw);
      await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

      const hrEmail = `hr-${randomUUID()}@a.test`;
      const hr = await seedUser(direct, A.companyId, hrEmail, pw);
      await seedUserRole(direct, hr, HR_ROLE, A.companyId);

      const adminBEmail = `ca-${randomUUID()}@b.test`;
      const adminB = await seedUser(direct, B.companyId, adminBEmail, pw);
      await seedUserRole(direct, adminB, COMPANY_ADMIN_ROLE, B.companyId);

      const tplRes = await direct.query<{ id: string }>(
        `SELECT id FROM notification_templates
          WHERE template_code = $1 AND company_id IS NULL LIMIT 1`,
        [TASK_ASSIGNED_TEMPLATE_CODE],
      );
      const tplRow = tplRes.rows[0];
      if (!tplRow)
        throw new Error(`Seed global template ${TASK_ASSIGNED_TEMPLATE_CODE} không tồn tại`);
      globalTaskAssignedTemplateId = tplRow.id;

      adminToken = await login(app, A.slug, adminEmail);
      employeeToken = await login(app, A.slug, empEmail);
      hrToken = await login(app, A.slug, hrEmail);
      adminBToken = await login(app, B.slug, adminBEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    it("(a) employee → 403 (deny-path, sensitive gate view:notification-template)", async () => {
      const res = await api(app)
        .get("/notifications/templates")
        .set("Authorization", `Bearer ${employeeToken}`);
      expect(res.status).toBe(403);
    });

    it("(a2) hr → 403 (không có cặp view:notification-template — chỉ own-scope notification)", async () => {
      const res = await api(app)
        .get("/notifications/templates")
        .set("Authorization", `Bearer ${hrToken}`);
      expect(res.status).toBe(403);
    });

    it("(b) company-admin → 200, chứa template GLOBAL TASK_ASSIGNED (company_id=null, override=false)", async () => {
      const res = await api(app)
        .get("/notifications/templates")
        .query({ per_page: 100 })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data as TemplateItem[];
      const taskAssigned = items.find((t) => t.template_code === TASK_ASSIGNED_TEMPLATE_CODE);
      expect(taskAssigned, "thiếu template global TASK_ASSIGNED trong danh sách").toBeTruthy();
      expect(taskAssigned?.company_id).toBeNull();
      expect(taskAssigned?.is_company_override).toBe(false);
      expect(taskAssigned?.channel).toBe("IN_APP");
      expect(taskAssigned?.locale).toBe("vi-VN");
      expect(res.body.pagination).toBeTruthy();
      expect(res.body.pagination.total).toBeGreaterThan(0);
    });

    it("(c) filter event_code=TASK_ASSIGNED → CHỈ template TASK_ASSIGNED; filter channel/locale khớp", async () => {
      const byEvent = await api(app)
        .get("/notifications/templates")
        .query({ event_code: "TASK_ASSIGNED", per_page: 100 })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(byEvent.status).toBe(200);
      const eventItems = byEvent.body.data as TemplateItem[];
      expect(eventItems.length).toBeGreaterThan(0);
      for (const item of eventItems) expect(item.template_code).toBe(TASK_ASSIGNED_TEMPLATE_CODE);

      const byChannel = await api(app)
        .get("/notifications/templates")
        .query({ channel: "IN_APP", per_page: 100 })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(byChannel.status).toBe(200);
      const channelItems = byChannel.body.data as TemplateItem[];
      expect(channelItems.length).toBeGreaterThan(0);
      for (const item of channelItems) expect(item.channel).toBe("IN_APP");

      const byLocale = await api(app)
        .get("/notifications/templates")
        .query({ locale: "vi-VN", per_page: 100 })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(byLocale.status).toBe(200);
      const localeItems = byLocale.body.data as TemplateItem[];
      expect(localeItems.length).toBeGreaterThan(0);
      for (const item of localeItems) expect(item.locale).toBe("vi-VN");

      // Filter kênh không tồn tại trong seed (PUSH) → 0 hàng (không lỗi).
      const byPush = await api(app)
        .get("/notifications/templates")
        .query({ channel: "PUSH", per_page: 100 })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(byPush.status).toBe(200);
      expect((byPush.body.data as TemplateItem[]).length).toBe(0);
    });

    it("(d) override THẮNG global: PATCH tạo override A → list thấy override, ĐÚNG 1 hàng cho template_code", async () => {
      const newTitle = `Task mới (A ${randomUUID().slice(0, 6)})`;
      const patch = await api(app)
        .patch(`/notifications/templates/${globalTaskAssignedTemplateId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title_template: newTitle });
      expect(patch.status, JSON.stringify(patch.body)).toBe(200);
      expect(patch.body.data.company_id).toBe(A.companyId);

      const res = await api(app)
        .get("/notifications/templates")
        .query({ event_code: "TASK_ASSIGNED", per_page: 100 })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const rows = (res.body.data as TemplateItem[]).filter(
        (t) => t.template_code === TASK_ASSIGNED_TEMPLATE_CODE,
      );
      // Merge "override thắng global": CHỈ 1 hàng (KHÔNG lộ CẢ global + override).
      expect(rows.length).toBe(1);
      expect(rows[0].company_id).toBe(A.companyId);
      expect(rows[0].is_company_override).toBe(true);
      expect(rows[0].title_template).toBe(newTitle);
    });

    it("(e) cross-tenant: admin B → thấy TASK_ASSIGNED GLOBAL, KHÔNG thấy override A", async () => {
      const res = await api(app)
        .get("/notifications/templates")
        .query({ event_code: "TASK_ASSIGNED", per_page: 100 })
        .set("Authorization", `Bearer ${adminBToken}`);
      expect(res.status).toBe(200);
      const rows = (res.body.data as TemplateItem[]).filter(
        (t) => t.template_code === TASK_ASSIGNED_TEMPLATE_CODE,
      );
      expect(rows.length).toBe(1);
      // B chưa override → thấy GLOBAL (company_id null); KHÔNG rò override/title của A.
      expect(rows[0].company_id).toBeNull();
      expect(rows[0].is_company_override).toBe(false);
    });
  },
);
