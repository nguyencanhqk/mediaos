/**
 * S2-AUTH-BE-3 — HTTP int-spec: GET /auth/roles + /auth/permissions (read-only catalogs for assign UI).
 *
 *  §deny  — role rỗng (KHÔNG view:role / view:permission) → 403.
 *  §allow — company-admin (0444 grant view:role + view:permission) → 200 + danh sách.
 *  §no-operator — /auth/roles KHÔNG chứa role operator-audience (platform-admin …f0) — chống leo thang.
 *
 * Gate: hasDb && LANE_DB (DB cô lập theo lane) — thiếu LANE_DB → SKIP để KHÔNG chạm DB dev chung 'mediaos'
 * (.env làm hasDb=true → đỏ-giả/xanh-giả) — CLAUDE.md §9.5, memory integration-test-lane-db-gate.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
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
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const COMPANY_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";
const PLATFORM_ADMIN_ROLE_ID = "00000000-0000-0000-0000-0000000000f0";
const PASSWORD = ["Passw0rd", "Rp", "99"].join("");

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function emailOf(direct: Pool, userId: string): Promise<string> {
  const r = await direct.query(`SELECT email FROM users WHERE id = $1`, [userId]);
  return r.rows[0].email as string;
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.accessToken as string;
}

// Gate hasDb && LANE_DB: thiếu DB lane cô lập → SKIP (KHÔNG chạm 'mediaos' dev chung). CLAUDE.md §9.5.
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("S2-AUTH-BE-3 /auth/roles + /auth/permissions", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let noPermToken: string;
  let adminToken: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "rpa");
    companyIds.push(A.companyId);
    const pw = await hashedPw();

    const noPermId = await seedUser(
      direct,
      A.companyId,
      `rp-np-${randomUUID().slice(0, 8)}@a.test`,
      pw,
    );
    const emptyRole = await seedRole(direct, A.companyId, `rp-empty-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, noPermId, emptyRole, A.companyId);

    const adminId = await seedUser(
      direct,
      A.companyId,
      `rp-admin-${randomUUID().slice(0, 8)}@a.test`,
      pw,
    );
    await seedUserRole(direct, adminId, COMPANY_ADMIN_ROLE_ID, A.companyId);

    noPermToken = await login(app, A.slug, await emailOf(direct, noPermId));
    adminToken = await login(app, A.slug, await emailOf(direct, adminId));
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
  });

  it("GET /auth/roles deny role rỗng → 403", async () => {
    const res = await api(app).get("/auth/roles").set("Authorization", `Bearer ${noPermToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /auth/permissions deny role rỗng → 403", async () => {
    const res = await api(app)
      .get("/auth/permissions")
      .set("Authorization", `Bearer ${noPermToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /auth/roles admin → 200 + KHÔNG chứa role operator platform-admin", async () => {
    const res = await api(app).get("/auth/roles").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.data.roles as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(COMPANY_ADMIN_ROLE_ID);
    expect(ids).not.toContain(PLATFORM_ADMIN_ROLE_ID);
  });

  it("GET /auth/permissions admin → 200 + có 'view:user' catalog", async () => {
    const res = await api(app)
      .get("/auth/permissions")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const perms = res.body.data.permissions as Array<{ action: string; resourceType: string }>;
    expect(perms.some((p) => p.action === "view" && p.resourceType === "user")).toBe(true);
  });
});
