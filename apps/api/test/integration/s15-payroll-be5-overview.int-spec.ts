/**
 * S15-PAYROLL-BE-5 — Tổng quan (078) · Lời nhắc (079) · filter `insuranceIssue`/`hasSalaryProfile` của 036 — plan §5 mục 3.
 *
 * Hai công ty: A có kỳ (bảng tay ở `beforeAll`) + 12 nhân sự phủ từng nhánh vị từ D-13/D-14; C không có kỳ, không
 * có bản tỉ lệ.
 *
 * Nhánh vị từ ở A (bản tỉ lệ seed: lương tối thiểu vùng 4.960.000 · trần BHXH 46.800.000, hiệu lực 2024-07-01):
 *  o1 chính thức · có BH · GROSS 10tr                    ⇒ không nhắc
 *  o2 chính thức · có BH · lương BH 1tr                   ⇒ #3 (dưới sàn)
 *  o3 chính thức · có BH · NET, không lương BH/thử việc   ⇒ bỏ qua (engine dùng b sau gross-up)
 *  o4 chính thức · KHÔNG có thiết lập                      ⇒ #2
 *  o5 chính thức · thiết lập joins=false                   ⇒ #2
 *  o6 employment_type probation · không thiết lập          ⇒ không nhắc (không chính thức)
 *  o7 official_date tương lai · không thiết lập           ⇒ không nhắc
 *  o8 hồ sơ nhân sự inactive · không thiết lập            ⇒ không nhắc
 *  o9 chính thức · có BH · GROSS 100tr, không lương BH     ⇒ #3 (trên trần)
 *  o10 chính thức · có BH · thử việc 3tr (BH 10tr)          ⇒ #3 (engine ưu tiên lương thử việc)
 *  o11 chính thức · có BH · bản cũ 1tr, bản MỚI 10tr        ⇒ không nhắc (xét bản hiệu lực mới nhất)
 *  o12 chính thức · có BH · chỉ có bản hiệu lực tương lai   ⇒ không nhắc (chưa có hồ sơ hiệu lực)
 * ⇒ #2 = {o4, o5} = 2 · #3 = {o2, o9, o10} = 3.
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
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  employeeProfile,
  grantAllPayrollPairs,
  publishedPeriodWithPayslips,
  seedPayrollCatalog,
} from "../helpers/payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s15payrollbe5ov");
const YEAR = 2093;

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-5 · Tổng quan 078 · Lời nhắc 079 · filter 036", () => {
  let app: INestApplication;
  let direct: Pool;
  const companyIds: string[] = [];
  let A: SeededTenant;
  let C: SeededTenant;
  let officer = { id: "", token: "" };
  let admin = { id: "", token: "" };
  let officerC = { id: "", token: "" };
  let u1 = "";
  let u2 = "";
  let approvedPeriod = "";

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
  async function ok(token: string, url: string) {
    const res = await get(token, url);
    expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body;
  }

  /** Hồ sơ nhân sự với các cột vị từ D-13. */
  async function person(
    t: SeededTenant,
    code: string,
    opts: {
      orgUnitId?: string | null;
      employmentType?: string;
      status?: string;
      officialDate?: string | null;
    } = {},
  ): Promise<string> {
    const id = await seedUser(direct, t.companyId, `${code.toLowerCase()}@${t.slug}.test`, "x");
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code, org_unit_id, employment_type, status, official_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        t.companyId,
        id,
        code,
        opts.orgUnitId ?? null,
        opts.employmentType ?? "full_time",
        opts.status ?? "active",
        opts.officialDate ?? null,
      ],
    );
    return id;
  }
  const settings = (t: SeededTenant, userId: string, joins: boolean) =>
    direct.query(
      `INSERT INTO payroll_employee_settings (company_id, user_id, joins_social_insurance) VALUES ($1, $2, $3)`,
      [t.companyId, userId, joins],
    );
  const profile = (
    t: SeededTenant,
    userId: string,
    eff: string,
    base: string,
    opts: { insurance?: string | null; probation?: string | null; salaryType?: string } = {},
  ) =>
    direct.query(
      `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, insurance_salary,
         probation_salary, salary_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        t.companyId,
        userId,
        eff,
        base,
        opts.insurance ?? null,
        opts.probation ?? null,
        opts.salaryType ?? "GROSS",
        officer.id,
      ],
    );
  async function payslips(
    month: string,
    status: "Published" | "Locked" | "Approved",
    rows: Array<[string, string]>,
  ) {
    const { periodId } = await publishedPeriodWithPayslips(direct, A.companyId, {
      month,
      payees: rows.map(([userId, gross]) => ({ userId, gross, net: gross })),
      officerId: officer.id,
      approverId: admin.id,
      status,
    });
    return periodId;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    const tag = randomUUID().slice(0, 4);

    A = await seedCompany(direct, "be5ova");
    C = await seedCompany(direct, "be5ovc");
    companyIds.push(A.companyId, C.companyId);
    await seedPayrollCatalog(direct, A.companyId);
    const mk = async (t: SeededTenant, label: string) => {
      const email = `${label}@${t.slug}.test`;
      const id = await seedUser(direct, t.companyId, email, hash);
      await grantAllPayrollPairs(direct, t.companyId, id, `be5o-${label}-${tag}`);
      return { id, token: await login(t, email) };
    };
    officer = await mk(A, "officer");
    admin = await mk(A, "admin");
    officerC = await mk(C, "officer");

    const ou = async (name: string) =>
      (
        await direct.query<{ id: string }>(
          `INSERT INTO org_units (company_id, name) VALUES ($1, $2) RETURNING id`,
          [A.companyId, name],
        )
      ).rows[0].id;
    u1 = await ou("Phòng O1");
    u2 = await ou("Phòng O2");

    // ── nhân sự vị từ lời nhắc ──
    const o1 = await person(A, "O01", { orgUnitId: u1 });
    const o2 = await person(A, "O02", { orgUnitId: u1 });
    const o3 = await person(A, "O03", { orgUnitId: u2 });
    const o4 = await person(A, "O04", { orgUnitId: u2 });
    const o5 = await person(A, "O05");
    const o6 = await person(A, "O06", { employmentType: "probation" });
    await person(A, "O07", { officialDate: "2099-01-01" });
    await person(A, "O08", { status: "inactive" });
    const o9 = await person(A, "O09");
    const o10 = await person(A, "O10");
    const o11 = await person(A, "O11");
    const o12 = await person(A, "O12");
    for (const u of [o1, o2, o3, o9, o10, o11, o12]) await settings(A, u, true);
    await settings(A, o5, false);
    await profile(A, o1, "2025-01-01", "10000000.00");
    await profile(A, o2, "2025-01-01", "10000000.00", { insurance: "1000000.00" });
    await profile(A, o3, "2025-01-01", "10000000.00", { salaryType: "NET" });
    await profile(A, o9, "2025-01-01", "100000000.00");
    await profile(A, o10, "2025-01-01", "10000000.00", {
      insurance: "10000000.00",
      probation: "3000000.00",
    });
    await profile(A, o11, "2024-01-01", "10000000.00", { insurance: "1000000.00" });
    await profile(A, o11, "2025-01-01", "10000000.00", { insurance: "10000000.00" });
    await profile(A, o12, "2099-01-01", "1000000.00");
    void o6;

    // ── kỳ: M1 Published (3 người) · M2 Locked (2 người) · M3 Approved (có phiếu) ──
    await payslips(`${YEAR}-01`, "Published", [
      [o1, "10000000.00"],
      [o2, "20000000.00"],
      [o3, "35000000.00"],
    ]);
    await payslips(`${YEAR}-02`, "Locked", [
      [o1, "12000000.00"],
      [o3, "20000000.00"],
    ]);
    approvedPeriod = await payslips(`${YEAR}-03`, "Approved", [[o1, "99000000.00"]]);
    await direct.query(
      `INSERT INTO payroll_budgets (company_id, fiscal_year, org_unit_id, planned_amount) VALUES ($1, $2, NULL, 150000000)`,
      [A.companyId, YEAR],
    );
    // C: một nhân sự chính thức có BH nhưng công ty KHÔNG có bản tỉ lệ nào.
    const c1 = await person(C, "C01");
    await settings(C, c1, true);
  }, 120_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  describe("078 — Tổng quan", () => {
    it("mặc định: kỳ neo = kỳ phát hành mới nhất (M2 Locked); kỳ Approved KHÔNG là neo", async () => {
      const body = await ok(officer.token, "/payroll/overview");
      const d = body.data;
      expect(d.latestPeriod.periodMonth).toBe(`${YEAR}-02`);
      expect(d.latestPeriod.status).toBe("Locked");
      expect(d.months).toBe(12);
      // M2: o1 12tr ⇒ [10,15) · o3 20tr ⇒ [20,30).
      expect(d.salaryDistribution.map((b: { headcount: number }) => b.headcount)).toEqual([
        0, 0, 1, 0, 1, 0, 0,
      ]);
      expect(d.salaryDistribution[0]).toEqual({ bandFrom: 0, bandTo: 5_000_000, headcount: 0 });
      expect(d.salaryDistribution[6]).toEqual({ bandFrom: 50_000_000, bandTo: null, headcount: 0 });
      // byPeriod: M1 + M2 (M3 Approved không tính).
      expect(
        d.byPeriod.map((p: Record<string, unknown>) => [
          p.periodMonth,
          p.headcount,
          p.totalGross,
          p.avgGross,
        ]),
      ).toEqual([
        [`${YEAR}-01`, 3, 65_000_000, 21_666_666.67],
        [`${YEAR}-02`, 2, 32_000_000, 16_000_000],
      ]);
      // Đơn vị HIỆN TẠI ở kỳ neo: o1 (O1) 12tr · o3 (O2) 20tr.
      expect(
        d.byOrgUnit.map((u: Record<string, unknown>) => [
          u.orgUnitName,
          u.headcount,
          u.avgGross,
          u.minGross,
          u.maxGross,
        ]),
      ).toEqual([
        ["Phòng O1", 1, 12_000_000, 12_000_000, 12_000_000],
        ["Phòng O2", 1, 20_000_000, 20_000_000, 20_000_000],
      ]);
      // Ngân sách năm: kế hoạch 150tr · thực hiện 97tr (M1 65 + M2 32).
      expect(d.budget).toEqual({
        fiscalYear: YEAR,
        plannedAmount: 150_000_000,
        actualAmount: 97_000_000,
        usagePct: 64.67,
      });
      expect(Array.isArray(d.incomeStructure)).toBe(true);
    });

    it("`toMonth` dời kỳ neo về M1; `months=1` chỉ còn một điểm", async () => {
      const d = (await ok(officer.token, `/payroll/overview?toMonth=${YEAR}-01&months=1`)).data;
      expect(d.latestPeriod.periodMonth).toBe(`${YEAR}-01`);
      // M1: 10tr ⇒ [10,15) · 20tr ⇒ [20,30) · 35tr ⇒ [30,50).
      expect(d.salaryDistribution.map((b: { headcount: number }) => b.headcount)).toEqual([
        0, 0, 1, 0, 1, 1, 0,
      ]);
      expect(d.byPeriod.map((p: { periodMonth: string }) => p.periodMonth)).toEqual([`${YEAR}-01`]);
    });

    it("công ty chưa có kỳ ⇒ 200, khối rỗng, không 404", async () => {
      const d = (await ok(officerC.token, "/payroll/overview")).data;
      expect(d.latestPeriod).toBeNull();
      expect(d.salaryDistribution.map((b: { headcount: number }) => b.headcount)).toEqual([
        0, 0, 0, 0, 0, 0, 0,
      ]);
      expect(d.incomeStructure).toEqual([]);
      expect(d.byPeriod).toEqual([]);
      expect(d.byOrgUnit).toEqual([]);
      expect(d.budget.plannedAmount).toBeNull();
      expect(d.budget.actualAmount).toBe(0);
      expect(d.budget.usagePct).toBeNull();
    });

    it("audit mỗi lượt (KHÔNG cache): hai lượt ⇒ +2 hàng `overview`", async () => {
      const count = async () =>
        Number(
          (
            await direct.query(
              `SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND actor_user_id = $2
                  AND object_type = 'payroll_report' AND object_id IS NULL AND "after"::text LIKE '%"overview"%'`,
              [A.companyId, officer.id],
            )
          ).rows[0].n,
        );
      const before = await count();
      await ok(officer.token, "/payroll/overview");
      await ok(officer.token, "/payroll/overview");
      expect(await count()).toBe(before + 2);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  describe("079 — Lời nhắc ↔ 036", () => {
    it("#1 kỳ Approved có phiếu; #2 = 2; #3 = 3; asOf là ngày (YYYY-MM-DD)", async () => {
      const d = (await ok(officer.token, "/payroll/overview/reminders")).data;
      expect(d.unpublishedPayslips).toEqual({
        periodCount: 1,
        payslipCount: 1,
        periods: [{ id: approvedPeriod, periodMonth: `${YEAR}-03`, payslipCount: 1 }],
      });
      expect(d.uninsuredEmployees).toEqual({ count: 2 });
      expect(d.insuranceSalaryOutOfRange.count).toBe(3);
      expect(d.insuranceSalaryOutOfRange.rateMissing).toBe(false);
      expect(d.insuranceSalaryOutOfRange.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("ĐẲNG THỨC: số lời nhắc = pagination.total của 036 cùng `insuranceIssue`, đúng người", async () => {
      const d = (await ok(officer.token, "/payroll/overview/reminders")).data;
      const notJoined = await ok(officer.token, "/payroll/employees?insuranceIssue=not-joined");
      const outOfRange = await ok(
        officer.token,
        "/payroll/employees?insuranceIssue=salary-out-of-range",
      );
      expect(notJoined.pagination.total).toBe(d.uninsuredEmployees.count);
      expect(outOfRange.pagination.total).toBe(d.insuranceSalaryOutOfRange.count);
      const codes = async (ids: string[]) =>
        (
          await direct.query<{ employee_code: string }>(
            `SELECT employee_code FROM employee_profiles WHERE company_id = $1 AND user_id = ANY($2::uuid[]) ORDER BY employee_code`,
            [A.companyId, ids],
          )
        ).rows.map((r) => r.employee_code);
      expect(await codes(notJoined.data.map((r: { userId: string }) => r.userId))).toEqual([
        "O04",
        "O05",
      ]);
      expect(await codes(outOfRange.data.map((r: { userId: string }) => r.userId))).toEqual([
        "O02",
        "O09",
        "O10",
      ]);
    });

    it("công ty không có bản tỉ lệ ⇒ #3 count 0 + rateMissing; 036 salary-out-of-range rỗng", async () => {
      const d = (await ok(officerC.token, "/payroll/overview/reminders")).data;
      expect(d.insuranceSalaryOutOfRange).toMatchObject({ count: 0, rateMissing: true });
      const list = await ok(
        officerC.token,
        "/payroll/employees?insuranceIssue=salary-out-of-range",
      );
      expect(list.pagination.total).toBe(0);
    });

    it("insuranceIssue lạ ⇒ 400", async () => {
      expect((await get(officer.token, "/payroll/employees?insuranceIssue=abc")).status).toBe(400);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  describe("036 — hasSalaryProfile (D-18: `false` từng bị đọc thành `true`)", () => {
    it("`false` ⇒ chỉ người CHƯA có hồ sơ lương; `true` ⇒ chỉ người đã có; rác ⇒ 400", async () => {
      const without = await ok(
        officer.token,
        "/payroll/employees?hasSalaryProfile=false&per_page=100",
      );
      const withP = await ok(
        officer.token,
        "/payroll/employees?hasSalaryProfile=true&per_page=100",
      );
      expect(without.data.length).toBeGreaterThan(0);
      expect(withP.data.length).toBeGreaterThan(0);
      expect(without.data.every((r: { hasSalaryProfile: boolean }) => !r.hasSalaryProfile)).toBe(
        true,
      );
      expect(withP.data.every((r: { hasSalaryProfile: boolean }) => r.hasSalaryProfile)).toBe(true);
      const all = await ok(officer.token, "/payroll/employees?per_page=100");
      expect(without.pagination.total + withP.pagination.total).toBe(all.pagination.total);
      expect((await get(officer.token, "/payroll/employees?hasSalaryProfile=yes")).status).toBe(
        400,
      );
    });
  });
});
