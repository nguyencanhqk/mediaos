import { weekdayOfLocalDate } from "../../common/tz.util";

/**
 * FOUNDATION-BE-6 — pure working-day / holiday-override logic (no DB, no DI → fast unit tests).
 *
 * Quy ước thứ: ISO 1=Thứ 2 … 7=Chủ nhật (đồng nhất `weekdayOfLocalDate` / attendance ScheduleCalc).
 * holiday_type ∈ PublicHoliday | CompanyHoliday | WorkingDayOverride | SpecialDay (CHECK ở mig 0434).
 */

/** Tuần làm việc mặc định: Thứ 2–Thứ 6 (ISO 1..5). Thứ 7(6)+CN(7) nghỉ. */
export const DEFAULT_WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5];

/** Hình dạng tối thiểu cần để quyết ngày làm việc — service map từ row public_holidays sang đây. */
export interface HolidayFact {
  /** null = holiday GLOBAL (dùng chung theo country); có giá trị = holiday riêng công ty. */
  companyId: string | null;
  /** 'YYYY-MM-DD'. */
  holidayDate: string;
  holidayType: string;
  affectsAttendance: boolean;
  /** 'Active' | 'Inactive'. */
  status: string;
}

/**
 * Override theo NGÀY (DB-08 §8.10 rule 1): nếu công ty có BẤT KỲ holiday nào trong `date`, các hàng
 * company là nguồn duy nhất cho ngày đó — bỏ qua hàng global cùng ngày. Không có hàng company → dùng global.
 */
export function effectiveHolidaysForDate<T extends { companyId: string | null; holidayDate: string }>(
  holidays: readonly T[],
  date: string,
): T[] {
  const onDate = holidays.filter((h) => h.holidayDate === date);
  const companyRows = onDate.filter((h) => h.companyId !== null);
  return companyRows.length > 0 ? companyRows : onDate;
}

/**
 * `date` có phải ngày làm việc không? Baseline = thứ ∈ workingDays, điều chỉnh bởi holiday HIỆU DỤNG:
 *  - WorkingDayOverride ⇒ ÉP làm việc (làm bù vào cuối tuần) — ưu tiên cao nhất;
 *  - holiday Active ảnh hưởng chấm công (affectsAttendance) ⇒ KHÔNG làm việc;
 *  - còn lại ⇒ theo thứ trong tuần (workingDays).
 */
export function computeIsWorkingDay(
  date: string,
  effective: readonly HolidayFact[],
  workingDays: readonly number[] = DEFAULT_WORKING_DAYS,
): boolean {
  const active = effective.filter((h) => h.status === "Active");
  if (active.some((h) => h.holidayType === "WorkingDayOverride")) return true;
  if (active.some((h) => h.holidayType !== "WorkingDayOverride" && h.affectsAttendance)) return false;
  return workingDays.includes(weekdayOfLocalDate(date));
}

/**
 * Lọc holiday theo country cho hàng GLOBAL (company rows luôn giữ — là của chính tenant).
 * Hàng global giữ khi: không truyền country, HOẶC country trùng, HOẶC holiday không gắn country (áp mọi nơi).
 */
export function filterByCountry<T extends { companyId: string | null; countryCode: string | null }>(
  holidays: readonly T[],
  countryCode: string | null,
): T[] {
  if (!countryCode) return [...holidays];
  return holidays.filter(
    (h) => h.companyId !== null || h.countryCode === null || h.countryCode === countryCode,
  );
}
