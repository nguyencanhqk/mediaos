/**
 * S5-TASK-PROJROLE-1 (đợt C — DECISIONS-04 D-23..D-28) — quyền per-project qua project_role.
 * Đường THẬT: JwtAuthGuard → PermissionGuard → controller → service → ProjectAccessService +
 * buildReadScopeExists(mode) + RLS withTenant. KHÔNG mock permission.
 *
 * Phủ testTasks của docs/plans/S5-TASK-PROJROLE-1.md:
 *   G1 govern-re-anchor  — Owner-member (≠ owner_employee_id) govern ĐƯỢC (đổi hành vi chủ đích);
 *                          Manager-member/mgr@Team-non-member 403 NOT-OWNER; 0 Owner ⇒ OWNER-REQUIRED.
 *   G2 viewer-hole       — Viewer/Member KHÔNG sửa task người khác trong project (404); nhánh
 *                          assignee sống (M sửa task của M); Manager sửa được (role-cap 'write').
 *   G3 collab-cap        — per-OPERATION trên CÙNG task: Viewer ĐỌC được comment/checklist nhưng
 *                          KHÔNG ghi; Member ghi được.
 *   G4 watch-không-cap   — Viewer watch ĐƯỢC (mode 'read') nhưng mutate 404 (call-site thứ 3).
 *   G5 create-scope      — D-27: Own không projectId ⇒ assignee bắt buộc = trong scope; projectId ⇒
 *                          Owner/Manager member; assignee phải member; Company giữ hành vi cũ.
 *   G6 update-project    — role-layer field thường (Owner/Manager) + đổi chủ (Owner) + sync member
 *                          Owner cùng tx + OWNER_NO_ACCOUNT.
 *   G7 states-role-layer — D-28 (dormant với seed thật — dựng role tuỳ biến @Team).
 *   G8 myProjectRole     — detail/list đúng 4 role + null; chống-lặp actor 2 hàng member;
 *                          NULL=Member (legacy user_id-only): read/collab OK, write 404.
 *   G9 backfill 0501     — chạy lại SQL: INSERT owner thiếu member / UPDATE nâng role / SKIP
 *                          account-less; idempotent.
 *   G10 cross-tenant     — mọi đường mới 404, không lộ tồn tại.
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate) — chỉ chạy trên DB cô lập lane.
 */

import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
const LOGIN_PW = "Passw0rd!lane5c";

type Scope = "Own" | "Team" | "Department" | "Company";
/** [action, resource, scope, sensitive] — sensitive khớp catalog 0485 (ON CONFLICT giữ giá trị thật). */
type PairGrant = [action: string, resource: string, scope: Scope, sensitive?: boolean];

