/**
 * S20-TASK-DRAWER-1 — tham số `?task=` của drawer việc toàn cục + «Quay lại» của trang /tasks/:id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { navigateMock, historyRef } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  historyRef: { canGoBack: vi.fn(), back: vi.fn() },
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useRouter: () => ({ history: historyRef }),
}));

import {
  TASK_DETAIL_BACK_FALLBACK,
  isTaskUuid,
  readTaskDrawerParam,
  taskIdFromPath,
  useTaskDetailBack,
  useTaskDrawer,
} from "./task-drawer-nav";

const UUID = "0b9f6a4e-2c1d-4e8f-9a7b-3c5d6e7f8a9b";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isTaskUuid", () => {
  it.each([
    [UUID, true],
    [UUID.toUpperCase(), true],
    ["abc", false],
    [`${UUID}x`, false],
    [` ${UUID}`, false],
    [123, false],
    [null, false],
    [undefined, false],
  ])("isTaskUuid(%s) → %s", (value, expected) => {
    expect(isTaskUuid(value)).toBe(expected);
  });
});

describe("readTaskDrawerParam — giá trị THÔ (router đã JSON.parse)", () => {
  it.each([
    [{}, null],
    [{ task: "" }, null],
    [{ task: null }, null],
    [{ status: "Todo" }, null],
    [{ task: UUID }, UUID],
    [{ task: "abc" }, "abc"],
    // `?task=123` tới đây là SỐ — vẫn là «có tham số» để drawer báo không mở được.
    [{ task: 123 }, "123"],
    [{ task: { a: 1 } }, '{"a":1}'],
  ])("%j → %s", (search, expected) => {
    expect(readTaskDrawerParam(search)).toBe(expected);
  });

  it("search không phải object ⇒ null", () => {
    expect(readTaskDrawerParam(undefined)).toBeNull();
    expect(readTaskDrawerParam("task=1")).toBeNull();
  });
});

describe("taskIdFromPath — đích thông báo", () => {
  it.each([
    [`/tasks/${UUID}`, UUID],
    [`/tasks/${UUID}/`, UUID],
    ["/tasks/my-tasks", null],
    ["/tasks/overdue", null],
    ["/tasks/task-1", null],
    [`/tasks/${UUID}?comment_id=c1`, null],
    [`/tasks/projects/${UUID}`, null],
    [`/goals/${UUID}`, null],
  ])("%s → %s", (path, expected) => {
    expect(taskIdFromPath(path)).toBe(expected);
  });
});

describe("useTaskDrawer — mở = push, đóng = replace, chỉ đổi `task`", () => {
  type Arg = {
    to: string;
    replace: boolean;
    resetScroll: boolean;
    search: (prev: Record<string, unknown>) => Record<string, unknown>;
  };
  const lastArg = () => navigateMock.mock.calls.at(-1)?.[0] as Arg;

  it("openTask ⇒ to '.', push, giữ tham số khác, không cuộn về đầu", () => {
    const { result } = renderHook(() => useTaskDrawer());
    result.current.openTask(UUID);

    const arg = lastArg();
    expect(arg).toMatchObject({ to: ".", replace: false, resetScroll: false });
    expect(arg.search({ status: "Todo", page: 2 })).toEqual({
      status: "Todo",
      page: 2,
      task: UUID,
    });
    expect(arg.search({ task: "cu" })).toEqual({ task: UUID });
  });

  it("closeTask ⇒ replace, bỏ `task`, giữ tham số khác", () => {
    const { result } = renderHook(() => useTaskDrawer());
    result.current.closeTask();

    const arg = lastArg();
    expect(arg).toMatchObject({ to: ".", replace: true });
    expect(arg.search({ status: "Todo", task: UUID })).toEqual({ status: "Todo" });
  });
});

describe("useTaskDetailBack — «Quay lại» của /tasks/:id", () => {
  it("có lịch sử trong app ⇒ history.back(), không điều hướng mặc định", () => {
    historyRef.canGoBack.mockReturnValue(true);
    const { result } = renderHook(() => useTaskDetailBack());
    result.current();

    expect(historyRef.back).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("mở từ tab mới (không có lịch sử) ⇒ về /tasks/my-tasks", () => {
    historyRef.canGoBack.mockReturnValue(false);
    const { result } = renderHook(() => useTaskDetailBack());
    result.current();

    expect(historyRef.back).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith({ to: TASK_DETAIL_BACK_FALLBACK });
    expect(TASK_DETAIL_BACK_FALLBACK).toBe("/tasks/my-tasks");
  });
});
