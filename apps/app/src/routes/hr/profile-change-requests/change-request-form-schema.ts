/**
 * S2-FE-HR-4 — Zod schema cho form "Gửi yêu cầu sửa hồ sơ" (React Hook Form + zodResolver).
 * Server là nguồn sự thật cuối (HR-ERR-040/041) — schema này chỉ chặn sớm ở client cho UX.
 */
import { z } from "zod";
import { PROFILE_CHANGE_ALLOWED_FIELDS, type CreateProfileChangeRequest } from "@mediaos/contracts";

export const changeRequestFormSchema = z
  .object({
    changedFields: z
      .array(z.enum(PROFILE_CHANGE_ALLOWED_FIELDS))
      .min(1, "changeRequest.form.errors.noFieldSelected"),
    // key = field name, value = giá trị mới nhập bởi user (string — kể cả date/select).
    newValues: z.record(z.string(), z.string()),
    reason: z.string().trim().max(1000, "changeRequest.form.errors.reasonTooLong").optional(),
  })
  .superRefine((data, ctx) => {
    for (const field of data.changedFields) {
      const value = data.newValues[field];
      if (!value || value.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["newValues", field],
          message: "changeRequest.form.errors.valueRequired",
        });
      }
    }
  });

export type ChangeRequestFormValues = z.infer<typeof changeRequestFormSchema>;

export const EMPTY_CHANGE_REQUEST_FORM: ChangeRequestFormValues = {
  changedFields: [],
  newValues: {},
  reason: "",
};

/** Chuyển form values → DTO gửi server (bỏ reason rỗng, chỉ giữ newValues của field đã chọn). */
export function toCreateChangeRequestDto(
  values: ChangeRequestFormValues,
): CreateProfileChangeRequest {
  const newValues: Record<string, unknown> = {};
  for (const field of values.changedFields) {
    newValues[field] = values.newValues[field];
  }
  return {
    changedFields: values.changedFields,
    newValues,
    reason: values.reason?.trim() ? values.reason.trim() : undefined,
  };
}