describe.skipIf(!hasLaneDb)("S5-TASK-PROJROLE-1 per-project role (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  // users
  let caUser = "";
  let oUser = ""; // Owner-member ≠ owner_employee_id
  let cUser = ""; // Manager-member (govern deny)
  let dUser = ""; // org mgr @Team KHÔNG member
  let vUser = ""; // Viewer member
  let mUser = ""; // Member member
  let gUser = ""; // Manager member (task-write + states + dup-row)
  let eUser = ""; // employee thường KHÔNG member (create-scope)
  let lUser = ""; // legacy member user_id-only (role NULL)
  let rUser = ""; // read:project@Company KHÔNG member (myProjectRole null)
  let sUser = ""; // create:project_state@Team KHÔNG member
  let xUser = ""; // assignee của T_X
  // employees
  let caEmp = "";
  let oEmp = "";
  let cEmp = "";
  let vEmp = "";
  let mEmp = "";
  let gEmp = "";
  let eEmp = "";
  let xEmp = "";
  let spareEmp = "";
  let wNewEmp = ""; // target đổi chủ (có account, chưa member)
  let noAccEmp = ""; // employee KHÔNG account
  // tokens
  let tCa = "";
  let tO = "";
  let tC = "";
  let tD = "";
  let tV = "";
  let tM = "";
  let tG = "";
  let tE = "";
  let tL = "";
  let tR = "";
  let tS = "";
  // fixtures
  let P1 = "";
  let P0 = ""; // 0 Owner-member, owner_employee_id set
  let PClose = "";
  let TX = ""; // task giao cho X trong P1
  let TM = ""; // task giao cho M trong P1
  // tenant B
  let PB = "";
  let TB = "";

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

  async function grantPairs(
    companyId: string,
    userId: string,
    label: string,
    pairs: PairGrant[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `pjr-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope, sensitive] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, sensitive ?? false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function seedTask(
    companyId: string,
    projectId: string | null,
    title: string,
    assigneeEmp: string | null,
    assigneeUser: string | null,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO tasks
         (company_id, task_type, title, task_status, main_assignee_employee_id, assignee_user_id, creator_user_id, project_id)
       VALUES ($1,'office',$2,'Todo',$3,$4,$5,$6) RETURNING id`,
      [companyId, title, assigneeEmp, assigneeUser, caUser, projectId],
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

  /** Member qua đường thật (đường API đã có deny-path riêng ở task-projects.int-spec). */
  async function addMember(projectId: string, employeeId: string, role: string): Promise<void> {
    const res = await authPost(tCa, `/projects/${projectId}/members`).send({
      employeeId,
      projectRole: role,
    });
    expect(res.status, `addMember ${role}: ${JSON.stringify(res.body)}`).toBe(201);
  }

  const TASK_PAIRS_OWN: PairGrant[] = [
    ["read", "task", "Own"],
    ["update", "task", "Own"],
    ["comment", "task", "Own"],
    ["watch", "task", "Own"],
    ["update-status", "task", "Own"],
    ["read", "project", "Own"],
  ];
  const PROJECT_GOV_TEAM: PairGrant[] = [
    ["read", "project", "Team"],
    ["update", "project", "Team"],
    ["close", "project", "Team", true],
    ["manage-member", "project", "Team", true],
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "pjr5a");
    B = await seedCompany(direct, "pjr5b");
    companyIds.push(A.companyId, B.companyId);
    const ou = await seedOrgUnit(A.companyId, "Studio");

    const mk = async (name: string) =>
      seedUser(direct, A.companyId, `${name}@${A.slug}.test`, hash);
    caUser = await mk("ca");
    oUser = await mk("owner2");
    cUser = await mk("mgrmem");
    dUser = await mk("orgmgr");
    vUser = await mk("viewer");
    mUser = await mk("member");
    gUser = await mk("pm");
    eUser = await mk("emp");
    lUser = await mk("legacy");
    rUser = await mk("reader");
    sUser = await mk("stateguy");
    xUser = await mk("assignee");

    caEmp = await seedEmp(A.companyId, caUser, ou);
    oEmp = await seedEmp(A.companyId, oUser, ou);
    cEmp = await seedEmp(A.companyId, cUser, ou);
    vEmp = await seedEmp(A.companyId, vUser, ou);
    mEmp = await seedEmp(A.companyId, mUser, ou);
    gEmp = await seedEmp(A.companyId, gUser, ou);
    eEmp = await seedEmp(A.companyId, eUser, ou);
    await seedEmp(A.companyId, lUser, ou);
    xEmp = await seedEmp(A.companyId, xUser, ou);
    spareEmp = await seedEmp(A.companyId, await mk("spare"), ou);
    wNewEmp = await seedEmp(A.companyId, await mk("wnew"), ou);
    noAccEmp = await seedEmp(A.companyId, null, ou);

    // Grants — role TUỲ BIẾN (bài học đợt A: role canonical mirror nhau không dựng được deny-path).
    await grantPairs(A.companyId, caUser, "ca", [
      ["read", "project", "Company"],
      ["create", "project", "Company"],
      ["update", "project", "Company"],
      ["close", "project", "Company", true],
      ["manage-member", "project", "Company", true],
      ["read", "task", "Company"],
      ["create", "task", "Company"],
      ["update", "task", "Company"],
      ["create", "project_state", "Company"],
    ]);
    await grantPairs(A.companyId, oUser, "own2", PROJECT_GOV_TEAM);
    await grantPairs(A.companyId, cUser, "mgrmem", PROJECT_GOV_TEAM);
    await grantPairs(A.companyId, dUser, "orgmgr", [
      ...PROJECT_GOV_TEAM,
      ["create", "task", "Team"],
    ]);
    await grantPairs(A.companyId, vUser, "viewer", TASK_PAIRS_OWN);
    await grantPairs(A.companyId, mUser, "member", TASK_PAIRS_OWN);
    await grantPairs(A.companyId, gUser, "pm", [
      ...TASK_PAIRS_OWN,
      ["create", "task", "Own"],
      ["update", "project", "Team"],
      ["create", "project_state", "Team"],
      ["read", "project", "Company"],
    ]);
    await grantPairs(A.companyId, eUser, "emp", [
      ["read", "task", "Own"],
      ["create", "task", "Own"],
    ]);
    await grantPairs(A.companyId, lUser, "legacy", [
      ["read", "task", "Own"],
      ["update", "task", "Own"],
      ["comment", "task", "Own"],
      ["read", "project", "Company"],
    ]);
    await grantPairs(A.companyId, rUser, "reader", [["read", "project", "Company"]]);
    await grantPairs(A.companyId, sUser, "stateguy", [["create", "project_state", "Team"]]);

    tCa = await login(A.slug, `ca@${A.slug}.test`);
    tO = await login(A.slug, `owner2@${A.slug}.test`);
    tC = await login(A.slug, `mgrmem@${A.slug}.test`);
    tD = await login(A.slug, `orgmgr@${A.slug}.test`);
    tV = await login(A.slug, `viewer@${A.slug}.test`);
    tM = await login(A.slug, `member@${A.slug}.test`);
    tG = await login(A.slug, `pm@${A.slug}.test`);
    tE = await login(A.slug, `emp@${A.slug}.test`);
    tL = await login(A.slug, `legacy@${A.slug}.test`);
    tR = await login(A.slug, `reader@${A.slug}.test`);
    tS = await login(A.slug, `stateguy@${A.slug}.test`);

    // P1 qua API (creator ca ⇒ ca = Owner-member + owner_employee_id=caEmp).
    const pRes = await authPost(tCa, "/projects").send({ name: "PJR Chính" });
    expect(pRes.status, JSON.stringify(pRes.body)).toBe(201);
    P1 = pRes.body.data.id as string;
    await addMember(P1, oEmp, "Owner");
    await addMember(P1, cEmp, "Manager");
    await addMember(P1, vEmp, "Viewer");
    await addMember(P1, mEmp, "Member");
    await addMember(P1, xEmp, "Member");
    // L: hàng LEGACY user_id-only (employee_id NULL, project_role NULL) — media-era trước 0478.
    await direct.query(
      `INSERT INTO project_members (company_id, project_id, user_id, member_status)
       VALUES ($1,$2,$3,'Active')`,
      [A.companyId, P1, lUser],
    );
    // G: 2 hàng Active CÙNG KHỚP actor G — kịch bản chống-lặp myProjectRole (BLOCKING #2), tổ hợp
    // HỢP LỆ với cả 2 unique 0478 (legacy theo user_id · mới theo employee_id, cả hai partial):
    //   row1 media-era user-only:     user_id=gUser, employee_id=NULL, role='Manager'
    //   row2 employee-only account cũ: user_id=orphan, employee_id=gEmp, role=NULL
    // Actor G khớp row1 qua user_id + row2 qua employee_id ⇒ LEFT JOIN nhân đôi P1,
    // scalar-subquery role-mạnh-nhất trả 1 dòng 'Manager'.
    const dupUser = await mk("orphan-dup");
    await direct.query(
      `INSERT INTO project_members (company_id, project_id, user_id, project_role, member_status)
       VALUES ($1,$2,$3,'Manager','Active')`,
      [A.companyId, P1, gUser],
    );
    await direct.query(
      `INSERT INTO project_members (company_id, project_id, user_id, employee_id, member_status)
       VALUES ($1,$2,$3,$4,'Active')`,
      [A.companyId, P1, dupUser, gEmp],
    );

    // P0: 0 Owner-member (owner_employee_id set, KHÔNG member nào) — direct.
    const p0 = await direct.query(
      `INSERT INTO projects (company_id, name, status, owner_employee_id)
       VALUES ($1,'PJR Zero Owner','active',$2) RETURNING id`,
      [A.companyId, spareEmp],
    );
    P0 = p0.rows[0].id as string;

    // PClose: O là Owner-member (≠ owner_employee_id=caEmp) — cho test close re-anchor.
    const pc = await authPost(tCa, "/projects").send({ name: "PJR Close" });
    expect(pc.status).toBe(201);
    PClose = pc.body.data.id as string;
    await addMember(PClose, oEmp, "Owner");

    TX = await seedTask(A.companyId, P1, "T của X", xEmp, xUser);
    TM = await seedTask(A.companyId, P1, "T của M", mEmp, mUser);

    // Tenant B fixtures.
    const bUser = await seedUser(direct, B.companyId, `admin@${B.slug}.test`, hash);
    const bEmp = await seedEmp(B.companyId, bUser, null);
    const pb = await direct.query(
      `INSERT INTO projects (company_id, name, status, owner_employee_id)
       VALUES ($1,'PJR B','active',$2) RETURNING id`,
      [B.companyId, bEmp],
    );
    PB = pb.rows[0].id as string;
    TB = await seedTask(B.companyId, null, "T bên B", null, null);
  }, 120_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── G1. Governance re-anchor (D-25) ────────────────────────────────────────────
  describe("G1. governance neo Owner-member (KHÔNG còn owner_employee_id 1-người)", () => {
    it("Owner-member ≠ owner_employee_id: thêm member ⇒ 201 (TRƯỚC đợt C: 403 — đổi hành vi chủ đích)", async () => {
      const res = await authPost(tO, `/projects/${P1}/members`).send({
        employeeId: spareEmp,
        projectRole: "Member",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    it("Owner-member close dự án ⇒ 200", async () => {
      const res = await authPost(tO, `/projects/${PClose}/close`).send({ note: "xong" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("Manager-member gọi manage-member ⇒ 403 NOT-OWNER (D-26: thành viên = Owner-only)", async () => {
      const res = await authPost(tC, `/projects/${P1}/members`).send({
        employeeId: wNewEmp,
        projectRole: "Member",
      });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain("NOT-OWNER");
    });

    it("mgr@Team KHÔNG-member ⇒ 403 NOT-OWNER", async () => {
      const res = await authPost(tD, `/projects/${P1}/members`).send({
        employeeId: wNewEmp,
        projectRole: "Member",
      });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain("NOT-OWNER");
    });

    it("dự án 0 Owner-member ⇒ 403 OWNER-REQUIRED (fail-closed)", async () => {
      const res = await authPost(tD, `/projects/${P0}/members`).send({
        employeeId: wNewEmp,
        projectRole: "Member",
      });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain("OWNER-REQUIRED");
    });

    it("scope Company bypass tầng role (regression)", async () => {
      const res = await authPost(tCa, `/projects/${P0}/members`).send({
        employeeId: wNewEmp,
        projectRole: "Member",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });
  });

  // ── G2. Viewer-hole đóng (mode 'write') ────────────────────────────────────────
  describe("G2. membership-write cap Owner/Manager — Viewer/Member không sửa task người khác", () => {
    it("Viewer PATCH task người khác ⇒ 404", async () => {
      const res = await authPatch(tV, `/tasks/${TX}`).send({ title: "hack" });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("Member PATCH task người khác ⇒ 404", async () => {
      const res = await authPatch(tM, `/tasks/${TX}`).send({ title: "hack" });
      expect(res.status).toBe(404);
    });

    it("Member PATCH task ĐƯỢC GIAO cho mình ⇒ 200 (nhánh assignee không cap)", async () => {
      const res = await authPatch(tM, `/tasks/${TM}`).send({ title: "T của M (sửa)" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("Manager-member PATCH task người khác ⇒ 200 (membership 'write')", async () => {
      const res = await authPatch(tG, `/tasks/${TX}`).send({ title: "T của X (PM sửa)" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  });

  // ── G2b. Route legacy gate update:task PHẢI cap D-24 sau 0501 (finding HIGH 2 reviewer) ─────────
  describe("G2b. legacy update:task routes (PATCH /:id/status · /labels/*) cap 'write' như /tasks/:id", () => {
    let labelId = "";
    beforeAll(async () => {
      const r = await direct.query(
        `INSERT INTO labels (company_id, project_id, name, color)
         VALUES ($1,$2,$3,'#22c55e') RETURNING id`,
        [A.companyId, P1, `lbl-${randomUUID().slice(0, 6)}`],
      );
      labelId = r.rows[0].id as string;
    });

    it("Viewer PATCH /tasks/:id/status task người khác ⇒ 404 (route khai tử vẫn phải gác scope)", async () => {
      const res = await authPatch(tV, `/tasks/${TX}/status`).send({ status: "in_progress" });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("Member PATCH /tasks/:id/status task người khác ⇒ 404; task của mình ⇒ 200", async () => {
      expect(
        (await authPatch(tM, `/tasks/${TX}/status`).send({ status: "in_progress" })).status,
      ).toBe(404);
      expect(
        (await authPatch(tM, `/tasks/${TM}/status`).send({ status: "in_progress" })).status,
      ).toBe(200);
    });

    it("Viewer POST /tasks/:id/labels task người khác ⇒ 404 (không ghi metadata task toàn tenant)", async () => {
      const res = await authPost(tV, `/tasks/${TX}/labels/${labelId}`).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });

    it("Manager-member POST rồi DELETE /tasks/:id/labels ⇒ 2xx (membership 'write' mở đúng)", async () => {
      const rAdd = await authPost(tG, `/tasks/${TX}/labels/${labelId}`).send({});
      expect(rAdd.status, JSON.stringify(rAdd.body)).toBe(201);
      const rDel = await request(app.getHttpServer())
        .delete(`/tasks/${TX}/labels/${labelId}`)
        .set("Authorization", `Bearer ${tG}`);
      expect(rDel.status, JSON.stringify(rDel.body)).toBe(204);
    });
  });

  // ── G3. Collab-cap per-OPERATION (Viewer đọc được nhưng không ghi được) ─────────
  describe("G3. collab-cap: cùng task — Viewer read OK, write 404; Member write OK", () => {
    it("Viewer GET comments ⇒ 200", async () => {
      const res = await authGet(tV, `/tasks/${TX}/comments`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("Viewer POST comment ⇒ 404 (mode 'collab' chặn)", async () => {
      const res = await authPost(tV, `/tasks/${TX}/comments`).send({
        content: "viewer nói leo",
        mentionEmployeeIds: [],
      });
      expect(res.status).toBe(404);
    });

    it("Member POST comment ⇒ 201", async () => {
      const res = await authPost(tM, `/tasks/${TX}/comments`).send({
        content: "member bình luận",
        mentionEmployeeIds: [],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    it("Viewer GET checklists ⇒ 200 NHƯNG POST checklist ⇒ 404", async () => {
      const rGet = await authGet(tV, `/tasks/${TX}/checklists`);
      expect(rGet.status).toBe(200);
      const rPost = await authPost(tV, `/tasks/${TX}/checklists`).send({
        title: "cl viewer",
        items: [],
      });
      expect(rPost.status).toBe(404);
    });

    it("Member POST checklist trên task người khác ⇒ 201 (D-24 collab)", async () => {
      const res = await authPost(tM, `/tasks/${TX}/checklists`).send({
        title: "cl member",
        items: ["việc nhỏ"],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });
  });

  // ── G4. Watch KHÔNG cap (call-site thứ 3 — BLOCKING residual plan-reviewer) ─────
  describe("G4. watch = read-affordance: Viewer watch được, mutate vẫn 404", () => {
    it("Viewer POST watchers ⇒ 201 và change-status CÙNG task ⇒ 404", async () => {
      const rw = await authPost(tV, `/tasks/${TX}/watchers`).send({});
      expect(rw.status, JSON.stringify(rw.body)).toBe(201);
      const rs = await authPost(tV, `/tasks/${TX}/change-status`).send({
        status: "In Progress",
      });
      expect(rs.status).toBe(404);
    });
  });

  // ── G5. Create-scope (D-27) ────────────────────────────────────────────────────
  describe("G5. create-scope: Own ngoài dự án = self-assign; trong dự án = Owner/Manager", () => {
    it("emp@Own không projectId + không assignee ⇒ 403", async () => {
      const res = await authPost(tE, "/tasks").send({ title: "vô chủ" });
      expect(res.status).toBe(403);
    });

    it("emp@Own tự giao cho mình ⇒ 201 (SPEC-06 §24 Q1 = CÓ)", async () => {
      const res = await authPost(tE, "/tasks").send({
        title: "việc cá nhân",
        assigneeEmployeeId: eEmp,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    it("emp@Own giao cho người khác ⇒ 403 (out-of-scope)", async () => {
      const res = await authPost(tE, "/tasks").send({
        title: "giao bậy",
        assigneeEmployeeId: xEmp,
      });
      expect(res.status).toBe(403);
    });

    it("Member tạo task trong dự án ⇒ 403 (role < Manager)", async () => {
      const res = await authPost(tM, "/tasks").send({ title: "member tạo", projectId: P1 });
      expect(res.status).toBe(403);
    });

    it("Manager-member tạo task trong dự án ⇒ 201; giao cho member khác team ⇒ 201", async () => {
      const r1 = await authPost(tG, "/tasks").send({ title: "PM tạo", projectId: P1 });
      expect(r1.status, JSON.stringify(r1.body)).toBe(201);
      const r2 = await authPost(tG, "/tasks").send({
        title: "PM giao member",
        projectId: P1,
        assigneeEmployeeId: mEmp,
      });
      expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    });

    it("Manager-member giao cho NGƯỜI NGOÀI dự án ⇒ 400 ASSIGNEE-INVALID", async () => {
      const res = await authPost(tG, "/tasks").send({
        title: "giao ngoài",
        projectId: P1,
        assigneeEmployeeId: eEmp,
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain("ASSIGNEE-INVALID");
    });

    it("mgr@Team KHÔNG-member tạo vào dự án ⇒ 403", async () => {
      const res = await authPost(tD, "/tasks").send({ title: "org mgr tạo", projectId: P1 });
      expect(res.status).toBe(403);
    });

    it("ca@Company giữ hành vi cũ: tạo vào dự án + assignee ngoài dự án ⇒ 201 (warning-only)", async () => {
      const res = await authPost(tCa, "/tasks").send({
        title: "ca tạo",
        projectId: P1,
        assigneeEmployeeId: eEmp,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });
  });

  // ── G6. Update-project role layer + đổi chủ sync (D-24/D-25) ───────────────────
  describe("G6. update-project: field thường Owner/Manager; đổi chủ Owner + sync member", () => {
    it("mgr@Team KHÔNG-member PATCH field thường ⇒ 403 (TRƯỚC: 200 — đổi hành vi chủ đích)", async () => {
      const res = await authPatch(tD, `/projects/${P1}`).send({ description: "sửa bậy" });
      expect(res.status).toBe(403);
    });

    it("Manager-member PATCH field thường ⇒ 200", async () => {
      const res = await authPatch(tG, `/projects/${P1}`).send({ description: "PM cập nhật" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("Manager-member đổi ownerEmployeeId ⇒ 403 (govern = Owner)", async () => {
      const res = await authPatch(tG, `/projects/${P1}`).send({ ownerEmployeeId: gEmp });
      expect(res.status).toBe(403);
    });

    it("đổi chủ sang employee KHÔNG account ⇒ 400 OWNER-NO-ACCOUNT", async () => {
      const res = await authPatch(tO, `/projects/${P1}`).send({ ownerEmployeeId: noAccEmp });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain("OWNER-NO-ACCOUNT");
    });

    it("Owner-member đổi chủ sang người CHƯA member ⇒ 200 + upsert Active Owner-member CÙNG tx", async () => {
      const res = await authPatch(tO, `/projects/${P1}`).send({ ownerEmployeeId: wNewEmp });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const m = await direct.query(
        `SELECT project_role, member_status FROM project_members
          WHERE company_id=$1 AND project_id=$2 AND employee_id=$3 AND deleted_at IS NULL`,
        [A.companyId, P1, wNewEmp],
      );
      expect(m.rows).toHaveLength(1);
      expect(m.rows[0]).toMatchObject({ project_role: "Owner", member_status: "Active" });
    });

    it("đổi chủ sang người ĐÃ member role thường ⇒ nâng role, KHÔNG nhân đôi hàng", async () => {
      const res = await authPatch(tO, `/projects/${P1}`).send({ ownerEmployeeId: mEmp });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const m = await direct.query(
        `SELECT project_role FROM project_members
          WHERE company_id=$1 AND project_id=$2 AND employee_id=$3
            AND member_status='Active' AND deleted_at IS NULL`,
        [A.companyId, P1, mEmp],
      );
      expect(m.rows).toHaveLength(1);
      expect(m.rows[0].project_role).toBe("Owner");
      // trả M về Member để không nhiễu các test sau (nếu chạy lặp).
      await direct.query(
        `UPDATE project_members SET project_role='Member'
          WHERE company_id=$1 AND project_id=$2 AND employee_id=$3 AND deleted_at IS NULL`,
        [A.companyId, P1, mEmp],
      );
    });
  });

  // ── G7. States role-layer (D-28 — dormant với seed thật, dựng role tuỳ biến) ────
  describe("G7. project_state CUD: scope<Company ⇒ Owner/Manager của đúng dự án", () => {
    it("pair@Team KHÔNG-member POST states ⇒ 403", async () => {
      const res = await authPost(tS, `/projects/${P1}/states`).send({
        name: `St-${randomUUID().slice(0, 6)}`,
        stateGroup: "started",
        sortOrder: 50,
      });
      expect(res.status).toBe(403);
    });

    it("Manager-member có pair@Team POST states ⇒ 201; ca@Company ⇒ 201 (bypass)", async () => {
      const r1 = await authPost(tG, `/projects/${P1}/states`).send({
        name: `St-${randomUUID().slice(0, 6)}`,
        stateGroup: "started",
        sortOrder: 51,
      });
      expect(r1.status, JSON.stringify(r1.body)).toBe(201);
      const r2 = await authPost(tCa, `/projects/${P1}/states`).send({
        name: `St-${randomUUID().slice(0, 6)}`,
        stateGroup: "review",
        sortOrder: 52,
      });
      expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    });
  });

  // ── G8. myProjectRole + NULL=Member + chống-lặp ────────────────────────────────
  describe("G8. myProjectRole (detail + list) + member legacy role NULL", () => {
    it("detail trả đúng role 4 kiểu + null cho non-member @Company", async () => {
      const check = async (t: string, expected: string | null) => {
        const res = await authGet(t, `/projects/${P1}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.myProjectRole).toBe(expected);
      };
      await check(tV, "Viewer");
      await check(tG, "Manager"); // mạnh nhất của {Manager, NULL→Member} — 2 hàng
      await check(tO, "Owner");
      await check(tR, null); // read@Company, không member
    });

    it("list KHÔNG nhân bản khi actor khớp 2 hàng member (scalar-subquery, BLOCKING #2)", async () => {
      const res = await authGet(tG, "/projects?limit=200");
      expect(res.status).toBe(200);
      const hits = (res.body.data as Array<{ id: string; myProjectRole: string | null }>).filter(
        (p) => p.id === P1,
      );
      expect(hits).toHaveLength(1);
      expect(hits[0].myProjectRole).toBe("Manager");
    });

    it("member legacy user-only (role NULL) = Member: đọc + comment OK, sửa task 404", async () => {
      const rDetail = await authGet(tL, `/projects/${P1}`);
      expect(rDetail.status).toBe(200);
      expect(rDetail.body.data.myProjectRole).toBe("Member");

      const rRead = await authGet(tL, `/tasks/${TX}`);
      expect(rRead.status, JSON.stringify(rRead.body)).toBe(200);
      const rCmt = await authPost(tL, `/tasks/${TX}/comments`).send({
        content: "legacy member",
        mentionEmployeeIds: [],
      });
      expect(rCmt.status, JSON.stringify(rCmt.body)).toBe(201);
      const rUpd = await authPatch(tL, `/tasks/${TX}`).send({ title: "legacy sửa" });
      expect(rUpd.status).toBe(404);
    });
  });

  // ── G9. Backfill 0501 phần B (chạy lại SQL migration trên dữ liệu dựng) ─────────
  describe("G9. backfill Owner-member (0501 phần B) — INSERT/UPDATE/SKIP + idempotent", () => {
    async function runMigration0501(): Promise<void> {
      const sqlText = readFileSync(
        join(
          __dirname,
          "../../migrations/0501_s5_projrole1_undefer_grants_backfill_owner_member.sql",
        ),
        "utf8",
      );
      for (const stmt of sqlText.split("--> statement-breakpoint")) {
        const trimmed = stmt.trim();
        if (trimmed.length > 0) await direct.query(trimmed);
      }
    }

    it("owner thiếu member ⇒ INSERT; owner đã member role thường ⇒ UPDATE nâng; account-less ⇒ SKIP", async () => {
      // (i) owner có account, KHÔNG member.
      const f = await direct.query(
        `INSERT INTO projects (company_id, name, status, owner_employee_id)
         VALUES ($1,'PJR BF1','active',$2) RETURNING id`,
        [A.companyId, eEmp],
      );
      const PBf1 = f.rows[0].id as string;
      // (ii) owner đã là member role Member.
      const f2 = await direct.query(
        `INSERT INTO projects (company_id, name, status, owner_employee_id)
         VALUES ($1,'PJR BF2','active',$2) RETURNING id`,
        [A.companyId, xEmp],
      );
      const PBf2 = f2.rows[0].id as string;
      await direct.query(
        `INSERT INTO project_members (company_id, project_id, user_id, employee_id, project_role, member_status)
         VALUES ($1,$2,$3,$4,'Member','Active')`,
        [A.companyId, PBf2, xUser, xEmp],
      );
      // (iii) owner KHÔNG account, không member.
      const f3 = await direct.query(
        `INSERT INTO projects (company_id, name, status, owner_employee_id)
         VALUES ($1,'PJR BF3','active',$2) RETURNING id`,
        [A.companyId, noAccEmp],
      );
      const PBf3 = f3.rows[0].id as string;

      await runMigration0501();

      const r1 = await direct.query(
        `SELECT project_role, member_status, user_id FROM project_members
          WHERE company_id=$1 AND project_id=$2 AND employee_id=$3 AND deleted_at IS NULL`,
        [A.companyId, PBf1, eEmp],
      );
      expect(r1.rows).toHaveLength(1);
      expect(r1.rows[0]).toMatchObject({
        project_role: "Owner",
        member_status: "Active",
        user_id: eUser,
      });

      const r2 = await direct.query(
        `SELECT project_role FROM project_members
          WHERE company_id=$1 AND project_id=$2 AND employee_id=$3
            AND member_status='Active' AND deleted_at IS NULL`,
        [A.companyId, PBf2, xEmp],
      );
      expect(r2.rows).toHaveLength(1);
      expect(r2.rows[0].project_role).toBe("Owner");

      const r3 = await direct.query(
        `SELECT 1 FROM project_members WHERE company_id=$1 AND project_id=$2`,
        [A.companyId, PBf3],
      );
      expect(r3.rows).toHaveLength(0); // SKIP account-less, không crash migration

      // Idempotent: chạy lại ⇒ không nhân đôi.
      await runMigration0501();
      const again = await direct.query(
        `SELECT count(*)::int AS n FROM project_members
          WHERE company_id=$1 AND project_id=$2 AND employee_id=$3 AND deleted_at IS NULL`,
        [A.companyId, PBf1, eEmp],
      );
      expect(again.rows[0].n).toBe(1);
    });

    it("owner có hàng member LEGACY user_id-only (employee_id NULL) ⇒ nâng chính hàng đó, KHÔNG INSERT đâm unique (MEDIUM-2)", async () => {
      const f = await direct.query(
        `INSERT INTO projects (company_id, name, status, owner_employee_id)
         VALUES ($1,'PJR BF Legacy','active',$2) RETURNING id`,
        [A.companyId, eEmp],
      );
      const PBfL = f.rows[0].id as string;
      // Hàng member media-era: user_id của chủ, employee_id NULL, role NULL, Active — trượt SELECT
      // theo employee_id ⇒ nhánh cũ sẽ INSERT ⇒ đâm project_members_active_uq (company,project,user_id).
      await direct.query(
        `INSERT INTO project_members (company_id, project_id, user_id, member_status)
         VALUES ($1,$2,$3,'Active')`,
        [A.companyId, PBfL, eUser],
      );

      await runMigration0501(); // KHÔNG được throw

      const rows = await direct.query(
        `SELECT id, project_role, employee_id FROM project_members
          WHERE company_id=$1 AND project_id=$2 AND member_status='Active' AND deleted_at IS NULL`,
        [A.companyId, PBfL],
      );
      expect(rows.rows, "chỉ 1 hàng Active — nâng legacy, không INSERT hàng hai").toHaveLength(1);
      expect(rows.rows[0].project_role).toBe("Owner");
      expect(rows.rows[0].employee_id).toBeNull(); // vẫn là hàng legacy (được nâng role tại chỗ)
    });
  });

  // ── G10. Cross-tenant ──────────────────────────────────────────────────────────
  describe("G10. cross-tenant 404 — không lộ tồn tại", () => {
    it("PATCH project B / thêm member B / tạo state B / tạo task vào project B / sửa task B ⇒ 404", async () => {
      const r1 = await authPatch(tCa, `/projects/${PB}`).send({ description: "x" });
      expect(r1.status).toBe(404);
      const r2 = await authPost(tCa, `/projects/${PB}/members`).send({
        employeeId: caEmp,
        projectRole: "Member",
      });
      expect(r2.status).toBe(404);
      const r3 = await authPost(tCa, `/projects/${PB}/states`).send({
        name: "X",
        stateGroup: "started",
        sortOrder: 1,
      });
      expect(r3.status).toBe(404);
      const r4 = await authPost(tG, "/tasks").send({ title: "xuyên tenant", projectId: PB });
      expect(r4.status).toBe(404);
      const r5 = await authPatch(tCa, `/tasks/${TB}`).send({ title: "x" });
      expect(r5.status).toBe(404);
    });
  });
});
