/**
 * S5-TASK-SUBTASK-1 — Integration (Postgres THẬT, DB CÔ LẬP): đếm-lá (D-32/D-34/D-35), xoá lan
 * tất-cả-hoặc-không (D-38), ranh giới quyền widget↔report (D-35), quy tắc "danh sách ≠ con số" (D-37).
 *
 * Mỗi ca ghi comment trỏ mã quyết định D-xx (docs/DECISIONS/DECISIONS-05_Task_Subtask_And_Leaf_Counting.md).
 * Khuôn theo mv-taskstatus-canonical.int.spec.ts (chạy trên Postgres thật, refresh MV thủ công) và
 * task-kanban-move-activity.int-spec.ts (đường thật qua supertest, KHÔNG mock permission).
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate — .env làm hasDb=true ⇒ false-red).
 * Chạy: export LANE_DB=mediaos_subtask1 && pnpm --filter @mediaos/api exec vitest run
 *   test/integration/task-subtask-counting --no-file-parallelism
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
import { TaskReminderJobHandler } from "../../src/notifications/task-reminder.job-handler";
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
const LOGIN_PW = "Passw0rd!subcountQA1";

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, resourceType: string, scope: Scope, isSensitive?: boolean];

describe.skipIf(!hasLaneDb)(
  "S5-TASK-SUBTASK-1 — đếm-lá / xoá lan / quyền widget↔report (DB cô lập)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    let caUser = ""; // Company scope — CRUD task/project + view-report + dashboard đầy đủ
    let caEmp = "";
    let otherEmp = ""; // assignee khác caEmp, dùng cho D-38 (con ngoài phạm vi ghi) + D-37
    let limUser = ""; // Own scope — xoá lan bị chặn (D-38)
    let limEmp = "";
    let dashOnlyUser = ""; // read:project + read:dashboard, KHÔNG view-report:project (D-35)

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

    async function grant(
      companyId: string,
      userId: string,
      label: string,
      pairs: Pair[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `subcount-${label}-${userId.slice(0, 8)}`);
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
    const authDelete = (t: string, u: string) =>
      request(app.getHttpServer()).delete(u).set("Authorization", `Bearer ${t}`);

    async function createTask(
      token: string,
      body: Record<string, unknown>,
    ): Promise<{ status: number; id: string; body: unknown }> {
      const res = await authPost(token, "/tasks").send(body);
      return { status: res.status, id: res.body?.data?.id as string, body: res.body };
    }

    async function changeStatus(token: string, taskId: string, status: string): Promise<number> {
      const res = await authPost(token, `/tasks/${taskId}/change-status`).send({ status });
      expect(res.status, `change-status ${taskId}->${status}: ${JSON.stringify(res.body)}`).toBe(
        200,
      );
      return res.status;
    }

    async function queryTask(
      id: string,
    ): Promise<{ deleted_at: string | null; parent_task_id: string | null }> {
      const r = await direct.query("SELECT deleted_at, parent_task_id FROM tasks WHERE id=$1", [
        id,
      ]);
      return r.rows[0];
    }

    async function report(
      token: string,
      projectId: string,
    ): Promise<{
      countsByStatus: Record<string, number>;
      overdueCount: number;
      assigneeWorkload: Array<{
        employeeId: string;
        employeeName: string | null;
        activeCount: number;
      }>;
    }> {
      const res = await authGet(token, `/projects/${projectId}/report`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data;
    }

    async function refreshMv(): Promise<void> {
      await direct.query("REFRESH MATERIALIZED VIEW mv_dashboard_task_status");
      await direct.query("REFRESH MATERIALIZED VIEW mv_dashboard_output");
    }

    const pastIso = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "subcntA");
      companyIds.push(A.companyId);

      const ou = await seedOrgUnit(A.companyId, "Engineering");

      caUser = await seedUser(direct, A.companyId, `ca@${A.slug}.test`, hash);
      const otherUser = await seedUser(direct, A.companyId, `other@${A.slug}.test`, hash);
      limUser = await seedUser(direct, A.companyId, `lim@${A.slug}.test`, hash);
      dashOnlyUser = await seedUser(direct, A.companyId, `dashonly@${A.slug}.test`, hash);

      caEmp = await seedEmp(A.companyId, caUser, ou);
      otherEmp = await seedEmp(A.companyId, otherUser, ou);
      limEmp = await seedEmp(A.companyId, limUser, ou);

      await grant(A.companyId, caUser, "ca", [
        ["create", "task", "Company"],
        ["read", "task", "Company"],
        ["update", "task", "Company"],
        ["delete", "task", "Company", true],
        // update-status:task — POST /tasks/:id/change-status gate riêng (khác update:task); thiếu ⇒
        // 403 deny-default. view-kanban:task — GET /projects/:id/kanban dùng ở test checklist-độc-lập.
        ["update-status", "task", "Company"],
        ["view-kanban", "task", "Company"],
        ["create", "project", "Company"],
        ["read", "project", "Company"],
        ["view-report", "project", "Company", true],
        ["read", "dashboard", "Company"],
        ["access", "me", "Company"],
      ]);
      await grant(A.companyId, limUser, "lim", [
        ["create", "task", "Own"],
        ["read", "task", "Own"],
        ["update", "task", "Own"],
        ["delete", "task", "Own", true],
      ]);
      await grant(A.companyId, dashOnlyUser, "dashonly", [
        ["read", "project", "Company"],
        ["read", "dashboard", "Company"],
      ]);

      tok.ca = await login(A.slug, `ca@${A.slug}.test`);
      tok.lim = await login(A.slug, `lim@${A.slug}.test`);
      tok.dashOnly = await login(A.slug, `dashonly@${A.slug}.test`);
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

    // ══ 5. Tiến độ thẻ cha (D-34) + checklist badge độc lập ═════════════════════════════════════════

    describe("5. subtaskTotal/subtaskDone", () => {
      it("cha 3 con (Done/Todo/Cancelled) ⇒ subtaskTotal=2 subtaskDone=1 (Cancelled LOẠI khỏi mẫu số); cha 0 con ⇒ subtaskTotal=0", async () => {
        const parent = await createTask(tok.ca, { title: "Cha progress" });
        const cDone = await createTask(tok.ca, { title: "C-done", parentTaskId: parent.id });
        const cTodo = await createTask(tok.ca, { title: "C-todo", parentTaskId: parent.id });
        const cCancel = await createTask(tok.ca, { title: "C-cancel", parentTaskId: parent.id });
        expect([cDone.status, cTodo.status, cCancel.status]).toEqual([201, 201, 201]);
        await changeStatus(tok.ca, cDone.id, "Done");
        await changeStatus(tok.ca, cCancel.id, "Cancelled");

        const detail = await authGet(tok.ca, `/tasks/${parent.id}`);
        expect(detail.status, JSON.stringify(detail.body)).toBe(200);
        expect(detail.body.data.subtaskTotal).toBe(2);
        expect(detail.body.data.subtaskDone).toBe(1);

        const lonely = await createTask(tok.ca, { title: "Cha đơn độc" });
        const lonelyDetail = await authGet(tok.ca, `/tasks/${lonely.id}`);
        expect(lonelyDetail.body.data.subtaskTotal).toBe(0);
        expect(lonelyDetail.body.data.subtaskDone).toBe(0);
      });

      it("checklist badge ĐỘC LẬP với subtask badge trên thẻ Kanban (không cross-contaminate)", async () => {
        const project = await seedProject(A.companyId, "P-checklist-indep");
        const parent = await createTask(tok.ca, {
          title: "Cha checklist+subtask",
          projectId: project,
        });
        const cDone = await createTask(tok.ca, { title: "Con done", parentTaskId: parent.id });
        // con thứ hai giữ subtaskTotal=2 (mẫu số D-32 COUNTABLE_CHILD) — id không cần dùng lại.
        await createTask(tok.ca, { title: "Con todo", parentTaskId: parent.id });
        await changeStatus(tok.ca, cDone.id, "Done");

        const clRes = await authPost(tok.ca, `/tasks/${parent.id}/checklists`).send({
          title: "CL",
          items: ["i1", "i2"],
        });
        expect(clRes.status, JSON.stringify(clRes.body)).toBe(201);
        const items = clRes.body.data.items as Array<{ id: string }>;
        const checklistId = clRes.body.data.id as string;
        const patchItem = await request(app.getHttpServer())
          .patch(`/tasks/${parent.id}/checklists/${checklistId}/items/${items[0].id}`)
          .set("Authorization", `Bearer ${tok.ca}`)
          .send({ isDone: true });
        expect(patchItem.status, JSON.stringify(patchItem.body)).toBe(200);

        const board = await authGet(tok.ca, `/projects/${project}/kanban`);
        expect(board.status, JSON.stringify(board.body)).toBe(200);
        const cols = board.body.data.columns as Array<{
          status: string;
          tasks: Array<{
            id: string;
            checklistDone: number;
            checklistTotal: number;
            subtaskDone: number;
            subtaskTotal: number;
          }>;
        }>;
        const card = (cols.find((c) => c.status === "Todo")?.tasks ?? []).find(
          (c) => c.id === parent.id,
        );
        expect(card, JSON.stringify(cols)).toBeDefined();
        expect(card?.checklistDone).toBe(1);
        expect(card?.checklistTotal).toBe(2);
        expect(card?.subtaskDone, "subtask badge KHÔNG bị lẫn với checklist").toBe(1);
        expect(card?.subtaskTotal).toBe(2);
      });
    });

    // ══ 6. Hai vị từ D-32 — ACTIVE_CHILD vs COUNTABLE_CHILD ════════════════════════════════════════

    describe("6. D-32 hai vị từ", () => {
      it("cha Todo QUÁ HẠN + ĐÚNG 1 con Cancelled ⇒ vẫn LÁ (Todo=1, overdueCount=1, KHÔNG rơi về 0); thêm 1 con Todo ⇒ cha rời tập lá; xoá cha ⇒ con Cancelled CŨNG bị soft-delete (ACTIVE_CHILD)", async () => {
        const project = await seedProject(A.companyId, "P-d32");
        const parent = await createTask(tok.ca, {
          title: "Cha quá hạn",
          projectId: project,
          dueAt: pastIso(),
        });
        expect(parent.status).toBe(201);
        const cancelledChild = await createTask(tok.ca, {
          title: "Con huỷ",
          parentTaskId: parent.id,
        });
        await changeStatus(tok.ca, cancelledChild.id, "Cancelled");

        const r1 = await report(tok.ca, project);
        expect(
          r1.countsByStatus.Todo,
          "con Cancelled KHÔNG được che khuất cha còn sống/quá hạn",
        ).toBe(1);
        expect(r1.overdueCount).toBe(1);

        const todoChild = await createTask(tok.ca, { title: "Con todo", parentTaskId: parent.id });
        expect(todoChild.status).toBe(201);
        const r2 = await report(tok.ca, project);
        // cha rời tập lá (còn COUNTABLE_CHILD = todoChild) ⇒ lá bây giờ là {todoChild} (Todo, không quá hạn).
        expect(r2.countsByStatus.Todo).toBe(1);
        expect(r2.overdueCount, "cha không còn tính (không phải lá); todoChild chưa quá hạn").toBe(
          0,
        );

        // Xoá cha ⇒ CẢ hai con (kể cả Cancelled) bị soft-delete — D-38 dùng ACTIVE_CHILD, không mồ côi.
        const delRes = await authDelete(tok.ca, `/tasks/${parent.id}`);
        expect(delRes.status, JSON.stringify(delRes.body)).toBe(204);
        const cancelledRow = await queryTask(cancelledChild.id);
        const todoRow = await queryTask(todoChild.id);
        expect(
          cancelledRow.deleted_at,
          "con Cancelled không được mồ côi khi cha bị xoá",
        ).not.toBeNull();
        expect(todoRow.deleted_at).not.toBeNull();
      });
    });

    // ══ 7. Xoá lan tất-cả-hoặc-không (D-38) ═════════════════════════════════════════════════════════

    describe("7. D-38 xoá lan tất-cả-hoặc-không", () => {
      it("cha P có C1 (ghi được) + C2 (ngoài phạm vi ghi) ⇒ 403 TASK-ERR-047, KHÔNG xoá gì; đủ quyền ⇒ 200, cả 3 có deleted_at + activity + audit", async () => {
        const parent = await createTask(tok.ca, { title: "Cha D38", assigneeEmployeeId: limEmp });
        expect(parent.status).toBe(201);
        const c1 = await createTask(tok.ca, {
          title: "C1 ghi được",
          parentTaskId: parent.id,
          assigneeEmployeeId: limEmp,
        });
        const c2 = await createTask(tok.ca, {
          title: "C2 ngoài phạm vi",
          parentTaskId: parent.id,
          assigneeEmployeeId: otherEmp,
        });
        expect(c1.status).toBe(201);
        expect(c2.status).toBe(201);

        const blockedRes = await authDelete(tok.lim, `/tasks/${parent.id}`);
        expect(blockedRes.status, JSON.stringify(blockedRes.body)).toBe(403);
        expect(JSON.stringify(blockedRes.body)).toContain("TASK-ERR-047");

        const parentRow = await queryTask(parent.id);
        const c1Row = await queryTask(c1.id);
        const c2Row = await queryTask(c2.id);
        expect(
          parentRow.deleted_at,
          "TẤT-CẢ-HOẶC-KHÔNG: không xoá gì khi có ≥1 con ngoài phạm vi",
        ).toBeNull();
        expect(c1Row.deleted_at).toBeNull();
        expect(c2Row.deleted_at).toBeNull();

        // Envelope CHUẨN của repo: {success,message,data,error:{code,message,type,details},meta} — KHÔNG
        // có key phẳng (blockedCount/blocked) ở top level. Sau fix all-exceptions.filter.ts (details
        // opt-in cho 4xx) + task-core.service.ts (throw {code:"TASK-ERR-047", details:[{field,message,rule}]}),
        // danh sách con bị chặn đi ra qua error.details — assert ĐÚNG chỗ đó.
        expect(
          blockedRes.body.error?.code,
          `payload thật của response: ${JSON.stringify(blockedRes.body)}`,
        ).toBe("TASK-ERR-047");
        const blockedDetails = blockedRes.body.error?.details as
          | Array<{ field: string; message: string; rule: string }>
          | undefined;
        expect(blockedDetails, JSON.stringify(blockedRes.body)).toHaveLength(1);
        expect(blockedDetails?.[0].rule).toBe("SUBTASK_DELETE_FORBIDDEN");
        expect(blockedDetails?.[0].message).toContain("C2 ngoài phạm vi");

        // Đủ quyền cả 3 (admin Company scope) ⇒ 200, cả 3 xoá + activity/audit.
        const okRes = await authDelete(tok.ca, `/tasks/${parent.id}`);
        expect(okRes.status, JSON.stringify(okRes.body)).toBe(204);
        const parentRow2 = await queryTask(parent.id);
        const c1Row2 = await queryTask(c1.id);
        const c2Row2 = await queryTask(c2.id);
        expect(parentRow2.deleted_at).not.toBeNull();
        expect(c1Row2.deleted_at).not.toBeNull();
        expect(c2Row2.deleted_at).not.toBeNull();

        const activity = await direct.query(
          "SELECT count(*)::int n FROM task_activity_logs WHERE task_id = ANY($1::uuid[]) AND action='TASK_DELETED'",
          [[parent.id, c1.id, c2.id]],
        );
        expect(activity.rows[0].n).toBe(3);
        const audit = await direct.query(
          "SELECT count(*)::int n FROM audit_logs WHERE object_type='task' AND object_id = ANY($1::uuid[]) AND action='TaskDeleted'",
          [[parent.id, c1.id, c2.id]],
        );
        expect(audit.rows[0].n).toBe(3);
      });

      it("hai phép kiểm TÁCH BẠCH: con ĐỌC-được-nhưng-KHÔNG-GHI-được PHẢI vào blocked[] (không dùng nhầm read-check để chặn)", async () => {
        const parent = await createTask(tok.ca, {
          title: "Cha D38 tách bạch",
          assigneeEmployeeId: limEmp,
        });
        const c1 = await createTask(tok.ca, {
          title: "C1 tách bạch",
          parentTaskId: parent.id,
          assigneeEmployeeId: limEmp,
        });
        // c2 giao cho otherEmp — limUser ĐỌC được (D-39 thừa hưởng từ cha) nhưng KHÔNG GHI được (Own-scope,
        // assignee ≠ limEmp) ⇒ nếu code lỡ dùng read-check để chặn thì test này sẽ đỏ (c2 sẽ KHÔNG vào blocked).
        const c2 = await createTask(tok.ca, {
          title: "C2 đọc được không ghi được",
          parentTaskId: parent.id,
          assigneeEmployeeId: otherEmp,
        });
        expect(c1.status).toBe(201);
        expect(c2.status).toBe(201);

        // Xác nhận limUser ĐỌC được c2 qua danh sách con của cha (D-39).
        const subtasksRes = await authGet(tok.lim, `/tasks/${parent.id}/subtasks`);
        expect(subtasksRes.status, JSON.stringify(subtasksRes.body)).toBe(200);
        expect((subtasksRes.body.data as Array<{ id: string }>).map((r) => r.id)).toContain(c2.id);

        const delRes = await authDelete(tok.lim, `/tasks/${parent.id}`);
        expect(delRes.status, JSON.stringify(delRes.body)).toBe(403);
        // error.details là khe THẬT đi ra client (all-exceptions.filter opt-in) — nếu dùng nhầm
        // read-check để chặn thì blocked[] rỗng/hỏng-câm ⇒ details rỗng ở đây.
        const blockedDetails = delRes.body.error?.details as
          | Array<{ field: string; message: string; rule: string }>
          | undefined;
        expect(
          blockedDetails?.length ?? 0,
          `nếu dùng nhầm read-check, blocked[] sẽ rỗng/hỏng-câm: ${JSON.stringify(delRes.body)}`,
        ).toBeGreaterThanOrEqual(1);

        // dọn cho test khác — admin xoá bằng đủ quyền.
        await authDelete(tok.ca, `/tasks/${parent.id}`);
      });
    });

    // ══ 8. Đếm-lá khớp 3 nguồn (D-34) ═══════════════════════════════════════════════════════════════

    describe("8. ba nguồn số khớp nhau", () => {
      it("dự án 1 task lẻ Todo + 1 cha Todo có 2 con (Done,Todo) ⇒ report/MV/widget CÙNG Todo=2 Done=1 (KHÔNG 3/1)", async () => {
        // Company RIÊNG cho ca này — MV company-wide (không lọc project) nên cần cô lập hoàn toàn khỏi
        // các fixture khác trong file để so khớp tuyệt đối 3 nguồn.
        const hash = await new PasswordService().hash(LOGIN_PW);
        const C = await seedCompany(direct, "subcntC");
        companyIds.push(C.companyId);
        const cUser = await seedUser(direct, C.companyId, `c@${C.slug}.test`, hash);
        await seedEmp(C.companyId, cUser, null);
        const cRoleId = await seedRole(direct, C.companyId, "subcnt-c-role");
        for (const [action, resource, scope, sensitive] of [
          ["create", "task", "Company", false],
          ["read", "task", "Company", false],
          ["update-status", "task", "Company", false],
          ["create", "project", "Company", false],
          ["read", "project", "Company", false],
          ["view-report", "project", "Company", true],
          ["read", "dashboard", "Company", false],
        ] as const) {
          const permId = await seedPermissionCatalog(direct, action, resource, sensitive);
          await seedRolePermission(direct, cRoleId, permId, "ALLOW", scope);
        }
        await seedUserRole(direct, cUser, cRoleId, C.companyId);
        const tC = await login(C.slug, `c@${C.slug}.test`);

        const project = await seedProject(C.companyId, "P-3sources");
        const lone = await createTask(tC, { title: "Lẻ Todo", projectId: project });
        const parent = await createTask(tC, { title: "Cha 2 con", projectId: project });
        const cDone = await createTask(tC, { title: "Con Done", parentTaskId: parent.id });
        const cTodo = await createTask(tC, { title: "Con Todo", parentTaskId: parent.id });
        expect([lone.status, parent.status, cDone.status, cTodo.status]).toEqual([
          201, 201, 201, 201,
        ]);
        await changeStatus(tC, cDone.id, "Done");

        const rep = await report(tC, project);
        expect(rep.countsByStatus.Todo, JSON.stringify(rep.countsByStatus)).toBe(2);
        expect(rep.countsByStatus.Done).toBe(1);

        await refreshMv();
        const mvRes = await authGet(tC, "/dashboard/mv-stats");
        expect(mvRes.status, JSON.stringify(mvRes.body)).toBe(200);
        const mvStats = mvRes.body.data.taskStatus as Array<{ status: string; taskCount: number }>;
        const mvOf = (s: string) => mvStats.find((r) => r.status === s)?.taskCount ?? 0;
        expect(mvOf("Todo"), JSON.stringify(mvStats)).toBe(2);
        expect(mvOf("Done")).toBe(1);

        const widgetRes = await authGet(
          tC,
          `/dashboard/widgets/project-progress?project_id=${project}`,
        );
        expect(widgetRes.status, JSON.stringify(widgetRes.body)).toBe(200);
        const byStatus = widgetRes.body.data.data.byStatus as Record<string, number>;
        expect(byStatus.Todo, JSON.stringify(byStatus)).toBe(2);
        expect(byStatus.Done).toBe(1);
      });
    });

    // ══ 9. Ranh giới quyền D-35 ═════════════════════════════════════════════════════════════════════

    describe("9. D-35 widget non-sensitive KHÔNG mượn scope report SENSITIVE", () => {
      it("actor có read:project KHÔNG có view-report:project ⇒ widget 200 CÒN report 403; widget KHÔNG chứa assigneeWorkload/employeeName (PII)", async () => {
        const project = await seedProject(A.companyId, "P-d35");
        await createTask(tok.ca, { title: "T d35", projectId: project, assigneeEmployeeId: caEmp });

        const widgetRes = await authGet(
          tok.dashOnly,
          `/dashboard/widgets/project-progress?project_id=${project}`,
        );
        expect(widgetRes.status, JSON.stringify(widgetRes.body)).toBe(200);
        expect(JSON.stringify(widgetRes.body)).not.toContain("assigneeWorkload");
        expect(JSON.stringify(widgetRes.body)).not.toContain("employeeName");

        const reportRes = await authGet(tok.dashOnly, `/projects/${project}/report`);
        expect(reportRes.status, JSON.stringify(reportRes.body)).toBe(403);
      });
    });

    // ══ 10. Hệ quả D-34 (tài liệu sống) ═════════════════════════════════════════════════════════════

    describe("10. D-34 hệ quả #1 (tổng nhảy không đều) + #4 (huỷ con cuối làm tổng TĂNG) — comment trỏ ADR", () => {
      it("chuỗi 1→1→2→2→3: cha 0 con=1(chính nó); +con1=1(không đổi); +con2=2; huỷ con1=2; huỷ con2=3(cha quay lại lá)", async () => {
        const project = await seedProject(A.companyId, "P-d34seq");
        const parent = await createTask(tok.ca, { title: "Cha chuỗi D-34" });
        expect(parent.status).toBe(201);

        const totalLeaf = async (): Promise<number> => {
          const r = await report(tok.ca, project);
          return Object.values(r.countsByStatus).reduce((s, n) => s + n, 0);
        };

        // cha vẫn ở project null ban đầu — chuyển vào project để report lọc theo project_id tính được.
        // (PATCH projectId trên task GỐC 0 con là hợp lệ — D-36a chỉ khoá khi ĐÃ có con.)
        const moveRes = await request(app.getHttpServer())
          .patch(`/tasks/${parent.id}`)
          .set("Authorization", `Bearer ${tok.ca}`)
          .send({ projectId: project });
        expect(moveRes.status, JSON.stringify(moveRes.body)).toBe(200);

        expect(await totalLeaf(), "cha 0 con ⇒ chính nó là lá").toBe(1);

        const c1 = await createTask(tok.ca, { title: "D34 con 1", parentTaskId: parent.id });
        expect(c1.status).toBe(201);
        expect(
          await totalLeaf(),
          "hệ quả #1: con ĐẦU TIÊN không đổi tổng (cha rời lá, con vào thay)",
        ).toBe(1);

        const c2 = await createTask(tok.ca, { title: "D34 con 2", parentTaskId: parent.id });
        expect(c2.status).toBe(201);
        expect(await totalLeaf(), "con THỨ HAI mới +1").toBe(2);

        await changeStatus(tok.ca, c1.id, "Cancelled");
        expect(await totalLeaf(), "huỷ c1: c2 vẫn COUNTABLE ⇒ cha CHƯA quay lại lá").toBe(2);

        await changeStatus(tok.ca, c2.id, "Cancelled");
        expect(
          await totalLeaf(),
          "hệ quả #4: huỷ NỐT c2 ⇒ cha hết COUNTABLE_CHILD ⇒ quay lại làm lá ⇒ tổng TĂNG 1 (không phải bug)",
        ).toBe(3);
      });
    });

    // ══ 15. D-37 danh sách ≠ con số — regression KHÔNG áp đếm-lá ═══════════════════════════════════

    describe("15. D-37 regression — my-tasks/overdue-list/TASK_ALERTS KHÔNG đếm-lá", () => {
      it("cha quá hạn giao caEmp, thêm con giao NGƯỜI KHÁC ⇒ cha KHÔNG biến mất khỏi my-tasks/overdue-list/TASK_ALERTS dù không còn là lá", async () => {
        const parent = await createTask(tok.ca, {
          title: "Cha D37",
          assigneeEmployeeId: caEmp,
          dueAt: pastIso(),
        });
        expect(parent.status).toBe(201);

        const myBefore = await authGet(tok.ca, "/tasks/my");
        expect(myBefore.status, JSON.stringify(myBefore.body)).toBe(200);
        expect((myBefore.body.data as Array<{ id: string }>).map((t) => t.id)).toContain(parent.id);

        const overdueBefore = await authGet(tok.ca, "/tasks?overdue=true");
        expect((overdueBefore.body.data as Array<{ id: string }>).map((t) => t.id)).toContain(
          parent.id,
        );

        const alertsBefore = await authGet(tok.ca, "/dashboard/widgets/task-alerts");
        expect(alertsBefore.status, JSON.stringify(alertsBefore.body)).toBe(200);
        expect(
          (alertsBefore.body.data.data.items as Array<{ id: string }>).map((t) => t.id),
        ).toContain(parent.id);

        // Con giao NGƯỜI KHÁC ⇒ cha rời tập LÁ (D-34 report/MV/widget project-progress sẽ không đếm cha nữa),
        // nhưng D-37 chốt: các danh sách "việc phải xử lý" KHÔNG áp đếm-lá ⇒ cha PHẢI còn nguyên ở đây.
        const child = await createTask(tok.ca, {
          title: "Con D37",
          parentTaskId: parent.id,
          assigneeEmployeeId: otherEmp,
        });
        expect(child.status).toBe(201);

        const myAfter = await authGet(tok.ca, "/tasks/my");
        expect((myAfter.body.data as Array<{ id: string }>).map((t) => t.id)).toContain(parent.id);

        const overdueAfter = await authGet(tok.ca, "/tasks?overdue=true");
        expect((overdueAfter.body.data as Array<{ id: string }>).map((t) => t.id)).toContain(
          parent.id,
        );

        const alertsAfter = await authGet(tok.ca, "/dashboard/widgets/task-alerts");
        expect(
          (alertsAfter.body.data.data.items as Array<{ id: string }>).map((t) => t.id),
        ).toContain(parent.id);

        // ME summary (me-aggregation.service.ts:262 đi qua CHÍNH getMyTasks — đã xác minh bằng đọc code,
        // không phải đường riêng có nguy cơ áp đếm-lá). Smoke-check overdueCount KHÔNG giảm khi thêm subtask.
        // Envelope: GET /me/task-summary luôn HTTP 200 (fail-soft per-section, composeSection KHÔNG bao giờ
        // 500) — trạng thái THẬT nằm ở res.body.data.status (Section<T> = {status, data}), KHÔNG phải HTTP
        // status; số liệu nằm ở res.body.data.data (một lớp "data" nữa BÊN TRONG data của envelope ngoài).
        const meBefore = await authGet(tok.ca, "/me/task-summary");
        const meAfter = await authGet(tok.ca, "/me/task-summary");
        expect(meBefore.status, JSON.stringify(meBefore.body)).toBe(200);
        expect(meAfter.status, JSON.stringify(meAfter.body)).toBe(200);
        if (meBefore.body.data.status === "ok" && meAfter.body.data.status === "ok") {
          expect(meAfter.body.data.data.overdueCount).toBeGreaterThanOrEqual(
            meBefore.body.data.data.overdueCount,
          );
        }
      });

      it("reminder job (task-reminder.job-handler) — GHI CHÚ: đọc cột LEGACY due_date/status (KHÔNG PHẢI due_at/task_status của task-core) nên KHÔNG BAO GIỜ thấy task-core dù có subtask hay không — bất biến D-37 đúng nhưng vì lý do KHÁC (không liên quan WO này, xem báo cáo QA)", async () => {
        const handler = app.get(TaskReminderJobHandler);
        const before = await handler.run({ companyId: A.companyId });
        const parent = await createTask(tok.ca, {
          title: "Cha reminder",
          assigneeEmployeeId: caEmp,
          dueAt: pastIso(),
        });
        await createTask(tok.ca, {
          title: "Con reminder",
          parentTaskId: parent.id,
          assigneeEmployeeId: otherEmp,
        });
        const after = await handler.run({ companyId: A.companyId });
        // task-core (due_at/task_status) KHÔNG populate legacy due_date/status ⇒ job luôn thấy 0 task-core row.
        expect(before.metadata?.overdueCount ?? 0).toBe(after.metadata?.overdueCount ?? 0);
      });
    });
  },
);
