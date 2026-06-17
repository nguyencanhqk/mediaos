import { z } from "zod";
import { notificationSchema, unreadCountSchema } from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Notification API — chuông thông báo là **chrome dùng chung** cho mọi app (FS-5). Typed-fetch thuần
 * qua `apiFetch` (Bearer + credentials:'include' + refresh-on-401 + envelope unwrap). Đặt ở web-core để
 * cả 4 app (web/studio/people/console) tiêu thụ qua `<NotificationBell/>` của @mediaos/ui mà không dup
 * notification-api ở từng app (bài học Wave 2: bell từng chỉ ở web/studio, vắng people/console).
 */
export const notificationApi = {
  list: (isRead?: boolean) => {
    const qs = isRead !== undefined ? `?is_read=${isRead}` : "";
    return apiFetch(`/notifications${qs}`, z.array(notificationSchema));
  },

  unreadCount: () => apiFetch("/notifications/unread-count", unreadCountSchema),

  markRead: (id: string) =>
    apiFetch(`/notifications/${id}/read`, notificationSchema, { method: "PATCH" }),

  markAllRead: () => apiFetch("/notifications/read-all", z.unknown(), { method: "PATCH" }),
};
