/**
 * S2-INT-1 — HR create employee ↔ AUTH create/link user (CROWN-JEWEL, BẤT BIẾN #1/#2/#3).
 *
 * Real NestJS app (AppModule) + supertest → POST /hr/employees through the full guard chain with the
 * REAL permission engine (no mocks). Verifies at the DB layer that provisioning a login account while
 * creating an employee is one consistent transaction with audit on BOTH sides:
 *   - provision happy: actor with create:employee + create:user → 201; a users row with a HASHED
 *     password; the employee is linked; +1 'user.created' (object user) AND +1 'create' (object
 *     employee) audit row;
 *   - deny: actor with create:employee but NOT create:user → 403 + ZERO writes (no user, no employee,
 *     no audit) — the AUTH-create arm is gated before any write;
 *   - mirror deny: actor with create:user but NOT create:employee → 403 (controller guard);
 *   - link-existing needs only create:employee: actor without create:user links an existing unlinked
 *     user → 201 and NO 'user.created' audit (no account minted);
 *   - rollback: a reference failure AFTER the user was provisioned rolls back the whole tx → the
 *     would-be user is NOT persisted and NO 'user.created' audit is written;
 *   - 2-tenant: linking a user that lives in another company → 404 (never cross-links);
 *   - unique active link: a user already linked to an active employee → 409.
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): .env points DATABASE_URL at the shared
 * dev DB (hasDb=true) → only run on an isolated lane DB, else false-red.
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

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!test99";
const hasLaneDb = hasDb && !!process.env.LANE_DB;
const EMPLOYEE_CODE_SEQUENCE_KEY = "EMPLOYEE_CODE";
const RANDOM_UUID = "99999999-9999-9999-9999-999999999999";

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

/** Grant a fresh company-scoped role carrying the given (action,resourceType) pairs to `userId`. */
async function grantPairs(
  direct: Pool,
  companyId: string,
  userId: string,
  pairs: Array<[string, string]>,
): Promise<void> {
  const roleId = await seedRole(direct, companyId, `qa-int1-${userId.slice(0, 8)}`);
  for (const [action, resourceType] of pairs) {
    const permId = await seedPermissionCatalog(direct, action, resourceType, false);
    await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
  }
  await seedUserRole(direct, userId, roleId, companyId);
}

