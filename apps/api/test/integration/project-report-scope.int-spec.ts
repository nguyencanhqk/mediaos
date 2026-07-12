/**
 * S4-TASK-BE-5 (L3) — GET /projects/:id/report (SPEC-06 §16.1, TASK-API) integration (Postgres THẬT,
 * DB CÔ LẬP). Đường THẬT: JwtAuthGuard → CompanyGuard → PermissionGuard → ProjectsController →
 * ProjectsService → DataScopeService + RLS withTenant. KHÔNG mock permission. Phủ:
 *   1. DENY-PATH (permission): employee KHÔNG có view-report:project → 403 (PermissionGuard tại route).
 *   2. IDOR/cross-tenant/scope: project của tenant B → 404 (RLS 0-row, không lộ); project không tồn tại
 *      → 404; manager @Team xin project NGOÀI team (member ngoài scope) → 404 (không lộ tồn tại).
 *   3. SỐ LIỆU ĐÚNG: countsByStatus (5 cột, NULL gộp Todo) + overdueCount (due_at<now & status∉Done/
 *      Cancelled) + assigneeWorkload (task active theo main_assignee_employee_id, desc) khớp fixture.
 *   4. LIMIT top-N workload tôn trọng (TASK_PROJECT_REPORT_WORKLOAD_LIMIT).
 *   5. Envelope API-01 ({success,data,error}); manager @Team thấy project team (200).
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate): .env trỏ DB dev chung ⇒ hasDb=true
 * nhưng migration band lệch ⇒ đỏ-giả. CHỈ chạy trên DB cô lập lane (scripts/lane-db-setup.sh <lane> +
 * export LANE_DB=mediaos_<lane>). KHÔNG dùng biểu thức ngược !hasDb && LANE_DB (false-green).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TASK_PROJECT_REPORT_WORKLOAD_LIMIT } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = "Passw0rd!lane5rep";

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, resourceType: string, scope: Scope, isSensitive?: boolean];

interface WorkloadRow {
  employeeId: string;
  employeeName: string | null;
  activeCount: number;
}

describe.skipIf(!hasLaneDb)("S4-TASK-BE-5 GET /projects/:id/report (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let appConn: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let adminUser = "";
  let mgrUser = "";
  let empUser = "";
  let adminEmp = "";
  let mgrEmp = "";
  let empEmp = "";
  let bAdmin = "";

  let reportProject = ""; // in-scope cho admin @Company VÀ mgr @Team (empEmp là report của mgr, là member)
  let adminOnlyProject = ""; // member chỉ adminEmp → mgr @Team KHÔNG thấy → 404
  let limitProject = ""; // > LIMIT assignees để nghiệm LIMIT top-N
  let bProject = ""; // tenant B → cross-tenant 404

  const tok: Record<string, string> = {};

  async function seedOrgUnit(companyId: string, name: string): Promise<string> {
    const r = await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
      [companyId, name],
    );
    return r.rows[0].id as string;
  }

  async function seedEmp(
    companyId: string,
    userId: string | null,
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

  async function seedProject(companyId: string, name: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO projects (company_id, name, status, project_status) VALUES ($1,$2,'active','Active') RETURNING id`,
      [companyId, name],
    );
    return r.rows[0].id as string;
  }

  async function addMember(
    companyId: string,
    projectId: string,
    userId: string,
    employeeId: string,
  ): Promise<void> {
    await direct.query(
      `INSERT INTO project_members (company_id, project_id, user_id, employee_id, project_role, member_status, status)
       VALUES ($1,$2,$3,$4,'Member','Active','active')`,
      [companyId, projectId, userId, employeeId],
    );
  }

  async function mkTask(opts: {
    companyId?: string;
    projectId: string;
    taskStatus?: string | null;
    mainAssigneeEmployeeId?: string | null;
    dueAt?: string | null;
  }): Promise<string> {
    const r = await direct.query(
      `INSERT INTO tasks (company_id, task_type, title, task_status, main_assignee_employee_id, project_id, due_at, creator_user_id)
       VALUES ($1,'office',$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        opts.companyId ?? A.companyId,
        "T",
        opts.taskStatus ?? "Todo",
        opts.mainAssigneeEmployeeId ?? null,
        opts.projectId,
        opts.dueAt ?? null,
        adminUser,
      ],
    );
    return r.rows[0].id as string;
  }

  async function grant(companyId: string, userId: string, pairs: Pair[]): Promise<void> {
    const roleId = await seedRole(direct, companyId, `rep5-${userId.slice(0, 8)}`);
    for (const [action, resourceType, scope, isSensitive] of pairs) {
      const permId = await seedPermissionCatalog(
        direct,
        action,
        resourceType,
        isSensitive ?? false,
      );
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

  const PAST = new Date(Date.now() - 86_400_000).toISOString();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    appConn = appPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "rep5a");
    B = await seedCompany(direct, "rep5b");
    companyIds.push(A.companyId, B.companyId);

    const ouEng = await seedOrgUnit(A.companyId, "Engineering");

    adminUser = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
    mgrUser = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
    empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
    adminEmp = await seedEmp(A.companyId, adminUser, ouEng, null);
    mgrEmp = await seedEmp(A.companyId, mgrUser, ouEng, null);
    empEmp = await seedEmp(A.companyId, empUser, ouEng, mgrUser); // report của mgr → mgr @Team thấy

    // Grants theo intent 0485: view-report SENSITIVE. employee KHÔNG có view-report (chỉ read).
    await grant(A.companyId, adminUser, [["view-report", "project", "Company", true]]);
    await grant(A.companyId, mgrUser, [["view-report", "project", "Team", true]]);
    await grant(A.companyId, empUser, [["read", "project", "Company"]]);

    // reportProject: member = adminEmp + empEmp ⇒ admin @Company thấy, mgr @Team thấy (empEmp là report).
    reportProject = await seedProject(A.companyId, "Report Project");
    await addMember(A.companyId, reportProject, adminUser, adminEmp);
    await addMember(A.companyId, reportProject, empUser, empEmp);

    // Fixture số liệu (8 task): Todo×3, In Progress×1, In Review×1, Done×2, Cancelled×1; overdue = 1.
    await mkTask({ projectId: reportProject, taskStatus: "Todo", mainAssigneeEmployeeId: empEmp });
    await mkTask({ projectId: reportProject, taskStatus: "Todo", mainAssigneeEmployeeId: mgrEmp });
    await mkTask({
      projectId: reportProject,
      taskStatus: "In Progress",
      mainAssigneeEmployeeId: empEmp,
    });
    await mkTask({
      projectId: reportProject,
      taskStatus: "In Review",
      mainAssigneeEmployeeId: mgrEmp,
    });
    await mkTask({
      projectId: reportProject,
      taskStatus: "Done",
      mainAssigneeEmployeeId: adminEmp,
    });
    await mkTask({
      projectId: reportProject,
      taskStatus: "Cancelled",
      mainAssigneeEmployeeId: adminEmp,
    });
    // overdue Todo (due_at quá khứ, status active) → đếm overdue.
    await mkTask({
      projectId: reportProject,
      taskStatus: "Todo",
      mainAssigneeEmployeeId: empEmp,
      dueAt: PAST,
    });
    // Done nhưng due_at quá khứ → KHÔNG đếm overdue (status Done).
    await mkTask({
      projectId: reportProject,
      taskStatus: "Done",
      mainAssigneeEmployeeId: adminEmp,
      dueAt: PAST,
    });

    // adminOnlyProject: member chỉ adminEmp ⇒ mgr @Team ngoài scope → 404.
    adminOnlyProject = await seedProject(A.companyId, "Admin Only Project");
    await addMember(A.companyId, adminOnlyProject, adminUser, adminEmp);
    await mkTask({
      projectId: adminOnlyProject,
      taskStatus: "Todo",
      mainAssigneeEmployeeId: adminEmp,
    });

    // limitProject: > LIMIT assignees (mỗi assignee 1 task active) ⇒ nghiệm LIMIT top-N.
    limitProject = await seedProject(A.companyId, "Limit Project");
    const overflow = TASK_PROJECT_REPORT_WORKLOAD_LIMIT + 2;
    for (let i = 0; i < overflow; i++) {
      const e = await seedEmp(A.companyId, null, ouEng, null);
      await mkTask({ projectId: limitProject, taskStatus: "Todo", mainAssigneeEmployeeId: e });
    }

    // Tenant B cross-tenant.
    bAdmin = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
    await seedEmp(B.companyId, bAdmin, null, null);
    await grant(B.companyId, bAdmin, [["view-report", "project", "Company", true]]);
    bProject = await seedProject(B.companyId, "B Project");

    tok.admin = await login(A.slug, `admin@${A.slug}.test`);
    tok.mgr = await login(A.slug, `mgr@${A.slug}.test`);
    tok.emp = await login(A.slug, `emp@${A.slug}.test`);
    tok.bAdmin = await login(B.slug, `admin@${B.slug}.test`);
  });

  afterAll(async () => {
    if (direct && companyIds.length) {
      for (const tbl of ["tasks", "project_members", "projects", "employee_profiles"]) {
        await direct
          .query(`DELETE FROM ${tbl} WHERE company_id = ANY($1::uuid[])`, [companyIds])
          .catch(() => undefined);
      }
      await cleanupTenants(direct, companyIds);
    }
    await appConn?.end();
    await direct?.end();
    await app?.close();
  });

  // ── 1. Deny-path (permission) ──────────────────────────────────────────────────

  it("employee KHÔNG có view-report:project → 403 (PermissionGuard tại route)", async () => {
    const res = await authGet(tok.emp, `/projects/${reportProject}/report`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  // ── 2. IDOR / cross-tenant / scope ───────────────────────────────────────────

  it("cross-tenant (project tenant B) → 404; project không tồn tại → 404 (không lộ)", async () => {
    expect((await authGet(tok.admin, `/projects/${bProject}/report`)).status).toBe(404);
    expect(
      (await authGet(tok.admin, `/projects/00000000-0000-0000-0000-000000000000/report`)).status,
    ).toBe(404);
  });

  it("manager @Team xin project NGOÀI team (adminOnlyProject) → 404 (không lộ tồn tại)", async () => {
    expect((await authGet(tok.mgr, `/projects/${adminOnlyProject}/report`)).status).toBe(404);
  });

  // ── 3. Số liệu đúng ──────────────────────────────────────────────────────────

  it("admin @Company: countsByStatus + overdueCount + assigneeWorkload khớp fixture (envelope API-01)", async () => {
    const res = await authGet(tok.admin, `/projects/${reportProject}/report`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.projectId).toBe(reportProject);
    expect(data.countsByStatus).toEqual({
      Todo: 3,
      "In Progress": 1,
      "In Review": 1,
      Done: 2,
      Cancelled: 1,
    });
    expect(data.overdueCount).toBe(1);

    const workload = data.assigneeWorkload as WorkloadRow[];
    // active (∉ Done/Cancelled): empEmp = 3 (2 Todo + 1 In Progress), mgrEmp = 2 (Todo + In Review).
    // adminEmp chỉ có Done/Cancelled ⇒ KHÔNG xuất hiện.
    expect(workload.map((w) => w.employeeId)).not.toContain(adminEmp);
    const emp = workload.find((w) => w.employeeId === empEmp);
    const mgr = workload.find((w) => w.employeeId === mgrEmp);
    expect(emp?.activeCount).toBe(3);
    expect(mgr?.activeCount).toBe(2);
    // Sắp giảm dần theo activeCount.
    for (let i = 1; i < workload.length; i++) {
      expect(workload[i - 1].activeCount).toBeGreaterThanOrEqual(workload[i].activeCount);
    }
  });

  it("manager @Team thấy project team (empEmp là member) → 200", async () => {
    const res = await authGet(tok.mgr, `/projects/${reportProject}/report`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.projectId).toBe(reportProject);
  });

  // ── 4. Limit top-N ────────────────────────────────────────────────────────────

  it("assigneeWorkload TÔN TRỌNG LIMIT top-N (không trả quá TASK_PROJECT_REPORT_WORKLOAD_LIMIT)", async () => {
    const res = await authGet(tok.admin, `/projects/${limitProject}/report`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const workload = res.body.data.assigneeWorkload as WorkloadRow[];
    expect(workload.length).toBe(TASK_PROJECT_REPORT_WORKLOAD_LIMIT);
  });
});
