import fs from "node:fs";
import path from "node:path";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PayrollAccessService } from "../../src/payroll/payroll-access.service";
import {
  PAYROLL_PENDING_BE2,
  PAYROLL_ROUTE_PAIRS,
  type PayrollRouteKey,
} from "../../src/payroll/payroll-route-pairs.const";
import { collectRoutes, type RouteInfo } from "./route-census";

/**
 * S13-PAYROLL-BE-1 — CENSUS 2 TẦNG theo TỪNG ROUTE × MÃ CẶP (khuôn `recruit-two-layer-guard-census`).
 *
 * CẢ HAI tầng so với CÙNG MỘT nguồn sự thật `PAYROLL_ROUTE_PAIRS` — KHÔNG so tầng-với-tầng (hai tầng
 * cùng sai vẫn "khớp nhau"):
 *   • Tầng 1 (decorator): metadata `@RequirePermission` từ APP ĐÃ BOOT qua `collectRoutes` (runtime
 *     Reflector — không regex mã nguồn).
 *   • Tầng 2 (service): quét TS AST `payroll/**` tìm `resolveActor(<expr>, "<key>")`, pin
 *     `Class#method ↔ key` (không chỉ "key xuất hiện ≥ 1 lần" — route assert nhầm key của route KHÁC
 *     cùng cặp vẫn xanh nếu chỉ đếm).
 *
 * `PAYROLL_PENDING_BE2` là **CỔNG, không phải lời hứa**: ca (5) assert hợp = toàn bộ **và** giao = ∅
 * ⇒ BE-2 nối dây một key mà quên gỡ khỏi danh sách là ĐỎ (chống census xanh-rỗng).
 *
 * KHÔNG cần Postgres — boot + metadata + đọc file.
 */

const SRC_PAYROLL = path.join(__dirname, "..", "..", "src", "payroll");

/**
 * 43 route — v1: BE-1 (`001..006` · `019..028` · `034..035`) + BE-2 (`007..018` · `029..033`);
 * v2 track A: `S15-PAYROLL-BE-1` (`036..043`).
 */
