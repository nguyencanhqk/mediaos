/**
 * S4-NOTI-BE-4 — Notification ADMIN config WRITE (PATCH /notifications/events/{id} bật/tắt event ·
 * PATCH /notifications/templates/{id} sửa nội dung) trên Nest app + Postgres THẬT. Hoàn tất phần BLOCKED
 * của S4-NOTI-BE-3 (viết company-override đòi GRANT INSERT,UPDATE — mở ở mig 0487).
 *
 * BẤT BIẾN kiểm chứng (2 chiều, plan redTests):
 *   (0) migration-smoke: mediaos_app có đúng {SELECT,INSERT,UPDATE} trên notification_events/_templates —
 *       KHÔNG DELETE; RLS policy tenant_isolation GIỮ định nghĩa 0479 (USING có "IS NULL", WITH CHECK KHÔNG).
 *   (a) employee → PATCH events/:id + templates/:id → 403 (sensitive gate).
 *   (b) company-admin A → PATCH events/:id (GLOBAL TASK_ASSIGNED) is_enabled=false → 200, override
 *       company_id=A is_company_override=true; GET events phản ánh; directPool: hàng GLOBAL VẪN is_enabled=true.
 *   (c) admin A → PATCH templates/:id (GLOBAL) body chứa biến cấm '{password}' → 422; directPool: KHÔNG có
 *       override (A, template_code) VÀ hàng global KHÔNG đổi.
 *   (d) admin A → PATCH templates/:id hợp lệ → 200, 1 override company_id=A; GET override id trả nội dung mới,
 *       global nguyên.
 *   (e) cross-tenant: admin B (plant THẬT) → GET events KHÔNG thấy override của A (vẫn global enabled null).
 *   (f) PATCH id không tồn tại → 404.
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
  "S4-NOTI-BE-4 PATCH /notifications/events|templates (admin config write)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    let adminToken: string;
    let employeeToken: string;
    let adminBToken: string;
    const companyIds: string[] = [];

    let globalTaskAssignedEventId: string;
    let globalTaskAssignedTemplateId: string;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();
      const pw = await new PasswordService().hash(LOGIN_PW);

      A = await seedCompany(direct, "notiwrA");
      companyIds.push(A.companyId);
      B = await seedCompany(direct, "notiwrB");
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

      const evRes = await direct.query<{ id: string }>(
        `SELECT id FROM notification_events
        WHERE event_code = 'TASK_ASSIGNED' AND company_id IS NULL LIMIT 1`,
      );
      if (!evRes.rows[0]) throw new Error("Seed global event TASK_ASSIGNED không tồn tại");
      globalTaskAssignedEventId = evRes.rows[0].id;

      const tplRes = await direct.query<{ id: string }>(
        `SELECT id FROM notification_templates
        WHERE template_code = 'TASK_ASSIGNED__IN_APP__vi-VN' AND company_id IS NULL LIMIT 1`,
      );
      if (!tplRes.rows[0]) throw new Error("Seed global template TASK_ASSIGNED không tồn tại");
      globalTaskAssignedTemplateId = tplRes.rows[0].id;

      adminToken = await login(app, A.slug, adminEmail);
      employeeToken = await login(app, A.slug, empEmail);
      adminBToken = await login(app, B.slug, adminBEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    it("(0) migration-smoke: mediaos_app có {SELECT,INSERT,UPDATE} không DELETE; RLS 0479 KHÔNG đổi", async () => {
      for (const table of ["notification_events", "notification_templates"]) {
        const grants = await direct.query<{ privilege_type: string }>(
          `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'mediaos_app' AND table_name = $1`,
          [table],
        );
        const privs = new Set(grants.rows.map((r) => r.privilege_type));
        expect(privs.has("SELECT"), `${table} SELECT`).toBe(true);
        expect(privs.has("INSERT"), `${table} INSERT`).toBe(true);
        expect(privs.has("UPDATE"), `${table} UPDATE`).toBe(true);
        expect(privs.has("DELETE"), `${table} KHÔNG được có DELETE`).toBe(false);

        const pol = await direct.query<{ qual: string; with_check: string | null }>(
          `SELECT qual, with_check FROM pg_policies
          WHERE tablename = $1 AND policyname = 'tenant_isolation'`,
          [table],
        );
        expect(pol.rows[0], `${table} thiếu policy tenant_isolation`).toBeTruthy();
        // USING có "OR company_id IS NULL" (đọc global); WITH CHECK CHỈ company_id=GUC (chặn ghi global).
        expect(pol.rows[0].qual).toMatch(/is null/i);
        expect(pol.rows[0].with_check).toBeTruthy();
        expect(pol.rows[0].with_check).not.toMatch(/is null/i);
      }
    });

    it("(a) employee → PATCH events/:id + templates/:id → 403", async () => {
      const ev = await api(app)
        .patch(`/notifications/events/${globalTaskAssignedEventId}`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ is_enabled: false });
      expect(ev.status).toBe(403);

      const tpl = await api(app)
        .patch(`/notifications/templates/${globalTaskAssignedTemplateId}`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ title_template: "x" });
      expect(tpl.status).toBe(403);
    });

    it("(b) admin A → toggle GLOBAL event off → override company_id=A; global row nguyên (2 chiều)", async () => {
      const res = await api(app)
        .patch(`/notifications/events/${globalTaskAssignedEventId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ is_enabled: false });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.is_enabled).toBe(false);
      expect(res.body.data.company_id).toBe(A.companyId);
      expect(res.body.data.is_company_override).toBe(true);
      expect(res.body.data.event_code).toBe("TASK_ASSIGNED");

      // GET events (A) phản ánh override tắt.
      const list = await api(app)
        .get("/notifications/events")
        .query({ event_code: "TASK_ASSIGNED", per_page: 100 })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(list.status).toBe(200);
      const item = (
        list.body.data as Array<{
          event_code: string;
          is_enabled: boolean;
          company_id: string | null;
        }>
      ).find((e) => e.event_code === "TASK_ASSIGNED");
      expect(item?.is_enabled).toBe(false);
      expect(item?.company_id).toBe(A.companyId);

      // directPool: hàng GLOBAL vẫn is_enabled=true (KHÔNG bị UPDATE).
      const globalRow = await direct.query<{ is_enabled: boolean }>(
        `SELECT is_enabled FROM notification_events WHERE id = $1`,
        [globalTaskAssignedEventId],
      );
      expect(globalRow.rows[0].is_enabled).toBe(true);

      // Đúng 1 override cho (A, TASK_ASSIGNED).
      const overrides = await direct.query(
        `SELECT id FROM notification_events WHERE company_id = $1 AND event_code = 'TASK_ASSIGNED' AND deleted_at IS NULL`,
        [A.companyId],
      );
      expect(overrides.rows.length).toBe(1);
    });

    it("(c) admin A → PATCH template GLOBAL body chứa '{password}' → 422, DB không đổi", async () => {
      const res = await api(app)
        .patch(`/notifications/templates/${globalTaskAssignedTemplateId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ body_template: "Mật khẩu của bạn là {password}" });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error?.code ?? res.body.code).toBe("NOTI-ERR-TEMPLATE-FORBIDDEN-VARIABLE");

      // KHÔNG có override (A, template_code) — dùng template_code global để so.
      const overrides = await direct.query(
        `SELECT id FROM notification_templates
        WHERE company_id = $1 AND template_code = 'TASK_ASSIGNED__IN_APP__vi-VN' AND deleted_at IS NULL`,
        [A.companyId],
      );
      expect(overrides.rows.length).toBe(0);

      // Hàng global body_template KHÔNG đổi.
      const globalRow = await direct.query<{ body_template: string }>(
        `SELECT body_template FROM notification_templates WHERE id = $1`,
        [globalTaskAssignedTemplateId],
      );
      expect(globalRow.rows[0].body_template).not.toMatch(/\{password\}/);
    });

    it("(d) admin A → PATCH template GLOBAL hợp lệ → 200, 1 override; GET override trả nội dung mới; global nguyên", async () => {
      const newTitle = `Task mới cho bạn (A ${randomUUID().slice(0, 6)})`;
      const res = await api(app)
        .patch(`/notifications/templates/${globalTaskAssignedTemplateId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title_template: newTitle });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.title_template).toBe(newTitle);
      expect(res.body.data.company_id).toBe(A.companyId);
      expect(res.body.data.is_company_override).toBe(true);
      expect(res.body.data.template_code).toBe("TASK_ASSIGNED__IN_APP__vi-VN");
      const overrideId = res.body.data.id as string;

      // Đúng 1 override company_id=A cho template_code.
      const overrides = await direct.query(
        `SELECT id FROM notification_templates
        WHERE company_id = $1 AND template_code = 'TASK_ASSIGNED__IN_APP__vi-VN' AND deleted_at IS NULL`,
        [A.companyId],
      );
      expect(overrides.rows.length).toBe(1);
      expect(overrides.rows[0].id).toBe(overrideId);

      // GET override id trả nội dung mới.
      const getRes = await api(app)
        .get(`/notifications/templates/${overrideId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.title_template).toBe(newTitle);

      // Hàng global title_template nguyên (KHÔNG bị ghi đè).
      const globalRow = await direct.query<{ title_template: string }>(
        `SELECT title_template FROM notification_templates WHERE id = $1`,
        [globalTaskAssignedTemplateId],
      );
      expect(globalRow.rows[0].title_template).not.toBe(newTitle);

      // Re-PATCH cùng template (global id) → CẬP NHẬT override có sẵn, KHÔNG tạo thêm row (idempotent override).
      const newTitle2 = `${newTitle} v2`;
      const res2 = await api(app)
        .patch(`/notifications/templates/${globalTaskAssignedTemplateId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title_template: newTitle2 });
      expect(res2.status).toBe(200);
      expect(res2.body.data.id).toBe(overrideId);
      expect(res2.body.data.title_template).toBe(newTitle2);
      const overrides2 = await direct.query(
        `SELECT id FROM notification_templates
        WHERE company_id = $1 AND template_code = 'TASK_ASSIGNED__IN_APP__vi-VN' AND deleted_at IS NULL`,
        [A.companyId],
      );
      expect(overrides2.rows.length).toBe(1);
    });

    it("(e) cross-tenant: admin B → GET events thấy GLOBAL enabled (company_id=null), KHÔNG thấy override A", async () => {
      const res = await api(app)
        .get("/notifications/events")
        .query({ event_code: "TASK_ASSIGNED", per_page: 100 })
        .set("Authorization", `Bearer ${adminBToken}`);
      expect(res.status).toBe(200);
      const item = (
        res.body.data as Array<{
          event_code: string;
          is_enabled: boolean;
          company_id: string | null;
        }>
      ).find((e) => e.event_code === "TASK_ASSIGNED");
      expect(item, "B phải thấy event TASK_ASSIGNED (global)").toBeTruthy();
      // B chưa override → thấy GLOBAL enabled, company_id null (KHÔNG rò override tắt của A).
      expect(item?.is_enabled).toBe(true);
      expect(item?.company_id).toBeNull();
    });

    it("(f) admin A → PATCH id không tồn tại → 404", async () => {
      const ev = await api(app)
        .patch(`/notifications/events/${randomUUID()}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ is_enabled: false });
      expect(ev.status).toBe(404);

      const tpl = await api(app)
        .patch(`/notifications/templates/${randomUUID()}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title_template: "x" });
      expect(tpl.status).toBe(404);
    });
  },
);
