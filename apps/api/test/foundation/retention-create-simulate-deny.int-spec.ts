/**
 * S2-FND-BE-8 (be-retention-create-simulate) — POST /foundation/retention-policies (create) +
 * POST /foundation/retention-policies/:id/simulate DENY-PATH / audit-in-tx / not-found (RED-first, DB cô lập).
 *
 * Cổng = `manage:foundation-retention` (mig 0435:363, is_sensitive=TRUE, System-scope). BẤT BIẾN sensitive
 * gate (permission.service L157-181): wildcard `*:*` / super-admin / bulk view-grant KHÔNG kế thừa quyền
 * nhạy cảm ⇒ 403. Positive-path dùng principal có grant EXACT cặp manage:foundation-retention (per-user).
 *
 * Deny-first RED (viết TRƯỚC implement — route chưa tồn tại ⇒ 404 ≠ 403 ⇒ ĐỎ; sau implement ⇒ 403):
 *   D1  employee (role 0008, KHÔNG grant) POST create → 403 + KHÔNG audit retention_policy mới (0 audit).
 *   D2  employee POST /:id/simulate → 403 (simulate cũng gated manage, không bypass).
 *   D3  company-admin (role 0001 — CÓ view bulk-grant, KHÔNG manage sensitive) POST create → 403 + 0 audit.
 *   D4  company-admin POST /:id/simulate → 403 (sensitive không kế thừa từ view/bulk-grant).
 *   P5  manager (grant EXACT view+manage) POST create → 200; view WHITELIST + đúng 1 audit RetentionPolicyCreated
 *       object_type='retention_policy' object_id=created, company_id=actor, KHÔNG secret/PII (audit-in-tx).
 *   P6  manager POST /:id/simulate (policy seeded) → 200, eligibleRecords số (READ-ONLY, KHÔNG mutate).
 *   X7  manager POST /:id/simulate với UUID lạ → 404 (KHÔNG 500 — guard fail-closed, hết cast NPE).
 *
 * BẤT BIẾN #2 (audit append-only): mọi deny KHÔNG ghi audit — assert count(object_type='retention_policy') 0.
 * BẤT BIẾN #1: create/simulate qua withTenant(companyId) — company_id = actor.companyId (KHÔNG từ body).
 *
 * Postgres THẬT (DB cô lập mediaos_<lane>, CLAUDE §9.5). Gate `hasDb && LANE_DB` (memory:
 * integration-test-lane-db-gate — .env làm hasDb=true; thiếu LANE_DB → đỏ-giả trên DB dev chung).
 * Direct pool (superuser, bypass RLS) seed users/roles/policy; HTTP đi qua app thật (guard sống).
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

const PASSWORD = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // bulk-grant view:foundation-retention (mig 0435)
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có foundation-retention

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane (KHÔNG phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

/** Marker tách dữ liệu suite này (description prefix cho policy). */
const TAG = randomUUID().slice(0, 8);
/** UUID hợp lệ nhưng KHÔNG tồn tại — chứng minh guard 404 (không 500). */
const MISSING_ID = "00000000-0000-0000-0000-0000000009f9";

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

/** Đếm audit_logs object_type='retention_policy' của tenant (chứng minh deny KHÔNG ghi — BẤT BIẾN #2). */
async function retentionAuditCount(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND object_type = 'retention_policy'",
    [companyId],
  );
  return r.rows[0].n as number;
}

