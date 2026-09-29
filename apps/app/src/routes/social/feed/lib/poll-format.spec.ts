/**
 * S16-SOCIAL-FE-2 — hàm thuần của khối bình chọn (plan D5, ca P4/P5).
 */
import { describe, expect, it } from "vitest";
import {
  canClosePoll,
  canWithdrawVote,
  isPollAcceptingVotes,
  isSameSelection,
  pollOptionPercent,
  toggleSelection,
} from "./poll-format";

describe("pollOptionPercent", () => {
  it("chưa ai bỏ phiếu ⇒ 0, KHÔNG NaN", () => {
    expect(pollOptionPercent(0, 0)).toBe(0);
  });

  it("làm tròn số nguyên theo số NGƯỜI bỏ phiếu", () => {
    expect(pollOptionPercent(1, 3)).toBe(33);
    expect(pollOptionPercent(2, 3)).toBe(67);
    expect(pollOptionPercent(3, 3)).toBe(100);
  });

  it("nhiều-lựa-chọn: mỗi ô tính trên số người ⇒ tổng có thể vượt 100%", () => {
    // 2 người, cả hai chọn cả 2 ô.
    expect(pollOptionPercent(2, 2) + pollOptionPercent(2, 2)).toBe(200);
  });

  it("dữ liệu lệch (voteCount > totalVoters · âm · không hữu hạn) ⇒ kẹp về [0,100]", () => {
    expect(pollOptionPercent(5, 2)).toBe(100);
    expect(pollOptionPercent(-1, 2)).toBe(0);
    expect(pollOptionPercent(Number.NaN, 2)).toBe(0);
    expect(pollOptionPercent(1, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("canClosePoll — mirror `assertCanMutateContent` của route 044", () => {
  it("DENY: người khác, KHÔNG `manage:feed-post` ⇒ không đóng được", () => {
    expect(canClosePoll({ status: "open", isMine: false, canManagePost: false })).toBe(false);
  });

  it("ALLOW: chủ bài", () => {
    expect(canClosePoll({ status: "open", isMine: true, canManagePost: false })).toBe(true);
  });

  it("ALLOW: `manage:feed-post` dù không phải chủ bài", () => {
    expect(canClosePoll({ status: "open", isMine: false, canManagePost: true })).toBe(true);
  });

  it("đã `closed` ⇒ không ai đóng lại (kể cả chủ bài + quản trị)", () => {
    expect(canClosePoll({ status: "closed", isMine: true, canManagePost: true })).toBe(false);
  });
});

const NOW = Date.parse("2026-09-29T08:00:00.000Z");
const FUTURE = "2026-09-30T08:00:00.000Z";
const PAST = "2026-09-28T08:00:00.000Z";

describe("isPollAcceptingVotes — P4c (plan §8 H4)", () => {
  it("mở + không hạn ⇒ nhận phiếu", () => {
    expect(isPollAcceptingVotes({ status: "open", closesAt: null }, NOW)).toBe(true);
  });

  it("mở + hạn ở tương lai ⇒ nhận phiếu", () => {
    expect(isPollAcceptingVotes({ status: "open", closesAt: FUTURE }, NOW)).toBe(true);
  });

  it("🔴 `status:'open'` nhưng QUÁ HẠN (job chưa chạy) ⇒ KHÔNG nhận phiếu", () => {
    expect(isPollAcceptingVotes({ status: "open", closesAt: PAST }, NOW)).toBe(false);
  });

  it("đúng mốc hạn ⇒ không nhận (server so `closes_at <= now()`)", () => {
    expect(isPollAcceptingVotes({ status: "open", closesAt: new Date(NOW).toISOString() }, NOW)).toBe(
      false,
    );
  });

  it("đã đóng ⇒ không, dù hạn ở tương lai", () => {
    expect(isPollAcceptingVotes({ status: "closed", closesAt: FUTURE }, NOW)).toBe(false);
  });
});

describe("canWithdrawVote", () => {
  it("có phiếu + còn nhận phiếu ⇒ rút được", () => {
    expect(canWithdrawVote({ status: "open", closesAt: null, myVote: ["o1"] }, NOW)).toBe(true);
  });

  it("chưa có phiếu ⇒ không", () => {
    expect(canWithdrawVote({ status: "open", closesAt: null, myVote: [] }, NOW)).toBe(false);
  });

  it("đã đóng ⇒ không (server sẽ 409 ERR-016)", () => {
    expect(canWithdrawVote({ status: "closed", closesAt: null, myVote: ["o1"] }, NOW)).toBe(false);
  });

  it("quá hạn mà chưa đóng ⇒ không", () => {
    expect(canWithdrawVote({ status: "open", closesAt: PAST, myVote: ["o1"] }, NOW)).toBe(false);
  });
});

describe("isSameSelection", () => {
  it("không phụ thuộc thứ tự", () => {
    expect(isSameSelection(["a", "b"], ["b", "a"])).toBe(true);
  });

  it("khác số phần tử hoặc khác phần tử ⇒ false", () => {
    expect(isSameSelection(["a"], ["a", "b"])).toBe(false);
    expect(isSameSelection(["a", "c"], ["a", "b"])).toBe(false);
  });
});

describe("toggleSelection", () => {
  it("một-lựa-chọn: chọn ô mới THAY ô cũ", () => {
    expect(toggleSelection(["a"], "b", false)).toEqual(["b"]);
  });

  it("nhiều-lựa-chọn: bật rồi tắt", () => {
    expect(toggleSelection(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a", true)).toEqual(["b"]);
  });

  it("không sửa mảng đầu vào", () => {
    const input = ["a"];
    toggleSelection(input, "b", true);
    expect(input).toEqual(["a"]);
  });
});
