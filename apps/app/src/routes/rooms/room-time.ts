/**
 * S11-ROOM-FE-1 — thời gian của lịch phòng: UTC-at-rest ↔ wall-clock theo múi CÔNG TY (ADR-0008).
 *
 * Cùng thư viện với BE (`@date-fns/tz` `TZDate`, date-fns v4) và cùng quy ước: "instant" = `Date` (UTC),
 * "wall-clock" = `YYYY-MM-DD` + giờ/phút theo IANA tz. Dùng `new Date(y, m, d)` của trình duyệt cho lưới
 * lịch là đọc múi giờ CỦA MÁY người dùng — một người mở app từ Singapore sẽ thấy lưới lệch cột so với
 * đồng nghiệp ngồi cạnh, và khung giờ họ kéo chọn gửi lên server sẽ lệch đúng chừng ấy.
 *
 * ⚠️ **Múi giờ lấy từ đâu** (đo 30/08/2026): `companies.timezone` KHÔNG có đường ra FE — `/auth/me`
 * không trả, `/me/preferences.timezone` là override CÁ NHÂN và `null` = kế thừa (không lộ giá trị công
 * ty). Mọi hàm ở đây nhận `timeZone` làm THAM SỐ, màn hình truyền `useCompanyTimeZone()` (→ hôm nay
 * `DEFAULT_TIMEZONE` của web-core = `Asia/Ho_Chi_Minh`, đúng bằng fallback `tz.util` của API). Khi
 * `/auth/me` expand `company.timezone`, sửa MỘT hàm là xong — đó là lý do không rải hằng vào 5 màn.
 *
 * Hàm thuần, KHÔNG đụng react — spec neo được biên DST/tháng mà không dựng DOM.
 */
import { TZDate } from "@date-fns/tz";
import { DEFAULT_TIMEZONE } from "@mediaos/web-core";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/**
 * Múi giờ dùng cho MỌI phép quy đổi của module ROOM.
 *
 * Là một HÀM (không phải hằng re-export) để chỗ đọc là một điểm duy nhất: khi session mang được
 * `company.timezone`, thân hàm đổi và không màn nào phải sửa. Không phải hook (không gọi `use*`) nên
 * dùng được cả trong hàm thuần lẫn trong component.
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

export function partsIn(instant: Date, timeZone: string): LocalParts {
  const z = new TZDate(instant.getTime(), timeZone);
  return {
    year: z.getFullYear(),
    month: z.getMonth() + 1,
    day: z.getDate(),
    hour: z.getHours(),
    minute: z.getMinutes(),
  };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Ngày local `YYYY-MM-DD` của một instant theo tz. */
export function localDateOf(instant: Date, timeZone: string): string {
  const p = partsIn(instant, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Giờ local `HH:MM` của một instant theo tz. */
export function localTimeOf(instant: Date, timeZone: string): string {
  const p = partsIn(instant, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * Cộng `n` ngày cho một ngày local `YYYY-MM-DD` — thuần CHUỖI qua `Date.UTC`, KHÔNG đụng tz.
 *
 * Cộng ngày bằng `+ n * DAY_MS` trên instant là sai ở biên DST (ngày 23 hoặc 25 giờ): "thứ Hai + 7
 * ngày" phải luôn là thứ Hai kế, không phải "168 giờ sau". VN không DST nhưng công thức phải đúng cho
 * mọi tz — cùng lập luận đã khoá ở `tz.util.ts` của API.
 */
export function addDaysToLocalDate(localDate: string, n: number): string {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + n * DAY_MS;
  const z = new Date(t);
  return `${z.getUTCFullYear()}-${pad2(z.getUTCMonth() + 1)}-${pad2(z.getUTCDate())}`;
}

/**
 * Instant của một wall-clock (`YYYY-MM-DD` + `HH:MM`) trong tz — resolver two-pass đơn điệu.
 *
 * KHÔNG dùng thẳng `new TZDate(y, mo, d, h, mi)`: constructor giải giờ-không-tồn-tại (DST gap) bằng
 * offset TRƯỚC chuyển tiếp, lệch 1 giờ so với two-pass mà API đã khoá canonical (`tz.util.ts`
 * §"Giải DST"). Hai đầu dây lệch 1 giờ ở biên = lượt đặt rơi sai khung. Luôn trả một instant ổn định,
 * KHÔNG ném / KHÔNG NaN ở biên.
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
  // Giây/mili giây không tham gia: lưới lịch làm việc ở độ phân giải phút, và mọi offset IANA đều là
  // bội của phút.
  const flooredInstant = Math.floor(instantMs / MINUTE_MS) * MINUTE_MS;
  return asUtc - flooredInstant;
}

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
