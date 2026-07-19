/**
 * S5-TASK-PIPELINE-1 (lane be-write) — POST /tasks/:id/move-state (TASK-API-213) + đường ghi stateId
 * qua POST /tasks & PATCH /tasks/:id (method dùng chung — plan 3b/3c, API-06 §15.2/§26.2#12-15).
 * Postgres THẬT, DB CÔ LẬP. Đường THẬT: JwtAuthGuard → CompanyGuard → PermissionGuard →
 * TasksController → TaskCoreService(+TaskActionsService.changeStatusTx) + DataScope + RLS withTenant.
 *
 * Phủ testTasks plan rev 8 (deny-path RED trước):
 *   1. Thiếu update-state:task (dù CÓ update-status) ⇒ 403 — pair MỚI thật sự gate, không lọt qua status.
 *   2. update-state@Own kéo thẻ người khác ⇒ 404, state nguyên vẹn.
 *   3. stateId không tồn tại ⇒ 404 STATE-NOT-FOUND; thuộc project khác ⇒ 400 STATE-INVALID;
 *      cross-tenant (state công ty B) ⇒ 404 y hệt không-tồn-tại (RLS không rò); task không project ⇒ 400.
 *   4. Task workflow-driven ⇒ 400 (không lách FSM studio qua đường mới).
 *   5. BYPASS QUYỀN (quan trọng nhất): CÓ update-state THIẾU update-status — (a) kéo KHÁC nhóm ⇒ 403
 *      VÀ state_id KHÔNG đổi (atomic, không đổi-cột-rồi-mới-403); (b) kéo CÙNG nhóm ⇒ 200.
 *   6. SCOPE CONFUSION: update-state@Company + update-status@Own ⇒ thao tác status chạy Ở PHẠM VI Own
 *      — PIN 404 (assertInScopeForWrite trong changeStatusTx, KHÔNG phải 403) + state không đổi.
 *   7. Kéo sang cột completed ⇒ Done + completed_at + ĐÚNG 1 TASK_STATE_CHANGED (old/new mang stateId
 *      VÀ stateName) + 1 TASK_STATUS_CHANGED + 1 outbox status + audit 2 dòng. Kéo CÙNG nhóm ⇒ status
 *      giữ, 1 TASK_STATE_CHANGED, 0 event status. Kéo NGƯỢC completed→started ⇒ completed_at/by NULL.
 *   8. ATOMIC Cancelled: kéo sang completed ⇒ FSM từ chối 409 ⇒ state_id KHÔNG đổi.
 *   9. CHECKLIST GATE (hợp đồng changeStatusTx khoản 2): kéo sang completed khi setting bật + item
 *      bắt buộc chưa tick ⇒ 400 CHECKLIST-REQUIRED + state_id KHÔNG đổi.
 *  10. Same-column no-op ⇒ 200, 0 activity/0 event.
 *  11. POST /tasks {stateId cột started} ⇒ task_status='In Progress' (KHÔNG hardcode Todo — desync-lúc-sinh);
 *      thiếu update-state ⇒ 403; KHÔNG truyền stateId trong project có pipeline ⇒ state_id=is_default + 'Todo'.
 *  12. PATCH cửa thứ hai: actor CÓ update:task THIẾU update-state ⇒ PATCH {stateId} 403 + state không đổi;
 *      admin PATCH stateId khác nhóm ⇒ auto-map Y HỆT move-state; audit TASK_UPDATED KHÔNG khai stateId
 *      (state có bản ghi TASK_STATE_CHANGED riêng — audit không nói dối).
 *
 * LƯU Ý ROLE: 4 role canonical có CẢ 2 pair cùng scope ⇒ bypass/scope-confusion PHẢI dựng role TUỲ BIẾN.
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-lane-db-gate).
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
import { directPool, hasDb } from "../helpers/integration-db";
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
const LOGIN_PW = "Passw0rd!lane5mvs";

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, resourceType: string, scope: Scope, isSensitive?: boolean];

describe.skipIf(!hasLaneDb)(
  "S5-TASK-PIPELINE-1 move-state + đường ghi stateId (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let adminUser = ""; // update-state + update-status + update + create + read @Company
    let empUser = ""; // update-state + update-status + read @Own
    let stateOnlyUser = ""; // update-state@Company + read@Company — THIẾU update-status (bypass)
    let confusedUser = ""; // update-state@Company + update-status@Own + read@Company (scope confusion)
    let statusOnlyUser = ""; // update-status@Company + read@Company — THIẾU update-state (403 guard)
    let patchNoStateUser = ""; // update:task@Company + read@Company — THIẾU update-state (cửa thứ hai)
    let empEmp = "";
    let otherEmp = ""; // thẻ của người khác (empUser @Own không với tới)

    let projectId = "";
    // Cột pipeline của project (7 cột — 2 cột cùng nhóm started để test cùng-nhóm)
    const col: Record<string, string> = {};
    let bStateId = ""; // state của company B (cross-tenant decoy)
    let projectNoStates = ""; // project 0 state — POST fallback

    const tok: Record<string, string> = {};

    async function seedEmp(companyId: string, userId: string | null): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,'active') RETURNING id`,
        [companyId, userId],
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

    async function seedState(
      companyId: string,
      pId: string,
      name: string,
      group: string,
      sortOrder: number,
      isDefault = false,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO project_states (company_id, project_id, name, state_group, is_default, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [companyId, pId, name, group, isDefault, sortOrder],
      );
      return r.rows[0].id as string;
    }

    async function mkTask(opts: {
      taskStatus?: string | null;
      stateName?: string; // tên cột trong `col`
      mainAssigneeEmployeeId?: string | null;
      projectId?: string | null;
      taskType?: string;
      workflowStepId?: string | null;
    }): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, task_status, state_id, main_assignee_employee_id, project_id, creator_user_id)
         VALUES ($1,$2,'T',$3,$4,$5,$6,$7) RETURNING id`,
        [
          A.companyId,
          opts.taskType ?? "office",
          opts.taskStatus === undefined ? "Todo" : opts.taskStatus,
          opts.stateName ? col[opts.stateName] : null,
          opts.mainAssigneeEmployeeId ?? null,
          opts.projectId === undefined ? projectId : opts.projectId,
          adminUser,
        ],
      );
      return r.rows[0].id as string;
    }

    async function grant(companyId: string, userId: string, pairs: Pair[]): Promise<void> {
      const roleId = await seedRole(direct, companyId, `mvs-${userId.slice(0, 8)}`);
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

    const authPost = (t: string, u: string) =>
      request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);
    const authPatch = (t: string, u: string) =>
      request(app.getHttpServer()).patch(u).set("Authorization", `Bearer ${t}`);

    const taskRow = async (id: string) =>
      (
        await direct.query(
          "SELECT task_status, state_id, completed_at, completed_by FROM tasks WHERE id=$1",
          [id],
        )
      ).rows[0] as {
        task_status: string | null;
        state_id: string | null;
        completed_at: Date | null;
        completed_by: string | null;
      };

    const activityCount = async (taskId: string, action: string) =>
      (
        await direct.query(
          "SELECT count(*)::int n FROM task_activity_logs WHERE task_id=$1 AND action=$2",
          [taskId, action],
        )
      ).rows[0].n as number;

    const outboxStatusCount = async (taskId: string) =>
      (
        await direct.query(
          `SELECT count(*)::int n FROM outbox_events WHERE payload->>'taskId'=$1 AND event_type='task.status_changed'`,
          [taskId],
        )
      ).rows[0].n as number;

    const auditCount = async (taskId: string, action: string) =>
      (
        await direct.query(
          "SELECT count(*)::int n FROM audit_logs WHERE object_id=$1 AND action=$2",
          [taskId, action],
        )
      ).rows[0].n as number;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "mvsA");
      B = await seedCompany(direct, "mvsB");
      companyIds.push(A.companyId, B.companyId);

      adminUser = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
      empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
      stateOnlyUser = await seedUser(direct, A.companyId, `stateonly@${A.slug}.test`, hash);
      confusedUser = await seedUser(direct, A.companyId, `confused@${A.slug}.test`, hash);
      statusOnlyUser = await seedUser(direct, A.companyId, `statusonly@${A.slug}.test`, hash);
      patchNoStateUser = await seedUser(direct, A.companyId, `patchns@${A.slug}.test`, hash);

      await seedEmp(A.companyId, adminUser);
      empEmp = await seedEmp(A.companyId, empUser);
      otherEmp = await seedEmp(A.companyId, null);
      await seedEmp(A.companyId, stateOnlyUser);
      await seedEmp(A.companyId, confusedUser);
      await seedEmp(A.companyId, statusOnlyUser);
      await seedEmp(A.companyId, patchNoStateUser);

      projectId = await seedProject(A.companyId, "Pipeline P");
      col["Backlog"] = await seedState(A.companyId, projectId, "Backlog", "backlog", 0);
      col["Cần làm"] = await seedState(A.companyId, projectId, "Cần làm", "unstarted", 1, true);
      col["Đang làm"] = await seedState(A.companyId, projectId, "Đang làm", "started", 2);
      col["Hậu Kỳ"] = await seedState(A.companyId, projectId, "Hậu Kỳ", "started", 3);
      col["Chờ duyệt"] = await seedState(A.companyId, projectId, "Chờ duyệt", "review", 4);
      col["Hoàn thành"] = await seedState(A.companyId, projectId, "Hoàn thành", "completed", 5);
      col["Đã huỷ"] = await seedState(A.companyId, projectId, "Đã huỷ", "cancelled", 6);
      projectNoStates = await seedProject(A.companyId, "P-no-states");

      // Project khác (cùng tenant) — cột decoy cho ca 400 STATE-INVALID.
      const otherProject = await seedProject(A.companyId, "P-other");
      col["__otherProjectCol"] = await seedState(
        A.companyId,
        otherProject,
        "Cột dự án khác",
        "started",
        1,
      );

      await grant(A.companyId, adminUser, [
        ["read", "task", "Company"],
        ["create", "task", "Company"],
        ["update", "task", "Company"],
        ["update-state", "task", "Company"],
        ["update-status", "task", "Company"],
      ]);
      await grant(A.companyId, empUser, [
        ["read", "task", "Own"],
        ["update-state", "task", "Own"],
        ["update-status", "task", "Own"],
      ]);
      await grant(A.companyId, stateOnlyUser, [
        ["read", "task", "Company"],
        ["update-state", "task", "Company"],
      ]);
      await grant(A.companyId, confusedUser, [
        ["read", "task", "Company"],
        ["update-state", "task", "Company"],
        ["update-status", "task", "Own"],
      ]);
      await grant(A.companyId, statusOnlyUser, [
        ["read", "task", "Company"],
        ["update-status", "task", "Company"],
      ]);
      await grant(A.companyId, patchNoStateUser, [
        ["read", "task", "Company"],
        ["update", "task", "Company"],
      ]);

      // Company B — state decoy cross-tenant.
      const bAdmin = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
      await seedEmp(B.companyId, bAdmin);
      const bProject = await seedProject(B.companyId, "B P");
      bStateId = await seedState(B.companyId, bProject, "B-Done", "completed", 1);

      tok.admin = await login(A.slug, `admin@${A.slug}.test`);
      tok.emp = await login(A.slug, `emp@${A.slug}.test`);
      tok.stateOnly = await login(A.slug, `stateonly@${A.slug}.test`);
      tok.confused = await login(A.slug, `confused@${A.slug}.test`);
      tok.statusOnly = await login(A.slug, `statusonly@${A.slug}.test`);
      tok.patchNoState = await login(A.slug, `patchns@${A.slug}.test`);
    });

    afterAll(async () => {
      // app.close() TRƯỚC cleanup — outbox worker sống ghi audit giữa 2 câu DELETE = FK flake (bài học #235).
      await app?.close();
      if (direct && companyIds.length) {
        for (const tbl of [
          "task_activity_logs",
          "task_checklist_items",
          "task_checklists",
          "tasks",
          "project_states",
          "projects",
          "employee_profiles",
        ]) {
          await direct
            .query(`DELETE FROM ${tbl} WHERE company_id = ANY($1::uuid[])`, [companyIds])
            .catch(() => undefined);
        }
        await cleanupTenants(direct, companyIds);
      }
      await direct?.end();
    });

    // ── 1-4. Deny-path RED ──────────────────────────────────────────────────────

    it("thiếu update-state:task (dù CÓ update-status@Company) → 403; state nguyên", async () => {
      const t = await mkTask({ taskStatus: "Todo", stateName: "Cần làm" });
      const res = await authPost(tok.statusOnly, `/tasks/${t}/move-state`).send({
        stateId: col["Đang làm"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect((await taskRow(t)).state_id).toBe(col["Cần làm"]);
    });

    it("update-state@Own kéo thẻ NGƯỜI KHÁC → 404 (không lộ tồn tại), state nguyên", async () => {
      const t = await mkTask({
        taskStatus: "Todo",
        stateName: "Cần làm",
        mainAssigneeEmployeeId: otherEmp,
      });
      const res = await authPost(tok.emp, `/tasks/${t}/move-state`).send({
        stateId: col["Đang làm"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect((await taskRow(t)).state_id).toBe(col["Cần làm"]);
    });

    it("stateId không tồn tại → 404 STATE-NOT-FOUND; cột project KHÁC → 400 STATE-INVALID; state công ty B → 404 y hệt (RLS không rò); task không project → 400", async () => {
      const t = await mkTask({ taskStatus: "Todo", stateName: "Cần làm" });
      const ghost = await authPost(tok.admin, `/tasks/${t}/move-state`).send({
        stateId: "00000000-0000-4000-8000-000000000000",
      });
      expect(ghost.status).toBe(404);
      expect(JSON.stringify(ghost.body)).toContain("TASK-ERR-STATE-NOT-FOUND");

      const wrongProject = await authPost(tok.admin, `/tasks/${t}/move-state`).send({
        stateId: col["__otherProjectCol"],
      });
      expect(wrongProject.status).toBe(400);
      expect(JSON.stringify(wrongProject.body)).toContain("TASK-ERR-STATE-INVALID");

      const crossTenant = await authPost(tok.admin, `/tasks/${t}/move-state`).send({
        stateId: bStateId,
      });
      expect(crossTenant.status, "cross-tenant PHẢI 404 y hệt không-tồn-tại").toBe(404);
      expect(JSON.stringify(crossTenant.body)).toContain("TASK-ERR-STATE-NOT-FOUND");

      const noProject = await mkTask({ taskStatus: "Todo", projectId: null });
      const invalid = await authPost(tok.admin, `/tasks/${noProject}/move-state`).send({
        stateId: col["Đang làm"],
      });
      expect(invalid.status).toBe(400);

      expect((await taskRow(t)).state_id).toBe(col["Cần làm"]);
    });

    it("task workflow-driven → 400 (không lách FSM studio)", async () => {
      const t = await mkTask({ taskStatus: "Todo", stateName: "Cần làm", taskType: "production" });
      const res = await authPost(tok.admin, `/tasks/${t}/move-state`).send({
        stateId: col["Đang làm"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect((await taskRow(t)).state_id).toBe(col["Cần làm"]);
    });

    // ── 5-6. Bypass quyền + scope confusion (deny-path QUAN TRỌNG NHẤT) ─────────

    it("BYPASS: có update-state THIẾU update-status — kéo KHÁC nhóm → 403 VÀ state KHÔNG đổi (atomic); kéo CÙNG nhóm → 200", async () => {
      const t = await mkTask({ taskStatus: "In Progress", stateName: "Đang làm" });
      const denied = await authPost(tok.stateOnly, `/tasks/${t}/move-state`).send({
        stateId: col["Hoàn thành"],
      });
      expect(denied.status, JSON.stringify(denied.body)).toBe(403);
      const afterDenied = await taskRow(t);
      expect(afterDenied.state_id, "403 KHÔNG được đổi cột trước").toBe(col["Đang làm"]);
      expect(afterDenied.task_status).toBe("In Progress");
      expect(await activityCount(t, "TASK_STATE_CHANGED")).toBe(0);

      // Cùng nhóm started (Đang làm → Hậu Kỳ): không đổi status ⇒ KHÔNG cần update-status.
      const ok = await authPost(tok.stateOnly, `/tasks/${t}/move-state`).send({
        stateId: col["Hậu Kỳ"],
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const afterOk = await taskRow(t);
      expect(afterOk.state_id).toBe(col["Hậu Kỳ"]);
      expect(afterOk.task_status).toBe("In Progress");
      // Pin nhật ký ca cùng-nhóm (F6): ĐÚNG 1 bản ghi đổi cột, 0 event status (không rác).
      expect(await activityCount(t, "TASK_STATE_CHANGED")).toBe(1);
      expect(await activityCount(t, "TASK_STATUS_CHANGED")).toBe(0);
      expect(await outboxStatusCount(t)).toBe(0);
    });

    it("SCOPE CONFUSION: update-state@Company + update-status@Own kéo thẻ NGƯỜI KHÁC khác nhóm → PIN 404 (không phải 403) + state không đổi", async () => {
      const t = await mkTask({
        taskStatus: "In Progress",
        stateName: "Đang làm",
        mainAssigneeEmployeeId: otherEmp,
      });
      const res = await authPost(tok.confused, `/tasks/${t}/move-state`).send({
        stateId: col["Hoàn thành"],
      });
      // assertInScopeForWrite của đường STATUS chạy với scope Own THẬT của pair update-status → 404.
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      const after = await taskRow(t);
      expect(after.state_id).toBe(col["Đang làm"]);
      expect(after.task_status).toBe("In Progress");
      expect(await activityCount(t, "TASK_STATE_CHANGED")).toBe(0);
    });

    // ── 7. Happy path + ghi nhật ký đúng đắn ───────────────────────────────────

    it("kéo sang cột completed → Done + completed_at; ĐÚNG 1 TASK_STATE_CHANGED (mang stateId+stateName) + 1 TASK_STATUS_CHANGED + 1 outbox + audit 2 dòng", async () => {
      const t = await mkTask({ taskStatus: "In Progress", stateName: "Đang làm" });
      const res = await authPost(tok.admin, `/tasks/${t}/move-state`).send({
        stateId: col["Hoàn thành"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const after = await taskRow(t);
      expect(after.state_id).toBe(col["Hoàn thành"]);
      expect(after.task_status).toBe("Done");
      expect(after.completed_at).not.toBeNull();

      expect(await activityCount(t, "TASK_STATE_CHANGED")).toBe(1);
      expect(await activityCount(t, "TASK_STATUS_CHANGED")).toBe(1);
      expect(await outboxStatusCount(t)).toBe(1);
      expect(await auditCount(t, "TaskStateChanged")).toBe(1);
      expect(await auditCount(t, "TaskStatusChanged")).toBe(1);

      // old/new của bản ghi đổi cột PHẢI mang CẢ stateId VÀ stateName (cột đổi tên sau không sai lịch sử).
      const act = await direct.query(
        `SELECT old_values, new_values FROM task_activity_logs WHERE task_id=$1 AND action='TASK_STATE_CHANGED'`,
        [t],
      );
      const oldV = act.rows[0].old_values as { stateId: string; stateName: string };
      const newV = act.rows[0].new_values as { stateId: string; stateName: string };
      expect(oldV.stateId).toBe(col["Đang làm"]);
      expect(oldV.stateName).toBe("Đang làm");
      expect(newV.stateId).toBe(col["Hoàn thành"]);
      expect(newV.stateName).toBe("Hoàn thành");
    });

    it("kéo NGƯỢC completed→started → In Progress + completed_at/by RESET NULL (D-19)", async () => {
      const t = await mkTask({ taskStatus: "In Progress", stateName: "Đang làm" });
      await authPost(tok.admin, `/tasks/${t}/move-state`).send({ stateId: col["Hoàn thành"] });
      expect((await taskRow(t)).completed_at).not.toBeNull();

      const res = await authPost(tok.admin, `/tasks/${t}/move-state`).send({
        stateId: col["Đang làm"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const after = await taskRow(t);
      expect(after.task_status).toBe("In Progress");
      expect(after.completed_at).toBeNull();
      expect(after.completed_by).toBeNull();
    });

    it("same-column no-op → 200, 0 activity/0 event (không rác)", async () => {
      const t = await mkTask({ taskStatus: "In Progress", stateName: "Đang làm" });
      const res = await authPost(tok.admin, `/tasks/${t}/move-state`).send({
        stateId: col["Đang làm"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await activityCount(t, "TASK_STATE_CHANGED")).toBe(0);
      expect(await outboxStatusCount(t)).toBe(0);
    });

    // ── 8-9. Atomic Cancelled + checklist gate ─────────────────────────────────

    it("ATOMIC: task Cancelled kéo thẳng sang completed → FSM từ chối 409 → state_id KHÔNG đổi", async () => {
      const t = await mkTask({ taskStatus: "Cancelled", stateName: "Đã huỷ" });
      const res = await authPost(tok.admin, `/tasks/${t}/move-state`).send({
        stateId: col["Hoàn thành"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      const after = await taskRow(t);
      expect(after.state_id, "FSM từ chối ⇒ cột KHÔNG lệch status").toBe(col["Đã huỷ"]);
      expect(after.task_status).toBe("Cancelled");
      expect(await activityCount(t, "TASK_STATE_CHANGED")).toBe(0);
    });

    it("CHECKLIST GATE: setting bật + item bắt buộc chưa tick + kéo sang completed → 400 CHECKLIST-REQUIRED + state KHÔNG đổi", async () => {
      await direct.query(
        `INSERT INTO company_settings (company_id, setting_key, setting_value, value_type, category, status)
         VALUES ($1,'require_checklist_done_before_task_done','true','Boolean','Task','Active')
         ON CONFLICT DO NOTHING`,
        [A.companyId],
      );
      const t = await mkTask({ taskStatus: "In Progress", stateName: "Đang làm" });
      const cl = await direct.query(
        `INSERT INTO task_checklists (company_id, task_id, title, is_required_for_done)
         VALUES ($1,$2,'CL',true) RETURNING id`,
        [A.companyId, t],
      );
      await direct.query(
        `INSERT INTO task_checklist_items (company_id, task_id, checklist_id, title, is_done)
         VALUES ($1,$2,$3,'i1',false)`,
        [A.companyId, t, cl.rows[0].id],
      );
      const res = await authPost(tok.admin, `/tasks/${t}/move-state`).send({
        stateId: col["Hoàn thành"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(JSON.stringify(res.body)).toContain("TASK-ERR-CHECKLIST-REQUIRED");
      const after = await taskRow(t);
      expect(after.state_id, "400 checklist ⇒ cột KHÔNG đổi (atomic)").toBe(col["Đang làm"]);
      expect(after.task_status).toBe("In Progress");
      // Dọn setting để không rò sang test khác của company A.
      await direct.query(
        `DELETE FROM company_settings WHERE company_id=$1 AND setting_key='require_checklist_done_before_task_done'`,
        [A.companyId],
      );
    });

    // ── 11. POST /tasks + stateId (desync-lúc-sinh) ────────────────────────────

    it("POST /tasks {stateId cột started} → task_status='In Progress' (suy từ nhóm, KHÔNG hardcode Todo)", async () => {
      const res = await authPost(tok.admin, `/tasks`).send({
        title: "Tạo thẳng vào cột",
        projectId,
        stateId: col["Đang làm"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const id = res.body.data.id as string;
      const after = await taskRow(id);
      expect(after.state_id).toBe(col["Đang làm"]);
      expect(after.task_status).toBe("In Progress");
    });

    it("POST /tasks {stateId} bởi actor CÓ create:task nhưng THIẾU update-state → 403 (không tạo task)", async () => {
      const email = `createns@${A.slug}.test`;
      const hash = await new PasswordService().hash(LOGIN_PW);
      const u = await seedUser(direct, A.companyId, email, hash);
      await seedEmp(A.companyId, u);
      await grant(A.companyId, u, [
        ["read", "task", "Company"],
        ["create", "task", "Company"],
      ]);
      const tokCreate = await login(A.slug, email);

      const res = await authPost(tokCreate, `/tasks`).send({
        title: "Không có update-state",
        projectId,
        stateId: col["Đang làm"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      // Pin (F6): 403 pre-tx ⇒ KHÔNG có row nào được tạo (không đốt task, không rác).
      const cnt = await direct.query(
        `SELECT count(*)::int n FROM tasks WHERE company_id=$1 AND title='Không có update-state'`,
        [A.companyId],
      );
      expect(cnt.rows[0].n).toBe(0);
    });

    it("POST /tasks KHÔNG truyền stateId trong project có pipeline → state_id = is_default VÀ status 'Todo'; project 0 state → state NULL", async () => {
      const res = await authPost(tok.admin, `/tasks`).send({
        title: "Mặc định lên board",
        projectId,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const after = await taskRow(res.body.data.id as string);
      expect(after.state_id, "task mới PHẢI lên cột is_default").toBe(col["Cần làm"]);
      expect(after.task_status).toBe("Todo");

      const res2 = await authPost(tok.admin, `/tasks`).send({
        title: "Project 0 state",
        projectId: projectNoStates,
      });
      expect(res2.status).toBe(201);
      expect((await taskRow(res2.body.data.id as string)).state_id).toBeNull();
    });

    // ── 12. PATCH cửa thứ hai ──────────────────────────────────────────────────

    it("CỬA THỨ HAI (scope): update:task@Company + update-state@Own PATCH cột task NGƯỜI KHÁC (CÙNG nhóm) → 404 + state không đổi — bound theo scope update-state, không mượn update:task", async () => {
      const email = `patchown@${A.slug}.test`;
      const hash = await new PasswordService().hash(LOGIN_PW);
      const u = await seedUser(direct, A.companyId, email, hash);
      const uEmp = await seedEmp(A.companyId, u);
      await grant(A.companyId, u, [
        ["read", "task", "Company"],
        ["update", "task", "Company"],
        ["update-state", "task", "Own"],
      ]);
      const tokPatchOwn = await login(A.slug, email);

      // Task của NGƯỜI KHÁC — cùng nhóm started (Đang làm → Hậu Kỳ): không đổi status ⇒ ca này
      // chỉ chặn được bằng data-scope của CHÍNH pair update-state (finding HIGH security-reviewer).
      const t = await mkTask({
        taskStatus: "In Progress",
        stateName: "Đang làm",
        mainAssigneeEmployeeId: otherEmp,
      });
      const denied = await authPatch(tokPatchOwn, `/tasks/${t}`).send({
        stateId: col["Hậu Kỳ"],
      });
      expect(denied.status, JSON.stringify(denied.body)).toBe(404);
      expect((await taskRow(t)).state_id).toBe(col["Đang làm"]);
      expect(await activityCount(t, "TASK_STATE_CHANGED")).toBe(0);

      // Đối chứng: CHÍNH actor đó trên task CỦA MÌNH (Own) ⇒ 200 (bound đúng, không chặn oan).
      const own = await mkTask({
        taskStatus: "In Progress",
        stateName: "Đang làm",
        mainAssigneeEmployeeId: uEmp,
      });
      const ok = await authPatch(tokPatchOwn, `/tasks/${own}`).send({
        stateId: col["Hậu Kỳ"],
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect((await taskRow(own)).state_id).toBe(col["Hậu Kỳ"]);
    });

    it("CỬA THỨ HAI: PATCH {stateId} bởi actor CÓ update:task THIẾU update-state → 403 + state không đổi", async () => {
      const t = await mkTask({ taskStatus: "In Progress", stateName: "Đang làm" });
      const res = await authPatch(tok.patchNoState, `/tasks/${t}`).send({
        stateId: col["Hoàn thành"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect((await taskRow(t)).state_id).toBe(col["Đang làm"]);
    });

    it("PATCH {stateId} khác nhóm (admin) → auto-map Y HỆT move-state; audit TASK_UPDATED KHÔNG khai stateId (có TASK_STATE_CHANGED riêng)", async () => {
      const t = await mkTask({ taskStatus: "In Progress", stateName: "Đang làm" });
      const res = await authPatch(tok.admin, `/tasks/${t}`).send({
        title: "Đổi cả tiêu đề",
        stateId: col["Hoàn thành"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const after = await taskRow(t);
      expect(after.state_id).toBe(col["Hoàn thành"]);
      expect(after.task_status, "PATCH đi CÙNG method dùng chung ⇒ auto-map y hệt").toBe("Done");
      expect(await activityCount(t, "TASK_STATE_CHANGED")).toBe(1);
      expect(await activityCount(t, "TASK_STATUS_CHANGED")).toBe(1);

      // Audit TASK_UPDATED không nói dối: newValues KHÔNG chứa stateId (đã có bản ghi state riêng).
      const upd = await direct.query(
        `SELECT new_values FROM task_activity_logs WHERE task_id=$1 AND action='TASK_UPDATED'`,
        [t],
      );
      expect(upd.rows.length).toBe(1);
      const newV = upd.rows[0].new_values as Record<string, unknown>;
      expect(newV.title).toBe("Đổi cả tiêu đề");
      expect("stateId" in newV, "stateId KHÔNG được khai trong TASK_UPDATED").toBe(false);
    });

    it("PATCH CHỈ stateId cùng cột (no-op) → 200, KHÔNG TASK_UPDATED, KHÔNG TASK_STATE_CHANGED", async () => {
      const t = await mkTask({ taskStatus: "In Progress", stateName: "Đang làm" });
      const res = await authPatch(tok.admin, `/tasks/${t}`).send({
        stateId: col["Đang làm"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await activityCount(t, "TASK_STATE_CHANGED")).toBe(0);
      expect(await activityCount(t, "TASK_UPDATED")).toBe(0);
    });
  },
);
