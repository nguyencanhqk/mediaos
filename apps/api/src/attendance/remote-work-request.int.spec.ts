/**
 * S3-ATT-BE-5 — Integration (Postgres THẬT, DB CÔ LẬP). Remote/onsite-work request workflow over the REAL
 * HTTP path (JwtAuthGuard → CompanyGuard → PermissionGuard → RemoteWorkRequestController → service →
 * DataScopeService + RLS withTenant). KHÔNG mock permission — proves what a unit cannot: engine-pair gates
 * (create-own, view-own/team/company, approve, reject, cancel-own on :remote-request), scope FILTER +
 * 403-vs-404, the Draft→Pending→Approved/Rejected/Cancelled FSM, cross-tenant approver/watcher deny,
 * calc-affect UPSERT-BY idempotency, and the append-only approvals ledger.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env → hasDb=true ⇒ đỏ-giả trên DB
 * dev chung; chỉ chạy trên DB cô lập lane. Colocated src/attendance → vitest include src/**\/*.spec.ts.
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

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, resource: string, scope: Scope];

describe.skipIf(!runDb)("S3-ATT-BE-5 remote-work-request workflow (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let empUser = "";
  let mgrUser = "";
  let hrUser = "";
  let otherUser = "";
  let empProfile = "";
  let otherProfile = "";
  let bUser = "";

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

  async function grant(
    companyId: string,
    userId: string,
    label: string,
    pairs: Pair[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `rr-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of pairs) {
      const sensitive = action !== "create-own" && action !== "cancel-own";
      const permId = await seedPermissionCatalog(direct, action, resource, sensitive);
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

  const authGet = (t: string, u: string) =>
    request(app.getHttpServer()).get(u).set("Authorization", `Bearer ${t}`);
  const authPost = (t: string, u: string) =>
    request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "attbe5a");
    B = await seedCompany(direct, "attbe5b");
    companyIds.push(A.companyId, B.companyId);

    const ouEng = await seedOrgUnit(A.companyId, "Engineering");
    const ouSales = await seedOrgUnit(A.companyId, "Sales");

    mgrUser = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
    empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
    hrUser = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
    otherUser = await seedUser(direct, A.companyId, `other@${A.slug}.test`, hash);

    await seedEmp(A.companyId, mgrUser, ouEng, null);
    empProfile = await seedEmp(A.companyId, empUser, ouEng, mgrUser); // report of mgr
    await seedEmp(A.companyId, hrUser, ouEng, null);
    otherProfile = await seedEmp(A.companyId, otherUser, ouSales, null); // NOT managed by mgr

    await grant(A.companyId, empUser, "emp", [
      ["create-own", "remote-request", "Own"],
      ["view-own", "remote-request", "Own"],
      ["cancel-own", "remote-request", "Own"],
    ]);
    await grant(A.companyId, otherUser, "other", [
      ["create-own", "remote-request", "Own"],
      ["view-own", "remote-request", "Own"],
      ["cancel-own", "remote-request", "Own"],
    ]);
    await grant(A.companyId, mgrUser, "mgr", [
      // create-own lets the manager file their OWN request — used to prove the self-approval hard-rule.
      ["create-own", "remote-request", "Own"],
      ["view-own", "remote-request", "Own"],
      ["cancel-own", "remote-request", "Own"],
      ["view-team", "remote-request", "Team"],
      ["approve", "remote-request", "Team"],
      ["reject", "remote-request", "Team"],
    ]);
    await grant(A.companyId, hrUser, "hr", [
      ["view-own", "remote-request", "Own"],
      ["view-company", "remote-request", "Company"],
      ["approve", "remote-request", "Company"],
      ["reject", "remote-request", "Company"],
    ]);

    // Tenant B — cross-tenant approver/watcher probe.
    bUser = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
    await seedEmp(B.companyId, bUser, null, null);
    await grant(B.companyId, bUser, "badmin", [
      ["view-own", "remote-request", "Own"],
      ["view-company", "remote-request", "Company"],
      ["approve", "remote-request", "Company"],
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

  function createBody(over: Record<string, unknown> = {}) {
    return {
      requestType: "Remote",
      startDate: "2024-09-02",
      endDate: "2024-09-02",
      attendanceMode: "SELF_CHECK_IN",
      reason: "Làm việc tại nhà",
      ...over,
    };
  }

  async function createAs(token: string, over: Record<string, unknown> = {}) {
    return authPost(token, "/attendance/remote-work-requests").send(createBody(over));
  }

  // ── 1 · create own → Draft (KHÔNG Pending) ─────────────────────────────────────
  it("employee creates own request → Draft (not Pending), employee_id resolved server-side", async () => {
    const token = await login(A.slug, `emp@${A.slug}.test`);
    const res = await createAs(token, { startDate: "2024-09-02", endDate: "2024-09-02" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe("Draft");
    expect(res.body.data.employeeId).toBe(empProfile);
    expect(res.body.data.requestedBy).toBe(empUser);
    expect(res.body.data.watcherUserIds).toEqual([]);
  });

  // ── 2 · create-thay without capability → 403 (deny-path RED) ───────────────────
  it("employee creating on behalf of another employee (only Own scope) → 403", async () => {
    const token = await login(A.slug, `emp@${A.slug}.test`);
    const res = await createAs(token, {
      targetEmployeeId: otherProfile,
      startDate: "2024-09-03",
      endDate: "2024-09-03",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  // ── 3 · submit → Draft→Pending, approver + watchers persisted ──────────────────
  it("owner submits Draft → Pending, currentApproverUserId + watcherUserIds persisted", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, { startDate: "2024-09-04", endDate: "2024-09-04" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;

    const res = await authPost(empToken, `/attendance/remote-work-requests/${id}/submit`).send({
      currentApproverUserId: mgrUser,
      watcherUserIds: [hrUser],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("Pending");
    expect(res.body.data.currentApproverUserId).toBe(mgrUser);
    expect(res.body.data.watcherUserIds).toEqual([hrUser]);
    expect(res.body.data.submittedAt).toBeTruthy();
  });

  // ── 4 · submit hộ người khác → chặn (deny-path RED: lockOwnedTx 404, no existence leak) ──
  it("submitting someone else's Draft request → 404 (not owned by actor)", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, { startDate: "2024-09-05", endDate: "2024-09-05" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const otherToken = await login(A.slug, `other@${A.slug}.test`);
    const res = await authPost(otherToken, `/attendance/remote-work-requests/${id}/submit`).send({
      currentApproverUserId: mgrUser,
      watcherUserIds: [],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  // ── 5 · submit khi ≠ Draft (already Pending) → 409 (deny-path RED) ─────────────
  it("submitting an already-Pending request → 409", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, { startDate: "2024-09-06", endDate: "2024-09-06" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const first = await authPost(empToken, `/attendance/remote-work-requests/${id}/submit`).send({
      currentApproverUserId: mgrUser,
      watcherUserIds: [],
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    const second = await authPost(empToken, `/attendance/remote-work-requests/${id}/submit`).send({
      currentApproverUserId: mgrUser,
      watcherUserIds: [],
    });
    expect(second.status).toBe(409);
  });

  // ── 6 · cross-tenant approver/watcher at submit → 403 (deny-path RED) ──────────
  it("submit with a cross-tenant currentApproverUserId → 403", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, { startDate: "2024-09-07", endDate: "2024-09-07" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const res = await authPost(empToken, `/attendance/remote-work-requests/${id}/submit`).send({
      currentApproverUserId: bUser,
      watcherUserIds: [],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("submit with a cross-tenant watcherUserIds entry → 403", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, { startDate: "2024-09-08", endDate: "2024-09-08" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const res = await authPost(empToken, `/attendance/remote-work-requests/${id}/submit`).send({
      currentApproverUserId: mgrUser,
      watcherUserIds: [bUser],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  // ── 7 · approve when ≠ Pending (still Draft) → 409 (deny-path RED) ─────────────
  it("approving a request that is still Draft (never submitted) → 409", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, { startDate: "2024-09-09", endDate: "2024-09-09" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await authPost(mgrToken, `/attendance/remote-work-requests/${id}/approve`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(409);
  });

  // ── 8 · approve out of scope (manager on non-report) → 403 (deny-path RED) ─────
  it("manager approving a NON-report's Pending request (out of team scope) → 403", async () => {
    const otherToken = await login(A.slug, `other@${A.slug}.test`);
    const created = await createAs(otherToken, { startDate: "2024-09-10", endDate: "2024-09-10" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const submit = await authPost(otherToken, `/attendance/remote-work-requests/${id}/submit`).send(
      {
        currentApproverUserId: hrUser,
        watcherUserIds: [],
      },
    );
    expect(submit.status, JSON.stringify(submit.body)).toBe(200);

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await authPost(mgrToken, `/attendance/remote-work-requests/${id}/approve`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  // ── 9 · cross-tenant approve → 404 (RLS FORCE, no existence leak, deny-path RED) ──
  it("tenant B approver approving a tenant A request → 404", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, { startDate: "2024-09-11", endDate: "2024-09-11" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const submit = await authPost(empToken, `/attendance/remote-work-requests/${id}/submit`).send({
      currentApproverUserId: mgrUser,
      watcherUserIds: [],
    });
    expect(submit.status).toBe(200);

    const bToken = await login(B.slug, `admin@${B.slug}.test`);
    const res = await authPost(bToken, `/attendance/remote-work-requests/${id}/approve`).send({});
    expect(res.status).toBe(404);
  });

  // ── 10 · SELF-APPROVAL hard-rule → 403 ──────────────────────────────────────────
  it("the creator may NOT self-APPROVE their own request → 403 ATT-ERR-SELF-APPROVAL", async () => {
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const created = await createAs(mgrToken, { startDate: "2024-09-12", endDate: "2024-09-12" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    const submit = await authPost(mgrToken, `/attendance/remote-work-requests/${id}/submit`).send({
      currentApproverUserId: mgrUser,
      watcherUserIds: [],
    });
    expect(submit.status).toBe(200);

    const res = await authPost(mgrToken, `/attendance/remote-work-requests/${id}/approve`).send({
      note: "self",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain("ATT-ERR-SELF-APPROVAL");
  });

  // ── 11 · approve happy path → Approved + calc-affect record + audit + approval ledger ──
  it("manager approves report's Pending SELF_CHECK_IN request → Approved, attendance_records upserted (Remote Work)", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, {
      startDate: "2024-09-13",
      endDate: "2024-09-14",
      attendanceMode: "SELF_CHECK_IN",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    const submit = await authPost(empToken, `/attendance/remote-work-requests/${id}/submit`).send({
      currentApproverUserId: mgrUser,
      watcherUserIds: [hrUser],
    });
    expect(submit.status).toBe(200);

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await authPost(mgrToken, `/attendance/remote-work-requests/${id}/approve`).send({
      note: "ok",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("Approved");

    const rows = await direct.query(
      `SELECT work_date, attendance_status, work_mode, remote_work_request_id
       FROM attendance_records WHERE company_id=$1 AND employee_id=$2 AND remote_work_request_id=$3
       ORDER BY work_date`,
      [A.companyId, empProfile, id],
    );
    expect(rows.rows.length).toBe(2);
    for (const r of rows.rows) {
      expect(r.attendance_status).toBe("Remote Work");
      expect(r.work_mode).toBe("Remote");
    }

    // audit + approval ledger + outbox.
    const audit = await direct.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE object_type='remote_work_request' AND object_id=$1 AND action='RemoteWorkRequestApproved'",
      [id],
    );
    expect(audit.rows[0].n).toBe(1);
    const approvals = await direct.query(
      "SELECT action FROM remote_work_request_approvals WHERE remote_work_request_id=$1 ORDER BY step_order",
      [id],
    );
    expect(approvals.rows.map((r: { action: string }) => r.action)).toEqual([
      "Submitted",
      "Approved",
    ]);
  });

  // ── 12 · re-approve is a no-op FSM conflict, calc-affect stays IDEMPOTENT (no dup rows) ──
  it("approving an already-Approved request → 409, no duplicate attendance_records row", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, {
      startDate: "2024-09-15",
      endDate: "2024-09-15",
      attendanceMode: "AUTO_ATTENDANCE",
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const submit = await authPost(empToken, `/attendance/remote-work-requests/${id}/submit`).send({
      currentApproverUserId: mgrUser,
      watcherUserIds: [],
    });
    expect(submit.status).toBe(200);

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const first = await authPost(mgrToken, `/attendance/remote-work-requests/${id}/approve`).send(
      {},
    );
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    const before = await direct.query(
      "SELECT count(*)::int AS n FROM attendance_records WHERE company_id=$1 AND employee_id=$2 AND work_date='2024-09-15'",
      [A.companyId, empProfile],
    );
    expect(before.rows[0].n).toBe(1);

    const second = await authPost(mgrToken, `/attendance/remote-work-requests/${id}/approve`).send(
      {},
    );
    expect(second.status).toBe(409);

    const after = await direct.query(
      "SELECT count(*)::int AS n FROM attendance_records WHERE company_id=$1 AND employee_id=$2 AND work_date='2024-09-15'",
      [A.companyId, empProfile],
    );
    expect(after.rows[0].n).toBe(1); // still exactly one row — IDEMPOTENT upsert, no dup
  });

  // ── 13 · NO_ATTENDANCE mode → Approved but NO attendance_records row written ───
  it("Approved NO_ATTENDANCE request → status Approved, no attendance_records row generated", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, {
      startDate: "2024-09-16",
      endDate: "2024-09-16",
      attendanceMode: "NO_ATTENDANCE",
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const submit = await authPost(empToken, `/attendance/remote-work-requests/${id}/submit`).send({
      currentApproverUserId: mgrUser,
      watcherUserIds: [],
    });
    expect(submit.status).toBe(200);

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await authPost(mgrToken, `/attendance/remote-work-requests/${id}/approve`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("Approved");

    const rows = await direct.query(
      "SELECT count(*)::int AS n FROM attendance_records WHERE company_id=$1 AND employee_id=$2 AND work_date='2024-09-16'",
      [A.companyId, empProfile],
    );
    expect(rows.rows[0].n).toBe(0);
  });

  // ── 14 · reject requires rejectReason (400) then Pending→Rejected ──────────────
  it("reject without rejectReason → 400; with reason → Rejected", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, { startDate: "2024-09-17", endDate: "2024-09-17" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const submit = await authPost(empToken, `/attendance/remote-work-requests/${id}/submit`).send({
      currentApproverUserId: mgrUser,
      watcherUserIds: [],
    });
    expect(submit.status).toBe(200);

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const missing = await authPost(mgrToken, `/attendance/remote-work-requests/${id}/reject`).send(
      {},
    );
    expect(missing.status).toBe(400);

    const ok = await authPost(mgrToken, `/attendance/remote-work-requests/${id}/reject`).send({
      rejectReason: "Không hợp lệ",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.status).toBe("Rejected");
    expect(ok.body.data.rejectReason).toBe("Không hợp lệ");
  });

  // ── 15 · reject when ≠ Pending (still Draft) → 409 (deny-path RED) ─────────────
  it("rejecting a Draft (never submitted) request → 409", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, { startDate: "2024-09-18", endDate: "2024-09-18" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await authPost(mgrToken, `/attendance/remote-work-requests/${id}/reject`).send({
      rejectReason: "x",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
  });

  // ── 16 · cancel-own from Draft → Cancelled ──────────────────────────────────────
  it("owner cancels a Draft request → Cancelled", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, { startDate: "2024-09-19", endDate: "2024-09-19" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const res = await authPost(empToken, `/attendance/remote-work-requests/${id}/cancel`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("Cancelled");
  });

  // ── 17 · cancel someone else's request → 404 (deny-path RED) ───────────────────
  it("cancelling someone else's request → 404 (not owned by actor)", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, { startDate: "2024-09-20", endDate: "2024-09-20" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const otherToken = await login(A.slug, `other@${A.slug}.test`);
    const res = await authPost(otherToken, `/attendance/remote-work-requests/${id}/cancel`).send(
      {},
    );
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  // ── 18 · cancel when ≠ Draft/Pending (Approved) → 409 (deny-path RED) ──────────
  it("cancelling an Approved request → 409", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, {
      startDate: "2024-09-21",
      endDate: "2024-09-21",
      attendanceMode: "NO_ATTENDANCE",
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const submit = await authPost(empToken, `/attendance/remote-work-requests/${id}/submit`).send({
      currentApproverUserId: mgrUser,
      watcherUserIds: [],
    });
    expect(submit.status).toBe(200);
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const approve = await authPost(mgrToken, `/attendance/remote-work-requests/${id}/approve`).send(
      {},
    );
    expect(approve.status).toBe(200);

    const res = await authPost(empToken, `/attendance/remote-work-requests/${id}/cancel`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(409);
  });

  // ── 19 · list scoping: my (own only), team (report not other), company (403 for emp) ──
  it("list scoping: /my own-only · manager /team includes report excludes non-report · emp /company 403", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const my = await authGet(empToken, "/attendance/remote-work-requests/my?pageSize=50");
    expect(my.status).toBe(200);
    expect((my.body.data.items as Array<{ employeeId?: string }>).length).toBeGreaterThan(0);

    const noCompany = await authGet(empToken, "/attendance/remote-work-requests");
    expect(noCompany.status).toBe(403);

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const team = await authGet(mgrToken, "/attendance/remote-work-requests/team?pageSize=100");
    expect(team.status, JSON.stringify(team.body)).toBe(200);
    const emps = new Set(
      (team.body.data.items as Array<{ employeeId: string }>).map((r) => r.employeeId),
    );
    expect(emps.has(empProfile)).toBe(true);
    expect(emps.has(otherProfile)).toBe(false);

    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    const company = await authGet(hrToken, "/attendance/remote-work-requests?pageSize=100");
    expect(company.status).toBe(200);
    const companyEmps = new Set(
      (company.body.data.items as Array<{ employeeId: string }>).map((r) => r.employeeId),
    );
    expect(companyEmps.has(empProfile)).toBe(true);
    expect(companyEmps.has(otherProfile)).toBe(true);
  });

  // ── 20 · GET /:id detail out of scope → 404; cross-tenant → 404 same shape ─────
  it("GET /:id detail out of scope (manager viewing a non-report's request) → 404 (no existence leak)", async () => {
    const otherToken = await login(A.slug, `other@${A.slug}.test`);
    const created = await createAs(otherToken, { startDate: "2024-09-22", endDate: "2024-09-22" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await authGet(mgrToken, `/attendance/remote-work-requests/${id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  it("GET /:id detail cross-tenant (company B viewing company A's request) → 404", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, { startDate: "2024-09-23", endDate: "2024-09-23" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const bToken = await login(B.slug, `admin@${B.slug}.test`);
    const res = await authGet(bToken, `/attendance/remote-work-requests/${id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  // ── 21 · migration smoke: audit CHECK accepts 'remote_work_request' (0464) ─────
  it("audit_logs INSERT with object_type='remote_work_request' does not violate the CHECK (mig 0464)", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, { startDate: "2024-09-24", endDate: "2024-09-24" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const audit = await direct.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE object_type='remote_work_request' AND action='RemoteWorkRequestCreated'",
      [],
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
  });
});
