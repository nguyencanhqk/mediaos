import { z } from "zod";

/**
 * G11-1 — Attendance contracts (chấm công, ca làm, đơn bổ sung công, khoá kỳ công).
 * ADR-0008: mọi instant là ISO datetime UTC; work_date là ngày LOCAL theo timezone ca ('YYYY-MM-DD').
 */

export const attendanceStatusSchema = z.enum([
  "present",
  "late",
  "early_leave",
  "absent",
  "missing_checkin",
  "pending_adjustment",
  "approved_adjustment",
]);
export type AttendanceStatusDto = z.infer<typeof attendanceStatusSchema>;

export const attendanceMethodSchema = z.enum(["web", "mobile", "manual", "adjustment"]);
export type AttendanceMethodDto = z.infer<typeof attendanceMethodSchema>;

export const hrRequestStatusSchema = z.enum(["pending", "approved", "rejected", "cancelled"]);
export type HrRequestStatusDto = z.infer<typeof hrRequestStatusSchema>;

/** 'YYYY-MM' (tháng công). */
export const periodMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");

// ─── work_schedules ───────────────────────────────────────────────────────────

const timeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Expected HH:MM");
/** Ngày làm việc ISO: 1=Thứ 2 … 7=Chủ nhật. */
const workingDaysSchema = z.array(z.number().int().min(1).max(7)).min(1).max(7);

export const workScheduleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  workType: z.enum(["fixed", "shift", "flexible"]),
  startTime: timeHHMM,
  endTime: timeHHMM,
  workingDays: workingDaysSchema,
  timezone: z.string(),
  graceMinutes: z.number().int().min(0).max(240),
  isDefault: z.boolean(),
  status: z.enum(["active", "inactive"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WorkScheduleDto = z.infer<typeof workScheduleSchema>;

export const createWorkScheduleSchema = z.object({
  name: z.string().min(1).max(200),
  workType: z.enum(["fixed", "shift", "flexible"]).default("fixed"),
  startTime: timeHHMM,
  endTime: timeHHMM,
  workingDays: workingDaysSchema.default([1, 2, 3, 4, 5]),
  timezone: z.string().min(1).default("Asia/Ho_Chi_Minh"),
  graceMinutes: z.number().int().min(0).max(240).default(0),
  isDefault: z.boolean().default(false),
});
export type CreateWorkScheduleRequest = z.infer<typeof createWorkScheduleSchema>;

export const updateWorkScheduleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  workType: z.enum(["fixed", "shift", "flexible"]).optional(),
  startTime: timeHHMM.optional(),
  endTime: timeHHMM.optional(),
  workingDays: workingDaysSchema.optional(),
  timezone: z.string().min(1).optional(),
  graceMinutes: z.number().int().min(0).max(240).optional(),
  isDefault: z.boolean().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
export type UpdateWorkScheduleRequest = z.infer<typeof updateWorkScheduleSchema>;

// ─── attendance_records ───────────────────────────────────────────────────────

export const attendanceRecordSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  userFullName: z.string().nullable().optional(),
  workDate: z.string().date(),
  workScheduleId: z.string().uuid().nullable(),
  checkInAt: z.string().datetime().nullable(),
  checkOutAt: z.string().datetime().nullable(),
  checkInMethod: attendanceMethodSchema.nullable(),
  checkOutMethod: attendanceMethodSchema.nullable(),
  lateMinutes: z.number().int().min(0),
  earlyLeaveMinutes: z.number().int().min(0),
  status: attendanceStatusSchema,
  note: z.string().nullable(),
});
export type AttendanceRecordDto = z.infer<typeof attendanceRecordSchema>;

const locationSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    label: z.string().max(200).optional(),
  })
  .optional();

/**
 * S3-ATT-BE-1 (DB-04): clientTime/clientTimezone là THAM CHIẾU — server time (logTime DEFAULT now())
 * mới authoritative cho mọi tính toán (chống client gian lận giờ). note tuỳ chọn cho log.
 */
