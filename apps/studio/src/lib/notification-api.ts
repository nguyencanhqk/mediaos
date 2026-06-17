import { z } from "zod";
import { notificationSchema, unreadCountSchema } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

export const notificationApi = {
  list: (isRead?: boolean) => {
    const qs = isRead !== undefined ? `?is_read=${isRead}` : "";
    return apiFetch(`/notifications${qs}`, z.array(notificationSchema));
  },

  unreadCount: () => apiFetch("/notifications/unread-count", unreadCountSchema),

  markRead: (id: string) =>
    apiFetch(`/notifications/${id}/read`, notificationSchema, { method: "PATCH" }),

  markAllRead: () =>
    apiFetch("/notifications/read-all", z.unknown(), { method: "PATCH" }),
};
