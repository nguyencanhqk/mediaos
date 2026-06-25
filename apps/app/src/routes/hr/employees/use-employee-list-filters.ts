import { useState, useMemo } from "react";
import type { HrEmployeeListQuery } from "@mediaos/contracts";

/**
 * State cục bộ cho bộ lọc danh sách nhân viên.
 * Tách ra khỏi component để tránh re-render cascade và dễ test.
 */
export function useEmployeeListFilters() {
  const [search, setSearch] = useState("");
  const [deptId, setDeptId] = useState("");
  const [status, setStatus] = useState("");

  const queryParams = useMemo<Partial<HrEmployeeListQuery>>(
    () => ({
      search: search.trim() || undefined,
      orgUnitId: deptId || undefined,
      status: (status as HrEmployeeListQuery["status"]) || undefined,
    }),
    [search, deptId, status],
  );

  return { search, setSearch, deptId, setDeptId, status, setStatus, queryParams };
}