/** Chèn 1 policy RAW cho tenant (direct pool, bypass RLS). Trả về id. */
async function seedPolicy(direct: Pool, companyId: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO data_retention_policies
       (company_id, module_code, entity_type, retention_days, cleanup_action, is_enabled, description)
     VALUES ($1, 'HR', 'tasks', 365, 'Delete', false, $2) RETURNING id`,
    [companyId, `ret-${TAG}`],
  );
  return r.rows[0].id as string;
}

const CREATE_BODY = {
  moduleCode: "TASK",
  entityType: "tasks",
  retentionDays: 90,
  cleanupAction: "Delete" as const,
};

describe.skipIf(!runDb)(
  "S2-FND-BE-8 retention create/simulate deny-path / audit-in-tx / not-found",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let employeeToken: string; // role 0008 — KHÔNG grant
    let adminToken: string; // role 0001 — view (bulk), KHÔNG manage sensitive
    let managerToken: string; // grant EXACT view + manage (sensitive)
    let policyA: string; // policy tenant A (target simulate happy-path)
    const companyIds: string[] = [];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();

      A = await seedCompany(direct, "retcs");
      companyIds.push(A.companyId);
      const pw = await new PasswordService().hash(PASSWORD);

      // employee A — role 0008 KHÔNG có foundation-retention ⇒ deny create + simulate.
      const empEmail = `emp-${randomUUID().slice(0, 8)}@a.test`;
      const emp = await seedUser(direct, A.companyId, empEmail, pw);
      await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

      // company-admin A — có view:foundation-retention (bulk-grant), KHÔNG manage (sensitive không seed role).
      const admEmail = `adm-${randomUUID().slice(0, 8)}@a.test`;
      const adm = await seedUser(direct, A.companyId, admEmail, pw);
      await seedUserRole(direct, adm, COMPANY_ADMIN_ROLE, A.companyId);

      // manager A — role riêng + grant EXACT view + manage (manage is_sensitive → cấp tường minh per-user).
      const mgrEmail = `mgr-${randomUUID().slice(0, 8)}@a.test`;
      const mgr = await seedUser(direct, A.companyId, mgrEmail, pw);
      const mgrRole = await seedRole(direct, A.companyId, `retcs-mgr-${randomUUID().slice(0, 8)}`);
      const viewPerm = await seedPermissionCatalog(direct, "view", "foundation-retention", false);
      const managePerm = await seedPermissionCatalog(
        direct,
        "manage",
        "foundation-retention",
        true,
      );
      await seedRolePermission(direct, mgrRole, viewPerm, "ALLOW");
      await seedRolePermission(direct, mgrRole, managePerm, "ALLOW");
      await seedUserRole(direct, mgr, mgrRole, A.companyId);

      policyA = await seedPolicy(direct, A.companyId);

      employeeToken = await login(app, A.slug, empEmail);
      adminToken = await login(app, A.slug, admEmail);
      managerToken = await login(app, A.slug, mgrEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    // ── D1: employee POST create → 403 + 0 audit ────────────────────────────────
    it("D1 — employee (không grant) POST /retention-policies → 403 + KHÔNG audit retention_policy", async () => {
      const before = await retentionAuditCount(direct, A.companyId);
      const res = await api(app)
        .post("/foundation/retention-policies")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send(CREATE_BODY);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.data ?? null).toBeNull();
      expect(await retentionAuditCount(direct, A.companyId)).toBe(before);
    });

    // ── D2: employee POST simulate → 403 ────────────────────────────────────────
    it("D2 — employee POST /retention-policies/:id/simulate → 403 (gated manage)", async () => {
      const res = await api(app)
        .post(`/foundation/retention-policies/${policyA}/simulate`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({});
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.success).toBe(false);
    });

    // ── D3: company-admin (view, KHÔNG manage sensitive) POST create → 403 + 0 audit ──
    it("D3 — company-admin (view bulk-grant, KHÔNG manage) POST create → 403 + KHÔNG audit", async () => {
      const before = await retentionAuditCount(direct, A.companyId);
      const res = await api(app)
        .post("/foundation/retention-policies")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(CREATE_BODY);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.success).toBe(false);
      expect(await retentionAuditCount(direct, A.companyId)).toBe(before);
    });

    // ── D4: company-admin POST simulate → 403 (sensitive không kế thừa) ─────────
    it("D4 — company-admin POST /:id/simulate → 403 (sensitive không kế thừa từ view)", async () => {
      const res = await api(app)
        .post(`/foundation/retention-policies/${policyA}/simulate`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.success).toBe(false);
    });

    // ── P5: manager POST create → 200 + đúng 1 audit RetentionPolicyCreated (audit-in-tx) ──
    it("P5 — manager (grant EXACT) POST create → 200 (view WHITELIST) + đúng 1 audit RetentionPolicyCreated, KHÔNG secret", async () => {
      const before = await retentionAuditCount(direct, A.companyId);
      const res = await api(app)
        .post("/foundation/retention-policies")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          moduleCode: "TASK",
          entityType: "tasks",
          retentionDays: 120,
          cleanupAction: "Delete",
        });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const body = res.body.data as Record<string, unknown>;
      expect(body.entityType).toBe("tasks");
      expect(body.retentionDays).toBe(120);
      // view WHITELIST — KHÔNG lộ companyId/createdBy/metadata/deletedAt.
      expect(body).not.toHaveProperty("companyId");
      expect(body).not.toHaveProperty("createdBy");
      expect(body).not.toHaveProperty("deletedAt");
      const createdId = body.id as string;

      // audit-in-tx: đúng 1 row MỚI cho policy tạo, object_type='retention_policy', company_id = actor.
      expect(await retentionAuditCount(direct, A.companyId)).toBe(before + 1);
      const audit = await direct.query(
        `SELECT action, action_group, object_type, company_id, new_values, old_values
         FROM audit_logs
        WHERE company_id = $1 AND object_type = 'retention_policy' AND object_id = $2`,
        [A.companyId, createdId],
      );
      expect(audit.rows.length).toBe(1);
      const row = audit.rows[0];
      expect(row.action).toBe("RetentionPolicyCreated");
      expect(row.action_group).toBe("CONFIG_UPDATE");
      expect(row.company_id).toBe(A.companyId); // BẤT BIẾN #1 — company_id = actor.companyId
      expect(row.new_values.entityType).toBe("tasks");
      // KHÔNG secret/PII trong toàn bộ audit row (snapshot config sạch).
      const serialized = JSON.stringify(row);
      expect(serialized).not.toMatch(/pass|secret|token|identity_number|bank_account/i);
    });

    // ── P6: manager POST simulate → 200 (READ-ONLY đếm eligible) ─────────────────
    it("P6 — manager POST /:id/simulate → 200 (eligibleRecords số, READ-ONLY)", async () => {
      const res = await api(app)
        .post(`/foundation/retention-policies/${policyA}/simulate`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({});
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const body = res.body.data as Record<string, unknown>;
      expect(body.policyId).toBe(policyA);
      expect(typeof body.eligibleRecords).toBe("number");
      expect(body.entityType).toBe("tasks");
      // WHITELIST — KHÔNG lộ companyId.
      expect(body).not.toHaveProperty("companyId");
    });

    // ── X7: manager POST simulate UUID lạ → 404 (KHÔNG 500 — guard fail-closed) ──
    it("X7 — manager POST /:id/simulate với UUID lạ → 404 (KHÔNG 500/NPE)", async () => {
      const res = await api(app)
        .post(`/foundation/retention-policies/${MISSING_ID}/simulate`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({});
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body.data ?? null).toBeNull();
    });
  },
);
