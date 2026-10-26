/**
 * S20-GOAL-BULKACTIVATE-1 (US-GOAL-QL-11) — lựa chọn nhiều dòng trên danh sách /goals.
 *
 * `selectedRows` chỉ gồm dòng ĐANG hiện (đổi bộ lọc ⇒ dòng đã ẩn không còn được tính/gửi). «Chọn tất
 * cả» = mọi dòng của danh sách đang tải (không riêng trang client đang xem) — nút đếm số thật.
 */
import { useCallback, useMemo, useState } from "react";
import type { GoalCoreResponseDto } from "@mediaos/contracts";

export interface GoalRowSelection {
  readonly selectedIds: ReadonlySet<string>;
  readonly selectedRows: readonly GoalCoreResponseDto[];
  readonly allSelected: boolean;
  readonly someSelected: boolean;
  readonly toggle: (goalId: string) => void;
  readonly toggleAll: () => void;
  readonly clear: () => void;
  readonly keepOnly: (goalIds: readonly string[]) => void;
}

export function useGoalRowSelection(rows: readonly GoalCoreResponseDto[]): GoalRowSelection {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds],
  );
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;

  const toggle = useCallback((goalId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  }, []);
  const toggleAll = useCallback(() => {
    setSelectedIds(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  }, [allSelected, rows]);
  const clear = useCallback(() => setSelectedIds(new Set()), []);
  const keepOnly = useCallback(
    (goalIds: readonly string[]) => setSelectedIds(new Set(goalIds)),
    [],
  );

  return useMemo(
    () => ({
      selectedIds,
      selectedRows,
      allSelected,
      someSelected: selectedRows.length > 0,
      toggle,
      toggleAll,
      clear,
      keepOnly,
    }),
    [selectedIds, selectedRows, allSelected, toggle, toggleAll, clear, keepOnly],
  );
}
