import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PayrollRouteKey } from "../../src/payroll/payroll-route-pairs.const";
import {
  bankSettings,
  employeeProfile,
  lockedAttendancePeriod,
  publishedPeriodWithPayslips,
} from "./payroll-v2-fixtures";
import { seedUser } from "./seed";

/**
 * S15-PAYROLL-QA-1 — BẢNG 50 ROUTE v2 (036–085) + «lát» dữ liệu cho ma trận quyền.
 *
 * Vì sao có file này: ca ALLOW song sinh phải assert MÃ CHÍNH XÁC (`=== 200/201/202`, SPEC-11 §21.1 #18 — memory
 * `allow-counter-case-not-403-lets-500-through`), nên mỗi route GHI cần body HỢP LỆ và một đối tượng CHƯA bị tiêu
 * (tạm ứng còn `Pending`, đợt chưa `Completed`, mã chưa trùng…). Mỗi người được ALLOW nhận một `Qa1Slice` riêng.
 * Người bị DENY dùng lát bất kỳ: guard quyền chạy TRƯỚC pipe/handler nên 403 không chạm dữ liệu.
 *
 * ⚠️ Helper KHÔNG tự dựng request supertest (census `supertest-listen-ratchet` cấm helper dùng chung chạm HTTP
 * server của app — và nó quét CHỮ, kể cả comment, nên đừng viết tên hàm lấy server ở file này): spec truyền
 * `Qa1Http` vào. Mọi lời gọi gieo qua HTTP đều assert mã, gieo hỏng là NÉM (không xanh-rỗng).
 */

export type Qa1Verb = "get" | "post" | "put" | "patch";

export interface Qa1Response {
  status: number;
  body: { data?: unknown; error?: { code?: string; message?: string } } & Record<string, unknown>;
}

/** Gọi HTTP có token; `csv` ⇒ multipart `file` (route 076). */
export type Qa1Http = (
  verb: Qa1Verb,
  path: string,
  token: string,
  body?: Record<string, unknown>,
  csv?: Buffer,
) => Promise<Qa1Response>;

/** Id/khoá của MỘT lát — mọi trường là của công ty `companyId`. */
export interface Qa1Slice {
  n: number;
  subjectUserId: string;
  dependentId: string;
  componentId: string;
  componentCodeNew: string;
  templateId: string;
  templateComponents: Array<Record<string, unknown>>;
  templateCodeNew: string;
  defaultTemplateId: string;
  rateId: string;
  rateEffectiveFromNew: string;
  advanceEditId: string;
  advanceApproveId: string;
  advanceRejectId: string;
  advanceMonth: string;
  timesheetPeriodId: string;
  importPeriodId: string;
  importMonth: string;
  subjectEmployeeCode: string;
  publishedPeriodId: string;
  payslipId: string;
  /** Phiếu của CHÍNH người gọi (084) — `payslipId` cho người không có phiếu (họ bị 403 trước). */
  ownPayslipId: string;
  newBatchPayeeId: string;
  batchDraftId: string;
  batchCompleteId: string;
  pdfBatchPeriodId: string;
  budgetId: string;
  budgetYearNew: number;
}

export interface Qa1Route {
  code: string;
  key: PayrollRouteKey;
  verb: Qa1Verb;
  path: (s: Qa1Slice) => string;
  body?: (s: Qa1Slice) => Record<string, unknown>;
  csv?: (s: Qa1Slice) => Buffer;
  /** Mã ALLOW CHÍNH XÁC. */
  ok: number;
}

