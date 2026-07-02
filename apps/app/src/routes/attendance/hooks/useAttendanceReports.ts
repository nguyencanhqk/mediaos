/**
 * useAttendanceReports — TanStack Query hooks cho báo cáo tổng hợp công + audit log ATT (S3-FE-ATT-6).
 * `enabled` gate bằng useCanExact ở component (KHÔNG tự gọi bên trong hook).
 */
import { useQuery } from "@tanstack/react-query";
import type { AttendanceReportQuery, AuditLogQuery } from "@mediaos/contracts";
import { attendanceApi, attendanceKeys } from "@mediaos/web-core";

export function useTeamAttendanceReport(query: AttendanceReportQuery, enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.reports.team(query),
    queryFn: () => attendanceApi.getTeamAttendanceReport(query),
    enabled,
    staleTime: 30_000,
  });
}

export function useCompanyAttendanceReport(query: AttendanceReportQuery, enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.reports.company(query),
    queryFn: () => attendanceApi.getCompanyAttendanceReport(query),
    enabled,
    staleTime: 30_000,
  });
}

export function useAttendanceAuditLogs(query: Partial<AuditLogQuery>, enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.auditLogs.list(query),
    queryFn: () => attendanceApi.listAttendanceAuditLogs(query),
    enabled,
    staleTime: 30_000,
  });
}
