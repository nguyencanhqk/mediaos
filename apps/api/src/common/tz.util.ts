/**
 * Tiện ích timezone cho chấm công/nghỉ phép (ADR-0008: UTC-at-rest, render theo IANA tz).
 *
 * GX-7: ruột render/parts dùng `@date-fns/tz` `TZDate` (date-fns v4) — ADR-0008 ratified. TZDate đọc
 * year/month/day/hour/min/sec theo IANA tz, byte-identical với Intl trên lưới VN + DST tz (xem
 * tz.util.spec.ts parity grid). KHÔNG đổi chữ ký public — attendance/payroll/dashboard (G11/G12/G14)
 * phụ thuộc shape trả về.
 *
 * GIẢI DST gap/overlap — `wallTimeToInstant`: GIỮ two-pass monotonic resolver (KHÔNG dùng raw
 * `new TZDate(y,mo,d,…)` constructor). Lý do: constructor TZDate giải GAP-day (giờ không tồn tại) bằng
 * pre-transition offset → lệch 1 giờ so với two-pass đã ship (G11/G12/G14 dựa vào). Lệch 1 giờ ở biên
 * = sai lương. VN không DST nên cả hai trùng; nhưng SaaS multi-tz phải nhất quán → khoá canonical =
 * two-pass (xem ADR-0008 §"Giải DST"). Resolver luôn trả 1 instant ổn định, KHÔNG ném/NaN ở biên.
 *
 * Quy ước: "instant" = Date (UTC). "wall-clock" = chuỗi 'YYYY-MM-DD' + 'HH:MM[:SS]' theo tz.
 */

import { TZDate } from "@date-fns/tz";

const MINUTE_MS = 60_000;

/** Ném RangeError nếu tz không phải IANA hợp lệ — validate ở ranh giới (tạo/sửa ca làm, đổi tz công ty). */
export function assertValidTimezone(timeZone: string): void {
  // Constructor Intl ném RangeError cho tz rác — đây chính là phép kiểm tra (đồng nhất với ICU mà
  // TZDate cũng dùng). Một nguồn validate duy nhất ở biên create/update.
  new Intl.DateTimeFormat("en-US", { timeZone });
}

/** Đọc các thành phần wall-clock của một instant theo tz qua TZDate (date-fns v4). */
function formatPartsInTz(instant: Date, timeZone: string): Record<string, number> {
  const z = new TZDate(instant.getTime(), timeZone);
  // TZDate trả 0..23 cho giờ (không có biên 24 như vài ICU version) → không cần chuẩn hoá 24→0.
  return {
    year: z.getFullYear(),
    month: z.getMonth() + 1,
    day: z.getDate(),
    hour: z.getHours(),
    minute: z.getMinutes(),
    second: z.getSeconds(),
  };
}

/** Ngày LOCAL 'YYYY-MM-DD' của một instant theo tz. */
export function localDateOf(instant: Date, timeZone: string): string {
  const p = formatPartsInTz(instant, timeZone);
  const mm = String(p["month"]).padStart(2, "0");
  const dd = String(p["day"]).padStart(2, "0");
  return `${p["year"]}-${mm}-${dd}`;
}

/** Thứ ISO (1=Thứ 2 … 7=Chủ nhật) của một instant theo tz. */
export function localWeekdayOf(instant: Date, timeZone: string): number {
  const [y, m, d] = localDateOf(instant, timeZone).split("-").map(Number);
  const utcDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=CN
  return utcDay === 0 ? 7 : utcDay;
}

/** 'YYYY-MM' của một ngày local 'YYYY-MM-DD'. */
export function monthOfDate(localDate: string): string {
  return localDate.slice(0, 7);
}

/** Offset (ms) wall-clock − UTC của tz tại instant đó (DST-aware). */
function tzOffsetMsAt(instant: Date, timeZone: string): number {
  const p = formatPartsInTz(instant, timeZone);
  const asUtc = Date.UTC(
    p["year"],
    p["month"] - 1,
    p["day"],
    p["hour"],
    p["minute"],
    p["second"],
  );
  return asUtc - instant.getTime();
}

/**
 * Đổi wall-clock (localDate 'YYYY-MM-DD' + time 'HH:MM[:SS]' theo tz) → instant UTC.
 *
 * Two-pass monotonic qua offset thật của tz (CANONICAL, ADR-0008): pass 1 đoán bằng offset tại
 * wall-as-UTC; pass 2 đọc lại offset tại đáp án đoán rồi hiệu chỉnh. Đúng cả ngày chuyển DST:
 *   - GAP (giờ không tồn tại, vd NY 2024-03-10 02:30): rơi về offset sau-chuyển (EDT) → 1 instant ổn định.
 *   - OVERLAP (giờ lặp, vd NY 2024-11-03 01:30): chọn lần đầu (pre-transition, EDT) → ổn định, không ném.
 * KHÔNG dùng raw `new TZDate(y,mo,d,h,mi,s,tz)` vì nó giải GAP bằng pre-transition offset (lệch 1 giờ).
 */
export function wallTimeToInstant(localDate: string, time: string, timeZone: string): Date {
  const [y, mo, d] = localDate.split("-").map(Number);
  const [h, mi, s] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi ?? 0, s ?? 0);
  const guess = wallAsUtc - tzOffsetMsAt(new Date(wallAsUtc), timeZone);
  const corrected = wallAsUtc - tzOffsetMsAt(new Date(guess), timeZone);
  return new Date(corrected);
}

/** Số phút nguyên từ a → b (dương khi b sau a), làm tròn xuống. */
export function minutesBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / MINUTE_MS);
}

/** Cộng n ngày vào ngày local 'YYYY-MM-DD' (số học lịch thuần, không tz). */
export function addDaysToLocalDate(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** Thứ ISO (1..7) của một ngày local 'YYYY-MM-DD' (không phụ thuộc tz). */
export function weekdayOfLocalDate(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  const utcDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

/** [from, toExclusive) cho 1 tháng 'YYYY-MM' — dùng lọc work_date kiểu date. */
export function monthDateRange(periodMonth: string): { from: string; toExclusive: string } {
  const [y, m] = periodMonth.split("-").map(Number);
  const from = `${periodMonth}-01`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from, toExclusive: `${next}-01` };
}
