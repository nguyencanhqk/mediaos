/**
 * S12-RECRUIT-QA-1 — SÀN SCOPE COMPANY (`companyFloor`) của RECRUIT (SPEC-12 §11 · §13.6 ·
 * permission-matrix §9f). Vá lỗ CHƯA AI ĐO: layer-2 guard `RecruitAccessService.resolveActor`
 * (recruit-access.service.ts:43-47) từ chối 28/32 route khi actor GIỮ ĐÚNG cặp quyền nhưng ở
 * scope HẸP HƠN Company (Own/Department) — `recruit-be1-scope.int-spec.ts` chỉ đo "thiếu cặp
 * hoàn toàn" (403 `AUTH-ERR-FORBIDDEN`), CHƯA từng đo "có đủ cặp nhưng sai TẦNG SCOPE" (403
 * `AUTH-ERR-SCOPE-DENIED`) — hai lỗi CÙNG status 403, chỉ khác nhau ở marker trong `error.message`.
 *
 * VÌ SAO PHẢI ĐO MARKER, KHÔNG CHỈ STATUS. `RecruitAccessService` ném
 * `new ForbiddenException("AUTH-ERR-SCOPE-DENIED: ...")` — một CHUỖI trần, KHÔNG bọc `{code, ...}`
 * như ROOM (`rooms.errors.ts#viewScopeDenied` dùng `roomErrorBody(AUTH_ERR_SCOPE_DENIED, msg)`).
 * `AllExceptionsFilter#resolve` chỉ tin `payload.code` khi caller đặt TƯỜNG MINH; thiếu nó thì rơi
 * về generic `httpStatusToCode(403) = "AUTH-ERR-FORBIDDEN"` ở `error.code` — CHO CẢ HAI loại 403
 * (thiếu cặp lẫn sai scope). Marker DUY NHẤT phân biệt hai đường là chuỗi "AUTH-ERR-SCOPE-DENIED"
 * nằm trong `error.message` (== `exception.message`, không bị che vì status <500). Assert theo
 * `error.code` ở đây sẽ XANH dù route lỡ trả nhầm loại 403 (test đóng đinh lỗ — memory
 * `tests-can-pin-a-hole-open`); vì vậy MỌI ca DENY dưới đây assert `error.message` chứa marker.
 *
 * PHÉP ĐO = A/B CÙNG REQUEST, chỉ đổi CHỦ THỂ (khuôn `s11-room-qa1-permission-matrix.int-spec.ts`):
 *   · `tOwn`     giữ ĐỦ 15 cặp §5 (mọi pair distinct của `RECRUIT_ROUTE_PAIRS`) ở scope Own;
 *   · `tDept`    giữ ĐỦ 15 cặp ở scope Department (mục D — sàn là Company, không phải "≥Own");
 *   · `tCompany` giữ ĐỦ 15 cặp ở scope Company — ALLOW đối chứng + dựng fixture qua API thật.
 *
 * A. 28 route `companyFloor:true` — `tOwn` ⇒ 403 + marker AUTH-ERR-SCOPE-DENIED.
 * B. CÙNG 28 route, CÙNG request/body — `tCompany` ⇒ KHÔNG 403 (đọc = đúng 200).
 * C. 4 route `companyFloor:false` (interviewList/Detail/FeedbackCreate/Update) — `tOwn` là
 *    participant THẬT của một lượt phỏng vấn ⇒ KHÔNG bị scope-denied (200/201 THẬT).
 * D. Department (không chỉ Own) cũng bị sàn chặn — 1 route mỗi họ job-opening/candidate/offer.
 * E. Census chống xanh-rỗng: 28 key mục A ∪ 4 key mục C = ĐÚNG 32 key của `RECRUIT_ROUTE_PAIRS`
 *    (so tập cả hai chiều) — route RECRUIT mới mọc lên mà quên xếp vào bảng này sẽ làm suite ĐỎ.
 *
 * KHÔNG GÂY TÁC DỤNG PHỤ: route ghi bắn UUID KHÔNG TỒN TẠI / body tối thiểu ⇒ qua guard rồi dừng ở
 * pipe/service (400/404/409) — guard chạy TRƯỚC pipe (Nest: guards → interceptors → pipes) nên vế
 * 403 không phụ thuộc thân request.
 *
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane (CLAUDE.md §9.5).
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
import {
  RECRUIT_ROUTE_PAIRS,
  type RecruitRouteKey,
} from "../../src/recruit/recruit-route-pairs.const";
import { FALLBACK_S3_SECRET, loginPasswordFixture } from "../helpers/fixture-secrets";
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
const LOGIN_PW = loginPasswordFixture("s12recruitqa1");

// S14-RECRUIT-FILEGRANT-1 — 3 route tệp CV đi qua `FileService` (presign S3 là HMAC OFFLINE, KHÔNG
// gọi mạng ⇒ không cần MinIO chạy). Đặt TRƯỚC khi dựng app.
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_ACCESS_KEY ??= "mediaos";
process.env.S3_SECRET_KEY ??= FALLBACK_S3_SECRET;
process.env.S3_BUCKET ??= "mediaos-assets";
process.env.S3_FORCE_PATH_STYLE ??= "true";
process.env.S3_REGION ??= "us-east-1";

/** 16 cặp distinct của RECRUIT_ROUTE_PAIRS (dedupe theo "action:resource"), giữ NGUYÊN cờ sensitive —
 * nguồn sự thật DUY NHẤT cho cả ba chủ thể (`tOwn`/`tDept`/`tCompany`), không gõ lại literal. */
