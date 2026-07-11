import { z } from "zod";
import {
  notificationEventAdminItemSchema,
  type NotificationEventAdminItem,
  type NotificationEventAdminQuery,
  type NotificationEventAdminPatch,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * Notification ADMIN config API client — S4-FE-NOTI-2 (UI-NOTI-SCREEN-004 / SPEC-08 §13.4
 * NOTI-SCREEN-005 "Quản lý loại thông báo"). Tiêu thụ 2 route THẬT của NotificationAdminController
 * (apps/api/src/notifications/notification-admin.controller.ts, S4-NOTI-BE-3/BE-4):
 *   GET /notifications/events (NOTI-API-301) · PATCH /notifications/events/:id (NOTI-API-302).
 *
 * Permission: view:notification-config (đọc) · update:notification-config (bật/tắt) — CẢ 2 cặp
 * is_sensitive=true, đã ở SENSITIVE_CAPABILITY_ALLOWLIST (permission.service.ts) nên /auth/me phơi
 * đúng capability cho company-admin. FE gate bằng useCanExact (KHÔNG useCan — wildcard '*:*' KHÔNG
 * mở cổng cặp sensitive, mirror AttendanceRulesPage/RetentionPoliciesPage).
 *
 * Catalog nhỏ (~53 event, NOTI_EVENT_COUNT) — BE phân trang in-memory nhưng FE gọi 1 lần với
 * per_page tối đa (NOTI_ADMIN_PAGE_SIZE_MAX=100, đủ chứa toàn bộ catalog hiện tại + dư), lọc/paginate
 * CLIENT-SIDE qua DataTable (mirror PermissionsPage — danh mục nhỏ, KHÔNG cần AuthLogPagination
 * server-side heuristic). PATCH luôn ghi company-override (company_id=GUC), KHÔNG bao giờ sửa hàng
 * global — server tự xử lý, client chỉ gửi { is_enabled }.
 *
 * BẤT BIẾN: company_id do SERVER resolve từ auth context — client KHÔNG gửi/forward. Masking là việc
 * của SERVER — client chỉ render field nhận được.
 */
const eventAdminListSchema = z.array(notificationEventAdminItemSchema);

export const notificationAdminApi = {
  /** GET /notifications/events — danh mục event (company override ∪ global). Permission: view:notification-config. */
  listEvents: (
    query?: Partial<NotificationEventAdminQuery>,
  ): Promise<NotificationEventAdminItem[]> =>
    apiFetch(`/notifications/events${buildQueryString(query ?? {})}`, eventAdminListSchema),

  /**
   * PATCH /notifications/events/:id — bật/tắt 1 event (ghi company-override). Permission:
   * update:notification-config.
   */
  updateEvent: (
    id: string,
    body: NotificationEventAdminPatch,
  ): Promise<NotificationEventAdminItem> =>
    apiFetch(`/notifications/events/${id}`, notificationEventAdminItemSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
