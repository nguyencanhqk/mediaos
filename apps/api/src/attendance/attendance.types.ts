/**
 * S3-ATT-BE-1 — shared value types & constants for the attendance application service.
 *
 * Extracted from attendance.service.ts (behavior-preserving): the pure mappers/builders and the
 * orchestration service both depend on these shapes, so they live in one dependency-free module.
 */

import type { AttendanceRepository } from "./attendance.repository";

export const DEFAULT_TZ = "Asia/Ho_Chi_Minh";
/** Business-key của rule mặc định (đồng bộ AttMasterDataSeeder ATT_DEFAULT_RULE_CODE). */
export const ATT_DEFAULT_RULE_CODE = "DEFAULT_OFFICE_RULE";
export const NO_EMPLOYEE_MSG = "Tài khoản chưa liên kết hồ sơ nhân sự";

export interface Actor {
  id: string;
  companyId: string;
}

/** Hồ sơ nhân sự đã resolve server-side (BẤT BIẾN: KHÔNG tin employee_id client). */
export type ResolvedEmployee = {
  id: string;
  status: string;
  orgUnitId: string | null;
  positionId: string | null;
};

/** Ca làm hiệu lực rút gọn (từ SHIFT_FIELDS) — null = không có ca hiệu lực. */
export type ShiftRow = NonNullable<Awaited<ReturnType<AttendanceRepository["findDefaultShiftTx"]>>>;

/** Rule chấm công hiệu lực đã chuẩn hoá (in-code default khi DB không có). */
export interface EffectiveRule {
  id: string | null;
  ruleCode: string | null;
  requireCheckIn: boolean;
  requireCheckOut: boolean;
  blockWhenLeaveApproved: boolean;
}

export const DEFAULT_RULE: EffectiveRule = {
  id: null,
  ruleCode: null,
  requireCheckIn: true,
  requireCheckOut: true,
  blockWhenLeaveApproved: true,
};

/** Insert shape cho attendance_logs (company_id do repo gắn từ ngữ cảnh). */
export type AttendanceLogInsert = Parameters<AttendanceRepository["insertAttendanceLogTx"]>[1];

export type ScheduleRow = Awaited<ReturnType<AttendanceRepository["findSchedules"]>>[number];

/** Một attendance_records row (superset) → DTO V2 trả REST/WS. */
export interface RecordRowForDto {
  id: string;
  workDate: string;
  employeeId: string | null;
  shiftId: string | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  checkInMethod: string | null;
  checkOutMethod: string | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  workingMinutes: number | null;
  requiredWorkingMinutes: number | null;
  missingMinutes: number | null;
  breakMinutes: number | null;
  status: string;
  attendanceStatus: string | null;
  isLate: boolean | null;
  isEarlyLeave: boolean | null;
  isMissingCheckOut: boolean | null;
}
