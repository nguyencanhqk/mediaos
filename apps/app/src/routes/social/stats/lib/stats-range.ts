/**
 * S16-SOCIAL-FE-3B (L5) — khoảng tuần của màn Thống kê tương tác (plan D12).
 *
 * ┌─ 🔴 SỐ HỌC TRÊN CHUỖI NGÀY, KHÔNG `new Date(chuỗi)` RỒI ĐỌC THEO GIỜ MÁY ─────────────────────────────┐
 * │ Tuần của 052 là tuần ISO (thứ Hai → Chủ nhật) theo MÚI GIỜ CÔNG TY, và `range` server trả là NGÀY     │
 * │ LỊCH. `new Date("2026-09-28")` là nửa đêm UTC: đọc lại bằng getter local trên máy ở múi âm ra ngày    │
 * │ 27 — lệch cả một tuần. Mọi phép dịch ở đây đi qua mốc `Date.UTC` + `toISOString` (không getter local) │
 * │ nên kết quả không phụ thuộc múi giờ của máy.                                                          │
 * │ Chỗ DUY NHẤT đọc đồng hồ là `currentWeekEnd`, và nó đọc «hôm nay» theo `companyTimeZone()` (tiền lệ   │
 * │ `kudos/lib/kudos-month.ts`): 00:30 thứ Hai giờ VN vẫn là Chủ nhật theo UTC — tính theo UTC thì nút ›  │
 * │ khoá sớm một tuần.                                                                                    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Mọi khoảng trả ra đều đã qua `feedEngagementQuerySchema` ⇒ không có đường nào sinh tham số chắc chắn 400;
 * không sinh được thì trả `null` và nơi gọi khoá nút tương ứng.
 */
import {
  FEED_ENGAGEMENT_DEFAULT_WEEKS,
  feedEngagementQuerySchema,
  snapToIsoWeeks,
} from "@mediaos/contracts";
import { companyTimeZone, localDateOf } from "@/routes/rooms/room-time";
import type { StatsDateRange } from "./stats-route-search";

/** Các lựa chọn của ô «Số tuần» (plan D12). 26 = trần của hợp đồng (`FEED_ENGAGEMENT_MAX_WEEKS`). */
export const STATS_WEEK_OPTIONS: readonly number[] = [4, 8, 12, 26];

/** Khoảng mà 052 trả ở `range`: đã nắn về thứ Hai → Chủ nhật, kèm số tuần. */
export interface StatsRange extends StatsDateRange {
  weeks: number;
}

export type StatsShiftDirection = "back" | "forward";

const DAYS_PER_WEEK = 7;
const DAY_MS = 86_400_000;
const ISO_DATE_LENGTH = 10;

/** Mốc UTC nửa đêm của một ngày lịch HỢP LỆ, hoặc `null` (sai dạng · ngày không tồn tại · ngoài miền năm). */
function utcMidnightOf(date: string): number | null {
  if (!feedEngagementQuerySchema.safeParse({ from: date, to: date }).success) return null;
  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  return Date.UTC(year, month - 1, day);
}

/** Dịch một ngày lịch đi `days` ngày (âm = lùi). Đầu vào không hợp lệ ⇒ `null`. */
export function shiftIsoDate(date: string, days: number): string | null {
  const start = utcMidnightOf(date);
  if (start === null || !Number.isInteger(days)) return null;
  return new Date(start + days * DAY_MS).toISOString().slice(0, ISO_DATE_LENGTH);
}

/** Khoảng đã qua schema của 052 (đầu là thứ Hai, cuối là Chủ nhật, ≤ 26 tuần), hoặc `null`. */
function validRange(from: string | null, to: string | null): StatsDateRange | null {
  if (from === null || to === null) return null;
  const parsed = feedEngagementQuerySchema.safeParse({ from, to });
  if (!parsed.success) return null;
  const { from: snappedFrom, to: snappedTo } = parsed.data;
  return snappedFrom !== undefined && snappedTo !== undefined
    ? { from: snappedFrom, to: snappedTo }
    : null;
}