const ALL_PAIRS: ReadonlyArray<{ action: string; resourceType: string; isSensitive: boolean }> = [
  ...new Map(
    Object.values(RECRUIT_ROUTE_PAIRS).map((p) => [`${p.action}:${p.resourceType}`, p] as const),
  ).values(),
];

/** 4 key `companyFloor:false` — đúng bằng bảng pin ở `recruit-two-layer-guard-census.unit-spec.ts`. */
const EXEMPT_KEYS: readonly RecruitRouteKey[] = [
  "interviewList",
  "interviewDetail",
  "interviewFeedbackCreate",
  "interviewFeedbackUpdate",
];

interface Fixture {
  jobOpeningId: string;
  candidateId: string;
  offerId: string;
  orgUnitId: string;
  /**
   * Tệp CV do CHỦ THỂ `tCompany` upload+confirm, CHƯA gắn — dành riêng cho `candidateFileLink`.
   *
   * Không dùng `ghost()` được ở route đó: `FileService.link` hỏi resolver, resolver không tìm thấy tệp
   * ⇒ deny ⇒ **403**, làm mục B (`.not.toBe(403)`) đỏ vì lý do SAI (thiếu tệp, không phải thiếu sàn
   * scope). Tệp thật cũng làm mục B mạnh hơn: nó chứng minh đường GẮN chạy được ở scope Company.
   */
  linkableFileId: string;
}

interface RouteSpec {
  method: "GET" | "POST" | "PATCH";
  url: (f: Fixture) => string;
  /**
   * PHẢI qua ĐƯỢC pipe Zod (không chỉ "khác rỗng"): guard tier-1 (`@RequirePermission`) chạy TRƯỚC
   * pipe, nhưng sàn scope (tier-2, trong `RecruitAccessService.resolveActor`) nằm SAU pipe — body
   * thiếu field bắt buộc sẽ dừng ở 400 validation TRƯỚC KHI service kịp assert sàn, làm mục A xanh-
   * giả (đo được 2026-08-31: `{}` cho 4 route POST tạo mới ăn 400 chứ không phải 403 sàn). UUID
   * tham chiếu (`candidateId`/`orgUnitId`…) chỉ cần ĐÚNG HÌNH DẠNG — resolveActor luôn chạy TRƯỚC
   * mọi lookup DB trong service `create()`.
   */
  body?: (f: Fixture) => Record<string, unknown>;
  /** true = đường đọc, ALLOW đối chứng đòi ĐÚNG 200 (không chỉ "khác 403"). */
  read?: boolean;
}

