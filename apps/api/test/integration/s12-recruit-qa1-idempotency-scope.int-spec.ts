/**
 * S12-RECRUIT-QA-1 — BIÊN của `@Idempotent()` trên 4 route RECRUIT (SPEC-12 §12/§18 — `POST /candidates`
 * (007) · `POST /interviews` (019) · `POST /offers` (026) · `POST /candidates/:id/convert` (029)), phần
 * `recruit-be1-idempotency-audit.int-spec.ts` (mục A) CHƯA đo — file đó chỉ có REPLAY TUẦN TỰ (cùng khoá 2
 * lần, không đua) và "khác khoá ⇒ 2 bản ghi".
 *
 * Còn thiếu ĐÚNG các vế biên/cô lập mà interceptor hứa (`idempotency.interceptor.ts` — vòng đời khoá):
 *   · `INVALID_KEY`  — khoá quá dài ⇒ 409, KHÔNG chạy nghiệp vụ (0 lượt sinh ra);
 *   · `IN_PROGRESS`  — bấm-đúp `convert` khi request đầu CHƯA xong ⇒ 409 IN_PROGRESS, KHÔNG phải
 *     `RECRUIT-ERR-008` (đây là ca race DUY NHẤT dùng CÙNG khoá — race 2 KHÁC khoá đã có ở
 *     `recruit-be1-convert.int-spec.ts`, KHÔNG lặp lại);
 *   · KHÔNG phát lại CHÉO — cùng chuỗi khoá nhưng khác **người gọi** / khác **công ty** ⇒ mỗi bên chạy
 *     nghiệp vụ CỦA MÌNH (BẤT BIẾN #1 đi qua đường CACHE: khoá băm companyId+userId+method+path+key);
 *   · lỗi ⇒ NHẢ khoá — request hỏng không được "đóng băng" khoá, và khoá vẫn KEY_REUSED được với payload khác;
 *   · KHÔNG header ⇒ `@Idempotent()` là opt-in (BACK-COMPAT), chạy nghiệp vụ bình thường mỗi lần gọi.
 *
 * Kỹ thuật khoá-hàng TẤT ĐỊNH cho ca IN_PROGRESS mirror `s11-room-qa1-idempotency-scope.int-spec.ts`:
 * transaction riêng `FOR UPDATE` đúng hàng mà `findForConvertTx` (`candidates.repository.ts`) sẽ khoá
 * (`.for("update", { of: candidates })`) ⇒ request #1 CHẮC CHẮN treo TRONG handler, SAU khi interceptor
 * đã ghi khoá idempotency — không phải đua hai request song song rồi đoán ai thua.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). `await app.listen(0)`: ca IN_PROGRESS giữ hai request
 * cùng lúc — app chỉ `init()` sẽ đóng socket dùng chung khi request đầu tiên trả về
 * (memory `supertest-closes-shared-server-on-first-response`).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IDEMPOTENCY_ERROR_CODES,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
} from "@mediaos/contracts";
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
const LOGIN_PW = loginPasswordFixture("s12rqa1");

/** 16 cặp §9f — mirror `allPairs` của `recruit-be1-convert.int-spec.ts` (đã chứng minh đủ cho full flow). */
const RECRUIT_ALL: Array<[string, string]> = [
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

/** Khoá dùng CHÉO CHỦ THỂ ở 2 ca độc lập (case 3 tA1→tA2, case 4 tB1) — cùng chuỗi CỐ Ý, mỗi ca tự đủ. */
const CROSS_SCOPE_KEY = ["s12rqa1", "offers", "cross-scope"].join("-");

describe.skipIf(!hasLaneDb)("S12-RECRUIT-QA-1 idempotency — biên + cô lập chủ thể", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let aUser1 = ""; // công ty A, người gọi #1
  let tA1 = "";
  let tA2 = ""; // công ty A, người gọi #2
  let tB1 = ""; // công ty B
  let orgUnitA = "";
  let orgUnitB = "";
  let actorEmployeeIdA1 = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const code = (r: request.Response) => r.body?.error?.code as string | undefined;

  const futureDateStr = (): string =>
    new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

  async function grantAll(companyId: string, userId: string, label: string) {
    const roleId = await seedRole(direct, companyId, `s12rqa1-${label}`);
    for (const [action, resource] of RECRUIT_ALL) {
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
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function seedOrgUnit(companyId: string, name: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO org_units (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
      [companyId, name],
    );
    return r.rows[0].id as string;
  }

  async function newEmployee(companyId: string, userId: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,'active') RETURNING id`,
      [companyId, userId],
    );
    return r.rows[0].id as string;
  }

  async function newJob(t: string, orgUnitId: string, title: string): Promise<string> {
    const res = await post(t, "/job-openings").send({ title, orgUnitId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function newCandidate(t: string, jobOpeningId: string, fullName: string): Promise<string> {
    const res = await post(t, "/candidates").send({ jobOpeningId, fullName });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function moveStage(t: string, candidateId: string, toStage: string) {
    const res = await post(t, `/candidates/${candidateId}/move-stage`).send({
      toStage,
      reason: "s12rqa1 idempotency fixture",
    });
    expect(res.status, `move ${candidateId}->${toStage}: ${JSON.stringify(res.body)}`).toBe(201);
  }

  /** Candidate ở stage `Interview`, CHƯA có interview nào — cho POST /interviews. */
  async function candidateAtInterviewStage(
    t: string,
    orgUnitId: string,
    label: string,
  ): Promise<string> {
    const jobId = await newJob(t, orgUnitId, `Job ${label}`);
    const cid = await newCandidate(t, jobId, `Cand ${label}`);
    await moveStage(t, cid, "Screening");
    await moveStage(t, cid, "Interview");
    return cid;
  }

  /** Candidate ở stage `Offer`, CHƯA có offer nào — cho POST /offers. */
  async function candidateAtOfferStage(
    t: string,
    orgUnitId: string,
    label: string,
  ): Promise<string> {
    const cid = await candidateAtInterviewStage(t, orgUnitId, label);
    await moveStage(t, cid, "Offer");
    return cid;
  }

  /** Candidate ở stage `Offer` + 1 offer `Accepted` — sẵn sàng convert. */
  async function candidateWithAcceptedOffer(
    t: string,
    orgUnitId: string,
    label: string,
  ): Promise<string> {
    const cid = await candidateAtOfferStage(t, orgUnitId, label);
    const offer = await post(t, "/offers").send({
      candidateId: cid,
      startDate: futureDateStr(),
      salary: "21000000",
    });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
    const offerId = offer.body.data.id as string;
    const sent = await post(t, `/offers/${offerId}/change-status`).send({ toStatus: "Sent" });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    const accepted = await post(t, `/offers/${offerId}/change-status`).send({
      toStatus: "Accepted",
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    return cid;
  }

  async function candidateCountA(): Promise<number> {
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM candidates WHERE company_id = $1",
      [A.companyId],
    );
    return r.rows[0].n as number;
  }

  async function employeeProfileCountA(): Promise<number> {
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM employee_profiles WHERE company_id = $1",
      [A.companyId],
    );
    return r.rows[0].n as number;
  }

  async function offerCountA(): Promise<number> {
    const r = await direct.query("SELECT count(*)::int AS n FROM offers WHERE company_id = $1", [
      A.companyId,
    ]);
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    // Server THẬT: ca IN_PROGRESS giữ hai request cùng lúc — app chỉ `init()` sẽ đóng socket dùng chung
    // khi request đầu tiên trả về (memory `supertest-closes-shared-server-on-first-response`).
    await app.listen(0);

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s12rqa1a");
    B = await seedCompany(direct, "s12rqa1b");
    companyIds.push(A.companyId, B.companyId);

    aUser1 = await seedUser(direct, A.companyId, `a1@${A.slug}.test`, hash);
    const aUser2 = await seedUser(direct, A.companyId, `a2@${A.slug}.test`, hash);
    const bUser1 = await seedUser(direct, B.companyId, `b1@${B.slug}.test`, hash);
    await grantAll(A.companyId, aUser1, "a1");
    await grantAll(A.companyId, aUser2, "a2");
    await grantAll(B.companyId, bUser1, "b1");

    tA1 = await login(A.slug, `a1@${A.slug}.test`);
    tA2 = await login(A.slug, `a2@${A.slug}.test`);
    tB1 = await login(B.slug, `b1@${B.slug}.test`);

    orgUnitA = await seedOrgUnit(A.companyId, "S12RQA1 Org A");
    orgUnitB = await seedOrgUnit(B.companyId, "S12RQA1 Org B");
    actorEmployeeIdA1 = await newEmployee(A.companyId, aUser1);

    // Convert (029) cấp mã NV qua HrWriteService — cần counter cấu hình sẵn (mirror
    // `recruit-be1-convert.int-spec.ts`), không thì 422 HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID.
    await direct.query(
      "INSERT INTO employee_code_configs (company_id, prefix, number_length, status) VALUES ($1,'QA1',5,'active')",
      [A.companyId],
    );
  }, 180_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── 1. INVALID_KEY — POST /candidates ───────────────────────────────────────────────────────────

  it("khoá quá dài ⇒ 409 INVALID_KEY, KHÔNG chạy nghiệp vụ (0 lượt); khoá đúng biên MAX ⇒ 201", async () => {
    const jobId = await newJob(tA1, orgUnitA, "Invalid Key QA");
    const before = await candidateCountA();

    const res = await post(tA1, "/candidates")
      .set(IDEMPOTENCY_HEADER, "k".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1))
      .send({ jobOpeningId: jobId, fullName: "Khoá quá dài" });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(code(res)).toBe(IDEMPOTENCY_ERROR_CODES.INVALID_KEY);
    // Vế QUAN TRỌNG: chặn ở interceptor ⇒ handler chưa từng chạy.
    expect(await candidateCountA()).toBe(before);

    // ALLOW đối chứng: đúng độ dài tối đa (biên = HỢP LỆ) ⇒ chạy bình thường. Thiếu vế này thì ca trên
    // xanh cả khi mọi khoá đều bị từ chối (`deny-cases-vacuous-without-allow-case`).
    const ok = await post(tA1, "/candidates")
      .set(IDEMPOTENCY_HEADER, "k".repeat(IDEMPOTENCY_KEY_MAX_LENGTH))
      .send({ jobOpeningId: jobId, fullName: "Khoá dài tối đa" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await candidateCountA()).toBe(before + 1);
  });

  // ── 2. IN_PROGRESS tất định — POST /candidates/:id/convert ────────────────────────────────────

  it("bấm-đúp convert khi request đầu CHƯA xong ⇒ 409 IN_PROGRESS (KHÔNG phải RECRUIT-ERR-008), đúng 1 lượt convert", async () => {
    const cid = await candidateWithAcceptedOffer(tA1, orgUnitA, "Inflight Convert");
    const before = await employeeProfileCountA();
    const key = ["s12rqa1", "convert", "inflight"].join("-");
    const fire = () => post(tA1, `/candidates/${cid}/convert`).set(IDEMPOTENCY_HEADER, key);

    const locker = await direct.connect();
    let first: request.Response | null = null;
    try {
      await locker.query("BEGIN");
      // Đúng hàng mà `findForConvertTx` (Pha 3) khoá qua `.for("update", { of: candidates })`.
      await locker.query("SELECT id FROM candidates WHERE id = $1 FOR UPDATE", [cid]);

      // #1 đi qua Pha 1 (guard, không khoá) + Pha 2 (cấp mã, ngoài tx) rồi TREO ở Pha 3 FOR UPDATE.
      const p1 = fire().then(
        (r) => (first = r),
        () => null,
      );
      await new Promise((r) => setTimeout(r, 300)); // đủ để #1 qua interceptor + kẹt ở khoá hàng

      const r2 = await fire();
      expect(r2.status, JSON.stringify(r2.body)).toBe(409);
      expect(code(r2)).toBe(IDEMPOTENCY_ERROR_CODES.IN_PROGRESS);
      expect(code(r2)).not.toBe("RECRUIT-ERR-008");

      await locker.query("ROLLBACK");
      await p1;
    } finally {
      locker.release();
    }

    // #1 vẫn đi tới đích sau khi khoá được nhả ⇒ ĐÚNG một lượt convert, không mất và không nhân đôi.
    expect(await employeeProfileCountA()).toBe(before + 1);
    if (first) expect((first as request.Response).status).toBe(201);
  });

  // ── 3. KHÔNG phát lại chéo — khác người gọi cùng công ty — POST /offers ──────────────────────

  it("CÙNG chuỗi khoá, KHÁC người gọi trong cùng công ty ⇒ không phát lại chéo", async () => {
    const cid1 = await candidateAtOfferStage(tA1, orgUnitA, "CrossUser 1");
    const cid2 = await candidateAtOfferStage(tA1, orgUnitA, "CrossUser 2");

    const r1 = await post(tA1, "/offers")
      .set(IDEMPOTENCY_HEADER, CROSS_SCOPE_KEY)
      .send({ candidateId: cid1, startDate: futureDateStr(), salary: "15000000" });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);

    const r2 = await post(tA2, "/offers")
      .set(IDEMPOTENCY_HEADER, CROSS_SCOPE_KEY)
      .send({ candidateId: cid2, startDate: futureDateStr(), salary: "16000000" });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(r2.headers["idempotency-replayed"]).toBeUndefined();
    // Phản hồi của A2 phải là lượt CỦA A2 — không phải bản sao envelope của A1.
    expect(r2.body.data.id).not.toBe(r1.body.data.id);
    expect(r2.body.data.candidateId).toBe(cid2);
  });

  // ── 4. KHÔNG phát lại chéo — khác công ty — POST /offers (BẤT BIẾN #1 qua đường cache) ───────

  it("CÙNG chuỗi khoá với ca trên, KHÁC công ty ⇒ vẫn chạy nghiệp vụ THẬT (không phát lại của công ty khác)", async () => {
    const cid = await candidateAtOfferStage(tB1, orgUnitB, "CrossCompany B");
    const res = await post(tB1, "/offers")
      .set(IDEMPOTENCY_HEADER, CROSS_SCOPE_KEY)
      .send({ candidateId: cid, startDate: futureDateStr(), salary: "17000000" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers["idempotency-replayed"]).toBeUndefined();
    // Lượt của B nằm ở candidate của B — nếu cache phát lại chéo, id sẽ là candidate của công ty A.
    expect(res.body.data.candidateId).toBe(cid);
  });

  // ── 5. Lỗi ⇒ nhả khoá — POST /interviews ──────────────────────────────────────────────────────

  it("handler LỖI (404 candidate ma) ⇒ nhả khoá: retry CÙNG khoá + payload HỢP LỆ chạy THẬT; payload KHÁC ⇒ 409 KEY_REUSED", async () => {
    const key = ["s12rqa1", "release", "after-error"].join("-");
    const ghostCandidateId = "00000000-0000-4000-8000-0000000000fe";
    const base = Date.now();
    const bad1 = await post(tA1, "/interviews")
      .set(IDEMPOTENCY_HEADER, key)
      .send({
        candidateId: ghostCandidateId,
        startsAt: new Date(base + 3_600_000).toISOString(),
        endsAt: new Date(base + 5_400_000).toISOString(),
        participantEmployeeIds: [actorEmployeeIdA1],
      });
    expect(bad1.status, JSON.stringify(bad1.body)).toBe(404);
    expect(code(bad1)).toBe("RECRUIT-ERR-010");

    // Lỗi KHÔNG được cache ⇒ retry CÙNG khoá + payload hợp lệ là lần chạy THẬT, không mang header phát lại.
    const validCid1 = await candidateAtInterviewStage(tA1, orgUnitA, "Release Valid");
    const retry = await post(tA1, "/interviews")
      .set(IDEMPOTENCY_HEADER, key)
      .send({
        candidateId: validCid1,
        startsAt: new Date(base + 7_200_000).toISOString(),
        endsAt: new Date(base + 9_000_000).toISOString(),
        participantEmployeeIds: [actorEmployeeIdA1],
      });
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    expect(retry.headers["idempotency-replayed"]).toBeUndefined();

    // Và khoá giờ đã "đóng" với payload của retry ⇒ payload KHÁC ⇒ đúng KEY_REUSED (không phải "khoá chết").
    const validCid2 = await candidateAtInterviewStage(tA1, orgUnitA, "Release Reuse");
    const reuse = await post(tA1, "/interviews")
      .set(IDEMPOTENCY_HEADER, key)
      .send({
        candidateId: validCid2,
        startsAt: new Date(base + 10_800_000).toISOString(),
        endsAt: new Date(base + 12_600_000).toISOString(),
        participantEmployeeIds: [actorEmployeeIdA1],
      });
    expect(reuse.status, JSON.stringify(reuse.body)).toBe(409);
    expect(code(reuse)).toBe(IDEMPOTENCY_ERROR_CODES.KEY_REUSED);
  });

  // ── 6. KHÔNG header ⇒ opt-in, chạy nghiệp vụ bình thường — POST /offers ──────────────────────

  it("@Idempotent KHÔNG gửi header ⇒ mỗi lượt gọi chạy nghiệp vụ THẬT (opt-in, BACK-COMPAT)", async () => {
    const cid1 = await candidateAtOfferStage(tA1, orgUnitA, "No Header 1");
    const cid2 = await candidateAtOfferStage(tA1, orgUnitA, "No Header 2");
    const before = await offerCountA();

    const r1 = await post(tA1, "/offers").send({
      candidateId: cid1,
      startDate: futureDateStr(),
      salary: "12000000",
    });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.headers["idempotency-replayed"]).toBeUndefined();

    const r2 = await post(tA1, "/offers").send({
      candidateId: cid2,
      startDate: futureDateStr(),
      salary: "12000000",
    });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(r2.headers["idempotency-replayed"]).toBeUndefined();
    expect(r2.body.data.id).not.toBe(r1.body.data.id);

    expect(await offerCountA()).toBe(before + 2);
  });
});
