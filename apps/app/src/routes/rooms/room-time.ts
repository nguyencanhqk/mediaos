/**
 * S11-ROOM-FE-1 — thời gian của lịch phòng: UTC-at-rest ↔ wall-clock theo múi CÔNG TY (ADR-0008).
 *
 * Quy ước: "instant" = `Date` (UTC), "wall-clock" = `YYYY-MM-DD` + giờ/phút theo IANA tz. Dùng
 * `new Date(y, m, d)` của trình duyệt cho lưới lịch là đọc múi giờ CỦA MÁY người dùng — một người mở
 * app từ Singapore sẽ thấy lưới lệch cột so với đồng nghiệp ngồi cạnh, và khung giờ họ kéo chọn gửi lên
 * server sẽ lệch đúng chừng ấy.
 *
 * S20-FE-COMPANYTZ-1 — `companyTimeZone()` và các phép quy đổi nền (`partsIn` · `localDateOf` ·
 * `localTimeOf` · `addDaysToLocalDate` · `wallTimeToInstant`) đã chuyển lên `@mediaos/web-core`
 * (`lib/company-time.ts`) để TASK · GOAL dùng chung; file này RE-EXPORT nguyên tên ⇒ ROOM · SOCIAL stats
 * · kudos không phải sửa import (và `vi.mock` của module này vẫn ghim được `companyTimeZone`).
 *
 * Hàm thuần, KHÔNG đụng react — spec neo được biên DST/tháng mà không dựng DOM.
 */
import { addDaysToLocalDate, wallTimeToInstant } from "@mediaos/web-core";

export {
  companyTimeZone,
  partsIn,
  localDateOf,
  localTimeOf,
  addDaysToLocalDate,
  wallTimeToInstant,
  type LocalParts,
} from "@mediaos/web-core";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Ngày local của đầu TUẦN chứa `localDate`, tuần bắt đầu THỨ HAI (vi-VN — SPEC-01 i18n).
 * Thuần chuỗi: `Date.UTC` chỉ dùng để lấy thứ trong tuần, không dính tz.
 */
export function startOfWeekLocalDate(localDate: string): string {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=CN
  const backToMonday = dow === 0 ? 6 : dow - 1;
  return addDaysToLocalDate(localDate, -backToMonday);
}

/** Danh sách `n` ngày local liên tiếp kể từ `startLocalDate`. */
export function localDateRange(startLocalDate: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(addDaysToLocalDate(startLocalDate, i));
  return out;
}

/**
 * Cửa sổ `[from, to)` (instant) phủ trọn `days` ngày local kể từ `startLocalDate` theo tz.
 * `to` = 00:00 của ngày SAU ngày cuối — nửa mở, khớp hợp đồng BE (SPEC-14 §12).
 */
export function windowOfLocalDays(
  startLocalDate: string,
  days: number,
  timeZone: string,
): { from: Date; to: Date } {
  return {
    from: wallTimeToInstant(startLocalDate, "00:00", timeZone),
    to: wallTimeToInstant(addDaysToLocalDate(startLocalDate, days), "00:00", timeZone),
  };
}

// ── Đặt lượt lên lưới ────────────────────────────────────────────────────────────────────────────

/** Vị trí của một lượt trên cột một-ngày, tính bằng PHẦN TRĂM chiều cao khung giờ đang vẽ. */
export interface GridPlacement {
  /** % từ đỉnh khung. */
  readonly topPct: number;
  /** % chiều cao. Luôn > 0 để lượt siêu ngắn vẫn bấm được. */
  readonly heightPct: number;
  /** Lượt bắt đầu TRƯỚC giờ đầu khung (đã bị kẹp). */
  readonly clippedTop: boolean;
  /** Lượt kết thúc SAU giờ cuối khung (đã bị kẹp). */
  readonly clippedBottom: boolean;
}

const MIN_HEIGHT_PCT = 1.5;

/**
 * Đặt `[startsAt, endsAt)` lên cột của ngày `localDate`, khung `[startHour, endHour)` theo tz.
 *
 * Trả `null` khi lượt KHÔNG giao ngày đó — gọi được thẳng trên mảng lượt của cả tuần mà không phải lọc
 * trước. Lượt giao một phần bị **kẹp** (clip) chứ không bị bỏ: giấu phần ngoài khung là giấu lịch bận,
 * người dùng sẽ đặt đè rồi ăn 409 ROOM-ERR-001 đúng cái mà SPEC-14 §14 muốn tránh.
 */
export function placeOnDay(
  startsAt: Date,
  endsAt: Date,
  localDate: string,
  timeZone: string,
  startHour: number,
  endHour: number,
): GridPlacement | null {
  const dayStart = wallTimeToInstant(localDate, "00:00", timeZone).getTime();
  const dayEnd = wallTimeToInstant(addDaysToLocalDate(localDate, 1), "00:00", timeZone).getTime();
  const s = startsAt.getTime();
  const e = endsAt.getTime();
  if (e <= dayStart || s >= dayEnd) return null;

  const winStart = wallTimeToInstant(localDate, `${pad2(startHour)}:00`, timeZone).getTime();
  // `endHour === 24` không biểu diễn được bằng "HH:00" của cùng ngày ⇒ dùng 00:00 ngày kế.
  const winEnd =
    endHour >= 24
      ? dayEnd
      : wallTimeToInstant(localDate, `${pad2(endHour)}:00`, timeZone).getTime();
  const span = winEnd - winStart;
  if (span <= 0) return null;

  // Lượt nằm TRỌN ngoài khung giờ vẽ (ví dụ họp 02:00–03:00 với khung 07:00–21:00) vẫn phải thấy được:
  // kẹp về một dải mỏng ở biên gần nhất thay vì trả null.
  const clippedTop = s < winStart;
  const clippedBottom = e > winEnd;
  const top = Math.min(Math.max(s, winStart), winEnd);
  const bottom = Math.max(Math.min(e, winEnd), winStart);

  // Kẹp `topPct` để dải mỏng của lượt nằm TRỌN ngoài khung (ví dụ 21:30–22:00 với khung …–21:00) vẫn
  // rơi bên TRONG cột: để nguyên 100% thì thẻ vẽ ngay dưới đáy lưới — nhìn như biến mất.
  const topPct = Math.min(Math.max(((top - winStart) / span) * 100, 0), 100 - MIN_HEIGHT_PCT);
  const rawHeight = ((bottom - top) / span) * 100;
  const heightPct = Math.min(Math.max(rawHeight, MIN_HEIGHT_PCT), 100 - topPct);
  return { topPct, heightPct, clippedTop, clippedBottom };
}

/** Hai khoảng nửa mở `[aS, aE)` và `[bS, bE)` có giao nhau không — nền của kiểm trùng client-side. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Danh sách mốc `HH:MM` của lưới chọn giờ, bước `stepMinutes`, trong `[startHour, endHour]`. */
export function timeSlots(startHour: number, endHour: number, stepMinutes: number): string[] {
  const out: string[] = [];
  for (let t = startHour * 60; t <= endHour * 60; t += stepMinutes) {
    out.push(`${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`);
  }
  return out;
}
