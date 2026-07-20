/**
 * S5-TASK-SUBTASK-1 — Integration (Postgres THẬT, DB CÔ LẬP): cây việc con 1 CẤP — bất biến cấu trúc,
 * board, state_id, D-36a (project của cây), khoá đồng thời (D-33), TASK-API-701/702, cross-tenant.
 *
 * Khuôn theo task-kanban-move-activity.int-spec.ts (helper insert raw + supertest qua đường thật) và
 * attendance-adjustment.int.spec.ts:520-551 (Promise.all cùng tick chứng minh row-lock serialize THẬT).
 *
 * Mỗi ca ghi comment trỏ mã quyết định D-xx (docs/DECISIONS/DECISIONS-05_Task_Subtask_And_Leaf_Counting.md).
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate — .env làm hasDb=true ⇒ false-red).
 * Chạy: export LANE_DB=mediaos_subtask1 && pnpm --filter @mediaos/api exec vitest run
 *   test/integration/task-subtask-tree --no-file-parallelism
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
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
const LOGIN_PW = "Passw0rd!subtreeQA1";

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, resourceType: string, scope: Scope, isSensitive?: boolean];

describe.skipIf(!hasLaneDb)(
  "S5-TASK-SUBTASK-1 — cây việc con: cấu trúc/board/state/khoá (DB cô lập)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let caUser = ""; // Company scope — CRUD task/project chính
    let ownUser = ""; // Own scope — dùng cho test canOpen của TASK-API-701
    let ownEmp = "";
    let otherEmp = ""; // assignee KHÁC ownEmp — con "ngoài tầm với" của ownUser
    let bAdminUser = "";
    let P1 = "";
    let P2 = "";

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
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
        [companyId, userId, orgUnitId],
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

    /** Task raw của company KHÁC (bypass app-layer) — dùng cho ca cross-tenant. */
    async function mkTaskRaw(
      companyId: string,
      creatorUserId: string,
      title: string,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, task_status, creator_user_id)
       VALUES ($1,'office',$2,'Todo',$3) RETURNING id`,
        [companyId, title, creatorUserId],
      );
      return r.rows[0].id as string;
    }

    async function grant(
      companyId: string,
      userId: string,
      label: string,
      pairs: Pair[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `subtree-${label}-${userId.slice(0, 8)}`);
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

    /** POST /tasks qua đường thật (tCa mặc định) — trả id. */
    async function createTask(
      token: string,
      body: Record<string, unknown>,
    ): Promise<{ status: number; id: string; body: unknown }> {
      const res = await authPost(token, "/tasks").send(body);
      return { status: res.status, id: res.body?.data?.id as string, body: res.body };
    }

    async function queryTask(id: string): Promise<{
      parent_task_id: string | null;
      deleted_at: string | null;
      project_id: string | null;
      state_id: string | null;
      sort_order: number | null;
      task_status: string | null;
    }> {
      const r = await direct.query(
        "SELECT parent_task_id, deleted_at, project_id, state_id, sort_order, task_status FROM tasks WHERE id=$1",
        [id],
      );
      return r.rows[0];
    }

    /** GET /projects/:id/kanban (columnMode:'status' — 0 state seeded) → ids theo cột. */
    async function boardIdsByStatus(
      token: string,
      projectId: string,
      status: string,
    ): Promise<string[]> {
      const res = await authGet(token, `/projects/${projectId}/kanban`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const cols = res.body.data.columns as Array<{ status: string; tasks: Array<{ id: string }> }>;
      return (cols.find((c) => c.status === status)?.tasks ?? []).map((t) => t.id);
    }

    async function boardAllIds(token: string, projectId: string): Promise<string[]> {
      const res = await authGet(token, `/projects/${projectId}/kanban`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const cols = res.body.data.columns as Array<{ tasks: Array<{ id: string }> }>;
      return cols.flatMap((c) => c.tasks.map((t) => t.id));
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "subtreeA");
      B = await seedCompany(direct, "subtreeB");
      companyIds.push(A.companyId, B.companyId);

      const ou = await seedOrgUnit(A.companyId, "Engineering");

      caUser = await seedUser(direct, A.companyId, `ca@${A.slug}.test`, hash);
      ownUser = await seedUser(direct, A.companyId, `own@${A.slug}.test`, hash);
      const otherUser = await seedUser(direct, A.companyId, `other@${A.slug}.test`, hash);
      await seedEmp(A.companyId, caUser, ou);
      ownEmp = await seedEmp(A.companyId, ownUser, ou);
      otherEmp = await seedEmp(A.companyId, otherUser, ou);

      P1 = await seedProject(A.companyId, "P1");
      P2 = await seedProject(A.companyId, "P2");

      await grant(A.companyId, caUser, "ca", [
        ["create", "task", "Company"],
        ["read", "task", "Company"],
        ["update", "task", "Company"],
        ["delete", "task", "Company", true],
        ["update-state", "task", "Company"],
        ["update-status", "task", "Company"],
        // view-kanban:task — GET /projects/:id/kanban gate riêng (KHÁC read:task); thiếu cặp này ⇒
        // 403 deny-default (lỗi setup fixture bắt được lúc chạy lần đầu, KHÔNG phải lỗi code — mirror
        // đúng cặp mà task-kanban-move-activity.int-spec.ts đã cấp cho actor board của nó).
        ["view-kanban", "task", "Company"],
        ["create", "project", "Company"],
        ["read", "project", "Company"],
        ["update", "project", "Company"],
      ]);
      await grant(A.companyId, ownUser, "own", [
        ["create", "task", "Own"],
        ["read", "task", "Own"],
        ["update", "task", "Own"],
      ]);

      bAdminUser = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
      await seedEmp(B.companyId, bAdminUser, null);
      await grant(B.companyId, bAdminUser, "b-admin", [
        ["create", "task", "Company"],
        ["read", "task", "Company"],
      ]);

      tok.ca = await login(A.slug, `ca@${A.slug}.test`);
      tok.own = await login(A.slug, `own@${A.slug}.test`);
      tok.bAdmin = await login(B.slug, `admin@${B.slug}.test`);
    });

    afterAll(async () => {
      if (direct && companyIds.length) {
        for (const tbl of [
          "task_activity_logs",
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
      await app?.close();
      await direct?.end();
    });

    // ══ 1. Cây đúng 1 cấp — deny-path TRƯỚC (D-33) ═══════════════════════════════════════════════

    describe("1. cây 1 cấp — 400/404 đúng mã (D-33)", () => {
      it("tạo con của một con ⇒ 400 TASK-ERR-044 (luật c — cha phải là GỐC)", async () => {
        const parent = await createTask(tok.ca, { title: "Cha S1" });
        expect(parent.status).toBe(201);
        const child = await createTask(tok.ca, { title: "Con S1", parentTaskId: parent.id });
        expect(child.status).toBe(201);

        const res = await authPost(tok.ca, "/tasks").send({
          title: "Cháu S1",
          parentTaskId: child.id,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(400);
        expect(JSON.stringify(res.body)).toContain("TASK-ERR-044");
      });

      it("PATCH gán cha cho task ĐANG CÓ con ⇒ 400 TASK-ERR-045 (luật d)", async () => {
        const parent = await createTask(tok.ca, { title: "Cha S2" });
        const child = await createTask(tok.ca, { title: "Con S2", parentTaskId: parent.id });
        expect(child.status).toBe(201);
        const otherRoot = await createTask(tok.ca, { title: "Gốc khác S2" });

        const res = await authPatch(tok.ca, `/tasks/${parent.id}`).send({
          parentTaskId: otherRoot.id,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(400);
        expect(JSON.stringify(res.body)).toContain("TASK-ERR-045");
      });

      it("parentTaskId = chính id ⇒ 400 sạch (KHÔNG 500/23514 raw)", async () => {
        const t = await createTask(tok.ca, { title: "Tự làm cha chính mình" });
        const res = await authPatch(tok.ca, `/tasks/${t.id}`).send({ parentTaskId: t.id });
        expect(res.status, JSON.stringify(res.body)).toBe(400);
        expect(res.status).not.toBe(500);
      });

      it("cha ở PROJECT KHÁC ⇒ 400 TASK-ERR-046 (D-36 cùng dự án)", async () => {
        const parent = await createTask(tok.ca, { title: "Cha proj1", projectId: P1 });
        expect(parent.status).toBe(201);
        const res = await authPost(tok.ca, "/tasks").send({
          title: "Con lệch dự án",
          parentTaskId: parent.id,
          projectId: P2,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(400);
        expect(JSON.stringify(res.body)).toContain("TASK-ERR-046");
      });

      it("cha ở COMPANY KHÁC ⇒ 404 TASK-ERR-043 (không lộ tồn tại)", async () => {
        const bTask = await mkTaskRaw(B.companyId, bAdminUser, "B task cha ngoại lai");
        const res = await authPost(tok.ca, "/tasks").send({
          title: "Con nhận cha ngoại",
          parentTaskId: bTask,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(404);
        expect(JSON.stringify(res.body)).toContain("TASK-ERR-043");
      });
    });

    // ══ 2. Board bất biến (D-36) ═══════════════════════════════════════════════════════════════════

    describe("2. board chỉ hiện cha", () => {
      it("tạo 3 subtask QUA API ⇒ đếm cột KHÔNG đổi; board không chứa id con; gửi stateId khi tạo con ⇒ 400", async () => {
        const parent = await createTask(tok.ca, { title: "Cha board", projectId: P1 });
        expect(parent.status).toBe(201);
        const before = await boardIdsByStatus(tok.ca, P1, "Todo");
        expect(before).toContain(parent.id);
        const beforeCount = before.length;

        const c1 = await createTask(tok.ca, { title: "Con board 1", parentTaskId: parent.id });
        const c2 = await createTask(tok.ca, { title: "Con board 2", parentTaskId: parent.id });
        const c3 = await createTask(tok.ca, { title: "Con board 3", parentTaskId: parent.id });
        expect([c1.status, c2.status, c3.status]).toEqual([201, 201, 201]);

        const after = await boardIdsByStatus(tok.ca, P1, "Todo");
        expect(after.length, JSON.stringify(after)).toBe(beforeCount);
        expect(after).not.toContain(c1.id);
        expect(after).not.toContain(c2.id);
        expect(after).not.toContain(c3.id);

        // D-36 — client gửi kèm stateId khi tạo con ⇒ từ chối tường minh (không nuốt im lặng).
        const denied = await authPost(tok.ca, "/tasks").send({
          title: "Con đòi có cột",
          parentTaskId: parent.id,
          stateId: randomUUID(),
        });
        expect(denied.status, JSON.stringify(denied.body)).toBe(400);
      });
    });

    // ══ 3. state_id GIỮ NULL SAU KHI ĐỔI TRẠNG THÁI (D-36) — ca dễ xanh-giả nhất ═════════════════════

    describe("3. state_id ép NULL và GIỮ NULL qua mọi writer", () => {
      it("tạo con → change-status Done → state_id VẪN NULL + board không đổi (kiểm chỉ-lúc-tạo là xanh giả)", async () => {
        const parent = await createTask(tok.ca, { title: "Cha state1", projectId: P1 });
        const child = await createTask(tok.ca, { title: "Con state1", parentTaskId: parent.id });
        expect(child.status).toBe(201);

        let row = await queryTask(child.id);
        expect(row.state_id).toBeNull();

        const boardBefore = await boardAllIds(tok.ca, P1);

        const res = await authPost(tok.ca, `/tasks/${child.id}/change-status`).send({
          status: "Done",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(200);

        row = await queryTask(child.id);
        expect(
          row.state_id,
          "syncStateWithStatusTx PHẢI early-return khi task có parent_task_id (D-36)",
        ).toBeNull();

        const boardAfter = await boardAllIds(tok.ca, P1);
        expect(boardAfter).toEqual(boardBefore);
        expect(boardAfter).not.toContain(child.id);
      });

      it("hai writer CÒN LẠI của state_id đều bị chốt: move-state ⇒ 400 (state vẫn NULL); PATCH {stateId} ⇒ 400", async () => {
        const parent = await createTask(tok.ca, { title: "Cha state2", projectId: P1 });
        const child = await createTask(tok.ca, { title: "Con state2", parentTaskId: parent.id });

        const moveRes = await authPost(tok.ca, `/tasks/${child.id}/move-state`).send({
          stateId: randomUUID(),
        });
        expect(moveRes.status, JSON.stringify(moveRes.body)).toBe(400);
        let row = await queryTask(child.id);
        expect(row.state_id).toBeNull();

        const patchRes = await authPatch(tok.ca, `/tasks/${child.id}`).send({
          stateId: randomUUID(),
        });
        expect(patchRes.status, JSON.stringify(patchRes.body)).toBe(400);
        row = await queryTask(child.id);
        expect(row.state_id).toBeNull();
      });
    });

    // ══ 4. D-36a — dự án của cây là bất biến ═══════════════════════════════════════════════════════

    describe("4. D-36a PATCH {projectId} bị khoá khi có cây", () => {
      it("PATCH task-CÓ-con {projectId} ⇒ 400 và project_id của CẢ cha lẫn con KHÔNG đổi", async () => {
        const parent = await createTask(tok.ca, { title: "Cha D36a", projectId: P1 });
        const child = await createTask(tok.ca, { title: "Con D36a", parentTaskId: parent.id });
        expect(child.status).toBe(201);

        const res = await authPatch(tok.ca, `/tasks/${parent.id}`).send({ projectId: P2 });
        expect(res.status, JSON.stringify(res.body)).toBe(400);

        const parentRow = await queryTask(parent.id);
        const childRow = await queryTask(child.id);
        expect(parentRow.project_id).toBe(P1);
        expect(childRow.project_id).toBe(P1);
      });

      it("PATCH task-LÀ-con {projectId} ⇒ 400 (dự án của con do cha quyết)", async () => {
        const parent = await createTask(tok.ca, { title: "Cha D36a-2", projectId: P1 });
        const child = await createTask(tok.ca, { title: "Con D36a-2", parentTaskId: parent.id });

        const res = await authPatch(tok.ca, `/tasks/${child.id}`).send({ projectId: P2 });
        expect(res.status, JSON.stringify(res.body)).toBe(400);
        const childRow = await queryTask(child.id);
        expect(childRow.project_id).toBe(P1);
      });
    });

    // ══ 11. Đồng thời — luật khoá D-33 là MỘT PHẦN của bất biến, không phải tối ưu ═══════════════════

    describe("11. đồng thời — Promise.all cùng tick chứng minh row-lock serialize THẬT", () => {
      it("PATCH A{parent:B} ‖ PATCH B{parent:A} ⇒ đúng 1 tx thắng, KHÔNG tạo được chu trình", async () => {
        const a = await createTask(tok.ca, { title: "A vòng tròn" });
        const b = await createTask(tok.ca, { title: "B vòng tròn" });

        const [ra, rb] = await Promise.all([
          authPatch(tok.ca, `/tasks/${a.id}`).send({ parentTaskId: b.id }),
          authPatch(tok.ca, `/tasks/${b.id}`).send({ parentTaskId: a.id }),
        ]);

        const statuses = [ra.status, rb.status].sort((x, y) => x - y);
        expect(
          statuses,
          `ra=${ra.status} rb=${rb.status} bodies=${JSON.stringify([ra.body, rb.body])}`,
        ).toEqual([200, 400]);

        const rowA = await queryTask(a.id);
        const rowB = await queryTask(b.id);
        const cycle = rowA.parent_task_id === b.id && rowB.parent_task_id === a.id;
        expect(cycle, `A.parent=${rowA.parent_task_id} B.parent=${rowB.parent_task_id}`).toBe(
          false,
        );
      });

      it("DELETE oldP ‖ PATCH T{parent:newP} ⇒ T KHÔNG bị xoá lan dù đã chuyển sang cha khác (oldP BẮT BUỘC trong tập khoá)", async () => {
        const oldP = await createTask(tok.ca, { title: "Cha cũ (oldP)" });
        const t = await createTask(tok.ca, { title: "Con T", parentTaskId: oldP.id });
        expect(t.status).toBe(201);
        const newP = await createTask(tok.ca, { title: "Cha mới (newP)" });

        const [rDel, rPatch] = await Promise.all([
          authDelete(tok.ca, `/tasks/${oldP.id}`),
          authPatch(tok.ca, `/tasks/${t.id}`).send({ parentTaskId: newP.id }),
        ]);

        const row = await queryTask(t.id);
        // Bug thật (rev2, đã vá bằng oldP-trong-tập-khoá): T reparented sang newP MÀ VẪN bị xoá lan từ oldP.
        // Hai kết cục hợp lệ còn lại: (a) DELETE thắng, T thật sự còn là con oldP lúc đó ⇒ xoá lan ĐÚNG,
        // PATCH nhận 404 khi soi lại; (b) PATCH thắng, T sang newP ⇒ DELETE re-read thấy tập con đổi, 409
        // fail-closed KHÔNG xoá gì (nhánh 409 "unreachable" của D-33 — không assert status cụ thể ở đây,
        // chỉ assert bất biến CUỐI CÙNG không rơi vào trạng thái sai).
        const badState = row.deleted_at !== null && row.parent_task_id === newP.id;
        expect(
          badState,
          `del=${rDel.status} patch=${rPatch.status} t.deleted_at=${row.deleted_at} t.parent=${row.parent_task_id}`,
        ).toBe(false);
      });
    });

    // ══ 12. TASK-API-701 GET /tasks/:id/subtasks ════════════════════════════════════════════════════

    describe("12. TASK-API-701 listSubtasks", () => {
      it("mảng TRẦN sort_order NULLS LAST rồi created_at; company B ⇒ 404; task không con ⇒ mảng RỖNG", async () => {
        const parent = await createTask(tok.ca, { title: "Cha subtasks" });
        const noChild = await createTask(tok.ca, { title: "Không con" });

        const emptyRes = await authGet(tok.ca, `/tasks/${noChild.id}/subtasks`);
        expect(emptyRes.status, JSON.stringify(emptyRes.body)).toBe(200);
        expect(Array.isArray(emptyRes.body.data)).toBe(true);
        expect(emptyRes.body.data).toEqual([]);

        const c1 = await createTask(tok.ca, { title: "C1 order", parentTaskId: parent.id });
        const c2 = await createTask(tok.ca, { title: "C2 order", parentTaskId: parent.id });
        expect(c1.status).toBe(201);
        expect(c2.status).toBe(201);

        // reorder c2 lên trước, c1 xuống sau ⇒ cả hai có sort_order xác định.
        const reorderRes = await authPatch(tok.ca, `/tasks/${parent.id}/subtasks/reorder`).send({
          subtaskIds: [c2.id, c1.id],
        });
        expect(reorderRes.status, JSON.stringify(reorderRes.body)).toBe(200);

        // con MỚI c3 chưa qua reorder ⇒ sort_order NULL ⇒ phải rơi XUỐNG CUỐI (NULLS LAST) dù created SAU.
        const c3 = await createTask(tok.ca, { title: "C3 sau reorder", parentTaskId: parent.id });
        expect(c3.status).toBe(201);

        const listRes = await authGet(tok.ca, `/tasks/${parent.id}/subtasks`);
        expect(listRes.status, JSON.stringify(listRes.body)).toBe(200);
        const ids = (listRes.body.data as Array<{ id: string }>).map((r) => r.id);
        expect(ids).toEqual([c2.id, c1.id, c3.id]);

        // company B ⇒ 404 (không lộ tồn tại).
        const bTask = await mkTaskRaw(B.companyId, bAdminUser, "B task subtasks");
        const crossRes = await authGet(tok.ca, `/tasks/${bTask}/subtasks`);
        expect(crossRes.status).toBe(404);
      });

      it("D-39 đọc thừa hưởng: đọc được cha ⇒ thấy đủ con kể cả con giao người khác; canOpen phản ánh phạm vi GHI riêng lẻ", async () => {
        // ownUser Own-scope: cha assignee=ownEmp (trong scope); 1 con assignee=ownEmp (canOpen true),
        // 1 con assignee=otherEmp (canOpen false — D-39: ghi KHÔNG thừa hưởng).
        const parent = await createTask(tok.ca, { title: "Cha D39", assigneeEmployeeId: ownEmp });
        expect(parent.status).toBe(201);
        const cMine = await createTask(tok.ca, {
          title: "Con của own",
          parentTaskId: parent.id,
          assigneeEmployeeId: ownEmp,
        });
        const cOther = await createTask(tok.ca, {
          title: "Con của người khác",
          parentTaskId: parent.id,
          assigneeEmployeeId: otherEmp,
        });
        expect(cMine.status).toBe(201);
        expect(cOther.status).toBe(201);

        const res = await authGet(tok.own, `/tasks/${parent.id}/subtasks`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const rows = res.body.data as Array<{ id: string; canOpen: boolean }>;
        const ids = rows.map((r) => r.id);
        expect(ids).toContain(cMine.id);
        expect(ids, "D-39: con giao người khác VẪN hiện — đọc thừa hưởng từ cha").toContain(
          cOther.id,
        );

        const mineRow = rows.find((r) => r.id === cMine.id);
        const otherRow = rows.find((r) => r.id === cOther.id);
        expect(mineRow?.canOpen).toBe(true);
        expect(
          otherRow?.canOpen,
          "ghi KHÔNG thừa hưởng — Own-scope không mở được con của người khác",
        ).toBe(false);
      });
    });

    // ══ 13. TASK-API-702 PATCH reorder ══════════════════════════════════════════════════════════════

    describe("13. TASK-API-702 reorder", () => {
      it("thứ tự đúng; thiếu 1 id / thừa id lạ / id con của cha khác / company B ⇒ 400 và sort_order KHÔNG đổi hàng nào", async () => {
        const parent = await createTask(tok.ca, { title: "Cha reorder" });
        const c1 = await createTask(tok.ca, { title: "RC1", parentTaskId: parent.id });
        const c2 = await createTask(tok.ca, { title: "RC2", parentTaskId: parent.id });
        const c3 = await createTask(tok.ca, { title: "RC3", parentTaskId: parent.id });
        expect([c1.status, c2.status, c3.status]).toEqual([201, 201, 201]);

        const ok = await authPatch(tok.ca, `/tasks/${parent.id}/subtasks/reorder`).send({
          subtaskIds: [c3.id, c1.id, c2.id],
        });
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
        expect((ok.body.data as Array<{ id: string }>).map((r) => r.id)).toEqual([
          c3.id,
          c1.id,
          c2.id,
        ]);

        const before = await Promise.all([c1.id, c2.id, c3.id].map((id) => queryTask(id)));

        const missing = await authPatch(tok.ca, `/tasks/${parent.id}/subtasks/reorder`).send({
          subtaskIds: [c1.id, c2.id],
        });
        expect(missing.status, JSON.stringify(missing.body)).toBe(400);

        const extra = await authPatch(tok.ca, `/tasks/${parent.id}/subtasks/reorder`).send({
          subtaskIds: [c1.id, c2.id, c3.id, randomUUID()],
        });
        expect(extra.status, JSON.stringify(extra.body)).toBe(400);

        const otherParent = await createTask(tok.ca, { title: "Cha khác reorder" });
        const otherChild = await createTask(tok.ca, {
          title: "Con của cha khác",
          parentTaskId: otherParent.id,
        });
        const wrongParent = await authPatch(tok.ca, `/tasks/${parent.id}/subtasks/reorder`).send({
          subtaskIds: [c1.id, c2.id, otherChild.id],
        });
        expect(wrongParent.status, JSON.stringify(wrongParent.body)).toBe(400);

        const bTask = await mkTaskRaw(B.companyId, bAdminUser, "B task reorder");
        const crossTenant = await authPatch(tok.ca, `/tasks/${parent.id}/subtasks/reorder`).send({
          subtaskIds: [c1.id, c2.id, bTask],
        });
        expect(crossTenant.status, JSON.stringify(crossTenant.body)).toBe(400);

        const after = await Promise.all([c1.id, c2.id, c3.id].map((id) => queryTask(id)));
        expect(after.map((r) => r.sort_order)).toEqual(before.map((r) => r.sort_order));
      });
    });

    // ══ 14. Cross-tenant (mọi route/field mới) + FK composite chống cross-tenant Ở TẦNG DB ═══════════

    describe("14. cross-tenant", () => {
      it("PATCH task company B ⇒ 404 (không lộ tồn tại)", async () => {
        const bTask = await mkTaskRaw(B.companyId, bAdminUser, "B task patch");
        const res = await authPatch(tok.ca, `/tasks/${bTask}`).send({ title: "hacked" });
        expect(res.status).toBe(404);
      });

      it("FK composite (parent_task_id, company_id) chặn cha cross-tenant Ở TẦNG DB — insert THÔ bỏ qua app-layer", async () => {
        const aTask = await mkTaskRaw(A.companyId, caUser, "A task fk");
        const bTask = await mkTaskRaw(B.companyId, bAdminUser, "B task fk");
        await expect(
          direct.query("UPDATE tasks SET parent_task_id = $1 WHERE id = $2", [bTask, aTask]),
        ).rejects.toMatchObject({ code: "23503" });
      });
    });

    // ══ BUG PHÁT HIỆN — GIỮ NGUYÊN test, KHÔNG sửa assertion cho khớp code sai ═══════════════════════

    describe("[FINDING] toDto() thiếu field parentTaskId trên GET/POST/PATCH (chỉ Kanban mapper có)", () => {
      it("GET /tasks/:id phải trả về parentTaskId ĐÚNG giá trị DB — RED nếu service dùng nhầm toDto() private (không phải task-core.mapper.ts)", async () => {
        const parent = await createTask(tok.ca, { title: "Cha lộ field" });
        const child = await createTask(tok.ca, { title: "Con lộ field", parentTaskId: parent.id });
        expect(child.status).toBe(201);

        const res = await authGet(tok.ca, `/tasks/${child.id}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        // task-core.service.ts:toDto() (private, dùng cho listTasks/getTask/createTask/updateTask/moveState)
        // KHÔNG map row.parentTaskId — chỉ task-core.mapper.ts:toTaskCoreDto() (dùng RIÊNG cho Kanban board)
        // có dòng `parentTaskId: row.parentTaskId ?? null`. Hai hàm là bản COPY tách nhau (S4-TASK-BE-4
        // docblock tự thừa nhận) và WO này chỉ sửa một bản. Hệ quả: GET/POST/PATCH /tasks không BAO GIỜ
        // lộ parentTaskId cho FE dù DB đã lưu đúng — đây là lỗi thật, KHÔNG phải test sai. Xem báo cáo QA.
        expect(res.body.data.parentTaskId, JSON.stringify(res.body.data)).toBe(parent.id);
      });
    });
  },
);