const ghost = (): string => randomUUID();

/**
 * 28 route `companyFloor:true` — MỌI key trừ `EXEMPT_KEYS`. Body/URL mirror
 * `recruit-be1-scope.int-spec.ts` (cùng fixture "hình dạng" để không đổi hành vi ĐANG có, chỉ đổi
 * CHỦ THỂ đo được sàn scope).
 */
const ROUTES: Partial<Record<RecruitRouteKey, RouteSpec>> = {
  // ── Job openings 001–005 ──
  jobOpeningList: { method: "GET", url: () => "/job-openings", read: true },
  jobOpeningCreate: {
    method: "POST",
    url: () => "/job-openings",
    body: (f) => ({ title: "S12QA1 floor probe", orgUnitId: f.orgUnitId }),
  },
  jobOpeningDetail: {
    method: "GET",
    url: (f) => `/job-openings/${f.jobOpeningId}`,
    read: true,
  },
  jobOpeningUpdate: { method: "PATCH", url: () => `/job-openings/${ghost()}`, body: () => ({}) },
  jobOpeningChangeStatus: {
    method: "POST",
    url: () => `/job-openings/${ghost()}/change-status`,
    body: () => ({ toStatus: "Open" }),
  },
  // ── Candidates 006–017, 029 ──
  candidateList: { method: "GET", url: () => "/candidates", read: true },
  candidateCreate: {
    method: "POST",
    url: () => "/candidates",
    body: (f) => ({ jobOpeningId: f.jobOpeningId, fullName: "S12QA1 floor probe" }),
  },
  candidateCheckDuplicate: {
    method: "GET",
    url: () => "/candidates/check-duplicate?email=s12rqa1mat-checkdup@example.test",
    read: true,
  },
  candidateSummary: { method: "GET", url: () => "/candidates/summary", read: true },
  candidateExport: { method: "GET", url: () => "/candidates/export", read: true },
  candidateDetail: {
    method: "GET",
    url: (f) => `/candidates/${f.candidateId}`,
    read: true,
  },
  candidateUpdate: { method: "PATCH", url: () => `/candidates/${ghost()}`, body: () => ({}) },
  candidateMoveStage: {
    method: "POST",
    url: () => `/candidates/${ghost()}/move-stage`,
    body: () => ({ toStage: "Rejected", reason: "qa s12rqa1" }),
  },
  candidateStageEvents: {
    method: "GET",
    url: (f) => `/candidates/${f.candidateId}/stage-events`,
    read: true,
  },
  candidateNotesList: {
    method: "GET",
    url: (f) => `/candidates/${f.candidateId}/notes`,
    read: true,
  },
  candidateNoteCreate: {
    method: "POST",
    url: () => `/candidates/${ghost()}/notes`,
    body: () => ({ body: "ghi chu qa" }),
  },
  candidateNoteUpdate: {
    method: "PATCH",
    url: () => `/candidates/${ghost()}/notes/${ghost()}`,
    body: () => ({ body: "sua qa" }),
  },
  candidateConvert: {
    method: "POST",
    url: () => `/candidates/${ghost()}/convert`,
    body: () => ({}),
  },
  // ── Interviews (companyFloor:true — 3/7) ──
  interviewCreate: {
    method: "POST",
    url: () => "/interviews",
    body: (f) => ({
      candidateId: f.candidateId,
      startsAt: new Date(Date.now() + 3600_000).toISOString(),
      endsAt: new Date(Date.now() + 7200_000).toISOString(),
      participantEmployeeIds: [ghost()],
    }),
  },
  interviewUpdate: { method: "PATCH", url: () => `/interviews/${ghost()}`, body: () => ({}) },
  interviewChangeStatus: {
    method: "POST",
    url: () => `/interviews/${ghost()}/change-status`,
    body: () => ({ toStatus: "Completed" }),
  },
  // ── Offers 025–028, 030 ──
  offerList: { method: "GET", url: () => "/offers", read: true },
  offerCreate: {
    method: "POST",
    url: () => "/offers",
    body: (f) => ({
      candidateId: f.candidateId,
      startDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      salary: "1000.00",
    }),
  },
  offerUpdate: { method: "PATCH", url: () => `/offers/${ghost()}`, body: () => ({}) },
  offerChangeStatus: {
    method: "POST",
    url: () => `/offers/${ghost()}/change-status`,
    body: () => ({ toStatus: "Sent" }),
  },
  offerDetail: { method: "GET", url: (f) => `/offers/${f.offerId}`, read: true },
  // ── Pickers 031–032 ──
  pickerEmployees: { method: "GET", url: () => "/recruit/pickers/employees?limit=5", read: true },
  pickerRecruiterUsers: {
    method: "GET",
    url: () => "/recruit/pickers/recruiter-users?limit=5",
    read: true,
  },
  // ── Tệp CV 033–037 (S14-RECRUIT-FILEGRANT-1) ──
  // Cả 5 đều companyFloor:true. `resolveActor` chạy TRƯỚC mọi lookup DB nên `ghost()` ở `:fileId` đủ
  // cho mục A; mục B cần tệp THẬT ở route `link` (xem `Fixture.linkableFileId`).
  candidateFileList: {
    method: "GET",
    url: (f) => `/candidates/${f.candidateId}/files`,
    read: true,
  },
  candidateFileDownload: {
    method: "GET",
    url: (f) => `/candidates/${f.candidateId}/files/${ghost()}/download-url`,
  },
  candidateFileUploadUrl: {
    method: "POST",
    url: (f) => `/candidates/${f.candidateId}/files/upload-url`,
    // Body PHẢI qua được Zod `.strict()` — thiếu field dừng ở 400 TRƯỚC khi service assert sàn scope,
    // làm mục A xanh-giả (xem docblock `RouteSpec`).
    body: () => ({
      originalName: "cv-s12qa1.pdf",
      declaredMimeType: "application/pdf",
      sizeBytes: 1024,
    }),
  },
  candidateFileConfirm: {
    method: "POST",
    url: (f) => `/candidates/${f.candidateId}/files/${ghost()}/confirm`,
    body: () => ({}),
  },
  candidateFileLink: {
    method: "POST",
    url: (f) => `/candidates/${f.candidateId}/files/${f.linkableFileId}/link`,
    body: () => ({}),
  },
};

