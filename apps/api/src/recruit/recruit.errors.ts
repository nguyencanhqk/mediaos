import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { ErrorDetail } from "@mediaos/contracts";
import { pgErrorCode, pgErrorField } from "../common/db-error";

/**
 * S12-RECRUIT-BE-1 — mã lỗi RECRUIT (SPEC-12 §12 · API-17 §7 · quy ước SPEC-01 §9). MỘT CHỖ duy
 * nhất định nghĩa mã + thông điệp — int-spec assert theo MÃ (`error.code`), không theo câu chữ.
 *
 * Hình dạng ném (mirror ASSET): `new XxxException({code, message, details})` — `details` là MẢNG
 * `ErrorDetail{field,message,rule}`; `kind` = phần tử `{field:'kind', message:'<kind>', rule:'recruit'}`
 * (memory `error-details-must-be-errordetail-array`).
 *
 * Sentinel 404 (mã 010) dùng MỘT thông điệp duy nhất cho not-found/cross-tenant/ngoài-scope-Own —
 * không lộ oracle tồn tại (plan §4.7).
 */
export const RECRUIT_ERR_CODE = {
  STAGE_TRANSITION: "RECRUIT-ERR-001",
  JOB_TRANSITION: "RECRUIT-ERR-002",
  OFFER_TRANSITION: "RECRUIT-ERR-003",
  INTERVIEW_TRANSITION: "RECRUIT-ERR-004",
  JOB_CLOSED: "RECRUIT-ERR-005",
  OFFER_OPEN_EXISTS: "RECRUIT-ERR-006",
  STAGE_PRECONDITION: "RECRUIT-ERR-007",
  CONVERT_BLOCKED: "RECRUIT-ERR-008",
  PEOPLE_REF_INVALID: "RECRUIT-ERR-009",
  NOT_FOUND: "RECRUIT-ERR-010",
  NOT_PARTICIPANT: "RECRUIT-ERR-011",
  FEEDBACK_DUPLICATE: "RECRUIT-ERR-012",
  INVALID_VALUE: "RECRUIT-ERR-013",
  MOVE_TO_HIRED: "RECRUIT-ERR-014",
  EXPORT_LIMIT: "RECRUIT-ERR-015",
} as const;

export type RecruitErrKey = keyof typeof RECRUIT_ERR_CODE;
export type RecruitErrCode = (typeof RECRUIT_ERR_CODE)[RecruitErrKey];

export const RECRUIT_ERR = {
  STAGE_TRANSITION: (from: string, to: string) =>
    `RECRUIT-ERR-001: không thể chuyển ứng viên từ "${from}" sang "${to}".`,
  JOB_TRANSITION: (from: string, to: string) =>
    `RECRUIT-ERR-002: không thể chuyển vị trí tuyển từ "${from}" sang "${to}".`,
  OFFER_TRANSITION: (from: string, to: string) =>
    `RECRUIT-ERR-003: không thể chuyển offer từ "${from}" sang "${to}".`,
  OFFER_NOT_DRAFT: 'RECRUIT-ERR-003: chỉ sửa được offer đang "Draft".',
  INTERVIEW_TRANSITION: (from: string, to: string) =>
    `RECRUIT-ERR-004: không thể chuyển lượt phỏng vấn từ "${from}" sang "${to}".`,
  INTERVIEW_NOT_SCHEDULED: 'RECRUIT-ERR-004: chỉ sửa được lượt đang "Scheduled".',
  JOB_CLOSED: "RECRUIT-ERR-005: vị trí tuyển đã đóng — không thể thêm/chuyển ứng viên vào.",
  OFFER_OPEN_EXISTS: "RECRUIT-ERR-006: ứng viên đã có một offer đang sống (Draft/Sent).",
  NOT_IN_INTERVIEW_STAGE:
    'RECRUIT-ERR-007: ứng viên chưa ở giai đoạn "Interview" — không thể xếp lịch phỏng vấn.',
  NOT_IN_OFFER_STAGE: 'RECRUIT-ERR-007: ứng viên chưa ở giai đoạn "Offer".',
  CONVERT_NO_OFFER:
    "RECRUIT-ERR-008: ứng viên chưa có offer nào — không thể chuyển thành nhân viên.",
  CONVERT_OFFER_NOT_ACCEPTED:
    "RECRUIT-ERR-008: chưa có offer nào được chấp nhận — không thể chuyển thành nhân viên.",
  CONVERT_ALREADY: "RECRUIT-ERR-008: ứng viên đã được chuyển thành nhân viên trước đó.",
  EMPLOYEE_CODE_CONFLICT:
    "RECRUIT-ERR-008: mã nhân viên vừa cấp trùng một mã đã tồn tại — thử lại.",
  PEOPLE_REF_INVALID: (what: string) =>
    `RECRUIT-ERR-009: tham chiếu nhân sự/tổ chức không hợp lệ — ${what}.`,
  NOT_FOUND: "RECRUIT-ERR-010: không tìm thấy dữ liệu tuyển dụng.",
  NOT_PARTICIPANT:
    "RECRUIT-ERR-011: bạn không nằm trong danh sách phỏng vấn của lượt này — không thể ghi đánh giá.",
  FEEDBACK_DUPLICATE: "RECRUIT-ERR-012: bạn đã ghi đánh giá cho lượt phỏng vấn này.",
  INVALID_TIME_RANGE: "RECRUIT-ERR-013: giờ kết thúc phải sau giờ bắt đầu.",
  INVALID_START_DATE: "RECRUIT-ERR-013: ngày vào làm không được ở quá khứ.",
  MOVE_TO_HIRED:
    'RECRUIT-ERR-014: không thể kéo tay sang "Hired" — dùng chức năng "Chuyển thành nhân viên".',
  EXPORT_LIMIT: (count: number, max: number) =>
    `RECRUIT-ERR-015: tập kết quả ${count} dòng vượt trần ${max} — thu hẹp bộ lọc trước khi export.`,
} as const;

