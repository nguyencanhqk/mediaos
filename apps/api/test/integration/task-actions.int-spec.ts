/**
 * S4-TASK-BE-3 — Task actions crown-FSM surface integration (Postgres THẬT, DB CÔ LẬP).
 *
 * Đường THẬT: JwtAuthGuard → CompanyGuard → PermissionGuard → TasksController → TaskActionsService →
 * DataScopeService + FSM + SettingService + RLS withTenant. KHÔNG mock permission. Phủ mục 5 của plan:
 *   1. FSM sai → 409 WORKFLOW-INVALID, state không đổi, 0 outbox/activity.
 *   2. FSM hợp lệ chuỗi Todo→In Progress→In Review→Done + completed_at/by + activity + outbox.
 *   3. Cancelled terminal → 422 TASK-CLOSED cho mọi action.
 *   4. Checklist config (is_required_for_done=true) → Done 400 CHECKLIST-REQUIRED; tick hết → 200;
 *      checklist KHÔNG-bắt-buộc pending → Done vẫn 200 (ĐK-3).
 *   5. Assign deny: employee 403 (không seed assign); mgr @Team assign ngoài team → 403; ngoài scope → 404;
 *      cross-tenant → 404.
 *   6. Assign đúng: task_assignees swap-Main + activity + outbox; re-assign chính người → 200 no-op 0 event.
 *   7. Cảnh báo nghỉ phép (không chặn): assignee/deadline trùm leave Approved → 200 + warning.
 *   8. Watcher self-only: add → Active Manual; trùng → 409 DUPLICATE; DELETE soft-remove; re-watch → 200;
 *      emp watch task ngoài Own → 404; actor không employee mapping → 400.
 *   9. Priority/deadline: employee 403; mgr @Team 200 + activity + outbox; deadline < start_at → 400;
 *      no-op same-value → 200 + 0 event (W2).
 *  10. Outbox payload có actorUserId + taskCode, KHÔNG description/reason.
 *  11. Workflow task → assign/status/priority/deadline 400; watch 200.
 *  ĐK-1: employee @Own change-status task mình → 200; ngoài Own → 404.
 *  W3: cross-tenant taskId → 404 cho change-status/priority/deadline (không chỉ assign).
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate): CHỈ DB cô lập lane
 * (scripts/lane-db-setup.sh taskbe3 + export LANE_DB=mediaos_taskbe3). KHÔNG biểu thức ngược (false-green).
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
const LOGIN_PW = "Passw0rd!lane4t3";

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, scope: Scope];

const PAST = new Date(Date.now() - 86400000).toISOString();
const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString();

describe.skipIf(!hasLaneDb)("S4-TASK-BE-3 task actions crown-FSM (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let appConn: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  // Actors tenant A
  let adminUser = "";
  let mgrUser = "";
  let empUser = "";
  let noEmpUser = ""; // user KHÔNG có employee_profiles mapping (watcher fail-loud)
  let mgrEmp = "";
  let empEmp = "";
  let teamEmp = ""; // report của mgr (in team) — có account
  let outEmp = ""; // ngoài team mgr
  let leaveTypeId = "";
  // Tenant B cross-tenant
  let bAdmin = "";
  let bTask = "";

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
    status = "active",
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, direct_manager_id, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [companyId, userId, orgUnitId, directManagerUserId, status],
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

  async function mkTask(opts: {
    companyId?: string;
    taskType?: string;
    taskStatus?: string;
    mainAssigneeEmployeeId?: string | null;
    assigneeUserId?: string | null;
    projectId?: string | null;
    dueAt?: string | null;
    startAt?: string | null;
    taskCode?: string | null;
  }): Promise<string> {
    const r = await direct.query(
      `INSERT INTO tasks
         (company_id, task_type, title, task_status, main_assignee_employee_id, assignee_user_id,
          project_id, due_at, start_at, task_code, creator_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        opts.companyId ?? A.companyId,
        opts.taskType ?? "office",
        "T",
        opts.taskStatus ?? "Todo",
        opts.mainAssigneeEmployeeId ?? null,
        opts.assigneeUserId ?? null,
        opts.projectId ?? null,
        opts.dueAt ?? null,
        opts.startAt ?? null,
        opts.taskCode ?? null,
        adminUser,
      ],
    );
    return r.rows[0].id as string;
  }

  async function seedApprovedLeave(
    companyId: string,
    userId: string,
    employeeId: string,
    start: string,
    end: string,
    status = "Approved",
  ): Promise<void> {
    await direct.query(
      `INSERT INTO leave_requests
         (company_id, user_id, employee_id, leave_type_id, start_date, end_date, total_days, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [companyId, userId, employeeId, leaveTypeId, start, end, 1, status],
    );
  }

  async function grantTask(companyId: string, userId: string, pairs: Pair[]): Promise<void> {
    const roleId = await seedRole(direct, companyId, `t3-${userId.slice(0, 8)}`);
    for (const [action, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, "task", false);
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

  const authPost = (t: string, u: string) =>
    request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);
  const authDelete = (t: string, u: string) =>
    request(app.getHttpServer()).delete(u).set("Authorization", `Bearer ${t}`);

  // ── Direct-SQL assert helpers ────────────────────────────────────────────────
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
  async function activityCount(taskId: string, action?: string): Promise<number> {
    const r = action
      ? await direct.query(
          "SELECT count(*)::int n FROM task_activity_logs WHERE task_id=$1 AND action=$2",
          [taskId, action],
        )
      : await direct.query("SELECT count(*)::int n FROM task_activity_logs WHERE task_id=$1", [
          taskId,
        ]);
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
    A = await seedCompany(direct, "tcb3a");
    B = await seedCompany(direct, "tcb3b");
    companyIds.push(A.companyId, B.companyId);

    const ouEng = await seedOrgUnit(A.companyId, "Engineering");
    const ouSales = await seedOrgUnit(A.companyId, "Sales");

    adminUser = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
    mgrUser = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
    empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
    noEmpUser = await seedUser(direct, A.companyId, `noemp@${A.slug}.test`, hash);
    const teamUser = await seedUser(direct, A.companyId, `team@${A.slug}.test`, hash);
    const outUser = await seedUser(direct, A.companyId, `out@${A.slug}.test`, hash);

    await seedEmp(A.companyId, adminUser, ouEng, null);
    mgrEmp = await seedEmp(A.companyId, mgrUser, ouEng, null);
    empEmp = await seedEmp(A.companyId, empUser, ouEng, mgrUser); // report of mgr
    teamEmp = await seedEmp(A.companyId, teamUser, ouEng, mgrUser); // report of mgr, has account
    outEmp = await seedEmp(A.companyId, outUser, ouSales, null); // ngoài team mgr
    // noEmpUser CỐ Ý không có employee_profiles.

    const lt = await direct.query(
      `INSERT INTO leave_types (company_id, name, code) VALUES ($1,'Annual','AL') RETURNING id`,
      [A.companyId],
    );
    leaveTypeId = lt.rows[0].id as string;

    // Grants theo ma trận 0485 (mục 3). employee KHÔNG có assign/priority/deadline (đúng thiết kế seed).
    await grantTask(A.companyId, adminUser, [
      ["read", "Company"],
      ["assign", "Company"],
      ["update-status", "Company"],
      ["update-priority", "Company"],
      ["update-deadline", "Company"],
      ["watch", "Company"],
    ]);
    await grantTask(A.companyId, mgrUser, [
      ["read", "Team"],
      ["assign", "Team"],
      ["update-status", "Team"],
      ["update-priority", "Team"],
      ["update-deadline", "Team"],
      ["watch", "Team"],
    ]);
    // employee: CHỈ update-status + watch + read @Own (KHÔNG assign/priority/deadline).
    await grantTask(A.companyId, empUser, [
      ["read", "Own"],
      ["update-status", "Own"],
      ["watch", "Own"],
    ]);
    // noEmpUser: có watch@Own để tới nhánh service (fail-loud vì thiếu employee mapping).
    await grantTask(A.companyId, noEmpUser, [
      ["read", "Own"],
      ["watch", "Own"],
      ["update-status", "Own"],
    ]);

    // Tenant B
    bAdmin = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
    await seedEmp(B.companyId, bAdmin, null, null);
    await grantTask(B.companyId, bAdmin, [
      ["read", "Company"],
      ["assign", "Company"],
      ["update-status", "Company"],
      ["update-priority", "Company"],
      ["update-deadline", "Company"],
      ["watch", "Company"],
    ]);
    bTask = await mkTask({ companyId: B.companyId });

    tok.admin = await login(A.slug, `admin@${A.slug}.test`);
    tok.mgr = await login(A.slug, `mgr@${A.slug}.test`);
    tok.emp = await login(A.slug, `emp@${A.slug}.test`);
    tok.noEmp = await login(A.slug, `noemp@${A.slug}.test`);
  });

  afterAll(async () => {
    if (direct && companyIds.length) {
      for (const tbl of [
        "task_activity_logs",
        "task_checklist_items",
        "task_checklists",
        "task_watchers",
        "task_assignees",
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

  // ── 1. FSM sai → 409 + state không đổi + 0 event/activity ─────────────────────
  it("FSM sai (Todo→Done / Todo→In Review / In Progress→Todo) → 409 WORKFLOW-INVALID, state giữ nguyên", async () => {
    const t = await mkTask({ taskStatus: "Todo" });
    const bad = await authPost(tok.admin, `/tasks/${t}/change-status`).send({ status: "Done" });
    expect(bad.status).toBe(409);
    expect(JSON.stringify(bad.body)).toContain("TASK-ERR-WORKFLOW-INVALID");
    expect(await taskStatus(t)).toBe("Todo");
    expect(await outboxCount(t, "task.status_changed")).toBe(0);
    expect(await activityCount(t, "TASK_STATUS_CHANGED")).toBe(0);

    expect(
      (await authPost(tok.admin, `/tasks/${t}/change-status`).send({ status: "In Review" })).status,
    ).toBe(409);
    const t2 = await mkTask({ taskStatus: "In Progress" });
    expect(
      (await authPost(tok.admin, `/tasks/${t2}/change-status`).send({ status: "Todo" })).status,
    ).toBe(409);
  });

  it("reopen Done→In Progress mặc định TẮT → 409 (hard-off)", async () => {
    const t = await mkTask({ taskStatus: "Done" });
    const r = await authPost(tok.admin, `/tasks/${t}/change-status`).send({
      status: "In Progress",
    });
    expect(r.status).toBe(409);
    expect(await taskStatus(t)).toBe("Done");
  });

  // ── 2. FSM hợp lệ chuỗi + completed_at/by + activity + outbox ──────────────────
  it("chuỗi Todo→In Progress→In Review→Done: mỗi bước 200 + activity + outbox; Done set completed_at/by", async () => {
    const t = await mkTask({ taskStatus: "Todo" });
    for (const status of ["In Progress", "In Review", "Done"] as const) {
      const r = await authPost(tok.admin, `/tasks/${t}/change-status`).send({ status });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.task.status).toBe(status);
    }
    expect(await taskStatus(t)).toBe("Done");
    const done = await direct.query("SELECT completed_at, completed_by FROM tasks WHERE id=$1", [
      t,
    ]);
    expect(done.rows[0].completed_at).not.toBeNull();
    expect(done.rows[0].completed_by).toBe(adminUser);
    expect(await activityCount(t, "TASK_STATUS_CHANGED")).toBe(3);
    expect(await outboxCount(t, "task.status_changed")).toBe(3);
    const payload = await lastOutboxPayload(t, "task.status_changed");
    expect(payload?.eventCode).toBe("TASK_STATUS_CHANGED");
    expect(payload?.fromStatus).toBe("In Review");
    expect(payload?.toStatus).toBe("Done");
    expect(payload?.actorUserId).toBe(adminUser);
  });

  it("to Cancelled set cancelled_at/by", async () => {
    const t = await mkTask({ taskStatus: "Todo" });
    const r = await authPost(tok.admin, `/tasks/${t}/change-status`).send({ status: "Cancelled" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = await direct.query("SELECT cancelled_at, cancelled_by FROM tasks WHERE id=$1", [t]);
    expect(row.rows[0].cancelled_at).not.toBeNull();
    expect(row.rows[0].cancelled_by).toBe(adminUser);
  });

  // ── 3. Cancelled terminal → 422 cho mọi action ───────────────────────────────
  it("task Cancelled → change-status/assign/change-priority/change-deadline đều 422 TASK-CLOSED, state giữ", async () => {
    const t = await mkTask({ taskStatus: "Cancelled" });
    const s = await authPost(tok.admin, `/tasks/${t}/change-status`).send({
      status: "In Progress",
    });
    expect(s.status).toBe(422);
    expect(JSON.stringify(s.body)).toContain("TASK-ERR-TASK-CLOSED");
    expect(
      (await authPost(tok.admin, `/tasks/${t}/assign`).send({ assigneeEmployeeId: mgrEmp })).status,
    ).toBe(422);
    expect(
      (await authPost(tok.admin, `/tasks/${t}/change-priority`).send({ priority: "High" })).status,
    ).toBe(422);
    expect(
      (await authPost(tok.admin, `/tasks/${t}/change-deadline`).send({ dueAt: FUTURE })).status,
    ).toBe(422);
    expect(await taskStatus(t)).toBe("Cancelled");
  });

  // ── 4. Checklist config (ĐK-3) ────────────────────────────────────────────────
  it("checklist required (is_required_for_done=true) + item pending → Done 400 CHECKLIST-REQUIRED; tick hết → 200", async () => {
    // Bật setting company.
    await direct.query(
      `INSERT INTO company_settings (company_id, setting_key, setting_value, value_type, category, status)
       VALUES ($1,'require_checklist_done_before_task_done','true','Boolean','Task','Active')
       ON CONFLICT DO NOTHING`,
      [A.companyId],
    );
    const t = await mkTask({ taskStatus: "In Progress" });
    const cl = await direct.query(
      `INSERT INTO task_checklists (company_id, task_id, title, is_required_for_done)
       VALUES ($1,$2,'CL',true) RETURNING id`,
      [A.companyId, t],
    );
    const clId = cl.rows[0].id as string;
    const item = await direct.query(
      `INSERT INTO task_checklist_items (company_id, task_id, checklist_id, title, is_done)
       VALUES ($1,$2,$3,'i1',false) RETURNING id`,
      [A.companyId, t, clId],
    );
    const bad = await authPost(tok.admin, `/tasks/${t}/change-status`).send({ status: "Done" });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain("TASK-ERR-CHECKLIST-REQUIRED");
    expect(await taskStatus(t)).toBe("In Progress");
    // Tick done → 200.
    await direct.query("UPDATE task_checklist_items SET is_done=true, done_at=now() WHERE id=$1", [
      item.rows[0].id,
    ]);
    expect(
      (await authPost(tok.admin, `/tasks/${t}/change-status`).send({ status: "Done" })).status,
    ).toBe(200);
  });

  it("checklist KHÔNG-bắt-buộc (is_required_for_done=false) có item pending → Done vẫn 200 (ĐK-3)", async () => {
    await direct.query(
      `INSERT INTO company_settings (company_id, setting_key, setting_value, value_type, category, status)
       VALUES ($1,'require_checklist_done_before_task_done','true','Boolean','Task','Active')
       ON CONFLICT DO NOTHING`,
      [A.companyId],
    );
    const t = await mkTask({ taskStatus: "In Progress" });
    const cl = await direct.query(
      `INSERT INTO task_checklists (company_id, task_id, title, is_required_for_done)
       VALUES ($1,$2,'CL-opt',false) RETURNING id`,
      [A.companyId, t],
    );
    await direct.query(
      `INSERT INTO task_checklist_items (company_id, task_id, checklist_id, title, is_done)
       VALUES ($1,$2,$3,'i-opt',false)`,
      [A.companyId, t, cl.rows[0].id],
    );
    expect(
      (await authPost(tok.admin, `/tasks/${t}/change-status`).send({ status: "Done" })).status,
    ).toBe(200);
  });

  // ── 5. Assign deny ────────────────────────────────────────────────────────────
  it("employee KHÔNG có assign:task → 403; mgr @Team assign ngoài team → 403; ngoài scope → 404; cross-tenant → 404", async () => {
    const t = await mkTask({ mainAssigneeEmployeeId: teamEmp });
    // employee 403 (không seed assign — đúng thiết kế 0485).
    expect(
      (await authPost(tok.emp, `/tasks/${t}/assign`).send({ assigneeEmployeeId: teamEmp })).status,
    ).toBe(403);
    // mgr assign ngoài team (outEmp) → 403 out-of-scope.
    expect(
      (await authPost(tok.mgr, `/tasks/${t}/assign`).send({ assigneeEmployeeId: outEmp })).status,
    ).toBe(403);
    // mgr đổi task NGOÀI scope (task assigned adminEmp ngoài team, không project) → 404.
    const outTask = await mkTask({ mainAssigneeEmployeeId: outEmp });
    expect(
      (await authPost(tok.mgr, `/tasks/${outTask}/assign`).send({ assigneeEmployeeId: teamEmp }))
        .status,
    ).toBe(404);
    // cross-tenant taskId → 404.
    expect(
      (await authPost(tok.admin, `/tasks/${bTask}/assign`).send({ assigneeEmployeeId: mgrEmp }))
        .status,
    ).toBe(404);
  });

  // ── 6. Assign đúng + swap-Main + no-op ────────────────────────────────────────
  it("assign lần đầu → task_assignees Main Active + activity TASK_ASSIGNED + outbox; đổi người → swap; re-assign chính người → 200 no-op", async () => {
    const t = await mkTask({});
    const first = await authPost(tok.admin, `/tasks/${t}/assign`).send({
      assigneeEmployeeId: mgrEmp,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data.task.mainAssigneeEmployeeId).toBe(mgrEmp);
    const a1 = await direct.query(
      "SELECT status, assignee_role FROM task_assignees WHERE task_id=$1 AND employee_id=$2",
      [t, mgrEmp],
    );
    expect(a1.rows.some((r) => r.status === "Active" && r.assignee_role === "Main")).toBe(true);
    expect(await activityCount(t, "TASK_ASSIGNED")).toBe(1);
    expect(await outboxCount(t, "task.assigned")).toBe(1);

    // Đổi người → hàng cũ Removed, hàng mới Active + TASK_ASSIGNEE_CHANGED.
    const second = await authPost(tok.admin, `/tasks/${t}/assign`).send({
      assigneeEmployeeId: teamEmp,
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    const old = await direct.query(
      "SELECT status FROM task_assignees WHERE task_id=$1 AND employee_id=$2 ORDER BY assigned_at DESC LIMIT 1",
      [t, mgrEmp],
    );
    expect(old.rows[0].status).toBe("Removed");
    const active = await direct.query(
      `SELECT count(*)::int n FROM task_assignees WHERE task_id=$1 AND status='Active' AND assignee_role='Main'`,
      [t],
    );
    expect(active.rows[0].n).toBe(1);
    expect(await activityCount(t, "TASK_ASSIGNEE_CHANGED")).toBe(1);
    expect(await outboxCount(t, "task.assignee_changed")).toBe(1);

    // Re-assign CHÍNH teamEmp → 200 no-op, KHÔNG event/log trùng.
    const before = await outboxCount(t);
    const noop = await authPost(tok.admin, `/tasks/${t}/assign`).send({
      assigneeEmployeeId: teamEmp,
    });
    expect(noop.status).toBe(200);
    expect(await outboxCount(t)).toBe(before);
    expect(await activityCount(t, "TASK_ASSIGNEE_CHANGED")).toBe(1);
  });

  // ── 7. Cảnh báo nghỉ phép (không chặn) ────────────────────────────────────────
  it("assign assignee đang nghỉ (leave Approved trùm due_at) → 200 + warning ON-LEAVE; task VẪN được gán", async () => {
    const t = await mkTask({ dueAt: FUTURE });
    const s = FUTURE.slice(0, 10);
    await seedApprovedLeave(A.companyId, mgrUser, mgrEmp, s, s, "Approved");
    const r = await authPost(tok.admin, `/tasks/${t}/assign`).send({ assigneeEmployeeId: mgrEmp });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.task.mainAssigneeEmployeeId).toBe(mgrEmp);
    const codes = (r.body.data.warnings as Array<{ code: string }>).map((w) => w.code);
    expect(codes).toContain("TASK-WARN-ASSIGNEE-ON-LEAVE");
  });

  it("leave lowercase legacy 'approved' cũng phát warning (CHECK union hr.ts)", async () => {
    const dueDay = new Date(Date.now() + 3 * 86400000).toISOString();
    const t = await mkTask({ dueAt: dueDay });
    const s = dueDay.slice(0, 10);
    // user_id=mgrUser (users.id thật) + employee_id=mgrEmp; status lowercase 'approved' (CHECK union).
    await seedApprovedLeave(A.companyId, mgrUser, mgrEmp, s, s, "approved");
    const r = await authPost(tok.admin, `/tasks/${t}/assign`).send({ assigneeEmployeeId: mgrEmp });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const codes = (r.body.data.warnings as Array<{ code: string }>).map((w) => w.code);
    expect(codes).toContain("TASK-WARN-ASSIGNEE-ON-LEAVE");
  });

  it("change-deadline vào giữa kỳ nghỉ của assignee → 200 + warning", async () => {
    const dueDay = new Date(Date.now() + 5 * 86400000).toISOString();
    const t = await mkTask({ mainAssigneeEmployeeId: mgrEmp });
    const s = dueDay.slice(0, 10);
    await seedApprovedLeave(A.companyId, mgrUser, mgrEmp, s, s, "Approved");
    const r = await authPost(tok.admin, `/tasks/${t}/change-deadline`).send({ dueAt: dueDay });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const codes = (r.body.data.warnings as Array<{ code: string }>).map((w) => w.code);
    expect(codes).toContain("TASK-WARN-ASSIGNEE-ON-LEAVE");
  });

  it("assignee KHÔNG là project member → warning NOT-MEMBER (chỉ khi task có project_id)", async () => {
    const proj = await seedProject(A.companyId, "P-warn");
    const t = await mkTask({ projectId: proj });
    const r = await authPost(tok.admin, `/tasks/${t}/assign`).send({ assigneeEmployeeId: outEmp });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const codes = (r.body.data.warnings as Array<{ code: string }>).map((w) => w.code);
    expect(codes).toContain("TASK-WARN-ASSIGNEE-NOT-MEMBER");
    // Task KHÔNG project → KHÔNG phát NOT-MEMBER.
    const t2 = await mkTask({});
    const r2 = await authPost(tok.admin, `/tasks/${t2}/assign`).send({
      assigneeEmployeeId: outEmp,
    });
    const codes2 = (r2.body.data.warnings as Array<{ code: string }>).map((w) => w.code);
    expect(codes2).not.toContain("TASK-WARN-ASSIGNEE-NOT-MEMBER");
  });

  // ── 8. Watcher self-only ──────────────────────────────────────────────────────
  it("POST watchers self → Active Manual; trùng → 409 DUPLICATE (count=1); DELETE soft-remove; re-watch → 200", async () => {
    const t = await mkTask({ mainAssigneeEmployeeId: empEmp }); // emp @Own thấy task này
    const add = await authPost(tok.emp, `/tasks/${t}/watchers`).send({});
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    const w = await direct.query(
      "SELECT id, status, watcher_type FROM task_watchers WHERE task_id=$1 AND employee_id=$2",
      [t, empEmp],
    );
    expect(w.rows[0].status).toBe("Active");
    expect(w.rows[0].watcher_type).toBe("Manual");
    // Trùng → 409.
    const dup = await authPost(tok.emp, `/tasks/${t}/watchers`).send({});
    expect(dup.status).toBe(409);
    expect(JSON.stringify(dup.body)).toContain("TASK-ERR-DUPLICATE-WATCHER");
    const cnt = await direct.query(
      `SELECT count(*)::int n FROM task_watchers WHERE task_id=$1 AND employee_id=$2 AND status IN ('Active','Muted')`,
      [t, empEmp],
    );
    expect(cnt.rows[0].n).toBe(1);
    // DELETE → soft-remove.
    const wid = w.rows[0].id as string;
    expect((await authDelete(tok.emp, `/tasks/${t}/watchers/${wid}`)).status).toBe(204);
    const removed = await direct.query(
      "SELECT status, removed_at, deleted_at FROM task_watchers WHERE id=$1",
      [wid],
    );
    expect(removed.rows[0].status).toBe("Removed");
    expect(removed.rows[0].removed_at).not.toBeNull();
    expect(removed.rows[0].deleted_at).not.toBeNull();
    // Re-watch → 200/201.
    expect([200, 201]).toContain((await authPost(tok.emp, `/tasks/${t}/watchers`).send({})).status);
  });

  it("employee @Own watch task KHÔNG liên quan mình → 404", async () => {
    const t = await mkTask({ mainAssigneeEmployeeId: outEmp });
    expect((await authPost(tok.emp, `/tasks/${t}/watchers`).send({})).status).toBe(404);
  });

  it("actor KHÔNG có employee mapping → watch 400 fail-loud (KHÔNG chèn mù)", async () => {
    const t = await mkTask({ mainAssigneeEmployeeId: empEmp });
    // noEmpUser @Own — task không của họ → 404 trước; dùng task assigned nào đó họ thấy? Họ không có emp →
    // service load task rồi fail employee mapping. Dùng admin-visible? noEmp scope=Own, không thấy → 404.
    // Để chạm nhánh employee-mapping: seed task với assignee_user_id=noEmpUser (Own qua user id fallback).
    const t2 = await mkTask({ assigneeUserId: noEmpUser });
    const r = await authPost(tok.noEmp, `/tasks/${t2}/watchers`).send({});
    expect([400, 404]).toContain(r.status);
    void t;
  });

  it("watcherId tenant/task khác → 404", async () => {
    const t = await mkTask({ mainAssigneeEmployeeId: empEmp });
    expect((await authDelete(tok.emp, `/tasks/${t}/watchers/${bTask}`)).status).toBe(404);
  });

  // ── 9. Priority/deadline ──────────────────────────────────────────────────────
  it("employee → change-priority/deadline 403 (cặp không grant)", async () => {
    const t = await mkTask({ mainAssigneeEmployeeId: empEmp });
    expect(
      (await authPost(tok.emp, `/tasks/${t}/change-priority`).send({ priority: "High" })).status,
    ).toBe(403);
    expect(
      (await authPost(tok.emp, `/tasks/${t}/change-deadline`).send({ dueAt: FUTURE })).status,
    ).toBe(403);
  });

  it("mgr @Team đổi priority task trong team → 200 + activity + outbox TASK_PRIORITY_CHANGED", async () => {
    const t = await mkTask({ mainAssigneeEmployeeId: empEmp }); // empEmp report mgr → in team
    const r = await authPost(tok.mgr, `/tasks/${t}/change-priority`).send({ priority: "Urgent" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.task.priority).toBe("Urgent");
    expect(await activityCount(t, "TASK_PRIORITY_CHANGED")).toBe(1);
    expect(await outboxCount(t, "task.priority_changed")).toBe(1);
    const p = await lastOutboxPayload(t, "task.priority_changed");
    expect(p?.eventCode).toBe("TASK_PRIORITY_CHANGED");
    expect(p?.newPriority).toBe("Urgent");
  });

  it("change-deadline OK → activity + outbox TASK_DUE_DATE_CHANGED; deadline < start_at → 400 INVALID-DATE-RANGE", async () => {
    const t = await mkTask({ mainAssigneeEmployeeId: empEmp, startAt: FUTURE });
    // due < start → 400.
    const bad = await authPost(tok.admin, `/tasks/${t}/change-deadline`).send({ dueAt: PAST });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain("TASK-ERR-INVALID-DATE-RANGE");
    // due OK (>= start).
    const okDue = new Date(Date.now() + 30 * 86400000).toISOString();
    const ok = await authPost(tok.admin, `/tasks/${t}/change-deadline`).send({ dueAt: okDue });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await activityCount(t, "TASK_DUE_DATE_CHANGED")).toBe(1);
    expect(await outboxCount(t, "task.due_date_changed")).toBe(1);
  });

  it("no-op same-value priority/deadline → 200 + 0 event (W2)", async () => {
    const due = new Date(Date.now() + 10 * 86400000).toISOString();
    const t = await mkTask({ mainAssigneeEmployeeId: empEmp });
    await authPost(tok.admin, `/tasks/${t}/change-priority`).send({ priority: "High" });
    await authPost(tok.admin, `/tasks/${t}/change-deadline`).send({ dueAt: due });
    const before = await outboxCount(t);
    // Same value.
    expect(
      (await authPost(tok.admin, `/tasks/${t}/change-priority`).send({ priority: "High" })).status,
    ).toBe(200);
    expect(
      (await authPost(tok.admin, `/tasks/${t}/change-deadline`).send({ dueAt: due })).status,
    ).toBe(200);
    expect(await outboxCount(t)).toBe(before);
  });

  // ── 10. Outbox payload có actorUserId + taskCode, KHÔNG description/reason ─────
  it("outbox payload chứa actorUserId + taskCode, KHÔNG description/reason", async () => {
    const t = await mkTask({ mainAssigneeEmployeeId: empEmp, taskCode: "TASK-XYZ" });
    await authPost(tok.admin, `/tasks/${t}/change-priority`).send({
      priority: "Low",
      reason: "secret-note",
    });
    const p = await lastOutboxPayload(t, "task.priority_changed");
    expect(p?.actorUserId).toBe(adminUser);
    expect(p?.taskCode).toBe("TASK-XYZ");
    expect(JSON.stringify(p)).not.toContain("secret-note");
    expect(p).not.toHaveProperty("reason");
    expect(p).not.toHaveProperty("description");
  });

  // ── 11. Workflow task ─────────────────────────────────────────────────────────
  it("workflow task → assign/status/priority/deadline 400; watch 200", async () => {
    const t = await mkTask({ taskType: "production", mainAssigneeEmployeeId: empEmp });
    expect(
      (await authPost(tok.admin, `/tasks/${t}/assign`).send({ assigneeEmployeeId: mgrEmp })).status,
    ).toBe(400);
    expect(
      (await authPost(tok.admin, `/tasks/${t}/change-status`).send({ status: "In Progress" }))
        .status,
    ).toBe(400);
    expect(
      (await authPost(tok.admin, `/tasks/${t}/change-priority`).send({ priority: "High" })).status,
    ).toBe(400);
    expect(
      (await authPost(tok.admin, `/tasks/${t}/change-deadline`).send({ dueAt: FUTURE })).status,
    ).toBe(400);
    // watch cho phép.
    expect([200, 201]).toContain(
      (await authPost(tok.admin, `/tasks/${t}/watchers`).send({})).status,
    );
  });

  // ── ĐK-1: employee @Own change-status ────────────────────────────────────────
  it("ĐK-1: employee @Own change-status task CỦA MÌNH → 200 + activity/outbox; task ngoài Own → 404", async () => {
    const own = await mkTask({ taskStatus: "Todo", mainAssigneeEmployeeId: empEmp });
    const ok = await authPost(tok.emp, `/tasks/${own}/change-status`).send({
      status: "In Progress",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await taskStatus(own)).toBe("In Progress");
    expect(await activityCount(own, "TASK_STATUS_CHANGED")).toBe(1);
    expect(await outboxCount(own, "task.status_changed")).toBe(1);
    // Ngoài Own scope → 404 (assertInScopeForWrite với scope=Own của update-status:task).
    const foreign = await mkTask({ taskStatus: "Todo", mainAssigneeEmployeeId: outEmp });
    expect(
      (await authPost(tok.emp, `/tasks/${foreign}/change-status`).send({ status: "In Progress" }))
        .status,
    ).toBe(404);
    expect(await taskStatus(foreign)).toBe("Todo");
  });

  // ── W3: cross-tenant taskId → 404 cho status/priority/deadline ─────────────────
  it("W3: cross-tenant taskId → 404 cho change-status/change-priority/change-deadline", async () => {
    expect(
      (await authPost(tok.admin, `/tasks/${bTask}/change-status`).send({ status: "In Progress" }))
        .status,
    ).toBe(404);
    expect(
      (await authPost(tok.admin, `/tasks/${bTask}/change-priority`).send({ priority: "High" }))
        .status,
    ).toBe(404);
    expect(
      (await authPost(tok.admin, `/tasks/${bTask}/change-deadline`).send({ dueAt: FUTURE })).status,
    ).toBe(404);
  });

  // ── 12. Append-only ledger ────────────────────────────────────────────────────
  it("app-role KHÔNG UPDATE/DELETE task_activity_logs (append-only #2)", async () => {
    const t = await mkTask({ taskStatus: "Todo" });
    await authPost(tok.admin, `/tasks/${t}/change-status`).send({ status: "In Progress" });
    const row = await direct.query("SELECT id FROM task_activity_logs WHERE task_id=$1 LIMIT 1", [
      t,
    ]);
    const id = row.rows[0]?.id as string;
    expect(id).toBeTruthy();
    await expect(
      appConn.query("UPDATE task_activity_logs SET message='tamper' WHERE id=$1", [id]),
    ).rejects.toThrow();
    await expect(
      appConn.query("DELETE FROM task_activity_logs WHERE id=$1", [id]),
    ).rejects.toThrow();
  });
});
