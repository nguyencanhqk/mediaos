import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AssigneeRail } from "./AssigneeRail";
import { parseWorkspaceWho } from "./project-workspace-filters";
import type { AssigneeRailSummary } from "./workspace-constants";

// S20-TASK-PROJTOOLBARURL-1 — rail là component THUẦN: selection đến từ `who` trên URL (qua
// parseWorkspaceWho), bấm chỉ báo lên trang để trang ghi URL.
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

const SUMMARY: AssigneeRailSummary = {
  assignees: [
    { id: U1, name: "An", avatarUrl: null, count: 3 },
    { id: U2, name: "Bình", avatarUrl: null, count: 1 },
  ],
  unassignedCount: 0,
};

function renderRail(who: unknown) {
  const onToggle = vi.fn();
  const onClear = vi.fn();
  render(
    <AssigneeRail
      summary={SUMMARY}
      selection={parseWorkspaceWho(who)}
      onToggle={onToggle}
      onClear={onClear}
    />,
  );
  return { onToggle, onClear };
}

const pressed = (testId: string) => screen.getByTestId(testId).getAttribute("aria-pressed");

describe("AssigneeRail — selection từ `who` trên URL", () => {
  it("who=U1 ⇒ chỉ U1 bật, «Tất cả» tắt", () => {
    renderRail(U1);
    expect(pressed(`assignee-rail-item-${U1}`)).toBe("true");
    expect(pressed(`assignee-rail-item-${U2}`)).toBe("false");
    expect(pressed("assignee-rail-all")).toBe("false");
  });

  it("who=unassigned ⇒ nút «Chưa giao» vẫn hiện (đường gỡ) dù đếm 0 và đang bật", () => {
    renderRail("unassigned");
    expect(pressed("assignee-rail-unassigned")).toBe("true");
    expect(screen.getByTestId("assignee-rail-count-unassigned")).toHaveTextContent("0");
  });

  it("who rác ⇒ như không lọc: «Tất cả» bật, không ai bật", () => {
    renderRail("rác,123");
    expect(pressed("assignee-rail-all")).toBe("true");
    expect(pressed(`assignee-rail-item-${U1}`)).toBe("false");
    expect(screen.queryByTestId("assignee-rail-unassigned")).not.toBeInTheDocument();
  });

  it("bấm người ⇒ onToggle(id); bấm «Tất cả» ⇒ onClear", () => {
    const { onToggle, onClear } = renderRail(U1);
    fireEvent.click(screen.getByTestId(`assignee-rail-item-${U2}`));
    expect(onToggle).toHaveBeenCalledWith(U2);
    fireEvent.click(screen.getByTestId("assignee-rail-all"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
