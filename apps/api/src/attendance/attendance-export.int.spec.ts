/**
 * S3-ATT-EXPORT-1 — Integration (Postgres THẬT, DB CÔ LẬP). CSV export of scoped attendance records over
 * the REAL HTTP path (JwtAuthGuard → CompanyGuard → PermissionGuard(export:attendance) →
 * AttendanceController.exportRecords → AttendanceExportService → DataScopeService + RLS withTenant →
 * append-only audit). KHÔNG mock permission — proves on the real path: the export:attendance gate (403),
 * the SAME data-scope filter as the lists (Own/Team/Company), cross-tenant isolation, CSV injection
 * neutralization + RFC-4180, and the actor/count/scope audit row.
 *
 * 403 = no export grant (PermissionGuard, fail-closed). CSV never carries location/gps/ip/device (the
 * export reuses the masked list projection). Gate cứng `hasDb && LANE_DB` (memory
 * integration-test-lane-db-gate). Colocated src/attendance → vitest include src/**\/*.spec.ts.
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

const WD = "2024-05-03";
const INJECTION_NAME = "=cmd|' /C calc'!A1";
const COMMA_NAME = "Nguyen, Van B";

describe.skipIf(!runDb)("S3-ATT-EXPORT-1 CSV export (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let empUser = "";
  let noExportUser = "";
  let mgrUser = "";
  let hrUser = "";
  let otherUser = "";
  let emrUser = "";
  let evilUser = "";
  let commaUser = "";

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
    directManagerUserId: string | null,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, direct_manager_id, status)
       VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [companyId, userId, orgUnitId, directManagerUserId],
    );
    return r.rows[0].id as string;
  }

  async function setFullName(userId: string, fullName: string): Promise<void> {
    await direct.query("UPDATE users SET full_name = $2 WHERE id = $1", [userId, fullName]);
  }

  /** Custom company-scoped role with EXACT ATT (action, scope) pairs (mirror mig 0454). All sensitive. */
  async function grantAtt(
    companyId: string,
    userId: string,
    label: string,
    pairs: Array<[string, Scope]>,
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `attx-${label}-${userId.slice(0, 8)}`);
    for (const [action, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, "attendance", true);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function plantRecord(companyId: string, userId: string, workDate: string): Promise<void> {
    await direct.query(
      `INSERT INTO attendance_records
         (company_id, user_id, work_date, status, attendance_status,
          check_in_at, late_minutes, early_leave_minutes, working_minutes)
       VALUES ($1,$2,$3,'present','Present',$4,0,0,480)`,
      [companyId, userId, workDate, `${workDate}T01:00:00Z`],
    );
  }

  async function plantEmr(
    companyId: string,
    employeeUserId: string,
    managerUserId: string,
  ): Promise<void> {
    await direct.query(
      `INSERT INTO employee_manager_relations
         (company_id, employee_user_id, manager_user_id, relation_type, status)
       VALUES ($1,$2,$3,'project_manager','active')`,
      [companyId, employeeUserId, managerUserId],
    );
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
    A = await seedCompany(direct, "attexpa");
    B = await seedCompany(direct, "attexpb");
    companyIds.push(A.companyId, B.companyId);

    const ouEng = await seedOrgUnit(A.companyId, "Engineering");
    const ouSales = await seedOrgUnit(A.companyId, "Sales");

    mgrUser = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
    empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
    noExportUser = await seedUser(direct, A.companyId, `noexp@${A.slug}.test`, hash);
    hrUser = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
    otherUser = await seedUser(direct, A.companyId, `other@${A.slug}.test`, hash);
    emrUser = await seedUser(direct, A.companyId, `emr@${A.slug}.test`, hash);
    evilUser = await seedUser(direct, A.companyId, `evil@${A.slug}.test`, hash);
    commaUser = await seedUser(direct, A.companyId, `comma@${A.slug}.test`, hash);
    await setFullName(evilUser, INJECTION_NAME);
    await setFullName(commaUser, COMMA_NAME);

    await seedEmp(A.companyId, mgrUser, ouEng, null);
    await seedEmp(A.companyId, empUser, ouEng, mgrUser); // report of mgr
    await seedEmp(A.companyId, noExportUser, ouEng, null);
    await seedEmp(A.companyId, hrUser, ouEng, null);
    await seedEmp(A.companyId, otherUser, ouSales, null); // non-report
    await seedEmp(A.companyId, emrUser, ouSales, null); // EMR-managed by mgr
    await seedEmp(A.companyId, evilUser, ouEng, null);
    await seedEmp(A.companyId, commaUser, ouEng, null);
    await plantEmr(A.companyId, emrUser, mgrUser);

    for (const u of [empUser, mgrUser, otherUser, emrUser, evilUser, commaUser]) {
      await plantRecord(A.companyId, u, WD);
    }

    // ── export grants (per-pair scope mirrors mig 0454) ──
    await grantAtt(A.companyId, empUser, "emp", [["export", "Own"]]);
    await grantAtt(A.companyId, noExportUser, "noexp", [["view-own", "Own"]]); // NO export
    await grantAtt(A.companyId, mgrUser, "mgr", [["export", "Team"]]);
    await grantAtt(A.companyId, hrUser, "hr", [["export", "Company"]]);

    // ── Tenant B (cross-tenant) ──
    const bAdmin = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
    await seedEmp(B.companyId, bAdmin, null, null);
    await plantRecord(B.companyId, bAdmin, WD);
    await grantAtt(B.companyId, bAdmin, "badmin", [["export", "Company"]]);
  });

  afterAll(async () => {
    await direct
      ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
      .catch(() => undefined);
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── 1 · deny: no export grant → 403 ───────────────────────────────────────────
  it("no export:attendance grant → 403 (PermissionGuard, fail-closed)", async () => {
    const token = await login(A.slug, `noexp@${A.slug}.test`);
    const res = await get(token, "/attendance/records/export");
    expect(res.status).toBe(403);
  });

  // ── 2 · scope Own: employee exports ONLY own rows (no team/company) ────────────
  it("employee export (Own) → CSV contains only own row; other users absent", async () => {
    const token = await login(A.slug, `emp@${A.slug}.test`);
    const res = await get(token, "/attendance/records/export");
    expect(res.status, res.text).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.text.startsWith("\uFEFF")).toBe(true); // BOM
    const rows = csvDataRows(res.text);
    expect(rows.length).toBe(1);
    expect(res.text).not.toContain("Nguyen, Van B"); // commaUser not in own scope
  });

  // ── 3 · scope Team: manager gets reports∪self∪EMR, NOT non-report (≠ Company) ──
  it("manager export (Team) → reports∪self∪EMR; non-report (Sales) excluded", async () => {
    const token = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await get(token, "/attendance/records/export");
    expect(res.status, res.text).toBe(200);
    const rows = csvDataRows(res.text);
    // mgr(self) + emp(report) + emr(EMR) = 3; otherUser (Sales non-report) excluded.
    expect(rows.length).toBe(3);
    expect(res.text).not.toContain("other@"); // otherUser absent (proves Team ≠ Company)
  });

  // ── 4 · scope Company + injection: hr exports all, formula neutralized + RFC-4180 ──
  it("hr export (Company) → all rows; injection neutralized (prefix ') + comma field quoted", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);
    const res = await get(token, "/attendance/records/export");
    expect(res.status, res.text).toBe(200);
    const rows = csvDataRows(res.text);
    expect(rows.length).toBe(6); // all 6 planted A records
    // Injection neutralized: leading = replaced with '= (no formula executes in Excel).
    expect(res.text).toContain(`'${INJECTION_NAME}`);
    // RFC-4180: field with a comma is wrapped in double quotes.
    expect(res.text).toContain(`"${COMMA_NAME}"`);
    // Masking by construction — a records CSV never carries these headers/values.
    expect(res.text).not.toContain("gps");
    expect(res.text).not.toContain("ip_address");
  });

  // ── 5 · cross-tenant: tenant B export excludes tenant A rows ───────────────────
  it("cross-tenant: tenant B export excludes tenant A user rows", async () => {
    const token = await login(B.slug, `admin@${B.slug}.test`);
    const res = await get(token, "/attendance/records/export");
    expect(res.status, res.text).toBe(200);
    const rows = csvDataRows(res.text);
    expect(rows.length).toBe(1); // only B's own record
    expect(res.text).not.toContain(INJECTION_NAME);
    expect(res.text).not.toContain(COMMA_NAME);
  });

  // ── 6 · audit: actor + exact count + dataScope label ───────────────────────────
  it("audit row: action=AttendanceRecordsExported, actor=caller, dataScope=Company, count matches", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);
    const res = await get(token, "/attendance/records/export");
    expect(res.status, res.text).toBe(200);
    const exportedCount = csvDataRows(res.text).length;

    const audit = await direct.query(
      `SELECT actor_user_id, object_type, data_scope, after
         FROM audit_logs
        WHERE company_id = $1 AND action = 'AttendanceRecordsExported' AND actor_user_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [A.companyId, hrUser],
    );
    expect(audit.rows.length).toBe(1);
    const row = audit.rows[0];
    expect(row.actor_user_id).toBe(hrUser);
    expect(row.object_type).toBe("attendance_record");
    expect(row.data_scope).toBe("Company");
    expect(Number(row.after.count)).toBe(exportedCount);
  });
});
