/**
 * Định dạng ngày/giờ/số/tiền theo locale tiếng Việt (port từ apps/web).
 *
 * Dùng `Intl` gốc (không thêm dependency). Hiển thị theo timezone công ty nếu có
 * context, fallback Asia/Ho_Chi_Minh (khớp `tz.util` ở API).
 */

export const VI_LOCALE = "vi-VN";
export const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Ngày: 14/06/2026 */
export function formatDate(value: DateInput, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat(VI_LOCALE, { dateStyle: "short", timeZone }).format(toDate(value));
}

/** Ngày + giờ: 14/06/2026 09:30 */
export function formatDateTime(value: DateInput, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat(VI_LOCALE, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  }).format(toDate(value));
}

/** Giờ: 09:30 */
export function formatTime(value: DateInput, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat(VI_LOCALE, { timeStyle: "short", timeZone }).format(toDate(value));
}

/** Số: 1.234,5 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(VI_LOCALE, options).format(value);
}

/** Tiền VND: 1.234.567 ₫ */
export function formatCurrency(value: number, currency = "VND"): string {
  return new Intl.NumberFormat(VI_LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}
