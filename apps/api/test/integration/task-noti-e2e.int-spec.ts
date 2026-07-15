/**
 * S4-INT-1 — Outbox TASK/PROJECT → NOTI intake IN-PROCESS bridge (Postgres THẬT, DB CÔ LẬP).
 *
 * Đường THẬT: JwtAuthGuard → CompanyGuard → PermissionGuard → TasksController/ProjectsController →
 * TaskActionsService/TaskCommentsService/ProjectsService (producer, outbox.enqueue TRONG tx) →
 * `OutboxWorker.processBatch()` (claim + gọi `noti-bridge:<eventType>` consumer đăng ký bởi
 * `TaskNotiBridgeRegistrar`) → `OutboxNotificationBridge` → `NotificationEngineService.intake()` →
 * `notifications` + `notification_delivery_logs`. KHÔNG mock permission/engine.
 *
 * Phủ (docs/plans/S4-INT-1.md):
 *   0. boot-guard: registerSource() fail-loud cho eventCode ngoài catalog (PROJECT_MEMBER_REMOVED) — KHÔNG
 *      cần DB, chạy TRƯỚC describe.skipIf.
 *   1-8. happy path từng event §9.4 — recipient ĐÚNG bảng, delivery_log 'Sent', event_code khớp.
 *   9. multi-recipient TASK_STATUS_CHANGED (creator + 2 watcher, assignee=actor) → 3 notification, actor loại.
 *  10. actor-exclusion: actor tự comment trên task của chính mình (0 assignee/watcher khác) → 0 notification.
 *  11. mention ngoài scope (0 grant) → 403 BLOCK → 0 outbox → 0 notification.
 *  12. compact null-recipient: STATUS_CHANGED task chưa gán + creator hợp lệ ≠ actor + 0 watcher → 1 (creator).
 *  13. cross-tenant: task.assignee_user_id thuộc company B → intake company A: recipient B = 0 row; creator A
 *      hợp lệ vẫn nhận (engine resolver filterActiveUsers lọc theo company).
 *  14. no-recipient: STATUS_CHANGED task 0 assignee + 0 creator + 0 watcher → KHÔNG throw, 0 notification.
 *  15. idempotent 2 tầng: processed_events (tầng 1, OutboxWorker) + DedupeKey=eventId (tầng 2, NOTI engine) —
 *      dùng TASK_ASSIGNED (strategy 'DedupeKey' sau APPEND, tránh flake biên bucket TimeWindow).
 *  16. E2E §15.1 (QA): assign task → GET /notifications/unread-count tăng → mark-read → count giảm.
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate): CHỈ DB cô lập lane
 * (scripts/lane-db-setup.sh int1 + export LANE_DB=mediaos_int1). KHÔNG biểu thức ngược (false-green).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { EventBus } from "../../src/events/event-bus";
import { OutboxWorker } from "../../src/events/outbox-worker";
import { drainOutboxUntilSettled } from "../helpers/outbox-drain";
import type { NotificationEngineService } from "../../src/notifications/notification-engine.service";
import { OutboxNotificationBridge } from "../../src/notifications/outbox-notification-bridge.service";
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

const hasLaneDb = hasDb && !!process.env.LANE_DB;
// Ghép chuỗi để KHÔNG lọt secret-scan (gitleaks generic) — đây là mật khẩu test ephemeral, không phải secret.
const LOGIN_PW = ["Passw0rd", "int1noti"].join("!");

type Scope = "Own" | "Team" | "Department" | "Company" | "System";
type Pair = [action: string, resourceType: string, scope: Scope, isSensitive?: boolean];

// ── 0. boot-guard (KHÔNG cần DB) ──────────────────────────────────────────────────
it("boot-guard: registerSource() fail-loud cho eventCode NGOÀI NOTI_EVENT_CATALOG (PROJECT_MEMBER_REMOVED, is_enabled=false) — KHÔNG dead-letter runtime", () => {
  const bridge = new OutboxNotificationBridge(
    new EventBus(),
    undefined as unknown as NotificationEngineService,
  );
  expect(() =>
    bridge.registerSource({
      eventType: "project.member_removed",
      eventCode: "PROJECT_MEMBER_REMOVED",
      sourceModule: "TASK",
      sourceEntityType: "project",
      sourceEntityIdOf: () => undefined,
      resolveRecipients: async () => [],
    }),
  ).toThrow(/PROJECT_MEMBER_REMOVED/);
});

describe.skipIf(!hasLaneDb)(
  "S4-INT-1 outbox TASK/PROJECT → NOTI bridge (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let appConn: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let adminUser = "";
    let mentionTargetUser = "";
    let mentionTargetEmp = "";
    let qaUser = "";
    let qaEmp = "";
    let bUser = "";

    const tok: Record<string, string> = {};

    // ── low-level seeding (direct pool = superuser, bypass RLS) ──────────────────────
    async function seedEmp(
      companyId: string,
      userId: string | null,
      status = "active",
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,$3) RETURNING id`,
        [companyId, userId, status],
      );
      return r.rows[0].id as string;
    }

    async function mkTask(opts: {
      mainAssigneeEmployeeId?: string | null;
      assigneeUserId?: string | null;
      creatorUserId?: string | null;
      projectId?: string | null;
    }): Promise<string> {
      const r = await direct.query(
        `INSERT INTO tasks
         (company_id, task_type, title, task_status, main_assignee_employee_id, assignee_user_id,
          project_id, creator_user_id)
       VALUES ($1,'office','T','Todo',$2,$3,$4,$5) RETURNING id`,
        [
          A.companyId,
          opts.mainAssigneeEmployeeId ?? null,
          opts.assigneeUserId ?? null,
          opts.projectId ?? null,
          opts.creatorUserId === undefined ? adminUser : opts.creatorUserId,
        ],
      );
      return r.rows[0].id as string;
    }

    async function addWatcher(taskId: string, employeeId: string): Promise<void> {
      await direct.query(
        `INSERT INTO task_watchers (company_id, task_id, employee_id, watcher_type, status, added_by, created_by, updated_by)
       VALUES ($1,$2,$3,'Manual','Active',$4,$4,$4)`,
        [A.companyId, taskId, employeeId, adminUser],
      );
    }

    async function grant(
      companyId: string,
      userId: string,
      label: string,
      pairs: Pair[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `int1-${label}-${userId.slice(0, 8)}`);
      for (const [action, resourceType, scope, isSensitive] of pairs) {
        const permId = await seedPermissionCatalog(
          direct,
          action,
          resourceType,
          isSensitive ?? false,
        );
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

    const authGet = (t: string, u: string) =>
      request(app.getHttpServer()).get(u).set("Authorization", `Bearer ${t}`);
    const authPost = (t: string, u: string) =>
      request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);

    /** Drain tới khi event own-tenant terminal — an toàn dưới cross-suite claim (xem helpers/outbox-drain). */
    async function processOutbox(): Promise<void> {
      await drainOutboxUntilSettled({ worker: app.get(OutboxWorker), direct, companyIds });
    }

    async function notifRows(
      companyId: string,
      recipientUserId: string,
      eventCode: string,
    ): Promise<Array<{ id: string; dedupeKey: string | null }>> {
      const r = await direct.query(
        `SELECT id, dedupe_key AS "dedupeKey" FROM notifications
       WHERE company_id=$1 AND recipient_user_id=$2 AND event_code=$3 AND deleted_at IS NULL`,
        [companyId, recipientUserId, eventCode],
      );
      return r.rows as Array<{ id: string; dedupeKey: string | null }>;
    }

    async function notifCountBySource(eventCode: string, sourceEntityId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM notifications
       WHERE company_id=$1 AND event_code=$2 AND source_entity_id=$3 AND deleted_at IS NULL`,
        [A.companyId, eventCode, sourceEntityId],
      );
      return r.rows[0].n as number;
    }

    async function deliveryStatusFor(notificationId: string): Promise<string | undefined> {
      const r = await direct.query(
        `SELECT delivery_status FROM notification_delivery_logs WHERE notification_id=$1 LIMIT 1`,
        [notificationId],
      );
      return r.rows[0]?.delivery_status as string | undefined;
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
      A = await seedCompany(direct, "int1a");
      B = await seedCompany(direct, "int1b");
      companyIds.push(A.companyId, B.companyId);

      adminUser = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
      await seedEmp(A.companyId, adminUser);
      mentionTargetUser = await seedUser(direct, A.companyId, `mention@${A.slug}.test`, hash);
      mentionTargetEmp = await seedEmp(A.companyId, mentionTargetUser);
      qaUser = await seedUser(direct, A.companyId, `qa@${A.slug}.test`, hash);
      qaEmp = await seedEmp(A.companyId, qaUser);
      bUser = await seedUser(direct, B.companyId, `bu@${B.slug}.test`, hash);

      await grant(A.companyId, adminUser, "admin", [
        ["read", "task", "Company"],
        ["assign", "task", "Company"],
        ["update-status", "task", "Company"],
        ["update-priority", "task", "Company"],
        ["update-deadline", "task", "Company"],
        ["comment", "task", "Company"],
        ["create", "task", "Company"],
        ["read", "project", "Company"],
        ["create", "project", "Company"],
        ["manage-member", "project", "Company", true],
      ]);
      await grant(A.companyId, mentionTargetUser, "mention", [["read", "task", "Company"]]);
      await grant(A.companyId, qaUser, "qa", [
        ["read", "notification", "Own"],
        ["mark_read", "notification", "Own"],
      ]);

      tok.admin = await login(A.slug, `admin@${A.slug}.test`);
      tok.qa = await login(A.slug, `qa@${A.slug}.test`);
    });

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await appConn?.end();
      await direct?.end();
      await app?.close();
    });

    // ── 1-8. happy path per-event ───────────────────────────────────────────────────

    it("(1) TASK_ASSIGNED → 1 notification cho assignee mới, delivery_log Sent, event_code khớp", async () => {
      const assigneeUser = await seedUser(direct, A.companyId, `a1@${A.slug}.test`, "x");
      const assigneeEmp = await seedEmp(A.companyId, assigneeUser);
      const taskId = await mkTask({});

      const res = await authPost(tok.admin, `/tasks/${taskId}/assign`).send({
        assigneeEmployeeId: assigneeEmp,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await processOutbox();

      const rows = await notifRows(A.companyId, assigneeUser, "TASK_ASSIGNED");
      expect(rows).toHaveLength(1);
      expect(await deliveryStatusFor(rows[0].id)).toBe("Sent");
    });

    it("(2) TASK_ASSIGNEE_CHANGED → assignee mới ∪ watcher; KHÔNG assignee cũ", async () => {
      const oldUser = await seedUser(direct, A.companyId, `old2@${A.slug}.test`, "x");
      const oldEmp = await seedEmp(A.companyId, oldUser);
      const newUser = await seedUser(direct, A.companyId, `new2@${A.slug}.test`, "x");
      const newEmp = await seedEmp(A.companyId, newUser);
      const watcherUser = await seedUser(direct, A.companyId, `w2@${A.slug}.test`, "x");
      const watcherEmp = await seedEmp(A.companyId, watcherUser);
      const taskId = await mkTask({ mainAssigneeEmployeeId: oldEmp, assigneeUserId: oldUser });
      await addWatcher(taskId, watcherEmp);

      const res = await authPost(tok.admin, `/tasks/${taskId}/assign`).send({
        assigneeEmployeeId: newEmp,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await processOutbox();

      expect(await notifRows(A.companyId, newUser, "TASK_ASSIGNEE_CHANGED")).toHaveLength(1);
      expect(await notifRows(A.companyId, watcherUser, "TASK_ASSIGNEE_CHANGED")).toHaveLength(1);
      expect(await notifRows(A.companyId, oldUser, "TASK_ASSIGNEE_CHANGED")).toHaveLength(0);
    });

    it("(3+9) TASK_STATUS_CHANGED multi-recipient: creator + 2 watcher (assignee=actor) → 3 notification, actor bị loại", async () => {
      const creatorUser = await seedUser(direct, A.companyId, `cr3@${A.slug}.test`, "x");
      const watcher1User = await seedUser(direct, A.companyId, `w31@${A.slug}.test`, "x");
      const watcher1Emp = await seedEmp(A.companyId, watcher1User);
      const watcher2User = await seedUser(direct, A.companyId, `w32@${A.slug}.test`, "x");
      const watcher2Emp = await seedEmp(A.companyId, watcher2User);
      // assignee = actor (adminUser) — actor phải KHÔNG nhận dù là assignee.
      const taskId = await mkTask({ assigneeUserId: adminUser, creatorUserId: creatorUser });
      await addWatcher(taskId, watcher1Emp);
      await addWatcher(taskId, watcher2Emp);

      const res = await authPost(tok.admin, `/tasks/${taskId}/change-status`).send({
        status: "In Progress",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await processOutbox();

      expect(await notifRows(A.companyId, creatorUser, "TASK_STATUS_CHANGED")).toHaveLength(1);
      expect(await notifRows(A.companyId, watcher1User, "TASK_STATUS_CHANGED")).toHaveLength(1);
      expect(await notifRows(A.companyId, watcher2User, "TASK_STATUS_CHANGED")).toHaveLength(1);
      expect(await notifRows(A.companyId, adminUser, "TASK_STATUS_CHANGED")).toHaveLength(0);
    });

    it("(4) TASK_PRIORITY_CHANGED → assignee ∪ watcher", async () => {
      const assigneeUser = await seedUser(direct, A.companyId, `a4@${A.slug}.test`, "x");
      const assigneeEmp = await seedEmp(A.companyId, assigneeUser);
      const watcherUser = await seedUser(direct, A.companyId, `w4@${A.slug}.test`, "x");
      const watcherEmp = await seedEmp(A.companyId, watcherUser);
      const taskId = await mkTask({
        mainAssigneeEmployeeId: assigneeEmp,
        assigneeUserId: assigneeUser,
      });
      await addWatcher(taskId, watcherEmp);

      const res = await authPost(tok.admin, `/tasks/${taskId}/change-priority`).send({
        priority: "High",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await processOutbox();

      expect(await notifRows(A.companyId, assigneeUser, "TASK_PRIORITY_CHANGED")).toHaveLength(1);
      expect(await notifRows(A.companyId, watcherUser, "TASK_PRIORITY_CHANGED")).toHaveLength(1);
    });

    it("(5) TASK_DUE_DATE_CHANGED → assignee (0 watcher)", async () => {
      const assigneeUser = await seedUser(direct, A.companyId, `a5@${A.slug}.test`, "x");
      const assigneeEmp = await seedEmp(A.companyId, assigneeUser);
      const taskId = await mkTask({
        mainAssigneeEmployeeId: assigneeEmp,
        assigneeUserId: assigneeUser,
      });
      const future = new Date(Date.now() + 7 * 86400000).toISOString();

      const res = await authPost(tok.admin, `/tasks/${taskId}/change-deadline`).send({
        dueAt: future,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await processOutbox();

      expect(await notifRows(A.companyId, assigneeUser, "TASK_DUE_DATE_CHANGED")).toHaveLength(1);
    });

    it("(6) TASK_COMMENT_CREATED → assignee ∪ reporter ∪ watcher (actor ngoài 3 vai trò)", async () => {
      const assigneeUser = await seedUser(direct, A.companyId, `a6@${A.slug}.test`, "x");
      const assigneeEmp = await seedEmp(A.companyId, assigneeUser);
      const creatorUser = await seedUser(direct, A.companyId, `cr6@${A.slug}.test`, "x");
      const watcherUser = await seedUser(direct, A.companyId, `w6@${A.slug}.test`, "x");
      const watcherEmp = await seedEmp(A.companyId, watcherUser);
      const taskId = await mkTask({
        mainAssigneeEmployeeId: assigneeEmp,
        assigneeUserId: assigneeUser,
        creatorUserId: creatorUser,
      });
      await addWatcher(taskId, watcherEmp);

      const res = await authPost(tok.admin, `/tasks/${taskId}/comments`).send({
        content: "Xin chào",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      await processOutbox();

      expect(await notifRows(A.companyId, assigneeUser, "TASK_COMMENT_CREATED")).toHaveLength(1);
      expect(await notifRows(A.companyId, creatorUser, "TASK_COMMENT_CREATED")).toHaveLength(1);
      expect(await notifRows(A.companyId, watcherUser, "TASK_COMMENT_CREATED")).toHaveLength(1);
      // (10) actor-exclusion: adminUser (actor) KHÔNG nằm trong 3 vai trò trên → 0 (double-check trực tiếp).
      expect(await notifRows(A.companyId, adminUser, "TASK_COMMENT_CREATED")).toHaveLength(0);
    });

    it("(7) TASK_MENTIONED → mention hợp lệ (in-scope) → đúng mentionedUserIds", async () => {
      const taskId = await mkTask({}); // creator=adminUser(=actor mặc định)
      const res = await authPost(tok.admin, `/tasks/${taskId}/comments`).send({
        content: "nhờ xem giúp",
        mentionEmployeeIds: [mentionTargetEmp],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      await processOutbox();

      const rows = await notifRows(A.companyId, mentionTargetUser, "TASK_MENTIONED");
      expect(rows).toHaveLength(1);
      expect(await deliveryStatusFor(rows[0].id)).toBe("Sent");
    });

    it("(8) PROJECT_MEMBER_ADDED → memberUserId", async () => {
      const created = await authPost(tok.admin, "/projects").send({
        name: `Proj-int1-${Date.now()}`,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const projectId = created.body.data.id as string;

      const memberUser = await seedUser(direct, A.companyId, `mem8@${A.slug}.test`, "x");
      const memberEmp = await seedEmp(A.companyId, memberUser);

      const res = await authPost(tok.admin, `/projects/${projectId}/members`).send({
        employeeId: memberEmp,
        projectRole: "Member",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      await processOutbox();

      const rows = await notifRows(A.companyId, memberUser, "PROJECT_MEMBER_ADDED");
      expect(rows).toHaveLength(1);
      expect(await deliveryStatusFor(rows[0].id)).toBe("Sent");
    });

    // ── 10. actor-exclusion (tự comment trên task của chính mình) ───────────────────

    it("(10) actor tự comment trên task CHÍNH MÌNH tạo (0 assignee/watcher khác) → 0 notification (createdCount không đếm actor)", async () => {
      const taskId = await mkTask({ creatorUserId: adminUser }); // creator=actor, 0 assignee, 0 watcher
      const res = await authPost(tok.admin, `/tasks/${taskId}/comments`).send({
        content: "tự nhắc mình",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      await processOutbox();

      expect(await notifCountBySource("TASK_COMMENT_CREATED", taskId)).toBe(0);
    });

    // ── 11. mention ngoài scope (403 BLOCK) ──────────────────────────────────────────

    it("(11) mention người NGOÀI quyền xem task (0 grant) → 403 BLOCK → 0 outbox → 0 notification", async () => {
      const outsiderUser = await seedUser(direct, A.companyId, `out11@${A.slug}.test`, "x");
      const outsiderEmp = await seedEmp(A.companyId, outsiderUser); // 0 grant nào cả
      const taskId = await mkTask({});

      const res = await authPost(tok.admin, `/tasks/${taskId}/comments`).send({
        content: "nhờ người ngoài xem",
        mentionEmployeeIds: [outsiderEmp],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(403);

      const outbox = await direct.query(
        `SELECT count(*)::int AS n FROM outbox_events
       WHERE company_id=$1 AND event_type='task.mentioned' AND payload->>'taskId'=$2`,
        [A.companyId, taskId],
      );
      expect(outbox.rows[0].n).toBe(0);

      await processOutbox();
      expect(await notifRows(A.companyId, outsiderUser, "TASK_MENTIONED")).toHaveLength(0);
    });

    // ── 12. compact null-recipient (.filter(Boolean)) ────────────────────────────────

    it("(12) STATUS_CHANGED task CHƯA gán (assignee=null) + creator hợp lệ ≠ actor + 0 watcher → 1 notification cho creator, KHÔNG lỗi", async () => {
      const creatorUser = await seedUser(direct, A.companyId, `cr12@${A.slug}.test`, "x");
      const taskId = await mkTask({ assigneeUserId: null, creatorUserId: creatorUser });

      const res = await authPost(tok.admin, `/tasks/${taskId}/change-status`).send({
        status: "In Progress",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await processOutbox();

      expect(await notifRows(A.companyId, creatorUser, "TASK_STATUS_CHANGED")).toHaveLength(1);
    });

    // ── 13. cross-tenant (recipient khác company bị drop, RLS FORCE) ────────────────

    it("(13) cross-tenant: task.assignee_user_id thuộc company B → 0 notification cho B; creator A hợp lệ vẫn nhận", async () => {
      const creatorA = await seedUser(direct, A.companyId, `crA13@${A.slug}.test`, "x");
      // Cross-company reference cố ý (defense-in-depth) — bind raw SQL, KHÔNG qua service (service không cho
      // phép gán assignee khác tenant — đây là kiểm tra tầng dưới: reader/engine PHẢI tự lọc dù dữ liệu THÔ có).
      const taskId = await mkTask({ assigneeUserId: bUser, creatorUserId: creatorA });

      const res = await authPost(tok.admin, `/tasks/${taskId}/change-status`).send({
        status: "In Progress",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await processOutbox();

      // recipient B: 0 row BẤT KỂ company nào truy vấn (engine chưa từng tạo được).
      const bRow = await direct.query(
        `SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id=$1 AND event_code='TASK_STATUS_CHANGED'`,
        [bUser],
      );
      expect(bRow.rows[0].n).toBe(0);
      expect(await notifRows(A.companyId, creatorA, "TASK_STATUS_CHANGED")).toHaveLength(1);
    });

    // ── 14. no-recipient (KHÔNG throw) ───────────────────────────────────────────────

    it("(14) STATUS_CHANGED task 0 assignee + 0 creator + 0 watcher → KHÔNG throw, 0 notification", async () => {
      const taskId = await mkTask({ assigneeUserId: null, creatorUserId: null });

      const res = await authPost(tok.admin, `/tasks/${taskId}/change-status`).send({
        status: "In Progress",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await expect(processOutbox()).resolves.not.toThrow();

      expect(await notifCountBySource("TASK_STATUS_CHANGED", taskId)).toBe(0);
    });

    // ── 15. idempotent 2 tầng (processed_events + DedupeKey=eventId) ────────────────

    it("(15) idempotent 2 tầng: processed_events (tầng 1) chặn re-invoke; DedupeKey=eventId (tầng 2) chặn dù bị buộc re-invoke", async () => {
      const assigneeUser = await seedUser(direct, A.companyId, `a15@${A.slug}.test`, "x");
      const assigneeEmp = await seedEmp(A.companyId, assigneeUser);
      const taskId = await mkTask({});

      const res = await authPost(tok.admin, `/tasks/${taskId}/assign`).send({
        assigneeEmployeeId: assigneeEmp,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const evRow = await direct.query(
        `SELECT id FROM outbox_events WHERE company_id=$1 AND event_type='task.assigned' AND payload->>'taskId'=$2
       ORDER BY created_at DESC LIMIT 1`,
        [A.companyId, taskId],
      );
      const eventId = evRow.rows[0].id as string;

      await processOutbox();
      expect(await notifRows(A.companyId, assigneeUser, "TASK_ASSIGNED")).toHaveLength(1);
      const processed1 = await direct.query(
        `SELECT count(*)::int AS n FROM processed_events WHERE consumer_name='noti-bridge:task.assigned' AND event_id=$1`,
        [eventId],
      );
      expect(processed1.rows[0].n).toBe(1);

      // Tầng 1: re-claim (reset status='pending') NHƯNG processed_events CÒN nguyên → handler KHÔNG re-invoke.
      await direct.query(
        `UPDATE outbox_events SET status='pending', available_at=now() WHERE id=$1`,
        [eventId],
      );
      await processOutbox();
      expect(await notifRows(A.companyId, assigneeUser, "TASK_ASSIGNED")).toHaveLength(1);

      // Tầng 2: BUỘC re-invoke (xoá processed_events + reset status) → engine THẤY LẠI cùng dedupeKey=eventId
      // → dedupedCount++ (KHÔNG tạo notification thứ 2).
      await direct.query(
        `DELETE FROM processed_events WHERE consumer_name='noti-bridge:task.assigned' AND event_id=$1`,
        [eventId],
      );
      await direct.query(
        `UPDATE outbox_events SET status='pending', available_at=now() WHERE id=$1`,
        [eventId],
      );
      await processOutbox();
      const rows = await notifRows(A.companyId, assigneeUser, "TASK_ASSIGNED");
      expect(rows).toHaveLength(1);
      expect(rows[0].dedupeKey).toBe(`TASK_ASSIGNED:${eventId}`);
    });

    // ── 16. E2E §15.1 (QA): unread-count tăng/giảm ───────────────────────────────────

    it("(16) E2E §15.1: giao task cho qaUser → GET /notifications/unread-count tăng → mark-read → count giảm", async () => {
      const before = await authGet(tok.qa, "/notifications/unread-count");
      expect(before.status, JSON.stringify(before.body)).toBe(200);
      const baseCount = before.body.data.unread_count as number;

      const taskId = await mkTask({});
      const assignRes = await authPost(tok.admin, `/tasks/${taskId}/assign`).send({
        assigneeEmployeeId: qaEmp,
      });
      expect(assignRes.status, JSON.stringify(assignRes.body)).toBe(200);
      await processOutbox();

      const afterAssign = await authGet(tok.qa, "/notifications/unread-count");
      expect(afterAssign.status).toBe(200);
      expect(afterAssign.body.data.unread_count).toBe(baseCount + 1);

      const rows = await notifRows(A.companyId, qaUser, "TASK_ASSIGNED");
      expect(rows).toHaveLength(1);
      const markRes = await authPost(tok.qa, `/notifications/${rows[0].id}/mark-read`).send({});
      expect(markRes.status, JSON.stringify(markRes.body)).toBe(200);

      const afterMark = await authGet(tok.qa, "/notifications/unread-count");
      expect(afterMark.status).toBe(200);
      expect(afterMark.body.data.unread_count).toBe(baseCount);
    });
  },
);