const ROUTE_TO_KEY: ReadonlyArray<{ method: string; path: string; key: PayrollRouteKey }> = [
  { method: "GET", path: "/api/v1/payroll-periods", key: "periodList" },
  { method: "POST", path: "/api/v1/payroll-periods", key: "periodCreate" },
  { method: "POST", path: "/api/v1/payroll-periods/:id/collect", key: "periodCollect" },
  { method: "GET", path: "/api/v1/payroll-periods/:id/readiness", key: "periodReadiness" },
  { method: "GET", path: "/api/v1/payroll-periods/:id", key: "periodDetail" },
  { method: "PATCH", path: "/api/v1/payroll-periods/:id", key: "periodUpdate" },
  // ── S13-PAYROLL-BE-2 ──
  // `summary` là route TĨNH dưới cùng basePath với `:id` — controller khai nó TRƯỚC, nếu không Nest
  // nuốt thành `:id` rồi trả 400 «không phải UUID» (bài học `goals/tree`).
  { method: "GET", path: "/api/v1/payroll-periods/summary", key: "periodSummary" },
  { method: "POST", path: "/api/v1/payroll-periods/:id/calculate", key: "periodCalculate" },
  { method: "GET", path: "/api/v1/payroll-periods/:id/lines", key: "periodLines" },
  { method: "GET", path: "/api/v1/payroll-periods/:id/export", key: "periodExport" },
  { method: "PATCH", path: "/api/v1/payroll-periods/:id/lines/:lineId", key: "periodAdjustLine" },
  { method: "POST", path: "/api/v1/payroll-periods/:id/submit", key: "periodSubmit" },
  { method: "POST", path: "/api/v1/payroll-periods/:id/approve", key: "periodApprove" },
  { method: "POST", path: "/api/v1/payroll-periods/:id/reject", key: "periodReject" },
  {
    method: "POST",
    path: "/api/v1/payroll-periods/:id/generate-payslips",
    key: "periodGeneratePayslips",
  },
  { method: "POST", path: "/api/v1/payroll-periods/:id/publish", key: "periodPublish" },
  { method: "POST", path: "/api/v1/payroll-periods/:id/lock", key: "periodLock" },
  { method: "POST", path: "/api/v1/payroll-periods/:id/reopen", key: "periodReopen" },
  { method: "GET", path: "/api/v1/payslips", key: "payslipList" },
  { method: "GET", path: "/api/v1/payslips/:id", key: "payslipDetail" },
  { method: "GET", path: "/api/v1/me/payslips", key: "mePayslipList" },
  { method: "GET", path: "/api/v1/me/payslips/:id", key: "mePayslipDetail" },
  { method: "POST", path: "/api/v1/me/payslips/:id/acknowledge", key: "mePayslipAck" },
  { method: "GET", path: "/api/v1/salary-profiles", key: "salaryProfileList" },
  { method: "POST", path: "/api/v1/salary-profiles", key: "salaryProfileCreate" },
  { method: "GET", path: "/api/v1/salary-profiles/:id", key: "salaryProfileDetail" },
  { method: "PATCH", path: "/api/v1/salary-profiles/:id", key: "salaryProfileUpdate" },
  { method: "GET", path: "/api/v1/bonus-penalties", key: "bonusPenaltyList" },
  { method: "POST", path: "/api/v1/bonus-penalties", key: "bonusPenaltyCreate" },
  { method: "POST", path: "/api/v1/bonus-penalties/:id/approve", key: "bonusPenaltyApprove" },
  { method: "POST", path: "/api/v1/bonus-penalties/:id/reject", key: "bonusPenaltyReject" },
  { method: "GET", path: "/api/v1/bonus-penalties/:id", key: "bonusPenaltyDetail" },
  { method: "PATCH", path: "/api/v1/bonus-penalties/:id", key: "bonusPenaltyUpdate" },
  { method: "GET", path: "/api/v1/payroll/pickers/people", key: "pickerPeople" },
  {
    method: "GET",
    path: "/api/v1/payroll/pickers/attendance-periods",
    key: "pickerAttendancePeriods",
  },
  // ── S15-PAYROLL-BE-1 (track A) ──
  // `payroll/employees` là prefix RIÊNG, không lồng dưới `payroll/pickers` (SPEC-11 §15.1 bẫy 4).
  { method: "GET", path: "/api/v1/payroll/employees", key: "employeeList" },
  { method: "GET", path: "/api/v1/payroll/employees/:userId", key: "employeeDetail" },
  {
    method: "GET",
    path: "/api/v1/payroll/employees/:userId/settings",
    key: "employeeSettingsGet",
  },
  {
    method: "PUT",
    path: "/api/v1/payroll/employees/:userId/settings",
    key: "employeeSettingsPut",
  },
  {
    method: "GET",
    path: "/api/v1/payroll/employees/:userId/dependents",
    key: "employeeDependentList",
  },
  {
    method: "POST",
    path: "/api/v1/payroll/employees/:userId/dependents",
    key: "employeeDependentCreate",
  },
  // 042 KHÔNG lồng dưới `:userId` — CÓ CHỦ ĐÍCH (SPEC-11 §15.1): `dependentId` đã đủ định danh, lồng
  // thêm `userId` tạo HAI nguồn sự thật cho cùng một phép kiểm quyền (URL nói người A, hàng DB nói
  // người B). Service resolve `userId` TỪ HÀNG.
  { method: "PATCH", path: "/api/v1/payroll/dependents/:id", key: "dependentUpdate" },
  // 043 — literal path CHÍNH XÁC (KHÔNG phải `attendance-summary`): `route-http-coverage` khớp theo
  // literal path, lệch tên = cổng đếm hụt.
  { method: "GET", path: "/api/v1/payroll-periods/:id/timesheet", key: "periodTimesheet" },
  // ── S15-PAYROLL-BE-2 (track B · 044–058) ──
  // 048 `validate-formula` là route TĨNH cùng basePath với `:id` — controller khai nó TRƯỚC (API-18 §5b bẫy 2).
  { method: "GET", path: "/api/v1/payroll/salary-components", key: "componentList" },
  { method: "POST", path: "/api/v1/payroll/salary-components", key: "componentCreate" },
  {
    method: "POST",
    path: "/api/v1/payroll/salary-components/validate-formula",
    key: "componentValidateFormula",
  },
  { method: "GET", path: "/api/v1/payroll/salary-components/:id", key: "componentDetail" },
  { method: "PATCH", path: "/api/v1/payroll/salary-components/:id", key: "componentUpdate" },
  { method: "GET", path: "/api/v1/payroll/templates", key: "templateList" },
  { method: "POST", path: "/api/v1/payroll/templates", key: "templateCreate" },
  { method: "GET", path: "/api/v1/payroll/templates/:id", key: "templateDetail" },
  { method: "PATCH", path: "/api/v1/payroll/templates/:id", key: "templateUpdate" },
  {
    method: "PUT",
    path: "/api/v1/payroll/templates/:id/components",
    key: "templatePutComponents",
  },
  { method: "POST", path: "/api/v1/payroll/templates/:id/preview", key: "templatePreview" },
  { method: "GET", path: "/api/v1/payroll/statutory-rates", key: "statutoryRateList" },
  { method: "POST", path: "/api/v1/payroll/statutory-rates", key: "statutoryRateCreate" },
  { method: "GET", path: "/api/v1/payroll/statutory-rates/:id", key: "statutoryRateDetail" },
  { method: "PATCH", path: "/api/v1/payroll/statutory-rates/:id", key: "statutoryRateUpdate" },
  // ── S15-PAYROLL-BE-4 (track C · 059–077) ──
  { method: "GET", path: "/api/v1/payroll/advances", key: "advanceList" },
  { method: "POST", path: "/api/v1/payroll/advances", key: "advanceCreate" },
  { method: "GET", path: "/api/v1/payroll/advances/:id", key: "advanceDetail" },
  { method: "PATCH", path: "/api/v1/payroll/advances/:id", key: "advanceUpdate" },
  { method: "POST", path: "/api/v1/payroll/advances/:id/approve", key: "advanceApprove" },
  { method: "POST", path: "/api/v1/payroll/advances/:id/reject", key: "advanceReject" },
  // 065 Own — segment `me` (module ME trong openapi-modules), cùng khuôn `/me/payslips*`.
  { method: "GET", path: "/api/v1/me/payroll-advances", key: "meAdvanceList" },
  { method: "GET", path: "/api/v1/payroll/payment-batches", key: "batchList" },
  { method: "POST", path: "/api/v1/payroll/payment-batches", key: "batchCreate" },
  { method: "GET", path: "/api/v1/payroll/payment-batches/:id", key: "batchDetail" },
  { method: "PATCH", path: "/api/v1/payroll/payment-batches/:id", key: "batchUpdate" },
  { method: "GET", path: "/api/v1/payroll/payment-batches/:id/lines", key: "batchLines" },
  { method: "GET", path: "/api/v1/payroll/payment-batches/:id/export", key: "batchExport" },
  { method: "POST", path: "/api/v1/payroll/payment-batches/:id/complete", key: "batchComplete" },
  { method: "GET", path: "/api/v1/payroll/budgets", key: "budgetList" },
  { method: "POST", path: "/api/v1/payroll/budgets", key: "budgetCreate" },
  { method: "PATCH", path: "/api/v1/payroll/budgets/:id", key: "budgetUpdate" },
  // 076 nằm dưới `payroll-periods/:id` (controller gốc `@Controller()` — path đầy đủ); 077 tệp mẫu tĩnh.
  {
    method: "POST",
    path: "/api/v1/payroll-periods/:id/import-adjustments",
    key: "importAdjustments",
  },
  { method: "GET", path: "/api/v1/payroll/imports/adjustments-template", key: "importTemplate" },
  // ── S15-PAYROLL-BE-5 (track D phần 1) — `reports` TĨNH khai trước `reports/:reportCode` ──
  { method: "GET", path: "/api/v1/payroll/overview", key: "overview" },
  { method: "GET", path: "/api/v1/payroll/overview/reminders", key: "overviewReminders" },
  { method: "GET", path: "/api/v1/payroll/reports", key: "reportList" },
  { method: "GET", path: "/api/v1/payroll/reports/:reportCode", key: "reportData" },
  { method: "GET", path: "/api/v1/payroll/reports/:reportCode/export", key: "reportExport" },
  // ── S15-PAYROLL-BE-5B (track D phần 2) — PDF phiếu lương ──
  { method: "GET", path: "/api/v1/payslips/:id/pdf", key: "payslipPdf" },
  { method: "GET", path: "/api/v1/me/payslips/:id/pdf", key: "mePayslipPdf" },
  {
    method: "POST",
    path: "/api/v1/payroll-periods/:id/payslips/pdf-batch",
    key: "payslipPdfBatch",
  },
];

