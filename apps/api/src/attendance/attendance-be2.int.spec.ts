/**
 * S3-ATT-BE-2 — Integration (Postgres THẬT, DB CÔ LẬP). Scoped attendance records read over the REAL
 * HTTP path (JwtAuthGuard → CompanyGuard → PermissionGuard → AttendanceController → AttendanceReadService
 * → DataScopeService + RLS withTenant). KHÔNG mock permission — proves on the real path the things a unit
 * cannot: scope FILTER (Own/Team/Company), 403-vs-404 policy, and SERVER-side masking.
 *
 * Roles: per-user CUSTOM company-scoped roles whose (action,scope) MIRROR the mig-0454 ATT matrix
 *   (view-own=Own all · view-team=Team mgr · view-company=Company hr · view-detail=Own/Team/Company ·
 *    view-sensitive=Company hr). This is the S2-QA-1 RBAC pattern — controllable per-pair scope, and it
 *   avoids the 2FA enforcement that the canonical company-admin/hr roles carry (a flaky-login trap).
 *
 * 403 = no grant (PermissionGuard, fail-closed). 404 = exists-but-out-of-scope OR cross-tenant (RLS) —
 * never leak existence (HR precedent). location/gps/ip/device masked unless view-sensitive:attendance.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env → hasDb=true ⇒ đỏ-giả trên
 * DB dev chung; chỉ chạy trên DB cô lập lane. Colocated src/attendance → vitest include src/**\/*.spec.ts.
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

// empUser's 3 records (distinct dates for sort/pagination); WD_C = primary (location + logs).
const WD_A = "2024-05-01";
const WD_B = "2024-05-02";
const WD_C = "2024-05-03";

describe.skipIf(!runDb)("S3-ATT-BE-2 scoped records read (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  // Users.
  let empUser = "";
  let mgrUser = "";
  let hrUser = "";
  let otherUser = "";
  let emrUser = "";
  let noDetailUser = "";

  // employee_profiles.
  let empProfile = "";

  // attendance_records.
  let recEmpPrimary = ""; // empUser WD_C — has location_json + logs
  let recOther = ""; // otherUser (non-report)

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

  /** Custom company-scoped role with EXACT ATT (action, scope) pairs (mirror mig 0454). All sensitive. */
  async function grantAtt(
    companyId: string,
    userId: string,
    label: string,
    pairs: Array<[string, Scope]>,
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `att-${label}-${userId.slice(0, 8)}`);
    for (const [action, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, "attendance", true);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function plantRecord(
    companyId: string,
    userId: string,
    workDate: string,
    withLocation = false,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO attendance_records
         (company_id, user_id, work_date, status, attendance_status, location_json,
          check_in_at, late_minutes, early_leave_minutes, working_minutes)
       VALUES ($1,$2,$3,'present','Present',$4::jsonb,$5,0,0,480) RETURNING id`,
      [
        companyId,
        userId,
        workDate,
        withLocation ? JSON.stringify({ lat: 10.77, lng: 106.7, label: "HQ" }) : null,
        `${workDate}T01:00:00Z`,
      ],
    );
    return r.rows[0].id as string;
  }

  async function plantLog(
    companyId: string,
    recordId: string,
    employeeId: string,
    userId: string,
    workDate: string,
    logType: string,
  ): Promise<void> {
    await direct.query(
      `INSERT INTO attendance_logs
         (company_id, attendance_record_id, employee_id, user_id, work_date, log_type, source, is_valid,
          gps_latitude, gps_longitude, gps_accuracy_meters, location_label, ip_address, device_id,
          device_name, user_agent, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,'WEB',true,
          10.7700000,106.7000000,5.00,'HQ','1.2.3.4','dev-1','iPhone','UA/1.0',$7::jsonb)`,
      [companyId, recordId, employeeId, userId, workDate, logType, JSON.stringify({ a: 1 })],
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "attbe2a");
    B = await seedCompany(direct, "attbe2b");
    companyIds.push(A.companyId, B.companyId);

    const ouEng = await seedOrgUnit(A.companyId, "Engineering");
    const ouSales = await seedOrgUnit(A.companyId, "Sales");

    // ── Tenant A users ──
    mgrUser = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
    empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
    hrUser = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
    otherUser = await seedUser(direct, A.companyId, `other@${A.slug}.test`, hash);
    emrUser = await seedUser(direct, A.companyId, `emr@${A.slug}.test`, hash);
    noDetailUser = await seedUser(direct, A.companyId, `nodetail@${A.slug}.test`, hash);

    // ── employee_profiles ──
    await seedEmp(A.companyId, mgrUser, ouEng, null);
    empProfile = await seedEmp(A.companyId, empUser, ouEng, mgrUser); // report of mgr
    await seedEmp(A.companyId, hrUser, ouEng, null);
    await seedEmp(A.companyId, otherUser, ouSales, null); // non-report
    await seedEmp(A.companyId, emrUser, ouSales, null); // EMR-managed by mgr
    await plantEmr(A.companyId, emrUser, mgrUser);

    // ── attendance_records (tenant A) ──
    await plantRecord(A.companyId, empUser, WD_A);
    await plantRecord(A.companyId, empUser, WD_B);
    recEmpPrimary = await plantRecord(A.companyId, empUser, WD_C, true);
    await plantRecord(A.companyId, mgrUser, WD_C);
    recOther = await plantRecord(A.companyId, otherUser, WD_C);
    await plantRecord(A.companyId, emrUser, WD_C);
    await plantLog(A.companyId, recEmpPrimary, empProfile, empUser, WD_C, "Check-in");
    await plantLog(A.companyId, recEmpPrimary, empProfile, empUser, WD_C, "Check-out");

    // ── ATT grants (mirror mig 0454 per-pair scope) ──
    await grantAtt(A.companyId, empUser, "emp", [
      ["view-own", "Own"],
      ["view-detail", "Own"],
    ]);
    await grantAtt(A.companyId, mgrUser, "mgr", [
      ["view-team", "Team"],
      ["view-detail", "Team"],
    ]);
    await grantAtt(A.companyId, hrUser, "hr", [
      ["view-company", "Company"],
      ["view-detail", "Company"],
      ["view-sensitive", "Company"],
    ]);
    await grantAtt(A.companyId, noDetailUser, "viewown", [["view-own", "Own"]]); // no view-detail

    // ── Tenant B (cross-tenant deny) ──
    const bAdminUser = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
    await seedEmp(B.companyId, bAdminUser, null, null);
    await plantRecord(B.companyId, bAdminUser, WD_C);
    await grantAtt(B.companyId, bAdminUser, "badmin", [
      ["view-company", "Company"],
      ["view-detail", "Company"],
    ]);
  });

  afterAll(async () => {
    await direct
      ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
      .catch(() => undefined);
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── 1 · my-records: only own rows ──────────────────────────────────────────────
  it("employee /my-records → only own rows (other user's record absent)", async () => {
    const token = await login(A.slug, `emp@${A.slug}.test`);
    const res = await get(token, "/attendance/my-records?pageSize=100");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.data.items as Array<{ userId: string }>;
    expect(items.length).toBe(3);
    expect(items.every((r) => r.userId === empUser)).toBe(true);
    expect(items.some((r) => r.userId === otherUser)).toBe(false);
  });

  // ── 2 · employee /team-records → 403 ───────────────────────────────────────────
  it("employee /team-records → 403 (no view-team grant)", async () => {
    const token = await login(A.slug, `emp@${A.slug}.test`);
    const res = await get(token, "/attendance/team-records");
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // ── 3 · employee /records → 403 ────────────────────────────────────────────────
  it("employee /records → 403 (no view-company grant)", async () => {
    const token = await login(A.slug, `emp@${A.slug}.test`);
    const res = await get(token, "/attendance/records");
    expect(res.status).toBe(403);
  });

  // ── 4 · manager /team-records → reports ∪ self ∪ EMR-managed; non-report absent ──
  it("manager /team-records → reports ∪ self ∪ EMR-managed, non-report excluded", async () => {
    const token = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await get(token, "/attendance/team-records?pageSize=100");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const seen = new Set((res.body.data.items as Array<{ userId: string }>).map((r) => r.userId));
    expect(seen.has(empUser)).toBe(true); // direct report
    expect(seen.has(mgrUser)).toBe(true); // self
    expect(seen.has(emrUser)).toBe(true); // EMR-managed
    expect(seen.has(otherUser)).toBe(false); // non-report, same company
  });

  // ── 5 · manager /records → 403 ─────────────────────────────────────────────────
  it("manager /records → 403 (no view-company grant)", async () => {
    const token = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await get(token, "/attendance/records");
    expect(res.status).toBe(403);
  });

  // ── 6 · detail out-of-scope → 404 (not 403, not 200) ───────────────────────────
  it("detail out-of-scope (employee Own viewing another's record) → 404", async () => {
    const token = await login(A.slug, `emp@${A.slug}.test`);
    const res = await get(token, `/attendance/records/${recOther}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  // ── 7 · detail no-grant → 403 ──────────────────────────────────────────────────
  it("detail with NO view-detail grant → 403 (PermissionGuard)", async () => {
    const token = await login(A.slug, `nodetail@${A.slug}.test`);
    const res = await get(token, `/attendance/records/${recEmpPrimary}`);
    expect(res.status).toBe(403);
  });

  // ── 8 · cross-tenant → list excludes A, detail 404 ─────────────────────────────
  it("cross-tenant: tenant B admin list excludes tenant A rows + detail of an A record → 404", async () => {
    const token = await login(B.slug, `admin@${B.slug}.test`);
    const list = await get(token, "/attendance/records?pageSize=100");
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const seen = (list.body.data.items as Array<{ userId: string }>).map((r) => r.userId);
    for (const aUser of [empUser, mgrUser, hrUser, otherUser, emrUser]) {
      expect(seen).not.toContain(aUser);
    }
    const detail = await get(token, `/attendance/records/${recEmpPrimary}`);
    expect(detail.status).toBe(404);
  });

  // ── 9 · list never carries location/gps/ip/device (even hr) ────────────────────
  it("list response has NO location_json/gps/ip/device keys (even hr/Company scope)", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);
    const res = await get(token, "/attendance/records?pageSize=100");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.data.items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      for (const k of [
        "locationJson",
        "gpsLatitude",
        "ipAddress",
        "deviceId",
        "deviceName",
        "userAgent",
      ]) {
        expect(k in item).toBe(false);
      }
    }
  });

  // ── 10 · detail/logs WITHOUT view-sensitive (manager Team) → masked, isValid present ──
  it("manager (no view-sensitive) detail → locationJson null; logs → gps/ip/device null, isValid present", async () => {
    const token = await login(A.slug, `mgr@${A.slug}.test`);
    const detail = await get(token, `/attendance/records/${recEmpPrimary}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.data.locationJson).toBeNull();

    const logs = await get(token, `/attendance/records/${recEmpPrimary}/logs`);
    expect(logs.status, JSON.stringify(logs.body)).toBe(200);
    const items = logs.body.data.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(2);
    for (const log of items) {
      expect(log.gpsLatitude).toBeNull();
      expect(log.ipAddress).toBeNull();
      expect(log.deviceId).toBeNull();
      expect(log.isValid).toBe(true); // always-safe, no own-bypass needed
    }
  });

  // ── 11 · WITH view-sensitive (hr Company) → real gps/ip/device + locationJson ──
  it("hr (view-sensitive Company) detail → locationJson present; logs → real gps/ip/device", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);
    const detail = await get(token, `/attendance/records/${recEmpPrimary}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.data.locationJson).toMatchObject({ label: "HQ" });

    const logs = await get(token, `/attendance/records/${recEmpPrimary}/logs`);
    const items = logs.body.data.items as Array<Record<string, unknown>>;
    expect(items[0].gpsLatitude).toBe("10.7700000");
    expect(items[0].ipAddress).toBe("1.2.3.4");
    expect(items[0].deviceId).toBe("dev-1");
  });

  // ── 12 · employee own /logs → isValid present, gps null (no own bypass) ────────
  it("employee own /logs → isValid present, gpsLatitude null (no own-record bypass)", async () => {
    const token = await login(A.slug, `emp@${A.slug}.test`);
    const res = await get(token, `/attendance/records/${recEmpPrimary}/logs`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.data.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(2);
    expect(items[0].isValid).toBe(true);
    expect(items[0].gpsLatitude).toBeNull();
  });

  // ── 13 · invalid sort → 400; default workDate desc ─────────────────────────────
  it("invalid sort → 400 (Zod enum blocks ORDER BY injection); default sort = workDate desc", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);
    const bad = await get(token, "/attendance/records?sort=evil_col");
    expect(bad.status).toBe(400);

    const ok = await get(token, `/attendance/records?employeeId=${empProfile}&pageSize=100`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const dates = (ok.body.data.items as Array<{ workDate: string }>).map((r) => r.workDate);
    expect(dates).toEqual([WD_C, WD_B, WD_A]);
  });

  // ── 14 · pagination clamp + meta across 2 pages ────────────────────────────────
  it("pagination: pageSize>100 rejected; default 20; meta correct across 2 pages", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);

    const tooBig = await get(token, "/attendance/records?pageSize=101");
    expect(tooBig.status).toBe(400);

    const def = await get(token, `/attendance/records?employeeId=${empProfile}`);
    expect(def.body.data.meta.pageSize).toBe(20);

    const p1 = await get(token, `/attendance/records?employeeId=${empProfile}&pageSize=2&page=1`);
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    expect((p1.body.data.items as unknown[]).length).toBe(2);
    expect(p1.body.data.meta).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 3,
      totalPages: 2,
      hasNext: true,
      hasPrev: false,
    });

    const p2 = await get(token, `/attendance/records?employeeId=${empProfile}&pageSize=2&page=2`);
    expect((p2.body.data.items as unknown[]).length).toBe(1);
    expect(p2.body.data.meta).toMatchObject({ hasNext: false, hasPrev: true });
  });
});
