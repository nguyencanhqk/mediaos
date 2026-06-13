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

export const checkInSchema = z.object({
  method: z.enum(["web", "mobile"]).default("web"),
  location: locationSchema,
});
export type CheckInRequest = z.infer<typeof checkInSchema>;

export const checkOutSchema = z.object({
  method: z.enum(["web", "mobile"]).default("web"),
  location: locationSchema,
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

export const attendanceListQuerySchema = z.object({
  month: periodMonthSchema,
  userId: z.string().uuid().optional(),
});
export type AttendanceListQuery = z.infer<typeof attendanceListQuerySchema>;

// ─── attendance_adjustment_requests ──────────────────────────────────────────

export const adjustmentRequestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  userFullName: z.string().nullable().optional(),
  attendanceRecordId: z.string().uuid().nullable(),
  workDate: z.string().date(),
  requestedCheckInAt: z.string().datetime().nullable(),
  requestedCheckOutAt: z.string().datetime().nullable(),
  reason: z.string(),
  status: hrRequestStatusSchema,
  taskId: z.string().uuid().nullable(),
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().datetime().nullable(),
  reviewNote: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AdjustmentRequestDto = z.infer<typeof adjustmentRequestSchema>;

export const createAdjustmentRequestSchema = z
  .object({
    workDate: z.string().date(),
    requestedCheckInAt: z.string().datetime().nullable().optional(),
    requestedCheckOutAt: z.string().datetime().nullable().optional(),
    reason: z.string().min(3).max(1000),
  })
  .refine((v) => v.requestedCheckInAt != null || v.requestedCheckOutAt != null, {
    message: "Cần ít nhất một mốc check-in hoặc check-out đề nghị",
  })
  .refine(
    (v) =>
      v.requestedCheckInAt == null ||
      v.requestedCheckOutAt == null ||
      v.requestedCheckOutAt >= v.requestedCheckInAt,
    { message: "Check-out đề nghị phải sau check-in đề nghị" },
  );
export type CreateAdjustmentRequest = z.infer<typeof createAdjustmentRequestSchema>;

export const reviewNoteSchema = z.object({
  note: z.string().max(1000).optional(),
});
export type ReviewNoteRequest = z.infer<typeof reviewNoteSchema>;

export const adjustmentListQuerySchema = z.object({
  status: hrRequestStatusSchema.optional(),
  /** 'me' (mặc định) = đơn của tôi; 'all' = mọi đơn (cần quyền approve/manage). */
  scope: z.enum(["me", "all"]).default("me"),
});
export type AdjustmentListQuery = z.infer<typeof adjustmentListQuerySchema>;

// ─── attendance_periods (khoá kỳ công) ────────────────────────────────────────

export const attendancePeriodSchema = z.object({
  id: z.string().uuid(),
  periodMonth: periodMonthSchema,
  status: z.enum(["open", "locked"]),
  lockedBy: z.string().uuid().nullable(),
  lockedAt: z.string().datetime().nullable(),
});
export type AttendancePeriodDto = z.infer<typeof attendancePeriodSchema>;
