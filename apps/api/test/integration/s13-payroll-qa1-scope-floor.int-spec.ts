/**
 * S13-PAYROLL-QA-1 — SÀN SCOPE COMPANY (`companyFloor`) của PAYROLL, ĐO TRÊN TỪNG ROUTE
 * (SPEC-11 §11.1 · §13.5 · permission-matrix §9g). Khuôn `s12-recruit-qa1-permission-matrix.int-spec.ts`.
 *
 * LỖ ĐO ĐƯỢC 2026-09-01 (không phải phỏng đoán). Tầng-2 `PayrollAccessService.resolveActor`
 * (`payroll-access.service.ts:56-60`) từ chối **32/35 route** khi actor GIỮ ĐÚNG cặp quyền nhưng ở
 * scope HẸP HƠN Company. Bề mặt test hiện có đo được đúng **2** route trong số đó:
 *   · `payroll-be2-permission.int-spec.ts:378` — `view-line` @Department trên `/lines` và `/summary`;
 *   · `payroll-be1-scope.int-spec.ts` mục A–E — chỉ đo "THIẾU cặp hoàn toàn" (403 `AUTH-ERR-FORBIDDEN`),
 *     CHƯA từng đo "có đủ cặp nhưng SAI TẦNG SCOPE" (403 `AUTH-ERR-SCOPE-DENIED`).
 * ⇒ 30 route còn lại chưa ai chứng minh sàn có thật. Một lần đổi `data_scope` per-pair (hoặc một
 * route mới quên gọi `resolveActor`) sẽ âm thầm nới quyền đọc bảng lương toàn công ty cho grant hẹp.
 *
 * VÌ SAO PHẢI ĐO MARKER, KHÔNG CHỈ STATUS. `PayrollAccessService` ném
 * `new ForbiddenException("AUTH-ERR-SCOPE-DENIED: …")` — chuỗi TRẦN, KHÔNG bọc `{code,…}`.
 * `AllExceptionsFilter#resolve` chỉ tin `payload.code` khi caller đặt tường minh; thiếu nó thì rơi về
 * generic `httpStatusToCode(403) = "AUTH-ERR-FORBIDDEN"` ở `error.code` — CHO CẢ HAI loại 403. Marker
 * duy nhất phân biệt hai đường là chuỗi `"AUTH-ERR-SCOPE-DENIED"` trong `error.message` (status < 500
 * nên message KHÔNG bị che). Assert theo `error.code` sẽ XANH dù route trả nhầm loại 403 — đúng kiểu
 * "test đóng đinh lỗ hổng" (memory `tests-can-pin-a-hole-open`).
 *
 * PHÉP ĐO = A/B CÙNG REQUEST, CHỈ ĐỔI CHỦ THỂ:
 *   · `tOwn`      giữ ĐỦ 16 cặp có route của `PAYROLL_ROUTE_PAIRS` ở scope **Own**;
 *   · `tDept`     giữ ĐỦ 16 cặp ở scope **Department** (sàn là Company, KHÔNG phải "≥ Own");
 *   · `tCompany`  giữ ĐỦ 16 cặp ở scope **Company** — ALLOW đối chứng + dựng fixture qua API thật.
 *
 *   A. 32 route `companyFloor:true` — `tOwn` ⇒ 403 + marker `AUTH-ERR-SCOPE-DENIED`.
 *   B. CÙNG 32 request, CHỈ đổi chủ thể sang `tCompany` ⇒ KHÔNG 403 (đường đọc = ĐÚNG 200).
 *      Thiếu vế này thì một guard luôn-403 (hoặc một path gõ sai) cũng làm cả mục A xanh
 *      (`deny-cases-vacuous-without-allow-case`).
 *   C. 3 route `companyFloor:false` (`/me/payslips*`) — `tOwn` là CHỦ phiếu THẬT ⇒ 200/201 thật,
 *      KHÔNG bị scope-denied. Đây là vế chứng minh sàn KHÔNG bị bật nhầm cho khối ME (nhân viên
 *      403 trên phiếu của chính mình = lỗi ship được, xem JSDoc `PayrollPair`).
 *   D. `Department` (không chỉ `Own`) cũng bị sàn chặn — 1 route mỗi họ đối tượng.
 *   E. Census chống xanh-rỗng: 32 key mục A ∪ 3 key mục C = ĐÚNG 35 key của `PAYROLL_ROUTE_PAIRS`,
 *      so tập HAI CHIỀU + đối chiếu từng cờ `companyFloor` với chính bảng hằng.
 *
 * KHÔNG GÂY TÁC DỤNG PHỤ: route GHI bắn vào UUID KHÔNG TỒN TẠI (hoặc body trỏ tới id ma) ⇒ qua guard
 * rồi dừng ở service (404/409), không tạo dữ liệu rác cho các ca sau.
 *
 * ⚠️ BODY PHẢI QUA ĐƯỢC ZOD, không chỉ "khác rỗng": guard tier-1 (`@RequirePermission`) chạy TRƯỚC
 * pipe, nhưng sàn scope (tier-2, trong `resolveActor`) nằm SAU pipe — body thiếu field bắt buộc sẽ
 * dừng ở 400 validation TRƯỚC KHI service kịp assert sàn. Mục A chính là cổng bắt lỗi đó: nó đòi
 * ĐÚNG 403, nên một body hỏng làm ca đó ĐỎ chứ không xanh-giả.
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
  PAYROLL_ROUTE_PAIRS,
  type PayrollRouteKey,
} from "../../src/payroll/payroll-route-pairs.const";
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
const LOGIN_PW = loginPasswordFixture("s13payrollqa1");

/**
 * Cặp DISTINCT của `PAYROLL_ROUTE_PAIRS` (dedupe theo `"action:resource"`), GIỮ NGUYÊN cờ
 * `isSensitive` — nguồn sự thật DUY NHẤT cho cả ba chủ thể, không gõ lại literal ở đây.
 * `('access','payroll')` KHÔNG có trong bảng (cổng nav khối ME, không gác route nào) nên không seed.
 */
