/**
 * Hằng quyền module ATT — S3-FE-ATT-1.
 * Cặp engine (action:resourceType) khớp ĐÚNG với seed DB (migration 0454 a, attendance-permissions.const.ts).
 * Dùng trong useCan(action, resourceType) — KHÔNG so sánh role trực tiếp.
 */

/** Cặp engine ATT dùng trong useCan() — nguồn sự thật: apps/api/src/attendance/attendance-permissions.const.ts */
export const ATT_ENGINE_PAIRS = {
  VIEW_OWN: { action: "view-own", resourceType: "attendance" },
  CHECK_IN: { action: "check-in", resourceType: "attendance" },
  CHECK_OUT: { action: "check-out", resourceType: "attendance" },
  VIEW_TEAM: { action: "view-team", resourceType: "attendance" },
  VIEW_COMPANY: { action: "view-company", resourceType: "attendance" },
  VIEW_DETAIL: { action: "view-detail", resourceType: "attendance" },
  ADJUST_DIRECT: { action: "adjust-direct", resourceType: "attendance" },
  CREATE_OWN_ADJUSTMENT: { action: "create-own", resourceType: "adjustment" },
  VIEW_OWN_ADJUSTMENT: { action: "view-own", resourceType: "adjustment" },
  // S3-FE-ATT-5 — ca làm việc / gán ca / rule (admin). view + CRUD tối thiểu (create/update/config).
  SHIFT_VIEW: { action: "view", resourceType: "shift" },
  SHIFT_CREATE: { action: "create", resourceType: "shift" },
  SHIFT_UPDATE: { action: "update", resourceType: "shift" },
  SHIFT_ASSIGNMENT_VIEW: { action: "view", resourceType: "shift-assignment" },
  SHIFT_ASSIGNMENT_UPDATE: { action: "update", resourceType: "shift-assignment" },
  RULE_VIEW: { action: "view", resourceType: "attendance-rule" },
  RULE_CONFIG: { action: "config", resourceType: "attendance-rule" },
} as const;

/**
 * Trạng thái chấm công — SPEC-04 §9 (DB-04 TitleCase).
 * Dùng để so sánh `attendanceStatus` từ DTO — KHÔNG hard-code chuỗi rải rác.
 */
export const ATT_STATUS = {
  NOT_CHECKED_IN: "Not Checked-in",
  CHECKED_IN: "Checked-in",
  CHECKED_OUT: "Checked-out",
  PRESENT: "Present",
  LATE: "Late",
  EARLY_LEAVE: "Early Leave",
  MISSING_HOURS: "Missing Hours",
  MISSING_CHECK_IN: "Missing Check-in",
  MISSING_CHECK_OUT: "Missing Check-out",
  ABSENT: "Absent",
  LEAVE: "Leave",
  REMOTE_WORK: "Remote Work",
  AUTO_ATTENDANCE: "Auto Attendance",
  ADJUSTED: "Adjusted",
  PENDING_ADJUSTMENT: "Pending Adjustment",
  INVALID: "Invalid",
} as const;

export type AttStatus = (typeof ATT_STATUS)[keyof typeof ATT_STATUS];

/** Routes trong module ATT */
export const ATT_PATHS = {
  TODAY: "/attendance/today",
  MY_RECORDS: "/attendance/my-records",
  TEAM_RECORDS: "/attendance/team-records",
  RECORDS: "/attendance/records",
  RECORD_DETAIL: (id: string) => `/attendance/records/${id}`,
  SHIFTS: "/attendance/shifts",
  SHIFT_ASSIGNMENTS: "/attendance/shift-assignments",
  RULES: "/attendance/rules",
} as const;

/** Page size mặc định cho danh sách bảng công */
export const ATT_RECORDS_PAGE_SIZE = 20;

/**
 * Filter tháng → fromDate / toDate half-open [đầu tháng, đầu tháng kế).
 * toDate exclusive (backend: work_date >= fromDate AND work_date < toDate).
 */
export function monthToDateRange(month: string): { fromDate: string; toDate: string } {
  const [year, mon] = month.split("-").map(Number);
  const from = new Date(year, mon - 1, 1);
  const to = new Date(year, mon, 1); // exclusive start of next month
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { fromDate: fmt(from), toDate: fmt(to) };
}

/** Tháng hiện tại dạng 'YYYY-MM' */
export function currentMonth(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}
