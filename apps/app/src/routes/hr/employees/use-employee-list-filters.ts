import { useState, useMemo } from "react";
import type { HrEmployeeListQuery } from "@mediaos/contracts";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

/**
 * State cục bộ cho bộ lọc danh sách nhân viên.
 * Tách ra khỏi component để tránh re-render cascade và dễ test.
 * P1 perf: search DEBOUNCE 300ms trước khi vào queryParams — input hiển thị tức thời (state thô),
 * nhưng query key/API call chỉ đổi khi người dùng ngừng gõ.
 */
export function useEmployeeListFilters() {
  const [search, setSearch] = useState("");
  const [deptId, setDeptId] = useState("");
  const [status, setStatus] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const queryParams = useMemo<Partial<HrEmployeeListQuery>>(
    () => ({
      search: debouncedSearch.trim() || undefined,
      orgUnitId: deptId || undefined,
      status: (status as HrEmployeeListQuery["status"]) || undefined,
    }),
    [debouncedSearch, deptId, status],
  );

  return { search, setSearch, deptId, setDeptId, status, setStatus, queryParams };
}
