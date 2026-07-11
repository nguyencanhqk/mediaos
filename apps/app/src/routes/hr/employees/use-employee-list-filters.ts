import { useState, useMemo } from "react";
import type { SortingState } from "@tanstack/react-table";
import { HR_EMPLOYEE_SORT_FIELDS, type HrEmployeeListQuery } from "@mediaos/contracts";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

/** Allowlist sort-field (contracts) — chống forward sort-key ngoài enum (Zod BE sẽ 400). */
const SORT_FIELDS = new Set<string>(HR_EMPLOYEE_SORT_FIELDS);

/**
 * State cục bộ cho bộ lọc danh sách nhân viên.
 * Tách ra khỏi component để tránh re-render cascade và dễ test.
 * P1 perf: search DEBOUNCE 300ms trước khi vào queryParams — input hiển thị tức thời (state thô),
 * nhưng query key/API call chỉ đổi khi người dùng ngừng gõ.
 *
 * HR-PROFILE-UI-2: thêm SẮP XẾP SERVER — `sorting` (TanStack SortingState) do header click phát ra,
 * quy về sort/order trong queryParams (chỉ khi field thuộc allowlist HR_EMPLOYEE_SORT_FIELDS).
 */
export function useEmployeeListFilters() {
  const [search, setSearch] = useState("");
  const [deptId, setDeptId] = useState("");
  const [status, setStatus] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const debouncedSearch = useDebouncedValue(search, 300);

  const queryParams = useMemo<Partial<HrEmployeeListQuery>>(() => {
    const first = sorting[0];
    const sortField = first && SORT_FIELDS.has(first.id) ? first.id : undefined;
    return {
      search: debouncedSearch.trim() || undefined,
      orgUnitId: deptId || undefined,
      status: (status as HrEmployeeListQuery["status"]) || undefined,
      sort: sortField as HrEmployeeListQuery["sort"] | undefined,
      order: sortField ? (first?.desc ? "desc" : "asc") : undefined,
    };
  }, [debouncedSearch, deptId, status, sorting]);

  return {
    search,
    setSearch,
    deptId,
    setDeptId,
    status,
    setStatus,
    sorting,
    setSorting,
    queryParams,
  };
}
