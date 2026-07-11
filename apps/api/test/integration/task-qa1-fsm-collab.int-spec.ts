/**
 * S4-QA-TASK-1 (lane qafsmcollab) — QA canonical TASK: FSM workflow + collaboration deny. Postgres THẬT,
 * DB CÔ LẬP mediaos_qatask1. Đường THẬT (KHÔNG mock permission): JwtAuthGuard → CompanyGuard →
 * PermissionGuard → TasksController → TaskActions/TaskComments/TaskChecklists + DataScopeService +
 * SettingService + RLS withTenant. Nguồn kỳ vọng grant = CONST task-permissions.const.ts
 * (TASK_GRANT_MATRIX ∪ TASK_DEFERRED_GRANTS) — KHÔNG hardcode lệch seed 0485/0486.
 *
 * Phủ (done_when S4-QA-TASK-1):
 *   1. FSM: transition ngoài bảng SPEC-06 §14.11 → 409 TASK-ERR-WORKFLOW-INVALID + task_status KHÔNG đổi +
 *      0 outbox/0 activity; from=Cancelled (terminal) → 422 TASK-ERR-TASK-CLOSED; Done khi checklist
 *      is_required_for_done chưa tick → 400 TASK-ERR-CHECKLIST-REQUIRED (tick hết → 200); from===to → 200 no-op.
 *   2. Kanban move (POST /tasks/:id/move) MIRROR change-status: thiếu update-status:task → 403; move ĐI QUA
 *      CÙNG FSM (transition sai → 409, không lách).
 *   3. Watcher self-only: add self → Active; body non-empty → 400 (strict, không add hộ ai); duplicate →
 *      409 TASK-ERR-DUPLICATE-WATCHER; gỡ watcher NGƯỜI KHÁC → 404 (self-only); actor không employee → 400
 *      TASK-ERR-WATCHER-NO-EMPLOYEE.
 *   4. Comment: thiếu comment:task → 403; comment task NGOÀI scope đọc → 404; PATCH/DELETE comment người
 *      khác → 403 (self-only); mention ngoài scope → 403 BLOCK (MENTION-OUT-OF-SCOPE).
 *   5. Checklist/item: mutate thiếu update:task → 403; view:task-audit-log thiếu quyền (employee/manager) →
 *      403 (hr/company-admin có → 200).
 *   6. Assign: assignee có Approved leave trùm ngày → 200 + warning ON-LEAVE (GIỮ NGUYÊN, KHÔNG chặn);
 *      assign trên task NGOÀI Team (manager) → 404.
 *   7. Actor-exclusion: self-assign / self-comment KHÔNG tự sinh recipient cho actor — assert outbox payload
 *      (actorUserId trùng assigneeUserId/creatorUserId) ⇒ consumer loại actor → recipient rỗng. KHÔNG e2e
 *      NOTI (thuộc S4-INT-1).
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate + ci-skips-most-integration-specs):
 * CHỈ chạy trên DB cô lập lane (scripts/lane-db-setup.sh qatask1 + export LANE_DB=mediaos_qatask1). KHÔNG
 * biểu thức ngược (chống false-green); mirror hasLaneDb của task-actions.int-spec.
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
const LOGIN_PW = "Passw0rd!qafsm1";
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

// ── Ma trận hiệu lực per-role = union(base 0485, deferred BE-2/RECON-2) từ CONST (nguồn sự thật) ──────
const SENSITIVE_PAIRS = new Set(
  TASK_PERMISSIONS.filter((p) => p.sensitive).map((p) => `${p.action}:${p.resourceType}`),
);
const pairKey = (action: string, resource: string): string => `${action}:${resource}`;
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
  "S4-QA-TASK-1 FSM workflow + collaboration deny (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let appConn: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    // Actors tenant A — 1 user + 1 employee mỗi role canonical + 2 non-canonical (reader/no-employee).
    const userIdByRole: Record<Role, string> = {
      employee: "",
      manager: "",
      hr: "",
      "company-admin": "",
    };
    const tok: Record<string, string> = {};
    let caEmp = ""; // company-admin actor's employee (self-assign / self-comment)
    let mgrEmp = ""; // manager actor's employee
    let empEmp = ""; // employee actor's employee — reports to manager ⇒ Own(emp) ∧ Team(mgr)
    let outUser = ""; // employee-role user NGOÀI team (Sales, không manager) — mention-out-of-scope subject
    let outEmp = ""; // ngoài Team mgr + ngoài Own emp
    let noEmpUser = ""; // có watch:task NHƯNG KHÔNG employee_profiles (watcher fail-loud 400)
    let readerUser = ""; // CHỈ read:task@Company — thiếu mọi cặp write ⇒ 403 deny-hole
    let leaveTypeId = "";

    // ── Factory (direct SQL, superuser bypass RLS — chỉ dựng lưới, KHÔNG đường app) ──────────────────
    async function mkTask(opts: {
      taskType?: string;
      taskStatus?: string;
      mainAssigneeEmployeeId?: string | null;
      assigneeUserId?: string | null;
      projectId?: string | null;
      dueAt?: string | null;
      taskCode?: string | null;
      creatorUserId?: string;
    }): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks
           (company_id, task_type, title, task_status, main_assignee_employee_id, assignee_user_id,
            project_id, due_at, task_code, creator_user_id)
         VALUES ($1,$2,'T',$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          A.companyId,
          opts.taskType ?? "office",
          opts.taskStatus ?? "Todo",
          opts.mainAssigneeEmployeeId ?? null,
          opts.assigneeUserId ?? null,
          opts.projectId ?? null,
          opts.dueAt ?? null,
          opts.taskCode ?? null,
          opts.creatorUserId ?? userIdByRole["company-admin"],
        ],
      );
      return r.rows[0].id as string;
    }

    /** Task IN-SCOPE cho employee (assigned empEmp): Own(emp) · Team(mgr) · Company(hr/ca). */
    const mkEmpTask = (extra: Parameters<typeof mkTask>[0] = {}) =>
      mkTask({ mainAssigneeEmployeeId: empEmp, assigneeUserId: userIdByRole.employee, ...extra });

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

    async function seedApprovedLeave(
      companyId: string,
      userId: string,
      employeeId: string,
      day: string,
    ): Promise<void> {
      await direct.query(
        `INSERT INTO leave_requests
           (company_id, user_id, employee_id, leave_type_id, start_date, end_date, total_days, status)
         VALUES ($1,$2,$3,$4,$5,$6,1,'Approved')`,
        [companyId, userId, employeeId, leaveTypeId, day, day],
      );
    }

    async function enableChecklistSetting(companyId: string): Promise<void> {
      await direct.query(
        `INSERT INTO company_settings
           (company_id, setting_key, setting_value, value_type, category, status)
         VALUES ($1,'require_checklist_done_before_task_done','true','Boolean','Task','Active')
         ON CONFLICT DO NOTHING`,
        [companyId],
      );
    }

    /** Seed role canonical với ĐÚNG các cặp ma trận hiệu lực cấp (scope theo const) — KHÔNG over/under. */
    async function seedCanonicalRole(companyId: string, role: Role): Promise<string> {
      const roleId = await seedRole(direct, companyId, `qafsm-${role}`);
      for (const [key, scope] of effective[role]) {
        const [action, resource] = key.split(":");
        const permId = await seedPermissionCatalog(
          direct,
          action,
          resource,
          SENSITIVE_PAIRS.has(key),
        );
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      return roleId;
    }

    /** Seed role tùy biến (reader / watch-only) với danh sách cặp tường minh. */
    async function seedCustomRole(
      companyId: string,
      name: string,
      pairs: Array<[action: string, resource: string, scope: Scope]>,
    ): Promise<string> {
      const roleId = await seedRole(direct, companyId, name);
      for (const [action, resource, scope] of pairs) {
        const key = pairKey(action, resource);
        const permId = await seedPermissionCatalog(
          direct,
          action,
          resource,
          SENSITIVE_PAIRS.has(key),
        );
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      return roleId;
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

    // ── Assert helpers (direct SQL) ──────────────────────────────────────────────
    async function taskStatus(id: string): Promise<string | null> {
      const r = await direct.query("SELECT task_status FROM tasks WHERE id=$1", [id]);
      return (r.rows[0]?.task_status as string | null) ?? null;
    }
    async function outboxCount(taskId: string, eventType?: string): Promise<number> {
      const r = eventType
        ? await direct.query(
            "SELECT count(*)::int n FROM outbox_events WHERE payload->>'taskId'=$1 AND event_type=$2",
            [taskId, eventType],
          )
        : await direct.query(
            "SELECT count(*)::int n FROM outbox_events WHERE payload->>'taskId'=$1",
            [taskId],
          );
      return r.rows[0].n as number;
    }
    async function activityCount(taskId: string): Promise<number> {
      const r = await direct.query(
        "SELECT count(*)::int n FROM task_activity_logs WHERE task_id=$1",
        [taskId],
      );
      return r.rows[0].n as number;
    }
    async function lastOutboxPayload(
      taskId: string,
      eventType: string,
    ): Promise<Record<string, unknown> | undefined> {
      const r = await direct.query(
        `SELECT payload FROM outbox_events WHERE payload->>'taskId'=$1 AND event_type=$2
         ORDER BY created_at DESC LIMIT 1`,
        [taskId, eventType],
      );
      return r.rows[0]?.payload as Record<string, unknown> | undefined;
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
      A = await seedCompany(direct, "qafsm");
      companyIds.push(A.companyId);

      const ouEng = await seedOrgUnit(A.companyId, "Engineering");
      const ouSales = await seedOrgUnit(A.companyId, "Sales");

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
      noEmpUser = await seedUser(direct, A.companyId, `noemp@${A.slug}.test`, hash);
      readerUser = await seedUser(direct, A.companyId, `reader@${A.slug}.test`, hash);

      caEmp = await seedEmp(A.companyId, userIdByRole["company-admin"], ouEng, null);
      mgrEmp = await seedEmp(A.companyId, userIdByRole.manager, ouEng, null);
      empEmp = await seedEmp(A.companyId, userIdByRole.employee, ouEng, userIdByRole.manager); // report mgr
      await seedEmp(A.companyId, userIdByRole.hr, ouEng, null);
      outEmp = await seedEmp(A.companyId, outUser, ouSales, null); // ngoài team mgr, ngoài Own emp
      // noEmpUser CỐ Ý không có employee_profiles.

      const lt = await direct.query(
        `INSERT INTO leave_types (company_id, name, code) VALUES ($1,'Annual','AL') RETURNING id`,
        [A.companyId],
      );
      leaveTypeId = lt.rows[0].id as string;

      // Roles: 4 canonical (đúng ma trận) + reader (chỉ read) + watch-only (cho no-employee actor).
      const empRoleId = await seedCanonicalRole(A.companyId, "employee");
      const mgrRoleId = await seedCanonicalRole(A.companyId, "manager");
      const hrRoleId = await seedCanonicalRole(A.companyId, "hr");
      const caRoleId = await seedCanonicalRole(A.companyId, "company-admin");
      const readerRoleId = await seedCustomRole(A.companyId, "qafsm-reader", [
        ["read", "task", "Company"],
      ]);
      const watchOnlyRoleId = await seedCustomRole(A.companyId, "qafsm-watchonly", [
        ["read", "task", "Company"],
        ["watch", "task", "Company"],
      ]);

      await seedUserRole(direct, userIdByRole.employee, empRoleId, A.companyId);
      await seedUserRole(direct, outUser, empRoleId, A.companyId); // outUser = employee-role (read@Own)
      await seedUserRole(direct, userIdByRole.manager, mgrRoleId, A.companyId);
      await seedUserRole(direct, userIdByRole.hr, hrRoleId, A.companyId);
      await seedUserRole(direct, userIdByRole["company-admin"], caRoleId, A.companyId);
      await seedUserRole(direct, readerUser, readerRoleId, A.companyId);
      await seedUserRole(direct, noEmpUser, watchOnlyRoleId, A.companyId);

      tok.emp = await login(A.slug, `emp@${A.slug}.test`);
      tok.mgr = await login(A.slug, `mgr@${A.slug}.test`);
      tok.hr = await login(A.slug, `hr@${A.slug}.test`);
      tok.ca = await login(A.slug, `ca@${A.slug}.test`);
      tok.out = await login(A.slug, `out@${A.slug}.test`);
      tok.noEmp = await login(A.slug, `noemp@${A.slug}.test`);
      tok.reader = await login(A.slug, `reader@${A.slug}.test`);
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
          "leave_requests",
          "leave_types",
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

    // ════════════════════ 1. FSM (SPEC-06 §14.11) ════════════════════
    describe("FSM change-status (crown)", () => {
      it("transition ngoài bảng (Todo→Done · Todo→In Review · In Progress→Todo) → 409 WORKFLOW-INVALID, state giữ, 0 event/activity", async () => {
        const t = await mkTask({ taskStatus: "Todo" });
        const bad = await authPost(tok.ca, `/tasks/${t}/change-status`).send({ status: "Done" });
        expect(bad.status).toBe(409);
        expect(JSON.stringify(bad.body)).toContain("TASK-ERR-WORKFLOW-INVALID");
        expect(await taskStatus(t)).toBe("Todo");
        expect(await outboxCount(t)).toBe(0);
        expect(await activityCount(t)).toBe(0);

        expect(
          (await authPost(tok.ca, `/tasks/${t}/change-status`).send({ status: "In Review" }))
            .status,
        ).toBe(409);
        const t2 = await mkTask({ taskStatus: "In Progress" });
        expect(
          (await authPost(tok.ca, `/tasks/${t2}/change-status`).send({ status: "Todo" })).status,
        ).toBe(409);
        expect(await taskStatus(t2)).toBe("In Progress");
      });

      it("from=Cancelled (terminal) → change-status/assign → 422 TASK-CLOSED, state giữ Cancelled", async () => {
        const t = await mkTask({ taskStatus: "Cancelled" });
        const s = await authPost(tok.ca, `/tasks/${t}/change-status`).send({
          status: "In Progress",
        });
        expect(s.status).toBe(422);
        expect(JSON.stringify(s.body)).toContain("TASK-ERR-TASK-CLOSED");
        expect(
          (await authPost(tok.ca, `/tasks/${t}/assign`).send({ assigneeEmployeeId: mgrEmp }))
            .status,
        ).toBe(422);
        expect(await taskStatus(t)).toBe("Cancelled");
      });

      it("Done khi checklist is_required_for_done chưa tick → 400 CHECKLIST-REQUIRED (state giữ); tick hết → 200", async () => {
        await enableChecklistSetting(A.companyId);
        const t = await mkTask({ taskStatus: "In Progress" });
        const cl = await direct.query(
          `INSERT INTO task_checklists (company_id, task_id, title, is_required_for_done)
           VALUES ($1,$2,'CL',true) RETURNING id`,
          [A.companyId, t],
        );
        const item = await direct.query(
          `INSERT INTO task_checklist_items (company_id, task_id, checklist_id, title, is_done)
           VALUES ($1,$2,$3,'i1',false) RETURNING id`,
          [A.companyId, t, cl.rows[0].id],
        );
        const bad = await authPost(tok.ca, `/tasks/${t}/change-status`).send({ status: "Done" });
        expect(bad.status).toBe(400);
        expect(JSON.stringify(bad.body)).toContain("TASK-ERR-CHECKLIST-REQUIRED");
        expect(await taskStatus(t)).toBe("In Progress");
        // Tick required item → Done 200.
        await direct.query(
          "UPDATE task_checklist_items SET is_done=true, done_at=now() WHERE id=$1",
          [item.rows[0].id],
        );
        expect(
          (await authPost(tok.ca, `/tasks/${t}/change-status`).send({ status: "Done" })).status,
        ).toBe(200);
      });

      it("from===to (In Progress→In Progress) → 200 no-op, 0 event/activity", async () => {
        const t = await mkTask({ taskStatus: "In Progress" });
        const r = await authPost(tok.ca, `/tasks/${t}/change-status`).send({
          status: "In Progress",
        });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(await taskStatus(t)).toBe("In Progress");
        expect(await outboxCount(t)).toBe(0);
        expect(await activityCount(t)).toBe(0);
      });
    });

    // ════════════════════ 2. Kanban move MIRROR change-status ════════════════════
    describe("kanban move (POST /tasks/:id/move)", () => {
      it("thiếu update-status:task (reader) → 403; move dùng CÙNG FSM (transition sai → 409, hợp lệ → 200 + state đổi)", async () => {
        const t = await mkEmpTask({ taskStatus: "Todo" });
        // reader chỉ read:task ⇒ PermissionGuard chặn move (yêu cầu update-status:task) → 403.
        const denied = await authPost(tok.reader, `/tasks/${t}/move`).send({
          status: "In Progress",
        });
        expect(denied.status).toBe(403);
        expect(await taskStatus(t)).toBe("Todo");
        // move ĐI QUA CÙNG FSM: transition sai → 409 (không lách).
        expect((await authPost(tok.ca, `/tasks/${t}/move`).send({ status: "Done" })).status).toBe(
          409,
        );
        expect(await taskStatus(t)).toBe("Todo");
        // move hợp lệ → 200 + state đổi thật.
        const ok = await authPost(tok.ca, `/tasks/${t}/move`).send({ status: "In Progress" });
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
        expect(await taskStatus(t)).toBe("In Progress");
      });
    });

    // ════════════════════ 3. Watcher self-only ════════════════════
    describe("watcher self-only", () => {
      it("add self → 201 Active (employee_id = actor); body non-empty → 400 (strict); duplicate → 409 DUPLICATE-WATCHER", async () => {
        const t = await mkEmpTask({});
        const add = await authPost(tok.emp, `/tasks/${t}/watchers`).send({});
        expect(add.status, JSON.stringify(add.body)).toBe(201);
        const w = await direct.query(
          "SELECT id, employee_id, status FROM task_watchers WHERE task_id=$1 AND deleted_at IS NULL",
          [t],
        );
        expect(w.rows.length).toBe(1);
        expect(w.rows[0].employee_id).toBe(empEmp); // self-only: watcher là chính actor, KHÔNG hộ ai
        expect(w.rows[0].status).toBe("Active");
        // Body non-empty (thử chỉ định người khác) → 400 strict (không có đường add hộ).
        const withBody = await authPost(tok.emp, `/tasks/${t}/watchers`).send({
          employeeId: mgrEmp,
        });
        expect(withBody.status).toBe(400);
        // Trùng → 409.
        const dup = await authPost(tok.emp, `/tasks/${t}/watchers`).send({});
        expect(dup.status).toBe(409);
        expect(JSON.stringify(dup.body)).toContain("TASK-ERR-DUPLICATE-WATCHER");
      });

      it("gỡ watcher của NGƯỜI KHÁC → 404 (self-only, không lộ)", async () => {
        const t = await mkEmpTask({});
        // Seed 1 watcher của mgrEmp (người khác) trên task emp thấy được.
        const other = await direct.query(
          `INSERT INTO task_watchers (company_id, task_id, employee_id, watcher_type, status, added_by, created_by, updated_by)
           VALUES ($1,$2,$3,'Manual','Active',$4,$4,$4) RETURNING id`,
          [A.companyId, t, mgrEmp, userIdByRole.manager],
        );
        const del = await authDelete(tok.emp, `/tasks/${t}/watchers/${other.rows[0].id}`);
        expect(del.status).toBe(404);
        // Watcher người khác VẪN còn (không bị self-only gỡ nhầm).
        const still = await direct.query("SELECT status FROM task_watchers WHERE id=$1", [
          other.rows[0].id,
        ]);
        expect(still.rows[0].status).toBe("Active");
      });

      it("actor KHÔNG có employee_profiles → watch 400 WATCHER-NO-EMPLOYEE (fail-loud, không chèn mù)", async () => {
        const t = await mkTask({}); // noEmp có watch@Company ⇒ tới nhánh service
        const r = await authPost(tok.noEmp, `/tasks/${t}/watchers`).send({});
        expect(r.status).toBe(400);
        expect(JSON.stringify(r.body)).toContain("TASK-ERR-WATCHER-NO-EMPLOYEE");
      });
    });

    // ════════════════════ 4. Comment deny ════════════════════
    describe("comment deny", () => {
      it("thiếu comment:task (reader) → 403", async () => {
        const t = await mkEmpTask({});
        const r = await authPost(tok.reader, `/tasks/${t}/comments`).send({ content: "x" });
        expect(r.status).toBe(403);
      });

      it("comment task NGOÀI scope đọc (employee, task của người khác) → 404 fail-closed (KHÔNG 403)", async () => {
        const foreign = await mkTask({ mainAssigneeEmployeeId: outEmp, assigneeUserId: outUser });
        const r = await authPost(tok.emp, `/tasks/${foreign}/comments`).send({ content: "x" });
        expect(r.status).toBe(404);
        expect(r.status).not.toBe(403);
      });

      it("PATCH/DELETE comment NGƯỜI KHÁC → 403 self-only (author giữ nguyên)", async () => {
        const t = await mkEmpTask({});
        // company-admin tạo comment; employee thấy task (Own) nhưng KHÔNG phải tác giả.
        const created = await authPost(tok.ca, `/tasks/${t}/comments`).send({ content: "by-ca" });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        const commentId = created.body.data.id as string;
        const patch = await authPatch(tok.emp, `/tasks/${t}/comments/${commentId}`).send({
          content: "hijack",
        });
        expect(patch.status).toBe(403);
        const del = await authDelete(tok.emp, `/tasks/${t}/comments/${commentId}`);
        expect(del.status).toBe(403);
        // Comment gốc còn nguyên (không bị sửa/xoá).
        const row = await direct.query("SELECT body, deleted_at FROM task_comments WHERE id=$1", [
          commentId,
        ]);
        expect(row.rows[0].deleted_at).toBeNull();
      });

      it("mention NGOÀI scope (mentioned không tự xem được task) → 403 BLOCK (MENTION-OUT-OF-SCOPE), KHÔNG tạo comment", async () => {
        const t = await mkEmpTask({}); // assigned empEmp (không project) ⇒ outEmp NGOÀI scope đọc của outUser
        const r = await authPost(tok.ca, `/tasks/${t}/comments`).send({
          content: "hey",
          mentionEmployeeIds: [outEmp],
        });
        expect(r.status).toBe(403);
        expect(JSON.stringify(r.body)).toContain("TASK-ERR-MENTION-OUT-OF-SCOPE");
        const cnt = await direct.query(
          "SELECT count(*)::int n FROM task_comments WHERE task_id=$1",
          [t],
        );
        expect(cnt.rows[0].n).toBe(0); // block ⇒ KHÔNG chèn comment
      });
    });

    // ════════════════════ 5. Checklist/item + task-audit-log deny ════════════════════
    describe("checklist mutate + activity view deny", () => {
      it("mutate checklist/item thiếu update:task (reader) → 403", async () => {
        const t = await mkEmpTask({});
        // reader chỉ read:task ⇒ create-checklist (update:task) → 403.
        const cl = await authPost(tok.reader, `/tasks/${t}/checklists`).send({ title: "cl" });
        expect(cl.status).toBe(403);
        // Seed checklist+item để thử PATCH item (cũng update:task) → 403.
        const seeded = await direct.query(
          `INSERT INTO task_checklists (company_id, task_id, title, is_required_for_done)
           VALUES ($1,$2,'CL',false) RETURNING id`,
          [A.companyId, t],
        );
        const item = await direct.query(
          `INSERT INTO task_checklist_items (company_id, task_id, checklist_id, title, is_done)
           VALUES ($1,$2,$3,'i',false) RETURNING id`,
          [A.companyId, t, seeded.rows[0].id],
        );
        const patch = await authPatch(
          tok.reader,
          `/tasks/${t}/checklists/${seeded.rows[0].id}/items/${item.rows[0].id}`,
        ).send({ isDone: true });
        expect(patch.status).toBe(403);
      });

      it("view:task-audit-log: employee/manager thiếu quyền → 403 (TASK-ERR-042); hr/company-admin có → 200", async () => {
        const t = await mkEmpTask({});
        expect((await authGet(tok.emp, `/tasks/${t}/activity`)).status).toBe(403);
        expect((await authGet(tok.mgr, `/tasks/${t}/activity`)).status).toBe(403);
        expect((await authGet(tok.hr, `/tasks/${t}/activity`)).status).toBe(200);
        expect((await authGet(tok.ca, `/tasks/${t}/activity`)).status).toBe(200);
      });
    });

    // ════════════════════ 6. Assign — on-leave warning (không chặn) + out-of-team 404 ════════════════════
    describe("assign warning + scope", () => {
      it("assignee có Approved leave trùm due_at → 200 + warning ON-LEAVE, task VẪN được gán (KHÔNG chặn)", async () => {
        const day = FUTURE.slice(0, 10);
        const t = await mkTask({ dueAt: FUTURE });
        await seedApprovedLeave(A.companyId, userIdByRole.employee, empEmp, day);
        const r = await authPost(tok.ca, `/tasks/${t}/assign`).send({ assigneeEmployeeId: empEmp });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(r.body.data.task.mainAssigneeEmployeeId).toBe(empEmp); // vẫn gán
        const codes = (r.body.data.warnings as Array<{ code: string }>).map((w) => w.code);
        expect(codes).toContain("TASK-WARN-ASSIGNEE-ON-LEAVE");
      });

      it("manager assign trên task NGOÀI Team (assigned outEmp) → 404 fail-closed (KHÔNG 403)", async () => {
        const foreign = await mkTask({ mainAssigneeEmployeeId: outEmp, assigneeUserId: outUser });
        const r = await authPost(tok.mgr, `/tasks/${foreign}/assign`).send({
          assigneeEmployeeId: empEmp,
        });
        expect(r.status).toBe(404);
        expect(r.status).not.toBe(403);
      });
    });

    // ════════════════════ 7. Actor-exclusion (outbox payload — KHÔNG e2e NOTI) ════════════════════
    describe("actor-exclusion (self-action không tự sinh recipient cho actor)", () => {
      it("self-assign: company-admin gán CHÍNH mình → outbox actorUserId === assigneeUserId (consumer loại actor ⇒ recipient rỗng)", async () => {
        const t = await mkTask({}); // chưa có assignee ⇒ assign lần đầu phát task.assigned
        const r = await authPost(tok.ca, `/tasks/${t}/assign`).send({ assigneeEmployeeId: caEmp });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        const p = await lastOutboxPayload(t, "task.assigned");
        expect(p?.actorUserId).toBe(userIdByRole["company-admin"]);
        expect(p?.assigneeUserId).toBe(userIdByRole["company-admin"]);
      });

      it("self-comment: actor bình luận task DO MÌNH tạo + tự nhận → outbox actorUserId === creatorUserId, assigneeEmployeeId = actor emp", async () => {
        const t = await mkTask({
          mainAssigneeEmployeeId: caEmp,
          assigneeUserId: userIdByRole["company-admin"],
          creatorUserId: userIdByRole["company-admin"],
        });
        const r = await authPost(tok.ca, `/tasks/${t}/comments`).send({ content: "self note" });
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        const p = await lastOutboxPayload(t, "task.comment_created");
        expect(p?.actorUserId).toBe(userIdByRole["company-admin"]);
        expect(p?.creatorUserId).toBe(userIdByRole["company-admin"]);
        expect(p?.assigneeEmployeeId).toBe(caEmp);
      });
    });
  },
);