export const checkInSchema = z.object({
  method: z.enum(["web", "mobile"]).default("web"),
  location: locationSchema,
  clientTime: z.string().datetime().optional(),
  clientTimezone: z.string().min(1).max(64).optional(),
  note: z.string().max(1000).optional(),
});
export type CheckInRequest = z.infer<typeof checkInSchema>;

export const checkOutSchema = z.object({
  method: z.enum(["web", "mobile"]).default("web"),
  location: locationSchema,
  clientTime: z.string().datetime().optional(),
  clientTimezone: z.string().min(1).max(64).optional(),
  note: z.string().max(1000).optional(),
});
export type CheckOutRequest = z.infer<typeof checkOutSchema>;

/** Trạng thái hôm nay cho dashboard: bản ghi (nếu có) + ca áp dụng. */
export const attendanceTodaySchema = z.object({
  workDate: z.string().date(),
  record: attendanceRecordSchema.nullable(),
  schedule: workScheduleSchema.nullable(),
  periodLocked: z.boolean(),
});
export type AttendanceTodayDto = z.infer<typeof attendanceTodaySchema>;

// ─── S3-ATT-BE-1 (DB-04 §7) — Today/check-in/check-out V2 (shift/rule effective) ────

/** Bản ghi chấm công V2 (cột legacy + DB-04 §7.4 additive). instant = ISO datetime UTC. */
export const attendanceRecordV2Schema = z.object({
  id: z.string().uuid(),
  workDate: z.string().date(),
  employeeId: z.string().uuid().nullable(),
  shiftId: z.string().uuid().nullable(),
  checkInAt: z.string().datetime().nullable(),
  checkOutAt: z.string().datetime().nullable(),
  checkInMethod: z.string().nullable(),
  checkOutMethod: z.string().nullable(),
  lateMinutes: z.number().int().min(0),
  earlyLeaveMinutes: z.number().int().min(0),
  workingMinutes: z.number().int().nullable(),
  requiredWorkingMinutes: z.number().int().nullable(),
  missingMinutes: z.number().int().nullable(),
  breakMinutes: z.number().int().nullable(),
  /** status lowercase legacy (present/late/early_leave/…) — feed payroll/back-compat. */
  status: z.string(),
  /** attendance_status TitleCase DB-04 (Checked-in/Late/Present/Early Leave/Missing Hours/…). */
  attendanceStatus: z.string().nullable(),
  isLate: z.boolean().nullable(),
  isEarlyLeave: z.boolean().nullable(),
  isMissingCheckOut: z.boolean().nullable(),
});
export type AttendanceRecordV2Dto = z.infer<typeof attendanceRecordV2Schema>;

/** Ca làm hiệu lực (rút gọn) cho màn Today. */
export const attendanceShiftSummarySchema = z.object({
  id: z.string().uuid(),
  shiftCode: z.string(),
  name: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  breakMinutes: z.number().int(),
  requiredWorkingMinutes: z.number().int(),
  graceLateMinutes: z.number().int(),
  graceEarlyLeaveMinutes: z.number().int(),
  crossDay: z.boolean(),
  isDefault: z.boolean(),
  timezone: z.string(),
});
export type AttendanceShiftSummaryDto = z.infer<typeof attendanceShiftSummarySchema>;

/** Rule chấm công hiệu lực (rút gọn) cho màn Today. */
export const attendanceRuleSummarySchema = z.object({
  id: z.string().uuid().nullable(),
  ruleCode: z.string().nullable(),
  requireCheckIn: z.boolean(),
  requireCheckOut: z.boolean(),
  blockWhenLeaveApproved: z.boolean(),
});
export type AttendanceRuleSummaryDto = z.infer<typeof attendanceRuleSummarySchema>;

/** GET /attendance/today V2 — employee/shift/rule/record + allowedActions + disabledReason. */
export const attendanceTodayV2Schema = z.object({
  workDate: z.string().date(),
  employee: z.object({ id: z.string().uuid(), status: z.string() }).nullable(),
  shift: attendanceShiftSummarySchema.nullable(),
  rule: attendanceRuleSummarySchema.nullable(),
  record: attendanceRecordV2Schema.nullable(),
  allowedActions: z.object({ canCheckIn: z.boolean(), canCheckOut: z.boolean() }),
  disabledReason: z.string().nullable(),
  periodLocked: z.boolean(),
});
export type AttendanceTodayV2Dto = z.infer<typeof attendanceTodayV2Schema>;

