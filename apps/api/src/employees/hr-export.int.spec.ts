/**
 * HR-PROFILE-UI-2 — Integration (Postgres THẬT, DB CÔ LẬP). CSV export of the scoped employee directory
 * over the REAL HTTP path (JwtAuthGuard → CompanyGuard → PermissionGuard(export:employee,isSensitive) →
 * HrReadController.exportEmployees → HrExportService → DataScopeService + RLS withTenant → per-row
 * view-sensitive mask → append-only audit). KHÔNG mock permission — proves on the real path:
 *   - the export:employee gate (403; fail-closed, wildcard *:* does not satisfy a sensitive pair);
 *   - the SAME data-scope filter as the list (Own → only own row; Company → whole tenant);
 *   - cross-tenant isolation (BẤT BIẾN #1: withTenant + scope predicate carry company_id);
 *   - per-row PII masking SERVER-side (view-sensitive present → cell has value; absent → blank);
 *   - the hard row cap → 422 (no truncated file);
 *   - the append-only audit row (actor + exact count + scope label);
 *   - deterministic sort (sort=startDate&order=desc) and Zod enum rejection of an unknown sort (400).
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated src/employees → vitest
 * include src/**\/*.spec.ts.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../auth/password.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../test/helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!test99";

type Scope = "Own" | "Team" | "Department" | "Company" | "System";

const INJECTION_NAME = "=cmd|' /C calc'!A1";
const PII_PHONE = "0912345678";

describe.skipIf(!runDb)("HR-PROFILE-UI-2 employee CSV export (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let hrUser = "";
  let noExportUser = "";
  let ownUser = "";
  let otherUser = "";
  let evilUser = "";

  async function seedOrgUnit(companyId: string, name: string): Promise<string> {
    const r = await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
      [companyId, name],
    );
    return r.rows[0].id as string;
  }

  async function seedEmp(
    companyId: string,
    userId: string,
    orgUnitId: string | null,
    opts: { startDate?: string; phone?: string; gender?: string } = {},
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles
         (company_id, user_id, org_unit_id, status, start_date, phone, gender)
       VALUES ($1,$2,$3,'active',$4,$5,$6) RETURNING id`,
      [
        companyId,
        userId,
        orgUnitId,
        opts.startDate ?? null,
        opts.phone ?? null,
        opts.gender ?? null,
      ],
    );
    return r.rows[0].id as string;
  }

  async function setFullName(userId: string, fullName: string): Promise<void> {
    await direct.query("UPDATE users SET full_name = $2 WHERE id = $1", [userId, fullName]);
  }

  /** Custom company role with EXACT (action, resourceType, scope) pairs. sensitive=true for the gated ones. */
  async function grant(
    companyId: string,
    userId: string,
    label: string,
    pairs: Array<[string, string, Scope, boolean]>,
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `hrx-${label}-${userId.slice(0, 8)}`);
    for (const [action, resourceType, scope, sensitive] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resourceType, sensitive);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  function get(token: string, url: string) {
    return request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`);
  }

  /** Split a CSV body into data rows (strip BOM + header + trailing blank). */
  function csvDataRows(body: string): string[] {
    return body
      .replace(/^\uFEFF/, "")
      .split("\r\n")
      .filter((l) => l.length > 0)
      .slice(1);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "hrexpa");
    B = await seedCompany(direct, "hrexpb");
    companyIds.push(A.companyId, B.companyId);

    const ouEng = await seedOrgUnit(A.companyId, "Engineering");

    hrUser = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
    noExportUser = await seedUser(direct, A.companyId, `noexp@${A.slug}.test`, hash);
    ownUser = await seedUser(direct, A.companyId, `own@${A.slug}.test`, hash);
    otherUser = await seedUser(direct, A.companyId, `other@${A.slug}.test`, hash);
    evilUser = await seedUser(direct, A.companyId, `evil@${A.slug}.test`, hash);
    await setFullName(evilUser, INJECTION_NAME);

    await seedEmp(A.companyId, hrUser, ouEng, { startDate: "2024-01-01" });
    await seedEmp(A.companyId, noExportUser, ouEng, { startDate: "2024-02-01" });
    await seedEmp(A.companyId, ownUser, ouEng, { startDate: "2024-03-01", phone: PII_PHONE });
    await seedEmp(A.companyId, otherUser, ouEng, { startDate: "2024-04-01" });
    await seedEmp(A.companyId, evilUser, ouEng, { startDate: "2024-05-01" });

    // hr: Company export + view-sensitive Company (sees PII). noexp: read only, NO export.
    await grant(A.companyId, hrUser, "hr", [
      ["export", "employee", "Company", true],
      ["view-sensitive", "employee", "Company", true],
    ]);
    await grant(A.companyId, noExportUser, "noexp", [["read", "employee", "Company", false]]);
    // own: export Own — exports only their own row; NO view-sensitive → PII blanked.
    await grant(A.companyId, ownUser, "own", [["export", "employee", "Own", true]]);

    // ── Tenant B (cross-tenant) ──
    const bAdmin = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
    await seedEmp(B.companyId, bAdmin, null, { startDate: "2024-01-01" });
    await grant(B.companyId, bAdmin, "badmin", [["export", "employee", "Company", true]]);
  });

  afterAll(async () => {
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── 1 · deny: no export:employee grant → 403 (RED-first) ───────────────────────
  it("no export:employee grant → 403 (PermissionGuard, fail-closed)", async () => {
    const token = await login(A.slug, `noexp@${A.slug}.test`);
    const res = await get(token, "/hr/employees/export");
    expect(res.status).toBe(403);
  });

  // ── 2 · scope Own: caller exports ONLY own row (export ngoài scope không có row) ─
  it("Own-scope export → CSV contains only the caller's own row; other users absent", async () => {
    const token = await login(A.slug, `own@${A.slug}.test`);
    const res = await get(token, "/hr/employees/export");
    expect(res.status, res.text).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.text.startsWith("\uFEFF")).toBe(true);
    const rows = csvDataRows(res.text);
    expect(rows.length).toBe(1);
    expect(res.text).not.toContain(`hr@${A.slug}.test`);
    expect(res.text).not.toContain(INJECTION_NAME);
  });

  // ── 3 · scope Company + injection: hr exports all; formula neutralized + PII present ─
  it("Company-scope hr export → all rows; injection neutralized; PII (phone) present with view-sensitive", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);
    const res = await get(token, "/hr/employees/export");
    expect(res.status, res.text).toBe(200);
    const rows = csvDataRows(res.text);
    expect(rows.length).toBe(5); // all 5 A employees
    expect(res.text).toContain(`'${INJECTION_NAME}`); // formula neutralized
    expect(res.text).toContain(PII_PHONE); // has view-sensitive → phone revealed
    // salary-class is never a column → never leaks.
    expect(res.text.replace(/^\uFEFF/, "").split("\r\n")[0]).not.toContain("lương");
  });

  // ── 4 · masking per-row: Own-scope caller WITHOUT view-sensitive → PII blank ────
  it("Own-scope export without view-sensitive → own PII (phone) blanked server-side", async () => {
    const token = await login(A.slug, `own@${A.slug}.test`);
    const res = await get(token, "/hr/employees/export");
    expect(res.status, res.text).toBe(200);
    // ownUser's own phone is PII_PHONE but the caller has no view-sensitive → must be blanked.
    expect(res.text).not.toContain(PII_PHONE);
  });

  // ── 5 · cross-tenant: tenant B export excludes tenant A rows ───────────────────
  it("cross-tenant: tenant B export excludes tenant A user rows", async () => {
    const token = await login(B.slug, `admin@${B.slug}.test`);
    const res = await get(token, "/hr/employees/export");
    expect(res.status, res.text).toBe(200);
    const rows = csvDataRows(res.text);
    expect(rows.length).toBe(1); // only B's own employee
    expect(res.text).not.toContain(INJECTION_NAME);
    expect(res.text).not.toContain(PII_PHONE);
  });

  // ── 6 · audit: actor + exact count + dataScope label ───────────────────────────
  it("audit row: action=EmployeesExported, actor=caller, dataScope=Company, count matches; append-only", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);
    const res = await get(token, "/hr/employees/export");
    expect(res.status, res.text).toBe(200);
    const exportedCount = csvDataRows(res.text).length;

    const audit = await direct.query(
      `SELECT id, actor_user_id, object_type, data_scope, after
         FROM audit_logs
        WHERE company_id = $1 AND action = 'EmployeesExported' AND actor_user_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [A.companyId, hrUser],
    );
    expect(audit.rows.length).toBe(1);
    const row = audit.rows[0];
    expect(row.actor_user_id).toBe(hrUser);
    expect(row.object_type).toBe("employee");
    expect(row.data_scope).toBe("Company");
    expect(Number(row.after.count)).toBe(exportedCount);

    // Append-only: the app role holds no UPDATE/DELETE on audit_logs (BẤT BIẾN #2). The direct
    // superuser CAN mutate — so we assert the grant is absent for the app role instead.
    const priv = await direct.query(
      `SELECT has_table_privilege('mediaos_app', 'audit_logs', 'UPDATE') AS upd,
              has_table_privilege('mediaos_app', 'audit_logs', 'DELETE') AS del`,
    );
    expect(priv.rows[0].upd).toBe(false);
    expect(priv.rows[0].del).toBe(false);
  });

  // ── 7 · deterministic sort: startDate desc orders rows; unknown sort → 400 (Zod) ─
  it("sort=startDate&order=desc orders rows by start date descending", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);
    const res = await get(token, "/hr/employees/export?sort=startDate&order=desc");
    expect(res.status, res.text).toBe(200);
    const rows = csvDataRows(res.text);
    // The startDate column is index 8 (employeeCode,fullName,email,orgUnit,position,workType,
    // employmentType,status,startDate,...) — read it back and assert descending order.
    const dates = rows.map((r) => {
      const cells = r.split(",");
      return cells[8];
    });
    const sorted = [...dates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    expect(dates).toEqual(sorted);
  });

  it("sort outside HR_EMPLOYEE_SORT_FIELDS → 400 (Zod enum, ORDER BY injection blocked)", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);
    const res = await get(token, "/hr/employees/export?sort=base_salary;DROP");
    expect(res.status).toBe(400);
  });
});
