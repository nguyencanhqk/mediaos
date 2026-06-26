/**
 * Hook quản lý state phân trang + bộ lọc cho viewer nhật ký bảo mật (S2-AUTH-BE-5).
 *
 * - `filters` là object filter tùy biến theo trang (login-log / security-event).
 * - Đổi bất kỳ filter nào → reset `page` về 1 (tránh ở trang N nhưng kết quả mới chỉ 1 trang).
 * - Immutable: setFilters luôn tạo object mới (coding-style: không mutate).
 * - `applied` là snapshot filter đã "Lọc" (form vs applied tách biệt → không refetch mỗi keypress).
 */
import { useCallback, useMemo, useState } from "react";

export interface AuthLogFilterState<TFilters extends Record<string, unknown>> {
  /** Trang hiện tại (1-based). */
  page: number;
  /** Giá trị form bộ lọc (đang nhập, CHƯA áp dụng). */
  draft: TFilters;
  /** Giá trị bộ lọc ĐÃ áp dụng (driver của query). */
  applied: TFilters;
  setPage: (page: number) => void;
  /** Cập nhật 1 field trong form draft (chưa refetch). */
  setDraftField: <K extends keyof TFilters>(key: K, value: TFilters[K]) => void;
  /** Áp dụng draft → applied + reset page về 1. */
  applyFilters: () => void;
  /** Xóa toàn bộ filter về initial + reset page. */
  resetFilters: () => void;
}

export function useAuthLogFilters<TFilters extends Record<string, unknown>>(
  initialFilters: TFilters,
): AuthLogFilterState<TFilters> {
  const [page, setPageState] = useState(1);
  const [draft, setDraft] = useState<TFilters>(initialFilters);
  const [applied, setApplied] = useState<TFilters>(initialFilters);

  const setPage = useCallback((next: number) => {
    setPageState(next < 1 ? 1 : next);
  }, []);

  const setDraftField = useCallback(<K extends keyof TFilters>(key: K, value: TFilters[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const applyFilters = useCallback(() => {
    setApplied(draft);
    setPageState(1);
  }, [draft]);

  const resetFilters = useCallback(() => {
    setDraft(initialFilters);
    setApplied(initialFilters);
    setPageState(1);
  }, [initialFilters]);

  return useMemo(
    () => ({ page, draft, applied, setPage, setDraftField, applyFilters, resetFilters }),
    [page, draft, applied, setPage, setDraftField, applyFilters, resetFilters],
  );
}

/**
 * Chuyển 1 chuỗi rỗng → undefined (để KHÔNG gửi param rỗng lên API).
 * Date-only "yyyy-mm-dd" giữ nguyên (BE coerce sang Date).
 */
export function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
