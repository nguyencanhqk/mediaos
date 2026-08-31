/**
 * S12-RECRUIT-BE-1 — NOTI (SPEC-12 §17, plan `docs/plans/S12-RECRUIT-BE-1.md` §8/§9.1 hàng
 * `recruit-be1-noti.int-spec.ts`), đường THẬT: PATCH/move-stage/POST → outbox (enqueue trong tx) →
 * `OutboxWorker` → `RecruitNotiBridgeRegistrar` → engine.intake → `notifications`.
 *
 *   · boot app KHÔNG lỗi = `registerSource` khớp catalog seed 0561 (chính `beforeAll` pass là bằng
 *     chứng — registrar ném NGAY lúc `onModuleInit` nếu `eventCode` sai).
 *   · drift-guard: role `RECRUIT_HR_ROLE_NAME` ('hr') phải là role hệ thống DUY NHẤT khớp — seed đổi
 *     tên mà quên cập nhật hằng ⇒ ca này ĐỎ NGAY thay vì NOTI-019 âm thầm không gửi cho ai.
 *   · 016 — gán A(t1)→B→A(t2): A nhận 2 noti (khoá dedupe theo `updated_at` RETURNING của CHÍNH câu
 *     UPDATE, không phải `auditLogId`) — `updatedAt` PHẢI TĂNG NGHIÊM NGẶT giữa 2 lần gán; replay
 *     THẬT (đặt lại outbox row đã 'done' về 'pending' rồi drain lại) ⇒ KHÔNG nhân đôi
 *     (`processed_events` là chốt dedupe ở tầng worker, độc lập với unique dedupeKey ở tầng notification).
 *   · 017 — 2 participant (1 có user, 1 employee KHÔNG user) ⇒ đúng 1 noti cho user đó, employee
 *     không-user bị bỏ qua IM LẶNG (không lỗi); replay không nhân đôi.
 *   · 018 — move-stage tới recruiter phụ trách vị trí (trừ actor); actor tự move vị trí MÌNH phụ
 *     trách ⇒ 0 noti (engine tự loại actor khỏi payload — không có gì để loại thêm ở registrar).
 *   · 019 — enqueue TRỰC TIẾP `recruit.candidate_hired` vào outbox (không qua convert — file convert
 *     cover đường thật) ⇒ tới MỌI user giữ role `hr`, KHÔNG tới user giữ `hr-manager` (B6 DB-1).
 *
 * Spec lái OutboxWorker ⇒ PHẢI giữ `acquireOutboxWorkerLock` (S7-QA-OUTBOXPROBE-1). GATE cứng
 * `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */

import { randomUUID } from "node:crypto";
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
import { OutboxWorker } from "../../src/events/outbox-worker";
import { RECRUIT_HR_ROLE_NAME } from "../../src/notifications/recruit-audience.reader";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import { drainOutboxUntilSettled } from "../helpers/outbox-drain";
import {
  acquireOutboxWorkerLock,
  OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS,
  type OutboxWorkerLock,
} from "../helpers/outbox-worker-lock";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("recruitbe1noti");

/** Role hệ thống cố định (mig 0444/0019/0560) — literal chỉ dùng để GẮN user, KHÔNG để so khớp hằng. */
const RECRUITER_ROLE_ID = "00000000-0000-0000-0000-000000000014";
const HR_MANAGER_ROLE_ID = "00000000-0000-0000-0000-000000000009";

interface NotiRow {
  id: string;
  dedupeKey: string | null;
  sourceEntityId: string | null;
  payload: Record<string, unknown>;
}

