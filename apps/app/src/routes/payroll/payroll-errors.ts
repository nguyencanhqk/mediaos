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
  "bonus-frozen-race",
  "effective-date-exists",
  "export-limit",
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
  "self-approval",
  "trail-pair-violation",
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
  "bonus-frozen-race": "errors.bonusFrozenRace",
  "effective-date-exists": "errors.effectiveDateExists",
  "export-limit": "errors.exportLimit",
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
  "self-approval": "errors.selfApproval",
  "trail-pair-violation": "errors.trailPairViolation",
};

/** Fallback theo `error.code` — CHỈ cho mã KHÔNG mang `kind` (idempotency, FOUNDATION). */
const CODE_TO_I18N_KEY: Readonly<Record<string, string>> = {
  [IDEMPOTENCY_ERROR_CODES.IN_PROGRESS]: "errors.idempotencyInProgress",
  [IDEMPOTENCY_ERROR_CODES.KEY_REUSED]: "errors.idempotencyKeyReused",
};

/** Thứ tự tra: `kind` (chính xác nhất) → `code` (idempotency) → `generic`. */
export function payrollErrorI18nKey(info: PayrollErrorInfo): string {
  if (info.kind && info.kind in KIND_TO_I18N_KEY) {
    return KIND_TO_I18N_KEY[info.kind as PayrollErrorKind];
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