const BRACKETS = [
  { upTo: 5000000, rate: 5 },
  { upTo: 10000000, rate: 10 },
  { upTo: 18000000, rate: 15 },
  { upTo: 32000000, rate: 20 },
  { upTo: 52000000, rate: 25 },
  { upTo: 80000000, rate: 30 },
  { upTo: null, rate: 35 },
];
const STATUTORY = {
  siEmployeePct: 8,
  hiEmployeePct: 1.5,
  uiEmployeePct: 1,
  siEmployerPct: 17.5,
  hiEmployerPct: 3,
  uiEmployerPct: 1,
  unionEmployerPct: 2,
  unionEmployeePct: 1,
  siCap: 46800000,
  hiCap: 46800000,
  uiCap: 99200000,
  personalDeduction: 11000000,
  dependentDeduction: 4400000,
  pitBrackets: BRACKETS,
};
const rateBody = (effectiveFrom: string): Record<string, unknown> => ({
  ...STATUTORY,
  effectiveFrom,
  baseWage: 2340000,
  minRegionWage: 4960000,
  note: "qa1",
});
const IMPORT_HEADER = ["Mã NV", "Loại", "Số tiền", "Lý do", "Kỳ (YYYY-MM)"];
const csvOf = (rows: string[][]): Buffer =>
  Buffer.from(
    rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n"),
    "utf8",
  );
const REPORT_Q = "fromMonth=2091-01&toMonth=2091-12";