/** Khoảng `weeks` tuần kết thúc ở `to`. */
function rangeEndingAt(to: string, weeks: number): StatsDateRange | null {
  return validRange(shiftIsoDate(to, 1 - weeks * DAYS_PER_WEEK), to);
}

/**
 * Chủ nhật của tuần hiện tại theo giờ CÔNG TY. Tính lại mỗi lần gọi (không memo) — tab mở qua nửa đêm Chủ
 * nhật tự sang tuần mới.
 */
export function currentWeekEnd(now: Date = new Date()): string {
  const today = localDateOf(now, companyTimeZone());
  return snapToIsoWeeks(today, today)?.to ?? today;
}

/** Còn tiến được không: khoảng đang xem kết thúc TRƯỚC Chủ nhật tuần hiện tại. So chuỗi ISO = so ngày. */
export function canShiftForward(range: StatsRange, now: Date = new Date()): boolean {
  return range.to < currentWeekEnd(now);
}

/**
 * Khoảng kế tiếp khi bấm ‹ / ›: dịch đúng `range.weeks` tuần. Tiến mà vượt tuần hiện tại ⇒ dừng ở tuần hiện
 * tại, GIỮ số tuần. `null` = không dịch được (đang ở tuần hiện tại · ra ngoài miền ngày của hợp đồng).
 */
export function shiftRange(
  range: StatsRange,
  direction: StatsShiftDirection,
  now: Date = new Date(),
): StatsDateRange | null {
  const days = range.weeks * DAYS_PER_WEEK;
  if (direction === "back") {
    return validRange(shiftIsoDate(range.from, -days), shiftIsoDate(range.to, -days));
  }
  const limit = currentWeekEnd(now);
  if (range.to >= limit) return null;
  const shiftedTo = shiftIsoDate(range.to, days);
  if (shiftedTo === null) return null;
  return rangeEndingAt(shiftedTo > limit ? limit : shiftedTo, range.weeks);
}

/** Khoảng khi đổi số tuần: GIỮ ngày kết thúc đang xem. Số tuần không hợp lệ (≤ 0 · lẻ · > 26) ⇒ `null`. */
export function rangeForWeeks(range: StatsRange, weeks: number): StatsDateRange | null {
  if (!Number.isInteger(weeks) || weeks <= 0) return null;
  return rangeEndingAt(range.to, weeks);
}

/**
 * Khoảng để GHI LÊN URL: khoảng trùng đúng mặc định của server (8 tuần tới hết tuần hiện tại) ⇒ `null`, tức
 * không ghi — URL mặc định luôn là «hiện tại», kể cả khi mở lại sau một tuần.
 */
export function asUrlRange(
  range: StatsDateRange | null,
  now: Date = new Date(),
): StatsDateRange | null {
  if (range === null) return null;
  const fallback = rangeEndingAt(currentWeekEnd(now), FEED_ENGAGEMENT_DEFAULT_WEEKS);
  const isDefault = fallback !== null && fallback.from === range.from && fallback.to === range.to;
  return isDefault ? null : range;
}

/** Chủ nhật của tuần bắt đầu ở `weekStart` (thứ Hai). */
export function weekEndOf(weekStart: string): string | null {
  return shiftIsoDate(weekStart, DAYS_PER_WEEK - 1);
}

/** `YYYY-MM-DD` ⇒ `DD/MM/YYYY` bằng cắt chuỗi (không qua `Date`). Chuỗi sai dạng trả nguyên văn. */
export function formatStatsDate(date: string): string {
  const [year, month, day, ...rest] = date.split("-");
  if (year === undefined || month === undefined || day === undefined || rest.length > 0) {
    return date;
  }
  return `${day}/${month}/${year}`;
}
