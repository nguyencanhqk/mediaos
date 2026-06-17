import { z } from "zod";
import {
  notificationSchema,
  unreadCountSchema,
  registerDeviceSchema,
  type RegisterDeviceDto,
} from "@mediaos/contracts";
import { apiFetch } from "./client";

/**
 * Notification API client for mobile — mirrors the NestJS NotificationsController routes.
 * All calls attach Bearer token. The server gates via RLS; the client never decides auth.
 */
export const notificationApi = {
  /** GET /notifications — inbox list; pass isRead=false to fetch only unread. */
  list: (isRead?: boolean) => {
    const qs = isRead !== undefined ? `?is_read=${String(isRead)}` : "";
    return apiFetch(`/notifications${qs}`, z.array(notificationSchema), { authenticated: true });
  },

  /** GET /notifications/unread-count */
  unreadCount: () =>
    apiFetch("/notifications/unread-count", unreadCountSchema, { authenticated: true }),

  /** PATCH /notifications/:id/read */
  markRead: (id: string) =>
    apiFetch(`/notifications/${id}/read`, notificationSchema, {
      authenticated: true,
      method: "PATCH",
    }),

  /** PATCH /notifications/read-all */
  markAllRead: () =>
    apiFetch("/notifications/read-all", z.unknown(), {
      authenticated: true,
      method: "PATCH",
    }),

  /**
   * POST /notifications/devices — register a push device token.
   * Idempotent: safe to call on every app launch.
   */
  registerDevice: (data: RegisterDeviceDto) =>
    apiFetch("/notifications/devices", z.unknown(), {
      authenticated: true,
      method: "POST",
      body: JSON.stringify(registerDeviceSchema.parse(data)),
    }),

  /**
   * DELETE /notifications/devices/:token — soft-delete (unregister) on logout.
   * Returns 204 No Content — no body to parse.
   */
  unregisterDevice: (token: string) =>
    apiFetch(`/notifications/devices/${encodeURIComponent(token)}`, z.unknown(), {
      authenticated: true,
      method: "DELETE",
    }),
};
