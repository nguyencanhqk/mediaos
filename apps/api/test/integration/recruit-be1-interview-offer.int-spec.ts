/**
 * S12-RECRUIT-BE-1 — tiền điều kiện interview/offer + race UNIQUE (SPEC-12 §13.3/§13.4/§3.5,
 * plan `docs/plans/S12-RECRUIT-BE-1.md` §9.1 hàng `recruit-be1-interview-offer.int-spec.ts`).
 *
 * Đường THẬT qua API (chủ thể = role hệ thống `recruiter`, id cố định
 * `00000000-0000-0000-0000-000000000014`, đã đủ 16 cặp §9f — KHÔNG dựng role tay, mirror
 * `s12-recruit-db1-invariants.int-spec.ts` mục E3/E1): job Open → candidate đi qua FSM
 * New→Screening→Interview→Offer bằng `POST /candidates/:id/move-stage` thật, rồi bắn vào
 * `POST /interviews`/`POST /offers`/feedback để đo:
 *   · 019: stage≠Interview ⇒ 409 007 `not-in-interview-stage`; stage=Interview ⇒ 201.
 *   · 026: stage≠Offer ⇒ 409 007 `not-in-offer-stage`; stage=Offer ⇒ 201.
 *   · RACE 2 offer song song (2 Idempotency-Key KHÁC NHAU — plan §6.1 chú ý KHÔNG lẫn với ca
 *     idempotency replay) cùng ứng viên ⇒ đúng 1 thắng qua `uq_offers_candidate_open`, 1 trả 409 006.
 *   · RACE 2 feedback song song CÙNG interviewer (participant thật — actor tự làm interviewer của
 *     chính lượt mình tạo) ⇒ đúng 1 hàng qua `uq_interview_feedbacks`, 1 trả 409 012.
 *   · 422 013 `invalid-time-range` (interview) / `invalid-start-date` (offer).
 *   · 009 (employee không active) vs 010 (employee không tồn tại/khác tenant) — CÙNG route 019,
 *     đúng phân biệt 422 vs 404 (memory `equal-caps-at-zod-and-service-make-dead-error-code` — hai mã
 *     PHẢI có ca THẬT riêng, không suy diễn lẫn nhau).
 *   · PATCH feedback (024): chưa có feedback của mình ⇒ 404 010; có rồi ⇒ 200 sửa được.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5) — DB cô lập theo lane, KHÔNG chạy trên DB dùng chung.
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDEMPOTENCY_HEADER } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("recruitbe1io");
/** Role hệ thống `recruiter` (mig 0560, id cố định — 16 cặp §9f, xem E3 của `s12-recruit-db1-invariants`). */
const RECRUITER_ROLE_ID = "00000000-0000-0000-0000-000000000014";

type CandidateStage = "New" | "Screening" | "Interview" | "Offer";

