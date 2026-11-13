import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TaskGoalChip } from "./TaskGoalChip";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      search,
      children,
      ...rest
    }: {
      to: string;
      search?: Record<string, unknown>;
      children: React.ReactNode;
    }) => {
      const qs = new URLSearchParams(
        Object.entries(search ?? {}).map(([k, v]) => [k, String(v)]),
      ).toString();
      return (
        <a href={`${to}?${qs}`} {...rest}>
          {children}
        </a>
      );
    },
  };
});

const ID = "0190a1b2-c3d4-7e5f-8a6b-1c2d3e4f5a6b";

describe("TaskGoalChip", () => {
  it("DENY: goalId/goalCode null (bị che, hasGoal=true) ⇒ không vẽ", () => {
    const { container } = render(<TaskGoalChip goalId={null} goalCode={null} goalName={null} />);
    expect(container.firstChild).toBeNull();
  });
  it("DENY: thiếu mã ⇒ không vẽ", () => {
    const { container } = render(<TaskGoalChip goalId={ID} goalCode={null} goalName="Tên" />);
    expect(container.firstChild).toBeNull();
  });
  it("ALLOW: link /tasks?goalId=…, có title đầy đủ, cắt gọn bằng truncate", () => {
    render(<TaskGoalChip goalId={ID} goalCode="G-1" goalName="Tăng doanh thu" />);
    const chip = screen.getByTestId("task-goal-chip");
    expect(chip.getAttribute("href")).toBe(`/tasks?goalId=${ID}`);
    expect(chip.getAttribute("title")).toBe("G-1 — Tăng doanh thu");
    expect(chip.textContent).toBe("G-1 — Tăng doanh thu");
    expect(chip.className).toContain("max-w-[12rem]");
    expect(chip.querySelector(".truncate")).not.toBeNull();
    expect(chip.getAttribute("draggable")).toBe("false");
  });
  it("bấm/nhấn chip không nổi bọt lên thẻ/dòng cha", () => {
    const parentClick = vi.fn();
    const parentDown = vi.fn();
    render(
      <div onClick={parentClick} onPointerDown={parentDown}>
        <TaskGoalChip goalId={ID} goalCode="G-1" goalName="X" />
      </div>,
    );
    const chip = screen.getByTestId("task-goal-chip");
    fireEvent.pointerDown(chip);
    fireEvent.click(chip);
    expect(parentClick).not.toHaveBeenCalled();
    expect(parentDown).not.toHaveBeenCalled();
  });
});
