/**
 * useAttendanceAdmin — TanStack Query hooks cho danh mục admin ATT (S3-FE-ATT-5).
 *
 * Ca làm việc / Gán ca / Rule chấm công: danh mục nhỏ theo company (KHÔNG phân trang server) — list()
 * KHÔNG nhận params. Quy tắc chung với useAttendanceRecords: `enabled` gate bằng useCan/useCanExact ở
 * component (KHÔNG tự gọi bên trong hook — tách biệt concern). company_id do SERVER resolve.
 *
 * BE-3 (S3-ATT-BE-3) CHƯA build lúc viết lane này — endpoint có thể 404 tới khi BE land; hook vẫn đúng
 * shape (loading/error/empty đủ phủ qua TanStack Query trạng thái chuẩn).
 */
import { useQuery } from "@tanstack/react-query";
import { attendanceApi, attendanceKeys } from "@mediaos/web-core";

export function useShifts(enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.shifts.list(),
    queryFn: () => attendanceApi.listShifts(),
    enabled,
    staleTime: 30_000,
  });
}

export function useShiftAssignments(enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.shiftAssignments.list(),
    queryFn: () => attendanceApi.listShiftAssignments(),
    enabled,
    staleTime: 30_000,
  });
}

export function useAttendanceRules(enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.rules.list(),
    queryFn: () => attendanceApi.listRules(),
    enabled,
    staleTime: 30_000,
  });
}
