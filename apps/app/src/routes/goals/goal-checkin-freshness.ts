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

/**
 * Tuổi check-in cuối. `null` tường minh (chưa từng check-in) ⇒ tính từ lúc tạo (mục tiêu mới tạo hôm nay
 * chưa «quá hạn»). `undefined` (khoá VẮNG: API cũ chưa deploy, phản hồi ghi, mock) = KHÔNG BIẾT ⇒ null,
 * để không báo «Cần check-in» oan hàng loạt.
 */
export function checkinAgeDays(goal: FreshnessFacts, now: Date, timeZone: string): number | null {
  if (goal.lastCheckinAt === undefined) return null;
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

/** Cột sắp được tại chỗ ở chế độ Danh sách — phần còn lại giữ thứ tự server. */
export const GOAL_SORTABLE_COLUMNS: ReadonlySet<string> = new Set(["owner", "lastCheckin"]);

type SortableGoal = { ownerName?: string | null; lastCheckinAt?: string | null };

/**
 * Sắp tại chỗ (client) theo «Phụ trách» (tên, collation tiếng Việt) hoặc «Check-in cuối» (ISO UTC).
 * Không tên / chưa check-in / khoá vắng LUÔN xuống cuối ở cả hai chiều (ổn định — giữ thứ tự server
 * giữa chúng). Không có cột sắp hợp lệ ⇒ trả lại CHÍNH mảng vào (cùng tham chiếu, không render thừa).
 */
export function sortGoalRows<T extends SortableGoal>(
  rows: readonly T[],
  sorting: readonly { id: string; desc: boolean }[],
): readonly T[] {
  const s = sorting[0];
  if (!s || !GOAL_SORTABLE_COLUMNS.has(s.id)) return rows;
  const keyOf = (g: T) => (s.id === "owner" ? g.ownerName : g.lastCheckinAt) ?? null;
  const dir = s.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === kb) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    const cmp = s.id === "owner" ? ka.localeCompare(kb, "vi") : ka < kb ? -1 : 1;
    return cmp * dir;
  });
}
