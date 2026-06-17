import type { AttendanceStatusDto, HrRequestStatusDto } from "@mediaos/contracts";

/**
 * Small pure formatters for the HR screens (attendance / leave / payslip / KPI). Kept dependency-free
 * and immutable so they're trivially unit-testable and reused across screens (DRY).
 */

/** 'YYYY-MM' for the current month in UTC — the month key the attendance list expects. */
export function currentMonthKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** First/last instant of the current month as ISO datetimes — the period range KPI compute expects. */
export function currentMonthRange(now: Date = new Date()): { periodStart: string; periodEnd: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  // Day 0 of next month = last day of this month; 23:59:59.999 UTC.
  const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

/** Render an ISO datetime as local HH:MM, or a dash when null (e.g. not yet checked out). */
export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Render an ISO date ('YYYY-MM-DD') as 'DD/MM' for compact rows; '—' for a malformed value. */
export function formatDayMonth(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "—";
  const [, mo, da] = isoDate.split("-");
  return `${da}/${mo}`;
}

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatusDto, string> = {
  present: "Đúng giờ",
  late: "Đi muộn",
  early_leave: "Về sớm",
  absent: "Vắng",
  missing_checkin: "Thiếu chấm công",
  pending_adjustment: "Chờ duyệt bổ sung",
  approved_adjustment: "Đã duyệt bổ sung",
};

export const HR_REQUEST_STATUS_LABELS: Record<HrRequestStatusDto, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  cancelled: "Đã huỷ",
};

/** Money formatter — only used inside the re-auth-gated detail (never on the list). */
export function formatMoney(amount: number, currency: string): string {
  // Guard non-finite values up front so neither Intl call below can throw a RangeError into render.
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency }).format(amount);
  } catch {
    // Unknown/invalid currency code — fall back to a plain grouped number + raw code.
    return `${new Intl.NumberFormat("vi-VN").format(amount)} ${currency}`;
  }
}
