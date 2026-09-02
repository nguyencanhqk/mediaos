/**
 * S13-PAYROLL-QA-1 — ĐỐI SOÁT SỐ HỌC "khớp từng đồng" + BIÊN của máy tính lương (SPEC-11 §13.4).
 *
 * PHÂN CÔNG với bề mặt test đã có, để không lặp:
 *  · `payroll-be1-inputs-audit.int-spec.ts` (24 ca) sở hữu **ĐẦU VÀO** — mẫu số ngày công, lễ,
 *    nghỉ nửa buổi, biên tháng, fallback đơn di sản. Không đo lại ở đây.
 *  · `payroll-be2-lifecycle.int-spec.ts` A1 có **một** ca đối soát tay, A5/A6 có kỳ 0 nhân sự và
 *    lịch 0 ngày công.
 *  · File này sở hữu **PHÉP TÍNH TIỀN cho trước đầu vào**: trần pro-rate · sàn `net` · điểm làm tròn ·
 *    đơn giá ngày dùng CÙNG mẫu số với pro-rate · đẳng thức tổng kỳ. Đây là các BIÊN mà A1 (một bộ số
 *    "đẹp") không chạm tới.
 *
 * MẸO LÀM CHO SỐ HỌC KIỂM ĐƯỢC BẰNG TAY. `work_days` phụ thuộc lịch công ty + bảng `holidays` (có cả
 * lễ QUỐC GIA `company_id IS NULL` mà test không sở hữu) ⇒ hằng số chép tay sẽ vỡ khi seed lễ đổi.
 * Cách làm ở đây: tính MỘT lượt để ĐỌC `work_days` W thật từ hàng dòng lương, rồi đặt
 * `base_salary = W × 1.000.000` và tính LẠI. Khi đó **đơn giá ngày = 1.000.000 chẵn** và
 * `base_amount = 1.000.000 × (present + unpaid)` — mọi con số kỳ vọng dưới đây viết tay được, đúng
 * đến từng đồng, và KHÔNG phụ thuộc tháng nào có mấy ngày lễ.
 *
 * Công thức đang đo (`payroll-calc.repository.ts:74-79`):
 *   prorate     = LEAST((present + unpaid) / work_days, 1)
 *   base_amount = round(base_salary × prorate, 2)
 *   deduction   = round(penalty + unpaid × (base_salary / work_days), 2)
 *   gross       = round(base_amount + allowance + bonus, 2)
 *   net         = GREATEST(round(gross − deduction + adjustment, 2), 0)
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
const LOGIN_PW = loginPasswordFixture("s13payrollqa1math");
const MONTH = "2027-05";
/** Đơn giá ngày ÉP thành số chẵn — xem "mẹo" ở docblock. */
const DAILY = 1_000_000;

interface LineRow {
  user_id: string;
  work_days: string;
  present_days: string;
  unpaid_leave_days: string;
  base_amount: string;
  allowance_amount: string;
  bonus_amount: string;
  penalty_amount: string;
  deduction_amount: string;
  adjustment_amount: string;
  gross: string;
  net: string;
}

