import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EmployeeListItemDto } from "@mediaos/contracts";
import { membersApi } from "@/lib/members-api";

/** Nhãn hiển thị 1 nhân sự — ưu tiên tên, rồi email, cuối cùng id rút gọn. */
export function employeeLabel(e: EmployeeListItemDto): string {
  return e.userFullName ?? e.userEmail ?? e.userId.slice(0, 8);
}

/**
 * Danh sách nhân sự active cho picker người nhận. Trả `[]` (kèm cờ lỗi) khi không có quyền read:employee
 * — UI vẫn dùng được, chỉ hiển thị assignee theo id rút gọn (không bịa dữ liệu, không vỡ trang).
 */
export function useEmployeeOptions() {
  const query = useQuery({
    queryKey: ["employees"],
    queryFn: () => membersApi.listEmployees(),
    retry: false,
  });
  return { employees: query.data ?? [], isError: query.isError, isLoading: query.isLoading };
}

/**
 * Map userId → nhãn hiển thị. Tra cứu O(1) khi render assignee trên card/row. Khi thiếu quyền
 * read:employee (map rỗng) → caller fallback id rút gọn.
 */
export function useEmployeeMap(): {
  map: Map<string, EmployeeListItemDto>;
  labelFor: (userId: string | null) => string | null;
} {
  const { employees } = useEmployeeOptions();
  return useMemo(() => {
    const map = new Map<string, EmployeeListItemDto>();
    for (const e of employees) map.set(e.userId, e);
    const labelFor = (userId: string | null): string | null => {
      if (!userId) return null;
      const e = map.get(userId);
      return e ? employeeLabel(e) : userId.slice(0, 8).toUpperCase();
    };
    return { map, labelFor };
  }, [employees]);
}
