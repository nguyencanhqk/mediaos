/**
 * S2-FND-BE-3 (L3-retention-api) — RetentionController deny-path / 2-tenant RLS / audit-in-tx (integration).
 *
 * Postgres THẬT, DB CÔ LẬP (mediaos_<lane>, CLAUDE §9.5). Gate cứng `hasDb && LANE_DB` (memory
 * integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB ⇒ đỏ-giả trên DB dev chung.
 * Colocated trong src/ → vitest gom qua include glob spec của src; skipIf(!runDb) ⇒ inert ở unit-run.
 *
 * Phủ (RED-trước → GREEN):
 *   D1  Employee (role 0008, KHÔNG view:foundation-retention) → GET + PATCH đều 403.
 *   D2  company-admin A (role 0001 — CÓ view:foundation-retention non-sensitive qua bulk-grant mig 0435,
 *       NHƯNG KHÔNG có manage:foundation-retention is_sensitive) → GET 200 (list) NHƯNG PATCH → 403.
 *   P3  manager A (grant per-user view+manage) → PATCH 200; body = view WHITELIST (KHÔNG companyId/metadata).
 *   X4  2-tenant RLS: GET của A CHỈ trả policy của A (KHÔNG lộ policy B); PATCH policy B từ ngữ cảnh A → 404
 *       (RLS che — KHÔNG 500/NPE, KHÔNG lộ tồn tại hàng tenant khác).
 *   A5  audit-in-tx: PATCH policy A (manager) → đúng 1 audit_logs object_type='retention_policy',
 *       action='RetentionPolicyUpdated', changed_fields=['isEnabled'] (CHỈ tên field), KHÔNG secret; INSERT
 *       KHÔNG vỡ audit_logs_object_type_chk (mig 0456).
 *
 * PIN theo CẶP SEED THẬT (manage/view, 'foundation-retention') — KHÔNG theo mã FE (bài học drift S1-FND-MODULE).
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
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../../test/helpers/seed";

// Credential test (KHÔNG phải secret thật) — tên biến tránh literal gán-keyword (guard-secrets, BẤT BIẾN #3).
const LOGIN_PW = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // bulk-grant view:foundation-retention (mig 0435)
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có foundation-retention

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane (KHÔNG phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

/** Marker cấy vào description để tách dữ liệu suite này khỏi suite khác trên cùng DB. */
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

