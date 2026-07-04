/**
 * S2-FND-BE-8 (be-module-toggle) — PATCH /foundation/modules/:code DENY-PATH + CORE-LOCK + HAPPY
 * (RED-first, DB cô lập). Cổng = `update:foundation-module` (mig 0435 dòng 339, is_sensitive=TRUE) — cặp
 * NHẠY CẢM: wildcard `*:*` / super-admin KHÔNG kế thừa (permission.service L157-181) ⇒ cần grant EXACT.
 *
 * Deny-first RED (viết TRƯỚC implement — route chưa tồn tại ⇒ 404 ≠ 403 ⇒ ĐỎ; sau implement ⇒ 403/400/200):
 *   D1  employee (role 0008, KHÔNG grant) PATCH /modules/PAYROLL → 403 + KHÔNG audit 'module' mới.
 *   D2  wildcard '*:*' (non-sensitive ALLOW) PATCH → vẫn 403 (sensitive KHÔNG kế thừa) + 0 audit 'module'.
 *   C3  CORE-LOCK: exactGrant PATCH toggle từng module trong 7 MVP (AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI) →
 *       400, 0 ghi company_settings 'module.<code>.enabled', 0 audit 'module' (đo được TỪNG module).
 *   P4  HAPPY disable non-core PAYROLL (exactGrant) → 200; getAllModules PAYROLL enabled=false; company_settings
 *       1 hàng 'module.PAYROLL.enabled'=false; đúng +1 audit object_type='module' ModuleDisabled/CONFIG_UPDATE/
 *       permission_code='FOUNDATION.MODULE.UPDATE'.
 *   P5  HAPPY re-enable PAYROLL → 200; getAllModules enabled=true; +1 audit 'module' ModuleEnabled (UPDATE path).
 *   N6  code lạ (exactGrant) → 404 (KHÔNG 500).
 *   V7  body sai (enabled thiếu / không phải boolean) → 400 (Zod) + 0 audit 'module'.
 *
 * BẤT BIẾN #2 (audit append-only): mọi deny/400/404 KHÔNG ghi audit — assert count(audit_logs object_type='module') không đổi.
 * Postgres THẬT (DB cô lập mediaos_<lane>, CLAUDE §9.5). Gate `hasDb && LANE_DB` (memory:
 * integration-test-lane-db-gate — .env làm hasDb=true; thiếu LANE_DB → đỏ-giả trên DB dev chung).
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
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có foundation-module grant
const CORE_MODULES = ["AUTH", "HR", "ATT", "LEAVE", "TASK", "DASH", "NOTI"] as const;
const NON_CORE = "PAYROLL"; // non-core, seeded INACTIVE (mig 0435) — toggle được, hiện trong admin catalog

/** Gate cứng: chỉ chạy khi có Postgres THẬT VÀ chạy trên DB cô lập lane (không phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

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

/** Đếm audit_logs object_type='module' của tenant (chứng minh deny/400/404 KHÔNG ghi — BẤT BIẾN #2). */
async function moduleAuditCount(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND object_type = 'module'",
    [companyId],
  );
  return r.rows[0].n as number;
}

/** Đếm company_settings 'module.<code>.enabled' của tenant (chứng minh core-lock KHÔNG ghi). */
async function settingCount(direct: Pool, companyId: string, code: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM company_settings WHERE company_id = $1 AND setting_key = $2",
    [companyId, `module.${code}.enabled`],
  );
  return r.rows[0].n as number;
}

