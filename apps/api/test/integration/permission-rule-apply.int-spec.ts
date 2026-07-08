/**
 * S2-AUTH-PERMRULE-1 — POST /auth/roles/:id/permissions/apply-rule (rule builder).
 *
 * Bung 1 LUẬT (match catalog × action-preset × scope) → grant khớp; dryRun xem trước (0 ghi), áp thật
 * ghi qua assignPermissionToRole (audit + anti-escalation). Gate assign:permission isSensitive
 * (company-admin). Crown-jewel → FULL gate; test 2-tenant chứng minh cô lập (BẤT BIẾN #1).
 *
 * Phủ (RED-trước → GREEN):
 *   P1  admin dryRun read-only trên ['employee'] → preview có toAdd, applied=null, 0 row DB ghi.
 *   P2  admin áp thật → role_permissions nhận grant ALLOW/Company đúng số toAdd + 1 audit RolePermissionRuleApplied.
 *   N1  employee (0008 — KHÔNG assign:permission) → 403 (cả dryRun).
 *   N2  system role (0008) → 400 (isSystem block).
 *   N3  cross-tenant: adminB áp lên role của tenant A → 404 + 0 write + 0 audit trên role A (KHÔNG leak).
 *   N4  includeSensitive & resourceTypes=[] → 400 (chống gán mọi quyền nhạy cảm).
 *
 * Integration Postgres THẬT, DB CÔ LẬP. Gate cứng `hasDb && LANE_DB` (integration-test-lane-db-gate).
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
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const LOGIN_PW = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // có assign:permission (seed 0460)
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG assign:permission + is_system

const runDb = hasDb && Boolean(process.env.LANE_DB);
const TAG = randomUUID().slice(0, 8);

const READ_ONLY_RULE = {
  match: {
    resourceTypes: ["employee"],
    actionPreset: "read-only",
    actions: [],
    includeSensitive: false,
  },
  effect: "ALLOW",
  dataScope: "Company",
} as const;

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
async function grantCount(direct: Pool, roleId: string): Promise<number> {
  const r = await direct.query(`SELECT count(*)::int n FROM role_permissions WHERE role_id = $1`, [
    roleId,
  ]);
  return r.rows[0].n as number;
}
async function ruleAuditCount(direct: Pool, roleId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int n FROM audit_logs WHERE action = 'RolePermissionRuleApplied' AND object_id = $1`,
    [roleId],
  );
  return r.rows[0].n as number;
}

describe.skipIf(!runDb)("S2-AUTH-PERMRULE-1 POST /auth/roles/:id/permissions/apply-rule", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let adminToken: string;
  let employeeToken: string;
  let adminBToken: string;
  let roleDry: string;
  let roleApply: string;
  let roleXtenant: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();
    const pw = await new PasswordService().hash(LOGIN_PW);

    // ── Tenant A ──────────────────────────────────────────────────────────────
    A = await seedCompany(direct, "permrule");
    companyIds.push(A.companyId);
    const adminEmail = `adm-${TAG}@pr.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);
    const empEmail = `emp-${TAG}@pr.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

    roleDry = await seedRole(direct, A.companyId, `pr-dry-${TAG}`);
    roleApply = await seedRole(direct, A.companyId, `pr-apply-${TAG}`);
    roleXtenant = await seedRole(direct, A.companyId, `pr-xt-${TAG}`);

    // ── Tenant B (cross-tenant, BẤT BIẾN #1) ────────────────────────────────────
    B = await seedCompany(direct, "permruleb");
    companyIds.push(B.companyId);
    const adminBEmail = `admb-${TAG}@prb.test`;
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

  it("P1 — dryRun read-only ['employee']: preview có toAdd, applied=null, 0 row DB ghi", async () => {
    const before = await grantCount(direct, roleDry);
    const res = await api(app)
      .post(`/auth/roles/${roleDry}/permissions/apply-rule`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...READ_ONLY_RULE, dryRun: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const p = res.body.data;
    expect(p.dryRun).toBe(true);
    expect(p.applied).toBeNull();
    expect(p.toAdd.length).toBeGreaterThanOrEqual(1);
    for (const g of p.toAdd) {
      expect(g.resourceType).toBe("employee");
      expect(g.action).toMatch(/^(view|read|list)(-|$)/);
      expect(g.dataScope).toBe("Company");
    }
    // dryRun KHÔNG ghi.
    expect(await grantCount(direct, roleDry)).toBe(before);
    expect(await ruleAuditCount(direct, roleDry)).toBe(0);
  });

  it("P2 — áp thật: role_permissions nhận grant ALLOW/Company đúng số toAdd + 1 audit summary", async () => {
    // Lấy số toAdd kỳ vọng qua dryRun trước.
    const dry = await api(app)
      .post(`/auth/roles/${roleApply}/permissions/apply-rule`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...READ_ONLY_RULE, dryRun: true });
    const expected = dry.body.data.counts.toAdd as number;
    expect(expected).toBeGreaterThanOrEqual(1);

    const res = await api(app)
      .post(`/auth/roles/${roleApply}/permissions/apply-rule`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...READ_ONLY_RULE, dryRun: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const p = res.body.data;
    expect(p.dryRun).toBe(false);
    expect(Array.isArray(p.applied)).toBe(true);
    expect(p.applied.every((a: { status: string }) => a.status === "ok")).toBe(true);

    // DB: đúng số grant, đều ALLOW + Company.
    const rows = await direct.query(
      `SELECT effect, data_scope FROM role_permissions WHERE role_id = $1`,
      [roleApply],
    );
    expect(rows.rowCount).toBe(expected);
    for (const row of rows.rows) {
      expect(row.effect).toBe("ALLOW");
      expect(row.data_scope).toBe("Company");
    }
    // Đúng 1 audit summary.
    expect(await ruleAuditCount(direct, roleApply)).toBe(1);
  });

  it("N1 — employee (không assign:permission) → 403 (kể cả dryRun)", async () => {
    const res = await api(app)
      .post(`/auth/roles/${roleDry}/permissions/apply-rule`)
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({ ...READ_ONLY_RULE, dryRun: true });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("N2 — system role (0008) → 400 (KHÔNG áp lên vai trò hệ thống)", async () => {
    const res = await api(app)
      .post(`/auth/roles/${EMPLOYEE_ROLE}/permissions/apply-rule`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...READ_ONLY_RULE, dryRun: false });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it("N3 — cross-tenant: adminB áp lên role tenant A → 404 + 0 write + 0 audit (KHÔNG leak)", async () => {
    const beforeGrants = await grantCount(direct, roleXtenant);
    const beforeAudit = await ruleAuditCount(direct, roleXtenant);
    for (const dryRun of [true, false]) {
      const res = await api(app)
        .post(`/auth/roles/${roleXtenant}/permissions/apply-rule`)
        .set("Authorization", `Bearer ${adminBToken}`)
        .send({ ...READ_ONLY_RULE, dryRun });
      expect(res.status, `dryRun=${dryRun}: ${JSON.stringify(res.body)}`).toBe(404);
    }
    // KHÔNG ghi/audit gì lên role của tenant A.
    expect(await grantCount(direct, roleXtenant)).toBe(beforeGrants);
    expect(await ruleAuditCount(direct, roleXtenant)).toBe(beforeAudit);
  });

  it("N4 — includeSensitive & resourceTypes=[] → 400 (chống gán mọi quyền nhạy cảm 1 phát)", async () => {
    const res = await api(app)
      .post(`/auth/roles/${roleDry}/permissions/apply-rule`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        match: {
          resourceTypes: [],
          actionPreset: "read-only",
          actions: [],
          includeSensitive: true,
        },
        effect: "ALLOW",
        dataScope: "Company",
        dryRun: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });
});