/** 50 route v2 — thứ tự = mã API-18. */
export const QA1_ROUTES: readonly Qa1Route[] = [
  { code: "036", key: "employeeList", verb: "get", path: () => "/payroll/employees", ok: 200 },
  {
    code: "037",
    key: "employeeDetail",
    verb: "get",
    path: (s) => `/payroll/employees/${s.subjectUserId}`,
    ok: 200,
  },
  {
    code: "038",
    key: "employeeSettingsGet",
    verb: "get",
    path: (s) => `/payroll/employees/${s.subjectUserId}/settings`,
    ok: 200,
  },
  {
    code: "039",
    key: "employeeSettingsPut",
    verb: "put",
    path: (s) => `/payroll/employees/${s.subjectUserId}/settings`,
    body: (s) => ({
      joinsSocialInsurance: true,
      joinsUnion: false,
      bankAccountNumber: `0000${s.n}12345`,
      bankName: "VCB",
      accountHolder: "NGUOI NHAN",
    }),
    ok: 200,
  },
  {
    code: "040",
    key: "employeeDependentList",
    verb: "get",
    path: (s) => `/payroll/employees/${s.subjectUserId}/dependents`,
    ok: 200,
  },
  {
    code: "041",
    key: "employeeDependentCreate",
    verb: "post",
    path: (s) => `/payroll/employees/${s.subjectUserId}/dependents`,
    body: (s) => ({
      fullName: `Con qa1 ${s.n}`,
      relationship: "Child",
      dependentTaxCode: `QA1D${s.n}`,
      effectiveFrom: "2091-01-01",
    }),
    ok: 201,
  },
  {
    code: "042",
    key: "dependentUpdate",
    verb: "patch",
    path: (s) => `/payroll/dependents/${s.dependentId}`,
    body: (s) => ({ fullName: `Con sửa ${s.n}` }),
    ok: 200,
  },
  {
    code: "043",
    key: "periodTimesheet",
    verb: "get",
    path: (s) => `/payroll-periods/${s.timesheetPeriodId}/timesheet`,
    ok: 200,
  },
  {
    code: "044",
    key: "componentList",
    verb: "get",
    path: () => "/payroll/salary-components",
    ok: 200,
  },
  {
    code: "045",
    key: "componentCreate",
    verb: "post",
    path: () => "/payroll/salary-components",
    body: (s) => ({
      code: s.componentCodeNew,
      name: `Phụ cấp qa1 ${s.n}`,
      kind: "earning",
      valueType: "fixed",
      fixedAmount: 1000,
    }),
    ok: 201,
  },
  {
    code: "046",
    key: "componentDetail",
    verb: "get",
    path: (s) => `/payroll/salary-components/${s.componentId}`,
    ok: 200,
  },
  {
    code: "047",
    key: "componentUpdate",
    verb: "patch",
    path: (s) => `/payroll/salary-components/${s.componentId}`,
    body: (s) => ({ name: `Phụ cấp sửa ${s.n}` }),
    ok: 200,
  },
  {
    code: "048",
    key: "componentValidateFormula",
    verb: "post",
    path: () => "/payroll/salary-components/validate-formula",
    body: () => ({ formula: "SYS_BASE_SALARY * 0.1" }),
    ok: 200,
  },
  { code: "049", key: "templateList", verb: "get", path: () => "/payroll/templates", ok: 200 },
  {
    code: "050",
    key: "templateCreate",
    verb: "post",
    path: () => "/payroll/templates",
    body: (s) => ({ code: s.templateCodeNew, name: `Mẫu qa1 ${s.n}` }),
    ok: 201,
  },
  {
    code: "051",
    key: "templateDetail",
    verb: "get",
    path: (s) => `/payroll/templates/${s.templateId}`,
    ok: 200,
  },
  {
    code: "052",
    key: "templateUpdate",
    verb: "patch",
    path: (s) => `/payroll/templates/${s.templateId}`,
    body: (s) => ({ name: `Mẫu sửa ${s.n}` }),
    ok: 200,
  },
  {
    code: "053",
    key: "templatePutComponents",
    verb: "put",
    path: (s) => `/payroll/templates/${s.templateId}/components`,
    body: (s) => ({ components: s.templateComponents }),
    ok: 200,
  },
  {
    code: "054",
    key: "templatePreview",
    verb: "post",
    path: (s) => `/payroll/templates/${s.defaultTemplateId}/preview`,
    body: () => ({
      inputs: {
        SYS_BASE_SALARY: "20000000",
        SYS_PAY_RATIO: "100",
        SYS_PRESENT_DAYS: "22",
        SYS_WORK_DAYS: "22",
        SYS_INSURANCE_SALARY: "20000000",
        SYS_DEPENDENTS: "1",
      },
      statutory: STATUTORY,
    }),
    ok: 200,
  },
  {
    code: "055",
    key: "statutoryRateList",
    verb: "get",
    path: () => "/payroll/statutory-rates",
    ok: 200,
  },
  {
    code: "056",
    key: "statutoryRateCreate",
    verb: "post",
    path: () => "/payroll/statutory-rates",
    body: (s) => rateBody(s.rateEffectiveFromNew),
    ok: 201,
  },
  {
    code: "057",
    key: "statutoryRateDetail",
    verb: "get",
    path: (s) => `/payroll/statutory-rates/${s.rateId}`,
    ok: 200,
  },
  {
    code: "058",
    key: "statutoryRateUpdate",
    verb: "patch",
    path: (s) => `/payroll/statutory-rates/${s.rateId}`,
    body: () => ({ note: "qa1 sửa" }),
    ok: 200,
  },
  { code: "059", key: "advanceList", verb: "get", path: () => "/payroll/advances", ok: 200 },
  {
    code: "060",
    key: "advanceCreate",
    verb: "post",
    path: () => "/payroll/advances",
    body: (s) => ({
      userId: s.subjectUserId,
      amount: 100000,
      deductPeriodMonth: s.advanceMonth,
      reason: "qa1 tạo",
    }),
    ok: 201,
  },
  {
    code: "061",
    key: "advanceDetail",
    verb: "get",
    path: (s) => `/payroll/advances/${s.advanceEditId}`,
    ok: 200,
  },
  {
    code: "062",
    key: "advanceUpdate",
    verb: "patch",
    path: (s) => `/payroll/advances/${s.advanceEditId}`,
    body: () => ({ reason: "qa1 sửa" }),
    ok: 200,
  },
  {
    code: "063",
    key: "advanceApprove",
    verb: "post",
    path: (s) => `/payroll/advances/${s.advanceApproveId}/approve`,
    body: () => ({}),
    ok: 201,
  },
  {
    code: "064",
    key: "advanceReject",
    verb: "post",
    path: (s) => `/payroll/advances/${s.advanceRejectId}/reject`,
    body: () => ({ note: "qa1 từ chối" }),
    ok: 201,
  },
  { code: "065", key: "meAdvanceList", verb: "get", path: () => "/me/payroll-advances", ok: 200 },
  { code: "066", key: "batchList", verb: "get", path: () => "/payroll/payment-batches", ok: 200 },
  {
    code: "067",
    key: "batchCreate",
    verb: "post",
    path: () => "/payroll/payment-batches",
    body: (s) => ({
      payrollPeriodId: s.publishedPeriodId,
      method: "bank",
      userIds: [s.newBatchPayeeId],
    }),
    ok: 201,
  },
  {
    code: "068",
    key: "batchDetail",
    verb: "get",
    path: (s) => `/payroll/payment-batches/${s.batchDraftId}`,
    ok: 200,
  },
  {
    code: "069",
    key: "batchUpdate",
    verb: "patch",
    path: (s) => `/payroll/payment-batches/${s.batchDraftId}`,
    body: (s) => ({ note: `qa1 sửa ${s.n}` }),
    ok: 200,
  },
  {
    code: "070",
    key: "batchLines",
    verb: "get",
    path: (s) => `/payroll/payment-batches/${s.batchDraftId}/lines`,
    ok: 200,
  },
  {
    code: "071",
    key: "batchExport",
    verb: "get",
    path: (s) => `/payroll/payment-batches/${s.batchDraftId}/export`,
    ok: 200,
  },
  {
    code: "072",
    key: "batchComplete",
    verb: "post",
    path: (s) => `/payroll/payment-batches/${s.batchCompleteId}/complete`,
    body: () => ({ confirmAllPaid: true }),
    ok: 200,
  },
  { code: "073", key: "budgetList", verb: "get", path: () => "/payroll/budgets", ok: 200 },
  {
    code: "074",
    key: "budgetCreate",
    verb: "post",
    path: () => "/payroll/budgets",
    body: (s) => ({ fiscalYear: s.budgetYearNew, plannedAmount: 1000000 }),
    ok: 201,
  },
  {
    code: "075",
    key: "budgetUpdate",
    verb: "patch",
    path: (s) => `/payroll/budgets/${s.budgetId}`,
    body: () => ({ plannedAmount: 2000000 }),
    ok: 200,
  },
  {
    code: "076",
    key: "importAdjustments",
    verb: "post",
    path: (s) => `/payroll-periods/${s.importPeriodId}/import-adjustments?dryRun=true`,
    csv: (s) =>
      csvOf([IMPORT_HEADER, [s.subjectEmployeeCode, "Thưởng", "500000", "qa1", s.importMonth]]),
    ok: 201,
  },
  {
    code: "077",
    key: "importTemplate",
    verb: "get",
    path: () => "/payroll/imports/adjustments-template",
    ok: 200,
  },
  { code: "078", key: "overview", verb: "get", path: () => "/payroll/overview", ok: 200 },
  {
    code: "079",
    key: "overviewReminders",
    verb: "get",
    path: () => "/payroll/overview/reminders",
    ok: 200,
  },
  { code: "080", key: "reportList", verb: "get", path: () => "/payroll/reports", ok: 200 },
  {
    code: "081",
    key: "reportData",
    verb: "get",
    path: () => `/payroll/reports/salary-by-period?${REPORT_Q}`,
    ok: 200,
  },
  {
    code: "082",
    key: "reportExport",
    verb: "get",
    path: () => `/payroll/reports/salary-by-period/export?${REPORT_Q}`,
    ok: 200,
  },
  {
    code: "083",
    key: "payslipPdf",
    verb: "get",
    path: (s) => `/payslips/${s.payslipId}/pdf`,
    ok: 200,
  },
  {
    code: "084",
    key: "mePayslipPdf",
    verb: "get",
    path: (s) => `/me/payslips/${s.ownPayslipId}/pdf`,
    ok: 200,
  },
  {
    code: "085",
    key: "payslipPdfBatch",
    verb: "post",
    path: (s) => `/payroll-periods/${s.pdfBatchPeriodId}/payslips/pdf-batch`,
    body: () => ({}),
    ok: 202,
  },
];

