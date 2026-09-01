/**
 * S13-PAYROLL-BE-1 — (A) năm đại lượng đầu vào SPEC-11 §13.4 và (B) **audit lượt ĐỌC atomic** §18.
 *
 * Bốn bẫy được đo trực tiếp, không suy luận:
 *   1. `public_holidays.company_id` NULLABLE — lễ **quốc gia** phải bị trừ khỏi `work_days`; lọc
 *      `= $companyId` là mất toàn bộ lễ quốc gia (mig `0434`).
 *   2. `holiday_type = 'WorkingDayOverride'` là ngày **LÀM BÙ** — trừ nó là trừ NGƯỢC.
 *   3. `leave_requests.status` là **UNION hoa/thường** (mig `0453`) — lọc một dạng mất một nửa dữ liệu.
 *   4. Ngày **vừa có bản ghi công vừa có phép có lương** phải đếm **MỘT** lần; cộng hai `COUNT` rời là
 *      +2/ngày, phồng tử số pro-rate (plan-review vòng 1 blocker #7).
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
import { DatabaseService } from "../../src/db/db.service";
import { PayrollInputsRepository } from "../../src/payroll/payroll-inputs.repository";
import { PayrollPeopleRepository } from "../../src/payroll/payroll-people.repository";
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
const LOGIN_PW = "Passw0rd!payrollio";
const MONTH = "2027-11"; // 2027-11: 30 ngày, 22 ngày T2–T6.

const SENSITIVE = new Set([
  "calculate:payroll-period",
  "view:salary-profile",
  "manage:salary-profile",
]);

const PAIRS: Array<[string, string]> = [
  ["access", "payroll"],
  ["view", "payroll-period"],
  ["manage", "payroll-period"],
  ["calculate", "payroll-period"],
  ["view", "salary-profile"],
  ["manage", "salary-profile"],
];

describe.skipIf(!hasLaneDb)("S13-PAYROLL-BE-1 đầu vào công/phép + audit đọc", () => {
  let app: INestApplication;
  let direct: Pool;
  let db: DatabaseService;
  let inputs: PayrollInputsRepository;
  let A: SeededTenant;
  const companyIds: string[] = [];
  let token = "";
  let workerId = "";
  let salaryProfileId = "";
  let paidTypeId = "";
  let unpaidTypeId = "";
  /** Người RIÊNG cho nhóm ca «nửa ngày» — nhóm B1..B7 tích luỹ trạng thái trên `workerId`. */
  let halfId = "";
  let halfEmployeeId = "";

  const http = () => request(app.getHttpServer());
  const get = (u: string) => http().get(u).set("Authorization", `Bearer ${token}`);

  const compute = () =>
    db.withTenant(A.companyId, (tx) => inputs.computeInputsTx(tx, A.companyId, MONTH));

  const rowOf = async (userId: string) => {
    const res = await compute();
    return { res, row: res.rows.find((r) => r.userId === userId) };
  };

  async function seedAttendance(userId: string, date: string, status: string, late = 0) {
    await direct.query(
      `INSERT INTO attendance_records (company_id, user_id, work_date, status, late_minutes, early_leave_minutes)
       VALUES ($1,$2,$3,$4,$5,0)
       ON CONFLICT DO NOTHING`,
      [A.companyId, userId, date, status, late],
    );
  }

  async function seedLeave(
    userId: string,
    typeId: string,
    from: string,
    to: string,
    status: string,
  ) {
    await direct.query(
      `INSERT INTO leave_requests (company_id, user_id, leave_type_id, start_date, end_date, total_days, status)
       VALUES ($1,$2,$3,$4,$5,1,$6)`,
      [A.companyId, userId, typeId, from, to, status],
    );
  }

  /**
   * Đơn nghỉ **kèm `leave_request_days`** — đúng như đường ghi thật (`LeaveRequestService.createDraft`
   * ghi đơn + day-rows trong CÙNG tx, `leave-request.service.ts:110`). `seedLeave` ở trên CỐ Ý không
   * ghi day-rows: nó là dữ liệu **di sản** và chạy nhánh fallback (SPEC-11 §13.4).
   */
  async function seedLeaveWithDays(
    userId: string,
    employeeId: string,
    typeId: string,
    days: { date: string; leaveDays: number; session?: "Morning" | "Afternoon" }[],
    opts: { status?: string; dayStatus?: string; dayDeleted?: boolean } = {},
  ): Promise<string> {
    const total = days.reduce((a, d) => a + d.leaveDays, 0);
    const r = await direct.query(
      `INSERT INTO leave_requests (company_id, user_id, employee_id, leave_type_id, start_date, end_date, total_days, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        A.companyId,
        userId,
        employeeId,
        typeId,
        days[0].date,
        days[days.length - 1].date,
        total,
        opts.status ?? "Approved",
      ],
    );
    const requestId = r.rows[0].id as string;
    for (const d of days) {
      await direct.query(
        `INSERT INTO leave_request_days
           (company_id, leave_request_id, employee_id, leave_type_id, work_date, day_type,
            half_day_session, leave_days, is_working_day, status, deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10)`,
        [
          A.companyId,
          requestId,
          employeeId,
          typeId,
          d.date,
          d.session ? "Half Day" : "Full Day",
          d.session ?? null,
          d.leaveDays,
          opts.dayStatus ?? "Active",
          opts.dayDeleted ? new Date() : null,
        ],
      );
    }
    return requestId;
  }

  async function seedLeaveType(code: string, paid: boolean): Promise<string> {
    const r = await direct.query(
      `INSERT INTO leave_types (company_id, name, code, paid) VALUES ($1,$2,$3,$4) RETURNING id`,
      [A.companyId, code, code, paid],
    );
    return r.rows[0].id as string;
  }

  async function seedHoliday(
    date: string,
    opts: { global?: boolean; type?: string; paid?: boolean; status?: string } = {},
  ) {
    await direct.query(
      `INSERT INTO public_holidays (company_id, holiday_code, name, holiday_date, holiday_type, is_paid_holiday, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        opts.global ? null : A.companyId,
        `H-PAYIO-${randomUUID().slice(0, 8)}`,
        `Lễ ${date}`,
        date,
        opts.type ?? "PublicHoliday",
        opts.paid ?? true,
        opts.status ?? "Active",
      ],
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    db = app.get(DatabaseService);
    inputs = app.get(PayrollInputsRepository);

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "payrollio");
    companyIds.push(A.companyId);

    // ⚠️ Hàng lễ GLOBAL (`company_id IS NULL`) **sống sót qua `cleanupTenants`** — helper đó dọn theo
    // company. Lần chạy trước để lại lễ quốc gia ⇒ `work_days` của lần này tụt 1 và ca A1 đỏ vì lý do
    // sai. Dọn hai đầu (trước + sau) theo tiền tố mã lễ RIÊNG của spec này.
    await direct.query(
      `DELETE FROM public_holidays WHERE company_id IS NULL AND holiday_code LIKE 'H-PAYIO-%'`,
    );

    // ⚠️ Hình dạng {"days":[…]} của `companies` — KHÁC mảng trần của `work_schedules` (mig 0015/0061).
    await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
      A.companyId,
      JSON.stringify({ days: [1, 2, 3, 4, 5] }),
    ]);

    const roleId = await seedRole(direct, A.companyId, "payrollio-full");
    for (const [action, resource] of PAIRS) {
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
        action === "access" ? "Own" : "Company",
      );
    }
    const uid = await seedUser(direct, A.companyId, `io@${A.slug}.test`, hash);
    await seedUserRole(direct, uid, roleId, A.companyId);
    // `seedUser` KHÔNG đặt `full_name` ⇒ điểm chiếu danh tính trả null hợp lệ. Đặt tên cho ĐÚNG một
    // người để ca C1 kiểm được vế "cảnh báo mang TÊN", không chỉ id.
    await direct.query(`UPDATE users SET full_name = 'Người Không Hồ Sơ Lương' WHERE id = $1`, [uid]);
    const login = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email: `io@${A.slug}.test`, password: LOGIN_PW });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    token = login.body.data.accessToken;

    workerId = await seedUser(direct, A.companyId, `worker@${A.slug}.test`, hash);
    halfId = await seedUser(direct, A.companyId, `half@${A.slug}.test`, hash);
    // `leave_request_days.employee_id` NOT NULL → FK `employee_profiles` ⇒ người của nhóm ca nửa ngày
    // PHẢI có hồ sơ nhân sự (khác `workerId` vốn chỉ cần user).
    const emp = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code, start_date, status)
         VALUES ($1,$2,$3,'2020-01-01','active') RETURNING id`,
      [A.companyId, halfId, `E-${halfId.slice(0, 8)}`],
    );
    halfEmployeeId = emp.rows[0].id as string;
    paidTypeId = await seedLeaveType(`PAID-${randomUUID().slice(0, 4)}`, true);
    unpaidTypeId = await seedLeaveType(`UNP-${randomUUID().slice(0, 4)}`, false);

    const sp = await http()
      .post("/salary-profiles")
      .set("Authorization", `Bearer ${token}`)
      .send({ userId: workerId, effectiveDate: `${MONTH}-01`, baseSalary: 20_000_000 });
    expect(sp.status, JSON.stringify(sp.body)).toBe(201);
    salaryProfileId = sp.body.data.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (direct) {
      // Lễ GLOBAL không thuộc company nào ⇒ `cleanupTenants` KHÔNG dọn giúp.
      await direct.query(
        `DELETE FROM public_holidays WHERE company_id IS NULL AND holiday_code LIKE 'H-PAYIO-%'`,
      );
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
  });

  // ── A. work_days ──────────────────────────────────────────────────────────────────────────────

  it("A1 — mẫu số cơ sở: 2027-11 có 22 ngày T2–T6 theo `companies.working_days_json->'days'`", async () => {
    const res = await compute();
    expect(res.workDays, "đọc sai khoá 'days' ⇒ 0 ⇒ CẢ CÔNG TY rơi 422 009").toBe(22);
    expect(res.meta.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(res.meta.presentDaysRule).toContain("approved_adjustment");
  });

  it("A2 — lễ QUỐC GIA (`company_id IS NULL`) BỊ trừ; lễ của công ty khác thì không", async () => {
    await seedHoliday(`${MONTH}-03`, { global: true }); // thứ Tư
    const res = await compute();
    expect(res.workDays, "lễ quốc gia không bị trừ ⇒ lọc `= companyId` (mất toàn bộ lễ)").toBe(21);
    expect(res.meta.holidaysExcluded).toContain(`${MONTH}-03`);
  });

  it("A3 — `WorkingDayOverride` KHÔNG bị trừ (ngày LÀM BÙ — trừ nó là trừ ngược)", async () => {
    const before = (await compute()).workDays;
    await seedHoliday(`${MONTH}-04`, { global: true, type: "WorkingDayOverride" });
    expect((await compute()).workDays, "ngày làm bù bị trừ nhầm").toBe(before);
  });

  it("A4 — lễ `status <> 'Active'` hoặc `is_paid_holiday=false` KHÔNG bị trừ", async () => {
    const before = (await compute()).workDays;
    await seedHoliday(`${MONTH}-05`, { global: true, status: "Inactive" });
    await seedHoliday(`${MONTH}-08`, { global: true, paid: false });
    expect((await compute()).workDays).toBe(before);
  });

  // ── B. present_days · leave ───────────────────────────────────────────────────────────────────

  it("B1 — đơn nghỉ `'approved'` VÀ `'Approved'` đều được đếm (CHECK là UNION hoa/thường)", async () => {
    await seedLeave(workerId, paidTypeId, `${MONTH}-09`, `${MONTH}-09`, "approved");
    await seedLeave(workerId, paidTypeId, `${MONTH}-10`, `${MONTH}-10`, "Approved");
    const { row } = await rowOf(workerId);
    expect(row?.paidLeaveDays, "lọc một dạng chữ ⇒ mất một nửa dữ liệu, âm thầm").toBe(2);
    expect(row?.presentDays).toBe(2);
  });

  it("B2 — đơn `pending` KHÔNG được đếm (ALLOW ⇔ DENY của ca B1)", async () => {
    const before = (await rowOf(workerId)).row?.paidLeaveDays ?? 0;
    await seedLeave(workerId, paidTypeId, `${MONTH}-11`, `${MONTH}-11`, "pending");
    expect((await rowOf(workerId)).row?.paidLeaveDays).toBe(before);
  });

  it("B3 — phép KHÔNG lương tách riêng, và KHÔNG vào `present_days`", async () => {
    await seedLeave(workerId, unpaidTypeId, `${MONTH}-12`, `${MONTH}-12`, "approved");
    const { row } = await rowOf(workerId);
    expect(row?.unpaidLeaveDays).toBe(1);
    expect(row?.presentDays, "phép không lương không phải ngày có mặt").toBe(2);
  });

  it("B4 — ngày VỪA có bản ghi công VỪA có phép có lương chỉ đếm MỘT lần", async () => {
    // `2027-11-09` đã có phép có lương ở ca B1; thêm bản ghi công cùng ngày.
    await seedAttendance(workerId, `${MONTH}-09`, "present");
    const { row } = await rowOf(workerId);
    // 09 (công + phép, đếm 1) + 10 (phép) = 2. Cộng hai COUNT rời sẽ ra 3.
    expect(row?.presentDays, "cộng hai COUNT rời ⇒ +2 cho một ngày, phồng tử số pro-rate").toBe(2);
  });

  it("B5 — status công hợp lệ theo quyết định OWNER; `absent`/`missing_checkin` KHÔNG tính", async () => {
    await seedAttendance(workerId, `${MONTH}-16`, "late", 15);
    await seedAttendance(workerId, `${MONTH}-17`, "early_leave", 0);
    await seedAttendance(workerId, `${MONTH}-18`, "approved_adjustment");
    const afterValid = (await rowOf(workerId)).row;
    expect(afterValid?.presentDays, "late/early_leave/approved_adjustment đều là ngày công").toBe(
      5,
    );

    await seedAttendance(workerId, `${MONTH}-19`, "absent");
    await seedAttendance(workerId, `${MONTH}-22`, "missing_checkin");
    await seedAttendance(workerId, `${MONTH}-23`, "pending_adjustment");
    expect((await rowOf(workerId)).row?.presentDays, "3 status này KHÔNG được tính").toBe(5);
  });

  it("B6 — `late_minutes` = tổng trễ + về sớm (đi trễ vẫn tính đủ ngày công, trừ riêng ở đây)", async () => {
    const { row } = await rowOf(workerId);
    expect(row?.lateMinutes).toBe(15);
  });

  it("B7 — `work_days = 0` (lịch rỗng) KHÔNG chia, chỉ trả 0 để service quyết 422", async () => {
    await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
      A.companyId,
      JSON.stringify({ days: [] }),
    ]);
    const res = await compute();
    expect(res.workDays).toBe(0);
    expect(Number.isFinite(res.workDays)).toBe(true);
    await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
      A.companyId,
      JSON.stringify({ days: [1, 2, 3, 4, 5] }),
    ]);
  });

  // ── E. nửa ngày (S13-PAYROLL-BE-1B) ──────────────────────────────────────────────────────────
  //
  // Nhóm này chạy trên NGƯỜI RIÊNG (`halfId`) và TÍCH LUỸ theo thứ tự — mỗi ca cộng thêm vào tổng của
  // ca trước, nên con số kỳ vọng viết ra tường minh ở từng ca. Ngày 2027-11-03 bị ca A2 gieo lễ quốc
  // gia ⇒ KHÔNG dùng ở đây (nó không nằm trong `cal_work`).

  const halfRow = async () => (await rowOf(halfId)).row;

  it("E1 — nghỉ NỬA BUỔI có lương ⇒ 0.5 ngày (không làm tròn LÊN thành 1)", async () => {
    await seedLeaveWithDays(halfId, halfEmployeeId, paidTypeId, [
      { date: `${MONTH}-01`, leaveDays: 0.5, session: "Morning" },
    ]);
    const row = await halfRow();
    expect(row?.paidLeaveDays, "count(distinct ngày) ⇒ 1: nửa buổi bị tính tròn một ngày").toBe(0.5);
    expect(row?.presentDays).toBe(0.5);
  });

  it("E2 — nghỉ NỬA BUỔI không lương ⇒ 0.5, và KHÔNG vào present_days", async () => {
    await seedLeaveWithDays(halfId, halfEmployeeId, unpaidTypeId, [
      { date: `${MONTH}-02`, leaveDays: 0.5, session: "Afternoon" },
    ]);
    const row = await halfRow();
    expect(row?.unpaidLeaveDays, "BE-2 trừ lương theo số này — tròn lên là trừ gấp đôi").toBe(0.5);
    expect(row?.presentDays, "phép không lương không phải ngày có mặt").toBe(0.5);
  });

  it("E3 — ngày vừa có bản ghi CÔNG vừa có phép nửa buổi có lương ⇒ present đếm ĐÚNG MỘT", async () => {
    await seedAttendance(halfId, `${MONTH}-01`, "present");
    const row = await halfRow();
    // GREATEST(1, 0.5) = 1 — cộng dồn sẽ ra 1.5 (ngày công phồng lên), cộng hai COUNT rời ra 2.
    expect(row?.presentDays, "SUM thay vì GREATEST ⇒ một ngày thành 1.5").toBe(1);
    expect(row?.paidLeaveDays, "số ngày phép KHÔNG đổi vì có bản ghi công").toBe(0.5);
  });

  it("E4 — ALLOW đối chứng: nghỉ NGUYÊN NGÀY vẫn = 1.0 (không hồi quy)", async () => {
    await seedLeaveWithDays(halfId, halfEmployeeId, paidTypeId, [
      { date: `${MONTH}-04`, leaveDays: 1 },
    ]);
    const row = await halfRow();
    expect(row?.paidLeaveDays).toBe(1.5);
    expect(row?.presentDays).toBe(2);
  });

  it("E5 — HAI đơn nửa buổi CÙNG một ngày ⇒ phép 1.0 và present ngày đó KHÔNG vượt 1", async () => {
    await seedLeaveWithDays(halfId, halfEmployeeId, paidTypeId, [
      { date: `${MONTH}-05`, leaveDays: 0.5, session: "Morning" },
    ]);
    await seedLeaveWithDays(halfId, halfEmployeeId, paidTypeId, [
      { date: `${MONTH}-05`, leaveDays: 0.5, session: "Afternoon" },
    ]);
    const row = await halfRow();
    expect(row?.paidLeaveDays).toBe(2.5);
    expect(row?.presentDays, "thiếu trần LEAST(…,1) ⇒ một ngày đếm > 1").toBe(3);
  });

  it("E6 — đơn DI SẢN không có day-row ⇒ fallback 1.0/ngày, KHÔNG rơi về 0 lặng lẽ", async () => {
    // Nguồn day-row RỖNG ≠ bằng 0. Đọc rỗng thành 0 là mất im lặng một khoản tiền.
    await seedLeave(halfId, paidTypeId, `${MONTH}-08`, `${MONTH}-08`, "approved");
    const row = await halfRow();
    expect(row?.paidLeaveDays).toBe(3.5);
    expect(row?.presentDays).toBe(4);
  });

  it("E7 — day-row `Cancelled`/đã xoá mềm KHÔNG được tính; day-row Active của CÙNG đơn vẫn tính", async () => {
    await seedLeaveWithDays(halfId, halfEmployeeId, paidTypeId, [
      { date: `${MONTH}-09`, leaveDays: 0.5, session: "Morning" },
    ]);
    const cancelled = await seedLeaveWithDays(halfId, halfEmployeeId, paidTypeId, [
      { date: `${MONTH}-10`, leaveDays: 0.5, session: "Morning" },
      { date: `${MONTH}-11`, leaveDays: 0.5, session: "Morning" },
    ]);
    // Huỷ MỘT trong hai day-row của đơn: đơn vẫn "có day-row" ⇒ không rơi fallback, và ngày bị huỷ
    // biến mất khỏi tổng — chỉ 0.5 của ngày còn Active được cộng.
    await direct.query(
      `UPDATE leave_request_days SET status='Cancelled' WHERE leave_request_id=$1 AND work_date=$2`,
      [cancelled, `${MONTH}-11`],
    );
    const row = await halfRow();
    expect(row?.paidLeaveDays).toBe(4.5);
    expect(row?.presentDays).toBe(5);
  });

  it("E8 — đơn bắc qua BIÊN THÁNG: chỉ phần ngày NẰM TRONG kỳ được tính", async () => {
    // 29–30/11 (T2,T3) + 01–03/12 — `total_days` của đơn là 5.0, nhưng kỳ 2027-11 chỉ được hưởng 2.
    // Đây là lý do `leave_requests.total_days` KHÔNG thể làm nguồn (SPEC-11 §13.4).
    await seedLeaveWithDays(halfId, halfEmployeeId, paidTypeId, [
      { date: `${MONTH}-29`, leaveDays: 1 },
      { date: `${MONTH}-30`, leaveDays: 1 },
      { date: "2027-12-01", leaveDays: 1 },
      { date: "2027-12-02", leaveDays: 1 },
      { date: "2027-12-03", leaveDays: 1 },
    ]);
    const row = await halfRow();
    expect(row?.paidLeaveDays, "lấy total_days của cả đơn ⇒ 5 ngày rơi vào tháng 11").toBe(6.5);
    expect(row?.presentDays).toBe(7);
    expect(row?.unpaidLeaveDays, "phép không lương của E2 không bị nhóm ca này đụng").toBe(0.5);
  });

  // ── C. readiness ──────────────────────────────────────────────────────────────────────────────

  it("C1 — readiness: người CÓ hồ sơ lương + CÓ công ⇒ eligible, không cảnh báo", async () => {
    const p = await http()
      .post("/payroll-periods")
      .set("Authorization", `Bearer ${token}`)
      .send({ periodMonth: MONTH });
    expect(p.status).toBe(201);
    const res = await get(`/payroll-periods/${p.body.data.id}/readiness`);
    expect(res.status).toBe(200);
    expect(res.body.data.eligibleCount).toBeGreaterThanOrEqual(1);
    const kinds = res.body.data.warnings.map((w: { userId: string; kind: string }) => w.kind);
    const forWorker = res.body.data.warnings.filter(
      (w: { userId: string }) => w.userId === workerId,
    );
    expect(forWorker, "người đủ dữ liệu không được vào danh sách cảnh báo").toEqual([]);
    // Người đăng nhập KHÔNG có hồ sơ lương ⇒ phải có cảnh báo (ALLOW đối chứng cho nhánh cảnh báo).
    expect(kinds).toContain("missing-salary-profile");
    // Cảnh báo mang TÊN qua điểm chiếu danh tính, không phải chỉ id.
    expect(
      res.body.data.warnings.some((w: { fullName: string | null }) => w.fullName !== null),
    ).toBe(true);
  });

  // ── C2. Trần quét — hợp đồng chống cắt-lặng-lẽ ────────────────────────────────────────────────

  it("C2 — `aliveUserIdsTx`: `limit: null` phủ HẾT; có trần thì báo `truncated` (không im lặng)", async () => {
    const people = app.get(PayrollPeopleRepository);
    const full = await db.withTenant(A.companyId, (tx) =>
      people.aliveUserIdsTx(tx, A.companyId, { limit: null }),
    );
    // Spec này seed ≥ 3 user (io · worker · các user của seedCompany).
    expect(full.userIds.length, "đường không trần phải phủ hết công ty").toBeGreaterThanOrEqual(2);
    expect(full.truncated, "không trần thì không bao giờ báo cắt").toBe(false);

    const capped = await db.withTenant(A.companyId, (tx) =>
      people.aliveUserIdsTx(tx, A.companyId, { limit: 1 }),
    );
    expect(capped.userIds).toHaveLength(1);
    // ⚠️ Đây là vế chống-im-lặng: trần cắt mà không có cờ thì `readiness` trả số THIẾU mà không ai
    // biết (FULL gate: silent-failure #1 / security HIGH #2).
    expect(capped.truncated, "cắt mà không báo = mất dữ liệu trong im lặng").toBe(true);

    // Thứ tự ỔN ĐỊNH — hai lần gọi cùng trần phải cắt CÙNG một tập.
    const again = await db.withTenant(A.companyId, (tx) =>
      people.aliveUserIdsTx(tx, A.companyId, { limit: 1 }),
    );
    expect(again.userIds).toEqual(capped.userIds);
  });

  it("C3 — `readiness` KHÔNG dính trần của picker: eligibleCount đếm trên tập ĐẦY ĐỦ", async () => {
    const full = await db.withTenant(A.companyId, (tx) =>
      app.get(PayrollPeopleRepository).aliveUserIdsTx(tx, A.companyId, { limit: null }),
    );
    const p = await http()
      .post("/payroll-periods")
      .set("Authorization", `Bearer ${token}`)
      .send({ periodMonth: "2027-12" });
    expect(p.status).toBe(201);
    const res = await get(`/payroll-periods/${p.body.data.id}/readiness`);
    expect(res.status).toBe(200);
    // ⚠️ Hai tập CHỒNG nhau: `missing-attendance` áp cho người ĐÃ eligible (có hồ sơ lương nhưng
    // chưa có ngày công). Bất biến đúng là: eligible ⊎ missing-salary-profile = toàn bộ người sống.
    const noProfile = res.body.data.warnings.filter(
      (w: { kind: string }) => w.kind === "missing-salary-profile",
    ).length;
    expect(res.body.data.eligibleCount + noProfile).toBe(full.userIds.length);
    // Và mọi userId được cảnh báo đều nằm trong tập người sống (không có id ma).
    const alive = new Set(full.userIds);
    expect(
      res.body.data.warnings.filter((w: { userId: string }) => !alive.has(w.userId)),
    ).toEqual([]);
  });

  // ── D. audit lượt ĐỌC atomic ──────────────────────────────────────────────────────────────────

  const auditCount = async (objectType: string, action: string): Promise<number> => {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1 AND object_type=$2 AND action=$3`,
      [A.companyId, objectType, action],
    );
    return r.rows[0].n as number;
  };

  it("D1 — GET /salary-profiles (019) và /:id (021) ghi audit lượt đọc", async () => {
    const before = await auditCount("salary_profile", "read");
    expect((await get("/salary-profiles")).status).toBe(200);
    expect((await get(`/salary-profiles/${salaryProfileId}`)).status).toBe(200);
    expect(await auditCount("salary_profile", "read")).toBe(before + 2);
  });

  it("D2 — lượt đọc THẤT BẠI (404) KHÔNG để lại audit (atomic — rollback thì 0 hàng)", async () => {
    const before = await auditCount("salary_profile", "read");
    const res = await get(`/salary-profiles/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(
      await auditCount("salary_profile", "read"),
      "audit ghi cho một lượt đọc không xảy ra",
    ).toBe(before);
  });

  it("D3 — payload audit của lương KHÔNG chứa số tiền", async () => {
    const r = await direct.query(
      `SELECT "before", "after" FROM audit_logs
        WHERE company_id=$1 AND object_type IN ('salary_profile','bonus_penalty','payroll_period')`,
      [A.companyId],
    );
    expect(r.rows.length, "chưa có hàng audit nào ⇒ ca này xanh-rỗng").toBeGreaterThan(0);
    for (const row of r.rows) {
      const json = JSON.stringify([row.before, row.after]);
      for (const k of ["baseSalary", "allowances", "amount", "gross", "net"]) {
        expect(json, `audit rò số tiền qua khoá '${k}'`).not.toContain(k);
      }
    }
  });

  it("D4 — `object_type` chỉ dùng 3 giá trị của BE-1 (bản đồ ĐÓNG SPEC-11 §12)", async () => {
    const r = await direct.query(
      `SELECT DISTINCT object_type FROM audit_logs WHERE company_id=$1
        AND object_type IN ('payroll_period','salary_profile','bonus_penalty','payslip')`,
      [A.companyId],
    );
    const seen = r.rows.map((x: { object_type: string }) => x.object_type).sort();
    expect(seen, "BE-1 không được ghi object_type `payslip` (đó là của BE-2)").not.toContain(
      "payslip",
    );
    expect(seen.length).toBeGreaterThan(0);
  });
});
