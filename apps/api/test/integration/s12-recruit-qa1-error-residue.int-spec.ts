/**
 * S12-RECRUIT-QA-1 — mã lỗi / `kind` RECRUIT CÒN SÓT sau `S12-RECRUIT-BE-1` (SPEC-12 §12, khuôn
 * `s11-room-qa1-error-residue.int-spec.ts`) + neo cho `recruit-error-code-census.unit-spec.ts`
 * (`test/foundation/`, đo 31/08/2026: 15/43 ca census ĐỎ — mã/`kind` được ném ở src nhưng KHÔNG spec
 * RECRUIT nào assert).
 *
 * SÁU LỖ ĐO ĐƯỢC (mỗi mục A–F dưới là MỘT lỗ, DENY luôn kèm ALLOW đối chứng — `deny-cases-vacuous-
 * without-allow-case`), CỘNG mục G neo 11 `kind` còn lại mà census đòi:
 *
 *   A. **RECRUIT-ERR-010 sentinel chưa có ca RIÊNG cho GET đơn lẻ**. `recruit-be1-scope` mục
 *      "Cross-tenant" đã đo 4 route trả 404 nhưng KHÔNG so sánh SHAPE giữa các nguồn — điều SPEC-12 §12
 *      thực sự hứa: *"không thuộc company hoặc không tồn tại (kể cả đã xoá mềm) — CÙNG một phản hồi"*.
 *      job-opening/candidate có `deleted_at` ⇒ đo ĐỦ 3 nguồn (bịa · chéo tenant · xoá mềm). **PHÁT
 *      HIỆN**: bảng `interviews`/`offers` KHÔNG có cột `deleted_at` (schema `recruit.ts`) — hai đối
 *      tượng này KHÔNG có khái niệm "xoá mềm" (FSM có trạng thái terminal Cancelled/Withdrawn thay thế),
 *      nên chỉ đo được 2 nguồn (bịa · chéo tenant), không phải 3 như job-opening/candidate.
 *   B. **`position-invalid` (422 RECRUIT-ERR-009, `job-openings.service.ts:245-250`)** — ném khi PATCH
 *      job-opening gán `positionId` đã xoá mềm — chưa ca nào chạm.
 *   C. **`recruiter-invalid` (404 RECRUIT-ERR-009, `job-openings.service.ts:258-263`)** — cố ý 404
 *      KHÔNG 422 (chống oracle phân biệt "sai tầm nhìn" và "sai định dạng") — chưa ca nào chạm.
 *   D. **`interview-cancelled` (409 RECRUIT-ERR-004, `interviews.service.ts:283-287` & `:318-322`)** —
 *      ghi/sửa feedback trên lượt đã Cancelled — chưa ca nào chạm ở CẢ hai route (POST và PATCH).
 *   E. **Sentinel own-note** (`candidates.service.ts` `updateOwnNoteTx` qua route
 *      `PATCH /candidates/:id/notes/:noteId`) — sửa ghi chú của NGƯỜI KHÁC (kể cả CÙNG company, CÙNG
 *      quyền Company-scope) phải cho ra 404 GIỐNG HỆT sentinel mục A — chưa ai đo bằng-nhau.
 *   F. **`check-duplicate` (008)** — BE-1 mới đo "không lộ email/phone"; ngữ nghĩa khớp KHÔNG phân biệt
 *      hoa/thường (email) và chuẩn hoá định dạng (phone) chưa ca nào đo.
 *   G. **Neo `kind` cho census** — 11 `kind` ném được ở src nhưng KHÔNG spec RECRUIT nào assert literal
 *      (đo bằng `recruit-error-code-census.unit-spec.ts`): mỗi ca dưới là ca HTTP tối thiểu, DENY đã có
 *      cặp ALLOW ở BE-1/mục D trên KHÔNG cần lặp lại — mục đích DUY NHẤT là neo chuỗi `kind`.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5) — DB cô lập theo lane.
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
const LOGIN_PW = loginPasswordFixture("s12recruitqa1");
/** Role hệ thống `recruiter` (mig 0560, id cố định) — 16 cặp §9f: view/manage@Company, feedback@Own. */
const RECRUITER_ROLE_ID = "00000000-0000-0000-0000-000000000014";

