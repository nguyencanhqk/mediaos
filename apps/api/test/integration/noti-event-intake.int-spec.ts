/**
 * S4-NOTI-BE-2 — Event intake HTTP trust-boundary + engine pipeline (real Nest app, real DB).
 * Route: POST /internal/v1/notifications/events (InternalNotificationsController → NotificationEngineService).
 *
 * RED-first — deny-path đi đầu (docs/plans/S4-NOTI-BE-2.md §7), nhóm a–j:
 *   (a) untrusted context: không Bearer → 401; JWT hợp lệ + thiếu/sai x-internal-key → 403; env unset → 403.
 *   (b) dedupe app (TimeWindow): TASK_COMMENT_CREATED cùng sourceEntityId + recipient 2 lần → created=1,deduped=1.
 *   (b2) dedupe backstop DB — RACE THẬT (fix vòng 2, thay bản chèn+COMMIT trước intake vốn bị tầng-1 app-tier
 *        isDuplicate bắt trước nên KHÔNG BAO GIỜ chạm nhánh SAVEPOINT/23505): mở 1 client blocker RIÊNG
 *        (directPool), BEGIN + INSERT row trùng 4 cột uq_notifications_dedupe_active NHƯNG KHÔNG COMMIT →
 *        READ COMMITTED khiến tầng-1 SELECT của intake KHÔNG thấy row này → intake đi tới SAVEPOINT + INSERT
 *        thật → ĐỤNG lock trên row uncommitted → backend app-pool BLOCK (wait_event_type='Lock', poll bằng
 *        client thứ 3 qua pg_stat_activity) → COMMIT blocker → INSERT của intake nhận 23505 → catch →
 *        ROLLBACK TO savepoint → dedupedCount++. Bằng chứng độc lập: recipient bị race CHỈ giữ ĐÚNG row của
 *        blocker (không phải row engine — engine INSERT đã bị rollback), recipient còn lại vẫn tạo, KHÔNG 500.
 *   (c) actor-exclusion: actor∈recipients non-system → actor 0; is_system_event=true → actor có.
 *   (d) cross-tenant: recipient company B → không tạo; body.company_id=B & token=A → 400.
 *   (e) event disabled → 0 notification, 0 delivery_log, audit 'notification_skipped', 200 + skippedCount≥1.
 *   (f) template missing (event enabled, KHÔNG có template) → fallback NON-SILENT (delivery_log
 *       metadata.reason='template_fallback'), vẫn tạo notification + delivery_log 'Sent'.
 *   (g) target_url ngoài whitelist (https://evil.com / //evil / javascript:) → 422 NOTI-ERR-TARGET-UNAVAILABLE;
 *       payload chứa khóa nhạy cảm (salary) → 400 NOTI-ERR-TEMPLATE-VARIABLE-INVALID.
 *   (h) happy path TASK_ASSIGNED + UserIds → 1 notification (legacy + cột mới) + 1 delivery_log 'Sent' attempt_no=1.
 *   (i) recipient mode=EmployeeIds (notification-recipient-resolver.service.ts:66-85): profile active có
 *       user_id → resolve + tạo 1 notification; profile KHÔNG có user_id liên kết → filter drop, 0 recipient.
 *   (j) eventCode KHÔNG tồn tại trong catalog (khác disabled) → 404 NOTI-ERR-EVENT-NOT-FOUND.
 *
 * Gate CỨNG hasDb && LANE_DB (memory integration-test-lane-db-gate): .env chung → hasDb=true nhưng band
 * 0479-0481 chỉ có trên DB cô lập lane → CHỈ chạy khi LANE_DB set, nếu không xanh-giả/đỏ-giả.
 *
 * Lane L4-test (docs/plans/S4-NOTI-BE-2.md §4) sở hữu + commit file này. Bootstrap Nest app THẬT
 * (JwtAuthGuard→CompanyGuard→InternalGuard→controller) — KHÔNG mock guard/service.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");
const INTERNAL_KEY = "test-internal-key-noti-be-2";
const PASSWORD = "Passw0rd!test99";
const runDb = hasDb && Boolean(process.env.LANE_DB);

// Event công ty A dùng riêng cho nhóm (f) — KHÔNG seed template cho event này (fallback path).
const TEMPLATE_MISSING_EVENT_CODE = "NOTI_TEST_TEMPLATE_MISSING";
const TEMPLATE_MISSING_EVENT_NAME = "Sự kiện test không có template";
const DEDUPE_WINDOW_SECONDS = 300;

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

function auth(token: string, key = INTERNAL_KEY) {
  return { Authorization: `Bearer ${token}`, "x-internal-key": key };
}

/**
 * Poll `pg_stat_activity` (client mượn từ `direct` pool) tới khi thấy 1 backend KHÁC `excludePid` đang
 * `state='active'` + `wait_event_type='Lock'` trên 1 câu lệnh đụng bảng `notifications` — bằng chứng ĐỘC LẬP
 * app-pool (intake) đang thật sự bị Postgres chặn chờ transaction blocker kết thúc (race DB thật, KHÔNG phải
 * app-tier isDuplicate bắt trước). Trả `false` nếu hết `maxWaitMs` mà chưa thấy — caller PHẢI fail rõ ràng,
 * KHÔNG âm thầm coi là pass nhờ kết quả cuối trùng khớp ngẫu nhiên.
 */
