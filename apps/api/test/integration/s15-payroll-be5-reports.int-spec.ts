/**
 * S15-PAYROLL-BE-5 — SỐ LIỆU của 7 báo cáo (081/082) + tổng cột toàn kỳ (018 `payrollPeriodId`) — plan §5 mục 2.
 *
 * Bảng tay (đơn vị đồng) — mọi con số dưới đây suy từ CHÍNH hàng gieo ở `beforeAll`:
 *
 * | kỳ | trạng thái | NV | gross | khấu trừ | net | khoản (payslip_items) | BH DN (dòng) |
 * | --- | --- | --- | --- | --- | --- | --- | --- |
 * | M1 | Published | e1 (U1) | 10.000.000 | 1.050.000 | 8.950.000 | LCB +10tr · BH_NV −1,05tr | 2.150.000 |
 * | M1 | Published | e2 (U2) | 20.000.000 | 2.600.000 | 17.400.000 | LCB +18tr · PC +2tr · BH_NV −2,1tr · TNCN −0,5tr | 4.300.000 |
 * | M1 | Published | e3 (—) | 35.000.000 | 0 | 35.000.000 | v1: earning +30tr · allowance +5tr | 0 (dòng v1) |
 * | M2 | Locked | e1 (U1) | 12.000.000 | 1.260.000 | 10.740.000 | LCB +12tr · BH_NV −1,26tr | 2.580.000 |
 * | M2 | Locked | e2 (U2) | 20.000.000 | 2.600.000 | 17.400.000 | như M1 | 4.300.000 |
 * | M3 | **Approved** | e1 | 99.000.000 | 0 | 99.000.000 | LCB +99tr | — ⇒ **KHÔNG được tính** (D-1) |
 * | B·M1 | Published | b1 | 77.000.000 | … | … | — ⇒ **KHÔNG được lọt sang A** |
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
} from "../helpers/payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s15payrollbe5rep");
const YEAR = 2092;
const M1 = `${YEAR}-01`;
const M2 = `${YEAR}-02`;
const M3 = `${YEAR}-03`;
const RANGE = `fromMonth=${YEAR}-01&toMonth=${YEAR}-12`;
/** Nhãn độc để đo chống formula-injection ở XLSX (082). */
const EVIL_LABEL = "=HYPERLINK(1)";

interface ItemSeed {
  itemType: string;
  label: string;
  amount: string;
  code?: string;
  kind?: string;
}
interface ComponentSeed {
  code: string;
  label: string;
  kind: string;
  value: string;
  sortOrder: number;
}
interface PayeeSeed {
  userId: string;
  gross: string;
  net: string;
  deduction: string;
  base: string;
  allowance: string;
  items: ItemSeed[];
  /** `null` = dòng v1 (không khoá `components`). */
  components: ComponentSeed[] | null;
  /** Điều chỉnh CÓ DẤU (mặc định 0) — CHECK dòng lương đòi lý do khi ≠ 0. */
  adjustment?: string;
}

