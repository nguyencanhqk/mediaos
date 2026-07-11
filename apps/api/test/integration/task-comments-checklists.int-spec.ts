/**
 * S4-TASK-BE-4 — Comment/mention + checklist/items integration (Postgres THẬT, DB CÔ LẬP).
 *
 * Đường THẬT: JwtAuthGuard → CompanyGuard → PermissionGuard → Controller → Service → RLS withTenant.
 * KHÔNG mock permission. Phủ:
 *   1. Comment CRUD: POST không rỗng (Zod) → 400; đọc/viết task NGOÀI scope → 404; PATCH/DELETE chỉ tác
 *      giả (khác người → 403), DELETE admin @Company xoá được comment người khác; DELETE soft (deleted_at,
 *      KHÔNG hard-delete — hàng vẫn còn trong DB).
 *   2. Mention: mention người CÓ quyền xem task → 200 + outbox TASK_MENTIONED; mention người NGOÀI quyền
 *      xem (0 grant) → 403 BLOCK (không phải warning); mention nhân viên không tồn tại/inactive → 400.
 *   3. Checklist: tạo kèm items[] khởi tạo → activity CHECKLIST_CREATED; PATCH tick is_done=true → done_by/
 *      done_at set + activity CHECKLIST_ITEM_DONE; employee (KHÔNG update:task) → 403; xoá checklist cascade
 *      soft-delete xuống item.
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
const LOGIN_PW = "Passw0rd!lane4cma";

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, resourceType: string, scope: Scope, isSensitive?: boolean];

describe.skipIf(!hasLaneDb)(
  "S4-TASK-BE-4 Comment/mention + checklist/items (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let appConn: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    let adminUser = "";
    let mgrUser = "";
    let empUser = "";
    let outsiderUser = ""; // 0 grant nào cả — mention target NGOÀI quyền
    let mgrEmp = "";
    let empEmp = "";
    let pwHash = "";

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

    async function mkTask(opts: {
      mainAssigneeEmployeeId?: string | null;
      projectId?: string | null;
    }): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, task_status, main_assignee_employee_id, project_id, creator_user_id)
       VALUES ($1,'office','T','Todo',$2,$3,$4) RETURNING id`,
        [A.companyId, opts.mainAssigneeEmployeeId ?? null, opts.projectId ?? null, adminUser],
      );
      return r.rows[0].id as string;
    }

    async function grant(companyId: string, userId: string, pairs: Pair[]): Promise<void> {
      const roleId = await seedRole(direct, companyId, `cma-${userId.slice(0, 8)}`);
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
    const authPatch = (t: string, u: string) =>
      request(app.getHttpServer()).patch(u).set("Authorization", `Bearer ${t}`);
    const authDelete = (t: string, u: string) =>
      request(app.getHttpServer()).delete(u).set("Authorization", `Bearer ${t}`);

    async function commentExists(id: string): Promise<{ deletedAt: unknown } | undefined> {
      const r = await direct.query("SELECT deleted_at FROM task_comments WHERE id=$1", [id]);
      return r.rows[0];
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      appConn = appPool();
      pwHash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "cmaA");
      companyIds.push(A.companyId);

      const ouEng = await seedOrgUnit(A.companyId, "Engineering");

      adminUser = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, pwHash);
      mgrUser = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, pwHash);
      empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, pwHash);
      outsiderUser = await seedUser(direct, A.companyId, `outsider@${A.slug}.test`, pwHash);

      await seedEmp(A.companyId, adminUser, ouEng, null);
      mgrEmp = await seedEmp(A.companyId, mgrUser, ouEng, null);
      empEmp = await seedEmp(A.companyId, empUser, ouEng, mgrUser);
      // outsiderUser CỐ Ý KHÔNG có employee_profiles + KHÔNG grant nào — mention target ngoài quyền.

      await grant(A.companyId, adminUser, [
        ["read", "task", "Company"],
        ["comment", "task", "Company"],
        ["update", "task", "Company"],
      ]);
      await grant(A.companyId, mgrUser, [
        ["read", "task", "Team"],
        ["comment", "task", "Team"],
        ["update", "task", "Team"],
      ]);
      // employee: read/comment @Own — KHÔNG update:task (deferred grant, mirror 0485 thật).
      await grant(A.companyId, empUser, [
        ["read", "task", "Own"],
        ["comment", "task", "Own"],
      ]);

      tok.admin = await login(A.slug, `admin@${A.slug}.test`);
      tok.mgr = await login(A.slug, `mgr@${A.slug}.test`);
      tok.emp = await login(A.slug, `emp@${A.slug}.test`);
    });

    afterAll(async () => {
      if (direct && companyIds.length) {
        for (const tbl of [
          "task_activity_logs",
          "task_checklist_items",
          "task_checklists",
          "task_comments",
          "tasks",
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

    // ── 1. Comment CRUD ────────────────────────────────────────────────────────

    it("POST content rỗng → 400 (Zod biên)", async () => {
      const t = await mkTask({ mainAssigneeEmployeeId: adminEmpFallback() });
      const res = await authPost(tok.admin, `/tasks/${t}/comments`).send({ content: "" });
      expect(res.status).toBe(400);
    });

    it("task NGOÀI scope đọc (employee @Own, task assignee=mgr) → GET/POST comments đều 404", async () => {
      const t = await mkTask({ mainAssigneeEmployeeId: mgrEmp });
      expect((await authGet(tok.emp, `/tasks/${t}/comments`)).status).toBe(404);
      expect((await authPost(tok.emp, `/tasks/${t}/comments`).send({ content: "hi" })).status).toBe(
        404,
      );
    });

    it("tạo comment → 201/200 + activity COMMENT_CREATED; PATCH bởi NGƯỜI KHÁC → 403; PATCH bởi tác giả → 200", async () => {
      const t = await mkTask({ mainAssigneeEmployeeId: empEmp });
      const created = await authPost(tok.emp, `/tasks/${t}/comments`).send({ content: "Xin chào" });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const commentId = created.body.data.id as string;

      const activity = await direct.query(
        "SELECT count(*)::int n FROM task_activity_logs WHERE task_id=$1 AND action='COMMENT_CREATED'",
        [t],
      );
      expect(activity.rows[0].n).toBe(1);

      // Admin (không phải tác giả) sửa → 403 self-only MVP.
      const patchByOther = await authPatch(tok.admin, `/tasks/${t}/comments/${commentId}`).send({
        content: "sửa bởi admin",
      });
      expect(patchByOther.status).toBe(403);

      // Chính tác giả sửa → 200.
      const patchBySelf = await authPatch(tok.emp, `/tasks/${t}/comments/${commentId}`).send({
        content: "Xin chào (đã sửa)",
      });
      expect(patchBySelf.status, JSON.stringify(patchBySelf.body)).toBe(200);
      expect(patchBySelf.body.data.content).toBe("Xin chào (đã sửa)");
    });

    it("DELETE bởi người khác (KHÔNG phải tác giả, scope < Company) → 403; DELETE bởi admin @Company → 204 soft-delete", async () => {
      const t = await mkTask({ mainAssigneeEmployeeId: empEmp });
      const created = await authPost(tok.emp, `/tasks/${t}/comments`).send({ content: "để xoá" });
      const commentId = created.body.data.id as string;

      // manager @Team KHÔNG phải tác giả và KHÔNG @Company → 403.
      const deniedDelete = await authDelete(tok.mgr, `/tasks/${t}/comments/${commentId}`);
      expect(deniedDelete.status).toBe(403);

      const adminDelete = await authDelete(tok.admin, `/tasks/${t}/comments/${commentId}`);
      expect(adminDelete.status).toBe(204);

      const row = await commentExists(commentId);
      expect(row).toBeDefined();
      expect(row?.deletedAt).not.toBeNull(); // SOFT delete — hàng VẪN CÒN trong DB (BẤT BIẾN #2).

      const activity = await direct.query(
        "SELECT count(*)::int n FROM task_activity_logs WHERE task_id=$1 AND action='COMMENT_DELETED'",
        [t],
      );
      expect(activity.rows[0].n).toBe(1);
    });

    // ── 2. Mention ─────────────────────────────────────────────────────────────

    it("mention người CÓ quyền xem task → 200 + outbox TASK_MENTIONED", async () => {
      const t = await mkTask({ mainAssigneeEmployeeId: mgrEmp });
      const res = await authPost(tok.admin, `/tasks/${t}/comments`).send({
        content: "nhờ @mgr xem",
        mentionEmployeeIds: [mgrEmp],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.mentions).toHaveLength(1);
      expect(res.body.data.mentions[0].employeeId).toBe(mgrEmp);

      const outbox = await direct.query(
        "SELECT payload FROM outbox_events WHERE payload->>'taskId'=$1 AND event_type='task.mentioned' ORDER BY created_at DESC LIMIT 1",
        [t],
      );
      expect(outbox.rows.length).toBe(1);
      expect(outbox.rows[0].payload.eventCode).toBe("TASK_MENTIONED");
      expect(outbox.rows[0].payload.mentionedEmployeeIds).toContain(mgrEmp);
    });

    it("mention người NGOÀI quyền xem task (0 grant) → 403 BLOCK (KHÔNG chỉ cảnh báo)", async () => {
      // outsiderUser KHÔNG có employee_profiles ⇒ trước hết seed 1 hồ sơ KHÔNG grant nào để test đúng
      // nhánh "tồn tại nhưng ngoài scope" (khác nhánh "không tìm thấy nhân viên").
      const outsiderEmp = await seedEmp(A.companyId, outsiderUser, null, null);
      const t = await mkTask({ mainAssigneeEmployeeId: mgrEmp, projectId: null });
      const res = await authPost(tok.admin, `/tasks/${t}/comments`).send({
        content: "nhờ người ngoài xem",
        mentionEmployeeIds: [outsiderEmp],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).toContain("TASK-ERR-MENTION-OUT-OF-SCOPE");

      // KHÔNG comment nào được tạo (mention block ⇒ toàn bộ request thất bại, không tạo nửa vời).
      const count = await direct.query(
        "SELECT count(*)::int n FROM task_comments WHERE task_id=$1",
        [t],
      );
      expect(count.rows[0].n).toBe(0);
    });

    it("mention employeeId không tồn tại → 400", async () => {
      const t = await mkTask({ mainAssigneeEmployeeId: adminEmpFallback() });
      const res = await authPost(tok.admin, `/tasks/${t}/comments`).send({
        content: "mention sai",
        mentionEmployeeIds: ["00000000-0000-0000-0000-000000000000"],
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain("TASK-ERR-MENTION-NOT-FOUND");
    });

    // ── 3. Checklist + items ──────────────────────────────────────────────────

    it("tạo checklist kèm items[] → activity CHECKLIST_CREATED; employee (KHÔNG update:task) → 403", async () => {
      const t = await mkTask({});
      const denied = await authPost(tok.emp, `/tasks/${t}/checklists`).send({
        title: "CL",
        items: ["a"],
      });
      expect(denied.status).toBe(403);

      const res = await authPost(tok.admin, `/tasks/${t}/checklists`).send({
        title: "Triển khai API",
        items: ["Viết endpoint", "Viết test"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.items).toHaveLength(2);

      const activity = await direct.query(
        "SELECT count(*)::int n FROM task_activity_logs WHERE task_id=$1 AND action='CHECKLIST_CREATED'",
        [t],
      );
      expect(activity.rows[0].n).toBe(1);
    });

    it("PATCH tick is_done=true → done_by/done_at set + activity CHECKLIST_ITEM_DONE; list phản ánh đúng progress", async () => {
      const t = await mkTask({});
      const created = await authPost(tok.admin, `/tasks/${t}/checklists`).send({
        title: "CL2",
        items: ["item-1"],
      });
      const checklistId = created.body.data.id as string;
      const itemId = created.body.data.items[0].id as string;

      const tick = await authPatch(
        tok.admin,
        `/tasks/${t}/checklists/${checklistId}/items/${itemId}`,
      ).send({ isDone: true });
      expect(tick.status, JSON.stringify(tick.body)).toBe(200);
      expect(tick.body.data.isDone).toBe(true);
      expect(tick.body.data.doneBy).toBe(adminUser);
      expect(tick.body.data.doneAt).not.toBeNull();

      const activity = await direct.query(
        "SELECT count(*)::int n FROM task_activity_logs WHERE task_id=$1 AND action='CHECKLIST_ITEM_DONE'",
        [t],
      );
      expect(activity.rows[0].n).toBe(1);

      const list = await authGet(tok.admin, `/tasks/${t}/checklists`);
      expect(list.status).toBe(200);
      const cl = list.body.data.find((c: { id: string }) => c.id === checklistId);
      expect(cl.items[0].isDone).toBe(true);
    });

    it("xoá checklist → soft-delete cascade xuống item (deleted_at set, hàng VẪN CÒN)", async () => {
      const t = await mkTask({});
      const created = await authPost(tok.admin, `/tasks/${t}/checklists`).send({
        title: "CL3",
        items: ["x1"],
      });
      const checklistId = created.body.data.id as string;
      const itemId = created.body.data.items[0].id as string;

      const del = await authDelete(tok.admin, `/tasks/${t}/checklists/${checklistId}`);
      expect(del.status).toBe(204);

      const clRow = await direct.query("SELECT deleted_at FROM task_checklists WHERE id=$1", [
        checklistId,
      ]);
      expect(clRow.rows[0].deleted_at).not.toBeNull();
      const itemRow = await direct.query(
        "SELECT deleted_at FROM task_checklist_items WHERE id=$1",
        [itemId],
      );
      expect(itemRow.rows[0].deleted_at).not.toBeNull();

      // GET list KHÔNG còn thấy checklist đã xoá.
      const list = await authGet(tok.admin, `/tasks/${t}/checklists`);
      expect(list.body.data.find((c: { id: string }) => c.id === checklistId)).toBeUndefined();
    });

    // ── helper nội bộ ──────────────────────────────────────────────────────────

    function adminEmpFallback(): null {
      // Task KHÔNG có assignee cụ thể vẫn hợp lệ (admin @Company thấy toàn bộ, không cần assignee-scope).
      return null;
    }
  },
);
