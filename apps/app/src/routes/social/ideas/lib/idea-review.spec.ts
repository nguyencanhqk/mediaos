/**
 * S16-SOCIAL-FE-2 — ca I1/I3 (plan D8): FSM xét duyệt sáng kiến, VÉT CẠN 4 trạng thái.
 */
import { describe, expect, it } from "vitest";
import { feedIdeaStatusSchema } from "@mediaos/contracts";
import { ideaReviewTargets, isReviewNoteRequired, isReviewSubmittable } from "./idea-review";

describe("I1 — ideaReviewTargets (SPEC-16 §13.3)", () => {
  it.each([
    ["submitted", ["under_review"]],
    ["under_review", ["accepted", "rejected"]],
    ["accepted", []],
    ["rejected", []],
  ] as const)("%s ⇒ %j", (from, targets) => {
    expect(ideaReviewTargets(from)).toEqual(targets);
  });

  it("phủ ĐỦ mọi giá trị của enum contracts (không trạng thái nào rơi ra ngoài bảng)", () => {
    for (const status of feedIdeaStatusSchema.options) {
      expect(Array.isArray(ideaReviewTargets(status))).toBe(true);
    }
  });

  it("`submitted` KHÔNG bao giờ là đích (không cạnh nào dẫn về nó)", () => {
    for (const status of feedIdeaStatusSchema.options) {
      expect(ideaReviewTargets(status)).not.toContain("submitted");
    }
  });
});

describe("I3 — lý do bắt buộc khi từ chối", () => {
  it("chỉ `rejected` đòi ghi chú", () => {
    expect(isReviewNoteRequired("rejected")).toBe(true);
    expect(isReviewNoteRequired("accepted")).toBe(false);
    expect(isReviewNoteRequired("under_review")).toBe(false);
  });

  it("`rejected` + ghi chú chỉ toàn khoảng trắng ⇒ KHÔNG gửi được (server `trim()` trước khi kiểm)", () => {
    expect(isReviewSubmittable("rejected", "   ")).toBe(false);
    expect(isReviewSubmittable("rejected", "trùng ý tưởng cũ")).toBe(true);
  });

  it("chưa chọn đích ⇒ không gửi được; đích khác `rejected` ⇒ gửi được không cần ghi chú", () => {
    expect(isReviewSubmittable(null, "x")).toBe(false);
    expect(isReviewSubmittable("accepted", "")).toBe(true);
  });
});
