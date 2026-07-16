/**
 * S5-NOTI-FIX-1 — Backfill target_url_template cho 39 template notification GLOBAL (QA2-CRIT-001).
 *
 * Chứng minh migration 0497 vá deep-link toàn hệ thống. Đường THẬT: `OutboxService.enqueue` (producer)
 * → `OutboxWorker.processBatch()` (claim + `noti-bridge:<eventType>` consumer đăng ký bởi các registrar) →
 * `OutboxNotificationBridge` → `NotificationEngineService.intake()` → render (`target_url_template` +
 * payload) → `notifications.target_url`. KHÔNG mock engine/bridge/render. Drain qua helper
 * `drainOutboxUntilSettled` (BẮT BUỘC — an toàn dưới cross-suite claim, xem helpers/outbox-drain).
 *
 * Phủ (docs/plans/S5-NOTI-FIX-1.md §7):
 *   (a) SAU migrate: 0 template GLOBAL còn `target_url_template IS NULL` + tổng đúng 39 + sample-map khớp §4.
 *   (b) render deep-link THẬT (P0) qua bridge:
 *        TASK_ASSIGNED / TASK_COMMENT_CREATED → `/tasks/{taskId}` (payload commonPayload/commentPayload có taskId).
 *        LEAVE_REQUEST_APPROVED / LEAVE_REQUEST_REJECTED → `/leave/me/requests/{requestId}` (payload có requestId).
 *        ATT_ADJUSTMENT_APPROVED → `/attendance/adjustment-requests/{requestId}` (payload có requestId).
 *   (c) route TĨNH: template TASK_DUE_SOON = `/tasks/my-tasks` (KHÔNG placeholder → KHÔNG rò `{}` → tránh
 *        bẫy assertInternalTargetUrl 422 khi payload job thiếu taskId).
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-lane-db-gate): CHỈ DB cô lập lane
 * (scripts/lane-db-setup.sh notifix1 + export LANE_DB=mediaos_notifix1). KHÔNG biểu thức ngược (false-green).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { OutboxWorker } from "../../src/events/outbox-worker";
import { OutboxService } from "../../src/events/outbox.service";
import { DatabaseService } from "../../src/db/db.service";
import { drainOutboxUntilSettled } from "../helpers/outbox-drain";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)(
  "S5-NOTI-FIX-1 deep-link target_url (migration 0497, DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let appConn: Pool;
    let W: SeededTenant;
    let db: DatabaseService;
    let outbox: OutboxService;
    const companyIds: string[] = [];

    let managerUser = "";
    let employeeUser = "";
    let hrUser = "";

    async function seedEmp(companyId: string, userId: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,'active') RETURNING id`,
        [companyId, userId],
      );
      return r.rows[0].id as string;
    }

    /** Seed 1 task 'office' với assignee + creator sẵn (audience reader đọc assignee_user_id). */
    async function mkAssignedTask(title: string, code: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks (company_id, task_type, title, task_code, task_status, creator_user_id, assignee_user_id)
       VALUES ($1,'office',$2,$3,'Todo',$4,$5) RETURNING id`,
        [W.companyId, title, code, managerUser, employeeUser],
      );
      return r.rows[0].id as string;
    }

    /** Enqueue outbox event qua producer path THẬT (withTenant → OutboxService), company_id từ GUC DEFAULT. */
    async function enqueue(eventType: string, payload: Record<string, unknown>): Promise<void> {
      await db.withTenant(W.companyId, (tx) => outbox.enqueue(tx, { eventType, payload }));
    }

    async function processOutbox(): Promise<void> {
      await drainOutboxUntilSettled({ worker: app.get(OutboxWorker), direct, companyIds });
    }

    /** target_url của notification (recipient + event_code + source_entity_id) — duy nhất theo bộ khoá. */
    async function targetUrlOf(
      recipientUserId: string,
      eventCode: string,
      sourceEntityId: string,
    ): Promise<string | null> {
      const r = await direct.query(
        `SELECT target_url FROM notifications
         WHERE company_id=$1 AND recipient_user_id=$2 AND event_code=$3 AND source_entity_id=$4
           AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [W.companyId, recipientUserId, eventCode, sourceEntityId],
      );
      return (r.rows[0]?.target_url as string | undefined) ?? null;
    }

    async function globalTemplateUrl(templateCode: string): Promise<string | null> {
      const r = await direct.query(
        `SELECT target_url_template FROM notification_templates
         WHERE template_code=$1 AND company_id IS NULL AND deleted_at IS NULL`,
        [templateCode],
      );
      return (r.rows[0]?.target_url_template as string | undefined) ?? null;
    }

    beforeAll(async () => {
      direct = directPool();
      appConn = appPool();
      W = await seedCompany(direct, "notifix1");
      companyIds.push(W.companyId);

      managerUser = await seedUser(direct, W.companyId, `manager@${W.slug}.test`);
      await seedEmp(W.companyId, managerUser);
      employeeUser = await seedUser(direct, W.companyId, `employee@${W.slug}.test`);
      await seedEmp(W.companyId, employeeUser);
      hrUser = await seedUser(direct, W.companyId, `hr@${W.slug}.test`);
      await seedEmp(W.companyId, hrUser);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      db = app.get(DatabaseService);
      outbox = app.get(OutboxService);
    });

    afterAll(async () => {
      await direct
        ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
        .catch(() => undefined);
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await appConn?.end();
      await direct?.end();
      await app?.close();
    });

    // ── (a) Invariant: 0/39 template global còn NULL sau migrate 0497 ────────────────────────────────
    it("(a) 0 template GLOBAL còn target_url_template NULL + tổng đúng 39 (QA2-CRIT-001 fixed)", async () => {
      const stats = await direct.query(
        `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE target_url_template IS NULL)::int AS nulls
         FROM notification_templates
        WHERE company_id IS NULL AND deleted_at IS NULL`,
      );
      expect(
        stats.rows[0].nulls,
        "QA2-CRIT-001: KHÔNG template global nào được phép còn target_url NULL",
      ).toBe(0);
      expect(stats.rows[0].total, "0481 (36) + 0490 (3) = 39 template global").toBe(39);
    });

    it("(a) sample-map target_url_template khớp bảng §4 (placeholder + tĩnh)", async () => {
      expect(await globalTemplateUrl("TASK_ASSIGNED__IN_APP__vi-VN")).toBe("/tasks/{taskId}");
      expect(await globalTemplateUrl("TASK_COMMENT_CREATED__IN_APP__vi-VN")).toBe(
        "/tasks/{taskId}",
      );
      expect(await globalTemplateUrl("PROJECT_MEMBER_ADDED__IN_APP__vi-VN")).toBe(
        "/tasks/projects/{projectId}",
      );
      expect(await globalTemplateUrl("LEAVE_REQUEST_APPROVED__IN_APP__vi-VN")).toBe(
        "/leave/me/requests/{requestId}",
      );
      expect(await globalTemplateUrl("LEAVE_REQUEST_SUBMITTED__IN_APP__vi-VN")).toBe(
        "/leave/approvals",
      );
      expect(await globalTemplateUrl("ATT_ADJUSTMENT_APPROVED__IN_APP__vi-VN")).toBe(
        "/attendance/adjustment-requests/{requestId}",
      );
      expect(await globalTemplateUrl("ATT_REMOTE_REQUEST_SUBMITTED__IN_APP__vi-VN")).toBe(
        "/attendance/remote-work-requests/{requestId}",
      );
    });

    // ── (c) route TĨNH — TASK_DUE_SOON KHÔNG có placeholder (tránh bẫy 422 vì job payload thiếu taskId) ──
    it("(c) TASK_DUE_SOON template = /tasks/my-tasks (tĩnh, KHÔNG rò `{}` — job payload không có taskId)", async () => {
      const url = await globalTemplateUrl("TASK_DUE_SOON__IN_APP__vi-VN");
      expect(url).toBe("/tasks/my-tasks");
      expect(url).not.toContain("{");
    });

    // ── (b) P0 render deep-link THẬT qua bridge ─────────────────────────────────────────────────────

    it("(b) TASK_ASSIGNED → notification.target_url = /tasks/{taskId} (render THẬT, payload commonPayload)", async () => {
      const taskId = await mkAssignedTask("Việc deep-link assigned", "TSK-NFX1-A");
      await enqueue("task.assigned", {
        eventCode: "TASK_ASSIGNED",
        taskId,
        taskCode: "TSK-NFX1-A",
        taskTitle: "Việc deep-link assigned",
        projectId: null,
        actorUserId: managerUser, // actor-exclusion loại manager; recipient = assignee (employee)
      });
      await processOutbox();

      expect(await targetUrlOf(employeeUser, "TASK_ASSIGNED", taskId)).toBe(`/tasks/${taskId}`);
    });

    it("(b) TASK_COMMENT_CREATED → notification.target_url = /tasks/{taskId} (render THẬT)", async () => {
      const taskId = await mkAssignedTask("Việc deep-link comment", "TSK-NFX1-C");
      await enqueue("task.comment_created", {
        eventCode: "TASK_COMMENT_CREATED",
        taskId,
        taskCode: "TSK-NFX1-C",
        taskTitle: "Việc deep-link comment",
        commentId: randomUUID(),
        projectId: null,
        actorUserId: managerUser, // recipient = assignee (employee), creator=manager bị loại (actor)
      });
      await processOutbox();

      expect(await targetUrlOf(employeeUser, "TASK_COMMENT_CREATED", taskId)).toBe(
        `/tasks/${taskId}`,
      );
    });

    it("(b) LEAVE_REQUEST_APPROVED → notification.target_url = /leave/me/requests/{requestId} (requester)", async () => {
      const requestId = randomUUID();
      await enqueue("leave.request.approved", {
        requestId,
        userId: employeeUser, // recipient = requester
        actorUserId: hrUser, // approver bị loại
      });
      await processOutbox();

      expect(await targetUrlOf(employeeUser, "LEAVE_REQUEST_APPROVED", requestId)).toBe(
        `/leave/me/requests/${requestId}`,
      );
    });

    it("(b) LEAVE_REQUEST_REJECTED → notification.target_url = /leave/me/requests/{requestId} (requester)", async () => {
      const requestId = randomUUID();
      await enqueue("leave.request.rejected", {
        requestId,
        userId: employeeUser,
        actorUserId: hrUser,
      });
      await processOutbox();

      expect(await targetUrlOf(employeeUser, "LEAVE_REQUEST_REJECTED", requestId)).toBe(
        `/leave/me/requests/${requestId}`,
      );
    });

    it("(b) ATT_ADJUSTMENT_APPROVED → notification.target_url = /attendance/adjustment-requests/{requestId}", async () => {
      const requestId = randomUUID();
      await enqueue("attendance.adjustment_approved", {
        requestId,
        userId: employeeUser, // recipient = requester (subject)
        actorUserId: managerUser, // approver bị loại
      });
      await processOutbox();

      expect(await targetUrlOf(employeeUser, "ATT_ADJUSTMENT_APPROVED", requestId)).toBe(
        `/attendance/adjustment-requests/${requestId}`,
      );
    });
  },
);