describe.skipIf(!runDb)(
  "S2-FND-BE-8 module-toggle deny / core-lock / happy (sensitive gate + audit)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let employeeToken: string; // role 0008 — KHÔNG grant
    let wildcardToken: string; // '*:*' non-sensitive — KHÔNG kế thừa sensitive
    let exactToken: string; // update:foundation-module (EXACT, sensitive) + view (đọc catalog)
    const companyIds: string[] = [];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();

      A = await seedCompany(direct, "mtogdeny");
      companyIds.push(A.companyId);
      const pw = await new PasswordService().hash(PASSWORD);

      // employee A — role 0008 KHÔNG có foundation-module ⇒ deny 403.
      const empEmail = `emp-${randomUUID().slice(0, 8)}@a.test`;
      const emp = await seedUser(direct, A.companyId, empEmail, pw);
      await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

      // wildcard A — role riêng + grant '*:*' (non-sensitive). KHÔNG kế thừa quyền sensitive.
      const wildEmail = `wild-${randomUUID().slice(0, 8)}@a.test`;
      const wild = await seedUser(direct, A.companyId, wildEmail, pw);
      const wildRole = await seedRole(direct, A.companyId, `wild-${randomUUID().slice(0, 8)}`);
      const wildPerm = await seedPermissionCatalog(direct, "*", "*", false);
      await seedRolePermission(direct, wildRole, wildPerm, "ALLOW");
      await seedUserRole(direct, wild, wildRole, A.companyId);

      // exact A — role riêng + grant EXACT update:foundation-module (sensitive) + view:foundation-module
      // (đọc getAllModules). Cặp EXACT thoả sensitive gate (KHÁC wildcard/super-admin).
      const exEmail = `ex-${randomUUID().slice(0, 8)}@a.test`;
      const ex = await seedUser(direct, A.companyId, exEmail, pw);
      const exRole = await seedRole(direct, A.companyId, `ex-${randomUUID().slice(0, 8)}`);
      const updPerm = await seedPermissionCatalog(direct, "update", "foundation-module", true);
      const viewPerm = await seedPermissionCatalog(direct, "view", "foundation-module", false);
      await seedRolePermission(direct, exRole, updPerm, "ALLOW");
      await seedRolePermission(direct, exRole, viewPerm, "ALLOW");
      await seedUserRole(direct, ex, exRole, A.companyId);

      employeeToken = await login(app, A.slug, empEmail);
      wildcardToken = await login(app, A.slug, wildEmail);
      exactToken = await login(app, A.slug, exEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    // ── D1: employee PATCH → 403 + 0 audit 'module' ────────────────────────────
    it("D1 — employee (không grant) PATCH /modules/PAYROLL → 403 + KHÔNG ghi audit", async () => {
      const before = await moduleAuditCount(direct, A.companyId);
      const res = await api(app)
        .patch(`/foundation/modules/${NON_CORE}`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ enabled: false });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.data ?? null).toBeNull();
      expect(await moduleAuditCount(direct, A.companyId)).toBe(before);
    });

    // ── D2: wildcard '*:*' PATCH → 403 (sensitive không kế thừa) + 0 audit ──────
    it("D2 — wildcard '*:*' PATCH → 403 (sensitive không kế thừa) + KHÔNG audit", async () => {
      const before = await moduleAuditCount(direct, A.companyId);
      const res = await api(app)
        .patch(`/foundation/modules/${NON_CORE}`)
        .set("Authorization", `Bearer ${wildcardToken}`)
        .send({ enabled: false });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.success).toBe(false);
      expect(await moduleAuditCount(direct, A.companyId)).toBe(before);
    });

    // ── C3: CORE-LOCK — 7 module MVP → 400, 0 company_settings write, 0 audit ───
    it("C3 — core-lock: toggle 7 module MVP → 400, 0 setting write, 0 audit (đo từng module)", async () => {
      for (const code of CORE_MODULES) {
        const auditBefore = await moduleAuditCount(direct, A.companyId);
        const res = await api(app)
          .patch(`/foundation/modules/${code}`)
          .set("Authorization", `Bearer ${exactToken}`)
          .send({ enabled: false });
        expect(res.status, `${code}: ${JSON.stringify(res.body)}`).toBe(400);
        expect(res.body.success).toBe(false);
        // 0 ghi company_settings cho module lõi + 0 audit 'module' mới.
        expect(await settingCount(direct, A.companyId, code), `${code} setting write`).toBe(0);
        expect(await moduleAuditCount(direct, A.companyId), `${code} audit`).toBe(auditBefore);
      }
    });

    // ── P4: HAPPY disable non-core → 200 + setting=false + đúng 1 audit 'module' ─
    it("P4 — happy disable PAYROLL → 200; getAllModules enabled=false; +1 audit ModuleDisabled/CONFIG_UPDATE", async () => {
      const before = await moduleAuditCount(direct, A.companyId);
      const res = await api(app)
        .patch(`/foundation/modules/${NON_CORE}`)
        .set("Authorization", `Bearer ${exactToken}`)
        .send({ enabled: false });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.module_code).toBe(NON_CORE);
      expect(res.body.data.enabled).toBe(false);

      // getAllModules phản ánh enabled=false NGAY.
      const list = await api(app)
        .get("/foundation/modules")
        .set("Authorization", `Bearer ${exactToken}`);
      expect(list.status).toBe(200);
      const payroll = (list.body.data as Array<{ module_code: string; enabled: boolean }>).find(
        (r) => r.module_code === NON_CORE,
      )!;
      expect(payroll.enabled).toBe(false);

      // company_settings 1 hàng 'module.PAYROLL.enabled'=false của tenant A.
      const sr = await direct.query(
        "SELECT setting_value FROM company_settings WHERE company_id = $1 AND setting_key = $2",
        [A.companyId, `module.${NON_CORE}.enabled`],
      );
      expect(sr.rows).toHaveLength(1);
      expect(sr.rows[0].setting_value).toBe(false);

      // đúng +1 audit object_type='module' với action/action_group/permission_code đúng.
      expect(await moduleAuditCount(direct, A.companyId)).toBe(before + 1);
      const ar = await direct.query(
        `SELECT action, action_group, permission_code, data_scope
         FROM audit_logs
        WHERE company_id = $1 AND object_type = 'module'
        ORDER BY created_at DESC LIMIT 1`,
        [A.companyId],
      );
      expect(ar.rows[0].action).toBe("ModuleDisabled");
      expect(ar.rows[0].action_group).toBe("CONFIG_UPDATE");
      expect(ar.rows[0].permission_code).toBe("FOUNDATION.MODULE.UPDATE");
      expect(ar.rows[0].data_scope).toBe("Company");
    });

    // ── P5: HAPPY re-enable (UPDATE path) → 200 + enabled=true + +1 audit ───────
    it("P5 — happy re-enable PAYROLL → 200; getAllModules enabled=true; +1 audit ModuleEnabled", async () => {
      const before = await moduleAuditCount(direct, A.companyId);
      const res = await api(app)
        .patch(`/foundation/modules/${NON_CORE}`)
        .set("Authorization", `Bearer ${exactToken}`)
        .send({ enabled: true });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.enabled).toBe(true);

      const list = await api(app)
        .get("/foundation/modules")
        .set("Authorization", `Bearer ${exactToken}`);
      const payroll = (list.body.data as Array<{ module_code: string; enabled: boolean }>).find(
        (r) => r.module_code === NON_CORE,
      )!;
      expect(payroll.enabled).toBe(true);

      expect(await moduleAuditCount(direct, A.companyId)).toBe(before + 1);
      const ar = await direct.query(
        `SELECT action FROM audit_logs WHERE company_id = $1 AND object_type = 'module'
        ORDER BY created_at DESC LIMIT 1`,
        [A.companyId],
      );
      expect(ar.rows[0].action).toBe("ModuleEnabled");
    });

    // ── N6: code lạ → 404 (KHÔNG 500) ─────────────────────────────────────────
    it("N6 — exactGrant PATCH /modules/NOPE_X → 404 (không 500)", async () => {
      const before = await moduleAuditCount(direct, A.companyId);
      const res = await api(app)
        .patch(`/foundation/modules/NOPE_X`)
        .set("Authorization", `Bearer ${exactToken}`)
        .send({ enabled: false });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(await moduleAuditCount(direct, A.companyId)).toBe(before);
    });

    // ── V7: body sai → 400 (Zod) + 0 audit ────────────────────────────────────
    it("V7 — body sai (enabled không boolean / thiếu) → 400 + KHÔNG audit", async () => {
      const before = await moduleAuditCount(direct, A.companyId);
      const bad = await api(app)
        .patch(`/foundation/modules/${NON_CORE}`)
        .set("Authorization", `Bearer ${exactToken}`)
        .send({ enabled: "yes" });
      expect(bad.status, JSON.stringify(bad.body)).toBe(400);

      const missing = await api(app)
        .patch(`/foundation/modules/${NON_CORE}`)
        .set("Authorization", `Bearer ${exactToken}`)
        .send({});
      expect(missing.status).toBe(400);

      expect(await moduleAuditCount(direct, A.companyId)).toBe(before);
    });
  },
);
