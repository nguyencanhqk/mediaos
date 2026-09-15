/**
 * S15-PAYROLL-BE-3 — máy tính lương v2 trên ĐƯỜNG THẬT: công/phép/thưởng/phạt/tạm ứng/NPT/settings gieo DB → 007 →
 * so TỪNG ĐỒNG với bảng tay độc lập `docs/QA/evidence/S15-PAYROLL-BE-3-DOI-SOAT.md` (NV-G · NV-N) → tạm ứng bind →
 * snapshot bất biến khi sửa công thức sau Calculated → phiếu v2 theo thành phần (plan §6.2).
 *
 * Tháng fixture có ĐÚNG 22 ngày T2–T6 (mẫu số của bảng tay); ca đầu assert `workDays = 22` trước mọi số tiền.
 * Biên gieo kèm: NPT hết hạn giữa kỳ (vẫn đếm) · một NPT HAI hàng không chồng trong tháng (đếm 1) · bản tỉ lệ thứ hai
 * hiệu lực SAU kỳ (kỳ phải dùng bản ≤ cuối kỳ) · lương BH vượt trần (NV-G).
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
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  grantAllPayrollPairs,
  lockedAttendancePeriod,
  monthsWith22Weekdays,
  seedPayrollCatalog,
  setProfileItem,
  setTemplateOverride,
  weekdaysOf,
} from "../helpers/payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s15payrollbe3calc");
const [MONTH] = monthsWith22Weekdays(2045, 1);
const NEXT_MONTH_FIRST = (() => {
  const [y, m] = MONTH.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
})();

type Line = {
  id: string;
  userId: string;
  workDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  baseAmount: number;
  allowanceAmount: number;
  bonusAmount: number;
  penaltyAmount: number;
  deductionAmount: number;
  gross: number;
  net: number;
  components?: Array<{ code: string; value: number; isVisible: boolean }>;
  grossUpIterations?: number | null;
  templateFingerprint: string | null;
  statutoryRateId: string | null;
};

/** Bảng tay NV-G (evidence) — thành phần → giá trị. */
const NV_G_COMPONENTS: Record<string, number> = {
  LUONG_CO_BAN: 43909090.9,
  PHU_CAP: 1005000,
  THUONG: 2385000,
  NGHI_KHONG_LUONG: -3136363.64,
  PHAT: 300000,
  TAM_UNG: 1000000,
  TONG_THU_NHAP: 44162727.26,
  BHXH_NV: 3744000,
  BHYT_NV: 702000,
  BHTN_NV: 500000,
  DOAN_PHI: 468000,
  TONG_BH_NV: 4946000,
  THU_NHAP_CHIU_THUE: 19416727.26,
  TNCN: 2233345.45,
  TONG_KHAU_TRU: 8947345.45,
  BHXH_DN: 8190000,
  BHYT_DN: 1404000,
  BHTN_DN: 500000,
  KPCD: 936000,
};

