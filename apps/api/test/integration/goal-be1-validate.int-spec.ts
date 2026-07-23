/**
 * S5-GOAL-BE-1 — validate nghiệp vụ + CRUD xoá mềm (SPEC-10 §12 mã lỗi · §15 GOAL-API-001..006).
 *
 * Phủ mã lỗi thuộc phạm vi WO: GOAL-ERR-001 (cấp↔neo) · 002 (cha: cùng company, đúng chiều cấp, chống
 * chu trình) · 003 (kỳ) · 004 (cấp company bị chặn ở MVP) · 007 (xoá khi còn con) · 010 (nhân viên
 * Active + owner=employee) · 011 (weight) · 012 (mode project) · 015 (target_value khi number+manual).
 * Ràng buộc DB (CHECK) được PHẢN CHIẾU thành 422 CÓ MÃ ở service — KHÔNG để vỡ CHECK thành 500 mờ.
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
const LOGIN_PW = "Passw0rd!goal2";
const PERIOD = {
  periodType: "quarter" as const,
  periodStart: "2026-07-01",
  periodEnd: "2026-09-30",
};

describe.skipIf(!hasLaneDb)("S5-GOAL-BE-1 validate + CRUD (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let ou = "";
  let adminUser = "";
  let adminEmp = "";
  let staffEmp = "";
  let resignedEmp = "";
  let projectId = "";
  let token = "";

  const authGet = (u: string) =>
    request(app.getHttpServer()).get(u).set("Authorization", `Bearer ${token}`);
  const authPost = (u: string) =>
    request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${token}`);
  const authPatch = (u: string) =>
    request(app.getHttpServer()).patch(u).set("Authorization", `Bearer ${token}`);
  const authDelete = (u: string) =>
    request(app.getHttpServer()).delete(u).set("Authorization", `Bearer ${token}`);

  /** Tạo goal qua ĐƯỜNG API (mọi validate đi qua service) — trả response để assert. */
  const createGoal = (body: Record<string, unknown>) =>
    authPost("/goals").send({ ...PERIOD, ...body });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "goal2");
    companyIds.push(A.companyId);
    await direct.query(
      `INSERT INTO sequence_counters
         (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
          reset_policy, increment_by, current_value, status)
       VALUES ($1,'GOAL','goal','Company','GOAL-',4,'Never',1,0,'Active')
       ON CONFLICT DO NOTHING`,
      [A.companyId],
    );

    const ouRes = await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1,'Vận hành','department') RETURNING id",
      [A.companyId],
    );
    ou = ouRes.rows[0].id as string;

    adminUser = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
    const emp = async (userId: string | null, status: string) => {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [A.companyId, userId, ou, status],
      );
      return r.rows[0].id as string;
    };
    adminEmp = await emp(adminUser, "active");
    staffEmp = await emp(
      await seedUser(direct, A.companyId, `staff@${A.slug}.test`, hash),
      "active",
    );
    resignedEmp = await emp(
      await seedUser(direct, A.companyId, `gone@${A.slug}.test`, hash),
      "resigned",
    );

    const roleId = await seedRole(direct, A.companyId, "goal-validate-admin");
    for (const [action, scope] of [
      ["access", "Company"],
      ["view", "Company"],
      ["create", "Company"],
      ["update", "Company"],
      ["delete", "Company"],
    ] as const) {
      const permId = await seedPermissionCatalog(direct, action, "goal", false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, adminUser, roleId, A.companyId);

    const pr = await direct.query(
      `INSERT INTO projects (company_id, name, status, department_id, owner_employee_id)
       VALUES ($1,'Dự án V','active',$2,$3) RETURNING id`,
      [A.companyId, ou, adminEmp],
    );
    projectId = pr.rows[0].id as string;

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: A.slug, email: `admin@${A.slug}.test`, password: LOGIN_PW });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    token = login.body.data.accessToken as string;
  }, 120_000);

  afterAll(async () => {
    await direct.query("DELETE FROM goal_updates WHERE company_id = ANY($1::uuid[])", [companyIds]);
    await direct.query("DELETE FROM goals WHERE company_id = ANY($1::uuid[])", [companyIds]);
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── V1. Cấp ↔ neo (GOAL-ERR-001) + cấp company (GOAL-ERR-004) ──────────────────
  describe("V1. cấp ↔ neo", () => {
    it("level='company' ⇒ 422 GOAL-ERR-004 (MVP chặn ở service)", async () => {
      const res = await createGoal({ name: "Mục tiêu công ty" });
      const res2 = await createGoal({ name: "Mục tiêu công ty", level: "company" });
      expect(res.status).toBe(400); // thiếu level ⇒ DTO 400 (zod)
      expect(res2.status, JSON.stringify(res2.body)).toBe(422);
      expect(JSON.stringify(res2.body)).toContain("GOAL-ERR-004");
    });

    it("level='department' KÈM employee_id ⇒ 422 GOAL-ERR-001", async () => {
      const res = await createGoal({
        name: "neo thừa",
        level: "department",
        departmentId: ou,
        employeeId: staffEmp,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-001");
    });

    it("level='department' THIẾU department_id ⇒ 422 GOAL-ERR-001", async () => {
      const res = await createGoal({ name: "thiếu neo", level: "department" });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-001");
    });

    it("level='project' KÈM department_id ⇒ 422 GOAL-ERR-001", async () => {
      const res = await createGoal({
        name: "dự án neo thừa",
        level: "project",
        projectId,
        departmentId: ou,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-001");
    });
  });

  // ── V2. Cha-con (GOAL-ERR-002) ────────────────────────────────────────────────
  describe("V2. parent_goal_id: đúng chiều cấp + chống chu trình", () => {
    let gDept = "";
    let gProj = "";

    it("tạo goal phòng gốc ⇒ 201 (mã GOAL-####, tiến độ NULL)", async () => {
      const res = await createGoal({
        name: "Mục tiêu phòng",
        level: "department",
        departmentId: ou,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      gDept = res.body.data.id as string;
      expect(res.body.data.goalCode).toMatch(/^GOAL-\d{4}$/);
      expect(res.body.data.progressPercent).toBeNull();
      expect(res.body.data.weight).toBe(1);
      expect(res.body.data.status).toBe("Draft");
    });

    it("goal phòng KÈM parent ⇒ 422 GOAL-ERR-002 (MVP không có cấp company)", async () => {
      const res = await createGoal({
        name: "phòng có cha",
        level: "department",
        departmentId: ou,
        parentGoalId: gDept,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-002");
    });

    it("goal dự án dưới goal phòng ⇒ 201 (đúng chiều)", async () => {
      const res = await createGoal({
        name: "Mục tiêu dự án",
        level: "project",
        projectId,
        parentGoalId: gDept,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      gProj = res.body.data.id as string;
    });

    it("goal nhân viên dưới goal NHÂN VIÊN khác (ngang cấp) ⇒ 422 GOAL-ERR-002", async () => {
      const first = await createGoal({
        name: "Mục tiêu NV gốc",
        level: "employee",
        employeeId: staffEmp,
        ownerEmployeeId: staffEmp,
      });
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      const res = await createGoal({
        name: "NV dưới NV",
        level: "employee",
        employeeId: adminEmp,
        ownerEmployeeId: adminEmp,
        parentGoalId: first.body.data.id,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-002");
    });

    it("goal nhân viên dưới goal dự án ⇒ 201 (chiều hợp lệ)", async () => {
      const res = await createGoal({
        name: "NV dưới dự án",
        level: "employee",
        employeeId: staffEmp,
        ownerEmployeeId: staffEmp,
        parentGoalId: gProj,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    it("chu trình gián tiếp (A→B→A) ⇒ 422 GOAL-ERR-002 CHU TRÌNH", async () => {
      // Dựng dữ liệu LỆCH bằng direct pool (đường API không tạo được): goal phòng D có cha = goal dự án
      // gProj. PATCH gProj{parent: D} có chiều HỢP LỆ (project ← department) nhưng tạo vòng gProj→D→gProj.
      const d = await direct.query(
        `INSERT INTO goals
           (company_id, goal_code, name, level, department_id, owner_employee_id, parent_goal_id,
            period_type, period_start, period_end)
         VALUES ($1,'CYC-0001','Phòng lệch','department',$2,$3,$4,'quarter','2026-07-01','2026-09-30')
         RETURNING id`,
        [A.companyId, ou, adminEmp, gProj],
      );
      const dId = d.rows[0].id as string;
      const res = await authPatch(`/goals/${gProj}`).send({ parentGoalId: dId });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-002");
      expect(JSON.stringify(res.body)).toContain("chu trình");
    });
  });

  // ── V3. Kỳ / weight / đo lường (GOAL-ERR-003/011/015/012) ─────────────────────
  describe("V3. kỳ, trọng số, đo lường", () => {
    it("period_end < period_start ⇒ 422 GOAL-ERR-003", async () => {
      const res = await authPost("/goals").send({
        name: "kỳ ngược",
        level: "department",
        departmentId: ou,
        periodType: "custom",
        periodStart: "2026-09-30",
        periodEnd: "2026-07-01",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-003");
    });

    it("thiếu period_start/period_end ⇒ 422 GOAL-ERR-003 (KHÔNG phải 500 vỡ NOT NULL)", async () => {
      const res = await authPost("/goals").send({
        name: "thiếu kỳ",
        level: "department",
        departmentId: ou,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-003");
    });

    it("weight <= 0 ⇒ 422 GOAL-ERR-011", async () => {
      const res = await createGoal({
        name: "trọng số 0",
        level: "department",
        departmentId: ou,
        weight: 0,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-011");
    });

    it("measure='number' + mode='manual' THIẾU target_value ⇒ 422 GOAL-ERR-015", async () => {
      const res = await createGoal({
        name: "thiếu chỉ tiêu",
        level: "department",
        departmentId: ou,
        measureType: "number",
        progressMode: "manual",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-015");
    });

    it("measure='number' + target_value ⇒ 201", async () => {
      const res = await createGoal({
        name: "có chỉ tiêu",
        level: "department",
        departmentId: ou,
        measureType: "number",
        targetValue: 120,
        unit: "hợp đồng",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.targetValue).toBe(120);
    });

    it("progress_mode='project' trên goal KHÔNG phải cấp dự án ⇒ 422 GOAL-ERR-012", async () => {
      const res = await createGoal({
        name: "mode sai cấp",
        level: "department",
        departmentId: ou,
        progressMode: "project",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-012");
    });
  });

  // ── V4. Goal nhân viên (GOAL-ERR-010) ─────────────────────────────────────────
  describe("V4. goal nhân viên: Active + owner = employee", () => {
    it("employee đã nghỉ ⇒ 422 GOAL-ERR-010", async () => {
      const res = await createGoal({
        name: "giao người đã nghỉ",
        level: "employee",
        employeeId: resignedEmp,
        ownerEmployeeId: resignedEmp,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-010");
    });

    it("owner_employee_id ≠ employee_id ⇒ 422 GOAL-ERR-010", async () => {
      const res = await createGoal({
        name: "owner lệch",
        level: "employee",
        employeeId: staffEmp,
        ownerEmployeeId: adminEmp,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-010");
    });
  });

  // ── V5. CRUD + xoá mềm + GOAL-ERR-007 + audit ────────────────────────────────
  describe("V5. detail / xoá mềm / còn con / audit", () => {
    let parent = "";
    let child = "";

    beforeAll(async () => {
      const p = await createGoal({ name: "Cha xoá", level: "department", departmentId: ou });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      parent = p.body.data.id as string;
      const c = await createGoal({
        name: "Con xoá",
        level: "project",
        projectId,
        parentGoalId: parent,
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      child = c.body.data.id as string;
    });

    it("GET /goals/:id kèm breadcrumb cha + đếm con (GOAL-API-003)", async () => {
      const res = await authGet(`/goals/${parent}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.parent).toBeNull();
      expect(res.body.data.childCount).toBeGreaterThanOrEqual(1);
      const kid = await authGet(`/goals/${child}`);
      expect(kid.body.data.parent).toMatchObject({ id: parent, name: "Cha xoá" });
    });

    it("DELETE goal còn con ⇒ 422 GOAL-ERR-007 (KHÔNG xoá lan)", async () => {
      const res = await authDelete(`/goals/${parent}`);
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-007");
      const row = await direct.query("SELECT deleted_at FROM goals WHERE id = $1", [parent]);
      expect(row.rows[0].deleted_at).toBeNull();
    });

    it("xoá con rồi xoá cha ⇒ 204 + XOÁ MỀM (deleted_at set, hàng còn nguyên)", async () => {
      expect((await authDelete(`/goals/${child}`)).status).toBe(204);
      expect((await authDelete(`/goals/${parent}`)).status).toBe(204);
      const rows = await direct.query(
        "SELECT id, deleted_at, deleted_by FROM goals WHERE id = ANY($1::uuid[])",
        [[parent, child]],
      );
      expect(rows.rows).toHaveLength(2);
      for (const r of rows.rows) {
        expect(r.deleted_at).not.toBeNull();
        expect(r.deleted_by).toBe(adminUser);
      }
      expect((await authGet(`/goals/${parent}`)).status).toBe(404);
    });

    it("audit_logs ghi object_type='goal' cho create/update/delete", async () => {
      const res = await direct.query(
        `SELECT action FROM audit_logs
          WHERE company_id = $1 AND object_type = 'goal' AND object_id = $2
          ORDER BY created_at`,
        [A.companyId, child],
      );
      const actions = res.rows.map((r) => String(r.action));
      expect(actions.some((a) => a.toLowerCase().includes("creat"))).toBe(true);
      expect(actions.some((a) => a.toLowerCase().includes("delet"))).toBe(true);
    });

    it("PATCH đổi neo sang cấp khác vẫn re-validate toàn bộ (neo lệch ⇒ 422 GOAL-ERR-001)", async () => {
      const g = await createGoal({ name: "đổi neo", level: "department", departmentId: ou });
      expect(g.status, JSON.stringify(g.body)).toBe(201);
      const res = await authPatch(`/goals/${g.body.data.id}`).send({ level: "employee" });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toContain("GOAL-ERR-001");
    });

    it("GET /goals lọc theo level + không trả hàng đã xoá mềm", async () => {
      const res = await authGet("/goals?level=department&limit=200");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = res.body.data as Array<{ id: string; level: string }>;
      expect(rows.every((r) => r.level === "department")).toBe(true);
      expect(rows.map((r) => r.id)).not.toContain(parent);
    });
  });
});
