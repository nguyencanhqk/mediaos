/**
 * S20-NOTI-LISTNAV-1 (US-X-13) — bộ lọc trang Thông báo (`/notifications`) sống trên URL.
 *
 * Tải lại, Back sau khi đóng drawer việc, hay gửi link đều ra CÙNG bộ lọc. Server vẫn khoá own-scope
 * (chỉ thông báo của chính người xem) — URL chỉ là bộ lọc, không phải quyền.
 *
 * Chỉ dùng tham số contract SẴN CÓ của `GET /notifications` (`myNotificationListQuerySchema`):
 * `source_module` · `priority` · `status` · `page`.
 *
 * 🔴 Giá trị tới đây đã qua `JSON.parse` của router (`?page=2` là SỐ) — bộ đọc nhận cả hai dạng.
 * KHÔNG BAO GIỜ NÉM: tham số rác ⇒ bỏ khoá đó, dùng mặc định (không màn lỗi, back/forward không vỡ).
 */
import { useCallback, useMemo } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  myNotificationPrioritySchema,
  type MarkAllNotificationsReadRequest,
  type MyNotificationListQuery,
  type MyNotificationPriority,
} from "@mediaos/contracts";

/** Chip nguồn — giá trị `source_module` (= `module_code` của danh mục sự kiện NOTI). */
export const NOTI_LIST_SOURCES = ["TASK", "CHAT", "GOAL", "LEAVE"] as const;
export type NotiListSource = (typeof NOTI_LIST_SOURCES)[number];

export const NOTI_LIST_PRIORITIES = myNotificationPrioritySchema.options;

/** Trạng thái lọc được từ trang danh sách (giữ như bộ chọn cũ: tất cả · chỉ chưa đọc). */
const UNREAD = "Unread";

/** Trần trang — chặn offset khổng lồ từ URL sửa tay. */
const PAGE_MAX = 10_000;

export interface NotificationListSearch {
  source?: NotiListSource;
  priority?: MyNotificationPriority;
  status?: typeof UNREAD;
  page?: number;
}

/** Các khoá bộ lọc (không gồm `page`) — «Bỏ lọc» bỏ hết chúng. */
const FILTER_KEYS = [
  "source",
  "priority",
  "status",
] as const satisfies readonly (keyof NotificationListSearch)[];

type SearchRecord = Record<string, unknown>;

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function pageParam(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isInteger(n) && n >= 2 && n <= PAGE_MAX ? n : undefined;
}

/** `validateSearch` của route `/notifications` — rác ⇒ bỏ khoá đó, không ném. */
export function validateNotificationListSearch(raw: SearchRecord): NotificationListSearch {
  const entries: [keyof NotificationListSearch, unknown][] = [
    ["source", oneOf(raw.source, NOTI_LIST_SOURCES)],
    ["priority", oneOf(raw.priority, NOTI_LIST_PRIORITIES)],
    ["status", oneOf(raw.status, [UNREAD] as const)],
    ["page", pageParam(raw.page)],
  ];
  return Object.fromEntries(
    entries.filter(([, value]) => value !== undefined),
  ) as NotificationListSearch;
}

export function hasActiveNotificationListFilters(search: NotificationListSearch): boolean {
  return FILTER_KEYS.some((key) => search[key] !== undefined);
}

/** Bộ lọc URL ⇒ query `GET /notifications` (NOTI-API-001). */
export function toNotificationListQuery(
  search: NotificationListSearch,
  pageSize: number,
): Partial<MyNotificationListQuery> {
  return {
    page: search.page ?? 1,
    per_page: pageSize,
    ...(search.source ? { source_module: search.source } : {}),
    ...(search.priority ? { priority: search.priority } : {}),
    ...(search.status ? { status: search.status } : {}),
  };
}

/**
 * Áp thay đổi bộ lọc lên search HIỆN TẠI của URL (giữ tham số khác, vd `task` của drawer việc).
 * undefined ⇒ bỏ khoá. Đổi bộ lọc ⇒ về trang 1 (bỏ `page`) trừ khi patch đặt `page`.
 */
export function patchNotificationListSearch(
  prev: SearchRecord,
  patch: Partial<NotificationListSearch>,
): SearchRecord {
  const next: SearchRecord = Object.fromEntries(
    Object.entries(prev ?? {}).filter(([key]) => key !== "page" && !(key in patch)),
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}

/** «Bỏ lọc»: bỏ mọi khoá bộ lọc + `page`, giữ tham số khác. */
export function clearNotificationListFilters(prev: SearchRecord): SearchRecord {
  const drop = new Set<string>([...FILTER_KEYS, "page"]);
  return Object.fromEntries(Object.entries(prev ?? {}).filter(([key]) => !drop.has(key)));
}

/**
 * Phạm vi «đánh dấu đã đọc» (S20-NOTI-PRIORITYFILTER-1): `POST /notifications/mark-all-read` nhận cả
 * `source_module` lẫn `priority` (+ `created_before`) ⇒ mọi bộ lọc đều đánh dấu được trong MỘT lời gọi.
 *  - `all`    — không lọc nguồn/mức: đánh dấu mọi thông báo chưa đọc (như cũ).
 *  - `filter` — có lọc nguồn và/hoặc mức: gửi đúng bộ lọc (`notificationMarkAllBody`).
 * `status` không đổi phạm vi: endpoint vốn chỉ đổi thông báo đang chưa đọc.
 */
export type NotificationMarkAllScope = "all" | "filter";

export function notificationMarkAllScope(search: NotificationListSearch): NotificationMarkAllScope {
  return search.source || search.priority ? "filter" : "all";
}

/**
 * Body mark-all-read theo bộ lọc URL. `createdBefore` = mốc thời điểm TẢI danh sách: thông báo đến SAU
 * mốc (chưa hiện cho người dùng) không bị đánh dấu nhầm. Mốc theo đồng hồ client (độ lệch đồng hồ ⇒ nợ).
 */
export function notificationMarkAllBody(
  search: NotificationListSearch,
  createdBefore: Date,
): MarkAllNotificationsReadRequest {
  return {
    ...(search.source ? { source_module: search.source } : {}),
    ...(search.priority ? { priority: search.priority } : {}),
    created_before: createdBefore,
  };
}

/**
 * Bộ lọc ĐỌC/GHI trên URL (không `useState`) — đọc `location.search` qua CÙNG hàm validate mà route
 * khai báo; ghi bằng `navigate({ to: "." })` (PUSH: Back hoàn tác) giữ tham số khác.
 */
export function useNotificationListSearch() {
  const navigate = useNavigate();
  const raw = useRouterState({ select: (s) => s.location.search });
  const search = useMemo(() => validateNotificationListSearch((raw ?? {}) as SearchRecord), [raw]);
  const go = useCallback(
    (next: (prev: SearchRecord) => SearchRecord) =>
      void navigate({ to: ".", search: next as never, resetScroll: false }),
    [navigate],
  );
  const update = useCallback(
    (patch: Partial<NotificationListSearch>) =>
      go((prev) => patchNotificationListSearch(prev, patch)),
    [go],
  );
  const clearFilters = useCallback(() => go(clearNotificationListFilters), [go]);
  return { search, update, clearFilters };
}
