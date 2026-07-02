/**
 * useFileAccessLogs — TanStack Query hook cho viewer File Access Logs (S2-FE-FND-6, APPEND-ONLY).
 *
 * Chỉ có list() — KHÔNG mutation hook (server chỉ có route GET, BẤT BIẾN #2). `enabled` gate bằng
 * useCan ở component (KHÔNG tự gọi trong hook), cùng quy tắc useHolidays/useRetention.
 */
import { useQuery } from "@tanstack/react-query";
import {
  fileAccessLogApi,
  foundationKeys,
  type FileAccessLogListParams,
  type FileAccessLogView,
} from "@mediaos/web-core";

export type FileAccessLogsQueryParams = FileAccessLogListParams;

export function useFileAccessLogs(
  params: FileAccessLogsQueryParams,
  enabled = true,
): ReturnType<typeof useQuery<FileAccessLogView[]>> {
  return useQuery({
    queryKey: foundationKeys.fileAccessLogs.list({ ...params }),
    queryFn: () => fileAccessLogApi.list(params),
    enabled,
    staleTime: 30_000,
  });
}
