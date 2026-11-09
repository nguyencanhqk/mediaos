// @vitest-environment jsdom
/** S20-GOAL-OWNERCHECKIN-1 — ô «Check-in cuối»: cảnh báo quá 7 ngày theo giờ công ty + tooltip. */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { GoalCheckinCell, GoalNeedsCheckinBadge } from "./GoalCheckinCell";

const NOW = new Date("2026-11-09T05:00:00Z");
const goal = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  progressMode: "manual" as const,
  status: "Active" as const,
  createdAt: "2026-10-01T00:00:00.000Z",
  lastCheckinAt: "2026-11-01T05:00:00.000Z" as string | null,
  ...over,
});
const wrap = (ui: React.ReactNode) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

describe("GoalCheckinCell", () => {
  it("quá 7 ngày ⇒ tô cảnh báo + tooltip ngày giờ giờ-công-ty + nhãn", () => {
    wrap(
      <>
        <GoalCheckinCell goal={goal()} now={NOW} />
        <GoalNeedsCheckinBadge goal={goal()} now={NOW} />
      </>,
    );
    const cell = screen.getByTestId("goal-lastcheckin-g1");
    expect(cell).toHaveAttribute("data-stale", "true");
    expect(cell).toHaveTextContent("Check-in 8 ngày trước");
    expect(cell.getAttribute("title")).toContain("01/11/2026 12:00");
    expect(screen.getByTestId("goal-needs-checkin-g1")).toBeInTheDocument();
  });

  it("trong hạn ⇒ không cảnh báo; chưa từng check-in ⇒ «Chưa check-in»", () => {
    wrap(<GoalCheckinCell goal={goal({ lastCheckinAt: "2026-11-08T05:00:00.000Z" })} now={NOW} />);
    expect(screen.getByTestId("goal-lastcheckin-g1")).not.toHaveAttribute("data-stale");
    wrap(<GoalCheckinCell goal={goal({ id: "g2", lastCheckinAt: null })} now={NOW} />);
    expect(screen.getByTestId("goal-lastcheckin-g2")).toHaveTextContent("Chưa check-in");
  });

  it("chế độ đo tự động ⇒ không nhãn", () => {
    wrap(<GoalNeedsCheckinBadge goal={goal({ progressMode: "children" })} now={NOW} />);
    expect(screen.queryByTestId("goal-needs-checkin-g1")).toBeNull();
  });
});
