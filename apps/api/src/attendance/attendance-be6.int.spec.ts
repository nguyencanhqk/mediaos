/**
 * S3-ATT-BE-6 — Integration (Postgres THẬT, DB CÔ LẬP). GET /attendance/reports (Team/Company aggregate)
 * + GET /attendance/audit-logs (ATT's own audit reader, TÁI DÙNG AuditRepository) over the REAL HTTP path
 * (JwtAuthGuard → CompanyGuard → PermissionGuard → AttendanceReport/AuditController → …→ RLS withTenant).
 *
 * deny-path RED (done_when a-g):
 *   (a) /attendance/reports thiếu view-team/view-company:attendance → 403
 *   (b) /attendance/audit-logs thiếu (view,attendance-audit-log) → 403
 *   (c) 2-tenant: tenant B gọi report/audit → 0 row / KHÔNG thấy dữ liệu tenant A
 *   (d) manager scope Team chỉ thấy cây quản lý của mình, KHÔNG thấy team khác cùng công ty (IDOR)
 *   (e) append-only: KHÔNG route UPDATE/DELETE trên /attendance/audit-logs
 *   (f) grant foundation-audit (view,audit-log) KHÔNG mở được /attendance/audit-logs (over-grant test)
 *   (g) 1 dòng audit có field nhạy cảm bị mask khi đọc qua /attendance/audit-logs
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated src/attendance →
 * vitest include src/**\/*.spec.ts.
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

const WD_A = "2024-06-01";
const WD_B = "2024-06-02";

describe.skipIf(!runDb)("S3-ATT-BE-6 reports + ATT audit reader (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let mgrUser = "";
  let empUser = "";
  let otherMgrUser = "";
  let otherEmpUser = "";
  let hrUser = "";
  let noGrantUser = "";
  let fndAuditUser = "";

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

  async function plantRecord(
    companyId: string,
    userId: string,
    workDate: string,
    attendanceStatus: string,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO attendance_records
         (company_id, user_id, work_date, status, attendance_status,
          check_in_at, late_minutes, early_leave_minutes, working_minutes)
       VALUES ($1,$2,$3,'present',$4,$5,0,0,480) RETURNING id`,
      [companyId, userId, workDate, attendanceStatus, `${workDate}T01:00:00Z`],
    );
    return r.rows[0].id as string;
  }

  /** Custom company-scoped role with EXACT ATT (action, scope) pairs (mirror mig 0454). */
  async function grantAtt(
    companyId: string,
    userId: string,
    label: string,
    resourceType: string,
    pairs: Array<[string, Scope]>,
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `att6-${label}-${userId.slice(0, 8)}`);
    for (const [action, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resourceType, true);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function plantAudit(
    companyId: string,
    objectType: string,
    action: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    await direct.query(
      `INSERT INTO audit_logs (company_id, action, object_type, after)
       VALUES ($1,$2,$3,$4::jsonb)`,
      [companyId, action, objectType, JSON.stringify(after)],
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
    A = await seedCompany(direct, "attbe6a");
    B = await seedCompany(direct, "attbe6b");
    companyIds.push(A.companyId, B.companyId);

    const ouEng = await seedOrgUnit(A.companyId, "Engineering");
    const ouSales = await seedOrgUnit(A.companyId, "Sales");

    // ── Tenant A users ──
    mgrUser = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
    empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
    otherMgrUser = await seedUser(direct, A.companyId, `othermgr@${A.slug}.test`, hash);
    otherEmpUser = await seedUser(direct, A.companyId, `otheremp@${A.slug}.test`, hash);
    hrUser = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
    noGrantUser = await seedUser(direct, A.companyId, `nogrant@${A.slug}.test`, hash);
    fndAuditUser = await seedUser(direct, A.companyId, `fndaudit@${A.slug}.test`, hash);

    // ── employee_profiles ──
    await seedEmp(A.companyId, mgrUser, ouEng, null);
    await seedEmp(A.companyId, empUser, ouEng, mgrUser); // report of mgr
    await seedEmp(A.companyId, otherMgrUser, ouSales, null);
    await seedEmp(A.companyId, otherEmpUser, ouSales, otherMgrUser); // report of otherMgr (different team)
    await seedEmp(A.companyId, hrUser, ouEng, null);
    await seedEmp(A.companyId, noGrantUser, ouEng, null);
    await seedEmp(A.companyId, fndAuditUser, ouEng, null);

    // ── attendance_records (tenant A) — present/late buckets across two teams ──
    await plantRecord(A.companyId, mgrUser, WD_A, "Present");
    await plantRecord(A.companyId, empUser, WD_A, "Late");
    await plantRecord(A.companyId, empUser, WD_B, "Present");
    await plantRecord(A.companyId, otherMgrUser, WD_A, "Present");
    await plantRecord(A.companyId, otherEmpUser, WD_A, "Missing Hours");

    // ── ATT grants (mirror mig 0454 per-pair scope) ──
    await grantAtt(A.companyId, mgrUser, "mgr", "attendance", [["view-team", "Team"]]);
    await grantAtt(A.companyId, otherMgrUser, "othermgr", "attendance", [["view-team", "Team"]]);
    await grantAtt(A.companyId, hrUser, "hr", "attendance", [["view-company", "Company"]]);
    await grantAtt(A.companyId, hrUser, "hraudit", "attendance-audit-log", [["view", "Company"]]);
    // over-grant probe: fndAuditUser holds foundation's (view,'audit-log') — a DIFFERENT resource_type —
    // but NOT (view,'attendance-audit-log'). Must NOT open /attendance/audit-logs (case f).
    await grantAtt(A.companyId, fndAuditUser, "fndaudit", "audit-log", [["view", "Company"]]);

    // ── audit rows (tenant A) — ATT object types + a non-ATT one (must be excluded) + a sensitive field ──
    await plantAudit(A.companyId, "attendance_record", "AttendanceAdjustmentApproved", {
      note: "ok",
      secretRef: "sk_live_should_be_masked",
    });
    await plantAudit(A.companyId, "user", "UserUpdated", { fullName: "Should Not Appear" });

    // ── Tenant B (cross-tenant deny) ──
    const bMgrUser = await seedUser(direct, B.companyId, `mgr@${B.slug}.test`, hash);
    await seedEmp(B.companyId, bMgrUser, null, null);
    await plantRecord(B.companyId, bMgrUser, WD_A, "Present");
    await grantAtt(B.companyId, bMgrUser, "bmgr", "attendance", [["view-company", "Company"]]);
    await grantAtt(B.companyId, bMgrUser, "bmgraudit", "attendance-audit-log", [
      ["view", "Company"],
    ]);
    await plantAudit(B.companyId, "attendance_record", "AttendanceAdjustmentApproved", {
      note: "tenant B only",
    });
  });

  afterAll(async () => {
    await direct
      ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
      .catch(() => undefined);
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── (a) reports: no view-team/view-company grant → 403 ─────────────────────────
  it("(a1) /attendance/reports/team without view-team:attendance → 403", async () => {
    const token = await login(A.slug, `nogrant@${A.slug}.test`);
    const res = await get(token, "/attendance/reports/team?fromDate=2024-06-01&toDate=2024-06-30");
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("(a2) /attendance/reports without view-company:attendance → 403", async () => {
    const token = await login(A.slug, `mgr@${A.slug}.test`); // has view-team only
    const res = await get(token, "/attendance/reports?fromDate=2024-06-01&toDate=2024-06-30");
    expect(res.status).toBe(403);
  });

  // ── (b) audit-logs: no (view,attendance-audit-log) grant → 403 ─────────────────
  it("(b) /attendance/audit-logs without (view,attendance-audit-log) → 403", async () => {
    const token = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await get(token, "/attendance/audit-logs");
    expect(res.status).toBe(403);
  });

  // ── (c) 2-tenant: tenant B report/audit never see tenant A rows ────────────────
  it("(c1) tenant B report → 0 rows from tenant A employees", async () => {
    const token = await login(B.slug, `mgr@${B.slug}.test`);
    const res = await get(
      token,
      "/attendance/reports?fromDate=2024-06-01&toDate=2024-06-30&pageSize=100",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.data.items as Array<{ userId: string }>;
    for (const aUser of [mgrUser, empUser, otherMgrUser, otherEmpUser]) {
      expect(items.some((r) => r.userId === aUser)).toBe(false);
    }
  });

  it("(c2) tenant B audit-logs → 0 rows from tenant A", async () => {
    const token = await login(B.slug, `mgr@${B.slug}.test`);
    const res = await get(token, "/attendance/audit-logs?limit=100");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data.data as Array<{ after: unknown }>;
    expect(rows.length).toBe(1); // only the tenant-B-planted row
    expect(JSON.stringify(rows[0].after)).toContain("tenant B only");
  });

  // ── (d) manager Team scope → own team only, NOT another team (IDOR) ────────────
  it("(d) manager /attendance/reports/team → own team only, other team excluded", async () => {
    const token = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await get(
      token,
      "/attendance/reports/team?fromDate=2024-06-01&toDate=2024-06-30&pageSize=100",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const seen = new Set((res.body.data.items as Array<{ userId: string }>).map((r) => r.userId));
    expect(seen.has(mgrUser)).toBe(true); // self
    expect(seen.has(empUser)).toBe(true); // direct report
    expect(seen.has(otherMgrUser)).toBe(false); // different team
    expect(seen.has(otherEmpUser)).toBe(false); // different team
  });

  // ── bucket correctness: mgr's own team report totals ───────────────────────────
  it("manager team report buckets: emp has 1 present + 1 late; mgr has 1 present", async () => {
    const token = await login(A.slug, `mgr@${A.slug}.test`);
    const res = await get(
      token,
      "/attendance/reports/team?fromDate=2024-06-01&toDate=2024-06-30&pageSize=100",
    );
    const items = res.body.data.items as Array<{
      userId: string;
      totalDays: number;
      presentDays: number;
      lateDays: number;
    }>;
    const empRow = items.find((r) => r.userId === empUser)!;
    expect(empRow.totalDays).toBe(2);
    expect(empRow.presentDays).toBe(1);
    expect(empRow.lateDays).toBe(1);
  });

  // ── (e) append-only: no UPDATE/DELETE surface on /attendance/audit-logs ────────
  it("(e) PATCH/DELETE /attendance/audit-logs → 404 (no such route registered)", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);
    const patchRes = await request(app.getHttpServer())
      .patch("/attendance/audit-logs")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(patchRes.status).toBe(404);
    const delRes = await request(app.getHttpServer())
      .delete("/attendance/audit-logs")
      .set("Authorization", `Bearer ${token}`);
    expect(delRes.status).toBe(404);
  });

  // ── (f) over-grant probe: foundation (view,audit-log) does NOT open ATT audit ──
  it("(f) foundation (view,audit-log) grant does NOT open /attendance/audit-logs → 403", async () => {
    const token = await login(A.slug, `fndaudit@${A.slug}.test`);
    const res = await get(token, "/attendance/audit-logs");
    expect(res.status).toBe(403);
  });

  // ── (g) sensitive field masked when read through /attendance/audit-logs ────────
  it("(g) sensitive field (secretRef) in audit.after is masked via /attendance/audit-logs", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);
    const res = await get(token, "/attendance/audit-logs?limit=100");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data.data as Array<{
      objectType: string;
      after: Record<string, unknown>;
    }>;
    const row = rows.find((r) => r.objectType === "attendance_record")!;
    expect(row).toBeDefined();
    expect(row.after.secretRef).toBe("***");
    expect(row.after.note).toBe("ok");
  });

  // ── non-ATT object type excluded from /attendance/audit-logs ───────────────────
  it("non-ATT object_type ('user') is excluded from /attendance/audit-logs", async () => {
    const token = await login(A.slug, `hr@${A.slug}.test`);
    const res = await get(token, "/attendance/audit-logs?limit=100");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data.data as Array<{ objectType: string }>;
    expect(rows.every((r) => r.objectType !== "user")).toBe(true);
    expect(rows.some((r) => r.objectType === "attendance_record")).toBe(true);
  });
});
