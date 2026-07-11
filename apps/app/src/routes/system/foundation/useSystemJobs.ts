/**
 * useSystemJobs — TanStack Query hooks cho System Jobs observability (S5-FND-JOBS-OBS-1, READ-ONLY).
 *
 * Chỉ có list — KHÔNG mutation hook (server chỉ có route GET, KHÔNG trigger/run). `enabled` gate bằng
 * useCan ở component (KHÔNG tự gọi trong hook), cùng quy tắc useRetention/useFileAccessLogs.
 */
import { useQuery } from "@tanstack/react-query";
import {
  foundationKeys,
  systemJobsApi,
  type SystemJobRunsListParams,
  type SystemJobRunView,
} from "@mediaos/web-core";

/** GET /foundation/system-jobs — 1 hàng/jobCode = lần chạy MỚI NHẤT (không tham số, tập nhỏ). */
export function useSystemJobsSummary(enabled = true) {
  return useQuery({
    queryKey: foundationKeys.systemJobs.summary(),
    queryFn: () => systemJobsApi.listSummary(),
    enabled,
    staleTime: 15_000,
  });
}

/** GET /foundation/system-jobs/:jobName/runs — lịch sử 1 job (phân trang page-based). `jobName=null` ⇒ tắt query. */
export function useSystemJobRuns(
  jobName: string | null,
  params: SystemJobRunsListParams,
  enabled = true,
): ReturnType<typeof useQuery<SystemJobRunView[]>> {
  return useQuery({
    queryKey: foundationKeys.systemJobs.runs(jobName ?? "", { ...params }),
    queryFn: () => systemJobsApi.listRuns(jobName as string, params),
    enabled: enabled && jobName !== null,
    staleTime: 15_000,
  });
}
