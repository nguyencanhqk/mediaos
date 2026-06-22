/**
 * FOUNDATION-BE-3 — Audit viewer e2e (RED-first): deny-path + scope tách Company/System + redact-at-read.
 *
 * Contracts (done_when BE-3):
 *   3a  Employee KHÔNG có view:audit-log GET /foundation/audit-logs → 403 (PermissionGuard fail-closed).
 *   3b  Company-admin (role …0001, view:audit-log) GET → 200; response KHÔNG chứa secret (password/token/
 *       storage_path) — kể cả khi hàng audit là RAW chưa-mask (legacy) ⇒ chứng minh REDACT-AT-READ (D5).
 *   3c  Tenant A admin KHÔNG thấy audit của tenant B (Company scope, RLS ép qua withTenant).
 *   3d  Tenant token GET /foundation/audit-logs/all → 401 (biên audience @OperatorOnly — KHÔNG phải 403).
 *   3e  Operator-audience NHƯNG thiếu view:platform-audit (DENY-override) → 403 (PermissionGuard — lớp khác 3d).
 *   3f  Operator (role …f0, view:platform-audit) GET /all → thấy CHÉO tenant; ?companyId=A khoanh 1 tenant.
 *
 * Dùng Postgres thật (CI). Auto-skip khi DATABASE_URL chưa set (hasDb=false) — KHÔNG false-green.
 * Direct pool (superuser, bypass RLS) seed dữ liệu; HTTP đi qua app thật (guard pipeline sống).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../src/auth/password.service";
import { directPool, hasDb } from "./helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "./helpers/seed";

const PASSWORD = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001";
const PLATFORM_ADMIN_ROLE = "00000000-0000-0000-0000-0000000000f0";
/** Placeholder vô hại (KHÔNG secret thật) — chỉ để khẳng định KHÔNG xuất hiện trong response. */
const SECRET = "SHOULD_NOT_LEAK_PLACEHOLDER";
const ACTION_A = "BE3SecretLeakA";
const ACTION_B = "BE3SecretLeakB";

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

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.accessToken as string;
}

/**
 * Chèn 1 hàng audit RAW (bypass AuditMaskerService) qua direct pool — mô phỏng hàng LEGACY chứa secret
 * chưa-mask ở before/after/old_values/new_values. Đọc qua API phải redact-at-read (D5) ⇒ sạch.
 */
