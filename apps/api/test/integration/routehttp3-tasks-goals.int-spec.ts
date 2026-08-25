/**
 * S10-QA-ROUTEHTTP-3 (file 4/6) — test HTTP THẬT cho phần đuôi miền TASK/PROJECT/GOAL:
 *
 *   LabelsController        4 route  GET/POST /projects/:projectId/labels · PATCH/DELETE /labels/:labelId
 *   ProjectStatesController 2 route  PATCH/DELETE /states/:stateId
 *   TaskTemplatesController 6 route  GET :id · PATCH :id · DELETE :id · GET :id/items · PATCH/DELETE item
 *   TasksController         1 route  POST /tasks/:taskId/checklists/:checklistId/items
 *   GoalsController         2 route  GET /goals/:id/updates · DELETE /goals/:id/tasks/:taskId
 *
 * ⚠️ VÌ SAO KHÔNG TRÙNG spec đã có. `labels.int-spec.ts` và `project-states.int-spec.ts` gọi THẲNG
 * service (`new LabelsService(...)`, `labels.createLabel(user, ...)`) — đúng lớp lỗi mà KI-025 mô tả:
 * guard chain, `ZodValidationPipe`, `ResponseEnvelopeInterceptor` và `AllExceptionsFilter` của các
 * route này CHƯA TỪNG chạy. Ở đây đo qua HTTP nên cả bốn lớp đó mới thực sự được thực thi.
 *
 * LUẬT CHỐNG DENY-XANH-RỖNG: mỗi route GHI có ca ALLOW 2xx chứng minh bằng HỆ QUẢ đọc lại qua route
 * ĐỌC của cùng tài nguyên; ca DENY (role RỖNG → 403) đặt SAU.
 *
 * XOÁ = 204 KHÔNG BODY cho `labels`/`states` (`@HttpCode(204)`), còn `task-templates` cũng 204.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
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
const LOGIN_PW = loginPasswordFixture("s10rh3tg");

const uniq = () => randomUUID().slice(0, 8);

function todayShift(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const PERIOD = {
  periodType: "quarter" as const,
  periodStart: todayShift(-30),
  periodEnd: todayShift(60),
};

/** Cặp quyền THẬT của 5 controller (đo trên catalog lane DB — tất cả `is_sensitive=false`). */
const ADMIN_PAIRS = [
  ["read", "label"],
  ["create", "label"],
  ["update", "label"],
  ["delete", "label"],
  ["read", "project_state"],
  ["create", "project_state"],
  ["update", "project_state"],
  ["delete", "project_state"],
  ["manage", "task-template"],
  ["read", "task"],
  ["create", "task"],
  ["update", "task"],
  ["access", "goal"],
  ["view", "goal"],
  ["create", "goal"],
  ["update", "goal"],
  ["checkin", "goal"],
] as const;

