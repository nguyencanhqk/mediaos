import { z } from "zod";

/**
 * S12-RECRUIT-DB-1 — enum chuẩn module RECRUIT (SPEC-12 · DB-14 §7). NGUỒN SỰ THẬT cho DTO của
 * S12-RECRUIT-BE-1 (request/response viết ở WO đó theo API-17 — file này CHỈ có enum + hằng của DB).
 *
 * MỖI enum dưới đây MIRROR ĐÚNG BẰNG một CHECK của migration 0559 — HAI CHIỀU: không chặt hơn (giá trị DB
 * hợp lệ mà Zod từ chối ⇒ 400 oan), không lỏng hơn (Zod cho qua mà DB từ chối ⇒ 500 check-violation vô
 * danh — bài học `contract-must-mirror-db-check-both-directions`). Pin hai chiều ở `recruit.spec.ts`
 * (mảng literal chép từ migration, cố ý KHÔNG import từ schema drizzle hay từ chính file này).
 *
 * Tên export dùng tiền tố `recruit*` / `Recruit*` / `RECRUIT_*` để không đụng barrel park media
 * (`contracts-barrel-collides-with-parked-media` — TS2308).
 */

/** `chk_candidates_stage` + `chk_cse_from` + `chk_cse_to` — pipeline CỐ ĐỊNH 6 stage (SPEC-01 §17.11). */
export const recruitCandidateStageSchema = z.enum([
  "New",
  "Screening",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
]);
export type RecruitCandidateStageDto = z.infer<typeof recruitCandidateStageSchema>;

/**
 * Đích hợp lệ của `move-stage` (RECRUIT-API-013). **GIỮ ĐỦ 6 GIÁ TRỊ — CỐ Ý KHÔNG cắt `Hired`.**
 *
 * Cắt `Hired` ở Zod «cho chặt» biến **RECRUIT-ERR-014** (409 `hired-via-convert-only`) thành mã CHẾT:
 * request không bao giờ tới service, người dùng nhận 400 vô danh thay vì câu "Hired chỉ đạt được qua
 * convert" (`equal-caps-at-zod-and-service-make-dead-error-code` · DB-14 §7 dòng cuối · plan-review B2).
 * Trần Zod = trần DB; trần NGHIỆP VỤ ép ở service và có mã lỗi riêng.
 */
export const recruitMoveStageTargetSchema = recruitCandidateStageSchema;
export type RecruitMoveStageTargetDto = z.infer<typeof recruitMoveStageTargetSchema>;

/** `chk_job_openings_status` — SPEC-01 §17.12. FSM chuyển tiếp ép ở service (RECRUIT-ERR-002). */
export const recruitJobOpeningStatusSchema = z.enum(["Draft", "Open", "Paused", "Closed"]);
export type RecruitJobOpeningStatusDto = z.infer<typeof recruitJobOpeningStatusSchema>;

/** `chk_interviews_status` — SPEC-01 §17.13. Huỷ là TRẠNG THÁI, không phải xoá (RECRUIT-ERR-004). */
export const recruitInterviewStatusSchema = z.enum(["Scheduled", "Completed", "Cancelled"]);
export type RecruitInterviewStatusDto = z.infer<typeof recruitInterviewStatusSchema>;

/** `chk_offers_status` — SPEC-01 §17.14. FSM ép ở service (RECRUIT-ERR-003). */
export const recruitOfferStatusSchema = z.enum([
  "Draft",
  "Sent",
  "Accepted",
  "Declined",
  "Withdrawn",
]);
export type RecruitOfferStatusDto = z.infer<typeof recruitOfferStatusSchema>;

/**
 * Trạng thái offer ĐANG SỐNG — tập con khớp predicate của `uq_offers_candidate_open`
 * (`status IN ('Draft','Sent')`). Dùng để suy "đã có offer sống chưa" ở BE/FE mà không viết lại chuỗi.
 */
export const RECRUIT_OFFER_OPEN_STATUSES: readonly RecruitOfferStatusDto[] = ["Draft", "Sent"];

/**
 * Trạng thái offer TERMINAL — vế còn lại của `chk_offers_responded_pair`.
 * ⚠️ CHECK buộc chuyển sang một trong ba giá trị này PHẢI ghi `responded_at` **cùng một câu UPDATE**.
 */
export const RECRUIT_OFFER_TERMINAL_STATUSES: readonly RecruitOfferStatusDto[] = [
  "Accepted",
  "Declined",
  "Withdrawn",
];

/** `chk_cse_action` — hàng `convert` LUÔN là `Offer → Hired`. */
export const recruitStageEventActionSchema = z.enum(["move", "convert"]);
export type RecruitStageEventActionDto = z.infer<typeof recruitStageEventActionSchema>;

/** `chk_feedback_reco`. */
export const recruitFeedbackRecommendationSchema = z.enum(["Hire", "No Hire", "Consider"]);
export type RecruitFeedbackRecommendationDto = z.infer<typeof recruitFeedbackRecommendationSchema>;

/** `chk_feedback_rating` — `rating BETWEEN 1 AND 5` (cột `smallint`). */
export const RECRUIT_RATING_MIN = 1;
export const RECRUIT_RATING_MAX = 5;
export const recruitFeedbackRatingSchema = z
  .number()
  .int()
  .min(RECRUIT_RATING_MIN)
  .max(RECRUIT_RATING_MAX);

/** `chk_job_openings_headcount` — `headcount > 0` (cột `integer`; trần để không rơi 22003). */
export const RECRUIT_HEADCOUNT_MAX = 10_000;

/**
 * Biểu thức chuẩn hoá dùng cho check-duplicate (RECRUIT-API-008) — PHẢI khớp TỪNG KÝ TỰ với index biểu-thức
 * `idx_candidates_company_email_expr` / `idx_candidates_company_phone_norm` của migration 0559:
 *   `lower(email)` và `regexp_replace(phone, '[^0-9+]', '', 'g')`.
 * Khác một ký tự là planner bỏ index (`pg-planner-index-assert-trap`). Đặt ở contracts để BE/FE dùng CHUNG
 * một công thức thay vì mỗi nơi tự viết lại.
 */
export const recruitNormalizeEmail = (email: string): string => email.trim().toLowerCase();
export const recruitNormalizePhone = (phone: string): string => phone.replace(/[^0-9+]/g, "");
