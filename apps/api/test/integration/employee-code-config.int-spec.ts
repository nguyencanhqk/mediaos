/**
 * S2-HR-BE-7 — Employee-code CONFIG admin integration (CROWN-JEWEL: permission + audit + tenant + append-only).
 *
 * Real NestJS app (AppModule) + supertest → runs the full guard chain (JwtAuthGuard → CompanyGuard → 2FA →
 * PermissionGuard → EmployeeCodeConfigController → Service) with the REAL permission engine. No mocks.
 * Verifies at the DB layer:
 *   QA02-HR-CODE-001: PATCH a valid config → 200 + GET reflects it; POST preview → next code.
 *   QA-05: GET/PATCH without the pair → 403 AND zero audit rows; hr grant → 200.
 *   RLS: tenant A cannot read/PATCH tenant B's config (cross-tenant proof).
 *   QA-04: PATCH bad value_type (number_length / status) → 422; body company_id ignored (uses AuthContext).
 *   preview non-mutation: sequence_counters.current_value BEFORE == AFTER.
 *   audit-in-tx: PATCH → EXACTLY one audit_logs row object_type='employee_code_config' with changed_fields.
 *   append-only (BẤT BIẾN #2): mediaos_app UPDATE/DELETE of that audit row → DENIED.
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): .env points DATABASE_URL at the shared dev
 * DB (hasDb=true) → run ONLY on an isolated lane DB, else false-red.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { appPool, directPool, hasDb, withClient } from "../helpers/integration-db";
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

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!test99";
const hasLaneDb = hasDb && !!process.env.LANE_DB;
const EMPLOYEE_CODE_SEQUENCE_KEY = "EMPLOYEE_CODE";

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

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

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function seedEmployeeCodeCounter(direct: Pool, companyId: string): Promise<void> {
  await direct.query(
    `INSERT INTO sequence_counters
       (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
        increment_by, reset_policy, current_value, status)
     VALUES ($1, 'HR', $2, 'Company', 'EMP', 4, 1, 'Never', 0, 'Active')`,
    [companyId, EMPLOYEE_CODE_SEQUENCE_KEY],
  );
}

/** Grant a fresh company-scoped role carrying the given pairs to `userId`. */
async function grant(
  direct: Pool,
  companyId: string,
  userId: string,
  pairs: Array<[string, string]>,
): Promise<void> {
  const roleId = await seedRole(direct, companyId, `qa-codecfg-${userId.slice(0, 8)}`);
  for (const [action, resourceType] of pairs) {
    const permId = await seedPermissionCatalog(direct, action, resourceType, false);
    await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
  }
  await seedUserRole(direct, userId, roleId, companyId);
}

