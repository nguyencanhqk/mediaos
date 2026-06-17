import { z } from "zod";
import {
  attendanceRecordSchema,
  attendanceTodaySchema,
  type AttendanceRecordDto,
  type AttendanceTodayDto,
  type CheckInRequest,
  type CheckOutRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./client";

/**
 * Attendance API client for mobile — self-service routes only (check-in/out, today, own monthly list).
 * Mirrors apps/api/src/attendance/attendance.controller.ts route-for-route. Every call attaches the
 * Bearer token and parses via the shared Zod contract. The server gates each route (PermissionGuard /
 * RLS, fail-closed) and scopes "own" data by req.user — the client never decides authorization.
 */
export const attendanceApi = {
  /** GET /attendance/today — today's record + applicable schedule (read:attendance). */
  getToday: (): Promise<AttendanceTodayDto> =>
    apiFetch("/attendance/today", attendanceTodaySchema, { authenticated: true }),

  /** GET /attendance?month=YYYY-MM — the caller's own monthly records (read:attendance, RLS-scoped). */
  listMonthly: (month: string): Promise<AttendanceRecordDto[]> =>
    apiFetch(`/attendance?month=${encodeURIComponent(month)}`, z.array(attendanceRecordSchema), {
      authenticated: true,
    }),

  /** POST /attendance/check-in — gated check-in:attendance. Mobile always sends method=mobile. */
  checkIn: (data: CheckInRequest): Promise<AttendanceRecordDto> =>
    apiFetch("/attendance/check-in", attendanceRecordSchema, {
      authenticated: true,
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** POST /attendance/check-out — gated check-out:attendance. Mobile always sends method=mobile. */
  checkOut: (data: CheckOutRequest): Promise<AttendanceRecordDto> =>
    apiFetch("/attendance/check-out", attendanceRecordSchema, {
      authenticated: true,
      method: "POST",
      body: JSON.stringify(data),
    }),
};
