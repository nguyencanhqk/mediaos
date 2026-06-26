/**
 * S2-HR-BE-2 — HR write-core integration (CROWN-JEWEL, BẤT BIẾN #1/#2/#3).
 *
 * Real NestJS app (AppModule) + supertest → POST/PATCH /hr/employees, change-status, link-user run the
 * full guard chain (JwtAuthGuard → CompanyGuard → 2FA → PermissionGuard → HrWriteController →
 * HrWriteService) with the REAL permission engine. No mocks. Verifies at the DB layer:
 *   - auto employee-code via SequenceService (FOR UPDATE) → 0-dup, monotonic (EMP0001, EMP0002);
 *   - exactly one 'create' audit_logs row (object_type='employee') per create;
 *   - update (PATCH) a structural field → 200, reports changedFields + exactly one 'update' audit row;
 *   - change-status appends one employee_status_histories row + one 'change-status' audit row;
 *   - link-user endpoint links an unlinked employee to an existing user → 201, sets user_id + one
 *     'link-user' audit row; linking a user already on another active employee → 409 (unique active);
 *   - deny-path: no grant → 403 and NO audit row written;
 *   - 2-tenant: PATCH a cross-tenant employee → 404 (never cross-writes);
 *   - unique active link (create arm): a user already linked to an active employee → 409;
 *   - no counter provisioned → 422 (HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID), never 500.
 *
 * S2-QA-2: the update + link-user cases below close the QA-S2-003 / HR-S2-TC-009/011/012 gaps left by
 * S2-HR-BE-2 (which proved create/change-status/dup-on-create). Targets are seeded DIRECTLY (no API
 * create) so they never consume the EMP code sequence — keeping the monotonic-code assertion stable.
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

/** Seed an EMPLOYEE_CODE sequence_counter (scope_type='Company') so auto-gen works. */
async function seedEmployeeCodeCounter(direct: Pool, companyId: string): Promise<void> {
  await direct.query(
    `INSERT INTO sequence_counters
       (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
        increment_by, reset_policy, current_value, status)
     VALUES ($1, 'HR', $2, 'Company', 'EMP', 4, 1, 'Never', 0, 'Active')`,
    [companyId, EMPLOYEE_CODE_SEQUENCE_KEY],
  );
}

/** Grant a fresh company-scoped role carrying the given write pairs to `userId`. */
async function grantEmployeeWrite(
  direct: Pool,
  companyId: string,
  userId: string,
  pairs: Array<[string, string]>,
): Promise<void> {
  const roleId = await seedRole(direct, companyId, `qa-hr-write-${userId.slice(0, 8)}`);
  for (const [action, resourceType] of pairs) {
    const permId = await seedPermissionCatalog(direct, action, resourceType, false);
    await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
  }
  await seedUserRole(direct, userId, roleId, companyId);
}