async function must(res: Promise<Qa1Response>, want: number, what: string): Promise<Qa1Response> {
  const r = await res;
  if (r.status !== want) {
    throw new Error(`seed ${what}: HTTP ${r.status} ≠ ${want} — ${JSON.stringify(r.body)}`);
  }
  return r;
}
const idOf = (r: Qa1Response): string => (r.body.data as { id: string }).id;

export interface Qa1SliceDeps {
  direct: Pool;
  companyId: string;
  slug: string;
  http: Qa1Http;
  /** Người GIEO — giữ mọi cặp PAYROLL @Company; là người LẬP tạm ứng/đợt (four-eyes: ALLOW-actor ≠ người lập). */
  seederToken: string;
  seederId: string;
  /** Người DUYỆT kỳ trong fixture kỳ đã phát hành (CHECK four-eyes ở DB: ≠ `seederId`). */
  approverId: string;
  /** Mặc định mẫu `MAU_MAC_DINH` của công ty (seedPayrollCatalog). */
  defaultTemplateId: string;
}

/** Tháng `YYYY-MM` riêng cho lát `n` và mục đích `k` — không đụng tháng của lát khác/của spec khác (năm 2091+). */
const monthOf = (n: number, k: number): string => `${2091 + n}-${String(k).padStart(2, "0")}`;

