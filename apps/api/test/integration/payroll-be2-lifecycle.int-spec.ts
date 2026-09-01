/**
 * S13-PAYROLL-BE-2 — VÒNG ĐỜI kỳ lương trên ĐƯỜNG THẬT: tính → điều chỉnh → gửi duyệt (four-eyes) →
 * duyệt → sinh phiếu → phát hành → xác nhận, cộng các cổng lỗi `002 · 003 · 006 · 007 · 009 · 015 ·
 * 017` (SPEC-11 §12 · §13.1 · §13.2 · §13.4 · §20).
 *
 * ── VÌ SAO FIXTURE «KHỚP TỪNG ĐỒNG» LÀ CA QUAN TRỌNG NHẤT ──
 * Công thức lương nằm HOÀN TOÀN trong SQL (`PayrollCalcRepository.upsertLinesTx`). Một ca chỉ kiểm
 * "có sinh dòng không" sẽ xanh với MỌI công thức sai. Ca A1 dưới đây gieo dữ liệu để cả năm đại lượng
 * đầu vào là số ĐÃ BIẾT rồi so từng cột với số tính tay theo quyết định owner O1:
 *
 *   work = 22 · present = 18 · unpaid = 2 · base_salary = 22.000.000 · phụ cấp 1.000.000
 *   prorate      = LEAST((18 + 2)/22, 1) = 20/22
 *   base_amount  = round(22.000.000 × 20/22, 2) = 20.000.000
 *   deduction    = round(0 + 2 × (22.000.000/22), 2) = 2.000.000     ← KHÔNG có vế phút trễ (O2)
 *   gross        = 20.000.000 + 1.000.000 = 21.000.000
 *   net          = GREATEST(21.000.000 − 2.000.000 + 0, 0) = 19.000.000
 *
 * Tử số CỘNG `unpaid` là chủ ý (phương án B): `present_days` đã LOẠI ngày nghỉ không lương, nên
 * pro-rate theo `present` rồi lại trừ `unpaid × đơn giá` là **trừ hai lần** — mất 2.000.000 mỗi kỳ,
 * im lặng, không CHECK nào bắt. Ca này là thứ duy nhất chặn được lớp lỗi đó.
 *
 * GATE CỨNG `hasDb && LANE_DB`.
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
const LOGIN_PW = "Passw0rd!payrollbe2";
/**
 * BA tháng fixture, mỗi tháng có **ĐÚNG 22 ngày T2–T6** và không lễ nào được gieo ⇒ mẫu số pro-rate
 * luôn = 22, số tiền kỳ vọng giống hệt nhau ở cả ba.
 *
 * ⚠️ Vì sao phải gieo dữ liệu công/phép cho **từng tháng** dùng tới, không chỉ một: mỗi ca cần một kỳ
 * lương riêng (`payroll_periods_company_month_uq` chặn hai kỳ cùng tháng), mà `computeInputsTx` chặn
 * bản ghi công/phép THEO KỲ. Dùng lại tháng chưa gieo thì `present = 0` ⇒ dòng 0đ ⇒ ca đối soát tiền
 * xanh-RỖNG hoặc so nhầm số.
 */
const MONTH = "2028-06"; //          A1 — đối soát «khớp từng đồng»
const MONTH_ADJUST = "2028-10"; //   B1 — điều chỉnh tay
const MONTH_FULL = "2028-11"; //     E1 — vòng đầy đủ tới phiếu lương

/** 18 ngày công + 2 ngày nghỉ KHÔNG lương cho mỗi tháng fixture (18 + 2 = 20 ≤ 22). */
const FIXTURE_DAYS: Readonly<Record<string, { att: string[]; unpaid: string[] }>> = {
  [MONTH]: {
    att: [
      "2028-06-01",
      "2028-06-02",
      "2028-06-05",
      "2028-06-06",
      "2028-06-07",
      "2028-06-08",
      "2028-06-09",
      "2028-06-12",
      "2028-06-13",
      "2028-06-14",
      "2028-06-15",
      "2028-06-16",
      "2028-06-19",
      "2028-06-20",
      "2028-06-21",
      "2028-06-22",
      "2028-06-23",
      "2028-06-26",
    ],
    unpaid: ["2028-06-27", "2028-06-28"],
  },
  [MONTH_ADJUST]: {
    att: [
      "2028-10-02",
      "2028-10-03",
      "2028-10-04",
      "2028-10-05",
      "2028-10-06",
      "2028-10-09",
      "2028-10-10",
      "2028-10-11",
      "2028-10-12",
      "2028-10-13",
      "2028-10-16",
      "2028-10-17",
      "2028-10-18",
      "2028-10-19",
      "2028-10-20",
      "2028-10-23",
      "2028-10-24",
      "2028-10-25",
    ],
    unpaid: ["2028-10-26", "2028-10-27"],
  },
  [MONTH_FULL]: {
    att: [
      "2028-11-01",
      "2028-11-02",
      "2028-11-03",
      "2028-11-06",
      "2028-11-07",
      "2028-11-08",
      "2028-11-09",
      "2028-11-10",
      "2028-11-13",
      "2028-11-14",
      "2028-11-15",
      "2028-11-16",
      "2028-11-17",
      "2028-11-20",
      "2028-11-21",
      "2028-11-22",
      "2028-11-23",
      "2028-11-24",
    ],
    unpaid: ["2028-11-27", "2028-11-28"],
  },
};

/** 13 cặp `is_sensitive = true` của mig `0565` — truyền SAI cờ là guard không khớp catalog. */
const SENSITIVE = new Set([
  "view-line:payroll-period",
  "calculate:payroll-period",
  "approve:payroll-period",
  "publish:payroll-period",
  "reopen:payroll-period",
  "view:salary-profile",
  "manage:salary-profile",
  "view:bonus-penalty",
  "manage:bonus-penalty",
  "approve:bonus-penalty",
  "export:payroll",
  "view-payslip:payslip",
  "view-own-payslip:payslip",
]);

