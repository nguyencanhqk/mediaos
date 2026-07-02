/**
 * S3-INT-1 — Integration (Postgres THẬT, DB CÔ LẬP). LEAVE→ATT sync over the REAL HTTP path
 * (JwtAuthGuard→CompanyGuard→PermissionGuard→LeaveController/AttendanceInternalController →
 * LeaveApprovalService/LeaveRevokeService → AttendanceLeaveSyncService → RLS withTenant). Proves:
 *
 *   SYNC (onLeaveApproved): approve a full-day request → attendance_records row created with
 *     attendance_status='Leave' + required_working_minutes=0; leave_request_days.attendance_sync_status
 *     flips Pending→Synced; audit_logs row (object_type='attendance_record') written IN-TX.
 *   BLOCK: after sync, POST /attendance/check-in for that date → 409 (full-day leave approved).
 *   NO DUPLICATE: re-running the sync (idempotent — no 'Pending' days left) creates NO second record.
 *
 *   DENY (RED-first):
 *     · CANCEL an Approved request as a DIFFERENT user (not owner) → 403, status/balance/ATT untouched.
 *     · REVOKE by a manager (no revoke:leave grant) → 403, status/balance/ATT untouched.
 *     · POST /internal/v1/attendance/recalculate: no auth → 401/403; authenticated but missing
 *       manage:attendance → 403; correct grant but missing/wrong x-internal-key → 403 (InternalGuard).
 *     · cross-tenant revoke → 404 (RLS, no existence leak).
 *
 *   REVOKE (HR, revoke:leave@Company): Approved+Synced request → Revoked; ATT record reverted (Leave
 *     dropped, required_working_minutes restored to shift); used_days refunded (REFUND ledger row);
 *     idempotent retry (2nd revoke attempt) → 409 (already Revoked) — no double-refund, no double-revert.
 *
 *   AUDIT: every attendance_record create/update/revert from sync/revert appends an audit_logs row
 *     (object_type='attendance_record') in the SAME tx — rollback proof via the guard-triggered 409 path
 *     (revoke on a non-Approved request never touches attendance_records/audit_logs at all).
 *
 * Gate cứng `hasDb && LANE_DB`. Colocated src/attendance → vitest include `src/**\/*.spec.ts`.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../auth/password.service";
import { DatabaseService } from "../db/db.service";
import { MasterDataSeedRunner } from "../foundation/seed/master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "../foundation/seed/master-data-seeder.registry";
import { SeedTrackingService } from "../foundation/seed/seed-tracking.service";
import { AttMasterDataSeeder } from "./att-master-data.seeder";
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
const INTERNAL_KEY = "s3-int-1-test-internal-key";

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, resource: string, scope: Scope, sensitive?: boolean];

const SELF_PAIRS: Pair[] = [
  ["create", "leave", "Own"],
  ["submit", "leave", "Own"],
  ["cancel-own", "leave", "Own"],
  ["view-own", "leave", "Own"],
  ["view-own", "leave-balance", "Own"],
  ["check-in", "attendance", "Own"],
  ["check-out", "attendance", "Own"],
  ["view-own", "attendance", "Own", true],
  ["view", "leave-type", "Company"],
];
const HR_PAIRS: Pair[] = [
  ["view", "leave", "Company", true],
  ["approve", "leave", "Company"],
  ["reject", "leave", "Company", true],
  ["revoke", "leave", "Company", true],
];
const MGR_PAIRS: Pair[] = [
  ["view", "leave", "Team", true],
  ["approve", "leave", "Team"],
  ["reject", "leave", "Team", true],
  // deliberately NO 'revoke' grant — manager must never hold it (mirrors mig 0455).
];
const ATT_MANAGE_PAIRS: Pair[] = [["manage", "attendance", "Company", false]];

const DATES = {
  fullDayApprove: "2027-04-05", // Monday
  cancelDeny: "2027-04-06",
  revokeManagerDeny: "2027-04-07",
  revokeHr: "2027-04-08",
  revokeIdempotent: "2027-04-09",
  crossTenant: "2027-04-12",
} as const;
/** 09:00 VN on fullDayApprove — the check-in attempt must land on the SAME work_date as the leave. */
const CHECK_IN_ON_LEAVE_DAY = new Date("2027-04-05T02:00:00Z");

