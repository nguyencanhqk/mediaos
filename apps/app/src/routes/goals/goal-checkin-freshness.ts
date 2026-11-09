/**
 * S20-GOAL-OWNERCHECKIN-1 — «lần check-in cuối» và nhãn «Cần check-in». THUẦN, theo GIỜ CÔNG TY (không
 * phải giờ máy): hai thời điểm cách nhau theo NGÀY LỊCH của tz công ty (S20-FE-COMPANYTZ-1).
 *
 * Chỉ mục tiêu `manual` + `Active` có nhãn: chế độ đo tự động (project/tasks/children) không có check-in
 * thủ công để mà quá hạn, nên KHÔNG gắn nhãn (tránh báo động oan).
 */
import { localDateOf, localTimeOf } from "@mediaos/web-core";
import type { GoalCoreResponseDto } from "@mediaos/contracts";

/** Quá bấy nhiêu NGÀY LỊCH không check-in ⇒ «Cần check-in» (hằng số đặt tên — SPEC-10 §Q14/QL-01). */
export const GOAL_CHECKIN_STALE_DAYS = 7;

type FreshnessFacts = Pick<
  GoalCoreResponseDto,
  "progressMode" | "status" | "lastCheckinAt" | "createdAt"
>;

const MS_PER_DAY = 86_400_000;

function dayNumber(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / MS_PER_DAY;
}

/** Số ngày lịch (giờ công ty) từ `iso` tới `now`; ISO hỏng ⇒ null; không âm. */
export function calendarDaysSince(iso: string, now: Date, timeZone: string): number | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const diff = dayNumber(localDateOf(now, timeZone)) - dayNumber(localDateOf(at, timeZone));
  return Math.max(0, Math.round(diff));
}

/** Mục tiêu có áp dụng nhãn check-in không (manual + Active). */
export function tracksManualCheckin(
  goal: Pick<FreshnessFacts, "progressMode" | "status">,
): boolean {
  return goal.progressMode === "manual" && goal.status === "Active";
}

/** Tuổi check-in cuối; chưa từng check-in ⇒ tính từ lúc tạo (mục tiêu mới tạo hôm nay chưa «quá hạn»). */
export function checkinAgeDays(goal: FreshnessFacts, now: Date, timeZone: string): number | null {
  return calendarDaysSince(goal.lastCheckinAt ?? goal.createdAt, now, timeZone);
}

export function needsCheckin(goal: FreshnessFacts, now: Date, timeZone: string): boolean {
  if (!tracksManualCheckin(goal)) return false;
  const age = checkinAgeDays(goal, now, timeZone);
  return age !== null && age > GOAL_CHECKIN_STALE_DAYS;
}

/** «dd/mm/yyyy HH:mm» theo giờ công ty — cho tooltip. */
export function formatCompanyDateTime(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  const [y, m, d] = localDateOf(at, timeZone).split("-");
  return `${d}/${m}/${y} ${localTimeOf(at, timeZone)}`;
}

/** Đẩy mục tiêu «Cần check-in» lên đầu, GIỮ thứ tự tương đối của phần còn lại (ổn định). */
export function floatNeedingCheckin<T extends FreshnessFacts>(
  goals: readonly T[],
  now: Date,
  timeZone: string,
): T[] {
  const needs = goals.filter((g) => needsCheckin(g, now, timeZone));
  const rest = goals.filter((g) => !needsCheckin(g, now, timeZone));
  return [...needs, ...rest];
}
