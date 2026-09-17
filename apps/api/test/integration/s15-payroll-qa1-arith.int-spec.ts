/**
 * S15-PAYROLL-QA-1 (lane D, G10) — số học máy tính lương v2 trên ĐƯỜNG THẬT: SPEC-11 §21.1 mục 1–4.
 *
 *   A. NV-L — GROSS **bậc thuế THẤP** (chịu thuế ∈ (0, 10tr]) đủ mọi khoản KỂ CẢ điều chỉnh tay (mục 1) — NV-G của
 *      BE-3 KHÔNG có điều chỉnh tay; nhân sự MỚI thay vì sửa NV-G đang được BE-3 ghim. Số kỳ vọng từ
 *      `docs/QA/evidence/S15-PAYROLL-QA-1-doi-soat.py` (Python `Fraction`, không import engine).
 *   B. NPT biên hiệu lực (mục 4 kề, §13.8 dòng 1178 "tính đủ tháng nếu có giao dù chỉ một ngày"): bắt đầu
 *      1/tháng-sau (loại) · kết thúc cuối-tháng-trước (loại) · bắt đầu ĐÚNG ngày cuối kỳ (tính) · xoá mềm (loại).
 *   C. Bản tỉ lệ luật định versioned (mục 4): `effective_from ≤ ngày cuối kỳ` MỚI NHẤT thắng — ca giữa-tháng vs
 *      đúng-ngày-cuối-kỳ + hai kỳ hai bên một mốc đổi luật, đo qua BHXH_NV (không chỉ `statutoryRateId`).
 *   D. Thiếu bản tỉ lệ hiệu lực ⇒ 422 PAYROLL-ERR-022 `statutory-rate-missing`, kỳ KHÔNG đổi trạng thái.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
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
import { PayrollPeriodsService } from "../../src/payroll/payroll-periods.service";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  grantAllPayrollPairs,
  lockedAttendancePeriod,
  monthsWith22Weekdays,
  seedPayrollCatalog,
  weekdaysOf,
} from "../helpers/payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s15qa1arith");
const lastDayOf = PayrollPeriodsService.lastDayOf;

type Line = {
  id: string;
  userId: string;
  workDays: number;
  presentDays: number;
  unpaidLeaveDays: number;
  baseAmount: number;
  gross: number;
  net: number;
  deductionAmount: number;
  statutoryRateId: string | null;
  components?: Array<{ code: string; value: number; isVisible: boolean }>;
};

describe.skipIf(!hasLaneDb)(
  "S15-PAYROLL-QA-1 · G10 số học — bậc thuế thấp · NPT biên · tỉ lệ versioned",
  () => {
    let app: INestApplication;
    let direct: Pool;
    const companyIds: string[] = [];

    const http = () => request(app.getHttpServer());
    const as = (t: string) => ({
      get: (u: string) => http().get(u).set("Authorization", `Bearer ${t}`),
      post: (u: string) => http().post(u).set("Authorization", `Bearer ${t}`),
      patch: (u: string) => http().patch(u).set("Authorization", `Bearer ${t}`),
    });

    async function login(company: SeededTenant, email: string): Promise<string> {
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: company.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    async function present(
      companyId: string,
      userId: string,
      days: readonly string[],
    ): Promise<void> {
      for (const d of days) {
        await direct.query(
          `INSERT INTO attendance_records (company_id, user_id, work_date, status, late_minutes, early_leave_minutes)
         VALUES ($1, $2, $3, 'present', 0, 0)`,
          [companyId, userId, d],
        );
      }
    }

    async function employee(companyId: string, userId: string, code: string): Promise<string> {
      const r = await direct.query<{ id: string }>(
        `INSERT INTO employee_profiles (company_id, user_id, employee_code, start_date, status)
       VALUES ($1, $2, $3, '2020-01-01', 'active') RETURNING id`,
        [companyId, userId, code],
      );
      return r.rows[0].id;
    }

    /** Nghỉ KHÔNG lương NGUYÊN ngày — mirror be3-calculate.leave() (full=true only, không cần nửa ngày ở đây). */
    async function unpaidDay(
      companyId: string,
      userId: string,
      employeeId: string,
      typeId: string,
      day: string,
    ): Promise<void> {
      const lr = await direct.query<{ id: string }>(
        `INSERT INTO leave_requests (company_id, user_id, employee_id, leave_type_id, start_date, end_date, total_days, status)
       VALUES ($1, $2, $3, $4, $5, $5, 1, 'Approved') RETURNING id`,
        [companyId, userId, employeeId, typeId, day],
      );
      await direct.query(
        `INSERT INTO leave_request_days
         (company_id, leave_request_id, employee_id, leave_type_id, work_date, day_type, leave_days, is_working_day, status)
       VALUES ($1, $2, $3, $4, $5, 'Full Day', '1.00', true, 'Active')`,
        [companyId, lr.rows[0].id, employeeId, typeId, day],
      );
    }

    async function unpaidLeaveType(companyId: string, code: string): Promise<string> {
      const r = await direct.query<{ id: string }>(
        `INSERT INTO leave_types (company_id, name, code, paid) VALUES ($1, $2, $3, false) RETURNING id`,
        [companyId, `Không lương ${code}`, code],
      );
      return r.rows[0].id;
    }

    async function salaryProfile(companyId: string, userId: string, base: string): Promise<void> {
      await direct.query(
        `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances, salary_type)
       VALUES ($1, $2, '2024-01-01', $3, '[]'::jsonb, 'GROSS')`,
        [companyId, userId, base],
      );
    }

    async function newPeriod(
      officerToken: string,
      month: string,
      templateId: string,
    ): Promise<string> {
      const att = await lockedAttendancePeriod(direct, companyIds[0], month);
      const p = await as(officerToken)
        .post("/payroll-periods")
        .send({ periodMonth: month, attendancePeriodId: att, templateId });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      const id = p.body.data.id as string;
      expect((await as(officerToken).post(`/payroll-periods/${id}/collect`)).status).toBe(201);
      return id;
    }

    async function linesOf(officerToken: string, periodId: string): Promise<Map<string, Line>> {
      const res = await as(officerToken).get(`/payroll-periods/${periodId}/lines?per_page=100`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return new Map((res.body.data as Line[]).map((l) => [l.userId, l]));
    }

    const valuesOf = (l: Line | undefined): Record<string, number> =>
      Object.fromEntries((l?.components ?? []).map((c) => [c.code, c.value]));

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // Company chính — A · B · C
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    let R: SeededTenant;
    let officer = "";
    let templateId = "";
    /** Chỉ để làm `decided_by` khác `created_by` cho `bonus_penalties_four_eyes_check` — không đăng nhập. */
    let deciderId = "";

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      // supertest tự listen(0)+close() quanh MỖI request khi app chỉ init() — vô hại tuần tự nhưng vỡ khi
      // có bất kỳ request song song nào (memory: supertest-closes-shared-server-on-first-response).
      await app.listen(0);
      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);

      R = await seedCompany(direct, "qa1arith");
      companyIds.push(R.companyId);
      await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
        R.companyId,
        JSON.stringify({ days: [1, 2, 3, 4, 5] }),
      ]);
      templateId = await seedPayrollCatalog(direct, R.companyId);
      const officerId = await seedUser(direct, R.companyId, `officer@${R.slug}.test`, hash);
      await grantAllPayrollPairs(direct, R.companyId, officerId, "qa1arith-officer");
      officer = await login(R, `officer@${R.slug}.test`);
      deciderId = await seedUser(direct, R.companyId, `decider@${R.slug}.test`, hash);
    }, 300_000);

    afterAll(async () => {
      if (direct) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ── A. NV-L — bậc thấp đủ khoản + điều chỉnh tay ────────────────────────────────────────────────
    it("A1 — NV-L (GROSS bậc thấp, chịu thuế ∈ (0,10tr], đủ mọi khoản + điều chỉnh tay) khớp TỪNG ĐỒNG bảng tay Python", async () => {
      const [MONTH] = monthsWith22Weekdays(2046, 1);
      const days = weekdaysOf(MONTH);
      expect(days.length).toBe(22);

      const nvL = await seedUser(direct, R.companyId, `nvl@${R.slug}.test`, "x");
      await salaryProfile(R.companyId, nvL, "21345678.95");
      await direct.query(
        `INSERT INTO payroll_employee_settings (company_id, user_id, joins_social_insurance, joins_union, created_by)
       VALUES ($1, $2, true, true, $2)`,
        [R.companyId, nvL],
      );
      await direct.query(
        `INSERT INTO salary_profile_items (company_id, salary_profile_id, component_code, amount, is_active)
       SELECT sp.company_id, sp.id, 'PHU_CAP', 234567.85, true FROM salary_profiles sp
        WHERE sp.company_id = $1 AND sp.user_id = $2 AND sp.deleted_at IS NULL`,
        [R.companyId, nvL],
      );
      await direct.query(
        `INSERT INTO payroll_dependents (company_id, user_id, full_name, relationship, effective_from, effective_to)
       VALUES ($1, $2, 'NPT NV-L', 'Child', '2020-01-01', NULL)`,
        [R.companyId, nvL],
      );
      const empL = await employee(R.companyId, nvL, "QA1L");
      const unpaidType = await unpaidLeaveType(R.companyId, "QA1LUNPAID");
      await present(R.companyId, nvL, days.slice(0, 20));
      await unpaidDay(R.companyId, nvL, empL, unpaidType, days[20]);
      await unpaidDay(R.companyId, nvL, empL, unpaidType, days[21]);

      // `bonus_penalties_four_eyes_check`/tạm ứng đòi decided_by ≠ created_by — created_by = nvL (KHÔNG hợp lệ
      // để tự duyệt của mình dù chỉ là fixture), decided_by = deciderId (người khác, không đăng nhập).
      await direct.query(
        `INSERT INTO bonus_penalties (company_id, user_id, kind, amount, period_month, reason, status, created_by, decided_by, decided_at)
       VALUES ($1, $2, 'bonus', '111111.15', $3, 'qa1 A1', 'Approved', $2, $4, now()),
              ($1, $2, 'penalty', '22222.25', $3, 'qa1 A1', 'Approved', $2, $4, now())`,
        [R.companyId, nvL, MONTH, deciderId],
      );
      const advRow = await direct.query<{ id: string }>(
        `INSERT INTO payroll_advances (company_id, user_id, amount, deduct_period_month, reason, status, created_by)
       VALUES ($1, $2, '50000.00', $3, 'qa1 A1', 'Pending', $2) RETURNING id`,
        [R.companyId, nvL, MONTH],
      );
      await direct.query(
        `UPDATE payroll_advances SET status = 'Approved', decided_by = $2, decided_at = now() WHERE id = $1`,
        [advRow.rows[0].id, deciderId],
      );

      const periodId = await newPeriod(officer, MONTH, templateId);
      const calc = await as(officer).post(`/payroll-periods/${periodId}/calculate`);
      expect(calc.status, JSON.stringify(calc.body)).toBe(201);

      const before = (await linesOf(officer, periodId)).get(nvL) as Line;
      expect(before).toMatchObject({
        workDays: 22,
        presentDays: 20,
        unpaidLeaveDays: 2,
        baseAmount: 21345678.95,
        gross: 19750841.68,
        deductionAmount: 2632452.6,
        net: 17118389.08,
      });
      expect(valuesOf(before)).toEqual({
        LUONG_CO_BAN: 21345678.95,
        PHU_CAP: 234567.85,
        THUONG: 111111.15,
        NGHI_KHONG_LUONG: -1940516.27,
        PHAT: 22222.25,
        TAM_UNG: 50000,
        TONG_THU_NHAP: 19750841.68,
        BHXH_NV: 1707654.32,
        BHYT_NV: 320185.18,
        BHTN_NV: 213456.79,
        DOAN_PHI: 213456.79,
        TONG_BH_NV: 2241296.29,
        THU_NHAP_CHIU_THUE: 2109545.39,
        TNCN: 105477.27,
        TONG_KHAU_TRU: 2632452.6,
        BHXH_DN: 3735493.82,
        BHYT_DN: 640370.37,
        BHTN_DN: 213456.79,
        KPCD: 426913.58,
      });
      // Bậc thấp thật — TNCN > 0 và chịu thuế ≤ 10.000.000 (không phải ca clamp-về-0 xanh-rỗng).
      expect(valuesOf(before).THU_NHAP_CHIU_THUE).toBeGreaterThan(0);
      expect(valuesOf(before).THU_NHAP_CHIU_THUE).toBeLessThanOrEqual(10_000_000);

      // Điều chỉnh tay — vế CÒN THIẾU của NV-G (mục 1 §21.1). `net = MAX(gross − deduction + adjustment, 0)`.
      const adj = await as(officer)
        .patch(`/payroll-periods/${periodId}/lines/${before.id}`)
        .send({ adjustmentAmount: -12345.67, adjustmentReason: "qa1 A1 điều chỉnh tay" });
      expect(adj.status, JSON.stringify(adj.body)).toBe(200);
      const after = (await linesOf(officer, periodId)).get(nvL) as Line;
      expect(after.net).toBe(17106043.41);
    }, 120_000);

    // ── B. NPT biên hiệu lực ─────────────────────────────────────────────────────────────────────────
    it("B1 — NPT: bắt đầu 1/tháng-sau (loại) · kết thúc cuối-tháng-trước (loại) · bắt đầu ĐÚNG ngày cuối kỳ (TÍNH, §13.8) · xoá mềm (loại)", async () => {
      const MONTH = "2046-02"; // 28 ngày (2046 không nhuận) — mốc cuối kỳ rõ ràng.
      const last = lastDayOf(MONTH);
      expect(last).toBe("2046-02-28");
      const nextMonthFirst = "2046-03-01";
      const prevMonthLast = "2046-01-31";

      const nvBase = await seedUser(direct, R.companyId, `nvbase@${R.slug}.test`, "x");
      const nvNpt = await seedUser(direct, R.companyId, `nvnpt@${R.slug}.test`, "x");
      for (const uid of [nvBase, nvNpt]) await salaryProfile(R.companyId, uid, "20000000.00");

      // 4 hàng NPT của nvNpt — chỉ Dep C (bắt đầu ĐÚNG ngày cuối kỳ) được đếm.
      await direct.query(
        `INSERT INTO payroll_dependents (company_id, user_id, full_name, relationship, effective_from, effective_to)
       VALUES ($1, $2, 'Dep A — bắt đầu 1/tháng-sau', 'Child', $3, NULL)`,
        [R.companyId, nvNpt, nextMonthFirst],
      );
      await direct.query(
        `INSERT INTO payroll_dependents (company_id, user_id, full_name, relationship, effective_from, effective_to)
       VALUES ($1, $2, 'Dep B — kết thúc cuối-tháng-trước', 'Child', '2020-01-01', $3)`,
        [R.companyId, nvNpt, prevMonthLast],
      );
      await direct.query(
        `INSERT INTO payroll_dependents (company_id, user_id, full_name, relationship, effective_from, effective_to)
       VALUES ($1, $2, 'Dep C — bắt đầu ĐÚNG ngày cuối kỳ', 'Child', $3, NULL)`,
        [R.companyId, nvNpt, last],
      );
      const depD = await direct.query<{ id: string }>(
        `INSERT INTO payroll_dependents (company_id, user_id, full_name, relationship, effective_from, effective_to)
       VALUES ($1, $2, 'Dep D — xoá mềm', 'Child', '2020-01-01', NULL) RETURNING id`,
        [R.companyId, nvNpt],
      );
      await direct.query(`UPDATE payroll_dependents SET deleted_at = now() WHERE id = $1`, [
        depD.rows[0].id,
      ]);

      const days = weekdaysOf(MONTH);
      await present(R.companyId, nvBase, days);
      await present(R.companyId, nvNpt, days);

      const periodId = await newPeriod(officer, MONTH, templateId);
      const calc = await as(officer).post(`/payroll-periods/${periodId}/calculate`);
      expect(calc.status, JSON.stringify(calc.body)).toBe(201);

      const snap = await direct.query<{ user_id: string; cvj: Record<string, unknown> }>(
        `SELECT user_id, component_values_json AS cvj FROM payroll_period_lines
        WHERE payroll_period_id = $1 AND deleted_at IS NULL`,
        [periodId],
      );
      const byUser = new Map(snap.rows.map((r) => [r.user_id, r.cvj as Record<string, any>]));
      expect(byUser.get(nvBase)?.dependents).toBe(0);
      // Chỉ Dep C — A/B/D đều bị loại đúng như thiết kế biên.
      expect(byUser.get(nvNpt)?.dependents).toBe(1);

      const lines = await linesOf(officer, periodId);
      const base = valuesOf(lines.get(nvBase));
      const npt = valuesOf(lines.get(nvNpt));
      // THU_NHAP_CHIU_THUE = 20.000.000 − 11.000.000 (− NPT) — phép trừ đơn giản, không cắt bậc.
      expect(base.THU_NHAP_CHIU_THUE).toBe(9_000_000);
      expect(base.TNCN).toBe(650_000);
      expect(npt.THU_NHAP_CHIU_THUE).toBe(4_600_000);
      expect(npt.TNCN).toBe(230_000);
      expect(base.THU_NHAP_CHIU_THUE - npt.THU_NHAP_CHIU_THUE).toBe(4_400_000); // GT_NPT × 1 (chỉ Dep C)
    }, 120_000);

    // ── C. Bản tỉ lệ luật định versioned ─────────────────────────────────────────────────────────────
    it("C1 — 3 bản tỉ lệ: giữa-tháng thua đúng-ngày-cuối-kỳ (cùng tháng); hai kỳ hai bên một mốc đổi dùng KHÁC bản (đo qua BHXH_NV thật)", async () => {
      const seedRateId = (
        await direct.query<{ id: string }>(
          `SELECT id FROM payroll_statutory_rates WHERE company_id = $1 AND deleted_at IS NULL ORDER BY effective_from DESC LIMIT 1`,
          [R.companyId],
        )
      ).rows[0].id;
      const clone = async (effectiveFrom: string, siEmployeePct: string, note: string) =>
        (
          await direct.query<{ id: string }>(
            `INSERT INTO payroll_statutory_rates
             (company_id, effective_from, si_employee_pct, hi_employee_pct, ui_employee_pct, si_employer_pct,
              hi_employer_pct, ui_employer_pct, union_employer_pct, union_employee_pct, si_cap, hi_cap, ui_cap,
              base_wage, min_region_wage, personal_deduction, dependent_deduction, pit_brackets, note)
           SELECT company_id, $2::date, $3::numeric, hi_employee_pct, ui_employee_pct, si_employer_pct, hi_employer_pct,
                  ui_employer_pct, union_employer_pct, union_employee_pct, si_cap, hi_cap, ui_cap, base_wage,
                  min_region_wage, personal_deduction, dependent_deduction, pit_brackets, $4
             FROM payroll_statutory_rates WHERE id = $1 RETURNING id`,
            [seedRateId, effectiveFrom, siEmployeePct, note],
          )
        ).rows[0].id;

      // B — mồi giữa tháng (KHÔNG được chọn); C — đúng ngày cuối kỳ tháng 06 (được chọn cho CẢ 06 và 12);
      // D — mốc đổi luật đầu 2047 (được chọn từ kỳ 02/2047 trở đi).
      const rateB = await clone("2046-06-15", "8.50", "qa1 C1 giữa tháng — KHÔNG được chọn");
      const rateC = await clone("2046-06-30", "9.00", "qa1 C1 đúng ngày cuối kỳ 06/2046");
      const rateD = await clone("2047-01-01", "9.50", "qa1 C1 mốc đổi luật 2047");

      const nvRate = await seedUser(direct, R.companyId, `nvrate@${R.slug}.test`, "x");
      await salaryProfile(R.companyId, nvRate, "15000000.00");
      await direct.query(
        `UPDATE salary_profiles SET insurance_salary = '10000000.00' WHERE company_id = $1 AND user_id = $2`,
        [R.companyId, nvRate],
      );
      await direct.query(
        `INSERT INTO payroll_employee_settings (company_id, user_id, joins_social_insurance, joins_union, created_by)
       VALUES ($1, $2, true, false, $2)`,
        [R.companyId, nvRate],
      );

      const scenarios: Array<{
        month: string;
        expectRateId: string;
        siPct: string;
        bhxhNv: number;
      }> = [
        { month: "2046-06", expectRateId: rateC, siPct: "9.00", bhxhNv: 900_000 },
        { month: "2046-12", expectRateId: rateC, siPct: "9.00", bhxhNv: 900_000 },
        { month: "2047-02", expectRateId: rateD, siPct: "9.50", bhxhNv: 950_000 },
      ];
      for (const sc of scenarios) {
        const days = weekdaysOf(sc.month);
        await present(R.companyId, nvRate, days);
        const periodId = await newPeriod(officer, sc.month, templateId);
        const calc = await as(officer).post(`/payroll-periods/${periodId}/calculate`);
        expect(calc.status, `${sc.month}: ${JSON.stringify(calc.body)}`).toBe(201);
        const line = (await linesOf(officer, periodId)).get(nvRate) as Line;
        expect(line.statutoryRateId, `${sc.month} phải dùng bản ${sc.expectRateId}`).toBe(
          sc.expectRateId,
        );
        expect(line.statutoryRateId).not.toBe(rateB);
        expect(valuesOf(line).BHXH_NV, `${sc.month} BHXH_NV theo tỉ lệ ${sc.siPct}%`).toBe(
          sc.bhxhNv,
        );
      }
    }, 180_000);

    it("C2 — bản tỉ lệ hiệu lực DUY NHẤT xoá mềm ⇒ 422 PAYROLL-ERR-022 statutory-rate-missing, kỳ KHÔNG đổi trạng thái", async () => {
      const R2 = await seedCompany(direct, "qa1arithneg");
      companyIds.push(R2.companyId);
      await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
        R2.companyId,
        JSON.stringify({ days: [1, 2, 3, 4, 5] }),
      ]);
      const hash = await new PasswordService().hash(LOGIN_PW);
      const tpl2 = await seedPayrollCatalog(direct, R2.companyId);
      const officerId2 = await seedUser(direct, R2.companyId, `officer@${R2.slug}.test`, hash);
      await grantAllPayrollPairs(direct, R2.companyId, officerId2, "qa1arithneg-officer");
      const t2 = await login(R2, `officer@${R2.slug}.test`);

      // Xoá mềm MỌI bản tỉ lệ — company này giờ KHÔNG có bản nào hiệu lực (kể cả bản seed mặc định).
      await direct.query(
        `UPDATE payroll_statutory_rates SET deleted_at = now() WHERE company_id = $1`,
        [R2.companyId],
      );

      const nv = await seedUser(direct, R2.companyId, `nv@${R2.slug}.test`, "x");
      await direct.query(
        `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances, salary_type)
       VALUES ($1, $2, '2024-01-01', '10000000.00', '[]'::jsonb, 'GROSS')`,
        [R2.companyId, nv],
      );
      const MONTH = "2046-08";
      await present(R2.companyId, nv, weekdaysOf(MONTH));

      const att = await lockedAttendancePeriod(direct, R2.companyId, MONTH);
      const p = await request(app.getHttpServer())
        .post("/payroll-periods")
        .set("Authorization", `Bearer ${t2}`)
        .send({ periodMonth: MONTH, attendancePeriodId: att, templateId: tpl2 });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      const periodId = p.body.data.id as string;
      const agent = (u: string) =>
        request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t2}`);
      expect((await agent(`/payroll-periods/${periodId}/collect`)).status).toBe(201);

      const before = await request(app.getHttpServer())
        .get(`/payroll-periods/${periodId}`)
        .set("Authorization", `Bearer ${t2}`);
      expect(before.body.data.status).toBe("CollectingData");

      const calc = await agent(`/payroll-periods/${periodId}/calculate`);
      expect(calc.status, JSON.stringify(calc.body)).toBe(422);
      expect(calc.body.error.code).toBe("PAYROLL-ERR-022");
      expect(calc.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "kind", message: "statutory-rate-missing" }),
        ]),
      );

      const after = await request(app.getHttpServer())
        .get(`/payroll-periods/${periodId}`)
        .set("Authorization", `Bearer ${t2}`);
      expect(after.body.data.status).toBe("CollectingData");
    }, 120_000);
  },
);
