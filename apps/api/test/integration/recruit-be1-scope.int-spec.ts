/**
 * S12-RECRUIT-BE-1 — ma trận quyền per-pair + masking + cross-tenant + own-scope (SPEC-12 §11 · §13.6 ·
 * §18 · permission-matrix §9f). Khuôn `s11-asset-qa1-permission-matrix.int-spec.ts` (A/B cùng request,
 * chủ thể dựng test — KHÔNG super-admin) + plan §4/§9.1.
 *
 * 15 cặp quyền có route (RECRUIT_ROUTE_PAIRS §5) — 7 cặp `candidate` là SENSITIVE (mig 0560): mọi
 * `seedPermissionCatalog` cho 7 cặp đó PHẢI truyền `isSensitive:true` (khác ASSET) — lệch cờ ⇒
 * `seedPermissionCatalog` NÉM (đai an toàn có sẵn ở helper, không phải test này tự canh).
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
const LOGIN_PW = "Passw0rd!recruitbe1";

type PairKey =
  | "view:job-opening"
  | "create:job-opening"
  | "update:job-opening"
  | "view:candidate"
  | "create:candidate"
  | "export:candidate"
  | "update:candidate"
  | "move-stage:candidate"
  | "comment:candidate"
  | "convert:candidate"
  | "view:interview"
  | "manage:interview"
  | "feedback:interview"
  | "view:offer"
  | "manage:offer";

/** 7 cặp `candidate` sensitive (mig 0560) — khác các cặp còn lại. */
const SENSITIVE_PAIRS: ReadonlySet<PairKey> = new Set<PairKey>([
  "view:candidate",
  "create:candidate",
  "export:candidate",
  "update:candidate",
  "move-stage:candidate",
  "comment:candidate",
  "convert:candidate",
]);

const ACCESS_PAIR: [string, string] = ["access", "recruit"];
const ROUTE_PAIRS: PairKey[] = [
  "view:job-opening",
  "create:job-opening",
  "update:job-opening",
  "view:candidate",
  "create:candidate",
  "export:candidate",
  "update:candidate",
  "move-stage:candidate",
  "comment:candidate",
  "convert:candidate",
  "view:interview",
  "manage:interview",
  "feedback:interview",
  "view:offer",
  "manage:offer",
];