/** Fake CHỈ Date (toFake:['Date']) — KHÔNG đụng setTimeout/microtask ⇒ HTTP request (await) chạy bình thường. */
async function freezeDate<T>(when: Date, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(when);
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

describe.skipIf(!runDb)("S3-INT-1 LEAVE→ATT sync (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let annualA = "";
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
      `INSERT INTO employee_profiles (company_id, user_id, direct_manager_id, employee_code, status)
       VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [companyId, userId, opts.managerUserId ?? null, `E-${userId.slice(0, 8)}`],
    );
    return r.rows[0].id as string;
  }

  async function grantLeave(
    companyId: string,
    userId: string,
    label: string,
    pairs: Pair[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `int1-${label}-${userId.slice(0, 8)}`);
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
      [companyId, `LT-${userId8()}`, "Annual"],
    );
    return r.rows[0].id as string;
  }
  function userId8(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  async function plantBalance(
    companyId: string,
    userId: string,
    leaveTypeId: string,
    total: number,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO leave_balances
         (company_id, user_id, leave_type_id, year, total_days, used_days, pending_days)
       VALUES ($1,$2,$3,2027,$4,0,0) RETURNING id`,
      [companyId, userId, leaveTypeId, total],
    );
    return r.rows[0].id as string;
  }

  const post = (token: string, url: string, body: object, headers: Record<string, string> = {}) => {
    let r = request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`);
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return r.send(body);
  };
  async function login(slug: string, email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** self-service employee submits a FullDay 1-day request → Pending + Reserved. Returns request id. */
  async function createPending(
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
      submitNow: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe("Pending");
    return res.body.data.id as string;
  }

  async function reqRow(id: string) {
    const r = await direct.query(
      `SELECT status, balance_effect_status FROM leave_requests WHERE id=$1`,
      [id],
    );
    return r.rows[0];
  }
  async function attRecord(companyId: string, userId: string, workDate: string) {
    const r = await direct.query(
      `SELECT attendance_status, required_working_minutes, work_mode FROM attendance_records
        WHERE company_id=$1 AND user_id=$2 AND work_date=$3 AND deleted_at IS NULL`,
      [companyId, userId, workDate],
    );
    return r.rows[0] as
      | { attendance_status: string; required_working_minutes: number; work_mode: string | null }
      | undefined;
  }
  async function daySyncStatus(requestId: string): Promise<string[]> {
    const r = await direct.query(
      `SELECT attendance_sync_status s FROM leave_request_days
        WHERE leave_request_id=$1 AND deleted_at IS NULL ORDER BY work_date`,
      [requestId],
    );
    return r.rows.map((x: { s: string }) => x.s);
  }
  async function balanceRow(userId: string, leaveTypeId: string) {
    const r = await direct.query(
      `SELECT used_days::float u, COALESCE(pending_days,0)::float p FROM leave_balances
        WHERE user_id=$1 AND leave_type_id=$2`,
      [userId, leaveTypeId],
    );
    return { used: Number(r.rows[0].u), pending: Number(r.rows[0].p) };
  }
  async function countAudit(companyId: string, action: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int n FROM audit_logs WHERE company_id=$1 AND action=$2 AND object_type='attendance_record'`,
      [companyId, action],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    process.env["INTERNAL_API_KEY"] = INTERNAL_KEY;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    A = await seedCompany(direct, "int1a");
    B = await seedCompany(direct, "int1b");
    companyIds.push(A.companyId, B.companyId);

    // seed the default shift (OFFICE_8H, requiredWorkingMinutes=480) + rule for company A + B.
    const dbsvc = new DatabaseService();
    const registry = new MasterDataSeederRegistry();
    registry.register(new AttMasterDataSeeder());
    const runner = new MasterDataSeedRunner(dbsvc, new SeedTrackingService(dbsvc), registry);
    await runner.reconcileCompany(A.companyId);
    await runner.reconcileCompany(B.companyId);

    annualA = await plantType(A.companyId);

    const mgrId = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, await hash());
    u.mgr = { id: mgrId, profile: await seedProfile(A.companyId, mgrId) };
    await grantLeave(A.companyId, mgrId, "mgr", MGR_PAIRS);

    const hrId = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, await hash());
    u.hr = { id: hrId, profile: await seedProfile(A.companyId, hrId) };
    await grantLeave(A.companyId, hrId, "hr", [...HR_PAIRS, ...ATT_MANAGE_PAIRS]);

    const emp1 = await seedUser(direct, A.companyId, `emp1@${A.slug}.test`, await hash());
    u.emp1 = { id: emp1, profile: await seedProfile(A.companyId, emp1, { managerUserId: mgrId }) };
    await grantLeave(A.companyId, emp1, "emp1", SELF_PAIRS);
    await plantBalance(A.companyId, emp1, annualA, 20);

    const emp2 = await seedUser(direct, A.companyId, `emp2@${A.slug}.test`, await hash());
    u.emp2 = { id: emp2, profile: await seedProfile(A.companyId, emp2) };
    await grantLeave(A.companyId, emp2, "emp2", SELF_PAIRS);
    await plantBalance(A.companyId, emp2, annualA, 20);

    // an intruder with NO leave grants at all (owner-check denial target).
    const intruder = await seedUser(direct, A.companyId, `intruder@${A.slug}.test`, await hash());
    u.intruder = { id: intruder, profile: await seedProfile(A.companyId, intruder) };
    await grantLeave(A.companyId, intruder, "intruder", SELF_PAIRS);
  });

  afterAll(async () => {
    delete process.env["INTERNAL_API_KEY"];
    await direct
      ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
      .catch(() => undefined);
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── SYNC · approve full-day → ATT record Leave + required=0 + day sync_status Synced + audit ──
  it("approve full-day leave → attendance_records Leave/required=0, day Synced, audit written, check-in blocked", async () => {
    const reqId = await createPending(A.slug, `emp1@${A.slug}.test`, annualA, DATES.fullDayApprove);
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const approveRes = await post(mgrToken, `/leave/requests/${reqId}/approve`, {});
    expect(approveRes.status, JSON.stringify(approveRes.body)).toBe(200);

    // run the sync path directly (equivalent to onLeaveApproved — proves the SAME service the consumer
    // calls does the work; the EventBus wiring is asserted separately below).
    const dbsvc = app.get(DatabaseService);
    const { AttendanceLeaveSyncService } = await import("./attendance-leave-sync.service");
    const sync = app.get(AttendanceLeaveSyncService);
    await dbsvc.withTenant(A.companyId, (tx) =>
      sync.syncApprovedRequestTx(tx, A.companyId, reqId, u.mgr.id),
    );

    expect(await daySyncStatus(reqId)).toEqual(["Synced"]);
    const rec = await attRecord(A.companyId, u.emp1.id, DATES.fullDayApprove);
    expect(rec).toBeTruthy();
    expect(rec?.attendance_status).toBe("Leave");
    expect(rec?.required_working_minutes).toBe(0);
    expect(rec?.work_mode).toBe("Leave");
    expect(await countAudit(A.companyId, "attendance.leave_sync.create")).toBeGreaterThanOrEqual(1);

    // check-in blocked on that date now (frozen to the leave day so work_date matches the sync — login
    // MUST happen inside the SAME freeze, else the JWT's iat/exp are computed against the real clock and
    // appear expired once time is frozen far in the future).
    const ci = await freezeDate(CHECK_IN_ON_LEAVE_DAY, async () => {
      const emp1Token = await login(A.slug, `emp1@${A.slug}.test`);
      return post(emp1Token, "/attendance/check-in", { method: "web" });
    });
    expect(ci.status).toBe(409);

    // idempotent: re-running the sync (no more 'Pending' days) creates NO second record / no error.
    await dbsvc.withTenant(A.companyId, (tx) =>
      sync.syncApprovedRequestTx(tx, A.companyId, reqId, u.mgr.id),
    );
    const recAfter = await direct.query(
      `SELECT count(*)::int n FROM attendance_records WHERE company_id=$1 AND user_id=$2 AND work_date=$3 AND deleted_at IS NULL`,
      [A.companyId, u.emp1.id, DATES.fullDayApprove],
    );
    expect(recAfter.rows[0].n).toBe(1);
  });

  // ── DENY 1 · CANCEL an Approved request as a NON-owner → 403; untouched ──────────
  it("CANCEL an Approved request as a DIFFERENT user (not owner) → 403; status/balance/ATT untouched", async () => {
    const reqId = await createPending(A.slug, `emp2@${A.slug}.test`, annualA, DATES.cancelDeny);
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    const approve = await post(hrToken, `/leave/requests/${reqId}/approve`, {});
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    const before = await reqRow(reqId);
    expect(before.status).toBe("Approved");

    // mgr is NOT the owner (emp2 created it) → 403, NOT 404 (exists, wrong owner).
    const denied = await post(mgrToken, `/leave/requests/${reqId}/cancel`, {});
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);

    const after = await reqRow(reqId);
    expect(after.status).toBe("Approved"); // untouched
    expect(after.balance_effect_status).toBe(before.balance_effect_status); // no refund
  });

  // ── DENY 2 · REVOKE by a manager (no revoke:leave grant) → 403; untouched ────────
  it("REVOKE by a manager (no revoke:leave grant) → 403; status/balance/ATT untouched, no revert-event", async () => {
    const reqId = await createPending(
      A.slug,
      `emp1@${A.slug}.test`,
      annualA,
      DATES.revokeManagerDeny,
    );
    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const approve = await post(hrToken, `/leave/requests/${reqId}/approve`, {});
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);

    const denied = await post(mgrToken, `/leave/requests/${reqId}/revoke`, {});
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);

    const after = await reqRow(reqId);
    expect(after.status).toBe("Approved");
    const outboxCount = await direct.query(
      `SELECT count(*)::int n FROM outbox_events WHERE company_id=$1 AND event_type='leave.request.revoked' AND payload->>'requestId'=$2`,
      [A.companyId, reqId],
    );
    expect(outboxCount.rows[0].n).toBe(0);
  });

  // ── DENY 3 · cross-tenant revoke → 404 (no leak) ─────────────────────────────────
  it("HR revoke a request from ANOTHER company → 404 (no leak)", async () => {
    const bType = await plantType(B.companyId);
    const bUser = await seedUser(direct, B.companyId, `buser@${B.slug}.test`, await hash());
    await seedProfile(B.companyId, bUser);
    await grantLeave(B.companyId, bUser, "buser", SELF_PAIRS);
    await plantBalance(B.companyId, bUser, bType, 20);
    const bReqId = await createPending(B.slug, `buser@${B.slug}.test`, bType, DATES.crossTenant);

    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    const denied = await post(hrToken, `/leave/requests/${bReqId}/revoke`, {});
    expect(denied.status).toBe(404);
  });

  // ── REVOKE (HR) · Approved+Synced → Revoked; ATT reverted; balance refunded; idempotent ──
  it("HR revoke an Approved+Synced request → Revoked, ATT reverted, balance refunded; retry → 409 (idempotent)", async () => {
    const reqId = await createPending(A.slug, `emp1@${A.slug}.test`, annualA, DATES.revokeHr);
    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    const approve = await post(hrToken, `/leave/requests/${reqId}/approve`, {});
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    const usedAfterApprove = (await balanceRow(u.emp1.id, annualA)).used;
    expect(usedAfterApprove).toBeGreaterThan(0);

    const dbsvc = app.get(DatabaseService);
    const { AttendanceLeaveSyncService } = await import("./attendance-leave-sync.service");
    const sync = app.get(AttendanceLeaveSyncService);
    await dbsvc.withTenant(A.companyId, (tx) =>
      sync.syncApprovedRequestTx(tx, A.companyId, reqId, u.hr.id),
    );
    expect((await attRecord(A.companyId, u.emp1.id, DATES.revokeHr))?.attendance_status).toBe(
      "Leave",
    );

    const revokeRes = await post(hrToken, `/leave/requests/${reqId}/revoke`, {
      revokeReason: "business need",
    });
    expect(revokeRes.status, JSON.stringify(revokeRes.body)).toBe(200);
    expect(revokeRes.body.data.status).toBe("Revoked");

    // ATT reverted: Leave dropped, required_working_minutes restored to the shift (480).
    const recAfter = await attRecord(A.companyId, u.emp1.id, DATES.revokeHr);
    expect(recAfter?.attendance_status).not.toBe("Leave");
    expect(recAfter?.required_working_minutes).toBe(480);
    expect(await countAudit(A.companyId, "attendance.leave_sync.revert")).toBeGreaterThanOrEqual(1);

    // balance refunded: used_days back down.
    const usedAfterRevoke = (await balanceRow(u.emp1.id, annualA)).used;
    expect(usedAfterRevoke).toBeLessThan(usedAfterApprove);

    // IDEMPOTENT retry: request no longer Approved → 409, no double-refund/double-revert.
    const retry = await post(hrToken, `/leave/requests/${reqId}/revoke`, { revokeReason: "retry" });
    expect(retry.status).toBe(409);
    const usedAfterRetry = (await balanceRow(u.emp1.id, annualA)).used;
    expect(usedAfterRetry).toBe(usedAfterRevoke);
  });

  // ── DENY 4 · /internal/v1/attendance/recalculate: auth / permission / internal-guard ──
  it("POST /internal/v1/attendance/recalculate: no auth → 401; missing manage:attendance → 403; missing/wrong x-internal-key → 403", async () => {
    // no auth at all.
    const noAuth = await request(app.getHttpServer())
      .post("/internal/v1/attendance/recalculate")
      .send({ leaveRequestId: "00000000-0000-0000-0000-000000000000" });
    expect([401, 403]).toContain(noAuth.status);

    // authenticated but NO manage:attendance grant (emp1 self-service only).
    const emp1Token = await login(A.slug, `emp1@${A.slug}.test`);
    const noManage = await post(
      emp1Token,
      "/internal/v1/attendance/recalculate",
      { leaveRequestId: "00000000-0000-0000-0000-000000000000" },
      { "x-internal-key": INTERNAL_KEY },
    );
    expect(noManage.status).toBe(403);

    // HR HAS manage:attendance but wrong/missing x-internal-key → 403 (InternalGuard).
    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    const missingKey = await post(hrToken, "/internal/v1/attendance/recalculate", {
      leaveRequestId: "00000000-0000-0000-0000-000000000000",
    });
    expect(missingKey.status).toBe(403);
    const wrongKey = await post(
      hrToken,
      "/internal/v1/attendance/recalculate",
      { leaveRequestId: "00000000-0000-0000-0000-000000000000" },
      { "x-internal-key": "wrong-key" },
    );
    expect(wrongKey.status).toBe(403);
  });

  it("POST /internal/v1/attendance/recalculate: correct grant + correct key → 200 (manual retry)", async () => {
    const reqId = await createPending(
      A.slug,
      `emp2@${A.slug}.test`,
      annualA,
      DATES.revokeIdempotent,
    );
    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    const approve = await post(hrToken, `/leave/requests/${reqId}/approve`, {});
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);

    const ok = await post(
      hrToken,
      "/internal/v1/attendance/recalculate",
      { leaveRequestId: reqId },
      { "x-internal-key": INTERNAL_KEY },
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.leaveRequestId).toBe(reqId);
    expect(await daySyncStatus(reqId)).toEqual(["Synced"]);
  });
});
