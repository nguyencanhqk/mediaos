/**
 * S3-ATT-BE-5 — pure remote-work-request FSM + calc-affect derivation (no I/O, fully unit-testable).
 *
 * STATE-MACHINE (done_when, CHỐT 2026-07-02): Draft → Pending (submit) → Approved | Rejected | Cancelled
 * (terminal). Cancel is allowed from Draft OR Pending (done_when "chỉ request ở trạng thái Pending mới
 * approve/reject được" — cancel is broader, mirrors a typical draft/pending withdrawal).
 */

export const REMOTE_REQUEST_STATUS = {
  DRAFT: "Draft",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
} as const;

export type RemoteRequestStatusValue =
  (typeof REMOTE_REQUEST_STATUS)[keyof typeof REMOTE_REQUEST_STATUS];

/** Terminal states — a decision on any of these is a no-op conflict (409). */
export const REMOTE_REQUEST_TERMINAL_STATUSES: readonly string[] = [
  REMOTE_REQUEST_STATUS.APPROVED,
  REMOTE_REQUEST_STATUS.REJECTED,
  REMOTE_REQUEST_STATUS.CANCELLED,
];

/** Only a Draft request may be submitted (Draft→Pending). */
export function isSubmittable(status: string): boolean {
  return status === REMOTE_REQUEST_STATUS.DRAFT;
}

/** Only a Pending request may be approved/rejected. */
export function isDecidable(status: string): boolean {
  return status === REMOTE_REQUEST_STATUS.PENDING;
}

/** Draft OR Pending may be cancelled by the owner; terminals (incl. already-Cancelled) may not. */
export function isCancellable(status: string): boolean {
  return status === REMOTE_REQUEST_STATUS.DRAFT || status === REMOTE_REQUEST_STATUS.PENDING;
}

/** work_mode written on the affected attendance_records row (CHECK chk_attendance_records_work_mode). */
export function workModeForRequestType(requestType: string): string {
  return requestType === "BusinessTrip" ? "BusinessTrip" : "Remote";
}

/**
 * DB-04 §7.8 quy tắc 2-4 — attendance_status marker per attendance_mode when a remote request is
 * Approved. NO_ATTENDANCE returns null (caller must NOT write/upsert a record for that day).
 */
export function attendanceStatusForMode(attendanceMode: string): string | null {
  switch (attendanceMode) {
    case "AUTO_ATTENDANCE":
      return "Auto Attendance";
    case "SELF_CHECK_IN":
      return "Remote Work";
    case "NO_ATTENDANCE":
      return null;
    default:
      return null;
  }
}

/** Every calendar date in [startDate, endDate] inclusive, ISO YYYY-MM-DD, ascending. */
export function dateRangeInclusive(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}
