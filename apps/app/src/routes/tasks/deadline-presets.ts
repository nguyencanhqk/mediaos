import {
  addDaysToLocalDate,
  deadlineAt,
  localDateOf,
  localTimeOf,
  todayLocal,
  wallTimeToInstant,
} from "@mediaos/web-core";

/**
 * S20-TASK-QUICKEDIT-1 (US-TASK-NV-08) — mốc hạn chọn nhanh, hàm THUẦN.
 *
 * Mọi hàm nhận `now` + `timeZone` làm THAM SỐ (không đọc đồng hồ, không đọc múi máy): «hôm nay», «Thứ
 * Sáu này» là ngày theo GIỜ CÔNG TY (`companyTimeZone()` do màn truyền vào), lưu ra instant UTC. Phép
 * cộng ngày đi qua `addDaysToLocalDate` (chuỗi `YYYY-MM-DD`), không cộng mili giây ⇒ đúng ở biên DST.
 *
 * Bất biến: KHÔNG mốc nào nằm ở quá khứ so với `now` (mốc đã qua bị bỏ, không trả ra). Hai mốc trùng
 * instant VẪN giữ cả hai (Thứ Năm: «Ngày mai» và «Thứ Sáu này» cùng là 17:00 Thứ Sáu — tìm theo nhãn
 * nào cũng phải thấy). Danh sách mốc là THAM SỐ — màn khác (tạo nhanh, Quá hạn) nối thêm định nghĩa
 * riêng mà không sửa file này.
 */

/** Giờ mặc định của mọi mốc nhanh (giờ công ty). */
export const DEFAULT_DEADLINE_TIME = "17:00";

/** «Hôm nay» sau giờ mặc định ⇒ dời về cuối ngày (vẫn trong hôm nay, không tạo việc quá hạn ngay). */
export const LATE_TODAY_DEADLINE_TIME = "23:59";

/** Thứ trong tuần theo ISO: 1 = Thứ Hai … 7 = Chủ Nhật. */
const ISO_FRIDAY = 5;
const DAYS_PER_WEEK = 7;

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CUSTOM_VALUE_RE = /^((\d{4})-(\d{2})-(\d{2}))T([01]\d|2[0-3]):([0-5]\d)$/;

/** Ngày có thật trên lịch (loại 30/02): dựng lại qua `Date.UTC` rồi so từng thành phần. */
function isCalendarDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Ngữ cảnh một lượt tính mốc — dựng MỘT lần từ `now` + `timeZone`. */
export interface DeadlinePresetContext {
  readonly now: Date;
  readonly timeZone: string;
  /** «Hôm nay» `YYYY-MM-DD` theo `timeZone`. */
  readonly today: string;
  /** Thứ của «hôm nay» theo ISO (1 = Thứ Hai … 7 = Chủ Nhật). */
  readonly isoWeekday: number;
}

/** Kết quả của một định nghĩa: ngày local + giờ local + khoá nhãn (i18n `deadlinePicker.presets.*`). */
export interface DeadlinePresetChoice {
  readonly localDate: string;
  readonly time: string;
  readonly labelKey: string;
}

/** Một định nghĩa mốc — `resolve` trả `null` khi mốc không áp dụng cho ngữ cảnh này. */
export interface DeadlinePresetDefinition {
  readonly id: string;
  readonly resolve: (ctx: DeadlinePresetContext) => DeadlinePresetChoice | null;
}

/** Mốc đã tính xong, sẵn để hiển thị và lưu. */
export interface DeadlinePreset extends DeadlinePresetChoice {
  readonly id: string;
  /** Instant UTC dạng ISO — đúng giá trị gửi cho route change-deadline. */
  readonly dueAt: string;
}

/** Thứ ISO của một ngày local `YYYY-MM-DD` — thuần chuỗi, không đụng múi giờ. */
export function isoWeekdayOf(localDate: string): number {
  const match = LOCAL_DATE_RE.exec(localDate);
  if (!match) throw new Error(`Ngày local không hợp lệ: ${localDate}`);
  const day = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).getUTCDay();
  return day === 0 ? DAYS_PER_WEEK : day;
}

export function buildDeadlinePresetContext(now: Date, timeZone: string): DeadlinePresetContext {
  const today = todayLocal(now, timeZone);
  return { now, timeZone, today, isoWeekday: isoWeekdayOf(today) };
}

