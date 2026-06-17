/**
 * AC-8 — Observability HTTP deny-path (DB cô lập mediaos_ac8). Supertest + Nest app thật → guard pipeline.
 *
 *  (d) UNAUTHENTICATED (no JWT) → 401 trên cả 3 endpoint (tenant audit + platform audit + queue).
 *  (a) tenant token KHÔNG có view:audit-log → 403 GET /tenant/audit.
 *  (a2) tenant token (không phải operator) → 401/403 GET /admin/platform/audit + /admin/platform/queue
 *       (@OperatorOnly: token aud=tenant bị 401 audience).
 *  (c) company-admin (có view:audit-log) → 200 GET /tenant/audit (đường thuận tenant-self).
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
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const PASSWORD = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001";

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function permId(direct: Pool, action: string, resourceType: string): Promise<string> {
  const r = await direct.query(
    `SELECT id FROM permissions WHERE action=$1 AND resource_type=$2 LIMIT 1`,
    [action, resourceType],
  );
  return r.rows[0].id as string;
}

async function loginToken(
  app: INestApplication,
  direct: Pool,
  slug: string,
  userId: string,
): Promise<string> {
  const email = (await direct.query(`SELECT email FROM users WHERE id=$1`, [userId])).rows[0]
    .email as string;
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.accessToken as string;
}

describe.skipIf(!hasDb)("AC-8 observability HTTP deny-path", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let auditViewerToken: string; // company-admin của A (view:audit-log)
  let noGrantToken: string; // user A KHÔNG có audit grant
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "obsHttpA");
    companyIds.push(A.companyId);

    const viewAuditPerm = await permId(direct, "view", "audit-log");
    const pw = await new PasswordService().hash(PASSWORD);

    // company-admin (đã grant view:audit-log qua mig 0340) + thêm tường minh để chắc chắn.
    const caUser = await seedUser(direct, A.companyId, `ca-${randomUUID().slice(0, 8)}@a.test`, pw);
    await seedUserRole(direct, caUser, COMPANY_ADMIN_ROLE, A.companyId);
    const viewerRole = await seedRole(direct, A.companyId, `audit-viewer-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, viewerRole, viewAuditPerm, "ALLOW");
    await seedUserRole(direct, caUser, viewerRole, A.companyId);

    // no-grant user.
    const ngUser = await seedUser(direct, A.companyId, `ng-${randomUUID().slice(0, 8)}@a.test`, pw);
    const emptyRole = await seedRole(direct, A.companyId, `empty-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, ngUser, emptyRole, A.companyId);

    auditViewerToken = await loginToken(app, direct, A.slug, caUser);
    noGrantToken = await loginToken(app, direct, A.slug, ngUser);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // (d) unauthenticated → 401.
  it("(d) GET /tenant/audit không JWT → 401", async () => {
    const res = await api(app).get("/tenant/audit");
    expect(res.status).toBe(401);
  });

  it("(d) GET /admin/platform/audit không JWT → 401", async () => {
    const res = await api(app).get("/admin/platform/audit");
    expect(res.status).toBe(401);
  });

  it("(d) GET /admin/platform/queue không JWT → 401", async () => {
    const res = await api(app).get("/admin/platform/queue");
    expect(res.status).toBe(401);
  });

  // (a) tenant token thiếu view:audit-log → 403.
  it("(a) GET /tenant/audit thiếu view:audit-log → 403", async () => {
    const res = await api(app).get("/tenant/audit").set("Authorization", `Bearer ${noGrantToken}`);
    expect(res.status).toBe(403);
  });

  // (a2) tenant token (aud=tenant) trên route @OperatorOnly → 401 audience.
  it("(a2) tenant token trên GET /admin/platform/audit (@OperatorOnly) → 401", async () => {
    const res = await api(app)
      .get("/admin/platform/audit")
      .set("Authorization", `Bearer ${auditViewerToken}`);
    expect(res.status).toBe(401);
  });

  it("(a2) tenant token trên GET /admin/platform/queue (@OperatorOnly) → 401", async () => {
    const res = await api(app)
      .get("/admin/platform/queue")
      .set("Authorization", `Bearer ${auditViewerToken}`);
    expect(res.status).toBe(401);
  });

  // (c) company-admin có view:audit-log → 200 đường thuận tenant-self.
  it("(c) GET /tenant/audit company-admin (view:audit-log) → 200", async () => {
    const res = await api(app)
      .get("/tenant/audit")
      .set("Authorization", `Bearer ${auditViewerToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.data)).toBe(true);
  });
});
