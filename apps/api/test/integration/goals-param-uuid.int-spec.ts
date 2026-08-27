/**
 * S10-FND-PARAMUUID-4 · lane **L1-GOAL** (KI-078 đợt 3) — biên HTTP THẬT cho kênh **PARAM** của mục
 * tiêu/OKR và danh mục mẫu công việc (SPEC-10). **21 tham số / 2 controller.**
 *
 *   GET    /goals/:id                         [GoalsController#getOne]      view:goal
 *   PATCH  /goals/:id                         [GoalsController#update]      update:goal
 *   DELETE /goals/:id                         [GoalsController#remove]      delete:goal      (204)
 *   POST   /goals/:id/check-in                [GoalsController#checkIn]     checkin:goal     (201)
 *   GET    /goals/:id/updates                 [GoalsController#updates]     view:goal
 *   POST   /goals/:id/finalize                [GoalsController#finalize]    finalize:goal    (201)
 *   POST   /goals/:id/reopen                  [GoalsController#reopen]      finalize:goal    (201)
 *   GET    /goals/:id/tasks                   [GoalsController#linkedTasks] view:goal + read:task
 *   POST   /goals/:id/tasks                   [GoalsController#linkTasks]   update:goal      (201)
 *   DELETE /goals/:id/tasks/:taskId           [GoalsController#unlinkTask]  update:goal      — HAI tham số
 *   POST   /goals/:id/decompose               [GoalsController#decompose]   update:goal      (201)
 *   GET|PATCH|DELETE /task-templates/:id      [TaskTemplatesController]     manage:task-template
 *   GET|POST   /task-templates/:templateId/items          [TaskTemplatesController]
 *   PATCH|DELETE /task-templates/:templateId/items/:itemId [TaskTemplatesController] — HAI tham số ×2
 *
 * ─── BỐN LOẠI KHOÁ, BỐN CA ALLOW TRÊN HÀNG THẬT ───────────────────────────────────────────────
 * `goals.id` · `tasks.id` · `task_templates.id` · `task_template_items.id`. Mỗi loại BẮT BUỘC có ca
 * ALLOW-2xx trên HÀNG THẬT: `goals` mang `goal_code` (SequenceService, counter seed 0506) bên cạnh
 * `id`, đúng lớp `leave_types` (đợt 1) / `job_levels` (đợt 2) — nếu `:id` thực ra nhận MÃ thì
 * `ParseUUIDPipe` **CHẶN OAN** request hợp lệ mà ca "UUID hợp lệ không tồn tại → 404" vẫn xanh
 * ([[deny-cases-vacuous-without-allow-case]]).
 *
 * ─── FSM CỦA MỤC TIÊU QUYẾT ĐỊNH HÌNH DẠNG FIXTURE ────────────────────────────────────────────
 * `goal-checkin.service.ts`: check-in đòi `status='Active'` (:74) · finalize đòi
 * `status ∈ {Active, Completed}` + CHƯA chốt (:158,:168) · reopen đòi ĐÃ chốt `finalized_at` (:210).
 * ⇒ ba trạng thái fixture khác nhau, và MỖI ca ALLOW ghi-trạng-thái dùng một hàng RIÊNG: dùng lại một
 * hàng thì ca sau rơi 422 rồi bị "chữa" bằng nới assert.
 *
 * ─── MỨC ĐỘ — PHÁT BIỂU TRƯỚC MỌI SỐ ĐO ─────────────────────────────────────────────────────────
 * Hỏng ĐÚNG CHIỀU AN TOÀN: `:id` rác vỡ `22P02` ở Postgres ⇒ **500**, request vẫn bị TỪ CHỐI
 * ⇒ **KHÔNG phải lỗ bảo mật**. Giá trị = hợp đồng API + hết 500 GIẢ trong giám sát.
 *
 * ─── LUẬT ĐO ──────────────────────────────────────────────────────────────────────────────────
 * • Actor ĐÃ đăng nhập (guard chạy TRƯỚC pipe), KHÔNG super-admin, KHÔNG seed `*:*`.
 * • Body HỢP LỆ cho mọi route ghi — 400-do-body là số đo GIẢ.
 * • KHÔNG gửi `Idempotency-Key`.
 * • DENY = **400 ĐƠN TRỊ** + neo `error.type ∉ {Error, ZodError}`; ALLOW loại CẢ 400 VÀ 500.
 * • Ba route HAI tham số id-like ⇒ đo RIÊNG TỪNG VẾ (rác ở vế này, HỢP LỆ ở vế kia).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). DB phát triển: `mediaos_paramuuid4`.
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
const LOGIN_PW = loginPasswordFixture("s10paramuuid4l1");

const JUNK = "khong-phai-uuid";

describe.skipIf(!hasLaneDb)(
  "S10-FND-PARAMUUID-4 · L1-GOAL — biên HTTP kênh PARAM của goals · task-templates",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];
    let token = "";
    let actorUserId = "";
    let ownerEmployeeId = "";
    let orgUnitId = "";

    const http = () => request(app.getHttpServer());
    const auth = () => ({ Authorization: `Bearer ${token}` });

    const uniq = () => randomUUID().slice(0, 8);

    /**
     * Mục tiêu cấp PHÒNG BAN. `finalizedAt` tách riêng cho ca `reopen`.
     *
     * ⚠️ KHÔNG dùng `level='company'`: cấp đó bị CHẶN ở MVP (`goals.errors.ts:18-20` GOAL-ERR-004
     * "chưa mở ở phiên bản này") — `PATCH /goals/:id` re-validate toàn bộ trạng thái sau merge nên ca
     * ALLOW sẽ đo được **422**, một số đo KHÔNG liên quan gì tới tham số. Cũng KHÔNG dùng
     * `level='employee'`: phân rã có nhánh 422 GOAL-ERR-008 riêng cho mục tiêu cá nhân khi assignee lệch.
     *
     * `chk_goals_level_anchor` đòi `level='department'` đi kèm `department_id` NOT NULL và
     * `project_id`/`employee_id` NULL.
     */
    async function seedGoal(opts: { status?: string; finalized?: boolean } = {}): Promise<string> {
      const status = opts.status ?? "Active";
      const r = await direct.query(
        `INSERT INTO goals
           (company_id, goal_code, name, level, department_id, owner_employee_id,
            period_type, period_start, period_end, measure_type, progress_mode, status, finalized_at)
         VALUES ($1, $2, $3, 'department', $4, $5,
            'year', '2031-01-01'::date, '2031-12-31'::date, 'percent', 'manual', $6,
            CASE WHEN $7::boolean THEN now() ELSE NULL END)
         RETURNING id`,
        [
          A.companyId,
          `GOAL-S10PU4-${uniq()}`,
          `goal-${uniq()}`,
          orgUnitId,
          ownerEmployeeId,
          status,
          opts.finalized ?? false,
        ],
      );
      return r.rows[0].id as string;
    }

    /** `tasks` — loại khoá của vế `:taskId`. `goalId` khác NULL = đã GẮN vào mục tiêu đó. */
    async function seedTask(goalId: string | null = null): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, title, goal_id) VALUES ($1, $2, $3) RETURNING id`,
        [A.companyId, `task-${uniq()}`, goalId],
      );
      return r.rows[0].id as string;
    }

    async function seedTemplate(): Promise<string> {
      const r = await direct.query(
        `INSERT INTO task_templates (company_id, name, is_active) VALUES ($1, $2, true) RETURNING id`,
        [A.companyId, `tpl-${uniq()}`],
      );
      return r.rows[0].id as string;
    }

    async function seedTemplateItem(templateId: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO task_template_items (company_id, template_id, title, sort_order)
         VALUES ($1, $2, $3, 0) RETURNING id`,
        [A.companyId, templateId, `item-${uniq()}`],
      );
      return r.rows[0].id as string;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10pu4l1");
      companyIds.push(A.companyId);

      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `goaladmin-${uniq()}@s10pu4l1.local`;
      actorUserId = await seedUser(direct, A.companyId, email, hash);

      const emp = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2) RETURNING id`,
        [A.companyId, actorUserId],
      );
      ownerEmployeeId = emp.rows[0].id as string;

      // ⚠️ `org_units.type` là CHỮ THƯỜNG — viết hoa 'Department' vỡ CHECK (bẫy đã dính ở đợt 2).
      const ou = await direct.query(
        `INSERT INTO org_units (company_id, name, type, status)
         VALUES ($1, $2, 'department', 'active') RETURNING id`,
        [A.companyId, `unit-${uniq()}`],
      );
      orgUnitId = ou.rows[0].id as string;

      const roleId = await seedRole(direct, A.companyId, `s10pu4l1-${uniq()}`);
      // Mọi cặp dưới đây `is_sensitive=false` trong catalog — seedPermissionCatalog DỪNG nếu lệch.
      // `access:goal` là cổng MODULE; `update`/`update-state`/`create`/`read` trên `task` là cổng THỨ HAI
      // mà service của gắn-task/phân-rã gọi (KHÔNG khai ở @RequirePermission của route).
      const pairs: Array<[string, string]> = [
        ["access", "goal"],
        ["view", "goal"],
        ["create", "goal"],
        ["update", "goal"],
        ["delete", "goal"],
        ["checkin", "goal"],
        ["finalize", "goal"],
        ["manage", "task-template"],
        ["read", "task"],
        ["create", "task"],
        ["update", "task"],
        ["update-state", "task"],
      ];
      for (const [action, resourceType] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resourceType, false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, actorUserId, roleId, A.companyId);

      const res = await http()
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      token = res.body.data.accessToken as string;
    }, 180_000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app?.close();
    });

    function expectRejectedAtBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).toBe(400);
      expect(res.body.error?.type, body).not.toBe("ZodError");
      expect(res.body.error?.type, body).not.toBe("Error");
    }

    function expectPassedBoundary(res: request.Response, expectedStatus: number): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).not.toBe(400);
      expect(res.status, body).not.toBe(500);
      expect(res.status, body).toBe(expectedStatus);
    }

    // ══ GOALS — CRUD ════════════════════════════════════════════════════════════════
    it("PARAM · GET /goals/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().get(`/goals/${JUNK}`).set(auth()));
    });

    it("ALLOW · GET /goals/:id UUID hợp lệ (không tồn tại) → 404 đơn trị", async () => {
      expectPassedBoundary(await http().get(`/goals/${randomUUID()}`).set(auth()), 404);
    });

    it("ALLOW-200 · GET /goals/:id trên HÀNG THẬT — CHỨNG MINH `:id` là UUID, KHÔNG phải `goal_code`", async () => {
      const id = await seedGoal();
      const res = await http().get(`/goals/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("PARAM · PATCH /goals/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http()
          .patch(`/goals/${JUNK}`)
          .set(auth())
          .send({ name: `g-${uniq()}` }),
      );
    });

    it("ALLOW-200 · PATCH /goals/:id trên HÀNG THẬT", async () => {
      const id = await seedGoal();
      const res = await http()
        .patch(`/goals/${id}`)
        .set(auth())
        .send({ name: `g-${uniq()}` });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("PARAM · DELETE /goals/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().delete(`/goals/${JUNK}`).set(auth()));
    });

    it("ALLOW-204 · DELETE /goals/:id trên HÀNG THẬT (@HttpCode(204))", async () => {
      const id = await seedGoal();
      const res = await http().delete(`/goals/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    });

    // ══ GOALS — vòng đo (check-in · sổ · chốt kỳ · mở lại) ══════════════════════════
    it("PARAM · POST /goals/:id/check-in với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http()
          .post(`/goals/${JUNK}/check-in`)
          .set(auth())
          .send({ note: `n-${uniq()}` }),
      );
    });

    it("ALLOW-201 · POST /goals/:id/check-in trên HÀNG THẬT (status Active)", async () => {
      const id = await seedGoal({ status: "Active" });
      const res = await http()
        .post(`/goals/${id}/check-in`)
        .set(auth())
        .send({ note: `n-${uniq()}` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    it("PARAM · GET /goals/:id/updates với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().get(`/goals/${JUNK}/updates`).set(auth()));
    });

    it("ALLOW-200 · GET /goals/:id/updates trên HÀNG THẬT", async () => {
      const id = await seedGoal();
      const res = await http().get(`/goals/${id}/updates`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("PARAM · POST /goals/:id/finalize với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http()
          .post(`/goals/${JUNK}/finalize`)
          .set(auth())
          .send({ note: `n-${uniq()}` }),
      );
    });

    it("ALLOW-201 · POST /goals/:id/finalize trên HÀNG THẬT (Active, CHƯA chốt)", async () => {
      const id = await seedGoal({ status: "Active" });
      const res = await http()
        .post(`/goals/${id}/finalize`)
        .set(auth())
        .send({ note: `n-${uniq()}` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    it("PARAM · POST /goals/:id/reopen với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http()
          .post(`/goals/${JUNK}/reopen`)
          .set(auth())
          .send({ note: `n-${uniq()}` }),
      );
    });

    it("ALLOW-201 · POST /goals/:id/reopen trên HÀNG THẬT (ĐÃ chốt — `finalized_at` khác NULL)", async () => {
      const id = await seedGoal({ status: "Completed", finalized: true });
      const res = await http()
        .post(`/goals/${id}/reopen`)
        .set(auth())
        .send({ note: `n-${uniq()}` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    // ══ GOALS — gắn/tháo task ═══════════════════════════════════════════════════════
    it("PARAM · GET /goals/:id/tasks với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().get(`/goals/${JUNK}/tasks`).set(auth()));
    });

    it("ALLOW-200 · GET /goals/:id/tasks trên HÀNG THẬT", async () => {
      const id = await seedGoal();
      const res = await http().get(`/goals/${id}/tasks`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("PARAM · POST /goals/:id/tasks với :id rác → 400 ở BIÊN", async () => {
      // `taskIds` là UUID THẬT ⇒ 400 quan sát được KHÔNG thể đến từ body-pipe.
      const taskId = await seedTask();
      expectRejectedAtBoundary(
        await http()
          .post(`/goals/${JUNK}/tasks`)
          .set(auth())
          .send({ taskIds: [taskId] }),
      );
    });

    it("ALLOW-201 · POST /goals/:id/tasks trên HÀNG THẬT", async () => {
      const id = await seedGoal();
      const taskId = await seedTask();
      const res = await http()
        .post(`/goals/${id}/tasks`)
        .set(auth())
        .send({ taskIds: [taskId] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    // ── HAI tham số id-like: đo RIÊNG từng vế ──────────────────────────────────────
    it("PARAM · unlinkTask với :id rác (:taskId HỢP LỆ) → 400 ở BIÊN", async () => {
      const taskId = await seedTask();
      expectRejectedAtBoundary(await http().delete(`/goals/${JUNK}/tasks/${taskId}`).set(auth()));
    });

    it("PARAM · unlinkTask với :taskId rác (:id HỢP LỆ) → 400 ở BIÊN", async () => {
      const goalId = await seedGoal();
      expectRejectedAtBoundary(await http().delete(`/goals/${goalId}/tasks/${JUNK}`).set(auth()));
    });

    it("ALLOW-200 · unlinkTask trên HÀNG THẬT (loại khoá tasks — task ĐANG gắn vào mục tiêu)", async () => {
      const goalId = await seedGoal();
      const taskId = await seedTask(goalId);
      const res = await http().delete(`/goals/${goalId}/tasks/${taskId}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ══ GOALS — phân rã từ template ═════════════════════════════════════════════════
    it("PARAM · POST /goals/:id/decompose với :id rác → 400 ở BIÊN", async () => {
      // `templateId` là UUID THẬT + `items` hợp lệ ⇒ 400 KHÔNG thể đến từ body-pipe.
      const templateId = await seedTemplate();
      expectRejectedAtBoundary(
        await http()
          .post(`/goals/${JUNK}/decompose`)
          .set(auth())
          .send({ templateId, items: [{ title: `t-${uniq()}` }] }),
      );
    });

    it("ALLOW-201 · POST /goals/:id/decompose trên HÀNG THẬT", async () => {
      const id = await seedGoal();
      const templateId = await seedTemplate();
      const res = await http()
        .post(`/goals/${id}/decompose`)
        .set(auth())
        .send({ templateId, items: [{ title: `t-${uniq()}` }] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    // ══ TASK TEMPLATES — header ═════════════════════════════════════════════════════
    it("PARAM · GET /task-templates/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().get(`/task-templates/${JUNK}`).set(auth()));
    });

    it("ALLOW-200 · GET /task-templates/:id trên HÀNG THẬT (loại khoá task_templates)", async () => {
      const id = await seedTemplate();
      const res = await http().get(`/task-templates/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("PARAM · PATCH /task-templates/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http()
          .patch(`/task-templates/${JUNK}`)
          .set(auth())
          .send({ name: `tpl-${uniq()}` }),
      );
    });

    it("ALLOW-200 · PATCH /task-templates/:id trên HÀNG THẬT", async () => {
      const id = await seedTemplate();
      const res = await http()
        .patch(`/task-templates/${id}`)
        .set(auth())
        .send({ name: `tpl-${uniq()}` });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("PARAM · DELETE /task-templates/:id với :id rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().delete(`/task-templates/${JUNK}`).set(auth()));
    });

    it("ALLOW-204 · DELETE /task-templates/:id trên HÀNG THẬT (@HttpCode(204))", async () => {
      const id = await seedTemplate();
      const res = await http().delete(`/task-templates/${id}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    });

    // ══ TASK TEMPLATES — items (lồng dưới `:templateId`) ════════════════════════════
    it("PARAM · GET /task-templates/:templateId/items với :templateId rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(await http().get(`/task-templates/${JUNK}/items`).set(auth()));
    });

    it("ALLOW-200 · GET /task-templates/:templateId/items trên HÀNG THẬT", async () => {
      const templateId = await seedTemplate();
      const res = await http().get(`/task-templates/${templateId}/items`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("PARAM · POST /task-templates/:templateId/items với :templateId rác → 400 ở BIÊN", async () => {
      expectRejectedAtBoundary(
        await http()
          .post(`/task-templates/${JUNK}/items`)
          .set(auth())
          .send({ title: `item-${uniq()}` }),
      );
    });

    it("ALLOW-201 · POST /task-templates/:templateId/items trên HÀNG THẬT", async () => {
      const templateId = await seedTemplate();
      const res = await http()
        .post(`/task-templates/${templateId}/items`)
        .set(auth())
        .send({ title: `item-${uniq()}` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    // ── HAI tham số id-like ×2: đo RIÊNG từng vế ──────────────────────────────────
    it("PARAM · updateItem với :templateId rác (:itemId HỢP LỆ) → 400 ở BIÊN", async () => {
      const templateId = await seedTemplate();
      const itemId = await seedTemplateItem(templateId);
      expectRejectedAtBoundary(
        await http()
          .patch(`/task-templates/${JUNK}/items/${itemId}`)
          .set(auth())
          .send({ title: `item-${uniq()}` }),
      );
    });

    it("PARAM · updateItem với :itemId rác (:templateId HỢP LỆ) → 400 ở BIÊN", async () => {
      const templateId = await seedTemplate();
      expectRejectedAtBoundary(
        await http()
          .patch(`/task-templates/${templateId}/items/${JUNK}`)
          .set(auth())
          .send({ title: `item-${uniq()}` }),
      );
    });

    it("ALLOW-200 · updateItem trên HÀNG THẬT (loại khoá task_template_items)", async () => {
      const templateId = await seedTemplate();
      const itemId = await seedTemplateItem(templateId);
      const res = await http()
        .patch(`/task-templates/${templateId}/items/${itemId}`)
        .set(auth())
        .send({ title: `item-${uniq()}` });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("PARAM · removeItem với :templateId rác (:itemId HỢP LỆ) → 400 ở BIÊN", async () => {
      const templateId = await seedTemplate();
      const itemId = await seedTemplateItem(templateId);
      expectRejectedAtBoundary(
        await http().delete(`/task-templates/${JUNK}/items/${itemId}`).set(auth()),
      );
    });

    it("PARAM · removeItem với :itemId rác (:templateId HỢP LỆ) → 400 ở BIÊN", async () => {
      const templateId = await seedTemplate();
      expectRejectedAtBoundary(
        await http().delete(`/task-templates/${templateId}/items/${JUNK}`).set(auth()),
      );
    });

    it("ALLOW-204 · removeItem trên HÀNG THẬT (@HttpCode(204))", async () => {
      const templateId = await seedTemplate();
      const itemId = await seedTemplateItem(templateId);
      const res = await http().delete(`/task-templates/${templateId}/items/${itemId}`).set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(204);
    });

    // ══ Hồi quy ĐỊNH TUYẾN — literal-sibling ════════════════════════════════════════
    /**
     * Liệt kê bằng ĐỌC FILE: `goals.controller.ts` khai `@Get("tree")` (:71) TRƯỚC `@Get(":id")` (:87)
     * — `tree` là MỘT segment nên nó KHỚP `:id`, chỉ thứ tự khai báo cứu nó. `task-templates.controller.ts`
     * khai `@Get()` (:51) và `@Post()` (:67) gốc, không có route tĩnh một-segment nào khác.
     */
    it("ĐỊNH TUYẾN · GET /goals/tree vẫn 200 sau khi gắn pipe cho goals/:id", async () => {
      const res = await http().get("/goals/tree").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ĐỊNH TUYẾN · GET /goals (danh sách) vẫn 200", async () => {
      const res = await http().get("/goals").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ĐỊNH TUYẾN · GET /task-templates (danh sách) vẫn 200", async () => {
      const res = await http().get("/task-templates").set(auth());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  },
);