/** Bảng tay NV-N (evidence) — lượt cuối với b* = 28.281.300,97. */
const NV_N_COMPONENTS: Record<string, number> = {
  LUONG_CO_BAN: 28281300.97,
  PHU_CAP: 500000,
  THUONG: 1000000,
  NGHI_KHONG_LUONG: -2571027.36,
  PHAT: 0,
  TAM_UNG: 0,
  TONG_THU_NHAP: 27210273.61,
  BHXH_NV: 2262504.08,
  BHYT_NV: 424219.51,
  BHTN_NV: 282813.01,
  DOAN_PHI: 0,
  TONG_BH_NV: 2969536.6,
  THU_NHAP_CHIU_THUE: 8840737.01,
  TNCN: 634073.7,
  TONG_KHAU_TRU: 3603610.3,
  BHXH_DN: 4949227.67,
  BHYT_DN: 848439.03,
  BHTN_DN: 282813.01,
  KPCD: 565626.02,
};

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-3 · calculate v2 — đối soát tay · tạm ứng · snapshot · phiếu", () => {
  let app: INestApplication;
  let direct: Pool;
  let R: SeededTenant;
  const companyIds: string[] = [];
  let tOfficer = "";
  let tAdmin = "";
  let officerId = "";
  let adminId = "";
  let templateId = "";
  let seedRateId = "";
  let futureRateId = "";
  let periodId = "";
  let nvG = "";
  let nvN = "";
  let nvC = "";
  let advanceG = "";
  let advanceOrphan = "";

  const http = () => request(app.getHttpServer());
  const as = (t: string) => ({
    get: (u: string) => http().get(u).set("Authorization", `Bearer ${t}`),
    post: (u: string) => http().post(u).set("Authorization", `Bearer ${t}`),
  });

  async function login(email: string): Promise<string> {
    const res = await http().post("/auth/login").send({ companySlug: R.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function lines(): Promise<Map<string, Line>> {
    const res = await as(tOfficer).get(`/payroll-periods/${periodId}/lines?per_page=100`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return new Map((res.body.data as Line[]).map((l) => [l.userId, l]));
  }

  const valuesOf = (l: Line | undefined): Record<string, number> =>
    Object.fromEntries((l?.components ?? []).map((c) => [c.code, c.value]));

  async function recalc(): Promise<void> {
    const res = await as(tOfficer).post(`/payroll-periods/${periodId}/calculate`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }

  async function approvedBonus(userId: string, kind: "bonus" | "penalty", amount: string) {
    await direct.query(
      `INSERT INTO bonus_penalties (company_id, user_id, kind, amount, period_month, reason, status, created_by, decided_by, decided_at)
       VALUES ($1, $2, $3, $4, $5, 'be3 calc', 'Approved', $6, $7, now())`,
      [R.companyId, userId, kind, amount, MONTH, officerId, adminId],
    );
  }

  async function approvedAdvance(userId: string, amount: string): Promise<string> {
    const r = await direct.query<{ id: string }>(
      `INSERT INTO payroll_advances (company_id, user_id, amount, deduct_period_month, reason, status, created_by)
       VALUES ($1, $2, $3, $4, 'be3 calc', 'Pending', $5) RETURNING id`,
      [R.companyId, userId, amount, MONTH, officerId],
    );
    await direct.query(
      `UPDATE payroll_advances SET status = 'Approved', decided_by = $2, decided_at = now() WHERE id = $1`,
      [r.rows[0].id, adminId],
    );
    return r.rows[0].id;
  }

  async function employee(userId: string, code: string): Promise<string> {
    const r = await direct.query<{ id: string }>(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code, start_date, status)
       VALUES ($1, $2, $3, '2020-01-01', 'active') RETURNING id`,
      [R.companyId, userId, code],
    );
    return r.rows[0].id;
  }

  async function present(userId: string, days: readonly string[]): Promise<void> {
    for (const d of days) {
      await direct.query(
        `INSERT INTO attendance_records (company_id, user_id, work_date, status, late_minutes, early_leave_minutes)
         VALUES ($1, $2, $3, 'present', 0, 0)`,
        [R.companyId, userId, d],
      );
    }
  }

  /** Một ngày nghỉ (đơn + day-row thập phân — nguồn chốt S13-PAYROLL-BE-1B). */
  async function leave(userId: string, employeeId: string, typeId: string, day: string, full: boolean) {
    const lr = await direct.query<{ id: string }>(
      `INSERT INTO leave_requests (company_id, user_id, employee_id, leave_type_id, start_date, end_date, total_days, status)
       VALUES ($1, $2, $3, $4, $5, $5, $6, 'Approved') RETURNING id`,
      [R.companyId, userId, employeeId, typeId, day, full ? 1 : 0.5],
    );
    await direct.query(
      `INSERT INTO leave_request_days
         (company_id, leave_request_id, employee_id, leave_type_id, work_date, day_type, leave_days, is_working_day, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'Active')`,
      [R.companyId, lr.rows[0].id, employeeId, typeId, day, full ? "Full Day" : "Half Day", full ? "1.00" : "0.50"],
    );
  }

  async function salaryProfile(
    userId: string,
    base: string,
    opts: { type?: "GROSS" | "NET"; insurance?: string | null; pit?: "EMPLOYEE" | "COMPANY" } = {},
  ) {
    await direct.query(
      `INSERT INTO salary_profiles
         (company_id, user_id, effective_date, base_salary, allowances, salary_type, insurance_salary, pit_payer)
       VALUES ($1, $2, '2024-01-01', $3, '[]'::jsonb, $4, $5, $6)`,
      [R.companyId, userId, base, opts.type ?? "GROSS", opts.insurance ?? null, opts.pit ?? "EMPLOYEE"],
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);

    R = await seedCompany(direct, "be3calc");
    companyIds.push(R.companyId);
    await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
      R.companyId,
      JSON.stringify({ days: [1, 2, 3, 4, 5] }),
    ]);
    templateId = await seedPayrollCatalog(direct, R.companyId);
    seedRateId = (
      await direct.query<{ id: string }>(
        `SELECT id FROM payroll_statutory_rates WHERE company_id = $1 AND deleted_at IS NULL`,
        [R.companyId],
      )
    ).rows[0].id;
    // Bản tỉ lệ thứ HAI hiệu lực NGÀY ĐẦU tháng sau — kỳ phải dùng bản ≤ cuối kỳ (số khác hẳn ⇒ dùng nhầm là lệch tiền).
    futureRateId = (
      await direct.query<{ id: string }>(
        `INSERT INTO payroll_statutory_rates
           (company_id, effective_from, si_employee_pct, hi_employee_pct, ui_employee_pct, si_employer_pct,
            hi_employer_pct, ui_employer_pct, union_employer_pct, union_employee_pct, si_cap, hi_cap, ui_cap,
            base_wage, min_region_wage, personal_deduction, dependent_deduction, pit_brackets, note)
         SELECT company_id, $2::date, 10.50, hi_employee_pct, ui_employee_pct, si_employer_pct, hi_employer_pct,
                ui_employer_pct, union_employer_pct, union_employee_pct, si_cap, hi_cap, ui_cap, base_wage,
                min_region_wage, 15500000, dependent_deduction, pit_brackets, 'be3 future'
           FROM payroll_statutory_rates WHERE id = $1 RETURNING id`,
        [seedRateId, NEXT_MONTH_FIRST],
      )
    ).rows[0].id;

    officerId = await seedUser(direct, R.companyId, `officer@${R.slug}.test`, hash);
    await grantAllPayrollPairs(direct, R.companyId, officerId, "be3c-officer");
    tOfficer = await login(`officer@${R.slug}.test`);
    adminId = await seedUser(direct, R.companyId, `admin@${R.slug}.test`, hash);
    await grantAllPayrollPairs(direct, R.companyId, adminId, "be3c-admin");
    tAdmin = await login(`admin@${R.slug}.test`);

    nvG = await seedUser(direct, R.companyId, `nvg@${R.slug}.test`, "x");
    nvN = await seedUser(direct, R.companyId, `nvn@${R.slug}.test`, "x");
    nvC = await seedUser(direct, R.companyId, `nvc@${R.slug}.test`, "x");
    const orphan = await seedUser(direct, R.companyId, `orphan@${R.slug}.test`, "x");

    await salaryProfile(nvG, "45999999.99", { insurance: "50000000.00" });
    await salaryProfile(nvN, "25000000.00", { type: "NET" });
    await salaryProfile(nvC, "30000000.00", { pit: "COMPANY" });
    await setProfileItem(direct, R.companyId, nvG, "PHU_CAP", "1005000.00");
    await setProfileItem(direct, R.companyId, nvN, "PHU_CAP", "500000.00");
    // Cột PHU_CAP ẨN trong mẫu — item phiếu vẫn phải có (ẩn chỉ là hiển thị, plan §3.2).
    await direct.query(
      `UPDATE payroll_template_components ptc SET is_visible = false
         FROM salary_components sc
        WHERE ptc.company_id = $1 AND ptc.template_id = $2
          AND sc.company_id = ptc.company_id AND sc.id = ptc.component_id AND sc.code = 'PHU_CAP'`,
      [R.companyId, templateId],
    );

    for (const [uid, si, union] of [
      [nvG, true, true],
      [nvN, true, false],
    ] as const) {
      await direct.query(
        `INSERT INTO payroll_employee_settings (company_id, user_id, joins_social_insurance, joins_union, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [R.companyId, uid, si, union, officerId],
      );
    }
    for (const [uid, name, from, to] of [
      [nvG, "NPT Hết Hạn Giữa Kỳ", "2020-01-01", `${MONTH}-10`],
      [nvG, "NPT Hai Hàng", "2020-01-01", `${MONTH}-05`],
      [nvG, "NPT Hai Hàng", `${MONTH}-20`, null],
      [nvN, "NPT Một", "2020-01-01", null],
    ] as const) {
      await direct.query(
        `INSERT INTO payroll_dependents (company_id, user_id, full_name, relationship, effective_from, effective_to)
         VALUES ($1, $2, $3, 'Child', $4, $5)`,
        [R.companyId, uid, name, from, to],
      );
    }

    const days = weekdaysOf(MONTH);
    expect(days.length).toBe(22);
    const empG = await employee(nvG, "BE3G");
    const empN = await employee(nvN, "BE3N");
    const paidType = (
      await direct.query<{ id: string }>(
        `INSERT INTO leave_types (company_id, name, code, paid) VALUES ($1, 'Phép năm BE3', 'BE3PAID', true) RETURNING id`,
        [R.companyId],
      )
    ).rows[0].id;
    const unpaidType = (
      await direct.query<{ id: string }>(
        `INSERT INTO leave_types (company_id, name, code, paid) VALUES ($1, 'Không lương BE3', 'BE3UNPAID', false) RETURNING id`,
        [R.companyId],
      )
    ).rows[0].id;
    // NV-G: 19 công + nửa ngày phép CÓ lương (present 19,5) + 1 ngày + nửa ngày KHÔNG lương (unpaid 1,5) · 1 ngày vắng.
    await present(nvG, days.slice(0, 19));
    await leave(nvG, empG, paidType, days[19], false);
    await leave(nvG, empG, unpaidType, days[20], true);
    await leave(nvG, empG, unpaidType, days[21], false);
    // NV-N: 20 công + 2 ngày KHÔNG lương.
    await present(nvN, days.slice(0, 20));
    await leave(nvN, empN, unpaidType, days[20], true);
    await leave(nvN, empN, unpaidType, days[21], true);
    // NV-C: đủ 22 công.
    await present(nvC, days);

    await approvedBonus(nvG, "bonus", "2385000.00");
    await approvedBonus(nvG, "penalty", "300000.00");
    await approvedBonus(nvN, "bonus", "1000000.00");
    advanceG = await approvedAdvance(nvG, "1000000.00");
    advanceOrphan = await approvedAdvance(orphan, "200000.00");

    const att = await lockedAttendancePeriod(direct, R.companyId, MONTH);
    const p = await as(tOfficer).post("/payroll-periods").send({ periodMonth: MONTH, attendancePeriodId: att, templateId });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    periodId = p.body.data.id as string;
    expect((await as(tOfficer).post(`/payroll-periods/${periodId}/collect`)).status).toBe(201);
  }, 300_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  it("C1 — NV-G (GROSS đủ khoản) + NV-N (NET) khớp TỪNG ĐỒNG bảng tay; NV-C (DN chịu thuế) net = gross", async () => {
    const res = await as(tOfficer).post(`/payroll-periods/${periodId}/calculate`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.affectedLines).toBe(3);
    // NV-C không có hàng settings (O-2 ⇒ không tham gia BH) · tạm ứng của người KHÔNG có hồ sơ lương không gắn (m3).
    // Chỉ SỐ ĐẾM — không tiền, không danh tính.
    expect(res.body.data.warnings).toEqual(["employees-without-settings:1", "unconsumed-advances:1"]);

    const all = await lines();
    const g = all.get(nvG);
    const n = all.get(nvN);
    const c = all.get(nvC);
    expect(g).toMatchObject({ workDays: 22, presentDays: 19.5, paidLeaveDays: 0.5, unpaidLeaveDays: 1.5 });
    expect(g).toMatchObject({
      gross: 44162727.26,
      deductionAmount: 8947345.45,
      net: 35215381.81,
      baseAmount: 43909090.9,
      allowanceAmount: 1005000,
      bonusAmount: 2385000,
      penaltyAmount: 300000,
      grossUpIterations: null,
    });
    expect(valuesOf(g)).toEqual(NV_G_COMPONENTS);

    expect(n).toMatchObject({ workDays: 22, presentDays: 20, unpaidLeaveDays: 2 });
    expect(n).toMatchObject({ gross: 27210273.61, deductionAmount: 3603610.3, net: 23606663.31, grossUpIterations: 12 });
    expect(valuesOf(n)).toEqual(NV_N_COMPONENTS);

    expect(c).toMatchObject({ gross: 30000000, deductionAmount: 0, net: 30000000 });
    expect(valuesOf(c).TNCN).toBe(2150000);

    // Không tiền — luôn có; cùng mẫu + cùng bản tỉ lệ ⇒ cùng fingerprint.
    for (const l of [g, n, c]) {
      expect(l?.templateFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(l?.statutoryRateId).toBe(seedRateId);
    }
    expect(new Set([g, n, c].map((l) => l?.templateFingerprint)).size).toBe(1);
  });

  it("C2 — snapshot CHUỖI scale 2: NPT đếm theo người (biên hết hạn giữa kỳ + hai hàng), tham gia BH/công đoàn, b*, bản tỉ lệ ≤ cuối kỳ", async () => {
    const r = await direct.query<{ user_id: string; cvj: Record<string, unknown> }>(
      `SELECT user_id, component_values_json AS cvj FROM payroll_period_lines
        WHERE payroll_period_id = $1 AND deleted_at IS NULL`,
      [periodId],
    );
    const snap = new Map(r.rows.map((x) => [x.user_id, x.cvj]));
    const g = snap.get(nvG) as Record<string, any>;
    const n = snap.get(nvN) as Record<string, any>;
    expect(g.engine).toBe("v2");
    expect(g.dependents).toBe(2);
    expect(n.dependents).toBe(1);
    expect(g.participation).toEqual({ socialInsurance: true, union: true });
    expect(n.participation).toEqual({ socialInsurance: true, union: false });
    expect(g.rates.TL_DOAN_PHI).toBe("1.00");
    expect(n.rates.TL_DOAN_PHI).toBe("0.00");
    expect(g.rates.TL_BHXH_NV).toBe("8.00");
    expect(g.statutoryRateId).toBe(seedRateId);
    expect(g.statutoryRateId).not.toBe(futureRateId);
    expect(n.grossUp).toEqual({ targetNet: "25000000.00", base: "28281300.97", iterations: 12 });
    expect(n.sys.SYS_INSURANCE_SALARY).toBe("28281300.97");
    const tncn = (g.components as Array<{ code: string; value: string }>).find((x) => x.code === "TNCN");
    expect(tncn?.value).toBe("2233345.45");
    const nghi = (g.components as Array<{ code: string; value: string }>).find((x) => x.code === "NGHI_KHONG_LUONG");
    expect(nghi?.value).toBe("-3136363.64");
  });

  it("C3 — tạm ứng: bind ⇒ Deducted + cặp; tính lại ⇒ vẫn Deducted, KHÔNG nhân đôi; tạm ứng người không đủ điều kiện KHÔNG gắn", async () => {
    const q = async (id: string) =>
      (
        await direct.query(`SELECT status, payroll_period_id, consumed_at FROM payroll_advances WHERE id = $1`, [id])
      ).rows[0];
    expect(await q(advanceG)).toMatchObject({ status: "Deducted", payroll_period_id: periodId });
    expect((await q(advanceG)).consumed_at).not.toBeNull();
    expect(await q(advanceOrphan)).toMatchObject({ status: "Approved", payroll_period_id: null, consumed_at: null });

    await recalc();
    expect(await q(advanceG)).toMatchObject({ status: "Deducted", payroll_period_id: periodId });
    const g = (await lines()).get(nvG);
    expect(g).toMatchObject({ deductionAmount: 8947345.45, net: 35215381.81 });
    expect(valuesOf(g).TAM_UNG).toBe(1000000);
  });

  it("C4 — sửa công thức mẫu SAU Calculated: đọc lại KHÔNG đổi số; tính lại ⇒ số + fingerprint đổi; gỡ sửa + tính lại ⇒ về như cũ", async () => {
    const before = (await lines()).get(nvG) as Line;
    await setTemplateOverride(direct, R.companyId, templateId, "LUONG_CO_BAN", "SYS_BASE_SALARY");
    try {
      const reread = (await lines()).get(nvG) as Line;
      expect(reread.components).toEqual(before.components);
      expect(reread.templateFingerprint).toBe(before.templateFingerprint);
      expect(reread.gross).toBe(before.gross);

      await recalc();
      const changed = (await lines()).get(nvG) as Line;
      expect(changed.templateFingerprint).not.toBe(before.templateFingerprint);
      expect(valuesOf(changed).LUONG_CO_BAN).toBe(45999999.99);
    } finally {
      await setTemplateOverride(direct, R.companyId, templateId, "LUONG_CO_BAN", null);
    }
    await recalc();
    const restored = (await lines()).get(nvG) as Line;
    expect(restored.templateFingerprint).toBe(before.templateFingerprint);
    expect(restored.gross).toBe(before.gross);
  });

  it("C5 — phiếu v2 (O-3): SUM(items) = gross − khấu trừ + điều chỉnh; item mang meta.componentCode; ẩn cột vẫn có item; DN chịu thuế ⇒ KHÔNG item TNCN", async () => {
    expect((await as(tOfficer).post(`/payroll-periods/${periodId}/submit`)).status).toBe(201);
    expect((await as(tAdmin).post(`/payroll-periods/${periodId}/approve`)).status).toBe(201);
    const gen = await as(tOfficer).post(`/payroll-periods/${periodId}/generate-payslips`);
    expect(gen.status, JSON.stringify(gen.body)).toBe(201);
    expect(gen.body.data.affectedLines).toBe(3);

    const sums = await direct.query<{ user_id: string; expected: string; actual: string }>(
      `SELECT ps.user_id, (ps.gross - ps.deduction_amount + ps.adjustment_amount)::text AS expected,
              coalesce(sum(pi.amount), 0)::text AS actual
         FROM payslips ps LEFT JOIN payslip_items pi ON pi.payslip_id = ps.id
        WHERE ps.payroll_period_id = $1
        GROUP BY ps.id`,
      [periodId],
    );
    expect(sums.rows.length).toBe(3);
    for (const s of sums.rows) expect(s.actual, s.user_id).toBe(s.expected);

    const itemsOf = async (userId: string) =>
      (
        await direct.query<{ item_type: string; amount: string; meta: Record<string, unknown> | null }>(
          `SELECT pi.item_type, pi.amount::text, pi.meta FROM payslip_items pi
             JOIN payslips ps ON ps.id = pi.payslip_id
            WHERE ps.payroll_period_id = $1 AND ps.user_id = $2 ORDER BY pi.sort_order`,
          [periodId, userId],
        )
      ).rows;
    const gItems = await itemsOf(nvG);
    const codes = gItems.map((i) => i.meta?.componentCode);
    expect(codes).toEqual([
      "LUONG_CO_BAN",
      "PHU_CAP",
      "THUONG",
      "NGHI_KHONG_LUONG",
      "PHAT",
      "TAM_UNG",
      "BHXH_NV",
      "BHYT_NV",
      "BHTN_NV",
      "DOAN_PHI",
      "TNCN",
    ]);
    expect(gItems.find((i) => i.meta?.componentCode === "PHU_CAP")?.meta?.isVisible).toBe(false);
    expect(gItems.find((i) => i.meta?.componentCode === "TNCN")).toMatchObject({ item_type: "deduction", amount: "-2233345.45" });
    expect(gItems.find((i) => i.meta?.componentCode === "NGHI_KHONG_LUONG")).toMatchObject({
      item_type: "earning",
      amount: "-3136363.64",
    });
    expect(gItems.some((i) => ["statutory_employer", "aggregate"].includes(String(i.meta?.kind)))).toBe(false);

    const cItems = await itemsOf(nvC);
    expect(cItems.map((i) => i.meta?.componentCode)).toEqual(["LUONG_CO_BAN"]);
  });
});
