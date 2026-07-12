/**
 * useDashboardWidgetData — hook dùng chung cho mọi WidgetCard con (S4-FE-DASH-1).
 *
 * "Widget lazy": mỗi widget tự fetch data qua GET /dashboard/widgets/:slug (dashboardApi.getWidgetData),
 * ĐỘC LẬP với DashboardMePage (chỉ tải shell /dashboard/me). `refresh()` gọi lại với `refresh:true` (bỏ qua
 * cache hợp lệ) qua mutation riêng rồi ghi thẳng kết quả vào query cache — tránh 1 useQuery vừa mang state
 * "tham số" vừa mang state "dữ liệu" (2 mối quan tâm tách biệt, dễ test).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dashboardApi, dashboardKeys, type ApiError } from "@mediaos/web-core";
import type { DashboardWidgetDataDto, DashboardTypeValue } from "@mediaos/contracts";

export interface UseDashboardWidgetDataOptions {
  /** Tắt fetch hoàn toàn (vd user thiếu quyền — gate đã ẩn cả component nhưng phòng khi hook được gọi trần). */
  enabled?: boolean;
  dashboardType?: DashboardTypeValue;
  /** S4-FE-DASH-2 — bắt buộc cho slug=project-progress (PROJECT_PROGRESS); BE 400 nếu thiếu (§widgetDataQuerySchema). */
  projectId?: string;
}

export interface UseDashboardWidgetDataResult {
  data: DashboardWidgetDataDto | undefined;
  isLoading: boolean;
  isError: boolean;
  error: ApiError | Error | null;
  refresh: () => void;
  isRefreshing: boolean;
}

export function useDashboardWidgetData(
  widgetCode: string,
  options?: UseDashboardWidgetDataOptions,
): UseDashboardWidgetDataResult {
  const enabled = options?.enabled ?? true;
  const dashboardType = options?.dashboardType;
  const projectId = options?.projectId;
  const queryClient = useQueryClient();
  const queryKey = dashboardKeys.widgets.data(widgetCode, {
    dashboard_type: dashboardType,
    project_id: projectId,
  });

  const query = useQuery({
    queryKey,
    queryFn: () =>
      dashboardApi.getWidgetData(widgetCode, {
        dashboard_type: dashboardType,
        project_id: projectId,
      }),
    enabled,
    staleTime: 15_000,
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      dashboardApi.getWidgetData(widgetCode, {
        dashboard_type: dashboardType,
        project_id: projectId,
        refresh: true,
      }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(queryKey, fresh);
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as ApiError | Error | null) ?? null,
    refresh: () => void refreshMutation.mutate(),
    isRefreshing: refreshMutation.isPending,
  };
}