describe.skipIf(!hasLaneDb)(
  "S12-RECRUIT-BE-1 ma trận quyền per-pair (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let tFull = "";
    const tMissing = new Map<PairKey, string>();

    // Fixture đọc (chủ thể `full` dựng qua API thật — giữ FK/counter đúng đường).
    let orgUnitId = "";
    let jobOpeningId = "";
    let candidateId = "";
    let interviewId = "";
    let offerId = "";
    let participantEmployeeId = "";

    const http = () => request(app.getHttpServer());
    const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
    const get = (t: string, u: string) => auth(t)(http().get(u));
    const post = (t: string, u: string) => auth(t)(http().post(u));
    const patch = (t: string, u: string) => auth(t)(http().patch(u));
    const ghost = () => randomUUID();

    async function seedOrgUnit(companyId: string, name: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO org_units (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [companyId, name],
      );
      return r.rows[0].id as string;
    }

    async function seedEmployeeProfile(
      companyId: string,
      opts: { userId?: string | null; code?: string } = {},
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, status, work_type, employee_code)
       VALUES ($1, $2, 'active', 'offline', $3) RETURNING id`,
        [companyId, opts.userId ?? null, opts.code ?? `EMP-${randomUUID().slice(0, 6)}`],
      );
      return r.rows[0].id as string;
    }

    async function grantPairs(userId: string, label: string, pairs: Array<[string, string]>) {
      const roleId = await seedRole(direct, A.companyId, `recruitbe1-${label}`);
      for (const [action, resource] of pairs) {
        const isSensitive = SENSITIVE_PAIRS.has(`${action}:${resource}` as PairKey);
        const permId = await seedPermissionCatalog(direct, action, resource, isSensitive);
        const scope = action === "access" ? "Own" : "Company";
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, A.companyId);
    }

    async function login(companySlug: string, email: string): Promise<string> {
      const res = await http().post("/auth/login").send({ companySlug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    /**
     * Candidate MỚI, dừng ĐÚNG ở stage 'Interview' — dùng riêng cho các khối cần tạo interview MỚI
     * sau khi `beforeAll` gốc đã đẩy `candidateId` chung đi tiếp lên 'Offer' (POST /interviews đòi
     * đúng stage 'Interview' tại THỜI ĐIỂM tạo — không thể tái dùng candidate đã qua khỏi mốc đó).
     */
    async function createInterviewReadyCandidate(label: string): Promise<string> {
      const job = await post(tFull, "/job-openings").send({ title: `Job ${label}`, orgUnitId });
      expect(job.status, JSON.stringify(job.body)).toBe(201);
      const cand = await post(tFull, "/candidates").send({
        jobOpeningId: job.body.data.id,
        fullName: `Cand ${label}`,
      });
      expect(cand.status, JSON.stringify(cand.body)).toBe(201);
      const cid = cand.body.data.id as string;
      for (const toStage of ["Screening", "Interview"] as const) {
        const mv = await post(tFull, `/candidates/${cid}/move-stage`).send({
          toStage,
          reason: "fixture interview-ready",
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
      A = await seedCompany(direct, "recruitbe1a");
      B = await seedCompany(direct, "recruitbe1b");
      companyIds.push(A.companyId, B.companyId);

      const allPairs: Array<[string, string]> = [
        ACCESS_PAIR,
        ...ROUTE_PAIRS.map((k) => k.split(":") as [string, string]),
      ];

      const fullUser = await seedUser(direct, A.companyId, `full@${A.slug}.test`, hash);
      await grantPairs(fullUser, "full", allPairs);
      tFull = await login(A.slug, `full@${A.slug}.test`);

      for (const missing of ROUTE_PAIRS) {
        const slug = missing.replace(":", "-");
        const email = `no-${slug}@${A.slug}.test`;
        const uid = await seedUser(direct, A.companyId, email, hash);
        await grantPairs(
          uid,
          `no-${slug}`,
          allPairs.filter(([a, r]) => `${a}:${r}` !== missing),
        );
        tMissing.set(missing, await login(A.slug, email));
      }

      // ── Fixture qua API thật (chủ thể full) ──
      orgUnitId = await seedOrgUnit(A.companyId, "Engineering QA");
      participantEmployeeId = await seedEmployeeProfile(A.companyId, { code: "EMP-FIX1" });

      const job = await post(tFull, "/job-openings").send({
        title: "Backend Engineer QA",
        orgUnitId,
        headcount: 2,
      });
      expect(job.status, JSON.stringify(job.body)).toBe(201);
      jobOpeningId = job.body.data.id;

      const cand = await post(tFull, "/candidates").send({
        jobOpeningId,
        fullName: "Nguyen Van QA",
        email: "candidate.qa@example.test",
        phone: "0901234567",
      });
      expect(cand.status, JSON.stringify(cand.body)).toBe(201);
      candidateId = cand.body.data.id;

      for (const toStage of ["Screening", "Interview"] as const) {
        const mv = await post(tFull, `/candidates/${candidateId}/move-stage`).send({
          toStage,
          reason: "tiến độ QA fixture",
        });
        expect(mv.status, `move ${toStage}: ${JSON.stringify(mv.body)}`).toBe(201);
      }

      const startsAt = new Date(Date.now() + 3600_000).toISOString();
      const endsAt = new Date(Date.now() + 7200_000).toISOString();
      const iv = await post(tFull, "/interviews").send({
        candidateId,
        startsAt,
        endsAt,
        participantEmployeeIds: [participantEmployeeId],
      });
      expect(iv.status, JSON.stringify(iv.body)).toBe(201);
      interviewId = iv.body.data.id;

      const mvOffer = await post(tFull, `/candidates/${candidateId}/move-stage`).send({
        toStage: "Offer",
        reason: "tiến tới offer QA fixture",
      });
      expect(mvOffer.status, JSON.stringify(mvOffer.body)).toBe(201);

      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const offer = await post(tFull, "/offers").send({
        candidateId,
        startDate: tomorrow,
        salary: "1500.00",
      });
      expect(offer.status, JSON.stringify(offer.body)).toBe(201);
      offerId = offer.body.data.id;
    }, 180_000);

    afterAll(async () => {
      if (direct) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ── Ma trận A/B (32 route × 15 cặp) ───────────────────────────────────────────────────────────
    type Row = { label: string; pair: PairKey; read?: boolean; exec: (t: string) => request.Test };

    const rows = (): Row[] => [
      // Job openings 001–005
      {
        label: "GET /job-openings",
        pair: "view:job-opening",
        read: true,
        exec: (t) => get(t, "/job-openings"),
      },
      {
        label: "POST /job-openings",
        pair: "create:job-opening",
        exec: (t) => post(t, "/job-openings").send({}),
      },
      {
        label: "GET /job-openings/:id",
        pair: "view:job-opening",
        read: true,
        exec: (t) => get(t, `/job-openings/${jobOpeningId}`),
      },
      {
        label: "PATCH /job-openings/:id",
        pair: "update:job-opening",
        exec: (t) => patch(t, `/job-openings/${ghost()}`).send({}),
      },
      {
        label: "POST /job-openings/:id/change-status",
        pair: "update:job-opening",
        exec: (t) => post(t, `/job-openings/${ghost()}/change-status`).send({ toStatus: "Open" }),
      },
      // Candidates 006–017, 029
      {
        label: "GET /candidates",
        pair: "view:candidate",
        read: true,
        exec: (t) => get(t, "/candidates"),
      },
      {
        label: "POST /candidates",
        pair: "create:candidate",
        exec: (t) => post(t, "/candidates").send({}),
      },
      {
        label: "GET /candidates/check-duplicate",
        pair: "create:candidate",
        read: true,
        exec: (t) => get(t, "/candidates/check-duplicate?email=candidate.qa@example.test"),
      },
      {
        label: "GET /candidates/summary",
        pair: "view:candidate",
        read: true,
        exec: (t) => get(t, "/candidates/summary"),
      },
      {
        label: "GET /candidates/export",
        pair: "export:candidate",
        read: true,
        exec: (t) => get(t, "/candidates/export"),
      },
      {
        label: "GET /candidates/:id",
        pair: "view:candidate",
        read: true,
        exec: (t) => get(t, `/candidates/${candidateId}`),
      },
      {
        label: "PATCH /candidates/:id",
        pair: "update:candidate",
        exec: (t) => patch(t, `/candidates/${ghost()}`).send({}),
      },
      {
        label: "POST /candidates/:id/move-stage",
        pair: "move-stage:candidate",
        exec: (t) =>
          post(t, `/candidates/${ghost()}/move-stage`).send({ toStage: "Rejected", reason: "qa" }),
      },
      {
        label: "GET /candidates/:id/stage-events",
        pair: "view:candidate",
        read: true,
        exec: (t) => get(t, `/candidates/${candidateId}/stage-events`),
      },
      {
        label: "GET /candidates/:id/notes",
        pair: "view:candidate",
        read: true,
        exec: (t) => get(t, `/candidates/${candidateId}/notes`),
      },
      {
        label: "POST /candidates/:id/notes",
        pair: "comment:candidate",
        exec: (t) => post(t, `/candidates/${ghost()}/notes`).send({ body: "ghi chu qa" }),
      },
      {
        label: "PATCH /candidates/:id/notes/:noteId",
        pair: "comment:candidate",
        exec: (t) => patch(t, `/candidates/${ghost()}/notes/${ghost()}`).send({ body: "sua qa" }),
      },
      {
        label: "POST /candidates/:id/convert",
        pair: "convert:candidate",
        exec: (t) => post(t, `/candidates/${ghost()}/convert`),
      },
      // Interviews 018–024
      {
        label: "GET /interviews",
        pair: "view:interview",
        read: true,
        exec: (t) => get(t, "/interviews"),
      },
      {
        label: "POST /interviews",
        pair: "manage:interview",
        exec: (t) => post(t, "/interviews").send({}),
      },
      {
        label: "GET /interviews/:id",
        pair: "view:interview",
        read: true,
        exec: (t) => get(t, `/interviews/${interviewId}`),
      },
      {
        label: "PATCH /interviews/:id",
        pair: "manage:interview",
        exec: (t) => patch(t, `/interviews/${ghost()}`).send({}),
      },
      {
        label: "POST /interviews/:id/change-status",
        pair: "manage:interview",
        exec: (t) =>
          post(t, `/interviews/${ghost()}/change-status`).send({ toStatus: "Completed" }),
      },
      {
        label: "POST /interviews/:id/feedback",
        pair: "feedback:interview",
        exec: (t) =>
          post(t, `/interviews/${ghost()}/feedback`).send({ rating: 4, recommendation: "Hire" }),
      },
      {
        label: "PATCH /interviews/:id/feedback",
        pair: "feedback:interview",
        exec: (t) => patch(t, `/interviews/${ghost()}/feedback`).send({ rating: 3 }),
      },
      // Offers 025–028, 030
      { label: "GET /offers", pair: "view:offer", read: true, exec: (t) => get(t, "/offers") },
      {
        label: "POST /offers",
        pair: "manage:offer",
        exec: (t) => post(t, "/offers").send({}),
      },
      {
        label: "PATCH /offers/:id",
        pair: "manage:offer",
        exec: (t) => patch(t, `/offers/${ghost()}`).send({}),
      },
      {
        label: "POST /offers/:id/change-status",
        pair: "manage:offer",
        exec: (t) => post(t, `/offers/${ghost()}/change-status`).send({ toStatus: "Sent" }),
      },
      {
        label: "GET /offers/:id",
        pair: "view:offer",
        read: true,
        exec: (t) => get(t, `/offers/${offerId}`),
      },
      // Pickers 031–032
      {
        label: "GET /recruit/pickers/employees",
        pair: "manage:interview",
        read: true,
        exec: (t) => get(t, "/recruit/pickers/employees?limit=5"),
      },
      {
        label: "GET /recruit/pickers/recruiter-users",
        pair: "update:job-opening",
        read: true,
        exec: (t) => get(t, "/recruit/pickers/recruiter-users?limit=5"),
      },
    ];

    describe("A. thiếu ĐÚNG một cặp ⇒ 403 trên đúng nhóm route của cặp đó", () => {
      it.each(rows().map((r) => [r.label, r.pair] as const))(
        "%s ⇒ 403 cho chủ thể thiếu %s",
        async (label, pair) => {
          const row = rows().find((r) => r.label === label)!;
          const token = tMissing.get(pair)!;
          const res = await row.exec(token);
          expect(res.status, `${label} | ${JSON.stringify(res.body)}`).toBe(403);
        },
      );
    });

    describe("B. ALLOW đối chứng cùng request ⇒ KHÔNG 403 (đọc = đúng 200)", () => {
      it.each(rows().map((r) => [r.label] as const))(
        "%s ⇒ không 403 cho chủ thể đủ quyền",
        async (label) => {
          const row = rows().find((r) => r.label === label)!;
          const res = await row.exec(tFull);
          expect(res.status, `${label} | ${JSON.stringify(res.body)}`).not.toBe(403);
          if (row.read) expect(res.status, `${label} | ${JSON.stringify(res.body)}`).toBe(200);
        },
      );

      it("candidates/export (010) đòi CẢ export lẫn view — thiếu 1 trong 2 ⇒ 403", async () => {
        const onlyExport = await tMissing.get("view:candidate")!;
        const onlyView = await tMissing.get("export:candidate")!;
        // no-view:candidate role vẫn CÓ export:candidate ⇒ 403 vì thiếu view (tầng 2 thứ hai).
        const r1 = await get(onlyExport, "/candidates/export");
        expect(r1.status, JSON.stringify(r1.body)).toBe(403);
        // no-export:candidate role vẫn CÓ view:candidate ⇒ 403 vì thiếu export (tầng 1/2 thứ nhất).
        const r2 = await get(onlyView, "/candidates/export");
        expect(r2.status, JSON.stringify(r2.body)).toBe(403);
        // full role có CẢ HAI ⇒ 200.
        const r3 = await get(tFull, "/candidates/export");
        expect(r3.status, JSON.stringify(r3.body)).toBe(200);
      });
    });

    // ── Cross-tenant → 404 (không 403) ────────────────────────────────────────────────────────────
    describe("Cross-tenant — company A không đọc được dữ liệu company B (404, không 403)", () => {
      let bJobId = "";
      let bCandidateId = "";
      let bInterviewId = "";
      let bOfferId = "";

      beforeAll(async () => {
        const hash = await new PasswordService().hash(LOGIN_PW);
        const bUser = await seedUser(direct, B.companyId, `full@${B.slug}.test`, hash);
        const allPairs: Array<[string, string]> = [
          ACCESS_PAIR,
          ...ROUTE_PAIRS.map((k) => k.split(":") as [string, string]),
        ];
        const roleId = await seedRole(direct, B.companyId, "recruitbe1-b-full");
        for (const [action, resource] of allPairs) {
          const isSensitive = SENSITIVE_PAIRS.has(`${action}:${resource}` as PairKey);
          const permId = await seedPermissionCatalog(direct, action, resource, isSensitive);
          await seedRolePermission(
            direct,
            roleId,
            permId,
            "ALLOW",
            action === "access" ? "Own" : "Company",
          );
        }
        await seedUserRole(direct, bUser, roleId, B.companyId);
        const bToken = await login(B.slug, `full@${B.slug}.test`);

        const bOrgUnit = await seedOrgUnit(B.companyId, "B org");
        const bJob = await post(bToken, "/job-openings").send({
          title: "B Job",
          orgUnitId: bOrgUnit,
        });
        bJobId = bJob.body.data.id;
        const bEmployee = await seedEmployeeProfile(B.companyId, { code: "EMP-B1" });
        const bCand = await post(bToken, "/candidates").send({
          jobOpeningId: bJobId,
          fullName: "B Candidate",
        });
        bCandidateId = bCand.body.data.id;
        for (const toStage of ["Screening", "Interview"] as const) {
          await post(bToken, `/candidates/${bCandidateId}/move-stage`).send({
            toStage,
            reason: "b tenant qa",
          });
        }
        const bIv = await post(bToken, "/interviews").send({
          candidateId: bCandidateId,
          startsAt: new Date(Date.now() + 3600_000).toISOString(),
          endsAt: new Date(Date.now() + 7200_000).toISOString(),
          participantEmployeeIds: [bEmployee],
        });
        bInterviewId = bIv.body.data.id;
        await post(bToken, `/candidates/${bCandidateId}/move-stage`).send({
          toStage: "Offer",
          reason: "b tenant to offer",
        });
        const bOffer = await post(bToken, "/offers").send({
          candidateId: bCandidateId,
          startDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
          salary: "2000.00",
        });
        bOfferId = bOffer.body.data.id;
      }, 60_000);

      it.each([
        ["job-opening", () => `/job-openings/${bJobId}`] as const,
        ["candidate", () => `/candidates/${bCandidateId}`] as const,
        ["interview", () => `/interviews/${bInterviewId}`] as const,
        ["offer", () => `/offers/${bOfferId}`] as const,
      ])("A đọc %s của B ⇒ 404 (không 403)", async (_label, path) => {
        const res = await get(tFull, path());
        expect(res.status, JSON.stringify(res.body)).toBe(404);
      });
    });

    // ── Masking PII email/phone (006/010/011/018/020) ─────────────────────────────────────────────
    describe("Masking PII candidate — update:candidate thấy nguyên, view-only thấy che", () => {
      let tViewOnly = "";

      beforeAll(async () => {
        const hash = await new PasswordService().hash(LOGIN_PW);
        const uid = await seedUser(direct, A.companyId, `view-only-pii@${A.slug}.test`, hash);
        await grantPairs(uid, "view-only-pii", [
          ["view", "candidate"],
          ["view", "interview"],
          ["export", "candidate"],
        ]);
        tViewOnly = await login(A.slug, `view-only-pii@${A.slug}.test`);
      });

      it("006 list — update:candidate thấy email/phone nguyên, piiMasked:false", async () => {
        const res = await get(tFull, "/candidates");
        expect(res.status).toBe(200);
        const row = res.body.data.find((c: { id: string }) => c.id === candidateId);
        expect(row.email).toBe("candidate.qa@example.test");
        expect(row.piiMasked).toBe(false);
      });

      it("006 list — view-only thấy email/phone CHE, piiMasked:true", async () => {
        const res = await get(tViewOnly, "/candidates");
        expect(res.status).toBe(200);
        const row = res.body.data.find((c: { id: string }) => c.id === candidateId);
        expect(row.email).not.toContain("candidate.qa@example.test");
        expect(row.piiMasked).toBe(true);
      });

      it("011 detail — update:candidate thấy nguyên; view-only thấy che", async () => {
        const full = await get(tFull, `/candidates/${candidateId}`);
        expect(full.body.data.email).toBe("candidate.qa@example.test");
        expect(full.body.data.piiMasked).toBe(false);

        const masked = await get(tViewOnly, `/candidates/${candidateId}`);
        expect(masked.status).toBe(200);
        expect(masked.body.data.email).not.toContain("candidate.qa@example.test");
        expect(masked.body.data.piiMasked).toBe(true);
      });

      it("010 export — update:candidate thấy nguyên; view-only (có export+view) thấy che", async () => {
        const full = await get(tFull, "/candidates/export");
        const fullRow = full.body.data.find((c: { id: string }) => c.id === candidateId);
        expect(fullRow.email).toBe("candidate.qa@example.test");

        const masked = await get(tViewOnly, "/candidates/export");
        expect(masked.status, JSON.stringify(masked.body)).toBe(200);
        const maskedRow = masked.body.data.find((c: { id: string }) => c.id === candidateId);
        expect(maskedRow.email).not.toContain("candidate.qa@example.test");
        expect(maskedRow.piiMasked).toBe(true);
      });

      it("008 check-duplicate — KHÔNG BAO GIỜ lộ email/phone, bất kể quyền", async () => {
        const res = await get(tFull, "/candidates/check-duplicate?email=candidate.qa@example.test");
        expect(res.status).toBe(200);
        for (const row of res.body.data) {
          expect(row).not.toHaveProperty("email");
          expect(row).not.toHaveProperty("phone");
        }
      });

      it("018/020 embed candidate trong interview — CHỈ {id,fullName,stage}, KHÔNG email/phone/source/note", async () => {
        const list = await get(tViewOnly, "/interviews");
        expect(list.status, JSON.stringify(list.body)).toBe(200);
        const iv = list.body.data.find((i: { id: string }) => i.id === interviewId);
        expect(iv.candidate).toEqual({
          id: candidateId,
          fullName: "Nguyen Van QA",
          stage: expect.any(String),
        });
        expect(iv.candidate).not.toHaveProperty("email");
        expect(iv.candidate).not.toHaveProperty("phone");
        expect(iv.candidate).not.toHaveProperty("source");
        expect(iv.candidate).not.toHaveProperty("note");

        const detail = await get(tViewOnly, `/interviews/${interviewId}`);
        expect(detail.status, JSON.stringify(detail.body)).toBe(200);
        expect(detail.body.data.candidate).not.toHaveProperty("email");
        expect(detail.body.data.candidate).not.toHaveProperty("phone");
      });
    });

    // ── Masking salary (025/030) ───────────────────────────────────────────────────────────────────
    describe("Masking salary offer — manage:offer thấy khoá `salary`, view-only VẮNG khoá", () => {
      let tViewOfferOnly = "";

      beforeAll(async () => {
        const hash = await new PasswordService().hash(LOGIN_PW);
        const uid = await seedUser(direct, A.companyId, `view-only-offer@${A.slug}.test`, hash);
        await grantPairs(uid, "view-only-offer", [["view", "offer"]]);
        tViewOfferOnly = await login(A.slug, `view-only-offer@${A.slug}.test`);
      });

      it("030 detail — manage:offer thấy salary; view-only VẮNG khoá (không null)", async () => {
        const full = await get(tFull, `/offers/${offerId}`);
        expect(full.body.data).toHaveProperty("salary");
        expect(full.body.data.salary).toBe("1500.00");

        const viewOnly = await get(tViewOfferOnly, `/offers/${offerId}`);
        expect(viewOnly.status, JSON.stringify(viewOnly.body)).toBe(200);
        expect(viewOnly.body.data).not.toHaveProperty("salary");
      });

      it("025 list — manage:offer thấy salary; view-only VẮNG khoá", async () => {
        const full = await get(tFull, "/offers");
        const fullRow = full.body.data.find((o: { id: string }) => o.id === offerId);
        expect(fullRow).toHaveProperty("salary");

        const viewOnly = await get(tViewOfferOnly, "/offers");
        expect(viewOnly.status).toBe(200);
        const row = viewOnly.body.data.find((o: { id: string }) => o.id === offerId);
        expect(row).not.toHaveProperty("salary");
      });
    });

    // ── Wildcard `*:*` — chống bypass masking ─────────────────────────────────────────────────────
    describe("Wildcard *:* KHÔNG mở khoá PII candidate; VẪN mở khoá salary offer (§4.4/§4.5)", () => {
      let tWildcardOnly = "";
      let tWildcardWithExactView = "";

      beforeAll(async () => {
        const hash = await new PasswordService().hash(LOGIN_PW);

        // Role CHỈ có ('*','*')@Company — không cặp nào khác.
        const uidWildcardOnly = await seedUser(
          direct,
          A.companyId,
          `wildcard-only@${A.slug}.test`,
          hash,
        );
        const roleWildcardOnly = await seedRole(direct, A.companyId, "recruitbe1-wildcard-only");
        const wildcardPermId = await seedPermissionCatalog(direct, "*", "*", false);
        await seedRolePermission(direct, roleWildcardOnly, wildcardPermId, "ALLOW", "Company");
        await seedUserRole(direct, uidWildcardOnly, roleWildcardOnly, A.companyId);
        tWildcardOnly = await login(A.slug, `wildcard-only@${A.slug}.test`);

        // Role có view:candidate EXACT (đủ qua tầng 2 — bản thân route đó CŨNG sensitive) + ('*','*') —
        // KHÔNG có update:candidate exact ⇒ mask vẫn khoá dù có wildcard rộng cạnh.
        const uidWildExact = await seedUser(
          direct,
          A.companyId,
          `wildcard-plus-view@${A.slug}.test`,
          hash,
        );
        const roleWildExact = await seedRole(direct, A.companyId, "recruitbe1-wildcard-plus-view");
        const viewCandPerm = await seedPermissionCatalog(direct, "view", "candidate", true);
        await seedRolePermission(direct, roleWildExact, viewCandPerm, "ALLOW", "Company");
        const wildcardPermId2 = await seedPermissionCatalog(direct, "*", "*", false);
        await seedRolePermission(direct, roleWildExact, wildcardPermId2, "ALLOW", "Company");
        await seedUserRole(direct, uidWildExact, roleWildExact, A.companyId);
        tWildcardWithExactView = await login(A.slug, `wildcard-plus-view@${A.slug}.test`);
      });

      it("candidate: cặp `view:candidate` là SENSITIVE ⇒ role CHỈ có `*:*` bị 403 NGAY Ở TẦNG GATE (không tới được mapper) — wildcard không thoả cổng cặp nhạy cảm ngay từ route-scope, không chỉ ở cờ masking", async () => {
        const res = await get(tWildcardOnly, `/candidates/${candidateId}`);
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("candidate: role có view:candidate EXACT + `*:*` rộng cạnh ⇒ GET detail 200 nhưng PII VẪN CHE (piiMasked:true) — wildcard không unlock cờ update:candidate", async () => {
        const res = await get(tWildcardWithExactView, `/candidates/${candidateId}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.email).not.toContain("candidate.qa@example.test");
        expect(res.body.data.piiMasked).toBe(true);
      });

      it("offer: `manage:offer` KHÔNG sensitive ⇒ role CHỈ có `*:*` VẪN thấy `salary` (permission-matrix §9f:569 — offer KHÔNG nằm trong 7 cặp sensitive)", async () => {
        const res = await get(tWildcardOnly, `/offers/${offerId}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data).toHaveProperty("salary");
        expect(res.body.data.salary).toBe("1500.00");
      });
    });

    // ── Interview Own-scope (participant) ─────────────────────────────────────────────────────────
    describe("Interview Own-scope — manager chỉ thấy lượt mình tham gia", () => {
      let tManager = "";
      let managerUserId = "";
      let managerEmployeeId = "";
      let interviewId2 = "";

      beforeAll(async () => {
        const hash = await new PasswordService().hash(LOGIN_PW);
        managerUserId = await seedUser(direct, A.companyId, `manager-own@${A.slug}.test`, hash);
        managerEmployeeId = await seedEmployeeProfile(A.companyId, {
          userId: managerUserId,
          code: "EMP-MGR1",
        });
        const roleId = await seedRole(direct, A.companyId, "recruitbe1-manager-own");
        const viewInterviewPerm = await seedPermissionCatalog(direct, "view", "interview", false);
        await seedRolePermission(direct, roleId, viewInterviewPerm, "ALLOW", "Own");
        await seedUserRole(direct, managerUserId, roleId, A.companyId);
        tManager = await login(A.slug, `manager-own@${A.slug}.test`);

        // Interview I1 = participantEmployeeId gốc; tạo I2 KHÔNG có manager là participant — dùng
        // candidate RIÊNG (candidate chung đã qua khỏi stage 'Interview' ở beforeAll gốc).
        const otherEmployee = await seedEmployeeProfile(A.companyId, { code: "EMP-OTHER1" });
        const cid2 = await createInterviewReadyCandidate("Interview Own I2");
        const iv2 = await post(tFull, "/interviews").send({
          candidateId: cid2,
          startsAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
          endsAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
          participantEmployeeIds: [otherEmployee],
        });
        expect(iv2.status, JSON.stringify(iv2.body)).toBe(201);
        interviewId2 = iv2.body.data.id;

        // Thêm manager vào interviewId gốc (fixture chính) qua INSERT trực tiếp participants (chỉ-INSERT).
        await direct.query(
          `INSERT INTO interview_participants (company_id, interview_id, employee_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
          [A.companyId, interviewId, managerEmployeeId],
        );
      });

      it("GET /interviews (Own) thấy lượt MÌNH tham gia, KHÔNG thấy lượt khác", async () => {
        const res = await get(tManager, "/interviews");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const ids = res.body.data.map((i: { id: string }) => i.id);
        expect(ids).toContain(interviewId);
        expect(ids).not.toContain(interviewId2);
      });

      it("GET /interviews/:id với lượt KHÔNG tham gia ⇒ 404 RECRUIT-ERR-010", async () => {
        const res = await get(tManager, `/interviews/${interviewId2}`);
        expect(res.status, JSON.stringify(res.body)).toBe(404);
        expect(res.body.error.code).toBe("RECRUIT-ERR-010");
      });

      it("GET /interviews/:id với lượt MÌNH tham gia ⇒ 200", async () => {
        const res = await get(tManager, `/interviews/${interviewId}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.id).toBe(interviewId);
      });
    });

    // ── Feedback 010 vs 011 (chống mã chết §4.3) ──────────────────────────────────────────────────
    describe("Feedback own-scope — 3 ca DENY tách bạch 010/011 + 1 ca ALLOW", () => {
      let tCompanyViewOwnFeedback = "";
      let tOwnViewOwnFeedback = "";
      let tOnlyFeedbackOwn = "";
      let tParticipant = "";
      let participantForAllowId = "";
      let interviewForFeedback = "";
      let interviewOutsideOwn = "";

      beforeAll(async () => {
        const hash = await new PasswordService().hash(LOGIN_PW);

        // (i) view:interview@Company + feedback:interview@Own, KHÔNG participant ⇒ 403 011.
        const u1 = await seedUser(direct, A.companyId, `fb-company-view@${A.slug}.test`, hash);
        const r1 = await seedRole(direct, A.companyId, "recruitbe1-fb-company-view");
        const viewPerm = await seedPermissionCatalog(direct, "view", "interview", false);
        const fbPerm = await seedPermissionCatalog(direct, "feedback", "interview", false);
        await seedRolePermission(direct, r1, viewPerm, "ALLOW", "Company");
        await seedRolePermission(direct, r1, fbPerm, "ALLOW", "Own");
        await seedUserRole(direct, u1, r1, A.companyId);
        tCompanyViewOwnFeedback = await login(A.slug, `fb-company-view@${A.slug}.test`);

        // (ii) view:interview@Own + feedback:interview@Own, KHÔNG participant của lượt cụ thể ⇒ 404 010.
        const u2 = await seedUser(direct, A.companyId, `fb-own-view@${A.slug}.test`, hash);
        const emp2 = await seedEmployeeProfile(A.companyId, { userId: u2, code: "EMP-FB2" });
        const r2 = await seedRole(direct, A.companyId, "recruitbe1-fb-own-view");
        await seedRolePermission(direct, r2, viewPerm, "ALLOW", "Own");
        await seedRolePermission(direct, r2, fbPerm, "ALLOW", "Own");
        await seedUserRole(direct, u2, r2, A.companyId);
        tOwnViewOwnFeedback = await login(A.slug, `fb-own-view@${A.slug}.test`);

        // (iii) CHỈ feedback:interview@Own, KHÔNG view:interview nào ⇒ 404 010.
        const u3 = await seedUser(direct, A.companyId, `fb-only@${A.slug}.test`, hash);
        const r3 = await seedRole(direct, A.companyId, "recruitbe1-fb-only");
        await seedRolePermission(direct, r3, fbPerm, "ALLOW", "Own");
        await seedUserRole(direct, u3, r3, A.companyId);
        tOnlyFeedbackOwn = await login(A.slug, `fb-only@${A.slug}.test`);

        // ALLOW — participant thật.
        const u4 = await seedUser(direct, A.companyId, `fb-participant@${A.slug}.test`, hash);
        participantForAllowId = await seedEmployeeProfile(A.companyId, {
          userId: u4,
          code: "EMP-FB4",
        });
        const r4 = await seedRole(direct, A.companyId, "recruitbe1-fb-participant");
        await seedRolePermission(direct, r4, viewPerm, "ALLOW", "Own");
        await seedRolePermission(direct, r4, fbPerm, "ALLOW", "Own");
        await seedUserRole(direct, u4, r4, A.companyId);
        tParticipant = await login(A.slug, `fb-participant@${A.slug}.test`);

        // Lượt riêng cho khối feedback — candidate RIÊNG, dừng ở 'Interview' (candidate chung đã
        // qua khỏi mốc đó ở beforeAll gốc); CẢ HAI lượt dùng CÙNG candidate vì tạo interview không
        // đổi stage — an toàn tạo nhiều lượt liên tiếp trên cùng một candidate 'Interview'.
        const fbCandidateId = await createInterviewReadyCandidate("Feedback Own");
        const ivFb = await post(tFull, "/interviews").send({
          candidateId: fbCandidateId,
          startsAt: new Date(Date.now() + 10 * 3600_000).toISOString(),
          endsAt: new Date(Date.now() + 11 * 3600_000).toISOString(),
          participantEmployeeIds: [participantForAllowId],
        });
        expect(ivFb.status, JSON.stringify(ivFb.body)).toBe(201);
        interviewForFeedback = ivFb.body.data.id;

        // Lượt riêng NGOÀI own-scope của u2 (emp2 KHÔNG tham gia).
        const ivOutside = await post(tFull, "/interviews").send({
          candidateId: fbCandidateId,
          startsAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
          endsAt: new Date(Date.now() + 13 * 3600_000).toISOString(),
          participantEmployeeIds: [participantEmployeeId],
        });
        expect(ivOutside.status, JSON.stringify(ivOutside.body)).toBe(201);
        interviewOutsideOwn = ivOutside.body.data.id;
        void emp2;
      });

      it("(i) view:interview@Company + feedback@Own, KHÔNG participant ⇒ 403 RECRUIT-ERR-011", async () => {
        const res = await post(
          tCompanyViewOwnFeedback,
          `/interviews/${interviewForFeedback}/feedback`,
        ).send({
          rating: 4,
          recommendation: "Hire",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(res.body.error.code).toBe("RECRUIT-ERR-011");
      });

      it("(ii) view:interview@Own + feedback@Own, lượt NGOÀI own-scope ⇒ 404 RECRUIT-ERR-010", async () => {
        const res = await post(
          tOwnViewOwnFeedback,
          `/interviews/${interviewOutsideOwn}/feedback`,
        ).send({
          rating: 4,
          recommendation: "Hire",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(404);
        expect(res.body.error.code).toBe("RECRUIT-ERR-010");
      });

      it("(iii) CHỈ feedback@Own, KHÔNG view:interview nào ⇒ 404 RECRUIT-ERR-010 (chống mã chết)", async () => {
        const res = await post(
          tOnlyFeedbackOwn,
          `/interviews/${interviewForFeedback}/feedback`,
        ).send({
          rating: 4,
          recommendation: "Hire",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(404);
        expect(res.body.error.code).toBe("RECRUIT-ERR-010");
      });

      it("ALLOW — participant thật POST feedback ⇒ 201", async () => {
        const res = await post(tParticipant, `/interviews/${interviewForFeedback}/feedback`).send({
          rating: 5,
          comment: "tot",
          recommendation: "Hire",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
      });
    });

    // ── Caller KHÔNG có employee_profiles (M3) ────────────────────────────────────────────────────
    describe("Caller KHÔNG có employee_profiles — Own rỗng, feedback 404 (fail-closed)", () => {
      let tNoProfile = "";

      beforeAll(async () => {
        const hash = await new PasswordService().hash(LOGIN_PW);
        const uid = await seedUser(direct, A.companyId, `no-profile@${A.slug}.test`, hash);
        const roleId = await seedRole(direct, A.companyId, "recruitbe1-no-profile");
        const viewPerm = await seedPermissionCatalog(direct, "view", "interview", false);
        const fbPerm = await seedPermissionCatalog(direct, "feedback", "interview", false);
        await seedRolePermission(direct, roleId, viewPerm, "ALLOW", "Own");
        await seedRolePermission(direct, roleId, fbPerm, "ALLOW", "Own");
        await seedUserRole(direct, uid, roleId, A.companyId);
        tNoProfile = await login(A.slug, `no-profile@${A.slug}.test`);
      });

      it("GET /interviews (Own, KHÔNG employee_profile) ⇒ 200 rỗng", async () => {
        const res = await get(tNoProfile, "/interviews");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data).toEqual([]);
      });

      it("POST feedback (KHÔNG employee_profile) ⇒ 404 RECRUIT-ERR-010", async () => {
        const res = await post(tNoProfile, `/interviews/${interviewId}/feedback`).send({
          rating: 3,
          recommendation: "Consider",
        });
        expect(res.status, JSON.stringify(res.body)).toBe(404);
        expect(res.body.error.code).toBe("RECRUIT-ERR-010");
      });
    });

    // ── `access:recruit` = cổng NAV, KHÔNG gác API ────────────────────────────────────────────────
    describe("access:recruit = cổng nav DUY NHẤT (không route RECRUIT nào gate bằng nó)", () => {
      it("/auth/me capabilities chứa `access:recruit` khi được cấp", async () => {
        const res = await get(tFull, "/auth/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.capabilities["access:recruit"]).toBe(true);
      });
    });
  },
);
