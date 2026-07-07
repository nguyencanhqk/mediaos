import { z } from "zod";
import { hrRequestStatusSchema } from "./attendance";

/**
 * G11-2 — Leave contracts (loại nghỉ, số phép, đơn nghỉ, lịch nghỉ team).
 * Đơn nghỉ duyệt qua Task Hub (task_type='hr'); trừ phép CHỈ lúc duyệt.
 */

// ─── Leave type codes (canonical) — S3-LEAVE-SEED-2 ───────────────────────────
//
// CHỐT 2026-07-04 (owner, DB-10 §14.3 reconcile): "code thắng" — giữ mã NGẮN hiện có (ANNUAL/SICK/UNPAID/
// OTHER) vì `leave_requests.leave_type_id` (FK) đã có dữ liệu tham chiếu qua `leave_types.code` này ở môi
// trường đang chạy; đổi sang mã dài `_LEAVE` (bản nháp DB-10 §14.3 cũ) sẽ cần 1 migration DATA riêng —
// KHÔNG làm ở lane này. DB-10 §14.3 đã cập nhật dòng CHỐT khớp bảng mã ngắn này (xem doc).
//
// Đây là NGUỒN SỰ THẬT DUY NHẤT cho mã loại nghỉ — seeder (`apps/api/src/leave/leave-master-data.seeder.ts`)
// và FE PHẢI import `LEAVE_TYPE_CODES`/`leaveTypeCodeSchema` từ đây, KHÔNG hard-code chuỗi trùng lặp.
export const LEAVE_TYPE_CODES = {
  ANNUAL: "ANNUAL",
  SICK: "SICK",
  UNPAID: "UNPAID",
  OTHER: "OTHER",
  MATERNITY: "MATERNITY",
  MARRIAGE: "MARRIAGE",
  BEREAVEMENT: "BEREAVEMENT",
  COMPENSATORY: "COMPENSATORY",
} as const;

export const leaveTypeCodeSchema = z.enum([
  LEAVE_TYPE_CODES.ANNUAL,
  LEAVE_TYPE_CODES.SICK,
  LEAVE_TYPE_CODES.UNPAID,
  LEAVE_TYPE_CODES.OTHER,
  LEAVE_TYPE_CODES.MATERNITY,
  LEAVE_TYPE_CODES.MARRIAGE,
  LEAVE_TYPE_CODES.BEREAVEMENT,
  LEAVE_TYPE_CODES.COMPENSATORY,
]);
export type LeaveTypeCode = z.infer<typeof leaveTypeCodeSchema>;

// ─── leave_types ──────────────────────────────────────────────────────────────

export const leaveTypeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  paid: z.boolean(),
  /** Hạn mức năm (ngày). null = không giới hạn. */
  annualQuota: z.number().nullable(),
  status: z.enum(["active", "inactive"]),
});
export type LeaveTypeDto = z.infer<typeof leaveTypeSchema>;

export const createLeaveTypeSchema = z.object({
  name: z.string().min(1).max(200),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_-]+$/, "Code chỉ gồm a-z, 0-9, '-', '_'"),
  paid: z.boolean().default(true),
  annualQuota: z.number().min(0).max(366).nullable().optional(),
});
export type CreateLeaveTypeRequest = z.infer<typeof createLeaveTypeSchema>;

export const updateLeaveTypeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  paid: z.boolean().optional(),
  annualQuota: z.number().min(0).max(366).nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
export type UpdateLeaveTypeRequest = z.infer<typeof updateLeaveTypeSchema>;

// ─── leave_balances ───────────────────────────────────────────────────────────

export const leaveBalanceSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  userFullName: z.string().nullable().optional(),
  leaveTypeId: z.string().uuid(),
  leaveTypeName: z.string().nullable().optional(),
  year: z.number().int(),
  totalDays: z.number(),
  usedDays: z.number(),
  remainingDays: z.number(),
});
export type LeaveBalanceDto = z.infer<typeof leaveBalanceSchema>;

/** Upsert số phép (HR): đặt total_days cho (user, loại nghỉ, năm). */
export const upsertLeaveBalanceSchema = z.object({
  userId: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  year: z.number().int().min(2000).max(2100),
  totalDays: z.number().min(0).max(366),
});
export type UpsertLeaveBalanceRequest = z.infer<typeof upsertLeaveBalanceSchema>;

// ─── leave_requests ───────────────────────────────────────────────────────────

