/**
 * useAttendanceToday — truy vấn trạng thái chấm công hôm nay (ATT-API-001).
 * S3-FE-ATT-1: wrapper TanStack Query cho attendanceApi.getToday().
 * Caller gate quyền VIEW_OWN trước khi gọi hook (enabled=canView).
 */
import { useQuery } from "@tanstack/react-query";
import { attendanceApi, attendanceKeys } from "@mediaos/web-core";

export function useAttendanceToday(enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.myToday(),
    queryFn: () => attendanceApi.getToday(),
    enabled,
    staleTime: 30_000,
    // refetchOnWindowFocus để cập nhật khi nhân viên tab về trang sau khi check-in ở cửa sổ khác.
    refetchOnWindowFocus: true,
  });
}
