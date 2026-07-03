/**
 * useLeaveReports — TanStack Query hooks cho báo cáo tổng hợp nghỉ + audit log LEAVE (S3-FE-LEAVE-6).
 * `enabled` gate bằng useCanExact ở component (KHÔNG tự gọi bên trong hook) — mirror useAttendanceReports.
 */
import { useQuery } from "@tanstack/react-query";
import type { LeaveReportQuery, AuditLogQuery } from "@mediaos/contracts";
import { leaveApi, leaveKeys } from "@mediaos/web-core";

export function useLeaveReport(query: LeaveReportQuery, enabled = true) {
  return useQuery({
    queryKey: leaveKeys.reports.list(query),
    queryFn: () => leaveApi.getLeaveReport(query),
    enabled,
    staleTime: 30_000,
  });
}

export function useLeaveAuditLogs(query: Partial<AuditLogQuery>, enabled = true) {
  return useQuery({
    queryKey: leaveKeys.auditLogs.list(query),
    queryFn: () => leaveApi.listLeaveAuditLogs(query),
    enabled,
    staleTime: 30_000,
  });
}