async function insertRawAudit(direct: Pool, companyId: string, action: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO audit_logs (company_id, action, object_type, before, after, old_values, new_values)
     VALUES ($1, $2, 'user', $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb) RETURNING id`,
    [
      companyId,
      action,
      JSON.stringify({ password: SECRET, email: "x@y.z" }),
      JSON.stringify({ token: SECRET }),
      JSON.stringify({ storage_path: `/secret/${SECRET}`, name: "a" }),
      JSON.stringify({ storage_path: `/secret/${SECRET}`, name: "b" }),
    ],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!hasDb)("FOUNDATION-BE-3 audit viewer e2e (deny-path + scope + redact)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let adminToken: string;
  let employeeToken: string;
  let operatorToken: string;
  let operatorNoGrantToken: string;
  let rawAuditIdA: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "be3a");
    B = await seedCompany(direct, "be3b");
    companyIds.push(A.companyId, B.companyId);
    const pw = await new PasswordService().hash(PASSWORD);

    // Company-admin A — role …0001 có view:audit-log (mig 0340).
    const adminEmail = `adm-${randomUUID().slice(0, 8)}@a.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

    // Employee A — KHÔNG có audit grant (role rỗng).
    const empEmail = `emp-${randomUUID().slice(0, 8)}@a.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    const empRole = await seedRole(direct, A.companyId, `emp-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, emp, empRole, A.companyId);

    // Operator — role …f0 ⇒ aud='operator' + view:platform-audit (mig 0340); requires_two_factor=false.
    const opEmail = `op-${randomUUID().slice(0, 8)}@a.test`;
    const op = await seedUser(direct, A.companyId, opEmail, pw);
    await seedUserRole(direct, op, PLATFORM_ADMIN_ROLE, A.companyId);

    // Operator-no-grant — …f0 (audience operator) NHƯNG DENY view:platform-audit (deny-override ⇒ 403).
    const opNgEmail = `opng-${randomUUID().slice(0, 8)}@a.test`;
    const opNg = await seedUser(direct, A.companyId, opNgEmail, pw);
    await seedUserRole(direct, opNg, PLATFORM_ADMIN_ROLE, A.companyId);
    const platformAuditPerm = await permId(direct, "view", "platform-audit");
    const denyRole = await seedRole(direct, A.companyId, `deny-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, denyRole, platformAuditPerm, "DENY");
    await seedUserRole(direct, opNg, denyRole, A.companyId);

    // Hàng audit RAW (chưa-mask) cho A và B.
    rawAuditIdA = await insertRawAudit(direct, A.companyId, ACTION_A);
    await insertRawAudit(direct, B.companyId, ACTION_B);

    adminToken = await login(app, A.slug, adminEmail);
    employeeToken = await login(app, A.slug, empEmail);
    operatorToken = await login(app, A.slug, opEmail);
    operatorNoGrantToken = await login(app, A.slug, opNgEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // 3a — deny-path (RED) ────────────────────────────────────────────────────────
  it("3a — Employee thiếu view:audit-log → 403", async () => {
    const res = await api(app)
      .get("/foundation/audit-logs")
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
  });

  it("(d) — không JWT → 401", async () => {
    const res = await api(app).get("/foundation/audit-logs");
    expect(res.status).toBe(401);
  });

  // 3b / 3b-bis — redact-at-read (RED) ──────────────────────────────────────────
  it("3b — Company-admin → 200; response KHÔNG chứa secret (redact hàng RAW legacy)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?action=${ACTION_A}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data.data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    const row = rows[0] as {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      oldValues: Record<string, unknown>;
    };
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(row.before["password"]).toBe("***");
    expect(row.before["email"]).toBe("x@y.z");
    expect(row.after["token"]).toBe("***");
    expect(row.oldValues["storage_path"]).toBe("***");
  });

  it("3b-bis — detail /:id cũng redact (không lộ secret ở hàng RAW)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs/${rawAuditIdA}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect((res.body.data.before as Record<string, unknown>)["password"]).toBe("***");
  });

  // 3c — tenant isolation (Company scope) ───────────────────────────────────────
  it("3c — Tenant A admin KHÔNG thấy audit của tenant B", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?action=${ACTION_B}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect((res.body.data.data as unknown[]).length).toBe(0);
  });

  // 3d — audience boundary (System route) ───────────────────────────────────────
  it("3d — Tenant token GET /all → 401 (audience operator, KHÔNG phải 403)", async () => {
    const res = await api(app)
      .get("/foundation/audit-logs/all")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(401);
  });

  // 3e — permission layer (độc lập audience) ────────────────────────────────────
  it("3e — Operator-audience thiếu view:platform-audit (DENY) → 403", async () => {
    const res = await api(app)
      .get("/foundation/audit-logs/all")
      .set("Authorization", `Bearer ${operatorNoGrantToken}`);
    expect(res.status).toBe(403);
  });

  // 3f — System scope cross-tenant (happy) ──────────────────────────────────────
  it("3f — Operator thấy audit CHÉO tenant; ?companyId khoanh 1 tenant; vẫn redact", async () => {
    // Thấy hàng của tenant B (cross-tenant).
    const all = await api(app)
      .get(`/foundation/audit-logs/all?action=${ACTION_B}`)
      .set("Authorization", `Bearer ${operatorToken}`);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect((all.body.data.data as unknown[]).length).toBe(1);
    expect(JSON.stringify(all.body)).not.toContain(SECRET);

    // ?companyId=A → KHÔNG còn hàng của B.
    const scoped = await api(app)
      .get(`/foundation/audit-logs/all?action=${ACTION_B}&companyId=${A.companyId}`)
      .set("Authorization", `Bearer ${operatorToken}`);
    expect(scoped.status).toBe(200);
    expect((scoped.body.data.data as unknown[]).length).toBe(0);
  });
});
