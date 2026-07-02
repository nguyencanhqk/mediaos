/**
 * S2-HR-BE-6 — Employee contracts (hợp đồng lao động) integration (CROWN-JEWEL: permission + audit +
 * tenant + append-only + PII). Real NestJS app (AppModule) + supertest → runs the full guard chain
 * (JwtAuthGuard → CompanyGuard → 2FA → PermissionGuard → ContractController → ContractService) with the
 * REAL permission engine. No mocks. Verifies at the DB layer:
 *
 *   SCOPE FIX (owner-chốt 2026-07-02, session 1849d064, harness/handoff.md, mig 0465 — supersedes the
 *     mig 0462 "employee/manager 403" scope which was WRONG vs the original expectation): employee holds
 *     view:contract@Own → sees/detail ONLY their own contract, 404 on anyone else's; manager holds
 *     view:contract@Team → sees/detail ONLY their direct reports' contracts (S2-INT-2 manager-tree via
 *     DataScopeService, reused — no new scope logic), 404 on an outsider's; hr/company-admin stay
 *     view+manage:contract@Company (unchanged, mig 0462). manage:contract stays Company-only — employee/
 *     manager (view-only) still 403 on POST/PATCH/DELETE/link-file. noPerm (no grant at all) → 403.
 *   happy: hr can list/create/update/delete; create writes EXACTLY one audit row object_type=
 *     'employee_contract' in-tx; delete is SOFT (row stays, deleted_at set) with an audit row.
 *   RLS 2-tenant: tenant A cannot read/mutate tenant B's contracts; contract_type cross-tenant → 400.
 *   PII allowlist (done_when #5): list/detail DTO exposes only the allowlisted fields (no raw salary/PII).
 *   audit-in-tx (BẤT BIẾN #2): a post-audit failure rolls back BOTH the contract write and the audit row.
 *   append-only (BẤT BIẾN #2): mediaos_app UPDATE/DELETE of a contract audit row → DENIED.
 *   expiry warning: an Active contract with end_date within 30 days (company-configurable, default
 *     milestones [30,7] — hr.contract_expiring_warning_days) → expiringSoon=true.
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
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { ContractRepository } from "../../src/employees/contract.repository";
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

/** Grant a fresh company-scoped role carrying the given pairs to `userId` at `scope` (default Company). */
async function grant(
  direct: Pool,
  companyId: string,
  userId: string,
  pairs: Array<[string, string]>,
  scope: "Own" | "Team" | "Department" | "Company" | "System" = "Company",
): Promise<void> {
  const roleId = await seedRole(
    direct,
    companyId,
    `qa-contract-${scope.toLowerCase()}-${userId.slice(0, 8)}`,
  );
  for (const [action, resourceType] of pairs) {
    const permId = await seedPermissionCatalog(direct, action, resourceType, false);
    await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
  }
  await seedUserRole(direct, userId, roleId, companyId);
}

async function seedEmployee(direct: Pool, companyId: string): Promise<string> {
  const u = await seedUser(
    direct,
    companyId,
    `emp-${Math.random().toString(36).slice(2, 8)}@x.test`,
  );
  const r = await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
    [companyId, u],
  );
  return r.rows[0].id as string;
}

/** employee_profiles row for a GIVEN userId (Own/Team scope fixtures need the profile pinned to the actor). */
async function seedEmployeeForUser(
  direct: Pool,
  companyId: string,
  userId: string,
  directManagerUserId: string | null = null,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id, direct_manager_id) VALUES ($1, $2, $3) RETURNING id`,
    [companyId, userId, directManagerUserId],
  );
  return r.rows[0].id as string;
}

async function seedContractType(
  direct: Pool,
  companyId: string,
  requiresEndDate = false,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO contract_types (company_id, name, requires_end_date)
     VALUES ($1, $2, $3) RETURNING id`,
    [companyId, `ct-${Math.random().toString(36).slice(2, 8)}`, requiresEndDate],
  );
  return r.rows[0].id as string;
}

async function countContractAudit(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM audit_logs
       WHERE company_id = $1 AND object_type = 'employee_contract'`,
    [companyId],
  );
  return r.rows[0].n as number;
}

async function rawContract(
  direct: Pool,
  id: string,
): Promise<{ status: string; deletedAt: Date | null } | undefined> {
  const r = await direct.query(
    `SELECT status, deleted_at AS "deletedAt" FROM employee_contracts WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}

const VIEW: Array<[string, string]> = [["view", "contract"]];
const VIEW_MANAGE: Array<[string, string]> = [
  ["view", "contract"],
  ["manage", "contract"],
];

