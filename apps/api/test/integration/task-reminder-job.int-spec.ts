/**
 * S4-NOTI-BE-3 — TaskReminderJobHandler (TASK_DUE_SOON / TASK_OVERDUE) trên Nest app + Postgres THẬT.
 *
 * Phủ (RED-trước → GREEN):
 *   (a) task quá hạn (due_date < now, status != completed, task_type='office', có assignee)
 *       → 1 notification event_code='TASK_OVERDUE' cho ĐÚNG assignee, kèm 1 delivery_log 'Sent'.
 *   (b) task sắp đến hạn (due_date trong 24h tới) → 1 notification event_code='TASK_DUE_SOON' cho assignee.
 *   (c) KHÔNG phát cho: task đã 'completed' (dù overdue) · task KHÔNG có assignee · task task_type khác
 *       'office' (vd 'workflow_step', media-era out-of-scope) · task due xa (>24h, ngoài cửa sổ due-soon).
 *   (d) IDEMPOTENT: chạy job LẦN 2 CÙNG NGÀY → KHÔNG tạo thêm notification (dedupe theo entity+ngày qua
 *       dedupeKey="<taskId>:<YYYY-MM-DD>", strategy 'DedupeKey' APPEND ở notification-dedupe.const.ts).
 *   (e) cross-tenant: chạy job cho company A KHÔNG đụng task/notification của company B (BẤT BIẾN #1).
 *
 * Gate CỨNG hasDb && LANE_DB (memory integration-test-lane-db-gate) — band 0479-0485 chỉ có trên DB lane.
 * Handler gọi TRỰC TIẾP qua Nest DI (bỏ qua JobRunner/lock — JobRunner đã có unit test riêng ở
 * job-runner.spec.ts; test này chứng minh LOGIC nghiệp vụ + idempotency thật của handler).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { TaskReminderJobHandler } from "../../src/notifications/task-reminder.job-handler";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const PASSWORD = "Passw0rd!test99";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface PlantedTask {
  id: string;
}

async function insertTask(
  direct: Pool,
  companyId: string,
  opts: {
    title: string;
    taskType?: string;
    status?: string;
    assigneeUserId?: string | null;
    dueDate?: Date | null;
  },
): Promise<PlantedTask> {
  const res = await direct.query<{ id: string }>(
    `INSERT INTO tasks (id, company_id, task_type, title, assignee_user_id, status, due_date, origin)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'initial')
     RETURNING id`,
    [
      randomUUID(),
      companyId,
      opts.taskType ?? "office",
      opts.title,
      opts.assigneeUserId ?? null,
      opts.status ?? "in_progress",
      opts.dueDate ?? null,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error("insertTask: INSERT không trả về hàng nào");
  return row;
}

async function notificationsFor(
  direct: Pool,
  companyId: string,
  eventCode: string,
  sourceEntityId: string,
): Promise<Array<{ recipient_user_id: string; event_code: string }>> {
  const res = await direct.query<{ recipient_user_id: string; event_code: string }>(
    `SELECT recipient_user_id, event_code FROM notifications
      WHERE company_id = $1 AND event_code = $2 AND source_entity_id = $3 AND deleted_at IS NULL`,
    [companyId, eventCode, sourceEntityId],
  );
  return res.rows;
}

describe.skipIf(!runDb)(
  "S4-NOTI-BE-3 TaskReminderJobHandler (TASK_DUE_SOON / TASK_OVERDUE)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let handler: TaskReminderJobHandler;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let overdueTaskAssignee: string;
    let dueSoonTaskAssignee: string;
    let completedTaskAssignee: string;
    let noAssigneeTaskId: string;

    let overdueTask: PlantedTask;
    let dueSoonTask: PlantedTask;
    let completedOverdueTask: PlantedTask;
    let workflowStepOverdueTask: PlantedTask;
    let farFutureTask: PlantedTask;
    let bTask: PlantedTask;
    let bAssignee: string;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      handler = app.get(TaskReminderJobHandler);

      direct = directPool();
      const pw = await new PasswordService().hash(PASSWORD);

      A = await seedCompany(direct, "trja");
      companyIds.push(A.companyId);
      B = await seedCompany(direct, "trjb");
      companyIds.push(B.companyId);

      overdueTaskAssignee = await seedUser(
        direct,
        A.companyId,
        `overdue-${randomUUID()}@a.test`,
        pw,
      );
      dueSoonTaskAssignee = await seedUser(
        direct,
        A.companyId,
        `duesoon-${randomUUID()}@a.test`,
        pw,
      );
      completedTaskAssignee = await seedUser(
        direct,
        A.companyId,
        `done-${randomUUID()}@a.test`,
        pw,
      );
      const noAssigneeOwner = await seedUser(
        direct,
        A.companyId,
        `noassignee-${randomUUID()}@a.test`,
        pw,
      );
      void noAssigneeOwner;
      bAssignee = await seedUser(direct, B.companyId, `b-${randomUUID()}@b.test`, pw);

      const now = Date.now();

      // (a) quá hạn 2 ngày, status='in_progress', task_type='office' → PHẢI phát TASK_OVERDUE.
      overdueTask = await insertTask(direct, A.companyId, {
        title: "Overdue task",
        status: "in_progress",
        assigneeUserId: overdueTaskAssignee,
        dueDate: new Date(now - 2 * DAY_MS),
      });

      // (b) còn 2h đến hạn → PHẢI phát TASK_DUE_SOON.
      dueSoonTask = await insertTask(direct, A.companyId, {
        title: "Due soon task",
        status: "not_started",
        assigneeUserId: dueSoonTaskAssignee,
        dueDate: new Date(now + 2 * HOUR_MS),
      });

      // (c1) đã completed dù quá hạn 1 ngày → KHÔNG được phát.
      completedOverdueTask = await insertTask(direct, A.companyId, {
        title: "Completed overdue task",
        status: "completed",
        assigneeUserId: completedTaskAssignee,
        dueDate: new Date(now - DAY_MS),
      });

      // (c2) KHÔNG có assignee, quá hạn → KHÔNG được phát (không có ai nhận).
      const noAssigneeTask = await insertTask(direct, A.companyId, {
        title: "No assignee overdue task",
        status: "in_progress",
        assigneeUserId: null,
        dueDate: new Date(now - DAY_MS),
      });
      noAssigneeTaskId = noAssigneeTask.id;

      // (c3) task_type='workflow_step' (media-era, ngoài phạm vi TASK module) quá hạn + có assignee → KHÔNG phát.
      workflowStepOverdueTask = await insertTask(direct, A.companyId, {
        title: "Workflow-step overdue task (out of scope)",
        taskType: "workflow_step",
        status: "in_progress",
        assigneeUserId: overdueTaskAssignee,
        dueDate: new Date(now - DAY_MS),
      });

      // (c4) due xa 10 ngày → ngoài cửa sổ due-soon (24h) → KHÔNG phát.
      farFutureTask = await insertTask(direct, A.companyId, {
        title: "Far future task",
        status: "not_started",
        assigneeUserId: dueSoonTaskAssignee,
        dueDate: new Date(now + 10 * DAY_MS),
      });

      // (e) company B — task quá hạn tương tự — chứng minh chạy job cho A KHÔNG đụng B.
      bTask = await insertTask(direct, B.companyId, {
        title: "B overdue task",
        status: "in_progress",
        assigneeUserId: bAssignee,
        dueDate: new Date(now - DAY_MS),
      });
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    it("(a) task quá hạn office/active/assignee → TASK_OVERDUE cho ĐÚNG assignee + 1 lần", async () => {
      await handler.run({ companyId: A.companyId });
      const rows = await notificationsFor(direct, A.companyId, "TASK_OVERDUE", overdueTask.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.recipient_user_id).toBe(overdueTaskAssignee);
    });

    it("(b) task sắp đến hạn (24h) → TASK_DUE_SOON cho ĐÚNG assignee", async () => {
      const rows = await notificationsFor(direct, A.companyId, "TASK_DUE_SOON", dueSoonTask.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.recipient_user_id).toBe(dueSoonTaskAssignee);
    });

    it("(c) KHÔNG phát cho task completed / không assignee / workflow_step / far-future", async () => {
      const completed = await notificationsFor(
        direct,
        A.companyId,
        "TASK_OVERDUE",
        completedOverdueTask.id,
      );
      expect(completed).toHaveLength(0);

      const noAssignee = await notificationsFor(
        direct,
        A.companyId,
        "TASK_OVERDUE",
        noAssigneeTaskId,
      );
      expect(noAssignee).toHaveLength(0);

      const workflowStep = await notificationsFor(
        direct,
        A.companyId,
        "TASK_OVERDUE",
        workflowStepOverdueTask.id,
      );
      expect(workflowStep).toHaveLength(0);

      const farFuture = await notificationsFor(
        direct,
        A.companyId,
        "TASK_DUE_SOON",
        farFutureTask.id,
      );
      expect(farFuture).toHaveLength(0);
    });

    it("(d) chạy job LẦN 2 cùng ngày → KHÔNG tạo thêm notification (idempotent, dedupe theo entity+ngày)", async () => {
      await handler.run({ companyId: A.companyId });
      const overdueRows = await notificationsFor(
        direct,
        A.companyId,
        "TASK_OVERDUE",
        overdueTask.id,
      );
      expect(overdueRows).toHaveLength(1);
      const dueSoonRows = await notificationsFor(
        direct,
        A.companyId,
        "TASK_DUE_SOON",
        dueSoonTask.id,
      );
      expect(dueSoonRows).toHaveLength(1);
    });

    it("(e) cross-tenant: chạy job cho company A KHÔNG tạo notification cho task company B", async () => {
      const bRows = await notificationsFor(direct, B.companyId, "TASK_OVERDUE", bTask.id);
      expect(bRows).toHaveLength(0);
    });
  },
);
