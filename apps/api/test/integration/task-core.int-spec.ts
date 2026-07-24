/**
 * S4-TASK-BE-2 — Task core surface integration (Postgres THẬT, DB CÔ LẬP).
 *
 * Đường THẬT: JwtAuthGuard → CompanyGuard → PermissionGuard → TasksController → TaskCoreService →
 * DataScopeService + RLS withTenant. KHÔNG mock permission. Phủ:
 *   - pair-gate seed 0485: read/create/update/delete:task (emp/mgr create HOÃN TASK_DEFERRED_GRANTS → 403);
 *   - DATA-SCOPE ĐỌC trong-tenant: employee @Own (assignee=mình OR member project) · manager @Team (team-tree
 *     + member project) · admin @Company thấy tất; list↔detail parity (ngoài scope → 404);
 *   - cross-tenant → 404 (GET/PATCH/DELETE id tenant khác) — phân biệt out-of-scope 404 vs cross-tenant 404;
 *   - POST assignee resigned/terminated/inactive/deleted/no-account → 400 fail-loud;
 *   - GET /tasks/my: 3 nguồn assigned+created+watched, dedupe theo id, overdue-first;
 *   - DELETE soft-delete (deleted_at/by qua directPool) + biến khỏi list/my;
 *   - task_activity_logs TASK_CREATED/UPDATED/DELETED target_type='Task' + append-only (app-role deny UPDATE/DELETE);
 *   - workflow task PATCH/DELETE → 400 (regression FSM guard).
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate): CHỈ chạy trên DB cô lập lane
 * (scripts/lane-db-setup.sh taskbe2 + export LANE_DB=mediaos_taskbe2). KHÔNG biểu thức ngược (false-green).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
const LOGIN_PW = "Passw0rd!lane4t2";
const SENSITIVE = new Set(["delete", "export", "view"]);

type Pair = [action: string, scope: "Own" | "Team" | "Company"];

describe.skipIf(!hasLaneDb)("S4-TASK-BE-2 task core surface (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let appConn: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  // Tenant A actors
  let adminUser = "";
  let mgrUser = "";
  let empUser = "";
  let hrUser = "";
  let myUser = "";
  let adminEmp = "";
  let mgrEmp = "";
  let empEmp = "";
  let myEmp = "";
  let otherEmp = "";
  // assignee targets
  let addEmp = "";
  let resignedEmp = "";
  let terminatedEmp = "";
  let inactiveEmp = "";
  let noAccountEmp = "";
  let deletedEmp = "";
  // read fixtures (task ids)
  let taskAdmin = "";
  let taskEmp = "";
  let taskMgr = "";
  let taskColleague = "";
  let taskInEmpProject = "";
  let taskInMgrProject = "";
  let workflowTask = "";
  // S5-TASK-DEPTFILTER-1 — org units + task fixtures gắn phòng ban (hoist ra module-scope để test đọc).
  let ouEng = "";
  let ouSales = "";
  let deptTaskEngA = "";
  let deptTaskEngB = "";
  let deptTaskSales = "";
  // my-tasks fixtures
  let myAssigned = "";
  let myCreated = "";
  let myWatched = "";
  let myOverlap = "";
  let myUnrelated = "";
  // Tenant B
  let bTask = "";

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
    status = "active",
    deleted = false,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, direct_manager_id, status, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [companyId, userId, orgUnitId, directManagerUserId, status, deleted ? new Date() : null],
    );
    return r.rows[0].id as string;
  }

  async function seedProject(companyId: string, name: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO projects (company_id, name, status, project_status)
       VALUES ($1,$2,'active','Active') RETURNING id`,
      [companyId, name],
    );
    return r.rows[0].id as string;
  }

  async function seedMember(
    companyId: string,
    projectId: string,
    userId: string,
    employeeId: string,
  ): Promise<void> {
    await direct.query(
      `INSERT INTO project_members (company_id, project_id, user_id, employee_id, member_status)
       VALUES ($1,$2,$3,$4,'Active')`,
      [companyId, projectId, userId, employeeId],
    );
  }

  async function seedTask(opts: {
    companyId: string;
    title?: string;
    taskType?: string;
    taskStatus?: string;
    mainAssigneeEmployeeId?: string | null;
    assigneeUserId?: string | null;
    creatorUserId?: string | null;
    projectId?: string | null;
    departmentId?: string | null;
    dueAt?: string | null;
  }): Promise<string> {
    const r = await direct.query(
      `INSERT INTO tasks
         (company_id, task_type, title, task_status, main_assignee_employee_id, assignee_user_id,
          creator_user_id, project_id, department_id, due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        opts.companyId,
        opts.taskType ?? "office",
        opts.title ?? "T",
        opts.taskStatus ?? "Todo",
        opts.mainAssigneeEmployeeId ?? null,
        opts.assigneeUserId ?? null,
        opts.creatorUserId ?? null,
        opts.projectId ?? null,
        opts.departmentId ?? null,
        opts.dueAt ?? null,
      ],
    );
    return r.rows[0].id as string;
  }

  async function seedWatcher(companyId: string, taskId: string, employeeId: string): Promise<void> {
    await direct.query(
      `INSERT INTO task_watchers (company_id, task_id, employee_id, status)
       VALUES ($1,$2,$3,'Active')`,
      [companyId, taskId, employeeId],
    );
  }

  async function grantTask(companyId: string, userId: string, pairs: Pair[]): Promise<void> {
    const roleId = await seedRole(direct, companyId, `t2-${userId.slice(0, 8)}`);
    for (const [action, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, "task", SENSITIVE.has(action));
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
  const authPatch = (t: string, u: string) =>
    request(app.getHttpServer()).patch(u).set("Authorization", `Bearer ${t}`);
  const authDelete = (t: string, u: string) =>
    request(app.getHttpServer()).delete(u).set("Authorization", `Bearer ${t}`);

  async function listIds(token: string): Promise<string[]> {
    const res = await authGet(token, "/tasks?limit=200");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body.data as Array<{ id: string }>).map((p) => p.id);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    appConn = appPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "tcb2a");
    B = await seedCompany(direct, "tcb2b");
    companyIds.push(A.companyId, B.companyId);

    ouEng = await seedOrgUnit(A.companyId, "Engineering");
    ouSales = await seedOrgUnit(A.companyId, "Sales");

    adminUser = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
    mgrUser = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
    empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
    hrUser = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
    myUser = await seedUser(direct, A.companyId, `my@${A.slug}.test`, hash);
    const addUser = await seedUser(direct, A.companyId, `add@${A.slug}.test`, hash);
    const otherUser = await seedUser(direct, A.companyId, `other@${A.slug}.test`, hash);
    const resignedUser = await seedUser(direct, A.companyId, `resigned@${A.slug}.test`, hash);
    const terminatedUser = await seedUser(direct, A.companyId, `term@${A.slug}.test`, hash);
    const inactiveUser = await seedUser(direct, A.companyId, `inactive@${A.slug}.test`, hash);
    const deletedUser = await seedUser(direct, A.companyId, `deleted@${A.slug}.test`, hash);

    adminEmp = await seedEmp(A.companyId, adminUser, ouEng, null);
    mgrEmp = await seedEmp(A.companyId, mgrUser, ouEng, null);
    empEmp = await seedEmp(A.companyId, empUser, ouEng, mgrUser); // report of mgr → team-tree
    await seedEmp(A.companyId, hrUser, ouEng, null);
    myEmp = await seedEmp(A.companyId, myUser, ouEng, null);
    otherEmp = await seedEmp(A.companyId, otherUser, ouSales, null); // ngoài team mgr, ngoài own emp
    addEmp = await seedEmp(A.companyId, addUser, ouSales, null);
    resignedEmp = await seedEmp(A.companyId, resignedUser, ouSales, null, "resigned");
    terminatedEmp = await seedEmp(A.companyId, terminatedUser, ouSales, null, "terminated");
    inactiveEmp = await seedEmp(A.companyId, inactiveUser, ouSales, null, "inactive");
    noAccountEmp = await seedEmp(A.companyId, null, ouSales, null);
    deletedEmp = await seedEmp(A.companyId, deletedUser, ouSales, null, "active", true);

    // Grants theo intent 0485 (create/update/delete emp/mgr HOÃN → chỉ read cho emp/mgr).
    await grantTask(A.companyId, adminUser, [
      ["read", "Company"],
      ["create", "Company"],
      ["update", "Company"],
      ["delete", "Company"],
    ]);
    await grantTask(A.companyId, hrUser, [
      ["read", "Company"],
      ["create", "Company"],
      ["update", "Company"],
    ]);
    await grantTask(A.companyId, mgrUser, [["read", "Team"]]);
    await grantTask(A.companyId, empUser, [["read", "Own"]]);
    await grantTask(A.companyId, myUser, [["read", "Company"]]);

    // Read fixtures (assignee-scope + membership).
    taskAdmin = await seedTask({
      companyId: A.companyId,
      title: "T-admin",
      mainAssigneeEmployeeId: adminEmp,
    });
    taskEmp = await seedTask({
      companyId: A.companyId,
      title: "T-emp",
      mainAssigneeEmployeeId: empEmp,
    });
    taskMgr = await seedTask({
      companyId: A.companyId,
      title: "T-mgr",
      mainAssigneeEmployeeId: mgrEmp,
    });
    taskColleague = await seedTask({
      companyId: A.companyId,
      title: "T-colleague",
      mainAssigneeEmployeeId: otherEmp,
    });
    const empProject = await seedProject(A.companyId, "Emp Project");
    await seedMember(A.companyId, empProject, empUser, empEmp);
    taskInEmpProject = await seedTask({
      companyId: A.companyId,
      title: "T-in-emp-proj",
      mainAssigneeEmployeeId: adminEmp, // assignee ngoài scope emp; emp thấy qua MEMBERSHIP
      projectId: empProject,
    });
    const mgrProject = await seedProject(A.companyId, "Mgr Project");
    await seedMember(A.companyId, mgrProject, mgrUser, mgrEmp);
    taskInMgrProject = await seedTask({
      companyId: A.companyId,
      title: "T-in-mgr-proj",
      mainAssigneeEmployeeId: adminEmp,
      projectId: mgrProject,
    });
    workflowTask = await seedTask({
      companyId: A.companyId,
      title: "T-workflow",
      taskType: "production",
      mainAssigneeEmployeeId: adminEmp,
    });

    // my-tasks fixtures (myUser).
    const pastDue = new Date(Date.now() - 86400000).toISOString();
    myAssigned = await seedTask({
      companyId: A.companyId,
      title: "my-assigned",
      mainAssigneeEmployeeId: myEmp,
      dueAt: pastDue, // overdue → phải lên đầu
    });
    myCreated = await seedTask({
      companyId: A.companyId,
      title: "my-created",
      mainAssigneeEmployeeId: otherEmp,
      creatorUserId: myUser,
    });
    myWatched = await seedTask({
      companyId: A.companyId,
      title: "my-watched",
      mainAssigneeEmployeeId: otherEmp,
      creatorUserId: adminUser,
    });
    await seedWatcher(A.companyId, myWatched, myEmp);
    myOverlap = await seedTask({
      companyId: A.companyId,
      title: "my-overlap",
      mainAssigneeEmployeeId: myEmp,
      creatorUserId: myUser,
    });
    await seedWatcher(A.companyId, myOverlap, myEmp);
    myUnrelated = await seedTask({
      companyId: A.companyId,
      title: "my-unrelated",
      mainAssigneeEmployeeId: otherEmp,
      creatorUserId: adminUser,
    });

    // Tenant B (cross-tenant).
    const bAdmin = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
    await seedEmp(B.companyId, bAdmin, null, null);
    await grantTask(B.companyId, bAdmin, [
      ["read", "Company"],
      ["update", "Company"],
      ["delete", "Company"],
    ]);
    bTask = await seedTask({ companyId: B.companyId, title: "b-task" });

    // S5-TASK-DEPTFILTER-1 — fixtures cho filter departmentId + search. GẮN VÀO adminEmp (NGOÀI phạm
    // vi Own của empUser): empUser lọc theo departmentId=ouEng vẫn KHÔNG được thấy → chứng minh filter
    // chỉ thu hẹp TRONG scope, không lách. Tiêu đề phân biệt để test ILIKE.
    deptTaskEngA = await seedTask({
      companyId: A.companyId,
      title: "Dept Eng Alpha migration",
      mainAssigneeEmployeeId: adminEmp,
      departmentId: ouEng,
    });
    deptTaskEngB = await seedTask({
      companyId: A.companyId,
      title: "Dept Eng Beta rollout",
      mainAssigneeEmployeeId: adminEmp,
      departmentId: ouEng,
    });
    deptTaskSales = await seedTask({
      companyId: A.companyId,
      title: "Dept Sales Alpha campaign",
      mainAssigneeEmployeeId: adminEmp,
      departmentId: ouSales,
    });
  });

  afterAll(async () => {
    if (direct && companyIds.length) {
      for (const tbl of [
        "task_activity_logs",
        "task_watchers",
        "task_assignees",
        "tasks",
        "project_members",
        "employee_profiles",
      ]) {
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

  // ── DENY-PATH (403) — create/update/delete emp/mgr HOÃN theo 0485 ─────────────
  it("employee/manager KHÔNG có create:task (deferred) → POST /tasks 403", async () => {
    const emp = await login(A.slug, `emp@${A.slug}.test`);
    const mgr = await login(A.slug, `mgr@${A.slug}.test`);
    expect((await authPost(emp, "/tasks").send({ title: "x" })).status).toBe(403);
    expect((await authPost(mgr, "/tasks").send({ title: "x" })).status).toBe(403);
  });

  it("hr/company-admin (create:task@Company) → POST /tasks 201", async () => {
    const hr = await login(A.slug, `hr@${A.slug}.test`);
    const res = await authPost(hr, "/tasks").send({ title: "hr task", priority: "High" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe("Todo");
    expect(res.body.data.priority).toBe("High");
  });

  // ── DATA-SCOPE TRONG-TENANT (đọc) ─────────────────────────────────────────────
  it("employee @Own: thấy task assigned=mình + task project mình member; KHÔNG thấy task đồng nghiệp", async () => {
    const t = await login(A.slug, `emp@${A.slug}.test`);
    const seen = await listIds(t);
    expect(seen).toContain(taskEmp);
    expect(seen).toContain(taskInEmpProject);
    expect(seen).not.toContain(taskAdmin);
    expect(seen).not.toContain(taskColleague);
    expect(seen).not.toContain(taskInMgrProject);
    // list↔detail parity: ngoài scope → 404, trong scope → 200.
    expect((await authGet(t, `/tasks/${taskAdmin}`)).status).toBe(404);
    expect((await authGet(t, `/tasks/${taskEmp}`)).status).toBe(200);
  });

  it("manager @Team: thấy task team-tree + task project mình member; KHÔNG thấy ngoài team", async () => {
    const t = await login(A.slug, `mgr@${A.slug}.test`);
    const seen = await listIds(t);
    expect(seen).toContain(taskMgr); // self
    expect(seen).toContain(taskEmp); // empEmp report → team
    expect(seen).toContain(taskInMgrProject); // mgr member
    expect(seen).not.toContain(taskAdmin);
    expect(seen).not.toContain(taskColleague);
    expect(seen).not.toContain(taskInEmpProject); // mgr không member + assignee adminEmp ngoài team
    expect((await authGet(t, `/tasks/${taskColleague}`)).status).toBe(404);
    expect((await authGet(t, `/tasks/${taskEmp}`)).status).toBe(200);
  });

  it("admin @Company: thấy TẤT", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const seen = await listIds(t);
    for (const id of [
      taskAdmin,
      taskEmp,
      taskMgr,
      taskColleague,
      taskInEmpProject,
      taskInMgrProject,
    ])
      expect(seen).toContain(id);
  });

  it("filter status/priority/assignee/overdue + pagination", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const lim = await authGet(t, "/tasks?limit=1");
    expect(lim.status).toBe(200);
    expect((lim.body.data as unknown[]).length).toBe(1);
    const byAssignee = await authGet(t, `/tasks?assigneeEmployeeId=${mgrEmp}&limit=200`);
    expect(byAssignee.status).toBe(200);
    for (const r of byAssignee.body.data as Array<{ mainAssigneeEmployeeId: string }>)
      expect(r.mainAssigneeEmployeeId).toBe(mgrEmp);
  });

  // ── S5-TASK-DEPTFILTER-1 — filter departmentId + search (gỡ nợ #272) ────────────
  it("filter departmentId chỉ trả task đúng phòng (admin @Company)", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const res = await authGet(t, `/tasks?departmentId=${ouEng}&limit=200`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as Array<{ id: string; departmentId: string | null }>;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(deptTaskEngA);
    expect(ids).toContain(deptTaskEngB);
    expect(ids).not.toContain(deptTaskSales); // phòng khác
    for (const r of rows) expect(r.departmentId).toBe(ouEng);
  });

  it("filter search khớp tiêu đề (ILIKE, không phân biệt hoa/thường)", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const res = await authGet(t, `/tasks?search=eng%20alpha&limit=200`); // lowercase, khoảng trắng
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(deptTaskEngA); // "Dept Eng Alpha migration"
    expect(ids).not.toContain(deptTaskEngB); // "Beta"
    expect(ids).not.toContain(deptTaskSales); // "Sales Alpha" — không có "eng"
  });

  it("departmentId + search kết hợp (AND) — chỉ giao của hai điều kiện", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const res = await authGet(t, `/tasks?departmentId=${ouEng}&search=alpha&limit=200`);
    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(deptTaskEngA); // Eng + Alpha
    expect(ids).not.toContain(deptTaskEngB); // Eng nhưng Beta
    expect(ids).not.toContain(deptTaskSales); // Alpha nhưng Sales
  });

  // DENY-PATH: filter KHÔNG phải lớp quyền. empUser @Own KHÔNG assignee/không member các task phòng
  // này (chúng giao adminEmp) ⇒ lọc theo departmentId=ouEng vẫn PHẢI rỗng, không lộ task ngoài scope.
  it("filter departmentId KHÔNG lách data-scope (emp @Own không thấy task phòng của người khác)", async () => {
    const t = await login(A.slug, `emp@${A.slug}.test`);
    const res = await authGet(t, `/tasks?departmentId=${ouEng}&limit=200`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(deptTaskEngA);
    expect(ids).not.toContain(deptTaskEngB);
  });

  it("filter search KHÔNG lách data-scope (emp @Own tìm tiêu đề task ngoài scope → rỗng)", async () => {
    const t = await login(A.slug, `emp@${A.slug}.test`);
    const res = await authGet(t, `/tasks?search=dept%20eng&limit=200`);
    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(deptTaskEngA);
    expect(ids).not.toContain(deptTaskEngB);
  });

  // ── CROSS-TENANT (404) ─────────────────────────────────────────────────────────
  it("task tenant khác → 404 (GET/PATCH/DELETE, không lộ tồn tại) kể cả đủ quyền update/delete", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    expect((await authGet(t, `/tasks/${bTask}`)).status).toBe(404);
    expect((await authPatch(t, `/tasks/${bTask}`).send({ title: "x" })).status).toBe(404);
    expect((await authDelete(t, `/tasks/${bTask}`)).status).toBe(404);
  });

  // ── CREATE assignee validation ────────────────────────────────────────────────
  it("POST assignee active + có tài khoản → 201; resigned/terminated/inactive/deleted/no-account → 400", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const ok = await authPost(t, "/tasks").send({ title: "assign-ok", assigneeEmployeeId: addEmp });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.mainAssigneeEmployeeId).toBe(addEmp);
    for (const emp of [resignedEmp, terminatedEmp, inactiveEmp, deletedEmp, noAccountEmp]) {
      const r = await authPost(t, "/tasks").send({ title: "assign-bad", assigneeEmployeeId: emp });
      expect(r.status, `emp ${emp}: ${JSON.stringify(r.body)}`).toBe(400);
    }
  });

  // ── MY TASKS ──────────────────────────────────────────────────────────────────
  it("GET /tasks/my: đúng 3 nguồn (assigned+created+watched) + overlap dedupe + overdue-first", async () => {
    const t = await login(A.slug, `my@${A.slug}.test`);
    const res = await authGet(t, "/tasks/my");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as Array<{ id: string; source: string }>;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(myAssigned);
    expect(ids).toContain(myCreated);
    expect(ids).toContain(myWatched);
    expect(ids).toContain(myOverlap);
    expect(ids).not.toContain(myUnrelated);
    // dedupe: myOverlap (assigned+created+watched) xuất hiện đúng 1 lần.
    expect(ids.filter((id) => id === myOverlap)).toHaveLength(1);
    // overdue-first: myAssigned (due quá khứ, Todo) đứng đầu.
    expect(rows[0].id).toBe(myAssigned);
    // source ưu tiên assigned > created > watched.
    expect(rows.find((r) => r.id === myOverlap)?.source).toBe("assigned");
    expect(rows.find((r) => r.id === myWatched)?.source).toBe("watched");
  });

  // ── DELETE soft + activity + append-only ────────────────────────────────────
  it("DELETE /tasks/:id → soft-delete (deleted_at/by) + biến khỏi list/my; workflow task PATCH/DELETE → 400", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const created = await authPost(t, "/tasks").send({ title: "to-delete" });
    const id = created.body.data.id as string;
    expect((await authDelete(t, `/tasks/${id}`)).status).toBe(204);
    const soft = await direct.query("SELECT deleted_at, deleted_by FROM tasks WHERE id=$1", [id]);
    expect(soft.rows[0].deleted_at).not.toBeNull();
    expect(soft.rows[0].deleted_by).toBe(adminUser);
    expect(await listIds(t)).not.toContain(id);

    // workflow-driven task → PATCH/DELETE 400 (regression FSM guard).
    expect((await authPatch(t, `/tasks/${workflowTask}`).send({ title: "x" })).status).toBe(400);
    expect((await authDelete(t, `/tasks/${workflowTask}`)).status).toBe(400);
  });

  it("PATCH /tasks/:id cập nhật field (title/priority/due) → 200", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const created = await authPost(t, "/tasks").send({ title: "before" });
    const id = created.body.data.id as string;
    const res = await authPatch(t, `/tasks/${id}`).send({ title: "after", priority: "Urgent" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.title).toBe("after");
    expect(res.body.data.priority).toBe("Urgent");
  });

  it("task_activity_logs TASK_CREATED/UPDATED/DELETED target_type='Task' + audit objectType='task'", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const created = await authPost(t, "/tasks").send({ title: "activity" });
    const id = created.body.data.id as string;
    await authPatch(t, `/tasks/${id}`).send({ title: "activity2" });
    await authDelete(t, `/tasks/${id}`);
    const acts = await direct.query(
      "SELECT action, target_type FROM task_activity_logs WHERE task_id=$1",
      [id],
    );
    const actions = new Set((acts.rows as Array<{ action: string }>).map((r) => r.action));
    for (const a of ["TASK_CREATED", "TASK_UPDATED", "TASK_DELETED"])
      expect(actions.has(a), `activity ${a}`).toBe(true);
    for (const r of acts.rows as Array<{ target_type: string }>) expect(r.target_type).toBe("Task");
    const aud = await direct.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE object_type='task' AND object_id=$1",
      [id],
    );
    expect(aud.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("app-role (mediaos_app) KHÔNG UPDATE/DELETE task_activity_logs — ledger append-only #2", async () => {
    const row = await direct.query(
      "SELECT id FROM task_activity_logs WHERE company_id=$1 LIMIT 1",
      [A.companyId],
    );
    const id = row.rows[0]?.id as string;
    expect(id, "cần ≥1 hàng activity").toBeTruthy();
    await expect(
      appConn.query("UPDATE task_activity_logs SET message='tamper' WHERE id=$1", [id]),
    ).rejects.toThrow();
    await expect(
      appConn.query("DELETE FROM task_activity_logs WHERE id=$1", [id]),
    ).rejects.toThrow();
  });
});
