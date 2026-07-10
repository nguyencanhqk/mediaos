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
} as const;

/** Kích thước trang mặc định cho NotificationListPage — khớp MY_NOTIFICATION_PAGE_SIZE_DEFAULT (contracts). */
export const NOTI_LIST_PAGE_SIZE = 20;

/** Số dòng tối đa hiển thị trong dropdown chuông — khớp MY_NOTIFICATION_DROPDOWN_LIMIT_DEFAULT (contracts). */
export const NOTI_DROPDOWN_LIMIT = 10;
