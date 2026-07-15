/**
 * useNotificationTemplates — TanStack Query hooks cho NotificationTemplatesPage (S4-FE-NOTI-4, nối
 * S4-NOTI-BE-5 GET /notifications/templates + BE-3/BE-4 GET/PATCH /notifications/templates/:id).
 * Danh mục nhỏ theo company (mirror NotificationEventsPage) — filter event_code/channel truyền THẲNG
 * xuống server qua queryKey (server tự lọc, KHÔNG lọc client-side lại). `enabled` gate bằng useCanExact
 * ở component (KHÔNG tự gọi bên trong hook — tách biệt concern, mirror useDashboardConfigAdmin).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  NotificationTemplateAdminQuery,
  NotificationTemplateAdminPatch,
} from "@mediaos/contracts";
import { notificationAdminApi, notificationKeys } from "@mediaos/web-core";
import { NOTI_TEMPLATE_PAGE_SIZE_MAX } from "../constants";

export interface NotificationTemplateListFilter {
  event_code?: string;
  channel?: string;
}

export function useNotificationTemplates(filter: NotificationTemplateListFilter, enabled = true) {
  const query: Partial<NotificationTemplateAdminQuery> = {
    per_page: NOTI_TEMPLATE_PAGE_SIZE_MAX,
    event_code: filter.event_code || undefined,
    channel: filter.channel
      ? (filter.channel as NotificationTemplateAdminQuery["channel"])
      : undefined,
  };
  return useQuery({
    queryKey: notificationKeys.templates(query),
    queryFn: () => notificationAdminApi.listTemplates(query),
    enabled,
    staleTime: 30_000,
  });
}

export function useUpdateNotificationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: NotificationTemplateAdminPatch }) =>
      notificationAdminApi.updateTemplate(id, body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...notificationKeys.all, "admin-templates"] }),
    retry: false,
  });
}
