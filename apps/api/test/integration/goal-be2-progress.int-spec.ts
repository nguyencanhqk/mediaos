/**
 * S5-GOAL-BE-2 — vòng đo tiến độ ĐI TẬN DB, ĐƯỜNG THẬT (SPEC-10 §13).
 *
 * Phủ: 4 công thức mode qua HTTP thật (không mock engine) · "chưa đo ≠ 0%" · recompute ĐỒNG BỘ tại các
 * writer THẬT của TASK (đổi trạng thái · Cancelled · xoá mềm · đổi dự án) · bubble lên cha `children` ·
 * ĐÓNG BĂNG tuyệt đối sau chốt kỳ · job đối soát đêm (sửa drift + idempotent + không đụng goal đã chốt).
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DiscoveryService } from "@nestjs/core";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import {
  GoalReconciliationJobHandler,
  GOAL_PROGRESS_RECONCILE_JOB_CODE,
} from "../../src/goals/goal-reconciliation.job-handler";
import { SYSTEM_JOB_HANDLER } from "../../src/scheduler/job-handler";
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
const LOGIN_PW = ["Passw0rd", "goalbe2progress"].join("!");
const PERIOD = {
  periodType: "quarter" as const,
  periodStart: todayShift(-30),
  periodEnd: todayShift(60),
};

function todayShift(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!hasLaneDb)("S5-GOAL-BE-2 progress engine (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let ou = "";
  let adminUser = "";
  let adminEmp = "";
  let staffEmp = "";
  let projectId = "";
  let token = "";

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

  /** POST /tasks/:id/change-status trả 200 (route khai @HttpCode(200)) — không phải 201. */
  const setStatus = async (taskId: string, status: string) => {
    const res = await auth("post", `/tasks/${taskId}/change-status`).send({ status });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res;
  };

  const progressOf = async (goalId: string): Promise<number | null> => {
    const res = await auth("get", `/goals/${goalId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.progressPercent as number | null;
  };

  /** Đọc THẲNG DB (bỏ qua mọi tầng app) — dùng để chứng minh cache thật sự đứng yên/đã đổi. */
  const rawProgress = async (goalId: string): Promise<string | null> => {
    const r = await direct.query("SELECT progress_percent FROM goals WHERE id = $1", [goalId]);
    return (r.rows[0]?.progress_percent ?? null) as string | null;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "goalbe2p");
    companyIds.push(A.companyId);
    await direct.query(
      `INSERT INTO sequence_counters
         (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
          reset_policy, increment_by, current_value, status)
       VALUES ($1,'GOAL','goal','Company','GOAL-',4,'Never',1,0,'Active'),
              ($1,'TASK','task','Company','TSK-',4,'Never',1,0,'Active')
       ON CONFLICT DO NOTHING`,
      [A.companyId],
    );

    const ouRes = await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1,'Vận hành','department') RETURNING id",
      [A.companyId],
    );
    ou = ouRes.rows[0].id as string;

    adminUser = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
    const emp = async (userId: string | null) => {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
         VALUES ($1,$2,$3,'active') RETURNING id`,
        [A.companyId, userId, ou],
      );
      return r.rows[0].id as string;
    };
    adminEmp = await emp(adminUser);
    staffEmp = await emp(await seedUser(direct, A.companyId, `staff@${A.slug}.test`, hash));

    const roleId = await seedRole(direct, A.companyId, "goal-be2-admin");
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
      ["delete", "task"],
    ] as const) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, adminUser, roleId, A.companyId);

    const pr = await direct.query(
      `INSERT INTO projects (company_id, name, status, department_id, owner_employee_id)
       VALUES ($1,'Dự án đo',$2,$3,$4) RETURNING id`,
      [A.companyId, "active", ou, adminEmp],
    );
    projectId = pr.rows[0].id as string;

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

  // ── P1. mode='manual' — 3 kiểu đo (§13.1) ─────────────────────────────────────
  describe("P1. mode='manual'", () => {
    it("measure=percent: check-in 42.5 ⇒ progress 42.5 (giá trị check-in CHÍNH LÀ %)", async () => {
      const g = await createGoal({
        name: "Manual percent",
        level: "employee",
        employeeId: staffEmp,
        ownerEmployeeId: staffEmp,
        status: "Active",
        progressMode: "manual",
        measureType: "percent",
      });
      expect(await progressOf(g)).toBeNull(); // chưa check-in ⇒ CHƯA ĐO
      const res = await auth("post", `/goals/${g}/check-in`).send({ progressPercent: 42.5 });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await progressOf(g)).toBe(42.5);
    });

    it("measure=number: clamp(current/target×100)", async () => {
      const g = await createGoal({
        name: "Manual number",
        level: "employee",
        employeeId: staffEmp,
        ownerEmployeeId: staffEmp,
        status: "Active",
        progressMode: "manual",
        measureType: "number",
        targetValue: 120,
        unit: "video",
      });
      await auth("post", `/goals/${g}/check-in`).send({ currentValue: 30 });
      expect(await progressOf(g)).toBe(25);
      // Vượt chỉ tiêu KHÔNG cho ra >100 (CHECK chk_goals_progress cũng chặn — không để vỡ thành 500).
      await auth("post", `/goals/${g}/check-in`).send({ currentValue: 500 });
      expect(await progressOf(g)).toBe(100);
    });

    it("measure=boolean: 0 ⇒ 0% · khác 0 ⇒ 100%", async () => {
      const g = await createGoal({
        name: "Manual boolean",
        level: "employee",
        employeeId: staffEmp,
        ownerEmployeeId: staffEmp,
        status: "Active",
        progressMode: "manual",
        measureType: "boolean",
      });
      await auth("post", `/goals/${g}/check-in`).send({ currentValue: 0 });
      expect(await progressOf(g)).toBe(0);
      await auth("post", `/goals/${g}/check-in`).send({ currentValue: 1 });
      expect(await progressOf(g)).toBe(100);
    });
  });

  // ── P2. mode='tasks' — §13.1 + §13.2 + GOAL-DEC-006 ───────────────────────────
  describe("P2. mode='tasks'", () => {
    it("0 task gắn ⇒ progress NULL (KHÔNG 0%); 1 Done/1 chưa ⇒ 50; Cancelled loại khỏi CẢ tử VÀ mẫu", async () => {
      const g = await createGoal({
        name: "Đo bằng việc",
        level: "department",
        departmentId: ou,
        status: "Active",
        progressMode: "tasks",
      });
      expect(await progressOf(g)).toBeNull();

      const t1 = await createTask({ title: "Việc 1" });
      const t2 = await createTask({ title: "Việc 2" });
      const link = await auth("post", `/goals/${g}/tasks`).send({ taskIds: [t1, t2] });
      expect(link.status, JSON.stringify(link.body)).toBe(201);
      expect(await progressOf(g)).toBe(0); // ĐÃ đo được: 0/2 — khác hẳn NULL ở trên

      await setStatus(t1, "Done");
      expect(await progressOf(g)).toBe(50);

      // Huỷ việc còn lại: mẫu số còn 1, tử số còn 1 ⇒ 100 (KHÔNG phải 50).
      await setStatus(t2, "Cancelled");
      expect(await progressOf(g)).toBe(100);
    });

    it("xoá mềm task ⇒ rời tập đo ngay trong cùng request", async () => {
      const g = await createGoal({
        name: "Đo bằng việc (xoá)",
        level: "department",
        departmentId: ou,
        status: "Active",
        progressMode: "tasks",
      });
      const t1 = await createTask({ title: "Xoá 1" });
      const t2 = await createTask({ title: "Xoá 2" });
      await auth("post", `/goals/${g}/tasks`).send({ taskIds: [t1, t2] });
      await setStatus(t1, "Done");
      expect(await progressOf(g)).toBe(50);

      expect((await auth("delete", `/tasks/${t2}`)).status).toBe(204);
      expect(await progressOf(g)).toBe(100);
    });
  });

  // ── P3. mode='project' — cùng nguồn số với widget dashboard (D-35) ─────────────
  describe("P3. mode='project'", () => {
    it("số khớp CHÍNH XÁC đếm-lá của countsByStatusLeaf (không lệch widget)", async () => {
      const g = await createGoal({
        name: "Mục tiêu dự án",
        level: "project",
        projectId,
        status: "Active",
        progressMode: "project",
      });
      const a = await createTask({ title: "PJ A", projectId });
      const b = await createTask({ title: "PJ B", projectId });
      // Task tạo sau khi goal đã tồn tại ⇒ chỉ recompute khi có sự kiện đo. Đổi trạng thái 1 việc:
      await setStatus(a, "Done");

      const viaGoal = await progressOf(g);
      const counts = await direct.query(
        `SELECT coalesce(task_status,'Todo') AS s, count(*)::int AS n
           FROM tasks WHERE company_id = $1 AND project_id = $2 AND deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = tasks.id
                              AND c.company_id = tasks.company_id AND c.deleted_at IS NULL
                              AND c.task_status IS DISTINCT FROM 'Cancelled')
          GROUP BY 1`,
        [A.companyId, projectId],
      );
      let done = 0;
      let total = 0;
      for (const row of counts.rows as { s: string; n: number }[]) {
        if (row.s === "Cancelled") continue;
        total += Number(row.n);
        if (row.s === "Done") done += Number(row.n);
      }
      expect(total).toBeGreaterThan(0);
      expect(viaGoal).toBe(Math.round((done / total) * 10000) / 100);
      expect(b).toBeTruthy();
    });

    it("CẤM đọc cột chết `projects.progress_percent`: đặt cột đó = 99 KHÔNG ảnh hưởng số của mục tiêu", async () => {
      const g = await createGoal({
        name: "Mục tiêu dự án 2",
        level: "project",
        projectId,
        status: "Active",
        progressMode: "project",
      });
      const before = await progressOf(g);
      await direct.query("UPDATE projects SET progress_percent = 99 WHERE id = $1", [projectId]);
      const t = await createTask({ title: "PJ C", projectId });
      await setStatus(t, "In Progress");
      const after = await progressOf(g);
      expect(after).not.toBe(99);
      expect(after).not.toBeNull();
      expect(before).not.toBe(99);
    });
  });

  // ── P4. mode='children' — rollup weighted + bubble ─────────────────────────────
  describe("P4. mode='children' + bubble", () => {
    it("bình quân CÓ TRỌNG SỐ; con Cancelled/chưa-đo bị loại; bubble tự động khi con đổi", async () => {
      const parent = await createGoal({
        name: "Mục tiêu phòng (rollup)",
        level: "department",
        departmentId: ou,
        status: "Active",
        progressMode: "children",
      });
      expect(await progressOf(parent)).toBeNull(); // 0 con ⇒ CHƯA ĐO

      const c1 = await createGoal({
        name: "Con w3",
        level: "employee",
        employeeId: staffEmp,
        ownerEmployeeId: staffEmp,
        parentGoalId: parent,
        status: "Active",
        progressMode: "manual",
        measureType: "percent",
        weight: 3,
      });
      const c2 = await createGoal({
        name: "Con w1",
        level: "employee",
        employeeId: adminEmp,
        ownerEmployeeId: adminEmp,
        parentGoalId: parent,
        status: "Active",
        progressMode: "manual",
        measureType: "percent",
        weight: 1,
      });
      // c2 chưa check-in ⇒ null ⇒ LOẠI khỏi cả tử và mẫu.
      await auth("post", `/goals/${c1}/check-in`).send({ progressPercent: 60 });
      expect(await progressOf(parent)).toBe(60);

      await auth("post", `/goals/${c2}/check-in`).send({ progressPercent: 100 });
      expect(await progressOf(parent)).toBe(70); // (60×3 + 100×1) / 4

      // Huỷ con w1 ⇒ loại khỏi rollup ⇒ quay về 60.
      const cancel = await auth("patch", `/goals/${c2}`).send({ status: "Cancelled" });
      expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
      expect(await progressOf(parent)).toBe(60);
    });

    it("bubble 2 tầng: task Done ⇒ con (tasks) ⇒ cha (children)", async () => {
      const parent = await createGoal({
        name: "Cha 2 tầng",
        level: "department",
        departmentId: ou,
        status: "Active",
        progressMode: "children",
      });
      const child = await createGoal({
        name: "Con đo bằng việc",
        level: "employee",
        employeeId: staffEmp,
        ownerEmployeeId: staffEmp,
        parentGoalId: parent,
        status: "Active",
        progressMode: "tasks",
      });
      // Mục tiêu cấp nhân viên ⇒ GOAL-ERR-008 đòi assignee ĐÚNG người (vế CHẶN) — không gán thì 422.
      const t = await createTask({ title: "Việc bubble", assigneeEmployeeId: staffEmp });
      const link = await auth("post", `/goals/${child}/tasks`).send({ taskIds: [t] });
      expect(link.status, JSON.stringify(link.body)).toBe(201);
      expect(await progressOf(child)).toBe(0);
      expect(await progressOf(parent)).toBe(0);

      await setStatus(t, "Done");
      expect(await progressOf(child)).toBe(100);
      expect(await progressOf(parent)).toBe(100);
    });
  });

  // ── P5. ĐÓNG BĂNG sau chốt kỳ (§13.4 · GOAL-ERR-005) ──────────────────────────
  describe("P5. đóng băng sau chốt kỳ", () => {
    it("goal đã chốt: task con đổi trạng thái NGAY SAU ĐÓ vẫn KHÔNG làm progress nhúc nhích", async () => {
      const g = await createGoal({
        name: "Chốt rồi thì đứng yên",
        level: "department",
        departmentId: ou,
        status: "Active",
        progressMode: "tasks",
      });
      const t1 = await createTask({ title: "Đóng băng 1" });
      const t2 = await createTask({ title: "Đóng băng 2" });
      await auth("post", `/goals/${g}/tasks`).send({ taskIds: [t1, t2] });
      await setStatus(t1, "Done");
      expect(await progressOf(g)).toBe(50);

      const fin = await auth("post", `/goals/${g}/finalize`).send({});
      expect(fin.status, JSON.stringify(fin.body)).toBe(201);
      const frozen = await rawProgress(g);

      await setStatus(t2, "Done");
      expect(await rawProgress(g)).toBe(frozen);
      expect(await progressOf(g)).toBe(50);
    });

    it("goal đã chốt: mọi đường ghi GOAL đều 422 GOAL-ERR-005 (update/check-in/link/unlink)", async () => {
      const g = await createGoal({
        name: "Đóng băng đường ghi",
        level: "department",
        departmentId: ou,
        status: "Active",
        progressMode: "tasks",
      });
      const t = await createTask({ title: "Đóng băng link" });
      await auth("post", `/goals/${g}/tasks`).send({ taskIds: [t] });
      expect((await auth("post", `/goals/${g}/finalize`).send({})).status).toBe(201);

      const other = await createTask({ title: "Việc thêm sau khi chốt" });
      const cases = [
        await auth("patch", `/goals/${g}`).send({ name: "Đổi tên" }),
        await auth("post", `/goals/${g}/check-in`).send({ progressPercent: 10 }),
        await auth("post", `/goals/${g}/tasks`).send({ taskIds: [other] }),
        await auth("delete", `/goals/${g}/tasks/${t}`),
        await auth("delete", `/goals/${g}`),
      ];
      for (const res of cases) {
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(JSON.stringify(res.body)).toContain("GOAL-ERR-005");
      }
    });

    it("reopen ⇒ nhận lại recompute NGAY (số cũ được sửa lại theo dữ liệu hiện tại)", async () => {
      const g = await createGoal({
        name: "Mở lại thì đo lại",
        level: "department",
        departmentId: ou,
        status: "Active",
        progressMode: "tasks",
      });
      const t1 = await createTask({ title: "Reopen 1" });
      const t2 = await createTask({ title: "Reopen 2" });
      await auth("post", `/goals/${g}/tasks`).send({ taskIds: [t1, t2] });
      await setStatus(t1, "Done");
      await auth("post", `/goals/${g}/finalize`).send({});
      await setStatus(t2, "Done"); // bị bỏ qua vì đang đóng băng
      expect(await progressOf(g)).toBe(50);

      const re = await auth("post", `/goals/${g}/reopen`).send({});
      expect(re.status, JSON.stringify(re.body)).toBe(201);
      expect(re.body.data.progressPercent).toBe(100);
      expect(await progressOf(g)).toBe(100);
    });
  });

  // ── P6. Job đối soát đêm (§13.3) ──────────────────────────────────────────────
  describe("P6. job đối soát GOAL_PROGRESS_RECONCILE", () => {
    it("sửa cache bị làm lệch, KHÔNG đụng goal đã chốt, chạy lại lần 2 ⇒ 0 sửa (idempotent)", async () => {
      const handler = app.get(GoalReconciliationJobHandler);

      const drifted = await createGoal({
        name: "Cache lệch",
        level: "department",
        departmentId: ou,
        status: "Active",
        progressMode: "tasks",
      });
      const t1 = await createTask({ title: "Đối soát 1" });
      const t2 = await createTask({ title: "Đối soát 2" });
      await auth("post", `/goals/${drifted}/tasks`).send({ taskIds: [t1, t2] });
      await setStatus(t1, "Done");
      expect(await rawProgress(drifted)).toBe("50.00");

      const frozenGoal = await createGoal({
        name: "Đã chốt — job không đụng",
        level: "department",
        departmentId: ou,
        status: "Active",
        progressMode: "manual",
        measureType: "percent",
      });
      await auth("post", `/goals/${frozenGoal}/check-in`).send({ progressPercent: 77 });
      await auth("post", `/goals/${frozenGoal}/finalize`).send({});
      // Làm lệch CẢ HAI bằng đường DB thẳng (mô phỏng import/script ghi tay).
      await direct.query("UPDATE goals SET progress_percent = 11 WHERE id = ANY($1::uuid[])", [
        [drifted, frozenGoal],
      ]);

      const first = await handler.run({ companyId: A.companyId });
      expect(first.failed).toBe(0);
      expect(await rawProgress(drifted)).toBe("50.00");
      // Goal đã chốt kỳ: job KHÔNG sửa (vẫn giữ giá trị bị làm lệch — đóng băng nghĩa là đóng băng).
      expect(await rawProgress(frozenGoal)).toBe("11.00");
      expect((first.metadata as { fixed: number }).fixed).toBeGreaterThan(0);

      const second = await handler.run({ companyId: A.companyId });
      expect((second.metadata as { fixed: number }).fixed).toBe(0);
    });

    /**
     * Handler nằm trong `providers` của GoalsModule, KHÔNG được SchedulerModule import tường minh.
     * Test này là BẰNG CHỨNG rằng DiscoveryService vẫn gom được nó trong container THẬT (GoalsModule ở
     * AppModule root ⇒ đã init xong trước `onApplicationBootstrap` của WorkerSchedulerService) —
     * nếu không, job sẽ KHÔNG BAO GIỜ chạy mà không có một dòng lỗi nào.
     */
    it("DiscoveryService gom được handler trong container THẬT (không cần sửa scheduler.module.ts)", () => {
      const discovery = app.get(DiscoveryService);
      const codes = discovery
        .getProviders()
        .filter(
          (w) =>
            w.metatype != null &&
            w.instance != null &&
            Reflect.getMetadata(SYSTEM_JOB_HANDLER, w.metatype) === true,
        )
        .map((w) => (w.instance as { jobCode?: string }).jobCode);
      expect(codes).toContain(GOAL_PROGRESS_RECONCILE_JOB_CODE);
    });
  });
});
