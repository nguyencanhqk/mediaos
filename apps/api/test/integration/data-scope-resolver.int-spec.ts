import type { PoolClient } from "pg";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { DataScopeService, type ScopeContext } from "../../src/permission/data-scope.service";
import type { PermissionService } from "../../src/permission/permission.service";
import type { DataScopeRepository } from "../../src/permission/data-scope.repository";

/**
 * S2-AUTH-BE-2 — data-scope resolver at the DB layer (BẤT BIẾN #1). Proves the REAL
 * buildEmployeeScopeCondition() output filters real employee_profiles rows under tenant RLS:
 *   Own = self only · Team = direct reports ∪ self · Department = same org_unit · Company = whole tenant
 *   · cross-tenant = 0 rows of the other company (RLS + predicate).
 * Gate hasDb && LANE_DB (memory: skipIf(!hasDb) alone false-reds on shared dev DB).
 */
const laneDb = process.env.LANE_DB;
describe.skipIf(!(hasDb && laneDb))("S2-AUTH-BE-2 data-scope resolver (DB-level)", () => {
  const direct = directPool();
  const app = appPool(2);
  const dialect = new PgDialect();
  // buildEmployeeScopeCondition is pure (only employeeProfiles + ctx) — instance deps unused here.
  const svc = new DataScopeService(
    {} as unknown as PermissionService,
    {} as unknown as DataScopeRepository,
  );

  let A: SeededTenant;
  let B: SeededTenant;
  let ouEng = "";
  let ouSales = "";
  let mgr = "";
  let rep = "";
  let peer = "";
  let bUser = "";

  beforeAll(async () => {
    A = await seedCompany(direct, "dsrA");
    B = await seedCompany(direct, "dsrB");

    ouEng = await seedOrgUnit(A.companyId, "Engineering");
    ouSales = await seedOrgUnit(A.companyId, "Sales");

    mgr = await seedUser(direct, A.companyId, `mgr-${A.slug}@dsr.test`);
    rep = await seedUser(direct, A.companyId, `rep-${A.slug}@dsr.test`);
    peer = await seedUser(direct, A.companyId, `peer-${A.slug}@dsr.test`);
    bUser = await seedUser(direct, B.companyId, `b-${B.slug}@dsr.test`);

    await seedEmployee(A.companyId, mgr, ouEng, null); // manager, Engineering
    await seedEmployee(A.companyId, rep, ouEng, mgr); // direct report of mgr, Engineering
    await seedEmployee(A.companyId, peer, ouSales, null); // unrelated, Sales
    await seedEmployee(B.companyId, bUser, null, null); // other tenant
  });

  afterAll(async () => {
    await direct
      .query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [
        [A.companyId, B.companyId],
      ])
      .catch(() => undefined);
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  async function seedOrgUnit(companyId: string, name: string): Promise<string> {
    const r = await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1, $2, 'department') RETURNING id",
      [companyId, name],
    );
    return r.rows[0].id as string;
  }

  async function seedEmployee(
    companyId: string,
    userId: string,
    orgUnitId: string | null,
    directManagerUserId: string | null,
  ): Promise<void> {
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, direct_manager_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [companyId, userId, orgUnitId, directManagerUserId],
    );
  }

  /** Run the rendered predicate under tenant RLS (app role + set_config), return visible user_ids. */
  async function visibleUsers(tenantCompanyId: string, cond: SQL): Promise<string[]> {
    const q = dialect.sqlToQuery(cond);
    return inTenant(tenantCompanyId, async (c) => {
      const r = await c.query(
        `SELECT user_id FROM employee_profiles WHERE ${q.sql} AND deleted_at IS NULL`,
        q.params,
      );
      return r.rows.map((x) => x.user_id as string);
    });
  }

  async function inTenant<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      const out = await fn(c);
      await c.query("ROLLBACK");
      return out;
    } catch (err) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  it("Own: employee sees ONLY their own row", async () => {
    const ctx: ScopeContext = { userId: rep, companyId: A.companyId };
    const seen = await visibleUsers(A.companyId, svc.buildEmployeeScopeCondition("Own", ctx));
    expect(seen.sort()).toEqual([rep]);
  });

  it("Team: manager sees direct reports ∪ self, NOT unrelated peers", async () => {
    const ctx: ScopeContext = { userId: mgr, companyId: A.companyId };
    const seen = await visibleUsers(A.companyId, svc.buildEmployeeScopeCondition("Team", ctx));
    expect(seen.sort()).toEqual([mgr, rep].sort());
    expect(seen).not.toContain(peer);
  });

  it("Department: sees same org_unit only", async () => {
    const ctx: ScopeContext = { userId: mgr, companyId: A.companyId, orgUnitId: ouEng };
    const seen = await visibleUsers(
      A.companyId,
      svc.buildEmployeeScopeCondition("Department", ctx),
    );
    expect(seen.sort()).toEqual([mgr, rep].sort()); // both Engineering
    expect(seen).not.toContain(peer); // Sales
  });

  it("Company: sees the whole tenant but NEVER the other company's employees", async () => {
    const ctx: ScopeContext = { userId: mgr, companyId: A.companyId };
    const seen = await visibleUsers(A.companyId, svc.buildEmployeeScopeCondition("Company", ctx));
    expect(seen.sort()).toEqual([mgr, rep, peer].sort());
    expect(seen).not.toContain(bUser);
  });

  it("cross-tenant: a Company-scoped predicate for company A returns 0 rows under tenant B (RLS + predicate)", async () => {
    const ctx: ScopeContext = { userId: mgr, companyId: A.companyId };
    const seen = await visibleUsers(B.companyId, svc.buildEmployeeScopeCondition("Company", ctx));
    expect(seen).toEqual([]);
  });

  it("Department without a resolved org_unit → 0 rows (fail-closed, no leak)", async () => {
    const ctx: ScopeContext = { userId: mgr, companyId: A.companyId, orgUnitId: null };
    const seen = await visibleUsers(
      A.companyId,
      svc.buildEmployeeScopeCondition("Department", ctx),
    );
    expect(seen).toEqual([]);
  });

  it("null scope → 0 rows (fail-closed)", async () => {
    const ctx: ScopeContext = { userId: mgr, companyId: A.companyId };
    const seen = await visibleUsers(A.companyId, svc.buildEmployeeScopeCondition(null, ctx));
    expect(seen).toEqual([]);
  });
});
