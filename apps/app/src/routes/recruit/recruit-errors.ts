/**
 * S12-RECRUIT-FE-1 — bóc mã lỗi nghiệp vụ RECRUIT từ `ApiError` (SPEC-12 §12, khuôn `asset-errors.ts`).
 *
 * `error.details` là **MẢNG** `ErrorDetail{field,message,rule}` — `kind` = phần tử `field==="kind"`,
 * giá trị ở `.message` (memory `error-details-must-be-errordetail-array`). Đọc `details` như OBJECT
 * `{kind:...}` trả `undefined` và nuốt lỗi trong im lặng.
 *
 * ⚠️ 27 `kind` dưới đây ĐO TỪ CODE BE THẬT (`grep -roE 'recruitDetails\("[a-z0-9-]+"' apps/api/src/
 * recruit/*.ts`), KHÔNG chép bảng SPEC-12 §12. KHÁC ASSET: mọi lỗi RECRUIT (conflict/unprocessable/
 * forbidden/not-found) đều đi kèm `kind` — không có nhánh "code không kèm kind" nào phải tra theo
 * `error.code` (mọi call site `recruitConflict/Unprocessable/Forbidden` trong repo đều truyền
 * `recruitDetails(...)` tường minh). Vẫn giữ fallback theo `code` cho mã idempotency (FOUNDATION, không
 * phải RECRUIT-ERR, không mang `kind`).
 */
import { parseKindError, type KindErrorInfo } from "@mediaos/web-core";
import { IDEMPOTENCY_ERROR_CODES } from "@mediaos/contracts";

export const RECRUIT_ERROR_KINDS = [
  "already-converted",
  "employee-code-conflict",
  "employee-inactive",
  "employee-not-found",
  "export-too-large",
  "feedback-duplicate",
  "hired-via-convert-only",
  "interview-cancelled",
  "invalid-interview-transition",
  "invalid-job-opening-transition",
  "invalid-offer-transition",
  "invalid-stage-transition",
  "invalid-start-date",
  "invalid-time-range",
  "job-closed",
  "no-offer",
  "not-draft",
  "not-found",
  "not-in-interview-stage",
  "not-in-offer-stage",
  "not-participant",
  "not-scheduled",
  "offer-not-accepted",
  "offer-open-exists",
  "org-unit-invalid",
  "position-invalid",
  "recruiter-invalid",
] as const;
export type RecruitErrorKind = (typeof RECRUIT_ERROR_KINDS)[number];

/** Alias của `KindErrorInfo` (@mediaos/web-core) — giữ tên cũ để 0 call-site phải đổi. */
export type RecruitErrorInfo = KindErrorInfo;


/** Bóc lỗi mang `kind` — dùng bản CHUNG; xem `parseKindError` ở @mediaos/web-core. */
export { parseKindError as parseRecruitError };

/** Ánh xạ `kind` → khoá i18n (namespace `recruit`). Tách riêng để spec neo "mọi kind có khoá riêng". */
const KIND_TO_I18N_KEY: Readonly<Record<RecruitErrorKind, string>> = {
  "already-converted": "errors.alreadyConverted",
  "employee-code-conflict": "errors.employeeCodeConflict",
  "employee-inactive": "errors.employeeInactive",
  "employee-not-found": "errors.employeeNotFound",
  "export-too-large": "errors.exportTooLarge",
  "feedback-duplicate": "errors.feedbackDuplicate",
  "hired-via-convert-only": "errors.hiredViaConvertOnly",
  "interview-cancelled": "errors.interviewCancelled",
  "invalid-interview-transition": "errors.invalidInterviewTransition",
  "invalid-job-opening-transition": "errors.invalidJobOpeningTransition",
  "invalid-offer-transition": "errors.invalidOfferTransition",
  "invalid-stage-transition": "errors.invalidStageTransition",
  "invalid-start-date": "errors.invalidStartDate",
  "invalid-time-range": "errors.invalidTimeRange",
  "job-closed": "errors.jobClosed",
  "no-offer": "errors.noOffer",
  "not-draft": "errors.notDraft",
  "not-found": "errors.notFound",
  "not-in-interview-stage": "errors.notInInterviewStage",
  "not-in-offer-stage": "errors.notInOfferStage",
  "not-participant": "errors.notParticipant",
  "not-scheduled": "errors.notScheduled",
  "offer-not-accepted": "errors.offerNotAccepted",
  "offer-open-exists": "errors.offerOpenExists",
  "org-unit-invalid": "errors.orgUnitInvalid",
  "position-invalid": "errors.positionInvalid",
  "recruiter-invalid": "errors.recruiterInvalid",
};

/** Fallback theo `error.code` — CHỈ cho mã KHÔNG mang `kind` (idempotency, FOUNDATION). */
const CODE_TO_I18N_KEY: Readonly<Record<string, string>> = {
  [IDEMPOTENCY_ERROR_CODES.IN_PROGRESS]: "errors.idempotencyInProgress",
  [IDEMPOTENCY_ERROR_CODES.KEY_REUSED]: "errors.idempotencyKeyReused",
};

/** Thứ tự tra: `kind` (chính xác nhất, RECRUIT luôn kèm) → `code` (idempotency) → `generic`. */
export function recruitErrorI18nKey(info: RecruitErrorInfo): string {
  if (info.kind && info.kind in KIND_TO_I18N_KEY) {
    return KIND_TO_I18N_KEY[info.kind as RecruitErrorKind];
  }
  if (info.code && info.code in CODE_TO_I18N_KEY) {
    return CODE_TO_I18N_KEY[info.code];
  }
  return "errors.generic";
}

/**
 * `true` khi lỗi là tranh chấp TRẠNG THÁI (record đã đổi ở nơi khác) — nên tải lại chi tiết thay vì chỉ
 * báo lỗi trên form. Nhóm này là các kind FSM/precondition; nhóm KHÔNG vào đây là lỗi INPUT (sửa được
 * ngay trong form: org-unit-invalid/position-invalid/recruiter-invalid/employee-*, invalid-start-date/
 * invalid-time-range) — tải lại chi tiết ở đó vô nghĩa và làm mất cái người dùng vừa gõ.
 */
const STATE_CONFLICT_KINDS: ReadonlySet<string> = new Set<RecruitErrorKind>([
  "invalid-stage-transition",
  "invalid-job-opening-transition",
  "invalid-offer-transition",
  "invalid-interview-transition",
  "hired-via-convert-only",
  "job-closed",
  "offer-open-exists",
  "already-converted",
  "not-draft",
  "not-scheduled",
  "interview-cancelled",
  "not-in-interview-stage",
  "not-in-offer-stage",
  "offer-not-accepted",
  "no-offer",
  "feedback-duplicate",
]);

export function isRecruitStateConflict(info: RecruitErrorInfo): boolean {
  return info.kind !== null && STATE_CONFLICT_KINDS.has(info.kind);
}

/**
 * Khoá `Idempotency-Key` phải sinh MỚI sau `KEY_REUSED` (khoá cũ đã ghim payload khác trong 15′);
 * `IN_PROGRESS` PHẢI GIỮ NGUYÊN khoá (đổi khoá lúc đó tạo bản ghi THỨ HAI).
 */
export function shouldRotateIdempotencyKey(info: RecruitErrorInfo): boolean {
  return info.code === IDEMPOTENCY_ERROR_CODES.KEY_REUSED;
}
