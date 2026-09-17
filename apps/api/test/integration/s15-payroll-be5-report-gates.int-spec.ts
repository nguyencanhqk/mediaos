/**
 * S15-PAYROLL-BE-5 — CỔNG của Tổng quan · Lời nhắc · 7 báo cáo (`078..082`) — plan §5 mục 1.
 *
 * Mỗi ca DENY có ca ALLOW đối chứng cùng route (memory `deny-cases-vacuous-without-allow-case`): 403 ở đây
 * phải là vì CẶP/SÀN, không vì route không tồn tại.
 *  · thiếu `view:payroll-report` ⇒ 403 ở cả 5 route;
 *  · grant scope `Department` ⇒ 403 `AUTH-ERR-SCOPE-DENIED` (sàn Company — SPEC-11 §9.1);
 *  · owner O-2: báo cáo lộ tiền THEO NGƯỜI thiếu cặp nguồn ⇒ 403 ở 081/082 và 080 KHÔNG liệt kê;
 *  · 082 thiếu `export:payroll` ⇒ 403, 080 `exportable = false`;
 *  · 403 để lại 0 hàng audit;
 *  · tham số sai ⇒ 400 `VALIDATION-ERR-001`.
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
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import type { PayrollRouteKey } from "../../src/payroll/payroll-route-pairs.const";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  employeeProfile,
  grantAllPayrollPairs,
  grantPayrollPairs,
  publishedPeriodWithPayslips,
} from "../helpers/payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s15payrollbe5gate");

const ALL_CODES = [
  "employee-income",
  "salary-by-period",
  "income-structure",
  "cost-by-org-unit",
  "salary-history",
  "payment-summary",
  "budget-status",
] as const;
/** Báo cáo KHÔNG đòi cặp nguồn (chỉ số tổng hợp — owner O-2). */
const AGGREGATE_CODES = ["salary-by-period", "income-structure", "cost-by-org-unit"];
const PER_PERSON_CODES = ALL_CODES.filter((c) => !AGGREGATE_CODES.includes(c));
const YEAR = 2091;
const RANGE = `fromMonth=${YEAR}-01&toMonth=${YEAR}-12`;
/** Tham số đủ cho từng báo cáo. */
const paramsOf = (code: string): string =>
  code === "budget-status" ? `fiscalYear=${YEAR}` : RANGE;

