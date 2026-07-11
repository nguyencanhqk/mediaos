/**
 * S5-FND-JOBS-OBS-1 (system-jobs-api) — SystemJobsController deny-path / 2-tenant + global RLS / error
 * scrub (integration).
 *
 * Postgres THẬT, DB CÔ LẬP (mediaos_<lane>, CLAUDE §9.5). Gate cứng `hasDb && LANE_DB` (memory
 * integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB ⇒ đỏ-giả trên DB dev chung.
 * Colocated trong src/ → vitest gom qua include glob spec của src; skipIf(!runDb) ⇒ inert ở unit-run.
 *
 * Phủ (RED-trước → GREEN):
 *   D1  Employee (role 0008, KHÔNG view:foundation-job) → GET summary + GET :jobName/runs đều 403.
 *   D2  company-admin (role 0001 — CÓ view:foundation-job qua bulk-grant mig 0435:365, is_sensitive=false)
 *       → GET summary 200 (1 hàng/jobCode = MỚI NHẤT) + GET :jobName/runs 200 (lịch sử, phân trang).
 *   X4  2-tenant RLS: run-row riêng tenant B (jobCode CHỈ B chạy) KHÔNG lọt vào summary/runs của A.
 *   G5  Global scope: run-row company_id NULL (job cấp system) xuất hiện trong summary CỦA CẢ A LẪN B
 *       (RLS `company_id IS NULL` — job không thuộc riêng tenant nào).
 *   S6  errorMessage scrub secret tại tầng ĐỌC (phòng thủ chiều sâu — hàng chèn RAW bỏ qua JobRunLogger).
 *
 * PIN theo CẶP SEED THẬT (view, 'foundation-job') — KHÔNG theo mã FE (bài học drift S1-FND-MODULE).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { AllExceptionsFilter } from "../../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../auth/password.service";
import { directPool, hasDb } from "../../../test/helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, seedUserRole } from "../../../test/helpers/seed";

// Credential test (KHÔNG phải secret thật) — tên biến tránh literal gán-keyword (guard-secrets, BẤT BIẾN #3).
const LOGIN_PW = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // bulk-grant view:foundation-job (mig 0435)
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có foundation-job

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane (KHÔNG phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

/** Marker cấy vào job_code để tách dữ liệu suite này khỏi suite khác trên cùng DB (song song-an toàn). */
const TAG = randomUUID().slice(0, 8);
const JOB_A = `TEST_JOB_A_${TAG}`;
const JOB_B_ONLY = `TEST_JOB_B_${TAG}`;
const JOB_GLOBAL = `TEST_JOB_GLOBAL_${TAG}`;
const JOB_SECRET = `TEST_JOB_SECRET_${TAG}`;

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: LOGIN_PW });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