async function waitForLockWait(
  direct: Pool,
  excludePid: number,
  maxWaitMs: number,
): Promise<boolean> {
  const pollIntervalMs = 50;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const r = await direct.query(
      `SELECT pid FROM pg_stat_activity
       WHERE datname = current_database() AND state = 'active'
         AND wait_event_type = 'Lock' AND pid <> $1
         AND query ILIKE '%notifications%'`,
      [excludePid],
    );
    if (r.rows.length > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

describe.skipIf(!runDb)("S4-NOTI-BE-2 event intake (HTTP trust-boundary + engine)", () => {
  const direct = directPool();
  let nest: INestApplication;

  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let actorEmail = "";
  let actor = "";
  let recipient = "";
  let recipient2 = "";
  let recipient3 = "";
  let recipient4 = "";
  let recipientEmp = "";
  let recipientB = "";

  async function notifCount(companyId: string, recipientUserId: string, eventCode: string) {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM notifications
       WHERE company_id=$1 AND recipient_user_id=$2 AND event_code=$3 AND deleted_at IS NULL`,
      [companyId, recipientUserId, eventCode],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = INTERNAL_KEY;
    const hash = await hashedPw();
    A = await seedCompany(direct, "notibe2a");
    B = await seedCompany(direct, "notibe2b");
    companyIds.push(A.companyId, B.companyId);

    actorEmail = `actor@${A.slug}.test`;
    actor = await seedUser(direct, A.companyId, actorEmail, hash);
    recipient = await seedUser(direct, A.companyId, `r1@${A.slug}.test`, hash);
    recipient2 = await seedUser(direct, A.companyId, `r2@${A.slug}.test`, hash);
    recipient3 = await seedUser(direct, A.companyId, `r3@${A.slug}.test`, hash);
    recipient4 = await seedUser(direct, A.companyId, `r4@${A.slug}.test`, hash);
    recipientEmp = await seedUser(direct, A.companyId, `remp@${A.slug}.test`, hash);
    recipientB = await seedUser(direct, B.companyId, `rb@${B.slug}.test`, hash);

    // (f) template missing — event RIÊNG của company A, is_enabled=true, KHÔNG seed template ⇒ engine
    // phải render fallback (event.eventName/description) thay vì 404/500.
    await direct.query(
      `INSERT INTO notification_events
         (company_id, module_code, event_code, event_name, notification_type, default_priority,
          default_channels, is_enabled, is_system_event)
       VALUES ($1, 'TASK', $2, $3, 'Task', 'Normal', '["IN_APP"]'::jsonb, true, false)`,
      [A.companyId, TEMPLATE_MISSING_EVENT_CODE, TEMPLATE_MISSING_EVENT_NAME],
    );

    // (g) target_url — company-override template cho event GLOBAL TASK_STATUS_CHANGED (không dùng ở test
    // khác trong file này) với target_url_template = '{target_url}' để client-payload điều khiển được
    // target_url render ra, phục vụ deny-path assertInternalTargetUrl (422 loud, KHÔNG strip im lặng).
    const ev = await direct.query(
      `SELECT id FROM notification_events WHERE event_code='TASK_STATUS_CHANGED' AND company_id IS NULL`,
    );
    const statusChangedEventId = ev.rows[0].id as string;
    await direct.query(
      `INSERT INTO notification_templates
         (company_id, event_id, template_code, channel, locale, title_template, body_template,
          target_url_template, status, is_default)
       VALUES ($1, $2, $3, 'IN_APP', 'vi-VN', 'Test target_url override', 'Body {target_url}',
               '{target_url}', 'Active', true)`,
      [
        A.companyId,
        statusChangedEventId,
        `TASK_STATUS_CHANGED__IN_APP__vi-VN__override-${A.companyId}`,
      ],
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = moduleRef.createNestApplication();
    nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    nest.useGlobalFilters(new AllExceptionsFilter());
    await nest.init();
  });

  afterAll(async () => {
    // delivery_logs FK → notifications; xoá TRƯỚC cleanupTenants (helper chỉ xoá notifications). Company
    // FK ON DELETE CASCADE dọn notification_events/notification_templates override khi cleanupTenants xoá
    // companies — không cần xoá tường minh.
    await direct.query(
      `DELETE FROM notification_delivery_logs WHERE company_id = ANY($1::uuid[])`,
      [companyIds],
    );
    // (i) EmployeeIds — employee_profiles seed inline trong test; xoá tường minh TRƯỚC cleanupTenants (dù
    // company_id → companies đã ON DELETE CASCADE, xoá rõ ràng ở đây theo đúng thứ tự con→cha).
    await direct.query(`DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])`, [
      companyIds,
    ]);
    await cleanupTenants(direct, companyIds);
    await direct.end();
    if (nest) await nest.close();
    delete process.env.INTERNAL_API_KEY;
  });

  // S5-NOTI-FIX-1: payload default PHẢI có `taskId` — sau backfill 0497, template global TASK_ASSIGNED/
  // TASK_COMMENT_CREATED có target_url_template '/tasks/{taskId}'; renderer giữ literal `{taskId}` nếu thiếu →
  // assertInternalTargetUrl 422 (loud). Producer THẬT (commonPayload/commentPayload) LUÔN có taskId ⇒ payload
  // default cũ `{taskTitle}` là phi thực tế. Thêm taskId (id hợp lệ) để render ra route nội bộ hợp lệ.
  const body = (over: Record<string, unknown> = {}) => ({
    eventCode: "TASK_ASSIGNED",
    sourceModule: "TASK",
    recipient: { mode: "UserIds", userIds: [recipient] },
    payload: { taskId: randomUUID(), taskTitle: "Test task" },
    ...over,
  });

  // ── (a) untrusted context — fail-closed ─────────────────────────────────────────
  it("(a) không Bearer → 401 (JwtAuthGuard toàn cục chạy TRƯỚC InternalGuard)", async () => {
    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set("x-internal-key", INTERNAL_KEY)
      .send(body());
    expect(res.status).toBe(401);
  });

  it("(a) JWT hợp lệ + thiếu x-internal-key → 403", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set("Authorization", `Bearer ${token}`)
      .send(body());
    expect(res.status).toBe(403);
  });

  it("(a) JWT hợp lệ + sai x-internal-key → 403", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token, "wrong-key"))
      .send(body());
    expect(res.status).toBe(403);
  });

  it("(a) INTERNAL_API_KEY unset → 403 (fail-closed, dù JWT + header đúng cũ)", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const saved = process.env.INTERNAL_API_KEY;
    delete process.env.INTERNAL_API_KEY;
    try {
      const res = await api(nest)
        .post("/internal/v1/notifications/events")
        .set(auth(token, saved ?? INTERNAL_KEY))
        .send(body());
      expect(res.status).toBe(403);
    } finally {
      process.env.INTERNAL_API_KEY = saved;
    }
  });

  // ── (h) happy path ──────────────────────────────────────────────────────────────
  it("(h) TASK_ASSIGNED + UserIds → created=1, notification đủ cột legacy + mới, 1 delivery_log Sent attempt_no=1", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(body({ recipient: { mode: "UserIds", userIds: [recipient] } }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ createdCount: 1, dedupedCount: 0 });

    const n = await direct.query(
      `SELECT recipient_user_id, event_code, notification_type, priority, status, title,
              user_id, body, type, is_read
       FROM notifications
       WHERE company_id=$1 AND recipient_user_id=$2 AND event_code='TASK_ASSIGNED'`,
      [A.companyId, recipient],
    );
    expect(n.rows).toHaveLength(1);
    const row = n.rows[0];
    // cột MỚI
    expect(row.recipient_user_id).toBe(recipient);
    expect(row.event_code).toBe("TASK_ASSIGNED");
    expect(row.notification_type).toBe("Task");
    expect(row.priority).toBe("Normal");
    expect(row.status).toBe("Unread");
    expect(row.title).toBeTruthy();
    // cột LEGACY NOT NULL (dual-write)
    expect(row.user_id).toBe(recipient);
    expect(row.body).toBeTruthy();
    expect(row.type).toBe("general");
    expect(row.is_read).toBe(false);

    const dl = await direct.query(
      `SELECT delivery_status, attempt_no FROM notification_delivery_logs
       WHERE company_id=$1 AND recipient_user_id=$2`,
      [A.companyId, recipient],
    );
    expect(dl.rows).toHaveLength(1);
    expect(dl.rows[0].delivery_status).toBe("Sent");
    expect(dl.rows[0].attempt_no).toBe(1);
  });

  // ── (b) dedupe app (TimeWindow via DEFAULT_DEDUPE) ───────────────────────────────
  it("(b) TASK_COMMENT_CREATED cùng sourceEntityId + recipient 2 lần → created=1, deduped=1 (1 notification)", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const sourceEntityId = randomUUID();
    const payload = body({
      eventCode: "TASK_COMMENT_CREATED",
      sourceEntityType: "task",
      sourceEntityId,
      recipient: { mode: "UserIds", userIds: [recipient2] },
    });

    const r1 = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(payload);
    expect(r1.status).toBe(200);
    expect(r1.body.data.createdCount).toBe(1);

    const r2 = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(payload);
    expect(r2.status).toBe(200);
    expect(r2.body.data).toMatchObject({ createdCount: 0, dedupedCount: 1 });

    expect(await notifCount(A.companyId, recipient2, "TASK_COMMENT_CREATED")).toBe(1);
  });

  // ── (b2) dedupe backstop DB — RACE THẬT qua SAVEPOINT/23505 ───────────────────────
  it("(b2) race DB thật: row trùng UNCOMMITTED trong lúc intake chạy → app-pool BLOCK trên Lock → COMMIT blocker → 23505 → ROLLBACK TO savepoint, dedupedCount++, recipient khác VẪN tạo, KHÔNG 500", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const sourceEntityId = randomUUID();
    // occurredAt CỐ ĐỊNH trong body → bucket TimeWindow (300s) TẤT ĐỊNH cho CẢ blocker lẫn engine (cùng công
    // thức floor(epochSeconds/window) — NotificationDedupeService.computeKey) → hết flake biên 300s.
    const occurredAt = new Date().toISOString();
    const bucket = Math.floor(Date.parse(occurredAt) / 1000 / DEDUPE_WINDOW_SECONDS);
    const raceDedupeKey = `TASK_COMMENT_CREATED:${sourceEntityId}:${recipient3}:${bucket}`;

    // Client BLOCKER riêng (KHÔNG qua withClient — phải giữ transaction MỞ xuyên suốt lúc intake chạy).
    // BEGIN + INSERT đúng 4 cột uq_notifications_dedupe_active NHƯNG KHÔNG COMMIT.
    const blocker = await direct.connect();
    let blockerDone = false;
    try {
      const pidRes = await blocker.query("SELECT pg_backend_pid() AS pid");
      const blockerPid = pidRes.rows[0].pid as number;

      await blocker.query("BEGIN");
      await blocker.query(
        `INSERT INTO notifications
           (company_id, user_id, type, body, is_read,
            recipient_user_id, event_code, dedupe_key, notification_type, priority, status, title)
         VALUES ($1, $2, 'general', $3, false, $2, $4, $5, 'Task', 'Low', 'Unread', $6)`,
        [
          A.companyId,
          recipient3,
          "blocker row (uncommitted during race)",
          "TASK_COMMENT_CREATED",
          raceDedupeKey,
          "Race blocker (uncommitted)",
        ],
      );

      // Bắn intake nhưng CHƯA await kết quả — chạy trên connection RIÊNG của app pool (withTenant mở 1 tx
      // Postgres thật). READ COMMITTED ⇒ SELECT tầng-1 (isDuplicate) trong tx này KHÔNG thấy row blocker
      // (chưa commit) ⇒ intake đi tới SAVEPOINT + INSERT thật cho recipient3 ⇒ ĐỤNG lock trên row uncommitted
      // cùng unique index 4 cột ⇒ Postgres CHẶN backend app-pool (chờ transaction blocker kết thúc).
      // QUAN TRỌNG: supertest/superagent Request CHỈ thật sự gọi `.end()` (bắn HTTP) khi `.then()`/`await`
      // được gọi (request-base.js:243-270) — gán thẳng vào biến KHÔNG kích hoạt gì cả. Bọc trong async IIFE
      // với `await` bên trong để ép request bắn NGAY (đồng bộ trong lượt thực thi này), không phải khi ta
      // `await intakePromise` ở dưới (lúc đó blocker đã COMMIT — race sẽ KHÔNG bao giờ xảy ra).
      const intakePromise = (async () =>
        api(nest)
          .post("/internal/v1/notifications/events")
          .set(auth(token))
          .send(
            body({
              eventCode: "TASK_COMMENT_CREATED",
              sourceModule: "TASK",
              sourceEntityType: "task",
              sourceEntityId,
              occurredAt,
              recipient: { mode: "UserIds", userIds: [recipient3, recipient4] },
            }),
          ))();

      // Poll pg_stat_activity (client thứ 3, mượn từ `direct` pool) tới khi thấy backend app-pool
      // wait_event_type='Lock' — PROBE ĐỘC LẬP: nếu race KHÔNG kích hoạt, fail RÕ RÀNG (không âm thầm pass
      // nhờ kết quả cuối trùng khớp ngẫu nhiên). stdout probe cố ý (bằng chứng độc lập nhánh SAVEPOINT/23505
      // notification-engine.service.ts:144-151 thật sự bị kích hoạt TRƯỚC khi blocker commit).
      const sawBlocked = await waitForLockWait(direct, blockerPid, 8000);
      process.stdout.write(
        `[b2-race-probe] app-pool backend blocked on Lock before commit: ${sawBlocked}\n`,
      );
      expect(
        sawBlocked,
        "app-pool backend KHÔNG block trên Lock trong 8s — race DB không kích hoạt (test vô hiệu)",
      ).toBe(true);

      // Chỉ COMMIT blocker SAU KHI đã xác nhận app-pool đang bị chặn — buộc INSERT của intake nhận 23505
      // (unique-violation) khi row blocker trở nên visible.
      await blocker.query("COMMIT");
      blockerDone = true;
      blocker.release();

      const res = await intakePromise;
      expect(res.status, `expected 200 (KHÔNG 500): ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.data).toMatchObject({ createdCount: 1, dedupedCount: 1 });

      // recipient3: VẪN CHỈ 1 row — ĐÚNG row của BLOCKER (marker body/dedupe_key khớp) — engine INSERT cho
      // recipient3 đã 23505 + ROLLBACK TO savepoint nên KHÔNG để lại row nào (bằng chứng tự thân).
      const raceRow = await direct.query(
        `SELECT body, title, dedupe_key FROM notifications
         WHERE company_id=$1 AND recipient_user_id=$2 AND event_code='TASK_COMMENT_CREATED'
           AND deleted_at IS NULL`,
        [A.companyId, recipient3],
      );
      expect(raceRow.rows).toHaveLength(1);
      expect(raceRow.rows[0].body).toBe("blocker row (uncommitted during race)");
      expect(raceRow.rows[0].dedupe_key).toBe(raceDedupeKey);

      // recipient4: KHÔNG đụng blocker → engine tạo notification MỚI bình thường, tx ngoài sống, KHÔNG 500.
      expect(await notifCount(A.companyId, recipient4, "TASK_COMMENT_CREATED")).toBe(1);
    } finally {
      if (!blockerDone) {
        await blocker.query("ROLLBACK").catch(() => undefined);
        blocker.release();
      }
    }
  });

  // ── (c) actor-exclusion ─────────────────────────────────────────────────────────
  it("(c) non-system (TASK_ASSIGNED): actor∈recipients → actor KHÔNG nhận", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(body({ actorUserId: actor, recipient: { mode: "UserIds", userIds: [actor] } }));
    expect(res.status).toBe(200);
    expect(res.body.data.createdCount).toBe(0);
    expect(await notifCount(A.companyId, actor, "TASK_ASSIGNED")).toBe(0);
  });

  it("(c) system-event (SYSTEM_ERROR_DETECTED): actor∈recipients → actor VẪN nhận", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(
        body({
          eventCode: "SYSTEM_ERROR_DETECTED",
          sourceModule: "SYSTEM",
          actorUserId: actor,
          recipient: { mode: "UserIds", userIds: [actor] },
        }),
      );
    expect(res.status).toBe(200);
    expect(res.body.data.createdCount).toBe(1);
    expect(await notifCount(A.companyId, actor, "SYSTEM_ERROR_DETECTED")).toBe(1);
  });

  // ── (d) cross-tenant ────────────────────────────────────────────────────────────
  it("(d) recipient thuộc company B (token=A) → không tạo (RLS ẩn cross-tenant, resolve 0 row)", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(body({ recipient: { mode: "UserIds", userIds: [recipientB] } }));
    expect(res.status).toBe(200);
    expect(res.body.data.createdCount).toBe(0);
    expect(await notifCount(B.companyId, recipientB, "TASK_ASSIGNED")).toBe(0);
  });

  it("(d) body.company_id = B, token = A → 400 (company_id lấy từ token, không từ body)", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(body({ company_id: B.companyId }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NOTI-ERR-COMPANY-MISMATCH");
  });

  // ── (e) event disabled ──────────────────────────────────────────────────────────
  it("(e) event disabled (SYSTEM_JOB_FAILED) → 200 skippedCount≥1, 0 notification, 0 delivery_log, 1 audit skip", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(
        body({
          eventCode: "SYSTEM_JOB_FAILED",
          sourceModule: "SYSTEM",
          recipient: { mode: "UserIds", userIds: [recipient] },
        }),
      );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.createdCount).toBe(0);
    expect(res.body.data.skippedCount).toBeGreaterThanOrEqual(1);

    expect(await notifCount(A.companyId, recipient, "SYSTEM_JOB_FAILED")).toBe(0);
    const dl = await direct.query(
      `SELECT count(*)::int AS n FROM notification_delivery_logs dl
       JOIN notifications n ON n.id = dl.notification_id
       WHERE dl.company_id=$1 AND n.event_code='SYSTEM_JOB_FAILED'`,
      [A.companyId],
    );
    expect(dl.rows[0].n).toBe(0);
    const audit = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs
       WHERE company_id=$1 AND action='notification_skipped'`,
      [A.companyId],
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  // ── (f) template missing → fallback non-silent ───────────────────────────────────
  it("(f) event enabled KHÔNG có template → fallback non-silent (delivery_log metadata.reason='template_fallback'), vẫn tạo notification", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(
        body({
          eventCode: TEMPLATE_MISSING_EVENT_CODE,
          sourceModule: "TASK",
          recipient: { mode: "UserIds", userIds: [recipient] },
        }),
      );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.createdCount).toBe(1);

    const n = await direct.query(
      `SELECT title, body FROM notifications
       WHERE company_id=$1 AND recipient_user_id=$2 AND event_code=$3`,
      [A.companyId, recipient, TEMPLATE_MISSING_EVENT_CODE],
    );
    expect(n.rows).toHaveLength(1);
    // fallback = event.eventName (KHÔNG bịa target_url, không nuốt lỗi — renderer.render() không có template).
    expect(n.rows[0].title).toBe(TEMPLATE_MISSING_EVENT_NAME);
    expect(n.rows[0].body).toBe(TEMPLATE_MISSING_EVENT_NAME);

    const dl = await direct.query(
      `SELECT dl.delivery_status, dl.metadata FROM notification_delivery_logs dl
       JOIN notifications n ON n.id = dl.notification_id
       WHERE dl.company_id=$1 AND dl.recipient_user_id=$2 AND n.event_code=$3`,
      [A.companyId, recipient, TEMPLATE_MISSING_EVENT_CODE],
    );
    expect(dl.rows).toHaveLength(1);
    expect(dl.rows[0].delivery_status).toBe("Sent");
    // Dấu vết non-silent (khác path thường — path thường metadata=NULL, xem test (h)).
    expect(dl.rows[0].metadata).toMatchObject({ reason: "template_fallback" });
  });

  // ── (g) target_url ngoài whitelist — 422 loud (KHÔNG strip im lặng) ──────────────
  it.each([
    ["https://evil.com", "scheme http(s) tuyệt đối"],
    ["//evil.com", "protocol-relative"],
    ["javascript:alert(1)", "scheme javascript:"],
  ])("(g) target_url = %s (%s) → 422 NOTI-ERR-TARGET-UNAVAILABLE", async (maliciousTargetUrl) => {
    const token = await login(nest, A.slug, actorEmail);
    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(
        body({
          eventCode: "TASK_STATUS_CHANGED",
          sourceModule: "TASK",
          recipient: { mode: "UserIds", userIds: [recipient] },
          payload: { target_url: maliciousTargetUrl },
        }),
      );
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe("NOTI-ERR-TARGET-UNAVAILABLE");
    // Loud reject — KHÔNG tạo notification rác khi bị chặn.
    expect(await notifCount(A.companyId, recipient, "TASK_STATUS_CHANGED")).toBe(0);
  });

  // ── (g) payload nhạy cảm ─────────────────────────────────────────────────────────
  it("(g) payload chứa 'salary' → 400 NOTI-ERR-TEMPLATE-VARIABLE-INVALID (loud)", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(body({ payload: { salary: 99_000_000 } }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NOTI-ERR-TEMPLATE-VARIABLE-INVALID");
  });

  // ── (i) recipient mode=EmployeeIds — collectCandidates join employeeProfiles ─────
  // (notification-recipient-resolver.service.ts:66-85). employee_profiles seed INLINE qua direct.query
  // (company_id=A, status='active') — chỉ 2 mode BE-2 thật sự resolve (UserIds đã phủ ở (a)-(h)).
  it("(i) recipient mode=EmployeeIds, profile active có user_id → resolve + tạo 1 notification", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const emp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [A.companyId, recipientEmp],
    );
    const employeeId = emp.rows[0].id as string;

    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(
        body({
          eventCode: "TASK_ASSIGNED",
          recipient: { mode: "EmployeeIds", employeeIds: [employeeId] },
        }),
      );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ createdCount: 1, dedupedCount: 0 });
    expect(await notifCount(A.companyId, recipientEmp, "TASK_ASSIGNED")).toBe(1);
  });

  it("(i) recipient mode=EmployeeIds, profile KHÔNG có user_id liên kết → filter drop, 0 recipient, KHÔNG 500", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const emp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1, NULL, 'active') RETURNING id`,
      [A.companyId],
    );
    const employeeId = emp.rows[0].id as string;

    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(
        body({
          eventCode: "TASK_ASSIGNED",
          recipient: { mode: "EmployeeIds", employeeIds: [employeeId] },
        }),
      );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.createdCount).toBe(0);
    expect(res.body.data.skippedCount).toBeGreaterThanOrEqual(1);
  });

  // ── (j) eventCode không tồn tại trong catalog → 404 (khác disabled → skip 200) ────
  it("(j) eventCode không tồn tại trong catalog → 404 NOTI-ERR-EVENT-NOT-FOUND", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(body({ eventCode: "NOTI_TEST_EVENT_DOES_NOT_EXIST" }));
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error.code).toBe("NOTI-ERR-EVENT-NOT-FOUND");
  });
});