async function countAudit(
  direct: Pool,
  companyId: string,
  objectType: string,
  action: string,
): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM audit_logs
       WHERE company_id = $1 AND object_type = $2 AND action = $3`,
    [companyId, objectType, action],
  );
  return r.rows[0].n as number;
}

async function userByEmail(
  direct: Pool,
  companyId: string,
  email: string,
): Promise<{ id: string; password_hash: string } | undefined> {
  const r = await direct.query(
    `SELECT id, password_hash FROM users WHERE company_id = $1 AND email = $2 AND deleted_at IS NULL`,
    [companyId, email],
  );
  return r.rows[0];
}

const CREATE_EMPLOYEE: [string, string] = ["create", "employee"];
const CREATE_USER: [string, string] = ["create", "user"];

describe.skipIf(!hasLaneDb)(
  "S2-INT-1 employee↔user provisioning (HTTP, real permission engine)",
  () => {
    const direct = directPool();
    let app: INestApplication;

    let A: SeededTenant; // has a code counter
    let B: SeededTenant; // cross-tenant

    let fullEmail = ""; // create:employee + create:user
    let empOnlyEmail = ""; // create:employee only
    let userOnlyEmail = ""; // create:user only (no create:employee)
    let unlinkedUserId = ""; // an unlinked user in A (link-existing target)
    let bUserId = ""; // a user in B (cross-tenant target)

    beforeAll(async () => {
      const hash = await hashedPw();
      A = await seedCompany(direct, "int1A");
      B = await seedCompany(direct, "int1B");
      await seedEmployeeCodeCounter(direct, A.companyId);

      fullEmail = `full@${A.slug}.test`;
      const fullId = await seedUser(direct, A.companyId, fullEmail, hash);
      await grantPairs(direct, A.companyId, fullId, [CREATE_EMPLOYEE, CREATE_USER]);

      empOnlyEmail = `emponly@${A.slug}.test`;
      const empOnlyId = await seedUser(direct, A.companyId, empOnlyEmail, hash);
      await grantPairs(direct, A.companyId, empOnlyId, [CREATE_EMPLOYEE]);

      userOnlyEmail = `useronly@${A.slug}.test`;
      const userOnlyId = await seedUser(direct, A.companyId, userOnlyEmail, hash);
      await grantPairs(direct, A.companyId, userOnlyId, [CREATE_USER]);

      // An unlinked user in A (no employee_profiles row) — the link-existing target.
      unlinkedUserId = await seedUser(direct, A.companyId, `unlinked@${A.slug}.test`, hash);
      // A user in B — the cross-tenant target.
      bUserId = await seedUser(direct, B.companyId, `bperson@${B.slug}.test`, hash);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
    });

    afterAll(async () => {
      for (const id of [A.companyId, B.companyId]) {
        await direct
          .query("DELETE FROM employee_manager_relations WHERE company_id = $1", [id])
          .catch(() => undefined);
        await direct
          .query("DELETE FROM employee_profiles WHERE company_id = $1", [id])
          .catch(() => undefined);
      }
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      if (app) await app.close();
    });

    it("provision happy: create:employee + create:user → 201, hashed account + linked + BOTH audits", async () => {
      const token = await login(app, A.slug, fullEmail);
      const email = `hire1@${A.slug}.test`;
      const beforeUser = await countAudit(direct, A.companyId, "user", "user.created");
      const beforeEmp = await countAudit(direct, A.companyId, "employee", "create");

      const res = await api(app)
        .post("/hr/employees")
        .set(bearer(token))
        .send({ email, fullName: "Hire One" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);

      const created = await userByEmail(direct, A.companyId, email);
      expect(created).toBeTruthy();
      expect(res.body.data.userId).toBe(created!.id);
      // password is HASHED, never the plaintext.
      expect(created!.password_hash).not.toBe(PASSWORD);
      expect(created!.password_hash.length).toBeGreaterThan(20);

      const empRow = await direct.query("SELECT user_id FROM employee_profiles WHERE id = $1", [
        res.body.data.id,
      ]);
      expect(empRow.rows[0].user_id).toBe(created!.id);

      expect(await countAudit(direct, A.companyId, "user", "user.created")).toBe(beforeUser + 1);
      expect(await countAudit(direct, A.companyId, "employee", "create")).toBe(beforeEmp + 1);
    });

    it("provision DENY: create:employee but NOT create:user → 403 + ZERO writes", async () => {
      const token = await login(app, A.slug, empOnlyEmail);
      const email = `denied@${A.slug}.test`;
      const beforeUser = await countAudit(direct, A.companyId, "user", "user.created");
      const beforeEmp = await countAudit(direct, A.companyId, "employee", "create");

      const res = await api(app)
        .post("/hr/employees")
        .set(bearer(token))
        .send({ email, fullName: "Denied" });
      expect(res.status, JSON.stringify(res.body)).toBe(403);

      expect(await userByEmail(direct, A.companyId, email)).toBeUndefined();
      expect(await countAudit(direct, A.companyId, "user", "user.created")).toBe(beforeUser);
      expect(await countAudit(direct, A.companyId, "employee", "create")).toBe(beforeEmp);
    });

    it("mirror DENY: create:user but NOT create:employee → 403 (controller guard)", async () => {
      const token = await login(app, A.slug, userOnlyEmail);
      const res = await api(app)
        .post("/hr/employees")
        .set(bearer(token))
        .send({ email: `m@${A.slug}.test`, fullName: "Mirror" });
      expect(res.status).toBe(403);
    });

    it("link-existing needs only create:employee → 201 and NO user.created audit", async () => {
      const token = await login(app, A.slug, empOnlyEmail);
      const beforeUser = await countAudit(direct, A.companyId, "user", "user.created");

      const res = await api(app)
        .post("/hr/employees")
        .set(bearer(token))
        .send({ userId: unlinkedUserId });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.userId).toBe(unlinkedUserId);
      // No account minted → no user.created audit added.
      expect(await countAudit(direct, A.companyId, "user", "user.created")).toBe(beforeUser);
    });

    it("rollback: a reference failure after provisioning rolls back the whole tx (no orphan user)", async () => {
      const token = await login(app, A.slug, fullEmail);
      const email = `rollback@${A.slug}.test`;
      const beforeUser = await countAudit(direct, A.companyId, "user", "user.created");

      const res = await api(app)
        .post("/hr/employees")
        .set(bearer(token))
        .send({ email, fullName: "Rollback", orgUnitId: RANDOM_UUID });
      expect(res.status, JSON.stringify(res.body)).toBe(422);

      // The user was provisioned inside the tx, then the reference check failed → fully rolled back.
      expect(await userByEmail(direct, A.companyId, email)).toBeUndefined();
      expect(await countAudit(direct, A.companyId, "user", "user.created")).toBe(beforeUser);
    });

    it("2-tenant: linking a user that lives in another company → 404 (never cross-links)", async () => {
      const token = await login(app, A.slug, fullEmail);
      const res = await api(app).post("/hr/employees").set(bearer(token)).send({ userId: bUserId });
      expect(res.status).toBe(404);
    });

    it("unique active link: a user already linked to an active employee → 409", async () => {
      const token = await login(app, A.slug, fullEmail);
      const first = await api(app)
        .post("/hr/employees")
        .set(bearer(token))
        .send({ email: `uniq@${A.slug}.test`, fullName: "Uniq" });
      expect(first.status).toBe(201);
      const linkedUserId = first.body.data.userId as string;

      const dup = await api(app)
        .post("/hr/employees")
        .set(bearer(token))
        .send({ userId: linkedUserId });
      expect(dup.status).toBe(409);
    });

    // ── Legacy POST /employees must enforce the SAME gate (no bypass of /hr/employees) ──────────
    it("legacy /employees provision DENY: create:employee but NOT create:user → 403 + 0 writes", async () => {
      const token = await login(app, A.slug, empOnlyEmail);
      const email = `legacy-deny@${A.slug}.test`;
      const beforeUser = await countAudit(direct, A.companyId, "user", "user.created");

      const res = await api(app)
        .post("/employees")
        .set(bearer(token))
        .send({ email, fullName: "Legacy Denied" });
      expect(res.status, JSON.stringify(res.body)).toBe(403);

      expect(await userByEmail(direct, A.companyId, email)).toBeUndefined();
      expect(await countAudit(direct, A.companyId, "user", "user.created")).toBe(beforeUser);
    });

    it("legacy /employees provision with create:user → 201 + a user.created audit", async () => {
      const token = await login(app, A.slug, fullEmail);
      const email = `legacy-ok@${A.slug}.test`;
      const beforeUser = await countAudit(direct, A.companyId, "user", "user.created");

      const res = await api(app)
        .post("/employees")
        .set(bearer(token))
        .send({ email, fullName: "Legacy Ok" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);

      const created = await userByEmail(direct, A.companyId, email);
      expect(created).toBeTruthy();
      expect(created!.password_hash).not.toBe(PASSWORD);
      expect(await countAudit(direct, A.companyId, "user", "user.created")).toBe(beforeUser + 1);
    });

    it("legacy /employees 2-tenant: linking a user from another company → 404", async () => {
      const token = await login(app, A.slug, fullEmail);
      const res = await api(app).post("/employees").set(bearer(token)).send({ userId: bUserId });
      expect(res.status).toBe(404);
    });
  },
);