describe.skipIf(!hasLaneDb)("S13-PAYROLL-QA-1 · đối soát số học & biên máy tính lương", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let token: string;
  let periodId: string;
  let workDays: number;

  /** 4 nhân sự, mỗi người một hình dạng số khác nhau (xem beforeAll). */
  const S: Record<"full" | "clamp" | "floor" | "round", string> = {
    full: "",
    clamp: "",
    floor: "",
    round: "",
  };

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
  const get = (u: string) => auth(http().get(u));
  const post = (u: string) => auth(http().post(u));

  const money = (v: string): number => Math.round(Number(v) * 100);
  const cents = (v: number): number => Math.round(v * 100);

  async function lines(): Promise<Map<string, LineRow>> {
    const r = await direct.query<LineRow>(
      `SELECT user_id, work_days::text, present_days::text, unpaid_leave_days::text,
              base_amount::text, allowance_amount::text, bonus_amount::text, penalty_amount::text,
              deduction_amount::text, adjustment_amount::text, gross::text, net::text
         FROM payroll_period_lines
        WHERE payroll_period_id = $1 AND deleted_at IS NULL`,
      [periodId],
    );
    return new Map(r.rows.map((x) => [x.user_id, x]));
  }

  async function recalc(): Promise<void> {
    const res = await post(`/payroll-periods/${periodId}/calculate`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }

  async function setBase(userId: string, base: number, allowances: unknown[]): Promise<void> {
    await direct.query(
      `UPDATE salary_profiles SET base_salary = $3::numeric, allowances = $4::jsonb
        WHERE company_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [A.companyId, userId, base.toFixed(2), JSON.stringify(allowances)],
    );
  }

  /** Ngày công `present` — chỉ 4 status được đếm (`payroll-inputs.repository.ts:17`). */
  async function seedPresent(userId: string, dates: readonly string[]): Promise<void> {
    for (const d of dates) {
      await direct.query(
        `INSERT INTO attendance_records (company_id, user_id, work_date, status, late_minutes, early_leave_minutes)
         VALUES ($1, $2, $3, 'present', 0, 0) ON CONFLICT DO NOTHING`,
        [A.companyId, userId, d],
      );
    }
  }

  /** Khoản thưởng/phạt ĐÃ DUYỆT — đi qua API thật rồi duyệt bằng actor KHÁC (chống 012 self-approval). */
  async function seedDecidedBonus(
    userId: string,
    kind: "bonus" | "penalty",
    amount: number,
    approverId: string,
  ): Promise<void> {
    const c = await post("/bonus-penalties").send({
      userId,
      kind,
      amount,
      periodMonth: MONTH,
      reason: `qa s13 math ${kind}`,
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    await direct.query(
      `UPDATE bonus_penalties SET status = 'Approved', decided_by = $2, decided_at = now()
        WHERE id = $1`,
      [c.body.data.id, approverId],
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
    A = await seedCompany(direct, "s13pqa1math");
    companyIds.push(A.companyId);
    await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
      A.companyId,
      JSON.stringify({ days: [1, 2, 3, 4, 5] }),
    ]);

    const officerId = await seedUser(direct, A.companyId, `officer@${A.slug}.test`, hash);
    const roleId = await seedRole(direct, A.companyId, "s13pqa1math-officer");
    const pairs = new Map(
      Object.values(PAYROLL_ROUTE_PAIRS).map((p) => [`${p.action}:${p.resourceType}`, p] as const),
    );
    for (const p of pairs.values()) {
      const permId = await seedPermissionCatalog(direct, p.action, p.resourceType, p.isSensitive);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, officerId, roleId, A.companyId);
    const lg = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email: `officer@${A.slug}.test`, password: LOGIN_PW });
    expect(lg.status, JSON.stringify(lg.body)).toBe(200);
    token = lg.body.data.accessToken;

    for (const k of Object.keys(S) as Array<keyof typeof S>) {
      S[k] = await seedUser(direct, A.companyId, `s-${k}@${A.slug}.test`, "x");
      await direct.query(
        `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances)
         VALUES ($1, $2, '2026-01-01', '1000000.00', '[]'::jsonb)`,
        [A.companyId, S[k]],
      );
    }

    const ap = await direct.query<{ id: string }>(
      `INSERT INTO attendance_periods (company_id, period_month, status)
       VALUES ($1, $2, 'locked') RETURNING id`,
      [A.companyId, MONTH],
    );
    const p = await post("/payroll-periods").send({
      periodMonth: MONTH,
      attendancePeriodId: ap.rows[0].id,
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    periodId = p.body.data.id;
    expect((await post(`/payroll-periods/${periodId}/collect`)).status).toBe(201);

    // ── Lượt tính #1: CHỈ để ĐỌC `work_days` thật (phụ thuộc lịch + bảng lễ) ──────────────────
    await recalc();
    const probe = [...(await lines()).values()][0];
    expect(probe, "lượt tính #1 phải sinh dòng cho 4 nhân sự có hồ sơ lương").toBeTruthy();
    workDays = Number(probe.work_days);
    expect(workDays, "lịch T2–T6 của một tháng thường phải > 15 ngày công").toBeGreaterThan(15);

    // ── Đặt số sao cho ĐƠN GIÁ NGÀY = 1.000.000 chẵn, rồi gieo đầu vào từng người ─────────────
    const BASE = workDays * DAILY;
    // Ngày công: lấy N ngày ĐẦU TIÊN của tháng thuộc T2–T6 (không dựa vào ngày cụ thể của lịch).
    const weekdaysOfMonth: string[] = [];
    for (let d = 1; d <= 31; d += 1) {
      const iso = `${MONTH}-${String(d).padStart(2, "0")}`;
      const dt = new Date(`${iso}T00:00:00Z`);
      if (dt.getUTCMonth() + 1 !== Number(MONTH.slice(5))) continue;
      const dow = dt.getUTCDay();
      if (dow !== 0 && dow !== 6) weekdaysOfMonth.push(iso);
    }

    // 1) `full` — đủ MỌI thành phần: phụ cấp + thưởng + phạt, đi làm (workDays − 3) ngày.
    await setBase(S.full, BASE, [
      { name: "an-trua", amount: 1_500_000 },
      { name: "xang-xe", amount: 500_000 },
    ]);
    await seedPresent(S.full, weekdaysOfMonth.slice(0, workDays - 3));
    await seedDecidedBonus(S.full, "bonus", 800_000, officerId);
    await seedDecidedBonus(S.full, "penalty", 300_000, officerId);

    // 2) `clamp` — đi làm ĐỦ mọi ngày công ⇒ pro-rate chạm trần 1 (không được vượt).
    await setBase(S.clamp, BASE, []);
    await seedPresent(S.clamp, weekdaysOfMonth.slice(0, workDays));

    // 3) `floor` — phạt LỚN HƠN gross ⇒ `net` phải là 0, KHÔNG âm.
    await setBase(S.floor, BASE, []);
    await seedPresent(S.floor, weekdaysOfMonth.slice(0, 1));
    await seedDecidedBonus(S.floor, "penalty", BASE, officerId);

    // 4) `round` — lương KHÔNG chia hết cho `work_days` ⇒ điểm làm tròn 2 chữ số phải đúng.
    await setBase(S.round, BASE + 1, []);
    await seedPresent(S.round, weekdaysOfMonth.slice(0, workDays - 1));

    await recalc();
  }, 300_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── A. Đối soát tay từng đồng ────────────────────────────────────────────────────────────────

  describe("A. đối soát TAY từng đồng (đơn giá ngày ép = 1.000.000)", () => {
    it("`full` — base + phụ cấp + thưởng − phạt khớp từng đồng, và 0 nghỉ-không-lương ⇒ khấu trừ = phạt", async () => {
      const l = (await lines()).get(S.full)!;
      const present = Number(l.present_days);
      expect(present, "gieo đúng workDays−3 ngày công").toBe(workDays - 3);
      expect(Number(l.unpaid_leave_days)).toBe(0);

      const base = present * DAILY;
      expect(money(l.base_amount), "base = đơn giá ngày × ngày công").toBe(cents(base));
      expect(money(l.allowance_amount), "tổng `amount` trong `allowances`").toBe(cents(2_000_000));
      expect(money(l.bonus_amount)).toBe(cents(800_000));
      expect(money(l.penalty_amount)).toBe(cents(300_000));
      // 0 ngày nghỉ-không-lương ⇒ vế `unpaid × dailyRate` biến mất, khấu trừ = ĐÚNG tiền phạt.
      expect(money(l.deduction_amount)).toBe(cents(300_000));
      expect(money(l.gross), "gross = base + phụ cấp + thưởng").toBe(
        cents(base + 2_000_000 + 800_000),
      );
      expect(money(l.net), "net = gross − khấu trừ").toBe(
        cents(base + 2_000_000 + 800_000 - 300_000),
      );
    });

    it("đẳng thức bất biến trên MỌI dòng: net = max(gross − khấu trừ + điều chỉnh, 0)", async () => {
      for (const [uid, l] of await lines()) {
        const expected = Math.max(
          money(l.gross) - money(l.deduction_amount) + money(l.adjustment_amount),
          0,
        );
        expect(money(l.net), `dòng ${uid}`).toBe(expected);
      }
    });

    it("gross = base + phụ cấp + thưởng trên MỌI dòng (không lẫn khấu trừ vào gross)", async () => {
      for (const [uid, l] of await lines()) {
        expect(money(l.gross), `dòng ${uid}`).toBe(
          money(l.base_amount) + money(l.allowance_amount) + money(l.bonus_amount),
        );
      }
    });
  });

  // ── B. Ba biên mà bộ số "đẹp" của BE-2 A1 không chạm ─────────────────────────────────────────

  describe("B. biên — trần pro-rate · sàn net · điểm làm tròn", () => {
    it("TRẦN: đi làm ĐỦ ngày công ⇒ base_amount = ĐÚNG lương cơ bản, không vượt (LEAST(…,1))", async () => {
      const l = (await lines()).get(S.clamp)!;
      expect(Number(l.present_days)).toBe(workDays);
      expect(money(l.base_amount), "pro-rate = 1 ⇒ base_amount == base_salary").toBe(
        cents(workDays * DAILY),
      );
    });

    it("SÀN: phạt lớn hơn gross ⇒ net = 0, KHÔNG âm (GREATEST(…,0))", async () => {
      const l = (await lines()).get(S.floor)!;
      expect(money(l.gross), "1 ngày công, 0 phụ cấp/thưởng").toBe(cents(DAILY));
      expect(money(l.penalty_amount)).toBe(cents(workDays * DAILY));
      expect(money(l.deduction_amount)).toBeGreaterThan(money(l.gross));
      expect(money(l.net), "âm bị kẹp về 0").toBe(0);
      expect(Number(l.net)).not.toBeLessThan(0);
    });

    it("LÀM TRÒN: lương lẻ 1đ ⇒ base_amount làm tròn 2 chữ số, KHÔNG cắt cụt, sai số < 1 xu", async () => {
      const l = (await lines()).get(S.round)!;
      const present = Number(l.present_days);
      expect(present).toBe(workDays - 1);
      const exact = ((workDays * DAILY + 1) * present) / workDays;
      // `round(x, 2)` của PG là làm tròn NỬA-LÊN; sai lệch cho phép đúng nửa xu, không hơn.
      expect(Math.abs(money(l.base_amount) - cents(exact))).toBeLessThanOrEqual(1);
      expect(l.base_amount).toMatch(/\.\d{2}$/);
    });
  });

  // ── C. Đơn giá ngày phải dùng CÙNG mẫu số với pro-rate (bẫy trừ HAI LẦN) ─────────────────────

  describe("C. khấu trừ nghỉ-không-lương dùng CÙNG mẫu số `work_days` với pro-rate", () => {
    it("gieo 2 ngày nghỉ KHÔNG lương ⇒ khấu trừ tăng ĐÚNG 2 × đơn giá ngày, base KHÔNG bị trừ lần hai", async () => {
      const before = (await lines()).get(S.clamp)!;
      const typeId = (
        await direct.query<{ id: string }>(
          `INSERT INTO leave_types (company_id, name, code, paid)
           VALUES ($1, 'khong-luong-qa', 'KLQA', false) RETURNING id`,
          [A.companyId],
        )
      ).rows[0].id;
      // Hai ngày công ĐẦU tháng, cùng tập ngày đã gieo `present` cho `clamp` — đúng kịch bản thật:
      // người vừa có bản ghi công vừa có đơn nghỉ không lương.
      const day1 = (
        await direct.query<{ d: string }>(
          `SELECT to_char(work_date,'YYYY-MM-DD') AS d FROM attendance_records
            WHERE company_id = $1 AND user_id = $2 ORDER BY work_date LIMIT 2`,
          [A.companyId, S.clamp],
        )
      ).rows;
      await direct.query(
        `INSERT INTO leave_requests (company_id, user_id, leave_type_id, start_date, end_date, total_days, status)
         VALUES ($1, $2, $3, $4, $5, 2, 'Approved')`,
        [A.companyId, S.clamp, typeId, day1[0].d, day1[1].d],
      );
      await recalc();

      const after = (await lines()).get(S.clamp)!;
      expect(Number(after.unpaid_leave_days), "2 ngày nghỉ không lương").toBe(2);
      expect(
        money(after.deduction_amount) - money(before.deduction_amount),
        "khấu trừ tăng ĐÚNG 2 × (base_salary / work_days)",
      ).toBe(cents(2 * DAILY));
      // Vế O1: tử số pro-rate CỘNG `unpaid` nên `base_amount` KHÔNG giảm — trừ ở base rồi lại trừ ở
      // khấu trừ là mất `base × unpaid / work_days` mỗi người mỗi kỳ (SPEC-11 §13.4, đính chính owner).
      expect(money(after.base_amount), "base KHÔNG được giảm — nếu giảm là TRỪ HAI LẦN").toBe(
        money(before.base_amount),
      );
    });
  });

  // ── D. Tổng kỳ = SUM(dòng), không lệch xu ────────────────────────────────────────────────────

  describe("D. tổng kỳ khớp SUM từng dòng", () => {
    it("GET /payroll-periods/summary — totalGross/totalNet = SUM(dòng) đến từng đồng", async () => {
      const rows = [...(await lines()).values()];
      const sumGross = rows.reduce((a, l) => a + money(l.gross), 0);
      const sumNet = rows.reduce((a, l) => a + money(l.net), 0);
      const res = await get("/payroll-periods/summary");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.payrollPeriodId).toBe(periodId);
      expect(cents(res.body.data.totalGross)).toBe(sumGross);
      expect(cents(res.body.data.totalNet)).toBe(sumNet);
      expect(res.body.data.headcount).toBe(rows.length);
    });

    it("neo chống xanh-rỗng — kỳ có ĐÚNG 4 dòng và tổng gross KHÁC 0", async () => {
      const rows = [...(await lines()).values()];
      expect(rows.length).toBe(4);
      expect(rows.reduce((a, l) => a + money(l.gross), 0)).toBeGreaterThan(0);
    });
  });
});
