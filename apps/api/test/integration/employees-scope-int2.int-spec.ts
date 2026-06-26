/**
 * S2-INT-2 — HR direct_manager / employee_manager_relations ↔ data-scope Team/Department (CROWN-JEWEL).
 *
 * Boots the REAL NestJS app (AppModule) + supertest so GET /hr/employees and /hr/employees/:id run the
 * full stack JwtAuthGuard → CompanyGuard → PermissionGuard → HrReadService → DataScopeService →
 * DataScopeRepository → DB. Proves the INTEGRATION (not just the predicate) end-to-end:
 *
 *   - Team now reads employee_manager_relations (EMR): a project_manager (NOT the direct_manager_id
 *     shortcut) sees the employee they manage — multi-manager (đa-quản-lý).
 *   - Department now reads org_units.head_user_id: a unit HEAD sees employees in the unit they head even
 *     when their own profile sits in a different unit.
 *   - NO stale scope: inserting a new EMR relation between two requests is reflected immediately (the
 *     resolver reads fresh each call — done_when #2).
 *   - DENY-PATH RED: a manager sees NOTHING outside their tree (list + detail 404); cross-tenant denies
 *     even for a managed target (BẤT BIẾN #1).
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): .env pointing at the shared dev DB makes
 * hasDb=true, so these DB assertions only run under an isolated LANE_DB.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
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
type DataScope = "Own" | "Team" | "Department" | "Company" | "System";

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

describe.skipIf(!hasLaneDb)("S2-INT-2 HR manager-tree ↔ data-scope (HTTP, real engine)", () => {
  const direct = directPool();
  let app: INestApplication;

  let A: SeededTenant;
  let B: SeededTenant;

  let ouEng = "";
  let ouSales = "";
  let ouFar = "";

  // tenant A users
  let pmUserId = ""; // project manager — manages `empUserId` via EMR (NOT a direct report), Team scope
  let empUserId = ""; // managed by pm via EMR, sits in Engineering
  let strangerUserId = ""; // unmanaged, Sales — pm must NOT see
  let lateUserId = ""; // EMR relation added at runtime to prove fresh (no-cache) read
  let headUserId = ""; // heads Engineering, own profile in Sales, Department scope
  let farUserId = ""; // sits in ouFar — head must NOT see

  let empProfileId = "";
  let strangerProfileId = "";
  let lateProfileId = "";

  // tenant B
  let bUserId = "";
  let bProfileId = "";

  async function seedOrgUnit(
    companyId: string,
    name: string,
    headUserId?: string,
  ): Promise<string> {
    const r = await direct.query(
      "INSERT INTO org_units (company_id, name, type, head_user_id) VALUES ($1, $2, 'department', $3) RETURNING id",
      [companyId, name, headUserId ?? null],
    );
    return r.rows[0].id as string;
  }

  async function seedEmployee(
    companyId: string,
    userId: string,
    orgUnitId: string | null,
    directManagerUserId: string | null,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, direct_manager_id, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [companyId, userId, orgUnitId, directManagerUserId],
    );
    return r.rows[0].id as string;
  }

  /** Seed an ACTIVE EMR relation: `managerUserId` manages `employeeUserId` (default a non-direct type). */
  async function seedEmr(
    companyId: string,
    managerUserId: string,
    employeeUserId: string,
    relationType = "project_manager",
  ): Promise<void> {
    await direct.query(
      `INSERT INTO employee_manager_relations (company_id, manager_user_id, employee_user_id, relation_type, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [companyId, managerUserId, employeeUserId, relationType],
    );
  }

  async function grantReadEmployee(
    companyId: string,
    userId: string,
    scope: DataScope,
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `int2-read-${scope}-${userId.slice(0, 8)}`);
    const permId = await seedPermissionCatalog(direct, "read", "employee", false);
    await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function listVisibleUserIds(token: string): Promise<string[]> {
    const res = await api(app).get("/hr/employees?pageSize=100").set(bearer(token));
    expect(res.status, `list failed: ${JSON.stringify(res.body)}`).toBe(200);
    const rows = res.body.data.items as Array<{ userId: string }>;
    expect(Array.isArray(rows)).toBe(true);
    return rows.map((r) => r.userId);
  }

  beforeAll(async () => {
    const hash = await hashedPw();

    A = await seedCompany(direct, "int2A");
    B = await seedCompany(direct, "int2B");

    // users first (org-unit head + EMR reference users.id)
    pmUserId = await seedUser(direct, A.companyId, `pm@${A.slug}.test`, hash);
    empUserId = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
    strangerUserId = await seedUser(direct, A.companyId, `stranger@${A.slug}.test`, hash);
    lateUserId = await seedUser(direct, A.companyId, `late@${A.slug}.test`, hash);
    headUserId = await seedUser(direct, A.companyId, `head@${A.slug}.test`, hash);
    farUserId = await seedUser(direct, A.companyId, `far@${A.slug}.test`, hash);

    ouEng = await seedOrgUnit(A.companyId, "Engineering", headUserId); // head heads Engineering
    ouSales = await seedOrgUnit(A.companyId, "Sales");
    ouFar = await seedOrgUnit(A.companyId, "Faraway");

    // profiles
    await seedEmployee(A.companyId, pmUserId, ouSales, null); // pm's own profile (Sales)
    empProfileId = await seedEmployee(A.companyId, empUserId, ouEng, null); // managed by pm via EMR only
    strangerProfileId = await seedEmployee(A.companyId, strangerUserId, ouSales, null); // unmanaged
    lateProfileId = await seedEmployee(A.companyId, lateUserId, ouSales, null); // EMR added later
    await seedEmployee(A.companyId, headUserId, ouSales, null); // head's own profile (Sales)
    await seedEmployee(A.companyId, farUserId, ouFar, null); // outside head's units

    // EMR: pm manages emp (project_manager — NOT a direct_manager_id shortcut)
    await seedEmr(A.companyId, pmUserId, empUserId);

    // grants
    await grantReadEmployee(A.companyId, pmUserId, "Team");
    await grantReadEmployee(A.companyId, headUserId, "Department");

    // tenant B
    bUserId = await seedUser(direct, B.companyId, `b@${B.slug}.test`, hash);
    bProfileId = await seedEmployee(B.companyId, bUserId, null, null);
    await grantReadEmployee(B.companyId, bUserId, "Company");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await direct
      .query("DELETE FROM employee_manager_relations WHERE company_id = ANY($1::uuid[])", [
        [A.companyId, B.companyId],
      ])
      .catch(() => undefined);
    await direct
      .query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [
        [A.companyId, B.companyId],
      ])
      .catch(() => undefined);
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    if (app) await app.close();
  });

  // ── Team over EMR (multi-manager) ────────────────────────────────────────────────

  it("Team: a project_manager sees the EMR-managed employee + self, NOT an unmanaged stranger", async () => {
    const token = await login(app, A.slug, `pm@${A.slug}.test`);
    const seen = await listVisibleUserIds(token);
    expect(seen).toContain(empUserId); // managed via EMR (no direct_manager_id link)
    expect(seen).toContain(pmUserId); // self
    expect(seen).not.toContain(strangerUserId); // DENY — outside the manager's tree
    expect(seen).not.toContain(farUserId);
  });

  it("Team detail: pm reads the EMR-managed employee (200) but a stranger is 404 (no leak)", async () => {
    const token = await login(app, A.slug, `pm@${A.slug}.test`);
    const ok = await api(app).get(`/hr/employees/${empProfileId}`).set(bearer(token));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.userId).toBe(empUserId);

    const denied = await api(app).get(`/hr/employees/${strangerProfileId}`).set(bearer(token));
    expect(denied.status).toBe(404);
    expect(denied.body.success).toBe(false);
  });

  it("no stale scope: an EMR relation inserted between requests is reflected immediately", async () => {
    const token = await login(app, A.slug, `pm@${A.slug}.test`);
    const before = await listVisibleUserIds(token);
    expect(before).not.toContain(lateUserId);

    await seedEmr(A.companyId, pmUserId, lateUserId, "temporary_manager");

    const after = await listVisibleUserIds(token);
    expect(after).toContain(lateUserId); // newly-managed employee now visible — resolver read fresh
    void lateProfileId;
  });

  // ── Department over org-unit head ─────────────────────────────────────────────────

  it("Department: a unit HEAD sees employees of the unit they head (own profile in another unit)", async () => {
    const token = await login(app, A.slug, `head@${A.slug}.test`);
    const seen = await listVisibleUserIds(token);
    expect(seen).toContain(empUserId); // Engineering — via headed unit, head's own profile is in Sales
    expect(seen).toContain(headUserId); // own unit (Sales)
    expect(seen).not.toContain(farUserId); // DENY — ouFar is neither owned nor headed
  });

  it("Department detail: head reads a headed-unit employee (200) but an outside-unit employee is 404", async () => {
    const token = await login(app, A.slug, `head@${A.slug}.test`);
    const ok = await api(app).get(`/hr/employees/${empProfileId}`).set(bearer(token));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    // farUserId sits in ouFar (not owned, not headed) → 404, never 200/403.
    const farProfile = await direct.query(
      "SELECT id FROM employee_profiles WHERE user_id = $1 LIMIT 1",
      [farUserId],
    );
    const denied = await api(app).get(`/hr/employees/${farProfile.rows[0].id}`).set(bearer(token));
    expect(denied.status).toBe(404);
  });

  // ── Cross-tenant deny (BẤT BIẾN #1) ───────────────────────────────────────────────

  it("cross-tenant: tenant B Company-scope user never sees tenant A managed/headed employees", async () => {
    const token = await login(app, B.slug, `b@${B.slug}.test`);
    const seen = await listVisibleUserIds(token);
    expect(seen).toContain(bUserId);
    for (const aUser of [pmUserId, empUserId, strangerUserId, headUserId, farUserId]) {
      expect(seen).not.toContain(aUser);
    }
    void bProfileId;
  });
});
