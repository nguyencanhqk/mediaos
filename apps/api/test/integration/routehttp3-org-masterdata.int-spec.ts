/**
 * S10-QA-ROUTEHTTP-3 (file 3/6) — test HTTP THẬT cho phần đuôi CƠ CẤU TỔ CHỨC + DANH MỤC NỀN:
 *
 *   OrgController          6 route  units PATCH/DELETE · teams PATCH/DELETE · teams/:id/leader · members DELETE
 *   PositionsController    5 route  list · detail · create · update · delete
 *   HrDepartmentController 5 route  list · detail · create · update · delete
 *   HrMasterDataController 10 route job-levels ×5 · contract-types ×5
 *   HrReadController       5 route  lookups: departments · positions · job-levels · contract-types · employee-code/preview
 *
 * Tất cả đều nằm trong nhóm risk≤2 mà `route-http-coverage.e2e-spec.ts` đo là CHƯA có bằng chứng HTTP.
 * Đây là các route CRUD nền: rủi ro thấp nhưng chúng là NGUỒN dữ liệu cho HR/ATT/LEAVE, nên một route
 * chết ở đây làm hỏng cả nhánh nghiệp vụ mà không có ca test nào kêu.
 *
 * LUẬT CHỐNG DENY-XANH-RỖNG. Mỗi tài nguyên đi trọn CHUỖI create → list → detail → update → delete và
 * mỗi bước GHI được chứng minh bằng HỆ QUẢ đọc lại qua chính route đọc của nó (không assert suông theo
 * status code). Ca DENY (role RỖNG → 403) đặt SAU chuỗi ALLOW, nên 403 không thể xanh vì route chết
 * ([[deny-cases-vacuous-without-allow-case]]).
 *
 * XOÁ = 204 KHÔNG BODY. `deleteOrgUnit`/`deleteTeam`/`removeTeamMember`/`deletePosition`/
 * `deleteDepartment`/`deleteJobLevel`/`deleteContractType` đều khai `@HttpCode(204)` ⇒ assert 204 và
 * đọc lại bằng route detail/list, đừng đòi envelope trong body.
 *
 * ACTOR KHÔNG PHẢI SUPER-ADMIN ([[superadmin-not-a-canonical-role]]).
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
const LOGIN_PW = loginPasswordFixture("s10rh3om");

/** Cặp quyền THẬT của 5 controller (is_sensitive đo trên catalog lane DB — tất cả đều `false`). */
const ADMIN_PAIRS = [
  { action: "create", resource: "org_unit", sensitive: false },
  { action: "update", resource: "org_unit", sensitive: false },
  { action: "delete", resource: "org_unit", sensitive: false },
  { action: "read", resource: "team", sensitive: false },
  { action: "create", resource: "team", sensitive: false },
  { action: "update", resource: "team", sensitive: false },
  { action: "delete", resource: "team", sensitive: false },
  { action: "read", resource: "position", sensitive: false },
  { action: "create", resource: "position", sensitive: false },
  { action: "update", resource: "position", sensitive: false },
  { action: "delete", resource: "position", sensitive: false },
  { action: "read", resource: "department", sensitive: false },
  { action: "create", resource: "department", sensitive: false },
  { action: "update", resource: "department", sensitive: false },
  { action: "delete", resource: "department", sensitive: false },
  { action: "manage", resource: "master-data", sensitive: false },
  { action: "preview", resource: "employee-code", sensitive: false },
] as const;

const uniq = () => randomUUID().slice(0, 8);

