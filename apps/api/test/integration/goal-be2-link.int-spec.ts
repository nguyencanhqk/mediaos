/**
 * S5-GOAL-BE-2 — gắn/tháo task↔goal (GOAL-API-010 · GOAL-ERR-008) + IDOR chéo tenant + 2 event NOTI.
 *
 * Phủ:
 *  · GOAL-ERR-008: goal `employee` ⇔ assignee khác ⇒ 422 CHẶN · goal `project` ⇔ task khác dự án ⇒ 422
 *    CHẶN · goal `department` ⇔ task không liên quan phòng ⇒ **200 kèm cảnh báo mềm** (KHÔNG chặn);
 *  · CHÉO TENANT: taskId/goalId của công ty khác ⇒ 404 (không 500 vỡ FK — FK đơn cột KHÔNG ép cùng-tenant);
 *  · link/unlink kéo theo recompute đúng mục tiêu (mới + CŨ) và bubble lên cha;
 *  · `GET /tasks/:id` trả `goalId`/`goalName` qua MAPPER HỢP NHẤT (không bản sao thứ hai);
 *  · outbox `goal.assigned` / `goal.finalized`: điều kiện phát, im lặng khi tự giao cho mình, và payload
 *    KHỚP TỪNG KHOÁ với placeholder template seed 0507 (sai tên khoá = message câm, không lỗi).
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
const LOGIN_PW = ["Passw0rd", "goalbe2link"].join("!");

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

/** Rút mọi `{placeholder}` khỏi template — nguồn sự thật để so với khoá payload outbox. */
function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);
}

