import { TZDate } from "@date-fns/tz";
import {
  ROOM_BOOKING_MAX_AHEAD_DAYS,
  ROOM_BOOKING_MAX_HOURS,
  ROOM_BOOKING_MIN_MINUTES,
  ROOM_BOOKING_PAST_TOLERANCE_MINUTES,
} from "@mediaos/contracts";
import { addDaysToLocalDate, wallTimeToInstant } from "../common/tz.util";

/**
 * S11-ROOM-BE-1 — luật thời gian THUẦN của module ROOM (SPEC-14 §12 ROOM-ERR-002 · §13.2 · §13.4 · ROOM-DEC-003).
 * Không DB, không Nest — `now` LUÔN truyền vào (unit-spec tất định). Mọi mốc là instant UTC (`Date`);
 * render/đổi ngày theo IANA tz của công ty qua `TZDate` (ADR-0008 UTC-at-rest).
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export type BookingWindowKind =
  | "end-before-start"
  | "in-past"
  | "too-short"
  | "too-long"
  | "too-far";
export type LookupWindowKind = "range-too-wide";
export type AvailabilityWindowKind = "end-before-start" | "too-long";

/**
 * ROOM-ERR-002 cho ĐẶT — thứ tự kiểm cố định (SPEC-14 §13.2 bước 1): `end-before-start` → `in-past` (startsAt <
 * now − 5′) → `too-short` (< 15′) → `too-long` (> 8h) → `too-far` (startsAt > now + 90 ngày). Trả `null` khi hợp lệ.
 */
export function bookingWindowViolation(
  startsAt: Date,
  endsAt: Date,
  now: Date,
): BookingWindowKind | null {
  if (endsAt.getTime() <= startsAt.getTime()) return "end-before-start";
  if (startsAt.getTime() < now.getTime() - ROOM_BOOKING_PAST_TOLERANCE_MINUTES * MINUTE_MS) {
    return "in-past";
  }
  const duration = endsAt.getTime() - startsAt.getTime();
  if (duration < ROOM_BOOKING_MIN_MINUTES * MINUTE_MS) return "too-short";
  if (duration > ROOM_BOOKING_MAX_HOURS * HOUR_MS) return "too-long";
  if (startsAt.getTime() > now.getTime() + ROOM_BOOKING_MAX_AHEAD_DAYS * DAY_MS) return "too-far";
  return null;
}

/**
 * Cửa sổ TRA CỨU `[from, to)` (lịch ≤ 31 ngày · usage-summary ≤ 366 ngày): `to ≤ from` HOẶC dài hơn `maxDays`
 * ⇒ `range-too-wide` (SPEC-14 §12 gộp cả hai vào một kind).
 */
export function lookupWindowViolation(
  from: Date,
  to: Date,
  maxDays: number,
): LookupWindowKind | null {
  if (to.getTime() <= from.getTime()) return "range-too-wide";
  if (to.getTime() - from.getTime() > maxDays * DAY_MS) return "range-too-wide";
  return null;
}

/** `GET /rooms/availability` — CHỈ `end-before-start` + `too-long` (> 8h); KHÔNG in-past/too-short/too-far (§13.4). */
export function availabilityWindowViolation(from: Date, to: Date): AvailabilityWindowKind | null {
  if (to.getTime() <= from.getTime()) return "end-before-start";
  if (to.getTime() - from.getTime() > ROOM_BOOKING_MAX_HOURS * HOUR_MS) return "too-long";
  return null;
}

export interface BusyInterval {
  startsAt: Date;
  endsAt: Date;
}