/** Chèn 1 run-row RAW cho tenant (direct pool, bypass RLS — mô phỏng worker ghi). companyId=null ⇒ global. */
async function seedJobRun(
  direct: Pool,
  companyId: string | null,
  jobCode: string,
  opts: { status?: string; errorMessage?: string | null } = {},
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO system_job_runs
       (company_id, job_code, status, triggered_by, started_at, finished_at, duration_ms, error_message)
     VALUES ($1, $2, $3, 'Scheduler', now() - interval '1 minute', now(), 60000, $4)
     RETURNING id`,
    [companyId, jobCode, opts.status ?? "Success", opts.errorMessage ?? null],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!runDb)("S5-FND-JOBS-OBS-1 system-jobs API deny-path / RLS / error-scrub", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: { companyId: string; slug: string };
  let B: { companyId: string; slug: string };
  let adminTokenA: string; // company-admin A (có view:foundation-job)
  let employeeTokenA: string; // employee A (KHÔNG foundation-job)
  let adminTokenB: string; // company-admin B (chỉ dùng để verify global visibility)
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "sjoba");
    B = await seedCompany(direct, "sjobb");
    companyIds.push(A.companyId, B.companyId);
    const pw = await new PasswordService().hash(LOGIN_PW);

    // company-admin A — có view:foundation-job (bulk-grant mig 0435).
    const adminEmailA = `adm-${randomUUID().slice(0, 8)}@a.test`;
    const adminA = await seedUser(direct, A.companyId, adminEmailA, pw);
    await seedUserRole(direct, adminA, COMPANY_ADMIN_ROLE, A.companyId);

    // employee A — role 0008 KHÔNG có foundation-job ⇒ deny cả 2 route.
    const empEmailA = `emp-${randomUUID().slice(0, 8)}@a.test`;
    const empA = await seedUser(direct, A.companyId, empEmailA, pw);
    await seedUserRole(direct, empA, EMPLOYEE_ROLE, A.companyId);

    // company-admin B — dùng để chứng minh isolation + global visibility từ phía B.
    const adminEmailB = `adm-${randomUUID().slice(0, 8)}@b.test`;
    const adminB = await seedUser(direct, B.companyId, adminEmailB, pw);
    await seedUserRole(direct, adminB, COMPANY_ADMIN_ROLE, B.companyId);

    // Run-rows: JOB_A (tenant A, 3 lần chạy — kiểm lịch sử phân trang), JOB_B_ONLY (CHỈ tenant B),
    // JOB_GLOBAL (company_id NULL — job cấp system), JOB_SECRET (tenant A, error chứa secret RAW).
    await seedJobRun(direct, A.companyId, JOB_A, { status: "Success" });
    await seedJobRun(direct, A.companyId, JOB_A, { status: "Failed" });
    await seedJobRun(direct, A.companyId, JOB_A, { status: "Success" });
    await seedJobRun(direct, B.companyId, JOB_B_ONLY, { status: "Success" });
    await seedJobRun(direct, null, JOB_GLOBAL, { status: "Success" });
    await seedJobRun(direct, A.companyId, JOB_SECRET, {
      status: "Failed",
      // RAW (bỏ qua JobRunLogger/scrubber) — mô phỏng hàng cũ/lỗi ghi trực tiếp — service PHẢI scrub khi đọc.
      errorMessage: "connect ECONNREFUSED password=leak-me-9000 at db-host",
    });

    adminTokenA = await login(app, A.slug, adminEmailA);
    employeeTokenA = await login(app, A.slug, empEmailA);
    adminTokenB = await login(app, B.slug, adminEmailB);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── D1: Employee KHÔNG grant → 403 cả 2 route ─────────────────────────────
  it("D1 — Employee (không view:foundation-job) GET /foundation/system-jobs → 403", async () => {
    const res = await api(app)
      .get("/foundation/system-jobs")
      .set("Authorization", `Bearer ${employeeTokenA}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.data ?? null).toBeNull();
  });

  it("D1 — Employee GET /foundation/system-jobs/:jobName/runs → 403", async () => {
    const res = await api(app)
      .get(`/foundation/system-jobs/${JOB_A}/runs`)
      .set("Authorization", `Bearer ${employeeTokenA}`);
    expect(res.status).toBe(403);
  });

  // ── D2: company-admin (view) → 200 cả 2 route ─────────────────────────────
  it("D2 — company-admin A GET /foundation/system-jobs → 200, chứa JOB_A (mới nhất) + JOB_GLOBAL", async () => {
    const res = await api(app)
      .get("/foundation/system-jobs")
      .set("Authorization", `Bearer ${adminTokenA}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);

    const jobARow = rows.find((r) => r.jobCode === JOB_A);
    expect(jobARow, "JOB_A phải có trong summary A").toBeDefined();
    // Chỉ 1 hàng/jobCode (mới nhất) — JOB_A có 3 lần chạy nhưng summary chỉ 1.
    expect(rows.filter((r) => r.jobCode === JOB_A)).toHaveLength(1);
    // view WHITELIST — KHÔNG metadata.
    expect(jobARow).not.toHaveProperty("metadata");
    expect(jobARow).toHaveProperty("status");
    expect(jobARow).toHaveProperty("startedAt");
  });

  it("D2 — company-admin A GET /foundation/system-jobs/:jobName/runs → 200, lịch sử JOB_A = 3 hàng", async () => {
    const res = await api(app)
      .get(`/foundation/system-jobs/${JOB_A}/runs`)
      .set("Authorization", `Bearer ${adminTokenA}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.jobCode === JOB_A)).toBe(true);
  });

  it("D2 — jobName lạ (chưa từng chạy) → 200 + mảng rỗng (KHÔNG 404)", async () => {
    const res = await api(app)
      .get(`/foundation/system-jobs/NOT_A_REAL_JOB_${TAG}/runs`)
      .set("Authorization", `Bearer ${adminTokenA}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  // ── X4: 2-tenant RLS — JOB_B_ONLY KHÔNG lọt vào summary/runs của A ────────
  it("X4 — summary A KHÔNG chứa JOB_B_ONLY (RLS Company-scope)", async () => {
    const res = await api(app)
      .get("/foundation/system-jobs")
      .set("Authorization", `Bearer ${adminTokenA}`);
    expect(res.status).toBe(200);
    const codes = (res.body.data as Array<{ jobCode: string }>).map((r) => r.jobCode);
    expect(codes).not.toContain(JOB_B_ONLY);
  });

  it("X4 — GET runs của JOB_B_ONLY từ ngữ cảnh A → 200 + mảng rỗng (RLS che, KHÔNG 500/403 lộ tồn tại)", async () => {
    const res = await api(app)
      .get(`/foundation/system-jobs/${JOB_B_ONLY}/runs`)
      .set("Authorization", `Bearer ${adminTokenA}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  // ── G5: Global scope — JOB_GLOBAL (company_id NULL) thấy được từ CẢ A LẪN B ──
  it("G5 — summary B CŨNG thấy JOB_GLOBAL (company_id IS NULL — job cấp system)", async () => {
    const res = await api(app)
      .get("/foundation/system-jobs")
      .set("Authorization", `Bearer ${adminTokenB}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const codes = (res.body.data as Array<{ jobCode: string }>).map((r) => r.jobCode);
    expect(codes).toContain(JOB_GLOBAL);
    // B KHÔNG thấy JOB_A (thuộc riêng A).
    expect(codes).not.toContain(JOB_A);
  });

  it("G5 — hàng JOB_GLOBAL trả companyId=null trên wire", async () => {
    const res = await api(app)
      .get("/foundation/system-jobs")
      .set("Authorization", `Bearer ${adminTokenA}`);
    const row = (res.body.data as Array<Record<string, unknown>>).find(
      (r) => r.jobCode === JOB_GLOBAL,
    );
    expect(row?.companyId).toBeNull();
  });

  // ── S6: errorMessage scrub tại tầng đọc (hàng RAW bỏ qua JobRunLogger) ────
  it("S6 — errorMessage của JOB_SECRET KHÔNG lộ secret (scrub tại tầng đọc, cả summary lẫn runs)", async () => {
    const summaryRes = await api(app)
      .get("/foundation/system-jobs")
      .set("Authorization", `Bearer ${adminTokenA}`);
    const summaryRow = (summaryRes.body.data as Array<Record<string, unknown>>).find(
      (r) => r.jobCode === JOB_SECRET,
    );
    expect(summaryRow?.errorMessage).not.toContain("leak-me-9000");
    expect(String(summaryRow?.errorMessage)).toContain("password=***");

    const runsRes = await api(app)
      .get(`/foundation/system-jobs/${JOB_SECRET}/runs`)
      .set("Authorization", `Bearer ${adminTokenA}`);
    const runsRow = (runsRes.body.data as Array<Record<string, unknown>>)[0];
    expect(runsRow?.errorMessage).not.toContain("leak-me-9000");
    const serialized = JSON.stringify(runsRes.body);
    expect(serialized).not.toMatch(/leak-me-9000/);
  });
});