export const leaveRequestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  userFullName: z.string().nullable().optional(),
  leaveTypeId: z.string().uuid(),
  leaveTypeName: z.string().nullable().optional(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  totalDays: z.number(),
  reason: z.string().nullable(),
  status: hrRequestStatusSchema,
  taskId: z.string().uuid().nullable(),
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().datetime().nullable(),
  reviewNote: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type LeaveRequestDto = z.infer<typeof leaveRequestSchema>;

export const createLeaveRequestSchema = z
  .object({
    leaveTypeId: z.string().uuid(),
    startDate: z.string().date(),
    endDate: z.string().date(),
    reason: z.string().max(1000).optional(),
  })
  .refine((v) => v.startDate <= v.endDate, { message: "Ngày bắt đầu phải trước ngày kết thúc" })
  .refine((v) => v.startDate.slice(0, 4) === v.endDate.slice(0, 4), {
    message: "Đơn nghỉ không được vắt qua 2 năm (tách thành 2 đơn)",
  });
export type CreateLeaveRequest = z.infer<typeof createLeaveRequestSchema>;

export const leaveListQuerySchema = z.object({
  status: hrRequestStatusSchema.optional(),
  /** 'me' (mặc định) = đơn của tôi; 'all' = mọi đơn (cần quyền approve/manage). */
  scope: z.enum(["me", "all"]).default("me"),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type LeaveListQuery = z.infer<typeof leaveListQuerySchema>;

// ─── Lịch nghỉ (S3-LEAVE-BE-5 · CO-S4-005) ───────────────────────────────────
//
// GET /leave/calendar?scope=own|team|company&from&to — đơn Approved/Pending trong khoảng, theo data-scope
// (tái dùng DataScopeService S2-INT-2: own→Own, team→Team, company→Company). Gate 2 tầng (mirror BE-3
// management list): controller chỉ gate coarse view-own:leave-calendar (mọi role đều có ở Own); SERVICE gọi
// dataScope.resolveAndAssert(actor, action-theo-scope, 'leave-calendar') — action THỰC = 'view-own'/
// 'view-team'/'view-company' (3 cặp catalog riêng, mig 0455) → thiếu quyền cho scope yêu cầu = 403 ngay,
// KHÔNG rơi về Own âm thầm (fail-closed, không đoán ý người gọi).
//
// MASK: `reason` CHỈ trả cho dòng CỦA CHÍNH người gọi (row.userId === actor.id) — mọi dòng khác (đồng
// nghiệp/cấp dưới) LUÔN null, bất kể scope nào (đây là lịch "ai nghỉ khi nào", KHÔNG phải màn hình duyệt
// đơn — lý do nghỉ luôn riêng tư ngoài bản thân). Không cần thêm 1 lượt permission-check nữa (đơn giản,
// fail-safe theo mặc định).

export const leaveCalendarScopeSchema = z.enum(["own", "team", "company"]);
export type LeaveCalendarScope = z.infer<typeof leaveCalendarScopeSchema>;

export const leaveCalendarQuerySchema = z
  .object({
    scope: leaveCalendarScopeSchema.default("own"),
    from: z.string().date(),
    to: z.string().date(),
  })
  .refine((v) => v.from <= v.to, {
    message: "'from' phải trước hoặc bằng 'to'",
    path: ["to"],
  });
export type LeaveCalendarQuery = z.infer<typeof leaveCalendarQuerySchema>;

/** 1 dòng lịch nghỉ. `reason` masked (null) trừ khi là đơn của chính người gọi (xem MASK ở trên). */
export const leaveCalendarEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  userFullName: z.string().nullable(),
  employeeCode: z.string().nullable(),
  leaveTypeId: z.string().uuid(),
  leaveTypeCode: z.string().nullable(),
  leaveTypeName: z.string().nullable(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  totalDays: z.number(),
  status: z.string(),
  reason: z.string().nullable(),
});
export type LeaveCalendarEntryDto = z.infer<typeof leaveCalendarEntrySchema>;

export const leaveCalendarResponseSchema = z.object({
  scope: leaveCalendarScopeSchema,
  items: z.array(leaveCalendarEntrySchema),
});
export type LeaveCalendarResponse = z.infer<typeof leaveCalendarResponseSchema>;

// ─── S3-LEAVE-BE-1: rich read views + calculate preview ─────────────────────────
//
// ADDITIVE — KHÔNG sửa schema cũ ở trên (leaveTypeSchema/leaveBalanceSchema vẫn dùng bởi route legacy).
// Các view dưới đây giàu hơn (cột mới mig 0453, nullable) cho GET /leave/types + GET /leave/me/balances;
// calculate (LEAVE-API-301) là PREVIEW thuần — KHÔNG ghi gì (balance/transaction/request bất biến).

/**
 * Loại nghỉ — view ĐẦY ĐỦ (DB-05 §7.1 / mig 0453). Cột cấu hình mới nullable (chưa backfill ở loại cũ).
 * `balanceUnit`/`status` để string-nullable (DB CHECK đã ép miền giá trị) — tránh vỡ FE khi giá trị lạ.
 */
export const leaveTypeViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  paid: z.boolean(),
  status: z.string(),
  description: z.string().nullable(),
  deductBalance: z.boolean().nullable(),
  balanceUnit: z.string().nullable(),
  allowFullDay: z.boolean().nullable(),
  allowHalfDay: z.boolean().nullable(),
  allowHourly: z.boolean().nullable(),
  allowMultipleDays: z.boolean().nullable(),
  requireReason: z.boolean().nullable(),
  requireAttachment: z.boolean().nullable(),
  minNoticeDays: z.number().int().nullable(),
  maxDaysPerRequest: z.number().nullable(),
  maxHoursPerRequest: z.number().nullable(),
  sortOrder: z.number().int().nullable(),
});
export type LeaveTypeView = z.infer<typeof leaveTypeViewSchema>;

/**
 * Số dư phép CỦA CHÍNH MÌNH (GET /leave/me/balances). reserved = pending_days (giữ chỗ khi đơn chờ duyệt,
 * null→0). remaining = generated total-used (DB đảm bảo). unit từ loại nghỉ (balance_unit, mặc định 'Day').
 */
export const leaveBalanceViewSchema = z.object({
  id: z.string().uuid(),
  leaveType: z.object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
  }),
  periodYear: z.number().int(),
  openingBalance: z.number(),
  usedDays: z.number(),
  reservedDays: z.number(),
  adjustedDays: z.number(),
  remainingDays: z.number(),
  unit: z.string(),
});
export type LeaveBalanceView = z.infer<typeof leaveBalanceViewSchema>;

export const leaveDurationTypeSchema = z.enum(["FullDay", "HalfDay", "Hourly", "MultipleDays"]);
export type LeaveDurationType = z.infer<typeof leaveDurationTypeSchema>;