const PAYROLL_CONTROLLERS = new Set([
  "PayrollPeriodsController",
  "SalaryProfilesController",
  "BonusPenaltiesController",
  "PayslipsController",
  "MePayslipsController",
  "PayrollPickersController",
  // ── S15-PAYROLL-BE-1 ──
  "PayrollEmployeesController",
  "PayrollDependentsController",
  // ── S15-PAYROLL-BE-2 ──
  "PayrollSalaryComponentsController",
  "PayrollTemplatesController",
  "PayrollStatutoryRatesController",
  // ── S15-PAYROLL-BE-4 ──
  "PayrollAdvancesController",
  "MePayrollAdvancesController",
  "PayrollPaymentBatchesController",
  "PayrollBudgetsController",
  "PayrollAdjustmentImportsController",
  // ── S15-PAYROLL-BE-5 ──
  "PayrollReportsController",
  // ── S15-PAYROLL-BE-5B ──
  "PayrollPayslipPdfController",
  "MePayslipPdfController",
  "PayrollPayslipPdfBatchController",
]);

/** Sổ pin method↔key — đổi handler/key là ĐỎ, phải sửa CÓ CHỦ ĐÍCH qua FULL gate. */
const SERVICE_SITE_TO_KEYS: Readonly<Record<string, readonly string[]>> = {
  "PayrollPeriodsService#list": ["periodList"],
  "PayrollPeriodsService#create": ["periodCreate"],
  "PayrollPeriodsService#get": ["periodDetail"],
  "PayrollPeriodsService#update": ["periodUpdate"],
  "PayrollPeriodsService#collect": ["periodCollect"],
  "PayrollPeriodsService#readiness": ["periodReadiness"],
  "PayrollPeriodsService#pickAttendancePeriods": ["pickerAttendancePeriods"],
  // ── S15-PAYROLL-BE-1 (track A) ──
  "PayrollPeriodsService#timesheet": ["periodTimesheet"],
  "PayrollEmployeesService#list": ["employeeList"],
  "PayrollEmployeesService#get": ["employeeDetail"],
  "PayrollEmployeeSettingsService#get": ["employeeSettingsGet"],
  "PayrollEmployeeSettingsService#upsert": ["employeeSettingsPut"],
  "PayrollDependentsService#list": ["employeeDependentList"],
  "PayrollDependentsService#create": ["employeeDependentCreate"],
  "PayrollDependentsService#update": ["dependentUpdate"],
  "SalaryProfilesService#list": ["salaryProfileList"],
  "SalaryProfilesService#create": ["salaryProfileCreate"],
  "SalaryProfilesService#get": ["salaryProfileDetail"],
  "SalaryProfilesService#update": ["salaryProfileUpdate"],
  "SalaryProfilesService#pickPeople": ["pickerPeople"],
  "BonusPenaltiesService#list": ["bonusPenaltyList"],
  "BonusPenaltiesService#create": ["bonusPenaltyCreate"],
  "BonusPenaltiesService#get": ["bonusPenaltyDetail"],
  "BonusPenaltiesService#update": ["bonusPenaltyUpdate"],
  // `approve`/`reject` (027/028) đi chung `decide` — key chọn theo tham số `status`, nên site này
  // mang HAI key. Đó là hình dạng ĐÚNG, không phải thiếu pin: hai route dùng CÙNG resource
  // `bonus-penalty` + CÙNG action `approve`, chỉ khác đích FSM.
  "BonusPenaltiesService#decide": ["bonusPenaltyApprove", "bonusPenaltyReject"],
  // ── S13-PAYROLL-BE-2 ──
  "PayrollCalcService#calculate": ["periodCalculate"],
  "PayrollCalcService#listLines": ["periodLines"],
  "PayrollCalcService#adjustLine": ["periodAdjustLine"],
  "PayrollCalcService#summary": ["periodSummary"],
  "PayrollApprovalService#submit": ["periodSubmit"],
  "PayrollApprovalService#approve": ["periodApprove"],
  "PayrollApprovalService#reject": ["periodReject"],
  "PayrollApprovalService#lock": ["periodLock"],
  "PayrollApprovalService#reopen": ["periodReopen"],
  "PayrollPayslipsService#generate": ["periodGeneratePayslips"],
  "PayrollPayslipsService#publish": ["periodPublish"],
  "PayrollPayslipsService#list": ["payslipList"],
  "PayrollPayslipsService#get": ["payslipDetail"],
  "PayrollPayslipsService#listMine": ["mePayslipList"],
  "PayrollPayslipsService#getMine": ["mePayslipDetail"],
  "PayrollPayslipsService#acknowledge": ["mePayslipAck"],
  // `export` (017) đòi **HAI** cặp: `export:payroll` (decorator) + `view-line:payroll-period`
  // (SPEC-11 §18 · API-18 §5.1). Hai literal ở CÙNG site là hình dạng ĐÚNG — mất một literal ở đây
  // nghĩa là ai đó vừa gỡ một vế assert, và ca này phải ĐỎ. Tiền lệ: `BonusPenaltiesService#decide`.
  "PayrollExportService#export": ["periodExport", "periodLines"],
  // ── S15-PAYROLL-BE-2 (track B) ──
  "SalaryComponentsService#list": ["componentList"],
  "SalaryComponentsService#get": ["componentDetail"],
  "SalaryComponentsService#create": ["componentCreate"],
  "SalaryComponentsService#update": ["componentUpdate"],
  "SalaryComponentsService#validateFormula": ["componentValidateFormula"],
  "PayrollTemplatesService#list": ["templateList"],
  "PayrollTemplatesService#get": ["templateDetail"],
  "PayrollTemplatesService#create": ["templateCreate"],
  "PayrollTemplatesService#update": ["templateUpdate"],
  "PayrollTemplatesService#putComponents": ["templatePutComponents"],
  "PayrollTemplatesService#preview": ["templatePreview"],
  "StatutoryRatesService#list": ["statutoryRateList"],
  "StatutoryRatesService#get": ["statutoryRateDetail"],
  "StatutoryRatesService#create": ["statutoryRateCreate"],
  "StatutoryRatesService#update": ["statutoryRateUpdate"],
  // ── S15-PAYROLL-BE-4 (track C) ──
  "PayrollAdvancesService#list": ["advanceList"],
  "PayrollAdvancesService#create": ["advanceCreate"],
  "PayrollAdvancesService#get": ["advanceDetail"],
  "PayrollAdvancesService#update": ["advanceUpdate"],
  // 063/064 đi chung `decide` — key chọn theo tham số `status` (khuôn `BonusPenaltiesService#decide`).
  "PayrollAdvancesService#decide": ["advanceApprove", "advanceReject"],
  "PayrollAdvancesService#listMine": ["meAdvanceList"],
  "PayrollPaymentBatchesService#list": ["batchList"],
  "PayrollPaymentBatchesService#create": ["batchCreate"],
  "PayrollPaymentBatchesService#get": ["batchDetail"],
  "PayrollPaymentBatchesService#update": ["batchUpdate"],
  "PayrollPaymentBatchesService#lines": ["batchLines"],
  "PayrollPaymentBatchesService#complete": ["batchComplete"],
  // 071 đòi **BA** cặp (SPEC-11 §15.1): `manage:payment-batch` (decorator) + `export:payroll` + `view-payslip:payslip`.
  // Ba literal ở CÙNG site là hình dạng ĐÚNG — mất một literal = ai đó vừa gỡ một vế assert, ca này phải ĐỎ.
  "PayrollPaymentExportService#export": ["batchExport", "periodExport", "payslipList"],
  "PayrollBudgetsService#list": ["budgetList"],
  "PayrollBudgetsService#create": ["budgetCreate"],
  "PayrollBudgetsService#update": ["budgetUpdate"],
  "PayrollAdjustmentImportService#import": ["importAdjustments"],
  "PayrollAdjustmentImportService#template": ["importTemplate"],
  // ── S15-PAYROLL-BE-5 (track D phần 1) — cặp NGUỒN (owner O-2) đi qua `def.sourceRouteKey` (biến, scanner này
  //    không bắt) ⇒ ghim riêng ở `payroll-report-source-pairs.unit-spec.ts`. 082 assert THÊM `periodExport`. ──
  "PayrollOverviewService#overview": ["overview"],
  "PayrollOverviewService#reminders": ["overviewReminders"],
  "PayrollReportsService#catalog": ["reportList"],
  "PayrollReportsService#data": ["reportData"],
  "PayrollReportExportService#export": ["periodExport", "reportExport"],
  // ── S15-PAYROLL-BE-5B (track D phần 2) — «export đòi CẢ HAI cặp» (§11.1): 083/085 hai literal ở CÙNG site.
  //    Consumer 085 dựng lại actor của NGƯỜI YÊU CẦU với CHÍNH hai cặp đó (plan §0b) — mất một literal = đỏ. ──
  "PayrollPayslipPdfService#adminPdf": ["payslipPdf", "periodExport"],
  "PayrollPayslipPdfService#myPdf": ["mePayslipPdf"],
  "PayrollPayslipPdfBatchService#request": ["payslipPdfBatch", "payslipList"],
  "PayrollPayslipPdfBatchConsumer#load": ["payslipPdfBatch", "payslipList"],
};