/** Hôm nay 17:00; đã qua 17:00 ⇒ Hôm nay 23:59 (đã qua cả 23:59 thì bộ lọc chung bỏ mốc). */
export const TODAY_PRESET: DeadlinePresetDefinition = {
  id: "today",
  resolve: (ctx) => {
    const atDefault = deadlineAt(ctx.today, DEFAULT_DEADLINE_TIME, ctx.timeZone);
    return atDefault.getTime() > ctx.now.getTime()
      ? { localDate: ctx.today, time: DEFAULT_DEADLINE_TIME, labelKey: "today" }
      : { localDate: ctx.today, time: LATE_TODAY_DEADLINE_TIME, labelKey: "today" };
  },
};

export const TOMORROW_PRESET: DeadlinePresetDefinition = {
  id: "tomorrow",
  resolve: (ctx) => ({
    localDate: addDaysToLocalDate(ctx.today, 1),
    time: DEFAULT_DEADLINE_TIME,
    labelKey: "tomorrow",
  }),
};

/**
 * Thứ Sáu này 17:00. Hôm nay là Thứ Sáu (hoặc cuối tuần) ⇒ Thứ Sáu TUẦN SAU — «Thứ Sáu này» vào chiều
 * Thứ Sáu trùng «Hôm nay», còn Thứ Bảy/Chủ Nhật thì Thứ Sáu «này» đã qua.
 */
export const THIS_FRIDAY_PRESET: DeadlinePresetDefinition = {
  id: "friday",
  resolve: (ctx) => {
    if (ctx.isoWeekday < ISO_FRIDAY) {
      return {
        localDate: addDaysToLocalDate(ctx.today, ISO_FRIDAY - ctx.isoWeekday),
        time: DEFAULT_DEADLINE_TIME,
        labelKey: "thisFriday",
      };
    }
    return {
      localDate: addDaysToLocalDate(ctx.today, ISO_FRIDAY - ctx.isoWeekday + DAYS_PER_WEEK),
      time: DEFAULT_DEADLINE_TIME,
      labelKey: "nextFriday",
    };
  },
};

/** Thứ Hai tuần sau 17:00 (tuần bắt đầu Thứ Hai: từ Chủ Nhật là ngày mai, từ Thứ Hai là +7). */
export const NEXT_MONDAY_PRESET: DeadlinePresetDefinition = {
  id: "nextMonday",
  resolve: (ctx) => ({
    localDate: addDaysToLocalDate(ctx.today, DAYS_PER_WEEK + 1 - ctx.isoWeekday),
    time: DEFAULT_DEADLINE_TIME,
    labelKey: "nextMonday",
  }),
};

export const DEFAULT_DEADLINE_PRESETS: readonly DeadlinePresetDefinition[] = [
  TODAY_PRESET,
  TOMORROW_PRESET,
  THIS_FRIDAY_PRESET,
  NEXT_MONDAY_PRESET,
];

/** Tính danh sách mốc cho `now` theo `timeZone`, bỏ mốc không ở TƯƠNG LAI (≤ `now`). */
export function resolveDeadlinePresets(
  now: Date,
  timeZone: string,
  definitions: readonly DeadlinePresetDefinition[] = DEFAULT_DEADLINE_PRESETS,
): DeadlinePreset[] {
  const ctx = buildDeadlinePresetContext(now, timeZone);
  const out: DeadlinePreset[] = [];
  for (const def of definitions) {
    const choice = def.resolve(ctx);
    if (!choice) continue;
    const instant = deadlineAt(choice.localDate, choice.time, timeZone);
    if (instant.getTime() <= now.getTime()) continue;
    out.push({ id: def.id, ...choice, dueAt: instant.toISOString() });
  }
  return out;
}

/**
 * Giá trị ô `datetime-local` (`YYYY-MM-DDTHH:MM`, đọc theo `timeZone`) ⇒ ISO UTC. Sai dạng hoặc ngày
 * không có trên lịch (ô nhập trả chuỗi đúng dạng như `2026-02-30`) ⇒ `null`, không trôi sang tháng sau.
 */
export function customDeadlineToIso(value: string, timeZone: string): string | null {
  const match = CUSTOM_VALUE_RE.exec(value);
  if (!match) return null;
  const [, localDate = "", year, month, day, hour, minute] = match;
  if (!isCalendarDate(Number(year), Number(month), Number(day))) return null;
  return wallTimeToInstant(localDate, `${hour}:${minute}`, timeZone).toISOString();
}

/** ISO UTC ⇒ giá trị ô `datetime-local` theo `timeZone`; rỗng/sai ⇒ chuỗi rỗng. */
export function isoToCustomDeadline(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  return `${localDateOf(instant, timeZone)}T${localTimeOf(instant, timeZone)}`;
}