export const leaveHalfDaySessionSchema = z.enum(["Morning", "Afternoon"]);
export type LeaveHalfDaySession = z.infer<typeof leaveHalfDaySessionSchema>;

/** 'HH:MM' hoặc 'HH:MM:SS' (24h). */
const clockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Giờ phải có dạng HH:MM");

/**
 * LEAVE-API-301 — preview body. Server-authoritative: bất kỳ employee_id/calculated_days/calculated_hours/
 * balance_after client gửi đều BỊ Zod strip (object mặc định strip key lạ) — resolve actor ở server (§6.2).
 * Refines: start<=end + cùng năm; HalfDay⇒1 ngày + session; Hourly⇒1 ngày + endTime>startTime.
 */
export const leaveCalculateRequestSchema = z
  .object({
    leaveTypeId: z.string().uuid(),
    startDate: z.string().date(),
    endDate: z.string().date(),
    durationType: leaveDurationTypeSchema,
    halfDaySession: leaveHalfDaySessionSchema.optional(),
    startTime: clockTimeSchema.optional(),
    endTime: clockTimeSchema.optional(),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc",
    path: ["endDate"],
  })
  .refine((v) => v.startDate.slice(0, 4) === v.endDate.slice(0, 4), {
    message: "Khoảng nghỉ không được vắt qua 2 năm (tách thành 2 yêu cầu)",
    path: ["endDate"],
  })
  .refine((v) => v.durationType !== "HalfDay" || v.startDate === v.endDate, {
    message: "Nghỉ nửa ngày chỉ áp dụng cho đúng 1 ngày",
    path: ["endDate"],
  })
  .refine((v) => v.durationType !== "HalfDay" || v.halfDaySession != null, {
    message: "Nghỉ nửa ngày phải chọn buổi (Morning/Afternoon)",
    path: ["halfDaySession"],
  })
  .refine((v) => v.durationType !== "Hourly" || v.startDate === v.endDate, {
    message: "Nghỉ theo giờ chỉ áp dụng cho đúng 1 ngày",
    path: ["endDate"],
  })
  .refine((v) => v.durationType !== "Hourly" || (v.startTime != null && v.endTime != null), {
    message: "Nghỉ theo giờ phải có giờ bắt đầu và kết thúc",
    path: ["endTime"],
  })
  .refine(
    (v) =>
      v.durationType !== "Hourly" ||
      v.startTime == null ||
      v.endTime == null ||
      v.endTime > v.startTime,
    { message: "Giờ kết thúc phải sau giờ bắt đầu", path: ["endTime"] },
  );
export type LeaveCalculateRequest = z.infer<typeof leaveCalculateRequestSchema>;

/** 1 dòng chi tiết theo ngày trong preview (snake_case — khớp API-05 §16.1 response). */
export const leaveCalcDaySchema = z.object({
  date: z.string().date(),
  is_working_day: z.boolean(),
  is_public_holiday: z.boolean(),
  leave_days: z.number(),
  leave_hours: z.number(),
});
export type LeaveCalcDay = z.infer<typeof leaveCalcDaySchema>;

/** Khối số dư trong preview (null khi loại nghỉ không trừ phép). */
export const leaveCalcBalanceSchema = z.object({
  remaining_days: z.number(),
  requested_days: z.number(),
  after_remaining_days: z.number(),
  is_enough: z.boolean(),
});
export type LeaveCalcBalance = z.infer<typeof leaveCalcBalanceSchema>;

/** LEAVE-API-301 response.data (snake_case khớp API-05 §16.1). */
export const leaveCalculateResponseSchema = z.object({
  calculated_days: z.number(),
  calculated_hours: z.number(),
  is_balance_required: z.boolean(),
  balance: leaveCalcBalanceSchema.nullable(),
  days: z.array(leaveCalcDaySchema),
  warnings: z.array(z.string()),
});
export type LeaveCalculateResponse = z.infer<typeof leaveCalculateResponseSchema>;

// ─── S3-LEAVE-BE-2: request workflow (draft / submit / cancel) ───────────────────
//
// ADDITIVE — KHÔNG sửa createLeaveRequestSchema legacy ở trên (route legacy đang dùng). Các schema dưới đây
// phục vụ self-service workflow: tạo nháp → gửi duyệt → huỷ. Body server-authoritative: employee_id/user_id/
// company_id/status/total_* client gửi đều BỊ Zod strip (object mặc định strip key lạ) — resolve actor ở server.

/**
 * Trường ngày/loại nghỉ DÙNG CHUNG cho create-draft + update-draft. Tách ra để gắn refine 1 lần (DRY),
 * khớp ĐÚNG bộ refine của leaveCalculateRequestSchema (start<=end + cùng năm; HalfDay⇒1 ngày + session;
 * Hourly⇒1 ngày + end>start).
 */
