/**
 * S13-PAYROLL-FE-1 — bóc mã lỗi nghiệp vụ PAYROLL từ `ApiError` (SPEC-11 §12, khuôn `recruit-errors.ts`).
 *
 * `error.details` là **MẢNG** `ErrorDetail{field,message,rule}` — `kind` = phần tử `field==="kind"`,
 * giá trị ở `.message` (memory `error-details-must-be-errordetail-array`). Đọc `details` như OBJECT
 * `{kind:...}` trả `undefined` và nuốt lỗi trong im lặng.
 *
 * ── ĐO 25 `kind` NHƯ THẾ NÀO (đọc trước khi thêm/bớt) ─────────────────────────────────────────────
 * Grep một khuôn duy nhất là **THIẾU** — BE phát `kind` theo BA hình dạng, và mỗi lần chỉ grep một
 * hình là lại sót (đúng lớp lỗi `identity-projection-census-misses-alias`):
 *
 *   1. `payrollDetails("<kind>")` — hình phổ biến;
 *   2. inline `[{ field: "kind", message: "<kind>", rule: "payroll" }]` — 3 chỗ ở
 *      `bonus-penalties.service.ts` (`self-approval` · `already-consumed` · `not-pending`);
 *   3. qua helper cục bộ `conflict(message, kind)` của `payroll-fsm.ts:101`, gọi `payrollDetails(kind)`
 *      với **BIẾN** — grep literal không thấy gì. Đây là nơi `invalid-transition` sống.
 *
 * `payroll-error-kind-census.spec.ts` đọc lại `apps/api/src/payroll/**` bằng `fs` theo cả ba hình dạng
 * và assert khớp ĐÚNG BẰNG với `PAYROLL_ERROR_KINDS` — thêm `kind` ở BE mà quên bảng này thì người dùng
 * thấy «Đã có lỗi xảy ra» thay vì câu giải thích, im lặng.
 */
import { parseKindError, type KindErrorInfo } from "@mediaos/web-core";
import { IDEMPOTENCY_ERROR_CODES } from "@mediaos/contracts";

export const PAYROLL_ERROR_KINDS = [
  "action-not-applicable",
  "already-acknowledged",
  "already-consumed",
  "attendance-not-locked",
  "attendance-period-missing",
  "bank-pair-incomplete",
  "bonus-frozen-race",
  "component-code-exists",
  "component-code-reserved",
  "component-in-use",
  "component-value-pair",
  "dependent-overlap",
  "effective-date-exists",
  "export-limit",
  "formula-override-not-allowed",
  "formula-too-long",
  "four-eyes",
  "invalid-transition",
  "no-eligible-approver",
  "no-eligible-employee",
  "no-line-to-generate",
  "no-payslip",
  "no-work-days",
  "not-found",
  "not-pending",
  "not-published",
  "payslip-already-generated",
  "payslip-duplicate",
  "period-frozen",
  "period-month-exists",
  "period-terminal",
  "profile-item-duplicate",
  "profile-item-unknown-component",
  "profile-item-wrong-type",
  "rate-effective-date-exists",
  "rate-in-use",
  "self-approval",
  "statutory-rate-missing",
  "system-component-drift",
  "system-component-immutable",
  "template-code-exists",
  "template-component-duplicate",
  "template-component-unknown",
  "template-inactive",
  "template-input-missing",
  "template-locked",
  "template-missing",
  "template-scope-pair",
  "template-scope-unsupported",
  "template-too-many-components",
  "trail-pair-violation",
  // ── S15-PAYROLL-BE-4 (track C: tạm ứng · đợt chi trả · ngân sách · import · 052 template-in-use) ──
  "advance-not-pending",
  "advance-already-deducted",
  "advance-period-frozen",
  "period-not-published",
  "batch-incomplete",
  "batch-already-completed",
  "payee-already-in-batch",
  "batch-code-exists",
  "batch-four-eyes",
  "payee-no-bank-account",
  "line-already-paid",
  "batch-empty",
  "budget-exists",
  "import-invalid",
  "import-too-large",
  "import-unknown-user",
  "template-in-use",
  "no-eligible-completer",
  // ── S15-PAYROLL-BE-5 (031) ──
  "report-too-large",
  // ── S15-PAYROLL-BE-5B (031 · 007) ──
  "pdf-batch-too-large",
  "no-payslip-for-pdf",
] as const;
export type PayrollErrorKind = (typeof PAYROLL_ERROR_KINDS)[number];

/** Alias của `KindErrorInfo` (@mediaos/web-core) — giữ tên cũ để 0 call-site phải đổi. */
export type PayrollErrorInfo = KindErrorInfo;

/** Bóc lỗi mang `kind` — dùng bản CHUNG; xem `parseKindError` ở @mediaos/web-core. */
export { parseKindError as parsePayrollError };

