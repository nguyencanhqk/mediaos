import type {
  MyNotificationDetail,
  MyNotificationDropdownItem,
  MyNotificationListItem,
  MyNotificationPriority,
  MyNotificationStatus,
} from "@mediaos/contracts";

/**
 * 1 hàng `notifications` (cột MỚI — S4-NOTI-DB-1 mig 0479) cần cho My-Notification API. Pure mapping —
 * không I/O, không DI (dễ unit-test, giữ my-notifications.repository.ts/service.ts gọn dưới 800 dòng).
 */
export interface MyNotificationRow {
  id: string;
  title: string | null;
  body: string;
  shortBody: string | null;
  notificationType: string | null;
  priority: string | null;
  status: string | null;
  isRead: boolean;
  moduleCode: string | null;
  eventCode: string | null;
  targetModule: string | null;
  targetType: string | null;
  targetId: string | null;
  targetUrl: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
  readAt: Date | null;
}

/**
 * `status`/`priority`/`title`/`short_body` NULLABLE (additive S4-NOTI-DB-1) — hàng cũ (trước khi create-flow
 * ghi đủ 2 bộ cột) có thể thiếu. Fallback tính từ cột legacy `is_read`/`body` để KHÔNG vỡ Zod parse ở phía
 * ĐỌC (WO note: "mọi INSERT/UPDATE phải xử lý cả hai" — đây là khoan dung dữ liệu cũ khi đọc).
 */
export function effectiveStatus(
  row: Pick<MyNotificationRow, "status" | "isRead">,
): MyNotificationStatus {
  if (row.status) return row.status as MyNotificationStatus;
  return row.isRead ? "Read" : "Unread";
}

export function effectivePriority(
  row: Pick<MyNotificationRow, "priority">,
): MyNotificationPriority {
  return (row.priority as MyNotificationPriority | null) ?? "Normal";
}

export function effectiveTitle(row: Pick<MyNotificationRow, "title" | "body">): string {
  const t = row.title?.trim();
  return t ? t : row.body.slice(0, 120);
}

export function effectiveShortContent(row: Pick<MyNotificationRow, "shortBody" | "body">): string {
  const s = row.shortBody?.trim();
  return s ? s : row.body.slice(0, 140);
}

export function toListItem(row: MyNotificationRow): MyNotificationListItem {
  return {
    notification_id: row.id,
    title: effectiveTitle(row),
    short_content: effectiveShortContent(row),
    notification_type: row.notificationType,
    priority: effectivePriority(row),
    status: effectiveStatus(row),
    is_read: row.isRead,
    source_module: row.moduleCode,
    event_code: row.eventCode,
    target_module: row.targetModule,
    target_type: row.targetType,
    target_id: row.targetId,
    target_url: row.targetUrl,
    created_at: row.createdAt.toISOString(),
    read_at: row.readAt ? row.readAt.toISOString() : null,
  };
}

export function toDropdownItem(row: MyNotificationRow): MyNotificationDropdownItem {
  return {
    notification_id: row.id,
    title: effectiveTitle(row),
    short_content: effectiveShortContent(row),
    notification_type: row.notificationType,
    priority: effectivePriority(row),
    status: effectiveStatus(row),
    is_read: row.isRead,
    target_url: row.targetUrl,
    created_at: row.createdAt.toISOString(),
  };
}

export function toDetail(row: MyNotificationRow): MyNotificationDetail {
  return {
    notification_id: row.id,
    title: effectiveTitle(row),
    content: row.body,
    short_content: effectiveShortContent(row),
    notification_type: row.notificationType,
    priority: effectivePriority(row),
    status: effectiveStatus(row),
    is_read: row.isRead,
    source_module: row.moduleCode,
    event_code: row.eventCode,
    target: {
      target_module: row.targetModule,
      target_type: row.targetType,
      target_id: row.targetId,
      target_url: row.targetUrl,
    },
    payload: row.payload,
    created_at: row.createdAt.toISOString(),
    read_at: row.readAt ? row.readAt.toISOString() : null,
  };
}
