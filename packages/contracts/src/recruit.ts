import { z } from "zod";

/**
 * S12-RECRUIT-DB-1 — enum/hằng chuẩn module RECRUIT (SPEC-12 · DB-14 §7). NGUỒN SỰ THẬT cho DTO của
 * S12-RECRUIT-BE-1 (API-17).
 *
 * 4 enum FSM MIRROR ĐÚNG BẰNG CHECK của migration 0559 — HAI CHIỀU: không chặt hơn (giá trị DB hợp lệ mà
 * Zod từ chối ⇒ 400 oan), không lỏng hơn (Zod cho qua mà DB từ chối ⇒ 500 check-violation vô danh —
 * `contract-must-mirror-db-check-both-directions`). Pin hai chiều ở `recruit.spec.ts` (mảng literal chép
 * từ migration, cố ý KHÔNG import từ schema drizzle).
 *
 * Chỉ ENUM/HẰNG ở WO DB (chưa có consumer DTO); request/response schema viết ở WO BE cùng API-17.
 * Tên export prefix `recruit*`/`candidate*`/`jobOpening*`/`interview*`/`offer*` — không đụng barrel park
 * (`contracts-barrel-collides-with-parked-media`).
 */

/** `chk_candidates_stage` + `chk_cse_from/to` — SPEC-01 §17.11. FSM §13.1 ép ở service. */
export const candidateStageSchema = z.enum([
  "New",
  "Screening",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
]);
export type CandidateStageDto = z.infer<typeof candidateStageSchema>;

/**
 * ⚠️ HỢP ĐỒNG cho BE-1 (plan-review DOC-1 B2): Zod của move-stage `toStage` dùng CHÍNH
 * `candidateStageSchema` — ĐỦ 6 giá trị, KHÔNG cắt `Hired` ở biên. Chặn `Hired` bằng tay là việc của
 * SERVICE với mã RECRUIT-ERR-014 (409) — cắt ở Zod là 014 thành mã CHẾT
 * (`equal-caps-at-zod-and-service-make-dead-error-code`).
 */
export const candidateMoveStageTargetSchema = candidateStageSchema;

/** `chk_job_openings_status` — SPEC-01 §17.12. `Closed` là terminal v1 (FSM §13.2 ở service). */
export const jobOpeningStatusSchema = z.enum(["Draft", "Open", "Paused", "Closed"]);
export type JobOpeningStatusDto = z.infer<typeof jobOpeningStatusSchema>;

/** `chk_interviews_status` — SPEC-01 §17.13. Hai đích terminal (FSM §13.4 ở service). */
export const interviewStatusSchema = z.enum(["Scheduled", "Completed", "Cancelled"]);
export type InterviewStatusDto = z.infer<typeof interviewStatusSchema>;

/** `chk_offers_status` — SPEC-01 §17.14. Accepted/Declined/Withdrawn terminal (FSM §13.3 ở service). */
export const offerStatusSchema = z.enum(["Draft", "Sent", "Accepted", "Declined", "Withdrawn"]);
export type OfferStatusDto = z.infer<typeof offerStatusSchema>;

/** `chk_cse_action` — hàng convert là `Offer → Hired` duy nhất (SPEC-12 §13.1). */
export const candidateStageActionSchema = z.enum(["move", "convert"]);
export type CandidateStageActionDto = z.infer<typeof candidateStageActionSchema>;

/** `chk_feedback_reco` — khuyến nghị per-interviewer (DB-14 §6.7). */
export const interviewRecommendationSchema = z.enum(["Hire", "No Hire", "Consider"]);
export type InterviewRecommendationDto = z.infer<typeof interviewRecommendationSchema>;

/** `chk_feedback_rating` — 1..5 (DB-14 §6.7). */
export const RECRUIT_FEEDBACK_RATING_MIN = 1;
export const RECRUIT_FEEDBACK_RATING_MAX = 5;
export const interviewFeedbackRatingSchema = z
  .number()
  .int()
  .min(RECRUIT_FEEDBACK_RATING_MIN)
  .max(RECRUIT_FEEDBACK_RATING_MAX);

/** SPEC-12 §13.1 — `reason` bắt buộc cho mọi lần move (kanban luôn mở hộp lý do). */
export const RECRUIT_MOVE_REASON_MIN = 3;

/** SPEC-12 §19 / RECRUIT-ERR-015 — trần export theo filter hiện hành (422 khi vượt). */
export const RECRUIT_EXPORT_MAX_ROWS = 10_000;