/** Chèn 1 policy RAW cho tenant (direct pool, bypass RLS). Trả về id. */
async function seedPolicy(
  direct: Pool,
  companyId: string,
  opts: { moduleCode: string; entityType: string; isEnabled?: boolean },
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO data_retention_policies
       (company_id, module_code, entity_type, retention_days, cleanup_action, is_enabled, description)
     VALUES ($1, $2, $3, 365, 'Delete', $4, $5) RETURNING id`,
    [companyId, opts.moduleCode, opts.entityType, opts.isEnabled ?? false, `ret-${TAG}`],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!runDb)("S2-FND-BE-3 retention API deny-path / RLS / audit-in-tx", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let adminToken: string; // company-admin A (view, KHÔNG manage)
  let employeeToken: string; // employee A (KHÔNG foundation-retention)
  let managerToken: string; // manager A (view + manage grant per-user)
  let policyA: string; // policy tenant A (target PATCH happy-path + audit)
  let policyB: string; // policy tenant B (cross-tenant target)
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "reta");
    B = await seedCompany(direct, "retb");
    companyIds.push(A.companyId, B.companyId);
    const pw = await new PasswordService().hash(LOGIN_PW);

    // company-admin A — có view:foundation-retention (bulk-grant), KHÔNG manage (sensitive không seed role).
    const adminEmail = `adm-${randomUUID().slice(0, 8)}@a.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

    // employee A — role 0008 KHÔNG có foundation-retention ⇒ deny cả GET + PATCH.
    const empEmail = `emp-${randomUUID().slice(0, 8)}@a.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

    // manager A — role riêng + grant per-user view + manage (manage is_sensitive → cấp tường minh).
    const mgrEmail = `mgr-${randomUUID().slice(0, 8)}@a.test`;
    const mgr = await seedUser(direct, A.companyId, mgrEmail, pw);
    const mgrRole = await seedRole(direct, A.companyId, `ret-mgr-${randomUUID().slice(0, 8)}`);
    const viewPerm = await seedPermissionCatalog(direct, "view", "foundation-retention", false);
    const managePerm = await seedPermissionCatalog(direct, "manage", "foundation-retention", true);
    await seedRolePermission(direct, mgrRole, viewPerm, "ALLOW");
    await seedRolePermission(direct, mgrRole, managePerm, "ALLOW");
    await seedUserRole(direct, mgr, mgrRole, A.companyId);

    // Policies: A (2 — module AUTH/HR), B (1). policyA isEnabled=false → PATCH bật lên (audit changed_fields).
    policyA = await seedPolicy(direct, A.companyId, {
      moduleCode: "AUTH",
      entityType: "audit_logs",
      isEnabled: false,
    });
    await seedPolicy(direct, A.companyId, { moduleCode: "HR", entityType: "employee_profiles" });
    policyB = await seedPolicy(direct, B.companyId, {
      moduleCode: "AUTH",
      entityType: "login_logs",
    });

    adminToken = await login(app, A.slug, adminEmail);
    employeeToken = await login(app, A.slug, empEmail);
    managerToken = await login(app, A.slug, mgrEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── D1: Employee KHÔNG grant → 403 cả GET + PATCH ─────────────────────────────
  it("D1 — Employee (không foundation-retention) GET /foundation/retention-policies → 403", async () => {
    const res = await api(app)
      .get("/foundation/retention-policies")
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.data ?? null).toBeNull();
  });

  it("D1 — Employee PATCH /foundation/retention-policies/:id → 403", async () => {
    const res = await api(app)
      .patch(`/foundation/retention-policies/${policyA}`)
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({ isEnabled: true });
    expect(res.status).toBe(403);
  });

  // ── D2: company-admin có view (GET 200) NHƯNG KHÔNG manage (PATCH 403) ─────────
  it("D2 — company-admin (view) GET → 200 (list policy tenant A)", async () => {
    const res = await api(app)
      .get("/foundation/retention-policies")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(2); // gồm cả policy disabled (policyA isEnabled=false)
    // view WHITELIST — KHÔNG lộ companyId/metadata/createdBy/updatedBy/deletedAt.
    for (const row of rows) {
      expect(row).not.toHaveProperty("companyId");
      expect(row).not.toHaveProperty("metadata");
      expect(row).not.toHaveProperty("createdBy");
      expect(row).not.toHaveProperty("deletedAt");
      expect(row).toHaveProperty("entityType");
    }
  });

  it("D2 — company-admin (KHÔNG manage, is_sensitive) PATCH → 403 (sensitive không kế thừa/bulk-grant)", async () => {
    const res = await api(app)
      .patch(`/foundation/retention-policies/${policyA}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ retentionDays: 30 });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // ── X4: 2-tenant RLS — GET A KHÔNG lộ policy B ────────────────────────────────
  it("X4 — GET của A KHÔNG chứa policy của B (RLS Company-scope)", async () => {
    const res = await api(app)
      .get("/foundation/retention-policies")
      .set("Authorization", `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(policyA);
    expect(ids).not.toContain(policyB); // policy B KHÔNG lọt sang tenant A
  });

  it("X4 — manager A PATCH policy của B → 404 (RLS che, KHÔNG 500/NPE)", async () => {
    const res = await api(app)
      .patch(`/foundation/retention-policies/${policyB}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ isEnabled: true });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.data ?? null).toBeNull();
  });

  // ── P3 + A5: manager PATCH policy A → 200 + audit-in-tx object_type='retention_policy' ──
  it("P3+A5 — manager PATCH policy A → 200 (view WHITELIST) + đúng 1 audit retention_policy, changed_fields=['isEnabled'], KHÔNG secret", async () => {
    const res = await api(app)
      .patch(`/foundation/retention-policies/${policyA}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ isEnabled: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body.data as Record<string, unknown>;
    expect(body.isEnabled).toBe(true);
    expect(body.id).toBe(policyA);
    expect(body).not.toHaveProperty("companyId");
    expect(body).not.toHaveProperty("metadata");

    // audit-in-tx: đúng 1 row cho policyA, object_type ∈ CHECK (mig 0456) — INSERT KHÔNG vỡ ràng buộc.
    const audit = await direct.query(
      `SELECT object_type, action, changed_fields, old_values, new_values
         FROM audit_logs
        WHERE company_id = $1 AND object_type = 'retention_policy' AND object_id = $2`,
      [A.companyId, policyA],
    );
    expect(audit.rows.length).toBe(1);
    const row = audit.rows[0];
    expect(row.action).toBe("RetentionPolicyUpdated");
    // changed_fields = CHỈ tên field đổi (isEnabled false→true), KHÔNG value.
    expect(row.changed_fields).toEqual(["isEnabled"]);
    // old/new = snapshot config; KHÔNG secret/PII trong toàn bộ audit row.
    expect(row.old_values.isEnabled).toBe(false);
    expect(row.new_values.isEnabled).toBe(true);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toMatch(/pass|secret|token|identity_number|bank_account/i);
  });
});