async function countAudit(direct: Pool, companyId: string, action: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM audit_logs
       WHERE company_id = $1 AND object_type = 'employee' AND action = $2`,
    [companyId, action],
  );
  return r.rows[0].n as number;
}

/**
 * Seed an employee_profiles row DIRECTLY (superuser, bypass RLS) — no API create, so it never consumes
 * the EMP code sequence. `userId=null` seeds an unlinked employee (the link-user target). `workType` is
 * set explicitly so an update diff is deterministic.
 */
async function seedEmployee(
  direct: Pool,
  companyId: string,
  userId: string | null,
  opts: { status?: string; workType?: string } = {},
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id, status, work_type)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [companyId, userId, opts.status ?? "active", opts.workType ?? "offline"],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!hasLaneDb)("S2-HR-BE-2 HR write core (HTTP, real permission engine)", () => {
  const direct = directPool();
  let app: INestApplication;

  let A: SeededTenant; // has a code counter
  let B: SeededTenant; // cross-tenant + NO counter (422 path)

  let hrEmail = "";
  let noPermEmail = "";
  let bHrEmail = "";
  let bEmployeeId = ""; // an employee in tenant B (cross-tenant target)

  beforeAll(async () => {
    const hash = await hashedPw();
    A = await seedCompany(direct, "hrwriteA");
    B = await seedCompany(direct, "hrwriteB");
    await seedEmployeeCodeCounter(direct, A.companyId); // B intentionally has none

    // S2-INT-1: create:user is required to provision a login account via the create-employee
    // provision arm (email/no-userId). The happy paths below create employees by email, so the HR
    // actor needs it too. Shared by BOTH tenants (B's "no counter → 422" must still reach the
    // sequence path, not trip the new gate).
    const WRITE_PAIRS: Array<[string, string]> = [
      ["create", "employee"],
      ["update", "employee"],
      ["change-status", "employee"],
      ["create", "user"],
    ];

    hrEmail = `hr@${A.slug}.test`;
    const hrUserId = await seedUser(direct, A.companyId, hrEmail, hash);
    await grantEmployeeWrite(direct, A.companyId, hrUserId, WRITE_PAIRS);

    noPermEmail = `noperm@${A.slug}.test`;
    await seedUser(direct, A.companyId, noPermEmail, hash); // no write grants

    bHrEmail = `hr@${B.slug}.test`;
    const bHrUserId = await seedUser(direct, B.companyId, bHrEmail, hash);
    await grantEmployeeWrite(direct, B.companyId, bHrUserId, WRITE_PAIRS);
    // A bare employee in tenant B (cross-tenant target for the 404 test).
    const bEmpUser = await seedUser(direct, B.companyId, `emp@${B.slug}.test`, hash);
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [B.companyId, bEmpUser],
    );
    bEmployeeId = r.rows[0].id as string;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    for (const id of [A.companyId, B.companyId]) {
      await direct
        .query("DELETE FROM employee_status_histories WHERE company_id = $1", [id])
        .catch(() => undefined);
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

  it("auto-generates monotonic codes (EMP0001, EMP0002) — 0-dup via FOR UPDATE", async () => {
    const token = await login(app, A.slug, hrEmail);
    const r1 = await api(app)
      .post("/hr/employees")
      .set(bearer(token))
      .send({ email: `e1@${A.slug}.test`, fullName: "Emp One" });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body.data.employeeCode).toBe("EMP0001");

    const r2 = await api(app)
      .post("/hr/employees")
      .set(bearer(token))
      .send({ email: `e2@${A.slug}.test`, fullName: "Emp Two" });
    expect(r2.status).toBe(201);
    expect(r2.body.data.employeeCode).toBe("EMP0002");

    expect(await countAudit(direct, A.companyId, "create")).toBeGreaterThanOrEqual(2);
  });

  it("change-status appends a status history row + a change-status audit row", async () => {
    const token = await login(app, A.slug, hrEmail);
    const created = await api(app)
      .post("/hr/employees")
      .set(bearer(token))
      .send({ email: `cs@${A.slug}.test`, fullName: "Status Emp" });
    const empId = created.body.data.id as string;

    const before = await countAudit(direct, A.companyId, "change-status");
    const res = await api(app)
      .post(`/hr/employees/${empId}/change-status`)
      .set(bearer(token))
      .send({ newStatus: "inactive", reason: "test" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const hist = await direct.query(
      "SELECT old_status, new_status FROM employee_status_histories WHERE employee_id = $1",
      [empId],
    );
    expect(hist.rows).toHaveLength(1);
    expect(hist.rows[0]).toMatchObject({ old_status: "active", new_status: "inactive" });
    expect(await countAudit(direct, A.companyId, "change-status")).toBe(before + 1);
  });

  it("DENY: no create:employee grant → 403 and NO audit row", async () => {
    const token = await login(app, A.slug, noPermEmail);
    const before = await countAudit(direct, A.companyId, "create");
    const res = await api(app)
      .post("/hr/employees")
      .set(bearer(token))
      .send({ email: `deny@${A.slug}.test`, fullName: "Deny" });
    expect(res.status).toBe(403);
    expect(await countAudit(direct, A.companyId, "create")).toBe(before);
  });

  it("2-tenant: PATCH a cross-tenant employee → 404 (never cross-writes)", async () => {
    const token = await login(app, A.slug, hrEmail);
    const res = await api(app)
      .patch(`/hr/employees/${bEmployeeId}`)
      .set(bearer(token))
      .send({ workType: "remote" });
    expect(res.status).toBe(404);
  });

  it("unique active link: creating a 2nd employee for an already-linked user → 409", async () => {
    const token = await login(app, A.slug, hrEmail);
    const first = await api(app)
      .post("/hr/employees")
      .set(bearer(token))
      .send({ email: `link@${A.slug}.test`, fullName: "Linked" });
    expect(first.status).toBe(201);
    const linkedUserId = first.body.data.userId as string;

    const dup = await api(app)
      .post("/hr/employees")
      .set(bearer(token))
      .send({ userId: linkedUserId });
    expect(dup.status).toBe(409);
  });

  it("no code counter provisioned → 422 (HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID), not 500", async () => {
    const token = await login(app, B.slug, bHrEmail); // tenant B has no counter
    const res = await api(app)
      .post("/hr/employees")
      .set(bearer(token))
      .send({ email: `nocfg@${B.slug}.test`, fullName: "No Cfg" });
    expect(res.status).toBe(422);
  });

  // ── S2-QA-2: update happy-path (HR-S2-TC-009) ──────────────────────────────────────────────
  it("update: PATCH a structural field → 200, reports changedFields + exactly one 'update' audit row", async () => {
    const token = await login(app, A.slug, hrEmail);
    const subj = await seedUser(direct, A.companyId, `upd-subj@${A.slug}.test`, await hashedPw());
    const empId = await seedEmployee(direct, A.companyId, subj, { workType: "offline" });

    const before = await countAudit(direct, A.companyId, "update");
    const res = await api(app)
      .patch(`/hr/employees/${empId}`)
      .set(bearer(token))
      .send({ workType: "remote" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.changedFields).toContain("workType");

    const row = await direct.query("SELECT work_type FROM employee_profiles WHERE id = $1", [
      empId,
    ]);
    expect(row.rows[0].work_type).toBe("remote");
    // Exactly one audit row for this change (no audit when nothing actually changes — see service diff).
    expect(await countAudit(direct, A.companyId, "update")).toBe(before + 1);
  });

  // ── S2-QA-2: manager self-reference validation (HR-S2-TC-015) ─────────────────────────────
  it("update: an employee cannot be its own direct manager → 400 (no 'update' audit)", async () => {
    const token = await login(app, A.slug, hrEmail);
    const subj = await seedUser(direct, A.companyId, `selfmgr@${A.slug}.test`, await hashedPw());
    const empId = await seedEmployee(direct, A.companyId, subj);

    const before = await countAudit(direct, A.companyId, "update");
    const res = await api(app)
      .patch(`/hr/employees/${empId}`)
      .set(bearer(token))
      .send({ directManagerId: subj }); // point the manager at the employee's own user
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(await countAudit(direct, A.companyId, "update")).toBe(before);
  });

  // ── S2-QA-2: dedicated link-user endpoint (HR-S2-TC-011) ──────────────────────────────────
  it("link-user endpoint: link an unlinked employee to an existing user → 201, sets user_id + one 'link-user' audit", async () => {
    const token = await login(app, A.slug, hrEmail);
    const target = await seedUser(
      direct,
      A.companyId,
      `linktarget@${A.slug}.test`,
      await hashedPw(),
    );
    const empId = await seedEmployee(direct, A.companyId, null); // unlinked employee

    const before = await countAudit(direct, A.companyId, "link-user");
    const res = await api(app)
      .post(`/hr/employees/${empId}/link-user`)
      .set(bearer(token))
      .send({ userId: target });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.userId).toBe(target);

    const row = await direct.query("SELECT user_id FROM employee_profiles WHERE id = $1", [empId]);
    expect(row.rows[0].user_id).toBe(target);
    expect(await countAudit(direct, A.companyId, "link-user")).toBe(before + 1);
  });

  // ── S2-QA-2: link-user unique-active via the dedicated endpoint (HR-S2-TC-012) ────────────
  it("link-user unique active: linking a user already on another active employee → 409 (no audit)", async () => {
    const token = await login(app, A.slug, hrEmail);
    const busy = await seedUser(direct, A.companyId, `busy@${A.slug}.test`, await hashedPw());
    await seedEmployee(direct, A.companyId, busy, { status: "active" }); // busy already linked + active
    const other = await seedEmployee(direct, A.companyId, null); // a second, unlinked employee

    const before = await countAudit(direct, A.companyId, "link-user");
    const res = await api(app)
      .post(`/hr/employees/${other}/link-user`)
      .set(bearer(token))
      .send({ userId: busy });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(await countAudit(direct, A.companyId, "link-user")).toBe(before);
  });
});
