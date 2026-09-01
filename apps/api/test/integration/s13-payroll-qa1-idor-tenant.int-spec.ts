/**
 * S13-PAYROLL-QA-1 — IDOR liên-nhân-sự trên phiếu lương + cô lập 2-tenant trên **17 route của BE-2**
 * (SPEC-11 §12 · §13.5 · §18 · BẤT BIẾN #1).
 *
 * LỖ ĐO ĐƯỢC 2026-09-01:
 *  · `payroll-be1-scope.int-spec.ts` mục D2/D4 đã đo cross-tenant nhưng CHỈ trên 18 route của BE-1.
 *  · `payroll-be2-lifecycle.int-spec.ts` có dựng company B — nhưng dùng cho kịch bản
 *    «công ty 0 nhân sự đủ điều kiện» (`A5`), **không** assert cross-tenant trên route nào của BE-2.
 *    ⇒ 17 route BE-2 (dòng lương · điều chỉnh · export · summary · 9 action FSM · phiếu) CHƯA ai
 *    chứng minh là không đọc/ghi được đối tượng của tenant khác.
 *  · IDOR liên-nhân-sự mới có ĐÚNG MỘT ca (`payroll-be2-lifecycle` E3, `/me/payslips/:id`). Đường
 *    `acknowledge` (033 — đường GHI) và vế «danh sách của tôi không rò phiếu người khác» chưa ai đo,
 *    và chưa ai so BẰNG NHAU ba nguồn 404 nên chưa loại được **oracle tồn tại**.
 *
 * A. **CROSS-TENANT 2-tenant thật.** Actor của A giữ ĐỦ 16 cặp @Company, bắn id của B trên 20 route
 *    có định danh đối tượng ⇒ **404 `PAYROLL-ERR-010`**, KHÔNG 403 (403 tự nó là oracle: nó nói
 *    "vật này có thật, bạn không đủ quyền"), KHÔNG 5xx.
 * B. **KHÔNG CÓ ORACLE TỒN TẠI.** Trên cùng route, ba nguồn 404 — id của B · id bịa · id đã xoá mềm —
 *    phải cho **cùng một hình dạng phản hồi** (so `status` + `error.code` + `error.message`).
 * C. **IDOR liên-nhân-sự trong CÙNG company.** Nhân viên X chỉ giữ 3 cặp Own của khối ME:
 *    · `/me/payslips` KHÔNG chứa phiếu của Y;   · `/me/payslips/{Y}` ⇒ 404 sentinel;
 *    · `/me/payslips/{Y}/acknowledge` ⇒ 404 (đường GHI, không được 409 «đã xác nhận»);
 *    · `/payslips/{Y}` ⇒ **403** — khối ME không phải cửa sau vào cặp `view-payslip`;
 *    · ALLOW đối chứng: chính phiếu của X ⇒ 200 + acknowledge 201.
 * D. **Ghi cross-tenant KHÔNG được để lại vết.** Sau cả mục A, hàng kỳ của B phải NGUYÊN trạng thái
 *    và 0 dòng/0 phiếu mới — 404 mà vẫn ghi được là lỗ tệ hơn cả 200.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
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
import { PAYROLL_ROUTE_PAIRS } from "../../src/payroll/payroll-route-pairs.const";
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
const LOGIN_PW = loginPasswordFixture("s13payrollqa1idor");

/** Bộ id của MỘT tenant — mục A bắn bộ của B bằng token của A. */
interface TenantRefs {
  periodId: string;
  lineId: string;
  payslipId: string;
  salaryProfileId: string;
  bonusPenaltyId: string;
}

interface ObjRoute {
  code: string;
  method: "GET" | "POST" | "PATCH";
  path: (r: TenantRefs) => string;
  body?: Record<string, unknown>;
  /** Đường GHI — mục D kiểm "404 nhưng KHÔNG để lại vết". */
  write?: boolean;
}

