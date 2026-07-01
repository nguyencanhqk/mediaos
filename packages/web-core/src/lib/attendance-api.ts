import {
  attendanceTodayV2Schema,
  attendanceRecordV2Schema,
  attendanceRecordListResponseSchema,
  attendanceRecordDetailSchema,
  type AttendanceTodayV2Dto,
  type AttendanceRecordV2Dto,
  type AttendanceRecordListResponse,
  type AttendanceRecordListQuery,
  type AttendanceRecordDetail,
  type CheckInRequest,
  type CheckOutRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * ATT API client — S3-FE-REGISTRY-1. Tất cả endpoint cần Bearer (apiFetch gắn tự động).
 *
 * BẤT BIẾN: company_id do SERVER resolve từ auth context — client KHÔNG nhận/forward.
 * Masking (location/gps/ip/device) là việc của SERVER — client chỉ render field nhận được (detail có
 * locationJson=null khi thiếu view-sensitive). Response validate Zod ở ranh giới (schema @mediaos/contracts).
 *
 * Scope gate là việc của SERVER (@RequirePermission view-own/team/company:attendance): 403 = thiếu grant,
 * out-of-scope-nhưng-tồn-tại = 404 (không lộ tồn tại). Client chỉ chọn endpoint theo cặp user có.
 */
export const attendanceApi = {
  // ── Hôm nay + check-in/out ─────────────────────────────────────────────────

  /**
   * GET /attendance/today — trạng thái chấm công hôm nay (employee/shift/rule/record + allowedActions).
   * Permission: view-own:attendance.
   */
  getToday: (): Promise<AttendanceTodayV2Dto> =>
    apiFetch("/attendance/today", attendanceTodayV2Schema),

  /**
   * POST /attendance/check-in — chấm vào. Server-time là authoritative (chống gian lận giờ client).
   * Permission: check-in:attendance.
   */
  checkIn: (body: CheckInRequest): Promise<AttendanceRecordV2Dto> =>
    apiFetch("/attendance/check-in", attendanceRecordV2Schema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * POST /attendance/check-out — chấm ra.
   * Permission: check-out:attendance.
   */
  checkOut: (body: CheckOutRequest): Promise<AttendanceRecordV2Dto> =>
    apiFetch("/attendance/check-out", attendanceRecordV2Schema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Bảng công (scoped: Own / Team / Company) ───────────────────────────────

  /**
   * GET /attendance/my-records — bảng công của tôi (phân trang + lọc + sort).
   * Permission: view-own:attendance.
   */
  listMyRecords: (
    query?: Partial<AttendanceRecordListQuery>,
  ): Promise<AttendanceRecordListResponse> =>
    apiFetch(
      `/attendance/my-records${buildQueryString(query ?? {})}`,
      attendanceRecordListResponseSchema,
    ),

  /**
   * GET /attendance/team-records — bảng công phạm vi Team (scope + masking server-side).
   * Permission: view-team:attendance.
   */
  listTeamRecords: (
    query?: Partial<AttendanceRecordListQuery>,
  ): Promise<AttendanceRecordListResponse> =>
    apiFetch(
      `/attendance/team-records${buildQueryString(query ?? {})}`,
      attendanceRecordListResponseSchema,
    ),

  /**
   * GET /attendance/records — bảng công phạm vi Company.
   * Permission: view-company:attendance.
   */
  listRecords: (
    query?: Partial<AttendanceRecordListQuery>,
  ): Promise<AttendanceRecordListResponse> =>
    apiFetch(
      `/attendance/records${buildQueryString(query ?? {})}`,
      attendanceRecordListResponseSchema,
    ),

  /**
   * GET /attendance/records/:id — chi tiết 1 bản ghi. locationJson (SENSITIVE) = null khi thiếu
   * view-sensitive:attendance (masking server-side, không có bypass own-record).
   * Permission: view-detail:attendance.
   */
  getRecord: (id: string): Promise<AttendanceRecordDetail> =>
    apiFetch(`/attendance/records/${id}`, attendanceRecordDetailSchema),
};
