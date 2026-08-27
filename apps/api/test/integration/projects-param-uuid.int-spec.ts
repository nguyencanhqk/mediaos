/**
 * S10-FND-PARAMUUID-5 · lane **L2-PROJECT** (KI-078 đợt 4) — biên HTTP THẬT cho kênh **PARAM** của
 * DỰ ÁN + nhãn + cột pipeline (SPEC-06). **21 tham số / 3 controller**:
 *
 *   `tasks/projects.controller.ts`        13  GET/PATCH/DELETE :id · close · members(+:memberId) ·
 *                                             kanban · report · activity
 *   `tasks/labels.controller.ts`           4  GET/POST /projects/:projectId/labels · PATCH/DELETE /labels/:labelId
 *   `tasks/project-states.controller.ts`   4  GET/POST /projects/:projectId/states · PATCH/DELETE /states/:stateId
 *
 * ─── MỨC ĐỘ — PHÁT BIỂU TRƯỚC MỌI SỐ ĐO ─────────────────────────────────────────────────────────
 * Hỏng ĐÚNG CHIỀU AN TOÀN: `:id` rác vỡ `22P02` ⇒ **500**, request vẫn bị TỪ CHỐI ⇒ **KHÔNG phải lỗ
 * bảo mật**. Giá trị = hợp đồng API + hết 500 GIẢ trong giám sát.
 *
 * ─── RỦI RO RIÊNG: `projects` CÓ `project_code` BÊN CẠNH `id` ───────────────────────────────────
 * `createTaskProjectSchema` nhận `code` (mã dự án do người dùng đặt) và DTO trả về mang `code` —
 * đúng lớp tài nguyên mà FE RẤT dễ tra bằng MÃ thay vì uuid. Nếu `:id` thực ra nhận `project_code`
 * thì `ParseUUIDPipe` **CHẶN OAN** request hợp lệ, mà ca "UUID hợp lệ không tồn tại → 404" vẫn xanh.
 * Cùng lớp đã suýt dính ở `leave_types` (đợt 1), `job_levels`/`positions` (đợt 2), catalog NOTI (đợt 3).
 * ⇒ Loại khoá `project` BẮT BUỘC có ca ALLOW-2xx trên HÀNG THẬT
 * ([[deny-cases-vacuous-without-allow-case]]). `labels`/`project_states`/`project_members` cũng vậy.
 *
 * ─── CẤU TRÚC ĐO ────────────────────────────────────────────────────────────────────────────────
 * Mỗi tham số một dòng `CASES`, chạy HAI lần: `JUNK` → 400 ĐƠN TRỊ + neo `error.type`; `randomUUID()`
 * → oracle loại CẢ 400 VÀ 500. Route hai tham số (`:id/members/:memberId`) có MỘT dòng cho MỖI VẾ.
 *
 * ─── LUẬT ĐO ────────────────────────────────────────────────────────────────────────────────────
 * • Actor ĐÃ đăng nhập, KHÔNG super-admin, KHÔNG seed `*:*`. • Body HỢP LỆ mọi route ghi.
 * • KHÔNG gửi `Idempotency-Key`. • `is_sensitive` khớp catalog: `close`/`delete`/`manage-member`/
 *   `view-report`:project = **true** · `view:task-audit-log` = **true** · phần còn lại = false.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). DB phát triển: `mediaos_paramuuid5`.
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
const LOGIN_PW = loginPasswordFixture("s10paramuuid5l2");

const JUNK = "khong-phai-uuid";
const uniq = () => randomUUID().slice(0, 8);

interface ParamCase {
  readonly key: string;
  readonly name: string;
  readonly run: (bad: string) => request.Test;
}

describe.skipIf(!hasLaneDb)(
  "S10-FND-PARAMUUID-5 · L2-PROJECT — biên HTTP kênh PARAM của projects · labels · project-states (21 tham số)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];
    let token = "";
    let actorUserId = "";
    let orgUnitId = "";

    let projectId = "";
    let memberId = "";
    let labelId = "";
    let stateId = "";

    const http = () => request(app.getHttpServer());
    const auth = () => ({ Authorization: `Bearer ${token}` });
    const get = (u: string) => http().get(u).set(auth());
    const post = (u: string) => http().post(u).set(auth());
    const patch = (u: string) => http().patch(u).set(auth());
    const del = (u: string) => http().delete(u).set(auth());

    /** Dự án MỚI qua HTTP (`create:project`) — ca `close`/`DELETE` phải có dự án dùng-một-lần. */
    async function freshProject(): Promise<string> {
      const res = await post("/projects").send({ name: `Dự án ${uniq()}` });
      expect(res.status, `POST /projects: ${JSON.stringify(res.body)}`).toBe(201);
      return res.body.data.id as string;
    }

    /**
     * Nhân viên MỚI có TÀI KHOẢN và `status='active'` — `addMember` fail-loud 400 nếu thiếu account
     * (`project_members.user_id` NOT NULL, schema legacy) và 400 nếu status khác `active`.
     * Mỗi ca thêm-thành-viên cần một nhân viên RIÊNG: hai unique chống-trùng chặn thêm cùng người.
     */
    async function freshEmployee(): Promise<string> {
      const uid = await seedUser(direct, A.companyId, `mem-${uniq()}@s10pu5l2.local`);
      const r = await direct.query<{ id: string }>(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
         VALUES ($1, $2, $3, 'active') RETURNING id`,
        [A.companyId, uid, orgUnitId],
      );
      return r.rows[0].id;
    }

    async function freshMember(onProject: string): Promise<string> {
      const res = await post(`/projects/${onProject}/members`).send({
        employeeId: await freshEmployee(),
        projectRole: "Member",
      });
      expect(res.status, `POST members: ${JSON.stringify(res.body)}`).toBe(201);
      return res.body.data.id as string;
    }

    async function freshLabel(onProject: string): Promise<string> {
      const res = await post(`/projects/${onProject}/labels`).send({ name: `nhãn-${uniq()}` });
      expect(res.status, `POST labels: ${JSON.stringify(res.body)}`).toBe(201);
      return res.body.data.id as string;
    }

    async function freshState(onProject: string): Promise<string> {
      const res = await post(`/projects/${onProject}/states`).send({
        name: `Cột ${uniq()}`,
        stateGroup: "started",
        color: "#123456",
      });
      expect(res.status, `POST states: ${JSON.stringify(res.body)}`).toBe(201);
      return res.body.data.id as string;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10pu5l2");
      companyIds.push(A.companyId);

      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `prjadmin-${uniq()}@s10pu5l2.local`;
      actorUserId = await seedUser(direct, A.companyId, email, hash);

      const ou = await direct.query<{ id: string }>(
        `INSERT INTO org_units (company_id, name, type) VALUES ($1, $2, 'department') RETURNING id`,
        [A.companyId, `s10pu5l2-ou-${uniq()}`],
      );
      orgUnitId = ou.rows[0].id;
      // Hồ sơ nhân viên của CHÍNH actor: `ProjectsService.assertGovern` resolve `actorEmployeeId` để
      // ghi activity/audit — thiếu nó thì mọi route `manage-member` hỏng vì lý do KHÔNG liên quan tới
      // tham số. Id không cần giữ lại (thành viên thêm vào dự án là nhân viên KHÁC — `freshEmployee`).
      await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
         VALUES ($1, $2, $3, 'active')`,
        [A.companyId, actorUserId, orgUnitId],
      );

      const roleId = await seedRole(direct, A.companyId, `s10pu5l2-${uniq()}`);
      const pairs: Array<[string, string, boolean]> = [
        ["read", "project", false],
        ["create", "project", false],
        ["update", "project", false],
        ["close", "project", true],
        ["delete", "project", true],
        ["manage-member", "project", true],
        ["view-report", "project", true],
        ["view-kanban", "task", false],
        ["view", "task-audit-log", true],
        ["read", "label", false],
        ["create", "label", false],
        ["update", "label", false],
        ["delete", "label", false],
        ["read", "project_state", false],
        ["create", "project_state", false],
        ["update", "project_state", false],
        ["delete", "project_state", false],
      ];
      for (const [action, resourceType, sensitive] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resourceType, sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, actorUserId, roleId, A.companyId);

      const res = await http()
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      token = res.body.data.accessToken as string;

      projectId = await freshProject();
      memberId = await freshMember(projectId);
      labelId = await freshLabel(projectId);
      stateId = await freshState(projectId);
    }, 300_000);

    afterAll(async () => {
      await app?.close();
      if (companyIds.length > 0) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    function expectRejectedAtBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).toBe(400);
      expect(res.body.error?.type, body).not.toBe("ZodError");
      expect(res.body.error?.type, body).not.toBe("Error");
    }

    function expectPassedBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).not.toBe(400);
      expect(res.status, body).not.toBe(500);
    }

    function expectExact(res: request.Response, status: number): void {
      expect(res.status, JSON.stringify(res.body)).toBe(status);
    }

    const CASES: ParamCase[] = [
      // ── tasks/projects.controller.ts (13) ────────────────────────────────────────
      {
        key: "tasks/projects.controller.ts#getOne:id",
        name: "GET /projects/:id",
        run: (bad) => get(`/projects/${bad}`),
      },
      {
        key: "tasks/projects.controller.ts#update:id",
        name: "PATCH /projects/:id",
        run: (bad) => patch(`/projects/${bad}`).send({ name: `Đổi tên ${uniq()}` }),
      },
      {
        key: "tasks/projects.controller.ts#close:id",
        name: "POST /projects/:id/close",
        run: (bad) => post(`/projects/${bad}/close`).send({ note: "đóng" }),
      },
      {
        key: "tasks/projects.controller.ts#remove:id",
        name: "DELETE /projects/:id",
        run: (bad) => del(`/projects/${bad}`),
      },
      {
        key: "tasks/projects.controller.ts#listMembers:id",
        name: "GET /projects/:id/members",
        run: (bad) => get(`/projects/${bad}/members`),
      },
      {
        key: "tasks/projects.controller.ts#addMember:id",
        name: "POST /projects/:id/members",
        run: (bad) =>
          post(`/projects/${bad}/members`).send({
            employeeId: randomUUID(),
            projectRole: "Member",
          }),
      },
      {
        key: "tasks/projects.controller.ts#updateMember:id",
        name: "PATCH /projects/:id/members/:memberId — vế id",
        run: (bad) => patch(`/projects/${bad}/members/${memberId}`).send({ projectRole: "Viewer" }),
      },
      {
        key: "tasks/projects.controller.ts#updateMember:memberId",
        name: "PATCH /projects/:id/members/:memberId — vế memberId",
        run: (bad) =>
          patch(`/projects/${projectId}/members/${bad}`).send({ projectRole: "Viewer" }),
      },
      {
        key: "tasks/projects.controller.ts#removeMember:id",
        name: "DELETE /projects/:id/members/:memberId — vế id",
        run: (bad) => del(`/projects/${bad}/members/${memberId}`),
      },
      {
        key: "tasks/projects.controller.ts#removeMember:memberId",
        name: "DELETE /projects/:id/members/:memberId — vế memberId",
        run: (bad) => del(`/projects/${projectId}/members/${bad}`),
      },
      {
        key: "tasks/projects.controller.ts#getKanban:id",
        name: "GET /projects/:id/kanban",
        run: (bad) => get(`/projects/${bad}/kanban`),
      },
      {
        key: "tasks/projects.controller.ts#getReport:id",
        name: "GET /projects/:id/report",
        run: (bad) => get(`/projects/${bad}/report`),
      },
      {
        key: "tasks/projects.controller.ts#listActivity:id",
        name: "GET /projects/:id/activity",
        run: (bad) => get(`/projects/${bad}/activity`),
      },
      // ── tasks/labels.controller.ts (4) ───────────────────────────────────────────
      {
        key: "tasks/labels.controller.ts#listLabels:projectId",
        name: "GET /projects/:projectId/labels",
        run: (bad) => get(`/projects/${bad}/labels`),
      },
      {
        key: "tasks/labels.controller.ts#createLabel:projectId",
        name: "POST /projects/:projectId/labels",
        run: (bad) => post(`/projects/${bad}/labels`).send({ name: `nhãn-${uniq()}` }),
      },
      {
        key: "tasks/labels.controller.ts#updateLabel:labelId",
        name: "PATCH /labels/:labelId",
        run: (bad) => patch(`/labels/${bad}`).send({ name: `nhãn-${uniq()}` }),
      },
      {
        key: "tasks/labels.controller.ts#deleteLabel:labelId",
        name: "DELETE /labels/:labelId",
        run: (bad) => del(`/labels/${bad}`),
      },
      // ── tasks/project-states.controller.ts (4) ───────────────────────────────────
      {
        key: "tasks/project-states.controller.ts#listStates:projectId",
        name: "GET /projects/:projectId/states",
        run: (bad) => get(`/projects/${bad}/states`),
      },
      {
        key: "tasks/project-states.controller.ts#createState:projectId",
        name: "POST /projects/:projectId/states",
        run: (bad) =>
          post(`/projects/${bad}/states`).send({
            name: `Cột ${uniq()}`,
            stateGroup: "started",
            color: "#123456",
          }),
      },
      {
        key: "tasks/project-states.controller.ts#updateState:stateId",
        name: "PATCH /states/:stateId",
        run: (bad) => patch(`/states/${bad}`).send({ color: "#abcdef" }),
      },
      {
        key: "tasks/project-states.controller.ts#deleteState:stateId",
        name: "DELETE /states/:stateId",
        run: (bad) => del(`/states/${bad}`),
      },
    ];

    it("(0) BẢNG ĐO phủ ĐỦ 21 tham số của BA controller và không dòng nào TRÙNG KHOÁ", () => {
      // Neo chống xanh-RỖNG: bảng rỗng/thiếu dòng thì mọi ca dưới xanh vì KHÔNG CÓ GÌ để chạy.
      // Số lấy từ census AST (`param-uuid-census.ts`), không đếm tay.
      expect(CASES.length).toBe(21);
      expect(new Set(CASES.map((c) => c.key)).size, "có dòng TRÙNG KHOÁ trong bảng đo").toBe(21);
      const per = (f: string) => CASES.filter((c) => c.key.startsWith(`${f}#`)).length;
      expect(per("tasks/projects.controller.ts")).toBe(13);
      expect(per("tasks/labels.controller.ts")).toBe(4);
      expect(per("tasks/project-states.controller.ts")).toBe(4);
    });

    for (const c of CASES) {
      it(`PARAM · ${c.name} với giá trị rác → 400 ở BIÊN  [${c.key}]`, async () => {
        expectRejectedAtBoundary(await c.run(JUNK));
      });
    }

    for (const c of CASES) {
      it(`ALLOW · ${c.name} với UUID HỢP LỆ (không tồn tại) → KHÔNG 400, KHÔNG 500  [${c.key}]`, async () => {
        expectPassedBoundary(await c.run(randomUUID()));
      });
    }

    // ══ ALLOW-2xx TRÊN HÀNG THẬT — MỖI LOẠI KHOÁ MỘT CA ═════════════════════════════

    it("ALLOW-200 · GET /projects/:id trên DỰ ÁN THẬT — CHỨNG MINH `:id` là UUID, KHÔNG phải `project_code`", async () => {
      expectExact(await get(`/projects/${projectId}`), 200);
    });

    it("ALLOW-200 · PATCH /projects/:id trên DỰ ÁN THẬT", async () => {
      const p = await freshProject();
      expectExact(await patch(`/projects/${p}`).send({ name: `Đổi tên ${uniq()}` }), 200);
    });

    it("ALLOW-200 · POST /projects/:id/close trên DỰ ÁN THẬT (@HttpCode(200))", async () => {
      const p = await freshProject();
      expectExact(await post(`/projects/${p}/close`).send({ note: "hoàn tất" }), 200);
    });

    it("ALLOW-204 · DELETE /projects/:id trên DỰ ÁN THẬT (@HttpCode(204))", async () => {
      const p = await freshProject();
      expectExact(await del(`/projects/${p}`), 204);
    });

    it("ALLOW-200 · các route ĐỌC theo :id trên DỰ ÁN THẬT (members · kanban · report · activity)", async () => {
      for (const suffix of ["members", "kanban", "report", "activity"]) {
        expectExact(await get(`/projects/${projectId}/${suffix}`), 200);
      }
    });

    it("ALLOW-201 · POST /projects/:id/members trên DỰ ÁN THẬT + NHÂN VIÊN THẬT", async () => {
      const p = await freshProject();
      const res = await post(`/projects/${p}/members`).send({
        employeeId: await freshEmployee(),
        projectRole: "Member",
      });
      expectExact(res, 201);
    });

    it("ALLOW-200 · PATCH /projects/:id/members/:memberId trên THÀNH VIÊN THẬT (loại khoá member)", async () => {
      const p = await freshProject();
      const m = await freshMember(p);
      expectExact(await patch(`/projects/${p}/members/${m}`).send({ projectRole: "Viewer" }), 200);
    });

    it("ALLOW-204 · DELETE /projects/:id/members/:memberId trên THÀNH VIÊN THẬT (@HttpCode(204))", async () => {
      const p = await freshProject();
      const m = await freshMember(p);
      expectExact(await del(`/projects/${p}/members/${m}`), 204);
    });

    it("ALLOW-200/201 · nhãn: GET list + POST tạo trên DỰ ÁN THẬT (loại khoá label)", async () => {
      expectExact(await get(`/projects/${projectId}/labels`), 200);
      const res = await post(`/projects/${projectId}/labels`).send({ name: `nhãn-${uniq()}` });
      expectExact(res, 201);
    });

    it("ALLOW-200 · PATCH /labels/:labelId trên NHÃN THẬT", async () => {
      expectExact(await patch(`/labels/${labelId}`).send({ color: "#00ff00" }), 200);
    });

    it("ALLOW-204 · DELETE /labels/:labelId trên NHÃN THẬT (@HttpCode(204))", async () => {
      const l = await freshLabel(projectId);
      expectExact(await del(`/labels/${l}`), 204);
    });

    it("ALLOW-200/201 · cột: GET list + POST tạo trên DỰ ÁN THẬT (loại khoá project_state)", async () => {
      expectExact(await get(`/projects/${projectId}/states`), 200);
      const res = await post(`/projects/${projectId}/states`).send({
        name: `Cột ${uniq()}`,
        stateGroup: "unstarted",
        color: "#654321",
      });
      expectExact(res, 201);
    });

    it("ALLOW-200 · PATCH /states/:stateId trên CỘT THẬT", async () => {
      expectExact(await patch(`/states/${stateId}`).send({ color: "#abcdef" }), 200);
    });

    it("ALLOW-204 · DELETE /states/:stateId trên CỘT THẬT (@HttpCode(204))", async () => {
      const s = await freshState(projectId);
      expectExact(await del(`/states/${s}`), 204);
    });

    // ══ Hồi quy ĐỊNH TUYẾN — literal-sibling ════════════════════════════════════════
    /**
     * Liệt kê bằng ĐỌC FILE:
     *  · `projects.controller.ts` khai `@Get()` và `@Post()` TRẦN (gốc `/projects`) TRƯỚC `@Get(":id")`
     *    — `GET /projects` khác SỐ SEGMENT nên không bị nuốt, nhưng ghim để lần sắp xếp lại nào cũng đỏ.
     *  · `labels.controller.ts` / `project-states.controller.ts` dùng `@Controller()` TRẦN và khai
     *    đường dẫn ĐẦY ĐỦ (`projects/:projectId/labels`, `labels/:labelId`, `states/:stateId`) —
     *    KHÔNG nằm dưới prefix `projects` của `ProjectsController`. Ghim để việc gắn pipe không kéo
     *    theo ai đó "gom cho gọn" vào một controller và đổi thứ tự khớp route.
     */
    it("ĐỊNH TUYẾN · GET /projects (list) vẫn 200", async () => {
      expectExact(await get("/projects"), 200);
    });

    it("ĐỊNH TUYẾN · POST /projects (tạo) vẫn 201", async () => {
      expectExact(await post("/projects").send({ name: `Dự án định tuyến ${uniq()}` }), 201);
    });

    it("ĐỊNH TUYẾN · GET /projects/:id/labels và /states KHÔNG bị `:id/members` nuốt", async () => {
      expectExact(await get(`/projects/${projectId}/labels`), 200);
      expectExact(await get(`/projects/${projectId}/states`), 200);
    });
  },
);