/** 20 route có định danh đối tượng (18 BE-2 + 2 BE-1 để so hình dạng cùng họ). */
const OBJ_ROUTES: readonly ObjRoute[] = [
  { code: "003 periodDetail", method: "GET", path: (r) => `/payroll-periods/${r.periodId}` },
  {
    code: "004 periodUpdate",
    method: "PATCH",
    path: (r) => `/payroll-periods/${r.periodId}`,
    body: { note: "qa idor" },
    write: true,
  },
  {
    code: "005 collect",
    method: "POST",
    path: (r) => `/payroll-periods/${r.periodId}/collect`,
    write: true,
  },
  {
    code: "006 readiness",
    method: "GET",
    path: (r) => `/payroll-periods/${r.periodId}/readiness`,
  },
  {
    code: "007 calculate",
    method: "POST",
    path: (r) => `/payroll-periods/${r.periodId}/calculate`,
    write: true,
  },
  { code: "008 lines", method: "GET", path: (r) => `/payroll-periods/${r.periodId}/lines` },
  {
    code: "009 adjustLine",
    method: "PATCH",
    path: (r) => `/payroll-periods/${r.periodId}/lines/${r.lineId}`,
    body: { adjustmentAmount: 0 },
    write: true,
  },
  {
    code: "010 submit",
    method: "POST",
    path: (r) => `/payroll-periods/${r.periodId}/submit`,
    write: true,
  },
  {
    code: "011 approve",
    method: "POST",
    path: (r) => `/payroll-periods/${r.periodId}/approve`,
    write: true,
  },
  {
    code: "012 reject",
    method: "POST",
    path: (r) => `/payroll-periods/${r.periodId}/reject`,
    body: { reason: "qa idor" },
    write: true,
  },
  {
    code: "013 generatePayslips",
    method: "POST",
    path: (r) => `/payroll-periods/${r.periodId}/generate-payslips`,
    write: true,
  },
  {
    code: "014 publish",
    method: "POST",
    path: (r) => `/payroll-periods/${r.periodId}/publish`,
    write: true,
  },
  {
    code: "015 lock",
    method: "POST",
    path: (r) => `/payroll-periods/${r.periodId}/lock`,
    write: true,
  },
  {
    code: "016 reopen",
    method: "POST",
    path: (r) => `/payroll-periods/${r.periodId}/reopen`,
    body: { reason: "qa idor" },
    write: true,
  },
  { code: "017 export", method: "GET", path: (r) => `/payroll-periods/${r.periodId}/export` },
  {
    code: "021 salaryProfileDetail",
    method: "GET",
    path: (r) => `/salary-profiles/${r.salaryProfileId}`,
  },
  {
    code: "022 salaryProfileUpdate",
    method: "PATCH",
    path: (r) => `/salary-profiles/${r.salaryProfileId}`,
    body: { note: "qa idor" },
    write: true,
  },
  {
    code: "025 bonusPenaltyDetail",
    method: "GET",
    path: (r) => `/bonus-penalties/${r.bonusPenaltyId}`,
  },
  { code: "030 payslipDetail", method: "GET", path: (r) => `/payslips/${r.payslipId}` },
  { code: "032 mePayslipDetail", method: "GET", path: (r) => `/me/payslips/${r.payslipId}` },
];

