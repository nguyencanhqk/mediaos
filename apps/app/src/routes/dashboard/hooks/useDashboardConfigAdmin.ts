/**
 * useDashboardConfigAdmin — TanStack Query hooks cho DashboardConfigPage (S4-FE-DASH-3, nối
 * S4-DASH-BE-3 GET/PATCH /dashboard/configs). Danh mục nhỏ theo company (KHÔNG phân trang server) —
 * list() KHÔNG nhận filter server-side (dashboard_type lọc CLIENT-SIDE, mirror NotificationEventsPage).
 * `enabled` gate bằng useCanExact ở component (KHÔNG tự gọi bên trong hook — tách biệt concern).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DashboardConfigPatchDto } from "@mediaos/contracts";
import { dashboardApi, dashboardKeys } from "@mediaos/web-core";

export function useDashboardConfigs(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.configs.list(),
    queryFn: () => dashboardApi.getDashboardConfigs(),
    enabled,
    staleTime: 30_000,
  });
}

export function useUpdateDashboardConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DashboardConfigPatchDto }) =>
      dashboardApi.updateDashboardConfig(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: dashboardKeys.configs.all }),
    retry: false,
  });
}