describe.skipIf(!hasLaneDb)("S2-HR-BE-6 employee contracts (HTTP, real permission engine)", () => {
  const direct = directPool();
  const app = appPool();
  let nest: INestApplication;

  let A: SeededTenant;
  let B: SeededTenant;
  let hrEmail = "";
  let hrUserId = "";
  let employeeEmail = ""; // view:contract @ Own — sees ONLY their own contract
  let managerEmail = ""; // view:contract @ Team — sees ONLY their reports' contracts (S2-INT-2 direct-manager)
  let outsiderEmail = ""; // employee profile OUTSIDE the manager's team + not self — for Team 404
  let noPermEmail = "";
  let empA = ""; // employee_profile id in A (HR-created fixture, unrelated to any actor)
  let ctA = ""; // contract_type id in A
  let ctB = ""; // contract_type id in B
  let empB = ""; // employee_profile id in B

  let empUserId = ""; // users.id for employeeEmail
  let empProfileId = ""; // employee_profiles.id for employeeEmail (Own target)
  let empOwnContractId = ""; // contract belonging to employeeEmail
  let mgrUserId = ""; // users.id for managerEmail
  let reportProfileId = ""; // employee_profiles.id whose direct_manager_id = mgrUserId (Team target)
  let reportContractId = ""; // contract belonging to the manager's report
  let outsiderProfileId = ""; // employee_profiles.id NOT managed by mgrUserId, NOT self
  let outsiderContractId = ""; // contract belonging to the outsider — Own/Team callers must 404 on this

  beforeAll(async () => {
    const hash = await hashedPw();
    A = await seedCompany(direct, "contractA");
    B = await seedCompany(direct, "contractB");

    hrEmail = `hr@${A.slug}.test`;
    hrUserId = await seedUser(direct, A.companyId, hrEmail, hash);
    await grant(direct, A.companyId, hrUserId, VIEW_MANAGE, "Company");

    // ── employee (Own scope, S2-HR-BE-6 fix) ────────────────────────────────────
    employeeEmail = `emp-user@${A.slug}.test`;
    empUserId = await seedUser(direct, A.companyId, employeeEmail, hash);
    await grant(direct, A.companyId, empUserId, VIEW, "Own");
    empProfileId = await seedEmployeeForUser(direct, A.companyId, empUserId);
    const ctOwn = await seedContractType(direct, A.companyId);
    const ownRow = await direct.query(
      `INSERT INTO employee_contracts (company_id, employee_id, contract_type_id, contract_code, start_date, status)
       VALUES ($1, $2, $3, 'OWN-CODE', '2025-01-01', 'Active') RETURNING id`,
      [A.companyId, empProfileId, ctOwn],
    );
    empOwnContractId = ownRow.rows[0].id as string;

    // ── manager (Team scope, S2-HR-BE-6 fix) — a direct report + an outsider ────
    managerEmail = `mgr@${A.slug}.test`;
    mgrUserId = await seedUser(direct, A.companyId, managerEmail, hash);
    await grant(direct, A.companyId, mgrUserId, VIEW, "Team");

    const reportUserId = await seedUser(direct, A.companyId, `report@${A.slug}.test`, hash);
    reportProfileId = await seedEmployeeForUser(direct, A.companyId, reportUserId, mgrUserId);
    const ctReport = await seedContractType(direct, A.companyId);
    const reportRow = await direct.query(
      `INSERT INTO employee_contracts (company_id, employee_id, contract_type_id, contract_code, start_date, status)
       VALUES ($1, $2, $3, 'REPORT-CODE', '2025-01-01', 'Active') RETURNING id`,
      [A.companyId, reportProfileId, ctReport],
    );
    reportContractId = reportRow.rows[0].id as string;

    outsiderEmail = `outsider@${A.slug}.test`;
    const outsiderUserId = await seedUser(direct, A.companyId, outsiderEmail, hash);
    outsiderProfileId = await seedEmployeeForUser(direct, A.companyId, outsiderUserId, null);
    const ctOutsider = await seedContractType(direct, A.companyId);
    const outsiderRow = await direct.query(
      `INSERT INTO employee_contracts (company_id, employee_id, contract_type_id, contract_code, start_date, status)
       VALUES ($1, $2, $3, 'OUTSIDER-CODE', '2025-01-01', 'Active') RETURNING id`,
      [A.companyId, outsiderProfileId, ctOutsider],
    );
    outsiderContractId = outsiderRow.rows[0].id as string;

    noPermEmail = `noperm@${A.slug}.test`;
    await seedUser(direct, A.companyId, noPermEmail, hash);

    empA = await seedEmployee(direct, A.companyId);
    ctA = await seedContractType(direct, A.companyId);

    empB = await seedEmployee(direct, B.companyId);
    ctB = await seedContractType(direct, B.companyId);
    // B gets a distinctive contract so a cross-tenant read leak would be observable.
    await direct.query(
      `INSERT INTO employee_contracts
         (company_id, employee_id, contract_type_id, contract_code, start_date, status)
       VALUES ($1, $2, $3, 'B-SECRET-CODE', '2024-01-01', 'Active')`,
      [B.companyId, empB, ctB],
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
        .query("DELETE FROM employee_contracts WHERE company_id = $1", [id])
        .catch(() => undefined);
    }
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
    if (nest) await nest.close();
  });

  // ── S2-HR-BE-6 scope FIX (owner-chốt 2026-07-02, session 1849d064, harness/handoff.md, mig 0465) ──
  // employee (Own) sees ONLY their own contract; manager (Team) sees ONLY their reports' contracts;
  // out-of-scope reads 404 (never a leak). hr/company-admin stay Company (unchanged, mig 0462).

  it("employee (view:contract @ Own) → GET /hr/contracts → 200, sees ONLY own contract", async () => {
    const token = await login(nest, A.slug, employeeEmail);
    const res = await api(nest).get("/hr/contracts").set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = (res.body.data as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(empOwnContractId);
    expect(ids).not.toContain(reportContractId);
    expect(ids).not.toContain(outsiderContractId);
  });

  it("employee (Own) → GET /hr/contracts/:id own → 200; someone else's → 404 (no leak)", async () => {
    const token = await login(nest, A.slug, employeeEmail);
    const own = await api(nest).get(`/hr/contracts/${empOwnContractId}`).set(bearer(token));
    expect(own.status).toBe(200);
    expect(own.body.data.id).toBe(empOwnContractId);

    const other = await api(nest).get(`/hr/contracts/${outsiderContractId}`).set(bearer(token));
    expect(other.status).toBe(404);
  });

  it("manager (view:contract @ Team) → GET /hr/employees/:id/contracts → 200 for a direct report", async () => {
    const token = await login(nest, A.slug, managerEmail);
    const res = await api(nest)
      .get(`/hr/employees/${reportProfileId}/contracts`)
      .set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = (res.body.data as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(reportContractId);
  });

  it("manager (Team) → GET /hr/contracts/:id for an OUTSIDER (not their report) → 404 (not empty/leak)", async () => {
    const token = await login(nest, A.slug, managerEmail);
    const res = await api(nest).get(`/hr/contracts/${outsiderContractId}`).set(bearer(token));
    expect(res.status).toBe(404);
    // Own contract list must not include the outsider's contract either.
    const list = await api(nest).get("/hr/contracts").set(bearer(token));
    expect(list.status).toBe(200);
    const ids = (list.body.data as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(outsiderContractId);
  });

  it("deny: noPerm (no view/manage:contract at all) → GET /hr/contracts → 403 and NO audit row", async () => {
    const token = await login(nest, A.slug, noPermEmail);
    const before = await countContractAudit(direct, A.companyId);
    const res = await api(nest).get("/hr/contracts").set(bearer(token));
    expect(res.status).toBe(403);
    expect(await countContractAudit(direct, A.companyId)).toBe(before);
  });

  it("deny: noPerm → POST /hr/contracts → 403 and NO audit row", async () => {
    const token = await login(nest, A.slug, noPermEmail);
    const before = await countContractAudit(direct, A.companyId);
    const res = await api(nest)
      .post("/hr/contracts")
      .set(bearer(token))
      .send({ employeeId: empA, contractTypeId: ctA, startDate: "2025-01-01" });
    expect(res.status).toBe(403);
    expect(await countContractAudit(direct, A.companyId)).toBe(before);
  });

  it("deny: employee (view:contract @ Own only, NO manage) → POST/PATCH/DELETE → 403 (manage required)", async () => {
    const token = await login(nest, A.slug, employeeEmail);

    const create = await api(nest)
      .post("/hr/contracts")
      .set(bearer(token))
      .send({ employeeId: empProfileId, contractTypeId: ctA, startDate: "2025-01-01" });
    expect(create.status).toBe(403);

    const patch = await api(nest)
      .patch(`/hr/contracts/${empOwnContractId}`)
      .set(bearer(token))
      .send({ note: "x" });
    expect(patch.status).toBe(403);

    const del = await api(nest).delete(`/hr/contracts/${empOwnContractId}`).set(bearer(token));
    expect(del.status).toBe(403);
  });

  it("deny: manager (view:contract @ Team only, NO manage) → PATCH/DELETE a report's contract → 403", async () => {
    const token = await login(nest, A.slug, managerEmail);
    const patch = await api(nest)
      .patch(`/hr/contracts/${reportContractId}`)
      .set(bearer(token))
      .send({ note: "x" });
    expect(patch.status).toBe(403);
    const del = await api(nest).delete(`/hr/contracts/${reportContractId}`).set(bearer(token));
    expect(del.status).toBe(403);
  });

  // ── happy: create/list/get/update/delete + audit-in-tx ──────────────────────────────────────

  it("hr create → 201 + exactly one audit row object_type='employee_contract'; GET reflects it", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const before = await countContractAudit(direct, A.companyId);

    const created = await api(nest)
      .post("/hr/contracts")
      .set(bearer(token))
      // hostile body company_id must be IGNORED (uses AuthContext tenant).
      .send({
        employeeId: empA,
        contractTypeId: ctA,
        contractCode: "HD-A-001",
        title: "Hợp đồng thử việc",
        startDate: "2025-01-01",
        status: "Active",
        note: "ghi chú",
        companyId: B.companyId,
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.companyId).toBe(A.companyId);
    expect(created.body.data.contractCode).toBe("HD-A-001");
    const contractId = created.body.data.id as string;

    // exactly one audit row of the right object_type.
    expect(await countContractAudit(direct, A.companyId)).toBe(before + 1);
    const row = await direct.query(
      `SELECT action, object_type FROM audit_logs
       WHERE company_id = $1 AND object_type = 'employee_contract'
       ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    expect(row.rows[0].action).toBe("create");

    const get = await api(nest).get(`/hr/contracts/${contractId}`).set(bearer(token));
    expect(get.status).toBe(200);
    expect(get.body.data.id).toBe(contractId);
  });

  it("PII allowlist: list/detail DTO exposes only the allowlisted fields (no salary/PII leak)", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const list = await api(nest).get("/hr/contracts").set(bearer(token));
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    const first = list.body.data[0];
    const allowed = new Set([
      "id",
      "companyId",
      "employeeId",
      "contractTypeId",
      "contractCode",
      "title",
      "startDate",
      "endDate",
      "signedDate",
      "status",
      "isPrimary",
      "fileId",
      "note",
      "expiringSoon",
      "createdAt",
      "updatedAt",
    ]);
    for (const key of Object.keys(first)) {
      expect(allowed.has(key), `unexpected field leaked in contract DTO: ${key}`).toBe(true);
    }
    // No salary/identity fields sneak in.
    const blob = JSON.stringify(first).toLowerCase();
    expect(blob).not.toContain("salary");
    expect(blob).not.toContain("identity_number");
    expect(blob).not.toContain("bank_account");
  });

  it("hr update → 200 + audit row; delete → 204 SOFT-delete (row stays, deleted_at set) + audit row", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const created = await api(nest)
      .post("/hr/contracts")
      .set(bearer(token))
      .send({ employeeId: empA, contractTypeId: ctA, startDate: "2025-02-01", status: "Draft" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const auditBeforeUpd = await countContractAudit(direct, A.companyId);
    const upd = await api(nest)
      .patch(`/hr/contracts/${id}`)
      .set(bearer(token))
      .send({ status: "Active", note: "activated" });
    expect(upd.status).toBe(200);
    expect(upd.body.data.status).toBe("Active");
    expect(await countContractAudit(direct, A.companyId)).toBe(auditBeforeUpd + 1);

    const auditBeforeDel = await countContractAudit(direct, A.companyId);
    const del = await api(nest).delete(`/hr/contracts/${id}`).set(bearer(token));
    expect(del.status).toBe(204);
    // SOFT-delete: row still present with deleted_at set (BẤT BIẾN #2 — no hard-delete).
    const raw = await rawContract(direct, id);
    expect(raw).toBeDefined();
    expect(raw?.deletedAt).not.toBeNull();
    expect(await countContractAudit(direct, A.companyId)).toBe(auditBeforeDel + 1);
    // A subsequent GET → 404 (default query filters deleted_at IS NULL).
    const get = await api(nest).get(`/hr/contracts/${id}`).set(bearer(token));
    expect(get.status).toBe(404);
  });

  // ── business rules ──────────────────────────────────────────────────────────────────────────

  it("contract_type requires_end_date → create without end_date → 400", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const ctFixed = await seedContractType(direct, A.companyId, true);
    const res = await api(nest)
      .post("/hr/contracts")
      .set(bearer(token))
      .send({ employeeId: empA, contractTypeId: ctFixed, startDate: "2025-01-01" });
    expect(res.status).toBe(400);
  });

  it("expiry warning: Active contract ending within 30 days → expiringSoon=true", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 10);
    const endDate = soon.toISOString().slice(0, 10);
    const created = await api(nest).post("/hr/contracts").set(bearer(token)).send({
      employeeId: empA,
      contractTypeId: ctA,
      startDate: "2024-01-01",
      endDate,
      status: "Active",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.expiringSoon).toBe(true);

    const expiring = await api(nest).get("/hr/contracts?expiringOnly=true").set(bearer(token));
    expect(expiring.status).toBe(200);
    expect(expiring.body.data.some((c: { id: string }) => c.id === created.body.data.id)).toBe(
      true,
    );
  });

  // ── RLS 2-tenant isolation ──────────────────────────────────────────────────────────────────

  it("RLS: tenant A never sees tenant B's contracts (cross-tenant read isolation)", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const list = await api(nest).get("/hr/contracts").set(bearer(token));
    expect(list.status).toBe(200);
    const blob = JSON.stringify(list.body.data);
    expect(blob).not.toContain("B-SECRET-CODE");
  });

  it("RLS: create with a cross-tenant contract_type (from B) → 400 (never binds B's type)", async () => {
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest)
      .post("/hr/contracts")
      .set(bearer(token))
      .send({ employeeId: empA, contractTypeId: ctB, startDate: "2025-01-01" });
    // ctB belongs to tenant B → RLS filters it to 0 rows inside A's tx → BadRequest.
    expect(res.status).toBe(400);
  });

  it("RLS: tenant A cannot GET tenant B's contract by id (404, not leak)", async () => {
    // grab B's contract id via superuser.
    const bRow = await direct.query(
      `SELECT id FROM employee_contracts WHERE company_id = $1 LIMIT 1`,
      [B.companyId],
    );
    const bContractId = bRow.rows[0].id as string;
    const token = await login(nest, A.slug, hrEmail);
    const res = await api(nest).get(`/hr/contracts/${bContractId}`).set(bearer(token));
    expect(res.status).toBe(404);
  });

  // ── audit-in-tx + append-only (BẤT BIẾN #2) ─────────────────────────────────────────────────

  it("audit-in-tx (BẤT BIẾN #2): a failure AFTER audit.record rolls back BOTH the contract AND the audit row", async () => {
    const db = nest.get(DatabaseService, { strict: false });
    const audit = nest.get(AuditService, { strict: false });
    const repo = nest.get(ContractRepository, { strict: false });

    const auditBefore = await countContractAudit(direct, A.companyId);
    const countBefore = await direct.query(
      `SELECT count(*)::int AS n FROM employee_contracts WHERE company_id = $1`,
      [A.companyId],
    );

    await expect(
      db.withTenant(A.companyId, async (tx) => {
        const created = await repo.insertTx(tx, A.companyId, hrUserId, {
          employeeId: empA,
          contractTypeId: ctA,
          contractCode: "ROLLBACK-ME",
          title: null,
          startDate: "2025-03-01",
          endDate: null,
          signedDate: null,
          status: "Draft",
          isPrimary: false,
          fileId: null,
          note: null,
        });
        if (!created) throw new Error("setup: insert returned no row");
        await audit.record(tx, {
          action: "create",
          objectType: "employee_contract",
          objectId: created.id,
          actorUserId: hrUserId,
          after: { contractCode: "ROLLBACK-ME" },
        });
        throw new Error("SENTINEL: forced failure after audit.record");
      }),
    ).rejects.toThrow(/SENTINEL/);

    // Both rolled back: no ROLLBACK-ME row, no new audit row.
    const rollbackRow = await direct.query(
      `SELECT count(*)::int AS n FROM employee_contracts WHERE contract_code = 'ROLLBACK-ME'`,
    );
    expect(rollbackRow.rows[0].n).toBe(0);
    expect(await countContractAudit(direct, A.companyId)).toBe(auditBefore);
    const countAfter = await direct.query(
      `SELECT count(*)::int AS n FROM employee_contracts WHERE company_id = $1`,
      [A.companyId],
    );
    expect(countAfter.rows[0].n).toBe(countBefore.rows[0].n);
  });

  it("append-only (BẤT BIẾN #2): mediaos_app UPDATE/DELETE of a contract audit row is DENIED", async () => {
    const row = await direct.query(
      `SELECT id FROM audit_logs WHERE company_id = $1 AND object_type = 'employee_contract' LIMIT 1`,
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
});
