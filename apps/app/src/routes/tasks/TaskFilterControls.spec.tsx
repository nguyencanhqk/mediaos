import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TaskSearchBox } from "./TaskFilterControls";

// S20-TASK-PROJTOOLBARURL-1 (review) — debounce của ô tìm KHÔNG được phụ thuộc vào danh tính hàm
// `onCommit`. Toolbar workspace truyền arrow inline ⇒ mỗi lần trang cha render lại (refetch, tick /me…)
// là một hàm mới; timer 300ms phải chạy tiếp, và lúc bắn thì gọi bản `onCommit` MỚI NHẤT (bộ lọc khác
// đổi giữa chừng không bị ghi đè bằng bản cũ).
afterEach(() => {
  vi.useRealTimers();
});

describe("TaskSearchBox — debounce", () => {
  it("cha render lại với `onCommit` mới mỗi 200ms lúc đang gõ ⇒ vẫn ghi đúng một lần, bằng bản mới nhất", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const box = (generation: number) => (
      <TaskSearchBox value={undefined} onCommit={(q) => spy(q, generation)} testId="search" />
    );
    const { rerender } = render(box(0));

    fireEvent.change(screen.getByTestId("search"), { target: { value: "báo cáo" } });
    for (let generation = 1; generation <= 5; generation += 1) {
      act(() => vi.advanceTimersByTime(200));
      rerender(box(generation));
    }

    expect(spy).toHaveBeenCalledTimes(1);
    // Bắn ở mốc 300ms, sau lần render lại thứ nhất ⇒ gọi bản đang gắn lúc bắn (generation 1).
    expect(spy).toHaveBeenCalledWith("báo cáo", 1);
  });

  it("gõ tiếp vẫn đặt lại timer: chỉ ghi chữ cuối, sau 300ms im lặng", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<TaskSearchBox value={undefined} onCommit={onCommit} testId="search" />);
    const input = screen.getByTestId("search");

    fireEvent.change(input, { target: { value: "bá" } });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.change(input, { target: { value: "báo" } });
    act(() => vi.advanceTimersByTime(200));
    expect(onCommit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(100));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("báo");
  });

  it("đổi `onCommit` giữa lúc chờ ⇒ lúc bắn gọi bản mới, không gọi bản cũ", () => {
    vi.useFakeTimers();
    const stale = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(
      <TaskSearchBox value={undefined} onCommit={stale} testId="search" />,
    );

    fireEvent.change(screen.getByTestId("search"), { target: { value: "x" } });
    act(() => vi.advanceTimersByTime(100));
    rerender(<TaskSearchBox value={undefined} onCommit={latest} testId="search" />);
    act(() => vi.advanceTimersByTime(200));

    expect(stale).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(latest).toHaveBeenCalledWith("x");
  });
});
