/**
 * S2-FND-BE-1 — ModuleAdminController deny-path / admin-catalog / 2-tenant enabled-flag (integration).
 *
 * Postgres THẬT, DB CÔ LẬP (mediaos_<lane>, CLAUDE §9.5). Gate cứng `hasDb && LANE_DB` (memory
 * integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB ⇒ đỏ-giả trên DB dev chung.
 * Colocated trong src/ → vitest gom qua include glob `src/**\/*.spec.ts`; skipIf(!runDb) ⇒ inert ở unit-run.
 *
 * Phủ (RED-trước → GREEN):
 *   D1  Employee (role 0008, KHÔNG view:foundation-module) → GET /foundation/modules → 403.
 *   D2  Employee → GET /foundation/modules/HR → 403 (gate cả detail).
 *   P3  company-admin A (role 0001, view qua bulk-grant mig 0435) → GET /foundation/modules → 200;
 *       list gồm CẢ module active (HR) VÀ inactive (PAYROLL) — admin thấy hết, KHÁC my-apps.
 *   P4  Detail HR → 200 (route/enabled); code lạ → 404; envelope {success,data}.
 *   X5  2-tenant: A tắt company_settings module.HR.enabled=false → list A trả enabled=false cho HR;
 *       B (không setting) trả enabled=true — KHÔNG rò enabled-flag chéo tenant (SettingService precedence + RLS).
 *   R6  my-apps KHÔNG regress: GET /foundation/modules/my-apps (Authenticated) admin → 200 (route param
 *       KHÔNG nuốt route tĩnh my-apps).
 *
 * PIN theo CẶP SEED THẬT (view, 'foundation-module', is_sensitive=false) — KHÔNG theo nhãn FE (drift-guard).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { AllExceptionsFilter } from "../../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../auth/password.service";
import { directPool, hasDb } from "../../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../../test/helpers/seed";

const LOGIN_PW = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // bulk-grant view:foundation-module (mig 0435)
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có foundation-module

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane (KHÔNG phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

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

/** Chèn 1 company_settings override (direct pool). setting_value jsonb. Dùng để tắt module cho tenant A. */
async function seedCompanySetting(
  direct: Pool,
  companyId: string,
  key: string,
  value: unknown,
  createdBy: string,
): Promise<void> {
  await direct.query(
    `INSERT INTO company_settings
       (company_id, setting_key, setting_value, value_type, category, module_code,
        is_public, is_sensitive, is_encrypted, status, created_by, updated_by)
     VALUES ($1, $2, $3::jsonb, 'Boolean', 'Module', NULL, true, false, false, 'Active', $4, $4)`,
    [companyId, key, JSON.stringify(value), createdBy],
  );
}

describe.skipIf(!runDb)("S2-FND-BE-1 admin module-catalog deny-path / catalog / 2-tenant", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let adminToken: string; // company-admin A (view:foundation-module via bulk-grant)
  let employeeToken: string; // employee A (KHÔNG foundation-module)
  let adminBToken: string; // company-admin B
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "fma");
    B = await seedCompany(direct, "fmb");
    companyIds.push(A.companyId, B.companyId);
    const pw = await new PasswordService().hash(LOGIN_PW);

    const adminEmail = `adm-${randomUUID().slice(0, 8)}@a.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

    const empEmail = `emp-${randomUUID().slice(0, 8)}@a.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

    const adminBEmail = `adm-${randomUUID().slice(0, 8)}@b.test`;
    const adminB = await seedUser(direct, B.companyId, adminBEmail, pw);
    await seedUserRole(direct, adminB, COMPANY_ADMIN_ROLE, B.companyId);

    // Tenant A TẮT module HR (company override). B KHÔNG set → default enabled=true.
    await seedCompanySetting(direct, A.companyId, "module.HR.enabled", false, admin);

    adminToken = await login(app, A.slug, adminEmail);
    employeeToken = await login(app, A.slug, empEmail);
    adminBToken = await login(app, B.slug, adminBEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── D1/D2: Employee KHÔNG grant → 403 ─────────────────────────────────────────
  it("D1 — Employee GET /foundation/modules → 403", async () => {
    const res = await api(app)
      .get("/foundation/modules")
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.data ?? null).toBeNull();
  });

  it("D2 — Employee GET /foundation/modules/HR → 403 (detail cũng gated)", async () => {
    const res = await api(app)
      .get("/foundation/modules/HR")
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
  });

  // ── P3: company-admin → 200, thấy CẢ active + inactive ─────────────────────────
  it("P3 — company-admin GET /foundation/modules → 200; gồm active (HR) VÀ inactive (PAYROLL)", async () => {
    const res = await api(app)
      .get("/foundation/modules")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    const byCode = new Map(rows.map((r) => [r.module_code as string, r]));
    // MVP module active
    expect(byCode.has("HR")).toBe(true);
    expect((byCode.get("HR") as { is_active: boolean }).is_active).toBe(true);
    // Extension module INACTIVE — admin THẤY (khác my-apps).
    expect(byCode.has("PAYROLL")).toBe(true);
    expect((byCode.get("PAYROLL") as { is_active: boolean }).is_active).toBe(false);
    // enabled hiện diện trên mỗi row.
    for (const r of rows) expect(typeof r.enabled).toBe("boolean");
  });

  // ── P4: Detail + 404 ──────────────────────────────────────────────────────────
  it("P4 — GET /foundation/modules/HR → 200 (route/enabled); code lạ → 404", async () => {
    const ok = await api(app)
      .get("/foundation/modules/HR")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.success).toBe(true);
    expect(ok.body.data.module_code).toBe("HR");
    expect(ok.body.data.route).toBe("/hr");
    expect(typeof ok.body.data.enabled).toBe("boolean");

    const missing = await api(app)
      .get("/foundation/modules/NOPE_X")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
  });

  // ── X5: 2-tenant enabled-flag isolation ───────────────────────────────────────
  it("X5 — A tắt module.HR.enabled → A thấy HR enabled=false; B thấy enabled=true (không rò chéo tenant)", async () => {
    const resA = await api(app)
      .get("/foundation/modules")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(resA.status).toBe(200);
    const hrA = (resA.body.data as Array<{ module_code: string; enabled: boolean }>).find(
      (r) => r.module_code === "HR",
    )!;
    expect(hrA.enabled).toBe(false); // A đã override tắt

    const resB = await api(app)
      .get("/foundation/modules")
      .set("Authorization", `Bearer ${adminBToken}`);
    expect(resB.status).toBe(200);
    const hrB = (resB.body.data as Array<{ module_code: string; enabled: boolean }>).find(
      (r) => r.module_code === "HR",
    )!;
    expect(hrB.enabled).toBe(true); // B KHÔNG bị ảnh hưởng bởi override của A
  });

  // ── R6: my-apps KHÔNG regress ─────────────────────────────────────────────────
  it("R6 — GET /foundation/modules/my-apps (Authenticated) admin → 200 (route tĩnh không bị :code nuốt)", async () => {
    const res = await api(app)
      .get("/foundation/modules/my-apps")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