/** `details` chuẩn `ErrorDetail[]` — `kind` + cặp phụ. */
export function recruitDetails(
  kind: string,
  extra: Record<string, string | number | boolean | null | undefined> = {},
): ErrorDetail[] {
  const out: ErrorDetail[] = [{ field: "kind", message: kind, rule: "recruit" }];
  for (const [field, value] of Object.entries(extra)) {
    if (value === null || value === undefined) continue;
    out.push({ field, message: String(value), rule: "recruit" });
  }
  return out;
}

type Body = { code: RecruitErrCode; message: string; details?: ErrorDetail[] };
const body = (key: RecruitErrKey, message: string, details?: ErrorDetail[]): Body =>
  details
    ? { code: RECRUIT_ERR_CODE[key], message, details }
    : { code: RECRUIT_ERR_CODE[key], message };

export const recruitConflict = (key: RecruitErrKey, message: string, details?: ErrorDetail[]) =>
  new ConflictException(body(key, message, details));
export const recruitUnprocessable = (
  key: RecruitErrKey,
  message: string,
  details?: ErrorDetail[],
) => new UnprocessableEntityException(body(key, message, details));
export const recruitForbidden = (key: RecruitErrKey, message: string, details?: ErrorDetail[]) =>
  new ForbiddenException(body(key, message, details));
/** Sentinel 404 — MỘT thông điệp cho mọi nhánh (không lộ oracle). */
export const recruitNotFound = () =>
  new NotFoundException(body("NOT_FOUND", RECRUIT_ERR.NOT_FOUND, recruitDetails("not-found")));
/** 404 mang mã 009 — tham chiếu người KHÔNG tồn tại trong company (SPEC-12 §12: 404, chống oracle). */
export const recruitPeopleRefNotFound = (message: string, details?: ErrorDetail[]) =>
  new NotFoundException(body("PEOPLE_REF_INVALID", message, details));

/**
 * Map lỗi PG (bóc `.cause` qua `pgErrorCode`/`pgErrorField`) → RECRUIT-ERR. Trả `null` khi không
 * thuộc phổ RECRUIT — caller `throw mapRecruitPgError(err) ?? err`.
 *
 * `uq_interview_participants` KHÔNG map riêng: participants dựng 1 lần lúc POST /interviews, list đã
 * de-dup ở Zod/service trước insert.
 */
export function mapRecruitPgError(err: unknown): Error | null {
  const code = pgErrorCode(err);
  if (code !== "23505" && code !== "23514") return null;
  const constraint = pgErrorField(err, "constraint");
  if (code === "23505") {
    switch (constraint) {
      case "uq_offers_candidate_open":
        return recruitConflict(
          "OFFER_OPEN_EXISTS",
          RECRUIT_ERR.OFFER_OPEN_EXISTS,
          recruitDetails("offer-open-exists"),
        );
      case "uq_candidates_company_employee":
        return recruitConflict(
          "CONVERT_BLOCKED",
          RECRUIT_ERR.CONVERT_ALREADY,
          recruitDetails("already-converted"),
        );
      case "uq_interview_feedbacks":
        return recruitConflict(
          "FEEDBACK_DUPLICATE",
          RECRUIT_ERR.FEEDBACK_DUPLICATE,
          recruitDetails("feedback-duplicate"),
        );
      // Va mã NV thủ công (HR cho phép nhập tay) với mã counter vừa cấp — plan-review vòng 2 #1:
      // KHÔNG để rơi AllExceptionsFilter/500.
      case "employee_profiles_company_code_active_uq":
        return recruitConflict(
          "CONVERT_BLOCKED",
          RECRUIT_ERR.EMPLOYEE_CODE_CONFLICT,
          recruitDetails("employee-code-conflict"),
        );
      default:
        return null;
    }
  }
  // 23514 — lưới THỨ HAI sau service check (RECRUIT-ERR-013).
  if (constraint === "chk_interviews_range") {
    return recruitUnprocessable(
      "INVALID_VALUE",
      RECRUIT_ERR.INVALID_TIME_RANGE,
      recruitDetails("invalid-time-range"),
    );
  }
  return null;
}