type Row = Record<string, string | number | null>;

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-5 · số liệu 7 báo cáo + 018 tổng cột", () => {
  let app: INestApplication;
  let direct: Pool;
  const companyIds: string[] = [];
  let A: SeededTenant;
  let B: SeededTenant;
  let officer = { id: "", token: "" };
  let admin = { id: "", token: "" };
  let officerB = { id: "", token: "" };
  let adminB = { id: "", token: "" };
  let u1 = "";
  let u2 = "";
  let e1 = "";
  let e2 = "";
  let e3 = "";
  let p1 = "";
  let p2 = "";
  let p3 = "";
  let pB = "";
  let batchCode = "";
  let unitB = "";
  let userB = "";
  let officerD = { id: "", token: "" };

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
  async function report(code: string, query: string, token = officer.token) {
    const res = await get(token, `/payroll/reports/${code}?${query}`);
    expect(res.status, `${code}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body as {
      data: { reportCode: string; columns: Array<{ key: string }>; rows: Row[]; totals: Row };
      pagination: { total: number };
    };
  }
  const pick = (rows: Row[], keys: string[]) =>
    rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])));

  /** Kỳ + phiếu + khoản + dòng lương (dòng giữ ĐÚNG số của phiếu — kỳ đã phát hành thì dòng đã đóng băng). */
  async function seedPeriod(
    t: SeededTenant,
    month: string,
    status: "Published" | "Locked" | "Approved",
    by: { officer: string; approver: string },
    payees: PayeeSeed[],
  ): Promise<string> {
    const { periodId } = await publishedPeriodWithPayslips(direct, t.companyId, {
      month,
      payees: [],
      officerId: by.officer,
      approverId: by.approver,
      status,
    });
    for (const p of payees) {
      const ps = await direct.query<{ id: string }>(
        `INSERT INTO payslips (company_id, payroll_period_id, user_id, base_salary, total_allowances,
           deduction_amount, adjustment_amount, gross, net, created_by, input_snapshot_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '{"workDays":22}'::jsonb) RETURNING id`,
        [
          t.companyId,
          periodId,
          p.userId,
          p.base,
          p.allowance,
          p.deduction,
          p.adjustment ?? "0",
          p.gross,
          p.net,
          by.officer,
        ],
      );
      let sort = 10;
      for (const it of p.items) {
        const meta = it.code
          ? JSON.stringify({ componentCode: it.code, kind: it.kind, isVisible: true })
          : null;
        await direct.query(
          `INSERT INTO payslip_items (company_id, payslip_id, item_type, label, amount, sort_order, meta)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [t.companyId, ps.rows[0].id, it.itemType, it.label, it.amount, sort, meta],
        );
        sort += 10;
      }
      const cvj = p.components
        ? JSON.stringify({
            engine: "v2",
            pitPayer: "EMPLOYEE",
            components: p.components.map((c) => ({ ...c, isVisible: true })),
          })
        : "{}";
      await direct.query(
        `INSERT INTO payroll_period_lines (company_id, payroll_period_id, user_id, work_days, present_days,
           input_snapshot_json, base_amount, allowance_amount, deduction_amount, adjustment_amount,
           adjustment_reason, gross, net, component_values_json)
         VALUES ($1, $2, $3, 22, 22, '{"workDays":22}'::jsonb, $4, $5, $6, $7,
           CASE WHEN $7::numeric <> 0 THEN 'điều chỉnh fixture' END, $8, $9, $10::jsonb)`,
        [
          t.companyId,
          periodId,
          p.userId,
          p.base,
          p.allowance,
          p.deduction,
          p.adjustment ?? "0",
          p.gross,
          p.net,
          cvj,
        ],
      );
    }
    return periodId;
  }

  const LCB = (v: string): ItemSeed => ({
    itemType: "earning",
    label: "Lương cơ bản",
    amount: v,
    code: "LUONG_CO_BAN",
    kind: "earning",
  });
  const BHNV = (v: string): ItemSeed => ({
    itemType: "deduction",
    label: "BH người lao động",
    amount: `-${v}`,
    code: "BH_NV",
    kind: "statutory_employee",
  });
  const e1Line = (gross: string, bh: string, bhDn: string, net: string): PayeeSeed => ({
    userId: e1,
    gross,
    net,
    deduction: bh,
    base: gross,
    allowance: "0",
    items: [LCB(gross), BHNV(bh)],
    components: [
      { code: "LUONG_CO_BAN", label: "Lương cơ bản", kind: "earning", value: gross, sortOrder: 10 },
      {
        code: "BH_NV",
        label: "BH người lao động",
        kind: "statutory_employee",
        value: bh,
        sortOrder: 20,
      },
      {
        code: "BH_DN",
        label: "BH doanh nghiệp",
        kind: "statutory_employer",
        value: bhDn,
        sortOrder: 40,
      },
    ],
  });
  const e2Line = (): PayeeSeed => ({
    userId: e2,
    gross: "20000000.00",
    net: "17400000.00",
    deduction: "2600000.00",
    base: "18000000.00",
    allowance: "2000000.00",
    items: [
      LCB("18000000.00"),
      {
        itemType: "allowance",
        label: EVIL_LABEL,
        amount: "2000000.00",
        code: "PC_AN_TRUA",
        kind: "tax_exempt",
      },
      BHNV("2100000.00"),
      {
        itemType: "deduction",
        label: "Thuế TNCN",
        amount: "-500000.00",
        code: "TNCN",
        kind: "tax",
      },
    ],
    components: [
      {
        code: "LUONG_CO_BAN",
        label: "Lương cơ bản",
        kind: "earning",
        value: "18000000.00",
        sortOrder: 10,
      },
      {
        code: "PC_AN_TRUA",
        label: EVIL_LABEL,
        kind: "tax_exempt",
        value: "2000000.00",
        sortOrder: 15,
      },
      {
        code: "BH_NV",
        label: "BH người lao động",
        kind: "statutory_employee",
        value: "2100000.00",
        sortOrder: 20,
      },
      { code: "TNCN", label: "Thuế TNCN", kind: "tax", value: "500000.00", sortOrder: 30 },
      {
        code: "BH_DN",
        label: "BH doanh nghiệp",
        kind: "statutory_employer",
        value: "4300000.00",
        sortOrder: 40,
      },
    ],
  });

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

    A = await seedCompany(direct, "be5repa");
    B = await seedCompany(direct, "be5repb");
    companyIds.push(A.companyId, B.companyId);
    const mk = async (t: SeededTenant, label: string) => {
      const email = `${label}@${t.slug}.test`;
      const id = await seedUser(direct, t.companyId, email, hash);
      await grantAllPayrollPairs(direct, t.companyId, id, `be5r-${label}-${tag}`);
      return { id, token: await login(t, email) };
    };
    officer = await mk(A, "officer");
    admin = await mk(A, "admin");
    officerB = await mk(B, "officer");
    adminB = await mk(B, "admin");

    const ou = async (name: string) =>
      (
        await direct.query<{ id: string }>(
          `INSERT INTO org_units (company_id, name) VALUES ($1, $2) RETURNING id`,
          [A.companyId, name],
        )
      ).rows[0].id;
    u1 = await ou("Phòng R1");
    u2 = await ou("Phòng R2");
    e1 = await seedUser(direct, A.companyId, `e1@${A.slug}.test`, "x");
    e2 = await seedUser(direct, A.companyId, `e2@${A.slug}.test`, "x");
    e3 = await seedUser(direct, A.companyId, `e3@${A.slug}.test`, "x");
    await employeeProfile(direct, A.companyId, e1, "R001", u1);
    await employeeProfile(direct, A.companyId, e2, "R002", u2);
    await employeeProfile(direct, A.companyId, e3, "R003", null);

    const by = { officer: officer.id, approver: admin.id };
    p1 = await seedPeriod(A, M1, "Published", by, [
      e1Line("10000000.00", "1050000.00", "2150000.00", "8950000.00"),
      e2Line(),
      {
        userId: e3,
        gross: "35000000.00",
        net: "35000000.00",
        deduction: "0",
        base: "30000000.00",
        allowance: "5000000.00",
        items: [
          { itemType: "earning", label: "Lương cơ bản (theo ngày công)", amount: "30000000.00" },
          { itemType: "allowance", label: "Phụ cấp", amount: "5000000.00" },
        ],
        components: null,
      },
    ]);
    p2 = await seedPeriod(A, M2, "Locked", by, [
      e1Line("12000000.00", "1260000.00", "2580000.00", "10740000.00"),
      e2Line(),
    ]);
    p3 = await seedPeriod(A, M3, "Approved", by, [
      {
        userId: e1,
        gross: "99000000.00",
        net: "99000000.00",
        deduction: "0",
        base: "99000000.00",
        allowance: "0",
        items: [LCB("99000000.00")],
        components: null,
      },
    ]);
    const b1 = await seedUser(direct, B.companyId, `b1@${B.slug}.test`, "x");
    userB = b1;
    unitB = (
      await direct.query<{ id: string }>(
        `INSERT INTO org_units (company_id, name) VALUES ($1, 'Phòng B') RETURNING id`,
        [B.companyId],
      )
    ).rows[0].id;
    await employeeProfile(direct, B.companyId, b1, "R001", unitB);
    await direct.query(
      `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, created_by)
       VALUES ($1, $2, '2092-01-01', 5000000, $3)`,
      [B.companyId, b1, officerB.id],
    );
    // Múi giờ khác A — câu SQL đọc `companies` PHẢI ràng `c.id` (plan §0b B5).
    await direct.query(`UPDATE companies SET timezone = 'Asia/Tokyo' WHERE id = $1`, [B.companyId]);
    pB = await seedPeriod(B, M1, "Published", { officer: officerB.id, approver: adminB.id }, [
      {
        userId: b1,
        gross: "77000000.00",
        net: "77000000.00",
        deduction: "0",
        base: "77000000.00",
        allowance: "0",
        items: [LCB("77000000.00")],
        components: null,
      },
    ]);

    // Công ty D: hai điều chỉnh (item v1, meta NULL) khác lý do — nhãn item mang văn bản RIÊNG từng người.
    const D = await seedCompany(direct, "be5repd");
    companyIds.push(D.companyId);
    officerD = await mk(D, "officer");
    const adminD = await mk(D, "admin");
    const adjPayee = async (code: string, amount: string, reason: string): Promise<PayeeSeed> => {
      const userId = await seedUser(
        direct,
        D.companyId,
        `${code.toLowerCase()}@${D.slug}.test`,
        "x",
      );
      await employeeProfile(direct, D.companyId, userId, code, null);
      return {
        userId,
        gross: "5000000.00",
        net: (5_000_000 + Number(amount)).toFixed(2),
        deduction: "0",
        base: "5000000.00",
        allowance: "0",
        adjustment: amount,
        items: [
          { itemType: "earning", label: "Lương cơ bản (theo ngày công)", amount: "5000000.00" },
          { itemType: "adjustment", label: `Điều chỉnh: lý do riêng ${reason}`, amount },
        ],
        components: null,
      };
    };
    await seedPeriod(D, M1, "Published", { officer: officerD.id, approver: adminD.id }, [
      await adjPayee("D001", "100000.00", "A"),
      await adjPayee("D002", "200000.00", "B"),
    ]);

    // Hồ sơ lương e1: 2 phiên bản (+ 1 khoản định mức ở bản 2); e2: 1 phiên bản TRƯỚC khoảng.
    const profile = async (userId: string, eff: string, base: string, insurance: string | null) =>
      (
        await direct.query<{ id: string }>(
          `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, insurance_salary, created_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [A.companyId, userId, eff, base, insurance, officer.id],
        )
      ).rows[0].id;
    await profile(e1, `${YEAR}-01-01`, "10000000.00", "10000000.00");
    const e1v2 = await profile(e1, `${YEAR}-06-01`, "12000000.00", null);
    await direct.query(
      `INSERT INTO salary_profile_items (company_id, salary_profile_id, component_code, amount) VALUES ($1, $2, 'PHU_CAP', 1000000)`,
      [A.companyId, e1v2],
    );
    await profile(e2, `${YEAR - 1}-12-01`, "18000000.00", null);

    // Đợt chi trả tiền mặt cho M1: e1 đã chi, e2 chưa.
    batchCode = `CT-BE5-${tag}`;
    const batch = await direct.query<{ id: string }>(
      `INSERT INTO payroll_payment_batches (company_id, payroll_period_id, code, method, status, created_by)
       VALUES ($1, $2, $3, 'cash', 'Draft', $4) RETURNING id`,
      [A.companyId, p1, batchCode, officer.id],
    );
    for (const [userId, paid] of [
      [e1, true],
      [e2, false],
    ] as const) {
      await direct.query(
        `INSERT INTO payroll_payment_lines (company_id, batch_id, user_id, payslip_id, paid_at, created_by)
         SELECT $1, $2, $3, ps.id, CASE WHEN $4::boolean THEN now() END, $5
           FROM payslips ps WHERE ps.company_id = $1 AND ps.payroll_period_id = $6 AND ps.user_id = $3`,
        [A.companyId, batch.rows[0].id, userId, paid, officer.id, p1],
      );
    }

    // Ngân sách năm: toàn công ty 150tr · U1 30tr.
    await direct.query(
      `INSERT INTO payroll_budgets (company_id, fiscal_year, org_unit_id, planned_amount)
       VALUES ($1, $2, NULL, 150000000), ($1, $2, $3, 30000000)`,
      [A.companyId, YEAR, u1],
    );
  }, 120_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  it("employee-income: theo người, kỳ Approved KHÔNG tính, B KHÔNG lọt; totals toàn bộ lọc", async () => {
    const body = await report("employee-income", RANGE);
    expect(body.pagination.total).toBe(3);
    expect(
      pick(body.data.rows, [
        "employeeCode",
        "orgUnitName",
        "payslipCount",
        "totalGross",
        "insuranceEmployee",
        "pitWithheld",
        "totalDeduction",
        "totalNet",
      ]),
    ).toEqual([
      {
        employeeCode: "R001",
        orgUnitName: "Phòng R1",
        payslipCount: 2,
        totalGross: 22_000_000,
        insuranceEmployee: 2_310_000,
        pitWithheld: 0,
        totalDeduction: 2_310_000,
        totalNet: 19_690_000,
      },
      {
        employeeCode: "R002",
        orgUnitName: "Phòng R2",
        payslipCount: 2,
        totalGross: 40_000_000,
        insuranceEmployee: 4_200_000,
        pitWithheld: 1_000_000,
        totalDeduction: 5_200_000,
        totalNet: 34_800_000,
      },
      {
        employeeCode: "R003",
        orgUnitName: null,
        payslipCount: 1,
        totalGross: 35_000_000,
        insuranceEmployee: 0,
        pitWithheld: 0,
        totalDeduction: 0,
        totalNet: 35_000_000,
      },
    ]);
    expect(body.data.rows.every((r) => "displayName" in r && "userId" in r)).toBe(true);
    expect(body.data.rows.map((r) => r.totalAdjustment)).toEqual([0, 0, 0]);
    expect(body.data.totals).toEqual({
      totalGross: 97_000_000,
      insuranceEmployee: 6_510_000,
      pitWithheld: 1_000_000,
      totalDeduction: 7_510_000,
      totalAdjustment: 0,
      totalNet: 89_490_000,
    });

    const onlyU1 = await report("employee-income", `${RANGE}&orgUnitId=${u1}`);
    expect(onlyU1.data.rows.map((r) => r.employeeCode)).toEqual(["R001"]);
    expect(onlyU1.data.totals.totalGross).toBe(22_000_000);

    const paged = await report("employee-income", `${RANGE}&per_page=1&page=2`);
    expect(paged.pagination.total).toBe(3);
    expect(paged.data.rows.map((r) => r.employeeCode)).toEqual(["R002"]);
    // totals là của CẢ bộ lọc, không của trang.
    expect(paged.data.totals.totalGross).toBe(97_000_000);
  });

  it("salary-by-period: một hàng/kỳ đã phát hành, bình quân + BH DN + tổng chi phí", async () => {
    const body = await report("salary-by-period", RANGE);
    expect(
      pick(body.data.rows, [
        "periodMonth",
        "periodStatus",
        "headcount",
        "totalGross",
        "totalDeduction",
        "totalNet",
        "avgGross",
        "avgNet",
        "employerStatutory",
        "totalCost",
      ]),
    ).toEqual([
      {
        periodMonth: M1,
        periodStatus: "Published",
        headcount: 3,
        totalGross: 65_000_000,
        totalDeduction: 3_650_000,
        totalNet: 61_350_000,
        avgGross: 21_666_666.67,
        avgNet: 20_450_000,
        employerStatutory: 6_450_000,
        totalCost: 71_450_000,
      },
      {
        periodMonth: M2,
        periodStatus: "Locked",
        headcount: 2,
        totalGross: 32_000_000,
        totalDeduction: 3_860_000,
        totalNet: 28_140_000,
        avgGross: 16_000_000,
        avgNet: 14_070_000,
        employerStatutory: 6_880_000,
        totalCost: 38_880_000,
      },
    ]);
    expect(body.data.totals).toEqual({
      totalGross: 97_000_000,
      totalDeduction: 7_510_000,
      totalNet: 89_490_000,
      employerStatutory: 13_330_000,
      totalCost: 110_330_000,
    });
  });

  it("income-structure: khoản thu trước (giảm dần), v1 gộp theo loại, tỉ trọng theo chiều", async () => {
    const body = await report("income-structure", RANGE);
    expect(
      pick(body.data.rows, ["componentCode", "itemType", "direction", "totalAmount", "sharePct"]),
    ).toEqual([
      {
        componentCode: "LUONG_CO_BAN",
        itemType: "earning",
        direction: "income",
        totalAmount: 58_000_000,
        sharePct: 59.79,
      },
      {
        componentCode: null,
        itemType: "earning",
        direction: "income",
        totalAmount: 30_000_000,
        sharePct: 30.93,
      },
      {
        componentCode: null,
        itemType: "allowance",
        direction: "income",
        totalAmount: 5_000_000,
        sharePct: 5.15,
      },
      {
        componentCode: "PC_AN_TRUA",
        itemType: "allowance",
        direction: "income",
        totalAmount: 4_000_000,
        sharePct: 4.12,
      },
      {
        componentCode: "BH_NV",
        itemType: "deduction",
        direction: "deduction",
        totalAmount: 6_510_000,
        sharePct: 86.68,
      },
      {
        componentCode: "TNCN",
        itemType: "deduction",
        direction: "deduction",
        totalAmount: 1_000_000,
        sharePct: 13.32,
      },
    ]);
    expect(body.data.totals).toEqual({});
  });

  it("cost-by-org-unit: theo đơn vị HIỆN TẠI, bình quân/min/max theo phiếu, đơn vị trống cuối", async () => {
    const body = await report("cost-by-org-unit", RANGE);
    expect(
      pick(body.data.rows, [
        "orgUnitId",
        "orgUnitName",
        "headcount",
        "totalGross",
        "employerStatutory",
        "totalCost",
        "totalNet",
        "avgGross",
        "minGross",
        "maxGross",
      ]),
    ).toEqual([
      {
        orgUnitId: u1,
        orgUnitName: "Phòng R1",
        headcount: 1,
        totalGross: 22_000_000,
        employerStatutory: 4_730_000,
        totalCost: 26_730_000,
        totalNet: 19_690_000,
        avgGross: 11_000_000,
        minGross: 10_000_000,
        maxGross: 12_000_000,
      },
      {
        orgUnitId: u2,
        orgUnitName: "Phòng R2",
        headcount: 1,
        totalGross: 40_000_000,
        employerStatutory: 8_600_000,
        totalCost: 48_600_000,
        totalNet: 34_800_000,
        avgGross: 20_000_000,
        minGross: 20_000_000,
        maxGross: 20_000_000,
      },
      {
        orgUnitId: null,
        orgUnitName: null,
        headcount: 1,
        totalGross: 35_000_000,
        employerStatutory: 0,
        totalCost: 35_000_000,
        totalNet: 35_000_000,
        avgGross: 35_000_000,
        minGross: 35_000_000,
        maxGross: 35_000_000,
      },
    ]);
    expect(body.data.totals).toEqual({
      totalGross: 97_000_000,
      employerStatutory: 13_330_000,
      totalCost: 110_330_000,
      totalNet: 89_490_000,
    });
  });

  it("salary-history: mọi phiên bản; changePct tính trên CẢ lịch sử (kể cả bản ngoài khoảng)", async () => {
    const all = await report("salary-history", "");
    expect(
      pick(all.data.rows, [
        "employeeCode",
        "effectiveDate",
        "baseSalary",
        "insuranceSalary",
        "itemsTotal",
        "changePct",
      ]),
    ).toEqual([
      {
        employeeCode: "R001",
        effectiveDate: `${YEAR}-06-01`,
        baseSalary: 12_000_000,
        insuranceSalary: null,
        itemsTotal: 1_000_000,
        changePct: 20,
      },
      {
        employeeCode: "R001",
        effectiveDate: `${YEAR}-01-01`,
        baseSalary: 10_000_000,
        insuranceSalary: 10_000_000,
        itemsTotal: 0,
        changePct: null,
      },
      {
        employeeCode: "R002",
        effectiveDate: `${YEAR - 1}-12-01`,
        baseSalary: 18_000_000,
        insuranceSalary: null,
        itemsTotal: 0,
        changePct: null,
      },
    ]);
    const late = await report("salary-history", `fromMonth=${YEAR}-06&toMonth=${YEAR}-12`);
    expect(pick(late.data.rows, ["employeeCode", "changePct"])).toEqual([
      { employeeCode: "R001", changePct: 20 },
    ]);
    const byUser = await report("salary-history", `userId=${e2}`);
    expect(byUser.data.rows.map((r) => r.userId)).toEqual([e2]);
    expect(all.data.totals).toEqual({});
  });

  it("payment-summary: một hàng/đợt, số dòng/đã chi, Σ net; lọc đơn vị lọc DÒNG", async () => {
    const body = await report("payment-summary", RANGE);
    expect(
      pick(body.data.rows, [
        "batchCode",
        "periodMonth",
        "method",
        "status",
        "lineCount",
        "paidLineCount",
        "totalNet",
      ]),
    ).toEqual([
      {
        batchCode,
        periodMonth: M1,
        method: "cash",
        status: "Draft",
        lineCount: 2,
        paidLineCount: 1,
        totalNet: 26_350_000,
      },
    ]);
    expect(body.data.totals).toEqual({ totalNet: 26_350_000 });
    const onlyU1 = await report("payment-summary", `${RANGE}&orgUnitId=${u1}`);
    expect(pick(onlyU1.data.rows, ["lineCount", "paidLineCount", "totalNet"])).toEqual([
      { lineCount: 1, paidLineCount: 1, totalNet: 8_950_000 },
    ]);
    const done = await report("payment-summary", `${RANGE}&batchStatus=Completed`);
    expect(done.data.rows).toEqual([]);
  });

  it("budget-status: CÙNG số với 073; chênh lệch + tỉ lệ dùng", async () => {
    const body = await report("budget-status", `fiscalYear=${YEAR}`);
    expect(
      pick(body.data.rows, ["orgUnitId", "plannedAmount", "actualAmount", "variance", "usagePct"]),
    ).toEqual([
      {
        orgUnitId: null,
        plannedAmount: 150_000_000,
        actualAmount: 97_000_000,
        variance: 53_000_000,
        usagePct: 64.67,
      },
      {
        orgUnitId: u1,
        plannedAmount: 30_000_000,
        actualAmount: 22_000_000,
        variance: 8_000_000,
        usagePct: 73.33,
      },
    ]);
    const budgets = await get(officer.token, `/payroll/budgets?fiscalYear=${YEAR}`);
    expect(budgets.status).toBe(200);
    const fromBudgets = (
      budgets.body.data as Array<{ orgUnitId: string | null; actualAmount: number }>
    ).map((b) => ({ orgUnitId: b.orgUnitId, actualAmount: b.actualAmount }));
    expect(fromBudgets).toEqual(
      body.data.rows.map((r) => ({ orgUnitId: r.orgUnitId, actualAmount: r.actualAmount })),
    );
    // Tổng = hàng TOÀN CÔNG TY (không cộng trùng hàng đơn vị — plan §0b B4).
    expect(body.data.totals).toEqual({
      plannedAmount: 150_000_000,
      actualAmount: 97_000_000,
      variance: 53_000_000,
    });
    // Lọc đơn vị ⇒ tổng = hàng của đơn vị đó.
    const onlyU1 = await report("budget-status", `fiscalYear=${YEAR}&orgUnitId=${u1}`);
    expect(onlyU1.data.totals).toEqual({
      plannedAmount: 30_000_000,
      actualAmount: 22_000_000,
      variance: 8_000_000,
    });
  });

  it("công ty B chỉ thấy số của B; A lọc bằng đơn vị/người của B ⇒ 0 hàng", async () => {
    const body = await report("salary-by-period", RANGE, officerB.token);
    expect(pick(body.data.rows, ["periodMonth", "headcount", "totalGross"])).toEqual([
      { periodMonth: M1, headcount: 1, totalGross: 77_000_000 },
    ]);
    const byUnit = await report("employee-income", `${RANGE}&orgUnitId=${unitB}`);
    expect(byUnit.pagination.total).toBe(0);
    expect(byUnit.data.rows).toEqual([]);
    const byUser = await report("salary-history", `userId=${userB}`);
    expect(byUser.data.rows).toEqual([]);
  });

  it("income-structure KHÔNG lộ nhãn riêng từng người: 2 điều chỉnh khác lý do ⇒ 1 hàng nhãn hằng (công ty D)", async () => {
    const body = await report("income-structure", `fromMonth=${M1}&toMonth=${M1}`, officerD.token);
    expect(JSON.stringify(body.data.rows)).not.toContain("lý do riêng");
    const adj = body.data.rows.filter((r) => r.itemType === "adjustment");
    expect(pick(adj, ["componentCode", "direction", "totalAmount"])).toEqual([
      { componentCode: null, direction: "income", totalAmount: 300_000 },
    ]);
    const income = await report("employee-income", `fromMonth=${M1}&toMonth=${M1}`, officerD.token);
    expect(income.data.totals.totalAdjustment).toBe(300_000);
    expect(income.data.totals.totalNet).toBe(10_300_000);
  });

  it("081 audit: +1 hàng payroll_report, object_id NULL, payload có reportCode/filters/rowCount, KHÔNG số tiền", async () => {
    const before = Number(
      (
        await direct.query(
          `SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND actor_user_id = $2 AND object_type = 'payroll_report'`,
          [A.companyId, officer.id],
        )
      ).rows[0].n,
    );
    await report("salary-by-period", RANGE);
    const rows = (
      await direct.query<{ object_id: string | null; action: string; payload: string }>(
        `SELECT object_id, action, concat_ws(' ', "before"::text, "after"::text, new_values::text, old_values::text) AS payload
           FROM audit_logs WHERE company_id = $1 AND actor_user_id = $2 AND object_type = 'payroll_report'
          ORDER BY created_at DESC, id DESC`,
        [A.companyId, officer.id],
      )
    ).rows;
    expect(rows.length).toBe(before + 1);
    expect(rows[0].object_id).toBeNull();
    expect(rows[0].action).toBe("read");
    expect(rows[0].payload).toContain("salary-by-period");
    expect(rows[0].payload).toContain("rowCount");
    for (const money of ["65000000", "61350000", "97000000"]) {
      expect(rows[0].payload).not.toContain(money);
    }
  });

  it("082 XLSX: hàng = 081 + hàng tổng; chuỗi bắt đầu '=' được thoát; audit action export", async () => {
    const res = await http()
      .get(`/payroll/reports/income-structure/export?${RANGE}`)
      .set("Authorization", `Bearer ${officer.token}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(String(res.headers["content-disposition"])).toContain(".xlsx");
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const sheet = wb.worksheets[0];
    const values = (n: number) => (sheet.getRow(n).values as unknown[]).slice(1);
    // header + 6 hàng (income-structure không có cột cộng được ⇒ KHÔNG có hàng tổng).
    expect(sheet.rowCount).toBe(7);
    const labels = [2, 3, 4, 5, 6, 7].map((n) => values(n).map(String));
    expect(labels.some((r) => r.includes(`'${EVIL_LABEL}`))).toBe(true);
    expect(labels.some((r) => r.includes(EVIL_LABEL))).toBe(false);

    const byPeriod = await http()
      .get(`/payroll/reports/salary-by-period/export?${RANGE}`)
      .set("Authorization", `Bearer ${officer.token}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(byPeriod.body as unknown as Parameters<typeof wb2.xlsx.load>[0]);
    const s2 = wb2.worksheets[0];
    // header + 2 kỳ + 1 hàng tổng.
    expect(s2.rowCount).toBe(4);
    const last = (s2.getRow(4).values as unknown[]).map((v) =>
      typeof v === "number" ? v : String(v),
    );
    expect(last).toContain(97_000_000);

    const exported = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND actor_user_id = $2
          AND object_type = 'payroll_report' AND action = 'export'`,
      [A.companyId, officer.id],
    );
    expect(Number(exported.rows[0].n)).toBeGreaterThanOrEqual(2);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  describe("018 — tổng cột toàn kỳ (D-15)", () => {
    it("`payrollPeriodId` ⇒ lineTotals + componentTotals = Σ SQL của cả kỳ", async () => {
      const res = await get(officer.token, `/payroll-periods/summary?payrollPeriodId=${p1}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.payrollPeriodId).toBe(p1);
      expect(d.headcount).toBe(3);
      expect(d.totalGross).toBe(65_000_000);
      expect(d.lineTotals).toEqual({
        baseAmount: 58_000_000,
        allowanceAmount: 7_000_000,
        bonusAmount: 0,
        penaltyAmount: 0,
        deductionAmount: 3_650_000,
        adjustmentAmount: 0,
        gross: 65_000_000,
        net: 61_350_000,
      });
      expect(
        (d.componentTotals as Array<{ isVisible: boolean }>).every((c) => c.isVisible === true),
      ).toBe(true);
      expect(
        (d.componentTotals as Array<{ code: string; kind: string; total: number }>).map((c) => [
          c.code,
          c.kind,
          c.total,
        ]),
      ).toEqual([
        ["LUONG_CO_BAN", "earning", 28_000_000],
        ["PC_AN_TRUA", "tax_exempt", 2_000_000],
        ["BH_NV", "statutory_employee", 3_150_000],
        ["TNCN", "tax", 500_000],
        ["BH_DN", "statutory_employer", 6_450_000],
      ]);
    });

    it("không tham số ⇒ hành vi cũ (kỳ mới nhất), KHÔNG có khoá totals", async () => {
      const res = await get(officer.token, "/payroll-periods/summary");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.payrollPeriodId).toBe(p3);
      expect(res.body.data).not.toHaveProperty("lineTotals");
      expect(res.body.data).not.toHaveProperty("componentTotals");
    });

    it("kỳ không tồn tại / kỳ của công ty khác ⇒ 404; id rác ⇒ 400", async () => {
      expect(
        (await get(officer.token, `/payroll-periods/summary?payrollPeriodId=${randomUUID()}`))
          .status,
      ).toBe(404);
      expect(
        (await get(officer.token, `/payroll-periods/summary?payrollPeriodId=${pB}`)).status,
      ).toBe(404);
      expect(
        (await get(officer.token, `/payroll-periods/summary?payrollPeriodId=abc`)).status,
      ).toBe(400);
      expect(p2).not.toBe(p1);
    });
  });
});
