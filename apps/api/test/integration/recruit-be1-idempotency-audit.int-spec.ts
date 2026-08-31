/**
 * S12-RECRUIT-BE-1 — idempotency (4 route `@Idempotent()`) + audit (mọi mutation quan trọng) + export
 * (RECRUIT-ERR-015 ca THẬT) + append-only DB (SPEC-12 §12/§18, DB-14 §6 — plan `docs/plans/
 * S12-RECRUIT-BE-1.md` §9.1, GỘP 2 hàng cuối bảng: `recruit-be1-idempotency.int-spec.ts` +
 * `recruit-be1-audit.int-spec.ts`).
 *
 *   · Idempotency: 007 (`POST /candidates`) · 019 (`POST /interviews`) · 026 (`POST /offers`) · 029
 *     (`POST /candidates/:id/convert`) — CÙNG khoá 2 lần (TUẦN TỰ, không đồng thời) ⇒ 1 bản ghi + phát
 *     lại NGUYÊN VĂN + header `Idempotency-Replayed: true`; khác khoá (007) ⇒ 2 bản ghi.
 *     ⚠️ GHI CHÚ (plan §6.1/§9.1): ca này là REPLAY tuần tự — KHÔNG dùng để chứng minh race UNIQUE của
 *     convert (2 request SONG SONG, 2 khoá KHÁC NHAU) — đó là việc của `recruit-be1-convert.int-spec.ts`.
 *   · Audit: mỗi mutation quan trọng (job-opening create/update/change-status · candidate
 *     create/update/move-stage/comment(note create)/update-comment(note update) · interview
 *     create/change-status/feedback · offer create/change-status) ⇒ +1 hàng `audit_logs` đúng
 *     `object_type`; `before`/`after` KHÔNG chứa email/phone/salary thật của candidate/offer.
 *   · Export (010): seed >trần (hạ hằng qua `RECRUIT_EXPORT_MAX_ROWS_OVERRIDE`, đọc MỖI LẦN GỌI) ⇒
 *     422 `RECRUIT-ERR-015` THẬT; dưới trần ⇒ 200 + audit `export`/`candidate` (before=null,
 *     after={filter,rows}, KHÔNG dữ liệu); thiếu 1 trong 2 cặp (`export`+`view`) ⇒ 403.
 *   · Append-only DB: `mediaos_app` KHÔNG có UPDATE/DELETE trên `candidate_stage_events` +
 *     `interview_participants` (`has_table_privilege` — đúng theo GRANT mig 0559, đã chốt lại ở
 *     `s12-recruit-db1-invariants.int-spec.ts` mục A, KHÔNG lặp lại phép đo ACL đầy đủ ở đây).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */

import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
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
const LOGIN_PW = loginPasswordFixture("recruitbe1ia");
/** Role hệ thống `recruiter` (mig 0560, id cố định — 16 cặp §9f). */
const RECRUITER_ROLE_ID = "00000000-0000-0000-0000-000000000014";

