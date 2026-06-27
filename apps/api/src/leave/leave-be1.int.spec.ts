/**
 * S3-LEAVE-BE-1 — Integration (Postgres THẬT, DB CÔ LẬP). LEAVE read/preview over the REAL HTTP path
 * (JwtAuthGuard → CompanyGuard → PermissionGuard → LeaveController → LeaveReadService → RLS withTenant +
 * HolidaysService). KHÔNG mock permission — proves on the real path: 403 deny (missing pair), cross-tenant
 * 0-row/404 (RLS), own-only balances, holiday/weekend exclusion, and that calculate is PREVIEW-ONLY (no
 * leave_balances / leave_balance_transactions / leave_requests mutation; client fields ignored).
 *
 * Roles: per-user CUSTOM company-scoped roles whose (action,resource,scope) MIRROR the mig-0455 LEAVE matrix
 * (view:leave-type=Company · view-own:leave-balance=Own · create:leave=Own). Mirrors the S3-ATT-BE-2 RBAC
 * pattern — controllable per-pair, and avoids the 2FA enforcement the canonical hr/company-admin roles carry.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env → hasDb=true ⇒ đỏ-giả trên DB
 * dev chung; chỉ chạy trên DB cô lập lane. Colocated src/leave → vitest include src/**\/*.spec.ts.
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
const YEAR = 2026;

type Scope = "Own" | "Team" | "Department" | "Company" | "System";
type LeavePair = [action: string, resource: string, scope: Scope];

// 2026-06-26 Fri · 27 Sat · 28 Sun · 29 Mon · 30 Tue (verified ISO weekday lattice; same as unit spec).
const FRI = "2026-06-26";
const TUE = "2026-06-30";
const HOLIDAY_MON = "2026-06-29";

describe.skipIf(!runDb)(
  "S3-LEAVE-BE-1 types + me/balances + calculate preview (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    // Tenant A users.
    let empUser = ""; // full read+create perms, has ANNUAL balance
    let otherUser = ""; // has a balance — must NOT appear in empUser's /me/balances
    let noPermUser = ""; // no leave grants → 403 everywhere
    let emptyUser = ""; // view-own:leave-balance but NO balance rows → []

    // Tenant A leave types / balances.
    let annualTypeA = ""; // deduct=true
    let unpaidTypeA = ""; // deduct=false
    let sickTypeA = ""; // deduct=true, NO balance for empUser
    let empBalanceId = "";
    let otherBalanceId = "";

    // Tenant B (cross-tenant).
    let bAdminUser = "";
    let annualTypeB = "";

    async function grantLeave(
      companyId: string,
      userId: string,
      label: string,
      pairs: LeavePair[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `lv-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource, scope] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resource, false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    async function plantType(
      companyId: string,
      code: string,
      name: string,
      opts: { deduct: boolean; status?: string; unit?: string; sortOrder?: number },
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO leave_types
         (company_id, code, name, paid, status, deduct_balance, balance_unit, sort_order)
       VALUES ($1,$2,$3,true,$4,$5,$6,$7) RETURNING id`,
        [
          companyId,
          code,
          name,
          opts.status ?? "active",
          opts.deduct,
          opts.unit ?? "Day",
          opts.sortOrder ?? 1,
        ],
      );
      return r.rows[0].id as string;
    }

    async function plantBalance(
      companyId: string,
      userId: string,
      leaveTypeId: string,
      opts: { total: number; used: number; opening?: number; pending?: number; adjusted?: number },
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO leave_balances
         (company_id, user_id, leave_type_id, year, total_days, used_days, opening_days, pending_days, adjusted_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          companyId,
          userId,
          leaveTypeId,
          YEAR,
          opts.total,
          opts.used,
          opts.opening ?? null,
          opts.pending ?? null,
          opts.adjusted ?? null,
        ],
      );
      return r.rows[0].id as string;
    }

    async function plantHoliday(companyId: string, code: string, date: string): Promise<void> {
      await direct.query(
        `INSERT INTO public_holidays
         (company_id, holiday_code, name, holiday_date, holiday_type, affects_attendance, affects_leave_calculation, status)
       VALUES ($1,$2,$3,$4,'CompanyHoliday',true,true,'Active')`,
        [companyId, code, `Holiday ${code}`, date],
      );
    }

    async function countRows(
      table: "leave_balances" | "leave_balance_transactions" | "leave_requests",
      companyId: string,
    ): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE company_id = $1`,
        [companyId],
      );
      return r.rows[0].n as number;
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

    function post(token: string, url: string, body: object) {
      return request(app.getHttpServer())
        .post(url)
        .set("Authorization", `Bearer ${token}`)
        .send(body);
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "lvbe1a");
      B = await seedCompany(direct, "lvbe1b");
      companyIds.push(A.companyId, B.companyId);

      // ── Tenant A users ──
      empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
      otherUser = await seedUser(direct, A.companyId, `other@${A.slug}.test`, hash);
      noPermUser = await seedUser(direct, A.companyId, `noperm@${A.slug}.test`, hash);
      emptyUser = await seedUser(direct, A.companyId, `empty@${A.slug}.test`, hash);

      // ── Tenant A leave types ──
      annualTypeA = await plantType(A.companyId, "ANNUAL", "Nghỉ phép năm", {
        deduct: true,
        sortOrder: 1,
      });
      unpaidTypeA = await plantType(A.companyId, "UNPAID", "Nghỉ không lương", {
        deduct: false,
        sortOrder: 2,
      });
      sickTypeA = await plantType(A.companyId, "SICK", "Nghỉ ốm", { deduct: true, sortOrder: 3 });
      // Inactive type — must NOT appear in GET /leave/types.
      await plantType(A.companyId, "ARCHIVED", "Đã lưu trữ", {
        deduct: false,
        status: "inactive",
        sortOrder: 9,
      });

      // ── Tenant A balances (year 2026) ──
      empBalanceId = await plantBalance(A.companyId, empUser, annualTypeA, {
        total: 12,
        used: 2,
        opening: 12,
        pending: 1,
        adjusted: 0,
      });
      otherBalanceId = await plantBalance(A.companyId, otherUser, annualTypeA, {
        total: 8,
        used: 0,
      });

      // ── Tenant A holiday (Mon 2026-06-29, affects leave) ──
      await plantHoliday(A.companyId, "CO-2026-06-29", HOLIDAY_MON);

      // ── Tenant A grants ──
      await grantLeave(A.companyId, empUser, "emp", [
        ["view", "leave-type", "Company"],
        ["view-own", "leave-balance", "Own"],
        ["create", "leave", "Own"],
      ]);
      await grantLeave(A.companyId, emptyUser, "empty", [["view-own", "leave-balance", "Own"]]);
      // noPermUser: NO grants.

      // ── Tenant B (cross-tenant deny) ──
      bAdminUser = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
      annualTypeB = await plantType(B.companyId, "ANNUAL", "B Annual", { deduct: true });
      await plantBalance(B.companyId, bAdminUser, annualTypeB, { total: 5, used: 0 });
      await grantLeave(B.companyId, bAdminUser, "badmin", [
        ["view", "leave-type", "Company"],
        ["view-own", "leave-balance", "Own"],
        ["create", "leave", "Own"],
      ]);
    });

    afterAll(async () => {
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ── 1 · /me/balances → only own rows (other user's balance absent) ─────────────
    it("employee /leave/me/balances → only own rows; other user's balance absent; fields mapped", async () => {
      const token = await login(A.slug, `emp@${A.slug}.test`);
      const res = await get(token, "/leave/me/balances");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data as Array<{
        id: string;
        leaveType: { code: string };
        openingBalance: number;
        usedDays: number;
        reservedDays: number;
        adjustedDays: number;
        remainingDays: number;
        unit: string;
        periodYear: number;
      }>;
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe(empBalanceId);
      expect(items.some((b) => b.id === otherBalanceId)).toBe(false);
      expect(items[0]).toMatchObject({
        leaveType: { code: "ANNUAL" },
        openingBalance: 12,
        usedDays: 2,
        reservedDays: 1, // pending_days → reserved
        adjustedDays: 0,
        remainingDays: 10, // generated total - used
        unit: "Day",
        periodYear: YEAR,
      });
    });

    // ── 2 · missing-perm → 403 on each new/re-gated route ──────────────────────────
    it("no-grant user → 403 on /types, /me/balances, /requests/calculate (fail-closed)", async () => {
      const token = await login(A.slug, `noperm@${A.slug}.test`);
      const types = await get(token, "/leave/types");
      expect(types.status).toBe(403);
      const bal = await get(token, "/leave/me/balances");
      expect(bal.status).toBe(403);
      const calc = await post(token, "/leave/requests/calculate", {
        leaveTypeId: annualTypeA,
        startDate: TUE,
        endDate: TUE,
        durationType: "FullDay",
      });
      expect(calc.status).toBe(403);
    });

    // ── 3 · cross-tenant: A actor cannot read B; calculate with B's type → 404 ─────
    it("cross-tenant: tenant A /types+/me/balances exclude B; calculate B's leaveTypeId → 404 (RLS)", async () => {
      const tokenA = await login(A.slug, `emp@${A.slug}.test`);

      // B admin sees ONLY B types (not A's ANNUAL row id).
      const tokenB = await login(B.slug, `admin@${B.slug}.test`);
      const bTypes = await get(tokenB, "/leave/types");
      expect(bTypes.status, JSON.stringify(bTypes.body)).toBe(200);
      const bIds = (bTypes.body.data as Array<{ id: string }>).map((t) => t.id);
      expect(bIds).toContain(annualTypeB);
      for (const aType of [annualTypeA, unpaidTypeA, sickTypeA]) expect(bIds).not.toContain(aType);

      // A actor previewing against B's leaveTypeId → 404 (RLS: type not visible in A's tenant).
      const calc = await post(tokenA, "/leave/requests/calculate", {
        leaveTypeId: annualTypeB,
        startDate: TUE,
        endDate: TUE,
        durationType: "FullDay",
      });
      expect(calc.status, JSON.stringify(calc.body)).toBe(404);
    });

    // ── 4 · calculate ignores client-supplied values (server-authoritative) ────────
    it("calculate strips client calculated_days/balance_after/employee_id → server values used", async () => {
      const token = await login(A.slug, `emp@${A.slug}.test`);
      const res = await post(token, "/leave/requests/calculate", {
        leaveTypeId: annualTypeA,
        startDate: TUE, // single working Tue
        endDate: TUE,
        durationType: "FullDay",
        employee_id: otherUser, // must be ignored
        calculated_days: 999, // must be ignored
        calculated_hours: 999,
        balance_after: -50,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.calculated_days).toBe(1);
      expect(d.calculated_hours).toBe(8);
      expect(d.is_balance_required).toBe(true);
      expect(d.balance).toMatchObject({
        remaining_days: 10,
        requested_days: 1,
        after_remaining_days: 9,
        is_enough: true,
      });
    });

    // ── 5 · calculate does NOT mutate (preview only) ───────────────────────────────
    it("calculate writes nothing: leave_balances/_transactions/_requests counts + used_days unchanged", async () => {
      const token = await login(A.slug, `emp@${A.slug}.test`);
      const before = {
        bal: await countRows("leave_balances", A.companyId),
        tx: await countRows("leave_balance_transactions", A.companyId),
        req: await countRows("leave_requests", A.companyId),
      };
      const usedBefore = (
        await direct.query("SELECT used_days FROM leave_balances WHERE id = $1", [empBalanceId])
      ).rows[0].used_days;

      const res = await post(token, "/leave/requests/calculate", {
        leaveTypeId: annualTypeA,
        startDate: FRI,
        endDate: TUE,
        durationType: "MultipleDays",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      expect(await countRows("leave_balances", A.companyId)).toBe(before.bal);
      expect(await countRows("leave_balance_transactions", A.companyId)).toBe(before.tx);
      expect(await countRows("leave_requests", A.companyId)).toBe(before.req);
      const usedAfter = (
        await direct.query("SELECT used_days FROM leave_balances WHERE id = $1", [empBalanceId])
      ).rows[0].used_days;
      expect(usedAfter).toBe(usedBefore);
    });

    // ── 6 · empty balance is VALID (no 500) ────────────────────────────────────────
    it("empty balances → /me/balances [] (no 500); deduct-type w/o balance → remaining 0, is_enough false", async () => {
      const emptyToken = await login(A.slug, `empty@${A.slug}.test`);
      const bal = await get(emptyToken, "/leave/me/balances");
      expect(bal.status, JSON.stringify(bal.body)).toBe(200);
      expect(bal.body.data).toEqual([]);

      const empToken = await login(A.slug, `emp@${A.slug}.test`);
      const calc = await post(empToken, "/leave/requests/calculate", {
        leaveTypeId: sickTypeA, // deduct=true but empUser has NO SICK balance
        startDate: TUE,
        endDate: TUE,
        durationType: "FullDay",
      });
      expect(calc.status, JSON.stringify(calc.body)).toBe(200);
      expect(calc.body.data.is_balance_required).toBe(true);
      expect(calc.body.data.balance).toMatchObject({
        remaining_days: 0,
        requested_days: 1,
        after_remaining_days: -1,
        is_enough: false,
      });
    });

    // ── 7 · holiday + weekend exclusion ────────────────────────────────────────────
    it("calculate Fri→Tue spanning weekend + company holiday Mon → 2 working days, correct per-day flags", async () => {
      const token = await login(A.slug, `emp@${A.slug}.test`);
      const res = await post(token, "/leave/requests/calculate", {
        leaveTypeId: annualTypeA,
        startDate: FRI, // Fri 26
        endDate: TUE, // Tue 30
        durationType: "MultipleDays",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.calculated_days).toBe(2); // Fri + Tue (Sat/Sun weekend, Mon holiday)
      expect(d.calculated_hours).toBe(16);

      const byDate = Object.fromEntries(
        (
          d.days as Array<{
            date: string;
            is_working_day: boolean;
            is_public_holiday: boolean;
            leave_days: number;
          }>
        ).map((x) => [x.date, x]),
      );
      expect(byDate[FRI]).toMatchObject({
        is_working_day: true,
        is_public_holiday: false,
        leave_days: 1,
      });
      expect(byDate["2026-06-27"]).toMatchObject({ is_working_day: false, leave_days: 0 }); // Sat
      expect(byDate["2026-06-28"]).toMatchObject({ is_working_day: false, leave_days: 0 }); // Sun
      expect(byDate[HOLIDAY_MON]).toMatchObject({
        is_working_day: false,
        is_public_holiday: true,
        leave_days: 0,
      });
      expect(byDate[TUE]).toMatchObject({
        is_working_day: true,
        is_public_holiday: false,
        leave_days: 1,
      });
    });

    // ── 8 · /types happy: active-only, sorted; non-deduct calculate → balance null ─
    it("GET /leave/types → active only (ARCHIVED excluded), sorted; UNPAID calculate → balance null", async () => {
      const token = await login(A.slug, `emp@${A.slug}.test`);
      const types = await get(token, "/leave/types");
      expect(types.status, JSON.stringify(types.body)).toBe(200);
      const codes = (types.body.data as Array<{ code: string }>).map((t) => t.code);
      expect(codes).toEqual(["ANNUAL", "UNPAID", "SICK"]); // sortOrder 1,2,3; ARCHIVED (inactive) excluded

      const calc = await post(token, "/leave/requests/calculate", {
        leaveTypeId: unpaidTypeA, // deduct=false
        startDate: TUE,
        endDate: TUE,
        durationType: "FullDay",
      });
      expect(calc.status, JSON.stringify(calc.body)).toBe(200);
      expect(calc.body.data.is_balance_required).toBe(false);
      expect(calc.body.data.balance).toBeNull();
      expect(calc.body.data.calculated_days).toBe(1);
    });
  },
);
