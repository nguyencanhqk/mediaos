/**
 * S20-FE-COMPANYTZ-1 (US-X-92) — giờ CÔNG TY dùng chung: «hôm nay», đầu/cuối ngày, quý, năm, mốc hạn.
 *
 * Quy ước (ADR-0008, cùng quy ước với `tz.util` của API): "instant" = `Date` (UTC-at-rest), "ngày local"
 * = chuỗi `YYYY-MM-DD`, "wall-clock" = ngày local + `HH:MM`, cả hai đọc theo một múi IANA.
 *
 * ⚠️ **Mốc nghiệp vụ luôn theo giờ công ty.** `timezone` cá nhân trong `/me/preferences` chỉ dùng để
 * HIỂN THỊ giờ; «hôm nay», «quý này», hạn chọn nhanh lấy `companyTimeZone()` — nếu không, hai người
 * cùng phòng thấy nhóm «Hôm nay» khác nhau và lệch với cờ quá hạn do server tính. Getter giờ MÁY
 * (`getDate()`, `new Date(y, m, d)`) bị cấm ở đây vì cùng lý do.
 *
 * Hàm thuần: mọi hàm nhận `now`/ngày local và `timeZone` làm tham số, không đọc đồng hồ, không đụng
 * react. Dùng `Intl.DateTimeFormat` gốc (web-core không phụ thuộc thư viện múi giờ).
 *
 * Đầu vào sai (múi không phải IANA, ngày không tồn tại, giờ sai dạng, instant NaN) ⇒ ném `Error` nêu
 * rõ giá trị — một mốc NaN lọt xuống sẽ thành nhóm sai hoặc request hỏng ở xa chỗ gây lỗi.
 */
import { DEFAULT_TIMEZONE } from "../i18n/format";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MONTHS_PER_QUARTER = 3;

/**
 * Múi giờ của MỌI mốc nghiệp vụ phía FE.
 *
 * `companies.timezone` chưa có đường ra FE (`/auth/me` chưa trả) ⇒ hôm nay trả `DEFAULT_TIMEZONE`,
 * trùng fallback `tz.util` của API. Khi `/auth/me` trả `company.timezone`, chỉ thân hàm này đổi — và
 * vẫn phải giữ bất biến: không bao giờ trả chuỗi rỗng (rơi về `DEFAULT_TIMEZONE`).
 */
export function companyTimeZone(): string {
  return DEFAULT_TIMEZONE;
}

/** Các thành phần wall-clock của một instant theo tz. */
export interface LocalParts {
  readonly year: number;
  /** 1..12 */
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/** Khoảng ngày local đóng hai đầu `[start, end]`, dạng `YYYY-MM-DD`. */
export interface LocalDateRange {
  readonly start: string;
  readonly end: string;
}

/** Tên IANA: bắt đầu bằng chữ cái (loại offset `+07:00`), không khoảng trắng. */
const IANA_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const message = `Múi giờ không hợp lệ (cần tên IANA, ví dụ Region/City): "${timeZone}"`;
  if (!IANA_NAME.test(timeZone)) throw new Error(message);
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  } catch (cause) {
    throw new Error(message, { cause });
  }
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** Ném lỗi rõ khi `timeZone` không phải múi IANA mà runtime nhận. */
export function assertTimeZone(timeZone: string): void {
  partsFormatter(timeZone);
}