const ALL_PAIRS: ReadonlyArray<{ action: string; resourceType: string; isSensitive: boolean }> = [
  ...new Map(
    Object.values(PAYROLL_ROUTE_PAIRS).map((p) => [`${p.action}:${p.resourceType}`, p] as const),
  ).values(),
];

/** 3 key `companyFloor:false` — mục C. Đối chiếu lại với bảng hằng ở mục E. */
const EXEMPT_KEYS: readonly PayrollRouteKey[] = [
  "mePayslipList",
  "mePayslipDetail",
  "mePayslipAck",
];

interface Fixture {
  periodId: string;
  lineId: string;
  payslipId: string;
  salaryProfileId: string;
  bonusPenaltyId: string;
}

interface RouteSpec {
  method: "GET" | "POST" | "PATCH";
  url: (f: Fixture) => string;
  body?: (f: Fixture) => Record<string, unknown>;
  /** true = đường đọc ⇒ ALLOW đối chứng đòi ĐÚNG 200 (không chỉ "khác 403"). */
  read?: boolean;
}

const ghost = (): string => randomUUID();

/** 32 route `companyFloor:true` — MỌI key trừ `EXEMPT_KEYS`. */
const ROUTES: Partial<Record<PayrollRouteKey, RouteSpec>> = {
  // ── Kỳ lương 001–018 ────────────────────────────────────────────────────────────────────────
  periodList: { method: "GET", url: () => "/payroll-periods", read: true },
  periodCreate: {
    method: "POST",
    url: () => "/payroll-periods",
    // `attendancePeriodId` MA ⇒ service dừng ở 404 sentinel, KHÔNG tạo kỳ rác (BE-1 ca 010).
    body: () => ({ periodMonth: "2029-03", attendancePeriodId: ghost() }),
  },
  periodDetail: { method: "GET", url: (f) => `/payroll-periods/${f.periodId}`, read: true },
  periodUpdate: {
    method: "PATCH",
    url: () => `/payroll-periods/${ghost()}`,
    body: () => ({ note: "qa s13 floor probe" }),
  },
  periodCollect: { method: "POST", url: () => `/payroll-periods/${ghost()}/collect` },
  periodReadiness: {
    method: "GET",
    url: (f) => `/payroll-periods/${f.periodId}/readiness`,
    read: true,
  },
  periodCalculate: { method: "POST", url: () => `/payroll-periods/${ghost()}/calculate` },
  periodLines: { method: "GET", url: (f) => `/payroll-periods/${f.periodId}/lines`, read: true },
  periodAdjustLine: {
    method: "PATCH",
    url: () => `/payroll-periods/${ghost()}/lines/${ghost()}`,
    // `adjustmentAmount: 0` ⇒ `adjustmentReason` KHÔNG bắt buộc (superRefine ở contracts).
    body: () => ({ adjustmentAmount: 0 }),
  },
  periodSubmit: { method: "POST", url: () => `/payroll-periods/${ghost()}/submit` },
  periodApprove: { method: "POST", url: () => `/payroll-periods/${ghost()}/approve` },
  periodReject: {
    method: "POST",
    url: () => `/payroll-periods/${ghost()}/reject`,
    body: () => ({ reason: "qa s13 floor probe" }),
  },
  periodGeneratePayslips: {
    method: "POST",
    url: () => `/payroll-periods/${ghost()}/generate-payslips`,
  },
  periodPublish: { method: "POST", url: () => `/payroll-periods/${ghost()}/publish` },
  periodLock: { method: "POST", url: () => `/payroll-periods/${ghost()}/lock` },
  periodReopen: {
    method: "POST",
    url: () => `/payroll-periods/${ghost()}/reopen`,
    body: () => ({ reason: "qa s13 floor probe" }),
  },
  periodExport: { method: "GET", url: (f) => `/payroll-periods/${f.periodId}/export`, read: true },
  periodSummary: { method: "GET", url: () => "/payroll-periods/summary", read: true },
  // ── Hồ sơ lương 019–022 ─────────────────────────────────────────────────────────────────────
  salaryProfileList: { method: "GET", url: () => "/salary-profiles", read: true },
  salaryProfileCreate: {
    method: "POST",
    url: () => "/salary-profiles",
    body: () => ({ userId: ghost(), effectiveDate: "2029-03-01", baseSalary: 1_000_000 }),
  },
  salaryProfileDetail: {
    method: "GET",
    url: (f) => `/salary-profiles/${f.salaryProfileId}`,
    read: true,
  },
  salaryProfileUpdate: {
    method: "PATCH",
    url: () => `/salary-profiles/${ghost()}`,
    body: () => ({ note: "qa s13 floor probe" }),
  },
  // ── Thưởng/phạt 023–028 ─────────────────────────────────────────────────────────────────────
  bonusPenaltyList: { method: "GET", url: () => "/bonus-penalties", read: true },
  bonusPenaltyCreate: {
    method: "POST",
    url: () => "/bonus-penalties",
    body: () => ({
      userId: ghost(),
      kind: "bonus",
      amount: 500_000,
      periodMonth: "2029-03",
      reason: "qa s13 floor probe",
    }),
  },
  bonusPenaltyDetail: {
    method: "GET",
    url: (f) => `/bonus-penalties/${f.bonusPenaltyId}`,
    read: true,
  },
  bonusPenaltyUpdate: {
    method: "PATCH",
    url: () => `/bonus-penalties/${ghost()}`,
    body: () => ({ reason: "qa s13 floor probe" }),
  },
  bonusPenaltyApprove: {
    method: "POST",
    url: () => `/bonus-penalties/${ghost()}/approve`,
    body: () => ({}),
  },
  bonusPenaltyReject: {
    method: "POST",
    url: () => `/bonus-penalties/${ghost()}/reject`,
    body: () => ({ decisionNote: "qa s13 floor probe" }),
  },
  // ── Phiếu lương của NGƯỜI KHÁC 029–030 ──────────────────────────────────────────────────────
  payslipList: { method: "GET", url: () => "/payslips", read: true },
  payslipDetail: { method: "GET", url: (f) => `/payslips/${f.payslipId}`, read: true },
  // ── Picker 034–035 ──────────────────────────────────────────────────────────────────────────
  pickerPeople: { method: "GET", url: () => "/payroll/pickers/people", read: true },
  pickerAttendancePeriods: {
    method: "GET",
    url: () => "/payroll/pickers/attendance-periods",
    read: true,
  },
};

