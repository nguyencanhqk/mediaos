/**
 * S4-TASK-BE-4 — Kanban board + move + activity feed integration (Postgres THẬT, DB CÔ LẬP).
 *
 * Đường THẬT: JwtAuthGuard → CompanyGuard → PermissionGuard → Controller → Service → RLS withTenant.
 * KHÔNG mock permission. Phủ:
 *   1. Kanban board nhóm task theo task_status; scope Own chỉ thấy task liên quan; deny 403 thiếu
 *      view-kanban:task; project cross-tenant/không tồn tại → 404.
 *   2. Move tái dùng CHÍNH FSM (TaskActionsService.changeStatus): hợp lệ → 200 + activity/outbox
 *      TASK_STATUS_CHANGED (KHÔNG event riêng); sai FSM → 409; deny 403 thiếu update-status:task; kéo
 *      task ngoài scope (mgr) → 404.
 *   3. Activity feed: hr/admin xem được (view:task-audit-log sensitive); employee/manager → 403
 *      (TASK-ERR-042); cross-tenant taskId → 404.
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate).
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
const LOGIN_PW = "Passw0rd!lane4kma";

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, resourceType: string, scope: Scope, isSensitive?: boolean];

describe.skipIf(!hasLaneDb)(
  "S4-TASK-BE-4 Kanban board + move + activity (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let appConn: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let adminUser = "";
    let mgrUser = "";
    let empUser = "";
    let mgrEmp = "";
    let empEmp = "";
    let outEmp = ""; // ngoài team mgr
    let projectId = "";
    let bAdmin = "";
    let bProjectId = "";
    let pwHash = ""; // hash THẬT (PasswordService) — mọi user ad-hoc trong it() PHẢI dùng biến này, KHÔNG chuỗi giả.

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

    async function mkTask(opts: {
      companyId?: string;
      taskStatus?: string;
      mainAssigneeEmployeeId?: string | null;
      projectId?: string | null;
      creatorUserId?: string | null;
    }): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, task_status, main_assignee_employee_id, project_id, creator_user_id)
       VALUES ($1,'office',$2,$3,$4,$5,$6) RETURNING id`,
        [
          opts.companyId ?? A.companyId,
          "T",
          opts.taskStatus ?? "Todo",
          opts.mainAssigneeEmployeeId ?? null,
          opts.projectId ?? null,
          opts.creatorUserId ?? adminUser,
        ],
      );
      return r.rows[0].id as string;
    }

    async function grant(companyId: string, userId: string, pairs: Pair[]): Promise<void> {
      const roleId = await seedRole(direct, companyId, `kma-${userId.slice(0, 8)}`);
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
    const authPost = (t: string, u: string) =>
      request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      appConn = appPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      pwHash = hash;
      A = await seedCompany(direct, "kmaA");
      B = await seedCompany(direct, "kmaB");
      companyIds.push(A.companyId, B.companyId);

      const ouEng = await seedOrgUnit(A.companyId, "Engineering");
      const ouSales = await seedOrgUnit(A.companyId, "Sales");

      adminUser = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
      mgrUser = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
      empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);

      await seedEmp(A.companyId, adminUser, ouEng, null);
      mgrEmp = await seedEmp(A.companyId, mgrUser, ouEng, null);
      empEmp = await seedEmp(A.companyId, empUser, ouEng, mgrUser);
      outEmp = await seedEmp(A.companyId, null, ouSales, null);

      projectId = await seedProject(A.companyId, "Kanban Project");

      await grant(A.companyId, adminUser, [
        ["view-kanban", "task", "Company"],
        ["update-status", "task", "Company"],
        ["view", "task-audit-log", "Company", true],
      ]);
      await grant(A.companyId, mgrUser, [
        ["view-kanban", "task", "Team"],
        ["update-status", "task", "Team"],
      ]);
      await grant(A.companyId, empUser, [
        ["view-kanban", "task", "Own"],
        ["update-status", "task", "Own"],
      ]);

      bAdmin = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
      await seedEmp(B.companyId, bAdmin, null, null);
      await grant(B.companyId, bAdmin, [
        ["view-kanban", "task", "Company"],
        ["update-status", "task", "Company"],
      ]);
      bProjectId = await seedProject(B.companyId, "B Project");

      tok.admin = await login(A.slug, `admin@${A.slug}.test`);
      tok.mgr = await login(A.slug, `mgr@${A.slug}.test`);
      tok.emp = await login(A.slug, `emp@${A.slug}.test`);
      tok.bAdmin = await login(B.slug, `admin@${B.slug}.test`);
    });

    afterAll(async () => {
      if (direct && companyIds.length) {
        for (const tbl of [
          "task_activity_logs",
          "task_watchers",
          "task_assignees",
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

    // ── 1. Kanban board ─────────────────────────────────────────────────────────

    it("board nhóm task theo status; admin @Company thấy toàn bộ 5 cột đúng task", async () => {
      const t1 = await mkTask({ projectId, taskStatus: "Todo", mainAssigneeEmployeeId: mgrEmp });
      const t2 = await mkTask({
        projectId,
        taskStatus: "In Progress",
        mainAssigneeEmployeeId: empEmp,
      });
      const t3 = await mkTask({ projectId, taskStatus: "Done", mainAssigneeEmployeeId: outEmp });

      const res = await authGet(tok.admin, `/projects/${projectId}/kanban`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const cols = res.body.data.columns as Array<{ status: string; tasks: Array<{ id: string }> }>;
      expect(cols.map((c) => c.status)).toEqual([
        "Todo",
        "In Progress",
        "In Review",
        "Done",
        "Cancelled",
      ]);
      const idsByStatus = (status: string) =>
        (cols.find((c) => c.status === status)?.tasks ?? []).map((t) => t.id);
      expect(idsByStatus("Todo")).toContain(t1);
      expect(idsByStatus("In Progress")).toContain(t2);
      expect(idsByStatus("Done")).toContain(t3);
    });

    it("employee @Own chỉ thấy task LIÊN QUAN (assignee = chính mình), KHÔNG thấy task người khác", async () => {
      const mine = await mkTask({ projectId, taskStatus: "Todo", mainAssigneeEmployeeId: empEmp });
      const others = await mkTask({
        projectId,
        taskStatus: "Todo",
        mainAssigneeEmployeeId: mgrEmp,
      });

      const res = await authGet(tok.emp, `/projects/${projectId}/kanban`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const cols = res.body.data.columns as Array<{ status: string; tasks: Array<{ id: string }> }>;
      const todoIds = (cols.find((c) => c.status === "Todo")?.tasks ?? []).map((t) => t.id);
      expect(todoIds).toContain(mine);
      expect(todoIds).not.toContain(others);
    });

    it("thiếu view-kanban:task → 403; project không tồn tại/cross-tenant → 404", async () => {
      const noGrantUser = await seedUser(direct, A.companyId, `nogrant@${A.slug}.test`, pwHash);
      await seedEmp(A.companyId, noGrantUser, null, null);
      await grant(A.companyId, noGrantUser, [["read", "task", "Own"]]);
      const noGrantTok = await login(A.slug, `nogrant@${A.slug}.test`);
      expect((await authGet(noGrantTok, `/projects/${projectId}/kanban`)).status).toBe(403);

      expect(
        (await authGet(tok.admin, `/projects/00000000-0000-0000-0000-000000000000/kanban`)).status,
      ).toBe(404);
      // cross-tenant: admin A gọi project của B → 404 (RLS ẩn, không lộ tồn tại).
      expect((await authGet(tok.admin, `/projects/${bProjectId}/kanban`)).status).toBe(404);
    });

    // ── 2. Move (tái dùng CHÍNH FSM) ────────────────────────────────────────────

    it("move hợp lệ Todo→In Progress → 200 + activity/outbox TASK_STATUS_CHANGED (KHÔNG event 'move' riêng)", async () => {
      const t = await mkTask({ taskStatus: "Todo" });
      const res = await authPost(tok.admin, `/tasks/${t}/move`).send({ status: "In Progress" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.task.status).toBe("In Progress");

      const activity = await direct.query(
        "SELECT count(*)::int n FROM task_activity_logs WHERE task_id=$1 AND action='TASK_STATUS_CHANGED'",
        [t],
      );
      expect(activity.rows[0].n).toBe(1);
      const outbox = await direct.query(
        "SELECT count(*)::int n FROM outbox_events WHERE payload->>'taskId'=$1 AND event_type='task.status_changed'",
        [t],
      );
      expect(outbox.rows[0].n).toBe(1);
      // KHÔNG có event_type riêng cho "move" — mirror đúng change-status, không phát thêm.
      const moveEvt = await direct.query(
        "SELECT count(*)::int n FROM outbox_events WHERE payload->>'taskId'=$1 AND event_type LIKE '%move%'",
        [t],
      );
      expect(moveEvt.rows[0].n).toBe(0);
    });

    it("move sai FSM (Todo→Done) → 409, state giữ nguyên", async () => {
      const t = await mkTask({ taskStatus: "Todo" });
      const res = await authPost(tok.admin, `/tasks/${t}/move`).send({ status: "Done" });
      expect(res.status).toBe(409);
      const row = await direct.query("SELECT task_status FROM tasks WHERE id=$1", [t]);
      expect(row.rows[0].task_status).toBe("Todo");
    });

    it("move thiếu update-status:task → 403 (view-only Kanban, không kéo thả được — SPEC-06 §14.13)", async () => {
      const viewOnlyUser = await seedUser(direct, A.companyId, `viewonly@${A.slug}.test`, pwHash);
      await seedEmp(A.companyId, viewOnlyUser, null, null);
      await grant(A.companyId, viewOnlyUser, [["view-kanban", "task", "Company"]]);
      const viewOnlyTok = await login(A.slug, `viewonly@${A.slug}.test`);
      const t = await mkTask({ taskStatus: "Todo" });
      expect(
        (await authPost(viewOnlyTok, `/tasks/${t}/move`).send({ status: "In Progress" })).status,
      ).toBe(403);
    });

    it("mgr @Team move task NGOÀI team (assignee=outEmp) → 404 (không lộ tồn tại)", async () => {
      const t = await mkTask({ taskStatus: "Todo", mainAssigneeEmployeeId: outEmp });
      expect(
        (await authPost(tok.mgr, `/tasks/${t}/move`).send({ status: "In Progress" })).status,
      ).toBe(404);
    });

    // ── 3. Activity feed ─────────────────────────────────────────────────────────

    it("hr/admin xem được activity (view:task-audit-log sensitive); employee/manager → 403", async () => {
      const t = await mkTask({ taskStatus: "Todo" });
      await authPost(tok.admin, `/tasks/${t}/move`).send({ status: "In Progress" });

      const adminRes = await authGet(tok.admin, `/tasks/${t}/activity`);
      expect(adminRes.status, JSON.stringify(adminRes.body)).toBe(200);
      expect(Array.isArray(adminRes.body.data)).toBe(true);
      expect(adminRes.body.data.length).toBeGreaterThan(0);
      expect(adminRes.body.data[0].action).toBeDefined();

      expect((await authGet(tok.mgr, `/tasks/${t}/activity`)).status).toBe(403);
      expect((await authGet(tok.emp, `/tasks/${t}/activity`)).status).toBe(403);
    });

    it("activity cross-tenant taskId → 404", async () => {
      const bTask = await mkTask({ companyId: B.companyId, creatorUserId: bAdmin });
      expect((await authGet(tok.admin, `/tasks/${bTask}/activity`)).status).toBe(404);
    });
  },
);
