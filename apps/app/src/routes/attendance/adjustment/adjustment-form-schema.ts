/**
 * Form schema cho tạo đơn điều chỉnh công (S3-FE-ATT-3) — tách khỏi createAdjustmentRequestSchema
 * (contracts) vì input <datetime-local> KHÔNG khớp `.datetime()` ISO (thiếu 'Z'/offset) — form dùng
 * string local rồi transform sang ISO ở `toCreateAdjustmentBody` (cùng pattern leave-form-schema.ts).
 */
import { z } from "zod";
import {
  attendanceAdjustmentRequestTypeSchema,
  type CreateAdjustmentRequest,
} from "@mediaos/contracts";
import { CHECK_IN_REQUEST_TYPES, CHECK_OUT_REQUEST_TYPES, localDatetimeToIso } from "./constants";

export const adjustmentFormSchema = z
  .object({
    workDate: z.string().min(1, "form.errors.workDateRequired"),
    requestType: attendanceAdjustmentRequestTypeSchema,
    requestedCheckInAt: z.string().optional(),
    requestedCheckOutAt: z.string().optional(),
    reason: z.string().min(3, "form.errors.reasonMin").max(1000, "form.errors.reasonMax"),
  })
  .refine((v) => !CHECK_IN_REQUEST_TYPES.has(v.requestType) || !!v.requestedCheckInAt, {
    message: "form.errors.checkInRequired",
    path: ["requestedCheckInAt"],
  })
  .refine((v) => !CHECK_OUT_REQUEST_TYPES.has(v.requestType) || !!v.requestedCheckOutAt, {
    message: "form.errors.checkOutRequired",
    path: ["requestedCheckOutAt"],
  });

export type AdjustmentFormValues = z.infer<typeof adjustmentFormSchema>;

export const EMPTY_ADJUSTMENT_FORM: AdjustmentFormValues = {
  workDate: "",
  requestType: "OTHER",
  requestedCheckInAt: "",
  requestedCheckOutAt: "",
  reason: "",
};

/** Form values (datetime-local strings) → contract body (ISO datetime). */
export function toCreateAdjustmentBody(v: AdjustmentFormValues): CreateAdjustmentRequest {
  return {
    workDate: v.workDate,
    requestType: v.requestType,
    reason: v.reason,
    requestedCheckInAt: localDatetimeToIso(v.requestedCheckInAt),
    requestedCheckOutAt: localDatetimeToIso(v.requestedCheckOutAt),
  };
}
