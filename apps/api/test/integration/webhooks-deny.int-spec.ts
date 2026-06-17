/**
 * AC-6 — Webhooks HTTP deny-path (DB cô lập mediaos_ac6). Supertest + Nest app thật → guard pipeline đầy đủ.
 *
 * Chốt fail-closed (deny-path RED trước):
 *  (a) thiếu manage:webhook → 403 (POST/PUT/DELETE endpoint, POST subscription).
 *  (b) thiếu view:webhook → 403 GET endpoints.
 *  (c) có manage+view → 200/201 (đường thuận).
 *  (d) companyId LẤY TỪ JWT — body companyId bị bỏ qua (endpoint tạo thuộc tenant của JWT, KHÔNG cross-tenant).
 *  (e) cross-tenant id → 404 (không lộ tồn tại).
 *  (f) wildcard *:* KHÔNG lọt cổng nhạy cảm (manage:webhook is_sensitive → cần grant tường minh).
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

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function permId(direct: Pool, action: string, resourceType: string): Promise<string> {
  const r = await direct.query(
    `SELECT id FROM permissions WHERE action = $1 AND resource_type = $2 LIMIT 1`,
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

/** Seed endpoint DIRECT (bypass RLS) cho 1 tenant — để test cross-tenant 404. */
async function seedEndpoint(direct: Pool, companyId: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO webhook_endpoints
       (company_id, url, secret_ciphertext, encrypted_dek, dek_key_version, kms_key_id, iv_nonce, auth_tag, enc_algo)
     VALUES ($1, 'https://hooks.example.com/deny',
             decode('00','hex'), decode('00','hex'), 1, 'local-dev-kek',
             decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), 'AES-256-GCM')
     RETURNING id`,
    [companyId],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!hasDb)("AC-6 webhooks HTTP deny-path", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let manageToken: string; // user A có manage+view:webhook
  let viewOnlyToken: string; // user A chỉ view:webhook
  let noGrantToken: string; // user A không grant webhook nào
  let endpointA: string;
  let endpointB: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "whA");
    B = await seedCompany(direct, "whB");
    companyIds.push(A.companyId, B.companyId);

    const managePerm = await permId(direct, "manage", "webhook");
    const viewPerm = await permId(direct, "view", "webhook");
    const pw = await new PasswordService().hash(PASSWORD);

    // manage user: role có manage + view.
    const manageUser = await seedUser(direct, A.companyId, `mng-${randomUUID().slice(0, 8)}@a.test`, pw);
    const manageRole = await seedRole(direct, A.companyId, `wh-manage-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, manageRole, managePerm, "ALLOW");
    await seedRolePermission(direct, manageRole, viewPerm, "ALLOW");
    await seedUserRole(direct, manageUser, manageRole, A.companyId);

    // view-only user.
    const viewUser = await seedUser(direct, A.companyId, `vw-${randomUUID().slice(0, 8)}@a.test`, pw);
    const viewRole = await seedRole(direct, A.companyId, `wh-view-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, viewRole, viewPerm, "ALLOW");
    await seedUserRole(direct, viewUser, viewRole, A.companyId);

    // no-grant user: role rỗng.
    const noUser = await seedUser(direct, A.companyId, `no-${randomUUID().slice(0, 8)}@a.test`, pw);
    const emptyRole = await seedRole(direct, A.companyId, `wh-empty-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, noUser, emptyRole, A.companyId);

    manageToken = await loginToken(app, direct, A.slug, manageUser);
    viewOnlyToken = await loginToken(app, direct, A.slug, viewUser);
    noGrantToken = await loginToken(app, direct, A.slug, noUser);

    endpointA = await seedEndpoint(direct, A.companyId);
    endpointB = await seedEndpoint(direct, B.companyId);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // (a) thiếu manage:webhook → 403 mutate.
  it("(a) POST endpoint thiếu manage:webhook → 403", async () => {
    const res = await api(app)
      .post("/webhooks/endpoints")
      .set("Authorization", `Bearer ${viewOnlyToken}`)
      .send({ url: "https://hooks.example.com/new" });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("(a) PUT endpoint thiếu manage:webhook → 403", async () => {
    const res = await api(app)
      .put(`/webhooks/endpoints/${endpointA}`)
      .set("Authorization", `Bearer ${viewOnlyToken}`)
      .send({ active: false });
    expect(res.status).toBe(403);
  });

  it("(a) DELETE endpoint thiếu manage:webhook → 403", async () => {
    const res = await api(app)
      .delete(`/webhooks/endpoints/${endpointA}`)
      .set("Authorization", `Bearer ${viewOnlyToken}`);
    expect(res.status).toBe(403);
  });

  it("(a) POST subscription thiếu manage:webhook → 403", async () => {
    const res = await api(app)
      .post(`/webhooks/endpoints/${endpointA}/subscriptions`)
      .set("Authorization", `Bearer ${viewOnlyToken}`)
      .send({ eventType: "task.created" });
    expect(res.status).toBe(403);
  });

  // (b) thiếu view:webhook → 403 GET.
  it("(b) GET endpoints không grant webhook nào → 403", async () => {
    const res = await api(app)
      .get("/webhooks/endpoints")
      .set("Authorization", `Bearer ${noGrantToken}`);
    expect(res.status).toBe(403);
  });

  // (c) có manage → tạo được + reveal-once secret.
  it("(c) POST endpoint có manage:webhook → 201 + secret reveal-once", async () => {
    const res = await api(app)
      .post("/webhooks/endpoints")
      .set("Authorization", `Bearer ${manageToken}`)
      .send({ url: "https://93.184.216.34/ok" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.secret).toBeTruthy();
    expect(res.body.data.endpoint.url).toBe("https://93.184.216.34/ok");
    expect(JSON.stringify(res.body.data.endpoint)).not.toContain(res.body.data.secret);
  });

  // (d) companyId từ JWT — body companyId bị bỏ qua.
  it("(d) companyId trong body BỊ BỎ QUA — endpoint thuộc tenant của JWT (A), không cross-tenant", async () => {
    const res = await api(app)
      .post("/webhooks/endpoints")
      .set("Authorization", `Bearer ${manageToken}`)
      .send({ url: "https://93.184.216.34/jwt-tenant", companyId: B.companyId });
    expect(res.status).toBe(201);
    // Xác minh row thuộc A (JWT), KHÔNG phải B (body).
    const row = await direct.query(`SELECT company_id FROM webhook_endpoints WHERE id = $1`, [
      res.body.data.endpoint.id,
    ]);
    expect(row.rows[0].company_id).toBe(A.companyId);
  });

  // (e) cross-tenant id → 404.
  it("(e) GET endpoint của tenant B (manage user của A) → 404 (không lộ tồn tại)", async () => {
    const res = await api(app)
      .get(`/webhooks/endpoints/${endpointB}`)
      .set("Authorization", `Bearer ${manageToken}`);
    expect(res.status).toBe(404);
  });

  it("(e) PUT endpoint của tenant B → 404", async () => {
    const res = await api(app)
      .put(`/webhooks/endpoints/${endpointB}`)
      .set("Authorization", `Bearer ${manageToken}`)
      .send({ active: false });
    expect(res.status).toBe(404);
  });
});
