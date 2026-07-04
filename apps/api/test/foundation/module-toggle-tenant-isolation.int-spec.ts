/**
 * S2-FND-BE-8 (be-module-toggle) — 2-tenant isolation ĐÚNG TRỤC (LANE_DB). company_settings là TENANT-SCOPED
 * (RLS+FORCE) ⇒ actor tenant A toggle module X off KHÔNG được rò sang tenant B.
 *
 * KHÁC system-setting (GLOBAL no-RLS — sai trục để test isolation): module.<code>.enabled ghi vào
 * company_settings keyed company_id ⇒ đây là trục ĐÚNG để chứng minh cô lập tenant (BẤT BIẾN #1).
 *
 * Phủ (RED-trước → GREEN):
 *   X1  A (grant EXACT update:foundation-module) toggle PAYROLL off → 200.
 *   X2  getAllModules(A) → PAYROLL enabled=false; getAllModules(B) → PAYROLL enabled=true (B KHÔNG đổi).
 *   X3  company_settings: A có 1 hàng 'module.PAYROLL.enabled'=false; B có 0 hàng (0 cross-tenant write).
 *   X4  audit: đúng 1 audit object_type='module' của A; B có 0 audit 'module' (ghi ở home-tenant A).
 *   X5  getMyApps(B) → 200 (bề mặt app của B nguyên vẹn — KHÔNG rò cờ enabled của A). PAYROLL non-core
 *       INACTIVE + KHÔNG có MODULE_APP_METADATA ⇒ không xuất hiện trong my-apps của bất kỳ ai; isolation
 *       cờ enabled được chứng minh qua getAllModules (cùng SettingService.resolveMany, keyed tenant).
 *
 * Postgres THẬT (DB cô lập mediaos_<lane>). Gate `hasDb && LANE_DB`.
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
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const PASSWORD = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // bulk-grant view:foundation-module (mig 0435)
const NON_CORE = "PAYROLL";

const runDb = hasDb && Boolean(process.env.LANE_DB);

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

async function settingCount(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM company_settings WHERE company_id = $1 AND setting_key = $2",
    [companyId, `module.${NON_CORE}.enabled`],
  );
  return r.rows[0].n as number;
}

async function moduleAuditCount(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND object_type = 'module'",
    [companyId],
  );
  return r.rows[0].n as number;
}

function enabledOf(body: { data: Array<{ module_code: string; enabled: boolean }> }): boolean {
  return body.data.find((r) => r.module_code === NON_CORE)!.enabled;
}

describe.skipIf(!runDb)(
  "S2-FND-BE-8 module-toggle 2-tenant isolation (company_settings RLS)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    let exactAToken: string; // A: EXACT update + view:foundation-module
    let adminBToken: string; // B: company-admin (view:foundation-module) — đọc catalog B
    const companyIds: string[] = [];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();

      A = await seedCompany(direct, "mtogisoa");
      B = await seedCompany(direct, "mtogisob");
      companyIds.push(A.companyId, B.companyId);
      const pw = await new PasswordService().hash(PASSWORD);

      // A — role riêng EXACT update:foundation-module (sensitive) + view (đọc catalog A).
      const exEmail = `ex-${randomUUID().slice(0, 8)}@a.test`;
      const ex = await seedUser(direct, A.companyId, exEmail, pw);
      const exRole = await seedRole(direct, A.companyId, `ex-${randomUUID().slice(0, 8)}`);
      const updPerm = await seedPermissionCatalog(direct, "update", "foundation-module", true);
      const viewPerm = await seedPermissionCatalog(direct, "view", "foundation-module", false);
      await seedRolePermission(direct, exRole, updPerm, "ALLOW");
      await seedRolePermission(direct, exRole, viewPerm, "ALLOW");
      await seedUserRole(direct, ex, exRole, A.companyId);

      // B — company-admin (view:foundation-module qua bulk-grant) để đọc getAllModules(B).
      const adminBEmail = `adm-${randomUUID().slice(0, 8)}@b.test`;
      const adminB = await seedUser(direct, B.companyId, adminBEmail, pw);
      await seedUserRole(direct, adminB, COMPANY_ADMIN_ROLE, B.companyId);

      exactAToken = await login(app, A.slug, exEmail);
      adminBToken = await login(app, B.slug, adminBEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    it("X — A toggle PAYROLL off KHÔNG rò sang B (company_settings RLS + audit home-tenant)", async () => {
      // X1: A toggle off → 200.
      const toggle = await api(app)
        .patch(`/foundation/modules/${NON_CORE}`)
        .set("Authorization", `Bearer ${exactAToken}`)
        .send({ enabled: false });
      expect(toggle.status, JSON.stringify(toggle.body)).toBe(200);
      expect(toggle.body.data.enabled).toBe(false);

      // X2: getAllModules(A) enabled=false; getAllModules(B) enabled=true (B KHÔNG bị ảnh hưởng).
      const listA = await api(app)
        .get("/foundation/modules")
        .set("Authorization", `Bearer ${exactAToken}`);
      expect(listA.status).toBe(200);
      expect(enabledOf(listA.body)).toBe(false);

      const listB = await api(app)
        .get("/foundation/modules")
        .set("Authorization", `Bearer ${adminBToken}`);
      expect(listB.status).toBe(200);
      expect(enabledOf(listB.body)).toBe(true); // B mặc định true — KHÔNG rò override của A

      // X3: company_settings — A có 1 hàng; B có 0 hàng (0 cross-tenant write).
      expect(await settingCount(direct, A.companyId)).toBe(1);
      expect(await settingCount(direct, B.companyId)).toBe(0);

      // X4: audit — A đúng 1 hàng object_type='module'; B 0 hàng (ghi ở home-tenant A).
      expect(await moduleAuditCount(direct, A.companyId)).toBe(1);
      expect(await moduleAuditCount(direct, B.companyId)).toBe(0);

      // X5: getMyApps(B) vẫn 200 (bề mặt app B nguyên vẹn — KHÔNG rò cờ enabled của A).
      const myAppsB = await api(app)
        .get("/foundation/modules/my-apps")
        .set("Authorization", `Bearer ${adminBToken}`);
      expect(myAppsB.status).toBe(200);
      expect(Array.isArray(myAppsB.body.data)).toBe(true);
    });
  },
);