/** POST /attendance/check-in | check-out → bản ghi V2. */
export type CheckInResponse = AttendanceRecordV2Dto;
export type CheckOutResponse = AttendanceRecordV2Dto;

/** Generic pagination params: limit (1–100, default 50) + offset (≥0, default 0). */
export const listPaginationSchema = z.object({
  /** Số bản ghi tối đa trả về (1–100, mặc định 50). */
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Vị trí bắt đầu (≥0, mặc định 0). */
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListPaginationQuery = z.infer<typeof listPaginationSchema>;

export const attendanceListQuerySchema = z.object({
  month: periodMonthSchema,
  userId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AttendanceListQuery = z.infer<typeof attendanceListQuerySchema>;

// ─── attendance_adjustment_requests (LEGACY response shape — superseded S3-ATT-BE-4) ────
// reviewNoteSchema là SHARED với LEAVE (leave.dto.ts ReviewNoteDto dùng cùng schema) —
// KHÔNG xoá/đổi tên/đổi hình dạng ở đây. Canonical create/list/approve/reject/direct-adjust/
// detail DTO cho attendance_adjustment_requests (DB-04 §7.6, ATT-FUNC-018..022) chuyển XUỐNG
// CUỐI FILE (mục "S3-ATT-BE-4"), THAY THẾ createAdjustmentRequestSchema/adjustmentListQuerySchema/
// adjustmentRequestSchema cũ ở đây (lowercase status, scope me|all — không còn dùng). Writer cũ
// /attendance/adjustments (attendance.service.ts) converge sang canonical ở lane SVC kế tiếp
// (WO S3-ATT-BE-4 bước 3-4) — KHÔNG được giữ 2 hình dạng DTO song song sau converge.

export const reviewNoteSchema = z.object({
  note: z.string().max(1000).optional(),
});
export type ReviewNoteRequest = z.infer<typeof reviewNoteSchema>;

// ─── attendance_periods (khoá kỳ công) ────────────────────────────────────────

export const attendancePeriodSchema = z.object({
  id: z.string().uuid(),
  periodMonth: periodMonthSchema,
  status: z.enum(["open", "locked"]),
  lockedBy: z.string().uuid().nullable(),
  lockedAt: z.string().datetime().nullable(),
});
export type AttendancePeriodDto = z.infer<typeof attendancePeriodSchema>;

// ─── S3-ATT-BE-2 (API-10 §5.3) — scoped attendance records read ──────────────────
// my/team/company/detail/logs. Server-side scope (Own/Team/Company) + masking (BẤT BIẾN #3):
// location/gps/ip/device NEVER leak in lists; in detail/logs they are gated behind view-sensitive.

/** Sortable list columns (allowlist — repo maps each to a fixed column; blocks ORDER BY injection). */
export const ATTENDANCE_RECORD_SORT_FIELDS = [
  "workDate",
  "checkInAt",
  "checkOutAt",
  "lateMinutes",
  "earlyLeaveMinutes",
  "missingMinutes",
  "workingMinutes",
  "createdAt",
  "updatedAt",
] as const;
export const attendanceRecordSortFieldSchema = z.enum(ATTENDANCE_RECORD_SORT_FIELDS);
export type AttendanceRecordSortField = z.infer<typeof attendanceRecordSortFieldSchema>;

export const ATTENDANCE_RECORD_PAGE_SIZE_MAX = 100;
export const ATTENDANCE_RECORD_PAGE_SIZE_DEFAULT = 20;

/**
 * GET /attendance/{my-records,team-records,records} query — page-based pagination + filter + sort.
 * Query params arrive as strings → page/pageSize coerced; pageSize clamped to bound the result set.
 * Date filters form a half-open interval [fromDate, toDate) over work_date (toDate exclusive).
 */
export const attendanceRecordListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(ATTENDANCE_RECORD_PAGE_SIZE_MAX)
    .default(ATTENDANCE_RECORD_PAGE_SIZE_DEFAULT),
  /** Half-open [fromDate, toDate) over work_date. */
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
  /** Legacy lowercase record status (present/late/…). */
  status: attendanceStatusSchema.optional(),
  /** DB-04 TitleCase attendance_status (Present/Late/Missing Hours/…). */
  attendanceStatus: z.string().min(1).max(64).optional(),
  /** Filter by org_unit (Department) — honored on team/company lists only. */
  departmentId: z.string().uuid().optional(),
  shiftId: z.string().uuid().optional(),
  /** employee_profiles.id — honored only when scope permits (ignored on my-records). */
  employeeId: z.string().uuid().optional(),
  sort: attendanceRecordSortFieldSchema.default("workDate"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type AttendanceRecordListQuery = z.infer<typeof attendanceRecordListQuerySchema>;

/**
 * One row in a scoped records list — safe record columns (attendanceRecordV2Schema) + employee summary.
 * NO location_json / gps / ip / device (those live on attendance_logs and are never listed).
 */
export const attendanceRecordListItemSchema = attendanceRecordV2Schema.extend({
  userId: z.string().uuid(),
  employeeCode: z.string().nullable(),
  fullName: z.string().nullable(),
  orgUnitId: z.string().uuid().nullable(),
  orgUnitName: z.string().nullable(),
});
export type AttendanceRecordListItem = z.infer<typeof attendanceRecordListItemSchema>;

/** Paginated envelope meta (mirrors hrPageMetaSchema). */
export const attendanceRecordPageMetaSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});
export type AttendanceRecordPageMeta = z.infer<typeof attendanceRecordPageMetaSchema>;

export const attendanceRecordListResponseSchema = z.object({
  items: z.array(attendanceRecordListItemSchema),
  meta: attendanceRecordPageMetaSchema,
});
export type AttendanceRecordListResponse = z.infer<typeof attendanceRecordListResponseSchema>;

/**
 * GET /attendance/records/:id detail — list item + the record-only `location_json` (SENSITIVE, gated
 * behind view-sensitive:attendance → null when unauthorized) + extra status/source/timestamp columns.
 */
export const attendanceRecordDetailSchema = attendanceRecordListItemSchema.extend({
  /** SENSITIVE (view-sensitive:attendance) — null when unauthorized. jsonb → unknown. */
  locationJson: z.unknown().nullable(),
  workScheduleId: z.string().uuid().nullable(),
  checkInStatus: z.string().nullable(),
  checkOutStatus: z.string().nullable(),
  attendanceSource: z.string().nullable(),
  workMode: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AttendanceRecordDetail = z.infer<typeof attendanceRecordDetailSchema>;

/**
 * GET /attendance/records/:id/logs — one attendance_logs row. Sensitive fields (gps/ip/device/
 * locationLabel/userAgent/rawPayload) are null unless the caller holds view-sensitive:attendance.
 * There is NO own-record bypass: an employee viewing their OWN logs still sees gps=null.
 */
export const attendanceLogListItemSchema = z.object({
  id: z.string().uuid(),
  logType: z.string(),
  logTime: z.string().datetime(),
  source: z.string(),
  platform: z.string().nullable(),
  clientTime: z.string().datetime().nullable(),
  clientTimezone: z.string().nullable(),
  isValid: z.boolean(),
  invalidReason: z.string().nullable(),
  note: z.string().nullable(),
  workDate: z.string().date(),
  // SENSITIVE (view-sensitive:attendance) — all null unless revealed.
  gpsLatitude: z.string().nullable(),
  gpsLongitude: z.string().nullable(),
  gpsAccuracyMeters: z.string().nullable(),
  locationLabel: z.string().nullable(),
  ipAddress: z.string().nullable(),
  deviceId: z.string().nullable(),
  deviceName: z.string().nullable(),
  userAgent: z.string().nullable(),
  rawPayload: z.unknown().nullable(),
});
export type AttendanceLogListItem = z.infer<typeof attendanceLogListItemSchema>;

export const attendanceLogListResponseSchema = z.object({
  items: z.array(attendanceLogListItemSchema),
});
export type AttendanceLogListResponse = z.infer<typeof attendanceLogListResponseSchema>;

// ─── S3-ATT-BE-4 (DB-04 §7.6/§7.7, ATT-FUNC-018..022) — canonical adjustment-request DTOs ────
//
// Thay thế createAdjustmentRequestSchema/adjustmentListQuerySchema/adjustmentRequestSchema cũ
// (khai báo phía trên, lowercase status, scope me|all) — canonical status TitleCase
// (Draft/Pending/Approved/Rejected/Cancelled, mig 0457 chk_att_adj_requests_status) + request_type
// 9-enum (mig 0452/0457 chk_att_adj_requests_request_type) + items[] ledger (attendance_adjustment_items
// §7.7, APPEND-ONLY — is_applied/appliedValue server-set, KHÔNG nhận từ client).
// reviewNoteSchema (phía trên) GIỮ NGUYÊN cho LEAVE — không dùng lại ở đây (approve/reject dưới
// đây có schema riêng, review_note là 1 cột DUY NHẤT ở DB nhưng client gọi 2 field tên khác nhau
// approve.note / reject.reason, giống pattern approveLeaveRequestSchema/rejectLeaveRequestSchema).

/** 9 loại yêu cầu điều chỉnh công (ATT-FUNC-018 bảng "Loại yêu cầu điều chỉnh"). */
export const ATTENDANCE_ADJUSTMENT_REQUEST_TYPES = [
  "MISSING_CHECK_IN",
  "MISSING_CHECK_OUT",
  "UPDATE_CHECK_IN",
  "UPDATE_CHECK_OUT",
  "EXPLAIN_LATE",
  "EXPLAIN_EARLY_LEAVE",
  "UPDATE_STATUS",
  "REMOTE_CORRECTION",
  "OTHER",
] as const;
export const attendanceAdjustmentRequestTypeSchema = z.enum(ATTENDANCE_ADJUSTMENT_REQUEST_TYPES);
export type AttendanceAdjustmentRequestType = z.infer<typeof attendanceAdjustmentRequestTypeSchema>;

/** FSM canonical (DB-04 §7.6): Draft → Pending → Approved | Rejected | Cancelled (terminal). */
export const ATTENDANCE_ADJUSTMENT_STATUSES = [
  "Draft",
  "Pending",
  "Approved",
  "Rejected",
  "Cancelled",
] as const;
export const attendanceAdjustmentStatusSchema = z.enum(ATTENDANCE_ADJUSTMENT_STATUSES);
export type AttendanceAdjustmentStatus = z.infer<typeof attendanceAdjustmentStatusSchema>;

/**
 * Field cho phép trong 1 item điều chỉnh (ATT-FUNC-021 "Trường được phép điều chỉnh" — camelCase
 * khớp attendanceRecordV2Schema; KHÔNG gồm adjustment_reason — đó là `reason` top-level của request).
 */
export const ATTENDANCE_ADJUSTMENT_ITEM_FIELDS = [
  "checkInAt",
  "checkOutAt",
  "attendanceStatus",
  "workingMinutes",
  "requiredWorkingMinutes",
  "lateMinutes",
  "earlyLeaveMinutes",
  "missingMinutes",
  "note",
] as const;
export const attendanceAdjustmentItemFieldSchema = z.enum(ATTENDANCE_ADJUSTMENT_ITEM_FIELDS);
export type AttendanceAdjustmentItemField = z.infer<typeof attendanceAdjustmentItemFieldSchema>;

/** newValue nguyên thuỷ (jsonb ở DB) — giới hạn primitive để tránh object lồng tuỳ ý qua input. */
const adjustmentItemValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * 1 item field-change đề xuất trong create-request/direct-adjust. oldValue/appliedValue/isApplied
 * KHÔNG nhận từ client (server tự đọc bản ghi hiện tại + set is_applied khi Approved/direct-adjust —
 * attendance_adjustment_items §7.7 APPEND-ONLY, client không được giả mạo old/applied value).
 */
export const adjustmentItemInputSchema = z.object({
  fieldName: attendanceAdjustmentItemFieldSchema,
  newValue: adjustmentItemValueSchema,
  note: z.string().max(500).optional(),
});
export type AdjustmentItemInput = z.infer<typeof adjustmentItemInputSchema>;

const CHECK_IN_REQUEST_TYPES = ["MISSING_CHECK_IN", "UPDATE_CHECK_IN"] as const;
const CHECK_OUT_REQUEST_TYPES = ["MISSING_CHECK_OUT", "UPDATE_CHECK_OUT"] as const;

/**
 * POST /attendance/adjustment-requests (ATT-FUNC-018). employee_id/status/submitted_at/requested_by
 * là server-authoritative — KHÔNG có trong body (Zod strip key lạ). targetEmployeeId CHỈ dùng khi actor
 * có quyền tạo thay (vd HR/Admin) — server gate ở tầng Service/Guard, KHÔNG tự suy ra quyền từ trường
 * này có mặt hay không (thiếu quyền mà vẫn gửi → 403, KHÔNG âm thầm bỏ qua).
 */
export const createAdjustmentRequestSchema = z
  .object({
    workDate: z.string().date(),
    requestType: attendanceAdjustmentRequestTypeSchema,
    reason: z.string().min(3).max(1000),
    requestedCheckInAt: z.string().datetime().nullable().optional(),
    requestedCheckOutAt: z.string().datetime().nullable().optional(),
    items: z.array(adjustmentItemInputSchema).max(20).optional(),
    attachmentFileId: z.string().uuid().optional(),
    /** Tạo hộ nhân viên khác — optional, gate quyền ở server (create-thay). */
    targetEmployeeId: z.string().uuid().optional(),
  })
  .refine(
    (v) =>
      v.requestedCheckInAt == null ||
      v.requestedCheckOutAt == null ||
      v.requestedCheckOutAt >= v.requestedCheckInAt,
    { message: "Check-out đề nghị phải sau check-in đề nghị", path: ["requestedCheckOutAt"] },
  )
  .refine(
    (v) =>
      !(CHECK_IN_REQUEST_TYPES as readonly string[]).includes(v.requestType) ||
      v.requestedCheckInAt != null,
    { message: "Loại yêu cầu này bắt buộc requestedCheckInAt", path: ["requestedCheckInAt"] },
  )
  .refine(
    (v) =>
      !(CHECK_OUT_REQUEST_TYPES as readonly string[]).includes(v.requestType) ||
      v.requestedCheckOutAt != null,
    { message: "Loại yêu cầu này bắt buộc requestedCheckOutAt", path: ["requestedCheckOutAt"] },
  );
export type CreateAdjustmentRequest = z.infer<typeof createAdjustmentRequestSchema>;

/**
 * GET /attendance/adjustment-requests(/my) query — scope me|team|company (DataScope, ATT-FUNC-022);
 * status filter TitleCase canonical; page/pageSize khớp pattern attendanceRecordListQuerySchema.
 */
export const adjustmentListQuerySchema = z.object({
  /** 'me' (mặc định) = đơn của tôi; 'team'/'company' cần view-team/view-company:adjustment. */
  scope: z.enum(["me", "team", "company"]).default("me"),
  status: attendanceAdjustmentStatusSchema.optional(),
  requestType: attendanceAdjustmentRequestTypeSchema.optional(),
  /** Chỉ có hiệu lực khi scope team/company (bỏ qua trên scope me). */
  employeeId: z.string().uuid().optional(),
  /** [fromDate, toDate] inclusive trên work_date. */
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(ATTENDANCE_RECORD_PAGE_SIZE_MAX)
    .default(ATTENDANCE_RECORD_PAGE_SIZE_DEFAULT),
});
export type AdjustmentListQuery = z.infer<typeof adjustmentListQuerySchema>;

/**
 * POST /attendance/adjustment-requests/:id/approve (ATT-FUNC-019). note tuỳ chọn — map DB review_note.
 * Pending→Approved CHỈ (FSM terminal Approved/Rejected/Cancelled — approve lại → 409, service layer).
 */
export const approveAdjustmentSchema = z.object({
  note: z.string().max(1000).optional(),
});
export type ApproveAdjustmentRequest = z.infer<typeof approveAdjustmentSchema>;

/**
 * POST /attendance/adjustment-requests/:id/reject (ATT-FUNC-020). reason BẮT BUỘC (DB-04 §7.6 quy tắc 7
 * "Khi Rejected, bắt buộc có review_note") — map DB review_note. Pending→Rejected CHỈ.
 */
export const rejectAdjustmentSchema = z.object({
  reason: z.string().min(1, "Lý do từ chối là bắt buộc").max(2000),
});
export type RejectAdjustmentRequest = z.infer<typeof rejectAdjustmentSchema>;

/**
 * POST /attendance/records/:id/adjust-direct HOẶC theo (employeeId, workDate) khi chưa có record
 * (ATT-FUNC-021, quyền adjust-direct:attendance). reason BẮT BUỘC (adjustment_reason). items[] ≥1 —
 * mọi field áp dụng ngay (is_applied=true) trong cùng transaction, KHÔNG qua vòng duyệt Pending.
 */
export const directAdjustSchema = z
  .object({
    recordId: z.string().uuid().optional(),
    employeeId: z.string().uuid().optional(),
    workDate: z.string().date().optional(),
    items: z.array(adjustmentItemInputSchema).min(1).max(20),
    reason: z.string().min(3).max(1000),
  })
  .refine((v) => v.recordId != null || (v.employeeId != null && v.workDate != null), {
    message: "Cần recordId hoặc (employeeId + workDate) để xác định bản ghi công",
    path: ["recordId"],
  });
export type DirectAdjustRequest = z.infer<typeof directAdjustSchema>;

/** 1 item lịch sử điều chỉnh (response — attendance_adjustment_items §7.7, APPEND-ONLY ledger). */
export const attendanceAdjustmentItemDtoSchema = z.object({
  id: z.string().uuid(),
  fieldName: z.string(),
  oldValue: z.unknown().nullable(),
  newValue: z.unknown(),
  appliedValue: z.unknown().nullable(),
  isApplied: z.boolean(),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AttendanceAdjustmentItemDto = z.infer<typeof attendanceAdjustmentItemDtoSchema>;

/**
 * GET /attendance/adjustment-requests/:id detail (ATT-FUNC-022) — request đầy đủ + items[] ledger.
 * reviewNote null cho đơn Pending/Draft; requestedBy/currentApproverUserId để FE resolve tên.
 */
export const attendanceAdjustmentRequestDetailSchema = z.object({
  id: z.string().uuid(),
  requestCode: z.string().nullable(),
  employeeId: z.string().uuid().nullable(),
  employeeCode: z.string().nullable(),
  fullName: z.string().nullable(),
  attendanceRecordId: z.string().uuid().nullable(),
  workDate: z.string().date(),
  requestType: attendanceAdjustmentRequestTypeSchema,
  requestedCheckInAt: z.string().datetime().nullable(),
  requestedCheckOutAt: z.string().datetime().nullable(),
  reason: z.string(),
  status: attendanceAdjustmentStatusSchema,
  submittedAt: z.string().datetime().nullable(),
  requestedBy: z.string().uuid().nullable(),
  currentApproverUserId: z.string().uuid().nullable(),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  reviewNote: z.string().nullable(),
  attachmentFileId: z.string().uuid().nullable(),
  items: z.array(attendanceAdjustmentItemDtoSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AttendanceAdjustmentRequestDetail = z.infer<
  typeof attendanceAdjustmentRequestDetailSchema
>;

/** 1 dòng danh sách (GET /attendance/adjustment-requests) — detail KHÔNG kèm items[] (gọn cho list). */
export const attendanceAdjustmentListItemSchema = attendanceAdjustmentRequestDetailSchema.omit({
  items: true,
});
export type AttendanceAdjustmentListItem = z.infer<typeof attendanceAdjustmentListItemSchema>;

/** Envelope danh sách — {items, meta} khớp pattern attendanceRecordListResponseSchema. */
export const attendanceAdjustmentListResponseSchema = z.object({
  items: z.array(attendanceAdjustmentListItemSchema),
  meta: attendanceRecordPageMetaSchema,
});
export type AttendanceAdjustmentListResponse = z.infer<
  typeof attendanceAdjustmentListResponseSchema
>;