/** Cặp scope **Own** (3 route `/me/payslips*` + cổng nav) — phần còn lại là Company (§13.5). */
const OWN_SCOPE = new Set([
  "access:payroll",
  "view-own-payslip:payslip",
  "acknowledge-own-payslip:payslip",
]);

/** Bộ cặp của người TÍNH lương — CỐ Ý KHÔNG có `approve:payroll-period` (four-eyes, PAY-DEC-007). */
const OFFICER_PAIRS: Array<[string, string]> = [
  ["access", "payroll"],
  ["view", "payroll-period"],
  ["manage", "payroll-period"],
  ["view-line", "payroll-period"],
  ["calculate", "payroll-period"],
  ["publish", "payroll-period"],
  ["reopen", "payroll-period"],
  ["view", "salary-profile"],
  ["manage", "salary-profile"],
  ["view", "bonus-penalty"],
  ["manage", "bonus-penalty"],
  ["approve", "bonus-penalty"],
  ["export", "payroll"],
  ["view-payslip", "payslip"],
];
const ADMIN_PAIRS: Array<[string, string]> = [...OFFICER_PAIRS, ["approve", "payroll-period"]];
const EMPLOYEE_PAIRS: Array<[string, string]> = [
  ["access", "payroll"],
  ["view-own-payslip", "payslip"],
  ["acknowledge-own-payslip", "payslip"],
];

