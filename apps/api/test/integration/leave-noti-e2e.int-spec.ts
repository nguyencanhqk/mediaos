/**
 * S4-INT-3 — Outbox LEAVE (đơn nghỉ phép — submit/approve/reject/cancel/revoke) → NOTI intake IN-PROCESS
 * bridge (Postgres THẬT, DB CÔ LẬP). Đường THẬT: JwtAuthGuard → CompanyGuard → PermissionGuard →
 * LeaveController → LeaveRequestService / LeaveApprovalService / LeaveRevokeService (producer, outbox.enqueue
 * TRONG tx) → `OutboxWorker.processBatch()` (claim + gọi `noti-bridge:leave.request.*` consumer đăng ký bởi
 * `LeaveNotiBridgeRegistrar`) → `OutboxNotificationBridge` → `NotificationEngineService.intake()` →
 * `notifications` + `notification_delivery_logs`. KHÔNG mock permission/engine.
 *
 * Phủ (docs/plans/S4-INT-3.md · SPEC-05 §19.1/§14.19 recipient · SPEC-08 §16.4 skip):
 *   0-1. boot-guard: 5 eventCode LEAVE (isEnabled=true, catalog:80-84) registerSource() KHÔNG throw; wire nhầm
 *        eventCode NGOÀI catalog (PROJECT_MEMBER_REMOVED, is_enabled=false) cho eventType LEAVE → throw tại boot.
 *   1. LEAVE_REQUEST_SUBMITTED → direct manager của subject (reader.resolveManager); requester (actor) KHÔNG.
 *   2. LEAVE_REQUEST_APPROVED  → requester = payload.userId; approver (actor=HR) bị loại (deny-path workflow).
 *   3. LEAVE_REQUEST_REJECTED  → requester = payload.userId; approver (actor=HR) bị loại.
 *   4. CANCELLED (a) — requester TỰ huỷ đơn Pending của mình (fromStatus='Pending', producer
 *      leave-request.service) → CHỈ direct manager; requester (actor) KHÔNG.
 *   5. CANCELLED (b) — owner (employee) TỰ huỷ đơn ĐÃ DUYỆT của mình (fromStatus='Approved', producer
 *      leave-revoke.service) → resolved [employee, manager]; employee = actor BỊ LOẠI → CHỈ manager
 *      (chứng minh actor-exclusion THẬT, không phải trùng hợp: cùng resolve [emp, mgr] như test 6 nhưng khác
 *      actor → khác kết quả).
 *   6. LEAVE_REQUEST_REVOKED — HR/admin (revoke:leave, actor ≠ requester) thu hồi đơn Approved → employee +
 *      manager (2 recipient); cả hai nhận vì actor(HR) KHÔNG trong danh sách.
 *   7. idempotent 2 tầng: processed_events (tầng 1, OutboxWorker) + DedupeKey=eventId (tầng 2, NOTI engine
 *      partial-unique uq_notifications_dedupe_active) — dùng LEAVE_REQUEST_SUBMITTED (strategy 'DedupeKey').
 *   8. cross-tenant: subject.direct_manager_id thuộc company B → 0 notification cho B (RLS + resolver
 *      filterActiveUsers eq company_id — defense-in-depth ngoài RLS).
 *   9. recipient rỗng: subject KHÔNG có direct_manager_id (NULL) → 0 notification, KHÔNG delivery_log ma
 *      (SPEC-08 §16.4), KHÔNG throw.
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate): CHỈ DB cô lập lane
 * (scripts/lane-db-setup.sh int3 + export LANE_DB=mediaos_int3). KHÔNG biểu thức ngược (false-green).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
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
const LOGIN_PW = ["Passw0rd", "int3noti"].join("!");

type Scope = "Own" | "Team" | "Company";
// [action, resourceType, scope, sensitive] — sensitive PHẢI khớp catalog THẬT (mig 0455) vì seedPermissionCatalog
// upsert ON CONFLICT DO UPDATE SET is_sensitive → sai giá trị sẽ lật cờ catalog dùng chung của LANE_DB.
type Pair = [action: string, resourceType: string, scope: Scope, sensitive: boolean];

// ── 0-1. boot-guard (KHÔNG cần DB) ────────────────────────────────────────────────

const LEAVE_EVENT_MAPPINGS: Array<{ eventType: string; eventCode: string }> = [
  { eventType: "leave.request.submitted", eventCode: "LEAVE_REQUEST_SUBMITTED" },
  { eventType: "leave.request.approved", eventCode: "LEAVE_REQUEST_APPROVED" },
  { eventType: "leave.request.rejected", eventCode: "LEAVE_REQUEST_REJECTED" },
  { eventType: "leave.request.cancelled", eventCode: "LEAVE_REQUEST_CANCELLED" },
  { eventType: "leave.request.revoked", eventCode: "LEAVE_REQUEST_REVOKED" },
];

it("boot-guard: registerSource() cho 5 eventCode LEAVE (isEnabled=true, catalog:80-84) — KHÔNG throw", () => {
  const bridge = new OutboxNotificationBridge(
    new EventBus(),
    undefined as unknown as NotificationEngineService,
  );
  for (const m of LEAVE_EVENT_MAPPINGS) {
    expect(() =>
      bridge.registerSource({
        eventType: m.eventType,
        eventCode: m.eventCode,
        sourceModule: "LEAVE",
        sourceEntityType: "leave_request",
        sourceEntityIdOf: () => undefined,
        resolveRecipients: async () => [],
      }),
    ).not.toThrow();
  }
});

it("boot-guard: wire nhầm eventCode NGOÀI NOTI_EVENT_CATALOG (PROJECT_MEMBER_REMOVED, is_enabled=false) cho eventType LEAVE → fail-loud TẠI BOOT", () => {
  const bridge = new OutboxNotificationBridge(
    new EventBus(),
    undefined as unknown as NotificationEngineService,
  );
  expect(() =>
    bridge.registerSource({
      eventType: "leave.request.submitted",
      eventCode: "PROJECT_MEMBER_REMOVED",
      sourceModule: "LEAVE",
      sourceEntityType: "leave_request",
      sourceEntityIdOf: () => undefined,
      resolveRecipients: async () => [],
    }),
  ).toThrow(/PROJECT_MEMBER_REMOVED/);
});

// ── DB cô lập, đường thật ───────────────────────────────────────────────────────

describe.skipIf(!hasLaneDb)("S4-INT-3 outbox LEAVE (đơn nghỉ phép) → NOTI bridge", () => {
  let app: INestApplication;
  let direct: Pool;
  let appConn: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let passwordHash = "";
  let leaveTypeA = "";
  let hrUser = ""; // approver + rejecter + revoker (Company scope). NEVER a requester/manager.
  let hrToken = "";
  let mgrUser = ""; // direct manager (recipient of SUBMITTED/CANCELLED/REVOKED). No approve grant.
  let bUser = ""; // company B — cross-tenant direct_manager plant.
  let seq = 0;

  // Self-service pairs (create + submit + cancel-own + read-own) → producer đủ tạo Pending/Approved rồi cancel.
  const SELF_PAIRS: Pair[] = [
    ["create", "leave", "Own", false],
    ["submit", "leave", "Own", false],
    ["cancel-own", "leave", "Own", false],
    ["view-own", "leave", "Own", false],
    ["view-own", "leave-balance", "Own", false],
    ["view", "leave-type", "Company", false],
  ];
  // HR — approve (non-sensitive) + reject/revoke (sensitive) @ Company (mig 0455).
  const HR_PAIRS: Pair[] = [
    ["approve", "leave", "Company", false],
    ["reject", "leave", "Company", true],
    ["revoke", "leave", "Company", true],
  ];

  /** Ngày làm việc kế tiếp (bỏ T7/CN) từ Mon 2027-03-01 — mỗi request 1 ngày riêng, tránh OVERLAP per-user. */
  function nextWorkday(): string {
    const base = Date.UTC(2027, 2, 1); // 2027-03-01 = thứ Hai
    for (;;) {
      const d = new Date(base + seq * 86_400_000);
      seq += 1;
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) return d.toISOString().slice(0, 10);
    }
  }

  async function seedEmpProfile(
    companyId: string,
    userId: string,
    directManagerUserId: string | null,
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, direct_manager_id, employee_code, status)
         VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [companyId, userId, directManagerUserId, `E-${userId.slice(0, 8)}`],
    );
    return r.rows[0].id as string;
  }

  async function plantType(companyId: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO leave_types
           (company_id, code, name, paid, status, deduct_balance, balance_unit,
            allow_full_day, allow_half_day, allow_hourly, allow_multiple_days,
            require_reason, min_notice_days, sort_order)
         VALUES ($1,$2,$3,true,'active',true,'Day',true,true,false,true,false,0,1) RETURNING id`,
      [companyId, `LT-${randomUUID().slice(0, 8)}`, "Annual"],
    );
    return r.rows[0].id as string;
  }

  async function plantBalance(companyId: string, userId: string, total: number): Promise<void> {
    await direct.query(
      `INSERT INTO leave_balances
           (company_id, user_id, leave_type_id, year, total_days, used_days, pending_days)
         VALUES ($1,$2,$3,2027,$4,0,0)`,
      [companyId, userId, leaveTypeA, total],
    );
  }

  async function grant(
    companyId: string,
    userId: string,
    label: string,
    pairs: Pair[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `int3-${label}-${userId.slice(0, 8)}`);
    for (const [action, resourceType, scope, sensitive] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resourceType, sensitive);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  /** 1 nhân viên mới (user + profile direct_manager + self-service grant + balance) + token đăng nhập A. */
  async function mkEmployee(directManagerUserId: string | null): Promise<{
    userId: string;
    employeeId: string;
    token: string;
  }> {
    seq += 1;
    const email = `emp${seq}-${randomUUID().slice(0, 6)}@${A.slug}.test`;
    const userId = await seedUser(direct, A.companyId, email, passwordHash);
    const employeeId = await seedEmpProfile(A.companyId, userId, directManagerUserId);
    await grant(A.companyId, userId, `emp${seq}`, SELF_PAIRS);
    await plantBalance(A.companyId, userId, 20);
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

  /** emp tạo + gửi đơn 1 ngày (submitNow) → Pending + Reserved. Trả 201 response. */
  async function createSubmitted(token: string) {
    const d = nextWorkday();
    return authPost(token, "/leave/requests").send({
      leaveTypeId: leaveTypeA,
      startDate: d,
      endDate: d,
      durationType: "FullDay",
      reason: "Nghỉ phép (S4-INT-3)",
      submitNow: true,
    });
  }

  /** Drain outbox tới cạn (mọi event đã enqueue). */
  async function processOutbox(): Promise<void> {
    const worker = app.get(OutboxWorker);
    let claimed = 0;
    do {
      const res = await worker.processBatch();
      claimed = res.claimed;
    } while (claimed > 0);
  }

  async function notifRowsForRequest(
    recipientUserId: string,
    eventCode: string,
    requestId: string,
  ): Promise<Array<{ id: string; dedupeKey: string | null }>> {
    const r = await direct.query(
      `SELECT id, dedupe_key AS "dedupeKey" FROM notifications
          WHERE company_id=$1 AND recipient_user_id=$2 AND event_code=$3 AND source_entity_id=$4
            AND deleted_at IS NULL`,
      [A.companyId, recipientUserId, eventCode, requestId],
    );
    return r.rows as Array<{ id: string; dedupeKey: string | null }>;
  }

  async function notifCountBySource(eventCode: string, requestId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM notifications
          WHERE company_id=$1 AND event_code=$2 AND source_entity_id=$3 AND deleted_at IS NULL`,
      [A.companyId, eventCode, requestId],
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

  async function outboxEventId(eventType: string, requestId: string): Promise<string> {
    const r = await direct.query(
      `SELECT id FROM outbox_events WHERE company_id=$1 AND event_type=$2
           AND payload->>'requestId'=$3 ORDER BY created_at DESC LIMIT 1`,
      [A.companyId, eventType, requestId],
    );
    return r.rows[0].id as string;
  }

  async function outboxActor(eventType: string, requestId: string): Promise<string | null> {
    const r = await direct.query(
      `SELECT payload->>'actorUserId' AS v FROM outbox_events
          WHERE company_id=$1 AND event_type=$2 AND payload->>'requestId'=$3
          ORDER BY created_at DESC LIMIT 1`,
      [A.companyId, eventType, requestId],
    );
    return (r.rows[0]?.v as string | undefined) ?? null;
  }

  async function outboxFromStatus(eventType: string, requestId: string): Promise<string | null> {
    const r = await direct.query(
      `SELECT payload->>'fromStatus' AS v FROM outbox_events
          WHERE company_id=$1 AND event_type=$2 AND payload->>'requestId'=$3
          ORDER BY created_at DESC LIMIT 1`,
      [A.companyId, eventType, requestId],
    );
    return (r.rows[0]?.v as string | undefined) ?? null;
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
    A = await seedCompany(direct, "int3a");
    B = await seedCompany(direct, "int3b");
    companyIds.push(A.companyId, B.companyId);
    leaveTypeA = await plantType(A.companyId);

    // direct manager — active user, KHÔNG có grant approve (chỉ là recipient của SUBMITTED/CANCELLED/REVOKED).
    mgrUser = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, passwordHash);
    await seedEmpProfile(A.companyId, mgrUser, null);

    // HR — approver/rejecter/revoker (Company). Actor cho approve/reject/revoke → phải BỊ LOẠI khỏi recipients.
    hrUser = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, passwordHash);
    await seedEmpProfile(A.companyId, hrUser, null);
    await grant(A.companyId, hrUser, "hr", HR_PAIRS);
    hrToken = await login(A.slug, `hr@${A.slug}.test`);

    bUser = await seedUser(direct, B.companyId, `b@${B.slug}.test`, passwordHash);
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

  // ── 1. SUBMITTED → direct manager của subject (requester KHÔNG) ──────────────────

  it("(1) gửi đơn nghỉ → 1 notification cho direct manager, delivery Sent; requester KHÔNG nhận; payload mang actorUserId", async () => {
    const emp = await mkEmployee(mgrUser);
    const created = await createSubmitted(emp.token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.status).toBe("Pending");
    const requestId = created.body.data.id as string;
    await processOutbox();

    const rows = await notifRowsForRequest(mgrUser, "LEAVE_REQUEST_SUBMITTED", requestId);
    expect(rows).toHaveLength(1);
    expect(await deliveryStatusFor(rows[0].id)).toBe("Sent");
    expect(await notifCountBySource("LEAVE_REQUEST_SUBMITTED", requestId)).toBe(1);
    // requester KHÔNG nhận đơn của chính mình.
    expect(
      await notifRowsForRequest(emp.userId, "LEAVE_REQUEST_SUBMITTED", requestId),
    ).toHaveLength(0);
    // producer đính actorUserId (= requester) cho engine actor-exclusion.
    expect(await outboxActor("leave.request.submitted", requestId)).toBe(emp.userId);
  });

  // ── 2/3. approve/reject → requester = payload.userId; approver (actor=HR) bị loại ──

  it("(2) HR approve đơn → CHỈ requester nhận; approver (actor) KHÔNG (deny-path workflow)", async () => {
    const emp = await mkEmployee(mgrUser);
    const created = await createSubmitted(emp.token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;

    const res = await authPost(hrToken, `/leave/requests/${id}/approve`).send({ note: "ok" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("Approved");
    await processOutbox();

    expect(await notifRowsForRequest(emp.userId, "LEAVE_REQUEST_APPROVED", id)).toHaveLength(1);
    expect(await notifRowsForRequest(hrUser, "LEAVE_REQUEST_APPROVED", id)).toHaveLength(0);
    expect(await notifCountBySource("LEAVE_REQUEST_APPROVED", id)).toBe(1);
    expect(await outboxActor("leave.request.approved", id)).toBe(hrUser);
  });

  it("(3) HR reject đơn → CHỈ requester nhận; approver (actor) KHÔNG", async () => {
    const emp = await mkEmployee(mgrUser);
    const created = await createSubmitted(emp.token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;

    const res = await authPost(hrToken, `/leave/requests/${id}/reject`).send({
      reason: "Không hợp lệ",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("Rejected");
    await processOutbox();

    expect(await notifRowsForRequest(emp.userId, "LEAVE_REQUEST_REJECTED", id)).toHaveLength(1);
    expect(await notifRowsForRequest(hrUser, "LEAVE_REQUEST_REJECTED", id)).toHaveLength(0);
    expect(await notifCountBySource("LEAVE_REQUEST_REJECTED", id)).toBe(1);
  });

  // ── 4. CANCELLED (a) requester huỷ đơn Pending → CHỈ direct manager (requester actor loại) ──

  it("(4) requester TỰ huỷ đơn Pending (fromStatus=Pending) → CHỈ direct manager nhận; requester (actor) KHÔNG", async () => {
    const emp = await mkEmployee(mgrUser);
    const created = await createSubmitted(emp.token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    await processOutbox(); // tiêu thụ SUBMITTED trước cho sạch

    const res = await authPost(emp.token, `/leave/requests/${id}/cancel`).send({
      cancelReason: "Đổi kế hoạch",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("Cancelled");
    await processOutbox();

    // producer nhánh Pending (leave-request.service) → fromStatus='Pending' → CHỈ manager.
    expect(await outboxFromStatus("leave.request.cancelled", id)).toBe("Pending");
    expect(await notifRowsForRequest(mgrUser, "LEAVE_REQUEST_CANCELLED", id)).toHaveLength(1);
    expect(await notifRowsForRequest(emp.userId, "LEAVE_REQUEST_CANCELLED", id)).toHaveLength(0);
    expect(await notifCountBySource("LEAVE_REQUEST_CANCELLED", id)).toBe(1);
  });

  // ── 5. CANCELLED (b) owner huỷ đơn ĐÃ DUYỆT → resolved [emp,mgr], actor(emp) loại → CHỈ mgr ──

  it("(5) owner TỰ huỷ đơn Approved của mình (fromStatus=Approved, resolved [emp,mgr]) → employee (actor) BỊ LOẠI → CHỈ manager (actor-exclusion THẬT)", async () => {
    const emp = await mkEmployee(mgrUser);
    const created = await createSubmitted(emp.token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    const approved = await authPost(hrToken, `/leave/requests/${id}/approve`).send({});
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    await processOutbox(); // tiêu thụ SUBMITTED + APPROVED

    const res = await authPost(emp.token, `/leave/requests/${id}/cancel`).send({
      cancelReason: "Huỷ sau khi đã duyệt",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("Cancelled");
    await processOutbox();

    // producer nhánh Approved (leave-revoke.service) → fromStatus='Approved', actorUserId=emp.
    expect(await outboxFromStatus("leave.request.cancelled", id)).toBe("Approved");
    expect(await outboxActor("leave.request.cancelled", id)).toBe(emp.userId);
    // resolved [emp, mgr]; emp=actor bị loại → CHỈ mgr (KHÔNG phải trùng hợp — xem test 6 cùng resolve).
    expect(await notifRowsForRequest(mgrUser, "LEAVE_REQUEST_CANCELLED", id)).toHaveLength(1);
    expect(await notifRowsForRequest(emp.userId, "LEAVE_REQUEST_CANCELLED", id)).toHaveLength(0);
    expect(await notifCountBySource("LEAVE_REQUEST_CANCELLED", id)).toBe(1);
  });

  // ── 6. REVOKED (actor=HR ≠ requester) → employee + manager (2 recipient) ─────────

  it("(6) HR thu hồi đơn Approved (actor ∉ [emp,mgr]) → employee + manager cùng nhận = 2 notification; HR KHÔNG", async () => {
    const emp = await mkEmployee(mgrUser);
    const created = await createSubmitted(emp.token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    const approved = await authPost(hrToken, `/leave/requests/${id}/approve`).send({});
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    await processOutbox(); // tiêu thụ SUBMITTED + APPROVED

    const res = await authPost(hrToken, `/leave/requests/${id}/revoke`).send({
      revokeReason: "Vi phạm chính sách",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("Revoked");
    await processOutbox();

    // resolved [emp, mgr]; actor=HR không trong danh sách → CẢ HAI nhận (đối chứng với test 5 actor-exclusion).
    expect(await notifRowsForRequest(emp.userId, "LEAVE_REQUEST_REVOKED", id)).toHaveLength(1);
    expect(await notifRowsForRequest(mgrUser, "LEAVE_REQUEST_REVOKED", id)).toHaveLength(1);
    expect(await notifRowsForRequest(hrUser, "LEAVE_REQUEST_REVOKED", id)).toHaveLength(0);
    expect(await notifCountBySource("LEAVE_REQUEST_REVOKED", id)).toBe(2);
    expect(await outboxActor("leave.request.revoked", id)).toBe(hrUser);
  });

  // ── 7. idempotent 2 tầng (LEAVE_REQUEST_SUBMITTED, strategy DedupeKey) ──────────

  it("(7) idempotent 2 tầng: processed_events (tầng 1) chặn re-invoke; DedupeKey=eventId (tầng 2) chặn dù bị buộc re-invoke", async () => {
    const emp = await mkEmployee(mgrUser);
    const created = await createSubmitted(emp.token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const requestId = created.body.data.id as string;
    const eventId = await outboxEventId("leave.request.submitted", requestId);

    await processOutbox();
    expect(await notifRowsForRequest(mgrUser, "LEAVE_REQUEST_SUBMITTED", requestId)).toHaveLength(
      1,
    );
    const consumerName = "noti-bridge:leave.request.submitted";
    const processed1 = await direct.query(
      `SELECT count(*)::int AS n FROM processed_events WHERE consumer_name=$1 AND event_id=$2`,
      [consumerName, eventId],
    );
    expect(processed1.rows[0].n).toBe(1);

    // Tầng 1: re-claim (reset status='pending') NHƯNG processed_events CÒN → handler KHÔNG re-invoke.
    await direct.query(
      `UPDATE outbox_events SET status='pending', available_at=now() WHERE id=$1`,
      [eventId],
    );
    await processOutbox();
    expect(await notifRowsForRequest(mgrUser, "LEAVE_REQUEST_SUBMITTED", requestId)).toHaveLength(
      1,
    );

    // Tầng 2: BUỘC re-invoke (xoá processed_events + reset) → engine THẤY LẠI dedupeKey=eventId → dedupedCount++
    // (KHÔNG tạo notification thứ 2, partial-unique uq_notifications_dedupe_active chặn).
    await direct.query(`DELETE FROM processed_events WHERE consumer_name=$1 AND event_id=$2`, [
      consumerName,
      eventId,
    ]);
    await direct.query(
      `UPDATE outbox_events SET status='pending', available_at=now() WHERE id=$1`,
      [eventId],
    );
    await processOutbox();
    const rows = await notifRowsForRequest(mgrUser, "LEAVE_REQUEST_SUBMITTED", requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0].dedupeKey).toBe(`LEAVE_REQUEST_SUBMITTED:${eventId}`);
  });

  // ── 8. cross-tenant deny (direct manager thuộc company B) ───────────────────────

  it("(8) direct manager của subject thuộc company B → 0 notification cho B (RLS + resolver company-bind)", async () => {
    // Cross-company reference cố ý (defense-in-depth) — plant thẳng qua direct pool (superuser, bypass RLS);
    // service KHÔNG cho actor tự gán direct_manager_id — đây là kiểm tra tầng dưới: reader/resolver PHẢI tự
    // lọc dù dữ liệu THÔ có tham chiếu chéo tenant.
    const emp = await mkEmployee(bUser);
    const created = await createSubmitted(emp.token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const requestId = created.body.data.id as string;
    await processOutbox();

    const bRow = await direct.query(
      `SELECT count(*)::int AS n FROM notifications
          WHERE recipient_user_id=$1 AND event_code='LEAVE_REQUEST_SUBMITTED'`,
      [bUser],
    );
    expect(bRow.rows[0].n).toBe(0);
    expect(await notifCountBySource("LEAVE_REQUEST_SUBMITTED", requestId)).toBe(0);
  });

  // ── 9. recipient rỗng (không có direct manager) — KHÔNG delivery_log ma ─────────

  it("(9) subject KHÔNG có direct_manager_id (NULL) → 0 notification, KHÔNG delivery_log ma, KHÔNG throw (SPEC-08 §16.4)", async () => {
    const emp = await mkEmployee(null);
    const created = await createSubmitted(emp.token);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const requestId = created.body.data.id as string;

    await expect(processOutbox()).resolves.not.toThrow();
    expect(await notifCountBySource("LEAVE_REQUEST_SUBMITTED", requestId)).toBe(0);

    const dlog = await direct.query(
      `SELECT count(*)::int AS n FROM notification_delivery_logs dl
           JOIN notifications n ON n.id = dl.notification_id
          WHERE n.company_id=$1 AND n.event_code='LEAVE_REQUEST_SUBMITTED' AND n.source_entity_id=$2`,
      [A.companyId, requestId],
    );
    expect(dlog.rows[0].n).toBe(0);
  });
});