type CandidateStage = "New" | "Screening" | "Interview" | "Offer" | "Hired" | "Rejected";
type ErrDetail = { field: string; message: string; rule?: string };
type Shape = {
  status: number;
  code: string | undefined;
  message: string | undefined;
  details: ErrDetail[] | null;
};

const kindOf = (r: request.Response): string | undefined =>
  (r.body?.error?.details as ErrDetail[] | undefined)?.find((d) => d.field === "kind")?.message;

/** Chỉ giữ phần HỢP ĐỒNG của lỗi — bỏ qua field đổi mỗi request (không phải oracle). */
const shapeOf = (r: request.Response): Shape => ({
  status: r.status,
  code: r.body?.error?.code,
  message: r.body?.error?.message,
  details: r.body?.error?.details ?? null,
});

describe.skipIf(!hasLaneDb)(
  "S12-RECRUIT-QA-1 mã lỗi & kind còn sót (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let actorUserId = "";
    let actor2UserId = "";
    let tActor = "";
    let tActor2 = "";
    let tB = "";
    let actorEmployeeId = "";
    let bEmployeeId = "";
    let orgUnitId = "";
    let orgUnitIdB = "";
    let jobOpeningId = "";
    let jobOpeningIdB = "";
    let candidateIdB = "";
    let interviewIdB = "";
    let offerIdB = "";

    const http = () => request(app.getHttpServer());
    const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
    const get = (t: string, u: string) => auth(t)(http().get(u));
    const post = (t: string, u: string) => auth(t)(http().post(u));
    const patch = (t: string, u: string) => auth(t)(http().patch(u));

    async function login(companySlug: string, email: string): Promise<string> {
      const res = await http().post("/auth/login").send({ companySlug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    async function newEmployee(companyId: string, userId: string): Promise<string> {
      const r = await direct.query(
        "INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,'active') RETURNING id",
        [companyId, userId],
      );
      return r.rows[0].id as string;
    }

    /** Candidate MỚI, đi FSM New→…→`target` bằng `move-stage` THẬT (không seed thẳng DB). */
    async function candidateAt(
      token: string,
      jobId: string,
      target: CandidateStage,
      seedLabel: string,
    ): Promise<string> {
      const c = await post(token, "/candidates").send({
        jobOpeningId: jobId,
        fullName: `Ung vien QA ${seedLabel}`,
        email: `cand-${randomUUID().slice(0, 8)}@x.test`,
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      const id = c.body.data.id as string;
      if (target === "New") return id;
      const order: CandidateStage[] = ["Screening", "Interview", "Offer"];
      for (const stage of order) {
        const r = await post(token, `/candidates/${id}/move-stage`).send({
          toStage: stage,
          reason: "qa fixture residue",
        });
        expect(r.status, `move → ${stage}: ${JSON.stringify(r.body)}`).toBe(201);
        if (stage === target) break;
      }
      return id;
    }

    let slotCounter = 0;
    function nextSlot(durMin = 45): { startsAt: string; endsAt: string } {
      const start = new Date(Date.now() + (600 + slotCounter * 90) * 60_000);
      slotCounter += 1;
      return {
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + durMin * 60_000).toISOString(),
      };
    }

    async function newInterview(
      token: string,
      candidateId: string,
      participantEmployeeIds: string[],
    ): Promise<string> {
      const r = await post(token, "/interviews").send({
        candidateId,
        ...nextSlot(),
        participantEmployeeIds,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.data.id as string;
    }

    const futureDateStr = (): string =>
      new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

    async function newOffer(
      token: string,
      candidateId: string,
      salary: string,
      idemKey: string,
    ): Promise<request.Response> {
      return post(token, "/offers")
        .set(IDEMPOTENCY_HEADER, idemKey)
        .send({ candidateId, startDate: futureDateStr(), salary });
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "s12rqa1a");
      B = await seedCompany(direct, "s12rqa1b");
      companyIds.push(A.companyId, B.companyId);

      actorUserId = await seedUser(direct, A.companyId, `actor@${A.slug}.test`, hash);
      await seedUserRole(direct, actorUserId, RECRUITER_ROLE_ID, A.companyId);
      actor2UserId = await seedUser(direct, A.companyId, `actor2@${A.slug}.test`, hash);
      await seedUserRole(direct, actor2UserId, RECRUITER_ROLE_ID, A.companyId);
      const bUserId = await seedUser(direct, B.companyId, `full@${B.slug}.test`, hash);
      await seedUserRole(direct, bUserId, RECRUITER_ROLE_ID, B.companyId);

      tActor = await login(A.slug, `actor@${A.slug}.test`);
      tActor2 = await login(A.slug, `actor2@${A.slug}.test`);
      tB = await login(B.slug, `full@${B.slug}.test`);

      // Actor CŨNG là interviewer/participant — cần hồ sơ nhân viên để own-scope feedback resolve được.
      actorEmployeeId = await newEmployee(A.companyId, actorUserId);
      bEmployeeId = await newEmployee(B.companyId, bUserId);

      const org = await direct.query(
        "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
        [A.companyId, `s12rqa1-org-${A.slug}`],
      );
      orgUnitId = org.rows[0].id as string;
      const orgB = await direct.query(
        "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
        [B.companyId, `s12rqa1-org-${B.slug}`],
      );
      orgUnitIdB = orgB.rows[0].id as string;

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

      const jobB = await post(tB, "/job-openings").send({
        title: "B Job QA",
        orgUnitId: orgUnitIdB,
      });
      expect(jobB.status, JSON.stringify(jobB.body)).toBe(201);
      jobOpeningIdB = jobB.body.data.id as string;
      const openedB = await post(tB, `/job-openings/${jobOpeningIdB}/change-status`).send({
        toStatus: "Open",
      });
      expect(openedB.status, JSON.stringify(openedB.body)).toBe(201);

      // Candidate B ở New — dùng cho mục A (job-opening/candidate cross-tenant).
      candidateIdB = await candidateAt(tB, jobOpeningIdB, "New", "Bxtenant1");

      // Candidate B thứ hai — đi tới Interview rồi Offer, dùng cho mục A (interview/offer cross-tenant).
      const candB2 = await candidateAt(tB, jobOpeningIdB, "Interview", "Bxtenant2");
      interviewIdB = await newInterview(tB, candB2, [bEmployeeId]);
      const mvOfferB = await post(tB, `/candidates/${candB2}/move-stage`).send({
        toStage: "Offer",
        reason: "qa fixture B offer",
      });
      expect(mvOfferB.status, JSON.stringify(mvOfferB.body)).toBe(201);
      const offerB = await newOffer(tB, candB2, "18000000", `b-offer-${candB2}`);
      expect(offerB.status, JSON.stringify(offerB.body)).toBe(201);
      offerIdB = offerB.body.data.id as string;
    }, 240_000);

    afterAll(async () => {
      if (direct) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ── A. RECRUIT-ERR-010 sentinel — 3 nguồn (job-opening/candidate) · 2 nguồn (interview/offer) ────

    describe("A. RECRUIT-ERR-010 sentinel: mọi nguồn 404 ⇒ MỘT phản hồi (chống dò chéo tenant)", () => {
      it("GET /job-openings/:id — bịa · chéo tenant · xoá mềm ⇒ BA phản hồi bằng nhau", async () => {
        const soft = await post(tActor, "/job-openings").send({
          title: "Job Xoá Mềm QA",
          orgUnitId,
        });
        expect(soft.status, JSON.stringify(soft.body)).toBe(201);
        const softId = soft.body.data.id as string;
        // ALLOW: sống TRƯỚC khi xoá — chứng minh id thật, không phải chuỗi bất kỳ.
        expect((await get(tActor, `/job-openings/${softId}`)).status).toBe(200);
        await direct.query("UPDATE job_openings SET deleted_at = now() WHERE id = $1", [softId]);

        const ghost = shapeOf(await get(tActor, `/job-openings/${randomUUID()}`));
        const cross = shapeOf(await get(tActor, `/job-openings/${jobOpeningIdB}`));
        const deleted = shapeOf(await get(tActor, `/job-openings/${softId}`));
        expect(ghost.status).toBe(404);
        expect(ghost.code).toBe("RECRUIT-ERR-010");
        expect((ghost.details as ErrDetail[]).find((d) => d.field === "kind")?.message).toBe(
          "not-found",
        );
        expect(cross, "404 chéo tenant KHÁC 404 id-bịa ⇒ rò sự tồn tại").toEqual(ghost);
        expect(deleted, "404 job xoá mềm KHÁC 404 id-bịa ⇒ rò sự tồn tại").toEqual(ghost);

        // ALLOW đối chứng: chính B đọc job của mình ⇒ 200 (chứng minh `jobOpeningIdB` là id THẬT).
        expect((await get(tB, `/job-openings/${jobOpeningIdB}`)).status).toBe(200);
      });

      it("GET /candidates/:id — bịa · chéo tenant · xoá mềm ⇒ BA phản hồi bằng nhau", async () => {
        const softCid = await candidateAt(tActor, jobOpeningId, "New", "SoftDelete");
        expect((await get(tActor, `/candidates/${softCid}`)).status).toBe(200);
        await direct.query("UPDATE candidates SET deleted_at = now() WHERE id = $1", [softCid]);

        const ghost = shapeOf(await get(tActor, `/candidates/${randomUUID()}`));
        const cross = shapeOf(await get(tActor, `/candidates/${candidateIdB}`));
        const deleted = shapeOf(await get(tActor, `/candidates/${softCid}`));
        expect(ghost.status).toBe(404);
        expect(ghost.code).toBe("RECRUIT-ERR-010");
        expect(cross, "404 chéo tenant KHÁC 404 id-bịa ⇒ rò sự tồn tại").toEqual(ghost);
        expect(deleted, "404 candidate xoá mềm KHÁC 404 id-bịa ⇒ rò sự tồn tại").toEqual(ghost);

        expect((await get(tB, `/candidates/${candidateIdB}`)).status).toBe(200);
      });

      it("GET /interviews/:id — bịa · chéo tenant ⇒ hai phản hồi bằng nhau (KHÔNG có nguồn xoá mềm — bảng `interviews` không có `deleted_at`, PHÁT HIỆN)", async () => {
        const ghost = shapeOf(await get(tActor, `/interviews/${randomUUID()}`));
        const cross = shapeOf(await get(tActor, `/interviews/${interviewIdB}`));
        expect(ghost.status).toBe(404);
        expect(ghost.code).toBe("RECRUIT-ERR-010");
        expect(cross, "404 chéo tenant KHÁC 404 id-bịa ⇒ rò sự tồn tại").toEqual(ghost);
        expect((await get(tB, `/interviews/${interviewIdB}`)).status).toBe(200);
      });

      it("GET /offers/:id — bịa · chéo tenant ⇒ hai phản hồi bằng nhau (KHÔNG có nguồn xoá mềm — bảng `offers` không có `deleted_at`, PHÁT HIỆN)", async () => {
        const ghost = shapeOf(await get(tActor, `/offers/${randomUUID()}`));
        const cross = shapeOf(await get(tActor, `/offers/${offerIdB}`));
        expect(ghost.status).toBe(404);
        expect(ghost.code).toBe("RECRUIT-ERR-010");
        expect(cross, "404 chéo tenant KHÁC 404 id-bịa ⇒ rò sự tồn tại").toEqual(ghost);
        expect((await get(tB, `/offers/${offerIdB}`)).status).toBe(200);
      });
    });

    // ── B. RECRUIT-ERR-009 kind `position-invalid` (422) ──────────────────────────────────────────

    describe("B. RECRUIT-ERR-009 kind position-invalid (422) — PATCH job-opening gán position xoá mềm", () => {
      it("positionId sống ⇒ 200; sau khi xoá mềm position ⇒ 422 position-invalid", async () => {
        const pos = await direct.query(
          "INSERT INTO positions (company_id, name, status) VALUES ($1,$2,'active') RETURNING id",
          [A.companyId, "Backend Dev QA"],
        );
        const posId = pos.rows[0].id as string;
        const job = await post(tActor, "/job-openings").send({
          title: "Job Position QA",
          orgUnitId,
        });
        const jobId = job.body.data.id as string;

        const ok = await patch(tActor, `/job-openings/${jobId}`).send({ positionId: posId });
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
        expect(ok.body.data.positionId).toBe(posId);

        await direct.query("UPDATE positions SET deleted_at = now() WHERE id = $1", [posId]);

        const bad = await patch(tActor, `/job-openings/${jobId}`).send({ positionId: posId });
        expect(bad.status, JSON.stringify(bad.body)).toBe(422);
        expect(bad.body?.error?.code).toBe("RECRUIT-ERR-009");
        expect(kindOf(bad)).toBe("position-invalid");
      });
    });

    // ── C. RECRUIT-ERR-009 kind `recruiter-invalid` (404, anti-oracle) ────────────────────────────

    describe("C. RECRUIT-ERR-009 kind recruiter-invalid (404 — cố ý KHÔNG 422, chống oracle)", () => {
      it("recruiterUserId bịa ⇒ 404 recruiter-invalid; recruiterUserId hợp lệ ⇒ 200", async () => {
        const job = await post(tActor, "/job-openings").send({
          title: "Job Recruiter QA",
          orgUnitId,
        });
        const jobId = job.body.data.id as string;

        const bad = await patch(tActor, `/job-openings/${jobId}`).send({
          recruiterUserId: randomUUID(),
        });
        expect(bad.status, JSON.stringify(bad.body)).toBe(404);
        expect(bad.body?.error?.code).toBe("RECRUIT-ERR-009");
        expect(kindOf(bad)).toBe("recruiter-invalid");

        const ok = await patch(tActor, `/job-openings/${jobId}`).send({
          recruiterUserId: actor2UserId,
        });
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
        expect(ok.body.data.recruiterUserId).toBe(actor2UserId);
      });
    });

    // ── D. RECRUIT-ERR-004 kind `interview-cancelled` (409) ────────────────────────────────────────

    describe("D. RECRUIT-ERR-004 kind interview-cancelled — feedback trên lượt đã Cancelled", () => {
      it("POST feedback trên Cancelled ⇒ 409; PATCH feedback trên Cancelled ⇒ 409; ALLOW: feedback trên Completed ⇒ 201", async () => {
        const cid1 = await candidateAt(tActor, jobOpeningId, "Interview", "D1");
        const iv1 = await newInterview(tActor, cid1, [actorEmployeeId]);
        const cancel = await post(tActor, `/interviews/${iv1}/change-status`).send({
          toStatus: "Cancelled",
        });
        expect(cancel.status, JSON.stringify(cancel.body)).toBe(201);

        const fbPost = await post(tActor, `/interviews/${iv1}/feedback`).send({
          rating: 4,
          recommendation: "Hire",
        });
        expect(fbPost.status, JSON.stringify(fbPost.body)).toBe(409);
        expect(fbPost.body?.error?.code).toBe("RECRUIT-ERR-004");
        expect(kindOf(fbPost)).toBe("interview-cancelled");

        const fbPatch = await patch(tActor, `/interviews/${iv1}/feedback`).send({ rating: 3 });
        expect(fbPatch.status, JSON.stringify(fbPatch.body)).toBe(409);
        expect(fbPatch.body?.error?.code).toBe("RECRUIT-ERR-004");
        expect(kindOf(fbPatch)).toBe("interview-cancelled");

        // ALLOW đối chứng: lượt Completed (KHÔNG Cancelled) vẫn ghi được feedback.
        const cid2 = await candidateAt(tActor, jobOpeningId, "Interview", "D2");
        const iv2 = await newInterview(tActor, cid2, [actorEmployeeId]);
        const complete = await post(tActor, `/interviews/${iv2}/change-status`).send({
          toStatus: "Completed",
        });
        expect(complete.status, JSON.stringify(complete.body)).toBe(201);
        const fbOk = await post(tActor, `/interviews/${iv2}/feedback`).send({
          rating: 5,
          recommendation: "Hire",
        });
        expect(fbOk.status, JSON.stringify(fbOk.body)).toBe(201);
      });
    });

    // ── E. Sentinel own-note — GIỐNG HỆT shape mục A ───────────────────────────────────────────────

    describe("E. RECRUIT-ERR-010 sentinel own-note — sửa ghi chú của NGƯỜI KHÁC (cùng company, cùng quyền Company-scope)", () => {
      it("actor2 PATCH note của actor1 ⇒ 404 GIỐNG HỆT sentinel mục A; actor1 PATCH note của mình ⇒ 200", async () => {
        const cid = await candidateAt(tActor, jobOpeningId, "New", "E");
        const note = await post(tActor, `/candidates/${cid}/notes`).send({
          body: "ghi chu cua actor1",
        });
        expect(note.status, JSON.stringify(note.body)).toBe(201);
        const noteId = note.body.data.id as string;

        const denied = await patch(tActor2, `/candidates/${cid}/notes/${noteId}`).send({
          body: "actor2 co sua duoc khong",
        });
        expect(denied.status, JSON.stringify(denied.body)).toBe(404);
        const ghost = await get(tActor, `/candidates/${randomUUID()}`);
        // So khớp NGUYÊN shape với sentinel mục A — cùng thông điệp, cùng code, cùng `kind`.
        expect(
          shapeOf(denied),
          "404 sửa note NGƯỜI KHÁC phải GIỐNG HỆT sentinel not-found",
        ).toEqual(shapeOf(ghost));

        const allow = await patch(tActor, `/candidates/${cid}/notes/${noteId}`).send({
          body: "actor1 sua duoc note cua minh",
        });
        expect(allow.status, JSON.stringify(allow.body)).toBe(200);
        expect(allow.body.data.body).toBe("actor1 sua duoc note cua minh");
      });
    });

    // ── F. check-duplicate — ngữ nghĩa khớp + KHÔNG echo PII ───────────────────────────────────────

    describe("F. GET /candidates/check-duplicate — không phân biệt hoa/thường (email) + chuẩn hoá (phone) + không echo PII", () => {
      it("email biến thể hoa/thường ⇒ khớp; phone biến thể định dạng ⇒ khớp; response KHÔNG email/phone", async () => {
        const emailTag = randomUUID().slice(0, 8);
        const email = `Mixed.Case.${emailTag}@X.Test`;
        const phone = "0912345678";
        const created = await post(tActor, "/candidates").send({
          jobOpeningId,
          fullName: "Ung vien Trung QA",
          email,
          phone,
        });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        const cid = created.body.data.id as string;

        const byLower = await get(
          tActor,
          `/candidates/check-duplicate?email=${encodeURIComponent(email.toLowerCase())}`,
        );
        expect(byLower.status, JSON.stringify(byLower.body)).toBe(200);
        expect(byLower.body.data.some((r: { id: string }) => r.id === cid)).toBe(true);

        const byUpper = await get(
          tActor,
          `/candidates/check-duplicate?email=${encodeURIComponent(email.toUpperCase())}`,
        );
        expect(byUpper.body.data.some((r: { id: string }) => r.id === cid)).toBe(true);

        // Biến thể định dạng — regexp_replace bỏ mọi ký tự KHÔNG phải số/`+` cả hai vế.
        const byPhoneVariant = await get(
          tActor,
          `/candidates/check-duplicate?phone=${encodeURIComponent("091 234 5678")}`,
        );
        expect(byPhoneVariant.status, JSON.stringify(byPhoneVariant.body)).toBe(200);
        expect(byPhoneVariant.body.data.some((r: { id: string }) => r.id === cid)).toBe(true);

        for (const res of [byLower, byUpper, byPhoneVariant]) {
          for (const row of res.body.data as Record<string, unknown>[]) {
            expect(row).not.toHaveProperty("email");
            expect(row).not.toHaveProperty("phone");
          }
        }
      });
    });

    // ── G. Neo `kind` cho census — 11 kind ném được ở src, chưa spec RECRUIT nào assert literal ──────
    //
    // Mỗi ca dưới là ca HTTP TỐI THIỂU — mục đích DUY NHẤT là neo chuỗi `kind` cho
    // `recruit-error-code-census.unit-spec.ts`. Cặp DENY/ALLOW đầy đủ của các FSM này đã sống ở
    // `recruit-be1-fsm.int-spec.ts` (assert theo MÃ) — ở đây KHÔNG lặp lại, chỉ thêm assert `kind`.

    describe("G. neo kind cho census (11 kind còn thiếu literal anchor)", () => {
      it("invalid-stage-transition (409 001) — move-stage New→Offer (bỏ qua Screening/Interview)", async () => {
        const cid = await candidateAt(tActor, jobOpeningId, "New", "G1");
        const res = await post(tActor, `/candidates/${cid}/move-stage`).send({
          toStage: "Offer",
          reason: "qa bo qua giai doan",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body?.error?.code).toBe("RECRUIT-ERR-001");
        expect(kindOf(res)).toBe("invalid-stage-transition");
      });

      it("hired-via-convert-only (409 014) — move-stage Offer→Hired (phải qua /convert)", async () => {
        const cid = await candidateAt(tActor, jobOpeningId, "Offer", "G2");
        const res = await post(tActor, `/candidates/${cid}/move-stage`).send({
          toStage: "Hired",
          reason: "qa keo tay",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body?.error?.code).toBe("RECRUIT-ERR-014");
        expect(kindOf(res)).toBe("hired-via-convert-only");
      });

      it("invalid-job-opening-transition (409 002) — change-status Closed→Open", async () => {
        const job = await post(tActor, "/job-openings").send({ title: "Job G3", orgUnitId });
        const jobId = job.body.data.id as string;
        const closed = await post(tActor, `/job-openings/${jobId}/change-status`).send({
          toStatus: "Closed",
        });
        expect(closed.status, JSON.stringify(closed.body)).toBe(201);
        const res = await post(tActor, `/job-openings/${jobId}/change-status`).send({
          toStatus: "Open",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body?.error?.code).toBe("RECRUIT-ERR-002");
        expect(kindOf(res)).toBe("invalid-job-opening-transition");
      });

      it("invalid-offer-transition (409 003) — change-status Draft→Accepted (bỏ qua Sent)", async () => {
        const cid = await candidateAt(tActor, jobOpeningId, "Offer", "G4");
        const offer = await newOffer(tActor, cid, "12000000", `g4-${cid}`);
        expect(offer.status, JSON.stringify(offer.body)).toBe(201);
        const offerId = offer.body.data.id as string;
        const res = await post(tActor, `/offers/${offerId}/change-status`).send({
          toStatus: "Accepted",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body?.error?.code).toBe("RECRUIT-ERR-003");
        expect(kindOf(res)).toBe("invalid-offer-transition");
      });

      it("invalid-interview-transition (409 004) — change-status Completed→Cancelled (terminal)", async () => {
        const cid = await candidateAt(tActor, jobOpeningId, "Interview", "G5");
        const iv = await newInterview(tActor, cid, [actorEmployeeId]);
        const complete = await post(tActor, `/interviews/${iv}/change-status`).send({
          toStatus: "Completed",
        });
        expect(complete.status, JSON.stringify(complete.body)).toBe(201);
        const res = await post(tActor, `/interviews/${iv}/change-status`).send({
          toStatus: "Cancelled",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body?.error?.code).toBe("RECRUIT-ERR-004");
        expect(kindOf(res)).toBe("invalid-interview-transition");
      });

      it("job-closed (409 005) — POST /candidates vào job đã Closed", async () => {
        const job = await post(tActor, "/job-openings").send({ title: "Job G6", orgUnitId });
        const jobId = job.body.data.id as string;
        const closed = await post(tActor, `/job-openings/${jobId}/change-status`).send({
          toStatus: "Closed",
        });
        expect(closed.status, JSON.stringify(closed.body)).toBe(201);
        const res = await post(tActor, "/candidates").send({
          jobOpeningId: jobId,
          fullName: "Cand G6",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body?.error?.code).toBe("RECRUIT-ERR-005");
        expect(kindOf(res)).toBe("job-closed");
      });

      it("offer-open-exists (409 006) — offer thứ hai khi offer đầu còn Draft", async () => {
        const cid = await candidateAt(tActor, jobOpeningId, "Offer", "G7");
        const first = await newOffer(tActor, cid, "9000000", `g7a-${cid}`);
        expect(first.status, JSON.stringify(first.body)).toBe(201);
        const second = await newOffer(tActor, cid, "9500000", `g7b-${cid}`);
        expect(second.status, JSON.stringify(second.body)).toBe(409);
        expect(second.body?.error?.code).toBe("RECRUIT-ERR-006");
        expect(kindOf(second)).toBe("offer-open-exists");
      });

      it("feedback-duplicate (409 012) — feedback thứ hai của CÙNG interviewer", async () => {
        const cid = await candidateAt(tActor, jobOpeningId, "Interview", "G8");
        const iv = await newInterview(tActor, cid, [actorEmployeeId]);
        const first = await post(tActor, `/interviews/${iv}/feedback`).send({
          rating: 4,
          recommendation: "Hire",
        });
        expect(first.status, JSON.stringify(first.body)).toBe(201);
        const second = await post(tActor, `/interviews/${iv}/feedback`).send({
          rating: 3,
          recommendation: "Consider",
        });
        expect(second.status, JSON.stringify(second.body)).toBe(409);
        expect(second.body?.error?.code).toBe("RECRUIT-ERR-012");
        expect(kindOf(second)).toBe("feedback-duplicate");
      });

      it("not-scheduled (409 004) — PATCH /interviews/:id khi lượt đã Completed", async () => {
        const cid = await candidateAt(tActor, jobOpeningId, "Interview", "G9");
        const iv = await newInterview(tActor, cid, [actorEmployeeId]);
        const complete = await post(tActor, `/interviews/${iv}/change-status`).send({
          toStatus: "Completed",
        });
        expect(complete.status, JSON.stringify(complete.body)).toBe(201);
        const res = await patch(tActor, `/interviews/${iv}`).send({ location: "Phong QA G9" });
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body?.error?.code).toBe("RECRUIT-ERR-004");
        expect(kindOf(res)).toBe("not-scheduled");
      });

      it("not-participant (403 011) — người có view:interview@Company nhưng KHÔNG tham gia lượt", async () => {
        const cid = await candidateAt(tActor, jobOpeningId, "Interview", "G10");
        // actor2 (RECRUITER_ROLE_ID ⇒ view:interview@Company) KHÔNG nằm trong participants của iv.
        const iv = await newInterview(tActor, cid, [actorEmployeeId]);
        const res = await post(tActor2, `/interviews/${iv}/feedback`).send({
          rating: 4,
          recommendation: "Hire",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(res.body?.error?.code).toBe("RECRUIT-ERR-011");
        expect(kindOf(res)).toBe("not-participant");
      });

      it("export-too-large (422 015) — seed 2 candidate + trần override=1", async () => {
        const job = await post(tActor, "/job-openings").send({ title: "Job G11", orgUnitId });
        const jobId = job.body.data.id as string;
        for (let i = 0; i < 2; i += 1) {
          const r = await post(tActor, "/candidates").send({
            jobOpeningId: jobId,
            fullName: `Cand G11 ${i}`,
          });
          expect(r.status, JSON.stringify(r.body)).toBe(201);
        }
        process.env.RECRUIT_EXPORT_MAX_ROWS_OVERRIDE = "1";
        try {
          const res = await get(tActor, `/candidates/export?jobOpeningId=${jobId}`);
          expect(res.status, JSON.stringify(res.body)).toBe(422);
          expect(res.body?.error?.code).toBe("RECRUIT-ERR-015");
          expect(kindOf(res)).toBe("export-too-large");
        } finally {
          delete process.env.RECRUIT_EXPORT_MAX_ROWS_OVERRIDE;
        }
      });
    });
  },
);
