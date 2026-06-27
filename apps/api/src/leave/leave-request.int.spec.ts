/**
 * S3-LEAVE-BE-2 — Integration (Postgres THẬT, DB CÔ LẬP). LEAVE request WORKFLOW over the REAL HTTP path
 * (JwtAuthGuard → CompanyGuard → PermissionGuard → LeaveController → LeaveRequestService → RLS withTenant +
 * append-only ledger/history). KHÔNG mock permission — proves on the real path: 403 deny (missing pair),
 * cross-tenant 404 (RLS), server-authoritative actor (Zod strip), FSM Draft→Pending→Cancelled, overlap +
 * min-notice + balance guards, RESERVE/RELEASE ledger mechanics, audit + outbox in-tx. (Append-only DENIAL of
 * leave_balance_transactions + leave_request_approvals is proven by test/integration/leave-ledger-appendonly.)
 *
 * Roles: per-user CUSTOM company-scoped roles whose (action,resource,scope) MIRROR the mig-0455 LEAVE matrix
 * (create/submit/update-draft/cancel-own/view-own:leave = Own · view-own:leave-balance = Own · view:leave-type
 * = Company). Mirrors the S3-LEAVE-BE-1 / S3-ATT-BE-2 RBAC pattern (avoids the 2FA the canonical roles carry).
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated src/leave → vitest include
 * src/**\/*.spec.ts.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
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
type LeavePair = [action: string, resource: string, scope: Scope];

// Lưới ngày ISO đã kiểm: 2026-06-26 Fri … 2026-06-30 Tue. +7n giữ nguyên thứ.
const D_SINGLE = "2026-09-08"; // Tue (working)
const FRI = "2026-09-04"; // Fri (working)
const TUE_RANGE = "2026-09-08"; // Tue (working)
const HOLIDAY_MON = "2026-09-07"; // Mon (planted company holiday, affects leave)
const OVER_START = "2026-11-02"; // Mon
const OVER_END = "2026-11-06"; // Fri (5 working days)
const NOTICE_DATE = "2026-06-30"; // Tue, 3 days out (< min-notice 10)

const FULL_PAIRS: LeavePair[] = [
  ["create", "leave", "Own"],
  ["submit", "leave", "Own"],
  ["update-draft", "leave", "Own"],
  ["cancel-own", "leave", "Own"],
  ["view-own", "leave", "Own"],
  ["view", "leave-type", "Company"],
  ["view-own", "leave-balance", "Own"],
];

describe.skipIf(!runDb)("S3-LEAVE-BE-2 request workflow (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  // Leave types (unique codes → never collide with a runtime-seeded catalog).
  let annualA = ""; // deduct, all-day, minNotice 0
  let sickA = ""; // deduct, requireReason
  let noticeA = ""; // no deduct, minNotice 10
  let annualB = ""; // tenant B

  // Users (each its own profile + grants; balance per need).
  const u: Record<string, { id: string; profile: string }> = {};
  let noPermUserId = "";
  let bUserId = "";

  async function seedProfile(companyId: string, userId: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1,$2) RETURNING id`,
      [companyId, userId],
    );
    return r.rows[0].id as string;
  }

  async function grantLeave(
    companyId: string,
    userId: string,
    label: string,
    pairs: LeavePair[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `lv2-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function plantType(
    companyId: string,
    opts: {
      deduct: boolean;
      requireReason?: boolean;
      allowHourly?: boolean;
      minNotice?: number;
    },
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO leave_types
         (company_id, code, name, paid, status, deduct_balance, balance_unit,
          allow_full_day, allow_half_day, allow_hourly, allow_multiple_days,
          require_reason, min_notice_days, sort_order)
       VALUES ($1,$2,$3,true,'active',$4,'Day',true,true,$5,true,$6,$7,1) RETURNING id`,
      [
        companyId,
        `LT-${randomUUID().slice(0, 8)}`,
        "Leave type",
        opts.deduct,
        opts.allowHourly ?? false,
        opts.requireReason ?? false,
        opts.minNotice ?? 0,
      ],
    );
    return r.rows[0].id as string;
  }

  async function plantBalance(
    companyId: string,
    userId: string,
    leaveTypeId: string,
    opts: { total: number; used?: number; pending?: number; year?: number },
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO leave_balances
         (company_id, user_id, leave_type_id, year, total_days, used_days, pending_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        companyId,
        userId,
        leaveTypeId,
        opts.year ?? 2026,
        opts.total,
        opts.used ?? 0,
        opts.pending ?? null,
      ],
    );
    return r.rows[0].id as string;
  }

  async function plantHoliday(companyId: string, date: string): Promise<void> {
    await direct.query(
      `INSERT INTO public_holidays
         (company_id, holiday_code, name, holiday_date, holiday_type, affects_attendance, affects_leave_calculation, status)
       VALUES ($1,$2,$3,$4,'CompanyHoliday',true,true,'Active')`,
      [companyId, `CO-${randomUUID().slice(0, 8)}`, "H", date],
    );
  }

  /** Seed a leave_request directly (overlap blocker) with a given status. */
  async function plantRequest(
    companyId: string,
    userId: string,
    leaveTypeId: string,
    start: string,
    end: string,
    status: string,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO leave_requests
         (company_id, user_id, leave_type_id, start_date, end_date, total_days, status)
       VALUES ($1,$2,$3,$4,$5,1,$6) RETURNING id`,
      [companyId, userId, leaveTypeId, start, end, status],
    );
    return r.rows[0].id as string;
  }

  async function setupUser(
    companyId: string,
    key: string,
    opts: { pairs?: LeavePair[]; profile?: boolean; balanceType?: string; total?: number } = {},
  ): Promise<void> {
    const id = await seedUser(direct, companyId, `${key}@${A.slug}.test`, await hash());
    const profile = opts.profile === false ? "" : await seedProfile(companyId, id);
    if (opts.pairs) await grantLeave(companyId, id, key, opts.pairs);
    if (opts.balanceType && opts.total != null) {
      await plantBalance(companyId, id, opts.balanceType, { total: opts.total });
    }
    u[key] = { id, profile };
  }

  let _hash = "";
  async function hash(): Promise<string> {
    if (!_hash) _hash = await new PasswordService().hash(LOGIN_PW);
    return _hash;
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  const get = (token: string, url: string) =>
    request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`);
  const post = (token: string, url: string, body: object) =>
    request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`).send(body);
  const patch = (token: string, url: string, body: object) =>
    request(app.getHttpServer()).patch(url).set("Authorization", `Bearer ${token}`).send(body);

  async function countTx(requestId: string, type?: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int n FROM leave_balance_transactions
        WHERE leave_request_id=$1 ${type ? "AND transaction_type=$2" : ""}`,
      type ? [requestId, type] : [requestId],
    );
    return r.rows[0].n as number;
  }
  async function pendingOf(balanceId: string): Promise<number> {
    const r = await direct.query(
      `SELECT COALESCE(pending_days,0) p FROM leave_balances WHERE id=$1`,
      [balanceId],
    );
    return Number(r.rows[0].p);
  }
  async function remainingOf(balanceId: string): Promise<number> {
    const r = await direct.query(`SELECT remaining_days r FROM leave_balances WHERE id=$1`, [
      balanceId,
    ]);
    return Number(r.rows[0].r);
  }
  async function requestRow(id: string) {
    const r = await direct.query(
      `SELECT user_id, employee_id, company_id, status, balance_effect_status FROM leave_requests WHERE id=$1`,
      [id],
    );
    return r.rows[0];
  }
  async function countApprovals(requestId: string, action?: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int n FROM leave_request_approvals
        WHERE leave_request_id=$1 ${action ? "AND action=$2" : ""}`,
      action ? [requestId, action] : [requestId],
    );
    return r.rows[0].n as number;
  }
  async function countOutbox(
    companyId: string,
    eventType: string,
    requestId: string,
  ): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int n FROM outbox_events
        WHERE company_id=$1 AND event_type=$2 AND payload->>'requestId'=$3`,
      [companyId, eventType, requestId],
    );
    return r.rows[0].n as number;
  }
  async function countAudit(companyId: string, action: string, objectId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int n FROM audit_logs WHERE company_id=$1 AND action=$2 AND object_id=$3`,
      [companyId, action, objectId],
    );
    return r.rows[0].n as number;
  }
  async function activeDays(requestId: string): Promise<string[]> {
    const r = await direct.query(
      `SELECT work_date::text d FROM leave_request_days
        WHERE leave_request_id=$1 AND deleted_at IS NULL AND status='Active' ORDER BY work_date`,
      [requestId],
    );
    return r.rows.map((x: { d: string }) => x.d);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    A = await seedCompany(direct, "lvbe2a");
    B = await seedCompany(direct, "lvbe2b");
    companyIds.push(A.companyId, B.companyId);

    annualA = await plantType(A.companyId, { deduct: true });
    sickA = await plantType(A.companyId, { deduct: true, requireReason: true });
    noticeA = await plantType(A.companyId, { deduct: false, minNotice: 10 });
    await plantHoliday(A.companyId, HOLIDAY_MON);

    await setupUser(A.companyId, "reserve", { pairs: FULL_PAIRS, balanceType: annualA, total: 12 });
    await setupUser(A.companyId, "cancel", { pairs: FULL_PAIRS, balanceType: annualA, total: 12 });
    await setupUser(A.companyId, "canceldraft", {
      pairs: FULL_PAIRS,
      balanceType: annualA,
      total: 12,
    });
    await setupUser(A.companyId, "balance", { pairs: FULL_PAIRS, balanceType: annualA, total: 3 });
    await setupUser(A.companyId, "overlap", { pairs: FULL_PAIRS, balanceType: annualA, total: 60 });
    await setupUser(A.companyId, "draft", { pairs: FULL_PAIRS, balanceType: annualA, total: 20 });
    await setupUser(A.companyId, "strip", { pairs: FULL_PAIRS, balanceType: annualA, total: 12 });
    await setupUser(A.companyId, "dayrows", { pairs: FULL_PAIRS, balanceType: annualA, total: 12 });
    await setupUser(A.companyId, "reason", { pairs: FULL_PAIRS });
    await setupUser(A.companyId, "notice", { pairs: FULL_PAIRS });
    await setupUser(A.companyId, "noprofile", { pairs: FULL_PAIRS, profile: false });

    noPermUserId = await seedUser(direct, A.companyId, `noperm@${A.slug}.test`, await hash());
    await seedProfile(A.companyId, noPermUserId);

    // ── Tenant B (cross-tenant) ──
    bUserId = await seedUser(direct, B.companyId, `buser@${B.slug}.test`, await hash());
    await seedProfile(B.companyId, bUserId);
    annualB = await plantType(B.companyId, { deduct: true });
    await grantLeave(B.companyId, bUserId, "buser", FULL_PAIRS);
  });

  afterAll(async () => {
    await direct
      ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
      .catch(() => undefined);
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── 1 · create-for-another: Zod strips client identity → row keyed to actor ────
  it("create strips client employee_id/user_id/company_id → request keyed to actor", async () => {
    const token = await login(A.slug, `strip@${A.slug}.test`);
    const res = await post(token, "/leave/requests", {
      leaveTypeId: annualA,
      startDate: D_SINGLE,
      endDate: D_SINGLE,
      durationType: "FullDay",
      employee_id: u.draft.profile, // must be ignored
      user_id: u.draft.id, // must be ignored
      company_id: B.companyId, // must be ignored
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await requestRow(res.body.data.id);
    expect(row.user_id).toBe(u.strip.id);
    expect(row.employee_id).toBe(u.strip.profile);
    expect(row.company_id).toBe(A.companyId);
    expect(res.body.data.status).toBe("Draft");
  });

  // ── 2 · require_reason missing → 422 (validated at draft creation) ─────────────
  it("create reason-required type without reason → 422 LEAVE-ERR-REASON-REQUIRED", async () => {
    const token = await login(A.slug, `reason@${A.slug}.test`);
    const res = await post(token, "/leave/requests", {
      leaveTypeId: sickA,
      startDate: D_SINGLE,
      endDate: D_SINGLE,
      durationType: "FullDay",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe("LEAVE-ERR-REASON-REQUIRED");
  });

  // ── 3 · over-balance: submit blocked, NO reserve tx, pending unchanged ─────────
  it("submit over-balance (deduct, !allowNegative) → 422; no RESERVE tx; pending unchanged", async () => {
    const token = await login(A.slug, `balance@${A.slug}.test`);
    const balRow = await direct.query(
      `SELECT id FROM leave_balances WHERE user_id=$1 AND leave_type_id=$2`,
      [u.balance.id, annualA],
    );
    const balId = balRow.rows[0].id as string;
    const pendingBefore = await pendingOf(balId);

    const draft = await post(token, "/leave/requests", {
      leaveTypeId: annualA,
      startDate: OVER_START,
      endDate: OVER_END,
      durationType: "MultipleDays",
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    expect(draft.body.data.totalDays).toBe(5);

    const submit = await post(token, `/leave/requests/${draft.body.data.id}/submit`, {});
    expect(submit.status, JSON.stringify(submit.body)).toBe(422);
    expect(submit.body.error.code).toBe("LEAVE-ERR-BALANCE-NOT-ENOUGH");
    expect(await countTx(draft.body.data.id)).toBe(0);
    expect(await pendingOf(balId)).toBe(pendingBefore);
  });

  // ── 4 · reserve happy path: 1 RESERVE tx + pending+ + effect Reserved + 1 each ─
  it("submit happy: exactly 1 RESERVE tx + pending+1 + Reserved + 1 approval/outbox/audit; remaining unchanged", async () => {
    const token = await login(A.slug, `reserve@${A.slug}.test`);
    const balRow = await direct.query(
      `SELECT id FROM leave_balances WHERE user_id=$1 AND leave_type_id=$2`,
      [u.reserve.id, annualA],
    );
    const balId = balRow.rows[0].id as string;
    const pendingBefore = await pendingOf(balId);
    const remainingBefore = await remainingOf(balId);

    const res = await post(token, "/leave/requests", {
      leaveTypeId: annualA,
      startDate: D_SINGLE,
      endDate: D_SINGLE,
      durationType: "FullDay",
      submitNow: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.data.id as string;
    expect(res.body.data.status).toBe("Pending");
    expect(res.body.data.balanceEffectStatus).toBe("Reserved");

    expect(await countTx(id, "RESERVE")).toBe(1);
    expect(await countTx(id)).toBe(1);
    expect(await pendingOf(balId)).toBe(pendingBefore + 1);
    expect(await remainingOf(balId)).toBe(remainingBefore); // generated total-used; reserve never touches it
    expect(await countApprovals(id, "SUBMIT")).toBe(1);
    expect(await countOutbox(A.companyId, "leave.request.submitted", id)).toBe(1);
    expect(await countAudit(A.companyId, "leave.request.submit", id)).toBe(1);
  });

  // ── 5 · overlap: Pending/Approved/legacy-lowercase block; Rejected doesn't ─────
  it("submit overlap → 422 with conflicting id/dates (Pending/Approved/'pending' block; Rejected doesn't)", async () => {
    const token = await login(A.slug, `overlap@${A.slug}.test`);
    const W_PENDING = "2026-10-05";
    const W_APPROVED = "2026-10-12";
    const W_LEGACY = "2026-10-19";
    const W_REJECTED = "2026-10-26";
    const pendBlocker = await plantRequest(
      A.companyId,
      u.overlap.id,
      annualA,
      W_PENDING,
      W_PENDING,
      "Pending",
    );
    await plantRequest(A.companyId, u.overlap.id, annualA, W_APPROVED, W_APPROVED, "Approved");
    await plantRequest(A.companyId, u.overlap.id, annualA, W_LEGACY, W_LEGACY, "pending");
    await plantRequest(A.companyId, u.overlap.id, annualA, W_REJECTED, W_REJECTED, "Rejected");

    async function attempt(date: string) {
      const draft = await post(token, "/leave/requests", {
        leaveTypeId: annualA,
        startDate: date,
        endDate: date,
        durationType: "FullDay",
      });
      expect(draft.status, JSON.stringify(draft.body)).toBe(201);
      return post(token, `/leave/requests/${draft.body.data.id}/submit`, {});
    }

    const onPending = await attempt(W_PENDING);
    expect(onPending.status).toBe(422);
    expect(onPending.body.error.code).toBe("LEAVE-ERR-REQUEST-OVERLAP");
    expect(onPending.body.error.message).toContain(pendBlocker);

    expect((await attempt(W_APPROVED)).status).toBe(422);
    expect((await attempt(W_LEGACY)).status).toBe(422);
    // Rejected blocker does NOT block → submit succeeds (Pending).
    const onRejected = await attempt(W_REJECTED);
    expect(onRejected.status, JSON.stringify(onRejected.body)).toBe(200);
    expect(onRejected.body.data.status).toBe("Pending");
  });

  // ── 6 · PATCH on Pending → 409 ─────────────────────────────────────────────────
  it("PATCH a Pending request → 409 LEAVE-ERR-INVALID-STATE (only Draft is editable)", async () => {
    const token = await login(A.slug, `draft@${A.slug}.test`);
    const created = await post(token, "/leave/requests", {
      leaveTypeId: annualA,
      startDate: "2026-09-15",
      endDate: "2026-09-15",
      durationType: "FullDay",
      submitNow: true,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.status).toBe("Pending");
    const upd = await patch(token, `/leave/requests/${created.body.data.id}`, {
      leaveTypeId: annualA,
      startDate: "2026-09-16",
      endDate: "2026-09-16",
      durationType: "FullDay",
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(409);
    expect(upd.body.error.code).toBe("LEAVE-ERR-INVALID-STATE");
  });

  // ── 7 · cancel Pending reserved → RELEASE tx + pending- + Cancelled + event ────
  it("cancel a reserved Pending request → RELEASE tx + pending-1 + Cancelled + CANCEL approval + event", async () => {
    const token = await login(A.slug, `cancel@${A.slug}.test`);
    const balRow = await direct.query(
      `SELECT id FROM leave_balances WHERE user_id=$1 AND leave_type_id=$2`,
      [u.cancel.id, annualA],
    );
    const balId = balRow.rows[0].id as string;

    const created = await post(token, "/leave/requests", {
      leaveTypeId: annualA,
      startDate: "2026-09-22",
      endDate: "2026-09-22",
      durationType: "FullDay",
      submitNow: true,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    const pendingAfterReserve = await pendingOf(balId);
    expect(pendingAfterReserve).toBe(1);

    const cancel = await post(token, `/leave/requests/${id}/cancel`, {
      cancelReason: "đổi kế hoạch",
    });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(cancel.body.data.status).toBe("Cancelled");
    expect(cancel.body.data.balanceEffectStatus).toBe("Released");
    expect(await countTx(id, "RELEASE")).toBe(1);
    expect(await pendingOf(balId)).toBe(0);
    expect(await countApprovals(id, "CANCEL")).toBe(1);
    expect(await countOutbox(A.companyId, "leave.request.cancelled", id)).toBe(1);
    expect((await requestRow(id)).status).toBe("Cancelled");
  });

  // ── 8 · cancel Draft → Cancelled (no release tx) ──────────────────────────────
  it("cancel a Draft request → Cancelled, NO balance tx (nothing was reserved)", async () => {
    const token = await login(A.slug, `canceldraft@${A.slug}.test`);
    const created = await post(token, "/leave/requests", {
      leaveTypeId: annualA,
      startDate: "2026-09-29",
      endDate: "2026-09-29",
      durationType: "FullDay",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    const cancel = await post(token, `/leave/requests/${id}/cancel`, {});
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(cancel.body.data.status).toBe("Cancelled");
    expect(await countTx(id)).toBe(0);
    expect(await countApprovals(id, "CANCEL")).toBe(1);
  });

  // ── 9 · detail not-owner → 404; cross-tenant → 404 (no leak) ──────────────────
  it("GET /me/requests/:id of another user → 404; cross-tenant → 404", async () => {
    const draftToken = await login(A.slug, `draft@${A.slug}.test`);
    const created = await post(draftToken, "/leave/requests", {
      leaveTypeId: annualA,
      startDate: "2026-09-10",
      endDate: "2026-09-10",
      durationType: "FullDay",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;

    // owner sees it
    const own = await get(draftToken, `/leave/me/requests/${id}`);
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body.data.id).toBe(id);

    // another A user → 404 (self-locked)
    const stripToken = await login(A.slug, `strip@${A.slug}.test`);
    expect((await get(stripToken, `/leave/me/requests/${id}`)).status).toBe(404);

    // cross-tenant B user → 404 (RLS)
    const bToken = await login(B.slug, `buser@${B.slug}.test`);
    expect((await get(bToken, `/leave/me/requests/${id}`)).status).toBe(404);
  });

  // ── 10 · missing-perm → 403 each route; cross-tenant create → 404 ─────────────
  it("no-grant user → 403 on every workflow route; cross-tenant create (B's type) → 404", async () => {
    const token = await login(A.slug, `noperm@${A.slug}.test`);
    const fakeId = randomUUID();
    const body = {
      leaveTypeId: annualA,
      startDate: D_SINGLE,
      endDate: D_SINGLE,
      durationType: "FullDay",
    };
    expect((await post(token, "/leave/requests", body)).status).toBe(403);
    expect((await patch(token, `/leave/requests/${fakeId}`, body)).status).toBe(403);
    expect((await post(token, `/leave/requests/${fakeId}/submit`, {})).status).toBe(403);
    expect((await post(token, `/leave/requests/${fakeId}/cancel`, {})).status).toBe(403);
    expect((await get(token, "/leave/me/requests")).status).toBe(403);
    expect((await get(token, `/leave/me/requests/${fakeId}`)).status).toBe(403);

    // granted A user creating against tenant B's leaveTypeId → 404 (RLS: type invisible)
    const draftToken = await login(A.slug, `draft@${A.slug}.test`);
    const xtenant = await post(draftToken, "/leave/requests", { ...body, leaveTypeId: annualB });
    expect(xtenant.status, JSON.stringify(xtenant.body)).toBe(404);
  });

  // ── 11 · day-rows: Fri→Tue (weekend + holiday Mon) → Active rows only for working days ─
  it("create Fri→Tue across weekend + company holiday → leave_request_days Active rows only for working days", async () => {
    const token = await login(A.slug, `dayrows@${A.slug}.test`);
    const res = await post(token, "/leave/requests", {
      leaveTypeId: annualA,
      startDate: FRI,
      endDate: TUE_RANGE,
      durationType: "MultipleDays",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.totalDays).toBe(2); // Fri + Tue (Sat/Sun weekend, Mon holiday)
    expect(await activeDays(res.body.data.id)).toEqual([FRI, TUE_RANGE]);
  });

  // ── 13 · no employee_profiles → 422 EMPLOYEE-NOT-ELIGIBLE ─────────────────────
  it("user without employee_profile → create draft 422 LEAVE-ERR-EMPLOYEE-NOT-ELIGIBLE", async () => {
    const token = await login(A.slug, `noprofile@${A.slug}.test`);
    const res = await post(token, "/leave/requests", {
      leaveTypeId: annualA,
      startDate: D_SINGLE,
      endDate: D_SINGLE,
      durationType: "FullDay",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe("LEAVE-ERR-EMPLOYEE-NOT-ELIGIBLE");
  });

  // ── 14 · min-notice guard at submit ───────────────────────────────────────────
  it("submit inside min-notice window → 422 LEAVE-ERR-MIN-NOTICE", async () => {
    const token = await login(A.slug, `notice@${A.slug}.test`);
    const draft = await post(token, "/leave/requests", {
      leaveTypeId: noticeA,
      startDate: NOTICE_DATE,
      endDate: NOTICE_DATE,
      durationType: "FullDay",
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const submit = await post(token, `/leave/requests/${draft.body.data.id}/submit`, {});
    expect(submit.status, JSON.stringify(submit.body)).toBe(422);
    expect(submit.body.error.code).toBe("LEAVE-ERR-MIN-NOTICE");
  });

  // ── 15 · update draft recomputes + replaces day-rows; list reflects state ─────
  it("update Draft recomputes totals + replaces day-rows; /me/requests lists own only", async () => {
    const token = await login(A.slug, `draft@${A.slug}.test`);
    const created = await post(token, "/leave/requests", {
      leaveTypeId: annualA,
      startDate: "2026-09-17",
      endDate: "2026-09-17",
      durationType: "FullDay",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    expect(created.body.data.totalDays).toBe(1);
    expect(await activeDays(id)).toEqual(["2026-09-17"]);

    // widen to a 3-working-day range (Wed-Fri 2026-09-16..18)
    const upd = await patch(token, `/leave/requests/${id}`, {
      leaveTypeId: annualA,
      startDate: "2026-09-16",
      endDate: "2026-09-18",
      durationType: "MultipleDays",
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.data.totalDays).toBe(3);
    expect(await activeDays(id)).toEqual(["2026-09-16", "2026-09-17", "2026-09-18"]);

    const list = await get(token, "/leave/me/requests?pageSize=100");
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const items = list.body.data.items as Array<{ id: string }>;
    expect(items.some((x) => x.id === id)).toBe(true);
    expect(list.body.data.meta.total).toBeGreaterThanOrEqual(items.length);
  });
});
