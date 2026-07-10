/**
 * S4-TASK-BE-1 — Integration (Postgres THẬT, DB CÔ LẬP). Đường thật JwtAuthGuard → CompanyGuard →
 * PermissionGuard → ProjectsController → ProjectsService → DataScopeService + RLS withTenant. KHÔNG mock
 * permission — chứng minh điều unit KHÔNG chứng minh được: pair-gate seed 0485, DATA-SCOPE ĐỌC (Own/Team
 * EXISTS-join), cross-tenant 404 (không lộ tồn tại), member-rule (2 unique + user NULL + re-add),
 * lifecycle, OWNER-CHECK (gồm owner NULL fail-closed), block-new-task, append-only task_activity_logs.
 *
 * Gate CỨNG `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env → hasDb=true ⇒ đỏ-giả trên DB
 * dev chung; chỉ chạy trên DB cô lập lane (scripts/lane-db-setup.sh). Colocated src/tasks → vitest include.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../auth/password.service";
import { appPool, directPool, hasDb } from "../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../test/helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!test99";

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, scope: Scope];

// Cặp sensitive theo mig 0485 (b) — KHÔNG lật catalog dùng chung.
const SENSITIVE = new Set(["delete", "close", "archive", "manage-member", "view-report"]);

describe.skipIf(!runDb)("S4-TASK-BE-1 projects surface (DB cô lập, đường thật)", () => {
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
  let adminEmp = "";
  let mgrEmp = "";
  let empEmp = "";
  // member targets
  let addUser = "";
  let addEmp = "";
  let resignedEmp = "";
  let noAccountEmp = "";
  // read fixtures
  let projAdmin = "";
  let projMgr = "";
  let projShared = "";
  let projNoMember = "";
  // Tenant B
  let bAdminUser = "";
  let bProject = "";

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

  async function grant(
    companyId: string,
    userId: string,
    label: string,
    pairs: Pair[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `proj-${label}-${userId.slice(0, 8)}`);
    for (const [action, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, "project", SENSITIVE.has(action));
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function grantTask(companyId: string, userId: string): Promise<void> {
    const roleId = await seedRole(direct, companyId, `projtask-${userId.slice(0, 8)}`);
    for (const action of ["read", "create"]) {
      const permId = await seedPermissionCatalog(direct, action, "task", false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
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

  async function createProject(token: string, name: string): Promise<string> {
    const res = await authPost(token, "/projects").send({ name });
    expect(res.status, `create ${name}: ${JSON.stringify(res.body)}`).toBe(201);
    return res.body.data.id as string;
  }

  async function ids(token: string): Promise<string[]> {
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
    A = await seedCompany(direct, "taskbe1a");
    B = await seedCompany(direct, "taskbe1b");
    companyIds.push(A.companyId, B.companyId);

    const ouEng = await seedOrgUnit(A.companyId, "Engineering");
    const ouSales = await seedOrgUnit(A.companyId, "Sales");

    adminUser = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
    mgrUser = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
    empUser = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, hash);
    hrUser = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
    ghostUser = await seedUser(direct, A.companyId, `ghost@${A.slug}.test`, hash);
    addUser = await seedUser(direct, A.companyId, `add@${A.slug}.test`, hash);
    const resignedUser = await seedUser(direct, A.companyId, `resigned@${A.slug}.test`, hash);

    adminEmp = await seedEmp(A.companyId, adminUser, ouEng, null);
    mgrEmp = await seedEmp(A.companyId, mgrUser, ouEng, null);
    empEmp = await seedEmp(A.companyId, empUser, ouEng, mgrUser); // report of mgr → mgr Team
    await seedEmp(A.companyId, hrUser, ouEng, null);
    await seedEmp(A.companyId, ghostUser, ouSales, null); // ghost has an emp, but no create owner? see note
    addEmp = await seedEmp(A.companyId, addUser, ouSales, null);
    resignedEmp = await seedEmp(A.companyId, resignedUser, ouSales, null, "resigned");
    noAccountEmp = await seedEmp(A.companyId, null, ouSales, null); // employee KHÔNG có user account

    // Grants (custom roles = ma trận 0485 intent, tránh 2FA/company-admin + pollution role hệ thống).
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
    // hr: read/create/update/view-report @Company — KHÔNG close/delete/manage-member (deny-path).
    await grant(A.companyId, hrUser, "hr", [
      ["read", "Company"],
      ["create", "Company"],
      ["update", "Company"],
      ["view-report", "Company"],
    ]);
    // ghost: create @Company nhưng dùng để test creator-KHÔNG-mapping → gỡ employee của ghost.
    await grant(A.companyId, ghostUser, "ghost", [
      ["read", "Company"],
      ["create", "Company"],
      ["close", "Company"],
    ]);
    await direct.query("DELETE FROM employee_profiles WHERE user_id = $1", [ghostUser]);

    // Read fixtures (tạo qua API = đường thật, owner-member auto).
    const adminToken = await login(A.slug, `admin@${A.slug}.test`);
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    projAdmin = await createProject(adminToken, "Proj Admin");
    projMgr = await createProject(mgrToken, "Proj Mgr");
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

    // Tenant B
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
    bProject = await createProject(bToken, "B Project");
  });

  afterAll(async () => {
    if (direct && companyIds.length) {
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

  // ── DENY-PATH (RED) ────────────────────────────────────────────────────────
  it("employee thiếu create:project → POST 403", async () => {
    const t = await login(A.slug, `emp@${A.slug}.test`);
    const res = await authPost(t, "/projects").send({ name: "nope" });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("employee thiếu update/close/delete/manage-member → 403 mỗi route", async () => {
    const t = await login(A.slug, `emp@${A.slug}.test`);
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
  });

  it("hr KHÔNG có pair close/delete/manage-member (0485) → 403 (KHÔNG phải owner-check)", async () => {
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
  });

  // ── CROSS-TENANT (RED) — 404, không lộ tồn tại ───────────────────────────────
  it("thao tác project của tenant khác → 404 (không lộ tồn tại)", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    expect((await authGet(t, `/projects/${bProject}`)).status).toBe(404);
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

  // ── DATA-SCOPE TRONG-TENANT (RED) ────────────────────────────────────────────
  it("employee @Own CHỈ thấy project mình là ACTIVE member", async () => {
    const t = await login(A.slug, `emp@${A.slug}.test`);
    const seen = await ids(t);
    expect(seen).toContain(projShared);
    expect(seen).not.toContain(projAdmin);
    expect(seen).not.toContain(projMgr);
    expect(seen).not.toContain(projNoMember);
    // detail + members ngoài scope → 404 nhất quán
    expect((await authGet(t, `/projects/${projAdmin}`)).status).toBe(404);
    expect((await authGet(t, `/projects/${projAdmin}/members`)).status).toBe(404);
    expect((await authGet(t, `/projects/${projShared}`)).status).toBe(200);
    expect((await authGet(t, `/projects/${projShared}/members`)).status).toBe(200);
  });

  it("manager @Team thấy project có member thuộc team-tree, KHÔNG thấy ngoài team", async () => {
    const t = await login(A.slug, `mgr@${A.slug}.test`);
    const seen = await ids(t);
    expect(seen).toContain(projMgr); // self owner
    expect(seen).toContain(projShared); // empEmp thuộc team
    expect(seen).not.toContain(projAdmin); // adminEmp ngoài team
    expect(seen).not.toContain(projNoMember);
  });

  it("admin @Company thấy TẤT (gồm project không có member)", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const seen = await ids(t);
    for (const p of [projAdmin, projMgr, projShared, projNoMember]) expect(seen).toContain(p);
  });

  // ── CREATOR=OWNER ────────────────────────────────────────────────────────────
  it("creator có employee mapping → owner-member (user_id=actor, employee_id=actor) + owner_employee_id", async () => {
    const detail = await authGet(
      await login(A.slug, `admin@${A.slug}.test`),
      `/projects/${projAdmin}`,
    );
    expect(detail.body.data.ownerEmployeeId).toBe(adminEmp);
    const r = await direct.query(
      "SELECT user_id, employee_id, member_status FROM project_members WHERE project_id=$1 AND project_role='Owner' AND deleted_at IS NULL",
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
      "SELECT count(*)::int AS n, max(created_by::text) AS cb FROM project_members WHERE project_id=$1",
      [projNoMember],
    );
    expect(r.rows[0].n).toBe(0);
    const p = await direct.query("SELECT created_by FROM projects WHERE id=$1", [projNoMember]);
    expect(p.rows[0].created_by).toBe(ghostUser);
  });

  // ── MEMBER RULE ──────────────────────────────────────────────────────────────
  it("thêm employee resigned → 400; employee KHÔNG có account → 400 fail-loud", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const p = await createProject(t, "Proj Member Rule");
    const r1 = await authPost(t, `/projects/${p}/members`).send({
      employeeId: resignedEmp,
      projectRole: "Member",
    });
    expect(r1.status, JSON.stringify(r1.body)).toBe(400);
    const r2 = await authPost(t, `/projects/${p}/members`).send({
      employeeId: noAccountEmp,
      projectRole: "Member",
    });
    expect(r2.status, JSON.stringify(r2.body)).toBe(400);
    expect(JSON.stringify(r2.body)).toContain("NO-ACCOUNT");
  });

  it("trùng member ACTIVE → 409 (đo trên cả 2 unique); soft-remove rồi re-add thành công", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const p = await createProject(t, "Proj Dedup");
    const first = await authPost(t, `/projects/${p}/members`).send({
      employeeId: addEmp,
      projectRole: "Member",
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const memberId = first.body.data.id as string;
    const dup = await authPost(t, `/projects/${p}/members`).send({
      employeeId: addEmp,
      projectRole: "Member",
    });
    expect(dup.status, JSON.stringify(dup.body)).toBe(409);
    // soft-remove
    expect((await authDelete(t, `/projects/${p}/members/${memberId}`)).status).toBe(204);
    const gone = await direct.query(
      "SELECT deleted_at, member_status FROM project_members WHERE id=$1",
      [memberId],
    );
    expect(gone.rows[0].deleted_at).not.toBeNull();
    expect(gone.rows[0].member_status).toBe("Removed");
    // re-add hợp lệ (partial unique bỏ hàng deleted)
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
    expect(owner).toBeTruthy();
    const res = await authDelete(t, `/projects/${projMgr}/members/${owner!.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
  });

  it("PATCH member role đổi project_role hợp lệ", async () => {
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
  it("close → project_status Completed + closedAt/By; DELETE → biến khỏi list", async () => {
    const t = await login(A.slug, `admin@${A.slug}.test`);
    const p = await createProject(t, "Proj Lifecycle");
    const closed = await authPost(t, `/projects/${p}/close`).send({ note: "done" });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.data.status).toBe("Completed");
    expect(closed.body.data.closedAt).not.toBeNull();

    const del = await createProject(t, "Proj Delete");
    expect((await authDelete(t, `/projects/${del}`)).status).toBe(204);
    const soft = await direct.query("SELECT deleted_at FROM projects WHERE id=$1", [del]);
    expect(soft.rows[0].deleted_at).not.toBeNull();
    expect(await ids(t)).not.toContain(del);
  });

  it("createHubTask: project Completed → 400 block; project Active → 201 không bị chặn", async () => {
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
    // admin-owned project (owner=adminEmp) → mgr KHÔNG phải owner
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
    // mgr-owned project → owner_employee_id = mgrEmp → mgr là owner → close OK
    const pMgrOwned = await createProject(mgrToken, "Proj Owner Mgr");
    const detail = await authGet(mgrToken, `/projects/${pMgrOwned}`);
    expect(detail.body.data.ownerEmployeeId).toBe(mgrEmp);
    expect((await authPost(mgrToken, `/projects/${pMgrOwned}/close`).send({})).status).toBe(200);
  });

  it("owner_employee_id NULL → manager @Team 403 FAIL-CLOSED (nhánh NULL riêng)", async () => {
    const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
    // projNoMember do ghost tạo → owner_employee_id NULL
    const res = await authPost(mgrToken, `/projects/${projNoMember}/close`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain("OWNER-REQUIRED");
  });

  // ── APPEND-ONLY + AUDIT ──────────────────────────────────────────────────────
  it("task_activity_logs được APPEND đúng action + audit_logs objectType=project", async () => {
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

  it("app-role KHÔNG UPDATE/DELETE được task_activity_logs (ledger append-only)", async () => {
    const row = await direct.query(
      "SELECT id FROM task_activity_logs WHERE company_id=$1 LIMIT 1",
      [A.companyId],
    );
    const id = row.rows[0]?.id as string;
    expect(id, "cần ≥1 hàng activity để chứng minh ledger").toBeTruthy();
    await expect(
      appConn.query("UPDATE task_activity_logs SET message='tamper' WHERE id=$1", [id]),
    ).rejects.toThrow();
    await expect(
      appConn.query("DELETE FROM task_activity_logs WHERE id=$1", [id]),
    ).rejects.toThrow();
  });
});
