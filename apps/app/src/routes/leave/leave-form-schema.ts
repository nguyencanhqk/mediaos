import { z } from "zod";
import { LEAVE_DURATION_TYPE, LEAVE_HALF_DAY_SESSION } from "./constants";

// Clock-time regex (HH:MM)
const clockTimeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Form schema dùng trong React Hook Form. Dùng chuỗi nullable/optional thay vì enum
 * để RHF select → "" không bị type error. Validation refine phản chiếu contracts.
 */
export const leaveFormSchema = z
  .object({
    leaveTypeId: z.string().min(1, "form.validation.leaveTypeRequired"),
    durationType: z.enum(
      [
        LEAVE_DURATION_TYPE.FULL_DAY,
        LEAVE_DURATION_TYPE.HALF_DAY,
        LEAVE_DURATION_TYPE.HOURLY,
        LEAVE_DURATION_TYPE.MULTIPLE_DAYS,
      ],
      { required_error: "form.validation.durationTypeRequired" },
    ),
    startDate: z.string().min(1, "form.validation.startDateRequired"),
    endDate: z.string().min(1, "form.validation.endDateRequired"),
    halfDaySession: z
      .enum([LEAVE_HALF_DAY_SESSION.MORNING, LEAVE_HALF_DAY_SESSION.AFTERNOON])
      .optional(),
    startTime: z.string().regex(clockTimeRegex, "form.validation.startTimeRequired").optional(),
    endTime: z.string().regex(clockTimeRegex, "form.validation.endTimeRequired").optional(),
    reason: z.string().max(1000).optional(),
    handoverNote: z.string().max(2000).optional(),
    contactDuringLeave: z.string().max(255).optional(),
    /** submitNow: true → gửi ngay (Draft→Pending), false → lưu nháp */
    submitNow: z.boolean().default(false),
  })
  // end >= start
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, {
    message: "form.validation.endDateBeforeStart",
    path: ["endDate"],
  })
  // same year
  .refine((v) => !v.startDate || !v.endDate || v.startDate.slice(0, 4) === v.endDate.slice(0, 4), {
    message: "form.validation.crossYear",
    path: ["endDate"],
  })
  // HalfDay → same day
  .refine((v) => v.durationType !== LEAVE_DURATION_TYPE.HALF_DAY || v.startDate === v.endDate, {
    message: "form.validation.halfDayOneDay",
    path: ["endDate"],
  })
  // HalfDay → session required
  .refine((v) => v.durationType !== LEAVE_DURATION_TYPE.HALF_DAY || v.halfDaySession != null, {
    message: "form.validation.halfDaySessionRequired",
    path: ["halfDaySession"],
  })
  // Hourly → same day
  .refine((v) => v.durationType !== LEAVE_DURATION_TYPE.HOURLY || v.startDate === v.endDate, {
    message: "form.validation.hourlyOneDay",
    path: ["endDate"],
  })
  // Hourly → startTime required
  .refine(
    (v) =>
      v.durationType !== LEAVE_DURATION_TYPE.HOURLY ||
      (v.startTime != null && clockTimeRegex.test(v.startTime)),
    {
      message: "form.validation.startTimeRequired",
      path: ["startTime"],
    },
  )
  // Hourly → endTime required
  .refine(
    (v) =>
      v.durationType !== LEAVE_DURATION_TYPE.HOURLY ||
      (v.endTime != null && clockTimeRegex.test(v.endTime)),
    {
      message: "form.validation.endTimeRequired",
      path: ["endTime"],
    },
  )
  // Hourly → endTime > startTime
  .refine(
    (v) =>
      v.durationType !== LEAVE_DURATION_TYPE.HOURLY ||
      v.startTime == null ||
      v.endTime == null ||
      v.endTime > v.startTime,
    {
      message: "form.validation.endTimeBeforeStart",
      path: ["endTime"],
    },
  );

export type LeaveFormValues = z.infer<typeof leaveFormSchema>;

export const EMPTY_LEAVE_FORM: LeaveFormValues = {
  leaveTypeId: "",
  durationType: LEAVE_DURATION_TYPE.FULL_DAY,
  startDate: "",
  endDate: "",
  halfDaySession: undefined,
  startTime: undefined,
  endTime: undefined,
  reason: "",
  handoverNote: "",
  contactDuringLeave: "",
  submitNow: false,
};

