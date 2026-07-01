import { z } from "zod";
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
 * S3-FE-ATT-5 — Shift / Shift-assignment / Rule (read-only minimum, danh mục nhỏ theo company).
 *
 * BE-3 (S3-ATT-BE-3, harness/backlog.mjs) CHƯA build lúc viết lane này (status=todo) → schema dưới đây
 * là PROVISIONAL, suy từ DB-04 §7.1–§7.3 (cấu trúc cột) + API-04 §11.11–§11.13 (request body tạo mới,
 * suy ngược field response) + FRONTEND-09 §"Attendance rule". KHÔNG đặt trong packages/contracts (ngoài
 * phạm vi lane này) — khi BE-3 land, promote sang @mediaos/contracts + xoá bản local. CRUD (create/update/
 * delete) carry-over CO-S4-007 (giữ tối thiểu = list, theo done_when S3-FE-ATT-5).
 */
const attShiftListItemSchema = z.object({
  id: z.string().uuid(),
  shiftCode: z.string(),
  name: z.string(),
  shiftType: z.string(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  requiredWorkingMinutes: z.number().nullable().optional(),
  isDefault: z.boolean().optional(),
  status: z.string(),
});
export type AttShiftListItem = z.infer<typeof attShiftListItemSchema>;

const attShiftAssignmentListItemSchema = z.object({
  id: z.string().uuid(),
  shiftId: z.string().uuid(),
  shiftName: z.string().nullable().optional(),
  assignmentScope: z.string(),
  departmentId: z.string().uuid().nullable().optional(),
  employeeId: z.string().uuid().nullable().optional(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable().optional(),
  priority: z.number(),
  status: z.string(),
});
export type AttShiftAssignmentListItem = z.infer<typeof attShiftAssignmentListItemSchema>;

const attRuleListItemSchema = z.object({
  id: z.string().uuid(),
  ruleCode: z.string(),
  name: z.string(),
  ruleScope: z.string(),
  departmentId: z.string().uuid().nullable().optional(),
  employeeId: z.string().uuid().nullable().optional(),
  priority: z.number(),
  effectiveFrom: z.string().nullable().optional(),
  effectiveTo: z.string().nullable().optional(),
  status: z.string(),
});
export type AttRuleListItem = z.infer<typeof attRuleListItemSchema>;

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

  // ── Ca làm việc / Gán ca / Rule chấm công (Company, read-only minimum) ─────

  /**
   * GET /attendance/shifts — danh mục ca làm việc công ty (không phân trang, danh mục nhỏ).
   * Permission: view:shift (non-sensitive).
   */
  listShifts: (): Promise<AttShiftListItem[]> =>
    apiFetch("/attendance/shifts", z.array(attShiftListItemSchema)),

  /**
   * GET /attendance/shift-assignments — danh sách gán ca (Company/Department/Employee scope).
   * Permission: view:shift-assignment (sensitive).
   */
  listShiftAssignments: (): Promise<AttShiftAssignmentListItem[]> =>
    apiFetch("/attendance/shift-assignments", z.array(attShiftAssignmentListItemSchema)),

  /**
   * GET /attendance/rules — danh sách rule chấm công theo phạm vi.
   * Permission: view:attendance-rule (sensitive).
   */
  listRules: (): Promise<AttRuleListItem[]> =>
    apiFetch("/attendance/rules", z.array(attRuleListItemSchema)),
};