/**
 * Gieo MỘT lát cho người ALLOW `actorId` (có thể `null` = lát dùng cho DENY). `n` phải DUY NHẤT trong công ty.
 * Người ALLOW nhận phiếu RIÊNG ở kỳ đã phát hành (`ownPayslipId`) để 084 có đích thật.
 */
export async function seedQa1Slice(
  d: Qa1SliceDeps,
  n: number,
  actorId: string | null,
): Promise<Qa1Slice> {
  const { direct, companyId, http, seederToken: tok } = d;
  const tag = `${n}${randomUUID().slice(0, 4)}`;
  const mkUser = async (label: string): Promise<string> =>
    seedUser(direct, companyId, `qa1-${label}-${tag}@${d.slug}.test`, "x");

  // ── Nhân sự chủ thể + hồ sơ lương + NPT ──
  const subjectUserId = await mkUser("subj");
  const subjectEmployeeCode = `QA1E${tag}`.toUpperCase();
  await employeeProfile(direct, companyId, subjectUserId, subjectEmployeeCode);
  await direct.query(
    `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances, salary_type)
     VALUES ($1, $2, '2024-01-01', 15000000, '[]'::jsonb, 'GROSS')`,
    [companyId, subjectUserId],
  );
  const dep = await must(
    http("post", `/payroll/employees/${subjectUserId}/dependents`, tok, {
      fullName: `NPT gốc ${n}`,
      relationship: "Spouse",
      effectiveFrom: "2090-01-01",
      effectiveTo: "2090-12-31",
    }),
    201,
    "041 dependent",
  );

  // ── Catalog: thành phần + mẫu (bản sao mặc định) + bản tỉ lệ chưa dùng ──
  const comp = await must(
    http("post", "/payroll/salary-components", tok, {
      code: `QA1S${tag}`.toUpperCase().slice(0, 32),
      name: `Thành phần lát ${n}`,
      kind: "earning",
      valueType: "fixed",
      fixedAmount: 500,
    }),
    201,
    "045 component",
  );
  const tpl = await must(
    http("post", "/payroll/templates", tok, { code: `qa1-slice-${tag}`, name: `Mẫu lát ${n}` }),
    201,
    "050 template",
  );
  const src = await direct.query<{
    component_id: string;
    column_label: string | null;
    formula_override: string | null;
    is_visible: boolean;
    sort_order: number;
  }>(
    `SELECT component_id, column_label, formula_override, is_visible, sort_order
       FROM payroll_template_components WHERE company_id = $1 AND template_id = $2 ORDER BY sort_order, component_id`,
    [companyId, d.defaultTemplateId],
  );
  const templateComponents = src.rows.map((r) => ({
    componentId: r.component_id,
    columnLabel: r.column_label,
    formulaOverride: r.formula_override,
    isVisible: r.is_visible,
    sortOrder: r.sort_order,
  }));
  await must(
    http("put", `/payroll/templates/${idOf(tpl)}/components`, tok, {
      components: templateComponents,
    }),
    200,
    "053 template components",
  );
  const rate = await must(
    // Năm 2500+: SAU mọi kỳ fixture (≤ 2091 + n) — bản tỉ lệ sớm hơn bị kỳ `Published` của lát khác «dùng» ⇒ 058 409 033.
    http("post", "/payroll/statutory-rates", tok, rateBody(`${2500 + n}-06-01`)),
    201,
    "056 rate",
  );

  // ── Tạm ứng: ba hàng `Pending` do NGƯỜI GIEO lập cho chủ thể (ALLOW-actor ≠ người lập ≠ người thụ hưởng) ──
  const advanceMonth = monthOf(n, 11);
  const mkAdvance = async (reason: string) =>
    idOf(
      await must(
        http("post", "/payroll/advances", tok, {
          userId: subjectUserId,
          amount: 200000,
          deductPeriodMonth: advanceMonth,
          reason,
        }),
        201,
        "060 advance",
      ),
    );

  // ── Kỳ: CollectingData (043 · 076) ──
  const importMonth = monthOf(n, 2);
  const att = await lockedAttendancePeriod(direct, companyId, importMonth);
  const imp = await direct.query<{ id: string }>(
    `INSERT INTO payroll_periods (company_id, period_month, status, attendance_period_id)
     VALUES ($1, $2, 'CollectingData', $3) RETURNING id`,
    [companyId, importMonth, att],
  );

  // ── Kỳ Published (067 · 069–072 · 083 · 084) + kỳ Published riêng cho 085 ──
  const payees = [await mkUser("p1"), await mkUser("p2"), await mkUser("p3")];
  for (const p of payees) await bankSettings(direct, companyId, p, `9${tag}${p.slice(0, 4)}`);
  const allPayees = actorId ? [...payees, actorId] : payees;
  const pub = await publishedPeriodWithPayslips(direct, companyId, {
    month: monthOf(n, 3),
    payees: allPayees.map((userId) => ({ userId, net: "10000000.00" })),
    officerId: d.seederId,
    approverId: d.approverId,
  });
  const draft = await must(
    http("post", "/payroll/payment-batches", tok, {
      payrollPeriodId: pub.periodId,
      method: "bank",
      userIds: [payees[0]],
    }),
    201,
    "067 batch draft",
  );
  const toComplete = await must(
    http("post", "/payroll/payment-batches", tok, {
      payrollPeriodId: pub.periodId,
      method: "bank",
      userIds: [payees[1]],
    }),
    201,
    "067 batch complete",
  );
  const pdfPub = await publishedPeriodWithPayslips(direct, companyId, {
    month: monthOf(n, 4),
    payees: [{ userId: payees[0], net: "9000000.00" }],
    officerId: d.seederId,
    approverId: d.approverId,
  });

  // ── Ngân sách ──
  const budget = await must(
    http("post", "/payroll/budgets", tok, { fiscalYear: 2040 + n, plannedAmount: 5000000 }),
    201,
    "074 budget",
  );

  const payslipId = pub.payslipIdByUser.get(payees[2]) as string;
  return {
    n,
    subjectUserId,
    dependentId: idOf(dep),
    componentId: idOf(comp),
    componentCodeNew: `QA1N${tag}`.toUpperCase().slice(0, 32),
    templateId: idOf(tpl),
    templateComponents,
    templateCodeNew: `qa1-new-${tag}`,
    defaultTemplateId: d.defaultTemplateId,
    rateId: idOf(rate),
    rateEffectiveFromNew: `${2500 + n}-07-01`,
    advanceEditId: await mkAdvance("sửa"),
    advanceApproveId: await mkAdvance("duyệt"),
    advanceRejectId: await mkAdvance("từ chối"),
    advanceMonth,
    timesheetPeriodId: imp.rows[0].id,
    importPeriodId: imp.rows[0].id,
    importMonth,
    subjectEmployeeCode,
    publishedPeriodId: pub.periodId,
    payslipId,
    ownPayslipId: actorId ? (pub.payslipIdByUser.get(actorId) as string) : payslipId,
    newBatchPayeeId: payees[2],
    batchDraftId: idOf(draft),
    batchCompleteId: idOf(toComplete),
    pdfBatchPeriodId: pdfPub.periodId,
    budgetId: idOf(budget),
    budgetYearNew: 2070 + n,
  };
}

/** Gửi MỘT route của bảng bằng lát `s`. */
export function callQa1Route(
  http: Qa1Http,
  route: Qa1Route,
  s: Qa1Slice,
  token: string,
): Promise<Qa1Response> {
  return http(route.verb, route.path(s), token, route.body?.(s), route.csv?.(s));
}