export function partsIn(instant: Date, timeZone: string): LocalParts {
  const formatter = partsFormatter(timeZone);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Thời điểm không hợp lệ: ${String(instant)}`);
  }
  const read: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") read[part.type] = Number(part.value);
  }
  return {
    year: read.year ?? Number.NaN,
    month: read.month ?? Number.NaN,
    day: read.day ?? Number.NaN,
    // Engine cũ có thể in nửa đêm là "24" dù đã xin h23.
    hour: (read.hour ?? Number.NaN) % 24,
    minute: read.minute ?? Number.NaN,
  };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

const toLocalDate = (year: number, month: number, day: number): string =>
  `${year}-${pad2(month)}-${pad2(day)}`;

/** Ngày local `YYYY-MM-DD` của một instant theo tz. */
export function localDateOf(instant: Date, timeZone: string): string {
  const p = partsIn(instant, timeZone);
  return toLocalDate(p.year, p.month, p.day);
}

/** Giờ local `HH:MM` của một instant theo tz. */
export function localTimeOf(instant: Date, timeZone: string): string {
  const p = partsIn(instant, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * Cộng `n` ngày cho một ngày local `YYYY-MM-DD` — thuần CHUỖI qua `Date.UTC`, KHÔNG đụng tz.
 *
 * Cộng bằng `+ n * DAY_MS` trên instant là sai ở biên DST (ngày 23 hoặc 25 giờ): "thứ Hai + 7 ngày"
 * phải luôn là thứ Hai kế, không phải "168 giờ sau".
 */
export function addDaysToLocalDate(localDate: string, n: number): string {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  const z = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return toLocalDate(z.getUTCFullYear(), z.getUTCMonth() + 1, z.getUTCDate());
}

/**
 * Instant của một wall-clock (`YYYY-MM-DD` + `HH:MM`) trong tz — resolver two-pass đơn điệu.
 *
 * Giờ-không-tồn-tại (DST gap) giải bằng offset SAU chuyển tiếp, giờ lặp (DST overlap) lấy lần TRƯỚC —
 * trùng mốc canonical `tz.util.ts` §"Giải DST" của API. Không ném / không NaN ở biên DST.
 */
export function wallTimeToInstant(localDate: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  const naiveUtc = Date.UTC(y, m - 1, d, h, mi);
  // Vòng 1: đoán offset bằng chính mốc naive; vòng 2: đo lại offset TẠI mốc vừa suy ra (offset có thể
  // đã đổi giữa hai mốc quanh biên DST).
  let guess = naiveUtc - offsetAt(naiveUtc, timeZone);
  guess = naiveUtc - offsetAt(guess, timeZone);
  return new Date(guess);
}

/** Offset (ms) của tz tại một instant: wall-clock đọc theo tz trừ đi chính instant đó. */
function offsetAt(instantMs: number, timeZone: string): number {
  const p = partsIn(new Date(instantMs), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  // Giây/mili giây không tham gia: mọi offset IANA đều là bội của phút.
  const flooredInstant = Math.floor(instantMs / MINUTE_MS) * MINUTE_MS;
  return asUtc - flooredInstant;
}

// ── Mốc nghiệp vụ (US-X-92) ──────────────────────────────────────────────────────────────────────

function assertLocalDate(localDate: string): void {
  const match = LOCAL_DATE.exec(localDate);
  const [y, m, d] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  const probe = new Date(Date.UTC(y, m - 1, d));
  const exists =
    match !== null &&
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d;
  if (!exists) throw new Error(`Ngày không hợp lệ (cần YYYY-MM-DD có thật): "${localDate}"`);
}

function assertWallTime(hhmm: string): void {
  if (!WALL_TIME.test(hhmm))
    throw new Error(`Giờ không hợp lệ (cần HH:MM, 00:00–23:59): "${hhmm}"`);
}

/** «Hôm nay» `YYYY-MM-DD` của `now` theo tz (truyền `companyTimeZone()` cho mốc nghiệp vụ). */
export function todayLocal(now: Date, timeZone: string): string {
  return localDateOf(now, timeZone);
}

/** Hai instant có rơi vào CÙNG một ngày local theo tz không. */
export function isSameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  return localDateOf(a, timeZone) === localDateOf(b, timeZone);
}

/** Instant UTC của 00:00 ngày local `localDate` theo tz. */
export function startOfLocalDay(localDate: string, timeZone: string): Date {
  assertTimeZone(timeZone);
  assertLocalDate(localDate);
  return wallTimeToInstant(localDate, "00:00", timeZone);
}

/**
 * Instant UTC của mili giây CUỐI ngày local `localDate` theo tz (= đầu ngày kế − 1 ms).
 * Tính qua đầu ngày kế chứ không `+ 23:59:59.999`: ngày DST dài 23 hoặc 25 giờ.
 */
export function endOfLocalDay(localDate: string, timeZone: string): Date {
  assertTimeZone(timeZone);
  assertLocalDate(localDate);
  const nextDayStart = wallTimeToInstant(addDaysToLocalDate(localDate, 1), "00:00", timeZone);
  return new Date(nextDayStart.getTime() - 1);
}

/** Mốc hạn: wall-clock `hhmm` của ngày local `localDate` theo tz, trả instant UTC để lưu. */
export function deadlineAt(localDate: string, hhmm: string, timeZone: string): Date {
  assertTimeZone(timeZone);
  assertLocalDate(localDate);
  assertWallTime(hhmm);
  return wallTimeToInstant(localDate, hhmm, timeZone);
}

/** Số ngày của tháng `month` (1..12) — `Date.UTC(y, month, 0)` là ngày cuối tháng `month`. */
const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Quý chứa `now` theo tz: ngày đầu và ngày cuối quý. */
export function quarterRange(now: Date, timeZone: string): LocalDateRange {
  const { year, month } = partsIn(now, timeZone);
  const firstMonth = Math.floor((month - 1) / MONTHS_PER_QUARTER) * MONTHS_PER_QUARTER + 1;
  const lastMonth = firstMonth + MONTHS_PER_QUARTER - 1;
  return {
    start: toLocalDate(year, firstMonth, 1),
    end: toLocalDate(year, lastMonth, daysInMonth(year, lastMonth)),
  };
}

/** Năm chứa `now` theo tz: `YYYY-01-01` … `YYYY-12-31`. */
export function yearRange(now: Date, timeZone: string): LocalDateRange {
  const { year } = partsIn(now, timeZone);
  return { start: toLocalDate(year, 1, 1), end: toLocalDate(year, 12, 31) };
}