describe.skipIf(!hasLaneDb)("S12-RECRUIT-BE-1 NOTI (outbox thật) — 4 event + drift-guard", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  let outboxLock: OutboxWorkerLock | undefined;

  let actorUserId = "";
  let tActor = "";
  let orgUnitId = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));

  const drain = () =>
    drainOutboxUntilSettled({ worker: app.get(OutboxWorker), direct, companyIds });

  const notisOf = async (userId: string, eventCode: string): Promise<NotiRow[]> =>
    (
      await direct.query(
        `SELECT id, dedupe_key AS "dedupeKey", source_entity_id AS "sourceEntityId", payload
           FROM notifications
          WHERE company_id = $1 AND recipient_user_id = $2 AND event_code = $3 AND deleted_at IS NULL
          ORDER BY created_at`,
        [A.companyId, userId, eventCode],
      )
    ).rows as NotiRow[];

  const outboxRowsOf = async (
    eventType: string,
  ): Promise<Array<{ id: string; status: string; payload: Record<string, unknown> }>> =>
    (
      await direct.query(
        `SELECT id, status, payload FROM outbox_events
          WHERE company_id = $1 AND event_type = $2 ORDER BY created_at`,
        [A.companyId, eventType],
      )
    ).rows as Array<{ id: string; status: string; payload: Record<string, unknown> }>;

  /** Reset MỘT hàng outbox đã 'done' về 'pending' rồi drain lại — replay THẬT (không phải no-op). */
  async function replayOutboxRow(id: string): Promise<void> {
    await direct.query(
      `UPDATE outbox_events SET status = 'pending', available_at = now(), attempts = 0 WHERE id = $1`,
      [id],
    );
    await drain();
  }

  async function login(companySlug: string, email: string): Promise<string> {
    const res = await http().post("/auth/login").send({ companySlug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function activeUser(label: string): Promise<string> {
    return seedUser(direct, A.companyId, `${label}-${randomUUID().slice(0, 6)}@${A.slug}.test`);
  }

  async function newEmployee(userId: string | null, status: "active" | "inactive" = "active") {
    const r = await direct.query(
      "INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,$3) RETURNING id",
      [A.companyId, userId, status],
    );
    return r.rows[0].id as string;
  }

  async function newJob(recruiterUserId?: string): Promise<string> {
    const res = await post(tActor, "/job-openings").send({
      title: `NOTI QA ${randomUUID().slice(0, 6)}`,
      orgUnitId,
      ...(recruiterUserId ? { recruiterUserId } : {}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const opened = await post(tActor, `/job-openings/${res.body.data.id}/change-status`).send({
      toStatus: "Open",
    });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function newCandidate(jobOpeningId: string): Promise<string> {
    const res = await post(tActor, "/candidates").send({
      jobOpeningId,
      fullName: `Ứng viên NOTI ${randomUUID().slice(0, 6)}`,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function moveStage(candidateId: string, toStage: string): Promise<request.Response> {
    return post(tActor, `/candidates/${candidateId}/move-stage`).send({
      toStage,
      reason: "chuyển giai đoạn NOTI QA",
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();
    outboxLock = await acquireOutboxWorkerLock("recruit-be1-noti");

    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "recnoti");
    companyIds.push(A.companyId);

    actorUserId = await seedUser(direct, A.companyId, `actor@${A.slug}.test`, hash);
    await seedUserRole(direct, actorUserId, RECRUITER_ROLE_ID, A.companyId);
    tActor = await login(A.slug, `actor@${A.slug}.test`);

    const org = await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
      [A.companyId, `recnoti-org-${A.slug}`],
    );
    orgUnitId = org.rows[0].id as string;
  }, OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await outboxLock?.release();
    await direct?.end();
    await app?.close();
  });

  it("app boot thành công — RecruitNotiBridgeRegistrar.registerSource khớp catalog seed 0561", () => {
    expect(app).toBeDefined();
  });

  it("drift-guard: role RECRUIT_HR_ROLE_NAME ('hr') là role hệ thống DUY NHẤT khớp tên", async () => {
    const rows = await direct.query(
      `SELECT id FROM roles WHERE name = $1 AND company_id IS NULL AND is_system = true`,
      [RECRUIT_HR_ROLE_NAME],
    );
    expect(rows.rows, JSON.stringify(rows.rows)).toHaveLength(1);
  });

  it("016 — gán A(t1)→B→A(t2): A nhận 2 noti, updatedAt tăng nghiêm ngặt, replay THẬT không nhân đôi", async () => {
    const userA = await activeUser("assignee-a");
    const userB = await activeUser("assignee-b");
    const jobId = await newJob();

    const p1 = await patch(tActor, `/job-openings/${jobId}`).send({ recruiterUserId: userA });
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    const updatedAt1 = p1.body.data.updatedAt as string;

    const p2 = await patch(tActor, `/job-openings/${jobId}`).send({ recruiterUserId: userB });
    expect(p2.status, JSON.stringify(p2.body)).toBe(200);

    const p3 = await patch(tActor, `/job-openings/${jobId}`).send({ recruiterUserId: userA });
    expect(p3.status, JSON.stringify(p3.body)).toBe(200);
    const updatedAt2 = p3.body.data.updatedAt as string;

    expect(
      new Date(updatedAt2).getTime(),
      `t2=${updatedAt2} phải > t1=${updatedAt1}`,
    ).toBeGreaterThan(new Date(updatedAt1).getTime());

    await drain();
    const notisA = await notisOf(userA, "RECRUIT_JOB_ASSIGNED");
    const forThisJob = notisA.filter((n) => n.sourceEntityId === jobId);
    expect(forThisJob, JSON.stringify(forThisJob)).toHaveLength(2);
    expect(new Set(forThisJob.map((n) => n.dedupeKey)).size, "2 khoá dedupe PHẢI khác nhau").toBe(
      2,
    );
    // Bridge tự prefix eventCode vào khoá lưu (khuôn ASSET `${eventCode}:${...}`).
    expect(forThisJob.map((n) => n.dedupeKey)).toEqual([
      `RECRUIT_JOB_ASSIGNED:${jobId}:${userA}:${updatedAt1}`,
      `RECRUIT_JOB_ASSIGNED:${jobId}:${userA}:${updatedAt2}`,
    ]);

    // Replay THẬT: đặt lại hàng outbox thứ 2 (t2) về 'pending' rồi drain lại — KHÔNG nhân đôi.
    const outboxRows = await outboxRowsOf("recruit.job_assigned");
    const rowT2 = outboxRows.find(
      (r) =>
        (r.payload as { jobOpeningId?: string; newRecruiterUserId?: string }).jobOpeningId ===
          jobId &&
        (r.payload as { newRecruiterUserId?: string }).newRecruiterUserId === userA &&
        (r.payload as { assignedAtIso?: string }).assignedAtIso === updatedAt2,
    );
    expect(rowT2, JSON.stringify(outboxRows)).toBeDefined();
    await replayOutboxRow(rowT2!.id);
    const afterReplay = (await notisOf(userA, "RECRUIT_JOB_ASSIGNED")).filter(
      (n) => n.sourceEntityId === jobId,
    );
    expect(afterReplay, "replay CÙNG hàng outbox không được nhân đôi").toHaveLength(2);
  });

  it("017 — 2 participant (1 có user, 1 employee KHÔNG user) ⇒ đúng 1 noti; employee không-user bỏ qua im lặng; replay không nhân đôi", async () => {
    const jobId = await newJob();
    const candidateId = await newCandidate(jobId);
    expect((await moveStage(candidateId, "Screening")).status).toBe(201);
    expect((await moveStage(candidateId, "Interview")).status).toBe(201);

    const participantUserId = await activeUser("participant-with-user");
    const empWithUser = await newEmployee(participantUserId, "active");
    const empNoUser = await newEmployee(null, "active");

    const iv = await post(tActor, "/interviews").send({
      candidateId,
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 5_400_000).toISOString(),
      participantEmployeeIds: [empWithUser, empNoUser],
    });
    expect(iv.status, JSON.stringify(iv.body)).toBe(201);
    const interviewId = iv.body.data.id as string;

    await drain();
    const notis = await notisOf(participantUserId, "RECRUIT_INTERVIEW_SCHEDULED");
    expect(notis, JSON.stringify(notis)).toHaveLength(1);
    expect(notis[0].sourceEntityId).toBe(interviewId);

    // Tổng noti của event này cho lượt này CHỈ 1 hàng (không có "user ma" nào khác nhận thêm).
    const total = await direct.query(
      `SELECT count(*)::int AS n FROM notifications
        WHERE company_id = $1 AND event_code = 'RECRUIT_INTERVIEW_SCHEDULED' AND source_entity_id = $2
          AND deleted_at IS NULL`,
      [A.companyId, interviewId],
    );
    expect(total.rows[0].n).toBe(1);

    const rows = await outboxRowsOf("recruit.interview_scheduled");
    const row = rows.find(
      (r) => (r.payload as { interviewId?: string }).interviewId === interviewId,
    );
    expect(row, JSON.stringify(rows)).toBeDefined();
    await replayOutboxRow(row!.id);
    const afterReplay = await notisOf(participantUserId, "RECRUIT_INTERVIEW_SCHEDULED");
    expect(afterReplay, "replay không được nhân đôi").toHaveLength(1);
  });

  it("018 — move-stage ⇒ noti tới recruiter phụ trách vị trí (trừ actor); actor tự move vị trí MÌNH phụ trách ⇒ 0 noti", async () => {
    const recruiterB = await activeUser("recruiter-b");
    const jobOther = await newJob(recruiterB);
    const candOther = await newCandidate(jobOther);
    expect((await moveStage(candOther, "Screening")).status).toBe(201);

    await drain();
    const notisB = (await notisOf(recruiterB, "RECRUIT_STAGE_CHANGED")).filter(
      (n) => n.sourceEntityId === candOther,
    );
    expect(notisB, JSON.stringify(notisB)).toHaveLength(1);

    const jobSelf = await newJob(actorUserId);
    const candSelf = await newCandidate(jobSelf);
    expect((await moveStage(candSelf, "Screening")).status).toBe(201);

    await drain();
    const notisSelf = (await notisOf(actorUserId, "RECRUIT_STAGE_CHANGED")).filter(
      (n) => n.sourceEntityId === candSelf,
    );
    expect(
      notisSelf,
      "actor tự move vị trí mình phụ trách ⇒ engine loại actor khỏi recipient",
    ).toHaveLength(0);
  });

  it("019 — enqueue TRỰC TIẾP recruit.candidate_hired ⇒ tới MỌI user giữ role hr, KHÔNG tới hr-manager", async () => {
    const hrUser = await activeUser("hr-user");
    await seedUserRole(direct, hrUser, "00000000-0000-0000-0000-000000000011", A.companyId);
    const hrManagerUser = await activeUser("hr-manager-user");
    await seedUserRole(direct, hrManagerUser, HR_MANAGER_ROLE_ID, A.companyId);

    const fakeCandidateId = randomUUID();
    // Payload theo ĐÚNG hợp đồng recruit-noti.payload.ts (kèm khoá snake_case mà template 0561 cần —
    // thiếu `candidate_id` là renderer giữ `{candidate_id}` trong target_url ⇒ dead-letter fail-loud).
    const payload = {
      candidateId: fakeCandidateId,
      employeeId: randomUUID(),
      jobOpeningId: randomUUID(),
      actorUserId,
      candidate_name: "Ứng viên 019 QA",
      job_title: "Backend Engineer QA",
      candidate_id: fakeCandidateId,
    };
    await direct.query(
      `INSERT INTO outbox_events (company_id, event_type, payload) VALUES ($1, $2, $3::jsonb)`,
      [A.companyId, "recruit.candidate_hired", JSON.stringify(payload)],
    );

    await drain();
    const notisHr = (await notisOf(hrUser, "RECRUIT_CANDIDATE_HIRED")).filter(
      (n) => n.sourceEntityId === fakeCandidateId,
    );
    expect(notisHr, JSON.stringify(notisHr)).toHaveLength(1);
    const notisHrManager = (await notisOf(hrManagerUser, "RECRUIT_CANDIDATE_HIRED")).filter(
      (n) => n.sourceEntityId === fakeCandidateId,
    );
    expect(
      notisHrManager,
      "hr-manager KHÔNG có grant RECRUIT — B6 DB-1, không được nhận",
    ).toHaveLength(0);
  });
});
