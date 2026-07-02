import { UnprocessableEntityException } from "@nestjs/common";
import type { leaveRequests, leaveTypes } from "../db/schema/hr";
import type { leavePolicies, leaveRequestApprovals, leaveRequestDays } from "../db/schema/leave";
import type { HolidayView } from "../foundation/holidays/holidays.service";
import type { LeaveDurationType } from "./leave-calc.logic";

/**
 * S3-LEAVE-BE-2 — pure helpers + shared row types + error catalog for the LEAVE request workflow. No I/O,
 * no DI (fast to reason about; keeps leave-request.service.ts under the 800-line bound).
 */

export type LeaveRequestRow = typeof leaveRequests.$inferSelect;
export type LeaveTypeRow = typeof leaveTypes.$inferSelect;
export type LeavePolicyRow = typeof leavePolicies.$inferSelect;
export type LeaveRequestDayRow = typeof leaveRequestDays.$inferSelect;
export type LeaveRequestApprovalRow = typeof leaveRequestApprovals.$inferSelect;

/** Mã lỗi nghiệp vụ LEAVE (SPEC-01 §9 `MODULE-ERR-XXX`) — surface qua HttpException payload.code. */
export const LEAVE_ERR = {
  NOT_FOUND: "LEAVE-ERR-REQUEST-NOT-FOUND",
  TYPE_NOT_FOUND: "LEAVE-ERR-TYPE-NOT-FOUND",
  TYPE_INACTIVE: "LEAVE-ERR-TYPE-INACTIVE",
  EMPLOYEE_NOT_ELIGIBLE: "LEAVE-ERR-EMPLOYEE-NOT-ELIGIBLE",
  DURATION_NOT_ALLOWED: "LEAVE-ERR-DURATION-NOT-ALLOWED",
  REASON_REQUIRED: "LEAVE-ERR-REASON-REQUIRED",
  NO_WORKING_DAY: "LEAVE-ERR-NO-WORKING-DAY",
  MIN_NOTICE: "LEAVE-ERR-MIN-NOTICE",
  REQUEST_OVERLAP: "LEAVE-ERR-REQUEST-OVERLAP",
  BALANCE_NOT_ENOUGH: "LEAVE-ERR-BALANCE-NOT-ENOUGH",
  INVALID_STATE: "LEAVE-ERR-INVALID-STATE",
  // ─── S3-LEAVE-BE-3 (approval workflow) ───────────────────────────────────────
  // approver === requester (SPEC-05 §14.9 MUST): người tạo đơn KHÔNG được tự duyệt (chặn ở service).
  APPROVER_INVALID: "LEAVE-ERR-APPROVER-INVALID",
  // Đơn nằm NGOÀI data-scope người duyệt (manager=Team / hr=Company) → 403 (đã có quyền pair, sai phạm vi).
  OUT_OF_SCOPE: "LEAVE-ERR-OUT-OF-SCOPE",
  // reject BẮT BUỘC lý do (Zod chặn ở boundary; backstop tại service khi reason rỗng).
  REASON_MISSING: "LEAVE-ERR-REJECT-REASON-REQUIRED",
  // ─── S3-LEAVE-BE-4 (type/policy admin CRUD + HR balance adjust ledger) ───────
  TYPE_CODE_DUPLICATE: "LEAVE-ERR-TYPE-CODE-DUPLICATE",
  POLICY_CODE_DUPLICATE: "LEAVE-ERR-POLICY-CODE-DUPLICATE",
  POLICY_NOT_FOUND: "LEAVE-ERR-POLICY-NOT-FOUND",
  BALANCE_NOT_FOUND: "LEAVE-ERR-BALANCE-NOT-FOUND",
  // adjust đưa remaining < 0 khi allow_negative_balance=false (chốt trong WHERE — race-safe).
  ADJUST_NEGATIVE_BALANCE: "LEAVE-ERR-ADJUST-NEGATIVE-BALANCE",
} as const;

/** TZ công ty mặc định (SPEC-01; SettingService per-company DEFERRED — dùng default VN). */
export const DEFAULT_COMPANY_TZ = "Asia/Ho_Chi_Minh";

/** Năm dương lịch của 'YYYY-MM-DD' — năm hạn mức đơn được kiểm/giữ chỗ. */
export function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

/** Làm tròn 2 chữ số — diệt float drift từ phép /8 và tổng 0.5. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Số ngày lịch từ `from` → `to` (dương khi to sau from). Thuần số học lịch, không tz. */
export function daysBetweenLocalDates(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const ms = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.round(ms / 86_400_000);
}

/** durationType → day_type của leave_request_days (CÓ khoảng trắng — chk_leave_request_days_day_type). */
export function mapDayType(durationType: string | null): string {
  if (durationType === "HalfDay") return "Half Day";
  if (durationType === "Hourly") return "Hourly";
  return "Full Day"; // FullDay / MultipleDays / null
}

export function numOrNull(v: string | null): number | null {
  return v != null ? Number(v) : null;
}

/** Loại nghỉ có cho phép durationType không (chỉ chặn khi cờ ĐƯỢC set false; null = chưa cấu hình → cho phép). */
export function assertDurationAllowed(type: LeaveTypeRow, durationType: LeaveDurationType): void {
  const allowed: Record<LeaveDurationType, boolean | null> = {
    FullDay: type.allowFullDay,
    HalfDay: type.allowHalfDay,
    Hourly: type.allowHourly,
    MultipleDays: type.allowMultipleDays,
  };
  if (allowed[durationType] === false) {
    throw new UnprocessableEntityException({
      code: LEAVE_ERR.DURATION_NOT_ALLOWED,
      message: `Loại nghỉ '${type.name}' không cho phép hình thức ${durationType}`,
    });
  }
}

/** Holiday ảnh hưởng LEAVE: Active + affectsLeaveCalculation (KHÔNG dùng affectsAttendance). */
export function buildLeaveHolidayDates(rows: readonly HolidayView[]): Set<string> {
  const set = new Set<string>();
  for (const h of rows) {
    if (h.status === "Active" && h.affectsLeaveCalculation === true) set.add(h.holidayDate);
  }
  return set;
}