describe.skipIf(!hasLaneDb)("S5-GOAL-BE-2 link task↔goal + NOTI (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let ouA = "";
  let ouOther = "";
  let adminUserA = "";
  let adminEmpA = "";
  let staffEmpA = "";
  let projectA = "";
  let projectA2 = "";
  let token = "";

  /** Thực thể của công ty B — dùng nguyên văn để thử IDOR chéo tenant. */
  let goalOfB = "";
  let taskOfB = "";

  const auth = (m: "get" | "post" | "patch" | "delete", u: string) =>
    request(app.getHttpServer())[m](u).set("Authorization", `Bearer ${token}`);

  const createGoal = async (body: Record<string, unknown>): Promise<string> => {
    const res = await auth("post", "/goals").send({ ...PERIOD, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  };

  const createTask = async (body: Record<string, unknown>): Promise<string> => {
    const res = await auth("post", "/tasks").send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  };

  const outboxOf = async (eventType: string) => {
    const r = await direct.query(
      "SELECT payload FROM outbox_events WHERE event_type = $1 ORDER BY created_at",
      [eventType],
    );
    return r.rows.map((row) => row.payload as Record<string, unknown>);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "goalbe2l");
    B = await seedCompany(direct, "goalbe2lb");
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
    ouOther = await mkOu(A.companyId, "Phòng khác");
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
    staffEmpA = (await mkEmp(A.companyId, `staff@${A.slug}.test`, ouA)).empId;
    const adminB = await mkEmp(B.companyId, `admin@${B.slug}.test`, ouB);

    await direct.query("UPDATE users SET full_name = 'Trưởng phòng A' WHERE id = $1", [adminUserA]);
    await direct.query("UPDATE org_units SET head_user_id = $1 WHERE id = $2", [adminUserA, ouA]);

    const roleId = await seedRole(direct, A.companyId, "goal-be2-l-admin");
    for (const [action, resource] of [
      ["access", "goal"],
      ["view", "goal"],
      ["create", "goal"],
      ["update", "goal"],
      ["delete", "goal"],
      ["checkin", "goal"],
      ["finalize", "goal"],
      ["read", "task"],
      ["create", "task"],
      ["update", "task"],
      ["update-status", "task"],
    ] as const) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, adminUserA, roleId, A.companyId);

    const mkProject = async (companyId: string, name: string, ouId: string, ownerEmp: string) => {
      const r = await direct.query(
        `INSERT INTO projects (company_id, name, status, department_id, owner_employee_id)
         VALUES ($1,$2,'active',$3,$4) RETURNING id`,
        [companyId, name, ouId, ownerEmp],
      );
      return r.rows[0].id as string;
    };
    projectA = await mkProject(A.companyId, "Dự án A1", ouA, adminEmpA);
    projectA2 = await mkProject(A.companyId, "Dự án A2", ouA, adminEmpA);

    // Thực thể công ty B — dựng bằng direct pool (không qua API của A).
    const gB = await direct.query(
      `INSERT INTO goals (company_id, goal_code, name, level, department_id, owner_employee_id,
                          period_type, period_start, period_end, progress_mode, status)
       VALUES ($1,'GOAL-B001','Mục tiêu của B','department',$2,$3,'quarter',$4,$5,'tasks','Active')
       RETURNING id`,
      [B.companyId, ouB, adminB.empId, PERIOD.periodStart, PERIOD.periodEnd],
    );
    goalOfB = gB.rows[0].id as string;
    const tB = await direct.query(
      `INSERT INTO tasks (company_id, title, task_type, task_status)
       VALUES ($1,'Việc của B','office','Todo') RETURNING id`,
      [B.companyId],
    );
    taskOfB = tB.rows[0].id as string;

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: A.slug, email: `admin@${A.slug}.test`, password: LOGIN_PW });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    token = login.body.data.accessToken as string;
  }, 180_000);

  afterAll(async () => {
    await direct.query("UPDATE tasks SET goal_id = NULL WHERE company_id = ANY($1::uuid[])", [
      companyIds,
    ]);
    await direct.query("DELETE FROM goal_updates WHERE company_id = ANY($1::uuid[])", [companyIds]);
    await direct.query("DELETE FROM goals WHERE company_id = ANY($1::uuid[])", [companyIds]);
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── L1. GOAL-ERR-008 theo cấp mục tiêu ────────────────────────────────────────
  describe("L1. GOAL-ERR-008 (neo gắn task)", () => {
    it("goal employee ⇔ task assignee KHÁC nhân viên đó ⇒ 422, KHÔNG ghi hàng nào", async () => {
      const g = await createGoal({
        name: "Mục tiêu của staff",
        level: "employee",
        employeeId: staffEmpA,
        ownerEmployeeId: staffEmpA,
        status: "Active",
        progressMode: "tasks",
      });
      const tOk = await createTask({ title: "Đúng người", assigneeEmployeeId: staffEmpA });
      const tBad = await createTask({ title: "Sai người", assigneeEmployeeId: adminEmpA });

      const res = await auth("post", `/goals/${g}/tasks`).send({ taskIds: [tOk, tBad] });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-008");

      // TẤT-CẢ-HOẶC-KHÔNG: task hợp lệ trong cùng lô cũng KHÔNG được gắn.
      const rows = await direct.query("SELECT id FROM tasks WHERE goal_id = $1", [g]);
      expect(rows.rowCount).toBe(0);
    });

    it("goal project ⇔ task thuộc dự án KHÁC ⇒ 422", async () => {
      const g = await createGoal({
        name: "Mục tiêu dự án A1",
        level: "project",
        projectId: projectA,
        status: "Active",
        progressMode: "tasks",
      });
      const tOther = await createTask({ title: "Việc dự án A2", projectId: projectA2 });
      const res = await auth("post", `/goals/${g}/tasks`).send({ taskIds: [tOther] });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-008");
    });

    it("goal department ⇔ task không liên quan phòng ⇒ 201 + CẢNH BÁO MỀM (không chặn)", async () => {
      const g = await createGoal({
        name: "Mục tiêu phòng A",
        level: "department",
        departmentId: ouA,
        status: "Active",
        progressMode: "tasks",
      });
      const tOutside = await createTask({ title: "Việc phòng khác", departmentId: ouOther });
      const res = await auth("post", `/goals/${g}/tasks`).send({ taskIds: [tOutside] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.linked).toBe(1);
      expect(res.body.data.warnings).toHaveLength(1);
      expect(res.body.data.warnings[0].taskId).toBe(tOutside);
    });
  });

  // ── L2. Chéo tenant (IDOR) — 404 sạch, KHÔNG 500 vỡ FK ────────────────────────
  describe("L2. IDOR chéo tenant", () => {
    it("gắn task CỦA CÔNG TY KHÁC ⇒ 404 và cột goal_id của task đó KHÔNG đổi", async () => {
      const g = await createGoal({
        name: "Mục tiêu A nhận việc B?",
        level: "department",
        departmentId: ouA,
        status: "Active",
        progressMode: "tasks",
      });
      const res = await auth("post", `/goals/${g}/tasks`).send({ taskIds: [taskOfB] });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      const row = await direct.query("SELECT goal_id FROM tasks WHERE id = $1", [taskOfB]);
      expect(row.rows[0].goal_id).toBeNull();
    });

    it("thao tác trên goal CỦA CÔNG TY KHÁC (link/unlink/check-in/finalize/updates) ⇒ 404", async () => {
      const t = await createTask({ title: "Việc của A" });
      const cases = [
        await auth("post", `/goals/${goalOfB}/tasks`).send({ taskIds: [t] }),
        await auth("delete", `/goals/${goalOfB}/tasks/${t}`),
        await auth("post", `/goals/${goalOfB}/check-in`).send({ progressPercent: 1 }),
        await auth("post", `/goals/${goalOfB}/finalize`).send({}),
        await auth("get", `/goals/${goalOfB}/updates`),
        await auth("get", `/goals/${goalOfB}/tasks`),
      ];
      for (const res of cases) expect(res.status, JSON.stringify(res.body)).toBe(404);
      // Hậu kiểm ở DB: 0 task của A trỏ sang goal của B.
      const leak = await direct.query(
        "SELECT count(*)::int AS n FROM tasks WHERE company_id = $1 AND goal_id = $2",
        [A.companyId, goalOfB],
      );
      expect(leak.rows[0].n).toBe(0);
    });
  });

  // ── L3. Recompute khi gắn/tháo + DTO task additive ────────────────────────────
  describe("L3. gắn/tháo ⇒ recompute + DTO task", () => {
    it("chuyển task từ mục tiêu CŨ sang MỚI ⇒ tính lại CẢ HAI", async () => {
      const gOld = await createGoal({
        name: "Mục tiêu cũ",
        level: "department",
        departmentId: ouA,
        status: "Active",
        progressMode: "tasks",
      });
      const gNew = await createGoal({
        name: "Mục tiêu mới",
        level: "department",
        departmentId: ouA,
        status: "Active",
        progressMode: "tasks",
      });
      const t = await createTask({ title: "Việc di dời" });
      await auth("post", `/goals/${gOld}/tasks`).send({ taskIds: [t] });
      expect((await auth("get", `/goals/${gOld}`)).body.data.progressPercent).toBe(0);

      const move = await auth("post", `/goals/${gNew}/tasks`).send({ taskIds: [t] });
      expect(move.status, JSON.stringify(move.body)).toBe(201);
      // Mục tiêu CŨ mất việc duy nhất ⇒ quay lại "chưa đo" (NULL), KHÔNG phải 0%.
      expect((await auth("get", `/goals/${gOld}`)).body.data.progressPercent).toBeNull();
      expect((await auth("get", `/goals/${gNew}`)).body.data.progressPercent).toBe(0);
    });

    it("tháo task ⇒ 404 khi task không gắn ĐÚNG mục tiêu này; tháo đúng ⇒ mục tiêu về 'chưa đo'", async () => {
      const g = await createGoal({
        name: "Mục tiêu tháo",
        level: "department",
        departmentId: ouA,
        status: "Active",
        progressMode: "tasks",
      });
      const t = await createTask({ title: "Việc tháo" });
      const free = await createTask({ title: "Việc chưa gắn" });
      await auth("post", `/goals/${g}/tasks`).send({ taskIds: [t] });

      const wrong = await auth("delete", `/goals/${g}/tasks/${free}`);
      expect(wrong.status, JSON.stringify(wrong.body)).toBe(404);

      const ok = await auth("delete", `/goals/${g}/tasks/${t}`);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect((await auth("get", `/goals/${g}`)).body.data.progressPercent).toBeNull();
    });

    it("GET /tasks/:id và GET /goals/:id/tasks đều trả goalId/goalName (mapper hợp nhất)", async () => {
      const g = await createGoal({
        name: "Mục tiêu hiển thị trên thẻ",
        level: "department",
        departmentId: ouA,
        status: "Active",
        progressMode: "tasks",
      });
      const t = await createTask({ title: "Việc có mục tiêu" });
      await auth("post", `/goals/${g}/tasks`).send({ taskIds: [t] });

      const task = await auth("get", `/tasks/${t}`);
      expect(task.status, JSON.stringify(task.body)).toBe(200);
      expect(task.body.data.goalId).toBe(g);
      expect(task.body.data.goalName).toBe("Mục tiêu hiển thị trên thẻ");

      const linked = await auth("get", `/goals/${g}/tasks`);
      expect(linked.status, JSON.stringify(linked.body)).toBe(200);
      expect(linked.body.data).toHaveLength(1);
      expect(linked.body.data[0].id).toBe(t);
      expect(linked.body.data[0].goalId).toBe(g);
    });
  });

  // ── L4. NOTI (SPEC-10 §17) ────────────────────────────────────────────────────
  describe("L4. GOAL_ASSIGNED / GOAL_FINALIZED", () => {
    it("giao mục tiêu cho NGƯỜI KHÁC ⇒ enqueue goal.assigned; tự giao cho mình ⇒ IM LẶNG", async () => {
      const before = (await outboxOf("goal.assigned")).length;

      await createGoal({
        name: "Giao cho staff",
        level: "employee",
        employeeId: staffEmpA,
        ownerEmployeeId: staffEmpA,
        status: "Active",
        progressMode: "manual",
      });
      const afterOther = await outboxOf("goal.assigned");
      expect(afterOther.length).toBe(before + 1);

      // Tự đặt mục tiêu cho CHÍNH MÌNH (actor = adminEmpA) ⇒ không thêm sự kiện nào.
      await createGoal({
        name: "Mục tiêu của chính tôi",
        level: "employee",
        employeeId: adminEmpA,
        ownerEmployeeId: adminEmpA,
        status: "Active",
        progressMode: "manual",
      });
      expect((await outboxOf("goal.assigned")).length).toBe(before + 1);

      // Mục tiêu cấp PHÒNG không phải "giao việc cho ai" ⇒ cũng im lặng.
      await createGoal({
        name: "Mục tiêu phòng không phát NOTI",
        level: "department",
        departmentId: ouA,
        status: "Active",
        progressMode: "tasks",
      });
      expect((await outboxOf("goal.assigned")).length).toBe(before + 1);
    });

    it("payload goal.assigned/goal.finalized KHỚP TỪNG KHOÁ với placeholder template 0507", async () => {
      const g = await createGoal({
        name: "Mục tiêu chốt để bắn NOTI",
        level: "employee",
        employeeId: staffEmpA,
        ownerEmployeeId: staffEmpA,
        status: "Active",
        progressMode: "manual",
        measureType: "percent",
      });
      await auth("post", `/goals/${g}/check-in`).send({ progressPercent: 90 });
      expect((await auth("post", `/goals/${g}/finalize`).send({})).status).toBe(201);

      const templates = await direct.query(
        `SELECT e.event_code, t.title_template, t.body_template, t.target_url_template
           FROM notification_templates t
           JOIN notification_events e ON e.id = t.event_id
          WHERE e.event_code IN ('GOAL_ASSIGNED','GOAL_FINALIZED')
            AND t.company_id IS NULL AND t.deleted_at IS NULL`,
      );
      expect(templates.rowCount).toBeGreaterThanOrEqual(2);

      const assigned = (await outboxOf("goal.assigned")).at(-1);
      const finalized = (await outboxOf("goal.finalized")).at(-1);
      expect(assigned).toBeDefined();
      expect(finalized).toBeDefined();

      for (const row of templates.rows as {
        event_code: string;
        title_template: string;
        body_template: string;
        target_url_template: string;
      }[]) {
        const needed = new Set(
          [
            ...placeholdersOf(row.title_template ?? ""),
            ...placeholdersOf(row.body_template ?? ""),
            ...placeholdersOf(row.target_url_template ?? ""),
          ].filter((k) => k.length > 0),
        );
        const payload = row.event_code === "GOAL_ASSIGNED" ? assigned! : finalized!;
        for (const key of needed) {
          expect(
            Object.prototype.hasOwnProperty.call(payload, key),
            `payload ${row.event_code} thiếu khoá '${key}' ⇒ message giữ nguyên placeholder CÂM`,
          ).toBe(true);
        }
      }

      // BẤT BIẾN #3 / SPEC-10 §18 — payload KHÔNG mang số liệu nội bộ ngoài danh mục.
      for (const key of ["current_value", "target_value", "currentValue", "ownerEmployeeId"]) {
        expect(Object.prototype.hasOwnProperty.call(assigned!, key)).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(finalized!, key)).toBe(false);
      }
      expect(finalized!.final_progress).toBe("90%");
      expect(assigned!.assigner_name).toBe("Trưởng phòng A");
    });
  });
});