/**
 * `nextFreeFrom` (SPEC-14 §13.2): mốc sớm nhất `≥ startsAt` sao cho `[mốc, mốc + duration)` không giao lượt
 * `Confirmed` nào trong `[startsAt, startsAt + 1 ngày)`. `busy` = các lượt đã tải của phòng trong ngày đó (bất kỳ
 * thứ tự — hàm tự sort theo `startsAt`). Không có ⇒ `null`. Chỉ là gợi ý — KHÔNG kiểm sức chứa/giờ làm việc.
 *
 * Thuật toán: con trỏ `cursor = startsAt`; duyệt các lượt theo thứ tự; lượt kết thúc trước `cursor` bỏ qua; nếu
 * lượt bắt đầu ≥ `cursor + duration` ⇒ khoảng trống đủ ⇒ trả `cursor`; ngược lại đẩy `cursor = max(cursor, lượt.endsAt)`.
 * Kết thúc danh sách: `cursor + duration ≤ startsAt + 1 ngày` ⇒ `cursor`, không thì `null`.
 */
export function computeNextFreeFrom(
  startsAt: Date,
  durationMs: number,
  busy: readonly BusyInterval[],
): Date | null {
  const dayEnd = startsAt.getTime() + DAY_MS;
  const sorted = [...busy].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  let cursor = startsAt.getTime();
  for (const b of sorted) {
    if (b.endsAt.getTime() <= cursor) continue;
    if (b.startsAt.getTime() >= cursor + durationMs) break;
    cursor = Math.max(cursor, b.endsAt.getTime());
  }
  if (cursor + durationMs > dayEnd) return null;
  return new Date(cursor);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

interface LocalParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

function partsIn(instant: Date, timeZone: string): LocalParts {
  const z = new TZDate(instant.getTime(), timeZone);
  return {
    y: z.getFullYear(),
    mo: z.getMonth() + 1,
    d: z.getDate(),
    h: z.getHours(),
    mi: z.getMinutes(),
  };
}

const hhmm = (p: LocalParts) => `${pad2(p.h)}:${pad2(p.mi)}`;
const ddmm = (p: LocalParts) => `${pad2(p.d)}/${pad2(p.mo)}`;
const ddmmyyyy = (p: LocalParts) => `${ddmm(p)}/${p.y}`;

/** `HH:mm dd/MM/yyyy` theo tz — biến template `starts_at_local` (ROOM_BOOKING_REMINDER). */
export function formatLocalDateTime(instant: Date, timeZone: string): string {
  const p = partsIn(instant, timeZone);
  return `${hhmm(p)} ${ddmmyyyy(p)}`;
}

/**
 * `time_range` cho NOTI (SPEC-14 §17 — "khung giờ đã format theo `companies.timezone`"): cùng ngày ⇒
 * `HH:mm–HH:mm dd/MM/yyyy`; qua ngày ⇒ `HH:mm dd/MM – HH:mm dd/MM/yyyy`.
 */
export function formatTimeRange(startsAt: Date, endsAt: Date, timeZone: string): string {
  const s = partsIn(startsAt, timeZone);
  const e = partsIn(endsAt, timeZone);
  const sameDay = s.y === e.y && s.mo === e.mo && s.d === e.d;
  if (sameDay) return `${hhmm(s)}–${hhmm(e)} ${ddmmyyyy(s)}`;
  return `${hhmm(s)} ${ddmm(s)} – ${hhmm(e)} ${ddmmyyyy(e)}`;
}

/**
 * `[00:00, 24:00)` của một ngày lịch `YYYY-MM-DD` theo tz công ty (ROOM-DEC-003, `/me/room-bookings?date=`).
 * Dùng `wallTimeToInstant` two-pass canonical của `tz.util` — KHÔNG `new Date("YYYY-MM-DD")` (đó là UTC).
 */
export function companyDayBounds(localDate: string, timeZone: string): { from: Date; to: Date } {
  return {
    from: wallTimeToInstant(localDate, "00:00", timeZone),
    to: wallTimeToInstant(addDaysToLocalDate(localDate, 1), "00:00", timeZone),
  };
}

/** `Completed` DẪN XUẤT (SPEC-01 §17.10): `Confirmed ∧ endsAt ≤ now`. */
export function isBookingCompleted(status: string, endsAt: Date, now: Date): boolean {
  return status === "Confirmed" && endsAt.getTime() <= now.getTime();
}
