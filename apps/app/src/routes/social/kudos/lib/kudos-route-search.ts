/**
 * S16-SOCIAL-FE-2C — tham số URL của `/feed/kudos` (màn 009, plan D10).
 *
 * ┌─ 🔴 GIÁ TRỊ TỚI ĐÂY ĐÃ QUA `JSON.parse` (khuôn `group-route-search.ts`) ─────────────────────────┐
 * │ `?month=2026-09` tới đây là CHUỖI, nhưng `?month=202609` / `?month=9` là SỐ và `?page=2` là SỐ. │
 * │ `month` chỉ nhận CHUỖI qua `kudosMonthSchema` (số không bao giờ là tháng hợp lệ); `page` nhận cả  │
 * │ số lẫn chuỗi chữ số. Spec ăn ĐẦU RA parser thật, không object tay.                                 │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Mọi trường OPTIONAL, mặc định giải ở component (`month` vắng = tháng hiện tại giờ công ty) và KHÔNG
 * bao giờ ném — URL sửa tay thì mất bộ lọc, không mất trang. Optional để `<Link to="/feed/kudos">` không
 * phải truyền `search`.
 */
import { isKudosMonth } from "./kudos-month";

/** Trần `page` của `listKudosQuerySchema` (`FEED_PAGE_MAX`) — vượt là 400 từ server. */
const PAGE_MAX = 10_000;

export interface KudosRouteSearch {
  month?: string;
  page?: number;
}

function pageParam(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 2 && n <= PAGE_MAX ? n : undefined;
}

export function validateKudosRouteSearch(raw: Record<string, unknown>): KudosRouteSearch {
  const page = pageParam(raw.page);
  return {
    ...(isKudosMonth(raw.month) ? { month: raw.month } : {}),
    ...(page ? { page } : {}),
  };
}