const leaveRequestDraftBaseSchema = z.object({
  leaveTypeId: z.string().uuid(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  durationType: leaveDurationTypeSchema,
  halfDaySession: leaveHalfDaySessionSchema.optional(),
  startTime: clockTimeSchema.optional(),
  endTime: clockTimeSchema.optional(),
  reason: z.string().max(1000).optional(),
  handoverNote: z.string().max(2000).optional(),
  contactDuringLeave: z.string().max(255).optional(),
});

/** Hình dạng tối thiểu mà bộ refine ngày cần — predicate nhận đúng các field này (tránh `any`). */
interface LeaveDraftDateRefineFields {
  startDate: string;
  endDate: string;
  durationType: LeaveDurationType;
  halfDaySession?: LeaveHalfDaySession;
  startTime?: string;
  endTime?: string;
}

/**
 * Gắn bộ refine ngày/loại nghỉ lên 1 ZodObject draft. Generic ràng buộc output ⊇ LeaveDraftDateRefineFields
 * ⇒ predicate `(v: LeaveDraftDateRefineFields)` hợp lệ qua contravariance (object rộng hơn assignable). Trả về
 * ZodEffects — createZodDto vẫn nhận được. Một nguồn refine duy nhất cho create-draft + update-draft.
 */
function withLeaveDraftRefines<Shape extends z.ZodRawShape, Out extends LeaveDraftDateRefineFields>(
  schema: z.ZodObject<Shape, "strip", z.ZodTypeAny, Out>,
) {
  return schema
    .refine((v: LeaveDraftDateRefineFields) => v.startDate <= v.endDate, {
      message: "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc",
      path: ["endDate"],
    })
    .refine((v: LeaveDraftDateRefineFields) => v.startDate.slice(0, 4) === v.endDate.slice(0, 4), {
      message: "Khoảng nghỉ không được vắt qua 2 năm (tách thành 2 đơn)",
      path: ["endDate"],
    })
    .refine(
      (v: LeaveDraftDateRefineFields) => v.durationType !== "HalfDay" || v.startDate === v.endDate,
      { message: "Nghỉ nửa ngày chỉ áp dụng cho đúng 1 ngày", path: ["endDate"] },
    )
    .refine(
      (v: LeaveDraftDateRefineFields) => v.durationType !== "HalfDay" || v.halfDaySession != null,
      { message: "Nghỉ nửa ngày phải chọn buổi (Morning/Afternoon)", path: ["halfDaySession"] },
    )
    .refine(
      (v: LeaveDraftDateRefineFields) => v.durationType !== "Hourly" || v.startDate === v.endDate,
      { message: "Nghỉ theo giờ chỉ áp dụng cho đúng 1 ngày", path: ["endDate"] },
    )
    .refine(
      (v: LeaveDraftDateRefineFields) =>
        v.durationType !== "Hourly" || (v.startTime != null && v.endTime != null),
      { message: "Nghỉ theo giờ phải có giờ bắt đầu và kết thúc", path: ["endTime"] },
    )
    .refine(
      (v: LeaveDraftDateRefineFields) =>
        v.durationType !== "Hourly" ||
        v.startTime == null ||
        v.endTime == null ||
        v.endTime > v.startTime,
      { message: "Giờ kết thúc phải sau giờ bắt đầu", path: ["endTime"] },
    );
}

/**
 * POST /leave/requests — tạo đơn NHÁP (status='Draft'). submitNow=true ⇒ server chạy luôn nhánh submit
 * trong CÙNG transaction (nháp → gửi duyệt 1 lần gọi).
 */
export const createLeaveRequestDraftSchema = withLeaveDraftRefines(
  leaveRequestDraftBaseSchema.extend({ submitNow: z.boolean().default(false) }),
);
export type CreateLeaveRequestDraft = z.infer<typeof createLeaveRequestDraftSchema>;

/** PATCH /leave/requests/:id — sửa đơn NHÁP (chỉ khi status='Draft'; recompute + replace day-rows). */
export const updateLeaveRequestDraftSchema = withLeaveDraftRefines(leaveRequestDraftBaseSchema);
export type UpdateLeaveRequestDraft = z.infer<typeof updateLeaveRequestDraftSchema>;

/** POST /leave/requests/:id/submit — Draft → Pending. note ghi vào lịch sử duyệt (action SUBMIT). */
export const submitLeaveRequestSchema = z.object({
  note: z.string().max(1000).optional(),
});
export type SubmitLeaveRequest = z.infer<typeof submitLeaveRequestSchema>;

/** POST /leave/requests/:id/cancel — Draft|Pending → Cancelled. cancelReason ghi vào lịch sử (action CANCEL). */
export const cancelLeaveRequestSchema = z.object({
  cancelReason: z.string().max(1000).optional(),
});
export type CancelLeaveRequest = z.infer<typeof cancelLeaveRequestSchema>;

/** GET /leave/me/requests — query phân trang + lọc (status / loại nghỉ / khoảng ngày theo start_date). */
export const leaveRequestListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  /** Lọc theo trạng thái (TitleCase mới hoặc lowercase legacy) — khớp chính xác. */
  status: z.string().min(1).max(32).optional(),
  leaveTypeId: z.string().uuid().optional(),
  /** [fromDate, toDate] inclusive trên start_date. */
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
});
export type LeaveRequestListQuery = z.infer<typeof leaveRequestListQuerySchema>;

/** 1 dòng chi tiết ngày nghỉ (camelCase, FE-friendly). dayType có khoảng trắng ('Full Day'/'Half Day'/'Hourly'). */
export const leaveRequestDayViewSchema = z.object({
  id: z.string().uuid(),
  workDate: z.string().date(),
  dayType: z.string(),
  halfDaySession: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  leaveDays: z.number(),
  leaveHours: z.number(),
  leaveMinutes: z.number(),
  isWorkingDay: z.boolean(),
  isPublicHoliday: z.boolean(),
  status: z.string(),
});
export type LeaveRequestDayView = z.infer<typeof leaveRequestDayViewSchema>;

/** 1 dòng lịch sử duyệt (append-only). action ∈ SUBMIT/APPROVE/REJECT/CANCEL/REVOKE/COMMENT. */
export const leaveRequestApprovalViewSchema = z.object({
  id: z.string().uuid(),
  approvalStep: z.number().int(),
  action: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  comment: z.string().nullable(),
  approverUserId: z.string().uuid().nullable(),
  actedAt: z.string().datetime(),
});
export type LeaveRequestApprovalView = z.infer<typeof leaveRequestApprovalViewSchema>;

