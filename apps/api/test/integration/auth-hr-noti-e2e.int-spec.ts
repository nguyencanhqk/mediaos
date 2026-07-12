/**
 * S4-INT-5 — AUTH/HR → NOTI outbox bridge E2E (Postgres THẬT, DB CÔ LẬP theo lane).
 *
 * Đường THẬT (KHÔNG mock permission/engine/crypto):
 *   producer (HrWriteService.createEmployee / AuthService.forgotPassword / AuthService login-fail lock)
 *   → outbox.enqueue TRONG tx → `OutboxWorker.processBatch()` (claim + gọi consumer `noti-bridge:auth.*`
 *   đăng ký bởi `AuthHrNotiBridgeRegistrar`) → `OutboxNotificationBridge` (payloadOf STRIP + resolveRecipients
 *   = payload.userId) → `NotificationEngineService.intake()` → `notifications` + `notification_delivery_logs`.
 *
 * 3 mapping VERBATIM (notification-event-catalog.const.ts:61-63, cả 3 isEnabled=true ⇒ zero-migration):
 *   auth.user_created             → AUTH_USER_CREATED             (recipient = User MỚI, STORY-098)
 *   auth.password_reset_requested → AUTH_PASSWORD_RESET_REQUESTED (recipient = chủ TK)
 *   auth.user_locked              → AUTH_USER_LOCKED              (recipient = chủ TK bị khoá)
 *
 * Phủ (docs/plans/S4-INT-5.md — nghiệm thu Đội 3):
 *   0. boot-guard standalone (KHÔNG cần DB): registrar 3 mã AUTH enabled → registerSource KHÔNG throw;
 *      wire nhầm mã disabled (AUTH_PASSWORD_CHANGED, is_enabled=false) → throw TẠI BOOT (fail-loud).
 *   a. createEmployee provision (POST /hr/employees email) → 1 AUTH_USER_CREATED cho user MỚI; HR(actor)
 *      KHÔNG nhận; link user cũ (dto.userId) → 0 AUTH_USER_CREATED (provisioned=null ⇒ không enqueue).
 *   b. forgotPassword THẬT → 1 AUTH_PASSWORD_RESET_REQUESTED cho chủ TK; payload+body KHÔNG chứa
 *      resetTokenEnc/token/giá trị envelope (payloadOf strip — BẤT BIẾN #3). + deterministic sentinel.
 *   c. account-lock: accountMaxAttempts login sai (cùng IP) → 1 AUTH_USER_LOCKED cho chủ TK (owner KHÔNG
 *      bị actor-exclusion loại); body KHÔNG lộ IP/attempts. email GHOST → 0 (anti-enumeration, userId=null).
 *   d. idempotent 2 tầng: re-consume CÙNG outbox event → vẫn 1 notification (processed_events tầng-1;
 *      partial-unique uq_notifications_dedupe_active dedupeKey=eventId tầng-2).
 *   e. cross-tenant deny: event company A với recipient thuộc company B → 0 notification cho B (RLS +
 *      resolver filterActiveUsers eq company_id).
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory integration-test-LANE_DB-gate): CHỈ DB cô lập lane
 * (scripts/lane-db-setup.sh int5 + export LANE_DB=mediaos_int5). KHÔNG biểu thức ngược (false-green).
 *
 * RED-first: tắt `AuthHrNotiBridgeRegistrar` khỏi notifications.module.ts providers[] ⇒ (a)-(e) ĐỎ
 * (0 consumer ⇒ 0 notification); bật lại ⇒ XANH. Boot-guard (0) độc lập DB, luôn chạy.
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
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { EventBus } from "../../src/events/event-bus";
import { OutboxWorker } from "../../src/events/outbox-worker";
import type { NotificationEngineService } from "../../src/notifications/notification-engine.service";
import { OutboxNotificationBridge } from "../../src/notifications/outbox-notification-bridge.service";
import { AuthHrNotiBridgeRegistrar } from "../../src/notifications/auth-hr-noti-bridge.registrar";
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

// JWT ký token login (mirror các auth int-spec). Ghép chuỗi → tránh gitleaks generic (CLAUDE.md §5).
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");
// Account-lock cần chạm nhánh WrongPassword: đặt ngưỡng per-account THẤP + per-IP CAO để cùng-IP lặp sai
// khoá bucket TÀI KHOẢN trước khi bucket IP kịp khoá (mặc định 20>5 ⇒ IP khoá trước, nhánh lock không tới).
process.env.LOGIN_MAX_ATTEMPTS = "50";
process.env.LOGIN_ACCOUNT_MAX_ATTEMPTS = "4";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
// Mật khẩu test ephemeral — ghép chuỗi (KHÔNG literal high-entropy) để không trip secret-scan.
const LOGIN_PW = ["Passw0rd", "int5noti"].join("!");
const WRONG_PW = ["Wrong0rd", "int5noti"].join("!");
const EMPLOYEE_CODE_SEQUENCE_KEY = "EMPLOYEE_CODE";

type NotifRow = {
  id: string;
  payload: Record<string, unknown>;
  body: string | null;
  dedupeKey: string | null;
};

// ── 0. boot-guard STANDALONE (KHÔNG cần DB — chạy trước describe.skipIf) ────────────────────────
it("boot-guard: registrar đăng ký 3 mapping AUTH (is_enabled=true) → registerSource KHÔNG throw", () => {
  const bridge = new OutboxNotificationBridge(
    new EventBus(),
    undefined as unknown as NotificationEngineService,
  );
  expect(() => new AuthHrNotiBridgeRegistrar(bridge).onModuleInit()).not.toThrow();
});

it("boot-guard: wire nhầm eventCode DISABLED (AUTH_PASSWORD_CHANGED, is_enabled=false) → throw TẠI BOOT (fail-loud)", () => {
  const bridge = new OutboxNotificationBridge(
    new EventBus(),
    undefined as unknown as NotificationEngineService,
  );
  expect(() =>
    bridge.registerSource({
      eventType: "auth.password_changed",
      eventCode: "AUTH_PASSWORD_CHANGED",
      sourceModule: "AUTH",
      sourceEntityType: "user",
      sourceEntityIdOf: () => undefined,
      resolveRecipients: async () => [],
    }),
  ).toThrow(/AUTH_PASSWORD_CHANGED/);
});

describe.skipIf(!hasLaneDb)("S4-INT-5 AUTH/HR → NOTI bridge (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let hrEmail = "";
  let hrUserId = "";
  let bUserId = ""; // recipient thuộc company B (cross-tenant)

  // ── helpers ────────────────────────────────────────────────────────────────────────────────
  const httpServer = () => app.getHttpServer();
  const authPost = (t: string, u: string) =>
    request(httpServer()).post(u).set("Authorization", `Bearer ${t}`);

  async function login(slug: string, email: string): Promise<string> {
    const res = await request(httpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function wrongLogin(slug: string, email: string): Promise<number> {
    const res = await request(httpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: WRONG_PW });
    return res.status;
  }

  /** Drain outbox tới cạn (mọi event vừa enqueue). */
  async function processOutbox(): Promise<void> {
    const worker = app.get(OutboxWorker);
    let claimed = 0;
    do {
      const res = await worker.processBatch();
      claimed = res.claimed;
    } while (claimed > 0);
  }

  async function notifRows(
    companyId: string,
    recipientUserId: string,
    eventCode: string,
  ): Promise<NotifRow[]> {
    const r = await direct.query(
      `SELECT id, payload, body, dedupe_key AS "dedupeKey" FROM notifications
       WHERE company_id=$1 AND recipient_user_id=$2 AND event_code=$3 AND deleted_at IS NULL`,
      [companyId, recipientUserId, eventCode],
    );
    return r.rows as NotifRow[];
  }

  async function notifCountByRecipient(
    recipientUserId: string,
    eventCode: string,
  ): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id=$1 AND event_code=$2`,
      [recipientUserId, eventCode],
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

  async function countOutbox(companyId: string, eventType: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM outbox_events WHERE company_id=$1 AND event_type=$2`,
      [companyId, eventType],
    );
    return r.rows[0].n as number;
  }

  async function grant(
    companyId: string,
    userId: string,
    pairs: Array<[action: string, resourceType: string]>,
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `int5-${userId.slice(0, 8)}`);
    for (const [action, resourceType] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resourceType, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function seedEmployeeCodeCounter(companyId: string): Promise<void> {
    await direct.query(
      `INSERT INTO sequence_counters
         (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
          increment_by, reset_policy, current_value, status)
       VALUES ($1, 'HR', $2, 'Company', 'EMP', 4, 1, 'Never', 0, 'Active')`,
      [companyId, EMPLOYEE_CODE_SEQUENCE_KEY],
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "int5a");
    B = await seedCompany(direct, "int5b");
    companyIds.push(A.companyId, B.companyId);
    await seedEmployeeCodeCounter(A.companyId);

    hrEmail = `hr@${A.slug}.test`;
    hrUserId = await seedUser(direct, A.companyId, hrEmail, hash);
    // HR actor: provision arm cần create:employee + create:user (Company scope) — S2-INT-1.
    await grant(A.companyId, hrUserId, [
      ["create", "employee"],
      ["create", "user"],
    ]);

    bUserId = await seedUser(direct, B.companyId, `bu@${B.slug}.test`, hash);
  });

  afterAll(async () => {
    // employee_profiles + lịch sử KHÔNG nằm trong cleanupTenants → dọn tường minh trước (mirror hr-write).
    for (const id of companyIds) {
      await direct
        .query("DELETE FROM employee_status_histories WHERE company_id=$1", [id])
        .catch(() => undefined);
      await direct
        .query("DELETE FROM employee_manager_relations WHERE company_id=$1", [id])
        .catch(() => undefined);
      await direct
        .query("DELETE FROM employee_profiles WHERE company_id=$1", [id])
        .catch(() => undefined);
    }
    await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── (a) HR createEmployee provision → AUTH_USER_CREATED cho user MỚI ─────────────────────────
  it("(a1) createEmployee provision (email) → 1 AUTH_USER_CREATED cho user MỚI, HR(actor) KHÔNG nhận", async () => {
    const token = await login(A.slug, hrEmail);
    const res = await authPost(token, "/hr/employees").send({
      email: `new-a1@${A.slug}.test`,
      fullName: "New A1",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const newUserId = res.body.data.userId as string;

    await processOutbox();

    const rows = await notifRows(A.companyId, newUserId, "AUTH_USER_CREATED");
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.userId).toBe(newUserId);
    expect(await deliveryStatusFor(rows[0].id)).toBe("Sent");
    // HR actor KHÔNG phải recipient (recipient = payload.userId = user MỚI, không phải người tạo).
    expect(await notifRows(A.companyId, hrUserId, "AUTH_USER_CREATED")).toHaveLength(0);
  });

  it("(a2) createEmployee LINK user cũ (dto.userId) → 0 AUTH_USER_CREATED (provisioned=null ⇒ không enqueue)", async () => {
    const token = await login(A.slug, hrEmail);
    const existingUser = await seedUser(
      direct,
      A.companyId,
      `link-a2@${A.slug}.test`,
      await new PasswordService().hash(LOGIN_PW),
    );
    const outboxBefore = await countOutbox(A.companyId, "auth.user_created");

    const res = await authPost(token, "/hr/employees").send({ userId: existingUser });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    await processOutbox();
    // Link ≠ provision → KHÔNG có outbox auth.user_created mới + 0 notification cho user cũ.
    expect(await countOutbox(A.companyId, "auth.user_created")).toBe(outboxBefore);
    expect(await notifRows(A.companyId, existingUser, "AUTH_USER_CREATED")).toHaveLength(0);
  });

  // ── (b) forgotPassword → AUTH_PASSWORD_RESET_REQUESTED KHÔNG lộ token (BẤT BIẾN #3) ──────────
  it("(b1) forgotPassword THẬT → 1 AUTH_PASSWORD_RESET_REQUESTED cho chủ TK; payload+body KHÔNG chứa resetTokenEnc/giá trị envelope", async () => {
    const owner = await seedUser(
      direct,
      A.companyId,
      `reset-b1@${A.slug}.test`,
      await new PasswordService().hash(LOGIN_PW),
    );
    const res = await request(httpServer())
      .post("/auth/forgot-password")
      .send({ companySlug: A.slug, email: `reset-b1@${A.slug}.test` });
    // Endpoint trả 202 ĐỒNG NHẤT (accepted, không lộ email tồn tại — anti-enumeration).
    expect(res.status, JSON.stringify(res.body)).toBe(202);

    // Producer đã enqueue outbox với resetTokenEnc (envelope) — lấy để chứng minh nó KHÔNG lọt vào notification.
    const ev = await direct.query(
      `SELECT payload FROM outbox_events
       WHERE company_id=$1 AND event_type='auth.password_reset_requested' AND payload->>'userId'=$2
       ORDER BY created_at DESC LIMIT 1`,
      [A.companyId, owner],
    );
    expect(ev.rows).toHaveLength(1);
    const enc = (ev.rows[0].payload as { resetTokenEnc?: { secretCiphertext?: string } })
      .resetTokenEnc;
    const secretCiphertext = enc?.secretCiphertext;
    expect(typeof secretCiphertext, "outbox payload PHẢI mang envelope để test có nghĩa").toBe(
      "string",
    );

    await processOutbox();

    const rows = await notifRows(A.companyId, owner, "AUTH_PASSWORD_RESET_REQUESTED");
    expect(rows).toHaveLength(1);
    expect(await deliveryStatusFor(rows[0].id)).toBe("Sent");
    // payloadOf strip → CHỈ userId, KHÔNG resetTokenEnc/token key.
    expect(Object.keys(rows[0].payload)).toEqual(["userId"]);
    const blob = JSON.stringify(rows[0].payload) + "\n" + (rows[0].body ?? "");
    expect(blob).not.toContain("resetTokenEnc");
    expect(blob).not.toContain("secretCiphertext");
    expect(blob).not.toContain(secretCiphertext as string);
  });

  it("(b2) DETERMINISTIC: outbox auth.password_reset_requested mang token sentinel → notification KHÔNG chứa (crypto-independent)", async () => {
    const owner = await seedUser(
      direct,
      A.companyId,
      `reset-b2@${A.slug}.test`,
      await new PasswordService().hash(LOGIN_PW),
    );
    // Ghép chuỗi giá trị-giống-secret (CLAUDE.md §5) — plant TRỰC TIẾP để chứng minh strip không phụ thuộc crypto.
    const sentinel = ["SENTINEL", "reset", "token", "value"].join("-");
    await direct.query(
      `INSERT INTO outbox_events (company_id, event_type, payload)
       VALUES ($1, 'auth.password_reset_requested', $2::jsonb)`,
      [
        A.companyId,
        JSON.stringify({
          userId: owner,
          resetTokenEnc: { secretCiphertext: sentinel },
          token: sentinel,
        }),
      ],
    );

    await processOutbox();

    const rows = await notifRows(A.companyId, owner, "AUTH_PASSWORD_RESET_REQUESTED");
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].payload)).toEqual(["userId"]);
    const blob = JSON.stringify(rows[0].payload) + "\n" + (rows[0].body ?? "");
    expect(blob).not.toContain(sentinel);
    expect(blob).not.toContain("resetTokenEnc");
  });

  // ── (c) account-lock → AUTH_USER_LOCKED; anti-enumeration ghost ──────────────────────────────
  it("(c1) accountMaxAttempts login sai (cùng IP) → 1 AUTH_USER_LOCKED cho chủ TK; body KHÔNG lộ IP/attempts; owner KHÔNG bị actor-exclusion loại", async () => {
    const ownerEmail = `lock-c1@${A.slug}.test`;
    const owner = await seedUser(
      direct,
      A.companyId,
      ownerEmail,
      await new PasswordService().hash(LOGIN_PW),
    );
    // Ngưỡng THẬT của bucket tài khoản (đọc từ chính singleton — không đoán env).
    const n = app.get(LoginRateLimiter).accountMaxAttempts;
    let lastStatus = 0;
    for (let i = 0; i < n; i++) {
      lastStatus = await wrongLogin(A.slug, ownerEmail);
    }
    // 401 ĐỒNG NHẤT — emit khoá là courtesy, KHÔNG đổi outcome login.
    expect(lastStatus).toBe(401);

    await processOutbox();

    const rows = await notifRows(A.companyId, owner, "AUTH_USER_LOCKED");
    expect(
      rows,
      "chủ TK NHẬN đúng 1 (owner KHÔNG bị actor-exclusion vì mapping không set actorUserId)",
    ).toHaveLength(1);
    expect(await deliveryStatusFor(rows[0].id)).toBe("Sent");
    // Payload chỉ userId; body/payload KHÔNG lộ IP (IPv4) / attempts / reason bảo mật.
    expect(Object.keys(rows[0].payload)).toEqual(["userId"]);
    const blob = JSON.stringify(rows[0].payload) + "\n" + (rows[0].body ?? "");
    expect(blob).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    expect(blob.toLowerCase()).not.toContain("attempt");
  });

  it("(c2) anti-enumeration: login sai email GHOST (không tồn tại) vượt ngưỡng → 0 AUTH_USER_LOCKED (userId=null ⇒ không emit)", async () => {
    const ghostEmail = `ghost-c2@${A.slug}.test`; // KHÔNG seed user
    const lockedBefore = await countOutbox(A.companyId, "auth.user_locked");
    const n = app.get(LoginRateLimiter).accountMaxAttempts;
    for (let i = 0; i < n; i++) {
      const status = await wrongLogin(A.slug, ghostEmail);
      expect(status).toBe(401); // 401 ĐỒNG NHẤT y như email thật (không lộ tồn tại)
    }
    await processOutbox();
    // Ghost = UserNotFound (userId=null) ⇒ nhánh emit KHÔNG chạy ⇒ 0 outbox auth.user_locked mới.
    expect(await countOutbox(A.companyId, "auth.user_locked")).toBe(lockedBefore);
  });

  // ── (d) idempotent 2 tầng ────────────────────────────────────────────────────────────────────
  it("(d) re-consume CÙNG outbox event → vẫn 1 notification (processed_events tầng-1 + dedupeKey=eventId tầng-2)", async () => {
    const token = await login(A.slug, hrEmail);
    const res = await authPost(token, "/hr/employees").send({
      email: `idem-d@${A.slug}.test`,
      fullName: "Idem D",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const newUserId = res.body.data.userId as string;

    const evRow = await direct.query(
      `SELECT id FROM outbox_events
       WHERE company_id=$1 AND event_type='auth.user_created' AND payload->>'userId'=$2
       ORDER BY created_at DESC LIMIT 1`,
      [A.companyId, newUserId],
    );
    const eventId = evRow.rows[0].id as string;
    const consumer = "noti-bridge:auth.user_created";

    await processOutbox();
    expect(await notifRows(A.companyId, newUserId, "AUTH_USER_CREATED")).toHaveLength(1);
    const processed1 = await direct.query(
      `SELECT count(*)::int AS n FROM processed_events WHERE consumer_name=$1 AND event_id=$2`,
      [consumer, eventId],
    );
    expect(processed1.rows[0].n).toBe(1);

    // Tầng 1: re-claim (reset status) NHƯNG giữ processed_events → handler KHÔNG re-invoke.
    await direct.query(
      `UPDATE outbox_events SET status='pending', available_at=now() WHERE id=$1`,
      [eventId],
    );
    await processOutbox();
    expect(await notifRows(A.companyId, newUserId, "AUTH_USER_CREATED")).toHaveLength(1);

    // Tầng 2: BUỘC re-invoke (xoá processed_events + reset status) → engine THẤY LẠI dedupeKey=eventId → deduped.
    await direct.query(`DELETE FROM processed_events WHERE consumer_name=$1 AND event_id=$2`, [
      consumer,
      eventId,
    ]);
    await direct.query(
      `UPDATE outbox_events SET status='pending', available_at=now() WHERE id=$1`,
      [eventId],
    );
    await processOutbox();
    const rows = await notifRows(A.companyId, newUserId, "AUTH_USER_CREATED");
    expect(rows).toHaveLength(1);
    expect(rows[0].dedupeKey).toBe(`AUTH_USER_CREATED:${eventId}`);
  });

  // ── (e) cross-tenant deny ────────────────────────────────────────────────────────────────────
  it("(e) event company A với recipient thuộc company B → 0 notification cho B (RLS + resolver eq company_id)", async () => {
    // Plant outbox event company A trỏ recipient của B (defense-in-depth — bind THÔ, KHÔNG qua producer).
    await direct.query(
      `INSERT INTO outbox_events (company_id, event_type, payload)
       VALUES ($1, 'auth.user_created', $2::jsonb)`,
      [A.companyId, JSON.stringify({ eventCode: "AUTH_USER_CREATED", userId: bUserId })],
    );

    await processOutbox();

    // recipient B: 0 row BẤT KỂ company nào truy vấn (engine chưa từng tạo được — filterActiveUsers eq A).
    expect(await notifCountByRecipient(bUserId, "AUTH_USER_CREATED")).toBe(0);
  });
});
