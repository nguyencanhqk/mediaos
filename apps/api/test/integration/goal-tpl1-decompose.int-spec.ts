/**
 * S5-GOAL-TPL-1 — danh mục task template (GOAL-API-012) + phân rã mục tiêu (GOAL-API-011).
 *
 * Phủ (done_when của WO):
 *  · TRANSACTIONAL ROLLBACK: item thứ 2 vi phạm gate TASK ⇒ 4xx và **0 task** mang `goal_id` (không để
 *    lại nửa lô); mã task bị "đốt" là chấp nhận được, hàng dữ liệu thì KHÔNG;
 *  · GOAL-ERR-005 (đã chốt kỳ) · GOAL-ERR-009 (Cancelled · rỗng · > 50) · GOAL-ERR-008 (mục tiêu cá
 *    nhân, item khai assignee khác);
 *  · CHÉO TENANT: template/goal của công ty khác ⇒ 404 (FK đơn cột KHÔNG ép cùng-tenant ⇒ nếu service
 *    thiếu vế company_id thì đây là 500 vỡ FK hoặc — tệ hơn — 201 ghi được);
 *  · Đường vui: task mang `goal_id` + `task_code` + checklist map sang task_checklists/items + activity
 *    `TASK_GOAL_DECOMPOSED` + audit `GoalDecomposed` + `progress_percent` mode 'tasks' NULL → 0;
 *  · Gate danh mục: thiếu `manage:task-template` ⇒ 403 mọi route /task-templates.
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
const LOGIN_PW = ["Passw0rd", "goaltpl1"].join("!");

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

describe.skipIf(!hasLaneDb)("S5-GOAL-TPL-1 template + phân rã (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let ouA = "";
  let adminUserA = "";
  let adminEmpA = "";
  let staffEmpA = "";
  let projectA = "";
  let projectA2 = "";
  let stateA = "";
  let stateA2 = "";
  let token = "";
  /** Người CÓ quyền mục tiêu nhưng KHÔNG có `manage:task-template` — chứng minh gate danh mục thật. */
  let tokenNoTpl = "";

  /** Thực thể của công ty B — dùng nguyên văn để thử IDOR chéo tenant. */
  let templateOfB = "";
  let goalOfB = "";

  const auth = (m: "get" | "post" | "patch" | "delete", u: string, t = token) =>
    request(app.getHttpServer())[m](u).set("Authorization", `Bearer ${t}`);

  const createGoal = async (body: Record<string, unknown>): Promise<string> => {
    const res = await auth("post", "/goals").send({ ...PERIOD, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  };

  const createTemplate = async (body: Record<string, unknown>): Promise<string> => {
    const res = await auth("post", "/task-templates").send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  };

  const goalTaskCount = async (goalId: string): Promise<number> => {
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM tasks WHERE goal_id = $1 AND deleted_at IS NULL",
      [goalId],
    );
    return r.rows[0].n as number;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "goaltpl1");
    B = await seedCompany(direct, "goaltpl1b");
    companyIds.push(A.companyId, B.companyId);
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

    const mkOu = async (companyId: string, name: string) => {
      const r = await direct.query(
        "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
        [companyId, name],
      );
      return r.rows[0].id as string;
    };
    ouA = await mkOu(A.companyId, "Phòng A");
    const ouB = await mkOu(B.companyId, "Phòng của B");

    const mkEmp = async (companyId: string, email: string, orgUnitId: string) => {
      const userId = await seedUser(direct, companyId, email, hash);
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
         VALUES ($1,$2,$3,'active') RETURNING id`,
        [companyId, userId, orgUnitId],
      );
      return { userId, empId: r.rows[0].id as string };
    };
    const admin = await mkEmp(A.companyId, `admin@${A.slug}.test`, ouA);
    adminUserA = admin.userId;
    adminEmpA = admin.empId;
    const staff = await mkEmp(A.companyId, `staff@${A.slug}.test`, ouA);
    staffEmpA = staff.empId;
    const adminB = await mkEmp(B.companyId, `admin@${B.slug}.test`, ouB);

    await direct.query("UPDATE org_units SET head_user_id = $1 WHERE id = $2", [adminUserA, ouA]);

    // Vai admin @Company: đủ cặp GOAL + TASK + danh mục template.
    const roleId = await seedRole(direct, A.companyId, "goal-tpl1-admin");
    for (const [action, resource] of [
      ["access", "goal"],
      ["view", "goal"],
      ["create", "goal"],
      ["update", "goal"],
      ["delete", "goal"],
      ["finalize", "goal"],
      ["read", "task"],
      ["create", "task"],
      ["update", "task"],
      ["update-state", "task"],
      ["manage", "task-template"],
    ] as const) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, adminUserA, roleId, A.companyId);

    // Vai THIẾU `manage:task-template` (nhưng có quyền mục tiêu) — deny-path của danh mục.
    const roleNoTpl = await seedRole(direct, A.companyId, "goal-tpl1-notpl");
    for (const [action, resource] of [
      ["access", "goal"],
      ["view", "goal"],
      ["update", "goal"],
      ["read", "task"],
      ["create", "task"],
    ] as const) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleNoTpl, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, staff.userId, roleNoTpl, A.companyId);

    const mkProject = async (companyId: string, name: string, ouId: string, ownerEmp: string) => {
      const r = await direct.query(
        `INSERT INTO projects (company_id, name, status, department_id, owner_employee_id)
         VALUES ($1,$2,'active',$3,$4) RETURNING id`,
        [companyId, name, ouId, ownerEmp],
      );
      return r.rows[0].id as string;
    };
    projectA = await mkProject(A.companyId, "Dự án TPL A1", ouA, adminEmpA);
    projectA2 = await mkProject(A.companyId, "Dự án TPL A2", ouA, adminEmpA);
    const mkState = async (projectId: string, name: string) => {
      const r = await direct.query(
        `INSERT INTO project_states (company_id, project_id, name, state_group, sort_order, is_default)
         VALUES ($1,$2,$3,'unstarted',0,true) RETURNING id`,
        [A.companyId, projectId, name],
      );
      return r.rows[0].id as string;
    };
    stateA = await mkState(projectA, "Cần làm");
    stateA2 = await mkState(projectA2, "Cần làm (A2)");

    // Thực thể công ty B — dựng bằng direct pool (không qua API của A).
    const tB = await direct.query(
      "INSERT INTO task_templates (company_id, name) VALUES ($1,'Template của B') RETURNING id",
      [B.companyId],
    );
    templateOfB = tB.rows[0].id as string;
    const gB = await direct.query(
      `INSERT INTO goals (company_id, goal_code, name, level, department_id, owner_employee_id,
                          period_type, period_start, period_end, progress_mode, status)
       VALUES ($1,'GOAL-B001','Mục tiêu của B','department',$2,$3,'quarter',$4,$5,'tasks','Active')
       RETURNING id`,
      [B.companyId, ouB, adminB.empId, PERIOD.periodStart, PERIOD.periodEnd],
    );
    goalOfB = gB.rows[0].id as string;

    const login = async (slug: string, email: string) => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.accessToken as string;
    };
    token = await login(A.slug, `admin@${A.slug}.test`);
    tokenNoTpl = await login(A.slug, `staff@${A.slug}.test`);
  }, 180_000);

  afterAll(async () => {
    await direct.query("UPDATE tasks SET goal_id = NULL WHERE company_id = ANY($1::uuid[])", [
      companyIds,
    ]);
    await direct.query("DELETE FROM goal_updates WHERE company_id = ANY($1::uuid[])", [companyIds]);
    await direct.query("DELETE FROM goals WHERE company_id = ANY($1::uuid[])", [companyIds]);
    await direct.query("DELETE FROM task_template_items WHERE company_id = ANY($1::uuid[])", [
      companyIds,
    ]);
    await direct.query("DELETE FROM task_templates WHERE company_id = ANY($1::uuid[])", [
      companyIds,
    ]);
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── T1. Danh mục template (GOAL-API-012) ──────────────────────────────────────
  describe("T1. Danh mục task template", () => {
    it("CRUD template + items: tạo kèm items · sửa · thêm/sửa/xoá item · xoá mềm cascade", async () => {
      const id = await createTemplate({
        name: "Quy trình ra mắt sản phẩm",
        description: "3 bước chuẩn",
        departmentId: ouA,
        items: [
          { title: "Chốt phạm vi", defaultPriority: "high", estimateHours: 8 },
          { title: "Thiết kế", defaultPriority: "medium", checklist: ["Wireframe", "Review"] },
        ],
      });

      const detail = await auth("get", `/task-templates/${id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.itemCount).toBe(2);
      expect(detail.body.data.items[0].title).toBe("Chốt phạm vi");
      // numeric(8,2) về DTO là SỐ (không phải chuỗi "8.00") + checklist luôn là mảng (không null).
      expect(detail.body.data.items[0].estimateHours).toBe(8);
      expect(detail.body.data.items[1].checklist).toEqual(["Wireframe", "Review"]);

      const patched = await auth("patch", `/task-templates/${id}`).send({ isActive: false });
      expect(patched.status).toBe(200);
      expect(patched.body.data.isActive).toBe(false);

      const item = await auth("post", `/task-templates/${id}/items`).send({ title: "Kiểm thử" });
      expect(item.status).toBe(201);
      const itemId = item.body.data.id as string;
      expect(item.body.data.sortOrder).toBe(2); // nextSortOrder = max+1

      const itemPatched = await auth("patch", `/task-templates/${id}/items/${itemId}`).send({
        title: "Kiểm thử hồi quy",
        defaultPriority: "urgent",
      });
      expect(itemPatched.status).toBe(200);
      expect(itemPatched.body.data.title).toBe("Kiểm thử hồi quy");

      expect((await auth("delete", `/task-templates/${id}/items/${itemId}`)).status).toBe(204);
      expect((await auth("get", `/task-templates/${id}`)).body.data.itemCount).toBe(2);

      // Xoá template = xoá MỀM header + cascade MỀM item (BẤT BIẾN #2 — 0 hàng bị DELETE thật).
      expect((await auth("delete", `/task-templates/${id}`)).status).toBe(204);
      expect((await auth("get", `/task-templates/${id}`)).status).toBe(404);
      const rows = await direct.query(
        `SELECT count(*)::int AS n FROM task_template_items
          WHERE template_id = $1 AND deleted_at IS NULL`,
        [id],
      );
      expect(rows.rows[0].n).toBe(0);
      const alive = await direct.query(
        "SELECT count(*)::int AS n FROM task_template_items WHERE template_id = $1",
        [id],
      );
      expect(alive.rows[0].n).toBe(3); // 3 hàng VẪN CÒN (soft delete), không bị hard-delete
    });

    it("trùng tên (còn sống) ⇒ 409, KHÔNG để vỡ UNIQUE thành 500", async () => {
      const name = `Template trùng ${Date.now()}`;
      await createTemplate({ name, departmentId: ouA });
      const dup = await auth("post", "/task-templates").send({ name, departmentId: ouA });
      expect(dup.status, JSON.stringify(dup.body)).toBe(409);
      expect(JSON.stringify(dup.body)).toContain("GOAL-ERR-TPL-NAME-TAKEN");
    });

    it("template của công ty KHÁC ⇒ 404 ở mọi route (đọc · sửa · thêm item)", async () => {
      expect((await auth("get", `/task-templates/${templateOfB}`)).status).toBe(404);
      const patch = await auth("patch", `/task-templates/${templateOfB}`).send({ name: "Chiếm" });
      expect(patch.status).toBe(404);
      const item = await auth("post", `/task-templates/${templateOfB}/items`).send({
        title: "Chèn xuyên tenant",
      });
      expect(item.status, JSON.stringify(item.body)).toBe(404);
      // Không có hàng nào của B bị chèn thêm (FK template_id KHÔNG ép cùng-tenant ở DB).
      const rows = await direct.query(
        "SELECT count(*)::int AS n FROM task_template_items WHERE template_id = $1",
        [templateOfB],
      );
      expect(rows.rows[0].n).toBe(0);
    });

    it("phòng ban của công ty khác làm departmentId ⇒ 404 (FK đơn cột không ép cùng-tenant)", async () => {
      const ouOfB = await direct.query("SELECT id FROM org_units WHERE company_id = $1 LIMIT 1", [
        B.companyId,
      ]);
      const res = await auth("post", "/task-templates").send({
        name: `Neo phòng lạ ${Date.now()}`,
        departmentId: ouOfB.rows[0].id,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("thiếu manage:task-template ⇒ 403 (dù có đủ quyền mục tiêu)", async () => {
      const res = await auth("get", "/task-templates", tokenNoTpl);
      expect(res.status).toBe(403);
      const post = await auth("post", "/task-templates", tokenNoTpl).send({ name: "Không được" });
      expect(post.status).toBe(403);
    });
  });

  // ── T2. Phân rã — đường vui (GOAL-API-011) ────────────────────────────────────
  describe("T2. Phân rã mục tiêu — đường vui", () => {
    it("mục tiêu cấp dự án: 3 task mang goal_id + checklist + activity + audit + progress NULL→0", async () => {
      const templateId = await createTemplate({
        name: `Phân rã dự án ${Date.now()}`,
        departmentId: ouA,
      });
      const goalId = await createGoal({
        name: "Mục tiêu dự án TPL",
        level: "project",
        projectId: projectA,
        status: "Active",
        progressMode: "tasks",
      });
      // Mode 'tasks' + 0 task gắn ⇒ "chưa đo" = NULL (SPEC-10 §13.2), KHÔNG 0%.
      const before = await auth("get", `/goals/${goalId}`);
      expect(before.body.data.progressPercent).toBeNull();

      const res = await auth("post", `/goals/${goalId}/decompose`).send({
        templateId,
        items: [
          { title: "Việc 1", priority: "high", checklist: ["B1", "B2"] },
          { title: "Việc 2", priority: "none", stateId: stateA },
          { title: "Việc 3", assigneeEmployeeId: staffEmpA },
        ],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.created).toBe(3);
      expect(res.body.data.tasks).toHaveLength(3);
      for (const t of res.body.data.tasks) expect(t.taskCode).toBeTruthy();

      const rows = await direct.query(
        `SELECT task_priority, project_id, state_id, task_code, title
           FROM tasks WHERE goal_id = $1 ORDER BY title`,
        [goalId],
      );
      expect(rows.rowCount).toBe(3);
      // D6 — 'high' LOWERCASE của template map sang 'High' TitleCase của tasks.task_priority.
      expect(rows.rows[0].task_priority).toBe("High");
      // 'none' ⇒ KHÔNG đặt ưu tiên (null), không phải chuỗi 'none' (vỡ CHECK).
      expect(rows.rows[1].task_priority).toBeNull();
      expect(rows.rows[1].state_id).toBe(stateA);
      for (const row of rows.rows) expect(row.project_id).toBe(projectA);

      // checklist JSONB → task_checklists + items (DB-11 §6.4).
      const taskOne = await direct.query("SELECT id FROM tasks WHERE goal_id = $1 AND title = $2", [
        goalId,
        "Việc 1",
      ]);
      const cl = await direct.query(
        `SELECT c.id, count(i.id)::int AS items
           FROM task_checklists c
           LEFT JOIN task_checklist_items i ON i.checklist_id = c.id AND i.deleted_at IS NULL
          WHERE c.task_id = $1 AND c.deleted_at IS NULL
          GROUP BY c.id`,
        [taskOne.rows[0].id],
      );
      expect(cl.rowCount).toBe(1);
      expect(cl.rows[0].items).toBe(2);

      // Vết nguồn gốc trên dòng thời gian của việc + audit trên mục tiêu.
      const act = await direct.query(
        `SELECT message FROM task_activity_logs
          WHERE task_id = $1 AND action = 'TASK_GOAL_DECOMPOSED'`,
        [taskOne.rows[0].id],
      );
      expect(act.rowCount).toBe(1);
      expect(String(act.rows[0].message)).toContain("phân rã mục tiêu");
      const audit = await direct.query(
        `SELECT after FROM audit_logs
          WHERE object_type = 'goal' AND object_id = $1 AND action = 'GoalDecomposed'`,
        [goalId],
      );
      expect(audit.rowCount).toBe(1);

      // progress mode 'tasks': 3 việc, 0 xong ⇒ 0% (KHÔNG còn NULL).
      const after = await auth("get", `/goals/${goalId}`);
      expect(Number(after.body.data.progressPercent)).toBe(0);
    });

    it("mục tiêu cấp nhân viên: assignee ÉP về chủ thể, không cần khai ở item", async () => {
      const templateId = await createTemplate({ name: `Phân rã cá nhân ${Date.now()}` });
      const goalId = await createGoal({
        name: "Mục tiêu của staff",
        level: "employee",
        employeeId: staffEmpA,
        ownerEmployeeId: staffEmpA,
        status: "Active",
        progressMode: "tasks",
      });
      const res = await auth("post", `/goals/${goalId}/decompose`).send({
        templateId,
        items: [{ title: "Việc cá nhân 1" }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const rows = await direct.query(
        "SELECT main_assignee_employee_id FROM tasks WHERE goal_id = $1",
        [goalId],
      );
      expect(rows.rows[0].main_assignee_employee_id).toBe(staffEmpA);
    });
  });

  // ── T3. Phân rã — deny-path ───────────────────────────────────────────────────
  describe("T3. Phân rã — chặn (rollback toàn phần)", () => {
    let templateId = "";

    beforeAll(async () => {
      templateId = await createTemplate({ name: `Template deny ${Date.now()}` });
    });

    const projectGoal = async (name: string, extra: Record<string, unknown> = {}) =>
      createGoal({
        name,
        level: "project",
        projectId: projectA,
        status: "Active",
        progressMode: "tasks",
        ...extra,
      });

    it("item thứ 2 sai (cột board của dự án KHÁC) ⇒ 4xx và 0 task được tạo (rollback HẾT)", async () => {
      const goalId = await projectGoal("Mục tiêu rollback");
      const res = await auth("post", `/goals/${goalId}/decompose`).send({
        templateId,
        items: [
          { title: "Việc hợp lệ", stateId: stateA },
          { title: "Việc sai cột", stateId: stateA2 }, // cột thuộc projectA2
        ],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(await goalTaskCount(goalId)).toBe(0);

      // CHỨNG MINH PHÉP THỬ CÓ NGHĨA (chống xanh-giả): cùng item ĐẦU, bỏ item sai ⇒ tạo được 1 việc.
      // Vậy số 0 ở trên đến từ ROLLBACK giữa lô, KHÔNG phải vì cả lô bị chặn từ ngoài cổng.
      const ok = await auth("post", `/goals/${goalId}/decompose`).send({
        templateId,
        items: [{ title: "Việc hợp lệ", stateId: stateA }],
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(await goalTaskCount(goalId)).toBe(1);
    });

    it("mục tiêu đã CHỐT KỲ ⇒ 422 GOAL-ERR-005, 0 task", async () => {
      const goalId = await projectGoal("Mục tiêu đã chốt");
      expect((await auth("post", `/goals/${goalId}/finalize`).send({})).status).toBe(201);
      const res = await auth("post", `/goals/${goalId}/decompose`).send({
        templateId,
        items: [{ title: "Không được tạo" }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-005");
      expect(await goalTaskCount(goalId)).toBe(0);
    });

    it("mục tiêu Cancelled ⇒ 422 GOAL-ERR-009, 0 task", async () => {
      const goalId = await projectGoal("Mục tiêu huỷ", { status: "Cancelled" });
      const res = await auth("post", `/goals/${goalId}/decompose`).send({
        templateId,
        items: [{ title: "Không được tạo" }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-009");
      expect(await goalTaskCount(goalId)).toBe(0);
    });

    it("danh sách rỗng ⇒ 400 (trần Zod min(1)) — không tạo gì", async () => {
      const goalId = await projectGoal("Mục tiêu rỗng");
      const res = await auth("post", `/goals/${goalId}/decompose`).send({ templateId, items: [] });
      expect(res.status).toBe(400);
      expect(await goalTaskCount(goalId)).toBe(0);
    });

    it("51 item ⇒ 422 GOAL-ERR-009 (trần nghiệp vụ 50), 0 task", async () => {
      const goalId = await projectGoal("Mục tiêu quá tải");
      const items = Array.from({ length: 51 }, (_, i) => ({ title: `Việc ${i + 1}` }));
      const res = await auth("post", `/goals/${goalId}/decompose`).send({ templateId, items });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-009");
      expect(await goalTaskCount(goalId)).toBe(0);
    });

    it("template của công ty KHÁC ⇒ 404 (không 500 vỡ FK), 0 task", async () => {
      const goalId = await projectGoal("Mục tiêu template lạ");
      const res = await auth("post", `/goals/${goalId}/decompose`).send({
        templateId: templateOfB,
        items: [{ title: "Không được tạo" }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(await goalTaskCount(goalId)).toBe(0);
    });

    it("mục tiêu của công ty KHÁC ⇒ 404, 0 task", async () => {
      const res = await auth("post", `/goals/${goalOfB}/decompose`).send({
        templateId,
        items: [{ title: "Không được tạo" }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(await goalTaskCount(goalOfB)).toBe(0);
    });

    it("mục tiêu cá nhân + item khai assignee KHÁC ⇒ 422 GOAL-ERR-008, 0 task", async () => {
      const goalId = await createGoal({
        name: "Mục tiêu staff (neo)",
        level: "employee",
        employeeId: staffEmpA,
        ownerEmployeeId: staffEmpA,
        status: "Active",
        progressMode: "tasks",
      });
      const res = await auth("post", `/goals/${goalId}/decompose`).send({
        templateId,
        items: [
          { title: "Việc đúng người" },
          { title: "Việc sai người", assigneeEmployeeId: adminEmpA },
        ],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-008");
      expect(await goalTaskCount(goalId)).toBe(0);
    });

    it("mục tiêu cấp phòng + item khai cột board ⇒ 400 (không có dự án để đặt cột), 0 task", async () => {
      const goalId = await createGoal({
        name: "Mục tiêu phòng (cột)",
        level: "department",
        departmentId: ouA,
        status: "Active",
        progressMode: "tasks",
      });
      const res = await auth("post", `/goals/${goalId}/decompose`).send({
        templateId,
        items: [{ title: "Việc phòng", stateId: stateA, assigneeEmployeeId: staffEmpA }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(await goalTaskCount(goalId)).toBe(0);
    });
  });
});
