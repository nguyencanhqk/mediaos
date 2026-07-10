/**
 * S4-NOTI-BE-2 — Event intake HTTP trust-boundary + engine pipeline (real Nest app, real DB).
 * Route: POST /internal/v1/notifications/events (InternalNotificationsController → NotificationEngineService).
 *
 * RED-first — deny-path đi đầu (docs/plans/S4-NOTI-BE-2.md §7), 8 nhóm a–h:
 *   (a) untrusted context: không Bearer → 401; JWT hợp lệ + thiếu/sai x-internal-key → 403; env unset → 403.
 *   (b) dedupe app (TimeWindow): TASK_COMMENT_CREATED cùng sourceEntityId + recipient 2 lần → created=1,deduped=1.
 *   (b2) dedupe backstop DB: row xung đột (cùng 4 cột uq_notifications_dedupe_active) chèn TRƯỚC qua directPool
 *        → intake 2 recipient: recipient trùng bị deduped (app-tier isDuplicate bắt trước; DB partial-unique là
 *        backstop-of-record cho race thật giữa 2 request đồng thời), recipient còn lại VẪN tạo, KHÔNG 500.
 *   (c) actor-exclusion: actor∈recipients non-system → actor 0; is_system_event=true → actor có.
 *   (d) cross-tenant: recipient company B → không tạo; body.company_id=B & token=A → 400.
 *   (e) event disabled → 0 notification, 0 delivery_log, audit 'notification_skipped', 200 + skippedCount≥1.
 *   (f) template missing (event enabled, KHÔNG có template) → fallback NON-SILENT (delivery_log
 *       metadata.reason='template_fallback'), vẫn tạo notification + delivery_log 'Sent'.
 *   (g) target_url ngoài whitelist (https://evil.com / //evil / javascript:) → 422 NOTI-ERR-TARGET-UNAVAILABLE;
 *       payload chứa khóa nhạy cảm (salary) → 400 NOTI-ERR-TEMPLATE-VARIABLE-INVALID.
 *   (h) happy path TASK_ASSIGNED + UserIds → 1 notification (legacy + cột mới) + 1 delivery_log 'Sent' attempt_no=1.
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
    await cleanupTenants(direct, companyIds);
    await direct.end();
    if (nest) await nest.close();
    delete process.env.INTERNAL_API_KEY;
  });

  const body = (over: Record<string, unknown> = {}) => ({
    eventCode: "TASK_ASSIGNED",
    sourceModule: "TASK",
    recipient: { mode: "UserIds", userIds: [recipient] },
    payload: { taskTitle: "Test task" },
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

  // ── (b2) dedupe backstop DB (row xung đột chèn TRƯỚC qua directPool) ─────────────
  it("(b2) row trùng dedupe_key chèn TRƯỚC qua directPool → recipient đó deduped, recipient khác VẪN tạo, KHÔNG 500", async () => {
    const token = await login(nest, A.slug, actorEmail);
    const sourceEntityId = randomUUID();
    // Bucket TimeWindow 300s — khớp CHÍNH XÁC format NotificationDedupeService.computeKey (TimeWindow):
    // `{eventCode}:{sourceEntityId}:{recipientUserId}:{floor(epochSeconds/window)}`. Chèn TRƯỚC request nên
    // bucket tính tại đây PHẢI trùng bucket engine tính lúc intake (an toàn trừ khi rơi đúng biên 300s).
    const bucket = Math.floor(Date.now() / 1000 / DEDUPE_WINDOW_SECONDS);
    const conflictingDedupeKey = `TASK_COMMENT_CREATED:${sourceEntityId}:${recipient3}:${bucket}`;

    await direct.query(
      `INSERT INTO notifications
         (company_id, user_id, type, body, is_read,
          recipient_user_id, event_code, dedupe_key, notification_type, priority, status, title)
       VALUES ($1, $2, 'general', $3, false, $2, $4, $5, 'Task', 'Low', 'Unread', $6)`,
      [
        A.companyId,
        recipient3,
        "pre-seeded conflict row (directPool)",
        "TASK_COMMENT_CREATED",
        conflictingDedupeKey,
        "Pre-seeded conflict",
      ],
    );

    const res = await api(nest)
      .post("/internal/v1/notifications/events")
      .set(auth(token))
      .send(
        body({
          eventCode: "TASK_COMMENT_CREATED",
          sourceEntityType: "task",
          sourceEntityId,
          recipient: { mode: "UserIds", userIds: [recipient3, recipient4] },
        }),
      );

    expect(res.status, `expected 200 (KHÔNG 500): ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.data).toMatchObject({ createdCount: 1, dedupedCount: 1 });

    // recipient3: vẫn CHỈ 1 row (row pre-seeded, không tạo thêm) — recipient4: 1 row mới tạo.
    expect(await notifCount(A.companyId, recipient3, "TASK_COMMENT_CREATED")).toBe(1);
    expect(await notifCount(A.companyId, recipient4, "TASK_COMMENT_CREATED")).toBe(1);

    const rows = await direct.query(
      `SELECT recipient_user_id, event_code, dedupe_key FROM notifications
       WHERE company_id=$1 AND event_code='TASK_COMMENT_CREATED' AND recipient_user_id = ANY($2::uuid[])
         AND deleted_at IS NULL`,
      [A.companyId, [recipient3, recipient4]],
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      expect(row.recipient_user_id).toBeTruthy();
      expect(row.event_code).toBe("TASK_COMMENT_CREATED");
      expect(row.dedupe_key).toBeTruthy();
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
});