/** 1 dòng danh sách đơn nghỉ của tôi (GET /leave/me/requests). */
export const leaveRequestListItemViewSchema = z.object({
  id: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  leaveTypeCode: z.string().nullable(),
  leaveTypeName: z.string().nullable(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  durationType: z.string().nullable(),
  totalDays: z.number(),
  totalHours: z.number().nullable(),
  status: z.string(),
  reason: z.string().nullable(),
  balanceEffectStatus: z.string().nullable(),
  submittedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type LeaveRequestListItemView = z.infer<typeof leaveRequestListItemViewSchema>;

/** Chi tiết 1 đơn nghỉ của tôi (GET /leave/me/requests/:id) — đơn + days[] + lịch sử duyệt[]. */
export const leaveRequestDetailViewSchema = leaveRequestListItemViewSchema.extend({
  employeeId: z.string().uuid().nullable(),
  leavePolicyId: z.string().uuid().nullable(),
  halfDaySession: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  handoverNote: z.string().nullable(),
  contactDuringLeave: z.string().nullable(),
  cancelReason: z.string().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  days: z.array(leaveRequestDayViewSchema),
  approvals: z.array(leaveRequestApprovalViewSchema),
});
export type LeaveRequestDetailView = z.infer<typeof leaveRequestDetailViewSchema>;

/** Envelope danh sách (mirror attendance {items, meta}). */
export const leaveRequestListResponseSchema = z.object({
  items: z.array(leaveRequestListItemViewSchema),
  meta: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    hasNext: z.boolean(),
    hasPrev: z.boolean(),
  }),
});
export type LeaveRequestListResponse = z.infer<typeof leaveRequestListResponseSchema>;

// ─── S3-LEAVE-BE-3: approval workflow (approve / reject / management list) ────────
//
// ADDITIVE — KHÔNG sửa schema BE-2 trở về trước. Các schema dưới đây phục vụ
// luồng HR/manager duyệt / từ chối đơn + danh sách quản lý (GET /leave/requests).
// Body server-authoritative: status/approvedBy/employeeId/companyId client gửi đều
// BỊ Zod strip (object mặc định strip key lạ) — resolve actor ở server.

/** POST /leave/requests/:id/approve — HR/manager duyệt đơn Pending → Approved. note tuỳ chọn. */
export const approveLeaveRequestSchema = z.object({
  note: z.string().max(1000).optional(),
});
export type ApproveLeaveRequest = z.infer<typeof approveLeaveRequestSchema>;

/** POST /leave/requests/:id/reject — HR/manager từ chối đơn Pending → Rejected. reason BẮT BUỘC (min 1 ký tự). */
export const rejectLeaveRequestSchema = z.object({
  reason: z.string().min(1, "Lý do từ chối là bắt buộc").max(2000),
});
export type RejectLeaveRequest = z.infer<typeof rejectLeaveRequestSchema>;

/**
 * S3-INT-1 — POST /leave/requests/:id/revoke — HR/company-admin thu hồi đơn ĐÃ Approved → Revoked
 * (ATT-revert + balance refund, S3-SYNC-004). manager KHÔNG có grant revoke:leave (Company-scope only) —
 * PermissionGuard 403 trước khi vào service. revokeReason tuỳ chọn.
 */
export const revokeLeaveRequestSchema = z.object({
  revokeReason: z.string().max(2000).optional(),
});
export type RevokeLeaveRequest = z.infer<typeof revokeLeaveRequestSchema>;

/**
 * GET /leave/requests — query danh sách đơn nghỉ cho HR/manager. status mặc định 'Pending'
 * (mặt quản lý — phê duyệt đơn chờ). Hỗ trợ phân trang page/pageSize + bộ lọc tiêu chuẩn.
 * Zod strip bảo đảm client không truyền được companyId/approvedBy vào tầng query.
 */
export const pendingLeaveRequestListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  /** Lọc theo trạng thái. Mặc định 'Pending' — trang quản lý. */
  status: z.string().min(1).max(32).default("Pending"),
  leaveTypeId: z.string().uuid().optional(),
  /** Lọc theo employee (UUID của employee_profiles.id). */
  employeeId: z.string().uuid().optional(),
  /** Lọc theo phòng ban (UUID của org_units.id = employee_profiles.org_unit_id). Server-side, nằm TRONG scope. */
  departmentId: z.string().uuid().optional(),
  /** [fromDate, toDate] inclusive trên start_date. */
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
});
export type PendingLeaveRequestListQuery = z.infer<typeof pendingLeaveRequestListQuerySchema>;

/**
 * 1 dòng danh sách quản lý đơn nghỉ (GET /leave/requests). Gồm thông tin đơn + requester
 * (employeeCode/fullName/department từ employee_profiles + org_units) + kết quả phê duyệt
 * (nullable cho đơn Pending). approvedBy/rejectedBy là UUID — FE tự resolve tên khi cần.
 */
