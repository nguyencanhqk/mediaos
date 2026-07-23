/**
 * S5-GOAL-BE-1 — deny-path phạm vi dữ liệu GOAL (SPEC-10 §11/§18/§20.2 · GOAL-API-001..006/013).
 * Đường THẬT: JwtAuthGuard → PermissionGuard → GoalsController → GoalsService (data-scope service-layer)
 * → GoalsRepository (withTenant + company_id) → RLS/FORCE. KHÔNG mock permission.
 *
 * QUY ƯỚC MÃ LỖI CỦA GOAL (KHÁC TASK — đọc kỹ trước khi "sửa cho giống"):
 *   • trong CÙNG tenant nhưng NGOÀI phạm vi actor  ⇒ 403 (minh bạch in-tenant: goal có tồn tại);
 *   • CHÉO tenant (kể cả actor có scope Company)   ⇒ 404 (không bao giờ lộ tồn tại);
 *   • mọi id tham chiếu client gửi lên (parent/department/project/employee) thuộc company khác ⇒ 404
 *     (finding MEDIUM gate S5-GOAL-DB-1: FK ĐƠN CỘT không ép cùng-tenant).
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate) — chỉ chạy trên DB cô lập lane.
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
const LOGIN_PW = "Passw0rd!goal1";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

const PERIOD = {
  periodType: "quarter" as const,
  periodStart: "2026-07-01",
  periodEnd: "2026-09-30",
};

describe.skipIf(!hasLaneDb)(
  "S5-GOAL-BE-1 data-scope + cross-tenant (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    // org units
    let ouSales = "";
    let ouMkt = "";
    let ouRnd = ""; // phòng THỨ BA — không phải phòng mgr, cũng không phải phòng của goal được giao
    // users
    let caUser = "";
    let mgrUser = "";
    let e1User = "";
    let e2User = "";
    let outUser = ""; // nhân viên phòng KHÁC (Marketing) + Owner dự án Sales
    let memUser = ""; // Member (không Owner/Manager) của dự án Sales
    let strictUser = ""; // view@Own — regression "Own không thấy mục tiêu cấp phòng"
    // employees
    let mgrEmp = "";
    let e1Emp = "";
    let e2Emp = "";
    let outEmp = "";
    let memEmp = "";
    let strictEmp = "";
    // tokens
    let tCa = "";
    let tMgr = "";
    let tE1 = "";
    let tE2 = "";
    let tOut = "";
    let tMem = "";
    let tStrict = "";
    // fixtures A
    let projectSales = "";
    let projectMkt = ""; // dự án của phòng KHÁC — mgr KHÔNG phải thành viên
    let gDeptSales = "";
    let gDeptMkt = "";
    let gMktOwnedByMgr = ""; // goal phòng Marketing nhưng mgr ĐƯỢC GIAO phụ trách
    let gFinalized = ""; // goal đã chốt kỳ (finalized_at) — GOAL-ERR-005
    let gEmp2 = "";
    let gEmp1 = "";
    // fixtures B (tenant khác)
    let bOrgUnit = "";
    let bEmp = "";
    let bProject = "";
    let gB = "";

    /**
     * Counter `goal` cho company dựng trong test — migration 0506 chỉ seed cho company TỒN TẠI lúc chạy
     * migration. WO chốt: KHÔNG ensure-on-miss trong service (fail-loud), nên fixture phải seed như 0506.
     */
    async function seedGoalCounter(companyId: string): Promise<void> {
      await direct.query(
        `INSERT INTO sequence_counters
         (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
          reset_policy, increment_by, current_value, status)
       VALUES ($1,'GOAL','goal','Company','GOAL-',4,'Never',1,0,'Active')
       ON CONFLICT DO NOTHING`,
        [companyId],
      );
    }

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
      status = "active",
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
       VALUES ($1,$2,$3,$4) RETURNING id`,
        [companyId, userId, orgUnitId, status],
      );
      return r.rows[0].id as string;
    }

    async function grantPairs(
      companyId: string,
      userId: string,
      label: string,
      pairs: PairGrant[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `goal-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource, scope] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resource, false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    /** Goal seed TRỰC TIẾP (bypass service) — dựng lưới đọc/ghi, không phụ thuộc đường API. */
    async function seedGoal(
      companyId: string,
      v: {
        code: string;
        name: string;
        level: string;
        departmentId?: string | null;
        projectId?: string | null;
        employeeId?: string | null;
        ownerEmployeeId: string;
        parentGoalId?: string | null;
      },
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO goals
         (company_id, goal_code, name, level, department_id, project_id, employee_id,
          owner_employee_id, parent_goal_id, period_type, period_start, period_end, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'quarter','2026-07-01','2026-09-30','Active')
       RETURNING id`,
        [
          companyId,
          v.code,
          v.name,
          v.level,
          v.departmentId ?? null,
          v.projectId ?? null,
          v.employeeId ?? null,
          v.ownerEmployeeId,
          v.parentGoalId ?? null,
        ],
      );
      return r.rows[0].id as string;
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

    const GOAL_ALL: PairGrant[] = [
      ["access", "goal", "Company"],
      ["view", "goal", "Company"],
      ["create", "goal", "Company"],
      ["update", "goal", "Company"],
      ["delete", "goal", "Company"],
    ];
    const GOAL_DEPT: PairGrant[] = [
      ["access", "goal", "Own"],
      ["view", "goal", "Department"],
      ["create", "goal", "Department"],
      ["update", "goal", "Department"],
      ["delete", "goal", "Department"],
    ];
    const GOAL_OWN: PairGrant[] = [
      ["access", "goal", "Own"],
      ["view", "goal", "Department"],
      ["create", "goal", "Own"],
      ["update", "goal", "Own"],
      ["delete", "goal", "Own"],
    ];
    /** view@Own (HẸP hơn ma trận seed 0506) — khoá regression "Own KHÔNG thấy mục tiêu cấp phòng". */
    const GOAL_OWN_STRICT: PairGrant[] = [
      ["access", "goal", "Own"],
      ["view", "goal", "Own"],
      ["create", "goal", "Own"],
      ["update", "goal", "Own"],
    ];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "goal1a");
      B = await seedCompany(direct, "goal1b");
      companyIds.push(A.companyId, B.companyId);
      await seedGoalCounter(A.companyId);
      await seedGoalCounter(B.companyId);

      ouSales = await seedOrgUnit(A.companyId, "Kinh doanh");
      ouMkt = await seedOrgUnit(A.companyId, "Marketing");
      ouRnd = await seedOrgUnit(A.companyId, "Nghiên cứu");

      const mk = (name: string) => seedUser(direct, A.companyId, `${name}@${A.slug}.test`, hash);
      caUser = await mk("ca");
      mgrUser = await mk("mgr");
      e1User = await mk("e1");
      e2User = await mk("e2");
      outUser = await mk("out");
      memUser = await mk("mem");
      strictUser = await mk("strict");

      // CA cần hồ sơ nhân sự để đi qua resolve employee (id không dùng lại trong assert).
      await seedEmp(A.companyId, caUser, ouSales);
      mgrEmp = await seedEmp(A.companyId, mgrUser, ouSales);
      e1Emp = await seedEmp(A.companyId, e1User, ouSales);
      e2Emp = await seedEmp(A.companyId, e2User, ouSales);
      outEmp = await seedEmp(A.companyId, outUser, ouMkt);
      memEmp = await seedEmp(A.companyId, memUser, ouMkt);
      strictEmp = await seedEmp(A.companyId, strictUser, ouSales);

      await grantPairs(A.companyId, caUser, "ca", GOAL_ALL);
      await grantPairs(A.companyId, mgrUser, "mgr", GOAL_DEPT);
      await grantPairs(A.companyId, e1User, "e1", GOAL_OWN);
      await grantPairs(A.companyId, e2User, "e2", GOAL_OWN);
      await grantPairs(A.companyId, outUser, "out", GOAL_OWN);
      await grantPairs(A.companyId, memUser, "mem", GOAL_OWN);
      await grantPairs(A.companyId, strictUser, "strict", GOAL_OWN_STRICT);

      tCa = await login(A.slug, `ca@${A.slug}.test`);
      tMgr = await login(A.slug, `mgr@${A.slug}.test`);
      tE1 = await login(A.slug, `e1@${A.slug}.test`);
      tE2 = await login(A.slug, `e2@${A.slug}.test`);
      tOut = await login(A.slug, `out@${A.slug}.test`);
      tMem = await login(A.slug, `mem@${A.slug}.test`);
      tStrict = await login(A.slug, `strict@${A.slug}.test`);

      // Dự án phòng Kinh doanh; chủ dự án `out` LÀ NGƯỜI PHÒNG KHÁC (Marketing) — chứng minh bypass
      // ProjectAccessService hoạt động độc lập với phòng ban.
      const pr = await direct.query(
        `INSERT INTO projects (company_id, name, status, department_id, owner_employee_id)
       VALUES ($1,'Dự án Sales','active',$2,$3) RETURNING id`,
        [A.companyId, ouSales, outEmp],
      );
      projectSales = pr.rows[0].id as string;
      await direct.query(
        `INSERT INTO project_members (company_id, project_id, user_id, employee_id, project_role, member_status)
       VALUES ($1,$2,$3,$4,'Owner','Active'), ($1,$2,$5,$6,'Member','Active')`,
        [A.companyId, projectSales, outUser, outEmp, memUser, memEmp],
      );

      // Dự án của phòng Marketing — mgr (trưởng phòng Kinh doanh) KHÔNG có vai trò dự án nào ở đây.
      const prMkt = await direct.query(
        `INSERT INTO projects (company_id, name, status, department_id, owner_employee_id)
       VALUES ($1,'Dự án Marketing','active',$2,$3) RETURNING id`,
        [A.companyId, ouMkt, outEmp],
      );
      projectMkt = prMkt.rows[0].id as string;

      gDeptSales = await seedGoal(A.companyId, {
        code: "SEED-0001",
        name: "Mục tiêu phòng Kinh doanh",
        level: "department",
        departmentId: ouSales,
        ownerEmployeeId: mgrEmp,
      });
      gDeptMkt = await seedGoal(A.companyId, {
        code: "SEED-0002",
        name: "Mục tiêu phòng Marketing",
        level: "department",
        departmentId: ouMkt,
        ownerEmployeeId: outEmp,
      });
      gEmp2 = await seedGoal(A.companyId, {
        code: "SEED-0003",
        name: "Mục tiêu của E2",
        level: "employee",
        employeeId: e2Emp,
        ownerEmployeeId: e2Emp,
      });
      gEmp1 = await seedGoal(A.companyId, {
        code: "SEED-0004",
        name: "Mục tiêu của E1",
        level: "employee",
        employeeId: e1Emp,
        ownerEmployeeId: e1Emp,
      });

      // Mgr ĐƯỢC GIAO phụ trách một mục tiêu của phòng KHÁC (kịch bản hợp lệ: giám đốc giao chéo phòng).
      gMktOwnedByMgr = await seedGoal(A.companyId, {
        code: "SEED-0005",
        name: "Mục tiêu phòng Marketing (mgr phụ trách)",
        level: "department",
        departmentId: ouMkt,
        ownerEmployeeId: mgrEmp,
      });
      // Goal ĐÃ CHỐT KỲ — BE-1 không có writer cho finalized_at nên set thẳng bằng direct pool.
      gFinalized = await seedGoal(A.companyId, {
        code: "SEED-0006",
        name: "Mục tiêu đã chốt kỳ",
        level: "department",
        departmentId: ouSales,
        ownerEmployeeId: mgrEmp,
      });
      await direct.query("UPDATE goals SET finalized_at = now(), finalized_by = $2 WHERE id = $1", [
        gFinalized,
        mgrUser,
      ]);

      // Tenant B
      const bUser = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
      bOrgUnit = await seedOrgUnit(B.companyId, "Phòng B");
      bEmp = await seedEmp(B.companyId, bUser, bOrgUnit);
      const prB = await direct.query(
        `INSERT INTO projects (company_id, name, status, department_id, owner_employee_id)
       VALUES ($1,'Dự án B','active',$2,$3) RETURNING id`,
        [B.companyId, bOrgUnit, bEmp],
      );
      bProject = prB.rows[0].id as string;
      gB = await seedGoal(B.companyId, {
        code: "SEED-B001",
        name: "Mục tiêu công ty B",
        level: "department",
        departmentId: bOrgUnit,
        ownerEmployeeId: bEmp,
      });
    }, 120_000);

    afterAll(async () => {
      await direct.query("DELETE FROM goal_updates WHERE company_id = ANY($1::uuid[])", [
        companyIds,
      ]);
      await direct.query("DELETE FROM goals WHERE company_id = ANY($1::uuid[])", [companyIds]);
      await direct.query("DELETE FROM project_members WHERE company_id = ANY($1::uuid[])", [
        companyIds,
      ]);
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app.close();
    });

    // ── S1. Nhân viên KHÔNG đụng được mục tiêu người khác (403 — không phải 404) ─────
    describe("S1. own-scope: nhân viên chỉ ghi mục tiêu của chính mình", () => {
      it("E1 PATCH mục tiêu của E2 ⇒ 403", async () => {
        const res = await authPatch(tE1, `/goals/${gEmp2}`).send({ name: "cướp mục tiêu" });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("E1 DELETE mục tiêu của E2 ⇒ 403 (và hàng KHÔNG bị xoá mềm)", async () => {
        const res = await authDelete(tE1, `/goals/${gEmp2}`);
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        const row = await direct.query("SELECT deleted_at FROM goals WHERE id = $1", [gEmp2]);
        expect(row.rows[0].deleted_at).toBeNull();
      });

      it("E1 PATCH mục tiêu CỦA MÌNH ⇒ 200", async () => {
        const res = await authPatch(tE1, `/goals/${gEmp1}`).send({ name: "Mục tiêu của E1 (sửa)" });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.name).toBe("Mục tiêu của E1 (sửa)");
      });

      it("E1 GET mục tiêu phòng CỦA MÌNH ⇒ 200 (minh bạch trong phòng)", async () => {
        const res = await authGet(tE1, `/goals/${gDeptSales}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });
    });

    // ── S2. Department-scope: phòng khác ⇒ 403 ─────────────────────────────────────
    describe("S2. department-scope đọc", () => {
      it("E1 GET mục tiêu phòng KHÁC ⇒ 403", async () => {
        const res = await authGet(tE1, `/goals/${gDeptMkt}`);
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("GET /goals của E1 KHÔNG chứa mục tiêu phòng khác", async () => {
        const res = await authGet(tE1, "/goals?limit=200");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const ids = (res.body.data as Array<{ id: string }>).map((g) => g.id);
        expect(ids).toContain(gDeptSales);
        expect(ids).not.toContain(gDeptMkt);
      });

      it("Trưởng phòng (Department) sửa được mục tiêu nhân viên trong phòng ⇒ 200", async () => {
        const res = await authPatch(tMgr, `/goals/${gEmp2}`).send({ status: "Active" });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });

      it("Trưởng phòng Kinh doanh sửa mục tiêu phòng Marketing ⇒ 403", async () => {
        const res = await authPatch(tMgr, `/goals/${gDeptMkt}`).send({ name: "sửa bậy" });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("Trưởng phòng Kinh doanh XOÁ mục tiêu phòng Marketing ⇒ 403 (hàng còn nguyên)", async () => {
        const res = await authDelete(tMgr, `/goals/${gDeptMkt}`);
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        const row = await direct.query("SELECT deleted_at FROM goals WHERE id = $1", [gDeptMkt]);
        expect(row.rows[0].deleted_at).toBeNull();
      });
    });

    /**
     * S2b. LEO QUYỀN GHI CHÉO PHÒNG qua "người phụ trách mặc định" — finding HIGH-1 của FULL gate
     * (2026-07-23). `ownerEmployeeId` vắng ⇒ validator suy về CHÍNH ACTOR, nên vế "actor là người phụ
     * trách" TỰ THOẢ trên đường CREATE: trước khi vá, 4 ca đầu trả 201/200/204 thay vì 403 —
     * create:goal@Department ≈ @Company. Nhóm S2 cũ chỉ phủ UPDATE (owner là NGƯỜI KHÁC nên vô tình
     * né đúng lỗ này) ⇒ giữ nguyên nhóm này khi refactor luật ghi.
     */
    describe("S2b. deny-path GHI chéo phòng (leo quyền qua owner mặc định)", () => {
      it("Mgr TẠO mục tiêu cấp phòng cho phòng KHÁC ⇒ 403", async () => {
        const res = await authPost(tMgr, "/goals").send({
          name: "Mục tiêu cắm sang phòng Marketing",
          level: "department",
          departmentId: ouMkt,
          ...PERIOD,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("Mgr TẠO mục tiêu cấp dự án cho dự án phòng KHÁC (không có vai trò dự án) ⇒ 403", async () => {
        const res = await authPost(tMgr, "/goals").send({
          name: "Mục tiêu cắm vào dự án Marketing",
          level: "project",
          projectId: projectMkt,
          ...PERIOD,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("Mgr TẠO mục tiêu cho nhân viên phòng KHÁC ⇒ 403", async () => {
        const res = await authPost(tMgr, "/goals").send({
          name: "Mục tiêu áp cho NV phòng Marketing",
          level: "employee",
          employeeId: outEmp,
          ...PERIOD,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("Mgr KHÔNG mượn được quyền owner để tạo: khai ownerEmployeeId = chính mình vẫn 403", async () => {
        const res = await authPost(tMgr, "/goals").send({
          name: "Mục tiêu phòng khác nhưng tôi phụ trách",
          level: "department",
          departmentId: ouMkt,
          ownerEmployeeId: mgrEmp,
          ...PERIOD,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      // ── control: chống vá quá tay (luồng hợp lệ PHẢI còn sống) ──────────────────
      it("control — Mgr tạo mục tiêu cho phòng MÌNH ⇒ 201", async () => {
        const res = await authPost(tMgr, "/goals").send({
          name: "Mục tiêu phòng Kinh doanh (mgr tạo)",
          level: "department",
          departmentId: ouSales,
          ...PERIOD,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
      });

      it("control — Mgr tạo mục tiêu CÁ NHÂN của chính mình ⇒ 201", async () => {
        const res = await authPost(tMgr, "/goals").send({
          name: "Mục tiêu cá nhân của mgr",
          level: "employee",
          employeeId: mgrEmp,
          ...PERIOD,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
      });

      it("control — Mgr SỬA được mục tiêu phòng khác mà mình ĐƯỢC GIAO phụ trách ⇒ 200", async () => {
        const res = await authPatch(tMgr, `/goals/${gMktOwnedByMgr}`).send({
          name: "Mục tiêu phòng Marketing (mgr sửa)",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });

      it("nhưng KHÔNG được dùng quyền owner để DI DỜI neo sang phòng thứ ba ⇒ 403", async () => {
        const res = await authPatch(tMgr, `/goals/${gMktOwnedByMgr}`).send({
          departmentId: ouRnd,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        const row = await direct.query("SELECT department_id FROM goals WHERE id = $1", [
          gMktOwnedByMgr,
        ]);
        expect(row.rows[0].department_id).toBe(ouMkt);
      });
    });

    // ── S2c. GOAL-ERR-005 — goal đã chốt kỳ thì đóng băng (SPEC-10 §12/§15) ────────
    describe("S2c. goal đã chốt kỳ ⇒ cấm sửa/xoá", () => {
      it("PATCH goal đã chốt ⇒ 422 GOAL-ERR-005", async () => {
        const res = await authPatch(tCa, `/goals/${gFinalized}`).send({ name: "sửa sau chốt" });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(JSON.stringify(res.body)).toContain("GOAL-ERR-005");
      });

      it("DELETE goal đã chốt ⇒ 422 GOAL-ERR-005 (hàng còn nguyên)", async () => {
        const res = await authDelete(tCa, `/goals/${gFinalized}`);
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(JSON.stringify(res.body)).toContain("GOAL-ERR-005");
        const row = await direct.query("SELECT deleted_at FROM goals WHERE id = $1", [gFinalized]);
        expect(row.rows[0].deleted_at).toBeNull();
      });
    });

    // ── S3. Cross-tenant ⇒ 404 (kể cả scope Company) ───────────────────────────────
    describe("S3. cross-tenant 404 — không lộ tồn tại", () => {
      it("admin @Company GET/PATCH/DELETE goal của công ty khác ⇒ 404", async () => {
        expect((await authGet(tCa, `/goals/${gB}`)).status).toBe(404);
        expect((await authPatch(tCa, `/goals/${gB}`).send({ name: "x" })).status).toBe(404);
        expect((await authDelete(tCa, `/goals/${gB}`)).status).toBe(404);
      });

      it("POST /goals với department_id của công ty khác ⇒ 404", async () => {
        const res = await authPost(tCa, "/goals").send({
          name: "neo chéo tenant",
          level: "department",
          departmentId: bOrgUnit,
          ...PERIOD,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(404);
      });

      it("POST /goals với project_id / employee_id của công ty khác ⇒ 404", async () => {
        const r1 = await authPost(tCa, "/goals").send({
          name: "dự án chéo tenant",
          level: "project",
          projectId: bProject,
          ...PERIOD,
        });
        expect(r1.status, JSON.stringify(r1.body)).toBe(404);
        const r2 = await authPost(tCa, "/goals").send({
          name: "nhân viên chéo tenant",
          level: "employee",
          employeeId: bEmp,
          ownerEmployeeId: bEmp,
          ...PERIOD,
        });
        expect(r2.status, JSON.stringify(r2.body)).toBe(404);
      });

      it("POST /goals với parent_goal_id của công ty khác ⇒ 404", async () => {
        const res = await authPost(tCa, "/goals").send({
          name: "cha chéo tenant",
          level: "department",
          departmentId: ouSales,
          parentGoalId: gB,
          ...PERIOD,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(404);
      });

      it("PATCH goal nội bộ trỏ parent sang công ty khác ⇒ 404", async () => {
        const res = await authPatch(tCa, `/goals/${gEmp1}`).send({ parentGoalId: gB });
        expect(res.status, JSON.stringify(res.body)).toBe(404);
      });

      /**
       * Đường PATCH của TỪNG neo — trước đây chỉ phủ `parentGoalId`. FK đơn cột KHÔNG ép cùng-tenant
       * (đo ở tầng DB: `INSERT goals(employee_id = <emp công ty B>)` THÀNH CÔNG với role app) ⇒ lớp
       * resolve dưới company_id ở service là hàng phòng thủ DUY NHẤT. Mỗi neo phải có ca riêng, kẻo
       * gỡ nhầm một nhánh resolve mà suite vẫn xanh.
       */
      it("PATCH đổi department_id / project_id / employee_id sang công ty khác ⇒ 404", async () => {
        const r1 = await authPatch(tCa, `/goals/${gDeptSales}`).send({ departmentId: bOrgUnit });
        expect(r1.status, JSON.stringify(r1.body)).toBe(404);
        const r2 = await authPatch(tCa, `/goals/${gDeptSales}`).send({
          level: "project",
          departmentId: null,
          projectId: bProject,
        });
        expect(r2.status, JSON.stringify(r2.body)).toBe(404);
        const r3 = await authPatch(tCa, `/goals/${gEmp1}`).send({ employeeId: bEmp });
        expect(r3.status, JSON.stringify(r3.body)).toBe(404);
      });

      it("owner_employee_id của công ty khác ⇒ 404 (POST và PATCH, ĐƠN LẺ)", async () => {
        // ĐƠN LẺ = không kèm employeeId chéo tenant, để 404 chắc chắn đến từ nhánh resolve OWNER
        // (ca cũ gửi cả hai ⇒ nổ ở resolveEmployee trước, nhánh owner không được kiểm thật).
        const post = await authPost(tCa, "/goals").send({
          name: "owner chéo tenant",
          level: "department",
          departmentId: ouSales,
          ownerEmployeeId: bEmp,
          ...PERIOD,
        });
        expect(post.status, JSON.stringify(post.body)).toBe(404);
        const patch = await authPatch(tCa, `/goals/${gDeptSales}`).send({ ownerEmployeeId: bEmp });
        expect(patch.status, JSON.stringify(patch.body)).toBe(404);
      });

      it("KHÔNG hàng nào của A trỏ sang thực thể của B sau loạt thử trên", async () => {
        const r = await direct.query(
          `SELECT count(*)::int AS n FROM goals g
             WHERE g.company_id = $1
               AND (g.department_id = $2 OR g.project_id = $3
                    OR g.employee_id = $4 OR g.owner_employee_id = $4 OR g.parent_goal_id = $5)`,
          [A.companyId, bOrgUnit, bProject, bEmp, gB],
        );
        expect(r.rows[0].n).toBe(0);
      });
    });

    // ── S4. /me/goals — resolve từ token, chống IDOR (SPEC-09 §14.4) ────────────────
    describe("S4. GET /me/goals own-scope resolve từ token", () => {
      it("E1 bơm employeeId của E2 vào query ⇒ vẫn CHỈ trả mục tiêu của E1", async () => {
        const res = await authGet(tE1, `/me/goals?employeeId=${e2Emp}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const rows = res.body.data as Array<{ id: string; employeeId: string | null }>;
        expect(rows.map((g) => g.id)).toContain(gEmp1);
        expect(rows.map((g) => g.id)).not.toContain(gEmp2);
        for (const g of rows) expect(g.employeeId === null || g.employeeId === e1Emp).toBe(true);
      });

      it("E2 gọi /me/goals ⇒ chỉ mục tiêu của E2", async () => {
        const res = await authGet(tE2, "/me/goals");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const ids = (res.body.data as Array<{ id: string }>).map((g) => g.id);
        expect(ids).toContain(gEmp2);
        expect(ids).not.toContain(gEmp1);
      });
    });

    // ── S5. Goal cấp dự án: quyền ghi qua ProjectAccessService (SPEC-10 §11 ghi chú) ─
    describe("S5. goal cấp dự án — Owner/Manager dự án ghi được kể cả khác phòng", () => {
      let gProject = "";

      it("Owner dự án (phòng Marketing) tạo goal cho dự án phòng Kinh doanh ⇒ 201", async () => {
        const res = await authPost(tOut, "/goals").send({
          name: "Mục tiêu dự án Sales",
          level: "project",
          projectId: projectSales,
          ...PERIOD,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        gProject = res.body.data.id as string;
        expect(res.body.data.goalCode).toMatch(/^GOAL-\d{4}$/);
      });

      it("Member (không Owner/Manager) tạo goal dự án đó ⇒ 403", async () => {
        const res = await authPost(tMem, "/goals").send({
          name: "member tạo",
          level: "project",
          projectId: projectSales,
          ...PERIOD,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("Nhân viên NGOÀI dự án (@Own) tạo goal dự án ⇒ 403", async () => {
        const res = await authPost(tE1, "/goals").send({
          name: "người ngoài tạo",
          level: "project",
          projectId: projectSales,
          ...PERIOD,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("Nhân viên @Own tạo goal cấp phòng ⇒ 403 (own chỉ được goal cá nhân)", async () => {
        const res = await authPost(tE1, "/goals").send({
          name: "nhân viên tạo goal phòng",
          level: "department",
          departmentId: ouSales,
          ...PERIOD,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("Nhân viên @Own tạo goal CÁ NHÂN của mình ⇒ 201; của người khác ⇒ 403", async () => {
        const ok = await authPost(tE1, "/goals").send({
          name: "Mục tiêu cá nhân E1",
          level: "employee",
          employeeId: e1Emp,
          ...PERIOD,
        });
        expect(ok.status, JSON.stringify(ok.body)).toBe(201);
        const deny = await authPost(tE1, "/goals").send({
          name: "gán cho E2",
          level: "employee",
          employeeId: e2Emp,
          ownerEmployeeId: e2Emp,
          ...PERIOD,
        });
        expect(deny.status, JSON.stringify(deny.body)).toBe(403);
      });

      it("Member dự án ĐỌC được goal dự án (minh bạch) ⇒ 200", async () => {
        const res = await authGet(tMem, `/goals/${gProject}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });

      it("Trưởng phòng SỞ HỮU dự án (không phải member) vẫn sửa được goal dự án của phòng mình ⇒ 200", async () => {
        // SPEC-10 §11: 'Trưởng đơn vị: department (cả 3 cấp trong phòng)'. Dự án Sales thuộc phòng
        // Kinh doanh ⇒ mgr@Department ghi được dù KHÔNG là thành viên dự án.
        const res = await authPatch(tMgr, `/goals/${gProject}`).send({ status: "Active" });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });

      it("Member dự án SỬA goal dự án ⇒ 403", async () => {
        const res = await authPatch(tMem, `/goals/${gProject}`).send({ name: "member sửa" });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });
    });

    // ── S5c. Gắn cha chỉ trong tầm NHÌN của actor ────────────────────────────────
    describe("S5c. parentGoalId phải nằm trong phạm vi ĐỌC của actor", () => {
      it("E1 treo mục tiêu cá nhân dưới mục tiêu PHÒNG MÌNH ⇒ 201", async () => {
        const res = await authPost(tE1, "/goals").send({
          name: "Mục tiêu E1 dưới goal phòng",
          level: "employee",
          employeeId: e1Emp,
          parentGoalId: gDeptSales,
          ...PERIOD,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
      });

      it("E1 treo mục tiêu cá nhân dưới mục tiêu PHÒNG KHÁC ⇒ 403", async () => {
        const res = await authPost(tE1, "/goals").send({
          name: "Mục tiêu E1 treo sang phòng khác",
          level: "employee",
          employeeId: e1Emp,
          parentGoalId: gDeptMkt,
          ...PERIOD,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("PATCH đổi cha sang mục tiêu phòng khác ⇒ 403", async () => {
        const res = await authPatch(tE1, `/goals/${gEmp1}`).send({ parentGoalId: gDeptMkt });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });
    });

    // ── S5b. Regression: view@Own KHÔNG mở cửa mục tiêu cấp phòng ────────────────
    describe("S5b. scope Own hẹp: chỉ mục tiêu của chính mình", () => {
      it("view@Own KHÔNG thấy mục tiêu cấp phòng của chính phòng mình (list + detail 403)", async () => {
        const list = await authGet(tStrict, "/goals?limit=200");
        expect(list.status, JSON.stringify(list.body)).toBe(200);
        const ids = (list.body.data as Array<{ id: string }>).map((g) => g.id);
        expect(ids).not.toContain(gDeptSales);
        expect(ids).not.toContain(gEmp1);
        const detail = await authGet(tStrict, `/goals/${gDeptSales}`);
        expect(detail.status, JSON.stringify(detail.body)).toBe(403);
      });

      it("view@Own THẤY mục tiêu của chính mình", async () => {
        const created = await authPost(tStrict, "/goals").send({
          name: "Mục tiêu riêng của strict",
          level: "employee",
          employeeId: strictEmp,
          ...PERIOD,
        });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        const list = await authGet(tStrict, "/goals?limit=200");
        expect((list.body.data as Array<{ id: string }>).map((g) => g.id)).toContain(
          created.body.data.id,
        );
      });
    });

    // ── S6. Cây mục tiêu (GOAL-API-006) ───────────────────────────────────────────
    describe("S6. GET /goals/tree — ≤3 tầng, progress NULL giữ nguyên", () => {
      it("cây lồng department → project|employee, progressPercent null KHÔNG bị suy 0%", async () => {
        const child = await authPost(tCa, "/goals").send({
          name: "Mục tiêu con của phòng",
          level: "employee",
          employeeId: e1Emp,
          ownerEmployeeId: e1Emp,
          parentGoalId: gDeptSales,
          ...PERIOD,
        });
        expect(child.status, JSON.stringify(child.body)).toBe(201);

        const res = await authGet(tCa, "/goals/tree");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        type Node = { id: string; progressPercent: number | null; children: Node[] };
        const roots = res.body.data as Node[];
        const dept = roots.find((n) => n.id === gDeptSales);
        expect(dept, "goal phòng phải là nút gốc của cây").toBeDefined();
        expect(dept!.children.map((c) => c.id)).toContain(child.body.data.id);
        expect(dept!.progressPercent).toBeNull();

        const depth = (n: Node): number =>
          n.children.length === 0 ? 1 : 1 + Math.max(...n.children.map(depth));
        expect(Math.max(...roots.map(depth))).toBeLessThanOrEqual(3);
      });

      it("cây của E1 KHÔNG chứa nút phòng khác (scope áp cả trên tree)", async () => {
        const res = await authGet(tE1, "/goals/tree");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const flat = JSON.stringify(res.body.data);
        expect(flat).not.toContain(gDeptMkt);
      });
    });
  },
);
