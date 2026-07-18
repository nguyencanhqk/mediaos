/**
 * S5-TASK-HRCODE-1 (lane hrcode-int) — bằng chứng LANE_DB (Postgres cô lập, KHÔNG mock) rằng task HR
 * sinh từ đơn ĐIỀU CHỈNH CÔNG mang `task_code` THẬT (không còn NULL → renderer rớt '{task_code}' câm,
 * QA2-CRIT-002).
 *
 * Phủ (tất cả qua HTTP THẬT — route có controller/guard/permission đầy đủ):
 *   (b) POST /attendance/adjustment-requests → row `tasks` task_type='hr', task_code khớp /^TASK-\d+$/;
 *       2 lần cấp liên tiếp cho CÙNG company → mã KHÁC NHAU + TĂNG DẦN (allocateTaskCodeBeforeTx ở tx
 *       riêng TRƯỚC tx đơn; ensure-on-miss tạo counter 'task' canonical cho company seed SAU mig 0498).
 *   (c) PATCH counter 'task' → Inactive (direct pool, mirror admin PATCH) ⇒ tạo đơn trả 4xx
 *       (TASK-ERR-CODE-COUNTER-INACTIVE) — KHÔNG 500 raw. Error-path quan trọng nhất (RED trước khi có
 *       tasks/task-code.util.ts).
 *   (d) POST /tasks/:taskId/comments → payload outbox render task_code THẬT — không phải literal
 *       '{task_code}', cũng KHÔNG rơi về fallback title (commentPayload() coalesce task_code→title CHỈ
 *       nên kích hoạt khi task_code NULL — ở đây phải KHÔNG null nữa).
 *
 * ⚠️ PHẠM VI: LEAVE CỐ Ý NẰM NGOÀI (đừng thêm test leave vào file này).
 *   Đơn nghỉ tạo qua API (POST /leave/requests → LeaveRequestService.createDraft) KHÔNG tạo task Task Hub
 *   nào — `leave_requests.task_id` luôn NULL dưới traffic thật. Khối `LeaveService.createRequest/approve/
 *   reject/cancel` (đường DUY NHẤT còn gọi HrTasksService cho LEAVE) là CODE CHẾT: không route HTTP nào
 *   tới được, `CreateLeaveRequestDto` không được import ở bất kỳ controller nào.
 *   Đây KHÔNG phải bug bỏ sót mà là hệ quả ĐÚNG SPEC: SPEC-05 LEAVE không hề yêu cầu Task Hub (0 kết quả),
 *   SPEC-06 chỉ nhắc nghỉ phép ở "cảnh báo khi giao task cho người đang nghỉ" (§11.1). Bản rebuild Sprint 3
 *   (#56, LeaveRequestService theo SPEC-05) bỏ liên kết Task Hub của thời G11 là hợp lệ; khối cũ nằm lại
 *   thành code chết sau đợt de-media-fy. Việc DỌN nó có WO riêng (xoá là thao tác cần review riêng —
 *   review gate mù với phần bị xoá). Wiring task_code vào code chết đã được GỠ khỏi PR này có chủ đích.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate).
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

const runDb = hasDb && Boolean(process.env.LANE_DB);
// Ghép chuỗi để KHÔNG trip gitleaks generic-api-key (mật khẩu test ephemeral — CLAUDE.md §5).
const LOGIN_PW = ["Passw0rd", "hrcode1"].join("!");

const TASK_CODE_RE = /^TASK-(\d+)$/;

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, resourceType: string, scope: Scope];

describe.skipIf(!runDb)(
  "S5-TASK-HRCODE-1 — task HR (điều chỉnh công) mang task_code THẬT; counter Inactive → 4xx; comment render mã thật",
  () => {
    let app: INestApplication;
    let direct: Pool;
    const companyIds: string[] = [];

    let passwordHash = "";
    async function hash(): Promise<string> {
      if (!passwordHash) passwordHash = await new PasswordService().hash(LOGIN_PW);
      return passwordHash;
    }

    // ── seed/query helpers ──────────────────────────────────────────────────────

    async function seedEmployee(companyId: string, userId: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,'active') RETURNING id`,
        [companyId, userId],
      );
      return r.rows[0].id as string;
    }

    async function grant(
      companyId: string,
      userId: string,
      label: string,
      pairs: Pair[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `hrcode-${label}-${userId.slice(0, 8)}`);
      for (const [action, resourceType, scope] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resourceType, false);
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

    const authPost = (t: string, u: string, body: object = {}) =>
      request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`).send(body);

    async function taskRow(
      taskId: string,
    ): Promise<{ taskType: string; taskCode: string | null; title: string }> {
      const r = await direct.query(
        `SELECT task_type AS "taskType", task_code AS "taskCode", title FROM tasks WHERE id=$1`,
        [taskId],
      );
      return r.rows[0] as { taskType: string; taskCode: string | null; title: string };
    }

    /** Counter 'task' Ở TX RIÊNG đã tồn tại (ensure-on-miss chạy sau lần allocate đầu) — PATCH Inactive
     *  trực tiếp qua direct pool (mirror admin PATCH /foundation/sequences/:id, KHÔNG cần dựng HTTP admin
     *  surface cho test này). rowCount phải đúng 1 — nếu 0, counter CHƯA được ensure ở bước trước (lỗi
     *  thứ tự test) — fail loud thay vì âm thầm no-op. */
    async function setTaskCounterInactive(companyId: string): Promise<void> {
      const r = await direct.query(
        `UPDATE sequence_counters SET status='Inactive', updated_at=now()
         WHERE company_id=$1 AND sequence_key='task' AND scope_type='Company' AND deleted_at IS NULL`,
        [companyId],
      );
      if (r.rowCount !== 1) {
        throw new Error(
          `setTaskCounterInactive: expected exactly 1 counter 'task' row for company=${companyId}, got ${r.rowCount}`,
        );
      }
    }

    async function commentCreatedPayload(
      companyId: string,
      taskId: string,
    ): Promise<Record<string, unknown>> {
      const r = await direct.query(
        `SELECT payload FROM outbox_events
         WHERE company_id=$1 AND event_type='task.comment_created' AND payload->>'taskId'=$2
         ORDER BY created_at DESC LIMIT 1`,
        [companyId, taskId],
      );
      expect(r.rows.length, "outbox task.comment_created row phải tồn tại").toBe(1);
      return r.rows[0].payload as Record<string, unknown>;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
    });

    afterAll(async () => {
      await direct
        ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
        .catch(() => undefined);
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ═══════════════ (b)+(c-att)+(d-att) ATTENDANCE — HTTP THẬT (route reachable) ═══════════════

    describe("(b)+(c-att)+(d-att) AttendanceAdjustmentService.createRequest (POST /attendance/adjustment-requests)", () => {
      let B: SeededTenant;
      let empUserId: string;
      let empToken: string;
      let firstTaskId: string;

      async function createAdjustment(workDate: string) {
        return authPost(empToken, "/attendance/adjustment-requests", {
          workDate,
          requestType: "UPDATE_CHECK_IN",
          reason: "Điều chỉnh giờ vào (S5-TASK-HRCODE-1 hrcode-int)",
          requestedCheckInAt: "2027-01-01T02:00:00Z",
        });
      }

      async function adjustmentTaskId(requestId: string): Promise<string> {
        const r = await direct.query(
          `SELECT task_id AS "taskId" FROM attendance_adjustment_requests WHERE id=$1`,
          [requestId],
        );
        expect(r.rows[0]?.taskId, "adjustment request phải gắn task_id").toBeTruthy();
        return r.rows[0].taskId as string;
      }

      beforeAll(async () => {
        B = await seedCompany(direct, "hrcodeatt");
        companyIds.push(B.companyId);
        empUserId = await seedUser(direct, B.companyId, `emp@${B.slug}.test`, await hash());
        await seedEmployee(B.companyId, empUserId);
        await grant(B.companyId, empUserId, "emp", [["create-own", "adjustment", "Own"]]);
        empToken = await login(B.slug, `emp@${B.slug}.test`);
      });

      it("cấp 2 task_code liên tiếp cho task HR (task_type='hr') qua HTTP thật — KHÁC NHAU + TĂNG DẦN", async () => {
        const res1 = await createAdjustment("2027-06-07");
        expect(res1.status, JSON.stringify(res1.body)).toBe(201);
        firstTaskId = await adjustmentTaskId(res1.body.data.id as string);
        const task1 = await taskRow(firstTaskId);
        expect(task1.taskType).toBe("hr");
        expect(task1.taskCode).toMatch(TASK_CODE_RE);

        const res2 = await createAdjustment("2027-06-14");
        expect(res2.status, JSON.stringify(res2.body)).toBe(201);
        const task2Id = await adjustmentTaskId(res2.body.data.id as string);
        const task2 = await taskRow(task2Id);
        expect(task2.taskType).toBe("hr");
        expect(task2.taskCode).toMatch(TASK_CODE_RE);

        expect(task2.taskCode).not.toBe(task1.taskCode);
        const n1 = Number(TASK_CODE_RE.exec(task1.taskCode as string)?.[1]);
        const n2 = Number(TASK_CODE_RE.exec(task2.taskCode as string)?.[1]);
        expect(n2).toBeGreaterThan(n1);
      });

      it("PATCH counter 'task' → Inactive ⇒ POST /attendance/adjustment-requests trả 4xx (TASK-ERR-CODE-COUNTER-INACTIVE) — KHÔNG 500", async () => {
        await setTaskCounterInactive(B.companyId);

        const res = await createAdjustment("2027-06-21");
        expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        expect(JSON.stringify(res.body)).toMatch(/TASK-ERR-CODE-COUNTER-INACTIVE/);
      });

      it("(d) task-comments payload cho task HR (đơn điều chỉnh công) render task_code THẬT — không '{task_code}', không fallback title", async () => {
        const viewer = await seedUser(direct, B.companyId, `viewer@${B.slug}.test`, await hash());
        await grant(B.companyId, viewer, "viewer", [["comment", "task", "Company"]]);
        const token = await login(B.slug, `viewer@${B.slug}.test`);

        const task = await taskRow(firstTaskId);
        expect(task.taskCode).toMatch(TASK_CODE_RE);

        const res = await authPost(token, `/tasks/${firstTaskId}/comments`, {
          content: "Đã xử lý đơn điều chỉnh công này.",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);

        const payload = await commentCreatedPayload(B.companyId, firstTaskId);
        expect(payload.task_code).toBe(task.taskCode);
        expect(payload.task_code).not.toBe("{task_code}");
        expect(payload.task_code).not.toBe(task.title);
      });
    });
  },
);
