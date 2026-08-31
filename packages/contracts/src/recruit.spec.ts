import { describe, expect, it } from "vitest";
import {
  RECRUIT_OFFER_OPEN_STATUSES,
  RECRUIT_OFFER_TERMINAL_STATUSES,
  RECRUIT_RATING_MAX,
  RECRUIT_RATING_MIN,
  recruitCandidateStageSchema,
  recruitFeedbackRatingSchema,
  recruitFeedbackRecommendationSchema,
  recruitInterviewStatusSchema,
  recruitJobOpeningStatusSchema,
  recruitMoveStageTargetSchema,
  recruitNormalizeEmail,
  recruitNormalizePhone,
  recruitOfferStatusSchema,
  recruitStageEventActionSchema,
} from "./recruit";

/**
 * PIN HAI CHIỀU enum ↔ CHECK migration 0559 (DB-14 §7). Mảng bên dưới là LITERAL chép từ SQL — cố ý KHÔNG
 * import từ schema drizzle hay từ chính `recruit.ts` (assert hằng số bằng chính nó là tautology). Đổi CHECK
 * ở DB ⇒ phải đổi cả đây lẫn enum, CÙNG commit.
 */
describe("contracts/recruit — enum mirror CHECK 0559 đúng bằng", () => {
  it("recruitCandidateStageSchema == chk_candidates_stage (6 giá trị, đúng thứ tự pipeline)", () => {
    expect(recruitCandidateStageSchema.options).toEqual([
      "New",
      "Screening",
      "Interview",
      "Offer",
      "Hired",
      "Rejected",
    ]);
    // không LỎNG hơn CHECK
    expect(recruitCandidateStageSchema.safeParse("Onboarding").success).toBe(false);
    expect(recruitCandidateStageSchema.safeParse("new").success).toBe(false);
  });

  it("recruitMoveStageTargetSchema GIỮ ĐỦ 6 giá trị — `Hired` KHÔNG bị cắt (RECRUIT-ERR-014 phải SỐNG)", () => {
    // Cắt 'Hired' ở Zod ⇒ request không bao giờ tới service ⇒ mã 014 thành mã CHẾT
    // (equal-caps-at-zod-and-service-make-dead-error-code). Đây là ca canh CHÍNH của luật đó.
    expect(recruitMoveStageTargetSchema.options).toHaveLength(6);
    expect(recruitMoveStageTargetSchema.safeParse("Hired").success).toBe(true);
    expect(recruitMoveStageTargetSchema.options).toEqual(recruitCandidateStageSchema.options);
  });

  it("recruitJobOpeningStatusSchema == chk_job_openings_status (4)", () => {
    expect(recruitJobOpeningStatusSchema.options).toEqual(["Draft", "Open", "Paused", "Closed"]);
    expect(recruitJobOpeningStatusSchema.safeParse("Archived").success).toBe(false);
  });

  it("recruitInterviewStatusSchema == chk_interviews_status (3) — huỷ là TRẠNG THÁI", () => {
    expect(recruitInterviewStatusSchema.options).toEqual(["Scheduled", "Completed", "Cancelled"]);
    expect(recruitInterviewStatusSchema.safeParse("Deleted").success).toBe(false);
  });

  it("recruitOfferStatusSchema == chk_offers_status (5); open ∪ terminal = ĐÚNG tập, giao = rỗng", () => {
    expect(recruitOfferStatusSchema.options).toEqual([
      "Draft",
      "Sent",
      "Accepted",
      "Declined",
      "Withdrawn",
    ]);
    // open = predicate của uq_offers_candidate_open; terminal = vế phải chk_offers_responded_pair.
    expect([...RECRUIT_OFFER_OPEN_STATUSES]).toEqual(["Draft", "Sent"]);
    expect([...RECRUIT_OFFER_TERMINAL_STATUSES]).toEqual(["Accepted", "Declined", "Withdrawn"]);
    expect([...RECRUIT_OFFER_OPEN_STATUSES, ...RECRUIT_OFFER_TERMINAL_STATUSES].sort()).toEqual(
      [...recruitOfferStatusSchema.options].sort(),
    );
    expect(
      RECRUIT_OFFER_OPEN_STATUSES.filter((s) => RECRUIT_OFFER_TERMINAL_STATUSES.includes(s)),
    ).toEqual([]);
  });

  it("recruitStageEventActionSchema == chk_cse_action (2)", () => {
    expect(recruitStageEventActionSchema.options).toEqual(["move", "convert"]);
  });

  it("recruitFeedbackRecommendationSchema == chk_feedback_reco (3 — 'No Hire' CÓ dấu cách)", () => {
    expect(recruitFeedbackRecommendationSchema.options).toEqual(["Hire", "No Hire", "Consider"]);
    expect(recruitFeedbackRecommendationSchema.safeParse("NoHire").success).toBe(false);
  });

  it("recruitFeedbackRatingSchema == chk_feedback_rating (BETWEEN 1 AND 5, biên hợp lệ)", () => {
    expect([RECRUIT_RATING_MIN, RECRUIT_RATING_MAX]).toEqual([1, 5]);
    expect(recruitFeedbackRatingSchema.safeParse(1).success).toBe(true);
    expect(recruitFeedbackRatingSchema.safeParse(5).success).toBe(true);
    expect(recruitFeedbackRatingSchema.safeParse(0).success).toBe(false);
    expect(recruitFeedbackRatingSchema.safeParse(6).success).toBe(false);
    expect(recruitFeedbackRatingSchema.safeParse(3.5).success).toBe(false);
  });
});

/**
 * Chuẩn hoá check-duplicate phải khớp TỪNG KÝ TỰ với index biểu-thức 0559 (`lower(email)` /
 * `regexp_replace(phone, '[^0-9+]', '', 'g')`) — khác một ký tự là planner bỏ index.
 */
describe("contracts/recruit — chuẩn hoá check-duplicate khớp index biểu-thức 0559", () => {
  it("recruitNormalizeEmail = lower(trim(email))", () => {
    expect(recruitNormalizeEmail("  Nguyen.Van.A@Example.COM ")).toBe("nguyen.van.a@example.com");
  });

  it("recruitNormalizePhone giữ CHỈ chữ số và dấu '+' (đúng lớp ký tự [^0-9+])", () => {
    expect(recruitNormalizePhone("+84 (90) 123-4567")).toBe("+84901234567");
    expect(recruitNormalizePhone("0912.345.678")).toBe("0912345678");
    // '+' KHÔNG bị bỏ dù nằm giữa chuỗi — mirror đúng regex của DB, không "thông minh hơn".
    expect(recruitNormalizePhone("09+12")).toBe("09+12");
  });
});