export const leaveManagementListItemViewSchema = z.object({
  // ── Thông tin đơn nghỉ ──────────────────────────────────────────────────────
  id: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  leaveTypeCode: z.string().nullable(),
  leaveTypeName: z.string().nullable(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  durationType: z.string().nullable(),
  totalDays: z.number(),
  totalHours: z.number().nullable(),
  status: z.string(),
  reason: z.string().nullable(),
  balanceEffectStatus: z.string().nullable(),
  submittedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  // ── Thông tin người gửi (enriched: employee_profiles + users + org_units) ──
  requester: z.object({
    userId: z.string().uuid(),
    employeeCode: z.string().nullable(),
    fullName: z.string().nullable(),
    department: z.string().nullable(),
  }),
  // ── Kết quả phê duyệt (nullable khi đơn Pending / Draft) ────────────────────
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().datetime().nullable(),
  rejectedBy: z.string().uuid().nullable(),
  rejectedAt: z.string().datetime().nullable(),
  rejectionReason: z.string().nullable(),
});
export type LeaveManagementListItemView = z.infer<typeof leaveManagementListItemViewSchema>;

/** Envelope danh sách quản lý ({items, meta} — khớp pattern leaveRequestListResponseSchema). */
export const leaveManagementListResponseSchema = z.object({
  items: z.array(leaveManagementListItemViewSchema),
  meta: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    hasNext: z.boolean(),
    hasPrev: z.boolean(),
  }),
});
export type LeaveManagementListResponse = z.infer<typeof leaveManagementListResponseSchema>;

// ─── S3-LEAVE-BE-4: type/policy admin CRUD + HR balance view/adjust (ledger) ──────
//
// ADDITIVE — KHÔNG sửa leaveTypeSchema/createLeaveTypeSchema/updateLeaveTypeSchema legacy ở trên (route
// legacy /leave/types POST|PATCH vẫn dùng `manage:leave`, giữ nguyên). Bộ schema dưới đây phục vụ MẶT ADMIN
// MỚI (HR/company-admin) gắn cặp permission THẬT (create/update/delete:leave-type — mig 0455), CRUD
// leave_policies (bảng mới mig 0453), và xem/điều-chỉnh leave_balances qua ledger leave_balance_transactions
// (append-only, BẤT BIẾN #2 — KHÔNG method nào sửa balance trực tiếp mà không kèm 1 dòng ledger).

/** Body tạo loại nghỉ (mặt admin — đủ field cấu hình DB-05 §7.1, mig 0453). code immutable sau khi tạo. */
export const createLeaveTypeAdminSchema = z.object({
  name: z.string().min(1).max(200),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_-]+$/, "Code chỉ gồm a-z, 0-9, '-', '_'"),
  paid: z.boolean().default(true),
  description: z.string().max(1000).optional(),
  deductBalance: z.boolean().default(true),
  balanceUnit: z.enum(["Day", "Hour"]).default("Day"),
  allowFullDay: z.boolean().default(true),
  allowHalfDay: z.boolean().default(false),
  allowHourly: z.boolean().default(false),
  allowMultipleDays: z.boolean().default(true),
  requireReason: z.boolean().default(false),
  requireAttachment: z.boolean().default(false),
  minNoticeDays: z.number().int().min(0).max(365).optional(),
  maxDaysPerRequest: z.number().positive().max(366).optional(),
  maxHoursPerRequest: z
    .number()
    .positive()
    .max(24 * 366)
    .optional(),
  allowNegativeBalance: z.boolean().default(false),
  sortOrder: z.number().int().min(0).optional(),
});
export type CreateLeaveTypeAdminRequest = z.infer<typeof createLeaveTypeAdminSchema>;

/** Body sửa loại nghỉ (mặt admin). Mọi field optional — PATCH bán phần. code KHÔNG sửa được (immutable). */
export const updateLeaveTypeAdminSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  paid: z.boolean().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  description: z.string().max(1000).nullable().optional(),
  deductBalance: z.boolean().optional(),
  balanceUnit: z.enum(["Day", "Hour"]).optional(),
  allowFullDay: z.boolean().optional(),
  allowHalfDay: z.boolean().optional(),
  allowHourly: z.boolean().optional(),
  allowMultipleDays: z.boolean().optional(),
  requireReason: z.boolean().optional(),
  requireAttachment: z.boolean().optional(),
  minNoticeDays: z.number().int().min(0).max(365).nullable().optional(),
  maxDaysPerRequest: z.number().positive().max(366).nullable().optional(),
  maxHoursPerRequest: z
    .number()
    .positive()
    .max(24 * 366)
    .nullable()
    .optional(),
  allowNegativeBalance: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type UpdateLeaveTypeAdminRequest = z.infer<typeof updateLeaveTypeAdminSchema>;

/** View đầy đủ mặt admin (bao gồm status/soft-delete flag, KHÔNG lộ deleted_by/created_by). */
export const leaveTypeAdminViewSchema = leaveTypeViewSchema.extend({
  allowNegativeBalance: z.boolean().nullable(),
});
export type LeaveTypeAdminView = z.infer<typeof leaveTypeAdminViewSchema>;

// ─── leave_policies (mig 0453 — mới hoàn toàn) ────────────────────────────────

export const leavePolicyScopeSchema = z.enum([
  "Company",
  "Department",
  "Employee",
  "JobLevel",
  "ContractType",
]);
export type LeavePolicyScope = z.infer<typeof leavePolicyScopeSchema>;

export const leavePolicyAccrualMethodSchema = z.enum([
  "None",
  "Monthly",
  "Yearly",
  "Manual",
  "Prorated",
]);
export type LeavePolicyAccrualMethod = z.infer<typeof leavePolicyAccrualMethodSchema>;

/**
 * Body tạo/sửa chính sách nghỉ. `target` bọc chk_leave_policies_target (đúng 1 field khớp policyScope) —
 * validate ở Zod TRƯỚC khi chạm DB (fail-fast, tránh lộ lỗi CHECK thô).
 */
