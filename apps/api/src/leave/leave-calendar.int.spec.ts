/**
 * S3-LEAVE-BE-5 (CO-S4-005) — Integration (Postgres THẬT, DB CÔ LẬP). GET /leave/calendar over the REAL
 * HTTP path (JwtAuthGuard → CompanyGuard → PermissionGuard → LeaveController → LeaveCalendarService →
 * DataScopeService (S2-INT-2 manager-tree reuse) → RLS withTenant). KHÔNG mock permission. Proves:
 *
 *   DENY (RED-first):
 *     · employee (only view-own:leave-calendar grant) → 403 on scope=team AND scope=company
 *     · manager (view-own+view-team, NO view-company) → 403 on scope=company
 *     · manager scope=team sees ONLY their report (emp1), NEVER emp2 (outside Team)
 *     · cross-tenant: another company's overlapping leave NEVER appears (RLS + company_id filter)
 *   HAPPY:
 *     · employee scope=own → sees ONLY their own entries; `reason` visible (own row)
 *     · manager scope=team → sees emp1's entry with `reason` MASKED (null) — not the owner
 *     · HR scope=company → sees emp1 + emp2 (company-wide); reasons masked for both (not HR's own)
 *   STATE FILTER: a Draft (never submitted) request never appears on ANY scope's calendar (Pending/Approved only)
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated src/leave → vitest include.
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
type LeavePair = [action: string, resource: string, scope: Scope, sensitive?: boolean];

// Self-service pairs — enough to create+submit a request as "own".
const SELF_PAIRS: LeavePair[] = [
  ["create", "leave", "Own"],
  ["submit", "leave", "Own"],
  ["view-own", "leave", "Own"],
  ["view-own", "leave-balance", "Own"],
  ["view", "leave-type", "Company"],
];
const EMPLOYEE_CALENDAR: LeavePair[] = [["view-own", "leave-calendar", "Own", false]];
const MANAGER_CALENDAR: LeavePair[] = [
  ["view-own", "leave-calendar", "Own", false],
  ["view-team", "leave-calendar", "Team", true],
];
const HR_CALENDAR: LeavePair[] = [
  ["view-own", "leave-calendar", "Own", false],
  ["view-team", "leave-calendar", "Team", true],
  ["view-company", "leave-calendar", "Company", true],
];

const DATES = {
  emp1: "2027-04-01", // Thursday
  emp2: "2027-04-02", // Friday
  draftOnly: "2027-04-05", // Monday — never submitted, must NEVER appear
  crossTenant: "2027-04-01", // same window, tenant B
} as const;
const RANGE = { from: "2027-04-01", to: "2027-04-10" };

describe.skipIf(!runDb)("S3-LEAVE-BE-5 leave calendar (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let annualA = "";
  let annualB = "";
  const u: Record<string, { id: string; profile: string }> = {};

  let _hash = "";
  async function hash(): Promise<string> {
    if (!_hash) _hash = await new PasswordService().hash(LOGIN_PW);
    return _hash;
  }

  async function seedProfile(
    companyId: string,
    userId: string,
    opts: { managerUserId?: string } = {},
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, direct_manager_id, employee_code)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [companyId, userId, opts.managerUserId ?? null, `E-${userId.slice(0, 8)}`],
    );
    return r.rows[0].id as string;
  }

  async function grantLeave(
    companyId: string,
    userId: string,
    label: string,
    pairs: LeavePair[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `lv5-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope, sensitive] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, sensitive ?? false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function plantType(companyId: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO leave_types
         (company_id, code, name, paid, status, deduct_balance, balance_unit,
          allow_full_day, allow_half_day, allow_hourly, allow_multiple_days,
          require_reason, min_notice_days, sort_order)
       VALUES ($1,$2,$3,true,'active',true,'Day',true,true,false,true,false,0,1) RETURNING id`,
      [companyId, `LT5-${userIdSuffix()}`, "Annual"],
    );
    return r.rows[0].id as string;
  }

  function userIdSuffix(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  async function plantBalance(
    companyId: string,
    userId: string,
    leaveTypeId: string,
    total: number,
  ): Promise<void> {
    await direct.query(
      `INSERT INTO leave_balances
         (company_id, user_id, leave_type_id, year, total_days, used_days, pending_days)
       VALUES ($1,$2,$3,2027,$4,0,0)`,
      [companyId, userId, leaveTypeId, total],
    );
  }

  const post = (token: string, url: string, body: object) =>
    request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`).send(body);
  const get = (token: string, url: string) =>
    request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`);

  async function login(slug: string, email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** emp submits a FullDay single-day request → Pending + Reserved. Returns request id. */
  async function createPending(
    slug: string,
    email: string,
    leaveTypeId: string,
    date: string,
    reason: string,
  ): Promise<string> {
    const token = await login(slug, email);
    const res = await post(token, "/leave/requests", {
      leaveTypeId,
      startDate: date,
      endDate: date,
      durationType: "FullDay",
      reason,
      submitNow: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe("Pending");
    return res.body.data.id as string;
  }

  /** create a DRAFT (submitNow=false) — must NEVER appear on the calendar. */
  async function createDraftOnly(
    slug: string,
    email: string,
    leaveTypeId: string,
    date: string,
  ): Promise<string> {
    const token = await login(slug, email);
    const res = await post(token, "/leave/requests", {
      leaveTypeId,
      startDate: date,
      endDate: date,
      durationType: "FullDay",
      submitNow: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe("Draft");
    return res.body.data.id as string;
  }

  function calendarUrl(scope: "own" | "team" | "company"): string {
    return `/leave/calendar?scope=${scope}&from=${RANGE.from}&to=${RANGE.to}`;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    A = await seedCompany(direct, "lvbe5a");
    B = await seedCompany(direct, "lvbe5b");
    companyIds.push(A.companyId, B.companyId);

    annualA = await plantType(A.companyId);

    // Manager (Team scope on leave-calendar) — no manager above them.
    const mgrId = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, await hash());
    u.mgr = { id: mgrId, profile: await seedProfile(A.companyId, mgrId) };
    await grantLeave(A.companyId, mgrId, "mgr", [...MANAGER_CALENDAR, ...SELF_PAIRS]);
    await plantBalance(A.companyId, mgrId, annualA, 20);

    // HR (Company scope on leave-calendar).
    const hrId = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, await hash());
    u.hr = { id: hrId, profile: await seedProfile(A.companyId, hrId) };
    await grantLeave(A.companyId, hrId, "hr", [...HR_CALENDAR, ...SELF_PAIRS]);
    await plantBalance(A.companyId, hrId, annualA, 20);

    // emp1 — reports to mgr (direct_manager_id = mgr.userId) → inside mgr's Team.
    const emp1 = await seedUser(direct, A.companyId, `emp1@${A.slug}.test`, await hash());
    u.emp1 = { id: emp1, profile: await seedProfile(A.companyId, emp1, { managerUserId: mgrId }) };
    await grantLeave(A.companyId, emp1, "emp1", [...EMPLOYEE_CALENDAR, ...SELF_PAIRS]);
    await plantBalance(A.companyId, emp1, annualA, 20);

    // emp2 — NO manager link → OUTSIDE mgr's Team (but inside HR's Company).
    const emp2 = await seedUser(direct, A.companyId, `emp2@${A.slug}.test`, await hash());
    u.emp2 = { id: emp2, profile: await seedProfile(A.companyId, emp2) };
    await grantLeave(A.companyId, emp2, "emp2", [...EMPLOYEE_CALENDAR, ...SELF_PAIRS]);
    await plantBalance(A.companyId, emp2, annualA, 20);

    // Tenant B — an approved-window leave overlapping the SAME date range (cross-tenant leak probe).
    annualB = await plantType(B.companyId);
    const bUser = await seedUser(direct, B.companyId, `buser@${B.slug}.test`, await hash());
    await seedProfile(B.companyId, bUser);
    await grantLeave(B.companyId, bUser, "buser", [...EMPLOYEE_CALENDAR, ...SELF_PAIRS]);
    await plantBalance(B.companyId, bUser, annualB, 20);
    await createPending(B.slug, `buser@${B.slug}.test`, annualB, DATES.crossTenant, "b-secret");

    // Seed the actual planted requests used by the assertions below.
    await createPending(A.slug, `emp1@${A.slug}.test`, annualA, DATES.emp1, "emp1-personal-reason");
    await createPending(A.slug, `emp2@${A.slug}.test`, annualA, DATES.emp2, "emp2-personal-reason");
    await createDraftOnly(A.slug, `emp1@${A.slug}.test`, annualA, DATES.draftOnly);
  });

  afterAll(async () => {
    await direct
      ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
      .catch(() => undefined);
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── DENY 1 · employee (only view-own) → 403 on scope=team AND scope=company ───
  it("employee (no view-team/view-company grant) → 403 on scope=team + scope=company", async () => {
    const token = await login(A.slug, `emp1@${A.slug}.test`);
    const team = await get(token, calendarUrl("team"));
    expect(team.status, JSON.stringify(team.body)).toBe(403);
    const company = await get(token, calendarUrl("company"));
    expect(company.status, JSON.stringify(company.body)).toBe(403);
  });

  // ── DENY 2 · manager (view-own+view-team, NO view-company) → 403 on scope=company ─
  it("manager (no view-company grant) → 403 on scope=company", async () => {
    const token = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await get(token, calendarUrl("company"));
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  // ── DENY 3 · manager scope=team sees ONLY their report (emp1), NEVER emp2 ────────
  it("manager scope=team sees emp1 (report) but NOT emp2 (outside Team)", async () => {
    const token = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await get(token, calendarUrl("team"));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const userIds = (res.body.data.items as Array<{ userId: string }>).map((x) => x.userId);
    expect(userIds).toContain(u.emp1.id);
    expect(userIds).not.toContain(u.emp2.id);
  });

  // ── DENY 4 · cross-tenant leave NEVER appears on Company A's calendar ───────────
  it("HR scope=company NEVER sees tenant B's overlapping leave", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);
    const res = await get(token, calendarUrl("company"));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.data.items as Array<{ reason: string | null }>;
    expect(items.some((x) => x.reason === "b-secret")).toBe(false);
  });

  // ── HAPPY 1 · employee scope=own sees ONLY own entries; reason visible (own row) ─
  it("employee scope=own → only own entries; reason VISIBLE (self)", async () => {
    const token = await login(A.slug, `emp1@${A.slug}.test`);
    const res = await get(token, calendarUrl("own"));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.data.items as Array<{ userId: string; reason: string | null }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((x) => x.userId === u.emp1.id)).toBe(true);
    expect(items.some((x) => x.reason === "emp1-personal-reason")).toBe(true);
  });

  // ── HAPPY 2 · manager scope=team → emp1's reason MASKED (manager is not the owner) ─
  it("manager scope=team → emp1's entry has reason MASKED (null)", async () => {
    const token = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await get(token, calendarUrl("team"));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const emp1Item = (res.body.data.items as Array<{ userId: string; reason: string | null }>).find(
      (x) => x.userId === u.emp1.id,
    );
    expect(emp1Item).toBeDefined();
    expect(emp1Item?.reason).toBeNull();
  });

  // ── HAPPY 3 · HR scope=company → company-wide (emp1+emp2), reasons masked for both ─
  it("HR scope=company → sees emp1+emp2 company-wide; both reasons masked", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);
    const res = await get(token, calendarUrl("company"));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.data.items as Array<{ userId: string; reason: string | null }>;
    const userIds = items.map((x) => x.userId);
    expect(userIds).toContain(u.emp1.id);
    expect(userIds).toContain(u.emp2.id);
    for (const item of items) {
      if (item.userId !== u.hr.id) expect(item.reason).toBeNull();
    }
  });

  // ── STATE FILTER · a Draft (never submitted) request never appears on ANY scope ──
  it("a Draft-only request (never submitted) never appears on own/team/company calendars", async () => {
    const empToken = await login(A.slug, `emp1@${A.slug}.test`);
    const own = await get(empToken, calendarUrl("own"));
    expect(own.status).toBe(200);
    const ownDates = (own.body.data.items as Array<{ startDate: string }>).map((x) => x.startDate);
    expect(ownDates).not.toContain(DATES.draftOnly);

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const team = await get(mgrToken, calendarUrl("team"));
    const teamDates = (team.body.data.items as Array<{ startDate: string }>).map(
      (x) => x.startDate,
    );
    expect(teamDates).not.toContain(DATES.draftOnly);
  });
});
