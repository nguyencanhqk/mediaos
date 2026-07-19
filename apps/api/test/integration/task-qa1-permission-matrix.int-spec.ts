/**
 * S4-QA-TASK-1 (lane qapermmatrix) — QA canonical TASK: ma trận permission per-(role × pair) +
 * data-scope Own/Team/Project + IDOR cross-tenant. Postgres THẬT, DB CÔ LẬP.
 *
 * Đường THẬT (KHÔNG mock permission): JwtAuthGuard → CompanyGuard → PermissionGuard → TasksController →
 * TaskCore/TaskActions/TaskComments/TaskChecklists/TaskActivityFeed + DataScopeService + RLS withTenant.
 *
 * Nguồn kỳ vọng = CONST task-permissions.const.ts (TASK_GRANT_MATRIX ∪ TASK_DEFERRED_GRANTS) — KHÔNG
 * hardcode lệch seed. QA seed CHÍNH 4 role canonical (employee/manager/hr/company-admin) đúng ma trận
 * hợp nhất rồi kiểm hành vi route:
 *   1. Deny-matrix: mỗi (role × cặp-TASK không-grant) trên route SỐNG → 403; cặp có-grant → 2xx.
 *      Deny dùng task IN-SCOPE ⇒ 403 CHỈ có thể từ PermissionGuard (fail-open sẽ lộ 2xx, KHÔNG 404) —
 *      RED-meaningful (memory reviewers-pass-real-bugs: chứng minh deny đi đúng đường).
 *   2. Data-scope: employee @Own task được-assign/tự-tạo(self-assign) → 200; ngoài Own → 404; manager
 *      @Team trong team → 200, ngoài team → 404; membership project (project_members Active) mở scope.
 *      Ngoài-scope WRITE → 404 (fail-closed), KHÔNG 403.
 *   3. IDOR: taskId thuộc tenant B, actor tenant A ĐỦ QUYỀN (company-admin) → 404 cho MỌI verb
 *      (read/update/delete/assign/status/priority/deadline/comment/watch/checklist/audit-log) — RLS +
 *      withTenant là hàng rào, KHÔNG lộ tồn tại chéo tenant (404 ≠ 403).
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate + ci-skips-most-integration-specs):
 * CHỈ DB cô lập lane (scripts/lane-db-setup.sh qatask1 + export LANE_DB=mediaos_qatask1). KHÔNG biểu thức
 * ngược (chống false-green); mirror hasLaneDb của task-actions.int-spec.
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
import {
  TASK_DEFERRED_GRANTS,
  TASK_GRANT_MATRIX,
  TASK_PERMISSIONS,
} from "../../src/foundation/seed/task-permissions.const";
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
const LOGIN_PW = "Passw0rd!qatask1";
const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString();

type Role = "employee" | "manager" | "hr" | "company-admin";
type Scope = "Own" | "Team" | "Department" | "Company" | "System";

const ROLES: Role[] = ["employee", "manager", "hr", "company-admin"];
const ROLE_COL: Record<Role, "emp" | "mgr" | "hr" | "ca"> = {
  employee: "emp",
  manager: "mgr",
  hr: "hr",
  "company-admin": "ca",
};

// ── Ma trận hiệu lực = union(base 0485, deferred BE-2/RECON-2) từ CONST (nguồn sự thật) ────────────
const SENSITIVE_PAIRS = new Set(
  TASK_PERMISSIONS.filter((p) => p.sensitive).map((p) => `${p.action}:${p.resourceType}`),
);
function pairKey(action: string, resource: string): string {
  return `${action}:${resource}`;
}
const effective: Record<Role, Map<string, Scope>> = {
  employee: new Map(),
  manager: new Map(),
  hr: new Map(),
  "company-admin": new Map(),
};
for (const row of [...TASK_GRANT_MATRIX, ...TASK_DEFERRED_GRANTS]) {
  for (const role of ROLES) {
    const scope: Scope | undefined = row[ROLE_COL[role]];
    const key = pairKey(row.action, row.resource);
    if (scope && !effective[role].has(key)) effective[role].set(key, scope);
  }
}

describe.skipIf(!hasLaneDb)(
  "S4-QA-TASK-1 permission-matrix + data-scope + IDOR (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let appConn: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    // Actors tenant A — 1 user + 1 employee mỗi role canonical.
    const userIdByRole: Record<Role, string> = {
      employee: "",
      manager: "",
      hr: "",
      "company-admin": "",
    };
    const tok: Record<Role, string> = {
      employee: "",
      manager: "",
      hr: "",
      "company-admin": "",
    };
    let empEmp = ""; // employee actor's employee — report của mgr → Own(emp) ∧ Team(mgr) ∧ Company(hr/ca)
    let mgrEmp = ""; // manager actor's employee (self)
    let outEmp = ""; // ngoài team mgr + ngoài Own emp (org khác, không manager)
    let outUser = "";
    // Tenant B cross-tenant
    let bTask = "";

    // ── Task-factory (direct SQL, superuser bypass RLS — chỉ dựng lưới, KHÔNG đường app) ─────────────
    async function mkTask(opts: {
      companyId?: string;
      mainAssigneeEmployeeId?: string | null;
      assigneeUserId?: string | null;
      creatorUserId?: string;
      taskStatus?: string;
      projectId?: string | null;
    }): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks
         (company_id, task_type, title, task_status, main_assignee_employee_id, assignee_user_id,
          project_id, creator_user_id)
       VALUES ($1,'office','T',$2,$3,$4,$5,$6) RETURNING id`,
        [
          opts.companyId ?? A.companyId,
          opts.taskStatus ?? "Todo",
          opts.mainAssigneeEmployeeId ?? null,
          opts.assigneeUserId ?? null,
          opts.projectId ?? null,
          opts.creatorUserId ?? userIdByRole["company-admin"],
        ],
      );
      return r.rows[0].id as string;
    }

    /** Task IN-SCOPE cho MỌI role: assigned empEmp (Own của emp · Team của mgr · Company của hr/ca). */
    function mkScopedTask(): Promise<string> {
      return mkTask({ mainAssigneeEmployeeId: empEmp, assigneeUserId: userIdByRole.employee });
    }

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
        `INSERT INTO projects (company_id, name, status, project_status)
       VALUES ($1,$2,'active','Active') RETURNING id`,
        [companyId, name],
      );
      return r.rows[0].id as string;
    }

    async function seedProjectMember(
      companyId: string,
      projectId: string,
      userId: string,
      employeeId: string,
    ): Promise<void> {
      await direct.query(
        `INSERT INTO project_members (company_id, project_id, user_id, employee_id, status, member_status)
       VALUES ($1,$2,$3,$4,'active','Active')`,
        [companyId, projectId, userId, employeeId],
      );
    }

    /** Seed 1 role canonical với ĐÚNG các cặp TASK live-route mà ma trận hiệu lực cấp (scope theo const). */
    async function seedCanonicalRole(companyId: string, role: Role, userId: string): Promise<void> {
      const roleId = await seedRole(direct, companyId, `qa1-${role}`);
      for (const p of LIVE_PAIRS) {
        const key = pairKey(p.action, p.resource);
        const scope = effective[role].get(key);
        if (!scope) continue; // deny-hole: KHÔNG cấp — phải giữ 403 trên route
        const permId = await seedPermissionCatalog(
          direct,
          p.action,
          p.resource,
          SENSITIVE_PAIRS.has(key),
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
    const authPost = (t: string, u: string) =>
      request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);
    const authPatch = (t: string, u: string) =>
      request(app.getHttpServer()).patch(u).set("Authorization", `Bearer ${t}`);
    const authDelete = (t: string, u: string) =>
      request(app.getHttpServer()).delete(u).set("Authorization", `Bearer ${t}`);

    // ── 11 cặp TASK tiêu thụ bởi route SỐNG (map controller @RequirePermission) + happy-call ─────────
    interface LivePair {
      action: string;
      resource: string;
      label: string;
      success: number[];
      call: (t: string, taskId: string) => request.Test;
    }
    const LIVE_PAIRS: LivePair[] = [
      {
        action: "read",
        resource: "task",
        label: "GET /tasks/:id",
        success: [200],
        call: (t, id) => authGet(t, `/tasks/${id}`),
      },
      {
        action: "create",
        resource: "task",
        label: "POST /tasks",
        success: [201],
        // S5-TASK-PROJROLE-1 (D-27 create-scope): scope<Company không projectId ⇒ assignee BẮT BUỘC
        // + trong scope. empEmp = chính employee (Own ✓) đồng thời report của manager (Team ✓);
        // hr/ca @Company không bị ảnh hưởng. Payload trần {title} nay 403 cho emp/mgr — CHỦ ĐÍCH.
        call: (t) => authPost(t, `/tasks`).send({ title: "qa-create", assigneeEmployeeId: empEmp }),
      },
      {
        action: "update",
        resource: "task",
        label: "PATCH /tasks/:id",
        success: [200],
        call: (t, id) => authPatch(t, `/tasks/${id}`).send({ title: "qa-update" }),
      },
      {
        action: "delete",
        resource: "task",
        label: "DELETE /tasks/:id",
        success: [204],
        call: (t, id) => authDelete(t, `/tasks/${id}`),
      },
      {
        action: "assign",
        resource: "task",
        label: "POST /tasks/:id/assign",
        success: [200],
        call: (t, id) => authPost(t, `/tasks/${id}/assign`).send({ assigneeEmployeeId: mgrEmp }),
      },
      {
        action: "comment",
        resource: "task",
        label: "POST /tasks/:id/comments",
        success: [201],
        call: (t, id) => authPost(t, `/tasks/${id}/comments`).send({ content: "qa" }),
      },
      {
        action: "watch",
        resource: "task",
        label: "POST /tasks/:id/watchers",
        success: [201],
        call: (t, id) => authPost(t, `/tasks/${id}/watchers`).send({}),
      },
      {
        action: "update-status",
        resource: "task",
        label: "POST /tasks/:id/change-status",
        success: [200],
        call: (t, id) => authPost(t, `/tasks/${id}/change-status`).send({ status: "In Progress" }),
      },
      {
        action: "update-priority",
        resource: "task",
        label: "POST /tasks/:id/change-priority",
        success: [200],
        call: (t, id) => authPost(t, `/tasks/${id}/change-priority`).send({ priority: "High" }),
      },
      {
        action: "update-deadline",
        resource: "task",
        label: "POST /tasks/:id/change-deadline",
        success: [200],
        call: (t, id) => authPost(t, `/tasks/${id}/change-deadline`).send({ dueAt: FUTURE }),
      },
      {
        action: "view",
        resource: "task-audit-log",
        label: "GET /tasks/:id/activity",
        success: [200],
        call: (t, id) => authGet(t, `/tasks/${id}/activity`),
      },
    ];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      appConn = appPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "qa1a");
      B = await seedCompany(direct, "qa1b");
      companyIds.push(A.companyId, B.companyId);

      const ouEng = await seedOrgUnit(A.companyId, "Engineering");
      const ouSales = await seedOrgUnit(A.companyId, "Sales");

      // Users + employees tenant A.
      userIdByRole["company-admin"] = await seedUser(
        direct,
        A.companyId,
        `ca@${A.slug}.test`,
        hash,
      );
      userIdByRole.manager = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
      userIdByRole.employee = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
      userIdByRole.hr = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
      outUser = await seedUser(direct, A.companyId, `out@${A.slug}.test`, hash);

      await seedEmp(A.companyId, userIdByRole["company-admin"], ouEng, null);
      mgrEmp = await seedEmp(A.companyId, userIdByRole.manager, ouEng, null);
      empEmp = await seedEmp(A.companyId, userIdByRole.employee, ouEng, userIdByRole.manager); // report mgr
      await seedEmp(A.companyId, userIdByRole.hr, ouEng, null);
      outEmp = await seedEmp(A.companyId, outUser, ouSales, null); // ngoài team mgr, ngoài Own emp

      for (const role of ROLES) await seedCanonicalRole(A.companyId, role, userIdByRole[role]);

      // Tenant B — chỉ cần 1 task để test IDOR (actor là company-admin của A).
      const bUser = await seedUser(direct, B.companyId, `owner@${B.slug}.test`, hash);
      await seedEmp(B.companyId, bUser, null, null);
      bTask = await mkTask({ companyId: B.companyId, creatorUserId: bUser });

      tok.employee = await login(A.slug, `emp@${A.slug}.test`);
      tok.manager = await login(A.slug, `mgr@${A.slug}.test`);
      tok.hr = await login(A.slug, `hr@${A.slug}.test`);
      tok["company-admin"] = await login(A.slug, `ca@${A.slug}.test`);
    });

    afterAll(async () => {
      if (direct && companyIds.length) {
        for (const tbl of [
          "task_activity_logs",
          "task_checklist_items",
          "task_checklists",
          "task_watchers",
          "task_assignees",
          "task_comments",
          "tasks",
          "project_members",
          "projects",
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

    // ════════════════════ 1. DENY-MATRIX per-(role × pair) trên route SỐNG ════════════════════
    // Kỳ vọng suy TỪ CONST: có grant → 2xx (không under-grant); không grant → 403 (không over-grant).
    // Task deny IN-SCOPE ⇒ 403 CHỈ từ PermissionGuard (fail-open sẽ ra 2xx, KHÔNG 404) — RED-meaningful.
    for (const role of ROLES) {
      describe(`deny-matrix role=${role} (scope ${effective[role].get("read:task") ?? "-"})`, () => {
        for (const p of LIVE_PAIRS) {
          const key = pairKey(p.action, p.resource);
          const granted = effective[role].has(key);
          it(`${p.label} [${key}] → ${granted ? "2xx (granted)" : "403 (deny-hole)"}`, async () => {
            const taskId = await mkScopedTask();
            const res = await p.call(tok[role], taskId);
            if (granted) {
              expect(
                p.success,
                `${role} ${key}: got ${res.status} ${JSON.stringify(res.body)}`,
              ).toContain(res.status);
            } else {
              expect(res.status, `${role} ${key}: expected 403 deny-hole`).toBe(403);
            }
          });
        }
      });
    }

    // ════════════════════ 2. DATA-SCOPE Own / Team / Project ════════════════════

    describe("data-scope employee @Own", () => {
      it("task được-assign cho mình → read 200 · change-status 200 · comment 201 · watch 201", async () => {
        const own = await mkScopedTask();
        expect((await authGet(tok.employee, `/tasks/${own}`)).status).toBe(200);
        expect(
          (
            await authPost(tok.employee, `/tasks/${own}/change-status`).send({
              status: "In Progress",
            })
          ).status,
        ).toBe(200);
        const c = await mkScopedTask();
        expect(
          (await authPost(tok.employee, `/tasks/${c}/comments`).send({ content: "hi" })).status,
        ).toBe(201);
        expect((await authPost(tok.employee, `/tasks/${c}/watchers`).send({})).status).toBe(201);
      });

      it("task TỰ-TẠO (self-assign qua POST /tasks) → nằm trong Own ⇒ change-status 200", async () => {
        const created = await authPost(tok.employee, `/tasks`).send({
          title: "self",
          assigneeEmployeeId: empEmp,
        });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        const id = created.body.data.id as string;
        expect(
          (
            await authPost(tok.employee, `/tasks/${id}/change-status`).send({
              status: "In Progress",
            })
          ).status,
        ).toBe(200);
      });

      it("task NGOÀI Own (assigned người khác) → read 404 · WRITE (change-status/comment/watch) 404 fail-closed (KHÔNG 403)", async () => {
        const foreign = await mkTask({ mainAssigneeEmployeeId: outEmp, assigneeUserId: outUser });
        expect((await authGet(tok.employee, `/tasks/${foreign}`)).status).toBe(404);
        const cs = await authPost(tok.employee, `/tasks/${foreign}/change-status`).send({
          status: "In Progress",
        });
        expect(cs.status).toBe(404);
        expect(cs.status).not.toBe(403);
        expect(
          (await authPost(tok.employee, `/tasks/${foreign}/comments`).send({ content: "x" }))
            .status,
        ).toBe(404);
        expect((await authPost(tok.employee, `/tasks/${foreign}/watchers`).send({})).status).toBe(
          404,
        );
      });
    });

    describe("data-scope manager @Team", () => {
      it("task assigned report (empEmp) → read 200 · change-status 200 · change-priority 200 · comment 201", async () => {
        const inTeam = await mkScopedTask();
        expect((await authGet(tok.manager, `/tasks/${inTeam}`)).status).toBe(200);
        expect(
          (
            await authPost(tok.manager, `/tasks/${inTeam}/change-status`).send({
              status: "In Progress",
            })
          ).status,
        ).toBe(200);
        const pr = await mkScopedTask();
        expect(
          (await authPost(tok.manager, `/tasks/${pr}/change-priority`).send({ priority: "High" }))
            .status,
        ).toBe(200);
        expect(
          (await authPost(tok.manager, `/tasks/${pr}/comments`).send({ content: "hi" })).status,
        ).toBe(201);
      });

      it("task NGOÀI Team (assigned outEmp) → read 404 · WRITE 404 fail-closed (KHÔNG 403)", async () => {
        const foreign = await mkTask({ mainAssigneeEmployeeId: outEmp, assigneeUserId: outUser });
        expect((await authGet(tok.manager, `/tasks/${foreign}`)).status).toBe(404);
        const cs = await authPost(tok.manager, `/tasks/${foreign}/change-status`).send({
          status: "In Progress",
        });
        expect(cs.status).toBe(404);
        expect(cs.status).not.toBe(403);
        expect(
          (
            await authPost(tok.manager, `/tasks/${foreign}/change-priority`).send({
              priority: "High",
            })
          ).status,
        ).toBe(404);
      });
    });

    describe("data-scope membership Project mở scope (S5-TASK-PROJROLE-1 D-24: cap theo project_role)", () => {
      it("member thường (role NULL=Member) → task NGOÀI Own trong project: read 200 NHƯNG change-status 404 (write cap Owner/Manager — ĐỔI HÀNH VI chủ đích đợt C)", async () => {
        const proj = await seedProject(A.companyId, "P-member");
        await seedProjectMember(A.companyId, proj, userIdByRole.employee, empEmp);
        const task = await mkTask({
          mainAssigneeEmployeeId: outEmp, // ngoài Own theo assignee
          assigneeUserId: outUser,
          projectId: proj,
        });
        expect((await authGet(tok.employee, `/tasks/${task}`)).status).toBe(200);
        expect(
          (
            await authPost(tok.employee, `/tasks/${task}/change-status`).send({
              status: "In Progress",
            })
          ).status,
        ).toBe(404);
      });

      it("member role Manager → task NGOÀI Own trong project: read 200 VÀ change-status 200 (membership 'write' mở đúng cho Owner/Manager)", async () => {
        const proj = await seedProject(A.companyId, "P-member-mgr");
        await seedProjectMember(A.companyId, proj, userIdByRole.employee, empEmp);
        await direct.query(
          `UPDATE project_members SET project_role='Manager'
            WHERE company_id=$1 AND project_id=$2 AND employee_id=$3 AND deleted_at IS NULL`,
          [A.companyId, proj, empEmp],
        );
        const task = await mkTask({
          mainAssigneeEmployeeId: outEmp,
          assigneeUserId: outUser,
          projectId: proj,
        });
        expect((await authGet(tok.employee, `/tasks/${task}`)).status).toBe(200);
        expect(
          (
            await authPost(tok.employee, `/tasks/${task}/change-status`).send({
              status: "In Progress",
            })
          ).status,
        ).toBe(200);
      });

      it("KHÔNG membership → cùng loại task ngoài Own trong project khác ⇒ 404 (scope vẫn đóng)", async () => {
        const proj2 = await seedProject(A.companyId, "P-nomember");
        const task = await mkTask({
          mainAssigneeEmployeeId: outEmp,
          assigneeUserId: outUser,
          projectId: proj2,
        });
        expect((await authGet(tok.employee, `/tasks/${task}`)).status).toBe(404);
        expect(
          (
            await authPost(tok.employee, `/tasks/${task}/change-status`).send({
              status: "In Progress",
            })
          ).status,
        ).toBe(404);
      });
    });

    describe("data-scope LIST (GET /tasks + /tasks/my) lọc theo scope", () => {
      it("employee GET /tasks → chỉ task Own; loại task ngoài Own; /tasks/my chứa task của mình", async () => {
        const own = await mkScopedTask();
        const foreign = await mkTask({ mainAssigneeEmployeeId: outEmp, assigneeUserId: outUser });
        const res = await authGet(tok.employee, `/tasks?limit=200`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const ids = (res.body.data as Array<{ id: string }>).map((t) => t.id);
        expect(ids).toContain(own);
        expect(ids).not.toContain(foreign);
        const my = await authGet(tok.employee, `/tasks/my`);
        expect(my.status).toBe(200);
        expect((my.body.data as Array<{ id: string }>).map((t) => t.id)).toContain(own);
      });

      it("manager GET /tasks → thấy task trong Team, KHÔNG thấy ngoài Team", async () => {
        const inTeam = await mkScopedTask();
        const foreign = await mkTask({ mainAssigneeEmployeeId: outEmp, assigneeUserId: outUser });
        const res = await authGet(tok.manager, `/tasks?limit=200`);
        expect(res.status).toBe(200);
        const ids = (res.body.data as Array<{ id: string }>).map((t) => t.id);
        expect(ids).toContain(inTeam);
        expect(ids).not.toContain(foreign);
      });

      it("company-admin GET /tasks → thấy CẢ task ngoài team (Company scope, không lọc)", async () => {
        const foreign = await mkTask({ mainAssigneeEmployeeId: outEmp, assigneeUserId: outUser });
        const res = await authGet(tok["company-admin"], `/tasks?limit=200`);
        expect(res.status).toBe(200);
        expect((res.body.data as Array<{ id: string }>).map((t) => t.id)).toContain(foreign);
      });
    });

    describe("data-scope checklist mutate (update:task) fail-closed", () => {
      it("employee create-checklist trên task NGOÀI Own → 404 (scope, KHÔNG 403); trên task Own → 2xx", async () => {
        const foreign = await mkTask({ mainAssigneeEmployeeId: outEmp, assigneeUserId: outUser });
        const bad = await authPost(tok.employee, `/tasks/${foreign}/checklists`).send({
          title: "cl",
        });
        expect(bad.status).toBe(404);
        expect(bad.status).not.toBe(403);
        const own = await mkScopedTask();
        const ok = await authPost(tok.employee, `/tasks/${own}/checklists`).send({ title: "cl" });
        expect([200, 201]).toContain(ok.status);
      });
    });

    // ════════════════════ 3. IDOR cross-tenant → 404 cho MỌI verb (không 403) ════════════════════
    describe("IDOR cross-tenant (actor company-admin tenant A, taskId tenant B)", () => {
      // company-admin có ĐỦ mọi grant TASK → 404 ở đây CHỨNG MINH RLS+withTenant là hàng rào, KHÔNG phải
      // thiếu quyền (403). 404 nhất quán ⇒ không lộ tồn tại chéo tenant.
      const verbs: Array<{ label: string; run: (t: string, id: string) => request.Test }> = [
        { label: "GET /tasks/:id (read)", run: (t, id) => authGet(t, `/tasks/${id}`) },
        {
          label: "PATCH /tasks/:id (update)",
          run: (t, id) => authPatch(t, `/tasks/${id}`).send({ title: "x" }),
        },
        { label: "DELETE /tasks/:id (delete)", run: (t, id) => authDelete(t, `/tasks/${id}`) },
        {
          label: "POST /tasks/:id/assign",
          run: (t, id) => authPost(t, `/tasks/${id}/assign`).send({ assigneeEmployeeId: mgrEmp }),
        },
        {
          label: "POST /tasks/:id/change-status",
          run: (t, id) => authPost(t, `/tasks/${id}/change-status`).send({ status: "In Progress" }),
        },
        {
          label: "POST /tasks/:id/change-priority",
          run: (t, id) => authPost(t, `/tasks/${id}/change-priority`).send({ priority: "High" }),
        },
        {
          label: "POST /tasks/:id/change-deadline",
          run: (t, id) => authPost(t, `/tasks/${id}/change-deadline`).send({ dueAt: FUTURE }),
        },
        {
          label: "POST /tasks/:id/comments (comment)",
          run: (t, id) => authPost(t, `/tasks/${id}/comments`).send({ content: "x" }),
        },
        {
          label: "GET /tasks/:id/comments (read)",
          run: (t, id) => authGet(t, `/tasks/${id}/comments`),
        },
        {
          label: "POST /tasks/:id/watchers (watch)",
          run: (t, id) => authPost(t, `/tasks/${id}/watchers`).send({}),
        },
        {
          label: "POST /tasks/:id/checklists (update)",
          run: (t, id) => authPost(t, `/tasks/${id}/checklists`).send({ title: "cl" }),
        },
        {
          label: "GET /tasks/:id/activity (view:task-audit-log)",
          run: (t, id) => authGet(t, `/tasks/${id}/activity`),
        },
      ];
      for (const v of verbs) {
        it(`${v.label} trên task tenant B → 404 (không 403, không lộ tồn tại)`, async () => {
          const res = await v.run(tok["company-admin"], bTask);
          expect(res.status, `${v.label}: got ${res.status} ${JSON.stringify(res.body)}`).toBe(404);
          expect(res.status).not.toBe(403);
        });
      }
    });
  },
);