describe.skipIf(!hasLaneDb)(
  "S10-QA-ROUTEHTTP-3 — HTTP thật: org · positions · hr-departments · master-data · lookups (31 route)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let tAdminA = "";
    let tEmptyA = "";
    let tAdminB = "";
    let memberUserIdA = "";

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

    async function actor(
      tenant: SeededTenant,
      tag: string,
      pairs: ReadonlyArray<{ action: string; resource: string; sensitive: boolean }>,
    ): Promise<{ id: string; token: string }> {
      const password = new PasswordService();
      const email = `${tag}-${uniq()}@s10rh3om.local`;
      const id = await seedUser(direct, tenant.companyId, email, await password.hash(LOGIN_PW));
      const roleId = await seedRole(direct, tenant.companyId, `s10rh3om-${tag}-${uniq()}`);
      for (const p of pairs) {
        const permId = await seedPermissionCatalog(direct, p.action, p.resource, p.sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, id, roleId, tenant.companyId);
      return { id, token: await login(tenant.slug, email) };
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
      A = await seedCompany(direct, "s10rh3oma");
      B = await seedCompany(direct, "s10rh3omb");
      companyIds.push(A.companyId, B.companyId);

      tAdminA = (await actor(A, "admin", ADMIN_PAIRS)).token;
      tEmptyA = (await actor(A, "empty", [])).token;
      tAdminB = (await actor(B, "adminb", ADMIN_PAIRS)).token;
      memberUserIdA = (await actor(A, "member", [])).id;
    });

    afterAll(async () => {
      await app?.close();
      if (companyIds.length > 0) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    // ─── 1. OrgController — units ────────────────────────────────────────────────

    it("org/units: PATCH + DELETE — ALLOW, HỆ QUẢ đọc lại qua GET /org/units", async () => {
      const created = await authPost(tAdminA, "/org/units").send({
        name: `Đơn vị ${uniq()}`,
        type: "department",
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const unitId = created.body.data.id as string;

      const patched = await authPatch(tAdminA, `/org/units/${unitId}`).send({
        name: "Đơn vị (đã đổi tên)",
        description: "mô tả mới",
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);

      const afterPatch = await authGet(tAdminA, "/org/units");
      const found = (afterPatch.body.data as Array<{ id: string; name: string }>).find(
        (u) => u.id === unitId,
      );
      expect(found?.name).toBe("Đơn vị (đã đổi tên)");

      const removed = await authDelete(tAdminA, `/org/units/${unitId}`);
      expect(removed.status, JSON.stringify(removed.body)).toBe(204);

      const afterDelete = await authGet(tAdminA, "/org/units");
      expect((afterDelete.body.data as Array<{ id: string }>).map((u) => u.id)).not.toContain(
        unitId,
      );
    });

    // ─── 2. OrgController — teams ────────────────────────────────────────────────

    it("org/teams: PATCH · PATCH leader · DELETE member · DELETE team — ALLOW, HỆ QUẢ đọc lại", async () => {
      const created = await authPost(tAdminA, "/org/teams").send({
        name: `Nhóm ${uniq()}`,
        type: "production_team",
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const teamId = created.body.data.id as string;

      const patched = await authPatch(tAdminA, `/org/teams/${teamId}`).send({
        name: "Nhóm (đã đổi tên)",
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const list = await authGet(tAdminA, "/org/teams");
      expect(
        (list.body.data as Array<{ id: string; name: string }>).find((t) => t.id === teamId)?.name,
      ).toBe("Nhóm (đã đổi tên)");

      const leader = await authPatch(tAdminA, `/org/teams/${teamId}/leader`).send({
        leaderId: memberUserIdA,
      });
      expect(leader.status, JSON.stringify(leader.body)).toBe(200);
      const afterLeader = await authGet(tAdminA, "/org/teams");
      expect(
        (afterLeader.body.data as Array<{ id: string; leaderUserId: string | null }>).find(
          (t) => t.id === teamId,
        )?.leaderUserId,
      ).toBe(memberUserIdA);

      const added = await authPost(tAdminA, `/org/teams/${teamId}/members`).send({
        userId: memberUserIdA,
        roleName: "member",
      });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      const members = await authGet(tAdminA, `/org/teams/${teamId}/members`);
      expect((members.body.data as Array<{ userId: string }>).map((m) => m.userId)).toContain(
        memberUserIdA,
      );

      const removedMember = await authDelete(
        tAdminA,
        `/org/teams/${teamId}/members/${memberUserIdA}`,
      );
      expect(removedMember.status, JSON.stringify(removedMember.body)).toBe(204);
      const membersAfter = await authGet(tAdminA, `/org/teams/${teamId}/members`);
      expect(
        (membersAfter.body.data as Array<{ userId: string }>).map((m) => m.userId),
      ).not.toContain(memberUserIdA);

      const removedTeam = await authDelete(tAdminA, `/org/teams/${teamId}`);
      expect(removedTeam.status, JSON.stringify(removedTeam.body)).toBe(204);
      const teamsAfter = await authGet(tAdminA, "/org/teams");
      expect((teamsAfter.body.data as Array<{ id: string }>).map((t) => t.id)).not.toContain(
        teamId,
      );
    });

    // ─── 3. PositionsController — CRUD đầy đủ ────────────────────────────────────

    it("org/positions: POST → GET list → GET :id → PATCH → DELETE, mỗi bước có HỆ QUẢ", async () => {
      const code = `POS-${uniq()}`;
      const created = await authPost(tAdminA, "/org/positions").send({
        name: "Biên tập viên",
        code,
        level: 3,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.data.id as string;

      const list = await authGet(tAdminA, "/org/positions");
      expect(list.status).toBe(200);
      expect((list.body.data as Array<{ id: string }>).map((p) => p.id)).toContain(id);

      const one = await authGet(tAdminA, `/org/positions/${id}`);
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      expect(one.body.data.code).toBe(code);

      const patched = await authPatch(tAdminA, `/org/positions/${id}`).send({
        name: "Biên tập viên cao cấp",
        level: 5,
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const reread = await authGet(tAdminA, `/org/positions/${id}`);
      expect(reread.body.data.name).toBe("Biên tập viên cao cấp");
      expect(reread.body.data.level).toBe(5);

      const removed = await authDelete(tAdminA, `/org/positions/${id}`);
      expect(removed.status, JSON.stringify(removed.body)).toBe(204);
      const gone = await authGet(tAdminA, `/org/positions/${id}`);
      expect(gone.status).toBe(404);
    });

    // ─── 4. HrDepartmentController — CRUD đầy đủ ─────────────────────────────────

    it("hr/departments: POST → GET list → GET :id → PATCH → DELETE, mỗi bước có HỆ QUẢ", async () => {
      const code = `DEP-${uniq()}`;
      const created = await authPost(tAdminA, "/hr/departments").send({
        name: "Phòng Nội dung",
        code,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.data.id as string;

      const list = await authGet(tAdminA, "/hr/departments");
      expect(list.status).toBe(200);
      expect((list.body.data as Array<{ id: string }>).map((d) => d.id)).toContain(id);

      const one = await authGet(tAdminA, `/hr/departments/${id}`);
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      expect(one.body.data.code).toBe(code);

      const patched = await authPatch(tAdminA, `/hr/departments/${id}`).send({
        name: "Phòng Nội dung số",
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const reread = await authGet(tAdminA, `/hr/departments/${id}`);
      expect(reread.body.data.name).toBe("Phòng Nội dung số");

      const removed = await authDelete(tAdminA, `/hr/departments/${id}`);
      expect(removed.status, JSON.stringify(removed.body)).toBe(204);
      const gone = await authGet(tAdminA, `/hr/departments/${id}`);
      expect(gone.status).toBe(404);
    });

    // ─── 5. HrMasterDataController — job-levels + contract-types ─────────────────

    it("hr/master-data/job-levels: POST → GET list → GET :id → PATCH → DELETE", async () => {
      const code = `JL-${uniq()}`;
      const created = await authPost(tAdminA, "/hr/master-data/job-levels").send({
        code,
        name: "Cấp 1",
        rankOrder: 1,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.data.id as string;

      const list = await authGet(tAdminA, "/hr/master-data/job-levels");
      expect(list.status).toBe(200);
      expect((list.body.data as Array<{ id: string }>).map((x) => x.id)).toContain(id);

      const one = await authGet(tAdminA, `/hr/master-data/job-levels/${id}`);
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      expect(one.body.data.code).toBe(code);

      const patched = await authPatch(tAdminA, `/hr/master-data/job-levels/${id}`).send({
        name: "Cấp 1 (đã sửa)",
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const reread = await authGet(tAdminA, `/hr/master-data/job-levels/${id}`);
      expect(reread.body.data.name).toBe("Cấp 1 (đã sửa)");

      const removed = await authDelete(tAdminA, `/hr/master-data/job-levels/${id}`);
      expect(removed.status, JSON.stringify(removed.body)).toBe(204);
      const gone = await authGet(tAdminA, `/hr/master-data/job-levels/${id}`);
      expect(gone.status).toBe(404);
    });

    it("hr/master-data/contract-types: POST → GET list → GET :id → PATCH → DELETE", async () => {
      const code = `CT-${uniq()}`;
      const created = await authPost(tAdminA, "/hr/master-data/contract-types").send({
        code,
        name: "Hợp đồng xác định thời hạn",
        requiresEndDate: true,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.data.id as string;

      const list = await authGet(tAdminA, "/hr/master-data/contract-types");
      expect(list.status).toBe(200);
      expect((list.body.data as Array<{ id: string }>).map((x) => x.id)).toContain(id);

      const one = await authGet(tAdminA, `/hr/master-data/contract-types/${id}`);
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      expect(one.body.data.requiresEndDate).toBe(true);

      const patched = await authPatch(tAdminA, `/hr/master-data/contract-types/${id}`).send({
        requiresEndDate: false,
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const reread = await authGet(tAdminA, `/hr/master-data/contract-types/${id}`);
      expect(reread.body.data.requiresEndDate).toBe(false);

      const removed = await authDelete(tAdminA, `/hr/master-data/contract-types/${id}`);
      expect(removed.status, JSON.stringify(removed.body)).toBe(204);
      const gone = await authGet(tAdminA, `/hr/master-data/contract-types/${id}`);
      expect(gone.status).toBe(404);
    });

    // ─── 6. HrReadController — 5 route lookup ────────────────────────────────────

    it("hr/lookups: departments · positions · job-levels · contract-types · employee-code/preview — 200", async () => {
      const dep = await authPost(tAdminA, "/hr/departments").send({ name: `Lookup ${uniq()}` });
      expect(dep.status).toBe(201);
      const pos = await authPost(tAdminA, "/org/positions").send({ name: `Lookup ${uniq()}` });
      expect(pos.status).toBe(201);
      const jl = await authPost(tAdminA, "/hr/master-data/job-levels").send({
        code: `JL-${uniq()}`,
        name: "Lookup JL",
      });
      expect(jl.status).toBe(201);
      const ct = await authPost(tAdminA, "/hr/master-data/contract-types").send({
        code: `CT-${uniq()}`,
        name: "Lookup CT",
      });
      expect(ct.status).toBe(201);

      const lkDep = await authGet(tAdminA, "/hr/lookups/departments");
      expect(lkDep.status, JSON.stringify(lkDep.body)).toBe(200);
      expect((lkDep.body.data as Array<{ id: string }>).map((x) => x.id)).toContain(
        dep.body.data.id,
      );

      const lkPos = await authGet(tAdminA, "/hr/lookups/positions");
      expect(lkPos.status, JSON.stringify(lkPos.body)).toBe(200);
      expect((lkPos.body.data as Array<{ id: string }>).map((x) => x.id)).toContain(
        pos.body.data.id,
      );

      const lkJl = await authGet(tAdminA, "/hr/lookups/job-levels");
      expect(lkJl.status, JSON.stringify(lkJl.body)).toBe(200);
      expect((lkJl.body.data as Array<{ id: string }>).map((x) => x.id)).toContain(jl.body.data.id);

      const lkCt = await authGet(tAdminA, "/hr/lookups/contract-types");
      expect(lkCt.status, JSON.stringify(lkCt.body)).toBe(200);
      expect((lkCt.body.data as Array<{ id: string }>).map((x) => x.id)).toContain(ct.body.data.id);

      const preview = await authGet(tAdminA, "/hr/lookups/employee-code/preview");
      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      expect(preview.body.data, "preview phải trả một payload, không phải rỗng").toBeTruthy();
    });

    // ─── 7. DENY — role RỖNG, đặt SAU toàn bộ ALLOW ─────────────────────────────

    it("DENY 403: actor role RỖNG bị chặn ở CẢ 31 route (mẫu đại diện mỗi controller)", async () => {
      const fake = randomUUID();
      const calls: Array<Promise<request.Response>> = [
        authPatch(tEmptyA, `/org/units/${fake}`).send({ name: "x" }),
        authDelete(tEmptyA, `/org/units/${fake}`),
        authPatch(tEmptyA, `/org/teams/${fake}`).send({ name: "x" }),
        authPatch(tEmptyA, `/org/teams/${fake}/leader`).send({ leaderId: memberUserIdA }),
        authDelete(tEmptyA, `/org/teams/${fake}`),
        authDelete(tEmptyA, `/org/teams/${fake}/members/${memberUserIdA}`),
        authGet(tEmptyA, "/org/positions"),
        authGet(tEmptyA, `/org/positions/${fake}`),
        authPost(tEmptyA, "/org/positions").send({ name: "x" }),
        authPatch(tEmptyA, `/org/positions/${fake}`).send({ name: "x" }),
        authDelete(tEmptyA, `/org/positions/${fake}`),
        authGet(tEmptyA, "/hr/departments"),
        authGet(tEmptyA, `/hr/departments/${fake}`),
        authPost(tEmptyA, "/hr/departments").send({ name: "x" }),
        authPatch(tEmptyA, `/hr/departments/${fake}`).send({ name: "x" }),
        authDelete(tEmptyA, `/hr/departments/${fake}`),
        authGet(tEmptyA, "/hr/master-data/job-levels"),
        authGet(tEmptyA, `/hr/master-data/job-levels/${fake}`),
        authPost(tEmptyA, "/hr/master-data/job-levels").send({ code: "x", name: "x" }),
        authPatch(tEmptyA, `/hr/master-data/job-levels/${fake}`).send({ name: "x" }),
        authDelete(tEmptyA, `/hr/master-data/job-levels/${fake}`),
        authGet(tEmptyA, "/hr/master-data/contract-types"),
        authGet(tEmptyA, `/hr/master-data/contract-types/${fake}`),
        authPost(tEmptyA, "/hr/master-data/contract-types").send({ code: "x", name: "x" }),
        authPatch(tEmptyA, `/hr/master-data/contract-types/${fake}`).send({ name: "x" }),
        authDelete(tEmptyA, `/hr/master-data/contract-types/${fake}`),
        authGet(tEmptyA, "/hr/lookups/departments"),
        authGet(tEmptyA, "/hr/lookups/positions"),
        authGet(tEmptyA, "/hr/lookups/job-levels"),
        authGet(tEmptyA, "/hr/lookups/contract-types"),
        authGet(tEmptyA, "/hr/lookups/employee-code/preview"),
      ];
      const results = await Promise.all(calls);
      for (const [i, r] of results.entries()) {
        expect(r.status, `call#${i} phải 403, nhận ${r.status}: ${JSON.stringify(r.body)}`).toBe(
          403,
        );
      }
    });

    it("DTO 400 ở BIÊN: thiếu `name` / thiếu `code` / `leaderId` không phải UUID", async () => {
      const bad1 = await authPost(tAdminA, "/org/positions").send({ code: "chỉ-code" });
      expect(bad1.status, JSON.stringify(bad1.body)).toBe(400);

      const bad2 = await authPost(tAdminA, "/hr/master-data/job-levels").send({
        name: "thiếu code",
      });
      expect(bad2.status, JSON.stringify(bad2.body)).toBe(400);

      const team = await authPost(tAdminA, "/org/teams").send({ name: `Nhóm ${uniq()}` });
      expect(team.status).toBe(201);
      const bad3 = await authPatch(tAdminA, `/org/teams/${team.body.data.id}/leader`).send({
        leaderId: "không-phải-uuid",
      });
      expect(bad3.status, JSON.stringify(bad3.body)).toBe(400);
    });

    // ─── 8. Cô lập tenant ────────────────────────────────────────────────────────

    it("CROSS-TENANT: tenant B không đọc/không sửa được danh mục của tenant A", async () => {
      const pos = await authPost(tAdminA, "/org/positions").send({ name: `Riêng A ${uniq()}` });
      expect(pos.status).toBe(201);
      const dep = await authPost(tAdminA, "/hr/departments").send({ name: `Riêng A ${uniq()}` });
      expect(dep.status).toBe(201);

      const readPos = await authGet(tAdminB, `/org/positions/${pos.body.data.id}`);
      expect(readPos.status, JSON.stringify(readPos.body)).toBe(404);

      const readDep = await authGet(tAdminB, `/hr/departments/${dep.body.data.id}`);
      expect(readDep.status, JSON.stringify(readDep.body)).toBe(404);

      const listB = await authGet(tAdminB, "/org/positions");
      expect(listB.status).toBe(200);
      expect((listB.body.data as Array<{ id: string }>).map((p) => p.id)).not.toContain(
        pos.body.data.id,
      );

      const patchB = await authPatch(tAdminB, `/hr/departments/${dep.body.data.id}`).send({
        name: "chiếm quyền",
      });
      expect(patchB.status, JSON.stringify(patchB.body)).toBe(404);

      // Cạnh đối chứng: cùng token B tạo được tài nguyên của CHÍNH nó ⇒ 404 ở trên là cô lập,
      // không phải route chết.
      const ownB = await authPost(tAdminB, "/org/positions").send({ name: `Riêng B ${uniq()}` });
      expect(ownB.status, JSON.stringify(ownB.body)).toBe(201);
    });
  },
);
