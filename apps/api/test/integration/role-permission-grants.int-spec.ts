/**
 * S2-AUTH-PERMUX-1 — GET /auth/roles/:id/permissions (RolePermissionsPage v2 đọc trạng thái ĐÃ GÁN).
 *
 * Endpoint READ-ONLY duy nhất thêm mới; gán/thu hồi/đổi-scope tái dùng POST/DELETE
 * /auth/roles/:id/permissions sẵn có (assign:permission isSensitive — đã test role-admin.int-spec).
 * Gate: view:permission (cùng cặp catalog GET /auth/permissions — admin-only theo seed).
 *
 * Phủ:
 *   P1  admin thấy ĐÚNG grants đã seed (gồm 1 row DENY seed thẳng — effect trả đúng) với field đúng.
 *   N1  employee (0008 — KHÔNG có view:permission) → 403.
 *   N2b role company-scope tenant A → admin tenant B gọi ra 404 (RLS roles không thấy).
 *   N3  role UUID lạ → 404.
 *   N5  operator-audience role (platform-admin f0) → 404 (notOperatorRole — chống liệt kê control-plane).
 *
 * Integration Postgres THẬT, gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate).
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

const LOGIN_PW = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // có view:permission
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có view:permission
const PLATFORM_ADMIN_ROLE = "00000000-0000-0000-0000-0000000000f0"; // operator-audience

const runDb = hasDb && Boolean(process.env.LANE_DB);
const TAG = randomUUID().slice(0, 8);

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

describe.skipIf(!runDb)("S2-AUTH-PERMUX-1 GET /auth/roles/:id/permissions", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let adminToken: string;
  let employeeToken: string;
  let adminBToken: string;
  let targetRole: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();
    const pw = await new PasswordService().hash(LOGIN_PW);

    // ── Tenant A ────────────────────────────────────────────────────────────
    A = await seedCompany(direct, "permux");
    companyIds.push(A.companyId);

    const adminEmail = `adm-${TAG}@px.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

    const empEmail = `emp-${TAG}@px.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

    // P1: role company-scope + 2 grant ALLOW (khác scope) + 1 grant DENY seed thẳng.
    targetRole = await seedRole(direct, A.companyId, `px-${TAG}`);
    const pView = await seedPermissionCatalog(direct, "view", `px-res-${TAG}`, false);
    const pUpdate = await seedPermissionCatalog(direct, "update", `px-res-${TAG}`, true);
    const pExport = await seedPermissionCatalog(direct, "export", `px-res-${TAG}`, false);
    await seedRolePermission(direct, targetRole, pView, "ALLOW", "Company");
    await seedRolePermission(direct, targetRole, pUpdate, "ALLOW", "Own");
    await seedRolePermission(direct, targetRole, pExport, "DENY", "Company");

    // ── Tenant B ────────────────────────────────────────────────────────────
    B = await seedCompany(direct, "permuxb");
    companyIds.push(B.companyId);
    const adminBEmail = `admb-${TAG}@pxb.test`;
    const adminB = await seedUser(direct, B.companyId, adminBEmail, pw);
    await seedUserRole(direct, adminB, COMPANY_ADMIN_ROLE, B.companyId);

    adminToken = await login(app, A.slug, adminEmail);
    employeeToken = await login(app, A.slug, empEmail);
    adminBToken = await login(app, B.slug, adminBEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  it("P1 — admin thấy ĐÚNG grants (ALLOW×2 khác scope + DENY×1) với field đúng, không lộ field thừa", async () => {
    const res = await api(app)
      .get(`/auth/roles/${targetRole}/permissions`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const grants = res.body.data.grants as Array<Record<string, unknown>>;
    expect(grants).toHaveLength(3);
    const byKey = new Map(grants.map((g) => [`${g.action}:${g.resourceType}:${g.effect}`, g]));
    expect(byKey.get(`view:px-res-${TAG}:ALLOW`)?.dataScope).toBe("Company");
    expect(byKey.get(`update:px-res-${TAG}:ALLOW`)?.dataScope).toBe("Own");
    expect(byKey.get(`update:px-res-${TAG}:ALLOW`)?.isSensitive).toBe(true);
    expect(byKey.get(`export:px-res-${TAG}:DENY`)?.dataScope).toBe("Company");
    for (const g of grants) {
      expect(Object.keys(g).sort()).toEqual(
        ["action", "dataScope", "effect", "isSensitive", "resourceType"].sort(),
      );
    }
  });

  it("P2 — system role non-operator (company-admin 0001) → 200 (đọc config chung CÓ CHỦ ĐÍCH — pin regression)", async () => {
    const res = await api(app)
      .get(`/auth/roles/${COMPANY_ADMIN_ROLE}/permissions`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body.data.grants)).toBe(true);
    expect((res.body.data.grants as unknown[]).length).toBeGreaterThan(0);
  });

  it("P3 — role 0 grant → grants:[] (không lỗi)", async () => {
    const emptyRole = await seedRole(direct, A.companyId, `px-empty-${TAG}`);
    const res = await api(app)
      .get(`/auth/roles/${emptyRole}/permissions`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.grants).toEqual([]);
  });

  it("N1 — employee (không view:permission) → 403", async () => {
    const res = await api(app)
      .get(`/auth/roles/${targetRole}/permissions`)
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("N2b — role company-scope tenant A → admin tenant B gọi ra 404", async () => {
    const res = await api(app)
      .get(`/auth/roles/${targetRole}/permissions`)
      .set("Authorization", `Bearer ${adminBToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  it("N3 — role UUID lạ → 404", async () => {
    const res = await api(app)
      .get(`/auth/roles/${randomUUID()}/permissions`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  it("N5 — operator-audience role (platform-admin f0) → 404", async () => {
    const res = await api(app)
      .get(`/auth/roles/${PLATFORM_ADMIN_ROLE}/permissions`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });
});
