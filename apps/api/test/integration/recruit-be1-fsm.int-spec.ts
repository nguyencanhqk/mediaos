/**
 * S12-RECRUIT-BE-1 — 4 FSM (candidate/job-opening/interview/offer, SPEC-12 §13.1–13.4) + job-Closed
 * chặn tạo/chuyển candidate (KHÔNG chặn move-stage) + Zod `.strict()` field lạ ⇒ 400 tại biên (không
 * rơi vào nhánh service nào — chống mã chết `equal-caps-at-zod-and-service-make-dead-error-code`).
 *
 * Chiến lược fixture: mỗi trạng thái NGUỒN dùng LẠI MỘT bản ghi cho các ca ✗ (409 KHÔNG mutate hàng),
 * chỉ hàng cuối cùng của mỗi khối mới thực hiện bước chuyển HỢP LỆ (mutate — đặt SAU CÙNG).
 *
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane (CLAUDE.md §9.5).
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

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = "Passw0rd!recruitfsm1";
const EMPLOYEE_CODE_SEQUENCE_KEY = "EMPLOYEE_CODE";

describe.skipIf(!hasLaneDb)(
  "S12-RECRUIT-BE-1 FSM (4 đối tượng) + job-Closed + Zod .strict()",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];
    let tFull = "";
    let orgUnitId = "";

    const http = () => request(app.getHttpServer());
    const auth = (r: request.Test) => r.set("Authorization", `Bearer ${tFull}`);
    const get = (u: string) => auth(http().get(u));
    const post = (u: string) => auth(http().post(u));
    const patch = (u: string) => auth(http().patch(u));

    async function seedOrgUnit(companyId: string, name: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO org_units (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [companyId, name],
      );
      return r.rows[0].id as string;
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

    async function createJob(title: string): Promise<string> {
      const res = await post("/job-openings").send({ title, orgUnitId });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id;
    }

    async function createCandidate(jobOpeningId: string, fullName: string): Promise<string> {
      const res = await post("/candidates").send({ jobOpeningId, fullName });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id;
    }

    async function moveStage(
      candidateId: string,
      toStage: string,
      reason = "qa fsm",
    ): Promise<void> {
      const res = await post(`/candidates/${candidateId}/move-stage`).send({ toStage, reason });
      expect(res.status, `move ${candidateId}->${toStage}: ${JSON.stringify(res.body)}`).toBe(201);
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "recruitfsm1");
      companyIds.push(A.companyId);
      await seedEmployeeCodeCounter(A.companyId);

      const allPairs: Array<[string, string]> = [
        ["access", "recruit"],
        ["view", "job-opening"],
        ["create", "job-opening"],
        ["update", "job-opening"],
        ["view", "candidate"],
        ["create", "candidate"],
        ["export", "candidate"],
        ["update", "candidate"],
        ["move-stage", "candidate"],
        ["comment", "candidate"],
        ["convert", "candidate"],
        ["view", "interview"],
        ["manage", "interview"],
        ["feedback", "interview"],
        ["view", "offer"],
        ["manage", "offer"],
      ];
      const fullUser = await seedUser(direct, A.companyId, `full@${A.slug}.test`, hash);
      const roleId = await seedRole(direct, A.companyId, "recruitfsm1-full");
      for (const [action, resource] of allPairs) {
        const sensitive = resource === "candidate";
        const permId = await seedPermissionCatalog(direct, action, resource, sensitive);
        await seedRolePermission(
          direct,
          roleId,
          permId,
          "ALLOW",
          action === "access" ? "Own" : "Company",
        );
      }
      await seedUserRole(direct, fullUser, roleId, A.companyId);

      const loginRes = await http()
        .post("/auth/login")
        .send({ companySlug: A.slug, email: `full@${A.slug}.test`, password: LOGIN_PW });
      expect(loginRes.status, JSON.stringify(loginRes.body)).toBe(200);
      tFull = loginRes.body.data.accessToken;

      orgUnitId = await seedOrgUnit(A.companyId, "FSM Org");
    }, 180_000);

    afterAll(async () => {
      if (direct) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ── Candidate FSM §13.1 ────────────────────────────────────────────────────────────────────────
    describe("Candidate FSM §13.1 — mọi ô ✗ ⇒ 409 001; Offer→Hired tay ⇒ 409 014; lùi/reopen ⇒ 200", () => {
      let job = "";
      beforeAll(async () => {
        job = await createJob("FSM Candidate Job");
      });

      it("New: →Interview/→Offer/→Hired/→New (self) ⇒ 409 RECRUIT-ERR-001", async () => {
        const cid = await createCandidate(job, "Cand New");
        for (const toStage of ["Interview", "Offer", "Hired", "New"]) {
          const res = await post(`/candidates/${cid}/move-stage`).send({
            toStage,
            reason: "qa fsm",
          });
          expect(res.status, `New->${toStage}: ${JSON.stringify(res.body)}`).toBe(409);
          expect(res.body.error.code).toBe("RECRUIT-ERR-001");
        }
      });

      it("Screening: →New/→Offer/→Hired/→Screening (self) ⇒ 409 001", async () => {
        const cid = await createCandidate(job, "Cand Screening");
        await moveStage(cid, "Screening");
        for (const toStage of ["New", "Offer", "Hired", "Screening"]) {
          const res = await post(`/candidates/${cid}/move-stage`).send({
            toStage,
            reason: "qa fsm",
          });
          expect(res.status, `Screening->${toStage}: ${JSON.stringify(res.body)}`).toBe(409);
          expect(res.body.error.code).toBe("RECRUIT-ERR-001");
        }
      });

      it("Interview: →New/→Hired/→Interview (self) ⇒ 409 001; →Screening (lùi) ⇒ 200 (cuối cùng)", async () => {
        const cid = await createCandidate(job, "Cand Interview");
        await moveStage(cid, "Screening");
        await moveStage(cid, "Interview");
        for (const toStage of ["New", "Hired", "Interview"]) {
          const res = await post(`/candidates/${cid}/move-stage`).send({
            toStage,
            reason: "qa fsm",
          });
          expect(res.status, `Interview->${toStage}: ${JSON.stringify(res.body)}`).toBe(409);
          expect(res.body.error.code).toBe("RECRUIT-ERR-001");
        }
        const back = await post(`/candidates/${cid}/move-stage`).send({
          toStage: "Screening",
          reason: "lui ve Screening",
        });
        expect(back.status, JSON.stringify(back.body)).toBe(201);
        expect(back.body.data.stage).toBe("Screening");
      });

      it("Offer: →New/→Screening/→Offer (self) ⇒ 409 001; →Hired tay ⇒ 409 014; →Interview (lùi) ⇒ 200 (cuối cùng)", async () => {
        const cid = await createCandidate(job, "Cand Offer");
        await moveStage(cid, "Screening");
        await moveStage(cid, "Interview");
        await moveStage(cid, "Offer");
        for (const toStage of ["New", "Screening", "Offer"]) {
          const res = await post(`/candidates/${cid}/move-stage`).send({
            toStage,
            reason: "qa fsm",
          });
          expect(res.status, `Offer->${toStage}: ${JSON.stringify(res.body)}`).toBe(409);
          expect(res.body.error.code).toBe("RECRUIT-ERR-001");
        }
        const toHired = await post(`/candidates/${cid}/move-stage`).send({
          toStage: "Hired",
          reason: "keo tay sang Hired",
        });
        expect(toHired.status, JSON.stringify(toHired.body)).toBe(409);
        expect(toHired.body.error.code).toBe("RECRUIT-ERR-014");

        const back = await post(`/candidates/${cid}/move-stage`).send({
          toStage: "Interview",
          reason: "lui ve Interview",
        });
        expect(back.status, JSON.stringify(back.body)).toBe(201);
        expect(back.body.data.stage).toBe("Interview");
      });

      it("Rejected: →Interview/→Offer/→Hired/→Rejected (self) ⇒ 409 001; →Screening (reopen) ⇒ 200 (cuối cùng)", async () => {
        const cid = await createCandidate(job, "Cand Rejected");
        await moveStage(cid, "Rejected");
        for (const toStage of ["Interview", "Offer", "Hired", "Rejected"]) {
          const res = await post(`/candidates/${cid}/move-stage`).send({
            toStage,
            reason: "qa fsm",
          });
          expect(res.status, `Rejected->${toStage}: ${JSON.stringify(res.body)}`).toBe(409);
          expect(res.body.error.code).toBe("RECRUIT-ERR-001");
        }
        const reopen = await post(`/candidates/${cid}/move-stage`).send({
          toStage: "Screening",
          reason: "reopen ho so",
        });
        expect(reopen.status, JSON.stringify(reopen.body)).toBe(201);
        expect(reopen.body.data.stage).toBe("Screening");
      });

      it("Hired (đạt qua convert): mọi move-stage tay ⇒ 409 001 (terminal)", async () => {
        const cid = await createCandidate(job, "Cand Hired");
        await moveStage(cid, "Screening");
        await moveStage(cid, "Interview");
        await moveStage(cid, "Offer");
        const offer = await post("/offers").send({
          candidateId: cid,
          startDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
          salary: "1000.00",
        });
        expect(offer.status, JSON.stringify(offer.body)).toBe(201);
        const offerId = offer.body.data.id;
        const sent = await post(`/offers/${offerId}/change-status`).send({ toStatus: "Sent" });
        expect(sent.status, JSON.stringify(sent.body)).toBe(201);
        const accepted = await post(`/offers/${offerId}/change-status`).send({
          toStatus: "Accepted",
        });
        expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
        const convert = await post(`/candidates/${cid}/convert`);
        expect(convert.status, JSON.stringify(convert.body)).toBe(201);
        expect(convert.body.data.stage).toBe("Hired");

        for (const toStage of ["New", "Rejected"]) {
          const res = await post(`/candidates/${cid}/move-stage`).send({
            toStage,
            reason: "qa fsm",
          });
          expect(res.status, `Hired->${toStage}: ${JSON.stringify(res.body)}`).toBe(409);
          expect(res.body.error.code).toBe("RECRUIT-ERR-001");
        }
      });
    });

    // ── Job-opening FSM §13.2 ──────────────────────────────────────────────────────────────────────
    describe("Job-opening FSM §13.2 — Draft→Open OK; Closed→Open/Open→Draft ⇒ 409 002", () => {
      it("Draft→Open OK; Draft→Paused (không cạnh) ⇒ 409 002 (dùng job KHÁC, không mutate ca trước)", async () => {
        const jobA = await createJob("Job Draft->Open");
        const openRes = await post(`/job-openings/${jobA}/change-status`).send({
          toStatus: "Open",
        });
        expect(openRes.status, JSON.stringify(openRes.body)).toBe(201);
        expect(openRes.body.data.status).toBe("Open");

        const jobB = await createJob("Job Draft->Paused invalid");
        const badRes = await post(`/job-openings/${jobB}/change-status`).send({
          toStatus: "Paused",
        });
        expect(badRes.status, JSON.stringify(badRes.body)).toBe(409);
        expect(badRes.body.error.code).toBe("RECRUIT-ERR-002");
      });

      it("Open→Draft ⇒ 409 002", async () => {
        const job = await createJob("Job Open->Draft invalid");
        await post(`/job-openings/${job}/change-status`).send({ toStatus: "Open" });
        const res = await post(`/job-openings/${job}/change-status`).send({ toStatus: "Draft" });
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body.error.code).toBe("RECRUIT-ERR-002");
      });

      it("Closed→Open ⇒ 409 002 (terminal)", async () => {
        const job = await createJob("Job Closed terminal");
        const close = await post(`/job-openings/${job}/change-status`).send({ toStatus: "Closed" });
        expect(close.status, JSON.stringify(close.body)).toBe(201);
        const reopen = await post(`/job-openings/${job}/change-status`).send({ toStatus: "Open" });
        expect(reopen.status, JSON.stringify(reopen.body)).toBe(409);
        expect(reopen.body.error.code).toBe("RECRUIT-ERR-002");
      });
    });

    // ── Job Closed chặn tạo/chuyển candidate — KHÔNG chặn move-stage ──────────────────────────────
    describe("Job Closed — chặn create/update candidate (409 005), KHÔNG chặn move-stage", () => {
      it("POST /candidates với jobOpeningId Closed ⇒ 409 005", async () => {
        const job = await createJob("Job Closed for create");
        await post(`/job-openings/${job}/change-status`).send({ toStatus: "Closed" });
        const res = await post("/candidates").send({
          jobOpeningId: job,
          fullName: "Blocked candidate",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body.error.code).toBe("RECRUIT-ERR-005");
      });

      it("PATCH /candidates/:id đổi jobOpeningId sang job Closed ⇒ 409 005", async () => {
        const openJob = await createJob("Job Open for patch-source");
        const closedJob = await createJob("Job Closed for patch-target");
        await post(`/job-openings/${closedJob}/change-status`).send({ toStatus: "Closed" });
        const cid = await createCandidate(openJob, "Cand Patch Job Closed");
        const res = await patch(`/candidates/${cid}`).send({ jobOpeningId: closedJob });
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body.error.code).toBe("RECRUIT-ERR-005");
      });

      it("move-stage KHÔNG bị chặn bởi job Closed (ca đối chứng 200)", async () => {
        const job = await createJob("Job Open then Closed after candidate");
        const cid = await createCandidate(job, "Cand Job Closed Later");
        await post(`/job-openings/${job}/change-status`).send({ toStatus: "Closed" });
        const res = await post(`/candidates/${cid}/move-stage`).send({
          toStage: "Screening",
          reason: "job dong nhung van chuyen duoc",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data.stage).toBe("Screening");
      });
    });

    // ── Offer FSM §13.3 ────────────────────────────────────────────────────────────────────────────
    describe("Offer FSM §13.3 — Draft→Accepted ⇒ 409 003; Sent→Accepted OK; Accepted terminal; PATCH khi Sent ⇒ 409 003", () => {
      it("Draft→Accepted ⇒ 409 003; Draft→Sent OK; Sent→Accepted OK (respondedAt set); Accepted→Withdrawn ⇒ 409 003", async () => {
        const job = await createJob("Job Offer FSM");
        const cid = await createCandidate(job, "Cand Offer FSM");
        await moveStage(cid, "Screening");
        await moveStage(cid, "Interview");
        await moveStage(cid, "Offer");
        const offer = await post("/offers").send({
          candidateId: cid,
          startDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
          salary: "1200.00",
        });
        expect(offer.status, JSON.stringify(offer.body)).toBe(201);
        const offerId = offer.body.data.id;

        const badAccept = await post(`/offers/${offerId}/change-status`).send({
          toStatus: "Accepted",
        });
        expect(badAccept.status, JSON.stringify(badAccept.body)).toBe(409);
        expect(badAccept.body.error.code).toBe("RECRUIT-ERR-003");

        const sent = await post(`/offers/${offerId}/change-status`).send({ toStatus: "Sent" });
        expect(sent.status, JSON.stringify(sent.body)).toBe(201);

        const accepted = await post(`/offers/${offerId}/change-status`).send({
          toStatus: "Accepted",
        });
        expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
        expect(accepted.body.data.respondedAt).not.toBeNull();

        const withdraw = await post(`/offers/${offerId}/change-status`).send({
          toStatus: "Withdrawn",
        });
        expect(withdraw.status, JSON.stringify(withdraw.body)).toBe(409);
        expect(withdraw.body.error.code).toBe("RECRUIT-ERR-003");
      });

      it("PATCH offer khi Sent ⇒ 409 003 kind not-draft", async () => {
        const job = await createJob("Job Offer PATCH Sent");
        const cid = await createCandidate(job, "Cand Offer PATCH Sent");
        await moveStage(cid, "Screening");
        await moveStage(cid, "Interview");
        await moveStage(cid, "Offer");
        const offer = await post("/offers").send({
          candidateId: cid,
          startDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
          salary: "900.00",
        });
        const offerId = offer.body.data.id;
        await post(`/offers/${offerId}/change-status`).send({ toStatus: "Sent" });
        const res = await patch(`/offers/${offerId}`).send({ salary: "950.00" });
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body.error.code).toBe("RECRUIT-ERR-003");
        expect(res.body.error.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: "kind", message: "not-draft" }),
          ]),
        );
      });
    });

    // ── Interview FSM §13.4 ────────────────────────────────────────────────────────────────────────
    describe("Interview FSM §13.4 — Scheduled→Completed OK; Completed→Cancelled ⇒ 409 004; PATCH khi Completed ⇒ 409 004", () => {
      it("Scheduled→Completed OK; sau đó →Cancelled ⇒ 409 004; PATCH khi Completed ⇒ 409 004", async () => {
        const job = await createJob("Job Interview FSM");
        const cid = await createCandidate(job, "Cand Interview FSM");
        await moveStage(cid, "Screening");
        await moveStage(cid, "Interview");
        const empRes = await direct.query(
          `INSERT INTO employee_profiles (company_id, user_id, status, work_type, employee_code)
         VALUES ($1, NULL, 'active', 'offline', 'EMP-IVFSM1') RETURNING id`,
          [A.companyId],
        );
        const employeeId = empRes.rows[0].id as string;
        const iv = await post("/interviews").send({
          candidateId: cid,
          startsAt: new Date(Date.now() + 3600_000).toISOString(),
          endsAt: new Date(Date.now() + 7200_000).toISOString(),
          participantEmployeeIds: [employeeId],
        });
        expect(iv.status, JSON.stringify(iv.body)).toBe(201);
        const ivId = iv.body.data.id;

        const complete = await post(`/interviews/${ivId}/change-status`).send({
          toStatus: "Completed",
        });
        expect(complete.status, JSON.stringify(complete.body)).toBe(201);

        const cancel = await post(`/interviews/${ivId}/change-status`).send({
          toStatus: "Cancelled",
        });
        expect(cancel.status, JSON.stringify(cancel.body)).toBe(409);
        expect(cancel.body.error.code).toBe("RECRUIT-ERR-004");

        const patchRes = await patch(`/interviews/${ivId}`).send({ location: "Phong hop QA" });
        expect(patchRes.status, JSON.stringify(patchRes.body)).toBe(409);
        expect(patchRes.body.error.code).toBe("RECRUIT-ERR-004");
      });
    });

    // ── Zod `.strict()` — trần Zod PHẢI ĐÚNG BẰNG trần service (không mã lỗi CHẾT) ────────────────
    describe("Zod .strict() — field lạ ⇒ 400 tại biên, KHÔNG rơi vào nhánh service", () => {
      it("PATCH /candidates/:id với `stage` (field lạ) ⇒ 400", async () => {
        const job = await createJob("Job Zod strict candidate");
        const cid = await createCandidate(job, "Cand Zod Strict");
        const res = await patch(`/candidates/${cid}`).send({ stage: "Hired" });
        expect(res.status, JSON.stringify(res.body)).toBe(400);
      });

      it("PATCH /job-openings/:id với `status` (field lạ) ⇒ 400", async () => {
        const job = await createJob("Job Zod strict job-opening");
        const res = await patch(`/job-openings/${job}`).send({ status: "Open" });
        expect(res.status, JSON.stringify(res.body)).toBe(400);
      });

      it("GET /candidates/export?page=1 ⇒ 400 (export không phân trang)", async () => {
        const res = await get("/candidates/export?page=1");
        expect(res.status, JSON.stringify(res.body)).toBe(400);
      });
    });
  },
);
