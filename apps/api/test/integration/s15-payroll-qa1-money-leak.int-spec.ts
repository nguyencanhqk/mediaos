/**
 * S15-PAYROLL-QA-1 (lane B) — G6: rò tiền qua route GHI v2 (SPEC-11 §21.1 mục 25 · §11.3 ghi chú 8 ·
 * plan §0 G6). Luật: một role chỉ giữ `manage:X` mà **KHÔNG** giữ `view:X` không được có đường nào đọc
 * được tiền — kể cả đường GHI (envelope GHI phải là cửa trước, không phải cửa sau).
 *
 * Với role `moneyOnly` (chỉ 4 cặp `manage`, KHÔNG cặp `view` nào — dựng bằng `grantPayrollPairs` chỉ
 * cấp đúng các key GHI, không cấp key ĐỌC — cách "sạch" hơn cấp-đủ-rồi-gỡ vì không cần biết `roleId`):
 *
 *  · gọi CẢ BẢY route GHI `039 · 060 · 062 · 067 · 069 · 074 · 075` ⇒ response đúng mã 2xx **VÀ** thân bài
 *    (quét ĐỆ QUY, không chỉ tầng 1) KHÔNG chứa bất kỳ khoá nào trong `amount · plannedAmount · totalNet ·
 *    gross · net · bankAccountNumber · bankAccountLast4` — assert VẮNG khoá, không phải `null`;
 *  · CÙNG role gọi route ĐỌC tương ứng `038 · 059 · 061 · 066 · 068 · 070 · 073` ⇒ **403** — không đường
 *    nào đọc được tiền;
 *  · ALLOW song sinh: role `moneyFull` (đủ CẢ HAI cặp `view`+`manage`) gọi ĐÚNG bảy route ĐỌC đó ⇒ **200
 *    VÀ CÓ** khoá tiền tương ứng (thiếu vế này thì cả nhóm xanh-RỖNG — `deny-cases-vacuous-without-allow-case`);
 *  · `072` (hoàn tất đợt) trả `{periodStatus, unpaidPayees}` ⇒ `unpaidPayees` là SỐ NGUYÊN đếm người,
 *    và cũng KHÔNG có khoá tiền nào.
 *
 * Đối chiếu thiết kế TRƯỚC khi viết ca (đọc service/mapper — không đoán): mọi route GHI track A/C của v2
 * trả LITERAL `{id[,status][,warnings]}` (không spread hàng DB), và `PayrollAccessService.canSeeMoney`
 * suy TỪ `routeKey` (không phải từ actor) nên route ĐỌC chỉ tới được mapper SAU KHI đã qua đúng cặp `view`
 * của CHÍNH route đó — thiết kế đã đóng đường rò; nhóm ca này GHIM hành vi đó, và nếu một route nào lộ
 * khoá tiền thì đây là BUG SẢN PHẨM thật (giữ ca ĐỎ, báo về phiên chính).
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
const LOGIN_PW = loginPasswordFixture("s15qa1bmoneyleak");
type Actor = { id: string; token: string };

/** Danh sách khoá CẤM (SPEC-11 §21.1 mục 25) — quét ĐỆ QUY body phản hồi, KHÔNG chỉ tầng 1. */
const FORBIDDEN_MONEY_KEYS = new Set([
  "amount",
  "plannedAmount",
  "totalNet",
  "gross",
  "net",
  "bankAccountNumber",
  "bankAccountLast4",
]);

/** Gom TOÀN BỘ tên khoá xuất hiện ở mọi tầng lồng nhau của `value` (mảng/obj). */
function deepKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (value === null || value === undefined) return acc;
  if (Array.isArray(value)) {
    for (const item of value) deepKeys(item, acc);
    return acc;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.add(k);
      deepKeys(v, acc);
    }
  }
  return acc;
}

function assertNoMoneyKeys(body: unknown, label: string): void {
  const leaked = [...deepKeys(body)].filter((k) => FORBIDDEN_MONEY_KEYS.has(k));
  expect(
    leaked,
    `${label}: rò khoá tiền ${JSON.stringify(leaked)} — body: ${JSON.stringify(body)}`,
  ).toEqual([]);
}

