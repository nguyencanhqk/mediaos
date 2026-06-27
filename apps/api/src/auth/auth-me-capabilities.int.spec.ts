/**
 * S2-AUTH-BE-5 / FIX-1-CAP-EXPOSE — /auth/me phơi cặp NHẠY CẢM trong allowlist ('view:audit-log') vào
 * `capabilities` để FE useCan('view','audit-log') hoạt động THẬT.
 *
 * BỐI CẢNH (vòng sửa): getCapabilities() CỐ Ý lọc bỏ MỌI grant sensitive ⇒ trước fix, capabilities của
 * /auth/me KHÔNG BAO GIỜ chứa 'view:audit-log' ⇒ FE viewer (LoginLogsPage/SecurityEventsPage) luôn render
 * forbidden NGAY CẢ với company-admin (đã grant mig 0340). FIX surface CÓ KIỂM SOÁT đúng cặp allowlist —
 * KHÔNG nới enforcement (cổng thật vẫn là PermissionGuard per-resource, đã test ở auth-logs-viewer.int.spec).
 *
 * Integration trên Postgres THẬT, DB CÔ LẬP (mediaos_<lane>, CLAUDE §9.5). Gate cứng `hasDb && LANE_DB`
 * (memory integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB ⇒ đỏ-giả trên DB dev chung.
 * Colocated trong src/auth → vitest gom qua include glob spec của src (xuất hiện trong run summary).
 *
 * Phủ (RED-trước → GREEN):
 *   P1  company-admin (role 0001, grant view:audit-log mig 0340) → me.capabilities['view:audit-log'] === true.
 *   N2  employee (role 0008) + wildcard '*:*' (non-sensitive ALLOW) → KHÔNG có key 'view:audit-log'
 *       (wildcard nhạy-cảm KHÔNG kế thừa — mirror sensitive gate can()); '*:*' VẪN có (non-sensitive surface).
 *   N3  employee (role 0008) trơn → KHÔNG có key 'view:audit-log' (deny-default).
 *
 * PIN theo CẶP SEED THẬT ('view','audit-log') — KHÔNG theo mã FE AUTH.AUDIT_LOG.VIEW (drift S1-FND-MODULE).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "./password.service";
import { appPool, directPool, hasDb } from "../../test/helpers/integration-db";
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

// Credential test (KHÔNG phải secret thật) — tránh literal gán-keyword (guard-secrets, BẤT BIẾN #3).
const LOGIN_PW = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // có ('view','audit-log') (mig 0340)
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có ('view','audit-log')

/** Cặp seed THẬT (mig 0340: is_sensitive=true). Key map = "action:resourceType". */
const AUDIT_LOG_CAP_KEY = "view:audit-log";
const WILDCARD_CAP_KEY = "*:*";

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane (KHÔNG phải DB dev chung). */
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

async function meCapabilities(
  app: INestApplication,
  token: string,
): Promise<Record<string, boolean>> {
  const res = await api(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.capabilities as Record<string, boolean>;
}

describe.skipIf(!runDb)("S2-AUTH-BE-5 FIX-1-CAP-EXPOSE /auth/me allowlisted sensitive caps", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let adminToken: string;
  let wildcardToken: string;
  let employeeToken: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "mecap");
    companyIds.push(A.companyId);
    const pw = await new PasswordService().hash(LOGIN_PW);

    // P1: company-admin — role 0001 có grant view:audit-log (mig 0340).
    const adminEmail = `adm-${TAG}@a.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

    // N2: employee + wildcard '*:*' non-sensitive ALLOW — chứng minh wildcard KHÔNG kế thừa cặp nhạy cảm.
    const wildEmail = `wild-${TAG}@a.test`;
    const wild = await seedUser(direct, A.companyId, wildEmail, pw);
    await seedUserRole(direct, wild, EMPLOYEE_ROLE, A.companyId);
    const wildRole = await seedRole(direct, A.companyId, `wild-${TAG}`);
    const wildPerm = await seedPermissionCatalog(direct, "*", "*", false);
    await seedRolePermission(direct, wildRole, wildPerm, "ALLOW");
    await seedUserRole(direct, wild, wildRole, A.companyId);

    // N3: employee trơn (role 0008) — không có grant view:audit-log.
    const empEmail = `emp-${TAG}@a.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

    adminToken = await login(app, A.slug, adminEmail);
    wildcardToken = await login(app, A.slug, wildEmail);
    employeeToken = await login(app, A.slug, empEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  it("P1 — company-admin /auth/me → capabilities['view:audit-log'] === true", async () => {
    const caps = await meCapabilities(app, adminToken);
    expect(caps[AUDIT_LOG_CAP_KEY]).toBe(true);
  });

  it("N2 — employee + wildcard '*:*' → KHÔNG có 'view:audit-log' (sensitive không kế thừa), '*:*' vẫn có", async () => {
    const caps = await meCapabilities(app, wildcardToken);
    expect(caps[WILDCARD_CAP_KEY]).toBe(true); // non-sensitive wildcard vẫn surface
    expect(AUDIT_LOG_CAP_KEY in caps).toBe(false); // sensitive KHÔNG kế thừa qua *:*
  });

  it("N3 — employee trơn → KHÔNG có 'view:audit-log' (deny-default)", async () => {
    const caps = await meCapabilities(app, employeeToken);
    expect(AUDIT_LOG_CAP_KEY in caps).toBe(false);
  });
});
