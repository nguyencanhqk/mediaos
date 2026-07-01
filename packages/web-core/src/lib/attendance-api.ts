import {
  attendanceTodayV2Schema,
  attendanceRecordV2Schema,
  attendanceRecordListResponseSchema,
  attendanceRecordDetailSchema,
  // S3-ATT-BE-3 real DTOs (nguồn sự thật = packages/contracts/src/attendance.ts) — thay cho schema đoán cũ.
  shiftSchema,
  shiftListResponseSchema,
  shiftAssignmentSchema,
  shiftAssignmentListResponseSchema,
  attendanceRuleSchema,
  attendanceRuleListResponseSchema,
  type AttendanceTodayV2Dto,
  type AttendanceRecordV2Dto,
  type AttendanceRecordListResponse,
  type AttendanceRecordListQuery,
  type AttendanceRecordDetail,
  type CheckInRequest,
  type CheckOutRequest,
  type ShiftDto,
  type ShiftAssignmentDto,
  type AttendanceRuleDto,
  type CreateShiftRequest,
  type UpdateShiftRequest,
  type CreateShiftAssignmentRequest,
  type CreateRuleRequest,
  type UpdateRuleRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * ATT API client — S3-FE-REGISTRY-1 + S3-FE-ATT-5.
 *
 * BẤT BIẾN: company_id do SERVER resolve từ auth context — client KHÔNG nhận/forward.
 * Masking (location/gps/ip/device) là việc của SERVER — client chỉ render field nhận được (detail có
 * locationJson=null khi thiếu view-sensitive). Response validate Zod ở ranh giới (schema @mediaos/contracts).
 *
 * Scope gate là việc của SERVER (@RequirePermission view-own/team/company:attendance): 403 = thiếu grant,
 * out-of-scope-nhưng-tồn-tại = 404 (không lộ tồn tại). Client chỉ chọn endpoint theo cặp user có.
 *
 * Shift / Shift-assignment / Rule (S3-ATT-BE-3, PR #69): DTO thật từ @mediaos/contracts. GET trả envelope
 * `{ items: [...] }` (shiftListResponseSchema / shiftAssignmentListResponseSchema / attendanceRuleListResponseSchema)
 * → validate envelope rồi unwrap `.items` cho caller. CRUD tối thiểu (create/update) khớp POST/PATCH đã gated ở
 * AttendanceShiftController; nâng cao (bulk/delete UX) = carry-over CO-S4-007.
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

  // ── Ca làm việc (S3-ATT-BE-3, ATT-API-017/018/019) ──────────────────────────

  /**
   * GET /attendance/shifts — danh mục ca làm việc công ty. BE trả `{ items: ShiftDto[] }` → validate
   * envelope rồi trả mảng. Permission: view:shift (non-sensitive).
   */
  listShifts: (): Promise<ShiftDto[]> =>
    apiFetch("/attendance/shifts", shiftListResponseSchema).then((r) => r.items),

  /**
   * POST /attendance/shifts — tạo ca (MVP: Fixed/Flexible). Permission: create:shift.
   */
  createShift: (body: CreateShiftRequest): Promise<ShiftDto> =>
    apiFetch("/attendance/shifts", shiftSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * PATCH /attendance/shifts/:id — sửa ca (partial). Permission: update:shift.
   */
  updateShift: (id: string, body: UpdateShiftRequest): Promise<ShiftDto> =>
    apiFetch(`/attendance/shifts/${id}`, shiftSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // ── Gán ca (S3-ATT-BE-3, ATT-API-021/022) ───────────────────────────────────

  /**
   * GET /attendance/shift-assignments — danh sách gán ca. BE trả `{ items: ShiftAssignmentDto[] }`.
   * Permission: view:shift-assignment (sensitive).
   */
  listShiftAssignments: (): Promise<ShiftAssignmentDto[]> =>
    apiFetch("/attendance/shift-assignments", shiftAssignmentListResponseSchema).then(
      (r) => r.items,
    ),

  /**
   * POST /attendance/shift-assignments — tạo gán ca. Permission: update:shift-assignment.
   */
  createShiftAssignment: (body: CreateShiftAssignmentRequest): Promise<ShiftAssignmentDto> =>
    apiFetch("/attendance/shift-assignments", shiftAssignmentSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── Rule chấm công (S3-ATT-BE-3, ATT-API-023/024/025) ───────────────────────

  /**
   * GET /attendance/rules — danh sách rule chấm công. BE trả `{ items: AttendanceRuleDto[] }`.
   * Permission: view:attendance-rule (sensitive).
   */
  listRules: (): Promise<AttendanceRuleDto[]> =>
    apiFetch("/attendance/rules", attendanceRuleListResponseSchema).then((r) => r.items),

  /**
   * POST /attendance/rules — tạo rule. Permission: config:attendance-rule.
   */
  createRule: (body: CreateRuleRequest): Promise<AttendanceRuleDto> =>
    apiFetch("/attendance/rules", attendanceRuleSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * PATCH /attendance/rules/:id — sửa rule (partial, KHÔNG đổi scope/target). Permission: config:attendance-rule.
   */
  updateRule: (id: string, body: UpdateRuleRequest): Promise<AttendanceRuleDto> =>
    apiFetch(`/attendance/rules/${id}`, attendanceRuleSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