describe.skipIf(!hasLaneDb)(
  "S10-QA-ROUTEHTTP-3 — HTTP thật: labels · states · task-templates · task-checklist · goals (15 route)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let tAdminA = "";
    let tEmptyA = "";
    let tAdminB = "";
    let projectA = "";
    let projectB = "";
    let adminEmpA = "";

    const http = () => request(app.getHttpServer());
    const authGet = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
    const authPost = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
    const authPatch = (t: string, u: string) => http().patch(u).set("Authorization", `Bearer ${t}`);
    const authDelete = (t: string, u: string) =>
      http().delete(u).set("Authorization", `Bearer ${t}`);

    async function login(slug: string, email: string): Promise<string> {
      const res = await http().post("/auth/login").send({
        companySlug: slug,
        email,
        password: LOGIN_PW,
      });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    /** user + employee_profile + role mang `pairs`. Trả token + employeeId (goal/task cần neo employee). */
    async function actor(
      tenant: SeededTenant,
      tag: string,
      pairs: ReadonlyArray<readonly [string, string]>,
    ): Promise<{ token: string; employeeId: string; orgUnitId: string }> {
      const password = new PasswordService();
      const email = `${tag}-${uniq()}@s10rh3tg.local`;
      const userId = await seedUser(direct, tenant.companyId, email, await password.hash(LOGIN_PW));
      const ou = await direct.query<{ id: string }>(
        `INSERT INTO org_units (company_id, name, type) VALUES ($1, $2, 'department') RETURNING id`,
        [tenant.companyId, `s10rh3tg-ou-${uniq()}`],
      );
      const emp = await direct.query<{ id: string }>(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
         VALUES ($1, $2, $3, 'active') RETURNING id`,
        [tenant.companyId, userId, ou.rows[0].id],
      );
      const roleId = await seedRole(direct, tenant.companyId, `s10rh3tg-${tag}-${uniq()}`);
      for (const [action, resource] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resource, false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, userId, roleId, tenant.companyId);
      return {
        token: await login(tenant.slug, email),
        employeeId: emp.rows[0].id,
        orgUnitId: ou.rows[0].id,
      };
    }

    async function seedProject(companyId: string, ouId: string, ownerEmp: string): Promise<string> {
      const r = await direct.query<{ id: string }>(
        `INSERT INTO projects (company_id, name, status, department_id, owner_employee_id)
         VALUES ($1, $2, 'active', $3, $4) RETURNING id`,
        [companyId, `s10rh3tg-prj-${uniq()}`, ouId, ownerEmp],
      );
      return r.rows[0].id;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      // Phải listen THẬT: supertest tự listen(0) rồi close() server dùng chung ngay khi request ĐẦU kết thúc
      // ⇒ các request anh em trong Promise.all bị reset socket (ECONNRESET). Server đang listen thì supertest không sở hữu nó.
      await app.listen(0);

      direct = directPool();
      A = await seedCompany(direct, "s10rh3tga");
      B = await seedCompany(direct, "s10rh3tgb");
      companyIds.push(A.companyId, B.companyId);

      // `seedCompany()` chỉ INSERT một hàng `companies` — nó KHÔNG chạy bootstrap công ty của app,
      // nên `sequence_counters` rỗng. Thiếu counter `goal` thì `POST /goals` chết ở
      // `SequenceService` → 500 SYSTEM-ERR-001 (đã đo). Đó là khoảng trống của FIXTURE, không phải
      // của sản phẩm (PROD gieo counter lúc tạo công ty) — gieo tường minh ở đây.
      for (const companyId of companyIds) {
        await direct.query(
          `INSERT INTO sequence_counters
             (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
              reset_policy, increment_by, current_value, status)
           VALUES ($1,'GOAL','goal','Company','GOAL-',4,'Never',1,0,'Active'),
                  ($1,'TASK','task','Company','TSK-',4,'Never',1,0,'Active')
           ON CONFLICT DO NOTHING`,
          [companyId],
        );
      }

      const admin = await actor(A, "admin", ADMIN_PAIRS);
      tAdminA = admin.token;
      adminEmpA = admin.employeeId;
      projectA = await seedProject(A.companyId, admin.orgUnitId, admin.employeeId);

      tEmptyA = (await actor(A, "empty", [])).token;

      const adminB = await actor(B, "adminb", ADMIN_PAIRS);
      tAdminB = adminB.token;
      projectB = await seedProject(B.companyId, adminB.orgUnitId, adminB.employeeId);
    }, 180_000);

    afterAll(async () => {
      await app?.close();
      if (companyIds.length > 0) {
        // `goals`/`goal_updates` không nằm trong cleanupTenants ⇒ dọn tường minh trước.
        await direct.query("UPDATE tasks SET goal_id = NULL WHERE company_id = ANY($1::uuid[])", [
          companyIds,
        ]);
        await direct.query("DELETE FROM goal_updates WHERE company_id = ANY($1::uuid[])", [
          companyIds,
        ]);
        await direct.query("DELETE FROM goals WHERE company_id = ANY($1::uuid[])", [companyIds]);
        await cleanupTenants(direct, companyIds);
      }
      await direct?.end();
    });

    // ─── 1. Labels — vòng đời đầy đủ qua HTTP ───────────────────────────────────

    it("labels: POST → GET list → PATCH → DELETE, mỗi bước có HỆ QUẢ đọc lại", async () => {
      const name = `nhãn-${uniq()}`;
      const created = await authPost(tAdminA, `/projects/${projectA}/labels`).send({
        name,
        color: "#ff0000",
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const labelId = created.body.data.id as string;

      const list = await authGet(tAdminA, `/projects/${projectA}/labels`);
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      expect((list.body.data as Array<{ id: string }>).map((l) => l.id)).toContain(labelId);

      const patched = await authPatch(tAdminA, `/labels/${labelId}`).send({ color: "#00ff00" });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const afterPatch = await authGet(tAdminA, `/projects/${projectA}/labels`);
      expect(
        (afterPatch.body.data as Array<{ id: string; color: string }>).find((l) => l.id === labelId)
          ?.color,
      ).toBe("#00ff00");

      const removed = await authDelete(tAdminA, `/labels/${labelId}`);
      expect(removed.status, JSON.stringify(removed.body)).toBe(204);
      const afterDelete = await authGet(tAdminA, `/projects/${projectA}/labels`);
      expect((afterDelete.body.data as Array<{ id: string }>).map((l) => l.id)).not.toContain(
        labelId,
      );
    });

    it("labels: DTO 400 ở BIÊN (`color` sai định dạng HEX) — ZodValidationPipe chặn TRƯỚC service", async () => {
      const bad = await authPost(tAdminA, `/projects/${projectA}/labels`).send({
        name: `x-${uniq()}`,
        color: "đỏ",
      });
      expect(bad.status, JSON.stringify(bad.body)).toBe(400);
    });

    // ─── 2. Project states — PATCH + DELETE ─────────────────────────────────────

    it("states: PATCH + DELETE qua HTTP, HỆ QUẢ đọc lại bằng GET /projects/:id/states", async () => {
      const created = await authPost(tAdminA, `/projects/${projectA}/states`).send({
        name: `Cột ${uniq()}`,
        stateGroup: "started",
        color: "#123456",
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const stateId = created.body.data.id as string;

      const patched = await authPatch(tAdminA, `/states/${stateId}`).send({ color: "#abcdef" });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const afterPatch = await authGet(tAdminA, `/projects/${projectA}/states`);
      expect(
        (afterPatch.body.data as Array<{ id: string; color: string }>).find((s) => s.id === stateId)
          ?.color,
      ).toBe("#abcdef");

      const removed = await authDelete(tAdminA, `/states/${stateId}`);
      expect(removed.status, JSON.stringify(removed.body)).toBe(204);
      const afterDelete = await authGet(tAdminA, `/projects/${projectA}/states`);
      expect((afterDelete.body.data as Array<{ id: string }>).map((s) => s.id)).not.toContain(
        stateId,
      );
    });

    // ─── 3. Task templates — header + item ──────────────────────────────────────

    it("task-templates: POST → GET :id → PATCH :id → GET items → PATCH item → DELETE item → DELETE :id", async () => {
      const created = await authPost(tAdminA, "/task-templates").send({
        name: `Mẫu ${uniq()}`,
        description: "mẫu thử",
        items: [{ title: "Việc 1", sortOrder: 0 }],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const templateId = created.body.data.id as string;

      const one = await authGet(tAdminA, `/task-templates/${templateId}`);
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      expect(one.body.data.id).toBe(templateId);

      const patched = await authPatch(tAdminA, `/task-templates/${templateId}`).send({
        name: "Mẫu (đã đổi tên)",
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const reread = await authGet(tAdminA, `/task-templates/${templateId}`);
      expect(reread.body.data.name).toBe("Mẫu (đã đổi tên)");

      const items = await authGet(tAdminA, `/task-templates/${templateId}/items`);
      expect(items.status, JSON.stringify(items.body)).toBe(200);
      const itemRows = items.body.data as Array<{ id: string; title: string }>;
      expect(itemRows.length).toBeGreaterThan(0);
      const itemId = itemRows[0].id;

      const patchedItem = await authPatch(
        tAdminA,
        `/task-templates/${templateId}/items/${itemId}`,
      ).send({ title: "Việc 1 (đã sửa)" });
      expect(patchedItem.status, JSON.stringify(patchedItem.body)).toBe(200);
      const itemsAfterPatch = await authGet(tAdminA, `/task-templates/${templateId}/items`);
      expect(
        (itemsAfterPatch.body.data as Array<{ id: string; title: string }>).find(
          (i) => i.id === itemId,
        )?.title,
      ).toBe("Việc 1 (đã sửa)");

      const removedItem = await authDelete(
        tAdminA,
        `/task-templates/${templateId}/items/${itemId}`,
      );
      expect(removedItem.status, JSON.stringify(removedItem.body)).toBe(204);
      const itemsAfterDelete = await authGet(tAdminA, `/task-templates/${templateId}/items`);
      expect((itemsAfterDelete.body.data as Array<{ id: string }>).map((i) => i.id)).not.toContain(
        itemId,
      );

      const removed = await authDelete(tAdminA, `/task-templates/${templateId}`);
      expect(removed.status, JSON.stringify(removed.body)).toBe(204);
      const gone = await authGet(tAdminA, `/task-templates/${templateId}`);
      expect(gone.status).toBe(404);
    });

    // ─── 4. Task checklist item ─────────────────────────────────────────────────

    it("POST /tasks/:taskId/checklists/:checklistId/items — ALLOW 201, HỆ QUẢ: GET checklists thấy item", async () => {
      const task = await authPost(tAdminA, "/tasks").send({
        title: `Việc ${uniq()}`,
        projectId: projectA,
      });
      expect(task.status, JSON.stringify(task.body)).toBe(201);
      const taskId = task.body.data.id as string;

      const checklist = await authPost(tAdminA, `/tasks/${taskId}/checklists`).send({
        title: "Danh mục kiểm",
      });
      expect(checklist.status, JSON.stringify(checklist.body)).toBe(201);
      const checklistId = checklist.body.data.id as string;

      const added = await authPost(
        tAdminA,
        `/tasks/${taskId}/checklists/${checklistId}/items`,
      ).send({ title: "Mục kiểm 1" });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      const itemId = added.body.data.id as string;

      const list = await authGet(tAdminA, `/tasks/${taskId}/checklists`);
      expect(list.status).toBe(200);
      const found = (
        list.body.data as Array<{ id: string; items?: Array<{ id: string; title: string }> }>
      ).find((c) => c.id === checklistId);
      expect(
        (found?.items ?? []).map((i) => i.id),
        "item vừa thêm phải xuất hiện khi đọc lại checklist",
      ).toContain(itemId);
    });

    // ─── 5. Goals — sổ cập nhật + tháo task ─────────────────────────────────────

    it("goals: GET /goals/:id/updates (sổ append-only) + DELETE /goals/:id/tasks/:taskId (tháo)", async () => {
      const goal = await authPost(tAdminA, "/goals").send({
        ...PERIOD,
        name: `Mục tiêu ${uniq()}`,
        level: "project",
        projectId: projectA,
        ownerEmployeeId: adminEmpA,
        status: "Active",
        progressMode: "manual",
        measureType: "percent",
      });
      expect(goal.status, JSON.stringify(goal.body)).toBe(201);
      const goalId = goal.body.data.id as string;

      // Sổ rỗng lúc đầu — chứng minh route ĐỌC thật, không trả hằng số.
      const before = await authGet(tAdminA, `/goals/${goalId}/updates`);
      expect(before.status, JSON.stringify(before.body)).toBe(200);
      const beforeRows = (before.body.data as unknown[]) ?? [];

      const checkin = await authPost(tAdminA, `/goals/${goalId}/check-in`).send({
        progressPercent: 40,
        confidence: 70,
        note: "tiến độ 40%",
      });
      expect(checkin.status, JSON.stringify(checkin.body)).toBe(201);

      const after = await authGet(tAdminA, `/goals/${goalId}/updates`);
      expect(after.status, JSON.stringify(after.body)).toBe(200);
      expect(
        (after.body.data as unknown[]).length,
        "sổ phải dài thêm sau một lần check-in",
      ).toBeGreaterThan(beforeRows.length);

      // Gắn rồi THÁO một task của cùng dự án.
      const task = await authPost(tAdminA, "/tasks").send({
        title: `Việc gắn mục tiêu ${uniq()}`,
        projectId: projectA,
      });
      expect(task.status, JSON.stringify(task.body)).toBe(201);
      const taskId = task.body.data.id as string;

      const linked = await authPost(tAdminA, `/goals/${goalId}/tasks`).send({ taskIds: [taskId] });
      expect(linked.status, JSON.stringify(linked.body)).toBe(201);
      const linkedList = await authGet(tAdminA, `/goals/${goalId}/tasks`);
      expect((linkedList.body.data as Array<{ id: string }>).map((t) => t.id)).toContain(taskId);

      const unlinked = await authDelete(tAdminA, `/goals/${goalId}/tasks/${taskId}`);
      expect(unlinked.status, JSON.stringify(unlinked.body)).toBeLessThan(300);
      const afterUnlink = await authGet(tAdminA, `/goals/${goalId}/tasks`);
      expect((afterUnlink.body.data as Array<{ id: string }>).map((t) => t.id)).not.toContain(
        taskId,
      );
    });

    // ─── 6. DENY — role RỖNG, đặt SAU toàn bộ ALLOW ─────────────────────────────

    it("DENY 403: actor role RỖNG bị chặn ở mọi route của 5 controller", async () => {
      const fake = randomUUID();
      const calls = [
        authGet(tEmptyA, `/projects/${projectA}/labels`),
        authPost(tEmptyA, `/projects/${projectA}/labels`).send({ name: "x" }),
        authPatch(tEmptyA, `/labels/${fake}`).send({ name: "x" }),
        authDelete(tEmptyA, `/labels/${fake}`),
        authPatch(tEmptyA, `/states/${fake}`).send({ name: "x" }),
        authDelete(tEmptyA, `/states/${fake}`),
        authGet(tEmptyA, `/task-templates/${fake}`),
        authPatch(tEmptyA, `/task-templates/${fake}`).send({ name: "x" }),
        authDelete(tEmptyA, `/task-templates/${fake}`),
        authGet(tEmptyA, `/task-templates/${fake}/items`),
        authPatch(tEmptyA, `/task-templates/${fake}/items/${fake}`).send({ title: "x" }),
        authDelete(tEmptyA, `/task-templates/${fake}/items/${fake}`),
        authPost(tEmptyA, `/tasks/${fake}/checklists/${fake}/items`).send({ title: "x" }),
        authGet(tEmptyA, `/goals/${fake}/updates`),
        authDelete(tEmptyA, `/goals/${fake}/tasks/${fake}`),
      ];
      const results = await Promise.all(calls);
      for (const [i, r] of results.entries()) {
        expect(r.status, `call#${i} phải 403, nhận ${r.status}: ${JSON.stringify(r.body)}`).toBe(
          403,
        );
      }
    });

    // ─── 7. Cô lập tenant ───────────────────────────────────────────────────────

    it("CROSS-TENANT: tenant B không đọc/không sửa được nhãn + mẫu của tenant A", async () => {
      const label = await authPost(tAdminA, `/projects/${projectA}/labels`).send({
        name: `riêng-a-${uniq()}`,
      });
      expect(label.status).toBe(201);
      const tpl = await authPost(tAdminA, "/task-templates").send({ name: `Riêng A ${uniq()}` });
      expect(tpl.status).toBe(201);

      const readLabels = await authGet(tAdminB, `/projects/${projectA}/labels`);
      expect(readLabels.status, `B đọc nhãn dự án của A: ${JSON.stringify(readLabels.body)}`).toBe(
        404,
      );

      const patchLabel = await authPatch(tAdminB, `/labels/${label.body.data.id}`).send({
        name: "chiếm quyền",
      });
      expect(patchLabel.status).toBe(404);

      const readTpl = await authGet(tAdminB, `/task-templates/${tpl.body.data.id}`);
      expect(readTpl.status).toBe(404);

      // Cạnh đối chứng: token B dùng được trên tài nguyên của CHÍNH nó ⇒ 404 ở trên là cô lập.
      const ownB = await authPost(tAdminB, `/projects/${projectB}/labels`).send({
        name: `riêng-b-${uniq()}`,
      });
      expect(ownB.status, JSON.stringify(ownB.body)).toBe(201);
    });
  },
);