describe.skipIf(!hasLaneDb)("S13-PAYROLL-QA-1 · sàn scope Company per-route (32 + 3)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let tCompany: string;
  let tOwn: string;
  let tDept: string;
  let ownUserId: string;

  const fixture: Fixture = {
    periodId: "",
    lineId: "",
    payslipId: "",
    salaryProfileId: "",
    bonusPenaltyId: "",
  };

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
      res.body?.error?.message,
      `${label} | thiếu marker AUTH-ERR-SCOPE-DENIED: ${JSON.stringify(res.body)}`,
    ).toContain("AUTH-ERR-SCOPE-DENIED");
  }

  async function grantAllPairs(
    userId: string,
    label: string,
    scope: "Own" | "Department" | "Company",
  ): Promise<void> {
    const roleId = await seedRole(direct, A.companyId, `s13pqa1-${label}`);
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s13pqa1floor");
    companyIds.push(A.companyId);
    await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
      A.companyId,
      JSON.stringify({ days: [1, 2, 3, 4, 5] }),
    ]);

    // ── 3 chủ thể, ĐỦ 16 cặp, CHỈ khác SCOPE ──────────────────────────────────────────────────
    const companyUserId = await seedUser(direct, A.companyId, `company@${A.slug}.test`, hash);
    await grantAllPairs(companyUserId, "company", "Company");
    tCompany = await login(`company@${A.slug}.test`);

    ownUserId = await seedUser(direct, A.companyId, `own@${A.slug}.test`, hash);
    await grantAllPairs(ownUserId, "own", "Own");
    tOwn = await login(`own@${A.slug}.test`);

    const deptUserId = await seedUser(direct, A.companyId, `dept@${A.slug}.test`, hash);
    await grantAllPairs(deptUserId, "dept", "Department");
    tDept = await login(`dept@${A.slug}.test`);

    // ── Fixture: `ownUserId` CHÍNH LÀ chủ phiếu lương (mục C cần phiếu THẬT của tOwn) ──────────
    const sp = await direct.query<{ id: string }>(
      `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances)
       VALUES ($1, $2, '2028-01-01', '10000000.00', '[]'::jsonb) RETURNING id`,
      [A.companyId, ownUserId],
    );
    fixture.salaryProfileId = sp.rows[0].id;

    const ap = await direct.query<{ id: string }>(
      `INSERT INTO attendance_periods (company_id, period_month, status)
       VALUES ($1, '2028-06', 'locked') RETURNING id`,
      [A.companyId],
    );

    const p = await post(tCompany, "/payroll-periods").send({
      periodMonth: "2028-06",
      attendancePeriodId: ap.rows[0].id,
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    fixture.periodId = p.body.data.id as string;

    expect((await post(tCompany, `/payroll-periods/${fixture.periodId}/collect`)).status).toBe(201);
    expect((await post(tCompany, `/payroll-periods/${fixture.periodId}/calculate`)).status).toBe(
      201,
    );
    const lines = await get(tCompany, `/payroll-periods/${fixture.periodId}/lines`);
    expect(lines.status, JSON.stringify(lines.body)).toBe(200);
    fixture.lineId = (lines.body.data as Array<{ id: string }>)[0].id;

    const bp = await post(tCompany, "/bonus-penalties").send({
      userId: ownUserId,
      kind: "bonus",
      amount: 250_000,
      periodMonth: "2028-07",
      reason: "fixture s13pqa1 floor",
    });
    expect(bp.status, JSON.stringify(bp.body)).toBe(201);
    fixture.bonusPenaltyId = bp.body.data.id as string;

    // ⚠️ `submitted_by` PHẢI khác `approved_by`: CHECK `payroll_periods_four_eyes_check` sống ở DB
    // và khoá cả FIXTURE, không chỉ khoá đường API (`db-invariant-kills-adversarial-fixtures`).
    await direct.query(
      `UPDATE payroll_periods SET status = 'Approved',
         submitted_by = $2, submitted_at = now(), approved_by = $3, approved_at = now()
       WHERE id = $1`,
      [fixture.periodId, ownUserId, companyUserId],
    );
    expect(
      (await post(tCompany, `/payroll-periods/${fixture.periodId}/generate-payslips`)).status,
    ).toBe(201);
    expect((await post(tCompany, `/payroll-periods/${fixture.periodId}/publish`)).status).toBe(201);

    const payslips = await get(tCompany, `/payslips?payrollPeriodId=${fixture.periodId}`);
    expect(payslips.status, JSON.stringify(payslips.body)).toBe(200);
    expect(
      (payslips.body.data as unknown[]).length,
      "fixture phải sinh ĐÚNG 1 phiếu (chỉ `ownUserId` có hồ sơ lương)",
    ).toBe(1);
    fixture.payslipId = (payslips.body.data as Array<{ id: string }>)[0].id;
  }, 300_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── A. DENY — 32 route companyFloor:true, chủ thể Own ⇒ 403 + marker ─────────────────────────

  describe("A. companyFloor:true — chủ thể ĐỦ cặp nhưng scope Own ⇒ 403 AUTH-ERR-SCOPE-DENIED", () => {
    it.each(Object.keys(ROUTES) as PayrollRouteKey[])("%s ⇒ 403 sàn scope (Own)", async (key) => {
      const spec = ROUTES[key]!;
      expectScopeDenied(await exec(spec, tOwn), `${key} (${spec.method})`);
    });
  });

  // ── B. ALLOW đối chứng — CÙNG request, chủ thể Company ⇒ KHÔNG 403 ───────────────────────────

  describe("B. ALLOW đối chứng cùng request ⇒ chủ thể Company KHÔNG 403 (đọc = đúng 200)", () => {
    it.each(Object.keys(ROUTES) as PayrollRouteKey[])("%s ⇒ không 403 (Company)", async (key) => {
      const spec = ROUTES[key]!;
      const res = await exec(spec, tCompany);
      expect(res.status, `${key} (${spec.method}) | ${JSON.stringify(res.body)}`).not.toBe(403);
      if (spec.read) {
        expect(res.status, `${key} (${spec.method}) | ${JSON.stringify(res.body)}`).toBe(200);
      }
    });
  });

  // ── C. NGOẠI LỆ SÀN — 3 route /me/payslips*, chủ thể Own là CHỦ phiếu thật ───────────────────

  describe("C. companyFloor:false — chủ phiếu ở scope Own KHÔNG bị scope-denied (200/201 thật)", () => {
    it("mePayslipList — GET /me/payslips (Own) ⇒ 200, thấy phiếu của chính mình", async () => {
      const res = await get(tOwn, "/me/payslips");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((x) => x.id);
      expect(ids, "phiếu của chính mình phải nằm trong danh sách").toContain(fixture.payslipId);
    });

    it("mePayslipDetail — GET /me/payslips/:id (Own, phiếu CỦA MÌNH) ⇒ 200", async () => {
      const res = await get(tOwn, `/me/payslips/${fixture.payslipId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.id).toBe(fixture.payslipId);
    });

    it("mePayslipAck — POST /me/payslips/:id/acknowledge (Own) ⇒ 201", async () => {
      const res = await post(tOwn, `/me/payslips/${fixture.payslipId}/acknowledge`);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });
  });

  // ── D. Department cũng bị sàn chặn (sàn là Company, KHÔNG phải "≥ Own") ──────────────────────

  describe("D. Department (hẹp hơn Company) cũng bị sàn chặn — 1 route mỗi họ đối tượng", () => {
    it("GET /payroll-periods (Department) ⇒ 403 AUTH-ERR-SCOPE-DENIED", async () => {
      expectScopeDenied(await get(tDept, "/payroll-periods"), "GET /payroll-periods @Department");
    });

    it("GET /salary-profiles (Department) ⇒ 403 AUTH-ERR-SCOPE-DENIED", async () => {
      expectScopeDenied(await get(tDept, "/salary-profiles"), "GET /salary-profiles @Department");
    });

    it("GET /bonus-penalties (Department) ⇒ 403 AUTH-ERR-SCOPE-DENIED", async () => {
      expectScopeDenied(await get(tDept, "/bonus-penalties"), "GET /bonus-penalties @Department");
    });

    it("GET /payslips (Department) ⇒ 403 AUTH-ERR-SCOPE-DENIED", async () => {
      expectScopeDenied(await get(tDept, "/payslips"), "GET /payslips @Department");
    });

    it("GET /payroll/pickers/people (Department) ⇒ 403 AUTH-ERR-SCOPE-DENIED", async () => {
      expectScopeDenied(
        await get(tDept, "/payroll/pickers/people"),
        "GET /payroll/pickers/people @Department",
      );
    });
  });

  // ── F. Route 017 export — lỗi phát TỪ TRONG handler vẫn phải là JSON envelope ────────────────

  /**
   * PHÁT HIỆN 2026-09-01 (đã vá trong CÙNG WO). `@Header("Content-Type", …xlsx)` được Nest áp NGAY
   * TRƯỚC khi gọi handler ⇒ mọi lỗi phát từ TRONG handler đi ra với thân JSON nhưng **nhãn XLSX**
   * (`res.json()` của Express không ghi đè Content-Type đã có). Ba ca dưới ghim cả hai vế: đường LỖI
   * phải `application/json` + đọc được `error.code`, đường THÀNH CÔNG phải giữ nhãn XLSX + attachment.
   *
   * Vì sao KHÔNG đủ nếu chỉ đo `status`: 401 (từ guard, chạy TRƯỚC bước áp header) vẫn đúng nhãn, nên
   * bug này vô hình với mọi ca cũ — `payroll-be2-permission.int-spec.ts:436` đo export nhưng chỉ đo
   * `status`, và mục A của chính file này lúc đầu đỏ vì `res.body` là `{}` chứ không phải vì sai status.
   */
  describe("F. 017 export — nhãn Content-Type theo ĐƯỜNG ĐI (lỗi = JSON, thành công = XLSX)", () => {
    it("403 sàn scope trên export ⇒ Content-Type application/json + đọc được error.message", async () => {
      const res = await get(tOwn, `/payroll-periods/${fixture.periodId}/export`);
      expect(res.status).toBe(403);
      expect(
        res.headers["content-type"],
        `lỗi export phải mang nhãn JSON, đang là: ${res.headers["content-type"]}`,
      ).toMatch(/application\/json/);
      expect(res.body?.error?.message).toContain("AUTH-ERR-SCOPE-DENIED");
    });

    it("404 sentinel trên export (kỳ KHÔNG tồn tại) ⇒ JSON + PAYROLL-ERR-010", async () => {
      const res = await get(tCompany, `/payroll-periods/${ghost()}/export`);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body?.error?.code).toBe("PAYROLL-ERR-010");
    });

    it("ALLOW đối chứng — export THÀNH CÔNG vẫn là XLSX + attachment (fix không phá đường chính)", async () => {
      const res = await get(tCompany, `/payroll-periods/${fixture.periodId}/export`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("spreadsheetml.sheet");
      expect(res.headers["content-disposition"]).toContain("attachment;");
    });
  });

  // ── E. Census chống xanh-rỗng ────────────────────────────────────────────────────────────────

  describe("E. census — 32 key mục A ∪ 3 key mục C = ĐÚNG 35 key của PAYROLL_ROUTE_PAIRS", () => {
    it("PAYROLL_ROUTE_PAIRS giữ đủ 35 key (neo cho toàn bộ census)", () => {
      expect(Object.keys(PAYROLL_ROUTE_PAIRS).length).toBe(35);
    });

    it("ROUTES = 32 key, EXEMPT_KEYS = 3 key, hợp lại KHỚP HAI CHIỀU bảng hằng", () => {
      const floorKeys = Object.keys(ROUTES).sort();
      expect(floorKeys.length).toBe(32);
      expect(EXEMPT_KEYS.length).toBe(3);
      expect(
        [...floorKeys, ...EXEMPT_KEYS].sort(),
        "ROUTES ∪ EXEMPT_KEYS lệch PAYROLL_ROUTE_PAIRS — route mới mọc lên chưa được xếp vào bảng",
      ).toEqual(Object.keys(PAYROLL_ROUTE_PAIRS).sort());
    });

    it("mọi key ROUTES có companyFloor:true; mọi key EXEMPT_KEYS có companyFloor:false", () => {
      for (const key of Object.keys(ROUTES) as PayrollRouteKey[]) {
        expect(PAYROLL_ROUTE_PAIRS[key].companyFloor, `${key} phải companyFloor:true`).toBe(true);
      }
      for (const key of EXEMPT_KEYS) {
        expect(PAYROLL_ROUTE_PAIRS[key].companyFloor, `${key} phải companyFloor:false`).toBe(false);
      }
    });

    it("16 cặp distinct có route được seed cho cả ba chủ thể (không cặp nào rơi khỏi fixture)", () => {
      // `('access','payroll')` KHÔNG gác route nào ⇒ 17 cặp SPEC-11 §11.1 nhưng 16 cặp có route.
      expect(ALL_PAIRS.length).toBe(16);
      const sensitiveCount = ALL_PAIRS.filter((p) => p.isSensitive).length;
      // ĐÚNG 13 cặp `is_sensitive` của mig `0565` — cả 13 đều có route, `('access','payroll')` là
      // cặp thứ 17 KHÔNG nhạy cảm và KHÔNG gác route nào (đo lại 2026-09-01 trên chính bảng hằng).
      expect(sensitiveCount, "cờ isSensitive phải lấy NGUYÊN từ bảng hằng, không gõ tay").toBe(13);
    });
  });
});