describe.skipIf(!hasLaneDb)("S12-RECRUIT-QA-1 sàn scope Company (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let tOwn = "";
  let tDept = "";
  let tCompany = "";
  let ownUserId = "";
  let ownEmployeeId = "";

  const fixture: Fixture = {
    jobOpeningId: "",
    candidateId: "",
    offerId: "",
    orgUnitId: "",
    linkableFileId: "",
  };
  let interviewOwnId = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));

  const exec = (spec: RouteSpec, t: string): request.Test => {
    const u = spec.url(fixture);
    const b = spec.body?.(fixture) ?? {};
    if (spec.method === "GET") return get(t, u);
    if (spec.method === "POST") return post(t, u).send(b);
    return patch(t, u).send(b);
  };

  /** Marker DUY NHẤT phân biệt sàn-scope với thiếu-cặp (xem docblock đầu file). */
  function expectScopeDenied(res: request.Response, label: string): void {
    expect(res.status, `${label} | ${JSON.stringify(res.body)}`).toBe(403);
    expect(
      res.body.error?.message,
      `${label} | thiếu marker AUTH-ERR-SCOPE-DENIED: ${JSON.stringify(res.body)}`,
    ).toContain("AUTH-ERR-SCOPE-DENIED");
  }

  async function grantAllPairs(
    userId: string,
    label: string,
    scope: "Own" | "Department" | "Company",
  ): Promise<void> {
    const roleId = await seedRole(direct, A.companyId, `s12rqa1-${label}`);
    for (const p of ALL_PAIRS) {
      const permId = await seedPermissionCatalog(direct, p.action, p.resourceType, p.isSensitive);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
  }

  async function login(email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function seedOrgUnit(name: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO org_units (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
      [A.companyId, name],
    );
    return r.rows[0].id as string;
  }

  async function seedEmployeeProfile(opts: {
    userId?: string | null;
    code: string;
  }): Promise<string> {
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, status, work_type, employee_code)
       VALUES ($1, $2, 'active', 'offline', $3) RETURNING id`,
      [A.companyId, opts.userId ?? null, opts.code],
    );
    return r.rows[0].id as string;
  }

  /** Candidate MỚI, dừng ĐÚNG ở stage 'Interview' — POST /interviews đòi đúng stage tại thời điểm tạo. */
  async function createInterviewReadyCandidate(label: string): Promise<string> {
    const job = await post(tCompany, "/job-openings").send({
      title: `Job ${label}`,
      orgUnitId: fixture.orgUnitId,
    });
    expect(job.status, JSON.stringify(job.body)).toBe(201);
    const cand = await post(tCompany, "/candidates").send({
      jobOpeningId: job.body.data.id,
      fullName: `Cand ${label}`,
    });
    expect(cand.status, JSON.stringify(cand.body)).toBe(201);
    const cid = cand.body.data.id as string;
    for (const toStage of ["Screening", "Interview"] as const) {
      const mv = await post(tCompany, `/candidates/${cid}/move-stage`).send({
        toStage,
        reason: "fixture s12rqa1",
      });
      expect(mv.status, JSON.stringify(mv.body)).toBe(201);
    }
    return cid;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s12rqa1mat");
    companyIds.push(A.companyId);

    // ── 3 chủ thể, ĐỦ 15 cặp, chỉ khác SCOPE ──
    const companyUser = await seedUser(direct, A.companyId, `company@${A.slug}.test`, hash);
    await grantAllPairs(companyUser, "company", "Company");
    tCompany = await login(`company@${A.slug}.test`);

    ownUserId = await seedUser(direct, A.companyId, `own@${A.slug}.test`, hash);
    await grantAllPairs(ownUserId, "own", "Own");
    tOwn = await login(`own@${A.slug}.test`);
    ownEmployeeId = await seedEmployeeProfile({ userId: ownUserId, code: "EMP-S12QA1-OWN" });

    const deptUser = await seedUser(direct, A.companyId, `dept@${A.slug}.test`, hash);
    await grantAllPairs(deptUser, "dept", "Department");
    tDept = await login(`dept@${A.slug}.test`);

    // ── Fixture đọc (qua API THẬT, chủ thể tCompany — giữ FK/counter đúng đường) ──
    fixture.orgUnitId = await seedOrgUnit("Engineering S12QA1");

    const job = await post(tCompany, "/job-openings").send({
      title: "Backend Engineer S12QA1",
      orgUnitId: fixture.orgUnitId,
      headcount: 1,
    });
    expect(job.status, JSON.stringify(job.body)).toBe(201);
    fixture.jobOpeningId = job.body.data.id;

    const cand = await post(tCompany, "/candidates").send({
      jobOpeningId: fixture.jobOpeningId,
      fullName: "Nguyen Van S12QA1",
      email: "candidate.s12qa1@example.test",
      phone: "0901234567",
    });
    expect(cand.status, JSON.stringify(cand.body)).toBe(201);
    fixture.candidateId = cand.body.data.id;

    for (const toStage of ["Screening", "Interview"] as const) {
      const mv = await post(tCompany, `/candidates/${fixture.candidateId}/move-stage`).send({
        toStage,
        reason: "tien do s12qa1",
      });
      expect(mv.status, JSON.stringify(mv.body)).toBe(201);
    }
    const mvOffer = await post(tCompany, `/candidates/${fixture.candidateId}/move-stage`).send({
      toStage: "Offer",
      reason: "tien toi offer s12qa1",
    });
    expect(mvOffer.status, JSON.stringify(mvOffer.body)).toBe(201);

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const offer = await post(tCompany, "/offers").send({
      candidateId: fixture.candidateId,
      startDate: tomorrow,
      salary: "1500.00",
    });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
    fixture.offerId = offer.body.data.id;

    // ── Fixture riêng cho mục C: candidate/interview với `ownEmployeeId` là participant THẬT ──
    const ownCandidateId = await createInterviewReadyCandidate("C-own");
    const iv = await post(tCompany, "/interviews").send({
      candidateId: ownCandidateId,
      startsAt: new Date(Date.now() + 3600_000).toISOString(),
      endsAt: new Date(Date.now() + 7200_000).toISOString(),
      participantEmployeeIds: [ownEmployeeId],
    });
    expect(iv.status, JSON.stringify(iv.body)).toBe(201);
    interviewOwnId = iv.body.data.id;

    // ── Tệp CV cho `candidateFileLink` (mục B): upload + confirm, CHƯA gắn ──
    // Leg "client PUT bytes" thay bằng UPDATE upload_status qua direct pool (không cần MinIO);
    // `owner_user_id` giữ nguyên giá trị FileService đặt — chính cột mà confirm + resolver soi.
    const reg = await post(tCompany, `/candidates/${fixture.candidateId}/files/upload-url`).send({
      originalName: "cv-s12qa1-fixture.pdf",
      declaredMimeType: "application/pdf",
      sizeBytes: 1024,
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    fixture.linkableFileId = reg.body.data.fileId as string;
    await direct.query(`UPDATE files SET upload_status = 'Uploaded' WHERE id = $1`, [
      fixture.linkableFileId,
    ]);
    const cf = await post(
      tCompany,
      `/candidates/${fixture.candidateId}/files/${fixture.linkableFileId}/confirm`,
    ).send({});
    expect(cf.status, JSON.stringify(cf.body)).toBe(200);
  }, 180_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── A. DENY — 28 route companyFloor:true, chủ thể Own ⇒ 403 + marker ──────────────────────────

  describe("A. companyFloor:true — chủ thể ĐỦ cặp nhưng scope Own ⇒ 403 AUTH-ERR-SCOPE-DENIED", () => {
    it.each(Object.keys(ROUTES) as RecruitRouteKey[])(
      "%s ⇒ 403 sàn scope cho chủ thể Own",
      (key) => {
        const spec = ROUTES[key]!;
        return exec(spec, tOwn).then((res) => expectScopeDenied(res, `${key} (${spec.method})`));
      },
    );
  });

  // ── B. ALLOW đối chứng — CÙNG request, chủ thể Company ⇒ KHÔNG 403 ───────────────────────────

  describe("B. ALLOW đối chứng cùng request ⇒ chủ thể Company KHÔNG 403 (đọc = đúng 200)", () => {
    it.each(Object.keys(ROUTES) as RecruitRouteKey[])(
      "%s ⇒ không 403 cho chủ thể Company",
      async (key) => {
        const spec = ROUTES[key]!;
        const res = await exec(spec, tCompany);
        expect(res.status, `${key} (${spec.method}) | ${JSON.stringify(res.body)}`).not.toBe(403);
        if (spec.read) {
          expect(res.status, `${key} (${spec.method}) | ${JSON.stringify(res.body)}`).toBe(200);
        }
      },
    );
  });

  // ── C. NGOẠI LỆ SÀN — 4 key companyFloor:false, chủ thể Own THẬT participant ─────────────────

  describe("C. companyFloor:false — participant Own KHÔNG bị scope-denied (200/201 thật)", () => {
    it("interviewList — GET /interviews (Own) ⇒ 200, thấy lượt mình tham gia", async () => {
      const res = await get(tOwn, "/interviews");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = res.body.data.map((i: { id: string }) => i.id);
      expect(ids).toContain(interviewOwnId);
    });

    it("interviewDetail — GET /interviews/:id (Own, participant) ⇒ 200", async () => {
      const res = await get(tOwn, `/interviews/${interviewOwnId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.id).toBe(interviewOwnId);
    });

    it("interviewFeedbackCreate — POST .../feedback (Own, participant, lượt Scheduled) ⇒ 201", async () => {
      const res = await post(tOwn, `/interviews/${interviewOwnId}/feedback`).send({
        rating: 4,
        recommendation: "Hire",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    it("interviewFeedbackUpdate — PATCH .../feedback (Own, sửa feedback CỦA MÌNH) ⇒ 200", async () => {
      const res = await patch(tOwn, `/interviews/${interviewOwnId}/feedback`).send({
        rating: 3,
        comment: "cap nhat s12qa1",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  });

  // ── D. Department cũng bị sàn chặn (sàn là Company, không phải "≥Own") ────────────────────────

  describe("D. Department (hẹp hơn Company) cũng bị sàn chặn — 1 route mỗi họ", () => {
    it("GET /job-openings (Department) ⇒ 403 AUTH-ERR-SCOPE-DENIED", async () => {
      expectScopeDenied(await get(tDept, "/job-openings"), "GET /job-openings @Department");
    });

    it("GET /candidates (Department) ⇒ 403 AUTH-ERR-SCOPE-DENIED", async () => {
      expectScopeDenied(await get(tDept, "/candidates"), "GET /candidates @Department");
    });

    it("GET /offers (Department) ⇒ 403 AUTH-ERR-SCOPE-DENIED", async () => {
      expectScopeDenied(await get(tDept, "/offers"), "GET /offers @Department");
    });
  });

  // ── E. Census chống xanh-rỗng ──────────────────────────────────────────────────────────────────

  describe("E. census — 33 key mục A ∪ 4 key mục C = ĐÚNG 37 key của RECRUIT_ROUTE_PAIRS", () => {
    it("RECRUIT_ROUTE_PAIRS giữ đủ 37 key (chốt chặn xanh-rỗng cho toàn bộ census)", () => {
      expect(Object.keys(RECRUIT_ROUTE_PAIRS).length).toBe(37);
    });

    it("ROUTES (mục A/B) có ĐÚNG 33 key, EXEMPT_KEYS (mục C) có ĐÚNG 4 key, hợp lại = 37 key", () => {
      const floorKeys = Object.keys(ROUTES).sort();
      expect(floorKeys.length).toBe(33);
      expect(EXEMPT_KEYS.length).toBe(4);
      const combined = [...floorKeys, ...EXEMPT_KEYS].sort();
      const allKeys = Object.keys(RECRUIT_ROUTE_PAIRS).sort();
      expect(
        combined,
        "ROUTES ∪ EXEMPT_KEYS lệch RECRUIT_ROUTE_PAIRS — route mới mọc lên chưa được xếp vào bảng",
      ).toEqual(allKeys);
    });

    it("mọi key trong ROUTES có companyFloor:true; mọi key trong EXEMPT_KEYS có companyFloor:false", () => {
      for (const key of Object.keys(ROUTES) as RecruitRouteKey[]) {
        expect(RECRUIT_ROUTE_PAIRS[key].companyFloor, `${key} phải companyFloor:true`).toBe(true);
      }
      for (const key of EXEMPT_KEYS) {
        expect(RECRUIT_ROUTE_PAIRS[key].companyFloor, `${key} phải companyFloor:false`).toBe(false);
      }
    });
  });
});
