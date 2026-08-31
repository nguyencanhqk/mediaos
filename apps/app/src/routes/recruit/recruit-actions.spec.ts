/**
 * S12-RECRUIT-FE-1 — neo 4 FSM ∩ quyền của RECRUIT (SPEC-12 §13). Mỗi hành động có CẢ ca ALLOW lẫn
 * ca DENY (memory `deny-cases-vacuous-without-allow-case`) — nếu không thì "mọi đích đều cấm" cũng
 * làm test xanh.
 */
import { describe, it, expect } from "vitest";
import {
  availableStageMoveTargets,
  isStageMoveAllowed,
  availableJobOpeningStatusTargets,
  isJobOpeningStatusAllowed,
  availableOfferStatusTargets,
  isOfferStatusAllowed,
  availableInterviewStatusTargets,
  isInterviewStatusAllowed,
  canConvert,
} from "./recruit-actions";

describe("recruit-actions — move-stage candidate (§13.1)", () => {
  it.each([
    ["New", "Screening", true],
    ["New", "Rejected", true],
    ["New", "Interview", false],
    ["Screening", "Interview", true],
    ["Screening", "Offer", false],
    ["Interview", "Screening", true],
    ["Interview", "Offer", true],
    ["Interview", "Hired", false],
    ["Offer", "Interview", true],
    ["Offer", "Rejected", true],
    ["Rejected", "Screening", true],
    ["Rejected", "New", false],
    ["Hired", "Screening", false],
  ] as const)("%s → %s = %s", (from, to, expected) => {
    expect(isStageMoveAllowed(from, to)).toBe(expected);
  });

  it("Offer → Hired KHÔNG BAO GIỜ cho phép qua move (chỉ convert, RECRUIT-ERR-014)", () => {
    expect(isStageMoveAllowed("Offer", "Hired")).toBe(false);
    expect(availableStageMoveTargets("Offer")).not.toContain("Hired");
  });

  it("Hired là terminal — không còn đích nào", () => {
    expect(availableStageMoveTargets("Hired")).toEqual([]);
  });
});

describe("recruit-actions — job opening status (§13.2)", () => {
  it.each([
    ["Draft", "Open", true],
    ["Draft", "Paused", false],
    ["Open", "Paused", true],
    ["Open", "Closed", true],
    ["Open", "Draft", false],
    ["Paused", "Open", true],
    ["Paused", "Closed", true],
    ["Closed", "Open", false],
  ] as const)("%s → %s = %s", (from, to, expected) => {
    expect(isJobOpeningStatusAllowed(from, to)).toBe(expected);
  });

  it("Closed là terminal", () => {
    expect(availableJobOpeningStatusTargets("Closed")).toEqual([]);
  });
});

describe("recruit-actions — offer status (§13.3)", () => {
  it.each([
    ["Draft", "Sent", true],
    ["Draft", "Withdrawn", true],
    ["Draft", "Accepted", false],
    ["Sent", "Accepted", true],
    ["Sent", "Declined", true],
    ["Sent", "Withdrawn", true],
    ["Sent", "Draft", false],
    ["Accepted", "Declined", false],
  ] as const)("%s → %s = %s", (from, to, expected) => {
    expect(isOfferStatusAllowed(from, to)).toBe(expected);
  });

  it.each(["Accepted", "Declined", "Withdrawn"] as const)(
    "%s là terminal — không còn đích",
    (s) => {
      expect(availableOfferStatusTargets(s)).toEqual([]);
    },
  );
});

describe("recruit-actions — interview status (§13.4)", () => {
  it.each([
    ["Scheduled", "Completed", true],
    ["Scheduled", "Cancelled", true],
    ["Completed", "Cancelled", false],
    ["Cancelled", "Scheduled", false],
  ] as const)("%s → %s = %s", (from, to, expected) => {
    expect(isInterviewStatusAllowed(from, to)).toBe(expected);
  });

  it.each(["Completed", "Cancelled"] as const)("%s là terminal", (s) => {
    expect(availableInterviewStatusTargets(s)).toEqual([]);
  });
});

describe("recruit-actions — canConvert (§13.5)", () => {
  const acceptedOffer = [{ status: "Accepted" as const }];
  const sentOnly = [{ status: "Sent" as const }];

  it("ALLOW: stage Offer + chưa gắn NV + có offer Accepted + đủ quyền", () => {
    expect(canConvert({ stage: "Offer", employeeId: null }, acceptedOffer, true)).toBe(true);
  });

  it("DENY: thiếu quyền convert:candidate dù mọi điều kiện khác đúng", () => {
    expect(canConvert({ stage: "Offer", employeeId: null }, acceptedOffer, false)).toBe(false);
  });

  it("DENY: stage khác Offer", () => {
    expect(canConvert({ stage: "Interview", employeeId: null }, acceptedOffer, true)).toBe(false);
  });

  it("DENY: đã gắn nhân viên (đã convert trước đó)", () => {
    expect(canConvert({ stage: "Offer", employeeId: "e1" }, acceptedOffer, true)).toBe(false);
  });

  it("DENY: không có offer nào Accepted (chỉ Sent)", () => {
    expect(canConvert({ stage: "Offer", employeeId: null }, sentOnly, true)).toBe(false);
  });

  it("DENY: không có offer nào", () => {
    expect(canConvert({ stage: "Offer", employeeId: null }, [], true)).toBe(false);
  });
});
