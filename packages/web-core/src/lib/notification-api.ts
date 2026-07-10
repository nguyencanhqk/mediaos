import { z } from "zod";
import { notificationSchema, unreadCountSchema } from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Notification API — chuông thông báo là **chrome dùng chung** cho mọi app (FS-5). Typed-fetch thuần
 * qua `apiFetch` (Bearer + credentials:'include' + refresh-on-401 + envelope unwrap). Đặt ở web-core để
 * cả 4 app (web/studio/people/console) tiêu thụ qua `<NotificationBell/>` của @mediaos/ui mà không dup
 * notification-api ở từng app (bài học Wave 2: bell từng chỉ ở web/studio, vắng people/console).
 *
 * ⚠️ LEGACY/BROKEN (S4-FE-NOTI-CONSOLE-BELL-1, 2026-07): `markRead`/`markAllRead` gọi PATCH
 * `/notifications/:id/read` + `/notifications/read-all` — 2 route này đã bị GỠ khỏi BE ở PR #133
 * (mig 0483, `NotificationsController` chỉ còn devices/preferences). `list`/`unreadCount` cũng lệch
 * shape (camelCase `NotificationDto`) so với route thật hiện có. KHÔNG còn consumer nào trong app tree
 * (apps/console đã gỡ `<NotificationBell/>` — xem root-layout.tsx/home.tsx). KHÔNG dùng file này cho
 * code mới — dùng `myNotificationApi` (./my-notification-api.ts, 7 route thật của
 * `MyNotificationsController`, S4-NOTI-BE-1). Giữ file lại để không phá `export *` của
 * `packages/ui/notification-bell.tsx` (ngoài phạm vi lane console-bell) — chờ quyết định xoá hẳn.
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
