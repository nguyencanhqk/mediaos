/**
 * S2-AUTH-ROLEMEM-1 — GET /auth/roles/:id/members (tab Thành viên trên RoleDetailPage).
 *
 * Endpoint READ-ONLY duy nhất thêm mới cho tính năng; thêm/gỡ member tái dùng
 * POST/DELETE /permissions/users/:userId/roles (assign-role:user isSensitive — surface cũ, đã test
 * ở permission-admin.int-spec). Gate: view:user (non-sensitive — response là account-level fields
 * như GET /auth/users, KHÔNG PII HR).
 *
 * Membership là PER-TENANT qua user_roles.company_id — system role (company_id NULL) dùng CHUNG
 * cross-tenant nhưng member của tenant A KHÔNG được lộ cho tenant B (BẤT BIẾN #1).
 *
 * Phủ (RED-trước → GREEN):
 *   P1  admin (view:user) sau khi seed 2 user giữ role → thấy ĐÚNG 2 member với field đúng.
 *   N1  employee (0008 — KHÔNG có view:user) → 403.
 *   N2  cross-tenant: CÙNG system role 0008; member tenant A KHÔNG lộ khi admin tenant B gọi.
 *   N3  role UUID lạ → 404.
 *   N4  hàng user_roles soft-deleted (deleted_at) + hết hạn (expires_at quá khứ) → KHÔNG xuất hiện.
 *
 * Integration trên Postgres THẬT, DB CÔ LẬP. Gate cứng `hasDb && LANE_DB`
 * (memory integration-test-lane-db-gate).
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
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // có view:user (seed canonical)
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có view:user

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

describe.skipIf(!runDb)("S2-AUTH-ROLEMEM-1 GET /auth/roles/:id/members", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let adminToken: string;
  let employeeToken: string;
  let adminBToken: string;
  /** Role company-scope tenant A dùng cho P1/N4 (cô lập khỏi role canonical dùng chung). */
  let teamRoleA: string;
  let member1: string;
  let member2: string;
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
    A = await seedCompany(direct, "rolemem");
    companyIds.push(A.companyId);

    const adminEmail = `adm-${TAG}@rm.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

    const empEmail = `emp-${TAG}@rm.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

    // P1: role company-scope + 2 member active.
    teamRoleA = await seedRole(direct, A.companyId, `rm-team-${TAG}`);
    member1 = await seedUser(direct, A.companyId, `m1-${TAG}@rm.test`, pw);
    member2 = await seedUser(direct, A.companyId, `m2-${TAG}@rm.test`, pw);
    await seedUserRole(direct, member1, teamRoleA, A.companyId);
    await seedUserRole(direct, member2, teamRoleA, A.companyId);

    // N4a: member đã bị revoke (soft-delete) — KHÔNG được xuất hiện.
    const revoked = await seedUser(direct, A.companyId, `rv-${TAG}@rm.test`, pw);
    const revokedRowId = await seedUserRole(direct, revoked, teamRoleA, A.companyId);
    await direct.query(`UPDATE user_roles SET deleted_at = now() WHERE id = $1`, [revokedRowId]);

    // N4b: member grant HẾT HẠN — KHÔNG được xuất hiện.
    const expired = await seedUser(direct, A.companyId, `ex-${TAG}@rm.test`, pw);
    const expiredRowId = await seedUserRole(direct, expired, teamRoleA, A.companyId);
    await direct.query(
      `UPDATE user_roles SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [expiredRowId],
    );

    // ── Tenant B (cross-tenant, BẤT BIẾN #1) ─────────────────────────────────
    B = await seedCompany(direct, "rolememb");
    companyIds.push(B.companyId);
    const adminBEmail = `admb-${TAG}@rmb.test`;
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

  it("P1 — admin thấy ĐÚNG 2 member active (soft-deleted + expired bị loại) với field đúng", async () => {
    const res = await api(app)
      .get(`/auth/roles/${teamRoleA}/members`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const members = res.body.data.members as Array<Record<string, unknown>>;
    expect(members).toHaveLength(2);
    const ids = members.map((m) => m.userId).sort();
    expect(ids).toEqual([member1, member2].sort());
    for (const m of members) {
      expect(typeof m.email).toBe("string");
      expect(m).toHaveProperty("fullName");
      expect(typeof m.status).toBe("string");
      expect(m).toHaveProperty("expiresAt");
      expect(m).toHaveProperty("grantedAt");
      // KHÔNG lộ field ngoài contract (chống PII-leak mở rộng về sau).
      expect(Object.keys(m).sort()).toEqual(
        ["email", "expiresAt", "fullName", "grantedAt", "status", "userId"].sort(),
      );
    }
  });

  it("N1 — employee (không view:user) → 403", async () => {
    const res = await api(app)
      .get(`/auth/roles/${teamRoleA}/members`)
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("N2 — cross-tenant: member EMPLOYEE role (system, dùng chung) của tenant A KHÔNG lộ cho admin tenant B", async () => {
    const res = await api(app)
      .get(`/auth/roles/${EMPLOYEE_ROLE}/members`)
      .set("Authorization", `Bearer ${adminBToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const members = res.body.data.members as Array<{ userId: string; email: string }>;
    // Tenant A có 1 employee giữ role 0008; tenant B không gán ai → list PHẢI rỗng (không rò).
    expect(members).toHaveLength(0);
  });

  it("N2b — role company-scope tenant A → admin tenant B gọi ra 404 (RLS không thấy role)", async () => {
    const res = await api(app)
      .get(`/auth/roles/${teamRoleA}/members`)
      .set("Authorization", `Bearer ${adminBToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  it("N3 — role UUID lạ → 404", async () => {
    const res = await api(app)
      .get(`/auth/roles/${randomUUID()}/members`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  it("N5 — operator-audience role (platform-admin f0) → 404, KHÔNG liệt kê membership control-plane", async () => {
    // notOperatorRole() trong findRoleByIdTx là lá chắn chống-leo-thang — pin trực tiếp (gate MEDIUM finding).
    const PLATFORM_ADMIN_ROLE = "00000000-0000-0000-0000-0000000000f0";
    const res = await api(app)
      .get(`/auth/roles/${PLATFORM_ADMIN_ROLE}/members`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });
});