/**
 * Quét ĐỆ QUY (S15-PAYROLL-BE-2 M4): `readdirSync` phẳng bỏ sót mọi file ở thư mục con (`src/payroll/formula/`) —
 * một `resolveActor` hoặc một route key đặt ở đó sẽ lọt khỏi cổng mà không ca nào đỏ.
 */
function walkTs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkTs(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [full] : [];
  });
}

function serviceResolveActorCalls(): Array<{ site: string; key: string }> {
  const calls: Array<{ site: string; key: string }> = [];
  for (const file of walkTs(SRC_PAYROLL)) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node, cls: string, method: string): void => {
      let nextCls = cls;
      let nextMethod = method;
      if (ts.isClassDeclaration(node) && node.name) nextCls = node.name.text;
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) nextMethod = node.name.text;
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "resolveActor" &&
        node.arguments.length === 2 &&
        ts.isStringLiteral(node.arguments[1])
      ) {
        calls.push({ site: `${nextCls}#${nextMethod}`, key: node.arguments[1].text });
      }
      // `decide` chọn key qua toán tử điều kiện — hai literal, không phải lời gọi. Bắt riêng để sổ
      // pin không bị rỗng ở site đó.
      if (
        ts.isConditionalExpression(node) &&
        ts.isStringLiteral(node.whenTrue) &&
        ts.isStringLiteral(node.whenFalse) &&
        node.whenTrue.text in PAYROLL_ROUTE_PAIRS &&
        node.whenFalse.text in PAYROLL_ROUTE_PAIRS
      ) {
        calls.push({ site: `${nextCls}#${nextMethod}`, key: node.whenTrue.text });
        calls.push({ site: `${nextCls}#${nextMethod}`, key: node.whenFalse.text });
      }
      ts.forEachChild(node, (c) => visit(c, nextCls, nextMethod));
    };
    visit(sf, "?", "?");
  }
  // Site `decide` xuất hiện 2 lần từ nhánh conditional + 1 lần từ `resolveActor(user, routeKey)`
  // (biến, không phải literal ⇒ không bắt). De-dup theo (site,key).
  const seen = new Set<string>();
  return calls.filter((c) => {
    const k = `${c.site}→${c.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

describe("PAYROLL census 2 tầng — decorator + service so với PAYROLL_ROUTE_PAIRS", () => {
  let app: INestApplication;
  let payrollRoutes: RouteInfo[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    payrollRoutes = collectRoutes(app).filter((r) => PAYROLL_CONTROLLERS.has(r.controller));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it("(1) bảng fixture phủ ĐÚNG tập route PAYROLL đã boot — không thiếu, không thừa", () => {
    // Chốt chặn xanh-RỖNG: scanner/boot hỏng ⇒ 0 route ⇒ mọi assert dưới vô nghĩa.
    // S15-PAYROLL-BE-5: +5 (078–082) ⇒ 82; S15-PAYROLL-BE-5B: +3 (083–085) ⇒ 85 — ĐỦ 85 route API-18.
    expect(payrollRoutes.length, "app boot phải thấy ĐỦ 85 route PAYROLL (API-18 §5 + §5b)").toBe(
      85,
    );
    const seen = new Set(payrollRoutes.map((r) => `${r.httpMethod} ${r.path}`));
    const expected = new Set(ROUTE_TO_KEY.map((r) => `${r.method} ${r.path}`));
    expect(
      [...seen].filter((k) => !expected.has(k)),
      "route PAYROLL mọc ngoài bảng census",
    ).toEqual([]);
    expect(
      [...expected].filter((k) => !seen.has(k)),
      "bảng census giữ route không tồn tại",
    ).toEqual([]);
  });

  it("(2) TẦNG 1 — decorator khai ĐÚNG cặp VÀ đúng cờ isSensitive", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const row of ROUTE_TO_KEY) {
      const route = payrollRoutes.find((r) => r.httpMethod === row.method && r.path === row.path);
      if (!route) continue;
      checked++;
      const pair = PAYROLL_ROUTE_PAIRS[row.key];
      const want = `${pair.action}:${pair.resourceType}`;
      if (!route.hasPermission || route.permission !== want) {
        bad.push(`${row.method} ${row.path} — decorator '${route.permission}' ≠ bảng '${want}'`);
      }
      // S15-PAYROLL-QA-1 (G13): tiêu đề hứa so CẢ cờ nhưng bản trước chỉ so chuỗi cặp — decorator gõ cứng
      // `isSensitive: false` vẫn xanh. So TƯỜNG MINH từng route (undefined ≠ false: option bị bỏ cũng là lệch).
      if (route.isSensitive !== pair.isSensitive) {
        bad.push(
          `${row.method} ${row.path} — decorator isSensitive=${String(route.isSensitive)} ≠ bảng ${String(pair.isSensitive)}`,
        );
      }
    }
    // Chống xanh-RỖNG: `continue` ở trên không được nuốt route nào (1) đã chốt đủ 85.
    expect(checked, "vòng so decorator phải đi qua ĐỦ 85 route").toBe(85);
    expect(bad, "decorator lệch bảng hằng (sửa route hoặc sửa bảng QUA FULL gate)").toEqual([]);
  });

  it("(3) TẦNG 2 — service: ĐÚNG method dùng ĐÚNG key (map pin, không chỉ đếm)", () => {
    const calls = serviceResolveActorCalls();
    // 80 = 77 route + literal thứ hai của `PayrollExportService#export` (`view-line`) + hai literal thêm của
    // `PayrollPaymentExportService#export` (`periodExport` · `payslipList` — 071 gác BA cặp, S15-PAYROLL-BE-4).
    // S15-PAYROLL-BE-5: +5 route + literal `periodExport` của `PayrollReportExportService#export` ⇒ 86.
    // S15-PAYROLL-BE-5B: +3 route + `periodExport` (083) + `payslipList` (085) + 2 literal của consumer ⇒ 93.
    expect(calls.length, "scanner resolveActor trả quá ít — nó hỏng").toBeGreaterThanOrEqual(93);
    const validKeys = new Set(Object.keys(PAYROLL_ROUTE_PAIRS));
    expect(
      calls.filter((c) => !validKeys.has(c.key)).map((c) => `${c.site}→${c.key}`),
      "literal routeKey KHÔNG có trong PAYROLL_ROUTE_PAIRS",
    ).toEqual([]);
    const bySite = new Map<string, string[]>();
    for (const c of calls) {
      const cur = bySite.get(c.site);
      if (cur) cur.push(c.key);
      else bySite.set(c.site, [c.key]);
    }
    const actual = Object.fromEntries(
      [...bySite.entries()].map(([site, keys]) => [site, [...keys].sort()]),
    );
    const expected = Object.fromEntries(
      Object.entries(SERVICE_SITE_TO_KEYS).map(([site, keys]) => [site, [...keys].sort()]),
    );
    expect(actual, "map Class#method → routeKey lệch sổ pin SERVICE_SITE_TO_KEYS").toEqual(
      expected,
    );
  });

  it("(4) mọi route CÓ decorator đều được assert lại ở tầng service (đủ tầng 2)", () => {
    const used = new Set(serviceResolveActorCalls().map((c) => c.key));
    const routed = new Set(ROUTE_TO_KEY.map((r) => r.key));
    expect(
      [...routed].filter((k) => !used.has(k)),
      "route có decorator nhưng KHÔNG được assert lại ở tầng service (thiếu tầng 2)",
    ).toEqual([]);
  });

  it("(5) PENDING_BE2 là CỔNG: hợp = toàn bộ 35 key, giao với key đã dùng = ∅ (BE-2: PENDING rỗng)", () => {
    const all = new Set(Object.keys(PAYROLL_ROUTE_PAIRS));
    const used = new Set(ROUTE_TO_KEY.map((r) => r.key as string));
    const pending = new Set<string>(PAYROLL_PENDING_BE2);
    expect(all.size, "bảng hằng phải khai đủ 85 route API-18 (BE-5B)").toBe(85);
    expect(
      [...pending].filter((k) => used.has(k)),
      "key ĐÃ có route mà vẫn nằm trong PENDING_BE2",
    ).toEqual([]);
    expect(
      [...all].filter((k) => !used.has(k) && !pending.has(k)),
      "key không có route và cũng không khai PENDING_BE2 — vùng mù im lặng",
    ).toEqual([]);
    // ⚠️ NEO THAY THẾ (§10). `PENDING_BE2` rỗng từ BE-2 ⇒ chính nó không còn chống được xanh-RỖNG:
    // một `ROUTE_TO_KEY` bị xoá sạch cũng thoả cả ba assert trên. Hai neo dưới ghim SỐ LƯỢNG thật của
    // cả bảng hằng lẫn tập key đã nối dây. **Cấm hạ neo để lấy màu xanh.**
    expect(pending.size, "BE-2 đã nối dây hết — PENDING_BE2 phải RỖNG").toBe(0);
    expect(used.size, "85 key đều phải có route").toBe(85);
  });

  it("(6) SÀN SCOPE Company — đúng 5 route Own (/me/payslips* + /me/payroll-advances) được miễn", () => {
    const noFloor = Object.entries(PAYROLL_ROUTE_PAIRS)
      .filter(([, p]) => !p.companyFloor)
      .map(([k]) => k)
      .sort();
    // S15-PAYROLL-BE-4: + `meAdvanceList` (065 — `view-own:payroll-advance`, Own hợp lệ).
    // S15-PAYROLL-BE-5B: + `mePayslipPdf` (084 — cùng cặp/cờ với 032).
    expect(noFloor).toEqual([
      "meAdvanceList",
      "mePayslipAck",
      "mePayslipDetail",
      "mePayslipList",
      "mePayslipPdf",
    ]);
    // 085 lấy TOÀN BỘ phiếu của kỳ — chỉ đúng khi CẢ HAI cặp của nó có sàn Company (plan BE-5B §0b «IDOR 085»).
    expect(PAYROLL_ROUTE_PAIRS.payslipPdfBatch.companyFloor).toBe(true);
    expect(PAYROLL_ROUTE_PAIRS.payslipList.companyFloor).toBe(true);
    expect(PAYROLL_ROUTE_PAIRS.payslipPdf.companyFloor).toBe(true);
  });

  it("(7) objectGrantRequired chỉ được khai `false`, và đúng cho 5 route Own", () => {
    const declared = Object.entries(PAYROLL_ROUTE_PAIRS).filter(
      ([, p]) => p.objectGrantRequired !== undefined,
    );
    // ⚠️ Khai `true` = deny-object-required fail-closed ⇒ 403 CẢ ROUTE (permission.decide.ts:93-97).
    expect(
      declared.filter(([, p]) => p.objectGrantRequired !== false).map(([k]) => k),
      "objectGrantRequired=true là 403 cả route — KHÔNG BAO GIỜ khai",
    ).toEqual([]);
    expect(declared.map(([k]) => k).sort()).toEqual([
      "meAdvanceList",
      "mePayslipAck",
      "mePayslipDetail",
      "mePayslipList",
      "mePayslipPdf",
    ]);
  });

  it("(8) cờ sensitive khớp seed mig 0565+0571 — đúng 30 cặp is_sensitive trên 33 cặp có route", () => {
    const pairs = Object.values(PAYROLL_ROUTE_PAIRS);
    const sensitive = new Set(
      pairs.filter((p) => p.isSensitive).map((p) => `${p.action}:${p.resourceType}`),
    );
    const notSensitive = new Set(
      pairs.filter((p) => !p.isSensitive).map((p) => `${p.action}:${p.resourceType}`),
    );
    // 21 = 13 của §11.1 + 2 cặp `payroll-employee` (BE-1) + 6 cặp track B (BE-2: view/manage × salary-component ·
    // payroll-template · statutory-rate) — cả 8 cặp v2 đều sensitive (mig 0571).
    // S15-PAYROLL-BE-4: +8 cặp track C (view/manage/approve/view-own × payroll-advance · view/manage × payment-batch ·
    // view/manage × payroll-budget) — TẤT CẢ sensitive (mig 0571) ⇒ 21 → 29; distinct có route 24 → 32.
    // S15-PAYROLL-BE-5: + `view:payroll-report` (sensitive, mig 0571) ⇒ 30 / 33 — đủ 17 cặp §11.3 có route.
    expect(sensitive.size, "30 cặp sensitive (SPEC-11 §11.1 + §11.3)").toBe(30);
    // Cặp `access:payroll` là cổng nav, không gác route nào.
    expect(sensitive.size + notSensitive.size).toBe(33);
    expect([...notSensitive].sort()).toEqual([
      "acknowledge-own-payslip:payslip",
      "manage:payroll-period",
      "view:payroll-period",
    ]);
    // Một cặp KHÔNG được vừa sensitive vừa không — cờ phải nhất quán trên mọi route dùng nó.
    expect(
      [...sensitive].filter((p) => notSensitive.has(p)),
      "cờ sensitive lệch giữa hai route cùng cặp",
    ).toEqual([]);
  });

  /**
   * S15-PAYROLL-BE-1 — `MONEY_FREE_ROUTES` nở từ 5 lên 13 key. Docblock **không phải cổng**, nên ghim
   * bằng ĐẲNG THỨC: `toContain` để lọt cả hai chiều sai (thêm nhầm một route CHỞ TIỀN vào set ⇒ mapper
   * thôi mask; bỏ sót một route không-tiền ⇒ DTO mất trường vô cớ).
   *
   * ⚠️ Set này KHÔNG suy ngược được thành "cặp gác route này không chở tiền" — `periodTimesheet` gác
   * bằng `view-line:payroll-period` (cặp chở-tiền ở route KHÁC) mà payload là số NGÀY. Ai sửa danh
   * sách phải đọc `PayrollAccessService.MONEY_FREE_ROUTES` JSDoc trước.
   */
  it("(9) MONEY_FREE_ROUTES là danh sách ĐÓNG — đẳng thức, không `toContain`", () => {
    const declared = [...PayrollAccessService.MONEY_FREE_ROUTES].sort();
    expect(declared).toEqual(
      [
        "dependentUpdate",
        "employeeDependentCreate",
        "employeeDependentList",
        "employeeDetail",
        "employeeList",
        "employeeSettingsGet",
        "employeeSettingsPut",
        "periodCreate",
        "periodDetail",
        "periodList",
        "periodTimesheet",
        "periodUpdate",
        "pickerAttendancePeriods",
        // ── S15-PAYROLL-BE-2 — route GHI trả { id } · DTO mẫu chỉ công thức · 048 trả lỗi cú pháp ──
        "componentCreate",
        "componentUpdate",
        "componentValidateFormula",
        "templateList",
        "templateCreate",
        "templateDetail",
        "templateUpdate",
        "templatePutComponents",
        "statutoryRateCreate",
        "statutoryRateUpdate",
        // ── S15-PAYROLL-BE-4 — route GHI trả `{ id, status?, warnings }` + 077 tệp mẫu tĩnh. KHÔNG thêm 059/061/065
        //    (`amount`) · 066/068 (`totalNet`) · 070 (`net`) · 071 (UNC) · 073 (`plannedAmount`/`actualAmount`). ──
        "advanceCreate",
        "advanceUpdate",
        "advanceApprove",
        "advanceReject",
        "batchCreate",
        "batchUpdate",
        "batchComplete",
        "budgetCreate",
        "budgetUpdate",
        "importAdjustments",
        "importTemplate",
        // ── S15-PAYROLL-BE-5 — 079 chỉ SỐ ĐẾM · 080 danh mục metadata. KHÔNG thêm 078/081/082 (chở tiền). ──
        "overviewReminders",
        "reportList",
      ].sort(),
    );
    // Mọi key trong set phải là route THẬT — key chết ở đây là mask im lặng cho một route không tồn tại.
    const all = new Set(Object.keys(PAYROLL_ROUTE_PAIRS));
    expect(
      declared.filter((k) => !all.has(k)),
      "key lạ trong MONEY_FREE_ROUTES",
    ).toEqual([]);
  });
});