async function countConfigAudit(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM audit_logs
       WHERE company_id = $1 AND object_type = 'employee_code_config'`,
    [companyId],
  );
  return r.rows[0].n as number;
}

async function counterValue(direct: Pool, companyId: string): Promise<string> {
  const r = await direct.query(
    `SELECT current_value::text AS v FROM sequence_counters
       WHERE company_id = $1 AND sequence_key = $2`,
    [companyId, EMPLOYEE_CODE_SEQUENCE_KEY],
  );
  return r.rows[0].v as string;
}

const VIEW_UPDATE: Array<[string, string]> = [
  ["view", "employee-code-config"],
  ["update", "employee-code-config"],
  ["preview", "employee-code"],
];

describe.skipIf(!hasLaneDb)(
  "S2-HR-BE-7 employee-code config admin (HTTP, real permission engine)",
  () => {
    const direct = directPool();
    const app = appPool();
    let nest: INestApplication;

    let A: SeededTenant;
    let B: SeededTenant;
    let hrEmail = "";
    let noPermEmail = "";
    let bHrEmail = "";

    beforeAll(async () => {
      const hash = await hashedPw();
      A = await seedCompany(direct, "codecfgA");
      B = await seedCompany(direct, "codecfgB");
      await seedEmployeeCodeCounter(direct, A.companyId);
      await seedEmployeeCodeCounter(direct, B.companyId);

      hrEmail = `hr@${A.slug}.test`;
      const hrUserId = await seedUser(direct, A.companyId, hrEmail, hash);
      await grant(direct, A.companyId, hrUserId, VIEW_UPDATE);

      noPermEmail = `noperm@${A.slug}.test`;
      await seedUser(direct, A.companyId, noPermEmail, hash); // no grants

      bHrEmail = `hr@${B.slug}.test`;
      const bHrUserId = await seedUser(direct, B.companyId, bHrEmail, hash);
      await grant(direct, B.companyId, bHrUserId, VIEW_UPDATE);
      // Give B a distinctive config so a cross-tenant read leak would be observable.
      await direct.query(
        `INSERT INTO employee_code_configs (company_id, prefix, number_length, status)
       VALUES ($1, 'BSECRET', 7, 'active')`,
        [B.companyId],
      );

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = moduleRef.createNestApplication();
      nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      nest.useGlobalFilters(new AllExceptionsFilter());
      await nest.init();
    });

    afterAll(async () => {
      for (const id of [A.companyId, B.companyId]) {
        await direct
          .query("DELETE FROM employee_code_configs WHERE company_id = $1", [id])
          .catch(() => undefined);
      }
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      await app.end();
      if (nest) await nest.close();
    });

    it("QA-05 deny: GET without the pair → 403 and NO audit row", async () => {
      const token = await login(nest, A.slug, noPermEmail);
      const before = await countConfigAudit(direct, A.companyId);
      const res = await api(nest).get("/hr/employee-code-config").set(bearer(token));
      expect(res.status).toBe(403);
      expect(await countConfigAudit(direct, A.companyId)).toBe(before);
    });

    it("QA-05 deny: PATCH without the pair → 403 and NO audit row", async () => {
      const token = await login(nest, A.slug, noPermEmail);
      const before = await countConfigAudit(direct, A.companyId);
      const res = await api(nest)
        .patch("/hr/employee-code-config")
        .set(bearer(token))
        .send({ prefix: "HACK" });
      expect(res.status).toBe(403);
      expect(await countConfigAudit(direct, A.companyId)).toBe(before);
    });

    it("QA02-HR-CODE-001: PATCH valid config → 200, GET reflects it, exactly one audit row w/ changed_fields", async () => {
      const token = await login(nest, A.slug, hrEmail);
      const before = await countConfigAudit(direct, A.companyId);

      const patch = await api(nest)
        .patch("/hr/employee-code-config")
        .set(bearer(token))
        // company_id in the body must be IGNORED — the write uses the AuthContext tenant.
        .send({
          prefix: "STAFF",
          numberLength: 5,
          allowManualOverride: false,
          companyId: B.companyId,
        });
      expect(patch.status, JSON.stringify(patch.body)).toBe(200);
      expect(patch.body.data.prefix).toBe("STAFF");
      expect(patch.body.data.numberLength).toBe(5);
      expect(patch.body.data.allowManualOverride).toBe(false);

      const get = await api(nest).get("/hr/employee-code-config").set(bearer(token));
      expect(get.status).toBe(200);
      expect(get.body.data.prefix).toBe("STAFF");
      expect(get.body.data.numberLength).toBe(5);

      // Exactly one audit row, correct object_type + changed_fields populated.
      expect(await countConfigAudit(direct, A.companyId)).toBe(before + 1);
      const row = await direct.query(
        `SELECT action, changed_fields, before, after FROM audit_logs
         WHERE company_id = $1 AND object_type = 'employee_code_config'
         ORDER BY created_at DESC LIMIT 1`,
        [A.companyId],
      );
      expect(row.rows[0].action).toBe("CONFIG_UPDATE");
      expect(Array.isArray(row.rows[0].changed_fields)).toBe(true);
      expect(row.rows[0].changed_fields).toContain("prefix");
      // BẤT BIẾN #3: config-only — no counter/current_value in the snapshot.
      const blob = JSON.stringify([row.rows[0].before, row.rows[0].after]);
      expect(blob).not.toContain("current_value");
      expect(blob).not.toContain("currentValue");
      // The write landed in tenant A, NOT tenant B (body company_id ignored).
      expect(get.body.data.companyId).toBe(A.companyId);
    });

    it("QA02-HR-CODE-001: POST preview → next code WITHOUT mutating the counter", async () => {
      const token = await login(nest, A.slug, hrEmail);
      const valBefore = await counterValue(direct, A.companyId);

      const res = await api(nest).post("/hr/employee-code/preview").set(bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.code).toBe("EMP0001");
      expect(res.body.data.value).toBe(1);

      // Non-mutation proof: current_value unchanged.
      expect(await counterValue(direct, A.companyId)).toBe(valBefore);
    });

    it("QA-04: PATCH bad value_type is REJECTED at the DTO boundary (400) and NOT persisted", async () => {
      // nestjs-zod ZodValidationPipe rejects a schema violation with 400 BadRequest at the boundary
      // (before the service runs) — value_type guard fires, so no bad config is written and no audit row.
      const token = await login(nest, A.slug, hrEmail);
      const auditBefore = await countConfigAudit(direct, A.companyId);

      const r1 = await api(nest)
        .patch("/hr/employee-code-config")
        .set(bearer(token))
        .send({ numberLength: 99 });
      expect(r1.status).toBe(400);
      const r2 = await api(nest)
        .patch("/hr/employee-code-config")
        .set(bearer(token))
        .send({ status: "archived" });
      expect(r2.status).toBe(400);
      const r3 = await api(nest)
        .patch("/hr/employee-code-config")
        .set(bearer(token))
        .send({ numberLength: 4.5 });
      expect(r3.status).toBe(400);

      // Rejected at the boundary → the service never ran → no new audit row.
      expect(await countConfigAudit(direct, A.companyId)).toBe(auditBefore);
    });

    it("RLS: tenant A never sees tenant B's config (cross-tenant read isolation)", async () => {
      const token = await login(nest, A.slug, hrEmail);
      const get = await api(nest).get("/hr/employee-code-config").set(bearer(token));
      expect(get.status).toBe(200);
      // A's config is STAFF (patched above), never B's BSECRET/number_length 7.
      expect(get.body.data.prefix).not.toBe("BSECRET");
      expect(get.body.data.companyId).toBe(A.companyId);
    });

    it("append-only (BẤT BIẾN #2): mediaos_app UPDATE/DELETE of the config audit row is DENIED", async () => {
      const row = await direct.query(
        `SELECT id FROM audit_logs WHERE company_id = $1 AND object_type = 'employee_code_config' LIMIT 1`,
        [A.companyId],
      );
      const auditId = row.rows[0].id as string;

      await withClient(app, async (c) => {
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
        await expect(
          c.query(`UPDATE audit_logs SET action = 'TAMPER' WHERE id = $1`, [auditId]),
        ).rejects.toThrow(/permission denied/);
        await expect(c.query(`DELETE FROM audit_logs WHERE id = $1`, [auditId])).rejects.toThrow(
          /permission denied/,
        );
      });
    });
  },
);