function assertHasKey(body: unknown, key: string, label: string): void {
  expect(
    deepKeys(body).has(key),
    `${label}: kỳ vọng CÓ khoá '${key}' — body: ${JSON.stringify(body)}`,
  ).toBe(true);
}

/** 4 cặp `manage` — KHÔNG cặp `view` nào (dedupe theo pair, mỗi resource CHỈ có mặt cặp GHI). */
const MONEY_ONLY_KEYS: readonly PayrollRouteKey[] = [
  "employeeSettingsPut",
  "advanceCreate",
  "advanceUpdate",
  "batchCreate",
  "batchUpdate",
  "batchComplete",
  "budgetCreate",
  "budgetUpdate",
];

describe.skipIf(!hasLaneDb)("S15-PAYROLL-QA-1 (lane B) · G6 rò tiền qua route GHI", () => {
  let app: INestApplication;
  let direct: Pool;
  const companyIds: string[] = [];
  let A: SeededTenant;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const put = (t: string, u: string) => auth(t)(http().put(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));

  async function login(t: SeededTenant, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: t.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function mk(
    t: SeededTenant,
    label: string,
    grant: (id: string) => Promise<void>,
  ): Promise<Actor> {
    const email = `${label}@${t.slug}.test`;
    const id = await seedUser(
      direct,
      t.companyId,
      email,
      await new PasswordService().hash(LOGIN_PW),
    );
    await grant(id);
    return { id, token: await login(t, email) };
  }

  let moneyOnly: Actor;
  let moneyFull: Actor;
  let subjectId = "";
  let advanceId = "";
  let batchXId = "";
  let batchYId = "";
  let budgetId = "";

  const FISCAL_YEAR = 2078;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    direct = directPool();

    A = await seedCompany(direct, "s15qa1bmoney");
    companyIds.push(A.companyId);

    moneyOnly = await mk(A, "moneyonly", (id) =>
      grantPayrollPairs(direct, A.companyId, id, "s15qa1b-monly", MONEY_ONLY_KEYS),
    );
    moneyFull = await mk(A, "moneyfull", (id) =>
      grantAllPayrollPairs(direct, A.companyId, id, "s15qa1b-mfull"),
    );

    subjectId = await seedUser(direct, A.companyId, `subject@${A.slug}.test`, "x");
    await employeeProfile(direct, A.companyId, subjectId, "QA1B-MONEY01");

    const approverThrowaway = await seedUser(direct, A.companyId, `approver@${A.slug}.test`, "x");
    const periodX = await publishedPeriodWithPayslips(direct, A.companyId, {
      month: "2078-02",
      payees: [{ userId: subjectId, net: "4000000.00" }],
      officerId: moneyFull.id,
      approverId: approverThrowaway,
    });
    const periodY = await publishedPeriodWithPayslips(direct, A.companyId, {
      month: "2078-03",
      payees: [{ userId: subjectId, net: "3000000.00" }],
      officerId: moneyFull.id,
      approverId: approverThrowaway,
    });

    // ── 039 — moneyOnly upsert settings, envelope 0 khoá ────────────────────────────────────────
    const r039 = await put(moneyOnly.token, `/payroll/employees/${subjectId}/settings`).send({
      joinsSocialInsurance: true,
      joinsUnion: false,
      bankAccountNumber: "5551112223334",
      bankName: "VCB",
      accountHolder: "QA MONEY ONLY",
    });
    expect(r039.status, JSON.stringify(r039.body)).toBe(200);
    assertNoMoneyKeys(r039.body.data, "039");

    // ── 060/062 — moneyOnly tạo + sửa tạm ứng ───────────────────────────────────────────────────
    const r060 = await post(moneyOnly.token, "/payroll/advances").send({
      userId: subjectId,
      amount: 700_000,
      deductPeriodMonth: "2078-01",
      reason: "qa1b money-only create",
    });
    expect(r060.status, JSON.stringify(r060.body)).toBe(201);
    assertNoMoneyKeys(r060.body.data, "060");
    advanceId = r060.body.data.id as string;

    const r062 = await patch(moneyOnly.token, `/payroll/advances/${advanceId}`).send({
      reason: "qa1b money-only update",
    });
    expect(r062.status, JSON.stringify(r062.body)).toBe(200);
    assertNoMoneyKeys(r062.body.data, "062");

    // ── 067/069 — moneyOnly lập + sửa đợt (four-eyes: moneyFull là người giữ cặp KHÁC thoả C3) ───
    const r067 = await post(moneyOnly.token, "/payroll/payment-batches").send({
      payrollPeriodId: periodX.periodId,
      method: "cash",
    });
    expect(r067.status, JSON.stringify(r067.body)).toBe(201);
    assertNoMoneyKeys(r067.body.data, "067");
    batchXId = r067.body.data.id as string;

    const r069 = await patch(moneyOnly.token, `/payroll/payment-batches/${batchXId}`).send({
      note: "qa1b money-only update batch",
    });
    expect(r069.status, JSON.stringify(r069.body)).toBe(200);
    assertNoMoneyKeys(r069.body.data, "069");

    // ── batchY — TẠO bởi moneyFull (khác người, tránh 409 `batch-four-eyes` ở 072) ────────────────
    const rY = await post(moneyFull.token, "/payroll/payment-batches").send({
      payrollPeriodId: periodY.periodId,
      method: "cash",
    });
    expect(rY.status, JSON.stringify(rY.body)).toBe(201);
    batchYId = rY.body.data.id as string;

    // ── 074/075 — moneyOnly tạo + sửa ngân sách ─────────────────────────────────────────────────
    const r074 = await post(moneyOnly.token, "/payroll/budgets").send({
      fiscalYear: FISCAL_YEAR,
      plannedAmount: 800_000,
      note: "qa1b money-only budget",
    });
    expect(r074.status, JSON.stringify(r074.body)).toBe(201);
    assertNoMoneyKeys(r074.body.data, "074");
    budgetId = r074.body.data.id as string;

    const r075 = await patch(moneyOnly.token, `/payroll/budgets/${budgetId}`).send({
      plannedAmount: 850_000,
    });
    expect(r075.status, JSON.stringify(r075.body)).toBe(200);
    assertNoMoneyKeys(r075.body.data, "075");
  }, 300_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ═══ Route GHI — 0 khoá tiền (assert lại NGOÀI beforeAll để có ca `it` riêng trong báo cáo) ═════

  it("039/060/062/067/069/074/075 — bảy envelope GHI ĐÃ tạo ở setup đều 0 khoá tiền (ghim lại)", () => {
    // Đã assert trong `beforeAll`; ca này CHỈ tồn tại để mục lục báo cáo liệt kê đúng theo SPEC-11 §21.1
    // mục 25 — không lặp lại HTTP call (khỏi tạo thêm dữ liệu/side-effect ngoài ý).
    expect(advanceId).not.toBe("");
    expect(batchXId).not.toBe("");
    expect(budgetId).not.toBe("");
  });

  // ═══ Route ĐỌC tương ứng — moneyOnly 403 (không đường nào đọc được tiền) ════════════════════════

  it("038/059/061/066/068/070/073 — moneyOnly (chỉ manage, KHÔNG view) ⇒ 403 trên CẢ BẢY route ĐỌC", async () => {
    const checks: Array<[string, string]> = [
      ["038", `/payroll/employees/${subjectId}/settings`],
      ["059", "/payroll/advances"],
      ["061", `/payroll/advances/${advanceId}`],
      ["066", "/payroll/payment-batches"],
      ["068", `/payroll/payment-batches/${batchXId}`],
      ["070", `/payroll/payment-batches/${batchXId}/lines`],
      ["073", `/payroll/budgets?fiscalYear=${FISCAL_YEAR}`],
    ];
    for (const [code, url] of checks) {
      const res = await get(moneyOnly.token, url);
      expect(res.status, `${code} ${url}: ${JSON.stringify(res.body)}`).toBe(403);
    }
  });

  // ═══ ALLOW song sinh — moneyFull (view+manage) ⇒ 200 VÀ CÓ khoá tiền ═══════════════════════════

  it("038 ALLOW: moneyFull GET settings ⇒ 200, CÓ khoá `bankAccountLast4`", async () => {
    const res = await get(moneyFull.token, `/payroll/employees/${subjectId}/settings`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    assertHasKey(res.body.data, "bankAccountLast4", "038");
    expect(res.body.data.bankAccountLast4).toBe("3334");
  });

  it("059 ALLOW: moneyFull GET danh sách tạm ứng ⇒ 200, CÓ khoá `amount`", async () => {
    const res = await get(moneyFull.token, "/payroll/advances?per_page=100");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const mine = (res.body.data as Array<{ id: string }>).find((x) => x.id === advanceId);
    expect(mine, "tạm ứng vừa tạo phải có trong danh sách").toBeTruthy();
    assertHasKey(mine, "amount", "059");
  });

  it("061 ALLOW: moneyFull GET chi tiết tạm ứng ⇒ 200, CÓ khoá `amount`", async () => {
    const res = await get(moneyFull.token, `/payroll/advances/${advanceId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    assertHasKey(res.body.data, "amount", "061");
    expect(res.body.data.amount).toBe(700_000);
  });

  it("066 ALLOW: moneyFull GET danh sách đợt chi ⇒ 200, CÓ khoá `totalNet`", async () => {
    const res = await get(moneyFull.token, "/payroll/payment-batches?per_page=100");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const mine = (res.body.data as Array<{ id: string }>).find((x) => x.id === batchXId);
    expect(mine, "đợt vừa tạo phải có trong danh sách").toBeTruthy();
    assertHasKey(mine, "totalNet", "066");
  });

  it("068 ALLOW: moneyFull GET chi tiết đợt chi ⇒ 200, CÓ khoá `totalNet`", async () => {
    const res = await get(moneyFull.token, `/payroll/payment-batches/${batchXId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    assertHasKey(res.body.data, "totalNet", "068");
    expect(res.body.data.totalNet).toBe(4_000_000);
  });

  it("070 ALLOW: moneyFull GET dòng chi ⇒ 200, CÓ khoá `net`", async () => {
    const res = await get(moneyFull.token, `/payroll/payment-batches/${batchXId}/lines`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data as unknown[]).length).toBeGreaterThan(0);
    assertHasKey(res.body.data, "net", "070");
  });

  it("073 ALLOW: moneyFull GET danh sách ngân sách ⇒ 200, CÓ khoá `plannedAmount`", async () => {
    const res = await get(moneyFull.token, `/payroll/budgets?fiscalYear=${FISCAL_YEAR}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const mine = (res.body.data as Array<{ id: string }>).find((x) => x.id === budgetId);
    expect(mine, "ngân sách vừa tạo phải có trong danh sách").toBeTruthy();
    assertHasKey(mine, "plannedAmount", "073");
    expect((mine as { plannedAmount?: number }).plannedAmount).toBe(850_000);
  });

  // ═══ 072 — hoàn tất đợt: `unpaidPayees` là SỐ NGƯỜI, 0 khoá tiền ═══════════════════════════════

  it("072: moneyOnly hoàn tất batchY (do moneyFull tạo) ⇒ 200, 0 khoá tiền, `unpaidPayees` là số nguyên", async () => {
    const res = await post(moneyOnly.token, `/payroll/payment-batches/${batchYId}/complete`).send({
      confirmAllPaid: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    assertNoMoneyKeys(res.body.data, "072");
    expect(typeof res.body.data.unpaidPayees).toBe("number");
    expect(Number.isInteger(res.body.data.unpaidPayees)).toBe(true);
    expect(res.body.data.unpaidPayees).toBe(0);
    expect(res.body.data.periodStatus).toBe("Paid");
  });
});
