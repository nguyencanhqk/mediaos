/**
 * S3-ATT-BE-4 — Integration (Postgres THẬT, DB CÔ LẬP). The canonical adjustment surface over the REAL
 * HTTP path (JwtAuthGuard → CompanyGuard → PermissionGuard → AttendanceAdjustmentController → service →
 * DataScopeService + RLS withTenant). KHÔNG mock permission — proves what a unit cannot: engine-pair gates
 * (create-own, view-own/team/company, approve, reject on :adjustment plus adjust-direct:attendance),
 * scope FILTER + 403-vs-404,
 * the Pending→Approved/Rejected FSM, recalc-KEEPS-logs (append log_type='Adjustment'), and the
 * append-only items ledger (is_applied=true).
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

const WD_APPROVE = "2024-07-01";
const WD_REJECT = "2024-07-02";
const WD_DIRECT = "2024-07-03";
const WD_UNIQUE = "2024-07-04";
const WD_LOCKED = "2024-08-05";

describe.skipIf(!runDb)("S3-ATT-BE-4 adjustment surface (DB cô lập, đường thật)", () => {
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
  let empRecordId = "";

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
    const roleId = await seedRole(direct, companyId, `adj-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of pairs) {
      // permissions is a GLOBAL upsert catalog — seed the SAME is_sensitive as mig 0454 (create-own/
      // cancel-own = false, everything else = true) so we never flip the shared catalog that
      // att-permissions-seed.int.spec asserts on (shared LANE_DB pollution otherwise).
      const sensitive = action !== "create-own" && action !== "cancel-own";
      const permId = await seedPermissionCatalog(direct, action, resource, sensitive);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function plantRecord(
    companyId: string,
    userId: string,
    employeeId: string,
    workDate: string,
  ) {
    const r = await direct.query(
      `INSERT INTO attendance_records
         (company_id, user_id, employee_id, work_date, status, attendance_status,
          check_in_at, late_minutes, early_leave_minutes, working_minutes, required_working_minutes, break_minutes)
       VALUES ($1,$2,$3,$4,'present','Present',$5,0,0,480,480,60) RETURNING id`,
      [companyId, userId, employeeId, workDate, `${workDate}T01:00:00Z`],
    );
    return r.rows[0].id as string;
  }

  async function plantLog(
    companyId: string,
    recordId: string,
    employeeId: string,
    userId: string,
    workDate: string,
  ) {
    await direct.query(
      `INSERT INTO attendance_logs
         (company_id, attendance_record_id, employee_id, user_id, work_date, log_type, source, is_valid)
       VALUES ($1,$2,$3,$4,$5,'Check-in','WEB',true)`,
      [companyId, recordId, employeeId, userId, workDate],
    );
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

  async function countLogs(recordId: string): Promise<number> {
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM attendance_logs WHERE attendance_record_id=$1",
      [recordId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "attbe4a");
    B = await seedCompany(direct, "attbe4b");
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

    empRecordId = await plantRecord(A.companyId, empUser, empProfile, WD_APPROVE);
    await plantLog(A.companyId, empRecordId, empProfile, empUser, WD_APPROVE);
    await plantRecord(A.companyId, empUser, empProfile, WD_DIRECT);

    // Lock 2024-08 so a create/approve for WD_LOCKED is blocked.
    await direct.query(
      "INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,'2024-08','locked')",
      [A.companyId],
    );

    await grant(A.companyId, empUser, "emp", [
      ["create-own", "adjustment", "Own"],
      ["view-own", "adjustment", "Own"],
    ]);
    await grant(A.companyId, otherUser, "other", [
      ["create-own", "adjustment", "Own"],
      ["view-own", "adjustment", "Own"],
    ]);
    await grant(A.companyId, mgrUser, "mgr", [
      ["view-own", "adjustment", "Own"],
      ["view-team", "adjustment", "Team"],
      ["approve", "adjustment", "Team"],
      ["reject", "adjustment", "Team"],
    ]);
    await grant(A.companyId, hrUser, "hr", [
      ["view-own", "adjustment", "Own"],
      ["view-company", "adjustment", "Company"],
      ["approve", "adjustment", "Company"],
      ["adjust-direct", "attendance", "Company"],
    ]);

    // Tenant B — cross-tenant approver.
    const bUser = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
    await seedEmp(B.companyId, bUser, null, null);
    await grant(B.companyId, bUser, "badmin", [
      ["view-company", "adjustment", "Company"],
      ["approve", "adjustment", "Company"],
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

  function createBody(workDate: string, over: Record<string, unknown> = {}) {
    return {
      workDate,
      requestType: "UPDATE_CHECK_IN",
      reason: "Điều chỉnh giờ vào",
      requestedCheckInAt: `${workDate}T02:00:00Z`,
      ...over,
    };
  }

  async function createAs(token: string, workDate: string, over: Record<string, unknown> = {}) {
    return authPost(token, "/attendance/adjustment-requests").send(createBody(workDate, over));
  }

  // ── 1 · create own → Pending + employee_id resolved from actor ─────────────────
  it("employee creates own adjustment → Pending, employee_id resolved server-side", async () => {
    const token = await login(A.slug, `emp@${A.slug}.test`);
    const res = await createAs(token, WD_APPROVE);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe("Pending");
    expect(res.body.data.employeeId).toBe(empProfile);
    expect(res.body.data.requestedBy).toBe(empUser);
  });

  // ── 2 · unique-pending guard → 409 ─────────────────────────────────────────────
  it("a second pending request for the same (employee, date, type) → 409", async () => {
    const token = await login(A.slug, `emp@${A.slug}.test`);
    const first = await createAs(token, WD_UNIQUE);
    expect(first.status).toBe(201);
    const dup = await createAs(token, WD_UNIQUE);
    expect(dup.status, JSON.stringify(dup.body)).toBe(409);
  });

  // ── 3 · create-thay without capability → 403 ───────────────────────────────────
  it("employee creating on behalf of another employee (only Own scope) → 403", async () => {
    const token = await login(A.slug, `emp@${A.slug}.test`);
    const res = await createAs(token, "2024-07-09", { targetEmployeeId: otherProfile });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  // ── 4 · period-locked create → 409 ─────────────────────────────────────────────
  it("create for a locked period (2024-08) → 409", async () => {
    const token = await login(A.slug, `emp@${A.slug}.test`);
    const res = await createAs(token, WD_LOCKED);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
  });

  // ── 5 · manager approve report's request → recalc + logs KEPT + items applied ──
  it("manager approves report's request → record Adjusted, logs appended (kept), items is_applied=true", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    // fresh request for WD_APPROVE already exists from test 1 (Pending). Find it via /my.
    const my = await authGet(empToken, "/attendance/adjustment-requests/my?pageSize=50");
    const pending = (
      my.body.data.items as Array<{ id: string; workDate: string; status: string }>
    ).find((r) => r.workDate === WD_APPROVE && r.status === "Pending");
    expect(pending, "pending WD_APPROVE request").toBeTruthy();

    const before = await countLogs(empRecordId);
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await authPost(
      mgrToken,
      `/attendance/adjustment-requests/${pending!.id}/approve`,
    ).send({
      note: "ok",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("Approved");

    // Record recalculated + marked Adjusted; the ORIGINAL Check-in log kept, one Adjustment appended.
    const rec = await direct.query(
      "SELECT attendance_status, is_adjusted FROM attendance_records WHERE id=$1",
      [empRecordId],
    );
    expect(rec.rows[0].attendance_status).toBe("Adjusted");
    const after = await countLogs(empRecordId);
    expect(after).toBe(before + 1);
    const adj = await direct.query(
      "SELECT count(*)::int AS n FROM attendance_logs WHERE attendance_record_id=$1 AND log_type='Adjustment'",
      [empRecordId],
    );
    expect(adj.rows[0].n).toBeGreaterThanOrEqual(1);
    const kept = await direct.query(
      "SELECT count(*)::int AS n FROM attendance_logs WHERE attendance_record_id=$1 AND log_type='Check-in'",
      [empRecordId],
    );
    expect(kept.rows[0].n).toBe(1);
    // Applied ledger entry present.
    const applied = await direct.query(
      "SELECT count(*)::int AS n FROM attendance_adjustment_items WHERE request_id=$1 AND is_applied=true",
      [pending!.id],
    );
    expect(applied.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  // ── 6 · double-approve → second 409 ────────────────────────────────────────────
  it("approving an already-Approved request → 409", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const my = await authGet(empToken, "/attendance/adjustment-requests/my?pageSize=50");
    const approved = (my.body.data.items as Array<{ id: string; status: string }>).find(
      (r) => r.status === "Approved",
    );
    expect(approved).toBeTruthy();
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await authPost(
      mgrToken,
      `/attendance/adjustment-requests/${approved!.id}/approve`,
    ).send({});
    expect(res.status).toBe(409);
  });

  // ── 7 · reject requires reason (400) then Pending→Rejected ─────────────────────
  it("reject without reason → 400; with reason → Rejected + reviewNote", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, WD_REJECT);
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const missing = await authPost(mgrToken, `/attendance/adjustment-requests/${id}/reject`).send(
      {},
    );
    expect(missing.status).toBe(400);

    const ok = await authPost(mgrToken, `/attendance/adjustment-requests/${id}/reject`).send({
      reason: "Không hợp lệ",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.status).toBe("Rejected");
    expect(ok.body.data.reviewNote).toBe("Không hợp lệ");
  });

  // ── 8 · manager approve out-of-team → 403 ──────────────────────────────────────
  it("manager approving a NON-report's request (out of team scope) → 403", async () => {
    const otherToken = await login(A.slug, `other@${A.slug}.test`);
    const created = await createAs(otherToken, "2024-07-06");
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await authPost(mgrToken, `/attendance/adjustment-requests/${id}/approve`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  // ── 9 · cross-tenant approve → 404 (RLS FORCE, no existence leak) ───────────────
  it("tenant B approver approving a tenant A request → 404", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const created = await createAs(empToken, "2024-07-07");
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const bToken = await login(B.slug, `admin@${B.slug}.test`);
    const res = await authPost(bToken, `/attendance/adjustment-requests/${id}/approve`).send({});
    expect(res.status).toBe(404);
  });

  // ── 10 · adjust-direct → record Adjusted + log appended + items applied ─────────
  it("hr adjust-direct on a record → Adjusted, Adjustment log appended, items is_applied=true", async () => {
    const rec = await direct.query(
      "SELECT id FROM attendance_records WHERE company_id=$1 AND user_id=$2 AND work_date=$3",
      [A.companyId, empUser, WD_DIRECT],
    );
    const recordId = rec.rows[0].id as string;
    const before = await countLogs(recordId);

    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    const res = await authPost(hrToken, `/attendance/records/${recordId}/adjust-direct`).send({
      recordId,
      reason: "Sửa trực tiếp",
      items: [{ fieldName: "lateMinutes", newValue: 0 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("Approved");

    const after = await countLogs(recordId);
    expect(after).toBe(before + 1);
    const marked = await direct.query(
      "SELECT attendance_status FROM attendance_records WHERE id=$1",
      [recordId],
    );
    expect(marked.rows[0].attendance_status).toBe("Adjusted");
  });

  // ── 11 · adjust-direct without grant → 403 ─────────────────────────────────────
  it("employee attempting adjust-direct (no grant) → 403", async () => {
    const rec = await direct.query(
      "SELECT id FROM attendance_records WHERE company_id=$1 AND user_id=$2 AND work_date=$3",
      [A.companyId, empUser, WD_DIRECT],
    );
    const recordId = rec.rows[0].id as string;
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const res = await authPost(empToken, `/attendance/records/${recordId}/adjust-direct`).send({
      recordId,
      reason: "x",
      items: [{ fieldName: "note", newValue: "hi" }],
    });
    expect(res.status).toBe(403);
  });

  // ── 12 · list scope: my (own only), team (report not other), company (403 for emp) ──
  it("list scoping: /my own-only · manager /team includes report excludes non-report · emp /company 403", async () => {
    const empToken = await login(A.slug, `emp@${A.slug}.test`);
    const my = await authGet(empToken, "/attendance/adjustment-requests/my?pageSize=50");
    expect(my.status).toBe(200);
    expect((my.body.data.items as Array<{ userId?: string }>).length).toBeGreaterThan(0);

    const noCompany = await authGet(empToken, "/attendance/adjustment-requests");
    expect(noCompany.status).toBe(403);

    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    const team = await authGet(mgrToken, "/attendance/adjustment-requests/team?pageSize=100");
    expect(team.status, JSON.stringify(team.body)).toBe(200);
    const emps = new Set(
      (team.body.data.items as Array<{ employeeId: string }>).map((r) => r.employeeId),
    );
    expect(emps.has(empProfile)).toBe(true); // report
    expect(emps.has(otherProfile)).toBe(false); // non-report

    const hrToken = await login(A.slug, `hr@${A.slug}.test`);
    const company = await authGet(hrToken, "/attendance/adjustment-requests?pageSize=100");
    expect(company.status).toBe(200);
    const companyEmps = new Set(
      (company.body.data.items as Array<{ employeeId: string }>).map((r) => r.employeeId),
    );
    expect(companyEmps.has(empProfile)).toBe(true);
    expect(companyEmps.has(otherProfile)).toBe(true);
  });
});
