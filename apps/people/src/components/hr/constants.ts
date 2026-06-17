import type {
  AttendanceStatusDto,
  AttendanceMethodDto,
  HrRequestStatusDto,
} from "@mediaos/contracts";

// ── Attendance status ─────────────────────────────────────────────────────────

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatusDto, string> = {
  present: "Đúng giờ",
  late: "Đi trễ",
  early_leave: "Về sớm",
  absent: "Vắng mặt",
  missing_checkin: "Thiếu chấm công",
  pending_adjustment: "Chờ bổ sung",
  approved_adjustment: "Đã bổ sung",
};

export const ATTENDANCE_STATUS_COLORS: Record<AttendanceStatusDto, string> = {
  present: "text-green-600",
  late: "text-orange-500",
  early_leave: "text-yellow-600",
  absent: "text-destructive",
  missing_checkin: "text-destructive",
  pending_adjustment: "text-blue-500",
  approved_adjustment: "text-green-600",
};

export const ATTENDANCE_STATUS_OPTIONS: AttendanceStatusDto[] = [
  "present",
  "late",
  "early_leave",
  "absent",
  "missing_checkin",
  "pending_adjustment",
  "approved_adjustment",
];

// ── Attendance method ─────────────────────────────────────────────────────────

export const ATTENDANCE_METHOD_LABELS: Record<AttendanceMethodDto, string> = {
  web: "Web",
  mobile: "Mobile",
  manual: "Thủ công",
  adjustment: "Bổ sung",
};

// ── HR request status ─────────────────────────────────────────────────────────

export const HR_REQUEST_STATUS_LABELS: Record<HrRequestStatusDto, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  cancelled: "Đã huỷ",
};

export const HR_REQUEST_STATUS_COLORS: Record<HrRequestStatusDto, string> = {
  pending: "text-blue-500",
  approved: "text-green-600",
  rejected: "text-destructive",
  cancelled: "text-muted-foreground",
};

export const HR_REQUEST_STATUS_OPTIONS: HrRequestStatusDto[] = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
];

// ── Days of week ─────────────────────────────────────────────────────────────

export const DOW_LABELS: Record<number, string> = {
  1: "Thứ 2",
  2: "Thứ 3",
  3: "Thứ 4",
  4: "Thứ 5",
  5: "Thứ 6",
  6: "Thứ 7",
  7: "CN",
};

// ── Current month helper ──────────────────────────────────────────────────────

/** Returns current YYYY-MM string in local timezone. */
export function currentMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Returns current year as number. */
export function currentYear(): number {
  return new Date().getFullYear();
}

/** Format ISO datetime string to local time display (HH:mm). */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

/** Format ISO date string 'YYYY-MM-DD' to display (dd/MM). */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

/** Format ISO date string to full display (dd/MM/YYYY). */
export function formatDateFull(date: string | null | undefined): string {
  if (!date) return "—";
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

/** Format ISO datetime to full local datetime display. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