const leavePolicyBaseSchema = z.object({
  leaveTypeId: z.string().uuid(),
  policyCode: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z0-9_-]+$/, "Mã chính sách chỉ gồm chữ, số, '-', '_'"),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  policyScope: leavePolicyScopeSchema,
  departmentId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  jobLevelId: z.string().uuid().optional(),
  contractTypeId: z.string().uuid().optional(),
  yearlyQuotaDays: z.number().min(0).max(366).optional(),
  yearlyQuotaHours: z
    .number()
    .min(0)
    .max(24 * 366)
    .optional(),
  accrualMethod: leavePolicyAccrualMethodSchema.default("None"),
  accrualDayOfMonth: z.number().int().min(1).max(31).optional(),
  prorateOnJoinDate: z.boolean().default(false),
  includeWeekends: z.boolean().default(false),
  includePublicHolidays: z.boolean().default(false),
  reserveBalanceOnPending: z.boolean().default(true),
  allowNegativeBalance: z.boolean().default(false),
  maxNegativeDays: z.number().min(0).max(366).optional(),
  allowCancelAfterApproved: z.boolean().default(true),
  cancelBeforeDays: z.number().int().min(0).max(365).optional(),
  requiresManagerApproval: z.boolean().default(true),
  requiresHrApproval: z.boolean().default(false),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().optional(),
  priority: z.number().int().min(0).max(1000).default(0),
});

function refineLeavePolicyTarget<
  Shape extends z.ZodRawShape,
  Out extends {
    policyScope: LeavePolicyScope;
    departmentId?: string;
    employeeId?: string;
    jobLevelId?: string;
    contractTypeId?: string;
  },
>(schema: z.ZodObject<Shape, "strip", z.ZodTypeAny, Out>) {
  return schema
    .refine(
      (v) =>
        v.policyScope !== "Company" ||
        (v.departmentId == null &&
          v.employeeId == null &&
          v.jobLevelId == null &&
          v.contractTypeId == null),
      { message: "policyScope Company không được gắn target khác", path: ["policyScope"] },
    )
    .refine((v) => v.policyScope !== "Department" || v.departmentId != null, {
      message: "policyScope Department bắt buộc departmentId",
      path: ["departmentId"],
    })
    .refine((v) => v.policyScope !== "Employee" || v.employeeId != null, {
      message: "policyScope Employee bắt buộc employeeId",
      path: ["employeeId"],
    })
    .refine((v) => v.policyScope !== "JobLevel" || v.jobLevelId != null, {
      message: "policyScope JobLevel bắt buộc jobLevelId",
      path: ["jobLevelId"],
    })
    .refine((v) => v.policyScope !== "ContractType" || v.contractTypeId != null, {
      message: "policyScope ContractType bắt buộc contractTypeId",
      path: ["contractTypeId"],
    });
}

export const createLeavePolicySchema = refineLeavePolicyTarget(leavePolicyBaseSchema);
export type CreateLeavePolicyRequest = z.infer<typeof createLeavePolicySchema>;

/** PATCH bán phần — policyCode/leaveTypeId immutable sau khi tạo. status thêm ở đây (Active/Inactive). */
export const updateLeavePolicySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
  yearlyQuotaDays: z.number().min(0).max(366).nullable().optional(),
  yearlyQuotaHours: z
    .number()
    .min(0)
    .max(24 * 366)
    .nullable()
    .optional(),
  accrualMethod: leavePolicyAccrualMethodSchema.optional(),
  accrualDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  prorateOnJoinDate: z.boolean().optional(),
  includeWeekends: z.boolean().optional(),
  includePublicHolidays: z.boolean().optional(),
  reserveBalanceOnPending: z.boolean().optional(),
  allowNegativeBalance: z.boolean().optional(),
  maxNegativeDays: z.number().min(0).max(366).nullable().optional(),
  allowCancelAfterApproved: z.boolean().optional(),
  cancelBeforeDays: z.number().int().min(0).max(365).nullable().optional(),
  requiresManagerApproval: z.boolean().optional(),
  requiresHrApproval: z.boolean().optional(),
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().nullable().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
});
export type UpdateLeavePolicyRequest = z.infer<typeof updateLeavePolicySchema>;

export const leavePolicyViewSchema = z.object({
  id: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  leaveTypeCode: z.string().nullable(),
  leaveTypeName: z.string().nullable(),
  policyCode: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  policyScope: leavePolicyScopeSchema,
  departmentId: z.string().uuid().nullable(),
  employeeId: z.string().uuid().nullable(),
  jobLevelId: z.string().uuid().nullable(),
  contractTypeId: z.string().uuid().nullable(),
  yearlyQuotaDays: z.number().nullable(),
  yearlyQuotaHours: z.number().nullable(),
  accrualMethod: leavePolicyAccrualMethodSchema,
  reserveBalanceOnPending: z.boolean(),
  allowNegativeBalance: z.boolean(),
  maxNegativeDays: z.number().nullable(),
  requiresManagerApproval: z.boolean(),
  requiresHrApproval: z.boolean(),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().nullable(),
  priority: z.number().int(),
  status: z.enum(["Active", "Inactive"]),
});
export type LeavePolicyView = z.infer<typeof leavePolicyViewSchema>;

export const leavePolicyListQuerySchema = z.object({
  leaveTypeId: z.string().uuid().optional(),
  policyScope: leavePolicyScopeSchema.optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
});
export type LeavePolicyListQuery = z.infer<typeof leavePolicyListQuerySchema>;

// ─── leave_balances admin view + adjust (ledger append-only) ─────────────────

/** GET /leave/admin/balances query — theo employee/năm (Company scope; year mặc định năm hiện tại). */
export const leaveBalanceAdminListQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  leaveTypeId: z.string().uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type LeaveBalanceAdminListQuery = z.infer<typeof leaveBalanceAdminListQuerySchema>;

export const leaveBalanceAdminViewSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  userFullName: z.string().nullable(),
  leaveTypeId: z.string().uuid(),
  leaveTypeCode: z.string().nullable(),
  leaveTypeName: z.string().nullable(),
  year: z.number().int(),
  totalDays: z.number(),
  usedDays: z.number(),
  pendingDays: z.number(),
  adjustedDays: z.number(),
  remainingDays: z.number(),
  allowNegativeBalance: z.boolean().nullable(),
});
export type LeaveBalanceAdminView = z.infer<typeof leaveBalanceAdminViewSchema>;

/**
 * POST /leave/admin/balances/:balanceId/adjust — HR điều chỉnh số dư phép. amountDays có thể ÂM (trừ) hoặc
 * DƯƠNG (cộng); reason BẮT BUỘC (audit trail rõ lý do). Mọi thay đổi PHẢI qua leave_balance_transactions
 * (ledger append-only) — KHÔNG endpoint nào set total_days trực tiếp mà không kèm 1 dòng ledger ADJUSTMENT.
 */
export const adjustLeaveBalanceSchema = z.object({
  amountDays: z
    .number()
    .refine((v) => v !== 0, "Số ngày điều chỉnh không được bằng 0")
    .refine((v) => Math.abs(v) <= 366, "Số ngày điều chỉnh vượt giới hạn hợp lý (366 ngày)"),
  reason: z.string().min(1, "Lý do điều chỉnh là bắt buộc").max(1000),
});
export type AdjustLeaveBalanceRequest = z.infer<typeof adjustLeaveBalanceSchema>;

/** 1 dòng ledger (GET /leave/admin/balances/:balanceId/transactions — view-transaction:leave-balance). */
export const leaveBalanceTransactionViewSchema = z.object({
  id: z.string().uuid(),
  transactionType: z.string(),
  transactionDate: z.string().date(),
  amountDays: z.number(),
  balanceBeforeDays: z.number().nullable(),
  balanceAfterDays: z.number().nullable(),
  reason: z.string().nullable(),
  createdByType: z.string(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type LeaveBalanceTransactionView = z.infer<typeof leaveBalanceTransactionViewSchema>;

// ─── S3-LEAVE-BE-6: reports + balance transactions (self) + audit read (P2, read-only) ────────────
//
// GET /leave/me/balance-transactions (view-own:leave-balance, Own — API-05 §13.2 LEAVE-API-003).
// Self-locked by user_id via leave_balances (mirrors findOwnBalancesTx) — KHÔNG scope query.
export const leaveMyBalanceTransactionsQuerySchema = z.object({
  periodYear: z.coerce.number().int().min(2000).max(2100).optional(),
  leaveTypeId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type LeaveMyBalanceTransactionsQuery = z.infer<typeof leaveMyBalanceTransactionsQuerySchema>;

/** Envelope phân trang cho GET /leave/me/balance-transactions (mirror leaveRequestListResponseSchema). */
export const leaveMyBalanceTransactionsResponseSchema = z.object({
  items: z.array(leaveBalanceTransactionViewSchema),
  meta: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    hasNext: z.boolean(),
    hasPrev: z.boolean(),
  }),
});
export type LeaveMyBalanceTransactionsResponse = z.infer<
  typeof leaveMyBalanceTransactionsResponseSchema
>;

export const LEAVE_REPORT_PAGE_SIZE_MAX = 100;
export const LEAVE_REPORT_PAGE_SIZE_DEFAULT = 20;

/**
 * GET /leave/reports query (export:leave, Company-scope — mig 0455). Half-open [fromDate, toDate]
 * inclusive trên leave_request_days.work_date (mirror attendanceReportQuerySchema). leaveTypeId/
 * departmentId lọc thêm — KHÔNG bắt buộc.
 */
export const leaveReportQuerySchema = z
  .object({
    fromDate: z.string().date(),
    toDate: z.string().date(),
    leaveTypeId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(LEAVE_REPORT_PAGE_SIZE_MAX)
      .default(LEAVE_REPORT_PAGE_SIZE_DEFAULT),
  })
  .refine((v) => v.toDate >= v.fromDate, {
    message: "toDate phải >= fromDate",
    path: ["toDate"],
  });
export type LeaveReportQuery = z.infer<typeof leaveReportQuerySchema>;

/**
 * 1 dòng tổng hợp nghỉ phép của 1 nhân viên trong kỳ — nguồn leave_request_days (status='Active') ⋈
 * leave_requests (status='Approved') để chỉ tính phép ĐÃ duyệt, chia theo work_date (chính xác hơn
 * total_days của cả đơn khi đơn cắt ngang khoảng lọc).
 */
export const leaveReportRowSchema = z.object({
  employeeId: z.string().uuid(),
  // employee_profiles.user_id là NULLABLE (nhân viên chưa liên kết tài khoản) — KHÔNG giả định non-null.
  userId: z.string().uuid().nullable(),
  employeeCode: z.string().nullable(),
  fullName: z.string().nullable(),
  orgUnitId: z.string().uuid().nullable(),
  orgUnitName: z.string().nullable(),
  totalRequests: z.number().int().nonnegative(),
  totalLeaveDays: z.number(),
});
export type LeaveReportRow = z.infer<typeof leaveReportRowSchema>;

export const leaveReportResponseSchema = z.object({
  fromDate: z.string().date(),
  toDate: z.string().date(),
  items: z.array(leaveReportRowSchema),
  meta: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    hasNext: z.boolean(),
    hasPrev: z.boolean(),
  }),
});
export type LeaveReportResponse = z.infer<typeof leaveReportResponseSchema>;
