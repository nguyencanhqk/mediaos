/**
 * useAttendanceRecords — TanStack Query hooks cho bảng công scoped (S3-FE-ATT-2).
 *
 * Quy tắc:
 * - `enabled` gate bằng useCanExact (fail-closed) — caller truyền kết quả useCanExact vào.
 * - KHÔNG tự mình gọi useCanExact bên trong hook (tách biệt concern: hook lo query, component lo gate).
 * - company_id do SERVER resolve từ auth context — client KHÔNG nhận/forward.
 */
import { useQuery } from "@tanstack/react-query";
import type { AttendanceRecordListQuery } from "@mediaos/contracts";
import { attendanceApi, attendanceKeys } from "@mediaos/web-core";

// ── Bảng công của tôi (Own) ────────────────────────────────────────────────────

export function useMyAttendanceRecords(
  params: Partial<AttendanceRecordListQuery> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: attendanceKeys.myRecords(params),
    queryFn: () => attendanceApi.listMyRecords(params),
    enabled,
    staleTime: 30_000,
  });
}

// ── Bảng công nhóm (Team) ─────────────────────────────────────────────────────

export function useTeamAttendanceRecords(
  params: Partial<AttendanceRecordListQuery> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: attendanceKeys.teamRecords(params),
    queryFn: () => attendanceApi.listTeamRecords(params),
    enabled,
    staleTime: 30_000,
  });
}

// ── Chi tiết bản ghi ───────────────────────────────────────────────────────────

export function useAttendanceRecordDetail(id: string, enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.records.detail(id),
    queryFn: () => attendanceApi.getRecord(id),
    enabled: enabled && !!id,
    staleTime: 30_000,
    // Không specify retry riêng — dùng defaultOptions của QueryClient.
    // Page xử lý 403/404 qua error.status (ApiError instanceof check) → forbidden/notFound state.
  });
}