/** Ánh xạ `kind` → khoá i18n (namespace `payroll`). Tách riêng để spec neo "mọi kind có khoá riêng". */
const KIND_TO_I18N_KEY: Readonly<Record<PayrollErrorKind, string>> = {
  "action-not-applicable": "errors.actionNotApplicable",
  "already-acknowledged": "errors.alreadyAcknowledged",
  "already-consumed": "errors.alreadyConsumed",
  "attendance-not-locked": "errors.attendanceNotLocked",
  "attendance-period-missing": "errors.attendancePeriodMissing",
  "bank-pair-incomplete": "errors.bankPairIncomplete",
  "bonus-frozen-race": "errors.bonusFrozenRace",
  "component-code-exists": "errors.componentCodeExists",
  "component-code-reserved": "errors.componentCodeReserved",
  "component-in-use": "errors.componentInUse",
  "component-value-pair": "errors.componentValuePair",
  "dependent-overlap": "errors.dependentOverlap",
  "effective-date-exists": "errors.effectiveDateExists",
  "export-limit": "errors.exportLimit",
  "formula-override-not-allowed": "errors.formulaOverrideNotAllowed",
  "formula-too-long": "errors.formulaTooLong",
  "four-eyes": "errors.fourEyes",
  "invalid-transition": "errors.invalidTransition",
  "no-eligible-approver": "errors.noEligibleApprover",
  "no-eligible-employee": "errors.noEligibleEmployee",
  "no-line-to-generate": "errors.noLineToGenerate",
  "no-payslip": "errors.noPayslip",
  "no-work-days": "errors.noWorkDays",
  "not-found": "errors.notFound",
  "not-pending": "errors.notPending",
  "not-published": "errors.notPublished",
  "payslip-already-generated": "errors.payslipAlreadyGenerated",
  "payslip-duplicate": "errors.payslipDuplicate",
  "period-frozen": "errors.periodFrozen",
  "period-month-exists": "errors.periodMonthExists",
  "period-terminal": "errors.periodTerminal",
  "profile-item-duplicate": "errors.profileItemDuplicate",
  "profile-item-unknown-component": "errors.profileItemUnknownComponent",
  "profile-item-wrong-type": "errors.profileItemWrongType",
  "rate-effective-date-exists": "errors.rateEffectiveDateExists",
  "rate-in-use": "errors.rateInUse",
  "self-approval": "errors.selfApproval",
  "statutory-rate-missing": "errors.statutoryRateMissing",
  "system-component-drift": "errors.systemComponentDrift",
  "system-component-immutable": "errors.systemComponentImmutable",
  "template-code-exists": "errors.templateCodeExists",
  "template-component-duplicate": "errors.templateComponentDuplicate",
  "template-component-unknown": "errors.templateComponentUnknown",
  "template-inactive": "errors.templateInactive",
  "template-input-missing": "errors.templateInputMissing",
  "template-locked": "errors.templateLocked",
  "template-missing": "errors.templateMissing",
  "template-scope-pair": "errors.templateScopePair",
  "template-scope-unsupported": "errors.templateScopeUnsupported",
  "template-too-many-components": "errors.templateTooManyComponents",
  "trail-pair-violation": "errors.trailPairViolation",
  // ── S15-PAYROLL-BE-4 ──
  "advance-not-pending": "errors.advanceNotPending",
  "advance-already-deducted": "errors.advanceAlreadyDeducted",
  "advance-period-frozen": "errors.advancePeriodFrozen",
  "period-not-published": "errors.periodNotPublished",
  "batch-incomplete": "errors.batchIncomplete",
  "batch-already-completed": "errors.batchAlreadyCompleted",
  "payee-already-in-batch": "errors.payeeAlreadyInBatch",
  "batch-code-exists": "errors.batchCodeExists",
  "batch-four-eyes": "errors.batchFourEyes",
  "payee-no-bank-account": "errors.payeeNoBankAccount",
  "line-already-paid": "errors.lineAlreadyPaid",
  "batch-empty": "errors.batchEmpty",
  "budget-exists": "errors.budgetExists",
  "import-invalid": "errors.importInvalid",
  "import-too-large": "errors.importTooLarge",
  "import-unknown-user": "errors.importUnknownUser",
  "template-in-use": "errors.templateInUse",
  "no-eligible-completer": "errors.noEligibleCompleter",
  "report-too-large": "errors.reportTooLarge",
  "pdf-batch-too-large": "errors.pdfBatchTooLarge",
  "no-payslip-for-pdf": "errors.noPayslipForPdf",
};

/** Fallback theo `error.code` — CHỈ cho mã KHÔNG mang `kind` (idempotency, FOUNDATION). */
const CODE_TO_I18N_KEY: Readonly<Record<string, string>> = {
  [IDEMPOTENCY_ERROR_CODES.IN_PROGRESS]: "errors.idempotencyInProgress",
  [IDEMPOTENCY_ERROR_CODES.KEY_REUSED]: "errors.idempotencyKeyReused",
};