describe.skipIf(!hasLaneDb)("S13-PAYROLL-QA-1 · IDOR phiếu lương + cô lập 2-tenant (BE-2)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let tA: string;
  let tX: string;
  let refsB: TenantRefs;
  let refsA: TenantRefs;
  let payslipXId: string;
  let payslipYId: string;
  let softDeletedProfileId: string;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));

  const send = (t: string, r: ObjRoute, refs: TenantRefs): request.Test => {
    const u = r.path(refs);
    if (r.method === "GET") return get(t, u);
    if (r.method === "POST") return post(t, u).send(r.body ?? {});
    return auth(t)(http().patch(u)).send(r.body ?? {});
  };

  async function login(slug: string, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Cấp một tập cặp (đọc TỪ bảng hằng, giữ nguyên `isSensitive`) ở scope chỉ định. */
  async function grant(
    companyId: string,
    userId: string,
    label: string,
    keys: ReadonlyArray<keyof typeof PAYROLL_ROUTE_PAIRS>,
    scope: "Own" | "Company",
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `s13pqa1idor-${label}`);
    const pairs = new Map(
      keys.map((k) => PAYROLL_ROUTE_PAIRS[k]).map((p) => [`${p.action}:${p.resourceType}`, p]),
    );
    for (const p of pairs.values()) {
      const permId = await seedPermissionCatalog(direct, p.action, p.resourceType, p.isSensitive);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  const ALL_KEYS = Object.keys(PAYROLL_ROUTE_PAIRS) as Array<keyof typeof PAYROLL_ROUTE_PAIRS>;
  /** 3 cặp Own của khối ME — chủ thể X của mục C chỉ có bấy nhiêu. */
  const ME_KEYS: Array<keyof typeof PAYROLL_ROUTE_PAIRS> = [
    "mePayslipList",
    "mePayslipDetail",
    "mePayslipAck",
  ];

  /**
   * Dựng một kỳ lương ĐI HẾT vòng đời tới `Paid` cho `subjects` (mỗi người 1 hồ sơ lương ⇒ 1 phiếu).
   * Vết duyệt đặt bằng SQL với HAI actor khác nhau — CHECK `payroll_periods_four_eyes_check` khoá cả
   * fixture, không chỉ khoá đường API (`db-invariant-kills-adversarial-fixtures`).
   */
  async function buildPaidPeriod(
    tenant: SeededTenant,
    token: string,
    month: string,
    subjects: readonly string[],
    approverA: string,
    approverB: string,
  ): Promise<TenantRefs> {
    for (const s of subjects) {
      await direct.query(
        `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances)
         VALUES ($1, $2, '2026-01-01', '9000000.00', '[]'::jsonb)`,
        [tenant.companyId, s],
      );
    }
    const ap = await direct.query<{ id: string }>(
      `INSERT INTO attendance_periods (company_id, period_month, status)
       VALUES ($1, $2, 'locked') RETURNING id`,
      [tenant.companyId, month],
    );
    const p = await post(token, "/payroll-periods").send({
      periodMonth: month,
      attendancePeriodId: ap.rows[0].id,
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const periodId = p.body.data.id as string;
    expect((await post(token, `/payroll-periods/${periodId}/collect`)).status).toBe(201);
    expect((await post(token, `/payroll-periods/${periodId}/calculate`)).status).toBe(201);

    const lines = await get(token, `/payroll-periods/${periodId}/lines`);
    expect(lines.status, JSON.stringify(lines.body)).toBe(200);
    const lineId = (lines.body.data as Array<{ id: string }>)[0].id;

    const bp = await post(token, "/bonus-penalties").send({
      userId: subjects[0],
      kind: "bonus",
      amount: 100_000,
      periodMonth: month,
      reason: "fixture s13pqa1 idor",
    });
    expect(bp.status, JSON.stringify(bp.body)).toBe(201);

    await direct.query(
      `UPDATE payroll_periods SET status = 'Approved',
         submitted_by = $2, submitted_at = now(), approved_by = $3, approved_at = now()
       WHERE id = $1`,
      [periodId, approverA, approverB],
    );
    expect((await post(token, `/payroll-periods/${periodId}/generate-payslips`)).status).toBe(201);
    expect((await post(token, `/payroll-periods/${periodId}/publish`)).status).toBe(201);

    const slips = await get(token, `/payslips?payrollPeriodId=${periodId}`);
    expect(slips.status, JSON.stringify(slips.body)).toBe(200);
    const profiles = await get(token, "/salary-profiles");
    expect(profiles.status, JSON.stringify(profiles.body)).toBe(200);

    return {
      periodId,
      lineId,
      payslipId: (slips.body.data as Array<{ id: string }>)[0].id,
      salaryProfileId: (profiles.body.data as Array<{ id: string }>)[0].id,
      bonusPenaltyId: bp.body.data.id as string,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);

    A = await seedCompany(direct, "s13pqa1idora");
    B = await seedCompany(direct, "s13pqa1idorb");
    companyIds.push(A.companyId, B.companyId);
    for (const c of [A, B]) {
      await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
        c.companyId,
        JSON.stringify({ days: [1, 2, 3, 4, 5] }),
      ]);
    }

    // ── Tenant A: actor đủ quyền + hai nhân viên X/Y (mục C) ─────────────────────────────────
    const aOfficer = await seedUser(direct, A.companyId, `officer@${A.slug}.test`, hash);
    await grant(A.companyId, aOfficer, "a-officer", ALL_KEYS, "Company");
    tA = await login(A.slug, `officer@${A.slug}.test`);

    const empX = await seedUser(direct, A.companyId, `empx@${A.slug}.test`, hash);
    const empY = await seedUser(direct, A.companyId, `empy@${A.slug}.test`, hash);
    await grant(A.companyId, empX, "a-empx", ME_KEYS, "Own");
    tX = await login(A.slug, `empx@${A.slug}.test`);

    refsA = await buildPaidPeriod(A, tA, "2028-03", [empX, empY], empY, aOfficer);
    {
      const slips = await direct.query<{ id: string; user_id: string }>(
        `SELECT p.id, p.user_id FROM payslips p WHERE p.payroll_period_id = $1`,
        [refsA.periodId],
      );
      expect(slips.rows.length, "hai nhân viên có hồ sơ lương ⇒ ĐÚNG 2 phiếu").toBe(2);
      payslipXId = slips.rows.find((r) => r.user_id === empX)!.id;
      payslipYId = slips.rows.find((r) => r.user_id === empY)!.id;
    }
    // Hồ sơ lương XOÁ MỀM của A — nguồn 404 thứ ba cho mục B.
    {
      const r = await direct.query<{ id: string }>(
        `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances, deleted_at)
         VALUES ($1, $2, '2027-01-01', '1000000.00', '[]'::jsonb, now()) RETURNING id`,
        [A.companyId, empY],
      );
      softDeletedProfileId = r.rows[0].id;
    }

    // ── Tenant B: bộ id đầy đủ để A bắn sang ──────────────────────────────────────────────────
    const bOfficer = await seedUser(direct, B.companyId, `officer@${B.slug}.test`, hash);
    await grant(B.companyId, bOfficer, "b-officer", ALL_KEYS, "Company");
    const tB = await login(B.slug, `officer@${B.slug}.test`);
    const bEmp = await seedUser(direct, B.companyId, `emp@${B.slug}.test`, hash);
    const bEmp2 = await seedUser(direct, B.companyId, `emp2@${B.slug}.test`, hash);
    refsB = await buildPaidPeriod(B, tB, "2028-04", [bEmp], bEmp2, bOfficer);
  }, 300_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── A. Cross-tenant trên 20 route có định danh đối tượng ─────────────────────────────────────

  describe("A. actor tenant A bắn id của tenant B ⇒ 404 PAYROLL-ERR-010 (không 403, không 5xx)", () => {
    it.each(OBJ_ROUTES.map((r) => [r.code, r] as const))("%s ⇒ 404 sentinel", async (_c, route) => {
      const res = await send(tA, route, refsB);
      const label = `${route.code} ${route.method} | ${res.status} ${res.text?.slice(0, 200)}`;
      expect(res.status, label).toBe(404);
      expect(res.body?.error?.code, label).toBe("PAYROLL-ERR-010");
    });
  });

  // ── B. Ba nguồn 404 cho CÙNG một hình dạng (không có oracle tồn tại) ─────────────────────────

  describe("B. id-của-B · id-bịa · id-xoá-mềm ⇒ CÙNG một phản hồi", () => {
    const shape = (res: request.Response) => ({
      status: res.status,
      code: res.body?.error?.code,
      message: res.body?.error?.message,
    });

    it("GET /salary-profiles/:id — ba nguồn cho ba phản hồi BẰNG NHAU", async () => {
      const fromB = await get(tA, `/salary-profiles/${refsB.salaryProfileId}`);
      const bogus = await get(tA, `/salary-profiles/${randomUUID()}`);
      const soft = await get(tA, `/salary-profiles/${softDeletedProfileId}`);
      expect(shape(fromB)).toEqual(shape(bogus));
      expect(shape(soft)).toEqual(shape(bogus));
      expect(shape(bogus)).toMatchObject({ status: 404, code: "PAYROLL-ERR-010" });
    });

    it("GET /payroll-periods/:id/lines — id của B và id bịa BẰNG NHAU", async () => {
      const fromB = await get(tA, `/payroll-periods/${refsB.periodId}/lines`);
      const bogus = await get(tA, `/payroll-periods/${randomUUID()}/lines`);
      expect(shape(fromB)).toEqual(shape(bogus));
    });

    it("GET /payslips/:id — id của B và id bịa BẰNG NHAU", async () => {
      const fromB = await get(tA, `/payslips/${refsB.payslipId}`);
      const bogus = await get(tA, `/payslips/${randomUUID()}`);
      expect(shape(fromB)).toEqual(shape(bogus));
    });
  });

  // ── C. IDOR liên-nhân-sự trong CÙNG company ──────────────────────────────────────────────────

  describe("C. nhân viên X (3 cặp Own khối ME) KHÔNG chạm được phiếu của Y cùng company", () => {
    it("GET /me/payslips — danh sách của X KHÔNG chứa phiếu của Y", async () => {
      const res = await get(tX, "/me/payslips");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((x) => x.id);
      expect(ids, "phiếu của chính X phải có").toContain(payslipXId);
      expect(ids, "phiếu của Y KHÔNG được lọt vào danh sách của X").not.toContain(payslipYId);
    });

    it("GET /me/payslips/:id — phiếu của Y ⇒ 404 sentinel, BẰNG id bịa (không lộ tồn tại)", async () => {
      const ofY = await get(tX, `/me/payslips/${payslipYId}`);
      const bogus = await get(tX, `/me/payslips/${randomUUID()}`);
      expect(ofY.status, JSON.stringify(ofY.body)).toBe(404);
      expect(ofY.body?.error?.code).toBe("PAYROLL-ERR-010");
      expect({ s: ofY.status, c: ofY.body?.error?.code, m: ofY.body?.error?.message }).toEqual({
        s: bogus.status,
        c: bogus.body?.error?.code,
        m: bogus.body?.error?.message,
      });
    });

    it("POST /me/payslips/:id/acknowledge — phiếu của Y ⇒ 404 (đường GHI, KHÔNG 409)", async () => {
      const res = await post(tX, `/me/payslips/${payslipYId}/acknowledge`);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body?.error?.code).toBe("PAYROLL-ERR-010");
      // Vết xác nhận sống ở SỔ CHỈ-INSERT `payslip_acknowledgements` (không phải cột trên `payslips`).
      const ack = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM payslip_acknowledgements WHERE payslip_id = $1`,
        [payslipYId],
      );
      expect(Number(ack.rows[0].n), "404 mà vẫn đóng dấu xác nhận là lỗ tệ hơn 200").toBe(0);
    });

    it("GET /payslips/:id — khối ME KHÔNG phải cửa sau vào cặp `view-payslip` ⇒ 403", async () => {
      const res = await get(tX, `/payslips/${payslipXId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });

    it("ALLOW đối chứng — X đọc + xác nhận CHÍNH phiếu của mình ⇒ 200 rồi 201", async () => {
      const read = await get(tX, `/me/payslips/${payslipXId}`);
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect(read.body.data.id).toBe(payslipXId);
      const ack = await post(tX, `/me/payslips/${payslipXId}/acknowledge`);
      expect(ack.status, JSON.stringify(ack.body)).toBe(201);
    });
  });

  // ── D. 404 cross-tenant KHÔNG được để lại vết ghi ────────────────────────────────────────────

  describe("D. sau toàn bộ mục A, dữ liệu của tenant B NGUYÊN VẸN", () => {
    it("kỳ của B vẫn `Paid`, số dòng/số phiếu không đổi, không có `reopen_reason` lạ", async () => {
      // Bắn LẠI mọi route GHI để ca này độc lập với thứ tự chạy của mục A.
      for (const route of OBJ_ROUTES.filter((r) => r.write)) {
        const res = await send(tA, route, refsB);
        expect(res.status, `${route.code} phải 404`).toBe(404);
      }
      const row = await direct.query<{
        status: string;
        reopen_reason: string | null;
        note: string | null;
      }>(`SELECT status, reopen_reason, note FROM payroll_periods WHERE id = $1`, [refsB.periodId]);
      expect(row.rows[0].status, "kỳ của B bị đổi trạng thái từ tenant A").toBe("Paid");
      expect(row.rows[0].reopen_reason).toBeNull();
      expect(row.rows[0].note ?? "").not.toContain("qa idor");

      const lines = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM payroll_period_lines
         WHERE payroll_period_id = $1 AND deleted_at IS NULL`,
        [refsB.periodId],
      );
      expect(Number(lines.rows[0].n)).toBe(1);
      const slips = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM payslips WHERE payroll_period_id = $1`,
        [refsB.periodId],
      );
      expect(Number(slips.rows[0].n)).toBe(1);
    });

    it("hồ sơ lương của B không bị actor A sửa `note`", async () => {
      const row = await direct.query<{ note: string | null }>(
        `SELECT note FROM salary_profiles WHERE id = $1`,
        [refsB.salaryProfileId],
      );
      expect(row.rows[0]?.note ?? "").not.toContain("qa idor");
    });
  });

  // ── F. Đường TẠO tham chiếu `userId` ngoài phạm vi ⇒ 404 sentinel, KHÔNG 500 ─────────────────

  /**
   * PHÁT HIỆN 2026-09-01 (đã vá trong CÙNG WO). `mapPayrollPgError` có nhánh cho `23505` (unique) và
   * `23514` (check) nhưng **KHÔNG có nhánh `23503` (foreign_key_violation)** ⇒ POST /salary-profiles
   * và POST /bonus-penalties với `userId` không tồn tại (hoặc thuộc tenant khác) rơi thẳng thành
   * **500 SYSTEM-ERR-001** — đúng thứ mà docblock §8b của chính file đó gọi là "500 vô danh ở vùng đỏ".
   *
   * Vì sao chưa cổng nào bắt: ca ALLOW đối chứng của ma trận quyền chỉ assert `.not.toBe(403)`, và
   * 500 thoả điều kiện đó. Ở đây assert TƯỜNG MINH mã lỗi.
   *
   * Kịch bản thật, không phải trò cạy: người dùng bị xoá giữa lúc mở picker và lúc bấm Lưu.
   * Hai nguồn — `userId` bịa (vi phạm `*_user_id_fkey`) và `userId` của tenant khác (vi phạm
   * `*_user_id_company_fk`) — phải cho CÙNG phản hồi, kẻo tên constraint thành oracle tồn tại.
   */
  describe("F. tạo hồ sơ lương / khoản thưởng-phạt với `userId` ngoài phạm vi", () => {
    let bUserId: string;

    beforeAll(async () => {
      const r = await direct.query<{ id: string }>(
        `SELECT id FROM users WHERE company_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [B.companyId],
      );
      bUserId = r.rows[0].id;
    });

    it("POST /salary-profiles — userId bịa · userId của tenant B ⇒ 404 PAYROLL-ERR-010, KHÔNG 500", async () => {
      const body = (userId: string) => ({
        userId,
        effectiveDate: "2029-06-01",
        baseSalary: 1_000_000,
      });
      const bogus = await post(tA, "/salary-profiles").send(body(randomUUID()));
      const cross = await post(tA, "/salary-profiles").send(body(bUserId));
      expect(bogus.status, `userId bịa: ${JSON.stringify(bogus.body)}`).toBe(404);
      expect(bogus.body?.error?.code).toBe("PAYROLL-ERR-010");
      expect(cross.status, `userId tenant B: ${JSON.stringify(cross.body)}`).toBe(404);
      expect(cross.body?.error?.code).toBe("PAYROLL-ERR-010");
      expect(cross.body?.error?.message, "hai nguồn phải CÙNG thông điệp").toBe(
        bogus.body?.error?.message,
      );
    });

    it("POST /bonus-penalties — userId bịa · userId của tenant B ⇒ 404 PAYROLL-ERR-010, KHÔNG 500", async () => {
      const body = (userId: string) => ({
        userId,
        kind: "bonus" as const,
        amount: 100_000,
        periodMonth: "2029-06",
        reason: "qa s13 fk sentinel",
      });
      const bogus = await post(tA, "/bonus-penalties").send(body(randomUUID()));
      const cross = await post(tA, "/bonus-penalties").send(body(bUserId));
      expect(bogus.status, `userId bịa: ${JSON.stringify(bogus.body)}`).toBe(404);
      expect(bogus.body?.error?.code).toBe("PAYROLL-ERR-010");
      expect(cross.status, `userId tenant B: ${JSON.stringify(cross.body)}`).toBe(404);
      expect(cross.body?.error?.code).toBe("PAYROLL-ERR-010");
    });

    it("ALLOW đối chứng — CÙNG body với `userId` HỢP LỆ của A ⇒ 201 (404 đến từ FK, không phải luôn-404)", async () => {
      const okUser = (
        await direct.query<{ id: string }>(
          `SELECT id FROM users WHERE company_id = $1 AND email LIKE 'empx@%' LIMIT 1`,
          [A.companyId],
        )
      ).rows[0].id;
      const res = await post(tA, "/salary-profiles").send({
        userId: okUser,
        effectiveDate: "2029-06-01",
        baseSalary: 1_000_000,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });
  });

  // ── E. Neo chống xanh-rỗng ───────────────────────────────────────────────────────────────────

  describe("E. neo — bảng route mục A phủ đủ họ đối tượng, fixture của A khác fixture của B", () => {
    it("OBJ_ROUTES có 20 route, trong đó ≥12 là đường GHI", () => {
      expect(OBJ_ROUTES.length).toBe(20);
      expect(OBJ_ROUTES.filter((r) => r.write).length).toBeGreaterThanOrEqual(12);
    });

    it("id của A và của B thực sự KHÁC nhau (fixture không tự trỏ vào nhau)", () => {
      expect(refsA.periodId).not.toBe(refsB.periodId);
      expect(refsA.payslipId).not.toBe(refsB.payslipId);
      expect(refsA.salaryProfileId).not.toBe(refsB.salaryProfileId);
      expect(payslipXId).not.toBe(payslipYId);
    });

    it("ALLOW đối chứng — CÙNG bảng route, id của CHÍNH A ⇒ KHÔNG 404 sentinel", async () => {
      // Thiếu vế này thì một `payrollNotFound()` vô điều kiện cũng làm cả mục A xanh.
      //
      // TRỪ `032 mePayslipDetail`: route scope **Own**, và `tA` là cán bộ lương chứ KHÔNG phải chủ
      // phiếu ⇒ 404 ở đây là ĐÚNG, không phải dấu hiệu sentinel vô điều kiện. Vế ALLOW của chính
      // route đó nằm ở mục C (chủ thể `tX` đọc phiếu của mình ⇒ 200) — đừng nới ca này để "cho xanh",
      // sẽ mất luôn phép đo Own của 032.
      const ME_OWN_ONLY = new Set(["032 mePayslipDetail"]);
      for (const route of OBJ_ROUTES.filter((r) => !r.write && !ME_OWN_ONLY.has(r.code))) {
        const res = await send(tA, route, refsA);
        expect(
          res.body?.error?.code,
          `${route.code} trên id của CHÍNH A không được là 404 sentinel (${res.status})`,
        ).not.toBe("PAYROLL-ERR-010");
      }
    });
  });
});
