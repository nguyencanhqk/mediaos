/**
 * S10-FND-PARAMUUID-5 · lane **L1-TASKCORE** (KI-078 đợt 4, CUỐI trong phạm vi) — biên HTTP THẬT cho
 * kênh **PARAM** của Task Hub (SPEC-06). **43 tham số / 1 controller** (`tasks/tasks.controller.ts`).
 *
 * Đây là module RỦI RO NHẤT còn lại của KI-078 và cũng là module ĐÔNG tham số nhất: 43 trong tổng 75
 * chỗ còn nợ. Ba đợt trước (`leave`/`attendance`/`approval` · HR/tổ chức · goals/foundation/noti) đã
 * khép mọi prefix khác; sau đợt này nợ THẬT trong phạm vi về 0.
 *
 * ─── MỨC ĐỘ — PHÁT BIỂU TRƯỚC MỌI SỐ ĐO ─────────────────────────────────────────────────────────
 * Hỏng ĐÚNG CHIỀU AN TOÀN: `:taskId` rác vỡ `22P02` ở Postgres ⇒ **500 SYSTEM-ERR-001**, request vẫn
 * bị TỪ CHỐI, không hàng nào rò ⇒ **KHÔNG phải lỗ bảo mật**. Giá trị của bản vá là (a) hợp đồng API —
 * client nhận 400 có mã thay vì 500 vô nghĩa; (b) chấm dứt 500 GIẢ bơm vào giám sát.
 *
 * ─── CẤU TRÚC ĐO: MỘT BẢNG, HAI ORACLE ──────────────────────────────────────────────────────────
 * Mỗi tham số là MỘT dòng trong `CASES`, và mỗi dòng chạy HAI lần với hai giá trị thay vào ĐÚNG vị
 * trí đang đo:
 *   · `JUNK` (chuỗi không phải UUID)  → **400 ĐƠN TRỊ** + neo `error.type ∉ {Error, ZodError}`.
 *   · `randomUUID()` (UUID hợp lệ, không tồn tại) → oracle loại **CẢ 400 VÀ 500**.
 * Vế thứ hai là thứ chặn "vá quá tay": nếu ai đó siết biên đến mức UUID HỢP LỆ cũng bị 400 thì ca
 * DENY vẫn xanh còn ca này đỏ. Route HAI/BA tham số id-like có MỘT dòng cho MỖI VẾ — rác ở vế đang
 * đo, HÀNG THẬT ở các vế còn lại — vì đo một vế rồi ký cả hai dòng verdict là ký cho chỗ chưa đo.
 *
 * Bên cạnh đó là ca **ALLOW-2xx trên HÀNG THẬT cho MỖI LOẠI KHOÁ** được vá (task · project · team ·
 * label · comment · watcher · checklist · checklist-item). Đó là vế DUY NHẤT phân biệt "pipe chặn
 * rác" với "pipe chặn OAN request hợp lệ": nếu một `:id` nào đó thực ra nhận MÃ NGHIỆP VỤ chứ không
 * phải uuid thì ca "UUID hợp lệ → 404" vẫn xanh ([[deny-cases-vacuous-without-allow-case]]).
 *
 * ─── LUẬT ĐO ────────────────────────────────────────────────────────────────────────────────────
 * • Actor ĐÃ đăng nhập (guard chạy TRƯỚC pipe), KHÔNG super-admin, KHÔNG seed `*:*`.
 * • Body HỢP LỆ cho mọi route ghi — 400-do-body là số đo GIẢ.
 * • KHÔNG gửi `Idempotency-Key` (interceptor chạy TRƯỚC pipe; `POST /tasks` có `@Idempotent()`).
 * • Mọi cặp quyền seed với `is_sensitive` ĐÚNG catalog (`delete:task` = true ·
 *   `view:task-audit-log` = true · phần còn lại = false) — `seedPermissionCatalog` DỪNG nếu lệch.
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
const LOGIN_PW = loginPasswordFixture("s10paramuuid5l1");

/** Giá trị KHÔNG phải UUID dùng chung mọi ca — một hình dạng, để so sánh giữa các route có nghĩa. */
const JUNK = "khong-phai-uuid";

const uniq = () => randomUUID().slice(0, 8);

/**
 * Một tham số id-like đang đo. `key` = khoá sổ phán quyết `file#handler:param` (`param-uuid-census.ts`
 * `siteKey`) — cố ý in vào TÊN ca test để khi ca đỏ, người đọc biết ngay dòng verdict nào đang nói dối.
 */
