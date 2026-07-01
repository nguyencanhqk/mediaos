/**
 * S3-LEAVE-BE-3 — Integration (Postgres THẬT, DB CÔ LẬP). LEAVE APPROVAL WORKFLOW over the REAL HTTP path
 * (JwtAuthGuard → CompanyGuard → PermissionGuard → LeaveController → LeaveApprovalService → RLS withTenant +
 * append-only ledger/history). KHÔNG mock permission. Proves:
 *
 *   DENY (RED-first):
 *     · employee (no view/approve grant) → 403 on GET /requests + approve/reject
 *     · manager approve/view a request OUTSIDE their Team (owner not a report) → 403; HR (Company) → OK
 *     · cross-tenant approve/reject (đơn công ty khác) → 404 (RLS, no existence leak)
 *     · self-approval (approver === requester) → 422 LEAVE-ERR-APPROVER-INVALID
 *     · reject with empty reason → 400/422; NO release, NO REJECTED event
 *   STATE-MACHINE: approve/reject a non-Pending request → 409
 *   CONCURRENCY: 2 parallel approves on one request → exactly 1×200 + 1×409; used_days deducted ONCE
 *   BALANCE-LEDGER: approve → RELEASE+USE rows + pending↓/used↑ ; reject → RELEASE + pending↓ (used flat)
 *     · append-only DENY: app-role UPDATE/DELETE on leave_balance_transactions + leave_request_approvals
 *   EVENT/AUDIT: approve → LEAVE_REQUEST_APPROVED + day-rows sync_status=Pending + LeaveApproved audit ;
 *                reject → LEAVE_REQUEST_REJECTED + LeaveRejected audit (all in-tx)
 *   SCOPED LIST: GET /requests?status=Pending → HR sees company-wide, manager sees Team only
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated src/leave → vitest include.
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
import { appPool, directPool, hasDb } from "../../test/helpers/integration-db";
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

// Self-service pairs (create + submit + read-own) so a user can produce a Pending+Reserved request.
const SELF_PAIRS: LeavePair[] = [
  ["create", "leave", "Own"],
  ["submit", "leave", "Own"],
  ["view-own", "leave", "Own"],
  ["view-own", "leave-balance", "Own"],
  ["view", "leave-type", "Company"],
];
// Approver pairs — HR@Company, Manager@Team (view/reject sensitive=true in the real catalog).
const HR_PAIRS: LeavePair[] = [
  ["view", "leave", "Company", true],
  ["approve", "leave", "Company", false],
  ["reject", "leave", "Company", true],
];
const MGR_PAIRS: LeavePair[] = [
  ["view", "leave", "Team", true],
  ["approve", "leave", "Team", false],
  ["reject", "leave", "Team", true],
];

// Working weekdays (2027-03; Mar 1 = Monday) → FullDay single-day request = 1 day.
const DATES = {
  hrApprove: "2027-03-01",
  hrReject: "2027-03-02",
  mgrAllow: "2027-03-03",
  mgrDeny: "2027-03-04",
  selfApprove: "2027-03-05",
  nonPending: "2027-03-08",
  concurrency: "2027-03-09",
  missingReason: "2027-03-10",
  noview: "2027-03-11",
  ledger: "2027-03-12",
  listHr: "2027-03-15",
  listMgr: "2027-03-16",
  deptFilter: "2027-03-17",
  deptFilterScope: "2027-03-18",
} as const;

describe.skipIf(!runDb)("S3-LEAVE-BE-3 approval workflow (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let annualA = "";
  let annualB = "";

  const u: Record<string, { id: string; profile: string }> = {};
  let bReqId = ""; // a Pending request in tenant B (cross-tenant target)

  let _hash = "";
  async function hash(): Promise<string> {
    if (!_hash) _hash = await new PasswordService().hash(LOGIN_PW);
    return _hash;
  }

  async function seedProfile(
    companyId: string,
    userId: string,
    opts: { managerUserId?: string; orgUnitId?: string } = {},
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, direct_manager_id, org_unit_id, employee_code)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [
        companyId,
        userId,
        opts.managerUserId ?? null,
        opts.orgUnitId ?? null,
        `E-${userId.slice(0, 8)}`,
      ],
    );
    return r.rows[0].id as string;
  }

  async function grantLeave(
    companyId: string,
    userId: string,
    label: string,
    pairs: LeavePair[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `lv3-${label}-${userId.slice(0, 8)}`);
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
      [companyId, `LT-${randomUUID().slice(0, 8)}`, "Annual"],
    );
    return r.rows[0].id as string;
  }

  async function plantOrgUnit(companyId: string, name: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id`,
      [companyId, name],
    );
    return r.rows[0].id as string;
  }

  /** Seed a full self-service employee (user + role grants + profile + balance) inside an org unit. */
  async function seedSelfEmployee(
    companyId: string,
    slug: string,
    email: string,
    leaveTypeId: string,
    opts: { orgUnitId?: string; managerUserId?: string } = {},
  ): Promise<string> {
    const userId = await seedUser(direct, companyId, email, await hash());
    await seedProfile(companyId, userId, opts);
    await grantLeave(companyId, userId, `self-${userId.slice(0, 8)}`, SELF_PAIRS);
    await plantBalance(companyId, userId, leaveTypeId, 20);
    return userId;
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
    expect(res.body.data.balanceEffectStatus).toBe("Reserved");
    return res.body.data.id as string;
  }

  async function reqRow(id: string) {
    const r = await direct.query(
      `SELECT user_id, status, balance_effect_status, approved_by, rejected_by, rejection_reason
         FROM leave_requests WHERE id=$1`,
      [id],
    );
    return r.rows[0];
  }
  async function balanceCols(balanceId: string): Promise<{ used: number; pending: number }> {
    const r = await direct.query(
      `SELECT used_days::float u, COALESCE(pending_days,0)::float p FROM leave_balances WHERE id=$1`,
      [balanceId],
    );
    return { used: Number(r.rows[0].u), pending: Number(r.rows[0].p) };
  }
  async function countTx(requestId: string, type?: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int n FROM leave_balance_transactions
        WHERE leave_request_id=$1 ${type ? "AND transaction_type=$2" : ""}`,
      type ? [requestId, type] : [requestId],
    );
    return r.rows[0].n as number;
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
  async function dayRowSyncStatuses(requestId: string): Promise<string[]> {
    const r = await direct.query(
      `SELECT attendance_sync_status s FROM leave_request_days
        WHERE leave_request_id=$1 AND deleted_at IS NULL AND status='Active' ORDER BY work_date`,
      [requestId],
    );
    return r.rows.map((x: { s: string }) => x.s);
  }
  async function balIdOf(userId: string, leaveTypeId: string): Promise<string> {
    const r = await direct.query(
      `SELECT id FROM leave_balances WHERE user_id=$1 AND leave_type_id=$2`,
      [userId, leaveTypeId],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    A = await seedCompany(direct, "lvbe3a");
    B = await seedCompany(direct, "lvbe3b");
    companyIds.push(A.companyId, B.companyId);

    annualA = await plantType(A.companyId);

    // Manager (Team scope) — no manager above them.
    const mgrId = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, await hash());
    u.mgr = { id: mgrId, profile: await seedProfile(A.companyId, mgrId) };
    await grantLeave(A.companyId, mgrId, "mgr", MGR_PAIRS);

    // HR (Company scope) — also self-service + balance for the self-approval case.
    const hrId = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, await hash());
    u.hr = { id: hrId, profile: await seedProfile(A.companyId, hrId) };
    await grantLeave(A.companyId, hrId, "hr", [...HR_PAIRS, ...SELF_PAIRS]);
    await plantBalance(A.companyId, hrId, annualA, 20);

    // emp1 — reports to mgr (direct_manager_id = mgr.userId) → inside mgr's Team.
    const emp1 = await seedUser(direct, A.companyId, `emp1@${A.slug}.test`, await hash());
    u.emp1 = { id: emp1, profile: await seedProfile(A.companyId, emp1, { managerUserId: mgrId }) };
    await grantLeave(A.companyId, emp1, "emp1", SELF_PAIRS);
    await plantBalance(A.companyId, emp1, annualA, 20);

    // emp2 — NO manager link → OUTSIDE mgr's Team (but inside HR's Company).
    const emp2 = await seedUser(direct, A.companyId, `emp2@${A.slug}.test`, await hash());
    u.emp2 = { id: emp2, profile: await seedProfile(A.companyId, emp2) };
    await grantLeave(A.companyId, emp2, "emp2", SELF_PAIRS);
    await plantBalance(A.companyId, emp2, annualA, 20);

    // noview — a profile with NO approver grant (deny gate).
    const noview = await seedUser(direct, A.companyId, `noview@${A.slug}.test`, await hash());
    u.noview = { id: noview, profile: await seedProfile(A.companyId, noview) };

    // Tenant B — a Pending request (cross-tenant approve/reject target).
    annualB = await plantType(B.companyId);
    const bUser = await seedUser(direct, B.companyId, `buser@${B.slug}.test`, await hash());
    await seedProfile(B.companyId, bUser);
    await grantLeave(B.companyId, bUser, "buser", SELF_PAIRS);
    await plantBalance(B.companyId, bUser, annualB, 20);
    bReqId = await createPending(B.slug, `buser@${B.slug}.test`, annualB, "2027-03-01");
  });

  afterAll(async () => {
    await direct
      ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
      .catch(() => undefined);
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── DENY 1 · employee without approver grant → 403 (view + approve + reject) ──
  it("employee (no view/approve/reject grant) → 403 on GET /requests + approve + reject", async () => {
    const noviewToken = await login(A.slug, `noview@${A.slug}.test`);
    const reqId = await createPending(A.slug, `emp1@${A.slug}.test`, annualA, DATES.noview);
    expect((await get(noviewToken, "/leave/requests?status=Pending")).status).toBe(403);
    expect((await post(noviewToken, `/leave/requests/${reqId}/approve`, {})).status).toBe(403);
    expect(
      (await post(noviewToken, `/leave/requests/${reqId}/reject`, { reason: "no" })).status,
    ).toBe(403);
    // self-service emp1 also lacks view:leave → 403 on the management list.
    const emp1Token = await login(A.slug, `emp1@${A.slug}.test`);
    expect((await get(emp1Token, "/leave/requests?status=Pending")).status).toBe(403);
  });

  // ── DENY 2 · manager approve OUTSIDE Team → 403; HR (Company) approves same → OK ─
  it("manager approve a non-report's request → 403 LEAVE-ERR-OUT-OF-SCOPE; HR Company → 200", async () => {
    const reqId = await createPending(A.slug, `emp2@${A.slug}.test`, annualA, DATES.mgrDeny);
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const denied = await post(mgrToken, `/leave/requests/${reqId}/approve`, {});
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    expect(denied.body.error.code).toBe("LEAVE-ERR-OUT-OF-SCOPE");
    // still Pending — scope-check ran BEFORE any mutation.
    expect((await reqRow(reqId)).status).toBe("Pending");

    // HR (Company scope) approves the very same request → OK.
    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    const ok = await post(hrToken, `/leave/requests/${reqId}/approve`, {});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.status).toBe("Approved");
  });

  // ── DENY 3 · manager approve INSIDE Team (direct report) → OK ─────────────────
  it("manager approve a direct-report's request (Team scope) → 200 Approved", async () => {
    const reqId = await createPending(A.slug, `emp1@${A.slug}.test`, annualA, DATES.mgrAllow);
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const ok = await post(mgrToken, `/leave/requests/${reqId}/approve`, {});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.status).toBe("Approved");
    expect((await reqRow(reqId)).approved_by).toBe(u.mgr.id);
  });

  // ── DENY 4 · cross-tenant approve/reject → 404 (RLS, no existence leak) ────────
  it("HR approve/reject a request from ANOTHER company → 404 (no leak)", async () => {
    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    expect((await post(hrToken, `/leave/requests/${bReqId}/approve`, {})).status).toBe(404);
    expect((await post(hrToken, `/leave/requests/${bReqId}/reject`, { reason: "x" })).status).toBe(
      404,
    );
    // B's request untouched.
    expect((await reqRow(bReqId)).status).toBe("Pending");
  });

  // ── DENY 5 · self-approval → 422 LEAVE-ERR-APPROVER-INVALID (crown, blocked at service) ─
  it("requester approves/rejects their OWN request → 422 LEAVE-ERR-APPROVER-INVALID", async () => {
    // HR holds approve/reject:leave AND created this request → self-approval must be blocked.
    const reqId = await createPending(A.slug, `hr@${A.slug}.test`, annualA, DATES.selfApprove);
    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    const selfApprove = await post(hrToken, `/leave/requests/${reqId}/approve`, {});
    expect(selfApprove.status, JSON.stringify(selfApprove.body)).toBe(422);
    expect(selfApprove.body.error.code).toBe("LEAVE-ERR-APPROVER-INVALID");
    const selfReject = await post(hrToken, `/leave/requests/${reqId}/reject`, { reason: "x" });
    expect(selfReject.status).toBe(422);
    expect(selfReject.body.error.code).toBe("LEAVE-ERR-APPROVER-INVALID");
    // untouched — still Pending, no ledger movement.
    expect((await reqRow(reqId)).status).toBe("Pending");
    expect(await countTx(reqId, "USE")).toBe(0);
  });

  // ── DENY 6 · reject without reason → 400/422; no release, no REJECTED event ────
  it("reject with empty reason → 400/422; request stays Pending, no RELEASE, no REJECTED event", async () => {
    const reqId = await createPending(A.slug, `emp2@${A.slug}.test`, annualA, DATES.missingReason);
    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    const noReason = await post(hrToken, `/leave/requests/${reqId}/reject`, {});
    expect([400, 422]).toContain(noReason.status);
    const emptyReason = await post(hrToken, `/leave/requests/${reqId}/reject`, { reason: "" });
    expect([400, 422]).toContain(emptyReason.status);
    expect((await reqRow(reqId)).status).toBe("Pending");
    expect(await countTx(reqId, "RELEASE")).toBe(0);
    expect(await countOutbox(A.companyId, "leave.request.rejected", reqId)).toBe(0);
  });

  // ── STATE-MACHINE · approve/reject a non-Pending request → 409 ────────────────
  it("approve then approve again (already Approved) → 409; reject an Approved → 409", async () => {
    const reqId = await createPending(A.slug, `emp1@${A.slug}.test`, annualA, DATES.nonPending);
    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    expect((await post(hrToken, `/leave/requests/${reqId}/approve`, {})).status).toBe(200);
    const again = await post(hrToken, `/leave/requests/${reqId}/approve`, {});
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(again.body.error.code).toBe("LEAVE-ERR-INVALID-STATE");
    const rejectApproved = await post(hrToken, `/leave/requests/${reqId}/reject`, { reason: "x" });
    expect(rejectApproved.status).toBe(409);
  });

  // ── CONCURRENCY · 2 parallel approves → exactly 1×200 + 1×409; used deducted ONCE ─
  it("two concurrent approves of one request → 1 success + 1 conflict; used_days +1 only", async () => {
    const reqId = await createPending(A.slug, `emp1@${A.slug}.test`, annualA, DATES.concurrency);
    const balId = await balIdOf(u.emp1.id, annualA);
    const before = await balanceCols(balId);
    const hrToken = await login(A.slug, `hr@${A.slug}.test`);

    const [r1, r2] = await Promise.all([
      post(hrToken, `/leave/requests/${reqId}/approve`, {}),
      post(hrToken, `/leave/requests/${reqId}/approve`, {}),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses, `${r1.status}/${r2.status}`).toEqual([200, 409]);

    const after = await balanceCols(balId);
    expect(after.used).toBe(before.used + 1); // deducted exactly once
    expect(after.pending).toBe(before.pending - 1); // reservation released exactly once
    expect(await countTx(reqId, "USE")).toBe(1); // one USE ledger row, not two
  });

  // ── BALANCE-LEDGER · approve → RELEASE+USE + pending↓/used↑ + sync=Pending + events ─
  it("approve happy: RELEASE+USE ledger, pending↓ used↑, day-rows sync=Pending, APPROVED event + audit", async () => {
    const reqId = await createPending(A.slug, `emp1@${A.slug}.test`, annualA, DATES.ledger);
    const balId = await balIdOf(u.emp1.id, annualA);
    const before = await balanceCols(balId);
    const hrToken = await login(A.slug, `hr@${A.slug}.test`);

    const ok = await post(hrToken, `/leave/requests/${reqId}/approve`, { note: "approved by HR" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.status).toBe("Approved");
    expect(ok.body.data.balanceEffectStatus).toBe("Used");

    const after = await balanceCols(balId);
    expect(after.used).toBe(before.used + 1);
    expect(after.pending).toBe(before.pending - 1);
    expect(await countTx(reqId, "USE")).toBe(1);
    expect(await countTx(reqId, "RELEASE")).toBe(1);
    expect(await countApprovals(reqId, "APPROVE")).toBe(1);
    // ATT-sync handoff (S3-INT-1): every working day-row flagged Pending.
    expect(await dayRowSyncStatuses(reqId)).toEqual(["Pending"]);
    // event + audit written in the SAME tx.
    expect(await countOutbox(A.companyId, "leave.request.approved", reqId)).toBe(1);
    expect(await countAudit(A.companyId, "LeaveApproved", reqId)).toBe(1);
  });

  // ── BALANCE-LEDGER · reject → RELEASE only, used flat, no sync, REJECTED event ─
  it("reject happy: RELEASE only (pending↓, used flat), no sync mark, REJECTED event + audit", async () => {
    const reqId = await createPending(A.slug, `emp2@${A.slug}.test`, annualA, DATES.hrReject);
    const balId = await balIdOf(u.emp2.id, annualA);
    const before = await balanceCols(balId);
    const hrToken = await login(A.slug, `hr@${A.slug}.test`);

    const ok = await post(hrToken, `/leave/requests/${reqId}/reject`, {
      reason: "trùng lịch dự án",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.status).toBe("Rejected");
    expect(ok.body.data.balanceEffectStatus).toBe("Released");

    const after = await balanceCols(balId);
    expect(after.used).toBe(before.used); // used NEVER changes on reject
    expect(after.pending).toBe(before.pending - 1); // reservation released
    expect(await countTx(reqId, "RELEASE")).toBe(1);
    expect(await countTx(reqId, "USE")).toBe(0);
    expect(await countApprovals(reqId, "REJECT")).toBe(1);
    // reject NEVER flags day-rows for ATT sync + NEVER emits APPROVED.
    expect(await dayRowSyncStatuses(reqId)).toEqual(["Not Required"]);
    expect(await countOutbox(A.companyId, "leave.request.approved", reqId)).toBe(0);
    expect(await countOutbox(A.companyId, "leave.request.rejected", reqId)).toBe(1);
    expect(await countAudit(A.companyId, "LeaveRejected", reqId)).toBe(1);
    const row = await reqRow(reqId);
    expect(row.rejected_by).toBe(u.hr.id);
    expect(row.rejection_reason).toBe("trùng lịch dự án");
  });

  // ── APPEND-ONLY · app-role UPDATE/DELETE ledger + history → DENIED (BẤT BIẾN #2) ─
  it("app-role UPDATE/DELETE leave_balance_transactions + leave_request_approvals → DENIED", async () => {
    const pool = appPool();
    try {
      await expect(
        pool.query("UPDATE leave_balance_transactions SET amount_days = 0"),
      ).rejects.toThrow();
      await expect(pool.query("DELETE FROM leave_balance_transactions")).rejects.toThrow();
      await expect(
        pool.query("UPDATE leave_request_approvals SET action = 'COMMENT'"),
      ).rejects.toThrow();
      await expect(pool.query("DELETE FROM leave_request_approvals")).rejects.toThrow();
    } finally {
      await pool.end();
    }
  });

  // ── SCOPED LIST · HR sees company-wide Pending; manager sees Team only ─────────
  it("GET /requests?status=Pending — HR sees emp1+emp2; manager sees emp1 (report) NOT emp2", async () => {
    const r1 = await createPending(A.slug, `emp1@${A.slug}.test`, annualA, DATES.listMgr);
    const r2 = await createPending(A.slug, `emp2@${A.slug}.test`, annualA, DATES.listHr);

    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    const hrList = await get(hrToken, "/leave/requests?status=Pending&pageSize=100");
    expect(hrList.status, JSON.stringify(hrList.body)).toBe(200);
    const hrIds = (hrList.body.data.items as Array<{ id: string }>).map((x) => x.id);
    expect(hrIds).toContain(r1);
    expect(hrIds).toContain(r2);

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const mgrList = await get(mgrToken, "/leave/requests?status=Pending&pageSize=100");
    expect(mgrList.status, JSON.stringify(mgrList.body)).toBe(200);
    const mgrIds = (mgrList.body.data.items as Array<{ id: string }>).map((x) => x.id);
    expect(mgrIds).toContain(r1); // direct report
    expect(mgrIds).not.toContain(r2); // outside Team
    // requester enrichment present.
    const r1Item = (
      mgrList.body.data.items as Array<{ id: string; requester: { userId: string } }>
    ).find((x) => x.id === r1);
    expect(r1Item?.requester.userId).toBe(u.emp1.id);
  });

  // ── DEPT FILTER · departmentId narrows the scoped list server-side (list+count agree) ──
  it("GET /requests?departmentId= — HR sees only that department's requests; count matches", async () => {
    const deptX = await plantOrgUnit(A.companyId, `Dept-X-${randomUUID().slice(0, 6)}`);
    const deptY = await plantOrgUnit(A.companyId, `Dept-Y-${randomUUID().slice(0, 6)}`);
    await seedSelfEmployee(A.companyId, A.slug, `dx@${A.slug}.test`, annualA, { orgUnitId: deptX });
    await seedSelfEmployee(A.companyId, A.slug, `dy@${A.slug}.test`, annualA, { orgUnitId: deptY });
    const reqX = await createPending(A.slug, `dx@${A.slug}.test`, annualA, DATES.deptFilter);
    const reqY = await createPending(A.slug, `dy@${A.slug}.test`, annualA, DATES.deptFilter);

    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    const filtered = await get(
      hrToken,
      `/leave/requests?status=Pending&pageSize=100&departmentId=${deptX}`,
    );
    expect(filtered.status, JSON.stringify(filtered.body)).toBe(200);
    const ids = (filtered.body.data.items as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain(reqX);
    expect(ids).not.toContain(reqY);
    // total (from countPendingScopedTx) must reflect the same filter as the page — every item is in deptX.
    expect(filtered.body.data.meta.total).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(1);
  });

  // ── DEPT FILTER is SCOPE-SAFE · a manager can't widen past their Team via departmentId ──
  it("manager filtering by a department with NON-report owners → still sees nothing (scope wins)", async () => {
    const deptZ = await plantOrgUnit(A.companyId, `Dept-Z-${randomUUID().slice(0, 6)}`);
    // employee in deptZ, NOT a report of mgr → outside mgr's Team.
    await seedSelfEmployee(A.companyId, A.slug, `dz@${A.slug}.test`, annualA, { orgUnitId: deptZ });
    const reqZ = await createPending(A.slug, `dz@${A.slug}.test`, annualA, DATES.deptFilterScope);

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await get(
      mgrToken,
      `/leave/requests?status=Pending&pageSize=100&departmentId=${deptZ}`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = (res.body.data.items as Array<{ id: string }>).map((x) => x.id);
    // departmentId ANDs AFTER scopeCond → the filter can only NARROW, never widen past Team.
    expect(ids).not.toContain(reqZ);
  });
});
