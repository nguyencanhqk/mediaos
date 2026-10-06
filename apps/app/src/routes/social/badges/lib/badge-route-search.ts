/**
 * S16-SOCIAL-FE-3B (L4) — tham số URL của `/feed/kudos-badges` (`SOC-SCREEN-012`) và tham số gửi `056`.
 *
 * Ba luật chép từ `moderation-route-search.ts` (đọc docblock ở đó trước khi sửa):
 *   1. Parser của TanStack Router là `parseSearchWith(JSON.parse)`: `?page=2` tới đây là SỐ 2. `page` chỉ
 *      nhận SỐ nguyên; chuỗi / mảng / boolean đều rơi.
 *   2. «Bỏ» một khoá = trả nó với `undefined` TƯỜNG MINH. Router gộp `{ ...thô, ...đầuRa }`; khoá vắng trong
 *      đầu ra thì giá trị THÔ sống sót và `useSearch` trả nó cho màn.
 *   3. Không ném. `validateSearch` ném = màn lỗi thay cho bảng huy hiệu chỉ vì URL sửa tay.
 */
import { FEED_PAGE_MAX, type ListKudosBadgesAdminQueryDto } from "@mediaos/contracts";

/** Cỡ trang của bảng — trùng mặc định của `056` ở server (plan D13). */
export const BADGES_PAGE_SIZE = 50;

const FIRST_PAGE = 1;

export interface BadgeRouteSearch {
  /** Số nguyên trong `[2, FEED_PAGE_MAX]`. Trang 1 = vắng khoá. */
  page?: number;
}

/** Tham số gửi `056` (cũng là `params` của khoá cache `socialKeys.kudos.badgesAdmin`). */
export type BadgeListParams = Pick<ListKudosBadgesAdminQueryDto, "page" | "limit">;

/**
 * Trang ghi được lên URL: SỐ nguyên từ 2 tới trần trang của hợp đồng (vượt trần thì 056 trả 400 ⇒ màn lỗi —
 * bỏ để rơi về trang 1). Mọi thứ khác ⇒ `undefined`.
 */
function pageForUrl(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return value > FIRST_PAGE && value <= FEED_PAGE_MAX ? value : undefined;
}

/** `validateSearch` của route. Không ném; LUÔN trả khoá `page` (xem luật 2). */
export function validateBadgeRouteSearch(raw: Record<string, unknown>): BadgeRouteSearch {
  return { page: pageForUrl(raw.page) };
}

export function badgeListParams(search: BadgeRouteSearch): BadgeListParams {
  return { page: search.page ?? FIRST_PAGE, limit: BADGES_PAGE_SIZE };
}

/** Search kế tiếp khi đổi trang: trang 1 (hoặc trang không hợp lệ) ⇒ không ghi `page`. */
export function searchForBadgePage(page: number): BadgeRouteSearch {
  return { page: pageForUrl(page) };
}