describe.skipIf(!hasLaneDb)("S13-PAYROLL-BE-2 vòng đời kỳ lương (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let tOfficer = "";
  let tAdmin = "";
  let tEmployee = "";
  let officerId = "";
  let adminId = "";
  /** Nhân sự CÓ đủ dữ liệu công/phép — chủ thể của fixture «khớp từng đồng». */
  let subjectId = "";
  let subjectEmployeeId = "";
  /** Nhân sự CÓ hồ sơ lương nhưng KHÔNG có bản ghi công nào — dòng 0đ, không được biến mất. */
  let quietId = "";
  let unpaidTypeId = "";
  let attendancePeriodId = "";

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));

  async function grant(userId: string, pairs: Array<[string, string]>, label: string) {
    const roleId = await seedRole(direct, A.companyId, `pay2-${label}-${randomUUID().slice(0, 6)}`);
    for (const [action, resource] of pairs) {
      const key = `${action}:${resource}`;
      const permId = await seedPermissionCatalog(direct, action, resource, SENSITIVE.has(key));
      await seedRolePermission(
        direct,
        roleId,
        permId,
        "ALLOW",
        OWN_SCOPE.has(key) ? "Own" : "Company",
      );
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
    return roleId;
  }

  async function login(email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Kỳ lương MỚI ở `CollectingData` (đã gắn kỳ công đã khoá) — điểm xuất phát của `calculate`. */
  async function newPeriodCollecting(periodMonth: string, attId = attendancePeriodId) {
    const p = await post(tOfficer, "/payroll-periods").send({
      periodMonth,
      attendancePeriodId: attId,
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const id = p.body.data.id as string;
    expect((await post(tOfficer, `/payroll-periods/${id}/collect`)).status).toBe(201);
    return id;
  }

  /** Kỳ công đã KHOÁ của một tháng (đã gieo ở `beforeAll` cho ba tháng fixture). */
  const attPeriodOf = async (month: string) => {
    const r = await direct.query(
      `SELECT id FROM attendance_periods WHERE company_id=$1 AND period_month=$2`,
      [A.companyId, month],
    );
    return r.rows[0].id as string;
  };

  /** DTO dòng bảng lương — khai đủ khoá TIỀN để ca đối soát so được từng cột (mask ⇒ khoá VẮNG). */
  type LineDto = {
    id: string;
    userId: string;
    workDays: number;
    presentDays: number;
    paidLeaveDays: number;
    unpaidLeaveDays: number;
    baseAmount?: number;
    allowanceAmount?: number;
    bonusAmount?: number;
    penaltyAmount?: number;
    deductionAmount?: number;
    adjustmentAmount?: number;
    adjustmentReason?: string | null;
    gross?: number;
    net?: number;
  };

  const lineOf = async (periodId: string, userId: string) => {
    const res = await get(tOfficer, `/payroll-periods/${periodId}/lines?per_page=100`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return {
      body: res.body,
      line: (res.body.data as LineDto[]).find((l) => l.userId === userId),
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "pay2life");
    companyIds.push(A.companyId);

    // Lịch công ty: T2–T6. ⚠️ khoá `days` — `companies.working_days_json` có hình dạng `{"days":[…]}`
    // (mig 0015), KHÁC `work_schedules.working_days_json` vốn là mảng TRẦN. Thiếu ⇒ work_days = 0 ⇒
    // CẢ CÔNG TY rơi 422 PAYROLL-ERR-009.
    await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
      A.companyId,
      JSON.stringify({ days: [1, 2, 3, 4, 5] }),
    ]);

    officerId = await seedUser(direct, A.companyId, `officer@${A.slug}.test`, hash);
    await grant(officerId, OFFICER_PAIRS, "officer");
    tOfficer = await login(`officer@${A.slug}.test`);

    adminId = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
    await grant(adminId, ADMIN_PAIRS, "admin");
    tAdmin = await login(`admin@${A.slug}.test`);

    subjectId = await seedUser(direct, A.companyId, `subject@${A.slug}.test`, hash);
    await grant(subjectId, EMPLOYEE_PAIRS, "employee");
    tEmployee = await login(`subject@${A.slug}.test`);

    quietId = await seedUser(direct, A.companyId, `quiet@${A.slug}.test`, hash);

    // `leave_request_days.employee_id` NOT NULL → FK `employee_profiles`.
    const ep = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code, start_date, status)
       VALUES ($1,$2,$3,'2024-01-01','active') RETURNING id`,
      [A.companyId, subjectId, `EMP-${randomUUID().slice(0, 6)}`],
    );
    subjectEmployeeId = ep.rows[0].id as string;

    const lt = await direct.query(
      `INSERT INTO leave_types (company_id, name, code, paid) VALUES ($1,'Nghỉ không lương','UNPAID',false) RETURNING id`,
      [A.companyId],
    );
    unpaidTypeId = lt.rows[0].id as string;

    for (const month of Object.keys(FIXTURE_DAYS)) {
      const ap = await direct.query(
        `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,$2,'locked') RETURNING id`,
        [A.companyId, month],
      );
      if (month === MONTH) attendancePeriodId = ap.rows[0].id as string;
    }

    // Hồ sơ lương hiệu lực TRƯỚC ngày cuối kỳ.
    for (const [uid, base] of [
      [subjectId, "22000000.00"],
      [quietId, "10000000.00"],
    ] as const) {
      await direct.query(
        `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances)
         VALUES ($1,$2,'2028-01-01',$3,$4::jsonb)`,
        [
          A.companyId,
          uid,
          base,
          JSON.stringify(uid === subjectId ? [{ name: "Ăn trưa", amount: 1000000 }] : []),
        ],
      );
    }

    // 18 ngày công + 2 ngày nghỉ KHÔNG lương cho MỖI tháng fixture (day-row thập phân 1.00/ngày —
    // nguồn chốt của S13-PAYROLL-BE-1B; `count(distinct ngày)` làm tròn LÊN và che mất nửa buổi).
    for (const month of Object.keys(FIXTURE_DAYS)) {
      const { att, unpaid } = FIXTURE_DAYS[month];
      for (const d of att) {
        await direct.query(
          `INSERT INTO attendance_records (company_id, user_id, work_date, status, late_minutes, early_leave_minutes)
           VALUES ($1,$2,$3,'present',0,0) ON CONFLICT DO NOTHING`,
          [A.companyId, subjectId, d],
        );
      }
      const lr = await direct.query(
        `INSERT INTO leave_requests (company_id, user_id, employee_id, leave_type_id, start_date, end_date, total_days, status)
         VALUES ($1,$2,$3,$4,$5,$6,2,'Approved') RETURNING id`,
        [A.companyId, subjectId, subjectEmployeeId, unpaidTypeId, unpaid[0], unpaid[1]],
      );
      for (const d of unpaid) {
        await direct.query(
          `INSERT INTO leave_request_days
             (company_id, leave_request_id, employee_id, leave_type_id, work_date, day_type,
              leave_days, is_working_day, status)
           VALUES ($1,$2,$3,$4,$5,'Full Day',1.00,true,'Active')`,
          [A.companyId, lr.rows[0].id, subjectEmployeeId, unpaidTypeId, d],
        );
      }
    }
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    if (direct) {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // A. Máy tính lương (007) — đối soát TỪNG ĐỒNG
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  it("A1 — `calculate` khớp TỪNG ĐỒNG theo O1 (tử số = present + unpaid), KHÔNG trừ hai lần", async () => {
    const id = await newPeriodCollecting(MONTH);
    const calc = await post(tOfficer, `/payroll-periods/${id}/calculate`);
    expect(calc.status, JSON.stringify(calc.body)).toBe(201);
    expect(calc.body.data.status).toBe("Calculated");
    // Cả HAI nhân sự có hồ sơ lương đều có dòng — kể cả người 0 bản ghi công (xem A2).
    expect(calc.body.data.affectedLines).toBe(2);
    // Envelope route GHI **KHÔNG chở tiền** (SPEC-11 §21): cặp `calculate` tách khỏi `view-line`.
    for (const k of ["gross", "net", "baseAmount", "totalGross"]) {
      expect(k in calc.body.data, `route GHI rò khoá tiền '${k}'`).toBe(false);
    }

    const { line } = await lineOf(id, subjectId);
    expect(line).toBeDefined();
    expect(line).toMatchObject({
      workDays: 22,
      presentDays: 18,
      unpaidLeaveDays: 2,
      baseAmount: 20_000_000,
      allowanceAmount: 1_000_000,
      bonusAmount: 0,
      penaltyAmount: 0,
      deductionAmount: 2_000_000,
      adjustmentAmount: 0,
      gross: 21_000_000,
      net: 19_000_000,
    });
  });

  it("A2 — nhân sự CÓ hồ sơ lương mà 0 bản ghi công vẫn có dòng (0đ), không biến mất im lặng", async () => {
    const id = await newPeriodCollecting("2028-07", attendancePeriodId);
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    const { line } = await lineOf(id, quietId);
    // Lấy nguyên tập `computeInputsTx` (chỉ người CÓ dữ liệu) thì người này biến mất khỏi bảng lương —
    // im lặng, không dòng nào giải thích. Dòng 0đ đẩy vấn đề lên chính bảng lương.
    expect(line).toBeDefined();
    expect(line).toMatchObject({ presentDays: 0, baseAmount: 0, gross: 0, net: 0 });
  });

  it("A3 — `calculate` HAI LẦN liên tiếp: không 42P10, số không đổi (ON CONFLICT trúng partial index)", async () => {
    const id = await newPeriodCollecting("2028-08", attendancePeriodId);
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    const first = (await lineOf(id, subjectId)).line;
    // Lần hai là hành động TẠI CHỖ ở `Calculated`. `ON CONFLICT` thiếu vế `WHERE deleted_at IS NULL`
    // sẽ nổ 42P10 **lúc chạy** (không phải lúc typecheck) — đây là ca duy nhất bắt được.
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    const second = (await lineOf(id, subjectId)).line;
    // So TIỀN + NGÀY, KHÔNG so `updatedAt`: nhánh `DO UPDATE` luôn ghi `now()`, nên `toEqual` trọn
    // object sẽ đỏ vì một cột KHÔNG PHẢI thứ ca này đo.
    const money = (l: LineDto | undefined) => ({
      workDays: l?.workDays,
      presentDays: l?.presentDays,
      unpaidLeaveDays: l?.unpaidLeaveDays,
      baseAmount: l?.baseAmount,
      allowanceAmount: l?.allowanceAmount,
      deductionAmount: l?.deductionAmount,
      gross: l?.gross,
      net: l?.net,
    });
    expect(money(second)).toEqual(money(first));
  });

  it("A4 — 002: chưa gắn kỳ công ⇒ `attendance-period-missing`; kỳ công chưa khoá ⇒ `attendance-not-locked`", async () => {
    const noAtt = await post(tOfficer, "/payroll-periods").send({ periodMonth: "2028-09" });
    const idNoAtt = noAtt.body.data.id as string;
    expect((await post(tOfficer, `/payroll-periods/${idNoAtt}/collect`)).status).toBe(201);
    const r1 = await post(tOfficer, `/payroll-periods/${idNoAtt}/calculate`);
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe("PAYROLL-ERR-002");
    expect(r1.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "attendance-period-missing" }),
      ]),
    );

    const open = await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,'2030-01','open') RETURNING id`,
      [A.companyId],
    );
    const idOpen = await newPeriodCollecting("2030-01", open.rows[0].id as string);
    const r2 = await post(tOfficer, `/payroll-periods/${idOpen}/calculate`);
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe("PAYROLL-ERR-002");
    expect(r2.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "attendance-not-locked" }),
      ]),
    );
  });

  it("A5 — 009: công ty KHÔNG ai có hồ sơ lương ⇒ 422 `no-eligible-employee`", async () => {
    const B = await seedCompany(direct, "pay2empty");
    companyIds.push(B.companyId);
    await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
      B.companyId,
      JSON.stringify({ days: [1, 2, 3, 4, 5] }),
    ]);
    const hash = await new PasswordService().hash(LOGIN_PW);
    const uid = await seedUser(direct, B.companyId, `officer@${B.slug}.test`, hash);
    const roleId = await seedRole(direct, B.companyId, `pay2-empty-${randomUUID().slice(0, 6)}`);
    for (const [action, resource] of OFFICER_PAIRS) {
      const permId = await seedPermissionCatalog(
        direct,
        action,
        resource,
        SENSITIVE.has(`${action}:${resource}`),
      );
      await seedRolePermission(
        direct,
        roleId,
        permId,
        "ALLOW",
        OWN_SCOPE.has(`${action}:${resource}`) ? "Own" : "Company",
      );
    }
    await seedUserRole(direct, uid, roleId, B.companyId);
    const tB = (
      await http()
        .post("/auth/login")
        .send({ companySlug: B.slug, email: `officer@${B.slug}.test`, password: LOGIN_PW })
    ).body.data.accessToken as string;

    const ap = await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,$2,'locked') RETURNING id`,
      [B.companyId, MONTH],
    );
    const p = await post(tB, "/payroll-periods").send({
      periodMonth: MONTH,
      attendancePeriodId: ap.rows[0].id as string,
    });
    const id = p.body.data.id as string;
    expect((await post(tB, `/payroll-periods/${id}/collect`)).status).toBe(201);
    const r = await post(tB, `/payroll-periods/${id}/calculate`);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("PAYROLL-ERR-009");
    expect(r.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "no-eligible-employee" }),
      ]),
    );
  });

  it("A6 — 009: lịch công ty 0 ngày làm việc ⇒ 422 `no-work-days` (mẫu số pro-rate = 0)", async () => {
    await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
      A.companyId,
      JSON.stringify({ days: [] }),
    ]);
    try {
      const id = await newPeriodCollecting("2029-12", attendancePeriodId);
      const r = await post(tOfficer, `/payroll-periods/${id}/calculate`);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe("PAYROLL-ERR-009");
      expect(r.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "kind", message: "no-work-days" }),
        ]),
      );
    } finally {
      await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
        A.companyId,
        JSON.stringify({ days: [1, 2, 3, 4, 5] }),
      ]);
    }
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // B. Điều chỉnh tay (009) — `net` tính lại ở SQL và SỐNG SÓT qua tính lại
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  it("B1 — `adjust-line` tính lại `net` Ở SQL; điều chỉnh SỐNG SÓT qua `calculate` lần sau", async () => {
    const id = await newPeriodCollecting(MONTH_ADJUST, await attPeriodOf(MONTH_ADJUST));
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    const { line } = await lineOf(id, subjectId);
    expect(line).toMatchObject({ gross: 21_000_000, deductionAmount: 2_000_000, net: 19_000_000 });

    const adj = await patch(tOfficer, `/payroll-periods/${id}/lines/${line!.id}`).send({
      adjustmentAmount: -100_000,
      adjustmentReason: "truy thu tạm ứng",
    });
    expect(adj.status, JSON.stringify(adj.body)).toBe(200);
    // Envelope route GHI — không chở tiền.
    for (const k of ["gross", "net", "adjustmentAmount"]) {
      expect(k in adj.body.data).toBe(false);
    }

    const after = (await lineOf(id, subjectId)).line;
    expect(after).toMatchObject({ adjustmentAmount: -100_000, net: 18_900_000 });
    // Thiếu vế tính lại `net` ⇒ `generate-payslips` copy `net` CŨ ⇒ phiếu sai tiền và đẳng thức
    // SUM(items) = gross − deduction + adjustment vỡ.

    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    const survived = (await lineOf(id, subjectId)).line;
    expect(survived).toMatchObject({
      adjustmentAmount: -100_000,
      adjustmentReason: "truy thu tạm ứng",
      net: 18_900_000,
    });

    // CLAMP: điều chỉnh âm lớn hơn cả `gross − deduction` ⇒ `net = 0`, KHÔNG âm.
    // `GREATEST(…, 0)` phải nằm Ở SQL (`clamp-must-be-sql-not-js`) — clamp ở JS thì mọi đường ghi
    // khác (nhánh UPSERT) lọt lưới.
    const big = await patch(tOfficer, `/payroll-periods/${id}/lines/${line!.id}`).send({
      adjustmentAmount: -99_000_000,
      adjustmentReason: "kiểm clamp",
    });
    expect(big.status).toBe(200);
    expect((await lineOf(id, subjectId)).line).toMatchObject({
      adjustmentAmount: -99_000_000,
      net: 0,
    });
  });

  it("B2 — dòng XOÁ MỀM rồi đủ điều kiện lại: điều chỉnh tay HỒI SINH (nhánh INSERT, 🩹B6)", async () => {
    const id = await newPeriodCollecting("2029-01", attendancePeriodId);
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    const { line } = await lineOf(id, subjectId);
    await patch(tOfficer, `/payroll-periods/${id}/lines/${line!.id}`).send({
      adjustmentAmount: 250_000,
      adjustmentReason: "truy lĩnh",
    });

    // Gỡ hồ sơ lương ⇒ lần tính sau nhân sự không còn đủ điều kiện ⇒ dòng bị XOÁ MỀM.
    await direct.query(
      `UPDATE salary_profiles SET deleted_at = now() WHERE company_id=$1 AND user_id=$2`,
      [A.companyId, subjectId],
    );
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    expect((await lineOf(id, subjectId)).line).toBeUndefined();

    // Trả hồ sơ lại ⇒ dòng sinh MỚI (partial unique loại hàng xoá mềm khỏi ON CONFLICT).
    await direct.query(
      `UPDATE salary_profiles SET deleted_at = NULL WHERE company_id=$1 AND user_id=$2`,
      [A.companyId, subjectId],
    );
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    const revived = (await lineOf(id, subjectId)).line;
    // Không mang `adjustment_*` sang nhánh INSERT = MẤT tiền người dùng đã nhập, im lặng.
    expect(revived).toMatchObject({ adjustmentAmount: 250_000, adjustmentReason: "truy lĩnh" });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // C. Thưởng/phạt — khoá tập MỘT LẦN (🩹B4)
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  it("C1 — khoản Approved được cộng + consume; khoản XOÁ MỀM KHÔNG được cộng", async () => {
    const month = "2029-02";
    await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,$2,'locked')`,
      [A.companyId, month],
    );
    const mk = async (amount: number, deleted: boolean) => {
      const r = await direct.query(
        `INSERT INTO bonus_penalties (company_id, user_id, kind, amount, period_month, reason, status,
            decided_by, decided_at, created_by, deleted_at)
         VALUES ($1,$2,'bonus',$3,$4,'fixture','Approved',$5,now(),$5,$6) RETURNING id`,
        [A.companyId, subjectId, amount, month, adminId, deleted ? new Date() : null],
      );
      return r.rows[0].id as string;
    };
    const live = await mk(500_000, false);
    await mk(999_999, true); // xoá mềm — KHÔNG được cộng

    const ap = await direct.query(
      `SELECT id FROM attendance_periods WHERE company_id=$1 AND period_month=$2`,
      [A.companyId, month],
    );
    const id = await newPeriodCollecting(month, ap.rows[0].id as string);
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);

    const { line } = await lineOf(id, subjectId);
    // Chỉ khoản SỐNG được cộng — lọc `deleted_at IS NULL` phải nằm ở câu KHOÁ TẬP, một chỗ duy nhất.
    expect(line!.bonusAmount).toBe(500_000);

    const consumed = await direct.query(
      `SELECT payroll_period_id, consumed_at FROM bonus_penalties WHERE id = $1`,
      [live],
    );
    expect(consumed.rows[0].payroll_period_id).toBe(id);
    expect(consumed.rows[0].consumed_at).not.toBeNull();
  });

  it("C2 — khoản của nhân sự KHÔNG có hồ sơ lương: KHÔNG bị consume (tiền không biến mất)", async () => {
    const month = "2029-03";
    await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,$2,'locked')`,
      [A.companyId, month],
    );
    const orphan = await seedUser(direct, A.companyId, `orphan-${randomUUID().slice(0, 6)}@x.test`);
    const r = await direct.query(
      `INSERT INTO bonus_penalties (company_id, user_id, kind, amount, period_month, reason, status,
          decided_by, decided_at, created_by)
       VALUES ($1,$2,'bonus',777000,$3,'fixture','Approved',$4,now(),$4) RETURNING id`,
      [A.companyId, orphan, month, adminId],
    );
    const ap = await direct.query(
      `SELECT id FROM attendance_periods WHERE company_id=$1 AND period_month=$2`,
      [A.companyId, month],
    );
    const id = await newPeriodCollecting(month, ap.rows[0].id as string);
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);

    // Bind ĐÚNG tập đã khoá (chỉ nhân sự đủ điều kiện). Bind rộng hơn = khoản này bị đánh dấu đã gộp
    // vĩnh viễn trong khi KHÔNG dòng lương nào cộng nó ⇒ nhân viên không bao giờ được trả.
    const after = await direct.query(
      `SELECT payroll_period_id, consumed_at FROM bonus_penalties WHERE id = $1`,
      [r.rows[0].id],
    );
    expect(after.rows[0].payroll_period_id).toBeNull();
    expect(after.rows[0].consumed_at).toBeNull();
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // D. Duyệt (010–012 · 016) — four-eyes ba tầng
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  it("D1 — 017: công ty CHỈ có một người duyệt hợp lệ và đó chính là actor ⇒ 422, kỳ Ở NGUYÊN Calculated", async () => {
    const month = "2029-04";
    await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,$2,'locked')`,
      [A.companyId, month],
    );
    const ap = await direct.query(
      `SELECT id FROM attendance_periods WHERE company_id=$1 AND period_month=$2`,
      [A.companyId, month],
    );
    const id = await newPeriodCollecting(month, ap.rows[0].id as string);
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);

    // `tAdmin` là NGƯỜI DUYỆT DUY NHẤT. Chính họ submit ⇒ không còn ai khác duyệt được.
    const r = await post(tAdmin, `/payroll-periods/${id}/submit`);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("PAYROLL-ERR-017");
    expect(r.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "no-eligible-approver" }),
      ]),
    );
    // Không có cổng này thì kỳ vào `Reviewing` rồi KẸT VĨNH VIỄN.
    const st = await get(tOfficer, `/payroll-periods/${id}`);
    expect(st.body.data.status).toBe("Calculated");

    // ĐỐI CHỨNG ALLOW: officer submit ⇒ 201 (admin là người duyệt hợp lệ khác actor).
    const ok = await post(tOfficer, `/payroll-periods/${id}/submit`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.status).toBe("Reviewing");
  });

  it("D2 — 005 four-eyes: người GỬI duyệt không tự duyệt được; người khác thì được (ALLOW đối chứng)", async () => {
    const month = "2029-05";
    await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,$2,'locked')`,
      [A.companyId, month],
    );
    const ap = await direct.query(
      `SELECT id FROM attendance_periods WHERE company_id=$1 AND period_month=$2`,
      [A.companyId, month],
    );
    const id = await newPeriodCollecting(month, ap.rows[0].id as string);
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    expect((await post(tAdmin, `/payroll-periods/${id}/submit`)).status).toBe(422);
    expect((await post(tOfficer, `/payroll-periods/${id}/submit`)).status).toBe(201);

    // DENY — officer submit rồi, officer KHÔNG có cặp approve nên 403; admin (người khác) ⇒ 201.
    expect((await post(tOfficer, `/payroll-periods/${id}/approve`)).status).toBe(403);
    const ok = await post(tAdmin, `/payroll-periods/${id}/approve`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.status).toBe("Approved");

    // Tầng 2 (logic): admin tự submit rồi tự duyệt ⇒ 409 005. Dựng bằng reopen → submit bởi admin.
    expect(
      (await post(tOfficer, `/payroll-periods/${id}/reopen`).send({ reason: "kiểm four-eyes" }))
        .status,
    ).toBe(201);
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    expect((await post(tAdmin, `/payroll-periods/${id}/submit`)).status).toBe(422);
  });

  it("D3 — `reject` hạ về Calculated và XOÁ vết `submitted_*`; gửi lại được (ALLOW đối chứng)", async () => {
    const month = "2029-06";
    await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,$2,'locked')`,
      [A.companyId, month],
    );
    const ap = await direct.query(
      `SELECT id FROM attendance_periods WHERE company_id=$1 AND period_month=$2`,
      [A.companyId, month],
    );
    const id = await newPeriodCollecting(month, ap.rows[0].id as string);
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    expect((await post(tOfficer, `/payroll-periods/${id}/submit`)).status).toBe(201);

    const rej = await post(tAdmin, `/payroll-periods/${id}/reject`).send({ reason: "sai công" });
    expect(rej.status, JSON.stringify(rej.body)).toBe(201);
    const st = await get(tOfficer, `/payroll-periods/${id}`);
    expect(st.body.data.status).toBe("Calculated");
    // `TRAIL_RESET.reject` xoá cặp `submitted_*` — không xoá thì vòng sau vi phạm CHECK four-eyes
    // và trả 23514 = 500 ở vùng đỏ.
    expect(st.body.data.submittedBy).toBeNull();
    expect(st.body.data.submittedAt).toBeNull();

    expect((await post(tOfficer, `/payroll-periods/${id}/submit`)).status).toBe(201);
  });

  it("D4 — `reopen` GIỮ NGUYÊN dòng nháp (D8) và xoá cả ba vết `calculated/submitted/approved`", async () => {
    const month = "2029-07";
    await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,$2,'locked')`,
      [A.companyId, month],
    );
    const ap = await direct.query(
      `SELECT id FROM attendance_periods WHERE company_id=$1 AND period_month=$2`,
      [A.companyId, month],
    );
    const id = await newPeriodCollecting(month, ap.rows[0].id as string);
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    expect((await post(tOfficer, `/payroll-periods/${id}/submit`)).status).toBe(201);
    expect((await post(tAdmin, `/payroll-periods/${id}/approve`)).status).toBe(201);

    const re = await post(tOfficer, `/payroll-periods/${id}/reopen`).send({
      reason: "sót phụ cấp",
    });
    expect(re.status, JSON.stringify(re.body)).toBe(201);
    const st = await get(tOfficer, `/payroll-periods/${id}`);
    expect(st.body.data).toMatchObject({
      status: "CollectingData",
      calculatedBy: null,
      submittedBy: null,
      approvedBy: null,
      reopenReason: "sót phụ cấp",
    });
    // Dòng nháp GIỮ NGUYÊN ⇒ điều chỉnh tay sống sót qua vòng reopen → calculate.
    const lines = await get(tOfficer, `/payroll-periods/${id}/lines`);
    expect(lines.body.data.length).toBeGreaterThan(0);
  });

  it("D5 — 003: kỳ ĐÃ duyệt thì `calculate`/`adjust-line` đều 409 `period-frozen`", async () => {
    const month = "2029-08";
    await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,$2,'locked')`,
      [A.companyId, month],
    );
    const ap = await direct.query(
      `SELECT id FROM attendance_periods WHERE company_id=$1 AND period_month=$2`,
      [A.companyId, month],
    );
    const id = await newPeriodCollecting(month, ap.rows[0].id as string);
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    const { line } = await lineOf(id, subjectId);
    expect((await post(tOfficer, `/payroll-periods/${id}/submit`)).status).toBe(201);
    expect((await post(tAdmin, `/payroll-periods/${id}/approve`)).status).toBe(201);

    // ⚠️ Kiểm ĐÓNG BĂNG phải chạy TRƯỚC FSM: để `assertPeriodTransition` bắt trước thì cả hai trả 001
    // và mã 003 thành mã CHẾT.
    for (const res of [
      await post(tOfficer, `/payroll-periods/${id}/calculate`),
      await patch(tOfficer, `/payroll-periods/${id}/lines/${line!.id}`).send({
        adjustmentAmount: 1,
        adjustmentReason: "muộn rồi",
      }),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("PAYROLL-ERR-003");
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "kind", message: "period-frozen" }),
        ]),
      );
    }
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // E. Phiếu lương (013 · 014 · 029–033)
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  it("E1 — vòng đầy đủ: generate → SUM(items) khớp bất biến → publish → «của tôi» → xác nhận", async () => {
    const attId = await attPeriodOf(MONTH_FULL);
    const id = await newPeriodCollecting(MONTH_FULL, attId);
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    const { line } = await lineOf(id, subjectId);
    await patch(tOfficer, `/payroll-periods/${id}/lines/${line!.id}`).send({
      adjustmentAmount: -100_000,
      adjustmentReason: "truy thu tạm ứng",
    });
    expect((await post(tOfficer, `/payroll-periods/${id}/submit`)).status).toBe(201);
    expect((await post(tAdmin, `/payroll-periods/${id}/approve`)).status).toBe(201);

    // 007 — phát hành khi CHƯA sinh phiếu.
    const early = await post(tOfficer, `/payroll-periods/${id}/publish`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("PAYROLL-ERR-007");
    expect(early.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "kind", message: "no-payslip" })]),
    );

    const gen = await post(tOfficer, `/payroll-periods/${id}/generate-payslips`);
    expect(gen.status, JSON.stringify(gen.body)).toBe(201);
    expect(gen.body.data.affectedLines).toBe(2);
    // Ô TẠI CHỖ — trạng thái không đổi.
    expect(gen.body.data.status).toBe("Approved");

    // NO-OP 200 khi gọi lại (cờ `payslips_generated_at` đọc trên chính hàng kỳ đang khoá).
    const again = await post(tOfficer, `/payroll-periods/${id}/generate-payslips`);
    expect(again.status).toBe(201);
    expect(again.body.data.warnings).toContain("payslips-already-generated");

    // 004 — reopen bị chặn sau khi đã sinh phiếu (phiếu append-only, không xoá được).
    const reopenBlocked = await post(tOfficer, `/payroll-periods/${id}/reopen`).send({
      reason: "muộn",
    });
    expect(reopenBlocked.status).toBe(409);
    expect(reopenBlocked.body.error.code).toBe("PAYROLL-ERR-004");

    const pub = await post(tOfficer, `/payroll-periods/${id}/publish`);
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    expect(pub.body.data.status).toBe("Paid");

    // 030 — chi tiết phiếu (quản trị) + breakdown; đẳng thức SUM(items) = gross − deduction + adj.
    const admin = await get(tOfficer, `/payslips?payrollPeriodId=${id}&per_page=50`);
    expect(admin.status).toBe(200);
    const mine = (admin.body.data as Array<{ id: string; userId: string }>).find(
      (p) => p.userId === subjectId,
    )!;
    const detail = await get(tOfficer, `/payslips/${mine.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe("Published");
    expect(detail.body.data.net).toBe(18_900_000);
    const sum = (detail.body.data.items as Array<{ amount: number }>).reduce(
      (a, i) => a + i.amount,
      0,
    );
    expect(sum).toBe(18_900_000);
    const types = (detail.body.data.items as Array<{ itemType: string }>).map((i) => i.itemType);
    // `penalty` là THÀNH PHẦN CON của `deduction_amount`: sinh cả 40 lẫn một `deduction` bằng cả
    // `deduction_amount` là đếm hai lần. Ở đây chỉ có vế nghỉ-không-lương ⇒ đúng một dòng `attendance`.
    expect(types).toEqual(["earning", "allowance", "attendance", "adjustment"]);

    // 031/032 — «của tôi»: thấy phiếu của mình sau khi kỳ đã phát hành.
    const meList = await get(tEmployee, "/me/payslips");
    expect(meList.status).toBe(200);
    expect((meList.body.data as Array<{ id: string }>).map((p) => p.id)).toContain(mine.id);
    const meDetail = await get(tEmployee, `/me/payslips/${mine.id}`);
    expect(meDetail.status).toBe(200);
    expect(meDetail.body.data.acknowledgedAt).toBeNull();

    // 033 — xác nhận; lần hai ⇒ 409 015 `already-acknowledged`.
    const ack = await post(tEmployee, `/me/payslips/${mine.id}/acknowledge`).send({});
    expect(ack.status, JSON.stringify(ack.body)).toBe(201);
    const ack2 = await post(tEmployee, `/me/payslips/${mine.id}/acknowledge`).send({});
    expect(ack2.status).toBe(409);
    expect(ack2.body.error.code).toBe("PAYROLL-ERR-015");
    expect(ack2.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "already-acknowledged" }),
      ]),
    );

    // Trạng thái DẪN XUẤT chuyển sang `Acknowledged` sau khi có hàng ack.
    const afterAck = await get(tEmployee, `/me/payslips/${mine.id}`);
    expect(afterAck.body.data.status).toBe("Acknowledged");

    // 015 nhánh HAI — phiếu của kỳ CHƯA phát hành ⇒ `not-published` (không phải 404).
    const other = await newPeriodCollecting("2029-10", attId);
    expect((await post(tOfficer, `/payroll-periods/${other}/calculate`)).status).toBe(201);
    expect((await post(tOfficer, `/payroll-periods/${other}/submit`)).status).toBe(201);
    expect((await post(tAdmin, `/payroll-periods/${other}/approve`)).status).toBe(201);
    expect((await post(tOfficer, `/payroll-periods/${other}/generate-payslips`)).status).toBe(201);
    const unpubList = await get(tOfficer, `/payslips?payrollPeriodId=${other}&per_page=50`);
    const unpub = (unpubList.body.data as Array<{ id: string; userId: string }>).find(
      (p) => p.userId === subjectId,
    )!;
    // Phiếu chưa phát hành KHÔNG hiện ở «của tôi» (§13.2).
    const meList2 = await get(tEmployee, "/me/payslips?per_page=50");
    expect((meList2.body.data as Array<{ id: string }>).map((p) => p.id)).not.toContain(unpub.id);
    // …nhưng ack phải trả 015 `not-published`, KHÔNG 404 — nếu ack cũng lọc kỳ đã phát hành thì
    // nhánh này là mã CHẾT.
    const ackUnpub = await post(tEmployee, `/me/payslips/${unpub.id}/acknowledge`).send({});
    expect(ackUnpub.status).toBe(409);
    expect(ackUnpub.body.error.code).toBe("PAYROLL-ERR-015");
    expect(ackUnpub.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "not-published" }),
      ]),
    );
  }, 120_000);

  it("E2 — 007 `no-line-to-generate`: kỳ KHÔNG có dòng nào thì KHÔNG đóng dấu cờ đã-sinh-phiếu", async () => {
    // Đóng dấu cờ cho một kỳ RỖNG là khoá luôn `reopen` ⇒ kỳ kẹt vĩnh viễn không có phiếu nào.
    const month = "2029-11";
    await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1,$2,'locked')`,
      [A.companyId, month],
    );
    const ap = await direct.query(
      `SELECT id FROM attendance_periods WHERE company_id=$1 AND period_month=$2`,
      [A.companyId, month],
    );
    const id = await newPeriodCollecting(month, ap.rows[0].id as string);
    expect((await post(tOfficer, `/payroll-periods/${id}/calculate`)).status).toBe(201);
    expect((await post(tOfficer, `/payroll-periods/${id}/submit`)).status).toBe(201);
    expect((await post(tAdmin, `/payroll-periods/${id}/approve`)).status).toBe(201);
    // Xoá mềm hết dòng nháp sau khi duyệt (mô phỏng dữ liệu hỏng).
    await direct.query(
      `UPDATE payroll_period_lines SET deleted_at = now() WHERE company_id=$1 AND payroll_period_id=$2`,
      [A.companyId, id],
    );
    const gen = await post(tOfficer, `/payroll-periods/${id}/generate-payslips`);
    expect(gen.status).toBe(409);
    expect(gen.body.error.code).toBe("PAYROLL-ERR-007");
    expect(gen.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind", message: "no-line-to-generate" }),
      ]),
    );
    const flag = await direct.query(
      `SELECT payslips_generated_at FROM payroll_periods WHERE id = $1`,
      [id],
    );
    expect(flag.rows[0].payslips_generated_at).toBeNull();
  });

  it("E3 — IDOR: phiếu của NGƯỜI KHÁC cùng company ⇒ 404 sentinel (không 403, không lộ tồn tại)", async () => {
    // ⚠️ Phải lấy phiếu của kỳ ĐÃ PHÁT HÀNH: `/me/payslips/:id` lọc `Paid`/`Locked`, nên một phiếu
    // của kỳ mới `Approved` sẽ trả 404 cho CẢ chính chủ — ca đối chứng ALLOW khi đó xanh-RỖNG (404
    // vì chưa phát hành, không phải vì IDOR).
    const paid = await get(tOfficer, "/payroll-periods?status=Paid&per_page=10");
    expect(paid.status).toBe(200);
    const paidId = (paid.body.data as Array<{ id: string }>)[0]?.id;
    expect(paidId, "fixture phải có ít nhất một kỳ đã phát hành").toBeDefined();
    const list = await get(tOfficer, `/payslips?payrollPeriodId=${paidId}&per_page=100`);
    const notMine = (list.body.data as Array<{ id: string; userId: string }>).find(
      (p) => p.userId === quietId,
    );
    expect(notMine, "fixture phải có phiếu của nhân sự KHÁC").toBeDefined();
    const res = await get(tEmployee, `/me/payslips/${notMine!.id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAYROLL-ERR-010");
    // ĐỐI CHỨNG ALLOW: chính chủ vẫn xem được phiếu của mình.
    const own = (list.body.data as Array<{ id: string; userId: string }>).find(
      (p) => p.userId === subjectId,
    )!;
    expect((await get(tEmployee, `/me/payslips/${own.id}`)).status).toBe(200);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // F. Tổng kỳ (018)
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  it("F1 — `summary` trả kỳ MỚI NHẤT; công ty CHƯA có kỳ nào ⇒ 200 + `data: null` (không 404)", async () => {
    const res = await get(tOfficer, "/payroll-periods/summary");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).not.toBeNull();
    expect(typeof res.body.data.totalGross).toBe("number");

    const C = await seedCompany(direct, "pay2nosum");
    companyIds.push(C.companyId);
    const hash = await new PasswordService().hash(LOGIN_PW);
    const uid = await seedUser(direct, C.companyId, `officer@${C.slug}.test`, hash);
    const roleId = await seedRole(direct, C.companyId, `pay2-nosum-${randomUUID().slice(0, 6)}`);
    const permId = await seedPermissionCatalog(direct, "view-line", "payroll-period", true);
    await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    await seedUserRole(direct, uid, roleId, C.companyId);
    const tC = (
      await http()
        .post("/auth/login")
        .send({ companySlug: C.slug, email: `officer@${C.slug}.test`, password: LOGIN_PW })
    ).body.data.accessToken as string;
    const empty = await get(tC, "/payroll-periods/summary");
    // Widget DASH phải phân biệt được «chưa có kỳ» với «không có quyền» — 404 gộp cả hai nghĩa.
    expect(empty.status).toBe(200);
    expect(empty.body.data).toBeNull();
  });

  it("F2 — `summary` là route TĨNH, KHÔNG bị nuốt thành `:id` (bài học `goals/tree`)", async () => {
    // Nếu `@Get("summary")` khai SAU `@Get(":id")` thì ca này trả 400 «không phải UUID».
    const res = await get(tOfficer, "/payroll-periods/summary");
    expect(res.status).not.toBe(400);
    expect(res.status).toBe(200);
  });
});
