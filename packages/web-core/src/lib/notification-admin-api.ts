import { z } from "zod";
import {
  notificationEventAdminItemSchema,
  type NotificationEventAdminItem,
  type NotificationEventAdminQuery,
  type NotificationEventAdminPatch,
  notificationTemplateAdminItemSchema,
  type NotificationTemplateAdminItem,
  type NotificationTemplateAdminQuery,
  type NotificationTemplateAdminPatch,
  notificationDeliveryLogAdminItemSchema,
  type NotificationDeliveryLogAdminItem,
  type NotificationDeliveryLogAdminQuery,
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
// S4-FE-NOTI-4 (UI-NOTI-SCREEN-005/NOTI-SCREEN-006) — NOTI-API-303, S4-NOTI-BE-5 (GET /notifications/templates
// đã merge master #194) + BE-3/BE-4 (GET/PATCH /notifications/templates/:id). Permission: view/update:
// notification-template — CẢ 2 is_sensitive=true, đã ở SENSITIVE_CAPABILITY_ALLOWLIST (permission.service.ts).
const templateAdminListSchema = z.array(notificationTemplateAdminItemSchema);

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

  /**
   * GET /notifications/templates — danh mục template (company override ∪ global, merge "override
   * thắng global"). Filter event_id/event_code/channel/locale + phân trang in-memory (catalog nhỏ).
   * Permission: view:notification-template.
   */
  listTemplates: (
    query?: Partial<NotificationTemplateAdminQuery>,
  ): Promise<NotificationTemplateAdminItem[]> =>
    apiFetch(`/notifications/templates${buildQueryString(query ?? {})}`, templateAdminListSchema),

  /** GET /notifications/templates/:id — chi tiết 1 template (company override ∪ global). Permission: view:notification-template. */
  getTemplate: (id: string): Promise<NotificationTemplateAdminItem> =>
    apiFetch(`/notifications/templates/${id}`, notificationTemplateAdminItemSchema),

  /**
   * PATCH /notifications/templates/:id — sửa nội dung template (ghi company-override). Permission:
   * update:notification-template. BE trả 422 (NOTI-ERR-TEMPLATE-FORBIDDEN-VARIABLE) nếu field text chứa
   * biến placeholder nhạy cảm — message BE đã người-đọc (chỉ echo tên biến), client hiển thị nguyên văn
   * qua ApiError.message (KHÔNG tự suy diễn thêm).
   */
  updateTemplate: (
    id: string,
    body: NotificationTemplateAdminPatch,
  ): Promise<NotificationTemplateAdminItem> =>
    apiFetch(`/notifications/templates/${id}`, notificationTemplateAdminItemSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

/**
 * notificationDeliveryLogApi — S4-FE-NOTI-3. Ranh giới HTTP cho /notifications/delivery-logs
 * (NOTI-API-401, NotificationAdminController.listDeliveryLogs, S4-NOTI-BE-3) — VIEWER APPEND-ONLY.
 *
 * Permission (seed THẬT mig 0481): view:notification-delivery-log, is_sensitive=TRUE, grant
 * company-admin scope Company — FE dùng useCanExact (KHÔNG wildcard fallback, mirror BE fail-closed
 * cho cặp sensitive, cùng kỹ thuật hr.audit-logs/attendance view-team).
 *
 * BẤT BIẾN #2 (APPEND-ONLY): server chỉ có route GET (KHÔNG PATCH/DELETE cho delivery-logs) — module
 * này CHỈ export `list`, KHÔNG có create/update/remove. BẤT BIẾN #3 (masking do server):
 * notificationDeliveryLogAdminItemSchema là DTO WHITELIST của @mediaos/contracts — client CHỈ render
 * field server đã cho phép, KHÔNG tự suy field bị ẩn.
 *
 * Pagination: controller trả `paginated(rows, pagination)` — interceptor HOIST `pagination` lên top-level
 * envelope { success, data, error, pagination }, nhưng `apiFetch`/`unwrapEnvelope` CHỈ giữ field `data`
 * (mảng) — tổng số bản ghi KHÔNG khả dụng ở client (mirror fileAccessLogApi.list/myNotificationApi.list).
 * Trang dùng heuristic full-page ⇒ còn trang sau (AuthLogPagination).
 */
export type NotificationDeliveryLogListParams = Partial<
  Omit<NotificationDeliveryLogAdminQuery, "created_from" | "created_to">
> & {
  created_from?: string;
  created_to?: string;
};

export const notificationDeliveryLogApi = {
  /** GET /notifications/delivery-logs — masked + phân trang + filter channel/status/recipient/time. */
  list: (params?: NotificationDeliveryLogListParams): Promise<NotificationDeliveryLogAdminItem[]> =>
    apiFetch(
      `/notifications/delivery-logs${buildQueryString(params as Record<string, unknown>)}`,
      z.array(notificationDeliveryLogAdminItemSchema),
    ),
};

export type { NotificationDeliveryLogAdminItem, NotificationDeliveryLogAdminQuery };
