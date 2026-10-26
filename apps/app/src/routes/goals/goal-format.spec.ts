/**
 * S5-GOAL-FE-1 — goal-format helpers. Trọng tâm LUẬT §13.2: "chưa đo" (NULL) ≠ "0%".
 */
import { describe, it, expect } from "vitest";
import {
  clampPercent,
  formatDateOnly,
  formatPeriod,
  formatProgress,
  goalCheckinLockReason,
  goalPeriodLabel,
  goalStatusBadgeVariant,
  isUnmeasured,
  shouldSuggestCompletion,
} from "./goal-format";

describe("formatProgress — chưa đo (NULL) KHÁC 0%", () => {
  it("NULL → '—' (KHÔNG '0%')", () => {
    expect(formatProgress(null)).toBe("—");
    expect(formatProgress(null)).not.toBe("0%");
  });

  it("0 (đã đo, thực 0%) → '0%' (KHÁC '—')", () => {
    expect(formatProgress(0)).toBe("0%");
    expect(formatProgress(0)).not.toBe("—");
  });

  it("làm tròn số lẻ", () => {
    expect(formatProgress(66.6)).toBe("67%");
    expect(formatProgress(33.2)).toBe("33%");
    expect(formatProgress(100)).toBe("100%");
  });
});

describe("isUnmeasured", () => {
  it("true khi NULL, false khi có số (kể cả 0)", () => {
    expect(isUnmeasured(null)).toBe(true);
    expect(isUnmeasured(0)).toBe(false);
    expect(isUnmeasured(50)).toBe(false);
  });
});

describe("clampPercent — chỉ dùng cho bề rộng thanh", () => {
  it("kẹp 0..100; NULL/không hữu hạn → 0", () => {
    expect(clampPercent(null)).toBe(0);
    expect(clampPercent(-10)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(42)).toBe(42);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});

describe("goalStatusBadgeVariant — hợp lệ với Badge @mediaos/ui", () => {
  it("map từng trạng thái", () => {
    expect(goalStatusBadgeVariant("Active")).toBe("success");
    expect(goalStatusBadgeVariant("Completed")).toBe("brand");
    expect(goalStatusBadgeVariant("Cancelled")).toBe("danger");
    expect(goalStatusBadgeVariant("Draft")).toBe("muted");
  });
});

describe("formatDateOnly / formatPeriod — thuần chuỗi, không lệch timezone", () => {
  it("YYYY-MM-DD → DD/MM/YYYY", () => {
    expect(formatDateOnly("2026-01-31")).toBe("31/01/2026");
  });
  it("null → '—'; chuỗi lạ giữ nguyên", () => {
    expect(formatDateOnly(null)).toBe("—");
    expect(formatDateOnly("khong-phai-ngay")).toBe("khong-phai-ngay");
  });
  it("kỳ 'DD/MM/YYYY – DD/MM/YYYY'", () => {
    expect(formatPeriod("2026-01-01", "2026-03-31")).toBe("01/01/2026 – 31/03/2026");
  });
});

// ── S20-GOAL-QUICKSTART-1 — luật trạng thái một chạm ─────────────────────────────────────────────

describe("goalCheckinLockReason", () => {
  const base = { status: "Active" as const, finalizedAt: null, progressPercent: 40 };
  it("Active chưa chốt ⇒ null (check-in được)", () => {
    expect(goalCheckinLockReason(base)).toBeNull();
  });
  it("chốt kỳ xét trước Nháp", () => {
    expect(goalCheckinLockReason({ ...base, status: "Draft", finalizedAt: "2026-04-01" })).toBe(
      "finalized",
    );
  });
  it("Nháp ⇒ draft; Hoàn thành/Đã huỷ ⇒ notActive", () => {
    expect(goalCheckinLockReason({ ...base, status: "Draft" })).toBe("draft");
    expect(goalCheckinLockReason({ ...base, status: "Completed" })).toBe("notActive");
    expect(goalCheckinLockReason({ ...base, status: "Cancelled" })).toBe("notActive");
  });
});

describe("shouldSuggestCompletion", () => {
  const base = { status: "Active" as const, finalizedAt: null, progressPercent: 100 };
  it("Active · chưa chốt · ≥ 100 ⇒ true (kể cả vượt 100)", () => {
    expect(shouldSuggestCompletion(base)).toBe(true);
    expect(shouldSuggestCompletion({ ...base, progressPercent: 120 })).toBe(true);
  });
  it("99,5 · NULL · đã chốt · không Active ⇒ false", () => {
    expect(shouldSuggestCompletion({ ...base, progressPercent: 99.5 })).toBe(false);
    expect(shouldSuggestCompletion({ ...base, progressPercent: null })).toBe(false);
    expect(shouldSuggestCompletion({ ...base, finalizedAt: "2026-04-01" })).toBe(false);
    expect(shouldSuggestCompletion({ ...base, status: "Completed" })).toBe(false);
    expect(shouldSuggestCompletion({ ...base, status: "Draft" })).toBe(false);
  });
});

describe("goalPeriodLabel", () => {
  it("Quý ⇒ Qn/YYYY · Năm ⇒ YYYY · Tuỳ chỉnh ⇒ khoảng ngày", () => {
    expect(
      goalPeriodLabel({
        periodType: "quarter",
        periodStart: "2026-10-01",
        periodEnd: "2026-12-31",
      }),
    ).toBe("Q4/2026");
    expect(
      goalPeriodLabel({
        periodType: "quarter",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
      }),
    ).toBe("Q1/2026");
    expect(
      goalPeriodLabel({ periodType: "year", periodStart: "2026-01-01", periodEnd: "2026-12-31" }),
    ).toBe("2026");
    expect(
      goalPeriodLabel({ periodType: "custom", periodStart: "2026-02-01", periodEnd: "2026-03-15" }),
    ).toBe("01/02/2026 – 15/03/2026");
  });
});
