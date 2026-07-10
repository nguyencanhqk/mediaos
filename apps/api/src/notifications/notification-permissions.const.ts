/**
 * S4-NOTI-BE-1 — SHARED catalog (action, resource_type) pairs cho My-Notification API (own-scope).
 *
 * NGUỒN SỰ THẬT DUY NHẤT cho cặp engine của My-Notification — controller import để gắn
 * @RequirePermission(action, resourceType), KHÔNG hard-code chuỗi rời rạc (tránh drift S1-FND-MODULE:
 * FE/BE lệch cặp engine — mirror leave-permissions.const.ts / attendance-permissions.const.ts).
 *
 * resource_type = 'notification' (KHÔNG kebab riêng) — TÁI DÙNG cặp catalog LEGACY có sẵn từ mig 0005
 * (create/read/update/delete:notification), tránh tạo bản sao mới gây drift. Grant Own-scope:
 *   read/mark_read/mark_all_read/hide → mig 0481 (block 4b, employee/manager/hr/company-admin).
 *   delete → mig 0483 (S4-NOTI-BE-1 pair-drift fix — 0481 GIỮ SÓT, xem 0483 header).
 */
export const NOTIFICATION_RESOURCE_TYPE = "notification" as const;

export interface NotificationPermissionPair {
  readonly action: string;
  readonly resourceType: typeof NOTIFICATION_RESOURCE_TYPE;
  /** is_sensitive trong catalog `permissions` — cả 5 cặp own-scope đều false (dữ liệu CỦA CHÍNH MÌNH). */
  readonly sensitive: boolean;
}

export const NOTIFICATION_PERMISSIONS: readonly NotificationPermissionPair[] = [
  { action: "read", resourceType: NOTIFICATION_RESOURCE_TYPE, sensitive: false },
  { action: "mark_read", resourceType: NOTIFICATION_RESOURCE_TYPE, sensitive: false },
  { action: "mark_all_read", resourceType: NOTIFICATION_RESOURCE_TYPE, sensitive: false },
  { action: "hide", resourceType: NOTIFICATION_RESOURCE_TYPE, sensitive: false },
  { action: "delete", resourceType: NOTIFICATION_RESOURCE_TYPE, sensitive: false },
] as const;

/** Resolve 1 cặp từ catalog THẬT — fail-fast (throw) nếu action không có trong danh sách trên. */
export function notificationPair(action: string): NotificationPermissionPair {
  const pair = NOTIFICATION_PERMISSIONS.find((p) => p.action === action);
  if (!pair) {
    throw new Error(
      `NOTIFICATION permission pair missing from catalog: ${action}:${NOTIFICATION_RESOURCE_TYPE}`,
    );
  }
  return pair;
}
