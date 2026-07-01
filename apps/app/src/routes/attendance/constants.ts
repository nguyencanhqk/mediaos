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
} as const;
