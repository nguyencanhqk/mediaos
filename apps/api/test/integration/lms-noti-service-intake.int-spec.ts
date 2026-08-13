/**
 * S5-LMS-NOTI-1 — Danh tính MÁY cho intake NOTI + catalog LMS (real Nest app, real DB).
 * Route mới: POST /internal/v1/notifications/lms-events (LmsNotificationsController → LmsServiceIntakeGuard
 * → NotificationEngineService). Route cũ /internal/v1/notifications/events KHÔNG đổi.
 *
 * RED-first — deny-path đi đầu (docs/plans/S5-LMS-NOTI-1.md §5):
 *   (a) thiếu Authorization → 403 · (b) token sai → 403 · (c) LMS_NOTI_TOKEN unset → 403 ·
 *   (d) LMS_COMPANY_ID unset → 403 · (e) eventCode NGOÀI allowlist LMS (dù tồn tại + enabled) → 403 ·
 *   (f) body kèm company_id (kể cả ĐÚNG giá trị) → 400 · (g) recipient công ty KHÁC → 0 notification (RLS)
 *   (h) happy LMS_ENROLLMENT_APPROVED · (i) dedupeKey lặp → deduped
 *   (j) HỒI QUY GOAL — xem §0.1 của plan.
 *
 * ⚠️ Ca (j) là bài test mà S5-GOAL-DB-1 ĐÃ THIẾU: 0507 nới CHECK trên `notification_events` nhưng bỏ sót 2
 * CHECK cùng nghĩa trên bảng `notifications` ⇒ mọi GOAL_ASSIGNED vỡ CHECK khi INSERT (0 hàng GOAL trên DB
 * PROD). Migration 0529 vá cả hai; ca (j) đứng đây để lỗi đó không tái diễn cho GOAL lẫn LMS.
 *
 * Gate CỨNG hasDb && LANE_DB (memory integration-test-lane-db-gate): band 0529 chỉ có trên DB cô lập lane.
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
import { internalKeyFixture } from "../helpers/fixture-secrets";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

// Fixture giống-secret: GHÉP CHUỖI, không literal high-entropy (CLAUDE.md §5 — gitleaks generic-api-key).
const NOTI_TOKEN = ["test", "lms", "noti", "token"].join("-").padEnd(48, "z");
const INTERNAL_KEY = internalKeyFixture("lmsnoti1");
const PASSWORD = "Passw0rd!test99";
const runDb = hasDb && Boolean(process.env.LANE_DB);

const ROUTE = "/internal/v1/notifications/lms-events";
const LEGACY_ROUTE = "/internal/v1/notifications/events";

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

describe.skipIf(!runDb)("S5-LMS-NOTI-1 — intake máy LMS → NOTI", () => {
  const direct = directPool();
  const companyIds: string[] = [];
  let nest: INestApplication;
  let A: SeededTenant;
  let B: SeededTenant;
  let actorEmail = "";
  let actor = "";
  let learner = "";
  let learnerB = "";

  async function notifRows(companyId: string, eventCode: string) {
    const r = await direct.query(
      `SELECT recipient_user_id, module_code, notification_type, priority, title, body, target_url, status
         FROM notifications
        WHERE company_id=$1 AND event_code=$2 AND deleted_at IS NULL`,
      [companyId, eventCode],
    );
    return r.rows as Array<Record<string, string>>;
  }

  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = INTERNAL_KEY;
    const hash = await hashedPw();
    A = await seedCompany(direct, "lmsnoti1a");
    B = await seedCompany(direct, "lmsnoti1b");
    companyIds.push(A.companyId, B.companyId);

    actorEmail = `actor@${A.slug}.test`;
    actor = await seedUser(direct, A.companyId, actorEmail, hash);
    learner = await seedUser(direct, A.companyId, `learner@${A.slug}.test`, hash);
    learnerB = await seedUser(direct, B.companyId, `learner@${B.slug}.test`, hash);

    // Kênh máy được cấu hình TRỎ VÀO company A. company_id của mọi thông báo do kênh này tạo ra đến TỪ ĐÂY.
    process.env.LMS_NOTI_TOKEN = NOTI_TOKEN;
    process.env.LMS_COMPANY_ID = A.companyId;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = moduleRef.createNestApplication();
    nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    nest.useGlobalFilters(new AllExceptionsFilter());
    await nest.init();
  });

  afterAll(async () => {
    await direct.query(
      `DELETE FROM notification_delivery_logs WHERE company_id = ANY($1::uuid[])`,
      [companyIds],
    );
    await cleanupTenants(direct, companyIds);
    await direct.end();
    if (nest) await nest.close();
    delete process.env.INTERNAL_API_KEY;
    delete process.env.LMS_NOTI_TOKEN;
    delete process.env.LMS_COMPANY_ID;
  });

  // dedupeKey BẮT BUỘC trên kênh máy (controller 400 nếu thiếu) — mặc định duy nhất mỗi lần gọi để các ca
  // KHÔNG-về-dedupe không vô tình đụng nhau; ca (i) tự truyền khoá cố định.
  const body = (over: Record<string, unknown> = {}) => ({
    eventCode: "LMS_ENROLLMENT_APPROVED",
    sourceModule: "LMS",
    sourceEntityType: "lms_course",
    sourceEntityId: randomUUID(),
    dedupeKey: `lms:test:${randomUUID()}`,
    recipient: { mode: "UserIds", userIds: [learner] },
    payload: { course_name: "An toàn lao động" },
    ...over,
  });

  const asLms = (token = NOTI_TOKEN) => ({ Authorization: `Bearer ${token}` });

  // ── (a)–(d) danh tính: fail-closed ────────────────────────────────────────────────
  it("(a) thiếu Authorization → 403, KHÔNG tạo notification", async () => {
    const res = await api(nest).post(ROUTE).send(body());
    expect(res.status).toBe(403);
    expect(await notifRows(A.companyId, "LMS_ENROLLMENT_APPROVED")).toHaveLength(0);
  });

  it("(b) token sai → 403", async () => {
    const res = await api(nest)
      .post(ROUTE)
      .set(asLms("x".repeat(NOTI_TOKEN.length)))
      .send(body());
    expect(res.status).toBe(403);
  });

  it("(c) LMS_NOTI_TOKEN chưa cấu hình → 403 (kênh TẮT, không fail-open)", async () => {
    delete process.env.LMS_NOTI_TOKEN;
    try {
      const res = await api(nest).post(ROUTE).set(asLms()).send(body());
      expect(res.status).toBe(403);
    } finally {
      process.env.LMS_NOTI_TOKEN = NOTI_TOKEN;
    }
  });

  it("(d) LMS_COMPANY_ID chưa cấu hình → 403 (không có tenant thì KHÔNG đoán)", async () => {
    delete process.env.LMS_COMPANY_ID;
    try {
      const res = await api(nest).post(ROUTE).set(asLms()).send(body());
      expect(res.status).toBe(403);
    } finally {
      process.env.LMS_COMPANY_ID = A.companyId;
    }
  });

  // ── (e) least privilege — khoá LMS KHÔNG mint được mã của module khác ────────────
  it("(e) eventCode TASK_ASSIGNED (tồn tại + enabled, NGOÀI allowlist LMS) → 403, 0 notification", async () => {
    const res = await api(nest)
      .post(ROUTE)
      .set(asLms())
      .send(
        body({
          eventCode: "TASK_ASSIGNED",
          sourceModule: "TASK",
          payload: { taskId: randomUUID() },
        }),
      );
    expect(res.status).toBe(403);
    expect(res.body.code ?? res.body.error?.code).toBe("NOTI-ERR-EVENT-NOT-ALLOWED");
    expect(await notifRows(A.companyId, "TASK_ASSIGNED")).toHaveLength(0);
  });

  it("(e2) eventCode LMS_* không có trong catalog → 403 tại allowlist (chưa chạm DB)", async () => {
    const res = await api(nest)
      .post(ROUTE)
      .set(asLms())
      .send(body({ eventCode: "LMS_KHONG_TON_TAI" }));
    expect(res.status).toBe(403);
  });

  // ── (f) BẤT BIẾN #1 — máy không được nêu ý kiến về tenant ────────────────────────
  it("(f) body kèm company_id ĐÚNG giá trị vẫn → 400 (không dạy caller thói quen tự khai tenant)", async () => {
    const res = await api(nest)
      .post(ROUTE)
      .set(asLms())
      .send({ ...body(), company_id: A.companyId });
    expect(res.status).toBe(400);
    expect(res.body.code ?? res.body.error?.code).toBe("NOTI-ERR-COMPANY-IN-BODY");
  });

  it("(f2) body kèm companyId của công ty KHÁC → 400", async () => {
    const res = await api(nest)
      .post(ROUTE)
      .set(asLms())
      .send({ ...body(), companyId: B.companyId });
    expect(res.status).toBe(400);
  });

  // ── (g) cô lập tenant — recipient ngoài company của kênh là VÔ HÌNH ──────────────
  it("(g) recipient thuộc công ty B → 200 nhưng createdCount=0, B KHÔNG có notification nào", async () => {
    const res = await api(nest)
      .post(ROUTE)
      .set(asLms())
      .send(body({ recipient: { mode: "UserIds", userIds: [learnerB] } }));
    expect(res.status).toBe(200);
    expect(res.body.data.createdCount).toBe(0);
    expect(await notifRows(B.companyId, "LMS_ENROLLMENT_APPROVED")).toHaveLength(0);
  });

  // ── (h) happy path ───────────────────────────────────────────────────────────────
  it("(h) LMS_ENROLLMENT_APPROVED → 1 notification LMS/Training + delivery_log Sent", async () => {
    const res = await api(nest).post(ROUTE).set(asLms()).send(body());
    expect(res.status).toBe(200);
    expect(res.body.data.createdCount).toBe(1);

    const rows = await notifRows(A.companyId, "LMS_ENROLLMENT_APPROVED");
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_user_id).toBe(learner);
    // Đây là 2 cột đã giết GOAL: chúng phải qua được chk_notifications_module_code / _notification_type.
    expect(rows[0].module_code).toBe("LMS");
    expect(rows[0].notification_type).toBe("Training");
    expect(rows[0].target_url).toBe("/me/training");
    expect(rows[0].title).toBe("Ghi danh khoá học đã được duyệt");
    expect(rows[0].body).toContain("An toàn lao động");
    // Template render THẬT (không fallback) ⇒ không còn placeholder nào sót lại.
    expect(rows[0].body).not.toContain("{course_name}");

    const logs = await direct.query(
      `SELECT l.delivery_status, l.channel, l.attempt_no, l.metadata
         FROM notification_delivery_logs l
         JOIN notifications n ON n.id = l.notification_id
        WHERE n.company_id=$1 AND n.event_code='LMS_ENROLLMENT_APPROVED'`,
      [A.companyId],
    );
    expect(logs.rows).toHaveLength(1);
    expect(logs.rows[0].delivery_status).toBe("Sent");
    expect(logs.rows[0].channel).toBe("IN_APP");
    // metadata.reason='template_fallback' nghĩa là template seed 0529 KHÔNG khớp — phải null.
    expect(logs.rows[0].metadata).toBeNull();
  });

  it("(h2) LMS_EXAM_GRADED + LMS_COURSE_DEADLINE_NEAR render đúng template seed 0529", async () => {
    const graded = await api(nest)
      .post(ROUTE)
      .set(asLms())
      .send(body({ eventCode: "LMS_EXAM_GRADED", payload: { exam_name: "Kiểm tra cuối khoá" } }));
    expect(graded.status).toBe(200);
    expect(graded.body.data.createdCount).toBe(1);

    const near = await api(nest)
      .post(ROUTE)
      .set(asLms())
      .send(
        body({
          eventCode: "LMS_COURSE_DEADLINE_NEAR",
          payload: { course_name: "An toàn lao động", deadline_label: "31/07/2026" },
        }),
      );
    expect(near.status).toBe(200);
    expect(near.body.data.createdCount).toBe(1);

    const gradedRows = await notifRows(A.companyId, "LMS_EXAM_GRADED");
    expect(gradedRows[0].notification_type).toBe("Training");
    expect(gradedRows[0].body).toContain("Kiểm tra cuối khoá");

    const nearRows = await notifRows(A.companyId, "LMS_COURSE_DEADLINE_NEAR");
    // DEADLINE_NEAR dùng type 'Reminder' theo quy ước nhắc hạn sẵn có, priority High.
    expect(nearRows[0].notification_type).toBe("Reminder");
    expect(nearRows[0].priority).toBe("High");
    expect(nearRows[0].body).toContain("31/07/2026");
  });

  // ── (i) dedupe — retry của LMS không đẻ thông báo trùng ──────────────────────────
  it("(i) gọi lại cùng dedupeKey → created=0, deduped=1 (chỉ còn 1 hàng)", async () => {
    const entityId = randomUUID();
    const payload = body({
      eventCode: "LMS_COURSE_ASSIGNED",
      sourceEntityId: entityId,
      dedupeKey: `lms:LMS_COURSE_ASSIGNED:${entityId}:${learner}`,
      payload: { course_name: "Quy trình nội bộ" },
    });

    const first = await api(nest).post(ROUTE).set(asLms()).send(payload);
    expect(first.status).toBe(200);
    expect(first.body.data.createdCount).toBe(1);

    const second = await api(nest).post(ROUTE).set(asLms()).send(payload);
    expect(second.status).toBe(200);
    expect(second.body.data.createdCount).toBe(0);
    expect(second.body.data.dedupedCount).toBe(1);

    expect(await notifRows(A.companyId, "LMS_COURSE_ASSIGNED")).toHaveLength(1);
  });

  it("(i3) quá 20 người nhận → 400, KHÔNG tạo hàng nào (chặn khuếch đại 1-request→N-INSERT)", async () => {
    const many = Array.from({ length: 21 }, () => randomUUID());
    const res = await api(nest)
      .post(ROUTE)
      .set(asLms())
      .send(body({ eventCode: "LMS_EXAM_GRADED", recipient: { mode: "UserIds", userIds: many } }));
    expect(res.status).toBe(400);
    expect(res.body.code ?? res.body.error?.code).toBe("NOTI-ERR-TOO-MANY-RECIPIENTS");
  });

  it("(i2) thiếu dedupeKey → 400 (dedupe tắt im lặng là hỏng thầm lặng — phải ồn ào)", async () => {
    const { dedupeKey: _omitted, ...withoutKey } = body();
    const res = await api(nest).post(ROUTE).set(asLms()).send(withoutKey);
    expect(res.status).toBe(400);
    expect(res.body.code ?? res.body.error?.code).toBe("NOTI-ERR-DEDUPE-KEY-REQUIRED");
  });

  // ── (j) HỒI QUY GOAL — CHECK bảng `notifications` mà 0507 bỏ sót (plan §0.1) ─────
  it("(j) hồi quy: GOAL_ASSIGNED qua route JWT cũ tạo được notification module_code='GOAL'", async () => {
    const login = await api(nest)
      .post("/auth/login")
      .send({ companySlug: A.slug, email: actorEmail, password: PASSWORD });
    expect(login.status, `login failed: ${JSON.stringify(login.body)}`).toBe(200);
    const token = login.body.data.accessToken as string;

    const res = await api(nest)
      .post(LEGACY_ROUTE)
      .set({ Authorization: `Bearer ${token}`, "x-internal-key": INTERNAL_KEY })
      .send({
        eventCode: "GOAL_ASSIGNED",
        sourceModule: "GOAL",
        sourceEntityType: "goal",
        recipient: { mode: "UserIds", userIds: [learner] },
        // goalId BẮT BUỘC: template GOAL có target_url '/goals/{goalId}'; thiếu ⇒ renderer giữ literal
        // '{goalId}' ⇒ assertInternalTargetUrl ném 422 (dấu ngoặc nhọn ngoài whitelist).
        payload: { goalId: randomUUID(), goal_code: "MT-001", goal_name: "Mục tiêu thử" },
      });

    // TRƯỚC 0529: INSERT vỡ chk_notifications_module_code ⇒ 500. Sau 0529: 200 + 1 hàng.
    expect(res.status, `intake GOAL thất bại: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.data.createdCount).toBe(1);

    const rows = await notifRows(A.companyId, "GOAL_ASSIGNED");
    expect(rows).toHaveLength(1);
    expect(rows[0].module_code).toBe("GOAL");
    expect(rows[0].notification_type).toBe("Goal");
    expect(actor).toBeTruthy();
  });
});
