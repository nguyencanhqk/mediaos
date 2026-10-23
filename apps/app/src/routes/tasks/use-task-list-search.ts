import { useCallback, useMemo } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  clearTaskListFilters,
  patchTaskListSearch,
  validateTaskListSearch,
  type TaskListSearch,
} from "./task-list-search";

/**
 * S20-TASK-DRAWER-1 (US-TASK-QL-05) — bộ lọc Danh sách công việc ĐỌC/GHI trên URL (không `useState`).
 *
 * Đọc thẳng `location.search` qua cùng hàm `validateTaskListSearch` mà route `/tasks` khai báo, nên
 * trang và router không thể hiểu bộ lọc khác nhau. Ghi bằng `navigate({ to: "." })` giữ tham số khác
 * (vd `?task=` của drawer việc). Đổi bộ lọc rời rạc = PUSH (Back hoàn tác); gõ ô tìm = REPLACE (không
 * nhét một mục lịch sử cho mỗi chữ).
 */
export function useTaskListSearch() {
  const navigate = useNavigate();
  const raw = useRouterState({ select: (s) => s.location.search });
  const search = useMemo(
    () => validateTaskListSearch((raw ?? {}) as Record<string, unknown>),
    [raw],
  );
  const go = useCallback(
    (next: (prev: Record<string, unknown>) => Record<string, unknown>, replace: boolean) =>
      void navigate({ to: ".", search: next as never, replace, resetScroll: false }),
    [navigate],
  );
  const update = useCallback(
    (patch: Partial<TaskListSearch>, replace = false) =>
      go((prev) => patchTaskListSearch(prev, patch), replace),
    [go],
  );
  const clearFilters = useCallback(() => go(clearTaskListFilters, false), [go]);
  return { search, update, clearFilters };
}
