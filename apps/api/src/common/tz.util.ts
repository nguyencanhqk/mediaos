/**
 * Tiện ích timezone cho chấm công/nghỉ phép (ADR-0008: UTC-at-rest, render theo IANA tz).
 *
 * Dùng Intl.DateTimeFormat (ICU đầy đủ trên Node ≥20) — IANA-aware, DST-correct, KHÔNG dep mới.
 * NOTE(G11, đóng băng deps): ADR-0008 gợi ý date-fns v4 + @date-fns/tz; sau khi mở băng lockfile
 * có thể swap phần ruột các hàm này sang TZDate — chữ ký public giữ nguyên.
 *
 * Quy ước: "instant" = Date (UTC). "wall-clock" = chuỗi 'YYYY-MM-DD' + 'HH:MM[:SS]' theo tz.
 */

const MINUTE_MS = 60_000;

/** Ném RangeError nếu tz không phải IANA hợp lệ — validate ở ranh giới (tạo/sửa ca làm). */
export function assertValidTimezone(timeZone: string): void {
  // Constructor ném RangeError cho tz rác — đây chính là phép kiểm tra.
  new Intl.DateTimeFormat("en-US", { timeZone });
}

function formatPartsInTz(instant: Date, timeZone: string): Record<string, number> {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const out: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  // Intl trả hour=24 cho nửa đêm ở vài ICU version — chuẩn hoá về 0.
  if (out["hour"] === 24) out["hour"] = 0;
  return out;
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
 * Two-pass qua offset thật của tz nên đúng cả ngày chuyển DST (giờ không tồn tại/lặp lại
 * → chọn 1 đáp án ổn định theo offset sau chuyển).
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
