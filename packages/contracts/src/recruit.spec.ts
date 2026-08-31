import { describe, expect, it } from "vitest";
import {
  candidateMoveStageTargetSchema,
  candidateStageActionSchema,
  candidateStageSchema,
  interviewRecommendationSchema,
  interviewStatusSchema,
  jobOpeningStatusSchema,
  offerStatusSchema,
} from "./recruit";

/**
 * PIN HAI CHIỀU 4 enum FSM RECRUIT ↔ CHECK của migration `0559` (S12-RECRUIT-DB-1). Mảng LITERAL chép từ
 * migration, cố ý KHÔNG import từ `schema/recruit.ts` (assert hằng bằng chính nó = tautology —
 * `contract-must-mirror-db-check-both-directions`). Đổi CHECK ⇒ đổi cả đây lẫn enum, cùng commit.
 */
describe("contracts/recruit — enum mirror CHECK migration 0559 (hai chiều, đúng bằng)", () => {
  it("candidateStageSchema == chk_candidates_stage (6 giá trị)", () => {
    expect([...candidateStageSchema.options].sort()).toEqual(
      ["New", "Screening", "Interview", "Offer", "Hired", "Rejected"].sort(),
    );
  });

  it("move-stage target giữ ĐỦ 6 giá trị — KHÔNG cắt Hired (mã RECRUIT-ERR-014 phải SỐNG ở service)", () => {
    expect([...candidateMoveStageTargetSchema.options].sort()).toEqual(
      [...candidateStageSchema.options].sort(),
    );
    expect(candidateMoveStageTargetSchema.safeParse("Hired").success).toBe(true);
  });

  it("jobOpeningStatusSchema == chk_job_openings_status (4 giá trị)", () => {
    expect([...jobOpeningStatusSchema.options].sort()).toEqual(
      ["Draft", "Open", "Paused", "Closed"].sort(),
    );
  });

  it("interviewStatusSchema == chk_interviews_status (3 giá trị)", () => {
    expect([...interviewStatusSchema.options].sort()).toEqual(
      ["Scheduled", "Completed", "Cancelled"].sort(),
    );
  });

  it("offerStatusSchema == chk_offers_status (5 giá trị)", () => {
    expect([...offerStatusSchema.options].sort()).toEqual(
      ["Draft", "Sent", "Accepted", "Declined", "Withdrawn"].sort(),
    );
  });

  it("candidateStageActionSchema == chk_cse_action · interviewRecommendationSchema == chk_feedback_reco", () => {
    expect([...candidateStageActionSchema.options].sort()).toEqual(["move", "convert"].sort());
    expect([...interviewRecommendationSchema.options].sort()).toEqual(
      ["Hire", "No Hire", "Consider"].sort(),
    );
  });
});
