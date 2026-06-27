import { z } from "zod";
import { hrRequestStatusSchema, periodMonthSchema } from "./attendance";

/**
 * G11-2 — Leave contracts (loại nghỉ, số phép, đơn nghỉ, lịch nghỉ team).
 * Đơn nghỉ duyệt qua Task Hub (task_type='hr'); trừ phép CHỈ lúc duyệt.
 */

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

// ─── Lịch nghỉ team ───────────────────────────────────────────────────────────

/** 1 dòng lịch nghỉ team — KHÔNG kèm reason (riêng tư), chỉ ai/nghỉ gì/khi nào. */
export const leaveCalendarEntrySchema = z.object({
  userId: z.string().uuid(),
  userFullName: z.string().nullable(),
  leaveTypeCode: z.string(),
  leaveTypeName: z.string(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  totalDays: z.number(),
});
export type LeaveCalendarEntryDto = z.infer<typeof leaveCalendarEntrySchema>;

export const leaveCalendarQuerySchema = z.object({
  month: periodMonthSchema,
});
export type LeaveCalendarQuery = z.infer<typeof leaveCalendarQuerySchema>;

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