describe.skipIf(!hasLaneDb)(
  "S12-RECRUIT-BE-1 interview/offer — tiền điều kiện + race (không mã chết)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let actorUserId = "";
    let actorEmployeeId = "";
    let tActor = "";
    let orgUnitId = "";
    let jobOpeningId = "";

    const http = () => request(app.getHttpServer());
    const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
    const get = (t: string, u: string) => auth(t)(http().get(u));
    const post = (t: string, u: string) => auth(t)(http().post(u));
    const patch = (t: string, u: string) => auth(t)(http().patch(u));

    const code = (res: request.Response) => res.body?.error?.code as string | undefined;
    const kind = (res: request.Response) =>
      (res.body?.error?.details as Array<{ field: string; message: string }> | null)?.find(
        (d) => d.field === "kind",
      )?.message;

    async function login(companySlug: string, email: string): Promise<string> {
      const res = await http().post("/auth/login").send({ companySlug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    async function newEmployee(
      companyId: string,
      userId: string,
      status: "active" | "inactive" = "active",
    ): Promise<string> {
      const r = await direct.query(
        "INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,$3) RETURNING id",
        [companyId, userId, status],
      );
      return r.rows[0].id as string;
    }

    async function moveStage(
      candidateId: string,
      toStage: CandidateStage,
      reason = "chuyển giai đoạn QA",
    ): Promise<request.Response> {
      return post(tActor, `/candidates/${candidateId}/move-stage`).send({ toStage, reason });
    }

    /** Tạo candidate mới rồi đi FSM New→…→`target` bằng move-stage THẬT (không seed thẳng DB). */
    async function candidateAt(target: CandidateStage): Promise<string> {
      const c = await post(tActor, "/candidates").send({
        jobOpeningId,
        fullName: `Ứng viên QA ${randomUUID().slice(0, 8)}`,
        email: `cand-${randomUUID().slice(0, 8)}@x.test`,
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      const id = c.body.data.id as string;
      if (target === "New") return id;
      const order: CandidateStage[] = ["Screening", "Interview", "Offer"];
      for (const stage of order) {
        const r = await moveStage(id, stage);
        // POST /candidates/:id/move-stage KHÔNG có @HttpCode override ⇒ mặc định Nest 201 (mirror
        // convention ASSET: mọi route ghi @Post() trả 201, kể cả route hành động không tạo resource).
        expect(r.status, `move → ${stage}: ${JSON.stringify(r.body)}`).toBe(201);
        if (stage === target) break;
      }
      return id;
    }

    function slot(offsetMin: number, durMin: number): { startsAt: string; endsAt: string } {
      const start = new Date(Date.now() + offsetMin * 60_000);
      const end = new Date(start.getTime() + durMin * 60_000);
      return { startsAt: start.toISOString(), endsAt: end.toISOString() };
    }

    const futureDateStr = (): string =>
      new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();

      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "recio-a");
      B = await seedCompany(direct, "recio-b");
      companyIds.push(A.companyId, B.companyId);

      actorUserId = await seedUser(direct, A.companyId, `actor@${A.slug}.test`, hash);
      await seedUserRole(direct, actorUserId, RECRUITER_ROLE_ID, A.companyId);
      tActor = await login(A.slug, `actor@${A.slug}.test`);
      // Actor CŨNG là interviewer/participant — cần hồ sơ nhân viên để own-scope feedback resolve được.
      actorEmployeeId = await newEmployee(A.companyId, actorUserId, "active");

      const org = await direct.query(
        "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
        [A.companyId, `recio-org-${A.slug}`],
      );
      orgUnitId = org.rows[0].id as string;

      const job = await post(tActor, "/job-openings").send({
        title: "Backend Engineer QA",
        orgUnitId,
      });
      expect(job.status, JSON.stringify(job.body)).toBe(201);
      jobOpeningId = job.body.data.id as string;
      const opened = await post(tActor, `/job-openings/${jobOpeningId}/change-status`).send({
        toStatus: "Open",
      });
      expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    }, 120_000);

    afterAll(async () => {
      if (direct) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    it("POST /interviews khi candidate stage=Screening ⇒ 409 RECRUIT-ERR-007 not-in-interview-stage", async () => {
      const cid = await candidateAt("Screening");
      const s = slot(60, 45);
      const res = await post(tActor, "/interviews").send({
        candidateId: cid,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        participantEmployeeIds: [actorEmployeeId],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(code(res)).toBe("RECRUIT-ERR-007");
      expect(kind(res)).toBe("not-in-interview-stage");
    });

    it("POST /interviews khi candidate stage=Interview ⇒ 201", async () => {
      const cid = await candidateAt("Interview");
      const s = slot(60, 45);
      const res = await post(tActor, "/interviews").send({
        candidateId: cid,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        participantEmployeeIds: [actorEmployeeId],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.id).toBeTruthy();
      expect(res.body.data.status).toBe("Scheduled");
    });

    it("POST /offers khi stage=Interview ⇒ 409 007 not-in-offer-stage; move sang Offer rồi POST /offers ⇒ 201", async () => {
      const cid = await candidateAt("Interview");
      const bad = await post(tActor, "/offers").send({
        candidateId: cid,
        startDate: futureDateStr(),
        salary: "20000000",
      });
      expect(bad.status, JSON.stringify(bad.body)).toBe(409);
      expect(code(bad)).toBe("RECRUIT-ERR-007");
      expect(kind(bad)).toBe("not-in-offer-stage");

      const mv = await moveStage(cid, "Offer");
      expect(mv.status, JSON.stringify(mv.body)).toBe(201);

      const ok = await post(tActor, "/offers").send({
        candidateId: cid,
        startDate: futureDateStr(),
        salary: "20000000",
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.data.status).toBe("Draft");
    });

    it("2 POST /offers SONG SONG (2 Idempotency-Key khác nhau) cùng candidate ⇒ 1 sống + 1 409 006, không 500", async () => {
      const cid = await candidateAt("Offer");
      const body = { candidateId: cid, startDate: futureDateStr(), salary: "15000000" };
      const [x, y] = await Promise.all([
        post(tActor, "/offers").set(IDEMPOTENCY_HEADER, `off-race-1-${cid}`).send(body),
        post(tActor, "/offers").set(IDEMPOTENCY_HEADER, `off-race-2-${cid}`).send(body),
      ]);
      const statuses = [x.status, y.status].sort();
      expect(statuses, JSON.stringify([x.body, y.body])).toEqual([201, 409]);
      const loser = x.status === 409 ? x : y;
      expect(code(loser)).toBe("RECRUIT-ERR-006");
      const rows = await direct.query(
        "SELECT count(*)::int AS n FROM offers WHERE candidate_id = $1",
        [cid],
      );
      expect(rows.rows[0].n).toBe(1);
    });

    it("2 POST feedback SONG SONG cùng interviewer (participant thật) ⇒ 1 hàng + 409 012, không 500", async () => {
      const cid = await candidateAt("Interview");
      const s = slot(90, 45);
      const iv = await post(tActor, "/interviews").send({
        candidateId: cid,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        participantEmployeeIds: [actorEmployeeId],
      });
      expect(iv.status, JSON.stringify(iv.body)).toBe(201);
      const interviewId = iv.body.data.id as string;
      const body = { rating: 4, recommendation: "Hire" };

      const [x, y] = await Promise.all([
        post(tActor, `/interviews/${interviewId}/feedback`).send(body),
        post(tActor, `/interviews/${interviewId}/feedback`).send(body),
      ]);
      const statuses = [x.status, y.status].sort();
      expect(statuses, JSON.stringify([x.body, y.body])).toEqual([201, 409]);
      const loser = x.status === 409 ? x : y;
      expect(code(loser)).toBe("RECRUIT-ERR-012");

      const rows = await direct.query(
        "SELECT count(*)::int AS n FROM interview_feedbacks WHERE interview_id = $1 AND interviewer_employee_id = $2",
        [interviewId, actorEmployeeId],
      );
      expect(rows.rows[0].n).toBe(1);
    });

    it("POST /interviews với endsAt <= startsAt ⇒ 422 013 invalid-time-range", async () => {
      const cid = await candidateAt("Interview");
      const start = new Date(Date.now() + 3_600_000).toISOString();
      const res = await post(tActor, "/interviews").send({
        candidateId: cid,
        startsAt: start,
        endsAt: start,
        participantEmployeeIds: [actorEmployeeId],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(code(res)).toBe("RECRUIT-ERR-013");
      expect(kind(res)).toBe("invalid-time-range");
    });

    it("POST /offers với startDate quá khứ ⇒ 422 013 invalid-start-date", async () => {
      const cid = await candidateAt("Offer");
      const res = await post(tActor, "/offers").send({
        candidateId: cid,
        startDate: "2020-01-01",
        salary: "10000000",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(code(res)).toBe("RECRUIT-ERR-013");
      expect(kind(res)).toBe("invalid-start-date");
    });

    it("participantEmployeeIds: employee KHÔNG active ⇒ 422 009 employee-inactive", async () => {
      const inactiveUser = await seedUser(
        direct,
        A.companyId,
        `inactive@${A.slug}.test`,
        await new PasswordService().hash(LOGIN_PW),
      );
      const inactiveEmp = await newEmployee(A.companyId, inactiveUser, "active");
      // UPDATE direct — status không-active PHẢI chặn ở tầng 013/009, không phải qua tạo sẵn đã inactive.
      await direct.query("UPDATE employee_profiles SET status = 'inactive' WHERE id = $1", [
        inactiveEmp,
      ]);

      const cid = await candidateAt("Interview");
      const s = slot(120, 30);
      const res = await post(tActor, "/interviews").send({
        candidateId: cid,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        participantEmployeeIds: [inactiveEmp],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(code(res)).toBe("RECRUIT-ERR-009");
      expect(kind(res)).toBe("employee-inactive");
    });

    // ⚠️ ĐÍNH CHÍNH (đo thật trên LANE_DB, KHÔNG theo giả định ban đầu của người viết task): "không tồn
    // tại/khác tenant" ở route 019 map mã **009** (`recruitPeopleRefNotFound`, `recruit.errors.ts:111`,
    // kind `employee-not-found`), KHÔNG PHẢI 010 — 010 là sentinel not-found CHUNG cho chính đối tượng
    // route (candidate/interview/offer/job-opening), còn 009 = "tham chiếu người/tổ chức không hợp lệ".
    // Cả not-found LẪN not-active của employee tham chiếu đều dùng mã 009, chỉ khác HTTP status
    // (404 vs 422) — khớp plan §2.3 route 019 cột mã lỗi "404/422 `009`" và SPEC-12 §12.
    it("participantEmployeeIds: employee id không tồn tại ⇒ 404 009 employee-not-found (KHÔNG phải 010)", async () => {
      const cid = await candidateAt("Interview");
      const s = slot(150, 30);
      const ghostId = randomUUID();
      const res = await post(tActor, "/interviews").send({
        candidateId: cid,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        participantEmployeeIds: [ghostId],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(code(res)).toBe("RECRUIT-ERR-009");
      expect(kind(res)).toBe("employee-not-found");
    });

    it("participantEmployeeIds: employee khác tenant ⇒ 404 009 (CÙNG mã với không-tồn-tại — không lộ oracle)", async () => {
      const bUser = await seedUser(direct, B.companyId, `bempuser@${B.slug}.test`);
      const bEmp = await newEmployee(B.companyId, bUser, "active");

      const cid = await candidateAt("Interview");
      const s = slot(180, 30);
      const res = await post(tActor, "/interviews").send({
        candidateId: cid,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        participantEmployeeIds: [bEmp],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(code(res)).toBe("RECRUIT-ERR-009");
    });

    it("PATCH /interviews/:id/feedback khi chưa có feedback của mình ⇒ 404 010; sau khi có ⇒ 200 sửa được rating", async () => {
      const cid = await candidateAt("Interview");
      const s = slot(200, 45);
      const iv = await post(tActor, "/interviews").send({
        candidateId: cid,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        participantEmployeeIds: [actorEmployeeId],
      });
      expect(iv.status, JSON.stringify(iv.body)).toBe(201);
      const interviewId = iv.body.data.id as string;

      const before = await patch(tActor, `/interviews/${interviewId}/feedback`).send({
        rating: 5,
      });
      expect(before.status, JSON.stringify(before.body)).toBe(404);
      expect(code(before)).toBe("RECRUIT-ERR-010");

      const created = await post(tActor, `/interviews/${interviewId}/feedback`).send({
        rating: 3,
        recommendation: "Consider",
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);

      const updated = await patch(tActor, `/interviews/${interviewId}/feedback`).send({
        rating: 5,
        recommendation: "Hire",
      });
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      expect(updated.body.data.rating).toBe(5);
      expect(updated.body.data.recommendation).toBe("Hire");
    });

    // Neo chống-nhiễu: đảm bảo fixture job/org dùng chung không bị test khác đổi ngầm giữa chừng.
    it("sanity: job-opening giữ nguyên Open trong suốt file", async () => {
      const res = await get(tActor, `/job-openings/${jobOpeningId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe("Open");
    });
  },
);
