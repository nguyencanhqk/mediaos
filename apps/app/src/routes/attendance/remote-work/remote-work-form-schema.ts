import { z } from "zod";
import type { CreateRemoteWorkRequest } from "@mediaos/contracts";

/**
 * Schema form tạo đơn làm việc từ xa/công tác — S3-FE-ATT-4. create → Draft (KHÔNG Pending) —
 * approver/watchers chọn ở bước submit riêng (SubmitRemoteWorkDialog).
 */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "remoteWork.form.validation.dateInvalid");

export const remoteWorkFormSchema = z
  .object({
    requestType: z.enum(["Remote", "BusinessTrip", "Offsite"]),
    startDate: isoDate,
    endDate: isoDate,
    startTime: z.string().trim(),
    endTime: z.string().trim(),
    attendanceMode: z.enum(["SELF_CHECK_IN", "AUTO_ATTENDANCE", "NO_ATTENDANCE"]),
    locationText: z.string().trim().max(255).optional().or(z.literal("")),
    reason: z.string().trim().min(3, "remoteWork.form.validation.reasonRequired").max(1000),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "remoteWork.form.validation.endBeforeStart",
    path: ["endDate"],
  });

export type RemoteWorkFormValues = z.infer<typeof remoteWorkFormSchema>;

export const EMPTY_REMOTE_WORK_FORM: RemoteWorkFormValues = {
  requestType: "Remote",
  startDate: "",
  endDate: "",
  startTime: "",
  endTime: "",
  attendanceMode: "SELF_CHECK_IN",
  locationText: "",
  reason: "",
};

function orUndef(v: string): string | undefined {
  return v.trim() === "" ? undefined : v.trim();
}

/**
 * `<input type="time">` trả "HH:MM" (không giây) — server dùng `z.string().time()` (ISO time, yêu cầu
 * giây). Chèn ":00" nếu thiếu để khớp contract, KHÔNG đổi hành vi người dùng.
 */
function toIsoTime(v: string): string | undefined {
  const trimmed = v.trim();
  if (trimmed === "") return undefined;
  return /^\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}:00` : trimmed;
}

export function toCreateRemoteWorkRequest(values: RemoteWorkFormValues): CreateRemoteWorkRequest {
  return {
    requestType: values.requestType,
    startDate: values.startDate,
    endDate: values.endDate,
    startTime: toIsoTime(values.startTime),
    endTime: toIsoTime(values.endTime),
    attendanceMode: values.attendanceMode,
    locationText: orUndef(values.locationText ?? ""),
    reason: values.reason,
  };
}
