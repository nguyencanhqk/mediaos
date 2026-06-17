/**
 * AC-4 UI config — HTTP deny-path qua FULL guard pipeline (supertest + Nest app thật).
 * RED-first: routes /settings/branding|ui-navigation|i18n-overrides + permission view/manage chưa tồn
 * tại tới khi AC-4 GREEN.
 *
 * Chốt fail-closed (PRD §5.y — is_sensitive=FALSE, grant company-admin tường minh là đủ):
 *  (a) user KHÔNG có view:branding → GET /settings/branding 403; KHÔNG có manage:branding → PUT 403.
 *  (b) tương tự manage:ui-navigation, manage:i18n-override cho PUT navigation/i18n.
 *  (c) company-admin (grant tường minh) → 200 (KHÔNG đòi per-object grant / re-auth — chống TRAP
 *      requiresReauth). is_sensitive=false ⇒ route không kích reveal-class.
 *  (d) wildcard *:* KHÔNG cần để qua: company-admin grant TƯỜNG MINH là đủ; user generic KHÔNG grant → 403.
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
  return r.rows[0]?.id as string;
}

/** Login + trả accessToken cho user (đường JWT thường). */
async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app).post("/auth/login").send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.accessToken as string;
}

describe.skipIf(!hasDb)("AC-4 UI config HTTP deny-path", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  // user có ĐẦY ĐỦ grant ui-config (mirror company-admin) — kỳ vọng 200.
  let adminEmail: string;
  let adminToken: string;
  // user generic KHÔNG có grant nào về ui-config — kỳ vọng 403.
  let genericEmail: string;
  let genericToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "uicfgDeny");
    companyIds.push(A.companyId);

    const pw = await new PasswordService().hash(PASSWORD);

    const viewBranding = await permId(direct, "view", "branding");
    const manageBranding = await permId(direct, "manage", "branding");
    const manageNav = await permId(direct, "manage", "ui-navigation");
    const manageI18n = await permId(direct, "manage", "i18n-override");

    // admin: role có cả 4 perm ui-config (mirror grant company-admin tường minh — KHÔNG wildcard).
    adminEmail = `uicfg-admin-${randomUUID().slice(0, 8)}@a.test`;
    const adminUser = await seedUser(direct, A.companyId, adminEmail, pw);
    const adminRole = await seedRole(direct, A.companyId, `uicfg-admin-${randomUUID().slice(0, 8)}`);
    for (const p of [viewBranding, manageBranding, manageNav, manageI18n]) {
      await seedRolePermission(direct, adminRole, p, "ALLOW");
    }
    await seedUserRole(direct, adminUser, adminRole, A.companyId);
    adminToken = await login(app, A.slug, adminEmail);

    // generic: role rỗng → KHÔNG grant ui-config nào (fail-closed → 403).
    genericEmail = `uicfg-generic-${randomUUID().slice(0, 8)}@a.test`;
    const genericUser = await seedUser(direct, A.companyId, genericEmail, pw);
    const emptyRole = await seedRole(direct, A.companyId, `uicfg-empty-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, genericUser, emptyRole, A.companyId);
    genericToken = await login(app, A.slug, genericEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
  });

  // (a) branding deny
  it("(a) user thiếu view:branding → GET /settings/branding 403", async () => {
    const res = await api(app)
      .get("/settings/branding")
      .set("Authorization", `Bearer ${genericToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("(a) user thiếu manage:branding → PUT /settings/branding 403", async () => {
    const res = await api(app)
      .put("/settings/branding")
      .set("Authorization", `Bearer ${genericToken}`)
      .send({ primaryColor: "#112233" });
    expect(res.status).toBe(403);
  });

  // (b) navigation + i18n deny
  it("(b) user thiếu manage:ui-navigation → PUT /settings/ui-navigation 403", async () => {
    const res = await api(app)
      .put("/settings/ui-navigation")
      .set("Authorization", `Bearer ${genericToken}`)
      .send({ items: [] });
    expect(res.status).toBe(403);
  });

  it("(b) user thiếu manage:i18n-override → PUT /settings/i18n-overrides 403", async () => {
    const res = await api(app)
      .put("/settings/i18n-overrides")
      .set("Authorization", `Bearer ${genericToken}`)
      .send({ overrides: [] });
    expect(res.status).toBe(403);
  });

  // (c) company-admin grant tường minh → 200 (KHÔNG đòi per-object grant / re-auth — chống TRAP).
  it("(c) admin có view:branding → GET /settings/branding 200 (is_sensitive=false, KHÔNG re-auth)", async () => {
    const res = await api(app)
      .get("/settings/branding")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("(c) admin có manage:branding → PUT /settings/branding 200 (KHÔNG đòi step-up)", async () => {
    const res = await api(app)
      .put("/settings/branding")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ primaryColor: "#0a0a0a", companyName: "Admin Co" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.primaryColor).toBe("#0a0a0a");
  });

  it("(c) admin manage:ui-navigation → PUT /settings/ui-navigation 200", async () => {
    const res = await api(app)
      .put("/settings/ui-navigation")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        items: [
          {
            key: "home",
            label: "Trang chủ",
            route: "/",
            icon: null,
            parentKey: null,
            displayOrder: 0,
            moduleKey: null,
            isVisible: true,
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("(c) admin manage:i18n-override → PUT /settings/i18n-overrides 200", async () => {
    const res = await api(app)
      .put("/settings/i18n-overrides")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        overrides: [{ locale: "vi", namespace: "common", key: "greet", value: "Xin chào" }],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  // (d) input rác → 400 (Zod boundary) cho admin có quyền (validate TRƯỚC khi ghi).
  it("(d) admin PUT branding màu KHÔNG hex → 400 (Zod reject tại boundary)", async () => {
    const res = await api(app)
      .put("/settings/branding")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ primaryColor: "not-a-color" });
    expect(res.status).toBe(400);
  });

  // (d) unauthenticated → 401 (KHÔNG token).
  it("(d) KHÔNG token → GET /settings/branding 401", async () => {
    const res = await api(app).get("/settings/branding");
    expect(res.status).toBe(401);
  });
});
