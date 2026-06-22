/**
 * FOUNDATION-BE-2 — formatter thuần-hàm sinh mã (BACKEND-04 §8.6). KHÔNG chạm DB ⇒ test được không cần
 * Postgres. Mã = prefix + datePattern(render theo tz công ty, UTC-at-rest qua TZDate/@date-fns/tz —
 * ADR-0008) + zero-pad(value, paddingLength) + suffix.
 *
 * BẤT BIẾN render:
 *   • datePattern dùng WALL-CLOCK của tz công ty: instant UTC được đọc thành year/month/day THEO tz (vd
 *     2026-01-31T18:00Z = 2026-02-01 ở VN ⇒ yyyyMM = 202602). Cùng nguồn tz duy nhất (tz.util) — KHÔNG
 *     tự new Date(...) local-machine (drift theo máy chạy).
 *   • value vượt paddingLength KHÔNG bị cắt — chỉ pad khi ngắn hơn (mã không bao giờ mất chữ số).
 *   • Hỗ trợ value bigint (current_value của counter là bigint — KHÔNG ép Number, tránh mất chính xác).
 */

import { TZDate } from "@date-fns/tz";
import type { BuildCodeInput, ResetPolicy } from "./sequence.types";

/** Tz mặc định khi company/settings chưa cấp nguồn tz (single-company N=1). TODO: đọc từ company settings. */
export const DEFAULT_TIME_ZONE = "Asia/Ho_Chi_Minh";

/**
 * Render datePattern theo wall-clock tz công ty. Token hỗ trợ (tối giản, đủ cho mã nghiệp vụ):
 *   yyyy (4 chữ số năm) · yy (2 chữ số năm) · MM (tháng 2 chữ số) · dd (ngày 2 chữ số).
 * Các ký tự khác (separator '-', '/', …) giữ nguyên. KHÔNG dùng date-fns `format` để tránh token tháng
 * 'mm' (phút) bị nhầm — bảng token tường minh, chỉ thay đúng 4 token này.
 */
function renderDatePattern(pattern: string, instant: Date, timeZone: string): string {
  const z = new TZDate(instant.getTime(), timeZone);
  const year = z.getFullYear();
  const month = z.getMonth() + 1;
  const day = z.getDate();
  const tokens: Record<string, string> = {
    yyyy: String(year).padStart(4, "0"),
    yy: String(year % 100).padStart(2, "0"),
    MM: String(month).padStart(2, "0"),
    dd: String(day).padStart(2, "0"),
  };
  // Thay token theo độ dài giảm dần (yyyy trước yy) để khớp tham lam đúng.
  return pattern.replace(/yyyy|yy|MM|dd/g, (t) => tokens[t] ?? t);
}

/** Zero-pad phần số. value vượt paddingLength KHÔNG bị cắt (chỉ pad khi ngắn hơn). Hỗ trợ bigint. */
function padValue(value: number | bigint, paddingLength: number): string {
  const raw = value.toString();
  return paddingLength > 0 ? raw.padStart(paddingLength, "0") : raw;
}

/**
 * Dựng mã từ một giá trị số đã biết (thuần-hàm). prefix + datePattern + zero-pad(value) + suffix.
 * `now` mặc định = thời điểm gọi; render datePattern theo `timeZone`.
 */
export function buildCode(input: BuildCodeInput): string {
  const { prefix, suffix, datePattern, paddingLength, value, timeZone } = input;
  const now = input.now ?? new Date();

  const datePart =
    datePattern && datePattern.length > 0 ? renderDatePattern(datePattern, now, timeZone) : "";
  const numberPart = padValue(value, paddingLength);

  return `${prefix ?? ""}${datePart}${numberPart}${suffix ?? ""}`;
}

/**
 * Khoá CHU KỲ reset cho một instant theo tz công ty. So 2 key khác nhau ⇒ đã sang kỳ mới ⇒ reset counter.
 *   Never   → 'NEVER'    (không bao giờ reset — cộng dồn mãi).
 *   Yearly  → 'yyyy'.
 *   Monthly → 'yyyyMM'.
 *   Daily   → 'yyyyMMdd'.
 * Dùng wall-clock tz công ty (UTC-at-rest) — biên kỳ tính theo giờ địa phương, KHÔNG theo UTC.
 */
export function resetPeriodKey(instant: Date, timeZone: string, resetPolicy: ResetPolicy): string {
  if (resetPolicy === "Never") return "NEVER";
  const z = new TZDate(instant.getTime(), timeZone);
  const yyyy = String(z.getFullYear()).padStart(4, "0");
  const MM = String(z.getMonth() + 1).padStart(2, "0");
  const dd = String(z.getDate()).padStart(2, "0");
  switch (resetPolicy) {
    case "Yearly":
      return yyyy;
    case "Monthly":
      return `${yyyy}${MM}`;
    case "Daily":
      return `${yyyy}${MM}${dd}`;
    default:
      return "NEVER";
  }
}