/** Mọi cặp PAYROLL trừ `view:payroll-report` (5 key của track D). */
const REPORT_KEYS: readonly PayrollRouteKey[] = [
  "overview",
  "overviewReminders",
  "reportList",
  "reportData",
  "reportExport",
];

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-5 · cổng 078–082", () => {
  let app: INestApplication;
  let direct: Pool;
  const companyIds: string[] = [];
  let A: SeededTenant;
  let officer = { id: "", token: "" };
  let admin = { id: "", token: "" };
  let noReport = { id: "", token: "" };
  let dept = { id: "", token: "" };
  let reportOnly = { id: "", token: "" };
  let reportExport = { id: "", token: "" };
  let reportPayslip = { id: "", token: "" };
  let mixedScope = { id: "", token: "" };
  let employeeOnly = { id: "", token: "" };

  const http = () => request(app.getHttpServer());
  const get = (token: string, url: string) =>
    http().get(url).set("Authorization", `Bearer ${token}`);
  async function login(t: SeededTenant, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: t.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }
  const auditCount = async (actorId: string): Promise<number> =>
    Number(
      (
        await direct.query(
          `SELECT count(*)::int AS n FROM audit_logs
            WHERE company_id = $1 AND actor_user_id = $2 AND object_type = 'payroll_report'`,
          [A.companyId, actorId],
        )
      ).rows[0].n,
    );
  const fieldsOf = (res: request.Response): string[] =>
    ((res.body?.error?.details ?? []) as Array<{ field: string }>).map((d) => d.field);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);

    A = await seedCompany(direct, "be5gate");
    companyIds.push(A.companyId);
    const mk = async (label: string, grant: (id: string) => Promise<void>) => {
      const email = `${label}@${A.slug}.test`;
      const id = await seedUser(direct, A.companyId, email, hash);
      await grant(id);
      return { id, token: await login(A, email) };
    };
    const tag = randomUUID().slice(0, 4);
    officer = await mk("officer", (id) =>
      grantAllPayrollPairs(direct, A.companyId, id, `be5g-off-${tag}`),
    );
    admin = await mk("admin", (id) =>
      grantAllPayrollPairs(direct, A.companyId, id, `be5g-adm-${tag}`),
    );
    noReport = await mk("noreport", (id) =>
      grantPayrollPairs(direct, A.companyId, id, `be5g-norep-${tag}`, [
        "payslipList",
        "salaryProfileList",
        "batchList",
        "budgetList",
        "periodExport",
        "periodLines",
      ]),
    );
    dept = await mk("dept", (id) =>
      grantPayrollPairs(
        direct,
        A.companyId,
        id,
        `be5g-dept-${tag}`,
        [
          ...REPORT_KEYS,
          "payslipList",
          "salaryProfileList",
          "batchList",
          "budgetList",
          "periodExport",
        ],
        "Department",
      ),
    );
    reportOnly = await mk("reportonly", (id) =>
      grantPayrollPairs(direct, A.companyId, id, `be5g-ro-${tag}`, ["reportData"]),
    );
    reportExport = await mk("reportexport", (id) =>
      grantPayrollPairs(direct, A.companyId, id, `be5g-rx-${tag}`, ["reportData", "periodExport"]),
    );
    reportPayslip = await mk("reportpayslip", (id) =>
      grantPayrollPairs(direct, A.companyId, id, `be5g-rp-${tag}`, ["reportData", "payslipList"]),
    );
    // Cặp báo cáo @Company NHƯNG cặp nguồn + export chỉ @Department (plan §0b B6a) — tách được đột biến bỏ sàn ở
    // kiểm mềm khỏi sàn của chính cặp báo cáo.
    mixedScope = await mk("mixedscope", async (id) => {
      await grantPayrollPairs(direct, A.companyId, id, `be5g-mx1-${tag}`, [...REPORT_KEYS]);
      await grantPayrollPairs(
        direct,
        A.companyId,
        id,
        `be5g-mx2-${tag}`,
        ["payslipList", "salaryProfileList", "batchList", "budgetList", "periodExport"],
        "Department",
      );
    });
    employeeOnly = await mk("employeeonly", (id) =>
      grantPayrollPairs(direct, A.companyId, id, `be5g-eo-${tag}`, ["employeeList"]),
    );

    // Một kỳ đã phát hành để các ca ALLOW có dữ liệu thật (không xanh-rỗng trên tập trống).
    const e1 = await seedUser(direct, A.companyId, `e1@${A.slug}.test`, "x");
    await employeeProfile(direct, A.companyId, e1, "G001", null);
    await publishedPeriodWithPayslips(direct, A.companyId, {
      month: `${YEAR}-03`,
      payees: [{ userId: e1, net: "9000000.00", gross: "10000000.00" }],
      officerId: officer.id,
      approverId: admin.id,
    });
  }, 120_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  describe("thiếu cặp · sàn scope Company", () => {
    const urls = [
      "/payroll/overview",
      "/payroll/overview/reminders",
      "/payroll/reports",
      `/payroll/reports/salary-by-period?${RANGE}`,
      `/payroll/reports/salary-by-period/export?${RANGE}`,
    ];

    it("ALLOW đối chứng: officer (đủ cặp @Company) ⇒ 200 ở cả 5 route", async () => {
      for (const url of urls) {
        const res = await get(officer.token, url);
        expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBe(200);
      }
    });

    it("thiếu `view:payroll-report` ⇒ 403 ở cả 5 route và 0 hàng audit", async () => {
      const before = await auditCount(noReport.id);
      for (const url of urls) {
        const res = await get(noReport.token, url);
        expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBe(403);
      }
      expect(await auditCount(noReport.id)).toBe(before);
    });

    it("grant scope Department ⇒ 403 AUTH-ERR-SCOPE-DENIED (sàn Company), 0 audit", async () => {
      const before = await auditCount(dept.id);
      for (const url of urls) {
        const res = await get(dept.token, url);
        expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body.error.message, url).toContain("AUTH-ERR-SCOPE-DENIED");
      }
      expect(await auditCount(dept.id)).toBe(before);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  describe("cặp nguồn (owner O-2) · export", () => {
    it("080: officer thấy đủ 7 báo cáo, cả 7 exportable", async () => {
      const res = await get(officer.token, "/payroll/reports");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data as Array<{ code: string; exportable: boolean }>;
      expect(items.map((i) => i.code)).toEqual([...ALL_CODES]);
      expect(items.every((i) => i.exportable)).toBe(true);
    });

    it("080: chỉ `view:payroll-report` ⇒ ĐÚNG 3 báo cáo tổng hợp, không exportable", async () => {
      const res = await get(reportOnly.token, "/payroll/reports");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data as Array<{ code: string; exportable: boolean }>;
      expect(items.map((i) => i.code)).toEqual(AGGREGATE_CODES);
      expect(items.some((i) => i.exportable)).toBe(false);
    });

    it("080: thêm `export:payroll` ⇒ 3 báo cáo tổng hợp exportable; thêm `view-payslip` ⇒ + employee-income", async () => {
      const rx = await get(reportExport.token, "/payroll/reports");
      const rxItems = rx.body.data as Array<{ code: string; exportable: boolean }>;
      expect(rxItems.map((i) => i.code)).toEqual(AGGREGATE_CODES);
      expect(rxItems.every((i) => i.exportable)).toBe(true);

      const rp = await get(reportPayslip.token, "/payroll/reports");
      const rpItems = rp.body.data as Array<{ code: string }>;
      expect(rpItems.map((i) => i.code)).toEqual(["employee-income", ...AGGREGATE_CODES]);
    });

    it("081: thiếu cặp nguồn ⇒ 403 (4 báo cáo theo người); báo cáo tổng hợp ⇒ 200 (đối chứng)", async () => {
      for (const code of ALL_CODES) {
        const res = await get(reportOnly.token, `/payroll/reports/${code}?${paramsOf(code)}`);
        const want = AGGREGATE_CODES.includes(code) ? 200 : 403;
        expect(res.status, `${code}: ${JSON.stringify(res.body)}`).toBe(want);
      }
      const ok = await get(
        reportPayslip.token,
        `/payroll/reports/employee-income?${paramsOf("employee-income")}`,
      );
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const denied = await get(
        reportPayslip.token,
        `/payroll/reports/salary-history?${paramsOf("salary-history")}`,
      );
      expect(denied.status).toBe(403);
    });

    it("cặp nguồn/export chỉ @Department ⇒ 081/082 403, 080 ẩn 4 mã + không exportable", async () => {
      const list = await get(mixedScope.token, "/payroll/reports");
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      const items = list.body.data as Array<{ code: string; exportable: boolean }>;
      expect(items.map((i) => i.code)).toEqual(AGGREGATE_CODES);
      expect(items.some((i) => i.exportable)).toBe(false);
      for (const code of PER_PERSON_CODES) {
        const res = await get(mixedScope.token, `/payroll/reports/${code}?${paramsOf(code)}`);
        expect(res.status, `${code}: ${JSON.stringify(res.body)}`).toBe(403);
      }
      const ok = await get(mixedScope.token, `/payroll/reports/salary-by-period?${RANGE}`);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const exp = await get(mixedScope.token, `/payroll/reports/salary-by-period/export?${RANGE}`);
      expect(exp.status).toBe(403);
    });

    it("078: khối ngân sách CHỈ có khi giữ `view:payroll-budget`@Company (vắng khoá, không null)", async () => {
      const withBudget = await get(officer.token, "/payroll/overview");
      expect(withBudget.status).toBe(200);
      expect(withBudget.body.data).toHaveProperty("budget");
      for (const u of [reportOnly, mixedScope]) {
        const res = await get(u.token, "/payroll/overview");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data).not.toHaveProperty("budget");
        expect(res.body.data).toHaveProperty("byPeriod");
      }
    });

    it("036 `insuranceIssue=salary-out-of-range` đòi THÊM `view:salary-profile`@Company (plan §0b B1)", async () => {
      const denied = await get(
        employeeOnly.token,
        "/payroll/employees?insuranceIssue=salary-out-of-range",
      );
      expect(denied.status, JSON.stringify(denied.body)).toBe(403);
      const notJoined = await get(
        employeeOnly.token,
        "/payroll/employees?insuranceIssue=not-joined",
      );
      expect(notJoined.status, JSON.stringify(notJoined.body)).toBe(200);
      const plain = await get(employeeOnly.token, "/payroll/employees");
      expect(plain.status).toBe(200);
      const allowed = await get(
        officer.token,
        "/payroll/employees?insuranceIssue=salary-out-of-range",
      );
      expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    });

    it("082: thiếu `export:payroll` ⇒ 403; có ⇒ 200 XLSX; có export nhưng thiếu cặp nguồn ⇒ 403", async () => {
      const denied = await get(
        reportOnly.token,
        `/payroll/reports/salary-by-period/export?${RANGE}`,
      );
      expect(denied.status).toBe(403);
      const ok = await get(reportExport.token, `/payroll/reports/salary-by-period/export?${RANGE}`);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(String(ok.headers["content-type"])).toContain("spreadsheetml");
      for (const code of PER_PERSON_CODES) {
        const noSource = await get(
          reportExport.token,
          `/payroll/reports/${code}/export?${paramsOf(code)}`,
        );
        expect(noSource.status, code).toBe(403);
      }
    });

    it("403 cặp nguồn để lại 0 hàng audit; 200 để lại đúng 1", async () => {
      const before = await auditCount(reportOnly.id);
      await get(reportOnly.token, `/payroll/reports/employee-income?${RANGE}`);
      expect(await auditCount(reportOnly.id)).toBe(before);
      await get(reportOnly.token, `/payroll/reports/salary-by-period?${RANGE}`);
      expect(await auditCount(reportOnly.id)).toBe(before + 1);
    });

    it("080 KHÔNG ghi audit (metadata, SPEC-11 §18.1 B)", async () => {
      const before = await auditCount(officer.id);
      const res = await get(officer.token, "/payroll/reports");
      expect(res.status).toBe(200);
      expect(await auditCount(officer.id)).toBe(before);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  describe("tham số ⇒ 400 VALIDATION-ERR-001", () => {
    const bad = async (url: string, field?: string) => {
      const res = await get(officer.token, url);
      expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error.code, url).toBe("VALIDATION-ERR-001");
      if (field) expect(fieldsOf(res), url).toContain(field);
    };

    it("mã báo cáo lạ", async () => {
      await bad(`/payroll/reports/khong-co?${RANGE}`);
      await bad(`/payroll/reports/khong-co/export?${RANGE}`);
    });

    it("thiếu tham số bắt buộc của báo cáo", async () => {
      await bad(`/payroll/reports/salary-by-period?toMonth=${YEAR}-12`, "fromMonth");
      await bad(`/payroll/reports/employee-income?fromMonth=${YEAR}-01`, "toMonth");
      await bad(`/payroll/reports/budget-status`, "fiscalYear");
      await bad(`/payroll/reports/budget-status/export`, "fiscalYear");
    });

    it("khoảng tháng ngược / quá 24 tháng / khoá lạ / phân trang ở export", async () => {
      await bad(
        `/payroll/reports/salary-by-period?fromMonth=${YEAR}-05&toMonth=${YEAR}-04`,
        "toMonth",
      );
      await bad(
        `/payroll/reports/salary-by-period?fromMonth=${YEAR}-01&toMonth=${YEAR + 2}-01`,
        "toMonth",
      );
      await bad(`/payroll/reports/salary-by-period?${RANGE}&foo=1`);
      await bad(`/payroll/reports/salary-by-period/export?${RANGE}&page=2`);
      await bad(`/payroll/overview?months=0`);
      await bad(`/payroll/overview?bar=1`);
    });

    it("tham số không áp cho báo cáo ⇒ bỏ qua (200, không 400)", async () => {
      const res = await get(
        officer.token,
        `/payroll/reports/salary-by-period?${RANGE}&fiscalYear=${YEAR}`,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  });
});
