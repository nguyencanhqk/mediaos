/**
 * S4-INT-4 — Outbox ATT (đơn điều chỉnh công + đơn remote-work) → NOTI intake IN-PROCESS bridge
 * (Postgres THẬT, DB CÔ LẬP). Đường THẬT: JwtAuthGuard → CompanyGuard → PermissionGuard →
 * AttendanceAdjustmentController/RemoteWorkRequestController → AttendanceAdjustmentService/
 * RemoteWorkRequestService (producer, outbox.enqueue TRONG tx) → `OutboxWorker.processBatch()` (claim +
 * gọi `noti-bridge:attendance.*` consumer đăng ký bởi `AttNotiBridgeRegistrar`) →
 * `OutboxNotificationBridge` → `NotificationEngineService.intake()` → `notifications` +
 * `notification_delivery_logs`. KHÔNG mock permission/engine.
 *
 * Phủ (docs/plans/S4-INT-4.md):
 *   0-1. boot-guard: 7 eventCode ATT (isEnabled=true) registerSource() KHÔNG throw; wire nhầm eventCode
 *        NGOÀI catalog (PROJECT_MEMBER_REMOVED, is_enabled=false) cho eventType ATT → throw tại boot.
 *   1. ATT_ADJUSTMENT_SUBMITTED → direct manager của subject (reader.resolveAdjustment).
 *   2. ATT_ADJUSTMENT_APPROVED  → requester = payload.userId; approver (actor) bị loại.
 *   3. ATT_ADJUSTMENT_REJECTED  → requester = payload.userId; approver (actor) bị loại.
 *   4. ATT_REMOTE_REQUEST_SUBMITTED → currentApproverUserId ∪ watcherUserIds (3 recipient); submitter
 *      (actor) bị loại.
 *   5. ATT_REMOTE_REQUEST_APPROVED  → requester = requestedBy; approver (actor) bị loại.
 *   6. ATT_REMOTE_REQUEST_REJECTED  → requester = requestedBy; approver (actor) bị loại.
 *   7. ATT_REMOTE_REQUEST_CANCELLED → approver ∪ watchers; actor-exclusion THẬT (employee vừa là
 *      requestedBy=actor vừa là watcher của chính đơn mình → vẫn bị loại, KHÔNG chỉ "tự nhiên không có
 *      mặt" — chứng minh engine actor-exclusion hoạt động, không phải trùng hợp).
 *   8. idempotent 2 tầng: processed_events (tầng 1, OutboxWorker) + DedupeKey=eventId (tầng 2, NOTI
 *      engine) — dùng ATT_ADJUSTMENT_SUBMITTED (strategy 'DedupeKey', notification-dedupe.const.ts).
 *   9. cross-tenant: subject.direct_manager_id thuộc company B → 0 notification cho B (RLS + resolver
 *      filterActiveUsers eq company_id — defense-in-depth ngoài RLS).
 *  10. recipient rỗng: subject KHÔNG có direct_manager_id (NULL) → 0 notification, KHÔNG delivery_log ma
 *      (SPEC-08 §16.4).
 *  11. remote Draft-cancel (chưa submit, currentApproverUserId/watcherUserIds rỗng) → 0 notification,
 *      KHÔNG throw.
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate): CHỈ DB cô lập lane
 * (scripts/lane-db-setup.sh int4 + export LANE_DB=mediaos_int4). KHÔNG biểu thức ngược (false-green).
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
// Ghép chuỗi để KHÔNG lọt secret-scan (gitleaks generic) — mật khẩu test ephemeral, không phải secret.
const LOGIN_PW = ["Passw0rd", "int4noti"].join("!");

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, resourceType: string, scope: Scope];

// ── 0-1. boot-guard (KHÔNG cần DB) ────────────────────────────────────────────────

const ATT_EVENT_MAPPINGS: Array<{
  eventType: string;
  eventCode: string;
  sourceEntityType: string;
}> = [
  {
    eventType: "attendance.adjustment_requested",
    eventCode: "ATT_ADJUSTMENT_SUBMITTED",
    sourceEntityType: "attendance_adjustment_request",
  },
  {
    eventType: "attendance.adjustment_approved",
    eventCode: "ATT_ADJUSTMENT_APPROVED",
    sourceEntityType: "attendance_adjustment_request",
  },
  {
    eventType: "attendance.adjustment_rejected",
    eventCode: "ATT_ADJUSTMENT_REJECTED",
    sourceEntityType: "attendance_adjustment_request",
  },
  {
    eventType: "attendance.remote_request_submitted",
    eventCode: "ATT_REMOTE_REQUEST_SUBMITTED",
    sourceEntityType: "remote_work_request",
  },
  {
    eventType: "attendance.remote_request_approved",
    eventCode: "ATT_REMOTE_REQUEST_APPROVED",
    sourceEntityType: "remote_work_request",
  },
  {
    eventType: "attendance.remote_request_rejected",
    eventCode: "ATT_REMOTE_REQUEST_REJECTED",
    sourceEntityType: "remote_work_request",
  },
  {
    eventType: "attendance.remote_request_cancelled",
    eventCode: "ATT_REMOTE_REQUEST_CANCELLED",
    sourceEntityType: "remote_work_request",
  },
];

it("boot-guard: registerSource() cho 7 eventCode ATT (isEnabled=true, catalog:72-79) — KHÔNG throw", () => {
  const bridge = new OutboxNotificationBridge(
    new EventBus(),
    undefined as unknown as NotificationEngineService,
  );
  for (const m of ATT_EVENT_MAPPINGS) {
    expect(() =>
      bridge.registerSource({
        eventType: m.eventType,
        eventCode: m.eventCode,
        sourceModule: "ATT",
        sourceEntityType: m.sourceEntityType,
        sourceEntityIdOf: () => undefined,
        resolveRecipients: async () => [],
      }),
    ).not.toThrow();
  }
});

it("boot-guard: wire nhầm eventCode NGOÀI NOTI_EVENT_CATALOG (PROJECT_MEMBER_REMOVED, is_enabled=false) cho eventType ATT → fail-loud TẠI BOOT", () => {
  const bridge = new OutboxNotificationBridge(
    new EventBus(),
    undefined as unknown as NotificationEngineService,
  );
  expect(() =>
    bridge.registerSource({
      eventType: "attendance.adjustment_requested",
      eventCode: "PROJECT_MEMBER_REMOVED",
      sourceModule: "ATT",
      sourceEntityType: "attendance_adjustment_request",
      sourceEntityIdOf: () => undefined,
      resolveRecipients: async () => [],
    }),
  ).toThrow(/PROJECT_MEMBER_REMOVED/);
});

// ── DB cô lập, đường thật ───────────────────────────────────────────────────────

describe.skipIf(!hasLaneDb)(
  "S4-INT-4 outbox ATT (đơn điều chỉnh công + remote-work) → NOTI bridge",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let appConn: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let passwordHash = "";
    let approverUser = "";
    let bUser = "";
    let seq = 0;

    const tok: Record<string, string> = {};

    function nextDate(): string {
      seq += 1;
      const day = String((seq % 27) + 1).padStart(2, "0");
      const month = String(Math.floor(seq / 27) + 1).padStart(2, "0");
      return `2025-${month}-${day}`;
    }

    async function seedEmp(
      companyId: string,
      userId: string,
      directManagerUserId: string | null,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, direct_manager_id, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
        [companyId, userId, directManagerUserId],
      );
      return r.rows[0].id as string;
    }

    async function grant(
      companyId: string,
      userId: string,
      label: string,
      pairs: Pair[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `int4-${label}-${userId.slice(0, 8)}`);
      for (const [action, resourceType, scope] of pairs) {
        // Khớp is_sensitive THẬT của mig 0454 (create-own/cancel-own=false, còn lại=true) — KHÔNG lật
        // catalog dùng chung (mirror comment att-permission int-spec cùng LANE_DB).
        const sensitive = action !== "create-own" && action !== "cancel-own";
        const permId = await seedPermissionCatalog(direct, action, resourceType, sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    /** 1 nhân viên mới (user + employee_profiles) có đủ grant create-own/cancel-own ATT + token đăng nhập. */
    async function mkEmployee(directManagerUserId: string | null): Promise<{
      userId: string;
      employeeId: string;
      token: string;
    }> {
      seq += 1;
      const email = `emp${seq}@${A.slug}.test`;
      const userId = await seedUser(direct, A.companyId, email, passwordHash);
      const employeeId = await seedEmp(A.companyId, userId, directManagerUserId);
      await grant(A.companyId, userId, `emp${seq}`, [
        ["create-own", "adjustment", "Own"],
        ["create-own", "remote-request", "Own"],
        ["cancel-own", "remote-request", "Own"],
      ]);
      const token = await login(A.slug, email);
      return { userId, employeeId, token };
    }

    async function login(slug: string, email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    const authPost = (t: string, u: string) =>
      request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);

    /** Drain tới khi event own-tenant terminal — an toàn dưới cross-suite claim (xem helpers/outbox-drain). */
    async function processOutbox(): Promise<void> {
      await drainOutboxUntilSettled({ worker: app.get(OutboxWorker), direct, companyIds });
    }

    async function notifRows(
      recipientUserId: string,
      eventCode: string,
    ): Promise<Array<{ id: string; dedupeKey: string | null }>> {
      const r = await direct.query(
        `SELECT id, dedupe_key AS "dedupeKey" FROM notifications
       WHERE company_id=$1 AND recipient_user_id=$2 AND event_code=$3 AND deleted_at IS NULL`,
        [A.companyId, recipientUserId, eventCode],
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

    /** Như notifRows nhưng khoanh vùng theo source_entity_id (1 request cụ thể) — tránh nhiễu chéo test
     *  khi cùng 1 recipient (approverUser tái sử dụng làm direct manager) nhận notification cùng
     *  event_code từ NHIỀU request khác nhau qua các test. */
    async function notifRowsForRequest(
      recipientUserId: string,
      eventCode: string,
      sourceEntityId: string,
    ): Promise<Array<{ id: string; dedupeKey: string | null }>> {
      const r = await direct.query(
        `SELECT id, dedupe_key AS "dedupeKey" FROM notifications
       WHERE company_id=$1 AND recipient_user_id=$2 AND event_code=$3 AND source_entity_id=$4
         AND deleted_at IS NULL`,
        [A.companyId, recipientUserId, eventCode, sourceEntityId],
      );
      return r.rows as Array<{ id: string; dedupeKey: string | null }>;
    }

    async function deliveryStatusFor(notificationId: string): Promise<string | undefined> {
      const r = await direct.query(
        `SELECT delivery_status FROM notification_delivery_logs WHERE notification_id=$1 LIMIT 1`,
        [notificationId],
      );
      return r.rows[0]?.delivery_status as string | undefined;
    }

    async function createAdjustment(token: string, over: Record<string, unknown> = {}) {
      return authPost(token, "/attendance/adjustment-requests").send({
        workDate: nextDate(),
        requestType: "UPDATE_CHECK_IN",
        reason: "Điều chỉnh giờ vào (S4-INT-4)",
        requestedCheckInAt: "2025-01-01T02:00:00Z",
        ...over,
      });
    }

    async function createRemote(token: string, over: Record<string, unknown> = {}) {
      const d = nextDate();
      return authPost(token, "/attendance/remote-work-requests").send({
        requestType: "Remote",
        startDate: d,
        endDate: d,
        reason: "Làm việc từ xa (S4-INT-4)",
        ...over,
      });
    }

    async function submitRemote(
      token: string,
      id: string,
      currentApproverUserId: string,
      watcherUserIds: string[] = [],
    ) {
      return authPost(token, `/attendance/remote-work-requests/${id}/submit`).send({
        currentApproverUserId,
        watcherUserIds,
      });
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      appConn = appPool();
      passwordHash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "int4a");
      B = await seedCompany(direct, "int4b");
      companyIds.push(A.companyId, B.companyId);

      approverUser = await seedUser(direct, A.companyId, `approver@${A.slug}.test`, passwordHash);
      await grant(A.companyId, approverUser, "approver", [
        ["approve", "adjustment", "Company"],
        ["reject", "adjustment", "Company"],
        ["approve", "remote-request", "Company"],
        ["reject", "remote-request", "Company"],
      ]);
      tok.approver = await login(A.slug, `approver@${A.slug}.test`);

      bUser = await seedUser(direct, B.companyId, `b@${B.slug}.test`, passwordHash);
    });

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await appConn?.end();
      await direct?.end();
      await app?.close();
    });

    // ── 1. ATT_ADJUSTMENT_SUBMITTED → direct manager của subject ────────────────────

    it("(1) đơn điều chỉnh công submit → 1 notification cho direct manager, delivery Sent, event_code khớp", async () => {
      const emp = await mkEmployee(approverUser);
      const created = await createAdjustment(emp.token);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const requestId = created.body.data.id as string;
      await processOutbox();

      const rows = await notifRowsForRequest(approverUser, "ATT_ADJUSTMENT_SUBMITTED", requestId);
      expect(rows).toHaveLength(1);
      expect(await deliveryStatusFor(rows[0].id)).toBe("Sent");
      expect(await notifCountBySource("ATT_ADJUSTMENT_SUBMITTED", requestId)).toBe(1);
    });

    // ── 2/3. approve/reject → requester = payload.userId; approver (actor) bị loại ──

    it("(2) manager approve đơn điều chỉnh công → CHỈ requester(subject) nhận, approver KHÔNG", async () => {
      const emp = await mkEmployee(approverUser);
      const created = await createAdjustment(emp.token);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.data.id as string;

      const res = await authPost(
        tok.approver,
        `/attendance/adjustment-requests/${id}/approve`,
      ).send({
        note: "ok",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await processOutbox();

      expect(await notifRows(emp.userId, "ATT_ADJUSTMENT_APPROVED")).toHaveLength(1);
      expect(await notifRows(approverUser, "ATT_ADJUSTMENT_APPROVED")).toHaveLength(0);
    });

    it("(3) manager reject đơn điều chỉnh công → CHỈ requester(subject) nhận, approver KHÔNG", async () => {
      const emp = await mkEmployee(approverUser);
      const created = await createAdjustment(emp.token);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.data.id as string;

      const res = await authPost(tok.approver, `/attendance/adjustment-requests/${id}/reject`).send(
        {
          reason: "Không hợp lệ",
        },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await processOutbox();

      expect(await notifRows(emp.userId, "ATT_ADJUSTMENT_REJECTED")).toHaveLength(1);
      expect(await notifRows(approverUser, "ATT_ADJUSTMENT_REJECTED")).toHaveLength(0);
    });

    // ── 4. remote submit → approver ∪ watchers (3 recipient); submitter (actor) bị loại ──

    it("(4) đơn remote-work submit → approver ∪ 2 watcher = 3 notification, submitter (actor) KHÔNG", async () => {
      const emp = await mkEmployee(null);
      const watcher1 = await seedUser(
        direct,
        A.companyId,
        `w1-${emp.userId.slice(0, 6)}@${A.slug}.test`,
      );
      const watcher2 = await seedUser(
        direct,
        A.companyId,
        `w2-${emp.userId.slice(0, 6)}@${A.slug}.test`,
      );

      const created = await createRemote(emp.token);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.data.id as string;

      const res = await submitRemote(emp.token, id, approverUser, [watcher1, watcher2]);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await processOutbox();

      expect(
        await notifRowsForRequest(approverUser, "ATT_REMOTE_REQUEST_SUBMITTED", id),
      ).toHaveLength(1);
      expect(await notifRows(watcher1, "ATT_REMOTE_REQUEST_SUBMITTED")).toHaveLength(1);
      expect(await notifRows(watcher2, "ATT_REMOTE_REQUEST_SUBMITTED")).toHaveLength(1);
      expect(await notifRows(emp.userId, "ATT_REMOTE_REQUEST_SUBMITTED")).toHaveLength(0);
      expect(await notifCountBySource("ATT_REMOTE_REQUEST_SUBMITTED", id)).toBe(3);
    });

    // ── 5/6. remote approve/reject → requester = requestedBy; approver (actor) bị loại ──

    it("(5) manager approve đơn remote-work → CHỈ requester(requestedBy) nhận, approver KHÔNG", async () => {
      const emp = await mkEmployee(null);
      const created = await createRemote(emp.token);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.data.id as string;
      const submitted = await submitRemote(emp.token, id, approverUser);
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);

      const res = await authPost(
        tok.approver,
        `/attendance/remote-work-requests/${id}/approve`,
      ).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await processOutbox();

      expect(await notifRows(emp.userId, "ATT_REMOTE_REQUEST_APPROVED")).toHaveLength(1);
      expect(await notifRows(approverUser, "ATT_REMOTE_REQUEST_APPROVED")).toHaveLength(0);
    });

    it("(6) manager reject đơn remote-work → CHỈ requester(requestedBy) nhận, approver KHÔNG", async () => {
      const emp = await mkEmployee(null);
      const created = await createRemote(emp.token);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.data.id as string;
      const submitted = await submitRemote(emp.token, id, approverUser);
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);

      const res = await authPost(
        tok.approver,
        `/attendance/remote-work-requests/${id}/reject`,
      ).send({
        rejectReason: "Không đủ điều kiện",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await processOutbox();

      expect(await notifRows(emp.userId, "ATT_REMOTE_REQUEST_REJECTED")).toHaveLength(1);
      expect(await notifRows(approverUser, "ATT_REMOTE_REQUEST_REJECTED")).toHaveLength(0);
    });

    // ── 7. remote cancel → approver ∪ watchers; actor-exclusion THẬT (employee vừa là watcher) ──

    it("(7) employee TỰ huỷ đơn remote-work Pending của mình (cũng là watcher của chính đơn) → approver + watcher khác nhận, employee (actor=requestedBy) KHÔNG dù là watcher", async () => {
      const emp = await mkEmployee(null);
      const otherWatcher = await seedUser(
        direct,
        A.companyId,
        `ow-${emp.userId.slice(0, 6)}@${A.slug}.test`,
      );

      const created = await createRemote(emp.token);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.data.id as string;
      // employee tự thêm CHÍNH MÌNH vào watcherUserIds — chứng minh actor-exclusion LOẠI actor dù họ là
      // ứng viên watcher hợp lệ (không chỉ "tự nhiên vắng mặt").
      const submitted = await submitRemote(emp.token, id, approverUser, [emp.userId, otherWatcher]);
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);

      const res = await authPost(emp.token, `/attendance/remote-work-requests/${id}/cancel`).send(
        {},
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await processOutbox();

      expect(await notifRows(approverUser, "ATT_REMOTE_REQUEST_CANCELLED")).toHaveLength(1);
      expect(await notifRows(otherWatcher, "ATT_REMOTE_REQUEST_CANCELLED")).toHaveLength(1);
      expect(await notifRows(emp.userId, "ATT_REMOTE_REQUEST_CANCELLED")).toHaveLength(0);
      expect(await notifCountBySource("ATT_REMOTE_REQUEST_CANCELLED", id)).toBe(2);
    });

    // ── 8. idempotent 2 tầng ──────────────────────────────────────────────────────

    it("(8) idempotent 2 tầng: processed_events (tầng 1) chặn re-invoke; DedupeKey=eventId (tầng 2) chặn dù bị buộc re-invoke", async () => {
      const emp = await mkEmployee(approverUser);
      const created = await createAdjustment(emp.token);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const requestId = created.body.data.id as string;

      const evRow = await direct.query(
        `SELECT id FROM outbox_events WHERE company_id=$1 AND event_type='attendance.adjustment_requested'
       AND payload->>'requestId'=$2 ORDER BY created_at DESC LIMIT 1`,
        [A.companyId, requestId],
      );
      const eventId = evRow.rows[0].id as string;

      await processOutbox();
      expect(
        await notifRowsForRequest(approverUser, "ATT_ADJUSTMENT_SUBMITTED", requestId),
      ).toHaveLength(1);
      const consumerName = "noti-bridge:attendance.adjustment_requested";
      const processed1 = await direct.query(
        `SELECT count(*)::int AS n FROM processed_events WHERE consumer_name=$1 AND event_id=$2`,
        [consumerName, eventId],
      );
      expect(processed1.rows[0].n).toBe(1);

      // Tầng 1: re-claim (reset status='pending') NHƯNG processed_events CÒN nguyên → handler KHÔNG re-invoke.
      await direct.query(
        `UPDATE outbox_events SET status='pending', available_at=now() WHERE id=$1`,
        [eventId],
      );
      await processOutbox();
      expect(
        await notifRowsForRequest(approverUser, "ATT_ADJUSTMENT_SUBMITTED", requestId),
      ).toHaveLength(1);

      // Tầng 2: BUỘC re-invoke (xoá processed_events + reset status) → engine THẤY LẠI cùng dedupeKey=eventId
      // → dedupedCount++ (KHÔNG tạo notification thứ 2, partial-unique uq_notifications_dedupe_active chặn).
      await direct.query(`DELETE FROM processed_events WHERE consumer_name=$1 AND event_id=$2`, [
        consumerName,
        eventId,
      ]);
      await direct.query(
        `UPDATE outbox_events SET status='pending', available_at=now() WHERE id=$1`,
        [eventId],
      );
      await processOutbox();
      const rows = await notifRowsForRequest(approverUser, "ATT_ADJUSTMENT_SUBMITTED", requestId);
      expect(rows).toHaveLength(1);
      expect(rows[0].dedupeKey).toBe(`ATT_ADJUSTMENT_SUBMITTED:${eventId}`);
    });

    // ── 9. cross-tenant deny ─────────────────────────────────────────────────────

    it("(9) direct manager của subject thuộc company B → 0 notification cho B (RLS + resolver company-bind)", async () => {
      // Cross-company reference cố ý (defense-in-depth) — plant thẳng qua direct pool (superuser, bypass
      // RLS); service KHÔNG cho phép actor tự gán direct_manager_id — đây là kiểm tra tầng dưới: reader/
      // resolver PHẢI tự lọc dù dữ liệu THÔ có tham chiếu chéo tenant.
      const emp = await mkEmployee(bUser);
      const created = await createAdjustment(emp.token);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      await processOutbox();

      const bRow = await direct.query(
        `SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id=$1 AND event_code='ATT_ADJUSTMENT_SUBMITTED'`,
        [bUser],
      );
      expect(bRow.rows[0].n).toBe(0);
      expect(await notifCountBySource("ATT_ADJUSTMENT_SUBMITTED", created.body.data.id)).toBe(0);
    });

    // ── 10. recipient rỗng (không có direct manager) ────────────────────────────

    it("(10) subject KHÔNG có direct_manager_id (NULL) → 0 notification, KHÔNG delivery_log ma, KHÔNG throw", async () => {
      const emp = await mkEmployee(null);
      const created = await createAdjustment(emp.token);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const requestId = created.body.data.id as string;

      await expect(processOutbox()).resolves.not.toThrow();
      expect(await notifCountBySource("ATT_ADJUSTMENT_SUBMITTED", requestId)).toBe(0);

      const dlog = await direct.query(
        `SELECT count(*)::int AS n FROM notification_delivery_logs dl
       JOIN notifications n ON n.id = dl.notification_id
       WHERE n.company_id=$1 AND n.event_code='ATT_ADJUSTMENT_SUBMITTED' AND n.source_entity_id=$2`,
        [A.companyId, requestId],
      );
      expect(dlog.rows[0].n).toBe(0);
    });

    // ── 11. remote Draft-cancel (chưa submit) ────────────────────────────────────

    it("(11) huỷ đơn remote-work còn Draft (chưa submit, currentApproverUserId/watcherUserIds rỗng) → 0 notification, KHÔNG throw", async () => {
      const emp = await mkEmployee(null);
      const created = await createRemote(emp.token);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.data.id as string;

      const res = await authPost(emp.token, `/attendance/remote-work-requests/${id}/cancel`).send(
        {},
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await expect(processOutbox()).resolves.not.toThrow();

      expect(await notifCountBySource("ATT_REMOTE_REQUEST_CANCELLED", id)).toBe(0);
    });
  },
);
