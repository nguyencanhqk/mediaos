/**
 * S15-PAYROLL-BE-2 — lỗi của máy công thức.
 *
 * 🔴 Engine **KHÔNG ném HTTP exception** — nó ném `FormulaError` mang `kind` thuộc bảng ĐÓNG dưới đây, và
 * service ở tầng `src/payroll/` đổi sang `payrollUnprocessable(...)` qua `formulaErrorToHttp`. Hai lý do:
 *  1. Engine thuần (không Nest, không DB) ⇒ unit test + fuzz chạy không cần app.
 *  2. Census mã lỗi (`payroll-error-code-census.unit-spec.ts`) đọc `FORMULA_ERROR_KINDS` như MỘT NGUỒN ném:
 *     mọi `kind` ở đây phải có literal trong bề mặt test. Kind dựng động mà không có bảng đóng thì census
 *     cú pháp không thấy (`refactor-to-helper-blinds-syntax-census`).
 *
 * ⚠️ `details` KHÔNG BAO GIỜ chứa số tiền — chỉ vị trí, tên REF/hàm, chu trình theo MÃ, trần nào vỡ.
 */

/** kind → mã PAYROLL-ERR (SPEC-11 §12.1). Thêm kind = thêm hàng ở §12.1 cùng commit. */
export const FORMULA_ERROR_KINDS = {
  "formula-syntax": "PAYROLL-ERR-018",
  "formula-unknown-ref": "PAYROLL-ERR-018",
  "formula-unknown-function": "PAYROLL-ERR-018",
  "formula-arity": "PAYROLL-ERR-018",
  "formula-too-long": "PAYROLL-ERR-018",
  "formula-too-deep": "PAYROLL-ERR-018",
  "formula-too-many-nodes": "PAYROLL-ERR-018",
  "template-missing-engine-nodes": "PAYROLL-ERR-018",
  "formula-cycle": "PAYROLL-ERR-019",
  "formula-budget-exceeded": "PAYROLL-ERR-020",
  "division-by-zero": "PAYROLL-ERR-020",
  "numeric-overflow": "PAYROLL-ERR-020",
  "statutory-rate-incomplete": "PAYROLL-ERR-022",
} as const;

export type FormulaErrorKind = keyof typeof FORMULA_ERROR_KINDS;
export type FormulaErrorCode = (typeof FORMULA_ERROR_KINDS)[FormulaErrorKind];

export interface FormulaErrorDetails {
  /** Vị trí ký tự (chỉ số UTF-16, bắt đầu từ 0) trong chuỗi công thức. */
  readonly pos?: number;
  /** Mã thành phần đang được kiểm/đánh giá khi lỗi xảy ra. */
  readonly component?: string;
  readonly ref?: string;
  readonly func?: string;
  /** Chu trình đầy đủ theo MÃ, phần tử cuối lặp lại phần tử đầu (`A → B → A`). */
  readonly cycle?: readonly string[];
  readonly limit?: "per-pass" | "per-line";
  readonly pass?: number;
  readonly reason?: string;
  readonly missing?: readonly string[];
}

export class FormulaError extends Error {
  readonly code: FormulaErrorCode;

  constructor(
    readonly kind: FormulaErrorKind,
    message: string,
    readonly details: FormulaErrorDetails = {},
  ) {
    super(message);
    this.name = "FormulaError";
    this.code = FORMULA_ERROR_KINDS[kind];
  }
}

export const isFormulaError = (err: unknown): err is FormulaError => err instanceof FormulaError;
