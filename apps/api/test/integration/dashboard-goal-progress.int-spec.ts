/**
 * S5-GOAL-DASH-1 — widget dashboard "Mục tiêu kỳ này" (SPEC-10 §7 + §13, SPEC-07 DASH).
 * widget_code=GOAL_PROGRESS, slug=goal-progress, module nguồn GOAL (mig 0525).
 *
 * RÀNG BUỘC WORK ORDER: số trên widget PHẢI khớp GET /goals/tree (MỘT công thức, MỘT con số — handler
 * TÁI DÙNG GoalsService.getTree, KHÔNG viết lại công thức SPEC-10 §13). Test này ĐỐI CHIẾU widget vs
 * /goals/tree trực tiếp, KHÔNG chỉ so sánh với giá trị hard-code.
 *
 * BẪY ĐÃ BIẾT (memory reused-method-must-be-actor-scoped): tái dùng read-service PHẢI verify actor-scope,
 * KHÔNG chỉ company_id — suite này seed 2 phòng ban + actor Department-scope để khoá scope containment.
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-lane-db-gate) — chỉ chạy trên DB cô lập lane.
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
const LOGIN_PW = "Passw0rd!goaldash1";

type Scope = "Own" | "Team" | "Department" | "Company";

describe.skipIf(!hasLaneDb)("S5-GOAL-DASH-1 — GOAL_PROGRESS widget (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let ouSales = "";
  let ouMkt = "";
  let caUser = "";
  let mgrUser = "";
  let denyUser = "";
  let mgrEmp = "";
  let gDeptSales = "";
  let gDeptMkt = "";
  let tCa = "";
  let tMgr = "";
  let tDeny = "";

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
    orgUnitId: string,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
      [companyId, userId, orgUnitId],
    );
    return r.rows[0].id as string;
  }

  async function seedGoal(
    companyId: string,
    v: { code: string; name: string; departmentId: string; ownerEmployeeId: string },
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO goals
       (company_id, goal_code, name, level, department_id, owner_employee_id,
        period_type, period_start, period_end, status)
     VALUES ($1,$2,$3,'department',$4,$5,'custom',
             (now() - interval '10 days')::date, (now() + interval '10 days')::date, 'Active')
     RETURNING id`,
      [companyId, v.code, v.name, v.departmentId, v.ownerEmployeeId],
    );
    return r.rows[0].id as string;
  }

  async function grantPairs(
    companyId: string,
    userId: string,
    label: string,
    pairs: Array<[string, string, Scope]>,
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `dash-goal-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "gdash1a");
    B = await seedCompany(direct, "gdash1b");
    companyIds.push(A.companyId, B.companyId);
    await seedGoalCounter(A.companyId);
    await seedGoalCounter(B.companyId);

    ouSales = await seedOrgUnit(A.companyId, "Kinh doanh GDASH1");
    ouMkt = await seedOrgUnit(A.companyId, "Marketing GDASH1");

    const mk = (name: string) => seedUser(direct, A.companyId, `${name}@${A.slug}.test`, hash);
    caUser = await mk("ca");
    mgrUser = await mk("mgr");
    denyUser = await mk("deny");

    mgrEmp = await seedEmp(A.companyId, mgrUser, ouSales);
    const mktEmp = await seedEmp(A.companyId, await mk("mktowner"), ouMkt);
    await seedEmp(A.companyId, denyUser, ouSales);

    // CA: Company scope (view:goal + access:goal + read:dashboard).
    await grantPairs(A.companyId, caUser, "ca", [
      ["access", "goal", "Company"],
      ["view", "goal", "Company"],
      ["read", "dashboard", "Company"],
    ]);
    // Mgr: Department scope (trưởng phòng Kinh doanh) — CHỈ thấy phòng mình.
    await grantPairs(A.companyId, mgrUser, "mgr", [
      ["access", "goal", "Own"],
      ["view", "goal", "Department"],
      ["read", "dashboard", "Company"],
    ]);
    // Deny: có read:dashboard (qua controller gate) nhưng KHÔNG có view:goal → handler phải 403.
    await grantPairs(A.companyId, denyUser, "deny", [["read", "dashboard", "Company"]]);

    tCa = await login(A.slug, `ca@${A.slug}.test`);
    tMgr = await login(A.slug, `mgr@${A.slug}.test`);
    tDeny = await login(A.slug, `deny@${A.slug}.test`);

    gDeptSales = await seedGoal(A.companyId, {
      code: "GDASH-0001",
      name: "Mục tiêu phòng Kinh doanh",
      departmentId: ouSales,
      ownerEmployeeId: mgrEmp,
    });
    gDeptMkt = await seedGoal(A.companyId, {
      code: "GDASH-0002",
      name: "Mục tiêu phòng Marketing",
      departmentId: ouMkt,
      ownerEmployeeId: mktEmp,
    });
  }, 120_000);

  afterAll(async () => {
    await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])", [
      companyIds,
    ]);
    await direct.query("DELETE FROM goal_updates WHERE company_id = ANY($1::uuid[])", [companyIds]);
    await direct.query("DELETE FROM goals WHERE company_id = ANY($1::uuid[])", [companyIds]);
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── RED — deny-path: có read:dashboard nhưng KHÔNG view:goal ⇒ 403 fail-closed (KHÔNG Degraded 200) ──
  it("deny: /dashboard/widgets/goal-progress không có view:goal ⇒ 403", async () => {
    const res = await authGet(tDeny, "/dashboard/widgets/goal-progress");
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  // ── contract: widget PHẢI khớp /goals/tree (MỘT công thức, MỘT con số — SPEC-10 §13) ────────────────
  it("CA (Company scope): widget goal-progress khớp progressPercent của /goals/tree cho MỖI phòng", async () => {
    const treeRes = await authGet(tCa, "/goals/tree");
    expect(treeRes.status, JSON.stringify(treeRes.body)).toBe(200);
    type Node = {
      id: string;
      level: string;
      departmentId: string | null;
      progressPercent: number | null;
    };
    const deptNodesFromTree = (treeRes.body.data as Node[]).filter((n) => n.level === "department");
    expect(deptNodesFromTree.map((n) => n.id).sort()).toEqual([gDeptMkt, gDeptSales].sort());

    const widgetRes = await authGet(tCa, "/dashboard/widgets/goal-progress");
    expect(widgetRes.status, JSON.stringify(widgetRes.body)).toBe(200);
    const items = widgetRes.body.data.data.items as Array<{
      goalId: string;
      progressPercent: number | null;
    }>;
    expect(items.length).toBe(deptNodesFromTree.length);
    for (const treeNode of deptNodesFromTree) {
      const widgetItem = items.find((i) => i.goalId === treeNode.id);
      expect(widgetItem, `widget thiếu goalId=${treeNode.id} có trong /goals/tree`).toBeDefined();
      expect(widgetItem!.progressPercent).toBe(treeNode.progressPercent);
    }
  });

  // ── actor-scope containment: Mgr (Department scope) chỉ thấy goal phòng MÌNH, KHÔNG phòng khác ─────
  it("Mgr (Department scope): widget CHỈ chứa goal phòng Kinh doanh, KHÔNG chứa goal phòng Marketing", async () => {
    const res = await authGet(tMgr, "/dashboard/widgets/goal-progress");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.data.data.items as Array<{
      goalId: string;
      departmentId: string | null;
    }>;
    const goalIds = items.map((i) => i.goalId);
    expect(goalIds).toContain(gDeptSales);
    expect(goalIds).not.toContain(gDeptMkt);
    const flat = JSON.stringify(res.body.data);
    expect(flat).not.toContain("Marketing GDASH1");
  });

  // ── cross-tenant: company B không có goal nào ⇒ Empty, KHÔNG lộ dữ liệu A ────────────────────────────
  it("cross-tenant: company B chưa có goal ⇒ widget Empty, KHÔNG lộ marker công ty A", async () => {
    const hash = await new PasswordService().hash(LOGIN_PW);
    const bUser = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
    await grantPairs(B.companyId, bUser, "b", [
      ["access", "goal", "Company"],
      ["view", "goal", "Company"],
      ["read", "dashboard", "Company"],
    ]);
    const tB = await login(B.slug, `admin@${B.slug}.test`);
    const res = await authGet(tB, "/dashboard/widgets/goal-progress");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // status "Empty" ⇒ data.data = null (DashboardWidgetDataService), số liệu KHÔNG lộ ở empty_state.
    expect(res.body.data.status).toBe("Empty");
    expect(res.body.data.data).toBeNull();
    const flat = JSON.stringify(res.body.data);
    expect(flat).not.toContain(gDeptSales);
    expect(flat).not.toContain(gDeptMkt);
    expect(flat).not.toContain("Kinh doanh GDASH1");
  });
});
