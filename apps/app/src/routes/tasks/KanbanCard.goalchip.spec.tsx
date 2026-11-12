import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TaskKanbanCardDto } from "@mediaos/contracts";
import { KanbanCard } from "./KanbanCard";

// S20-TASK-MYTASKSLOAD-1 — chip mục tiêu trên thẻ board: ngoài mặt thẻ role=button, không mở thẻ khi bấm.
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
    }) => (
      <a href={`${to}?goalId=${String(search?.goalId)}`} {...rest}>
        {children}
      </a>
    ),
  };
});

const G = "0190a1b2-c3d4-7e5f-8a6b-1c2d3e4f5a6b";

function card(overrides: Partial<TaskKanbanCardDto>): TaskKanbanCardDto {
  return {
    id: "t1",
    companyId: "co",
    title: "Thẻ thử",
    taskType: "office",
    status: "Todo",
    priority: "Medium",
    isOverdue: false,
    ...overrides,
  } as TaskKanbanCardDto;
}

function renderCard(task: TaskKanbanCardDto, onOpen = vi.fn(), onDragStart = vi.fn()) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <KanbanCard
        task={task}
        draggable
        onDragStart={onDragStart}
        onOpen={onOpen}
        subtasksExpanded={false}
        onToggleSubtasks={() => undefined}
      />
    </QueryClientProvider>,
  );
  return { onOpen, onDragStart };
}

describe("KanbanCard — chip mục tiêu", () => {
  it("DENY: bị che (goalId null, hasGoal) ⇒ không chip", () => {
    renderCard(card({ goalId: null, goalCode: null, goalName: null, hasGoal: true }));
    expect(screen.queryByTestId("task-goal-chip")).toBeNull();
  });
  it("ALLOW: có mã + tên ⇒ chip nằm NGOÀI mặt thẻ; bấm/nhấn chuột không mở thẻ", () => {
    const { onOpen } = renderCard(
      card({ goalId: G, goalCode: "G-1", goalName: "Tăng doanh thu", hasGoal: true }),
    );
    const chip = screen.getByTestId("task-goal-chip");
    expect(chip.getAttribute("href")).toBe(`/tasks?goalId=${G}`);
    expect(chip.getAttribute("title")).toBe("G-1 — Tăng doanh thu");
    expect(screen.getByTestId("kanban-card-t1").contains(chip)).toBe(false);
    fireEvent.pointerDown(chip);
    fireEvent.click(chip);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
