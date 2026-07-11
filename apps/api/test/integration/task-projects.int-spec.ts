/**
 * S4-TASK-BE-1 (L4) — Project + member surface integration (Postgres THẬT, DB CÔ LẬP).
 *
 * Đường THẬT: JwtAuthGuard → CompanyGuard → PermissionGuard → ProjectsController → ProjectsService →
 * DataScopeService + RLS withTenant. KHÔNG mock permission — chứng minh điều unit-test KHÔNG chứng minh
 * được:
 *   - pair-gate ĐÚNG seed 0485 (deny-path 403 mọi cặp thiếu quyền, gồm hr KHÔNG có close/delete/manage-member);
 *   - cross-tenant → 404 (không lộ tồn tại) — cả project-id LẪN memberId của tenant khác;
 *   - DATA-SCOPE ĐỌC trong-tenant: employee @Own chỉ project mình là member · manager @Team theo team-tree ·
 *     admin @Company thấy tất; GET /:id + /:id/members cùng scope với list;
 *   - member-rule: resolve employee→user_id fail-loud (user NULL → 400) · resigned/terminated/inactive chặn ·
 *     trùng Active 409 đo RIÊNG trên CẢ HAI unique (legacy user_id + mới employee_id) · re-add sau soft-remove ·
 *     chặn xoá Owner cuối cùng;
 *   - creator=Owner mapping (user_id + employee_id + owner_employee_id) · actor không employee → owner NULL;
 *   - OWNER-CHECK manager @Team (non-owner 403 · owner OK · owner_employee_id NULL → 403 fail-closed);
 *   - lifecycle close→Completed / delete→soft + biến khỏi list · block-new-task theo project_status MỚI;
 *   - append-only task_activity_logs (app-role KHÔNG UPDATE/DELETE) + audit_logs objectType='project';
 *   - list pagination (limit clamp) + filter (status/owner/search).
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate): .env trỏ DATABASE_URL vào DB dev
 * chung ⇒ hasDb=true nhưng migration band lệch ⇒ đỏ-giả. CHỈ chạy trên DB cô lập lane (scripts/lane-db-setup.sh
 * <lane> + export LANE_DB=mediaos_<lane>). KHÔNG dùng biểu thức ngược !hasDb && LANE_DB (false-green).
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

// GATE ĐÚNG LOGIC: chỉ chạy khi CÓ DB thật VÀ đang trỏ LANE_DB cô lập.
const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = "Passw0rd!lane4x";

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, scope: Scope];

// Cặp sensitive theo 0485(b) — quyết định seedPermissionCatalog.is_sensitive để guard gate đúng.
const SENSITIVE = new Set(["delete", "close", "archive", "manage-member", "view-report"]);

describe.skipIf(!hasLaneDb)("S4-TASK-BE-1 projects+member surface (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let appConn: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  // Tenant A actors
  let adminUser = "";
  let mgrUser = "";
  let empUser = "";
  let hrUser = "";
  let ghostUser = "";
  let spareUser = "";
  let adminEmp = "";
  let mgrEmp = "";
  let empEmp = "";
  // member targets
  let addUser = "";
  let addEmp = "";
  let resignedEmp = "";
  let terminatedEmp = "";
  let inactiveEmp = "";
  let noAccountEmp = "";
  // read fixtures
  let projAdmin = "";
  let projMgr = "";
  let projShared = "";
  let projNoMember = "";
  // Tenant B
  let bAdminUser = "";
  let bProject = "";
  let bMemberId = "";

  // ── low-level seeding (direct pool = superuser, bypass RLS; company_id tường minh) ──
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
    status = "active",
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, direct_manager_id, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [companyId, userId, orgUnitId, directManagerUserId, status],
    );
    return r.rows[0].id as string;
  }

  // Cấp quyền qua ROLE tùy biến (company-scoped) = intent ma trận 0485 nhưng tránh 2FA/pollution role hệ thống
  // + cho phép set scope Own/Team/Company chính xác cho từng actor.
  async function grant(
    companyId: string,
    userId: string,
    label: string,
    pairs: Pair[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `p4-${label}-${userId.slice(0, 8)}`);
    for (const [action, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, "project", SENSITIVE.has(action));
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function grantTask(companyId: string, userId: string): Promise<void> {
    const roleId = await seedRole(direct, companyId, `p4task-${userId.slice(0, 8)}`);
    for (const action of ["read", "create"]) {
      const permId = await seedPermissionCatalog(direct, action, "task", false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────────
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

  async function createProject(token: string, name: string): Promise<string> {
    const res = await authPost(token, "/projects").send({ name });
    expect(res.status, `create ${name}: ${JSON.stringify(res.body)}`).toBe(201);
    return res.body.data.id as string;
  }

  async function listIds(token: string): Promise<string[]> {
    const res = await authGet(token, "/projects?limit=200");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body.data as Array<{ id: string }>).map((p) => p.id);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    appConn = appPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "tpb1a");
    B = await seedCompany(direct, "tpb1b");
    companyIds.push(A.companyId, B.companyId);

    const ouEng = await seedOrgUnit(A.companyId, "Engineering");
    const ouSales = await seedOrgUnit(A.companyId, "Sales");

    adminUser = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
    mgrUser = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
    empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
    hrUser = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
    ghostUser = await seedUser(direct, A.companyId, `ghost@${A.slug}.test`, hash);
    spareUser = await seedUser(direct, A.companyId, `spare@${A.slug}.test`, hash);
    addUser = await seedUser(direct, A.companyId, `add@${A.slug}.test`, hash);
    const resignedUser = await seedUser(direct, A.companyId, `resigned@${A.slug}.test`, hash);
    const terminatedUser = await seedUser(direct, A.companyId, `term@${A.slug}.test`, hash);
    const inactiveUser = await seedUser(direct, A.companyId, `inactive@${A.slug}.test`, hash);

    adminEmp = await seedEmp(A.companyId, adminUser, ouEng, null);
    mgrEmp = await seedEmp(A.companyId, mgrUser, ouEng, null);
    empEmp = await seedEmp(A.companyId, empUser, ouEng, mgrUser); // report of mgr → mgr @Team thấy
    await seedEmp(A.companyId, hrUser, ouEng, null);
    await seedEmp(A.companyId, ghostUser, ouSales, null); // sẽ xoá bên dưới để test creator-KHÔNG-mapping
    addEmp = await seedEmp(A.companyId, addUser, ouSales, null);
    resignedEmp = await seedEmp(A.companyId, resignedUser, ouSales, null, "resigned");
    terminatedEmp = await seedEmp(A.companyId, terminatedUser, ouSales, null, "terminated");
    inactiveEmp = await seedEmp(A.companyId, inactiveUser, ouSales, null, "inactive");
    noAccountEmp = await seedEmp(A.companyId, null, ouSales, null); // employee KHÔNG có user account

    // Grants theo intent 0485.
    await grant(A.companyId, adminUser, "admin", [
      ["read", "Company"],
      ["create", "Company"],
      ["update", "Company"],
      ["close", "Company"],
      ["delete", "Company"],
      ["manage-member", "Company"],
    ]);
    await grantTask(A.companyId, adminUser);
    await grant(A.companyId, mgrUser, "mgr", [
      ["read", "Team"],
      ["create", "Team"],
      ["update", "Team"],
      ["close", "Team"],
      ["delete", "Team"],
      ["manage-member", "Team"],
    ]);
    await grant(A.companyId, empUser, "emp", [["read", "Own"]]);
    // hr: read/create/update/view-report @Company — KHÔNG close/delete/manage-member (deny-path 0485).
    await grant(A.companyId, hrUser, "hr", [
      ["read", "Company"],
      ["create", "Company"],
      ["update", "Company"],
      ["view-report", "Company"],
    ]);
    // ghost: create @Company nhưng dùng cho nhánh creator-KHÔNG-mapping → gỡ employee của ghost.
    await grant(A.companyId, ghostUser, "ghost", [
      ["read", "Company"],
      ["create", "Company"],
    ]);
    await direct.query("DELETE FROM employee_profiles WHERE user_id = $1", [ghostUser]);

    // Read fixtures (tạo qua API = đường thật, owner-member auto).
    const adminToken = await login(A.slug, `admin@${A.slug}.test`);
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    projAdmin = await createProject(adminToken, "Proj Admin"); // owner=adminEmp
    projMgr = await createProject(mgrToken, "Proj Mgr"); // owner=mgrEmp
    projShared = await createProject(adminToken, "Proj Shared");
    // add empEmp vào projShared → empUser @Own thấy; mgr @Team thấy (empEmp thuộc team).
    const addRes = await authPost(adminToken, `/projects/${projShared}/members`).send({
      employeeId: empEmp,
      projectRole: "Member",
    });
    expect(addRes.status, JSON.stringify(addRes.body)).toBe(201);
    // ghost tạo project → owner_employee_id NULL, KHÔNG member.
    const ghostToken = await login(A.slug, `ghost@${A.slug}.test`);
    projNoMember = await createProject(ghostToken, "Proj No Member");

    // Tenant B (cross-tenant fixtures).
    bAdminUser = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
    await seedEmp(B.companyId, bAdminUser, null, null);
    await grant(B.companyId, bAdminUser, "badmin", [
      ["read", "Company"],
      ["create", "Company"],
      ["update", "Company"],
      ["close", "Company"],
      ["delete", "Company"],
      ["manage-member", "Company"],
    ]);
    const bToken = await login(B.slug, `admin@${B.slug}.test`);
    bProject = await createProject(bToken, "B Project"); // owner-member auto (bAdmin có employee)
    const bMem = await direct.query(
      "SELECT id FROM project_members WHERE project_id=$1 AND deleted_at IS NULL LIMIT 1",
      [bProject],
    );
    bMemberId = bMem.rows[0].id as string;
  });

  afterAll(async () => {
    if (direct && companyIds.length) {
      // cleanupTenants KHÔNG phủ task_activity_logs / project_members → xoá tường minh trước.
      await direct
        .query("DELETE FROM task_activity_logs WHERE company_id = ANY($1::uuid[])", [companyIds])
        .catch(() => undefined);
      await direct
        .query("DELETE FROM project_members WHERE company_id = ANY($1::uuid[])", [companyIds])
        .catch(() => undefined);
      await direct
        .query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
        .catch(() => undefined);
      await cleanupTenants(direct, companyIds);
    }
    await appConn?.end();
    await direct?.end();
    await app?.close();
  });

  // ── DENY-PATH (403) — pair thiếu quyền theo 0485 ────────────────────────────
  it("employee thiếu create:project → POST /projects 403", async () => {
    const t = await login(A.slug, `emp@${A.slug}.test`);
    const res = await authPost(t, "/projects").send({ name: "nope" });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("employee thiếu update/close/delete/manage-member:project → 403 mỗi route", async () => {
    const t = await login(A.slug, `emp@${A.slug}.test`);
    // dùng projShared (employee @Own THẤY được) → 403 là do THIẾU pair, KHÔNG do scope/404.
    expect((await authPatch(t, `/projects/${projShared}`).send({ name: "x" })).status).toBe(403);
    expect((await authPost(t, `/projects/${projShared}/close`).send({})).status).toBe(403);
    expect((await authDelete(t, `/projects/${projShared}`)).status).toBe(403);
    expect(
      (
        await authPost(t, `/projects/${projShared}/members`).send({
          employeeId: addEmp,
          projectRole: "Member",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authPatch(t, `/projects/${projShared}/members/${bMemberId}`).send({
          projectRole: "Manager",
        })
      ).status,
    ).toBe(403);
    expect((await authDelete(t, `/projects/${projShared}/members/${bMemberId}`)).status).toBe(403);
  });

  it("hr KHÔNG có pair close/delete/manage-member (0485) → 403 (deny-path, KHÔNG phải owner-check)", async () => {
    const t = await login(A.slug, `hr@${A.slug}.test`);
    expect((await authPost(t, `/projects/${projAdmin}/close`).send({})).status).toBe(403);
    expect((await authDelete(t, `/projects/${projAdmin}`)).status).toBe(403);
    expect(
      (
        await authPost(t, `/projects/${projAdmin}/members`).send({
          employeeId: addEmp,
          projectRole: "Member",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authPatch(t, `/projects/${projAdmin}/members/${bMemberId}`).send({
          projectRole: "Manager",
        })
      ).status,
    ).toBe(403);
    expect((await authDelete(t, `/projects/${projAdmin}/members/${bMemberId}`)).status).toBe(403);
  });

  // ── CROSS-TENANT (404) — không lộ tồn tại ────────────────────────────────────
  it("thao tác project của tenant khác → 404 (project-id cross-tenant)", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    expect((await authGet(t, `/projects/${bProject}`)).status).toBe(404);
    expect((await authGet(t, `/projects/${bProject}/members`)).status).toBe(404);
    expect((await authPatch(t, `/projects/${bProject}`).send({ name: "x" })).status).toBe(404);
    expect((await authPost(t, `/projects/${bProject}/close`).send({})).status).toBe(404);
    expect((await authDelete(t, `/projects/${bProject}`)).status).toBe(404);
    expect(
      (
        await authPost(t, `/projects/${bProject}/members`).send({
          employeeId: addEmp,
          projectRole: "Member",
        })
      ).status,
    ).toBe(404);
  });

  it("member ops trỏ memberId của tenant khác → 404 (project A + memberId B, không lộ)", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    // project là A (admin có manage-member @Company nên qua guard), nhưng memberId thuộc tenant B.
    expect(
      (
        await authPatch(t, `/projects/${projAdmin}/members/${bMemberId}`).send({
          projectRole: "Manager",
        })
      ).status,
    ).toBe(404);
    expect((await authDelete(t, `/projects/${projAdmin}/members/${bMemberId}`)).status).toBe(404);
  });

  // ── DATA-SCOPE TRONG-TENANT (đọc) ────────────────────────────────────────────
  it("employee @Own CHỈ thấy project mình là ACTIVE member; ngoài scope → 404 nhất quán", async () => {
    const t = await login(A.slug, `emp@${A.slug}.test`);
    const seen = await listIds(t);
    expect(seen).toContain(projShared);
    expect(seen).not.toContain(projAdmin);
    expect(seen).not.toContain(projMgr);
    expect(seen).not.toContain(projNoMember);
    // detail + members ngoài scope → 404 (KHÔNG lộ danh sách member).
    expect((await authGet(t, `/projects/${projAdmin}`)).status).toBe(404);
    expect((await authGet(t, `/projects/${projAdmin}/members`)).status).toBe(404);
    // trong scope → 200.
    expect((await authGet(t, `/projects/${projShared}`)).status).toBe(200);
    expect((await authGet(t, `/projects/${projShared}/members`)).status).toBe(200);
  });

  it("manager @Team thấy project có member thuộc team-tree, KHÔNG thấy ngoài team", async () => {
    const t = await login(A.slug, `mgr@${A.slug}.test`);
    const seen = await listIds(t);
    expect(seen).toContain(projMgr); // self-owner (userId === mgr)
    expect(seen).toContain(projShared); // empEmp (direct_manager=mgr) là member
    expect(seen).not.toContain(projAdmin); // adminEmp ngoài team
    expect(seen).not.toContain(projNoMember);
    // parity list↔detail: ngoài team → 404, trong team → 200.
    expect((await authGet(t, `/projects/${projAdmin}`)).status).toBe(404);
    expect((await authGet(t, `/projects/${projShared}`)).status).toBe(200);
  });

  it("admin @Company thấy TẤT (gồm project không có member)", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const seen = await listIds(t);
    for (const p of [projAdmin, projMgr, projShared, projNoMember]) expect(seen).toContain(p);
  });

  // ── CREATOR = OWNER ──────────────────────────────────────────────────────────
  it("creator có employee mapping → owner-member (user_id+employee_id) + projects.owner_employee_id", async () => {
    const detail = await authGet(
      await login(A.slug, `admin@${A.slug}.test`),
      `/projects/${projAdmin}`,
    );
    expect(detail.body.data.ownerEmployeeId).toBe(adminEmp);
    const r = await direct.query(
      `SELECT user_id, employee_id, member_status FROM project_members
       WHERE project_id=$1 AND project_role='Owner' AND deleted_at IS NULL`,
      [projAdmin],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].user_id).toBe(adminUser);
    expect(r.rows[0].employee_id).toBe(adminEmp);
    expect(r.rows[0].member_status).toBe("Active");
  });

  it("creator KHÔNG có employee mapping → KHÔNG owner-member, owner_employee_id NULL, created_by set", async () => {
    const detail = await authGet(
      await login(A.slug, `admin@${A.slug}.test`),
      `/projects/${projNoMember}`,
    );
    expect(detail.body.data.ownerEmployeeId).toBeNull();
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM project_members WHERE project_id=$1 AND deleted_at IS NULL",
      [projNoMember],
    );
    expect(r.rows[0].n).toBe(0);
    const p = await direct.query("SELECT created_by, owner_employee_id FROM projects WHERE id=$1", [
      projNoMember,
    ]);
    expect(p.rows[0].created_by).toBe(ghostUser);
    expect(p.rows[0].owner_employee_id).toBeNull();
  });

  // ── MEMBER RULE ──────────────────────────────────────────────────────────────
  it("thêm employee resigned/terminated/inactive → 400 (nghỉ/chấm dứt bị chặn)", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const p = await createProject(t, "Proj Emp Status");
    for (const emp of [resignedEmp, terminatedEmp, inactiveEmp]) {
      const r = await authPost(t, `/projects/${p}/members`).send({
        employeeId: emp,
        projectRole: "Member",
      });
      expect(r.status, `emp ${emp}: ${JSON.stringify(r.body)}`).toBe(400);
    }
  });

  it("employee KHÔNG có user account (user_id NULL) → 400 fail-loud mã lỗi rõ", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const p = await createProject(t, "Proj No Account");
    const r = await authPost(t, `/projects/${p}/members`).send({
      employeeId: noAccountEmp,
      projectRole: "Member",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(JSON.stringify(r.body)).toContain("NO-ACCOUNT");
  });

  it("trùng member ACTIVE → 409 đo trên unique LEGACY user_id (nhánh riêng)", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const p = await createProject(t, "Proj Dup UserUq");
    // Seed thẳng 1 hàng NON-Active (member_status='Inactive', employee_id NULL) cùng user_id=addUser.
    // ⇒ unique MỚI (employee_id + Active) KHÔNG khớp; CHỈ guard legacy user_id có thể chặn.
    await direct.query(
      `INSERT INTO project_members (company_id, project_id, user_id, employee_id, member_status)
       VALUES ($1,$2,$3,NULL,'Inactive')`,
      [A.companyId, p, addUser],
    );
    const res = await authPost(t, `/projects/${p}/members`).send({
      employeeId: addEmp, // addEmp.user_id === addUser
      projectRole: "Member",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
  });

  it("trùng member ACTIVE → 409 đo trên unique MỚI employee_id (nhánh riêng)", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const p = await createProject(t, "Proj Dup EmpUq");
    // Seed thẳng 1 hàng ACTIVE với employee_id=addEmp NHƯNG user_id=spareUser (≠ addUser).
    // ⇒ guard legacy user_id (addUser) KHÔNG khớp; CHỈ guard MỚI employee_id có thể chặn.
    await direct.query(
      `INSERT INTO project_members (company_id, project_id, user_id, employee_id, member_status)
       VALUES ($1,$2,$3,$4,'Active')`,
      [A.companyId, p, spareUser, addEmp],
    );
    const res = await authPost(t, `/projects/${p}/members`).send({
      employeeId: addEmp,
      projectRole: "Member",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
  });

  it("soft-remove rồi re-add thành công (deleted_at đã set cho partial-unique)", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const p = await createProject(t, "Proj ReAdd");
    const first = await authPost(t, `/projects/${p}/members`).send({
      employeeId: addEmp,
      projectRole: "Member",
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const memberId = first.body.data.id as string;
    // trùng lúc còn Active → 409
    const dup = await authPost(t, `/projects/${p}/members`).send({
      employeeId: addEmp,
      projectRole: "Member",
    });
    expect(dup.status).toBe(409);
    // soft-remove
    expect((await authDelete(t, `/projects/${p}/members/${memberId}`)).status).toBe(204);
    const gone = await direct.query(
      "SELECT deleted_at, member_status FROM project_members WHERE id=$1",
      [memberId],
    );
    expect(gone.rows[0].deleted_at).not.toBeNull();
    expect(gone.rows[0].member_status).toBe("Removed");
    // re-add hợp lệ
    const readd = await authPost(t, `/projects/${p}/members`).send({
      employeeId: addEmp,
      projectRole: "Member",
    });
    expect(readd.status, JSON.stringify(readd.body)).toBe(201);
  });

  it("gỡ Owner cuối cùng → chặn (409)", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const members = await authGet(t, `/projects/${projMgr}/members`);
    const owner = (members.body.data as Array<{ id: string; projectRole: string }>).find(
      (m) => m.projectRole === "Owner",
    );
    expect(owner, "projMgr phải có 1 Owner").toBeTruthy();
    const res = await authDelete(t, `/projects/${projMgr}/members/${owner!.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
  });

  it("PATCH member role đổi project_role hợp lệ (trong CHECK)", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const p = await createProject(t, "Proj Role Change");
    const add = await authPost(t, `/projects/${p}/members`).send({
      employeeId: addEmp,
      projectRole: "Member",
    });
    expect(add.status).toBe(201);
    const res = await authPatch(t, `/projects/${p}/members/${add.body.data.id}`).send({
      projectRole: "Manager",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.projectRole).toBe("Manager");
  });

  // ── LIFECYCLE + BLOCK-NEW-TASK ───────────────────────────────────────────────
  it("close → project_status Completed + closedAt/By; DELETE → soft + biến khỏi list", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const p = await createProject(t, "Proj Lifecycle");
    const closed = await authPost(t, `/projects/${p}/close`).send({ note: "done" });
    // CLOSE contract = 200: action-verb POST mutate-and-return-resource (mirror PATCH + convention 15+ verb
    // POST: leave/att/profile-change approve·reject·cancel, api-keys revoke) ⇒ controller @HttpCode(200).
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.data.status).toBe("Completed");
    expect(closed.body.data.closedAt).not.toBeNull();
    const cl = await direct.query(
      "SELECT project_status, closed_at, closed_by FROM projects WHERE id=$1",
      [p],
    );
    expect(cl.rows[0].project_status).toBe("Completed");
    expect(cl.rows[0].closed_by).toBe(adminUser);

    const del = await createProject(t, "Proj Delete");
    expect((await authDelete(t, `/projects/${del}`)).status).toBe(204);
    const soft = await direct.query("SELECT deleted_at, deleted_by FROM projects WHERE id=$1", [
      del,
    ]);
    expect(soft.rows[0].deleted_at).not.toBeNull();
    expect(soft.rows[0].deleted_by).toBe(adminUser);
    expect(await listIds(t)).not.toContain(del);
  });

  it("createHubTask: project Active → 201; project Completed → 400 block-new-task (cột project_status MỚI)", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const active = await createProject(t, "Proj Task Active");
    const ok = await authPost(t, "/tasks").send({ title: "T-active", projectId: active });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);

    const done = await createProject(t, "Proj Task Done");
    await authPost(t, `/projects/${done}/close`).send({});
    const blocked = await authPost(t, "/tasks").send({ title: "T-blocked", projectId: done });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(400);
    expect(JSON.stringify(blocked.body)).toContain("đóng");
  });

  // ── OWNER-CHECK (manager @Team) ──────────────────────────────────────────────
  it("manager @Team KHÔNG phải owner → close/delete/manage-member 403; là owner → cho phép", async () => {
    const adminToken = await login(A.slug, `admin@${A.slug}.test`);
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    // admin-owned (owner=adminEmp) → mgr KHÔNG phải owner → 403 dù có pair @Team.
    const pAdminOwned = await createProject(adminToken, "Proj Owner Admin");
    expect((await authPost(mgrToken, `/projects/${pAdminOwned}/close`).send({})).status).toBe(403);
    expect((await authDelete(mgrToken, `/projects/${pAdminOwned}`)).status).toBe(403);
    expect(
      (
        await authPost(mgrToken, `/projects/${pAdminOwned}/members`).send({
          employeeId: addEmp,
          projectRole: "Member",
        })
      ).status,
    ).toBe(403);
    // mgr-owned → owner_employee_id = mgrEmp → mgr là owner → close OK.
    const pMgrOwned = await createProject(mgrToken, "Proj Owner Mgr");
    const detail = await authGet(mgrToken, `/projects/${pMgrOwned}`);
    expect(detail.body.data.ownerEmployeeId).toBe(mgrEmp);
    // owner-check PASS ⇒ close thành công (200 = contract @HttpCode, xem test lifecycle).
    expect((await authPost(mgrToken, `/projects/${pMgrOwned}/close`).send({})).status).toBe(200);
  });

  it("owner_employee_id NULL → manager @Team 403 FAIL-CLOSED (nhánh NULL riêng)", async () => {
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    // projNoMember do ghost (không employee) tạo → owner_employee_id NULL.
    // mgr @Team THẤY được không quan trọng; owner-check chạy trong service → OWNER-REQUIRED.
    const res = await authPost(mgrToken, `/projects/${projNoMember}/close`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain("OWNER-REQUIRED");
  });

  // ── OWNER-REASSIGN GOVERNANCE (bịt bypass owner-check qua PATCH đổi chủ) ──────
  it("manager @Team KHÔNG phải owner: PATCH đổi ownerEmployeeId=mình → 403 (bịt bypass), chủ KHÔNG đổi", async () => {
    const adminToken = await login(A.slug, `admin@${A.slug}.test`);
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    // admin-owned (owner=adminEmp). mgr có update:project@Team (write KHÔNG lọc scope) nhưng KHÔNG là chủ.
    const pAdminOwned = await createProject(adminToken, "Proj Reassign Guard");
    const res = await authPatch(mgrToken, `/projects/${pAdminOwned}`).send({
      ownerEmployeeId: mgrEmp,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    // Chủ KHÔNG bị đổi (bypass đã bịt) — nếu lọt, mgr sẽ hijack rồi close/delete project không phải của mình.
    const row = await direct.query("SELECT owner_employee_id FROM projects WHERE id=$1", [
      pAdminOwned,
    ]);
    expect(row.rows[0].owner_employee_id).toBe(adminEmp);
  });

  it("manager @Team LÀ chủ hiện tại: PATCH đổi ownerEmployeeId → 200 (governance cho phép)", async () => {
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    // mgr-owned (owner=mgrEmp) → mgr là chủ hiện tại → được reassign.
    const pMgrOwned = await createProject(mgrToken, "Proj Reassign SelfOwner");
    const res = await authPatch(mgrToken, `/projects/${pMgrOwned}`).send({
      ownerEmployeeId: addEmp,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await direct.query("SELECT owner_employee_id FROM projects WHERE id=$1", [
      pMgrOwned,
    ]);
    expect(row.rows[0].owner_employee_id).toBe(addEmp);
  });

  it("admin @Company: PATCH đổi ownerEmployeeId tự do (scope Company bỏ owner-check) → 200", async () => {
    const adminToken = await login(A.slug, `admin@${A.slug}.test`);
    const p = await createProject(adminToken, "Proj Reassign Admin");
    const res = await authPatch(adminToken, `/projects/${p}`).send({ ownerEmployeeId: mgrEmp });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await direct.query("SELECT owner_employee_id FROM projects WHERE id=$1", [p]);
    expect(row.rows[0].owner_employee_id).toBe(mgrEmp);
  });

  it("owner_employee_id NULL: manager @Team PATCH đổi chủ → 403 FAIL-CLOSED (không thể chiếm project vô chủ)", async () => {
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    // projNoMember do ghost (không employee) tạo → owner_employee_id NULL. reassign bị chặn (blocked ⇒ KHÔNG đổi).
    const res = await authPatch(mgrToken, `/projects/${projNoMember}`).send({
      ownerEmployeeId: mgrEmp,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const row = await direct.query("SELECT owner_employee_id FROM projects WHERE id=$1", [
      projNoMember,
    ]);
    expect(row.rows[0].owner_employee_id).toBeNull();
  });

  // ── APPEND-ONLY LEDGER + AUDIT ───────────────────────────────────────────────
  it("task_activity_logs APPEND đúng action + audit_logs objectType='project'", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const p = await createProject(t, "Proj Activity");
    await authPatch(t, `/projects/${p}`).send({ description: "d" });
    const add = await authPost(t, `/projects/${p}/members`).send({
      employeeId: addEmp,
      projectRole: "Member",
    });
    await authDelete(t, `/projects/${p}/members/${add.body.data.id}`);

    const acts = await direct.query("SELECT action FROM task_activity_logs WHERE project_id=$1", [
      p,
    ]);
    const actions = new Set((acts.rows as Array<{ action: string }>).map((r) => r.action));
    for (const a of ["PROJECT_CREATED", "PROJECT_UPDATED", "MEMBER_ADDED", "MEMBER_REMOVED"]) {
      expect(actions.has(a), `activity ${a}`).toBe(true);
    }
    const aud = await direct.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE object_type='project' AND object_id=$1",
      [p],
    );
    expect(aud.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("app-role (mediaos_app) KHÔNG UPDATE/DELETE được task_activity_logs — ledger append-only #2", async () => {
    const row = await direct.query(
      "SELECT id FROM task_activity_logs WHERE company_id=$1 LIMIT 1",
      [A.companyId],
    );
    const id = row.rows[0]?.id as string;
    expect(id, "cần ≥1 hàng activity để chứng minh ledger").toBeTruthy();
    // Qua KẾT NỐI APP-ROLE (mediaos_app) — GRANT chỉ SELECT,INSERT ⇒ UPDATE/DELETE = permission denied.
    await expect(
      appConn.query("UPDATE task_activity_logs SET message='tamper' WHERE id=$1", [id]),
    ).rejects.toThrow();
    await expect(
      appConn.query("DELETE FROM task_activity_logs WHERE id=$1", [id]),
    ).rejects.toThrow();
  });

  // ── LIST pagination + filter ─────────────────────────────────────────────────
  it("list: limit clamp + filter status/owner/search", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    // limit=1 → đúng 1 hàng.
    const lim = await authGet(t, "/projects?limit=1");
    expect(lim.status).toBe(200);
    expect((lim.body.data as unknown[]).length).toBe(1);
    // filter status=Active: mọi hàng trả về đều Active.
    const act = await authGet(t, "/projects?status=Active&limit=200");
    expect(act.status).toBe(200);
    for (const p of act.body.data as Array<{ status: string }>) expect(p.status).toBe("Active");
    // filter ownerEmployeeId=mgrEmp: chỉ project mgr-owned.
    const owned = await authGet(t, `/projects?ownerEmployeeId=${mgrEmp}&limit=200`);
    expect(owned.status).toBe(200);
    for (const p of owned.body.data as Array<{ ownerEmployeeId: string | null }>) {
      expect(p.ownerEmployeeId).toBe(mgrEmp);
    }
    // search theo tên duy nhất.
    const s = await authGet(t, "/projects?search=Proj%20Admin&limit=200");
    expect(s.status).toBe(200);
    expect((s.body.data as Array<{ id: string }>).map((p) => p.id)).toContain(projAdmin);
  });
});
