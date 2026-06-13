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