/** Chuyển form values → body POST /leave/requests */
export function toCreateDraftBody(values: LeaveFormValues): {
  leaveTypeId: string;
  durationType: string;
  startDate: string;
  endDate: string;
  halfDaySession?: string;
  startTime?: string;
  endTime?: string;
  reason?: string;
  handoverNote?: string;
  contactDuringLeave?: string;
  submitNow: boolean;
} {
  return {
    leaveTypeId: values.leaveTypeId,
    durationType: values.durationType,
    startDate: values.startDate,
    endDate: values.endDate,
    halfDaySession: values.halfDaySession,
    startTime: values.startTime,
    endTime: values.endTime,
    reason: values.reason || undefined,
    handoverNote: values.handoverNote || undefined,
    contactDuringLeave: values.contactDuringLeave || undefined,
    submitNow: values.submitNow,
  };
}

/** Chuyển form values → body PATCH /leave/requests/:id (update-draft — KHÔNG có submitNow). */
export function toUpdateDraftBody(values: LeaveFormValues): {
  leaveTypeId: string;
  durationType: string;
  startDate: string;
  endDate: string;
  halfDaySession?: string;
  startTime?: string;
  endTime?: string;
  reason?: string;
  handoverNote?: string;
  contactDuringLeave?: string;
} {
  return {
    leaveTypeId: values.leaveTypeId,
    durationType: values.durationType,
    startDate: values.startDate,
    endDate: values.endDate,
    halfDaySession: values.halfDaySession,
    startTime: values.startTime,
    endTime: values.endTime,
    reason: values.reason || undefined,
    handoverNote: values.handoverNote || undefined,
    contactDuringLeave: values.contactDuringLeave || undefined,
  };
}

/**
 * Chuyển 1 đơn nghỉ (GET /leave/me/requests/:id, status='Draft') → giá trị mặc định cho form edit.
 * Chỉ dùng field form cần — server vẫn authoritative cho mọi field khác (id/status/employeeId/...).
 */
export function fromDraftDetailToFormValues(detail: {
  leaveTypeId: string;
  durationType: string | null;
  startDate: string;
  endDate: string;
  halfDaySession: string | null;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
  handoverNote: string | null;
  contactDuringLeave: string | null;
}): LeaveFormValues {
  return {
    leaveTypeId: detail.leaveTypeId,
    durationType: (detail.durationType ??
      LEAVE_DURATION_TYPE.FULL_DAY) as LeaveFormValues["durationType"],
    startDate: detail.startDate,
    endDate: detail.endDate,
    halfDaySession: (detail.halfDaySession ?? undefined) as LeaveFormValues["halfDaySession"],
    startTime: detail.startTime ?? undefined,
    endTime: detail.endTime ?? undefined,
    reason: detail.reason ?? "",
    handoverNote: detail.handoverNote ?? "",
    contactDuringLeave: detail.contactDuringLeave ?? "",
    submitNow: false,
  };
}

/** Chuyển form values → body POST /leave/requests/calculate */
export function toCalculateBody(
  values: Pick<
    LeaveFormValues,
    | "leaveTypeId"
    | "durationType"
    | "startDate"
    | "endDate"
    | "halfDaySession"
    | "startTime"
    | "endTime"
  >,
) {
  return {
    leaveTypeId: values.leaveTypeId,
    durationType: values.durationType,
    startDate: values.startDate,
    endDate: values.endDate,
    halfDaySession: values.halfDaySession,
    startTime: values.startTime,
    endTime: values.endTime,
  };
}

/** Kiểm tra đủ dữ liệu để gọi /calculate chưa (tránh gọi khi form chưa điền xong). */
export function isCalculateReady(values: LeaveFormValues): boolean {
  const { leaveTypeId, durationType, startDate, endDate, halfDaySession, startTime, endTime } =
    values;
  if (!leaveTypeId || !durationType || !startDate || !endDate) return false;
  if (startDate > endDate) return false;
  if (durationType === "HalfDay") return startDate === endDate && halfDaySession != null;
  if (durationType === "Hourly")
    return startDate === endDate && startTime != null && endTime != null && endTime > startTime;
  return true;
}