interface ParamCase {
  readonly key: string;
  readonly name: string;
  /** `bad` được thay vào ĐÚNG vị trí đang đo; mọi vị trí khác dùng HÀNG THẬT. */
  readonly run: (bad: string) => request.Test;
}

describe.skipIf(!hasLaneDb)(
  "S10-FND-PARAMUUID-5 · L1-TASKCORE — biên HTTP kênh PARAM của tasks.controller.ts (43 tham số)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];
    let token = "";
    let actorUserId = "";
    let employeeId = "";
    let orgUnitId = "";

    // Hàng THẬT dùng làm vế "hợp lệ" của các route nhiều tham số. Không bao giờ bị xoá trong file này.
    let projectId = "";
    let teamId = "";
    let taskId = "";
    let labelId = "";
    let commentId = "";
    let checklistId = "";
    let itemId = "";
    let watcherId = "";
    let stateId = "";

    const http = () => request(app.getHttpServer());
    const auth = () => ({ Authorization: `Bearer ${token}` });
    const get = (u: string) => http().get(u).set(auth());
    const post = (u: string) => http().post(u).set(auth());
    const patch = (u: string) => http().patch(u).set(auth());
    const del = (u: string) => http().delete(u).set(auth());

    /** Task MỚI cho mỗi ca ALLOW làm-đổi-trạng-thái — dùng lại một task là ca sau đo thứ khác. */
    async function freshTask(): Promise<string> {
      const res = await post("/tasks").send({ title: `Việc ${uniq()}`, projectId });
      expect(res.status, `POST /tasks: ${JSON.stringify(res.body)}`).toBe(201);
      return res.body.data.id as string;
    }

    async function freshChecklist(onTask: string): Promise<string> {
      const res = await post(`/tasks/${onTask}/checklists`).send({ title: `Mục kiểm ${uniq()}` });
      expect(res.status, `POST checklists: ${JSON.stringify(res.body)}`).toBe(201);
      return res.body.data.id as string;
    }

    async function freshChecklistItem(onTask: string, onChecklist: string): Promise<string> {
      const res = await post(`/tasks/${onTask}/checklists/${onChecklist}/items`).send({
        title: `Dòng ${uniq()}`,
      });
      expect(res.status, `POST items: ${JSON.stringify(res.body)}`).toBe(201);
      return res.body.data.id as string;
    }

    async function freshComment(onTask: string): Promise<string> {
      const res = await post(`/tasks/${onTask}/comments`).send({ content: `Bình luận ${uniq()}` });
      expect(res.status, `POST comments: ${JSON.stringify(res.body)}`).toBe(201);
      return res.body.data.id as string;
    }

    async function freshLabel(): Promise<string> {
      const res = await post(`/projects/${projectId}/labels`).send({ name: `nhãn-${uniq()}` });
      expect(res.status, `POST labels: ${JSON.stringify(res.body)}`).toBe(201);
      return res.body.data.id as string;
    }

    /** Watcher CỦA CHÍNH actor trên `onTask` (self-only MVP) — trả id hàng watcher đọc lại được. */
    async function freshWatcher(onTask: string): Promise<string> {
      const added = await post(`/tasks/${onTask}/watchers`).send({});
      expect(added.status, `POST watchers: ${JSON.stringify(added.body)}`).toBeLessThan(300);
      const list = await get(`/tasks/${onTask}/watchers`);
      expect(list.status, `GET watchers: ${JSON.stringify(list.body)}`).toBe(200);
      const rows = list.body.data as Array<{ id: string; employeeId: string }>;
      const mine = rows.find((w) => w.employeeId === employeeId);
      expect(mine, `không thấy watcher của actor trong ${JSON.stringify(rows)}`).toBeTruthy();
      return (mine as { id: string }).id;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      // Mirror main.ts: Zod validate ở BIÊN → envelope → filter. Thiếu một lớp thì mọi kết luận về
      // "400 hay 500" đều đo một stack KHÁC với PROD.
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10pu5l1");
      companyIds.push(A.companyId);

      // `seedCompany()` chỉ INSERT một hàng `companies` — KHÔNG chạy bootstrap công ty, nên
      // `sequence_counters` rỗng và `POST /tasks` sẽ chết ở SequenceService (500) vì THIẾU FIXTURE,
      // không phải vì sản phẩm hỏng. Gieo tường minh (khuôn `routehttp3-tasks-goals.int-spec.ts`).
      await direct.query(
        `INSERT INTO sequence_counters
           (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
            reset_policy, increment_by, current_value, status)
         VALUES ($1,'TASK','task','Company','TSK-',4,'Never',1,0,'Active')
         ON CONFLICT DO NOTHING`,
        [A.companyId],
      );

      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `taskadmin-${uniq()}@s10pu5l1.local`;
      actorUserId = await seedUser(direct, A.companyId, email, hash);

      const ou = await direct.query<{ id: string }>(
        `INSERT INTO org_units (company_id, name, type) VALUES ($1, $2, 'department') RETURNING id`,
        [A.companyId, `s10pu5l1-ou-${uniq()}`],
      );
      orgUnitId = ou.rows[0].id;
      const emp = await direct.query<{ id: string }>(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
         VALUES ($1, $2, $3, 'active') RETURNING id`,
        [A.companyId, actorUserId, orgUnitId],
      );
      employeeId = emp.rows[0].id;

      const roleId = await seedRole(direct, A.companyId, `s10pu5l1-${uniq()}`);
      // `is_sensitive` PHẢI khớp catalog — seedPermissionCatalog DỪNG nếu lệch (đọc từ lane DB).
      const pairs: Array<[string, string, boolean]> = [
        ["read", "task", false],
        ["create", "task", false],
        ["update", "task", false],
        ["delete", "task", true],
        ["comment", "task", false],
        ["assign", "task", false],
        ["update-status", "task", false],
        ["update-state", "task", false],
        ["update-priority", "task", false],
        ["update-deadline", "task", false],
        ["watch", "task", false],
        ["view", "task-audit-log", true],
        // Nhãn + cột pipeline: KHÔNG phải route đang đo, nhưng là NGUYÊN LIỆU của vế "hàng thật"
        // (`:labelId` và body `stateId`). Thiếu grant thì fixture 403 và mọi ca dưới đo nhầm thứ khác.
        ["read", "label", false],
        ["create", "label", false],
        ["read", "project_state", false],
        ["create", "project_state", false],
        ["read", "project", false],
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

      const prj = await direct.query<{ id: string }>(
        `INSERT INTO projects (company_id, name, status, department_id, owner_employee_id)
         VALUES ($1, $2, 'active', $3, $4) RETURNING id`,
        [A.companyId, `s10pu5l1-prj-${uniq()}`, orgUnitId, employeeId],
      );
      projectId = prj.rows[0].id;

      const tm = await direct.query<{ id: string }>(
        `INSERT INTO teams (company_id, name, org_unit_id) VALUES ($1, $2, $3) RETURNING id`,
        [A.companyId, `s10pu5l1-team-${uniq()}`, orgUnitId],
      );
      teamId = tm.rows[0].id;
      // ⚠️ `TasksRepository.teamExistsTx` KHÔNG tra bảng `teams` — nó tra `team_members`. Một team
      // KHÔNG có thành viên nào đọc ra "Team not found" (404), và ca ALLOW-2xx sẽ đỏ vì lý do KHÔNG
      // liên quan tới tham số. Gieo một thành viên THẬT để team "tồn tại" theo đúng nghĩa của route.
      await direct.query(
        `INSERT INTO team_members (company_id, team_id, user_id) VALUES ($1, $2, $3)`,
        [A.companyId, teamId, actorUserId],
      );

      const st = await post(`/projects/${projectId}/states`).send({
        name: `Cột ${uniq()}`,
        stateGroup: "started",
        color: "#123456",
      });
      expect(st.status, `POST states: ${JSON.stringify(st.body)}`).toBe(201);
      stateId = st.body.data.id as string;

      taskId = await freshTask();
      labelId = await freshLabel();
      commentId = await freshComment(taskId);
      checklistId = await freshChecklist(taskId);
      itemId = await freshChecklistItem(taskId, checklistId);
      watcherId = await freshWatcher(taskId);
    }, 300_000);

    afterAll(async () => {
      await app?.close();
      if (companyIds.length > 0) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    /**
     * Oracle DENY: tham số rác phải bị chặn ở BIÊN bằng 400, và KHÔNG mang hiện vật của đường 500 cũ.
     *
     * ⚠️ `error.type` là hiện vật phân biệt: `'Error'` (lỗi PG `22P02` lọt tới DB) hoặc `'ZodError'`
     * (schema ném thô) đều là dấu của đường 500. Neo theo hiện vật chứ không chỉ theo status: nếu một
     * ngày ai đó map `22P02` thành 400 ở filter thì status xanh mà lỗ vẫn nguyên vị trí.
     *
     * ⚠️ NGƯỠNG CHỐNG NỚI: assert ở lại `400` ĐƠN TRỊ. `expect([400, 500]).toContain(...)` là mở lại
     * lỗ trong khi sổ ghi ĐÓNG ([[tests-can-pin-a-hole-open]]).
     */
    function expectRejectedAtBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).toBe(400);
      expect(res.body.error?.type, body).not.toBe("ZodError");
      expect(res.body.error?.type, body).not.toBe("Error");
    }

    /** Oracle ALLOW mềm: UUID HỢP LỆ không được chạm biên (400) và không được nổ (500). */
    function expectPassedBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).not.toBe(400);
      expect(res.status, body).not.toBe(500);
    }

    /** Oracle ALLOW cứng: hàng THẬT phải cho ĐÚNG mã 2xx đo được (không phải "bất kỳ 2xx"). */
    function expectExact(res: request.Response, status: number): void {
      expect(res.status, JSON.stringify(res.body)).toBe(status);
    }

    const isoInDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

    /**
     * 43 tham số id-like của `tasks/tasks.controller.ts` — thứ tự theo file. `bad` luôn nằm ĐÚNG một
     * vị trí; các vị trí còn lại dùng hàng THẬT gieo ở `beforeAll`.
     */
    const CASES: ParamCase[] = [
      {
        key: "tasks/tasks.controller.ts#getProjectTasks:projectId",
        name: "GET /tasks/by-project/:projectId",
        run: (bad) => get(`/tasks/by-project/${bad}`),
      },
      {
        key: "tasks/tasks.controller.ts#getTeamTasks:teamId",
        name: "GET /tasks/by-team/:teamId",
        run: (bad) => get(`/tasks/by-team/${bad}`),
      },
      {
        key: "tasks/tasks.controller.ts#getTask:taskId",
        name: "GET /tasks/:taskId",
        run: (bad) => get(`/tasks/${bad}`),
      },
      {
        key: "tasks/tasks.controller.ts#listSubtasks:taskId",
        name: "GET /tasks/:taskId/subtasks",
        run: (bad) => get(`/tasks/${bad}/subtasks`),
      },
      {
        key: "tasks/tasks.controller.ts#reorderSubtasks:taskId",
        name: "PATCH /tasks/:taskId/subtasks/reorder",
        run: (bad) => patch(`/tasks/${bad}/subtasks/reorder`).send({ subtaskIds: [randomUUID()] }),
      },
      {
        key: "tasks/tasks.controller.ts#updateStatus:taskId",
        name: "PATCH /tasks/:taskId/status (legacy)",
        run: (bad) => patch(`/tasks/${bad}/status`).send({ status: "in_progress" }),
      },
      {
        key: "tasks/tasks.controller.ts#updateTask:taskId",
        name: "PATCH /tasks/:taskId",
        run: (bad) => patch(`/tasks/${bad}`).send({ title: `Đổi tên ${uniq()}` }),
      },
      {
        key: "tasks/tasks.controller.ts#deleteTask:taskId",
        name: "DELETE /tasks/:taskId",
        run: (bad) => del(`/tasks/${bad}`),
      },
      {
        key: "tasks/tasks.controller.ts#addLabel:taskId",
        name: "POST /tasks/:taskId/labels/:labelId — vế taskId",
        run: (bad) => post(`/tasks/${bad}/labels/${labelId}`),
      },
      {
        key: "tasks/tasks.controller.ts#addLabel:labelId",
        name: "POST /tasks/:taskId/labels/:labelId — vế labelId",
        run: (bad) => post(`/tasks/${taskId}/labels/${bad}`),
      },
      {
        key: "tasks/tasks.controller.ts#removeLabel:taskId",
        name: "DELETE /tasks/:taskId/labels/:labelId — vế taskId",
        run: (bad) => del(`/tasks/${bad}/labels/${labelId}`),
      },
      {
        key: "tasks/tasks.controller.ts#removeLabel:labelId",
        name: "DELETE /tasks/:taskId/labels/:labelId — vế labelId",
        run: (bad) => del(`/tasks/${taskId}/labels/${bad}`),
      },
      {
        key: "tasks/tasks.controller.ts#getComments:taskId",
        name: "GET /tasks/:taskId/comments",
        run: (bad) => get(`/tasks/${bad}/comments`),
      },
      {
        key: "tasks/tasks.controller.ts#addComment:taskId",
        name: "POST /tasks/:taskId/comments",
        run: (bad) => post(`/tasks/${bad}/comments`).send({ content: `Bình luận ${uniq()}` }),
      },
      {
        key: "tasks/tasks.controller.ts#updateComment:taskId",
        name: "PATCH /tasks/:taskId/comments/:commentId — vế taskId",
        run: (bad) =>
          patch(`/tasks/${bad}/comments/${commentId}`).send({ content: `Sửa ${uniq()}` }),
      },
      {
        key: "tasks/tasks.controller.ts#updateComment:commentId",
        name: "PATCH /tasks/:taskId/comments/:commentId — vế commentId",
        run: (bad) => patch(`/tasks/${taskId}/comments/${bad}`).send({ content: `Sửa ${uniq()}` }),
      },
      {
        key: "tasks/tasks.controller.ts#deleteComment:taskId",
        name: "DELETE /tasks/:taskId/comments/:commentId — vế taskId",
        run: (bad) => del(`/tasks/${bad}/comments/${commentId}`),
      },
      {
        key: "tasks/tasks.controller.ts#deleteComment:commentId",
        name: "DELETE /tasks/:taskId/comments/:commentId — vế commentId",
        run: (bad) => del(`/tasks/${taskId}/comments/${bad}`),
      },
      {
        key: "tasks/tasks.controller.ts#assignTask:taskId",
        name: "POST /tasks/:taskId/assign",
        run: (bad) => post(`/tasks/${bad}/assign`).send({ assigneeEmployeeId: employeeId }),
      },
      {
        key: "tasks/tasks.controller.ts#changeTaskStatus:taskId",
        name: "POST /tasks/:taskId/change-status",
        run: (bad) => post(`/tasks/${bad}/change-status`).send({ status: "In Progress" }),
      },
      {
        key: "tasks/tasks.controller.ts#moveTask:taskId",
        name: "POST /tasks/:taskId/move (deprecated sugar)",
        run: (bad) => post(`/tasks/${bad}/move`).send({ status: "In Progress" }),
      },
      {
        key: "tasks/tasks.controller.ts#moveTaskState:taskId",
        name: "POST /tasks/:taskId/move-state",
        run: (bad) => post(`/tasks/${bad}/move-state`).send({ stateId }),
      },
      {
        key: "tasks/tasks.controller.ts#changeTaskPriority:taskId",
        name: "POST /tasks/:taskId/change-priority",
        run: (bad) => post(`/tasks/${bad}/change-priority`).send({ priority: "High" }),
      },
      {
        key: "tasks/tasks.controller.ts#changeTaskDeadline:taskId",
        name: "POST /tasks/:taskId/change-deadline",
        run: (bad) => post(`/tasks/${bad}/change-deadline`).send({ dueAt: isoInDays(7) }),
      },
      {
        key: "tasks/tasks.controller.ts#listWatchers:taskId",
        name: "GET /tasks/:taskId/watchers",
        run: (bad) => get(`/tasks/${bad}/watchers`),
      },
      {
        key: "tasks/tasks.controller.ts#addWatcher:taskId",
        name: "POST /tasks/:taskId/watchers",
        run: (bad) => post(`/tasks/${bad}/watchers`).send({}),
      },
      {
        key: "tasks/tasks.controller.ts#removeWatcher:taskId",
        name: "DELETE /tasks/:taskId/watchers/:watcherId — vế taskId",
        run: (bad) => del(`/tasks/${bad}/watchers/${watcherId}`),
      },
      {
        key: "tasks/tasks.controller.ts#removeWatcher:watcherId",
        name: "DELETE /tasks/:taskId/watchers/:watcherId — vế watcherId",
        run: (bad) => del(`/tasks/${taskId}/watchers/${bad}`),
      },
      {
        key: "tasks/tasks.controller.ts#listChecklists:taskId",
        name: "GET /tasks/:taskId/checklists",
        run: (bad) => get(`/tasks/${bad}/checklists`),
      },
      {
        key: "tasks/tasks.controller.ts#createChecklist:taskId",
        name: "POST /tasks/:taskId/checklists",
        run: (bad) => post(`/tasks/${bad}/checklists`).send({ title: `Mục kiểm ${uniq()}` }),
      },
      {
        key: "tasks/tasks.controller.ts#updateChecklist:taskId",
        name: "PATCH /tasks/:taskId/checklists/:checklistId — vế taskId",
        run: (bad) =>
          patch(`/tasks/${bad}/checklists/${checklistId}`).send({ title: `Đổi ${uniq()}` }),
      },
      {
        key: "tasks/tasks.controller.ts#updateChecklist:checklistId",
        name: "PATCH /tasks/:taskId/checklists/:checklistId — vế checklistId",
        run: (bad) => patch(`/tasks/${taskId}/checklists/${bad}`).send({ title: `Đổi ${uniq()}` }),
      },
      {
        key: "tasks/tasks.controller.ts#deleteChecklist:taskId",
        name: "DELETE /tasks/:taskId/checklists/:checklistId — vế taskId",
        run: (bad) => del(`/tasks/${bad}/checklists/${checklistId}`),
      },
      {
        key: "tasks/tasks.controller.ts#deleteChecklist:checklistId",
        name: "DELETE /tasks/:taskId/checklists/:checklistId — vế checklistId",
        run: (bad) => del(`/tasks/${taskId}/checklists/${bad}`),
      },
      {
        key: "tasks/tasks.controller.ts#addChecklistItem:taskId",
        name: "POST /tasks/:taskId/checklists/:checklistId/items — vế taskId",
        run: (bad) =>
          post(`/tasks/${bad}/checklists/${checklistId}/items`).send({ title: `Dòng ${uniq()}` }),
      },
      {
        key: "tasks/tasks.controller.ts#addChecklistItem:checklistId",
        name: "POST /tasks/:taskId/checklists/:checklistId/items — vế checklistId",
        run: (bad) =>
          post(`/tasks/${taskId}/checklists/${bad}/items`).send({ title: `Dòng ${uniq()}` }),
      },
      {
        key: "tasks/tasks.controller.ts#updateChecklistItem:taskId",
        name: "PATCH .../checklists/:checklistId/items/:itemId — vế taskId",
        run: (bad) =>
          patch(`/tasks/${bad}/checklists/${checklistId}/items/${itemId}`).send({ isDone: true }),
      },
      {
        key: "tasks/tasks.controller.ts#updateChecklistItem:checklistId",
        name: "PATCH .../checklists/:checklistId/items/:itemId — vế checklistId",
        run: (bad) =>
          patch(`/tasks/${taskId}/checklists/${bad}/items/${itemId}`).send({ isDone: true }),
      },
      {
        key: "tasks/tasks.controller.ts#updateChecklistItem:itemId",
        name: "PATCH .../checklists/:checklistId/items/:itemId — vế itemId",
        run: (bad) =>
          patch(`/tasks/${taskId}/checklists/${checklistId}/items/${bad}`).send({ isDone: true }),
      },
      {
        key: "tasks/tasks.controller.ts#deleteChecklistItem:taskId",
        name: "DELETE .../checklists/:checklistId/items/:itemId — vế taskId",
        run: (bad) => del(`/tasks/${bad}/checklists/${checklistId}/items/${itemId}`),
      },
      {
        key: "tasks/tasks.controller.ts#deleteChecklistItem:checklistId",
        name: "DELETE .../checklists/:checklistId/items/:itemId — vế checklistId",
        run: (bad) => del(`/tasks/${taskId}/checklists/${bad}/items/${itemId}`),
      },
      {
        key: "tasks/tasks.controller.ts#deleteChecklistItem:itemId",
        name: "DELETE .../checklists/:checklistId/items/:itemId — vế itemId",
        run: (bad) => del(`/tasks/${taskId}/checklists/${checklistId}/items/${bad}`),
      },
      {
        key: "tasks/tasks.controller.ts#listActivity:taskId",
        name: "GET /tasks/:taskId/activity",
        run: (bad) => get(`/tasks/${bad}/activity`),
      },
    ];

    it("(0) BẢNG ĐO phủ ĐỦ 43 tham số và không dòng nào TRÙNG KHOÁ", () => {
      // Neo chống xanh-RỖNG: nếu một dòng bị xoá nhầm khi rebase thì mọi ca dưới vẫn xanh vì
      // KHÔNG CÓ GÌ để chạy. Số 43 lấy từ census AST (`param-uuid-census.ts`), không đếm tay.
      expect(CASES.length, "bảng đo phải phủ đúng 43 tham số của tasks.controller.ts").toBe(43);
      expect(new Set(CASES.map((c) => c.key)).size, "có dòng TRÙNG KHOÁ trong bảng đo").toBe(43);
      for (const c of CASES) {
        expect(c.key.startsWith("tasks/tasks.controller.ts#"), `khoá sai file: ${c.key}`).toBe(
          true,
        );
      }
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
    // Đây là vế duy nhất chứng minh pipe KHÔNG chặn oan: nếu một `:id` nào đó thực ra nhận MÃ nghiệp
    // vụ thay vì uuid thì ca "UUID hợp lệ → 404" ở trên vẫn xanh còn ca này sẽ đỏ.

    it("ALLOW-200 · GET /tasks/by-project/:projectId trên DỰ ÁN THẬT (loại khoá project)", async () => {
      expectExact(await get(`/tasks/by-project/${projectId}`), 200);
    });

    it("ALLOW-200 · GET /tasks/by-team/:teamId trên TEAM THẬT (loại khoá team)", async () => {
      expectExact(await get(`/tasks/by-team/${teamId}`), 200);
    });

    it("ALLOW-200 · GET /tasks/:taskId trên TASK THẬT (loại khoá task)", async () => {
      expectExact(await get(`/tasks/${taskId}`), 200);
    });

    it("ALLOW-200 · PATCH /tasks/:taskId trên TASK THẬT", async () => {
      const t = await freshTask();
      expectExact(await patch(`/tasks/${t}`).send({ title: `Đổi tên ${uniq()}` }), 200);
    });

    it("ALLOW-204 · DELETE /tasks/:taskId trên TASK THẬT (@HttpCode(204))", async () => {
      const t = await freshTask();
      expectExact(await del(`/tasks/${t}`), 204);
    });

    it("ALLOW-2xx · POST /tasks/:taskId/labels/:labelId trên NHÃN THẬT (loại khoá label)", async () => {
      const t = await freshTask();
      const l = await freshLabel();
      const res = await post(`/tasks/${t}/labels/${l}`);
      expectPassedBoundary(res);
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    });

    it("ALLOW-204 · DELETE /tasks/:taskId/labels/:labelId trên NHÃN THẬT ĐÃ GẮN", async () => {
      const t = await freshTask();
      const l = await freshLabel();
      expect((await post(`/tasks/${t}/labels/${l}`)).status).toBeLessThan(300);
      expectExact(await del(`/tasks/${t}/labels/${l}`), 204);
    });

    it("ALLOW-200 · PATCH /tasks/:taskId/comments/:commentId trên BÌNH LUẬN THẬT (loại khoá comment)", async () => {
      const t = await freshTask();
      const c = await freshComment(t);
      expectExact(await patch(`/tasks/${t}/comments/${c}`).send({ content: `Sửa ${uniq()}` }), 200);
    });

    it("ALLOW-204 · DELETE /tasks/:taskId/comments/:commentId trên BÌNH LUẬN THẬT (@HttpCode(204))", async () => {
      const t = await freshTask();
      const c = await freshComment(t);
      expectExact(await del(`/tasks/${t}/comments/${c}`), 204);
    });

    it("ALLOW-204 · DELETE /tasks/:taskId/watchers/:watcherId trên WATCHER THẬT (loại khoá watcher)", async () => {
      const t = await freshTask();
      const w = await freshWatcher(t);
      expectExact(await del(`/tasks/${t}/watchers/${w}`), 204);
    });

    it("ALLOW-200 · PATCH /tasks/:taskId/checklists/:checklistId trên CHECKLIST THẬT (loại khoá checklist)", async () => {
      const t = await freshTask();
      const cl = await freshChecklist(t);
      expectExact(
        await patch(`/tasks/${t}/checklists/${cl}`).send({ title: `Đổi ${uniq()}` }),
        200,
      );
    });

    it("ALLOW-204 · DELETE /tasks/:taskId/checklists/:checklistId trên CHECKLIST THẬT", async () => {
      const t = await freshTask();
      const cl = await freshChecklist(t);
      expectExact(await del(`/tasks/${t}/checklists/${cl}`), 204);
    });

    it("ALLOW-200 · PATCH .../items/:itemId trên DÒNG KIỂM THẬT (loại khoá checklist-item)", async () => {
      const t = await freshTask();
      const cl = await freshChecklist(t);
      const line = await freshChecklistItem(t, cl);
      expectExact(
        await patch(`/tasks/${t}/checklists/${cl}/items/${line}`).send({ isDone: true }),
        200,
      );
    });

    it("ALLOW-204 · DELETE .../items/:itemId trên DÒNG KIỂM THẬT (@HttpCode(204))", async () => {
      const t = await freshTask();
      const cl = await freshChecklist(t);
      const line = await freshChecklistItem(t, cl);
      expectExact(await del(`/tasks/${t}/checklists/${cl}/items/${line}`), 204);
    });

    it("ALLOW-200 · POST /tasks/:taskId/assign trên TASK THẬT (@HttpCode(200))", async () => {
      const t = await freshTask();
      expectExact(await post(`/tasks/${t}/assign`).send({ assigneeEmployeeId: employeeId }), 200);
    });

    it("ALLOW-200 · POST /tasks/:taskId/change-status trên TASK THẬT (@HttpCode(200))", async () => {
      const t = await freshTask();
      expectExact(await post(`/tasks/${t}/change-status`).send({ status: "In Progress" }), 200);
    });

    it("ALLOW-200 · POST /tasks/:taskId/move trên TASK THẬT (@HttpCode(200))", async () => {
      const t = await freshTask();
      expectExact(await post(`/tasks/${t}/move`).send({ status: "In Progress" }), 200);
    });

    it("ALLOW-200 · POST /tasks/:taskId/move-state trên TASK THẬT + CỘT THẬT (@HttpCode(200))", async () => {
      const t = await freshTask();
      expectExact(await post(`/tasks/${t}/move-state`).send({ stateId }), 200);
    });

    it("ALLOW-200 · POST /tasks/:taskId/change-priority trên TASK THẬT (@HttpCode(200))", async () => {
      const t = await freshTask();
      expectExact(await post(`/tasks/${t}/change-priority`).send({ priority: "High" }), 200);
    });

    it("ALLOW-200 · POST /tasks/:taskId/change-deadline trên TASK THẬT (@HttpCode(200))", async () => {
      const t = await freshTask();
      expectExact(await post(`/tasks/${t}/change-deadline`).send({ dueAt: isoInDays(7) }), 200);
    });

    it("ALLOW-200 · PATCH /tasks/:taskId/status (legacy) trên TASK THẬT", async () => {
      const t = await freshTask();
      expectExact(await patch(`/tasks/${t}/status`).send({ status: "in_progress" }), 200);
    });

    it("ALLOW-200 · PATCH /tasks/:taskId/subtasks/reorder trên CÂY THẬT (cha + 1 con)", async () => {
      const parent = await freshTask();
      const child = await post("/tasks").send({
        title: `Việc con ${uniq()}`,
        parentTaskId: parent,
      });
      expect(child.status, `POST subtask: ${JSON.stringify(child.body)}`).toBe(201);
      expectExact(
        await patch(`/tasks/${parent}/subtasks/reorder`).send({
          subtaskIds: [child.body.data.id as string],
        }),
        200,
      );
    });

    it("ALLOW-200 · các route ĐỌC theo :taskId trên TASK THẬT (subtasks · comments · watchers · checklists · activity)", async () => {
      for (const suffix of ["subtasks", "comments", "watchers", "checklists", "activity"]) {
        expectExact(await get(`/tasks/${taskId}/${suffix}`), 200);
      }
    });

    // ══ Hồi quy ĐỊNH TUYẾN — literal-sibling ════════════════════════════════════════
    /**
     * Liệt kê bằng ĐỌC FILE `tasks/tasks.controller.ts`, không bằng trí nhớ:
     *  · `@Get("my")` · `@Get("board")` — MỘT segment nên chúng KHỚP `@Get(":taskId")`; chỉ THỨ TỰ
     *    KHAI BÁO cứu chúng. Gắn pipe vào `:taskId` KHÔNG đổi thứ tự, nhưng ca này là lưới bắt nếu
     *    ai đó sắp xếp lại file trong lúc "dọn cho gọn".
     *  · `@Get()` / `@Post()` trần — gốc `/tasks`.
     */
    it("ĐỊNH TUYẾN · GET /tasks/my vẫn 200 (không bị :taskId nuốt)", async () => {
      expectExact(await get("/tasks/my"), 200);
    });

    it("ĐỊNH TUYẾN · GET /tasks/board vẫn 200 (không bị :taskId nuốt)", async () => {
      expectExact(await get("/tasks/board"), 200);
    });

    it("ĐỊNH TUYẾN · GET /tasks (list) vẫn 200", async () => {
      expectExact(await get("/tasks"), 200);
    });

    it("ĐỊNH TUYẾN · POST /tasks (tạo) vẫn 201", async () => {
      expectExact(
        await post("/tasks").send({ title: `Việc định tuyến ${uniq()}`, projectId }),
        201,
      );
    });
  },
);
