/**
 * S16-SOCIAL-FE-3 (L2) — tham số URL của `/feed/moderation` (`SOC-SCREEN-010`) và MỌI phép suy từ chúng.
 *
 * Màn KHÔNG tự suy lại bất cứ thứ gì ở đây: đọc tab/bộ lọc đang chọn, dựng tham số gửi `028`, dựng search
 * kế tiếp khi đổi bộ lọc/trang/tab đều đi qua các hàm thuần của file này — để mỗi luật (mặc định không
 * ghi lên URL · «Tất cả» không gửi `status` · đổi bộ lọc về trang 1) có đúng MỘT chỗ và đo được không cần
 * render.
 *
 * ┌─ BA ĐIỀU DỄ SAI ───────────────────────────────────────────────────────────────────────────────┐
 * │ 1. Parser của TanStack Router là `parseSearchWith(JSON.parse)`: `?page=2` tới đây là SỐ 2,       │
 * │    `?status=1` là SỐ 1. Khuôn `typeof === "string"` chép từ `/feed` làm `page` không bao giờ đọc │
 * │    được. `page` nhận SỐ; `tab`/`status` so đúng-bằng với tập giá trị (số 1 tự rơi).              │
 * │ 2. «Bỏ» một khoá = trả nó với `undefined` TƯỜNG MINH. Router gộp `{ ...thô, ...đầuRa }`; khoá    │
 * │    vắng trong đầu ra thì giá trị THÔ sống sót và `useSearch` trả nó cho màn (bài học             │
 * │    `feed-route-search.ts`). Mọi hàm trả search ở đây LUÔN trả đủ ba khoá.                        │
 * │ 3. Không ném. `validateSearch` ném = màn lỗi thay cho hàng đợi chỉ vì URL sửa tay.               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import { FEED_PAGE_MAX, type ListFeedReportsQueryDto } from "@mediaos/contracts";

export const MODERATION_TABS = ["reports", "hidden"] as const;
export type ModerationTab = (typeof MODERATION_TABS)[number];

/**
 * Bộ lọc trạng thái của hàng đợi. Ba giá trị đầu = `feedReportStatusSchema`; `all` CHỈ của FE — nó
 * không phải giá trị `status` của 028 (gửi `status=all` là 400), xem `reportListParams`.
 */
export const MODERATION_STATUS_FILTERS = ["open", "resolved", "dismissed", "all"] as const;
export type ModerationStatusFilter = (typeof MODERATION_STATUS_FILTERS)[number];

/** Mặc định KHÔNG ghi lên URL (plan D10): vắng `tab` = hàng đợi báo cáo, vắng `status` = đang mở. */
export const DEFAULT_MODERATION_TAB: ModerationTab = "reports";
export const DEFAULT_MODERATION_STATUS: ModerationStatusFilter = "open";
export const MODERATION_REPORTS_PAGE_SIZE = 20;

const FIRST_PAGE = 1;

export interface ModerationRouteSearch {
  tab?: ModerationTab;
  status?: ModerationStatusFilter;
  /** Số nguyên trong `[2, FEED_PAGE_MAX]`. Trang 1 = vắng khoá. */
  page?: number;
}

/** Tham số gửi `028`. `status` VẮNG (không phải `undefined`) khi lọc «Tất cả». */
export type ReportListParams = Pick<ListFeedReportsQueryDto, "page" | "limit"> &
  Partial<Pick<ListFeedReportsQueryDto, "status">>;

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

/**
 * Trang ghi được lên URL: SỐ nguyên từ 2 tới trần trang của hợp đồng (vượt trần thì 028 trả 400 ⇒ màn
 * lỗi — bỏ để rơi về trang 1). Mọi thứ khác (trang 1 · chuỗi · số lẻ · âm) ⇒ `undefined`.
 */
function pageForUrl(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return value > FIRST_PAGE && value <= FEED_PAGE_MAX ? value : undefined;
}

/** `validateSearch` của route. Không ném; LUÔN trả đủ ba khoá (xem điều 2 ở docblock). */
export function validateModerationRouteSearch(raw: Record<string, unknown>): ModerationRouteSearch {
  return {
    tab: oneOf(MODERATION_TABS, raw.tab),
    status: oneOf(MODERATION_STATUS_FILTERS, raw.status),
    page: pageForUrl(raw.page),
  };
}

/**
 * Tab mà URL YÊU CẦU. ⚠️ Chưa xét quyền: thiếu `manage:feed-post` thì màn phải tự rơi về `reports` (tab
 * «Bài đang ẩn» không tồn tại với người đó) — luật quyền nằm ở màn (`useCan`), không ở hàm thuần này.
 */
export function activeModerationTab(search: ModerationRouteSearch): ModerationTab {
  return search.tab ?? DEFAULT_MODERATION_TAB;
}

export function activeStatusFilter(search: ModerationRouteSearch): ModerationStatusFilter {
  return search.status ?? DEFAULT_MODERATION_STATUS;
}

/**
 * Tham số gửi `028` (cũng là `params` của khoá cache `socialKeys.moderation.reports.list`).
 *
 * «Tất cả» ⇒ object KHÔNG có khoá `status`: với 028, vắng `status` = mọi trạng thái, còn `status=all`
 * là 400 (query `.strict()` + enum).
 */
export function reportListParams(search: ModerationRouteSearch): ReportListParams {
  const filter = activeStatusFilter(search);
  const paging = { page: search.page ?? FIRST_PAGE, limit: MODERATION_REPORTS_PAGE_SIZE };
  return filter === "all" ? paging : { status: filter, ...paging };
}

/** Search kế tiếp khi đổi bộ lọc trạng thái: về trang 1 (bỏ `page`); `open` là mặc định ⇒ không ghi. */
export function searchForStatusFilter(
  search: ModerationRouteSearch,
  status: ModerationStatusFilter,
): ModerationRouteSearch {
  return {
    tab: search.tab,
    status: status === DEFAULT_MODERATION_STATUS ? undefined : status,
    page: undefined,
  };
}

/** Search kế tiếp khi đổi trang: giữ bộ lọc; trang 1 (hoặc trang không hợp lệ) ⇒ không ghi `page`. */
export function searchForPage(search: ModerationRouteSearch, page: number): ModerationRouteSearch {
  return { tab: search.tab, status: search.status, page: pageForUrl(page) };
}

/**
 * Search kế tiếp khi đổi tab: `reports` là mặc định ⇒ không ghi. Bộ lọc + trang của hàng đợi được GIỮ để
 * quay lại tab «Báo cáo» thấy đúng chỗ đang xem.
 */
export function searchForTab(
  search: ModerationRouteSearch,
  tab: ModerationTab,
): ModerationRouteSearch {
  return {
    tab: tab === DEFAULT_MODERATION_TAB ? undefined : tab,
    status: search.status,
    page: search.page,
  };
}
