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
  // S3-ATT-BE-4 canonical adjustment-request DTOs (nguồn sự thật attendance.ts §"S3-ATT-BE-4").
  attendanceAdjustmentListResponseSchema,
  attendanceAdjustmentRequestDetailSchema,
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
  type AdjustmentListQuery,
  type CreateAdjustmentRequest,
  type ApproveAdjustmentRequest,
  type RejectAdjustmentRequest,
  type DirectAdjustRequest,
  type AttendanceAdjustmentListResponse,
  type AttendanceAdjustmentRequestDetail,
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

  // ── Đơn điều chỉnh công (S3-FE-ATT-3, S3-ATT-BE-4 — ATT-FUNC-018..022) ──────
  //
  // create/approve/reject/adjust-direct đều trả về `AttendanceAdjustmentRequestDetail` đầy đủ (BE
  // service.loadDetailTx) — cùng 1 schema validator cho mọi mutation + getDetail. view-own/view-team/
  // view-company/approve/reject:adjustment là cặp SENSITIVE nhưng KHÔNG nằm trong
  // SENSITIVE_CAPABILITY_ALLOWLIST (permission.service.ts) → FE useCan/useCanExact trên các cặp này LUÔN
  // false (kể cả người có quyền thật) — component gọi các hàm dưới đây KHÔNG được front-gate render bằng
  // useCan trên các cặp đó (xem AttendanceRecordDetailPage.tsx cho pattern tương tự); server 403/404 là
  // cổng thật, FE chỉ hiển thị theo response.

  /**
   * POST /attendance/adjustment-requests — tạo đơn điều chỉnh (Own, hoặc thay nhân viên khác nếu actor có
   * scope rộng hơn Own). Permission: create-own:adjustment (non-sensitive → useCan an toàn).
   */
  createAdjustmentRequest: (
    body: CreateAdjustmentRequest,
  ): Promise<AttendanceAdjustmentRequestDetail> =>
    apiFetch("/attendance/adjustment-requests", attendanceAdjustmentRequestDetailSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * GET /attendance/adjustment-requests/my — đơn của tôi. Permission: view-own:adjustment (sensitive,
   * KHÔNG allowlisted — KHÔNG front-gate bằng useCan, xem ghi chú đầu mục).
   */
  listMyAdjustmentRequests: (
    query?: Partial<AdjustmentListQuery>,
  ): Promise<AttendanceAdjustmentListResponse> =>
    apiFetch(
      `/attendance/adjustment-requests/my${buildQueryString(query ?? {})}`,
      attendanceAdjustmentListResponseSchema,
    ),

  /**
   * GET /attendance/adjustment-requests/team — đơn phạm vi Team. Permission: view-team:adjustment
   * (sensitive, KHÔNG allowlisted).
   */
  listTeamAdjustmentRequests: (
    query?: Partial<AdjustmentListQuery>,
  ): Promise<AttendanceAdjustmentListResponse> =>
    apiFetch(
      `/attendance/adjustment-requests/team${buildQueryString(query ?? {})}`,
      attendanceAdjustmentListResponseSchema,
    ),

  /**
   * GET /attendance/adjustment-requests — đơn phạm vi Company. Permission: view-company:adjustment
   * (sensitive, KHÔNG allowlisted).
   */
  listCompanyAdjustmentRequests: (
    query?: Partial<AdjustmentListQuery>,
  ): Promise<AttendanceAdjustmentListResponse> =>
    apiFetch(
      `/attendance/adjustment-requests${buildQueryString(query ?? {})}`,
      attendanceAdjustmentListResponseSchema,
    ),

  /** GET /attendance/adjustment-requests/:id — chi tiết + items[] ledger (append-only). */
  getAdjustmentRequest: (id: string): Promise<AttendanceAdjustmentRequestDetail> =>
    apiFetch(`/attendance/adjustment-requests/${id}`, attendanceAdjustmentRequestDetailSchema),

  /**
   * POST /attendance/adjustment-requests/:id/approve — Pending→Approved (áp dụng vào attendance_records).
   * Permission: approve:adjustment (sensitive, KHÔNG allowlisted).
   */
  approveAdjustmentRequest: (
    id: string,
    body: ApproveAdjustmentRequest,
  ): Promise<AttendanceAdjustmentRequestDetail> =>
    apiFetch(
      `/attendance/adjustment-requests/${id}/approve`,
      attendanceAdjustmentRequestDetailSchema,
      { method: "POST", body: JSON.stringify(body) },
    ),

  /**
   * POST /attendance/adjustment-requests/:id/reject — Pending→Rejected (reason bắt buộc, contract validate).
   * Permission: reject:adjustment (sensitive, KHÔNG allowlisted).
   */
  rejectAdjustmentRequest: (
    id: string,
    body: RejectAdjustmentRequest,
  ): Promise<AttendanceAdjustmentRequestDetail> =>
    apiFetch(
      `/attendance/adjustment-requests/${id}/reject`,
      attendanceAdjustmentRequestDetailSchema,
      { method: "POST", body: JSON.stringify(body) },
    ),

  /**
   * POST /attendance/records/:id/adjust-direct — áp dụng NGAY (KHÔNG qua vòng duyệt Pending).
   * Permission: adjust-direct:attendance (sensitive, KHÔNG allowlisted).
   */
  adjustRecordDirect: (
    recordId: string,
    body: DirectAdjustRequest,
  ): Promise<AttendanceAdjustmentRequestDetail> =>
    apiFetch(
      `/attendance/records/${recordId}/adjust-direct`,
      attendanceAdjustmentRequestDetailSchema,
      { method: "POST", body: JSON.stringify(body) },
    ),
};