/**
 * S15-PAYROLL-FE-2 — **`kind` của MÁY CÔNG THỨC** (mirror khoá `FORMULA_ERROR_KINDS` ở
 * `apps/api/src/payroll/formula/formula.errors.ts`, 15 khoá).
 *
 * ⚠️ Bảng RIÊNG vì BE phát chúng qua `formulaErrorToHttp` → `payrollDetails(err.kind, …)` với **BIẾN** — ba
 * hình dạng của census ở trên grep literal nên MÙ với cả nhóm này, và trước WO này FE rơi «Có lỗi xảy ra» cho
 * mọi công thức sai. `payroll-error-kind-census.spec.ts` đọc bảng BE (hình 4) và so ĐÚNG BẰNG với mảng dưới.
 * `formula-too-long` có ở CẢ HAI bảng (service cũng ném literal) — cùng một khoá i18n.
 *
 * Nhóm này đi kèm `details` chỉ chỗ sai (`pos` · `ref` · `func` · `cycle` · `missing` · `reason`) — dùng
 * `payrollErrorText` (không phải `t(payrollErrorI18nKey(...))`) để câu nói được **ở đâu**.
 */
export const PAYROLL_FORMULA_ERROR_KINDS = [
  "formula-syntax",
  "formula-unknown-ref",
  "formula-unknown-function",
  "formula-arity",
  "formula-too-long",
  "formula-too-deep",
  "formula-too-many-nodes",
  "template-missing-engine-nodes",
  "formula-cycle",
  "formula-budget-exceeded",
  "division-by-zero",
  "numeric-overflow",
  "negative-total",
  "statutory-rate-incomplete",
  "grossup-not-converged",
] as const;
export type PayrollFormulaErrorKind = (typeof PAYROLL_FORMULA_ERROR_KINDS)[number];

const FORMULA_KIND_TO_I18N_KEY: Readonly<Record<PayrollFormulaErrorKind, string>> = {
  "formula-syntax": "errors.formulaSyntax",
  "formula-unknown-ref": "errors.formulaUnknownRef",
  "formula-unknown-function": "errors.formulaUnknownFunction",
  "formula-arity": "errors.formulaArity",
  "formula-too-long": "errors.formulaTooLong",
  "formula-too-deep": "errors.formulaTooDeep",
  "formula-too-many-nodes": "errors.formulaTooManyNodes",
  "template-missing-engine-nodes": "errors.templateMissingEngineNodes",
  "formula-cycle": "errors.formulaCycle",
  "formula-budget-exceeded": "errors.formulaBudgetExceeded",
  "division-by-zero": "errors.divisionByZero",
  "numeric-overflow": "errors.numericOverflow",
  "negative-total": "errors.negativeTotal",
  "statutory-rate-incomplete": "errors.statutoryRateIncomplete",
  "grossup-not-converged": "errors.grossupNotConverged",
};

/** Thứ tự tra: `kind` (chính xác nhất) → `code` (idempotency) → `generic`. */
export function payrollErrorI18nKey(info: PayrollErrorInfo): string {
  if (info.kind && info.kind in KIND_TO_I18N_KEY) {
    return KIND_TO_I18N_KEY[info.kind as PayrollErrorKind];
  }
  if (info.kind && info.kind in FORMULA_KIND_TO_I18N_KEY) {
    return FORMULA_KIND_TO_I18N_KEY[info.kind as PayrollFormulaErrorKind];
  }
  if (info.code && info.code in CODE_TO_I18N_KEY) {
    return CODE_TO_I18N_KEY[info.code];
  }
  return "errors.generic";
}

/**
 * `true` khi lỗi là tranh chấp TRẠNG THÁI (kỳ/khoản đã đổi ở nơi khác) — màn phải **tải lại** chi tiết
 * chứ không chỉ nhả toast: SPEC-11 §14 đòi «409 từ server ⇒ thông điệp + tải lại, KHÔNG mất form».
 *
 * Nhóm KHÔNG vào đây là lỗi ĐẦU VÀO/tiền đề sửa được tại chỗ (`no-work-days`, `no-eligible-employee`,
 * `export-limit`, `effective-date-exists`) — tải lại ở đó vô nghĩa và làm mất cái người dùng vừa gõ.
 *
 * ⚠️ `four-eyes` NẰM TRONG nhóm này: người vừa ăn 409 four-eyes cần thấy `submittedBy` mới nhất để
 * hiểu nút «Duyệt» sẽ biến mất — chứ không phải bấm lại và ăn đúng lỗi đó lần nữa.
 */