describe.skipIf(!hasLaneDb)(
  "S12-RECRUIT-BE-1 idempotency (4 route) + audit + export + append-only DB",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    let actorUserId = "";
    let actorEmployeeId = "";
    let tActor = "";
    let orgUnitId = "";

    const http = () => request(app.getHttpServer());
    const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
    const get = (t: string, u: string) => auth(t)(http().get(u));
    const post = (t: string, u: string) => auth(t)(http().post(u));
    const patch = (t: string, u: string) => auth(t)(http().patch(u));

    const code = (res: request.Response) => res.body?.error?.code as string | undefined;

    async function login(companySlug: string, email: string): Promise<string> {
      const res = await http().post("/auth/login").send({ companySlug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    async function newEmployee(userId: string, status: "active" = "active"): Promise<string> {
      const r = await direct.query(
        "INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,$3) RETURNING id",
        [A.companyId, userId, status],
      );
      return r.rows[0].id as string;
    }

    async function newJob(): Promise<string> {
      const res = await post(tActor, "/job-openings").send({
        title: `IA QA ${randomUUID().slice(0, 6)}`,
        orgUnitId,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const opened = await post(tActor, `/job-openings/${res.body.data.id}/change-status`).send({
        toStatus: "Open",
      });
      expect(opened.status, JSON.stringify(opened.body)).toBe(201);
      return res.body.data.id as string;
    }

    async function moveStage(
      candidateId: string,
      toStage: string,
      reason = "chuyển giai đoạn IA QA",
    ): Promise<request.Response> {
      return post(tActor, `/candidates/${candidateId}/move-stage`).send({ toStage, reason });
    }

    const futureDateStr = (): string =>
      new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

    async function auditRows(
      objectType: string,
      objectId: string,
    ): Promise<Array<{ action: string; before: unknown; after: unknown }>> {
      const r = await direct.query(
        `SELECT action, before, after FROM audit_logs
          WHERE company_id = $1 AND object_type = $2 AND object_id = $3
          ORDER BY created_at`,
        [A.companyId, objectType, objectId],
      );
      return r.rows;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();

      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "recia");
      companyIds.push(A.companyId);

      actorUserId = await seedUser(direct, A.companyId, `actor@${A.slug}.test`, hash);
      await seedUserRole(direct, actorUserId, RECRUITER_ROLE_ID, A.companyId);
      tActor = await login(A.slug, `actor@${A.slug}.test`);
      actorEmployeeId = await newEmployee(actorUserId);

      const org = await direct.query(
        "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
        [A.companyId, `recia-org-${A.slug}`],
      );
      orgUnitId = org.rows[0].id as string;

      // Convert (029) cấp mã NV qua `HrWriteService.allocateEmployeeCode` — cần counter cấu hình sẵn
      // (mirror `employee-code-config.int-spec.ts`), không thì 422 HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID.
      await direct.query(
        "INSERT INTO employee_code_configs (company_id, prefix, number_length, status) VALUES ($1,'IAQA',5,'active')",
        [A.companyId],
      );
    }, 120_000);

    afterAll(async () => {
      if (direct) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ── A. Idempotency — 4 route, replay TUẦN TỰ (KHÔNG race) ───────────────────────────────────

    describe("A. idempotency 4 route @Idempotent — replay tuần tự", () => {
      it("007 POST /candidates: cùng khoá ⇒ 1 bản ghi + Idempotency-Replayed; khác khoá ⇒ 2 bản ghi", async () => {
        const jobId = await newJob();
        const key = `cand-idem-${randomUUID()}`;
        const body = { jobOpeningId: jobId, fullName: "Ứng viên IDEM QA" };

        const r1 = await post(tActor, "/candidates").set(IDEMPOTENCY_HEADER, key).send(body);
        expect(r1.status, JSON.stringify(r1.body)).toBe(201);
        expect(r1.headers[IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()]).toBeUndefined();

        const r2 = await post(tActor, "/candidates").set(IDEMPOTENCY_HEADER, key).send(body);
        expect(r2.status, JSON.stringify(r2.body)).toBe(201);
        expect(r2.headers[IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()]).toBe("true");
        expect(r2.body.data.id).toBe(r1.body.data.id);

        const count = await direct.query(
          "SELECT count(*)::int AS n FROM candidates WHERE company_id = $1 AND job_opening_id = $2",
          [A.companyId, jobId],
        );
        expect(count.rows[0].n, "cùng khoá KHÔNG được tạo bản ghi thứ 2").toBe(1);

        const r3 = await post(tActor, "/candidates")
          .set(IDEMPOTENCY_HEADER, `cand-idem-other-${randomUUID()}`)
          .send({ jobOpeningId: jobId, fullName: "Ứng viên IDEM QA 2" });
        expect(r3.status, JSON.stringify(r3.body)).toBe(201);
        expect(r3.body.data.id).not.toBe(r1.body.data.id);
        const count2 = await direct.query(
          "SELECT count(*)::int AS n FROM candidates WHERE company_id = $1 AND job_opening_id = $2",
          [A.companyId, jobId],
        );
        expect(count2.rows[0].n, "khác khoá PHẢI tạo bản ghi riêng").toBe(2);
      });

      it("019 POST /interviews: cùng khoá ⇒ 1 lượt được tạo, phát lại nguyên văn", async () => {
        const jobId = await newJob();
        const cand = await post(tActor, "/candidates").send({
          jobOpeningId: jobId,
          fullName: "Ứng viên IDEM interview",
        });
        expect(cand.status, JSON.stringify(cand.body)).toBe(201);
        const cid = cand.body.data.id as string;
        expect((await moveStage(cid, "Screening")).status).toBe(201);
        expect((await moveStage(cid, "Interview")).status).toBe(201);

        const key = `iv-idem-${randomUUID()}`;
        const body = {
          candidateId: cid,
          startsAt: new Date(Date.now() + 3_600_000).toISOString(),
          endsAt: new Date(Date.now() + 5_400_000).toISOString(),
          participantEmployeeIds: [actorEmployeeId],
        };
        const r1 = await post(tActor, "/interviews").set(IDEMPOTENCY_HEADER, key).send(body);
        expect(r1.status, JSON.stringify(r1.body)).toBe(201);
        const r2 = await post(tActor, "/interviews").set(IDEMPOTENCY_HEADER, key).send(body);
        expect(r2.status, JSON.stringify(r2.body)).toBe(201);
        expect(r2.headers[IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()]).toBe("true");
        expect(r2.body.data.id).toBe(r1.body.data.id);

        const count = await direct.query(
          "SELECT count(*)::int AS n FROM interviews WHERE company_id = $1 AND candidate_id = $2",
          [A.companyId, cid],
        );
        expect(count.rows[0].n).toBe(1);
      });

      it("026 POST /offers: cùng khoá ⇒ 1 offer được tạo, phát lại nguyên văn", async () => {
        const jobId = await newJob();
        const cand = await post(tActor, "/candidates").send({
          jobOpeningId: jobId,
          fullName: "Ứng viên IDEM offer",
        });
        const cid = cand.body.data.id as string;
        expect((await moveStage(cid, "Screening")).status).toBe(201);
        expect((await moveStage(cid, "Interview")).status).toBe(201);
        expect((await moveStage(cid, "Offer")).status).toBe(201);

        const key = `offer-idem-${randomUUID()}`;
        const body = { candidateId: cid, startDate: futureDateStr(), salary: "18000000" };
        const r1 = await post(tActor, "/offers").set(IDEMPOTENCY_HEADER, key).send(body);
        expect(r1.status, JSON.stringify(r1.body)).toBe(201);
        const r2 = await post(tActor, "/offers").set(IDEMPOTENCY_HEADER, key).send(body);
        expect(r2.status, JSON.stringify(r2.body)).toBe(201);
        expect(r2.headers[IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()]).toBe("true");
        expect(r2.body.data.id).toBe(r1.body.data.id);

        const count = await direct.query(
          "SELECT count(*)::int AS n FROM offers WHERE company_id = $1 AND candidate_id = $2",
          [A.companyId, cid],
        );
        expect(count.rows[0].n).toBe(1);
      });

      it("029 POST /candidates/:id/convert: cùng khoá ⇒ 1 employee_profile được tạo, phát lại nguyên văn", async () => {
        const jobId = await newJob();
        const cand = await post(tActor, "/candidates").send({
          jobOpeningId: jobId,
          fullName: "Ứng viên IDEM convert",
        });
        const cid = cand.body.data.id as string;
        expect((await moveStage(cid, "Screening")).status).toBe(201);
        expect((await moveStage(cid, "Interview")).status).toBe(201);
        expect((await moveStage(cid, "Offer")).status).toBe(201);
        const offer = await post(tActor, "/offers").send({
          candidateId: cid,
          startDate: futureDateStr(),
          salary: "22000000",
        });
        expect(offer.status, JSON.stringify(offer.body)).toBe(201);
        const offerId = offer.body.data.id as string;
        const sent = await post(tActor, `/offers/${offerId}/change-status`).send({
          toStatus: "Sent",
        });
        expect(sent.status, JSON.stringify(sent.body)).toBe(201);
        const accepted = await post(tActor, `/offers/${offerId}/change-status`).send({
          toStatus: "Accepted",
        });
        expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);

        const key = `convert-idem-${randomUUID()}`;
        const r1 = await post(tActor, `/candidates/${cid}/convert`).set(IDEMPOTENCY_HEADER, key);
        expect(r1.status, JSON.stringify(r1.body)).toBe(201);
        const employeeId = r1.body.data.employeeId as string;

        const r2 = await post(tActor, `/candidates/${cid}/convert`).set(IDEMPOTENCY_HEADER, key);
        expect(r2.status, JSON.stringify(r2.body)).toBe(201);
        expect(r2.headers[IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()]).toBe("true");
        expect(r2.body.data.employeeId).toBe(employeeId);

        const count = await direct.query(
          "SELECT count(*)::int AS n FROM employee_profiles WHERE id = $1",
          [employeeId],
        );
        expect(count.rows[0].n, "cùng khoá KHÔNG được convert lần 2").toBe(1);
      });
    });

    // ── B. Audit — 13 hành động quan trọng, mỗi hành động +1 hàng đúng object_type, không PII ────

    describe("B. audit_logs — mỗi mutation quan trọng +1 hàng, before/after không chứa email/phone/salary", () => {
      it("chuỗi job-opening→candidate→interview→offer đủ 13 action, không rò PII/lương", async () => {
        // 1) job-opening create
        const jobRes = await post(tActor, "/job-openings").send({
          title: "Audit Chain QA",
          orgUnitId,
        });
        expect(jobRes.status, JSON.stringify(jobRes.body)).toBe(201);
        const jobId = jobRes.body.data.id as string;

        // 2) job-opening update
        const jobUpd = await patch(tActor, `/job-openings/${jobId}`).send({
          title: "Audit Chain QA (đã sửa)",
        });
        expect(jobUpd.status, JSON.stringify(jobUpd.body)).toBe(200);

        // 3) job-opening change-status
        const jobOpen = await post(tActor, `/job-openings/${jobId}/change-status`).send({
          toStatus: "Open",
        });
        expect(jobOpen.status, JSON.stringify(jobOpen.body)).toBe(201);

        const realEmail = `audit-secret-${randomUUID().slice(0, 6)}@x.test`;
        const realPhone = "0987654321";
        // 4) candidate create
        const candRes = await post(tActor, "/candidates").send({
          jobOpeningId: jobId,
          fullName: "Ứng viên Audit Chain",
          email: realEmail,
          phone: realPhone,
        });
        expect(candRes.status, JSON.stringify(candRes.body)).toBe(201);
        const candidateId = candRes.body.data.id as string;

        // 5) candidate update
        const candUpd = await patch(tActor, `/candidates/${candidateId}`).send({
          fullName: "Ứng viên Audit Chain (đã sửa)",
        });
        expect(candUpd.status, JSON.stringify(candUpd.body)).toBe(200);

        // 6) note create (comment)
        const noteRes = await post(tActor, `/candidates/${candidateId}/notes`).send({
          body: "Ghi chú audit QA",
        });
        expect(noteRes.status, JSON.stringify(noteRes.body)).toBe(201);
        const noteId = noteRes.body.data.id as string;

        // 7) note update (update-comment)
        const noteUpd = await patch(tActor, `/candidates/${candidateId}/notes/${noteId}`).send({
          body: "Ghi chú audit QA (đã sửa)",
        });
        expect(noteUpd.status, JSON.stringify(noteUpd.body)).toBe(200);

        // 8) move-stage (candidate) — New→Screening→Interview
        expect((await moveStage(candidateId, "Screening")).status).toBe(201);
        expect((await moveStage(candidateId, "Interview")).status).toBe(201);

        // 9) interview create
        const ivRes = await post(tActor, "/interviews").send({
          candidateId,
          startsAt: new Date(Date.now() + 3_600_000).toISOString(),
          endsAt: new Date(Date.now() + 5_400_000).toISOString(),
          participantEmployeeIds: [actorEmployeeId],
        });
        expect(ivRes.status, JSON.stringify(ivRes.body)).toBe(201);
        const interviewId = ivRes.body.data.id as string;

        // 10) interview change-status
        const ivDone = await post(tActor, `/interviews/${interviewId}/change-status`).send({
          toStatus: "Completed",
        });
        expect(ivDone.status, JSON.stringify(ivDone.body)).toBe(201);

        // 11) feedback create
        const fbRes = await post(tActor, `/interviews/${interviewId}/feedback`).send({
          rating: 4,
          recommendation: "Hire",
        });
        expect(fbRes.status, JSON.stringify(fbRes.body)).toBe(201);

        // move-stage tiếp Interview→Offer (cần cho offer)
        expect((await moveStage(candidateId, "Offer")).status).toBe(201);

        const realSalary = "987654321";
        // 12) offer create
        const offerRes = await post(tActor, "/offers").send({
          candidateId,
          startDate: futureDateStr(),
          salary: realSalary,
        });
        expect(offerRes.status, JSON.stringify(offerRes.body)).toBe(201);
        const offerId = offerRes.body.data.id as string;

        // 13) offer change-status
        const offerSent = await post(tActor, `/offers/${offerId}/change-status`).send({
          toStatus: "Sent",
        });
        expect(offerSent.status, JSON.stringify(offerSent.body)).toBe(201);

        // ── Đối chiếu audit_logs theo aggregate ──
        const jobRows = await auditRows("job_opening", jobId);
        expect(jobRows.map((r) => r.action)).toEqual(
          expect.arrayContaining(["create", "update", "change-status"]),
        );

        const candRows = await auditRows("candidate", candidateId);
        expect(candRows.map((r) => r.action)).toEqual(
          expect.arrayContaining(["create", "update", "move-stage", "comment", "update-comment"]),
        );

        const ivRows = await auditRows("interview", interviewId);
        expect(ivRows.map((r) => r.action)).toEqual(
          expect.arrayContaining(["create", "change-status", "feedback"]),
        );

        const offerRows = await auditRows("offer", offerId);
        expect(offerRows.map((r) => r.action)).toEqual(
          expect.arrayContaining(["create", "change-status"]),
        );

        // ── KHÔNG rò email/phone/salary thật trong before/after (BẤT BIẾN #3 / plan §6.1 bước 7) ──
        const blob = JSON.stringify([...candRows, ...offerRows]);
        expect(blob).not.toContain(realEmail);
        expect(blob).not.toContain(realPhone);
        expect(blob).not.toContain(realSalary);
      });
    });

    // ── C. Export (010) — RECRUIT-ERR-015 ca THẬT + 403 thiếu 1 trong 2 cặp ─────────────────────

    describe("C. export — trần THẬT qua env override + 403 thiếu cặp", () => {
      afterEach(() => {
        delete process.env.RECRUIT_EXPORT_MAX_ROWS_OVERRIDE;
      });

      it("seed 6 candidate + trần override=5 ⇒ 422 015; xoá override ⇒ 200 + audit export, không dữ liệu", async () => {
        const jobId = await newJob();
        for (let i = 0; i < 6; i++) {
          const r = await post(tActor, "/candidates").send({
            jobOpeningId: jobId,
            fullName: `Export QA ${i}`,
            email: `export-qa-${i}-${randomUUID().slice(0, 6)}@x.test`,
          });
          expect(r.status, JSON.stringify(r.body)).toBe(201);
        }

        process.env.RECRUIT_EXPORT_MAX_ROWS_OVERRIDE = "5";
        const over = await get(tActor, `/candidates/export?jobOpeningId=${jobId}`);
        expect(over.status, JSON.stringify(over.body)).toBe(422);
        expect(code(over)).toBe("RECRUIT-ERR-015");

        delete process.env.RECRUIT_EXPORT_MAX_ROWS_OVERRIDE;
        const ok = await get(tActor, `/candidates/export?jobOpeningId=${jobId}`);
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
        expect(Array.isArray(ok.body.data)).toBe(true);
        expect((ok.body.data as unknown[]).length).toBe(6);

        const exportAudit = await direct.query(
          `SELECT after FROM audit_logs
             WHERE company_id = $1 AND action = 'export' AND object_type = 'candidate'
             ORDER BY created_at DESC LIMIT 1`,
          [A.companyId],
        );
        expect(exportAudit.rows, JSON.stringify(exportAudit.rows)).toHaveLength(1);
        const after = exportAudit.rows[0].after as { rows?: number };
        expect(after.rows).toBe(6);
        expect(JSON.stringify(after)).not.toMatch(/@x\.test/);
      });

      it("role CHỈ có export:candidate (KHÔNG view:candidate) ⇒ 403", async () => {
        const roleId = await seedRole(direct, A.companyId, "export-only");
        const exportPermId = await seedPermissionCatalog(direct, "export", "candidate", true);
        await seedRolePermission(direct, roleId, exportPermId, "ALLOW", "Company");
        const userId = await seedUser(
          direct,
          A.companyId,
          `export-only@${A.slug}.test`,
          await new PasswordService().hash(LOGIN_PW),
        );
        await seedUserRole(direct, userId, roleId, A.companyId);
        const t = await login(A.slug, `export-only@${A.slug}.test`);

        const res = await get(t, "/candidates/export");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });
    });

    // ── D. Append-only DB — mediaos_app KHÔNG UPDATE/DELETE 2 sổ chỉ-INSERT ─────────────────────

    describe("D. append-only DB (mediaos_app) — candidate_stage_events + interview_participants", () => {
      it("has_table_privilege('mediaos_app', <bảng>, 'UPDATE'|'DELETE') = false cho cả hai bảng", async () => {
        for (const table of ["candidate_stage_events", "interview_participants"]) {
          const upd = await direct.query(
            `SELECT has_table_privilege('mediaos_app', $1, 'UPDATE') AS ok`,
            [table],
          );
          expect(upd.rows[0].ok, `${table} KHÔNG được có UPDATE`).toBe(false);
          const del = await direct.query(
            `SELECT has_table_privilege('mediaos_app', $1, 'DELETE') AS ok`,
            [table],
          );
          expect(del.rows[0].ok, `${table} KHÔNG được có DELETE`).toBe(false);
          // Đối chứng dương (chống ca rỗng): INSERT + SELECT vẫn phải có (append-only ≠ vô hiệu hoá).
          const ins = await direct.query(
            `SELECT has_table_privilege('mediaos_app', $1, 'INSERT') AS ok`,
            [table],
          );
          expect(
            ins.rows[0].ok,
            `${table} PHẢI còn INSERT (append-only, không phải khoá cứng)`,
          ).toBe(true);
        }
      });
    });
  },
);
