/**
 * Hook quản lý state phân trang (offset/limit) + bộ lọc cho viewer Audit log (S2-FE-FND-2).
 *
 * - `filters` là object filter tùy biến theo trang (audit-log).
 * - Đổi bất kỳ filter nào → reset `offset` về 0 (tránh ở trang N nhưng kết quả mới chỉ 1 trang).
 * - Immutable: setFilters luôn tạo object mới (coding-style: không mutate).
 * - `applied` là snapshot filter đã "Lọc" (form vs applied tách biệt → không refetch mỗi keypress).
 *
 * Khác `useAuthLogFilters` (page-based) ở chỗ audit dùng offset/limit (BE `auditLogQuerySchema`).
 */
import { useCallback, useMemo, useState } from "react";

export interface AuditLogFilterState<TFilters extends Record<string, unknown>> {
  /** Offset hiện tại (0-based). */
  offset: number;
  /** Giá trị form bộ lọc (đang nhập, CHƯA áp dụng). */
  draft: TFilters;
  /** Giá trị bộ lọc ĐÃ áp dụng (driver của query). */
  applied: TFilters;
  setOffset: (offset: number) => void;
  /** Cập nhật 1 field trong form draft (chưa refetch). */
  setDraftField: <K extends keyof TFilters>(key: K, value: TFilters[K]) => void;
  /** Áp dụng draft → applied + reset offset về 0. */
  applyFilters: () => void;
  /** Xóa toàn bộ filter về initial + reset offset. */
  resetFilters: () => void;
}

export function useAuditLogFilters<TFilters extends Record<string, unknown>>(
  initialFilters: TFilters,
): AuditLogFilterState<TFilters> {
  const [offset, setOffsetState] = useState(0);
  const [draft, setDraft] = useState<TFilters>(initialFilters);
  const [applied, setApplied] = useState<TFilters>(initialFilters);

  const setOffset = useCallback((next: number) => {
    setOffsetState(next < 0 ? 0 : next);
  }, []);

  const setDraftField = useCallback(<K extends keyof TFilters>(key: K, value: TFilters[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const applyFilters = useCallback(() => {
    setApplied(draft);
    setOffsetState(0);
  }, [draft]);

  const resetFilters = useCallback(() => {
    setDraft(initialFilters);
    setApplied(initialFilters);
    setOffsetState(0);
  }, [initialFilters]);

  return useMemo(
    () => ({ offset, draft, applied, setOffset, setDraftField, applyFilters, resetFilters }),
    [offset, draft, applied, setOffset, setDraftField, applyFilters, resetFilters],
  );
}
