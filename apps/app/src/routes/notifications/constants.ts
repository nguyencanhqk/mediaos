/**
 * Hằng quyền + route module NOTI — S4-FE-NOTI-1.
 *
 * `NOTI_ENGINE_PAIRS` là cặp engine (action:resourceType) LITERAL — KHÔNG qua `PERMISSION_CODE_TO_PAIR`
 * (mirror att.shifts/hr.org-chart, tránh drift đã cắn ở S1-FND-MODULE). Nguồn sự thật DUY NHẤT: BE
 * `apps/api/src/notifications/notification-permissions.const.ts` (NOTIFICATION_PERMISSIONS) — CẢ 5 hành
 * động own-scope đều `resourceType:"notification"`, `is_sensitive:false`, grant Own cho employee/manager/
 * hr/company-admin (mig 0481 block 4b + mig 0483 cho `delete`). Route-level gate `NOTI.NOTIFICATION.VIEW_OWN`
 * (ROUTE_REGISTRY, đã map PERMISSION_CODE_TO_PAIR → "read:notification") KHÔNG đổi ở đây — page tự gate
 * TINH hơn bằng useCan(NOTI_ENGINE_PAIRS.*) cho từng nút hành động.
 */
export const NOTI_ENGINE_PAIRS = {
  READ: { action: "read", resourceType: "notification" },
  MARK_READ: { action: "mark_read", resourceType: "notification" },
  MARK_ALL_READ: { action: "mark_all_read", resourceType: "notification" },
  HIDE: { action: "hide", resourceType: "notification" },
  DELETE: { action: "delete", resourceType: "notification" },
  // S4-FE-NOTI-3 — Delivery logs viewer (UI-NOTI-SCREEN-006). Cặp seed THẬT mig 0481
  // (view:notification-delivery-log, is_sensitive=TRUE, grant company-admin scope Company) —
  // literal engine pair (KHÔNG qua PERMISSION_CODE_TO_PAIR, mirror READ/MARK_READ/…). Trang dùng
  // useCanExact (KHÔNG wildcard fallback) vì cặp is_sensitive=true.
  VIEW_DELIVERY_LOG: { action: "view", resourceType: "notification-delivery-log" },
} as const;

/** Trạng thái thông báo — khớp `myNotificationStatusSchema` (@mediaos/contracts). */
export const NOTI_STATUS = {
  UNREAD: "Unread",
  READ: "Read",
  HIDDEN: "Hidden",
  ARCHIVED: "Archived",
  DELETED: "Deleted",
  FAILED: "Failed",
} as const;

export type NotiStatus = (typeof NOTI_STATUS)[keyof typeof NOTI_STATUS];

/** Mức ưu tiên — khớp `myNotificationPrioritySchema`. */
export const NOTI_PRIORITY = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
  CRITICAL: "Critical",
} as const;

/** Routes trong module NOTI. */
export const NOTI_PATHS = {
  LIST: "/notifications",
  DETAIL: (id: string) => `/notifications/${id}`,
  EVENTS: "/notifications/events",
  // S4-FE-NOTI-3 — UI-NOTI-SCREEN-006 (docs/UI/UI-09 §12.3 + UI-04 §21 route bảng).
  DELIVERY_LOGS: "/notifications/delivery-logs",
} as const;

/** Mã màn hình (SPEC-01 §9) — S4-FE-NOTI-3. */
export const NOTI_SCREEN = {
  DELIVERY_LOGS: "NOTI-SCREEN-DELIVERY-LOGS",
} as const;

/**
 * S4-FE-NOTI-2 (UI-NOTI-SCREEN-004 / SPEC-08 §13.4 NOTI-SCREEN-005) — cặp engine ADMIN config, LITERAL
 * (KHÔNG qua PERMISSION_CODE_TO_PAIR — tránh drift, cùng kỹ thuật NOTI_ENGINE_PAIRS/att.shifts).
 * Nguồn sự thật: notification-admin.controller.ts (VIEW_NOTIFICATION_CONFIG/UPDATE_NOTIFICATION_CONFIG).
 * CẢ 2 is_sensitive=true (mig 0481) — grant Company CHỈ company-admin, đã ở SENSITIVE_CAPABILITY_ALLOWLIST
 * (permission.service.ts) nên /auth/me phơi đúng capability. Page PHẢI dùng useCanExact (KHÔNG useCan) —
 * wildcard '*:*' KHÔNG mở cổng cặp sensitive, mirror AttendanceRulesPage/RetentionPoliciesPage.
 */
export const NOTI_EVENT_ENGINE_PAIRS = {
  VIEW: { action: "view", resourceType: "notification-config" },
  UPDATE: { action: "update", resourceType: "notification-config" },
} as const;

/**
 * module_code hợp lệ cho filter danh mục event — khớp CHECK chk_notification_events_module_code (mig
 * 0479) / NotiModuleCode (apps/api notification-event-catalog.const.ts). Chỉ dùng để dựng dropdown lọc
 * UI; server tự validate độc lập (FE KHÔNG phải nguồn sự thật).
 */
export const NOTI_EVENT_MODULE_CODES = [
  "AUTH",
  "HR",
  "ATT",
  "LEAVE",
  "TASK",
  "DASH",
  "NOTI",
  "SYSTEM",
] as const;

/** per_page tối đa cho phép (khớp NOTI_ADMIN_PAGE_SIZE_MAX contracts) — catalog nhỏ (~53 event), 1 lần gọi đủ. */
export const NOTI_EVENT_PAGE_SIZE_MAX = 100;

/** Kích thước trang mặc định cho NotificationListPage — khớp MY_NOTIFICATION_PAGE_SIZE_DEFAULT (contracts). */
export const NOTI_LIST_PAGE_SIZE = 20;

/** Số dòng tối đa hiển thị trong dropdown chuông — khớp MY_NOTIFICATION_DROPDOWN_LIMIT_DEFAULT (contracts). */
export const NOTI_DROPDOWN_LIMIT = 10;

/**
 * Kích thước trang mặc định cho NotificationDeliveryLogsPage — khớp NOTI_ADMIN_PAGE_SIZE_DEFAULT
 * (@mediaos/contracts — notification-admin.ts, KHÔNG export nên pin lại giá trị ở đây; server vẫn
 * tự clamp [1..100] dù client gửi gì).
 */
export const NOTI_DELIVERY_LOG_PAGE_SIZE = 20;

/**
 * Kênh gửi — khớp CHECK `chk_notification_delivery_logs_channel` (apps/api/src/db/schema/noti.ts).
 * KHÔNG export ở @mediaos/contracts (contract query field chỉ z.string() tự do) → pin lại tại FE cho
 * <Select> filter, server vẫn tự validate CHECK dù client gửi giá trị khác.
 */
export const NOTI_DELIVERY_LOG_CHANNELS = [
  "IN_APP",
  "EMAIL",
  "PUSH",
  "REALTIME",
  "INTEGRATION",
] as const;

/**
 * Trạng thái gửi — khớp CHECK `chk_notification_delivery_logs_status` (apps/api/src/db/schema/noti.ts).
 */
export const NOTI_DELIVERY_LOG_STATUSES = [
  "Pending",
  "Sent",
  "Delivered",
  "Failed",
  "Skipped",
  "Cancelled",
] as const;
