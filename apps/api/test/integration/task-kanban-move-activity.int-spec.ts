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
 *   1b. S5-TASK-BE-6 (SPEC-06 §13.8) — counts per-card (commentCount/attachmentCount/checklistDone/
 *      checklistTotal) ĐÚNG dữ liệu planted; card trống → 0; CHỈ đếm bản ghi CÒN SỐNG (soft-deleted bị loại).
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
      stateId?: string | null;
      parentTaskId?: string | null;
      title?: string;
    }): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, task_status, main_assignee_employee_id, project_id, creator_user_id, state_id, parent_task_id)
       VALUES ($1,'office',$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          opts.companyId ?? A.companyId,
          opts.title ?? "T",
          opts.taskStatus ?? "Todo",
          opts.mainAssigneeEmployeeId ?? null,
          opts.projectId ?? null,
          opts.creatorUserId ?? adminUser,
          opts.stateId ?? null,
          opts.parentTaskId ?? null,
        ],
      );
      return r.rows[0].id as string;
    }

    // S5-TASK-PIPELINE-1 (lane be-read) — cột pipeline cho board state-mode.
    async function seedState(
      companyId: string,
      pId: string,
      name: string,
      group: string,
      sortOrder: number,
      isDefault = false,
      color = "#64748b",
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO project_states (company_id, project_id, name, state_group, is_default, sort_order, color)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [companyId, pId, name, group, isDefault, sortOrder, color],
      );
      return r.rows[0].id as string;
    }

    // ── S5-TASK-BE-6 (SPEC-06 §13.8) — plant comment/attachment/checklist cho counts per-card ─────

    async function seedComment(
      companyId: string,
      taskId: string,
      userId: string,
      body: string,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO task_comments (company_id, task_id, user_id, body, created_by)
       VALUES ($1,$2,$3,$4,$3) RETURNING id`,
        [companyId, taskId, userId, body],
      );
      return r.rows[0].id as string;
    }

    async function softDeleteComment(commentId: string): Promise<void> {
      await direct.query("UPDATE task_comments SET deleted_at = now() WHERE id = $1", [commentId]);
    }

    /** files + file_links (module 'TASK'/entity 'task') — mirror task-files-access.int-spec.ts seedFile/seedTaskLink. */
    async function seedTaskAttachment(
      companyId: string,
      taskId: string,
      uploadedBy: string,
    ): Promise<{ fileId: string; linkId: string }> {
      const fr = await direct.query(
        `INSERT INTO files
           (company_id, original_name, stored_name, mime_type, file_size_bytes, storage_provider,
            storage_path, upload_status, scan_status, uploaded_by)
         VALUES ($1,'attach.pdf','stored.pdf','application/pdf',1024,'MinIO',$2,'Uploaded','Clean',$3)
         RETURNING id`,
        [companyId, `${companyId}/tasks/${taskId}/attach.pdf`, uploadedBy],
      );
      const fileId = fr.rows[0].id as string;
      const lr = await direct.query(
        `INSERT INTO file_links (company_id, file_id, module_code, entity_type, entity_id, link_type, created_by)
         VALUES ($1,$2,'TASK','task',$3,'Attachment',$4) RETURNING id`,
        [companyId, fileId, taskId, uploadedBy],
      );
      return { fileId, linkId: lr.rows[0].id as string };
    }

    async function softDeleteFileLink(linkId: string): Promise<void> {
      await direct.query("UPDATE file_links SET deleted_at = now() WHERE id = $1", [linkId]);
    }

    async function seedChecklist(
      companyId: string,
      taskId: string,
      title: string,
      createdBy: string,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO task_checklists (company_id, task_id, title, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$4) RETURNING id`,
        [companyId, taskId, title, createdBy],
      );
      return r.rows[0].id as string;
    }

    async function seedChecklistItem(
      companyId: string,
      taskId: string,
      checklistId: string,
      title: string,
      isDone: boolean,
      createdBy: string,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO task_checklist_items
           (company_id, task_id, checklist_id, title, is_done, done_at, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
        [companyId, taskId, checklistId, title, isDone, isDone ? new Date() : null, createdBy],
      );
      return r.rows[0].id as string;
    }

    async function softDeleteChecklistItem(itemId: string): Promise<void> {
      await direct.query("UPDATE task_checklist_items SET deleted_at = now() WHERE id = $1", [
        itemId,
      ]);
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
        // S5-TASK-DETAIL-1 (D-29): route activity đổi guard sang read:task — pair audit vẫn là
        // override đầy đủ ở service nhưng PHẢI qua guard read:task trước (seed thật hr/admin có cả hai).
        ["read", "task", "Company"],
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

    // ── 1b. Counts per-card (S5-TASK-BE-6, SPEC-06 §13.8) ───────────────────────

    it("card có commentCount·attachmentCount·checklistDone/checklistTotal ĐÚNG dữ liệu planted; card trống → 0", async () => {
      const withData = await mkTask({ projectId, taskStatus: "Todo" });
      const empty = await mkTask({ projectId, taskStatus: "Todo" });

      await seedComment(A.companyId, withData, adminUser, "c1");
      await seedComment(A.companyId, withData, adminUser, "c2");

      await seedTaskAttachment(A.companyId, withData, adminUser);

      const checklistId = await seedChecklist(A.companyId, withData, "Checklist 1", adminUser);
      await seedChecklistItem(A.companyId, withData, checklistId, "item1", true, adminUser);
      await seedChecklistItem(A.companyId, withData, checklistId, "item2", false, adminUser);
      await seedChecklistItem(A.companyId, withData, checklistId, "item3", false, adminUser);

      const res = await authGet(tok.admin, `/projects/${projectId}/kanban`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const cols = res.body.data.columns as Array<{
        status: string;
        tasks: Array<{
          id: string;
          commentCount: number;
          attachmentCount: number;
          checklistDone: number;
          checklistTotal: number;
        }>;
      }>;
      const todo = cols.find((c) => c.status === "Todo")?.tasks ?? [];

      const card = todo.find((c) => c.id === withData);
      expect(card, JSON.stringify(todo)).toBeDefined();
      expect(card?.commentCount).toBe(2);
      expect(card?.attachmentCount).toBe(1);
      expect(card?.checklistDone).toBe(1);
      expect(card?.checklistTotal).toBe(3);

      const emptyCard = todo.find((c) => c.id === empty);
      expect(emptyCard, JSON.stringify(todo)).toBeDefined();
      expect(emptyCard?.commentCount).toBe(0);
      expect(emptyCard?.attachmentCount).toBe(0);
      expect(emptyCard?.checklistDone).toBe(0);
      expect(emptyCard?.checklistTotal).toBe(0);
    });

    it("counts CHỈ đếm bản ghi CÒN SỐNG — comment/file/checklist-item đã soft-delete KHÔNG được tính", async () => {
      const t = await mkTask({ projectId, taskStatus: "Todo" });

      await seedComment(A.companyId, t, adminUser, "live");
      const deletedComment = await seedComment(A.companyId, t, adminUser, "deleted");
      await softDeleteComment(deletedComment);

      await seedTaskAttachment(A.companyId, t, adminUser);
      const deleted = await seedTaskAttachment(A.companyId, t, adminUser);
      await softDeleteFileLink(deleted.linkId);

      const checklistId = await seedChecklist(A.companyId, t, "Checklist", adminUser);
      await seedChecklistItem(A.companyId, t, checklistId, "live-item", false, adminUser);
      const deletedItem = await seedChecklistItem(
        A.companyId,
        t,
        checklistId,
        "deleted-item",
        true,
        adminUser,
      );
      await softDeleteChecklistItem(deletedItem);

      const res = await authGet(tok.admin, `/projects/${projectId}/kanban`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const cols = res.body.data.columns as Array<{
        status: string;
        tasks: Array<{
          id: string;
          commentCount: number;
          attachmentCount: number;
          checklistDone: number;
          checklistTotal: number;
        }>;
      }>;
      const card = (cols.find((c) => c.status === "Todo")?.tasks ?? []).find((c) => c.id === t);
      expect(card, JSON.stringify(cols)).toBeDefined();
      expect(card?.commentCount).toBe(1);
      expect(card?.attachmentCount).toBe(1);
      // checklist: 1 item sống (chưa done) + 1 item đã soft-delete (bị loại) → total=1, done=0.
      expect(card?.checklistTotal).toBe(1);
      expect(card?.checklistDone).toBe(0);
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

    it("move sai FSM (Cancelled→Done — ca từ chối còn lại sau nới §6.10.1) → 409, state giữ nguyên", async () => {
      const t = await mkTask({ taskStatus: "Cancelled" });
      const res = await authPost(tok.admin, `/tasks/${t}/move`).send({ status: "Done" });
      expect(res.status).toBe(409);
      const row = await direct.query("SELECT task_status FROM tasks WHERE id=$1", [t]);
      expect(row.rows[0].task_status).toBe("Cancelled");
    });

    it("move nhảy cấp Todo→Done → 200 (luật nới 18/07 — trước là 409) + completed_at set", async () => {
      const t = await mkTask({ taskStatus: "Todo" });
      const res = await authPost(tok.admin, `/tasks/${t}/move`).send({ status: "Done" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const row = await direct.query("SELECT task_status, completed_at FROM tasks WHERE id=$1", [
        t,
      ]);
      expect(row.rows[0].task_status).toBe("Done");
      expect(row.rows[0].completed_at).not.toBeNull();
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

    // D-29 (S5-TASK-DETAIL-1): emp/mgr ở spec này KHÔNG có read:task ⇒ vẫn 403 (giờ từ guard read:task);
    // task creator = adminUser nên emp/mgr cũng không phải người liên quan. Admin 200 qua pair audit.
    it("hr/admin xem được activity (pair audit override D-29); employee/manager → 403", async () => {
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

    // ── 4. S5-TASK-PIPELINE-1 (lane be-read) — board state-mode theo cột pipeline ──

    describe("board columnMode:'state' (project có pipeline)", () => {
      type StateCol = {
        columnMode: "state";
        stateId: string;
        name: string;
        color: string;
        stateGroup: string;
        sortOrder: number;
        taskCount: number;
        tasks: Array<{ id: string; status: string | null; stateId?: string | null }>;
      };

      it("REGRESSION QUAN TRỌNG NHẤT: thẻ nằm ĐÚNG cột theo state_id (KHÔNG dồn 1 cột); NULL → cột is_default; cột theo sortOrder; taskCount đúng", async () => {
        const p = await seedProject(A.companyId, "P-board-state");
        const cBacklog = await seedState(A.companyId, p, "Backlog", "backlog", 0);
        const cTodo = await seedState(A.companyId, p, "Cần làm", "unstarted", 1, true);
        const cDoing = await seedState(A.companyId, p, "Đang làm", "started", 2, false, "#3b82f6");
        const cDone = await seedState(A.companyId, p, "Hoàn thành", "completed", 3);

        const t1 = await mkTask({ projectId: p, taskStatus: "Todo", stateId: cTodo });
        const t2 = await mkTask({ projectId: p, taskStatus: "In Progress", stateId: cDoing });
        const t3 = await mkTask({ projectId: p, taskStatus: "Done", stateId: cDone });
        const tNull = await mkTask({ projectId: p, taskStatus: "Todo", stateId: null }); // legacy chưa map

        const res = await authGet(tok.admin, `/projects/${p}/kanban`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const cols = res.body.data.columns as StateCol[];
        expect(cols.every((c) => c.columnMode === "state")).toBe(true);
        expect(cols.map((c) => c.stateId)).toEqual([cBacklog, cTodo, cDoing, cDone]); // sortOrder
        expect(cols[2].name).toBe("Đang làm");
        expect(cols[2].color).toBe("#3b82f6");
        expect(cols[2].stateGroup).toBe("started");

        const byState = new Map(cols.map((c) => [c.stateId, c]));
        expect(byState.get(cDoing)?.tasks.map((tk) => tk.id)).toEqual([t2]);
        expect(byState.get(cDone)?.tasks.map((tk) => tk.id)).toEqual([t3]);
        // NULL state_id KHÔNG biến mất — rơi vào cột is_default (Cần làm) cùng t1.
        const defTasks = byState.get(cTodo)?.tasks.map((tk) => tk.id) ?? [];
        expect(defTasks).toContain(t1);
        expect(defTasks).toContain(tNull);
        expect(byState.get(cTodo)?.taskCount).toBe(2);
        expect(byState.get(cBacklog)?.taskCount).toBe(0);
      });

      it("LỌC CON: task có parent_task_id KHÔNG lên board, taskCount không tính con (bộ lọc sẵn cho S5-TASK-SUBTASK-1)", async () => {
        const p = await seedProject(A.companyId, "P-board-child");
        const cOnly = await seedState(A.companyId, p, "Cần làm", "unstarted", 1, true);
        const parent = await mkTask({ projectId: p, taskStatus: "Todo", stateId: cOnly });
        const child = await mkTask({
          projectId: p,
          taskStatus: "Todo",
          stateId: cOnly,
          parentTaskId: parent,
          title: "việc con",
        });

        const res = await authGet(tok.admin, `/projects/${p}/kanban`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const cols = res.body.data.columns as StateCol[];
        const ids = cols.flatMap((c) => c.tasks.map((tk) => tk.id));
        expect(ids).toContain(parent);
        expect(ids, "task con PHẢI ẩn khỏi board (owner chốt 18/07)").not.toContain(child);
        expect(cols[0].taskCount).toBe(1);
      });

      it("dự án chỉ còn ĐÚNG 1 cột: board render bình thường, không crash, không mất thẻ", async () => {
        const p = await seedProject(A.companyId, "P-board-one");
        const cOne = await seedState(A.companyId, p, "Duy nhất", "started", 0, true);
        const t = await mkTask({ projectId: p, taskStatus: "In Progress", stateId: cOne });

        const res = await authGet(tok.admin, `/projects/${p}/kanban`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const cols = res.body.data.columns as StateCol[];
        expect(cols.length).toBe(1);
        expect(cols[0].tasks.map((tk) => tk.id)).toEqual([t]);
      });

      it("card trên board state-mode mang stateId/stateName/stateGroup (mapper LEFT JOIN project_states)", async () => {
        const p = await seedProject(A.companyId, "P-board-cardfields");
        const c = await seedState(A.companyId, p, "Quay", "started", 1, true, "#111111");
        const t = await mkTask({ projectId: p, taskStatus: "In Progress", stateId: c });

        const res = await authGet(tok.admin, `/projects/${p}/kanban`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const card = (res.body.data.columns as StateCol[])[0].tasks.find((tk) => tk.id === t) as
          | { stateId?: string | null; stateName?: string | null; stateGroup?: string | null }
          | undefined;
        expect(card?.stateId).toBe(c);
        expect(card?.stateName).toBe("Quay");
        expect(card?.stateGroup).toBe("started");
      });

      it("KHÔNG cột is_default ⇒ thẻ state NULL rơi vào CỘT ĐẦU (bậc cuối D-20); list /tasks VẪN trả task con (parentOnly chỉ ở board)", async () => {
        const p = await seedProject(A.companyId, "P-board-nodefault");
        const cFirst = await seedState(A.companyId, p, "Đầu", "started", 0); // KHÔNG is_default
        await seedState(A.companyId, p, "Sau", "completed", 1);
        const tNull = await mkTask({ projectId: p, taskStatus: "In Progress", stateId: null });
        const child = await mkTask({
          projectId: p,
          taskStatus: "Todo",
          stateId: cFirst,
          parentTaskId: tNull,
          title: "con-trong-list",
        });

        const res = await authGet(tok.admin, `/projects/${p}/kanban`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const cols = res.body.data.columns as StateCol[];
        expect(cols[0].tasks.map((tk) => tk.id)).toContain(tNull); // cột đầu, không default

        // Bộ lọc con CHỈ ở board: GET /tasks (list) vẫn thấy con — subtask tương lai không mất khỏi
        // list. Fixture admin của spec này không có read:task ⇒ dựng reader ad-hoc.
        const readerEmail = `listreader@${A.slug}.test`;
        const reader = await seedUser(direct, A.companyId, readerEmail, pwHash);
        await seedEmp(A.companyId, reader, null, null);
        await grant(A.companyId, reader, [["read", "task", "Company"]]);
        const readerTok = await login(A.slug, readerEmail);
        const list = await authGet(readerTok, `/tasks?projectId=${p}`);
        expect(list.status, JSON.stringify(list.body)).toBe(200);
        const listIds = (list.body.data as Array<{ id: string }>).map((tk) => tk.id);
        expect(listIds).toContain(child);
      });

      it("dự án 0 state GIỮ columnMode:'status' 5 cột FSM (fallback y hệt hành vi cũ)", async () => {
        const p = await seedProject(A.companyId, "P-board-nostates");
        await mkTask({ projectId: p, taskStatus: "In Progress" });
        const res = await authGet(tok.admin, `/projects/${p}/kanban`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const cols = res.body.data.columns as Array<{ columnMode: string; status?: string }>;
        expect(cols.every((c) => c.columnMode === "status")).toBe(true);
        expect(cols.map((c) => c.status)).toEqual([
          "Todo",
          "In Progress",
          "In Review",
          "Done",
          "Cancelled",
        ]);
      });
    });
  },
);
