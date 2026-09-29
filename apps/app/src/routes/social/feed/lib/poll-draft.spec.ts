/**
 * S16-SOCIAL-FE-2 — ca P3 (plan §8 M7): luật kiểm nháp bình chọn + payload parse được bằng CHÍNH
 * `createFeedPostSchema` (không so object tay).
 */
import { describe, expect, it } from "vitest";
import { createFeedPostSchema } from "@mediaos/contracts";
import { EMPTY_POLL_DRAFT, validatePollDraft, type PollDraft } from "./poll-draft";

const NOW = Date.parse("2026-09-29T08:00:00.000Z");
const draft = (over: Partial<PollDraft> = {}): PollDraft => ({
  ...EMPTY_POLL_DRAFT,
  question: "Ăn trưa ở đâu?",
  options: ["Cơm", "Phở"],
  ...over,
});
const errorOf = (d: PollDraft) => {
  const r = validatePollDraft(d, NOW);
  return r.ok ? null : r.error;
};

describe("P3 — validatePollDraft", () => {
  it("nháp rỗng ⇒ thiếu câu hỏi", () => {
    expect(errorOf(EMPTY_POLL_DRAFT)).toBe("questionRequired");
  });

  it("câu hỏi chỉ khoảng trắng ⇒ thiếu câu hỏi (đo SAU trim)", () => {
    expect(errorOf(draft({ question: "   " }))).toBe("questionRequired");
  });

  it("câu hỏi > 500 ký tự ⇒ quá dài", () => {
    expect(errorOf(draft({ question: "x".repeat(501) }))).toBe("questionTooLong");
  });

  it("1 lựa chọn · 11 lựa chọn ⇒ ngoài khoảng 2–10", () => {
    expect(errorOf(draft({ options: ["A"] }))).toBe("optionsRange");
    expect(errorOf(draft({ options: Array.from({ length: 11 }, (_, i) => `O${i}`) }))).toBe(
      "optionsRange",
    );
  });

  it("một ô rỗng (hoặc chỉ khoảng trắng) ⇒ chặn, không gửi hàng rỗng", () => {
    expect(errorOf(draft({ options: ["Cơm", "  "] }))).toBe("optionEmpty");
  });

  it("ô > 255 ký tự ⇒ quá dài", () => {
    expect(errorOf(draft({ options: ["Cơm", "x".repeat(256)] }))).toBe("optionTooLong");
  });

  it("nhãn trùng (khác hoa thường / khoảng trắng) ⇒ chặn", () => {
    expect(errorOf(draft({ options: ["Cơm", " cơm "] }))).toBe("optionDuplicate");
  });

  it("hạn ở quá khứ / đúng bây giờ ⇒ chặn", () => {
    expect(errorOf(draft({ closesAtLocal: "2026-09-28T08:00" }))).toBe("closesAtPast");
    expect(errorOf(draft({ closesAtLocal: new Date(NOW).toISOString() }))).toBe("closesAtPast");
  });

  it("hợp lệ ⇒ payload đã trim, `closesAt` là ISO CÓ offset, VẮNG khi không đặt hạn", () => {
    const r = validatePollDraft(draft({ question: " Q ", options: [" A ", "B"] }), NOW);
    expect(r).toEqual({
      ok: true,
      poll: { question: "Q", options: ["A", "B"], multipleChoice: false, isAnonymous: false },
    });

    const withDeadline = validatePollDraft(draft({ closesAtLocal: "2026-10-01T09:30" }), NOW);
    expect(withDeadline.ok && withDeadline.poll.closesAt).toMatch(/Z$/);
  });

  it("payload ghép như composer gửi (không `body` khi mô tả trống) PARSE được bằng createFeedPostSchema", () => {
    const r = validatePollDraft(
      draft({ multipleChoice: true, isAnonymous: true, closesAtLocal: "2026-10-01T09:30" }),
      NOW,
    );
    if (!r.ok) throw new Error(r.error);
    const parsed = createFeedPostSchema.safeParse({
      type: "poll",
      audience: "company",
      requiresAck: false,
      poll: r.poll,
    });
    expect(parsed.success).toBe(true);
  });

  it('đối chứng: gửi `body: ""` thì createFeedPostSchema TỪ CHỐI — lý do composer phải BỎ khoá', () => {
    const r = validatePollDraft(draft(), NOW);
    if (!r.ok) throw new Error(r.error);
    expect(
      createFeedPostSchema.safeParse({ type: "poll", audience: "company", body: "", poll: r.poll })
        .success,
    ).toBe(false);
  });
});