const STATE_CONFLICT_KINDS: ReadonlySet<string> = new Set<PayrollErrorKind>([
  "action-not-applicable",
  "invalid-transition",
  "four-eyes",
  "period-frozen",
  "period-terminal",
  "payslip-already-generated",
  "payslip-duplicate",
  "no-payslip",
  "no-line-to-generate",
  "period-month-exists",
  "attendance-not-locked",
  "attendance-period-missing",
  "not-pending",
  "already-consumed",
  "already-acknowledged",
  "not-published",
  "self-approval",
  "bonus-frozen-race",
  "trail-pair-violation",
  // S15-PAYROLL-BE-3 — kỳ vừa rời CollectingData ở nơi khác ⇒ tải lại để thấy trạng thái mới.
  "template-locked",
  // S15-PAYROLL-BE-4 — tranh chấp trạng thái tạm ứng/đợt/kỳ ⇒ tải lại chi tiết (không mất form).
  "advance-not-pending",
  "advance-already-deducted",
  "advance-period-frozen",
  "period-not-published",
  "batch-already-completed",
  "batch-incomplete",
  "batch-empty",
  "batch-four-eyes",
  "line-already-paid",
  "template-in-use",
]);

export function isPayrollStateConflict(info: PayrollErrorInfo): boolean {
  return info.kind !== null && STATE_CONFLICT_KINDS.has(info.kind);
}

/**
 * Khoá `Idempotency-Key` phải sinh MỚI sau `KEY_REUSED` (khoá cũ đã ghim payload khác trong 15′);
 * `IN_PROGRESS` PHẢI GIỮ NGUYÊN khoá (đổi khoá lúc đó chạy máy tính lương LẦN HAI trên cùng kỳ).
 */
export function shouldRotateIdempotencyKey(info: PayrollErrorInfo): boolean {
  return info.code === IDEMPOTENCY_ERROR_CODES.KEY_REUSED;
}

/** Hàm dịch tối giản — đủ cho `t` của react-i18next mà không kéo kiểu `TFunction` vào file thuần. */
export type PayrollTranslate = (key: string, options?: Record<string, unknown>) => string;

/** Chỗ sai của một lỗi công thức — cùng hình cho 422 (`details[]`) lẫn kết quả 048 (`errors[]`). */
export interface FormulaErrorWhere {
  readonly pos?: number | string;
  readonly ref?: string;
  readonly func?: string;
  /** Chuỗi đã nối `A → B → A` (422) hoặc mảng mã (048). */
  readonly cycle?: string | readonly string[];
  readonly missing?: string;
  readonly reason?: string;
  readonly component?: string;
}

/**
 * Tham số nội suy cho chữ lỗi công thức. `pos` của BE là chỉ số UTF-16 TỪ 0 ⇒ hiện +1 (người đọc đếm từ 1).
 * Trường vắng ⇒ chuỗi rỗng (không để `{{ref}}` lọt ra màn).
 */
export function formulaErrorParams(where: FormulaErrorWhere): Record<string, string> {
  const posNum = where.pos === undefined ? Number.NaN : Number(where.pos);
  const cycle = Array.isArray(where.cycle)
    ? where.cycle.join(" → ")
    : typeof where.cycle === "string"
      ? where.cycle
      : "";
  return {
    at: Number.isInteger(posNum) && posNum >= 0 ? ` (ký tự thứ ${posNum + 1})` : "",
    ref: where.ref ?? "",
    func: where.func ?? "",
    cycle,
    missing: where.missing ?? "",
    reason: where.reason ?? "",
    component: where.component ? ` (thành phần ${where.component})` : "",
  };
}

/**
 * Câu lỗi ĐẦY ĐỦ cho một `ApiError` PAYROLL — như `t(payrollErrorI18nKey(info))` nhưng nội suy chỗ sai
 * (`details[]` đã bóc thành `info.fields`). Dùng ở mọi form track B (thành phần · mẫu · tỉ lệ).
 */
export function payrollErrorText(t: PayrollTranslate, info: PayrollErrorInfo): string {
  const f = info.fields;
  const params = formulaErrorParams({
    pos: f.get("pos"),
    ref: f.get("ref"),
    func: f.get("func"),
    cycle: f.get("cycle"),
    missing: f.get("missing") ?? f.get("components"),
    reason: f.get("reason"),
    component: f.get("component"),
  });
  return t(payrollErrorI18nKey(info), params);
}

/** Câu cho MỘT lỗi của lượt kiểm 048 (`valid:false`) — cùng bảng chữ với 422 khi lưu. */
export function formulaIssueText(
  t: PayrollTranslate,
  issue: { kind: string; pos?: number; ref?: string; func?: string; cycle?: string[] },
): string {
  const key = payrollErrorI18nKey({
    code: null,
    status: 422,
    kind: issue.kind,
    message: "",
    fields: new Map(),
  });
  return t(key, formulaErrorParams(issue));
}
