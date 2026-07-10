import { z } from "zod";
import {
  myNotificationListItemSchema,
  myNotificationDropdownResponseSchema,
  myNotificationUnreadCountResponseSchema,
  myNotificationDetailSchema,
  myNotificationMarkReadResponseSchema,
  myNotificationMarkAllReadResponseSchema,
  type MyNotificationListItem,
  type MyNotificationListQuery,
  type MyNotificationDropdownQuery,
  type MyNotificationDropdownResponse,
  type MyNotificationUnreadCountResponse,
  type MyNotificationDetailQuery,
  type MyNotificationDetail,
  type MyNotificationMarkReadResponse,
  type MarkAllNotificationsReadRequest,
  type MyNotificationMarkAllReadResponse,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * My-Notification API client — S4-FE-NOTI-1. Tiêu thụ 7 route THẬT của MyNotificationsController
 * (apps/api/src/notifications/my-notifications.controller.ts, S4-NOTI-BE-1): GET /notifications ·
 * /notifications/dropdown · /notifications/unread-count · /notifications/:id · POST
 * /notifications/:id/mark-read · /notifications/mark-all-read · DELETE /notifications/:id.
 *
 * Own-scope TUYỆT ĐỐI (SPEC-08 §16.5.1): mọi endpoint chỉ trả thông báo của CHÍNH user hiện tại — server
 * khoá cứng recipient_user_id, client KHÔNG truyền/lọc theo user khác. company_id resolve từ auth
 * context — client KHÔNG tự truyền.
 *
 * `notificationApi` legacy G10-2 (./notification-api.ts) đã XOÁ HẲN ở S4-FE-NOTI-CLEANUP-1 — route cũ
 * (PATCH /notifications/:id/read + /read-all) bị gỡ khỏi NotificationsController ở PR #133, consumer cuối
 * (packages/ui NotificationBell) gỡ cùng đợt. Đây là API client NOTI duy nhất cho user hiện tại.
 *
 * Pagination: GET /notifications dùng cơ chế HOIST top-level (`paginated()` — API-01 §16.1), nhưng
 * `apiFetch`/`unwrapEnvelope` CHỈ trả field `data` (mảng), bỏ block `pagination` sibling (giới hạn đã biết,
 * mirror fileAccessLogApi.list / AuthLogPagination — "Total tổng KHÔNG khả dụng ở client"). List page dùng
 * heuristic full-page ⇒ còn trang sau, KHÔNG hiển thị tổng số trang chính xác.
 */
export const myNotificationApi = {
  /** GET /notifications — danh sách của tôi (phân trang + filter). Permission: read:notification (Own). */
  list: (query?: Partial<MyNotificationListQuery>): Promise<MyNotificationListItem[]> =>
    apiFetch(
      `/notifications${buildQueryString(query ?? {})}`,
      z.array(myNotificationListItemSchema),
    ),

  /**
   * GET /notifications/dropdown — latest N cho chuông header (KHÔNG load cả list).
   * Permission: read:notification (Own).
   */
  dropdown: (
    query?: Partial<MyNotificationDropdownQuery>,
  ): Promise<MyNotificationDropdownResponse> =>
    apiFetch(
      `/notifications/dropdown${buildQueryString(query ?? {})}`,
      myNotificationDropdownResponseSchema,
    ),

  /**
   * GET /notifications/unread-count — CHỈ đếm (partial index, không scan bảng). Dùng cho badge —
   * KHÔNG gọi list() chỉ để lấy số lượng. Permission: read:notification (Own).
   */
  unreadCount: (): Promise<MyNotificationUnreadCountResponse> =>
    apiFetch("/notifications/unread-count", myNotificationUnreadCountResponseSchema),

  /**
   * GET /notifications/:id — chi tiết 1 thông báo. `autoMarkRead=true` ⇒ server mark Read nếu đang Unread
   * (đọc = ngầm định đã xem, tránh round-trip mark-read riêng khi mở detail). Permission: read:notification (Own).
   */
  detail: (id: string, query?: Partial<MyNotificationDetailQuery>): Promise<MyNotificationDetail> =>
    apiFetch(`/notifications/${id}${buildQueryString(query ?? {})}`, myNotificationDetailSchema),

  /**
   * POST /notifications/:id/mark-read — idempotent (gọi lại trên thông báo đã Read không lỗi).
   * Permission: mark_read:notification (Own).
   */
  markRead: (id: string): Promise<MyNotificationMarkReadResponse> =>
    apiFetch(`/notifications/${id}/mark-read`, myNotificationMarkReadResponseSchema, {
      method: "POST",
    }),

  /**
   * POST /notifications/mark-all-read — filter tuỳ chọn (source_module/notification_type/created_before).
   * Permission: mark_all_read:notification (Own).
   */
  markAllRead: (
    body?: MarkAllNotificationsReadRequest,
  ): Promise<MyNotificationMarkAllReadResponse> =>
    apiFetch("/notifications/mark-all-read", myNotificationMarkAllReadResponseSchema, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  /**
   * DELETE /notifications/:id — soft-delete (BẤT BIẾN #2 — KHÔNG hard-delete; server ghi deleted_at).
   * Permission: delete:notification (Own). 204 No Content → z.void().
   */
  remove: (id: string): Promise<void> =>
    apiFetch(`/notifications/${id}`, z.void(), { method: "DELETE" }),
};
